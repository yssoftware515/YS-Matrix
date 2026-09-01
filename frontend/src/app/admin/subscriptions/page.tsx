'use client';

// ============================================================
// YS-MATRIX ERP — Platform Subscriptions (F6)
// Route: /admin/subscriptions (platform admins — GLOBAL scope only)
//
// Small read-only list over the real /admin/subscriptions endpoint:
// every showroom subscription with a live display status
// (ACTIVE / EXPIRING_SOON / EXPIRED / CANCELLED / TRIAL), plan
// snapshot, amount and payment method. Opens from the overview
// cards (which previously linked here into a 404).
// ============================================================

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Shield, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { adminApi, type Subscription, type SubscriptionStatus } from '@/lib/api';
import { cn, formatCurrency, formatDate, daysUntil } from '@/lib/utils';

type DisplayStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'CANCELLED' | 'TRIAL';

function getDisplayStatus(sub: Subscription): DisplayStatus {
  if (sub.status === 'CANCELLED') return 'CANCELLED';
  if (sub.status === 'TRIAL')     return 'TRIAL';
  // is_expired/days_left are computed server-side from expires_at vs
  // now — more reliable than the stored status column, which nothing
  // flips to EXPIRED automatically when the date passes.
  if (sub.is_expired) return 'EXPIRED';
  if (typeof sub.days_left === 'number' && sub.days_left <= 7) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

const STATUS_CFG: Record<DisplayStatus, { label: string; badge: string; icon: typeof CheckCircle2 }> = {
  ACTIVE:        { label: 'نشط',          badge: 'badge-green', icon: CheckCircle2 },
  EXPIRING_SOON: { label: 'ينتهي قريباً', badge: 'badge-amber', icon: AlertTriangle },
  EXPIRED:       { label: 'منتهي',        badge: 'badge-red',   icon: XCircle },
  CANCELLED:     { label: 'ملغى',         badge: 'badge-red',   icon: XCircle },
  TRIAL:         { label: 'تجريبي',       badge: 'badge-cyan',  icon: Shield },
};

const STATUS_FILTERS: (SubscriptionStatus | '')[] = [
  '', 'ACTIVE', 'PENDING_PAYMENT', 'EXPIRED', 'CANCELLED', 'TRIAL',
];

const METHOD_LABEL: Record<string, string> = {
  MANUAL: 'يدوي', WALLET: 'محفظة', BANK_TRANSFER: 'تحويل بنكي',
};

export default function AdminSubscriptionsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');
  // F6 — the overview "تنتهي قريباً" card links here with ?expiring=1
  const [expiringOnly, setExpiringOnly] = useState(false);

  useEffect(() => {
    const expiring = new URLSearchParams(window.location.search).get('expiring');
    if (expiring === '1') setExpiringOnly(true);
  }, []);

  const query = useQuery({
    queryKey: ['admin-platform-subscriptions', { page, status, expiringOnly }],
    queryFn: () => adminApi.getPlatformSubscriptions({
      page,
      limit: 15,
      ...(status       ? { status }                        : {}),
      ...(expiringOnly ? { expiring_in: 7 }                : {}),
    }),
  });

  const rows = query.data?.data ?? [];
  const meta = query.data?.pagination ?? { total: 0, page: 1, pages: 1, limit: 15 };

  const columns: Column<Subscription>[] = [
    {
      key: 'showroom',
      header: 'المعرض',
      render: (r) => (
        <div className="min-w-0">
          <p className="text-sm text-matrix-text truncate">{r.showroom?.name ?? r.showroom_id}</p>
          <p className="text-[10px] font-mono text-matrix-subtle truncate" dir="ltr">
            {r.showroom?.slug ?? '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'plan_name',
      header: 'الباقة',
      render: (r) => <span className="badge-cyan text-[10px]">{r.plan_name}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => {
        const cfg = STATUS_CFG[getDisplayStatus(r)];
        const Icon = cfg.icon;
        return (
          <span className={cn('badge flex items-center gap-1.5 text-[10px]', cfg.badge)}>
            <Icon className="w-3 h-3" />
            {cfg.label}
          </span>
        );
      },
    },
    {
      key: 'expires_at',
      header: 'الانتهاء',
      hideOnMobile: true,
      render: (r) => (
        <div>
          <p className="text-xs font-mono text-matrix-text">{formatDate(r.expires_at)}</p>
          {typeof r.days_left === 'number' && (
            <p className={cn('text-[10px] font-mono', r.days_left <= 0 ? 'text-matrix-red' : r.days_left <= 7 ? 'text-matrix-amber' : 'text-matrix-subtle')}>
              {r.days_left <= 0 ? 'منتهي' : `${r.days_left} يوم متبقٍ`}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'amount_paid',
      header: 'المبلغ',
      render: (r) => (
        <span className="text-xs font-mono text-matrix-green">
          {r.price_amount != null ? formatCurrency(r.price_amount) : '—'}
        </span>
      ),
    },
    {
      key: 'payment_method',
      header: 'طريقة الدفع',
      hideOnMobile: true,
      render: (r) => (
        <span className="text-[10px] font-mono text-matrix-subtle">
          {r.payment_method ? (METHOD_LABEL[r.payment_method] ?? r.payment_method) : '—'}
        </span>
      ),
    },
  ];

  return (
    <DashboardLayout title="الاشتراكات — منصة الإدارة">
      <div className="space-y-4">
        {/* ── Filters ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as SubscriptionStatus | ''); setPage(1); }}
            className="matrix-input border-matrix-cyan/20 focus:border-matrix-cyan/40 transition-colors duration-200 w-44"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s || 'all'} value={s}>
                {s ? STATUS_CFG[s as DisplayStatus]?.label ?? s : 'كل الحالات'}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={expiringOnly}
              onChange={(e) => { setExpiringOnly(e.target.checked); setPage(1); }}
              className="accent-matrix-cyan"
            />
            <span className="text-xs font-mono text-matrix-subtle">تنتهي خلال 7 أيام</span>
          </label>

          <p className="mr-auto text-xs font-mono text-matrix-subtle">
            إجمالي: {meta.total}
          </p>
        </div>

        {/* ── Table ── */}
        <DataTable<Subscription>
          data={rows}
          columns={columns}
          loading={query.isLoading}
          rowKey={(r) => r.id}
          emptyText="لا توجد اشتراكات"
          pagination={{
            page: meta.page,
            pages: meta.pages,
            total: meta.total,
            limit: meta.limit,
            onPage: setPage,
          }}
        />

        {query.isError && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs font-mono text-matrix-red">
            <Loader2 className="w-4 h-4 animate-spin" />
            فشل تحميل الاشتراكات — أعد المحاولة
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
