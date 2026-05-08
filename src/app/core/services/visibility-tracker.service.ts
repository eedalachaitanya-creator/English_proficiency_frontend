import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Subject, Observable } from 'rxjs';

/**
 * Aggregate stats reported back to the backend on submit.
 * Frontend appends as form fields:
 *   tab_switches_count           = stats.count
 *   tab_switches_total_seconds   = stats.totalSeconds
 * Backend trusts the count for the 3-strike termination check
 * (see backend/routes/submit.py is_terminated).
 */
export interface TabSwitchStats {
  count: number;
  totalSeconds: number;
}

interface WarningPayload {
  durationSeconds: number;
  count: number;
}

interface ResizeWarningPayload {
  count: number;
  /** How many pixels of width were lost when the resize fired. */
  pixelsLost: number;
}

/**
 * Visibility tracker — Angular port of frontend/js/visibility-tracker.js.
 *
 * THREE-STRIKE POLICY (mirrors teammate's logic exactly):
 *   - Strike 1: emit 'first' warning event for component to render modal
 *   - Strike 2: emit 'final' warning event ("one more = end of test")
 *   - Strike 3: emit 'terminate' — component force-submits and redirects
 *
 * sessionStorage key 'visibilityStats' is identical to teammate's, so the
 * legacy frontend and our Angular frontend share the same persistence.
 */
@Injectable({ providedIn: 'root' })
export class VisibilityTrackerService {
  private zone = inject(NgZone);

  private readonly MAX_STRIKES = 3;
  /**
   * If a single tab-switch lasts longer than this, terminate immediately
   * — independent of the strike count. Catches the "switch once, stay
   * away to look up answers" cheat that the 3-strike count alone doesn't
   * stop. Uses setTimeout so termination fires while the candidate is
   * still away (their next return will land on /submitted).
   */
  private readonly MAX_SINGLE_SWITCH_SECONDS = 30;
  private readonly STORAGE_KEY = 'visibilityStats';
  /** Independent storage for resize-tracking. Does NOT mix with tab-switch
      counter. Frontend-only — backend treats both terminations identically
      (Option 2 frontend-only — see chat decision 2026-05-08). */
  private readonly RESIZE_STORAGE_KEY = 'resizeStats';
  /** How many pixels of width loss to count as a "narrowing event."
      Tuned for typical Chrome side panel (~400px) without firing on
      legitimate window drag/zoom. */
  private readonly RESIZE_NARROW_THRESHOLD_PX = 200;
  /** Captured at start() so we know what "full width" looked like. */
  private baselineWidth = 0;
  /** setTimeout that re-captures baseline once the user stops resizing,
      so legitimate slow drags don't pile up false positives. */
  private resizeDebounceId: ReturnType<typeof setTimeout> | null = null;
  private boundResizeHandler: (() => void) | null = null;
  private resizeTerminated = false;

  private hiddenSince: number | null = null;
  /** Single source of truth for "candidate is currently away." Guarded so
      that one physical switch which fires BOTH `visibilitychange` and
      `window.blur` is recorded as one strike, not two. */
  private isAway = false;
  /** setTimeout id for the 30-second long-away termination; null when not pending. */
  private awayTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private terminated = false;
  private listening = false;
  private boundAwayCheck: (() => void) | null = null;
  private boundPagehide: (() => void) | null = null;

  count = signal(0);

  private firstWarning$ = new Subject<WarningPayload>();
  private finalWarning$ = new Subject<WarningPayload>();
  private terminate$ = new Subject<TabSwitchStats>();

  private firstResizeWarning$ = new Subject<ResizeWarningPayload>();
  private finalResizeWarning$ = new Subject<ResizeWarningPayload>();
  private resizeTerminate$ = new Subject<TabSwitchStats>();

  /**
   * Begin listening for visibility changes. Idempotent — safe to call from
   * each test-page's ngOnInit, even if the previous page already started it.
   */
  start(): void {
    if (this.listening) return;
    const saved = this.loadStats();
    this.count.set(saved.count);

    // Strict away-detection: the candidate is "away" whenever EITHER the
    // tab is hidden (other tab in same window) OR the window has lost OS
    // focus (Cmd+Tab / Alt+Tab to another app, undocked DevTools, another
    // browser window). `visibilitychange` alone misses app-level switches
    // on macOS — `blur`/`focus` cover that gap. The shared handler reads
    // `document.hidden` and `document.hasFocus()` directly, so whichever
    // event fires first wins and the other becomes a no-op via `isAway`.
    this.boundAwayCheck = () => this.checkAway();
    this.boundPagehide = () => this.onPageHide();
    document.addEventListener('visibilitychange', this.boundAwayCheck);
    window.addEventListener('blur', this.boundAwayCheck);
    window.addEventListener('focus', this.boundAwayCheck);
    window.addEventListener('pagehide', this.boundPagehide);

    // Capture baseline before any sidebar / DevTools opens. Loaded count
    // survives navigation between test sections via sessionStorage.
    this.baselineWidth = window.innerWidth;
    this.boundResizeHandler = () => this.onResize();
    window.addEventListener('resize', this.boundResizeHandler);

    this.listening = true;
  }

  stop(): void {
    if (!this.listening) return;
    if (this.boundAwayCheck) {
      document.removeEventListener('visibilitychange', this.boundAwayCheck);
      window.removeEventListener('blur', this.boundAwayCheck);
      window.removeEventListener('focus', this.boundAwayCheck);
      this.boundAwayCheck = null;
    }
    if (this.boundPagehide) {
      window.removeEventListener('pagehide', this.boundPagehide);
      this.boundPagehide = null;
    }
    if (this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
      this.boundResizeHandler = null;
    }
    if (this.resizeDebounceId !== null) {
      clearTimeout(this.resizeDebounceId);
      this.resizeDebounceId = null;
    }
    this.clearAwayTimeout();
    this.listening = false;
  }

  getStats(): TabSwitchStats {
    return this.loadStats();
  }

  reset(): void {
    this.stop();
    this.hiddenSince = null;
    this.isAway = false;
    this.clearAwayTimeout();
    this.terminated = false;
    this.resizeTerminated = false;
    this.count.set(0);
    try {
      sessionStorage.removeItem(this.STORAGE_KEY);
      sessionStorage.removeItem(this.RESIZE_STORAGE_KEY);
    } catch {
      // sessionStorage disabled — silently ignore
    }
  }

  onFirstWarning(): Observable<WarningPayload> {
    return this.firstWarning$.asObservable();
  }
  onFinalWarning(): Observable<WarningPayload> {
    return this.finalWarning$.asObservable();
  }
  onTerminate(): Observable<TabSwitchStats> {
    return this.terminate$.asObservable();
  }
  onFirstResizeWarning(): Observable<ResizeWarningPayload> {
    return this.firstResizeWarning$.asObservable();
  }
  onFinalResizeWarning(): Observable<ResizeWarningPayload> {
    return this.finalResizeWarning$.asObservable();
  }
  onResizeTerminate(): Observable<TabSwitchStats> {
    return this.resizeTerminate$.asObservable();
  }

  /**
   * Unified handler for `visibilitychange`, `window.blur`, and
   * `window.focus`. Decides "away" from current document/window state
   * rather than trusting any single event, so a switch detected by ONE
   * event but missed by ANOTHER is still caught — and a switch reported
   * by BOTH is recorded once thanks to the `isAway` guard.
   *
   * Strict policy: every transition into "away" produces exactly one
   * strike on return. There is NO minimum-duration grace window — a
   * sub-second peek at another tab/app is flagged the same as a long
   * absence. This is the explicit product requirement: tab-switching
   * must be flagged each time.
   */
  private checkAway(): void {
    if (this.terminated) return;
    const away = document.hidden || !document.hasFocus();
    if (away === this.isAway) return;
    if (away) {
      this.onAway();
    } else {
      this.onReturn();
    }
  }

  private onAway(): void {
    this.isAway = true;
    this.hiddenSince = Date.now();
    // Schedule a long-away termination — fires while the candidate is
    // still on another tab / browser. Cleared if they return in time.
    this.awayTimeoutId = setTimeout(() => {
      this.awayTimeoutId = null;
      if (this.terminated || this.hiddenSince === null) return;
      const elapsedSec = Math.round((Date.now() - this.hiddenSince) / 1000);
      const stats = this.loadStats();
      stats.count += 1;
      stats.totalSeconds += elapsedSec;
      this.saveStats(stats);
      this.count.set(stats.count);
      this.terminated = true;
      this.hiddenSince = null;
      this.isAway = false;
      this.zone.run(() => this.terminate$.next(stats));
    }, this.MAX_SINGLE_SWITCH_SECONDS * 1000);
  }

  private onReturn(): void {
    this.isAway = false;
    this.clearAwayTimeout();
    if (this.hiddenSince === null) return;
    const elapsedMs = Date.now() - this.hiddenSince;
    this.hiddenSince = null;
    // Display elapsed seconds rounded UP to a minimum of 1, so a
    // sub-second switch is reported as "1 second" in the warning text
    // rather than "0 seconds." The strike itself counts unconditionally.
    const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));

    const stats = this.loadStats();
    stats.count += 1;
    stats.totalSeconds += elapsedSec;
    this.saveStats(stats);
    this.count.set(stats.count);

    if (stats.count >= this.MAX_STRIKES) {
      this.terminated = true;
      this.zone.run(() => this.terminate$.next(stats));
      return;
    }

    if (stats.count === this.MAX_STRIKES - 1) {
      this.zone.run(() =>
        this.finalWarning$.next({ durationSeconds: elapsedSec, count: stats.count })
      );
    } else {
      this.zone.run(() =>
        this.firstWarning$.next({ durationSeconds: elapsedSec, count: stats.count })
      );
    }
  }

  private clearAwayTimeout(): void {
    if (this.awayTimeoutId !== null) {
      clearTimeout(this.awayTimeoutId);
      this.awayTimeoutId = null;
    }
  }

  private onPageHide(): void {
    if (this.hiddenSince === null) return;
    const elapsedSec = Math.max(1, Math.round((Date.now() - this.hiddenSince) / 1000));
    const stats = this.loadStats();
    stats.count += 1;
    stats.totalSeconds += elapsedSec;
    this.saveStats(stats);
    this.hiddenSince = null;
    this.isAway = false;
  }

  private loadStats(): TabSwitchStats {
    try {
      const raw = sessionStorage.getItem(this.STORAGE_KEY);
      if (!raw) return { count: 0, totalSeconds: 0 };
      const parsed = JSON.parse(raw);
      return {
        count: Number.isFinite(parsed.count) ? parsed.count : 0,
        totalSeconds: Number.isFinite(parsed.totalSeconds) ? parsed.totalSeconds : 0,
      };
    } catch {
      return { count: 0, totalSeconds: 0 };
    }
  }

  private saveStats(stats: TabSwitchStats): void {
    try {
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(stats));
    } catch {
      // sessionStorage full or disabled — silently ignore
    }
  }
  private onResize(): void {
    if (this.resizeTerminated) return;

    const currentWidth = window.innerWidth;
    const lostWidth = this.baselineWidth - currentWidth;

    // Significant narrowing — Gemini sidebar, DevTools, or sidebar-style extension.
    if (lostWidth >= this.RESIZE_NARROW_THRESHOLD_PX) {
      const stats = this.loadResizeStats();
      stats.count += 1;
      this.saveResizeStats(stats);

      if (stats.count >= this.MAX_STRIKES) {
        this.resizeTerminated = true;
        this.zone.run(() => this.resizeTerminate$.next(stats));
        return;
      }

      const payload: ResizeWarningPayload = {
        count: stats.count,
        pixelsLost: lostWidth,
      };
      if (stats.count === this.MAX_STRIKES - 1) {
        this.zone.run(() => this.finalResizeWarning$.next(payload));
      } else {
        this.zone.run(() => this.firstResizeWarning$.next(payload));
      }

      // Reset baseline so the SAME open sidebar doesn't keep firing on
      // small width adjustments while it stays open.
      this.baselineWidth = currentWidth;
      return;
    }

    // Window grew (sidebar closed, or candidate maximized). Re-capture
    // baseline so the next narrowing is measured from this new baseline.
    if (lostWidth < -50) {
      this.baselineWidth = currentWidth;
      return;
    }

    // Small drift (within +/-50px). Debounce — re-capture baseline if user
    // stops resizing for 500ms, so legitimate window drags don't pile up
    // and trigger a false positive on the next sidebar open.
    if (this.resizeDebounceId !== null) {
      clearTimeout(this.resizeDebounceId);
    }
    this.resizeDebounceId = setTimeout(() => {
      this.baselineWidth = window.innerWidth;
      this.resizeDebounceId = null;
    }, 500);
  }

  private loadResizeStats(): TabSwitchStats {
    try {
      const raw = sessionStorage.getItem(this.RESIZE_STORAGE_KEY);
      if (!raw) return { count: 0, totalSeconds: 0 };
      const parsed = JSON.parse(raw);
      return {
        count: Number.isFinite(parsed.count) ? parsed.count : 0,
        totalSeconds: 0,  // not tracked for resize
      };
    } catch {
      return { count: 0, totalSeconds: 0 };
    }
  }

  private saveResizeStats(stats: TabSwitchStats): void {
    try {
      sessionStorage.setItem(this.RESIZE_STORAGE_KEY, JSON.stringify(stats));
    } catch {
      // sessionStorage full or disabled — silently ignore
    }
  }
}