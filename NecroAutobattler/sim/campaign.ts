// Full 3-wave stage with real combat, played by the stand-in players. Answers: are the enemy waves fair?
//   node sim/campaign.ts [--runs 600]
// first-try = won the wave on the first attempt (no heart lost). A good curve: wave 1 easy, wave 3 a real test.

import { PROTOTYPE_RULES } from '../core/prototype.ts';
import { advanceWave, checkInvariants, dominionUsed, draftOptions, failWave, newStage, normalDraw, takeDraft } from '../core/rules.ts';
import { simulate } from '../core/battle.ts';
import { enemyWave, waveCost } from '../core/waves.ts';
import { POLICIES } from './policies.ts';

export { PROTOTYPE_RULES };

export function playStage(policyName: string, seed: number) {
  const policy = POLICIES[policyName]; const s = newStage(PROTOTYPE_RULES, seed);
  const tries: number[] = [0, 0, 0, 0]; const firstTry: boolean[] = []; let guard = 0;
  while (s.status === 'building' && guard++ < 40) {
    policy.build(s); checkInvariants(s);
    const slots = s.units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell }));
    const r = simulate(slots, enemyWave(s.wave, seed), seed * 97 + guard);
    tries[s.wave]++;
    if (r.winner === 0 && slots.length) {
      if (tries[s.wave] === 1) firstTry[s.wave] = true;
      if (advanceWave(s)) break;
      const opts = draftOptions(s); takeDraft(s, opts, policy.draft(s, opts)); normalDraw(s);
    } else { if (tries[s.wave] === 1) firstTry[s.wave] = false; failWave(s); }
  }
  return { state: s, tries, firstTry };
}

if (process.argv[1] && process.argv[1].endsWith('campaign.ts')) {
  const RUNS = +(process.argv[process.argv.indexOf('--runs') + 1] || 600);
  console.log('Enemy waves: ' + [1, 2, 3].map((w) => `w${w} cost ${waveCost(enemyWave(w))} (${enemyWave(w).map((e) => e.soul[0].toUpperCase() + e.star).join(' ')})`).join(' | '));
  for (const name of Object.keys(POLICIES)) {
    let clear = 0, hearts = 0; const ft = [0, 0, 0, 0], att = [0, 0, 0, 0];
    for (let i = 0; i < RUNS; i++) {
      const r = playStage(name, 1000 + i);
      if (r.state.status === 'won') clear++; hearts += r.state.hearts;
      for (let w = 1; w <= 3; w++) { if (r.firstTry[w]) ft[w]++; att[w] += r.tries[w]; }
    }
    const pc = (x: number) => Math.round((x / RUNS) * 100) + '%';
    console.log(`${name.padEnd(6)}| stage cleared ${pc(clear)} | avg hearts left ${(hearts / RUNS).toFixed(2)} | first-try win  w1 ${pc(ft[1])}  w2 ${pc(ft[2])}  w3 ${pc(ft[3])} | avg attempts  w1 ${(att[1] / RUNS).toFixed(2)}  w2 ${(att[2] / RUNS).toFixed(2)}  w3 ${(att[3] / RUNS).toFixed(2)}`);
  }
}
