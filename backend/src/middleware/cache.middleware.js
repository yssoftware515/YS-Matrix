// ============================================================
// YS-MATRIX ERP — In-Memory Response Cache Middleware
// Author: Yahya Al-Sulami 🦅
//
// SCOPE & DECISION RECORD:
// Applies ONLY to read-only, tenant-scoped GET endpoints where a
// few seconds of staleness is acceptable (analytics/dashboard KPIs).
// Deliberately in-memory (a single Map inside the Node process),
// NOT Redis — confirmed with the founder that YS-MATRIX currently
// runs on a standalone Node server (not Vercel serverless), where
// a single long-lived process makes in-memory caching correct and
// sufficient. Revisit with Redis (e.g. Upstash) ONLY if/when the
// deployment target changes to serverless — a single Node process's
// memory is not shared/reliable across serverless invocations.
//
// TTL is a fixed 60 seconds — deliberately chosen to match the
// frontend's TanStack Query `staleTime: 60s` (providers.tsx). No
// event-based invalidation (no hooking into createSale/cancelSale/
// addPayment/etc.): analytics dashboards tolerate a few seconds of
// staleness by nature, and event-based invalidation would require
// touching every mutation path across sales/inventory/supplier
// services — wide blast radius for a feature that's read-only and
// non-critical-path. A single missed invalidation call there would
// silently serve stale data forever; a fixed TTL bounds staleness
// to a known, small window instead.
//
// MULTI-TENANCY GUARD (non-negotiable): the cache key ALWAYS starts
// with `showroomId`. This is what prevents a cross-tenant data leak
// — two showrooms hitting the exact same route + query string must
// never be able to read each other's cached response.
// ============================================================

'use strict';

const TTL_MS = 60 * 1000;

// Map<cacheKey, { body: unknown, expiresAt: number, timer: NodeJS.Timeout }>
const cacheStore = new Map();

/**
 * Builds the cache key. showroomId is ALWAYS the first segment —
 * this is the tenant-isolation boundary. req.originalUrl already
 * includes the full query string (range, group_by, limit, months,
 * etc.), so every distinct combination of filters gets its own
 * entry automatically — no manual enumeration of query params needed.
 */
function buildCacheKey(showroomId, req) {
  return `${showroomId}:${req.originalUrl}`;
}

/**
 * cacheResponse(ttlMs = TTL_MS)
 *
 * Express middleware factory. On a cache hit, short-circuits with
 * the stored response and never calls the wrapped controller. On a
 * miss, monkey-patches res.json for this one request to capture
 * whatever the controller sends, stores it, and schedules its own
 * expiry via setTimeout — entries actively delete themselves rather
 * than relying on a read-time expiry check, so an entry that's never
 * read again doesn't linger in memory past its TTL.
 *
 * Only wraps res.json (never res.send/res.end) — every endpoint this
 * is applied to goes through response.success()/response.error(),
 * which call res.json() exclusively. Deliberately does not cache
 * non-2xx responses (see check below) — an error must never be
 * cached and replayed to a retry.
 */
function cacheResponse(ttlMs = TTL_MS) {
  return (req, res, next) => {
    // req.showroomId is set by tenant.middleware, which runs before
    // this in every route this is mounted on (see analytics.routes.js
    // router.use ordering). Fail closed: if it's somehow missing,
    // skip caching entirely rather than risk a key without tenant
    // scoping.
    if (!req.showroomId) {
      return next();
    }

    const key    = buildCacheKey(req.showroomId, req);
    const cached = cacheStore.get(key);

    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached.body);
    }

    const originalJson = res.json.bind(res);

    res.json = (body) => {
      // Only cache successful responses. response.success() always
      // resolves with a 2xx status; anything else (validation errors,
      // 500s) must never be memoized and replayed.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Clear any pre-existing timer for this key before overwriting
        // (defensive — shouldn't happen given the HIT short-circuit
        // above, but avoids ever leaking a duplicate timer).
        const existing = cacheStore.get(key);
        if (existing) clearTimeout(existing.timer);

        const timer = setTimeout(() => cacheStore.delete(key), ttlMs);
        // Node's default event loop keeps the process alive while a
        // timer is pending; .unref() lets a graceful shutdown (see
        // index.js SIGTERM handler) proceed without waiting on cache
        // expiry timers.
        timer.unref();

        cacheStore.set(key, { body, expiresAt: Date.now() + ttlMs, timer });
      }

      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

/**
 * invalidateShowroomCache(showroomId)
 *
 * Not currently wired to any mutation path (see TTL-only decision
 * above) — exported for the ONE legitimate manual use case: an
 * operator or admin action that must be reflected immediately
 * (e.g. a support script fixing bad data). NOT intended to be
 * called from sales/inventory/supplier services — doing so piecemeal
 * would reintroduce the "one missed call site = permanently stale
 * data" risk this design deliberately avoids.
 */
function invalidateShowroomCache(showroomId) {
  const prefix = `${showroomId}:`;
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      const entry = cacheStore.get(key);
      clearTimeout(entry.timer);
      cacheStore.delete(key);
    }
  }
}

module.exports = { cacheResponse, invalidateShowroomCache, TTL_MS };
