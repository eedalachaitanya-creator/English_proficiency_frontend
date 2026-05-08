import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, race, timer } from 'rxjs';
import { mapTo } from 'rxjs/operators';

import { VisibilityTrackerService } from './visibility-tracker.service';

/**
 * Regression suite for the "tab-switch sometimes warns, sometimes not"
 * bug. The previous implementation dropped switches under 2 seconds and
 * did not listen for window blur/focus, so OS-level Cmd+Tab on macOS
 * was missed entirely. Each test below targets one of those gaps.
 */
describe('VisibilityTrackerService — strict tab-switch flagging', () => {
  let service: VisibilityTrackerService;

  function setHidden(value: boolean): void {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => value,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (value ? 'hidden' : 'visible'),
    });
  }

  function setFocus(value: boolean): void {
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      writable: true,
      value: () => value,
    });
  }

  function leaveTabAndReturn(): void {
    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
  }

  function appSwitchAndReturn(): void {
    setFocus(false);
    window.dispatchEvent(new Event('blur'));
    setFocus(true);
    window.dispatchEvent(new Event('focus'));
  }

  beforeEach(() => {
    sessionStorage.clear();
    setHidden(false);
    setFocus(true);
    TestBed.configureTestingModule({});
    service = TestBed.inject(VisibilityTrackerService);
    service.reset();
  });

  afterEach(() => {
    service.stop();
    service.reset();
  });

  it('flags a sub-second tab-switch (the primary reported bug)', async () => {
    service.start();
    const warning = firstValueFrom(
      race(service.onFirstWarning(), timer(500).pipe(mapTo(null as any))),
    );

    leaveTabAndReturn();

    expect(service.getStats().count).toBe(1);
    const payload = await warning;
    expect(payload).not.toBeNull();
    expect(payload.count).toBe(1);
  });

  it('flags an app-level switch via window blur/focus (Cmd+Tab on macOS)', async () => {
    service.start();
    const warning = firstValueFrom(
      race(service.onFirstWarning(), timer(500).pipe(mapTo(null as any))),
    );

    appSwitchAndReturn();

    expect(service.getStats().count).toBe(1);
    const payload = await warning;
    expect(payload).not.toBeNull();
    expect(payload.count).toBe(1);
  });

  it('counts one strike when blur AND visibilitychange both fire for one switch', () => {
    service.start();

    // Both events for a single physical switch
    setHidden(true);
    setFocus(false);
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));

    setHidden(false);
    setFocus(true);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(service.getStats().count).toBe(1);
  });

  it('emits terminate$ on the 3rd strike (auto-submit trigger)', async () => {
    service.start();
    const terminated = firstValueFrom(
      race(service.onTerminate(), timer(500).pipe(mapTo(null as any))),
    );

    leaveTabAndReturn(); // strike 1
    leaveTabAndReturn(); // strike 2
    leaveTabAndReturn(); // strike 3 → terminate

    const stats = await terminated;
    expect(stats).not.toBeNull();
    expect(stats.count).toBe(3);
    expect(service.getStats().count).toBe(3);
  });

  it('three quick switches each get individually counted (no silent drops)', () => {
    service.start();

    leaveTabAndReturn();
    leaveTabAndReturn();
    leaveTabAndReturn();

    expect(service.getStats().count).toBe(3);
  });
});
