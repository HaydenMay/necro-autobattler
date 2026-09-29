import { Routes } from '@angular/router';
import { Battle } from './pages/battle';

// Battle is the home tab. The 3D game itself lives in App (always mounted, paused when hidden); this route only says "show it".
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'battle' },
  { path: 'battle', component: Battle },
  { path: 'campaign', loadComponent: () => import('./pages/campaign').then((m) => m.Campaign) },
  { path: 'souls', loadComponent: () => import('./pages/souls').then((m) => m.Souls) },
  { path: 'shop', loadComponent: () => import('./pages/shop').then((m) => m.Shop) },
  { path: '**', redirectTo: 'battle' },
];
