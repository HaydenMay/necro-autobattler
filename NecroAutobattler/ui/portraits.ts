// Rendered Soul portraits (Pipeline/blender/render_portrait.py, head-and-shoulders mode), shared by the Angular pages and the battle screen.
// Souls without a portrait yet fall back to their role icon on a coloured card.
import type { SoulId } from '../core/data.ts';
import { RARITY_OF } from '../core/packs.ts';
import type { Rarity } from '../core/packs.ts';
import { SOUL_ICON, iconUrl } from './icons.ts';

const PORTRAIT: Partial<Record<SoulId, string>> = { warrior: 'assets/portraits/warrior_head.png', archer: 'assets/portraits/archer_head.png', ogre: 'assets/portraits/ogre_head.png' };
const RARITY_HEX: Record<Rarity, string> = { common: '#b8c0cc', rare: '#4aa3ff', epic: '#b26bff', legendary: '#ffcc33' };
export const hasArt = (s: SoulId): boolean => !!PORTRAIT[s];
export const soulArt = (s: SoulId): string => PORTRAIT[s] ?? iconUrl(SOUL_ICON[s]);
export const rarityColor = (s: SoulId): string => RARITY_HEX[RARITY_OF[s]];
/** Card backdrop for a portrait: a glow in the rarity colour behind the figure, on a dark crypt gradient. */
export const artBg = (s: SoulId): string => { const c = rarityColor(s); return `radial-gradient(ellipse at 50% 80%, ${c}77 0%, ${c}26 46%, transparent 74%), linear-gradient(#2b2444,#0d0919)`; };
