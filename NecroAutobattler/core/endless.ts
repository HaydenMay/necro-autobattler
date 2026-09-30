// Endless Depths: enemy waves built from a BUDGET instead of a hand-written list, so the mode never runs out of waves.
// The budget is the enemy team's total Dominion cost (the same COST table the player pays from). Waves are built from role TEMPLATES so they
// look designed (a front line with archers behind, a swarm, a brute squad) instead of a random pile. Everything is seeded: the same seed gives
// the same waves, so a retry (or a daily seed) faces exactly the same army.
//
// The player's army is capped on purpose (Dominion stops at 40, the grid holds 12), so at some point the enemy simply out-scales it: that is the
// "hard wall". Once the budget fills the 12 slots with upgraded units, `endlessPower` (the hidden health/damage multiplier) keeps climbing.
// Numbers here are tuned with sim/endless_curve.ts.

import { COST } from './data.ts';
import type { SoulId } from './data.ts';
import { makeRng } from './rng.ts';
import type { EnemySpec } from './waves.ts';

export const ENDLESS_ID = 'endless';
/** A pack is granted every this-many waves cleared in an endless run. */
export const ENDLESS_PACK_EVERY = 10;
const MAX_UNITS = 12;

/** The tuning knobs (sim/endless_curve.ts sweeps them). */
export const TUNE = { start: 5, slope: 3.0, lateSlope: 0.8, maxBudget: 150, powerSlope: 0.012, champion: 1.0 };
/** Total Dominion cost of the enemy team at wave `n` (1-based): a gentle start (about the Normal campaign by wave 10), then it keeps rising. */
export function endlessBudget(n: number): number {
  const w = Math.max(1, n), early = TUNE.start + TUNE.slope * (Math.min(w, 10) - 1);
  return Math.round(Math.min(TUNE.maxBudget, early + (w > 10 ? TUNE.lateSlope * (w - 10) : 0)));
}
/** Hidden enemy health/damage multiplier: 1.0 through wave 10, then rising; every 10th (champion) wave gets a little extra. */
export function endlessPower(n: number): number {
  const w = Math.max(1, n), base = w <= 10 ? 1 : 1 + TUNE.powerSlope * (w - 10);
  return +(w % 10 === 0 ? base * TUNE.champion : base).toFixed(3);
}
/** Pack tier for clearing wave `n` (only meaningful when n is a multiple of ENDLESS_PACK_EVERY). */
export const endlessPackTier = (n: number): number => (n >= 30 ? 3 : n >= 20 ? 2 : 1);

type Role = 'tank' | 'brute' | 'ranged' | 'fodder';
const ROLE: Record<Role, SoulId[]> = { tank: ['knight', 'ogre'], brute: ['barbarian', 'ogre'], ranged: ['archer'], fodder: ['warrior', 'goblin'] };
export interface Template { id: string; mix: [Role, number][] }
export const TEMPLATES: Template[] = [
  { id: 'wall', mix: [['tank', 3], ['ranged', 2], ['fodder', 1]] },
  { id: 'swarm', mix: [['fodder', 5], ['ranged', 1], ['tank', 1]] },
  { id: 'brutes', mix: [['brute', 4], ['fodder', 1], ['ranged', 1]] },
  { id: 'mixed', mix: [['tank', 1], ['brute', 1], ['ranged', 1], ['fodder', 2]] },
];

/** Waves 1-2 are a gentle warm-up: cheap fodder (and an archer), no tanks or brutes, so nobody loses a heart to the first fight. */
const WARMUP: Template = { id: 'warmup', mix: [['fodder', 3], ['ranged', 1]] };
/** Which template a wave uses (seeded per wave, so it does not depend on what came before). */
export function endlessTemplate(n: number, seed: number): Template {
  if (n <= 2) return WARMUP;
  return TEMPLATES[Math.floor(makeRng(seed * 4099 + n * 31 + 5).next() * TEMPLATES.length)];
}

/** The enemy army for endless wave `n` (1-based). At most 12 units; the whole budget is spent unless no unit fits what is left. */
export function endlessWave(n: number, seed = 0): EnemySpec[] {
  const wave = Math.max(1, Math.floor(n)), rng = makeRng(seed * 1009 + wave * 7919 + 17), tpl = endlessTemplate(wave, seed);
  let left = endlessBudget(wave); const army: EnemySpec[] = [];
  if (wave % 10 === 0 && left >= 20) {                                   // champion wave: one starred brute up front (2 stars, 3 from wave 40), then the usual escort
    const soul: SoulId = rng.next() < 0.5 ? 'ogre' : 'knight', star = wave >= 40 ? 3 : 2; army.push({ soul, star }); left -= COST[soul][star - 1];
  }
  const total = tpl.mix.reduce((a, [, w]) => a + w, 0);
  for (let guard = 0; guard < 80 && army.length < MAX_UNITS && left >= 2; guard++) {
    let r = rng.next() * total, role: Role = tpl.mix[0][0];
    for (const [ro, w] of tpl.mix) { r -= w; if (r <= 0) { role = ro; break; } }
    let options = ROLE[role].filter((s) => COST[s][0] <= left);
    if (!options.length) options = ROLE.fodder.filter((s) => COST[s][0] <= left);
    if (!options.length) break;
    const soul = rng.pick(options), per = left / Math.max(1, MAX_UNITS - army.length);
    let star = 1;                                                       // spare budget per free slot buys stars
    for (let s = 3; s >= 2; s--) if (COST[soul][s - 1] <= left && COST[soul][s - 1] <= Math.max(COST[soul][0], per * 1.2)) { star = s; break; }
    army.push({ soul, star }); left -= COST[soul][star - 1];
  }
  return army;
}
