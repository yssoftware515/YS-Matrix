'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, KeyRound, Trash2, Pencil, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { adminApi, isApiRequestError, type AdminProfile, type PlatformGrant } from '@/lib/api';
import { cn } from '@/lib/utils';

// Phase 2 (Delegated Platform Administrators): profile CRUD. The grant
// editor mirrors the backend permissionCatalog — each row is
// permission × scope. SHOWROOM grants are usable by admins to operate
// inside showrooms; GLOBAL grants are what elevate a delegated admin
// to platform-administrator status (isPlatformAdmin checks scope).

// Canonical platform permissions — kept in sync with
// backend/src/services/permissionCatalog.js (platform_* keys).
const PLATFORM_PERMS = [
  { key: 'platform_profile:read',   label: 'قراءة الصلاحيات' },
  { key: 'platform_profile:create', label: 'إنشاء صلاحيات' },
  { key: 'platform_profile:update', label: 'تعديل صلاحيات' },
  { key: 'platform_profile:delete', label: 'حذف صلاحيات' },
  { key: 'platform_admin:read',     label: 'قراءة المشرفين' },
  { key: 'platform_admin:create',   label: 'إنشاء مشرفين' },
  { key: 'platform_admin:update',   label: 'تعديل المشرفين' },
  { key: 'platform_user:read',      label: 'قراءة المستخدمين' },
  { key: 'platform_showroom:read',  label: 'قراءة المعارض' },
] as const;

type GrantMap = Record<string, 'SHOWROOM' | 'GLOBAL' | null>;

function grantsToMap(grants: PlatformGrant[]): GrantMap {
  const map: GrantMap = {};
  for (const g of grants) map[g.permission] = g.scope;
  return map;
}

function mapToGrants(map: GrantMap): PlatformGrant[] {
  return Object.entries(map)
    .filter(([, scope]) => scope !== null)
    .map(([permission, scope]) => ({ permission, scope: scope as 'SHOWROOM' | 'GLOBAL' }));
}

const EMPTY_FORM = { name: '', description: '', scope: 'SHOWROOM' as 'SHOWROOM' | 'GLOBAL', grants: {} as GrantMap };

export default function AdminProfilesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<AdminProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminProfile | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-profiles', { page, search }],
    queryFn: () => adminApi.getProfiles({ page, limit: 15, search }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-profiles'] });

  const mutate = useMutation({
    mutationFn: (payload: { id?: string; name: string; description: string; scope: 'SHOWROOM' | 'GLOBAL'; grants: PlatformGrant[] }) => {
      if (payload.id) {
        const original = editProfile;
        const originalMap = original ? grantsToMap(original.permissions) : {};
        const nextMap = grantsToMap(payload.grants);
        // backend updateProfile matches deltas as `permission@scope`
        // pairs (admin.controller.js): granted adds records, revoked
        // removes them. A scope change therefore needs the OLD pair
        // revoked AND the NEW pair granted — otherwise both scope
        // records survive and the grant becomes ambiguous.
        const granted: PlatformGrant[] = [];
        const revoked: PlatformGrant[] = [];
        for (const [k, scope] of Object.entries(nextMap)) {
          const prev = originalMap[k];
          if (scope === null) {
            if (prev !== null && prev !== undefined) revoked.push({ permission: k, scope: prev });
          } else if (prev !== scope) {
            if (prev !== null && prev !== undefined) revoked.push({ permission: k, scope: prev });
            granted.push({ permission: k, scope });
          }
        }
        return adminApi.updateProfile(payload.id, { name: payload.name, description: payload.description || null, scope: payload.scope, granted, revoked });
      }
      return adminApi.createProfile({ name: payload.name, description: payload.description || null, scope: payload.scope, permissions: payload.grants });
    },
    onSuccess: () => { toast.success(editProfile ? 'تم تحديث الصلاحية' : 'تم إنشاء الصلاحية'); setAddOpen(false); setEditProfile(null); setForm(EMPTY_FORM); invalidate(); },
    onError: (e: unknown) => toast.error(isApiRequestError(e) ? e.message : 'فشلت العملية'),
  });

  const deleteMut = useMutation({
    mutationFn: () => adminApi.deleteProfile(deleteTarget!.id),
    onSuccess: () => { toast.success('تم الحذف'); setDeleteTarget(null); invalidate(); },
    onError: (e: unknown) => { toast.error(isApiRequestError(e) ? e.message : 'فشل الحذف'); setDeleteTarget(null); },
  });

  const openEdit = (p: AdminProfile) => {
    setEditProfile(p);
    setForm({ name: p.name, description: p.description ?? '', scope: p.scope, grants: grantsToMap(p.permissions) });
    setAddOpen(true);
  };

  const toggleGrant = (key: string, enabled: boolean) =>
    setForm((f) => ({ ...f, grants: { ...f.grants, [key]: enabled ? (f.scope) : null } }));

  const setGrantScope = (key: string, scope: 'SHOWROOM' | 'GLOBAL') =>
    setForm((f) => ({ ...f, grants: { ...f.grants, [key]: scope } }));

  const save = () => {
    if (!form.name.trim()) { toast.error('الاسم مطلوب'); return; }
    mutate.mutate({ id: editProfile?.id, name: form.name.trim(), description: form.description, scope: form.scope, grants: mapToGrants(form.grants) });
  };

  const columns: Column<AdminProfile>[] = [
    { key: 'name', header: 'الاسم', render: (r) => (
      <div className="flex items-center gap-2">
        <p className="font-semibold">{r.name}</p>
        {r.is_system && <span className="badge-purple">نظام</span>}
      </div>
    ) },
    { key: 'description', header: 'الوصف', hideOnMobile: true, render: (r) => <span className="text-xs text-matrix-subtle">{r.description || '—'}</span> },
    { key: 'scope', header: 'النطاق', align: 'center', render: (r) => <span className={r.scope === 'GLOBAL' ? 'badge-cyan' : 'badge-amber'}>{r.scope === 'GLOBAL' ? 'خارجي (GLOBAL)' : 'معرض (SHOWROOM)'}</span> },
    { key: 'grants', header: 'الصلاحيات', align: 'center', render: (r) => <span className="text-xs font-mono text-matrix-subtle">{r.permissions.length} من {r.scope}</span> },
    { key: 'in_use', header: 'المستخدمون', align: 'center', render: (r) => <span className="font-mono text-xs text-matrix-subtle">{r.in_use}</span> },
    { key: 'actions', header: '', align: 'center', render: (r) => (
      <div className="flex items-center gap-2 justify-center">
        {!r.is_system && (
          <button onClick={() => openEdit(r)} title="تعديل" className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-matrix-cyan/40 text-matrix-cyan hover:bg-matrix-cyan/10 transition-all"><Pencil className="w-3 h-3" />تعديل</button>
        )}
        {!r.is_system && (
          <button onClick={() => setDeleteTarget(r)} title="حذف" className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-matrix-red/40 text-matrix-red hover:bg-matrix-red/10 transition-all"><Trash2 className="w-3 h-3" />حذف</button>
        )}
        {r.is_system && <span className="text-xs text-matrix-subtle">محمي</span>}
      </div>
    ) },
  ];

  return (
    <DashboardLayout title="الصلاحيات — منصة الإدارة">
      <div className="space-y-5">
        <div className="matrix-panel p-4 flex items-center gap-3 border border-matrix-cyan/30 bg-matrix-cyan/5">
          <ShieldCheck className="w-5 h-5 text-matrix-cyan shrink-0" />
          <p className="text-sm text-matrix-subtle">
            ملفات الصلاحيات تُقسم إلى نطاق <span className="text-matrix-cyan">GLOBAL</span> (يُعطي صاحبه وصولاً لمنصة الإدارة) ونطاق <span className="text-matrix-amber">SHOWROOM</span> (عمل داخل معرض محدد).
          </p>
        </div>

        <DataTable data={data?.data || []} columns={columns} loading={isLoading} searchable searchPlaceholder="بحث..." onSearch={(q) => { setSearch(q); setPage(1); }} rowKey={(r) => r.id} emptyText="لا توجد ملفات صلاحيات"
          pagination={data?.pagination ? { page: data.pagination.page, pages: data.pagination.pages, total: data.pagination.total, limit: data.pagination.limit, onPage: setPage } : undefined}
          actions={<button onClick={() => { setEditProfile(null); setForm(EMPTY_FORM); setAddOpen(true); }} className="btn-primary flex items-center gap-2 py-2"><Plus className="w-4 h-4" />صلاحية جديدة</button>} />

        <Modal open={addOpen} onClose={() => { setAddOpen(false); setEditProfile(null); }} title={editProfile ? 'تعديل الصلاحية' : 'إنشاء صلاحية جديدة'} size="lg"
          footer={<><button onClick={() => { setAddOpen(false); setEditProfile(null); }} className="btn-secondary py-2">إلغاء</button><button onClick={save} disabled={mutate.isPending} className="btn-primary py-2">{editProfile ? 'حفظ' : 'إنشاء'}</button></>}>
          <div className="space-y-4">
            <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">الاسم *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مسؤول عمليات" className="matrix-input" /></div>
            <div><label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">الوصف</label>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="وصف مختصر للدور..." className="matrix-input" /></div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-2">النطاق *</label>
              <div className="flex gap-2">
                {(['SHOWROOM', 'GLOBAL'] as const).map((s) => (
                  <button key={s} onClick={() => { setForm({ ...form, scope: s, grants: Object.fromEntries(Object.entries(form.grants).map(([k, v]) => [k, v === null ? null : s])) }); }}
                    className={cn('flex-1 px-3 py-2 rounded text-xs border transition-all', form.scope === s ? (s === 'GLOBAL' ? 'border-matrix-cyan text-matrix-cyan bg-matrix-cyan/10' : 'border-matrix-amber text-matrix-amber bg-matrix-amber/10') : 'border-matrix-border text-matrix-subtle')}>
                    {s === 'GLOBAL' ? 'خارجي — كل المنصة (GLOBAL)' : 'معرض واحد (SHOWROOM)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-matrix-border pt-3">
              <p className="text-xs font-mono uppercase tracking-widest text-matrix-cyan mb-2">الصلاحيات ({PLATFORM_PERMS.filter((p) => form.grants[p.key]).length} مفعّلة)</p>
              <div className="space-y-2">
                {PLATFORM_PERMS.map((p) => {
                  const scope = form.grants[p.key];
                  return (
                    <div key={p.key} className="flex items-center justify-between gap-3 p-2 rounded border border-matrix-border bg-matrix-dark">
                      <label className="flex items-center gap-2 text-sm cursor-pointer flex-1 min-w-0">
                        <input type="checkbox" checked={scope !== null} onChange={(e) => toggleGrant(p.key, e.target.checked)} className="accent-matrix-cyan" />
                        <span className="truncate">{p.label}</span>
                        <span className="text-[10px] font-mono text-matrix-subtle shrink-0" dir="ltr">{p.key}</span>
                      </label>
                      <select
                        value={scope ?? ''}
                        disabled={scope === null}
                        onChange={(e) => setGrantScope(p.key, e.target.value as 'SHOWROOM' | 'GLOBAL')}
                        className={cn('text-xs rounded border bg-matrix-black px-2 py-1', scope === 'GLOBAL' ? 'border-matrix-cyan text-matrix-cyan' : scope === 'SHOWROOM' ? 'border-matrix-amber text-matrix-amber' : 'border-matrix-border text-matrix-subtle opacity-50')}>
                        <option value="" disabled>غير مفعّل</option>
                        <option value="SHOWROOM">معرض</option>
                        <option value="GLOBAL">الكل</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>

        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="حذف الصلاحية" size="sm"
          footer={<><button onClick={() => setDeleteTarget(null)} className="btn-secondary py-2">إلغاء</button><button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="btn-danger py-2 flex items-center gap-1"><KeyRound className="w-3 h-3" />حذف</button></>}>
          <p className="text-sm text-matrix-subtle">سيتم حذف الصلاحية <span className="text-matrix-red font-semibold">{deleteTarget?.name}</span>. لا يمكن الحذف إن كانت مستخدمة من أي مشرف.</p>
        </Modal>
      </div>
    </DashboardLayout>
  );
}