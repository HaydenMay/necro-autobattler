// Simple stand-in "players" so we can measure the card/Dominion economy without a human.
//  smart: hunts merges, prefers cards that complete a pair, uses the once-per-phase discard on lonely cards.
//  lazy : summons the most expensive thing that fits, merges only when it happens to have a pair, never discards.

import type { SoulId } from '../core/data.ts';
import {
  canMergeDeployed, canMergeFromHand, canSummon, cardsIn, cost, discardRedraw,
  mergeDeployed, mergeFromHand, summon,
} from '../core/rules.ts';
import type { State } from '../core/rules.ts';

export interface Policy {
  name: string;
  draft(s: State, opts: SoulId[]): number;
  build(s: State): void;
}

/** Card-equivalents of a Soul the player currently owns (hand + field). */
function owned(s: State, soul: SoulId): number {
  return s.hand.filter((c) => c === soul).length +
    s.units.filter((u) => u.soul === soul).reduce((n, u) => n + cardsIn(u.star), 0);
}

function mergeAnything(s: State): boolean {
  for (const a of s.units) for (const b of s.units) {
    if (canMergeDeployed(a, b)) return mergeDeployed(s, a.id, b.id);
  }
  for (let i = 0; i < s.hand.length; i++) for (const u of s.units) {
    if (canMergeFromHand(s, i, u.id)) return mergeFromHand(s, i, u.id);
  }
  return false;
}

function summonBest(s: State, score: (i: number) => number): boolean {
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < s.hand.length; i++) {
    if (!canSummon(s, i)) continue;
    const sc = score(i);
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return best >= 0 && summon(s, best);
}

export const smart: Policy = {
  name: 'smart',
  draft(s, opts) {
    let best = 0, bestScore = -1;
    opts.forEach((soul, i) => {
      const w = owned(s, soul);
      // completing a merge threshold (1->2 or 3->4 copies) is worth the most
      const score = (w % 2 === 1 ? 100 : 0) + w * 5 + cost(soul, 1);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  },
  build(s) {
    const settle = () => {
      let acted = true;
      while (acted) {
        acted = mergeAnything(s);
        if (acted) continue;
        acted = summonBest(s, (i) => {
          const soul = s.hand[i];
          const partner = s.units.some((u) => u.soul === soul && u.star === 1) ? 100 : 0;
          const second = s.hand.filter((c) => c === soul).length > 1 ? 20 : 0;
          return partner + second + cost(soul, 1);
        });
      }
    };
    settle();
    if (!s.discardUsed && s.hand.length > 0) {
      let idx = -1, low = Infinity;
      s.hand.forEach((soul, i) => {
        const w = owned(s, soul);
        if (w < low || (w === low && cost(soul, 1) > cost(s.hand[idx], 1))) { low = w; idx = i; }
      });
      if (idx >= 0 && low === 1) { discardRedraw(s, idx); settle(); }
    }
  },
};

export const lazy: Policy = {
  name: 'lazy',
  draft: (s) => s.rng.int(3),
  build(s) {
    let acted = true;
    while (acted) {
      acted = summonBest(s, (i) => cost(s.hand[i], 1));
      if (!acted) acted = mergeAnything(s);
    }
  },
};

export const POLICIES: Record<string, Policy> = { smart, lazy };
