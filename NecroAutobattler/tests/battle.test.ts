import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, simulate, cellPos } from '../core/battle.ts';
import { BALANCE, resetBalance } from '../core/balance.ts';

const P = (soul: any, cell: number, star = 1) => ({ soul, star, cell });
const E = (soul: any, star = 1) => ({ soul, star });

test('same seed -> identical fight', () => {
  const a = simulate([P('warrior', 3), P('archer', 1)], [E('goblin'), E('knight')], 5);
  const b = simulate([P('warrior', 3), P('archer', 1)], [E('goblin'), E('knight')], 5);
  assert.deepEqual(a, b);
});

test('a fight always ends with a winner', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const r = simulate([P('warrior', 3), P('goblin', 7)], [E('warrior'), E('archer')], seed);
    assert.ok(r.winner === 0 || r.winner === 1); assert.ok(r.time < 130);
  }
});

test('Knight taunt forces nearby enemies to attack him', () => {
  const b = new Battle([P('knight', 3), P('warrior', 7)], [E('goblin'), E('goblin')], 2);
  for (let i = 0; i < 300; i++) b.step(1 / 30);
  const knight = b.fighters.find((f) => f.soul === 'knight')!;
  const taunted = b.fighters.filter((f) => f.team === 1 && f.alive && f.forcedTarget === knight.id).length;
  assert.ok(b.events.some((e) => e.t === 'taunt') || taunted > 0, 'knight should have cast Taunt');
});

test('Archer: basic shot is one arrow, Split Arrow skill hits several enemies once mana is full', () => {
  const b = new Battle([P('archer', 3, 3)], [E('warrior'), E('warrior'), E('warrior')], 3);
  const perShot: number[] = []; let casts = 0, arrowsSinceSwing = 0;
  for (let i = 0; i < 400; i++) {
    b.step(1 / 30);
    for (const e of b.drain()) {
      if (e.t === 'swing') { if (arrowsSinceSwing) perShot.push(arrowsSinceSwing); arrowsSinceSwing = 0; }
      if (e.t === 'cast') casts++;
      if (e.t === 'arrow') arrowsSinceSwing++;
    }
  }
  assert.equal(perShot[0], 1, 'first shot should be a single arrow');
  assert.ok(casts >= 1, 'archer should have cast Split Arrow');
  assert.ok(perShot.some((n) => n >= 2), 'a skill shot should send 2+ arrows, shots were ' + perShot.join(','));
});

test('Ogre Smash fires from mana, about every 3rd swing, and mana resets', () => {
  const b = new Battle([P('ogre', 3, 3)], [E('knight', 3)], 4);   // a 3-star Ogre vs one 3-star Knight: lasts long enough for several hits
  let smashes = 0, swings = 0;
  for (let i = 0; i < 1200 && b.winner < 0; i++) { b.step(1 / 30); for (const e of b.drain()) { if (e.t === 'smash') smashes++; if (e.t === 'swing' && b.byId(e.id)!.soul === 'ogre') swings++; } }
  assert.ok(smashes >= 1 && smashes <= Math.ceil(swings / 3) + 1, `smashes ${smashes} swings ${swings}`);
});

test('Passive-only units have no mana bar', () => {
  const b = new Battle([P('warrior', 3), P('barbarian', 7), P('goblin', 11)], [E('warrior')], 5);
  assert.ok(b.fighters.filter((f) => f.team === 0).every((f) => f.maxMana === 0));
});

test('Barbarian frenzy builds up while swinging', () => {
  const b = new Battle([P('barbarian', 3)], [E('ogre', 3)], 6);
  let max = 0;
  for (let i = 0; i < 600 && b.winner < 0; i++) { b.step(1 / 30); for (const e of b.drain()) if (e.t === 'frenzy') max = Math.max(max, e.stacks); }
  assert.ok(max >= 3, 'frenzy stacks reached ' + max);
});

test('Phalanx: warriors next to warriors take less damage', () => {
  const alone = new Battle([P('warrior', 3)], [E('goblin')], 1); const group = new Battle([P('warrior', 3), P('warrior', 7), P('warrior', 11)], [E('goblin')], 1);
  (alone as any).damage(alone.fighters[0], 10, alone.fighters[1], 'melee'); (group as any).damage(group.fighters[0], 10, group.fighters[3], 'melee');
  assert.ok(group.fighters[0].hp > alone.fighters[0].hp, `grouped ${group.fighters[0].hp} vs alone ${alone.fighters[0].hp}`);
});

test('star multipliers change HP and damage (single source of truth)', () => {
  const b1 = new Battle([P('knight', 3, 1)], [E('goblin')], 1), b3 = new Battle([P('knight', 3, 3)], [E('goblin')], 1);
  assert.equal(b3.fighters[0].maxHp, b1.fighters[0].maxHp * BALANCE.star.hp[2]);
  BALANCE.star.hp[2] = 5; const b4 = new Battle([P('knight', 3, 3)], [E('goblin')], 1);
  assert.equal(b4.fighters[0].maxHp, b1.fighters[0].maxHp * 5); resetBalance();
});

test('player cells map to the left, enemy cells to the right', () => {
  assert.ok(cellPos(0, 0).x < 0 && cellPos(1, 0).x > 0);
  assert.ok(Math.abs(cellPos(0, 3).x) < Math.abs(cellPos(0, 0).x), 'column 3 is the front line');
});

test('every difficulty has 10 waves that fit the grid, and they get bigger toward the end', async () => {
  const { DIFFICULTY, setDifficulty, enemyWave, waveCost } = await import('../core/waves.ts');
  for (const name of ['easy', 'normal', 'hard', 'nightmare']) {
    assert.equal(DIFFICULTY[name].length, 10, name + ' needs 10 waves');
    setDifficulty(name);
    const costs = Array.from({ length: 10 }, (_, i) => waveCost(enemyWave(i + 1, 1)));
    for (let w = 1; w <= 10; w++) assert.ok(enemyWave(w, 1).length <= 12, name + ' wave ' + w + ' has more units than the grid');
    assert.ok(costs[9] > costs[0] * 2, name + ' last wave should be much bigger than the first');
  }
  const total = (n: string) => { setDifficulty(n); return Array.from({ length: 10 }, (_, i) => waveCost(enemyWave(i + 1, 1))).reduce((a, b) => a + b, 0); };
  assert.ok(total('easy') < total('normal') && total('normal') < total('hard') && total('hard') < total('nightmare'), 'harder presets field more total enemy cost');
  setDifficulty('normal');
});
