import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChangePasswordModal } from '../change-password-modal/change-password-modal';

/**
 * Account avatar + dropdown menu for the topnav.
 *
 * Renders a circular avatar (first letter of the user's name, or email
 * if name is empty) that opens a dropdown when clicked. The dropdown
 * shows: name + email header, "Change Password" item, and "Logout" item.
 *
 * Embeds the ChangePasswordModal directly so each parent page only has
 * to drop in this one component — no duplicated modal-wrangling logic
 * across the 6+ HR-facing pages. Logout is still emitted up to the
 * parent because logout means "navigate to /login + clear AuthService
 * state" which is page-context-specific.
 *
 * Outside-click and Escape both close the dropdown.
 */
@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [CommonModule, ChangePasswordModal],
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.css',
})
export class AccountMenu {
  /** Display name. Falls back to the part of the email before "@" if empty. */
  @Input() name = '';
  /** Login email — shown under the name in the dropdown header. */
  @Input() email = '';
  /** Whether to render a "Change Password" item. Admins might pass false
   * if they want to disable in-product password change. Default true. */
  @Input() showChangePassword = true;

  @Output() logout = new EventEmitter<void>();

  open = signal(false);
  modalOpen = signal(false);

  // First-letter avatar — name takes priority, fall back to email-local-part,
  // fall back to "?". Always uppercase. Two-character avatar (initials) was
  // considered but most "Sinchana" / "Annapoorna" style names look fine
  // with a single big letter, and it stays simple.
  initial = computed(() => {
    const source = this.name?.trim() || this.email?.split('@')[0] || '?';
    return source.charAt(0).toUpperCase();
  });

  // Display name in the dropdown header. Falls back to the email-local-part
  // ("alice" from "alice@x.com") when name is missing — better than blank.
  displayName = computed(() => {
    return this.name?.trim() || this.email?.split('@')[0] || 'Account';
  });

  private host = inject(ElementRef);

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onChangePassword(): void {
    this.close();
    this.modalOpen.set(true);
  }

  onModalClosed(): void {
    this.modalOpen.set(false);
  }

  onLogout(): void {
    this.close();
    this.logout.emit();
  }

  /** Close on click outside the avatar+menu wrapper. */
  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  /** Close on Escape — keyboard accessibility. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.close();
  }
}
