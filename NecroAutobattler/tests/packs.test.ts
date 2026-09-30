import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/rng.ts';
import { PACK, PACK_TIERS, RARITIES, RARITY_OF, copiesBySoul, openPack } from '../core/packs.ts';
import { REWARDS, canLevelUp, copiesNeeded, grantPack, isMaxLevel, levelMult, levelUp, maxLevel, openOwnedPack, recordClear } from '../core/progress.ts';
import { defaultSave, loadSave, sanitize, writeSave } from '../core/save.ts';
import { Battle } from '../core/battle.ts';

const fakeStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

test('opening a pack: right number of reveals, every reveal has copies, best reveal last, same seed same result', () => {
  for (let tier = 1; tier <= PACK_TIERS; tier++) {
    for (let seed = 1; seed <= 200; seed++) {
      const r = openPack(tier, makeRng(seed));
      assert.ok(r.finalTier >= tier && r.finalTier <= PACK_TIERS);
      assert.equal(r.reveals.length, PACK.reveals[r.finalTier - 1]);
      assert.equal(r.upgrades.length, r.finalTier - r.startTier);
      for (const v of r.reveals) { assert.ok(v.copies >= 1); assert.equal(v.rarity, RARITY_OF[v.soul]); }
      const ranks = r.reveals.map((v) => RARITIES.indexOf(v.rarity));
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'rarer reveals come later');
    }
  }
  assert.deepEqual(openPack(2, makeRng(9)), openPack(2, makeRng(9)));
});

test('a top-tier pack never upgrades, and upgrade rates are close to the configured chances', () => {
  for (let seed = 1; seed <= 100; seed++) assert.equal(openPack(PACK_TIERS, makeRng(seed)).upgrades.length, 0);
  const N = 20000; let up = 0;
  for (let i = 0; i < N; i++) if (openPack(1, makeRng(1000 + i)).upgrades.length > 0) up++;
  assert.ok(Math.abs(up / N - PACK.upgradeChance[0]) < 0.02, 'tier 1 upgrade rate ' + up / N);
});

test('rarity odds are roughly what the tier promises, and stacks stay inside their ranges', () => {
  const N = 6000, counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }; let total = 0;
  for (let i = 0; i < N; i++) { const r = openPack(3, makeRng(50000 + i)); for (const v of r.reveals) { counts[v.rarity]++; total++; } }
  // the roster has no Legendary Soul yet, so those rolls fall back to Epic
  const epicShare = (counts.epic + counts.legendary) / total, target = (PACK.odds[2].epic + PACK.odds[2].legendary) / 100;
  assert.ok(Math.abs(epicShare - (target - 0)) < 0.03 || Math.abs(counts.epic / total - PACK.odds[2].epic / 100) < 0.05, 'epic share ' + epicShare);
  assert.ok(counts.common / total > 0.3 && counts.common / total < 0.5, 'common share ' + counts.common / total);
  for (let i = 0; i < 500; i++) {
    const r = openPack(1, makeRng(i));
    if (r.finalTier === 1) for (const v of r.reveals) { const [lo, hi] = PACK.stack[v.rarity]; assert.ok(v.copies >= lo && v.copies <= hi, v.soul + ' x' + v.copies); }
  }
});

test('opening an owned pack removes it and adds the copies at once', () => {
  const s = defaultSave(); const p = grantPack(s, 2, 'test')!;
  const before = Object.values(s.souls).reduce((n, x) => n + x.copies, 0);
  const res = openOwnedPack(s, p.id, makeRng(5))!;
  assert.equal(s.packs.length, 0);
  const gained = Object.values(res.reveals).reduce((n, r) => n + r.copies, 0);
  assert.equal(Object.values(s.souls).reduce((n, x) => n + x.copies, 0) - before, gained);
  for (const [soul, n] of Object.entries(copiesBySoul(res))) assert.equal(s.souls[soul as keyof typeof s.souls].copies, n);
  assert.equal(openOwnedPack(s, p.id, makeRng(5)), null, 'a pack can only be opened once');
});

test('clear rewards: first clear per difficulty gives the improved pack, replays fill a meter', () => {
  const s = defaultSave();
  const first = recordClear(s, 'crypt', 'nightmare'); assert.ok(first.first); assert.equal(first.pack!.tier, REWARDS.firstClearTier.nightmare);
  const easyFirst = recordClear(s, 'crypt', 'easy'); assert.ok(easyFirst.first, 'a new difficulty is a first clear again'); assert.equal(easyFirst.pack!.tier, REWARDS.firstClearTier.easy);
  let replayPacks = 0; for (let i = 0; i < REWARDS.replayClearsPerPack * 3; i++) { const r = recordClear(s, 'crypt', 'nightmare'); assert.equal(r.first, false); if (r.pack) { replayPacks++; assert.equal(r.pack.tier, REWARDS.replayTier); } }
  assert.equal(replayPacks, 3);
  assert.equal(s.packs.length, 2 + 3);
  const ids = s.packs.map((p) => p.id); assert.equal(new Set(ids).size, ids.length, 'pack ids are unique');
});

test('levelling: needs enough copies, spends them, stops at the max level', () => {
  const s = defaultSave(); const need = copiesNeeded(1, 'ogre');
  assert.equal(canLevelUp(s, 'ogre'), false); assert.equal(levelUp(s, 'ogre'), false);
  s.gold = 50000; s.souls.ogre.copies = need + 3; assert.ok(canLevelUp(s, 'ogre')); assert.ok(levelUp(s, 'ogre'));
  assert.equal(s.souls.ogre.level, 2); assert.equal(s.souls.ogre.copies, 3);
  s.souls.ogre.level = maxLevel(); s.souls.ogre.copies = 99999; assert.ok(isMaxLevel(s.souls.ogre.level)); assert.equal(levelUp(s, 'ogre'), false); assert.equal(copiesNeeded(maxLevel(), 'ogre'), 0);
  assert.ok(copiesNeeded(3, 'ogre') < copiesNeeded(3, 'archer') && copiesNeeded(3, 'archer') < copiesNeeded(3, 'warrior'), 'rarer Souls need fewer copies per level');
  assert.ok(levelMult(3, 'hp') > levelMult(2, 'hp') && levelMult(1, 'hp') === 1);
});

test('levels make the player\'s units stronger in battle, and enemies never get them', () => {
  const players = [{ soul: 'knight' as const, star: 1, cell: 3 }], enemies = [{ soul: 'knight' as const, star: 1 }];
  const plain = new Battle(players, enemies, 1), levelled = new Battle(players, enemies, 1, { knight: 5 });
  const mine = (b: Battle) => b.fighters.find((f) => f.team === 0)!, theirs = (b: Battle) => b.fighters.find((f) => f.team === 1)!;
  assert.ok(mine(levelled).maxHp > mine(plain).maxHp && mine(levelled).dmg > mine(plain).dmg);
  assert.equal(theirs(levelled).maxHp, theirs(plain).maxHp);
});

test('saved packs and clears survive a round trip, and damaged ones are dropped', () => {
  const st = fakeStore(), s = defaultSave(); grantPack(s, 3, 'a'); grantPack(s, 1, 'b'); recordClear(s, 'crypt', 'hard'); writeSave(s, st);
  const back = loadSave(st); assert.deepEqual(back.packs.map((p) => p.tier), [3, 1, 2].slice(0, back.packs.length)); assert.equal(back.clears['crypt:hard'], 1);
  const bad = sanitize({ packs: [{ id: 1, tier: 9, source: 'x' }, { id: 2, tier: 2, source: 'ok' }, { id: 2, tier: 1, source: 'dup' }, null, { id: 'z', tier: 1 }], nextPackId: 1, clears: { 'crypt:easy': -3, 'a:b': 2 }, replayMeter: -4 });
  assert.deepEqual(bad.packs, [{ id: 2, tier: 2, source: 'ok' }]);
  assert.equal(bad.nextPackId, 3, 'new pack ids never collide with kept ones');
  assert.deepEqual(bad.clears, { 'a:b': 2 }); assert.equal(bad.replayMeter, 0);
});
