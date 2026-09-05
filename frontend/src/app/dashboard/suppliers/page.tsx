'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Truck, DollarSign, CreditCard, Eye, Pencil, Trash2, AlertTriangle, PackageX } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal } from '@/components/ui/Modal';
import { ListError } from '@/components/ui/ListError';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { suppliersApi, isApiRequestError, type Supplier, type SupplierPayment } from '@/lib/api';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import { formatCurrency, formatDate, cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────
// Supplier and SupplierPayment now come from lib/api.ts (real
// fields confirmed against supplier.service.js — the previous
// local Supplier interface was missing total_paid/notes/is_active,
// and the local Payment interface used `paid_at` correctly but
// api.ts's own type had it wrong as `created_at` until this fix).

interface SupplierForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

interface PayForm {
  amount: string;
  payment_type: string;
  reference: string;
  note: string;
}

const EMPTY_FORM: SupplierForm = { name: '', phone: '', email: '', address: '', notes: '' };
const EMPTY_PAY:  PayForm      = { amount: '', payment_type: 'CASH', reference: '', note: '' };

const PAYMENT_TYPES = [
  { value: 'CASH',          label: 'كاش' },
  { value: 'BANK_TRANSFER', label: 'تحويل بنكي' },
  { value: 'CHEQUE',        label: 'شيك' },
  { value: 'OTHER',         label: 'أخرى' },
];

const SUPPLIER_FIELDS: { k: keyof SupplierForm; l: string; p: string }[] = [
  { k: 'name',    l: 'اسم المورد *', p: 'شركة باجاج' },
  { k: 'phone',   l: 'الهاتف (اختياري)',       p: '+967...' },
  { k: 'email',   l: 'البريد (اختياري)',       p: 'info@supplier.com' },
  { k: 'address', l: 'العنوان (اختياري)',      p: 'صنعاء' },
  { k: 'notes',   l: 'ملاحظات (اختياري)',      p: 'أي ملاحظات إضافية...' },
];

// ── Helper: balance ──────────────────────────────────────────
const calcBalance = (s: Pick<Supplier, 'total_due' | 'total_paid'>): number =>
  parseFloat(String(s.total_due)) - parseFloat(String(s.total_paid));

// ── Helper: has linked inventory ────────────────────────────
const hasInventory = (s: Supplier): boolean =>
  !!s._count?.inventory && s._count.inventory > 0;

// ════════════════════════════════════════════════════════════
export default function SuppliersPage() {
  const qc = useQueryClient();
  // Phase C.6 (P1): supplier payments / deactivate / reactivate are
  // ownerOnly on the backend (supplier.routes.js) — add/edit remain
  // available to STAFF. Same customers-page pattern: OWNER +
  // SUPER_ADMIN only for the owner-only actions; backend stays the
  // authoritative boundary.
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role);

  // ── Pagination / search state ────────────────────────────
  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState('');

  // F6 — GlobalSearch deep-links land here as ?search= — prefill the
  // list search so the result row is on screen immediately.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) setSearch(q);
  }, []);

  // ── Modal open state ─────────────────────────────────────
  const [addOpen,    setAddOpen]    = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [payOpen,    setPayOpen]    = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ── Selected supplier ────────────────────────────────────
  const [selected, setSelected] = useState<Supplier | null>(null);

  // ── Form state ───────────────────────────────────────────
  const [addForm,  setAddForm]  = useState<SupplierForm>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<SupplierForm>(EMPTY_FORM);
  const [payForm,  setPayForm]  = useState<PayForm>(EMPTY_PAY);

  // ── Queries ──────────────────────────────────────────────
  // V2 SHAPE: suppliersApi.getAll() resolves directly to
  // Paginated<Supplier> = { data, pagination }. getStats() and
  // getPayments() likewise resolve directly to their typed payload —
  // no more .then((r) => r.data) / .then((r) => r.data.data) needed.
  // Phase C.1 (5B): debounce the search box — a request per keystroke
  // becomes one per typing pause.
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['suppliers', { page, search: debouncedSearch }],
    queryFn:  () => suppliersApi.getAll({ page, limit: 15, search: debouncedSearch }),
  });

  const { data: stats } = useQuery({
    queryKey: ['supplier-stats'],
    queryFn:  () => suppliersApi.getStats(),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['sup-payments', selected?.id],
    queryFn:  () =>
      selected
        ? suppliersApi.getPayments(selected.id).then((r) => r.data)
        : Promise.resolve([] as SupplierPayment[]),
    enabled: !!selected,
  });

  // ── Invalidate all related queries helper ────────────────
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['suppliers'] });
    qc.invalidateQueries({ queryKey: ['supplier-stats'] });
    qc.invalidateQueries({ queryKey: ['sup-payments'] });
  };

  // ── Mutations ────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (payload: SupplierForm) => suppliersApi.create({ ...payload }),
    onSuccess: () => {
      toast.success('تم إضافة المورد بنجاح');
      invalidateAll();
      setAddOpen(false);
      setAddForm(EMPTY_FORM);
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل إضافة المورد'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SupplierForm }) => suppliersApi.update(id, { ...payload }),
    onSuccess: () => {
      toast.success('تم تحديث بيانات المورد');
      invalidateAll();
      setEditOpen(false);
      setSelected(null);
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل تحديث المورد'),
  });

  // SOFT DELETE — confirmed via supplier.service.js: deleteSupplier()
  // only sets is_active: false, the row is never removed. Renamed
  // from deleteMut to deactivateMut, with honest "تعطيل" (deactivate)
  // messaging instead of "حذف" (delete) — same fix already applied
  // to the customers page for the identical backend pattern.
  const deactivateMut = useMutation({
    mutationFn: (id: string) => suppliersApi.deactivate(id),
    onSuccess: () => {
      toast.success('تم تعطيل المورد — يمكن إعادة تفعيله في أي وقت');
      invalidateAll();
      setDeleteConfirmOpen(false);
      setSelected(null);
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل تعطيل المورد'),
  });

  // Reactivate — route confirmed in supplier.controller.js
  // (reactivateSupplier, same ownerOnly soft-delete-reversal pattern
  // as customers). Previously had no frontend path at all.
  const reactivateMut = useMutation({
    mutationFn: (id: string) => suppliersApi.reactivate(id),
    onSuccess: () => {
      toast.success('تم إعادة تفعيل المورد بنجاح');
      invalidateAll();
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل إعادة التفعيل'),
  });

  const payMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: PayForm }) =>
      suppliersApi.addPayment(id, { ...d }),
    onSuccess: () => {
      toast.success('تم تسجيل الدفعة بنجاح');
      invalidateAll();
      setPayOpen(false);
      setPayForm(EMPTY_PAY);
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل تسجيل الدفعة'),
  });

  // ── Open edit modal with pre-filled form ─────────────────
  // Phase C.6 (P1): notes were always reset to '' on edit — saving any
  // unrelated change silently ERASED the stored notes (the form sends
  // every field, and the backend PATCH writes notes: '' as a real
  // update). Now loaded from the row like every other field; notes are
  // only changed if the user explicitly edits/clears them.
  const openEdit = (supplier: Supplier) => {
    setSelected(supplier);
    setEditForm({
      name:    supplier.name,
      phone:   supplier.phone   ?? '',
      email:   supplier.email   ?? '',
      address: supplier.address ?? '',
      notes:   supplier.notes   ?? '',
    });
    setEditOpen(true);
  };

  // ── Open delete confirm ──────────────────────────────────
  const openDelete = (supplier: Supplier) => {
    setSelected(supplier);
    setDeleteConfirmOpen(true);
  };

  // ── Column definitions ───────────────────────────────────
  const columns: Column<Supplier>[] = [
    {
      key: 'name', header: 'اسم المورد',
      render: (r) => (
        <div>
          <p className="font-semibold text-matrix-text">{r.name}</p>
          {r.phone && (
            <p className="text-xs font-mono text-matrix-subtle mt-0.5">{r.phone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'total_due', header: 'المديونية',
      render: (r) => (
        <span className="font-mono font-bold text-matrix-amber">
          {formatCurrency(r.total_due)}
        </span>
      ),
    },
    {
      key: 'total_paid', header: 'المدفوع',
      render: (r) => (
        <span className="font-mono text-matrix-green">
          {formatCurrency(r.total_paid)}
        </span>
      ),
    },
    {
      key: 'balance', header: 'الرصيد',
      render: (r) => {
        const b = calcBalance(r);
        return (
          <span className={cn('font-mono font-bold', b > 0 ? 'text-matrix-red' : 'text-matrix-green')}>
            {formatCurrency(b)}
          </span>
        );
      },
    },
    {
      key: 'inventory', header: 'المخزون', align: 'center',
      render: (r) => (
        <span className="badge-cyan">{r._count?.inventory ?? 0}</span>
      ),
    },
    {
      key: 'actions', header: '', align: 'center',
      render: (r) => {
        const locked = hasInventory(r);
        return (
          <div className="flex items-center gap-1.5 justify-center">

            {/* ── Details ── */}
            <button
              onClick={(e) => { e.stopPropagation(); setSelected(r); setDetailOpen(true); }}
              className="px-2 py-1 rounded text-xs border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
            >
              <Eye className="w-3 h-3 inline ml-1" />تفاصيل
            </button>

            {/* ── Edit ── */}
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}
              className="px-2 py-1 rounded text-xs border border-matrix-blue/40 text-matrix-blue hover:bg-matrix-blue/10 transition-all"
            >
              <Pencil className="w-3 h-3 inline ml-1" />تعديل
            </button>

            {/* ── Pay — OWNER+ only (backend ownerOnly) ── */}
            {canManage && (
              <button
                onClick={(e) => { e.stopPropagation(); setSelected(r); setPayOpen(true); }}
                className="px-2 py-1 rounded text-xs border border-matrix-green/40 text-matrix-green hover:bg-matrix-green/10 transition-all"
              >
                <CreditCard className="w-3 h-3 inline ml-1" />دفعة
              </button>
            )}

            {/* ── Deactivate — OWNER+ only; UI-level safeguard if has linked inventory.
                NOTE: this guard is NOT enforced server-side (confirmed in
                supplier.service.js — deleteSupplier only checks is_active),
                same deliberate pattern as the customers page's sales-count
                guard: deactivating a supplier with active inventory links
                would be confusing even though technically reversible. ── */}
            {canManage && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!locked) openDelete(r); }}
              disabled={locked}
              title={locked ? 'لا يمكن تعطيل مورد لديه مخزون فعال' : 'تعطيل المورد'}
              className={cn(
                'px-2 py-1 rounded text-xs border transition-all',
                locked
                  ? 'border-matrix-border text-matrix-subtle/40 cursor-not-allowed opacity-50'
                  : 'border-matrix-red/40 text-matrix-red hover:bg-matrix-red/10'
              )}
            >
              <Trash2 className="w-3 h-3 inline ml-1" />
              {locked ? 'محمي' : 'تعطيل'}
            </button>
          )}

          </div>
        );
      },
    },
  ];

  // ════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════
  return (
    <DashboardLayout title="الموردون">
      <div className="space-y-5">

        {/* Link to deactivated suppliers — same pattern as the
            customers page's link to its inactive list */}
        <Link
          href="/dashboard/suppliers/inactive"
          className="inline-flex items-center gap-2 text-xs text-matrix-subtle hover:text-matrix-cyan transition-colors"
        >
          <PackageX className="w-3.5 h-3.5" />
          عرض الموردين المعطلين
        </Link>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="عدد الموردين"     value={stats?.total_suppliers || 0}                icon={<Truck className="w-5 h-5" />}       color="cyan"  delay={0}    />
          <KpiCard title="إجمالي المديونية" value={formatCurrency(stats?.total_due     || 0)} icon={<DollarSign className="w-5 h-5" />}  color="amber" delay={0.08} />
          <KpiCard title="المدفوع"          value={formatCurrency(stats?.total_paid    || 0)} icon={<DollarSign className="w-5 h-5" />}  color="green" delay={0.16} />
          <KpiCard title="الرصيد المستحق"   value={formatCurrency(stats?.total_balance || 0)} icon={<DollarSign className="w-5 h-5" />}  color="red"   delay={0.24} />
        </div>

        {/* ── Main Table ── */}
        {/* Phase C.1 (5A): a failed query must read as an error, not
            as an empty table. */}
        {isError ? (
          <ListError message="تعذر تحميل الموردين" onRetry={() => refetch()} />
        ) : (
        <DataTable
          data={data?.data || []}
          columns={columns}
          loading={isLoading}
          searchable
          searchPlaceholder="بحث بالاسم أو الهاتف..."
          onSearch={(q) => { setSearch(q); setPage(1); }}
          rowKey={(r) => r.id}
          emptyText="لا يوجد موردون"
          pagination={
            data?.pagination
              ? {
                  page:    data.pagination.page,
                  pages:   data.pagination.pages,
                  total:   data.pagination.total,
                  limit:   data.pagination.limit,
                  onPage:  setPage,
                }
              : undefined
          }
          actions={
            <button
              onClick={() => setAddOpen(true)}
              className="btn-primary flex items-center gap-2 py-2"
            >
              <Plus className="w-4 h-4" />إضافة مورد
            </button>
          }
        />
        )}

        {/* ════════════════════════════════════════════════════
            ADD MODAL
        ════════════════════════════════════════════════════ */}
        <Modal
          open={addOpen}
          onClose={() => { setAddOpen(false); setAddForm(EMPTY_FORM); }}
          title="إضافة مورد جديد"
          size="md"
          footer={
            <>
              <button
                onClick={() => { setAddOpen(false); setAddForm(EMPTY_FORM); }}
                className="btn-secondary py-2"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  if (!addForm.name.trim()) { toast.error('اسم المورد مطلوب'); return; }
                  createMut.mutate(addForm);
                }}
                disabled={createMut.isPending}
                className="btn-primary py-2 flex items-center gap-2"
              >
                {createMut.isPending && (
                  <span className="w-3 h-3 border border-matrix-cyan border-t-transparent rounded-full animate-spin" />
                )}
                حفظ
              </button>
            </>
          }
        >
          <SupplierFormFields form={addForm} onChange={(k, v) => setAddForm((f) => ({ ...f, [k]: v }))} />
        </Modal>

        {/* ════════════════════════════════════════════════════
            EDIT MODAL
        ════════════════════════════════════════════════════ */}
        <Modal
          open={editOpen}
          onClose={() => { setEditOpen(false); setSelected(null); }}
          title={'تعديل: ' + (selected?.name ?? '')}
          size="md"
          footer={
            <>
              <button
                onClick={() => { setEditOpen(false); setSelected(null); }}
                className="btn-secondary py-2"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  if (!editForm.name.trim()) { toast.error('اسم المورد مطلوب'); return; }
                  if (!selected) return;
                  updateMut.mutate({ id: selected.id, payload: editForm });
                }}
                disabled={updateMut.isPending}
                className="btn-primary py-2 flex items-center gap-2"
              >
                {updateMut.isPending && (
                  <span className="w-3 h-3 border border-matrix-cyan border-t-transparent rounded-full animate-spin" />
                )}
                حفظ التعديلات
              </button>
            </>
          }
        >
          <SupplierFormFields
            form={editForm}
            onChange={(k, v) => setEditForm((f) => ({ ...f, [k]: v }))}
          />
        </Modal>

        {/* ════════════════════════════════════════════════════
            PAY MODAL
        ════════════════════════════════════════════════════ */}
        <Modal
          open={payOpen}
          onClose={() => { setPayOpen(false); setPayForm(EMPTY_PAY); }}
          title={'تسجيل دفعة — ' + (selected?.name ?? '')}
          size="md"
          footer={
            <>
              <button
                onClick={() => { setPayOpen(false); setPayForm(EMPTY_PAY); }}
                className="btn-secondary py-2"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  if (!payForm.amount || parseFloat(payForm.amount) <= 0) {
                    toast.error('يرجى إدخال مبلغ صحيح');
                    return;
                  }
                  if (!selected) return;
                  payMut.mutate({ id: selected.id, d: payForm });
                }}
                disabled={payMut.isPending}
                className="btn-primary py-2 flex items-center gap-2"
              >
                {payMut.isPending && (
                  <span className="w-3 h-3 border border-matrix-cyan border-t-transparent rounded-full animate-spin" />
                )}
                تسجيل الدفعة
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Balance banner */}
            {selected && (
              <div className="p-3 rounded-lg border border-matrix-border bg-matrix-dark text-sm flex justify-between items-center">
                <span className="text-matrix-subtle">الرصيد المستحق:</span>
                <span className="font-mono font-bold text-matrix-red text-base">
                  {formatCurrency(calcBalance(selected))}
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
                المبلغ *
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={payForm.amount}
                onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                className="matrix-input"
                dir="ltr"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
                طريقة الدفع
              </label>
              <select
                value={payForm.payment_type}
                onChange={(e) => setPayForm((f) => ({ ...f, payment_type: e.target.value }))}
                className="matrix-input"
              >
                {PAYMENT_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
                رقم المرجع / التحويل
              </label>
              <input
                type="text"
                value={payForm.reference}
                onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                className="matrix-input"
                dir="ltr"
                placeholder="TXN-12345"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
                ملاحظة
              </label>
              <input
                type="text"
                value={payForm.note}
                onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))}
                className="matrix-input"
                placeholder="دفعة شهر يناير..."
              />
            </div>
          </div>
        </Modal>

        {/* ════════════════════════════════════════════════════
            تأكيد التعطيل
        ════════════════════════════════════════════════════ */}
        <Modal
          open={deleteConfirmOpen}
          onClose={() => { setDeleteConfirmOpen(false); setSelected(null); }}
          title="تأكيد التعطيل"
          size="sm"
          footer={
            <>
              <button
                onClick={() => { setDeleteConfirmOpen(false); setSelected(null); }}
                className="btn-secondary py-2"
              >
                إلغاء
              </button>
              <button
                onClick={() => { if (selected) deactivateMut.mutate(selected.id); }}
                disabled={deactivateMut.isPending}
                className="btn-danger py-2 flex items-center gap-2"
              >
                {deactivateMut.isPending && (
                  <span className="w-3 h-3 border border-matrix-red border-t-transparent rounded-full animate-spin" />
                )}
                تأكيد التعطيل
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg border border-matrix-red/20 bg-matrix-red/5">
              <AlertTriangle className="w-5 h-5 text-matrix-red shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-body text-matrix-text">
                  هل أنت متأكد من تعطيل المورد{' '}
                  <span className="font-semibold text-matrix-red">{selected?.name}</span>؟
                </p>
                <p className="text-xs text-matrix-subtle mt-1">
                  سيتم إخفاء المورد من القائمة الرئيسية. يمكن إعادة تفعيله لاحقاً — بياناته التاريخية محفوظة بالكامل.
                </p>
              </div>
            </div>
          </div>
        </Modal>

        {/* ════════════════════════════════════════════════════
            DETAIL MODAL
        ════════════════════════════════════════════════════ */}
        <Modal
          open={detailOpen && !payOpen && !editOpen}
          onClose={() => { setDetailOpen(false); setSelected(null); }}
          title={'تفاصيل: ' + (selected?.name ?? '')}
          size="lg"
        >
          {selected && (
            <div className="space-y-5">
              {/* Info grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {(
                  [
                    ['الهاتف',     selected.phone   || '—'],
                    ['البريد',     selected.email   || '—'],
                    ['العنوان',    selected.address || '—'],
                    ['المديونية',  formatCurrency(selected.total_due)],
                    ['المدفوع',    formatCurrency(selected.total_paid)],
                    ['الرصيد',     formatCurrency(calcBalance(selected))],
                  ] as [string, string][]
                ).map(([l, v]) => (
                  <div
                    key={l}
                    className="p-3 rounded-lg border border-matrix-border bg-matrix-dark"
                  >
                    <p className="text-xs text-matrix-subtle mb-1">{l}</p>
                    <p className="font-mono text-matrix-text">{v}</p>
                  </div>
                ))}
              </div>

              {/* Payment history */}
              <div>
                <p className="section-title">سجل الدفعات</p>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {!payments.length ? (
                    <p className="text-center text-sm text-matrix-subtle py-4">
                      لا توجد دفعات مسجلة
                    </p>
                  ) : (
                    payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex justify-between items-center p-3 rounded-lg border border-matrix-border bg-matrix-dark text-sm"
                      >
                        <div>
                          <p className="font-mono text-matrix-green font-bold">
                            {formatCurrency(p.amount)}
                          </p>
                          <p className="text-xs text-matrix-subtle mt-0.5">
                            {PAYMENT_TYPES.find((t) => t.value === p.payment_type)?.label ?? p.payment_type}
                            {p.reference && ` • ${p.reference}`}
                          </p>
                        </div>
                        <p className="text-xs font-mono text-matrix-subtle">
                          {formatDate(p.paid_at)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex gap-3 pt-2 border-t border-matrix-border">
                <button
                  onClick={() => { setDetailOpen(false); openEdit(selected); }}
                  className="flex-1 btn-secondary py-2 flex items-center justify-center gap-2 text-sm"
                >
                  <Pencil className="w-4 h-4" />تعديل البيانات
                </button>
                {canManage && (
                  <button
                    onClick={() => { setDetailOpen(false); setPayOpen(true); }}
                    className="flex-1 btn-primary py-2 flex items-center justify-center gap-2 text-sm"
                  >
                    <CreditCard className="w-4 h-4" />تسجيل دفعة
                  </button>
                )}
              </div>
            </div>
          )}
        </Modal>

      </div>
    </DashboardLayout>
  );
}

// ════════════════════════════════════════════════════════════
// Shared form fields component (Add + Edit)
// ════════════════════════════════════════════════════════════
function SupplierFormFields({
  form,
  onChange,
}: {
  form: SupplierForm;
  onChange: (key: keyof SupplierForm, value: string) => void;
}) {
  return (
    <div className="space-y-4">
      {SUPPLIER_FIELDS.map(({ k, l, p }) => (
        <div key={k}>
          <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
            {l}
          </label>
          <input
            type="text"
            value={form[k]}
            onChange={(e) => onChange(k, e.target.value)}
            placeholder={p}
            className="matrix-input"
          />
        </div>
      ))}
    </div>
  );
}
