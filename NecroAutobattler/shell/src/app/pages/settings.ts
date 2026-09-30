import { Component, OnDestroy, inject, signal } from '@angular/core';
import { STAGES } from '../../../../core/waves.ts';
import { SaveService } from '../save.service';
import { Tutorial } from '../tutorial';

@Component({
  selector: 'app-settings',
  styles: [`
    :host { display:block; font-size:clamp(11px,1.9vmin,14px); }
    h1 { margin:0 0 clamp(6px,1.6vh,12px); }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:clamp(6px,1.4vmin,12px); }
    .tile { display:flex; align-items:center; gap:8px; padding:clamp(7px,1.8vh,12px) clamp(8px,1.6vmin,14px); border-radius:12px; background:rgba(20,14,30,.88); border:2px solid #4a2f74; min-width:0; }
    .tile b { flex:1; min-width:0; font-size:1.02em; line-height:1.15; } .tile .ic { width:clamp(22px,4.4vmin,32px); height:clamp(22px,4.4vmin,32px); flex:none; }
    .i { flex:none; width:1.7em; height:1.7em; padding:0; border-radius:50%; background:#2b1c44; border:1.5px solid #8f6fd0; color:#cbb8f5; font-style:italic; font-weight:800; font-size:.95em; line-height:1; }
    .sm { padding:.35em .8em; font-size:.95em; }
    .pop { margin:clamp(6px,1.4vh,10px) 0 0; padding:8px 12px; border-radius:12px; background:#1d1432; border:2px solid var(--go-hi,#7ef2c8); line-height:1.35; cursor:pointer; } .pop .x { float:right; opacity:.6; text-decoration:underline; margin-left:10px; }
    .dev { margin-top:clamp(8px,2vh,16px); padding:clamp(6px,1.4vh,10px) clamp(8px,1.6vmin,14px); } .devh { display:flex; align-items:center; gap:8px; margin-bottom:6px; } .devh b { flex:1; } .devh .ic { width:24px; height:24px; }
    .devb { display:flex; flex-wrap:wrap; gap:6px; } .devb button { padding:.35em .8em; font-size:.95em; }
    .sw { position:relative; width:46px; height:26px; padding:0; border-radius:13px; background:#3a3550; border:2px solid #6a6390; flex:none; }
    .sw::after { content:''; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#ddd; transition:left .15s; }
    .sw.on { background:var(--go); border-color:var(--go-hi); } .sw.on::after { left:22px; background:#fff; }
    @media (max-width:700px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  `],
  template: `
    <h1>Settings</h1>
    <div class="grid">
      <div class="tile"><img class="ic" src="assets/icons/music.png" alt=""><b>Music</b><button class="i" (click)="info('music')" aria-label="About music">i</button>
        <button class="sw" [class.on]="save.settings().music" role="switch" [attr.aria-checked]="save.settings().music" (click)="save.setSound('music', !save.settings().music)"></button></div>
      <div class="tile"><img class="ic" src="assets/icons/sound_on.png" alt=""><b>Sound effects</b><button class="i" (click)="info('sfx')" aria-label="About sound effects">i</button>
        <button class="sw" [class.on]="save.settings().sfx" role="switch" [attr.aria-checked]="save.settings().sfx" (click)="save.setSound('sfx', !save.settings().sfx)"></button></div>
      <div class="tile"><img class="ic" src="assets/icons/info.png" alt=""><b>Sound check</b><button class="i" (click)="info('check')" aria-label="About the sound check">i</button>
        <button class="go sm" (click)="test(); info('check')">Test</button></div>
      <div class="tile"><img class="ic" src="assets/icons/info.png" alt=""><b>How to play</b><button class="i" (click)="info('tut')" aria-label="About the tutorial">i</button>
        <button class="go sm" (click)="replayTut()">Replay</button></div>
    </div>
    @if (open()) { <div class="pop" (click)="open.set('')"><b>{{ titles[open()] }}</b> {{ open() === 'check' ? msg() : tips[open()] }} <span class="x">close</span></div> }
    <div class="box dev"><div class="devh"><img class="ic" src="assets/icons/settings.png" alt=""><b>Testing helpers</b><button class="i" (click)="info('dev')" aria-label="About the testing helpers">i</button></div>
      <div class="devb"><button class="go" (click)="save.grantTestPack(1)">+ Tier 1 pack</button><button class="go" (click)="save.grantTestPack(2)">+ Tier 2 pack</button><button class="go" (click)="save.grantTestPack(3)">+ Tier 3 pack</button><button class="blue" (click)="save.grantTestCopies(20)">+20 copies each</button><button class="blue" (click)="unlockAll()">Unlock all stages</button><button class="blue" (click)="askReset('levels')">{{ armed() === 'levels' ? 'Tap again to confirm' : 'Reset Souls to level 1' }}</button><button class="blue" (click)="askReset('copies')">{{ armed() === 'copies' ? 'Tap again to confirm' : 'Clear all copies' }}</button>
      </div></div>
`,
})
export class Settings implements OnDestroy {
  save = inject(SaveService);
  tut = inject(Tutorial);
  msg = signal('checking…');
  open = signal('');
  titles: Record<string, string> = { music: 'Music.', sfx: 'Sound effects.', check: 'Sound check.', tut: 'How to play.', dev: 'Testing helpers.' };
  tips: Record<string, string> = { music: 'Ambient score, more intense in battle.', sfx: 'Hits, spells, summoning, merging.', check: '', tut: 'Replays the guided walkthrough of your first battle. Skip it any time. There is no free pack the second time.', dev: 'Add packs or copies to try the opening and levelling without playing a stage.' };
  info(k: string) { this.open.set(this.open() === k ? '' : k); }
  private timer = window.setInterval(() => this.refresh(), 500);
  constructor() { this.refresh(); }
  ngOnDestroy() { clearInterval(this.timer); }
  replayTut() { this.tut.replay(); location.hash = '#/home'; }
  private get audio(): any { return (window as any).__audio; }
  private refresh() {
    const a = this.audio; if (!a) { this.msg.set('Still loading…'); return; }
    const st = a.status();
    this.msg.set(st.unlocked ? 'Sound is running. If you still hear nothing, raise the volume and check the silent switch.' : st.state === 'not started' ? 'Not started yet: tap Test sound.' : 'The phone paused sound (' + st.state + '): tap Test sound to wake it.');
  }
  /** Debugging: put every Soul back to level 1, or clear all copies. Needs a second tap within 3 seconds. */
  armed = signal<'' | 'levels' | 'copies'>('');
  private armT = 0;
  askReset(what: 'levels' | 'copies') {
    if (this.armed() !== what) { this.armed.set(what); clearTimeout(this.armT); this.armT = window.setTimeout(() => this.armed.set(''), 3000); return; }
    clearTimeout(this.armT); this.armed.set('');
    if (what === 'levels') this.save.resetLevels(); else this.save.clearCopies();
  }
  /** Testing helper: mark every stage's Normal and Hard as cleared so all stages and tiers open. */
  unlockAll() { for (const st of STAGES) { this.save.grantTestClear(st.id, 'normal'); this.save.grantTestClear(st.id, 'hard'); } }
  test() { const a = this.audio; if (a) { a.test(); setTimeout(() => this.refresh(), 300); } }
}
