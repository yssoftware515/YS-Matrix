'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { adminApi, type PlatformShowroom } from '@/lib/api';
import { formatDate, daysUntil, cn } from '@/lib/utils';

// Phase 2 (Delegated Platform Administrators): read-only showrooms list
// (platform_showroom:read) with license-health at a glance — mirrors
// /dashboard/showrooms but without mutation/impersonation, which stay
// reserved for the protected system authority.

export default function AdminShowroomsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-showrooms', { page, search }],
    queryFn: () => adminApi.getShowrooms({ page, limit: 15, search }),
  });

  const HEALTH_LABEL: Record<string, string> = { ACTIVE: 'نشط', EXPIRING_SOON: 'قريب الانتهاء', EXPIRED: 'منتهي', INACTIVE: 'معطل' };

  const rows = (data?.data || []).filter((s) => {
    if (!statusFilter) return true;
    return s.license_health.status === statusFilter;
  });

  const columns: Column<PlatformShowroom>[] = [
    { key: 'name', header: 'اسم المعرض', render: (r) => <div><p className="font-semibold">{r.name}</p><p className="text-xs text-matrix-subtle font-mono">{r.slug}</p></div> },
    { key: 'license', header: 'الترخيص', render: (r) => {
      const h = r.license_health;
      if (h.is_expired) return <span className="badge-red">منتهي — {daysUntil(r.license_expiry) * -1} يوم</span>;
      return <div><p className="text-xs font-mono text-matrix-subtle">{formatDate(r.license_expiry)}</p><span className={h.days_left <= 7 ? 'badge-amber' : 'badge-green'}>{h.days_left <= 7 ? `${h.days_left} يوم متبقي` : 'ساري'}</span></div>;
    } },
    { key: 'status', header: 'الحالة', align: 'center', render: (r) => <span className={r.is_active ? 'badge-green' : 'badge-red'}>{r.is_active ? 'نشط' : 'معطل'}</span> },
    { key: 'onboarded', header: 'الإعداد', align: 'center', hideOnMobile: true, render: (r) => <span className={r.is_onboarded ? 'badge-green' : 'badge-amber'}>{r.is_onboarded ? 'مكتمل' : 'ناقص'}</span> },
    { key: 'counts', header: 'الإحصائيات', hideOnMobile: true, render: (r) => <div className="flex gap-2 text-xs font-mono"><span className="text-matrix-cyan">{r._count.users} مستخدم</span><span className="text-matrix-amber">{r._count.inventory} مخزون</span><span className="text-matrix-green">{r._count.sales} بيع</span></div> },
  ];

  return (
    <DashboardLayout title="المعارض — منصة الإدارة">
      <div className="space-y-5">
        <div className="matrix-panel p-4 flex items-center gap-3 border border-matrix-purple/30 bg-matrix-purple/5">
          <Building2 className="w-5 h-5 text-matrix-purple shrink-0" />
          <p className="text-sm text-matrix-subtle">عرض فقط — إنشاء المعارض، الدخول إليها، وتبديل حالتها تبقى حصرية لمدير النظام.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[{ v: '', l: 'الكل' }, { v: 'ACTIVE', l: 'نشط' }, { v: 'EXPIRING_SOON', l: 'قريب الانتهاء' }, { v: 'EXPIRED', l: 'منتهي' }, { v: 'INACTIVE', l: 'معطل' }].map(({ v, l }) => (
            <button key={v} onClick={() => { setStatusFilter(v); setPage(1); }}
              className={cn('px-3 py-1.5 rounded text-xs border transition-all', statusFilter === v ? 'border-matrix-cyan text-matrix-cyan bg-matrix-cyan/10' : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan/40')}>
              {l}
            </button>
          ))}
        </div>

        <DataTable data={rows} columns={columns} loading={isLoading} searchable searchPlaceholder="بحث بالاسم..." onSearch={(q) => { setSearch(q); setPage(1); }} rowKey={(r) => r.id} emptyText="لا توجد معارض"
          pagination={data?.pagination ? { page: data.pagination.page, pages: data.pagination.pages, total: data.pagination.total, limit: data.pagination.limit, onPage: setPage } : undefined} />
      </div>
    </DashboardLayout>
  );
}