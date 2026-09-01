'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Shield, CheckCircle, XCircle, LogIn, BarChart3, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { showroomsApi, superAdminApi, isApiRequestError, type Showroom } from '@/lib/api';
import { useAuthStore } from '@/lib/auth';
import { formatCurrency, formatDate, daysUntil, cn } from '@/lib/utils';

const EMPTY_FORM = {
  name: '', slug: '', address: '', phone: '', email: '', license_expiry: '',
  owner_name: '', owner_email: '', owner_password: '',
};

export default function ShowroomsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const startImpersonation = useAuthStore((s) => s.startImpersonation);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  // FP-06: fetched ON DEMAND per showroom (not upfront for the whole
  // list) — getShowroomStats does aggregate queries across inventory/
  // sales/users for one showroom; calling it for every row in a
  // paginated list would be an N+1 request burst for data most of
  // which never gets looked at.
  const [statsShowroomId, setStatsShowroomId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['showrooms', { page, search }], queryFn: () => showroomsApi.getAll({ page, limit: 15, search }) });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['showroom-stats', statsShowroomId],
    queryFn:  () => showroomsApi.getStats(statsShowroomId as string),
    enabled:  !!statsShowroomId,
  });

  const createMut = useMutation({
     mutationFn: (payload: Record<string, unknown>) => showroomsApi.create(payload),
    onSuccess: () => { toast.success('تم إنشاء المعرض وحساب المدير'); qc.invalidateQueries({ queryKey: ['showrooms'] }); setAddOpen(false); setForm(EMPTY_FORM); },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل الإنشاء'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => showroomsApi.update(id, { is_active }),
    onSuccess: () => { toast.success('تم التحديث'); qc.invalidateQueries({ queryKey: ['showrooms'] }); },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل التحديث'),
  });

  // Matrix Audit (#9 — Impersonation): stashes the SuperAdmin's own
  // session (via startImpersonation) then navigates into the target
  // showroom's dashboard AS its OWNER. No page reload needed — the
  // Zustand store + localStorage tokens are swapped in-memory first.
  const impersonateMut = useMutation({
    mutationFn: (id: string) => superAdminApi.impersonateShowroom(id),
    onSuccess: (result) => {
      startImpersonation(
        {
          id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role,
          showroom: { ...result.showroom, logo_url: result.showroom.logo_url ?? undefined },
        },
        result.accessToken
      );
      toast.success(`تم الدخول كـ ${result.showroom.name}`);
      router.push('/dashboard');
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل الدخول للمعرض'),
  });

  const columns: Column<Showroom>[] = [
    { key: 'name', header: 'اسم المعرض', render: (r) => <div><p className="font-semibold">{r.name}</p><p className="text-xs text-matrix-subtle font-mono">{r.slug}</p></div> },
    { key: 'phone', header: 'الهاتف', render: (r) => <span className="text-xs font-mono text-matrix-subtle">{r.phone || '—'}</span> },
    { key: 'license_expiry', header: 'انتهاء الترخيص', render: (r) => { const d = daysUntil(r.license_expiry); return <div><p className={cn('text-xs font-mono', d <= 0 ? 'text-matrix-red' : d <= 7 ? 'text-matrix-amber' : 'text-matrix-subtle')}>{formatDate(r.license_expiry)}</p><p className={cn('text-xs', d <= 0 ? 'text-matrix-red' : 'text-matrix-subtle')}>{d <= 0 ? 'منتهي' : `${d} يوم متبقي`}</p></div>; } },
    { key: 'is_active', header: 'الحالة', align: 'center', render: (r) => <span className={r.is_active ? 'badge-green' : 'badge-red'}>{r.is_active ? 'نشط' : 'معطل'}</span> },
    { key: 'stats', header: 'الإحصائيات', hideOnMobile: true, render: (r) => <div className="flex gap-2 text-xs font-mono"><span className="text-matrix-cyan">{r._count?.users || 0} مستخدم</span><span className="text-matrix-subtle">•</span><span className="text-matrix-green">{r._count?.sales || 0} بيع</span></div> },
    { key: 'actions', header: '', align: 'center', render: (r) => (
      <div className="flex items-center gap-2 justify-center">
        <button
          onClick={() => setStatsShowroomId(r.id)}
          title="عرض التفاصيل الكاملة"
          className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-matrix-purple/40 text-matrix-purple hover:bg-matrix-purple/10 transition-all"
        >
          <BarChart3 className="w-3 h-3" />تفاصيل
        </button>
        <button
          onClick={() => impersonateMut.mutate(r.id)}
          disabled={!r.is_active || impersonateMut.isPending}
          title={r.is_active ? 'دخول المعرض كمديره' : 'المعرض معطل'}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-matrix-cyan/40 text-matrix-cyan hover:bg-matrix-cyan/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <LogIn className="w-3 h-3" />دخول
        </button>
        <button onClick={() => toggleMut.mutate({ id: r.id, is_active: !r.is_active })} className={cn('flex items-center gap-1 px-2 py-1 rounded text-xs border transition-all', r.is_active ? 'border-matrix-red/40 text-matrix-red hover:bg-matrix-red/10' : 'border-matrix-green/40 text-matrix-green hover:bg-matrix-green/10')}>{r.is_active ? <><XCircle className="w-3 h-3" />تعطيل</> : <><CheckCircle className="w-3 h-3" />تفعيل</>}</button>
      </div>
    ) },
  ];

  return (
    <DashboardLayout title="إدارة المعارض">
      <div className="space-y-5">
        <div className="matrix-panel p-4 flex items-center gap-3 border border-matrix-purple/30 bg-matrix-purple/5">
          <Shield className="w-5 h-5 text-matrix-purple shrink-0" />
          <p className="text-sm text-matrix-subtle">هذه الصفحة متاحة لمدير النظام فقط.</p>
        </div>

        <DataTable data={data?.data || []} columns={columns} loading={isLoading} searchable searchPlaceholder="بحث بالاسم..." onSearch={(q) => { setSearch(q); setPage(1); }} rowKey={(r) => r.id} emptyText="لا توجد معارض"
          pagination={data?.pagination ? { page: data.pagination.page, pages: data.pagination.pages, total: data.pagination.total, limit: data.pagination.limit, onPage: setPage } : undefined}
          actions={<button onClick={() => setAddOpen(true)} className="btn-primary flex items-center gap-2 py-2"><Plus className="w-4 h-4" />معرض جديد</button>} />

        <Modal open={addOpen} onClose={() => setAddOpen(false)} title="إنشاء معرض جديد" size="md"
          footer={<><button onClick={() => setAddOpen(false)} className="btn-secondary py-2">إلغاء</button><button onClick={() => { if (!form.name || !form.slug || !form.license_expiry || !form.owner_name || !form.owner_email || !form.owner_password) { toast.error('الاسم والـ Slug والترخيص وبيانات المدير كلها مطلوبة'); return; } createMut.mutate(form); }} disabled={createMut.isPending} className="btn-primary py-2">إنشاء</button></>}>
          <div className="space-y-4">
            {[{ k: 'name', l: 'اسم المعرض *', p: 'معرض النجمة', ltr: false }, { k: 'slug', l: 'Slug *', p: 'alnajma', ltr: true }, { k: 'phone', l: 'الهاتف', p: '+967...', ltr: true }, { k: 'email', l: 'البريد', p: 'info@showroom.com', ltr: true }, { k: 'address', l: 'العنوان', p: 'صنعاء', ltr: false }].map(({ k, l, p, ltr }) => (
              <div key={k}><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">{l}</label><input type="text" value={(form as Record<string,string>)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={p} className="matrix-input" dir={ltr ? 'ltr' : 'rtl'} /></div>
            ))}
            <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">تاريخ انتهاء الترخيص *</label><input type="date" value={form.license_expiry} onChange={(e) => setForm({ ...form, license_expiry: e.target.value })} className="matrix-input" dir="ltr" /></div>

            <div className="border-t border-matrix-border pt-3 mt-1">
              <p className="text-xs font-mono uppercase tracking-widest text-matrix-cyan mb-3">بيانات مدير المعرض (OWNER)</p>
            </div>
            {[{ k: 'owner_name', l: 'اسم المدير *', p: 'محمد أحمد', ltr: false }, { k: 'owner_email', l: 'بريد المدير *', p: 'owner@showroom.com', ltr: true }].map(({ k, l, p, ltr }) => (
              <div key={k}><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">{l}</label><input type="text" value={(form as Record<string,string>)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={p} className="matrix-input" dir={ltr ? 'ltr' : 'rtl'} /></div>
            ))}
            <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">كلمة مرور المدير *</label><input type="password" value={form.owner_password} onChange={(e) => setForm({ ...form, owner_password: e.target.value })} placeholder="••••••••" className="matrix-input" dir="ltr" /></div>
          </div>
        </Modal>

        {/* FP-06: getShowroomStats was defined on the backend with no
            frontend caller anywhere — SuperAdmin had no way to see
            revenue/profit per showroom, only the row-level user/sale
            counts already on the list. */}
        <Modal
          open={!!statsShowroomId}
          onClose={() => setStatsShowroomId(null)}
          title={statsData ? `تفاصيل — ${statsData.showroom.name}` : 'تفاصيل المعرض'}
          size="md"
        >
          {statsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-matrix-cyan animate-spin" />
            </div>
          ) : statsData ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                ['المستخدمون',      statsData.stats.users,                         'text-matrix-cyan'],
                ['المخزون',         statsData.stats.inventory,                     'text-matrix-amber'],
                ['المبيعات',        statsData.stats.sales,                         'text-matrix-green'],
                ['إجمالي الإيرادات', formatCurrency(statsData.stats.total_revenue), 'text-matrix-green'],
                ['إجمالي الربح',    formatCurrency(statsData.stats.total_profit),  'text-matrix-cyan'],
                ['انتهاء الترخيص',  formatDate(statsData.showroom.license_expiry), daysUntil(statsData.showroom.license_expiry) <= 7 ? 'text-matrix-red' : 'text-matrix-subtle'],
              ].map(([label, value, colorClass]) => (
                <div key={label as string} className="p-3 rounded-lg border border-matrix-border bg-matrix-dark">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-matrix-subtle mb-1">{label}</p>
                  <p className={cn('font-mono text-sm font-bold', colorClass as string)}>{value}</p>
                </div>
              ))}
            </div>
          ) : null}
        </Modal>
      </div>
    </DashboardLayout>
  );
}
