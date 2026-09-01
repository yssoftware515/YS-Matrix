'use client';

// ============================================================
// YS-MATRIX ERP — Sales List Page (Phase 3 Stage 1, V2)
// Route: /dashboard/sales
//
// V2 CHANGES vs original:
//   - sale.total_price → sale.total (matches real Prisma field)
//   - Phase C.4 (FIN-1): sale.remaining_amount is now SERVER-computed
//     by listSales (sum of unpaid installments, database decimal math)
//     — the previous client-side getRemainingInstallmentAmount(sale)
//     helper stays only as a fallback for shapes without the field.
//   - filter param payment_type → sale_type (matches what the
//     backend's listSales() actually reads from the query string)
//   - cancel button: when the backend rejects cancellation because
//     recurring installments are already paid, the error message
//     (already in Arabic, from sales.service.js) is shown via a
//     dedicated inline banner on the row being cancelled — not just
//     a toast that disappears — so the reason stays visible while
//     the user decides what to do next.
//   - sale.inventoryItem → sale.items[0]?.inventory (matches the
//     real relation: a sale has MULTIPLE items via saleItem, not a
//     single inventoryItem; this page shows the first item + a
//     "+N more" indicator when there's more than one)
//   - Stat cards now use useSalesSummary() + useOverdueInstallmentCount()
//     — two GLOBAL queries independent of the table's pagination/
//     filters, replacing the earlier same-page approximation that
//     referenced a non-existent `data.stats` field.
// ============================================================

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, RefreshCw, Receipt,
  TrendingUp, XCircle, Loader2,
  ChevronLeft, ChevronRight, AlertTriangle, X,
} from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { useSales, useCancelSale, useSalesSummary, useOverdueInstallmentCount } from '@/hooks/useSales';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ListError } from '@/components/ui/ListError';
import {
  Sale, SALE_STATUS_CONFIG, PAYMENT_TYPE_CONFIG,
  getRemainingInstallmentAmount,
} from '@/types/sale.types';
import { isApiRequestError } from '@/lib/api';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import { SaleCreateModal } from '@/components/sales/SaleCreateModal';
import { SaleDetailDrawer } from '@/components/sales/SaleDetailDrawer';
import { Modal } from '@/components/ui/Modal';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

// ─── Stat Card ───────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, colorClass }: {
  label: string; value: string | number;
  icon: React.ElementType; colorClass: string;
}) {
  return (
    <div className="matrix-panel p-4 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border', colorClass)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-matrix-subtle">{label}</p>
        <p className="text-base font-bold font-mono text-matrix-text mt-0.5">{value}</p>
      </div>
    </div>
  );
}

// ─── Table Row ───────────────────────────────────────────────
function SaleRow({
  sale,
  onView,
  onCancel,
  cancelling,
  canCancel,
  cancelError,
  onDismissCancelError,
}: {
  sale: Sale;
  onView:                (s: Sale) => void;
  onCancel:               (id: string) => void;
  cancelling:             boolean;
  canCancel:              boolean;
  cancelError:            string | null;
  onDismissCancelError:   () => void;
}) {
  const statusCfg     = SALE_STATUS_CONFIG[sale.status];
  const paymentCfg    = PAYMENT_TYPE_CONFIG[sale.sale_type];
  const firstItem     = sale.items?.[0];
  const extraItems    = (sale.items?.length ?? 0) - 1;
  // Phase C.4 (FIN-1): prefer the server-computed remaining balance
  // (authoritative, exact decimal math from the database); fall back
  // to the client-side helper for shapes that don't carry the field
  // (e.g. single-sale detail views).
  const remainingAmt  = sale.remaining_amount ?? getRemainingInstallmentAmount(sale);

  // Phase C.3 (C3-4): native window.confirm replaced with the project's
  // Modal convention — copy states the real consequences: stock is
  // restored and the action is irreversible; paid installments block
  // cancellation (backend-enforced, warned here so the user isn't
  // surprised by the block).
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const confirmCancel = () => {
    setCancelConfirmOpen(false);
    onCancel(sale.id);
  };

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          'border-b border-matrix-border/50 transition-colors duration-150',
          'hover:bg-matrix-cyan/[0.025] cursor-pointer',
        )}
        onClick={() => onView(sale)}
      >
        {/* Invoice */}
        <td className="px-6 py-4">
          <span className="font-mono text-xs text-matrix-cyan">{sale.invoice_number}</span>
        </td>

        {/* Item */}
        <td className="px-6 py-4">
          <p className="text-xs text-matrix-text font-medium truncate max-w-[160px]">
            {firstItem?.inventory ? `${firstItem.inventory.brand} ${firstItem.inventory.model}` : '—'}
          </p>
          {extraItems > 0 && (
            <p className="text-[10px] text-matrix-subtle font-mono mt-0.5">+{extraItems} منتج آخر</p>
          )}
        </td>

        {/* Customer */}
        <td className="px-6 py-4">
          <p className="text-xs text-matrix-text">{sale.customer?.name ?? '—'}</p>
          {sale.customer?.phone && (
            <p className="text-[10px] text-matrix-subtle font-mono mt-0.5">{sale.customer.phone}</p>
          )}
        </td>

        {/* Amount */}
        <td className="px-6 py-4 text-right">
          <p className="text-xs font-mono font-semibold text-matrix-green">
            {formatCurrency(sale.total)}
          </p>
          {remainingAmt > 0 && (
            <p className="text-[10px] font-mono text-matrix-amber mt-0.5">
              متبقي: {formatCurrency(remainingAmt)}
            </p>
          )}
        </td>

        {/* Payment type */}
        <td className="px-6 py-4">
          <span className="text-[10px] font-mono text-matrix-subtle">
            {paymentCfg.icon} {paymentCfg.label}
          </span>
        </td>

        {/* Status */}
        <td className="px-6 py-4">
          <span className={cn('badge text-[10px]', statusCfg.badgeClass)}>
            {statusCfg.label}
          </span>
        </td>

        {/* Date */}
        <td className="px-6 py-4">
          <span className="text-[10px] font-mono text-matrix-subtle">{formatDate(sale.sold_at)}</span>
        </td>

        {/* Actions */}
        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
          {canCancel && sale.status === 'ACTIVE' && (
            <button
              onClick={() => setCancelConfirmOpen(true)}
              disabled={cancelling}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-matrix-red/30 text-matrix-red hover:bg-matrix-red/10 transition-all disabled:opacity-50"
            >
              {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
              إلغاء
            </button>
          )}
        </td>
      </motion.tr>

      {/* ── Cancel-blocked banner ─────────────────────────────────
          Shown as its own row directly under the sale it relates to,
          rather than a toast that disappears — the backend's CONFLICT
          message explains specifically WHY (e.g. "2 installments
          already collected"), and the user needs that to decide their
          next step (formal refund process), not just a passing alert. */}
      {cancelError && (
        <tr className="bg-matrix-red/5 border-b border-matrix-border/50">
          <td colSpan={8} className="px-6 py-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-matrix-red shrink-0 mt-0.5" />
                <p className="text-[11px] text-matrix-red leading-relaxed">{cancelError}</p>
              </div>
              <button onClick={onDismissCancelError} className="text-matrix-subtle hover:text-matrix-text shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </td>
        </tr>
      )}

      {/* Phase C.3 (C3-4): cancel confirmation modal — no native confirm */}
      <Modal
        open={cancelConfirmOpen}
        onClose={() => setCancelConfirmOpen(false)}
        title="إلغاء الفاتورة"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setCancelConfirmOpen(false)}
              className="px-4 py-2 min-h-[44px] rounded-lg border border-matrix-border text-xs font-mono text-matrix-subtle hover:text-matrix-text transition-all"
            >
              تراجع
            </button>
            <button
              onClick={confirmCancel}
              disabled={cancelling}
              className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg border border-matrix-red/40 text-xs font-mono text-matrix-red hover:bg-matrix-red/10 transition-all disabled:opacity-40"
            >
              {cancelling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              نعم، إلغاء الفاتورة
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-matrix-subtle">
          سيتم إلغاء الفاتورة <span className="font-mono text-matrix-text">{sale.invoice_number}</span> وإرجاع
          الكميات إلى المخزون. لا يمكن التراجع عن هذا الإجراء.
        </p>
        <p className="text-xs leading-relaxed text-matrix-amber mt-3">
          ملاحظة: الفاتورة التي عليها أقساط مدفوعة لا يمكن إلغاؤها.
        </p>
      </Modal>
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function SalesPage() {
  // Phase C.2 (STAFF-1): cancellation is an OWNER/SUPER_ADMIN action
  // (backend route is ownerOnly) — the UI must not offer it to STAFF.
  const { user } = useAuthStore();
  const canCancel = isOwnerPlus(user?.role);

  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter,   setTypeFilter]   = useState(''); // sale_type, not payment_type
  const [showCreate,   setShowCreate]   = useState(false);
  const [selected,     setSelected]     = useState<Sale | null>(null);

  // F6 — GlobalSearch deep-links land here as ?search= — prefill the
  // list search so the result row is on screen immediately.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) setSearch(q);
  }, []);

  // Tracks which sale (by id) is mid-cancel, and any blocked-cancel
  // error message to show inline under that specific row.
  const [cancellingId,  setCancellingId]  = useState<string | null>(null);
  const [cancelErrors,  setCancelErrors]  = useState<Record<string, string>>({});

  // Phase C.1 (5B): debounce the search box — a request per keystroke
  // becomes one per typing pause.
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isError, refetch } = useSales({
    page, limit: 15,
    status:    statusFilter || undefined,
    sale_type: typeFilter   || undefined,
    search:    debouncedSearch || undefined,
  });

  const cancelSale = useCancelSale();

  // V2 SHAPE: data resolves directly to Paginated<Sale> = { data, pagination }.
  // No more data?.data?.data or AxiosResponse unwrapping.
  const sales      = data?.data       ?? [];
  const pagination = data?.pagination ?? { total: 0, pages: 1, page: 1, limit: 15, hasNext: false, hasPrev: false };

  // ── Dashboard stat cards: GLOBAL aggregates, independent of the
  // paginated table above. These two queries reflect ALL sales
  // matching the date range server-side — they do not change when
  // the user changes table page/search/filters, and the table's
  // filters do not change them either. That separation is the whole
  // point: an enterprise dashboard's headline numbers must not
  // silently shift based on what page of the table happens to be open.
  const { data: summary, isLoading: summaryLoading } = useSalesSummary('month');
  const { data: overdueCount, isLoading: overdueLoading } = useOverdueInstallmentCount();

  const activeCount    = summary?.by_status.find((s) => s.status === 'ACTIVE')?._count    ?? 0;
  const cancelledCount = summary?.by_status.find((s) => s.status === 'CANCELLED')?._count  ?? 0;

  const handleCancel = (id: string) => {
    setCancellingId(id);
    setCancelErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });

    cancelSale.mutate(id, {
      onSettled: () => setCancellingId(null),
      onError: (err: unknown) => {
        const message = isApiRequestError(err) ? err.message : 'فشل الإلغاء';
        setCancelErrors((prev) => ({ ...prev, [id]: message }));
      },
    });
  };

  return (
    <DashboardLayout title="المبيعات">
    <div className="flex flex-col gap-6 min-h-0">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-widest uppercase font-mono text-matrix-text flex items-center gap-2">
            <Receipt className="w-5 h-5 text-matrix-cyan" />
            المبيعات
          </h1>
          <p className="text-xs text-matrix-subtle font-mono mt-1">
            {pagination.total} عملية بيع · الصفحة {page} من {pagination.pages}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="icon-btn" title="تحديث">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowCreate(true)} className="matrix-btn flex items-center gap-2">
            <Plus className="w-4 h-4" /> بيع جديد
          </button>
        </div>
      </div>

      {/* ── Stats — GLOBAL business aggregates (see useSalesSummary /
          useOverdueInstallmentCount above), independent of table state ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="إجمالي الإيرادات (هذا الشهر)"
          value={summaryLoading ? '...' : formatCurrency(summary?.total_revenue ?? 0)}
          icon={TrendingUp} colorClass="border-matrix-cyan/30 bg-matrix-cyan/5 text-matrix-cyan"
        />
        <StatCard
          label="نشطة"
          value={summaryLoading ? '...' : activeCount}
          icon={Receipt} colorClass="border-matrix-green/30 bg-matrix-green/5 text-matrix-green"
        />
        <StatCard
          label="أقساط متأخرة"
          value={overdueLoading ? '...' : (overdueCount ?? 0)}
          icon={AlertTriangle} colorClass="border-matrix-amber/30 bg-matrix-amber/5 text-matrix-amber"
        />
        <StatCard
          label="ملغية"
          value={summaryLoading ? '...' : cancelledCount}
          icon={XCircle} colorClass="border-matrix-red/30 bg-matrix-red/5 text-matrix-red"
        />
      </div>

      {/* ── Filters — consolidated into one compact filter-bar (was a
          loose flex-wrap row), matching inventory/page.tsx's treatment ── */}
      <div className="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-matrix-subtle" />
          <input
            type="text"
            placeholder="رقم الفاتورة، العميل..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="matrix-input pr-9 py-1.5 text-xs w-full border-transparent bg-transparent hover:border-matrix-border focus:bg-matrix-panel"
          />
        </div>

        <div className="w-px h-5 bg-matrix-border" />

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="filter-select min-w-[110px]"
        >
          <option value="">كل الحالات</option>
          <option value="ACTIVE">نشطة</option>
          <option value="COMPLETED">مكتملة</option>
          <option value="CANCELLED">ملغية</option>
        </select>

        <div className="w-px h-5 bg-matrix-border" />

        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="filter-select min-w-[110px]"
        >
          <option value="">كل أنواع الدفع</option>
          <option value="CASH">نقداً</option>
          <option value="INSTALLMENT">أقساط</option>
        </select>
      </div>

      {/* ── Table ──────────────────────────────────────────── */}
      {/* Phase C.1 (5A): a failed query must read as an error, not
          as an empty table. */}
      {isError ? (
        <ListError message="تعذر تحميل المبيعات" onRetry={() => refetch()} />
      ) : (
      <div className="matrix-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[560px] w-full text-right">
            <thead style={{ background: 'rgba(10,18,31,0.6)' }}>
              <tr className="border-b border-matrix-border/70">
                {['الفاتورة','المنتج','العميل','المبلغ','الدفع','الحالة','التاريخ',''].map((h) => (
                  <th key={h} className="px-6 py-4 text-[10px] font-mono uppercase tracking-widest text-matrix-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-matrix-cyan mx-auto" />
                  </td>
                </tr>
              ) : sales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-matrix-subtle text-xs font-mono">
                    لا توجد عمليات بيع
                  </td>
                </tr>
              ) : (
                sales.map((sale) => (
                  <SaleRow
                    key={sale.id}
                    sale={sale}
                    onView={setSelected}
                    onCancel={handleCancel}
                    cancelling={cancellingId === sale.id}
                    canCancel={canCancel}
                    cancelError={cancelErrors[sale.id] ?? null}
                    onDismissCancelError={() =>
                      setCancelErrors((prev) => { const next = { ...prev }; delete next[sale.id]; return next; })
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-matrix-border/50">
            <span className="text-[10px] font-mono text-matrix-subtle">{pagination.total} نتيجة</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="icon-btn disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-mono text-matrix-text px-2">{page} / {pagination.pages}</span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
                className="icon-btn disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Modals ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showCreate && <SaleCreateModal onClose={() => setShowCreate(false)} />}
        {selected && <SaleDetailDrawer sale={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
    </DashboardLayout>
  );
}
