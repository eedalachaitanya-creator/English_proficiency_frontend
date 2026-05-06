import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule  } from '@angular/router';
 
@Component({
  selector: 'app-topnav',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './topnav.html',
  styleUrl: './topnav.css',
})
export class Topnav {
  private router = inject(Router);

  /** Brand text on the left side. */
  @Input() title = '';

  /** Meta text on the right side (candidate name, HR email, or status). */
  @Input() meta = '';

  /** '' for the default flat navy bar; 'hr' for the gradient HR variant. */
  @Input() variant: '' | 'hr' = '';

  /** Show the "Logout" link to the right of the meta text. */
  @Input() showLogout = false;

  /** Fired when the Logout link is clicked. Parent handles the actual logout. */
  @Output() logout = new EventEmitter<void>();

  onLogoutClick(event: Event): void {
    // Prevent the <a href="#"> default of jumping to the top of the page.
    event.preventDefault();
    this.logout.emit();
    sessionStorage.clear();

  this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
    this.router.navigate(['/login']);
  });
  }
}