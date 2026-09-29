// The player's saved progress. Framework-free so the game bundle and the navigation shell both use it.
// Stored in localStorage as JSON. Every read/write is guarded: private windows and blocked storage must never break the game.

import { SOULS } from './data.ts';
import type { SoulId } from './data.ts';

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
}
export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function defaultSave(): Save {
  const souls = {} as Record<SoulId, SoulProgress>;
  for (const id of SOULS) souls[id] = { level: 1, copies: 0 };
  return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls, settings: { music: true, sfx: true }, difficulty: 'normal' };
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
