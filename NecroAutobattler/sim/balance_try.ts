// Try stat changes without editing the game files.  node sim/balance_try.ts '<json patch list>'
// Each patch: { name, patch: { "stats.archer.dmg": 10, "mana.archer.perAttack": 50, ... } }. Prints the mixed-army table for each.
import { BALANCE, resetBalance } from '../core/balance.ts';
import { COST, CURVES } from '../core/data.ts';
import type { SoulId } from '../core/data.ts';
import { Battle, enemyCells } from '../core/battle.ts';
import { enemyWave, setDifficulty } from '../core/waves.ts';

setDifficulty('nightmare');
const RUNS = 60;
const build = (mix: [SoulId, number][], cap: number, star = 1) => {
  const specs: { soul: SoulId; star: number }[] = [];
  for (const [soul, share] of mix) { const n = Math.floor((cap * share) / COST[soul][star - 1]); for (let i = 0; i < n; i++) if (specs.length < 12) specs.push({ soul, star }); }
  const cells = enemyCells(specs); return specs.map((s, i) => ({ ...s, cell: cells[i] }));
};
const rate = (mix: [SoulId, number][], wave: number, star = 1) => {
  const cap = CURVES.doc[wave - 1]; let win = 0;
  for (let i = 0; i < RUNS; i++) { const b = new Battle(build(mix, cap, star), enemyWave(wave, 1), 300 + i); while (b.winner < 0 && b.time < 130) b.step(1 / 30); if (b.winner === 0) win++; }
  return Math.round((100 * win) / RUNS);
};
const set = (path: string, v: number) => { const p = path.split('.'); let o: any = BALANCE; for (let i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = v; };
const CASES: [string, [SoulId, number][], number][] = [
  ['warrior only', [['warrior', 1]], 1], ['warrior only 2*', [['warrior', 1]], 2], ['knight only', [['knight', 1]], 1], ['knight 60 + archer 40', [['knight', 0.6], ['archer', 0.4]], 1],
  ['ogre 60 + archer 40', [['ogre', 0.6], ['archer', 0.4]], 1], ['knight 60 + barb 40', [['knight', 0.6], ['barbarian', 0.4]], 1], ['archer only', [['archer', 1]], 1],
];
const LIST: { name: string; patch: Record<string, number> }[] = JSON.parse(process.argv[2] || '[{"name":"current","patch":{}}]');
for (const { name, patch } of LIST) {
  resetBalance(); for (const [k, v] of Object.entries(patch)) set(k, v);
  console.log('== ' + name + '  ' + JSON.stringify(patch));
  for (const [label, mix, star] of CASES) console.log('  ' + label.padEnd(24), [4, 5, 6, 7, 8].map((w) => (rate(mix, w, star) + '%').padStart(6)).join(''));
}
