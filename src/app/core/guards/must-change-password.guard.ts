import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
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
 *     - target IS /change-password-required → REDIRECT to /login
 *       (we don't know which dashboard belongs here, and the user
 *       arriving with the flag clear is either anonymous or already
 *       has a normal session — sending them to /login lets the
 *       existing session-status probe route them correctly)
 *     - anything else → ALLOW
 *
 * Apply this AFTER the role-specific auth guard so checkSession /
 * checkAdminSession have already populated the must-change signal:
 *
 *   canActivate: [hrAuthGuard, mustChangePasswordGuard]
 *
 * The role guard's checkSession() calls also refresh
 * mustChangePassword, so by the time this guard runs the signal is
 * up-to-date with server state.
 */
export const mustChangePasswordGuard: CanActivateFn = (
  route,
): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const must = auth.mustChangePassword();
  const onForcedChangeRoute = route.routeConfig?.path === 'change-password-required';

  if (must && !onForcedChangeRoute) {
    return router.createUrlTree(['/change-password-required']);
  }
  if (!must && onForcedChangeRoute) {
    // Stale link — user no longer needs to change password. Bounce
    // to /login; the session-status probe there will route them on
    // to the right dashboard if they're still logged in.
    return router.createUrlTree(['/login']);
  }
  return true;
};
