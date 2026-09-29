import { Component, computed, inject, signal } from '@angular/core';
import { REWARDS } from '../../../../core/progress.ts';
import { DIFFICULTY_INFO } from '../../../../core/waves.ts';
import type { Difficulty } from '../../../../core/save.ts';
import { SaveService } from '../save.service';
import { PackOpen } from '../pack-open';
import type { OpenData } from '../pack-open';
import { range, skullIcon } from '../soul-ui';

@Component({
  selector: 'app-shop',
  imports: [PackOpen],
  styles: [`
    :host { display:block; font-size:clamp(11px,1.9vmin,14px); }
    .packs { display:flex; flex-wrap:wrap; gap:clamp(14px,3vmin,28px); margin:8px 0 16px; }
    .pk { position:relative; width:clamp(104px,19vmin,160px); padding:0 0 10px; padding:0; background:none; border:0; text-align:center; cursor:pointer; color:inherit; }
    .mp { display:block; width:100%; transition:transform .12s, filter .2s; filter:drop-shadow(0 6px 8px #000a) drop-shadow(0 0 10px var(--glow)); }
    .pk:hover .mp, .pk:active .mp { transform:translateY(-4px) scale(1.04); }
    .t1 { --glow:rgba(47,217,166,.25); } .t2 { --glow:rgba(47,217,166,.5); } .t3 { --glow:rgba(255,204,51,.6); }
    .row3 .sk img { width:1.2em; height:1.2em; margin-right:2px; vertical-align:middle; }
    .pk::before { content:''; position:absolute; left:-8%; right:-8%; bottom:14px; height:28%; border-radius:50%; background:radial-gradient(ellipse at 50% 50%, var(--glow), transparent 70%); pointer-events:none; }
    .pk .mp { position:relative; }
    .src { font-size:.85em; opacity:.75; margin-top:5px; }
    .badge2 { display:inline-block; min-width:1.6em; padding:0 .4em; border-radius:1em; background:#e03a5a; color:#fff; font-weight:800; font-size:.85em; text-align:center; margin-left:6px; }
    .row3 { display:flex; align-items:center; gap:10px; padding:5px 0; border-top:1px solid #35244f; } .row3:first-of-type { border-top:0; } .row3 .sk { min-width:4.2em; color:#dcbcff; letter-spacing:.06em; }
    .meter { display:inline-block; width:110px; height:10px; border-radius:6px; background:#0e0918; border:1px solid #4a3470; vertical-align:middle; overflow:hidden; } .meter i { display:block; height:100%; background:var(--go); }
  `],
  template: `
    <h1>Shop</h1>
    <p class="lead">Soul Packs give permanent copies of Souls. Copies fill a Soul's level bar, and a Soul at its threshold can be upgraded on the Souls page. Packs come from clearing stages.</p>
    <b>Your Soul Packs</b> @if (save.packs().length) { <span class="badge2">{{ save.packs().length }}</span> }
    @if (save.packs().length) {
      <div class="packs">
        @for (p of save.packs(); track p.id) {
          <button class="pk" (click)="open(p.id)">
            <img class="mp" [class.t1]="p.tier === 1" [class.t2]="p.tier === 2" [class.t3]="p.tier === 3" [src]="'assets/packs/pack_' + p.tier + '.png'" alt="Soul Pack" draggable="false">
            <div class="src">{{ p.source }}</div>
          </button>
        }
      </div>
    } @else {
      <div class="box" style="max-width:460px;margin:8px 0 16px"><b>No packs waiting.</b><div class="lead" style="margin:4px 0 0">Clear a stage to earn one. Your first clear on each difficulty gives a better pack.</div></div>
    }

    <div class="box" style="max-width:520px">
      <b>How packs are earned</b> <span class="tag soon">placeholder numbers</span>
      <div style="margin-top:6px">
        @for (d of diffs; track d.id) { <div class="row3"><span style="flex:1">First clear on {{ d.label }}</span><span class="sk">@for (i of range(firstTier(d.id)); track i) { <img [src]="skullIcon" alt=""> }</span></div> }
        <div class="row3"><span style="flex:1">Replay clears: a pack every {{ replayNeeded }} clears</span><span class="sk">@for (i of range(replayTier); track i) { <img [src]="skullIcon" alt=""> }</span></div>
        <div class="row3"><span style="flex:1">Progress to the next replay pack</span><span class="meter"><i [style.width.%]="(100 * save.replayMeter()) / replayNeeded"></i></span> <span>{{ save.replayMeter() }}/{{ replayNeeded }}</span></div>
      </div>
      <div class="lead" style="margin:8px 0 0">A pack can also jump up a tier while it is being opened.</div>
    </div>

    @if (opening(); as o) { <app-pack-open [data]="o" (closed)="opening.set(null)" /> }`,
})
export class Shop {
  save = inject(SaveService);
  opening = signal<OpenData | null>(null);
  diffs = DIFFICULTY_INFO;
  replayNeeded = REWARDS.replayClearsPerPack;
  replayTier = REWARDS.replayTier;
  skullIcon = skullIcon; range = range;
  firstTier = (d: string) => REWARDS.firstClearTier[d as Difficulty];
  open(id: number) { const r = this.save.openPack(id); if (r) this.opening.set(r); }
}
