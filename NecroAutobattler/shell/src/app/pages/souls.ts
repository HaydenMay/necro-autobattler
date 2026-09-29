import { Component, computed, inject, signal } from '@angular/core';
import { SOULS, COST } from '../../../../core/data.ts';
import type { SoulId } from '../../../../core/data.ts';
import { BALANCE, ROLE_TEXT, SOUL_NAME, abilityInfo } from '../../../../core/balance.ts';
import { SaveService } from '../save.service';

const ICON: Record<SoulId, string> = { warrior: '\u{1F480}', archer: '\u{1F3F9}', goblin: '\u{1F5E1}️', knight: '\u{1F6E1}️', ogre: '\u{1F528}', barbarian: '\u{1FA93}' };
const BG: Record<SoulId, string> = {
  warrior: 'linear-gradient(#6b4a8f,#2c1b45)', archer: 'linear-gradient(#5a4a9a,#251a4a)', goblin: 'linear-gradient(#4f7a3a,#1d2d17)',
  knight: 'linear-gradient(#3f6aa8,#15243f)', ogre: 'linear-gradient(#8a6a3a,#33230f)', barbarian: 'linear-gradient(#a8483a,#3a1512)',
};
type Filter = 'all' | 'skill' | 'passive';

@Component({
  selector: 'app-souls',
  host: { '(click)': 'pop.set(null)' },
  styles: [`
    .top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px; } .top h1 { margin:0; }
    .strip { display:flex; gap:10px; padding:10px 8px 8px; }
    .slot { width:78px; height:100px; border-radius:10px; border:2px dashed #4a3470; background:#1a1128; color:#6b5a8a; font-size:24px; display:flex; align-items:center; justify-content:center; padding:0; flex:none; }
    .meta { font-size:12px; opacity:.85; } .meta b { color:#fff; }
    .filters { display:flex; gap:6px; margin:10px 0 8px; } .chip { padding:4px 12px; border-radius:14px; font-size:12px; } .chip.on { background:#3a2260; border-color:#a45bff; }
    .grid2 { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:16px 12px; max-width:760px; }
    .tw { position:relative; }
    .tile { position:relative; width:100%; padding:0; border-radius:10px; border:2px solid #6b46a3; background:#1b1230; overflow:visible; text-align:center; cursor:pointer; transition:transform .12s; color:inherit; }
    .tile.lift { transform:translateY(-4px); border-color:#fff; box-shadow:0 0 14px rgba(160,80,255,.8); z-index:3; }
    .tile.eq { border-color:#2fd9a6; }
    .slotfull { width:78px; height:100px; flex:none; }
    .port { display:flex; align-items:center; justify-content:center; height:64px; font-size:38px; border-radius:7px 7px 0 0; }
    .lv { display:block; background:#3a2260; font-size:11px; font-weight:800; padding:1px 0; }
    .gem { position:absolute; top:-8px; left:-8px; z-index:2; width:26px; height:26px; border-radius:50%; background:#8b3cff; border:2px solid #d5b3ff; font-weight:800; font-size:13px; line-height:22px; }
    .tick { position:absolute; top:-6px; right:-6px; z-index:2; width:20px; height:20px; border-radius:50%; background:#2fd9a6; color:#062a20; font-weight:900; font-size:12px; line-height:20px; }
    .bar { position:relative; display:block; height:17px; margin:4px 5px 5px; border-radius:9px; background:#0e0918; overflow:hidden; }
    .bar i { position:absolute; inset:0 auto 0 0; background:#4a8be0; } .bar.ready i { background:#2fd9a6; }
    .bar b { position:relative; font-size:10.5px; line-height:17px; } .bar.max { background:#3a2260; }
    .pop { position:absolute; z-index:5; left:50%; top:calc(100% - 4px); transform:translateX(-50%); width:118px; padding:6px; display:flex; flex-direction:column; gap:5px; background:#243a63; border:2px solid #6aa0f0; border-radius:12px; box-shadow:0 6px 18px #000a; }
    .pop button { padding:6px; font-weight:800; }
    .blue { background:#3b78d8; border-color:#9cc0ff; }
    .scrim { position:fixed; inset:0; z-index:15; background:rgba(6,3,12,.72); display:flex; align-items:center; justify-content:center; padding:10px; }
    .modal { position:relative; width:min(720px,100%); max-height:100%; overflow:auto; display:grid; grid-template-columns:200px 1fr; gap:12px; padding:14px; border-radius:16px; background:#1c2a52; border:2px solid #5a7fd0; box-shadow:0 0 30px rgba(90,127,208,.4); }
    .x { position:absolute; top:8px; right:8px; width:30px; height:30px; padding:0; background:#c93b3b; border-color:#ff9a9a; font-weight:900; }
    .big { height:150px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:84px; border:2px solid #8fb0f0; }
    .nm { font-size:20px; font-weight:800; margin-top:8px; } .sub { color:#d5b3ff; font-weight:800; }
    .sgrid { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
    .st { background:#dfe6f7; color:#15203c; border-radius:8px; padding:5px 9px; font-size:12px; } .st.up { background:#33c26b; color:#062a16; }
    .st span { display:block; opacity:.75; font-size:10.5px; font-weight:700; } .st b { font-size:15px; } .st em { font-style:normal; font-weight:800; margin-left:4px; }
    .pane { min-height:150px; margin-top:26px; }
    .dots { display:flex; gap:8px; justify-content:center; margin:8px 0; } .dots button { width:12px; height:12px; padding:0; border-radius:50%; background:#5a6a90; border:0; } .dots button.on { background:#ffd24a; }
    .acts { display:flex; gap:8px; grid-column:1 / -1; } .acts button { flex:1; padding:11px 8px; font-size:14px; font-weight:800; }
    .grey { background:#7d8394; border-color:#b8bfd0; color:#e8ebf4; } .grey small { display:block; font-weight:600; opacity:.85; font-size:10.5px; }
    .note { font-size:10.5px; opacity:.7; margin-top:6px; } .ptable { width:100%; font-size:12.5px; border-collapse:collapse; } .ptable td, .ptable th { padding:4px 6px; text-align:left; } .ptable th { opacity:.7; font-size:11px; }
    @media (max-width:700px), (max-height:520px) { .modal { grid-template-columns:150px 1fr; padding:10px; } .big { height:100px; font-size:56px; } .pane { margin-top:22px; min-height:0; } .slot, .slotfull { width:64px; height:84px; } .slotfull .port { height:50px; font-size:30px; } }
  `],
  template: `
    <div class="top"><h1>Souls</h1><span class="meta">Deck <b>{{ deck().length }}/{{ save.deckSize }}</b> &middot; avg Dominion <b>{{ avg() }}</b> (1★)</span>
      <button class="go" style="margin-left:auto" (click)="recommended($event)">Recommended</button></div>
    <div class="box strip">
      @for (i of slots(); track $index) {
        @if (i) {
          <button class="tile eq slotfull" (click)="openDetail(i, $event)">
            <span class="gem">{{ cost(i) }}</span><span class="port" [style.background]="bg(i)">{{ icon(i) }}</span><span class="lv">LV {{ save.progress(i).level }}</span></button>
        } @else { <div class="slot">+</div> }
      }
    </div>
    <p class="note">A run only draws from your equipped Souls. Changes apply to your next run: start it with <b>Campaign &rarr; Play</b>.</p>
    <div class="filters">
      @for (f of filters; track f) { <button class="chip" [class.on]="filter() === f" (click)="setFilter(f, $event)">{{ f === 'all' ? 'All' : f === 'skill' ? 'Skill' : 'Passive' }}</button> }
    </div>
    <div class="grid2">
      @for (s of shown(); track s) {
        <div class="tw">
          <button class="tile" [class.lift]="pop() === s" [class.eq]="save.isEquipped(s)" (click)="tapTile(s, $event)">
            <span class="gem">{{ cost(s) }}</span>@if (save.isEquipped(s)) { <span class="tick">&#10003;</span> }
            <span class="port" [style.background]="bg(s)">{{ icon(s) }}</span><span class="lv">Level {{ save.progress(s).level }}</span>
            <span class="bar" [class.ready]="canLevel(s)" [class.max]="isMax(s)"><i [style.width.%]="pct(s)"></i><b>{{ isMax(s) ? 'Max' : save.progress(s).copies + '/' + need(s) }}</b></span>
          </button>
          @if (pop() === s) {
            <div class="pop" (click)="$event.stopPropagation()">
              <button class="blue" (click)="openDetail(s, $event)">Details</button>
              <button class="go" (click)="toggle(s, $event)">{{ save.isEquipped(s) ? 'Unequip' : 'Equip' }}</button>
            </div>
          }
        </div>
      }
    </div>
    @if (toastMsg()) { <div class="box" style="position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:30;border-color:#ffd24a">{{ toastMsg() }}</div> }

    @if (detail(); as d) {
      <div class="scrim" (click)="detail.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <button class="x" (click)="detail.set(null)">&#10005;</button>
          <div><div class="big" [style.background]="bg(d)">{{ icon(d) }}</div>
            <div class="nm">{{ name(d) }}</div><div class="sub">Level {{ save.progress(d).level }} <span class="muted">&middot; placeholder</span></div>
            <div class="note">{{ role(d) }}</div></div>
          <div>
            <div class="pane">
              @if (page() === 0) {
                <div class="sgrid">
                  <div class="st up"><span>Health</span><b>{{ stat(d,'hp') }}</b><em>+{{ gain(d,'hp') }}</em></div>
                  <div class="st up"><span>Damage</span><b>{{ stat(d,'dmg') }}</b><em>+{{ gain(d,'dmg') }}</em></div>
                  <div class="st"><span>Attacks every</span><b>{{ base(d).interval }}s</b></div>
                  <div class="st"><span>Range</span><b>{{ base(d).range }}m</b></div>
                  <div class="st"><span>Move speed</span><b>{{ base(d).speed }}</b></div>
                  <div class="st"><span>Dominion (1★)</span><b>{{ cost(d) }}</b></div>
                </div>
                <div class="note">Green = what the next level would add. Levels are a preview: not applied in battles yet.</div>
              } @else if (page() === 1) {
                <span class="tag" [class.skill]="ability(d).kind === 'skill'" [class.passive]="ability(d).kind === 'passive'">{{ ability(d).kind === 'skill' ? 'Skill' : 'Passive' }}: {{ ability(d).name }}</span>
                <p style="font-size:13px">{{ ability(d).text }}</p>
                @if (manaLine(d)) { <div class="note">{{ manaLine(d) }}</div> }
              } @else {
                <table class="ptable"><tr><th></th><th>Dominion</th><th>Health</th><th>Damage</th></tr>
                  @for (r of starRows(d); track r.star) { <tr><td>{{ r.star }}★</td><td>{{ r.cost }}</td><td>{{ r.hp }}</td><td>{{ r.dmg }}</td></tr> }</table>
                <div class="note">Stars come from merging during a run and reset after the stage.</div>
              }
            </div>
            <div class="dots">@for (p of [0,1,2]; track p) { <button [class.on]="page() === p" (click)="page.set(p)"></button> }</div>
          </div>
          <div class="acts">
            <button class="grey" disabled>Upgrade<small>{{ isMax(d) ? 'Max level' : 'Needs ' + save.progress(d).copies + '/' + need(d) + ' copies' }}</small></button>
            <button [class]="save.isEquipped(d) ? 'blue' : 'go'" (click)="toggle(d, $event)">{{ save.isEquipped(d) ? 'Unequip' : 'Equip' }}</button>
          </div>
        </div>
      </div>
    }`,
})
export class Souls {
  save = inject(SaveService);
  filters: Filter[] = ['all', 'skill', 'passive'];
  filter = signal<Filter>('all');
  pop = signal<SoulId | null>(null);
  detail = signal<SoulId | null>(null);
  page = signal(0);
  toastMsg = signal('');
  deck = this.save.deck;
  slots = computed(() => Array.from({ length: this.save.deckSize }, (_, i) => this.save.deck()[i] ?? null));
  avg = computed(() => { const d = this.save.deck(); return (d.reduce((n, s) => n + COST[s][0], 0) / Math.max(1, d.length)).toFixed(1); });
  shown = computed(() => SOULS.filter((s) => this.filter() === 'all' || abilityInfo(s).kind === this.filter()));

  icon = (s: SoulId) => ICON[s]; bg = (s: SoulId) => BG[s]; name = (s: SoulId) => SOUL_NAME[s]; role = (s: SoulId) => ROLE_TEXT[s];
  cost = (s: SoulId) => COST[s][0]; base = (s: SoulId) => BALANCE.stats[s]; ability = (s: SoulId) => abilityInfo(s);
  need = (s: SoulId) => BALANCE.level.copiesToLevel[Math.min(this.save.progress(s).level, BALANCE.level.copiesToLevel.length) - 1] ?? 0;
  isMax = (s: SoulId) => this.save.progress(s).level > BALANCE.level.copiesToLevel.length;
  canLevel = (s: SoulId) => !this.isMax(s) && this.save.progress(s).copies >= this.need(s);
  pct = (s: SoulId) => this.isMax(s) ? 100 : Math.min(100, (100 * this.save.progress(s).copies) / Math.max(1, this.need(s)));
  stat(s: SoulId, k: 'hp' | 'dmg') { const lv = this.save.progress(s).level; return Math.round(BALANCE.stats[s][k] * (1 + (lv - 1) * BALANCE.level[k])); }
  gain(s: SoulId, k: 'hp' | 'dmg') { return Math.max(1, Math.round(BALANCE.stats[s][k] * BALANCE.level[k])); }
  starRows(s: SoulId) { return [1, 2, 3].map((star) => ({ star, cost: COST[s][star - 1], hp: Math.round(this.stat(s, 'hp') * BALANCE.star.hp[star - 1]), dmg: Math.round(this.stat(s, 'dmg') * BALANCE.star.dmg[star - 1]) })); }
  manaLine(s: SoulId) { const m = BALANCE.mana[s]; return m ? `Mana: +${m.perAttack} per attack, +${m.perHit} when hit, ${m.max} to cast (about every ${Math.ceil(m.max / m.perAttack)} attacks). Resets each battle.` : ''; }

  setFilter(f: Filter, e: Event) { e.stopPropagation(); this.filter.set(f); this.pop.set(null); }
  tapTile(s: SoulId, e: Event) { e.stopPropagation(); this.pop.set(this.pop() === s ? null : s); }
  openDetail(s: SoulId, e: Event) { e.stopPropagation(); this.pop.set(null); this.page.set(0); this.detail.set(s); }
  toggle(s: SoulId, e: Event) { e.stopPropagation(); this.pop.set(null); this.say(this.save.toggle(s)); }
  recommended(e: Event) { e.stopPropagation(); this.save.recommended(); this.say('Deck filled.'); }
  private t = 0;
  private say(m: string | null) { if (!m) return; this.toastMsg.set(m); clearTimeout(this.t); this.t = window.setTimeout(() => this.toastMsg.set(''), 2400); }
}
