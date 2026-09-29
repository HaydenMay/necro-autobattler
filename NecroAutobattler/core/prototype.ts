import { CURVES } from './data.ts';
import type { Rules } from './data.ts';

/**
 * Rules for the playable Stage 1 (10 waves): doc Dominion curve, bonus draw only on the early waves.
 * merge 'handIntoOneStar': a 1-star card in hand can merge straight into a matching deployed 1-star unit (paying only the cost
 * difference). Without it the cap can block a merge you could afford (you would need room to summon BOTH copies first).
 * The debug panel can switch this back to the doc's deployed-only rule.
 */
export const PROTOTYPE_RULES: Rules = { curve: CURVES.doc, merge: 'handIntoOneStar', stageWaves: 10, normalDrawWaves: [2, 3, 4, 5] };
