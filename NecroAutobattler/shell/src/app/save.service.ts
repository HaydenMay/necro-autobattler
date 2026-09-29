import { Injectable, computed, signal } from '@angular/core';
import { DECK_SIZE, loadSave, writeSave } from '../../../core/save.ts';
import type { Save } from '../../../core/save.ts';
import { SOULS } from '../../../core/data.ts';
import type { SoulId } from '../../../core/data.ts';

/** The player's saved progress as signals. The game bundle reads the same localStorage entry when a run starts. */
@Injectable({ providedIn: 'root' })
export class SaveService {
  private state = signal<Save>(loadSave());
  readonly deck = computed(() => this.state().deck);
  readonly deckSize = DECK_SIZE;

  progress(id: SoulId) { return this.state().souls[id]; }
  isEquipped(id: SoulId) { return this.state().deck.includes(id); }

  /** Returns a short message when the change was refused. */
  toggle(id: SoulId): string | null {
    const s = this.state(), deck = s.deck;
    if (deck.includes(id)) {
      if (deck.length <= 1) return 'Keep at least one Soul equipped.';
      this.set({ ...s, deck: deck.filter((d) => d !== id) }); return null;
    }
    if (deck.length >= DECK_SIZE) return `Your deck is full (${DECK_SIZE}). Unequip a Soul first.`;
    this.set({ ...s, deck: [...deck, id] }); return null;
  }
  /** Fill every free slot (the roster is small, so this is usually "everything"). */
  recommended() { this.set({ ...this.state(), deck: SOULS.slice(0, DECK_SIZE) }); }

  private set(s: Save) { this.state.set(s); writeSave(s); }
}
