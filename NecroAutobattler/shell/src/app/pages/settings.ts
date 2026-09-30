import { Component, OnDestroy, inject, signal } from '@angular/core';
import { STAGES } from '../../../../core/waves.ts';
import { SaveService } from '../save.service';
import { Tutorial } from '../tutorial';

@Component({
  selector: 'app-settings',
  styles: [`
    :host { display:block; font-size:clamp(11px,1.9vmin,14px); }
    .cols { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:0 clamp(10px,2.4vmin,20px); align-items:start; } .col { display:contents; }
    .row { display:flex; align-items:center; gap:12px; margin-bottom:clamp(6px,1.4vh,10px); padding:clamp(6px,1.6vh,10px) 14px; }
    .row b { display:block; font-size:1.1em; } .row span { opacity:.7; font-size:.9em; } .grow { flex:1 1 60%; }
    .sw { position:relative; width:52px; height:28px; padding:0; border-radius:14px; background:#3a3550; border:2px solid #6a6390; flex:none; }
    .sw::after { content:''; position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#ddd; transition:left .15s; }
    .sw.on { background:var(--go); border-color:var(--go-hi); } .sw.on::after { left:26px; background:#fff; }
  `],
  template: `
    <h1>Settings</h1>
    <p class="lead">Your choices are saved on this device.</p>
    <div class="cols"><div class="col">
    <div class="box row"><img class="ic" style="width:34px;height:34px" src="assets/icons/music.png" alt=""><div class="grow"><b>Music</b><span>Ambient score, more intense in battle</span></div>
      <button class="sw" [class.on]="save.settings().music" role="switch" [attr.aria-checked]="save.settings().music" (click)="save.setSound('music', !save.settings().music)"></button></div>
    <div class="box row"><img class="ic" style="width:34px;height:34px" src="assets/icons/sound_on.png" alt=""><div class="grow"><b>Sound effects</b><span>Hits, spells, summoning, merging</span></div>
      <button class="sw" [class.on]="save.settings().sfx" role="switch" [attr.aria-checked]="save.settings().sfx" (click)="save.setSound('sfx', !save.settings().sfx)"></button></div>
    <div class="box row"><img class="ic" style="width:34px;height:34px" src="assets/icons/info.png" alt=""><div class="grow"><b>How to play</b><span>A guided walkthrough of your first battle. Skip it any time. No free pack the second time</span></div>
      <button class="go" (click)="replayTut()">Replay</button></div>
    <div class="box row"><img class="ic" style="width:34px;height:34px" src="assets/icons/info.png" alt=""><div class="grow"><b>Sound check</b><span>{{ msg() }}</span></div>
      <button class="go" (click)="test()">Test sound</button></div>
    </div><div class="col">
    <div class="box row" style="flex-wrap:wrap;grid-column:1/-1"><img class="ic" style="width:34px;height:34px" src="assets/icons/settings.png" alt=""><div class="grow"><b>Testing helpers</b><span>Add packs or copies to try the opening and levelling without playing a stage.</span></div>
      <button class="go" (click)="save.grantTestPack(1)">+ Tier 1 pack</button><button class="go" (click)="save.grantTestPack(2)">+ Tier 2 pack</button><button class="go" (click)="save.grantTestPack(3)">+ Tier 3 pack</button><button class="blue" (click)="save.grantTestCopies(20)">+20 copies each</button><button class="blue" (click)="unlockAll()">Unlock all stages</button><button class="blue" (click)="askReset('levels')">{{ armed() === 'levels' ? 'Tap again to confirm' : 'Reset Souls to level 1' }}</button><button class="blue" (click)="askReset('copies')">{{ armed() === 'copies' ? 'Tap again to confirm' : 'Clear all copies' }}</button></div>
    </div></div>
`,
})
export class Settings implements OnDestroy {
  save = inject(SaveService);
  tut = inject(Tutorial);
  msg = signal('checking…');
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
