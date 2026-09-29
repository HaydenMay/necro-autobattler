// Pure game rules for one stage. No graphics, no combat: just cards, Dominion, grid, merge, waves, hearts.
// Every mutation goes through a function here and appends to state.log, so runs can be replayed and inspected.

import { COST, GRID_CELLS, HEARTS, MAX_STAR, SOULS, START_HAND, WAVES } from './data.ts';
import type { Rules, SoulId } from './data.ts';
import { makeRng } from './rng.ts';
import type { Rng } from './rng.ts';

export interface Unit { id: number; soul: SoulId; star: number; cell: number; fresh?: boolean }   // fresh = summoned this build phase

export interface State {
  rules: Rules;
  rng: Rng;
  wave: number;                 // 1-based
  hearts: number;
  cap: number;
  hand: SoulId[];
  units: Unit[];
  nextId: number;
  discardUsed: boolean;         // once-per-build-phase redraw
  status: 'building' | 'won' | 'lost';
  log: string[];
  stats: { drawn: number; discarded: number; dismissed: number; merges: number; failures: number };
}

export const cost = (soul: SoulId, star: number): number => COST[soul][star - 1];
export const cardsIn = (star: number): number => 2 ** (star - 1);     // cards a unit is "worth"
export const dominionUsed = (s: State): number => s.units.reduce((n, u) => n + cost(u.soul, u.star), 0);
export const dominionFree = (s: State): number => s.cap - dominionUsed(s);

function log(s: State, msg: string) { s.log.push(`[w${s.wave}] ${msg}`); }
/** The Souls this run draws from: the equipped deck, or everything if no deck was given. */
export const poolOf = (s: State): SoulId[] => (s.rules.pool && s.rules.pool.length ? s.rules.pool : SOULS);
function draw(s: State, why: string, not?: SoulId): SoulId {
  const all = poolOf(s), others = not ? all.filter((x) => x !== not) : all;
  const pool = others.length ? others : all;                       // a swap never hands you back the Soul you gave up (unless it is the only one equipped)
  const c = s.rng.pick(pool);
  s.hand.push(c); s.stats.drawn++;
  log(s, `draw ${c} (${why})`);
  return c;
}

/** A new build phase begins: the once-per-phase swap comes back and nothing counts as "summoned this round". */
export function newPhase(s: State): void {
  s.discardUsed = false;
  for (const u of s.units) u.fresh = false;
}

export function newStage(rules: Rules, seed: number): State {
  const s: State = {
    rules, rng: makeRng(seed), wave: 1, hearts: HEARTS, cap: rules.curve[0], hand: [], units: [], nextId: 1,
    discardUsed: false, status: 'building', log: [],
    stats: { drawn: 0, discarded: 0, dismissed: 0, merges: 0, failures: 0 },
  };
  for (let i = 0; i < (rules.startHand ?? START_HAND); i++) draw(s, 'starting hand');
  return s;
}

export function freeCell(s: State): number {
  const taken = new Set(s.units.map((u) => u.cell));
  for (let c = 0; c < GRID_CELLS; c++) if (!taken.has(c)) return c;
  return -1;
}

// ---- build-phase actions (each returns true when it happened) ---------------------------------

export function canSummon(s: State, handIdx: number): boolean {
  const soul = s.hand[handIdx];
  return soul !== undefined && freeCell(s) >= 0 && cost(soul, 1) <= dominionFree(s);
}

export function cellFree(s: State, cell: number): boolean {
  return cell >= 0 && cell < GRID_CELLS && !s.units.some((u) => u.cell === cell);
}

/** Summon a hand card onto a specific free cell (default: the first free one). */
export function summon(s: State, handIdx: number, cell?: number): boolean {
  if (!canSummon(s, handIdx)) return false;
  if (cell !== undefined && !cellFree(s, cell)) return false;
  const soul = s.hand.splice(handIdx, 1)[0];
  const u: Unit = { id: s.nextId++, soul, star: 1, cell: cell ?? freeCell(s), fresh: true };
  s.units.push(u);
  log(s, `summon ${soul} 1* -> cell ${u.cell}  (dominion ${dominionUsed(s)}/${s.cap})`);
  return true;
}

export function canMergeDeployed(a: Unit, b: Unit): boolean {
  return a.id !== b.id && a.soul === b.soul && a.star === b.star && a.star < MAX_STAR;
}

export function mergeDeployed(s: State, aId: number, bId: number): boolean {
  const a = s.units.find((u) => u.id === aId), b = s.units.find((u) => u.id === bId);
  if (!a || !b || !canMergeDeployed(a, b)) return false;
  s.units = s.units.filter((u) => u.id !== b.id);
  a.fresh = !!(a.fresh || b.fresh);
  a.star++;
  s.stats.merges++;
  log(s, `merge ${a.soul} ${a.star - 1}*+${a.star - 1}* -> ${a.star}*  (dominion ${dominionUsed(s)}/${s.cap}, cells ${s.units.length}/${GRID_CELLS})`);
  return true;
}

/** 'handIntoOneStar' rule: play a 1-star card onto a deployed 1-star unit of the same Soul. */
export function canMergeFromHand(s: State, handIdx: number, unitId: number): boolean {
  if (s.rules.merge !== 'handIntoOneStar') return false;
  const soul = s.hand[handIdx], u = s.units.find((x) => x.id === unitId);
  if (!soul || !u || u.soul !== soul || u.star !== 1) return false;
  return cost(soul, 2) - cost(soul, 1) <= dominionFree(s);
}

export function mergeFromHand(s: State, handIdx: number, unitId: number): boolean {
  if (!canMergeFromHand(s, handIdx, unitId)) return false;
  const soul = s.hand.splice(handIdx, 1)[0];
  const u = s.units.find((x) => x.id === unitId)!;
  u.star = 2;
  s.stats.merges++;
  log(s, `merge-from-hand ${soul} -> ${u.soul} 2*  (dominion ${dominionUsed(s)}/${s.cap})`);
  return true;
}

export function dismiss(s: State, unitId: number): boolean {
  const u = s.units.find((x) => x.id === unitId);
  if (!u) return false;
  s.units = s.units.filter((x) => x.id !== unitId);
  s.stats.dismissed += cardsIn(u.star);
  log(s, `dismiss ${u.soul} ${u.star}* (permanently removed)`);
  return true;
}

/** Swap (once per build phase), option 1: discard a hand card and draw a random card of a DIFFERENT Soul. */
export function discardRedraw(s: State, handIdx: number): boolean {
  if (s.discardUsed || handIdx < 0 || handIdx >= s.hand.length) return false;
  const c = s.hand.splice(handIdx, 1)[0];
  s.discardUsed = true; s.stats.discarded++;
  log(s, `swap: discard ${c}`);
  draw(s, 'swap', c);
  return true;
}
export const swapDiscard = discardRedraw;

export function canSwapSell(s: State, unitId: number): boolean {
  const u = s.units.find((x) => x.id === unitId);
  return !s.discardUsed && !!u && !u.fresh;          // can't sell a unit you summoned this round
}

/** Swap (once per build phase), option 2: sell a deployed unit (not one summoned this round) and draw a card of a DIFFERENT Soul. */
export function swapSell(s: State, unitId: number): boolean {
  if (!canSwapSell(s, unitId)) return false;
  const u = s.units.find((x) => x.id === unitId)!;
  s.units = s.units.filter((x) => x.id !== unitId);
  s.discardUsed = true; s.stats.dismissed += cardsIn(u.star);
  log(s, `swap: sell ${u.soul} ${u.star}*`);
  draw(s, 'swap', u.soul);
  return true;
}

export function moveUnit(s: State, unitId: number, cell: number): boolean {
  const u = s.units.find((x) => x.id === unitId);
  if (!u || !cellFree(s, cell)) return false;
  log(s, `move ${u.soul} cell ${u.cell} -> ${cell}`); u.cell = cell; return true;
}

// ---- wave results -------------------------------------------------------------------------------

/** Draft choices for after a cleared wave: 3 random cards, duplicates allowed. */
export function draftOptions(s: State): SoulId[] {
  const p = poolOf(s);
  return [s.rng.pick(p), s.rng.pick(p), s.rng.pick(p)];
}

/** Wave cleared: raise the cap, resolve the Victory Draft, draw 1 normal card. */
export const stageWaves = (s: State): number => s.rules.stageWaves ?? WAVES;

/** Step 1 of a cleared wave: is the stage over? If not, raise the cap and start the next build phase. Returns true when the stage is won. */
export function advanceWave(s: State): boolean {
  if (s.status !== 'building') return s.status === 'won';
  if (s.wave >= stageWaves(s)) { s.status = 'won'; log(s, 'stage cleared'); return true; }
  s.wave++;
  s.cap = s.rules.curve[s.wave - 1];
  newPhase(s);
  log(s, `wave cleared -> cap ${s.cap}`);
  return false;
}

/** Step 2: the player kept `idx` from the offered draft cards. */
export function takeDraft(s: State, opts: SoulId[], idx: number): void {
  const pick = opts[Math.max(0, Math.min(opts.length - 1, idx))];
  s.hand.push(pick); s.stats.drawn++;
  log(s, `draft [${opts.join(', ')}] -> took ${pick}`);
}

/** Step 3: the bonus normal draw (only on the waves the rules allow). */
export function normalDraw(s: State): void {
  if (s.rules.normalDrawWaves ? s.rules.normalDrawWaves.includes(s.wave) : true) draw(s, 'wave clear');
}

/** Wave cleared (all three steps in one call, for simulations). */
export function clearWave(s: State, choose: (opts: SoulId[]) => number): void {
  if (advanceWave(s)) return;
  if (s.status !== 'building') return;
  let opts = draftOptions(s);
  const offered = opts.join(', ');
  const took: SoulId[] = [];
  for (let p = 0; p < (s.rules.draftPicks ?? 1); p++) {
    const idx = Math.max(0, Math.min(opts.length - 1, choose(opts)));
    took.push(opts[idx]); s.hand.push(opts[idx]); s.stats.drawn++;
    opts = opts.filter((_, i) => i !== idx);
  }
  log(s, `draft [${offered}] -> took ${took.join(', ')}`);
  normalDraw(s);
}

/** Army wiped: lose a heart, cap does NOT rise, enemies reset, +1 card, redraw allowed again. */
export function failWave(s: State): void {
  if (s.status !== 'building') return;
  s.hearts--; s.stats.failures++;
  if (s.hearts <= 0) { s.status = 'lost'; log(s, 'no hearts left: stage lost'); return; }
  newPhase(s);
  log(s, `army wiped: hearts ${s.hearts}, cap stays ${s.cap}`);
  draw(s, 'failed attempt');
}

// ---- invariants (called by the simulator after every wave; throw with a readable message) -------

export function checkInvariants(s: State): void {
  const fail = (m: string) => { throw new Error(`INVARIANT ${m}\n` + s.log.slice(-12).join('\n')); };
  if (s.units.length > GRID_CELLS) fail(`more units (${s.units.length}) than cells`);
  const cells = new Set(s.units.map((u) => u.cell));
  if (cells.size !== s.units.length) fail('two units share a cell');
  if (dominionUsed(s) > s.cap) fail(`dominion ${dominionUsed(s)} exceeds cap ${s.cap}`);
  for (const u of s.units) if (u.star < 1 || u.star > MAX_STAR) fail(`unit star ${u.star} out of range`);
  // every drawn card is either in hand, worth cards on the field, discarded, or dismissed
  const onField = s.units.reduce((n, u) => n + cardsIn(u.star), 0);
  const accounted = s.hand.length + onField + s.stats.discarded + s.stats.dismissed;
  if (accounted !== s.stats.drawn) fail(`card conservation: drawn ${s.stats.drawn} != accounted ${accounted}`);
}
