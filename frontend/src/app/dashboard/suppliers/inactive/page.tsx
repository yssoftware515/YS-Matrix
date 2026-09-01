'use client';

// ============================================================
// YS-MATRIX ERP — Inactive Suppliers Page (NEW)
//
// Same pattern as customers/inactive/page.tsx — the backend has
// always had a working reactivateSupplier endpoint (PATCH
// /suppliers/:id/reactivate, confirmed in supplier.controller.js)
// and listSuppliers already supports include_inactive=true, but the
// frontend never exposed either capability. Deactivating a supplier
// on the main page was, in practice, a one-way trip.
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { suppliersApi, isApiRequestError, type Supplier } from '@/lib/api';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import { formatCurrency } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

export default function InactiveSuppliersPage() {
  const qc = useQueryClient();
  // Phase C.6 (P1): reactivate is ownerOnly on the backend
  // (supplier.routes.js) — the action button is hidden for STAFF
  // (read-only list stays readable), same pattern as the main page.
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role);
  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Phase C.3 (C3-4): native window.confirm replaced with the project's
  // Modal convention — same copy, just the standard confirmation UX.
  const [reactivateConfirm, setReactivateConfirm] = useState<Supplier | null>(null);

  // include_inactive: 'true' fetches ALL suppliers server-side, but
  // we still filter to is_active === false client-side below — this
  // page should show ONLY deactivated suppliers.
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', { page, search, include_inactive: 'true' }],
    queryFn:  () => suppliersApi.getAll({ page, limit: 20, search, include_inactive: 'true' }),
  });

  const reactivateMut = useMutation({
    mutationFn: (id: string) => suppliersApi.reactivate(id),
    onSuccess: () => {
      toast.success('تم إعادة تفعيل المورد بنجاح');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier-stats'] });
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل إعادة التفعيل'),
  });

  const inactiveSuppliers = (data?.data || []).filter((s) => !s.is_active);

  const handleReactivate = (supplier: Supplier) => {
    if (reactivateMut.isPending) return;
    setReactivateConfirm(supplier);
  };

  const confirmReactivate = () => {
    if (!reactivateConfirm) return;
    const supplierId = reactivateConfirm.id;
    setReactivateConfirm(null);
    setReactivatingId(supplierId);
    reactivateMut.mutate(supplierId, { onSettled: () => setReactivatingId(null) });
  };

  const columns: Column<Supplier>[] = [
    { key: 'name', header: 'اسم المورد', render: (r) => <p className="font-semibold text-matrix-subtle">{r.name}</p> },
    { key: 'phone', header: 'الهاتف', render: (r) => <span className="font-mono text-xs text-matrix-subtle">{r.phone || '—'}</span> },
    { key: 'total_due', header: 'المديونية', render: (r) => <span className="font-mono text-matrix-amber">{formatCurrency(r.total_due)}</span> },
    { key: 'inventory', header: 'المخزون المرتبط', align: 'center', render: (r) => <span className="badge-cyan">{r._count?.inventory ?? 0}</span> },
    {
      key: 'actions', header: '', align: 'center',
      render: (r) => {
        const isReactivating = reactivatingId === r.id && reactivateMut.isPending;
        if (!canManage) return null;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); handleReactivate(r); }}
            disabled={reactivateMut.isPending}
            className="px-2 py-1 rounded text-xs border border-matrix-green/30 text-matrix-green hover:bg-matrix-green/10 transition-all disabled:opacity-40 flex items-center gap-1 mx-auto"
          >
            {isReactivating ? <Loader2 className="w-3 h-3 animate-spin"/> : <RotateCcw className="w-3 h-3"/>}
            إعادة تفعيل
          </button>
        );
      },
    },
  ];

  return (
    <DashboardLayout title="الموردون المعطلون">
      <div className="space-y-5">
        <Link
          href="/dashboard/suppliers"
          className="inline-flex items-center gap-2 text-xs text-matrix-subtle hover:text-matrix-cyan transition-colors"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          العودة لصفحة الموردين النشطين
        </Link>

        <DataTable
          data={inactiveSuppliers}
          columns={columns}
          loading={isLoading}
          searchable
          searchPlaceholder="بحث بالاسم أو الهاتف..."
          onSearch={(q) => { setSearch(q); setPage(1); }}
          rowKey={(r) => r.id}
          emptyText="لا يوجد موردون معطلون"
          pagination={data?.pagination ? {
            page:  data.pagination.page,  pages: data.pagination.pages,
            total: data.pagination.total, limit: data.pagination.limit,
            onPage: setPage,
          } : undefined}
        />

        {/* ── Phase C.3 (C3-4): reactivation confirmation modal ── */}
        <Modal
          open={reactivateConfirm !== null}
          onClose={() => setReactivateConfirm(null)}
          title="إعادة تفعيل المورد"
          size="sm"
          footer={
            <>
              <button
                onClick={() => setReactivateConfirm(null)}
                className="px-4 py-2 min-h-[44px] rounded-lg border border-matrix-border text-xs font-mono text-matrix-subtle hover:text-matrix-text transition-all"
              >
                تراجع
              </button>
              <button
                onClick={confirmReactivate}
                disabled={reactivateMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg border border-matrix-green/40 text-xs font-mono text-matrix-green hover:bg-matrix-green/10 transition-all disabled:opacity-40"
              >
                {reactivateMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                نعم، إعادة التفعيل
              </button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-matrix-subtle">
            إعادة تفعيل المورد «<span className="text-matrix-text">{reactivateConfirm?.name}</span>»؟ سيظهر
            المورد في صفحة الموردين النشطين فوراً.
          </p>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
