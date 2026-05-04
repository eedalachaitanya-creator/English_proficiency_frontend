/**
 * Sections-aware navigation helper for the candidate flow.
 *
 * Canonical order is Reading → Writing → Speaking. Each section page calls
 * nextSectionRoute() with its own name + the SectionFlags returned by
 * /api/test-content; the helper walks the order and returns the route for
 * the next included section, or '/submitted' if there are no more.
 *
 * The instructions page passes 'instructions' as the current section to
 * get the FIRST included section's route.
 *
 * Pure function — no Angular DI. Easy to unit-test if/when we add coverage.
 */
import { SectionFlags } from '../models/test.models';

export type SectionName = 'instructions' | 'reading' | 'writing' | 'speaking';

const ORDER: ReadonlyArray<{ name: 'reading' | 'writing' | 'speaking'; route: string }> = [
  { name: 'reading', route: '/reading' },
  { name: 'writing', route: '/writing' },
  { name: 'speaking', route: '/speaking' },
];

export function nextSectionRoute(current: SectionName, sections: SectionFlags): string {
  // Where to start scanning. 'instructions' means "look at the very first
  // section"; any other section means "skip past it".
  const startIdx = current === 'instructions'
    ? 0
    : ORDER.findIndex(s => s.name === current) + 1;

  for (let i = startIdx; i < ORDER.length; i++) {
    if (sections[ORDER[i].name]) {
      return ORDER[i].route;
    }
  }
  return '/submitted';
}
