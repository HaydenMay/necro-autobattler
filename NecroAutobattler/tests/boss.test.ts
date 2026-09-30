import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSS, Battle } from '../core/battle.ts';
import { recordClear } from '../core/progress.ts';
import { defaultSave } from '../core/save.ts';
import { DIFFS, STAGES, enemyWave, previewText, setStageDifficulty } from '../core/waves.ts';

test('the last wave of every stage and tier has exactly one boss; earlier waves have none', () => {
  for (const st of STAGES) for (const d of DIFFS) {
    setStageDifficulty(st.id, d);
    for (let w = 1; w <= 10; w++) { const bosses = enemyWave(w, 1).filter((e) => e.boss).length; assert.equal(bosses, w === 10 ? 1 : 0, `${st.id}/${d} wave ${w}`); }
  }
  setStageDifficulty('crypt', 'normal'); assert.ok(previewText(enemyWave(10, 1)).some((p) => p.boss), 'the build screen tells the player which one is the boss');
});

test('a boss has more health, damage and size than the same unit as a normal enemy', () => {
  const me = [{ soul: 'warrior' as const, star: 1, cell: 0 }];
  const plain = new Battle(me, [{ soul: 'ogre', star: 2 }], 1), boss = new Battle(me, [{ soul: 'ogre', star: 2, boss: true }], 1);
  const e = (b: Battle) => b.fighters.find((f) => f.team === 1)!;
  setStageDifficulty('crypt', 'nightmare'); const full = new Battle(me, [{ soul: 'ogre', star: 2, boss: true }], 1); setStageDifficulty('crypt', 'easy'); const gentle = new Battle(me, [{ soul: 'ogre', star: 2, boss: true }], 1);
  assert.ok(Math.abs(e(full).maxHp / e(plain).maxHp - (1 + BOSS.hp)) < 1e-6, 'a Nightmare boss has the full extra health'); assert.ok(Math.abs(e(full).dmg / e(plain).dmg - (1 + BOSS.dmg)) < 1e-6);
  assert.ok(e(gentle).maxHp > e(plain).maxHp && e(gentle).maxHp < e(full).maxHp, 'an Easy boss is only a little tougher'); assert.equal(e(boss).radius, e(plain).radius, 'the boss looks bigger but is not harder to reach');
});

test("the last stage's first clear gives a pack one tier better than the same tier on other stages", () => {
  const a = defaultSave(), b = defaultSave();
  const early = recordClear(a, STAGES[0].id, 'easy'), last = recordClear(b, STAGES[STAGES.length - 1].id, 'easy');
  assert.equal(last.pack!.tier, early.pack!.tier + 1);
});
