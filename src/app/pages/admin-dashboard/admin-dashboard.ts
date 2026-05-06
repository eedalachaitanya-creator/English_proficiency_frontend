import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService, ApiError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import {
  AdminUserSummary,
  HRCreateByAdminRequest,
  HRCreateByAdminResponse,
  PaginatedScoreSummary,
  ResultRow,
} from '../../core/models/hr.models';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';

/**
 * Admin portal — manage HR + admin accounts.
 *
 * Top-level table lists every row in hr_admins (both roles) with a
 * count of how many invitations they've sent. HR rows are expandable:
 * clicking one toggles a nested panel below it that renders that HR's
 * candidate-results in a sub-table mirroring the HR dashboard's own
 * results view. Admins are non-clickable (they can't send invites).
 *
 * The candidate sub-table is server-side paginated at 25/page so a
 * busy HR doesn't ship hundreds of rows. Pages are cached per HR id;
 * collapsing and re-opening the same row reuses the latest cached
 * page without a re-fetch.
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
  // AccountMenu. The dropdown header shows name + email.
  adminName = computed(() => this.auth.currentAdmin()?.name ?? '');
  adminEmail = computed(() => this.auth.currentAdmin()?.email ?? 'Loading…');

  // -------- User table state --------
  loading = signal(false);
  loadError = signal('');
  users = signal<AdminUserSummary[]>([]);
  totalUsers = computed(() => this.users().length);

  // -------- Expandable-row state --------
  /**
   * Currently-expanded HR id, or null if no row is expanded. Single-
   * row expansion (clicking row B collapses row A) — keeps the page
   * compact and avoids juggling multiple sub-tables at once.
   */
  expandedHrId = signal<number | null>(null);

  /**
   * Cache of candidate pages keyed by HR id. Populated on first
   * expand and on prev/next; collapsing a row keeps the cache so
   * re-opening doesn't re-fetch the last viewed page. Cleared on
   * logout (component re-instantiates).
   *
   * The signal wraps the Map to make Angular re-render when the Map
   * mutates — the change-detection comparison is reference-based, so
   * we always set a fresh Map after any mutation.
   */
  candidatesByHrId = signal<Map<number, PaginatedScoreSummary>>(new Map());

  /** id of the HR whose page is currently fetching, for the spinner. */
  candidatesLoading = signal<number | null>(null);

  /** Per-HR error from the last fetch attempt. Cleared on next try. */
  candidatesErrorByHrId = signal<Map<number, string>>(new Map());

  /** Server-side page size — matches the spec. */
  readonly pageSize = 25;

  // -------- Create-HR modal state --------
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
    this.loadUsers();
  }

  // ============================================================
  // Top-level user table
  // ============================================================

  loadUsers(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api.get<AdminUserSummary[]>('/api/admin/users').subscribe({
      next: (rows) => {
        this.users.set(rows);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.loading.set(false);
        // 401 = session expired. 403 with code='must_change_password'
        // is intercepted globally by jwt.interceptor and the user is
        // routed to /change-password-required — so we don't need to
        // handle it here.
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        this.loadError.set(err.message || 'Could not load users.');
      },
    });
  }

  // ============================================================
  // Expand / collapse
  // ============================================================

  /**
   * Click handler for a user row. Admin rows are non-clickable
   * (handled by *ngIf in the template), so this is only invoked for
   * HR rows. Toggles single-row expansion: if clicking the already-
   * expanded row, collapse; otherwise switch to that row and fetch
   * page 1 if not already cached.
   */
  toggleExpand(user: AdminUserSummary): void {
    if (user.role !== 'hr') return; // defensive — template should prevent this
    const current = this.expandedHrId();
    if (current === user.id) {
      this.expandedHrId.set(null);
      return;
    }
    this.expandedHrId.set(user.id);
    if (!this.candidatesByHrId().has(user.id)) {
      this.fetchCandidatesPage(user.id, 1);
    }
  }

  isExpanded(hrId: number): boolean {
    return this.expandedHrId() === hrId;
  }

  /** Page currently in the cache for this HR, or null if not yet fetched. */
  candidatesPageFor(hrId: number): PaginatedScoreSummary | null {
    return this.candidatesByHrId().get(hrId) ?? null;
  }

  /** Items array — empty if not yet fetched (template renders spinner). */
  candidatesItemsFor(hrId: number): ResultRow[] {
    return this.candidatesPageFor(hrId)?.items ?? [];
  }

  /** Total pages for the given HR's candidate list. Min 1 so empty
   * state still reads "Page 1 of 1". */
  totalPagesFor(hrId: number): number {
    const page = this.candidatesPageFor(hrId);
    if (!page) return 1;
    return Math.max(1, Math.ceil(page.total / page.page_size));
  }

  /** Convenience: is this HR's page currently being fetched? */
  isCandidatesLoading(hrId: number): boolean {
    return this.candidatesLoading() === hrId;
  }

  candidatesErrorFor(hrId: number): string {
    return this.candidatesErrorByHrId().get(hrId) ?? '';
  }

  // ============================================================
  // Pagination
  // ============================================================

  /** Fetch a specific page from the backend and cache it. */
  fetchCandidatesPage(hrId: number, page: number): void {
    this.candidatesLoading.set(hrId);
    // Clear the previous error for this HR before retrying.
    this._setCandidatesError(hrId, '');

    const url = `/api/admin/hrs/${hrId}/candidates?page=${page}&page_size=${this.pageSize}`;
    this.api.get<PaginatedScoreSummary>(url).subscribe({
      next: (res) => {
        const next = new Map(this.candidatesByHrId());
        next.set(hrId, res);
        this.candidatesByHrId.set(next);
        this.candidatesLoading.set(null);
      },
      error: (err: ApiError) => {
        this.candidatesLoading.set(null);
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        if (err.status === 404) {
          this._setCandidatesError(hrId, 'HR not found or has no candidates.');
          return;
        }
        this._setCandidatesError(hrId, err.message || 'Could not load candidates.');
      },
    });
  }

  prevPage(hrId: number): void {
    const page = this.candidatesPageFor(hrId);
    if (!page || page.page <= 1) return;
    this.fetchCandidatesPage(hrId, page.page - 1);
  }

  nextPage(hrId: number): void {
    const page = this.candidatesPageFor(hrId);
    if (!page) return;
    if (page.page >= this.totalPagesFor(hrId)) return;
    this.fetchCandidatesPage(hrId, page.page + 1);
  }

  private _setCandidatesError(hrId: number, message: string): void {
    const next = new Map(this.candidatesErrorByHrId());
    if (message) {
      next.set(hrId, message);
    } else {
      next.delete(hrId);
    }
    this.candidatesErrorByHrId.set(next);
  }

  // ============================================================
  // Display helpers — keep parity with the HR dashboard's own table
  // so the sub-table looks identical to what HR sees for their own
  // candidates.
  // ============================================================

  formatDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatSubmittedDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /** Short chip rendered next to the candidate's name showing which
   * sections that test included. "R·W·S" if all three; subset if HR
   * disabled some. */
  sectionsChip(r: ResultRow): string {
    const parts: string[] = [];
    if (r.include_reading) parts.push('R');
    if (r.include_writing) parts.push('W');
    if (r.include_speaking) parts.push('S');
    return parts.join('·');
  }

  sectionsTooltip(r: ResultRow): string {
    const parts: string[] = [];
    if (r.include_reading) parts.push('Reading');
    if (r.include_writing) parts.push('Writing');
    if (r.include_speaking) parts.push('Speaking');
    return `Sections: ${parts.join(' + ')}`;
  }

  ratingLabel(rating: ResultRow['rating']): string {
    switch (rating) {
      case 'recommended': return 'Recommended';
      case 'borderline': return 'Borderline';
      case 'not_recommended': return 'Not Recommended';
      default: return 'pending';
    }
  }

  /**
   * Rating-badge color modifier. Matches the HR dashboard's mapping
   * exactly — uses the semantic class names ('reviewed', 'new',
   * 'flagged') that are defined in src/styles.css; the previous
   * 'badge-green' etc. names didn't exist anywhere and rendered as
   * white-on-transparent (invisible).
   */
  ratingClass(rating: ResultRow['rating']): string {
    switch (rating) {
      case 'recommended': return 'reviewed';
      case 'borderline': return 'new';
      case 'not_recommended': return 'flagged';
      default: return '';
    }
  }

  // ============================================================
  // Create-HR modal — unchanged from prior implementation
  // ============================================================

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
        this.loadUsers();
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

  onLogout(): void {
    this.auth.adminLogout().subscribe(() => this.router.navigate(['/login']));

    sessionStorage.clear();

    this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
      this.router.navigate(['/login']);
    });
  }
}
