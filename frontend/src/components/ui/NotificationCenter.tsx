'use client';

// ============================================================
// YS-MATRIX ERP — NotificationCenter (Phase 3 Stage 1)
// Dropdown panel triggered from Navbar Bell icon
// ============================================================

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, CheckCheck, Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatDate } from '@/lib/utils';
import { useNotifications, useUnreadCount, useMarkAsRead, useMarkAllAsRead } from '@/hooks/useNotifications';
import { NOTIFICATION_CONFIG, Notification } from '@/types/notification.types';

// Phase B.1 (F6/F7): severity → border accent for the row. Only the
// unread rows are accented (read rows stay quiet).
const SEVERITY_ACCENT: Record<string, string> = {
  warning:  'border-r-2 border-r-matrix-amber',
  critical: 'border-r-2 border-r-matrix-red',
};

// ─────────────────────────────────────────
// Single notification row
// ─────────────────────────────────────────
function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead:   (id: string) => void;
}) {
  const router = useRouter();
  const cfg = NOTIFICATION_CONFIG[notification.type] ?? {
    icon: '🔔', colorClass: 'text-matrix-subtle', label: notification.type,
    severity: 'info' as const,
  };

  // Phase B.1 (F6): a notification with an action is a deep link —
  // click the row to jump to the one place the customer can act
  // (e.g. rejected payment → billing), marking it read on the way.
  const handleClick = () => {
    if (cfg.action) {
      if (!notification.is_read) onMarkRead(notification.id);
      router.push(cfg.action.href);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={handleClick}
      className={cn(
        'flex items-start gap-3 px-4 py-3 border-b border-matrix-border/50',
        'transition-colors duration-150',
        !notification.is_read && 'bg-matrix-cyan/[0.03]',
        cfg.action
          ? 'cursor-pointer hover:bg-matrix-cyan/5'
          : 'cursor-default',
        !notification.is_read && SEVERITY_ACCENT[cfg.severity],
      )}
    >
      {/* Type icon */}
      <span className="text-lg shrink-0 mt-0.5">{cfg.icon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-xs font-semibold mb-0.5', cfg.colorClass)}>
          {notification.title}
        </p>
        <p className="text-xs text-matrix-subtle leading-relaxed line-clamp-2">
          {notification.body}
        </p>
        <p className="text-[10px] text-matrix-subtle/50 mt-1 font-mono">
          {formatDate(notification.created_at)}
        </p>
        {cfg.action && (
          <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-mono text-matrix-cyan">
            {cfg.action.label} ←
          </span>
        )}
      </div>

      {/* Mark as read button — stopPropagation so it never navigates */}
      {!notification.is_read && (
        <button
          onClick={(e) => { e.stopPropagation(); onMarkRead(notification.id); }}
          className="shrink-0 w-7 h-7 rounded-full bg-matrix-cyan/10 border border-matrix-cyan/20 flex items-center justify-center hover:bg-matrix-cyan/20 transition-all mt-0.5"
          title="تحديد كمقروء"
        >
          <Check className="w-3 h-3 text-matrix-cyan" />
        </button>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────
export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.unread_count ?? 0;

  const { data, isLoading } = useNotifications({
    is_read: filter === 'unread' ? 'false' : undefined,
    limit:   20,
  });

  const markRead    = useMarkAsRead();
  const markAllRead = useMarkAllAsRead();

  const notifications = data?.data ?? [];

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>

      {/* ── Bell Button ─────────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative flex items-center justify-center w-8 h-8 rounded-lg',
          'border border-matrix-border text-matrix-subtle',
          'hover:text-matrix-cyan hover:border-matrix-cyan/60',
          'transition-all duration-200',
          open && 'border-matrix-cyan/60 text-matrix-cyan bg-matrix-cyan/5',
        )}
        aria-label="الإشعارات"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-matrix-red flex items-center justify-center"
            style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Panel ───────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{   opacity: 0, y: 8,  scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'absolute left-0 top-10 z-50',
              'w-80 max-h-[480px] flex flex-col',
              'matrix-panel border border-matrix-border',
              'shadow-[0_8px_40px_rgba(0,0,0,0.6)]',
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-matrix-border shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="w-3.5 h-3.5 text-matrix-cyan" />
                <span className="text-xs font-mono font-semibold tracking-widest uppercase text-matrix-text">
                  الإشعارات
                </span>
                {unreadCount > 0 && (
                  <span className="badge-red text-[10px] px-1.5 py-0">{unreadCount}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllRead.mutate()}
                    disabled={markAllRead.isPending}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-matrix-border text-matrix-subtle hover:border-matrix-green hover:text-matrix-green transition-all"
                  >
                    {markAllRead.isPending
                      ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      : <CheckCheck className="w-2.5 h-2.5" />}
                    قراءة الكل
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-matrix-subtle hover:text-matrix-red transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex border-b border-matrix-border shrink-0">
              {(['all', 'unread'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'flex-1 py-2 text-[10px] font-mono uppercase tracking-wider transition-all',
                    filter === f
                      ? 'text-matrix-cyan border-b-2 border-matrix-cyan'
                      : 'text-matrix-subtle hover:text-matrix-text',
                  )}
                >
                  {f === 'all' ? 'الكل' : 'غير المقروءة'}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-matrix-cyan" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-matrix-subtle">
                  <Bell className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">لا توجد إشعارات</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onMarkRead={(id) => markRead.mutate(id)}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-2 border-t border-matrix-border shrink-0 text-center">
                <a
                  href="/dashboard/notifications"
                  className="text-[10px] font-mono text-matrix-cyan hover:text-matrix-cyan/80 transition-colors"
                  onClick={() => setOpen(false)}
                >
                  عرض كل الإشعارات ←
                </a>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
