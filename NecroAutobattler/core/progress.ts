// Permanent progression: stage clears -> Soul Packs -> copies -> Soul levels. Pure functions that change a Save (the caller persists it).
// Placeholder numbers, like packs.ts. In-run star merging is a separate, temporary system and never touches any of this.

import { BALANCE } from './balance.ts';
import { SOULS } from './data.ts';
import type { SoulId } from './data.ts';
import { ENDLESS_PACK_EVERY, endlessPackTier } from './endless.ts';
import { LEVEL_COST_MULT, PACK_TIERS, RARITY_OF, openPack } from './packs.ts';
import type { PackItem, PackResult } from './packs.ts';
import type { Rng } from './rng.ts';
import { loadSave, writeSave } from './save.ts';
import { STAGES, stageById, stageIndex } from './waves.ts';
import type { Difficulty, Save, Store } from './save.ts';

export const MAX_PACKS = 99;

/** Where packs come from. PLACEHOLDER. First clear of a stage on each difficulty gives one improved pack; later clears fill a meter. */
export const REWARDS = {
  firstClearTier: { easy: 1, normal: 2, hard: 2, nightmare: 3 } as Record<Difficulty, number>,
  replayTier: { easy: 1, normal: 1, hard: 2, nightmare: 2 } as Record<Difficulty, number>,   // every clear pays a pack; harder tiers pay better
  replayClearsPerPack: 1,
};

// ------------------------------------------------------------------------------------------------ levels
export const maxLevel = (): number => BALANCE.level.copiesToLevel.length + 1;
export const isMaxLevel = (level: number): boolean => level >= maxLevel();
/** Copies needed to take `soul` from `level` to the next one (0 when already max). Rarer Souls need fewer. */
export const copiesNeeded = (level: number, soul: SoulId): number => (isMaxLevel(level) ? 0 : Math.max(1, Math.round(BALANCE.level.copiesToLevel[level - 1] * LEVEL_COST_MULT[RARITY_OF[soul]])));
/**
 * One requirement of an upgrade. Today only copies; the confirm popup lists every entry with have / need, and Confirm is allowed only when all are met.
 * Gold will simply become a second entry here ({ id: 'gold', ... }) and be spent in levelUp().
 */
export interface UpgradeCost { id: 'copies' | 'gold'; label: string; have: number; need: number; ok: boolean }
/** Gold to take a Soul from `level` to the next one (0 at max). */
export const goldNeeded = (level: number): number => (isMaxLevel(level) ? 0 : BALANCE.level.goldToLevel[level - 1]);
export function upgradeCosts(save: Save, soul: SoulId): UpgradeCost[] {
  const p = save.souls[soul]; if (isMaxLevel(p.level)) return [];
  const need = copiesNeeded(p.level, soul);
  const gold = goldNeeded(p.level);
  return [{ id: 'copies', label: 'Copies', have: p.copies, need, ok: p.copies >= need }, { id: 'gold', label: 'Gold', have: save.gold, need: gold, ok: save.gold >= gold }];
}
export const canAfford = (costs: UpgradeCost[]): boolean => costs.length > 0 && costs.every((c) => c.ok);
export const canLevelUp = (save: Save, soul: SoulId): boolean => canAfford(upgradeCosts(save, soul));
/** Pay every cost and gain a level. Returns false (and changes nothing) if the Soul is not ready. */
export function levelUp(save: Save, soul: SoulId): boolean {
  const costs = upgradeCosts(save, soul); if (!canAfford(costs)) return false;
  const p = save.souls[soul]; for (const c of costs) { if (c.id === 'copies') p.copies -= c.need; else save.gold -= c.need; }
  p.level++; return true;
}
/** Debugging: put every Soul back to level 1 (copies are kept). */
export function resetLevels(save: Save): void { for (const k of SOULS) save.souls[k].level = 1; }
/** Debugging: forget all collected copies (levels are kept). */
export function clearCopies(save: Save): void { for (const k of SOULS) save.souls[k].copies = 0; }
/** Multiplier applied to a Soul's health/damage from its permanent level (level 1 = 1.0). */
export const levelMult = (level: number, stat: 'hp' | 'dmg'): number => 1 + (Math.max(1, level) - 1) * BALANCE.level[stat];

// ------------------------------------------------------------------------------------------------ gold
export const GOLD = { tierMult: { easy: 0.6, normal: 1, hard: 1.4, nightmare: 2 } as Record<Difficulty, number>, packPerTier: 1500, dailyWin: 5000 };
/** Gold for clearing one campaign wave: more in later stages and on harder tiers. */
export const waveGold = (stage: string, tier: Difficulty | string): number => Math.max(1, Math.round(100 * (6 + 2 * stageIndex(stage)) * (GOLD.tierMult[tier as Difficulty] ?? 1)));
/** Gold for clearing one Endless wave. */
export const endlessWaveGold = (wave: number): number => 100 * (8 + Math.floor(0.6 * Math.max(1, wave)));
/** Gold for opening a pack that finished at `tier`. */
export const packGold = (tier: number): number => GOLD.packPerTier * Math.max(1, tier);
export function addGold(save: Save, n: number): number { const g = Math.max(0, Math.floor(n)); save.gold = Math.min(1e9, save.gold + g); return g; }
export function addGoldAndSave(n: number, store?: Store | null): number { const s = loadSave(store); const g = addGold(s, n); writeSave(s, store); return g; }

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
  addGold(save, packGold(result.finalTier));
  return result;
}

export interface ClearReward { first: boolean; pack: PackItem | null; replayMeter: number; replayNeeded: number; unlocked: string[] }
/** A stage was cleared on `difficulty`. The first clear on that difficulty grants a better pack; later clears fill the replay meter. */
function recordClearBase(save: Save, stageId: string, difficulty: Difficulty): Omit<ClearReward, 'unlocked'> {
  const key = stageId + ':' + difficulty, before = save.clears[key] ?? 0;
  save.clears[key] = before + 1;
  if (before === 0) return { first: true, pack: grantPack(save, REWARDS.firstClearTier[difficulty] + (stageIndex(stageId) === STAGES.length - 1 ? 1 : 0), 'First clear · ' + difficulty), replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
  save.replayMeter++;
  let pack: PackItem | null = null;
  if (save.replayMeter >= REWARDS.replayClearsPerPack) { save.replayMeter -= REWARDS.replayClearsPerPack; pack = grantPack(save, REWARDS.replayTier[difficulty], 'Replay reward'); }
  return { first: false, pack, replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
}

// ------------------------------------------------------------------------------------------------ persisted wrappers (used by the game bundle)
export function recordClearAndSave(stageId: string, difficulty: Difficulty, store?: Store | null): ClearReward {
  const s = loadSave(store); const r = recordClear(s, stageId, difficulty); writeSave(s, store); return r;
}

// ------------------------------------------------------------------------------------------------ Daily Challenge
export interface DailyReward { first: boolean; pack: PackItem | null; gold: number }
/** The day's challenge was won. Only the first win of a given day pays (a Tier 1 pack and some gold). */
export function recordDailyWin(save: Save, day: number): DailyReward {
  if (save.daily && save.daily.day === day && save.daily.won) return { first: false, pack: null, gold: 0 };
  save.daily = { day, won: true };
  return { first: true, pack: grantPack(save, 1, 'Daily challenge'), gold: addGold(save, GOLD.dailyWin) };
}
export function recordDailyWinAndSave(day: number, store?: Store | null): DailyReward { const s = loadSave(store); const r = recordDailyWin(s, day); writeSave(s, store); return r; }
/** Has today's reward already been taken? */
export const dailyDone = (save: Save, day: number): boolean => !!save.daily && save.daily.day === day && save.daily.won;

// ------------------------------------------------------------------------------------------------ Endless Depths
export interface EndlessReward { wave: number; pack: PackItem | null; newBest: boolean }
/** Wave `wave` of an endless run was cleared: a pack on every 10th wave (better tiers deeper), and the best depth is remembered. */
export function recordEndlessWave(save: Save, wave: number): EndlessReward {
  const newBest = wave > save.endless.best; if (newBest) save.endless.best = wave;
  const pack = wave > 0 && wave % ENDLESS_PACK_EVERY === 0 ? grantPack(save, endlessPackTier(wave), 'Endless · wave ' + wave) : null;
  return { wave, pack, newBest };
}
export function recordEndlessWaveAndSave(wave: number, store?: Store | null): EndlessReward {
  const s = loadSave(store); const r = recordEndlessWave(s, wave); writeSave(s, store); return r;
}
/** Endless Depths opens once the last campaign stage has been cleared on Normal. */
export const endlessUnlocked = (save: Save): boolean => clearCount(save, STAGES[STAGES.length - 1].id, 'normal') > 0;

// ------------------------------------------------------------------------------------------------ unlock rules
// Easy and Normal are open on every unlocked stage. Clearing Normal opens Hard on that stage AND unlocks the next stage. Clearing Hard opens Nightmare.
export const clearCount = (save: Save, stage: string, d: Difficulty): number => save.clears[stage + ':' + d] ?? 0;
export function stageUnlocked(save: Save, index: number): boolean { return index <= 0 || (index < STAGES.length && clearCount(save, STAGES[index - 1].id, 'normal') > 0); }
export function difficultyUnlocked(save: Save, stage: string, d: Difficulty): boolean {
  const idx = STAGES.findIndex((s) => s.id === stage); if (idx < 0 || !stageUnlocked(save, idx)) return false;
  if (d === 'easy' || d === 'normal') return true;
  return d === 'hard' ? clearCount(save, stage, 'normal') > 0 : clearCount(save, stage, 'hard') > 0;
}
/** Why a stage is locked (empty when it is open). */
export function stageLockReason(save: Save, index: number): string { return stageUnlocked(save, index) ? '' : 'Clear ' + STAGES[index - 1].name + ' on Normal to unlock.'; }
/** Why a tier is locked (empty when it is open). */
export function difficultyLockReason(save: Save, stage: string, d: Difficulty): string {
  if (difficultyUnlocked(save, stage, d)) return '';
  const idx = stageIndex(stage); if (!stageUnlocked(save, idx)) return stageLockReason(save, idx);
  return d === 'hard' ? 'Clear ' + stageById(stage).name + ' on Normal to unlock Hard.' : 'Clear ' + stageById(stage).name + ' on Hard to unlock Nightmare.';
}
/** Whatever was saved, make it a stage and tier the player may actually play. */
export function playable(save: Save): { stage: string; difficulty: Difficulty } {
  let idx = stageIndex(save.stage); while (idx > 0 && !stageUnlocked(save, idx)) idx--;
  const stage = STAGES[idx].id;
  return { stage, difficulty: difficultyUnlocked(save, stage, save.difficulty) ? save.difficulty : 'normal' };
}

/** Every unlock the player may be celebrated for: later stages and the Hard / Nightmare tiers (Easy, Normal and Stage 1 are open from the start). */
export function unlockedKeys(save: Save): string[] {
  const keys: string[] = [];
  STAGES.forEach((st, i) => {
    if (i > 0 && stageUnlocked(save, i)) keys.push('stage:' + st.id);
    for (const d of ['hard', 'nightmare'] as Difficulty[]) if (difficultyUnlocked(save, st.id, d)) keys.push('tier:' + st.id + ':' + d);
  });
  if (endlessUnlocked(save)) keys.push('endless');
  return keys;
}
/** Unlocks not yet celebrated. */
export const newUnlocks = (save: Save): string[] => unlockedKeys(save).filter((k) => !(save.seen ?? []).includes(k));
const TIER_NAME: Record<string, string> = { hard: 'Hard mode', nightmare: 'Nightmare mode' };
/** Words for an unlock key, for banners. */
export function describeUnlock(key: string): string {
  if (key === 'endless') return 'Endless Depths (new mode)';
  const [kind, stage, tier] = key.split(':');
  if (kind === 'stage') return stageById(stage).name + ' (new stage)';
  return (TIER_NAME[tier] ?? tier) + ' on ' + stageById(stage).name;
}
/** Clearing a stage: rewards, and which unlocks this clear opened. */
export function recordClear(save: Save, stageId: string, difficulty: Difficulty): ClearReward {
  const before = unlockedKeys(save), r = recordClearBase(save, stageId, difficulty);
  return { ...r, unlocked: unlockedKeys(save).filter((k) => !before.includes(k)) };
}
