// ============================================================
// YS-MATRIX ERP — Notification Types (Phase 3 Stage 1)
// ============================================================

// FIX: Notification/NotificationType were defined twice — here and
// in api.ts — with different nullability (user_id?: string /
// read_at?: string here, vs the real user_id: string | null /
// read_at: string | null in api.ts, confirmed against schema.prisma's
// actual Notification model). ignoreBuildErrors was masking the
// incompatibility between the two. Importing the canonical versions
// from api.ts instead of maintaining a second copy — same fix pattern
// as AuthUser/User, ActivityLog/ActivityLogEntry, and Inst/Installment
// earlier in this project. Every existing `import { Notification }
// from '@/types/notification.types'` call site (this page, and
// presumably NotificationCenter/useNotifications) keeps working
// unchanged — now backed by the one real type instead of two.
import type { Notification, NotificationType } from '@/lib/api';
export type { Notification, NotificationType };

export interface NotificationListResponse {
  data:         Notification[];
  pagination:   { total: number; page: number; pages: number; limit: number };
  unread_count: number;
}

// ── Icon + Color map for each type ────────────────────────────
// Phase B.1 (F6/F7): each type also carries:
//   • severity  — 'info' | 'warning' | 'critical' (visual accent)
//   • action    — the ONE deep link a customer can act on. Kept in
//     this single map so every surface (bell dropdown + full page)
//     routes identically — never scattered URLs. Billing lifecycle
//     notifications point at /dashboard/billing; everything else
//     stays unlinked (no invented destinations).
export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationTypeConfig {
  icon: string;
  colorClass: string;
  label: string;
  severity: NotificationSeverity;
  action?: { href: string; label: string };
}

export const NOTIFICATION_CONFIG: Record<
  NotificationType,
  NotificationTypeConfig
> = {
  INSTALLMENT_OVERDUE:  { icon: '⚠️', colorClass: 'text-matrix-red',    label: 'قسط متأخر',      severity: 'critical' },
  INSTALLMENT_DUE_SOON: { icon: '🔔', colorClass: 'text-matrix-amber',  label: 'قسط قريب',       severity: 'warning' },
  LICENSE_EXPIRING:     { icon: '📅', colorClass: 'text-matrix-amber',  label: 'اشتراك ينتهي',   severity: 'warning' },
  LOW_STOCK:            { icon: '📦', colorClass: 'text-matrix-amber',  label: 'مخزون منخفض',    severity: 'warning' },
  SALE_CREATED:         { icon: '✅', colorClass: 'text-matrix-green',  label: 'فاتورة جديدة',   severity: 'info' },
  SALE_CANCELLED:       { icon: '❌', colorClass: 'text-matrix-red',    label: 'فاتورة ملغاة',   severity: 'critical' },
  PAYMENT_RECEIVED:     { icon: '💰', colorClass: 'text-matrix-green',  label: 'دفعة مستلمة',    severity: 'info' },
  SYSTEM:               { icon: '🔧', colorClass: 'text-matrix-subtle', label: 'نظام',           severity: 'info' },
  // ── Phase 4 — subscription lifecycle (Phase B.1: actionable) ──
  PAYMENT_SUBMITTED:    {
    icon: '🧾', colorClass: 'text-matrix-amber', label: 'طلب دفع قيد المراجعة', severity: 'warning',
    action: { href: '/dashboard/billing', label: 'متابعة الطلب' },
  },
  SUBSCRIPTION_ACTIVATED: {
    icon: '✅', colorClass: 'text-matrix-green', label: 'تم تفعيل الاشتراك', severity: 'info',
    action: { href: '/dashboard', label: 'فتح لوحة التحكم' },
  },
  PAYMENT_REJECTED:     {
    icon: '❌', colorClass: 'text-matrix-red', label: 'تم رفض الدفع', severity: 'critical',
    action: { href: '/dashboard/billing', label: 'إعادة تقديم الطلب' },
  },
  SUBSCRIPTION_EXPIRING: {
    icon: '⏳', colorClass: 'text-matrix-amber', label: 'الاشتراك يقترب من الانتهاء', severity: 'warning',
    action: { href: '/dashboard/billing', label: 'تجديد الاشتراك' },
  },
  SUBSCRIPTION_EXPIRED: {
    icon: '⛔', colorClass: 'text-matrix-red', label: 'انتهى الاشتراك', severity: 'critical',
    action: { href: '/dashboard/billing', label: 'تجديد الاشتراك' },
  },
};
