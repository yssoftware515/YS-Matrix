'use client';
// ============================================================
// YS-MATRIX — Customer Self-Registration (Phase 4/5)
// POST /auth/register-account → showroom + OWNER + TRIAL.
// No tokens are returned by design: the account is PENDING until a
// plan is purchased and approved by the platform. The success state
// explains the flow so the customer always knows what happens next.
// Trial length is NOT hard-coded here: it comes from the register
// response (backend config/commercial.js TRIAL_DAYS — 5 days).
// ============================================================
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Lock, Mail, User, Store, Phone, AlertCircle, CheckCircle2, Zap, ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { authApi, subscriptionApi, type RegisterAccountResult } from '@/lib/api';
import { useAuthStore } from '@/lib/auth';

const extractErrorMessage = (err: unknown): string => {
  if (!err) return 'فشل إنشاء الحساب';
  const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (axiosMsg) return axiosMsg;
  const errMsg = (err as { message?: string })?.message;
  if (errMsg) return errMsg;
  return 'فشل إنشاء الحساب';
};

export default function RegisterPage() {
  const router  = useRouter();
  const isAuth  = useAuthStore((s) => s.isAuth);

  const [name,         setName]         = useState('');
  const [showroomName, setShowroomName] = useState('');
  const [email,        setEmail]        = useState('');
  const [phone,        setPhone]        = useState('');
  const [password,     setPassword]     = useState('');
  const [confirm,      setConfirm]      = useState('');
  const [showPass,     setShowPass]     = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);
  const [error,        setError]        = useState('');
  const [result,       setResult]       = useState<RegisterAccountResult | null>(null);
  const [mounted,      setMounted]      = useState(false);
  // Phase C.7: trial length is displayed from the PUBLIC pricing
  // endpoint (backend authority) — never hard-coded in the frontend.
  const [trialDays,    setTrialDays]    = useState<number | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    subscriptionApi
      .getPricing()
      .then((c) => setTrialDays(c.trial_days))
      .catch(() => { /* display-only: keep the generic label on failure */ });
  }, []);

  useEffect(() => {
    if (mounted && isAuth) router.replace('/dashboard');
  }, [mounted, isAuth, router]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError('');

    if (password.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
      return;
    }
    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authApi.registerAccount({
        name:         name.trim(),
        email:        email.trim(),
        password,
        showroom_name: showroomName.trim() || undefined,
        phone:        phone.trim() || undefined,
      });
      setResult(res);
      toast.success('تم إنشاء حسابك بنجاح 🎉');
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  if (!mounted) return null;

  // ── Success state: the customer always knows what happens next ──
  if (result) {
    return (
      <div
        style={{ minHeight: '100vh', backgroundColor: '#020408', position: 'relative', overflow: 'hidden' }}
        className="flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div
          style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)' }}
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse-slow"
        />
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-lg mx-4 z-10"
        >
          <div className="matrix-panel p-8">
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, duration: 0.5, type: 'spring' }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-full border border-matrix-green/40 bg-matrix-green/10 mx-auto mb-4"
              >
                <CheckCircle2 className="w-8 h-8 text-matrix-green" />
              </motion.div>
              <h1 className="text-xl font-bold text-matrix-text mb-1">تم إنشاء حسابك بنجاح</h1>
              <p className="text-sm text-matrix-subtle">
                مرحباً {result.owner.name} — تم إنشاء معرض <span className="text-matrix-cyan">{result.showroom.name}</span>
              </p>
            </div>

            {/* What happens next — step list */}
            <div className="space-y-2.5 mb-6">
              {[
                { icon: Store, text: `حسابك أنشئ مع فترة تجريبية ${result.trial.days} أيام — لكن الوصول الكامل يتطلب اختيار باقة.` },
                { icon: Zap, text: 'سجّل الدخول واختر الباقة المناسبة من صفحة الاشتراك والفوترة.' },
                { icon: Lock, text: 'حوّل قيمة الباقة وارفع إثبات الدفع (صورة التحويل).' },
                { icon: ShieldCheck, text: 'تراجع الإدارة الدفع وتفعّل اشتراكك — تصلك إشعارات بكل خطوة.' },
              ].map((s, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-matrix-border bg-matrix-dark/50">
                  <s.icon className="w-4 h-4 text-matrix-cyan shrink-0 mt-0.5" />
                  <p className="text-sm text-matrix-text leading-relaxed">{s.text}</p>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-lg border border-matrix-cyan/20 bg-matrix-cyan/5 mb-6">
              <p className="text-xs text-matrix-subtle">
                <span className="text-matrix-cyan font-bold">بريدك: </span>
                <span dir="ltr">{result.owner.email}</span>
              </p>
              <p className="text-xs text-matrix-subtle mt-1">
                <span className="text-matrix-cyan font-bold">التجربة تنتهي: </span>
                {new Date(result.trial.expires_at).toLocaleDateString('ar-EG')}
              </p>
            </div>

            <Link
              href="/auth/login"
              className="w-full btn-primary corner-cut flex items-center justify-center gap-2 h-12"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>تسجيل الدخول واختيار الباقة</span>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Registration form (matches the login page design system) ──
  return (
    <div
      style={{ minHeight: '100vh', backgroundColor: '#020408', position: 'relative', overflow: 'hidden' }}
      className="flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-grid opacity-30" />
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
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md mx-4 z-10"
      >
        <div className="matrix-panel p-8">
          <div className="text-center mb-6">
            <div className="relative inline-flex items-center justify-center mb-3">
              <div
                className="absolute w-24 h-24 rounded-full blur-3xl animate-pulse-slow pointer-events-none"
                style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.30) 0%, transparent 70%)' }}
              />
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, duration: 0.6, type: 'spring' }}
                className="relative w-16 h-16"
              >
                <Image src="/logo-login.webp" alt="YS-MATRIX" fill priority sizes="64px" className="object-contain"
                  style={{ filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.85)) drop-shadow(0 0 18px rgba(0,212,255,0.5))' }} />
              </motion.div>
            </div>
            <h1 className="text-xl font-bold tracking-widest text-neon-cyan mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              إنشاء حساب جديد
            </h1>
            <p className="text-xs text-matrix-subtle tracking-widest" style={{ fontFamily: 'var(--font-mono)' }}>
              معرض + حساب مالك + تجربة {trialDays != null ? `${trialDays} أيام` : 'مجانية'}
            </p>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="p-3 rounded-lg border border-matrix-red/30 bg-matrix-red/10 flex items-start gap-2 mb-4">
                  <AlertCircle className="w-4 h-4 text-matrix-red shrink-0 mt-0.5" />
                  <p className="text-matrix-red text-sm leading-relaxed">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleRegister} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                اسمك الكامل
              </label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  className="matrix-input corner-cut pr-10" placeholder="أحمد محمد" required disabled={isLoading} />
              </div>
            </div>

            {/* Showroom name */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                اسم المعرض <span className="text-matrix-cyan">(اختياري)</span>
              </label>
              <div className="relative">
                <Store className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                <input type="text" value={showroomName} onChange={(e) => setShowroomName(e.target.value)}
                  className="matrix-input corner-cut pr-10" placeholder="معرض النور للسيارات" disabled={isLoading} />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="matrix-input corner-cut pr-10" placeholder="you@example.com" required dir="ltr"
                  autoComplete="email" disabled={isLoading} />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                رقم الهاتف <span className="text-matrix-cyan">(اختياري)</span>
              </label>
              <div className="relative">
                <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="matrix-input corner-cut pr-10" placeholder="+20 1XX XXXXXXX" dir="ltr" disabled={isLoading} />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="matrix-input corner-cut pr-10 pl-10" placeholder="••••••••" required dir="ltr"
                  autoComplete="new-password" disabled={isLoading} />
                <button type="button" onClick={() => setShowPass(!showPass)} disabled={isLoading}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-matrix-subtle hover:text-matrix-cyan transition-colors disabled:opacity-40" tabIndex={-1}>
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-matrix-subtle/70 mt-1">8 أحرف على الأقل</p>
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-matrix-subtle mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                تأكيد كلمة المرور
              </label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
                <input type={showPass ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="matrix-input corner-cut pr-10" placeholder="••••••••" required dir="ltr"
                  autoComplete="new-password" disabled={isLoading} />
              </div>
            </div>

            <motion.button
              type="submit"
              disabled={isLoading}
              whileTap={isLoading ? {} : { scale: 0.97 }}
              className="w-full btn-primary corner-cut flex items-center justify-center gap-2 h-12 mt-2"
              style={{ cursor: isLoading ? 'not-allowed' : 'pointer' }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isLoading ? (
                  <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-2">
                    <span className="relative flex items-center justify-center w-6 h-6 shrink-0">
                      <Image src="/loading.webp" alt="loading" width={24} height={24} className="object-contain" priority
                        style={{ filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.8))' }} />
                    </span>
                    <span className="text-xs tracking-widest" style={{ fontFamily: 'var(--font-mono)' }}>جاري إنشاء الحساب...</span>
                  </motion.span>
                ) : (
                  <motion.span key="default" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    <span>إنشاء الحساب</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </form>

          <div className="mt-6 pt-5 border-t border-matrix-border text-center">
            <p className="text-xs text-matrix-subtle">
              لديك حساب بالفعل؟{' '}
              <Link href="/auth/login" className="text-matrix-cyan hover:underline">تسجيل الدخول</Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}