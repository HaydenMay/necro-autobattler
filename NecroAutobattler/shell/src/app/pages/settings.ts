import { Component, inject } from '@angular/core';
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
    <div class="box row"><span style="font-size:26px">&#127925;</span><div class="grow"><b>Music</b><span>Ambient score, more intense in battle</span></div>
      <button class="sw" [class.on]="save.settings().music" role="switch" [attr.aria-checked]="save.settings().music" (click)="save.setSound('music', !save.settings().music)"></button></div>
    <div class="box row"><span style="font-size:26px">&#128266;</span><div class="grow"><b>Sound effects</b><span>Hits, spells, summoning, merging</span></div>
      <button class="sw" [class.on]="save.settings().sfx" role="switch" [attr.aria-checked]="save.settings().sfx" (click)="save.setSound('sfx', !save.settings().sfx)"></button></div>
    <p class="lead" style="margin-top:14px">The battle screen also has quick 🎵 / 🔊 buttons next to the gear.</p>`,
})
export class Settings { save = inject(SaveService); }
