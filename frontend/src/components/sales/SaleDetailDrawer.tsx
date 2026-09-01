'use client';

// ============================================================
// YS-MATRIX ERP — SaleDetailDrawer (Phase 3 Stage 1, V2)
//
// V2 CHANGES vs original:
//   - sale.payment_type → sale.sale_type (real field name)
//   - sale.total_price → sale.total
//   - sale.remaining_amount (field that doesn't exist on the backend)
//     → getRemainingInstallmentAmount(sale), computed from the real
//     installments array (sum of unpaid installment amounts).
//   - sale.inventoryItem (singular — doesn't match the real relation)
//     → sale.items (array via saleItem). Each item rendered individually;
//     most sales will have exactly one (per the showroom's single-item-
//     per-invoice model), but the UI doesn't assume that.
//   - Added a fail-closed CANCEL action in the header: calls
//     useCancelSale() and surfaces the backend's specific error
//     (e.g. "تم تحصيل 2 قسط/أقساط... يجب معالجة الاسترداد المالي
//     رسمياً") inline rather than as a toast that disappears, since
//     the user needs to read and act on that reason.
//   - subtotal/discount/profit now shown (real fields that existed on
//     the backend but the original drawer never displayed).
// ============================================================

import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import {
  X, Receipt, User, Car, Calendar, Printer,
  CheckCircle2, Clock, Loader2, DollarSign, XCircle, AlertTriangle,
} from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { useSale, usePayInstallment, useCancelSale } from '@/hooks/useSales';
import {
  Sale, SALE_STATUS_CONFIG, PAYMENT_TYPE_CONFIG, Installment,
  getRemainingInstallmentAmount,
} from '@/types/sale.types';
import { isApiRequestError } from '@/lib/api';
import { openPrintHTML } from '@/lib/print';
import { Modal } from '@/components/ui/Modal';

// ─── Installment Row ─────────────────────────────────────────
function InstallmentRow({
  inst,
  onPay,
  paying,
}: {
  inst:    Installment;
  onPay:   () => void;
  paying:  boolean;
}) {
  const isOverdue = !inst.is_paid && new Date(inst.due_date) < new Date();
  const [receiptLoading, setReceiptLoading] = useState(false);

  // Phase C.1 (4B): the paid installment's receipt is a server-rendered
  // HTML document behind the same authenticated fetch as the invoice
  // print (openPrintHTML) — the route is tenant-scoped and the backend
  // rejects receipts for CANCELLED-sale installments via the 1B guard.
  const openReceipt = async () => {
    setReceiptLoading(true);
    try {
      await openPrintHTML(`/sales/installments/${inst.id}/receipt`);
    } catch {
      toast.error('تعذر فتح الإيصال');
    } finally {
      setReceiptLoading(false);
    }
  };

  return (
    <div className={cn(
      'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all',
      inst.is_paid
        ? 'border-matrix-green/20 bg-matrix-green/[0.03]'
        : isOverdue
          ? 'border-matrix-red/30 bg-matrix-red/[0.03]'
          : 'border-matrix-border/50',
    )}>
      <div className="shrink-0">
        {inst.is_paid
          ? <CheckCircle2 className="w-4 h-4 text-matrix-green" />
          : <Clock className={cn('w-4 h-4', isOverdue ? 'text-matrix-red' : 'text-matrix-subtle')} />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono text-matrix-text">{formatCurrency(inst.amount)}</p>
        <p className={cn('text-[10px] font-mono mt-0.5', isOverdue ? 'text-matrix-red' : 'text-matrix-subtle')}>
          {formatDate(inst.due_date)} {isOverdue && '· متأخر'}
        </p>
        {inst.is_paid && inst.paid_at && (
          <p className="text-[10px] font-mono text-matrix-green mt-0.5">دُفع: {formatDate(inst.paid_at)}</p>
        )}
        {inst.note === 'SALE_CANCELLED' && (
          <p className="text-[10px] font-mono text-matrix-subtle/70 mt-0.5">ملغى مع الفاتورة</p>
        )}
      </div>

      {!inst.is_paid && (
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Matrix Audit: this used to be an editable number input
              bound to local state (inputAmt), passed to onPay(amount) —
              but the backend's payInstallment never accepted an amount
              at all (installment.amount is fixed at sale creation,
              paying just marks it paid). The input LOOKED editable but
              any value typed into it was silently discarded by the
              parent's onPay handler, misleading whoever used it into
              thinking they could adjust the payment amount. Replaced
              with the fixed amount as plain text — matches what the
              system actually does. */}
          <button
            onClick={onPay}
            disabled={paying}
            className="flex items-center gap-1 px-2 py-1 rounded border border-matrix-green/30 text-matrix-green text-[10px] hover:bg-matrix-green/10 transition-all disabled:opacity-40"
          >
            {paying ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
            دفع
          </button>
        </div>
      )}

      {inst.is_paid && (
        <button
          onClick={openReceipt}
          disabled={receiptLoading}
          className="flex items-center gap-1 px-2 py-1 rounded border border-matrix-cyan/30 text-matrix-cyan text-[10px] hover:bg-matrix-cyan/10 transition-all disabled:opacity-40 shrink-0"
        >
          {receiptLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
          إيصال
        </button>
      )}
    </div>
  );
}

// ─── Main Drawer ─────────────────────────────────────────────
export function SaleDetailDrawer({
  sale: initialSale,
  onClose,
}: {
  sale:    Sale;
  onClose: () => void;
}) {
  // Use live data if available, fallback to prop
  const { data: liveSale } = useSale(initialSale.id);
  const sale = liveSale ?? initialSale;

  const payInstallment = usePayInstallment();
  const cancelSale      = useCancelSale();
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Phase C.3 (C3-4): native window.confirm replaced with the project's
  // Modal convention. Cancel copy states the real consequences — stock
  // is restored and the action is irreversible; invoices with paid
  // installments cannot be cancelled (backend-enforced, warned upfront
  // here). Paying an installment also gets an explicit confirmation now
  // (previously the drawer paid with no confirm at all): the payment is
  // recorded immediately and cannot be undone.
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [payConfirmInst,    setPayConfirmInst]    = useState<Installment | null>(null);

  const handleCancel = () => {
    setCancelConfirmOpen(false);
    setCancelError(null);
    cancelSale.mutate(sale.id, {
      onError: (err: unknown) => {
        setCancelError(isApiRequestError(err) ? err.message : 'فشل الإلغاء');
      },
      onSuccess: () => onClose(),
    });
  };

  const confirmPay = () => {
    if (!payConfirmInst) return;
    const installmentId = payConfirmInst.id;
    setPayConfirmInst(null);
    payInstallment.mutate({ installmentId });
  };

  // Phase C.1 (4A): print path mirrors the invoice detail page — the
  // print HTML is server-rendered at /invoices/:id/print (same id as
  // the sale). Direct window.open could never carry the Bearer header
  // (no cookies exist in this backend), so the tab is opened blank and
  // the document is loaded through the authenticated axios client.
  const openPrint = () => openPrintHTML(`/invoices/${sale.id}/print`).catch(() => toast.error('تعذر فتح الفاتورة للطباعة'));

  const statusCfg     = SALE_STATUS_CONFIG[sale.status];
  const paymentCfg    = PAYMENT_TYPE_CONFIG[sale.sale_type];
  const remainingAmt  = getRemainingInstallmentAmount(sale);

  const financialRows = [
    { label: 'الإجمالي الفرعي', value: formatCurrency(sale.subtotal), color: 'text-matrix-text' },
    ...(sale.discount > 0
      ? [{ label: 'الخصم', value: `- ${formatCurrency(sale.discount)}`, color: 'text-matrix-amber' }]
      : []),
    { label: 'الإجمالي النهائي', value: formatCurrency(sale.total), color: 'text-matrix-green' },
    { label: 'نوع الدفع', value: `${paymentCfg.icon} ${paymentCfg.label}`, color: 'text-matrix-text' },
    ...(sale.down_payment != null
      ? [{ label: 'الدفعة الأولى', value: formatCurrency(sale.down_payment), color: 'text-matrix-cyan' }]
      : []),
    ...(sale.sale_type === 'INSTALLMENT'
      ? [{
          label: 'المتبقي',
          value: formatCurrency(remainingAmt),
          color: remainingAmt > 0 ? 'text-matrix-amber' : 'text-matrix-green',
        }]
      : []),
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{   x: '100%' }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="fixed top-0 left-0 h-full w-full max-w-md z-50 flex flex-col matrix-panel border-r border-matrix-border shadow-2xl"
        style={{ boxShadow: '-8px 0 40px rgba(0,0,0,0.6)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-matrix-border shrink-0">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-matrix-cyan" />
            <span className="text-sm font-mono font-semibold text-matrix-text">{sale.invoice_number}</span>
            <span className={cn('badge text-[10px]', statusCfg.badgeClass)}>{statusCfg.label}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* F6 — invoice print from the drawer (was only reachable
                via the full invoice detail page before). */}
            <button
              onClick={openPrint}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-matrix-cyan/30 text-matrix-cyan hover:bg-matrix-cyan/10 transition-all"
            >
              <Printer className="w-3 h-3" />
              طباعة
            </button>
            {sale.status === 'ACTIVE' && (
              <button
                onClick={() => setCancelConfirmOpen(true)}
                disabled={cancelSale.isPending}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-matrix-red/30 text-matrix-red hover:bg-matrix-red/10 transition-all disabled:opacity-50"
              >
                {cancelSale.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                إلغاء الفاتورة
              </button>
            )}
            <button onClick={onClose} className="text-matrix-subtle hover:text-matrix-red transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Cancel-blocked banner — stays visible until dismissed or drawer closed */}
        {cancelError && (
          <div className="px-5 py-3 bg-matrix-red/5 border-b border-matrix-red/20 flex items-start justify-between gap-3 shrink-0">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-matrix-red shrink-0 mt-0.5" />
              <p className="text-[11px] text-matrix-red leading-relaxed">{cancelError}</p>
            </div>
            <button onClick={() => setCancelError(null)} className="text-matrix-subtle hover:text-matrix-text shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── Items ── */}
          {sale.items && sale.items.length > 0 && (
            <section>
              <p className="section-label mb-2">
                {sale.items.length > 1 ? `المنتجات (${sale.items.length})` : 'السيارة / المنتج'}
              </p>
              <div className="space-y-2">
                {sale.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-matrix-dark border border-matrix-border/50"
                  >
                    <Car className="w-4 h-4 text-matrix-cyan shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-matrix-text">{item.vehicle_model}</p>
                      <p className="text-[10px] font-mono text-matrix-subtle mt-0.5">
                        {item.quantity > 1 ? `الكمية: ${item.quantity} · ` : ''}
                        {formatCurrency(item.unit_price)}
                        {item.color ? ` · ${item.color}` : ''}
                      </p>
                      {item.chassis_number && (
                        <p className="text-[10px] font-mono text-matrix-subtle/70 mt-0.5">
                          شاسيه: {item.chassis_number}
                        </p>
                      )}
                      {item.engine_number && (
                        <p className="text-[10px] font-mono text-matrix-subtle/70 mt-0.5">
                          محرك: {item.engine_number}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Customer ── */}
          {sale.customer && (
            <section>
              <p className="section-label mb-2">العميل</p>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-matrix-dark border border-matrix-border/50">
                <User className="w-4 h-4 text-matrix-green shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-matrix-text">{sale.customer.name}</p>
                  {sale.customer.phone && (
                    <p className="text-[10px] font-mono text-matrix-subtle mt-0.5">{sale.customer.phone}</p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Financials ── */}
          <section>
            <p className="section-label mb-2">التفاصيل المالية</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {financialRows.map((row) => (
                <div key={row.label} className="p-3 rounded-lg bg-matrix-dark border border-matrix-border/50">
                  <p className="text-[10px] font-mono text-matrix-subtle">{row.label}</p>
                  <p className={cn('text-xs font-mono font-semibold mt-0.5', row.color)}>{row.value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Installments ── */}
          {sale.installments && sale.installments.length > 0 && (
            <section>
              <p className="section-label mb-2">
                جدول الأقساط
                <span className="mr-1 text-matrix-subtle">
                  ({sale.installments.filter((i) => i.is_paid).length}/{sale.installments.length})
                </span>
              </p>
              <div className="space-y-2">
                {sale.installments.map((inst) => (
                  <InstallmentRow
                    key={inst.id}
                    inst={inst}
                    onPay={() => setPayConfirmInst(inst)}
                    paying={payInstallment.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Notes ── */}
          {sale.notes && (
            <section>
              <p className="section-label mb-2">ملاحظات</p>
              <p className="text-xs text-matrix-subtle leading-relaxed p-3 rounded-lg bg-matrix-dark border border-matrix-border/50">
                {sale.notes}
              </p>
            </section>
          )}

          {/* ── Dates ── */}
          <section>
            <div className="flex items-center gap-2 text-[10px] font-mono text-matrix-subtle/60">
              <Calendar className="w-3 h-3" />
              تاريخ البيع: {formatDate(sale.sold_at)}
            </div>
          </section>
        </div>
      </motion.aside>

      {/* ── Phase C.3 (C3-4): confirmation modals ── */}
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
              onClick={handleCancel}
              disabled={cancelSale.isPending}
              className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg border border-matrix-red/40 text-xs font-mono text-matrix-red hover:bg-matrix-red/10 transition-all disabled:opacity-40"
            >
              {cancelSale.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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
              disabled={payInstallment.isPending}
              className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg border border-matrix-green/40 text-xs font-mono text-matrix-green hover:bg-matrix-green/10 transition-all disabled:opacity-40"
            >
              {payInstallment.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              نعم، تسجيل الدفعة
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-matrix-subtle">
          سيتم تسجيل دفع قسط بقيمة <span className="font-mono text-matrix-text">{formatCurrency(payConfirmInst?.amount ?? 0)}</span>
          {payConfirmInst?.sale?.invoice_number
            ? <> للفاتورة <span className="font-mono text-matrix-text">{payConfirmInst.sale.invoice_number}</span></>
            : null}.
          يُسجَّل الدفع فور التأكيد ولا يمكن التراجع عنه.
        </p>
      </Modal>
    </>
  );
}
