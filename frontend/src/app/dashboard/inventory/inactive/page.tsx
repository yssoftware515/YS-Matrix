'use client';

// ============================================================
// YS-MATRIX ERP — Inactive Inventory Page (NEW, FP-01)
//
// The backend has always had a working PATCH /inventory/:id/reactivate
// (ownerOnly, inventory.routes.js) and listInventory already accepts
// include_inactive — but the frontend never exposed either. Deleting
// an inventory item was, in practice, a one-way trip (FP-01/FP-02),
// despite the backend only ever setting is_active: false.
//
// Gated OWNER+ at the UI level to mirror the backend's ownerOnly on
// the reactivate route itself (same reasoning as customers/inactive).
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, RotateCcw, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { inventoryApi, isApiRequestError, type InventoryItem } from '@/lib/api';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import { formatCurrency, vehicleTypeLabel } from '@/lib/utils';

export default function InactiveInventoryPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role);

  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Phase C.3 (C3-4): native window.confirm replaced with the project's
  // Modal convention — same copy, just the standard confirmation UX.
  const [reactivateConfirm, setReactivateConfirm] = useState<InventoryItem | null>(null);

  // include_inactive: 'true' fetches ALL items server-side, but we
  // still filter to is_active === false client-side below — this
  // page should show ONLY archived items, not a mixed list.
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', { page, search, include_inactive: 'true' }],
    queryFn:  () => inventoryApi.getAll({ page, limit: 20, search, include_inactive: 'true' }),
    enabled:  canManage,
  });

  const reactivateMut = useMutation({
    mutationFn: (id: string) => inventoryApi.reactivate(id),
    onSuccess: () => {
      toast.success('تم إعادة تفعيل المنتج بنجاح');
      // Matches the query keys used on the main inventory page
      // (inventory-page.tsx) so both lists and the KPI stats refresh.
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inv-stats'] });
      qc.invalidateQueries({ queryKey: ['inv-low-stock'] });
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل إعادة التفعيل'),
  });

  const inactiveItems = (data?.data || []).filter((i) => !i.is_active);

  const handleReactivate = (item: InventoryItem) => {
    if (reactivateMut.isPending) return;
    setReactivateConfirm(item);
  };

  const confirmReactivate = () => {
    if (!reactivateConfirm) return;
    const itemId = reactivateConfirm.id;
    setReactivateConfirm(null);
    setReactivatingId(itemId);
    reactivateMut.mutate(itemId, { onSettled: () => setReactivatingId(null) });
  };

  const columns: Column<InventoryItem>[] = [
    {
      key: 'item', header: 'المنتج',
      render: (r) => <p className="font-semibold text-matrix-subtle">{r.brand} {r.model}</p>,
    },
    {
      key: 'vehicle_type', header: 'النوع',
      render: (r) => <span className="badge-cyan">{vehicleTypeLabel[r.vehicle_type] || r.vehicle_type}</span>,
    },
    {
      key: 'chassis_number', header: 'رقم الشاصي',
      render: (r) => <span className="font-mono text-xs text-matrix-subtle">{r.chassis_number || '—'}</span>,
    },
    {
      key: 'selling_price', header: 'سعر البيع',
      render: (r) => <span className="font-mono text-matrix-cyan">{formatCurrency(r.selling_price)}</span>,
    },
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
      <DashboardLayout title="المنتجات المعطلة">
        <div className="text-center py-16 space-y-3">
          <p className="text-matrix-subtle text-sm">هذه الصفحة متاحة للمالك ومدير النظام فقط.</p>
          <Link href="/dashboard/inventory" className="text-matrix-cyan text-xs inline-flex items-center gap-1 hover:underline">
            <ArrowRight className="w-3.5 h-3.5" /> العودة لصفحة المخزون
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="المنتجات المعطلة">
      <div className="space-y-5">
        <Link
          href="/dashboard/inventory"
          className="inline-flex items-center gap-2 text-xs text-matrix-subtle hover:text-matrix-cyan transition-colors"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          العودة لصفحة المخزون النشط
        </Link>

        <DataTable
          data={inactiveItems}
          columns={columns}
          loading={isLoading}
          searchable
          searchPlaceholder="بحث بالماركة أو الموديل..."
          onSearch={(q) => { setSearch(q); setPage(1); }}
          rowKey={(r) => r.id}
          emptyText="لا توجد منتجات معطلة"
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
          title="إعادة تفعيل المنتج"
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
            إعادة تفعيل «<span className="text-matrix-text">{reactivateConfirm?.brand} {reactivateConfirm?.model}</span>»؟
            سيظهر المنتج في المخزون النشط فوراً.
          </p>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
