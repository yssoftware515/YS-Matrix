'use client';

// ============================================================
// YS-MATRIX ERP — Inactive Customers Page (NEW)
//
// This page did not exist before. The backend has always had a
// working `reactivateCustomer` endpoint (customer.routes.js: PATCH
// /customers/:id/reactivate, ownerOnly) and `listCustomers` already
// supports `include_inactive=true` — but the frontend never exposed
// either capability. Deactivating a customer on the main customers
// page was, in practice, a one-way trip.
//
// This page is OWNER+ only at the UI level (mirrors the backend's
// ownerOnly on the reactivate route) — STAFF users are redirected
// back rather than shown an empty/broken page.
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { useCustomerList, useReactivateCustomer } from '@/hooks/useCustomers';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import type { Customer } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export default function InactiveCustomersPage() {
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role);

  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Phase C.3 (C3-4): native window.confirm replaced with the project's
  // Modal convention — same copy, just the standard confirmation UX.
  const [reactivateConfirm, setReactivateConfirm] = useState<Customer | null>(null);

  // include_inactive: 'true' fetches ALL customers server-side, but
  // we still filter to is_active === false client-side below — this
  // page should show ONLY deactivated customers, not a mixed list.
  const { data, isLoading } = useCustomerList({
    page, limit: 20, search, include_inactive: 'true',
  });

  const reactivateMut = useReactivateCustomer();

  const inactiveCustomers = (data?.data || []).filter((c) => !c.is_active);

  const handleReactivate = (customer: Customer) => {
    if (reactivateMut.isPending) return;
    setReactivateConfirm(customer);
  };

  const confirmReactivate = () => {
    if (!reactivateConfirm) return;
    const customerId = reactivateConfirm.id;
    setReactivateConfirm(null);
    setReactivatingId(customerId);
    reactivateMut.mutate(customerId, { onSettled: () => setReactivatingId(null) });
  };

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'اسم العميل', render: (r) => <p className="font-semibold text-matrix-subtle">{r.name}</p> },
    { key: 'phone', header: 'الهاتف', render: (r) => <span className="font-mono text-xs text-matrix-subtle">{r.phone || '—'}</span> },
    { key: 'sales', header: 'المشتريات', align: 'center', render: (r) => <span className="badge-cyan">{r._count?.sales || 0}</span> },
    { key: 'created_at', header: 'تاريخ الإضافة', render: (r) => <span className="text-xs font-mono text-matrix-subtle">{formatDate(r.created_at)}</span> },
    {
      key: 'actions', header: '', align: 'center',
      render: (r) => {
        const isReactivating = reactivatingId === r.id && reactivateMut.isPending;
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

  if (!canManage) {
    return (
      <DashboardLayout title="العملاء المعطلين">
        <div className="text-center py-16 space-y-3">
          <p className="text-matrix-subtle text-sm">هذه الصفحة متاحة للمالك ومدير النظام فقط.</p>
          <Link href="/dashboard/customers" className="text-matrix-cyan text-xs inline-flex items-center gap-1 hover:underline">
            <ArrowRight className="w-3.5 h-3.5" /> العودة لصفحة العملاء
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="العملاء المعطلين">
      <div className="space-y-5">
        <Link
          href="/dashboard/customers"
          className="inline-flex items-center gap-2 text-xs text-matrix-subtle hover:text-matrix-cyan transition-colors"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          العودة لصفحة العملاء النشطين
        </Link>

        <DataTable
          data={inactiveCustomers}
          columns={columns}
          loading={isLoading}
          searchable
          searchPlaceholder="بحث بالاسم أو الهاتف..."
          onSearch={(q) => { setSearch(q); setPage(1); }}
          rowKey={(r) => r.id}
          emptyText="لا يوجد عملاء معطلين"
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
          title="إعادة تفعيل العميل"
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
            إعادة تفعيل العميل «<span className="text-matrix-text">{reactivateConfirm?.name}</span>»؟ سيظهر
            العميل في صفحات العملاء النشطين فوراً.
          </p>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
