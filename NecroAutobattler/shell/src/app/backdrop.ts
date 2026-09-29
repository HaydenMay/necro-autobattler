import { Component, computed, inject, input } from '@angular/core';
import { SaveService } from './save.service';
import { MOOD, lookOf } from './stage-look';

/**
 * The picture behind every page: the arena in the colour of the stage you are on, with slow mist and a vignette.
 * Home shows it at full strength; the other pages use "calm" (fainter, no second mist layer) so lists and text stay easy to read.
 */
@Component({
  selector: 'app-backdrop',
  styles: [`
    .bd { position:fixed; inset:0; z-index:1; overflow:hidden; background:#04070a; pointer-events:none; }
    .bdimg { position:absolute; inset:-3%; background-size:cover; opacity:.55; transition:opacity .4s, filter .6s, background-position .6s; }
    .fog { position:absolute; inset:-25%; opacity:.4; animation:drift 46s ease-in-out infinite alternate; background:radial-gradient(ellipse 40% 30% at 25% 70%, var(--fog), transparent 70%), radial-gradient(ellipse 35% 28% at 78% 55%, var(--fog), transparent 70%); }
    .fog.f2 { opacity:.28; animation-duration:64s; animation-direction:alternate-reverse; background:radial-gradient(ellipse 45% 25% at 60% 85%, var(--fog), transparent 70%), radial-gradient(ellipse 30% 30% at 15% 40%, var(--fog), transparent 70%); }
    @keyframes drift { from { transform:translate3d(-5%,0,0) scale(1); } to { transform:translate3d(5%,-3%,0) scale(1.08); } }
    .vig { position:absolute; inset:0; background:radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(2,5,8,.88) 100%); }
    .calm .bdimg { opacity:.24; } .calm .fog { opacity:.16; animation-duration:80s; } .calm .fog.f2 { display:none; }
    .calm .vig { background:radial-gradient(ellipse at 50% 45%, rgba(2,5,8,.3) 15%, rgba(2,5,8,.9) 100%); }
  `],
  template: `
    <div class="bd" [class.calm]="calm()" [style.--fog]="look().fog">
      <div class="bdimg" [style.background-image]="mood" [style.background-position]="look().pos" [style.filter]="'hue-rotate(' + look().hue + 'deg) saturate(1.15) brightness(.8)'"></div>
      <div class="fog"></div><div class="fog f2"></div><div class="vig"></div>
    </div>`,
})
export class Backdrop {
  calm = input(false);
  private save = inject(SaveService);
  mood = MOOD;
  look = computed(() => lookOf(this.save.stage()));
}
