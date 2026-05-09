import { Component, OnInit, inject, signal, computed, Renderer2  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ApiService, ApiError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import {
  ResultRow,
  InviteCreateRequest,
  InviteCreateResponse,
  SupportedTimezone,
} from '../../core/models/hr.models';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';
import { wallClockToUtc } from '../../core/utils/timezone';
import { formatBackendDate, formatBackendDateTime } from '../../core/utils/date';
import { copyToClipboard } from '../../core/utils/clipboard';
import { Sidebar } from '../../shared/components/sidebar/sidebar';

/**
 * HR Dashboard — list view only.
 *
 * Phase 4 changes (this file):
 *   - REMOVED: detail panel rendering (now lives at /dashboard/candidate/:id)
 *   - REMOVED: selectedRow / detail / detailLoading / detailError state
 *   - REMOVED: onRowClick() loading detail inline
 *   - CHANGED: row click navigates to /dashboard/candidate/:id instead
 *   - ADDED: pagination (10 rows per page)
 *
 * Retained:
 *   - Auth + session check
 *   - KPI cards
 *   - Search + status filter
 *   - Logout
 *   - + INVITE NEW CANDIDATE button + invite modal
 *
 * The page is now noticeably shorter and faster to scan.
 */
// wallClockToUtc lives in core/utils/timezone — shared with the
// resend-invitation modal in candidate-detail.

@Component({
  selector: 'app-hr-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, Topnav, Footer, AccountMenu, Sidebar],
  templateUrl: './hr-dashboard.html',
  styleUrl: './hr-dashboard.css',
})
export class HrDashboard implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  constructor(
  private renderer: Renderer2
) {}
 

resultsCount = this.api.resultsCount;

  // -------- List/filter state --------
  loading = signal(true);
  loadError = signal('');
  allResults = signal<ResultRow[]>([]);
  filteredResults = signal<ResultRow[]>([]);

  searchQuery = '';
  statusFilter: '' | 'submitted' | 'pending' = '';

  // -------- Download state --------
  /**
   * True while the bulk Excel export is being generated. Disables the
   * Export button so a double-click doesn't fire two parallel downloads.
   */
  exportingExcel = signal(false);

  /**
   * Holds the invitation_id of the row currently generating a PDF, or null
   * if no PDF download is in flight. Used to:
   *   1. Disable the clicked PDF button so it can't fire twice
   *   2. Show a "…" loading indicator on that specific row
   * Only one PDF download can be in flight at a time per HR — they're fast
   * (200-500ms), so queuing is unnecessary.
   */
  downloadingPdfFor = signal<number | null>(null);

  // -------- Pagination state --------
  /** 1-indexed page number. The user-visible "page 1" maps to filteredResults[0..9]. */
  currentPage = signal(1);

  /** How many rows to show per page. Matches the old hr.js default. */
  readonly pageSize = 10;

  /**
   * Slice of filteredResults for the currently visible page.
   * Recomputes when filteredResults or currentPage changes.
   */
  pagedResults = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredResults().slice(start, end);
  });

  /** Total page count, minimum 1 (so the UI shows "Page 1 of 1" even when empty). */
  totalPages = computed(() => {
    const total = this.filteredResults().length;
    return Math.max(1, Math.ceil(total / this.pageSize));
  });

  // -------- KPI computations (unchanged from Phase 3) --------
  kpiTotal = computed(() => this.allResults().length);
  kpiSubmitted = computed(() => this.allResults().filter((r: ResultRow) => r.submitted_at).length);
  kpiPending = computed(() => this.kpiTotal() - this.kpiSubmitted());

  hrEmail = computed(() => this.auth.currentUser()?.email ?? 'Loading…');
  hrName = computed(() => this.auth.currentUser()?.name ?? '');

  // -------- Invite modal state --------
  inviteOpen = signal(false);
  invName = '';
  invEmail = '';
  invDifficulty: 'intermediate' | 'expert' = 'intermediate';
  // Scheduled URL window — split into one date + two times (start/end on the
  // same day). Bound to native <input type="date"> ("YYYY-MM-DD") and
  // <input type="time"> ("HH:MM"). Combined into ISO UTC before POST.
  invDate = '';
  invStartTime = '';
  invEndTime = '';
  // IANA timezone the HR picked. Defaults to IST since most users are in
  // India; the dropdown lists 7 supported zones (IST + 6 US zones). Keep
  // these in sync with backend schemas.ALLOWED_TIMEZONES — the backend
  // rejects any zone not in its allowlist with HTTP 422.
  invTimezone: string = 'Asia/Kolkata';
  // Per-invitation section selection. All checked by default so the
  // common case (full test) needs zero clicks. The Generate Link button
  // is disabled when all three are unchecked — backend also rejects.
  invIncludeReading = true;
  invIncludeWriting = true;
  invIncludeSpeaking = true;
  inviteSubmitting = signal(false);
  inviteError = signal('');
  inviteResult = signal<InviteCreateResponse | null>(null);
  inviteCopied = signal(false);

  // -------- Timezone dropdown options --------
  // Fetched from GET /api/hr/timezones every time the invite modal opens.
  // No caching: instant freshness is the requirement — any zone added or
  // disabled in the DB is reflected on the next modal open. At our scale
  // (5–10 HRs) the per-request DB query is invisible; if traffic grows
  // we can add a 30-second TTL cache without changing this contract.
  availableTimezones = signal<SupportedTimezone[]>([]);
  timezonesLoading = signal(false);
  timezonesError = signal('');

  // -------- Toast state --------
  // Small notification banner shown briefly at the top of the page after
  // a successful invitation (the modal closes immediately on success).
  // We use a single signal pair instead of building a full Toast component
  // because there's only one place we need this and the markup is small.
  toastMessage = signal('');
  toastVisible = signal(false);
  /** Tracks the auto-dismiss timer so a second toast cancels the first. */
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // -------- Lifecycle --------
  ngOnInit(): void {
    this.auth.checkSession().subscribe({
      next: (user) => {
        if (!user) {
          this.router.navigate(['/login']);
          return;
        }
        this.loadResults();
      },
      error: () => this.router.navigate(['/login']),
    });
  }

    private loadResults(): void {
        this.loading.set(true);
        this.loadError.set('');
        this.api.get<ResultRow[]>('/api/hr/results').subscribe({
          next: (rows) => {
            this.allResults.set(rows);
            this.filteredResults.set(rows);
            this.api.setResults(rows);
            this.loading.set(false);
            // Reset to page 1 in case the previous filter state left us on a
            // page that no longer exists with the new data.
            this.currentPage.set(1);
          },
          error: (err: ApiError) => {
            if (err.status === 401) {
              this.router.navigate(['/login']);
              return;
            }
            this.loadError.set(err.message || 'Could not load results.');
            this.loading.set(false);
          },
        });
      }

  // -------- Filter handler --------
  applyFilters(): void {
    const q = this.searchQuery.trim().toLowerCase();
    const status = this.statusFilter;
    const all = this.allResults();
    const filtered = all.filter((r: ResultRow) => {
      const matchesQ = !q
        || r.candidate_name.toLowerCase().includes(q)
        || r.candidate_email.toLowerCase().includes(q);
      const isSubmitted = !!r.submitted_at;
      const matchesS = !status
        || (status === 'submitted' && isSubmitted)
        || (status === 'pending' && !isSubmitted);
      return matchesQ && matchesS;
    });
    this.filteredResults.set(filtered);
    // After filtering, reset to page 1 (otherwise filtering down to 3 results
    // while you're on page 5 would show an empty page).
    this.currentPage.set(1);
  }

  // -------- Pagination handlers --------
  goToPage(page: number): void {
    if (page < 1) page = 1;
    const max = this.totalPages();
    if (page > max) page = max;
    this.currentPage.set(page);
  }

  prevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  /**
   * Returns an array of page numbers to render in the pagination bar.
   * For small page counts we just show all pages: [1, 2, 3]
   * For larger counts we truncate around the current page: [1, '…', 4, 5, 6, '…', 20]
   *
   * Returning a string '…' makes the template easy: render number as a button,
   * render string as a non-clickable spacer.
   */
  pageNumbers = computed((): Array<number | string> => {
    const total = this.totalPages();
    const current = this.currentPage();

    if (total <= 7) {
      // Show all pages — fits without truncation.
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages: Array<number | string> = [1];
    if (current > 3) pages.push('…');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (current < total - 2) pages.push('…');
    pages.push(total);
    return pages;
  });

  // -------- Logout --------
  onLogout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
     sessionStorage.clear();

  this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
    this.router.navigate(['/login']);
  });
  }

  // -------- Row click → navigate to detail page --------
  onRowClick(row: ResultRow): void {
    this.router.navigate(['/dashboard/candidate', row.invitation_id]);
  }

  // Compact chip showing which sections were included, e.g. "R · W · S"
  // for a full test, "R · W" when speaking is excluded. Old rows that
  // pre-date the section-selection feature show all three (default-true).
  sectionsChip(row: ResultRow): string {
    const parts: string[] = [];
    if (row.include_reading) parts.push('R');
    if (row.include_writing) parts.push('W');
    if (row.include_speaking) parts.push('S');
    return parts.join(' · ');
  }

  sectionsTooltip(row: ResultRow): string {
    const parts: string[] = [];
    if (row.include_reading) parts.push('Reading');
    if (row.include_writing) parts.push('Writing');
    if (row.include_speaking) parts.push('Speaking');
    return `Sections included: ${parts.join(', ')}`;
  }

  // -------- Invite modal --------
  openInvite(): void {
     this.renderer.addClass(document.body, 'invite-open');
    this.invName = '';
    this.invEmail = '';
    this.invDifficulty = 'intermediate';
    // Empty by default — HR must explicitly pick the date and times.
    this.invDate = '';
    this.invStartTime = '';
    this.invEndTime = '';
    this.invTimezone = 'Asia/Kolkata';
    this.invIncludeReading = true;
    this.invIncludeWriting = true;
    this.invIncludeSpeaking = true;
    this.inviteError.set('');
    this.inviteResult.set(null);
    this.inviteCopied.set(false);
    this.inviteSubmitting.set(false);
    this.inviteOpen.set(true);

    // Fetch the timezone dropdown options. Fresh on every modal open so
    // any DB changes (new zone added, zone disabled, label edited) appear
    // immediately. Errors don't block the modal — HR sees a fallback
    // message and can retry by closing and re-opening.
    this.loadTimezones();
  }

  /**
   * Fetch the active timezone list from the backend. Called every time the
   * invite modal opens — there is intentionally no caching, so an
   * administrator can add/edit/disable a zone in the supported_timezones
   * table and the next modal open shows the updated list.
   *
   * On failure (network down, backend errored), the dropdown shows the
   * stale list if any was previously loaded, or empty if not. timezonesError
   * holds the error message so the template can show it inline.
   */
  private loadTimezones(): void {
    this.timezonesLoading.set(true);
    this.timezonesError.set('');
    this.api.get<SupportedTimezone[]>('/api/hr/timezones').subscribe({
      next: (rows) => {
        this.availableTimezones.set(rows);
        this.timezonesLoading.set(false);
        // If the previously-selected timezone is no longer in the active
        // list (someone disabled it), fall back to the first available zone
        // so the dropdown isn't showing a value that doesn't appear in its
        // options.
        if (rows.length > 0 && !rows.some(tz => tz.iana_name === this.invTimezone)) {
          this.invTimezone = rows[0].iana_name;
        }
      },
      error: (err: ApiError) => {
        this.timezonesLoading.set(false);
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        this.timezonesError.set(
          err.message || 'Could not load timezone list. Try closing and reopening the form.'
        );
      },
    });
  }

  closeInvite(): void {
     this.renderer.removeClass(document.body, 'invite-open');
    this.inviteOpen.set(false);
  }

  /**
   * Programmatically open the native date/time picker when the user clicks
   * anywhere on the input — not just the icon. Without this, Chrome only
   * opens the picker when the user clicks the calendar/clock icon on the
   * right edge of the input, which most users don't realize they need to do.
   *
   * showPicker() is a recent addition (Chrome 99+, Firefox 101+, Safari 16+).
   * The optional chaining (?.()) makes the call a no-op on older browsers,
   * so we degrade gracefully — old browsers still need an icon click but
   * nothing throws.
   *
   * Why a method (not inline in the template): the template is HTML, and
   * embedding TypeScript expressions like $any($event.target).showPicker?.()
   * works but is hard to read and skips type checking. Putting it here gives
   * us a real cast and a place to add behavior later (e.g. analytics).
   */
  openPicker(event: Event): void {
    const target = event.target as HTMLInputElement & { showPicker?: () => void };
    target.showPicker?.();
  }

  /**
   * Auto-fill end time to start + 60 minutes when HR sets the start time.
   * HR can still edit the auto-filled value (e.g. for a 90-min window).
   * Both inputs are <input type="time"> values in "HH:MM" format.
   */
  onStartTimeChange(value: string): void {
    this.invStartTime = value;
    if (!value) return;

    const [h, m] = value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;

    const totalMinutes = (h * 60 + m + 60) % (24 * 60);
    const newH = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const newM = (totalMinutes % 60).toString().padStart(2, '0');
    this.invEndTime = `${newH}:${newM}`;
  }

  submitInvite(): void {
    this.inviteError.set('');
    const name = this.invName.trim();
    const email = this.invEmail.trim();

    if (!name || !email) {
      this.inviteError.set('Both name and email are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.inviteError.set('Enter a valid email address.');
      return;
    }
    if (!this.invDate || !this.invStartTime || !this.invEndTime) {
      this.inviteError.set('Pick the test date, start time, and end time.');
      return;
    }

    
    const fromDate = wallClockToUtc(this.invDate, this.invStartTime, this.invTimezone);
    const untilDate = wallClockToUtc(this.invDate, this.invEndTime, this.invTimezone);
    if (!fromDate || !untilDate) {
      this.inviteError.set('Invalid date/time. Please re-enter.');
      return;
    }
    const fromMs = fromDate.getTime();
    const untilMs = untilDate.getTime();
    if (fromMs < Date.now() - 60_000) {
      this.inviteError.set('Start time cannot be in the past.');
      return;
    }
    if (untilMs <= fromMs) {
      this.inviteError.set('End time must be after start time.');
      return;
    }
    if (untilMs - fromMs < 60 * 60 * 1000) {
      this.inviteError.set('Window must be at least 60 minutes (the test takes ~60 min).');
      return;
    }
    // Defense in depth — the Generate Link button is also disabled in this
    // case, but we re-check here so a non-browser client (or an IS_PRODUCTION
    // bug) can't sneak past. The backend validator is the ultimate source
    // of truth.
    if (!this.invIncludeReading && !this.invIncludeWriting && !this.invIncludeSpeaking) {
      this.inviteError.set('Select at least one section.');
      return;
    }

    const body: InviteCreateRequest = {
      candidate_name: name,
      candidate_email: email,
      difficulty: this.invDifficulty,
      valid_from: fromDate.toISOString(),
      valid_until: untilDate.toISOString(),
      timezone: this.invTimezone,
      include_reading: this.invIncludeReading,
      include_writing: this.invIncludeWriting,
      include_speaking: this.invIncludeSpeaking,
    };

    this.inviteSubmitting.set(true);
    this.api.post<InviteCreateResponse>('/api/hr/invite', body).subscribe({
      next: (res) => {
        this.inviteSubmitting.set(false);

        if (res.email_status === 'sent') {
          // Happy path: email went out. Close the modal, show a brief toast,
          // refresh the table so the new candidate row appears immediately.
          this.closeInvite();
          this.showToast(`Invitation sent to ${res.candidate_email}`);
          this.loadResults();
        } else {
          // Failed (or 'pending' = SMTP not configured at all). Keep the
          // modal open so HR can copy URL+code manually. inviteResult drives
          // the "fallback" view in the template; inviteError shows the
          // SMTP failure reason at the top of that view.
          this.inviteResult.set(res);
          this.inviteError.set(
            res.email_error
              ? `Email failed: ${res.email_error}`
              : 'Email could not be sent. Copy the URL and code below to send manually.'
          );
          // Refresh table even on failure — the invitation IS in the database,
          // just the email send failed. HR can see it in the list with a
          // "failed" status badge (Step 2c will add that).
          this.loadResults();
        }
      },
      error: (err: ApiError) => {
        this.inviteSubmitting.set(false);
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        this.inviteError.set(err.message || 'Could not create invitation.');
      },
    });
  }

  /**
   * Show a brief notification at the top of the page. Auto-dismisses after
   * 4 seconds. Calling again before dismiss replaces the previous message
   * (and resets the timer).
   */
  private showToast(message: string): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
    }
    this.toastMessage.set(message);
    this.toastVisible.set(true);
    this.toastTimer = setTimeout(() => {
      this.toastVisible.set(false);
      this.toastTimer = null;
    }, 4000);
  }

  copyInviteUrl(): void {
    const res = this.inviteResult();
    if (!res) return;
    copyToClipboard(res.exam_url).then(() => {
      this.inviteCopied.set(true);
    });
  }

  // -------- Template helpers --------
  ratingLabel(rating: string | null): string {
    if (rating === 'recommended') return 'Recommended';
    if (rating === 'borderline') return 'Borderline';
    if (rating === 'not_recommended') return 'Not Recommended';
    return 'pending';
  }

  ratingClass(rating: string | null): string {
    if (rating === 'recommended') return 'reviewed';
    if (rating === 'borderline') return 'new';
    if (rating === 'not_recommended') return 'flagged';
    return '';
  }

  isNotAttended(row: ResultRow): boolean {
  if (row.rating) return false;          // has rating → already attended/scored
  if (row.submitted_at) return false;    // submitted → not "not attended"
  if (!row.expires_at) return false;     // safety: missing data → don't claim "not attended"
  return new Date(row.expires_at) < new Date();
}

  formatSubmittedDate(submitted_at: string | null): string {
    return formatBackendDate(submitted_at);
  }

  formatSubmittedDateTime(submitted_at: string | null): string {
    return formatBackendDateTime(submitted_at);
  }

  // -------- Report downloads --------
  /**
   * Trigger a PDF download for one candidate.
   *
   * Uses fetch+blob (NOT the api.service Observable) because the existing
   * api.service is built around JSON responses — for binary downloads we
   * need direct access to the blob and full control over the Content-
   * Disposition filename. credentials='include' ensures the session cookie
   * goes with the request, matching every other authenticated call.
   *
   * Browser flow:
   *   1. fetch the PDF endpoint with auth cookie
   *   2. read response as a Blob
   *   3. create a temporary object URL for the blob
   *   4. create an invisible <a> with download attribute and click it
   *   5. the browser pops its native save dialog
   *   6. revoke the object URL (free the blob memory)
   *
   * On 404 (cross-tenant or unknown invitation) → show an alert. On 5xx
   * (PDF generation failed on the server) → show an alert. On network
   * failure → show an alert. Always re-enable the button.
   */
  async onDownloadPdf(r: ResultRow): Promise<void> {
    if (!r.submitted_at) {
      // Should not happen because the button is disabled, but be defensive.
      return;
    }
    if (this.downloadingPdfFor() !== null) return;

    this.downloadingPdfFor.set(r.invitation_id);
    try {
      // Use environment.apiUrl (same base URL ApiService uses) so the
      // request hits the backend directly. A relative URL like
      // '/api/hr/...' would go to localhost:4200 in dev (the Angular
      // dev server), which doesn't proxy file-extension paths and returns
      // a 404 HTML page. ApiService can't be used here because it's built
      // around JSON responses; for binary downloads we need fetch+blob.
      const url = `${environment.apiUrl}/api/hr/results/${r.invitation_id}/report.pdf`;
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        const detail = await this.extractErrorDetail(response);
        alert(`Could not download report: ${detail}`);
        return;
      }
      const blob = await response.blob();
      this.triggerDownload(blob, this.pdfFilenameFor(r));
    } catch (err) {
      console.error('[hr-dashboard] PDF download failed:', err);
      alert('Could not download the report. Check your connection and try again.');
    } finally {
      this.downloadingPdfFor.set(null);
    }
  }

  /**
   * Trigger a bulk Excel export of every invitation belonging to this HR.
   * Same fetch+blob mechanics as onDownloadPdf — see that method for the
   * detailed flow.
   */
  async onExportExcel(): Promise<void> {
    if (this.exportingExcel()) return;

    this.exportingExcel.set(true);
    try {
      // Same reasoning as onDownloadPdf — must hit the backend directly,
      // not the Angular dev server. Path is /exports/candidates.xlsx
      // (NOT /results/export.xlsx) to avoid colliding with the existing
      // /results/{invitation_id} route — FastAPI matches by order and
      // would treat "export.xlsx" as a candidate ID, returning 422.
      const url = `${environment.apiUrl}/api/hr/exports/candidates.xlsx`;
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        const detail = await this.extractErrorDetail(response);
        alert(`Could not download export: ${detail}`);
        return;
      }
      const blob = await response.blob();
      // Filename is set by the backend's Content-Disposition; we still pass
      // a sensible fallback in case the browser ignores the server header.
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      this.triggerDownload(blob, `FluentiQ_Candidates_${today}.xlsx`);
    } catch (err) {
      console.error('[hr-dashboard] Excel export failed:', err);
      alert('Could not download the export. Check your connection and try again.');
    } finally {
      this.exportingExcel.set(false);
    }
  }

  /**
   * Extract a human-readable error message from a non-OK fetch Response.
   *
   * FastAPI returns two distinct error shapes:
   *   { detail: "string message" }                   ← 401, 404, 500
   *   { detail: [ { msg, loc, type }, ... ] }        ← 422 validation
   *
   * Mirrors the logic in api.service.ts's handleError(), which already
   * normalises these for HttpClient calls. We do it manually here because
   * we use raw fetch for binary downloads.
   *
   * Falls back to the HTTP status code if the body isn't JSON or the
   * shape doesn't match either expected variant.
   */
  private async extractErrorDetail(response: Response): Promise<string> {
    try {
      const body = await response.json();
      if (Array.isArray(body?.detail)) {
        // 422 validation array — join field-level messages
        return body.detail
          .map((e: { msg: string; loc?: (string | number)[] }) => {
            const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : '';
            return field ? `${field}: ${e.msg}` : e.msg;
          })
          .join('; ');
      }
      if (typeof body?.detail === 'string') {
        return body.detail;
      }
    } catch {
      // Response wasn't JSON — fall through to HTTP status
    }
    return `HTTP ${response.status}`;
  }

  /**
   * Build a candidate-friendly filename for the PDF. Matches the backend's
   * naming convention so what the browser saves matches what's in
   * Content-Disposition. Backend wins if there's a mismatch — the browser
   * uses the Content-Disposition filename when present.
   */
  private pdfFilenameFor(r: ResultRow): string {
    const safeName = (r.candidate_name || 'candidate')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_.-]/g, '_');
    const date = (r.submitted_at || '').slice(0, 10).replace(/-/g, '') ||
      new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `Assessment_${safeName}_${date}.pdf`;
  }

  /**
   * Trigger a browser download for an in-memory Blob. Uses the standard
   * pattern: object URL + invisible <a download> + .click() + revoke.
   *
   * Why this and not window.location.href = url? Because that wouldn't
   * include the session cookie reliably across browsers, and we'd have
   * no way to handle errors before the download starts.
   */
  private triggerDownload(blob: Blob, filename: string): void {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // Free the blob memory once the click has fired. setTimeout(0) gives
      // the browser one tick to start the download before we revoke.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }
}