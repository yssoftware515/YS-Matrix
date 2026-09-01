'use client';

// ============================================================
// YS-MATRIX ERP — Subscription Management Page (Phase 3 Stage 1)
// Route: /dashboard/subscriptions  (SuperAdmin only)
// ============================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Shield, RefreshCw, Loader2, Search,
  CheckCircle2, AlertTriangle, XCircle,
  Calendar, ChevronLeft, ChevronRight, Plus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { subscriptionApi, isApiRequestError, type Subscription } from '@/lib/api';
import { cn, formatDate, daysUntil } from '@/lib/utils';

// ─── Derived display status ────────────────────────────────────
// The real `status` column on Subscription only has 4 values
// (ACTIVE | EXPIRED | CANCELLED | TRIAL — confirmed in schema.prisma)
// and is NOT automatically flipped to EXPIRED when expires_at passes
// (no cron job in the codebase does this). "EXPIRING_SOON" doesn't
// exist as a stored value at all — it's a derived display state,
// computed here client-side from days_left, exactly mirroring the
// same threshold logic used in license.middleware.js (warningDaysThreshold).
type DisplayStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'CANCELLED' | 'TRIAL';

function getDisplayStatus(sub: Subscription): DisplayStatus {
  if (sub.status === 'CANCELLED') return 'CANCELLED';
  if (sub.status === 'TRIAL')     return 'TRIAL';
  // is_expired/days_left are computed server-side in listAllSubscriptions
  // from expires_at vs "now" — more reliable than the stored status
  // column for ACTIVE rows, since nothing flips status to EXPIRED
  // automatically when the date passes.
  if (sub.is_expired) return 'EXPIRED';
  if (typeof sub.days_left === 'number' && sub.days_left <= 7) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

// ─── Status Config ────────────────────────────────────────────
const STATUS_CFG: Record<DisplayStatus, { label: string; badge: string; icon: typeof CheckCircle2; dot: string }> = {
  ACTIVE:         { label: 'نشط',            badge: 'badge-green',  icon: CheckCircle2,   dot: 'bg-matrix-green'  },
  EXPIRING_SOON:  { label: 'ينتهي قريباً',   badge: 'badge-amber',  icon: AlertTriangle,  dot: 'bg-matrix-amber'  },
  EXPIRED:        { label: 'منتهي',          badge: 'badge-red',    icon: XCircle,        dot: 'bg-matrix-red'    },
  CANCELLED:      { label: 'ملغى',           badge: 'badge-red',    icon: XCircle,        dot: 'bg-matrix-subtle' },
  TRIAL:          { label: 'تجريبي',         badge: 'badge-cyan',   icon: Shield,         dot: 'bg-matrix-cyan'   },
};

// ─── Renew Modal ──────────────────────────────────────────────
function RenewModal({
  subscription,
  onClose,
}: {
  subscription: Subscription;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [months, setMonths] = useState(12);

  const renewMut = useMutation({
    mutationFn: () =>
      subscriptionApi.renew({ showroom_id: subscription.showroom_id, months }),
    onSuccess: () => {
      toast.success(`تم تجديد اشتراك ${subscription.showroom?.name ?? subscription.showroom_id}`);
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      qc.invalidateQueries({ queryKey: ['subscriptions-summary'] });
      onClose();
    },
    onError: (err: unknown) => toast.error(isApiRequestError(err) ? err.message : 'فشل التجديد'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.96, y: 16  }}
        className="w-full max-w-sm matrix-panel border border-matrix-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-matrix-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-matrix-cyan" />
            <span className="text-sm font-mono font-semibold text-matrix-text">تجديد الاشتراك</span>
          </div>
          <button onClick={onClose} className="text-matrix-subtle hover:text-matrix-red transition-colors text-lg leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Showroom info */}
          <div className="p-3 rounded-lg bg-matrix-dark border border-matrix-border/50">
            <p className="text-xs font-semibold text-matrix-text">{subscription.showroom?.name ?? '—'}</p>
            <p className="text-[10px] font-mono text-matrix-subtle mt-0.5">{subscription.showroom?.slug ?? subscription.showroom_id}</p>
          </div>

          {/* Current expiry */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-matrix-subtle font-mono">ينتهي حالياً:</span>
            <span className={cn(
              'font-mono font-semibold',
              daysUntil(subscription.expires_at) <= 0 ? 'text-matrix-red' : 'text-matrix-amber',
            )}>
              {formatDate(subscription.expires_at)}
            </span>
          </div>

          {/* Months selector */}
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
              مدة التجديد (أشهر)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 3, 6, 12].map((m) => (
                <button
                  key={m}
                  onClick={() => setMonths(m)}
                  className={cn(
                    'py-2 rounded-lg border text-xs font-mono transition-all',
                    months === m
                      ? 'border-matrix-cyan bg-matrix-cyan/10 text-matrix-cyan'
                      : 'border-matrix-border text-matrix-subtle hover:border-matrix-border/80',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* New expiry preview */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-matrix-green/5 border border-matrix-green/20">
            <span className="text-xs text-matrix-subtle font-mono">سينتهي في:</span>
            <span className="text-xs font-mono font-semibold text-matrix-green">
              {(() => {
                const base = new Date(
                  daysUntil(subscription.expires_at) > 0
                    ? subscription.expires_at
                    : new Date()
                );
                base.setMonth(base.getMonth() + months);
                return formatDate(base.toISOString());
              })()}
            </span>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-matrix-border flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-matrix-border text-xs font-mono text-matrix-subtle hover:text-matrix-text transition-all">
            إلغاء
          </button>
          <button
            onClick={() => renewMut.mutate()}
            disabled={renewMut.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-matrix-cyan bg-matrix-cyan/10 text-matrix-cyan text-xs font-mono hover:bg-matrix-cyan/20 transition-all disabled:opacity-40"
          >
            {renewMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
            تجديد {months} {months === 1 ? 'شهر' : 'أشهر'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Subscription Row ─────────────────────────────────────────
function SubscriptionRow({
  sub,
  onRenew,
}: {
  sub:     Subscription;
  onRenew: (s: Subscription) => void;
}) {
  const displayStatus = getDisplayStatus(sub);
  const statusCfg = STATUS_CFG[displayStatus];
  const StatusIcon = statusCfg.icon;
  const days = daysUntil(sub.expires_at);

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="border-b border-matrix-border/40 hover:bg-matrix-cyan/[0.02] transition-colors"
    >
      {/* Showroom */}
      <td className="px-4 py-3">
        <p className="text-xs font-semibold text-matrix-text">{sub.showroom?.name ?? '—'}</p>
        <p className="text-[10px] font-mono text-matrix-subtle mt-0.5">{sub.showroom?.slug ?? sub.showroom_id}</p>
      </td>

      {/* Plan */}
      <td className="px-4 py-3">
        <span className="badge-cyan text-[10px]">{sub.plan_name}</span>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className={cn('badge text-[10px] flex items-center gap-1 w-fit', statusCfg.badge)}>
          <StatusIcon className="w-3 h-3" />
          {statusCfg.label}
        </span>
      </td>

      {/* Starts */}
      <td className="px-4 py-3">
        <span className="text-[10px] font-mono text-matrix-subtle">{formatDate(sub.started_at)}</span>
      </td>

      {/* Expires */}
      <td className="px-4 py-3">
        <p className={cn(
          'text-[10px] font-mono font-semibold',
          days <= 0 ? 'text-matrix-red' : days <= 7 ? 'text-matrix-amber' : 'text-matrix-subtle',
        )}>
          {formatDate(sub.expires_at)}
        </p>
        <p className={cn(
          'text-[9px] font-mono mt-0.5',
          days <= 0 ? 'text-matrix-red' : 'text-matrix-subtle/60',
        )}>
          {days <= 0 ? `منتهي منذ ${Math.abs(days)} يوم` : `${days} يوم متبقي`}
        </p>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <button
          onClick={() => onRenew(sub)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-matrix-cyan/30 text-matrix-cyan text-[10px] font-mono hover:bg-matrix-cyan/10 transition-all"
        >
          <Plus className="w-3 h-3" />
          تجديد
        </button>
      </td>
    </motion.tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function SubscriptionsPage() {
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [renewTarget,  setRenewTarget]  = useState<Subscription | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['subscriptions', { page, search, status: statusFilter }],
    queryFn:  () =>
      subscriptionApi.getAll({
        page, limit: 20,
        search:  search       || undefined,
        status:  statusFilter || undefined,
      }),
  });

  // GLOBAL summary — deliberately a SEPARATE query from the table
  // above. listAllSubscriptions() never returned a `summary` field at
  // all (confirmed in subscription.service.js — it only returns
  // { subscriptions, pagination }); the previous `data?.summary ?? {}`
  // was reading a field that never existed on any real response,
  // so every summary card always rendered its fallback of 0. This
  // mirrors the same fix applied to sales/page.tsx's stat cards.
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['subscriptions-summary'],
    queryFn:  () => subscriptionApi.getSummary(),
  });

  const subscriptions = data?.data       ?? [];
  const pagination    = data?.pagination ?? { total: 0, pages: 1, page: 1, limit: 20, hasNext: false, hasPrev: false };

  return (
    <DashboardLayout title="إدارة الاشتراكات">
      <div className="space-y-5">

        {/* ── SuperAdmin badge ── */}
        <div className="flex items-center gap-3 p-4 rounded-xl border border-matrix-purple/30 bg-matrix-purple/5">
          <Shield className="w-5 h-5 text-matrix-purple shrink-0" />
          <p className="text-xs text-matrix-subtle">صفحة SuperAdmin — إدارة اشتراكات جميع المعارض</p>
        </div>

        {/* ── Summary Cards — global, from the dedicated getSummary() query ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'إجمالي',        value: summary?.total         ?? 0, color: 'text-matrix-cyan'   },
            { label: 'نشطة',          value: summary?.active        ?? 0, color: 'text-matrix-green'  },
            { label: 'تنتهي قريباً',  value: summary?.expiring_soon ?? 0, color: 'text-matrix-amber'  },
            { label: 'منتهية',        value: summary?.expired       ?? 0, color: 'text-matrix-red'    },
          ].map((s) => (
            <div key={s.label} className="matrix-panel p-4 text-center border border-matrix-border/50">
              <p className={cn('text-xl font-bold font-mono', s.color)}>{summaryLoading ? '…' : s.value}</p>
              <p className="text-[10px] font-mono text-matrix-subtle mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-matrix-subtle" />
            <input
              type="text"
              placeholder="بحث بالاسم..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="matrix-input pr-9 text-xs w-full"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="matrix-input text-xs min-w-[160px]"
          >
            <option value="">كل الحالات</option>
            <option value="ACTIVE">نشط</option>
            <option value="EXPIRED">منتهي</option>
            <option value="CANCELLED">ملغى</option>
            <option value="TRIAL">تجريبي</option>
          </select>
          <button
            onClick={() => refetch()}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* ── Table ── */}
        <div className="matrix-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[560px] w-full text-right">
              <thead>
                <tr className="border-b border-matrix-border/70">
                  {['المعرض','الخطة','الحالة','بدأ','ينتهي',''].map((h) => (
                    <th key={h} className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-matrix-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <Loader2 className="w-6 h-6 animate-spin text-matrix-cyan mx-auto" />
                    </td>
                  </tr>
                ) : subscriptions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-matrix-subtle text-xs font-mono">
                      لا توجد اشتراكات
                    </td>
                  </tr>
                ) : (
                  subscriptions.map((sub: Subscription) => (
                    <SubscriptionRow
                      key={sub.id}
                      sub={sub}
                      onRenew={setRenewTarget}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-matrix-border/50">
              <span className="text-[10px] font-mono text-matrix-subtle">{pagination.total} معرض</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center justify-center w-7 h-7 rounded border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all disabled:opacity-30"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono text-matrix-subtle px-1">
                  {page}/{pagination.pages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                  disabled={page === pagination.pages}
                  className="flex items-center justify-center w-7 h-7 rounded border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all disabled:opacity-30"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Renew Modal ── */}
        {renewTarget && (
          <RenewModal
            subscription={renewTarget}
            onClose={() => setRenewTarget(null)}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
