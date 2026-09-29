// Soul Packs (plan doc section 17). Pure rules, no graphics. ALL NUMBERS ARE PLACEHOLDER LEVERS: we settled the structure first and will tune
// quantities with the progression simulation (sim/progression.ts) once the loop can be played.
//
//   Soul rarity  -> how often a Soul shows up and how big its stack of copies tends to be.
//   Pack tier    -> the pack's overall value (skulls, 1-3 for now): number of reveals + how good the rarity odds are.
//   A pack has a STARTING tier and may upgrade while it is being opened; the result is decided up front, the animation only shows it.

import { SOULS } from './data.ts';
import type { SoulId } from './data.ts';
import type { Rng } from './rng.ts';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_NAME: Record<Rarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

/** Rarity per Soul. PLACEHOLDER assignment (no Legendary Soul exists yet). */
export const RARITY_OF: Record<SoulId, Rarity> = { warrior: 'common', goblin: 'common', archer: 'rare', knight: 'rare', ogre: 'epic', barbarian: 'epic' };

/** Rarer Souls turn up in smaller stacks, so they need fewer copies per level (multiplier on the level costs). PLACEHOLDER. */
export const LEVEL_COST_MULT: Record<Rarity, number> = { common: 1, rare: 0.6, epic: 0.35, legendary: 0.2 };

export const PACK_TIERS = 3;
export const PACK = {
  reveals: [3, 4, 5],                                         // separate reveals per tier (index 0 = tier 1)
  stackMult: [1, 1.5, 2],                                     // copy stacks are bigger in better packs
  /** Rarity odds per tier, in percent. */
  odds: [
    { common: 70, rare: 25, epic: 5, legendary: 0 },
    { common: 55, rare: 33, epic: 11, legendary: 1 },
    { common: 40, rare: 38, epic: 19, legendary: 3 },
  ] as Record<Rarity, number>[],
  /** Copies in one reveal before the tier multiplier: [min, max]. */
  stack: { common: [6, 10], rare: [3, 5], epic: [1, 3], legendary: [1, 1] } as Record<Rarity, [number, number]>,
  /** Chance to jump up one tier during the opening, from tier 1 and from tier 2 (a lucky pack can jump twice). */
  upgradeChance: [0.2, 0.12],
};

/** An unopened pack the player owns. */
export interface PackItem { id: number; tier: number; source: string }
export interface Reveal { soul: SoulId; rarity: Rarity; copies: number }
export interface PackResult { startTier: number; finalTier: number; upgrades: number[]; reveals: Reveal[] }

const rarityRank = (r: Rarity) => RARITIES.indexOf(r);

function rollRarity(tier: number, rng: Rng): Rarity {
  const odds = PACK.odds[tier - 1]; let roll = rng.next() * RARITIES.reduce((n, r) => n + odds[r], 0);
  for (const r of RARITIES) { if (roll < odds[r]) return r; roll -= odds[r]; }
  return 'common';
}

/** A random Soul of this rarity; if the roster has none of that rarity yet, the next lower one is used. */
function soulOfRarity(rarity: Rarity, rng: Rng): SoulId {
  for (let i = rarityRank(rarity); i >= 0; i--) { const pool = SOULS.filter((s) => RARITY_OF[s] === RARITIES[i]); if (pool.length) return rng.pick(pool); }
  return rng.pick(SOULS);
}

/** Open a pack: roll upgrades first (so the animation can play them before the pack tears open), then the reveals. Best reveal comes last. */
export function openPack(startTier: number, rng: Rng): PackResult {
  const t0 = Math.max(1, Math.min(PACK_TIERS, Math.floor(startTier))), upgrades: number[] = [];
  let tier = t0;
  while (tier < PACK_TIERS && rng.next() < PACK.upgradeChance[tier - 1]) { tier++; upgrades.push(tier); }
  const reveals: Reveal[] = [];
  for (let i = 0; i < PACK.reveals[tier - 1]; i++) {
    const rarity = rollRarity(tier, rng), soul = soulOfRarity(rarity, rng), [lo, hi] = PACK.stack[RARITY_OF[soul]];
    reveals.push({ soul, rarity: RARITY_OF[soul], copies: Math.max(1, Math.round((lo + rng.int(hi - lo + 1)) * PACK.stackMult[tier - 1])) });
  }
  reveals.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.copies - b.copies);
  return { startTier: t0, finalTier: tier, upgrades, reveals };
}

/** Total copies per Soul in a result (the same Soul can be revealed more than once). */
export function copiesBySoul(result: PackResult): Partial<Record<SoulId, number>> {
  const out: Partial<Record<SoulId, number>> = {};
  for (const r of result.reveals) out[r.soul] = (out[r.soul] ?? 0) + r.copies;
  return out;
}
