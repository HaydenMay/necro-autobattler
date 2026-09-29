// How deep does an Endless Depths run go? Plays full endless runs with the stand-in players at several Soul levels and reports the depth reached
// (the last wave cleared before the third heart is lost).   node sim/endless_curve.ts [runs] [policy]
//   LEVELS=1,4,8,10  node sim/endless_curve.ts 40 smart
// Use it to tune endlessBudget / endlessPower in core/endless.ts. Targets (starting guess): level 1 about wave 12-13, level 10 about wave 30.

import { ENDLESS_RULES } from '../core/prototype.ts';
import { advanceWave, checkInvariants, draftOptions, failWave, newStage, normalDraw, takeDraft } from '../core/rules.ts';
import { simulate } from '../core/battle.ts';
import { enemyPower, enemyWave, setEndless } from '../core/waves.ts';
import { endlessBudget, endlessPower, endlessTemplate } from '../core/endless.ts';
import { POLICIES } from './policies.ts';
import { SOULS } from '../core/data.ts';

export function playEndless(policyName: string, seed: number, level = 1): { depth: number; hearts: number } {
  setEndless();
  const levels = level > 1 ? Object.fromEntries(SOULS.map((k) => [k, level])) : undefined;
  const policy = POLICIES[policyName]; const s = newStage(ENDLESS_RULES, seed);
  let depth = 0, guard = 0;
  while (s.status === 'building' && guard++ < 600) {
    policy.build(s); checkInvariants(s);
    const slots = s.units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell }));
    const r = simulate(slots, enemyWave(s.wave, seed), seed * 97 + guard, 130, levels, enemyPower(s.wave));
    if (r.winner === 0 && slots.length) {
      depth = s.wave;
      if (advanceWave(s)) break;
      const opts = draftOptions(s); takeDraft(s, opts, policy.draft(s, opts)); normalDraw(s);
    } else failWave(s);
  }
  return { depth, hearts: s.hearts };
}

if (process.argv[1] && process.argv[1].endsWith('endless_curve.ts')) {
  const RUNS = +(process.argv[2] || 40), policy = process.argv[3] || 'smart';
  const LEVELS = (process.env.LEVELS || '1,4,8,10').split(',').map(Number);
  setEndless();
  console.log('wave: budget / power / template   ' + [1, 5, 10, 15, 20, 25, 30, 40].map((w) => `w${w} ${endlessBudget(w)}/${endlessPower(w)}/${endlessTemplate(w, 1).id}`).join(' | '));
  for (const level of LEVELS) {
    const ds: number[] = [];
    for (let i = 0; i < RUNS; i++) ds.push(playEndless(policy, 2000 + i, level).depth);
    ds.sort((a, b) => a - b);
    const q = (p: number) => ds[Math.min(ds.length - 1, Math.floor(p * ds.length))];
    console.log(`level ${String(level).padStart(2)} (${policy}): median depth ${q(0.5)}  (p25 ${q(0.25)}, p75 ${q(0.75)}, best ${ds[ds.length - 1]}, worst ${ds[0]})`);
  }
}
