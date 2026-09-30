import { Component, computed, inject, signal } from '@angular/core';
import { SOULS, COST } from '../../../../core/data.ts';
import type { SoulId } from '../../../../core/data.ts';
import { BALANCE, ROLE_TEXT, SOUL_NAME, abilityInfo } from '../../../../core/balance.ts';
import { canAfford, copiesNeeded, goldNeeded, isMaxLevel } from '../../../../core/progress.ts';
import { RARITIES, RARITY_NAME, RARITY_OF } from '../../../../core/packs.ts';
import { SaveService } from '../save.service';
import { artBg, checkIcon, closeIcon, fmt, gemIcon, goldIcon, hasArt, rarityColor, soulArt, upgradeIcon } from '../soul-ui';

const BG: Record<SoulId, string> = {
  warrior: 'linear-gradient(#6b4a8f,#2c1b45)', archer: 'linear-gradient(#5a4a9a,#251a4a)', goblin: 'linear-gradient(#4f7a3a,#1d2d17)',
  knight: 'linear-gradient(#3f6aa8,#15243f)', ogre: 'linear-gradient(#8a6a3a,#33230f)', barbarian: 'linear-gradient(#a8483a,#3a1512)',
};
type Filter = 'all' | 'skill' | 'passive';

@Component({
  selector: 'app-souls',
  host: { '(click)': 'pop.set(null)' },
  styles: [`
    :host { display:block; --gap:clamp(6px,1.4vmin,14px); font-size:clamp(10px,1.6vmin,12.5px); }
    .top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:var(--gap); } .top h1 { margin:0; }
    .strip { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:var(--gap); padding:calc(var(--gap) + 4px) var(--gap) var(--gap); }
    .slot { aspect-ratio:4/5; border-radius:10px; border:2px dashed #4a3470; background:#1a1128; color:#6b5a8a; font-size:clamp(18px,4vmin,28px); display:flex; align-items:center; justify-content:center; padding:0; }
    .small { padding:.35em .9em; font-size:.95em; }
    .meta { font-size:.9em; opacity:.85; } .meta b { color:#fff; }
    .filters { display:flex; gap:4px; margin:var(--gap) 0 calc(var(--gap) + 12px); flex-wrap:wrap; } .chip { padding:.22em .58em; border-radius:14px; font-size:.82em; white-space:nowrap; } .chip.on { background:#3a2260; border-color:#a45bff; }
    .cols { display:grid; grid-template-columns:auto minmax(0,1fr); gap:clamp(10px,2.4vmin,22px); align-items:start; }
    .lcol { min-width:0; }
    /* three across, two down: the tile width comes from the free height, so both rows always fit */
    .grid2 { --tw:clamp(58px,calc((100vh - 140px) / 2.5),136px); display:grid; grid-template-columns:repeat(3,var(--tw)); gap:calc(var(--gap) + 4px) var(--gap); }
    .grid2 .port, .grid2 .port.art { min-height:calc(var(--tw) * .74); }
    /* the details panel: what the popup used to be, always visible next to the list */
    .dpanel { position:sticky; top:0; align-self:start; display:grid; grid-template-columns:minmax(78px,25%) minmax(0,1fr); gap:var(--gap); padding:calc(var(--gap) + 4px); border-radius:16px; background:rgba(14,24,48,.9); border:2px solid #3d5aa0; box-shadow:0 0 24px rgba(90,127,208,.3); max-height:calc(100vh - 30px); overflow:auto; }
    .dpanel .big { height:clamp(70px,27vh,140px); } .dpanel .st { padding:.22em .6em; } .dpanel .acts button { padding:.4em .3em; } .dpanel .swipehint, .dpanel .gnote { display:none; }
    .dpanel .tabs { margin:0 0 var(--gap) 0; }
    .tw { position:relative; }
    .tile { position:relative; display:flex; flex-direction:column; width:100%; padding:0; border-radius:10px; border:2px solid #6b46a3; background:#1b1230; overflow:visible; text-align:center; cursor:pointer; transition:transform .12s; color:inherit; }
    .tile.lift { transform:translateY(-4px); border-color:#fff; box-shadow:0 0 14px rgba(160,80,255,.8); z-index:3; }
    .tile.eq { border-color:#2fd9a6; }
    .slotfull { aspect-ratio:4/5; }
    .port { display:flex; flex:1; align-items:center; justify-content:center; min-height:clamp(30px,7.5vmin,54px); font-size:clamp(20px,4.4vmin,32px); border-radius:7px 7px 0 0; }
    .lv { display:block; background:#3a2260; font-size:.85em; font-weight:800; padding:1px 0; }
    .gem { position:absolute; top:-8px; left:-8px; z-index:2; width:clamp(20px,3.6vmin,28px); height:clamp(20px,3.6vmin,28px); border-radius:50%; background:#8b3cff; border:2px solid #d5b3ff; font-weight:800; font-size:.95em; display:flex; align-items:center; justify-content:center; }
    .tick { position:absolute; top:-6px; right:-6px; z-index:2; width:clamp(16px,3vmin,22px); height:clamp(16px,3vmin,22px); border-radius:50%; background:#2fd9a6; color:#062a20; font-weight:900; font-size:.85em; display:flex; align-items:center; justify-content:center; }
    .bar { position:relative; display:block; height:clamp(14px,2.6vmin,19px); margin:4px 5px 5px; border-radius:9px; background:#0e0918; overflow:hidden; }
    .bar i { position:absolute; inset:0 auto 0 0; background:#4a8be0; } .bar.ready i { background:#2fd9a6; }
    .bar b { position:relative; font-size:.8em; line-height:clamp(14px,2.6vmin,19px); } .bar.max { background:#3a2260; }
    /* the popup sits ON the tile, so it can never fall off the screen edge */
    .pop { position:absolute; z-index:5; left:-4px; right:-4px; bottom:-4px; top:22%; padding:6px; display:flex; flex-direction:column; justify-content:center; gap:6px; background:rgba(28,46,88,.96); border:2px solid #6aa0f0; border-radius:12px; box-shadow:0 6px 18px #000a; }
    .pop button { padding:.45em .2em; font-weight:800; font-size:.95em; }
    .blue { background:#3b78d8; border-color:#9cc0ff; }
    .scrim { position:fixed; inset:0; z-index:15; background:rgba(6,3,12,.72); display:flex; align-items:center; justify-content:center; padding:max(8px,var(--sat)) max(8px,var(--sar)) max(8px,var(--sab)) max(8px,var(--sal)); }
    .modal { position:relative; width:min(540px,100%); max-height:100%; overflow:auto; display:grid; grid-template-columns:minmax(90px,25%) 1fr; gap:var(--gap); padding:calc(var(--gap) + 4px); border-radius:16px; background:#1c2a52; border:2px solid #5a7fd0; box-shadow:0 0 30px rgba(90,127,208,.4); }
    .x { position:absolute; top:8px; right:8px; width:clamp(26px,5vmin,34px); height:clamp(26px,5vmin,34px); padding:0; background:#c93b3b; border-color:#ff9a9a; font-weight:900; }
    .big { height:clamp(50px,19vmin,110px); border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:clamp(30px,10vmin,60px); border:2px solid #8fb0f0; }
    .nm { font-size:1.45em; font-weight:800; margin-top:6px; } .sub { color:#d5b3ff; font-weight:800; }
    .sgrid { display:grid; grid-template-columns:1fr 1fr; gap:calc(var(--gap) / 1.5); }
    .st { background:#dfe6f7; color:#15203c; border-radius:8px; padding:.35em .7em; } .st.up { background:#33c26b; color:#062a16; }
    .st span { display:block; opacity:.75; font-size:.82em; font-weight:700; } .st b { font-size:1.2em; } .st em { font-style:normal; font-weight:800; margin-left:4px; }
    .tabs { display:flex; gap:6px; margin:0 clamp(34px,6vmin,44px) var(--gap) 0; } .tabs button { flex:1; padding:.35em .2em; font-size:.95em; font-weight:700; background:#25386b; border-color:#4a66b0; } .tabs button.on { background:#3a2260; border-color:#ffd24a; color:#ffd24a; }
    .pane { overflow:hidden; touch-action:pan-y; } .track { display:flex; transition:transform .25s ease; } .slide { flex:0 0 100%; min-width:0; min-height:clamp(96px,26vmin,150px); }
    .swipehint { text-align:center; font-size:.8em; opacity:.6; margin-top:4px; }
    .dots { display:flex; gap:8px; justify-content:center; margin:var(--gap) 0 0; } .dots button { width:12px; height:12px; padding:0; border-radius:50%; background:#5a6a90; border:0; } .dots button.on { background:#ffd24a; }
    .acts { display:flex; gap:var(--gap); grid-column:1 / -1; } .acts button { flex:1; padding:.5em .4em; font-size:1em; font-weight:800; }
    .grey { background:#7d8394; border-color:#b8bfd0; color:#e8ebf4; } .grey small { display:block; font-weight:600; opacity:.85; font-size:.75em; }
    .port img { width:62%; height:62%; object-fit:contain; filter:drop-shadow(0 2px 3px #000a); } .big img { width:64%; height:78%; object-fit:contain; filter:drop-shadow(0 3px 5px #000a); }
    /* portrait cards: a head-and-shoulders render fills the art window, over a glow in the rarity colour */
    .port.art, .big.art, .cport.art, .fxcard.art { position:relative; overflow:hidden; }
    .port.art { min-height:clamp(70px,14.5vmin,108px); border-radius:7px 7px 0 0; overflow:hidden; }
    .port.art img, .big.art img, .cport.art img, .fxcard.art img { position:absolute; inset:0; width:100%; height:100%; max-width:none; object-fit:cover; object-position:50% 35%; border-radius:inherit; filter:none; pointer-events:none; }
    .big.art { height:clamp(84px,27vmin,158px); } .fxcard.art { position:absolute; border-radius:18px; } .cport.art { width:clamp(58px,13vmin,80px); }
    .tile.art { box-shadow:0 2px 8px #000a, inset 0 0 0 1px rgba(255,255,255,.08); } .tile.art.eq { box-shadow:0 0 12px rgba(47,217,166,.6), inset 0 0 0 1px rgba(47,217,166,.5); }
    .tick img { width:80%; height:80%; } .x img { width:78%; height:78%; } .rarlab { display:flex; align-items:center; gap:4px; font-size:.9em; opacity:.9; margin-top:2px; } .rarlab img { width:1.3em; height:1.3em; }
    .sortlab { opacity:.6; margin-left:10px; align-self:center; font-size:.9em; } .arr { width:1em; height:1em; vertical-align:-.15em; margin-left:3px; } .arr.down { transform:rotate(180deg); }
    .upbtn { position:absolute; left:6px; right:6px; bottom:6px; height:clamp(16px,3vmin,22px); z-index:4; padding:0; border-radius:10px; font-size:.85em; font-weight:800; display:flex; align-items:center; justify-content:center; gap:3px;
             background:linear-gradient(var(--go),var(--go-lo)); color:var(--go-ink); border:1px solid var(--go-hi); box-shadow:0 0 10px var(--go); animation:upPulse 1.2s ease-in-out infinite; }
    .upbtn img { width:1.2em; height:1.2em; margin:0; } @keyframes upPulse { 50% { box-shadow:0 0 20px var(--go); } }
    .tile.flash { animation:flashUp .7s ease-out; } @keyframes flashUp { 0% { box-shadow:0 0 0 #fff; } 35% { box-shadow:0 0 34px #fff; transform:scale(1.07); } 100% { box-shadow:none; } }
    .uparrow { position:absolute; right:-6px; bottom:22%; z-index:2; width:clamp(18px,3.4vmin,26px); height:clamp(18px,3.4vmin,26px); border-radius:50%; background:var(--go); border:2px solid var(--go-hi); box-shadow:0 0 10px var(--go); display:flex; align-items:center; justify-content:center; animation:upPulse 1.2s ease-in-out infinite; pointer-events:none; }
    .uparrow img { width:78%; height:78%; } @keyframes upPulse { 50% { box-shadow:0 0 20px var(--go); } }
    .cscrim { z-index:20; }
    .fxscrim { z-index:25; background:radial-gradient(ellipse at 50% 42%, #0f3a34 0%, #08121c 55%, #05030a 100%); animation:fadeInFx .25s ease-out both; }
    @keyframes fadeInFx { from { opacity:0; } to { opacity:1; } }
    .fxbox { display:flex; flex-direction:column; align-items:center; gap:clamp(6px,1.6vmin,12px); animation:fxIn .35s cubic-bezier(.3,1.5,.5,1) both; }
    @keyframes fxIn { from { transform:scale(.7); opacity:0; } to { transform:none; opacity:1; } }
    .fxname { font-size:clamp(22px,5.4vmin,38px); font-weight:900; letter-spacing:.04em; text-shadow:0 3px 0 #000, 0 0 18px rgba(255,255,255,.35); }
    .fxlevel { font-size:clamp(16px,3.6vmin,26px); font-weight:800; color:#7ef2c8; text-shadow:0 0 14px var(--go); animation:lvPop .6s .35s cubic-bezier(.3,1.8,.5,1) both; } .fxlevel img.ic { width:1.1em; height:1.1em; vertical-align:-.2em; } .fxlevel b { font-size:1.3em; }
    @keyframes lvPop { from { transform:scale(.4); opacity:0; } to { transform:none; opacity:1; } }
    .fxcardwrap { position:relative; width:clamp(90px,24vmin,150px); aspect-ratio:1; }
    .fxcard { position:absolute; inset:0; border-radius:16px; border:3px solid #7ef2c8; box-shadow:0 0 30px rgba(126,242,200,.7); display:flex; align-items:center; justify-content:center; } .fxcard img { width:66%; height:66%; object-fit:contain; filter:drop-shadow(0 4px 6px #000a); }
    .fxring { position:absolute; left:50%; top:50%; width:100%; height:100%; margin:-50% 0 0 -50%; border-radius:50%; border:3px solid var(--go-hi); opacity:0; animation:fxRing .8s .6s ease-out both; }
    @keyframes fxRing { 0% { transform:scale(.6); opacity:.9; } 100% { transform:scale(3.2); opacity:0; } }
    .fxspark { position:absolute; left:50%; top:50%; width:8px; height:8px; margin:-4px; border-radius:50%; background:radial-gradient(#fff,#7ef2c8 60%,transparent); opacity:0; animation:fxSpark .9s ease-out both; }
    @keyframes fxSpark { 0% { transform:translate(0,0) scale(1.4); opacity:1; } 100% { transform:translate(var(--dx),var(--dy)) scale(.2); opacity:0; } }
    .fxstat { display:grid; grid-template-columns:5.5em auto auto; align-items:baseline; gap:10px; font-weight:800; animation:fadeUpFx .4s .55s ease-out both; } .fxstat:nth-of-type(2) { animation-delay:.7s; }
    .fxstat .lab { opacity:.8; font-size:clamp(12px,2.4vmin,17px); text-align:right; } .fxstat .val { font-size:clamp(22px,5vmin,36px); text-shadow:0 2px 0 #000; min-width:2.6em; } .fxstat .plus { color:#39ff8a; font-size:clamp(16px,3.6vmin,26px); text-shadow:0 0 10px #1fbf5f; opacity:0; animation:plusPop .5s 1.3s cubic-bezier(.3,1.8,.5,1) both; }
    @keyframes plusPop { from { transform:scale(.3); opacity:0; } to { transform:none; opacity:1; } }
    @keyframes fadeUpFx { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
    .fxtap { opacity:.55; margin-top:6px; animation:fadeUpFx .4s 2s ease-out both; }
    .cbox { width:min(380px,94%); display:flex; flex-direction:column; gap:calc(var(--gap) + 2px); padding:calc(var(--gap) + 6px); border-radius:16px; background:#1c2a52; border:2px solid #5a7fd0; box-shadow:0 0 30px rgba(90,127,208,.45); animation:cbIn .18s ease-out; }
    @keyframes cbIn { from { transform:scale(.92); opacity:0; } to { transform:none; opacity:1; } }
    .chead { display:flex; gap:12px; align-items:center; } .cport { width:clamp(52px,12vmin,72px); aspect-ratio:1; border-radius:12px; border:2px solid #8fb0f0; display:flex; align-items:center; justify-content:center; flex:none; } .cport img { width:70%; height:70%; object-fit:contain; }
    .ctitle { font-size:1.35em; font-weight:800; } .csub { color:#d5b3ff; margin-top:2px; } .csub b { color:#7ef2c8; }
    .cstats { display:grid; grid-template-columns:1fr 1fr; gap:6px; } .cs { background:#dfe6f7; color:#15203c; border-radius:8px; padding:.35em .7em; } .cs span { display:block; opacity:.75; font-size:.8em; font-weight:700; } .cs b { font-size:1.1em; }
    .ccost { background:#152244; border:1px solid #3d5aa0; border-radius:10px; padding:.5em .8em; } .clab { display:block; opacity:.7; font-size:.8em; font-weight:700; letter-spacing:.08em; text-transform:uppercase; margin-bottom:3px; }
    .crow { display:flex; align-items:center; gap:8px; } .crow span { flex:1; } .crow b { font-size:1.1em; } .crow img.ic { width:1.3em; height:1.3em; } .crow.bad b { color:#ff9a90; }
    .cbtns { display:flex; gap:var(--gap); } .cbtns button { flex:1; padding:.7em .4em; font-size:1.05em; font-weight:800; display:flex; align-items:center; justify-content:center; gap:5px; } .cbtns img.ic { width:1.2em; height:1.2em; }
    .note { font-size:.82em; opacity:.7; margin-top:6px; } .ptable { width:100%; font-size:.95em; border-collapse:collapse; } .ptable td, .ptable th { padding:4px 6px; text-align:left; } .ptable th { opacity:.7; font-size:.85em; }
  `],
  template: `
  <div class="cols"><div class="lcol">
    <div class="top"><h1>Souls</h1><span class="goldpill" title="Gold: spent with copies to level up a Soul"><img [src]="goldIcon" alt="">{{ fmt(save.gold()) }}</span><span class="meta">Deck <b>{{ deck().length }}/{{ save.deckSize }}</b> &middot; avg Dominion <b>{{ avg() }}</b> (1★)</span>
      <button class="go small" style="margin-left:auto" (click)="recommended($event)">Recommended</button></div>
    @if (deck().length < save.deckSize) { <p class="note">Only equipped Souls are drawn in a run. You need all {{ save.deckSize }} slots filled to start.</p> }
    <div class="filters">
      @for (f of filters; track f) { <button class="chip" [class.on]="filter() === f" (click)="setFilter(f, $event)">{{ f === 'all' ? 'All' : f === 'skill' ? 'Skill' : 'Passive' }}</button> }
      <span class="sortlab">Sort</span>
      @for (k of sortKeys; track k.id) { <button class="chip" [class.on]="sortKey() === k.id" (click)="setSort(k.id, $event)">{{ k.label }}@if (sortKey() === k.id) { <img class="ic arr" [class.down]="sortDir() < 0" [src]="upgradeIcon" alt=""> }</button> }
    </div>
    <div class="grid2">
      @for (s of shown(); track s) {
        <div class="tw">
          <button class="tile" [class.art]="art(s)" [style.border-color]="rc(s)" [class.lift]="detail() === s" [class.eq]="save.isEquipped(s)" [class.flash]="flashId() === s" (click)="tapTile(s, $event)">
            <span class="gem">{{ cost(s) }}</span>@if (save.isEquipped(s)) { <span class="tick"><img [src]="checkIcon" alt=""></span> }@if (canLevel(s)) { <span class="uparrow"><img [src]="upgradeIcon" alt=""></span> }
            <span class="port" [class.art]="art(s)" [style.background]="bg(s)"><img [src]="icon(s)" alt=""></span><span class="lv">Level {{ save.progress(s).level }}</span>
            <span class="bar" [class.ready]="copiesOk(s)" [class.max]="isMax(s)"><i [style.width.%]="pct(s)"></i><b>{{ isMax(s) ? 'Max' : save.progress(s).copies + '/' + need(s) }}</b></span>
          </button>
        </div>
      }
    </div>
  </div>
    @if (detail(); as d) {
      <aside class="dpanel">
          <div><div class="big" [class.art]="art(d)" [style.background]="bg(d)" [style.border-color]="rc(d)"><img [src]="icon(d)" alt=""></div>
            <div class="nm">{{ name(d) }}</div><div class="sub">Level {{ save.progress(d).level }}</div><div class="rarlab"><img [src]="gem(rarityOf(d))" alt="">{{ rarityName(d) }}</div>
            <div class="note">{{ role(d) }}</div></div>
          <div>
            <div class="tabs"><button [class.on]="page() === 0" (click)="page.set(0)">Stats</button><button [class.on]="page() === 1" (click)="page.set(1)">{{ ability(d).kind === 'skill' ? 'Skill' : 'Passive' }}</button><button [class.on]="page() === 2" (click)="page.set(2)">Stars</button></div>
            <div class="pane" (pointerdown)="swipeStart($event)" (pointerup)="swipeEnd($event)">
              <div class="track" [style.transform]="'translateX(' + (-100 * page()) + '%)'">
              <div class="slide">
                <div class="sgrid">
                  <div class="st up"><span>Health</span><b>{{ stat(d,'hp') }}</b><em>+{{ gain(d,'hp') }}</em></div>
                  <div class="st up"><span>Damage</span><b>{{ stat(d,'dmg') }}</b><em>+{{ gain(d,'dmg') }}</em></div>
                  <div class="st"><span>Attacks every</span><b>{{ base(d).interval }}s</b></div>
                  <div class="st"><span>Range</span><b>{{ base(d).range }}m</b></div>
                  <div class="st"><span>Move speed</span><b>{{ base(d).speed }}</b></div>
                  <div class="st"><span>Dominion (1★)</span><b>{{ cost(d) }}</b></div>
                </div>
                <div class="note gnote">Green = what the next level adds. Levels apply to your units in every battle.</div>
              </div>
              <div class="slide">
                <span class="tag" [class.skill]="ability(d).kind === 'skill'" [class.passive]="ability(d).kind === 'passive'">{{ ability(d).kind === 'skill' ? 'Skill' : 'Passive' }}: {{ ability(d).name }}</span>
                <p style="font-size:1.05em">{{ ability(d).text }}</p>
                @if (manaLine(d)) { <div class="note">{{ manaLine(d) }}</div> }
              </div>
              <div class="slide">
                <table class="ptable"><tr><th></th><th>Dominion</th><th>Health</th><th>Damage</th></tr>
                  @for (r of starRows(d); track r.star) { <tr><td>{{ r.star }}★</td><td>{{ r.cost }}</td><td>{{ r.hp }}</td><td>{{ r.dmg }}</td></tr> }</table>
                <div class="note">Stars come from merging during a run and reset after the stage.</div>
              </div>
              </div>
            </div>
            <div class="swipehint">swipe or tap the tabs</div>
          </div>
          <div class="acts">
            <button [class]="canLevel(d) ? 'go' : 'grey'" (click)="upgradeClick(d, $event)">@if (canLevel(d)) { <img class="ic" [src]="upgradeIcon" alt=""> }Upgrade<small>{{ isMax(d) ? 'Max level' : canLevel(d) ? 'Level ' + save.progress(d).level + ' → ' + (save.progress(d).level + 1) + ' · costs ' + need(d) + ' copies + ' + fmt(goldNeed(d)) + ' gold' : needText(d) }}</small></button>
            <button [class]="save.isEquipped(d) ? 'blue' : 'go'" (click)="toggle(d, $event)">{{ save.isEquipped(d) ? 'Unequip' : 'Equip' }}</button>
          </div>
      </aside>
    }
  </div>
    @if (toastMsg()) { <div class="box" style="position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:30;border-color:#ffd24a">{{ toastMsg() }}</div> }

    @if (confirming(); as c) {
      <div class="scrim cscrim" (click)="cancelUpgrade()">
        <div class="cbox" (click)="$event.stopPropagation()">
          <div class="chead"><div class="cport" [class.art]="art(c)" [style.background]="bg(c)" [style.border-color]="rc(c)"><img [src]="icon(c)" alt=""></div>
            <div><div class="ctitle">Upgrade {{ name(c) }}?</div><div class="csub">Level {{ save.progress(c).level }} &rarr; <b>Level {{ save.progress(c).level + 1 }}</b></div></div></div>
          <div class="cstats">
            <div class="cs"><span>Health</span><b>{{ statAt(c, 'hp', save.progress(c).level) }} &rarr; {{ statAt(c, 'hp', save.progress(c).level + 1) }}</b></div>
            <div class="cs"><span>Damage</span><b>{{ statAt(c, 'dmg', save.progress(c).level) }} &rarr; {{ statAt(c, 'dmg', save.progress(c).level + 1) }}</b></div>
          </div>
          <div class="ccost"><span class="clab">Cost</span>
            @for (r of costs(c); track r.id) { <div class="crow" [class.bad]="!r.ok"><span>{{ r.label }}</span><b>{{ fmt(r.have) }} / {{ fmt(r.need) }}</b><img class="ic" [src]="r.ok ? checkIcon : closeIcon" alt=""></div> }
          </div>
          <div class="cbtns"><button class="blue" (click)="cancelUpgrade()">Cancel</button><button class="go" [disabled]="!canPay(c)" (click)="doUpgrade()"><img class="ic" [src]="upgradeIcon" alt="">Confirm</button></div>
        </div>
      </div>
    }

    @if (fx(); as f) {
      <div class="scrim fxscrim" (click)="closeFx()">
        <div class="fxbox">
          <div class="fxname">{{ name(f.soul) }}</div>
          <div class="fxlevel"><img class="ic" [src]="upgradeIcon" alt=""> Level <b>{{ f.level }}</b></div>
          <div class="fxcardwrap">
            <span class="fxring"></span>
            @for (sp of fxSparks; track $index) { <i class="fxspark" [style.--dx]="sp.dx + 'px'" [style.--dy]="sp.dy + 'px'" [style.animation-delay]="(600 + sp.delay) + 'ms'"></i> }
            <div class="fxcard" [class.art]="art(f.soul)" [style.background]="bg(f.soul)"><img [src]="icon(f.soul)" alt=""></div>
          </div>
          <div class="fxstat"><span class="lab">Health</span><span class="val">{{ hpShown() }}</span><span class="plus">+{{ f.hp1 - f.hp0 }}</span></div>
          <div class="fxstat"><span class="lab">Damage</span><span class="val">{{ dmgShown() }}</span><span class="plus">+{{ f.dmg1 - f.dmg0 }}</span></div>
          <small class="fxtap">Tap to continue</small>
        </div>
      </div>
    }`,
})
export class Souls {
  save = inject(SaveService);
  fmt = fmt; goldIcon = goldIcon; checkIcon = checkIcon; closeIcon = closeIcon; upgradeIcon = upgradeIcon; gem = gemIcon;
  rarityOf = (s: SoulId) => RARITY_OF[s]; rarityName = (s: SoulId) => RARITY_NAME[RARITY_OF[s]];
  filters: Filter[] = ['all', 'skill', 'passive'];
  filter = signal<Filter>('all');
  pop = signal<SoulId | null>(null);
  /** The Soul shown in the side panel (the first equipped one to begin with). */
  detail = signal<SoulId | null>(this.save.deck()[0] ?? SOULS[0]);
  page = signal(0);
  toastMsg = signal('');
  deck = this.save.deck;
  slots = computed(() => Array.from({ length: this.save.deckSize }, (_, i) => this.save.deck()[i] ?? null));
  avg = computed(() => { const d = this.save.deck(); return (d.reduce((n, s) => n + COST[s][0], 0) / Math.max(1, d.length)).toFixed(1); });
  sortKeys = [{ id: 'level', label: 'Level' }, { id: 'cost', label: 'Cost' }, { id: 'rarity', label: 'Rarity' }, { id: 'progress', label: 'Progress' }] as const;
  sortKey = signal<'none' | 'level' | 'cost' | 'rarity' | 'progress'>('none');
  sortDir = signal<1 | -1>(1);
  flashId = signal<SoulId | null>(null);
  /** The Soul whose Upgrade is waiting for a Confirm. */
  confirming = signal<SoulId | null>(null);
  shown = computed(() => {
    const base = SOULS.filter((s) => this.filter() === 'all' || abilityInfo(s).kind === this.filter()), k = this.sortKey(), d = this.sortDir();
    if (k === 'none') return base;
    // progress = copies toward the next level (a Soul that already has enough ranks above a full bar); max-level Souls count as 0
    const val = (s: SoulId) => (k === 'level' ? this.save.progress(s).level : k === 'cost' ? COST[s][0] : k === 'progress' ? (this.isMax(s) ? 0 : this.save.progress(s).copies / Math.max(1, this.need(s))) : RARITIES.indexOf(RARITY_OF[s]));
    return [...base].sort((a, b) => (val(a) - val(b)) * d || SOULS.indexOf(a) - SOULS.indexOf(b));      // ties keep the roster order
  });

  icon = (s: SoulId) => soulArt(s); art = (s: SoulId) => hasArt(s); rc = (s: SoulId) => (hasArt(s) ? rarityColor(s) : null); bg = (s: SoulId) => (hasArt(s) ? artBg(s) : BG[s]); name = (s: SoulId) => SOUL_NAME[s]; role = (s: SoulId) => ROLE_TEXT[s];
  cost = (s: SoulId) => COST[s][0]; base = (s: SoulId) => BALANCE.stats[s]; ability = (s: SoulId) => abilityInfo(s);
  need = (s: SoulId) => copiesNeeded(this.save.progress(s).level, s);
  isMax = (s: SoulId) => isMaxLevel(this.save.progress(s).level);
  /** Ready to upgrade right now: enough copies AND enough gold. */
  canLevel = (s: SoulId) => !this.isMax(s) && canAfford(this.save.costs(s));
  copiesOk = (s: SoulId) => !this.isMax(s) && this.save.progress(s).copies >= this.need(s);
  goldNeed = (s: SoulId) => goldNeeded(this.save.progress(s).level);
  /** What is still missing, in the button's small print. */
  needText = (s: SoulId) => 'Needs ' + this.costs(s).filter((c) => !c.ok).map((c) => fmt(c.have) + '/' + fmt(c.need) + ' ' + c.label.toLowerCase()).join(' · ');
  pct = (s: SoulId) => this.isMax(s) ? 100 : Math.min(100, (100 * this.save.progress(s).copies) / Math.max(1, this.need(s)));
  statAt(s: SoulId, k: 'hp' | 'dmg', level: number) { return Math.round(BALANCE.stats[s][k] * (1 + (level - 1) * BALANCE.level[k])); }
  costs = (s: SoulId) => this.save.costs(s);
  canPay = (s: SoulId) => canAfford(this.save.costs(s));
  stat(s: SoulId, k: 'hp' | 'dmg') { const lv = this.save.progress(s).level; return Math.round(BALANCE.stats[s][k] * (1 + (lv - 1) * BALANCE.level[k])); }
  gain(s: SoulId, k: 'hp' | 'dmg') { return Math.max(1, Math.round(BALANCE.stats[s][k] * BALANCE.level[k])); }
  starRows(s: SoulId) { return [1, 2, 3].map((star) => ({ star, cost: COST[s][star - 1], hp: Math.round(this.stat(s, 'hp') * BALANCE.star.hp[star - 1]), dmg: Math.round(this.stat(s, 'dmg') * BALANCE.star.dmg[star - 1]) })); }
  manaLine(s: SoulId) { const m = BALANCE.mana[s]; return m ? `Mana: +${m.perAttack} per attack, +${m.perHit} when hit, ${m.max} to cast (about every ${Math.ceil(m.max / m.perAttack)} attacks). Resets each battle.` : ''; }

  private sx = 0; private sy = 0;
  swipeStart(e: PointerEvent) { this.sx = e.clientX; this.sy = e.clientY; }
  swipeEnd(e: PointerEvent) { const dx = e.clientX - this.sx, dy = e.clientY - this.sy; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) this.page.set(Math.max(0, Math.min(2, this.page() + (dx < 0 ? 1 : -1)))); }
  /** Tap a sort chip: ascending, tap again for descending, tap a third time to go back to roster order. */
  setSort(k: 'level' | 'cost' | 'rarity' | 'progress', e: Event) {
    e.stopPropagation(); this.pop.set(null);
    if (this.sortKey() !== k) { this.sortKey.set(k); this.sortDir.set(1); } else if (this.sortDir() === 1) this.sortDir.set(-1); else { this.sortKey.set('none'); this.sortDir.set(1); }
  }
  private beep() { try { (window as any).__audio?.play('merge'); } catch { /* sound is optional */ } }
  /** The details page's Upgrade button. Affordable: ask for a Confirm. Not affordable: say exactly what is missing. */
  upgradeClick(s: SoulId, e: Event) {
    e.stopPropagation();
    if (this.isMax(s)) { this.say(SOUL_NAME[s] + ' is already at max level.'); return; }
    if (this.canLevel(s)) { this.confirming.set(s); return; }
    const missing = this.costs(s).filter((c) => !c.ok).map((c) => (c.need - c.have) + ' more ' + c.label.toLowerCase()).join(' and ');
    this.say('You need ' + missing + ' to upgrade!');
  }
  cancelUpgrade() { this.confirming.set(null); }
  doUpgrade() {
    const s = this.confirming(); this.confirming.set(null); if (!s) return;
    const from = this.save.progress(s).level;
    if (this.save.levelUp(s)) this.celebrate(s, from);
  }
  /** After a confirmed upgrade: the new level, and the health and damage gains counting up. */
  fx = signal<{ soul: SoulId; level: number; hp0: number; hp1: number; dmg0: number; dmg1: number } | null>(null);
  hpShown = signal(0); dmgShown = signal(0);
  fxSparks = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3, d = 80 + Math.random() * 120; return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d), delay: Math.round(Math.random() * 200) }; });
  private fxTimer = 0; private fxRaf = 0;
  private celebrate(s: SoulId, from: number) {
    const to = from + 1, f = { soul: s, level: to, hp0: this.statAt(s, 'hp', from), hp1: this.statAt(s, 'hp', to), dmg0: this.statAt(s, 'dmg', from), dmg1: this.statAt(s, 'dmg', to) };
    this.fx.set(f); this.hpShown.set(f.hp0); this.dmgShown.set(f.dmg0); this.beep(); setTimeout(() => { try { (window as any).__audio?.play('packRare'); } catch { /* optional */ } }, 900);
    const t0 = performance.now() + 900, step = (now: number) => {
      const u = Math.max(0, Math.min(1, (now - t0) / 800)), k = 1 - Math.pow(1 - u, 3);
      this.hpShown.set(Math.round(f.hp0 + (f.hp1 - f.hp0) * k)); this.dmgShown.set(Math.round(f.dmg0 + (f.dmg1 - f.dmg0) * k));
      if (u < 1) this.fxRaf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.fxRaf); this.fxRaf = requestAnimationFrame(step);
    clearTimeout(this.fxTimer); this.fxTimer = window.setTimeout(() => this.closeFx(), 4500);
  }
  closeFx() { cancelAnimationFrame(this.fxRaf); clearTimeout(this.fxTimer); this.fx.set(null); }
  setFilter(f: Filter, e: Event) { e.stopPropagation(); this.filter.set(f); this.pop.set(null); }
  tapTile(s: SoulId, e: Event) { e.stopPropagation(); this.select(s); }
  openDetail(s: SoulId, e: Event) { e.stopPropagation(); this.select(s); }
  select(s: SoulId) { this.pop.set(null); if (this.detail() !== s) this.page.set(0); this.detail.set(s); }
  toggle(s: SoulId, e: Event) { e.stopPropagation(); this.pop.set(null); this.say(this.save.toggle(s)); }
  recommended(e: Event) { e.stopPropagation(); this.save.recommended(); this.say('Deck filled.'); }
  private t = 0;
  private say(m: string | null) { if (!m) return; this.toastMsg.set(m); clearTimeout(this.t); this.t = window.setTimeout(() => this.toastMsg.set(''), 2400); }
}
