// Enemy waves. Same unit pool as the player. The build screen previews the COMPOSITION only, never positions.

import { COST, CURVES, SOULS } from './data.ts';
import type { SoulId } from './data.ts';
import { makeRng } from './rng.ts';

export interface EnemySpec { soul: SoulId; star: number }

const LETTER: Record<string, SoulId> = { W: 'warrior', A: 'archer', G: 'goblin', K: 'knight', O: 'ogre', B: 'barbarian' };
const parseWave = (s: string): EnemySpec[] => s.split(' ').map((t) => ({ soul: LETTER[t[0]], star: +t[1] }));

/**
 * Difficulty presets for the 3-wave prototype (W warrior, A archer, G goblin, K knight, O ogre; digit = stars).
 * Measured with sim/tune_waves.ts against stand-in players (competent / careless), stage-clear rate:
 *   easy   ~100% / ~90%      normal ~94% / ~51%      hard ~75% / ~26%
 * A real human on a phone is much less careful than the competent stand-in, so "normal" is the default.
 */
export const DIFFICULTY: Record<string, string[]> = {
  easy: ['W1', 'K1 W1', 'O1 W1 G1'],
  normal: ['W1 A1', 'K1 G1 W1', 'O1 A1 G1 W1'],
  hard: ['W1 A1', 'K1 G1 W1 A1', 'O1 A1 G1 W1'],
};
export let difficultyName = 'normal';

/** Hand-authored opening waves (prototype stage is 3 waves). Budgets ~ the player's cap at that wave. Edited in place by setDifficulty. */
export const AUTHORED: EnemySpec[][] = DIFFICULTY.normal.map(parseWave);

export function setDifficulty(name: string): void {
  if (!DIFFICULTY[name]) return;
  difficultyName = name; AUTHORED.length = 0; DIFFICULTY[name].forEach((w) => AUTHORED.push(parseWave(w)));
}

export const waveCost = (w: EnemySpec[]): number => w.reduce((n, e) => n + COST[e.soul][e.star - 1], 0);

/** Enemy army for a wave (1-based). Waves past the authored ones are generated from a fixed seed so retries face the same army. */
export function enemyWave(wave: number, stageSeed = 0): EnemySpec[] {
  if (wave <= AUTHORED.length) return AUTHORED[wave - 1].map((e) => ({ ...e }));
  const cap = CURVES.doc[Math.min(wave, CURVES.doc.length) - 1];
  const budget = Math.round(cap * 0.92);
  const rng = makeRng(stageSeed * 1009 + wave * 7919);
  const army: EnemySpec[] = [];
  let left = budget;
  for (let guard = 0; guard < 40 && left >= 2; guard++) {
    const soul = rng.pick(SOULS);
    let star = 1;
    if (rng.next() < 0.35 && COST[soul][1] <= left) star = 2;
    if (wave >= 6 && rng.next() < 0.25 && COST[soul][2] <= left) star = 3;
    const c = COST[soul][star - 1];
    if (c <= left && army.length < 12) { army.push({ soul, star }); left -= c; }
  }
  return army;
}

/** What the build screen shows: counts per Soul and star, no positions. */
export function previewText(w: EnemySpec[]): { soul: SoulId; star: number; count: number }[] {
  const map = new Map<string, { soul: SoulId; star: number; count: number }>();
  for (const e of w) {
    const k = e.soul + e.star;
    const cur = map.get(k);
    if (cur) cur.count++; else map.set(k, { soul: e.soul, star: e.star, count: 1 });
  }
  return [...map.values()];
}
