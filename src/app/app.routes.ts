import { Routes } from '@angular/router';
import { hrAuthGuard } from './core/guards/hr-auth.guard';
import { adminAuthGuard } from './core/guards/admin-auth.guard';
import { mustChangePasswordGuard } from './core/guards/must-change-password.guard';

/**
 * COMPLETE — all routes wired:
 *   /                                  → /login
 *   /login                             → Login (HR)
 *   /dashboard                         → HrDashboard (HR-guarded)
 *   /dashboard/candidate/:id           → CandidateDetail (HR-guarded)
 *   /dashboard/content                 → ContentHub (HR question authoring landing)
 *   /dashboard/content/questions       → ContentQuestions (Phase 3)
 *   /dashboard/content/passages        → ContentPassages (Phase 4)
 *   /dashboard/content/writing-topics  → ContentWritingTopics (Phase 5)
 *   /dashboard/content/speaking-topics → ContentSpeakingTopics (Phase 6)
 *   /exam/:token                       → ExamEntry (passcode)
 *   /instructions                      → Instructions
 *   /reading                           → Reading
 *   /writing                           → Writing
 *   /speaking                          → Speaking
 *   /submitted                         → Submitted
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login',
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login').then(m => m.Login),
  },
  {
    // Forced-change-password screen. Rendered when AuthService's
    // mustChangePassword signal is true. Only the must-change guard
    // is applied here (no role guard) — both HR and admin land on
    // this same component, and the must-change guard naturally
    // redirects to /login if the flag is false (which would mean
    // either logged-out or already changed).
    path: 'change-password-required',
    loadComponent: () =>
      import('./pages/change-password-required/change-password-required')
        .then(m => m.ChangePasswordRequiredPage),
    canActivate: [mustChangePasswordGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/hr-dashboard/hr-dashboard').then(m => m.HrDashboard),
    canActivate: [hrAuthGuard, mustChangePasswordGuard],
  },
  {
    path: 'dashboard/candidate/:id',
    loadComponent: () =>
      import('./pages/candidate-detail/candidate-detail').then(m => m.CandidateDetail),
    canActivate: [hrAuthGuard, mustChangePasswordGuard],
  },
  {
    path: 'dashboard/content',
    loadComponent: () =>
      import('./pages/content-hub/content-hub').then(m => m.ContentHub),
    canActivate: [hrAuthGuard, mustChangePasswordGuard],
  },
  {
    path: 'dashboard/content/questions',
    loadComponent: () =>
      import('./pages/content-questions/content-questions').then(m => m.ContentQuestions),
    canActivate: [hrAuthGuard, mustChangePasswordGuard],
  },
  {
    path: 'dashboard/content/passages',
    loadComponent: () =>
      import('./pages/content-passages/content-passages').then(m => m.ContentPassages),
    canActivate: [hrAuthGuard, mustChangePasswordGuard],
  },
  {
    path: 'dashboard/content/writing-topics',
    loadComponent: () =>
      import('./pages/content-writing-topics/content-writing-topics').then(m => m.ContentWritingTopics),
    canActivate: [hrAuthGuard, mustChangePasswordGuard],
  },
  {
    path: 'dashboard/content/speaking-topics',
    loadComponent: () =>
      import('./pages/content-speaking-topics/content-speaking-topics').then(m => m.ContentSpeakingTopics),
    canActivate: [hrAuthGuard, mustChangePasswordGuard],
  },
  {
    path: 'admin/dashboard',
    loadComponent: () =>
      import('./pages/admin-dashboard/admin-dashboard').then(m => m.AdminDashboard),
    canActivate: [adminAuthGuard, mustChangePasswordGuard],
  },
  {
    path: 'exam/:token',
    loadComponent: () =>
      import('./pages/exam-entry/exam-entry').then(m => m.ExamEntry),
  },
  {
    path: 'instructions',
    loadComponent: () =>
      import('./pages/instructions/instructions').then(m => m.Instructions),
  },
  {
    path: 'reading',
    loadComponent: () =>
      import('./pages/reading/reading').then(m => m.Reading),
  },
  {
    path: 'writing',
    loadComponent: () =>
      import('./pages/writing/writing').then(m => m.Writing),
  },
  {
    path: 'speaking',
    loadComponent: () =>
      import('./pages/speaking/speaking').then(m => m.Speaking),
  },
  {
    path: 'submitted',
    loadComponent: () =>
      import('./pages/submitted/submitted').then(m => m.Submitted),
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];