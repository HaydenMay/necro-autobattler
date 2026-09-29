// How strong is each Soul for its Dominion cost?  node sim/soul_power.ts [difficulty]
// Mono-Soul armies (as many 1-star units as fit the cap, at most 12) fight the real enemy waves. Win rate shows which Souls carry and which lag.
import { COST, SOULS } from '../core/data.ts';
import type { SoulId } from '../core/data.ts';
import { CURVES } from '../core/data.ts';
import { Battle, enemyCells } from '../core/battle.ts';
import { enemyWave, setDifficulty } from '../core/waves.ts';

const diff = process.argv[2] || 'nightmare'; setDifficulty(diff);
const RUNS = 60;
function army(soul: SoulId, star: number, cap: number) {
  const n = Math.min(12, Math.floor(cap / COST[soul][star - 1]));
  const specs = Array.from({ length: n }, () => ({ soul, star }));
  const cells = enemyCells(specs);                    // same "tanks up front" layout logic the enemy uses
  return specs.map((s, i) => ({ ...s, cell: cells[i] }));
}
function winRate(soul: SoulId, star: number, wave: number) {
  const cap = CURVES.doc[wave - 1]; let win = 0, hp = 0;
  for (let i = 0; i < RUNS; i++) {
    const b = new Battle(army(soul, star, cap), enemyWave(wave, 1), 100 + i);
    while (b.winner < 0 && b.time < 130) b.step(1 / 30);
    if (b.winner === 0) { win++; hp += b.fighters.filter((f) => f.alive && f.team === 0).reduce((n, f) => n + f.hp / f.maxHp, 0); }
  }
  return { win: Math.round((100 * win) / RUNS), units: army(soul, star, cap).length };
}
console.log('difficulty', diff, '| mono-Soul armies filling the Dominion cap, win % against the real enemy wave');
console.log('soul'.padEnd(10), 'star', [3, 5, 7, 10].map((w) => ('w' + w).padStart(9)).join(''));
for (const soul of SOULS) for (const star of [1, 2]) {
  console.log(soul.padEnd(10), String(star).padEnd(4), [3, 5, 7, 10].map((w) => { const r = winRate(soul, star, w); return (r.win + '% x' + r.units).padStart(9); }).join(''));
}
