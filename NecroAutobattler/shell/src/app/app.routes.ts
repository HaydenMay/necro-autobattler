import { Routes } from '@angular/router';
import { Home } from './pages/home';
import { Run } from './pages/run';

// Home is the landing page. The full-screen run lives in App (always mounted, paused when hidden); the /run route only says "show it".
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: Home },
  { path: 'run', component: Run },
  { path: 'souls', loadComponent: () => import('./pages/souls').then((m) => m.Souls) },
  { path: 'shop', loadComponent: () => import('./pages/shop').then((m) => m.Shop) },
  { path: 'settings', loadComponent: () => import('./pages/settings').then((m) => m.Settings) },
  { path: '**', redirectTo: 'home' },
];
