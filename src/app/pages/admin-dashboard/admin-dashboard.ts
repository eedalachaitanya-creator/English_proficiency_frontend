import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService, ApiError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import {
  HRSummary,
  HRCreateByAdminRequest,
  HRCreateByAdminResponse,
} from '../../core/models/hr.models';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';

/**
 * Admin portal — manage HR accounts.
 *
 * KPI ("Total HR accounts: N") + a table of HR rows + a "Create New HR"
 * modal. Admins do NOT have access to the candidate dashboard or any
 * candidate-facing functionality (separation of concerns — see the spec).
 *
 * On success, the create-HR modal shows the email-delivery status the
 * backend returned (sent | failed). If failed, the admin sees the SMTP
 * reason and can share credentials manually.
 */
@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, Topnav, Footer, AccountMenu],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboard implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  // Admin profile (loaded from /api/admin/me) — drives the topnav
  // AccountMenu. The dropdown header shows name + email; AccountMenu
  // also embeds the change-password modal which auto-routes to the
  // admin endpoint via AuthService.changePassword.
  adminName = computed(() => this.auth.currentAdmin()?.name ?? '');
  adminEmail = computed(() => this.auth.currentAdmin()?.email ?? 'Loading…');

  // Table state
  loading = signal(false);
  loadError = signal('');
  hrs = signal<HRSummary[]>([]);
  totalHrs = computed(() => this.hrs().length);

  // Create-HR modal state
  modalOpen = signal(false);
  newName = '';
  newEmail = '';
  newPassword = '';
  newPasswordConfirm = '';
  createSubmitting = signal(false);
  createError = signal('');
  // After a successful create, persist the result so the admin can see
  // whether the welcome email was sent (and the failure reason if not).
  // Cleared when the modal is reopened.
  lastCreated = signal<HRCreateByAdminResponse | null>(null);

  ngOnInit(): void {
    this.loadHrs();
  }

  loadHrs(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api.get<HRSummary[]>('/api/admin/hrs').subscribe({
      next: (rows) => {
        this.hrs.set(rows);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.loading.set(false);
        // 401 means the session expired or someone hit /admin/dashboard
        // without admin auth — bounce back to the login page where they
        // can re-authenticate via the admin card.
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        this.loadError.set(err.message || 'Could not load HR accounts.');
      },
    });
  }

  openCreate(): void {
    this.newName = '';
    this.newEmail = '';
    this.newPassword = '';
    this.newPasswordConfirm = '';
    this.createError.set('');
    this.lastCreated.set(null);
    this.createSubmitting.set(false);
    this.modalOpen.set(true);
  }

  closeCreate(): void {
    this.modalOpen.set(false);
  }

  submitCreate(): void {
    this.createError.set('');

    const name = this.newName.trim();
    const email = this.newEmail.trim();

    if (!name) {
      this.createError.set('Name is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.createError.set('Enter a valid email address.');
      return;
    }
    if (this.newPassword.length < 6) {
      this.createError.set('Password must be at least 6 characters.');
      return;
    }
    if (this.newPassword !== this.newPasswordConfirm) {
      this.createError.set('Passwords do not match.');
      return;
    }

    const body: HRCreateByAdminRequest = {
      name,
      email,
      password: this.newPassword,
    };

    this.createSubmitting.set(true);
    this.api.post<HRCreateByAdminResponse>('/api/admin/hrs', body).subscribe({
      next: (res) => {
        this.createSubmitting.set(false);
        this.lastCreated.set(res);
        // Refresh the table so the new row shows up immediately.
        this.loadHrs();
      },
      error: (err: ApiError) => {
        this.createSubmitting.set(false);
        // 409 = email already in use (see routes/admin.py create_hr).
        // 422 = validation error from Pydantic.
        // 401 = session expired — bounce to login.
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        this.createError.set(err.message || 'Could not create HR account.');
      },
    });
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  onLogout(): void {
    this.auth.adminLogout().subscribe(() => this.router.navigate(['/login']));
  }
}
