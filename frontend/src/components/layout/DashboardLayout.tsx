'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { useAuthStore } from '@/lib/auth';
import { authApi } from '@/lib/api';

interface Props {
  children: React.ReactNode;
  title?: string;
}

export function DashboardLayout({ children, title }: Props) {
  const router = useRouter();
  const isAuth = useAuthStore((s) => s.isAuth);
  const [collapsed, setCollapsed] = useState(false);
  // MOB-02: separate from `collapsed` on purpose — `collapsed` is the
  // desktop icon-rail mode, `mobileOpen` is the mobile off-canvas drawer.
  // Conflating them would mean toggling one accidentally affects the
  // other's behavior once the viewport crosses the md breakpoint.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isAuth) {
      router.replace('/auth/login');
    }
  }, [mounted, isAuth, router]);

  // ─────────────────────────────────────────────────────────────
  // Session freshness (Phase 3 — P3-C): re-resolve the identity from
  // the backend on mount and on window refocus (throttled to 60s).
  // The backend is authoritative on every request, but the local
  // user/authorization snapshot (store + ys-auth cookie) used to be
  // only as fresh as the last login — a demoted/deactivated/role-
  // changed user kept seeing stale menu gating until their next
  // reload. me() refreshes both the store and the cookie; a 401
  // (deactivated account, revoked sessions) is already handled by the
  // Axios interceptor, which clears auth and redirects to login.
  // Skipped entirely during impersonation — me() would resolve to the
  // impersonated OWNER and must not touch the stashed SuperAdmin data.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let lastSync = 0;

    const sync = () => {
      const { user, originalSession } = useAuthStore.getState();
      if (!user || originalSession) return;
      const now = Date.now();
      if (now - lastSync < 60_000) return;
      lastSync = now;
      authApi.me()
        .then((me) => {
          if (!cancelled) useAuthStore.getState().updateUser(me);
        })
        .catch(() => { /* 401/403 → interceptor cleared auth + redirected */ });
    };

    sync();
    window.addEventListener('focus', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', sync);
    };
  }, []);

  // Render loading during SSR and before mount
  if (!mounted) {
    return <SplashScreen label="LOADING..." />;
  }

  if (!isAuth) {
    return null;
  }

  return (
    <div className="flex h-screen bg-matrix-black overflow-hidden">
      {/* MOB-02: dims/blocks the page content behind the drawer and
          doubles as a tap-to-close target on mobile. Never rendered
          from md upward, where the sidebar is docked, not overlaid. */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMobileOpen(false)}
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Navbar title={title} onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 relative">
          <div className="absolute inset-0 bg-grid opacity-20 pointer-events-none" />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
