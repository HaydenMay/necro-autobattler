// Milestones: one-time rewards for long-term goals (clear every stage on a tier, Endless depth, Soul levels, Daily wins, total clears).
// Progress is worked out from the save, so nothing extra is tracked except which ones were claimed.

import { SOULS } from './data.ts';
import type { Save } from './save.ts';
import type { PackItem } from './packs.ts';
import { STAGES } from './waves.ts';
import { addGold, clearCount, grantPack } from './progress.ts';

export interface Milestone { id: string; name: string; text: string; need: number; have: (s: Save) => number; tier: number; gold: number }

const totalClears = (s: Save): number => Object.values(s.clears).reduce((n, v) => n + v, 0);
const stagesCleared = (s: Save, d: 'normal' | 'hard' | 'nightmare'): number => STAGES.filter((st) => clearCount(s, st.id, d) > 0).length;
const levels = (s: Save): number[] => SOULS.map((k) => s.souls[k].level);

export const MILESTONES: Milestone[] = [
  { id: 'clear-normal', name: 'Stage Breaker', text: 'Clear every stage on Normal', need: STAGES.length, have: (s) => stagesCleared(s, 'normal'), tier: 2, gold: 6000 },
  { id: 'clear-hard', name: 'Hard Earned', text: 'Clear every stage on Hard', need: STAGES.length, have: (s) => stagesCleared(s, 'hard'), tier: 3, gold: 12000 },
  { id: 'clear-nightmare', name: 'Nightmare Fuel', text: 'Clear every stage on Nightmare', need: STAGES.length, have: (s) => stagesCleared(s, 'nightmare'), tier: 3, gold: 30000 },
  { id: 'clears-25', name: 'Regular', text: 'Clear stages 25 times', need: 25, have: totalClears, tier: 1, gold: 4000 },
  { id: 'clears-100', name: 'Veteran', text: 'Clear stages 100 times', need: 100, have: totalClears, tier: 2, gold: 12000 },
  { id: 'clears-250', name: 'Grave Warden', text: 'Clear stages 250 times', need: 250, have: totalClears, tier: 2, gold: 30000 },
  { id: 'endless-10', name: 'Into the Depths', text: 'Reach Endless wave 10', need: 10, have: (s) => s.endless.best, tier: 1, gold: 4000 },
  { id: 'endless-20', name: 'Deeper Still', text: 'Reach Endless wave 20', need: 20, have: (s) => s.endless.best, tier: 2, gold: 8000 },
  { id: 'endless-30', name: 'Abyss Walker', text: 'Reach Endless wave 30', need: 30, have: (s) => s.endless.best, tier: 2, gold: 16000 },
  { id: 'endless-40', name: 'Bottomless', text: 'Reach Endless wave 40', need: 40, have: (s) => s.endless.best, tier: 3, gold: 30000 },
  { id: 'soul-5', name: 'Seasoned', text: 'Get a Soul to level 5', need: 5, have: (s) => Math.max(...levels(s)), tier: 1, gold: 4000 },
  { id: 'all-5', name: 'Seasoned Army', text: 'Get every Soul to level 5', need: 5, have: (s) => Math.min(...levels(s)), tier: 2, gold: 12000 },
  { id: 'soul-10', name: 'Fully Risen', text: 'Get a Soul to level 10', need: 10, have: (s) => Math.max(...levels(s)), tier: 3, gold: 20000 },
  { id: 'daily-5', name: 'Daily Habit', text: 'Win 5 Daily Challenges', need: 5, have: (s) => s.dailyWins, tier: 1, gold: 5000 },
  { id: 'daily-15', name: 'Creature of Habit', text: 'Win 15 Daily Challenges', need: 15, have: (s) => s.dailyWins, tier: 2, gold: 12000 },
  { id: 'daily-30', name: 'Never Missed', text: 'Win 30 Daily Challenges', need: 30, have: (s) => s.dailyWins, tier: 3, gold: 25000 },
];

export const isClaimed = (s: Save, id: string): boolean => s.claimed.includes(id);
export const milestoneProgress = (s: Save, m: Milestone): number => Math.min(m.need, Math.max(0, m.have(s)));
export const milestoneReady = (s: Save, m: Milestone): boolean => !isClaimed(s, m.id) && m.have(s) >= m.need;
export const readyMilestones = (s: Save): number => MILESTONES.filter((m) => milestoneReady(s, m)).length;

/** Take a finished milestone's reward once. Returns null when it is not ready or the pack shelf is full (it stays claimable). */
export function claimMilestone(s: Save, id: string): { pack: PackItem; gold: number } | null {
  const m = MILESTONES.find((x) => x.id === id); if (!m || !milestoneReady(s, m)) return null;
  const pack = grantPack(s, m.tier, 'Milestone · ' + m.name); if (!pack) return null;
  s.claimed.push(m.id); return { pack, gold: addGold(s, m.gold) };
}
