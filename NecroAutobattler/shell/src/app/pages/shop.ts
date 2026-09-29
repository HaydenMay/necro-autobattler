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
    .packs { display:flex; flex-wrap:wrap; gap:clamp(10px,2.4vmin,20px); margin:8px 0 16px; }
    .pk { width:clamp(84px,15vmin,120px); padding:0; background:none; border:0; text-align:center; cursor:pointer; color:inherit; }
    .mp { position:relative; aspect-ratio:3/4.3; border:2px solid var(--edge); border-radius:4px 4px 10px 10px; background:linear-gradient(160deg,var(--a),var(--b)); box-shadow:0 0 16px var(--glow); overflow:hidden;
          display:flex; flex-direction:column; align-items:center; justify-content:space-between; padding:16% 4% 8%; transition:transform .12s; }
    .pk:hover .mp, .pk:active .mp { transform:translateY(-4px) scale(1.03); }
    .mp::before { content:''; position:absolute; top:0; left:0; right:0; height:11%; background:var(--edge); opacity:.5; clip-path:polygon(0 0,100% 0,100% 60%,90% 100%,80% 60%,70% 100%,60% 60%,50% 100%,40% 60%,30% 100%,20% 60%,10% 100%,0 60%); }
    .mp::after { content:''; position:absolute; inset:0; background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.28) 50%,transparent 62%); background-size:280% 100%; animation:sweep 3s linear infinite; }
    @keyframes sweep { from { background-position:150% 0; } to { background-position:-150% 0; } }
    .t1 { --a:#5c5468; --b:#28222f; --edge:#c9c0d4; --glow:rgba(200,190,220,.25); } .t2 { --a:#7a44d6; --b:#2a1257; --edge:#dcbcff; --glow:rgba(160,90,255,.5); } .t3 { --a:#2b1c3a; --b:#0a0610; --edge:#ffcc33; --glow:rgba(255,200,60,.5); }
    .mp .e { font-size:clamp(28px,6vmin,44px); color:var(--edge); text-shadow:0 0 12px var(--edge); line-height:1; } .mp .l { font-size:.7em; font-weight:900; letter-spacing:.16em; color:var(--edge); } .mp .s { color:var(--edge); font-size:1.05em; letter-spacing:.08em; }
    .mp .e img { width:clamp(30px,6.6vmin,46px); filter:drop-shadow(0 0 8px var(--edge)); } .mp .s img { width:1.15em; height:1.15em; margin:0 1px; } .row3 .sk img { width:1.2em; height:1.2em; margin-right:2px; vertical-align:middle; }
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
            <div class="mp" [class.t1]="p.tier === 1" [class.t2]="p.tier === 2" [class.t3]="p.tier === 3"><span class="e"><img [src]="skullIcon" alt=""></span><span class="l">SOUL PACK</span><span class="s">@for (i of range(p.tier); track i) { <img [src]="skullIcon" alt=""> }</span></div>
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
