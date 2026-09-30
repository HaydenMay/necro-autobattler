import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_MIN_CAP, MODIFIERS, dailyRules, dayNumber, isValidDay, modifierFor } from '../core/daily.ts';
import { dailyDone, recordDailyWin } from '../core/progress.ts';
import { defaultSave, sanitize } from '../core/save.ts';
import { enemyPower, enemyWave, setDaily, setStageDifficulty, waveCost } from '../core/waves.ts';
import { newStage } from '../core/rules.ts';

test('the same day always gives the same twist and the same waves; the twist rotates from day to day', () => {
  const day = 20000; assert.equal(modifierFor(day).id, modifierFor(day).id);
  setDaily(modifierFor(day), day); const a = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((w) => enemyWave(w, day)));
  setDaily(modifierFor(day), day); assert.equal(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((w) => enemyWave(w, day))), a);
  const seen = new Set(Array.from({ length: MODIFIERS.length }, (_, i) => modifierFor(day + i).id)); assert.equal(seen.size, MODIFIERS.length, 'every twist comes up within a cycle');
  assert.equal(dayNumber(new Date(2026, 8, 30)) - dayNumber(new Date(2026, 8, 29)), 1);
});

test('each twist does what it says', () => {
  const mod = (id: string) => MODIFIERS.find((m) => m.id === id)!;
  setStageDifficulty('crypt', 'normal'); const base = [3, 5, 8, 10].map((w) => enemyWave(w, 1));
  setDaily(mod('melee'), 1); for (const w of [3, 5, 8, 10]) assert.ok(enemyWave(w, 1).every((e) => e.soul !== 'archer'));
  setDaily(mod('swarm'), 1); for (const w of [3, 5, 8, 10]) { const e = enemyWave(w, 1); assert.ok(e.length <= 12 && e.every((u) => u.soul === 'warrior' || u.soul === 'goblin')); }
  setDaily(mod('veterans'), 1); const vet = [3, 5, 8, 10].map((w) => enemyWave(w, 1));
  base.forEach((w, i) => w.forEach((e, k) => { if (e.soul === 'ogre' || e.soul === 'knight') assert.equal(vet[i][k].star, Math.min(3, e.star + 1)); }));
  setDaily(mod('empowered'), 1); assert.equal(enemyPower(5), 1.25);
  setStageDifficulty('crypt', 'normal'); assert.equal(enemyPower(5), 1, 'leaving the daily restores normal waves and power'); assert.equal(waveCost(enemyWave(3, 1)), waveCost(base[0]));
  const r = dailyRules(mod('cramped'), undefined); assert.ok(r.curve.every((c) => c >= DAILY_MIN_CAP)); assert.equal(newStage(r, 1).cap, r.curve[0]);
});

test('the daily reward is paid once per day, and old saves have no daily', () => {
  const s = defaultSave(); assert.equal(s.daily, null); assert.equal(dailyDone(s, 100), false);
  const a = recordDailyWin(s, 100); assert.ok(a.first && a.pack && a.gold > 0); assert.equal(s.packs.length, 1); const g = s.gold;
  const b = recordDailyWin(s, 100); assert.ok(!b.first && !b.pack && b.gold === 0); assert.equal(s.packs.length, 1); assert.equal(s.gold, g); assert.ok(dailyDone(s, 100));
  const c = recordDailyWin(s, 101); assert.ok(c.first, 'a new day pays again'); assert.equal(s.packs.length, 2);
});

test('the daily field survives a round trip and rejects nonsense', () => {
  const s = defaultSave(); s.daily = { day: 20500, won: true }; assert.deepEqual(sanitize(JSON.parse(JSON.stringify(s))).daily, { day: 20500, won: true });
  for (const bad of [{ day: -1, won: true }, { day: 1.5, won: true }, { day: 'x' }, null, 5]) assert.equal(sanitize({ daily: bad }).daily, null);
  assert.ok(isValidDay(20500) && !isValidDay(0) && !isValidDay(NaN));
});

test('a save from before gold gets a one-time catch-up grant; a brand new save does not', () => {
  assert.equal(sanitize({}).gold, 0); assert.ok(sanitize({ clears: { 'crypt:normal': 1 } }).gold > 0); assert.equal(sanitize({ clears: { 'crypt:normal': 1 }, gold: 5, goldScale: 2 }).gold, 5); assert.equal(sanitize({ gold: 5 }).gold, 500, 'gold saved in the old small units is converted once');
  for (const bad of [-3, 1.5, 'x', 1e12]) assert.equal(sanitize({ gold: bad, goldScale: 2 }).gold, 0);
  const s = defaultSave(); s.gold = 1234; assert.equal(sanitize(JSON.parse(JSON.stringify(s))).gold, 1234, 'a converted save is not converted again');
});
