/** @type {import('next').NextConfig} */

// Phase 3 (P3-D): security headers for the HTML surface. The API
// backend already sends its own helmet headers; this file is the ONLY
// place the frontend (the actual HTML-serving edge) sets any.
//
// CSP is deliberately measured, not maximal:
//   • script-src 'unsafe-inline' is REQUIRED — Next.js App Router
//     emits inline bootstrap scripts (self.__next_f RSC payload) and
//     has no per-route nonce wiring in this app. Until a nonce
//     architecture is implemented (Phase 4 candidate), a script-src
//     without it would break every page. With it, the directive still
//     blocks remote/data:/blob: script sources.
//   • style-src 'unsafe-inline' — the app's styling model is inline
//     style props + framer-motion runtime styles.
//   • google-fonts origins are allowlisted so dev mode (next/font
//     fetches from Google at runtime) keeps working; production
//     self-hosts fonts at build time.
//   • connect-src carries the API origin derived from the same env
//     var the Axios client uses (lib/api.ts) — never hardcoded apart.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const API_ORIGIN = (() => {
  try { return new URL(API_URL).origin; } catch { return 'http://localhost:5000'; }
})();

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), usb=(), payment=()' },
  // No `preload` — that is a one-way browser commitment, deliberately
  // left to the deployment platform (Vercel sends its own HSTS).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src 'self' ${API_ORIGIN}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    // FIX: was `true` — this silently swallowed every TypeScript error
    // in the project, including every bug we found and fixed across
    // this entire session (and possibly others we haven't found yet).
    // Flipping to false makes `npm run build` the final verification
    // gate: any remaining real type error will now surface explicitly
    // instead of shipping silently.
    ignoreBuildErrors: false,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;