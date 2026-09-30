import { Component, Injectable, OnDestroy, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SaveService } from './save.service';
import { canSummon } from '../../../core/rules.ts';

/**
 * First-time tutorial: the screen dims except for the one thing to press, with a short line beside it.
 * It follows the game by looking at it (a 10 Hz check), so it needs no hooks inside the game.
 * Steps: Home > Start Battle > pick a card > pick a tile > Dominion > (summon more) > BATTLE > watch > draft > free pack > Shop > Souls.
 * Plays once: players with any progress never see it, and it can be skipped at any moment. It never comes back by itself: leaving the run or reloading mid-way counts as skipping.
 * Settings > How to play replays it on purpose (no second pack).
 */
type Rect = { x: number; y: number; w: number; h: number };
interface Step { text: string; target?: () => Rect | null; dim?: boolean; btn?: string; onBtn?: () => void; run?: boolean }
const KEY = 'necro-tutorial';
interface TState { step: string; done: boolean; rewarded: boolean; started: boolean }
const load = (): TState => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && typeof j === 'object') return { step: String(j.step || ''), done: !!j.done, rewarded: !!j.rewarded, started: !!j.started }; } catch { /* private mode */ } return { step: '', done: false, rewarded: false, started: false }; };
const store = (t: TState) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* not saved: it just replays */ } };
const rectOf = (sel: string): Rect | null => { const e = document.querySelector<HTMLElement>(sel); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const r = e.getBoundingClientRect(); return r.width < 2 || r.height < 2 ? null : { x: r.left, y: r.top, w: r.width, h: r.height }; };
const game = (): any => (window as any).__game;

@Injectable({ providedIn: 'root' })
export class Tutorial {
  private router = inject(Router);
  private save = inject(SaveService);
  private st: TState = load();
  readonly step = signal<string>('');
  readonly rect = signal<Rect | null>(null);
  private url = this.router.url;
  private lostShown = false;
  private nudged = false;

  constructor() {
    this.router.events.subscribe((e) => { if (e instanceof NavigationEnd) this.url = e.urlAfterRedirects; });
    if (!this.st.done) setTimeout(() => this.begin(), 600);
    window.setInterval(() => this.tick(), 100);
  }

  private begin() {
    if (this.st.done) return;
    if (this.st.started && this.st.step) {                     // the page was reloaded or left mid-tutorial: it does not pop up again on its own
      if (!this.st.rewarded) { this.st.rewarded = true; this.save.grantWelcomePack(); }
      this.finish(); return;
    }
    if (!this.st.started) {                                    // decided once: only a save nobody has played gets the tutorial
      if (!this.save.isFresh()) { this.st.done = true; store(this.st); return; }
      this.save.setDifficulty('easy');                        // a gentle first fight
      this.st.started = true; this.st.step = 'home'; store(this.st);
    }
    this.step.set(this.st.step);
  }
  private go(id: string) { this.st.step = id; store(this.st); this.step.set(id); }
  /** Replay from Settings (never gives a second pack). */
  replay() { this.st = { step: 'home', done: false, rewarded: true, started: true }; store(this.st); this.step.set('home'); this.lostShown = false; }
  skip() { if (!this.st.rewarded) { this.st.rewarded = true; this.save.grantWelcomePack(); } this.finish(); }
  private finish() { this.st.done = true; this.st.step = ''; store(this.st); this.step.set(''); this.rect.set(null); }

  readonly steps: Record<string, Step> = {
    home: { text: 'Welcome, Necromancer! Your army is ready. Tap here to start your first battle.', target: () => rectOf('button.big'), dim: true },
    card: { text: 'This is your hand. Tap a card to pick a Soul.', target: () => rectOf('#hand .card:not(.dis)') ?? rectOf('#hand .card'), dim: true, run: true },
    tile: { text: 'Now tap the glowing tile to summon it there.', target: () => game()?.emptyTileRect?.() ?? null, dim: true, run: true },
    dominion: { text: 'Dominion is how big your army can be. Stronger Souls cost more. Fill it up: a bigger army wins. To merge two of the same Soul, tap one, then tap the other.', target: () => rectOf('#top'), dim: true, btn: 'Got it', onBtn: () => this.go('more'), run: true },
    more: { text: 'Fill your Dominion: tap a card, then a tile, again and again. Tap Ready when your army looks good.', dim: false, btn: 'Ready', onBtn: () => this.ready(), run: true },
    battle: { text: 'Press BATTLE. Your Souls fight on their own.', target: () => rectOf('#btnBattle'), dim: true, run: true },
    watch: { text: '', run: true },
    lost: { text: 'Your army fell, so you lost a heart. That is fine: you get another try with an extra card. Build again and press BATTLE.', dim: false, btn: 'Got it', onBtn: () => this.go('more'), run: true },
    draft: { text: 'You won the wave! Pick one Soul to keep. Your Dominion grew too, so you can field more.', target: () => rectOf('#overlay .row'), dim: true, run: true },
    reward: { text: 'You know the basics! Here is a free Soul Pack. Let us go open it.', dim: true, btn: 'Go to the Shop', onBtn: () => { this.go('shop'); this.router.navigateByUrl('/shop'); } },
    shop: { text: 'Tap the pack to open it. Packs give you copies of Souls.', target: () => rectOf('.pk'), dim: true },
    souls: { text: 'Copies level your Souls up. Open the Souls page to see what you got.', target: () => rectOf('nav.rail a:nth-child(2)'), dim: true },
    souls2: { text: 'Tap a Soul, then Upgrade when it has enough copies. Level up, clear waves, and open more packs. Good luck!', dim: true, btn: 'Finish', onBtn: () => this.finish() },
  };

  private tick() {
    const id = this.step(); if (!id || this.st.done) return;
    const g = game(), s = g?.s, onRun = this.url.startsWith('/run'), def = this.steps[id];
    // -------- automatic advances
    if (id === 'home' && onRun) this.go('card');
    else if (id === 'card' && onRun && g?.sel?.type === 'card') this.go('tile');
    else if (id === 'card' && onRun && s?.units?.length >= 1) this.go('dominion');
    else if (id === 'tile' && onRun && s?.units?.length >= 1) this.go('dominion');
    else if (id === 'tile' && onRun && !g?.sel) this.go('card');            // they tapped away: back to picking a card
    else if (id === 'battle' && onRun && (g?.phase === 'battle' || g?.phase === 'transition')) this.go('watch');
    else if (id === 'watch' && onRun) {
      if (g?.phase === 'draft') this.go('draft');
      else if (g?.phase === 'won' || g?.phase === 'lost') this.enterReward();
      else if (g?.phase === 'build' && s && s.hearts < 3 && !this.lostShown) { this.lostShown = true; this.go('lost'); }
      else if (g?.phase === 'build' && s && s.wave >= 2) this.enterReward();
    }
    else if (id === 'draft' && onRun && g?.phase !== 'draft') this.enterReward();
    else if (id === 'battle' && onRun && s && s.wave >= 2) this.enterReward();
    else if (id === 'shop' && this.url.startsWith('/shop') && this.save.packs().length === 0 && !document.querySelector('app-pack-open')) this.go('souls');
    else if (id === 'souls' && this.url.startsWith('/souls')) this.go('souls2');
    // -------- what to show
    const cur = this.steps[this.step()]; if (!cur) return;
    if (cur.run && !onRun) { this.skip(); return; }              // they left the run: the tutorial is over (never nag)
    if (cur.target) this.rect.set(cur.target()); else this.rect.set(null);
  }
  /** Ready: fight now, unless there is Dominion left to spend (one friendly nudge, then it lets them go). */
  private ready() {
    const s = game()?.s; const canMore = !!s && s.hand.some((_: any, i: number) => canSummon(s, i));
    if (canMore && !this.nudged) { this.nudged = true; this.steps['more'].text = 'You still have Dominion to spend, so summon more Souls first. A bigger army wins. Tap Ready when you are done.'; return; }
    this.go('battle');
  }
  private enterReward() { if (!this.st.rewarded) { this.st.rewarded = true; this.save.grantWelcomePack(); } this.go('reward'); }

  /** What the overlay shows right now. */
  view() {
    const id = this.step(), cur = this.steps[id]; if (!id || !cur) return null;
    const onRun = this.url.startsWith('/run');
    if (id === 'shop' && document.querySelector('app-pack-open')) return null;              // the opening animation has the stage
    if (!cur.text) return null;
    return { text: cur.text, dim: !!cur.dim && (!cur.target || !!this.rect()), btn: cur.btn || '', rect: this.rect(), skip: id !== 'reward', act: cur.onBtn };
  }
}

@Component({
  selector: 'app-tutorial',
  styles: [`
    .dim { position:fixed; background:rgba(2,4,10,.8); z-index:2000000; }
    .ring { position:fixed; z-index:2000001; pointer-events:none; border:3px solid var(--go-hi,#7ef2c8); border-radius:12px; box-shadow:0 0 0 2px rgba(0,0,0,.4), 0 0 18px var(--go,#3fd0a0); animation:tutpulse 1.1s ease-in-out infinite; }
    @keyframes tutpulse { 50% { box-shadow:0 0 0 2px rgba(0,0,0,.4), 0 0 30px var(--go,#3fd0a0); } }
    .bub { position:fixed; z-index:2000002; width:min(300px,64vw); padding:10px 13px; border-radius:14px; background:linear-gradient(#241a38,#150f24); border:2px solid var(--go-hi,#7ef2c8); color:#fff; font-size:clamp(11px,1.9vmin,14px); line-height:1.35; box-shadow:0 6px 24px #000c; }
    .bub button { margin-top:8px; padding:.4em 1.1em; border-radius:12px; background:linear-gradient(#6fdcb2,#37b48a); border:2px solid #b8f2dc; color:#08281d; font-weight:800; font-size:1em; }
    .skip { position:fixed; z-index:2000003; left:12px; bottom:10px; font-size:12px; color:#b9b3d6; text-decoration:underline; background:none; border:none; padding:6px; opacity:.85; }
    .veil { position:fixed; inset:0; z-index:2000000; background:rgba(2,4,10,.8); }
  `],
  template: `
    @if (v(); as x) {
      @if (x.dim && x.rect; as r) {
        <div class="dim" [style.left.px]="0" [style.top.px]="0" [style.width.vw]="100" [style.height.px]="max0(r.y - pad)"></div>
        <div class="dim" [style.left.px]="0" [style.top.px]="r.y - pad" [style.width.px]="max0(r.x - pad)" [style.height.px]="r.h + pad * 2"></div>
        <div class="dim" [style.left.px]="r.x + r.w + pad" [style.top.px]="r.y - pad" [style.right.px]="0" [style.height.px]="r.h + pad * 2"></div>
        <div class="dim" [style.left.px]="0" [style.top.px]="r.y + r.h + pad" [style.width.vw]="100" [style.bottom.px]="0"></div>
        <div class="ring" [style.left.px]="r.x - pad" [style.top.px]="r.y - pad" [style.width.px]="r.w + pad * 2" [style.height.px]="r.h + pad * 2"></div>
      } @else if (x.dim) { <div class="veil"></div> }
      <div class="bub" [style.left.px]="pos(x).left" [style.top.px]="pos(x).top">{{ x.text }}@if (x.btn) { <div><button (click)="press(x)">{{ x.btn }}</button></div> }</div>
      @if (x.skip) { <button class="skip" (click)="t.skip()">Skip tutorial</button> }
    }
  `,
})
export class TutorialOverlay implements OnDestroy {
  t = inject(Tutorial);
  pad = 6;
  private tick = signal(0);
  private iv = window.setInterval(() => this.tick.update((n) => n + 1), 100);
  ngOnDestroy() { clearInterval(this.iv); }
  v() { this.tick(); this.t.step(); this.t.rect(); return this.t.view(); }
  max0 = (n: number) => Math.max(0, n);
  press(x: any) { if (x.act) x.act(); }
  /** Beside the highlighted thing (below it if there is room, otherwise above), kept on screen; centred when nothing is highlighted. */
  pos(x: { rect: Rect | null; dim: boolean }): { left: number; top: number } {
    const w = Math.min(300, window.innerWidth * 0.64), h = 96, vw = window.innerWidth, vh = window.innerHeight, r = x.rect;
    if (!r) return x.dim ? { left: (vw - w) / 2, top: (vh - h) / 2 } : { left: 12, top: Math.max(96, vh * 0.3) };   // a note with nothing to point at sits at the left, clear of the grid and the buttons
    const below = r.y + r.h + this.pad + 12 + h < vh, top = below ? r.y + r.h + this.pad + 12 : Math.max(8, r.y - this.pad - 12 - h);
    return { left: Math.min(vw - w - 8, Math.max(8, r.x + r.w / 2 - w / 2)), top };
  }
}
