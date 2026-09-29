import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/rng.ts';
import { draftOptions, newStage, normalDraw, summon, mergeFromHand, discardRedraw } from '../core/rules.ts';
import { PROTOTYPE_RULES } from '../core/prototype.ts';
import { clearRun, deserializeState, loadRun, saveRun, serializeState } from '../core/runsave.ts';
import type { RunSnapshot } from '../core/runsave.ts';

const fakeStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

test('a resumed RNG continues exactly where the saved one stopped', () => {
  const a = makeRng(42); for (let i = 0; i < 17; i++) a.next();
  const b = makeRng(a.seed, a.state());
  for (let i = 0; i < 25; i++) assert.equal(a.next(), b.next());
});

function midRun() {
  const s = newStage({ ...PROTOTYPE_RULES, pool: ['warrior', 'archer', 'knight', 'ogre'] }, 77);
  summon(s, 0, 3); summon(s, 0, 2); if (s.hand.length) mergeFromHand(s, 0, s.units[0].id); discardRedraw(s, 0); normalDraw(s);
  return s;
}

test('a saved run comes back identical and keeps drawing the same cards', () => {
  const s = midRun();
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(s))))!;
  assert.ok(back, 'should restore');
  assert.deepEqual({ ...back, rng: 0, log: 0 }, { ...s, rng: 0, log: 0 });
  for (let i = 0; i < 6; i++) { normalDraw(s); normalDraw(back); assert.deepEqual(draftOptions(s), draftOptions(back)); }
  assert.deepEqual(s.hand, back.hand);
});

test('damaged or impossible run data is rejected instead of crashing the game', () => {
  const good = () => JSON.parse(JSON.stringify(serializeState(midRun())));
  const bad = (edit: (x: any) => void) => { const x = good(); edit(x); return deserializeState(x); };
  assert.ok(deserializeState(good()));
  assert.equal(bad((x) => (x.hearts = 0)), null, 'no hearts left is a lost run, not a saved one');
  assert.equal(bad((x) => (x.wave = 99)), null);
  assert.equal(bad((x) => (x.units[1].cell = x.units[0].cell)), null, 'two units on one tile');
  assert.equal(bad((x) => (x.units[0].star = 9)), null);
  assert.equal(bad((x) => (x.hand.push('dragon'))), null);
  assert.equal(bad((x) => (x.rules.pool = ['dragon'])), null);
  assert.equal(bad((x) => (x.rng.pos = 'x')), null);
  assert.equal(deserializeState(null), null); assert.equal(deserializeState('junk'), null);
});

test('run storage: round trip, clear, and garbage', () => {
  const st = fakeStore(), s = midRun();
  const snap: RunSnapshot = { v: 1, seed: 77, attempt: 2, difficulty: 'hard', phase: 'draft', draft: ['ogre', 'knight', 'archer'], state: serializeState(s) };
  saveRun(snap, st);
  const r = loadRun(st)!; assert.ok(r); assert.equal(r.snap.difficulty, 'hard'); assert.equal(r.snap.phase, 'draft'); assert.deepEqual(r.snap.draft, ['ogre', 'knight', 'archer']); assert.equal(r.state.wave, s.wave);
  saveRun({ ...snap, draft: ['ogre'] as any }, st); assert.equal(loadRun(st)!.snap.phase, 'build', 'a broken draft falls back to the build screen');
  clearRun(st); assert.equal(loadRun(st), null);
  st.setItem('necro-run', '{oops'); assert.equal(loadRun(st), null);
  assert.equal(loadRun(null), null);
});
