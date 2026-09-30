// SINGLE SOURCE OF TRUTH for every number that affects combat.
// The debug panel edits BALANCE live; `resetBalance()` restores these defaults.
// All values are first-pass guesses meant to be tuned by playing and by `node sim/campaign.ts`.

import type { SoulId } from './data.ts';

export interface UnitStats {
  hp: number;         // 1-star hit points
  dmg: number;        // 1-star damage per hit (per arrow for the Archer)
  interval: number;   // seconds between attacks
  range: number;      // metres (centre to centre)
  speed: number;      // metres per second
  size: number;       // body radius, used for spacing and visuals
  animLen: number;    // seconds: length of this unit's attack clip at normal speed
  hitFrac: number;    // 0-1: how far into the clip the blow lands / the arrow is released
}

export interface Balance {
  stats: Record<SoulId, UnitStats>;
  star: {
    hp: number[];     // multiplier at 1, 2, 3 stars
    dmg: number[];
    scale: number[];  // visual size
  };
  phalanx: { radius: number; perAlly: number; maxStacks: number };          // Skeleton Warrior
  mana: Partial<Record<SoulId, { max: number; perAttack: number; perHit: number }>>; // units WITH a skill; the rest are passive-only
  volley: { targets: number; projectileSpeed: number };                     // Skeleton Archer skill: Split Arrow
  opportunist: { bonus: number; seekRadius: number; woundedWeight: number }; // Goblin
  taunt: { duration: number; radius: number };                              // Knight skill
  smash: { mult: number; radius: number };                                  // Ogre skill
  frenzy: { perSwing: number; maxStacks: number; resetAfter: number };      // Barbarian
  /** PLACEHOLDER permanent-level growth (per level above 1). Shown on the Souls page; NOT applied in battles yet. */
  level: { hp: number; dmg: number; copiesToLevel: number[]; goldToLevel: number[] };
  sim: { separation: number; hitFraction: number; timeLimit: number; retargetEvery: number };
}

export const DEFAULTS: Balance = {
  stats: {
    warrior:   { hp: 60,  dmg: 8,  interval: 0.9, range: 0.85, speed: 1.4, size: 0.28, animLen: 1.0, hitFrac: 0.47 },
    archer:    { hp: 40,  dmg: 7,  interval: 1.7, range: 5.0,  speed: 1.1, size: 0.26, animLen: 1.5, hitFrac: 0.78 },
    goblin:    { hp: 45,  dmg: 9,  interval: 0.8, range: 0.8,  speed: 1.7, size: 0.24, animLen: 1.0, hitFrac: 0.5 },
    knight:    { hp: 130, dmg: 9,  interval: 1.1, range: 0.9,  speed: 1.0, size: 0.32, animLen: 1.0, hitFrac: 0.5 },
    ogre:      { hp: 170, dmg: 16, interval: 1.9, range: 1.05, speed: 0.8, size: 0.42, animLen: 1.2, hitFrac: 0.55 },
    barbarian: { hp: 110, dmg: 12, interval: 0.9, range: 0.9, speed: 1.5, size: 0.30, animLen: 1.0, hitFrac: 0.5 },
  },
  // "bodies = damage, stars = durability": HP grows faster than damage per star
  star: { hp: [1, 2.0, 3.2], dmg: [1, 1.5, 2.0], scale: [1, 1.12, 1.25] },
  phalanx: { radius: 2.0, perAlly: 0.08, maxStacks: 3 },
  // mana fills fast: a basic attack gives perAttack, taking a hit gives perHit; a full bar fires the skill on the next attack, then resets
  mana: {
    archer: { max: 100, perAttack: 34, perHit: 6 },     // Split Arrow about every 3rd shot
    ogre:   { max: 100, perAttack: 34, perHit: 6 },     // Smash about every 3rd swing
    knight: { max: 100, perAttack: 25, perHit: 12 },    // Taunt every ~4 swings, sooner when he is being hit
  },
  volley: { targets: 3, projectileSpeed: 14 },
  opportunist: { bonus: 0.5, seekRadius: 4.0, woundedWeight: 1.5 },
  taunt: { duration: 3, radius: 4.5 },
  smash: { mult: 2.0, radius: 1.6 },
  frenzy: { perSwing: 0.14, maxStacks: 8, resetAfter: 0.6 },
  level: { hp: 0.08, dmg: 0.08, copiesToLevel: [5, 10, 20, 40, 80, 90, 140, 200, 300], goldToLevel: [6000, 12000, 24000, 48000, 72000, 110000, 170000, 260000, 400000] },
  sim: { separation: 0.6, hitFraction: 0.47, timeLimit: 120, retargetEvery: 0.5 },
};

export const BALANCE: Balance = JSON.parse(JSON.stringify(DEFAULTS));

export function resetBalance(): void {
  const fresh: Balance = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(fresh) as (keyof Balance)[]) (BALANCE as any)[k] = (fresh as any)[k];
}

export const ROLE_TEXT: Record<SoulId, string> = {
  warrior: 'Cheap and fast. Tougher near other Warriors.',
  archer: 'Fragile. Skill: Split Arrow hits 3 different enemies.',
  goblin: 'Fast. Hits harder on enemies fighting someone else.',
  knight: 'Tank. Skill: Taunt pulls enemies onto him.',
  ogre: 'Slow, huge damage. Skill: Smash, a big area slam.',
  barbarian: 'Swings faster with every uninterrupted hit.',
};

export const SOUL_NAME: Record<SoulId, string> = {
  warrior: 'Skeleton Warrior', archer: 'Skeleton Archer', goblin: 'Goblin',
  knight: 'Knight', ogre: 'Ogre', barbarian: 'Barbarian',
};

/** Ability blurbs for the Souls page, with the live numbers filled in. */
export function abilityInfo(soul: SoulId): { kind: 'skill' | 'passive'; name: string; text: string } {
  const B = BALANCE, pct = (x: number) => Math.round(x * 100) + '%';
  switch (soul) {
    case 'warrior': return { kind: 'passive', name: 'Phalanx', text: `Takes ${pct(B.phalanx.perAlly)} less damage for each other Skeleton Warrior within ${B.phalanx.radius}m (up to ${B.phalanx.maxStacks}).` };
    case 'goblin': return { kind: 'passive', name: 'Opportunist', text: `Deals ${pct(B.opportunist.bonus)} more damage to an enemy that is fighting someone else, and prefers such targets.` };
    case 'barbarian': return { kind: 'passive', name: 'Frenzy', text: `Attacks ${pct(B.frenzy.perSwing)} faster with every uninterrupted swing (up to ${B.frenzy.maxStacks} times).` };
    case 'archer': return { kind: 'skill', name: 'Split Arrow', text: `Basic shots fire one arrow. When mana is full, the next shot fires at up to ${B.volley.targets} different enemies.` };
    case 'knight': return { kind: 'skill', name: 'Taunt', text: `When mana is full, enemies within ${B.taunt.radius}m must attack him for ${B.taunt.duration}s.` };
    case 'ogre': return { kind: 'skill', name: 'Smash', text: `When mana is full, the next swing deals ${B.smash.mult}x damage and hits enemies near the target for 60% as much.` };
  }
}
