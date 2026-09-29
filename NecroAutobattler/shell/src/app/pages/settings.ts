import { Component, OnDestroy, inject, signal } from '@angular/core';
import { STAGES } from '../../../../core/waves.ts';
import { SaveService } from '../save.service';

@Component({
  selector: 'app-settings',
  styles: [`
    :host { display:block; font-size:clamp(11px,1.9vmin,14px); }
    .row { display:flex; align-items:center; gap:12px; max-width:440px; margin-bottom:10px; padding:10px 14px; }
    .row b { display:block; font-size:1.1em; } .row span { opacity:.7; font-size:.9em; } .grow { flex:1; }
    .sw { position:relative; width:52px; height:28px; padding:0; border-radius:14px; background:#3a3550; border:2px solid #6a6390; flex:none; }
    .sw::after { content:''; position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#ddd; transition:left .15s; }
    .sw.on { background:var(--go); border-color:var(--go-hi); } .sw.on::after { left:26px; background:#fff; }
  `],
  template: `
    <h1>Settings</h1>
    <p class="lead">Sound is made in the game itself, so there are no audio files to download. Your choices are saved on this device.</p>
    <div class="box row"><img class="ic" style="width:34px;height:34px" src="assets/icons/music.png" alt=""><div class="grow"><b>Music</b><span>Ambient score, more intense in battle</span></div>
      <button class="sw" [class.on]="save.settings().music" role="switch" [attr.aria-checked]="save.settings().music" (click)="save.setSound('music', !save.settings().music)"></button></div>
    <div class="box row"><img class="ic" style="width:34px;height:34px" src="assets/icons/sound_on.png" alt=""><div class="grow"><b>Sound effects</b><span>Hits, spells, summoning, merging</span></div>
      <button class="sw" [class.on]="save.settings().sfx" role="switch" [attr.aria-checked]="save.settings().sfx" (click)="save.setSound('sfx', !save.settings().sfx)"></button></div>
    <div class="box row"><img class="ic" style="width:34px;height:34px" src="assets/icons/info.png" alt=""><div class="grow"><b>Sound check</b><span>{{ msg() }}</span></div>
      <button class="go" (click)="test()">Test sound</button></div>
    <div class="box row" style="flex-wrap:wrap"><img class="ic" style="width:34px;height:34px" src="assets/icons/settings.png" alt=""><div class="grow"><b>Testing helpers</b><span>Add packs to your Shop, or copies to every Soul, to try the opening and levelling without playing a whole stage.</span></div>
      <button class="go" (click)="save.grantTestPack(1)">+ Tier 1 pack</button><button class="go" (click)="save.grantTestPack(2)">+ Tier 2 pack</button><button class="go" (click)="save.grantTestPack(3)">+ Tier 3 pack</button><button class="blue" (click)="save.grantTestCopies(20)">+20 copies each</button><button class="blue" (click)="unlockAll()">Unlock all stages</button></div>
    <p class="lead" style="margin-top:14px">The battle screen also has quick music and sound-effect buttons next to the gear.</p>`,
})
export class Settings implements OnDestroy {
  save = inject(SaveService);
  msg = signal('checking…');
  private timer = window.setInterval(() => this.refresh(), 500);
  constructor() { this.refresh(); }
  ngOnDestroy() { clearInterval(this.timer); }
  private get audio(): any { return (window as any).__audio; }
  private refresh() {
    const a = this.audio; if (!a) { this.msg.set('Still loading…'); return; }
    const st = a.status();
    this.msg.set(st.unlocked ? 'Sound is running. If you still hear nothing, raise the volume and check the silent switch.' : st.state === 'not started' ? 'Not started yet: tap Test sound.' : 'The phone paused sound (' + st.state + '): tap Test sound to wake it.');
  }
  /** Testing helper: mark every stage's Normal and Hard as cleared so all stages and tiers open. */
  unlockAll() { for (const st of STAGES) { this.save.grantTestClear(st.id, 'normal'); this.save.grantTestClear(st.id, 'hard'); } }
  test() { const a = this.audio; if (a) { a.test(); setTimeout(() => this.refresh(), 300); } }
}
