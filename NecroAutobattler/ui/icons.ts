// The game's icon set (custom art, sliced from Pipeline/icons/sheet_*.png by Pipeline/blender/slice_icons.py -> docs/assets/icons/*.png).
// Shared by the 3D game's DOM (vanilla) and the Angular shell. No emoji anywhere: every glyph in the UI is one of these images.
import type { SoulId } from '../core/data.ts';
import type { Rarity } from '../core/packs.ts';

export type IconName =
  | 'home' | 'souls' | 'shop' | 'settings' | 'close'
  | 'heart' | 'heart_empty' | 'dominion' | 'star' | 'lock'
  | 'warrior' | 'archer' | 'goblin' | 'knight' | 'ogre' | 'barbarian'
  | 'gem_common' | 'gem_rare' | 'gem_epic' | 'gem_legendary'
  | 'music' | 'sound_on' | 'sound_off' | 'upgrade' | 'swap'
  | 'merge' | 'remove' | 'check' | 'back' | 'info' | 'gold';

/** Relative to the page, so it works on GitHub Pages under /repo-name/. */
export const iconUrl = (n: IconName): string => 'assets/icons/' + n + '.png';
/** An <img> as an HTML string, for the game's hand-built DOM. */
export const iconImg = (n: IconName, cls = 'ic'): string => `<img class="${cls}" src="${iconUrl(n)}" alt="" draggable="false">`;

/** Each Soul is shown by its weapon/role icon until real portraits exist. */
export const SOUL_ICON: Record<SoulId, IconName> = { warrior: 'warrior', archer: 'archer', goblin: 'goblin', knight: 'knight', ogre: 'ogre', barbarian: 'barbarian' };
export const RARITY_GEM: Record<Rarity, IconName> = { common: 'gem_common', rare: 'gem_rare', epic: 'gem_epic', legendary: 'gem_legendary' };

/** Pack tiers are shown as skulls (never stars: stars mean an in-run merge level). */
export const skullImgs = (n: number, cls = 'sk'): string => iconImg('souls', cls).repeat(Math.max(1, n));
export const heartsHtml = (hearts: number, max = 3): string => iconImg('heart', 'ic heart').repeat(Math.max(0, hearts)) + iconImg('heart_empty', 'ic heart').repeat(Math.max(0, max - hearts));
