'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Lock, Mail, AlertCircle, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi, setTokens } from '@/lib/api';
import { useAuthStore } from '@/lib/auth';

// ── Safe error message extractor ─────────────────────────────
// Reads from any error shape without crashing the page
const extractErrorMessage = (err: unknown): string => {
  if (!err) return 'فشل تسجيل الدخول';

  // Axios error with response body
  const axiosMsg =
    (err as { response?: { data?: { message?: string } } })
      ?.response?.data?.message;
  if (axiosMsg) return axiosMsg;

  // Network / generic Error object
  const errMsg = (err as { message?: string })?.message;
  if (errMsg) return errMsg;

  return 'فشل تسجيل الدخول';
};

// ── License / expiry error detector ──────────────────────────
const isLicenseError = (msg: string): boolean =>
  msg.includes('expired')   ||
  msg.includes('انتهت')     ||
  msg.includes('LICENSE')   ||
  msg.includes('اشتراك');

export default function LoginPage() {
  const router  = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const isAuth  = useAuthStore((s) => s.isAuth);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error,    setError]    = useState('');
  const [mounted,  setMounted]  = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && isAuth) router.replace('/dashboard');
  }, [mounted, isAuth, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return; // guard against double-click
    setError('');
    setIsLoading(true);

    try {
      // FIX: authApi.login() already returns the unwrapped LoginResponse
      // directly (request<T> in api.ts unwraps envelope.data internally).
      // The old code (`const { data } = await authApi.login(...); const
      // {...} = data.data;`) assumed an AxiosResponse-shaped return — a
      // leftover from before the V2 api.ts rewrite. LoginResponse has no
      // `.data` property at all, so `data` was always undefined and
      // `data.data` threw a TypeError on every single login attempt.
      const { user, accessToken, refreshToken } = await authApi.login(email, password);
      setTokens(accessToken, refreshToken);
      setAuth(user, accessToken, refreshToken);
      toast.success('مرحباً ' + user.name + ' 🦅');
      router.push('/dashboard');
    } catch (err: unknown) {
      const raw = extractErrorMessage(err);
      setError(
        isLicenseError(raw)
          ? 'انتهت صلاحية اشتراكك. سجّل الدخول لتجديده من صفحة الاشتراك.'
          : raw
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#020408',
        position: 'relative',
        overflow: 'hidden',
      }}
      className="flex items-center justify-center"
    >
      {/* ── Grid background — reduced opacity for subtlety per brief
          ("very subtle, low-opacity technical grid") ── */}
      <div className="absolute inset-0 bg-grid opacity-30" />

      {/* ── Glow orbs ── */}
      <div
        style={{
          background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)',
        }}
        className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse-slow"
      />
      <div
        style={{
          background: 'radial-gradient(circle, rgba(0,102,255,0.06) 0%, transparent 70%)',
          animationDelay: '2s',
        }}
        className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse-slow"
      />

      {/* Center vignette — draws focus toward the card, subtle depth cue */}
      <div
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0,212,255,0.05) 0%, transparent 55%)',
        }}
        className="absolute inset-0 pointer-events-none"
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
          <div className="relative inline-flex items-center justify-center mb-2">
            {/* Soft ambient glow behind the mark — kept (not a hard-edged
                "ring", just diffuse light) since it reinforces the
                "engraved into the dark UI" effect the mark alone would
                lack against a flat background. Scaled with the mark. */}
            <div
              className="absolute w-36 h-36 sm:w-48 sm:h-48 rounded-full blur-3xl animate-pulse-slow pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.30) 0%, transparent 70%)' }}
            />

            {/* Logo mark — bare, no frame/border/background box, no ring.
                Glow color locked to #00D4FF, the exact value text-neon-cyan
                uses below (verified in globals.css), so the mark and the
                "YS-MATRIX" wordmark read as one unified light source.
                Size: +30% over the previous 128px baseline (128*1.3≈166px),
                scaled down on narrow viewports so it doesn't dominate a
                small screen — gap below scales with it via mb-2 sm:mb-3. */}
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, duration: 0.6, type: 'spring' }}
              className="relative w-28 h-28 sm:w-36 sm:h-36 md:w-[166px] md:h-[166px]"
            >
              <Image
                src="/logo-login.webp"
                alt="YS-MATRIX"
                fill
                priority
                sizes="(min-width: 768px) 166px, (min-width: 640px) 144px, 112px"
                className="object-contain"
                style={{
                  filter:
                    'drop-shadow(0 0 6px rgba(0,212,255,0.85)) ' +
                    'drop-shadow(0 0 18px rgba(0,212,255,0.5)) ' +
                    'drop-shadow(0 0 36px rgba(0,212,255,0.3))',
                }}
              />
            </motion.div>
          </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              <h1
                className="text-2xl font-bold tracking-widest text-neon-cyan mb-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                YS-MATRIX
              </h1>
              <p
                className="text-xs text-matrix-subtle tracking-[0.3em] uppercase"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                ERP SYSTEM v2.0
              </p>
            </motion.div>
          </div>

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
                  <p
                    className="text-matrix-red text-sm leading-relaxed"
                    style={{ fontFamily: 'var(--font-body)' }}
                  >
                    {error}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Form ── */}
          <form onSubmit={handleLogin} className="space-y-5">

            {/* Email */}
            <div>
              <label
                className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="matrix-input corner-cut pr-10 focus:shadow-[0_0_20px_rgba(0,212,255,0.45)]"
                  placeholder="admin@ys-matrix.com"
                  required
                  dir="ltr"
                  autoComplete="email"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="matrix-input corner-cut pr-10 pl-10 focus:shadow-[0_0_20px_rgba(0,212,255,0.45)]"
                  placeholder="••••••••"
                  required
                  dir="ltr"
                  autoComplete="current-password"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  disabled={isLoading}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-matrix-subtle hover:text-matrix-cyan transition-colors disabled:opacity-40"
                  tabIndex={-1}
                >
                  {showPass
                    ? <EyeOff className="w-4 h-4" />
                    : <Eye    className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* ── Submit button ── */}
            <motion.button
              type="submit"
              disabled={isLoading}
              whileTap={isLoading ? {} : { scale: 0.97 }}
              className="w-full btn-primary corner-cut flex items-center justify-center gap-2 h-12 mt-6"
              style={{ cursor: isLoading ? 'not-allowed' : 'pointer' }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isLoading ? (
                  /* ── Loading state: cinematic loading.webp ── */
                  <motion.span
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{   opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-2"
                  >
                    <span className="relative flex items-center justify-center w-6 h-6 shrink-0">
                      <Image
                        src="/loading.webp"
                        alt="loading"
                        width={24}
                        height={24}
                        className="object-contain"
                        priority
                        style={{ filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.8))' }}
                      />
                    </span>
                    <span
                      style={{ fontFamily: 'var(--font-mono)' }}
                      className="text-xs tracking-widest"
                    >
                      جاري التحقق من الهوية...
                    </span>
                  </motion.span>
                ) : (
                  /* ── Default state ── */
                  <motion.span
                    key="default"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{   opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-2"
                  >
                    <Zap className="w-4 h-4" />
                    <span>دخول النظام</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>

          </form>

          {/* ── Footer ── */}
          <div className="mt-8 pt-6 border-t border-matrix-border text-center space-y-3">
            {/* Phase 4/5 — self-registration entry point */}
            <p
              className="text-xs text-matrix-subtle"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              ليس لديك حساب؟{' '}
              <Link
                href="/auth/register"
                className="text-matrix-cyan hover:underline"
              >
                أنشئ معرضك الآن
              </Link>
            </p>
            <p
              className="text-xs text-matrix-subtle"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              Powered by{' '}
              <span className="text-matrix-cyan">YS Systems &amp; Software</span>
            </p>
          </div>

        </div>
      </motion.div>

      {/* ── Global keyframes ── */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
