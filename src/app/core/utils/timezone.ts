/**
 * Timezone helpers for converting HR-entered wall-clock date+time
 * values into UTC Dates.
 *
 * Originally lived in hr-dashboard.ts as a private function. Extracted
 * here when the resend-invitation modal needed the same conversion —
 * keeping it private to the dashboard would have meant duplicating
 * 40 lines of DST-aware date math. Single source of truth.
 */

/**
 * Convert a wall-clock date/time entered by HR into a UTC Date, interpreting
 * the input in the given IANA timezone — NOT in the browser's local zone.
 *
 * Why this is non-trivial: JavaScript's `new Date("2026-05-04T16:57")`
 * parses the string in browser-local time. There is no built-in way to say
 * "interpret these wall-clock numbers as IST" if the browser is set to PST.
 * So we compute the offset by formatting a candidate UTC moment back into
 * the target zone and measuring how far off we are. Two iterations are
 * enough — this technique is robust across DST transitions because it
 * uses Intl.DateTimeFormat (which knows the IANA database).
 *
 * Returns null if the inputs are malformed (e.g. empty strings).
 *
 * Inputs:
 *   dateStr = "YYYY-MM-DD"
 *   timeStr = "HH:MM"
 *   tz      = IANA zone name (e.g. "Asia/Kolkata", "America/Los_Angeles")
 */
export function wallClockToUtc(dateStr: string, timeStr: string, tz: string): Date | null {
  if (!dateStr || !timeStr) return null;
  const [yStr, mStr, dStr] = dateStr.split('-');
  const [hStr, minStr] = timeStr.split(':');
  const y = +yStr, m = +mStr, d = +dStr, h = +hStr, min = +minStr;
  if ([y, m, d, h, min].some(n => Number.isNaN(n))) return null;

  // First guess: pretend the wall clock IS UTC. We'll measure how wrong
  // this is in the target timezone and correct.
  const guess = Date.UTC(y, m - 1, d, h, min, 0);

  // Iterate twice — once to correct, once to handle DST edge cases where
  // the first correction crosses a transition.
  let utcMs = guess;
  for (let i = 0; i < 2; i++) {
    const partsInTz = getPartsInTimezone(new Date(utcMs), tz);
    const tzAsUtcMs = Date.UTC(
      partsInTz.year, partsInTz.month - 1, partsInTz.day,
      partsInTz.hour, partsInTz.minute, 0
    );
    // Difference = how many ms ahead the timezone is of UTC at this instant.
    const offsetMs = tzAsUtcMs - utcMs;
    // To make the wall clock in tz read (y, m, d, h, min), the actual UTC
    // moment must be the guess MINUS the timezone's offset.
    utcMs = guess - offsetMs;
  }
  return new Date(utcMs);
}

/**
 * Read y/m/d/h/min of a Date as it appears in the given IANA timezone.
 * Uses Intl.DateTimeFormat — the only stdlib API that knows IANA zones.
 */
export function getPartsInTimezone(d: Date, tz: string): {
  year: number; month: number; day: number; hour: number; minute: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  // Intl can return "24" for hour at midnight in some locales — normalize.
  const hour = parts['hour'] === '24' ? 0 : +parts['hour'];
  return {
    year: +parts['year'],
    month: +parts['month'],
    day: +parts['day'],
    hour,
    minute: +parts['minute'],
  };
}
