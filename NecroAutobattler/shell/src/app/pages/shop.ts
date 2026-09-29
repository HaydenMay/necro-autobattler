import { Component } from '@angular/core';

@Component({
  selector: 'app-shop',
  template: `
    <h1>Shop</h1>
    <p class="lead">Soul Packs give permanent copies of Souls; enough copies of one Soul level it up. Nothing here works yet: the pack numbers still need a progression simulation before they are set.</p>
    <div class="grid" style="max-width:760px">
      @for (p of packs; track p.name) {
        <div class="box"><div class="row2"><span style="font-size:30px">{{ p.icon }}</span><b>{{ p.name }}</b><span class="tag soon">coming</span></div>
          <div style="font-size:12px;margin:6px 0">{{ p.text }}</div><span class="btn off">Open</span></div>
      }
    </div>`,
})
export class Shop {
  packs = [
    { icon: '\u{1F4E6}', name: 'Bone Pack', text: 'Common pack. A few Souls, often in larger stacks (e.g. Skeleton Warrior ×8).' },
    { icon: '\u{1F381}', name: 'Crypt Pack', text: 'Better odds of rarer Souls. A tier upgrade can happen during the opening.' },
    { icon: '\u{1F3C6}', name: 'First-Clear Reward', text: 'One-time improved pack for the first clear of a stage. Bosses guarantee a higher tier.' },
  ];
}
