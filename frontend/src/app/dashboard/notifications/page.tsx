'use client';

// ============================================================
// YS-MATRIX ERP — Notifications Full Page (Phase 3 Stage 1)
// Route: /dashboard/notifications
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCheck, Loader2, RefreshCw, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useNotifications, useMarkAsRead, useMarkAllAsRead, useUnreadCount } from '@/hooks/useNotifications';
import { ListError } from '@/components/ui/ListError';
import { NOTIFICATION_CONFIG, Notification } from '@/types/notification.types';
import { cn, formatDateTime } from '@/lib/utils';

// Phase B.1 (F7): severity → icon-container accent on the card.
const SEVERITY_RING: Record<string, string> = {
  warning:  'border-matrix-amber/40',
  critical: 'border-matrix-red/40',
};

// ─── Notification Card ────────────────────────────────────────
function NotificationCard({
  notification,
  onMarkRead,
  isMarking,
}: {
  notification: Notification;
  onMarkRead:   (id: string) => void;
  isMarking:    boolean;
}) {
  const router = useRouter();
  const cfg = NOTIFICATION_CONFIG[notification.type] ?? {
    icon: '🔔', colorClass: 'text-matrix-subtle', label: notification.type,
    severity: 'info' as const,
  };

  // Phase B.1 (F6): cards with an action are deep links (billing
  // lifecycle → /dashboard/billing). Click = navigate + mark read.
  const handleClick = () => {
    if (cfg.action) {
      if (!notification.is_read) onMarkRead(notification.id);
      router.push(cfg.action.href);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={handleClick}
      className={cn(
        'matrix-panel px-5 py-4 border transition-colors duration-150',
        !notification.is_read
          ? 'border-matrix-cyan/20 bg-matrix-cyan/[0.02]'
          : 'border-matrix-border/50',
        cfg.action ? 'cursor-pointer hover:border-matrix-cyan/40' : 'cursor-default',
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={cn(
          'flex items-center justify-center w-10 h-10 rounded-xl shrink-0 text-xl',
          'border bg-matrix-dark',
          !notification.is_read
            ? cn('border-matrix-cyan/30', SEVERITY_RING[cfg.severity])
            : 'border-matrix-border/40',
        )}>
          {cfg.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <p className={cn('text-sm font-semibold', cfg.colorClass)}>
                  {notification.title}
                </p>
                {!notification.is_read && (
                  <span className="w-1.5 h-1.5 rounded-full bg-matrix-cyan shrink-0"
                    style={{ boxShadow: '0 0 6px rgba(0,212,255,0.8)' }} />
                )}
              </div>
              <p className="text-xs text-matrix-subtle leading-relaxed">{notification.body}</p>
              <p className="text-[10px] font-mono text-matrix-subtle/50 mt-2">
                {formatDateTime(notification.created_at)}
              </p>
            </div>

            {/* Mark as read — stopPropagation so it never navigates */}
            {!notification.is_read && (
              <button
                onClick={(e) => { e.stopPropagation(); onMarkRead(notification.id); }}
                disabled={isMarking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono border border-matrix-cyan/20 text-matrix-cyan hover:bg-matrix-cyan/10 transition-all shrink-0 disabled:opacity-40"
              >
                {isMarking
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <CheckCheck className="w-3 h-3" />}
                تحديد كمقروء
              </button>
            )}
          </div>

          {/* Type badge */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className={cn('text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border', cfg.colorClass,
              'border-current/20 bg-current/5')}>
              {cfg.label}
            </span>
            {cfg.action && (
              <span className="text-[10px] font-mono text-matrix-cyan">
                {cfg.action.label} ←
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function NotificationsPage() {
  const [page,   setPage]   = useState(1);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  // Phase C.3 (C3-5): isError surfaced — a failed fetch previously
  // rendered the "لا توجد إشعارات" empty state, reading as "no data"
  // instead of "the server didn't answer". Distinct error state + retry
  // (ListError, same pattern as the other list pages).
  const { data, isLoading, isError, refetch } = useNotifications({
    is_read: filter === 'unread' ? 'false' : undefined,
    page,
    limit: 20,
  });

  const markRead    = useMarkAsRead();
  const markAllRead = useMarkAllAsRead();

  // FIX: unread count comes from the DEDICATED endpoint, not from
  // the list response. notification.controller.js's getNotifications
  // never forwards the unread_count its service computes internally —
  // confirmed by reading the controller directly. data?.unread_count
  // would always have been undefined → 0, making this header counter
  // and the "غير المقروءة" tab's badge permanently wrong.
  const { data: unreadData } = useUnreadCount();

  const notifications  = data?.data       ?? [];
  const pagination     = data?.pagination ?? { total: 0, pages: 1, page: 1, limit: 20, hasNext: false, hasPrev: false };
  const unreadCount     = unreadData?.unread_count ?? 0;

  return (
    <DashboardLayout title="الإشعارات">
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-matrix-cyan" />
            <div>
              <p className="text-xs font-mono text-matrix-subtle">
                {pagination.total} إشعار · {unreadCount} غير مقروء
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono border border-matrix-green/30 text-matrix-green hover:bg-matrix-green/10 transition-all disabled:opacity-40"
              >
                {markAllRead.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <CheckCheck className="w-3.5 h-3.5" />}
                قراءة الكل
              </button>
            )}
            <button
              onClick={() => refetch()}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Filter Tabs ── */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-matrix-dark border border-matrix-border w-fit">
          {([
            { value: 'all',    label: 'الكل',         count: pagination.total },
            { value: 'unread', label: 'غير المقروءة', count: unreadCount      },
          ] as const).map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setFilter(tab.value); setPage(1); }}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-mono transition-all',
                filter === tab.value
                  ? 'bg-matrix-cyan/10 text-matrix-cyan border border-matrix-cyan/20'
                  : 'text-matrix-subtle hover:text-matrix-text',
              )}
            >
              {tab.label}
              <span className={cn(
                'text-[9px] px-1.5 py-0.5 rounded font-mono',
                filter === tab.value ? 'bg-matrix-cyan/20' : 'bg-matrix-border/60',
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* ── List ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-matrix-cyan" />
          </div>
        ) : isError ? (
          <ListError message="تعذر تحميل الإشعارات" onRetry={() => refetch()} />
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-matrix-subtle text-center px-4">
            <Bell className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm font-mono text-matrix-text">
              {filter === 'unread' ? 'كل الإشعارات مقروءة ✓' : 'لا توجد إشعارات'}
            </p>
            <p className="text-xs text-matrix-subtle/60 mt-1 max-w-sm leading-relaxed">
              {filter === 'unread'
                ? 'أنت على اطلاع بكل شيء — ستصلك الإشعارات الجديدة هنا فور حدوثها.'
                : 'سيتنبّهك النظام تلقائياً للأمور المهمة: أقساط متأخرة، مخزون منخفض، اشتراك يقترب من الانتهاء، وحالة طلبات الاشتراك.'}
            </p>
          </div>
        ) : (
          <AnimatePresence>
            <div className="space-y-3">
              {notifications.map((n: Notification) => (
                <NotificationCard
                  key={n.id}
                  notification={n}
                  onMarkRead={(id) => markRead.mutate(id)}
                  isMarking={markRead.isPending}
                />
              ))}
            </div>
          </AnimatePresence>
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
            <span className="text-xs font-mono text-matrix-subtle">
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
