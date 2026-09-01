'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { AlertTriangle, LogOut, PhoneCall } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi, clearTokens } from '@/lib/api';
import { useAuthStore } from '@/lib/auth';

// Phase A (P2-6): explicit SUSPENDED screen. The dashboard gate
// (dashboard/page.tsx) routes here when the backend reports
// account_status = 'SUSPENDED' (showroom deactivated server-side,
// is_active = false). This is a hard state, not a billing one — no
// plan cards, no ERP actions; the owner can only leave (logout) or
// contact support. Backend /subscriptions/* authorization remains the
// authoritative boundary — this page is the UX surface for it.
export default function SuspendedPage() {
  const router = useRouter();
  const { user, clearAuth, refreshToken } = useAuthStore();

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

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-matrix-darkest">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="matrix-panel max-w-md w-full p-8 text-center"
      >
        <div className="flex items-center justify-center w-14 h-14 mx-auto mb-5 rounded-xl bg-matrix-red/10 border border-matrix-red/40">
          <AlertTriangle className="w-7 h-7 text-matrix-red" />
        </div>

        <h1
          className="font-display text-xl font-bold tracking-wider text-matrix-text mb-3"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          حسابك معلّق
        </h1>

        <p className="text-sm text-matrix-subtle leading-relaxed mb-2">
          تم تعليق نشاط هذا المعرض بواسطة إدارة النظام.
          {user?.showroom?.name ? (
            <span className="block mt-1 font-mono text-matrix-cyan text-xs">{user.showroom.name}</span>
          ) : null}
        </p>

        <p className="text-xs text-matrix-subtle leading-relaxed mb-8">
          جميع الصلاحيات التجارية معطّلة مؤقتاً. للاستفسار عن سبب التعليق أو
          إعادة التفعيل، يرجى التواصل مع الدعم.
        </p>

        <div className="space-y-3">
          <a
            href="tel:+967000000000"
            className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg border border-matrix-border text-matrix-cyan hover:border-matrix-cyan transition-all text-sm font-mono"
          >
            <PhoneCall className="w-4 h-4" />
            التواصل مع الدعم
          </a>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg bg-matrix-red/10 border border-matrix-red/40 text-matrix-red hover:bg-matrix-red/20 transition-all text-sm font-mono"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </button>
        </div>
      </motion.div>
    </main>
  );
}
