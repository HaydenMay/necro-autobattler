// How far do fighters get SHOVED while they are standing and fighting?   node sim/slide_check.ts
// A "planted" fighter is one that is not walking (attacking, or waiting for its next swing). Any distance it travels is a shove, not a plan.
// We report the average and the worst shove per planted fighter, for a few Knight / Ogre heavy fights.
import { Battle, enemyCells } from '../core/battle.ts';
import { setStageDifficulty } from '../core/waves.ts';
import { enemyWave } from '../core/waves.ts';
import type { SoulId } from '../core/data.ts';

setStageDifficulty('crypt', 'nightmare');
const armies: [string, SoulId[]][] = [
  ['knights + ogres', ['knight', 'knight', 'ogre', 'ogre', 'warrior', 'warrior']],
  ['ogres only', ['ogre', 'ogre', 'ogre', 'ogre']],
  ['mixed', ['knight', 'ogre', 'barbarian', 'goblin', 'archer', 'warrior', 'warrior']],
];
let allAvg = 0, allMax = 0, n = 0;
for (const [name, souls] of armies) {
  let sum = 0, cnt = 0, worst = 0, wins = 0; const RUNS = 40;
  for (let r = 0; r < RUNS; r++) {
    const specs = souls.map((soul) => ({ soul, star: 1 })), cells = enemyCells(specs);
    const b = new Battle(specs.map((s, i) => ({ ...s, cell: cells[i] })), enemyWave(8 + (r % 3), 1), 500 + r);
    const drift = new Map<number, number>(), last = new Map<number, [number, number]>();
    while (b.winner < 0 && b.time < 90) {
      for (const f of b.fighters) if (f.alive) last.set(f.id, [f.x, f.z]);
      const planted = b.fighters.filter((f) => f.alive && (f.state === 'attack' || f.state === 'idle') && f.target >= 0).map((f) => f.id);
      b.step(1 / 30);
      for (const id of planted) { const f = b.byId(id)!, p = last.get(id)!; if (f.alive && f.state !== 'run') drift.set(id, (drift.get(id) ?? 0) + Math.hypot(f.x - p[0], f.z - p[1])); }
    }
    if (b.winner === 0) wins++;
    for (const v of drift.values()) { sum += v; cnt++; if (v > worst) worst = v; }
  }
  const avg = sum / Math.max(1, cnt); allAvg += avg; allMax = Math.max(allMax, worst); n++;
  console.log(`${name.padEnd(18)} average shove per planted fighter ${avg.toFixed(2)} m, worst ${worst.toFixed(1)} m   (player win ${Math.round((100 * wins) / RUNS)}%)`);
}
console.log(`OVERALL average ${(allAvg / n).toFixed(2)} m, worst ${allMax.toFixed(1)} m`);
