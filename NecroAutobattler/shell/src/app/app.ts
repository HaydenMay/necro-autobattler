import { Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

declare global { interface Window { __game?: { setActive(on: boolean): void }; } }

const SCRIPTS = ['vendor/babylon.js', 'vendor/babylonjs.loaders.min.js', 'game.js'];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  private router = inject(Router);
  private url = signal(this.router.url);
  readonly onBattle = computed(() => this.url().startsWith('/battle') || this.url() === '/' || this.url() === '');
  private loaded = false;

  constructor() {
    this.router.events.subscribe((e) => { if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects); });
    effect(() => {
      const on = this.onBattle();
      if (on && !this.loaded) { this.loaded = true; this.loadGame(); }
      setTimeout(() => window.__game?.setActive(on), 0);       // after the host box is shown, so the game sees its real size
    });
  }

  /** The game is a separate bundle (docs/game.js) that needs Babylon first. Loaded the first time Battle is opened. */
  private loadGame() {
    SCRIPTS.reduce((p, src) => p.then(() => new Promise<void>((ok, fail) => {
      const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => fail(new Error('could not load ' + src)); document.body.appendChild(s);
    })), Promise.resolve()).catch((e) => { const l = document.getElementById('loading'); if (l) l.textContent = 'Error: ' + e.message; });
  }
}
