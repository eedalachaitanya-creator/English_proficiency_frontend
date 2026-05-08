import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { ApiError } from '../../core/services/api.service';
import { TestContentService } from '../../core/services/test-content.service';
import { StoreService } from '../../core/services/store.service';
import { TimerService, TimerHandle } from '../../core/services/timer.service';
import { ModalService } from '../../core/services/modal.service';
import { VisibilityTrackerService } from '../../core/services/visibility-tracker.service';
import { ForceSubmitService } from '../../core/services/force-submit.service';
import {
  TestContent,
  QuestionPublic,
  ReadingAnswers,
} from '../../core/models/test.models';
import { nextSectionRoute } from '../../core/utils/section-routing';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';

/**
 * Section 1 of 3 — Reading. Mirrors frontend/js/reading.js exactly.
 *
 * - Loads /api/test-content (cached by TestContentService).
 * - Renders the assigned passage on the left, 15 questions on the right.
 * - 30-minute countdown via TimerService.startFromDeadline so the deadline
 *   persists in sessionStorage and back-and-forward navigation does not reset.
 * - Persists each answer as the candidate clicks (sessionStorage 'readingAnswers').
 * - On timer expiry: auto-submits the whole test via ForceSubmitService
 *   (per-section auto-submit; no spillover into subsequent sections).
 * - On 3 tab switches: ForceSubmitService takes over.
 * - Continue button: warns if anything unanswered, then navigates to /writing.
 *
 * No data is POSTed from this page — answers stay in sessionStorage until
 * the speaking section's final submit (or a force-submit on termination).
 */
@Component({
  selector: 'app-reading',
  standalone: true,
  imports: [CommonModule, Topnav, Footer],
  templateUrl: './reading.html',
  styleUrl: './reading.css',
})
export class Reading implements OnInit, OnDestroy {
  private testContentSvc = inject(TestContentService);
  private store = inject(StoreService);
  private timer = inject(TimerService);
  private modal = inject(ModalService);
  private tracker = inject(VisibilityTrackerService);
  private forceSubmit = inject(ForceSubmitService);
  private router = inject(Router);

  content = signal<TestContent | null>(null);
  loadError = signal('');
  answers = signal<ReadingAnswers>({});
  /**
   * Toggled ON when the candidate clicks "Keep Answering" on the
   * unanswered-questions confirmation modal. While true, every unanswered
   * question gets the .unanswered-warning class (red border) so the
   * candidate can find them quickly. Cleared automatically as soon as all
   * questions are answered.
   */
  highlightUnanswered = signal(false);
  timerText = signal('--:--');
  timerState = signal<'normal' | 'warning' | 'danger'>('normal');

  candidateMeta = computed(() => {
    const c = this.content();
    return c ? `${c.candidate_name}  |  ${c.difficulty}` : 'Loading…';
  });

  totalQuestions = computed(() => this.content()?.questions.length ?? 0);
  answeredCount = computed(() => Object.keys(this.answers()).length);

  progressPct = computed(() => {
    const total = this.totalQuestions();
    if (total === 0) return 0;
    return Math.round((this.answeredCount() / total) * 100);
  });

  passageParagraphs = computed<string[]>(() => {
    const body = this.content()?.passage?.body ?? '';
    return body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  });

  private countdown: TimerHandle | null = null;
  /** Window-end auto-submit timer — fires when HR's scheduled window closes. */
  private windowTimerId: ReturnType<typeof setTimeout> | null = null;
  private subs = new Subscription();

  private beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };

  ngOnInit(): void {
    this.testContentSvc.load().subscribe({
      next: (c) => {
        // If HR excluded reading from this invitation, the candidate
        // shouldn't be on this page (e.g., they typed /reading directly,
        // or refreshed after the URL got into a weird state). Redirect to
        // the next included section without setting content — that keeps
        // the template stuck on its "Loading…" branch until navigation
        // completes, avoiding any null-derefs on c.passage.
        if (!c.sections.reading) {
          this.router.navigate([nextSectionRoute('instructions', c.sections)]);
          return;
        }
        this.content.set(c);
        this.answers.set(this.store.getReadingAnswers());
        this.startTimer(c);
        this.scheduleWindowEnd(c.valid_until_iso);
      },
      error: (err: ApiError) => {
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        if (err.status === 410) {
          this.router.navigate(['/submitted']);
          return;
        }
        this.loadError.set(err.message || 'Could not load test content.');
      },
    });

    this.tracker.start();

    this.subs.add(
      this.tracker.onFirstWarning().subscribe((p) => {
        this.modal.alert(
          `We detected that you switched away from this tab for ${p.durationSeconds} ` +
          `second${p.durationSeconds !== 1 ? 's' : ''}.\n\n` +
          `This incident has been logged and will be visible to your HR reviewer. ` +
          `Please keep this tab focused for the remainder of the test.`,
          { title: 'Tab switch detected' }
        );
      })
    );
    this.subs.add(
      this.tracker.onFinalWarning().subscribe((p) => {
        this.modal.alert(
          `Final warning.\n\n` +
          `You have switched away ${p.count} times. One more switch will ` +
          `automatically end your test and submit whatever data you've ` +
          `completed so far.\n\nPlease keep this tab focused.`,
          { title: '⚠ FINAL WARNING' }
        );
      })
    );
    // Resize-based violations (Gemini sidebar / DevTools / sidebar extension).
    // Same warning + terminate pattern as tab-switch but independent counter.
    this.subs.add(
      this.tracker.onFirstResizeWarning().subscribe((p) => {
        this.modal.alert(
          `We detected your browser window narrowed by ${p.pixelsLost} pixels — ` +
          `this happens when a side panel (like Chrome's Gemini, DevTools, or a ` +
          `browser extension) opens.\n\n` +
          `This incident has been logged and will be visible to your HR reviewer. ` +
          `Please close any side panels and use the full browser width for the test.`,
          { title: 'Window narrowing detected' }
        );
      })
    );
    this.subs.add(
      this.tracker.onFinalResizeWarning().subscribe((p) => {
        this.modal.alert(
          `Final warning.\n\n` +
          `Your window has been narrowed ${p.count} times. One more narrowing ` +
          `event will automatically end your test and submit whatever you've ` +
          `completed so far.\n\nClose any side panels (Gemini, DevTools, ` +
          `extensions) before proceeding.`,
          { title: '⚠ FINAL WARNING' }
        );
      })
    );
    this.subs.add(
      this.tracker.onResizeTerminate().subscribe(() => {
        if (this.countdown) {
          this.countdown.stop();
          this.countdown = null;
        }
        this.forceSubmit.terminateAndSubmit('tab_switch_termination');
      })
    );

    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  ngOnDestroy(): void {
    if (this.countdown) {
      this.countdown.stop();
      this.countdown = null;
    }
    if (this.windowTimerId !== null) {
      clearTimeout(this.windowTimerId);
      this.windowTimerId = null;
    }
    this.subs.unsubscribe();
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
  }

  // setTimeout silently clamps delays > INT32_MAX (~24.8 days) to 1ms,
  // firing the callback immediately. For windows scheduled further out we
  // chunk the wait — see armWindowTimer below.
  private static readonly MAX_TIMEOUT_MS = 2_147_483_000;

  /**
   * Schedule a setTimeout that auto-submits the test when HR's scheduled
   * window closes. Independent from the per-section reading timer — either
   * deadline triggers a submit, whichever fires first. setTimeout is
   * wall-clock-correct (unlike setInterval which gets throttled in hidden
   * tabs), so the window deadline is honored even if the candidate has
   * been backgrounded.
   */
  private scheduleWindowEnd(validUntilIso: string): void {
    this.armWindowTimer(new Date(validUntilIso).getTime());
  }

  private armWindowTimer(deadline: number): void {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // Already past the window when the page loaded — auto-submit now.
      this.forceSubmit.terminateAndSubmit('window_expired');
      return;
    }
    const delay = Math.min(remaining, Reading.MAX_TIMEOUT_MS);
    this.windowTimerId = setTimeout(() => {
      this.windowTimerId = null;
      if (Date.now() < deadline) {
        // Hit the chunk cap, not the real deadline — re-arm.
        this.armWindowTimer(deadline);
        return;
      }
      if (this.countdown) {
        this.countdown.stop();
        this.countdown = null;
      }
      this.forceSubmit.terminateAndSubmit('window_expired');
    }, delay);
  }

  /**
   * Set up the countdown using TimerService.startFromDeadline so the
   * deadline persists across navigation. If sessionStorage already has a
   * deadline (candidate came back to this page), we resume from it; otherwise
   * we compute deadline = now + duration and store it.
   */
  private startTimer(c: TestContent): void {
    let deadline = this.store.getReadingDeadline();
    if (deadline === null) {
      deadline = Date.now() + c.duration_written_seconds * 1000;
      this.store.setReadingDeadline(deadline);
    }

    // Already expired? Auto-submit the test (per-section auto-submit, no
    // spillover into the next section). Same fate as the on-expire handler.
    const initialRemaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    if (initialRemaining === 0) {
      this.forceSubmit.terminateAndSubmit('reading_timer_expired');
      return;
    }

    this.countdown = this.timer.startFromDeadline(
      deadline,
      (rem: number) => {
        this.timerText.set('⏱  ' + this.timer.formatTime(rem));
        const cls = this.timer.thresholdClass(rem);
        if (cls === 'danger') {
          this.timerState.set('danger');
        } else if (cls === 'warning') {
          this.timerState.set('warning');
        } else {
          this.timerState.set('normal');
        }
      },
      () => {
        // Reading countdown hit zero — auto-submit the test (per-section
        // auto-submit, no spillover into the next section).
        this.forceSubmit.terminateAndSubmit('reading_timer_expired');
      }
    );
  }

  selectAnswer(questionId: number, optionIndex: number): void {
    const current = { ...this.answers() };
    current[questionId] = optionIndex;
    this.answers.set(current);
    this.store.setReadingAnswers(current);
    // If the candidate has now answered everything, drop the red highlight
    // mode so the page returns to its default look. Cheaper than tracking
    // per-question highlight state — the global flag plus isUnanswered()
    // already gives us the right behavior.
    if (this.highlightUnanswered() && this.allAnswered()) {
      this.highlightUnanswered.set(false);
    }
  }

  /**
   * True only when the red-highlight mode is on AND this specific question
   * has no answer. Bound to the question container's class in the template.
   */
  isUnanswered(questionId: number): boolean {
    if (!this.highlightUnanswered()) return false;
    return this.answers()[questionId] === undefined;
  }

  /**
   * Used inside selectAnswer() to decide if we can drop the highlight mode.
   * Compares the count of stored answers to the count of questions on the
   * loaded test — cheaper than re-computing computed signals each click.
   */
  private allAnswered(): boolean {
    const total = this.totalQuestions();
    if (total === 0) return true;
    return Object.keys(this.answers()).length >= total;
  }

  isSelected(questionId: number, optionIndex: number): boolean {
    return this.answers()[questionId] === optionIndex;
  }

  labelForType(type: string): string {
    switch (type) {
      case 'reading_comp': return 'Reading Comprehension';
      case 'grammar':      return 'Grammar';
      case 'vocabulary':   return 'Vocabulary';
      case 'fill_blank':   return 'Fill in the Blank';
      default:             return type;
    }
  }

  letter(optionIndex: number): string {
    return String.fromCharCode(65 + optionIndex);
  }

  async onBack(): Promise<void> {
    const ok = await this.modal.confirm(
      'Going back will not stop the timer. The countdown keeps running.',
      { okText: 'Go Back', cancelText: 'Stay' }
    );
    if (ok) this.router.navigate(['/instructions']);
  }

  async onContinue(): Promise<void> {
    const c = this.content();
    if (!c) return;

    // Where will the candidate land next? Affects the confirmation copy
    // when they have unanswered questions ("Continue to Writing" vs
    // "Continue to Speaking" vs "Submit your test now").
    const nextRoute = nextSectionRoute('reading', c.sections);
    const nextLabel = this._labelForRoute(nextRoute);

    const stored = this.answers();
    const unanswered = c.questions.filter((q) => stored[q.id] === undefined);
    if (unanswered.length > 0) {
      const ok = await this.modal.confirm(
        `You have ${unanswered.length} unanswered ` +
        `question${unanswered.length === 1 ? '' : 's'}. ${nextLabel}?`,
        { okText: 'Continue', cancelText: 'Keep Answering', dangerous: true }
      );
      if (!ok) {
        // Candidate chose to go back and finish. Turn on the per-question
        // red highlight so they can spot the unanswered ones at a glance
        // instead of scrolling to find them.
        this.highlightUnanswered.set(true);
        return;
      }
    }
    if (this.countdown) {
      this.countdown.stop();
      this.countdown = null;
    }
    // If this is a Reading-only test, /submitted is the next route — but
    // /submitted is just a thank-you page; it does NOT call /api/submit.
    // We have to call submitFinal() here so the answers actually reach
    // the server before the candidate sees the success screen. For tests
    // that include writing or speaking, those pages own the submission.
    if (nextRoute === '/submitted') {
      try {
        await this.forceSubmit.submitFinal();
      } catch (err) {
        const msg = (err as ApiError)?.message ?? 'Unknown error';
        await this.modal.alert(
          `Could not submit your test: ${msg}\n\nPlease check your connection and try again.`,
          { title: 'Submission failed' }
        );
      }
      return;
    }
    this.router.navigate([nextRoute]);
  }

  private _labelForRoute(route: string): string {
    if (route === '/writing') return 'Continue to the Writing section';
    if (route === '/speaking') return 'Continue to the Speaking section';
    return 'Submit your test now';
  }

  trackQuestion = (_: number, q: QuestionPublic) => q.id;
}