import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeleteConfirmModal } from './delete-confirm-modal';

describe('DeleteConfirmModal', () => {
  let component: DeleteConfirmModal;
  let fixture: ComponentFixture<DeleteConfirmModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeleteConfirmModal]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DeleteConfirmModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
