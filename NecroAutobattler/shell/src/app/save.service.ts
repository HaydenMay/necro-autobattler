import { Injectable, computed, signal } from '@angular/core';
import { DECK_SIZE, loadSave, writeSave } from '../../../core/save.ts';
import type { Difficulty, Save, SoulProgress } from '../../../core/save.ts';
import { SOULS } from '../../../core/data.ts';
import type { SoulId } from '../../../core/data.ts';
import { makeRng } from '../../../core/rng.ts';
import { canLevelUp, grantPack, levelUp, openOwnedPack } from '../../../core/progress.ts';
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
  readonly difficulty = computed(() => this.state().difficulty);
  readonly packs = computed(() => this.state().packs);
  readonly replayMeter = computed(() => this.state().replayMeter);
  /** How many Souls have enough copies to level up right now (shown as a badge on the Souls tab). */
  readonly readyCount = computed(() => SOULS.filter((s) => canLevelUp(this.state(), s)).length);

  constructor() {
    const refresh = () => this.state.set(loadSave());
    window.addEventListener('necro-settings', refresh); window.addEventListener('necro-save-changed', refresh); window.addEventListener('storage', refresh);
  }

  private mutate<T>(fn: (s: Save) => T): T { const s = loadSave(); const r = fn(s); writeSave(s); this.state.set(s); return r; }

  setDifficulty(d: Difficulty) { this.mutate((s) => { s.difficulty = d; }); }
  /** Music / sound-effect switch. The game's audio engine picks the change up through the event. */
  setSound(which: 'music' | 'sfx', on: boolean) { this.mutate((s) => { s.settings = { ...s.settings, [which]: on }; }); window.dispatchEvent(new Event('necro-settings-changed')); }

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
}
