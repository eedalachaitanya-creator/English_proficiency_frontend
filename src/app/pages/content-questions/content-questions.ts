import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ModalService } from '../../core/services/modal.service';
import {
  HrContentService,
  QuestionOut,
  QuestionType,
  PassageOut,
  BulkImportResult,
} from '../../core/services/hr-content.service';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';
import { Sidebar } from '../../shared/components/sidebar/sidebar';
import { ViewContentModal, ViewField } from '../../shared/components/view-content-modal/view-content-modal.component';

import { deleteModalService } from '../../core/services/deletemodal.service';

/**
 * MCQ Questions management — list, create, edit, delete, bulk-import.
 *
 * The form handles all 4 question types in one component:
 *   - reading_comp: requires passage_id (dropdown shows existing passages)
 *   - grammar / vocabulary / fill_blank: passage_id must be null
 */
@Component({
  selector: 'app-content-questions',
  standalone: true,
  imports: [CommonModule, FormsModule, Topnav, Footer, AccountMenu, Sidebar, ViewContentModal],
  templateUrl: './content-questions.html',
  styleUrl: './content-questions.css',
})
export class ContentQuestions implements OnInit {

   constructor(private delmodal: deleteModalService) {}

  private contentSvc = inject(HrContentService);
  private modal = inject(ModalService);
  private router = inject(Router);
  private auth = inject(AuthService);

  // Topnav account menu — name/email come from the cached HR session.
  hrEmail = computed(() => this.auth.currentUser()?.email ?? 'Loading…');
  hrName = computed(() => this.auth.currentUser()?.name ?? '');
  onLogout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }

  // ------- List state -------
  questions = signal<QuestionOut[]>([]);
  passages = signal<PassageOut[]>([]);
  loading = signal(true);
  // ---- View modal state ----
  viewModalOpen = signal(false);
  viewModalData = signal<QuestionOut | null>(null);
  viewModalFields: ViewField[] = [
    { key: 'question_type', label: 'Type', render: 'badge' },
    { key: 'difficulty', label: 'Difficulty', render: 'badge' },
    { key: 'stem', label: 'Question', render: 'longtext' },
    { key: 'options', label: 'Options', render: 'list' },
    { key: 'correct_answer', label: 'Correct Option (0-indexed)', render: 'text' },
    { key: 'passage_id', label: 'Passage ID', render: 'text' },
  ];
  loadError = signal('');

  filterType = signal<QuestionType | ''>('');
  filterDifficulty = signal<'intermediate' | 'expert' | ''>('');
  filterPassageId = signal<number | null>(null);

  // ------- Form state (used for both create and edit) -------
  formOpen = signal(false);
  formMode = signal<'create' | 'edit'>('create');
  editingId = signal<number | null>(null);

  formType = signal<QuestionType>('grammar');
  formDifficulty = signal<'intermediate' | 'expert'>('intermediate');
  formStem = signal('');
  formOptions = signal<string[]>(['', '', '', '']);
  formCorrectAnswer = signal<number>(0);
  formPassageId = signal<number | null>(null);

  formSubmitting = signal(false);
  formError = signal('');

  // ------- Bulk-import modal state -------
  csvOpen = signal(false);
  csvFile = signal<File | null>(null);
  csvSubmitting = signal(false);
  csvResult = signal<BulkImportResult | null>(null);
  csvError = signal('');

  passagesForCurrentDifficulty = computed(() => {
    const d = this.formDifficulty();
    return this.passages().filter(p => p.difficulty === d);
  });

  ngOnInit(): void {
    this.loadAll();
  }

  private loadAll(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.contentSvc.listQuestions({}).subscribe({
      next: (q) => {
        this.questions.set(q);
        this.contentSvc.listPassages().subscribe({
          next: (p) => {
            this.passages.set(p);
            this.loading.set(false);
          },
          error: () => {
            this.loading.set(false);
          },
        });
      },
      error: (err: ApiError) => {
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        this.loadError.set(err.message || 'Could not load questions.');
        this.loading.set(false);
      },
    });
  }

  filteredQuestions = computed(() => {
    const all = this.questions();
    const t = this.filterType();
    const d = this.filterDifficulty();
    const pid = this.filterPassageId();
    return all.filter(q => {
      if (t && q.question_type !== t) return false;
      if (d && q.difficulty !== d) return false;
      if (pid !== null && q.passage_id !== pid) return false;
      return true;
    });
  });

  // ---- Pagination state ----
  currentPage = signal(1);
  readonly pageSize = 10;

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredQuestions().length / this.pageSize))
  );

  effectivePage = computed(() =>
    Math.min(Math.max(1, this.currentPage()), this.totalPages())
  );

  pagedQuestions = computed(() => {
    const start = (this.effectivePage() - 1) * this.pageSize;
    return this.filteredQuestions().slice(start, start + this.pageSize);
  });

  /** Filter-change hook — resets to page 1 so applying a filter
   * doesn't leave the user on a non-existent page. The template's
   * filter <select>s call this after each setter. */
  onFilterChange(): void {
    this.currentPage.set(1);
  }

  prevPage(): void {
    if (this.effectivePage() > 1) this.currentPage.set(this.effectivePage() - 1);
  }

  nextPage(): void {
    if (this.effectivePage() < this.totalPages()) {
      this.currentPage.set(this.effectivePage() + 1);
    }
  }

  typeLabel(t: QuestionType): string {
    switch (t) {
      case 'reading_comp': return 'Reading Comp';
      case 'grammar':      return 'Grammar';
      case 'vocabulary':   return 'Vocabulary';
      case 'fill_blank':   return 'Fill in Blank';
      default:             return t;
    }
  }

  letter(i: number): string {
    return String.fromCharCode(65 + i);
  }

  truncate(text: string, max = 80): string {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  passageTitleFor(id: number | null): string {
    if (id === null) return '—';
    const p = this.passages().find(p => p.id === id);
    return p ? p.title : `#${id}`;
  }

  openCreateForm(): void {
    this.formMode.set('create');
    this.editingId.set(null);
    this.formType.set('grammar');
    this.formDifficulty.set('intermediate');
    this.formStem.set('');
    this.formOptions.set(['', '', '', '']);
    this.formCorrectAnswer.set(0);
    this.formPassageId.set(null);
    this.formError.set('');
    this.formOpen.set(true);
  }

  openEditForm(q: QuestionOut): void {
    this.formMode.set('edit');
    this.editingId.set(q.id);
    this.formType.set(q.question_type);
    this.formDifficulty.set(q.difficulty as 'intermediate' | 'expert');
    this.formStem.set(q.stem);
    this.formOptions.set([...q.options]);
    this.formCorrectAnswer.set(q.correct_answer);
    this.formPassageId.set(q.passage_id);
    this.formError.set('');
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (this.formSubmitting()) return;
    this.formOpen.set(false);
  }

  setFormOption(index: number, value: string): void {
    const opts = [...this.formOptions()];
    opts[index] = value;
    this.formOptions.set(opts);
  }

  onFormTypeChange(): void {
    if (this.formType() !== 'reading_comp') {
      this.formPassageId.set(null);
    }
  }

  private validateForm(): string | null {
    const stem = this.formStem().trim();
    if (!stem) return 'Stem (the question text) is required.';
    const opts = this.formOptions();
    if (opts.length !== 4 || opts.some(o => !o.trim())) {
      return 'All 4 options must be filled in.';
    }
    const correct = this.formCorrectAnswer();
    if (correct < 0 || correct > 3) {
      return 'Pick which option is the correct answer (A, B, C, or D).';
    }
    if (this.formType() === 'reading_comp' && this.formPassageId() === null) {
      return 'Reading comprehension questions must be linked to a passage.';
    }
    if (this.formType() !== 'reading_comp' && this.formPassageId() !== null) {
      return 'Only reading comprehension questions can be linked to a passage.';
    }
    return null;
  }

  submitForm(): void {
    const err = this.validateForm();
    if (err) {
      this.formError.set(err);
      return;
    }
    this.formError.set('');
    this.formSubmitting.set(true);

    if (this.formMode() === 'create') {
      this.contentSvc.createQuestion({
        question_type: this.formType(),
        difficulty: this.formDifficulty(),
        stem: this.formStem().trim(),
        options: this.formOptions().map(o => o.trim()),
        correct_answer: this.formCorrectAnswer(),
        passage_id: this.formPassageId(),
      }).subscribe({
        next: (created) => {
          this.questions.update(arr => [created, ...arr]);
          this.formSubmitting.set(false);
          this.formOpen.set(false);
        },
        error: (err: ApiError) => {
          this.formSubmitting.set(false);
          this.formError.set(err.message || 'Could not create question.');
        },
      });
    } else {
      const id = this.editingId();
      if (id === null) {
        this.formSubmitting.set(false);
        return;
      }
      this.contentSvc.updateQuestion(id, {
        stem: this.formStem().trim(),
        difficulty: this.formDifficulty(),
        options: this.formOptions().map(o => o.trim()),
        correct_answer: this.formCorrectAnswer(),
      }).subscribe({
        next: (updated) => {
          this.questions.update(arr =>
            arr.map(q => q.id === updated.id ? updated : q)
          );
          this.formSubmitting.set(false);
          this.formOpen.set(false);
        },
        error: (err: ApiError) => {
          this.formSubmitting.set(false);
          this.formError.set(err.message || 'Could not update question.');
        },
      });
    }
  }

  /** Open the View modal for the given question. */
  onView(q: QuestionOut): void {
    this.viewModalData.set(q);
    this.viewModalOpen.set(true);
  }

  /** Close the View modal. Wired to the modal's (closed) emitter. */
  onCloseView(): void {
    this.viewModalOpen.set(false);
    this.viewModalData.set(null);
  }

  /** Toggle a question's disabled state. Updates row in place. */
  onToggleDisabled(q: QuestionOut): void {
    this.contentSvc.toggleQuestionDisabled(q.id).subscribe({
      next: (updated) => {
        this.questions.update(arr =>
          arr.map(x => (x.id === updated.id ? updated : x))
        );
      },
      error: async (err: ApiError) => {
        await this.modal.alert(
          err.message || 'Could not update question.',
          { title: 'Toggle failed' }
        );
      },
    });
  }
   async onDelete(p: QuestionOut): Promise<void> {
    const confirmed = await this.delmodal.confirm({
      message: 'Delete this question?',
      itemName: p.stem,
      title: 'Confirm Delete',
      okText: 'Delete',
      cancelText: 'Cancel',
      dangerous: true
    });
    
    if (!confirmed) return;

    this.contentSvc.deleteQuestion(p.id).subscribe({
      next: () => {
        this.questions.update(arr => arr.filter(x => x.id !== p.id));
      },
      error: async (err: ApiError) => {
        await this.modal.alert(err.message || 'Could not delete question.');
      },
    });
  }

  openCsvModal(): void {
    this.csvFile.set(null);
    this.csvResult.set(null);
    this.csvError.set('');
    this.csvOpen.set(true);
  }

  closeCsvModal(): void {
    if (this.csvSubmitting()) return;
    this.csvOpen.set(false);
  }

  onCsvFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.csvFile.set(file);
    this.csvError.set('');
    this.csvResult.set(null);
  }

  submitCsv(): void {
    const file = this.csvFile();
    if (!file) {
      this.csvError.set('Choose a CSV file first.');
      return;
    }
    this.csvSubmitting.set(true);
    this.csvError.set('');

    this.contentSvc.bulkImportQuestions(file).subscribe({
      next: (result) => {
        this.csvResult.set(result);
        this.csvSubmitting.set(false);
        if (result.created > 0) {
          this.contentSvc.listQuestions({}).subscribe({
            next: (q) => this.questions.set(q),
            error: () => { /* keep old list */ },
          });
        }
      },
      error: (err: ApiError) => {
        this.csvSubmitting.set(false);
        this.csvError.set(err.message || 'Upload failed.');
      },
    });
  }

  trackById = (_: number, q: QuestionOut) => q.id;
}