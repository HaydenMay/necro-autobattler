// How fast do Souls level with the placeholder pack numbers?   node sim/progression.ts
// A simulated player clears stages, opens every pack, and levels Souls whenever they can. We report the stage clears needed to reach
// milestones (first Soul / every Soul at level 2, 3, 5, 8), so the pace can be judged before any real tuning.
import { SOULS } from '../core/data.ts';
import { makeRng } from '../core/rng.ts';
import { PACK, PACK_TIERS, RARITY_OF, openPack } from '../core/packs.ts';
import { REWARDS, levelUp, maxLevel, packGold, waveGold } from '../core/progress.ts';
import { defaultSave } from '../core/save.ts';
import { BALANCE } from '../core/balance.ts';

const RUNS = 400;
// GOLD=0 ignores gold (copies-only, the old pace) so the two can be compared.  A clear = 10 waves cleared on Stage 1 at the chosen tier, plus gold from every pack opened.
const GOLD_ON = process.env.GOLD !== '0';
if (process.env.GOLDMULT) { const k = +process.env.GOLDMULT; BALANCE.level.goldToLevel = BALANCE.level.goldToLevel.map((g) => Math.round(g * k)); }

console.log('== one pack, averaged over 6000 openings ==');
for (let tier = 1; tier <= PACK_TIERS; tier++) {
  let copies = 0, ups = 0, reveals = 0; const perSoul: Record<string, number> = {}; SOULS.forEach((s) => (perSoul[s] = 0));
  for (let i = 0; i < 6000; i++) { const r = openPack(tier, makeRng(90000 + tier * 10000 + i)); if (r.finalTier > tier) ups++; reveals += r.reveals.length; for (const v of r.reveals) { copies += v.copies; perSoul[v.soul] += v.copies; } }
  console.log(`tier ${tier}: ${(reveals / 6000).toFixed(1)} reveals, ${(copies / 6000).toFixed(1)} copies per pack, upgrades ${((100 * ups) / 6000).toFixed(0)}%`,
    '| copies per Soul:', SOULS.map((s) => `${s} ${(perSoul[s] / 6000).toFixed(1)}`).join(', '));
}

function play(seed: number, difficulty: 'easy' | 'normal' | 'hard' | 'nightmare', clears: number) {
  const s = defaultSave(), rng = makeRng(seed); let firstDone = false, replay = 0, packs = 0;
  const milestones: Record<string, number> = {}; const mark = (k: string, clear: number) => { if (milestones[k] === undefined) milestones[k] = clear; };
  for (let c = 1; c <= clears; c++) {
    let tiers: number[] = [];
    if (!firstDone) { firstDone = true; tiers = [REWARDS.firstClearTier[difficulty]]; }
    else { replay++; if (replay >= REWARDS.replayClearsPerPack) { replay = 0; tiers = [REWARDS.replayTier[difficulty]]; } }
    s.gold += 10 * waveGold('crypt', difficulty);
    for (const t of tiers) { const r = openPack(t, rng); packs++; s.gold += packGold(r.finalTier); for (const v of r.reveals) s.souls[v.soul].copies += v.copies; }
    if (!GOLD_ON) s.gold = 1e9;
    for (const soul of SOULS) while (levelUp(s, soul)) { /* level as far as the copies allow */ }
    const levels = SOULS.map((x) => s.souls[x].level);
    for (const L of [2, 3, 4, 5, 6, 8, 10]) { if (Math.min(...levels) >= L) mark('all Souls at level ' + L, c); if (Math.max(...levels) >= L) mark('first Soul at level ' + L, c); }
  }
  return { packs, milestones, levels: SOULS.map((x) => s.souls[x].level) };
}

for (const diff of ['normal', 'nightmare'] as const) {
  console.log(`\n== a player who only clears ${diff}: stage clears needed (median of ${RUNS} players; one first-clear pack, then a replay pack every ${REWARDS.replayClearsPerPack} clears) ==`);
  const runs = Array.from({ length: RUNS }, (_, i) => play(7 + i, diff, 400));
  for (const k of ['first Soul at level 2', 'all Souls at level 2', 'first Soul at level 3', 'all Souls at level 3', 'first Soul at level 5', 'all Souls at level 5', 'first Soul at level 8', 'all Souls at level 8', 'first Soul at level 4', 'all Souls at level 4', 'first Soul at level 6', 'all Souls at level 6', 'first Soul at level 10', 'all Souls at level 10']) {
    const v = runs.map((r) => r.milestones[k] ?? 999).sort((a, b) => a - b), med = v[Math.floor(v.length / 2)];
    console.log(k.padEnd(24), med >= 999 ? '> 400 clears' : med + ' clears');
  }
  console.log('levels after 400 clears (' + SOULS.join('/') + '):', SOULS.map((_, i) => Math.round(runs.reduce((n, r) => n + r.levels[i], 0) / runs.length)).join('/'));
}
console.log('\nmax level', maxLevel(), '| rarity:', SOULS.map((s) => `${s}=${RARITY_OF[s]}`).join(', '), '| stacks', JSON.stringify(PACK.stack));
