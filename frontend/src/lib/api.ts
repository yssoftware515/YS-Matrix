import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
// Single source of truth for the authenticated user's shape — the Zustand
// store (auth.ts) already defines this correctly (showroom as a nested
// object, matching auth.controller.js's real login/getMe responses).
// Importing it here instead of duplicating it as a separate `AuthUser`
// closes the drift that previously existed (see AuthUser below).
import type { User } from '@/lib/auth';
import { useAuthStore } from '@/lib/auth';

declare const process: any;
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// ═══════════════════════════════════════════════════════════
// TOKEN STORAGE
// ═══════════════════════════════════════════════════════════

export const getAccessToken  = (): string | null => typeof window !== 'undefined' ? localStorage.getItem('ys_access_token')  : null;
export const getRefreshToken = (): string | null => typeof window !== 'undefined' ? localStorage.getItem('ys_refresh_token') : null;
export const setTokens   = (a: string, r: string): void => { localStorage.setItem('ys_access_token', a); localStorage.setItem('ys_refresh_token', r); };
export const clearTokens = (): void => { localStorage.removeItem('ys_access_token'); localStorage.removeItem('ys_refresh_token'); };

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ═══════════════════════════════════════════════════════════
// BACKEND ENVELOPE — the ONLY place that knows this shape exists
// ═══════════════════════════════════════════════════════════

/** Raw envelope every YS-MATRIX backend response is wrapped in. */
interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
  pagination?: Pagination;
  // present only on LICENSE_EXPIRED errors, but Axios still gives us
  // the body even on non-2xx, so we type it here rather than `any`.
  code?: string;
  expired_since?: string;
  days_expired?: number;
  errors?: unknown;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
  // Phase C.4 (EXP-2): server-side aggregate total carried by the
  // expenses list endpoint — the SUM of the filtered rows' amounts
  // (exact database decimal math), distinct from `total` above (row
  // count). Optional because only this endpoint extends the shape.
  total_amount?: number;
}

/** Shape returned by any list endpoint that paginates. */
export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

/**
 * Typed, structured error thrown by every api* method on failure.
 * Replaces having to dig through `(error as any).response.data` at call sites.
 */
export class ApiRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly errors: unknown;
  readonly expiredSince: string | null;
  readonly daysExpired: number | null;
  readonly raw: AxiosError;

  constructor(error: AxiosError) {
    const body = error.response?.data as Partial<ApiEnvelope<unknown>> | undefined;
    super(body?.message || error.message || 'Request failed');
    this.name = 'ApiRequestError';
    this.status = error.response?.status ?? null;
    this.code = body?.code ?? null;
    this.errors = body?.errors ?? null;
    this.expiredSince = body?.expired_since ?? null;
    this.daysExpired = body?.days_expired ?? null;
    this.raw = error;
  }

  get isLicenseExpired(): boolean {
    return this.code === 'LICENSE_EXPIRED';
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Type guard for call sites that catch generically. */
export function isApiRequestError(e: unknown): e is ApiRequestError {
  return e instanceof ApiRequestError;
}

// ═══════════════════════════════════════════════════════════
// REQUEST CORE — every api* method funnels through these two
// ═══════════════════════════════════════════════════════════

/**
 * Unwraps a paginated envelope into { data, pagination }.
 * Use for list endpoints that return backend `pagination`.
 */
async function requestPaginated<T>(promise: Promise<AxiosResponse<ApiEnvelope<T>>>): Promise<Paginated<T extends Array<infer U> ? U : T>> {
  try {
    const { data: envelope } = await promise;
    return {
      data: (envelope.data as unknown) as (T extends Array<infer U> ? U : T)[],
      pagination: envelope.pagination as Pagination,
    };
  } catch (e) {
    throw new ApiRequestError(e as AxiosError);
  }
}

/**
 * Unwraps a plain envelope into just the inner `data` payload.
 * Use for single-resource / non-paginated endpoints.
 */
async function request<T>(promise: Promise<AxiosResponse<ApiEnvelope<T>>>): Promise<T> {
  try {
    const { data: envelope } = await promise;
    return envelope.data;
  } catch (e) {
    throw new ApiRequestError(e as AxiosError);
  }
}

// ═══════════════════════════════════════════════════════════
// 401 REFRESH QUEUE
// ═══════════════════════════════════════════════════════════

let isRefreshing = false;
let queue: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
const flush = (err: AxiosError | null, token: string | null = null): void => {
  queue.forEach(({ resolve, reject }) => (err ? reject(err) : resolve(token)));
  queue = [];
};

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const orig = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !orig._retry) {
      // ── Phase 4B: credential endpoints return 401 for WRONG CREDENTIALS,
      // not for session expiry. Feeding that 401 into the refresh/redirect
      // machinery below silently swallowed the real error (hard reload to
      // /auth/login, no message shown to the user). Surface it directly so
      // the login/register UI can display the actual failure reason.
      const reqUrl = typeof orig.url === 'string' ? orig.url : '';
      if (reqUrl.includes('/auth/login') || reqUrl.includes('/auth/register')) {
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise((resolve, reject) => queue.push({ resolve, reject })).then((token) => {
          orig.headers.Authorization = `Bearer ${token}`;
          return api(orig);
        });
      }

      orig._retry = true;
      isRefreshing = true;
      const rt = getRefreshToken();

      if (!rt) {
        useAuthStore.getState().clearAuth();
        if (typeof window !== 'undefined') window.location.href = '/auth/login';
        return Promise.reject(error);
      }

      try {
        // Uses the SAME envelope type as everything else — no more
        // hand-unwrapping `data.data.accessToken` inline and hoping
        // it matches what the rest of the file assumes.
        const { data: envelope } = await axios.post<ApiEnvelope<{ accessToken: string; refreshToken: string }>>(
          `${BASE}/auth/refresh`,
          { refreshToken: rt }
        );
        const { accessToken, refreshToken } = envelope.data;
        setTokens(accessToken, refreshToken);
        flush(null, accessToken);
        orig.headers.Authorization = `Bearer ${accessToken}`;
        return api(orig);
      } catch (e) {
        flush(e as AxiosError);
        useAuthStore.getState().clearAuth();
        if (typeof window !== 'undefined') window.location.href = '/auth/login';
        return Promise.reject(e);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ═══════════════════════════════════════════════════════════
// SHARED PARAM TYPES
// ═══════════════════════════════════════════════════════════

export type Payload = Record<string, unknown>;
export interface ListParams   { page?: number; limit?: number; search?: string; }
export interface RangeParams  { range?: 'today' | 'week' | 'month' | 'year'; }
export interface InventoryParams extends ListParams { vehicle_type?: string; status?: string; include_inactive?: string; }
export interface SaleListParams  extends ListParams, RangeParams { sale_type?: string; }
export interface UpcomingParams  { days?: number; }
export interface ExpenseParams   extends ListParams, RangeParams {}

// ═══════════════════════════════════════════════════════════
// ENTITY TYPES — inferred from API-STEP3.md / FILE-STRUCTURE.md.
// ⚠️ ASSUMPTION: these are best-guess shapes based on the docs you
// uploaded, not your actual Prisma schema. Once we get to
// `schema.prisma`, we correct these and TS will flag every call
// site that breaks — that's the point of typing it now rather
// than leaving `any` until later.
// ═══════════════════════════════════════════════════════════

export type VehicleType = 'MOTORCYCLE' | 'CAR' | 'TUKTUK' | 'TRICYCLE' | 'SPARE_PART' | 'OTHER';
export type InventoryStatus = 'IN_STOCK' | 'SOLD' | 'RESERVED' | 'RETURNED';
export type PaymentType = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';
export type UserRole = 'SUPER_ADMIN' | 'OWNER' | 'STAFF';

export interface InventoryItem {
  id: string;
  showroom_id: string;
  vehicle_type: VehicleType;
  brand: string;
  model: string;
  year?: number;
  color?: string;
  engine_cc?: number;
  chassis_number?: string;
  engine_number?: string;
  cost_price: number;
  selling_price: number;
  min_price?: number;
  quantity: number;
  status: InventoryStatus;
  supplier_id?: string;
  // FP-01/FP-03: was missing entirely — inventory soft-delete (backend
  // sets is_active: false on DELETE, see inventory.controller.js) had
  // no frontend-visible field to react to, which is how FP-01's
  // "irretrievable soft-delete" gap happened in the first place.
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryStats {
  totals: {
    total: number;
    in_stock: number;
    sold: number;
    reserved: number;
    low_stock: number;
    total_value: number;
  };
}

export interface Supplier {
  id: string;
  showroom_id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  is_active: boolean;
  total_due: number;
  total_paid: number;
  created_at: string;
  updated_at: string;
  // Present on listSuppliers()/getSupplier() — computed server-side,
  // not a stored column (total_due - total_paid).
  balance?: number;
  // Present on listSuppliers() rows only
  _count?: { inventory: number; payments: number };
  // Present on getSupplier() (single) only
  payments?: SupplierPayment[];
  inventory?: Array<{
    id: string; vehicle_type: string; brand: string; model: string;
    quantity: number; selling_price: number; status: string;
  }>;
}

export interface SupplierPayment {
  id: string;
  supplier_id: string;
  amount: number;
  payment_type: PaymentType;
  reference?: string;
  note?: string;
  paid_at: string;
}

// Customer — corrected against customer.service.js (previously missing
// is_active, notes, and the relation shapes the backend actually returns).
// is_active is the soft-delete flag: deleteCustomer() only ever sets this
// to false, it never removes the row — see customer.service.js comments.
export interface Customer {
  id: string;
  showroom_id: string;
  name: string;
  phone?: string;
  national_id?: string;
  address?: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Present on listCustomers() rows only (Prisma `include: { _count: ... }`)
  _count?: { sales: number };
  // Present on getCustomer() (single) only — last 10 sales, NOT the
  // full sales relation; matches the `take: 10` in customer.service.js
  sales?: Array<{
    id: string;
    invoice_number: string;
    sale_type: 'CASH' | 'INSTALLMENT';
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
    total: number;
    sold_at: string;
  }>;
}

// Sale and Installment were previously defined here as best-guess
// placeholders (before sales.service.js had been reviewed). They are
// now defined authoritatively in @/types/sale.types.ts, confirmed
// against the real Prisma model fields used by sales.service.js
// (e.g. `total` not `total_amount`, `is_paid: boolean` not a `status`
// enum, no `total_amount`/`paid_amount` fields exist on the real model).
// Imported here for local use (salesApi's own generics below), and
// re-exported so existing `import type { Sale } from '@/lib/api'`
// call sites don't silently break — sale.types.ts remains the one
// canonical source of truth, this file does not redefine the shape.
import type { Sale, Installment, CreateSalePayload, SalesSummary } from '@/types/sale.types';
export type { Sale, Installment, CreateSalePayload, SalesSummary } from '@/types/sale.types';

export interface Expense {
  id: string;
  showroom_id: string;
  category: string;
  description?: string;
  amount: number;
  expense_date: string;
  created_at: string;
}

// Confirmed directly against schema.prisma's `model Showroom`.
// Previously had `owner_id`, which does NOT exist on this model at
// all (no such field/relation in the real schema) — was a
// pre-verification guess. Was also missing slug/phone/email/address/
// is_active/is_onboarded/updated_at entirely.
export interface Showroom {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  address?: string;
  phone?: string;
  email?: string;
  is_active: boolean;
  license_expiry: string;
  is_onboarded: boolean;
  created_at: string;
  updated_at: string;
  // Present when the backend includes relation counts (confirmed
  // real relations on the model: users[], sales[], etc.)
  _count?: { users: number; sales: number };
}

// FIX: was { total_inventory, total_sales, total_revenue, active_staff }
// — confirmed against showroom.controller.js:getShowroomStats, the real
// shape is { showroom, stats: { users, inventory, sales, total_revenue,
// total_profit } }. No `showroom` field existed at all in the old type,
// `total_profit` was missing entirely, and every stats field name was
// wrong (e.g. `active_staff` doesn't exist — it's `stats.users`, a raw
// count with no active/inactive distinction).
// NOTE: not currently called from any page reviewed so far — fixing the
// contract now so it's correct whenever a showroom detail view uses it.
export interface ShowroomStats {
  showroom: Showroom;
  stats: {
    users: number;
    inventory: number;
    sales: number;
    total_revenue: number;
    total_profit: number;
  };
}

// ─────────────────────────────────────────────────────────────
// License types — confirmed directly against license.controller.js.
// Previously this single `LicenseStatus` interface (is_valid /
// expires_at / days_remaining) matched NONE of the three real
// endpoint shapes below — it was guessed before the controller was
// finalized and never synced back. Split into 4 distinct types
// because getStatus, getAll, and renew each return a genuinely
// different shape; reusing one interface across all three was the
// root cause.
// ─────────────────────────────────────────────────────────────

export type LicenseStatusLabel = 'INACTIVE' | 'EXPIRED' | 'EXPIRING_SOON' | 'ACTIVE';

/** GET /licenses/status — current showroom's own license. */
export interface LicenseStatus {
  showroom_id: string;
  showroom_name: string;
  is_active: boolean;
  license_expiry: string;
  is_expired: boolean;
  days_left: number;
  status: LicenseStatusLabel;
}

/** Single row inside GET /licenses/all → showrooms[]. */
export interface LicenseRecord {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  license_expiry: string;
  _count: { users: number };
  is_expired: boolean;
  days_left: number;
  status: LicenseStatusLabel;
}

/** Aggregate counts inside GET /licenses/all → summary. */
export interface LicenseSummary {
  total: number;
  active: number;
  expiring_soon: number;
  expired: number;
  inactive: number;
}

/** GET /licenses/all — NOT paginated, NOT an array at the top level. */
export interface LicenseAllResponse {
  summary: LicenseSummary;
  showrooms: LicenseRecord[];
}

/** POST /licenses/renew — distinct shape; no status/days_left/is_expired. */
export interface LicenseRenewResult {
  showroom_id: string;
  old_expiry: string;
  new_expiry: string;
  is_active: boolean;
}

export type NotificationType =
  | 'INSTALLMENT_OVERDUE'
  | 'INSTALLMENT_DUE_SOON'
  | 'LICENSE_EXPIRING'
  | 'LOW_STOCK'
  | 'SALE_CREATED'
  | 'SALE_CANCELLED'
  | 'PAYMENT_RECEIVED'
  | 'SYSTEM'
  // ── Phase 4 — subscription lifecycle notifications ──────────
  | 'PAYMENT_SUBMITTED'
  | 'SUBSCRIPTION_ACTIVATED'
  | 'PAYMENT_REJECTED'
  | 'SUBSCRIPTION_EXPIRING'
  | 'SUBSCRIPTION_EXPIRED';

// Confirmed directly against schema.prisma's `model Notification`.
// Previously had `message` (doesn't exist — real field is `body`),
// and was missing type/data/showroom_id/read_at entirely.
export interface Notification {
  id: string;
  showroom_id: string;
  user_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

// Subscription — confirmed directly against schema.prisma's
// `model Subscription` and subscription.service.js. Previously this
// had plan/current_period_end (neither exists on the real model;
// the real fields are plan_name/expires_at) and only 3 of the 4 real
// status enum values.
export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'TRIAL' | 'PENDING_PAYMENT';

export interface Subscription {
  id: string;
  showroom_id: string;
  plan_name: string;
  status: SubscriptionStatus;
  started_at: string;
  expires_at: string;
  renewed_by: string | null;
  amount_paid: number | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  // ── Phase 4 — plan snapshot + lifecycle fields ────────────────
  plan_id?: string | null;
  approved_at?: string | null;
  price_amount?: number | null;
  duration_months?: number | null;
  users_limit?: number | null;
  expiry_notified_days?: number | null;
  // Present on listAllSubscriptions() rows only — computed server-side
  // from expires_at vs now. NOTE: the raw `status` column is NOT
  // automatically flipped to EXPIRED when expires_at passes (no cron
  // job does this in the codebase reviewed so far) — these computed
  // fields are the reliable signal for "is this actually expired right
  // now", not the stored status value alone.
  is_expired?: boolean;
  days_left?: number;
  // enrichSubscription computes a live status for the billing UI.
  status_live?: 'ACTIVE' | 'EXPIRED' | 'EXPIRING_SOON' | 'PENDING_PAYMENT';
  // Relations — only present where explicitly included
  showroom?: { id: string; name: string; slug: string; is_active: boolean; email?: string; phone?: string };
  renewed_by_user?: { id: string; name: string } | null;
  payments?: { id: string; status: string; amount: number; created_at: string }[];
}

// ── Phase 4 — commerce types (confirmed against
//    subscription.lifecycle.service.js shapes) ───────────────────

export type AccountStatusValue = 'PENDING' | 'PENDING_PAYMENT' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';

export interface Plan {
  id: string;
  name: string;
  code: string;
  price_amount: number;
  currency: string;
  duration_months: number;
  users_limit: number;
  features?: Record<string, unknown> | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED' | 'REJECTED';

// ── Phase C.7 — commercial catalog types (public /subscriptions/pricing) ──
export type BillingPeriodCode = 'MONTHLY' | 'SIX_MONTHS' | 'YEARLY';

export interface PricingPeriod {
  code: BillingPeriodCode;
  duration_months: number;
  discount_percent: number;
  base_amount: number;
  final_amount: number;
  effective_monthly: number;
  savings_amount: number;
  label_en: string;
  label_ar: string;
}

export interface PricingCatalog {
  market: string;
  market_name_en: string;
  market_name_ar: string;
  currency: string;
  trial_days: number;
  periods: PricingPeriod[];
}

export interface PaymentRecord {
  id: string;
  showroom_id: string;
  subscription_id: string | null;
  plan_id: string | null;
  plan_name: string;
  plan_code: string;
  amount: number;
  currency: string;
  method: string;
  provider: string;
  status: PaymentStatus;
  reference: string | null;
  proof_mime: string | null;
  proof_data?: string | null;
  proof_available?: boolean;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Relations — admin list/detail only
  showroom?: { id: string; name: string; slug: string; email: string | null; phone: string | null; is_active: boolean };
  subscription?: { id: string; plan_name: string; status: string } | null;
  reviewer?: { id: string; name: string; email: string } | null;
}

export interface PaymentInstructions {
  headline: string;
  steps: string[];
  bank_account: string | null;
}

export interface AccountStatusResponse {
  account_status: AccountStatusValue;
  subscription: Subscription | null;
  latest_payment: PaymentRecord | null;
  usage: { users: { limit: number | null; current: number } };
  payment_instructions: PaymentInstructions;
  showroom: {
    id: string;
    name: string;
    is_active: boolean;
    license_expiry: string;
    is_onboarded: boolean;
  };
}

export interface RegisterAccountResult {
  showroom: { id: string; name: string; slug: string };
  owner: { id: string; name: string; email: string };
  trial: { expires_at: string; days: number };
  account_status: AccountStatusValue;
}

export interface PlatformSubscriptionSummary {
  accounts: {
    total: number;
    active: number;
    pending_subscription: number;
    suspended: number;
  };
  subscriptions: {
    active: number;
    expiring_soon: number;
    expired: number;
    pending: number;
    total: number;
  };
  payments: { pending: number };
  revenue: { total_paid: number };
}

export interface SubscriptionSummary {
  total: number;
  active: number;
  expiring_soon: number;
  expired: number;
  total_revenue: number;
}

// Confirmed directly against schema.prisma's `model AuditLog`
// (@@map("audit_logs")). Previously was missing showroom_id,
// old_data, new_data, ip_address entirely.
// FIX: also missing `user` — activity.service.js:listActivityLogs
// always includes `user: { select: { id, name, email, role } }`,
// so every log entry genuinely carries this nested object at runtime.
export interface ActivityLogEntry {
  id: string;
  showroom_id: string;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at: string;
  user?: { id: string; name: string; email: string; role: string } | null;
}

// FIX: AuthUser was previously a standalone interface with
// `showroom_id: string | null` — but auth.controller.js's login and
// getMe responses both return `showroom` as a nested object (or null),
// never a bare showroom_id string. That mismatch meant LoginResponse.user
// and authApi.me()'s return type silently lied about their own shape.
// Aliasing to the already-correct `User` from auth.ts fixes both call
// sites in one move and removes the duplicate definition going forward —
// there is now exactly one place that describes "the logged-in user".
export type AuthUser = User;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

// ═══════════════════════════════════════════════════════════
// API MODULES — every method returns the unwrapped payload.
// Paginated list endpoints return Promise<Paginated<T>>.
// Everything else returns Promise<T> directly.
// ═══════════════════════════════════════════════════════════

export const authApi = {
  login:          (email: string, password: string) => request<LoginResponse>(api.post('/auth/login', { email, password })),
  me:             ()                                  => request<AuthUser>(api.get('/auth/me')),
  // Confirmed against auth.controller.js:updateProfile — response
  // select is { id, name, email, role, avatar_url, last_login,
  // created_at }, deliberately WITHOUT `showroom`. Safe to feed
  // straight into useAuthStore's updateUser(), which merges onto the
  // existing user object rather than replacing it wholesale.
  updateProfile:  (data: { name?: string; avatar_url?: string }) =>
    request<{ id: string; name: string; email: string; role: UserRole; avatar_url?: string; last_login?: string; created_at: string }>(
      api.patch('/auth/me', data)
    ),
  logout:         (refreshToken: string)               => request<null>(api.post('/auth/logout', { refreshToken })),
  // FIX: was sending only { currentPassword, newPassword } — but the
  // backend's changePasswordSchema (Zod) requires confirmPassword too
  // and rejects the request entirely without it. Never actually hit
  // in practice yet since no UI currently calls this, but would have
  // 400'd on first use exactly like the curl test earlier in this
  // session did before confirmPassword was added to the command.
  changePassword: (currentPassword: string, newPassword: string) =>
    request<null>(api.put('/auth/change-password', { currentPassword, newPassword, confirmPassword: newPassword })),

  // Matrix Audit — Phase 1 (Password Reset Flow)
  forgotPasswordRequest: (email: string) =>
    request<null>(api.post('/auth/forgot-password-request', { email })),
  resetPassword: (token: string, newPassword: string) =>
    request<null>(api.post('/auth/reset-password', { token, newPassword, confirmPassword: newPassword })),

  // ── Phase 4 — customer self-registration (PUBLIC, authLimiter) ──
  // POST /auth/register-account — creates showroom + OWNER + TRIAL
  // claim (5 days — backend config/commercial.js, returned in
  // response.trial.days). Returns NO tokens (the account is PENDING
  // until a real plan is purchased and approved); the user logs in
  // normally.
  registerAccount: (d: {
    name: string;
    email: string;
    password: string;
    showroom_name?: string;
    phone?: string;
  }) => request<RegisterAccountResult>(api.post('/auth/register-account', d)),
};

export const inventoryApi = {
  getAll:      (p?: InventoryParams) => requestPaginated<InventoryItem[]>(api.get('/inventory', { params: p })),
  getOne:      (id: string)          => request<InventoryItem>(api.get(`/inventory/${id}`)),
  getStats:    ()                    => request<InventoryStats>(api.get('/inventory/stats')),
  getLowStock: ()                    => request<InventoryItem[]>(api.get('/inventory/low-stock')),
  create:      (d: Payload)          => request<InventoryItem>(api.post('/inventory', d)),
  // Phase C.6 (P1): the backend bulk endpoint returns { count } — the
  // number of rows actually created (inventory.controller.js
  // bulkCreateInventory), NOT the created rows. The previous
  // InventoryItem[] typing made every import report "0 of N" even on
  // full success, because the response has no array to measure.
  bulkCreate:  (d: { items: Payload[] }) => request<{ count: number }>(api.post('/inventory/bulk', d)),
  update:      (id: string, d: Payload) => request<InventoryItem>(api.put(`/inventory/${id}`, d)),
  // SOFT DELETE — confirmed via inventory.controller.js: only sets
  // is_active: false ("تم أرشفة المنتج بنجاح" — archived, not erased).
  // Same pattern as suppliersApi/customersApi.deactivate.
  remove:      (id: string)          => request<null>(api.delete(`/inventory/${id}`)),
  // FP-03: confirmed route PATCH /inventory/:id/reactivate, ownerOnly
  // (inventory.routes.js) — existed on the backend with no frontend
  // caller at all until now.
  reactivate:  (id: string)          => request<InventoryItem>(api.patch(`/inventory/${id}/reactivate`)),
};

export interface SupplierStats {
  total_suppliers: number;
  total_due: number;
  total_paid: number;
  total_balance: number;
  top_balances: Array<{ id: string; name: string; total_due: number; total_paid: number; balance: number }>;
}

export const suppliersApi = {
  getAll:      (p?: ListParams & { include_inactive?: string }) =>
    requestPaginated<Supplier[]>(api.get('/suppliers', { params: p })),
  getOne:      (id: string)                 => request<Supplier>(api.get(`/suppliers/${id}`)),
  getStats:    ()                           => request<SupplierStats>(api.get('/suppliers/stats')),
  getPayments: (id: string, p?: ListParams) => requestPaginated<SupplierPayment[]>(api.get(`/suppliers/${id}/payments`, { params: p })),
  create:      (d: Payload)                 => request<Supplier>(api.post('/suppliers', d)),
  update:      (id: string, d: Payload)     => request<Supplier>(api.put(`/suppliers/${id}`, d)),
  // SOFT DELETE — confirmed via supplier.service.js: only sets
  // is_active: false, the row is never removed. Same pattern as
  // customersApi.deactivate. `remove` kept as an alias.
  deactivate:  (id: string)                 => request<{ id: string; is_active: false }>(api.delete(`/suppliers/${id}`)),
  remove:      (id: string)                 => request<{ id: string; is_active: false }>(api.delete(`/suppliers/${id}`)),
  reactivate:  (id: string)                 => request<Supplier>(api.patch(`/suppliers/${id}/reactivate`)),
  addPayment:  (id: string, d: Payload)     => request<SupplierPayment>(api.post(`/suppliers/${id}/payments`, d)),
};

export const customersApi = {
  getAll:      (p?: ListParams & { include_inactive?: string }) =>
    requestPaginated<Customer[]>(api.get('/customers', { params: p })),
  getOne:      (id: string)             => request<Customer>(api.get(`/customers/${id}`)),
  create:      (d: Payload)             => request<Customer>(api.post('/customers', d)),
  update:      (id: string, d: Payload) => request<Customer>(api.put(`/customers/${id}`, d)),
  // SOFT DELETE — confirmed via customer.service.js: this only ever sets
  // is_active: false, the row is never removed. `remove` is kept as an
  // alias for any existing call sites; new code should call `deactivate`
  // since that's what actually happens (and the backend route is
  // ownerOnly — STAFF will get a 403).
  deactivate:  (id: string)             => request<{ id: string; is_active: false }>(api.delete(`/customers/${id}`)),
  remove:      (id: string)             => request<{ id: string; is_active: false }>(api.delete(`/customers/${id}`)),
  // Confirmed route: PATCH /customers/:id/reactivate, ownerOnly (customer.routes.js)
  reactivate:  (id: string)             => request<Customer>(api.patch(`/customers/${id}/reactivate`)),
};

export const salesApi = {
  getAll:         (p?: SaleListParams) => requestPaginated<Sale[]>(api.get('/sales', { params: p })),
  getById:        (id: string)         => request<Sale>(api.get(`/sales/${id}`)),
  getSummary:     (p?: RangeParams)    => request<SalesSummary>(api.get('/sales/summary', { params: p })),
  getOverdue:     (p?: ListParams)     => requestPaginated<Installment[]>(api.get('/sales/overdue', { params: p })),
  getUpcoming:    (p?: UpcomingParams) => request<Installment[]>(api.get('/sales/upcoming', { params: p })),
  create:         (d: CreateSalePayload) => request<Sale>(api.post('/sales', d)),
  cancel:         (id: string)         => request<Sale>(api.patch(`/sales/${id}/cancel`)),
  // FIX (Matrix Audit — Priority 1): was (saleId, installmentId, amount)
  // sending { amount } — but sales.controller.js's payInstallment only
  // ever reads req.params.installment_id and req.body?.note;
  // sales.service.js's update never touches `amount` at all (paying an
  // installment marks it paid, it doesn't change its amount).
  //
  // The earlier fix attempt here kept `/sales/:saleId/installments/:id/pay`,
  // reasoning that since the controller's param read doesn't care what the
  // sale-id segment is named, the URL shape was "safe either way" — that
  // reasoning was wrong. Express matches the route PATTERN before any
  // controller code runs. The real route in sales.routes.js is the
  // literal `/sales/installments/:installment_id/pay` — there is no
  // `:saleId` segment in the pattern at all. Inserting one in the
  // request URL produces a path Express can never match against that
  // pattern, so every call 404'd regardless of what the controller does
  // with its params. Confirmed directly against sales.routes.js.
  //
  // Fix: drop saleId entirely — the backend never needed it, so there's
  // nothing for callers to supply.
  payInstallment: (installmentId: string, note?: string) =>
    request<Installment>(api.patch(`/sales/installments/${installmentId}/pay`, { note })),
};

// ── Analytics — every shape below confirmed directly against
// analytics.service.js's actual `return` statements, not guessed. ──

export interface DashboardKPIs {
  period: string;
  sales: {
    count: number;
    revenue: number;
    profit: number;
    profit_margin: number;
    revenue_change: number;
    profit_change: number;
  };
  inventory: { total: number; low_stock: number; sold: number };
  customers: { total: number; new_this_period: number };
  installments: { overdue_count: number; overdue_amount: number; due_this_week: number };
  suppliers: { total_due: number; total_paid: number; outstanding_balance: number };
}

export interface RevenueChartPoint {
  date: string;
  revenue: number;
  profit: number;
  count: number;
  cash: number;
  installment: number;
  profit_margin: number;
}

export interface RevenueChartResponse {
  range: string;
  group_by: string;
  data: RevenueChartPoint[];
}

export interface MonthlyComparisonPoint {
  month: string;
  revenue: number;
  profit: number;
  count: number;
}

export interface TopSellingItem {
  inventory: { id: string; brand: string; model: string; vehicle_type: string; color: string | null } | null;
  total_sold: number;
  total_revenue: number;
  total_profit: number;
  sale_count: number;
}

export interface ProfitBreakdownItem {
  type: string;
  revenue: number;
  profit: number;
  count: number;
  profit_margin: number;
}

export interface NetProfitSummary {
  period: string;
  total_revenue: number;
  gross_profit: number;
  total_expenses: number;
  net_profit: number;
  net_margin: number;
}

export const analyticsApi = {
  getDashboard:       (p?: RangeParams)        => request<DashboardKPIs>(api.get('/analytics/dashboard', { params: p })),
  // FIX: was typed (p?: RangeParams) — missing `group_by`, even though
  // analytics.service.js:getRevenueChart genuinely reads it from the
  // query (`const { range = 'month', group_by = 'day' } = query`) and
  // dashboard/page.tsx genuinely passes it. The page was correct; the
  // param type was incomplete.
  getRevenue:         (p?: RangeParams & { group_by?: 'day' | 'month' }) => request<RevenueChartResponse>(api.get('/analytics/revenue-chart', { params: p })),
  // NOTE: getMonthlyComparison reads `query.months` server-side, NOT
  // `range` — confirmed in analytics.service.js. RangeParams doesn't
  // have a `months` field, so this used `{ range }` typing even though
  // every call site actually needs to pass `{ months }`. Fixed to the
  // param shape the backend actually reads.
  getMonthly:         (p?: { months?: number }) => request<MonthlyComparisonPoint[]>(api.get('/analytics/monthly', { params: p })),
  getTopItems:        (p?: RangeParams & { limit?: number }) => request<TopSellingItem[]>(api.get('/analytics/top-items', { params: p })),
  getProfitBreakdown: (p?: RangeParams)        => request<ProfitBreakdownItem[]>(api.get('/analytics/profit-breakdown', { params: p })),
  getNetProfit:       (p?: RangeParams)        => request<NetProfitSummary>(api.get('/analytics/net-profit', { params: p })),
  getExpenses:        (p?: ExpenseParams)      => requestPaginated<Expense[]>(api.get('/analytics/expenses', { params: p })),
  createExpense:      (d: Payload)             => request<Expense>(api.post('/analytics/expenses', d)),
  updateExpense:      (id: string, d: Payload) => request<Expense>(api.put(`/analytics/expenses/${id}`, d)),
  removeExpense:       (id: string)            => request<null>(api.delete(`/analytics/expenses/${id}`)),
};

export const showroomsApi = {
  getAll:   (p?: ListParams)         => requestPaginated<Showroom[]>(api.get('/showrooms', { params: p })),
  create:   (d: Payload)             => request<Showroom>(api.post('/showrooms', d)),
  update:   (id: string, d: Payload) => request<Showroom>(api.put(`/showrooms/${id}`, d)),
  getStats: (id: string)             => request<ShowroomStats>(api.get(`/showrooms/${id}/stats`)),
};

export const licenseApi = {
  // FIX: was typed as request<LicenseStatus> with a guessed shape
  // (is_valid/expires_at/days_remaining) that matched none of the
  // real fields license.controller.js's getLicenseStatus returns.
  getStatus: () => request<LicenseStatus>(api.get('/licenses/status')),

  // FIX: was typed as request<LicenseStatus[]> — wrong on two counts:
  // (1) the real response is an object { summary, showrooms }, not an
  // array at the top level — any `.map()` on the old return value
  // would have thrown "licenses.map is not a function" at runtime;
  // (2) even the array elements never matched LicenseStatus's fields.
  getAll: () => request<LicenseAllResponse>(api.get('/licenses/all')),

  // FIX: was typed as request<LicenseStatus> — renewLicense's real
  // return (old_expiry/new_expiry) is a different shape entirely from
  // getLicenseStatus's (license_expiry/is_expired/days_left/status).
  renew: (d: Payload) => request<LicenseRenewResult>(api.post('/licenses/renew', d)),
};

// ─── Phase 3 Stage 1 ──────────────────────────────────────────

export const notificationApi = {
  getAll:         (p?: { is_read?: string; type?: string; mine?: string; page?: number; limit?: number }) =>
    requestPaginated<Notification[]>(api.get('/notifications', { params: p })),
  // FIX: real service return is { unread_count: count }, not { count }
  // (confirmed in notification.service.js's getUnreadCount).
  getUnreadCount: () => request<{ unread_count: number }>(api.get('/notifications/unread')),
  markAsRead:     (id: string) => request<Notification>(api.patch(`/notifications/${id}/read`)),
  // FIX: real return is { updated: number } (confirmed: service
  // returns { updated: result.count }), not null.
  markAllAsRead:  () => request<{ updated: number }>(api.patch('/notifications/read-all')),
  // FIX: real return is { deleted: number } (confirmed: service
  // returns { deleted: result.count }), not { deleted_count }.
  deleteOld:      () => request<{ deleted: number }>(api.delete('/notifications/old')),
};

export const subscriptionApi = {
  // FIX: was calling GET /subscriptions — that path isn't registered
  // at all on subscription.routes.js (only /current, /history, /all,
  // /summary, /renew exist). The SuperAdmin "all showrooms" list is
  // at /subscriptions/all.
  getAll:     (p?: ListParams & { status?: string; showroom_id?: string; expiring_in?: number }) =>
    requestPaginated<Subscription[]>(api.get('/subscriptions/all', { params: p })),
  getCurrent: () => request<Subscription>(api.get('/subscriptions/current')),
  getHistory: (p?: ListParams) => requestPaginated<Subscription[]>(api.get('/subscriptions/history', { params: p })),
  // FIX: return type now matches getSubscriptionSummary's real return
  // shape confirmed in subscription.service.js — { total, active,
  // expiring_soon, expired, total_revenue }, not the previously
  // guessed { active_count, expired_count, total_mrr } (none of
  // those three field names exist on the real response).
  getSummary: () => request<SubscriptionSummary>(api.get('/subscriptions/summary')),
  renew:      (d: Payload) => request<Subscription>(api.post('/subscriptions/renew', d)),

  // ── Phase C.7 — PUBLIC commercial catalog (no auth) ─────────────
  // Billing periods + derived prices + trial days, straight from the
  // backend authority (config/commercial.js + MarketPricing rows).
  getPricing: (params?: { market?: string; currency?: string }) =>
    request<PricingCatalog>(api.get('/subscriptions/pricing', { params })),

  // ── Phase 4 — customer lifecycle surface (self-service) ────────
  listPlans:   () => request<Plan[]>(api.get('/subscriptions/plans')),
  getStatus:   () => request<AccountStatusResponse>(api.get('/subscriptions/status')),
  listPayments: (p?: ListParams & { status?: string }) =>
    requestPaginated<PaymentRecord[]>(api.get('/subscriptions/payments', { params: p })),
  requestPlan: (d: {
    plan_code: string;
    // Phase C.7: explicit billing period (MONTHLY | SIX_MONTHS |
    // YEARLY). Amount is NEVER client-supplied — the server resolves
    // it from the MarketPricing catalog.
    billing_period?: BillingPeriodCode;
    method?: string;
    reference?: string;
    proof_mime?: string;
    proof_data?: string;
  }) => request<{ subscription: Subscription; payment: PaymentRecord; price_amount: number; currency: string }>(
    api.post('/subscriptions/request', d)
  ),
  // F2 — renewal/upgrade while ACTIVE (same shape as requestPlan;
  // amount still resolves server-side from the plan).
  renewRequest: (d: {
    plan_code: string;
    billing_period?: BillingPeriodCode;
    method?: string;
    reference?: string;
    proof_mime?: string;
    proof_data?: string;
  }) => request<{ subscription: Subscription; payment: PaymentRecord; price_amount: number; currency: string }>(
    api.post('/subscriptions/renew-request', d)
  ),
  attachProof: (paymentId: string, d: { proof_mime?: string; proof_data?: string; reference?: string; method?: string }) =>
    request<{ id: string; status: string; proof_uploaded?: boolean; reference?: string | null }>(
      api.patch(`/subscriptions/payments/${paymentId}`, d)
    ),
  // F3 — cancel the pending purchase/renewal claim (OWNER).
  cancelRequest: () =>
    request<{ cancelled_subscriptions: number; expired_payments: number; showroom_id: string }>(
      api.delete('/subscriptions/request')
    ),
};

// ── F4 — tenant staff management (OWNER self-service) ─────────
export interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'STAFF';
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  profile_id?: string | null;
}

export const usersApi = {
  list: (p?: ListParams & { role?: 'OWNER' | 'STAFF'; is_active?: 'true' | 'false' }) =>
    requestPaginated<TenantUser>(api.get('/users', { params: p })),
  create: (d: { name: string; email: string; password: string; role?: 'STAFF' }) =>
    request<TenantUser>(api.post('/users', d)),
  toggle: (id: string, is_active: boolean) =>
    request<TenantUser>(api.patch(`/users/${id}`, { is_active })),
};

// FIX: globalSearch was typed as { inventory: InventoryItem[]; customers:
// Customer[]; sales: Sale[]; suppliers: Supplier[] } — wrong on every
// level. Confirmed against search.service.js's globalSearch: the real
// envelope.data is { query, total_results, results: { inventory: {
// count, items, type, route }, ... } } — a different top-level shape
// (results.X, not X directly), AND each `items` array holds a trimmed
// `select` subset, never a full InventoryItem/Customer/Supplier/Sale.
export interface SearchResultGroup<T> {
  count: number;
  items: T[];
  type: string;
  route: string;
}

export interface GlobalSearchResponse {
  query: string;
  total_results: number;
  results: {
    inventory: SearchResultGroup<{
      id: string; brand: string; model: string; vehicle_type: string;
      color: string; status: string; selling_price: number; quantity: number;
    }>;
    customers: SearchResultGroup<{
      id: string; name: string; phone: string;
      national_id: string | null; address: string | null;
    }>;
    suppliers: SearchResultGroup<{
      id: string; name: string; phone: string; email: string | null;
      total_due: number; total_paid: number;
    }>;
    sales: SearchResultGroup<{
      id: string; invoice_number: string; sale_type: string; status: string;
      total: number; sold_at: string;
      customer: { name: string; phone: string } | null;
    }>;
  };
}

export const searchApi = {
  globalSearch: (q: string) => request<GlobalSearchResponse>(
    api.get('/search', { params: { q } })
  ),
};

export const activityApi = {
  getAll:           (p?: ListParams & { entity?: string; action?: string }) =>
    requestPaginated<ActivityLogEntry[]>(api.get('/activity', { params: p })),
  // getFilters: confirmed correct against activity.controller.js's
  // getFilters / activity.service.js's getDistinctActions+Entities —
  // both return plain string arrays, exactly as typed below.
  getFilters: () => request<{ actions: string[]; entities: string[] }>(api.get('/activity/filters')),
  // FIX: getSummary was a guess that didn't match activity.service.js's
  // getActivitySummary at all — real shape has `period`, `by_action` as
  // an array of { action, count } (not a Record), and `by_user` (not
  // `by_entity`) as an array of { user, count }. Currently unused by
  // any page reviewed so far, but fixing now while confirmed.
  getSummary: () => request<{
    period: string;
    total: number;
    by_action: { action: string; count: number }[];
    by_user: { user: { id: string; name: string; role: string } | { id: string }; count: number }[];
  }>(api.get('/activity/summary')),
  getEntityHistory: (entity: string, id: string) =>
    request<ActivityLogEntry[]>(api.get(`/activity/${entity}/${id}`)),
};

// FIX: both endpoints below were wrong. Confirmed against
// onboarding.controller.js:
// - getStatus() was typed { completed, step } — the real
//   getOnboardingStatus returns { is_onboarded, showroom_id,
//   showroom_name, logo_url, next_step }, no `completed`/`step`
//   fields exist at all.
// - complete() was typed request<null> — onboardShowroom actually
//   returns the full updated showroom row (via its Prisma `select`),
//   never null.
export interface OnboardingStatus {
  is_onboarded: boolean;
  showroom_id: string;
  showroom_name: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  next_step: 'dashboard' | 'onboarding_wizard';
}

export interface OnboardedShowroom {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  is_onboarded: boolean;
  is_active: boolean;
  license_expiry: string;
}

export const onboardingApi = {
  getStatus: () => request<OnboardingStatus>(api.get('/onboarding/status')),
  complete:  (d: Payload) => request<OnboardedShowroom>(api.patch('/onboarding', d)),
};

// ─────────────────────────────────────────────────────────────
// SUPERADMIN TYPES
// Matrix Audit (Priority 2): added to replace the inline types
// that were duplicated inside superadmin/users/page.tsx
// ─────────────────────────────────────────────────────────────
export interface SuperAdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  avatar_url?: string;
  last_login?: string;
  created_at: string;
  showroom?: Pick<Showroom, 'id' | 'name' | 'slug' | 'is_active'>;
}

export interface SuperAdminUserParams extends ListParams {
  role?: UserRole | '';
  is_active?: 'true' | 'false' | '';
  showroom_id?: string;
}

export interface ResetPasswordResult {
  temp_password?: string;
}

// FP-07: shape confirmed against superadmin.controller.js's
// getPendingResetRequests — these are raw AuditLog rows (action:
// 'PASSWORD_RESET_REQUESTED'), not a dedicated request table. The
// backend has no separate "deny" endpoint — the only action available
// is reusing POST /superadmin/reset-user-password on the target user.
// ASSUMPTION: `new_data` is typed here matching this project's
// consistent snake_case Prisma column naming (showroom_id, is_active,
// etc. throughout every other model) — not confirmed against
// schema.prisma directly.
export interface PasswordResetRequest {
  id:         string;
  created_at: string;
  showroom:   Pick<Showroom, 'id' | 'name'> | null;
  user:       Pick<SuperAdminUser, 'id' | 'name' | 'email' | 'role' | 'is_active'> | null;
  new_data:   { email: string; name: string; requested_at: string; status: string } | null;
}

// Matrix Audit (#9 — Impersonation): shape returned by
// POST /superadmin/showrooms/:id/impersonate. `showroom` mirrors
// ShowroomInfo (see @/lib/auth) exactly so the response can be fed
// directly into startImpersonation() without reshaping/guessing any
// field — backend's impersonateShowroom controller selects this
// exact set.
export interface ImpersonationResult {
  accessToken: string;
  showroom: {
    id: string; name: string; slug: string;
    logo_url: string | null; license_expiry: string;
    is_active: boolean; is_onboarded: boolean;
  };
  user: { id: string; name: string; email: string; role: 'OWNER' | 'STAFF' };
}

// ─────────────────────────────────────────────────────────────
// SUPERADMIN API
// Matrix Audit (Priority 2): was using raw fetch() with manual
// token injection in superadmin/users/page.tsx — bypassing
// Axios interceptors (no 401 refresh, no unified error handling).
// All superadmin API calls now go through the same request/
// requestPaginated helpers as every other section of the app.
// ─────────────────────────────────────────────────────────────
export const superAdminApi = {
  // Users
  getUsers: (p?: SuperAdminUserParams) =>
    requestPaginated<SuperAdminUser[]>(api.get('/superadmin/users', { params: p })),

  getUserById: (id: string) =>
    request<SuperAdminUser>(api.get(`/superadmin/users/${id}`)),

  createUser: (d: Payload) =>
    request<SuperAdminUser>(api.post('/superadmin/users', d)),

  updateUser: (id: string, d: Payload) =>
    request<SuperAdminUser>(api.patch(`/superadmin/users/${id}`, d)),

  resetUserPassword: (d: { user_id: string; new_password?: string }) =>
    request<ResetPasswordResult>(api.post('/superadmin/reset-user-password', d)),

  // FP-07: existed on the backend with no frontend caller at all.
  getPasswordResetRequests: (p?: ListParams) =>
    requestPaginated<PasswordResetRequest[]>(api.get('/superadmin/password-reset-requests', { params: p })),

  // Showrooms list (for dropdowns — uses /superadmin/showrooms)
  getShowroomsForSelect: (limit = 100) =>
    requestPaginated<Pick<Showroom, 'id' | 'name' | 'slug' | 'is_active'>[]>(
      api.get('/superadmin/showrooms', { params: { limit } })
    ),

  // Matrix Audit (#9 — Impersonation)
  impersonateShowroom: (id: string) =>
    request<ImpersonationResult>(api.post(`/superadmin/showrooms/${id}/impersonate`)),
};

// ═════════════════════════════════════════════════════════════
// PHASE 2 — PLATFORM ADMINISTRATION (Delegated Administrators)
// Surface: /api/v1/admin — router-wide requireScope('GLOBAL') +
// per-route requirePermission('platform_*', 'GLOBAL'). These types
// mirror backend/src/controllers/admin.controller.js shapes.
// ═════════════════════════════════════════════════════════════
export interface PlatformGrant {
  permission: string;
  scope: 'SHOWROOM' | 'GLOBAL';
}

export interface AdminProfile {
  id: string;
  name: string;
  description: string | null;
  scope: 'SHOWROOM' | 'GLOBAL';
  is_system: boolean;
  in_use: number;
  created_at: string;
  updated_at: string;
  permissions: PlatformGrant[];
}

export interface Administrator {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  avatar_url?: string;
  last_login?: string;
  created_at: string;
  profile: { id: string; name: string; scope: string; is_system: boolean } | null;
  showroom?: Pick<Showroom, 'id' | 'name' | 'slug'> | null;
}

export interface ProfilePayload {
  name?: string;
  description?: string | null;
  scope?: 'SHOWROOM' | 'GLOBAL';
  permissions?: PlatformGrant[];
  granted?: PlatformGrant[];
  revoked?: PlatformGrant[];
}

export interface CreateAdministratorPayload {
  name: string;
  email: string;
  password: string;
  profile_id: string;
}

export interface AdminResetResult {
  user_id: string;
  name: string;
  email: string;
  showroom: string | null;
  profile_id: string | null;
  temp_password?: string;
  tokens_revoked: boolean;
}

export interface PlatformShowroom {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  is_onboarded: boolean;
  license_expiry: string;
  created_at: string;
  _count: { users: number; inventory: number; sales: number; customers: number; suppliers: number };
  license_health: {
    is_expired: boolean;
    days_left: number;
    status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'INACTIVE';
  };
}

// Phase 3 — Platform audit surface (/api/v1/admin/audit/*).
// Same row shape as ActivityLogEntry (both are the AuditLog model)
// plus the joined showroom. Redaction (national_id/phone) is applied
// server-side for delegated viewers; SA receives raw payloads.
export interface AuditEvent extends ActivityLogEntry {
  showroom?: { id: string; name: string } | null;
}

export interface AuditFilters {
  actions: string[];
  entities: string[];
}

export interface AuditParams extends ListParams {
  entity?: string;
  action?: string;
  user_id?: string;
  showroom_id?: string;
  entity_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface AdminParams extends ListParams {
  is_active?: 'true' | 'false' | '';
}

export const adminApi = {
  // ── Profiles ────────────────────────────────────────────────
  getProfiles: (p?: ListParams) =>
    requestPaginated<AdminProfile[]>(api.get('/admin/profiles', { params: p })),

  createProfile: (d: ProfilePayload) =>
    request<AdminProfile>(api.post('/admin/profiles', d)),

  updateProfile: (id: string, d: ProfilePayload) =>
    request<AdminProfile>(api.patch(`/admin/profiles/${id}`, d)),

  deleteProfile: (id: string) =>
    request<{ id: string; name: string }>(api.delete(`/admin/profiles/${id}`)),

  // ── Administrators ──────────────────────────────────────────
  getAdministrators: (p?: AdminParams) =>
    requestPaginated<Administrator[]>(api.get('/admin/administrators', { params: p })),

  createAdministrator: (d: CreateAdministratorPayload) =>
    request<Administrator>(api.post('/admin/administrators', d)),

  updateAdministrator: (id: string, d: { name?: string; is_active?: boolean; profile_id?: string }) =>
    request<Administrator>(api.patch(`/admin/administrators/${id}`, d)),

  resetAdministratorPassword: (id: string, newPassword?: string) =>
    request<AdminResetResult>(api.post(`/admin/administrators/${id}/reset-password`, { new_password: newPassword })),

  // ── Read surfaces (reused superadmin handlers) ──────────────
  getUsers: (p?: SuperAdminUserParams) =>
    requestPaginated<SuperAdminUser[]>(api.get('/admin/users', { params: p })),

  getShowrooms: (p?: ListParams) =>
    requestPaginated<PlatformShowroom[]>(api.get('/admin/showrooms', { params: p })),

  // ── Audit & observability (Phase 3) ────────────────────────
  getAuditEvents: (p?: AuditParams) =>
    requestPaginated<AuditEvent[]>(api.get('/admin/audit/events', { params: p })),

  getAuditFilters: () =>
    request<AuditFilters>(api.get('/admin/audit/filters')),

  getAuditEvent: (id: string) =>
    request<AuditEvent>(api.get(`/admin/audit/${id}`)),

  // ── Subscription / payment review (Phase 4 commerce) ─────────
  // Confirmed against lifecycle.service.js shapes + admin.routes.js.
  getPlatformSubscriptions: (p?: AuditParams & { status?: string; expiring_in?: number }) =>
    requestPaginated<Subscription[]>(api.get('/admin/subscriptions', { params: p })),

  getSubscriptionHealth: () =>
    request<PlatformSubscriptionSummary>(api.get('/admin/subscriptions/summary')),

  getPlatformPayments: (p?: ListParams & { status?: string; showroom_id?: string; search?: string }) =>
    requestPaginated<PaymentRecord[]>(api.get('/admin/payments', { params: p })),

  getPlatformPayment: (id: string) =>
    request<PaymentRecord>(api.get(`/admin/payments/${id}`)),

  approvePayment: (id: string, reason?: string) =>
    request<{
      subscription: Subscription;
      payment_id: string;
      showroom_id: string;
      new_expiry: string;
      users_limit: number | null;
      showroom_name: string;
    }>(api.post(`/admin/payments/${id}/approve`, { reason })),

  rejectPayment: (id: string, reason: string) =>
    request<{ payment_id: string; showroom_id: string; plan_name: string | null; subscription_cancelled: boolean }>(
      api.post(`/admin/payments/${id}/reject`, { reason })
    ),
};
