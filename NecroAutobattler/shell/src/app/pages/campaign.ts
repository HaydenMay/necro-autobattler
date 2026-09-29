import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { enemyWave, previewText } from '../../../../core/waves.ts';
import { SOUL_NAME } from '../../../../core/balance.ts';
import { PROTOTYPE_RULES } from '../../../../core/prototype.ts';
import type { SoulId } from '../../../../core/data.ts';

@Component({
  selector: 'app-campaign',
  
  template: `
    <h1>Campaign</h1>
    <p class="lead">Clear a stage's waves to open the next one. Only Stage 1 is playable so far.</p>
    <div class="box" style="max-width:520px">
      <div class="row2"><b style="font-size:16px">Stage 1 &mdash; The Restless Crypt</b><span class="tag">{{ waves.length }} waves (prototype)</span></div>
      <div style="margin:8px 0">
        @for (w of waves; track w.n) {
          <div style="font-size:12px;margin:3px 0"><b>Wave {{ w.n }}</b> <span class="muted">{{ w.text }}</span></div>
        }
      </div>
      <a class="btn" (click)="play()">Play</a><div class="muted" style="font-size:11px;margin-top:6px">Starts a fresh run with your equipped Soul Deck. The Battle tab resumes the run you already have.</div>
    </div>
    <div class="grid" style="margin-top:12px;max-width:720px">
      @for (n of [2, 3, 4]; track n) {
        <div class="box muted"><b>Stage {{ n }}</b> <span class="tag soon">locked</span><div style="font-size:11.5px;margin-top:4px">Later stages, bosses and first-clear Soul Packs go here.</div></div>
      }
    </div>`,
})
export class Campaign {
  private router = inject(Router);
  play() { (window as any).__game?.newRun(); this.router.navigateByUrl('/battle'); }
  waves = Array.from({ length: PROTOTYPE_RULES.stageWaves ?? 3 }, (_, i) => ({
    n: i + 1,
    text: previewText(enemyWave(i + 1, 1)).map((p) => `${SOUL_NAME[p.soul as SoulId]} ×${p.count}`).join(', '),
  }));
}
