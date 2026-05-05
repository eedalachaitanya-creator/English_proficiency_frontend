import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';
import { StoreService } from './store.service';
import { VisibilityTrackerService } from './visibility-tracker.service';

interface SubmitResponse {
  ref_id: string;
  status: string;
}

/**
 * Allowed submission_reason values. Backend silently coerces unknown values
 * to 'candidate_finished', so a bad value here will not reject the submit —
 * but it will be misclassified in the HR dashboard.
 */
export type SubmissionReason =
  | 'candidate_finished'
  | 'reading_timer_expired'
  | 'writing_timer_expired'
  | 'speaking_timer_expired'
  | 'tab_switch_termination'
  | 'window_expired';

/**
 * The "force-submit" logic is needed by the reading, writing, and speaking
 * components — for both 3-strike tab-switch termination AND per-section
 * timer expiry. Centralising it here prevents drift across pages — same
 * as the legacy force-submit.js does for the legacy frontend.
 *
 * Behavior:
 *   Components call this.terminateAndSubmit(submissionReason) when:
 *     - VisibilityTrackerService.onTerminate() fires (3-strike tab switch)
 *     - The section's countdown timer hits zero
 *   Method:
 *     1. Renders a fixed "Test Ended" overlay (blocks the whole page);
 *        message text differs for tab-switch vs timer-expiry.
 *     2. POSTs whatever data is in StoreService to /api/submit, including
 *        the submission_reason so HR sees why the test ended.
 *     3. Clears all candidate-flow sessionStorage keys
 *     4. Navigates to /submitted
 *
 * Fire-and-forget — once called, the candidate cannot recover.
 */
@Injectable({ providedIn: 'root' })
export class ForceSubmitService {
  private api = inject(ApiService);
  private router = inject(Router);
  private store = inject(StoreService);
  private tracker = inject(VisibilityTrackerService);

  // Two-state guard:
  //   inFlight: a POST is in progress right now — protects against double-
  //             submit from rapid clicks or section-timer firing during
  //             modal-confirm await.
  //   submitted: the test has already been submitted successfully —
  //              protects against re-entry after navigation completes
  //              (e.g., timer fires + modal accept race; or the candidate
  //              somehow lands back on /reading after /submitted).
  // Without `submitted`, releasing inFlight in `finally` would let a
  // racing second submit through and the backend would return 410 — the
  // candidate would see an error modal floating over the success page.
  private inFlight = false;
  private submitted = false;

  async terminateAndSubmit(submissionReason: SubmissionReason): Promise<void> {
    if (this.inFlight || this.submitted) return;
    this.inFlight = true;

    this.showOverlay(submissionReason);

    try {
      const res = await this._postSubmit(submissionReason);
      this.submitted = true;
      if (res?.ref_id) {
        this.store.setRefId(res.ref_id);
      }
      this.store.clearTestSession();
      this.tracker.reset();
      this.router.navigate(['/submitted']);
    } catch (err) {
      console.error('[force-submit] submission failed:', err);
      this.setOverlayMessage(
        'Submission could not be completed. Please contact your HR manager.'
      );
      // Deliberately do NOT navigate — leave the candidate on the overlay
      // so they don't think they submitted successfully. The error is final.
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Normal end-of-test submission — used by reading.ts and writing.ts when
   * the candidate hits Continue on what is the LAST included section
   * (e.g., HR created a Reading-only or Reading+Writing test). Submits
   * answers + essay (no audio, since speaking is excluded), clears the
   * session, and navigates to /submitted.
   *
   * Distinct from terminateAndSubmit: no full-screen overlay, error
   * propagates to the caller so it can show the same retry UX speaking.ts
   * uses for the candidate-finished path (modal alert + retry).
   */
  async submitFinal(): Promise<void> {
    if (this.inFlight || this.submitted) return;
    this.inFlight = true;
    try {
      const res = await this._postSubmit('candidate_finished');
      this.submitted = true;
      if (res?.ref_id) {
        this.store.setRefId(res.ref_id);
      }
      this.store.clearTestSession();
      this.tracker.reset();
      this.router.navigate(['/submitted']);
    } finally {
      this.inFlight = false;
    }
  }

  private async _postSubmit(reason: SubmissionReason): Promise<SubmitResponse> {
    const fd = new FormData();
    fd.append('answers', JSON.stringify(this.store.getReadingAnswers()));
    // No audio in this code path — speaking.ts has its own submit that
    // handles recordings. submitFinal() / terminateAndSubmit() submit
    // text-only data (answers + essay) with empty topic_ids.
    fd.append('topic_ids', JSON.stringify([]));
    fd.append('essay_text', this.store.getWritingEssay());

    const stats = this.tracker.getStats();
    fd.append('tab_switches_count', String(stats.count));
    fd.append('tab_switches_total_seconds', String(stats.totalSeconds));
    fd.append('submission_reason', reason);

    return firstValueFrom(this.api.post<SubmitResponse>('/api/submit', fd));
  }

  private showOverlay(submissionReason: SubmissionReason): void {
    if (document.getElementById('terminationOverlay')) return;
    const reasonText = submissionReason === 'tab_switch_termination'
      ? 'Your test has been terminated due to repeated tab switches.'
      : submissionReason === 'window_expired'
        ? 'Your test has ended because the scheduled time window has closed.'
        : 'Your test has ended because the time limit was reached.';
    const overlay = document.createElement('div');
    overlay.id = 'terminationOverlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(11, 37, 69, 0.97); color: #fff;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-family: var(--font-sans, Arial, sans-serif);
      padding: 24px; text-align: center;
    `;
    overlay.innerHTML = `
      <div style="font-size: 64px; margin-bottom: 16px;">⏹</div>
      <h1 style="font-size: 28px; margin-bottom: 12px;">Test Ended</h1>
      <p style="font-size: 16px; max-width: 480px; line-height: 1.5; margin-bottom: 24px;">
        ${reasonText}
        We are submitting the data you completed so far.
      </p>
      <div id="termSpinnerMsg" style="font-size: 14px; opacity: 0.85;">
        Submitting…
      </div>
    `;
    document.body.appendChild(overlay);
  }

  private setOverlayMessage(text: string): void {
    const el = document.getElementById('termSpinnerMsg');
    if (el) el.textContent = text;
  }
}