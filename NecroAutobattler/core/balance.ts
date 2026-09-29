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
  volley: { targets: number; projectileSpeed: number };                     // Skeleton Archer
  opportunist: { bonus: number; seekRadius: number; woundedWeight: number }; // Goblin
  taunt: { cooldown: number; duration: number; radius: number };            // Knight
  smash: { every: number; mult: number; radius: number };                   // Ogre
  frenzy: { perSwing: number; maxStacks: number; resetAfter: number };      // Barbarian
  sim: { separation: number; hitFraction: number; timeLimit: number; retargetEvery: number };
}

export const DEFAULTS: Balance = {
  stats: {
    warrior:   { hp: 60,  dmg: 8,  interval: 0.9, range: 0.85, speed: 1.4, size: 0.28, animLen: 1.0, hitFrac: 0.47 },
    archer:    { hp: 40,  dmg: 7,  interval: 1.7, range: 5.0,  speed: 1.1, size: 0.26, animLen: 1.5, hitFrac: 0.78 },
    goblin:    { hp: 45,  dmg: 9,  interval: 0.8, range: 0.8,  speed: 1.7, size: 0.24, animLen: 1.0, hitFrac: 0.5 },
    knight:    { hp: 130, dmg: 9,  interval: 1.1, range: 0.9,  speed: 1.0, size: 0.32, animLen: 1.0, hitFrac: 0.5 },
    ogre:      { hp: 170, dmg: 16, interval: 1.9, range: 1.05, speed: 0.8, size: 0.42, animLen: 1.2, hitFrac: 0.55 },
    barbarian: { hp: 75,  dmg: 8,  interval: 0.95, range: 0.9, speed: 1.5, size: 0.30, animLen: 1.0, hitFrac: 0.5 },
  },
  // "bodies = damage, stars = durability": HP grows faster than damage per star
  star: { hp: [1, 2.0, 3.2], dmg: [1, 1.5, 2.0], scale: [1, 1.12, 1.25] },
  phalanx: { radius: 2.0, perAlly: 0.08, maxStacks: 3 },
  volley: { targets: 3, projectileSpeed: 14 },
  opportunist: { bonus: 0.5, seekRadius: 4.0, woundedWeight: 1.5 },
  taunt: { cooldown: 6, duration: 3, radius: 4.5 },
  smash: { every: 4, mult: 2.0, radius: 1.6 },
  frenzy: { perSwing: 0.12, maxStacks: 8, resetAfter: 0.6 },
  sim: { separation: 0.6, hitFraction: 0.47, timeLimit: 120, retargetEvery: 0.5 },
};

export const BALANCE: Balance = JSON.parse(JSON.stringify(DEFAULTS));

export function resetBalance(): void {
  const fresh: Balance = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(fresh) as (keyof Balance)[]) (BALANCE as any)[k] = (fresh as any)[k];
}

export const ROLE_TEXT: Record<SoulId, string> = {
  warrior: 'Cheap and fast. Tougher near other Warriors.',
  archer: 'Fragile. Fires 3 arrows at 3 different enemies.',
  goblin: 'Fast. Hits harder on enemies fighting someone else.',
  knight: 'Tank. Taunt pulls enemies onto him.',
  ogre: 'Slow, huge damage. Every 4th hit is a Smash.',
  barbarian: 'Swings faster with every uninterrupted hit.',
};

export const SOUL_NAME: Record<SoulId, string> = {
  warrior: 'Skeleton Warrior', archer: 'Skeleton Archer', goblin: 'Goblin',
  knight: 'Knight', ogre: 'Ogre', barbarian: 'Barbarian',
};
