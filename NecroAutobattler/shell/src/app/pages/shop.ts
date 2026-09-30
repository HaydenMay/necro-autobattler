import { Component, computed, inject, signal } from '@angular/core';
import { REWARDS } from '../../../../core/progress.ts';
import { DIFFICULTY_INFO } from '../../../../core/waves.ts';
import type { Difficulty } from '../../../../core/save.ts';
import { SaveService } from '../save.service';
import { PackOpen } from '../pack-open';
import type { OpenData } from '../pack-open';
import { fmt, goldIcon, range, skullIcon } from '../soul-ui';

@Component({
  selector: 'app-shop',
  imports: [PackOpen],
  styles: [`
    :host { display:block; font-size:clamp(11px,1.9vmin,14px); --ph:clamp(90px,calc(100vh - 292px),250px); }
    .cols { display:block; } .col { min-width:0; }
    .acc { display:flex; align-items:center; gap:10px; width:100%; max-width:560px; margin-top:6px; padding:.55em .9em; text-align:left; border-radius:12px; background:rgba(28,20,44,.9); border:2px solid #4a2f74; color:#fff; font-weight:800; font-size:1.02em; }
    .acc .sp { flex:1; } .chev { width:.55em; height:.55em; border-right:3px solid #cbb8f5; border-bottom:3px solid #cbb8f5; transform:rotate(45deg) translate(-2px,-2px); transition:transform .15s; } .chev.open { transform:rotate(225deg) translate(-2px,-2px); }
    .accbody { max-width:560px; margin-top:6px; }
    .shelf { display:block; width:min(100%,calc(var(--ph) * 1.8)); margin:calc(var(--ph) * -.2) auto 0; pointer-events:none; position:relative; z-index:0; } .packs { position:relative; z-index:1; justify-content:center; }
    .packs { display:flex; flex-wrap:wrap; gap:clamp(14px,3vmin,28px); margin:8px 0 16px; }
    .pk { position:relative; width:calc(var(--ph) * .47); padding:0 0 6px; padding:0; background:none; border:0; text-align:center; cursor:pointer; color:inherit; }
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
    <h1>Shop <span class="goldpill" style="font-size:.5em;vertical-align:middle;margin-left:8px" title="Gold: spent with copies to level up a Soul"><img [src]="goldIcon" alt="">{{ fmt(save.gold()) }}</span></h1>
    <p class="lead">Packs give permanent copies. Fill a Soul's level bar, then upgrade it on the Souls page.</p>
    <div class="cols"><div class="col">
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
      <img class="shelf" src="assets/packs/altar.png" alt="" draggable="false">
    } @else {
      <div class="box" style="max-width:460px;margin:8px 0 16px"><b>No packs waiting.</b><div class="lead" style="margin:4px 0 0">Clear a stage to earn one. Your first clear on each difficulty gives a better pack.</div></div>
    }

    <button class="acc" (click)="toggleInfo()" [attr.aria-expanded]="info()">How packs are earned <span class="tag soon">placeholder numbers</span><span class="sp"></span><span class="chev" [class.open]="info()"></span></button>
    @if (info()) {
    <div class="box accbody">
      <div>
        @for (d of diffs; track d.id) { <div class="row3"><span style="flex:1">First clear on {{ d.label }}</span><span class="sk">@for (i of range(firstTier(d.id)); track i) { <img [src]="skullIcon" alt=""> }</span></div> }
        <div class="row3"><span style="flex:1">Replay clears: a pack every clear</span><span class="sk">@for (d of diffs; track d.id) { <span>{{ d.label }}</span> @for (i of range(replayTierOf(d.id)); track i) { <img [src]="skullIcon" alt=""> } }</span></div>
      </div>
      <div class="lead" style="margin:8px 0 0">A pack can also jump up a tier while it is being opened.</div>
    </div>
    }
    </div></div>
    @if (opening(); as o) { <app-pack-open [data]="o" (closed)="opening.set(null)" /> }`,
})
export class Shop {
  save = inject(SaveService);
  opening = signal<OpenData | null>(null);
  toggleInfo() { this.info.set(!this.info()); if (this.info()) setTimeout(() => document.querySelector('.accbody')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60); }
  info = signal(false);                       // the "how packs are earned" section starts folded away
  diffs = DIFFICULTY_INFO;
  replayNeeded = REWARDS.replayClearsPerPack;
  replayTier = REWARDS.replayTier;
  replayTierOf = (id: string): number => (REWARDS.replayTier as Record<string, number>)[id] ?? 1;
  skullIcon = skullIcon; goldIcon = goldIcon; fmt = fmt; range = range;
  firstTier = (d: string) => REWARDS.firstClearTier[d as Difficulty];
  open(id: number) { const r = this.save.openPack(id); if (r) this.opening.set(r); }
}
