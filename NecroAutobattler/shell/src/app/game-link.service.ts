import { Injectable, signal } from '@angular/core';

/** The shell's view of the 3D game bundle (docs/game.js), which loads in the background as soon as the app starts. */
@Injectable({ providedIn: 'root' })
export class GameLink {
  readonly ready = signal(!!(window as any).__gameReady);
  constructor() { window.addEventListener('necro-game-ready', () => this.ready.set(true)); }
  private get game(): any { return (window as any).__game; }
  /** The run in progress (wave, hearts) or null when there is nothing to continue. */
  runInfo(): { wave: number; total: number; hearts: number; difficulty: string; stage: string } | null { return this.ready() && this.game ? this.game.runInfo() : null; }
  newRun() { if (this.ready() && this.game) this.game.newRun(); }
  abandonRun() { if (this.ready() && this.game) this.game.abandonRun(); }
  newDaily() { if (this.ready() && this.game) this.game.newDaily(); }
  newEndless() { if (this.ready() && this.game) this.game.newEndless(); }
}
