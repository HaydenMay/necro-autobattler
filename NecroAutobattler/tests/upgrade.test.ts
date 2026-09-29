import test from 'node:test';
import assert from 'node:assert/strict';
import { SOULS } from '../core/data.ts';
import { canAfford, canLevelUp, clearCopies, copiesNeeded, levelUp, resetLevels, upgradeCosts, maxLevel } from '../core/progress.ts';
import { defaultSave } from '../core/save.ts';

test('an upgrade cost is a list of requirements; Confirm is allowed only when every one is met', () => {
  const s = defaultSave(), need = copiesNeeded(1, 'ogre');
  let costs = upgradeCosts(s, 'ogre');
  assert.equal(costs.length, 1); assert.equal(costs[0].id, 'copies'); assert.equal(costs[0].need, need); assert.equal(costs[0].ok, false); assert.equal(canAfford(costs), false);
  s.souls.ogre.copies = need - 1; assert.equal(canLevelUp(s, 'ogre'), false); assert.equal(levelUp(s, 'ogre'), false); assert.equal(s.souls.ogre.level, 1); assert.equal(s.souls.ogre.copies, need - 1, 'a refused upgrade changes nothing');
  s.souls.ogre.copies = need + 2; costs = upgradeCosts(s, 'ogre'); assert.ok(costs[0].ok && canAfford(costs));
  assert.ok(levelUp(s, 'ogre')); assert.equal(s.souls.ogre.level, 2); assert.equal(s.souls.ogre.copies, 2);
  s.souls.ogre.level = maxLevel(); assert.deepEqual(upgradeCosts(s, 'ogre'), [], 'a maxed Soul has nothing to pay'); assert.equal(canAfford([]), false);
});

test('debug resets: levels go back to 1 and keep copies; clearing copies keeps levels', () => {
  const s = defaultSave(); for (const k of SOULS) { s.souls[k].level = 5; s.souls[k].copies = 12; }
  resetLevels(s); assert.ok(SOULS.every((k) => s.souls[k].level === 1 && s.souls[k].copies === 12));
  for (const k of SOULS) s.souls[k].level = 3;
  clearCopies(s); assert.ok(SOULS.every((k) => s.souls[k].copies === 0 && s.souls[k].level === 3));
});
