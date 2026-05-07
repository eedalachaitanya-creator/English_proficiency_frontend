import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ModalService } from '../../core/services/modal.service';
import {
  HrContentService,
  WritingTopicOut,
  BulkImportResult,
} from '../../core/services/hr-content.service';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';
import { Sidebar } from '../../shared/components/sidebar/sidebar';
import { deleteModalService } from '../../core/services/deletemodal.service';
import { ViewContentModal, ViewField } from '../../shared/components/view-content-modal/view-content-modal.component';
/**
 * Writing topics management — list, create, edit, delete, bulk-import.
 * Each topic is an essay prompt with a min/max word range.
 */
@Component({
  selector: 'app-content-writing-topics',
  standalone: true,
  imports: [CommonModule, FormsModule, Topnav, Footer, AccountMenu, Sidebar, ViewContentModal],
  templateUrl: './content-writing-topics.html',
  styleUrl: './content-writing-topics.css',
})
export class ContentWritingTopics implements OnInit {
   constructor(private delmodal: deleteModalService) {}
  private contentSvc = inject(HrContentService);
  private modal = inject(ModalService);
  private router = inject(Router);
  private auth = inject(AuthService);

  hrEmail = computed(() => this.auth.currentUser()?.email ?? 'Loading…');
  hrName = computed(() => this.auth.currentUser()?.name ?? '');
  onLogout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }

  topics = signal<WritingTopicOut[]>([]);
  loading = signal(true);
  // ---- View modal state ----
  viewModalOpen = signal(false);
  viewModalData = signal<WritingTopicOut | null>(null);
  viewModalFields: ViewField[] = [
    { key: 'difficulty', label: 'Difficulty', render: 'badge' },
    { key: 'category', label: 'Category', render: 'text' },
    { key: 'min_words', label: 'Min Words', render: 'text' },
    { key: 'max_words', label: 'Max Words', render: 'text' },
    { key: 'prompt_text', label: 'Prompt', render: 'longtext' },
  ];
  loadError = signal('');

  filterDifficulty = signal<'intermediate' | 'expert' | ''>('');

  formOpen = signal(false);
  formMode = signal<'create' | 'edit'>('create');
  editingId = signal<number | null>(null);

  formPromptText = signal('');
  formDifficulty = signal<'intermediate' | 'expert'>('intermediate');
  formMinWords = signal<number>(100);
  formMaxWords = signal<number>(300);
  formCategory = signal('');

  formSubmitting = signal(false);
  formError = signal('');

  csvOpen = signal(false);
  csvFile = signal<File | null>(null);
  csvSubmitting = signal(false);
  csvResult = signal<BulkImportResult | null>(null);
  csvError = signal('');

  ngOnInit(): void { this.loadTopics(); }

  private loadTopics(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.contentSvc.listWritingTopics().subscribe({
      next: (t) => { this.topics.set(t); this.loading.set(false); },
      error: (err: ApiError) => {
        if (err.status === 401) { this.router.navigate(['/login']); return; }
        this.loadError.set(err.message || 'Could not load writing topics.');
        this.loading.set(false);
      },
    });
  }

  filteredTopics = computed(() => {
    const all = this.topics();
    const d = this.filterDifficulty();
    return d ? all.filter(t => t.difficulty === d) : all;
  });

  // ---- Pagination state ----
  currentPage = signal(1);
  readonly pageSize = 10;

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredTopics().length / this.pageSize))
  );

  effectivePage = computed(() =>
    Math.min(Math.max(1, this.currentPage()), this.totalPages())
  );

  pagedTopics = computed(() => {
    const start = (this.effectivePage() - 1) * this.pageSize;
    return this.filteredTopics().slice(start, start + this.pageSize);
  });

  setFilter(d: 'intermediate' | 'expert' | ''): void {
    this.filterDifficulty.set(d);
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

  truncate(text: string, max = 100): string {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  openCreateForm(): void {
    this.formMode.set('create');
    this.editingId.set(null);
    this.formPromptText.set('');
    this.formDifficulty.set('intermediate');
    this.formMinWords.set(100);
    this.formMaxWords.set(300);
    this.formCategory.set('');
    this.formError.set('');
    this.formOpen.set(true);
  }

  openEditForm(t: WritingTopicOut): void {
    this.formMode.set('edit');
    this.editingId.set(t.id);
    this.formPromptText.set(t.prompt_text);
    this.formDifficulty.set(t.difficulty as 'intermediate' | 'expert');
    this.formMinWords.set(t.min_words);
    this.formMaxWords.set(t.max_words);
    this.formCategory.set(t.category ?? '');
    this.formError.set('');
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (this.formSubmitting()) return;
    this.formOpen.set(false);
  }

  private validateForm(): string | null {
    if (!this.formPromptText().trim()) return 'Prompt text is required.';
    const min = this.formMinWords();
    const max = this.formMaxWords();
    if (min < 50) return 'Minimum word count must be at least 50.';
    if (max > 1000) return 'Maximum word count cannot exceed 1000.';
    if (min >= max) return 'Minimum word count must be less than maximum.';
    return null;
  }

  submitForm(): void {
    const err = this.validateForm();
    if (err) { this.formError.set(err); return; }
    this.formError.set('');
    this.formSubmitting.set(true);

    if (this.formMode() === 'create') {
      this.contentSvc.createWritingTopic({
        prompt_text: this.formPromptText().trim(),
        difficulty: this.formDifficulty(),
        min_words: this.formMinWords(),
        max_words: this.formMaxWords(),
        category: this.formCategory().trim() || null,
      }).subscribe({
        next: (created) => {
          this.topics.update(arr => [created, ...arr]);
          this.formSubmitting.set(false);
          this.formOpen.set(false);
        },
        error: (err: ApiError) => {
          this.formSubmitting.set(false);
          this.formError.set(err.message || 'Could not create writing topic.');
        },
      });
    } else {
      const id = this.editingId();
      if (id === null) { this.formSubmitting.set(false); return; }
      this.contentSvc.updateWritingTopic(id, {
        prompt_text: this.formPromptText().trim(),
        difficulty: this.formDifficulty(),
        min_words: this.formMinWords(),
        max_words: this.formMaxWords(),
        category: this.formCategory().trim() || null,
      }).subscribe({
        next: (updated) => {
          this.topics.update(arr => arr.map(t => t.id === updated.id ? updated : t));
          this.formSubmitting.set(false);
          this.formOpen.set(false);
        },
        error: (err: ApiError) => {
          this.formSubmitting.set(false);
          this.formError.set(err.message || 'Could not update writing topic.');
        },
      });
    }
  }
  /** Open the View modal for the given writing topic. */
  onView(t: WritingTopicOut): void {
    this.viewModalData.set(t);
    this.viewModalOpen.set(true);
  }

  /** Close the View modal. Wired to the modal's (closed) emitter. */
  onCloseView(): void {
    this.viewModalOpen.set(false);
    this.viewModalData.set(null);
  }

  /** Toggle a writing topic's disabled state. Updates row in place. */
  onToggleDisabled(t: WritingTopicOut): void {
    this.contentSvc.toggleWritingTopicDisabled(t.id).subscribe({
      next: (updated) => {
        this.topics.update(arr =>
          arr.map(x => (x.id === updated.id ? updated : x))
        );
      },
      error: async (err: ApiError) => {
        await this.modal.alert(
          err.message || 'Could not update topic.',
          { title: 'Toggle failed' }
        );
      },
    });
  }



  //   this.contentSvc.deleteWritingTopic(t.id).subscribe({
  //     next: () => {
  //       this.topics.update(arr => arr.filter(x => x.id !== t.id));
  //     },
  //     error: async (err: ApiError) => {
  //       await this.modal.alert(
  //         err.message || 'Could not delete writing topic.',
  //         { title: err.status === 409 ? 'Cannot delete — topic in use' : 'Delete failed' }
  //       );
  //     },
  //   });
  // }

   async onDelete(p: WritingTopicOut): Promise<void> {
      const confirmed = await this.delmodal.confirm({
        message: 'Delete this writing topic?',
        itemName: p.prompt_text,
        title: 'Confirm Delete',
        okText: 'Delete',
        cancelText: 'Cancel',
        dangerous: true
      });
      
      if (!confirmed) return;
  
      this.contentSvc.deleteWritingTopic(p.id).subscribe({
        next: () => {
          this.topics.update(arr => arr.filter(x => x.id !== p.id));
        },
        error: async (err: ApiError) => {
          await this.modal.alert(err.message || 'Could not delete writing topic.');
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
    if (!file) { this.csvError.set('Choose a CSV file first.'); return; }
    this.csvSubmitting.set(true);
    this.csvError.set('');

    this.contentSvc.bulkImportWritingTopics(file).subscribe({
      next: (result) => {
        this.csvResult.set(result);
        this.csvSubmitting.set(false);
        if (result.created > 0) {
          this.contentSvc.listWritingTopics().subscribe({
            next: (t) => this.topics.set(t),
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

  trackById = (_: number, t: WritingTopicOut) => t.id;
}