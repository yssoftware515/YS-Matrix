'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, Package, AlertTriangle, Users, Truck, Clock, ShoppingCart, BadgeCheck, ArrowLeft, Plus, UserPlus, Wallet, Bell, RefreshCw, CheckCircle2, Activity as ActivityIcon, ShieldAlert } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { KpiCard } from '@/components/ui/KpiCard';
import { analyticsApi, salesApi, subscriptionApi, inventoryApi, activityApi, type ActivityLogEntry } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, daysUntil, vehicleTypeLabel, cn } from '@/lib/utils';
import { useAuthStore, isSuperAdmin, isPlatformAdmin, isOwnerPlus } from '@/lib/auth';
import { useUnreadCount } from '@/hooks/useNotifications';
import dynamic from 'next/dynamic';
const RevenueChart = dynamic(() => import('./RevenueChart'), { ssr: false });
import { motion } from 'framer-motion';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'صاحب المعرض',
  STAFF: 'موظف',
  SUPER_ADMIN: 'مدير النظام',
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'إنشاء', UPDATE: 'تعديل', DELETE: 'حذف', SOFT_DELETE: 'تعطيل', REACTIVATE: 'تفعيل',
  LOGIN: 'تسجيل دخول', LOGOUT: 'تسجيل خروج', CREATE_SALE: 'بيع جديد', CANCEL_SALE: 'إلغاء بيع',
  ADD_PAYMENT: 'دفعة جديدة', RENEW_LICENSE: 'تجديد اشتراك', ONBOARD_SHOWROOM: 'إعداد المعرض',
  BULK_CREATE: 'إضافة جماعية',
};

type Status = Awaited<ReturnType<typeof subscriptionApi.getStatus>> | undefined;

const ACTIONS: Array<{ href: string; label: string; icon: React.ReactNode; ownerOnly?: boolean; tone: string }> = [
  { href: '/dashboard/sales', label: 'بيع جديد', icon: <ShoppingCart className="w-4 h-4" />, tone: 'border-matrix-cyan/30 bg-matrix-cyan/10 text-matrix-cyan hover:bg-matrix-cyan/15' },
  { href: '/dashboard/inventory', label: 'إضافة مركبة', icon: <Plus className="w-4 h-4" />, tone: 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan' },
  { href: '/dashboard/customers', label: 'إضافة عميل', icon: <Users className="w-4 h-4" />, tone: 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan' },
  { href: '/dashboard/expenses', label: 'تسجيل مصروف', icon: <Wallet className="w-4 h-4" />, tone: 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan' },
  { href: '/dashboard/users', label: 'دعوة موظف', icon: <UserPlus className="w-4 h-4" />, ownerOnly: true, tone: 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan' },
  { href: '/dashboard/activity', label: 'سجل النشاط', icon: <ActivityIcon className="w-4 h-4" />, ownerOnly: true, tone: 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan' },
];

function HeroAction({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn('flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-lg border transition-all text-xs font-mono', className)}
    >
      {children}
    </Link>
  );
}

function OrientationHero({ accountStatus }: { accountStatus: Status }) {
  const user = useAuthStore((s) => s.user);
  const role = ROLE_LABEL[user?.role ?? ''] ?? 'موظف';
  const { data: unread } = useUnreadCount();

  const sub = accountStatus?.subscription;
  const daysLeft = sub?.expires_at ? daysUntil(sub.expires_at) : null;
  const st = accountStatus?.account_status;
  const isActive = st === 'ACTIVE';
  // F19: legacy account — PENDING status but NO subscription row. The
  // backend (account.middleware.js:requireAccountActive) passes legacy
  // showrooms straight through; only a TRIAL claim means "must buy now".
  const isLegacy = st === 'PENDING' && !sub;

  const statusLine = isActive && sub
    ? <span className="text-matrix-green">اشتراك نشط — {sub.plan_name} · {daysLeft ?? '—'} يوم متبقٍ</span>
    : isLegacy
      ? <span className="text-matrix-subtle">حساب فعّال — ترخيص حتى {accountStatus?.showroom?.license_expiry ? formatDate(accountStatus.showroom.license_expiry) : '—'}</span>
      : <span className="text-matrix-amber">حالة الاشتراك — راجع صفحة الاشتراك</span>;

  const needsAction = !isLegacy && !(isActive && sub);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="matrix-panel p-5 flex items-start justify-between gap-4 flex-wrap"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-mono text-matrix-subtle mb-1">لوحة التحكم — نظرة سريعة</p>
        <h1 className="font-display text-xl font-bold text-matrix-text truncate">
          مرحباً {user?.name?.split(' ')[0] ?? 'بك'} — {user?.showroom?.name ?? 'معرضي'}
        </h1>
        <p className="text-[11px] font-mono text-matrix-subtle mt-1">{role} · {statusLine}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {unread && unread.unread_count > 0 && (
          <HeroAction href="/dashboard/notifications" className="border-matrix-amber/30 bg-matrix-amber/10 text-matrix-amber hover:bg-matrix-amber/15">
            <Bell className="w-3.5 h-3.5" />
            {unread.unread_count} إشعارات
          </HeroAction>
        )}
        <HeroAction href="/dashboard/sales" className="border-matrix-cyan/30 bg-matrix-cyan/10 text-matrix-cyan hover:bg-matrix-cyan/15">
          <ShoppingCart className="w-3.5 h-3.5" />
          بيع جديد
        </HeroAction>
        <HeroAction href="/dashboard/inventory" className="border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan">
          <Package className="w-3.5 h-3.5" />
          المخزون
        </HeroAction>
        <HeroAction href="/dashboard/billing" className={cn(
          'border text-matrix-subtle hover:text-matrix-cyan transition-all text-xs font-mono',
          needsAction ? 'border-matrix-amber/40 bg-matrix-amber/10 text-matrix-amber' : 'border-matrix-border hover:border-matrix-cyan'
        )}>
          <BadgeCheck className="w-3.5 h-3.5" />
          الاشتراك
          <ArrowLeft className="w-3 h-3" />
        </HeroAction>
      </div>
    </motion.div>
  );
}

function SubscriptionHealth({ accountStatus }: { accountStatus: Status }) {
  if (!accountStatus) return null;
  const sub = accountStatus.subscription;
  const st = accountStatus.account_status;
  const isLegacy = st === 'PENDING' && !sub;
  const daysLeft = sub?.expires_at ? daysUntil(sub.expires_at) : null;

  let pill: { label: string; className: string } | null = null;
  if (isLegacy) pill = { label: `حساب فعّال — ترخيص حتى ${formatDate(accountStatus.showroom.license_expiry)}`, className: 'border-matrix-border text-matrix-subtle' };
  else if (st === 'ACTIVE' && sub) {
    const soon = daysLeft !== null && daysLeft <= 30;
    pill = soon
      ? { label: `اشتراك ينتهي خلال ${daysLeft} يوماً — جدد الآن`, className: 'border-matrix-amber/40 bg-matrix-amber/10 text-matrix-amber' }
      : { label: `${sub.plan_name} — ${daysLeft} يوم متبقٍ`, className: 'border-matrix-green/30 bg-matrix-green/10 text-matrix-green' };
  } else if (st === 'PENDING_PAYMENT' || st === 'EXPIRED' || st === 'PENDING') {
    pill = { label: st === 'PENDING_PAYMENT' ? 'بانتظار تأكيد الدفع' : st === 'EXPIRED' ? 'الاشتراك منتهي — جدد للاستمرار' : 'بانتظار اختيار الباقة', className: 'border-matrix-amber/40 bg-matrix-amber/10 text-matrix-amber' };
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="matrix-panel px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap"
    >
      <span className={cn('flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg border', pill?.className)}>
        <BadgeCheck className="w-3.5 h-3.5" />
        {pill?.label ?? '—'}
      </span>
      <Link href="/dashboard/billing" className="text-[11px] font-mono text-matrix-cyan hover:text-matrix-text transition-colors">
        إدارة الاشتراك ←
      </Link>
    </motion.div>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <ShieldAlert className="w-6 h-6 text-matrix-red/70" />
      <p className="text-sm text-matrix-subtle">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-matrix-border text-xs font-mono text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all">
          <RefreshCw className="w-3.5 h-3.5" />
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <p className="section-title mb-4 flex items-center gap-2">{children}</p>;
}

export default function DashboardPage() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);

  const isTenantUser = !isSuperAdmin(user?.role) && !isPlatformAdmin(user);
  const canViewActivity = isTenantUser && isOwnerPlus(user?.role);

  const { data: accountStatus } = useQuery({
    queryKey: ['home-account-status'],
    queryFn:  () => subscriptionApi.getStatus(),
    enabled:  !!isTenantUser,
    retry:    false,
  });

  useEffect(() => {
    if (!accountStatus || !isTenantUser) return;
    const st = accountStatus.account_status;
    if (st === 'SUSPENDED') {
      router.replace('/dashboard/suspended');
      return;
    }
    // F19: legacy accounts (no subscription row at all) keep their
    // dashboard — backend requireAccountActive treats them as
    // pre-Phase-4 showrooms and passes them through. Only TRIAL-based
    // PENDING (or payment/expiry states) must buy now.
    if (st === 'PENDING' && !accountStatus.subscription) return;
    if (st === 'PENDING' || st === 'PENDING_PAYMENT' || st === 'EXPIRED') {
      router.replace('/dashboard/billing');
      return;
    }
    if (st === 'ACTIVE' && !accountStatus.showroom?.is_onboarded) {
      router.replace('/dashboard/onboarding');
    }
  }, [accountStatus, isTenantUser, router]);

  // Phase B.3 (F5): ERP queries are gated on the account state so a
  // SUSPENDED/PENDING_PAYMENT/EXPIRED account never fires a burst of
  // 403s into the console before the redirect above lands. While the
  // status is still loading nothing operational fires; ACTIVE and
  // legacy PENDING (no subscription row — F19) pass through as before.
  // If the status query itself fails (retry:false), we fall back to
  // firing normally rather than freezing the dashboard.
  const statusLoaded = !!accountStatus;
  const st = accountStatus?.account_status;
  const canOperate = !statusLoaded || st === 'ACTIVE' || (st === 'PENDING' && !accountStatus?.subscription);

  const { data: kpis, isLoading, isError: kpisError, refetch: refetchKpis } = useQuery({ queryKey: ['kpis'], queryFn: () => analyticsApi.getDashboard({ range: 'month' }), enabled: canOperate });
  const { data: chart, isError: chartError, refetch: refetchChart } = useQuery({ queryKey: ['chart'], queryFn: () => analyticsApi.getRevenue({ range: 'month', group_by: 'day' }), enabled: canOperate });
  const { data: overdue, isError: overdueError, refetch: refetchOverdue } = useQuery({ queryKey: ['overdue'], queryFn: () => salesApi.getOverdue({ limit: 5 }), enabled: canOperate });
  const { data: upcoming, isError: upcomingError, refetch: refetchUpcoming } = useQuery({ queryKey: ['upcoming'], queryFn: () => salesApi.getUpcoming({ days: 7 }), enabled: canOperate });
  const { data: lowStock, isError: lowStockError, refetch: refetchLowStock } = useQuery({
    queryKey: ['dashboard', 'low-stock'],
    queryFn:  () => inventoryApi.getLowStock(),
    enabled:  canOperate,
  });
  const { data: activity, isError: activityError, refetch: refetchActivity } = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn:  () => activityApi.getAll({ limit: 5 }),
    enabled:  !!canViewActivity,
  });

  const overdueItems = overdue?.data?.slice(0, 5) ?? [];
  const lowStockItems = lowStock?.slice(0, 5) ?? [];
  const upcomingItems = upcoming?.slice(0, 6) ?? [];
  const activityItems: ActivityLogEntry[] = activity?.data ?? [];

  const hasNoData = kpis && kpis.customers?.total === 0 && kpis.inventory?.total === 0 && kpis.sales?.count === 0;

  const subExpiry = accountStatus?.subscription?.expires_at;
  const subDaysLeft = subExpiry ? daysUntil(subExpiry) : null;

  const attention: Array<{ label: string; href: string; icon: React.ReactNode; tone: string; show: boolean }> = [
    {
      label: `الاشتراك ينتهي خلال ${subDaysLeft} يوماً`,
      href: '/dashboard/billing', icon: <BadgeCheck className="w-3.5 h-3.5" />,
      tone: 'border-matrix-amber/30 bg-matrix-amber/5',
      show: !!subExpiry && subDaysLeft !== null && subDaysLeft > 0 && subDaysLeft <= 30,
    },
    {
      label: `${kpis?.installments?.overdue_count || 0} أقساط متأخرة بقيمة ${formatCurrency(kpis?.installments?.overdue_amount || 0)}`,
      href: '/dashboard/installments', icon: <AlertTriangle className="w-3.5 h-3.5" />,
      tone: 'border-matrix-red/30 bg-matrix-red/5',
      show: (kpis?.installments?.overdue_count || 0) > 0,
    },
    {
      label: `${kpis?.inventory?.low_stock || 0} أصناف منخفضة في المخزون`,
      href: '/dashboard/inventory', icon: <Package className="w-3.5 h-3.5" />,
      tone: 'border-matrix-amber/30 bg-matrix-amber/5',
      show: (kpis?.inventory?.low_stock || 0) > 0,
    },
    {
      label: `${kpis?.installments?.due_this_week || 0} قسط مستحق خلال 7 أيام`,
      href: '/dashboard/installments', icon: <Clock className="w-3.5 h-3.5" />,
      tone: 'border-matrix-cyan/20 bg-matrix-cyan/5',
      show: (kpis?.installments?.due_this_week || 0) > 0,
    },
  ];
  const attentionItems = attention.filter((a) => a.show);

  return (
    <DashboardLayout title="لوحة التحكم">
      <div className="space-y-6">
        {isTenantUser && <OrientationHero accountStatus={accountStatus} />}
        {isTenantUser && <SubscriptionHealth accountStatus={accountStatus} />}

        {!isTenantUser && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="matrix-panel p-6 text-center">
            <p className="text-sm text-matrix-subtle mb-3">لوحة معرض مخصصة لأصحاب المعارض والموظفين</p>
            <Link href="/dashboard/superadmin" className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg border border-matrix-purple/30 bg-matrix-purple/10 text-matrix-purple text-xs font-mono hover:bg-matrix-purple/15 transition-all">
              <ShieldAlert className="w-3.5 h-3.5" />
              الانتقال إلى لوحة مدير النظام
            </Link>
          </motion.div>
        )}

        {isTenantUser && hasNoData && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="matrix-panel p-5">
            <PanelTitle><CheckCircle2 className="w-3.5 h-3.5 text-matrix-cyan" />ابدأ مع معرضك</PanelTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { href: '/dashboard/inventory', label: 'أضف أول مركبة للمخزون', sub: 'المركبات تصبح جاهزة للبيع' },
                { href: '/dashboard/customers', label: 'سجّل أول عميل', sub: 'بيانات العملاء تنظم عملك' },
                { href: '/dashboard/sales', label: 'سجّل أول عملية بيع', sub: 'تُحتسب في المبيعات والأرباح' },
              ].map((s) => (
                <Link key={s.href} href={s.href} className="group p-4 rounded-lg border border-matrix-border hover:border-matrix-cyan transition-all">
                  <p className="text-sm font-bold text-matrix-text group-hover:text-matrix-cyan transition-colors">{s.label}</p>
                  <p className="text-xs text-matrix-subtle mt-1">{s.sub}</p>
                </Link>
              ))}
            </div>
          </motion.div>
        )}

        {isTenantUser && attentionItems.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="matrix-panel p-5">
            <PanelTitle><AlertTriangle className="w-3.5 h-3.5 text-matrix-amber" />يحتاج اهتمامك</PanelTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {attentionItems.map((item, i) => (
                <Link key={i} href={item.href} className={cn('flex items-center justify-between gap-3 p-3 min-h-[52px] rounded-lg border transition-all hover:brightness-110', item.tone)}>
                  <span className="flex items-center gap-2 text-xs font-mono text-matrix-text">{item.icon}{item.label}</span>
                  <ArrowLeft className="w-3.5 h-3.5 text-matrix-subtle" />
                </Link>
              ))}
            </div>
          </motion.div>
        )}

        {isTenantUser && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="matrix-panel p-5">
            <PanelTitle><ShoppingCart className="w-3.5 h-3.5 text-matrix-cyan" />إجراءات سريعة</PanelTitle>
            <div className="flex flex-wrap gap-3">
              {ACTIONS.filter((a) => !a.ownerOnly || isOwnerPlus(user?.role)).map((a) => (
                <HeroAction key={a.href} href={a.href} className={a.tone}>
                  {a.icon}
                  {a.label}
                </HeroAction>
              ))}
            </div>
          </motion.div>
        )}

        {isTenantUser && kpisError && (
          <div className="matrix-panel p-5"><SectionError message="تعذر تحميل مؤشرات الأداء" onRetry={() => refetchKpis()} /></div>
        )}
        {isTenantUser && !kpisError && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="إجمالي المبيعات — استحقاق" value={formatCurrency(kpis?.sales?.revenue || 0)} subtitle={`${kpis?.sales?.count || 0} صفقة غير ملغاة`} change={Number(kpis?.sales?.revenue_change || 0)} icon={<DollarSign className="w-5 h-5" />} color="green" loading={isLoading} delay={0} />
            <KpiCard title="الربح — استحقاق" value={formatCurrency(kpis?.sales?.profit || 0)} subtitle={`هامش ${kpis?.sales?.profit_margin || 0}%`} change={Number(kpis?.sales?.profit_change || 0)} icon={<TrendingUp className="w-5 h-5" />} color="cyan" loading={isLoading} delay={0.08} />
            <KpiCard title="المخزون المتاح" value={(kpis?.inventory?.total || 0) - (kpis?.inventory?.sold || 0)} subtitle={`${kpis?.inventory?.low_stock || 0} منخفض المتوفر`} icon={<Package className="w-5 h-5" />} color="amber" loading={isLoading} delay={0.16} />
            <KpiCard title="أقساط متأخرة" value={formatCurrency(kpis?.installments?.overdue_amount || 0)} subtitle={`${kpis?.installments?.overdue_count || 0} قسط`} icon={<AlertTriangle className="w-5 h-5" />} color="red" loading={isLoading} delay={0.24} />
            <KpiCard title="العملاء" value={kpis?.customers?.total || 0} subtitle={`${kpis?.customers?.new_this_period || 0} جديد هذا الشهر`} icon={<Users className="w-5 h-5" />} color="purple" loading={isLoading} delay={0.3} />
            <KpiCard title="رصيد الموردين — ذمم" value={formatCurrency(kpis?.suppliers?.outstanding_balance || 0)} subtitle="رصيد محاسبي (استحقاق − مدفوع)" icon={<Truck className="w-5 h-5" />} color="amber" loading={isLoading} delay={0.36} />
            <KpiCard title="أقساط الأسبوع" value={kpis?.installments?.due_this_week || 0} subtitle="مستحقة خلال 7 أيام" icon={<Clock className="w-5 h-5" />} color="cyan" loading={isLoading} delay={0.42} />
            <KpiCard title="مبيعات الشهر" value={kpis?.sales?.count || 0} subtitle="صفقة مكتملة (غير ملغاة)" icon={<ShoppingCart className="w-5 h-5" />} color="green" loading={isLoading} delay={0.48} />
          </div>
        )}

        {isTenantUser && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="lg:col-span-2 matrix-panel p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="section-title mb-0">المبيعات الشهرية — يومياً</p>
                <p className="font-display text-lg font-bold text-matrix-green">{formatCurrency(kpis?.sales?.revenue || 0)}</p>
              </div>
              <div className="flex gap-4 text-xs font-mono">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-matrix-green" />إجمالي المبيعات</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-matrix-cyan" />الربح (استحقاق)</span>
              </div>
            </div>
            {chartError ? (
              <SectionError message="تعذر تحميل منحنى المبيعات" onRetry={() => refetchChart()} />
            ) : !chart ? (
              <div className="space-y-3 py-4"><div className="skeleton w-full h-40 rounded-lg" /><div className="skeleton w-2/3 h-4 rounded" /></div>
            ) : !chart.data?.length ? (
              <div className="text-center py-12">
                <p className="text-sm text-matrix-subtle mb-2">لا توجد مبيعات مسجلة في هذه الفترة</p>
                <Link href="/dashboard/sales" className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-matrix-cyan/30 bg-matrix-cyan/10 text-matrix-cyan text-xs font-mono hover:bg-matrix-cyan/15 transition-all">
                  <ShoppingCart className="w-3.5 h-3.5" />تسجيل أول بيع
                </Link>
              </div>
            ) : (
              <RevenueChart data={chart.data} />
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }} className="matrix-panel p-5">
            <PanelTitle><Package className="w-3 h-3 text-matrix-amber" />منخفض المتوفر</PanelTitle>
            {lowStockError ? (
              <SectionError message="تعذر تحميل تنبيهات المخزون" onRetry={() => refetchLowStock()} />
            ) : !lowStock ? (
              <div className="space-y-3 py-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton w-full h-12 rounded-lg" />)}</div>
            ) : lowStockItems.length === 0 ? (
              <p className="text-center text-sm text-matrix-subtle py-8">لا توجد أصناف منخفضة ✓</p>
            ) : (
              <div className="space-y-3">
                {lowStockItems.map((item) => (
                  <Link key={item.id} href="/dashboard/inventory" className="flex items-center justify-between p-3 rounded-lg border border-matrix-amber/20 bg-matrix-amber/5 hover:brightness-110 transition-all">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{item.brand} {item.model}</p>
                      <p className="text-xs text-matrix-subtle">{vehicleTypeLabel[item.vehicle_type] ?? item.vehicle_type}</p>
                    </div>
                    <div className="text-left shrink-0">
                      <p className="text-sm font-mono font-bold text-matrix-amber">{item.quantity} متبقي</p>
                      <p className="text-xs font-mono text-matrix-subtle">{formatCurrency(item.selling_price)}</p>
                    </div>
                  </Link>
                ))}
                <Link href="/dashboard/inventory" className="block text-center text-[11px] font-mono text-matrix-cyan hover:text-matrix-text transition-colors pt-1">
                  عرض كل المخزون ←
                </Link>
              </div>
            )}
          </motion.div>
        </div>
        )}

        {isTenantUser && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }} className="matrix-panel p-5">
            <PanelTitle><AlertTriangle className="w-3 h-3 text-matrix-red" />أقساط متأخرة</PanelTitle>
            {overdueError ? (
              <SectionError message="تعذر تحميل الأقساط المتأخرة" onRetry={() => refetchOverdue()} />
            ) : !overdue ? (
              <div className="space-y-3 py-2">{[0, 1].map((i) => <div key={i} className="skeleton w-full h-14 rounded-lg" />)}</div>
            ) : overdueItems.length === 0 ? (
              <p className="text-center text-sm text-matrix-subtle py-8">لا توجد أقساط متأخرة ✓</p>
            ) : (
              <div className="space-y-3">
                {overdueItems.map((item) => (
                  <Link key={item.id} href="/dashboard/installments" className="flex items-start justify-between p-3 rounded-lg border border-matrix-red/20 bg-matrix-red/5 hover:brightness-110 transition-all">
                    <div>
                      <p className="text-xs font-mono text-matrix-red">{item.sale?.invoice_number}</p>
                      <p className="text-sm">{item.sale?.customer?.name || 'بدون عميل'}</p>
                      <p className="text-xs text-matrix-subtle">{formatDate(item.due_date)}</p>
                    </div>
                    <p className="text-sm font-mono font-bold text-matrix-red">{formatCurrency(item.amount)}</p>
                  </Link>
                ))}
                <Link href="/dashboard/installments" className="block text-center text-[11px] font-mono text-matrix-cyan hover:text-matrix-text transition-colors pt-1">
                  كل الأقساط ←
                </Link>
              </div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.58 }} className="matrix-panel p-5">
            <PanelTitle><Clock className="w-3 h-3 text-matrix-amber" />أقساط هذا الأسبوع</PanelTitle>
            {upcomingError ? (
              <SectionError message="تعذر تحميل أقساط الأسبوع" onRetry={() => refetchUpcoming()} />
            ) : !upcoming ? (
              <div className="space-y-3 py-2">{[0, 1].map((i) => <div key={i} className="skeleton w-full h-14 rounded-lg" />)}</div>
            ) : upcomingItems.length === 0 ? (
              <p className="text-center text-sm text-matrix-subtle py-8">لا توجد أقساط هذا الأسبوع ✓</p>
            ) : (
              <div className="space-y-3">
                {upcomingItems.map((item) => (
                  <Link key={item.id} href="/dashboard/installments" className="flex items-center justify-between p-3 rounded-lg border border-matrix-amber/20 bg-matrix-amber/5 hover:brightness-110 transition-all">
                    <div>
                      <p className="text-xs font-mono text-matrix-amber">{item.sale?.invoice_number}</p>
                      <p className="text-sm">{item.sale?.customer?.name || 'بدون عميل'}</p>
                      <p className="text-xs text-matrix-subtle">{formatDate(item.due_date)}</p>
                    </div>
                    <p className="text-sm font-mono font-bold text-matrix-amber">{formatCurrency(item.amount)}</p>
                  </Link>
                ))}
              </div>
            )}
          </motion.div>

          {canViewActivity && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.61 }} className="matrix-panel p-5">
              <PanelTitle><ActivityIcon className="w-3 h-3 text-matrix-purple" />آخر النشاط</PanelTitle>
              {activityError ? (
                <SectionError message="تعذر تحميل النشاط" onRetry={() => refetchActivity()} />
              ) : !activity ? (
                <div className="space-y-3 py-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton w-full h-11 rounded-lg" />)}</div>
              ) : activityItems.length === 0 ? (
                <p className="text-center text-sm text-matrix-subtle py-8">لا يوجد نشاط بعد</p>
              ) : (
                <div className="space-y-3">
                  {activityItems.map((log) => (
                    <div key={log.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-matrix-border">
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-matrix-cyan">{ACTION_LABEL[log.action] ?? log.action} — {log.entity}</p>
                        <p className="text-xs text-matrix-subtle mt-0.5 truncate">{log.user?.name ?? 'نظام'}</p>
                      </div>
                      <p className="text-[10px] font-mono text-matrix-subtle/60 shrink-0">{formatDateTime(log.created_at)}</p>
                    </div>
                  ))}
                  <Link href="/dashboard/activity" className="block text-center text-[11px] font-mono text-matrix-cyan hover:text-matrix-text transition-colors pt-1">
                    كل النشاط ←
                  </Link>
                </div>
              )}
            </motion.div>
          )}
        </div>
        )}
      </div>
    </DashboardLayout>
  );
}
