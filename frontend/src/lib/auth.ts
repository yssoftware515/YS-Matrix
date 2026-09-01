// ============================================================
// YS-MATRIX ERP - Auth Store (Zustand)
// Author: Yahya Al-Sulami 🦅
// v1.3 — Added Impersonation stash/restore (Matrix Audit #9)
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ShowroomInfo {
  id: string; name: string; slug: string;
  logo_url?: string; license_expiry: string; is_active: boolean;
  is_onboarded?: boolean;
}

// Phase 2 (Delegated Platform Administrators): the server-side
// effectiveAuthorization payload (/auth/me) — UI-facing ONLY. The
// backend remains authoritative; this enables delegated GLOBAL
// admins to be recognized (their role envelope is the legacy
// 'OWNER', so authorization.scope is the distinguishing signal).
export interface PermissionGrant {
  permission: string;
  scope: 'SHOWROOM' | 'SELF' | 'GLOBAL';
}

export interface UserAuthorization {
  profile: string;
  scope: 'SHOWROOM' | 'GLOBAL';
  permissions: PermissionGrant[];
}

export interface User {
  id: string; name: string; email: string;
  role: 'SUPER_ADMIN' | 'OWNER' | 'STAFF';
  avatar_url?: string;
  showroom: ShowroomInfo;
  profile_id?: string;
  authorization?: UserAuthorization;
}

// Matrix Audit (#9 — Impersonation): a snapshot of the real
// SuperAdmin's session, stashed while an impersonation session is
// active so it can be restored exactly (same tokens, same user) —
// no re-login required to go back.
interface StashedSession {
  user: User;
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuth: boolean;
  originalSession: StashedSession | null;
  setAuth: (user: User, access: string, refresh: string) => void;
  clearAuth: () => void;
  updateUser: (u: Partial<User>) => void;
  startImpersonation: (impersonatedUser: User, accessToken: string) => void;
  exitImpersonation: () => void;
}

// ─────────────────────────────────────────────────────────────
// Cookie helpers — يكتب/يمسح cookie للـ middleware
// Next.js middleware يشتغل على Edge ومش عنده access للـ localStorage
// ─────────────────────────────────────────────────────────────
const COOKIE_NAME = 'ys-auth';

function writeAuthCookie(user: User, isAuth: boolean) {
  if (typeof window === 'undefined') return;
  // Phase 2: cookie now also carries the effective authorization
  // (profile + scope) so the Edge middleware can gate /admin/*
  // for delegated GLOBAL admins whose role envelope is 'OWNER'.
  const value = encodeURIComponent(JSON.stringify({
    isAuth,
    user: {
      role:  user.role,
      auth: user.authorization
        ? { profile: user.authorization.profile, scope: user.authorization.scope }
        : undefined,
    },
  }));
  // SameSite=Strict — لا يُرسل مع cross-site requests
  // Path=/ — متاح لكل الـ routes
  // لا نضع HttpOnly لأن الـ middleware على Edge يقرأه من request.cookies
  document.cookie = `${COOKIE_NAME}=${value}; path=/; SameSite=Strict; Max-Age=${60 * 60 * 24 * 7}`;
}

function clearAuthCookie() {
  if (typeof window === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=; path=/; SameSite=Strict; Max-Age=0`;
}

// ─────────────────────────────────────────────────────────────
// Zustand Store
// ─────────────────────────────────────────────────────────────
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:            null,
      accessToken:     null,
      refreshToken:    null,
      isAuth:          false,
      originalSession: null,

      setAuth: (user, accessToken, refreshToken) => {
        // 1. localStorage tokens (للـ Axios interceptors)
        if (typeof window !== 'undefined') {
          localStorage.setItem('ys_access_token',  accessToken);
          localStorage.setItem('ys_refresh_token', refreshToken);
        }
        // 2. Cookie للـ Next.js middleware
        writeAuthCookie(user, true);
        // 3. Zustand state
        set({ user, accessToken, refreshToken, isAuth: true });
      },

      clearAuth: () => {
        // 1. امسح localStorage
        if (typeof window !== 'undefined') {
          localStorage.removeItem('ys_access_token');
          localStorage.removeItem('ys_refresh_token');
        }
        // 2. امسح الـ cookie
        clearAuthCookie();
        // 3. امسح الـ state (يشمل مسح أي جلسة أصلية محفوظة)
        set({ user: null, accessToken: null, refreshToken: null, isAuth: false, originalSession: null });
      },

      updateUser: (partial) =>
        set((s) => {
          const updated = s.user ? { ...s.user, ...partial } : null;
          // حدّث الـ cookie لو الـ role اتغيّر
          if (updated) writeAuthCookie(updated, true);
          return { user: updated };
        }),

      // ─────────────────────────────────────────────────────
      // startImpersonation (Matrix Audit #9)
      //
      // Stashes the CURRENT session (the real SuperAdmin) into
      // originalSession, then swaps the active session to the
      // impersonated OWNER. Deliberately does NOT go through
      // setAuth() — that would have no way to preserve the
      // SuperAdmin's own tokens for later restoration.
      //
      // No refresh token is stored for the impersonated session
      // (matches backend: generateImpersonationToken issues an
      // access-only, 30-minute token — see jwt.js). When it expires,
      // the Axios 401 interceptor in api.ts finds an empty refresh
      // token and redirects to /auth/login rather than silently
      // renewing — the impersonation session cannot be extended
      // indefinitely by accident.
      // ─────────────────────────────────────────────────────
      startImpersonation: (impersonatedUser, accessToken) =>
        set((s) => {
          // Guard: if somehow called while already impersonating,
          // keep the ORIGINAL stash rather than overwriting it with
          // the just-active impersonated session (which would make
          // "exit" return to the wrong place).
          const stash: StashedSession | null =
            s.originalSession ??
            (s.user && s.accessToken && s.refreshToken
              ? { user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken }
              : null);

          if (typeof window !== 'undefined') {
            localStorage.setItem('ys_access_token', accessToken);
            localStorage.setItem('ys_refresh_token', '');
          }
          writeAuthCookie(impersonatedUser, true);

          return {
            user:            impersonatedUser,
            accessToken,
            refreshToken:    '',
            isAuth:          true,
            originalSession: stash,
          };
        }),

      // ─────────────────────────────────────────────────────
      // exitImpersonation (Matrix Audit #9)
      //
      // Restores the stashed SuperAdmin session exactly as it was.
      // No-op (returns unchanged state) if there is nothing stashed
      // — e.g. called from a session that was never impersonating.
      // ─────────────────────────────────────────────────────
      exitImpersonation: () =>
        set((s) => {
          if (!s.originalSession) return {};

          const { user, accessToken, refreshToken } = s.originalSession;

          if (typeof window !== 'undefined') {
            localStorage.setItem('ys_access_token',  accessToken);
            localStorage.setItem('ys_refresh_token', refreshToken);
          }
          writeAuthCookie(user, true);

          return {
            user,
            accessToken,
            refreshToken,
            isAuth:          true,
            originalSession: null,
          };
        }),
    }),
    {
      name: 'ys-matrix-auth',
      partialize: (s) => ({
        user:            s.user,
        accessToken:     s.accessToken,
        refreshToken:    s.refreshToken,
        isAuth:          s.isAuth,
        originalSession: s.originalSession,
      }),
    }
  )
);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
export const isOwnerPlus  = (role?: string) => ['SUPER_ADMIN', 'OWNER'].includes(role || '');
export const isSuperAdmin = (role?: string) => role === 'SUPER_ADMIN';

// Phase 2 (Delegated Platform Administrators): a platform admin is
// either the protected system authority, or any user whose
// server-resolved effective scope is GLOBAL (delegated GLOBAL
// profiles). Menu gating + /admin page guards use this predicate —
// never raw role checks alone, because delegated admins carry the
// legacy 'OWNER' envelope.
export const isPlatformAdmin = (user?: Pick<User, 'role' | 'authorization'> | null) =>
  !!user && (user.role === 'SUPER_ADMIN' || user.authorization?.scope === 'GLOBAL');
