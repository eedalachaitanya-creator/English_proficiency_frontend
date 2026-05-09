import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiError, ApiService } from './api.service';
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
      const res = await this.submitWithOnlineRetry(() =>
        this._postSubmit('candidate_finished'),
      );
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

  /**
   * Wrap a submit attempt with auto-retry on a network failure.
   *
   * Behaviour:
   *   - Runs `attempt()`.
   *   - If it throws an ApiError with status 0 (the request never reached
   *     the server — almost always a candidate dropping offline mid-submit),
   *     shows a full-screen "Reconnecting…" overlay with a Cancel button,
   *     then waits for either the browser's `online` event OR a Cancel
   *     click.
   *   - On `online`: retries once. Success returns normally; any retry
   *     failure throws so the caller can show the standard "Submission
   *     failed" modal.
   *   - On Cancel: throws the original status-0 error so the caller's
   *     existing error handling fires unchanged (modal alert, retry from
   *     the page).
   *
   * The wait isn't time-bounded — a candidate with a permanently dead
   * network can use Cancel to escape. Without Cancel, a permanent outage
   * would trap them on the overlay forever.
   *
   * Used by submitFinal (reading/writing pages) and the speaking page's
   * manual submit path so a brief connection drop doesn't lose the
   * candidate's submission.
   */
  async submitWithOnlineRetry<T>(attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (err) {
      if (!isNetworkError(err)) throw err;

      const cancel = new AbortController();
      this.showReconnectOverlay(() => cancel.abort());
      try {
        await waitForOnlineOrCancel(cancel.signal);
        // Online again — retry once. Whatever happens propagates so the
        // caller's existing error path (modal alert) handles it.
        return await attempt();
      } catch (waitOrRetryErr) {
        // The wait helper throws Error('cancelled') on cancel — surface
        // the original network error in that case so the caller's modal
        // says "you appear to be offline" rather than something cryptic.
        if ((waitOrRetryErr as Error)?.message === 'cancelled') throw err;
        throw waitOrRetryErr;
      } finally {
        this.hideReconnectOverlay();
      }
    }
  }

  /**
   * Build the "Reconnecting…" overlay using DOM APIs (no innerHTML, no
   * untrusted content). The keyframes/hover styles live in a global
   * <style> tag we inject once on first use; the overlay itself is
   * destroyed on each hide so its in-progress animation resets cleanly
   * the next time we need it.
   */
  private showReconnectOverlay(onCancel: () => void): void {
    if (document.getElementById('reconnectOverlay')) return;
    this.ensureReconnectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'reconnectOverlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(11, 37, 69, 0.95); color: #fff;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 24px; text-align: center;
      font-family: var(--font-body, "Ubuntu", sans-serif);
      animation: reconnect-fade-in 220ms ease-out;
    `;

    // Three concentric arcs that pulse outward from a small dot — visually
    // says "actively reaching" rather than "everything is broken". Orange
    // matches the FluentIQ accent so the overlay reads as part of the app.
    const pulseWrap = document.createElement('div');
    pulseWrap.style.cssText = 'position:relative;width:96px;height:96px;margin-bottom:24px;';
    for (const delay of ['0s', '0.66s', '1.33s']) {
      const ring = document.createElement('div');
      ring.style.cssText =
        'position:absolute;inset:0;border:3px solid #FF6B35;border-radius:50%;' +
        `opacity:0;animation:reconnect-pulse 2s ease-out infinite;animation-delay:${delay};`;
      pulseWrap.appendChild(ring);
    }
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'width:14px;height:14px;background:#FF6B35;border-radius:50%;';
    pulseWrap.appendChild(dot);

    const heading = document.createElement('h1');
    heading.textContent = 'Reconnecting…';
    heading.style.cssText =
      'font-size:28px;margin:0 0 12px;font-weight:700;letter-spacing:0.3px;';

    const body = document.createElement('p');
    body.textContent =
      "Your work is safe. We'll submit your test as soon as your connection is back.";
    body.style.cssText =
      'font-size:16px;max-width:480px;line-height:1.55;margin:0 0 28px;opacity:0.92;';

    const btn = document.createElement('button');
    btn.id = 'reconnectCancelBtn';
    btn.type = 'button';
    btn.textContent = 'Cancel';
    btn.style.cssText =
      'background:transparent;color:#fff;padding:10px 28px;' +
      'border:1px solid rgba(255,255,255,0.5);border-radius:6px;' +
      'font-size:13px;font-weight:600;letter-spacing:0.5px;' +
      'text-transform:uppercase;cursor:pointer;' +
      'transition:background 0.15s, border-color 0.15s;';
    btn.addEventListener('click', onCancel);

    overlay.append(pulseWrap, heading, body, btn);
    document.body.appendChild(overlay);
  }

  private hideReconnectOverlay(): void {
    document.getElementById('reconnectOverlay')?.remove();
  }

  /** Inject the keyframes + hover style block once. Idempotent. */
  private ensureReconnectStyles(): void {
    if (document.getElementById('reconnect-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'reconnect-overlay-styles';
    style.textContent = `
      @keyframes reconnect-pulse {
        0%   { transform: scale(0.4); opacity: 0.85; }
        100% { transform: scale(1.4); opacity: 0; }
      }
      @keyframes reconnect-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      #reconnectCancelBtn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.85);
      }
    `;
    document.head.appendChild(style);
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


// ----------------------------------------------------------------------
// Module-level helpers for submitWithOnlineRetry. Kept outside the class
// so they're trivially unit-testable and don't pull in Angular DI.
// ----------------------------------------------------------------------

/** True when the error is a 0-status ApiError, i.e. "request never reached
 *  the server" — the only failure mode where retrying once the connection
 *  is back makes sense. Auth/validation/business errors should not retry. */
function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

/** Resolve when the browser fires `online`, or reject with Error('cancelled')
 *  when the AbortSignal aborts. If the browser already reports onLine=true
 *  (e.g. the request failed due to a brief blip and the connection has
 *  since recovered), give the network 500ms to settle before resolving so
 *  the immediate retry has a better chance of reaching the server. */
function waitForOnlineOrCancel(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('online', onOnline);
      signal.removeEventListener('abort', onAbort);
      if (ok) setTimeout(resolve, 500);
      else reject(new Error('cancelled'));
    };
    const onOnline = () => finish(true);
    const onAbort = () => finish(false);
    if (navigator.onLine) {
      finish(true);
      return;
    }
    window.addEventListener('online', onOnline);
    signal.addEventListener('abort', onAbort);
  });
}