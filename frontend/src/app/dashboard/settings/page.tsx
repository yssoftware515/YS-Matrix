'use client';
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Lock, User, Save, Store, Loader2, LifeBuoy } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SaveModeBar } from '@/components/ui/SaveModeBar';
import { useSaveMode } from '@/hooks/useSaveMode';
import { authApi, onboardingApi, isApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth';
import { roleLabel, formatDate } from '@/lib/utils';

// Phase B.3 (F2): optional support contact surfaced from environment
// config — never hardcoded personal contact details. The guidance
// block itself renders regardless (billing self-service paths).
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';

export default function SettingsPage() {
  const { user, updateUser } = useAuthStore();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  // `data` here is whatever was passed to markDirty() below — for this
  // page, always `{ name: string }` (the only editable profile field
  // wired up so far). updateUser() merges onto the existing user
  // object (see auth.ts) rather than replacing it, so the response's
  // missing `showroom` field (auth.controller.js deliberately excludes
  // it — see authApi.updateProfile in api.ts) is not a problem.
  const saveProfile = useCallback(async (data: unknown) => {
    try {
      const { name } = data as { name: string };
      const updated = await authApi.updateProfile({ name });
      updateUser(updated);
      toast.success('تم تحديث الملف الشخصي');
    } catch (err) {
      toast.error(isApiRequestError(err) ? err.message : 'فشل تحديث الملف الشخصي');
      throw err; // re-throw so useSaveMode marks status as 'error', not 'saved'
    }
  }, [updateUser]);
  const { mode, status, isDirty, save, discard, toggleMode, markDirty } = useSaveMode({ onSave: saveProfile });

  const changePw = useMutation({
    mutationFn: ({ c, n }: { c: string; n: string }) => authApi.changePassword(c, n),
    onSuccess: () => { toast.success('تم تغيير كلمة المرور'); setPw({ current: '', next: '', confirm: '' }); },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e?.response?.data?.message || 'فشل تغيير كلمة المرور'),
  });

  const handleChangePw = () => {
    if (!pw.current || !pw.next) { toast.error('جميع الحقول مطلوبة'); return; }
    if (pw.next !== pw.confirm) { toast.error('كلمة المرور الجديدة غير متطابقة'); return; }
    if (pw.next.length < 8) { toast.error('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return; }
    changePw.mutate({ c: pw.current, n: pw.next });
  };

  // ── Phase B.3 (F2): showroom business profile ───────────────────
  // GET /onboarding/status now returns address/phone/email (server
  // side, tenant-scoped). OWNER/SUPER_ADMIN may update via the
  // canonical PATCH /onboarding (onboarding.controller.js — the same
  // path the first-run wizard uses, audited); STAFF gets a read-only
  // view — the backend rejects STAFF PATCH with 403 regardless.
  const isOwner = user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN';
  const qc = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ['showroom-profile'],
    queryFn: () => onboardingApi.getStatus(),
  });
  const [biz, setBiz] = useState({ name: '', address: '', phone: '', email: '', logo_url: '' });
  const [bizLoaded, setBizLoaded] = useState(false);
  const profile = profileQuery.data;
  if (profile && !bizLoaded) {
    setBizLoaded(true);
    setBiz({
      name: profile.showroom_name || '',
      address: profile.address || '',
      phone: profile.phone || '',
      email: profile.email || '',
      logo_url: profile.logo_url || '',
    });
  }
  const saveBiz = useMutation({
    mutationFn: () => onboardingApi.complete({
      name: biz.name.trim(),
      ...(biz.address.trim() ? { address: biz.address.trim() } : {}),
      ...(biz.phone.trim() ? { phone: biz.phone.trim() } : {}),
      ...(biz.email.trim() ? { email: biz.email.trim() } : {}),
      ...(biz.logo_url.trim() ? { logo_url: biz.logo_url.trim() } : {}),
    }),
    onSuccess: () => {
      toast.success('تم تحديث بيانات المعرض');
      qc.invalidateQueries({ queryKey: ['showroom-profile'] });
    },
    onError: (err: unknown) => {
      toast.error(isApiRequestError(err) ? err.message : 'فشل تحديث بيانات المعرض');
    },
  });
  const handleSaveBiz = () => {
    if (!biz.name.trim()) { toast.error('اسم المعرض مطلوب'); return; }
    saveBiz.mutate();
  };
  const bizRow = (label: string, value: string) => (
    <div key={label} className="flex justify-between p-3 rounded-lg border border-matrix-border bg-matrix-dark text-sm">
      <span className="text-matrix-subtle">{label}</span><span className="font-mono text-matrix-text">{value || '—'}</span>
    </div>
  );

  return (
    <DashboardLayout title="الإعدادات">
      <div className="max-w-2xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="matrix-panel p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-matrix-cyan/10 border border-matrix-cyan/30"><User className="w-4 h-4 text-matrix-cyan" /></div>
            <h2 className="font-display text-sm font-semibold tracking-widest uppercase">الملف الشخصي</h2>
          </div>
          <SaveModeBar mode={mode} status={status} isDirty={isDirty} onSave={save} onDiscard={discard} onToggle={toggleMode} />
          <div className="space-y-3">
            {[['الاسم', user?.name || '—'], ['البريد الإلكتروني', user?.email || '—'], ['الصلاحية', roleLabel[user?.role || ''] || '—'], ['المعرض', user?.showroom?.name || '—'], ['انتهاء الترخيص', user?.showroom?.license_expiry ? formatDate(user.showroom.license_expiry) : '—']].map(([l, v]) => (
              <div key={l} className="flex justify-between p-3 rounded-lg border border-matrix-border bg-matrix-dark text-sm">
                <span className="text-matrix-subtle">{l}</span><span className="font-mono">{v}</span>
              </div>
            ))}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">تعديل الاسم</label>
              <input type="text" defaultValue={user?.name || ''} onChange={(e) => markDirty({ name: e.target.value })} className="matrix-input" placeholder={user?.name} />
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="matrix-panel p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-matrix-green/10 border border-matrix-green/30"><Store className="w-4 h-4 text-matrix-green" /></div>
            <h2 className="font-display text-sm font-semibold tracking-widest uppercase">بيانات المعرض</h2>
            {!isOwner && <span className="text-[10px] font-mono text-matrix-subtle">قراءة فقط</span>}
          </div>

          {profileQuery.isLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-matrix-cyan" /></div>
          ) : isOwner ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">اسم المعرض *</label>
                <input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} className="matrix-input" placeholder="اسم المعرض" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">العنوان</label>
                <input value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })} className="matrix-input" placeholder="عنوان المعرض" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">رقم الهاتف</label>
                <input value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} className="matrix-input" placeholder="هاتف المعرض" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">البريد الإلكتروني</label>
                <input value={biz.email} onChange={(e) => setBiz({ ...biz, email: e.target.value })} className="matrix-input" placeholder="showroom@example.com" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">رابط الشعار</label>
                <input value={biz.logo_url} onChange={(e) => setBiz({ ...biz, logo_url: e.target.value })} className="matrix-input" placeholder="https://..." dir="ltr" />
              </div>
              <button
                onClick={handleSaveBiz}
                disabled={saveBiz.isPending}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2"
              >
                {saveBiz.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ بيانات المعرض
              </button>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {bizRow('اسم المعرض', profile?.showroom_name || '')}
              {bizRow('العنوان', profile?.address || '')}
              {bizRow('رقم الهاتف', profile?.phone || '')}
              {bizRow('البريد الإلكتروني', profile?.email || '')}
              <p className="text-[11px] text-matrix-subtle leading-relaxed">
                تعديل بيانات المعرض متاح لصاحب المعرض فقط — تُعرض هنا للأعضاء للاطلاع.
              </p>
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="matrix-panel p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-matrix-amber/10 border border-matrix-amber/30"><Lock className="w-4 h-4 text-matrix-amber" /></div>
            <h2 className="font-display text-sm font-semibold tracking-widest uppercase">تغيير كلمة المرور</h2>
          </div>
          <div className="space-y-4">
            {[{ k: 'current', l: 'كلمة المرور الحالية' }, { k: 'next', l: 'كلمة المرور الجديدة' }, { k: 'confirm', l: 'تأكيد كلمة المرور الجديدة' }].map(({ k, l }) => (
              <div key={k}>
                <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">{l}</label>
                <input type="password" value={(pw as Record<string,string>)[k]} onChange={(e) => setPw({ ...pw, [k]: e.target.value })} className="matrix-input" dir="ltr" placeholder="••••••••" />
              </div>
            ))}
            <button onClick={handleChangePw} disabled={changePw.isPending} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
              {changePw.isPending ? <span className="w-4 h-4 border-2 border-matrix-cyan border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              تغيير كلمة المرور
            </button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="matrix-panel p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-matrix-purple/10 border border-matrix-purple/30"><Settings className="w-4 h-4 text-matrix-purple" /></div>
            <h2 className="font-display text-sm font-semibold tracking-widest uppercase">معلومات النظام</h2>
          </div>
          <div className="space-y-3 text-sm">
            {[['الإصدار', 'v2.0.0'], ['Frontend', 'Next.js 14 + TypeScript'], ['Backend', 'Node.js + Express + Prisma'], ['Database', 'PostgreSQL'], ['المطور', 'YS Systems & Software']].map(([l, v]) => (
              <div key={l} className="flex justify-between p-3 rounded-lg border border-matrix-border bg-matrix-dark">
                <span className="text-matrix-subtle">{l}</span><span className="font-mono text-matrix-cyan text-xs">{v}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="matrix-panel p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-matrix-cyan/10 border border-matrix-cyan/30"><LifeBuoy className="w-4 h-4 text-matrix-cyan" /></div>
            <h2 className="font-display text-sm font-semibold tracking-widest uppercase">المساعدة والدعم</h2>
          </div>
          <div className="space-y-3 text-sm">
            {[
              ['تجديد الاشتراك والفوترة', 'من صفحة «الاشتراك والفوترة» — اختيار الباقة وتقديم إثبات الدفع وتتبع حالة الطلب.'],
              ['إدارة فريق المعرض', 'من صفحة «المستخدمون» (صاحب المعرض) — إنشاء الحسابات وتفعيلها أو تعطيلها فوراً.'],
              ['بيانات المعرض', 'تظهر على فواتير البيع المطبوعة — حافظ على تحديثها من هذه الصفحة.'],
            ].map(([t, d]) => (
              <div key={t} className="p-3 rounded-lg border border-matrix-border bg-matrix-dark">
                <p className="font-mono text-matrix-cyan text-xs mb-1">{t}</p>
                <p className="text-matrix-subtle text-xs leading-relaxed">{d}</p>
              </div>
            ))}
            {SUPPORT_EMAIL && (
              <p className="text-xs text-matrix-subtle leading-relaxed">
                للدعم المباشر راسلنا على:{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} dir="ltr" className="font-mono text-matrix-cyan hover:underline">{SUPPORT_EMAIL}</a>
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
