import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURVES } from '../core/data.ts';
import type { Rules } from '../core/data.ts';
import {
  canSummon, checkInvariants, clearWave, discardRedraw, dominionUsed, failWave, mergeDeployed,
  mergeFromHand, newStage, summon,
} from '../core/rules.ts';
import { playPerfectRun } from '../sim/engine.ts';
import { POLICIES } from '../sim/policies.ts';

const doc: Rules = { curve: CURVES.doc, merge: 'deployedOnly' };
const withHand = (rules: Rules, hand: string[]) => { const s = newStage(rules, 1); s.hand = hand as never; s.stats.drawn = hand.length; return s; };

test('wave 1 opening: Ogre (7) + Warrior (2) fits the 9 cap exactly, nothing more does', () => {
  const s = withHand(doc, ['ogre', 'warrior', 'warrior']);
  assert.ok(summon(s, 0));
  assert.ok(summon(s, 0));
  assert.equal(dominionUsed(s), 9);
  assert.equal(canSummon(s, 0), false);
  checkInvariants(s);
});

test('cannot exceed the Dominion cap', () => {
  const s = withHand(doc, ['ogre', 'ogre']);
  assert.ok(summon(s, 0));
  assert.equal(summon(s, 0), false);
  assert.equal(dominionUsed(s), 7);
});

test('merge frees a cell and lowers Dominion', () => {
  const s = withHand(doc, ['warrior', 'warrior']);
  summon(s, 0); summon(s, 0);
  assert.equal(dominionUsed(s), 4);
  assert.ok(mergeDeployed(s, s.units[0].id, s.units[1].id));
  assert.equal(s.units.length, 1);
  assert.equal(s.units[0].star, 2);
  assert.equal(dominionUsed(s), 3);
  checkInvariants(s);
});

test('3 stars is the maximum', () => {
  const s = withHand(doc, ['warrior', 'warrior']);
  summon(s, 0); summon(s, 0);
  s.units[0].star = 3; s.units[1].star = 3;
  assert.equal(mergeDeployed(s, s.units[0].id, s.units[1].id), false);
});

test('merge-from-hand only exists under the handIntoOneStar rule', () => {
  const rulesHand: Rules = { curve: CURVES.doc, merge: 'handIntoOneStar' };
  const a = withHand(doc, ['warrior', 'warrior']); summon(a, 0);
  assert.equal(mergeFromHand(a, 0, a.units[0].id), false);
  const b = withHand(rulesHand, ['warrior', 'warrior']); summon(b, 0);
  assert.ok(mergeFromHand(b, 0, b.units[0].id));
  assert.equal(b.units[0].star, 2);
  checkInvariants(b);
});

test('clearing a wave raises the cap and gives 2 cards (draft pick + normal draw)', () => {
  const s = newStage(doc, 3);
  const before = s.hand.length;
  clearWave(s, () => 0);
  assert.equal(s.wave, 2);
  assert.equal(s.cap, 13);
  assert.equal(s.hand.length, before + 2);
});

test('failing a wave: -1 heart, cap unchanged, +1 card, discard available again', () => {
  const s = newStage(doc, 3);
  discardRedraw(s, 0);
  assert.equal(s.discardUsed, true);
  const before = s.hand.length;
  failWave(s);
  assert.equal(s.hearts, 2);
  assert.equal(s.cap, 9);
  assert.equal(s.wave, 1);
  assert.equal(s.hand.length, before + 1);
  assert.equal(s.discardUsed, false);
});

test('third wipe loses the stage', () => {
  const s = newStage(doc, 3);
  failWave(s); failWave(s); failWave(s);
  assert.equal(s.status, 'lost');
});

test('a perfect 10-wave run draws exactly 22 cards and never breaks an invariant', () => {
  for (const merge of ['deployedOnly', 'handIntoOneStar'] as const) {
    for (const p of Object.values(POLICIES)) {
      for (let seed = 1; seed <= 200; seed++) {
        const { state } = playPerfectRun({ curve: CURVES.doc, merge }, p, seed);
        // 4 start + 9 x (draft + normal) + 1 per discard-redraw
        assert.equal(state.stats.drawn - state.stats.discarded, 22);
        assert.equal(state.status, 'won');
      }
    }
  }
});

test('same seed -> identical run (reproducible bug reports)', () => {
  const a = playPerfectRun(doc, POLICIES.smart, 99).state.log.join('\n');
  const b = playPerfectRun(doc, POLICIES.smart, 99).state.log.join('\n');
  assert.equal(a, b);
});
