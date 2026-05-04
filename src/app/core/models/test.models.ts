/**
 * Type definitions for the candidate-side test flow.
 *
 * These match the JSON shapes returned by the FastAPI backend's
 * /api/test-content endpoint and accepted by /api/submit.
 *
 * Source of truth: backend/schemas.py (TestContentResponse,
 * QuestionPublic, PassagePublic, SpeakingTopicPublic, WritingTopicPublic).
 *
 * If the backend schema changes, update these types too — the TypeScript
 * compiler will then flag every page that needs an update.
 */

/** A single multiple-choice question — answer key is NOT included on the wire. */
export interface QuestionPublic {
  id: number;
  question_type: 'reading_comp' | 'grammar' | 'vocabulary' | 'fill_blank';
  difficulty: 'intermediate' | 'expert';
  stem: string;
  options: string[]; // always exactly 4 options
}

/** The reading passage assigned to this candidate (one per test). */
export interface PassagePublic {
  id: number;
  title: string;
  body: string; // multi-paragraph; split by double newlines on the client
  topic: string | null;
  word_count: number | null;
}

/** A single speaking prompt. The candidate gets a random subset (default: 3). */
export interface SpeakingTopicPublic {
  id: number;
  prompt_text: string;
  category: string | null;
}

/** The writing prompt assigned to this candidate (one per test). */
export interface WritingTopicPublic {
  id: number;
  prompt_text: string;
  min_words: number;
  max_words: number;
  category: string | null;
}

/** Which sections this candidate's exam includes. Drives candidate-flow
 * routing: sections set to false are skipped entirely. */
export interface SectionFlags {
  reading: boolean;
  writing: boolean;
  speaking: boolean;
}

/** Full payload returned by GET /api/test-content. */
export interface TestContent {
  candidate_name: string;
  difficulty: 'intermediate' | 'expert';

  // Per-invitation section selection. Excluded sections come back as
  // null/empty in the corresponding content fields below.
  sections: SectionFlags;

  // Section 1 — Reading
  passage: PassagePublic | null;
  questions: QuestionPublic[]; // empty array when reading is excluded

  // Section 2 — Writing
  writing_topic: WritingTopicPublic | null;
  duration_writing_seconds: number;

  // Section 3 — Speaking
  speaking_topics: SpeakingTopicPublic[]; // empty array when speaking is excluded
  duration_speaking_seconds: number;

  // Timing
  duration_written_seconds: number;
  // Window-end as ISO-8601 UTC string (suffix "Z"). Each test page schedules
  // a setTimeout against this so the test auto-submits at the window end
  // even mid-section. Distinct from per-section timers (duration_*_seconds).
  valid_until_iso: string;
}

/** Server response from POST /api/submit. */
export interface SubmitResponse {
  ref_id: string; // e.g. "EPT-00001-5YICMW"
  status: string; // "submitted"
}

/** Map of question_id → selected option index (0-3). */
export type ReadingAnswers = Record<number, number>;