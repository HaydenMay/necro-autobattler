import type { SoulId } from '../../../core/data.ts';
import type { Rarity } from '../../../core/packs.ts';

/** Placeholder portraits (emoji on a coloured card) until real Soul art exists. */
export const ICON: Record<SoulId, string> = { warrior: '\u{1F480}', archer: '\u{1F3F9}', goblin: '\u{1F5E1}️', knight: '\u{1F6E1}️', ogre: '\u{1F528}', barbarian: '\u{1FA93}' };
export const BG: Record<SoulId, string> = {
  warrior: 'linear-gradient(#6b4a8f,#2c1b45)', archer: 'linear-gradient(#5a4a9a,#251a4a)', goblin: 'linear-gradient(#4f7a3a,#1d2d17)',
  knight: 'linear-gradient(#3f6aa8,#15243f)', ogre: 'linear-gradient(#8a6a3a,#33230f)', barbarian: 'linear-gradient(#a8483a,#3a1512)',
};
export const RARITY_COLOR: Record<Rarity, string> = { common: '#b8c0cc', rare: '#4aa3ff', epic: '#b26bff', legendary: '#ffcc33' };
/** Pack tiers are shown as skulls (never stars: stars mean an in-run merge level). */
export const skulls = (n: number): string => '☠'.repeat(Math.max(1, n));
