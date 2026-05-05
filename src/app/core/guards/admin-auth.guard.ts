import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, map, catchError, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ApiError } from '../services/api.service';

/**
 * Route guard for admin-only pages (anything under /admin/*).
 *
 * Mirrors hr-auth.guard.ts: probes /api/admin/session-status (which always
 * returns 200) and ALLOWs only when role === 'admin' is in session;
 * otherwise REDIRECTs to /login. Backend's session-status endpoint already
 * filters HR sessions out, so a logged-in HR who navigates to /admin/...
 * gets bounced to the login page where they can sign in via the admin card.
 */
export const adminAuthGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.checkAdminSession().pipe(
    map((admin): boolean | UrlTree => {
      if (admin) return true;
      return router.createUrlTree(['/login']);
    }),
    catchError((_err: ApiError): Observable<UrlTree> => {
      return of(router.createUrlTree(['/login']));
    })
  );
};
