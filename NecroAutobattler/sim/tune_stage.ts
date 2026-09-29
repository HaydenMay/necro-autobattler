// Try alternative late waves for Stage 1 and report clear rates.  node sim/tune_stage.ts
import { AUTHORED, waveCost } from '../core/waves.ts';
import type { EnemySpec } from '../core/waves.ts';
import { playStage } from './campaign.ts';

const L: Record<string, any> = { W: 'warrior', A: 'archer', G: 'goblin', K: 'knight', O: 'ogre', B: 'barbarian' };
const parse = (s: string): EnemySpec[] => s.split(' ').map((t) => ({ soul: L[t[0]], star: +t[1] }));
const head = ['W1 A1', 'K1 G1 W1', 'O1 A1 G1 W1', 'K1 O1 A1 W1', 'O1 K1 A1 G1 W1', 'A2 K1 O1 G1 W1'];
const CANDIDATES: Record<string, string[]> = JSON.parse(process.argv[2] || '{}');
for (const [name, late] of Object.entries(CANDIDATES)) {
  AUTHORED.length = 0; [...head, ...late].forEach((w) => AUTHORED.push(parse(w)));
  const RUNS = 300; const res: string[] = [];
  for (const pol of ['smart', 'lazy']) {
    let clear = 0, hearts = 0; const ft = new Array(12).fill(0);
    for (let i = 0; i < RUNS; i++) { const r = playStage(pol, 5000 + i); if (r.state.status === 'won') clear++; hearts += r.state.hearts; for (let w = 7; w <= 10; w++) if (r.firstTry[w]) ft[w]++; }
    res.push(`${pol}: clear ${Math.round((100 * clear) / RUNS)}% hearts ${(hearts / RUNS).toFixed(2)} 1st-try w7-10 ${[7, 8, 9, 10].map((w) => Math.round((100 * ft[w]) / RUNS)).join('/')}`);
  }
  console.log(name.padEnd(4), 'costs', AUTHORED.slice(6).map(waveCost).join('/'), '|', res.join(' | '));
}
