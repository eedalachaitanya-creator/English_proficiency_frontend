import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { ApiError } from '../../core/services/api.service';

/**
 * Forced-change-password screen.
 *
 * Shown when AuthService.mustChangePassword() is true — the user just
 * logged in with a temp password from /forgot-password and the route
 * guard is locking everything else until they pick a permanent
 * password. The guard redirects to this page; on success, this page
 * sets mustChangePassword to false (AuthService.changePassword does
 * that internally) and navigates back to the role-appropriate
 * dashboard.
 *
 * Minimal chrome — no top-nav, no sidebar, no other navigation. Two
 * actions only: "Set new password" (the form submit) or "Log out".
 * Closing the tab or refreshing keeps the user on this screen
 * because the must-change flag is server-side state, refreshed by
 * /session-status on app boot.
 *
 * Both roles use the same component. AuthService.changePassword()
 * auto-routes to /api/hr/change-password vs /api/admin/change-password
 * based on which role-signal is populated.
 */
@Component({
  selector: 'app-change-password-required',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './change-password-required.html',
  styleUrl: './change-password-required.css',
})
export class ChangePasswordRequiredPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  current = '';
  next = '';
  confirm = '';

  errorMessage = signal('');
  submitting = signal(false);

  /** Display name for the greeting. Pulls from whichever role-signal
   * is populated; falls back to empty string so the greeting reads
   * gracefully if the user object somehow hasn't loaded. */
  readonly displayName = computed(() => {
    return this.auth.currentAdmin()?.name
        ?? this.auth.currentUser()?.name
        ?? '';
  });

  /** Where to land after a successful password change. */
  private dashboardUrl(): string {
    return this.auth.currentAdmin() ? '/admin/dashboard' : '/dashboard';
  }

  /** Which logout method to call. */
  private logoutObservable() {
    return this.auth.currentAdmin()
      ? this.auth.adminLogout()
      : this.auth.logout();
  }

  onSubmit(): void {
    this.errorMessage.set('');

    if (!this.current) {
      this.errorMessage.set('Enter your current (temporary) password.');
      return;
    }
    if (this.next.length < 6) {
      this.errorMessage.set('New password must be at least 6 characters.');
      return;
    }
    if (this.next !== this.confirm) {
      this.errorMessage.set('New passwords do not match.');
      return;
    }
    if (this.next === this.current) {
      this.errorMessage.set('New password must differ from your current one.');
      return;
    }

    this.submitting.set(true);
    this.auth.changePassword(this.current, this.next).subscribe({
      next: () => {
        // AuthService.changePassword already cleared the must-change
        // signal in its tap. The guard now sees the flag as false
        // and lets the dashboard route through.
        this.router.navigateByUrl(this.dashboardUrl());
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        this.errorMessage.set(err.message || 'Could not change password.');
      },
    });
  }

  onLogout(): void {
    // Don't disable while submitting — the user might want to bail
    // mid-typing if they realize they don't actually have the temp
    // password. The logout call clears all auth state regardless of
    // any in-flight changePassword.
    this.logoutObservable().subscribe({
      next: () => this.router.navigateByUrl('/login'),
      error: () => this.router.navigateByUrl('/login'),
    });
  }
}
