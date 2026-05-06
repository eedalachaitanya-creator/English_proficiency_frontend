// delete-confirm-modal.component.ts
import { Component, EventEmitter, Output, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-delete-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOpen()) {
      <div class="modal-backdrop show" (click)="close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header" [class.danger]="dangerous">
            <h2>{{ title || 'Confirm Delete' }}</h2>
            <button class="close-btn" (click)="close()" aria-label="Close">
              ✕
            </button>
          </div>

          <div class="modal-body">
            <p class="confirm-message">{{ message }}</p>
            @if (itemName) {
              <div class="item-name">"{{ itemName }}"</div>
            }
            <p class="warning-text" *ngIf="dangerous">
              ⚠️ This action cannot be undone.
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="close()">
              {{ cancelText || 'Cancel' }}
            </button>
            <button class="btn btn-danger" (click)="confirm()">
              {{ okText || 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal {
      padding: 0 !important;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      background: #13315c;
      border-bottom: 1px solid #13315c;
       color: #fff !important;
    }

    .modal-header.danger {
      background: #13315c;
      border-bottom-color: #13315c
       color: #fff !important;
    }

    .modal-header h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: #fff;
    }

    .modal-header.danger h2 {
      color: #fff;
    }

    .close-btn {
      background: none;
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 18px;
      color: #fff;
      transition: all 0.2s ease;
    }

    .close-btn:hover {
      background: rgba(0, 0, 0, 0.05);
      color: #fff;
    }

    .modal-body {
      padding: 24px;
    }

    .confirm-message {
      font-size: 14px;
      color: #374151;
      margin: 0 0 12px 0;
      line-height: 1.5;
    }

    .item-name {
      background: #f3f4f6;
      padding: 12px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 14px;
      color: #1f2937;
      margin: 12px 0;
      word-break: break-word;
    }

    .warning-text {
      color: #dc2626;
      font-size: 13px;
      margin: 16px 0 0 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding: 16px 24px 24px 24px;
      border-top: 1px solid #e5e7eb;
    }

    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      font-size: 14px;
      transition: all 0.2s ease;
    }

    .btn-secondary {
      background: #f3f4f6;
      color: #374151;
    }

    .btn-secondary:hover {
      background: #e5e7eb;
    }

    .btn-danger {
      background: #dc2626;
      color: white;
    }

    .btn-danger:hover {
      background: #b91c1c;
    }
  `]
})
export class DeleteConfirmModal {
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  isOpenSignal = false;
  message = '';
  itemName = '';
  title = '';
  okText = 'Delete';
  cancelText = 'Cancel';
  dangerous = true;

  isOpen() {
    return this.isOpenSignal;
  }

  open(options: {
    message: string;
    itemName?: string;
    title?: string;
    okText?: string;
    cancelText?: string;
    dangerous?: boolean;
  }): Promise<boolean> {
    this.message = options.message;
    this.itemName = options.itemName || '';
    this.title = options.title || 'Confirm Delete';
    this.okText = options.okText || 'Delete';
    this.cancelText = options.cancelText || 'Cancel';
    this.dangerous = options.dangerous !== false;
    this.isOpenSignal = true;

    return new Promise((resolve) => {
      const subscription = this.confirmed.subscribe(() => {
        resolve(true);
        subscription.unsubscribe();
        this.isOpenSignal = false;
      });
      
      const cancelSub = this.cancelled.subscribe(() => {
        resolve(false);
        cancelSub.unsubscribe();
        this.isOpenSignal = false;
      });
    });
  }

  close() {
    this.cancelled.emit();
  }

  confirm() {
    this.confirmed.emit();
  }
}