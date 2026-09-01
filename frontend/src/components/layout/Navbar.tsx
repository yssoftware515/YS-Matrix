'use client';

// ============================================================
// YS-MATRIX ERP — Navbar (Phase 3 Stage 1 + MOB-02)
// Changes vs previous version:
//   • Added `onMenuClick` prop → mobile hamburger trigger (MOB-02)
//   • Everything else unchanged (NotificationCenter, license logic)
// ============================================================

import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Calendar, Building2, CheckCircle2, Menu } from 'lucide-react';
import { useAuthStore } from '@/lib/auth';
import { formatDate, daysUntil, cn } from '@/lib/utils';
import { NotificationCenter } from '@/components/ui/NotificationCenter';

type LicenseStatus = 'ok' | 'warning' | 'expired' | 'unknown';

function resolveLicenseStatus(days: number): LicenseStatus {
  if (days <= 0)  return 'expired';
  if (days <= 7)  return 'warning';
  if (days < 999) return 'ok';
  return 'unknown';
}

const LICENSE_STYLES: Record<LicenseStatus, {
  badge: string; dot: string;
  label: (d: number) => string;
  icon: React.ElementType;
}> = {
  ok:      { badge: 'border-matrix-cyan/20 bg-matrix-cyan/5 text-matrix-cyan/70',    dot: 'bg-matrix-cyan',  label: (d) => `${d} يوم`,           icon: CheckCircle2  },
  warning: { badge: 'border-matrix-amber/30 bg-matrix-amber/10 text-matrix-amber',   dot: 'bg-matrix-amber', label: (d) => `ينتهي خلال ${d} يوم`, icon: AlertTriangle },
  expired: { badge: 'border-matrix-red/30 bg-matrix-red/10 text-matrix-red',         dot: 'bg-matrix-red',   label: () => 'الاشتراك منتهي',       icon: AlertTriangle },
  unknown: { badge: 'border-matrix-border bg-transparent text-matrix-subtle/50',     dot: 'bg-matrix-subtle',label: () => '—',                    icon: Calendar      },
};

interface NavbarProps {
  title?: string;
  /** MOB-02: opens the Sidebar off-canvas drawer on screens < 768px */
  onMenuClick?: () => void;
}

export function Navbar({ title = 'لوحة التحكم', onMenuClick }: NavbarProps) {
  const user     = useAuthStore((s) => s.user);
  const showroom = user?.showroom ?? null;
  const expiry   = showroom?.license_expiry ?? null;
  const days     = expiry ? daysUntil(expiry) : 999;
  const status   = resolveLicenseStatus(days);
  const style    = LICENSE_STYLES[status];
  const StatusIcon = style.icon;

  return (
    <header
      className={cn(
        'relative h-16 flex items-center justify-between px-4 md:px-6 shrink-0 z-10',
        'bg-matrix-dark/40 backdrop-blur-xl border-b border-matrix-border/60',
      )}
      style={{ boxShadow: '0 1px 0 rgba(0,212,255,0.06), 0 4px 24px rgba(0,0,0,0.35)' }}
    >
      {/* Ambient bottom glow */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(0,212,255,0.18) 35%, rgba(0,212,255,0.22) 50%, rgba(0,212,255,0.18) 65%, transparent 100%)' }}
      />

      {/* Left: Hamburger (mobile only) + Page Title */}
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-center gap-3 min-w-0"
      >
        {/* MOB-02: the sidebar is off-canvas below md, so this is the
            only way to reach it on mobile. Always visible on mobile
            (not tied to collapsed state) — it toggles the drawer, not
            the desktop collapse mode, which is a separate concern. */}
        <button
          onClick={onMenuClick}
          className="icon-btn md:hidden shrink-0"
          aria-label="فتح القائمة"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div
          className="w-1 h-6 bg-matrix-cyan rounded-full shrink-0"
          style={{ boxShadow: '0 0 8px rgba(0,212,255,0.8)' }}
        />
        <h1
          className="text-sm font-semibold tracking-widest text-matrix-text uppercase truncate"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h1>
      </motion.div>

      {/* Center: System Status */}
      <AnimatePresence>
        {showroom && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-2"
          >
            <span
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-matrix-border/70 bg-matrix-dark/60 text-matrix-subtle/70"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em' }}
            >
              <Building2 className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[140px]">{showroom.name}</span>
            </span>

            <span className="w-1 h-1 rounded-full bg-matrix-border" />

            <span
              className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md border', style.badge)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.1em' }}
            >
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                {(status === 'warning' || status === 'expired') && (
                  <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-60', style.dot)} />
                )}
                <span className={cn('relative inline-flex rounded-full h-1.5 w-1.5', style.dot)} />
              </span>
              <StatusIcon className="w-3 h-3 shrink-0" />
              {expiry && status === 'ok'
                ? <span>{formatDate(expiry)}</span>
                : <span>{style.label(days)}</span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right: License warning (mobile) + NotificationCenter */}
      <div className="flex items-center gap-3 shrink-0">
        {(status === 'warning' || status === 'expired') && (
          <span
            className={cn('flex md:hidden items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px]', style.badge)}
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            <StatusIcon className="w-3 h-3 shrink-0" />
            {style.label(days)}
          </span>
        )}

        {/* ── NotificationCenter replaces the old Bell button ── */}
        <NotificationCenter />
      </div>
    </header>
  );
}
