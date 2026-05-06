// modal.service.ts
import { Injectable, ApplicationRef, createComponent, EnvironmentInjector } from '@angular/core';
import { DeleteConfirmModal } from '../../shared/components/delete-confirm-modal/delete-confirm-modal';

@Injectable({ providedIn: 'root' })
export class deleteModalService {
  constructor(
    private appRef: ApplicationRef,
    private injector: EnvironmentInjector
  ) {}

  async confirm(options: {
    message: string;
    itemName?: string;
    title?: string;
    okText?: string;
    cancelText?: string;
    dangerous?: boolean;
  }): Promise<boolean> {
    // Create component dynamically
    const componentRef = createComponent(DeleteConfirmModal, {
      environmentInjector: this.injector,
    });

    // Add to DOM
    document.body.appendChild(componentRef.location.nativeElement);
    this.appRef.attachView(componentRef.hostView);

    const result = await componentRef.instance.open(options);
    
    // Cleanup
    componentRef.destroy();
    this.appRef.detachView(componentRef.hostView);
    
    return result;
  }
}