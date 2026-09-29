import { Component, OnDestroy, OnInit, computed, input, output, signal } from '@angular/core';
import { SOULS } from '../../../core/data.ts';
import type { SoulId } from '../../../core/data.ts';
import { RARITY_NAME, RARITY_OF } from '../../../core/packs.ts';
import type { PackResult, Rarity } from '../../../core/packs.ts';
import { SOUL_NAME } from '../../../core/balance.ts';
import { copiesNeeded, isMaxLevel } from '../../../core/progress.ts';
import type { SoulProgress } from '../../../core/save.ts';
import { BG, RARITY_COLOR, artBg, gemIcon, hasArt, range, skullIcon, soulArt } from './soul-ui';

export interface OpenData { result: PackResult; before: Record<SoulId, SoulProgress> }
type Stage = 'idle' | 'charge' | 'tierup' | 'tear' | 'fan' | 'reveal' | 'summary';

/**
 * The Soul Pack opening (placeholder visuals, real flow): a foil-wrapped pack charges, may TIER UP, tears open, fans out its cards, and each
 * card is flipped by a tap. The result was decided before this screen opened; this component only shows it. Skip goes straight to the summary.
 */
@Component({
  selector: 'app-pack-open',
  styles: [`
    :host { display:block; --sz:clamp(120px,27vmin,210px); --pz:clamp(96px,23vmin,190px); }
    .scrim { position:fixed; inset:0; z-index:40; display:flex; align-items:center; justify-content:center; overflow:hidden; user-select:none; -webkit-user-select:none;
             background:radial-gradient(ellipse at 50% 55%, #0f3a34 0%, #08121c 55%, #05030a 100%); padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .skip { position:absolute; top:calc(env(safe-area-inset-top) + 10px); right:calc(env(safe-area-inset-right) + 12px); z-index:3; background:rgba(0,0,0,.45); }
    .stagebox { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:clamp(10px,2.4vmin,22px); width:100%; height:100%; }
    .hint { font-size:clamp(12px,2.2vmin,16px); opacity:.8; letter-spacing:.08em; animation:blink 1.4s ease-in-out infinite; }
    @keyframes blink { 50% { opacity:.35; } }

    /* ---- the pack: ChatGPT art, cut out by Pipeline/blender/cutout.py, standing on the altar. The tear splits the same picture into a strip and a body. */
    .altarwrap { position:relative; display:flex; flex-direction:column; align-items:center; }
    .pack { position:relative; z-index:2; height:calc(var(--pz) * 1.5); aspect-ratio:301/640; --glow:rgba(47,217,166,.35); filter:drop-shadow(0 10px 12px #000a) drop-shadow(0 0 22px var(--glow)); }
    .pack.t2 { --glow:rgba(47,217,166,.6); } .pack.t3 { --glow:rgba(255,204,51,.7); }
    .pbody, .ptop { position:absolute; inset:0; } .pbody img, .ptop img { display:block; width:100%; height:100%; }
    .ptop { z-index:2; } .ptop img { clip-path:inset(0 0 87% 0); } .pbody img { clip-path:inset(12% 0 0 0); }
    .altar { position:relative; z-index:1; width:calc(var(--pz) * 3.3); max-width:92vw; margin-top:calc(var(--pz) * -0.72); pointer-events:none; }
    .shake { animation:shake .12s linear infinite; }
    @keyframes shake { 0% { transform:translate(-2px,1px) rotate(-1.2deg); } 50% { transform:translate(2px,-1px) rotate(1.2deg); } 100% { transform:translate(-2px,1px) rotate(-1.2deg); } }
    .pulse { animation:pulse .9s ease-out; }
    @keyframes pulse { 0% { transform:scale(1); filter:drop-shadow(0 0 22px var(--glow)) brightness(1); } 35% { transform:scale(1.22); filter:drop-shadow(0 0 60px #fff) brightness(1.9); } 100% { transform:scale(1); filter:drop-shadow(0 0 22px var(--glow)) brightness(1); } }
    .tearing .ptop { animation:tearTop .7s ease-in forwards; }
    .tearing .pbody { animation:tearBody .8s .15s ease-in forwards; }
    @keyframes tearTop { to { transform:translate(70%,-160%) rotate(38deg); opacity:0; } }
    @keyframes tearBody { 0% { filter:brightness(1); } 30% { filter:brightness(3); } 100% { transform:scale(1.25); opacity:0; filter:brightness(3); } }
    .banner { position:absolute; top:12%; font-size:clamp(22px,6vmin,44px); font-weight:900; letter-spacing:.12em; color:#ffe27a; text-shadow:0 0 22px #ffb400, 0 2px 0 #000; animation:pop .9s ease-out; }
    @keyframes pop { 0% { transform:scale(.4); opacity:0; } 35% { transform:scale(1.25); opacity:1; } 100% { transform:scale(1); opacity:1; } }
    .spark { position:absolute; left:50%; top:46%; width:6px; height:6px; border-radius:50%; background:radial-gradient(#fff,#c79bff 60%,transparent); animation:spark .9s ease-out forwards; }
    @keyframes spark { from { transform:translate(0,0) scale(1.4); opacity:1; } to { transform:translate(var(--dx),var(--dy)) scale(.2); opacity:0; } }

    /* ---- the fan of card backs */
    .fan { position:relative; width:var(--sz); height:calc(var(--sz) * 1.5); }
    .cb, .face.back { background-position:center; background-size:100% 100%; background-repeat:no-repeat; }   /* the picture itself is set in the template (Angular would try to bundle a url() here) */
    .cb { filter:drop-shadow(0 0 10px var(--c)); }
    .cb { position:absolute; left:0; bottom:0; width:var(--sz); aspect-ratio:464/720; transform-origin:50% 120%; transform:rotate(var(--r)); animation:fanOut .8s ease-out both; font-size:calc(var(--sz) * .4); }
    @keyframes fanOut { from { transform:rotate(0deg) translateY(20px) scale(.6); opacity:0; } to { transform:rotate(var(--r)); opacity:1; } }

    /* ---- one card, flipped by a tap */
    .pips { display:flex; gap:7px; } .pips i { width:9px; height:9px; border-radius:50%; background:#3b2a5c; } .pips i.on { background:#b98aff; box-shadow:0 0 8px #b98aff; }
    .flipcard { width:var(--sz); aspect-ratio:464/720; perspective:900px; filter:drop-shadow(0 0 14px var(--c)); animation:cardIn .45s ease-out; }
    @keyframes cardIn { from { transform:translateY(40px) scale(.7); opacity:0; } to { transform:none; opacity:1; } }
    .inner { position:relative; width:100%; height:100%; transform-style:preserve-3d; transition:transform .55s cubic-bezier(.3,.7,.3,1); }
    .flipped .inner { transform:rotateY(180deg); }
    .face { position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden; }
    .face.back { font-size:calc(var(--sz) * .42); }
    .face.front { transform:rotateY(180deg); border:3px solid var(--c); border-radius:12px; background:#160d24; box-shadow:0 0 22px var(--c); display:flex; flex-direction:column; overflow:hidden; text-align:center; }
    .face.front.epic { box-shadow:0 0 40px var(--c), 0 0 12px var(--c); } .face.front.legend { animation:legend 1.1s ease-in-out infinite; }
    @keyframes legend { 50% { box-shadow:0 0 70px var(--c), 0 0 18px #fff; } }
    .por.art { position:relative; overflow:hidden; } .por.art img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 35%; filter:none; }
    .por { flex:1; display:flex; align-items:center; justify-content:center; font-size:calc(var(--sz) * .5); }
    .nm { font-weight:800; font-size:calc(var(--sz) * .1); padding:3px 4px 0; } .rar { font-size:calc(var(--sz) * .075); font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
    .cnt { background:var(--c); color:#150a24; font-weight:900; font-size:calc(var(--sz) * .15); padding:2px 0 3px; }
    .lvrow { width:calc(var(--sz) * 1.1); text-align:center; font-size:clamp(11px,2vmin,14px); }
    .lvbar { height:12px; border-radius:7px; background:#0c0716; overflow:hidden; border:1px solid #4a3470; margin-bottom:4px; } .lvbar i { display:block; height:100%; background:#4a8be0; transition:width .9s ease-out; } .lvbar.ready i { background:#2fd9a6; }

    .banner img, .summary .sk img, .up img { width:1em; height:1em; vertical-align:-.15em; }
    .por img { width:64%; height:64%; object-fit:contain; filter:drop-shadow(0 2px 4px #000a); }
    .rar .gm { width:1.3em; height:1.3em; vertical-align:-.3em; margin-right:3px; }
    /* ---- summary */
    .summary { display:flex; flex-direction:column; align-items:center; gap:clamp(8px,2vmin,16px); max-width:min(760px,94vw); }
    .summary h2 { margin:0; font-size:clamp(20px,4.6vmin,32px); color:#ffd24a; } .summary .sk { color:#dcbcff; letter-spacing:.1em; }
    .up { font-size:clamp(12px,2.2vmin,15px); color:#ffe27a; }
    .cards { display:flex; flex-wrap:wrap; gap:clamp(8px,2vmin,16px); justify-content:center; }
    .mini { position:relative; width:clamp(82px,15vmin,120px); border:2px solid var(--c); border-radius:10px; background:#160d24; box-shadow:0 0 14px var(--c); overflow:hidden; text-align:center; animation:cardIn .4s ease-out both; }
    .mini .por { height:clamp(44px,9vmin,70px); font-size:clamp(26px,5.6vmin,42px); flex:none; } .mini b { display:block; background:var(--c); color:#150a24; font-size:clamp(13px,2.4vmin,17px); } .mini span { display:block; font-size:clamp(10px,1.8vmin,12px); padding:2px; }
    .mini em { display:block; font-style:normal; font-size:clamp(9px,1.6vmin,11px); font-weight:800; color:#2fd9a6; padding-bottom:3px; }
  `],
  template: `
    <div class="scrim" (click)="tap()">
      @if (stage() !== 'summary') { <button class="skip" (click)="skip($event)">Skip &rsaquo;</button> }

      @if (showPack()) {
        <div class="stagebox">
          <div class="altarwrap">
            <div class="pack" [class.t1]="tier() === 1" [class.t2]="tier() === 2" [class.t3]="tier() === 3" [class.shake]="stage() === 'charge'" [class.pulse]="stage() === 'tierup'" [class.tearing]="stage() === 'tear'">
              <div class="pbody"><img [src]="packImg()" alt="" draggable="false"></div>
              <div class="ptop"><img [src]="packImg()" alt="" draggable="false"></div>
            </div>
            <img class="altar" src="assets/packs/altar.png" alt="" draggable="false">
          </div>
          @if (stage() === 'tear') { @for (s of sparks; track $index) { <i class="spark" [style.--dx]="s.dx + 'px'" [style.--dy]="s.dy + 'px'" [style.animation-delay]="s.delay + 'ms'" [style.width.px]="s.size" [style.height.px]="s.size"></i> } }
          @if (stage() === 'tierup') { <div class="banner">TIER UP! @for (i of range(tier()); track i) { <img [src]="skullIcon" alt=""> }</div> }
          @if (stage() === 'idle') { <div class="hint">TAP TO OPEN</div> }
        </div>
      }

      @if (stage() === 'fan') {
        <div class="stagebox"><div class="fan">
          @for (r of data().result.reveals; track $index) { <div class="cb" [style.--r]="rot($index) + 'deg'" [style.--c]="color(r.rarity)" [style.animation-delay]="$index * 70 + 'ms'" [style.background-image]="back"></div> }
        </div></div>
      }

      @if (stage() === 'reveal') {
        <div class="stagebox">
          <div class="pips">@for (r of data().result.reveals; track $index) { <i [class.on]="$index <= idx()"></i> }</div>
          @for (r of [cur()]; track idx()) {
            <div class="flipcard" [class.flipped]="flipped()" [style.--c]="color(r.rarity)">
              <div class="inner">
                <div class="face back" [style.background-image]="back"></div>
                <div class="face front" [style.--c]="color(r.rarity)" [class.epic]="r.rarity === 'epic'" [class.legend]="r.rarity === 'legendary'">
                  <div class="por" [class.art]="art(r.soul)" [style.background]="bg(r.soul)"><img [src]="icon(r.soul)" alt=""></div>
                  <div class="nm">{{ name(r.soul) }}</div><div class="rar" [style.color]="color(r.rarity)"><img class="gm" [src]="gem(r.rarity)" alt="">{{ rarityName(r.rarity) }}</div>
                  <div class="cnt">&times;{{ r.copies }}</div>
                </div>
              </div>
            </div>
          }
          <div class="lvrow" [style.visibility]="flipped() ? 'visible' : 'hidden'">
            <div class="lvbar" [class.ready]="readyNow()"><i [style.width.%]="barPct()"></i></div>
            <small>{{ readyNow() ? 'Ready to level up!' : lvText() }}</small>
          </div>
          <div class="hint">{{ flipped() ? (idx() + 1 >= data().result.reveals.length ? 'Tap for summary' : 'Tap for the next card') : 'Tap the card to flip it' }}</div>
        </div>
      }

      @if (stage() === 'summary') {
        <div class="summary" (click)="$event.stopPropagation()">
          <h2>Pack opened! <span class="sk">@for (i of range(data().result.finalTier); track i) { <img [src]="skullIcon" alt=""> }</span></h2>
          @if (data().result.upgrades.length) { <div class="up">Tier up! @for (i of range(data().result.startTier); track i) { <img [src]="skullIcon" alt=""> } &rarr; @for (i of range(data().result.finalTier); track i) { <img [src]="skullIcon" alt=""> }</div> }
          <div class="cards">
            @for (t of totals(); track t.soul; let i = $index) {
              <div class="mini" [style.--c]="color(t.rarity)" [style.animation-delay]="i * 80 + 'ms'">
                <div class="por" [class.art]="art(t.soul)" [style.background]="bg(t.soul)"><img [src]="icon(t.soul)" alt=""></div>
                <b>&times;{{ t.copies }}</b><span>{{ name(t.soul) }}</span>
                @if (t.ready) { <em>Ready to level!</em> }
              </div>
            }
          </div>
          <button class="go" style="font-size:1.1em;padding:.6em 2em" (click)="closed.emit()">Collect</button>
        </div>
      }
    </div>`,
})
export class PackOpen implements OnInit, OnDestroy {
  data = input.required<OpenData>();
  closed = output<void>();

  stage = signal<Stage>('idle');
  tier = signal(1);
  idx = signal(0);
  flipped = signal(false);
  barPct = signal(0);
  readyNow = signal(false);
  lvText = signal('');
  private timers: number[] = [];
  private running: Record<string, number> = {};
  sparks = Array.from({ length: 30 }, (_, i) => { const a = (i / 30) * Math.PI * 2 + Math.random() * 0.4, d = 90 + Math.random() * 150; return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d), delay: Math.round(Math.random() * 120), size: 4 + Math.round(Math.random() * 6) }; });

  showPack = computed(() => ['idle', 'charge', 'tierup', 'tear'].includes(this.stage()));
  cur = computed(() => this.data().result.reveals[this.idx()]);
  totals = computed(() => {
    const d = this.data(), m = new Map<SoulId, number>();
    for (const r of d.result.reveals) m.set(r.soul, (m.get(r.soul) ?? 0) + r.copies);
    return [...m.entries()].map(([soul, copies]) => ({ soul, copies, rarity: RARITY_OF[soul], ready: this.canLevel(soul, d.before[soul].copies + copies) }))
      .sort((a, b) => ['common', 'rare', 'epic', 'legendary'].indexOf(a.rarity) - ['common', 'rare', 'epic', 'legendary'].indexOf(b.rarity));
  });

  skullIcon = skullIcon; range = range; gem = gemIcon;
  icon = (s: SoulId) => soulArt(s); art = (s: SoulId) => hasArt(s); bg = (s: SoulId) => (hasArt(s) ? artBg(s) : BG[s]);
  back = 'url(assets/packs/cardback.png)';
  packImg = () => `assets/packs/pack_${this.tier()}.png`; name = (s: SoulId) => SOUL_NAME[s];
  color = (r: Rarity) => RARITY_COLOR[r]; rarityName = (r: Rarity) => RARITY_NAME[r];
  rot(i: number) { const n = this.data().result.reveals.length; return n <= 1 ? 0 : -30 + (60 * i) / (n - 1); }

  ngOnInit() { const d = this.data(); this.tier.set(d.result.startTier); for (const s of SOULS) this.running[s] = d.before[s].copies; }
  ngOnDestroy() { this.timers.forEach((t) => clearTimeout(t)); }

  private need(soul: SoulId) { return copiesNeeded(this.data().before[soul].level, soul); }
  private canLevel(soul: SoulId, copies: number) { const lv = this.data().before[soul].level; return !isMaxLevel(lv) && copies >= copiesNeeded(lv, soul); }
  private after(ms: number, fn: () => void) { this.timers.push(window.setTimeout(fn, ms)); }
  private sfx(name: string) { try { (window as any).__audio?.play(name); } catch { /* sound is optional */ } }
  private buzz(p: number | number[]) { try { navigator.vibrate?.(p); } catch { /* not supported (iPhone) */ } }

  tap() {
    const s = this.stage();
    if (s === 'idle') this.begin();
    else if (s === 'reveal') { if (this.flipped()) this.next(); else this.flip(); }
  }

  private begin() { this.stage.set('charge'); this.sfx('packCharge'); this.buzz(40); this.after(1100, () => this.upgradeStep(0)); }
  private upgradeStep(i: number) {
    const ups = this.data().result.upgrades;
    if (i >= ups.length) { this.tear(); return; }
    this.stage.set('tierup'); this.tier.set(ups[i]); this.sfx('packTierUp'); this.buzz([30, 40, 60]);
    this.after(1000, () => { this.stage.set('charge'); this.after(650, () => this.upgradeStep(i + 1)); });
  }
  private tear() {
    this.stage.set('tear'); this.sfx('packTear'); this.buzz([60, 30, 90]);
    this.after(850, () => { this.stage.set('fan'); this.sfx('packFan'); this.after(1000, () => { this.idx.set(0); this.flipped.set(false); this.stage.set('reveal'); }); });
  }
  private flip() {
    const r = this.cur(), need = this.need(r.soul), start = this.running[r.soul];
    const pct = (c: number) => (need > 0 ? Math.min(100, (100 * c) / need) : 100);
    this.barPct.set(pct(start)); this.readyNow.set(false); this.lvText.set(need > 0 ? `${Math.min(start, need)}/${need} copies` : 'Max level');
    this.flipped.set(true); this.running[r.soul] = start + r.copies;
    this.sfx(r.rarity === 'legendary' ? 'packLegend' : r.rarity === 'epic' ? 'packEpic' : r.rarity === 'rare' ? 'packRare' : 'packFlip');
    if (r.rarity === 'epic' || r.rarity === 'legendary') this.buzz([50, 30, 120]);
    this.after(400, () => { this.barPct.set(pct(this.running[r.soul])); this.lvText.set(need > 0 ? `${Math.min(this.running[r.soul], need)}/${need} copies` : 'Max level'); this.readyNow.set(this.canLevel(r.soul, this.running[r.soul])); });
  }
  private next() {
    if (this.idx() + 1 >= this.data().result.reveals.length) { this.stage.set('summary'); this.sfx('packCollect'); return; }
    this.idx.update((i) => i + 1); this.flipped.set(false);
  }
  skip(e: Event) { e.stopPropagation(); this.timers.forEach((t) => clearTimeout(t)); this.stage.set('summary'); this.sfx('packCollect'); }
}
