// Plays one stage as a "perfect run" (every wave is cleared) and records what the player had to work with.

import { GRID_CELLS, WAVES } from '../core/data.ts';
import type { Rules, SoulId } from '../core/data.ts';
import { cardsIn, checkInvariants, clearWave, dominionUsed, newStage } from '../core/rules.ts';
import type { State } from '../core/rules.ts';
import type { Policy } from './policies.ts';

export interface Snapshot {
  wave: number; cap: number; used: number; bodies: number;
  star1: number; star2: number; star3: number;
  cardsOnField: number; handLeft: number; mergesSoFar: number; drawnSoFar: number;
}

export function snapshot(s: State): Snapshot {
  return {
    wave: s.wave, cap: s.cap, used: dominionUsed(s), bodies: s.units.length,
    star1: s.units.filter((u) => u.star === 1).length,
    star2: s.units.filter((u) => u.star === 2).length,
    star3: s.units.filter((u) => u.star === 3).length,
    cardsOnField: s.units.reduce((n, u) => n + cardsIn(u.star), 0),
    handLeft: s.hand.length, mergesSoFar: s.stats.merges, drawnSoFar: s.stats.drawn,
  };
}

const ABBR: Record<SoulId, string> = { warrior: 'WAR', archer: 'ARC', goblin: 'GOB', knight: 'KNI', ogre: 'OGR', barbarian: 'BAR' };

/** 4x3 ASCII view of the formation, for pasting into chat when debugging. */
export function renderGrid(s: State): string {
  const rows: string[] = [];
  for (let r = 0; r < GRID_CELLS / 4; r++) {
    const cells: string[] = [];
    for (let c = 0; c < 4; c++) {
      const u = s.units.find((x) => x.cell === r * 4 + c);
      cells.push(u ? `${ABBR[u.soul]}${u.star}` : ' . ');
    }
    rows.push('  ' + cells.join(' | '));
  }
  return rows.join('\n');
}

export function playPerfectRun(rules: Rules, policy: Policy, seed: number, onWave?: (s: State, snap: Snapshot) => void) {
  const s = newStage(rules, seed);
  const snaps: Snapshot[] = [];
  for (let w = 1; w <= WAVES; w++) {
    policy.build(s);
    checkInvariants(s);
    const snap = snapshot(s);
    snaps.push(snap);
    if (onWave) onWave(s, snap);
    clearWave(s, (opts) => policy.draft(s, opts));
  }
  return { state: s, snaps };
}
