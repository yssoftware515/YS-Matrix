'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Shield, Users, Building2, KeyRound, Loader2, Wallet, AlertTriangle, CheckCircle2, CircleDollarSign } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { adminApi, type Administrator } from '@/lib/api';
import { formatCurrency, formatDate, cn } from '@/lib/utils';

// Phase 2 (Delegated Platform Administrators): /admin overview — a
// read-only at-a-glance dashboard for the platform surface. All data
// comes from the GLOBAL-gated /api/v1/admin endpoints; totals are
// derived from pagination metadata (limit=1 requests stay cheap).
// Phase 4/5: subscription health + pending payments row added below.

export default function AdminOverviewPage() {
  // ping each surface once with limit=1 and read the pagination totals
  const profiles = useQuery({
    queryKey: ['admin-prof', 'meta'],
    queryFn: () => adminApi.getProfiles({ page: 1, limit: 1 }),
  });
  const admins = useQuery({
    queryKey: ['admin-admins', 'meta'],
    queryFn: () => adminApi.getAdministrators({ page: 1, limit: 1 }),
  });
  const users = useQuery({
    queryKey: ['admin-users', 'meta'],
    queryFn: () => adminApi.getUsers({ page: 1, limit: 1 }),
  });
  const showrooms = useQuery({
    queryKey: ['admin-showrooms', 'meta'],
    queryFn: () => adminApi.getShowrooms({ page: 1, limit: 6 }),
  });
  // Phase 4/5 — commerce health (single GLOBAL-gated summary endpoint)
  const health = useQuery({
    queryKey: ['admin-sub-health'],
    queryFn: () => adminApi.getSubscriptionHealth(),
  });
  const pendingPayments = useQuery({
    queryKey: ['admin-payments', 'recent'],
    queryFn: () => adminApi.getPlatformPayments({ page: 1, limit: 6, status: 'PENDING' }),
  });

  const loading = profiles.isLoading || admins.isLoading || users.isLoading || showrooms.isLoading;

  const stats = [
    { label: 'صلاحيات المنصة',     value: profiles.data?.pagination?.total ?? '—', icon: KeyRound,    color: 'text-matrix-purple' },
    { label: 'المشرفون',           value: admins.data?.pagination?.total ?? '—',    icon: Shield,      color: 'text-matrix-cyan' },
    { label: 'المستخدمون',         value: users.data?.pagination?.total ?? '—',     icon: Users,       color: 'text-matrix-green' },
    { label: 'المعارض',            value: showrooms.data?.pagination?.total ?? '—', icon: Building2,   color: 'text-matrix-amber' },
  ];

  // Phase 4/5 — subscription health stats (backend-computed summary)
  const subStats = [
    {
      label: 'اشتراكات نشطة',
      value: health.data?.subscriptions?.active ?? '—',
      icon:   CheckCircle2,
      color:  'text-matrix-green',
      href:   '/admin/subscriptions',
    },
    {
      label: 'مدفوعات بانتظار المراجعة',
      value: health.data?.payments?.pending ?? '—',
      icon:   Wallet,
      color:  health.data?.payments?.pending ? 'text-matrix-amber' : 'text-matrix-green',
      href:   '/admin/payments',
    },
    {
      label: 'اشتراكات تنتهي قريباً',
      value: health.data?.subscriptions?.expiring_soon ?? '—',
      icon:   AlertTriangle,
      color:  'text-matrix-amber',
      href:   '/admin/subscriptions?expiring=1',
    },
    {
      label: 'إجمالي الإيرادات',
      value: health.data?.revenue?.total_paid != null ? formatCurrency(health.data.revenue.total_paid) : '—',
      icon:   CircleDollarSign,
      color:  'text-matrix-cyan',
      href:   '/admin/payments',
    },
  ];

  // licenses at risk (from the first page of showrooms)
  const atRisk = (showrooms.data?.data || []).filter((s) => !s.license_health.is_expired && s.license_health.days_left <= 7);
  const expired = (showrooms.data?.data || []).filter((s) => s.license_health.is_expired).length;

  const columns: Column<Administrator>[] = [
    { key: 'name', header: 'الاسم', render: (r) => <p className="font-semibold">{r.name}</p> },
    { key: 'email', header: 'البريد', render: (r) => <span className="text-xs font-mono text-matrix-subtle" dir="ltr">{r.email}</span> },
    { key: 'profile', header: 'الملف', render: (r) => r.profile ? <span className="badge-purple">{r.profile.name}</span> : <span className="text-xs text-matrix-subtle">—</span> },
    { key: 'is_active', header: 'الحالة', align: 'center', render: (r) => <span className={r.is_active ? 'badge-green' : 'badge-red'}>{r.is_active ? 'نشط' : 'معطل'}</span> },
    { key: 'last_login', header: 'آخر دخول', render: (r) => <span className="text-xs font-mono text-matrix-subtle">{r.last_login ? formatDate(r.last_login) : '—'}</span> },
  ];

  return (
    <DashboardLayout title="نظرة عامة — منصة الإدارة">
      <div className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-matrix-cyan animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="matrix-panel p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-mono uppercase tracking-widest text-matrix-subtle">{label}</p>
                    <Icon className={cn('w-5 h-5', color)} />
                  </div>
                  <p className={cn('font-mono text-2xl font-bold', color)}>{value}</p>
                </div>
              ))}
            </div>

            {/* ── Phase 4/5 — subscription & payment health ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {subStats.map(({ label, value, icon: Icon, color, href }) => (
                <Link key={label} href={href}>
                  <div className="matrix-panel p-4 hover:border-matrix-cyan/30 transition-all cursor-pointer group">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-mono uppercase tracking-widest text-matrix-subtle">{label}</p>
                      <Icon className={cn('w-5 h-5 group-hover:drop-shadow-[0_0_6px_rgba(0,212,255,0.5)]', color)} />
                    </div>
                    <p className={cn('font-mono text-2xl font-bold', color)}>{value}</p>
                  </div>
                </Link>
              ))}
            </div>

            {/* ── Recent pending payments → review queue ── */}
            <div className="matrix-panel overflow-hidden">
              <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between">
                <p className="flex items-center gap-2 section-title mb-0">
                  <Wallet className="w-4 h-4 text-matrix-amber" />
                  مدفوعات بانتظار المراجعة
                </p>
                <Link href="/admin/payments" className="text-[10px] font-mono text-matrix-cyan hover:underline">
                  عرض الكل ←
                </Link>
              </div>
              {pendingPayments.isLoading ? (
                <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-matrix-cyan" /></div>
              ) : !pendingPayments.data?.data?.length ? (
                <div className="py-10 text-center text-xs font-mono text-matrix-subtle">
                  لا توجد مدفوعات معلقة ✓
                </div>
              ) : (
                <div className="divide-y divide-matrix-border/40">
                  {pendingPayments.data.data.map((p) => (
                    <Link key={p.id} href="/admin/payments" className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-matrix-cyan/[0.02] transition-colors">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-matrix-text truncate">{p.showroom?.name ?? '—'}</p>
                        <p className="text-[10px] font-mono text-matrix-subtle mt-0.5">
                          {p.plan_name} · {formatDate(p.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs font-mono font-bold text-matrix-amber">{formatCurrency(p.amount)}</span>
                        <span className="badge-amber text-[9px]">قيد المراجعة</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {atRisk.length > 0 && (
              <div className="matrix-panel p-4 border border-matrix-amber/30 bg-matrix-amber/5 flex items-center gap-3">
                <Building2 className="w-5 h-5 text-matrix-amber shrink-0" />
                <p className="text-sm text-matrix-subtle">
                  <span className="text-matrix-amber font-semibold">{atRisk.length}</span> معرض يوشك ترخيصه على الانتهاء خلال 7 أيام
                  {expired > 0 && <> — و<span className="text-matrix-red font-semibold">{expired}</span> بترخيص منتهٍ</>}
                </p>
              </div>
            )}

            <DataTable
              data={(admins.data?.data || []).slice(0, 6)}
              columns={columns}
              loading={admins.isLoading}
              rowKey={(r) => r.id}
              emptyText="لا يوجد مشرفون بعد"
            />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}