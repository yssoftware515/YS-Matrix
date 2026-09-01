'use client';

// ============================================================
// YS-MATRIX ERP — SaleCreateModal (Phase 3 Stage 1, V2)
//
// V2 CHANGES vs original (which didn't match the real backend at all):
//   - SINGLE inventory item per sale (business decision: this showroom
//     sells one vehicle/item per invoice — not a shopping-cart model).
//     A `quantity` field appears only for SPARE_PART items, since those
//     are the one category genuinely sold in multiples per invoice.
//   - total_price (manually typed, disconnected from the actual item)
//     → total is now COMPUTED from the selected item's selling_price ×
//     quantity. The user can no longer type an arbitrary total that
//     doesn't correspond to the item's real price — this was a real
//     financial-integrity gap in the original form.
//   - installments_count / installment_interval_days (fields that don't
//     exist on the backend at all) → monthly_amount / installment_months
//     / first_due_date, matching createSale's actual required fields
//     exactly (see sales.service.js: "بيع التقسيط يتطلب: down_payment,
//     monthly_amount, installment_months, first_due_date").
//   - payment_type → sale_type (matches CreateSalePayload / the real
//     query/body field name used throughout sales.service.js).
//   - status: 'AVAILABLE' (a status that doesn't exist on the backend;
//     real values are IN_STOCK/SOLD/RESERVED/RETURNED) → 'IN_STOCK'.
//   - item.price (field name that doesn't exist on InventoryItem) →
//     item.selling_price.
// ============================================================

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { X, Receipt, Loader2, Search, UserPlus, Printer } from 'lucide-react';
import { useCreateSale } from '@/hooks/useSales';
import { useInventory } from '@/hooks/useInventory';
import { useCustomers, useCreateCustomer } from '@/hooks/useCustomers';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { openPrintHTML } from '@/lib/print';
import type { CreateSalePayload, SaleType } from '@/types/sale.types';
import type { InventoryItem } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';

// MOB-08: below `sm`, the modal now docks to the bottom edge as a
// full-width sheet instead of a centered card with side margins —
// the centered `max-w-xl` card was losing ~32px of usable width to
// the backdrop's `p-4` on a 360-390px phone, on top of the modal's
// own `px-5` internal padding. `items-end` + no horizontal padding
// below `sm` reclaims that space; centered card behavior returns
// unchanged from `sm` upward.
const BACKDROP = 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4';

// Local form state — separate from CreateSalePayload because the form
// needs UI-only fields (itemSearch, quantity-as-string-while-typing)
// that aren't part of the actual API payload. buildPayload() below is
// the single place that converts form state → real CreateSalePayload.
interface FormState {
  selectedItem:        InventoryItem | null;
  quantity:             number; // only meaningful when selectedItem.vehicle_type === 'SPARE_PART'
  customerId:           string;
  saleType:             SaleType;
  discount:             string;
  notes:                string;
  // Installment-only fields
  downPayment:          string;
  monthlyAmount:        string;
  installmentMonths:    string;
  firstDueDate:         string;
}

const BLANK_FORM: FormState = {
  selectedItem:      null,
  quantity:           1,
  customerId:         '',
  saleType:           'CASH',
  discount:           '',
  notes:              '',
  downPayment:        '',
  monthlyAmount:      '',
  installmentMonths:  '',
  firstDueDate:       '',
};

function isSparePart(item: InventoryItem | null): boolean {
  return item?.vehicle_type === 'SPARE_PART';
}

function computeTotal(item: InventoryItem | null, quantity: number, discount: string): number {
  if (!item) return 0;
  const qty = isSparePart(item) ? Math.max(1, quantity) : 1;
  const subtotal = item.selling_price * qty;
  const disc = parseFloat(discount) || 0;
  return Math.max(0, subtotal - disc);
}

function buildPayload(form: FormState): CreateSalePayload | null {
  if (!form.selectedItem) return null;

  const qty = isSparePart(form.selectedItem) ? Math.max(1, form.quantity) : 1;

  const payload: CreateSalePayload = {
    sale_type: form.saleType,
    items: [{
      inventory_id: form.selectedItem.id,
      quantity:     qty,
      unit_price:   form.selectedItem.selling_price,
    }],
  };

  if (form.customerId) payload.customer_id = form.customerId;
  if (form.notes.trim()) payload.notes = form.notes.trim();
  if (form.discount) payload.discount = parseFloat(form.discount) || 0;

  if (form.saleType === 'INSTALLMENT') {
    payload.down_payment       = parseFloat(form.downPayment)       || 0;
    payload.monthly_amount     = parseFloat(form.monthlyAmount)     || 0;
    payload.installment_months = parseInt(form.installmentMonths, 10) || 0;
    // Phase C.6 (P0): the backend contract requires a full ISO-8601
    // datetime (z.string().datetime() in sale.validation.js) — a bare
    // `YYYY-MM-DD` from <input type="date"> was rejected with 400,
    // breaking EVERY installment sale from the UI. Serialize the picked
    // calendar day to local midnight first, so the stored due date keeps
    // exactly the day the user selected. The backend stays strict.
    payload.first_due_date = form.firstDueDate
      ? new Date(`${form.firstDueDate}T00:00:00`).toISOString()
      : undefined;
  }

  return payload;
}

// Validation mirrors the server-side checks in createSale() so the
// user gets the same feedback before submitting, not just after a
// failed request. The server remains the authoritative check either way.
function validate(form: FormState): string | null {
  if (!form.selectedItem) return 'يجب اختيار سيارة أو منتج.';
  const total = computeTotal(form.selectedItem, form.quantity, form.discount);
  if (total <= 0) return 'إجمالي الفاتورة يجب أن يكون أكبر من صفر.';

  if (form.saleType === 'INSTALLMENT') {
    if (!form.downPayment || parseFloat(form.downPayment) < 0) return 'الدفعة الأولى مطلوبة.';
    if (!form.monthlyAmount || parseFloat(form.monthlyAmount) <= 0) return 'قيمة القسط الشهري مطلوبة.';
    if (!form.installmentMonths || parseInt(form.installmentMonths, 10) <= 0) return 'عدد الأشهر مطلوب.';
    if (!form.firstDueDate) return 'تاريخ أول قسط مطلوب.';

    // Phase C.1 (1A) — mirror the server-side reconciliation exactly:
    // down_payment + monthly_amount × installment_months must equal the
    // computed total within ±0.01, and down_payment must be strictly
    // below it. Integer cents math (no float comparison on money).
    // The server still re-checks authoritatively (sales.service.js).
    const down   = parseFloat(form.downPayment)   || 0;
    const monthly = parseFloat(form.monthlyAmount) || 0;
    const months  = parseInt(form.installmentMonths, 10) || 0;
    const totalCents    = Math.round(total   * 100);
    const downCents     = Math.round(down    * 100);
    const collectible   = downCents + Math.round(monthly * 100) * months;

    if (downCents >= totalCents) return 'الدفعة الأولى يجب أن تكون أقل من الإجمالي.';
    if (Math.abs(collectible - totalCents) > 1) {
      return 'مجموع الدفعة الأولى والأقساط يجب أن يساوي إجمالي الفاتورة';
    }
  }

  return null;
}

export function SaleCreateModal({ onClose }: { onClose: () => void }) {
  const createSale     = useCreateSale();
  const createCustomer = useCreateCustomer();
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [itemSearch,     setItemSearch]     = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [formError,      setFormError]      = useState<string | null>(null);

  // Phase C.1 (3B) — inline "quick create customer" state.
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', national_id: '' });
  // The picker query re-fetches asynchronously after a create; this
  // name keeps the selected-chip readable in the gap before refetch.
  const [newCustomerName, setNewCustomerName] = useState<string | null>(null);

  // Phase C.1 (5B) — the pickers fired a search query on every
  // keystroke; debounce both so typing is free.
  const debouncedItemSearch     = useDebouncedValue(itemSearch);
  const debouncedCustomerSearch = useDebouncedValue(customerSearch);

  // Only IN_STOCK items are sellable — 'AVAILABLE' (used in the original
  // file) is not a real status in this system.
  const { data: inventoryData, isLoading: itemsLoading } = useInventory({
    search: debouncedItemSearch || undefined, status: 'IN_STOCK', limit: 20,
  });
  const { data: customerData, isLoading: customersLoading } = useCustomers({
    search: debouncedCustomerSearch || undefined, limit: 20,
  });

  const inventoryItems = inventoryData?.data ?? [];
  const customers       = customerData?.data  ?? [];
  const selectedCustomer = customers.find((c) => c.id === form.customerId);

  const isInstallment = form.saleType === 'INSTALLMENT';
  const computedTotal = useMemo(
    () => computeTotal(form.selectedItem, form.quantity, form.discount),
    [form.selectedItem, form.quantity, form.discount]
  );

  // Phase C.1 (3B) — create the customer through the SAME canonical
  // hook the CRM page uses (useCreateCustomer): it invalidates both
  // customer query keys, surfaces the backend's duplicate messages
  // (يوجد عميل مسجل بهذا الرقم الوطني...) via toast, and returns the
  // created row so this form can select it immediately.
  async function handleCreateCustomer() {
    if (!newCustomer.name.trim()) {
      setFormError('اسم العميل مطلوب.');
      return;
    }
    setFormError(null);
    try {
      const created = await createCustomer.mutateAsync({
        name:        newCustomer.name.trim(),
        phone:       newCustomer.phone.trim()       || undefined,
        national_id: newCustomer.national_id.trim() || undefined,
      });
      setForm((f) => ({ ...f, customerId: created.id }));
      setNewCustomerName(created.name);
      setCustomerSearch(created.name);
      setNewCustomer({ name: '', phone: '', national_id: '' });
      setShowNewCustomer(false);
    } catch {
      // The hook already toasted the backend message.
    }
  }

  async function handleSubmit() {
    const error = validate(form);
    if (error) { setFormError(error); return; }
    setFormError(null);

    const payload = buildPayload(form);
    if (!payload) return; // unreachable given validate() above, but keeps TS happy

    const created = await createSale.mutateAsync(payload);
    onClose();

    // Phase C.1 (4D) — offer the print right where the sale was
    // created. The hook's own success toast still fires (they stack
    // briefly); this one carries an action instead of a dismissal.
    toast((t) => (
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-matrix-text">الفاتورة جاهزة</span>
        <button
          onClick={() => {
            toast.dismiss(t.id);
            openPrintHTML(`/invoices/${created.id}/print`)
              .catch(() => toast.error('تعذر فتح الفاتورة للطباعة'));
          }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-matrix-cyan/40 text-matrix-cyan text-xs font-mono hover:bg-matrix-cyan/10 transition-all"
        >
          <Printer className="w-3 h-3" />
          طباعة الفاتورة
        </button>
      </div>
    ));
  }

  return (
    <div className={BACKDROP} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.95, y: 20  }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="w-full sm:max-w-xl matrix-panel max-h-[92vh] sm:max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-matrix-border shrink-0">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-matrix-cyan" />
            <span className="text-sm font-mono font-semibold tracking-widest uppercase text-matrix-text">
              بيع جديد
            </span>
          </div>
          <button onClick={onClose} className="text-matrix-subtle hover:text-matrix-red transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* ── Inventory Item (single selection) ── */}
          <div>
            <label className="matrix-label">السيارة / المنتج *</label>
            <div className="relative mb-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-matrix-subtle" />
              <input
                className="matrix-input pr-9 text-xs w-full"
                placeholder="ابحث عن سيارة أو منتج..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
              />
            </div>
            {itemSearch && (
              <div className="matrix-panel border border-matrix-border max-h-40 overflow-y-auto">
                {itemsLoading ? (
                  <p className="text-[10px] text-matrix-subtle p-3 font-mono flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> جاري البحث...
                  </p>
                ) : inventoryItems.length === 0 ? (
                  <p className="text-[10px] text-matrix-subtle p-3 font-mono">لا نتائج</p>
                ) : (
                  inventoryItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setForm((f) => ({ ...f, selectedItem: item, quantity: 1 }));
                        setItemSearch('');
                        setFormError(null);
                      }}
                      className="w-full text-right px-3 py-2 hover:bg-matrix-cyan/5 border-b border-matrix-border/40 transition-colors"
                    >
                      <p className="text-xs text-matrix-text">{item.brand} {item.model}</p>
                      <p className="text-[10px] text-matrix-subtle font-mono">
                        {item.year ? `${item.year} · ` : ''}{formatCurrency(item.selling_price)}
                        {item.vehicle_type === 'SPARE_PART' ? ` · متوفر: ${item.quantity}` : ''}
                      </p>
                      {/* Phase C.1 (2) — vehicle identity in the picker:
                          color + chassis let the staff member confirm they
                          are selling the exact unit, not just the model. */}
                      {item.vehicle_type !== 'SPARE_PART' && (item.color || item.chassis_number) && (
                        <p className="text-[10px] text-matrix-subtle font-mono">
                          {[item.color, item.chassis_number].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
            {form.selectedItem && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-matrix-cyan/5 border border-matrix-cyan/20 mt-1">
                <div>
                  <span className="text-xs text-matrix-cyan font-mono">
                    {form.selectedItem.brand} {form.selectedItem.model}
                  </span>
                  <span className="text-[10px] text-matrix-subtle font-mono mr-2">
                    {formatCurrency(form.selectedItem.selling_price)}
                  </span>
                </div>
                <button
                  onClick={() => setForm((f) => ({ ...f, selectedItem: null }))}
                  className="text-matrix-subtle hover:text-matrix-red"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* ── Quantity — SPARE_PART only ── */}
          {isSparePart(form.selectedItem) && (
            <div>
              <label className="matrix-label">
                الكمية * (المتوفر: {form.selectedItem?.quantity})
              </label>
              <input
                type="number"
                min={1}
                max={form.selectedItem?.quantity ?? 1}
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: parseInt(e.target.value, 10) || 1 }))}
                className="matrix-input text-xs w-full"
              />
            </div>
          )}

          {/* ── Customer (optional) ── */}
          <div>
            <label className="matrix-label">العميل (اختياري)</label>
            <div className="relative mb-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-matrix-subtle" />
              <input
                className="matrix-input pr-9 text-xs w-full"
                placeholder="ابحث عن عميل..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
            </div>
            {customerSearch && (
              <div className="matrix-panel border border-matrix-border max-h-36 overflow-y-auto">
                {customersLoading ? (
                  <p className="text-[10px] text-matrix-subtle p-3 font-mono flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> جاري البحث...
                  </p>
                ) : customers.length === 0 ? (
                  <p className="text-[10px] text-matrix-subtle p-3 font-mono">لا نتائج</p>
                ) : (
                  customers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setForm((f) => ({ ...f, customerId: c.id })); setCustomerSearch(''); }}
                      className="w-full text-right px-3 py-2 hover:bg-matrix-cyan/5 border-b border-matrix-border/40 transition-colors"
                    >
                      <p className="text-xs text-matrix-text">{c.name}</p>
                      {c.phone && <p className="text-[10px] text-matrix-subtle font-mono">{c.phone}</p>}
                    </button>
                  ))
                )}
              </div>
            )}
            {selectedCustomer && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-matrix-green/5 border border-matrix-green/20 mt-1">
                <span className="text-xs text-matrix-green font-mono">{selectedCustomer.name}</span>
                <button
                  onClick={() => { setForm((f) => ({ ...f, customerId: '' })); setNewCustomerName(null); }}
                  className="text-matrix-subtle hover:text-matrix-red"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Phase C.1 (3B) — quick-create chip: the picker query
                refetches asynchronously, so right after a create the
                selected id is not in `customers` yet — this fallback
                name keeps the chip rendered in that gap. */}
            {form.customerId && !selectedCustomer && newCustomerName && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-matrix-green/5 border border-matrix-green/20 mt-1">
                <span className="text-xs text-matrix-green font-mono">{newCustomerName} (جديد)</span>
                <button
                  onClick={() => { setForm((f) => ({ ...f, customerId: '' })); setNewCustomerName(null); }}
                  className="text-matrix-subtle hover:text-matrix-red"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* ── Inline quick-create (Phase C.1 3B) ── */}
            <button
              onClick={() => { setShowNewCustomer((v) => !v); setFormError(null); }}
              className="flex items-center gap-1.5 mt-2 text-[11px] text-matrix-cyan hover:text-matrix-cyan/80 transition-colors font-mono"
            >
              <UserPlus className="w-3 h-3" />
              {showNewCustomer ? 'إلغاء إضافة عميل' : '+ عميل جديد (سريع)'}
            </button>
            {showNewCustomer && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{   opacity: 0, height: 0 }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2"
              >
                <input
                  className="matrix-input text-xs w-full col-span-2"
                  placeholder="اسم العميل *"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer((v) => ({ ...v, name: e.target.value }))}
                />
                <input
                  className="matrix-input text-xs w-full"
                  placeholder="الهاتف"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer((v) => ({ ...v, phone: e.target.value }))}
                />
                <input
                  className="matrix-input text-xs w-full"
                  placeholder="الرقم الوطني"
                  value={newCustomer.national_id}
                  onChange={(e) => setNewCustomer((v) => ({ ...v, national_id: e.target.value }))}
                />
                <button
                  onClick={handleCreateCustomer}
                  disabled={createCustomer.isPending}
                  className="col-span-2 matrix-btn flex items-center justify-center gap-2 text-xs disabled:opacity-40"
                >
                  {createCustomer.isPending
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> جارٍ الحفظ...</>
                    : <><UserPlus className="w-3 h-3" /> حفظ واختيار العميل</>}
                </button>
              </motion.div>
            )}
          </div>

          {/* ── Sale Type ── */}
          <div>
            <label className="matrix-label">نوع الدفع *</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['CASH', 'INSTALLMENT'] as SaleType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setForm((f) => ({ ...f, saleType: t }))}
                  className={cn(
                    'py-2.5 rounded-lg border text-xs font-mono transition-all',
                    form.saleType === t
                      ? 'border-matrix-cyan bg-matrix-cyan/10 text-matrix-cyan'
                      : 'border-matrix-border text-matrix-subtle hover:border-matrix-border/80',
                  )}
                >
                  {t === 'CASH' ? '💵 نقداً' : '📅 أقساط'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Discount (optional, applies to both CASH and INSTALLMENT) ── */}
          <div>
            <label className="matrix-label">الخصم (اختياري)</label>
            <input
              type="number" min={0}
              value={form.discount}
              onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))}
              className="matrix-input text-xs w-full"
              placeholder="0"
            />
          </div>

          {/* ── Installment Fields ── */}
          {isInstallment && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{   opacity: 0, height: 0 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <div>
                <label className="matrix-label">الدفعة الأولى (المقدمة) *</label>
                <input
                  type="number" min={0}
                  value={form.downPayment}
                  onChange={(e) => setForm((f) => ({ ...f, downPayment: e.target.value }))}
                  className="matrix-input text-xs w-full"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="matrix-label">قيمة القسط الشهري *</label>
                <input
                  type="number" min={0}
                  value={form.monthlyAmount}
                  onChange={(e) => setForm((f) => ({ ...f, monthlyAmount: e.target.value }))}
                  className="matrix-input text-xs w-full"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="matrix-label">عدد الأشهر *</label>
                <input
                  type="number" min={1} max={60}
                  value={form.installmentMonths}
                  onChange={(e) => setForm((f) => ({ ...f, installmentMonths: e.target.value }))}
                  className="matrix-input text-xs w-full"
                />
              </div>
              <div>
                <label className="matrix-label">تاريخ أول قسط *</label>
                <input
                  type="date"
                  value={form.firstDueDate}
                  onChange={(e) => setForm((f) => ({ ...f, firstDueDate: e.target.value }))}
                  className="matrix-input text-xs w-full"
                  dir="ltr"
                />
              </div>
            </motion.div>
          )}

          {/* ── Notes ── */}
          <div>
            <label className="matrix-label">ملاحظات</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="matrix-input text-xs w-full resize-none"
              placeholder="أي ملاحظات إضافية..."
            />
          </div>

          {/* ── Computed total — read-only, derived from selected item ── */}
          <div className="p-3 rounded-lg bg-matrix-dark border border-matrix-cyan/20 flex items-center justify-between">
            <span className="text-[10px] font-mono text-matrix-subtle uppercase tracking-widest">
              الإجمالي المحسوب
            </span>
            <span className="text-sm font-mono font-bold text-matrix-green">
              {formatCurrency(computedTotal)}
            </span>
          </div>

          {formError && (
            <p className="text-[11px] text-matrix-red font-mono px-1">{formError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-matrix-border shrink-0 flex items-center justify-end gap-3">
          <button onClick={onClose} className="matrix-btn-ghost text-xs">إلغاء</button>
          <button
            onClick={handleSubmit}
            disabled={createSale.isPending || !form.selectedItem}
            className="matrix-btn flex items-center gap-2 text-xs disabled:opacity-40"
          >
            {createSale.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الحفظ...</>
              : <><Receipt className="w-4 h-4" /> تأكيد البيع</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
