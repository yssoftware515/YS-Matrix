'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, ShieldAlert, KeyRound, UserX, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { adminApi, isApiRequestError, type Administrator, type AdminProfile } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

// Phase 2 (Delegated Platform Administrators): manage platform
// administrators. Creating one requires a GLOBAL-scope profile — the
// resulting user is a delegated platform admin (isPlatformAdmin).
// Delegated admins keep their legacy role envelope; the profile/scope
// is what grants them the /admin surface.

const EMPTY_FORM = { name: '', email: '', password: '', profile_id: '' };

export default function AdminAdministratorsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isActiveFilter, setIsActiveFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Administrator | null>(null);
  const [resetTarget, setResetTarget] = useState<Administrator | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editProfileId, setEditProfileId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-admins', { page, search, is_active: isActiveFilter }],
    queryFn: () => adminApi.getAdministrators({ page, limit: 15, search, is_active: isActiveFilter as 'true' | 'false' | '' }),
  });

  const { data: profilesData } = useQuery({
    queryKey: ['admin-profiles', 'select'],
    queryFn: () => adminApi.getProfiles({ page: 1, limit: 50, search: '' }),
  });
  const globalProfiles = (profilesData?.data || []).filter((p: AdminProfile) => p.scope === 'GLOBAL' && !p.is_system);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-admins'] });

  const createMut = useMutation({
    mutationFn: () => {
      const { name, email, password, profile_id } = form;
      return adminApi.createAdministrator({ name: name.trim(), email: email.trim(), password, profile_id });
    },
    onSuccess: () => { toast.success('تم إنشاء المشرف'); setAddOpen(false); setForm(EMPTY_FORM); invalidate(); },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل الإنشاء'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; is_active?: boolean; profile_id?: string } }) => adminApi.updateAdministrator(id, body),
    onSuccess: () => { toast.success('تم التحديث'); setEditTarget(null); invalidate(); },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل التحديث'),
  });

  const resetMut = useMutation({
    mutationFn: ({ id, new_password }: { id: string; new_password: string }) => adminApi.resetAdministratorPassword(id, new_password || undefined),
    onSuccess: (result) => {
      toast.success('تمت إعادة تعيين كلمة المرور');
      // eslint-disable-next-line no-alert
      if (result.temp_password) toast(`كلمة المرور المؤقتة: ${result.temp_password}`, { duration: 15000 });
      setResetTarget(null);
      invalidate();
    },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشل إعادة التعيين'),
  });

  const openEdit = (r: Administrator) => {
    setEditTarget(r);
    setEditProfileId(r.profile?.id ?? '');
  };

  const saveEdit = () => {
    if (!editTarget) return;
    const body: { name?: string; is_active?: boolean; profile_id?: string } = { name: editTarget?.name };
    if (editProfileId !== editTarget?.profile?.id) body.profile_id = editProfileId || undefined;
    updateMut.mutate({ id: editTarget.id, body });
  };

  const columns: Column<Administrator>[] = [
    { key: 'name', header: 'الاسم', render: (r) => <p className="font-semibold">{r.name}</p> },
    { key: 'email', header: 'البريد', render: (r) => <span className="text-xs font-mono text-matrix-subtle" dir="ltr">{r.email}</span> },
    { key: 'profile', header: 'الملف', render: (r) => r.profile ? <span className="badge-purple">{r.profile.name}</span> : <span className="text-xs text-matrix-subtle">—</span> },
    { key: 'is_active', header: 'الحالة', align: 'center', render: (r) => <span className={r.is_active ? 'badge-green' : 'badge-red'}>{r.is_active ? 'نشط' : 'معطل'}</span> },
    { key: 'last_login', header: 'آخر دخول', hideOnMobile: true, render: (r) => <span className="text-xs font-mono text-matrix-subtle">{r.last_login ? formatDate(r.last_login) : '—'}</span> },
    { key: 'actions', header: '', align: 'center', render: (r) => (
      <div className="flex items-center gap-2 justify-center">
        <button onClick={() => openEdit(r)} title="تعديل" className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-matrix-cyan/40 text-matrix-cyan hover:bg-matrix-cyan/10 transition-all"><Pencil className="w-3 h-3" />تعديل</button>
        <button onClick={() => setResetTarget(r)} title="إعادة تعيين كلمة المرور" className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-matrix-amber/40 text-matrix-amber hover:bg-matrix-amber/10 transition-all"><KeyRound className="w-3 h-3" />كلمة المرور</button>
        <button onClick={() => updateMut.mutate({ id: r.id, body: { is_active: !r.is_active } })} className={cn('flex items-center gap-1 px-2 py-1 rounded text-xs border transition-all', r.is_active ? 'border-matrix-red/40 text-matrix-red hover:bg-matrix-red/10' : 'border-matrix-green/40 text-matrix-green hover:bg-matrix-green/10')}>
          {r.is_active ? <><UserX className="w-3 h-3" />تعطيل</> : <><UserCheck className="w-3 h-3" />تفعيل</>}
        </button>
      </div>
    ) },
  ];

  return (
    <DashboardLayout title="المشرفون — منصة الإدارة">
      <div className="space-y-5">
        <div className="matrix-panel p-4 flex items-center gap-3 border border-matrix-amber/30 bg-matrix-amber/5">
          <ShieldAlert className="w-5 h-5 text-matrix-amber shrink-0" />
          <p className="text-sm text-matrix-subtle">
            المشرف المفوّض يُنشأ بعنوان بريد منفصل ويُربط بملف <span className="text-matrix-cyan">GLOBAL</span> غير نظامي — يصبح تلقائياً مسؤولاً على منصة الإدارة، ويحتفظ بنفس دوره السابق في معرضه.
          </p>
        </div>

        {/* filter bar: active/inactive */}
        <div className="flex flex-wrap gap-2">
          {[{ v: '', l: 'الكل' }, { v: 'true', l: 'نشط' }, { v: 'false', l: 'معطل' }].map(({ v, l }) => (
            <button key={v} onClick={() => { setIsActiveFilter(v); setPage(1); }}
              className={cn('px-3 py-1.5 rounded text-xs border transition-all', isActiveFilter === v ? 'border-matrix-cyan text-matrix-cyan bg-matrix-cyan/10' : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan/40')}>
              {l}
            </button>
          ))}
        </div>

        <DataTable data={data?.data || []} columns={columns} loading={isLoading} searchable searchPlaceholder="بحث بالاسم أو البريد..." onSearch={(q) => { setSearch(q); setPage(1); }} rowKey={(r) => r.id} emptyText="لا يوجد مشرفون"
          pagination={data?.pagination ? { page: data.pagination.page, pages: data.pagination.pages, total: data.pagination.total, limit: data.pagination.limit, onPage: setPage } : undefined}
          actions={<button onClick={() => { setForm(EMPTY_FORM); setAddOpen(true); }} className="btn-primary flex items-center gap-2 py-2"><Plus className="w-4 h-4" />مشرف جديد</button>} />

        {/* create */}
        <Modal open={addOpen} onClose={() => setAddOpen(false)} title="إنشاء مشرف جديد" size="md"
          footer={<><button onClick={() => setAddOpen(false)} className="btn-secondary py-2">إلغاء</button><button onClick={() => { if (!form.name || !form.email || !form.password || !form.profile_id) { toast.error('كل الحقول مطلوبة'); return; } createMut.mutate(); }} disabled={createMut.isPending} className="btn-primary py-2">إنشاء</button></>}>
          <div className="space-y-4">
            <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">الاسم *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="أحمد محمد" className="matrix-input" /></div>
            <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">البريد *</label>
              <input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@example.com" className="matrix-input" /></div>
            <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">كلمة المرور *</label>
              <input type="password" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" className="matrix-input" /></div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">ملف الصلاحية * (GLOBAL فقط)</label>
              <select value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })} className="matrix-input">
                <option value="">— اختر —</option>
                {globalProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.permissions.length} صلاحية)</option>)}
              </select>
              {globalProfiles.length === 0 && <p className="text-xs text-matrix-red mt-1">لا توجد ملفات GLOBAL غير نظامية — أنشئ واحدة من صفحة الصلاحيات أولاً.</p>}
            </div>
          </div>
        </Modal>

        {/* edit: name + profile */}
        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`تعديل — ${editTarget?.name ?? ''}`} size="md"
          footer={<><button onClick={() => setEditTarget(null)} className="btn-secondary py-2">إلغاء</button><button onClick={saveEdit} disabled={updateMut.isPending} className="btn-primary py-2">حفظ</button></>}>
          <div className="space-y-4">
            <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">الاسم</label>
              <input type="text" value={editTarget?.name ?? ''} onChange={(e) => setEditTarget(editTarget ? { ...editTarget, name: e.target.value } : editTarget)} className="matrix-input" /></div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">ملف الصلاحية</label>
              <select value={editProfileId} onChange={(e) => setEditProfileId(e.target.value)} className="matrix-input">
                <option value="">— بدون ملف —</option>
                {(profilesData?.data || []).filter((p) => p.scope === 'GLOBAL').map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_system ? ' (نظام)' : ''}</option>)}
              </select>
            </div>
          </div>
        </Modal>

        {/* reset password */}
        <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title={`إعادة تعيين كلمة المرور — ${resetTarget?.name ?? ''}`} size="md"
          footer={<><button onClick={() => setResetTarget(null)} className="btn-secondary py-2">إلغاء</button><button onClick={() => { const input = document.getElementById('admin-new-pw') as HTMLInputElement | null; resetMut.mutate({ id: resetTarget!.id, new_password: input?.value ?? '' }); }} disabled={resetMut.isPending} className="btn-primary py-2">إعادة التعيين</button></>}>
          <p className="text-sm text-matrix-subtle mb-3">اترك الحقل فارغاً لتوليد كلمة مرور مؤقتة، أو أدخل كلمة جديدة. سيتم إبطال كل جلسات المشرف الحالية فوراً.</p>
          <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">كلمة المرور الجديدة (اختياري)</label>
            <input id="admin-new-pw" type="password" dir="ltr" placeholder="••••••••" className="matrix-input" /></div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}