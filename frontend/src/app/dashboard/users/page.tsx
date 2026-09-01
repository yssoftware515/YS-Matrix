'use client';

// ============================================================
// YS-MATRIX ERP — Tenant Users (F4 — OWNER Staff Management)
// Route: /dashboard/users (OWNER only — middleware + backend)
//
// One canonical staff surface:
//   • list    — GET  /users                  (paginated, own tenant)
//   • create  — POST /users                  (reuses /auth/register)
//   • toggle  — PATCH /users/:id is_active   (deactivate/reactivate)
//
// Creation/limits flow through the SAME backend path as /auth/register
// (validateProfileAssignment → enforceUserLimit → email uniqueness), so
// this page can never drift from the auth rules. Deactivation kills the
// target's sessions immediately (server revokes refresh tokens).
// ============================================================

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Power, Loader2, Users as UsersIcon, ShieldCheck, ShieldOff, AlertTriangle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { usersApi, subscriptionApi, isApiRequestError, type TenantUser } from '@/lib/api';
import { useAuthStore } from '@/lib/auth';
import { cn, formatDate } from '@/lib/utils';

const INPUT_CLS =
  'matrix-input border-matrix-cyan/20 focus:border-matrix-cyan/40 transition-colors duration-200';

const roleLabel = (r: string) => (r === 'OWNER' ? 'صاحب المعرض' : 'موظف');

export default function TenantUsersPage() {
  const { user: me } = useAuthStore();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [toggleTarget, setToggleTarget] = useState<TenantUser | null>(null);

  const query = useQuery({
    queryKey: ['tenant-users', { page, role: roleFilter, is_active: statusFilter }],
    queryFn: () => usersApi.list({
      page,
      limit: 20,
      ...(roleFilter   ? { role: roleFilter as 'OWNER' | 'STAFF' } : {}),
      ...(statusFilter ? { is_active: statusFilter as 'true' | 'false' } : {}),
    }),
  });

  // Phase B.3 (F1): users vs users_limit comes from the PLAN via
  // /subscriptions/status (usage.users) — the same cache key the
  // dashboard/billing pages share, so this card never drifts from
  // what the owner sees on the billing page. `limit: null` = plan
  // is unlimited (no cap, no banner, no bar).
  const acctQuery = useQuery({
    queryKey: ['home-account-status'],
    queryFn: () => subscriptionApi.getStatus(),
  });
  const usage = acctQuery.data?.usage?.users ?? { limit: null, current: 0 };
  const atLimit = usage.limit !== null && usage.current >= usage.limit;
  const usagePct = usage.limit && usage.limit > 0 ? Math.min(100, Math.round((usage.current / usage.limit) * 100)) : 0;

  const users = useMemo(() => query.data?.data ?? [], [query.data?.data]);
  const meta = query.data?.pagination ?? { total: 0, page: 1, pages: 1, limit: 20 };

  // Backend has no `search` filter on /users — a light client-side
  // filter over the current page keeps the field honest.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, search]);

  const createMut = useMutation({
    mutationFn: (d: { name: string; email: string; password: string }) => usersApi.create(d),
    onSuccess: () => {
      toast.success('تم إنشاء المستخدم بنجاح');
      setCreateOpen(false);
      setForm({ name: '', email: '', password: '' });
      qc.invalidateQueries({ queryKey: ['tenant-users'] });
      qc.invalidateQueries({ queryKey: ['home-account-status'] });
    },
    onError: (err: unknown) => {
      if (isApiRequestError(err)) {
        toast.error(err.code === 'PLAN_LIMIT_REACHED' ? 'تم الوصول للحد الأقصى لعدد مستخدمي الباقة' : err.message);
      } else toast.error('فشل إنشاء المستخدم');
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => usersApi.toggle(id, is_active),
    onSuccess: (_, vars) => {
      toast.success(vars.is_active ? 'تم تفعيل المستخدم' : 'تم تعطيل المستخدم — سُحبت جلساته فوراً');
      setToggleTarget(null);
      qc.invalidateQueries({ queryKey: ['tenant-users'] });
      qc.invalidateQueries({ queryKey: ['billing-status'] });
      qc.invalidateQueries({ queryKey: ['home-account-status'] });
    },
    onError: (err: unknown) => {
      if (isApiRequestError(err)) toast.error(err.message);
      else toast.error('فشل تغيير حالة المستخدم');
    },
  });

  const stats = useMemo(() => {
    const active = users.filter((u) => u.is_active).length;
    return { total: meta.total ?? 0, active, inactive: (meta.total ?? 0) - active };
  }, [users, meta.total]);

  const handleCreate = () => {
    if (!form.name.trim()) return toast.error('الاسم مطلوب');
    if (!form.email.trim()) return toast.error('البريد الإلكتروني مطلوب');
    if (form.password.length < 8) return toast.error('كلمة المرور 8 أحرف على الأقل');
    createMut.mutate({ name: form.name.trim(), email: form.email.trim(), password: form.password });
  };

  const columns: Column<TenantUser>[] = [
    {
      key: 'name',
      header: 'الاسم',
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-matrix-cyan/30 bg-matrix-cyan/10 text-matrix-cyan text-xs font-bold shrink-0">
            {u.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-matrix-text truncate">{u.name}</p>
            {u.id === me?.id && <p className="text-[10px] font-mono text-matrix-cyan/70">أنت</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'البريد الإلكتروني',
      render: (u) => <span className="text-xs font-mono text-matrix-subtle" dir="ltr">{u.email}</span>,
      hideOnMobile: true,
    },
    {
      key: 'role',
      header: 'الصلاحية',
      render: (u) => (
        <span className={cn('badge', u.role === 'OWNER' ? 'badge-purple' : 'badge-cyan')}>
          {roleLabel(u.role)}
        </span>
      ),
    },
    {
      key: 'is_active',
      header: 'الحالة',
      render: (u) => (
        <span className={cn('badge', u.is_active ? 'badge-green' : 'badge-red')}>
          {u.is_active ? 'نشط' : 'معطل'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'تاريخ الإنشاء',
      render: (u) => <span className="text-xs font-mono text-matrix-subtle">{formatDate(u.created_at)}</span>,
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: '',
      align: 'left',
      render: (u) => {
        if (u.role !== 'STAFF') return null;
        return (
          <button
            onClick={() => setToggleTarget(u)}
            disabled={toggleMut.isPending}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all',
              u.is_active
                ? 'border-matrix-red/25 bg-matrix-red/5 text-matrix-red hover:bg-matrix-red/10 hover:border-matrix-red/50'
                : 'border-matrix-green/25 bg-matrix-green/5 text-matrix-green hover:bg-matrix-green/10 hover:border-matrix-green/50'
            )}
          >
            {u.is_active ? <Power className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
            {u.is_active ? 'تعطيل' : 'تفعيل'}
          </button>
        );
      },
    },
  ];

  return (
    <DashboardLayout title="المستخدمون">
      <div className="space-y-5">
        {/* ── Stats ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { label: 'إجمالي المستخدمين', value: stats.total, color: 'text-matrix-cyan', icon: UsersIcon },
            { label: 'نشطون',             value: stats.active, color: 'text-matrix-green', icon: ShieldCheck },
            { label: 'معطلون',            value: stats.inactive, color: 'text-matrix-red', icon: ShieldOff },
          ].map((s) => (
            <div key={s.label} className="matrix-panel p-4 flex items-center gap-3">
              <s.icon className={cn('w-5 h-5 shrink-0', s.color)} />
              <div>
                <p className="font-display text-xl font-bold text-matrix-text">{s.value}</p>
                <p className="text-[11px] font-mono text-matrix-subtle">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Plan usage: users vs users_limit (B3 F1) ────── */}
        <div className="matrix-panel p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-mono text-matrix-subtle">مستخدمون من خطة الاشتراك</p>
            <p className="text-xs font-mono text-matrix-cyan">
              {usage.limit === null ? `${usage.current} · غير محدود` : `${usage.current} / ${usage.limit}`}
            </p>
          </div>
          {usage.limit !== null && (
            <div className="h-1.5 rounded-full bg-matrix-border/60 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500', atLimit ? 'bg-matrix-red' : usagePct >= 80 ? 'bg-matrix-amber' : 'bg-matrix-cyan')}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          )}
          {atLimit && (
            <div className="mt-3 flex items-center gap-2 p-3 rounded-lg border border-matrix-red/30 bg-matrix-red/5">
              <AlertTriangle className="w-4 h-4 text-matrix-red shrink-0" />
              <p className="text-[11px] text-matrix-red leading-relaxed">
                وصلت لعدد المستخدمين الأقصى في باقتك الحالية ({usage.limit}).
                {' '}<span className="font-mono">قيّد أو عطّل</span> مستخدماً لإفساح مساحة، أو قم بترقية الباقة من صفحة
                {' '}<a href="/dashboard/billing" className="underline hover:text-matrix-red/80">الاشتراك والفوترة</a>.
              </p>
            </div>
          )}
        </div>

        {/* ── Filters + create ──────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            className={cn(INPUT_CLS, 'w-40')}
          >
            <option value="">كل الصلاحيات</option>
            <option value="OWNER">صاحب المعرض</option>
            <option value="STAFF">موظف</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className={cn(INPUT_CLS, 'w-36')}
          >
            <option value="">كل الحالات</option>
            <option value="true">نشط</option>
            <option value="false">معطل</option>
          </select>
          <button
            onClick={() => setCreateOpen(true)}
            disabled={atLimit}
            title={atLimit ? 'تم الوصول للحد الأقصى للمستخدمين في باقتك' : undefined}
            className={cn(
              'mr-auto flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-mono transition-all',
              atLimit
                ? 'border-matrix-border text-matrix-subtle/40 cursor-not-allowed'
                : 'border-matrix-cyan/30 bg-matrix-cyan/10 text-matrix-cyan hover:bg-matrix-cyan/15'
            )}
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة موظف
          </button>
        </div>

        {/* ── Query error state (B3 F1) ────────────────────── */}
        {query.isError ? (
          <div className="matrix-panel p-8 flex flex-col items-center justify-center text-center">
            <AlertTriangle className="w-10 h-10 text-matrix-red mb-3 opacity-80" />
            <p className="text-sm text-matrix-text mb-1">تعذر تحميل قائمة المستخدمين</p>
            <p className="text-xs text-matrix-subtle mb-4">تحقق من اتصالك ثم أعد المحاولة — لم تُجرَ أي تغييرات.</p>
            <button
              onClick={() => query.refetch()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-matrix-cyan/30 text-matrix-cyan hover:bg-matrix-cyan/10 transition-all text-xs font-mono"
            >
              <Loader2 className={cn('w-3.5 h-3.5', query.isFetching && 'animate-spin')} />
              إعادة المحاولة
            </button>
          </div>
        ) : query.isLoading ? (
          <DataTable<TenantUser>
            data={[]}
            columns={columns}
            loading
            rowKey={(u) => u.id}
          />
        ) : meta.total === 0 && !roleFilter && !statusFilter ? (
          /* ── First-run empty state (B3 F9): what / why / next ── */
          <div className="matrix-panel p-10 flex flex-col items-center justify-center text-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-xl border border-matrix-cyan/30 bg-matrix-cyan/10 mb-4">
              <UsersIcon className="w-7 h-7 text-matrix-cyan" />
            </div>
            <p className="font-display text-base font-semibold text-matrix-text mb-1">لم تتم إضافة موظفين بعد</p>
            <p className="text-xs text-matrix-subtle leading-relaxed max-w-sm mb-5">
              حسابات الفريق تتيح لموظفيك الدخول وإدارة المخزون والمبيعات بصلاحيات
              منفصلة ومراجعة كاملة — أنشئ أول موظف ليتسلم مهامه.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              disabled={atLimit}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono transition-all',
                atLimit
                  ? 'border border-matrix-border text-matrix-subtle/40 cursor-not-allowed'
                  : 'bg-matrix-cyan/80 hover:bg-matrix-cyan text-matrix-black'
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              إضافة أول موظف
            </button>
          </div>
        ) : (
          <DataTable<TenantUser>
          data={filtered}
          columns={columns}
          loading={query.isLoading}
          rowKey={(u) => u.id}
          emptyText="لا يوجد مستخدمون"
          searchable
          searchPlaceholder="بحث بالاسم أو البريد..."
          onSearch={(q) => { setSearch(q); setPage(1); }}
          pagination={{
            page: meta.page,
            pages: meta.pages,
            total: meta.total,
            limit: meta.limit,
            onPage: setPage,
          }}
        />
        )}

        {/* ── Create modal ──────────────────────────────────── */}
        <Modal
          open={createOpen}
          onClose={() => { setCreateOpen(false); setForm({ name: '', email: '', password: '' }); }}
          title="إضافة موظف"
          size="sm"
          footer={
            <>
              <button
                onClick={() => { setCreateOpen(false); setForm({ name: '', email: '', password: '' }); }}
                disabled={createMut.isPending}
                className="px-4 py-2 rounded-lg border border-matrix-border text-matrix-subtle hover:text-matrix-text transition-all text-xs font-mono"
              >
                تراجع
              </button>
              <button
                onClick={handleCreate}
                disabled={createMut.isPending}
                className="px-4 py-2 rounded-lg bg-matrix-cyan/80 hover:bg-matrix-cyan text-matrix-black font-mono text-xs transition-all flex items-center gap-1.5"
              >
                {createMut.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                إنشاء الموظف
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-mono text-matrix-subtle mb-1">الاسم *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="اسم الموظف"
                className={cn(INPUT_CLS, 'w-full')}
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-matrix-subtle mb-1">البريد الإلكتروني *</label>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="employee@showroom.com"
                dir="ltr"
                className={cn(INPUT_CLS, 'w-full')}
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-matrix-subtle mb-1">كلمة المرور *</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="8 أحرف على الأقل"
                className={cn(INPUT_CLS, 'w-full')}
              />
            </div>
            <p className="text-[11px] text-matrix-subtle leading-relaxed">
              تُنشأ الحسابات بصلاحية <span className="font-mono text-matrix-cyan">STAFF</span> عبر نفس
              مسار التسجيل الرسمي — الصلاحية الأعلى (OWNER) غير متاحة من هذا المسار لأسباب أمنية.
            </p>
          </div>
        </Modal>

        {/* ── Toggle confirm modal ──────────────────────────── */}
        <Modal
          open={toggleTarget !== null}
          onClose={() => setToggleTarget(null)}
          title={toggleTarget?.is_active ? 'تعطيل الموظف' : 'تفعيل الموظف'}
          size="sm"
          footer={
            <>
              <button
                onClick={() => setToggleTarget(null)}
                disabled={toggleMut.isPending}
                className="px-4 py-2 rounded-lg border border-matrix-border text-matrix-subtle hover:text-matrix-text transition-all text-xs font-mono"
              >
                تراجع
              </button>
              <button
                onClick={() => toggleTarget && toggleMut.mutate({ id: toggleTarget.id, is_active: !toggleTarget.is_active })}
                disabled={toggleMut.isPending}
                className={cn(
                  'px-4 py-2 rounded-lg font-mono text-xs transition-all flex items-center gap-1.5',
                  toggleTarget?.is_active
                    ? 'bg-matrix-red/80 hover:bg-matrix-red text-matrix-black'
                    : 'bg-matrix-green/80 hover:bg-matrix-green text-matrix-black'
                )}
              >
                {toggleMut.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                {toggleTarget?.is_active ? 'نعم، تعطيل' : 'نعم، تفعيل'}
              </button>
            </>
          }
        >
          <p className="text-xs text-matrix-text leading-relaxed">
            {toggleTarget?.is_active ? (
              <>
                سيتم تعطيل حساب <span className="font-mono text-matrix-amber">{toggleTarget?.name}</span> —
                سُحب جميع جلساته فوراً ولن يتمكن من تسجيل الدخول حتى إعادة التفعيل.
              </>
            ) : (
              <>
                سيتم إعادة تفعيل حساب <span className="font-mono text-matrix-amber">{toggleTarget?.name}</span>.
                تُعاد مراجعة الحد الأقصى للمستخدمين قبل التفعيل.
              </>
            )}
          </p>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
