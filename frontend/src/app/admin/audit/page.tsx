'use client';

// ============================================================
// YS-MATRIX ERP — Platform Audit Logs Page (Phase 3)
// Route: /admin/audit
//
// Platform-wide audit trail (all showrooms) behind the GLOBAL-scope
// /api/v1/admin/audit/* endpoints + platform_audit:read. Redaction
// is applied SERVER-SIDE for delegated viewers — this page only
// renders whatever the API returns (no client-side masking, the
// backend remains authoritative).
// ============================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, RefreshCw, Eye, ShieldAlert } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { adminApi, type AuditEvent } from '@/lib/api';
import { formatDateTime, cn } from '@/lib/utils';

const ACTION_STYLE: Record<string, string> = {
  LOGIN_FAILED:        'badge-red',
  AUTHZ_DENIED:        'badge-red',
  CROSS_TENANT_BLOCKED:'badge-red',
  AUTHZ_ESCALATION_ATTEMPT: 'badge-red',
  ADMIN_ENABLED:       'badge-green',
  ADMIN_DISABLED:      'badge-red',
  IMPERSONATE_SHOWROOM:'badge-purple',
  LOGIN:               'badge-purple',
  LOGOUT:              'badge-purple',
};

function actionBadge(action: string) {
  return (
    <span className={cn(ACTION_STYLE[action] ?? 'badge-cyan')}>
      {action}
    </span>
  );
}

function EventDetailModal({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const showRaw = (label: string, value: unknown) => (
    <div className="mt-3">
      <p className="text-[10px] font-mono text-matrix-subtle mb-1">{label}</p>
      <pre className="text-[10px] font-mono text-matrix-subtle/80 bg-matrix-dark/60 rounded p-2 overflow-auto max-h-56 whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );

  const imp = event?.new_data?.impersonated_by as { email?: string; user_id?: string } | undefined;

  return (
    <Modal open={!!event} onClose={onClose} title="تفاصيل حدث التدقيق" size="xl">
      {event && (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {actionBadge(event.action)}
            <span className="font-mono text-matrix-subtle">{event.entity}{event.entity_id ? ` / ${event.entity_id}` : ''}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-matrix-border/40">
            <div>
              <p className="text-[10px] font-mono text-matrix-subtle mb-1">المعرض</p>
              <p className="font-mono">{event.showroom?.name ?? event.showroom_id}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-matrix-subtle mb-1">الفاعل</p>
              <p className="font-mono">
                {event.user ? `${event.user.name} (${event.user.email}) · ${event.user.role}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-matrix-subtle mb-1">الوقت</p>
              <p className="font-mono" dir="ltr">{formatDateTime(event.created_at)}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-matrix-subtle mb-1">IP</p>
              <p className="font-mono" dir="ltr">{event.ip_address || '—'}</p>
            </div>
          </div>

          {imp && (
            <div className="pt-2 border-t border-matrix-amber/30 bg-matrix-amber/5 rounded p-2 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-matrix-amber shrink-0" />
              <p className="text-matrix-amber text-[11px]">
                تم التنفيذ أثناء جلسة انتحال هوية بواسطة{' '}
                <span className="font-mono">{imp.email ?? imp.user_id}</span>
              </p>
            </div>
          )}

          {event.old_data && showRaw('قبل (old_data)', event.old_data)}
          {event.new_data && showRaw('بعد (new_data)', event.new_data)}
        </div>
      )}
    </Modal>
  );
}

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [showroomId, setShowroomId] = useState('');
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const filters = useQuery({
    queryKey: ['admin-audit-filters'],
    queryFn: () => adminApi.getAuditFilters(),
    staleTime: 60_000,
  });

  const showrooms = useQuery({
    queryKey: ['admin-audit-showrooms'],
    queryFn: () => adminApi.getShowrooms({ page: 1, limit: 100 }),
    staleTime: 60_000,
  });

  const events = useQuery({
    queryKey: ['admin-audit', { page, entity, action, showroomId }],
    queryFn: () =>
      adminApi.getAuditEvents({
        page,
        limit: 20,
        entity:     entity     || undefined,
        action:     action     || undefined,
        showroom_id: showroomId || undefined,
      }),
  });

  const logs       = events.data?.data ?? [];
  const pagination = events.data?.pagination ?? { total: 0, pages: 1, page: 1, limit: 20 };

  const columns: Column<AuditEvent>[] = [
    { key: 'action', header: 'الإجراء', render: (r) => actionBadge(r.action) },
    { key: 'entity', header: 'الكيان', hideOnMobile: true, render: (r) => <span className="font-mono text-matrix-subtle">{r.entity}{r.entity_id ? ` #${r.entity_id.slice(0, 8)}` : ''}</span> },
    { key: 'showroom', header: 'المعرض', hideOnMobile: true, render: (r) => <span className="font-mono">{r.showroom?.name ?? r.showroom_id}</span> },
    { key: 'user', header: 'الفاعل', hideOnMobile: true, render: (r) => r.user ? <span className="font-mono">{r.user.name} <span className="text-matrix-subtle/60">· {r.user.role}</span></span> : <span className="text-matrix-subtle">—</span> },
    { key: 'created_at', header: 'الوقت', render: (r) => <span className="text-xs font-mono text-matrix-subtle" dir="ltr">{formatDateTime(r.created_at)}</span> },
    { key: 'details', header: '', align: 'center', render: () => <Eye className="w-4 h-4 text-matrix-subtle" /> },
  ];

  const resetPage = () => setPage(1);

  return (
    <DashboardLayout title="سجل التدقيق — منصة الإدارة">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-matrix-cyan" />
            <p className="text-xs font-mono text-matrix-subtle">
              {pagination.total} حدث · الصفحة {page} من {pagination.pages}
            </p>
          </div>
          <button
            onClick={() => events.refetch()}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3">
          <select value={action} onChange={(e) => { setAction(e.target.value); resetPage(); }} className="matrix-input text-xs min-w-[180px]">
            <option value="">كل الإجراءات</option>
            {(filters.data?.actions || []).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <select value={entity} onChange={(e) => { setEntity(e.target.value); resetPage(); }} className="matrix-input text-xs min-w-[150px]">
            <option value="">كل الكيانات</option>
            {(filters.data?.entities || []).map((en) => (
              <option key={en} value={en}>{en}</option>
            ))}
          </select>

          <select value={showroomId} onChange={(e) => { setShowroomId(e.target.value); resetPage(); }} className="matrix-input text-xs min-w-[170px]">
            <option value="">كل المعارض</option>
            {(showrooms.data?.data || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* ── Table ── */}
        <DataTable
          data={logs}
          columns={columns}
          loading={events.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setSelected(r)}
          emptyText="لا توجد أحداث تدقيق"
          pagination={{
            page:     pagination.page,
            pages:    pagination.pages,
            total:    pagination.total,
            limit:    pagination.limit,
            onPage:   (p) => setPage(p),
          }}
        />

        <EventDetailModal event={selected} onClose={() => setSelected(null)} />
      </div>
    </DashboardLayout>
  );
}