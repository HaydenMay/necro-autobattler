import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SOULS } from '../../../../core/data.ts';
import type { SoulId } from '../../../../core/data.ts';
import { SOUL_NAME } from '../../../../core/balance.ts';
import { PROTOTYPE_RULES } from '../../../../core/prototype.ts';
import { GameLink } from '../game-link.service';
import { SaveService } from '../save.service';

const ICON: Record<SoulId, string> = { warrior: '\u{1F480}', archer: '\u{1F3F9}', goblin: '\u{1F5E1}️', knight: '\u{1F6E1}️', ogre: '\u{1F528}', barbarian: '\u{1FA93}' };

/** Home: the campaign path, your deck, and the one big button. The fight itself opens full-screen from here. */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
  styles: [`
    :host { display:flex; align-items:center; justify-content:center; min-height:100%; font-size:clamp(11px,1.9vmin,14px); }
    .wrap { width:100%; display:grid; grid-template-columns:minmax(0,1.7fr) minmax(0,1fr); gap:clamp(8px,2vmin,18px); max-width:960px; }
    .stage { padding:clamp(10px,2.4vmin,20px); background:linear-gradient(160deg,rgba(60,28,100,.9),rgba(20,14,30,.92)); }
    .stage h2 { margin:0; font-size:1.7em; color:var(--gold); } .sub { opacity:.75; margin-bottom:clamp(8px,2vmin,16px); }
    .path { display:flex; align-items:center; margin:clamp(8px,2vmin,18px) 0; }
    .pip { position:relative; flex:none; width:clamp(20px,4vmin,30px); height:clamp(20px,4vmin,30px); border-radius:50%; background:#2b1c44; border:2px solid #6b46a3; display:flex; align-items:center; justify-content:center; font-size:.8em; font-weight:800; }
    .pip.done { background:#5a2fa0; border-color:#a45bff; } .pip.now { background:var(--go); border-color:var(--go-hi); color:var(--go-ink); box-shadow:0 0 12px var(--go); } .pip.boss { width:clamp(26px,5vmin,38px); height:clamp(26px,5vmin,38px); border-color:#ff7a7a; }
    .link { flex:1; height:3px; background:#3a2a5a; min-width:6px; } .link.done { background:#a45bff; }
    .deck { display:flex; align-items:center; gap:8px; margin:clamp(6px,1.6vmin,12px) 0; flex-wrap:wrap; }
    .ic { display:inline-flex; width:clamp(24px,4.6vmin,34px); height:clamp(24px,4.6vmin,34px); align-items:center; justify-content:center; border-radius:8px; background:#2b1c44; border:1px solid #6b46a3; font-size:1.3em; }
    .ic.empty { border-style:dashed; opacity:.5; }
    .deck a { color:#8fb0f0; }
    .warn { color:#ff9a90; font-weight:700; }
    .acts { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .big { padding:.7em 2.2em; font-size:1.5em; letter-spacing:.06em; box-shadow:0 0 18px rgba(47,217,166,.5); border-radius:12px; border:1px solid var(--go-hi); background:linear-gradient(var(--go),var(--go-lo)); color:var(--go-ink); font-weight:900; cursor:pointer; }
    .big[disabled] { opacity:.4; box-shadow:none; cursor:default; }
    .blue { background:#3b78d8; border-color:#9cc0ff; }
    .locked { display:flex; flex-direction:column; gap:8px; } .locked .box { opacity:.55; } .locked b { font-size:1.1em; }
    @media (max-width:640px) { .wrap { grid-template-columns:1fr; } .locked { flex-direction:row; } .locked .box { flex:1; } }
  `],
  template: `
    <div class="wrap">
      <div class="box stage">
        <h2>The Restless Crypt</h2><div class="sub">Stage 1 &middot; {{ total }} waves &middot; raise your army, clear the crypt</div>
        <div class="path">
          @for (w of waves; track w) {
            @if (w > 1) { <span class="link" [class.done]="w <= current()"></span> }
            <span class="pip" [class.done]="w < current()" [class.now]="w === current()" [class.boss]="w === total">{{ w === total ? '&#9760;' : w }}</span>
          }
        </div>
        <div class="deck">
          <span class="muted">Deck</span>
          @for (s of deckSlots(); track $index) { <span class="ic" [class.empty]="!s" [title]="s ? name(s) : 'empty slot'">{{ s ? icon(s) : '+' }}</span> }
          <a routerLink="/souls" class="muted" style="margin-left:4px">change</a>
          @if (!deckOk()) { <span class="warn">Equip {{ save.deckSize }} Souls to start ({{ save.deck().length }}/{{ save.deckSize }})</span> }
        </div>
        <div class="acts">
          @if (run(); as r) {
            <button class="big" (click)="resume()">Continue <small style="font-size:.5em;letter-spacing:0">Wave {{ r.wave }}/{{ r.total }} &middot; {{ hearts(r.hearts) }}</small></button>
            <button class="blue" (click)="confirmRestart()">{{ confirming() ? 'Tap again to abandon run' : 'Start over' }}</button>
          } @else {
            <button class="big" [disabled]="!link.ready() || !deckOk()" (click)="start()">{{ link.ready() ? 'Start Battle' : 'Loading army…' }}</button>
          }
        </div>
      </div>
      <div class="locked">
        @for (n of [2, 3, 4]; track n) { <div class="box"><b>Stage {{ n }}</b> <span class="tag soon">locked</span><div style="font-size:.9em;margin-top:3px">Later stages, bosses and first-clear Soul Packs.</div></div> }
      </div>
    </div>`,
})
export class Home {
  private router = inject(Router);
  save = inject(SaveService);
  link = inject(GameLink);
  total = PROTOTYPE_RULES.stageWaves ?? 10;
  waves = Array.from({ length: this.total }, (_, i) => i + 1);
  confirming = signal(false);
  private tick = signal(0);
  run = computed(() => { this.tick(); return this.link.runInfo(); });
  current = computed(() => this.run()?.wave ?? 1);
  deckSlots = computed(() => Array.from({ length: this.save.deckSize }, (_, i) => this.save.deck()[i] ?? null));
  deckOk = computed(() => this.save.deck().length === this.save.deckSize);
  icon = (s: SoulId) => ICON[s]; name = (s: SoulId) => SOUL_NAME[s];
  hearts = (n: number) => '❤️'.repeat(n) + '\u{1F5A4}'.repeat(Math.max(0, 3 - n));

  start() { if (!this.deckOk() || !this.link.ready()) return; this.link.newRun(); this.router.navigateByUrl('/run'); }
  resume() { this.router.navigateByUrl('/run'); }
  confirmRestart() {
    if (!this.confirming()) { this.confirming.set(true); setTimeout(() => this.confirming.set(false), 3000); return; }
    if (!this.deckOk()) { this.confirming.set(false); return; }
    this.link.newRun(); this.router.navigateByUrl('/run');
  }
}
