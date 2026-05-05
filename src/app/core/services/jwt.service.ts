import { Injectable, signal, computed } from '@angular/core';

/**
 * JwtService — owner of access + refresh tokens in localStorage.
 *
 * Why localStorage and not sessionStorage:
 *   - Survives browser/tab close, so HR users stay logged in across
 *     workday breaks (until the refresh token's 1-day expiry).
 *   - sessionStorage would force re-login every time they close a tab.
 *
 * Why localStorage and not a cookie (for the access token):
 *   - The access token rides in the Authorization header, not as a
 *     cookie. The header approach is what makes JWT stateless on the
 *     backend (no cookie parsing, no CORS-credentials dance).
 *   - The refresh token is also in localStorage here for simplicity —
 *     a more paranoid setup would put it in an HttpOnly cookie. We're
 *     keeping it in localStorage per the simple-design choice.
 *
 * Trade-off acknowledged: localStorage is readable by any JavaScript
 * running on the page, which means an XSS bug = token theft. The team
 * needs to take XSS prevention seriously: never use innerHTML with
 * untrusted content, always escape output, use Angular's built-in
 * sanitizer for HTML bindings.
 *
 * Reactive state:
 *   - hasToken signal lets components react to login/logout. The
 *     existing AuthService.currentUser already serves this purpose
 *     for most cases; hasToken is provided in case anything needs it
 *     before currentUser is populated (e.g., on app boot).
 */
@Injectable({ providedIn: 'root' })
export class JwtService {
  private readonly ACCESS_KEY = 'ept.jwt.access';
  private readonly REFRESH_KEY = 'ept.jwt.refresh';

  // hasToken is a reactive signal so the rest of the app can react to
  // login/logout without manually polling localStorage. Initialized
  // from whatever's already in storage so refreshing the page doesn't
  // forget the user.
  private readonly tokenPresent = signal<boolean>(this.readAccess() !== null);

  /** Read-only signal: true when an access token is currently stored. */
  readonly hasToken = computed(() => this.tokenPresent());

  /**
   * Save both tokens after a successful login. Called from AuthService.
   * The access_token is what gets attached to every API request; the
   * refresh_token is exchanged at /api/hr/refresh when access expires.
   */
  setTokens(access: string, refresh: string): void {
    try {
      localStorage.setItem(this.ACCESS_KEY, access);
      localStorage.setItem(this.REFRESH_KEY, refresh);
      this.tokenPresent.set(true);
    } catch {
      // localStorage can throw in incognito mode (Safari) or when the
      // user has explicitly disabled storage. The login API call still
      // succeeded, but we have nowhere durable to put the token. Best
      // we can do: the next page load will require re-login. The user
      // experiences this as "I just logged in but it forgot me on
      // refresh" — annoying, but not a security issue.
      console.warn('[jwt] localStorage unavailable, tokens not persisted');
    }
  }

  /**
   * Replace ONLY the access token after a successful refresh. The
   * refresh token isn't rotated in this design — it stays valid until
   * its 1-day expiry, regardless of how many times we /refresh.
   */
  setAccessToken(access: string): void {
    try {
      localStorage.setItem(this.ACCESS_KEY, access);
      this.tokenPresent.set(true);
    } catch {
      console.warn('[jwt] localStorage unavailable, access token not persisted');
    }
  }

  /** Get the current access token, or null if not logged in. */
  getAccessToken(): string | null {
    return this.readAccess();
  }

  /** Get the current refresh token, or null if not logged in. */
  getRefreshToken(): string | null {
    try {
      return localStorage.getItem(this.REFRESH_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Wipe both tokens. Called on logout AND on hard-failure refresh
   * (when even /refresh returns 401, meaning the refresh token has
   * expired or was revoked — user MUST log in again).
   */
  clear(): void {
    try {
      localStorage.removeItem(this.ACCESS_KEY);
      localStorage.removeItem(this.REFRESH_KEY);
    } catch {
      // Ignore — if we can't even remove keys, the user's storage is
      // probably toast and they're about to be asked to log in anyway.
    }
    this.tokenPresent.set(false);
  }

  // ------------- internal -------------

  private readAccess(): string | null {
    try {
      return localStorage.getItem(this.ACCESS_KEY);
    } catch {
      return null;
    }
  }
}