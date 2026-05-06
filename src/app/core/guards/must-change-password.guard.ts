import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * Locks navigation to /change-password-required while the user is on
 * a temp credential.
 *
 * Decision tree:
 *   mustChangePassword() === true:
 *     - target IS /change-password-required → ALLOW
 *     - anything else → REDIRECT to /change-password-required
 *
 *   mustChangePassword() === false:
 *     - target IS /change-password-required → REDIRECT to the
 *       role-appropriate dashboard (or /login if not logged in)
 *     - anything else → ALLOW
 *
 * Two execution paths:
 *
 * **Sync path (most authenticated routes):** when this guard is paired
 * with a role auth guard (canActivate: [hrAuthGuard, mustChangePasswordGuard]),
 * the role guard's checkSession() runs first and populates the
 * must-change signal from the server. By the time this guard runs the
 * signal is up-to-date — read it synchronously and decide.
 *
 * **Async path (the forced-change route itself):** /change-password-required
 * does NOT have a role guard (deliberately — both HR and admin land on
 * the same component). On a fresh page load (refresh, deep link) the
 * signal is at its default `false`, and the sync path would incorrectly
 * redirect away. The async path probes session-status (admin first, HR
 * second — same order login.ts uses) BEFORE deciding, so refresh works
 * correctly.
 *
 * Distinguishing the two paths by `route.routeConfig?.path` keeps the
 * sync fast path for the common case and only pays for the async probe
 * on the rare deep-link-to-forced-route case.
 */
export const mustChangePasswordGuard: CanActivateFn = (
  route,
): boolean | UrlTree | Observable<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const onForcedChangeRoute = route.routeConfig?.path === 'change-password-required';

  // Sync path — the paired role guard already populated the signal.
  if (!onForcedChangeRoute) {
    return auth.mustChangePassword()
      ? router.createUrlTree(['/change-password-required'])
      : true;
  }

  // Async path — fresh load on the forced route, signal not yet
  // populated. Probe admin first then HR, mirroring login.ts so the
  // ordering stays consistent across the app. Whichever probe finds
  // an active session populates the must_change signal as a side
  // effect (see AuthService.checkAdminSession / checkSession).
  return auth.checkAdminSession().pipe(
    switchMap((admin) => {
      if (admin) {
        // Admin session active. Decide based on the (now populated) signal.
        return of(decideOnForcedRoute(auth, router));
      }
      // No admin session — try HR.
      return auth.checkSession().pipe(
        map((_user) => decideOnForcedRoute(auth, router)),
      );
    }),
    catchError(() => {
      // Network / server error — fail safe, send to login.
      return of(router.createUrlTree(['/login']));
    }),
  );
};

/**
 * After the session probe ran, decide what to do with a request for
 * /change-password-required:
 *   - Flag is true → ALLOW (this is exactly where they need to be).
 *   - Flag is false but logged in → role-appropriate dashboard
 *     (they don't need this page).
 *   - Flag is false and not logged in → /login.
 */
function decideOnForcedRoute(auth: AuthService, router: Router): boolean | UrlTree {
  if (auth.mustChangePassword()) return true;
  if (auth.currentAdmin()) return router.createUrlTree(['/admin/dashboard']);
  if (auth.currentUser()) return router.createUrlTree(['/dashboard']);
  return router.createUrlTree(['/login']);
}
