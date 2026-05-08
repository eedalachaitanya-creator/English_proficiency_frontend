import { Component, Input, Output, signal, EventEmitter, OnInit, inject, Renderer2 } from '@angular/core';
import { RouterModule } from '@angular/router';
import { InviteCreateRequest, InviteCreateResponse, ResultRow, SupportedTimezone } from '../../../core/models/hr.models';
import { FormsModule } from '@angular/forms';
import { ApiError, ApiService } from '../../../core/services/api.service';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { formatBackendDate, formatBackendDateTime } from '../../../core/utils/date';
import { wallClockToUtc } from '../../../core/utils/timezone';
  
@Component({
  selector: 'app-sidebar',
 imports: [RouterModule, FormsModule, CommonModule], 
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar implements OnInit{
   @Input() showDashboard: boolean = true;  // Add this
  private api = inject(ApiService); 
  private router = inject(Router);
  private renderer = inject(Renderer2);

  @Input() showManageQuestions: boolean = true;
  @Input() showInviteCandidate: boolean = true;
  
  @Output() inviteClicked = new EventEmitter<void>();

  openMenu: string = 'questions';  // Changed from '' to 'questions'

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

 
  /** Tracks the auto-dismiss timer so a second toast cancels the first. */
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // -------- List/filter state --------
  loading = signal(true);
  loadError = signal('');
  allResults = signal<ResultRow[]>([]);
  filteredResults = signal<ResultRow[]>([]);

  searchQuery = '';
  statusFilter: '' | 'submitted' | 'pending' = '';

  // -------- Pagination state --------
  /** 1-indexed page number. The user-visible "page 1" maps to filteredResults[0..9]. */
  currentPage = signal(1);

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

  // -------- Toast state --------
  // Small notification banner shown briefly at the top of the page after
  // a successful invitation (the modal closes immediately on success).
  // We use a single signal pair instead of building a full Toast component
  // because there's only one place we need this and the markup is small.
  toastMessage = signal('');
  toastVisible = signal(false);

    availableTimezones = signal<SupportedTimezone[]>([]);
    timezonesLoading = signal(false);
    timezonesError = signal('');

  ngOnInit(): void {
    this.loadResults(); 
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
     this.loadTimezones();
  }

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


    toggleMenu(menu: string): void {
    this.openMenu = this.openMenu === menu ? '' : menu;
  }

   closeInvite(): void {
    this.renderer.removeClass(document.body, 'invite-open');
    this.inviteOpen.set(false);
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
    navigator.clipboard.writeText(res.exam_url).then(() => {
      this.inviteCopied.set(true);
    }).catch(() => {
      this.inviteCopied.set(true);
    });
  }

    formatSubmittedDate(submitted_at: string | null): string {
    return formatBackendDate(submitted_at);
  }

  formatSubmittedDateTime(submitted_at: string | null): string {
    return formatBackendDateTime(submitted_at);
  }
 
}



