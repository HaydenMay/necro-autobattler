import test from 'node:test';
import assert from 'node:assert/strict';
import { newStage, draftOptions, discardRedraw } from '../core/rules.ts';
import { PROTOTYPE_RULES } from '../core/prototype.ts';
import { defaultSave, loadSave, sanitize, updateSettings, writeSave, DECK_SIZE } from '../core/save.ts';

const fakeStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

test('a run only draws Souls from the equipped deck', () => {
  const rules = { ...PROTOTYPE_RULES, pool: ['archer' as const, 'ogre' as const] };
  for (let seed = 1; seed <= 30; seed++) {
    const s = newStage(rules, seed);
    for (const c of [...s.hand, ...draftOptions(s)]) assert.ok(c === 'archer' || c === 'ogre', 'drew ' + c);
    discardRedraw(s, 0);
    for (const c of s.hand) assert.ok(c === 'archer' || c === 'ogre', 'after swap drew ' + c);
  }
});

test('a one-Soul deck still works (swap cannot avoid the only Soul)', () => {
  const s = newStage({ ...PROTOTYPE_RULES, pool: ['goblin'] }, 5);
  assert.ok(s.hand.every((c) => c === 'goblin'));
  assert.doesNotThrow(() => discardRedraw(s, 0));
});

test('save: round trip, and damaged data is repaired instead of crashing', () => {
  const st = fakeStore(), save = defaultSave();
  save.deck = ['knight', 'archer']; save.souls.knight.level = 3; save.souls.knight.copies = 7;
  writeSave(save, st);
  const back = loadSave(st);
  assert.deepEqual(back.deck, ['knight', 'archer']);
  assert.equal(back.souls.knight.level, 3);
  const bad = sanitize({ deck: ['knight', 'knight', 'dragon', 'ogre', 'goblin', 'warrior', 'archer', 'barbarian'], souls: { ogre: { level: -4, copies: 'x' } } });
  assert.equal(bad.deck.length, DECK_SIZE);
  assert.equal(new Set(bad.deck).size, bad.deck.length);
  assert.ok(!bad.deck.includes('dragon' as any));
  assert.equal(bad.souls.ogre.level, 1);
  assert.deepEqual(sanitize({ deck: [] }).deck, defaultSave().deck, 'an empty deck falls back to the default');
  const st2 = fakeStore(); st2.setItem('necro-save', '{not json'); assert.deepEqual(loadSave(st2), defaultSave());
  assert.doesNotThrow(() => loadSave(null));
});

test('sound settings default on, persist, and ignore junk', () => {
  const st = fakeStore();
  assert.deepEqual(loadSave(st).settings, { music: true, sfx: true });
  assert.deepEqual(updateSettings({ music: false }, st), { music: false, sfx: true });
  assert.deepEqual(loadSave(st).settings, { music: false, sfx: true });
  assert.deepEqual(sanitize({ settings: { music: 'no', sfx: false } }).settings, { music: true, sfx: false });
  const save = loadSave(st); save.deck = ['ogre']; writeSave(save, st);
  assert.equal(loadSave(st).settings.music, false, 'changing the deck keeps the sound settings');
});
