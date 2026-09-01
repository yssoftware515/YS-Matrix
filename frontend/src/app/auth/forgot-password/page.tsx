'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, AlertCircle, ArrowRight, KeyRound, CheckCircle2 } from 'lucide-react';
import { authApi, isApiRequestError } from '@/lib/api';

// ── Safe error message extractor — same pattern as LoginPage ──
const extractErrorMessage = (err: unknown): string =>
  isApiRequestError(err) ? err.message : 'حدث خطأ. يرجى المحاولة لاحقاً.';

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState('');
  const [sent,      setSent]      = useState(false);
  const [mounted,   setMounted]   = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError('');
    setIsLoading(true);

    try {
      // Backend always returns the same generic success response
      // whether the email exists or not (anti-enumeration) — this
      // page mirrors that on purpose: `sent` flips to true on any
      // non-error response, never branching on "found vs not found".
      await authApi.forgotPasswordRequest(email);
      setSent(true);
    } catch (err: unknown) {
      // Network/server errors only reach here — the backend's own
      // anti-enumeration logic means a "user not found" case never
      // throws, it resolves successfully like any other request.
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
      {/* ── Grid background ── */}
      <div className="absolute inset-0 bg-grid opacity-50" />

      {/* ── Glow orbs ── */}
      <div
        style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)' }}
        className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse-slow"
      />
      <div
        style={{ background: 'radial-gradient(circle, rgba(0,102,255,0.06) 0%, transparent 70%)', animationDelay: '2s' }}
        className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse-slow"
      />

      {/* ── Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0,  scale: 1   }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md mx-4 z-10"
      >
        {/* Corner accents */}
        <div className="absolute -top-px -left-px   w-8 h-8 border-t-2 border-l-2 border-matrix-cyan rounded-tl-panel" />
        <div className="absolute -top-px -right-px  w-8 h-8 border-t-2 border-r-2 border-matrix-cyan rounded-tr-panel" />
        <div className="absolute -bottom-px -left-px  w-8 h-8 border-b-2 border-l-2 border-matrix-cyan rounded-bl-panel" />
        <div className="absolute -bottom-px -right-px w-8 h-8 border-b-2 border-r-2 border-matrix-cyan rounded-br-panel" />

        <div className="matrix-panel p-8">

          {/* ── Header ── */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, duration: 0.6, type: 'spring' }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-full border-2 border-matrix-cyan mb-4"
              style={{ boxShadow: '0 0 30px rgba(0,212,255,0.3)' }}
            >
              <KeyRound className="w-8 h-8 text-matrix-cyan" />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
              <h1
                className="text-2xl font-bold tracking-widest text-neon-cyan mb-1"
                style={{ fontFamily: 'Orbitron, monospace' }}
              >
                استرجاع الحساب
              </h1>
              <p
                className="text-xs text-matrix-subtle tracking-[0.3em] uppercase"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                YS-MATRIX ERP SYSTEM
              </p>
            </motion.div>
          </div>

          <AnimatePresence mode="wait">
            {sent ? (
              // ── Success state ──────────────────────────────────
              <motion.div
                key="sent"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-center space-y-5"
              >
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full border-2 border-matrix-green mx-auto"
                     style={{ boxShadow: '0 0 24px rgba(34,197,94,0.25)' }}>
                  <CheckCircle2 className="w-7 h-7 text-matrix-green" />
                </div>
                <p
                  className="text-matrix-subtle text-sm leading-relaxed"
                  style={{ fontFamily: 'Rajdhani, sans-serif' }}
                >
                  إذا كان البريد <span dir="ltr" className="text-matrix-cyan font-mono">{email}</span> مسجَّلاً لدينا،
                  فستصلك رسالة تحتوي رابط إعادة تعيين كلمة المرور خلال لحظات.
                </p>
                <p className="text-xs text-matrix-subtle">
                  الرابط صالح لمدة ساعة واحدة فقط من وقت الإرسال.
                </p>
                <Link
                  href="/auth/login"
                  className="inline-flex items-center gap-2 text-sm text-matrix-cyan hover:text-neon-cyan transition-colors mt-2"
                  style={{ fontFamily: 'JetBrains Mono, monospace' }}
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                  العودة لتسجيل الدخول
                </Link>
              </motion.div>
            ) : (
              // ── Form state ──────────────────────────────────────
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p
                  className="text-matrix-subtle text-sm text-center mb-6 leading-relaxed"
                  style={{ fontFamily: 'Rajdhani, sans-serif' }}
                >
                  أدخل البريد الإلكتروني المسجَّل بحسابك، وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.
                </p>

                {/* ── Error card ── */}
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
                      البريد الإلكتروني
                    </label>
                    <div className="relative">
                      <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="matrix-input pr-10"
                        placeholder="admin@ys-matrix.com"
                        required
                        dir="ltr"
                        autoComplete="email"
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
                          <span className="text-xs tracking-widest">جاري الإرسال...</span>
                        </motion.span>
                      ) : (
                        <motion.span
                          key="default" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="flex items-center gap-2"
                        >
                          <KeyRound className="w-4 h-4" />
                          <span>إرسال رابط الاسترجاع</span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </form>

                <div className="mt-6 text-center">
                  <Link
                    href="/auth/login"
                    className="inline-flex items-center gap-2 text-sm text-matrix-subtle hover:text-matrix-cyan transition-colors"
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    <ArrowRight className="w-4 h-4 rotate-180" />
                    العودة لتسجيل الدخول
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Footer ── */}
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
