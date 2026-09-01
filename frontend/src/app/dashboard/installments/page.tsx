'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, CheckCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { ListError } from '@/components/ui/ListError';
import { Modal } from '@/components/ui/Modal';
import { salesApi, type Installment } from '@/lib/api';
import { usePayInstallment } from '@/hooks/useSales';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { openPrintHTML } from '@/lib/print';

// FIX: this page had its own local `Inst` interface duplicating
// api.ts's `Installment` — but required `sale` as non-optional, while
// the real type has it as optional (only present when the backend
// query includes it). ignoreBuildErrors was masking the resulting
// type incompatibility. Same fix pattern as AuthUser/User and
// ActivityLog/ActivityLogEntry earlier in this project: import the
// real type instead of maintaining a second copy.

export default function InstallmentsPage() {
  const [tab,  setTab]  = useState<'overdue' | 'upcoming'>('overdue');
  const [page, setPage] = useState(1);

  // ── Track which installment ID is currently being paid ──────────────────────
  const [payingId, setPayingId] = useState<string | null>(null);

  // ── Track which installment's receipt is being fetched ──────────────────────
  const [receiptId, setReceiptId] = useState<string | null>(null);

  // Phase C.1 (4B): this page only ever lists UNPAID installments
  // (overdue/upcoming tabs), so the receipt action is effectively
  // unreachable here — it exists for parity with the paid row in the
  // sale drawer, where paid installments actually show up. Kept
  // conditional on is_paid so a future "paid" tab renders it.
  const handleReceipt = async (r: Installment) => {
    if (!r.is_paid) return;
    setReceiptId(r.id);
    try {
      await openPrintHTML(`/sales/installments/${r.id}/receipt`);
    } catch {
      toast.error('تعذر فتح الإيصال');
    } finally {
      setReceiptId(null);
    }
  };

  // ── Queries ──────────────────────────────────────────────────────────────────
  // FIX: getOverdue() already returns Paginated<Installment> ({ data,
  // pagination }) unwrapped — the old `.then((r) => r.data)` stripped
  // pagination off, breaking every `overdue?.pagination.*` read below.
  const { data: overdue, isLoading: ol, isError: overdueError, refetch: refetchOverdue } = useQuery({
    queryKey: ['overdue', page],
    queryFn: () => salesApi.getOverdue({ page, limit: 20 }),
  });
  // FIX: getUpcoming() returns Installment[] directly — NOT Paginated
  // (confirmed against sales.service.js:getUpcomingInstallments, which
  // returns a bare array with no { items, pagination } wrapper). The
  // old `.then((r) => r.data)` tried to read `.data` off an array,
  // which is always undefined — `upcoming` was always undefined.
  // Downstream reads of `upcoming.data` fixed below accordingly.
  const { data: upcoming, isLoading: ul, isError: upcomingError, refetch: refetchUpcoming } = useQuery({
    queryKey: ['upcoming'],
    queryFn: () => salesApi.getUpcoming({ days: 30 }),
  });

  // ── Mutation ─────────────────────────────────────────────────────────────────
  // CONSOLIDATED (Matrix Audit — Priority 1 + 2): this used to be its own
  // inline useMutation here, duplicating usePayInstallment in useSales.ts
  // with a DIFFERENT (and incomplete) invalidation set — see useSales.ts
  // for the full reasoning. It also used to pass `installment.sale!.id`
  // as a saleId segment that the backend never read; the URL fix in
  // lib/api.ts means the call below only needs installment.id now.
  //
  // setPayingId(null) is passed as a per-call onSettled (not baked into
  // the shared hook) because it's purely this page's row-highlight UI
  // state — the hook itself stays a plain data-mutation with no
  // knowledge of any particular screen's local state.
  const payMut = usePayInstallment();

  // ── Track which installment is pending payment confirmation ─────────────────
  const [payConfirmInst, setPayConfirmInst] = useState<Installment | null>(null);

  // ── Financial Confirmation Guard ──────────────────────────────────────────────
  // Phase C.3 (C3-4): native window.confirm replaced with the project's
  // Modal convention — same guard logic, same copy, plus an explicit
  // statement that the payment is recorded immediately and cannot be undone.
  const handlePay = (installment: Installment) => {
    // Prevent any action if a payment is already in-flight
    if (payMut.isPending) return;

    // Defensive: both endpoints feeding this page always include `sale`
    // in practice, but the type is honestly optional — bail out clearly
    // instead of letting a malformed row reach the mutation.
    if (!installment.sale) {
      toast.error('بيانات الفاتورة غير مكتملة لهذا القسط — تواصل مع الدعم.');
      return;
    }

    setPayConfirmInst(installment);
  };

  const confirmPay = () => {
    if (!payConfirmInst) return;
    const installmentId = payConfirmInst.id;
    setPayConfirmInst(null);
    setPayingId(installmentId);
    payMut.mutate(
      { installmentId },
      { onSettled: () => setPayingId(null) }
    );
  };

  // ── Helper: is a date overdue? ────────────────────────────────────────────────
  const isOverdue = (dateStr: string) => new Date(dateStr) < new Date();

  // ── Columns ───────────────────────────────────────────────────────────────────
  const cols: Column<Installment>[] = [
    {
      key: 'invoice', header: 'الفاتورة',
      render: (r) => (
        <span className="font-mono text-xs text-matrix-cyan">{r.sale?.invoice_number}</span>
      ),
    },
    {
      key: 'customer', header: 'العميل',
      render: (r) => (
        <div>
          <p className="text-sm">{r.sale?.customer?.name || 'بدون عميل'}</p>
          {r.sale?.customer?.phone && (
            <p className="text-xs text-matrix-subtle">{r.sale?.customer?.phone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'amount', header: 'مبلغ القسط',
      render: (r) => (
        <div className="flex items-center gap-2">
          {/* Neon pulse dot — only for overdue installments */}
          {isOverdue(r.due_date) && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-matrix-red opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-matrix-red" />
            </span>
          )}
          <span className="font-mono font-bold text-matrix-amber">
            {formatCurrency(r.amount)}
          </span>
        </div>
      ),
    },
    {
      key: 'due_date', header: 'تاريخ الاستحقاق',
      render: (r) => (
        <span className={cn(
          'text-xs font-mono',
          isOverdue(r.due_date) ? 'text-matrix-red' : 'text-matrix-subtle',
        )}>
          {formatDate(r.due_date)}
        </span>
      ),
    },
    {
      key: 'actions', header: '', align: 'center',
      render: (r) => {
        const isThisPaying  = payingId === r.id;
        const isAnyPaying   = payMut.isPending;
        const isThisReceipt = receiptId === r.id;

        if (r.is_paid) {
          return (
            <button
              onClick={() => handleReceipt(r)}
              disabled={isThisReceipt}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-matrix-cyan/40 text-matrix-cyan hover:bg-matrix-cyan/10 transition-all duration-200 min-w-[110px] justify-center disabled:opacity-40"
            >
              {isThisReceipt ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <CheckCircle className="w-3 h-3 shrink-0" />}
              إيصال السداد
            </button>
          );
        }

        return (
          <button
            onClick={() => handlePay(r)}
            disabled={isAnyPaying} // freeze ALL buttons during any pending
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-all duration-200 min-w-[110px] justify-center',
              isThisPaying
                ? 'border-matrix-cyan/40 bg-matrix-cyan/10 text-matrix-cyan cursor-not-allowed'
                : 'border-matrix-green/40 text-matrix-green hover:bg-matrix-green/10',
              isAnyPaying && !isThisPaying && 'opacity-40 cursor-not-allowed',
            )}
          >
            {isThisPaying ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                جاري التحصيل...
              </>
            ) : (
              <>
                <CheckCircle className="w-3 h-3 shrink-0" />
                تسجيل الدفعة
              </>
            )}
          </button>
        );
      },
    },
  ];

  // ── Totals ────────────────────────────────────────────────────────────────────
  // Phase C.6 (P1): the overdue total now comes from the SERVER — an exact
  // database aggregate over the full tenant overdue scope
  // (pagination.total_amount, added to GET /sales/overdue), replacing the
  // old client-side sum of the CURRENT PAGE's rows only, which silently
  // shrank as the page flipped. Same pattern as the C.4 EXP-2 expenses fix.
  // The upcoming list is a bare non-paginated array (full 30-day scope),
  // so its client-side sum is already complete.
  const overdueTotal  = overdue?.pagination?.total_amount ?? 0;
  const upcomingTotal = (upcoming       || []).reduce((s: number, i: Installment) => s + parseFloat(String(i.amount)), 0);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout title="الأقساط">
      <div className="space-y-5">

        {/* ── KPI Cards ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="أقساط متأخرة"
            value={overdue?.pagination?.total || 0}
            icon={<AlertTriangle className="w-5 h-5"/>}
            color="red"
            delay={0}
          />
          <KpiCard
            title="إجمالي المتأخرة"
            value={formatCurrency(overdueTotal)}
            icon={<AlertTriangle className="w-5 h-5"/>}
            color="red"
            delay={0.08}
          />
          <KpiCard
            title="قادمة (30 يوم)"
            value={upcoming?.length || 0}
            icon={<Clock className="w-5 h-5"/>}
            color="amber"
            delay={0.16}
          />
          <KpiCard
            title="إجمالي القادمة"
            value={formatCurrency(upcomingTotal)}
            icon={<Clock className="w-5 h-5"/>}
            color="amber"
            delay={0.24}
          />
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────── */}
        <div className="flex gap-3">
          {([
            { v: 'overdue',  l: 'الأقساط المتأخرة',  dot: true  },
            { v: 'upcoming', l: 'القادمة (30 يوم)',   dot: false },
          ] as const).map(({ v, l, dot }) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={cn(
                'relative flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-mono border transition-all duration-200',
                tab === v
                  ? 'border-matrix-cyan/50 bg-matrix-cyan/10 text-matrix-cyan'
                  : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan/30 hover:text-matrix-cyan',
              )}
              style={
                tab === v
                  ? { boxShadow: '0 0 12px rgba(0,212,255,0.08)' }
                  : undefined
              }
            >
              {/* Overdue alert pulse dot on the tab */}
              {dot && (overdue?.pagination?.total || 0) > 0 && (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-matrix-red opacity-70" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-matrix-red" />
                </span>
              )}
              {l}
            </button>
          ))}
        </div>

        {/* ── Tables ───────────────────────────────────────────────────── */}
        {tab === 'overdue' ? (
          overdueError ? (
            <ListError message="تعذر تحميل الأقساط المتأخرة" onRetry={() => refetchOverdue()} />
          ) : (
          <DataTable
            data={overdue?.data || []}
            columns={cols}
            loading={ol}
            rowKey={(r) => r.id}
            emptyText="لا توجد أقساط متأخرة ✓"
            pagination={
              overdue?.pagination
                ? {
                    page:  overdue.pagination.page,
                    pages: overdue.pagination.pages,
                    total: overdue.pagination.total,
                    limit: overdue.pagination.limit,
                    onPage: setPage,
                  }
                : undefined
            }
          />
          )
        ) : (
          upcomingError ? (
            <ListError message="تعذر تحميل الأقساط القادمة" onRetry={() => refetchUpcoming()} />
          ) : (
          <DataTable
            data={upcoming || []}
            columns={cols}
            loading={ul}
            rowKey={(r) => r.id}
            emptyText="لا توجد أقساط قادمة"
          />
          )
        )}

        {/* ── Phase C.3 (C3-4): payment confirmation modal ── */}
        <Modal
          open={payConfirmInst !== null}
          onClose={() => setPayConfirmInst(null)}
          title="تسجيل دفع قسط"
          size="sm"
          footer={
            <>
              <button
                onClick={() => setPayConfirmInst(null)}
                className="px-4 py-2 min-h-[44px] rounded-lg border border-matrix-border text-xs font-mono text-matrix-subtle hover:text-matrix-text transition-all"
              >
                تراجع
              </button>
              <button
                onClick={confirmPay}
                disabled={payMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg border border-matrix-green/40 text-xs font-mono text-matrix-green hover:bg-matrix-green/10 transition-all disabled:opacity-40"
              >
                {payMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                نعم، تسجيل الدفعة
              </button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-matrix-subtle">
            هل أنت متأكد من تسجيل دفع قسط بقيمة{' '}
            <span className="font-mono text-matrix-text">{formatCurrency(payConfirmInst?.amount ?? 0)}</span>
            {payConfirmInst?.sale?.customer?.name
              ? <> للعميل «<span className="text-matrix-text">{payConfirmInst.sale.customer.name}</span>»</>
              : null}؟
          </p>
          <p className="text-xs leading-relaxed text-matrix-amber mt-3">
            سيُسجَّل الدفع فور التأكيد ولا يمكن التراجع عنه.
          </p>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
