'use client';

// ============================================================
// YS-MATRIX ERP — useCustomers Hook (V2 — full CRM + picker)
//
// Two query keys, deliberately kept separate:
//   - ['customers-picker', ...] — lightweight search used by
//     SaleCreateModal (unchanged behavior from the original stub).
//   - ['customers', ...]        — full paginated list used by
//     customers/page.tsx, including is_active filtering.
// Sharing one key between a 20-row quick-search and a paginated
// CRM table would mean either view's cache invalidation stomps on
// the other's, so they're intentionally isolated.
//
// IMPORTANT: deactivateCustomer/reactivateCustomer are OWNER-ONLY
// on the backend (see customer.routes.js: both routes use
// `ownerOnly` middleware). A STAFF user calling these will get a
// 403 from the API — the hook surfaces that via the normal
// ApiRequestError path; UI-level role-hiding of the buttons is
// handled in the page component, not here.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi, isApiRequestError, type ListParams, type Payload } from '@/lib/api';
import toast from 'react-hot-toast';

function errMessage(err: unknown, fallback: string): string {
  return isApiRequestError(err) ? err.message : fallback;
}

// ─── Picker (sales modal) — unchanged from the original stub ──
export function useCustomers(params?: ListParams) {
  return useQuery({
    queryKey: ['customers-picker', params],
    queryFn:  () => customersApi.getAll(params),
  });
}

// ─── Full list (CRM page) ──────────────────────────────────────
// include_inactive controls whether deactivated customers are
// included server-side (customer.service.js: `if (include_inactive
// !== 'true') where.is_active = true`). The CRM page passes this
// explicitly rather than relying on the backend default, so the
// active-customers view and the inactive-customers view are both
// deliberate, readable query states — not one view silently
// reusing the other's default.
export function useCustomerList(params?: ListParams & { include_inactive?: string }) {
  return useQuery({
    queryKey: ['customers', params],
    queryFn:  () => customersApi.getAll(params),
  });
}

// ─── Single customer (detail view — includes last 10 sales) ────
export function useCustomer(id: string) {
  return useQuery({
    queryKey: ['customers', id],
    queryFn:  () => customersApi.getOne(id),
    enabled:  !!id,
  });
}

// ─── Create ──────────────────────────────────────────────────
export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Payload) => customersApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers-picker'] });
      toast.success('تم إضافة العميل بنجاح');
    },
    onError: (err: unknown) => toast.error(errMessage(err, 'فشل إضافة العميل')),
  });
}

// ─── Update ──────────────────────────────────────────────────
export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Payload }) => customersApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers-picker'] });
      toast.success('تم تحديث بيانات العميل');
    },
    onError: (err: unknown) => toast.error(errMessage(err, 'فشل تحديث البيانات')),
  });
}

// ─── Deactivate (soft delete) ───────────────────────────────────
// NOT a real delete. Backend only flips is_active: false. Naming
// this `deactivate` rather than `remove`/`delete` so call sites
// (and the toast message) are honest about what actually happens —
// the row stays, the customer just stops showing in the default
// active-only list and gains a path back via reactivate.
export function useDeactivateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers-picker'] });
      toast.success('تم تعطيل العميل — يمكن إعادة تفعيله في أي وقت من صفحة العملاء المعطلين');
    },
    onError: (err: unknown) => toast.error(errMessage(err, 'فشل تعطيل العميل')),
  });
}

// ─── Reactivate ──────────────────────────────────────────────
export function useReactivateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.reactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers-picker'] });
      toast.success('تم إعادة تفعيل العميل بنجاح');
    },
    onError: (err: unknown) => toast.error(errMessage(err, 'فشل إعادة التفعيل')),
  });
}
