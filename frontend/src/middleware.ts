// ============================================================
// YS-MATRIX ERP - Next.js Route Protection Middleware
// YS Systems & Software
// يحمي كل routes الـ dashboard ويتحقق من الـ role
// ============================================================

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── اقرأ الـ auth state من الـ cookie ──────────────────────
  // Zustand persist بيحفظ في localStorage — Next.js middleware
  // بيشتغل على الـ Edge ومش عنده access للـ localStorage،
  // لذلك بنحتاج cookie منفصلة نكتبها وقت الـ login.
  const authCookie = request.cookies.get('ys-auth');

  let isAuth = false;
  let userRole = '';
  let userScope = '';

  if (authCookie?.value) {
    try {
      const parsed = JSON.parse(decodeURIComponent(authCookie.value));
      isAuth   = parsed?.isAuth        ?? false;
      userRole = parsed?.user?.role    ?? '';
      userScope = parsed?.user?.auth?.scope ?? '';
    } catch {
      isAuth = false;
    }
  }

  // ── حماية كل الـ dashboard ─────────────────────────────────
  if (pathname.startsWith('/dashboard')) {
    if (!isAuth) {
      return NextResponse.redirect(new URL('/auth/login', request.url));
    }
  }

  // ── الصفحة الرئيسية (Phase A P2-3) ────────────────────────
  // '/' كان بيخدم نسخة clone معطوبة من صفحة الإعدادات (dummy save
  // بدون أي استدعاء للـ backend). دلوقتي بيتم التوجيه لـ /dashboard
  // — ومعاه نفس حماية الـ auth: غير المسجلين بيتروحوا لـ /auth/login
  // تلقائياً عبر الحماية فوق. الصفحة الحقيقية للإعدادات هي
  // /dashboard/settings فقط.
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // ── حماية صفحات الـ SuperAdmin فقط ────────────────────────
  if (pathname.startsWith('/dashboard/superadmin')) {
    if (userRole !== 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // ── حماية إدارة المستخدمين (F4 — OWNER فقط) ──────────────
  if (pathname.startsWith('/dashboard/users')) {
    if (userRole !== 'OWNER' && userRole !== 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // ── حماية صفحات الإدارة المنصّية (/admin) ─────────────────
  // Phase 2 (Delegated Platform Administrators): allowed for the
  // protected system authority OR any GLOBAL-scope user (delegated
  // admin). Delegated admins carry the legacy 'OWNER' envelope, so
  // the cookie's effective scope — not the role — is the gate.
  if (pathname.startsWith('/admin')) {
    if (!isAuth) {
      return NextResponse.redirect(new URL('/auth/login', request.url));
    }
    if (userRole !== 'SUPER_ADMIN' && userScope !== 'GLOBAL') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // ── لو مسجل دخوله ومحاول يفتح login ──────────────────────
  if (pathname.startsWith('/auth/login') && isAuth) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/admin/:path*',
    '/auth/login',
  ],
};
