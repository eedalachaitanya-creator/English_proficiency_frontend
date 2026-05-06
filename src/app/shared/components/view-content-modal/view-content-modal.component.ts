import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Read-only modal for viewing full content of a passage, question, writing
 * topic, or speaking topic. Generic — accepts any object plus a list of
 * field definitions saying which keys to render and how.
 *
 * Used from the four content list pages (Reading Passages, MCQ Questions,
 * Writing Topics, Speaking Topics). Keeping it generic rather than building
 * four near-identical modals because the layout (title + key/value rows)
 * is the same shape regardless of content type.
 */

export interface ViewField {
  /** Key on the data object — e.g. 'body' or 'correct_answer'. */
  key: string;
  /** Display label — e.g. 'Body' or 'Correct Answer'. */
  label: string;
  /** How to render the value:
   *  - 'text' (default): plain text in a paragraph
   *  - 'longtext': scrollable, monospace-friendly box (for body, prompt_text)
   *  - 'list': renders an array as bullet points (for question options)
   *  - 'badge': small inline pill (for difficulty, type)
   */
  render?: 'text' | 'longtext' | 'list' | 'badge';
}

@Component({
  selector: 'app-view-content-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './view-content-modal.component.html',
  styleUrl: './view-content-modal.component.css',
})
export class ViewContentModal {
  /** The data object to display. Set by parent before showing. */
  @Input() data: Record<string, unknown> | null = null;

  /** Modal title (e.g. 'View Passage', 'View Question'). */
  @Input() title = 'View';

  /** Field definitions for which keys to render and how. */
  @Input() fields: ViewField[] = [];

  /** Whether the modal is visible. Parent toggles this. */
  @Input() open = false;

  /** Called when user clicks Close, the backdrop, or presses Esc.
   *  Parent should set `open = false` in its handler. */
  onClose(): void {
    this.open = false;
  }

  /** Stop bubbling so clicks INSIDE the modal box don't trigger backdrop close. */
  onContentClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  /** Pulls value at key from data, returns '' if missing/null. */
  valueOf(key: string): unknown {
    if (!this.data) return '';
    const v = this.data[key];
    return v === null || v === undefined ? '' : v;
  }

  /** Convenience for the template — is the value an array? */
  isArray(v: unknown): boolean {
    return Array.isArray(v);
  }
}