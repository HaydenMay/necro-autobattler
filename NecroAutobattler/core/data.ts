// Design data straight from the plan doc. Anything marked PLACEHOLDER is not in the doc yet.

export type SoulId = 'warrior' | 'archer' | 'goblin' | 'knight' | 'ogre' | 'barbarian';

export const SOULS: SoulId[] = ['warrior', 'archer', 'goblin', 'knight', 'ogre', 'barbarian'];

/** Dominion cost per star level: index 0 = 1 star, 1 = 2 stars, 2 = 3 stars (3 stars is the max). */
export const COST: Record<SoulId, number[]> = {
  warrior: [2, 3, 4],
  archer: [4, 6, 9],
  goblin: [3, 4, 6],
  knight: [5, 7, 10],
  ogre: [7, 10, 15],
  barbarian: [5, 7, 10], // PLACEHOLDER: the doc has no cost for the sixth Soul yet
};

export const MAX_STAR = 3;
export const GRID_CELLS = 12; // 4 x 3

/** Dominion cap per wave (index 0 = wave 1). */
export const CURVES: Record<string, number[]> = {
  // LOCKED (confirmed): +4 for waves 2-5, then +3 for waves 6-10 -> 40
  doc: [9, 13, 17, 21, 25, 28, 31, 34, 37, 40],
  // NOT USED: misremembered variant (+3 through wave 6, then +2) that only reaches 32. Kept for comparison only.
  recalled: [9, 12, 15, 18, 21, 24, 26, 28, 30, 32],
};

export const HEARTS = 3;
export const START_HAND = 4;
export const WAVES = 10;

export interface Rules {
  /** Dominion cap per wave. */
  curve: number[];
  /**
   * 'deployedOnly': only two deployed units of the same star can merge (doc as written).
   * 'handIntoOneStar': additionally a 1-star card in hand can be played onto a deployed
   * 1-star unit of the same Soul to merge immediately (pays only the cost difference).
   */
  merge: 'deployedOnly' | 'handIntoOneStar';
  /** Card-inflow knobs (all optional; defaults reproduce the doc). */
  startHand?: number;            // default 4
  draftPicks?: number;           // cards kept from the 3-card Victory Draft, default 1
  normalDrawWaves?: number[];    // waves (being entered) that also give the normal random draw; default = all
  /** Souls this run may draw from (the equipped Soul Deck, max 6). Default: every Soul. */
  pool?: SoulId[];
  stageWaves?: number;           // waves in this stage; default 10 (the playable prototype uses 3)
}

export const GRID_COLS = 4, GRID_ROWS = 3;   // 4 x 3 = GRID_CELLS; column GRID_COLS-1 is the front line
