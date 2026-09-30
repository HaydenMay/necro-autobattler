// Enemy waves and the campaign's stages. Same unit pool as the player. The build screen previews the COMPOSITION only, never positions.
//
// Each STAGE has four difficulty tiers (easy / normal / hard / nightmare). Later stages are harder: they reuse tougher wave lists and a hidden
// ENEMY POWER multiplier (health and damage of enemy units) tuned per stage and tier with sim/calibrate_power.ts, so that the competent
// stand-in player clears each tier about 60% of the time at that tier's RECOMMENDED SOUL LEVEL (every Soul at that level).
// Unlock rules live in progress.ts: Easy and Normal are always open; clearing Normal opens Hard and the next stage; clearing Hard opens Nightmare.

import { COST, CURVES, SOULS } from './data.ts';
import type { SoulId } from './data.ts';
import { ENDLESS_ID, endlessPower, endlessWave } from './endless.ts';
import { makeRng } from './rng.ts';

export interface EnemySpec { soul: SoulId; star: number; boss?: boolean }
export type Diff = 'easy' | 'normal' | 'hard' | 'nightmare';
export const DIFFS: Diff[] = ['easy', 'normal', 'hard', 'nightmare'];

const LETTER: Record<string, SoulId> = { W: 'warrior', A: 'archer', G: 'goblin', K: 'knight', O: 'ogre', B: 'barbarian' };
const parseWave = (s: string): EnemySpec[] => s.split(' ').map((t) => ({ soul: LETTER[t[0]], star: +t[1] }));

/**
 * Wave lists (W warrior, A archer, G goblin, K knight, O ogre, B barbarian; digit = stars). These four were tuned for Stage 1; later stages
 * reuse them one tier up and add enemy power. Hard and Nightmare are volume-driven (up to 12 enemies).
 * Competent stand-in clear rate with EVERY Soul at level 1 / 4 / 6: easy 98/100/100, normal 82/98/100, hard 7/60/87, nightmare 0/33/74.
 */
export const DIFFICULTY: Record<string, string[]> = {
  easy: ['W1', 'K1 W1', 'O1 W1 G1', 'K1 A1 W1', 'O1 A1 G1', 'K1 O1 A1', 'K1 O1 A1 G1', 'O1 K1 A1 G1', 'O1 K1 A1 B1', 'O2 K1 A1 G1'],
  normal: ['W1 A1', 'K1 G1 W1', 'O1 A1 G1 W1', 'K1 O1 A1 W1', 'O1 K1 A1 G1 W1', 'A2 K1 O1 G1 W1', 'K1 O1 A1 G1 W1', 'O1 K1 A1 B1 G1', 'O1 K1 A2 B1 G1', 'O2 K1 A1 B1 G1 W1'],
  hard: ['W1 A1', 'K1 G1 W1 A1 W1', 'O1 A1 G1 W1 W1', 'K1 O1 A1 W1 G1 W1', 'O1 K1 A2 G1 W1 W1 W1', 'A2 K1 O1 G1 W1 B1 W1 W1', 'K1 O1 A1 G1 W2 W1 W1', 'O1 K1 A2 B1 G1 W1 W1 G1', 'O2 K1 A2 B1 G1 W1 W1 G1', 'O2 K2 A1 B1 G1 W1 W1 W1 G1'],
  nightmare: ['W1 A1 G1', 'K1 G1 W1 A1 W1', 'O1 A1 G1 W1 B1 W1', 'K1 O1 A1 W1 G1 W1 W1', 'O1 K1 A2 G1 W1 B1 W1 W1 G1', 'A2 K1 O1 G1 W1 B1 W1 W1 G1 G1', 'K1 O1 A2 G1 W1 B1 W1 W1 G1 G1 B1', 'O1 K2 A2 B1 G1 W1 W1 W1 G1 G1 B1', 'O2 K1 A2 B1 G1 W1 W1 W1 G1 G1 B1 K1', 'O2 K2 A2 B1 G1 W1 W1 W1 G1 G1 B1 K1'],
};

/** Stage 2, the Sunken Graveyard: crowds. Same Dominion cost per wave as the lists one tier up, but built from many Warriors, Goblins and Archers with a Knight or Ogre holding the front (sim/author_stages.ts). */
const GRAVEYARD: Record<Diff, string[]> = {
  easy: ['W1 A1', 'K1 G1 W1', 'O1 W1 W1 W1 G1', 'O1 G2 G1 A1', 'O1 W1 W1 W1 A1 A1', 'K1 W1 W1 W1 A1 A1 A1', 'O1 W1 W1 W1 W1 W1 A1', 'O1 W1 W1 W1 W1 G1 G1 G1', 'K1 W1 W1 W1 W1 W1 G2 G1 A1', 'K1 W1 W1 W1 W1 G1 G1 G1 G1 A1'],
  normal: ['W1 A1', 'K1 G1 W1 A1 W1', 'K1 W1 W1 W1 G1 A1', 'O1 W1 W1 G1 G1 G1 G1', 'O1 W2 W1 W1 W1 W1 W1 G1 A1', 'K1 W1 W1 W1 W1 W1 G1 G1 G1 A1 A1', 'K1 W1 W1 W1 G1 A1 A1 A1', 'O1 W1 W1 G1 G1 A1 A1 A1 A1', 'K2 W1 W1 W1 W1 W1 W1 G1 G1 G1 A1 A1', 'O1 W2 W1 W1 W1 W1 W1 G1 G1 A1 A1 A1'],
  hard: ['W1 A1 G1', 'K1 G1 W1 A1 W1', 'O1 W1 W1 W1 W1 G2 A1', 'O1 W1 W1 G1 G1 A1 A1', 'O1 W1 W1 W1 W1 W1 G1 G1 A1 A1 A1', 'K1 W3 W2 W2 W2 W1 W1 W1 W1 A1 A1 A1', 'O1 W3 W2 W2 W2 W2 W1 W1 W1 G3 G2 A1', 'O2 W2 W2 W1 W1 W1 G2 G1 G1 G1 A2 A1', 'K3 W3 W3 W3 W2 W2 W1 W1 G2 G1 G1 A3', 'K3 W3 W3 W2 W2 W1 G3 G2 G2 G1 A2 A1'],
  nightmare: ['W1 A1 G1', 'K1 G1 W1 A1 W1', 'O1 W1 W1 W1 G1 G1 A1', 'O1 W1 W1 W1 W1 G1 G1 A1', 'K1 W1 W1 W1 W1 W1 W1 W1 W1 A2 A1 A1', 'O1 W3 W2 W1 W1 W1 W1 W1 G2 G1 G1 A1', 'O1 W2 W1 W1 W1 G2 G1 G1 G1 A2 A1 A1', 'O2 W2 W1 W1 W1 W1 G2 G1 G1 A2 A1 A1', 'K2 W3 W1 W1 W1 G2 G2 G1 A3 A2 A1 A1', 'O2 W1 W1 W1 G2 G2 G2 G1 G1 A3 A2 A1'],
};
/** Stage 3, the Bone Bastion: fewer, heavier armies of Knights, Ogres and Barbarians with Archers behind (sim/author_stages.ts). */
const BASTION: Record<Diff, string[]> = {
  easy: ['W1 A1', 'K1 G1 W1 A1 W1', 'K1 K1 A1 A1', 'K1 K1 K1 A1 A1', 'K1 O1 B1 B1 A1', 'K1 K1 O1 O1 A1 A1', 'K1 K1 O1 B1 A1', 'K1 K1 K1 O1 B1 B1', 'K2 K1 O1 O1 B1 B1', 'K1 K1 O1 O1 B1 B1 A1'],
  normal: ['W1 A1 G1', 'K1 G1 W1 A1 W1', 'K1 K1 K1 A1 A1', 'O1 O1 B1 B1', 'K2 K1 K1 O1 B1 B1', 'K1 O1 O1 B1 B1 A1 A1', 'K2 K1 K1 K1 B2 B1 B1 A1', 'K2 K1 K1 O1 B1 B1 A2 A1', 'K2 K2 O2 B1 B1 A2 A2 A1', 'K2 K2 K2 K1 B2 B2 A3 A1'],
  hard: ['W1 A1 G1', 'K1 G1 W1 A1 W1', 'K1 K1 B1 A1 A1', 'K1 K1 O1 A1 A1', 'K1 O1 B1 B1 B1 A1 A1', 'K1 K1 K1 O1 O1 B1 A1', 'K1 K1 K1 K1 O1 B1 B1 B1', 'K2 K1 K1 O1 O1 B1 B1 A1', 'K2 K1 O1 O1 B1 B1 B1 A3', 'K2 K2 K1 K1 O1 O1 B3 B1'],
  nightmare: ['W1 A1 G1', 'K1 G1 W1 A1 W1', 'K1 K1 O1 B1', 'K2 K1 K1 O1', 'K2 K1 K1 K1 K1 O1', 'K1 K1 K1 O1 O1 B1 A1', 'K1 K1 K1 B2 B1 B1 A2 A1', 'K1 O1 O1 O1 B2 A1 A1 A1', 'K1 O2 O1 O1 O1 B1 B1 A1', 'K3 K2 K1 K1 K1 O2 B1 B1'],
};

export interface StageDef {
  id: string; name: string; blurb: string;
  lists: Record<Diff, string[]>;          // the 10 enemy waves for each tier
  power: Record<Diff, number>;            // hidden enemy health/damage multiplier for each tier (1 = as written)
  rec: Record<Diff, number>;              // recommended Soul level for each tier (a hint on Home, never a lock)
}

/** The campaign. Names are placeholders. Power numbers come from sim/calibrate_power.ts. */
export const STAGES: StageDef[] = [
  { id: 'crypt', name: 'The Restless Crypt', blurb: 'Raise your army. The dead here are only just stirring.',
    lists: { easy: DIFFICULTY.easy, normal: DIFFICULTY.normal, hard: DIFFICULTY.hard, nightmare: DIFFICULTY.nightmare },
    power: { easy: 1, normal: 1, hard: 1, nightmare: 1 }, rec: { easy: 1, normal: 1, hard: 4, nightmare: 6 } },
  { id: 'graveyard', name: 'The Sunken Graveyard', blurb: 'Bigger crowds crawl out of the mud. Level your Souls before you come.',
    lists: GRAVEYARD,
    power: { easy: 1, normal: 1.15, hard: 0.95, nightmare: 1.15 }, rec: { easy: 2, normal: 4, hard: 6, nightmare: 8 } },
  { id: 'bastion', name: 'The Bone Bastion', blurb: 'A fortress of the fallen. Only well-levelled armies hold the gate.',
    lists: BASTION,
    power: { easy: 1, normal: 1.0, hard: 1.25, nightmare: 1.4 }, rec: { easy: 4, normal: 6, hard: 8, nightmare: 10 } },
];
export const stageIndex = (id: string): number => Math.max(0, STAGES.findIndex((s) => s.id === id));
export const stageById = (id: string): StageDef => STAGES[stageIndex(id)];

/** Names and one-line promises for the difficulty picker. */
export const DIFFICULTY_INFO = [
  { id: 'easy', label: 'Easy', blurb: 'Smaller enemy armies. Relax and learn how merging works.' },
  { id: 'normal', label: 'Normal', blurb: 'The standard fight. Clearing it unlocks Hard and the next stage.' },
  { id: 'hard', label: 'Hard', blurb: 'Bigger armies with more fodder. Better first-clear rewards. Clearing it unlocks Nightmare.' },
  { id: 'nightmare', label: 'Nightmare', blurb: 'A packed battlefield of stars and skills. Built for well-levelled Souls.' },
];

// ---- what the next battle uses (set when a run starts)
export let difficultyName: string = 'normal';
export let currentStageId: string = 'crypt';
let power = 1, endlessMode = false, bossStr = 1;
/** How hard the boss hits for the current mode (0 = an ordinary unit, 1 = the full boss): gentle on Easy, full on Nightmare and in Endless. */
export const bossStrength = (): number => bossStr;
const BOSS_BY_TIER: Record<string, number> = { easy: 0.2, normal: 0.5, hard: 0.8, nightmare: 1 };
let dailyRewrite: ((w: EnemySpec[], wave: number) => EnemySpec[]) | null = null;   // set only during a Daily Challenge run
/** Enemy health/damage multiplier for the current stage and tier (in endless mode it depends on the wave). */
export const enemyPower = (wave = 1): number => (endlessMode ? endlessPower(wave) : power);
export const isEndless = (): boolean => endlessMode;

/** Hand-authored waves for the current stage and tier (10 waves). Edited in place by setStageDifficulty. */
export const AUTHORED: EnemySpec[][] = DIFFICULTY.normal.map(parseWave);

export function setStageDifficulty(stage: string, name: string): void {
  const st = stageById(stage); if (!DIFFS.includes(name as Diff)) return;
  endlessMode = false; dailyRewrite = null; bossStr = BOSS_BY_TIER[name] ?? 0.5; currentStageId = st.id; difficultyName = name; power = st.power[name as Diff];
  AUTHORED.length = 0; st.lists[name as Diff].forEach((w) => AUTHORED.push(parseWave(w)));
}
/** Switch to the Daily Challenge: Stage 1 Normal with the day's twist (see core/daily.ts). `day` is kept as the 'difficulty' so a saved run can rebuild the same day. */
export function setDaily(mod: { power: number; enemy?: (w: EnemySpec[], wave: number) => EnemySpec[] }, day: number): void {
  setStageDifficulty('crypt', 'normal'); dailyRewrite = mod.enemy ?? null; currentStageId = 'daily'; difficultyName = String(day); power = mod.power;
}
/** Switch to Endless Depths: waves come from core/endless.ts instead of a stage list. */
export function setEndless(): void { endlessMode = true; dailyRewrite = null; bossStr = 1; currentStageId = ENDLESS_ID; difficultyName = 'endless'; power = 1; AUTHORED.length = 0; }
/** Change the tier within the current stage. */
export function setDifficulty(name: string): void { setStageDifficulty(currentStageId, name); }

export const waveCost = (w: EnemySpec[]): number => w.reduce((n, e) => n + COST[e.soul][e.star - 1], 0);

/** The last wave of a stage has a BOSS: its biggest unit (a brute if there is one) gets extra health, damage and size (see BOSS in battle.ts). */
export function markBoss(w: EnemySpec[]): EnemySpec[] {
  let best = -1, bs = -1;
  w.forEach((e, i) => { const brute = e.soul === 'ogre' || e.soul === 'knight' || e.soul === 'barbarian' ? 100 : 0, sc = brute + COST[e.soul][e.star - 1]; if (sc > bs) { bs = sc; best = i; } });
  if (best >= 0) w[best] = { ...w[best], boss: true };
  return w;
}
/** Enemy army for a wave (1-based). Waves past the authored ones are generated from a fixed seed so retries face the same army. */
export function enemyWave(wave: number, stageSeed = 0): EnemySpec[] {
  if (endlessMode) return endlessWave(wave, stageSeed);
  if (wave <= AUTHORED.length) { let w = AUTHORED[wave - 1].map((e) => ({ ...e })); if (dailyRewrite) w = dailyRewrite(w, wave); return wave === AUTHORED.length ? markBoss(w) : w; }
  const cap = CURVES.doc[Math.min(wave, CURVES.doc.length) - 1];
  const budget = Math.round(cap * 0.92);
  const rng = makeRng(stageSeed * 1009 + wave * 7919);
  const army: EnemySpec[] = [];
  let left = budget;
  for (let guard = 0; guard < 40 && left >= 2; guard++) {
    const soul = rng.pick(SOULS);
    let star = 1;
    if (rng.next() < 0.35 && COST[soul][1] <= left) star = 2;
    if (wave >= 6 && rng.next() < 0.25 && COST[soul][2] <= left) star = 3;
    const c = COST[soul][star - 1];
    if (c <= left && army.length < 12) { army.push({ soul, star }); left -= c; }
  }
  return army;
}

/** What the build screen shows: counts per Soul and star, no positions. */
export function previewText(w: EnemySpec[]): { soul: SoulId; star: number; count: number; boss?: boolean }[] {
  const map = new Map<string, { soul: SoulId; star: number; count: number; boss?: boolean }>();
  for (const e of w) {
    const k = e.soul + e.star + (e.boss ? 'B' : '');
    const cur = map.get(k);
    if (cur) cur.count++; else map.set(k, { soul: e.soul, star: e.star, count: 1, boss: e.boss });
  }
  return [...map.values()];
}
