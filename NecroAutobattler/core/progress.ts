// Permanent progression: stage clears -> Soul Packs -> copies -> Soul levels. Pure functions that change a Save (the caller persists it).
// Placeholder numbers, like packs.ts. In-run star merging is a separate, temporary system and never touches any of this.

import { BALANCE } from './balance.ts';
import type { SoulId } from './data.ts';
import { LEVEL_COST_MULT, PACK_TIERS, RARITY_OF, openPack } from './packs.ts';
import type { PackItem, PackResult } from './packs.ts';
import type { Rng } from './rng.ts';
import { loadSave, writeSave } from './save.ts';
import type { Difficulty, Save, Store } from './save.ts';

export const MAX_PACKS = 99;

/** Where packs come from. PLACEHOLDER. First clear of a stage on each difficulty gives one improved pack; later clears fill a meter. */
export const REWARDS = {
  firstClearTier: { easy: 1, normal: 2, hard: 2, nightmare: 3 } as Record<Difficulty, number>,
  replayTier: 1,
  replayClearsPerPack: 2,
};

// ------------------------------------------------------------------------------------------------ levels
export const maxLevel = (): number => BALANCE.level.copiesToLevel.length + 1;
export const isMaxLevel = (level: number): boolean => level >= maxLevel();
/** Copies needed to take `soul` from `level` to the next one (0 when already max). Rarer Souls need fewer. */
export const copiesNeeded = (level: number, soul: SoulId): number => (isMaxLevel(level) ? 0 : Math.max(1, Math.round(BALANCE.level.copiesToLevel[level - 1] * LEVEL_COST_MULT[RARITY_OF[soul]])));
export function canLevelUp(save: Save, soul: SoulId): boolean { const p = save.souls[soul]; return !isMaxLevel(p.level) && p.copies >= copiesNeeded(p.level, soul); }
/** Spend the copies, gain a level. Returns false if the Soul is not ready. */
export function levelUp(save: Save, soul: SoulId): boolean {
  if (!canLevelUp(save, soul)) return false;
  const p = save.souls[soul]; p.copies -= copiesNeeded(p.level, soul); p.level++; return true;
}
/** Multiplier applied to a Soul's health/damage from its permanent level (level 1 = 1.0). */
export const levelMult = (level: number, stat: 'hp' | 'dmg'): number => 1 + (Math.max(1, level) - 1) * BALANCE.level[stat];

// ------------------------------------------------------------------------------------------------ packs
export function grantPack(save: Save, tier: number, source: string): PackItem | null {
  if (save.packs.length >= MAX_PACKS) return null;
  const pack: PackItem = { id: save.nextPackId++, tier: Math.max(1, Math.min(PACK_TIERS, Math.floor(tier))), source };
  save.packs.push(pack); return pack;
}

/** Open an owned pack: it is removed and its copies are added to the Souls immediately (so nothing is lost if the page closes mid-animation). */
export function openOwnedPack(save: Save, packId: number, rng: Rng): PackResult | null {
  const i = save.packs.findIndex((p) => p.id === packId); if (i < 0) return null;
  const pack = save.packs[i]; save.packs.splice(i, 1);
  const result = openPack(pack.tier, rng);
  for (const r of result.reveals) save.souls[r.soul].copies += r.copies;
  return result;
}

export interface ClearReward { first: boolean; pack: PackItem | null; replayMeter: number; replayNeeded: number }
/** A stage was cleared on `difficulty`. The first clear on that difficulty grants a better pack; later clears fill the replay meter. */
export function recordClear(save: Save, stageId: string, difficulty: Difficulty): ClearReward {
  const key = stageId + ':' + difficulty, before = save.clears[key] ?? 0;
  save.clears[key] = before + 1;
  if (before === 0) return { first: true, pack: grantPack(save, REWARDS.firstClearTier[difficulty], 'First clear · ' + difficulty), replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
  save.replayMeter++;
  let pack: PackItem | null = null;
  if (save.replayMeter >= REWARDS.replayClearsPerPack) { save.replayMeter -= REWARDS.replayClearsPerPack; pack = grantPack(save, REWARDS.replayTier, 'Replay reward'); }
  return { first: false, pack, replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
}

// ------------------------------------------------------------------------------------------------ persisted wrappers (used by the game bundle)
export function recordClearAndSave(stageId: string, difficulty: Difficulty, store?: Store | null): ClearReward {
  const s = loadSave(store); const r = recordClear(s, stageId, difficulty); writeSave(s, store); return r;
}
