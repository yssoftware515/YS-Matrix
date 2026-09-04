'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Package, Users, ShoppingCart, BarChart3,
  Truck, ChevronLeft, ChevronRight, LogOut, Settings,
  Wallet, Bell, Shield, X, History,
} from 'lucide-react';
import { useAuthStore, isSuperAdmin, isPlatformAdmin } from '@/lib/auth';
import { authApi, clearTokens } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const NAV = [
  { href: '/dashboard',              label: 'الرئيسية',  icon: LayoutDashboard, group: 'main' },
  { href: '/dashboard/inventory',    label: 'المخزون',   icon: Package,          group: 'main' },
  { href: '/dashboard/sales',        label: 'المبيعات',  icon: ShoppingCart,     group: 'main' },
  { href: '/dashboard/customers',    label: 'العملاء',   icon: Users,            group: 'main' },
  { href: '/dashboard/suppliers',    label: 'الموردون',  icon: Truck,            group: 'main' },
  { href: '/dashboard/analytics',    label: 'التحليلات', icon: BarChart3,        group: 'data' },
  { href: '/dashboard/expenses',     label: 'المصاريف',  icon: Wallet,           group: 'data' },
  { href: '/dashboard/installments', label: 'الأقساط',   icon: Bell,             group: 'data' },
  // F6 — activity feed surfaced in the sidebar (was reachable only by
  // typing the URL; the notifications page existed but had no nav link).
  { href: '/dashboard/activity',     label: 'سجل النشاط', icon: History,        group: 'data' },
  { href: '/dashboard/showrooms',    label: 'المعارض',   icon: Shield,           group: 'admin', admin: true },
  { href: '/dashboard/superadmin/users', label: 'المستخدمون', icon: Users, group: 'admin', admin: true },
  { href: '/dashboard/settings',     label: 'الإعدادات', icon: Settings,         group: 'sys' },
  { href: '/dashboard/notifications', label: 'الإشعارات', icon: Bell,            group: 'sys' },

  // F4 — tenant staff management. OWNER-only: hidden from STAFF in the
  // sidebar AND guarded by middleware + backend ownerOnly (three layers,
  // so a stale client can never reach the surface).
  { href: '/dashboard/users',        label: 'المستخدمون', icon: Users,           group: 'sys', owner: true },

  // Phase 4/5 — customer self-service subscription surface. Visible
  // to EVERY signed-in showroom user (OWNER/STAFF) — a team member
  // can check plan status/usage, while plan selection + purchases
  // are OWNER-gated at the API (subscription.routes.js).
  { href: '/dashboard/billing',      label: 'الاشتراك والفوترة', icon: Wallet,    group: 'main' },

  // Phase 2 (Delegated Platform Administrators) — /api/v1/admin surface.
  // Shown for SUPER_ADMIN AND delegated GLOBAL-scope admins; invisible
  // to everyone else even though the items are <Link>s (guard = sidebar
  // filter + middleware + backend requireScope).
  { href: '/admin',                label: 'نظرة عامة',  icon: LayoutDashboard, group: 'platform', platform: true },
  { href: '/admin/profiles',       label: 'الصلاحيات',  icon: Shield,          group: 'platform', platform: true },
  { href: '/admin/administrators', label: 'المشرفون',   icon: Users,           group: 'platform', platform: true },
  { href: '/admin/users',          label: 'المستخدمون', icon: Users,           group: 'platform', platform: true },
  { href: '/admin/showrooms',      label: 'المعارض',    icon: Shield,          group: 'platform', platform: true },
  { href: '/admin/payments',       label: 'المدفوعات',  icon: Wallet,          group: 'platform', platform: true },
  { href: '/admin/audit',          label: 'سجل التدقيق', icon: History,        group: 'platform', platform: true },
];

const GROUPS = [
  { key: 'main',  label: 'الإدارة' },
  { key: 'data',  label: 'التحليل' },
  { key: 'admin',    label: 'سوبر أدمن' },
  { key: 'sys',      label: 'النظام' },
  { key: 'platform', label: 'منصة الإدارة' },
];

// ─── helper: resolve role label ───────────────────────────────────────────────
function getRoleLabel(role?: string, scope?: string): string {
  if (role === 'SUPER_ADMIN') return 'مدير النظام';
  if (scope === 'GLOBAL')     return 'مسؤول المنصة';
  if (role === 'OWNER')       return 'صاحب المعرض';
  return 'موظف';
}

// ─── helper: resolve showroom name safely ─────────────────────────────────────
function getShowroomName(user?: { showroom?: { name?: string } } | null): string {
  return user?.showroom?.name?.trim() || 'معرض غير معرف';
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** MOB-02: controls the off-canvas drawer on screens < 768px */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, clearAuth, refreshToken, originalSession, exitImpersonation } = useAuthStore();

  // MOB-02: close the mobile drawer automatically on every route change.
  // Without this, tapping a nav link on mobile would navigate but leave
  // the drawer covering the new page until the user manually closes it.
  useEffect(() => {
    onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ─── logout: single-execution guard ───────────────────────────────────────
  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch {
      // silent — we always clear locally
    } finally {
      clearTokens();
      clearAuth();
      toast.success('تم تسجيل الخروج');
      router.push('/auth/login');
    }
  };

  // Matrix Audit (#9 — Impersonation): does NOT call the logout API —
  // the impersonation session has no refresh token to revoke server-
  // side in the first place (it was never issued one, by design — see
  // jwt.js). Simply restores the stashed SuperAdmin session.
  const handleExitImpersonation = () => {
    exitImpersonation();
    toast.success('تم الرجوع لحساب مدير النظام');
    router.push('/dashboard/showrooms');
  };

  // Matrix Audit (#10 — Role-Based Sidebar Rendering):
  // SuperAdmin manages the PLATFORM (showrooms, global users) — not any
  // single showroom's day-to-day operations — so operational groups
  // (main: inventory/sales/customers/suppliers, data: analytics/
  // expenses/installments) are hidden for that role entirely, not just
  // filtered item-by-item. OWNER/STAFF get the reverse: full
  // operational access, zero visibility into admin-only items (the
  // `!i.admin` guard already covers per-item hiding for them).
  // `sys` (Settings) stays visible to everyone regardless of role.
  const items = isSuperAdmin(user?.role)
    ? NAV.filter((i) => !i.owner && (i.group === 'admin' || i.group === 'sys' || i.group === 'platform'))
    : NAV.filter((i) =>
        !i.admin &&
        (i.group !== 'platform' || isPlatformAdmin(user)) &&
        (!i.owner || user?.role === 'OWNER')
      );

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'h-screen flex flex-col border-l border-matrix-border bg-matrix-dark shrink-0 overflow-hidden',
        // MOB-02: below md, the sidebar is an off-canvas drawer fixed to
        // the right edge (natural position under dir="rtl"), slid fully
        // out of view by default and toggled via the Navbar hamburger.
        // From md upward it reverts to the original static, in-flow panel.
        'fixed inset-y-0 right-0 z-50 transition-transform duration-300 ease-out',
        'md:relative md:z-auto md:translate-x-0',
        mobileOpen ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Ambient edge glow — right border */}
      <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-matrix-cyan/15 to-transparent pointer-events-none" />

      {/* ── Impersonation Banner (Matrix Audit #9) ─────────────────────────── */}
      {/* Only rendered while originalSession is stashed — i.e. an active
          impersonation session. Present on every dashboard page since
          Sidebar mounts globally, so it's impossible to lose track of
          "who am I really" while impersonating. */}
      <AnimatePresence>
        {originalSession && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 border-b border-matrix-purple/30 bg-matrix-purple/10 overflow-hidden"
          >
            <button
              onClick={handleExitImpersonation}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2.5 text-right hover:bg-matrix-purple/15 transition-colors',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? 'رجوع لحساب مدير النظام' : undefined}
            >
              <Shield className="w-4 h-4 text-matrix-purple shrink-0" />
              {!collapsed && (
                <span className="text-[11px] text-matrix-purple leading-tight">
                  وضع المعاينة — رجوع لحساب مدير النظام
                </span>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-matrix-border shrink-0">
        <Link href="/dashboard" className="flex items-center gap-3 min-w-0">
          <div
            className="relative flex items-center justify-center w-9 h-9 rounded-lg border border-matrix-cyan/40 shrink-0 overflow-hidden bg-matrix-dark"
            style={{ boxShadow: '0 0 12px rgba(0,212,255,0.2)' }}
          >
            <Image
              src="/logo.webp"
              alt="YS-MATRIX"
              fill
              sizes="36px"
              priority
              className="object-contain"
            />
          </div>

          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="min-w-0"
              >
                <p
                  className="text-sm font-bold tracking-widest text-matrix-cyan truncate"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  YS-MATRIX
                </p>
                <p
                  className="text-[9px] text-matrix-subtle tracking-[0.2em] truncate"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  ERP SYSTEM
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>

        {/* MOB-02: explicit close affordance inside the drawer itself —
            relying on backdrop-tap alone is not discoverable enough on
            a first-time mobile visit. Desktop never renders this. */}
        <button
          onClick={onMobileClose}
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-matrix-subtle hover:text-matrix-cyan hover:bg-matrix-cyan/10 transition-colors shrink-0"
          aria-label="إغلاق القائمة"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
        {GROUPS.map((group) => {
          const groupItems = items.filter((i) => i.group === group.key);
          if (!groupItems.length) return null;

          return (
            <div key={group.key}>
              <AnimatePresence>
                {!collapsed && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-2 mb-1 text-[10px] uppercase tracking-[0.2em] text-matrix-subtle/60"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {group.label}
                  </motion.p>
                )}
              </AnimatePresence>

              <div className="space-y-0.5">
                {groupItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== '/dashboard' && pathname.startsWith(item.href));
                  const Icon = item.icon;

                  return (
                    <Link key={item.href} href={item.href}>
                      <motion.div
                        whileHover={{ x: -2 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className={cn(
                          'nav-item relative',
                          isActive && 'active',
                          collapsed && 'justify-center px-2'
                        )}
                        title={collapsed ? item.label : undefined}
                      >
                        {/* ── Cinematic Glow background (active only) ── */}
                        {isActive && (
                          <motion.div
                            layoutId="nav-active-bg"
                            className="absolute inset-0 rounded-lg bg-matrix-cyan/[0.07] border border-matrix-cyan/20"
                            style={{
                              boxShadow: 'inset 0 0 14px rgba(0,212,255,0.06), 0 0 8px rgba(0,212,255,0.04)',
                            }}
                            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                          />
                        )}

                        {/* ── Left accent bar ── */}
                        {isActive && (
                          <motion.div
                            layoutId="nav-active"
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-matrix-cyan rounded-full"
                            style={{ boxShadow: '0 0 8px rgba(0,212,255,0.8)' }}
                          />
                        )}

                        <Icon
                          className={cn(
                            'w-4 h-4 shrink-0 relative z-10',
                            isActive ? 'text-matrix-cyan' : 'text-matrix-subtle'
                          )}
                          style={
                            isActive
                              ? { filter: 'drop-shadow(0 0 4px rgba(0,212,255,0.6))' }
                              : undefined
                          }
                        />

                        <AnimatePresence>
                          {!collapsed && (
                            <motion.span
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="truncate text-sm relative z-10"
                            >
                              {item.label}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── User Card ─────────────────────────────────────────────────────── */}
      <div className="border-t border-matrix-border p-3 shrink-0">
        {/* Avatar + info */}
        <div className={cn('flex items-center gap-3 px-2 py-2', collapsed && 'justify-center')}>
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full border border-matrix-cyan/30 bg-matrix-cyan/10 text-matrix-cyan text-xs font-bold shrink-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {user?.name?.charAt(0)?.toUpperCase() || 'Y'}
          </div>

          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0"
              >
                {/* User display name */}
                <p
                  className="text-sm text-matrix-text truncate"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  {user?.name}
                </p>

                {/* Role */}
                <p
                  className="text-[10px] text-matrix-subtle truncate"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {getRoleLabel(user?.role, user?.authorization?.scope)}
                </p>

                {/* ── Multi-tenant: showroom name ── */}
                <p
                  className="text-[10px] text-matrix-cyan/60 truncate mt-0.5"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  title={getShowroomName(user)}
                >
                  {getShowroomName(user)}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className={cn(
            'w-full mt-1 flex items-center gap-3 px-2 py-2 rounded-lg text-matrix-subtle',
            'hover:text-matrix-red hover:bg-matrix-red/10 transition-all duration-200 text-sm',
            collapsed && 'justify-center'
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                تسجيل الخروج
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* ── Developer Signature ── */}
        <AnimatePresence>
          {!collapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-3 text-center text-[9px] tracking-[0.18em] text-matrix-subtle/35 select-none"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              Powered by{' '}
              <span
                className="text-matrix-cyan/50"
                style={{ textShadow: '0 0 6px rgba(0,212,255,0.25)' }}
              >
                YS Systems &amp; Software
              </span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ── Desktop Collapse Toggle ──────────────────────────────────────────
          Hidden on mobile: below md the sidebar is either fully open (drawer)
          or fully closed — there is no "collapsed to icon rail" state on
          mobile, so this control has nothing meaningful to do there. */}
      <button
        onClick={onToggle}
        className="hidden md:flex absolute -left-3 top-20 items-center justify-center w-6 h-6 rounded-full border border-matrix-border bg-matrix-dark text-matrix-subtle hover:text-matrix-cyan hover:border-matrix-cyan transition-all duration-200"
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
      >
        {collapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
    </motion.aside>
  );
}
