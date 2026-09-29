import { CURVES } from './data.ts';
import type { Rules } from './data.ts';

/**
 * Rules for the playable Stage 1 (10 waves): doc Dominion curve, bonus draw only on the early waves.
 * merge 'handIntoOneStar': a 1-star card in hand can merge straight into a matching deployed 1-star unit (paying only the cost
 * difference). Without it the cap can block a merge you could afford (you would need room to summon BOTH copies first).
 * The debug panel can switch this back to the doc's deployed-only rule.
 */
export const PROTOTYPE_RULES: Rules = { curve: CURVES.doc, merge: 'handIntoOneStar', stageWaves: 10, normalDrawWaves: [2, 3, 4, 5] };

/**
 * Endless Depths: the campaign's Dominion curve for waves 1-10, then held at 40 (the player's army is capped on purpose; the enemy keeps growing, see endless.ts).
 * The curve is long enough that a run ends by losing hearts, never by "clearing" the stage (core/rules.ts reads curve[wave-1]).
 */
const ENDLESS_LEN = 300;
export const ENDLESS_RULES: Rules = { curve: Array.from({ length: ENDLESS_LEN }, (_, i) => CURVES.doc[Math.min(i, CURVES.doc.length - 1)]), merge: 'handIntoOneStar', stageWaves: ENDLESS_LEN, normalDrawWaves: [2, 3, 4, 5] };
