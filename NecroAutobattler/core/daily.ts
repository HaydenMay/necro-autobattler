// The Daily Challenge: Stage 1 (Normal) with ONE twist that changes every day. Everyone gets the same twist and the same seed on the same day
// (both come from the calendar date, so no server is needed). Retry as often as you like; the reward (a pack and some gold) is paid once per day.

import { COST, CURVES } from './data.ts';
import type { Rules } from './data.ts';
import { PROTOTYPE_RULES } from './prototype.ts';
import type { EnemySpec } from './waves.ts';
import { waveCost } from './waves.ts';

export const DAILY_ID = 'daily';

export interface DailyMod {
  id: string; name: string; text: string;
  power: number;                        // hidden enemy health/damage multiplier for the day
  capDelta: number;                     // change to the player's Dominion every wave (never below DAILY_MIN_CAP)
  enemy?: (w: EnemySpec[], wave: number) => EnemySpec[];   // rewrites each enemy wave
}
export const DAILY_MIN_CAP = 4;
const MAX_UNITS = 12;

/** A crowd of Warriors and Goblins that costs about `budget` Dominion. */
function crowd(budget: number): EnemySpec[] {
  const out: EnemySpec[] = []; let left = budget;
  for (let i = 0; out.length < MAX_UNITS; i++) {
    const soul = i % 3 === 2 ? 'goblin' : 'warrior'; if (COST[soul][0] > left) break;
    out.push({ soul, star: 1 }); left -= COST[soul][0];
  }
  return out.length ? out : [{ soul: 'warrior', star: 1 }];
}

export const MODIFIERS: DailyMod[] = [
  { id: 'empowered', name: 'Empowered', text: 'Enemies are 25% stronger.', power: 1.25, capDelta: 0 },
  { id: 'melee', name: 'No Archers', text: 'Enemy Archers are replaced by Warriors, but everyone hits harder.', power: 1.15, capDelta: 0,
    enemy: (w) => w.map((e) => (e.soul === 'archer' ? { soul: 'warrior' as const, star: e.star } : e)) },
  { id: 'swarm', name: 'Swarm', text: 'Waves are crowds of Warriors and Goblins.', power: 0.85, capDelta: 0,
    enemy: (w) => crowd(Math.round(waveCost(w) * 1.15)) },
  { id: 'cramped', name: 'Cramped', text: 'Your Dominion is 4 lower every wave.', power: 1, capDelta: -4 },
  { id: 'veterans', name: 'Veterans', text: 'Enemy Ogres and Knights are a star higher.', power: 0.9, capDelta: 0,
    enemy: (w) => w.map((e) => (e.soul === 'ogre' || e.soul === 'knight' ? { soul: e.soul, star: Math.min(3, e.star + 1) } : e)) },
];

/** Whole days since 1 January 1970 in the player's own calendar (the day changes at their midnight). */
export const dayNumber = (d: Date = new Date()): number => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
export const isValidDay = (n: number): boolean => Number.isInteger(n) && n > 0 && n < 1e6;
export const modifierFor = (day: number): DailyMod => MODIFIERS[((day % MODIFIERS.length) + MODIFIERS.length) % MODIFIERS.length];
/** The player's rules for the day: the campaign's Dominion curve, shifted by the modifier. */
export function dailyRules(mod: DailyMod, pool: Rules['pool']): Rules {
  return { ...PROTOTYPE_RULES, curve: CURVES.doc.map((c) => Math.max(DAILY_MIN_CAP, c + mod.capDelta)), pool };
}
