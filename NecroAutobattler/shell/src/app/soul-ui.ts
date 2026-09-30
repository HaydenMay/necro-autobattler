import type { SoulId } from '../../../core/data.ts';
import type { Rarity } from '../../../core/packs.ts';
import { RARITY_GEM, SOUL_ICON, iconUrl } from '../../../ui/icons.ts';

/** Soul art: the weapon/role icon on a coloured card until real portraits exist. */
export const soulIcon = (s: SoulId): string => iconUrl(SOUL_ICON[s]);
export const gemIcon = (r: Rarity): string => iconUrl(RARITY_GEM[r]);
export const skullIcon: string = iconUrl('souls');
export const checkIcon: string = iconUrl('check');
export const closeIcon: string = iconUrl('close');
export const upgradeIcon: string = iconUrl('upgrade');
export const heartIcon: string = iconUrl('heart');
export const heartEmptyIcon: string = iconUrl('heart_empty');
export const shopIcon: string = iconUrl('shop');
export const goldIcon: string = iconUrl('gold');
/** 1..n as an array, so a template can repeat an icon n times. */
export const range = (n: number): number[] => Array.from({ length: Math.max(1, n) }, (_, i) => i);

export const BG: Record<SoulId, string> = {
  warrior: 'linear-gradient(#6b4a8f,#2c1b45)', archer: 'linear-gradient(#5a4a9a,#251a4a)', goblin: 'linear-gradient(#4f7a3a,#1d2d17)',
  knight: 'linear-gradient(#3f6aa8,#15243f)', ogre: 'linear-gradient(#8a6a3a,#33230f)', barbarian: 'linear-gradient(#a8483a,#3a1512)',
};
export const RARITY_COLOR: Record<Rarity, string> = { common: '#b8c0cc', rare: '#4aa3ff', epic: '#b26bff', legendary: '#ffcc33' };

export { artBg, hasArt, rarityColor, soulArt } from '../../../ui/portraits.ts';
