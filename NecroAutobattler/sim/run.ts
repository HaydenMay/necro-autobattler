// Usage:
//   node sim/run.ts                         -> economy report across the rule variants (paste-friendly tables)
//   node sim/run.ts --runs 5000 --seed 1    -> more runs / different base seed
//   node sim/run.ts --trace 7               -> full event log + ASCII formation for ONE run (seed 7)
//   node sim/run.ts --trace 7 --curve recalled --merge handIntoOneStar --policy lazy

import { CURVES } from '../core/data.ts';
import type { Rules } from '../core/data.ts';
import { POLICIES } from './policies.ts';
import { playPerfectRun, renderGrid } from './engine.ts';
import type { Snapshot } from './engine.ts';

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const RUNS = +(opt('runs', '2000') as string);
const BASE = +(opt('seed', '1') as string);

const pad = (v: string | number, n: number) => String(v).padStart(n);
const f1 = (x: number) => x.toFixed(1);

// ---------------------------------------------------------------- trace mode
if (opt('trace')) {
  const seed = +(opt('trace') as string);
  const rules: Rules = { curve: CURVES[opt('curve', 'doc') as string], merge: opt('merge', 'deployedOnly') as Rules['merge'] };
  const policy = POLICIES[opt('policy', 'smart') as string];
  console.log(`TRACE seed=${seed} curve=${opt('curve', 'doc')} merge=${rules.merge} policy=${policy.name}\n`);
  const { state } = playPerfectRun(rules, policy, seed, (s, snap) => {
    console.log(`--- end of build, wave ${snap.wave}: dominion ${snap.used}/${snap.cap}, bodies ${snap.bodies}, hand ${JSON.stringify(s.hand)}`);
    console.log(renderGrid(s));
  });
  console.log('\nEVENT LOG');
  console.log(state.log.join('\n'));
  process.exit(0);
}

// ---------------------------------------------------------------- report mode
interface Variant { label: string; rules: Rules; policy: string }
const variants: Variant[] = [
  { label: 'A  doc curve (to 40) | merge deployed only | smart', rules: { curve: CURVES.doc, merge: 'deployedOnly' }, policy: 'smart' },
  { label: 'B  doc curve (to 40) | merge from hand too | smart', rules: { curve: CURVES.doc, merge: 'handIntoOneStar' }, policy: 'smart' },
  { label: 'C  doc curve (to 40) | merge deployed only | lazy', rules: { curve: CURVES.doc, merge: 'deployedOnly' }, policy: 'lazy' },
];

interface Result { v: Variant; avg: Snapshot[]; w1Ge8: number; w1Weak: number; anyStar3: number; nStar3: number; noMergeByW3: number; gridFull: number; bodiesP90: number; bodiesMax: number }

function run(v: Variant): Result {
  const policy = POLICIES[v.policy];
  const n = v.rules.curve.length;
  const sum: Snapshot[] = Array.from({ length: n }, (_, i) => ({ wave: i + 1, cap: 0, used: 0, bodies: 0, star1: 0, star2: 0, star3: 0, cardsOnField: 0, handLeft: 0, mergesSoFar: 0, drawnSoFar: 0 }));
  let w1Ge8 = 0, w1Weak = 0, anyStar3 = 0, nStar3 = 0, noMergeByW3 = 0, gridFull = 0; const bodies10: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const { snaps } = playPerfectRun(v.rules, policy, BASE * 100003 + r);
    snaps.forEach((sn, i) => { for (const k of Object.keys(sn) as (keyof Snapshot)[]) sum[i][k] += sn[k]; });
    if (snaps[0].used >= 8) w1Ge8++;
    if (snaps[0].used <= 5) w1Weak++;
    if (snaps.some((x) => x.bodies >= 12)) gridFull++;
    bodies10.push(snaps[n - 1].bodies);
    if (snaps[n - 1].star3 > 0) anyStar3++;
    nStar3 += snaps[n - 1].star3;
    if (snaps[2].mergesSoFar === 0) noMergeByW3++;
  }
  bodies10.sort((a, b) => a - b);
  const avg = sum.map((sn, i) => { const o = { ...sn }; o.wave = i + 1; for (const k of Object.keys(o) as (keyof Snapshot)[]) if (k !== 'wave') o[k] = o[k] / RUNS; return o; });
  return { v, avg, w1Weak: w1Weak / RUNS, gridFull: gridFull / RUNS, bodiesP90: bodies10[Math.floor(RUNS * 0.9)], bodiesMax: bodies10[RUNS - 1], w1Ge8: w1Ge8 / RUNS, anyStar3: anyStar3 / RUNS, nStar3: nStar3 / RUNS, noMergeByW3: noMergeByW3 / RUNS };
}

const results = variants.map(run);
console.log(`Necro economy simulation: ${RUNS} perfect runs per variant (every wave cleared). Placeholder: Barbarian cost 5/7/10.\n`);
for (const r of results) {
  console.log(`### ${r.v.label}`);
  console.log(' wave | cap | used | used% | bodies | 1* 2* 3* | cards on field | hand left | merges | drawn');
  for (const a of r.avg) {
    console.log(` ${pad(a.wave, 4)} | ${pad(a.cap, 3)} | ${pad(f1(a.used), 4)} | ${pad(Math.round((a.used / a.cap) * 100) + '%', 5)} | ${pad(f1(a.bodies), 6)} | ` +
      `${f1(a.star1)} ${f1(a.star2)} ${f1(a.star3)} | ${pad(f1(a.cardsOnField), 14)} | ${pad(f1(a.handLeft), 9)} | ${pad(f1(a.mergesSoFar), 6)} | ${pad(f1(a.drawnSoFar), 5)}`);
  }
  console.log(`  wave 1 uses >= 8 of 9 Dominion: ${(r.w1Ge8 * 100).toFixed(0)}% of runs`);
  console.log(`  weak opening (wave 1 uses <= 5 of 9): ${(r.w1Weak * 100).toFixed(0)}% of runs`);
  console.log(`  grid ever completely full (12 bodies): ${(r.gridFull * 100).toFixed(1)}% of runs; wave-10 bodies p90 ${r.bodiesP90}, max ${r.bodiesMax}`);
  console.log(`  no merge yet by wave 3: ${(r.noMergeByW3 * 100).toFixed(0)}% of runs`);
  console.log(`  reach at least one 3-star by wave 10: ${(r.anyStar3 * 100).toFixed(0)}% of runs (avg ${r.nStar3.toFixed(2)} per run)\n`);
}

console.log('### Summary at wave 10');
console.log(' variant | cap | used% | bodies | cells% | hand left | 3* per run');
for (const r of results) {
  const a = r.avg[r.avg.length - 1];
  console.log(` ${r.v.label.slice(0, 1)}       | ${pad(a.cap, 3)} | ${pad(Math.round((a.used / a.cap) * 100) + '%', 5)} | ${pad(f1(a.bodies), 6)} | ${pad(Math.round((a.bodies / 12) * 100) + '%', 6)} | ${pad(f1(a.handLeft), 9)} | ${r.nStar3.toFixed(2)}`);
}
