import { Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationError, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
  readonly onRun = computed(() => this.url().startsWith('/run') || this.url().startsWith('/inspect'));
  /** Home gets the full backdrop; every other page a calmer one. */
  readonly onHome = computed(() => this.url().startsWith('/home'));

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects);
      // A page opened before an update asks for a part of the app (a chunk file) that the new version renamed: it is gone, so the link seems dead.
      // Reload once to pick up the current version (at most once a minute, so a real outage cannot loop).
      if (e instanceof NavigationError && /dynamically imported module|Loading chunk|Importing a module script failed/i.test(String(e.error?.message ?? e.error))) {
        try { const last = +(sessionStorage.getItem('necro-chunk-reload') || 0); if (Date.now() - last < 60000) return; sessionStorage.setItem('necro-chunk-reload', String(Date.now())); } catch { /* storage blocked: reload anyway */ }
        location.reload();
      }
    });
    // A Home Screen app stays suspended for days and never re-reads the site by itself: ask the server which version is current when it starts and whenever it comes back.
    this.checkForUpdate(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.checkForUpdate(); });
    // The game loads in the background as soon as the app starts, so Start Battle is instant.
    this.loadGame();
    effect(() => {
      const on = this.onRun(); this.link.ready();
      setTimeout(() => window.__game?.setActive(on), 0);        // after the host box is shown, so the game sees its real size; paused off-screen
    });
    window.addEventListener('necro-go-home', () => this.router.navigateByUrl('/home'));
    window.addEventListener('necro-go-souls', () => this.router.navigateByUrl('/souls'));
    window.addEventListener('necro-go-shop', () => this.router.navigateByUrl('/shop'));   // the stage-cleared screen's Open pack button
  }

  /** This build's stamp is in the URL of its own main.js (?v=...); version.json holds the newest one. A mismatch means we are out of date: reload through a fresh URL, at most once a minute. */
  private checkForUpdate() {
    const mine = new RegExp('main\\.js\\?v=(\\d+)').exec([...document.scripts].map((x) => x.src).find((u) => u.includes('main.js')) ?? '')?.[1]; if (!mine) return;      // a local build has no stamp
    fetch('version.json?_=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j || !j.v || String(j.v) === mine) return;
      try { const last = +(localStorage.getItem('necro-update-reload') || 0); if (Date.now() - last < 60000) return; localStorage.setItem('necro-update-reload', String(Date.now())); } catch { /* storage blocked */ }
      location.replace(location.pathname + '?u=' + j.v + location.hash);
    }).catch(() => { /* offline: keep playing */ });
  }

  /** The game is a separate bundle (docs/game.js) that needs Babylon first. */
  private loadGame() {
    SCRIPTS.reduce((p, src) => p.then(() => new Promise<void>((ok, fail) => {
      const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => fail(new Error('could not load ' + src)); document.body.appendChild(s);
    })), Promise.resolve()).catch((e) => { const l = document.getElementById('loading'); if (l) l.textContent = 'Error: ' + e.message; });
  }
}
