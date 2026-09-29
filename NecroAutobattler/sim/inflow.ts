// Compares card-inflow options (how many cards the player gets per wave) on the doc Dominion curve.
// Usage: node sim/inflow.ts [--runs 2000]
// "idle" = Dominion left unspent at the end of build, i.e. the army fell behind the cap.

import { CURVES } from '../core/data.ts';
import type { Rules } from '../core/data.ts';
import { smart } from './policies.ts';
import { playPerfectRun } from './engine.ts';

const args = process.argv.slice(2);
const RUNS = +(args[args.indexOf('--runs') + 1] || 2000);
const base = { curve: CURVES.doc, merge: 'deployedOnly' as const };

const variants: { label: string; rules: Rules }[] = [
  { label: '1 today: draft 1 + normal draw every wave', rules: { ...base } },
  { label: '2 draft only', rules: { ...base, normalDrawWaves: [] } },
  { label: '3 draft only, start hand 6', rules: { ...base, normalDrawWaves: [], startHand: 6 } },
  { label: '4 draft: keep 2 of 3, no normal draw', rules: { ...base, normalDrawWaves: [], draftPicks: 2 } },
  { label: '5 draft + normal draw on even waves', rules: { ...base, normalDrawWaves: [2, 4, 6, 8, 10] } },
  { label: '6 draft + normal draw waves 2-5 only', rules: { ...base, normalDrawWaves: [2, 3, 4, 5] } },
];

const f0 = (x: number) => x.toFixed(0), f1 = (x: number) => x.toFixed(1), pct = (x: number) => Math.round(x * 100) + '%';
const pad = (v: string | number, n: number) => String(v).padStart(n);

console.log(`Card-inflow comparison, ${RUNS} perfect runs each, doc curve to 40, smart player.\n`);
console.log('variant                                             | cards | idle@1 @3 @6 @10 | used%@10 | bodies@10 | cards on field | hand left | 3*/run | any 3*');
for (const v of variants) {
  const sum = { idle: [0, 0, 0, 0], used10: 0, bodies: 0, field: 0, hand: 0, s3: 0, any3: 0, cards: 0 };
  for (let r = 0; r < RUNS; r++) {
    const { snaps, state } = playPerfectRun(v.rules, smart, 777 + r);
    const idleAt = (w: number) => snaps[w - 1].cap - snaps[w - 1].used;
    sum.idle[0] += idleAt(1); sum.idle[1] += idleAt(3); sum.idle[2] += idleAt(6); sum.idle[3] += idleAt(10);
    const last = snaps[9];
    sum.used10 += last.used / last.cap; sum.bodies += last.bodies; sum.field += last.cardsOnField; sum.hand += last.handLeft;
    sum.s3 += last.star3; sum.any3 += last.star3 > 0 ? 1 : 0; sum.cards += state.stats.drawn - state.stats.discarded;
  }
  const n = RUNS;
  console.log(`${v.label.padEnd(51)} | ${pad(f0(sum.cards / n), 5)} | ${pad(f1(sum.idle[0] / n), 4)} ${pad(f1(sum.idle[1] / n), 3)} ${pad(f1(sum.idle[2] / n), 3)} ${pad(f1(sum.idle[3] / n), 4)} | ${pad(pct(sum.used10 / n), 8)} | ${pad(f1(sum.bodies / n), 9)} | ${pad(f1(sum.field / n), 14)} | ${pad(f1(sum.hand / n), 9)} | ${pad((sum.s3 / n).toFixed(2), 6)} | ${pad(pct(sum.any3 / n), 5)}`);
}
