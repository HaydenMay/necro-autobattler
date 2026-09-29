// Try candidate enemy-wave sets against the stand-in players and print a scoreboard.  node sim/tune_waves.ts
import { AUTHORED } from '../core/waves.ts';
import type { EnemySpec } from '../core/waves.ts';
import { playStage } from './campaign.ts';
import { POLICIES } from './policies.ts';

const S = (s: string): EnemySpec[] => s.split(' ').map((t) => ({ soul: ({ W: 'warrior', A: 'archer', G: 'goblin', K: 'knight', O: 'ogre', B: 'barbarian' } as any)[t[0]], star: +t[1] }));
const CANDIDATES: Record<string, string[]> = {
  // re-tuned for the hand-merge rule (merging early is strong, so waves 2-3 must grow)
  F1: ['W1 A1', 'K1 G1 W1 A1', 'O1 A1 G1 W1 G1'],
  F2: ['W1 A1', 'K1 G1 W1 A1', 'O1 K1 G1 W1'],
  F3: ['W1 A1', 'K1 G1 W1 A1', 'O1 A1 G1 W1 W1'],
  F4: ['W1 A1', 'K1 G1 W1 W1', 'O1 A1 G1 W1'],
  F5: ['W1 A1', 'K1 G1 W1 A1', 'O1 A1 G1 W1'],
  F6: ['W1 A1', 'K1 G1 A1', 'O1 A1 G1 W1 A1'],
};
const RUNS = +(process.argv[process.argv.indexOf('--runs') + 1] || 400);
for (const [name, waves] of Object.entries(CANDIDATES)) {
  AUTHORED.length = 0; waves.forEach((w) => AUTHORED.push(S(w)));
  const out: string[] = [];
  for (const pol of Object.keys(POLICIES)) {
    let clear = 0; const ft = [0, 0, 0, 0];
    for (let i = 0; i < RUNS; i++) { const r = playStage(pol, 2000 + i); if (r.state.status === 'won') clear++; for (let w = 1; w <= 3; w++) if (r.firstTry[w]) ft[w]++; }
    const p = (x: number) => String(Math.round((x / RUNS) * 100)).padStart(3) + '%';
    out.push(`${pol.padEnd(5)} clear${p(clear)} first-try w1${p(ft[1])} w2${p(ft[2])} w3${p(ft[3])}`);
  }
  console.log(name.padEnd(8) + waves.join(' / ').padEnd(46) + out.join('   ||   '));
}
