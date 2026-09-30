import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSave, sanitize } from '../core/save.ts';
import { MILESTONES, claimMilestone, milestoneReady, readyMilestones } from '../core/milestones.ts';
import { dailyPackTier, dailyStreakNow, recordDailyWin } from '../core/progress.ts';

test('a milestone is claimable only when reached, and pays exactly once', () => {
  const s = defaultSave(); assert.equal(readyMilestones(s), 0);
  s.endless.best = 12; const m = MILESTONES.find((x) => x.id === 'endless-10')!;
  assert.ok(milestoneReady(s, m));
  const r = claimMilestone(s, 'endless-10')!; assert.equal(r.pack.tier, m.tier); assert.equal(s.gold, m.gold); assert.equal(s.packs.length, 1);
  assert.equal(claimMilestone(s, 'endless-10'), null); assert.equal(s.gold, m.gold);
  assert.equal(claimMilestone(s, 'endless-20'), null);
});

test('a full pack shelf keeps the milestone claimable', () => {
  const s = defaultSave(); s.endless.best = 10;
  for (let i = 0; i < 99; i++) s.packs.push({ id: i + 1, tier: 1, source: 'x' }); s.nextPackId = 100;
  assert.equal(claimMilestone(s, 'endless-10'), null); assert.equal(s.claimed.length, 0);
});

test('the daily streak grows on consecutive days, resets after a gap, and pays better packs', () => {
  const s = defaultSave(); const tiers: number[] = [];
  for (let d = 100; d < 107; d++) { const r = recordDailyWin(s, d); tiers.push(r.pack!.tier); assert.equal(r.streak, d - 99); }
  assert.deepEqual(tiers, [1, 1, 2, 2, 2, 2, 3]);
  assert.equal(recordDailyWin(s, 106).first, false); assert.equal(s.dailyWins, 7);
  assert.equal(dailyStreakNow(s, 107), 7); assert.equal(dailyStreakNow(s, 108), 0);
  assert.equal(recordDailyWin(s, 109).streak, 1); assert.equal(dailyPackTier(7), 3);
});

test('milestone and streak fields survive sanitising and old saves load', () => {
  const s = defaultSave(); s.claimed = ['soul-5']; s.dailyWins = 4; s.dailyStreak = { count: 3, last: 200 };
  const back = sanitize(JSON.parse(JSON.stringify(s))); assert.deepEqual(back.claimed, ['soul-5']); assert.equal(back.dailyWins, 4); assert.deepEqual(back.dailyStreak, { count: 3, last: 200 });
  const old = sanitize({ souls: {} }); assert.deepEqual(old.claimed, []); assert.equal(old.dailyWins, 0);
  const bad = sanitize({ claimed: [5, 'ok', 'ok'], dailyWins: -2, dailyStreak: { count: 'x' } }); assert.deepEqual(bad.claimed, ['ok']); assert.equal(bad.dailyWins, 0); assert.equal(bad.dailyStreak.count, 0);
});
