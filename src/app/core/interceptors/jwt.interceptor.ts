import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, switchMap, filter, take } from 'rxjs/operators';
import { JwtService } from '../services/jwt.service';
import { ApiService } from '../services/api.service';
import { RefreshTokenResponse } from '../models/hr.models';

// Module-level state. Shared across all interceptor invocations because
// only one refresh can be in flight at a time.
let isRefreshing = false;
const refreshSubject = new BehaviorSubject<string | null>(null);

// Paths the interceptor must NOT attach tokens to. These are the auth
// endpoints themselves — sending an expired access token to /refresh
// would defeat the entire point. The login endpoint also doesn't need
// a token (you don't have one yet when you're trying to log in).
const SKIP_AUTH_PATHS = [
  '/api/hr/login',
  '/api/hr/refresh',
  '/api/hr/forgot-password',
  '/api/hr/session-status',
  '/api/admin/login',
  '/api/admin/refresh',
  '/api/admin/session-status',
];

function shouldSkip(url: string): boolean {
  return SKIP_AUTH_PATHS.some((p) => url.includes(p));
}

function attachToken(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });
}

export const jwtInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const jwt = inject(JwtService);
  const api = inject(ApiService);
  const router = inject(Router);

  // 1. Don't touch auth endpoints. They must work without a token.
  if (shouldSkip(req.url)) {
    return next(req);
  }

  // 2. Attach the current access token (if we have one) and dispatch.
  const access = jwt.getAccessToken();
  const reqWithToken = access ? attachToken(req, access) : req;

  return next(reqWithToken).pipe(
    catchError((error: HttpErrorResponse) => {
      // Only handle 401s on protected calls. Other errors (404, 500,
      // network) propagate untouched.
      if (error.status !== 401) {
        return throwError(() => error);
      }

      // The 401 might mean "no token" (request was never authenticated
      // — propagate it, no point trying to refresh). Or "expired access
      // token" (refresh flow). Distinguish by whether we attached a
      // token in the first place.
      if (!access) {
        return throwError(() => error);
      }

      // We're in the "expired access token" case. Try to refresh.
      return handleRefreshAndRetry(req, next, jwt, api, router);
    }),
  );
};

function handleRefreshAndRetry(
  originalReq: HttpRequest<unknown>,
  next: HttpHandlerFn,
  jwt: JwtService,
  api: ApiService,
  router: Router,
): Observable<HttpEvent<unknown>> {
  // CASE A: A refresh is already in flight. Wait for it to finish, then
  // retry with whatever token comes out. The BehaviorSubject is the
  // queue — every concurrent caller subscribes and waits.
  if (isRefreshing) {
    return refreshSubject.pipe(
      filter((token) => token !== null),
      take(1),
      switchMap((token) => next(attachToken(originalReq, token!))),
    );
  }

  // CASE B: We're the first 401. Start a refresh.
  isRefreshing = true;
  refreshSubject.next(null);

  const refreshToken = jwt.getRefreshToken();
  if (!refreshToken) {
    // No refresh token at all — log the user out and bubble up the 401.
    isRefreshing = false;
    jwt.clear();
    router.navigate(['/login']);
    return throwError(() => new HttpErrorResponse({
      status: 401,
      statusText: 'No refresh token available',
    }));
  }

  // Try refreshing as HR first. If that 401s, try admin. Why try-both:
  // the interceptor doesn't know which role the user is — same access
  // token format for both. Backend will accept the matching one and
  // 401 the other.
  return tryRefresh(api, refreshToken, '/api/hr/refresh').pipe(
    catchError(() => tryRefresh(api, refreshToken, '/api/admin/refresh')),
    switchMap((response: RefreshTokenResponse) => {
      // Refresh worked. Save the new access token, unblock the queue,
      // retry the original request.
      jwt.setAccessToken(response.access_token);
      isRefreshing = false;
      refreshSubject.next(response.access_token);
      return next(attachToken(originalReq, response.access_token));
    }),
    catchError((refreshErr) => {
      // Both refresh attempts failed — the refresh token is dead.
      // Wipe everything and send the user to login.
      isRefreshing = false;
      refreshSubject.next(null);
      jwt.clear();
      router.navigate(['/login']);
      return throwError(() => refreshErr);
    }),
  );
}

function tryRefresh(
  api: ApiService,
  refreshToken: string,
  url: string,
): Observable<RefreshTokenResponse> {
  return api.post<RefreshTokenResponse>(url, { refresh_token: refreshToken });
}