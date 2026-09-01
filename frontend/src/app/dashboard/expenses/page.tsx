'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wallet, Pencil, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal } from '@/components/ui/Modal';
import { ListError } from '@/components/ui/ListError';
import { analyticsApi, type Expense } from '@/lib/api';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import { formatCurrency, formatDate, cn } from '@/lib/utils';

// ─── Constants ─────────────────────────────────────────────────────────────────
const CATS = [
  'إيجار', 'رواتب', 'كهرباء وماء', 'صيانة',
  'تسويق', 'نقل', 'متفرقات', 'أخرى',
];

// قفل المصفوفة بـ as const لحل مشكلة الـ opt.value في الـ Tabs
const RANGES = [
  { value: 'today', label: 'اليوم'   },
  { value: 'week',  label: 'الأسبوع' },
  { value: 'month', label: 'الشهر'   },
  { value: 'year',  label: 'السنة'   },
] as const; 

const TODAY       = () => new Date().toISOString().split('T')[0];
const BLANK_FORM  = () => ({ category: '', description: '', amount: '', expense_date: TODAY() });

// ─── Shared input class ────────────────────────────────────────────────────────
const INPUT_CLS =
  'matrix-input border-matrix-cyan/20 focus:border-matrix-cyan/40 transition-colors duration-200';

// ─── Form fields definition ────────────────────────────────────────────────────
type FormState = { category: string; description: string; amount: string; expense_date: string };

// ─── Component ─────────────────────────────────────────────────────────────────
export default function ExpensesPage() {
  const qc = useQueryClient();
  // Phase C.6 (P1): expense write routes (create/update/delete) are
  // ownerOnly on the backend (analytics.routes.js) — the page previously
  // showed the write buttons to STAFF, who discovered the 403 only after
  // clicking. Same customers-page pattern: OWNER + SUPER_ADMIN only,
  // backend stays the authoritative boundary.
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role);

  // ── List state ──────────────────────────────────────────────────────────────
  const [page,  setPage]  = useState(1);
  const [range, setRange] = useState<'today' | 'week' | 'month' | 'year'>('month');

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [addOpen,    setAddOpen]    = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // ── Selected expense ────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Expense | null>(null);

  // ── Forms ───────────────────────────────────────────────────────────────────
  const [addForm,  setAddForm]  = useState<FormState>(BLANK_FORM());
  const [editForm, setEditForm] = useState<FormState>(BLANK_FORM());

  // ── Invalidate all related queries ─────────────────────────────────────────
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['expenses']       });
    qc.invalidateQueries({ queryKey: ['expense-stats']  });
  };

  // ── Queries ─────────────────────────────────────────────────────────────────
  // V2 SHAPE: analyticsApi.getExpenses() resolves directly to
  // Paginated<Expense> = { data, pagination }. The previous
  // `.then((r) => r.data)` was reaching one level too far in — it
  // extracted just the array, silently dropping `pagination`, which
  // is why `data?.pagination?.total` below would always have
  // rendered as 0/undefined even when expenses existed.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['expenses', { page, range }],
    queryFn: () => analyticsApi.getExpenses({ page, limit: 20, range }),
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (d: Record<string, unknown>) => analyticsApi.createExpense(d),
    onSuccess: () => {
      toast.success('تم تسجيل المصروف');
      invalidateAll();
      setAddOpen(false);
      setAddForm(BLANK_FORM());
    },
    onError: () => toast.error('فشل الحفظ'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Record<string, unknown> }) => analyticsApi.updateExpense(id, d),
    onSuccess: () => {
      toast.success('تم تحديث المصروف');
      invalidateAll();
      setEditOpen(false);
      setSelected(null);
    },
    onError: () => toast.error('فشل التحديث'),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => analyticsApi.removeExpense(id),
    onSuccess: () => {
      toast.success('تم حذف المصروف');
      invalidateAll();
      setDeleteOpen(false);
      setSelected(null);
    },
    onError: () => toast.error('فشل الحذف'),
  });

  // ── Action handlers ──────────────────────────────────────────────────────────
  const openEdit = (expense: Expense) => {
    setSelected(expense);
    setEditForm({
      category:     expense.category,
      description:  expense.description ?? '',
      amount:       String(expense.amount),
      expense_date: expense.expense_date.split('T')[0],
    });
    setEditOpen(true);
  };

  const openDelete = (expense: Expense) => {
    setSelected(expense);
    setDeleteOpen(true);
  };

  const handleAdd = () => {
    if (createMut.isPending) return;
    if (!addForm.category || !addForm.amount) {
      toast.error('الفئة والمبلغ مطلوبان');
      return;
    }
    createMut.mutate({ ...addForm, amount: parseFloat(addForm.amount) });
  };

  const handleUpdate = () => {
    if (updateMut.isPending || !selected) return;
    if (!editForm.category || !editForm.amount) {
      toast.error('الفئة والمبلغ مطلوبان');
      return;
    }
    updateMut.mutate({
      id: selected.id,
      d: { ...editForm, amount: parseFloat(editForm.amount) },
    });
  };

  const handleRemove = () => {
    if (removeMut.isPending || !selected) return;
    removeMut.mutate(selected.id);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  // Phase C.4 (EXP-2): the total now comes from the SERVER — an exact
  // database aggregate over the filtered set (pagination.total_amount),
  // replacing the old client-side sum of the CURRENT PAGE's rows only,
  // which silently shrank as the page flipped. Falls back to 0 while
  // loading or if an older backend shape is ever hit.
  const total = data?.pagination?.total_amount ?? 0;

  // ── Columns ──────────────────────────────────────────────────────────────────
  const columns: Column<Expense>[] = [
    {
      key: 'category', header: 'الفئة',
      render: (r) => <span className="badge-cyan">{r.category}</span>,
    },
    {
      key: 'description', header: 'الوصف',
      render: (r) => <span className="text-sm text-matrix-subtle">{r.description || '—'}</span>,
    },
    {
      key: 'amount', header: 'المبلغ',
      render: (r) => <span className="font-mono font-bold text-matrix-red">{formatCurrency(r.amount)}</span>,
    },
    {
      key: 'expense_date', header: 'التاريخ',
      render: (r) => <span className="text-xs font-mono text-matrix-subtle">{formatDate(r.expense_date)}</span>,
    },
    {
      key: 'actions', header: '', align: 'center',
      render: (r) => (
        <div className="flex items-center gap-1.5 justify-center">
          {/* Edit — OWNER+ only (matches backend ownerOnly) */}
          {canManage && (
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}
              disabled={updateMut.isPending || removeMut.isPending}
              className="px-2 py-1 rounded text-xs border border-matrix-border text-matrix-subtle hover:border-matrix-amber hover:text-matrix-amber transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Pencil className="w-3 h-3 inline ml-1"/>تعديل
            </button>
          )}
          {/* Delete — OWNER+ only */}
          {canManage && (
            <button
              onClick={(e) => { e.stopPropagation(); openDelete(r); }}
              disabled={createMut.isPending || updateMut.isPending || removeMut.isPending}
              className={cn(
                'px-2 py-1 rounded text-xs border transition-all flex items-center gap-1',
                removeMut.isPending
                  ? 'border-matrix-border text-matrix-subtle/30 cursor-not-allowed'
                  : 'border-matrix-border text-matrix-subtle hover:border-matrix-red hover:text-matrix-red',
              )}
            >
              <Trash2 className="w-3 h-3"/>
            </button>
          )}
        </div>
      ),
    },
  ];

  // Phase C.1 (5E): the SaveMode wiring was dead code here — this page
  // saves every change immediately through the mutations above; the
  // bar/`markDirty` calls could never do anything but sit on screen.
  const renderFormFields = (
    form: FormState,
    setForm: (f: FormState) => void,
  ) => (
    <div className="space-y-4">

      {/* Category */}
      <div>
        <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
          الفئة *
        </label>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className={INPUT_CLS}
        >
          <option value="">اختر الفئة</option>
          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Amount */}
      <div>
        <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
          المبلغ *
        </label>
        <input
          type="number" value={form.amount} dir="ltr" placeholder="0"
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className={INPUT_CLS}
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
          الوصف
        </label>
        <input
          type="text" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className={INPUT_CLS}
        />
      </div>

      {/* Date */}
      <div>
        <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
          التاريخ
        </label>
        <input
          type="date" value={form.expense_date} dir="ltr"
          onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
          className={INPUT_CLS}
        />
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout title="المصاريف">
      <div className="space-y-5">

        {/* ── Range tabs ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {RANGES.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setRange(opt.value); setPage(1); }}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-mono border transition-all',
                range === opt.value
                  ? 'border-matrix-cyan/50 bg-matrix-cyan/10 text-matrix-cyan'
                  : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan/30 hover:text-matrix-cyan',
              )}
              style={range === opt.value ? { boxShadow: '0 0 10px rgba(0,212,255,0.07)' } : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* ── KPI Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <KpiCard title="إجمالي المصاريف" value={formatCurrency(total)}            icon={<Wallet className="w-5 h-5"/>} color="red"   delay={0}    />
          <KpiCard title="عدد المصاريف"    value={data?.pagination?.total || 0}     icon={<Wallet className="w-5 h-5"/>} color="amber" delay={0.08} />
        </div>

        {/* ── Data Table ────────────────────────────────────────────────── */}
        {isError ? (
          <ListError message="تعذر تحميل المصاريف" onRetry={() => refetch()} />
        ) : (
        <DataTable
          data={data?.data || []}
          columns={columns}
          loading={isLoading}
          rowKey={(r) => r.id}
          emptyText="لا توجد مصاريف"
          pagination={data?.pagination ? {
            page:  data.pagination.page,  pages: data.pagination.pages,
            total: data.pagination.total, limit: data.pagination.limit,
            onPage: setPage,
          } : undefined}
          actions={
            canManage ? (
              <button onClick={() => { setAddForm(BLANK_FORM()); setAddOpen(true); }} className="btn-primary flex items-center gap-2 py-2">
                <Plus className="w-4 h-4"/>إضافة مصروف
              </button>
            ) : undefined
          }
        />
        )}

        {/* ADD MODAL */}
        <Modal
          open={addOpen}
          onClose={() => { if (!createMut.isPending) { setAddOpen(false); setAddForm(BLANK_FORM()); } }}
          title="إضافة مصروف جديد"
          size="md"
          footer={
            <>
              <button
                onClick={() => { setAddOpen(false); setAddForm(BLANK_FORM()); }}
                disabled={createMut.isPending}
                className="btn-secondary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                إلغاء
              </button>
              <button
                onClick={handleAdd}
                disabled={createMut.isPending}
                className="btn-primary py-2 flex items-center gap-2 min-w-[120px] justify-center disabled:opacity-70 disabled:cursor-not-allowed transition-all"
              >
                {createMut.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin"/><span>جاري الحفظ...</span></>
                  : 'حفظ'}
              </button>
            </>
          }
        >
          {renderFormFields(addForm, setAddForm)}
        </Modal>

        {/* EDIT MODAL */}
        <Modal
          open={editOpen}
          onClose={() => { if (!updateMut.isPending) { setEditOpen(false); setSelected(null); } }}
          title={'تعديل مصروف: ' + (selected?.category || '')}
          size="md"
          footer={
            <>
              <button
                onClick={() => { setEditOpen(false); setSelected(null); }}
                disabled={updateMut.isPending}
                className="btn-secondary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                إلغاء
              </button>
              <button
                onClick={handleUpdate}
                disabled={updateMut.isPending}
                className="btn-primary py-2 flex items-center gap-2 min-w-[150px] justify-center disabled:opacity-70 disabled:cursor-not-allowed transition-all"
              >
                {updateMut.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin"/><span>جاري التحديث...</span></>
                  : 'حفظ التعديلات'}
              </button>
            </>
          }
        >
          {renderFormFields(editForm, setEditForm)}
        </Modal>

        {/* DELETE CONFIRMATION MODAL */}
        <Modal
          open={deleteOpen}
          onClose={() => { if (!removeMut.isPending) { setDeleteOpen(false); setSelected(null); } }}
          title="تأكيد الحذف"
          size="sm"
          footer={
            <>
              <button
                onClick={() => { setDeleteOpen(false); setSelected(null); }}
                disabled={removeMut.isPending}
                className="btn-secondary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                إلغاء
              </button>
              <button
                onClick={handleRemove}
                disabled={removeMut.isPending}
                className="btn-danger py-2 flex items-center gap-2 min-w-[130px] justify-center disabled:opacity-70 disabled:cursor-not-allowed transition-all"
              >
                {removeMut.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin"/><span>جاري الحذف...</span></>
                  : <><Trash2 className="w-4 h-4"/>تأكيد الحذف</>}
              </button>
            </>
          }
        >
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-center w-14 h-14 mx-auto rounded-full border border-matrix-red/30 bg-matrix-red/10">
                <AlertTriangle className="w-7 h-7 text-matrix-red"/>
              </div>

              <p className="text-center text-sm text-matrix-subtle">
                هل أنت متأكد من حذف هذا المصروف؟ لا يمكن التراجع.
              </p>

              <div className="space-y-2">
                {([
                  ['الفئة',   selected.category],
                  ['المبلغ',  formatCurrency(selected.amount)],
                  ['التاريخ', formatDate(selected.expense_date)],
                  ...(selected.description ? [['الوصف', selected.description]] : []),
                ] as [string, string][]).map(([l, v]) => (
                  <div
                    key={l}
                    className="flex justify-between px-3 py-2 rounded-lg border border-matrix-border bg-matrix-dark text-sm"
                  >
                    <span className="text-matrix-subtle">{l}</span>
                    <span className={cn(
                      'font-mono',
                      l === 'المبلغ' ? 'text-matrix-red font-bold' : 'text-matrix-text',
                    )}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>

      </div>
    </DashboardLayout>
  );
}