import test from 'node:test';
import assert from 'node:assert/strict';
import { COST } from '../core/data.ts';
import { ENDLESS_ID, ENDLESS_PACK_EVERY, TEMPLATES, endlessBudget, endlessPackTier, endlessPower, endlessTemplate, endlessWave } from '../core/endless.ts';
import { ENDLESS_RULES } from '../core/prototype.ts';
import { defaultSave, sanitize } from '../core/save.ts';
import { endlessUnlocked, recordClear, recordEndlessWave } from '../core/progress.ts';
import { STAGES, enemyPower, enemyWave, isEndless, setEndless, setStageDifficulty, waveCost } from '../core/waves.ts';

test('the same seed always gives the same endless waves; different seeds give different ones', () => {
  for (let n = 1; n <= 40; n += 3) assert.deepEqual(endlessWave(n, 7), endlessWave(n, 7));
  let differ = 0; for (let n = 5; n <= 40; n++) if (JSON.stringify(endlessWave(n, 1)) !== JSON.stringify(endlessWave(n, 2))) differ++;
  assert.ok(differ > 20, 'seeds should change the army (' + differ + ' of 36 waves differed)');
});

test('every wave fits the grid, stays inside its budget, and is never empty', () => {
  for (let n = 1; n <= 120; n++) for (const seed of [1, 2, 3]) {
    const w = endlessWave(n, seed), cost = waveCost(w);
    assert.ok(w.length >= 1 && w.length <= 12, `wave ${n} has ${w.length} units`);
    assert.ok(cost <= endlessBudget(n), `wave ${n} costs ${cost}, budget ${endlessBudget(n)}`);
    for (const e of w) assert.ok(e.star >= 1 && e.star <= 3 && COST[e.soul]);
  }
});

test('budget and power only go up, and start gently', () => {
  for (let n = 2; n <= 120; n++) { assert.ok(endlessBudget(n) >= endlessBudget(n - 1)); if (n % 10 !== 1 && n % 10 !== 0) assert.ok(endlessPower(n) >= endlessPower(n - 1)); }
  assert.equal(endlessPower(1), 1); assert.equal(endlessPower(10), 1); assert.ok(endlessPower(30) > endlessPower(11));
  assert.ok(waveCost(endlessWave(1, 1)) <= 6, 'the first wave must be easy');
});

test('every 10th wave from 20 has a starred champion up front', () => {
  for (const n of [20, 30, 40, 50]) for (const seed of [1, 2, 3]) { const w = endlessWave(n, seed); assert.ok(w[0].star >= 2 && ['ogre', 'knight'].includes(w[0].soul), `wave ${n}`); }
  assert.equal(endlessWave(40, 1)[0].star, 3);
});

test('waves use varied templates', () => {
  const seen = new Set<string>(); for (let n = 3; n <= 60; n++) seen.add(endlessTemplate(n, 1).id);
  assert.equal(seen.size, TEMPLATES.length);
  for (const n of [1, 2]) for (const seed of [1, 2, 3, 4, 5]) for (const e of endlessWave(n, seed)) assert.ok(['warrior', 'goblin', 'archer'].includes(e.soul), 'warm-up waves have no tanks or brutes (' + e.soul + ')');
});

test('the endless rules hold Dominion at the campaign cap and never end the run by clearing it', () => {
  const c = ENDLESS_RULES.curve;
  assert.deepEqual(c.slice(0, 10), [9, 13, 17, 21, 25, 28, 31, 34, 37, 40]); assert.ok(c.slice(9).every((x) => x === 40));
  assert.ok((ENDLESS_RULES.stageWaves ?? 0) <= c.length, 'stageWaves must not run past the curve');
});

test('switching to endless mode changes waves and power, and switching back restores the stage', () => {
  setStageDifficulty('crypt', 'normal'); const normal = enemyWave(3, 1); assert.equal(isEndless(), false);
  setEndless(); assert.equal(isEndless(), true);
  assert.deepEqual(enemyWave(12, 5), endlessWave(12, 5)); assert.equal(enemyPower(25), endlessPower(25));
  setStageDifficulty('crypt', 'normal'); assert.equal(isEndless(), false); assert.deepEqual(enemyWave(3, 1), normal); assert.equal(enemyPower(), 1);
  assert.equal(ENDLESS_ID, 'endless');
});

test('a pack on every 10th wave with better tiers deeper; best depth only rises', () => {
  const s = defaultSave(); const packsAt = (n: number) => { const before = s.packs.length; const r = recordEndlessWave(s, n); return { r, added: s.packs.length - before }; };
  for (let n = 1; n < ENDLESS_PACK_EVERY; n++) assert.equal(packsAt(n).added, 0, 'no pack before wave 10');
  const w10 = packsAt(10); assert.equal(w10.added, 1); assert.equal(s.packs[s.packs.length - 1].tier, 1);
  for (let n = 11; n < 20; n++) packsAt(n);
  packsAt(20); assert.equal(s.packs[s.packs.length - 1].tier, 2);
  for (let n = 21; n < 30; n++) packsAt(n);
  packsAt(30); assert.equal(s.packs[s.packs.length - 1].tier, 3); packsAt(40); assert.equal(s.packs[s.packs.length - 1].tier, 3);
  assert.equal(s.endless.best, 40); recordEndlessWave(s, 5); assert.equal(s.endless.best, 40, 'best never goes down');
  assert.equal(endlessPackTier(10), 1); assert.equal(endlessPackTier(25), 2);
});

test('the endless save field loads from old saves, survives a round trip, and rejects nonsense', () => {
  assert.equal(sanitize({}).endless.best, 0); assert.equal(sanitize({ clears: { 'crypt:normal': 1 } }).endless.best, 0);
  assert.equal(sanitize({ endless: { best: 23 } }).endless.best, 23);
  for (const bad of [-3, 1.5, 'x', 1e9, null]) assert.equal(sanitize({ endless: { best: bad } }).endless.best, 0);
  const s = defaultSave(); s.endless.best = 17; assert.equal(sanitize(JSON.parse(JSON.stringify(s))).endless.best, 17);
});

test('Endless Depths opens after the last stage is cleared on Normal', () => {
  const s = defaultSave(); assert.equal(endlessUnlocked(s), false);
  for (const st of STAGES.slice(0, -1)) recordClear(s, st.id, 'normal'); assert.equal(endlessUnlocked(s), false, 'earlier stages are not enough');
  recordClear(s, STAGES[STAGES.length - 1].id, 'easy'); assert.equal(endlessUnlocked(s), false, 'Easy on the last stage is not enough');
  recordClear(s, STAGES[STAGES.length - 1].id, 'normal'); assert.equal(endlessUnlocked(s), true);
});
