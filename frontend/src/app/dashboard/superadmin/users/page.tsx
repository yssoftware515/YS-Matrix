"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  superAdminApi,
  isApiRequestError,
  type SuperAdminUser,
  type Showroom,
  type PasswordResetRequest,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────
type ShowroomBasic = Pick<Showroom, "id" | "name" | "slug" | "is_active">;

interface ToastState { msg: string; type: "success" | "error"; }

type ModalState =
  | { type: "create" }
  | { type: "edit";  user: SuperAdminUser }
  // FP-07: widened to the minimum ResetPasswordModal actually reads
  // (id + name) so a partial user coming from a reset-request row
  // (getPendingResetRequests only ever returns id/name/email/role/
  // is_active, never the full SuperAdminUser shape) can open the same
  // modal without a redundant getUserById round-trip. A full
  // SuperAdminUser still satisfies this structurally — existing call
  // sites are unaffected.
  | { type: "reset"; user: Pick<SuperAdminUser, "id" | "name"> }
  | null;

// ─── Constants ────────────────────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "سوبر أدمن",
  OWNER:       "مالك",
  STAFF:       "موظف",
};

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  SUPER_ADMIN: { bg: "#1a0533", text: "#c084fc", border: "#7c3aed" },
  OWNER:       { bg: "#0c1f3d", text: "#60a5fa", border: "#2563eb" },
  STAFF:       { bg: "#0d2818", text: "#4ade80", border: "#16a34a" },
};

// ─── Shared styles ────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%", background: "#1a1a2e", border: "1px solid #2d2d4a",
  borderRadius: 8, color: "#e2e2f0", fontSize: 14, padding: "9px 12px",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  transition: "border-color 0.15s",
};
const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg,#7c3aed,#6d28d9)",
  border: "none", borderRadius: 8, color: "#fff",
  cursor: "pointer", fontSize: 14, fontWeight: 700,
  padding: "10px 22px", transition: "opacity 0.15s",
};
const btnGhost: React.CSSProperties = {
  background: "transparent", border: "1px solid #2d2d4a",
  borderRadius: 8, color: "#8b8baa",
  cursor: "pointer", fontSize: 14, fontWeight: 600,
  padding: "10px 18px",
};

// ─── Mini components ──────────────────────────────────────────────────────────
function Badge({ role }: { role: string }) {
  const c = ROLE_COLORS[role] ?? ROLE_COLORS.STAFF;
  return (
    <span style={{
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: 6, fontSize: 11, fontWeight: 700,
      padding: "2px 10px", letterSpacing: "0.06em",
      textTransform: "uppercase", whiteSpace: "nowrap",
    }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 12, color: active ? "#4ade80" : "#f87171" }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%", display: "inline-block",
        background: active ? "#22c55e" : "#ef4444",
        boxShadow: active ? "0 0 6px #22c55e" : "0 0 6px #ef4444",
      }} />
      {active ? "نشط" : "معطل"}
    </span>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 18, height: 18,
      border: "2.5px solid rgba(139,92,246,0.25)",
      borderTopColor: "#8b5cf6", borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
    }} />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, color: "#8b8baa",
        marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "#0f0f17", border: "1px solid #2d2d4a",
        borderRadius: 14, width: "100%", maxWidth: 520,
        boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        animation: "slideUp 0.22s ease",
      }}>
        <div style={{ display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "20px 24px 0" }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#e2e2f0" }}>{title}</h3>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#6b6b8a", fontSize: 22, lineHeight: 1, padding: 4,
          }}>×</button>
        </div>
        <div style={{ padding: "20px 24px 24px" }}>{children}</div>
      </div>
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div style={{ background: "#2d0a0a", border: "1px solid #7f1d1d",
      borderRadius: 8, color: "#fca5a5", fontSize: 13,
      padding: "10px 14px", marginBottom: 16 }}>
      {msg}
    </div>
  );
}

// ─── Create User Modal ────────────────────────────────────────────────────────
function CreateUserModal({ showrooms, onClose, onSuccess }: {
  showrooms: ShowroomBasic[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "OWNER", showroom_id: "" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const mut = useMutation({
    mutationFn: () => superAdminApi.createUser(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["superadmin-users"] });
      onSuccess("تم إنشاء المستخدم بنجاح ✓");
      onClose();
    },
  });

  return (
    <ModalShell title="إنشاء مستخدم جديد" onClose={onClose}>
      {mut.isError && <ErrBox msg={isApiRequestError(mut.error) ? mut.error.message : "فشل الإنشاء"} />}
      <Field label="الاسم الكامل">
        <input style={inputStyle} value={form.name} onChange={set("name")} placeholder="مثال: أحمد محمد" />
      </Field>
      <Field label="البريد الإلكتروني">
        <input style={inputStyle} type="email" value={form.email} onChange={set("email")}
          placeholder="user@example.com" dir="ltr" />
      </Field>
      <Field label="كلمة المرور">
        <input style={inputStyle} type="password" value={form.password} onChange={set("password")}
          placeholder="8 أحرف على الأقل" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="الصلاحية">
          <select style={inputStyle} value={form.role} onChange={set("role")}>
            <option value="OWNER">مالك</option>
            <option value="STAFF">موظف</option>
          </select>
        </Field>
        <Field label="المعرض">
          <select style={inputStyle} value={form.showroom_id} onChange={set("showroom_id")}>
            <option value="">اختر معرضاً...</option>
            {showrooms.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button style={btnGhost} onClick={onClose}>إلغاء</button>
        <button style={{ ...btnPrimary, opacity: mut.isPending ? 0.7 : 1 }}
          onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? <Spinner /> : "إنشاء المستخدم"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Edit User Modal ──────────────────────────────────────────────────────────
function EditUserModal({ user, onClose, onSuccess }: {
  user: SuperAdminUser;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: user.name, role: user.role, is_active: user.is_active });

  const mut = useMutation({
    mutationFn: () => superAdminApi.updateUser(user.id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["superadmin-users"] });
      onSuccess("تم تحديث المستخدم بنجاح ✓");
      onClose();
    },
  });

  return (
    <ModalShell title={`تعديل: ${user.name}`} onClose={onClose}>
      {mut.isError && <ErrBox msg={isApiRequestError(mut.error) ? mut.error.message : "فشل التحديث"} />}
      <Field label="الاسم الكامل">
        <input style={inputStyle} value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      </Field>
      {user.role !== "SUPER_ADMIN" && (
        <Field label="الصلاحية">
          <select style={inputStyle} value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value as SuperAdminUser["role"] }))}>
            <option value="OWNER">مالك</option>
            <option value="STAFF">موظف</option>
          </select>
        </Field>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        padding: "10px 14px", background: "#1a1a2e", borderRadius: 8,
        border: "1px solid #2d2d4a", marginBottom: 16 }}>
        <input type="checkbox" checked={form.is_active}
          onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
          style={{ width: 16, height: 16, accentColor: "#7c3aed" }} />
        <span style={{ color: "#c4c4d8", fontSize: 14 }}>الحساب نشط</span>
      </label>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button style={btnGhost} onClick={onClose}>إلغاء</button>
        <button style={{ ...btnPrimary, opacity: mut.isPending ? 0.7 : 1 }}
          onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? <Spinner /> : "حفظ التغييرات"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Reset Password Modal ─────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose, onSuccess }: {
  user: Pick<SuperAdminUser, "id" | "name">;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => superAdminApi.resetUserPassword({
      user_id: user.id,
      ...(newPassword ? { new_password: newPassword } : {}),
    }),
    onSuccess: (data) => {
      setTempPassword(data?.temp_password ?? null);
      onSuccess("تم إعادة تعيين كلمة المرور ✓");
    },
  });

  return (
    <ModalShell title={`إعادة تعيين كلمة مرور: ${user.name}`} onClose={onClose}>
      {mut.isError && <ErrBox msg={isApiRequestError(mut.error) ? mut.error.message : "فشل إعادة التعيين"} />}
      {tempPassword !== null || (mut.isSuccess && !tempPassword) ? (
        <div>
          <div style={{ background: "#0d2818", border: "1px solid #16a34a",
            borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: "0 0 8px", color: "#4ade80", fontSize: 14, fontWeight: 700 }}>
              ✓ تمت العملية بنجاح
            </p>
            <p style={{ margin: "0 0 4px", color: "#86efac", fontSize: 13 }}>
              تم إنهاء جميع الجلسات النشطة
            </p>
            {tempPassword && tempPassword !== "*** provided by admin ***" && (
              <div style={{ marginTop: 12 }}>
                <p style={{ margin: "0 0 6px", color: "#8b8baa", fontSize: 12 }}>
                  كلمة المرور المؤقتة (شاركها بشكل آمن):
                </p>
                <div style={{
                  background: "#0a0a14", borderRadius: 8, padding: "10px 14px",
                  fontFamily: "monospace", fontSize: 16, color: "#c084fc",
                  letterSpacing: "0.1em", border: "1px solid #4c1d95",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  {tempPassword}
                  <button onClick={() => navigator.clipboard.writeText(tempPassword!)}
                    style={{ ...btnGhost, fontSize: 11, padding: "4px 10px" }}>
                    نسخ
                  </button>
                </div>
              </div>
            )}
          </div>
          <button style={{ ...btnPrimary, width: "100%" }} onClick={onClose}>إغلاق</button>
        </div>
      ) : (
        <>
          <p style={{ color: "#8b8baa", fontSize: 13, margin: "0 0 16px", lineHeight: 1.6 }}>
            اترك الحقل فارغاً لتوليد كلمة مرور مؤقتة آمنة تلقائياً.
          </p>
          <Field label="كلمة المرور الجديدة (اختياري)">
            <input style={inputStyle} type="password"
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              placeholder="اتركه فارغاً للتوليد التلقائي" />
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={btnGhost} onClick={onClose}>إلغاء</button>
            <button
              style={{ ...btnPrimary, background: "linear-gradient(135deg,#dc2626,#b91c1c)", opacity: mut.isPending ? 0.7 : 1 }}
              onClick={() => mut.mutate()} disabled={mut.isPending}>
              {mut.isPending ? <Spinner /> : "إعادة التعيين"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function UsersManagementPage() {
  const router = useRouter();
  const { user: currentUser } = useAuthStore();

  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [page,         setPage]         = useState(1);
  const [toast,        setToast]        = useState<ToastState | null>(null);
  const [modal,        setModal]        = useState<ModalState>(null);

  // ── Guard — SuperAdmin فقط ────────────────────────────────
  useEffect(() => {
    if (currentUser && currentUser.role !== "SUPER_ADMIN") {
      router.replace("/dashboard");
    }
  }, [currentUser, router]);

  // ── Debounced search reset ────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setPage(1), 350);
    return () => clearTimeout(t);
  }, [search]);

  const isAdmin = currentUser?.role === "SUPER_ADMIN";

  // Matrix Audit (Priority 2): was using apiFetch() with raw fetch()
  // and manual token injection — bypassing Axios interceptors entirely
  // (no 401 refresh, no unified error codes, no unwrapped envelope).
  // Now using useQuery + superAdminApi which goes through the same
  // request/requestPaginated pipeline as every other page in the app.
  const usersQuery = useQuery({
    queryKey: ["superadmin-users", { page, search, roleFilter, activeFilter }],
    queryFn: () => superAdminApi.getUsers({
      page, limit: 12,
      ...(search       ? { search }                            : {}),
      ...(roleFilter   ? { role: roleFilter as "OWNER" | "STAFF" } : {}),
      ...(activeFilter ? { is_active: activeFilter as "true" | "false" } : {}),
    }),
    enabled: isAdmin,
  });

  const showroomsQuery = useQuery({
    queryKey: ["superadmin-showrooms-select"],
    queryFn: () => superAdminApi.getShowroomsForSelect(100),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000, // 5 min — changes rarely
  });

  // FP-07: last 7 days only, matching the backend's own window
  // (getPendingResetRequests filters created_at >= now - 7d).
  const resetRequestsQuery = useQuery({
    queryKey: ["superadmin-reset-requests"],
    queryFn:  () => superAdminApi.getPasswordResetRequests({ limit: 10 }),
    enabled:  isAdmin,
  });

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const users     = usersQuery.data?.data ?? [];
  const meta      = usersQuery.data?.pagination ?? { total: 0, page: 1, pages: 1, limit: 12 };
  const showrooms = showroomsQuery.data?.data ?? [];
  const loading   = usersQuery.isLoading;

  const resetRequests = resetRequestsQuery.data?.data ?? [];

  const fmtDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" }) : "—";

  if (!isAdmin) return null;

  return (
    <DashboardLayout title="إدارة المستخدمين">
    <div style={{
      background: "#07070f",
      fontFamily: "'Tajawal', 'Cairo', sans-serif",
      direction: "rtl", color: "#e2e2f0",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap');
        @keyframes spin     { to { transform: rotate(360deg); } }
        @keyframes slideUp  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes toastIn  { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
        * { box-sizing: border-box; }
        input:focus, select:focus { border-color: #7c3aed !important; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f0f17; }
        ::-webkit-scrollbar-thumb { background: #2d2d4a; border-radius: 3px; }
        button:hover { opacity: 0.85; }
        .row-hover:hover { background: rgba(139,92,246,0.05) !important; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 24, left: 24, zIndex: 99999,
          background: toast.type === "error" ? "#2d0a0a" : "#0d2818",
          border: `1px solid ${toast.type === "error" ? "#7f1d1d" : "#16a34a"}`,
          color: toast.type === "error" ? "#fca5a5" : "#4ade80",
          borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 600,
          boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
          animation: "toastIn 0.25s ease", maxWidth: 320,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Modals */}
      {modal?.type === "create" && (
        <CreateUserModal
          showrooms={showrooms}
          onClose={() => setModal(null)}
          onSuccess={msg => showToast(msg)}
        />
      )}
      {modal?.type === "edit" && (
        <EditUserModal
          user={modal.user}
          onClose={() => setModal(null)}
          onSuccess={msg => showToast(msg)}
        />
      )}
      {modal?.type === "reset" && (
        <ResetPasswordModal
          user={modal.user}
          onClose={() => setModal(null)}
          onSuccess={msg => showToast(msg)}
        />
      )}

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, fontSize: 20,
              background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>👥</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#e2e2f0" }}>
                إدارة المستخدمين
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: "#6b6b8a" }}>
                SuperAdmin — YS-MATRIX ERP
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "إجمالي المستخدمين", value: meta.total,                               color: "#8b5cf6" },
            { label: "نشطون",              value: users.filter(u => u.is_active).length,    color: "#22c55e" },
            { label: "معطلون",             value: users.filter(u => !u.is_active).length,   color: "#ef4444" },
            { label: "الصفحة",             value: `${meta.page} / ${meta.pages || 1}`,      color: "#60a5fa" },
          ].map(s => (
            <div key={s.label} style={{
              background: "#0f0f17", border: "1px solid #2d2d4a",
              borderRadius: 10, padding: "14px 18px",
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "#6b6b8a", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* FP-07: getPendingResetRequests existed on the backend with
            no frontend surface at all. No separate approve/deny
            endpoint exists — "handling" a request means reusing the
            same reset-password action already available per user. */}
        <div style={{
          background: "#0f0f17", border: "1px solid #2d2d4a",
          borderRadius: 12, padding: 18, marginBottom: 24,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e2e2f0" }}>
              طلبات إعادة تعيين كلمة المرور
            </h2>
            <span style={{ fontSize: 11, color: "#6b6b8a" }}>آخر 7 أيام</span>
          </div>

          {resetRequestsQuery.isLoading ? (
            <div style={{ textAlign: "center", padding: 20 }}><Spinner /></div>
          ) : resetRequests.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "#6b6b8a", textAlign: "center", padding: "8px 0" }}>
              لا توجد طلبات إعادة تعيين حالياً
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {resetRequests.map((r: PasswordResetRequest) => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 10, padding: "10px 14px", background: "#13131f",
                  border: "1px solid #1a1a2e", borderRadius: 8, flexWrap: "wrap",
                }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e2e2f0" }}>
                      {r.user?.name ?? r.new_data?.name ?? "—"}
                      <span style={{ fontWeight: 400, color: "#6b6b8a", marginRight: 8, fontSize: 12 }}>
                        {r.showroom?.name ? `· ${r.showroom.name}` : ""}
                      </span>
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b6b8a", direction: "ltr", textAlign: "right" }}>
                      {r.user?.email ?? r.new_data?.email ?? "—"}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "#6b6b8a" }}>{fmtDate(r.created_at)}</span>
                    {r.user && (
                      <button
                        onClick={() => setModal({ type: "reset", user: { id: r.user!.id, name: r.user!.name } })}
                        style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}
                      >
                        إعادة التعيين
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
          <input
            style={{ ...inputStyle, maxWidth: 260, flex: 1 }}
            placeholder="بحث بالاسم أو الإيميل..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select style={{ ...inputStyle, width: "auto", minWidth: 130 }}
            value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }}>
            <option value="">كل الصلاحيات</option>
            <option value="OWNER">مالك</option>
            <option value="STAFF">موظف</option>
          </select>
          <select style={{ ...inputStyle, width: "auto", minWidth: 120 }}
            value={activeFilter} onChange={e => { setActiveFilter(e.target.value); setPage(1); }}>
            <option value="">كل الحالات</option>
            <option value="true">نشط</option>
            <option value="false">معطل</option>
          </select>
          <button style={{ ...btnPrimary, marginRight: "auto" }}
            onClick={() => setModal({ type: "create" })}>
            + إضافة مستخدم
          </button>
        </div>

        {/* Table */}
        <div style={{ background: "#0f0f17", border: "1px solid #2d2d4a", borderRadius: 12, overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1.5fr 1fr 1fr 1fr",
            background: "#13131f", borderBottom: "1px solid #2d2d4a", padding: "12px 20px",
          }}>
            {["الاسم", "الإيميل", "الصلاحية", "المعرض", "آخر دخول", "الحالة", "إجراءات"].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700,
                color: "#6b6b8a", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {h}
              </span>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <Spinner />
              <span style={{ color: "#6b6b8a", fontSize: 13, marginTop: 12, display: "block" }}>
                جارٍ التحميل...
              </span>
            </div>
          ) : usersQuery.isError ? (
            <div style={{ padding: 60, textAlign: "center", color: "#f87171", fontSize: 14 }}>
              {isApiRequestError(usersQuery.error) ? usersQuery.error.message : "فشل تحميل المستخدمين"}
            </div>
          ) : users.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center", color: "#6b6b8a", fontSize: 14 }}>
              لا يوجد مستخدمون مطابقون للبحث
            </div>
          ) : (
            users.map((u, i) => (
              <div key={u.id} className="row-hover" style={{
                display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1.5fr 1fr 1fr 1fr",
                padding: "14px 20px", alignItems: "center",
                borderBottom: i < users.length - 1 ? "1px solid #1a1a2e" : "none",
                transition: "background 0.12s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: `hsl(${u.name.charCodeAt(0) * 7 % 360},45%,22%)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700, color: "#e2e2f0",
                  }}>
                    {u.name.charAt(0)}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e2f0" }}>{u.name}</span>
                </div>
                <span style={{ fontSize: 12, color: "#8b8baa", direction: "ltr",
                  textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.email}
                </span>
                <div><Badge role={u.role} /></div>
                <span style={{ fontSize: 12, color: "#c4c4d8",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.showroom?.name ?? "—"}
                </span>
                <span style={{ fontSize: 12, color: "#6b6b8a" }}>{fmtDate(u.last_login)}</span>
                <StatusDot active={u.is_active} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button title="تعديل" onClick={() => setModal({ type: "edit", user: u })}
                    style={{ background: "#1a1a2e", border: "1px solid #2d2d4a",
                      borderRadius: 7, color: "#8b8baa", cursor: "pointer",
                      fontSize: 15, padding: "5px 9px", lineHeight: 1 }}>✏️</button>
                  <button title="إعادة تعيين كلمة المرور"
                    onClick={() => setModal({ type: "reset", user: u })}
                    style={{ background: "#1a1a2e", border: "1px solid #2d2d4a",
                      borderRadius: 7, color: "#8b8baa", cursor: "pointer",
                      fontSize: 15, padding: "5px 9px", lineHeight: 1 }}>🔑</button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {meta.pages > 1 && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 20, alignItems: "center" }}>
            <button style={{ ...btnGhost, padding: "8px 16px", opacity: page <= 1 ? 0.4 : 1 }}
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              السابق
            </button>
            {Array.from({ length: meta.pages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === meta.pages || Math.abs(p - page) <= 2)
              .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} style={{ color: "#6b6b8a", fontSize: 14, padding: "0 4px" }}>…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p as number)} style={{
                    ...btnGhost, padding: "8px 14px", fontSize: 13,
                    background: p === page ? "rgba(124,58,237,0.2)" : "transparent",
                    borderColor: p === page ? "#7c3aed" : "#2d2d4a",
                    color: p === page ? "#c084fc" : "#8b8baa",
                  }}>{p}</button>
                )
              )
            }
            <button style={{ ...btnGhost, padding: "8px 16px", opacity: page >= meta.pages ? 0.4 : 1 }}
              onClick={() => setPage(p => Math.min(meta.pages, p + 1))} disabled={page >= meta.pages}>
              التالي
            </button>
          </div>
        )}

      </div>
    </div>
    </DashboardLayout>
  );
}
