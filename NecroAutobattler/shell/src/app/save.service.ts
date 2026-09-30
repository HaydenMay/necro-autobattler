import { Injectable, computed, signal } from '@angular/core';
import { DECK_SIZE, loadSave, writeSave } from '../../../core/save.ts';
import type { Difficulty, Save, SoulProgress } from '../../../core/save.ts';
import { SOULS } from '../../../core/data.ts';
import type { SoulId } from '../../../core/data.ts';
import { makeRng } from '../../../core/rng.ts';
import { claimMilestone, readyMilestones } from '../../../core/milestones.ts';
import { dailyDone, dailyStreakNow, endlessUnlocked, canLevelUp, clearCopies, clearCount, resetLevels, upgradeCosts, newUnlocks, unlockedKeys, difficultyLockReason, difficultyUnlocked, grantPack, levelUp, openOwnedPack, playable, stageLockReason, stageUnlocked } from '../../../core/progress.ts';
import { STAGES } from '../../../core/waves.ts';
import { dayNumber } from '../../../core/daily.ts';
import type { PackResult } from '../../../core/packs.ts';

/**
 * The player's saved progress as signals. The game bundle writes the same localStorage entry (stage rewards), so every change here is
 * read-modify-write on the stored copy, never on a stale in-memory one, and the signals refresh when the game says something changed.
 */
@Injectable({ providedIn: 'root' })
export class SaveService {
  private state = signal<Save>(loadSave());
  readonly deck = computed(() => this.state().deck);
  readonly deckSize = DECK_SIZE;
  readonly settings = computed(() => this.state().settings);
  /** The stage and tier that the next run will really use (what is saved, clamped to what is unlocked). */
  readonly pick = computed(() => playable(this.state()));
  readonly stage = computed(() => this.pick().stage);
  readonly difficulty = computed(() => this.pick().difficulty);
  stageOpen(index: number): boolean { return stageUnlocked(this.state(), index); }
  stageReason(index: number): string { return stageLockReason(this.state(), index); }
  diffOpen(stage: string, d: Difficulty): boolean { return difficultyUnlocked(this.state(), stage, d); }
  diffReason(stage: string, d: Difficulty): string { return difficultyLockReason(this.state(), stage, d); }
  cleared(stage: string, d: Difficulty): boolean { return clearCount(this.state(), stage, d) > 0; }
  readonly packs = computed(() => this.state().packs);
  readonly gold = computed(() => this.state().gold);
  /** Today's Daily Challenge reward already taken? (checked against the clock each time it is asked) */
  dailyDoneToday(): boolean { return dailyDone(this.state(), dayNumber()); }
  /** Consecutive days with a Daily win that are still alive today. */
  dailyStreak(): number { return dailyStreakNow(this.state(), dayNumber()); }
  readonly snapshot = computed(() => this.state());
  readonly milestonesReady = computed(() => readyMilestones(this.state()));
  claim(id: string) { return this.mutate((s) => claimMilestone(s, id)); }
  readonly replayMeter = computed(() => this.state().replayMeter);
  /** Endless Depths: the deepest wave cleared, and whether the mode is open yet. */
  readonly endlessBest = computed(() => this.state().endless.best);
  readonly endlessOpen = computed(() => endlessUnlocked(this.state()));
  /** How many Souls have enough copies to level up right now (shown as a badge on the Souls tab). */
  readonly readyCount = computed(() => SOULS.filter((s) => canLevelUp(this.state(), s)).length);

  constructor() {
    const refresh = () => this.state.set(loadSave());
    window.addEventListener('necro-settings', refresh); window.addEventListener('necro-save-changed', refresh); window.addEventListener('storage', refresh);
  }

  private mutate<T>(fn: (s: Save) => T): T { const s = loadSave(); const r = fn(s); writeSave(s); this.state.set(s); return r; }

  /** Returns the reason when the tier is locked, otherwise null. */
  setDifficulty(d: Difficulty): string | null {
    const why = difficultyLockReason(this.state(), this.stage(), d); if (why) return why;
    this.mutate((s) => { s.difficulty = d; s.stage = this.stage(); }); return null;
  }
  /** Returns the reason when the stage is locked, otherwise null. Keeps the tier if it is open there, otherwise falls back to Normal. */
  setStage(id: string): string | null {
    const idx = STAGES.findIndex((s) => s.id === id); if (idx < 0) return 'Unknown stage.';
    const why = stageLockReason(this.state(), idx); if (why) return why;
    this.mutate((s) => { s.stage = id; if (!difficultyUnlocked(s, id, s.difficulty)) s.difficulty = 'normal'; }); return null;
  }
  /** Unlocks the player has not yet been shown. An older save (seen === null) is seeded silently so old unlocks are not replayed. */
  freshUnlocks(): string[] {
    if (this.state().seen === null) { this.mutate((s) => { s.seen = unlockedKeys(s); }); return []; }
    return newUnlocks(this.state());
  }
  markSeen(keys: string[]) { if (keys.length) this.mutate((s) => { s.seen = [...new Set([...(s.seen ?? []), ...keys])].slice(-80); }); }
  /** Testing helper: pretend a stage tier was cleared (Settings > Testing helpers). */
  grantTestClear(stage: string, d: Difficulty) { this.mutate((s) => { const k = stage + ':' + d; s.clears[k] = (s.clears[k] ?? 0) + 1; }); }
  /** Music / sound-effect switch. The game's audio engine picks the change up through the event. */
  setSound(which: 'music' | 'sfx', on: boolean) { this.mutate((s) => { s.settings = { ...s.settings, [which]: on }; }); window.dispatchEvent(new Event('necro-settings-changed')); }

  /** A save nobody has played yet (no clears, packs or levels): the first-time tutorial is for these. */
  isFresh(): boolean { const s = this.state(); return Object.keys(s.clears).length === 0 && s.packs.length === 0 && s.nextPackId === 1 && s.endless.best === 0 && SOULS.every((k) => s.souls[k].level === 1 && s.souls[k].copies === 0); }
  /** The one-time gift at the end of the tutorial. */
  grantWelcomePack() { this.mutate((s) => grantPack(s, 1, 'Welcome gift')); }
  progress(id: SoulId): SoulProgress { return this.state().souls[id]; }
  isEquipped(id: SoulId) { return this.state().deck.includes(id); }

  /** Returns a short message when the change was refused. */
  toggle(id: SoulId): string | null {
    return this.mutate((s) => {
      if (s.deck.includes(id)) {
        if (s.deck.length <= 1) return 'Keep at least one Soul equipped.';
        s.deck = s.deck.filter((d) => d !== id); return null;
      }
      if (s.deck.length >= DECK_SIZE) return `Your deck is full (${DECK_SIZE}). Unequip a Soul first.`;
      s.deck = [...s.deck, id]; return null;
    });
  }
  /** Fill every free slot (the roster is small, so this is usually "everything"). */
  recommended() { this.mutate((s) => { s.deck = SOULS.slice(0, DECK_SIZE); }); }

  // ---- packs and levels
  /** Testing helper (Settings > Developer). */
  grantTestPack(tier: number) { this.mutate((s) => grantPack(s, tier, 'Test pack')); }
  grantTestCopies(n: number) { this.mutate((s) => { for (const k of SOULS) s.souls[k].copies += n; }); }
  /** Open an owned pack. The copies are added to the save right away; the result is what the opening animation plays. */
  openPack(id: number): { result: PackResult; before: Record<SoulId, SoulProgress> } | null {
    return this.mutate((s) => {
      const before = JSON.parse(JSON.stringify(s.souls)) as Record<SoulId, SoulProgress>;
      const result = openOwnedPack(s, id, makeRng((Math.random() * 4294967296) >>> 0));
      return result ? { result, before } : null;
    });
  }
  levelUp(soul: SoulId): boolean { return this.mutate((s) => levelUp(s, soul)); }
  /** What upgrading this Soul costs right now (copies today, gold later). */
  costs(soul: SoulId) { return upgradeCosts(this.state(), soul); }
  /** Debugging helpers (Settings > Testing helpers). */
  resetLevels() { this.mutate((s) => resetLevels(s)); }
  clearCopies() { this.mutate((s) => clearCopies(s)); }
}
