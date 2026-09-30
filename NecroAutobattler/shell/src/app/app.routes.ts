import { Routes } from '@angular/router';
import { Home } from './pages/home';
import { Inspect, Run } from './pages/run';
import { Settings } from './pages/settings';
import { Shop } from './pages/shop';
import { Souls } from './pages/souls';

// Every page is bundled into main.js on purpose: separately-named chunk files vanish on each deploy, and a phone holding an older main.js then cannot open them.
// Home is the landing page. The full-screen run lives in App (always mounted, paused when hidden); the /run route only says "show it".
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: Home },
  { path: 'run', component: Run },
  { path: 'inspect/:soul', component: Inspect },
  { path: 'souls', component: Souls },
  { path: 'shop', component: Shop },
  { path: 'settings', component: Settings },
  { path: '**', redirectTo: 'home' },
];
