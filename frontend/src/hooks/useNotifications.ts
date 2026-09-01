// ============================================================
// YS-MATRIX ERP — useNotifications Hook (Phase 3 Stage 1)
// ============================================================

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationApi, isApiRequestError } from '@/lib/api';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────
// useUnreadCount — for Navbar badge
//
// FIX: V2 api.ts's getUnreadCount() already resolves DIRECTLY to
// { unread_count: number } — the previous .then((r) => r.data.data
// as {...}) was unwrapping two levels that no longer exist (api.ts
// itself does the envelope unwrapping now).
// ─────────────────────────────────────────
export function useUnreadCount() {
  return useQuery({
    queryKey:  ['notifications', 'unread-count'],
    queryFn:   () => notificationApi.getUnreadCount(),
    refetchInterval: 60_000, // poll every 60s
    staleTime:       30_000,
  });
}

// ─────────────────────────────────────────
// useNotifications — full list with pagination
//
// FIX: V2 api.ts's getAll() already resolves directly to
// Paginated<Notification[]> = { data, pagination }. The previous
// `.then((r) => r.data as {...})` was one level too deep, AND it
// claimed the response includes `unread_count` — confirmed FALSE:
// notification.controller.js's getNotifications only forwards
// result.notifications and result.pagination to the client; the
// unread_count the service computes internally is never sent
// through this endpoint. Callers needing the unread count must use
// useUnreadCount() (the dedicated endpoint) instead — see
// NotificationCenter.tsx, which already does this correctly.
// ─────────────────────────────────────────
export function useNotifications(params?: {
  is_read?: string;
  type?:    string;
  page?:    number;
  limit?:   number;
}) {
  return useQuery({
    queryKey: ['notifications', 'list', params],
    queryFn:  () => notificationApi.getAll(params),
  });
}

// ─────────────────────────────────────────
// useMarkAsRead — mark single notification
// ─────────────────────────────────────────
export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id),
    onSuccess: () => {
      // Prefix-matches both ['notifications','list',...] and
      // ['notifications','unread-count'] — invalidates the badge too.
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e: unknown) =>
      toast.error(isApiRequestError(e) ? e.message : 'فشل تحديد الإشعار كمقروء'),
  });
}

// ─────────────────────────────────────────
// useMarkAllAsRead
// ─────────────────────────────────────────
export function useMarkAllAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e: unknown) =>
      toast.error(isApiRequestError(e) ? e.message : 'فشل تحديد الإشعارات كمقروءة'),
  });
}
