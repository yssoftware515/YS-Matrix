'use client';

// ============================================================
// YS-MATRIX ERP — Activity Logs Page (Phase 3 Stage 1)
// Route: /dashboard/activity
// ============================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity, Search, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, Shield,
  Package, Users, Truck, ShoppingCart,
  DollarSign, Settings, LogIn, LogOut, Eye,
} from 'lucide-react';
import { activityApi, type ActivityLogEntry } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ListError } from '@/components/ui/ListError';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import Link from 'next/link';

// FIX: this page had its own local `ActivityLog` interface duplicating
// api.ts's `ActivityLogEntry` — close but not identical (old_data/
// new_data/ip_address were required here but optional there, and the
// local `user` shape didn't match). ignoreBuildErrors was masking the
// resulting type incompatibility. Importing the real type directly
// instead of maintaining a second copy — same fix pattern as
// AuthUser/User earlier in this project.

// ─── Config ──────────────────────────────────────────────────
const ENTITY_ICONS: Record<string, React.ElementType> = {
  inventory: Package,
  customer:  Users,
  supplier:  Truck,
  sale:      ShoppingCart,
  expense:   DollarSign,
  user:      Shield,
  showroom:  Settings,
};

const ACTION_CONFIG: Record<string, { label: string; colorClass: string; dotClass: string }> = {
  CREATE:          { label: 'إنشاء',          colorClass: 'text-matrix-green',  dotClass: 'bg-matrix-green'  },
  UPDATE:          { label: 'تعديل',           colorClass: 'text-matrix-cyan',   dotClass: 'bg-matrix-cyan'   },
  DELETE:          { label: 'حذف',             colorClass: 'text-matrix-red',    dotClass: 'bg-matrix-red'    },
  SOFT_DELETE:     { label: 'تعطيل',           colorClass: 'text-matrix-amber',  dotClass: 'bg-matrix-amber'  },
  REACTIVATE:      { label: 'تفعيل',           colorClass: 'text-matrix-green',  dotClass: 'bg-matrix-green'  },
  LOGIN:           { label: 'تسجيل دخول',      colorClass: 'text-matrix-purple', dotClass: 'bg-matrix-purple' },
  LOGOUT:          { label: 'تسجيل خروج',      colorClass: 'text-matrix-subtle', dotClass: 'bg-matrix-subtle' },
  CREATE_SALE:     { label: 'بيع جديد',        colorClass: 'text-matrix-green',  dotClass: 'bg-matrix-green'  },
  CANCEL_SALE:     { label: 'إلغاء بيع',       colorClass: 'text-matrix-red',    dotClass: 'bg-matrix-red'    },
  ADD_PAYMENT:     { label: 'دفعة جديدة',      colorClass: 'text-matrix-cyan',   dotClass: 'bg-matrix-cyan'   },
  RENEW_LICENSE:   { label: 'تجديد اشتراك',    colorClass: 'text-matrix-purple', dotClass: 'bg-matrix-purple' },
  ONBOARD_SHOWROOM:{ label: 'إعداد المعرض',    colorClass: 'text-matrix-cyan',   dotClass: 'bg-matrix-cyan'   },
  BULK_CREATE:     { label: 'إضافة جماعية',    colorClass: 'text-matrix-green',  dotClass: 'bg-matrix-green'  },
};

const DEFAULT_ACTION = { label: 'إجراء', colorClass: 'text-matrix-subtle', dotClass: 'bg-matrix-subtle' };

const ENTITY_OPTIONS = [
  { value: '',          label: 'كل الكيانات' },
  { value: 'inventory', label: 'المخزون'   },
  { value: 'customer',  label: 'العملاء'   },
  { value: 'supplier',  label: 'الموردون'  },
  { value: 'sale',      label: 'المبيعات'  },
  { value: 'user',      label: 'المستخدمون'},
  { value: 'showroom',  label: 'المعرض'    },
];

// ─── Timeline Entry ──────────────────────────────────────────
function LogEntry({ log, index }: { log: ActivityLogEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const actionCfg = ACTION_CONFIG[log.action] ?? DEFAULT_ACTION;
  const EntityIcon = ENTITY_ICONS[log.entity] ?? Activity;

  const hasData = log.old_data || log.new_data;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className="relative flex gap-4"
    >
      {/* Timeline line + dot */}
      <div className="flex flex-col items-center shrink-0">
        <div className={cn('w-2.5 h-2.5 rounded-full border-2 border-matrix-dark mt-1 shrink-0', actionCfg.dotClass)} />
        <div className="w-px flex-1 bg-matrix-border/40 mt-1" />
      </div>

      {/* Card */}
      <div className="flex-1 pb-4">
        <div
          className={cn(
            'matrix-panel px-4 py-3 border border-matrix-border/50',
            hasData && 'cursor-pointer hover:border-matrix-cyan/30 transition-colors',
          )}
          onClick={() => hasData && setExpanded((v) => !v)}
        >
          {/* Row 1: action + entity + time */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('text-xs font-mono font-semibold', actionCfg.colorClass)}>
                {actionCfg.label}
              </span>
              <div className="flex items-center gap-1.5">
                <EntityIcon className="w-3 h-3 text-matrix-subtle" />
                <span className="text-[10px] font-mono text-matrix-subtle">{log.entity}</span>
              </div>
              {log.entity_id && (
                <span className="text-[10px] font-mono text-matrix-subtle/50 truncate max-w-[120px]">
                  #{log.entity_id.slice(0, 8)}...
                </span>
              )}
            </div>
            <span className="text-[10px] font-mono text-matrix-subtle/50 shrink-0 whitespace-nowrap">
              {formatDateTime(log.created_at)}
            </span>
          </div>

          {/* Row 2: user + IP */}
          <div className="flex items-center gap-3 mt-1.5">
            {log.user && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-matrix-subtle">
                <Shield className="w-3 h-3" />
                {log.user.name}
                <span className="text-matrix-subtle/40">·</span>
                <span className="text-matrix-subtle/60">{log.user.role}</span>
              </span>
            )}
            {log.ip_address && (
              <span className="text-[10px] font-mono text-matrix-subtle/40">{log.ip_address}</span>
            )}
          </div>

          {/* Expanded diff */}
          {expanded && hasData && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-3 pt-3 border-t border-matrix-border/40 grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              {log.old_data && (
                <div>
                  <p className="text-[10px] font-mono text-matrix-red mb-1.5">− قبل</p>
                  <pre className="text-[9px] font-mono text-matrix-subtle/70 bg-matrix-dark/60 rounded p-2 overflow-auto max-h-28 whitespace-pre-wrap">
                    {JSON.stringify(log.old_data, null, 2)}
                  </pre>
                </div>
              )}
              {log.new_data && (
                <div>
                  <p className="text-[10px] font-mono text-matrix-green mb-1.5">+ بعد</p>
                  <pre className="text-[9px] font-mono text-matrix-subtle/70 bg-matrix-dark/60 rounded p-2 overflow-auto max-h-28 whitespace-pre-wrap">
                    {JSON.stringify(log.new_data, null, 2)}
                  </pre>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function ActivityPage() {
  // Phase C.3 (C3-5): the activity surface is OWNER+ only — every
  // backend route here carries ownerOnly (activity.routes.js). A STAFF
  // user previously reached this page, got a 403 from the API and was
  // shown the "لا توجد سجلات بعد" EMPTY state — indistinguishable from
  // a showroom with no activity yet. Gate the page (same pattern as
  // customers/inactive) so STAFF see an explicit owner-only notice
  // instead of a misleading empty timeline, and skip the pointless
  // doomed request via enabled.
  const { user } = useAuthStore();
  const canViewActivity = isOwnerPlus(user?.role);

  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  // Phase C.3 (C3-5): isError surfaced — a failed fetch previously
  // rendered the empty state, reading as "no data" instead of "the
  // server didn't answer". Distinct error state + retry (ListError).
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['activity', { page, search, entity: entityFilter, action: actionFilter }],
    // FIX: activityApi.getAll() already returns the unwrapped
    // Paginated<ActivityLogEntry> shape directly ({ data, pagination }
    // — requestPaginated<T> in api.ts unwraps the envelope internally).
    // The old `.then((r) => r.data)` stripped that down to a bare array,
    // so `data?.data` below was always undefined (logs always empty)
    // and `data?.pagination` always fell back to the { total: 0 } default.
    queryFn:  () =>
      activityApi.getAll({
        page, limit: 30,
        search:  search       || undefined,
        entity:  entityFilter || undefined,
        action:  actionFilter || undefined,
      }),
    enabled: canViewActivity,
  });

  const logs       = data?.data       ?? [];
  const pagination = data?.pagination ?? { total: 0, pages: 1 };

  if (!canViewActivity) {
    return (
      <DashboardLayout title="سجل الأنشطة">
        <div className="text-center py-16 space-y-3">
          <p className="text-matrix-subtle text-sm">سجل الأنشطة متاح للمالك ومدير النظام فقط.</p>
          <Link href="/dashboard" className="text-matrix-cyan text-xs inline-flex items-center gap-1 hover:underline">
            العودة للوحة التحكم
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="سجل الأنشطة">
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-matrix-cyan" />
            <div>
              <p className="text-xs font-mono text-matrix-subtle">
                {pagination.total} سجل · الصفحة {page} من {pagination.pages}
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-matrix-subtle" />
            <input
              type="text"
              placeholder="بحث بالإجراء أو المستخدم..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="matrix-input pr-9 text-xs w-full"
            />
          </div>

          <select
            value={entityFilter}
            onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
            className="matrix-input text-xs min-w-[140px]"
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="matrix-input text-xs min-w-[140px]"
          >
            <option value="">كل الإجراءات</option>
            {Object.entries(ACTION_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {/* ── Timeline ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-matrix-cyan" />
          </div>
        ) : isError ? (
          <ListError message="تعذر تحميل سجل الأنشطة" onRetry={() => refetch()} />
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-matrix-subtle text-center px-4">
            <Activity className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-mono text-matrix-text">لا توجد سجلات بعد</p>
            <p className="text-xs text-matrix-subtle/60 mt-1 max-w-sm leading-relaxed">
              يُسجَّل هنا كل تغيير يحدث في بياناتك — بيع، إضافة مخزون، تعديل عميل،
              تغيير حالة مستخدم… ابدأ العمل وسيظهر أول سجل تلقائياً.
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {logs.map((log: ActivityLogEntry, idx: number) => (
              <LogEntry key={log.id} log={log} index={idx} />
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-matrix-subtle px-2">
              {page} / {pagination.pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              disabled={page === pagination.pages}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
