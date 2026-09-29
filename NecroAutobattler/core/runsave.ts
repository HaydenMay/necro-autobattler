// Saving a run in progress so it survives a page reload (Safari on a phone can drop the page at any time).
// Only calm moments are saved: the build phase and the victory draft. A battle in progress is not saved; reloading during one puts you back
// at the build screen you pressed Battle from (nothing lost, nothing gained). Everything read back is validated; anything odd is ignored.

import { GRID_CELLS, HEARTS, MAX_STAR, SOULS } from './data.ts';
import type { Rules, SoulId } from './data.ts';
import { makeRng } from './rng.ts';
import type { State, Unit } from './rules.ts';
import { browserStore } from './save.ts';
import type { Store } from './save.ts';

const KEY = 'necro-run';
const VERSION = 1;

export interface SerializedState {
  rules: Rules; rng: { seed: number; pos: number };
  wave: number; hearts: number; cap: number; hand: SoulId[]; units: Unit[]; nextId: number; discardUsed: boolean;
  status: 'building'; log: string[]; stats: State['stats'];
}
export interface RunSnapshot { v: number; seed: number; attempt: number; stage: string; difficulty: string; phase: 'build' | 'draft'; draft: SoulId[] | null; state: SerializedState; startBest?: number }

export function serializeState(s: State): SerializedState {
  return {
    rules: JSON.parse(JSON.stringify(s.rules)), rng: { seed: s.rng.seed, pos: s.rng.state() },
    wave: s.wave, hearts: s.hearts, cap: s.cap, hand: s.hand.slice(), units: s.units.map((u) => ({ ...u })), nextId: s.nextId, discardUsed: s.discardUsed,
    status: 'building', log: s.log.slice(-40), stats: { ...s.stats },
  };
}

const isSoul = (x: any): x is SoulId => SOULS.includes(x);
const int = (x: any, lo: number, hi: number) => Number.isInteger(x) && x >= lo && x <= hi;

/** Rebuild a State from saved data, or null if anything about it is not believable. */
export function deserializeState(x: any): State | null {
  try {
    if (!x || typeof x !== 'object') return null;
    const r = x.rules;
    if (!r || !Array.isArray(r.curve) || !r.curve.length || !r.curve.every((n: any) => Number.isFinite(n) && n > 0)) return null;
    if (r.merge !== 'deployedOnly' && r.merge !== 'handIntoOneStar') return null;
    if (r.pool !== undefined && !(Array.isArray(r.pool) && r.pool.length && r.pool.every(isSoul))) return null;
    const stageWaves = r.stageWaves ?? r.curve.length;
    if (!int(x.wave, 1, Math.min(stageWaves, r.curve.length)) || !int(x.hearts, 1, HEARTS) || !Number.isFinite(x.cap) || x.cap <= 0) return null;
    if (!Array.isArray(x.hand) || x.hand.length > 40 || !x.hand.every(isSoul)) return null;
    if (!Array.isArray(x.units) || x.units.length > GRID_CELLS) return null;
    if (!int(x.nextId, 1, 1e6) || typeof x.discardUsed !== 'boolean') return null;
    const cells = new Set<number>(), ids = new Set<number>(), units: Unit[] = [];
    for (const u of x.units) {
      if (!u || !isSoul(u.soul) || !int(u.star, 1, MAX_STAR) || !int(u.cell, 0, GRID_CELLS - 1) || !int(u.id, 1, x.nextId) || cells.has(u.cell) || ids.has(u.id)) return null;
      cells.add(u.cell); ids.add(u.id); units.push({ id: u.id, soul: u.soul, star: u.star, cell: u.cell, fresh: !!u.fresh });
    }
    const st = x.stats;
    if (!st || !['drawn', 'discarded', 'dismissed', 'merges', 'failures'].every((k) => Number.isFinite(st[k]))) return null;
    if (!x.rng || !Number.isFinite(x.rng.seed) || !Number.isFinite(x.rng.pos)) return null;
    return {
      rules: r as Rules, rng: makeRng(x.rng.seed, x.rng.pos), wave: x.wave, hearts: x.hearts, cap: x.cap, hand: x.hand.slice(), units, nextId: x.nextId,
      discardUsed: x.discardUsed, status: 'building', log: Array.isArray(x.log) ? x.log.filter((l: any) => typeof l === 'string').slice(-40) : [],
      stats: { drawn: st.drawn, discarded: st.discarded, dismissed: st.dismissed, merges: st.merges, failures: st.failures },
    };
  } catch { return null; }
}

export function saveRun(snap: RunSnapshot, store: Store | null = browserStore()): void {
  try { if (store) store.setItem(KEY, JSON.stringify(snap)); } catch { /* storage full or blocked: the run just will not survive a reload */ }
}
export function clearRun(store: Store | null = browserStore()): void {
  try { if (store && (store as any).removeItem) (store as any).removeItem(KEY); else if (store) store.setItem(KEY, ''); } catch { /* ignore */ }
}
export function loadRun(store: Store | null = browserStore()): { snap: RunSnapshot; state: State } | null {
  try {
    const t = store && store.getItem(KEY); if (!t) return null;
    const x = JSON.parse(t);
    if (!x || x.v !== VERSION || (x.phase !== 'build' && x.phase !== 'draft') || !Number.isFinite(x.seed) || !Number.isFinite(x.attempt) || typeof x.difficulty !== 'string') return null;
    const state = deserializeState(x.state); if (!state) return null;
    const draft = x.phase === 'draft' && Array.isArray(x.draft) && x.draft.length === 3 && x.draft.every(isSoul) ? x.draft : null;
    return { snap: { v: VERSION, seed: x.seed, attempt: x.attempt, stage: typeof x.stage === 'string' ? x.stage : 'crypt', difficulty: x.difficulty, phase: draft ? 'draft' : 'build', draft, state: x.state, startBest: Number.isInteger(x.startBest) && x.startBest >= 0 && x.startBest <= 9999 ? x.startBest : undefined }, state };
  } catch { return null; }
}
export const RUN_VERSION = VERSION;
