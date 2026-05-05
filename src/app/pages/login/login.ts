import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { ApiError } from '../../core/services/api.service';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';

/**
 * Combined login page — two side-by-side cards:
 *   - HR Sign In  → POST /api/hr/login → /dashboard
 *   - Admin Sign In → POST /api/admin/login → /admin/dashboard
 *
 * On mount, probes BOTH /api/hr/session-status and /api/admin/session-status
 * and redirects automatically if either has a live session. The two probes
 * are independent (different role checks server-side), so an HR session
 * never surfaces on the admin probe and vice versa.
 *
 * State is duplicated per card (hrEmail/adminEmail, hrSubmitting/adminSubmitting,
 * etc.) so the two forms can be filled and submitted independently — useful
 * when an admin who's also got an HR account on the side wants to switch
 * which one they're logging in as without retyping.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, Topnav, Footer],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  // HR card state
  hrEmail = '';
  hrPassword = '';
  hrError = signal('');
  hrSubmitting = signal(false);

  // Admin card state
  adminEmail = '';
  adminPassword = '';
  adminError = signal('');
  adminSubmitting = signal(false);

  ngOnInit(): void {
    // Two parallel session probes. Whichever reports logged_in first wins
    // and we redirect. Both endpoints always return 200 (no console 401s).
    this.auth.checkSession().subscribe({
      next: (user) => {
        if (user) this.router.navigate(['/dashboard']);
      },
      error: () => {},
    });
    this.auth.checkAdminSession().subscribe({
      next: (admin) => {
        if (admin) this.router.navigate(['/admin/dashboard']);
      },
      error: () => {},
    });
  }

  onHrSubmit(): void {
    this.hrError.set('');
    const email = this.hrEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.hrError.set('Enter a valid email address.');
      return;
    }
    if (!this.hrPassword) {
      this.hrError.set('Password is required.');
      return;
    }

    this.hrSubmitting.set(true);
    this.auth.login({ email, password: this.hrPassword }).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err: ApiError) => {
        this.hrSubmitting.set(false);
        this.hrError.set(err.message || 'Login failed.');
      },
    });
  }

  onAdminSubmit(): void {
    this.adminError.set('');
    const email = this.adminEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.adminError.set('Enter a valid email address.');
      return;
    }
    if (!this.adminPassword) {
      this.adminError.set('Password is required.');
      return;
    }

    this.adminSubmitting.set(true);
    this.auth.adminLogin({ email, password: this.adminPassword }).subscribe({
      next: () => this.router.navigate(['/admin/dashboard']),
      error: (err: ApiError) => {
        this.adminSubmitting.set(false);
        this.adminError.set(err.message || 'Login failed.');
      },
    });
  }
}
