'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { adminApi, type SuperAdminUser } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// Phase 2 (Delegated Platform Administrators): read-only cross-showroom
// user list (platform_user:read). Mirrors the SuperAdmin surface but
// under the /admin gate.

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'مدير النظام', OWNER: 'صاحب معرض', STAFF: 'موظف' };

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', { page, search, role: roleFilter }],
    queryFn: () => adminApi.getUsers({ page, limit: 15, search, role: roleFilter as 'OWNER' | 'STAFF' | '' }),
  });

  const columns: Column<SuperAdminUser>[] = [
    { key: 'name', header: 'الاسم', render: (r) => <p className="font-semibold">{r.name}</p> },
    { key: 'email', header: 'البريد', render: (r) => <span className="text-xs font-mono text-matrix-subtle" dir="ltr">{r.email}</span> },
    { key: 'role', header: 'الدور', align: 'center', render: (r) => <span className={r.role === 'OWNER' ? 'badge-amber' : 'badge-cyan'}>{ROLE_LABEL[r.role] || r.role}</span> },
    { key: 'showroom', header: 'المعرض', render: (r) => <span className="text-xs text-matrix-subtle">{r.showroom?.name || '—'}</span> },
    { key: 'is_active', header: 'الحالة', align: 'center', render: (r) => <span className={r.is_active ? 'badge-green' : 'badge-red'}>{r.is_active ? 'نشط' : 'معطل'}</span> },
    { key: 'last_login', header: 'آخر دخول', hideOnMobile: true, render: (r) => <span className="text-xs font-mono text-matrix-subtle">{r.last_login ? formatDate(r.last_login) : '—'}</span> },
  ];

  return (
    <DashboardLayout title="المستخدمون — منصة الإدارة">
      <div className="space-y-5">
        <div className="matrix-panel p-4 flex items-center gap-3 border border-matrix-green/30 bg-matrix-green/5">
          <Users className="w-5 h-5 text-matrix-green shrink-0" />
          <p className="text-sm text-matrix-subtle">عرض فقط — إدارة المستخدمين تبقى ضمن نطاق مدير النظام وحسابات المعارض نفسها.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[{ v: '', l: 'الكل' }, { v: 'OWNER', l: 'صاحب معرض' }, { v: 'STAFF', l: 'موظف' }].map(({ v, l }) => (
            <button key={v} onClick={() => { setRoleFilter(v); setPage(1); }}
              className={`px-3 py-1.5 rounded text-xs border transition-all ${roleFilter === v ? 'border-matrix-cyan text-matrix-cyan bg-matrix-cyan/10' : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan/40'}`}>
              {l}
            </button>
          ))}
        </div>

        <DataTable data={data?.data || []} columns={columns} loading={isLoading} searchable searchPlaceholder="بحث بالاسم أو البريد..." onSearch={(q) => { setSearch(q); setPage(1); }} rowKey={(r) => r.id} emptyText="لا يوجد مستخدمون"
          pagination={data?.pagination ? { page: data.pagination.page, pages: data.pagination.pages, total: data.pagination.total, limit: data.pagination.limit, onPage: setPage } : undefined} />
      </div>
    </DashboardLayout>
  );
}