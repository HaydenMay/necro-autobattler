import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { SoulId } from '../../../../core/data.ts';
import { SOUL_NAME } from '../../../../core/balance.ts';
import { PROTOTYPE_RULES } from '../../../../core/prototype.ts';
import { DIFFICULTY_INFO, STAGES, stageById } from '../../../../core/waves.ts';
import { ENDLESS_ID } from '../../../../core/endless.ts';
import { REWARDS, describeUnlock } from '../../../../core/progress.ts';
import type { Difficulty } from '../../../../core/save.ts';
import { GameLink } from '../game-link.service';
import { SaveService } from '../save.service';
import { MOOD, lookOf } from '../stage-look';
import { BG, artBg, hasArt, heartEmptyIcon, heartIcon, rarityColor, skullIcon, soulArt } from '../soul-ui';

const TIER_LABEL: Record<string, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', nightmare: 'Nightmare' };

/** Home: the campaign (stages and their difficulty tiers), your deck, and the one big button. The fight opens full-screen from here. */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
  styles: [`
    :host { display:flex; align-items:center; justify-content:center; min-height:100%; font-size:clamp(11px,1.9vmin,14px); }
    .wrap { width:100%; display:grid; grid-template-columns:minmax(0,1.7fr) minmax(0,1fr); gap:clamp(8px,2vmin,18px); max-width:960px; }
    .stage { position:relative; padding:0; overflow:hidden; background:linear-gradient(160deg,rgba(10,22,30,.86),rgba(8,10,16,.9)); border-color:color-mix(in srgb, var(--accent) 45%, #1b1526); box-shadow:0 0 22px color-mix(in srgb, var(--accent) 22%, transparent), 0 8px 24px #000a; }
    .stage .in { padding:clamp(7px,1.9vh,20px) clamp(10px,2.4vmin,20px); }
    .hero { position:relative; overflow:hidden; height:clamp(42px,11vh,92px); border-bottom:1px solid color-mix(in srgb, var(--accent) 50%, #000); }
    .heroimg { position:absolute; inset:0; background-size:cover; }
    .necro { position:absolute; z-index:1; right:clamp(4px,2vmin,16px); bottom:-6%; height:190%; aspect-ratio:1; object-fit:cover; object-position:50% 25%; pointer-events:none; filter:drop-shadow(0 3px 8px #000c); }
    .hero::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,rgba(3,7,10,.88),rgba(3,7,10,.35) 70%,rgba(3,7,10,.1)); }
    .herotxt { position:absolute; z-index:1; left:clamp(10px,2.4vmin,20px); right:10px; bottom:clamp(6px,1.4vmin,12px); }
    .stage h2 { margin:0; font-size:1.7em; color:var(--gold); text-shadow:0 2px 0 #000, 0 0 16px color-mix(in srgb, var(--accent) 60%, transparent); } .sub { opacity:.85; font-size:.92em; text-shadow:0 1px 2px #000; margin-bottom:clamp(6px,1.6vmin,12px); } .hero .sub { margin:0; }
    .path { display:flex; align-items:center; margin:clamp(4px,1.3vh,14px) 0; }
    .pip { position:relative; flex:none; width:clamp(20px,4vmin,30px); height:clamp(20px,4vmin,30px); border-radius:50%; background:#2b1c44; border:2px solid #6b46a3; display:flex; align-items:center; justify-content:center; font-size:.8em; font-weight:800; }
    .pip.done { background:#5a2fa0; border-color:#a45bff; } .pip.now { background:var(--go); border-color:var(--go-hi); color:var(--go-ink); box-shadow:0 0 12px var(--go); } .pip.boss { width:clamp(26px,5vmin,38px); height:clamp(26px,5vmin,38px); border-color:#ff7a7a; }
    .link { flex:1; height:3px; background:#3a2a5a; min-width:6px; } .link.done { background:#a45bff; }
    .diffs { display:flex; gap:6px; flex-wrap:wrap; margin:clamp(3px,1vh,8px) 0 3px; } .diffs button { padding:.35em .9em; border-radius:16px; font-size:.95em; font-weight:700; display:inline-flex; align-items:center; gap:4px; }
    .diffs button.on { background:#3a2260; border-color:#ffd24a; color:#ffd24a; } .diffs button.nm.on { background:#5a1420; border-color:#ff7a7a; color:#ffb0b0; }
    .diffs button.locked { opacity:.5; background:#1a1326; border-style:dashed; } .diffs button[disabled] { opacity:.45; }
    .diffs img { width:1.1em; height:1.1em; } .diffs .ck { width:.9em; height:.9em; }
    .blurb { font-size:.9em; opacity:.8; min-height:1.3em; } .hint { color:#ff9a90; font-weight:700; min-height:1.3em; font-size:.9em; }
    .rec { font-size:.92em; margin:2px 0 4px; } .rec b.ok { color:var(--go); } .rec b.low { color:#ffb454; }
    .deck { display:flex; align-items:center; gap:8px; margin:clamp(4px,1.3vh,12px) 0; flex-wrap:wrap; }
    .di { width:82%; height:82%; object-fit:contain; }
    .ic.empty { border-style:dashed; opacity:.5; }
    .ic { display:inline-flex; width:clamp(24px,4.6vmin,34px); height:clamp(24px,4.6vmin,34px); align-items:center; justify-content:center; border-radius:8px; background:#2b1c44; border:1px solid #6b46a3; font-size:1.3em; }
    .ic.art { overflow:hidden; border-width:2px; } .ic.art .di { width:100%; height:100%; object-fit:cover; object-position:50% 35%; }
    .deck a { color:#8fb0f0; }
    .dk { display:flex; align-items:flex-start; gap:clamp(4px,1vmin,8px); }
    .dc { position:relative; width:clamp(44px,min(9vw,12.5vh),76px); aspect-ratio:5/6; align-self:flex-start; border-radius:8px; border:2px solid #6b46a3; overflow:hidden; display:flex; align-items:center; justify-content:center; background:#2b1c44; font-size:1.1em; box-shadow:0 2px 6px #000a; }
    .dc img { width:68%; height:68%; object-fit:contain; } .dc.art img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 35%; }
    .dc b { position:absolute; left:0; right:0; bottom:0; background:rgba(16,8,32,.86); font-size:.68em; text-align:center; padding:1px 0; }
    .dc.empty { border-style:dashed; opacity:.5; }
    .rp { display:flex; align-items:center; gap:8px; font-size:.9em; } .rp .meter { flex:1; height:9px; border-radius:6px; background:#0e0918; border:1px solid #4a3470; overflow:hidden; } .rp .meter i { display:block; height:100%; background:var(--go); }
    .warn { color:#ff9a90; font-weight:700; }
    .acts { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .big { padding:.7em 2.2em; font-size:1.5em; letter-spacing:.06em; box-shadow:0 0 18px rgba(47,217,166,.5); border-radius:12px; border:1px solid var(--go-hi); background:linear-gradient(var(--go),var(--go-lo)); color:var(--go-ink); font-weight:900; cursor:pointer; }
    .big:not([disabled]) { animation:bigPulse 2.6s ease-in-out infinite; } @keyframes bigPulse { 50% { box-shadow:0 0 30px rgba(47,217,166,.85); } }
    .big[disabled] { opacity:.4; box-shadow:none; cursor:default; }
    .blue { background:#3b78d8; border-color:#9cc0ff; }
    .stages { display:flex; flex-direction:column; gap:8px; }
    .sc { position:relative; display:flex; align-items:stretch; gap:.7em; width:100%; text-align:left; padding:0; overflow:hidden; border-radius:12px; background:rgba(10,14,20,.86); border:1px solid #2c3a44; color:inherit; cursor:pointer; box-shadow:0 4px 12px #0009; }
    .sc .th { position:relative; flex:none; width:clamp(48px,11vmin,78px); background-size:cover; } .sc .th::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent 55%,rgba(10,14,20,.95)); }
    .sc .tx { padding:.6em .8em .6em 0; min-width:0; }
    .sc.sel { border-color:var(--ac); box-shadow:0 0 16px color-mix(in srgb, var(--ac) 45%, transparent), 0 4px 12px #0009; } .sc.lock { opacity:.55; border-style:dashed; cursor:default; } .sc[disabled] { opacity:.5; cursor:default; }
    .sc b { font-size:1.08em; } .sc small { display:block; opacity:.75; margin-top:2px; }
    .marks { display:flex; gap:4px; flex-wrap:wrap; margin-top:5px; } .mark { display:inline-flex; align-items:center; gap:3px; font-size:.8em; padding:1px 7px; border-radius:9px; background:#25153f; border:1px solid #6b46a3; } .mark img { width:1em; height:1em; }
    .mark.none { opacity:.4; border-style:dashed; }
    .fresh { animation:freshPulse 1.3s ease-in-out infinite; } @keyframes freshPulse { 50% { box-shadow:0 0 18px var(--go); border-color:var(--go-hi); } }
    /* unlock celebration: the padlock shakes, the shackle swings open, a ring bursts out, then the words appear */
    .uscrim { position:fixed; inset:0; z-index:35; background:rgba(6,3,12,.8); display:flex; align-items:center; justify-content:center; cursor:pointer; animation:fadeIn .25s ease-out both; }
    @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
    .ubox { display:flex; flex-direction:column; align-items:center; gap:clamp(8px,2vmin,18px); padding:0 16px; }
    .lockwrap { position:relative; width:clamp(96px,26vmin,170px); height:clamp(96px,26vmin,170px); animation:lockShake .75s .35s ease-in-out both; }
    @keyframes lockShake { 0%,100% { transform:rotate(0); } 12% { transform:rotate(-9deg); } 27% { transform:rotate(8deg); } 42% { transform:rotate(-7deg); } 57% { transform:rotate(6deg); } 72% { transform:rotate(-3deg); } 88% { transform:rotate(2deg); } }
    .lk { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 4px 10px #000a); }
    .lk.shackle { clip-path:inset(0 0 55% 0); transform-origin:29% 42%; animation:shackleOpen .5s 1.15s cubic-bezier(.3,1.7,.5,1) both; }
    .lk.body { clip-path:inset(40% 0 0 0); z-index:2; animation:bodyGlow .7s 1.15s both; }
    @keyframes shackleOpen { from { transform:translateY(0) rotate(0); } to { transform:translateY(-8%) rotate(-32deg); } }
    @keyframes bodyGlow { to { filter:drop-shadow(0 0 24px var(--go)) brightness(1.3); } }
    .burst { position:absolute; left:50%; top:52%; width:22%; height:22%; margin:-11% 0 0 -11%; border-radius:50%; border:3px solid var(--go-hi); opacity:0; animation:burstRing .75s 1.2s ease-out both; }
    @keyframes burstRing { 0% { transform:scale(.4); opacity:.95; } 100% { transform:scale(6); opacity:0; } }
    .utext { opacity:0; animation:fadeUp .5s 1.5s ease-out both; text-align:center; line-height:1.5; }
    .utext h3 { margin:0 0 4px; font-size:clamp(20px,4.6vmin,32px); color:var(--go); letter-spacing:.1em; text-shadow:0 0 16px var(--go); } .utext div { font-size:clamp(12px,2.4vmin,17px); font-weight:700; } .utext small { display:block; margin-top:8px; opacity:.6; }
    @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
    .sc.lock .th { filter:grayscale(1) brightness(.6); }
    /* short phones: drop the extras so the whole page fits without scrolling */
    @media (max-height:430px) { .more, .sc small:not(.lk) { display:none; } .sc .tx { padding:.45em .6em .45em 0; } .stages { gap:6px; } }
    @media (max-width:640px) { .wrap { grid-template-columns:1fr; } }
  `],
  template: `
    <div class="wrap">
      <div class="box stage" [style.--accent]="look().accent">
        <div class="hero"><img class="necro" src="assets/portraits/necromancer_head.png" alt="" draggable="false"><div class="heroimg" [style.background-image]="mood" [style.background-position]="look().pos" [style.filter]="'hue-rotate(' + look().hue + 'deg) saturate(1.2)'"></div>
          <div class="herotxt"><h2>{{ heroName() }}</h2><div class="sub">{{ heroBlurb() }}</div></div></div>
        <div class="in">
        @if (endlessRun()) { <div class="blurb" style="margin:6px 0 2px">This run: Endless Depths. Finish or start over to change it. A Soul Pack for every 10 waves cleared.</div> } @else {
        <div class="path">
          @for (w of waves; track w) {
            @if (w > 1) { <span class="link" [class.done]="w <= current()"></span> }
            <span class="pip" [class.done]="w < current()" [class.now]="w === current()" [class.boss]="w === total">@if (w === total) { <img class="ic" [src]="skullIcon" alt=""> } @else { {{ w }} }</span>
          }
        </div>
        <div class="diffs">
          @for (d of diffs; track d.id) {
            <button [class.on]="shown() === d.id" [class.nm]="d.id === 'nightmare'" [class.locked]="!open(d.id)" [class.fresh]="isFresh('tier:' + shownStage() + ':' + d.id)" [disabled]="!!run()" [title]="open(d.id) ? d.blurb : save.diffReason(shownStage(), $any(d.id))" (click)="pickDiff($any(d.id))">
              @if (!open(d.id)) { <img [src]="lockIcon" alt="Locked"> }{{ d.label }}@if (save.cleared(shownStage(), $any(d.id))) { <img class="ck" [src]="checkIcon" alt="Cleared"> }
            </button>
          }
        </div>
        <div class="hint">{{ hint() }}</div>
        <div class="blurb">{{ run() ? 'This run: ' + stageDef().name + ', ' + label(shown()) + '. Finish or start over to change it.' : blurb() }}</div>
        <div class="rec">Recommended Soul level: <b [class.ok]="deckAvg() >= rec()" [class.low]="deckAvg() < rec()">{{ rec() }}</b> <span class="muted">(your deck averages {{ deckAvg().toFixed(1) }})</span></div>
        }
        <div class="deck">
          <span class="muted">Deck</span>
          <div class="dk">@for (s of deckSlots(); track $index) { <span class="dc" [class.empty]="!s" [class.art]="!!s && art(s)" [style.border-color]="s ? rc(s) : null" [style.background]="s ? bg(s) : null" [title]="s ? name(s) : 'empty slot'">@if (s) { <img [src]="icon(s)" alt=""><b>Lv {{ save.progress(s).level }}</b> } @else { + }</span> }</div>
          <a routerLink="/souls" style="margin-left:4px">change</a>
          @if (!deckOk()) { <span class="warn">Equip {{ save.deckSize }} Souls to start ({{ save.deck().length }}/{{ save.deckSize }})</span> }
        </div>
        <div class="acts">
          @if (run(); as r) {
            <button class="big" (click)="resume()">Continue <small style="font-size:.5em;letter-spacing:0">Wave {{ r.wave }}{{ endlessRun() ? '' : '/' + r.total }} &middot; @for (h of heartList(r.hearts); track $index) { <img class="ic" [src]="h ? heartFull : heartEmpty" alt=""> }</small></button>
            <button class="blue" (click)="confirmRestart()">{{ confirming() ? 'Tap again to abandon run' : 'Start over' }}</button>
          } @else {
            <button class="big" [disabled]="!link.ready() || !deckOk()" (click)="start()">{{ link.ready() ? 'Start Battle' : 'Loading army…' }}</button>
          }
        </div>
        </div>
      </div>
      <div class="stages">
        @for (st of stages; track st.id; let i = $index) {
          <button class="sc" [style.--ac]="lookOf(st.id).accent" [class.fresh]="isFresh('stage:' + st.id)" [class.sel]="shownStage() === st.id" [class.lock]="!save.stageOpen(i)" [disabled]="!!run()" (click)="pickStage(st.id, i)">
            <span class="th" [style.background-image]="mood" [style.background-position]="lookOf(st.id).pos" [style.filter]="'hue-rotate(' + lookOf(st.id).hue + 'deg) saturate(1.25) brightness(1.35)'"></span>
            <span class="tx"><b>{{ st.name }}</b>
            @if (save.stageOpen(i)) {
              <small>Recommended level {{ st.rec[shown()] }} on {{ label(shown()) }}</small>
              <div class="marks">@for (d of diffs; track d.id) { <span class="mark" [class.none]="!save.cleared(st.id, $any(d.id))">@if (save.cleared(st.id, $any(d.id))) { <img [src]="checkIcon" alt=""> }{{ d.label }}</span> }</div>
            } @else {
              <small class="lk"><img class="ic" style="width:1.1em;height:1.1em" [src]="lockIcon" alt=""> {{ save.stageReason(i) }}</small>
            }
            </span>
          </button>
        }
        <button class="sc endl" [style.--ac]="lookOf('endless').accent" [class.fresh]="isFresh('endless')" [class.sel]="endlessRun()" [class.lock]="!save.endlessOpen()" [disabled]="!save.endlessOpen() || (!!run() && !endlessRun())" (click)="startEndless()">
          <span class="th" [style.background-image]="mood" [style.background-position]="lookOf('endless').pos" [style.filter]="'hue-rotate(' + lookOf('endless').hue + 'deg) saturate(1.25) brightness(1.35)'"></span>
          <span class="tx"><b>Endless Depths</b>
          @if (save.endlessOpen()) {
            <small>{{ endlessRun() ? 'Run in progress' : 'Best: wave ' + save.endlessBest() }}</small>
            <div class="marks"><span class="mark">{{ endlessRun() ? 'Run in progress' : 'Best: wave ' + save.endlessBest() }}</span><span class="mark">A pack every 10 waves</span></div>
          } @else {
            <small class="lk"><img class="ic" style="width:1.1em;height:1.1em" [src]="lockIcon" alt=""> Clear {{ lastStageName }} on Normal to unlock.</small>
          }
          </span>
        </button>
        <div class="box rp"><span>Bonus pack</span><span class="meter"><i [style.width.%]="(100 * save.replayMeter()) / replayNeeded"></i></span><span>{{ save.replayMeter() }}/{{ replayNeeded }} clears</span></div>
        <div class="box more" style="opacity:.55"><b>More stages</b> <span class="tag soon">coming</span><div style="font-size:.9em;margin-top:3px">New enemies, bosses and first-clear Soul Packs.</div></div>
      </div>
    </div>
    @if (fresh().length) {
      <div class="uscrim" (click)="dismiss()">
        <div class="ubox">
          <div class="lockwrap"><span class="burst"></span><img class="lk shackle" [src]="lockIcon" alt=""><img class="lk body" [src]="lockIcon" alt=""></div>
          <div class="utext"><h3>UNLOCKED!</h3>@for (k of fresh(); track k) { <div>{{ describe(k) }}</div> }<small>Tap to continue</small></div>
        </div>
      </div>
    }`,
})
export class Home implements OnDestroy {
  private router = inject(Router);
  save = inject(SaveService);
  link = inject(GameLink);
  /** Unlocks not yet celebrated: the banner plays once for each, then they are marked as seen. */
  fresh = signal<string[]>([]);
  private freshTimer = 0;
  isFresh = (key: string) => this.fresh().includes(key);
  describe = describeUnlock;
  constructor() {
    const keys = this.save.freshUnlocks();
    if (keys.length) { this.fresh.set(keys); this.freshTimer = window.setTimeout(() => this.dismiss(), 6500); try { (window as any).__audio?.play('unlock'); } catch { /* sound is optional */ } }
  }
  dismiss() { clearTimeout(this.freshTimer); const k = this.fresh(); if (k.length) { this.save.markSeen(k); this.fresh.set([]); } }
  ngOnDestroy() { this.dismiss(); }
  total = PROTOTYPE_RULES.stageWaves ?? 10;
  waves = Array.from({ length: this.total }, (_, i) => i + 1);
  confirming = signal(false);
  hint = signal('');
  private hintTimer = 0;
  diffs = DIFFICULTY_INFO;
  stages = STAGES;
  lockIcon = 'assets/icons/lock.png'; checkIcon = 'assets/icons/check.png';
  private tick = signal(0);
  run = computed(() => { this.tick(); return this.link.runInfo(); });
  /** While a run is going Home shows THAT run's stage and tier; otherwise what will start next. */
  shownStage = computed(() => this.run()?.stage ?? this.save.stage());
  shown = computed(() => (this.run()?.difficulty ?? this.save.difficulty()) as Difficulty);
  /** True while the run in progress is an Endless Depths run (Home then shows that instead of a stage and tier). */
  endlessRun = computed(() => this.run()?.stage === ENDLESS_ID);
  lastStageName = STAGES[STAGES.length - 1].name;
  stageDef = computed(() => stageById(this.shownStage()));
  heroName = computed(() => (this.endlessRun() ? 'Endless Depths' : this.stageDef().name));
  heroBlurb = computed(() => (this.endlessRun() ? 'No last wave. The enemy keeps growing: how deep can you go?' : this.stageDef().blurb));
  rec = computed(() => this.stageDef().rec[this.shown()]);
  deckAvg = computed(() => { const d = this.save.deck(); return d.reduce((n, s) => n + this.save.progress(s).level, 0) / Math.max(1, d.length); });
  blurb = computed(() => DIFFICULTY_INFO.find((d) => d.id === this.shown())?.blurb ?? '');
  label = (id: string) => TIER_LABEL[id] ?? id;
  open = (d: string) => this.save.diffOpen(this.shownStage(), d as Difficulty);
  current = computed(() => this.run()?.wave ?? 1);
  deckSlots = computed(() => Array.from({ length: this.save.deckSize }, (_, i) => this.save.deck()[i] ?? null));
  deckOk = computed(() => this.save.deck().length === this.save.deckSize);
  bg = (s: SoulId) => (hasArt(s) ? artBg(s) : BG[s]);
  replayNeeded = REWARDS.replayClearsPerPack;
  icon = (s: SoulId) => soulArt(s); art = (s: SoulId) => hasArt(s); rc = (s: SoulId) => rarityColor(s); name = (s: SoulId) => SOUL_NAME[s];
  mood = MOOD; lookOf = lookOf;
  look = computed(() => this.lookOf(this.shownStage()));
  skullIcon = skullIcon; heartFull = heartIcon; heartEmpty = heartEmptyIcon;
  heartList = (n: number) => Array.from({ length: 3 }, (_, i) => i < n);

  private say(msg: string) { this.hint.set(msg); clearTimeout(this.hintTimer); this.hintTimer = window.setTimeout(() => this.hint.set(''), 3500); }
  pickDiff(d: Difficulty) { if (this.run()) return; const why = this.save.setDifficulty(d); this.say(why ?? ''); }
  pickStage(id: string, index: number) { if (this.run()) return; const why = this.save.setStage(id); this.say(why ?? (this.save.stageOpen(index) ? '' : this.save.stageReason(index))); }
  /** Endless Depths: start a fresh run, or go back into the one in progress. */
  startEndless() {
    if (!this.save.endlessOpen()) return;
    if (this.endlessRun()) { this.resume(); return; }
    if (this.run()) return;
    if (!this.deckOk() || !this.link.ready()) { this.say('Equip ' + this.save.deckSize + ' Souls to start.'); return; }
    this.link.newEndless(); this.router.navigateByUrl('/run');
  }
  start() { if (!this.deckOk() || !this.link.ready()) return; this.link.newRun(); this.router.navigateByUrl('/run'); }
  resume() { this.router.navigateByUrl('/run'); }
  confirmRestart() {
    if (!this.confirming()) { this.confirming.set(true); setTimeout(() => this.confirming.set(false), 3000); return; }
    if (!this.deckOk()) { this.confirming.set(false); return; }
    if (this.endlessRun()) this.link.newEndless(); else this.link.newRun();
    this.router.navigateByUrl('/run');
  }
}
