import { Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Backdrop } from './backdrop';
import { GameLink } from './game-link.service';
import { SaveService } from './save.service';
import { TutorialOverlay } from './tutorial';

declare global { interface Window { __game?: { setActive(on: boolean): void }; } }

const SCRIPTS = ['vendor/babylon.js', 'vendor/babylonjs.loaders.min.js', 'game.js'];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Backdrop, TutorialOverlay],
  templateUrl: './app.html',
})
export class App {
  private router = inject(Router);
  private link = inject(GameLink);
  save = inject(SaveService);
  private url = signal(this.router.url);
  /** True while the full-screen run (the 3D game) is showing: no rail, no page. */
  readonly onRun = computed(() => this.url().startsWith('/run'));
  /** Home gets the full backdrop; every other page a calmer one. */
  readonly onHome = computed(() => this.url().startsWith('/home'));

  constructor() {
    this.router.events.subscribe((e) => { if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects); });
    // The game loads in the background as soon as the app starts, so Start Battle is instant.
    this.loadGame();
    effect(() => {
      const on = this.onRun(); this.link.ready();
      setTimeout(() => window.__game?.setActive(on), 0);        // after the host box is shown, so the game sees its real size; paused off-screen
    });
    window.addEventListener('necro-go-home', () => this.router.navigateByUrl('/home'));
    window.addEventListener('necro-go-shop', () => this.router.navigateByUrl('/shop'));   // the stage-cleared screen's Open pack button
  }

  /** The game is a separate bundle (docs/game.js) that needs Babylon first. */
  private loadGame() {
    SCRIPTS.reduce((p, src) => p.then(() => new Promise<void>((ok, fail) => {
      const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => fail(new Error('could not load ' + src)); document.body.appendChild(s);
    })), Promise.resolve()).catch((e) => { const l = document.getElementById('loading'); if (l) l.textContent = 'Error: ' + e.message; });
  }
}
