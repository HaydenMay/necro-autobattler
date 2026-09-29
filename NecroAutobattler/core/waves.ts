// Enemy waves. Same unit pool as the player. The build screen previews the COMPOSITION only, never positions.

import { COST, CURVES, SOULS } from './data.ts';
import type { SoulId } from './data.ts';
import { makeRng } from './rng.ts';

export interface EnemySpec { soul: SoulId; star: number }

/** Hand-authored opening waves (prototype stage is 3 waves). Budgets ~ the player's cap at that wave. */
export const AUTHORED: EnemySpec[][] = [
  // Tuned with sim/tune_waves.ts for the hand-merge rule (competent stand-in player: first-try win w1 97%, w2 62%, w3 75%; stage clear 75%;
  // careless player who just summons the biggest card: stage clear 26%).
  // wave 1 (cap 9): a Warrior and an Archer
  [{ soul: "warrior", star: 1 }, { soul: "archer", star: 1 }],
  // wave 2 (cap 13): Knight up front, a Goblin, a Warrior and an Archer
  [{ soul: "knight", star: 1 }, { soul: "goblin", star: 1 }, { soul: "warrior", star: 1 }, { soul: "archer", star: 1 }],
  // wave 3 (cap 17): Ogre, Archer, Goblin, Warrior
  [{ soul: "ogre", star: 1 }, { soul: "archer", star: 1 }, { soul: "goblin", star: 1 }, { soul: "warrior", star: 1 }],
];

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
