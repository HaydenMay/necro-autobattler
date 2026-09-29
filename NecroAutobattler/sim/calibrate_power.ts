// Find the enemy power for each stage/tier so the competent stand-in clears it ~60% of the time (easy: ~85%) when EVERY Soul is at the tier's
// recommended level.   node sim/calibrate_power.ts [runs]      Stage 1 Easy and Normal keep power 1 (the reference); every other stage/tier is fitted.
import { DIFFS, STAGES, setStageDifficulty } from '../core/waves.ts';
import { playStage } from './campaign.ts';

const RUNS = +(process.argv[2] || 140);
const rate = (power: number, level: number, seedBase: number) => {
  let win = 0;
  for (let i = 0; i < RUNS; i++) if (playStage('smart', seedBase + i, level, power).state.status === 'won') win++;
  return win / RUNS;
};
const out: Record<string, Record<string, number>> = {};
for (let si = 0; si < STAGES.length; si++) {
  const st = STAGES[si]; out[st.id] = {};
  for (const d of DIFFS) {
    setStageDifficulty(st.id, d);
    const level = st.rec[d], target = d === 'easy' ? 0.85 : 0.6;
    if (si === 0 && (d === 'easy' || d === 'normal')) { console.log(`${st.id}/${d}: power 1 (reference), level ${level} -> smart clears ${Math.round(100 * rate(1, level, 11000))}%`); out[st.id][d] = 1; continue; }
    let lo = 0.6, hi = 4;
    for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (rate(mid, level, 12000) > target) lo = mid; else hi = mid; }
    const p = Math.round(((lo + hi) / 2) * 20) / 20;
    const check = rate(p, level, 13000), below = rate(p, Math.max(1, level - 2), 13000);
    out[st.id][d] = p;
    console.log(`${st.id}/${d}: power ${p.toFixed(2)} at level ${level} -> ${Math.round(100 * check)}% (target ${Math.round(100 * target)}%), two levels lower (${Math.max(1, level - 2)}) -> ${Math.round(100 * below)}%`);
  }
}
console.log(JSON.stringify(out));
