'use client';

// ============================================================
// YS-MATRIX ERP — Customers Page (Active) — V2
//
// V2 CHANGES vs original (which had a structural mismatch with the
// real backend, confirmed via customer.service.js / customer.routes.js):
//   - "Delete" was never a real delete — customer.service.js's
//     deleteCustomer() only sets is_active: false; the row is never
//     removed. The button/messages/toasts now say "تعطيل" (deactivate)
//     consistently, matching what actually happens.
//   - Added a real path to the deactivated customers: previously,
//     once a customer was "deleted" there was NO way back in the UI,
//     even though the backend's reactivateCustomer endpoint existed
//     and worked. A banner link to /dashboard/customers/inactive
//     covers this.
//   - Deactivate button is now role-gated: customer.routes.js marks
//     both DELETE /customers/:id and PATCH /customers/:id/reactivate
//     as `ownerOnly`. STAFF users now see no deactivate button at all
//     (previously: any authenticated user saw it, and would only
//     discover the 403 after clicking).
//   - r.data unwrapping (`.then((r) => r.data)`) removed — V2 api.ts
//     resolves useCustomerList()'s query directly to Paginated<Customer>.
//   - Customer type now includes `notes` (real field on the backend
//     that the original form/detail view never showed at all).
//   - The "has sales" delete-guard is KEPT as a deliberate UI-level
//     safeguard, even though the backend itself doesn't enforce it —
//     deactivating an active customer with real purchase history
//     would silently remove them from every default list view while
//     their financial history stays live, which is confusing even if
//     technically reversible via reactivate.
// ============================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Eye, Pencil, Power, Loader2, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { ListError } from '@/components/ui/ListError';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  useCustomerList, useCreateCustomer, useUpdateCustomer, useDeactivateCustomer,
} from '@/hooks/useCustomers';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import type { Customer } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

// ─── Blank form ────────────────────────────────────────────────────────────────
const BLANK = { name: '', phone: '', national_id: '', address: '', notes: '' };

// ─── Shared input class ────────────────────────────────────────────────────────
const INPUT_CLS =
  'matrix-input border-matrix-cyan/20 focus:border-matrix-cyan/40 transition-colors duration-200';

// ─── Field definitions ─────────────────────────────────────────────────────────
const FIELDS = [
  { k: 'name',        l: 'اسم العميل *', p: 'محمود سيد'     },
  { k: 'phone',       l: 'الهاتف (اختياري)',       p: '01xxxxxxxxx'    },
  { k: 'national_id', l: 'رقم الهوية (اختياري)',   p: '29xxxxxxxxx'    },
  { k: 'address',     l: 'العنوان (اختياري)',      p: 'القاهرة، مصر'   },
];

export default function CustomersPage() {
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role); // OWNER + SUPER_ADMIN — matches backend's ownerOnly

  // ── List state ──────────────────────────────────────────────────────────────
  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState('');

  // F6 — GlobalSearch deep-links land here as ?search= — prefill the
  // list search so the result row is on screen immediately.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) setSearch(q);
  }, []);

  // ── Modal / form state ──────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [editId,  setEditId]  = useState<string | null>(null); // null = add mode
  const [detail,  setDetail]  = useState<Customer | null>(null);
  const [form,    setForm]    = useState(BLANK);

  // ── Track which customer is being deactivated ───────────────────────────────
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  // Phase C.3 (C3-4): native window.confirm replaced with the project's
  // Modal convention — same guard logic and copy.
  const [deactivateConfirm, setDeactivateConfirm] = useState<Customer | null>(null);

  // Phase C.1 (5B): debounce the search box — a request per keystroke
  // becomes one per typing pause.
  const debouncedSearch = useDebouncedValue(search);

  // ── Queries — active customers only (default backend behavior:
  // include_inactive is omitted, so customer.service.js applies
  // `where.is_active = true` automatically) ───────────────────────────────────
  const { data, isLoading, isError, refetch } = useCustomerList({ page, limit: 20, search: debouncedSearch });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMut = useCreateCustomer();
  const updateMut = useUpdateCustomer();
  const deactivateMut = useDeactivateCustomer();

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const closeFormModal = () => {
    setAddOpen(false);
    setEditId(null);
    setForm(BLANK);
  };

  const openAdd = () => {
    setForm(BLANK);
    setEditId(null);
    setAddOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setForm({
      name:        customer.name        || '',
      phone:       customer.phone       || '',
      national_id: customer.national_id || '',
      address:     customer.address     || '',
      notes:       customer.notes       || '',
    });
    setEditId(customer.id);
    setAddOpen(true);
  };

  // ── Submit: add or update ────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error('اسم العميل مطلوب'); return; }
    if (editId) {
      if (updateMut.isPending) return;
      updateMut.mutate({ id: editId, payload: form }, { onSuccess: () => { closeFormModal(); setDetail(null); } });
    } else {
      if (createMut.isPending) return;
      createMut.mutate(form, { onSuccess: closeFormModal });
    }
  };

  // ── Deactivate: integrity guard (UI-level, see header note) + confirm ───────
  const handleDeactivate = (customer: Customer) => {
    if (!canManage) return; // defense in depth — button is hidden anyway
    if (deactivateMut.isPending) return;

    if ((customer._count?.sales ?? 0) > 0) {
      toast.error('لا يمكن تعطيل عميل لديه تعاملات مالية مسجلة في النظام!');
      return;
    }

    setDeactivateConfirm(customer);
  };

  const confirmDeactivate = () => {
    if (!deactivateConfirm) return;
    const customerId = deactivateConfirm.id;
    setDeactivateConfirm(null);
    setDeactivatingId(customerId);
    deactivateMut.mutate(customerId, {
      onSuccess: () => setDetail(null),
      onSettled: () => setDeactivatingId(null),
    });
  };

  const isFormPending = createMut.isPending || updateMut.isPending;

  // ── Columns ──────────────────────────────────────────────────────────────────
  const columns: Column<Customer>[] = [
    { key: 'name', header: 'اسم العميل', render: (r) => <p className="font-semibold">{r.name}</p> },
    { key: 'phone', header: 'الهاتف', render: (r) => <span className="font-mono text-xs">{r.phone || '—'}</span> },
    ...(canManage ? [{ key: 'national_id', header: 'الهوية', render: (r: Customer) => <span className="font-mono text-xs text-matrix-subtle">{r.national_id || '—'}</span> }] : []),
    { key: 'address', header: 'العنوان', render: (r) => <span className="text-sm text-matrix-subtle">{r.address || '—'}</span> },
    { key: 'sales', header: 'المشتريات', align: 'center', render: (r) => <span className="badge-cyan">{r._count?.sales || 0}</span> },
    { key: 'created_at', header: 'تاريخ الإضافة', render: (r) => <span className="text-xs font-mono text-matrix-subtle">{formatDate(r.created_at)}</span> },
    {
      key: 'actions', header: '', align: 'center',
      render: (r) => {
        const isDeactivating = deactivatingId === r.id && deactivateMut.isPending;
        return (
          <div className="flex items-center gap-1.5 justify-center">
            <button
              onClick={(e) => { e.stopPropagation(); setDetail(r); }}
              className="px-2 py-1 rounded text-xs border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
            >
              <Eye className="w-3 h-3 inline ml-1"/>تفاصيل
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}
              className="px-2 py-1 rounded text-xs border border-matrix-border text-matrix-subtle hover:border-matrix-amber hover:text-matrix-amber transition-all"
            >
              <Pencil className="w-3 h-3 inline ml-1"/>تعديل
            </button>

            {/* Deactivate — OWNER+ only, matches backend's ownerOnly middleware */}
            {canManage && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDeactivate(r); }}
                disabled={deactivateMut.isPending}
                className={cn(
                  'px-2 py-1 rounded text-xs border transition-all flex items-center gap-1',
                  isDeactivating
                    ? 'border-matrix-red/40 text-matrix-red cursor-not-allowed opacity-70'
                    : 'border-matrix-border text-matrix-subtle hover:border-matrix-red hover:text-matrix-red',
                  deactivateMut.isPending && !isDeactivating && 'opacity-40 cursor-not-allowed',
                )}
                title="تعطيل العميل"
              >
                {isDeactivating ? <Loader2 className="w-3 h-3 animate-spin"/> : <Power className="w-3 h-3"/>}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <DashboardLayout title="العملاء">
      <div className="space-y-5">

        {/* Link to deactivated customers — the path back that the
            original page never provided */}
        <Link
          href="/dashboard/customers/inactive"
          className="inline-flex items-center gap-2 text-xs text-matrix-subtle hover:text-matrix-cyan transition-colors"
        >
          <UserX className="w-3.5 h-3.5" />
          عرض العملاء المعطلين
        </Link>

        {/* Phase C.1 (5A): a failed query must read as an error, not
            as an empty table. */}
        {isError ? (
          <ListError message="تعذر تحميل العملاء" onRetry={() => refetch()} />
        ) : (
        <DataTable
          data={data?.data || []}
          columns={columns}
          loading={isLoading}
          searchable
          searchPlaceholder="بحث بالاسم أو الهاتف..."
          onSearch={(q) => { setSearch(q); setPage(1); }}
          rowKey={(r) => r.id}
          emptyText="لا يوجد عملاء"
          pagination={data?.pagination ? {
            page:  data.pagination.page,  pages: data.pagination.pages,
            total: data.pagination.total, limit: data.pagination.limit,
            onPage: setPage,
          } : undefined}
          actions={
            <button onClick={openAdd} className="btn-primary flex items-center gap-2 py-2">
              <Plus className="w-4 h-4"/>إضافة عميل
            </button>
          }
        />
        )}

        {/* ── ADD / EDIT MODAL ──────────────────────────────────────────── */}
        <Modal
          open={addOpen}
          onClose={() => { if (!isFormPending) closeFormModal(); }}
          title={editId ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
          size="md"
          footer={
            <>
              <button onClick={closeFormModal} disabled={isFormPending} className="btn-secondary py-2 disabled:opacity-40 disabled:cursor-not-allowed">
                إلغاء
              </button>
              <button
                onClick={handleSubmit}
                disabled={isFormPending}
                className={cn('btn-primary py-2 flex items-center gap-2 min-w-[140px] justify-center', 'disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200')}
              >
                {isFormPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin shrink-0"/>{editId ? 'جاري التحديث...' : 'جاري الحفظ...'}</>
                ) : (
                  editId ? 'حفظ التعديلات' : 'حفظ'
                )}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {FIELDS.map(({ k, l, p }) => (
              <div key={k}>
                <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">{l}</label>
                <input
                  type="text"
                  value={(form as Record<string, string>)[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  placeholder={p}
                  className={INPUT_CLS}
                />
              </div>
            ))}
            {/* notes — real backend field, was missing from the original form entirely */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">ملاحظات (اختياري)</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="أي ملاحظات إضافية عن العميل..."
                className={cn(INPUT_CLS, 'resize-none')}
              />
            </div>
          </div>
        </Modal>

        {/* ── DETAIL MODAL ──────────────────────────────────────────────── */}
        <Modal
          open={!!detail}
          onClose={() => { if (!deactivateMut.isPending) setDetail(null); }}
          title={'عميل: ' + (detail?.name || '')}
          size="md"
          footer={
            detail ? (
              <div className="flex gap-2 w-full justify-end">
                <button onClick={() => { openEdit(detail); setDetail(null); }} className="btn-secondary py-2 flex items-center gap-2">
                  <Pencil className="w-4 h-4"/>تعديل البيانات
                </button>

                {canManage && (
                  <button
                    onClick={() => handleDeactivate(detail)}
                    disabled={deactivateMut.isPending}
                    className={cn('btn-danger py-2 flex items-center gap-2 min-w-[140px] justify-center', 'disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200')}
                  >
                    {deactivatingId === detail.id && deactivateMut.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin shrink-0"/>جاري التعطيل...</>
                    ) : (
                      <><Power className="w-4 h-4"/>تعطيل العميل</>
                    )}
                  </button>
                )}
              </div>
            ) : undefined
          }
        >
          {detail && (
            <div className="space-y-3">
              {([
                ['الهاتف',          detail.phone       || '—'],
                ...(canManage ? [['رقم الهوية', detail.national_id || '—']] : []),
                ['العنوان',         detail.address     || '—'],
                ['ملاحظات',         detail.notes       || '—'],
                ['عدد المشتريات',   String(detail._count?.sales || 0)],
                ['تاريخ الإضافة',   formatDate(detail.created_at)],
              ] as [string, string][]).map(([l, v]) => (
                <div key={l} className="flex justify-between p-3 rounded-lg border border-matrix-border bg-matrix-dark text-sm">
                  <span className="text-matrix-subtle">{l}</span>
                  <span className="font-mono">{v}</span>
                </div>
              ))}

              {(detail._count?.sales ?? 0) > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-matrix-amber/30 bg-matrix-amber/5 text-xs text-matrix-amber" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  <span className="shrink-0 mt-0.5">⚠</span>
                  <span>هذا العميل لديه {detail._count!.sales} معاملة مالية — لا يمكن تعطيله من النظام.</span>
                </div>
              )}
            </div>
          )}
        </Modal>

        {/* ── Phase C.3 (C3-4): deactivate confirmation modal ── */}
        <Modal
          open={deactivateConfirm !== null}
          onClose={() => setDeactivateConfirm(null)}
          title="تعطيل العميل"
          size="sm"
          footer={
            <>
              <button
                onClick={() => setDeactivateConfirm(null)}
                className="px-4 py-2 min-h-[44px] rounded-lg border border-matrix-border text-xs font-mono text-matrix-subtle hover:text-matrix-text transition-all"
              >
                تراجع
              </button>
              <button
                onClick={confirmDeactivate}
                disabled={deactivateMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg border border-matrix-red/40 text-xs font-mono text-matrix-red hover:bg-matrix-red/10 transition-all disabled:opacity-40"
              >
                {deactivateMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                نعم، تعطيل العميل
              </button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-matrix-subtle">
            هل أنت متأكد من تعطيل العميل «<span className="text-matrix-text">{deactivateConfirm?.name}</span>»؟
            يمكن إعادة تفعيله لاحقاً من صفحة العملاء المعطلين.
          </p>
        </Modal>

      </div>
    </DashboardLayout>
  );
}
