// Does a support Soul add value when paired with a front line?  node sim/soul_mix.ts [difficulty]
// Same total Dominion each time: X% front-liner + (100-X)% partner, versus 100% front-liner. All 1-star, real enemy waves.
import { COST, CURVES } from '../core/data.ts';
import type { SoulId } from '../core/data.ts';
import { Battle, enemyCells } from '../core/battle.ts';
import { enemyWave, setDifficulty } from '../core/waves.ts';

setDifficulty(process.argv[2] || 'nightmare');
const RUNS = 80;
function build(mix: [SoulId, number][], cap: number) {
  const specs: { soul: SoulId; star: number }[] = [];
  for (const [soul, share] of mix) { const n = Math.floor((cap * share) / COST[soul][0]); for (let i = 0; i < n; i++) if (specs.length < 12) specs.push({ soul, star: 1 }); }
  const cells = enemyCells(specs); return specs.map((s, i) => ({ ...s, cell: cells[i] }));
}
function rate(mix: [SoulId, number][], wave: number) {
  const cap = CURVES.doc[wave - 1]; let win = 0;
  for (let i = 0; i < RUNS; i++) { const b = new Battle(build(mix, cap), enemyWave(wave, 1), 300 + i); while (b.winner < 0 && b.time < 130) b.step(1 / 30); if (b.winner === 0) win++; }
  return Math.round((100 * win) / RUNS);
}
const CASES: [string, [SoulId, number][]][] = [
  ['knight only', [['knight', 1]]],
  ['knight 60 + archer 40', [['knight', 0.6], ['archer', 0.4]]],
  ['knight 60 + barbarian 40', [['knight', 0.6], ['barbarian', 0.4]]],
  ['knight 60 + goblin 40', [['knight', 0.6], ['goblin', 0.4]]],
  ['knight 60 + warrior 40', [['knight', 0.6], ['warrior', 0.4]]],
  ['warrior only', [['warrior', 1]]],
  ['warrior 60 + archer 40', [['warrior', 0.6], ['archer', 0.4]]],
  ['ogre only', [['ogre', 1]]],
  ['ogre 60 + archer 40', [['ogre', 0.6], ['archer', 0.4]]],
  ['barbarian only', [['barbarian', 1]]],
  ['archer only', [['archer', 1]]],
];
console.log('win %'.padEnd(28), [4, 5, 6, 7, 8].map((w) => ('w' + w).padStart(6)).join(''));
for (const [name, mix] of CASES) console.log(name.padEnd(28), [4, 5, 6, 7, 8].map((w) => (rate(mix, w) + '%').padStart(6)).join(''));
