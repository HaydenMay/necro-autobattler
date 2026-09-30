import test from 'node:test';
import assert from 'node:assert/strict';
import { SOULS } from '../core/data.ts';
import { canAfford, canLevelUp, clearCopies, copiesNeeded, endlessWaveGold, levelUp, openOwnedPack, packGold, resetLevels, upgradeCosts, maxLevel, waveGold } from '../core/progress.ts';
import { makeRng } from '../core/rng.ts';
import { defaultSave } from '../core/save.ts';

test('an upgrade cost is a list of requirements; Confirm is allowed only when every one is met', () => {
  const s = defaultSave(), need = copiesNeeded(1, 'ogre');
  let costs = upgradeCosts(s, 'ogre');
  assert.equal(costs.length, 2); assert.deepEqual(costs.map((c) => c.id), ['copies', 'gold']); assert.equal(costs[0].id, 'copies'); assert.equal(costs[0].need, need); assert.equal(costs[0].ok, false); assert.equal(canAfford(costs), false);
  s.gold = 100000; s.souls.ogre.copies = need - 1; assert.equal(canLevelUp(s, 'ogre'), false); assert.equal(levelUp(s, 'ogre'), false); assert.equal(s.souls.ogre.level, 1); assert.equal(s.souls.ogre.copies, need - 1, 'a refused upgrade changes nothing');
  s.souls.ogre.copies = need + 2; costs = upgradeCosts(s, 'ogre'); assert.ok(costs[0].ok && canAfford(costs));
  assert.ok(levelUp(s, 'ogre')); assert.equal(s.souls.ogre.level, 2); assert.equal(s.souls.ogre.copies, 2); assert.equal(s.gold, 100000 - 6000, 'the level-up also spent its gold');
  s.souls.ogre.level = maxLevel(); assert.deepEqual(upgradeCosts(s, 'ogre'), [], 'a maxed Soul has nothing to pay'); assert.equal(canAfford([]), false);
});

test('debug resets: levels go back to 1 and keep copies; clearing copies keeps levels', () => {
  const s = defaultSave(); for (const k of SOULS) { s.souls[k].level = 5; s.souls[k].copies = 12; }
  resetLevels(s); assert.ok(SOULS.every((k) => s.souls[k].level === 1 && s.souls[k].copies === 12));
  for (const k of SOULS) s.souls[k].level = 3;
  clearCopies(s); assert.ok(SOULS.every((k) => s.souls[k].copies === 0 && s.souls[k].level === 3));
});

test('gold: a level-up needs enough gold as well as copies, and pays both', () => {
  const s = defaultSave(); s.souls.warrior.copies = 999; s.gold = 5999;
  assert.equal(canLevelUp(s, 'warrior'), false, '5,999 gold is not enough for 6,000'); assert.equal(levelUp(s, 'warrior'), false); assert.equal(s.gold, 5999); assert.equal(s.souls.warrior.copies, 999);
  s.gold = 6000; assert.ok(levelUp(s, 'warrior')); assert.equal(s.gold, 0); assert.equal(s.souls.warrior.level, 2);
  assert.equal(canLevelUp(s, 'warrior'), false, 'level 2 -> 3 costs 12,000 gold');
});
test('gold earned: more in later stages and harder tiers; endless grows with depth; packs pay by tier', () => {
  assert.ok(waveGold('graveyard', 'normal') > waveGold('crypt', 'normal')); assert.ok(waveGold('crypt', 'nightmare') > waveGold('crypt', 'easy'));
  assert.ok(endlessWaveGold(30) > endlessWaveGold(1)); assert.equal(packGold(3), 4500);
  const s = defaultSave(); s.packs.push({ id: 1, tier: 2, source: 't' }); s.nextPackId = 2; const before = s.gold; openOwnedPack(s, 1, makeRng(5)); assert.ok(s.gold >= before + 1500, 'opening a pack pays gold');
});
