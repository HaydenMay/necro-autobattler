// Try full 10-wave enemy lists and report stage-clear rates for the stand-in players.
//   node sim/tune_difficulty.ts '{"name":["W1 A1","K1 G1 W1", ... 10 entries]}'
import { AUTHORED, waveCost } from '../core/waves.ts';
import type { EnemySpec } from '../core/waves.ts';
import { playStage } from './campaign.ts';

const L: Record<string, any> = { W: 'warrior', A: 'archer', G: 'goblin', K: 'knight', O: 'ogre', B: 'barbarian' };
const parse = (s: string): EnemySpec[] => s.split(' ').map((t) => ({ soul: L[t[0]], star: +t[1] }));
const CANDIDATES: Record<string, string[]> = JSON.parse(process.argv[2] || '{}');
for (const [name, waves] of Object.entries(CANDIDATES)) {
  AUTHORED.length = 0; waves.forEach((w) => AUTHORED.push(parse(w)));
  const RUNS = 300; const res: string[] = [];
  for (const pol of ['smart', 'lazy']) {
    let clear = 0, hearts = 0; const reached = new Array(12).fill(0);
    for (let i = 0; i < RUNS; i++) { const r = playStage(pol, 7000 + i, +(process.env.LEVEL || 1)); if (r.state.status === 'won') clear++; hearts += r.state.hearts; reached[r.state.wave]++; }
    res.push(`${pol}: clear ${Math.round((100 * clear) / RUNS)}% hearts ${(hearts / RUNS).toFixed(2)}`);
  }
  console.log(name.padEnd(5), 'costs', AUTHORED.map(waveCost).join('/'), '|', res.join(' | '));
}
