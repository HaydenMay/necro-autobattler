// Auto-battle simulation: pure logic, no graphics. Deterministic for a given seed.
// The renderer only reads fighters + events; it never decides anything.
//
// Abilities (numbers live in balance.ts):
//   Skeleton Warrior  Phalanx     takes less damage for each nearby allied Warrior (capped)
//   Skeleton Archer   Split Arrow (skill) one arrow at each of up to 3 different enemies; basic shots are a single arrow
//   Goblin            Opportunist +damage on an enemy that is fighting someone else; prefers such targets
//   Knight            Taunt (skill)  forces nearby enemies to attack him
//   Ogre              Smash (skill)  heavy slam that also hits enemies near the impact
// Skills run on mana: basic attacks and damage taken fill a bar; when full, the next attack is the skill and the bar resets.
// Warrior, Goblin and Barbarian have passives only (no mana).
//   Barbarian         Frenzy      attacks faster with every uninterrupted swing

import { GRID_COLS, GRID_ROWS } from './data.ts';
import type { SoulId } from './data.ts';
import { BALANCE } from './balance.ts';
import { makeRng } from './rng.ts';
import type { Rng } from './rng.ts';

export const GRID_SP = 1.3;     // metres between grid cells
export const FRONT_X = 1.7;     // front line's distance from the centre line

export interface Slot { soul: SoulId; star: number; cell: number }
export interface Spec { soul: SoulId; star: number }

/** World position of a grid cell for a team (team 0 = left, faces +X; team 1 = right, faces -X). */
export function cellPos(team: 0 | 1, cell: number): { x: number; z: number } {
  const row = Math.floor(cell / GRID_COLS), col = cell % GRID_COLS;
  const depth = GRID_COLS - 1 - col;                       // 0 = front line
  return { x: (FRONT_X + depth * GRID_SP) * (team === 0 ? -1 : 1), z: (row - (GRID_ROWS - 1) / 2) * GRID_SP };
}

const FRONTNESS: Record<SoulId, number> = { knight: 5, ogre: 4, warrior: 3, barbarian: 3, goblin: 2, archer: 0 };
/** The enemy army is placed automatically (tanks up front, archers behind); the player only ever sees its composition. */
export function enemyCells(specs: Spec[]): number[] {
  const cells: number[] = [];
  for (let c = 0; c < GRID_COLS * GRID_ROWS; c++) cells.push(c);
  cells.sort((a, b) => {
    const da = GRID_COLS - 1 - (a % GRID_COLS), db = GRID_COLS - 1 - (b % GRID_COLS);
    if (da !== db) return da - db;
    return Math.abs(Math.floor(a / GRID_COLS) - 1) - Math.abs(Math.floor(b / GRID_COLS) - 1);
  });
  const order = specs.map((s, i) => i).sort((i, j) => FRONTNESS[specs[j].soul] - FRONTNESS[specs[i].soul]);
  const out = new Array<number>(specs.length);
  order.forEach((idx, k) => { out[idx] = cells[k]; });
  return out;
}

export type FState = 'idle' | 'run' | 'attack' | 'dead';
export interface Fighter {
  id: number; team: 0 | 1; soul: SoulId; star: number; cell: number;
  x: number; z: number; yaw: number;
  hp: number; maxHp: number; dmg: number; interval: number; range: number; speed: number; radius: number;
  alive: boolean; state: FState;
  target: number; retargetAt: number; forcedTarget: number; forcedUntil: number;
  nextAttack: number; attackStart: number; attackDur: number; animSpeed: number; hitDone: boolean;
  mana: number; maxMana: number; casting: boolean; frenzy: number; deadAt: number;
}

export type BEvent =
  | { t: 'swing'; id: number; speed: number; dur: number }
  | { t: 'hit'; from: number; to: number; dmg: number; kind: 'melee' | 'arrow' | 'smash' }
  | { t: 'arrow'; from: number; to: number; dur: number }
  | { t: 'death'; id: number }
  | { t: 'cast'; id: number; skill: 'split' | 'taunt' | 'smash' }
  | { t: 'taunt'; id: number }
  | { t: 'smash'; id: number; x: number; z: number; r: number }
  | { t: 'frenzy'; id: number; stacks: number };

export class Battle {
  time = 0;
  fighters: Fighter[] = [];
  events: BEvent[] = [];
  winner: -1 | 0 | 1 = -1;
  rng: Rng;
  private pending: { at: number; from: number; to: number; dmg: number }[] = [];
  private nextId = 1;
  private enemyPower = 1;
  private flip = false;

  /** `levels`: the player's permanent Soul levels (health and damage grow a little per level). Enemies never use them. */
  /** `enemyPower`: health and damage multiplier for the enemy team only (stage strength; 1 = as written). */
  constructor(players: Slot[], enemies: Spec[], seed = 1, levels?: Partial<Record<SoulId, number>>, enemyPower = 1) {
    this.rng = makeRng(seed); this.enemyPower = enemyPower;
    for (const p of players) this.add(0, p.soul, p.star, p.cell, levels?.[p.soul] ?? 1);
    const cells = enemyCells(enemies);
    enemies.forEach((e, i) => this.add(1, e.soul, e.star, cells[i]));
  }

  private add(team: 0 | 1, soul: SoulId, star: number, cell: number, level = 1): Fighter {
    const B = BALANCE, st = B.stats[soul], p = cellPos(team, cell);
    const lvHp = 1 + (Math.max(1, level) - 1) * B.level.hp, lvDmg = 1 + (Math.max(1, level) - 1) * B.level.dmg;
    const pw = team === 1 ? this.enemyPower : 1;
    const hp = st.hp * B.star.hp[star - 1] * lvHp * pw;
    const f: Fighter = {
      id: this.nextId++, team, soul, star, cell, x: p.x, z: p.z, yaw: team === 0 ? 0 : Math.PI,
      hp, maxHp: hp, dmg: st.dmg * B.star.dmg[star - 1] * lvDmg * pw, interval: st.interval, range: st.range, speed: st.speed, radius: st.size * B.star.scale[star - 1],
      alive: true, state: 'idle', target: -1, retargetAt: 0, forcedTarget: -1, forcedUntil: 0,
      nextAttack: this.rng.next() * 0.3, attackStart: -9, attackDur: 1, animSpeed: 1, hitFrac: 0, hitDone: true,
      mana: 0, maxMana: B.mana[soul]?.max ?? 0, casting: false, frenzy: 0, deadAt: 0,
    } as Fighter;
    this.fighters.push(f); return f;
  }

  byId(id: number): Fighter | undefined { return id < 0 ? undefined : this.fighters[id - 1]; }
  foes(f: Fighter): Fighter[] { return this.fighters.filter((o) => o.alive && o.team !== f.team); }
  count(team: 0 | 1): number { return this.fighters.reduce((n, f) => n + (f.alive && f.team === team ? 1 : 0), 0); }
  drain(): BEvent[] { const e = this.events; this.events = []; return e; }

  step(dt: number): void {
    if (this.winner >= 0) return;
    this.time += dt; this.flip = !this.flip;
    // arrows that have finished flying
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (this.time >= p.at) {
        this.pending.splice(i, 1);
        const to = this.byId(p.to), from = this.byId(p.from);
        if (to && to.alive && from) this.damage(to, p.dmg, from, 'arrow');
      }
    }
    const order = this.fighters.filter((f) => f.alive); if (this.flip) order.reverse();
    for (const f of order) if (f.alive) this.update(f, dt);
    const a = this.count(0), b = this.count(1);
    if (!a || !b) this.winner = a ? 0 : 1;
    else if (this.time >= BALANCE.sim.timeLimit) {
      const hp = (t: 0 | 1) => this.fighters.filter((f) => f.alive && f.team === t).reduce((n, f) => n + f.hp / f.maxHp, 0);
      this.winner = hp(0) > hp(1) ? 0 : 1;
    }
  }

  // ------------------------------------------------------------------ per-fighter update
  private update(f: Fighter, dt: number): void {
    const B = BALANCE, st = B.stats[f.soul];
    this.separate(f, dt);

    if (f.state === 'attack') {
      const t = this.time - f.attackStart;
      const tg = this.byId(f.target); if (tg && tg.alive) this.face(f, tg.x - f.x, tg.z - f.z, dt);
      if (!f.hitDone && t >= f.attackDur * st.hitFrac) { f.hitDone = true; this.resolveHit(f); }
      if (t >= f.attackDur) f.state = 'idle';
      return;
    }
    this.acquire(f);
    const tg = this.byId(f.target);
    if (!tg || !tg.alive) { f.state = 'idle'; this.frenzyDecay(f); return; }
    const dx = tg.x - f.x, dz = tg.z - f.z, dist = Math.hypot(dx, dz);
    this.face(f, dx, dz, dt);
    if (dist <= f.range) {
      if (this.time >= f.nextAttack) this.startAttack(f); else { f.state = 'idle'; this.frenzyDecay(f); }
    } else {
      f.state = 'run'; const k = f.speed * dt / Math.max(dist, 1e-4); f.x += dx * k; f.z += dz * k; this.frenzyDecay(f);
    }
  }

  private frenzyDecay(f: Fighter): void {
    if (f.soul === 'barbarian' && f.frenzy > 0 && this.time - (f.attackStart + f.attackDur) > BALANCE.frenzy.resetAfter) f.frenzy = 0;
  }

  private face(f: Fighter, dx: number, dz: number, dt: number): void {
    if (dx * dx + dz * dz < 1e-6) return;
    const want = Math.atan2(dx, dz); let d = ((want - f.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    f.yaw += Math.max(-9 * dt, Math.min(9 * dt, d));
  }

  /**
   * Keep fighters from stacking without shoving anyone across the map.
   * - A fighter that is standing and fighting is "planted": it barely moves; the ones still WALKING yield to it.
   * - Heavier units (Ogre, Knight) push lighter ones more than the other way round.
   * - The total push on one fighter is capped per second, so a crowd can never slide a unit far.
   */
  private separate(f: Fighter, dt: number): void {
    const planted = (u: Fighter) => u.state === 'attack' || u.state === 'idle', mass = (u: Fighter) => u.radius * u.radius;
    let px = 0, pz = 0;
    for (const o of this.fighters) {
      if (o === f || !o.alive) continue;
      const dx = f.x - o.x, dz = f.z - o.z, m = Math.hypot(dx, dz), want = (f.radius + o.radius) * 1.05 + 0.08;
      if (m >= want) continue;
      let share = mass(o) / (mass(f) + mass(o));                       // the lighter one of the pair moves more
      const pf = planted(f), po = planted(o);
      if (pf && !po) share *= 0.12;                                   // f is standing its ground: the walker o goes around
      else if (!pf && po) share = Math.min(1, share * 1.5 + 0.35);    // f is walking into a planted unit: f yields
      else if (pf && po) share *= 0.35;                               // two standing units overlap a little: ease apart very slowly
      const k = ((want - m) / Math.max(m, 1e-3)) * share * 2;
      px += (m < 1e-3 ? (this.rng.next() - 0.5) : dx) * k; pz += (m < 1e-3 ? (this.rng.next() - 0.5) : dz) * k;
    }
    const s = Math.min(1, dt * 6); let mx = px * s, mz = pz * s;
    const cap = (planted(f) ? 0.5 : 1.6) * dt, len = Math.hypot(mx, mz);   // metres per second, standing vs walking
    if (len > cap) { mx *= cap / len; mz *= cap / len; }
    f.x += mx; f.z += mz;
  }

  private acquire(f: Fighter): void {
    if (f.forcedTarget >= 0) {
      const ft = this.byId(f.forcedTarget);
      if (ft && ft.alive && this.time < f.forcedUntil) { f.target = ft.id; return; }
      f.forcedTarget = -1;
    }
    const cur = this.byId(f.target);
    if (cur && cur.alive && this.time < f.retargetAt) return;
    f.retargetAt = this.time + BALANCE.sim.retargetEvery * (0.8 + 0.4 * this.rng.next());
    const foes = this.foes(f); if (!foes.length) { f.target = -1; return; }
    let best = foes[0], bs = Infinity;
    for (const o of foes) {
      let score = Math.hypot(o.x - f.x, o.z - f.z);
      if (f.soul === 'goblin') {
        // kill-steal: prefer nearby enemies already fighting one of our allies, and wounded ones
        const engaged = this.byId(o.target); const busy = !!engaged && engaged.alive && engaged.team === f.team && engaged.id !== f.id;
        if (busy && score < BALANCE.opportunist.seekRadius + 2) score -= 3;
        score -= BALANCE.opportunist.woundedWeight * (1 - o.hp / o.maxHp);
      }
      if (score < bs) { bs = score; best = o; }
    }
    f.target = best.id;
  }

  private startAttack(f: Fighter): void {
    const B = BALANCE, st = B.stats[f.soul]; let eff = f.interval;
    if (f.soul === 'barbarian') { f.frenzy = Math.min(B.frenzy.maxStacks, f.frenzy + 1); eff = f.interval / (1 + f.frenzy * B.frenzy.perSwing); this.events.push({ t: 'frenzy', id: f.id, stacks: f.frenzy }); }
    f.attackDur = Math.min(st.animLen, eff * 0.95); f.animSpeed = st.animLen / f.attackDur;
    f.attackStart = this.time; f.nextAttack = this.time + Math.max(eff, f.attackDur); f.hitDone = false; f.state = 'attack';
    f.casting = f.maxMana > 0 && f.mana >= f.maxMana; if (f.casting) { f.mana = 0; this.events.push({ t: 'cast', id: f.id, skill: f.soul === 'archer' ? 'split' : f.soul === 'knight' ? 'taunt' : 'smash' }); }
    this.events.push({ t: 'swing', id: f.id, speed: f.animSpeed, dur: f.attackDur });
  }

  private resolveHit(f: Fighter): void {
    const B = BALANCE; const tg = this.byId(f.target); if (!tg || !tg.alive) return;
    const M = B.mana[f.soul]; if (M && !f.casting) f.mana = Math.min(M.max, f.mana + M.perAttack);
    if (f.soul === 'archer') {                                           // basic: one arrow. Skill (Split Arrow): one arrow at each of up to 3 different enemies
      const reach = f.range * 1.25;
      const foes = this.foes(f).map((o) => ({ o, d: Math.hypot(o.x - f.x, o.z - f.z) })).filter((e) => e.d <= reach).sort((a, b) => a.d - b.d);
      const picked = f.casting ? [tg, ...foes.map((e) => e.o).filter((o) => o.id !== tg.id)].slice(0, B.volley.targets) : [tg];
      for (const o of picked) {
        const dur = Math.max(0.15, Math.hypot(o.x - f.x, o.z - f.z) / B.volley.projectileSpeed);
        this.pending.push({ at: this.time + dur, from: f.id, to: o.id, dmg: f.dmg });
        this.events.push({ t: 'arrow', from: f.id, to: o.id, dur });
      }
      f.casting = false; return;
    }
    if (Math.hypot(tg.x - f.x, tg.z - f.z) > f.range * 1.5) { f.casting = false; return; }   // target slipped away: the blow misses
    let dmg = f.dmg;
    if (f.soul === 'goblin') { const eng = this.byId(tg.target); if (eng && eng.alive && eng.team === f.team && eng.id !== f.id) dmg *= 1 + B.opportunist.bonus; }
    if (f.casting) {
      f.casting = false;
      if (f.soul === 'ogre') {
        dmg *= B.smash.mult; this.events.push({ t: 'smash', id: f.id, x: tg.x, z: tg.z, r: B.smash.radius });
        for (const o of this.foes(f)) if (o.id !== tg.id && Math.hypot(o.x - tg.x, o.z - tg.z) <= B.smash.radius) this.damage(o, dmg * 0.6, f, 'smash');
        this.damage(tg, dmg, f, 'smash'); return;
      }
      if (f.soul === 'knight') {
        for (const o of this.foes(f)) if (Math.hypot(o.x - f.x, o.z - f.z) <= B.taunt.radius) { o.forcedTarget = f.id; o.forcedUntil = this.time + B.taunt.duration; o.retargetAt = 0; }
        this.events.push({ t: 'taunt', id: f.id });
      }
    }
    this.damage(tg, dmg, f, 'melee');
  }

  private damage(t: Fighter, amount: number, from: Fighter, kind: 'melee' | 'arrow' | 'smash'): void {
    if (!t.alive) return;
    const B = BALANCE; let red = 0;
    if (t.soul === 'warrior') {
      const n = this.fighters.filter((o) => o.alive && o !== t && o.team === t.team && o.soul === 'warrior' && Math.hypot(o.x - t.x, o.z - t.z) <= B.phalanx.radius).length;
      red = Math.min(B.phalanx.maxStacks, n) * B.phalanx.perAlly;
    }
    const dmg = amount * (1 - red); t.hp -= dmg;
    const M = B.mana[t.soul]; if (M && t.hp > 0) t.mana = Math.min(M.max, t.mana + M.perHit);
    this.events.push({ t: 'hit', from: from.id, to: t.id, dmg, kind });
    if (t.hp <= 0) { t.hp = 0; t.alive = false; t.state = 'dead'; t.deadAt = this.time; this.events.push({ t: 'death', id: t.id }); }
  }
}

/** Run a whole fight without any graphics. Returns who won and how it went. */
export function simulate(players: Slot[], enemies: Spec[], seed = 1, maxSeconds = 130, levels?: Partial<Record<SoulId, number>>, enemyPower = 1): { winner: 0 | 1; time: number; left: number; hpLeft: number } {
  const b = new Battle(players, enemies, seed, levels, enemyPower);
  while (b.winner < 0 && b.time < maxSeconds) b.step(1 / 30);
  const w = (b.winner < 0 ? 1 : b.winner) as 0 | 1;
  const mine = b.fighters.filter((f) => f.alive && f.team === w);
  return { winner: w, time: b.time, left: mine.length, hpLeft: mine.reduce((n, f) => n + f.hp / f.maxHp, 0) };
}
