import { Component, OnInit, inject, signal, computed, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
 
import { Router, RouterModule  } from '@angular/router';

import { ApiError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ModalService } from '../../core/services/modal.service';
import {
  HrContentService,
  PassageOut,
  BulkImportResult,
} from '../../core/services/hr-content.service';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';
import { Sidebar } from '../../shared/components/sidebar/sidebar';
import { deleteModalService } from '../../core/services/deletemodal.service';
import { ViewContentModal, ViewField } from '../../shared/components/view-content-modal/view-content-modal.component';
import { downloadCsvTemplate, stripSampleRows } from '../../core/utils/csv-template';

/**
 * Reading passages management — list, create, edit, delete, bulk-import.
 * Same UX pattern as content-questions but simpler (no options array,
 * no correct_answer, no conditional fields).
 */
@Component({
  selector: 'app-content-passages',
  standalone: true,
  imports: [CommonModule, FormsModule, Topnav, Footer, AccountMenu, Sidebar, ViewContentModal, RouterModule],
  templateUrl: './content-passages.html',
  styleUrl: './content-passages.css',
})
export class ContentPassages implements OnInit {
  constructor(private delmodal: deleteModalService,  private renderer: Renderer2) {}

  private contentSvc = inject(HrContentService);
  private modal = inject(ModalService);
  private router = inject(Router);
  private auth = inject(AuthService);

  hrEmail = computed(() => this.auth.currentUser()?.email ?? 'Loading…');
  hrName = computed(() => this.auth.currentUser()?.name ?? '');
  onLogout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }

  passages = signal<PassageOut[]>([]);
  loading = signal(true);
  loadError = signal('');

  filterDifficulty = signal<'intermediate' | 'expert' | ''>('');

  formOpen = signal(false);
  formMode = signal<'create' | 'edit'>('create');
  editingId = signal<number | null>(null);

  formTitle = signal('');
  formBody = signal('');
  formDifficulty = signal<'intermediate' | 'expert'>('intermediate');
  formTopic = signal('');

  formSubmitting = signal(false);
  formError = signal('');

  csvOpen = signal(false);
  csvFile = signal<File | null>(null);
  csvSubmitting = signal(false);
  csvResult = signal<BulkImportResult | null>(null);
  csvError = signal('');

  // ---- View modal state ----
  // Read-only modal for viewing the full passage. Driven by ViewContentModal
  // component in the template; closed via (closed) emitter -> onCloseView().
  viewModalOpen = signal(false);
  viewModalData = signal<PassageOut | null>(null);
  viewModalFields: ViewField[] = [
    { key: 'title', label: 'Title', render: 'text' },
    { key: 'difficulty', label: 'Difficulty', render: 'badge' },
    { key: 'topic', label: 'Topic', render: 'text' },
    { key: 'word_count', label: 'Word Count', render: 'text' },
    { key: 'body', label: 'Body', render: 'longtext' },
  ];

  // Live word count for body — gives HR feedback that they're hitting the
  // 50-word minimum BEFORE they submit and get a server-side error.
  bodyWordCount = computed(() => {
    const text = this.formBody().trim();
    return text ? text.split(/\s+/).length : 0;
  });

  ngOnInit(): void {
    this.loadPassages();
  }

  private loadPassages(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.contentSvc.listPassages().subscribe({
      next: (p) => {
        this.passages.set(p);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        if (err.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
        this.loadError.set(err.message || 'Could not load passages.');
        this.loading.set(false);
      },
    });
  }

  filteredPassages = computed(() => {
    const all = this.passages();
    const d = this.filterDifficulty();
    return d ? all.filter(p => p.difficulty === d) : all;
  });

  // ---- Pagination state ----
  /** 1-indexed current page. Renders clamp via effectivePage so the
   * signal can drift past totalPages without breaking the UI. */
  currentPage = signal(1);
  readonly pageSize = 10;

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredPassages().length / this.pageSize))
  );

  effectivePage = computed(() =>
    Math.min(Math.max(1, this.currentPage()), this.totalPages())
  );

  pagedPassages = computed(() => {
    const start = (this.effectivePage() - 1) * this.pageSize;
    return this.filteredPassages().slice(start, start + this.pageSize);
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

  truncate(text: string, max = 120): string {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  openCreateForm(): void {
    this.formMode.set('create');
    this.editingId.set(null);
    this.formTitle.set('');
    this.formBody.set('');
    this.formDifficulty.set('intermediate');
    this.formTopic.set('');
    this.formError.set('');
    this.formOpen.set(true);
  }

  openEditForm(p: PassageOut): void {
     this.renderer.addClass(document.body, 'invite-open');
     this.viewModalOpen.set(false);

    this.formMode.set('edit');
    this.editingId.set(p.id);
    this.formTitle.set(p.title);
    this.formBody.set(p.body);
    this.formDifficulty.set(p.difficulty as 'intermediate' | 'expert');
    this.formTopic.set(p.topic ?? '');
    this.formError.set('');
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (this.formSubmitting()) return;
    this.formOpen.set(false);
  }

  private validateForm(): string | null {
    if (!this.formTitle().trim()) return 'Title is required.';
    if (this.bodyWordCount() < 50) {
      return `Body must be at least 50 words. Current count: ${this.bodyWordCount()}.`;
    }
    return null;
  }

  submitForm(): void {
    const err = this.validateForm();
    if (err) { this.formError.set(err); return; }
    this.formError.set('');
    this.formSubmitting.set(true);

    if (this.formMode() === 'create') {
      this.contentSvc.createPassage({
        title: this.formTitle().trim(),
        body: this.formBody(),
        difficulty: this.formDifficulty(),
        topic: this.formTopic().trim() || null,
      }).subscribe({
        next: (created) => {
          this.passages.update(arr => [created, ...arr]);
          this.formSubmitting.set(false);
          this.formOpen.set(false);
        },
        error: (err: ApiError) => {
          this.formSubmitting.set(false);
          this.formError.set(err.message || 'Could not create passage.');
        },
      });
    } else {
      const id = this.editingId();
      if (id === null) { this.formSubmitting.set(false); return; }
      this.contentSvc.updatePassage(id, {
        title: this.formTitle().trim(),
        body: this.formBody(),
        difficulty: this.formDifficulty(),
        topic: this.formTopic().trim() || null,
      }).subscribe({
        next: (updated) => {
          this.passages.update(arr => arr.map(p => p.id === updated.id ? updated : p));
          this.formSubmitting.set(false);
          this.formOpen.set(false);
        },
        error: (err: ApiError) => {
          this.formSubmitting.set(false);
          this.formError.set(err.message || 'Could not update passage.');
        },
      });
    }
  }

  async onDelete(p: PassageOut): Promise<void> {
    // Soft delete on the backend — sets deleted_at instead of removing the
    // row. Existing invitations referencing this passage continue to work
    // because they snapshot assigned IDs at creation time.
    const confirmed = await this.delmodal.confirm({
      message: 'Delete this passage?',
      itemName: p.title,
      title: 'Confirm Delete',
      okText: 'Delete',
      cancelText: 'Cancel',
      dangerous: true
    });
    if (!confirmed) return;

    this.contentSvc.deletePassage(p.id).subscribe({
      next: () => {
        this.passages.update(arr => arr.filter(x => x.id !== p.id));
      },
      error: async (err: ApiError) => {
        await this.modal.alert(
          err.message || 'Could not delete passage.',
          { title: 'Delete failed' }
        );
      },
    });
  }

  /** Open the View modal for the given passage. */
  onView(p: PassageOut): void {
    this.viewModalOpen.set(false);
     this.formOpen.set(false);
     
   setTimeout(() => {
    this.viewModalData.set(p);
    this.viewModalOpen.set(true);
  }, 0);
  }

  /** Close the View modal. Wired to ViewContentModal's (closed) emitter. */
  onCloseView(): void {
    this.renderer.removeClass(document.body, 'invite-open');
    this.viewModalOpen.set(false);
    this.viewModalData.set(null);
  }

  /**
   * Toggle a passage's disabled state. Updates the row in place when the
   * server confirms, no full list reload. Disabled passages stay visible
   * to HR (with a badge) but are skipped when assigning new invitations.
   */
  onToggleDisabled(p: PassageOut): void {
    this.contentSvc.togglePassageDisabled(p.id).subscribe({
      next: (updated) => {
        this.passages.update(arr =>
          arr.map(x => (x.id === updated.id ? updated : x))
        );
      },
      error: async (err: ApiError) => {
        await this.modal.alert(
          err.message || 'Could not update passage.',
          { title: 'Toggle failed' }
        );
      },
    });
  }

  openCsvModal(): void {
    this.csvFile.set(null);
    this.csvResult.set(null);
    this.csvError.set('');
    this.csvOpen.set(true);
  }

  downloadTemplate(): void {
    downloadCsvTemplate(
      ['title', 'body', 'difficulty', 'topic'],
      'reading-passages-template.csv',
      [
        'The Rise of Remote Work',
        'Remote work has transformed how companies operate in the modern era. ' +
        'Many organizations now allow employees to work from home or other ' +
        'flexible locations, which has reshaped office culture, hiring ' +
        'practices, and team communication. While the shift offers benefits ' +
        'like reduced commuting time and access to a wider talent pool, it ' +
        'has also introduced challenges around collaboration and management.',
        'intermediate',
        'workplace',
      ],
    );
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

  async submitCsv(): Promise<void> {
    const file = this.csvFile();
    if (!file) { this.csvError.set('Choose a CSV file first.'); return; }
    this.csvSubmitting.set(true);
    this.csvError.set('');

    // Strip the canned [SAMPLE] rows from the downloaded template before
    // upload so they never reach the database, regardless of whether HR
    // remembered to delete them.
    const { file: cleanedFile } = await stripSampleRows(file);

    this.contentSvc.bulkImportPassages(cleanedFile).subscribe({
      next: (result) => {
        this.csvResult.set(result);
        this.csvSubmitting.set(false);
        if (result.created > 0) {
          this.contentSvc.listPassages().subscribe({
            next: (p) => this.passages.set(p),
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

  trackById = (_: number, p: PassageOut) => p.id;
}