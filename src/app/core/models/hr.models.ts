/**
 * Type definitions for HR-side flows.
 *
 * Match the JSON shapes returned by:
 *   /api/hr/login, /api/hr/me, /api/hr/invite,
 *   /api/hr/results, /api/hr/results/:invitation_id
 *
 * Source of truth: backend/schemas.py (HRLoginRequest, HRLoginResponse,
 * InviteCreateRequest, InviteCreateResponse, ScoreRow, ScoreDetail,
 * AudioRecordingPublic).
 */

// ===========================================================================
//  Auth
// ===========================================================================

export interface HRLoginRequest {
  email: string;
  password: string;
}

export interface HRUser {
  id: number;
  name: string;
  email: string;
  // JWT tokens — present on login response, absent on /me / session-status.
  // The frontend only stores them on login; downstream callers can ignore them.
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  // TRUE while the user is on a temp password from /forgot-password.
  // Backend sets this on reset, clears on /change-password. Optional
  // here so older response shapes (without the field) are interpreted
  // as "no action needed" rather than crashing the type check.
  must_change_password?: boolean;
}

// ===========================================================================
//  Admin auth — separate role, separate portal
//  See backend docs/superpowers/specs/2026-05-04-admin-portal-design.md
// ===========================================================================

export interface AdminLoginRequest {
  email: string;
  password: string;
}

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: 'admin'; // backend always returns 'admin' here
  // JWT tokens — present on login response, absent on /me / session-status.
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  // See HRUser.must_change_password.
  must_change_password?: boolean;
}
export interface RefreshTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** POST /api/admin/users body — admin types the new user's password
 * directly and picks the role. Defaults the role to 'hr' on the server
 * if omitted, but the UI always sends an explicit value. */
export interface UserCreateByAdminRequest {
  name: string;
  email: string;
  password: string;
  role: 'hr' | 'admin';
}

/** POST /api/admin/users response — includes email_status so the admin
 * UI can tell user creation succeeded but welcome email failed
 * (same pattern as candidate invitations). `role` round-trips so the
 * success notice can use the right wording. */
export interface UserCreateByAdminResponse {
  id: number;
  name: string;
  email: string;
  role: 'hr' | 'admin';
  email_status: 'sent' | 'failed' | 'pending';
  email_error: string | null;
}

/**
 * One row in GET /api/admin/users — the admin dashboard's top-level
 * table. Lists every row in hr_admins (both 'hr' and 'admin' roles)
 * with a count of how many invitations they've sent. Admins always
 * have candidate_count=0.
 */
export interface AdminUserSummary {
  id: number;
  name: string;
  email: string;
  role: 'hr' | 'admin';
  candidate_count: number;
  created_at: string;
}

// ===========================================================================
//  Invitations
// ===========================================================================

/**
 * One row from GET /api/hr/timezones — populates the timezone dropdown in
 * the invite-modal. Backend returns active rows from the supported_timezones
 * table sorted by sort_order.
 */
export interface SupportedTimezone {
  iana_name: string;       // "Asia/Kolkata" — sent back as the `timezone` field
  display_label: string;   // "India Standard Time (IST)" — what HR sees in the dropdown
  short_label: string;     // "IST" — what the candidate sees in emails / error messages
}

export interface InviteCreateRequest {
  candidate_name: string;
  candidate_email: string;
  difficulty: 'intermediate' | 'expert';
  // ISO-8601 UTC strings — see hr-dashboard.ts submitInvite() for the
  // wall-clock-to-UTC conversion (interpreted in the selected timezone,
  // NOT browser local). Both required.
  valid_from: string;
  valid_until: string;
  // IANA timezone name (e.g. "Asia/Kolkata", "America/New_York") that HR
  // selected in the invite modal. Backend uses this to render the
  // scheduled window in the candidate's invitation email. Allowed values
  // are gated server-side; see schemas.ALLOWED_TIMEZONES in the backend.
  timezone: string;
  // Per-invitation section selection. HR picks any non-empty subset of
  // the three sections. Backend validator rejects all-three-false; the
  // form prevents that case via a disabled Generate Link button.
  include_reading: boolean;
  include_writing: boolean;
  include_speaking: boolean;
}

export interface InviteCreateResponse {
  invitation_id: number;
  token: string;
  candidate_name: string;
  candidate_email: string;
  difficulty: 'intermediate' | 'expert';
  exam_url: string;
  access_code: string;          // 6-digit passcode the candidate enters
  expires_at: string;
  // Email delivery state — drives the dashboard's UX after Generate Link.
  //   "sent"    → frontend shows success toast, closes modal
  //   "failed"  → frontend keeps modal open, shows error + URL/code as fallback
  //   "pending" → SMTP not configured (treat like "failed" in UI)
  email_status: 'sent' | 'failed' | 'pending';
  email_error: string | null;   // short reason if email_status === "failed"
}

/**
 * Returned by GET /api/hr/invitation/:id/details — drives the
 * "INVITATION DETAILS" card on the candidate-detail page for pending
 * (not-yet-submitted) candidates. HR uses this view to recover the URL
 * after the post-invite popup is dismissed, and to resend the email.
 */
export interface InvitationDetails {
  invitation_id: number;
  candidate_name: string;
  candidate_email: string;
  difficulty: string;

  created_at: string;
  valid_from: string;          // window start (ISO UTC) — when URL becomes active
  expires_at: string;          // window end (ISO UTC) — when URL stops working
  started_at: string | null;
  submitted_at: string | null;

  exam_url: string;
  access_code: string;

  email_status: 'sent' | 'failed' | 'pending';
  email_error: string | null;

  code_locked: boolean;
  failed_code_attempts: number;

  // IANA timezone the original invitation was scheduled in. Used by the
  // resend modal to pre-fill the timezone dropdown so HR doesn't repick.
  display_timezone: string;
}

/**
 * Body for POST /api/hr/invite/:id/resend-email. HR picks a NEW window
 * when resending — the old one has often expired. Same shape as the
 * window fields on InviteCreateRequest so the backend can reuse its
 * existing _validate_window helper.
 */
export interface ResendInvitationRequest {
  valid_from: string;   // ISO-8601 UTC
  valid_until: string;  // ISO-8601 UTC
  timezone: string;     // IANA name; backend validates against the supported_timezones table
}

/**
 * Returned by POST /api/hr/invite/:id/resend-email. Just the email outcome
 * — the candidate-detail page uses this to update the badge + show a toast.
 */
export interface ResendEmailResponse {
  email_status: 'sent' | 'failed' | 'pending';
  email_error: string | null;
}

// ===========================================================================
//  Results — table rows + detail panel
// ===========================================================================

/**
 * Wrapper returned by GET /api/admin/hrs/{hr_id}/candidates so a busy
 * HR's candidate list pages instead of streaming all rows at once.
 * The backend slices via SQL LIMIT/OFFSET; the frontend keeps the
 * latest page in component state and re-requests for prev/next.
 */
export interface PaginatedScoreSummary {
  items: ResultRow[];   // reuses the existing dashboard row type
  total: number;        // total candidates across all pages
  page: number;         // 1-indexed page being returned
  page_size: number;    // server-applied page size (capped at 100)
}

/** One row per invitation in the dashboard table. */
export interface ResultRow {
  invitation_id: number;
  candidate_name: string;
  candidate_email: string;
  difficulty: 'intermediate' | 'expert';
  created_at: string;
  submitted_at: string | null;
  reading_score: number | null;
  writing_score: number | null;
  speaking_score: number | null;
  total_score: number | null;
  rating: 'recommended' | 'borderline' | 'not_recommended' | null;
  // Which sections HR included in this invitation. Drives the small
  // "R · W · S" chip near the candidate name. Defaults to all-true on
  // the backend for legacy rows.
  include_reading: boolean;
  include_writing: boolean;
  include_speaking: boolean;
  /** Window expiry — used to compute "Not Attended" status for
      unsubmitted invitations whose window has passed. */
  expires_at: string;
}

/** A single audio recording — info HR needs to play it back. */
export interface AudioRecordingPublic {
  id: number;
  question_index: number;
  topic_prompt: string;
  duration_seconds: number | null;
  transcript: string | null;
}

/**
 * Full breakdown for one candidate. Returned by /api/hr/results/:id.
 *
 * Shape matches backend/schemas.py:ScoreDetail. Note: this is NOT a strict
 * extension of ResultRow — backend's ScoreDetail doesn't include created_at
 * (only submitted_at), and `rating` is a free-form string rather than the
 * union used in ResultRow. We mirror that here.
 */
export interface ResultDetail {
  invitation_id: number;
  candidate_name: string;
  candidate_email: string;
  difficulty: string;
  submitted_at: string | null;

  reading_score: number | null;
  reading_correct: number | null;
  reading_total: number | null;

  writing_topic_text: string | null;
  essay_text: string | null;
  essay_word_count: number | null;
  writing_breakdown: Record<string, number | null> | null;
  writing_score: number | null;

  speaking_breakdown: Record<string, number | null> | null;
  speaking_score: number | null;

  total_score: number | null;
  rating: string | null;
  ai_feedback: string | null;

  // Per-invitation section selection. Legacy rows default to true on the
  // backend so the candidate-detail page can render the right empty-state
  // copy ("Not included in this test" vs "Not yet submitted").
  include_reading: boolean;
  include_writing: boolean;
  include_speaking: boolean;

  // Tab-switching telemetry. count = number of times the candidate switched
  // away (after the 2-second threshold); total_seconds = cumulative time away.
  // Old rows submitted before the columns existed default to 0 server-side.
  tab_switches_count: number | null;
  tab_switches_total_seconds: number | null;

  // Why the test ended. Null for old rows submitted before this column existed.
  // One of: candidate_finished | reading_timer_expired | writing_timer_expired
  // | speaking_timer_expired | tab_switch_termination | window_expired.
  submission_reason: string | null;

  audio_recordings: AudioRecordingPublic[];
}