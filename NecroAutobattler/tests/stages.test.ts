import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORED, DIFFS, STAGES, enemyPower, setStageDifficulty, stageById, waveCost } from '../core/waves.ts';
import { defaultSave, sanitize } from '../core/save.ts';
import { describeUnlock, difficultyLockReason, difficultyUnlocked, newUnlocks, playable, recordClear, stageUnlocked, unlockedKeys } from '../core/progress.ts';
import { Battle } from '../core/battle.ts';

test('every stage and tier has 10 waves that fit the grid, a positive power, and recommended levels that only go up', () => {
  for (const st of STAGES) {
    let prevRec = 0;
    for (const d of DIFFS) {
      assert.equal(st.lists[d].length, 10, `${st.id}/${d} needs 10 waves`);
      for (const w of st.lists[d]) assert.ok(w.split(' ').length <= 12, `${st.id}/${d} wave has more than 12 units`);
      assert.ok(st.power[d] > 0 && st.power[d] < 5);
      assert.ok(st.rec[d] >= prevRec, `${st.id}: recommended level should not drop from ${prevRec} at ${d}`); prevRec = st.rec[d];
    }
  }
  for (const d of DIFFS) for (let i = 1; i < STAGES.length; i++) assert.ok(STAGES[i].rec[d] >= STAGES[i - 1].rec[d], `later stages recommend at least as high a level (${d})`);
});

test('the unlock chain: Normal opens Hard and the next stage, Hard opens Nightmare, Easy opens nothing', () => {
  const s = defaultSave(), c = STAGES[0].id, next = STAGES[1].id;
  assert.ok(stageUnlocked(s, 0)); assert.equal(stageUnlocked(s, 1), false);
  assert.ok(difficultyUnlocked(s, c, 'easy') && difficultyUnlocked(s, c, 'normal'));
  assert.equal(difficultyUnlocked(s, c, 'hard'), false); assert.equal(difficultyUnlocked(s, c, 'nightmare'), false);
  assert.equal(difficultyUnlocked(s, next, 'easy'), false, 'a locked stage has no open tiers');
  recordClear(s, c, 'easy');
  assert.equal(difficultyUnlocked(s, c, 'hard'), false, 'clearing Easy does not unlock Hard'); assert.equal(stageUnlocked(s, 1), false);
  recordClear(s, c, 'normal');
  assert.ok(difficultyUnlocked(s, c, 'hard')); assert.ok(stageUnlocked(s, 1)); assert.equal(difficultyUnlocked(s, c, 'nightmare'), false);
  assert.ok(difficultyUnlocked(s, next, 'normal')); assert.equal(difficultyUnlocked(s, next, 'hard'), false, 'stage 2 Hard needs stage 2 Normal');
  recordClear(s, c, 'hard');
  assert.ok(difficultyUnlocked(s, c, 'nightmare'));
  assert.match(difficultyLockReason(s, next, 'hard'), /Clear .* on Normal to unlock Hard/);
  assert.equal(difficultyLockReason(s, c, 'hard'), '');
});

test('what the player may actually start: a locked pick falls back to something open', () => {
  const s = defaultSave(); s.stage = STAGES[2].id; s.difficulty = 'nightmare';
  assert.deepEqual(playable(s), { stage: STAGES[0].id, difficulty: 'normal' });
  recordClear(s, STAGES[0].id, 'normal'); s.stage = STAGES[1].id; s.difficulty = 'hard';
  assert.deepEqual(playable(s), { stage: STAGES[1].id, difficulty: 'normal' }, 'stage 2 is open but its Hard is not');
  s.stage = 'nonsense'; assert.equal(playable(s).stage, STAGES[0].id, 'an unknown stage falls back to the first');
});

test('a clear reports exactly what it unlocked, and the celebration is shown only once', () => {
  const s = defaultSave(), c = STAGES[0].id;
  const first = recordClear(s, c, 'normal');
  assert.deepEqual(first.unlocked.sort(), ['stage:' + STAGES[1].id, 'tier:' + c + ':hard'].sort());
  assert.deepEqual(recordClear(s, c, 'normal').unlocked, [], 'a repeat clear unlocks nothing new');
  assert.equal(newUnlocks(s).length, 2);
  s.seen = unlockedKeys(s); assert.equal(newUnlocks(s).length, 0);
  assert.match(describeUnlock('stage:' + STAGES[1].id), new RegExp(STAGES[1].name));
  assert.match(describeUnlock('tier:' + c + ':hard'), /Hard mode on/);
});

test('an older save (clears but no "seen" list) is flagged so old unlocks are not replayed; a new one is not', () => {
  assert.equal(sanitize({ clears: { 'crypt:normal': 1 } }).seen, null);
  assert.deepEqual(sanitize({}).seen, []);
  assert.deepEqual(sanitize({ clears: { 'crypt:normal': 1 }, seen: ['stage:graveyard', 7, 'x'.repeat(50)] }).seen, ['stage:graveyard']);
  assert.equal(sanitize({ stage: 'graveyard' }).stage, 'graveyard'); assert.equal(sanitize({ stage: '../evil' }).stage, 'crypt');
});

test('choosing a stage and tier sets the waves and the hidden enemy power', () => {
  setStageDifficulty('bastion', 'nightmare');
  assert.equal(enemyPower(), stageById('bastion').power.nightmare); assert.equal(AUTHORED.length, 10);
  const last = waveCost(AUTHORED[9]);
  setStageDifficulty('crypt', 'easy'); assert.equal(enemyPower(), 1); assert.ok(waveCost(AUTHORED[9]) < last);
  setStageDifficulty('crypt', 'normal');
});

test('enemy power only strengthens the enemy team', () => {
  const players = [{ soul: 'knight' as const, star: 1, cell: 3 }], enemies = [{ soul: 'knight' as const, star: 1 }];
  const plain = new Battle(players, enemies, 1), strong = new Battle(players, enemies, 1, undefined, 1.5);
  const mine = (b: Battle) => b.fighters.find((f) => f.team === 0)!, theirs = (b: Battle) => b.fighters.find((f) => f.team === 1)!;
  assert.equal(mine(strong).maxHp, mine(plain).maxHp); assert.equal(mine(strong).dmg, mine(plain).dmg);
  assert.ok(Math.abs(theirs(strong).maxHp - theirs(plain).maxHp * 1.5) < 1e-6); assert.ok(Math.abs(theirs(strong).dmg - theirs(plain).dmg * 1.5) < 1e-6);
});
