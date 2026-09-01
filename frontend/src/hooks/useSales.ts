'use client';

// ============================================================
// YS-MATRIX ERP — useSales Hook (Phase 3 Stage 1, V2)
//
// V2 CHANGES vs original:
//   - salesApi.getAll(...) now resolves DIRECTLY to Paginated<Sale>
//     (i.e. { data, pagination }) — removed the `.then((r) => r.data)`
//     that was unwrapping an AxiosResponse that no longer exists.
//   - salesApi.getById(...) now resolves directly to Sale — removed
//     `.then((r) => r.data.data)`.
//   - Error handling now uses isApiRequestError(err) + err.message
//     instead of manually reaching into err?.response?.data?.message,
//     since lib/api.ts now throws a typed ApiRequestError uniformly.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, isApiRequestError } from '@/lib/api';
import type { CreateSalePayload } from '@/types/sale.types';
import toast from 'react-hot-toast';

function errMessage(err: unknown, fallback: string): string {
  return isApiRequestError(err) ? err.message : fallback;
}

// ─── List ────────────────────────────────────────────────────
// NOTE: param is `sale_type` (CASH | INSTALLMENT), matching both
// api.ts's SaleListParams and what sales.service.js's listSales()
// actually reads from the query string. The original hook used
// `payment_type`, which the backend never read — that filter would
// have silently done nothing.
export function useSales(params?: {
  page?:      number;
  limit?:     number;
  status?:    string;
  sale_type?: string;
  search?:    string;
  range?:     'today' | 'week' | 'month' | 'year';
}) {
  return useQuery({
    queryKey: ['sales', params],
    queryFn:  () => salesApi.getAll(params),
  });
}

// ─── Single ──────────────────────────────────────────────────
export function useSale(id: string) {
  return useQuery({
    queryKey:  ['sales', id],
    queryFn:   () => salesApi.getById(id),
    enabled:   !!id,
  });
}

// ─── Summary (global business aggregates) ──────────────────────
// Dedicated query, deliberately separate from useSales() above.
// salesApi.getSummary() reads ALL sales matching the date range
// server-side (prisma.sale.aggregate / groupBy) — it does NOT
// depend on which table page or filters the user currently has
// selected. Mixing this into useSales() would make dashboard
// numbers silently change based on pagination/search state, which
// is exactly the bug we're avoiding here.
export function useSalesSummary(range?: 'today' | 'week' | 'month' | 'year') {
  return useQuery({
    queryKey: ['sales-summary', range],
    queryFn:  () => salesApi.getSummary(range ? { range } : undefined),
  });
}

// ─── Overdue installment count ──────────────────────────────────
// getSalesSummary() does NOT include an overdue count — overdue
// installments are tracked by a separate service method
// (getOverdueInstallments) with its own filter (due_date < now,
// is_paid: false), unrelated to sale.status. Rather than fetch the
// full overdue list just to count it, we ask for limit: 1 and read
// pagination.total — the backend already computes that count via
// prisma.installment.count(), so this stays a single cheap query
// instead of pulling every overdue row to the client.
export function useOverdueInstallmentCount() {
  return useQuery({
    queryKey: ['sales-overdue-count'],
    queryFn:  () => salesApi.getOverdue({ limit: 1 }),
    select:   (res) => res.pagination.total,
  });
}

// ─── Create ──────────────────────────────────────────────────
export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSalePayload) => salesApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales-summary'] });
      qc.invalidateQueries({ queryKey: ['sales-overdue-count'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inv-stats'] });
      qc.invalidateQueries({ queryKey: ['inv-low-stock'] });
      toast.success('تم إنشاء عملية البيع بنجاح');
    },
    onError: (err: unknown) => {
      toast.error(errMessage(err, 'فشل إنشاء عملية البيع'));
    },
  });
}

// ─── Cancel ──────────────────────────────────────────────────
// NOTE: the backend can now reject this with a CONFLICT specifically
// when recurring installments were already paid (sales.service.js v2).
// err.message already contains the full Arabic explanation in that
// case, so the toast below surfaces it directly — no separate
// error-code branching needed here.
export function useCancelSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => salesApi.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales-summary'] });
      qc.invalidateQueries({ queryKey: ['sales-overdue-count'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inv-stats'] });
      qc.invalidateQueries({ queryKey: ['inv-low-stock'] });
      toast.success('تم إلغاء عملية البيع واسترجاع المخزون');
    },
    onError: (err: unknown) => {
      toast.error(errMessage(err, 'فشل الإلغاء'));
    },
  });
}

// ─── Pay Installment ─────────────────────────────────────────
// CONSOLIDATED (Matrix Audit — Priority 1 + Priority 2, same fix):
//
// 1) URL fix lives in lib/api.ts — salesApi.payInstallment no longer
//    takes/sends a saleId segment at all (the real route is
//    PATCH /sales/installments/:installment_id/pay; sales.controller.js
//    never reads anything but installment_id). Because of that, this
//    hook's input is just the installment id — nothing about the
//    parent sale is needed for the network call itself.
//
// 2) Dedup fix: this hook existed but was never imported anywhere —
//    installments/page.tsx had its own inline useMutation duplicating
//    this exact operation, with a DIFFERENT and incomplete invalidation
//    set (['overdue'], ['upcoming'], ['kpis'] only — missing the
//    app-wide ['sales']/['sales-summary']/['sales-overdue-count'] this
//    hook already covered, and vice versa). That inline version is now
//    removed; this is the single implementation. The list below is the
//    UNION of both previous sets, so every screen that reads
//    installment/sale data refreshes correctly after a payment,
//    regardless of which page triggered it.
export function usePayInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ installmentId, note }: { installmentId: string; note?: string }) =>
      salesApi.payInstallment(installmentId, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales-summary'] });
      qc.invalidateQueries({ queryKey: ['sales-overdue-count'] });
      qc.invalidateQueries({ queryKey: ['overdue'] });
      qc.invalidateQueries({ queryKey: ['upcoming'] });
      qc.invalidateQueries({ queryKey: ['kpis'] });
      toast.success('تم تسجيل الدفعة بنجاح');
    },
    onError: (err: unknown) => {
      toast.error(errMessage(err, 'فشل تسجيل الدفعة'));
    },
  });
}
