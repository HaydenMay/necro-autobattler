import { Component, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GameLink } from '../game-link.service';

/** Empty on purpose: the full-screen run (the 3D game) is mounted once in App so a run survives a trip to Home. */
@Component({ selector: 'app-run', template: '' })
export class Run {}

/** The 3D look at one Soul (Souls page > Inspect): the shared game canvas shows that Soul alone; leaving the page puts the run back as it was. */
@Component({ selector: 'app-inspect', template: '' })
export class Inspect implements OnDestroy {
  private link = inject(GameLink); private timer = 0; private done = false;
  constructor() {
    const soul = inject(ActivatedRoute).snapshot.paramMap.get('soul') as any;
    const go = () => { const g = (window as any).__game; if (this.done) return; if (this.link.ready() && g) { this.done = true; g.inspect(soul); } };
    this.timer = window.setInterval(() => { go(); if (this.done) clearInterval(this.timer); }, 100); go();
  }
  ngOnDestroy() { clearInterval(this.timer); const g = (window as any).__game; if (this.done && g) g.endInspect(); }
}
