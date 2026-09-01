'use client';

// ============================================================
// YS-MATRIX ERP — Payment Review Page (Phase 4/5)
// Route: /admin/payments (platform admins — GLOBAL scope only)
//
// Review surface for the manual-payment commerce flow:
//   • Filterable list (status / search / pagination)
//   • Detail modal with the stored proof image
//     (data:<mime>;base64,<proof_data> — never URL-loaded)
//   • Approve → activates the subscription via the canonical path
//   • Reject → requires a reason (safe text, shown to customer)
// Tenant users never reach here: middleware + requirePermission
// (platform_payment:*) gate the API; /admin/* is dashboard-route
// guarded as well.
// ============================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Loader2, Search, RefreshCw, CheckCircle2, XCircle,
  Eye, ChevronRight, ChevronLeft, FileText, Image as ImageIcon,
  ShieldCheck, ShieldX, Wallet, Calendar, Landmark, CreditCard,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  adminApi,
  isApiRequestError,
  type PaymentRecord,
} from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

// ─── status config ──────────────────────────────────────────────
const STATUS_CFG: Record<PaymentRecord['status'], { label: string; badge: string }> = {
  PENDING:  { label: 'قيد المراجعة', badge: 'badge-amber' },
  PAID:     { label: 'مقبول',        badge: 'badge-green' },
  REJECTED: { label: 'مرفوض',        badge: 'badge-red'   },
  FAILED:   { label: 'فاشل',         badge: 'badge-red'   },
  EXPIRED:  { label: 'منتهي',        badge: 'badge-red'   },
  REFUNDED: { label: 'مسترجع',       badge: 'badge-cyan'  },
};

const getErr = (err: unknown): string =>
  isApiRequestError(err) ? err.message : 'فشل تنفيذ العملية';

// ─── Detail modal (proof evidence + actions) ─────────────────────
function PaymentModal({
  paymentId,
  onClose,
}: {
  paymentId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const { data: payment, isLoading } = useQuery({
    queryKey: ['admin-payment', paymentId],
    queryFn:  () => adminApi.getPlatformPayment(paymentId),
  });

  const approveMut = useMutation({
    mutationFn: () => adminApi.approvePayment(paymentId, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('تم تفعيل الاشتراك — صار المعرض نشطاً');
      qc.invalidateQueries({ queryKey: ['admin-payments'] });
      qc.invalidateQueries({ queryKey: ['admin-sub-health'] });
      onClose();
    },
    onError: (err: unknown) => toast.error(getErr(err)),
  });

  const rejectMut = useMutation({
    mutationFn: () => adminApi.rejectPayment(paymentId, reason.trim()),
    onSuccess: () => {
      toast.success('تم رفض الدفعة وإلغاء الطلب');
      qc.invalidateQueries({ queryKey: ['admin-payments'] });
      qc.invalidateQueries({ queryKey: ['admin-sub-health'] });
      onClose();
    },
    onError: (err: unknown) => toast.error(getErr(err)),
  });

  const handleReject = () => {
    if (reason.trim().length < 3) {
      toast.error('سبب الرفض مطلوب (3 أحرف على الأقل)');
      return;
    }
    rejectMut.mutate();
  };

  const cfg = payment ? (STATUS_CFG[payment.status] ?? STATUS_CFG.PENDING) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        className="w-full max-w-lg matrix-panel border border-matrix-border my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-matrix-border flex items-center justify-between sticky top-0 bg-matrix-dark z-10">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-matrix-cyan" />
            <span className="text-sm font-mono font-semibold text-matrix-text">تفاصيل الدفعة</span>
            {cfg && <span className={cn('badge text-[10px]', cfg.badge)}>{cfg.label}</span>}
          </div>
          <button onClick={onClose} className="text-matrix-subtle hover:text-matrix-red transition-colors text-lg leading-none">×</button>
        </div>

        {isLoading || !payment ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-matrix-cyan" /></div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Showroom */}
            <div className="p-3 rounded-lg bg-matrix-dark border border-matrix-border/50">
              <p className="text-xs font-semibold text-matrix-text">{payment.showroom?.name ?? '—'}</p>
              <p className="text-[10px] font-mono text-matrix-subtle mt-0.5">
                {payment.showroom?.slug ?? payment.showroom_id} · {payment.showroom?.email ?? '—'}
              </p>
            </div>

            {/* Amount + plan */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border border-matrix-border/50">
                <p className="text-[10px] font-mono text-matrix-subtle mb-1">المبلغ</p>
                <p className="text-sm font-mono font-bold text-matrix-green">
                  {formatCurrency(payment.amount)} <span className="text-matrix-subtle text-[10px]">{payment.currency}</span>
                </p>
              </div>
              <div className="p-3 rounded-lg border border-matrix-border/50">
                <p className="text-[10px] font-mono text-matrix-subtle mb-1">الباقة</p>
                <span className="badge-cyan text-[10px]">{payment.plan_name}</span>
              </div>
            </div>

            {/* Meta */}
            <div className="space-y-1.5 text-[11px]">
              <p className="flex items-center gap-2 font-mono text-matrix-subtle">
                <CreditCard className="w-3.5 h-3.5" /> طريقة الدفع: <span className="text-matrix-text">{payment.method}</span>
              </p>
              <p className="flex items-center gap-2 font-mono text-matrix-subtle">
                <Landmark className="w-3.5 h-3.5" /> المرجع: <span className="text-matrix-text" dir="ltr">{payment.reference || '—'}</span>
              </p>
              <p className="flex items-center gap-2 font-mono text-matrix-subtle">
                <Calendar className="w-3.5 h-3.5" /> التاريخ: <span className="text-matrix-text">{formatDate(payment.created_at)}</span>
              </p>
              {payment.reviewer && (
                <p className="flex items-center gap-2 font-mono text-matrix-subtle">
                  <ShieldCheck className="w-3.5 h-3.5" /> المراجع: <span className="text-matrix-text">{payment.reviewer.name}</span>
                </p>
              )}
            </div>

            {/* Proof image — data URI only, never a remote URL */}
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">إثبات الدفع</p>
              {payment.proof_data && payment.proof_mime ? (
                <div className="rounded-lg border border-matrix-border overflow-hidden bg-matrix-dark">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${payment.proof_mime};base64,${payment.proof_data}`}
                    alt="إثبات الدفع"
                    className="w-full max-h-72 object-contain"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-matrix-border text-matrix-subtle text-xs">
                  <ImageIcon className="w-4 h-4" />
                  لم يتم إرفاق إثبات دفع بعد
                </div>
              )}
            </div>

            {payment.rejection_reason && (
              <div className="p-3 rounded-lg border border-matrix-red/25 bg-matrix-red/5 flex items-start gap-2">
                <ShieldX className="w-4 h-4 text-matrix-red shrink-0 mt-0.5" />
                <p className="text-xs text-matrix-text">سبب الرفض: <span className="font-mono text-matrix-red">{payment.rejection_reason}</span></p>
              </div>
            )}

            {/* Actions — only while PENDING */}
            {payment.status === 'PENDING' && (
              <div className="space-y-3 pt-2 border-t border-matrix-border">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
                    سبب الرفض (إلزامي عند الرفض — يظهر للعميل)
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    className="matrix-input text-xs w-full resize-none"
                    placeholder="مثال: قيمة التحويل لا تطابق مبلغ الباقة"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => approveMut.mutate()}
                    disabled={approveMut.isPending || rejectMut.isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-matrix-green bg-matrix-green/10 text-matrix-green text-xs font-mono hover:bg-matrix-green/20 transition-all disabled:opacity-40"
                  >
                    {approveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    اعتماد وتفعيل
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={approveMut.isPending || rejectMut.isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-matrix-red bg-matrix-red/10 text-matrix-red text-xs font-mono hover:bg-matrix-red/20 transition-all disabled:opacity-40"
                  >
                    {rejectMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                    رفض الدفعة
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────
export default function AdminPaymentsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-payments', { page, search, status: statusFilter }],
    queryFn:  () =>
      adminApi.getPlatformPayments({
        page, limit: 20,
        search: search || undefined,
        status: statusFilter || undefined,
      }),
  });

  const payments = data?.data ?? [];
  const pagination = data?.pagination ?? { total: 0, pages: 1, page: 1, limit: 20, hasNext: false, hasPrev: false };

  return (
    <DashboardLayout title="مراجعة المدفوعات">
      <div className="space-y-5">
        {/* ── Platform badge ── */}
        <div className="flex items-center gap-3 p-4 rounded-xl border border-matrix-purple/30 bg-matrix-purple/5">
          <ShieldCheck className="w-5 h-5 text-matrix-purple shrink-0" />
          <p className="text-xs text-matrix-subtle">
            منصة الإدارة — مراجعة دفعات الاشتراكات لجميع المعارض. إثبات الدفع يُعرض داخل تفاصيل كل دفعة فقط.
          </p>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-matrix-subtle" />
            <input
              type="text"
              placeholder="بحث باسم المعرض..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="matrix-input pr-9 text-xs w-full"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="matrix-input text-xs min-w-[160px]"
          >
            <option value="">كل الحالات</option>
            <option value="PENDING">قيد المراجعة</option>
            <option value="PAID">مقبولة</option>
            <option value="REJECTED">مرفوضة</option>
          </select>
          <button
            onClick={() => refetch()}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* ── Table ── */}
        <div className="matrix-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[560px] w-full text-right">
              <thead>
                <tr className="border-b border-matrix-border/70">
                  {['المعرض', 'الباقة', 'المبلغ', 'التاريخ', 'الحالة', 'المرجع', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-matrix-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <Loader2 className="w-6 h-6 animate-spin text-matrix-cyan mx-auto" />
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-matrix-subtle text-xs font-mono">
                      لا توجد مدفوعات مطابقة
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => {
                    const cfg = STATUS_CFG[p.status] ?? STATUS_CFG.PENDING;
                    return (
                      <motion.tr
                        key={p.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="border-b border-matrix-border/40 hover:bg-matrix-cyan/[0.02] transition-colors cursor-pointer"
                        onClick={() => setDetailId(p.id)}
                      >
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold text-matrix-text">{p.showroom?.name ?? '—'}</p>
                          <p className="text-[10px] font-mono text-matrix-subtle mt-0.5">{p.showroom?.slug ?? p.showroom_id}</p>
                        </td>
                        <td className="px-4 py-3"><span className="badge-cyan text-[10px]">{p.plan_name}</span></td>
                        <td className="px-4 py-3 text-xs font-mono font-semibold text-matrix-text">
                          {formatCurrency(p.amount)} <span className="text-matrix-subtle text-[10px]">{p.currency}</span>
                        </td>
                        <td className="px-4 py-3 text-[10px] font-mono text-matrix-subtle">{formatDate(p.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={cn('badge text-[10px]', cfg.badge)}>{cfg.label}</span>
                        </td>
                        <td className="px-4 py-3 text-[10px] font-mono text-matrix-subtle" dir="ltr">{p.reference || '—'}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDetailId(p.id); }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-matrix-cyan/30 text-matrix-cyan text-[10px] font-mono hover:bg-matrix-cyan/10 transition-all"
                          >
                            <Eye className="w-3 h-3" />
                            {p.status === 'PENDING' ? 'مراجعة' : 'عرض'}
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-matrix-border/50">
              <span className="text-[10px] font-mono text-matrix-subtle">{pagination.total} دفعة</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center justify-center w-7 h-7 rounded border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all disabled:opacity-30"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono text-matrix-subtle px-1">{page}/{pagination.pages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                  disabled={page === pagination.pages}
                  className="flex items-center justify-center w-7 h-7 rounded border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all disabled:opacity-30"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Detail modal ── */}
        <AnimatePresence>
          {detailId && (
            <PaymentModal paymentId={detailId} onClose={() => setDetailId(null)} />
          )}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  );
}