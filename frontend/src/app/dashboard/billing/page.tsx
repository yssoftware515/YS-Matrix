'use client';

// ============================================================
// YS-MATRIX ERP — Customer Billing & Subscription Page (Phase 4/5)
// Route: /dashboard/billing (OWNER/STAFF — self-service)
//
// Mirrors the backend-authoritative lifecycle:
//   PENDING         → pick a plan & pay        (plan cards + instructions)
//   PENDING_PAYMENT → awaiting admin review    (attach/replace proof)
//   ACTIVE          → live plan + usage        (days left, users limit)
//   EXPIRED         → pick a plan again
// Payment amounts always come from the server via listPlans();
// GET /subscriptions/status is the single source of truth here.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Shield, ShieldCheck, Clock, CreditCard, Upload, FileText,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Image as ImageIcon,
  Users, Calendar, BadgeCheck, Receipt, Landmark, RefreshCw, Sparkles,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Modal } from '@/components/ui/Modal';
import {
  subscriptionApi,
  isApiRequestError,
  type Plan,
  type AccountStatusResponse,
  type PaymentRecord,
  type PricingPeriod,
  type SubscriptionStatus,
} from '@/lib/api';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import { cn, formatCurrency, formatDate, formatNumber, daysUntil } from '@/lib/utils';

// Phase C.7: currency labels come from the backend catalog — the
// generic formatCurrency helper renders the pre-existing riyal
// suffix, so the commercial surfaces use the catalog currency
// explicitly (EGP → ج.م).
const currencyLabel = (currency: string) => (currency === 'EGP' ? 'ج.م' : currency);

// ─── proof upload guardrails (mirror backend validatePaymentProof) ──
const ALLOWED_PROOF = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_PROOF_BYTES = 2 * 1024 * 1024; // 2MB

const ACCOUNT_STATUS_CFG: Record<
  string,
  { label: string; badge: string; icon: typeof Shield }
> = {
  PENDING:          { label: 'بانتظار اختيار الباقة', badge: 'badge-cyan',  icon: Clock },
  PENDING_PAYMENT:  { label: 'قيد مراجعة الدفع',      badge: 'badge-amber', icon: FileText },
  ACTIVE:           { label: 'اشتراك نشط',            badge: 'badge-green', icon: ShieldCheck },
  EXPIRED:          { label: 'اشتراك منتهي',          badge: 'badge-red',   icon: AlertTriangle },
  // Phase A (P2-6): SUSPENDED (showroom deactivated) must never look
  // like a solvable billing state — no plan cards, no proof upload.
  // The dashboard gate routes the owner to /dashboard/suspended
  // before this page's actions are reachable anyway; this entry
  // guarantees the badge renders correctly if anyone lands here
  // directly.
  SUSPENDED:        { label: 'حساب معلّق',            badge: 'badge-red',   icon: Shield },
};

const ERROR_MAP: Record<string, string> = {
  ACCOUNT_STATE_CONFLICT: 'لا يمكن تقديم طلب جديد الآن (طلب سابق قيد المراجعة أو اشتراك نشط).',
  PLAN_LIMIT_REACHED:     'تم استلام إثبات دفع لهذا الطلب بالفعل.',
};

const getReqError = (err: unknown): string => {
  if (isApiRequestError(err)) return ERROR_MAP[err.code ?? ''] ?? err.message;
  return 'حدث خطأ غير متوقع';
};

// ─── file → raw base64 (without the data: prefix) ──────────────
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const url = String(reader.result ?? '');
      resolve(url.includes(',') ? url.split(',')[1] : url.replace(/^data:.*?;base64,?/, ''));
    };
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

// ─── ProofUpload — reusable (request + attach) ──────────────────
function ProofUpload({
  value,
  onChange,
}: {
  value: { file: File | null; mime: string; b64: string };
  onChange: (v: { file: File | null; mime: string; b64: string }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!ALLOWED_PROOF.includes(f.type)) {
      toast.error('صيغة غير مدعومة — يُسمح فقط بـ PNG / JPG / WEBP');
      return;
    }
    if (f.size > MAX_PROOF_BYTES) {
      toast.error('حجم الصورة أكبر من 2 ميجابايت');
      return;
    }
    const b64 = await fileToBase64(f);
    onChange({ file: f, mime: f.type, b64 });
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {value.file ? (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-matrix-green/30 bg-matrix-green/5">
          <div className="flex items-center gap-2 min-w-0">
            <ImageIcon className="w-4 h-4 text-matrix-green shrink-0" />
            <span className="text-xs text-matrix-text truncate">{value.file.name}</span>
            <span className="text-[10px] font-mono text-matrix-subtle shrink-0">
              ({(value.file.size / 1024).toFixed(0)} KB)
            </span>
          </div>
          <button
            type="button"
            onClick={() => { onChange({ file: null, mime: '', b64: '' }); if (inputRef.current) inputRef.current.value = ''; }}
            className="text-matrix-red hover:underline text-[10px] font-mono shrink-0"
          >
            إزالة
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-matrix-border text-matrix-subtle hover:text-matrix-cyan hover:border-matrix-cyan/50 transition-all text-xs"
        >
          <Upload className="w-4 h-4" />
          ارفع صورة إثبات الدفع (PNG / JPG / WEBP — حتى 2MB)
        </button>
      )}
    </div>
  );
}

// ─── Plan card ───────────────────────────────────────────────────
function PlanCard({
  plan,
  onChoose,
  disabled,
  isPending,
}: {
  plan: Plan;
  onChoose: () => void;
  disabled?: boolean;
  isPending?: boolean;
}) {
  const b64Features = useMemo(() => {
    if (typeof plan.features !== 'object' || plan.features === null) return null;
    return plan.features as { title?: string; items?: string[] };
  }, [plan.features]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="matrix-panel p-5 flex flex-col border border-matrix-border/50"
    >
      <p className="section-title mb-1">{plan.name}</p>
      <p className="text-[10px] font-mono text-matrix-subtle mb-4">{plan.code.toUpperCase()}</p>

      <div className="mb-4">
        <span className="font-display text-2xl font-bold text-matrix-cyan">{formatCurrency(plan.price_amount)}</span>
        <span className="text-xs font-mono text-matrix-subtle mr-1">/ شهرياً · {plan.currency}</span>
      </div>

      <ul className="space-y-2 mb-5 flex-1">
        <li className="flex items-center gap-2 text-xs text-matrix-text">
          <Users className="w-3.5 h-3.5 text-matrix-cyan shrink-0" />
          حتى {plan.users_limit} مستخدم
        </li>
        <li className="flex items-center gap-2 text-xs text-matrix-text">
          <Calendar className="w-3.5 h-3.5 text-matrix-cyan shrink-0" />
          مدة {plan.duration_months} أشهر
        </li>
        {b64Features?.items?.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-matrix-text">
            <CheckCircle2 className="w-3.5 h-3.5 text-matrix-green shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>

      <button
        onClick={onChoose}
        disabled={disabled}
        className="w-full btn-primary corner-cut flex items-center justify-center gap-2 h-11 text-sm"
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
        {plan.features ? 'اختيار الباقة' : 'اشترك الآن'}
      </button>
    </motion.div>
  );
}

// ─── Billing period selector (Phase C.7) ─────────────────────────
// Reads the PUBLIC /subscriptions/pricing catalog — backend-derived
// final amounts, discounts, savings and trial days. The selected
// period code is sent with the purchase/renewal request; the amount
// shown is display-only (the server re-resolves the price).
function PeriodSelector({
  periods,
  value,
  onChange,
  currency,
  trialDays,
  disabled,
}: {
  periods: PricingPeriod[];
  value: PricingPeriod | null;
  onChange: (p: PricingPeriod) => void;
  currency: string;
  trialDays?: number;
  disabled?: boolean;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="flex items-center gap-2 text-xs font-mono font-semibold text-matrix-subtle">
          <Calendar className="w-3.5 h-3.5 text-matrix-cyan" />
          مدة الاشتراك
        </p>
        {typeof trialDays === 'number' && (
          <p className="flex items-center gap-1.5 text-[10px] font-mono text-matrix-green">
            <Sparkles className="w-3 h-3" />
            جرّب مجاناً {trialDays} أيام
          </p>
        )}
      </div>

      {periods.length === 0 ? (
        <div className="p-3 rounded-lg border border-matrix-border bg-matrix-dark/60">
          <p className="text-xs text-matrix-subtle font-mono">عرض الأسعار غير متاح حالياً — جرّب تحديث الصفحة.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {periods.map((p) => {
            const selected = value?.code === p.code;
            const isBest = p.code === 'YEARLY';
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => onChange(p)}
                disabled={disabled}
                className={cn(
                  'relative rounded-lg border p-4 text-right transition-all',
                  selected
                    ? 'border-matrix-cyan bg-matrix-cyan/[0.06] shadow-[0_0_20px_rgba(0,229,255,0.15)]'
                    : 'border-matrix-border/60 bg-matrix-dark/50 hover:border-matrix-cyan/40'
                )}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
              >
                {isBest && (
                  <span className="absolute -top-2 left-3 px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-matrix-cyan text-matrix-black">
                    الأفضل
                  </span>
                )}
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-mono font-semibold text-matrix-text">{p.label_ar}</p>
                  {p.discount_percent > 0 && (
                    <span className="badge-green text-[9px] px-1.5">خصم {p.discount_percent}%</span>
                  )}
                </div>
                <p className="font-display text-xl font-bold text-matrix-cyan">
                  {formatNumber(p.final_amount)}
                  <span className="text-xs font-mono text-matrix-subtle mr-1">{currencyLabel(currency)}</span>
                </p>
                <p className="text-[10px] font-mono text-matrix-subtle mt-0.5">
                  {p.duration_months} أشهر · فعلي {formatNumber(p.effective_monthly)} {currencyLabel(currency)}/شهر
                  {p.savings_amount > 0 && (
                    <span className="text-matrix-green"> · وفّر {formatNumber(p.savings_amount)}</span>
                  )}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Request panel — chosen plan + payment details ───────────────
function RequestPanel({
  plan,
  period,
  currency,
  instructions,
  onDone,
  mode = 'purchase',
}: {
  plan: Plan;
  period?: PricingPeriod | null;
  currency?: string;
  instructions?: AccountStatusResponse['payment_instructions'];
  onDone: () => void;
  mode?: 'purchase' | 'renewal';
}) {
  const qc = useQueryClient();
  const [method, setMethod] = useState('تحويل بنكي');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState({ file: null as File | null, mime: '', b64: '' });

  const isRenewal = mode === 'renewal';

  // Phase C.7: the client only sends the billing_period code — the
  // amount is resolved server-side from the MarketPricing catalog.
  const reqMut = useMutation({
    mutationFn: () => {
      const payload = {
        plan_code:      plan.code,
        billing_period: period?.code,
        method:      method || undefined,
        reference:   reference.trim() || undefined,
        proof_mime:  proof.mime || undefined,
        proof_data:  proof.b64  || undefined,
      };
      return isRenewal
        ? subscriptionApi.renewRequest(payload)
        : subscriptionApi.requestPlan(payload);
    },
    onSuccess: () => {
      toast.success(isRenewal ? 'تم إرسال طلب التجديد — قيد مراجعة الإدارة' : 'تم إرسال طلب الاشتراك — قيد مراجعة الإدارة');
      // Phase B.1 (F8): every surface rendering this account state
      // must re-fetch — billing status/history, the dashboard hero,
      // the notification badge (PAYMENT_SUBMITTED is created by the
      // backend on this call).
      qc.invalidateQueries({ queryKey: ['billing-status'] });
      qc.invalidateQueries({ queryKey: ['billing-payments'] });
      qc.invalidateQueries({ queryKey: ['billing-current'] });
      qc.invalidateQueries({ queryKey: ['home-account-status'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      onDone();
    },
    onError: (err: unknown) => toast.error(getReqError(err)),
  });

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="matrix-panel p-5 border border-matrix-cyan/20">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="section-title mb-0">{isRenewal ? `تأكيد تجديد ${plan.name}` : `تأكيد اشتراك ${plan.name}`}</p>
            <p className="text-xs font-mono text-matrix-subtle mt-0.5">
              {period
                ? `${formatNumber(period.final_amount)} ${currencyLabel(currency ?? 'EGP')} / ${period.duration_months} أشهر · فعلي ${formatNumber(period.effective_monthly)} ${currencyLabel(currency ?? 'EGP')}/شهر`
                : `${formatCurrency(plan.price_amount)} ${plan.currency} / ${plan.duration_months} أشهر`}
            </p>
          </div>
          <button onClick={onDone} className="text-matrix-subtle hover:text-matrix-red text-lg leading-none">×</button>
        </div>

        {isRenewal && (
          <div className="p-3 rounded-lg border border-matrix-cyan/20 bg-matrix-cyan/5 mb-4 flex items-start gap-2">
            <RefreshCw className="w-4 h-4 text-matrix-cyan shrink-0 mt-0.5" />
            <p className="text-xs text-matrix-text leading-relaxed">
              عند الموافقة يُمدَّد اشتراكك الحالي تلقائياً من تاريخ انتهائه الحالي (لا تضيع أياماً)،
              ويتم اعتماد الباقة الجديدة فوراً.
            </p>
          </div>
        )}

        {/* Manual transfer instructions — backend-provided copy */}
        {instructions && (
          <div className="p-4 rounded-lg border border-matrix-cyan/20 bg-matrix-cyan/5 mb-4">
            <p className="flex items-center gap-2 text-xs font-mono font-semibold text-matrix-cyan mb-2">
              <Landmark className="w-3.5 h-3.5" /> {instructions.headline}
            </p>
            <ol className="space-y-1.5">
              {instructions.steps?.map((s, i) => (
                <li key={i} className="text-xs text-matrix-text leading-relaxed">{s}</li>
              ))}
            </ol>
            {instructions.bank_account && (
              <p className="text-xs text-matrix-cyan mt-2 font-mono" dir="ltr" style={{ textAlign: 'right' }}>
                <BadgeCheck className="inline w-3.5 h-3.5 ml-1 text-matrix-green" />
                {instructions.bank_account}
              </p>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
              طريقة الدفع
            </label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="matrix-input text-xs w-full">
              <option>تحويل بنكي</option>
              <option>محفظة إلكترونية</option>
              <option>إيداع نقدي</option>
              <option>أخرى</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
              رقم العملية / مرجع التحويل <span className="text-matrix-cyan">(اختياري)</span>
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="matrix-input text-xs w-full"
              placeholder="مثال: 1234567890"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
              إثبات الدفع
            </label>
            <ProofUpload value={proof} onChange={setProof} />
            <p className="text-[10px] text-matrix-subtle/70 mt-1">
              يمكنك إرسال الطلب بدون صورة ثم إرفاقها لاحقاً من صفحة الفوترة.
            </p>
          </div>

          <button
            onClick={() => reqMut.mutate()}
            disabled={reqMut.isPending}
            className="w-full btn-primary corner-cut flex items-center justify-center gap-2 h-12 text-sm"
            style={{ cursor: reqMut.isPending ? 'not-allowed' : 'pointer' }}
          >
            {reqMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {isRenewal ? 'تأكيد وإرسال طلب التجديد' : 'تأكيد وإرسال الطلب'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Payment request timeline (F4) ─────────────────────────────
// Maps EXACTLY to the backend fields the lifecycle API already
// exposes — no invented states:
//   submitted  → payment.created_at
//   proof      → payment.proof_mime (attached or awaiting)
//   review     → payment.status × payment.reviewed_at
// Statuses PAID/REJECTED/EXPIRED each show their review timestamp.
function RequestTimeline({ payment }: { payment: PaymentRecord }) {
  const steps = [
    {
      key: 'submitted',
      done: true,
      label: 'أُرسل الطلب',
      meta: formatDate(payment.created_at),
      tone: 'green' as const,
    },
    {
      key: 'proof',
      done: !!payment.proof_mime,
      label: payment.proof_mime ? 'تم استلام إثبات الدفع' : 'بانتظار إرفاق إثبات الدفع',
      meta: payment.proof_mime ? 'صورة تحويل مصرفي' : 'يمكن الإرفاق الآن أو لاحقاً',
      tone: payment.proof_mime ? ('green' as const) : ('amber' as const),
    },
    {
      key: 'review',
      done: payment.status !== 'PENDING',
      label:
        payment.status === 'PAID'     ? 'تمت الموافقة على الدفع'
        : payment.status === 'REJECTED' ? 'رُفض الطلب'
        : payment.status === 'EXPIRED'  ? 'أُلغي الطلب'
        : 'قيد مراجعة الإدارة',
      meta: payment.reviewed_at ? formatDate(payment.reviewed_at)
        : payment.status === 'PENDING' ? 'عادةً خلال يوم عمل واحد'
        : '—',
      tone:
        payment.status === 'PAID'     ? ('green' as const)
        : payment.status === 'REJECTED' ? ('red' as const)
        : payment.status === 'EXPIRED'  ? ('red' as const)
        : ('amber' as const),
    },
  ];

  const DOT: Record<string, string> = {
    green: 'bg-matrix-green',
    amber: 'bg-matrix-amber',
    red:   'bg-matrix-red',
  };
  const TXT: Record<string, string> = {
    green: 'text-matrix-green',
    amber: 'text-matrix-amber',
    red:   'text-matrix-red',
  };

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center shrink-0">
        {steps.map((s, i) => (
          <div key={s.key} className="flex flex-col items-center">
            <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', DOT[s.tone], !s.done && 'opacity-50')} />
            {i < steps.length - 1 && <span className="w-px h-6 bg-matrix-border" />}
          </div>
        ))}
      </div>
      <div className="space-y-5 flex-1 min-w-0">
        {steps.map((s) => (
          <div key={s.key} className="min-w-0">
            <p className={cn('text-xs font-mono', s.done ? TXT[s.tone] : 'text-matrix-subtle')}>{s.label}</p>
            <p className="text-[10px] font-mono text-matrix-subtle/70 mt-0.5">{s.meta}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Rejected payment card (F2) — recovery without support ─────
// Shown whenever the latest payment was REJECTED: the reviewer's
// reason (customer-facing copy), the timeline, and a fresh-request
// CTA. The account derives back to PENDING/EXPIRED, so the plan
// cards below are already re-enabled by the server.
function RejectedPaymentCard({
  payment,
  canManage,
}: {
  payment: PaymentRecord;
  canManage: boolean;
}) {
  const plansRef = useRef<HTMLDivElement>(null);

  return (
    <div className="matrix-panel p-5 border border-matrix-red/25 bg-matrix-red/[0.03]">
      <div className="flex items-start gap-3 mb-4">
        <XCircle className="w-5 h-5 text-matrix-red shrink-0 mt-0.5" />
        <div>
          <p className="section-title mb-0">رُفض طلب الاشتراك</p>
          <p className="text-xs text-matrix-subtle mt-1">
            {payment.plan_name} — {formatCurrency(payment.amount)} {payment.currency} — أُرسل {formatDate(payment.created_at)}
          </p>
        </div>
      </div>

      {payment.rejection_reason && (
        <div className="p-3 rounded-lg border border-matrix-red/25 bg-matrix-red/5 mb-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-matrix-red mb-1">سبب الرفض</p>
          <p className="text-xs text-matrix-text leading-relaxed">{payment.rejection_reason}</p>
        </div>
      )}

      <div className="p-3 rounded-lg border border-matrix-border bg-matrix-dark/60 mb-4">
        <p className="text-[10px] font-mono font-semibold text-matrix-subtle mb-3">مسار الطلب</p>
        <RequestTimeline payment={payment} />
      </div>

      {canManage ? (
        <button
          onClick={() => plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-matrix-cyan/30 bg-matrix-cyan/5 text-matrix-cyan hover:bg-matrix-cyan/10 hover:border-matrix-cyan/60 transition-all text-xs font-mono"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          إعادة تقديم الطلب — اختر الباقة أدناه
        </button>
      ) : (
        <p className="text-xs text-matrix-subtle leading-relaxed text-center py-2">
          يمكن لصاحب الحساب فقط إعادة تقديم الطلب من الباقات أدناه.
        </p>
      )}
      <div ref={plansRef} className="hidden" aria-hidden="true" />
    </div>
  );
}

// ─── Pending payment card — attach/replace proof ─────────────────
function PendingPaymentCard({
  payment,
  instructions,
  canManage,
}: {
  payment: PaymentRecord;
  instructions?: AccountStatusResponse['payment_instructions'];
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [proof, setProof] = useState({ file: null as File | null, mime: '', b64: '' });
  const [reference, setReference] = useState(payment.reference ?? '');

  const attachMut = useMutation({
    mutationFn: () =>
      subscriptionApi.attachProof(payment.id, {
        proof_mime: proof.mime || undefined,
        proof_data: proof.b64  || undefined,
        reference:  reference.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('تم تحديث إثبات الدفع');
      setProof({ file: null, mime: '', b64: '' });
      // Phase B.1 (F8): keep every surface that renders this account
      // state honest — billing status/history, the dashboard hero,
      // and the notification badge.
      qc.invalidateQueries({ queryKey: ['billing-status'] });
      qc.invalidateQueries({ queryKey: ['billing-payments'] });
      qc.invalidateQueries({ queryKey: ['billing-current'] });
      qc.invalidateQueries({ queryKey: ['home-account-status'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err: unknown) => toast.error(getReqError(err)),
  });

  const hasProof = !!(payment.proof_mime && payment.proof_data);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const cancelMut = useMutation({
    mutationFn: () => subscriptionApi.cancelRequest(),
    onSuccess: () => {
      toast.success('تم إلغاء الطلب المعلق');
      setConfirmCancel(false);
      qc.invalidateQueries({ queryKey: ['billing-status'] });
      qc.invalidateQueries({ queryKey: ['billing-payments'] });
      qc.invalidateQueries({ queryKey: ['billing-current'] });
      qc.invalidateQueries({ queryKey: ['home-account-status'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err: unknown) => toast.error(getReqError(err)),
  });

  return (
    <div className="matrix-panel p-5 border border-matrix-amber/25 bg-matrix-amber/[0.03]">
      <div className="flex items-start gap-3 mb-4">
        <FileText className="w-5 h-5 text-matrix-amber shrink-0 mt-0.5" />
        <div>
          <p className="section-title mb-0">طلبك قيد مراجعة الإدارة</p>
          <p className="text-xs text-matrix-subtle mt-1">
            {payment.plan_name} — {formatCurrency(payment.amount)} {payment.currency} — أُرسل {formatDate(payment.created_at)}
          </p>
        </div>
      </div>

      {instructions && (
        <div className="p-3 rounded-lg border border-matrix-border bg-matrix-dark/60 mb-4">
          <p className="flex items-center gap-2 text-[10px] font-mono font-semibold text-matrix-cyan mb-1.5">
            <Landmark className="w-3 h-3" /> {instructions.headline}
          </p>
          <ol className="space-y-1">
            {instructions.steps?.map((s, i) => (
              <li key={i} className="text-[11px] text-matrix-text leading-relaxed">{s}</li>
            ))}
          </ol>
        </div>
      )}

      {payment.rejection_reason && (
        <div className="p-3 rounded-lg border border-matrix-red/25 bg-matrix-red/5 flex items-start gap-2 mb-4">
          <XCircle className="w-4 h-4 text-matrix-red shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-mono text-matrix-red mb-0.5">رُفض إثبات الدفع — السبب:</p>
            <p className="text-xs text-matrix-text">{payment.rejection_reason}</p>
          </div>
        </div>
      )}

      {/* Phase B.1 (F4): the request path, straight from the payment row */}
      <div className="p-3 rounded-lg border border-matrix-border bg-matrix-dark/60 mb-4">
        <p className="text-[10px] font-mono font-semibold text-matrix-subtle mb-3">مسار الطلب</p>
        <RequestTimeline payment={payment} />
      </div>

      {canManage ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
              رقم العملية / مرجع التحويل
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="matrix-input text-xs w-full"
              dir="ltr"
              placeholder="مثال: 1234567890"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-2">
              {hasProof ? 'استبدال إثبات الدفع' : 'إرفاق إثبات الدفع'}
            </label>
            {hasProof && (
              <p className="flex items-center gap-1.5 text-[10px] font-mono text-matrix-green mb-2">
                <CheckCircle2 className="w-3 h-3" /> تم استلام إثبات سابق — يمكنك استبداله إذا لزم الأمر.
              </p>
            )}
            <ProofUpload value={proof} onChange={setProof} />
          </div>

          <button
            onClick={() => attachMut.mutate()}
            disabled={attachMut.isPending || (!proof.b64 && reference.trim() === payment.reference)}
            className="w-full btn-primary corner-cut flex items-center justify-center gap-2 h-11 text-sm"
            style={{ cursor: attachMut.isPending ? 'not-allowed' : 'pointer' }}
          >
            {attachMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            حفظ التحديث
          </button>

          {/* F3 — cancel the pending request (OWNER). Use the confirm
              Modal — never window.confirm (project convention). */}
          <button
            onClick={() => setConfirmCancel(true)}
            disabled={cancelMut.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-matrix-red/25 bg-matrix-red/5 text-matrix-red hover:bg-matrix-red/10 hover:border-matrix-red/50 transition-all text-xs font-mono"
            style={{ cursor: cancelMut.isPending ? 'not-allowed' : 'pointer' }}
          >
            {cancelMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
            إلغاء الطلب
          </button>
        </div>
      ) : (
        // Phase B.1 (F9): STAFF see the state read-only — the backend
        // ownerOnly gate would 403 every mutation anyway; the UI just
        // stops offering buttons that cannot succeed.
        <p className="text-xs text-matrix-subtle leading-relaxed text-center py-2">
          إرفاق إثبات الدفع وتعديله متاح لصاحب الحساب فقط.
        </p>
      )}

      {/* ── Cancel confirmation modal ── */}
      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="إلغاء طلب الاشتراك"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setConfirmCancel(false)}
              disabled={cancelMut.isPending}
              className="px-4 py-2 rounded-lg border border-matrix-border text-matrix-subtle hover:text-matrix-text transition-all text-xs font-mono"
            >
              تراجع
            </button>
            <button
              onClick={() => cancelMut.mutate()}
              disabled={cancelMut.isPending}
              className="px-4 py-2 rounded-lg bg-matrix-red/80 hover:bg-matrix-red text-matrix-black font-mono text-xs transition-all flex items-center gap-1.5"
            >
              {cancelMut.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              نعم، إلغاء الطلب
            </button>
          </>
        }
      >
        <p className="text-xs text-matrix-text leading-relaxed">
          سيتم إلغاء طلب <span className="font-mono text-matrix-amber">{payment.plan_name}</span> الحالي
          نهائياً ويمكنك تقديم طلب جديد في أي وقت. هل أنت متأكد؟
        </p>
      </Modal>
    </div>
  );
}

// ─── Active plan summary ─────────────────────────────────────────
function ActivePlanCard({ status, onRenew }: { status: AccountStatusResponse; onRenew?: () => void }) {
  const sub = status.subscription!;
  const days = daysUntil(sub.expires_at ?? new Date().toISOString());
  const usage = status.usage?.users;
  // F4 — OWNER-only deep link into staff management (matches backend ownerOnly).
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role);

  return (
    <div className="matrix-panel p-5 border border-matrix-green/20 bg-matrix-green/[0.02]">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <p className="flex items-center gap-2 section-title mb-1">
            <BadgeCheck className="w-4 h-4 text-matrix-green" /> {sub.plan_name}
          </p>
          <p className="text-xs font-mono text-matrix-subtle">
            بدأ {formatDate(sub.started_at ?? '')} · ينتهي {formatDate(sub.expires_at ?? '')}
          </p>
        </div>
        <div className="text-left">
          <p className={cn('font-display text-2xl font-bold', days <= 7 ? 'text-matrix-amber' : 'text-matrix-green')}>
            {days} يوم
          </p>
          <p className="text-[10px] font-mono text-matrix-subtle">متبقي</p>
        </div>
      </div>

      {usage && usage.current !== undefined && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
            <span className="text-matrix-subtle">المستخدمون {usage.current} / {usage.limit ?? '∞'}</span>
            {usage.limit !== null && usage.current >= usage.limit && (
              <span className="text-matrix-amber">تم الوصول للحد الأقصى</span>
            )}
          </div>
          {usage.limit !== null && (
            <div className="h-1.5 rounded-full bg-matrix-dark border border-matrix-border overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (usage.current / Math.max(1, usage.limit)) * 100)}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  'h-full',
                  usage.current >= usage.limit
                    ? 'bg-matrix-amber'
                    : usage.current > Math.floor(usage.limit * 0.8)
                      ? 'bg-matrix-amber'
                      : 'bg-matrix-green'
                )}
                style={{ boxShadow: '0 0 8px rgba(0,255,136,0.4)' }}
              />
            </div>
          )}
        </div>
      )}

      {sub.price_amount && (
        <p className="text-[11px] font-mono text-matrix-subtle">
          {formatCurrency(Number(sub.price_amount))} · {sub.duration_months ?? '—'} أشهر
        </p>
      )}

      {/* F4 — manage staff entry point (OWNER only) */}
      {canManage && (
        <Link
          href="/dashboard/users"
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-matrix-cyan/20 bg-matrix-cyan/5 text-matrix-cyan hover:bg-matrix-cyan/10 hover:border-matrix-cyan/50 transition-all text-[11px] font-mono"
        >
          <Users className="w-3 h-3" />
          إدارة المستخدمين
        </Link>
      )}

      {/* Phase B.1 (F5): a renewal/upgrade claim is under review while
          the current plan keeps working — the account derives to
          PENDING_PAYMENT, so this chip (from latest_payment) is what
          tells the customer their running plan is safe. */}
      {status.latest_payment?.status === 'PENDING' && (
        <div className="mt-4 p-3 rounded-lg border border-matrix-amber/25 bg-matrix-amber/5 flex items-start gap-2">
          <FileText className="w-4 h-4 text-matrix-amber shrink-0 mt-0.5" />
          <p className="text-xs text-matrix-text leading-relaxed">
            لديك طلب تجديد / ترقية قيد مراجعة الإدارة
            ({status.latest_payment.plan_name}). اشتراكك الحالي يستمر بالعمل حتى اعتماد الطلب.
          </p>
        </div>
      )}

      {/* F2 — renew/upgrade entry point (OWNER self-service) */}
      {onRenew && canManage && (
        <button
          onClick={onRenew}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-matrix-cyan/30 bg-matrix-cyan/5 text-matrix-cyan hover:bg-matrix-cyan/10 hover:border-matrix-cyan/60 transition-all text-xs font-mono"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          تجديد / ترقية الاشتراك
        </button>
      )}
    </div>
  );
}

// ─── Payment history row ─────────────────────────────────────────
const PAYMENT_STATUS_CFG: Record<string, { label: string; badge: string }> = {
  PENDING:  { label: 'قيد المراجعة', badge: 'badge-amber' },
  PAID:     { label: 'مقبول',        badge: 'badge-green' },
  REJECTED: { label: 'مرفوض',        badge: 'badge-red'   },
};

// ─── Main page ───────────────────────────────────────────────────
export default function BillingPage() {
  const qc = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  // F2 — renewal/upgrade mode: ACTIVE accounts open the plan picker
  // for a renewal request instead of a first purchase.
  const [renewMode, setRenewMode] = useState(false);

  // Phase C.7 — billing period (approved Egypt model: 1/6/12 months).
  // Catalog comes from the PUBLIC pricing endpoint; MONTHLY is the
  // default selection until the user picks otherwise.
  const [selectedPeriod, setSelectedPeriod] = useState<PricingPeriod | null>(null);
  const { data: pricing } = useQuery({
    queryKey: ['billing-pricing'],
    queryFn:  () => subscriptionApi.getPricing(),
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (!selectedPeriod && pricing?.periods?.length) {
      const monthly = pricing.periods.find((p) => p.code === 'MONTHLY') ?? pricing.periods[0];
      setSelectedPeriod(monthly ?? null);
    }
  }, [pricing, selectedPeriod]);

  // Phase B.1 (F9): OWNER/platform may act; STAFF see the state
  // read-only (the backend ownerOnly gate stays the authority).
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role);

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['billing-status'],
    queryFn:  () => subscriptionApi.getStatus(),
  });

  const { data: plans } = useQuery({
    queryKey: ['billing-plans'],
    queryFn:  () => subscriptionApi.listPlans(),
  });

  const { data: payments } = useQuery({
    queryKey: ['billing-payments'],
    queryFn:  () => subscriptionApi.listPayments({ limit: 50 }),
  });

  const accountStatus = status?.account_status ?? 'PENDING';

  // Phase B.1 (F5): during a renewal/upgrade review the account
  // derives to PENDING_PAYMENT while the OLD plan keeps running —
  // /current (canonical, license-gated) surfaces that plan so the
  // customer never loses sight of it. Only ACTIVE rows render.
  const { data: currentSub } = useQuery({
    queryKey: ['billing-current'],
    queryFn:  () => subscriptionApi.getCurrent(),
    enabled:  accountStatus === 'PENDING_PAYMENT',
    retry:    false,
  });

  const statusCfg = ACCOUNT_STATUS_CFG[accountStatus] ?? ACCOUNT_STATUS_CFG.PENDING;
  const StatusIcon = statusCfg.icon;
  const showPlanCards = accountStatus === 'PENDING' || accountStatus === 'EXPIRED' || renewMode;
  const pendingPayment = status?.latest_payment?.status === 'PENDING' ? status.latest_payment : null;
  // Phase B.1 (F2): the latest rejected payment is a recovery banner,
  // not just a history row — reason + fresh-request CTA.
  const rejectedPayment = status?.latest_payment?.status === 'REJECTED' ? status.latest_payment : null;

  return (
    <DashboardLayout title="الاشتراك والفوترة">
      <div className="space-y-5">
        {/* ── Account status header ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="matrix-panel p-4 flex items-center justify-between gap-4 flex-wrap"
        >
          <div className="flex items-center gap-3">
            <span className={cn('badge flex items-center gap-1.5 text-[10px]', statusCfg.badge)}>
              <StatusIcon className="w-3.5 h-3.5" />
              {statusCfg.label}
            </span>
            <div>
              <p className="text-sm font-semibold text-matrix-text">{status?.showroom?.name ?? 'معرضي'}</p>
              {status?.showroom?.license_expiry && (
                <p className="text-[10px] font-mono text-matrix-subtle">
                  ترخيص النظام حتى {formatDate(status.showroom.license_expiry)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showPlanCards && (
              <button
                onClick={() => refetch()}
                className="flex items-center gap-1.5 px-3 min-h-9 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all text-[10px] font-mono"
              >
                <RefreshCw className="w-3 h-3" />
                تحديث
              </button>
            )}
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-matrix-cyan" />}
          </div>
        </motion.div>

        {/* ── REJECTED: recovery card (F2) — reason + re-submit ── */}
        {rejectedPayment && (
          <RejectedPaymentCard payment={rejectedPayment} canManage={canManage} />
        )}

        {/* ── PENDING_PAYMENT: review state ── */}
        {pendingPayment && (
          <PendingPaymentCard payment={pendingPayment} instructions={status?.payment_instructions} canManage={canManage} />
        )}

        {/* ── PENDING_PAYMENT renewal: the running plan stays visible
              while the renewal claim is under review (F5) ── */}
        {accountStatus === 'PENDING_PAYMENT' && currentSub?.status === 'ACTIVE' && (
          <ActivePlanCard
            status={{ ...status!, subscription: currentSub, latest_payment: status!.latest_payment }}
          />
        )}

        {/* ── ACTIVE: current plan + usage ── */}
        {accountStatus === 'ACTIVE' && status?.subscription && (
          <ActivePlanCard
            status={status}
            onRenew={() => { setRenewMode(true); setSelectedPlan(null); }}
          />
        )}

        {/* ── Expiring soon (F5): ≤7 days — prominence + CTA ── */}
        {accountStatus === 'ACTIVE' && status?.subscription?.expires_at && daysUntil(status.subscription.expires_at) <= 7 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="matrix-panel p-5 border border-matrix-amber/30 bg-matrix-amber/[0.04]"
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="w-5 h-5 text-matrix-amber shrink-0 mt-0.5" />
                <div>
                  <p className="section-title mb-1">اشتراكك ينتهي خلال {daysUntil(status.subscription.expires_at)} يوم</p>
                  <p className="text-xs text-matrix-subtle leading-relaxed">
                    الاشتراك ينتهي في {formatDate(status.subscription.expires_at)} — جرّد قبل الانتهاء لتفادي انقطاع العمل.
                  </p>
                </div>
              </div>
              {canManage && (
                <button
                  onClick={() => { setRenewMode(true); setSelectedPlan(null); }}
                  className="flex items-center gap-2 px-4 min-h-10 rounded-lg border border-matrix-amber/40 bg-matrix-amber/10 text-matrix-amber hover:bg-matrix-amber/15 transition-all text-xs font-mono"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  تجديد الآن
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* ── PENDING / EXPIRED / renewal-mode: plan cards ── */}
        {showPlanCards && (
          <div>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <p className="flex items-center gap-2 section-title">
                <CreditCard className="w-4 h-4 text-matrix-cyan" />
                {renewMode
                  ? 'اختر باقتك للتجديد / الترقية'
                  : accountStatus === 'EXPIRED'
                    ? 'اشتراكك منتهي — اختر باقة للاستئناف'
                    : 'اختر باقتك للبدء'}
              </p>
              {renewMode && (
                <button
                  onClick={() => { setRenewMode(false); setSelectedPlan(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-red hover:text-matrix-red transition-all text-[10px] font-mono"
                >
                  <XCircle className="w-3 h-3" />
                  إلغاء التجديد
                </button>
              )}
            </div>
            {/* Phase B.1 (F9): STAFF never triggers OWNER purchases —
                the cards render as reference (plan names/pricing) but
                the choose buttons are inert; the backend ownerOnly
                gate is the authority. */}
            {!canManage && (
              <div className="p-3 rounded-lg border border-matrix-border bg-matrix-dark/60 mb-4 flex items-start gap-2">
                <Shield className="w-4 h-4 text-matrix-cyan shrink-0 mt-0.5" />
                <p className="text-xs text-matrix-subtle leading-relaxed">
                  اختيار الباقة وتأكيد الدفع متاح لصاحب الحساب فقط. يمكنك متابعة حالة الطلب من هذه الصفحة.
                </p>
              </div>
            )}

            {/* Phase C.7 — billing period + trial banner from the
                backend catalog (approved model). */}
            <PeriodSelector
              periods={pricing?.periods ?? []}
              value={selectedPeriod}
              onChange={setSelectedPeriod}
              currency={pricing?.currency ?? 'EGP'}
              trialDays={pricing?.trial_days}
              disabled={!canManage}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans?.map((plan) => {
                const special = plan.code.toLowerCase().includes('pro');
                return (
                  <div key={plan.id} className={cn(special && 'md:col-span-1')}>
                    <PlanCard
                      plan={plan}
                      isPending={false}
                      disabled={!canManage}
                      onChoose={() => setSelectedPlan(selectedPlan?.id === plan.id ? null : plan)}
                    />
                    <AnimatePresence>
                      {selectedPlan?.id === plan.id && (
                        <RequestPanel
                          plan={plan}
                          period={selectedPeriod}
                          currency={pricing?.currency ?? plan.currency}
                          instructions={status?.payment_instructions}
                          mode={renewMode ? 'renewal' : 'purchase'}
                          onDone={() => setSelectedPlan(null)}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
            {/* Backend instructions repeated for customers who pay after refreshing */}
            {status?.payment_instructions && !selectedPlan && (
              <div className="matrix-panel p-4 mt-4 border border-matrix-border/50">
                <p className="flex items-center gap-2 text-xs font-mono font-semibold text-matrix-cyan mb-2">
                  <Landmark className="w-3.5 h-3.5" /> {status.payment_instructions.headline}
                </p>
                <ol className="space-y-1">
                  {status.payment_instructions.steps?.map((s, i) => (
                    <li key={i} className="text-xs text-matrix-text leading-relaxed">{s}</li>
                  ))}
                </ol>
                {status.payment_instructions.bank_account && (
                  <p className="text-xs font-mono text-matrix-cyan mt-2" dir="ltr" style={{ textAlign: 'right' }}>
                    <BadgeCheck className="inline w-3.5 h-3.5 ml-1 text-matrix-green" />
                    {status.payment_instructions.bank_account}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Payment history ── */}
        <div className="matrix-panel overflow-hidden">
          <div className="px-4 py-3 border-b border-matrix-border flex items-center gap-2">
            <Receipt className="w-4 h-4 text-matrix-cyan" />
            <p className="section-title mb-0">سجل المدفوعات</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="border-b border-matrix-border/70">
                  {['التاريخ', 'الباقة', 'المبلغ', 'طريقة الدفع', 'الحالة', 'السبب', 'المرجع'].map((h) => (
                    <th key={h} className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-matrix-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin text-matrix-cyan mx-auto" /></td></tr>
                ) : !payments?.data?.length ? (
                  <tr><td colSpan={7} className="py-12 text-center text-matrix-subtle text-xs font-mono">لا توجد مدفوعات بعد</td></tr>
                ) : (
                  payments.data.map((p) => {
                    const cfg = PAYMENT_STATUS_CFG[p.status] ?? PAYMENT_STATUS_CFG.PENDING;
                    return (
                      <tr key={p.id} className="border-b border-matrix-border/40 hover:bg-matrix-cyan/[0.02] transition-colors">
                        <td className="px-4 py-3 text-[10px] font-mono text-matrix-subtle">{formatDate(p.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className="badge-cyan text-[10px]">{p.plan_name}</span>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono font-semibold text-matrix-text">
                          {formatCurrency(p.amount)} <span className="text-matrix-subtle">{p.currency}</span>
                        </td>
                        <td className="px-4 py-3 text-[10px] font-mono text-matrix-subtle">{p.method}</td>
                        <td className="px-4 py-3">
                          <span className={cn('badge text-[10px]', cfg.badge)}>{cfg.label}</span>
                        </td>
                        <td className="px-4 py-3 text-[10px] font-mono text-matrix-subtle max-w-[180px]">
                          {p.status === 'REJECTED'
                            ? <span className="text-matrix-red line-clamp-2">{p.rejection_reason || '—'}</span>
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-[10px] font-mono text-matrix-subtle" dir="ltr">
                          {p.reference || '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}