// Author the Stage 2 (Sunken Graveyard: crowds) and Stage 3 (Bone Bastion: heavy hitters) wave lists at the same Dominion cost as the lists they replace.
//   node sim/author_stages.ts     prints the strings to paste into core/waves.ts
import { COST } from '../core/data.ts';
import type { SoulId } from '../core/data.ts';
import { DIFFICULTY, waveCost } from '../core/waves.ts';
import { makeRng } from '../core/rng.ts';

const L: Record<SoulId, string> = { warrior: 'W', archer: 'A', goblin: 'G', knight: 'K', ogre: 'O', barbarian: 'B' };
const parse = (s: string) => s.split(' ').map((t) => ({ soul: Object.entries(L).find(([, l]) => l === t[0])![0] as SoulId, star: +t[1] }));
type Theme = { mix: [SoulId, number][]; max: number; anchor: SoulId[]; anchorFrom: number };
const THEMES: Record<string, Theme> = {
  swarm: { mix: [['warrior', 5], ['goblin', 3], ['archer', 2]], max: 12, anchor: ['knight', 'ogre'], anchorFrom: 3 },
  bulwark: { mix: [['knight', 3], ['ogre', 2], ['barbarian', 3], ['archer', 2]], max: 8, anchor: ['ogre', 'knight'], anchorFrom: 1 },
};
const ORDER: SoulId[] = ['knight', 'ogre', 'barbarian', 'warrior', 'goblin', 'archer'];
function make(theme: Theme, budget: number, wave: number, seed: number): string {
  const rng = makeRng(seed * 131 + wave * 17); const army: { soul: SoulId; star: number }[] = []; let left = budget;
  if (wave >= theme.anchorFrom && left >= 12) { const s = theme.anchor[rng.next() < 0.5 ? 0 : 1]; army.push({ soul: s, star: 1 }); left -= COST[s][0]; }
  const tot = theme.mix.reduce((a, [, w]) => a + w, 0);
  for (let g = 0; g < 200 && army.length < theme.max && left >= 2; g++) {
    let r = rng.next() * tot, soul = theme.mix[0][0]; for (const [s, w] of theme.mix) { r -= w; if (r <= 0) { soul = s; break; } }
    if (COST[soul][0] > left) { const c = theme.mix.map(([s]) => s).filter((s) => COST[s][0] <= left); if (!c.length) break; soul = c[Math.floor(rng.next() * c.length)]; }
    army.push({ soul, star: 1 }); left -= COST[soul][0];
  }
  // leftover budget upgrades stars (biggest step that fits)
  for (let g = 0; g < 60 && left > 0; g++) {
    const opts = army.filter((u) => u.star < 3 && COST[u.soul][u.star] - COST[u.soul][u.star - 1] <= left);
    if (!opts.length) break; const u = opts[Math.floor(rng.next() * opts.length)]; left -= COST[u.soul][u.star] - COST[u.soul][u.star - 1]; u.star++;
  }
  army.sort((a, b) => ORDER.indexOf(a.soul) - ORDER.indexOf(b.soul) || b.star - a.star);
  return army.map((u) => L[u.soul] + u.star).join(' ');
}
const stages: [string, string, Record<string, string>][] = [
  ['graveyard', 'swarm', { easy: 'normal', normal: 'hard', hard: 'nightmare', nightmare: 'nightmare' }],
  ['bastion', 'bulwark', { easy: 'hard', normal: 'nightmare', hard: 'nightmare', nightmare: 'nightmare' }],
];
for (const [id, tname, src] of stages) {
  console.log(`// ${id} (${tname})`);
  for (const d of ['easy', 'normal', 'hard', 'nightmare']) {
    const base = DIFFICULTY[src[d]]; const lists = base.map((b, i) => {
      // wave 1-2 keep the source army (a gentle start); later waves are re-built in the stage's style at the same cost
      const bc = waveCost(parse(b).map((e) => e)); return i < 2 ? b : make(THEMES[tname], bc, i + 1, (d.length * 7 + (id === 'bastion' ? 3 : 1)));
    });
    const bump = d === 'nightmare' && src[d] === 'nightmare' ? 1 : 0; void bump;
    console.log(`  ${d}: [${lists.map((s) => `'${s}'`).join(', ')}],`);
    console.log(`    costs ${lists.map((s) => waveCost(parse(s))).join(',')}  (source ${base.map((s) => waveCost(parse(s))).join(',')})`);
  }
}
