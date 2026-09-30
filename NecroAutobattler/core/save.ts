// The player's saved progress. Framework-free so the game bundle and the navigation shell both use it.
// Stored in localStorage as JSON. Every read/write is guarded: private windows and blocked storage must never break the game.

import { SOULS } from './data.ts';
import type { SoulId } from './data.ts';
import { PACK_TIERS } from './packs.ts';
import type { PackItem } from './packs.ts';

export const DECK_SIZE = 6;                     // doc: six equipped Souls per stage
const KEY = 'necro-save';
const VERSION = 1;

export type Difficulty = 'easy' | 'normal' | 'hard' | 'nightmare';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'nightmare'];
export interface Settings { music: boolean; sfx: boolean }
export interface SoulProgress { level: number; copies: number }
export interface Save {
  v: number;
  deck: SoulId[];                               // equipped Souls, at most DECK_SIZE, at least 1
  souls: Record<SoulId, SoulProgress>;          // PLACEHOLDER progression until packs exist
  settings: Settings;                           // sound switches; both on by default
  difficulty: Difficulty;                       // chosen on Home; applies to the next run
  stage: string;                                // the stage picked on Home (id from waves.ts STAGES)
  seen: string[] | null;                        // unlock keys whose celebration was already shown (null: older save, seeded on first look)
  packs: PackItem[];                            // unopened Soul Packs
  nextPackId: number;
  clears: Record<string, number>;               // stage clears, keyed 'stage:difficulty'
  replayMeter: number;                          // replay clears toward the next replay pack
  endless: { best: number };                    // Endless Depths: the deepest wave cleared
  gold: number;                                 // spent on Soul level-ups (alongside copies); earned per wave cleared and from opening packs
  daily: { day: number; won: boolean } | null;  // the last Daily Challenge day played and whether its one-time reward was taken
}
/** Gold given once to a save that predates gold and has progress. */
export const CATCH_UP_GOLD = 400;
export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function defaultSave(): Save {
  const souls = {} as Record<SoulId, SoulProgress>;
  for (const id of SOULS) souls[id] = { level: 1, copies: 0 };
  return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls, settings: { music: true, sfx: true }, difficulty: 'normal', stage: 'crypt', seen: [], packs: [], nextPackId: 1, clears: {}, replayMeter: 0, endless: { best: 0 }, gold: 0, daily: null };
}

export function browserStore(): Store | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }

/** Repair whatever was stored: unknown Souls dropped, duplicates removed, deck capped, nothing empty. Old versions keep their progress. */
export function sanitize(raw: any): Save {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const deck: SoulId[] = [];
  if (Array.isArray(raw.deck)) for (const d of raw.deck) if (SOULS.includes(d) && !deck.includes(d) && deck.length < DECK_SIZE) deck.push(d);
  if (deck.length) base.deck = deck;
  if (raw.souls && typeof raw.souls === 'object') {
    for (const id of SOULS) {
      const p = raw.souls[id];
      if (p && Number.isFinite(p.level) && Number.isFinite(p.copies)) base.souls[id] = { level: Math.max(1, Math.floor(p.level)), copies: Math.max(0, Math.floor(p.copies)) };
    }
  }
  if (raw.settings && typeof raw.settings === 'object') {
    if (typeof raw.settings.music === 'boolean') base.settings.music = raw.settings.music;
    if (typeof raw.settings.sfx === 'boolean') base.settings.sfx = raw.settings.sfx;
  }
  if (DIFFICULTIES.includes(raw.difficulty)) base.difficulty = raw.difficulty;
  if (typeof raw.stage === 'string' && /^[a-z0-9_-]{1,24}$/.test(raw.stage)) base.stage = raw.stage;
  if (Array.isArray(raw.seen)) base.seen = raw.seen.filter((k: any) => typeof k === 'string' && k.length < 40).slice(-80);
  else if (raw.clears && typeof raw.clears === 'object' && Object.keys(raw.clears).length) base.seen = null;    // an existing player: do not replay old unlocks
  if (Array.isArray(raw.packs)) {
    const ids = new Set<number>();
    for (const p of raw.packs) {
      if (base.packs.length >= 99 || !p || !Number.isInteger(p.id) || p.id < 1 || ids.has(p.id) || !Number.isInteger(p.tier) || p.tier < 1 || p.tier > PACK_TIERS) continue;
      ids.add(p.id); base.packs.push({ id: p.id, tier: p.tier, source: typeof p.source === 'string' ? p.source.slice(0, 40) : '' });
    }
  }
  const maxId = base.packs.reduce((n, p) => Math.max(n, p.id), 0);
  base.nextPackId = Math.max(maxId + 1, Number.isInteger(raw.nextPackId) && raw.nextPackId > 0 ? raw.nextPackId : 1);
  if (raw.clears && typeof raw.clears === 'object') for (const [k, v] of Object.entries(raw.clears)) if (typeof k === 'string' && k.length < 40 && Number.isInteger(v) && (v as number) > 0) base.clears[k] = v as number;
  if (Number.isInteger(raw.replayMeter) && raw.replayMeter >= 0 && raw.replayMeter < 50) base.replayMeter = raw.replayMeter;
  if (raw.endless && Number.isInteger(raw.endless.best) && raw.endless.best >= 0 && raw.endless.best <= 9999) base.endless.best = raw.endless.best;
  if (Number.isInteger(raw.gold) && raw.gold >= 0 && raw.gold <= 1e9) base.gold = raw.gold;
  else if (raw.gold === undefined && Object.keys(base.clears).length) base.gold = CATCH_UP_GOLD;        // a player from before gold existed: one-time grant so the new cost does not lock their stockpiled copies
  if (raw.daily && Number.isInteger(raw.daily.day) && raw.daily.day > 0 && raw.daily.day < 1e6) base.daily = { day: raw.daily.day, won: !!raw.daily.won };
  return base;
}

export function loadSave(store: Store | null = browserStore()): Save {
  try { const t = store && store.getItem(KEY); return sanitize(t ? JSON.parse(t) : null); } catch { return defaultSave(); }
}

export function writeSave(save: Save, store: Store | null = browserStore()): void {
  try { if (store) store.setItem(KEY, JSON.stringify(save)); } catch { /* storage full or blocked: keep playing */ }
}

/** Change sound settings without touching the rest of the save. */
export function updateSettings(patch: Partial<Settings>, store: Store | null = browserStore()): Settings {
  const s = loadSave(store); s.settings = { ...s.settings, ...patch }; writeSave(s, store); return s.settings;
}

/** Remember the chosen difficulty without touching the rest of the save. */
export function updateDifficulty(d: Difficulty, store: Store | null = browserStore()): Difficulty {
  const s = loadSave(store); s.difficulty = DIFFICULTIES.includes(d) ? d : s.difficulty; writeSave(s, store); return s.difficulty;
}
