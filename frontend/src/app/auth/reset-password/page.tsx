'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Eye, EyeOff, AlertCircle, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { authApi, isApiRequestError } from '@/lib/api';

const extractErrorMessage = (err: unknown): string =>
  isApiRequestError(err) ? err.message : 'حدث خطأ. يرجى المحاولة لاحقاً.';

// ============================================================
// Matrix Audit: useSearchParams() requires a <Suspense> boundary in
// Next.js App Router — without one, `next build`'s static
// prerendering step fails outright (confirmed directly from a real
// Vercel build log: "useSearchParams() should be wrapped in a
// suspense boundary"). This only surfaces at PRODUCTION BUILD time,
// not in `npm run dev` — which is exactly why this wasn't caught
// until the actual Vercel deploy, despite local dev testing passing
// cleanly. All the actual page logic now lives in this inner
// component; the default export below is just a thin Suspense
// wrapper around it, per Next.js's own documented pattern for this
// exact situation.
// ============================================================
function ResetPasswordForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token         = searchParams.get('token');

  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass,        setShowPass]        = useState(false);
  const [isLoading,       setIsLoading]       = useState(false);
  const [error,           setError]           = useState('');
  const [success,         setSuccess]         = useState(false);
  const [mounted,         setMounted]         = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Redirect to /auth/login automatically a few seconds after
  // success — gives the person time to read the confirmation instead
  // of yanking them away instantly.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => router.push('/auth/login'), 3000);
    return () => clearTimeout(t);
  }, [success, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !token) return;
    setError('');

    // Client-side mirror of the backend's own checks (resetPasswordSchema) —
    // catches the obvious case instantly instead of round-tripping to
    // the server just to learn the two fields don't match.
    if (newPassword !== confirmPassword) {
      setError('كلمة المرور الجديدة وتأكيدها غير متطابقين.');
      return;
    }
    if (newPassword.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div
      style={{ minHeight: '100vh', backgroundColor: '#020408', position: 'relative', overflow: 'hidden' }}
      className="flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-grid opacity-50" />
      <div
        style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)' }}
        className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse-slow"
      />
      <div
        style={{ background: 'radial-gradient(circle, rgba(0,102,255,0.06) 0%, transparent 70%)', animationDelay: '2s' }}
        className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse-slow"
      />

      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0,  scale: 1   }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md mx-4 z-10"
      >
        <div className="absolute -top-px -left-px   w-8 h-8 border-t-2 border-l-2 border-matrix-cyan rounded-tl-panel" />
        <div className="absolute -top-px -right-px  w-8 h-8 border-t-2 border-r-2 border-matrix-cyan rounded-tr-panel" />
        <div className="absolute -bottom-px -left-px  w-8 h-8 border-b-2 border-l-2 border-matrix-cyan rounded-bl-panel" />
        <div className="absolute -bottom-px -right-px w-8 h-8 border-b-2 border-r-2 border-matrix-cyan rounded-br-panel" />

        <div className="matrix-panel p-8">

          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, duration: 0.6, type: 'spring' }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-full border-2 border-matrix-cyan mb-4"
              style={{ boxShadow: '0 0 30px rgba(0,212,255,0.3)' }}
            >
              <ShieldCheck className="w-8 h-8 text-matrix-cyan" />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
              <h1
                className="text-2xl font-bold tracking-widest text-neon-cyan mb-1"
                style={{ fontFamily: 'Orbitron, monospace' }}
              >
                تعيين كلمة مرور جديدة
              </h1>
              <p
                className="text-xs text-matrix-subtle tracking-[0.3em] uppercase"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                YS-MATRIX ERP SYSTEM
              </p>
            </motion.div>
          </div>

          {/* ── No token in URL at all — malformed/incomplete link ── */}
          {!token ? (
            <div className="text-center space-y-4">
              <div className="p-3 rounded-lg border border-matrix-red/30 bg-matrix-red/10 flex items-start gap-2 text-right">
                <AlertCircle className="w-4 h-4 text-matrix-red shrink-0 mt-0.5" />
                <p className="text-matrix-red text-sm leading-relaxed" style={{ fontFamily: 'Rajdhani, sans-serif' }}>
                  رابط إعادة التعيين غير مكتمل. تأكّد من فتح الرابط كاملاً من رسالة البريد الإلكتروني.
                </p>
              </div>
              <Link
                href="/auth/forgot-password"
                className="inline-flex items-center gap-2 text-sm text-matrix-cyan hover:text-neon-cyan transition-colors"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                طلب رابط جديد
                <ArrowRight className="w-4 h-4 rotate-180" />
              </Link>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {success ? (
                // ── Success state ────────────────────────────────
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-center space-y-5"
                >
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full border-2 border-matrix-green mx-auto"
                       style={{ boxShadow: '0 0 24px rgba(34,197,94,0.25)' }}>
                    <CheckCircle2 className="w-7 h-7 text-matrix-green" />
                  </div>
                  <p className="text-matrix-subtle text-sm leading-relaxed" style={{ fontFamily: 'Rajdhani, sans-serif' }}>
                    تم تغيير كلمة المرور بنجاح. سيتم تحويلك لصفحة تسجيل الدخول خلال لحظات...
                  </p>
                  <Link
                    href="/auth/login"
                    className="inline-flex items-center gap-2 text-sm text-matrix-cyan hover:text-neon-cyan transition-colors"
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    الذهاب الآن
                    <ArrowRight className="w-4 h-4 rotate-180" />
                  </Link>
                </motion.div>
              ) : (
                // ── Form state ───────────────────────────────────
                <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        key="error-card"
                        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginBottom: '16px' }}
                        exit={{   opacity: 0, height: 0,      marginBottom: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="p-3 rounded-lg border border-matrix-red/30 bg-matrix-red/10 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-matrix-red shrink-0 mt-0.5" />
                          <p className="text-matrix-red text-sm leading-relaxed" style={{ fontFamily: 'Rajdhani, sans-serif' }}>
                            {error}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label
                        className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2"
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        كلمة المرور الجديدة
                      </label>
                      <div className="relative">
                        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="matrix-input pr-10 pl-10"
                          placeholder="••••••••"
                          required
                          dir="ltr"
                          autoComplete="new-password"
                          disabled={isLoading}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass(!showPass)}
                          disabled={isLoading}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-matrix-subtle hover:text-matrix-cyan transition-colors disabled:opacity-40"
                          tabIndex={-1}
                        >
                          {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label
                        className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2"
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        تأكيد كلمة المرور
                      </label>
                      <div className="relative">
                        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="matrix-input pr-10"
                          placeholder="••••••••"
                          required
                          dir="ltr"
                          autoComplete="new-password"
                          disabled={isLoading}
                        />
                      </div>
                    </div>

                    <motion.button
                      type="submit"
                      disabled={isLoading}
                      whileTap={isLoading ? {} : { scale: 0.97 }}
                      className="w-full btn-primary flex items-center justify-center gap-2 h-12 mt-6"
                      style={{ cursor: isLoading ? 'not-allowed' : 'pointer' }}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {isLoading ? (
                          <motion.span
                            key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="flex items-center gap-2"
                            style={{ fontFamily: 'JetBrains Mono, monospace' }}
                          >
                            <span className="text-xs tracking-widest">جاري الحفظ...</span>
                          </motion.span>
                        ) : (
                          <motion.span
                            key="default" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="flex items-center gap-2"
                          >
                            <ShieldCheck className="w-4 h-4" />
                            <span>حفظ كلمة المرور</span>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          <div className="mt-8 pt-6 border-t border-matrix-border text-center">
            <p className="text-xs text-matrix-subtle" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              Powered by{' '}
              <span className="text-matrix-cyan">YS Systems &amp; Software</span>
            </p>
          </div>

        </div>
      </motion.div>
    </div>
  );
}

// ── Minimal, brand-consistent fallback shown only for the brief
// moment Next.js needs to resolve the Suspense boundary — same dark
// background as the form itself so there's no visible flash/mismatch
// when the real content mounts a moment later.
function ResetPasswordFallback() {
  return (
    <div
      style={{ minHeight: '100vh', backgroundColor: '#020408' }}
      className="flex items-center justify-center"
    >
      <div className="w-8 h-8 border-2 border-matrix-cyan border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
