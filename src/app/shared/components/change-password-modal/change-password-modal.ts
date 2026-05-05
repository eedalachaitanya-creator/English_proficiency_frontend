import {
  Component,
  EventEmitter,
  HostListener,
  OnDestroy,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../../../core/services/auth.service';
import { ApiError } from '../../../core/services/api.service';

/**
 * Modal for the logged-in HR to change their own password.
 *
 * Self-contained: its own form, its own validation, its own POST. Emits
 * `closed` when the user cancels OR after a successful change. The
 * parent only needs to render the modal (via @if) and listen for closed.
 *
 * Validation:
 *   - current password: required, non-empty (backend re-checks via bcrypt)
 *   - new password: ≥ 6 chars (mirrors backend Pydantic floor)
 *   - confirm password: must equal new password
 *   - new must differ from current (cheap UX guard, not a security check)
 *
 * Failure modes:
 *   - 401 wrong current → "Current password is incorrect."
 *   - 422 too-short new → handled before POST, but if backend rejects we
 *                          surface its message
 *   - other → generic error
 */
@Component({
  selector: 'app-change-password-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './change-password-modal.html',
  styleUrl: './change-password-modal.css',
})
export class ChangePasswordModal implements OnDestroy {
  private auth = inject(AuthService);

  @Output() closed = new EventEmitter<void>();

  current = '';
  next = '';
  confirm = '';

  errorMessage = signal('');
  successMessage = signal('');
  submitting = signal(false);

  // Handle for the post-success auto-close timer. Tracked so it can be
  // cleared on early cancel / component destroy — prevents the timer
  // from firing onto a teardown lifecycle and emitting `closed` after
  // the parent has already moved on.
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    this._clearAutoCloseTimer();
  }

  /** Close on Escape — keyboard accessibility. Same guard as onCancel. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.onCancel();
  }

  onCancel(): void {
    if (this.submitting()) return; // can't cancel mid-flight
    this._clearAutoCloseTimer();
    this.closed.emit();
  }

  private _clearAutoCloseTimer(): void {
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  onSubmit(): void {
    this.errorMessage.set('');

    if (!this.current) {
      this.errorMessage.set('Enter your current password.');
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
        this.submitting.set(false);
        this.successMessage.set('Password changed successfully.');
        // Close after a short delay so the user sees the success state.
        // Stored so onCancel / ngOnDestroy can cancel — prevents the
        // timer from firing on a torn-down component.
        this.autoCloseTimer = setTimeout(() => {
          this.autoCloseTimer = null;
          this.closed.emit();
        }, 1200);
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        this.errorMessage.set(err.message || 'Could not change password.');
      },
    });
  }
}
