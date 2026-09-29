import { Component } from '@angular/core';
import { SOULS, COST } from '../../../../core/data.ts';
import type { SoulId } from '../../../../core/data.ts';
import { BALANCE, ROLE_TEXT, SOUL_NAME } from '../../../../core/balance.ts';

const ICON: Record<SoulId, string> = { warrior: '\u{1F480}', archer: '\u{1F3F9}', goblin: '\u{1F5E1}️', knight: '\u{1F6E1}️', ogre: '\u{1F528}', barbarian: '\u{1FA93}' };
const PASSIVE: Record<SoulId, string> = { warrior: 'Phalanx', archer: '', goblin: 'Opportunist', knight: '', ogre: '', barbarian: 'Frenzy' };
const SKILL: Record<SoulId, string> = { warrior: '', archer: 'Split Arrow', goblin: '', knight: 'Taunt', ogre: 'Smash', barbarian: '' };

@Component({
  selector: 'app-souls',
  template: `
    <h1>Souls</h1>
    <p class="lead">Your roster. Levels and copy counts are placeholders until the pack system exists. Stats come live from the same balance file the battles use.</p>
    <div class="grid">
      @for (s of souls; track s.id) {
        <div class="box">
          <div class="row2"><span style="font-size:34px">{{ s.icon }}</span>
            <div><b>{{ s.name }}</b><div class="muted" style="font-size:11px">LV 1 &middot; 0 copies (placeholder)</div></div></div>
          <div style="margin:6px 0">
            @if (s.skill) { <span class="tag skill">Skill: {{ s.skill }}</span> }
            @if (s.passive) { <span class="tag passive">Passive: {{ s.passive }}</span> }
          </div>
          <div style="font-size:12px;opacity:.9">{{ s.role }}</div>
          <table style="margin-top:8px;font-size:11.5px;width:100%">
            <tr><td class="muted">Health</td><td>{{ s.hp }}</td><td class="muted">Damage</td><td>{{ s.dmg }}</td></tr>
            <tr><td class="muted">Attack every</td><td>{{ s.interval }}s</td><td class="muted">Range</td><td>{{ s.range }}m</td></tr>
            <tr><td class="muted">Dominion</td><td colspan="3">{{ s.cost }}</td></tr>
          </table>
        </div>
      }
    </div>
    <div class="box" style="margin-top:14px"><b>Soul Deck</b> <span class="tag soon">coming next</span>
      <div class="lead" style="margin:4px 0 0">Equip six Souls for a stage. Each run will draw only from the Souls you equipped.</div></div>`,
})
export class Souls {
  souls = SOULS.map((id) => {
    const st = BALANCE.stats[id];
    return { id, icon: ICON[id], name: SOUL_NAME[id], role: ROLE_TEXT[id], skill: SKILL[id], passive: PASSIVE[id],
      hp: st.hp, dmg: st.dmg, interval: st.interval, range: st.range, cost: COST[id].join(' / ') + ' (1★/2★/3★)' };
  });
}
