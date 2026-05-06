import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../../../core/services/auth.service';
import { ApiError } from '../../../core/services/api.service';

/**
 * Forgot-password modal — single email field. Role-aware: posts to
 * /api/hr/forgot-password by default, or /api/admin/forgot-password
 * when the parent passes [role]="'admin'".
 *
 * The backend always returns 200 with the same generic message
 * regardless of whether the email exists or matches the role, so this
 * modal does NOT branch on success vs "no such user" — both render
 * the same confirmation. This is the email-enumeration defense; the
 * modal surfaces the same message verbatim so the UI doesn't
 * accidentally leak which emails are real accounts. (The admin
 * endpoint also silently rejects HR emails and vice versa, which is
 * why the modal can stay agnostic.)
 *
 * Backdrop click, Cancel, and Escape all close the modal. After a
 * successful submit, the success card auto-closes after 2 seconds
 * (longer than change-password's 1.2s because the user needs time to
 * read "check your email").
 */
@Component({
  selector: 'app-forgot-password-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './forgot-password-modal.html',
  styleUrl: './forgot-password-modal.css',
})
export class ForgotPasswordModal {
  private auth = inject(AuthService);

  /** Which endpoint to post to. Defaults to 'hr' for backward compat
   * with any existing callers that don't pass [role]. */
  @Input() role: 'hr' | 'admin' = 'hr';

  @Output() closed = new EventEmitter<void>();

  email = '';
  errorMessage = signal('');
  successMessage = signal('');
  submitting = signal(false);

  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    this._clearAutoCloseTimer();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.onCancel();
  }

  onCancel(): void {
    if (this.submitting()) return;
    this._clearAutoCloseTimer();
    this.closed.emit();
  }

  onSubmit(): void {
    this.errorMessage.set('');
    const email = this.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorMessage.set('Enter a valid email address.');
      return;
    }

    this.submitting.set(true);
    const request$ = this.role === 'admin'
      ? this.auth.adminForgotPassword(email)
      : this.auth.forgotPassword(email);
    request$.subscribe({
      next: (res) => {
        this.submitting.set(false);
        // Display the backend's generic message verbatim. Same string
        // for "email exists, sent" and "email not found" — UI must not
        // branch, otherwise it'd leak the existence check.
        this.successMessage.set(res.message);
        this.autoCloseTimer = setTimeout(() => {
          this.autoCloseTimer = null;
          this.closed.emit();
        }, 2000);
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        // Only real network/server errors land here; the backend
        // returns 200 even for unknown emails. Validation errors (bad
        // email format) come back as 422 with a `detail` array — the
        // ApiService formats those into the message.
        this.errorMessage.set(err.message || 'Could not send reset email.');
      },
    });
  }

  private _clearAutoCloseTimer(): void {
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }
}
