'use client';

import { api } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Authenticated document printing (Phase C.1 — 4A).
//
// WHY THIS EXISTS:
// The naive approach — window.open(`${BASE}/invoices/${id}/print`) —
// is broken by design in this app: the backend authenticates via the
// `Authorization: Bearer` header ONLY (auth.middleware.js), it sets no
// cookies, and the token must never be smuggled through the URL (query
// strings leak into history/logs). A fresh browser tab carries neither
// the axios instance nor the token, so the print route would 401.
//
// HOW IT WORKS:
//   1. The blank tab opens FIRST, synchronously inside the click event —
//      popup blockers only suppress tabs opened outside a user gesture.
//   2. The authenticated axios client (interceptors attach the Bearer
//      header and run the 401-refresh queue) fetches the document as a
//      blob.
//   3. The blob is loaded into the already-open tab via an object URL,
//      which also shields the server from the tab's cross-origin
//      referrer. The URL is revoked after a grace period so the tab's
//      document stays printable while the blob handle is released.
// ═══════════════════════════════════════════════════════════

export async function openPrintHTML(path: string): Promise<void> {
  // 1) Open the blank tab synchronously — before any await — so the
  //    browser treats it as a user-gesture-triggered popup.
  const tab = window.open('', '_blank');
  if (!tab) {
    throw new Error('تم حظر النافذة المنبثقة — اسمح بالنوافذ المنبثقة لطباعة المستندات');
  }
  tab.document.title = 'جارٍ تحميل المستند…';
  tab.document.body.innerHTML =
    '<p dir="rtl" style="font-family:sans-serif;padding:24px;color:#666">جارٍ تحميل المستند…</p>';

  try {
    // 2) Authenticated fetch through the axios instance.
    const { data: blob } = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(blob);

    // 3) Load the blob into the pre-opened tab.
    tab.location.href = url;

    // Revoke once the tab has had time to read the blob — long enough
    // for the document to load, short enough to release the memory.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    tab.close();
    throw new Error('تعذر تحميل المستند — تحقق من الاتصال وأعد المحاولة');
  }
}