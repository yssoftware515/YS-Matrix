'use client';

// ============================================================
// YS-MATRIX ERP — Onboarding Wizard (Phase 3 Stage 1)
// Route: /dashboard/onboarding
// Shown to new owners before accessing the main dashboard
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Upload, Phone, Mail, MapPin,
  CheckCircle2, ArrowLeft, ArrowRight,
  Loader2, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { onboardingApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────
interface OnboardForm {
  name:     string;
  logo_url: string;
  phone:    string;
  email:    string;
  address:  string;
}

// ─── Steps ───────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'معلومات المعرض', icon: Building2 },
  { id: 2, label: 'بيانات التواصل', icon: Phone     },
  { id: 3, label: 'مراجعة وتأكيد',  icon: CheckCircle2 },
];

// ─── Step Indicator ──────────────────────────────────────────
function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {STEPS.map((step, idx) => {
        const done   = current > step.id;
        const active = current === step.id;
        const Icon   = step.icon;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={cn(
                'w-9 h-9 rounded-xl flex items-center justify-center border-2 transition-all duration-300',
                done   ? 'border-matrix-green bg-matrix-green/20 text-matrix-green'  :
                active ? 'border-matrix-cyan  bg-matrix-cyan/10  text-matrix-cyan'   :
                         'border-matrix-border bg-transparent text-matrix-subtle',
              )}>
                {done
                  ? <CheckCircle2 className="w-4 h-4" />
                  : <Icon className="w-4 h-4" />}
              </div>
              <span className={cn(
                'text-[9px] font-mono whitespace-nowrap',
                active ? 'text-matrix-cyan' : done ? 'text-matrix-green' : 'text-matrix-subtle/50',
              )}>
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={cn(
                'w-16 h-px mx-1 mb-5 transition-all duration-300',
                done ? 'bg-matrix-green' : 'bg-matrix-border/60',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1 — Showroom Info ───────────────────────────────────
function Step1({ form, setForm }: { form: OnboardForm; setForm: (f: OnboardForm) => void }) {
  return (
    <motion.div
      key="step1"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{   opacity: 0, x: -30 }}
      className="space-y-5"
    >
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-matrix-cyan/10 border border-matrix-cyan/30 mb-3">
          <Building2 className="w-7 h-7 text-matrix-cyan" />
        </div>
        <h2 className="text-base font-mono font-bold text-matrix-text tracking-wide">اسم المعرض</h2>
        <p className="text-xs text-matrix-subtle mt-1">هذا الاسم سيظهر في كل فواتيرك وتقاريرك</p>
      </div>

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
          اسم المعرض *
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="مثال: معرض النجمة للسيارات"
          className="matrix-input text-sm w-full"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
          رابط الشعار (اختياري)
        </label>
        <div className="relative">
          <Upload className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
          <input
            type="url"
            value={form.logo_url}
            onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
            placeholder="https://example.com/logo.png"
            className="matrix-input text-sm w-full pr-10"
            dir="ltr"
          />
        </div>
        {form.logo_url && (
          <div className="mt-3 flex items-center gap-3 p-3 rounded-lg bg-matrix-dark border border-matrix-border/50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={form.logo_url} alt="logo preview" loading="lazy" className="w-10 h-10 object-contain rounded" />
            <span className="text-xs text-matrix-subtle font-mono truncate">{form.logo_url}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Step 2 — Contact ────────────────────────────────────────
function Step2({ form, setForm }: { form: OnboardForm; setForm: (f: OnboardForm) => void }) {
  return (
    <motion.div
      key="step2"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{   opacity: 0, x: -30 }}
      className="space-y-5"
    >
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-matrix-green/10 border border-matrix-green/30 mb-3">
          <Phone className="w-7 h-7 text-matrix-green" />
        </div>
        <h2 className="text-base font-mono font-bold text-matrix-text tracking-wide">بيانات التواصل</h2>
        <p className="text-xs text-matrix-subtle mt-1">ستظهر هذه البيانات في الفواتير والتقارير</p>
      </div>

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
          رقم الهاتف
        </label>
        <div className="relative">
          <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="966xxxxxxxxx+"
            className="matrix-input text-sm w-full pr-10"
            dir="ltr"
          />
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
          البريد الإلكتروني
        </label>
        <div className="relative">
          <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="showroom@example.com"
            className="matrix-input text-sm w-full pr-10"
            dir="ltr"
          />
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
          العنوان
        </label>
        <div className="relative">
          <MapPin className="absolute right-3 top-3 w-4 h-4 text-matrix-subtle" />
          <textarea
            rows={2}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="الرياض، حي النزهة، شارع الأمير محمد"
            className="matrix-input text-sm w-full pr-10 resize-none"
          />
        </div>
      </div>
    </motion.div>
  );
}

// ─── Step 3 — Review ────────────────────────────────────────
function Step3({ form }: { form: OnboardForm }) {
  const rows = [
    { icon: Building2, label: 'اسم المعرض',          value: form.name     || '—' },
    { icon: Phone,     label: 'الهاتف',               value: form.phone    || '—' },
    { icon: Mail,      label: 'البريد الإلكتروني',    value: form.email    || '—' },
    { icon: MapPin,    label: 'العنوان',               value: form.address  || '—' },
  ];

  return (
    <motion.div
      key="step3"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{   opacity: 0, x: -30 }}
      className="space-y-4"
    >
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-matrix-purple/10 border border-matrix-purple/30 mb-3">
          <CheckCircle2 className="w-7 h-7 text-matrix-purple" />
        </div>
        <h2 className="text-base font-mono font-bold text-matrix-text tracking-wide">مراجعة البيانات</h2>
        <p className="text-xs text-matrix-subtle mt-1">تأكد من صحة البيانات قبل الحفظ</p>
      </div>

      <div className="space-y-2">
        {rows.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-matrix-dark border border-matrix-border/50"
          >
            <Icon className="w-4 h-4 text-matrix-subtle shrink-0" />
            <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
              <span className="text-[10px] font-mono text-matrix-subtle whitespace-nowrap">{label}</span>
              <span className="text-xs text-matrix-text font-medium truncate text-left" dir="auto">
                {value}
              </span>
            </div>
          </div>
        ))}
      </div>

      {form.logo_url && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-matrix-dark border border-matrix-border/50">
          <Upload className="w-4 h-4 text-matrix-subtle shrink-0" />
          <span className="text-[10px] font-mono text-matrix-subtle">الشعار</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={form.logo_url} alt="logo" loading="lazy" className="w-8 h-8 object-contain rounded mr-auto" />
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function OnboardingPage() {
  const router  = useRouter();
  const { user, updateUser } = useAuthStore();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardForm>({
    name:     user?.showroom?.name ?? '',
    logo_url: user?.showroom?.logo_url ?? '',
    phone:    '',
    email:    '',
    address:  '',
  });

  const onboardMut = useMutation({
    mutationFn: (data: Partial<OnboardForm>) => onboardingApi.complete(data),
    // FIX: onboardingApi.complete() already returns the unwrapped
    // updated showroom object directly (request<T> in api.ts unwraps
    // the envelope internally) — there is no `.data` property on it at
    // all. `res.data?.data` was always undefined, so the local auth
    // store's `is_onboarded` flag never got optimistically updated
    // here (it would still self-correct on next login, since the
    // backend itself is correct — but until then, anything reading
    // the cached store value would see it as stale).
    onSuccess: (updated) => {
      if (updated) {
        updateUser({
          showroom: {
            ...user!.showroom,
            name:         updated.name,
            logo_url:     updated.logo_url ?? undefined,
            is_onboarded: true,
          },
        });
      }
      toast.success('أهلاً بك في YS-Matrix! 🦅');
      router.replace('/dashboard');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'فشل حفظ البيانات');
    },
  });

  const canNext = step === 1 ? form.name.trim().length >= 2 : true;

  const handleNext = () => {
    if (step < 3) setStep((s) => s + 1);
    else onboardMut.mutate(form);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 bg-matrix-black relative overflow-hidden"
    >
      {/* Background grid */}
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />

      {/* Glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)' }}
      />

      <div className="relative w-full max-w-lg z-10">

        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-12 h-12 rounded-xl border border-matrix-cyan/40 bg-matrix-cyan/10 mb-3"
            style={{ boxShadow: '0 0 20px rgba(0,212,255,0.15)' }}
          >
            <Zap className="w-6 h-6 text-matrix-cyan" />
          </div>
          <p className="text-xs font-mono text-matrix-subtle tracking-[0.3em] uppercase">
            إعداد المعرض — YS-Matrix
          </p>
        </div>

        {/* Card */}
        <div className="matrix-panel p-8 border border-matrix-border">

          {/* Step indicator */}
          <StepIndicator current={step} />

          {/* Step content */}
          <div className="min-h-[280px]">
            <AnimatePresence mode="wait">
              {step === 1 && <Step1 form={form} setForm={setForm} />}
              {step === 2 && <Step2 form={form} setForm={setForm} />}
              {step === 3 && <Step3 form={form} />}
            </AnimatePresence>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-matrix-border">
            {step > 1 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                disabled={onboardMut.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-matrix-border text-xs font-mono text-matrix-subtle hover:text-matrix-text hover:border-matrix-border/80 transition-all"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                السابق
              </button>
            ) : (
              <div />
            )}

            <button
              onClick={handleNext}
              disabled={!canNext || onboardMut.isPending}
              className={cn(
                'flex items-center gap-2 px-6 py-2 rounded-lg border text-xs font-mono transition-all',
                canNext && !onboardMut.isPending
                  ? 'border-matrix-cyan bg-matrix-cyan/10 text-matrix-cyan hover:bg-matrix-cyan/20'
                  : 'border-matrix-border text-matrix-subtle opacity-40 cursor-not-allowed',
              )}
            >
              {onboardMut.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري الحفظ...</>
              ) : step === 3 ? (
                <><CheckCircle2 className="w-3.5 h-3.5" /> ابدأ الآن</>
              ) : (
                <>التالي <ArrowLeft className="w-3.5 h-3.5" /></>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[9px] font-mono text-matrix-subtle/30 mt-6 tracking-widest">
          POWERED BY YAHYA.DEV 🦅
        </p>
      </div>
    </div>
  );
}
