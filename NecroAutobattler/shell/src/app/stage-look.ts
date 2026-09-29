/** One look per stage, matching the arena themes: the arena mood picture is hue-shifted (teal -> green / violet) and cropped differently, and the mist takes the stage colour. */
export const MOOD = 'url(assets/arena/mood.webp)';
export interface Look { hue: number; fog: string; pos: string; accent: string }
const LOOK: Record<string, Look> = {
  crypt: { hue: 0, fog: 'rgba(47,217,166,.55)', pos: '50% 62%', accent: '#2fd9a6' },
  graveyard: { hue: -66, fog: 'rgba(150,222,70,.5)', pos: '18% 55%', accent: '#a6e04a' },
  bastion: { hue: 104, fog: 'rgba(140,120,255,.5)', pos: '88% 40%', accent: '#9a8cff' },
};
export const lookOf = (id: string): Look => LOOK[id] ?? LOOK['crypt'];
