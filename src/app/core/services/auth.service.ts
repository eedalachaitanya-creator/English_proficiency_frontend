import { Injectable, signal, computed, inject } from '@angular/core';
import { Observable, map, tap, catchError, of } from 'rxjs';
import { ApiService, ApiError } from './api.service';
import { JwtService } from './jwt.service';
import {
  HRUser,
  HRLoginRequest,
  AdminUser,
  AdminLoginRequest,
} from '../models/hr.models';

/**
 * Wire-format response from GET /api/hr/session-status.
 * Always returns 200 — no red console errors when logged out.
 *
 * Logged in:  { logged_in: true,  user: { id, name, email } }
 * Logged out: { logged_in: false, user: null }
 */
interface SessionStatusResponse {
  logged_in: boolean;
  user: HRUser | null;
}

/** /api/admin/session-status — same shape as HR but user has role. */
interface AdminSessionStatusResponse {
  logged_in: boolean;
  user: AdminUser | null;
}

/**
 * HR authentication service.
 *
 * Two state signals:
 *   currentUser  — the HRUser object, or null if not logged in
 *   isLoggedIn   — derived boolean for *ngIf gating
 *
 * Three methods:
 *   checkSession() — silent probe via /api/hr/session-status (200 OK regardless)
 *   login()        — POST /api/hr/login (401 on bad creds, error propagates)
 *   logout()       — POST /api/hr/logout, swallows errors, always clears state
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private jwt = inject(JwtService);
  readonly currentUser = signal<HRUser | null>(null);
  readonly isLoggedIn = computed(() => this.currentUser() !== null);

  // Admin session is tracked separately. A given browser tab is logged in
  // as either HR or admin (not both — same session cookie key on the
  // backend), but keeping the two state slots distinct on the frontend
  // avoids type confusion and lets each component query just the role
  // it cares about.
  readonly currentAdmin = signal<AdminUser | null>(null);
  readonly isAdminLoggedIn = computed(() => this.currentAdmin() !== null);

  /**
   * TRUE while the logged-in user (HR or admin) is on a temp password
   * from /forgot-password. The route guard reads this and locks every
   * authenticated route to /change-password-required until the user
   * clears it via /change-password.
   *
   * Populated from login + adminLogin responses, refreshed by checkSession
   * + checkAdminSession on app boot, cleared on logout / adminLogout /
   * successful changePassword.
   */
  readonly mustChangePassword = signal<boolean>(false);

  /**
   * Silent session probe. Calls /api/hr/session-status which ALWAYS returns
   * 200 (never 401), so this method never triggers the red "401 Unauthorized"
   * error in the browser DevTools console.
   *
   * On success: updates currentUser and emits the user (or null if logged out).
   * On unexpected error (network down, 500): clears currentUser and emits null
   *                                            for HRUser semantics, but rethrows
   *                                            for the caller's error handler.
   *
   * The legacy /api/hr/me endpoint still exists on the backend for routes that
   * actually require auth (it raises 401). This service uses session-status
   * specifically because it's a probe, not a gate.
   */
  checkSession(): Observable<HRUser | null> {
    return this.api.get<SessionStatusResponse>('/api/hr/session-status').pipe(
      map((res) => {
        const user = res.logged_in ? res.user : null;
        this.currentUser.set(user);
        // Refresh the must-change flag from the probe so a page reload
        // mid-flow doesn't bypass the route guard. Logged-out path
        // resets to false (no user, no flag).
        this.mustChangePassword.set(user?.must_change_password === true);
        return user;
      }),
      catchError((err: ApiError) => {
        // Network/CORS/server errors land here. session-status itself never
        // returns 401, but we still defensively handle it for completeness.
        this.currentUser.set(null);
        this.mustChangePassword.set(false);
        if (err.status === 401) {
          return of(null);
        }
        throw err;
      })
    );
  }

  /**
   * Log in with email + password. On 200, server sets a session cookie
   * (carried automatically via withCredentials in ApiService) and we cache
   * the returned user. On 401 (bad creds), the error propagates so the
   * Login component can surface err.message ("Invalid email or password.").
   */
  login(credentials: HRLoginRequest): Observable<HRUser> {
    return this.api.post<HRUser>('/api/hr/login', credentials).pipe(
      tap((user) => {
        // Persist JWT tokens BEFORE setting currentUser. Order matters:
        // anything that reacts to currentUser being non-null (e.g.,
        // route guards triggering API calls) needs the token in
        // localStorage so the HTTP interceptor can attach it.
        if (user.access_token && user.refresh_token) {
          this.jwt.setTokens(user.access_token, user.refresh_token);
        }
        this.currentUser.set(user);
        // Set the flag BEFORE the route guard can run on navigation —
        // if true, the guard will redirect to /change-password-required.
        this.mustChangePassword.set(user.must_change_password === true);
      })
    );
  }

  /**
   * Log out and clear local state. Even if the server call fails (e.g.
   * session already expired), we still clear local currentUser so the UI
   * reflects logged-out state. Matches the old hr.js behaviour:
   *
   *   try { await api('/api/hr/logout', { method: 'POST' }); } catch {}
   *   window.location.href = 'index.html';
   */
  logout(): Observable<void> {
    return this.api.post<void>('/api/hr/logout').pipe(
      tap(() => {
        this.jwt.clear();
        this.currentUser.set(null);
        this.mustChangePassword.set(false);
      }),
      catchError(() => {
        // Even if the server call fails, clear local state so the UI
        // reflects logged-out. Tokens are wiped regardless — keeping a
        // token after a "logout intent" is the kind of subtle bug that
        // bites later.
        this.jwt.clear();
        this.currentUser.set(null);
        this.mustChangePassword.set(false);
        return of(undefined as void);
      })
    );
  }

  /**
   * Change the logged-in user's password. Auto-routes to the admin or
   * HR endpoint based on which signal is populated — same shared
   * AccountMenu/ChangePasswordModal works for both roles without
   * needing to know which one is logged in.
   *
   * Backend requires the current password as a defense against session
   * hijack / drive-by changes (someone walking up to an unattended
   * browser). On success: session stays valid (no re-login needed).
   * On 401 (wrong current): error propagates so the modal surfaces it.
   */
  changePassword(current: string, next: string): Observable<void> {
    const path = this.currentAdmin()
      ? '/api/admin/change-password'
      : '/api/hr/change-password';
    return this.api.post<void>(path, {
      current_password: current,
      new_password: next,
    }).pipe(
      tap(() => {
        // Backend cleared must_change_password on success — mirror it
        // locally so the route guard immediately stops redirecting to
        // /change-password-required.
        this.mustChangePassword.set(false);
      }),
    );
  }

  /**
   * Anonymous endpoint — sends a reset email if the address belongs to
   * an HR account. Always resolves successfully regardless of the
   * outcome (the backend deliberately returns the same generic message
   * even for unknown emails / SMTP failures, to prevent enumeration).
   */
  forgotPassword(email: string): Observable<{ status: string; message: string }> {
    return this.api.post<{ status: string; message: string }>(
      '/api/hr/forgot-password',
      { email },
    );
  }

  // -------------------------------------------------------------------
  // Admin authentication — mirrors the HR methods above.
  // -------------------------------------------------------------------

  /** Silent admin-session probe. Always 200, no console noise on logged-out. */
  checkAdminSession(): Observable<AdminUser | null> {
    return this.api.get<AdminSessionStatusResponse>('/api/admin/session-status').pipe(
      map((res) => {
        const admin = res.logged_in ? res.user : null;
        this.currentAdmin.set(admin);
        // Same rationale as checkSession — refresh the must-change flag
        // on app boot. Note: HR + admin share this signal because a
        // tab is logged in as one role at a time.
        this.mustChangePassword.set(admin?.must_change_password === true);
        return admin;
      }),
      catchError((err: ApiError) => {
        this.currentAdmin.set(null);
        this.mustChangePassword.set(false);
        if (err.status === 401) {
          return of(null);
        }
        throw err;
      })
    );
  }

  /** POST /api/admin/login. 401 propagates so the form can show "Invalid…". */
  adminLogin(credentials: AdminLoginRequest): Observable<AdminUser> {
    return this.api.post<AdminUser>('/api/admin/login', credentials).pipe(
      tap((admin) => {
        // Same token-then-state ordering as HR login above.
        if (admin.access_token && admin.refresh_token) {
          this.jwt.setTokens(admin.access_token, admin.refresh_token);
        }
        this.currentAdmin.set(admin);
        this.mustChangePassword.set(admin.must_change_password === true);
      })
    );
  }

  /** Clears admin session both server-side and locally. Always succeeds. */
  adminLogout(): Observable<void> {
    return this.api.post<void>('/api/admin/logout').pipe(
      tap(() => {
        this.jwt.clear();
        this.currentAdmin.set(null);
        this.mustChangePassword.set(false);
      }),
      catchError(() => {
        this.jwt.clear();
        this.currentAdmin.set(null);
        this.mustChangePassword.set(false);
        return of(undefined as void);
      })
    );
  }
}