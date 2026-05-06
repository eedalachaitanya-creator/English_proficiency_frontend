/**
 * Date utilities for converting backend ISO strings into local-time
 * displays.
 *
 * The backend stores datetime columns in NAIVE UTC (no tzinfo), and
 * Pydantic serializes them as ISO-8601 without a Z suffix, e.g.
 * "2026-05-06T22:12:16". JavaScript's Date constructor interprets a
 * timezone-less ISO string as LOCAL time — so a 22:12 UTC moment
 * would be wrongly read as 22:12 in the browser's local zone, then
 * displayed back as the same numbers no matter what zone the user
 * is in. The fix: stamp the string with "Z" before parsing so JS
 * treats it as UTC and toLocaleString() correctly converts to local.
 *
 * Use these helpers everywhere instead of `new Date(s).toLocaleString()`.
 */

/**
 * Parse a backend ISO string as UTC. If the string already has a
 * timezone suffix ('Z' or '+hh:mm'), leave it alone. If it's naive,
 * append 'Z' so JS interprets it as UTC instead of local.
 *
 * Returns null for null/undefined/empty inputs so callers can render
 * a placeholder ('—') without re-checking.
 */
export function parseBackendDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Has explicit zone suffix? Pass through.
  // Match either trailing 'Z' or a "+hh:mm" / "-hh:mm" offset.
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const isoUtc = hasZone ? trimmed : trimmed + 'Z';
  const d = new Date(isoUtc);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a backend datetime as a localized date+time string in the
 * browser's current timezone. Returns '—' for null/empty/invalid.
 */
export function formatBackendDateTime(s: string | null | undefined): string {
  const d = parseBackendDate(s);
  return d ? d.toLocaleString() : '—';
}

/**
 * Format a backend datetime as a localized date-only string in the
 * browser's current timezone. Returns '—' for null/empty/invalid.
 */
export function formatBackendDate(s: string | null | undefined): string {
  const d = parseBackendDate(s);
  return d ? d.toLocaleDateString() : '—';
}
