import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router,RouterModule } from '@angular/router';

import { ApiError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ModalService } from '../../core/services/modal.service';
import {
  HrContentService,
  SpeakingTopicOut,
} from '../../core/services/hr-content.service';
import { Topnav } from '../../shared/components/topnav/topnav';
import { Footer } from '../../shared/components/footer/footer';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';
import { Sidebar } from '../../shared/components/sidebar/sidebar';
import { deleteModalService } from '../../core/services/deletemodal.service';
import { ViewContentModal, ViewField } from '../../shared/components/view-content-modal/view-content-modal.component';
/**
 * Speaking topics management — list, create, edit, delete.
 *
 * Smallest of the 4 entity types:
 *   - Only 3 fields (prompt_text, difficulty, category)
 *   - No CSV import (deliberate — typically only ~8 topics, single form is faster)
 *   - No body, no min/max words, no options array, no passage link
 */
@Component({
  selector: 'app-content-speaking-topics',
  standalone: true,
  imports: [CommonModule, FormsModule, Topnav, Footer, AccountMenu, Sidebar, ViewContentModal, RouterModule],
  templateUrl: './content-speaking-topics.html',
  styleUrl: './content-speaking-topics.css',
})
export class ContentSpeakingTopics implements OnInit {
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

  topics = signal<SpeakingTopicOut[]>([]);
  loading = signal(true);
  // ---- View modal state ----
  viewModalOpen = signal(false);
  viewModalData = signal<SpeakingTopicOut | null>(null);
  viewModalFields: ViewField[] = [
    { key: 'difficulty', label: 'Difficulty', render: 'badge' },
    { key: 'category', label: 'Category', render: 'text' },
    { key: 'prompt_text', label: 'Prompt', render: 'longtext' },
  ];
  loadError = signal('');

  filterDifficulty = signal<'intermediate' | 'expert' | ''>('');

  formOpen = signal(false);
  formMode = signal<'create' | 'edit'>('create');
  editingId = signal<number | null>(null);

  formPromptText = signal('');
  formDifficulty = signal<'intermediate' | 'expert'>('intermediate');
  formCategory = signal('');

  formSubmitting = signal(false);
  formError = signal('');

  ngOnInit(): void { this.loadTopics(); }

  private loadTopics(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.contentSvc.listSpeakingTopics().subscribe({
      next: (t) => { this.topics.set(t); this.loading.set(false); },
      error: (err: ApiError) => {
        if (err.status === 401) { this.router.navigate(['/login']); return; }
        this.loadError.set(err.message || 'Could not load speaking topics.');
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

  truncate(text: string, max = 120): string {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  openCreateForm(): void {
    this.formMode.set('create');
    this.editingId.set(null);
    this.formPromptText.set('');
    this.formDifficulty.set('intermediate');
    this.formCategory.set('');
    this.formError.set('');
    this.formOpen.set(true);
  }

  openEditForm(t: SpeakingTopicOut): void {
    this.viewModalOpen.set(false);

    this.formMode.set('edit');
    this.editingId.set(t.id);
    this.formPromptText.set(t.prompt_text);
    this.formDifficulty.set(t.difficulty as 'intermediate' | 'expert');
    this.formCategory.set(t.category ?? '');
    this.formError.set('');
    this.formOpen.set(true);
  }

  closeForm(): void {
    if (this.formSubmitting()) return;
    this.formOpen.set(false);
  }

  private validateForm(): string | null {
    if (!this.formPromptText().trim()) return 'Text is required.';
    return null;
  }

  submitForm(): void {
    const err = this.validateForm();
    if (err) { this.formError.set(err); return; }
    this.formError.set('');
    this.formSubmitting.set(true);

    if (this.formMode() === 'create') {
      this.contentSvc.createSpeakingTopic({
        prompt_text: this.formPromptText().trim(),
        difficulty: this.formDifficulty(),
        category: this.formCategory().trim() || null,
      }).subscribe({
        next: (created) => {
          this.topics.update(arr => [created, ...arr]);
          this.formSubmitting.set(false);
          this.formOpen.set(false);
        },
        error: (err: ApiError) => {
          this.formSubmitting.set(false);
          this.formError.set(err.message || 'Could not create speaking topic.');
        },
      });
    } else {
      const id = this.editingId();
      if (id === null) { this.formSubmitting.set(false); return; }
      this.contentSvc.updateSpeakingTopic(id, {
        prompt_text: this.formPromptText().trim(),
        difficulty: this.formDifficulty(),
        category: this.formCategory().trim() || null,
      }).subscribe({
        next: (updated) => {
          this.topics.update(arr => arr.map(t => t.id === updated.id ? updated : t));
          this.formSubmitting.set(false);
          this.formOpen.set(false);
        },
        error: (err: ApiError) => {
          this.formSubmitting.set(false);
          this.formError.set(err.message || 'Could not update speaking topic.');
        },
      });
    }
  }
  /** Open the View modal for the given speaking topic. */
  onView(t: SpeakingTopicOut): void {
     this.viewModalOpen.set(false);
    this.formOpen.set(false);
    setTimeout(() => {
    this.viewModalData.set(t);
    this.viewModalOpen.set(true);
     }, 0); 
  }

  /** Close the View modal. Wired to the modal's (closed) emitter. */
  onCloseView(): void {
    this.viewModalOpen.set(false);
    this.viewModalData.set(null);
  }

  /** Toggle a speaking topic's disabled state. Updates row in place. */
  onToggleDisabled(t: SpeakingTopicOut): void {
    this.contentSvc.toggleSpeakingTopicDisabled(t.id).subscribe({
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


  //   this.contentSvc.deleteSpeakingTopic(t.id).subscribe({
  //     next: () => {
  //       this.topics.update(arr => arr.filter(x => x.id !== t.id));
  //     },
  //     error: async (err: ApiError) => {
  //       await this.modal.alert(
  //         err.message || 'Could not delete speaking topic.',
  //         { title: err.status === 409 ? 'Cannot delete — topic in use' : 'Delete failed' }
  //       );
  //     },
  //   });
  // }

   async onDelete(p: SpeakingTopicOut): Promise<void> {
      const confirmed = await this.delmodal.confirm({
        message: 'Delete this question?',
        itemName: p.prompt_text,
        title: 'Confirm Delete',
        okText: 'Delete',
        cancelText: 'Cancel',
        dangerous: true
      });
      
      if (!confirmed) return;
  
      this.contentSvc.deleteQuestion(p.id).subscribe({
        next: () => {
          this.topics.update(arr => arr.filter(x => x.id !== p.id));
        },
        error: async (err: ApiError) => {
          await this.modal.alert(err.message || 'Could not delete question.');
        },
      });
    }

  trackById = (_: number, t: SpeakingTopicOut) => t.id;
}