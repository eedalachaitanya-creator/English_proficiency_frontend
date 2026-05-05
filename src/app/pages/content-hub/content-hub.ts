import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';

/**
 * Landing page for HR content authoring (/dashboard/content).
 *
 * Shows 4 cards — passages, questions, writing topics, speaking topics —
 * each linking to a dedicated CRUD list page. The actual list pages will
 * be added in subsequent phases.
 */
@Component({
  selector: 'app-content-hub',
  standalone: true,
  imports: [CommonModule, RouterLink, Topnav, Footer, AccountMenu],
  templateUrl: './content-hub.html',
  styleUrl: './content-hub.css',
})
export class ContentHub {
  private auth = inject(AuthService);
  private router = inject(Router);

  hrEmail = computed(() => this.auth.currentUser()?.email ?? 'Loading…');
  hrName = computed(() => this.auth.currentUser()?.name ?? '');

  onLogout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }
}