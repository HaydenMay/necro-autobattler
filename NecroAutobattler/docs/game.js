(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // core/balance.ts
  var DEFAULTS = {
    stats: {
      warrior: { hp: 60, dmg: 8, interval: 0.9, range: 0.85, speed: 1.4, size: 0.28, animLen: 1, hitFrac: 0.47 },
      archer: { hp: 40, dmg: 7, interval: 1.7, range: 5, speed: 1.1, size: 0.26, animLen: 1.5, hitFrac: 0.78 },
      goblin: { hp: 45, dmg: 9, interval: 0.8, range: 0.8, speed: 1.7, size: 0.24, animLen: 1, hitFrac: 0.5 },
      knight: { hp: 130, dmg: 9, interval: 1.1, range: 0.9, speed: 1, size: 0.32, animLen: 1, hitFrac: 0.5 },
      ogre: { hp: 170, dmg: 16, interval: 1.9, range: 1.05, speed: 0.8, size: 0.42, animLen: 1.2, hitFrac: 0.55 },
      barbarian: { hp: 75, dmg: 8, interval: 0.95, range: 0.9, speed: 1.5, size: 0.3, animLen: 1, hitFrac: 0.5 }
    },
    // "bodies = damage, stars = durability": HP grows faster than damage per star
    star: { hp: [1, 2, 3.2], dmg: [1, 1.5, 2], scale: [1, 1.12, 1.25] },
    phalanx: { radius: 2, perAlly: 0.08, maxStacks: 3 },
    // mana fills fast: a basic attack gives perAttack, taking a hit gives perHit; a full bar fires the skill on the next attack, then resets
    mana: {
      archer: { max: 100, perAttack: 34, perHit: 6 },
      // Split Arrow about every 3rd shot
      ogre: { max: 100, perAttack: 34, perHit: 6 },
      // Smash about every 3rd swing
      knight: { max: 100, perAttack: 25, perHit: 12 }
      // Taunt every ~4 swings, sooner when he is being hit
    },
    volley: { targets: 3, projectileSpeed: 14 },
    opportunist: { bonus: 0.5, seekRadius: 4, woundedWeight: 1.5 },
    taunt: { duration: 3, radius: 4.5 },
    smash: { mult: 2, radius: 1.6 },
    frenzy: { perSwing: 0.12, maxStacks: 8, resetAfter: 0.6 },
    level: { hp: 0.08, dmg: 0.08, copiesToLevel: [5, 10, 20, 40, 80, 120, 200, 300, 500] },
    sim: { separation: 0.6, hitFraction: 0.47, timeLimit: 120, retargetEvery: 0.5 }
  };
  var BALANCE = JSON.parse(JSON.stringify(DEFAULTS));
  function resetBalance() {
    const fresh = JSON.parse(JSON.stringify(DEFAULTS));
    for (const k of Object.keys(fresh)) BALANCE[k] = fresh[k];
  }
  var ROLE_TEXT = {
    warrior: "Cheap and fast. Tougher near other Warriors.",
    archer: "Fragile. Skill: Split Arrow hits 3 different enemies.",
    goblin: "Fast. Hits harder on enemies fighting someone else.",
    knight: "Tank. Skill: Taunt pulls enemies onto him.",
    ogre: "Slow, huge damage. Skill: Smash, a big area slam.",
    barbarian: "Swings faster with every uninterrupted hit."
  };
  var SOUL_NAME = {
    warrior: "Skeleton Warrior",
    archer: "Skeleton Archer",
    goblin: "Goblin",
    knight: "Knight",
    ogre: "Ogre",
    barbarian: "Barbarian"
  };

  // core/data.ts
  var SOULS = ["warrior", "archer", "goblin", "knight", "ogre", "barbarian"];
  var COST = {
    warrior: [2, 3, 4],
    archer: [4, 6, 9],
    goblin: [3, 4, 6],
    knight: [5, 7, 10],
    ogre: [7, 10, 15],
    barbarian: [5, 7, 10]
    // PLACEHOLDER: the doc has no cost for the sixth Soul yet
  };
  var MAX_STAR = 3;
  var GRID_CELLS = 12;
  var CURVES = {
    // LOCKED (confirmed): +4 for waves 2-5, then +3 for waves 6-10 -> 40
    doc: [9, 13, 17, 21, 25, 28, 31, 34, 37, 40],
    // NOT USED: misremembered variant (+3 through wave 6, then +2) that only reaches 32. Kept for comparison only.
    recalled: [9, 12, 15, 18, 21, 24, 26, 28, 30, 32]
  };
  var HEARTS = 3;
  var START_HAND = 4;
  var WAVES = 10;
  var GRID_COLS = 4;
  var GRID_ROWS = 3;

  // core/rng.ts
  function makeRng(seed, resume) {
    let a = (resume != null ? resume : seed) >>> 0;
    const next = () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    return {
      seed,
      next,
      int: (n) => Math.floor(next() * n),
      pick: (items) => items[Math.floor(next() * items.length)],
      state: () => a
    };
  }

  // core/rules.ts
  var cost = (soul, star) => COST[soul][star - 1];
  var cardsIn = (star) => 2 ** (star - 1);
  var dominionUsed = (s) => s.units.reduce((n, u) => n + cost(u.soul, u.star), 0);
  var dominionFree = (s) => s.cap - dominionUsed(s);
  function log(s, msg) {
    s.log.push(`[w${s.wave}] ${msg}`);
  }
  var poolOf = (s) => s.rules.pool && s.rules.pool.length ? s.rules.pool : SOULS;
  function draw(s, why, not) {
    const all = poolOf(s), others = not ? all.filter((x) => x !== not) : all;
    const pool = others.length ? others : all;
    const c = s.rng.pick(pool);
    s.hand.push(c);
    s.stats.drawn++;
    log(s, `draw ${c} (${why})`);
    return c;
  }
  function newPhase(s) {
    s.discardUsed = false;
    for (const u of s.units) u.fresh = false;
  }
  function newStage(rules, seed) {
    var _a;
    const s = {
      rules,
      rng: makeRng(seed),
      wave: 1,
      hearts: HEARTS,
      cap: rules.curve[0],
      hand: [],
      units: [],
      nextId: 1,
      discardUsed: false,
      status: "building",
      log: [],
      stats: { drawn: 0, discarded: 0, dismissed: 0, merges: 0, failures: 0 }
    };
    for (let i = 0; i < ((_a = rules.startHand) != null ? _a : START_HAND); i++) draw(s, "starting hand");
    return s;
  }
  function freeCell(s) {
    const taken = new Set(s.units.map((u) => u.cell));
    for (let c = 0; c < GRID_CELLS; c++) if (!taken.has(c)) return c;
    return -1;
  }
  function canSummon(s, handIdx) {
    const soul = s.hand[handIdx];
    return soul !== void 0 && freeCell(s) >= 0 && cost(soul, 1) <= dominionFree(s);
  }
  function cellFree(s, cell) {
    return cell >= 0 && cell < GRID_CELLS && !s.units.some((u) => u.cell === cell);
  }
  function summon(s, handIdx, cell) {
    if (!canSummon(s, handIdx)) return false;
    if (cell !== void 0 && !cellFree(s, cell)) return false;
    const soul = s.hand.splice(handIdx, 1)[0];
    const u = { id: s.nextId++, soul, star: 1, cell: cell != null ? cell : freeCell(s), fresh: true };
    s.units.push(u);
    log(s, `summon ${soul} 1* -> cell ${u.cell}  (dominion ${dominionUsed(s)}/${s.cap})`);
    return true;
  }
  function canMergeDeployed(a, b) {
    return a.id !== b.id && a.soul === b.soul && a.star === b.star && a.star < MAX_STAR;
  }
  function mergeDeployed(s, aId, bId) {
    const a = s.units.find((u) => u.id === aId), b = s.units.find((u) => u.id === bId);
    if (!a || !b || !canMergeDeployed(a, b)) return false;
    s.units = s.units.filter((u) => u.id !== b.id);
    a.fresh = !!(a.fresh || b.fresh);
    a.star++;
    s.stats.merges++;
    log(s, `merge ${a.soul} ${a.star - 1}*+${a.star - 1}* -> ${a.star}*  (dominion ${dominionUsed(s)}/${s.cap}, cells ${s.units.length}/${GRID_CELLS})`);
    return true;
  }
  function canMergeFromHand(s, handIdx, unitId) {
    if (s.rules.merge !== "handIntoOneStar") return false;
    const soul = s.hand[handIdx], u = s.units.find((x) => x.id === unitId);
    if (!soul || !u || u.soul !== soul || u.star !== 1) return false;
    return cost(soul, 2) - cost(soul, 1) <= dominionFree(s);
  }
  function mergeFromHand(s, handIdx, unitId) {
    if (!canMergeFromHand(s, handIdx, unitId)) return false;
    const soul = s.hand.splice(handIdx, 1)[0];
    const u = s.units.find((x) => x.id === unitId);
    u.star = 2;
    s.stats.merges++;
    log(s, `merge-from-hand ${soul} -> ${u.soul} 2*  (dominion ${dominionUsed(s)}/${s.cap})`);
    return true;
  }
  function dismiss(s, unitId) {
    const u = s.units.find((x) => x.id === unitId);
    if (!u) return false;
    s.units = s.units.filter((x) => x.id !== unitId);
    s.stats.dismissed += cardsIn(u.star);
    log(s, `dismiss ${u.soul} ${u.star}* (permanently removed)`);
    return true;
  }
  function discardRedraw(s, handIdx) {
    if (s.discardUsed || handIdx < 0 || handIdx >= s.hand.length) return false;
    const c = s.hand.splice(handIdx, 1)[0];
    s.discardUsed = true;
    s.stats.discarded++;
    log(s, `swap: discard ${c}`);
    draw(s, "swap", c);
    return true;
  }
  function canSwapSell(s, unitId) {
    const u = s.units.find((x) => x.id === unitId);
    return !s.discardUsed && !!u && !u.fresh;
  }
  function swapSell(s, unitId) {
    if (!canSwapSell(s, unitId)) return false;
    const u = s.units.find((x) => x.id === unitId);
    s.units = s.units.filter((x) => x.id !== unitId);
    s.discardUsed = true;
    s.stats.dismissed += cardsIn(u.star);
    log(s, `swap: sell ${u.soul} ${u.star}*`);
    draw(s, "swap", u.soul);
    return true;
  }
  function moveUnit(s, unitId, cell) {
    const u = s.units.find((x) => x.id === unitId);
    if (!u || !cellFree(s, cell)) return false;
    log(s, `move ${u.soul} cell ${u.cell} -> ${cell}`);
    u.cell = cell;
    return true;
  }
  function draftOptions(s) {
    const p = poolOf(s);
    return [s.rng.pick(p), s.rng.pick(p), s.rng.pick(p)];
  }
  var stageWaves = (s) => {
    var _a;
    return (_a = s.rules.stageWaves) != null ? _a : WAVES;
  };
  function advanceWave(s) {
    if (s.status !== "building") return s.status === "won";
    if (s.wave >= stageWaves(s)) {
      s.status = "won";
      log(s, "stage cleared");
      return true;
    }
    s.wave++;
    s.cap = s.rules.curve[s.wave - 1];
    newPhase(s);
    log(s, `wave cleared -> cap ${s.cap}`);
    return false;
  }
  function takeDraft(s, opts, idx) {
    const pick = opts[Math.max(0, Math.min(opts.length - 1, idx))];
    s.hand.push(pick);
    s.stats.drawn++;
    log(s, `draft [${opts.join(", ")}] -> took ${pick}`);
  }
  function normalDraw(s) {
    if (s.rules.normalDrawWaves ? s.rules.normalDrawWaves.includes(s.wave) : true) draw(s, "wave clear");
  }
  function failWave(s) {
    if (s.status !== "building") return;
    s.hearts--;
    s.stats.failures++;
    if (s.hearts <= 0) {
      s.status = "lost";
      log(s, "no hearts left: stage lost");
      return;
    }
    newPhase(s);
    log(s, `army wiped: hearts ${s.hearts}, cap stays ${s.cap}`);
    draw(s, "failed attempt");
  }

  // core/battle.ts
  var GRID_SP = 1.3;
  var FRONT_X = 1.7;
  function cellPos(team, cell) {
    const row = Math.floor(cell / GRID_COLS), col = cell % GRID_COLS;
    const depth = GRID_COLS - 1 - col;
    return { x: (FRONT_X + depth * GRID_SP) * (team === 0 ? -1 : 1), z: (row - (GRID_ROWS - 1) / 2) * GRID_SP };
  }
  var FRONTNESS = { knight: 5, ogre: 4, warrior: 3, barbarian: 3, goblin: 2, archer: 0 };
  function enemyCells(specs) {
    const cells = [];
    for (let c = 0; c < GRID_COLS * GRID_ROWS; c++) cells.push(c);
    cells.sort((a, b) => {
      const da = GRID_COLS - 1 - a % GRID_COLS, db = GRID_COLS - 1 - b % GRID_COLS;
      if (da !== db) return da - db;
      return Math.abs(Math.floor(a / GRID_COLS) - 1) - Math.abs(Math.floor(b / GRID_COLS) - 1);
    });
    const order = specs.map((s, i) => i).sort((i, j) => FRONTNESS[specs[j].soul] - FRONTNESS[specs[i].soul]);
    const out = new Array(specs.length);
    order.forEach((idx, k) => {
      out[idx] = cells[k];
    });
    return out;
  }
  var Battle = class {
    /** `levels`: the player's permanent Soul levels (health and damage grow a little per level). Enemies never use them. */
    constructor(players, enemies, seed = 1, levels) {
      __publicField(this, "time", 0);
      __publicField(this, "fighters", []);
      __publicField(this, "events", []);
      __publicField(this, "winner", -1);
      __publicField(this, "rng");
      __publicField(this, "pending", []);
      __publicField(this, "nextId", 1);
      __publicField(this, "flip", false);
      var _a;
      this.rng = makeRng(seed);
      for (const p of players) this.add(0, p.soul, p.star, p.cell, (_a = levels == null ? void 0 : levels[p.soul]) != null ? _a : 1);
      const cells = enemyCells(enemies);
      enemies.forEach((e, i) => this.add(1, e.soul, e.star, cells[i]));
    }
    add(team, soul, star, cell, level = 1) {
      var _a, _b;
      const B = BALANCE, st = B.stats[soul], p = cellPos(team, cell);
      const lvHp = 1 + (Math.max(1, level) - 1) * B.level.hp, lvDmg = 1 + (Math.max(1, level) - 1) * B.level.dmg;
      const hp = st.hp * B.star.hp[star - 1] * lvHp;
      const f = {
        id: this.nextId++,
        team,
        soul,
        star,
        cell,
        x: p.x,
        z: p.z,
        yaw: team === 0 ? 0 : Math.PI,
        hp,
        maxHp: hp,
        dmg: st.dmg * B.star.dmg[star - 1] * lvDmg,
        interval: st.interval,
        range: st.range,
        speed: st.speed,
        radius: st.size * B.star.scale[star - 1],
        alive: true,
        state: "idle",
        target: -1,
        retargetAt: 0,
        forcedTarget: -1,
        forcedUntil: 0,
        nextAttack: this.rng.next() * 0.3,
        attackStart: -9,
        attackDur: 1,
        animSpeed: 1,
        hitFrac: 0,
        hitDone: true,
        mana: 0,
        maxMana: (_b = (_a = B.mana[soul]) == null ? void 0 : _a.max) != null ? _b : 0,
        casting: false,
        frenzy: 0,
        deadAt: 0
      };
      this.fighters.push(f);
      return f;
    }
    byId(id) {
      return id < 0 ? void 0 : this.fighters[id - 1];
    }
    foes(f) {
      return this.fighters.filter((o) => o.alive && o.team !== f.team);
    }
    count(team) {
      return this.fighters.reduce((n, f) => n + (f.alive && f.team === team ? 1 : 0), 0);
    }
    drain() {
      const e = this.events;
      this.events = [];
      return e;
    }
    step(dt) {
      if (this.winner >= 0) return;
      this.time += dt;
      this.flip = !this.flip;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const p = this.pending[i];
        if (this.time >= p.at) {
          this.pending.splice(i, 1);
          const to = this.byId(p.to), from = this.byId(p.from);
          if (to && to.alive && from) this.damage(to, p.dmg, from, "arrow");
        }
      }
      const order = this.fighters.filter((f) => f.alive);
      if (this.flip) order.reverse();
      for (const f of order) if (f.alive) this.update(f, dt);
      const a = this.count(0), b = this.count(1);
      if (!a || !b) this.winner = a ? 0 : 1;
      else if (this.time >= BALANCE.sim.timeLimit) {
        const hp = (t) => this.fighters.filter((f) => f.alive && f.team === t).reduce((n, f) => n + f.hp / f.maxHp, 0);
        this.winner = hp(0) > hp(1) ? 0 : 1;
      }
    }
    // ------------------------------------------------------------------ per-fighter update
    update(f, dt) {
      const B = BALANCE, st = B.stats[f.soul];
      this.separate(f, dt);
      if (f.state === "attack") {
        const t = this.time - f.attackStart;
        const tg2 = this.byId(f.target);
        if (tg2 && tg2.alive) this.face(f, tg2.x - f.x, tg2.z - f.z, dt);
        if (!f.hitDone && t >= f.attackDur * st.hitFrac) {
          f.hitDone = true;
          this.resolveHit(f);
        }
        if (t >= f.attackDur) f.state = "idle";
        return;
      }
      this.acquire(f);
      const tg = this.byId(f.target);
      if (!tg || !tg.alive) {
        f.state = "idle";
        this.frenzyDecay(f);
        return;
      }
      const dx = tg.x - f.x, dz = tg.z - f.z, dist = Math.hypot(dx, dz);
      this.face(f, dx, dz, dt);
      if (dist <= f.range) {
        if (this.time >= f.nextAttack) this.startAttack(f);
        else {
          f.state = "idle";
          this.frenzyDecay(f);
        }
      } else {
        f.state = "run";
        const k = f.speed * dt / Math.max(dist, 1e-4);
        f.x += dx * k;
        f.z += dz * k;
        this.frenzyDecay(f);
      }
    }
    frenzyDecay(f) {
      if (f.soul === "barbarian" && f.frenzy > 0 && this.time - (f.attackStart + f.attackDur) > BALANCE.frenzy.resetAfter) f.frenzy = 0;
    }
    face(f, dx, dz, dt) {
      if (dx * dx + dz * dz < 1e-6) return;
      const want = Math.atan2(dx, dz);
      let d = ((want - f.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      f.yaw += Math.max(-9 * dt, Math.min(9 * dt, d));
    }
    separate(f, dt) {
      let px = 0, pz = 0;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        const dx = f.x - o.x, dz = f.z - o.z, m = Math.hypot(dx, dz), want = (f.radius + o.radius) * 1.05 + 0.08;
        if (m >= want) continue;
        const k = (want - m) / Math.max(m, 1e-3);
        px += (m < 1e-3 ? this.rng.next() - 0.5 : dx) * k;
        pz += (m < 1e-3 ? this.rng.next() - 0.5 : dz) * k;
      }
      const s = Math.min(1, dt * 6);
      f.x += px * s;
      f.z += pz * s;
    }
    acquire(f) {
      if (f.forcedTarget >= 0) {
        const ft = this.byId(f.forcedTarget);
        if (ft && ft.alive && this.time < f.forcedUntil) {
          f.target = ft.id;
          return;
        }
        f.forcedTarget = -1;
      }
      const cur = this.byId(f.target);
      if (cur && cur.alive && this.time < f.retargetAt) return;
      f.retargetAt = this.time + BALANCE.sim.retargetEvery * (0.8 + 0.4 * this.rng.next());
      const foes = this.foes(f);
      if (!foes.length) {
        f.target = -1;
        return;
      }
      let best = foes[0], bs = Infinity;
      for (const o of foes) {
        let score = Math.hypot(o.x - f.x, o.z - f.z);
        if (f.soul === "goblin") {
          const engaged = this.byId(o.target);
          const busy = !!engaged && engaged.alive && engaged.team === f.team && engaged.id !== f.id;
          if (busy && score < BALANCE.opportunist.seekRadius + 2) score -= 3;
          score -= BALANCE.opportunist.woundedWeight * (1 - o.hp / o.maxHp);
        }
        if (score < bs) {
          bs = score;
          best = o;
        }
      }
      f.target = best.id;
    }
    startAttack(f) {
      const B = BALANCE, st = B.stats[f.soul];
      let eff = f.interval;
      if (f.soul === "barbarian") {
        f.frenzy = Math.min(B.frenzy.maxStacks, f.frenzy + 1);
        eff = f.interval / (1 + f.frenzy * B.frenzy.perSwing);
        this.events.push({ t: "frenzy", id: f.id, stacks: f.frenzy });
      }
      f.attackDur = Math.min(st.animLen, eff * 0.95);
      f.animSpeed = st.animLen / f.attackDur;
      f.attackStart = this.time;
      f.nextAttack = this.time + Math.max(eff, f.attackDur);
      f.hitDone = false;
      f.state = "attack";
      f.casting = f.maxMana > 0 && f.mana >= f.maxMana;
      if (f.casting) {
        f.mana = 0;
        this.events.push({ t: "cast", id: f.id, skill: f.soul === "archer" ? "split" : f.soul === "knight" ? "taunt" : "smash" });
      }
      this.events.push({ t: "swing", id: f.id, speed: f.animSpeed, dur: f.attackDur });
    }
    resolveHit(f) {
      const B = BALANCE;
      const tg = this.byId(f.target);
      if (!tg || !tg.alive) return;
      const M = B.mana[f.soul];
      if (M && !f.casting) f.mana = Math.min(M.max, f.mana + M.perAttack);
      if (f.soul === "archer") {
        const reach = f.range * 1.25;
        const foes = this.foes(f).map((o) => ({ o, d: Math.hypot(o.x - f.x, o.z - f.z) })).filter((e) => e.d <= reach).sort((a, b) => a.d - b.d);
        const picked = f.casting ? [tg, ...foes.map((e) => e.o).filter((o) => o.id !== tg.id)].slice(0, B.volley.targets) : [tg];
        for (const o of picked) {
          const dur = Math.max(0.15, Math.hypot(o.x - f.x, o.z - f.z) / B.volley.projectileSpeed);
          this.pending.push({ at: this.time + dur, from: f.id, to: o.id, dmg: f.dmg });
          this.events.push({ t: "arrow", from: f.id, to: o.id, dur });
        }
        f.casting = false;
        return;
      }
      if (Math.hypot(tg.x - f.x, tg.z - f.z) > f.range * 1.5) {
        f.casting = false;
        return;
      }
      let dmg = f.dmg;
      if (f.soul === "goblin") {
        const eng = this.byId(tg.target);
        if (eng && eng.alive && eng.team === f.team && eng.id !== f.id) dmg *= 1 + B.opportunist.bonus;
      }
      if (f.casting) {
        f.casting = false;
        if (f.soul === "ogre") {
          dmg *= B.smash.mult;
          this.events.push({ t: "smash", id: f.id, x: tg.x, z: tg.z, r: B.smash.radius });
          for (const o of this.foes(f)) if (o.id !== tg.id && Math.hypot(o.x - tg.x, o.z - tg.z) <= B.smash.radius) this.damage(o, dmg * 0.6, f, "smash");
          this.damage(tg, dmg, f, "smash");
          return;
        }
        if (f.soul === "knight") {
          for (const o of this.foes(f)) if (Math.hypot(o.x - f.x, o.z - f.z) <= B.taunt.radius) {
            o.forcedTarget = f.id;
            o.forcedUntil = this.time + B.taunt.duration;
            o.retargetAt = 0;
          }
          this.events.push({ t: "taunt", id: f.id });
        }
      }
      this.damage(tg, dmg, f, "melee");
    }
    damage(t, amount, from, kind) {
      if (!t.alive) return;
      const B = BALANCE;
      let red = 0;
      if (t.soul === "warrior") {
        const n = this.fighters.filter((o) => o.alive && o !== t && o.team === t.team && o.soul === "warrior" && Math.hypot(o.x - t.x, o.z - t.z) <= B.phalanx.radius).length;
        red = Math.min(B.phalanx.maxStacks, n) * B.phalanx.perAlly;
      }
      const dmg = amount * (1 - red);
      t.hp -= dmg;
      const M = B.mana[t.soul];
      if (M && t.hp > 0) t.mana = Math.min(M.max, t.mana + M.perHit);
      this.events.push({ t: "hit", from: from.id, to: t.id, dmg, kind });
      if (t.hp <= 0) {
        t.hp = 0;
        t.alive = false;
        t.state = "dead";
        t.deadAt = this.time;
        this.events.push({ t: "death", id: t.id });
      }
    }
  };
  function simulate(players, enemies, seed = 1, maxSeconds = 130) {
    const b = new Battle(players, enemies, seed);
    while (b.winner < 0 && b.time < maxSeconds) b.step(1 / 30);
    const w = b.winner < 0 ? 1 : b.winner;
    const mine = b.fighters.filter((f) => f.alive && f.team === w);
    return { winner: w, time: b.time, left: mine.length, hpLeft: mine.reduce((n, f) => n + f.hp / f.maxHp, 0) };
  }

  // core/waves.ts
  var LETTER = { W: "warrior", A: "archer", G: "goblin", K: "knight", O: "ogre", B: "barbarian" };
  var parseWave = (s) => s.split(" ").map((t) => ({ soul: LETTER[t[0]], star: +t[1] }));
  var DIFFICULTY = {
    easy: ["W1", "K1 W1", "O1 W1 G1", "K1 A1 W1", "O1 A1 G1", "K1 O1 A1", "K1 O1 A1 G1", "O1 K1 A1 G1", "O1 K1 A1 B1", "O2 K1 A1 G1"],
    normal: ["W1 A1", "K1 G1 W1", "O1 A1 G1 W1", "K1 O1 A1 W1", "O1 K1 A1 G1 W1", "A2 K1 O1 G1 W1", "K1 O1 A1 G1 W1", "O1 K1 A1 B1 G1", "O1 K1 A2 B1 G1", "O2 K1 A1 B1 G1 W1"],
    hard: ["W1 A1", "K1 G1 W1 A1", "O1 A1 G1 W1", "K1 O1 A1 W1 G1", "O1 K1 A2 G1 W1", "A2 K1 O1 G1 W1 B1", "K1 O1 A1 G1 W2", "O1 K1 A2 B1 G1", "O2 K1 A2 B1 G1", "O2 K2 A1 B1 G1 W1"],
    nightmare: ["W1 A1 G1", "K1 G1 W1 A1", "O1 A1 G1 W1 B1", "K1 O1 A1 W1 G1", "O1 K1 A2 G1 W1", "A2 K1 O1 G1 W1 B1", "K1 O1 A2 G1 W1 B1", "O1 K2 A2 B1 G1", "O2 K1 A2 B1 G1 W1", "O2 K2 A2 B1 G1 W1"]
  };
  var difficultyName = "normal";
  var AUTHORED = DIFFICULTY.normal.map(parseWave);
  function setDifficulty(name) {
    if (!DIFFICULTY[name]) return;
    difficultyName = name;
    AUTHORED.length = 0;
    DIFFICULTY[name].forEach((w) => AUTHORED.push(parseWave(w)));
  }
  function enemyWave(wave, stageSeed = 0) {
    if (wave <= AUTHORED.length) return AUTHORED[wave - 1].map((e) => ({ ...e }));
    const cap = CURVES.doc[Math.min(wave, CURVES.doc.length) - 1];
    const budget = Math.round(cap * 0.92);
    const rng = makeRng(stageSeed * 1009 + wave * 7919);
    const army = [];
    let left = budget;
    for (let guard = 0; guard < 40 && left >= 2; guard++) {
      const soul = rng.pick(SOULS);
      let star = 1;
      if (rng.next() < 0.35 && COST[soul][1] <= left) star = 2;
      if (wave >= 6 && rng.next() < 0.25 && COST[soul][2] <= left) star = 3;
      const c = COST[soul][star - 1];
      if (c <= left && army.length < 12) {
        army.push({ soul, star });
        left -= c;
      }
    }
    return army;
  }
  function previewText(w) {
    const map = /* @__PURE__ */ new Map();
    for (const e of w) {
      const k = e.soul + e.star;
      const cur = map.get(k);
      if (cur) cur.count++;
      else map.set(k, { soul: e.soul, star: e.star, count: 1 });
    }
    return [...map.values()];
  }

  // core/prototype.ts
  var PROTOTYPE_RULES = { curve: CURVES.doc, merge: "handIntoOneStar", stageWaves: 10, normalDrawWaves: [2, 3, 4, 5] };

  // core/packs.ts
  var PACK_TIERS = 3;

  // core/save.ts
  var DECK_SIZE = 6;
  var KEY = "necro-save";
  var VERSION = 1;
  var DIFFICULTIES = ["easy", "normal", "hard", "nightmare"];
  function defaultSave() {
    const souls = {};
    for (const id of SOULS) souls[id] = { level: 1, copies: 0 };
    return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls, settings: { music: true, sfx: true }, difficulty: "normal", packs: [], nextPackId: 1, clears: {}, replayMeter: 0 };
  }
  function browserStore() {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }
  function sanitize(raw) {
    const base = defaultSave();
    if (!raw || typeof raw !== "object") return base;
    const deck = [];
    if (Array.isArray(raw.deck)) {
      for (const d of raw.deck) if (SOULS.includes(d) && !deck.includes(d) && deck.length < DECK_SIZE) deck.push(d);
    }
    if (deck.length) base.deck = deck;
    if (raw.souls && typeof raw.souls === "object") {
      for (const id of SOULS) {
        const p = raw.souls[id];
        if (p && Number.isFinite(p.level) && Number.isFinite(p.copies)) base.souls[id] = { level: Math.max(1, Math.floor(p.level)), copies: Math.max(0, Math.floor(p.copies)) };
      }
    }
    if (raw.settings && typeof raw.settings === "object") {
      if (typeof raw.settings.music === "boolean") base.settings.music = raw.settings.music;
      if (typeof raw.settings.sfx === "boolean") base.settings.sfx = raw.settings.sfx;
    }
    if (DIFFICULTIES.includes(raw.difficulty)) base.difficulty = raw.difficulty;
    if (Array.isArray(raw.packs)) {
      const ids = /* @__PURE__ */ new Set();
      for (const p of raw.packs) {
        if (base.packs.length >= 99 || !p || !Number.isInteger(p.id) || p.id < 1 || ids.has(p.id) || !Number.isInteger(p.tier) || p.tier < 1 || p.tier > PACK_TIERS) continue;
        ids.add(p.id);
        base.packs.push({ id: p.id, tier: p.tier, source: typeof p.source === "string" ? p.source.slice(0, 40) : "" });
      }
    }
    const maxId = base.packs.reduce((n, p) => Math.max(n, p.id), 0);
    base.nextPackId = Math.max(maxId + 1, Number.isInteger(raw.nextPackId) && raw.nextPackId > 0 ? raw.nextPackId : 1);
    if (raw.clears && typeof raw.clears === "object") {
      for (const [k, v] of Object.entries(raw.clears)) if (typeof k === "string" && k.length < 40 && Number.isInteger(v) && v > 0) base.clears[k] = v;
    }
    if (Number.isInteger(raw.replayMeter) && raw.replayMeter >= 0 && raw.replayMeter < 50) base.replayMeter = raw.replayMeter;
    return base;
  }
  function loadSave(store = browserStore()) {
    try {
      const t = store && store.getItem(KEY);
      return sanitize(t ? JSON.parse(t) : null);
    } catch {
      return defaultSave();
    }
  }
  function writeSave(save, store = browserStore()) {
    try {
      if (store) store.setItem(KEY, JSON.stringify(save));
    } catch {
    }
  }
  function updateSettings(patch, store = browserStore()) {
    const s = loadSave(store);
    s.settings = { ...s.settings, ...patch };
    writeSave(s, store);
    return s.settings;
  }

  // game/necromancer.ts
  var Necromancer = class {
    constructor(scene, soft) {
      __publicField(this, "scene", scene);
      __publicField(this, "soft", soft);
      __publicField(this, "holder");
      // TransformNode: the game sets position; local +Z is his facing (the game rotates him to face the battlefield)
      __publicField(this, "rig");
      __publicField(this, "staffPivot");
      __publicField(this, "crystal");
      __publicField(this, "crystalMat");
      __publicField(this, "robeMat");
      __publicField(this, "eyeMat");
      __publicField(this, "ps");
      __publicField(this, "glow");
      __publicField(this, "t", 0);
      __publicField(this, "hurtT", 0);
      __publicField(this, "castT", 0);
      __publicField(this, "down", 0);
      __publicField(this, "downTarget", 0);
      const s = scene, mat = (r, g2, b, er = 0, eg = 0, eb = 0) => {
        const m = new BABYLON.StandardMaterial("nm", s);
        m.diffuseColor = new BABYLON.Color3(r, g2, b);
        m.emissiveColor = new BABYLON.Color3(er, eg, eb);
        m.specularColor = BABYLON.Color3.Black();
        return m;
      };
      const glowMat = (r, g2, b, a = 1) => {
        const m = new BABYLON.StandardMaterial("ng", s);
        m.diffuseColor = BABYLON.Color3.Black();
        m.emissiveColor = new BABYLON.Color3(r, g2, b);
        m.disableLighting = true;
        m.alpha = a;
        return m;
      };
      this.holder = new BABYLON.TransformNode("necro", s);
      this.rig = new BABYLON.TransformNode("necroRig", s);
      this.rig.parent = this.holder;
      const add = (mesh, parent = this.rig) => {
        mesh.parent = parent;
        mesh.isPickable = false;
        return mesh;
      };
      this.robeMat = mat(0.09, 0.03, 0.16, 0.05, 0.02, 0.1);
      const robe = add(BABYLON.MeshBuilder.CreateCylinder("robe", { height: 0.82, diameterTop: 0.3, diameterBottom: 0.8, tessellation: 20 }, s));
      robe.position.y = 0.41;
      robe.material = this.robeMat;
      const hem = add(BABYLON.MeshBuilder.CreateTorus("hem", { diameter: 0.78, thickness: 0.035, tessellation: 28 }, s));
      hem.position.y = 0.03;
      hem.material = glowMat(0.9, 0.7, 0.25);
      const mantle = add(BABYLON.MeshBuilder.CreateSphere("mantle", { diameter: 0.6, segments: 12 }, s));
      mantle.scaling.set(1, 0.5, 0.8);
      mantle.position.y = 0.8;
      mantle.material = this.robeMat;
      const hood = add(BABYLON.MeshBuilder.CreateSphere("hood", { diameter: 0.56, segments: 14 }, s));
      hood.position.y = 1;
      hood.material = this.robeMat;
      const tip = add(BABYLON.MeshBuilder.CreateCylinder("tip", { height: 0.4, diameterTop: 0, diameterBottom: 0.34, tessellation: 14 }, s));
      tip.position.set(0, 1.28, -0.06);
      tip.rotation.x = -0.35;
      tip.material = this.robeMat;
      const face = add(BABYLON.MeshBuilder.CreateSphere("face", { diameter: 0.38, segments: 12 }, s));
      face.position.set(0, 0.99, 0.12);
      face.material = mat(0.02, 0, 0.05);
      this.eyeMat = glowMat(0.9, 0.4, 1);
      for (const x of [-0.075, 0.075]) {
        const e = add(BABYLON.MeshBuilder.CreateSphere("eye", { diameter: 0.075, segments: 8 }, s));
        e.position.set(x, 1, 0.285);
        e.scaling.z = 0.6;
        e.material = this.eyeMat;
      }
      this.glow = add(BABYLON.MeshBuilder.CreatePlane("eyeGlow", { size: 0.5 }, s));
      this.glow.position.set(0, 1, 0.33);
      this.glow.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      const gm = glowMat(0.7, 0.25, 1, 0.55);
      gm.emissiveTexture = soft;
      gm.opacityTexture = soft;
      this.glow.material = gm;
      const hand = add(BABYLON.MeshBuilder.CreateSphere("hand", { diameter: 0.12, segments: 8 }, s));
      hand.position.set(-0.32, 0.62, 0.12);
      hand.material = mat(0.8, 0.75, 0.65);
      this.staffPivot = add(new BABYLON.TransformNode("staffPivot", s));
      this.staffPivot.position.set(0.34, 0.6, 0.14);
      const rod = add(BABYLON.MeshBuilder.CreateCylinder("rod", { height: 1.5, diameter: 0.045, tessellation: 8 }, s), this.staffPivot);
      rod.position.y = 0.45;
      rod.material = mat(0.28, 0.17, 0.1);
      this.crystalMat = glowMat(0.75, 0.35, 1);
      this.crystal = add(BABYLON.MeshBuilder.CreatePolyhedron("crystal", { type: 1, size: 0.12 }, s), this.staffPivot);
      this.crystal.position.y = 1.28;
      this.crystal.scaling.y = 1.5;
      this.crystal.rotation.x = 0.4;
      this.crystal.material = this.crystalMat;
      const ring = add(BABYLON.MeshBuilder.CreateDisc("base", { radius: 0.62, tessellation: 30 }, s), this.holder);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.02;
      ring.material = glowMat(0.4, 0.15, 0.75, 0.55);
      const ps = this.ps = new BABYLON.ParticleSystem("necroAura", 80, s);
      ps.particleTexture = soft;
      ps.emitter = this.holder;
      ps.minEmitBox = new BABYLON.Vector3(-0.3, 0, -0.3);
      ps.maxEmitBox = new BABYLON.Vector3(0.3, 0.9, 0.3);
      ps.minLifeTime = 0.6;
      ps.maxLifeTime = 1.3;
      ps.direction1 = new BABYLON.Vector3(-0.15, 0.9, -0.15);
      ps.direction2 = new BABYLON.Vector3(0.15, 1.6, 0.15);
      ps.minEmitPower = 0.3;
      ps.maxEmitPower = 0.8;
      ps.gravity = new BABYLON.Vector3(0, 0.4, 0);
      ps.minSize = 0.07;
      ps.maxSize = 0.2;
      ps.emitRate = 30;
      ps.color1 = new BABYLON.Color4(0.8, 0.35, 1, 0.7);
      ps.color2 = new BABYLON.Color4(0.45, 0.15, 0.9, 0.5);
      ps.colorDead = new BABYLON.Color4(0.2, 0, 0.4, 0);
      ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
      ps.start();
    }
    setEnabled(on) {
      this.holder.setEnabled(on);
      if (on) this.ps.start();
      else this.ps.stop();
    }
    /** World position of the staff crystal (for spell effects). */
    crystalPos() {
      this.holder.computeWorldMatrix(true);
      this.rig.computeWorldMatrix(true);
      this.staffPivot.computeWorldMatrix(true);
      this.crystal.computeWorldMatrix(true);
      return this.crystal.getAbsolutePosition().clone();
    }
    hurt() {
      this.hurtT = 0.8;
    }
    cast() {
      this.castT = 1.1;
    }
    /** The last heart is gone: he sinks to his knees, the eyes dim. */
    defeat() {
      this.downTarget = 1;
    }
    revive() {
      this.downTarget = 0;
      this.hurtT = 0;
      this.castT = 0;
    }
    update(dt) {
      this.t += dt;
      this.down += (this.downTarget - this.down) * Math.min(1, dt * 3);
      const bob = Math.sin(this.t * 2) * 0.035 * (1 - this.down);
      let recoil = 0, flash = 0;
      if (this.hurtT > 0) {
        this.hurtT = Math.max(0, this.hurtT - dt);
        const u = this.hurtT / 0.8;
        recoil = Math.sin(u * Math.PI) * 0.42;
        flash = u;
      }
      let raise = 0;
      if (this.castT > 0) {
        this.castT = Math.max(0, this.castT - dt);
        const u = this.castT / 1.1;
        raise = Math.sin(Math.min(1, (1 - u) * 1.6) * Math.PI * 0.5) * (u > 0.25 ? 1 : u / 0.25);
      }
      this.rig.position.y = bob - 0.28 * this.down;
      this.rig.rotation.x = -recoil + 0.9 * this.down;
      this.rig.rotation.z = Math.sin(this.t * 1.3) * 0.03 + Math.sin(this.hurtT * 60) * 0.03 * (this.hurtT > 0 ? 1 : 0);
      this.staffPivot.rotation.z = -0.15 * raise - 0.05;
      this.staffPivot.rotation.x = -0.45 * raise;
      this.staffPivot.position.y = 0.6 + 0.35 * raise;
      this.crystal.rotation.y += dt * (2 + 6 * raise);
      const pulse = 1 + 0.12 * Math.sin(this.t * 4) + 1.1 * raise;
      this.crystal.scaling.set(pulse, 1.5 * pulse, pulse);
      const dim = 1 - 0.85 * this.down;
      this.crystalMat.emissiveColor.set((0.75 + 0.25 * raise) * dim, (0.35 + 0.4 * raise) * dim, 1 * dim);
      this.eyeMat.emissiveColor.set(0.9 * dim + flash * 0.1, (0.4 + 0.25 * raise) * dim * (1 - flash * 0.6), 1 * dim * (1 - flash * 0.7));
      this.robeMat.emissiveColor.set(0.05 + flash * 0.6, 0.02, 0.1 * (1 - flash));
      this.glow.scaling.setAll(0.6 + 0.9 * dim + raise * 0.8);
      this.ps.emitRate = (30 + 90 * raise) * dim;
    }
    dispose() {
      this.ps.stop();
      this.ps.dispose();
      this.holder.getChildMeshes().forEach((m) => m.dispose());
      this.holder.dispose();
    }
  };

  // game/audio.ts
  var CHORDS = [
    [110, 164.81, 220, 261.63, 329.63],
    [87.31, 130.81, 174.61, 220, 261.63],
    [130.81, 196, 261.63, 329.63, 392],
    [82.41, 123.47, 164.81, 207.65, 246.94]
  ];
  var BEAT = 60 / 80;
  var AudioEngine = class {
    constructor() {
      __publicField(this, "ctx", null);
      __publicField(this, "master");
      __publicField(this, "musicBus");
      __publicField(this, "sfxBus");
      __publicField(this, "noiseBuf");
      __publicField(this, "music", true);
      __publicField(this, "sfx", true);
      __publicField(this, "mode", "build");
      __publicField(this, "timer", 0);
      __publicField(this, "nextT", 0);
      __publicField(this, "beat", 0);
      __publicField(this, "stamps", {});
      __publicField(this, "silent", null);
      __publicField(this, "primed", false);
      const s = loadSave().settings;
      this.music = s.music;
      this.sfx = s.sfx;
    }
    /** iPhones mute Web Audio when the ringer switch is on, unless the page is playing "real" media. A silent looping <audio> element (plus the
     *  audioSession hint on newer iOS) moves the page to the playback channel, so the game is heard even with the switch on silent. */
    playbackChannel() {
      try {
        const a = navigator.audioSession;
        if (a) a.type = "playback";
      } catch {
      }
      if (this.silent) return;
      try {
        const n = 441, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), str = (o, t) => {
          for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
        };
        str(0, "RIFF");
        v.setUint32(4, 36 + n * 2, true);
        str(8, "WAVE");
        str(12, "fmt ");
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, 44100, true);
        v.setUint32(28, 88200, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        str(36, "data");
        v.setUint32(40, n * 2, true);
        const el = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/wav" })));
        el.loop = true;
        el.volume = 0.01;
        el.setAttribute("playsinline", "");
        this.silent = el;
        el.play().catch(() => {
          this.silent = null;
        });
      } catch {
      }
    }
    /** What the Settings page shows so a silent phone can be diagnosed. */
    status() {
      return { state: this.ctx ? this.ctx.state : "not started", unlocked: !!this.ctx && this.ctx.state === "running" };
    }
    /** The Settings page's Test sound button: unlock and make a clearly audible sound. */
    test() {
      this.unlock();
      const t = () => {
        this.play("victory");
      };
      if (this.ctx && this.ctx.state !== "running") this.ctx.resume().then(t).catch(() => {
      });
      else t();
    }
    /** Call from a user gesture (tap/click). Safe to call repeatedly. */
    unlock() {
      this.playbackChannel();
      if (!this.ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        const ctx = this.ctx = new C();
        const comp = ctx.createDynamicsCompressor();
        comp.connect(ctx.destination);
        this.master = ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(comp);
        this.musicBus = ctx.createGain();
        this.musicBus.connect(this.master);
        this.sfxBus = ctx.createGain();
        this.sfxBus.connect(this.master);
        ctx.onstatechange = () => {
          window.dispatchEvent(new Event("necro-audio-state"));
        };
        const len = ctx.sampleRate;
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state !== "running") this.ctx.resume().catch(() => {
      });
      if (!this.primed) {
        this.primed = true;
        try {
          const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
          s.buffer = b;
          s.connect(this.ctx.destination);
          s.start(0);
        } catch {
        }
      }
      this.applyGains();
      this.syncMusic();
    }
    setMusic(on) {
      this.music = on;
      updateSettings({ music: on });
      this.applyGains();
      this.syncMusic();
      window.dispatchEvent(new Event("necro-settings"));
    }
    setSfx(on) {
      this.sfx = on;
      updateSettings({ sfx: on });
      this.applyGains();
      window.dispatchEvent(new Event("necro-settings"));
      if (on) this.play("tap");
    }
    /** Re-read the saved switches (the shell's Settings page changes them too). */
    reload() {
      const s = loadSave().settings;
      this.music = s.music;
      this.sfx = s.sfx;
      this.applyGains();
      this.syncMusic();
    }
    setMode(m) {
      this.mode = m;
    }
    applyGains() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.musicBus.gain.setTargetAtTime(this.music ? 0.5 : 0, t, 0.15);
      this.sfxBus.gain.setTargetAtTime(this.sfx ? 0.8 : 0, t, 0.05);
    }
    // ------------------------------------------------------------------------------------------ music
    syncMusic() {
      if (!this.ctx) return;
      if (this.music && !this.timer) {
        this.nextT = this.ctx.currentTime + 0.15;
        this.timer = window.setInterval(() => this.tick(), 200);
      }
      if (!this.music && this.timer) {
        clearInterval(this.timer);
        this.timer = 0;
      }
    }
    tick() {
      const ctx = this.ctx;
      if (ctx.state !== "running") {
        this.nextT = ctx.currentTime + 0.15;
        return;
      }
      while (this.nextT < ctx.currentTime + 0.6) {
        this.playBeat(this.beat, this.nextT);
        this.nextT += BEAT;
        this.beat = (this.beat + 1) % 16;
      }
    }
    playBeat(beat, t) {
      const chord = CHORDS[Math.floor(beat / 4)], inBar = beat % 4, battle = this.mode === "battle";
      if (inBar === 0) for (const f of chord) this.voice(f, "triangle", t, BEAT * 4 + 0.8, 0.045, 0.9, 900);
      if (inBar === 0 || inBar === 2) this.voice(chord[0], "sine", t, BEAT * 1.6, 0.16, 0.02, 400);
      if (battle) {
        this.kick(t, 0.32);
        if (inBar === 2) this.kick(t + BEAT * 0.5, 0.18);
        this.noise(t + BEAT * 0.5, 0.05, 0.05, "highpass", 7e3);
        this.noise(t + BEAT * 1.5 % BEAT, 0.05, 0.03, "highpass", 7e3);
        for (let i = 0; i < 2; i++) this.voice(chord[1 + (beat * 2 + i) % 4] * 2, "triangle", t + i * BEAT / 2, 0.22, 0.05, 5e-3, 2500);
      }
    }
    voice(freq, type, t, dur, gain, attack, lp) {
      const ctx = this.ctx, o = ctx.createOscillator(), g2 = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = type;
      o.frequency.value = freq;
      f.type = "lowpass";
      f.frequency.value = lp;
      g2.gain.setValueAtTime(1e-4, t);
      g2.gain.linearRampToValueAtTime(gain, t + Math.max(5e-3, attack));
      g2.gain.exponentialRampToValueAtTime(1e-4, t + dur);
      o.connect(f);
      f.connect(g2);
      g2.connect(this.musicBus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    kick(t, gain) {
      const ctx = this.ctx, o = ctx.createOscillator(), g2 = ctx.createGain();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g2.gain.setValueAtTime(gain, t);
      g2.gain.exponentialRampToValueAtTime(1e-4, t + 0.2);
      o.connect(g2);
      g2.connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.25);
    }
    noise(t, dur, gain, type, freq, bus = this.musicBus, sweepTo) {
      const ctx = this.ctx, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g2 = ctx.createGain();
      n.buffer = this.noiseBuf;
      f.type = type;
      f.frequency.setValueAtTime(freq, t);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      g2.gain.setValueAtTime(gain, t);
      g2.gain.exponentialRampToValueAtTime(1e-4, t + dur);
      n.connect(f);
      f.connect(g2);
      g2.connect(bus);
      n.start(t, Math.random() * 0.5);
      n.stop(t + dur + 0.02);
    }
    // ------------------------------------------------------------------------------------------ sound effects
    tone(freq, dur, type, gain, delay = 0, slideTo, attack = 5e-3, lp = 8e3) {
      const ctx = this.ctx, t = ctx.currentTime + delay, o = ctx.createOscillator(), g2 = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      f.type = "lowpass";
      f.frequency.value = lp;
      g2.gain.setValueAtTime(1e-4, t);
      g2.gain.linearRampToValueAtTime(gain, t + attack);
      g2.gain.exponentialRampToValueAtTime(1e-4, t + dur);
      o.connect(f);
      f.connect(g2);
      g2.connect(this.sfxBus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    hiss(dur, gain, type, freq, delay = 0, sweepTo) {
      this.noise(this.ctx.currentTime + delay, dur, gain, type, freq, this.sfxBus, sweepTo);
    }
    throttle(key, ms) {
      const n = performance.now();
      if (n - (this.stamps[key] || 0) < ms) return false;
      this.stamps[key] = n;
      return true;
    }
    play(name) {
      if (!this.ctx || !this.sfx || this.ctx.state !== "running") return;
      switch (name) {
        case "tap":
          if (!this.throttle("tap", 40)) return;
          this.tone(760, 0.06, "sine", 0.22, 0, 1100);
          break;
        case "summon":
          this.hiss(0.4, 0.14, "bandpass", 500, 0, 2500);
          this.tone(220, 0.4, "sawtooth", 0.1, 0, 660, 0.05, 1800);
          this.tone(1320, 0.2, "sine", 0.1, 0.18);
          break;
        case "merge":
          [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, "triangle", 0.2, i * 0.07));
          this.hiss(0.5, 0.08, "highpass", 5e3, 0.1);
          this.tone(110, 0.3, "sine", 0.35, 0, 50);
          this.tone(1568, 0.5, "sine", 0.08, 0.3);
          break;
        case "hit":
          if (!this.throttle("hit", 45)) return;
          this.hiss(0.07, 0.24, "lowpass", 1800);
          this.tone(170, 0.09, "sine", 0.22, 0, 80);
          break;
        case "hitArrow":
          if (!this.throttle("hitA", 45)) return;
          this.hiss(0.05, 0.14, "bandpass", 3e3);
          this.tone(700, 0.06, "triangle", 0.06, 0, 400);
          break;
        case "smash":
          this.tone(95, 0.38, "sine", 0.5, 0, 34);
          this.hiss(0.32, 0.35, "lowpass", 1e3, 0, 200);
          break;
        case "arrow":
          if (!this.throttle("arrow", 60)) return;
          this.hiss(0.14, 0.1, "bandpass", 1800, 0, 4200);
          break;
        case "death":
          if (!this.throttle("death", 70)) return;
          this.tone(300, 0.4, "sawtooth", 0.14, 0, 70, 0.01, 900);
          break;
        case "cast":
          this.tone(300, 0.45, "sine", 0.18, 0, 900, 0.05);
          this.tone(450, 0.45, "sine", 0.1, 0.05, 1350, 0.05);
          this.tone(1800, 0.25, "sine", 0.05, 0.3);
          break;
        case "taunt":
          this.tone(196, 0.5, "square", 0.08, 0, 180, 0.03, 700);
          this.tone(147, 0.5, "sawtooth", 0.08, 0.02, 140, 0.03, 600);
          break;
        case "shockwave":
          this.tone(220, 1.1, "sine", 0.5, 0, 28, 0.02);
          this.hiss(1, 0.35, "lowpass", 3e3, 0, 150);
          this.tone(880, 0.8, "sine", 0.08, 0, 220);
          break;
        case "resurrect":
          [220, 277, 330, 440, 554].forEach((f, i) => this.tone(f, 1.1, "triangle", 0.1, i * 0.12, f * 1.12, 0.3));
          this.hiss(0.9, 0.06, "highpass", 4500, 0.2);
          break;
        case "heartLost":
          this.tone(110, 0.7, "sawtooth", 0.28, 0, 50, 0.01, 450);
          this.hiss(0.18, 0.2, "lowpass", 900);
          this.tone(233, 0.5, "square", 0.05, 0.02, 220, 0.01, 500);
          break;
        case "victory":
          [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.5, "triangle", 0.16, i * 0.11));
          this.tone(196, 0.9, "sine", 0.2);
          break;
        case "defeat":
          [330, 294, 247, 196].forEach((f, i) => this.tone(f, 0.7, "triangle", 0.16, i * 0.28, f * 0.97));
          this.tone(82, 1.6, "sine", 0.3, 0.3);
          break;
        case "packCharge":
          this.tone(90, 1.05, "sine", 0.25, 0, 260, 0.2);
          this.hiss(0.95, 0.12, "lowpass", 300, 0, 2200);
          this.tone(180, 1, "triangle", 0.06, 0.1, 520, 0.3);
          break;
        case "packTierUp":
          [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.4, "triangle", 0.2, i * 0.06));
          this.tone(1760, 0.6, "sine", 0.09, 0.2);
          this.hiss(0.4, 0.1, "highpass", 5e3, 0.1);
          break;
        case "packTear":
          this.hiss(0.35, 0.3, "bandpass", 1500, 0, 6e3);
          this.tone(120, 0.45, "sine", 0.4, 0.05, 40);
          [1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.6, "triangle", 0.1, 0.12 + i * 0.05));
          break;
        case "packFan":
          this.hiss(0.5, 0.1, "highpass", 3e3);
          this.tone(660, 0.45, "sine", 0.1, 0, 1320);
          break;
        case "packFlip":
          this.hiss(0.08, 0.15, "bandpass", 2500);
          this.tone(500, 0.12, "sine", 0.14, 0, 800);
          break;
        case "packRare":
          this.play("packFlip");
          [784, 988].forEach((f, i) => this.tone(f, 0.45, "triangle", 0.14, 0.05 + i * 0.09));
          break;
        case "packEpic":
          this.play("packFlip");
          [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.7, "triangle", 0.16, i * 0.07));
          this.tone(110, 0.5, "sine", 0.3, 0, 60);
          break;
        case "packLegend":
          this.play("packFlip");
          [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 1.1, "triangle", 0.16, i * 0.08));
          this.tone(82, 0.9, "sine", 0.35, 0, 50);
          this.hiss(0.8, 0.1, "highpass", 5e3, 0.1);
          this.tone(2093, 0.7, "sine", 0.07, 0.4);
          break;
        case "packCollect":
          [659, 988].forEach((f, i) => this.tone(f, 0.35, "triangle", 0.16, i * 0.09));
          break;
        case "start":
          this.tone(147, 0.9, "sawtooth", 0.13, 0, 150, 0.15, 650);
          this.tone(220, 0.9, "sawtooth", 0.09, 0.05, 224, 0.15, 650);
          this.hiss(0.6, 0.06, "lowpass", 600);
          break;
      }
    }
  };
  var audio = new AudioEngine();
  window.__audio = audio;
  var unlockOnce = () => audio.unlock();
  for (const ev of ["pointerdown", "pointerup", "touchend", "click", "keydown"]) document.addEventListener(ev, unlockOnce, { capture: true });
  document.addEventListener("click", (e) => {
    const el = e.target;
    if (el && el.closest && el.closest("button, a.btn, .rail a")) audio.play("tap");
  }, true);
  document.addEventListener("visibilitychange", () => {
    const c = audio.ctx;
    if (!c) return;
    if (document.hidden) c.suspend();
    else if (audio.music || audio.sfx) c.resume();
  });
  window.addEventListener("necro-settings-changed", () => audio.reload());

  // core/runsave.ts
  var KEY2 = "necro-run";
  var VERSION2 = 1;
  function serializeState(s) {
    return {
      rules: JSON.parse(JSON.stringify(s.rules)),
      rng: { seed: s.rng.seed, pos: s.rng.state() },
      wave: s.wave,
      hearts: s.hearts,
      cap: s.cap,
      hand: s.hand.slice(),
      units: s.units.map((u) => ({ ...u })),
      nextId: s.nextId,
      discardUsed: s.discardUsed,
      status: "building",
      log: s.log.slice(-40),
      stats: { ...s.stats }
    };
  }
  var isSoul = (x) => SOULS.includes(x);
  var int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  function deserializeState(x) {
    var _a;
    try {
      if (!x || typeof x !== "object") return null;
      const r = x.rules;
      if (!r || !Array.isArray(r.curve) || !r.curve.length || !r.curve.every((n) => Number.isFinite(n) && n > 0)) return null;
      if (r.merge !== "deployedOnly" && r.merge !== "handIntoOneStar") return null;
      if (r.pool !== void 0 && !(Array.isArray(r.pool) && r.pool.length && r.pool.every(isSoul))) return null;
      const stageWaves2 = (_a = r.stageWaves) != null ? _a : r.curve.length;
      if (!int(x.wave, 1, Math.min(stageWaves2, r.curve.length)) || !int(x.hearts, 1, HEARTS) || !Number.isFinite(x.cap) || x.cap <= 0) return null;
      if (!Array.isArray(x.hand) || x.hand.length > 40 || !x.hand.every(isSoul)) return null;
      if (!Array.isArray(x.units) || x.units.length > GRID_CELLS) return null;
      if (!int(x.nextId, 1, 1e6) || typeof x.discardUsed !== "boolean") return null;
      const cells = /* @__PURE__ */ new Set(), ids = /* @__PURE__ */ new Set(), units = [];
      for (const u of x.units) {
        if (!u || !isSoul(u.soul) || !int(u.star, 1, MAX_STAR) || !int(u.cell, 0, GRID_CELLS - 1) || !int(u.id, 1, x.nextId) || cells.has(u.cell) || ids.has(u.id)) return null;
        cells.add(u.cell);
        ids.add(u.id);
        units.push({ id: u.id, soul: u.soul, star: u.star, cell: u.cell, fresh: !!u.fresh });
      }
      const st = x.stats;
      if (!st || !["drawn", "discarded", "dismissed", "merges", "failures"].every((k) => Number.isFinite(st[k]))) return null;
      if (!x.rng || !Number.isFinite(x.rng.seed) || !Number.isFinite(x.rng.pos)) return null;
      return {
        rules: r,
        rng: makeRng(x.rng.seed, x.rng.pos),
        wave: x.wave,
        hearts: x.hearts,
        cap: x.cap,
        hand: x.hand.slice(),
        units,
        nextId: x.nextId,
        discardUsed: x.discardUsed,
        status: "building",
        log: Array.isArray(x.log) ? x.log.filter((l) => typeof l === "string").slice(-40) : [],
        stats: { drawn: st.drawn, discarded: st.discarded, dismissed: st.dismissed, merges: st.merges, failures: st.failures }
      };
    } catch {
      return null;
    }
  }
  function saveRun(snap, store = browserStore()) {
    try {
      if (store) store.setItem(KEY2, JSON.stringify(snap));
    } catch {
    }
  }
  function clearRun(store = browserStore()) {
    try {
      if (store && store.removeItem) store.removeItem(KEY2);
      else if (store) store.setItem(KEY2, "");
    } catch {
    }
  }
  function loadRun(store = browserStore()) {
    try {
      const t = store && store.getItem(KEY2);
      if (!t) return null;
      const x = JSON.parse(t);
      if (!x || x.v !== VERSION2 || x.phase !== "build" && x.phase !== "draft" || !Number.isFinite(x.seed) || !Number.isFinite(x.attempt) || typeof x.difficulty !== "string") return null;
      const state = deserializeState(x.state);
      if (!state) return null;
      const draft = x.phase === "draft" && Array.isArray(x.draft) && x.draft.length === 3 && x.draft.every(isSoul) ? x.draft : null;
      return { snap: { v: VERSION2, seed: x.seed, attempt: x.attempt, difficulty: x.difficulty, phase: draft ? "draft" : "build", draft, state: x.state }, state };
    } catch {
      return null;
    }
  }

  // core/progress.ts
  var MAX_PACKS = 99;
  var REWARDS = {
    firstClearTier: { easy: 1, normal: 2, hard: 2, nightmare: 3 },
    replayTier: 1,
    replayClearsPerPack: 2
  };
  function grantPack(save, tier, source) {
    if (save.packs.length >= MAX_PACKS) return null;
    const pack = { id: save.nextPackId++, tier: Math.max(1, Math.min(PACK_TIERS, Math.floor(tier))), source };
    save.packs.push(pack);
    return pack;
  }
  function recordClear(save, stageId, difficulty) {
    var _a;
    const key = stageId + ":" + difficulty, before = (_a = save.clears[key]) != null ? _a : 0;
    save.clears[key] = before + 1;
    if (before === 0) return { first: true, pack: grantPack(save, REWARDS.firstClearTier[difficulty], "First clear \xB7 " + difficulty), replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
    save.replayMeter++;
    let pack = null;
    if (save.replayMeter >= REWARDS.replayClearsPerPack) {
      save.replayMeter -= REWARDS.replayClearsPerPack;
      pack = grantPack(save, REWARDS.replayTier, "Replay reward");
    }
    return { first: false, pack, replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
  }
  function recordClearAndSave(stageId, difficulty, store) {
    const s = loadSave(store);
    const r = recordClear(s, stageId, difficulty);
    writeSave(s, store);
    return r;
  }

  // game/visuals.ts
  var TINT = [[1, 1, 1], [0.86, 0.95, 1.18], [1.25, 1.1, 0.7]];
  var AURA = [
    { rate: 14, min: 0.06, max: 0.16, c1: [0.78, 0.35, 1, 0.7], c2: [0.45, 0.15, 0.9, 0.5] },
    { rate: 26, min: 0.08, max: 0.2, c1: [0.85, 0.65, 1, 0.8], c2: [0.55, 0.4, 1, 0.6] },
    { rate: 44, min: 0.1, max: 0.26, c1: [1, 0.85, 0.4, 0.85], c2: [0.8, 0.3, 1, 0.7] }
  ];
  function dyn(scene, w, h, draw2, alpha = true) {
    const t = new BABYLON.DynamicTexture("dt", { width: w, height: h }, scene, true);
    draw2(t.getContext());
    t.update();
    t.hasAlpha = alpha;
    return t;
  }
  async function loadAssets(scene) {
    const soft = dyn(scene, 64, 64, (c) => {
      const g2 = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g2.addColorStop(0, "rgba(255,255,255,1)");
      g2.addColorStop(0.4, "rgba(255,255,255,.55)");
      g2.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g2;
      c.fillRect(0, 0, 64, 64);
    });
    const starTex = [1, 2, 3].map((n) => dyn(scene, 192, 48, (c) => {
      c.font = "bold 40px sans-serif";
      c.textAlign = "center";
      c.lineWidth = 5;
      c.strokeStyle = "#1a1020";
      c.fillStyle = n === 3 ? "#ffd24a" : n === 2 ? "#d7e6ff" : "#f0d9a0";
      const s = "\u2605".repeat(n);
      c.strokeText(s, 96, 38);
      c.fillText(s, 96, 38);
    }));
    const emissive = (r, g2, b, a = 1) => {
      const m = new BABYLON.StandardMaterial("em", scene);
      m.diffuseColor = BABYLON.Color3.Black();
      m.emissiveColor = new BABYLON.Color3(r, g2, b);
      m.disableLighting = true;
      m.alpha = a;
      return m;
    };
    const A = {
      scene,
      soft,
      starTex,
      tripo: {},
      ringMat: [emissive(0.55, 0.2, 0.95, 0.9), emissive(0.95, 0.25, 0.2, 0.9)],
      haloMat: emissive(1, 0.82, 0.3, 0.95),
      barBg: emissive(0.05, 0.05, 0.08, 0.7),
      barFill: [emissive(0.55, 0.35, 1), emissive(1, 0.4, 0.3)],
      manaFill: emissive(0.25, 0.75, 1)
    };
    const defs = [
      ["warrior", "skeleton_warrior.glb", "skeleton_warrior_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Block" }, 1.05, 1],
      ["archer", "SkeletonArcher.glb", "SkeletonArcher_enemy.jpg", { idle: "Idle", run: "Run", attack: "Shoot", death: "Death", spawn: "Spawn", cheer: "Flex" }, 1.05, 1]
    ];
    await Promise.all(defs.map(async ([soul, glb, enemy, clips, top, scale]) => {
      const container = await BABYLON.SceneLoader.LoadAssetContainerAsync("assets/", glb, scene);
      A.tripo[soul] = { container, enemyTex: new BABYLON.Texture("assets/" + enemy, scene, false, false), clips, matCache: {}, top, scale };
    }));
    return A;
  }
  var Deco = class {
    constructor(A, parent, top, radius) {
      __publicField(this, "A", A);
      __publicField(this, "parent", parent);
      __publicField(this, "top", top);
      __publicField(this, "radius", radius);
      __publicField(this, "ps", null);
      __publicField(this, "halo", null);
      __publicField(this, "badge");
      __publicField(this, "stars");
      __publicField(this, "fill");
      __publicField(this, "bar");
      __publicField(this, "mbg");
      __publicField(this, "mfill");
      __publicField(this, "ring");
      const s = A.scene;
      this.ring = BABYLON.MeshBuilder.CreateDisc("ring", { radius: Math.max(0.3, radius * 1.15), tessellation: 26 }, s);
      this.ring.rotation.x = Math.PI / 2;
      this.ring.position.y = 0.02;
      this.ring.parent = parent;
      this.ring.isPickable = false;
      this.badge = new BABYLON.TransformNode("badge", s);
      this.badge.parent = parent;
      this.badge.position.y = top + 0.32;
      this.badge.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      this.stars = BABYLON.MeshBuilder.CreatePlane("stars", { width: 0.6, height: 0.15 }, s);
      this.stars.parent = this.badge;
      this.stars.position.y = 0.11;
      this.stars.isPickable = false;
      const sm = new BABYLON.StandardMaterial("sm", s);
      sm.emissiveColor = BABYLON.Color3.White();
      sm.disableLighting = true;
      sm.useAlphaFromDiffuseTexture = true;
      this.stars.material = sm;
      this.stars._sm = sm;
      const bg = BABYLON.MeshBuilder.CreatePlane("bg", { width: 0.6, height: 0.085 }, s);
      bg.parent = this.badge;
      bg.material = A.barBg;
      bg.isPickable = false;
      this.bar = bg;
      this.fill = BABYLON.MeshBuilder.CreatePlane("fill", { width: 0.56, height: 0.05 }, s);
      this.fill.parent = this.badge;
      this.fill.position.z = -2e-3;
      this.fill.isPickable = false;
      this.mbg = BABYLON.MeshBuilder.CreatePlane("mbg", { width: 0.6, height: 0.05 }, s);
      this.mbg.parent = this.badge;
      this.mbg.position.y = -0.07;
      this.mbg.material = A.barBg;
      this.mbg.isPickable = false;
      this.mfill = BABYLON.MeshBuilder.CreatePlane("mfill", { width: 0.56, height: 0.03 }, s);
      this.mfill.parent = this.badge;
      this.mfill.position.set(0, -0.07, -2e-3);
      this.mfill.material = A.manaFill;
      this.mfill.isPickable = false;
      this.bar.setEnabled(false);
      this.fill.setEnabled(false);
      this.mbg.setEnabled(false);
      this.mfill.setEnabled(false);
    }
    set(team, star) {
      const s = this.A.scene, cfg = AURA[star - 1];
      this.stars._sm.diffuseTexture = this.A.starTex[star - 1];
      this.ring.material = this.A.ringMat[team];
      this.fill.material = this.A.barFill[team];
      if (team === 0) {
        if (!this.ps) {
          const ps = new BABYLON.ParticleSystem("aura", 70, s);
          ps.particleTexture = this.A.soft;
          ps.emitter = this.parent;
          ps.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.2);
          ps.maxEmitBox = new BABYLON.Vector3(0.2, this.top * 0.5, 0.2);
          ps.minLifeTime = 0.5;
          ps.maxLifeTime = 1.1;
          ps.direction1 = new BABYLON.Vector3(-0.15, 0.8, -0.15);
          ps.direction2 = new BABYLON.Vector3(0.15, 1.5, 0.15);
          ps.minEmitPower = 0.35;
          ps.maxEmitPower = 0.8;
          ps.gravity = new BABYLON.Vector3(0, 0.4, 0);
          ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
          this.ps = ps;
        }
        const p = this.ps;
        p.emitRate = cfg.rate;
        p.minSize = cfg.min;
        p.maxSize = cfg.max;
        p.color1 = new BABYLON.Color4(...cfg.c1);
        p.color2 = new BABYLON.Color4(...cfg.c2);
        p.colorDead = new BABYLON.Color4(0.2, 0, 0.4, 0);
        if (!p.isStarted()) p.start();
      } else if (this.ps && this.ps.isStarted()) this.ps.stop();
      if (star >= 3) {
        if (!this.halo) {
          this.halo = BABYLON.MeshBuilder.CreateTorus("halo", { diameter: 0.55, thickness: 0.04, tessellation: 24 }, s);
          this.halo.parent = this.parent;
          this.halo.position.y = this.top + 0.08;
          this.halo.material = this.A.haloMat;
          this.halo.isPickable = false;
        }
        this.halo.setEnabled(true);
      } else if (this.halo) this.halo.setEnabled(false);
    }
    setHp(f) {
      const on = f !== null;
      this.bar.setEnabled(on);
      this.fill.setEnabled(on);
      if (on) {
        const k = Math.max(1e-3, f);
        this.fill.scaling.x = k;
        this.fill.position.x = -(0.56 * (1 - k)) / 2;
      }
    }
    setMana(f) {
      const on = f !== null;
      this.mbg.setEnabled(on);
      this.mfill.setEnabled(on);
      if (on) {
        const k = Math.max(1e-3, f);
        this.mfill.scaling.x = k;
        this.mfill.position.x = -(0.56 * (1 - k)) / 2;
      }
    }
    setAura(on) {
      if (this.ps) {
        if (on && !this.ps.isStarted()) this.ps.start();
        if (!on && this.ps.isStarted()) this.ps.stop();
      }
    }
    update(dt) {
      if (this.halo && this.halo.isEnabled()) this.halo.rotation.y += dt * 1.6;
    }
    dispose() {
      if (this.ps) {
        this.ps.stop();
        this.ps.dispose();
      }
      [this.halo, this.ring, this.stars, this.bar, this.fill, this.mbg, this.mfill].forEach((m) => m && m.dispose());
      this.badge.dispose();
    }
  };
  var TripoVisual = class {
    constructor(A, cfg, soul, team, star) {
      __publicField(this, "A", A);
      __publicField(this, "cfg", cfg);
      __publicField(this, "holder");
      __publicField(this, "team");
      __publicField(this, "star", 1);
      __publicField(this, "state", "idle");
      __publicField(this, "top");
      __publicField(this, "ent");
      __publicField(this, "body");
      __publicField(this, "anims", {});
      __publicField(this, "cur", null);
      __publicField(this, "deco");
      __publicField(this, "pick");
      __publicField(this, "pulseT", 0);
      __publicField(this, "base");
      const s = A.scene, uid = Math.random().toString(36).slice(2, 7);
      this.ent = cfg.container.instantiateModelsToScene((n) => n + "_" + uid, false, { doNotInstantiate: true });
      this.holder = new BABYLON.TransformNode("unit_" + uid, s);
      this.ent.rootNodes[0].parent = this.holder;
      this.body = this.ent.rootNodes[0].getChildMeshes().find((m) => m.name.includes("_Body"));
      if (!cfg.baseMat) cfg.baseMat = this.body.material;
      this.ent.animationGroups.forEach((g2) => {
        g2.stop();
        g2.enableBlending = true;
        g2.blendingSpeed = 0.12;
        this.anims[g2.name.split("_")[0]] = g2;
      });
      this.ent.rootNodes[0].getChildMeshes().forEach((m) => {
        m.alwaysSelectAsActiveMesh = true;
        m.isPickable = false;
      });
      this.top = cfg.top;
      this.base = cfg.scale;
      this.team = team;
      this.deco = new Deco(A, this.holder, this.top, 0.3);
      this.pick = BABYLON.MeshBuilder.CreateCylinder("pick", { height: 1.3, diameter: 0.8 }, s);
      this.pick.parent = this.holder;
      this.pick.position.y = 0.6;
      this.pick.visibility = 1e-3;
      this.pick.isPickable = true;
      this.setTeam(team);
      this.setStar(star);
      this.pick.metadata = { kind: "unit", visual: this };
    }
    applyMat() {
      const key = this.team + "_" + this.star, c = this.cfg;
      if (!c.matCache[key]) {
        const m = c.baseMat.clone("m_" + key);
        if (this.team === 1) m.albedoTexture = c.enemyTex;
        const t = TINT[this.star - 1];
        m.albedoColor = new BABYLON.Color3(t[0], t[1], t[2]);
        c.matCache[key] = m;
      }
      this.body.material = c.matCache[key];
    }
    setTeam(t) {
      this.team = t;
      this.applyMat();
      this.deco.set(t, this.star);
    }
    setStar(st) {
      this.star = st;
      this.applyMat();
      this.holder.scaling.setAll(BALANCE.star.scale[st - 1] * this.base);
      this.deco.set(this.team, st);
    }
    setHp(f) {
      this.deco.setHp(f);
    }
    setMana(f) {
      this.deco.setMana(f);
    }
    pulse() {
      this.pulseT = 0.16;
    }
    play(state, speed = 1) {
      const g2 = this.anims[this.cfg.clips[state]];
      if (!g2) return;
      const loop = state === "idle" || state === "run";
      if (loop && this.state === state && this.cur === g2) return;
      if (this.cur) this.cur.stop();
      g2.stop();
      g2.start(loop, speed, g2.from, g2.to);
      if (loop) g2.goToFrame(g2.from + Math.random() * (g2.to - g2.from));
      this.cur = g2;
      this.state = state;
      this.deco.setAura(state !== "death");
    }
    update(dt) {
      this.deco.update(dt);
      if (this.pulseT > 0) {
        this.pulseT -= dt;
        const k = 1 + 0.09 * Math.sin(Math.max(0, this.pulseT) / 0.16 * Math.PI);
        this.holder.scaling.setAll(BALANCE.star.scale[this.star - 1] * this.base * k);
      }
    }
    dispose() {
      this.deco.dispose();
      this.ent.animationGroups.forEach((g2) => g2.dispose());
      this.ent.skeletons.forEach((s) => s.dispose());
      this.pick.dispose();
      this.ent.rootNodes[0].dispose(false, false);
      this.holder.dispose();
    }
  };
  var PH = {
    goblin: { col: "#63b13f", w: 0.36, h: 0.42, head: 0.36, weapon: "dagger", label: "GOBLIN" },
    knight: { col: "#8ea9dc", w: 0.5, h: 0.6, head: 0.36, weapon: "shield", label: "KNIGHT" },
    ogre: { col: "#a8a64a", w: 0.85, h: 0.85, head: 0.42, weapon: "mace", label: "OGRE" },
    barbarian: { col: "#d68a55", w: 0.52, h: 0.62, head: 0.38, weapon: "axe", label: "BARBARIAN" }
  };
  var PlaceholderVisual = class {
    constructor(A, soul, team, star) {
      __publicField(this, "A", A);
      __publicField(this, "soul", soul);
      __publicField(this, "holder");
      __publicField(this, "team");
      __publicField(this, "star", 1);
      __publicField(this, "state", "idle");
      __publicField(this, "top");
      __publicField(this, "rig");
      __publicField(this, "legs", []);
      __publicField(this, "wp");
      __publicField(this, "deco");
      __publicField(this, "pick");
      __publicField(this, "t", Math.random() * 6);
      __publicField(this, "st0", 0);
      __publicField(this, "dur", 1);
      __publicField(this, "base", 1);
      __publicField(this, "pulseT", 0);
      __publicField(this, "mats", []);
      __publicField(this, "body");
      const s = A.scene, d = PH[soul];
      this.team = team;
      this.holder = new BABYLON.TransformNode("ph_" + soul, s);
      this.rig = new BABYLON.TransformNode("rig", s);
      this.rig.parent = this.holder;
      const mat = (hex, em = 0) => {
        const m = new BABYLON.StandardMaterial("pm", s);
        m.diffuseColor = BABYLON.Color3.FromHexString(hex).scale(0.72);
        m.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        if (em) m.emissiveColor = m.diffuseColor.scale(em);
        return m;
      };
      const legH = 0.22, bodyY = legH + d.h / 2;
      for (const sx of [-1, 1]) {
        const lg = new BABYLON.TransformNode("leg", s);
        lg.parent = this.rig;
        lg.position.set(sx * d.w * 0.22, legH, 0);
        const m = BABYLON.MeshBuilder.CreateCylinder("l", { height: legH, diameter: d.w * 0.28 }, s);
        m.parent = lg;
        m.position.y = -legH / 2;
        m.material = mat("#4a3826");
        m.isPickable = false;
        this.legs.push(lg);
      }
      this.body = BABYLON.MeshBuilder.CreateCapsule("body", { radius: d.w / 2, height: d.h + d.w * 0.4 }, s);
      this.body.parent = this.rig;
      this.body.position.y = bodyY;
      this.body.material = mat(d.col);
      this.body.isPickable = false;
      const head = BABYLON.MeshBuilder.CreateSphere("head", { diameter: d.head * 1.5, segments: 12 }, s);
      head.parent = this.rig;
      head.position.y = legH + d.h + d.head * 0.55;
      head.material = mat(d.col);
      head.isPickable = false;
      const eyeM = new BABYLON.StandardMaterial("eye", s);
      eyeM.diffuseColor = BABYLON.Color3.Black();
      eyeM.emissiveColor = team === 0 ? new BABYLON.Color3(0.75, 0.25, 1) : new BABYLON.Color3(1, 0.66, 0.19);
      this.eyeM = eyeM;
      for (const sx of [-1, 1]) {
        const e = BABYLON.MeshBuilder.CreateSphere("e", { diameter: d.head * 0.3 }, s);
        e.parent = this.rig;
        e.position.set(sx * d.head * 0.3, head.position.y + 0.02, d.head * 0.66);
        e.material = eyeM;
        e.isPickable = false;
      }
      this.wp = new BABYLON.TransformNode("wp", s);
      this.wp.parent = this.rig;
      this.wp.position.set(d.w * 0.6, legH + d.h * 0.85, 0.05);
      const wm = mat("#7a5a30"), iron = mat("#9aa1ad");
      const mk = (m, kind, dims, pos, mt) => {
        const x = kind === "box" ? BABYLON.MeshBuilder.CreateBox("w", dims, s) : kind === "cyl" ? BABYLON.MeshBuilder.CreateCylinder("w", dims, s) : BABYLON.MeshBuilder.CreateSphere("w", dims, s);
        x.parent = this.wp;
        x.position.set(pos[0], pos[1], pos[2]);
        x.material = mt;
        x.isPickable = false;
        return x;
      };
      if (d.weapon === "dagger") mk(0, "box", { width: 0.05, height: 0.3, depth: 0.03 }, [0, -0.2, 0.12], iron);
      if (d.weapon === "shield") {
        mk(0, "box", { width: 0.06, height: 0.5, depth: 0.04 }, [0, -0.3, 0.14], iron);
        const sh = BABYLON.MeshBuilder.CreateCylinder("sh", { height: 0.05, diameter: 0.55 }, s);
        sh.parent = this.rig;
        sh.rotation.z = Math.PI / 2;
        sh.position.set(-d.w * 0.7, legH + d.h * 0.6, 0.05);
        sh.material = mat("#d8b64a");
        sh.isPickable = false;
      }
      if (d.weapon === "mace") {
        mk(0, "cyl", { height: 0.9, diameter: 0.08 }, [0, -0.35, 0.3], wm);
        mk(0, "sph", { diameter: 0.4 }, [0, -0.85, 0.4], iron);
      }
      if (d.weapon === "axe") {
        mk(0, "cyl", { height: 0.6, diameter: 0.05 }, [0, -0.2, 0.15], wm);
        mk(0, "box", { width: 0.32, height: 0.22, depth: 0.05 }, [0, -0.5, 0.15], iron);
        const hair = BABYLON.MeshBuilder.CreateCylinder("hair", { height: 0.3, diameterTop: 0, diameterBottom: d.head * 1.2 }, s);
        hair.parent = this.rig;
        hair.position.y = head.position.y + d.head * 0.75;
        hair.material = mat("#c22a1c");
        hair.isPickable = false;
      }
      this.top = legH + d.h + d.head * 1.35;
      this.deco = new Deco(A, this.holder, this.top, d.w * 0.7);
      const lbl = dyn(s, 256, 48, (c) => {
        c.font = "bold 26px sans-serif";
        c.textAlign = "center";
        c.fillStyle = "#ffffff";
        c.strokeStyle = "#111";
        c.lineWidth = 5;
        c.strokeText(d.label + " (stand-in)", 128, 34);
        c.fillText(d.label + " (stand-in)", 128, 34);
      });
      const lp = BABYLON.MeshBuilder.CreatePlane("lbl", { width: 1.1, height: 0.2 }, s);
      lp.parent = this.holder;
      lp.position.y = -0.1;
      lp.rotation.x = Math.PI / 2 * 0;
      lp.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      const lm = new BABYLON.StandardMaterial("lm", s);
      lm.diffuseTexture = lbl;
      lm.emissiveColor = BABYLON.Color3.White();
      lm.disableLighting = true;
      lm.useAlphaFromDiffuseTexture = true;
      lp.material = lm;
      lp.isPickable = false;
      lp.position.y = this.top + 0.62;
      this.pick = BABYLON.MeshBuilder.CreateCylinder("pick", { height: this.top, diameter: Math.max(0.7, d.w * 1.3) }, s);
      this.pick.parent = this.holder;
      this.pick.position.y = this.top / 2;
      this.pick.visibility = 1e-3;
      this.pick.metadata = { kind: "unit", visual: this };
      this.parts = [lp];
      this.setTeam(team);
      this.setStar(star);
      this.play("idle");
    }
    setTeam(t) {
      this.team = t;
      this.eyeM.emissiveColor = t === 0 ? new BABYLON.Color3(0.75, 0.25, 1) : new BABYLON.Color3(1, 0.66, 0.19);
      this.deco.set(t, this.star);
    }
    setStar(st) {
      this.star = st;
      this.base = BALANCE.star.scale[st - 1];
      const t = TINT[st - 1];
      this.body.material.diffuseColor = BABYLON.Color3.FromHexString(PH[this.soul].col).scale(0.72).multiply(new BABYLON.Color3(Math.min(1, t[0]), Math.min(1, t[1]), Math.min(1, t[2])));
      this.holder.scaling.setAll(this.base);
      this.deco.set(this.team, st);
    }
    setHp(f) {
      this.deco.setHp(f);
    }
    setMana(f) {
      this.deco.setMana(f);
    }
    pulse() {
      this.pulseT = 0.16;
    }
    play(state, speed = 1) {
      if (state === this.state && (state === "idle" || state === "run")) return;
      this.state = state;
      this.st0 = this.t;
      this.dur = state === "attack" ? BALANCE.stats[this.soul].animLen / speed : state === "death" ? 0.6 : state === "spawn" ? 0.9 : 1;
      this.deco.setAura(state !== "death");
    }
    update(dt) {
      this.t += dt;
      this.deco.update(dt);
      const p = Math.min(1, (this.t - this.st0) / this.dur), R = this.rig, W = this.wp;
      R.position.set(0, 0, 0);
      R.rotation.set(0, 0, 0);
      R.scaling.setAll(1);
      W.rotation.x = -0.4;
      this.legs.forEach((l) => l.rotation.x = 0);
      if (this.state === "idle") R.position.y = Math.sin(this.t * 2.2) * 0.012;
      else if (this.state === "run") {
        const w = this.t * 10;
        R.position.y = Math.abs(Math.sin(w)) * 0.07;
        R.rotation.x = 0.2;
        this.legs[0].rotation.x = Math.sin(w) * 0.9;
        this.legs[1].rotation.x = -Math.sin(w) * 0.9;
        W.rotation.x = -0.4 + Math.sin(w) * 0.4;
      } else if (this.state === "attack") {
        const k = p < 0.4 ? -2.4 * (p / 0.4) : -2.4 + 3.4 * Math.min(1, (p - 0.4) / 0.25);
        W.rotation.x = k;
        R.position.z = 0.14 * Math.sin(Math.PI * p);
        R.rotation.x = 0.15 * Math.sin(Math.PI * p);
      } else if (this.state === "spawn") {
        const e = p * p * (3 - 2 * p);
        R.scaling.setAll(0.01 + 0.99 * e);
        R.position.y = (e - 1) * 0.4;
      } else if (this.state === "death") {
        const e = p * p;
        R.rotation.x = -Math.PI / 2 * e;
        R.position.y = 0.25 * e;
        R.position.z = -0.2 * e;
      } else if (this.state === "cheer") {
        R.position.y = Math.abs(Math.sin(this.t * 7)) * 0.15;
        W.rotation.x = -2.6;
      }
      if (this.pulseT > 0) {
        this.pulseT -= dt;
        const k = 1 + 0.09 * Math.sin(Math.max(0, this.pulseT) / 0.16 * Math.PI);
        this.holder.scaling.setAll(this.base * k);
      }
    }
    dispose() {
      this.deco.dispose();
      this.holder.getChildMeshes().forEach((m) => m.dispose());
      this.holder.dispose();
    }
  };
  function createVisual(A, soul, team, star) {
    const cfg = A.tripo[soul];
    return cfg ? new TripoVisual(A, cfg, soul, team, star) : new PlaceholderVisual(A, soul, team, star);
  }

  // ui/icons.ts
  var iconUrl = (n) => "assets/icons/" + n + ".png";
  var iconImg = (n, cls = "ic") => `<img class="${cls}" src="${iconUrl(n)}" alt="" draggable="false">`;
  var SOUL_ICON = { warrior: "warrior", archer: "archer", goblin: "goblin", knight: "knight", ogre: "ogre", barbarian: "barbarian" };
  var skullImgs = (n, cls = "sk") => iconImg("souls", cls).repeat(Math.max(1, n));
  var heartsHtml = (hearts, max = 3) => iconImg("heart", "ic heart").repeat(Math.max(0, hearts)) + iconImg("heart_empty", "ic heart").repeat(Math.max(0, max - hearts));

  // game/ui.ts
  var ICON = Object.fromEntries(SOULS.map((s) => [s, iconImg(SOUL_ICON[s], "ic")]));
  var $ = (id) => document.getElementById(id);
  var stars = (n) => "\u2605".repeat(n);
  var Ui = class {
    constructor(g2) {
      __publicField(this, "g", g2);
      __publicField(this, "toastT", 0);
      __publicField(this, "dbg");
      __publicField(this, "odds", "");
      $("btnHome").onclick = () => window.dispatchEvent(new Event("necro-go-home"));
      $("btnBattle").onclick = () => g2.startBattle();
      $("btnSwap").onclick = () => g2.toggleSwap();
      $("btnMerge").onclick = () => g2.mergeSelected();
      $("btnRemove").onclick = () => g2.removeSelected();
      document.querySelectorAll("[data-speed]").forEach((b) => b.onclick = () => g2.setSpeed(+b.dataset.speed));
      document.querySelectorAll("[data-cam]").forEach((b) => b.onclick = () => g2.setCamMode(b.dataset.cam));
      $("gear").onclick = () => {
        this.dbg.classList.toggle("open");
        this.renderDebug();
      };
      const snd = () => {
        $("btnMusic").classList.toggle("off", !audio.music);
        $("btnSfx").classList.toggle("off", !audio.sfx);
        const si = $("btnSfx").querySelector("img");
        if (si) si.src = iconUrl(audio.sfx ? "sound_on" : "sound_off");
      };
      $("btnMusic").onclick = () => {
        audio.setMusic(!audio.music);
        snd();
      };
      $("btnSfx").onclick = () => {
        audio.setSfx(!audio.sfx);
        snd();
      };
      window.addEventListener("necro-settings", snd);
      snd();
      this.dbg = $("debug");
      if (new URLSearchParams(location.search).get("debug")) this.dbg.classList.add("open");
      this.renderDebug();
    }
    /** The Necromancer just lost a heart: make the hearts bump. */
    pulseHearts() {
      const h = $("hearts");
      h.classList.remove("hurt");
      void h.offsetWidth;
      h.classList.add("hurt");
    }
    toast(msg) {
      const t = $("toast");
      t.textContent = msg;
      t.classList.add("show");
      clearTimeout(this.toastT);
      this.toastT = window.setTimeout(() => t.classList.remove("show"), 3600);
    }
    render() {
      const g2 = this.g, s = g2.s, ph = g2.phase, build = ph === "build";
      $("hearts").innerHTML = heartsHtml(s.hearts);
      $("wave").textContent = `Wave ${s.wave}/${stageWaves(s)}`;
      const used = dominionUsed(s);
      $("dom").textContent = `${used}/${s.cap}`;
      $("domfill").style.width = Math.min(100, used / s.cap * 100) + "%";
      const pv = previewText(enemyWave(s.wave, g2.seed));
      $("enemy").innerHTML = `<b>Next enemies</b>` + pv.map((p) => `<div class="erow"><span>${ICON[p.soul]}</span><span>${SOUL_NAME[p.soul]}</span><span class="x">\xD7${p.count}</span><span class="st">${stars(p.star)}</span></div>`).join("") + `<div class="hint">Positions stay hidden until the battle.</div>`;
      const hand = $("hand");
      hand.innerHTML = "";
      s.hand.forEach((soul, i) => {
        const el = document.createElement("div");
        const sel = g2.sel && g2.sel.type === "card" && g2.sel.idx === i;
        const afford = canSummon(s, i), canMerge = s.units.some((u) => canMergeFromHand(s, i, u.id)), usable = afford || canMerge;
        el.className = "card" + (sel ? " sel" : "") + (!usable && !g2.swapMode ? " dis" : "") + (g2.swapMode ? " swap" : "");
        const tag = afford ? `<span class="ok">Summon</span>` : canMerge ? '<span class="ok mg">Merge only</span>' : '<span class="no">No room</span>';
        el.innerHTML = `<div class="cost">${cost(soul, 1)}</div>${ICON[soul]}<div class="nm">${SOUL_NAME[soul]}</div><div class="cs">${tag}</div>`;
        el.title = ROLE_TEXT[soul] + (afford ? "" : canMerge ? " - Dominion is full, but you can merge it into your matching 1-star unit." : " - Not enough free Dominion to summon this.");
        el.onclick = () => g2.onCard(i);
        hand.appendChild(el);
      });
      if (!s.hand.length) hand.innerHTML = '<div class="empty">No cards in hand</div>';
      $("btnBattle").disabled = !build || !s.units.length;
      const sw = $("btnSwap");
      sw.disabled = !build || s.discardUsed;
      sw.classList.toggle("on", g2.swapMode);
      sw.textContent = s.discardUsed ? "Swap used" : g2.swapMode ? "Swap: pick a card or unit" : "Swap (1/round)";
      const selU = g2.sel && g2.sel.type === "unit" ? s.units.find((u) => u.id === g2.sel.id) : null;
      const partner = selU && s.units.some((o) => canMergeDeployed(selU, o));
      $("unitpanel").style.display = build && selU ? "flex" : "none";
      $("btnMerge").disabled = !partner;
      $("btnRemove").textContent = g2.confirmRemove ? "Confirm remove" : "Remove";
      $("info").textContent = build ? g2.swapMode ? "SWAP: tap a hand card to discard it, or tap a unit you did not summon this round to sell it. You draw a different Soul." : selU ? `${SOUL_NAME[selU.soul]} ${stars(selU.star)}  \u2022  ${ROLE_TEXT[selU.soul]}  ${partner ? "\u2022 Tap a glowing partner to merge." : ""}` : g2.sel && g2.sel.type === "card" ? `${SOUL_NAME[s.hand[g2.sel.idx]]}: ${ROLE_TEXT[s.hand[g2.sel.idx]]}  \u2022  ` + (() => {
        const i = g2.sel.idx, sm = canSummon(s, i), mg = s.units.some((u) => canMergeFromHand(s, i, u.id));
        return sm && mg ? "Tap a green tile to summon, or a glowing purple unit to merge it in." : sm ? "Tap a green tile to summon." : mg ? "Dominion is full: tap a glowing purple unit to merge it in." : "Not enough free Dominion to summon this.";
      })() : "Tap a card, then a tile. Tap a unit to merge, move or remove it." : ph === "battle" || ph === "transition" ? "Battle! Units fight on their own." : "";
      $("speed").style.display = ph === "battle" || ph === "transition" ? "flex" : "none";
      document.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("on", +b.dataset.speed === g2.timeScale));
      document.querySelectorAll("[data-cam]").forEach((b) => b.classList.toggle("on", b.dataset.cam === g2.camMode));
      document.body.classList.toggle("inbattle", ph === "battle" || ph === "transition");
      audio.setMode(ph === "battle" || ph === "transition" ? "battle" : "build");
      const ov = $("overlay");
      ov.className = "";
      ov.innerHTML = "";
      if (ph === "draft" && g2.draft) {
        ov.className = "show";
        ov.innerHTML = `<div class="box"><h2>Victory Draft</h2><div class="sub">Wave cleared. Dominion is now ${s.cap}. Keep one:</div><div class="row">${g2.draft.map((soul, i) => `<div class="card big" data-i="${i}"><div class="cost">${cost(soul, 1)}</div>${ICON[soul]}<div class="nm">${SOUL_NAME[soul]}</div><div class="role">${ROLE_TEXT[soul]}</div></div>`).join("")}</div></div>`;
        ov.querySelectorAll(".card").forEach((c) => c.onclick = () => g2.pickDraft(+c.dataset.i));
      } else if (ph === "won" || ph === "lost") {
        const rw = ph === "won" ? g2.reward : null, sk = (n) => skullImgs(n);
        const rewardHtml = rw ? `<div class="sub" style="color:#ffd24a;font-weight:700">${rw.pack ? rw.first ? `${iconImg("shop")} First clear! You earned a ${sk(rw.pack.tier)} Soul Pack.` : `${iconImg("shop")} Replay reward: a ${sk(rw.pack.tier)} Soul Pack.` : `Replay progress ${rw.replayMeter}/${rw.replayNeeded} toward a Soul Pack.`}</div>` : "";
        ov.className = "show";
        ov.innerHTML = `<div class="box"><h2>${ph === "won" ? "Stage cleared!" : "Stage lost"}</h2><div class="sub">${g2.lastBattle}</div>${rewardHtml}<div class="row">${rw && rw.pack ? '<button id="toShop" class="go">Open pack</button>' : ""}<button id="again" class="${rw && rw.pack ? "blue" : "go"}">${ph === "won" ? "Play again" : "Try again"}</button><button id="toHome" class="blue">Home</button></div></div>`;
        $("again").onclick = () => g2.newRun();
        $("toHome").onclick = () => window.dispatchEvent(new Event("necro-go-home"));
        const ts = document.getElementById("toShop");
        if (ts) ts.onclick = () => window.dispatchEvent(new Event("necro-go-shop"));
      }
      this.renderDebugLive();
      if (ph === "build") requestAnimationFrame(() => g2.reframeBuild());
    }
    // ------------------------------------------------------------------------------------------ debug panel
    renderDebug() {
      const g2 = this.g, d = this.dbg;
      if (!d.classList.contains("open")) {
        d.innerHTML = "";
        return;
      }
      const row = (label, obj, key, min, max, step) => `<label>${label} <input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}" data-o="${label}"><span>${obj[key]}</span></label>`;
      d.innerHTML = `<b>Debug (live)</b> <span id="dbgfps"></span>
      <div class="dsec">Star multipliers (bodies = damage, stars = durability)
        ${row("HP x 2\u2605", BALANCE.star.hp, 1, 1, 4, 0.05)}${row("HP x 3\u2605", BALANCE.star.hp, 2, 1, 6, 0.05)}${row("Damage x 2\u2605", BALANCE.star.dmg, 1, 1, 4, 0.05)}${row("Damage x 3\u2605", BALANCE.star.dmg, 2, 1, 6, 0.05)}${row("Size 2\u2605", BALANCE.star.scale, 1, 1, 1.6, 0.02)}${row("Size 3\u2605", BALANCE.star.scale, 2, 1, 2, 0.02)}</div>
      <div class="dsec"><table><tr><th></th><th>hp</th><th>dmg</th><th>rate</th><th>range</th><th>spd</th></tr>${SOULS.map((k) => `<tr><td>${ICON[k]}</td>${["hp", "dmg", "interval", "range", "speed"].map((f) => `<td><input class="num" data-soul="${k}" data-f="${f}" value="${BALANCE.stats[k][f]}"></td>`).join("")}</tr>`).join("")}</table></div>
      <div class="dsec">Difficulty <select id="dDiff">${["easy", "normal", "hard", "nightmare"].map((k) => `<option value="${k}" ${g2.difficulty === k ? "selected" : ""}>${k}</option>`).join("")}</select> <small>(applies to the next battle)</small></div>
      <div class="dsec"><label><input type="checkbox" id="dMergeHand" ${g2.s.rules.merge === "handIntoOneStar" ? "checked" : ""}> Merge a hand card straight into a deployed unit (off = doc rule: both copies must be on the board)</label></div>
      <div class="dsec">Performance<br><small id="dbgPerf">measuring\u2026</small><br><label><input type="checkbox" id="dFps" ${g2.showFps ? "checked" : ""}> Show FPS on the battle screen</label> <button id="dPerf">Copy perf report</button></div>
      <div class="dsec"><button id="dOdds">Test odds (200 fights)</button> <span id="dOddsOut">${this.odds}</span></div>
      <div class="dsec"><button id="dCopy">Copy report</button> <button id="dReset">Reset balance</button> <button id="dRestart">Restart stage</button></div>
      <div class="dsec">Add card <select id="dCard">${SOULS.map((k) => `<option value="${k}">${SOUL_NAME[k]}</option>`).join("")}</select> <button id="dAdd">+</button> <button id="dDom">+2 Dominion</button></div>
      <div class="dsec"><small>Last tap: <span id="dbgtap">${g2.lastTapInfo}</span></small></div>
      <div class="dsec"><small>Seed ${g2.seed}. Add <code>?seed=7</code> to the link to replay the same draws.</small></div>`;
      d.querySelectorAll("input[type=range]").forEach((inp) => inp.oninput = () => {
        const lab = inp.dataset.o;
        const v = +inp.value;
        inp.nextElementSibling.textContent = String(v);
        const set = { "HP x 2\u2605": () => BALANCE.star.hp[1] = v, "HP x 3\u2605": () => BALANCE.star.hp[2] = v, "Damage x 2\u2605": () => BALANCE.star.dmg[1] = v, "Damage x 3\u2605": () => BALANCE.star.dmg[2] = v, "Size 2\u2605": () => BALANCE.star.scale[1] = v, "Size 3\u2605": () => BALANCE.star.scale[2] = v };
        set[lab]();
        g2.applyBalanceChange();
      });
      d.querySelectorAll("input.num").forEach((inp) => inp.onchange = () => {
        BALANCE.stats[inp.dataset.soul][inp.dataset.f] = +inp.value;
      });
      $("dDiff").onchange = (e) => g2.changeDifficulty(e.target.value);
      $("dMergeHand").onchange = (e) => {
        g2.s.rules.merge = e.target.checked ? "handIntoOneStar" : "deployedOnly";
        g2.syncBuild();
        this.render();
      };
      $("dOdds").onclick = () => {
        const r = g2.testOdds(200);
        this.odds = `${r.win}% win (${r.n} fights, avg ${r.avgTime}s) vs wave ${g2.s.wave}`;
        $("dOddsOut").textContent = this.odds;
      };
      $("dCopy").onclick = () => {
        const t = g2.report();
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => this.toast("Report copied. Paste it into chat.")).catch(() => {
          prompt("Copy this report:", t);
        });
      };
      $("dFps").onchange = (e) => g2.setShowFps(e.target.checked);
      $("dPerf").onclick = () => {
        const t = g2.perfReport();
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => this.toast("Perf report copied. Paste it into chat.")).catch(() => {
          prompt("Copy this report:", t);
        });
      };
      $("dReset").onclick = () => {
        g2.resetBalanceAll();
        this.renderDebug();
      };
      $("dRestart").onclick = () => g2.startStage(g2.seed);
      $("dAdd").onclick = () => g2.addCard($("dCard").value);
      $("dDom").onclick = () => g2.addDominion(2);
    }
    renderDebugLive() {
      const f = document.getElementById("dbgfps");
      if (f) f.textContent = `${this.g.phase}`;
      const pf = document.getElementById("dbgPerf");
      if (pf) {
        const p = this.g.perfInfo();
        pf.textContent = `${p.fps.toFixed(0)} fps \xB7 avg ${p.avg.toFixed(1)}ms \xB7 slow5% ${p.p95.toFixed(0)}ms \xB7 worst ${p.worst.toFixed(0)}ms \xB7 ${p.meshes} meshes \xB7 ${p.particles} particle systems \xB7 ${p.draws} draw calls`;
      }
      const t = document.getElementById("dbgtap");
      if (t) t.textContent = this.g.lastTapInfo;
    }
  };

  // game/game.ts
  var Game = class {
    constructor() {
      __publicField(this, "engine");
      __publicField(this, "scene");
      __publicField(this, "camera");
      __publicField(this, "A");
      __publicField(this, "ui");
      __publicField(this, "s");
      __publicField(this, "seed", 1);
      __publicField(this, "attempt", 0);
      __publicField(this, "phase", "build");
      __publicField(this, "battle", null);
      __publicField(this, "timeScale", 1);
      __publicField(this, "sel", null);
      __publicField(this, "swapMode", false);
      __publicField(this, "confirmRemove", false);
      __publicField(this, "draft", null);
      __publicField(this, "lastBattle", "");
      __publicField(this, "unitVis", /* @__PURE__ */ new Map());
      // unit id -> visual (your army, persists between waves)
      __publicField(this, "visToUnit", /* @__PURE__ */ new Map());
      __publicField(this, "fvis", /* @__PURE__ */ new Map());
      // fighter id -> visual during a battle
      __publicField(this, "fUnit", /* @__PURE__ */ new Map());
      // fighter id -> unit id (player side)
      __publicField(this, "lastState", /* @__PURE__ */ new Map());
      __publicField(this, "tiles", []);
      __publicField(this, "tileMats", []);
      __publicField(this, "ringFx", []);
      __publicField(this, "arrows", []);
      __publicField(this, "timers", []);
      __publicField(this, "acc", 0);
      __publicField(this, "camFrom", null);
      __publicField(this, "camTo", null);
      __publicField(this, "camT", 1);
      __publicField(this, "camDur", 2);
      __publicField(this, "resultAt", -1);
      __publicField(this, "handled", false);
      __publicField(this, "startStepAt", 0);
      __publicField(this, "arrowMats", []);
      __publicField(this, "arrowMesh", []);
      __publicField(this, "necro");
      /** What the last stage clear earned (shown on the stage-cleared screen). */
      __publicField(this, "reward", null);
      __publicField(this, "cine", false);
      // a result cutscene is playing: the battle camera and fighter sync stand down
      __publicField(this, "tweens", []);
      __publicField(this, "seenMerges", 0);
      /** The navigation shell hides the battle screen while another tab is open: pause the game so it costs nothing. */
      __publicField(this, "active", true);
      /** Debug: keep drawing but stop advancing time, so a moment can be stepped through with frame(dt) and screenshotted. */
      __publicField(this, "frozen", false);
      __publicField(this, "canvas");
      __publicField(this, "lastW", 0);
      __publicField(this, "lastH", 0);
      __publicField(this, "lastTapInfo", "(no taps yet)");
      // ---- battle camera: follows the fighters that are still alive, so the action (and the purple eyes) stays large on screen
      __publicField(this, "camMode", "close");
      __publicField(this, "camTgt", new BABYLON.Vector3(0, 0.5, 0));
      // ---- performance readout: rolling frame stats, per-battle summaries, optional on-screen FPS, and a paste-friendly report
      __publicField(this, "showFps", false);
      __publicField(this, "perfNow", { fps: 0, avg: 0, p95: 0, worst: 0 });
      __publicField(this, "perfLog", []);
      __publicField(this, "perfBuf", new Float32Array(240));
      __publicField(this, "perfN", 0);
      __publicField(this, "perfI", 0);
      __publicField(this, "perfShownAt", 0);
      __publicField(this, "instr", null);
      __publicField(this, "fpsHud", null);
      __publicField(this, "curBattle", null);
    }
    tween(dur, fn, done) {
      this.tweens.push({ t: 0, dur, fn, done });
    }
    /** Finish every running animation at once (so nothing is left half-way or undisposed when the phase changes). */
    flushTweens() {
      for (const w of this.tweens.splice(0)) {
        w.fn(1);
        if (w.done) w.done();
      }
    }
    async init(canvas) {
      const qs = new URLSearchParams(location.search);
      this.engine = new BABYLON.Engine(canvas, true, { antialias: true, powerPreference: "high-performance" });
      const dpr = window.devicePixelRatio || 1;
      this.engine.setHardwareScalingLevel(1 / Math.min(dpr, 1.5));
      const scene = this.scene = new BABYLON.Scene(this.engine);
      scene.clearColor = new BABYLON.Color4(0.09, 0.07, 0.13, 1);
      const hemi = new BABYLON.HemisphericLight("h", new BABYLON.Vector3(0.2, 1, 0.3), scene);
      hemi.intensity = 1.05;
      hemi.groundColor = new BABYLON.Color3(0.32, 0.26, 0.42);
      const sun = new BABYLON.DirectionalLight("s", new BABYLON.Vector3(-0.4, -1, 0.55), scene);
      sun.intensity = 0.85;
      this.camera = new BABYLON.FreeCamera("cam", new BABYLON.Vector3(0, 8, -9), scene);
      this.camera.minZ = 0.1;
      this.camera.maxZ = 200;
      this.camera.fov = 0.8;
      this.camera.inputs.clear();
      const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 60, height: 40 }, scene);
      const gm = new BABYLON.StandardMaterial("gm", scene);
      gm.diffuseColor = new BABYLON.Color3(0.17, 0.15, 0.21);
      gm.specularColor = BABYLON.Color3.Black();
      ground.material = gm;
      ground.isPickable = false;
      for (const team of [0, 1]) for (let c = 0; c < GRID_CELLS; c++) {
        const t = this.makeTile(team, c);
        if (team === 0) this.tiles.push(t);
        else t.setEnabled(false);
      }
      this.A = await loadAssets(scene);
      this.necro = new Necromancer(scene, this.A.soft);
      this.necro.holder.position.set(-(FRONT_X + (GRID_COLS - 1) * GRID_SP) - 1.05, 0, 0);
      this.necro.holder.rotation.y = Math.PI / 2;
      this.arrowMats = [0, 1].map((t) => {
        const m = new BABYLON.StandardMaterial("am" + t, scene);
        m.diffuseColor = BABYLON.Color3.Black();
        m.emissiveColor = t === 0 ? new BABYLON.Color3(0.75, 0.3, 1) : new BABYLON.Color3(1, 0.7, 0.25);
        m.disableLighting = true;
        return m;
      });
      this.ui = new Ui(this);
      this.seed = +(qs.get("seed") || 1);
      if (qs.get("fps")) this.setShowFps(true);
      let down = null;
      const local = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      canvas.addEventListener("pointerdown", (e) => {
        down = { ...local(e), t: performance.now() };
      });
      canvas.addEventListener("pointerup", (e) => {
        if (!down) return;
        const p = local(e);
        const moved = Math.hypot(p.x - down.x, p.y - down.y), dt = performance.now() - down.t;
        down = null;
        if (moved < 16 && dt < 900) this.tap(p.x, p.y);
      });
      canvas.addEventListener("pointercancel", () => {
        down = null;
      });
      this.canvas = canvas;
      const onResize = () => this.handleResize();
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", () => setTimeout(onResize, 250));
      if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);
      if (window.ResizeObserver) new window.ResizeObserver(onResize).observe(canvas);
      if (qs.get("gallery")) {
        this.gallery();
        return;
      }
      const saved = qs.get("seed") ? null : loadRun();
      if (saved) this.restore(saved);
      else this.startStage(this.seed);
      let last = performance.now();
      this.engine.runRenderLoop(() => {
        const now = performance.now(), raw = now - last;
        const dt = Math.min(0.05, raw / 1e3);
        last = now;
        if (!this.active) return;
        if (!this.frozen) this.frame(dt);
        scene.render();
        this.perfTick(raw);
      });
    }
    step(dt) {
      this.frame(dt);
    }
    setActive(on) {
      this.active = on;
    }
    // -------------------------------------------------------------------------------------------- scene helpers
    makeTile(team, cell) {
      const p = cellPos(team, cell), t = BABYLON.MeshBuilder.CreatePlane("tile" + cell, { size: GRID_SP * 0.92 }, this.scene);
      t.rotation.x = Math.PI / 2;
      t.position.set(p.x, 0.015, p.z);
      const m = new BABYLON.StandardMaterial("tm", this.scene);
      m.diffuseColor = BABYLON.Color3.Black();
      m.emissiveColor = team === 0 ? new BABYLON.Color3(0.18, 0.12, 0.42) : new BABYLON.Color3(0.42, 0.12, 0.12);
      m.alpha = 0.5;
      m.disableLighting = true;
      t.material = m;
      if (team === 0) {
        t.metadata = { kind: "tile", cell };
        this.tileMats[cell] = m;
      } else t.isPickable = false;
      return t;
    }
    tint(cell, mode) {
      const m = this.tileMats[cell];
      const c = { normal: [0.18, 0.12, 0.42, 0.5], free: [0.2, 0.75, 0.55, 0.7], sel: [1, 0.82, 0.3, 0.85], partner: [0.85, 0.35, 1, 0.85] }[mode];
      m.emissiveColor = new BABYLON.Color3(c[0], c[1], c[2]);
      m.alpha = c[3];
    }
    later(sec, fn) {
      this.timers.push({ t: sec, fn });
    }
    fxRing(x, z, color, r0, r1, dur) {
      const m = BABYLON.MeshBuilder.CreateTorus("fx", { diameter: 1, thickness: 0.035, tessellation: 28 }, this.scene);
      m.position.set(x, 0.05, z);
      m.isPickable = false;
      const mm = new BABYLON.StandardMaterial("fxm", this.scene);
      mm.emissiveColor = color;
      mm.disableLighting = true;
      mm.alpha = 0.9;
      m.material = mm;
      this.ringFx.push({ m, mm, t: 0, r0, r1, dur });
    }
    burst(x, z, c1, c2, count) {
      const ps = new BABYLON.ParticleSystem("b", 60, this.scene);
      ps.particleTexture = this.A.soft;
      ps.emitter = new BABYLON.Vector3(x, 0.05, z);
      ps.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.2);
      ps.maxEmitBox = new BABYLON.Vector3(0.2, 0.05, 0.2);
      ps.color1 = new BABYLON.Color4(...c1);
      ps.color2 = new BABYLON.Color4(...c2);
      ps.colorDead = new BABYLON.Color4(0.1, 0, 0.2, 0);
      ps.minSize = 0.12;
      ps.maxSize = 0.34;
      ps.minLifeTime = 0.4;
      ps.maxLifeTime = 0.9;
      ps.emitRate = 0;
      ps.manualEmitCount = count;
      ps.direction1 = new BABYLON.Vector3(-1, 1.3, -1);
      ps.direction2 = new BABYLON.Vector3(1, 2.4, 1);
      ps.minEmitPower = 0.8;
      ps.maxEmitPower = 2;
      ps.gravity = new BABYLON.Vector3(0, -2, 0);
      ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
      ps.targetStopDuration = 1.2;
      ps.disposeOnStop = true;
      ps.start();
    }
    // -------------------------------------------------------------------------------------------- camera
    poses() {
      const asp = this.engine.getRenderWidth() / this.engine.getRenderHeight(), tanV = Math.tan(this.camera.fov / 2);
      const half = FRONT_X + (GRID_COLS - 1) * GRID_SP + 1.4;
      const d = Math.max(half / (tanV * asp), (GRID_ROWS * GRID_SP / 2 + 2) / (tanV * 0.55), 8);
      const battle = { pos: new BABYLON.Vector3(-0.1 * d, 0.42 * d + 0.5, -0.86 * d), tgt: new BABYLON.Vector3(0, 0.35, 0) };
      const cx = -(FRONT_X + (GRID_COLS - 1) * GRID_SP / 2), H = Math.max(1, this.canvas.clientHeight);
      const box = (id) => {
        const el = document.getElementById(id);
        return el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
      };
      const topBar = box("top"), hand = box("hand"), info = box("info");
      const TOP = Math.min(0.32, topBar ? (topBar.bottom + 6) / H : 0.1);
      const BOTTOM = Math.min(0.5, (H - Math.min(hand ? hand.top : H, info ? info.top : H) + 6) / H);
      const band = Math.max(0.3, 1 - TOP - BOTTOM), centerFrac = TOP + band / 2;
      const gw = GRID_COLS * GRID_SP + 3.2, gh = GRID_ROWS * GRID_SP + 0.5;
      const d2 = Math.max(gh / (2 * tanV * band), gw / (2 * tanV * asp * 0.88), 4.5);
      const shift = (0.5 - centerFrac) * 2 * d2 * tanV, bx = cx - 0.6;
      const build = { pos: new BABYLON.Vector3(bx, d2, -shift - 0.1 * d2), tgt: new BABYLON.Vector3(bx, 0, -shift) };
      const necro = { pos: new BABYLON.Vector3(battle.pos.x - 1.4, battle.pos.y * 1.12, battle.pos.z * 1.12), tgt: new BABYLON.Vector3(-1.4, 0.35, 0) };
      return { battle, build, necro };
    }
    /** The hand / info bar can change size in the build phase (long ability text, more cards): re-frame so the grid never hides behind it. */
    reframeBuild() {
      if (this.phase !== "build" || this.camT < 1 || this.cine || !this.canvas) return;
      const p = this.poses().build, c = this.camera.position;
      if (!isFinite(p.pos.x) || BABYLON.Vector3.Distance(c, p.pos) < 0.06) return;
      this.tweenCam(p, 0.35);
    }
    handleResize() {
      if (!this.canvas.clientWidth || !this.canvas.clientHeight) return;
      this.engine.resize();
      this.lastW = this.canvas.clientWidth;
      this.lastH = this.canvas.clientHeight;
      if (this.phase === "build" && this.camT >= 1) this.setCam(this.poses().build);
    }
    /** A tap on the 3D view: pick a tile or a unit. */
    tap(x, y) {
      const p = this.scene.pick(x, y, (m) => !!(m.metadata && m.metadata.kind));
      const md = p && p.hit ? p.pickedMesh.metadata : null;
      this.lastTapInfo = `tap ${Math.round(x)},${Math.round(y)} of ${this.canvas.clientWidth}x${this.canvas.clientHeight} -> ${md ? md.kind === "tile" ? "tile " + md.cell : "unit" : "nothing"} (phase ${this.phase})`;
      if (this.phase !== "build" || !md) return;
      if (md.kind === "tile") this.onTile(md.cell);
      else if (md.kind === "unit") this.onUnitVisual(md.visual);
    }
    setCam(p) {
      this.camera.position.copyFrom(p.pos);
      this.camera.setTarget(p.tgt.clone());
    }
    tweenCam(to, dur) {
      this.camFrom = { pos: this.camera.position.clone(), tgt: this.camera.getTarget().clone() };
      this.camTo = to;
      this.camT = 0;
      this.camDur = dur;
    }
    setCamMode(m) {
      this.camMode = m;
      if (m === "wide" && this.battle) this.tweenCam(this.poses().battle, 0.9);
      this.ui.render();
    }
    frameBattle(dt) {
      const b = this.battle;
      if (!b) return;
      const alive = b.fighters.filter((f) => f.alive);
      if (!alive.length) return;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const f of alive) {
        x0 = Math.min(x0, f.x);
        x1 = Math.max(x1, f.x);
        z0 = Math.min(z0, f.z);
        z1 = Math.max(z1, f.z);
      }
      const asp = this.engine.getRenderWidth() / this.engine.getRenderHeight(), tanV = Math.tan(this.camera.fov / 2);
      const wide = this.poses().battle, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const d = Math.min(Math.max((x1 - x0 + 3.4) / (2 * tanV * asp * 0.9), (z1 - z0 + 3.2) / (2 * tanV * 0.62), 5.4), Math.hypot(wide.pos.y, wide.pos.z));
      const tgt = new BABYLON.Vector3(cx, 0.55, cz), pos = new BABYLON.Vector3(cx - 0.06 * d, 0.32 * d + 0.5, cz - 0.9 * d);
      const k = 1 - Math.exp(-dt * 2);
      this.camera.position = BABYLON.Vector3.Lerp(this.camera.position, pos, k);
      this.camTgt = BABYLON.Vector3.Lerp(this.camTgt, tgt, k);
      this.camera.setTarget(this.camTgt.clone());
    }
    // -------------------------------------------------------------------------------------------- stage flow
    /** Write the run to disk (calm moments only: build phase and the victory draft). */
    persistRun() {
      try {
        const s = this.s;
        if (!s) return;
        if (s.status !== "building") {
          clearRun();
          return;
        }
        if (this.phase !== "build" && this.phase !== "draft") return;
        const snap = { v: 1, seed: this.seed, attempt: this.attempt, difficulty: difficultyName, phase: this.phase, draft: this.phase === "draft" ? this.draft : null, state: serializeState(s) };
        saveRun(snap);
      } catch {
      }
    }
    /** Rebuild the screen from a saved run (a reload, or Safari discarding the page). */
    restore(r) {
      const { snap, state } = r;
      this.cine = false;
      this.flushTweens();
      this.necro.revive();
      setDifficulty(snap.difficulty);
      this.seed = snap.seed;
      this.attempt = snap.attempt;
      this.s = state;
      this.seenMerges = state.stats.merges;
      this.clearBattle();
      [...this.unitVis.values()].forEach((v) => v.dispose());
      this.unitVis.clear();
      this.visToUnit.clear();
      this.sel = null;
      this.swapMode = false;
      this.draft = snap.phase === "draft" ? snap.draft : null;
      this.phase = this.draft ? "draft" : "build";
      this.syncBuild();
      this.ui.render();
      this.setCam(this.poses().build);
      this.toast(`Run restored: wave ${state.wave}/${stageWaves(state)}, ${state.hearts} heart${state.hearts === 1 ? "" : "s"}.`);
    }
    setShowFps(on) {
      this.showFps = on;
      if (on && !this.fpsHud) {
        const h = document.createElement("div");
        h.id = "fpsHud";
        (document.getElementById("battleHost") || document.body).appendChild(h);
        this.fpsHud = h;
      }
      if (this.fpsHud) this.fpsHud.style.display = on ? "block" : "none";
    }
    perfTick(ms) {
      var _a, _b;
      if (ms > 500) return;
      this.perfBuf[this.perfI] = ms;
      this.perfI = (this.perfI + 1) % this.perfBuf.length;
      this.perfN = Math.min(this.perfBuf.length, this.perfN + 1);
      const c = this.curBattle;
      if (c && (this.phase === "battle" || this.phase === "transition")) {
        c.frames++;
        c.sum += ms;
        if (ms > c.worst) c.worst = ms;
        if (ms > 33.4) c.slow++;
        c.scale = Math.max(c.scale, this.timeScale);
      }
      const now = performance.now();
      if (now - this.perfShownAt < 500) return;
      this.perfShownAt = now;
      const a = Array.from(this.perfBuf.subarray(0, this.perfN)).sort((x, y) => x - y), avg = a.reduce((n, x) => n + x, 0) / a.length;
      this.perfNow = { fps: 1e3 / avg, avg, p95: (_a = a[Math.floor(a.length * 0.95)]) != null ? _a : 0, worst: (_b = a[a.length - 1]) != null ? _b : 0 };
      if (this.fpsHud && this.showFps) this.fpsHud.textContent = `${this.perfNow.fps.toFixed(0)} fps  ${this.perfNow.avg.toFixed(1)}ms  slow5% ${this.perfNow.p95.toFixed(0)}ms`;
      this.ui.renderDebugLive();
    }
    beginBattlePerf() {
      this.curBattle = { frames: 0, sum: 0, worst: 0, slow: 0, scale: this.timeScale };
    }
    endBattlePerf() {
      const c = this.curBattle;
      this.curBattle = null;
      if (!c || !c.frames) return;
      this.perfLog.push({ wave: this.s.wave, attempt: this.attempt, speed: c.scale, fighters: this.battle ? this.battle.fighters.length : 0, fps: +(1e3 / (c.sum / c.frames)).toFixed(0), worstMs: +c.worst.toFixed(0), slowPct: +(100 * c.slow / c.frames).toFixed(1) });
      if (this.perfLog.length > 12) this.perfLog.shift();
    }
    perfInfo() {
      const sc = this.scene;
      if (!this.instr && BABYLON.SceneInstrumentation) this.instr = new BABYLON.SceneInstrumentation(sc);
      return { ...this.perfNow, meshes: sc.getActiveMeshes().length, particles: sc.particleSystems.length, draws: this.instr ? this.instr.drawCallsCounter.current : -1 };
    }
    perfReport() {
      const p = this.perfInfo(), gl = this.engine.getGlInfo ? this.engine.getGlInfo() : {};
      const rows = this.perfLog.map((r) => `  wave ${r.wave} try ${r.attempt} at ${r.speed}x: ${r.fps} fps average, worst frame ${r.worstMs}ms, ${r.slowPct}% slow frames, ${r.fighters} fighters`);
      return [
        `PERF ${(/* @__PURE__ */ new Date()).toISOString()}`,
        `device: ${navigator.userAgent}`,
        `gpu: ${gl.renderer || "?"} (${gl.vendor || "?"})`,
        `screen ${screen.width}x${screen.height}  viewport ${innerWidth}x${innerHeight}  dpr ${devicePixelRatio}  render ${this.engine.getRenderWidth()}x${this.engine.getRenderHeight()}  scaling level ${this.engine.getHardwareScalingLevel().toFixed(2)}`,
        `now: ${p.fps.toFixed(0)} fps, average ${p.avg.toFixed(1)}ms, slowest 5% ${p.p95.toFixed(0)}ms, worst ${p.worst.toFixed(0)}ms | active meshes ${p.meshes}, particle systems ${p.particles}, draw calls ${p.draws}`,
        `state: phase ${this.phase}, speed ${this.timeScale}x, camera ${this.camMode}, difficulty ${difficultyName}, wave ${this.s.wave}, units ${this.s.units.length}`,
        `battles (newest last):`,
        ...rows.length ? rows : ["  (none yet: play a battle, then copy this again)"]
      ].join("\n");
    }
    /** A run the player has really started (so Home can offer Continue). Null after a stage was won or lost, or before anything was done. */
    runInfo() {
      const s = this.s;
      if (!s || s.status !== "building") return null;
      return s.wave > 1 || s.units.length > 0 || this.attempt > 0 || s.stats.failures > 0 ? { wave: s.wave, total: stageWaves(s), hearts: s.hearts, difficulty: difficultyName } : null;
    }
    /** Fresh run with the currently equipped Soul Deck (Home > Start Battle calls this). */
    newRun() {
      this.startStage(new URLSearchParams(location.search).get("seed") ? this.seed : Math.floor(Math.random() * 1e6) + 1);
    }
    startStage(seed) {
      this.cine = false;
      this.reward = null;
      this.flushTweens();
      if (this.necro) this.necro.revive();
      this.seed = seed;
      this.attempt = 0;
      const sv = loadSave();
      setDifficulty(sv.difficulty);
      this.s = newStage({ ...PROTOTYPE_RULES, pool: sv.deck }, seed);
      this.seenMerges = 0;
      this.clearBattle();
      [...this.unitVis.values()].forEach((v) => v.dispose());
      this.unitVis.clear();
      this.visToUnit.clear();
      this.sel = null;
      this.swapMode = false;
      this.draft = null;
      this.phase = "build";
      this.syncBuild();
      this.ui.render();
      this.setCam(this.poses().build);
      this.toast("Stage start: 4 cards, " + this.s.cap + " Dominion. Summon, merge, then press BATTLE.");
    }
    clearBattle() {
      this.fvis.forEach((v, id) => {
        if (!this.fUnit.has(id)) v.dispose();
      });
      this.fvis.clear();
      this.fUnit.clear();
      this.lastState.clear();
      this.battle = null;
      this.arrows.forEach((a) => a.mesh.dispose());
      this.arrows = [];
    }
    pos(cell) {
      return cellPos(0, cell);
    }
    syncBuild() {
      this.persistRun();
      const merged = this.s.stats.merges > this.seenMerges;
      this.seenMerges = this.s.stats.merges;
      const grown = merged ? this.s.units.find((u) => {
        const gv = this.unitVis.get(u.id);
        return !!gv && gv.star !== u.star;
      }) : void 0;
      const alive = new Set(this.s.units.map((u) => u.id));
      for (const [id, v] of this.unitVis) if (!alive.has(id)) {
        this.visToUnit.delete(v);
        this.unitVis.delete(id);
        const p = v.holder.position;
        if (grown) {
          const to = this.pos(grown.cell), x0 = p.x, z0 = p.z, sc = v.holder.scaling.x;
          v.play("idle");
          this.tween(
            0.33,
            (t) => {
              v.holder.position.set(x0 + (to.x - x0) * t, Math.sin(t * Math.PI) * 0.4, z0 + (to.z - z0) * t);
              v.holder.scaling.setAll(sc * (1 - 0.75 * t));
            },
            () => {
              this.burst(to.x, to.z, [0.85, 0.6, 1, 0.9], [0.5, 0.3, 1, 0.7], 14);
              v.dispose();
            }
          );
        } else {
          this.burst(p.x, p.z, [0.6, 0.5, 0.7, 0.8], [0.3, 0.2, 0.5, 0.6], 16);
          v.dispose();
        }
      }
      for (const u of this.s.units) {
        let v = this.unitVis.get(u.id);
        const p = this.pos(u.cell);
        if (!v) {
          v = createVisual(this.A, u.soul, 0, u.star);
          this.unitVis.set(u.id, v);
          this.visToUnit.set(v, u.id);
          v.holder.position.set(p.x, 0, p.z);
          v.holder.rotation.y = Math.PI / 2;
          v.play("spawn");
          this.summonFx(p.x, p.z);
          audio.play("summon");
          const vv = v;
          this.later(1.1, () => {
            if (this.phase === "build") vv.play("idle");
          });
        } else {
          v.holder.position.set(p.x, 0, p.z);
          v.holder.rotation.y = Math.PI / 2;
          if (v.star !== u.star) {
            const fv = v;
            v.setStar(u.star);
            this.later(grown && grown.id === u.id ? 0.33 : 0, () => this.mergeFx(fv, p.x, p.z));
          }
        }
      }
      for (let c = 0; c < GRID_CELLS; c++) this.tint(c, "normal");
      const sel = this.sel;
      if (sel && sel.type === "card" && this.phase === "build") {
        for (let c = 0; c < GRID_CELLS; c++) if (cellFree(this.s, c)) this.tint(c, canSummon(this.s, sel.idx) ? "free" : "normal");
        for (const u of this.s.units) if (canMergeFromHand(this.s, sel.idx, u.id)) this.tint(u.cell, "partner");
      }
      if (sel && sel.type === "unit") {
        const u = this.s.units.find((x) => x.id === sel.id);
        if (u) {
          this.tint(u.cell, "sel");
          for (const o of this.s.units) if (canMergeDeployed(u, o)) this.tint(o.cell, "partner");
          for (let c = 0; c < GRID_CELLS; c++) if (cellFree(this.s, c)) this.tint(c, "free");
        }
      }
    }
    /** The merge moment: a flash of rings and sparks, a punch in size, a rising chime. */
    mergeFx(v, x, z) {
      audio.play("merge");
      v.pulse();
      const target = v.holder.scaling.x;
      this.fxRing(x, z, new BABYLON.Color3(1, 0.85, 0.4), 0.2, 2, 0.65);
      this.later(0.12, () => this.fxRing(x, z, new BABYLON.Color3(1, 1, 1), 0.2, 3, 0.8));
      this.burst(x, z, [1, 0.85, 0.4, 0.9], [0.8, 0.4, 1, 0.8], 46);
      this.burst(x, z, [0.85, 0.6, 1, 0.9], [0.5, 0.3, 1, 0.7], 24);
      this.tween(0.55, (t) => v.holder.scaling.setAll(target * (1 + 0.45 * Math.sin(t * Math.PI) * (1 - t * 0.4))), () => v.holder.scaling.setAll(target));
    }
    summonFx(x, z) {
      this.burst(x, z, [0.7, 0.3, 1, 0.9], [0.35, 0.1, 0.7, 0.8], 30);
      this.fxRing(x, z, new BABYLON.Color3(0.7, 0.3, 1), 0.2, 1.2, 0.7);
    }
    // ---- player actions (build phase)
    toast(msg) {
      this.ui.toast(msg);
    }
    onCard(idx) {
      if (this.phase !== "build") return;
      if (this.swapMode) {
        if (discardRedraw(this.s, idx)) {
          this.toast("Swapped: drew a different Soul.");
          this.swapMode = false;
        } else this.toast("Swap already used this round.");
      } else this.sel = this.sel && this.sel.type === "card" && this.sel.idx === idx ? null : { type: "card", idx };
      this.confirmRemove = false;
      this.syncBuild();
      this.ui.render();
    }
    onTile(cell) {
      const s = this.s, sel = this.sel;
      if (this.phase !== "build") return;
      const here = s.units.find((u) => u.cell === cell);
      if (here) {
        this.onUnitVisual(this.unitVis.get(here.id));
        return;
      }
      if (sel && sel.type === "card") {
        if (canSummon(s, sel.idx)) {
          summon(s, sel.idx, cell);
          this.sel = null;
        } else {
          const soul = s.hand[sel.idx];
          this.toast(`Not enough Dominion: ${SOUL_NAME[soul]} costs ${cost(soul, 1)}, you have ${dominionFree(s)} free.`);
        }
      } else if (sel && sel.type === "unit") {
        if (moveUnit(s, sel.id, cell)) this.sel = null;
      }
      this.confirmRemove = false;
      this.syncBuild();
      this.ui.render();
    }
    onUnitVisual(v) {
      const id = this.visToUnit.get(v);
      if (id === void 0 || this.phase !== "build") return;
      const s = this.s, u = s.units.find((x) => x.id === id);
      if (this.swapMode) {
        if (swapSell(s, id)) {
          this.toast(`Sold ${SOUL_NAME[u.soul]}: drew a different Soul.`);
          this.swapMode = false;
        } else this.toast(u.fresh ? "You can't sell a unit you summoned this round." : "Swap already used this round.");
      } else if (this.sel && this.sel.type === "card" && s.hand[this.sel.idx] === u.soul && u.star === 1 && s.rules.merge === "handIntoOneStar") {
        if (mergeFromHand(s, this.sel.idx, id)) {
          this.sel = { type: "unit", id };
          this.toast(`Merged the card into a 2-star ${SOUL_NAME[u.soul]}!`);
        } else this.toast(`Not enough Dominion to merge: it needs ${cost(u.soul, 2) - cost(u.soul, 1)} more, you have ${dominionFree(s)} free.`);
      } else if (this.sel && this.sel.type === "unit" && this.sel.id !== id) {
        const a = s.units.find((x) => x.id === this.sel.id);
        if (canMergeDeployed(a, u)) {
          mergeDeployed(s, a.id, u.id);
          this.sel = { type: "unit", id: a.id };
          this.toast(`Merged into a ${a.star}-star ${SOUL_NAME[a.soul]}!`);
        } else this.sel = { type: "unit", id };
      } else this.sel = this.sel && this.sel.type === "unit" && this.sel.id === id ? null : { type: "unit", id };
      this.confirmRemove = false;
      this.syncBuild();
      this.ui.render();
    }
    mergeSelected() {
      const s = this.s, sel = this.sel;
      if (!sel || sel.type !== "unit") return;
      const a = s.units.find((x) => x.id === sel.id);
      const b = a && s.units.find((o) => canMergeDeployed(a, o));
      if (a && b) {
        mergeDeployed(s, a.id, b.id);
        this.toast(`Merged into a ${a.star}-star ${SOUL_NAME[a.soul]}!`);
      } else this.toast("No matching unit (same Soul and stars) to merge with.");
      this.syncBuild();
      this.ui.render();
    }
    removeSelected() {
      const sel = this.sel;
      if (!sel || sel.type !== "unit") return;
      if (!this.confirmRemove) {
        this.confirmRemove = true;
        this.toast("Tap Remove again to confirm. The card is gone for this stage.");
        this.ui.render();
        return;
      }
      dismiss(this.s, sel.id);
      this.sel = null;
      this.confirmRemove = false;
      this.syncBuild();
      this.ui.render();
    }
    toggleSwap() {
      if (this.phase !== "build") return;
      if (this.s.discardUsed) {
        this.toast("Swap already used this round.");
        return;
      }
      this.swapMode = !this.swapMode;
      this.sel = null;
      if (this.swapMode) this.toast("Swap: tap a hand card to discard, or a unit (not summoned this round) to sell.");
      this.syncBuild();
      this.ui.render();
    }
    // -------------------------------------------------------------------------------------------- battle
    startBattle() {
      if (this.phase !== "build" || !this.s.units.length) {
        if (!this.s.units.length) this.toast("Summon at least one unit first.");
        return;
      }
      this.flushTweens();
      audio.play("start");
      this.beginBattlePerf();
      this.sel = null;
      this.swapMode = false;
      this.attempt++;
      this.handled = false;
      this.resultAt = -1;
      const s = this.s, units = s.units.slice();
      const saved = loadSave().souls, levels = {};
      for (const k of Object.keys(saved)) levels[k] = saved[k].level;
      this.battle = new Battle(units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell })), enemyWave(s.wave, this.seed), this.seed * 131 + s.wave * 17 + this.attempt, levels);
      this.fvis.clear();
      this.fUnit.clear();
      this.lastState.clear();
      this.battle.fighters.forEach((f) => {
        if (f.team === 0) {
          const u = units[f.id - 1];
          const v = this.unitVis.get(u.id);
          this.fvis.set(f.id, v);
          this.fUnit.set(f.id, u.id);
          v.setHp(1);
          v.setMana(f.maxMana ? 0 : null);
        } else {
          const v = createVisual(this.A, f.soul, 1, f.star);
          v.holder.position.set(f.x, 0, f.z);
          v.holder.rotation.y = -Math.PI / 2;
          v.play("spawn");
          v.setHp(1);
          v.setMana(f.maxMana ? 0 : null);
          this.fvis.set(f.id, v);
          this.later(1.1, () => {
            if (v.state === "spawn") v.play("idle");
          });
          this.burst(f.x, f.z, [0.7, 0.6, 0.5, 0.7], [0.4, 0.35, 0.3, 0.6], 14);
        }
      });
      for (let c = 0; c < GRID_CELLS; c++) this.tint(c, "normal");
      this.phase = "transition";
      this.startStepAt = 1;
      this.acc = 0;
      this.tweenCam(this.poses().battle, 2.2);
      this.syncBuild();
      this.ui.render();
    }
    applyEvents(evs) {
      const b = this.battle;
      for (const e of evs) {
        if (e.t === "swing") {
          const v = this.fvis.get(e.id);
          if (v) v.play("attack", e.speed);
        } else if (e.t === "hit") {
          const v = this.fvis.get(e.to);
          if (v) v.pulse();
          if (e.kind === "arrow") audio.play("hitArrow");
          else if (e.kind === "melee") audio.play("hit");
        } else if (e.t === "arrow") {
          const f = b.byId(e.from), to = b.byId(e.to);
          this.spawnArrow(f.team, f.x, f.z, to.x, to.z, e.dur);
          audio.play("arrow");
        } else if (e.t === "death") {
          const v = this.fvis.get(e.id);
          if (v) {
            v.play("death");
            v.setHp(null);
            v.setMana(null);
            const f = b.byId(e.id);
            audio.play("death");
            this.burst(f.x, f.z, [0.6, 0.5, 0.7, 0.8], [0.3, 0.2, 0.5, 0.6], 12);
            if (f.team === 1) this.later(5, () => {
              if (this.fvis.get(e.id) === v && this.phase !== "build") {
                v.holder.setEnabled(false);
              }
            });
          }
        } else if (e.t === "cast") {
          const f = b.byId(e.id);
          audio.play("cast");
          this.fxRing(f.x, f.z, new BABYLON.Color3(0.5, 0.8, 1), 0.15, 1.1, 0.35);
        } else if (e.t === "taunt") {
          const f = b.byId(e.id);
          audio.play("taunt");
          this.fxRing(f.x, f.z, new BABYLON.Color3(1, 0.85, 0.3), 0.3, BALANCE.taunt.radius, 0.6);
        } else if (e.t === "smash") {
          audio.play("smash");
          this.fxRing(e.x, e.z, new BABYLON.Color3(1, 0.5, 0.2), 0.2, e.r * 1.6, 0.45);
        }
      }
    }
    spawnArrow(team, x0, z0, x1, z1, dur) {
      let mesh = this.arrowMesh.pop();
      if (!mesh) {
        mesh = BABYLON.MeshBuilder.CreateCylinder("arrow", { height: 0.55, diameter: 0.035 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.isPickable = false;
        const holder = new BABYLON.TransformNode("ar", this.scene);
        mesh.parent = holder;
        mesh = holder;
      }
      mesh.setEnabled(true);
      mesh.getChildMeshes()[0].material = this.arrowMats[team];
      this.arrows.push({ mesh, x0, z0, x1, z1, t: 0, dur });
    }
    frame(dt) {
      if (this.canvas.clientWidth !== this.lastW || this.canvas.clientHeight !== this.lastH) this.handleResize();
      for (let i = this.timers.length - 1; i >= 0; i--) {
        this.timers[i].t -= dt;
        if (this.timers[i].t <= 0) {
          const f = this.timers[i].fn;
          this.timers.splice(i, 1);
          f();
        }
      }
      for (let i = this.ringFx.length - 1; i >= 0; i--) {
        const r = this.ringFx[i];
        r.t += dt;
        const u = r.t / r.dur, s = r.r0 + (r.r1 - r.r0) * u;
        r.m.scaling.set(s, s, s);
        r.mm.alpha = 0.9 * (1 - u);
        if (u >= 1) {
          r.m.dispose();
          r.mm.dispose();
          this.ringFx.splice(i, 1);
        }
      }
      if (this.camT < 1) {
        this.camT = Math.min(1, this.camT + dt / this.camDur);
        const e = this.camT * this.camT * (3 - 2 * this.camT);
        this.camera.position = BABYLON.Vector3.Lerp(this.camFrom.pos, this.camTo.pos, e);
        this.camTgt = BABYLON.Vector3.Lerp(this.camFrom.tgt, this.camTo.tgt, e);
        this.camera.setTarget(this.camTgt.clone());
      } else if (this.phase === "battle" && this.camMode === "close" && !this.cine) this.frameBattle(dt);
      this.necro.update(dt);
      for (let i = this.tweens.length - 1; i >= 0; i--) {
        const w = this.tweens[i];
        w.t += dt;
        const u = Math.min(1, w.t / w.dur);
        w.fn(u);
        if (u >= 1) {
          this.tweens.splice(i, 1);
          if (w.done) w.done();
        }
      }
      for (const v of this.unitVis.values()) v.update(dt);
      this.fvis.forEach((v, id) => {
        if (!this.fUnit.has(id)) v.update(dt);
      });
      const b = this.battle;
      if ((this.phase === "transition" || this.phase === "battle") && b) {
        if (this.phase === "transition") {
          this.startStepAt -= dt;
          if (this.startStepAt <= 0) {
            this.phase = "battle";
            this.ui.render();
          }
        }
        if (this.phase === "battle") {
          this.acc += dt * this.timeScale;
          while (this.acc >= 1 / 30 && b.winner < 0) {
            b.step(1 / 30);
            this.acc -= 1 / 30;
            this.applyEvents(b.drain());
          }
        }
        for (const f of b.fighters) {
          const v = this.fvis.get(f.id);
          if (!v) continue;
          if (!this.cine && (this.phase === "battle" || f.team === 1)) {
            v.holder.position.x = f.x;
            v.holder.position.z = f.z;
            if (f.alive || true) v.holder.rotation.y = f.yaw;
          }
          if (f.alive) {
            v.setHp(f.hp / f.maxHp);
            if (f.maxMana) v.setMana(f.mana / f.maxMana);
          } else v.setMana(null);
          if (f.state !== "attack" && f.alive) {
            const want = f.state === "run" ? "run" : "idle";
            if (this.lastState.get(f.id) !== want || v.state !== want && v.state !== "spawn") {
              if (v.state !== "spawn") {
                v.play(want);
                this.lastState.set(f.id, want);
              }
            }
          }
          if (f.state === "attack") this.lastState.set(f.id, "attack");
        }
        if (b.winner >= 0 && !this.handled) {
          this.handled = true;
          this.resultAt = 1.4;
        }
        if (this.resultAt > 0) {
          this.resultAt -= dt;
          if (this.resultAt <= 0) this.handleResult();
        }
      }
      for (let i = this.arrows.length - 1; i >= 0; i--) {
        const a = this.arrows[i];
        a.t += dt * this.timeScale;
        const u = Math.min(1, a.t / a.dur);
        const px = a.x0 + (a.x1 - a.x0) * u, pz = a.z0 + (a.z1 - a.z0) * u, py = 0.75 + Math.sin(u * Math.PI) * 0.9 - u * 0.25;
        const u2 = Math.min(1, u + 0.03), qx = a.x0 + (a.x1 - a.x0) * u2, qz = a.z0 + (a.z1 - a.z0) * u2, qy = 0.75 + Math.sin(u2 * Math.PI) * 0.9 - u2 * 0.25;
        a.mesh.position.set(px, py, pz);
        a.mesh.lookAt(new BABYLON.Vector3(qx, qy, qz));
        if (u >= 1) {
          a.mesh.setEnabled(false);
          this.arrowMesh.push(a.mesh);
          this.arrows.splice(i, 1);
        }
      }
    }
    handleResult() {
      const b = this.battle, s = this.s;
      this.endBattlePerf();
      this.lastBattle = `wave ${s.wave} attempt ${this.attempt}: ${b.winner === 0 ? "WON" : "LOST"} in ${b.time.toFixed(1)}s, ${b.count(0)} of yours and ${b.count(1)} enemies left`;
      if (b.winner === 0) {
        this.playResult("win", () => {
          this.cine = false;
          if (advanceWave(s)) {
            this.phase = "won";
            clearRun();
            try {
              this.reward = recordClearAndSave("crypt", difficultyName);
              window.dispatchEvent(new Event("necro-save-changed"));
            } catch {
              this.reward = null;
            }
            this.ui.render();
            return;
          }
          this.draft = draftOptions(s);
          this.phase = "draft";
          this.persistRun();
          this.ui.render();
        });
      } else {
        failWave(s);
        this.ui.render();
        this.ui.pulseHearts();
        if (s.status === "lost") this.playResult("final", () => {
          this.cine = false;
          this.phase = "lost";
          clearRun();
          this.ui.render();
        });
        else this.playResult("loss", () => {
          this.toast("Your army fell. -1 heart, +1 card, same wave. Rebuild a different strategy.");
          this.toBuild();
        });
      }
    }
    // ---- result cutscenes (plan sections 19-22): the Necromancer takes the hit, unleashes the repulsion shockwave, raises the fallen
    playResult(kind, done) {
      const b = this.battle, n = this.necro;
      this.cine = true;
      this.tweenCam(this.poses().necro, 1.1);
      const home = () => {
        n.cast();
        audio.play("resurrect");
        const c = n.crystalPos();
        this.burst(c.x, c.z, [0.85, 0.5, 1, 0.9], [0.5, 0.2, 1, 0.7], 30);
        for (const f of b.fighters) {
          if (f.team !== 0) continue;
          const uid = this.fUnit.get(f.id), u = this.s.units.find((x) => x.id === uid), v = this.fvis.get(f.id);
          if (!u || !v) continue;
          const to = this.pos(u.cell), x0 = v.holder.position.x, z0 = v.holder.position.z;
          v.setHp(null);
          v.setMana(null);
          if (!f.alive) {
            v.play("spawn");
            this.burst(x0, z0, [0.75, 0.4, 1, 0.9], [0.4, 0.15, 0.9, 0.7], 18);
            this.fxRing(x0, z0, new BABYLON.Color3(0.7, 0.35, 1), 0.3, 1.6, 0.7);
          }
          this.tween(
            1,
            (t) => {
              v.holder.position.set(x0 + (to.x - x0) * t, Math.sin(t * Math.PI) * 0.5, z0 + (to.z - z0) * t);
              v.holder.rotation.y += (Math.PI / 2 - v.holder.rotation.y) * Math.min(1, t * 0.5 + 0.1);
            },
            () => {
              v.holder.position.y = 0;
              this.burst(to.x, to.z, [0.75, 0.4, 1, 0.9], [0.4, 0.15, 0.9, 0.7], 10);
            }
          );
        }
      };
      if (kind === "win") {
        n.cast();
        audio.play("victory");
        this.later(0.25, home);
        this.later(2, done);
        return;
      }
      n.hurt();
      audio.play("heartLost");
      this.later(0.15, () => {
        const c = n.crystalPos();
        this.burst(c.x, c.z, [1, 0.3, 0.3, 0.9], [0.8, 0.1, 0.2, 0.6], 16);
      });
      if (kind === "final") {
        this.later(0.6, () => {
          n.defeat();
          audio.play("defeat");
        });
        this.later(2.6, done);
        return;
      }
      this.later(1, () => {
        n.cast();
        audio.play("shockwave");
        const c = n.crystalPos();
        this.fxRing(c.x, 0, new BABYLON.Color3(0.85, 0.55, 1), 0.6, 30, 1.1);
        this.fxRing(c.x, 0, new BABYLON.Color3(1, 1, 1), 0.4, 22, 0.8);
        this.burst(c.x, c.z, [1, 0.85, 1, 0.9], [0.7, 0.4, 1, 0.7], 40);
        for (const f of b.fighters) {
          if (f.team !== 1 || !f.alive) continue;
          const v = this.fvis.get(f.id);
          if (!v) continue;
          const to = cellPos(1, f.cell), x0 = v.holder.position.x, z0 = v.holder.position.z;
          v.pulse();
          this.tween(0.9, (t) => {
            v.holder.position.set(x0 + (to.x - x0) * t, Math.sin(t * Math.PI) * 0.9, z0 + (to.z - z0) * t);
            v.setHp(f.hp / f.maxHp + (1 - f.hp / f.maxHp) * t);
          }, () => {
            v.holder.position.y = 0;
            v.setHp(1);
          });
        }
      });
      this.later(2.3, home);
      this.later(3.7, done);
    }
    pickDraft(idx) {
      if (!this.draft) return;
      takeDraft(this.s, this.draft, idx);
      this.draft = null;
      normalDraw(this.s);
      this.toBuild();
    }
    toBuild() {
      this.cine = false;
      this.necro.revive();
      this.flushTweens();
      this.clearBattle();
      for (const u of this.s.units) {
        const v = this.unitVis.get(u.id);
        const p = this.pos(u.cell);
        v.holder.position.set(p.x, 0, p.z);
        v.holder.rotation.y = Math.PI / 2;
        v.holder.setEnabled(true);
        v.setHp(null);
        v.setMana(null);
        v.play("spawn");
        this.summonFx(p.x, p.z);
        this.later(1.1, () => v.play("idle"));
      }
      this.phase = "build";
      this.sel = null;
      this.syncBuild();
      this.ui.render();
      this.tweenCam(this.poses().build, 1.8);
    }
    setSpeed(k) {
      this.timeScale = k;
      this.ui.render();
    }
    // -------------------------------------------------------------------------------------------- debug helpers
    applyBalanceChange() {
      this.unitVis.forEach((v, id) => {
        const u = this.s.units.find((x) => x.id === id);
        if (u) v.setStar(u.star);
      });
    }
    testOdds(n = 200) {
      const slots = this.s.units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell })), enemies = enemyWave(this.s.wave, this.seed);
      let win = 0, t = 0;
      for (let i = 0; i < n; i++) {
        const r = simulate(slots, enemies, 5e3 + i);
        if (r.winner === 0) win++;
        t += r.time;
      }
      return { win: Math.round(win / n * 100), avgTime: +(t / n).toFixed(1), n };
    }
    addCard(soul) {
      this.s.hand.push(soul);
      this.s.stats.drawn++;
      this.ui.render();
    }
    addDominion(n) {
      this.s.cap += n;
      this.ui.render();
    }
    report() {
      const s = this.s, en = enemyWave(s.wave, this.seed);
      return [
        `seed ${this.seed}  wave ${s.wave}/${stageWaves(s)}  hearts ${s.hearts}  dominion ${dominionUsed(s)}/${s.cap}  phase ${this.phase}  attempt ${this.attempt}`,
        `hand: ${s.hand.join(", ") || "(empty)"}`,
        `army: ${s.units.map((u) => `${u.soul}${u.star}@${u.cell}`).join(" ") || "(none)"}`,
        `enemy: ${en.map((e) => e.soul + e.star).join(" ")}`,
        `difficulty: ${difficultyName}  merge-from-hand: ${s.rules.merge === "handIntoOneStar"}  swap used: ${s.discardUsed}`,
        `last tap: ${this.lastTapInfo}`,
        `screen: ${this.canvas.clientWidth}x${this.canvas.clientHeight} dpr ${window.devicePixelRatio}`,
        `last battle: ${this.lastBattle || "-"}`,
        `log tail:`,
        ...s.log.slice(-8),
        `balance: ${JSON.stringify({ star: BALANCE.star, stats: BALANCE.stats })}`
      ].join("\n");
    }
    resetBalanceAll() {
      resetBalance();
      this.applyBalanceChange();
    }
    get difficulty() {
      return difficultyName;
    }
    changeDifficulty(name) {
      setDifficulty(name);
      this.ui.render();
      this.toast(`Difficulty: ${name}. Applies to the next battle.`);
    }
    // -------------------------------------------------------------------------------------------- gallery (star looks)
    gallery() {
      document.body.classList.add("gallery");
      this.necro.setEnabled(false);
      const vis = [];
      let team = 0;
      const rebuild = () => {
        vis.forEach((v) => v.dispose());
        vis.length = 0;
        SOULS.forEach((soul, i) => [1, 2, 3].forEach((st, j) => {
          const v = createVisual(this.A, soul, team, st);
          v.holder.position.set((i - 2.5) * 2.5, 0, (j - 1) * -2.4);
          v.holder.rotation.y = Math.PI * 0.85;
          v.play("idle");
          vis.push(v);
        }));
      };
      rebuild();
      this.camera.position.set(0, 5.6, -14.5);
      this.camera.setTarget(new BABYLON.Vector3(0, 0.5, -0.4));
      this.camera.fov = 0.85;
      window.__gallery = { setTeam: (t) => {
        team = t;
        rebuild();
      }, vis };
      let last = performance.now();
      this.engine.runRenderLoop(() => {
        const n = performance.now(), dt = Math.min(0.05, (n - last) / 1e3);
        last = n;
        vis.forEach((v) => v.update(dt));
        this.scene.render();
      });
    }
  };

  // game/main.ts
  var g = new Game();
  window.__game = g;
  g.init(document.getElementById("c")).then(() => {
    const l = document.getElementById("loading");
    if (l) l.style.display = "none";
    window.__gameReady = true;
    window.dispatchEvent(new Event("necro-game-ready"));
  }).catch((e) => {
    const l = document.getElementById("loading");
    if (l) {
      l.style.display = "flex";
      l.textContent = "Error: " + (e && e.message ? e.message : e);
    }
    console.error(e);
  });
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2NvcmUvYmF0dGxlLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9wYWNrcy50cyIsICIuLi9jb3JlL3NhdmUudHMiLCAiLi4vZ2FtZS9uZWNyb21hbmNlci50cyIsICIuLi9nYW1lL2F1ZGlvLnRzIiwgIi4uL2NvcmUvcnVuc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvdmlzdWFscy50cyIsICIuLi91aS9pY29ucy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXSB9O1xuICBzaW06IHsgc2VwYXJhdGlvbjogbnVtYmVyOyBoaXRGcmFjdGlvbjogbnVtYmVyOyB0aW1lTGltaXQ6IG51bWJlcjsgcmV0YXJnZXRFdmVyeTogbnVtYmVyIH07XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUUzogQmFsYW5jZSA9IHtcbiAgc3RhdHM6IHtcbiAgICB3YXJyaW9yOiAgIHsgaHA6IDYwLCAgZG1nOiA4LCAgaW50ZXJ2YWw6IDAuOSwgcmFuZ2U6IDAuODUsIHNwZWVkOiAxLjQsIHNpemU6IDAuMjgsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC40NyB9LFxuICAgIGFyY2hlcjogICAgeyBocDogNDAsICBkbWc6IDcsICBpbnRlcnZhbDogMS43LCByYW5nZTogNS4wLCAgc3BlZWQ6IDEuMSwgc2l6ZTogMC4yNiwgYW5pbUxlbjogMS41LCBoaXRGcmFjOiAwLjc4IH0sXG4gICAgZ29ibGluOiAgICB7IGhwOiA0NSwgIGRtZzogOSwgIGludGVydmFsOiAwLjgsIHJhbmdlOiAwLjgsICBzcGVlZDogMS43LCBzaXplOiAwLjI0LCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIGtuaWdodDogICAgeyBocDogMTMwLCBkbWc6IDksICBpbnRlcnZhbDogMS4xLCByYW5nZTogMC45LCAgc3BlZWQ6IDEuMCwgc2l6ZTogMC4zMiwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgICBvZ3JlOiAgICAgIHsgaHA6IDE3MCwgZG1nOiAxNiwgaW50ZXJ2YWw6IDEuOSwgcmFuZ2U6IDEuMDUsIHNwZWVkOiAwLjgsIHNpemU6IDAuNDIsIGFuaW1MZW46IDEuMiwgaGl0RnJhYzogMC41NSB9LFxuICAgIGJhcmJhcmlhbjogeyBocDogNzUsICBkbWc6IDgsICBpbnRlcnZhbDogMC45NSwgcmFuZ2U6IDAuOSwgc3BlZWQ6IDEuNSwgc2l6ZTogMC4zMCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgfSxcbiAgLy8gXCJib2RpZXMgPSBkYW1hZ2UsIHN0YXJzID0gZHVyYWJpbGl0eVwiOiBIUCBncm93cyBmYXN0ZXIgdGhhbiBkYW1hZ2UgcGVyIHN0YXJcbiAgc3RhcjogeyBocDogWzEsIDIuMCwgMy4yXSwgZG1nOiBbMSwgMS41LCAyLjBdLCBzY2FsZTogWzEsIDEuMTIsIDEuMjVdIH0sXG4gIHBoYWxhbng6IHsgcmFkaXVzOiAyLjAsIHBlckFsbHk6IDAuMDgsIG1heFN0YWNrczogMyB9LFxuICAvLyBtYW5hIGZpbGxzIGZhc3Q6IGEgYmFzaWMgYXR0YWNrIGdpdmVzIHBlckF0dGFjaywgdGFraW5nIGEgaGl0IGdpdmVzIHBlckhpdDsgYSBmdWxsIGJhciBmaXJlcyB0aGUgc2tpbGwgb24gdGhlIG5leHQgYXR0YWNrLCB0aGVuIHJlc2V0c1xuICBtYW5hOiB7XG4gICAgYXJjaGVyOiB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDM0LCBwZXJIaXQ6IDYgfSwgICAgIC8vIFNwbGl0IEFycm93IGFib3V0IGV2ZXJ5IDNyZCBzaG90XG4gICAgb2dyZTogICB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDM0LCBwZXJIaXQ6IDYgfSwgICAgIC8vIFNtYXNoIGFib3V0IGV2ZXJ5IDNyZCBzd2luZ1xuICAgIGtuaWdodDogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAyNSwgcGVySGl0OiAxMiB9LCAgICAvLyBUYXVudCBldmVyeSB+NCBzd2luZ3MsIHNvb25lciB3aGVuIGhlIGlzIGJlaW5nIGhpdFxuICB9LFxuICB2b2xsZXk6IHsgdGFyZ2V0czogMywgcHJvamVjdGlsZVNwZWVkOiAxNCB9LFxuICBvcHBvcnR1bmlzdDogeyBib251czogMC41LCBzZWVrUmFkaXVzOiA0LjAsIHdvdW5kZWRXZWlnaHQ6IDEuNSB9LFxuICB0YXVudDogeyBkdXJhdGlvbjogMywgcmFkaXVzOiA0LjUgfSxcbiAgc21hc2g6IHsgbXVsdDogMi4wLCByYWRpdXM6IDEuNiB9LFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IDAuMTIsIG1heFN0YWNrczogOCwgcmVzZXRBZnRlcjogMC42IH0sXG4gIGxldmVsOiB7IGhwOiAwLjA4LCBkbWc6IDAuMDgsIGNvcGllc1RvTGV2ZWw6IFs1LCAxMCwgMjAsIDQwLCA4MCwgMTIwLCAyMDAsIDMwMCwgNTAwXSB9LFxuICBzaW06IHsgc2VwYXJhdGlvbjogMC42LCBoaXRGcmFjdGlvbjogMC40NywgdGltZUxpbWl0OiAxMjAsIHJldGFyZ2V0RXZlcnk6IDAuNSB9LFxufTtcblxuZXhwb3J0IGNvbnN0IEJBTEFOQ0U6IEJhbGFuY2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNldEJhbGFuY2UoKTogdm9pZCB7XG4gIGNvbnN0IGZyZXNoOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoZnJlc2gpIGFzIChrZXlvZiBCYWxhbmNlKVtdKSAoQkFMQU5DRSBhcyBhbnkpW2tdID0gKGZyZXNoIGFzIGFueSlba107XG59XG5cbmV4cG9ydCBjb25zdCBST0xFX1RFWFQ6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdDaGVhcCBhbmQgZmFzdC4gVG91Z2hlciBuZWFyIG90aGVyIFdhcnJpb3JzLicsXG4gIGFyY2hlcjogJ0ZyYWdpbGUuIFNraWxsOiBTcGxpdCBBcnJvdyBoaXRzIDMgZGlmZmVyZW50IGVuZW1pZXMuJyxcbiAgZ29ibGluOiAnRmFzdC4gSGl0cyBoYXJkZXIgb24gZW5lbWllcyBmaWdodGluZyBzb21lb25lIGVsc2UuJyxcbiAga25pZ2h0OiAnVGFuay4gU2tpbGw6IFRhdW50IHB1bGxzIGVuZW1pZXMgb250byBoaW0uJyxcbiAgb2dyZTogJ1Nsb3csIGh1Z2UgZGFtYWdlLiBTa2lsbDogU21hc2gsIGEgYmlnIGFyZWEgc2xhbS4nLFxuICBiYXJiYXJpYW46ICdTd2luZ3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBoaXQuJyxcbn07XG5cbmV4cG9ydCBjb25zdCBTT1VMX05BTUU6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdTa2VsZXRvbiBXYXJyaW9yJywgYXJjaGVyOiAnU2tlbGV0b24gQXJjaGVyJywgZ29ibGluOiAnR29ibGluJyxcbiAga25pZ2h0OiAnS25pZ2h0Jywgb2dyZTogJ09ncmUnLCBiYXJiYXJpYW46ICdCYXJiYXJpYW4nLFxufTtcblxuLyoqIEFiaWxpdHkgYmx1cmJzIGZvciB0aGUgU291bHMgcGFnZSwgd2l0aCB0aGUgbGl2ZSBudW1iZXJzIGZpbGxlZCBpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhYmlsaXR5SW5mbyhzb3VsOiBTb3VsSWQpOiB7IGtpbmQ6ICdza2lsbCcgfCAncGFzc2l2ZSc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nIH0ge1xuICBjb25zdCBCID0gQkFMQU5DRSwgcGN0ID0gKHg6IG51bWJlcikgPT4gTWF0aC5yb3VuZCh4ICogMTAwKSArICclJztcbiAgc3dpdGNoIChzb3VsKSB7XG4gICAgY2FzZSAnd2Fycmlvcic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ1BoYWxhbngnLCB0ZXh0OiBgVGFrZXMgJHtwY3QoQi5waGFsYW54LnBlckFsbHkpfSBsZXNzIGRhbWFnZSBmb3IgZWFjaCBvdGhlciBTa2VsZXRvbiBXYXJyaW9yIHdpdGhpbiAke0IucGhhbGFueC5yYWRpdXN9bSAodXAgdG8gJHtCLnBoYWxhbngubWF4U3RhY2tzfSkuYCB9O1xuICAgIGNhc2UgJ2dvYmxpbic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ09wcG9ydHVuaXN0JywgdGV4dDogYERlYWxzICR7cGN0KEIub3Bwb3J0dW5pc3QuYm9udXMpfSBtb3JlIGRhbWFnZSB0byBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZSwgYW5kIHByZWZlcnMgc3VjaCB0YXJnZXRzLmAgfTtcbiAgICBjYXNlICdiYXJiYXJpYW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdGcmVuenknLCB0ZXh0OiBgQXR0YWNrcyAke3BjdChCLmZyZW56eS5wZXJTd2luZyl9IGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmcgKHVwIHRvICR7Qi5mcmVuenkubWF4U3RhY2tzfSB0aW1lcykuYCB9O1xuICAgIGNhc2UgJ2FyY2hlcic6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTcGxpdCBBcnJvdycsIHRleHQ6IGBCYXNpYyBzaG90cyBmaXJlIG9uZSBhcnJvdy4gV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHNob3QgZmlyZXMgYXQgdXAgdG8gJHtCLnZvbGxleS50YXJnZXRzfSBkaWZmZXJlbnQgZW5lbWllcy5gIH07XG4gICAgY2FzZSAna25pZ2h0JzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1RhdW50JywgdGV4dDogYFdoZW4gbWFuYSBpcyBmdWxsLCBlbmVtaWVzIHdpdGhpbiAke0IudGF1bnQucmFkaXVzfW0gbXVzdCBhdHRhY2sgaGltIGZvciAke0IudGF1bnQuZHVyYXRpb259cy5gIH07XG4gICAgY2FzZSAnb2dyZSc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTbWFzaCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgdGhlIG5leHQgc3dpbmcgZGVhbHMgJHtCLnNtYXNoLm11bHR9eCBkYW1hZ2UgYW5kIGhpdHMgZW5lbWllcyBuZWFyIHRoZSB0YXJnZXQgZm9yIDYwJSBhcyBtdWNoLmAgfTtcbiAgfVxufVxuIiwgIi8vIERlc2lnbiBkYXRhIHN0cmFpZ2h0IGZyb20gdGhlIHBsYW4gZG9jLiBBbnl0aGluZyBtYXJrZWQgUExBQ0VIT0xERVIgaXMgbm90IGluIHRoZSBkb2MgeWV0LlxuXG5leHBvcnQgdHlwZSBTb3VsSWQgPSAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJztcblxuZXhwb3J0IGNvbnN0IFNPVUxTOiBTb3VsSWRbXSA9IFsnd2FycmlvcicsICdhcmNoZXInLCAnZ29ibGluJywgJ2tuaWdodCcsICdvZ3JlJywgJ2JhcmJhcmlhbiddO1xuXG4vKiogRG9taW5pb24gY29zdCBwZXIgc3RhciBsZXZlbDogaW5kZXggMCA9IDEgc3RhciwgMSA9IDIgc3RhcnMsIDIgPSAzIHN0YXJzICgzIHN0YXJzIGlzIHRoZSBtYXgpLiAqL1xuZXhwb3J0IGNvbnN0IENPU1Q6IFJlY29yZDxTb3VsSWQsIG51bWJlcltdPiA9IHtcbiAgd2FycmlvcjogWzIsIDMsIDRdLFxuICBhcmNoZXI6IFs0LCA2LCA5XSxcbiAgZ29ibGluOiBbMywgNCwgNl0sXG4gIGtuaWdodDogWzUsIDcsIDEwXSxcbiAgb2dyZTogWzcsIDEwLCAxNV0sXG4gIGJhcmJhcmlhbjogWzUsIDcsIDEwXSwgLy8gUExBQ0VIT0xERVI6IHRoZSBkb2MgaGFzIG5vIGNvc3QgZm9yIHRoZSBzaXh0aCBTb3VsIHlldFxufTtcblxuZXhwb3J0IGNvbnN0IE1BWF9TVEFSID0gMztcbmV4cG9ydCBjb25zdCBHUklEX0NFTExTID0gMTI7IC8vIDQgeCAzXG5cbi8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUgKGluZGV4IDAgPSB3YXZlIDEpLiAqL1xuZXhwb3J0IGNvbnN0IENVUlZFUzogUmVjb3JkPHN0cmluZywgbnVtYmVyW10+ID0ge1xuICAvLyBMT0NLRUQgKGNvbmZpcm1lZCk6ICs0IGZvciB3YXZlcyAyLTUsIHRoZW4gKzMgZm9yIHdhdmVzIDYtMTAgLT4gNDBcbiAgZG9jOiBbOSwgMTMsIDE3LCAyMSwgMjUsIDI4LCAzMSwgMzQsIDM3LCA0MF0sXG4gIC8vIE5PVCBVU0VEOiBtaXNyZW1lbWJlcmVkIHZhcmlhbnQgKCszIHRocm91Z2ggd2F2ZSA2LCB0aGVuICsyKSB0aGF0IG9ubHkgcmVhY2hlcyAzMi4gS2VwdCBmb3IgY29tcGFyaXNvbiBvbmx5LlxuICByZWNhbGxlZDogWzksIDEyLCAxNSwgMTgsIDIxLCAyNCwgMjYsIDI4LCAzMCwgMzJdLFxufTtcblxuZXhwb3J0IGNvbnN0IEhFQVJUUyA9IDM7XG5leHBvcnQgY29uc3QgU1RBUlRfSEFORCA9IDQ7XG5leHBvcnQgY29uc3QgV0FWRVMgPSAxMDtcblxuZXhwb3J0IGludGVyZmFjZSBSdWxlcyB7XG4gIC8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUuICovXG4gIGN1cnZlOiBudW1iZXJbXTtcbiAgLyoqXG4gICAqICdkZXBsb3llZE9ubHknOiBvbmx5IHR3byBkZXBsb3llZCB1bml0cyBvZiB0aGUgc2FtZSBzdGFyIGNhbiBtZXJnZSAoZG9jIGFzIHdyaXR0ZW4pLlxuICAgKiAnaGFuZEludG9PbmVTdGFyJzogYWRkaXRpb25hbGx5IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gYmUgcGxheWVkIG9udG8gYSBkZXBsb3llZFxuICAgKiAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsIHRvIG1lcmdlIGltbWVkaWF0ZWx5IChwYXlzIG9ubHkgdGhlIGNvc3QgZGlmZmVyZW5jZSkuXG4gICAqL1xuICBtZXJnZTogJ2RlcGxveWVkT25seScgfCAnaGFuZEludG9PbmVTdGFyJztcbiAgLyoqIENhcmQtaW5mbG93IGtub2JzIChhbGwgb3B0aW9uYWw7IGRlZmF1bHRzIHJlcHJvZHVjZSB0aGUgZG9jKS4gKi9cbiAgc3RhcnRIYW5kPzogbnVtYmVyOyAgICAgICAgICAgIC8vIGRlZmF1bHQgNFxuICBkcmFmdFBpY2tzPzogbnVtYmVyOyAgICAgICAgICAgLy8gY2FyZHMga2VwdCBmcm9tIHRoZSAzLWNhcmQgVmljdG9yeSBEcmFmdCwgZGVmYXVsdCAxXG4gIG5vcm1hbERyYXdXYXZlcz86IG51bWJlcltdOyAgICAvLyB3YXZlcyAoYmVpbmcgZW50ZXJlZCkgdGhhdCBhbHNvIGdpdmUgdGhlIG5vcm1hbCByYW5kb20gZHJhdzsgZGVmYXVsdCA9IGFsbFxuICAvKiogU291bHMgdGhpcyBydW4gbWF5IGRyYXcgZnJvbSAodGhlIGVxdWlwcGVkIFNvdWwgRGVjaywgbWF4IDYpLiBEZWZhdWx0OiBldmVyeSBTb3VsLiAqL1xuICBwb29sPzogU291bElkW107XG4gIHN0YWdlV2F2ZXM/OiBudW1iZXI7ICAgICAgICAgICAvLyB3YXZlcyBpbiB0aGlzIHN0YWdlOyBkZWZhdWx0IDEwICh0aGUgcGxheWFibGUgcHJvdG90eXBlIHVzZXMgMylcbn1cblxuZXhwb3J0IGNvbnN0IEdSSURfQ09MUyA9IDQsIEdSSURfUk9XUyA9IDM7ICAgLy8gNCB4IDMgPSBHUklEX0NFTExTOyBjb2x1bW4gR1JJRF9DT0xTLTEgaXMgdGhlIGZyb250IGxpbmVcbiIsICIvLyBTbWFsbCBzZWVkZWQgUk5HIChtdWxiZXJyeTMyKS4gU2FtZSBzZWVkIC0+IHNhbWUgcnVuLCBzbyBhbnkgYnVnIHJlcG9ydCBpcyByZXByb2R1Y2libGUuXG4vLyBgc3RhdGUoKWAgLyB0aGUgYHJlc3VtZWAgYXJndW1lbnQgbGV0IGEgc2F2ZWQgcnVuIGNvbnRpbnVlIGRyYXdpbmcgZXhhY3RseSB0aGUgY2FyZHMgaXQgd291bGQgaGF2ZSBkcmF3bi5cblxuZXhwb3J0IGludGVyZmFjZSBSbmcge1xuICBuZXh0KCk6IG51bWJlcjsgICAgICAgICAgICAgIC8vIFswLCAxKVxuICBpbnQobjogbnVtYmVyKTogbnVtYmVyOyAgICAgIC8vIFswLCBuKVxuICBwaWNrPFQ+KGl0ZW1zOiByZWFkb25seSBUW10pOiBUO1xuICBzZWVkOiBudW1iZXI7XG4gIHN0YXRlKCk6IG51bWJlcjsgICAgICAgICAgICAgLy8gdGhlIGdlbmVyYXRvcidzIGN1cnJlbnQgcG9zaXRpb24sIGZvciBzYXZpbmcgYSBydW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSbmcoc2VlZDogbnVtYmVyLCByZXN1bWU/OiBudW1iZXIpOiBSbmcge1xuICBsZXQgYSA9IChyZXN1bWUgPz8gc2VlZCkgPj4+IDA7XG4gIGNvbnN0IG5leHQgPSAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBhO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBzZWVkLFxuICAgIG5leHQsXG4gICAgaW50OiAobikgPT4gTWF0aC5mbG9vcihuZXh0KCkgKiBuKSxcbiAgICBwaWNrOiAoaXRlbXMpID0+IGl0ZW1zW01hdGguZmxvb3IobmV4dCgpICogaXRlbXMubGVuZ3RoKV0sXG4gICAgc3RhdGU6ICgpID0+IGEsXG4gIH07XG59XG4iLCAiLy8gUHVyZSBnYW1lIHJ1bGVzIGZvciBvbmUgc3RhZ2UuIE5vIGdyYXBoaWNzLCBubyBjb21iYXQ6IGp1c3QgY2FyZHMsIERvbWluaW9uLCBncmlkLCBtZXJnZSwgd2F2ZXMsIGhlYXJ0cy5cbi8vIEV2ZXJ5IG11dGF0aW9uIGdvZXMgdGhyb3VnaCBhIGZ1bmN0aW9uIGhlcmUgYW5kIGFwcGVuZHMgdG8gc3RhdGUubG9nLCBzbyBydW5zIGNhbiBiZSByZXBsYXllZCBhbmQgaW5zcGVjdGVkLlxuXG5pbXBvcnQgeyBDT1NULCBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUywgU1RBUlRfSEFORCwgV0FWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0IHsgaWQ6IG51bWJlcjsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjsgZnJlc2g/OiBib29sZWFuIH0gICAvLyBmcmVzaCA9IHN1bW1vbmVkIHRoaXMgYnVpbGQgcGhhc2VcblxuZXhwb3J0IGludGVyZmFjZSBTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlcztcbiAgcm5nOiBSbmc7XG4gIHdhdmU6IG51bWJlcjsgICAgICAgICAgICAgICAgIC8vIDEtYmFzZWRcbiAgaGVhcnRzOiBudW1iZXI7XG4gIGNhcDogbnVtYmVyO1xuICBoYW5kOiBTb3VsSWRbXTtcbiAgdW5pdHM6IFVuaXRbXTtcbiAgbmV4dElkOiBudW1iZXI7XG4gIGRpc2NhcmRVc2VkOiBib29sZWFuOyAgICAgICAgIC8vIG9uY2UtcGVyLWJ1aWxkLXBoYXNlIHJlZHJhd1xuICBzdGF0dXM6ICdidWlsZGluZycgfCAnd29uJyB8ICdsb3N0JztcbiAgbG9nOiBzdHJpbmdbXTtcbiAgc3RhdHM6IHsgZHJhd246IG51bWJlcjsgZGlzY2FyZGVkOiBudW1iZXI7IGRpc21pc3NlZDogbnVtYmVyOyBtZXJnZXM6IG51bWJlcjsgZmFpbHVyZXM6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgY29zdCA9IChzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlcik6IG51bWJlciA9PiBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbmV4cG9ydCBjb25zdCBjYXJkc0luID0gKHN0YXI6IG51bWJlcik6IG51bWJlciA9PiAyICoqIChzdGFyIC0gMSk7ICAgICAvLyBjYXJkcyBhIHVuaXQgaXMgXCJ3b3J0aFwiXG5leHBvcnQgY29uc3QgZG9taW5pb25Vc2VkID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY29zdCh1LnNvdWwsIHUuc3RhciksIDApO1xuZXhwb3J0IGNvbnN0IGRvbWluaW9uRnJlZSA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLmNhcCAtIGRvbWluaW9uVXNlZChzKTtcblxuZnVuY3Rpb24gbG9nKHM6IFN0YXRlLCBtc2c6IHN0cmluZykgeyBzLmxvZy5wdXNoKGBbdyR7cy53YXZlfV0gJHttc2d9YCk7IH1cbi8qKiBUaGUgU291bHMgdGhpcyBydW4gZHJhd3MgZnJvbTogdGhlIGVxdWlwcGVkIGRlY2ssIG9yIGV2ZXJ5dGhpbmcgaWYgbm8gZGVjayB3YXMgZ2l2ZW4uICovXG5leHBvcnQgY29uc3QgcG9vbE9mID0gKHM6IFN0YXRlKTogU291bElkW10gPT4gKHMucnVsZXMucG9vbCAmJiBzLnJ1bGVzLnBvb2wubGVuZ3RoID8gcy5ydWxlcy5wb29sIDogU09VTFMpO1xuZnVuY3Rpb24gZHJhdyhzOiBTdGF0ZSwgd2h5OiBzdHJpbmcsIG5vdD86IFNvdWxJZCk6IFNvdWxJZCB7XG4gIGNvbnN0IGFsbCA9IHBvb2xPZihzKSwgb3RoZXJzID0gbm90ID8gYWxsLmZpbHRlcigoeCkgPT4geCAhPT0gbm90KSA6IGFsbDtcbiAgY29uc3QgcG9vbCA9IG90aGVycy5sZW5ndGggPyBvdGhlcnMgOiBhbGw7ICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHN3YXAgbmV2ZXIgaGFuZHMgeW91IGJhY2sgdGhlIFNvdWwgeW91IGdhdmUgdXAgKHVubGVzcyBpdCBpcyB0aGUgb25seSBvbmUgZXF1aXBwZWQpXG4gIGNvbnN0IGMgPSBzLnJuZy5waWNrKHBvb2wpO1xuICBzLmhhbmQucHVzaChjKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYXcgJHtjfSAoJHt3aHl9KWApO1xuICByZXR1cm4gYztcbn1cblxuLyoqIEEgbmV3IGJ1aWxkIHBoYXNlIGJlZ2luczogdGhlIG9uY2UtcGVyLXBoYXNlIHN3YXAgY29tZXMgYmFjayBhbmQgbm90aGluZyBjb3VudHMgYXMgXCJzdW1tb25lZCB0aGlzIHJvdW5kXCIuICovXG5leHBvcnQgZnVuY3Rpb24gbmV3UGhhc2UoczogU3RhdGUpOiB2b2lkIHtcbiAgcy5kaXNjYXJkVXNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgdS5mcmVzaCA9IGZhbHNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3U3RhZ2UocnVsZXM6IFJ1bGVzLCBzZWVkOiBudW1iZXIpOiBTdGF0ZSB7XG4gIGNvbnN0IHM6IFN0YXRlID0ge1xuICAgIHJ1bGVzLCBybmc6IG1ha2VSbmcoc2VlZCksIHdhdmU6IDEsIGhlYXJ0czogSEVBUlRTLCBjYXA6IHJ1bGVzLmN1cnZlWzBdLCBoYW5kOiBbXSwgdW5pdHM6IFtdLCBuZXh0SWQ6IDEsXG4gICAgZGlzY2FyZFVzZWQ6IGZhbHNlLCBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogW10sXG4gICAgc3RhdHM6IHsgZHJhd246IDAsIGRpc2NhcmRlZDogMCwgZGlzbWlzc2VkOiAwLCBtZXJnZXM6IDAsIGZhaWx1cmVzOiAwIH0sXG4gIH07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgKHJ1bGVzLnN0YXJ0SGFuZCA/PyBTVEFSVF9IQU5EKTsgaSsrKSBkcmF3KHMsICdzdGFydGluZyBoYW5kJyk7XG4gIHJldHVybiBzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlZUNlbGwoczogU3RhdGUpOiBudW1iZXIge1xuICBjb25zdCB0YWtlbiA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKCF0YWtlbi5oYXMoYykpIHJldHVybiBjO1xuICByZXR1cm4gLTE7XG59XG5cbi8vIC0tLS0gYnVpbGQtcGhhc2UgYWN0aW9ucyAoZWFjaCByZXR1cm5zIHRydWUgd2hlbiBpdCBoYXBwZW5lZCkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5TdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdO1xuICByZXR1cm4gc291bCAhPT0gdW5kZWZpbmVkICYmIGZyZWVDZWxsKHMpID49IDAgJiYgY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjZWxsRnJlZShzOiBTdGF0ZSwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIHJldHVybiBjZWxsID49IDAgJiYgY2VsbCA8IEdSSURfQ0VMTFMgJiYgIXMudW5pdHMuc29tZSgodSkgPT4gdS5jZWxsID09PSBjZWxsKTtcbn1cblxuLyoqIFN1bW1vbiBhIGhhbmQgY2FyZCBvbnRvIGEgc3BlY2lmaWMgZnJlZSBjZWxsIChkZWZhdWx0OiB0aGUgZmlyc3QgZnJlZSBvbmUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCBjZWxsPzogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3VtbW9uKHMsIGhhbmRJZHgpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChjZWxsICE9PSB1bmRlZmluZWQgJiYgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1OiBVbml0ID0geyBpZDogcy5uZXh0SWQrKywgc291bCwgc3RhcjogMSwgY2VsbDogY2VsbCA/PyBmcmVlQ2VsbChzKSwgZnJlc2g6IHRydWUgfTtcbiAgcy51bml0cy5wdXNoKHUpO1xuICBsb2cocywgYHN1bW1vbiAke3NvdWx9IDEqIC0+IGNlbGwgJHt1LmNlbGx9ICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRGVwbG95ZWQoYTogVW5pdCwgYjogVW5pdCk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5pZCAhPT0gYi5pZCAmJiBhLnNvdWwgPT09IGIuc291bCAmJiBhLnN0YXIgPT09IGIuc3RhciAmJiBhLnN0YXIgPCBNQVhfU1RBUjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRGVwbG95ZWQoczogU3RhdGUsIGFJZDogbnVtYmVyLCBiSWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBhID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBhSWQpLCBiID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBiSWQpO1xuICBpZiAoIWEgfHwgIWIgfHwgIWNhbk1lcmdlRGVwbG95ZWQoYSwgYikpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh1KSA9PiB1LmlkICE9PSBiLmlkKTtcbiAgYS5mcmVzaCA9ICEhKGEuZnJlc2ggfHwgYi5mcmVzaCk7XG4gIGEuc3RhcisrO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlICR7YS5zb3VsfSAke2Euc3RhciAtIDF9Kiske2Euc3RhciAtIDF9KiAtPiAke2Euc3Rhcn0qICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9LCBjZWxscyAke3MudW5pdHMubGVuZ3RofS8ke0dSSURfQ0VMTFN9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqICdoYW5kSW50b09uZVN0YXInIHJ1bGU6IHBsYXkgYSAxLXN0YXIgY2FyZCBvbnRvIGEgZGVwbG95ZWQgMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLnJ1bGVzLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXNvdWwgfHwgIXUgfHwgdS5zb3VsICE9PSBzb3VsIHx8IHUuc3RhciAhPT0gMSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gY29zdChzb3VsLCAyKSAtIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhbk1lcmdlRnJvbUhhbmQocywgaGFuZElkeCwgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHUuc3RhciA9IDI7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UtZnJvbS1oYW5kICR7c291bH0gLT4gJHt1LnNvdWx9IDIqICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRpc21pc3MoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBkaXNtaXNzICR7dS5zb3VsfSAke3Uuc3Rhcn0qIChwZXJtYW5lbnRseSByZW1vdmVkKWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDE6IGRpc2NhcmQgYSBoYW5kIGNhcmQgYW5kIGRyYXcgYSByYW5kb20gY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2NhcmRSZWRyYXcoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5kaXNjYXJkVXNlZCB8fCBoYW5kSWR4IDwgMCB8fCBoYW5kSWR4ID49IHMuaGFuZC5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgYyA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc2NhcmRlZCsrO1xuICBsb2cocywgYHN3YXA6IGRpc2NhcmQgJHtjfWApO1xuICBkcmF3KHMsICdzd2FwJywgYyk7XG4gIHJldHVybiB0cnVlO1xufVxuZXhwb3J0IGNvbnN0IHN3YXBEaXNjYXJkID0gZGlzY2FyZFJlZHJhdztcblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICByZXR1cm4gIXMuZGlzY2FyZFVzZWQgJiYgISF1ICYmICF1LmZyZXNoOyAgICAgICAgICAvLyBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZFxufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMjogc2VsbCBhIGRlcGxveWVkIHVuaXQgKG5vdCBvbmUgc3VtbW9uZWQgdGhpcyByb3VuZCkgYW5kIGRyYXcgYSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gc3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3dhcFNlbGwocywgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYHN3YXA6IHNlbGwgJHt1LnNvdWx9ICR7dS5zdGFyfSpgKTtcbiAgZHJhdyhzLCAnc3dhcCcsIHUuc291bCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbW92ZVVuaXQoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1IHx8ICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBsb2cocywgYG1vdmUgJHt1LnNvdWx9IGNlbGwgJHt1LmNlbGx9IC0+ICR7Y2VsbH1gKTsgdS5jZWxsID0gY2VsbDsgcmV0dXJuIHRydWU7XG59XG5cbi8vIC0tLS0gd2F2ZSByZXN1bHRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERyYWZ0IGNob2ljZXMgZm9yIGFmdGVyIGEgY2xlYXJlZCB3YXZlOiAzIHJhbmRvbSBjYXJkcywgZHVwbGljYXRlcyBhbGxvd2VkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRyYWZ0T3B0aW9ucyhzOiBTdGF0ZSk6IFNvdWxJZFtdIHtcbiAgY29uc3QgcCA9IHBvb2xPZihzKTtcbiAgcmV0dXJuIFtzLnJuZy5waWNrKHApLCBzLnJuZy5waWNrKHApLCBzLnJuZy5waWNrKHApXTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZDogcmFpc2UgdGhlIGNhcCwgcmVzb2x2ZSB0aGUgVmljdG9yeSBEcmFmdCwgZHJhdyAxIG5vcm1hbCBjYXJkLiAqL1xuZXhwb3J0IGNvbnN0IHN0YWdlV2F2ZXMgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5ydWxlcy5zdGFnZVdhdmVzID8/IFdBVkVTO1xuXG4vKiogU3RlcCAxIG9mIGEgY2xlYXJlZCB3YXZlOiBpcyB0aGUgc3RhZ2Ugb3Zlcj8gSWYgbm90LCByYWlzZSB0aGUgY2FwIGFuZCBzdGFydCB0aGUgbmV4dCBidWlsZCBwaGFzZS4gUmV0dXJucyB0cnVlIHdoZW4gdGhlIHN0YWdlIGlzIHdvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlV2F2ZShzOiBTdGF0ZSk6IGJvb2xlYW4ge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBzLnN0YXR1cyA9PT0gJ3dvbic7XG4gIGlmIChzLndhdmUgPj0gc3RhZ2VXYXZlcyhzKSkgeyBzLnN0YXR1cyA9ICd3b24nOyBsb2cocywgJ3N0YWdlIGNsZWFyZWQnKTsgcmV0dXJuIHRydWU7IH1cbiAgcy53YXZlKys7XG4gIHMuY2FwID0gcy5ydWxlcy5jdXJ2ZVtzLndhdmUgLSAxXTtcbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgd2F2ZSBjbGVhcmVkIC0+IGNhcCAke3MuY2FwfWApO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTdGVwIDI6IHRoZSBwbGF5ZXIga2VwdCBgaWR4YCBmcm9tIHRoZSBvZmZlcmVkIGRyYWZ0IGNhcmRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRha2VEcmFmdChzOiBTdGF0ZSwgb3B0czogU291bElkW10sIGlkeDogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IHBpY2sgPSBvcHRzW01hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgaWR4KSldO1xuICBzLmhhbmQucHVzaChwaWNrKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYWZ0IFske29wdHMuam9pbignLCAnKX1dIC0+IHRvb2sgJHtwaWNrfWApO1xufVxuXG4vKiogU3RlcCAzOiB0aGUgYm9udXMgbm9ybWFsIGRyYXcgKG9ubHkgb24gdGhlIHdhdmVzIHRoZSBydWxlcyBhbGxvdykuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsRHJhdyhzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMgPyBzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcy5pbmNsdWRlcyhzLndhdmUpIDogdHJ1ZSkgZHJhdyhzLCAnd2F2ZSBjbGVhcicpO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkIChhbGwgdGhyZWUgc3RlcHMgaW4gb25lIGNhbGwsIGZvciBzaW11bGF0aW9ucykuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJXYXZlKHM6IFN0YXRlLCBjaG9vc2U6IChvcHRzOiBTb3VsSWRbXSkgPT4gbnVtYmVyKTogdm9pZCB7XG4gIGlmIChhZHZhbmNlV2F2ZShzKSkgcmV0dXJuO1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgbGV0IG9wdHMgPSBkcmFmdE9wdGlvbnMocyk7XG4gIGNvbnN0IG9mZmVyZWQgPSBvcHRzLmpvaW4oJywgJyk7XG4gIGNvbnN0IHRvb2s6IFNvdWxJZFtdID0gW107XG4gIGZvciAobGV0IHAgPSAwOyBwIDwgKHMucnVsZXMuZHJhZnRQaWNrcyA/PyAxKTsgcCsrKSB7XG4gICAgY29uc3QgaWR4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBjaG9vc2Uob3B0cykpKTtcbiAgICB0b29rLnB1c2gob3B0c1tpZHhdKTsgcy5oYW5kLnB1c2gob3B0c1tpZHhdKTsgcy5zdGF0cy5kcmF3bisrO1xuICAgIG9wdHMgPSBvcHRzLmZpbHRlcigoXywgaSkgPT4gaSAhPT0gaWR4KTtcbiAgfVxuICBsb2cocywgYGRyYWZ0IFske29mZmVyZWR9XSAtPiB0b29rICR7dG9vay5qb2luKCcsICcpfWApO1xuICBub3JtYWxEcmF3KHMpO1xufVxuXG4vKiogQXJteSB3aXBlZDogbG9zZSBhIGhlYXJ0LCBjYXAgZG9lcyBOT1QgcmlzZSwgZW5lbWllcyByZXNldCwgKzEgY2FyZCwgcmVkcmF3IGFsbG93ZWQgYWdhaW4uICovXG5leHBvcnQgZnVuY3Rpb24gZmFpbFdhdmUoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIHMuaGVhcnRzLS07IHMuc3RhdHMuZmFpbHVyZXMrKztcbiAgaWYgKHMuaGVhcnRzIDw9IDApIHsgcy5zdGF0dXMgPSAnbG9zdCc7IGxvZyhzLCAnbm8gaGVhcnRzIGxlZnQ6IHN0YWdlIGxvc3QnKTsgcmV0dXJuOyB9XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYGFybXkgd2lwZWQ6IGhlYXJ0cyAke3MuaGVhcnRzfSwgY2FwIHN0YXlzICR7cy5jYXB9YCk7XG4gIGRyYXcocywgJ2ZhaWxlZCBhdHRlbXB0Jyk7XG59XG5cbi8vIC0tLS0gaW52YXJpYW50cyAoY2FsbGVkIGJ5IHRoZSBzaW11bGF0b3IgYWZ0ZXIgZXZlcnkgd2F2ZTsgdGhyb3cgd2l0aCBhIHJlYWRhYmxlIG1lc3NhZ2UpIC0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrSW52YXJpYW50cyhzOiBTdGF0ZSk6IHZvaWQge1xuICBjb25zdCBmYWlsID0gKG06IHN0cmluZykgPT4geyB0aHJvdyBuZXcgRXJyb3IoYElOVkFSSUFOVCAke219XFxuYCArIHMubG9nLnNsaWNlKC0xMikuam9pbignXFxuJykpOyB9O1xuICBpZiAocy51bml0cy5sZW5ndGggPiBHUklEX0NFTExTKSBmYWlsKGBtb3JlIHVuaXRzICgke3MudW5pdHMubGVuZ3RofSkgdGhhbiBjZWxsc2ApO1xuICBjb25zdCBjZWxscyA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBpZiAoY2VsbHMuc2l6ZSAhPT0gcy51bml0cy5sZW5ndGgpIGZhaWwoJ3R3byB1bml0cyBzaGFyZSBhIGNlbGwnKTtcbiAgaWYgKGRvbWluaW9uVXNlZChzKSA+IHMuY2FwKSBmYWlsKGBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0gZXhjZWVkcyBjYXAgJHtzLmNhcH1gKTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIGlmICh1LnN0YXIgPCAxIHx8IHUuc3RhciA+IE1BWF9TVEFSKSBmYWlsKGB1bml0IHN0YXIgJHt1LnN0YXJ9IG91dCBvZiByYW5nZWApO1xuICAvLyBldmVyeSBkcmF3biBjYXJkIGlzIGVpdGhlciBpbiBoYW5kLCB3b3J0aCBjYXJkcyBvbiB0aGUgZmllbGQsIGRpc2NhcmRlZCwgb3IgZGlzbWlzc2VkXG4gIGNvbnN0IG9uRmllbGQgPSBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNhcmRzSW4odS5zdGFyKSwgMCk7XG4gIGNvbnN0IGFjY291bnRlZCA9IHMuaGFuZC5sZW5ndGggKyBvbkZpZWxkICsgcy5zdGF0cy5kaXNjYXJkZWQgKyBzLnN0YXRzLmRpc21pc3NlZDtcbiAgaWYgKGFjY291bnRlZCAhPT0gcy5zdGF0cy5kcmF3bikgZmFpbChgY2FyZCBjb25zZXJ2YXRpb246IGRyYXduICR7cy5zdGF0cy5kcmF3bn0gIT0gYWNjb3VudGVkICR7YWNjb3VudGVkfWApO1xufVxuIiwgIi8vIEF1dG8tYmF0dGxlIHNpbXVsYXRpb246IHB1cmUgbG9naWMsIG5vIGdyYXBoaWNzLiBEZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHNlZWQuXG4vLyBUaGUgcmVuZGVyZXIgb25seSByZWFkcyBmaWdodGVycyArIGV2ZW50czsgaXQgbmV2ZXIgZGVjaWRlcyBhbnl0aGluZy5cbi8vXG4vLyBBYmlsaXRpZXMgKG51bWJlcnMgbGl2ZSBpbiBiYWxhbmNlLnRzKTpcbi8vICAgU2tlbGV0b24gV2FycmlvciAgUGhhbGFueCAgICAgdGFrZXMgbGVzcyBkYW1hZ2UgZm9yIGVhY2ggbmVhcmJ5IGFsbGllZCBXYXJyaW9yIChjYXBwZWQpXG4vLyAgIFNrZWxldG9uIEFyY2hlciAgIFNwbGl0IEFycm93IChza2lsbCkgb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllczsgYmFzaWMgc2hvdHMgYXJlIGEgc2luZ2xlIGFycm93XG4vLyAgIEdvYmxpbiAgICAgICAgICAgIE9wcG9ydHVuaXN0ICtkYW1hZ2Ugb24gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2U7IHByZWZlcnMgc3VjaCB0YXJnZXRzXG4vLyAgIEtuaWdodCAgICAgICAgICAgIFRhdW50IChza2lsbCkgIGZvcmNlcyBuZWFyYnkgZW5lbWllcyB0byBhdHRhY2sgaGltXG4vLyAgIE9ncmUgICAgICAgICAgICAgIFNtYXNoIChza2lsbCkgIGhlYXZ5IHNsYW0gdGhhdCBhbHNvIGhpdHMgZW5lbWllcyBuZWFyIHRoZSBpbXBhY3Rcbi8vIFNraWxscyBydW4gb24gbWFuYTogYmFzaWMgYXR0YWNrcyBhbmQgZGFtYWdlIHRha2VuIGZpbGwgYSBiYXI7IHdoZW4gZnVsbCwgdGhlIG5leHQgYXR0YWNrIGlzIHRoZSBza2lsbCBhbmQgdGhlIGJhciByZXNldHMuXG4vLyBXYXJyaW9yLCBHb2JsaW4gYW5kIEJhcmJhcmlhbiBoYXZlIHBhc3NpdmVzIG9ubHkgKG5vIG1hbmEpLlxuLy8gICBCYXJiYXJpYW4gICAgICAgICBGcmVuenkgICAgICBhdHRhY2tzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmdcblxuaW1wb3J0IHsgR1JJRF9DT0xTLCBHUklEX1JPV1MgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBjb25zdCBHUklEX1NQID0gMS4zOyAgICAgLy8gbWV0cmVzIGJldHdlZW4gZ3JpZCBjZWxsc1xuZXhwb3J0IGNvbnN0IEZST05UX1ggPSAxLjc7ICAgICAvLyBmcm9udCBsaW5lJ3MgZGlzdGFuY2UgZnJvbSB0aGUgY2VudHJlIGxpbmVcblxuZXhwb3J0IGludGVyZmFjZSBTbG90IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5cbi8qKiBXb3JsZCBwb3NpdGlvbiBvZiBhIGdyaWQgY2VsbCBmb3IgYSB0ZWFtICh0ZWFtIDAgPSBsZWZ0LCBmYWNlcyArWDsgdGVhbSAxID0gcmlnaHQsIGZhY2VzIC1YKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjZWxsUG9zKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpOiB7IHg6IG51bWJlcjsgejogbnVtYmVyIH0ge1xuICBjb25zdCByb3cgPSBNYXRoLmZsb29yKGNlbGwgLyBHUklEX0NPTFMpLCBjb2wgPSBjZWxsICUgR1JJRF9DT0xTO1xuICBjb25zdCBkZXB0aCA9IEdSSURfQ09MUyAtIDEgLSBjb2w7ICAgICAgICAgICAgICAgICAgICAgICAvLyAwID0gZnJvbnQgbGluZVxuICByZXR1cm4geyB4OiAoRlJPTlRfWCArIGRlcHRoICogR1JJRF9TUCkgKiAodGVhbSA9PT0gMCA/IC0xIDogMSksIHo6IChyb3cgLSAoR1JJRF9ST1dTIC0gMSkgLyAyKSAqIEdSSURfU1AgfTtcbn1cblxuY29uc3QgRlJPTlRORVNTOiBSZWNvcmQ8U291bElkLCBudW1iZXI+ID0geyBrbmlnaHQ6IDUsIG9ncmU6IDQsIHdhcnJpb3I6IDMsIGJhcmJhcmlhbjogMywgZ29ibGluOiAyLCBhcmNoZXI6IDAgfTtcbi8qKiBUaGUgZW5lbXkgYXJteSBpcyBwbGFjZWQgYXV0b21hdGljYWxseSAodGFua3MgdXAgZnJvbnQsIGFyY2hlcnMgYmVoaW5kKTsgdGhlIHBsYXllciBvbmx5IGV2ZXIgc2VlcyBpdHMgY29tcG9zaXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlDZWxscyhzcGVjczogU3BlY1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBjZWxsczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NPTFMgKiBHUklEX1JPV1M7IGMrKykgY2VsbHMucHVzaChjKTtcbiAgY2VsbHMuc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IGRhID0gR1JJRF9DT0xTIC0gMSAtIChhICUgR1JJRF9DT0xTKSwgZGIgPSBHUklEX0NPTFMgLSAxIC0gKGIgJSBHUklEX0NPTFMpO1xuICAgIGlmIChkYSAhPT0gZGIpIHJldHVybiBkYSAtIGRiO1xuICAgIHJldHVybiBNYXRoLmFicyhNYXRoLmZsb29yKGEgLyBHUklEX0NPTFMpIC0gMSkgLSBNYXRoLmFicyhNYXRoLmZsb29yKGIgLyBHUklEX0NPTFMpIC0gMSk7XG4gIH0pO1xuICBjb25zdCBvcmRlciA9IHNwZWNzLm1hcCgocywgaSkgPT4gaSkuc29ydCgoaSwgaikgPT4gRlJPTlRORVNTW3NwZWNzW2pdLnNvdWxdIC0gRlJPTlRORVNTW3NwZWNzW2ldLnNvdWxdKTtcbiAgY29uc3Qgb3V0ID0gbmV3IEFycmF5PG51bWJlcj4oc3BlY3MubGVuZ3RoKTtcbiAgb3JkZXIuZm9yRWFjaCgoaWR4LCBrKSA9PiB7IG91dFtpZHhdID0gY2VsbHNba107IH0pO1xuICByZXR1cm4gb3V0O1xufVxuXG5leHBvcnQgdHlwZSBGU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYWQnO1xuZXhwb3J0IGludGVyZmFjZSBGaWdodGVyIHtcbiAgaWQ6IG51bWJlcjsgdGVhbTogMCB8IDE7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7XG4gIHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc6IG51bWJlcjtcbiAgaHA6IG51bWJlcjsgbWF4SHA6IG51bWJlcjsgZG1nOiBudW1iZXI7IGludGVydmFsOiBudW1iZXI7IHJhbmdlOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IHJhZGl1czogbnVtYmVyO1xuICBhbGl2ZTogYm9vbGVhbjsgc3RhdGU6IEZTdGF0ZTtcbiAgdGFyZ2V0OiBudW1iZXI7IHJldGFyZ2V0QXQ6IG51bWJlcjsgZm9yY2VkVGFyZ2V0OiBudW1iZXI7IGZvcmNlZFVudGlsOiBudW1iZXI7XG4gIG5leHRBdHRhY2s6IG51bWJlcjsgYXR0YWNrU3RhcnQ6IG51bWJlcjsgYXR0YWNrRHVyOiBudW1iZXI7IGFuaW1TcGVlZDogbnVtYmVyOyBoaXREb25lOiBib29sZWFuO1xuICBtYW5hOiBudW1iZXI7IG1heE1hbmE6IG51bWJlcjsgY2FzdGluZzogYm9vbGVhbjsgZnJlbnp5OiBudW1iZXI7IGRlYWRBdDogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBCRXZlbnQgPVxuICB8IHsgdDogJ3N3aW5nJzsgaWQ6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2hpdCc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXI7IGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAnYXJyb3cnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdkZWF0aCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ2Nhc3QnOyBpZDogbnVtYmVyOyBza2lsbDogJ3NwbGl0JyB8ICd0YXVudCcgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICd0YXVudCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ3NtYXNoJzsgaWQ6IG51bWJlcjsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHI6IG51bWJlciB9XG4gIHwgeyB0OiAnZnJlbnp5JzsgaWQ6IG51bWJlcjsgc3RhY2tzOiBudW1iZXIgfTtcblxuZXhwb3J0IGNsYXNzIEJhdHRsZSB7XG4gIHRpbWUgPSAwO1xuICBmaWdodGVyczogRmlnaHRlcltdID0gW107XG4gIGV2ZW50czogQkV2ZW50W10gPSBbXTtcbiAgd2lubmVyOiAtMSB8IDAgfCAxID0gLTE7XG4gIHJuZzogUm5nO1xuICBwcml2YXRlIHBlbmRpbmc6IHsgYXQ6IG51bWJlcjsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlciB9W10gPSBbXTtcbiAgcHJpdmF0ZSBuZXh0SWQgPSAxO1xuICBwcml2YXRlIGZsaXAgPSBmYWxzZTtcblxuICAvKiogYGxldmVsc2A6IHRoZSBwbGF5ZXIncyBwZXJtYW5lbnQgU291bCBsZXZlbHMgKGhlYWx0aCBhbmQgZGFtYWdlIGdyb3cgYSBsaXR0bGUgcGVyIGxldmVsKS4gRW5lbWllcyBuZXZlciB1c2UgdGhlbS4gKi9cbiAgY29uc3RydWN0b3IocGxheWVyczogU2xvdFtdLCBlbmVtaWVzOiBTcGVjW10sIHNlZWQgPSAxLCBsZXZlbHM/OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+KSB7XG4gICAgdGhpcy5ybmcgPSBtYWtlUm5nKHNlZWQpO1xuICAgIGZvciAoY29uc3QgcCBvZiBwbGF5ZXJzKSB0aGlzLmFkZCgwLCBwLnNvdWwsIHAuc3RhciwgcC5jZWxsLCBsZXZlbHM/LltwLnNvdWxdID8/IDEpO1xuICAgIGNvbnN0IGNlbGxzID0gZW5lbXlDZWxscyhlbmVtaWVzKTtcbiAgICBlbmVtaWVzLmZvckVhY2goKGUsIGkpID0+IHRoaXMuYWRkKDEsIGUuc291bCwgZS5zdGFyLCBjZWxsc1tpXSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIsIGxldmVsID0gMSk6IEZpZ2h0ZXIge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbc291bF0sIHAgPSBjZWxsUG9zKHRlYW0sIGNlbGwpO1xuICAgIGNvbnN0IGx2SHAgPSAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQi5sZXZlbC5ocCwgbHZEbWcgPSAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQi5sZXZlbC5kbWc7XG4gICAgY29uc3QgaHAgPSBzdC5ocCAqIEIuc3Rhci5ocFtzdGFyIC0gMV0gKiBsdkhwO1xuICAgIGNvbnN0IGY6IEZpZ2h0ZXIgPSB7XG4gICAgICBpZDogdGhpcy5uZXh0SWQrKywgdGVhbSwgc291bCwgc3RhciwgY2VsbCwgeDogcC54LCB6OiBwLnosIHlhdzogdGVhbSA9PT0gMCA/IDAgOiBNYXRoLlBJLFxuICAgICAgaHAsIG1heEhwOiBocCwgZG1nOiBzdC5kbWcgKiBCLnN0YXIuZG1nW3N0YXIgLSAxXSAqIGx2RG1nLCBpbnRlcnZhbDogc3QuaW50ZXJ2YWwsIHJhbmdlOiBzdC5yYW5nZSwgc3BlZWQ6IHN0LnNwZWVkLCByYWRpdXM6IHN0LnNpemUgKiBCLnN0YXIuc2NhbGVbc3RhciAtIDFdLFxuICAgICAgYWxpdmU6IHRydWUsIHN0YXRlOiAnaWRsZScsIHRhcmdldDogLTEsIHJldGFyZ2V0QXQ6IDAsIGZvcmNlZFRhcmdldDogLTEsIGZvcmNlZFVudGlsOiAwLFxuICAgICAgbmV4dEF0dGFjazogdGhpcy5ybmcubmV4dCgpICogMC4zLCBhdHRhY2tTdGFydDogLTksIGF0dGFja0R1cjogMSwgYW5pbVNwZWVkOiAxLCBoaXRGcmFjOiAwLCBoaXREb25lOiB0cnVlLFxuICAgICAgbWFuYTogMCwgbWF4TWFuYTogQi5tYW5hW3NvdWxdPy5tYXggPz8gMCwgY2FzdGluZzogZmFsc2UsIGZyZW56eTogMCwgZGVhZEF0OiAwLFxuICAgIH0gYXMgRmlnaHRlcjtcbiAgICB0aGlzLmZpZ2h0ZXJzLnB1c2goZik7IHJldHVybiBmO1xuICB9XG5cbiAgYnlJZChpZDogbnVtYmVyKTogRmlnaHRlciB8IHVuZGVmaW5lZCB7IHJldHVybiBpZCA8IDAgPyB1bmRlZmluZWQgOiB0aGlzLmZpZ2h0ZXJzW2lkIC0gMV07IH1cbiAgZm9lcyhmOiBGaWdodGVyKTogRmlnaHRlcltdIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8udGVhbSAhPT0gZi50ZWFtKTsgfVxuICBjb3VudCh0ZWFtOiAwIHwgMSk6IG51bWJlciB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLnJlZHVjZSgobiwgZikgPT4gbiArIChmLmFsaXZlICYmIGYudGVhbSA9PT0gdGVhbSA/IDEgOiAwKSwgMCk7IH1cbiAgZHJhaW4oKTogQkV2ZW50W10geyBjb25zdCBlID0gdGhpcy5ldmVudHM7IHRoaXMuZXZlbnRzID0gW107IHJldHVybiBlOyB9XG5cbiAgc3RlcChkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMud2lubmVyID49IDApIHJldHVybjtcbiAgICB0aGlzLnRpbWUgKz0gZHQ7IHRoaXMuZmxpcCA9ICF0aGlzLmZsaXA7XG4gICAgLy8gYXJyb3dzIHRoYXQgaGF2ZSBmaW5pc2hlZCBmbHlpbmdcbiAgICBmb3IgKGxldCBpID0gdGhpcy5wZW5kaW5nLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wZW5kaW5nW2ldO1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBwLmF0KSB7XG4gICAgICAgIHRoaXMucGVuZGluZy5zcGxpY2UoaSwgMSk7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5ieUlkKHAudG8pLCBmcm9tID0gdGhpcy5ieUlkKHAuZnJvbSk7XG4gICAgICAgIGlmICh0byAmJiB0by5hbGl2ZSAmJiBmcm9tKSB0aGlzLmRhbWFnZSh0bywgcC5kbWcsIGZyb20sICdhcnJvdycpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvcmRlciA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKHRoaXMuZmxpcCkgb3JkZXIucmV2ZXJzZSgpO1xuICAgIGZvciAoY29uc3QgZiBvZiBvcmRlcikgaWYgKGYuYWxpdmUpIHRoaXMudXBkYXRlKGYsIGR0KTtcbiAgICBjb25zdCBhID0gdGhpcy5jb3VudCgwKSwgYiA9IHRoaXMuY291bnQoMSk7XG4gICAgaWYgKCFhIHx8ICFiKSB0aGlzLndpbm5lciA9IGEgPyAwIDogMTtcbiAgICBlbHNlIGlmICh0aGlzLnRpbWUgPj0gQkFMQU5DRS5zaW0udGltZUxpbWl0KSB7XG4gICAgICBjb25zdCBocCA9ICh0OiAwIHwgMSkgPT4gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB0KS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCk7XG4gICAgICB0aGlzLndpbm5lciA9IGhwKDApID4gaHAoMSkgPyAwIDogMTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyLWZpZ2h0ZXIgdXBkYXRlXG4gIHByaXZhdGUgdXBkYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07XG4gICAgdGhpcy5zZXBhcmF0ZShmLCBkdCk7XG5cbiAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHtcbiAgICAgIGNvbnN0IHQgPSB0aGlzLnRpbWUgLSBmLmF0dGFja1N0YXJ0O1xuICAgICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAodGcgJiYgdGcuYWxpdmUpIHRoaXMuZmFjZShmLCB0Zy54IC0gZi54LCB0Zy56IC0gZi56LCBkdCk7XG4gICAgICBpZiAoIWYuaGl0RG9uZSAmJiB0ID49IGYuYXR0YWNrRHVyICogc3QuaGl0RnJhYykgeyBmLmhpdERvbmUgPSB0cnVlOyB0aGlzLnJlc29sdmVIaXQoZik7IH1cbiAgICAgIGlmICh0ID49IGYuYXR0YWNrRHVyKSBmLnN0YXRlID0gJ2lkbGUnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFjcXVpcmUoZik7XG4gICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmICghdGcgfHwgIXRnLmFsaXZlKSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IHJldHVybjsgfVxuICAgIGNvbnN0IGR4ID0gdGcueCAtIGYueCwgZHogPSB0Zy56IC0gZi56LCBkaXN0ID0gTWF0aC5oeXBvdChkeCwgZHopO1xuICAgIHRoaXMuZmFjZShmLCBkeCwgZHosIGR0KTtcbiAgICBpZiAoZGlzdCA8PSBmLnJhbmdlKSB7XG4gICAgICBpZiAodGhpcy50aW1lID49IGYubmV4dEF0dGFjaykgdGhpcy5zdGFydEF0dGFjayhmKTsgZWxzZSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IH1cbiAgICB9IGVsc2Uge1xuICAgICAgZi5zdGF0ZSA9ICdydW4nOyBjb25zdCBrID0gZi5zcGVlZCAqIGR0IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCk7IGYueCArPSBkeCAqIGs7IGYueiArPSBkeiAqIGs7IHRoaXMuZnJlbnp5RGVjYXkoZik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBmcmVuenlEZWNheShmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicgJiYgZi5mcmVuenkgPiAwICYmIHRoaXMudGltZSAtIChmLmF0dGFja1N0YXJ0ICsgZi5hdHRhY2tEdXIpID4gQkFMQU5DRS5mcmVuenkucmVzZXRBZnRlcikgZi5mcmVuenkgPSAwO1xuICB9XG5cbiAgcHJpdmF0ZSBmYWNlKGY6IEZpZ2h0ZXIsIGR4OiBudW1iZXIsIGR6OiBudW1iZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAoZHggKiBkeCArIGR6ICogZHogPCAxZS02KSByZXR1cm47XG4gICAgY29uc3Qgd2FudCA9IE1hdGguYXRhbjIoZHgsIGR6KTsgbGV0IGQgPSAoKHdhbnQgLSBmLnlhdyArIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSArIDIgKiBNYXRoLlBJKSAlICgyICogTWF0aC5QSSkgLSBNYXRoLlBJO1xuICAgIGYueWF3ICs9IE1hdGgubWF4KC05ICogZHQsIE1hdGgubWluKDkgKiBkdCwgZCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXBhcmF0ZShmOiBGaWdodGVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgayA9ICh3YW50IC0gbSkgLyBNYXRoLm1heChtLCAxZS0zKTsgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBmLnggKz0gcHggKiBzOyBmLnogKz0gcHogKiBzO1xuICB9XG5cbiAgcHJpdmF0ZSBhY3F1aXJlKGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5mb3JjZWRUYXJnZXQgPj0gMCkge1xuICAgICAgY29uc3QgZnQgPSB0aGlzLmJ5SWQoZi5mb3JjZWRUYXJnZXQpO1xuICAgICAgaWYgKGZ0ICYmIGZ0LmFsaXZlICYmIHRoaXMudGltZSA8IGYuZm9yY2VkVW50aWwpIHsgZi50YXJnZXQgPSBmdC5pZDsgcmV0dXJuOyB9XG4gICAgICBmLmZvcmNlZFRhcmdldCA9IC0xO1xuICAgIH1cbiAgICBjb25zdCBjdXIgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmIChjdXIgJiYgY3VyLmFsaXZlICYmIHRoaXMudGltZSA8IGYucmV0YXJnZXRBdCkgcmV0dXJuO1xuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoc2NvcmUgPCBicykgeyBicyA9IHNjb3JlOyBiZXN0ID0gbzsgfVxuICAgIH1cbiAgICBmLnRhcmdldCA9IGJlc3QuaWQ7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0QXR0YWNrKGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07IGxldCBlZmYgPSBmLmludGVydmFsO1xuICAgIGlmIChmLnNvdWwgPT09ICdiYXJiYXJpYW4nKSB7IGYuZnJlbnp5ID0gTWF0aC5taW4oQi5mcmVuenkubWF4U3RhY2tzLCBmLmZyZW56eSArIDEpOyBlZmYgPSBmLmludGVydmFsIC8gKDEgKyBmLmZyZW56eSAqIEIuZnJlbnp5LnBlclN3aW5nKTsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdmcmVuenknLCBpZDogZi5pZCwgc3RhY2tzOiBmLmZyZW56eSB9KTsgfVxuICAgIGYuYXR0YWNrRHVyID0gTWF0aC5taW4oc3QuYW5pbUxlbiwgZWZmICogMC45NSk7IGYuYW5pbVNwZWVkID0gc3QuYW5pbUxlbiAvIGYuYXR0YWNrRHVyO1xuICAgIGYuYXR0YWNrU3RhcnQgPSB0aGlzLnRpbWU7IGYubmV4dEF0dGFjayA9IHRoaXMudGltZSArIE1hdGgubWF4KGVmZiwgZi5hdHRhY2tEdXIpOyBmLmhpdERvbmUgPSBmYWxzZTsgZi5zdGF0ZSA9ICdhdHRhY2snO1xuICAgIGYuY2FzdGluZyA9IGYubWF4TWFuYSA+IDAgJiYgZi5tYW5hID49IGYubWF4TWFuYTsgaWYgKGYuY2FzdGluZykgeyBmLm1hbmEgPSAwOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2Nhc3QnLCBpZDogZi5pZCwgc2tpbGw6IGYuc291bCA9PT0gJ2FyY2hlcicgPyAnc3BsaXQnIDogZi5zb3VsID09PSAna25pZ2h0JyA/ICd0YXVudCcgOiAnc21hc2gnIH0pOyB9XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdzd2luZycsIGlkOiBmLmlkLCBzcGVlZDogZi5hbmltU3BlZWQsIGR1cjogZi5hdHRhY2tEdXIgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVIaXQoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFOyBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7IGlmICghdGcgfHwgIXRnLmFsaXZlKSByZXR1cm47XG4gICAgY29uc3QgTSA9IEIubWFuYVtmLnNvdWxdOyBpZiAoTSAmJiAhZi5jYXN0aW5nKSBmLm1hbmEgPSBNYXRoLm1pbihNLm1heCwgZi5tYW5hICsgTS5wZXJBdHRhY2spO1xuICAgIGlmIChmLnNvdWwgPT09ICdhcmNoZXInKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGJhc2ljOiBvbmUgYXJyb3cuIFNraWxsIChTcGxpdCBBcnJvdyk6IG9uZSBhcnJvdyBhdCBlYWNoIG9mIHVwIHRvIDMgZGlmZmVyZW50IGVuZW1pZXNcbiAgICAgIGNvbnN0IHJlYWNoID0gZi5yYW5nZSAqIDEuMjU7XG4gICAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpLm1hcCgobykgPT4gKHsgbywgZDogTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgfSkpLmZpbHRlcigoZSkgPT4gZS5kIDw9IHJlYWNoKS5zb3J0KChhLCBiKSA9PiBhLmQgLSBiLmQpO1xuICAgICAgY29uc3QgcGlja2VkID0gZi5jYXN0aW5nID8gW3RnLCAuLi5mb2VzLm1hcCgoZSkgPT4gZS5vKS5maWx0ZXIoKG8pID0+IG8uaWQgIT09IHRnLmlkKV0uc2xpY2UoMCwgQi52b2xsZXkudGFyZ2V0cykgOiBbdGddO1xuICAgICAgZm9yIChjb25zdCBvIG9mIHBpY2tlZCkge1xuICAgICAgICBjb25zdCBkdXIgPSBNYXRoLm1heCgwLjE1LCBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSAvIEIudm9sbGV5LnByb2plY3RpbGVTcGVlZCk7XG4gICAgICAgIHRoaXMucGVuZGluZy5wdXNoKHsgYXQ6IHRoaXMudGltZSArIGR1ciwgZnJvbTogZi5pZCwgdG86IG8uaWQsIGRtZzogZi5kbWcgfSk7XG4gICAgICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnYXJyb3cnLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZHVyIH0pO1xuICAgICAgfVxuICAgICAgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjtcbiAgICB9XG4gICAgaWYgKE1hdGguaHlwb3QodGcueCAtIGYueCwgdGcueiAtIGYueikgPiBmLnJhbmdlICogMS41KSB7IGYuY2FzdGluZyA9IGZhbHNlOyByZXR1cm47IH0gICAvLyB0YXJnZXQgc2xpcHBlZCBhd2F5OiB0aGUgYmxvdyBtaXNzZXNcbiAgICBsZXQgZG1nID0gZi5kbWc7XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicpIHsgY29uc3QgZW5nID0gdGhpcy5ieUlkKHRnLnRhcmdldCk7IGlmIChlbmcgJiYgZW5nLmFsaXZlICYmIGVuZy50ZWFtID09PSBmLnRlYW0gJiYgZW5nLmlkICE9PSBmLmlkKSBkbWcgKj0gMSArIEIub3Bwb3J0dW5pc3QuYm9udXM7IH1cbiAgICBpZiAoZi5jYXN0aW5nKSB7XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTtcbiAgICAgIGlmIChmLnNvdWwgPT09ICdvZ3JlJykge1xuICAgICAgICBkbWcgKj0gQi5zbWFzaC5tdWx0OyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3NtYXNoJywgaWQ6IGYuaWQsIHg6IHRnLngsIHo6IHRnLnosIHI6IEIuc21hc2gucmFkaXVzIH0pO1xuICAgICAgICBmb3IgKGNvbnN0IG8gb2YgdGhpcy5mb2VzKGYpKSBpZiAoby5pZCAhPT0gdGcuaWQgJiYgTWF0aC5oeXBvdChvLnggLSB0Zy54LCBvLnogLSB0Zy56KSA8PSBCLnNtYXNoLnJhZGl1cykgdGhpcy5kYW1hZ2UobywgZG1nICogMC42LCBmLCAnc21hc2gnKTtcbiAgICAgICAgdGhpcy5kYW1hZ2UodGcsIGRtZywgZiwgJ3NtYXNoJyk7IHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChmLnNvdWwgPT09ICdrbmlnaHQnKSB7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSA8PSBCLnRhdW50LnJhZGl1cykgeyBvLmZvcmNlZFRhcmdldCA9IGYuaWQ7IG8uZm9yY2VkVW50aWwgPSB0aGlzLnRpbWUgKyBCLnRhdW50LmR1cmF0aW9uOyBvLnJldGFyZ2V0QXQgPSAwOyB9XG4gICAgICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAndGF1bnQnLCBpZDogZi5pZCB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5kYW1hZ2UodGcsIGRtZywgZiwgJ21lbGVlJyk7XG4gIH1cblxuICBwcml2YXRlIGRhbWFnZSh0OiBGaWdodGVyLCBhbW91bnQ6IG51bWJlciwgZnJvbTogRmlnaHRlciwga2luZDogJ21lbGVlJyB8ICdhcnJvdycgfCAnc21hc2gnKTogdm9pZCB7XG4gICAgaWYgKCF0LmFsaXZlKSByZXR1cm47XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGxldCByZWQgPSAwO1xuICAgIGlmICh0LnNvdWwgPT09ICd3YXJyaW9yJykge1xuICAgICAgY29uc3QgbiA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8gIT09IHQgJiYgby50ZWFtID09PSB0LnRlYW0gJiYgby5zb3VsID09PSAnd2FycmlvcicgJiYgTWF0aC5oeXBvdChvLnggLSB0LngsIG8ueiAtIHQueikgPD0gQi5waGFsYW54LnJhZGl1cykubGVuZ3RoO1xuICAgICAgcmVkID0gTWF0aC5taW4oQi5waGFsYW54Lm1heFN0YWNrcywgbikgKiBCLnBoYWxhbngucGVyQWxseTtcbiAgICB9XG4gICAgY29uc3QgZG1nID0gYW1vdW50ICogKDEgLSByZWQpOyB0LmhwIC09IGRtZztcbiAgICBjb25zdCBNID0gQi5tYW5hW3Quc291bF07IGlmIChNICYmIHQuaHAgPiAwKSB0Lm1hbmEgPSBNYXRoLm1pbihNLm1heCwgdC5tYW5hICsgTS5wZXJIaXQpO1xuICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnaGl0JywgZnJvbTogZnJvbS5pZCwgdG86IHQuaWQsIGRtZywga2luZCB9KTtcbiAgICBpZiAodC5ocCA8PSAwKSB7IHQuaHAgPSAwOyB0LmFsaXZlID0gZmFsc2U7IHQuc3RhdGUgPSAnZGVhZCc7IHQuZGVhZEF0ID0gdGhpcy50aW1lOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2RlYXRoJywgaWQ6IHQuaWQgfSk7IH1cbiAgfVxufVxuXG4vKiogUnVuIGEgd2hvbGUgZmlnaHQgd2l0aG91dCBhbnkgZ3JhcGhpY3MuIFJldHVybnMgd2hvIHdvbiBhbmQgaG93IGl0IHdlbnQuICovXG5leHBvcnQgZnVuY3Rpb24gc2ltdWxhdGUocGxheWVyczogU2xvdFtdLCBlbmVtaWVzOiBTcGVjW10sIHNlZWQgPSAxLCBtYXhTZWNvbmRzID0gMTMwKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQpO1xuICB3aGlsZSAoYi53aW5uZXIgPCAwICYmIGIudGltZSA8IG1heFNlY29uZHMpIGIuc3RlcCgxIC8gMzApO1xuICBjb25zdCB3ID0gKGIud2lubmVyIDwgMCA/IDEgOiBiLndpbm5lcikgYXMgMCB8IDE7XG4gIGNvbnN0IG1pbmUgPSBiLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHcpO1xuICByZXR1cm4geyB3aW5uZXI6IHcsIHRpbWU6IGIudGltZSwgbGVmdDogbWluZS5sZW5ndGgsIGhwTGVmdDogbWluZS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCkgfTtcbn1cbiIsICIvLyBFbmVteSB3YXZlcy4gU2FtZSB1bml0IHBvb2wgYXMgdGhlIHBsYXllci4gVGhlIGJ1aWxkIHNjcmVlbiBwcmV2aWV3cyB0aGUgQ09NUE9TSVRJT04gb25seSwgbmV2ZXIgcG9zaXRpb25zLlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMsIFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRW5lbXlTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXIgfVxuXG5jb25zdCBMRVRURVI6IFJlY29yZDxzdHJpbmcsIFNvdWxJZD4gPSB7IFc6ICd3YXJyaW9yJywgQTogJ2FyY2hlcicsIEc6ICdnb2JsaW4nLCBLOiAna25pZ2h0JywgTzogJ29ncmUnLCBCOiAnYmFyYmFyaWFuJyB9O1xuY29uc3QgcGFyc2VXYXZlID0gKHM6IHN0cmluZyk6IEVuZW15U3BlY1tdID0+IHMuc3BsaXQoJyAnKS5tYXAoKHQpID0+ICh7IHNvdWw6IExFVFRFUlt0WzBdXSwgc3RhcjogK3RbMV0gfSkpO1xuXG4vKipcbiAqIERpZmZpY3VsdHkgcHJlc2V0cyBmb3IgU3RhZ2UgMSAoMTAgd2F2ZXMpIChXIHdhcnJpb3IsIEEgYXJjaGVyLCBHIGdvYmxpbiwgSyBrbmlnaHQsIE8gb2dyZTsgZGlnaXQgPSBzdGFycykuXG4gKiBNZWFzdXJlZCB3aXRoIHNpbS90dW5lX3dhdmVzLnRzIGFnYWluc3Qgc3RhbmQtaW4gcGxheWVycyAoY29tcGV0ZW50IC8gY2FyZWxlc3MpLCBzdGFnZS1jbGVhciByYXRlOlxuICogICBlYXN5ICAgfjEwMCUgLyB+OTAlICAgICAgbm9ybWFsIH45NCUgLyB+NTElICAgICAgaGFyZCB+NzUlIC8gfjI2JVxuICogQSByZWFsIGh1bWFuIG9uIGEgcGhvbmUgaXMgbXVjaCBsZXNzIGNhcmVmdWwgdGhhbiB0aGUgY29tcGV0ZW50IHN0YW5kLWluLCBzbyBcIm5vcm1hbFwiIGlzIHRoZSBkZWZhdWx0LlxuICovXG5leHBvcnQgY29uc3QgRElGRklDVUxUWTogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0ge1xuICBlYXN5OiBbJ1cxJywgJ0sxIFcxJywgJ08xIFcxIEcxJywgJ0sxIEExIFcxJywgJ08xIEExIEcxJywgJ0sxIE8xIEExJywgJ0sxIE8xIEExIEcxJywgJ08xIEsxIEExIEcxJywgJ08xIEsxIEExIEIxJywgJ08yIEsxIEExIEcxJ10sXG4gIG5vcm1hbDogWydXMSBBMScsICdLMSBHMSBXMScsICdPMSBBMSBHMSBXMScsICdLMSBPMSBBMSBXMScsICdPMSBLMSBBMSBHMSBXMScsICdBMiBLMSBPMSBHMSBXMScsICdLMSBPMSBBMSBHMSBXMScsICdPMSBLMSBBMSBCMSBHMScsICdPMSBLMSBBMiBCMSBHMScsICdPMiBLMSBBMSBCMSBHMSBXMSddLFxuICBoYXJkOiBbJ1cxIEExJywgJ0sxIEcxIFcxIEExJywgJ08xIEExIEcxIFcxJywgJ0sxIE8xIEExIFcxIEcxJywgJ08xIEsxIEEyIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxJywgJ0sxIE8xIEExIEcxIFcyJywgJ08xIEsxIEEyIEIxIEcxJywgJ08yIEsxIEEyIEIxIEcxJywgJ08yIEsyIEExIEIxIEcxIFcxJ10sXG4gIG5pZ2h0bWFyZTogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMScsICdPMSBBMSBHMSBXMSBCMScsICdLMSBPMSBBMSBXMSBHMScsICdPMSBLMSBBMiBHMSBXMScsICdBMiBLMSBPMSBHMSBXMSBCMScsICdLMSBPMSBBMiBHMSBXMSBCMScsICdPMSBLMiBBMiBCMSBHMScsICdPMiBLMSBBMiBCMSBHMSBXMScsICdPMiBLMiBBMiBCMSBHMSBXMSddLFxufTtcblxuLyoqIE5hbWVzIGFuZCBvbmUtbGluZSBwcm9taXNlcyBmb3IgdGhlIGRpZmZpY3VsdHkgcGlja2VyLiBNZWFzdXJlZCBzdGFnZS1jbGVhciByYXRlcyAoY29tcGV0ZW50IC8gY2FyZWxlc3Mgc3RhbmQtaW4pOiBlYXN5IDk4LzkwLCBub3JtYWwgODIvNDQsIGhhcmQgNTYvMTYsIG5pZ2h0bWFyZSAzMC84LiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFlfSU5GTyA9IFtcbiAgeyBpZDogJ2Vhc3knLCBsYWJlbDogJ0Vhc3knLCBibHVyYjogJ1NtYWxsZXIgZW5lbXkgYXJtaWVzLiBSZWxheCBhbmQgbGVhcm4gaG93IG1lcmdpbmcgd29ya3MuJyB9LFxuICB7IGlkOiAnbm9ybWFsJywgbGFiZWw6ICdOb3JtYWwnLCBibHVyYjogJ0EgZmFpciBmaWdodC4gTW9zdCBwbGF5ZXJzIGNsZWFyIGl0IHdpdGhpbiBhIHJ1biBvciB0d28uJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnU2hhcnBlciBhcm1pZXMuIE1pc3Rha2VzIGNvc3QgaGVhcnRzLicgfSxcbiAgeyBpZDogJ25pZ2h0bWFyZScsIGxhYmVsOiAnTmlnaHRtYXJlJywgYmx1cmI6ICdTdGFycyBhbmQgc2tpbGxzIGV2ZXJ5d2hlcmUuIEV4cGVjdCB0byBsb3NlIGhlYXJ0cywgYW5kIHRvIGVhcm4gdGhlIHdpbi4nIH0sXG5dO1xuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZSA9ICdub3JtYWwnO1xuXG4vKiogSGFuZC1hdXRob3JlZCB3YXZlcyBmb3IgU3RhZ2UgMSAoMTAgd2F2ZXMpLiBCdWRnZXRzIH4gdGhlIHBsYXllcidzIGNhcCBhdCB0aGF0IHdhdmUuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXREaWZmaWN1bHR5LiAqL1xuZXhwb3J0IGNvbnN0IEFVVEhPUkVEOiBFbmVteVNwZWNbXVtdID0gRElGRklDVUxUWS5ub3JtYWwubWFwKHBhcnNlV2F2ZSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXREaWZmaWN1bHR5KG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIURJRkZJQ1VMVFlbbmFtZV0pIHJldHVybjtcbiAgZGlmZmljdWx0eU5hbWUgPSBuYW1lOyBBVVRIT1JFRC5sZW5ndGggPSAwOyBESUZGSUNVTFRZW25hbWVdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG5cbmV4cG9ydCBjb25zdCB3YXZlQ29zdCA9ICh3OiBFbmVteVNwZWNbXSk6IG51bWJlciA9PiB3LnJlZHVjZSgobiwgZSkgPT4gbiArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXSwgMCk7XG5cbi8qKiBFbmVteSBhcm15IGZvciBhIHdhdmUgKDEtYmFzZWQpLiBXYXZlcyBwYXN0IHRoZSBhdXRob3JlZCBvbmVzIGFyZSBnZW5lcmF0ZWQgZnJvbSBhIGZpeGVkIHNlZWQgc28gcmV0cmllcyBmYWNlIHRoZSBzYW1lIGFybXkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlXYXZlKHdhdmU6IG51bWJlciwgc3RhZ2VTZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgaWYgKHdhdmUgPD0gQVVUSE9SRUQubGVuZ3RoKSByZXR1cm4gQVVUSE9SRURbd2F2ZSAtIDFdLm1hcCgoZSkgPT4gKHsgLi4uZSB9KSk7XG4gIGNvbnN0IGNhcCA9IENVUlZFUy5kb2NbTWF0aC5taW4od2F2ZSwgQ1VSVkVTLmRvYy5sZW5ndGgpIC0gMV07XG4gIGNvbnN0IGJ1ZGdldCA9IE1hdGgucm91bmQoY2FwICogMC45Mik7XG4gIGNvbnN0IHJuZyA9IG1ha2VSbmcoc3RhZ2VTZWVkICogMTAwOSArIHdhdmUgKiA3OTE5KTtcbiAgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA0MCAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2soU09VTFMpO1xuICAgIGxldCBzdGFyID0gMTtcbiAgICBpZiAocm5nLm5leHQoKSA8IDAuMzUgJiYgQ09TVFtzb3VsXVsxXSA8PSBsZWZ0KSBzdGFyID0gMjtcbiAgICBpZiAod2F2ZSA+PSA2ICYmIHJuZy5uZXh0KCkgPCAwLjI1ICYmIENPU1Rbc291bF1bMl0gPD0gbGVmdCkgc3RhciA9IDM7XG4gICAgY29uc3QgYyA9IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICAgIGlmIChjIDw9IGxlZnQgJiYgYXJteS5sZW5ndGggPCAxMikgeyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IGM7IH1cbiAgfVxuICByZXR1cm4gYXJteTtcbn1cblxuLyoqIFdoYXQgdGhlIGJ1aWxkIHNjcmVlbiBzaG93czogY291bnRzIHBlciBTb3VsIGFuZCBzdGFyLCBubyBwb3NpdGlvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcHJldmlld1RleHQodzogRW5lbXlTcGVjW10pOiB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH1bXSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXA8c3RyaW5nLCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH0+KCk7XG4gIGZvciAoY29uc3QgZSBvZiB3KSB7XG4gICAgY29uc3QgayA9IGUuc291bCArIGUuc3RhcjtcbiAgICBjb25zdCBjdXIgPSBtYXAuZ2V0KGspO1xuICAgIGlmIChjdXIpIGN1ci5jb3VudCsrOyBlbHNlIG1hcC5zZXQoaywgeyBzb3VsOiBlLnNvdWwsIHN0YXI6IGUuc3RhciwgY291bnQ6IDEgfSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldO1xufVxuIiwgImltcG9ydCB7IENVUlZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuLyoqXG4gKiBSdWxlcyBmb3IgdGhlIHBsYXlhYmxlIFN0YWdlIDEgKDEwIHdhdmVzKTogZG9jIERvbWluaW9uIGN1cnZlLCBib251cyBkcmF3IG9ubHkgb24gdGhlIGVhcmx5IHdhdmVzLlxuICogbWVyZ2UgJ2hhbmRJbnRvT25lU3Rhcic6IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gbWVyZ2Ugc3RyYWlnaHQgaW50byBhIG1hdGNoaW5nIGRlcGxveWVkIDEtc3RhciB1bml0IChwYXlpbmcgb25seSB0aGUgY29zdFxuICogZGlmZmVyZW5jZSkuIFdpdGhvdXQgaXQgdGhlIGNhcCBjYW4gYmxvY2sgYSBtZXJnZSB5b3UgY291bGQgYWZmb3JkICh5b3Ugd291bGQgbmVlZCByb29tIHRvIHN1bW1vbiBCT1RIIGNvcGllcyBmaXJzdCkuXG4gKiBUaGUgZGVidWcgcGFuZWwgY2FuIHN3aXRjaCB0aGlzIGJhY2sgdG8gdGhlIGRvYydzIGRlcGxveWVkLW9ubHkgcnVsZS5cbiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPVFlQRV9SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBDVVJWRVMuZG9jLCBtZXJnZTogJ2hhbmRJbnRvT25lU3RhcicsIHN0YWdlV2F2ZXM6IDEwLCBub3JtYWxEcmF3V2F2ZXM6IFsyLCAzLCA0LCA1XSB9O1xuIiwgIi8vIFNvdWwgUGFja3MgKHBsYW4gZG9jIHNlY3Rpb24gMTcpLiBQdXJlIHJ1bGVzLCBubyBncmFwaGljcy4gQUxMIE5VTUJFUlMgQVJFIFBMQUNFSE9MREVSIExFVkVSUzogd2Ugc2V0dGxlZCB0aGUgc3RydWN0dXJlIGZpcnN0IGFuZCB3aWxsIHR1bmVcbi8vIHF1YW50aXRpZXMgd2l0aCB0aGUgcHJvZ3Jlc3Npb24gc2ltdWxhdGlvbiAoc2ltL3Byb2dyZXNzaW9uLnRzKSBvbmNlIHRoZSBsb29wIGNhbiBiZSBwbGF5ZWQuXG4vL1xuLy8gICBTb3VsIHJhcml0eSAgLT4gaG93IG9mdGVuIGEgU291bCBzaG93cyB1cCBhbmQgaG93IGJpZyBpdHMgc3RhY2sgb2YgY29waWVzIHRlbmRzIHRvIGJlLlxuLy8gICBQYWNrIHRpZXIgICAgLT4gdGhlIHBhY2sncyBvdmVyYWxsIHZhbHVlIChza3VsbHMsIDEtMyBmb3Igbm93KTogbnVtYmVyIG9mIHJldmVhbHMgKyBob3cgZ29vZCB0aGUgcmFyaXR5IG9kZHMgYXJlLlxuLy8gICBBIHBhY2sgaGFzIGEgU1RBUlRJTkcgdGllciBhbmQgbWF5IHVwZ3JhZGUgd2hpbGUgaXQgaXMgYmVpbmcgb3BlbmVkOyB0aGUgcmVzdWx0IGlzIGRlY2lkZWQgdXAgZnJvbnQsIHRoZSBhbmltYXRpb24gb25seSBzaG93cyBpdC5cblxuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCB0eXBlIFJhcml0eSA9ICdjb21tb24nIHwgJ3JhcmUnIHwgJ2VwaWMnIHwgJ2xlZ2VuZGFyeSc7XG5leHBvcnQgY29uc3QgUkFSSVRJRVM6IFJhcml0eVtdID0gWydjb21tb24nLCAncmFyZScsICdlcGljJywgJ2xlZ2VuZGFyeSddO1xuZXhwb3J0IGNvbnN0IFJBUklUWV9OQU1FOiBSZWNvcmQ8UmFyaXR5LCBzdHJpbmc+ID0geyBjb21tb246ICdDb21tb24nLCByYXJlOiAnUmFyZScsIGVwaWM6ICdFcGljJywgbGVnZW5kYXJ5OiAnTGVnZW5kYXJ5JyB9O1xuXG4vKiogUmFyaXR5IHBlciBTb3VsLiBQTEFDRUhPTERFUiBhc3NpZ25tZW50IChubyBMZWdlbmRhcnkgU291bCBleGlzdHMgeWV0KS4gKi9cbmV4cG9ydCBjb25zdCBSQVJJVFlfT0Y6IFJlY29yZDxTb3VsSWQsIFJhcml0eT4gPSB7IHdhcnJpb3I6ICdjb21tb24nLCBnb2JsaW46ICdjb21tb24nLCBhcmNoZXI6ICdyYXJlJywga25pZ2h0OiAncmFyZScsIG9ncmU6ICdlcGljJywgYmFyYmFyaWFuOiAnZXBpYycgfTtcblxuLyoqIFJhcmVyIFNvdWxzIHR1cm4gdXAgaW4gc21hbGxlciBzdGFja3MsIHNvIHRoZXkgbmVlZCBmZXdlciBjb3BpZXMgcGVyIGxldmVsIChtdWx0aXBsaWVyIG9uIHRoZSBsZXZlbCBjb3N0cykuIFBMQUNFSE9MREVSLiAqL1xuZXhwb3J0IGNvbnN0IExFVkVMX0NPU1RfTVVMVDogUmVjb3JkPFJhcml0eSwgbnVtYmVyPiA9IHsgY29tbW9uOiAxLCByYXJlOiAwLjYsIGVwaWM6IDAuMzUsIGxlZ2VuZGFyeTogMC4yIH07XG5cbmV4cG9ydCBjb25zdCBQQUNLX1RJRVJTID0gMztcbmV4cG9ydCBjb25zdCBQQUNLID0ge1xuICByZXZlYWxzOiBbMywgNCwgNV0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXBhcmF0ZSByZXZlYWxzIHBlciB0aWVyIChpbmRleCAwID0gdGllciAxKVxuICBzdGFja011bHQ6IFsxLCAxLjUsIDJdLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjb3B5IHN0YWNrcyBhcmUgYmlnZ2VyIGluIGJldHRlciBwYWNrc1xuICAvKiogUmFyaXR5IG9kZHMgcGVyIHRpZXIsIGluIHBlcmNlbnQuICovXG4gIG9kZHM6IFtcbiAgICB7IGNvbW1vbjogNzAsIHJhcmU6IDI1LCBlcGljOiA1LCBsZWdlbmRhcnk6IDAgfSxcbiAgICB7IGNvbW1vbjogNTUsIHJhcmU6IDMzLCBlcGljOiAxMSwgbGVnZW5kYXJ5OiAxIH0sXG4gICAgeyBjb21tb246IDQwLCByYXJlOiAzOCwgZXBpYzogMTksIGxlZ2VuZGFyeTogMyB9LFxuICBdIGFzIFJlY29yZDxSYXJpdHksIG51bWJlcj5bXSxcbiAgLyoqIENvcGllcyBpbiBvbmUgcmV2ZWFsIGJlZm9yZSB0aGUgdGllciBtdWx0aXBsaWVyOiBbbWluLCBtYXhdLiAqL1xuICBzdGFjazogeyBjb21tb246IFs2LCAxMF0sIHJhcmU6IFszLCA1XSwgZXBpYzogWzEsIDNdLCBsZWdlbmRhcnk6IFsxLCAxXSB9IGFzIFJlY29yZDxSYXJpdHksIFtudW1iZXIsIG51bWJlcl0+LFxuICAvKiogQ2hhbmNlIHRvIGp1bXAgdXAgb25lIHRpZXIgZHVyaW5nIHRoZSBvcGVuaW5nLCBmcm9tIHRpZXIgMSBhbmQgZnJvbSB0aWVyIDIgKGEgbHVja3kgcGFjayBjYW4ganVtcCB0d2ljZSkuICovXG4gIHVwZ3JhZGVDaGFuY2U6IFswLjIsIDAuMTJdLFxufTtcblxuLyoqIEFuIHVub3BlbmVkIHBhY2sgdGhlIHBsYXllciBvd25zLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYWNrSXRlbSB7IGlkOiBudW1iZXI7IHRpZXI6IG51bWJlcjsgc291cmNlOiBzdHJpbmcgfVxuZXhwb3J0IGludGVyZmFjZSBSZXZlYWwgeyBzb3VsOiBTb3VsSWQ7IHJhcml0eTogUmFyaXR5OyBjb3BpZXM6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFBhY2tSZXN1bHQgeyBzdGFydFRpZXI6IG51bWJlcjsgZmluYWxUaWVyOiBudW1iZXI7IHVwZ3JhZGVzOiBudW1iZXJbXTsgcmV2ZWFsczogUmV2ZWFsW10gfVxuXG5jb25zdCByYXJpdHlSYW5rID0gKHI6IFJhcml0eSkgPT4gUkFSSVRJRVMuaW5kZXhPZihyKTtcblxuZnVuY3Rpb24gcm9sbFJhcml0eSh0aWVyOiBudW1iZXIsIHJuZzogUm5nKTogUmFyaXR5IHtcbiAgY29uc3Qgb2RkcyA9IFBBQ0sub2Rkc1t0aWVyIC0gMV07IGxldCByb2xsID0gcm5nLm5leHQoKSAqIFJBUklUSUVTLnJlZHVjZSgobiwgcikgPT4gbiArIG9kZHNbcl0sIDApO1xuICBmb3IgKGNvbnN0IHIgb2YgUkFSSVRJRVMpIHsgaWYgKHJvbGwgPCBvZGRzW3JdKSByZXR1cm4gcjsgcm9sbCAtPSBvZGRzW3JdOyB9XG4gIHJldHVybiAnY29tbW9uJztcbn1cblxuLyoqIEEgcmFuZG9tIFNvdWwgb2YgdGhpcyByYXJpdHk7IGlmIHRoZSByb3N0ZXIgaGFzIG5vbmUgb2YgdGhhdCByYXJpdHkgeWV0LCB0aGUgbmV4dCBsb3dlciBvbmUgaXMgdXNlZC4gKi9cbmZ1bmN0aW9uIHNvdWxPZlJhcml0eShyYXJpdHk6IFJhcml0eSwgcm5nOiBSbmcpOiBTb3VsSWQge1xuICBmb3IgKGxldCBpID0gcmFyaXR5UmFuayhyYXJpdHkpOyBpID49IDA7IGktLSkgeyBjb25zdCBwb29sID0gU09VTFMuZmlsdGVyKChzKSA9PiBSQVJJVFlfT0Zbc10gPT09IFJBUklUSUVTW2ldKTsgaWYgKHBvb2wubGVuZ3RoKSByZXR1cm4gcm5nLnBpY2socG9vbCk7IH1cbiAgcmV0dXJuIHJuZy5waWNrKFNPVUxTKTtcbn1cblxuLyoqIE9wZW4gYSBwYWNrOiByb2xsIHVwZ3JhZGVzIGZpcnN0IChzbyB0aGUgYW5pbWF0aW9uIGNhbiBwbGF5IHRoZW0gYmVmb3JlIHRoZSBwYWNrIHRlYXJzIG9wZW4pLCB0aGVuIHRoZSByZXZlYWxzLiBCZXN0IHJldmVhbCBjb21lcyBsYXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5QYWNrKHN0YXJ0VGllcjogbnVtYmVyLCBybmc6IFJuZyk6IFBhY2tSZXN1bHQge1xuICBjb25zdCB0MCA9IE1hdGgubWF4KDEsIE1hdGgubWluKFBBQ0tfVElFUlMsIE1hdGguZmxvb3Ioc3RhcnRUaWVyKSkpLCB1cGdyYWRlczogbnVtYmVyW10gPSBbXTtcbiAgbGV0IHRpZXIgPSB0MDtcbiAgd2hpbGUgKHRpZXIgPCBQQUNLX1RJRVJTICYmIHJuZy5uZXh0KCkgPCBQQUNLLnVwZ3JhZGVDaGFuY2VbdGllciAtIDFdKSB7IHRpZXIrKzsgdXBncmFkZXMucHVzaCh0aWVyKTsgfVxuICBjb25zdCByZXZlYWxzOiBSZXZlYWxbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IFBBQ0sucmV2ZWFsc1t0aWVyIC0gMV07IGkrKykge1xuICAgIGNvbnN0IHJhcml0eSA9IHJvbGxSYXJpdHkodGllciwgcm5nKSwgc291bCA9IHNvdWxPZlJhcml0eShyYXJpdHksIHJuZyksIFtsbywgaGldID0gUEFDSy5zdGFja1tSQVJJVFlfT0Zbc291bF1dO1xuICAgIHJldmVhbHMucHVzaCh7IHNvdWwsIHJhcml0eTogUkFSSVRZX09GW3NvdWxdLCBjb3BpZXM6IE1hdGgubWF4KDEsIE1hdGgucm91bmQoKGxvICsgcm5nLmludChoaSAtIGxvICsgMSkpICogUEFDSy5zdGFja011bHRbdGllciAtIDFdKSkgfSk7XG4gIH1cbiAgcmV2ZWFscy5zb3J0KChhLCBiKSA9PiByYXJpdHlSYW5rKGEucmFyaXR5KSAtIHJhcml0eVJhbmsoYi5yYXJpdHkpIHx8IGEuY29waWVzIC0gYi5jb3BpZXMpO1xuICByZXR1cm4geyBzdGFydFRpZXI6IHQwLCBmaW5hbFRpZXI6IHRpZXIsIHVwZ3JhZGVzLCByZXZlYWxzIH07XG59XG5cbi8qKiBUb3RhbCBjb3BpZXMgcGVyIFNvdWwgaW4gYSByZXN1bHQgKHRoZSBzYW1lIFNvdWwgY2FuIGJlIHJldmVhbGVkIG1vcmUgdGhhbiBvbmNlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3BpZXNCeVNvdWwocmVzdWx0OiBQYWNrUmVzdWx0KTogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiB7XG4gIGNvbnN0IG91dDogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiA9IHt9O1xuICBmb3IgKGNvbnN0IHIgb2YgcmVzdWx0LnJldmVhbHMpIG91dFtyLnNvdWxdID0gKG91dFtyLnNvdWxdID8/IDApICsgci5jb3BpZXM7XG4gIHJldHVybiBvdXQ7XG59XG4iLCAiLy8gVGhlIHBsYXllcidzIHNhdmVkIHByb2dyZXNzLiBGcmFtZXdvcmstZnJlZSBzbyB0aGUgZ2FtZSBidW5kbGUgYW5kIHRoZSBuYXZpZ2F0aW9uIHNoZWxsIGJvdGggdXNlIGl0LlxuLy8gU3RvcmVkIGluIGxvY2FsU3RvcmFnZSBhcyBKU09OLiBFdmVyeSByZWFkL3dyaXRlIGlzIGd1YXJkZWQ6IHByaXZhdGUgd2luZG93cyBhbmQgYmxvY2tlZCBzdG9yYWdlIG11c3QgbmV2ZXIgYnJlYWsgdGhlIGdhbWUuXG5cbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IFBBQ0tfVElFUlMgfSBmcm9tICcuL3BhY2tzLnRzJztcbmltcG9ydCB0eXBlIHsgUGFja0l0ZW0gfSBmcm9tICcuL3BhY2tzLnRzJztcblxuZXhwb3J0IGNvbnN0IERFQ0tfU0laRSA9IDY7ICAgICAgICAgICAgICAgICAgICAgLy8gZG9jOiBzaXggZXF1aXBwZWQgU291bHMgcGVyIHN0YWdlXG5jb25zdCBLRVkgPSAnbmVjcm8tc2F2ZSc7XG5jb25zdCBWRVJTSU9OID0gMTtcblxuZXhwb3J0IHR5cGUgRGlmZmljdWx0eSA9ICdlYXN5JyB8ICdub3JtYWwnIHwgJ2hhcmQnIHwgJ25pZ2h0bWFyZSc7XG5leHBvcnQgY29uc3QgRElGRklDVUxUSUVTOiBEaWZmaWN1bHR5W10gPSBbJ2Vhc3knLCAnbm9ybWFsJywgJ2hhcmQnLCAnbmlnaHRtYXJlJ107XG5leHBvcnQgaW50ZXJmYWNlIFNldHRpbmdzIHsgbXVzaWM6IGJvb2xlYW47IHNmeDogYm9vbGVhbiB9XG5leHBvcnQgaW50ZXJmYWNlIFNvdWxQcm9ncmVzcyB7IGxldmVsOiBudW1iZXI7IGNvcGllczogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgU2F2ZSB7XG4gIHY6IG51bWJlcjtcbiAgZGVjazogU291bElkW107ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGVxdWlwcGVkIFNvdWxzLCBhdCBtb3N0IERFQ0tfU0laRSwgYXQgbGVhc3QgMVxuICBzb3VsczogUmVjb3JkPFNvdWxJZCwgU291bFByb2dyZXNzPjsgICAgICAgICAgLy8gUExBQ0VIT0xERVIgcHJvZ3Jlc3Npb24gdW50aWwgcGFja3MgZXhpc3RcbiAgc2V0dGluZ3M6IFNldHRpbmdzOyAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNvdW5kIHN3aXRjaGVzOyBib3RoIG9uIGJ5IGRlZmF1bHRcbiAgZGlmZmljdWx0eTogRGlmZmljdWx0eTsgICAgICAgICAgICAgICAgICAgICAgIC8vIGNob3NlbiBvbiBIb21lOyBhcHBsaWVzIHRvIHRoZSBuZXh0IHJ1blxuICBwYWNrczogUGFja0l0ZW1bXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5vcGVuZWQgU291bCBQYWNrc1xuICBuZXh0UGFja0lkOiBudW1iZXI7XG4gIGNsZWFyczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjsgICAgICAgICAgICAgICAvLyBzdGFnZSBjbGVhcnMsIGtleWVkICdzdGFnZTpkaWZmaWN1bHR5J1xuICByZXBsYXlNZXRlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwbGF5IGNsZWFycyB0b3dhcmQgdGhlIG5leHQgcmVwbGF5IHBhY2tcbn1cbmV4cG9ydCBpbnRlcmZhY2UgU3RvcmUgeyBnZXRJdGVtKGs6IHN0cmluZyk6IHN0cmluZyB8IG51bGw7IHNldEl0ZW0oazogc3RyaW5nLCB2OiBzdHJpbmcpOiB2b2lkIH1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRTYXZlKCk6IFNhdmUge1xuICBjb25zdCBzb3VscyA9IHt9IGFzIFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47XG4gIGZvciAoY29uc3QgaWQgb2YgU09VTFMpIHNvdWxzW2lkXSA9IHsgbGV2ZWw6IDEsIGNvcGllczogMCB9O1xuICByZXR1cm4geyB2OiBWRVJTSU9OLCBkZWNrOiBTT1VMUy5zbGljZSgwLCBERUNLX1NJWkUpLCBzb3Vscywgc2V0dGluZ3M6IHsgbXVzaWM6IHRydWUsIHNmeDogdHJ1ZSB9LCBkaWZmaWN1bHR5OiAnbm9ybWFsJywgcGFja3M6IFtdLCBuZXh0UGFja0lkOiAxLCBjbGVhcnM6IHt9LCByZXBsYXlNZXRlcjogMCB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnJvd3NlclN0b3JlKCk6IFN0b3JlIHwgbnVsbCB7IHRyeSB7IHJldHVybiB0eXBlb2YgbG9jYWxTdG9yYWdlID09PSAndW5kZWZpbmVkJyA/IG51bGwgOiBsb2NhbFN0b3JhZ2U7IH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfSB9XG5cbi8qKiBSZXBhaXIgd2hhdGV2ZXIgd2FzIHN0b3JlZDogdW5rbm93biBTb3VscyBkcm9wcGVkLCBkdXBsaWNhdGVzIHJlbW92ZWQsIGRlY2sgY2FwcGVkLCBub3RoaW5nIGVtcHR5LiBPbGQgdmVyc2lvbnMga2VlcCB0aGVpciBwcm9ncmVzcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZShyYXc6IGFueSk6IFNhdmUge1xuICBjb25zdCBiYXNlID0gZGVmYXVsdFNhdmUoKTtcbiAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gJ29iamVjdCcpIHJldHVybiBiYXNlO1xuICBjb25zdCBkZWNrOiBTb3VsSWRbXSA9IFtdO1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcuZGVjaykpIGZvciAoY29uc3QgZCBvZiByYXcuZGVjaykgaWYgKFNPVUxTLmluY2x1ZGVzKGQpICYmICFkZWNrLmluY2x1ZGVzKGQpICYmIGRlY2subGVuZ3RoIDwgREVDS19TSVpFKSBkZWNrLnB1c2goZCk7XG4gIGlmIChkZWNrLmxlbmd0aCkgYmFzZS5kZWNrID0gZGVjaztcbiAgaWYgKHJhdy5zb3VscyAmJiB0eXBlb2YgcmF3LnNvdWxzID09PSAnb2JqZWN0Jykge1xuICAgIGZvciAoY29uc3QgaWQgb2YgU09VTFMpIHtcbiAgICAgIGNvbnN0IHAgPSByYXcuc291bHNbaWRdO1xuICAgICAgaWYgKHAgJiYgTnVtYmVyLmlzRmluaXRlKHAubGV2ZWwpICYmIE51bWJlci5pc0Zpbml0ZShwLmNvcGllcykpIGJhc2Uuc291bHNbaWRdID0geyBsZXZlbDogTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihwLmxldmVsKSksIGNvcGllczogTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihwLmNvcGllcykpIH07XG4gICAgfVxuICB9XG4gIGlmIChyYXcuc2V0dGluZ3MgJiYgdHlwZW9mIHJhdy5zZXR0aW5ncyA9PT0gJ29iamVjdCcpIHtcbiAgICBpZiAodHlwZW9mIHJhdy5zZXR0aW5ncy5tdXNpYyA9PT0gJ2Jvb2xlYW4nKSBiYXNlLnNldHRpbmdzLm11c2ljID0gcmF3LnNldHRpbmdzLm11c2ljO1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLnNmeCA9PT0gJ2Jvb2xlYW4nKSBiYXNlLnNldHRpbmdzLnNmeCA9IHJhdy5zZXR0aW5ncy5zZng7XG4gIH1cbiAgaWYgKERJRkZJQ1VMVElFUy5pbmNsdWRlcyhyYXcuZGlmZmljdWx0eSkpIGJhc2UuZGlmZmljdWx0eSA9IHJhdy5kaWZmaWN1bHR5O1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcucGFja3MpKSB7XG4gICAgY29uc3QgaWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHJhdy5wYWNrcykge1xuICAgICAgaWYgKGJhc2UucGFja3MubGVuZ3RoID49IDk5IHx8ICFwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHAuaWQpIHx8IHAuaWQgPCAxIHx8IGlkcy5oYXMocC5pZCkgfHwgIU51bWJlci5pc0ludGVnZXIocC50aWVyKSB8fCBwLnRpZXIgPCAxIHx8IHAudGllciA+IFBBQ0tfVElFUlMpIGNvbnRpbnVlO1xuICAgICAgaWRzLmFkZChwLmlkKTsgYmFzZS5wYWNrcy5wdXNoKHsgaWQ6IHAuaWQsIHRpZXI6IHAudGllciwgc291cmNlOiB0eXBlb2YgcC5zb3VyY2UgPT09ICdzdHJpbmcnID8gcC5zb3VyY2Uuc2xpY2UoMCwgNDApIDogJycgfSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IG1heElkID0gYmFzZS5wYWNrcy5yZWR1Y2UoKG4sIHApID0+IE1hdGgubWF4KG4sIHAuaWQpLCAwKTtcbiAgYmFzZS5uZXh0UGFja0lkID0gTWF0aC5tYXgobWF4SWQgKyAxLCBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5uZXh0UGFja0lkKSAmJiByYXcubmV4dFBhY2tJZCA+IDAgPyByYXcubmV4dFBhY2tJZCA6IDEpO1xuICBpZiAocmF3LmNsZWFycyAmJiB0eXBlb2YgcmF3LmNsZWFycyA9PT0gJ29iamVjdCcpIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHJhdy5jbGVhcnMpKSBpZiAodHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDAgJiYgTnVtYmVyLmlzSW50ZWdlcih2KSAmJiAodiBhcyBudW1iZXIpID4gMCkgYmFzZS5jbGVhcnNba10gPSB2IGFzIG51bWJlcjtcbiAgaWYgKE51bWJlci5pc0ludGVnZXIocmF3LnJlcGxheU1ldGVyKSAmJiByYXcucmVwbGF5TWV0ZXIgPj0gMCAmJiByYXcucmVwbGF5TWV0ZXIgPCA1MCkgYmFzZS5yZXBsYXlNZXRlciA9IHJhdy5yZXBsYXlNZXRlcjtcbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cblxuLyoqIENoYW5nZSBzb3VuZCBzZXR0aW5ncyB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzKHBhdGNoOiBQYXJ0aWFsPFNldHRpbmdzPiwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2V0dGluZ3Mge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLnNldHRpbmdzID0geyAuLi5zLnNldHRpbmdzLCAuLi5wYXRjaCB9OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5zZXR0aW5ncztcbn1cblxuLyoqIFJlbWVtYmVyIHRoZSBjaG9zZW4gZGlmZmljdWx0eSB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZURpZmZpY3VsdHkoZDogRGlmZmljdWx0eSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogRGlmZmljdWx0eSB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuZGlmZmljdWx0eSA9IERJRkZJQ1VMVElFUy5pbmNsdWRlcyhkKSA/IGQgOiBzLmRpZmZpY3VsdHk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLmRpZmZpY3VsdHk7XG59XG4iLCAiLy8gVGhlIHBsYXllcidzIGNoYXJhY3RlcjogdGhlIE5lY3JvbWFuY2VyLiBBIHByb2NlZHVyYWwgcGxhY2Vob2xkZXIgKG5vIFRyaXBvIG1vZGVsIHlldCk6IGhvb2RlZCByb2JlLCBnbG93aW5nIHB1cnBsZSBleWVzLCBjcnlzdGFsIHN0YWZmLlxuLy8gSGUgc3RhbmRzIGJlc2lkZSB0aGUgZ3JpZCwgdGFrZXMgdGhlIGhpdCB3aGVuIGFuIGFybXkgaXMgd2lwZWQgKGhlYXJ0cyBhcmUgSElTIGhlYWx0aCksIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSBhbmQgcmFpc2VzXG4vLyB0aGUgZmFsbGVuLiBFdmVyeXRoaW5nIGhlcmUgaXMgYW5pbWF0aW9uIG9ubHk7IHRoZSBydWxlcyBsaXZlIGluIGNvcmUvcnVsZXMudHMuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuZXhwb3J0IGNsYXNzIE5lY3JvbWFuY2VyIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uOyBsb2NhbCArWiBpcyBoaXMgZmFjaW5nICh0aGUgZ2FtZSByb3RhdGVzIGhpbSB0byBmYWNlIHRoZSBiYXR0bGVmaWVsZClcbiAgcHJpdmF0ZSByaWc6IGFueTsgcHJpdmF0ZSBzdGFmZlBpdm90OiBhbnk7IHByaXZhdGUgY3J5c3RhbDogYW55OyBwcml2YXRlIGNyeXN0YWxNYXQ6IGFueTsgcHJpdmF0ZSByb2JlTWF0OiBhbnk7IHByaXZhdGUgZXllTWF0OiBhbnk7IHByaXZhdGUgcHM6IGFueTsgcHJpdmF0ZSBnbG93OiBhbnk7XG4gIHByaXZhdGUgdCA9IDA7IHByaXZhdGUgaHVydFQgPSAwOyBwcml2YXRlIGNhc3RUID0gMDsgcHJpdmF0ZSBkb3duID0gMDsgcHJpdmF0ZSBkb3duVGFyZ2V0ID0gMDtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHNjZW5lOiBhbnksIHByaXZhdGUgc29mdDogYW55KSB7XG4gICAgY29uc3QgcyA9IHNjZW5lLCBtYXQgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgZXIgPSAwLCBlZyA9IDAsIGViID0gMCkgPT4ge1xuICAgICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ25tJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHIsIGcsIGIpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoZXIsIGVnLCBlYik7IG0uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHJldHVybiBtO1xuICAgIH07XG4gICAgY29uc3QgZ2xvd01hdCA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyLCBhID0gMSkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbmcnLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IGE7IHJldHVybiBtOyB9O1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbmVjcm8nLCBzKTsgdGhpcy5yaWcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCduZWNyb1JpZycsIHMpOyB0aGlzLnJpZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICBjb25zdCBhZGQgPSAobWVzaDogYW55LCBwYXJlbnQgPSB0aGlzLnJpZykgPT4geyBtZXNoLnBhcmVudCA9IHBhcmVudDsgbWVzaC5pc1BpY2thYmxlID0gZmFsc2U7IHJldHVybiBtZXNoOyB9O1xuICAgIHRoaXMucm9iZU1hdCA9IG1hdCgwLjA5LCAwLjAzLCAwLjE2LCAwLjA1LCAwLjAyLCAwLjEpO1xuICAgIGNvbnN0IHJvYmUgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncm9iZScsIHsgaGVpZ2h0OiAwLjgyLCBkaWFtZXRlclRvcDogMC4zLCBkaWFtZXRlckJvdHRvbTogMC44LCB0ZXNzZWxsYXRpb246IDIwIH0sIHMpKTsgcm9iZS5wb3NpdGlvbi55ID0gMC40MTsgcm9iZS5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCBoZW0gPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnaGVtJywgeyBkaWFtZXRlcjogMC43OCwgdGhpY2tuZXNzOiAwLjAzNSwgdGVzc2VsbGF0aW9uOiAyOCB9LCBzKSk7IGhlbS5wb3NpdGlvbi55ID0gMC4wMzsgaGVtLm1hdGVyaWFsID0gZ2xvd01hdCgwLjksIDAuNywgMC4yNSk7XG4gICAgY29uc3QgbWFudGxlID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdtYW50bGUnLCB7IGRpYW1ldGVyOiAwLjYsIHNlZ21lbnRzOiAxMiB9LCBzKSk7IG1hbnRsZS5zY2FsaW5nLnNldCgxLCAwLjUsIDAuOCk7IG1hbnRsZS5wb3NpdGlvbi55ID0gMC44OyBtYW50bGUubWF0ZXJpYWwgPSB0aGlzLnJvYmVNYXQ7XG4gICAgY29uc3QgaG9vZCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnaG9vZCcsIHsgZGlhbWV0ZXI6IDAuNTYsIHNlZ21lbnRzOiAxNCB9LCBzKSk7IGhvb2QucG9zaXRpb24ueSA9IDEuMDsgaG9vZC5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCB0aXAgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigndGlwJywgeyBoZWlnaHQ6IDAuNCwgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiAwLjM0LCB0ZXNzZWxsYXRpb246IDE0IH0sIHMpKTsgdGlwLnBvc2l0aW9uLnNldCgwLCAxLjI4LCAtMC4wNik7IHRpcC5yb3RhdGlvbi54ID0gLTAuMzU7IHRpcC5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCBmYWNlID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdmYWNlJywgeyBkaWFtZXRlcjogMC4zOCwgc2VnbWVudHM6IDEyIH0sIHMpKTsgZmFjZS5wb3NpdGlvbi5zZXQoMCwgMC45OSwgMC4xMik7IGZhY2UubWF0ZXJpYWwgPSBtYXQoMC4wMiwgMCwgMC4wNSk7XG4gICAgdGhpcy5leWVNYXQgPSBnbG93TWF0KDAuOSwgMC40LCAxKTtcbiAgICBmb3IgKGNvbnN0IHggb2YgWy0wLjA3NSwgMC4wNzVdKSB7IGNvbnN0IGUgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2V5ZScsIHsgZGlhbWV0ZXI6IDAuMDc1LCBzZWdtZW50czogOCB9LCBzKSk7IGUucG9zaXRpb24uc2V0KHgsIDEuMCwgMC4yODUpOyBlLnNjYWxpbmcueiA9IDAuNjsgZS5tYXRlcmlhbCA9IHRoaXMuZXllTWF0OyB9XG4gICAgdGhpcy5nbG93ID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2V5ZUdsb3cnLCB7IHNpemU6IDAuNSB9LCBzKSk7IHRoaXMuZ2xvdy5wb3NpdGlvbi5zZXQoMCwgMS4wLCAwLjMzKTsgdGhpcy5nbG93LmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgY29uc3QgZ20gPSBnbG93TWF0KDAuNywgMC4yNSwgMSwgMC41NSk7IGdtLmVtaXNzaXZlVGV4dHVyZSA9IHNvZnQ7IGdtLm9wYWNpdHlUZXh0dXJlID0gc29mdDsgdGhpcy5nbG93Lm1hdGVyaWFsID0gZ207XG4gICAgY29uc3QgaGFuZCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnaGFuZCcsIHsgZGlhbWV0ZXI6IDAuMTIsIHNlZ21lbnRzOiA4IH0sIHMpKTsgaGFuZC5wb3NpdGlvbi5zZXQoLTAuMzIsIDAuNjIsIDAuMTIpOyBoYW5kLm1hdGVyaWFsID0gbWF0KDAuOCwgMC43NSwgMC42NSk7XG4gICAgLy8gc3RhZmY6IHBpdm90IGF0IHRoZSByaWdodCBoYW5kIHNvIHJhaXNpbmcgaXQgaXMgb25lIHJvdGF0aW9uXG4gICAgdGhpcy5zdGFmZlBpdm90ID0gYWRkKG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3N0YWZmUGl2b3QnLCBzKSk7IHRoaXMuc3RhZmZQaXZvdC5wb3NpdGlvbi5zZXQoMC4zNCwgMC42LCAwLjE0KTtcbiAgICBjb25zdCByb2QgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncm9kJywgeyBoZWlnaHQ6IDEuNSwgZGlhbWV0ZXI6IDAuMDQ1LCB0ZXNzZWxsYXRpb246IDggfSwgcyksIHRoaXMuc3RhZmZQaXZvdCk7IHJvZC5wb3NpdGlvbi55ID0gMC40NTsgcm9kLm1hdGVyaWFsID0gbWF0KDAuMjgsIDAuMTcsIDAuMSk7XG4gICAgdGhpcy5jcnlzdGFsTWF0ID0gZ2xvd01hdCgwLjc1LCAwLjM1LCAxKTtcbiAgICB0aGlzLmNyeXN0YWwgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQb2x5aGVkcm9uKCdjcnlzdGFsJywgeyB0eXBlOiAxLCBzaXplOiAwLjEyIH0sIHMpLCB0aGlzLnN0YWZmUGl2b3QpOyB0aGlzLmNyeXN0YWwucG9zaXRpb24ueSA9IDEuMjg7IHRoaXMuY3J5c3RhbC5zY2FsaW5nLnkgPSAxLjU7IHRoaXMuY3J5c3RhbC5yb3RhdGlvbi54ID0gMC40OyB0aGlzLmNyeXN0YWwubWF0ZXJpYWwgPSB0aGlzLmNyeXN0YWxNYXQ7XG4gICAgY29uc3QgcmluZyA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZURpc2MoJ2Jhc2UnLCB7IHJhZGl1czogMC42MiwgdGVzc2VsbGF0aW9uOiAzMCB9LCBzKSwgdGhpcy5ob2xkZXIpOyByaW5nLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgcmluZy5wb3NpdGlvbi55ID0gMC4wMjsgcmluZy5tYXRlcmlhbCA9IGdsb3dNYXQoMC40LCAwLjE1LCAwLjc1LCAwLjU1KTtcbiAgICAvLyBhdXJhXG4gICAgY29uc3QgcHMgPSB0aGlzLnBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ25lY3JvQXVyYScsIDgwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gc29mdDsgcHMuZW1pdHRlciA9IHRoaXMuaG9sZGVyO1xuICAgIHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjMsIDAsIC0wLjMpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjMsIDAuOSwgMC4zKTsgcHMubWluTGlmZVRpbWUgPSAwLjY7IHBzLm1heExpZmVUaW1lID0gMS4zO1xuICAgIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjksIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS42LCAwLjE1KTsgcHMubWluRW1pdFBvd2VyID0gMC4zOyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMDc7IHBzLm1heFNpemUgPSAwLjI7IHBzLmVtaXRSYXRlID0gMzA7IHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjgsIDAuMzUsIDEsIDAuNyk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjQ1LCAwLjE1LCAwLjksIDAuNSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgc2V0RW5hYmxlZChvbjogYm9vbGVhbikgeyB0aGlzLmhvbGRlci5zZXRFbmFibGVkKG9uKTsgaWYgKG9uKSB0aGlzLnBzLnN0YXJ0KCk7IGVsc2UgdGhpcy5wcy5zdG9wKCk7IH1cbiAgLyoqIFdvcmxkIHBvc2l0aW9uIG9mIHRoZSBzdGFmZiBjcnlzdGFsIChmb3Igc3BlbGwgZWZmZWN0cykuICovXG4gIGNyeXN0YWxQb3MoKTogYW55IHsgdGhpcy5ob2xkZXIuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpOyB0aGlzLnJpZy5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHRoaXMuc3RhZmZQaXZvdC5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHRoaXMuY3J5c3RhbC5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHJldHVybiB0aGlzLmNyeXN0YWwuZ2V0QWJzb2x1dGVQb3NpdGlvbigpLmNsb25lKCk7IH1cblxuICBodXJ0KCkgeyB0aGlzLmh1cnRUID0gMC44OyB9XG4gIGNhc3QoKSB7IHRoaXMuY2FzdFQgPSAxLjE7IH1cbiAgLyoqIFRoZSBsYXN0IGhlYXJ0IGlzIGdvbmU6IGhlIHNpbmtzIHRvIGhpcyBrbmVlcywgdGhlIGV5ZXMgZGltLiAqL1xuICBkZWZlYXQoKSB7IHRoaXMuZG93blRhcmdldCA9IDE7IH1cbiAgcmV2aXZlKCkgeyB0aGlzLmRvd25UYXJnZXQgPSAwOyB0aGlzLmh1cnRUID0gMDsgdGhpcy5jYXN0VCA9IDA7IH1cblxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMudCArPSBkdDtcbiAgICB0aGlzLmRvd24gKz0gKHRoaXMuZG93blRhcmdldCAtIHRoaXMuZG93bikgKiBNYXRoLm1pbigxLCBkdCAqIDMpO1xuICAgIGNvbnN0IGJvYiA9IE1hdGguc2luKHRoaXMudCAqIDIpICogMC4wMzUgKiAoMSAtIHRoaXMuZG93bik7XG4gICAgbGV0IHJlY29pbCA9IDAsIGZsYXNoID0gMDtcbiAgICBpZiAodGhpcy5odXJ0VCA+IDApIHsgdGhpcy5odXJ0VCA9IE1hdGgubWF4KDAsIHRoaXMuaHVydFQgLSBkdCk7IGNvbnN0IHUgPSB0aGlzLmh1cnRUIC8gMC44OyByZWNvaWwgPSBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjQyOyBmbGFzaCA9IHU7IH1cbiAgICBsZXQgcmFpc2UgPSAwO1xuICAgIGlmICh0aGlzLmNhc3RUID4gMCkgeyB0aGlzLmNhc3RUID0gTWF0aC5tYXgoMCwgdGhpcy5jYXN0VCAtIGR0KTsgY29uc3QgdSA9IHRoaXMuY2FzdFQgLyAxLjE7IHJhaXNlID0gTWF0aC5zaW4oTWF0aC5taW4oMSwgKDEgLSB1KSAqIDEuNikgKiBNYXRoLlBJICogMC41KSAqICh1ID4gMC4yNSA/IDEgOiB1IC8gMC4yNSk7IH1cbiAgICB0aGlzLnJpZy5wb3NpdGlvbi55ID0gYm9iIC0gMC4yOCAqIHRoaXMuZG93bjsgdGhpcy5yaWcucm90YXRpb24ueCA9IC1yZWNvaWwgKyAwLjkgKiB0aGlzLmRvd247IHRoaXMucmlnLnJvdGF0aW9uLnogPSBNYXRoLnNpbih0aGlzLnQgKiAxLjMpICogMC4wMyArIE1hdGguc2luKHRoaXMuaHVydFQgKiA2MCkgKiAwLjAzICogKHRoaXMuaHVydFQgPiAwID8gMSA6IDApO1xuICAgIHRoaXMuc3RhZmZQaXZvdC5yb3RhdGlvbi56ID0gLTAuMTUgKiByYWlzZSAtIDAuMDU7IHRoaXMuc3RhZmZQaXZvdC5yb3RhdGlvbi54ID0gLTAuNDUgKiByYWlzZTsgdGhpcy5zdGFmZlBpdm90LnBvc2l0aW9uLnkgPSAwLjYgKyAwLjM1ICogcmFpc2U7XG4gICAgdGhpcy5jcnlzdGFsLnJvdGF0aW9uLnkgKz0gZHQgKiAoMiArIDYgKiByYWlzZSk7IGNvbnN0IHB1bHNlID0gMSArIDAuMTIgKiBNYXRoLnNpbih0aGlzLnQgKiA0KSArIDEuMSAqIHJhaXNlOyB0aGlzLmNyeXN0YWwuc2NhbGluZy5zZXQocHVsc2UsIDEuNSAqIHB1bHNlLCBwdWxzZSk7XG4gICAgY29uc3QgZGltID0gMSAtIDAuODUgKiB0aGlzLmRvd247XG4gICAgdGhpcy5jcnlzdGFsTWF0LmVtaXNzaXZlQ29sb3Iuc2V0KCgwLjc1ICsgMC4yNSAqIHJhaXNlKSAqIGRpbSwgKDAuMzUgKyAwLjQgKiByYWlzZSkgKiBkaW0sIDEgKiBkaW0pO1xuICAgIHRoaXMuZXllTWF0LmVtaXNzaXZlQ29sb3Iuc2V0KDAuOSAqIGRpbSArIGZsYXNoICogMC4xLCAoMC40ICsgMC4yNSAqIHJhaXNlKSAqIGRpbSAqICgxIC0gZmxhc2ggKiAwLjYpLCAxICogZGltICogKDEgLSBmbGFzaCAqIDAuNykpO1xuICAgIHRoaXMucm9iZU1hdC5lbWlzc2l2ZUNvbG9yLnNldCgwLjA1ICsgZmxhc2ggKiAwLjYsIDAuMDIsIDAuMSAqICgxIC0gZmxhc2gpKTtcbiAgICB0aGlzLmdsb3cuc2NhbGluZy5zZXRBbGwoMC42ICsgMC45ICogZGltICsgcmFpc2UgKiAwLjgpO1xuICAgIHRoaXMucHMuZW1pdFJhdGUgPSAoMzAgKyA5MCAqIHJhaXNlKSAqIGRpbTtcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7IHRoaXMucHMuc3RvcCgpOyB0aGlzLnBzLmRpc3Bvc2UoKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG4iLCAiLy8gQWxsIHNvdW5kIGlzIHN5bnRoZXNpemVkIGluIHRoZSBicm93c2VyIHdpdGggdGhlIFdlYiBBdWRpbyBBUEk6IG5vIGF1ZGlvIGZpbGVzIHRvIGRvd25sb2FkLCBsaWNlbnNlIG9yIHNoaXAuXG4vLyBUd28gaW5kZXBlbmRlbnQgc3dpdGNoZXMgKG11c2ljLCBzb3VuZCBlZmZlY3RzKSwgc2F2ZWQgaW4gdGhlIHBsYXllcidzIHNhdmUuIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdGFwLCBzbyBub3RoaW5nIHN0YXJ0c1xuLy8gdW50aWwgdGhlIGZpcnN0IHRvdWNoL2NsaWNrIChgdW5sb2NrYCkuXG5pbXBvcnQgeyBsb2FkU2F2ZSwgdXBkYXRlU2V0dGluZ3MgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuXG5leHBvcnQgdHlwZSBTZnggPSAndGFwJyB8ICdzdW1tb24nIHwgJ21lcmdlJyB8ICdoaXQnIHwgJ2hpdEFycm93JyB8ICdzbWFzaCcgfCAnYXJyb3cnIHwgJ2RlYXRoJyB8ICdjYXN0JyB8ICd0YXVudCcgfCAnc2hvY2t3YXZlJyB8ICdyZXN1cnJlY3QnIHwgJ2hlYXJ0TG9zdCcgfCAndmljdG9yeScgfCAnZGVmZWF0JyB8ICdzdGFydCdcbiAgfCAncGFja0NoYXJnZScgfCAncGFja1RpZXJVcCcgfCAncGFja1RlYXInIHwgJ3BhY2tGYW4nIHwgJ3BhY2tGbGlwJyB8ICdwYWNrUmFyZScgfCAncGFja0VwaWMnIHwgJ3BhY2tMZWdlbmQnIHwgJ3BhY2tDb2xsZWN0JztcbmV4cG9ydCB0eXBlIE1vZGUgPSAnYnVpbGQnIHwgJ2JhdHRsZSc7XG5cbi8vIE11c2ljOiBBIG1pbm9yLCA4MCBicG0sIGZvdXIgYmFycyBsb29waW5nIChBbSwgRiwgQywgRSkuIFJvb3Qgbm90ZSBmaXJzdCwgdGhlbiBjaG9yZCB0b25lcyAoSHopLlxuY29uc3QgQ0hPUkRTOiBudW1iZXJbXVtdID0gW1xuICBbMTEwLCAxNjQuODEsIDIyMCwgMjYxLjYzLCAzMjkuNjNdLFxuICBbODcuMzEsIDEzMC44MSwgMTc0LjYxLCAyMjAsIDI2MS42M10sXG4gIFsxMzAuODEsIDE5NiwgMjYxLjYzLCAzMjkuNjMsIDM5Ml0sXG4gIFs4Mi40MSwgMTIzLjQ3LCAxNjQuODEsIDIwNy42NSwgMjQ2Ljk0XSxcbl07XG5jb25zdCBCRUFUID0gNjAgLyA4MDtcblxuY2xhc3MgQXVkaW9FbmdpbmUge1xuICBwcml2YXRlIGN0eDogQXVkaW9Db250ZXh0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbWFzdGVyITogR2Fpbk5vZGU7IHByaXZhdGUgbXVzaWNCdXMhOiBHYWluTm9kZTsgcHJpdmF0ZSBzZnhCdXMhOiBHYWluTm9kZTsgcHJpdmF0ZSBub2lzZUJ1ZiE6IEF1ZGlvQnVmZmVyO1xuICBtdXNpYyA9IHRydWU7IHNmeCA9IHRydWU7IG1vZGU6IE1vZGUgPSAnYnVpbGQnO1xuICBwcml2YXRlIHRpbWVyID0gMDsgcHJpdmF0ZSBuZXh0VCA9IDA7IHByaXZhdGUgYmVhdCA9IDA7IHByaXZhdGUgc3RhbXBzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG5cbiAgY29uc3RydWN0b3IoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgfVxuXG4gIHByaXZhdGUgc2lsZW50OiBIVE1MQXVkaW9FbGVtZW50IHwgbnVsbCA9IG51bGw7IHByaXZhdGUgcHJpbWVkID0gZmFsc2U7XG4gIC8qKiBpUGhvbmVzIG11dGUgV2ViIEF1ZGlvIHdoZW4gdGhlIHJpbmdlciBzd2l0Y2ggaXMgb24sIHVubGVzcyB0aGUgcGFnZSBpcyBwbGF5aW5nIFwicmVhbFwiIG1lZGlhLiBBIHNpbGVudCBsb29waW5nIDxhdWRpbz4gZWxlbWVudCAocGx1cyB0aGVcbiAgICogIGF1ZGlvU2Vzc2lvbiBoaW50IG9uIG5ld2VyIGlPUykgbW92ZXMgdGhlIHBhZ2UgdG8gdGhlIHBsYXliYWNrIGNoYW5uZWwsIHNvIHRoZSBnYW1lIGlzIGhlYXJkIGV2ZW4gd2l0aCB0aGUgc3dpdGNoIG9uIHNpbGVudC4gKi9cbiAgcHJpdmF0ZSBwbGF5YmFja0NoYW5uZWwoKSB7XG4gICAgdHJ5IHsgY29uc3QgYSA9IChuYXZpZ2F0b3IgYXMgYW55KS5hdWRpb1Nlc3Npb247IGlmIChhKSBhLnR5cGUgPSAncGxheWJhY2snOyB9IGNhdGNoIHsgLyogbm90IHN1cHBvcnRlZCAqLyB9XG4gICAgaWYgKHRoaXMuc2lsZW50KSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG4gPSA0NDEsIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcig0NCArIG4gKiAyKSwgdiA9IG5ldyBEYXRhVmlldyhidWYpLCBzdHIgPSAobzogbnVtYmVyLCB0OiBzdHJpbmcpID0+IHsgZm9yIChsZXQgaSA9IDA7IGkgPCB0Lmxlbmd0aDsgaSsrKSB2LnNldFVpbnQ4KG8gKyBpLCB0LmNoYXJDb2RlQXQoaSkpOyB9O1xuICAgICAgc3RyKDAsICdSSUZGJyk7IHYuc2V0VWludDMyKDQsIDM2ICsgbiAqIDIsIHRydWUpOyBzdHIoOCwgJ1dBVkUnKTsgc3RyKDEyLCAnZm10ICcpOyB2LnNldFVpbnQzMigxNiwgMTYsIHRydWUpOyB2LnNldFVpbnQxNigyMCwgMSwgdHJ1ZSk7IHYuc2V0VWludDE2KDIyLCAxLCB0cnVlKTtcbiAgICAgIHYuc2V0VWludDMyKDI0LCA0NDEwMCwgdHJ1ZSk7IHYuc2V0VWludDMyKDI4LCA4ODIwMCwgdHJ1ZSk7IHYuc2V0VWludDE2KDMyLCAyLCB0cnVlKTsgdi5zZXRVaW50MTYoMzQsIDE2LCB0cnVlKTsgc3RyKDM2LCAnZGF0YScpOyB2LnNldFVpbnQzMig0MCwgbiAqIDIsIHRydWUpO1xuICAgICAgY29uc3QgZWwgPSBuZXcgQXVkaW8oVVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbYnVmXSwgeyB0eXBlOiAnYXVkaW8vd2F2JyB9KSkpOyBlbC5sb29wID0gdHJ1ZTsgZWwudm9sdW1lID0gMC4wMTsgZWwuc2V0QXR0cmlidXRlKCdwbGF5c2lubGluZScsICcnKTsgdGhpcy5zaWxlbnQgPSBlbDtcbiAgICAgIGVsLnBsYXkoKS5jYXRjaCgoKSA9PiB7IHRoaXMuc2lsZW50ID0gbnVsbDsgfSk7XG4gICAgfSBjYXRjaCB7IC8qIGZpbmU6IHNvdW5kIHN0aWxsIHdvcmtzLCBqdXN0IGZvbGxvd3MgdGhlIHNpbGVudCBzd2l0Y2ggKi8gfVxuICB9XG4gIC8qKiBXaGF0IHRoZSBTZXR0aW5ncyBwYWdlIHNob3dzIHNvIGEgc2lsZW50IHBob25lIGNhbiBiZSBkaWFnbm9zZWQuICovXG4gIHN0YXR1cygpOiB7IHN0YXRlOiBzdHJpbmc7IHVubG9ja2VkOiBib29sZWFuIH0geyByZXR1cm4geyBzdGF0ZTogdGhpcy5jdHggPyB0aGlzLmN0eC5zdGF0ZSA6ICdub3Qgc3RhcnRlZCcsIHVubG9ja2VkOiAhIXRoaXMuY3R4ICYmIHRoaXMuY3R4LnN0YXRlID09PSAncnVubmluZycgfTsgfVxuICAvKiogVGhlIFNldHRpbmdzIHBhZ2UncyBUZXN0IHNvdW5kIGJ1dHRvbjogdW5sb2NrIGFuZCBtYWtlIGEgY2xlYXJseSBhdWRpYmxlIHNvdW5kLiAqL1xuICB0ZXN0KCkgeyB0aGlzLnVubG9jaygpOyBjb25zdCB0ID0gKCkgPT4geyB0aGlzLnBsYXkoJ3ZpY3RvcnknKTsgfTsgaWYgKHRoaXMuY3R4ICYmIHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHRoaXMuY3R4LnJlc3VtZSgpLnRoZW4odCkuY2F0Y2goKCkgPT4ge30pOyBlbHNlIHQoKTsgfVxuXG4gIC8qKiBDYWxsIGZyb20gYSB1c2VyIGdlc3R1cmUgKHRhcC9jbGljaykuIFNhZmUgdG8gY2FsbCByZXBlYXRlZGx5LiAqL1xuICB1bmxvY2soKSB7XG4gICAgdGhpcy5wbGF5YmFja0NoYW5uZWwoKTtcbiAgICBpZiAoIXRoaXMuY3R4KSB7XG4gICAgICBjb25zdCBDID0gKHdpbmRvdyBhcyBhbnkpLkF1ZGlvQ29udGV4dCB8fCAod2luZG93IGFzIGFueSkud2Via2l0QXVkaW9Db250ZXh0OyBpZiAoIUMpIHJldHVybjtcbiAgICAgIGNvbnN0IGN0eDogQXVkaW9Db250ZXh0ID0gdGhpcy5jdHggPSBuZXcgQygpO1xuICAgICAgY29uc3QgY29tcCA9IGN0eC5jcmVhdGVEeW5hbWljc0NvbXByZXNzb3IoKTsgY29tcC5jb25uZWN0KGN0eC5kZXN0aW5hdGlvbik7XG4gICAgICB0aGlzLm1hc3RlciA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMubWFzdGVyLmdhaW4udmFsdWUgPSAwLjk7IHRoaXMubWFzdGVyLmNvbm5lY3QoY29tcCk7XG4gICAgICB0aGlzLm11c2ljQnVzID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tdXNpY0J1cy5jb25uZWN0KHRoaXMubWFzdGVyKTsgdGhpcy5zZnhCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLnNmeEJ1cy5jb25uZWN0KHRoaXMubWFzdGVyKTtcbiAgICAgIGN0eC5vbnN0YXRlY2hhbmdlID0gKCkgPT4geyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWF1ZGlvLXN0YXRlJykpOyB9O1xuICAgICAgY29uc3QgbGVuID0gY3R4LnNhbXBsZVJhdGU7IHRoaXMubm9pc2VCdWYgPSBjdHguY3JlYXRlQnVmZmVyKDEsIGxlbiwgY3R4LnNhbXBsZVJhdGUpOyBjb25zdCBkID0gdGhpcy5ub2lzZUJ1Zi5nZXRDaGFubmVsRGF0YSgwKTsgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW47IGkrKykgZFtpXSA9IE1hdGgucmFuZG9tKCkgKiAyIC0gMTtcbiAgICB9XG4gICAgaWYgKHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHRoaXMuY3R4LnJlc3VtZSgpLmNhdGNoKCgpID0+IHt9KTsgICAgICAgICAgICAgLy8gJ3N1c3BlbmRlZCcgb3IgKGlPUykgJ2ludGVycnVwdGVkJ1xuICAgIGlmICghdGhpcy5wcmltZWQpIHsgdGhpcy5wcmltZWQgPSB0cnVlOyB0cnkgeyBjb25zdCBiID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyKDEsIDEsIDIyMDUwKSwgcyA9IHRoaXMuY3R4LmNyZWF0ZUJ1ZmZlclNvdXJjZSgpOyBzLmJ1ZmZlciA9IGI7IHMuY29ubmVjdCh0aGlzLmN0eC5kZXN0aW5hdGlvbik7IHMuc3RhcnQoMCk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfSB9XG4gICAgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7XG4gIH1cblxuICBzZXRNdXNpYyhvbjogYm9vbGVhbikgeyB0aGlzLm11c2ljID0gb247IHVwZGF0ZVNldHRpbmdzKHsgbXVzaWM6IG9uIH0pOyB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zZXR0aW5ncycpKTsgfVxuICBzZXRTZngob246IGJvb2xlYW4pIHsgdGhpcy5zZnggPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBzZng6IG9uIH0pOyB0aGlzLmFwcGx5R2FpbnMoKTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zZXR0aW5ncycpKTsgaWYgKG9uKSB0aGlzLnBsYXkoJ3RhcCcpOyB9XG4gIC8qKiBSZS1yZWFkIHRoZSBzYXZlZCBzd2l0Y2hlcyAodGhlIHNoZWxsJ3MgU2V0dGluZ3MgcGFnZSBjaGFuZ2VzIHRoZW0gdG9vKS4gKi9cbiAgcmVsb2FkKCkgeyBjb25zdCBzID0gbG9hZFNhdmUoKS5zZXR0aW5nczsgdGhpcy5tdXNpYyA9IHMubXVzaWM7IHRoaXMuc2Z4ID0gcy5zZng7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB9XG4gIHNldE1vZGUobTogTW9kZSkgeyB0aGlzLm1vZGUgPSBtOyB9XG5cbiAgcHJpdmF0ZSBhcHBseUdhaW5zKCkge1xuICAgIGlmICghdGhpcy5jdHgpIHJldHVybjsgY29uc3QgdCA9IHRoaXMuY3R4LmN1cnJlbnRUaW1lO1xuICAgIHRoaXMubXVzaWNCdXMuZ2Fpbi5zZXRUYXJnZXRBdFRpbWUodGhpcy5tdXNpYyA/IDAuNSA6IDAsIHQsIDAuMTUpOyB0aGlzLnNmeEJ1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLnNmeCA/IDAuOCA6IDAsIHQsIDAuMDUpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIG11c2ljXG4gIHByaXZhdGUgc3luY011c2ljKCkge1xuICAgIGlmICghdGhpcy5jdHgpIHJldHVybjtcbiAgICBpZiAodGhpcy5tdXNpYyAmJiAhdGhpcy50aW1lcikgeyB0aGlzLm5leHRUID0gdGhpcy5jdHguY3VycmVudFRpbWUgKyAwLjE1OyB0aGlzLnRpbWVyID0gd2luZG93LnNldEludGVydmFsKCgpID0+IHRoaXMudGljaygpLCAyMDApOyB9XG4gICAgaWYgKCF0aGlzLm11c2ljICYmIHRoaXMudGltZXIpIHsgY2xlYXJJbnRlcnZhbCh0aGlzLnRpbWVyKTsgdGhpcy50aW1lciA9IDA7IH1cbiAgfVxuICBwcml2YXRlIHRpY2soKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghOyBpZiAoY3R4LnN0YXRlICE9PSAncnVubmluZycpIHsgdGhpcy5uZXh0VCA9IGN0eC5jdXJyZW50VGltZSArIDAuMTU7IHJldHVybjsgfVxuICAgIHdoaWxlICh0aGlzLm5leHRUIDwgY3R4LmN1cnJlbnRUaW1lICsgMC42KSB7IHRoaXMucGxheUJlYXQodGhpcy5iZWF0LCB0aGlzLm5leHRUKTsgdGhpcy5uZXh0VCArPSBCRUFUOyB0aGlzLmJlYXQgPSAodGhpcy5iZWF0ICsgMSkgJSAxNjsgfVxuICB9XG4gIHByaXZhdGUgcGxheUJlYXQoYmVhdDogbnVtYmVyLCB0OiBudW1iZXIpIHtcbiAgICBjb25zdCBjaG9yZCA9IENIT1JEU1tNYXRoLmZsb29yKGJlYXQgLyA0KV0sIGluQmFyID0gYmVhdCAlIDQsIGJhdHRsZSA9IHRoaXMubW9kZSA9PT0gJ2JhdHRsZSc7XG4gICAgaWYgKGluQmFyID09PSAwKSBmb3IgKGNvbnN0IGYgb2YgY2hvcmQpIHRoaXMudm9pY2UoZiwgJ3RyaWFuZ2xlJywgdCwgQkVBVCAqIDQgKyAwLjgsIDAuMDQ1LCAwLjksIDkwMCk7ICAgLy8gc2xvdyBwYWRcbiAgICBpZiAoaW5CYXIgPT09IDAgfHwgaW5CYXIgPT09IDIpIHRoaXMudm9pY2UoY2hvcmRbMF0sICdzaW5lJywgdCwgQkVBVCAqIDEuNiwgMC4xNiwgMC4wMiwgNDAwKTsgICAgICAgICAgLy8gYmFzc1xuICAgIGlmIChiYXR0bGUpIHtcbiAgICAgIHRoaXMua2ljayh0LCAwLjMyKTsgaWYgKGluQmFyID09PSAyKSB0aGlzLmtpY2sodCArIEJFQVQgKiAwLjUsIDAuMTgpO1xuICAgICAgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDAuNSwgMC4wNSwgMC4wNSwgJ2hpZ2hwYXNzJywgNzAwMCk7IHRoaXMubm9pc2UodCArIEJFQVQgKiAxLjUgJSBCRUFULCAwLjA1LCAwLjAzLCAnaGlnaHBhc3MnLCA3MDAwKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMjsgaSsrKSB0aGlzLnZvaWNlKGNob3JkWzEgKyAoKGJlYXQgKiAyICsgaSkgJSA0KV0gKiAyLCAndHJpYW5nbGUnLCB0ICsgaSAqIEJFQVQgLyAyLCAwLjIyLCAwLjA1LCAwLjAwNSwgMjUwMCk7ICAgLy8gcGx1Y2sgYXJwZWdnaW9cbiAgICB9XG4gIH1cbiAgcHJpdmF0ZSB2b2ljZShmcmVxOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCB0OiBudW1iZXIsIGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIGF0dGFjazogbnVtYmVyLCBscDogbnVtYmVyKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCBvID0gY3R4LmNyZWF0ZU9zY2lsbGF0b3IoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCksIGYgPSBjdHguY3JlYXRlQmlxdWFkRmlsdGVyKCk7XG4gICAgby50eXBlID0gdHlwZTsgby5mcmVxdWVuY3kudmFsdWUgPSBmcmVxOyBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKDAuMDAwMSwgdCk7IGcuZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZShnYWluLCB0ICsgTWF0aC5tYXgoMC4wMDUsIGF0dGFjaykpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG8uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5tdXNpY0J1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBraWNrKHQ6IG51bWJlciwgZ2FpbjogbnVtYmVyKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCBvID0gY3R4LmNyZWF0ZU9zY2lsbGF0b3IoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgby5mcmVxdWVuY3kuc2V0VmFsdWVBdFRpbWUoMTMwLCB0KTsgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSg0MiwgdCArIDAuMTQpOyBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoZ2FpbiwgdCk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIDAuMik7XG4gICAgby5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5tdXNpY0J1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgMC4yNSk7XG4gIH1cbiAgcHJpdmF0ZSBub2lzZSh0OiBudW1iZXIsIGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgYnVzOiBHYWluTm9kZSA9IHRoaXMubXVzaWNCdXMsIHN3ZWVwVG8/OiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG4gPSBjdHguY3JlYXRlQnVmZmVyU291cmNlKCksIGYgPSBjdHguY3JlYXRlQmlxdWFkRmlsdGVyKCksIGcgPSBjdHguY3JlYXRlR2FpbigpO1xuICAgIG4uYnVmZmVyID0gdGhpcy5ub2lzZUJ1ZjsgZi50eXBlID0gdHlwZTsgZi5mcmVxdWVuY3kuc2V0VmFsdWVBdFRpbWUoZnJlcSwgdCk7IGlmIChzd2VlcFRvKSBmLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKHN3ZWVwVG8sIHQgKyBkdXIpO1xuICAgIGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgZHVyKTtcbiAgICBuLmNvbm5lY3QoZik7IGYuY29ubmVjdChnKTsgZy5jb25uZWN0KGJ1cyk7IG4uc3RhcnQodCwgTWF0aC5yYW5kb20oKSAqIDAuNSk7IG4uc3RvcCh0ICsgZHVyICsgMC4wMik7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc291bmQgZWZmZWN0c1xuICBwcml2YXRlIHRvbmUoZnJlcTogbnVtYmVyLCBkdXI6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIGdhaW46IG51bWJlciwgZGVsYXkgPSAwLCBzbGlkZVRvPzogbnVtYmVyLCBhdHRhY2sgPSAwLjAwNSwgbHAgPSA4MDAwKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCB0ID0gY3R4LmN1cnJlbnRUaW1lICsgZGVsYXksIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHNsaWRlVG8pIG8uZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc2xpZGVUbywgdCArIGR1cik7XG4gICAgZi50eXBlID0gJ2xvd3Bhc3MnOyBmLmZyZXF1ZW5jeS52YWx1ZSA9IGxwOyBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBhdHRhY2spOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG8uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5zZnhCdXMpOyBvLnN0YXJ0KHQpOyBvLnN0b3AodCArIGR1ciArIDAuMDUpO1xuICB9XG4gIHByaXZhdGUgaGlzcyhkdXI6IG51bWJlciwgZ2FpbjogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmcmVxOiBudW1iZXIsIGRlbGF5ID0gMCwgc3dlZXBUbz86IG51bWJlcikgeyB0aGlzLm5vaXNlKHRoaXMuY3R4IS5jdXJyZW50VGltZSArIGRlbGF5LCBkdXIsIGdhaW4sIHR5cGUsIGZyZXEsIHRoaXMuc2Z4QnVzLCBzd2VlcFRvKTsgfVxuICBwcml2YXRlIHRocm90dGxlKGtleTogc3RyaW5nLCBtczogbnVtYmVyKSB7IGNvbnN0IG4gPSBwZXJmb3JtYW5jZS5ub3coKTsgaWYgKG4gLSAodGhpcy5zdGFtcHNba2V5XSB8fCAwKSA8IG1zKSByZXR1cm4gZmFsc2U7IHRoaXMuc3RhbXBzW2tleV0gPSBuOyByZXR1cm4gdHJ1ZTsgfVxuXG4gIHBsYXkobmFtZTogU2Z4KSB7XG4gICAgaWYgKCF0aGlzLmN0eCB8fCAhdGhpcy5zZnggfHwgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgcmV0dXJuO1xuICAgIHN3aXRjaCAobmFtZSkge1xuICAgICAgY2FzZSAndGFwJzogaWYgKCF0aGlzLnRocm90dGxlKCd0YXAnLCA0MCkpIHJldHVybjsgdGhpcy50b25lKDc2MCwgMC4wNiwgJ3NpbmUnLCAwLjIyLCAwLCAxMTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzdW1tb24nOiB0aGlzLmhpc3MoMC40LCAwLjE0LCAnYmFuZHBhc3MnLCA1MDAsIDAsIDI1MDApOyB0aGlzLnRvbmUoMjIwLCAwLjQsICdzYXd0b290aCcsIDAuMSwgMCwgNjYwLCAwLjA1LCAxODAwKTsgdGhpcy50b25lKDEzMjAsIDAuMiwgJ3NpbmUnLCAwLjEsIDAuMTgpOyBicmVhaztcbiAgICAgIGNhc2UgJ21lcmdlJzogWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDgsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjM1LCAwLCA1MCk7IHRoaXMudG9uZSgxNTY4LCAwLjUsICdzaW5lJywgMC4wOCwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICdoaXQnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdCcsIDQ1KSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4wNywgMC4yNCwgJ2xvd3Bhc3MnLCAxODAwKTsgdGhpcy50b25lKDE3MCwgMC4wOSwgJ3NpbmUnLCAwLjIyLCAwLCA4MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0QXJyb3cnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdEEnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDUsIDAuMTQsICdiYW5kcGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNzAwLCAwLjA2LCAndHJpYW5nbGUnLCAwLjA2LCAwLCA0MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3NtYXNoJzogdGhpcy50b25lKDk1LCAwLjM4LCAnc2luZScsIDAuNSwgMCwgMzQpOyB0aGlzLmhpc3MoMC4zMiwgMC4zNSwgJ2xvd3Bhc3MnLCAxMDAwLCAwLCAyMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2Fycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdhcnJvdycsIDYwKSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4xNCwgMC4xLCAnYmFuZHBhc3MnLCAxODAwLCAwLCA0MjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdkZWF0aCc6IGlmICghdGhpcy50aHJvdHRsZSgnZGVhdGgnLCA3MCkpIHJldHVybjsgdGhpcy50b25lKDMwMCwgMC40LCAnc2F3dG9vdGgnLCAwLjE0LCAwLCA3MCwgMC4wMSwgOTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdjYXN0JzogdGhpcy50b25lKDMwMCwgMC40NSwgJ3NpbmUnLCAwLjE4LCAwLCA5MDAsIDAuMDUpOyB0aGlzLnRvbmUoNDUwLCAwLjQ1LCAnc2luZScsIDAuMSwgMC4wNSwgMTM1MCwgMC4wNSk7IHRoaXMudG9uZSgxODAwLCAwLjI1LCAnc2luZScsIDAuMDUsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndGF1bnQnOiB0aGlzLnRvbmUoMTk2LCAwLjUsICdzcXVhcmUnLCAwLjA4LCAwLCAxODAsIDAuMDMsIDcwMCk7IHRoaXMudG9uZSgxNDcsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4wOCwgMC4wMiwgMTQwLCAwLjAzLCA2MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3Nob2Nrd2F2ZSc6IHRoaXMudG9uZSgyMjAsIDEuMSwgJ3NpbmUnLCAwLjUsIDAsIDI4LCAwLjAyKTsgdGhpcy5oaXNzKDEuMCwgMC4zNSwgJ2xvd3Bhc3MnLCAzMDAwLCAwLCAxNTApOyB0aGlzLnRvbmUoODgwLCAwLjgsICdzaW5lJywgMC4wOCwgMCwgMjIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdyZXN1cnJlY3QnOiBbMjIwLCAyNzcsIDMzMCwgNDQwLCA1NTRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMSwgaSAqIDAuMTIsIGYgKiAxLjEyLCAwLjMpKTsgdGhpcy5oaXNzKDAuOSwgMC4wNiwgJ2hpZ2hwYXNzJywgNDUwMCwgMC4yKTsgYnJlYWs7XG4gICAgICBjYXNlICdoZWFydExvc3QnOiB0aGlzLnRvbmUoMTEwLCAwLjcsICdzYXd0b290aCcsIDAuMjgsIDAsIDUwLCAwLjAxLCA0NTApOyB0aGlzLmhpc3MoMC4xOCwgMC4yLCAnbG93cGFzcycsIDkwMCk7IHRoaXMudG9uZSgyMzMsIDAuNSwgJ3NxdWFyZScsIDAuMDUsIDAuMDIsIDIyMCwgMC4wMSwgNTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICd2aWN0b3J5JzogWzM5MiwgNDk0LCA1ODcsIDc4NF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMTEpKTsgdGhpcy50b25lKDE5NiwgMC45LCAnc2luZScsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVmZWF0JzogWzMzMCwgMjk0LCAyNDcsIDE5Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNywgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMjgsIGYgKiAwLjk3KSk7IHRoaXMudG9uZSg4MiwgMS42LCAnc2luZScsIDAuMywgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrQ2hhcmdlJzogdGhpcy50b25lKDkwLCAxLjA1LCAnc2luZScsIDAuMjUsIDAsIDI2MCwgMC4yKTsgdGhpcy5oaXNzKDAuOTUsIDAuMTIsICdsb3dwYXNzJywgMzAwLCAwLCAyMjAwKTsgdGhpcy50b25lKDE4MCwgMS4wLCAndHJpYW5nbGUnLCAwLjA2LCAwLjEsIDUyMCwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrVGllclVwJzogWzQ0MCwgNTU0LCA2NTksIDg4MF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNCwgJ3RyaWFuZ2xlJywgMC4yLCBpICogMC4wNikpOyB0aGlzLnRvbmUoMTc2MCwgMC42LCAnc2luZScsIDAuMDksIDAuMik7IHRoaXMuaGlzcygwLjQsIDAuMSwgJ2hpZ2hwYXNzJywgNTAwMCwgMC4xKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrVGVhcic6IHRoaXMuaGlzcygwLjM1LCAwLjMsICdiYW5kcGFzcycsIDE1MDAsIDAsIDYwMDApOyB0aGlzLnRvbmUoMTIwLCAwLjQ1LCAnc2luZScsIDAuNCwgMC4wNSwgNDApOyBbMTA0NiwgMTMxOCwgMTU2OF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNiwgJ3RyaWFuZ2xlJywgMC4xLCAwLjEyICsgaSAqIDAuMDUpKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRmFuJzogdGhpcy5oaXNzKDAuNSwgMC4xLCAnaGlnaHBhc3MnLCAzMDAwKTsgdGhpcy50b25lKDY2MCwgMC40NSwgJ3NpbmUnLCAwLjEsIDAsIDEzMjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tGbGlwJzogdGhpcy5oaXNzKDAuMDgsIDAuMTUsICdiYW5kcGFzcycsIDI1MDApOyB0aGlzLnRvbmUoNTAwLCAwLjEyLCAnc2luZScsIDAuMTQsIDAsIDgwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1JhcmUnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs3ODQsIDk4OF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNDUsICd0cmlhbmdsZScsIDAuMTQsIDAuMDUgKyBpICogMC4wOSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tFcGljJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNTIzLCA2NTksIDc4NCwgMTA0Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNywgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMDcpKTsgdGhpcy50b25lKDExMCwgMC41LCAnc2luZScsIDAuMywgMCwgNjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tMZWdlbmQnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs1MjMsIDY1OSwgNzg0LCAxMDQ2LCAxMzE4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMS4xLCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wOCkpOyB0aGlzLnRvbmUoODIsIDAuOSwgJ3NpbmUnLCAwLjM1LCAwLCA1MCk7IHRoaXMuaGlzcygwLjgsIDAuMSwgJ2hpZ2hwYXNzJywgNTAwMCwgMC4xKTsgdGhpcy50b25lKDIwOTMsIDAuNywgJ3NpbmUnLCAwLjA3LCAwLjQpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tDb2xsZWN0JzogWzY1OSwgOTg4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC4zNSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMDkpKTsgYnJlYWs7XG4gICAgICBjYXNlICdzdGFydCc6IHRoaXMudG9uZSgxNDcsIDAuOSwgJ3Nhd3Rvb3RoJywgMC4xMywgMCwgMTUwLCAwLjE1LCA2NTApOyB0aGlzLnRvbmUoMjIwLCAwLjksICdzYXd0b290aCcsIDAuMDksIDAuMDUsIDIyNCwgMC4xNSwgNjUwKTsgdGhpcy5oaXNzKDAuNiwgMC4wNiwgJ2xvd3Bhc3MnLCA2MDApOyBicmVhaztcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGF1ZGlvID0gbmV3IEF1ZGlvRW5naW5lKCk7XG4od2luZG93IGFzIGFueSkuX19hdWRpbyA9IGF1ZGlvO1xuXG4vLyBQaG9uZXMgb25seSBhbGxvdyBzb3VuZCBhZnRlciBhIHRvdWNoOiB0aGUgZmlyc3QgdGFwIGFueXdoZXJlIHVubG9ja3MgaXQuIEV2ZXJ5IGJ1dHRvbiBhbHNvIGdldHMgYSBzbWFsbCBjbGljay5cbi8vIGlPUyBvbmx5IGFjY2VwdHMgYW4gdW5sb2NrIGZyb20gYSBGSU5JU0hFRCB0YXAgKHRvdWNoZW5kIC8gY2xpY2spLCBub3QgZnJvbSB0aGUgc3RhcnQgb2Ygb25lLCBzbyBsaXN0ZW4gdG8gYWxsIG9mIHRoZW0uXG5jb25zdCB1bmxvY2tPbmNlID0gKCkgPT4gYXVkaW8udW5sb2NrKCk7XG5mb3IgKGNvbnN0IGV2IG9mIFsncG9pbnRlcmRvd24nLCAncG9pbnRlcnVwJywgJ3RvdWNoZW5kJywgJ2NsaWNrJywgJ2tleWRvd24nXSkgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldiwgdW5sb2NrT25jZSwgeyBjYXB0dXJlOiB0cnVlIH0pO1xuZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4geyBjb25zdCBlbCA9IGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50IHwgbnVsbDsgaWYgKGVsICYmIGVsLmNsb3Nlc3QgJiYgZWwuY2xvc2VzdCgnYnV0dG9uLCBhLmJ0biwgLnJhaWwgYScpKSBhdWRpby5wbGF5KCd0YXAnKTsgfSwgdHJ1ZSk7XG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCd2aXNpYmlsaXR5Y2hhbmdlJywgKCkgPT4geyBjb25zdCBjID0gKGF1ZGlvIGFzIGFueSkuY3R4IGFzIEF1ZGlvQ29udGV4dCB8IG51bGw7IGlmICghYykgcmV0dXJuOyBpZiAoZG9jdW1lbnQuaGlkZGVuKSBjLnN1c3BlbmQoKTsgZWxzZSBpZiAoYXVkaW8ubXVzaWMgfHwgYXVkaW8uc2Z4KSBjLnJlc3VtZSgpOyB9KTtcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCduZWNyby1zZXR0aW5ncy1jaGFuZ2VkJywgKCkgPT4gYXVkaW8ucmVsb2FkKCkpO1xuIiwgIi8vIFNhdmluZyBhIHJ1biBpbiBwcm9ncmVzcyBzbyBpdCBzdXJ2aXZlcyBhIHBhZ2UgcmVsb2FkIChTYWZhcmkgb24gYSBwaG9uZSBjYW4gZHJvcCB0aGUgcGFnZSBhdCBhbnkgdGltZSkuXG4vLyBPbmx5IGNhbG0gbW9tZW50cyBhcmUgc2F2ZWQ6IHRoZSBidWlsZCBwaGFzZSBhbmQgdGhlIHZpY3RvcnkgZHJhZnQuIEEgYmF0dGxlIGluIHByb2dyZXNzIGlzIG5vdCBzYXZlZDsgcmVsb2FkaW5nIGR1cmluZyBvbmUgcHV0cyB5b3UgYmFja1xuLy8gYXQgdGhlIGJ1aWxkIHNjcmVlbiB5b3UgcHJlc3NlZCBCYXR0bGUgZnJvbSAobm90aGluZyBsb3N0LCBub3RoaW5nIGdhaW5lZCkuIEV2ZXJ5dGhpbmcgcmVhZCBiYWNrIGlzIHZhbGlkYXRlZDsgYW55dGhpbmcgb2RkIGlzIGlnbm9yZWQuXG5cbmltcG9ydCB7IEdSSURfQ0VMTFMsIEhFQVJUUywgTUFYX1NUQVIsIFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMsIFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSwgVW5pdCB9IGZyb20gJy4vcnVsZXMudHMnO1xuaW1wb3J0IHsgYnJvd3NlclN0b3JlIH0gZnJvbSAnLi9zYXZlLnRzJztcbmltcG9ydCB0eXBlIHsgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5jb25zdCBLRVkgPSAnbmVjcm8tcnVuJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNlcmlhbGl6ZWRTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlczsgcm5nOiB7IHNlZWQ6IG51bWJlcjsgcG9zOiBudW1iZXIgfTtcbiAgd2F2ZTogbnVtYmVyOyBoZWFydHM6IG51bWJlcjsgY2FwOiBudW1iZXI7IGhhbmQ6IFNvdWxJZFtdOyB1bml0czogVW5pdFtdOyBuZXh0SWQ6IG51bWJlcjsgZGlzY2FyZFVzZWQ6IGJvb2xlYW47XG4gIHN0YXR1czogJ2J1aWxkaW5nJzsgbG9nOiBzdHJpbmdbXTsgc3RhdHM6IFN0YXRlWydzdGF0cyddO1xufVxuZXhwb3J0IGludGVyZmFjZSBSdW5TbmFwc2hvdCB7IHY6IG51bWJlcjsgc2VlZDogbnVtYmVyOyBhdHRlbXB0OiBudW1iZXI7IGRpZmZpY3VsdHk6IHN0cmluZzsgcGhhc2U6ICdidWlsZCcgfCAnZHJhZnQnOyBkcmFmdDogU291bElkW10gfCBudWxsOyBzdGF0ZTogU2VyaWFsaXplZFN0YXRlIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZVN0YXRlKHM6IFN0YXRlKTogU2VyaWFsaXplZFN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBydWxlczogSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzLnJ1bGVzKSksIHJuZzogeyBzZWVkOiBzLnJuZy5zZWVkLCBwb3M6IHMucm5nLnN0YXRlKCkgfSxcbiAgICB3YXZlOiBzLndhdmUsIGhlYXJ0czogcy5oZWFydHMsIGNhcDogcy5jYXAsIGhhbmQ6IHMuaGFuZC5zbGljZSgpLCB1bml0czogcy51bml0cy5tYXAoKHUpID0+ICh7IC4uLnUgfSkpLCBuZXh0SWQ6IHMubmV4dElkLCBkaXNjYXJkVXNlZDogcy5kaXNjYXJkVXNlZCxcbiAgICBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogcy5sb2cuc2xpY2UoLTQwKSwgc3RhdHM6IHsgLi4ucy5zdGF0cyB9LFxuICB9O1xufVxuXG5jb25zdCBpc1NvdWwgPSAoeDogYW55KTogeCBpcyBTb3VsSWQgPT4gU09VTFMuaW5jbHVkZXMoeCk7XG5jb25zdCBpbnQgPSAoeDogYW55LCBsbzogbnVtYmVyLCBoaTogbnVtYmVyKSA9PiBOdW1iZXIuaXNJbnRlZ2VyKHgpICYmIHggPj0gbG8gJiYgeCA8PSBoaTtcblxuLyoqIFJlYnVpbGQgYSBTdGF0ZSBmcm9tIHNhdmVkIGRhdGEsIG9yIG51bGwgaWYgYW55dGhpbmcgYWJvdXQgaXQgaXMgbm90IGJlbGlldmFibGUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVTdGF0ZSh4OiBhbnkpOiBTdGF0ZSB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHIgPSB4LnJ1bGVzO1xuICAgIGlmICghciB8fCAhQXJyYXkuaXNBcnJheShyLmN1cnZlKSB8fCAhci5jdXJ2ZS5sZW5ndGggfHwgIXIuY3VydmUuZXZlcnkoKG46IGFueSkgPT4gTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIubWVyZ2UgIT09ICdkZXBsb3llZE9ubHknICYmIHIubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoci5wb29sICE9PSB1bmRlZmluZWQgJiYgIShBcnJheS5pc0FycmF5KHIucG9vbCkgJiYgci5wb29sLmxlbmd0aCAmJiByLnBvb2wuZXZlcnkoaXNTb3VsKSkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHN0YWdlV2F2ZXMgPSByLnN0YWdlV2F2ZXMgPz8gci5jdXJ2ZS5sZW5ndGg7XG4gICAgaWYgKCFpbnQoeC53YXZlLCAxLCBNYXRoLm1pbihzdGFnZVdhdmVzLCByLmN1cnZlLmxlbmd0aCkpIHx8ICFpbnQoeC5oZWFydHMsIDEsIEhFQVJUUykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmNhcCkgfHwgeC5jYXAgPD0gMCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHguaGFuZCkgfHwgeC5oYW5kLmxlbmd0aCA+IDQwIHx8ICF4LmhhbmQuZXZlcnkoaXNTb3VsKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHgudW5pdHMpIHx8IHgudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFpbnQoeC5uZXh0SWQsIDEsIDFlNikgfHwgdHlwZW9mIHguZGlzY2FyZFVzZWQgIT09ICdib29sZWFuJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY2VsbHMgPSBuZXcgU2V0PG51bWJlcj4oKSwgaWRzID0gbmV3IFNldDxudW1iZXI+KCksIHVuaXRzOiBVbml0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgeC51bml0cykge1xuICAgICAgaWYgKCF1IHx8ICFpc1NvdWwodS5zb3VsKSB8fCAhaW50KHUuc3RhciwgMSwgTUFYX1NUQVIpIHx8ICFpbnQodS5jZWxsLCAwLCBHUklEX0NFTExTIC0gMSkgfHwgIWludCh1LmlkLCAxLCB4Lm5leHRJZCkgfHwgY2VsbHMuaGFzKHUuY2VsbCkgfHwgaWRzLmhhcyh1LmlkKSkgcmV0dXJuIG51bGw7XG4gICAgICBjZWxscy5hZGQodS5jZWxsKTsgaWRzLmFkZCh1LmlkKTsgdW5pdHMucHVzaCh7IGlkOiB1LmlkLCBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsLCBmcmVzaDogISF1LmZyZXNoIH0pO1xuICAgIH1cbiAgICBjb25zdCBzdCA9IHguc3RhdHM7XG4gICAgaWYgKCFzdCB8fCAhWydkcmF3bicsICdkaXNjYXJkZWQnLCAnZGlzbWlzc2VkJywgJ21lcmdlcycsICdmYWlsdXJlcyddLmV2ZXJ5KChrKSA9PiBOdW1iZXIuaXNGaW5pdGUoc3Rba10pKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF4LnJuZyB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5ybmcucG9zKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bGVzOiByIGFzIFJ1bGVzLCBybmc6IG1ha2VSbmcoeC5ybmcuc2VlZCwgeC5ybmcucG9zKSwgd2F2ZTogeC53YXZlLCBoZWFydHM6IHguaGVhcnRzLCBjYXA6IHguY2FwLCBoYW5kOiB4LmhhbmQuc2xpY2UoKSwgdW5pdHMsIG5leHRJZDogeC5uZXh0SWQsXG4gICAgICBkaXNjYXJkVXNlZDogeC5kaXNjYXJkVXNlZCwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IEFycmF5LmlzQXJyYXkoeC5sb2cpID8geC5sb2cuZmlsdGVyKChsOiBhbnkpID0+IHR5cGVvZiBsID09PSAnc3RyaW5nJykuc2xpY2UoLTQwKSA6IFtdLFxuICAgICAgc3RhdHM6IHsgZHJhd246IHN0LmRyYXduLCBkaXNjYXJkZWQ6IHN0LmRpc2NhcmRlZCwgZGlzbWlzc2VkOiBzdC5kaXNtaXNzZWQsIG1lcmdlczogc3QubWVyZ2VzLCBmYWlsdXJlczogc3QuZmFpbHVyZXMgfSxcbiAgICB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhdmVSdW4oc25hcDogUnVuU25hcHNob3QsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzbmFwKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDogdGhlIHJ1biBqdXN0IHdpbGwgbm90IHN1cnZpdmUgYSByZWxvYWQgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyUnVuKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUgJiYgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbSkgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbShLRVkpOyBlbHNlIGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksICcnKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG59XG5leHBvcnQgZnVuY3Rpb24gbG9hZFJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IHQgPSBzdG9yZSAmJiBzdG9yZS5nZXRJdGVtKEtFWSk7IGlmICghdCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgeCA9IEpTT04ucGFyc2UodCk7XG4gICAgaWYgKCF4IHx8IHgudiAhPT0gVkVSU0lPTiB8fCAoeC5waGFzZSAhPT0gJ2J1aWxkJyAmJiB4LnBoYXNlICE9PSAnZHJhZnQnKSB8fCAhTnVtYmVyLmlzRmluaXRlKHguc2VlZCkgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmF0dGVtcHQpIHx8IHR5cGVvZiB4LmRpZmZpY3VsdHkgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGF0ZSA9IGRlc2VyaWFsaXplU3RhdGUoeC5zdGF0ZSk7IGlmICghc3RhdGUpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGRyYWZ0ID0geC5waGFzZSA9PT0gJ2RyYWZ0JyAmJiBBcnJheS5pc0FycmF5KHguZHJhZnQpICYmIHguZHJhZnQubGVuZ3RoID09PSAzICYmIHguZHJhZnQuZXZlcnkoaXNTb3VsKSA/IHguZHJhZnQgOiBudWxsO1xuICAgIHJldHVybiB7IHNuYXA6IHsgdjogVkVSU0lPTiwgc2VlZDogeC5zZWVkLCBhdHRlbXB0OiB4LmF0dGVtcHQsIGRpZmZpY3VsdHk6IHguZGlmZmljdWx0eSwgcGhhc2U6IGRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCcsIGRyYWZ0LCBzdGF0ZTogeC5zdGF0ZSB9LCBzdGF0ZSB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cbmV4cG9ydCBjb25zdCBSVU5fVkVSU0lPTiA9IFZFUlNJT047XG4iLCAiLy8gUGVybWFuZW50IHByb2dyZXNzaW9uOiBzdGFnZSBjbGVhcnMgLT4gU291bCBQYWNrcyAtPiBjb3BpZXMgLT4gU291bCBsZXZlbHMuIFB1cmUgZnVuY3Rpb25zIHRoYXQgY2hhbmdlIGEgU2F2ZSAodGhlIGNhbGxlciBwZXJzaXN0cyBpdCkuXG4vLyBQbGFjZWhvbGRlciBudW1iZXJzLCBsaWtlIHBhY2tzLnRzLiBJbi1ydW4gc3RhciBtZXJnaW5nIGlzIGEgc2VwYXJhdGUsIHRlbXBvcmFyeSBzeXN0ZW0gYW5kIG5ldmVyIHRvdWNoZXMgYW55IG9mIHRoaXMuXG5cbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgTEVWRUxfQ09TVF9NVUxULCBQQUNLX1RJRVJTLCBSQVJJVFlfT0YsIG9wZW5QYWNrIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtLCBQYWNrUmVzdWx0IH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlLCB3cml0ZVNhdmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBEaWZmaWN1bHR5LCBTYXZlLCBTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5cbmV4cG9ydCBjb25zdCBNQVhfUEFDS1MgPSA5OTtcblxuLyoqIFdoZXJlIHBhY2tzIGNvbWUgZnJvbS4gUExBQ0VIT0xERVIuIEZpcnN0IGNsZWFyIG9mIGEgc3RhZ2Ugb24gZWFjaCBkaWZmaWN1bHR5IGdpdmVzIG9uZSBpbXByb3ZlZCBwYWNrOyBsYXRlciBjbGVhcnMgZmlsbCBhIG1ldGVyLiAqL1xuZXhwb3J0IGNvbnN0IFJFV0FSRFMgPSB7XG4gIGZpcnN0Q2xlYXJUaWVyOiB7IGVhc3k6IDEsIG5vcm1hbDogMiwgaGFyZDogMiwgbmlnaHRtYXJlOiAzIH0gYXMgUmVjb3JkPERpZmZpY3VsdHksIG51bWJlcj4sXG4gIHJlcGxheVRpZXI6IDEsXG4gIHJlcGxheUNsZWFyc1BlclBhY2s6IDIsXG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbGV2ZWxzXG5leHBvcnQgY29uc3QgbWF4TGV2ZWwgPSAoKTogbnVtYmVyID0+IEJBTEFOQ0UubGV2ZWwuY29waWVzVG9MZXZlbC5sZW5ndGggKyAxO1xuZXhwb3J0IGNvbnN0IGlzTWF4TGV2ZWwgPSAobGV2ZWw6IG51bWJlcik6IGJvb2xlYW4gPT4gbGV2ZWwgPj0gbWF4TGV2ZWwoKTtcbi8qKiBDb3BpZXMgbmVlZGVkIHRvIHRha2UgYHNvdWxgIGZyb20gYGxldmVsYCB0byB0aGUgbmV4dCBvbmUgKDAgd2hlbiBhbHJlYWR5IG1heCkuIFJhcmVyIFNvdWxzIG5lZWQgZmV3ZXIuICovXG5leHBvcnQgY29uc3QgY29waWVzTmVlZGVkID0gKGxldmVsOiBudW1iZXIsIHNvdWw6IFNvdWxJZCk6IG51bWJlciA9PiAoaXNNYXhMZXZlbChsZXZlbCkgPyAwIDogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZChCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWxbbGV2ZWwgLSAxXSAqIExFVkVMX0NPU1RfTVVMVFtSQVJJVFlfT0Zbc291bF1dKSkpO1xuZXhwb3J0IGZ1bmN0aW9uIGNhbkxldmVsVXAoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogYm9vbGVhbiB7IGNvbnN0IHAgPSBzYXZlLnNvdWxzW3NvdWxdOyByZXR1cm4gIWlzTWF4TGV2ZWwocC5sZXZlbCkgJiYgcC5jb3BpZXMgPj0gY29waWVzTmVlZGVkKHAubGV2ZWwsIHNvdWwpOyB9XG4vKiogU3BlbmQgdGhlIGNvcGllcywgZ2FpbiBhIGxldmVsLiBSZXR1cm5zIGZhbHNlIGlmIHRoZSBTb3VsIGlzIG5vdCByZWFkeS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsZXZlbFVwKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4ge1xuICBpZiAoIWNhbkxldmVsVXAoc2F2ZSwgc291bCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IHAuY29waWVzIC09IGNvcGllc05lZWRlZChwLmxldmVsLCBzb3VsKTsgcC5sZXZlbCsrOyByZXR1cm4gdHJ1ZTtcbn1cbi8qKiBNdWx0aXBsaWVyIGFwcGxpZWQgdG8gYSBTb3VsJ3MgaGVhbHRoL2RhbWFnZSBmcm9tIGl0cyBwZXJtYW5lbnQgbGV2ZWwgKGxldmVsIDEgPSAxLjApLiAqL1xuZXhwb3J0IGNvbnN0IGxldmVsTXVsdCA9IChsZXZlbDogbnVtYmVyLCBzdGF0OiAnaHAnIHwgJ2RtZycpOiBudW1iZXIgPT4gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEJBTEFOQ0UubGV2ZWxbc3RhdF07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwYWNrc1xuZXhwb3J0IGZ1bmN0aW9uIGdyYW50UGFjayhzYXZlOiBTYXZlLCB0aWVyOiBudW1iZXIsIHNvdXJjZTogc3RyaW5nKTogUGFja0l0ZW0gfCBudWxsIHtcbiAgaWYgKHNhdmUucGFja3MubGVuZ3RoID49IE1BWF9QQUNLUykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhY2s6IFBhY2tJdGVtID0geyBpZDogc2F2ZS5uZXh0UGFja0lkKyssIHRpZXI6IE1hdGgubWF4KDEsIE1hdGgubWluKFBBQ0tfVElFUlMsIE1hdGguZmxvb3IodGllcikpKSwgc291cmNlIH07XG4gIHNhdmUucGFja3MucHVzaChwYWNrKTsgcmV0dXJuIHBhY2s7XG59XG5cbi8qKiBPcGVuIGFuIG93bmVkIHBhY2s6IGl0IGlzIHJlbW92ZWQgYW5kIGl0cyBjb3BpZXMgYXJlIGFkZGVkIHRvIHRoZSBTb3VscyBpbW1lZGlhdGVseSAoc28gbm90aGluZyBpcyBsb3N0IGlmIHRoZSBwYWdlIGNsb3NlcyBtaWQtYW5pbWF0aW9uKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuT3duZWRQYWNrKHNhdmU6IFNhdmUsIHBhY2tJZDogbnVtYmVyLCBybmc6IFJuZyk6IFBhY2tSZXN1bHQgfCBudWxsIHtcbiAgY29uc3QgaSA9IHNhdmUucGFja3MuZmluZEluZGV4KChwKSA9PiBwLmlkID09PSBwYWNrSWQpOyBpZiAoaSA8IDApIHJldHVybiBudWxsO1xuICBjb25zdCBwYWNrID0gc2F2ZS5wYWNrc1tpXTsgc2F2ZS5wYWNrcy5zcGxpY2UoaSwgMSk7XG4gIGNvbnN0IHJlc3VsdCA9IG9wZW5QYWNrKHBhY2sudGllciwgcm5nKTtcbiAgZm9yIChjb25zdCByIG9mIHJlc3VsdC5yZXZlYWxzKSBzYXZlLnNvdWxzW3Iuc291bF0uY29waWVzICs9IHIuY29waWVzO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENsZWFyUmV3YXJkIHsgZmlyc3Q6IGJvb2xlYW47IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgcmVwbGF5TWV0ZXI6IG51bWJlcjsgcmVwbGF5TmVlZGVkOiBudW1iZXIgfVxuLyoqIEEgc3RhZ2Ugd2FzIGNsZWFyZWQgb24gYGRpZmZpY3VsdHlgLiBUaGUgZmlyc3QgY2xlYXIgb24gdGhhdCBkaWZmaWN1bHR5IGdyYW50cyBhIGJldHRlciBwYWNrOyBsYXRlciBjbGVhcnMgZmlsbCB0aGUgcmVwbGF5IG1ldGVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3Qga2V5ID0gc3RhZ2VJZCArICc6JyArIGRpZmZpY3VsdHksIGJlZm9yZSA9IHNhdmUuY2xlYXJzW2tleV0gPz8gMDtcbiAgc2F2ZS5jbGVhcnNba2V5XSA9IGJlZm9yZSArIDE7XG4gIGlmIChiZWZvcmUgPT09IDApIHJldHVybiB7IGZpcnN0OiB0cnVlLCBwYWNrOiBncmFudFBhY2soc2F2ZSwgUkVXQVJEUy5maXJzdENsZWFyVGllcltkaWZmaWN1bHR5XSwgJ0ZpcnN0IGNsZWFyIFx1MDBCNyAnICsgZGlmZmljdWx0eSksIHJlcGxheU1ldGVyOiBzYXZlLnJlcGxheU1ldGVyLCByZXBsYXlOZWVkZWQ6IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjayB9O1xuICBzYXZlLnJlcGxheU1ldGVyKys7XG4gIGxldCBwYWNrOiBQYWNrSXRlbSB8IG51bGwgPSBudWxsO1xuICBpZiAoc2F2ZS5yZXBsYXlNZXRlciA+PSBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2spIHsgc2F2ZS5yZXBsYXlNZXRlciAtPSBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2s7IHBhY2sgPSBncmFudFBhY2soc2F2ZSwgUkVXQVJEUy5yZXBsYXlUaWVyLCAnUmVwbGF5IHJld2FyZCcpOyB9XG4gIHJldHVybiB7IGZpcnN0OiBmYWxzZSwgcGFjaywgcmVwbGF5TWV0ZXI6IHNhdmUucmVwbGF5TWV0ZXIsIHJlcGxheU5lZWRlZDogUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwZXJzaXN0ZWQgd3JhcHBlcnMgKHVzZWQgYnkgdGhlIGdhbWUgYnVuZGxlKVxuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyQW5kU2F2ZShzdGFnZUlkOiBzdHJpbmcsIGRpZmZpY3VsdHk6IERpZmZpY3VsdHksIHN0b3JlPzogU3RvcmUgfCBudWxsKTogQ2xlYXJSZXdhcmQge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBjb25zdCByID0gcmVjb3JkQ2xlYXIocywgc3RhZ2VJZCwgZGlmZmljdWx0eSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByO1xufVxuIiwgIi8vIEV2ZXJ5dGhpbmcgeW91IFNFRSBmb3IgYSB1bml0OiByZWFsIFRyaXBvIG1vZGVscyAoU2tlbGV0b24gV2FycmlvciwgU2tlbGV0b24gQXJjaGVyKSwgc2ltcGxlIHN0YW5kLWlucyBmb3IgdGhlIGZvdXJcbi8vIGNoYXJhY3RlcnMgdGhhdCBhcmUgbm90IGdlbmVyYXRlZCB5ZXQsIGFuZCB0aGUgXCJzdGFyIGxvb2tcIiBsYXllcmVkIG9uIHRvcCBvZiBib3RoIChzaXplLCB0aW50LCBhdXJhLCBoYWxvLCBiYWRnZSkuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuXG5leHBvcnQgdHlwZSBWU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYXRoJyB8ICdzcGF3bicgfCAnY2hlZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb24gKyB5YXcgaGVyZVxuICB0ZWFtOiAwIHwgMTsgc3RhcjogbnVtYmVyOyBzdGF0ZTogVlN0YXRlOyB0b3A6IG51bWJlcjtcbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZD86IG51bWJlcik6IHZvaWQ7XG4gIHNldFN0YXIoc3RhcjogbnVtYmVyKTogdm9pZDtcbiAgc2V0VGVhbSh0ZWFtOiAwIHwgMSk6IHZvaWQ7XG4gIHNldEhwKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAgLy8gbnVsbCBoaWRlcyB0aGUgaGVhbHRoIGJhclxuICBzZXRNYW5hKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAvLyBudWxsIGhpZGVzIHRoZSBtYW5hIGJhciAodW5pdHMgd2l0aG91dCBhIHNraWxsKVxuICBwdWxzZSgpOiB2b2lkOyAgICAgICAgICAgICAgICAgICAgIC8vIGJyaWVmIGhpdCByZWFjdGlvblxuICB1cGRhdGUoZHQ6IG51bWJlcik6IHZvaWQ7XG4gIGRpc3Bvc2UoKTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFyIGxvb2tzXG4vLyAxIHN0YXIgPSB0aGUgcGxhaW4gbW9kZWwuIDIgc3RhcnMgPSBhIGxpdHRsZSBiaWdnZXIsIGNvb2wgc2lsdmVyLWJsdWUgdGludCwgYnJpZ2h0ZXIgYXVyYS4gMyBzdGFycyA9IGJpZ2dlc3QsIHdhcm0gZ29sZCB0aW50LFxuLy8gc3Ryb25nIGdvbGQtdmlvbGV0IGF1cmEgYW5kIGEgZmxvYXRpbmcgZ29sZCBoYWxvLiBFdmVyeXRoaW5nIGhlcmUgaXMgZnJlZTogbm8gZXh0cmEgVHJpcG8gZ2VuZXJhdGlvbnMuXG5jb25zdCBUSU5UOiBudW1iZXJbXVtdID0gW1sxLCAxLCAxXSwgWzAuODYsIDAuOTUsIDEuMThdLCBbMS4yNSwgMS4xLCAwLjddXTtcbmNvbnN0IEFVUkEgPSBbXG4gIHsgcmF0ZTogMTQsIG1pbjogMC4wNiwgbWF4OiAwLjE2LCBjMTogWzAuNzgsIDAuMzUsIDEsIDAuN10sIGMyOiBbMC40NSwgMC4xNSwgMC45LCAwLjVdIH0sXG4gIHsgcmF0ZTogMjYsIG1pbjogMC4wOCwgbWF4OiAwLjIwLCBjMTogWzAuODUsIDAuNjUsIDEsIDAuOF0sIGMyOiBbMC41NSwgMC40LCAxLCAwLjZdIH0sXG4gIHsgcmF0ZTogNDQsIG1pbjogMC4xMCwgbWF4OiAwLjI2LCBjMTogWzEsIDAuODUsIDAuNCwgMC44NV0sIGMyOiBbMC44LCAwLjMsIDEsIDAuN10gfSxcbl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRzIHtcbiAgc2NlbmU6IGFueTsgc29mdDogYW55OyBzdGFyVGV4OiBhbnlbXTsgdHJpcG86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgVHJpcG9DZmc+PjtcbiAgcmluZ01hdDogYW55W107IGhhbG9NYXQ6IGFueTsgYmFyQmc6IGFueTsgYmFyRmlsbDogYW55W107IG1hbmFGaWxsOiBhbnk7XG59XG5pbnRlcmZhY2UgVHJpcG9DZmcgeyBjb250YWluZXI6IGFueTsgZW5lbXlUZXg6IGFueTsgY2xpcHM6IFJlY29yZDxWU3RhdGUsIHN0cmluZz47IG1hdENhY2hlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+OyBiYXNlTWF0PzogYW55OyB0b3A6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9XG5cbmZ1bmN0aW9uIGR5bihzY2VuZTogYW55LCB3OiBudW1iZXIsIGg6IG51bWJlciwgZHJhdzogKGM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCkgPT4gdm9pZCwgYWxwaGEgPSB0cnVlKSB7XG4gIGNvbnN0IHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnZHQnLCB7IHdpZHRoOiB3LCBoZWlnaHQ6IGggfSwgc2NlbmUsIHRydWUpOyBkcmF3KHQuZ2V0Q29udGV4dCgpKTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IGFscGhhOyByZXR1cm4gdDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRBc3NldHMoc2NlbmU6IGFueSk6IFByb21pc2U8QXNzZXRzPiB7XG4gIGNvbnN0IHNvZnQgPSBkeW4oc2NlbmUsIDY0LCA2NCwgKGMpID0+IHsgY29uc3QgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwuNTUpJyk7IGcuYWRkQ29sb3JTdG9wKDEsICdyZ2JhKDI1NSwyNTUsMjU1LDApJyk7IGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCA2NCwgNjQpOyB9KTtcbiAgY29uc3Qgc3RhclRleCA9IFsxLCAyLCAzXS5tYXAoKG4pID0+IGR5bihzY2VuZSwgMTkyLCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgNDBweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVN0eWxlID0gJyMxYTEwMjAnOyBjLmZpbGxTdHlsZSA9IG4gPT09IDMgPyAnI2ZmZDI0YScgOiBuID09PSAyID8gJyNkN2U2ZmYnIDogJyNmMGQ5YTAnOyBjb25zdCBzID0gJ1x1MjYwNScucmVwZWF0KG4pOyBjLnN0cm9rZVRleHQocywgOTYsIDM4KTsgYy5maWxsVGV4dChzLCA5NiwgMzgpOyB9KSk7XG4gIGNvbnN0IGVtaXNzaXZlID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdlbScsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IGE7IHJldHVybiBtOyB9O1xuICBjb25zdCBBOiBBc3NldHMgPSB7XG4gICAgc2NlbmUsIHNvZnQsIHN0YXJUZXgsIHRyaXBvOiB7fSwgcmluZ01hdDogW2VtaXNzaXZlKDAuNTUsIDAuMiwgMC45NSwgMC45KSwgZW1pc3NpdmUoMC45NSwgMC4yNSwgMC4yLCAwLjkpXSwgaGFsb01hdDogZW1pc3NpdmUoMSwgMC44MiwgMC4zLCAwLjk1KSxcbiAgICBiYXJCZzogZW1pc3NpdmUoMC4wNSwgMC4wNSwgMC4wOCwgMC43KSwgYmFyRmlsbDogW2VtaXNzaXZlKDAuNTUsIDAuMzUsIDEpLCBlbWlzc2l2ZSgxLCAwLjQsIDAuMyldLCBtYW5hRmlsbDogZW1pc3NpdmUoMC4yNSwgMC43NSwgMSksXG4gIH07XG4gIGNvbnN0IGRlZnM6IFtTb3VsSWQsIHN0cmluZywgc3RyaW5nLCBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+LCBudW1iZXIsIG51bWJlcl1bXSA9IFtcbiAgICBbJ3dhcnJpb3InLCAnc2tlbGV0b25fd2Fycmlvci5nbGInLCAnc2tlbGV0b25fd2Fycmlvcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0Jsb2NrJyB9LCAxLjA1LCAxLjBdLFxuICAgIFsnYXJjaGVyJywgJ1NrZWxldG9uQXJjaGVyLmdsYicsICdTa2VsZXRvbkFyY2hlcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnU2hvb3QnLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnRmxleCcgfSwgMS4wNSwgMS4wXSxcbiAgXTtcbiAgYXdhaXQgUHJvbWlzZS5hbGwoZGVmcy5tYXAoYXN5bmMgKFtzb3VsLCBnbGIsIGVuZW15LCBjbGlwcywgdG9wLCBzY2FsZV0pID0+IHtcbiAgICBjb25zdCBjb250YWluZXIgPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgZ2xiLCBzY2VuZSk7XG4gICAgQS50cmlwb1tzb3VsXSA9IHsgY29udGFpbmVyLCBlbmVteVRleDogbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBlbmVteSwgc2NlbmUsIGZhbHNlLCBmYWxzZSksIGNsaXBzLCBtYXRDYWNoZToge30sIHRvcCwgc2NhbGUgfTtcbiAgfSkpO1xuICByZXR1cm4gQTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzaGFyZWQgZGVjb3JhdGlvblxuY2xhc3MgRGVjbyB7XG4gIHByaXZhdGUgcHM6IGFueSA9IG51bGw7IHByaXZhdGUgaGFsbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBiYWRnZTogYW55OyBwcml2YXRlIHN0YXJzOiBhbnk7IHByaXZhdGUgZmlsbDogYW55OyBwcml2YXRlIGJhcjogYW55OyBwcml2YXRlIG1iZzogYW55OyBwcml2YXRlIG1maWxsOiBhbnk7IHByaXZhdGUgcmluZzogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBwYXJlbnQ6IGFueSwgcHJpdmF0ZSB0b3A6IG51bWJlciwgcHJpdmF0ZSByYWRpdXM6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lO1xuICAgIHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygncmluZycsIHsgcmFkaXVzOiBNYXRoLm1heCgwLjMsIHJhZGl1cyAqIDEuMTUpLCB0ZXNzZWxsYXRpb246IDI2IH0sIHMpOyB0aGlzLnJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0aGlzLnJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHRoaXMucmluZy5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMucmluZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYWRnZSA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2JhZGdlJywgcyk7IHRoaXMuYmFkZ2UucGFyZW50ID0gcGFyZW50OyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0b3AgKyAwLjMyOyB0aGlzLmJhZGdlLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgdGhpcy5zdGFycyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3N0YXJzJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMTUgfSwgcyk7IHRoaXMuc3RhcnMucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5zdGFycy5wb3NpdGlvbi55ID0gMC4xMTsgdGhpcy5zdGFycy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzbScsIHMpOyBzbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgc20uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgc20udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB0aGlzLnN0YXJzLm1hdGVyaWFsID0gc207ICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtID0gc207XG4gICAgY29uc3QgYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdiZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA4NSB9LCBzKTsgYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgYmcubWF0ZXJpYWwgPSBBLmJhckJnOyBiZy5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMuYmFyID0gYmc7XG4gICAgdGhpcy5maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuZmlsbC5wb3NpdGlvbi56ID0gLTAuMDAyOyB0aGlzLmZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWJnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMubWJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWJnLnBvc2l0aW9uLnkgPSAtMC4wNzsgdGhpcy5tYmcubWF0ZXJpYWwgPSBBLmJhckJnOyB0aGlzLm1iZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21maWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjAzIH0sIHMpOyB0aGlzLm1maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWZpbGwucG9zaXRpb24uc2V0KDAsIC0wLjA3LCAtMC4wMDIpOyB0aGlzLm1maWxsLm1hdGVyaWFsID0gQS5tYW5hRmlsbDsgdGhpcy5tZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYXIuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuZmlsbC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tYmcuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgc2V0KHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5BLnNjZW5lLCBjZmcgPSBBVVJBW3N0YXIgLSAxXTtcbiAgICAodGhpcy5zdGFycyBhcyBhbnkpLl9zbS5kaWZmdXNlVGV4dHVyZSA9IHRoaXMuQS5zdGFyVGV4W3N0YXIgLSAxXTtcbiAgICB0aGlzLnJpbmcubWF0ZXJpYWwgPSB0aGlzLkEucmluZ01hdFt0ZWFtXTsgdGhpcy5maWxsLm1hdGVyaWFsID0gdGhpcy5BLmJhckZpbGxbdGVhbV07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJhaXNlZCBieSB0aGUgTmVjcm9tYW5jZXI6IHB1cnBsZSBhdXJhIHRoYXQgZ3Jvd3Mgd2l0aCBzdGFyc1xuICAgICAgaWYgKCF0aGlzLnBzKSB7XG4gICAgICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2F1cmEnLCA3MCwgcyk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5wYXJlbnQ7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIHRoaXMudG9wICogMC41LCAwLjIpO1xuICAgICAgICBwcy5taW5MaWZlVGltZSA9IDAuNTsgcHMubWF4TGlmZVRpbWUgPSAxLjE7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjgsIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS41LCAwLjE1KTtcbiAgICAgICAgcHMubWluRW1pdFBvd2VyID0gMC4zNTsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHRoaXMucHMgPSBwcztcbiAgICAgIH1cbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBzOyBwLmVtaXRSYXRlID0gY2ZnLnJhdGU7IHAubWluU2l6ZSA9IGNmZy5taW47IHAubWF4U2l6ZSA9IGNmZy5tYXg7IHAuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMSk7IHAuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMik7IHAuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICAgIGlmICghcC5pc1N0YXJ0ZWQoKSkgcC5zdGFydCgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wcyAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTtcbiAgICBpZiAoc3RhciA+PSAzKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBoYWxvIGFib3ZlIHRoZSBoZWFkXG4gICAgICBpZiAoIXRoaXMuaGFsbykgeyB0aGlzLmhhbG8gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoYWxvJywgeyBkaWFtZXRlcjogMC41NSwgdGhpY2tuZXNzOiAwLjA0LCB0ZXNzZWxsYXRpb246IDI0IH0sIHMpOyB0aGlzLmhhbG8ucGFyZW50ID0gdGhpcy5wYXJlbnQ7IHRoaXMuaGFsby5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjA4OyB0aGlzLmhhbG8ubWF0ZXJpYWwgPSB0aGlzLkEuaGFsb01hdDsgdGhpcy5oYWxvLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgICAgdGhpcy5oYWxvLnNldEVuYWJsZWQodHJ1ZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmhhbG8pIHRoaXMuaGFsby5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLmJhci5zZXRFbmFibGVkKG9uKTsgdGhpcy5maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMuZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLm1iZy5zZXRFbmFibGVkKG9uKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMubWZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5tZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0QXVyYShvbjogYm9vbGVhbikgeyBpZiAodGhpcy5wcykgeyBpZiAob24gJiYgIXRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RhcnQoKTsgaWYgKCFvbiAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTsgfSB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7IGlmICh0aGlzLmhhbG8gJiYgdGhpcy5oYWxvLmlzRW5hYmxlZCgpKSB0aGlzLmhhbG8ucm90YXRpb24ueSArPSBkdCAqIDEuNjsgfVxuICBkaXNwb3NlKCkgeyBpZiAodGhpcy5wcykgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IH0gW3RoaXMuaGFsbywgdGhpcy5yaW5nLCB0aGlzLnN0YXJzLCB0aGlzLmJhciwgdGhpcy5maWxsLCB0aGlzLm1iZywgdGhpcy5tZmlsbF0uZm9yRWFjaCgobSkgPT4gbSAmJiBtLmRpc3Bvc2UoKSk7IHRoaXMuYmFkZ2UuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcmVhbCBtb2RlbHNcbmNsYXNzIFRyaXBvVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIGVudDogYW55OyBwcml2YXRlIGJvZHk6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIGJhc2U6IG51bWJlcjtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgY2ZnOiBUcmlwb0NmZywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIHVpZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDcpO1xuICAgIHRoaXMuZW50ID0gY2ZnLmNvbnRhaW5lci5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIHVpZCwgZmFsc2UsIHsgZG9Ob3RJbnN0YW50aWF0ZTogdHJ1ZSB9KTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3VuaXRfJyArIHVpZCwgcyk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICB0aGlzLmJvZHkgPSB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5maW5kKChtOiBhbnkpID0+IG0ubmFtZS5pbmNsdWRlcygnX0JvZHknKSk7XG4gICAgaWYgKCFjZmcuYmFzZU1hdCkgY2ZnLmJhc2VNYXQgPSB0aGlzLmJvZHkubWF0ZXJpYWw7XG4gICAgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4geyBnLnN0b3AoKTsgZy5lbmFibGVCbGVuZGluZyA9IHRydWU7IGcuYmxlbmRpbmdTcGVlZCA9IDAuMTI7IHRoaXMuYW5pbXNbZy5uYW1lLnNwbGl0KCdfJylbMF1dID0gZzsgfSk7XG4gICAgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uYWx3YXlzU2VsZWN0QXNBY3RpdmVNZXNoID0gdHJ1ZTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH0pO1xuICAgIHRoaXMudG9wID0gY2ZnLnRvcDsgdGhpcy5iYXNlID0gY2ZnLnNjYWxlOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgMC4zKTtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IDEuMywgZGlhbWV0ZXI6IDAuOCB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IDAuNjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLmlzUGlja2FibGUgPSB0cnVlO1xuICAgIHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gIH1cbiAgcHJpdmF0ZSBhcHBseU1hdCgpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLnRlYW0gKyAnXycgKyB0aGlzLnN0YXIsIGMgPSB0aGlzLmNmZztcbiAgICBpZiAoIWMubWF0Q2FjaGVba2V5XSkgeyBjb25zdCBtID0gYy5iYXNlTWF0LmNsb25lKCdtXycgKyBrZXkpOyBpZiAodGhpcy50ZWFtID09PSAxKSBtLmFsYmVkb1RleHR1cmUgPSBjLmVuZW15VGV4OyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgbS5hbGJlZG9Db2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyh0WzBdLCB0WzFdLCB0WzJdKTsgYy5tYXRDYWNoZVtrZXldID0gbTsgfVxuICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IGMubWF0Q2FjaGVba2V5XTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbChCQUxBTkNFLnN0YXIuc2NhbGVbc3QgLSAxXSAqIHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHtcbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1t0aGlzLmNmZy5jbGlwc1tzdGF0ZV1dOyBpZiAoIWcpIHJldHVybjsgY29uc3QgbG9vcCA9IHN0YXRlID09PSAnaWRsZScgfHwgc3RhdGUgPT09ICdydW4nO1xuICAgIGlmIChsb29wICYmIHRoaXMuc3RhdGUgPT09IHN0YXRlICYmIHRoaXMuY3VyID09PSBnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGxvb3AsIHNwZWVkLCBnLmZyb20sIGcudG8pO1xuICAgIGlmIChsb29wKSBnLmdvVG9GcmFtZShnLmZyb20gKyBNYXRoLnJhbmRvbSgpICogKGcudG8gLSBnLmZyb20pKTtcbiAgICB0aGlzLmN1ciA9IGc7IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpO1xuICB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy5kZWNvLnVwZGF0ZShkdCk7XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbChCQUxBTkNFLnN0YXIuc2NhbGVbdGhpcy5zdGFyIC0gMV0gKiB0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IGcuZGlzcG9zZSgpKTsgdGhpcy5lbnQuc2tlbGV0b25zLmZvckVhY2goKHM6IGFueSkgPT4gcy5kaXNwb3NlKCkpOyB0aGlzLnBpY2suZGlzcG9zZSgpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0uZGlzcG9zZShmYWxzZSwgZmFsc2UpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFuZC1pbnNcbmNvbnN0IFBIOiBSZWNvcmQ8c3RyaW5nLCB7IGNvbDogc3RyaW5nOyB3OiBudW1iZXI7IGg6IG51bWJlcjsgaGVhZDogbnVtYmVyOyB3ZWFwb246IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9PiA9IHtcbiAgZ29ibGluOiB7IGNvbDogJyM2M2IxM2YnLCB3OiAwLjM2LCBoOiAwLjQyLCBoZWFkOiAwLjM2LCB3ZWFwb246ICdkYWdnZXInLCBsYWJlbDogJ0dPQkxJTicgfSxcbiAga25pZ2h0OiB7IGNvbDogJyM4ZWE5ZGMnLCB3OiAwLjUsIGg6IDAuNiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnc2hpZWxkJywgbGFiZWw6ICdLTklHSFQnIH0sXG4gIG9ncmU6IHsgY29sOiAnI2E4YTY0YScsIHc6IDAuODUsIGg6IDAuODUsIGhlYWQ6IDAuNDIsIHdlYXBvbjogJ21hY2UnLCBsYWJlbDogJ09HUkUnIH0sXG4gIGJhcmJhcmlhbjogeyBjb2w6ICcjZDY4YTU1JywgdzogMC41MiwgaDogMC42MiwgaGVhZDogMC4zOCwgd2VhcG9uOiAnYXhlJywgbGFiZWw6ICdCQVJCQVJJQU4nIH0sXG59O1xuY2xhc3MgUGxhY2Vob2xkZXJWaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgcmlnOiBhbnk7IHByaXZhdGUgbGVnczogYW55W10gPSBbXTsgcHJpdmF0ZSB3cDogYW55OyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHQgPSBNYXRoLnJhbmRvbSgpICogNjsgcHJpdmF0ZSBzdDAgPSAwOyBwcml2YXRlIGR1ciA9IDE7IHByaXZhdGUgYmFzZSA9IDE7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBtYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGJvZHk6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgc291bDogc3RyaW5nLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIGQgPSBQSFtzb3VsXTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3BoXycgKyBzb3VsLCBzKTsgdGhpcy5yaWcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdyaWcnLCBzKTsgdGhpcy5yaWcucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgY29uc3QgbWF0ID0gKGhleDogc3RyaW5nLCBlbSA9IDApID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3BtJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhoZXgpLnNjYWxlKDAuNzIpOyBtLnNwZWN1bGFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xLCAwLjEsIDAuMSk7IGlmIChlbSkgbS5lbWlzc2l2ZUNvbG9yID0gbS5kaWZmdXNlQ29sb3Iuc2NhbGUoZW0pOyByZXR1cm4gbTsgfTtcbiAgICBjb25zdCBsZWdIID0gMC4yMiwgYm9keVkgPSBsZWdIICsgZC5oIC8gMjtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgbGcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdsZWcnLCBzKTsgbGcucGFyZW50ID0gdGhpcy5yaWc7IGxnLnBvc2l0aW9uLnNldChzeCAqIGQudyAqIDAuMjIsIGxlZ0gsIDApOyBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignbCcsIHsgaGVpZ2h0OiBsZWdILCBkaWFtZXRlcjogZC53ICogMC4yOCB9LCBzKTsgbS5wYXJlbnQgPSBsZzsgbS5wb3NpdGlvbi55ID0gLWxlZ0ggLyAyOyBtLm1hdGVyaWFsID0gbWF0KCcjNGEzODI2Jyk7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmxlZ3MucHVzaChsZyk7IH1cbiAgICB0aGlzLmJvZHkgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUNhcHN1bGUoJ2JvZHknLCB7IHJhZGl1czogZC53IC8gMiwgaGVpZ2h0OiBkLmggKyBkLncgKiAwLjQgfSwgcyk7IHRoaXMuYm9keS5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy5ib2R5LnBvc2l0aW9uLnkgPSBib2R5WTsgdGhpcy5ib2R5Lm1hdGVyaWFsID0gbWF0KGQuY29sKTsgdGhpcy5ib2R5LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBoZWFkID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2hlYWQnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAxLjUsIHNlZ21lbnRzOiAxMiB9LCBzKTsgaGVhZC5wYXJlbnQgPSB0aGlzLnJpZzsgaGVhZC5wb3NpdGlvbi55ID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDAuNTU7IGhlYWQubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyBoZWFkLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBleWVNID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZXllJywgcyk7IGV5ZU0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZXllTS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgKHRoaXMgYXMgYW55KS5leWVNID0gZXllTTtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgZSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdlJywgeyBkaWFtZXRlcjogZC5oZWFkICogMC4zIH0sIHMpOyBlLnBhcmVudCA9IHRoaXMucmlnOyBlLnBvc2l0aW9uLnNldChzeCAqIGQuaGVhZCAqIDAuMywgaGVhZC5wb3NpdGlvbi55ICsgMC4wMiwgZC5oZWFkICogMC42Nik7IGUubWF0ZXJpYWwgPSBleWVNOyBlLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIC8vIHdlYXBvbiBwaXZvdCBhdCB0aGUgc2hvdWxkZXIsIG9uIHRoZSBjaGFyYWN0ZXIncyByaWdodCAoLXggaXMgZmluZSBmb3IgYSBzdGFuZC1pbilcbiAgICB0aGlzLndwID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnd3AnLCBzKTsgdGhpcy53cC5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy53cC5wb3NpdGlvbi5zZXQoZC53ICogMC42LCBsZWdIICsgZC5oICogMC44NSwgMC4wNSk7XG4gICAgY29uc3Qgd20gPSBtYXQoJyM3YTVhMzAnKSwgaXJvbiA9IG1hdCgnIzlhYTFhZCcpO1xuICAgIGNvbnN0IG1rID0gKG06IGFueSwga2luZDogc3RyaW5nLCBkaW1zOiBhbnksIHBvczogbnVtYmVyW10sIG10OiBhbnkpID0+IHsgY29uc3QgeCA9IGtpbmQgPT09ICdib3gnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVCb3goJ3cnLCBkaW1zLCBzKSA6IGtpbmQgPT09ICdjeWwnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigndycsIGRpbXMsIHMpIDogQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ3cnLCBkaW1zLCBzKTsgeC5wYXJlbnQgPSB0aGlzLndwOyB4LnBvc2l0aW9uLnNldChwb3NbMF0sIHBvc1sxXSwgcG9zWzJdKTsgeC5tYXRlcmlhbCA9IG10OyB4LmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIHg7IH07XG4gICAgaWYgKGQud2VhcG9uID09PSAnZGFnZ2VyJykgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDUsIGhlaWdodDogMC4zLCBkZXB0aDogMC4wMyB9LCBbMCwgLTAuMiwgMC4xMl0sIGlyb24pO1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ3NoaWVsZCcpIHsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDYsIGhlaWdodDogMC41LCBkZXB0aDogMC4wNCB9LCBbMCwgLTAuMywgMC4xNF0sIGlyb24pOyBjb25zdCBzaCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3NoJywgeyBoZWlnaHQ6IDAuMDUsIGRpYW1ldGVyOiAwLjU1IH0sIHMpOyBzaC5wYXJlbnQgPSB0aGlzLnJpZzsgc2gucm90YXRpb24ueiA9IE1hdGguUEkgLyAyOyBzaC5wb3NpdGlvbi5zZXQoLWQudyAqIDAuNywgbGVnSCArIGQuaCAqIDAuNiwgMC4wNSk7IHNoLm1hdGVyaWFsID0gbWF0KCcjZDhiNjRhJyk7IHNoLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ21hY2UnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC45LCBkaWFtZXRlcjogMC4wOCB9LCBbMCwgLTAuMzUsIDAuM10sIHdtKTsgbWsoMCwgJ3NwaCcsIHsgZGlhbWV0ZXI6IDAuNCB9LCBbMCwgLTAuODUsIDAuNF0sIGlyb24pOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnYXhlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuNiwgZGlhbWV0ZXI6IDAuMDUgfSwgWzAsIC0wLjIsIDAuMTVdLCB3bSk7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjMyLCBoZWlnaHQ6IDAuMjIsIGRlcHRoOiAwLjA1IH0sIFswLCAtMC41LCAwLjE1XSwgaXJvbik7IGNvbnN0IGhhaXIgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdoYWlyJywgeyBoZWlnaHQ6IDAuMywgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiBkLmhlYWQgKiAxLjIgfSwgcyk7IGhhaXIucGFyZW50ID0gdGhpcy5yaWc7IGhhaXIucG9zaXRpb24ueSA9IGhlYWQucG9zaXRpb24ueSArIGQuaGVhZCAqIDAuNzU7IGhhaXIubWF0ZXJpYWwgPSBtYXQoJyNjMjJhMWMnKTsgaGFpci5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICB0aGlzLnRvcCA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAxLjM1OyB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIGQudyAqIDAuNyk7XG4gICAgY29uc3QgbGJsID0gZHluKHMsIDI1NiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDI2cHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMuZmlsbFN0eWxlID0gJyNmZmZmZmYnOyBjLnN0cm9rZVN0eWxlID0gJyMxMTEnOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IGMuZmlsbFRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyB9KTtcbiAgICBjb25zdCBscCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2xibCcsIHsgd2lkdGg6IDEuMSwgaGVpZ2h0OiAwLjIgfSwgcyk7IGxwLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBscC5wb3NpdGlvbi55ID0gLTAuMTsgbHAucm90YXRpb24ueCA9IE1hdGguUEkgLyAyICogMC4wOyBscC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBjb25zdCBsbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2xtJywgcyk7IGxtLmRpZmZ1c2VUZXh0dXJlID0gbGJsOyBsbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBscC5tYXRlcmlhbCA9IGxtOyBscC5pc1BpY2thYmxlID0gZmFsc2U7IGxwLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuNjI7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiB0aGlzLnRvcCwgZGlhbWV0ZXI6IE1hdGgubWF4KDAuNywgZC53ICogMS4zKSB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IHRoaXMudG9wIC8gMjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICAgICh0aGlzIGFzIGFueSkucGFydHMgPSBbbHBdOyB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5wbGF5KCdpZGxlJyk7XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyAodGhpcyBhcyBhbnkpLmV5ZU0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYmFzZSA9IEJBTEFOQ0Uuc3Rhci5zY2FsZVtzdCAtIDFdOyBjb25zdCB0ID0gVElOVFtzdCAtIDFdOyB0aGlzLmJvZHkubWF0ZXJpYWwuZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhQSFt0aGlzLnNvdWxdLmNvbCkuc2NhbGUoMC43MikubXVsdGlwbHkobmV3IEJBQllMT04uQ29sb3IzKE1hdGgubWluKDEsIHRbMF0pLCBNYXRoLm1pbigxLCB0WzFdKSwgTWF0aC5taW4oMSwgdFsyXSkpKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkgeyBpZiAoc3RhdGUgPT09IHRoaXMuc3RhdGUgJiYgKHN0YXRlID09PSAnaWRsZScgfHwgc3RhdGUgPT09ICdydW4nKSkgcmV0dXJuOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuc3QwID0gdGhpcy50OyB0aGlzLmR1ciA9IHN0YXRlID09PSAnYXR0YWNrJyA/IChCQUxBTkNFLnN0YXRzW3RoaXMuc291bCBhcyBTb3VsSWRdLmFuaW1MZW4gLyBzcGVlZCkgOiBzdGF0ZSA9PT0gJ2RlYXRoJyA/IDAuNiA6IHN0YXRlID09PSAnc3Bhd24nID8gMC45IDogMS4wOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7IH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLnQgKz0gZHQ7IHRoaXMuZGVjby51cGRhdGUoZHQpOyBjb25zdCBwID0gTWF0aC5taW4oMSwgKHRoaXMudCAtIHRoaXMuc3QwKSAvIHRoaXMuZHVyKSwgUiA9IHRoaXMucmlnLCBXID0gdGhpcy53cDtcbiAgICBSLnBvc2l0aW9uLnNldCgwLCAwLCAwKTsgUi5yb3RhdGlvbi5zZXQoMCwgMCwgMCk7IFIuc2NhbGluZy5zZXRBbGwoMSk7IFcucm90YXRpb24ueCA9IC0wLjQ7IHRoaXMubGVncy5mb3JFYWNoKChsKSA9PiAobC5yb3RhdGlvbi54ID0gMCkpO1xuICAgIGlmICh0aGlzLnN0YXRlID09PSAnaWRsZScpIFIucG9zaXRpb24ueSA9IE1hdGguc2luKHRoaXMudCAqIDIuMikgKiAwLjAxMjtcbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAncnVuJykgeyBjb25zdCB3ID0gdGhpcy50ICogMTA7IFIucG9zaXRpb24ueSA9IE1hdGguYWJzKE1hdGguc2luKHcpKSAqIDAuMDc7IFIucm90YXRpb24ueCA9IDAuMjsgdGhpcy5sZWdzWzBdLnJvdGF0aW9uLnggPSBNYXRoLnNpbih3KSAqIDAuOTsgdGhpcy5sZWdzWzFdLnJvdGF0aW9uLnggPSAtTWF0aC5zaW4odykgKiAwLjk7IFcucm90YXRpb24ueCA9IC0wLjQgKyBNYXRoLnNpbih3KSAqIDAuNDsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdhdHRhY2snKSB7IGNvbnN0IGsgPSBwIDwgMC40ID8gLTIuNCAqIChwIC8gMC40KSA6IC0yLjQgKyAzLjQgKiBNYXRoLm1pbigxLCAocCAtIDAuNCkgLyAwLjI1KTsgVy5yb3RhdGlvbi54ID0gazsgUi5wb3NpdGlvbi56ID0gMC4xNCAqIE1hdGguc2luKE1hdGguUEkgKiBwKTsgUi5yb3RhdGlvbi54ID0gMC4xNSAqIE1hdGguc2luKE1hdGguUEkgKiBwKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHsgY29uc3QgZSA9IHAgKiBwICogKDMgLSAyICogcCk7IFIuc2NhbGluZy5zZXRBbGwoMC4wMSArIDAuOTkgKiBlKTsgUi5wb3NpdGlvbi55ID0gKGUgLSAxKSAqIDAuNDsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdkZWF0aCcpIHsgY29uc3QgZSA9IHAgKiBwOyBSLnJvdGF0aW9uLnggPSAtTWF0aC5QSSAvIDIgKiBlOyBSLnBvc2l0aW9uLnkgPSAwLjI1ICogZTsgUi5wb3NpdGlvbi56ID0gLTAuMiAqIGU7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnY2hlZXInKSB7IFIucG9zaXRpb24ueSA9IE1hdGguYWJzKE1hdGguc2luKHRoaXMudCAqIDcpKSAqIDAuMTU7IFcucm90YXRpb24ueCA9IC0yLjY7IH1cbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5kZWNvLmRpc3Bvc2UoKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVWaXN1YWwoQTogQXNzZXRzLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpOiBVbml0VmlzdWFsIHtcbiAgY29uc3QgY2ZnID0gQS50cmlwb1tzb3VsXTtcbiAgcmV0dXJuIGNmZyA/IG5ldyBUcmlwb1Zpc3VhbChBLCBjZmcsIHNvdWwsIHRlYW0sIHN0YXIpIDogbmV3IFBsYWNlaG9sZGVyVmlzdWFsKEEsIHNvdWwsIHRlYW0sIHN0YXIpO1xufVxuZXhwb3J0IGNvbnN0IGlzVHJpcG8gPSAoQTogQXNzZXRzLCBzb3VsOiBTb3VsSWQpID0+ICEhQS50cmlwb1tzb3VsXTtcbiIsICIvLyBUaGUgZ2FtZSdzIGljb24gc2V0IChjdXN0b20gYXJ0LCBzbGljZWQgZnJvbSBQaXBlbGluZS9pY29ucy9zaGVldF8qLnBuZyBieSBQaXBlbGluZS9ibGVuZGVyL3NsaWNlX2ljb25zLnB5IC0+IGRvY3MvYXNzZXRzL2ljb25zLyoucG5nKS5cbi8vIFNoYXJlZCBieSB0aGUgM0QgZ2FtZSdzIERPTSAodmFuaWxsYSkgYW5kIHRoZSBBbmd1bGFyIHNoZWxsLiBObyBlbW9qaSBhbnl3aGVyZTogZXZlcnkgZ2x5cGggaW4gdGhlIFVJIGlzIG9uZSBvZiB0aGVzZSBpbWFnZXMuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJhcml0eSB9IGZyb20gJy4uL2NvcmUvcGFja3MudHMnO1xuXG5leHBvcnQgdHlwZSBJY29uTmFtZSA9XG4gIHwgJ2hvbWUnIHwgJ3NvdWxzJyB8ICdzaG9wJyB8ICdzZXR0aW5ncycgfCAnY2xvc2UnXG4gIHwgJ2hlYXJ0JyB8ICdoZWFydF9lbXB0eScgfCAnZG9taW5pb24nIHwgJ3N0YXInIHwgJ2xvY2snXG4gIHwgJ3dhcnJpb3InIHwgJ2FyY2hlcicgfCAnZ29ibGluJyB8ICdrbmlnaHQnIHwgJ29ncmUnIHwgJ2JhcmJhcmlhbidcbiAgfCAnZ2VtX2NvbW1vbicgfCAnZ2VtX3JhcmUnIHwgJ2dlbV9lcGljJyB8ICdnZW1fbGVnZW5kYXJ5J1xuICB8ICdtdXNpYycgfCAnc291bmRfb24nIHwgJ3NvdW5kX29mZicgfCAndXBncmFkZScgfCAnc3dhcCdcbiAgfCAnbWVyZ2UnIHwgJ3JlbW92ZScgfCAnY2hlY2snIHwgJ2JhY2snIHwgJ2luZm8nO1xuXG4vKiogUmVsYXRpdmUgdG8gdGhlIHBhZ2UsIHNvIGl0IHdvcmtzIG9uIEdpdEh1YiBQYWdlcyB1bmRlciAvcmVwby1uYW1lLy4gKi9cbmV4cG9ydCBjb25zdCBpY29uVXJsID0gKG46IEljb25OYW1lKTogc3RyaW5nID0+ICdhc3NldHMvaWNvbnMvJyArIG4gKyAnLnBuZyc7XG4vKiogQW4gPGltZz4gYXMgYW4gSFRNTCBzdHJpbmcsIGZvciB0aGUgZ2FtZSdzIGhhbmQtYnVpbHQgRE9NLiAqL1xuZXhwb3J0IGNvbnN0IGljb25JbWcgPSAobjogSWNvbk5hbWUsIGNscyA9ICdpYycpOiBzdHJpbmcgPT4gYDxpbWcgY2xhc3M9XCIke2Nsc31cIiBzcmM9XCIke2ljb25Vcmwobil9XCIgYWx0PVwiXCIgZHJhZ2dhYmxlPVwiZmFsc2VcIj5gO1xuXG4vKiogRWFjaCBTb3VsIGlzIHNob3duIGJ5IGl0cyB3ZWFwb24vcm9sZSBpY29uIHVudGlsIHJlYWwgcG9ydHJhaXRzIGV4aXN0LiAqL1xuZXhwb3J0IGNvbnN0IFNPVUxfSUNPTjogUmVjb3JkPFNvdWxJZCwgSWNvbk5hbWU+ID0geyB3YXJyaW9yOiAnd2FycmlvcicsIGFyY2hlcjogJ2FyY2hlcicsIGdvYmxpbjogJ2dvYmxpbicsIGtuaWdodDogJ2tuaWdodCcsIG9ncmU6ICdvZ3JlJywgYmFyYmFyaWFuOiAnYmFyYmFyaWFuJyB9O1xuZXhwb3J0IGNvbnN0IFJBUklUWV9HRU06IFJlY29yZDxSYXJpdHksIEljb25OYW1lPiA9IHsgY29tbW9uOiAnZ2VtX2NvbW1vbicsIHJhcmU6ICdnZW1fcmFyZScsIGVwaWM6ICdnZW1fZXBpYycsIGxlZ2VuZGFyeTogJ2dlbV9sZWdlbmRhcnknIH07XG5cbi8qKiBQYWNrIHRpZXJzIGFyZSBzaG93biBhcyBza3VsbHMgKG5ldmVyIHN0YXJzOiBzdGFycyBtZWFuIGFuIGluLXJ1biBtZXJnZSBsZXZlbCkuICovXG5leHBvcnQgY29uc3Qgc2t1bGxJbWdzID0gKG46IG51bWJlciwgY2xzID0gJ3NrJyk6IHN0cmluZyA9PiBpY29uSW1nKCdzb3VscycsIGNscykucmVwZWF0KE1hdGgubWF4KDEsIG4pKTtcbmV4cG9ydCBjb25zdCBoZWFydHNIdG1sID0gKGhlYXJ0czogbnVtYmVyLCBtYXggPSAzKTogc3RyaW5nID0+IGljb25JbWcoJ2hlYXJ0JywgJ2ljIGhlYXJ0JykucmVwZWF0KE1hdGgubWF4KDAsIGhlYXJ0cykpICsgaWNvbkltZygnaGVhcnRfZW1wdHknLCAnaWMgaGVhcnQnKS5yZXBlYXQoTWF0aC5tYXgoMCwgbWF4IC0gaGVhcnRzKSk7XG4iLCAiLy8gRE9NIHVzZXIgaW50ZXJmYWNlOiB0b3AgYmFyLCBlbmVteSBwcmV2aWV3LCBoYW5kIG9mIGNhcmRzLCBidXR0b25zLCBkcmFmdCBvdmVybGF5LCB0b2FzdHMgYW5kIHRoZSBkZWJ1ZyBwYW5lbC5cbmltcG9ydCB7IEJBTEFOQ0UsIFJPTEVfVEVYVCwgU09VTF9OQU1FIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7IGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY29zdCwgZG9taW5pb25GcmVlLCBkb21pbmlvblVzZWQsIHN0YWdlV2F2ZXMgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGVuZW15V2F2ZSwgcHJldmlld1RleHQgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgeyBTT1VMX0lDT04sIGhlYXJ0c0h0bWwsIGljb25JbWcsIGljb25VcmwsIHNrdWxsSW1ncyB9IGZyb20gJy4uL3VpL2ljb25zLnRzJztcblxuY29uc3QgSUNPTiA9IE9iamVjdC5mcm9tRW50cmllcyhTT1VMUy5tYXAoKHMpID0+IFtzLCBpY29uSW1nKFNPVUxfSUNPTltzXSwgJ2ljJyldKSkgYXMgUmVjb3JkPFNvdWxJZCwgc3RyaW5nPjtcbmNvbnN0ICQgPSAoaWQ6IHN0cmluZykgPT4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpITtcbmNvbnN0IHN0YXJzID0gKG46IG51bWJlcikgPT4gJ1x1MjYwNScucmVwZWF0KG4pO1xuXG5leHBvcnQgY2xhc3MgVWkge1xuICBwcml2YXRlIHRvYXN0VCA9IDA7IHByaXZhdGUgZGJnOiBIVE1MRWxlbWVudDsgcHJpdmF0ZSBvZGRzID0gJyc7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgZzogYW55KSB7XG4gICAgJCgnYnRuSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgJCgnYnRuQmF0dGxlJykub25jbGljayA9ICgpID0+IGcuc3RhcnRCYXR0bGUoKTsgJCgnYnRuU3dhcCcpLm9uY2xpY2sgPSAoKSA9PiBnLnRvZ2dsZVN3YXAoKTtcbiAgICAkKCdidG5NZXJnZScpLm9uY2xpY2sgPSAoKSA9PiBnLm1lcmdlU2VsZWN0ZWQoKTsgJCgnYnRuUmVtb3ZlJykub25jbGljayA9ICgpID0+IGcucmVtb3ZlU2VsZWN0ZWQoKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtc3BlZWRdJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0U3BlZWQoK2IuZGF0YXNldC5zcGVlZCEpKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRDYW1Nb2RlKGIuZGF0YXNldC5jYW0hKSkpO1xuICAgICQoJ2dlYXInKS5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmRiZy5jbGFzc0xpc3QudG9nZ2xlKCdvcGVuJyk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICBjb25zdCBzbmQgPSAoKSA9PiB7ICQoJ2J0bk11c2ljJykuY2xhc3NMaXN0LnRvZ2dsZSgnb2ZmJywgIWF1ZGlvLm11c2ljKTsgJCgnYnRuU2Z4JykuY2xhc3NMaXN0LnRvZ2dsZSgnb2ZmJywgIWF1ZGlvLnNmeCk7IGNvbnN0IHNpID0gJCgnYnRuU2Z4JykucXVlcnlTZWxlY3RvcignaW1nJyk7IGlmIChzaSkgc2kuc3JjID0gaWNvblVybChhdWRpby5zZnggPyAnc291bmRfb24nIDogJ3NvdW5kX29mZicpOyB9O1xuICAgICQoJ2J0bk11c2ljJykub25jbGljayA9ICgpID0+IHsgYXVkaW8uc2V0TXVzaWMoIWF1ZGlvLm11c2ljKTsgc25kKCk7IH07ICQoJ2J0blNmeCcpLm9uY2xpY2sgPSAoKSA9PiB7IGF1ZGlvLnNldFNmeCghYXVkaW8uc2Z4KTsgc25kKCk7IH07XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzJywgc25kKTsgc25kKCk7XG4gICAgdGhpcy5kYmcgPSAkKCdkZWJ1ZycpOyBpZiAobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnZGVidWcnKSkgdGhpcy5kYmcuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICAgIHRoaXMucmVuZGVyRGVidWcoKTtcbiAgfVxuXG4gIC8qKiBUaGUgTmVjcm9tYW5jZXIganVzdCBsb3N0IGEgaGVhcnQ6IG1ha2UgdGhlIGhlYXJ0cyBidW1wLiAqL1xuICBwdWxzZUhlYXJ0cygpIHsgY29uc3QgaCA9ICQoJ2hlYXJ0cycpOyBoLmNsYXNzTGlzdC5yZW1vdmUoJ2h1cnQnKTsgdm9pZCBoLm9mZnNldFdpZHRoOyBoLmNsYXNzTGlzdC5hZGQoJ2h1cnQnKTsgfVxuICB0b2FzdChtc2c6IHN0cmluZykgeyBjb25zdCB0ID0gJCgndG9hc3QnKTsgdC50ZXh0Q29udGVudCA9IG1zZzsgdC5jbGFzc0xpc3QuYWRkKCdzaG93Jyk7IGNsZWFyVGltZW91dCh0aGlzLnRvYXN0VCk7IHRoaXMudG9hc3RUID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4gdC5jbGFzc0xpc3QucmVtb3ZlKCdzaG93JyksIDM2MDApOyB9XG5cbiAgcmVuZGVyKCkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmcsIHMgPSBnLnMsIHBoID0gZy5waGFzZSwgYnVpbGQgPSBwaCA9PT0gJ2J1aWxkJztcbiAgICAkKCdoZWFydHMnKS5pbm5lckhUTUwgPSBoZWFydHNIdG1sKHMuaGVhcnRzKTtcbiAgICAkKCd3YXZlJykudGV4dENvbnRlbnQgPSBgV2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfWA7XG4gICAgY29uc3QgdXNlZCA9IGRvbWluaW9uVXNlZChzKTsgJCgnZG9tJykudGV4dENvbnRlbnQgPSBgJHt1c2VkfS8ke3MuY2FwfWA7ICgkKCdkb21maWxsJykgYXMgSFRNTEVsZW1lbnQpLnN0eWxlLndpZHRoID0gTWF0aC5taW4oMTAwLCAodXNlZCAvIHMuY2FwKSAqIDEwMCkgKyAnJSc7XG4gICAgLy8gZW5lbXkgcHJldmlldzogd2hhdCBpcyBjb21pbmcsIG5ldmVyIHdoZXJlXG4gICAgY29uc3QgcHYgPSBwcmV2aWV3VGV4dChlbmVteVdhdmUocy53YXZlLCBnLnNlZWQpKTtcbiAgICAkKCdlbmVteScpLmlubmVySFRNTCA9IGA8Yj5OZXh0IGVuZW1pZXM8L2I+YCArIHB2Lm1hcCgocCkgPT4gYDxkaXYgY2xhc3M9XCJlcm93XCI+PHNwYW4+JHtJQ09OW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3Bhbj4ke1NPVUxfTkFNRVtwLnNvdWwgYXMgU291bElkXX08L3NwYW4+PHNwYW4gY2xhc3M9XCJ4XCI+XHUwMEQ3JHtwLmNvdW50fTwvc3Bhbj48c3BhbiBjbGFzcz1cInN0XCI+JHtzdGFycyhwLnN0YXIpfTwvc3Bhbj48L2Rpdj5gKS5qb2luKCcnKSArIGA8ZGl2IGNsYXNzPVwiaGludFwiPlBvc2l0aW9ucyBzdGF5IGhpZGRlbiB1bnRpbCB0aGUgYmF0dGxlLjwvZGl2PmA7XG4gICAgLy8gaGFuZFxuICAgIGNvbnN0IGhhbmQgPSAkKCdoYW5kJyk7IGhhbmQuaW5uZXJIVE1MID0gJyc7XG4gICAgcy5oYW5kLmZvckVhY2goKHNvdWw6IFNvdWxJZCwgaTogbnVtYmVyKSA9PiB7XG4gICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBjb25zdCBzZWwgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAnY2FyZCcgJiYgZy5zZWwuaWR4ID09PSBpOyBjb25zdCBhZmZvcmQgPSBjYW5TdW1tb24ocywgaSksIGNhbk1lcmdlID0gcy51bml0cy5zb21lKCh1OiBhbnkpID0+IGNhbk1lcmdlRnJvbUhhbmQocywgaSwgdS5pZCkpLCB1c2FibGUgPSBhZmZvcmQgfHwgY2FuTWVyZ2U7XG4gICAgICBlbC5jbGFzc05hbWUgPSAnY2FyZCcgKyAoc2VsID8gJyBzZWwnIDogJycpICsgKCF1c2FibGUgJiYgIWcuc3dhcE1vZGUgPyAnIGRpcycgOiAnJykgKyAoZy5zd2FwTW9kZSA/ICcgc3dhcCcgOiAnJyk7XG4gICAgICBjb25zdCB0YWcgPSBhZmZvcmQgPyBgPHNwYW4gY2xhc3M9XCJva1wiPlN1bW1vbjwvc3Bhbj5gIDogY2FuTWVyZ2UgPyAnPHNwYW4gY2xhc3M9XCJvayBtZ1wiPk1lcmdlIG9ubHk8L3NwYW4+JyA6ICc8c3BhbiBjbGFzcz1cIm5vXCI+Tm8gcm9vbTwvc3Bhbj4nO1xuICAgICAgZWwuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PiR7SUNPTltzb3VsXX08ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj48ZGl2IGNsYXNzPVwiY3NcIj4ke3RhZ308L2Rpdj5gOyBlbC50aXRsZSA9IFJPTEVfVEVYVFtzb3VsXSArIChhZmZvcmQgPyAnJyA6IGNhbk1lcmdlID8gJyAtIERvbWluaW9uIGlzIGZ1bGwsIGJ1dCB5b3UgY2FuIG1lcmdlIGl0IGludG8geW91ciBtYXRjaGluZyAxLXN0YXIgdW5pdC4nIDogJyAtIE5vdCBlbm91Z2ggZnJlZSBEb21pbmlvbiB0byBzdW1tb24gdGhpcy4nKTtcbiAgICAgIGVsLm9uY2xpY2sgPSAoKSA9PiBnLm9uQ2FyZChpKTsgaGFuZC5hcHBlbmRDaGlsZChlbCk7XG4gICAgfSk7XG4gICAgaWYgKCFzLmhhbmQubGVuZ3RoKSBoYW5kLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPVwiZW1wdHlcIj5ObyBjYXJkcyBpbiBoYW5kPC9kaXY+JztcbiAgICAvLyBidXR0b25zXG4gICAgKCQoJ2J0bkJhdHRsZScpIGFzIEhUTUxCdXR0b25FbGVtZW50KS5kaXNhYmxlZCA9ICFidWlsZCB8fCAhcy51bml0cy5sZW5ndGg7XG4gICAgY29uc3Qgc3cgPSAkKCdidG5Td2FwJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQ7IHN3LmRpc2FibGVkID0gIWJ1aWxkIHx8IHMuZGlzY2FyZFVzZWQ7IHN3LmNsYXNzTGlzdC50b2dnbGUoJ29uJywgZy5zd2FwTW9kZSk7IHN3LnRleHRDb250ZW50ID0gcy5kaXNjYXJkVXNlZCA/ICdTd2FwIHVzZWQnIDogZy5zd2FwTW9kZSA/ICdTd2FwOiBwaWNrIGEgY2FyZCBvciB1bml0JyA6ICdTd2FwICgxL3JvdW5kKSc7XG4gICAgY29uc3Qgc2VsVSA9IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICd1bml0JyA/IHMudW5pdHMuZmluZCgodTogYW55KSA9PiB1LmlkID09PSBnLnNlbC5pZCkgOiBudWxsO1xuICAgIGNvbnN0IHBhcnRuZXIgPSBzZWxVICYmIHMudW5pdHMuc29tZSgobzogYW55KSA9PiBjYW5NZXJnZURlcGxveWVkKHNlbFUsIG8pKTtcbiAgICAkKCd1bml0cGFuZWwnKS5zdHlsZS5kaXNwbGF5ID0gYnVpbGQgJiYgc2VsVSA/ICdmbGV4JyA6ICdub25lJzsgKCQoJ2J0bk1lcmdlJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQpLmRpc2FibGVkID0gIXBhcnRuZXI7XG4gICAgJCgnYnRuUmVtb3ZlJykudGV4dENvbnRlbnQgPSBnLmNvbmZpcm1SZW1vdmUgPyAnQ29uZmlybSByZW1vdmUnIDogJ1JlbW92ZSc7XG4gICAgJCgnaW5mbycpLnRleHRDb250ZW50ID0gYnVpbGQgPyAoZy5zd2FwTW9kZSA/ICdTV0FQOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCBpdCwgb3IgdGFwIGEgdW5pdCB5b3UgZGlkIG5vdCBzdW1tb24gdGhpcyByb3VuZCB0byBzZWxsIGl0LiBZb3UgZHJhdyBhIGRpZmZlcmVudCBTb3VsLidcbiAgICAgIDogc2VsVSA/IGAke1NPVUxfTkFNRVtzZWxVLnNvdWwgYXMgU291bElkXX0gJHtzdGFycyhzZWxVLnN0YXIpfSAgXHUyMDIyICAke1JPTEVfVEVYVFtzZWxVLnNvdWwgYXMgU291bElkXX0gICR7cGFydG5lciA/ICdcdTIwMjIgVGFwIGEgZ2xvd2luZyBwYXJ0bmVyIHRvIG1lcmdlLicgOiAnJ31gXG4gICAgICA6IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyA/IGAke1NPVUxfTkFNRVtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfTogJHtST0xFX1RFWFRbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX0gIFx1MjAyMiAgYCArICgoKSA9PiB7IGNvbnN0IGkgPSBnLnNlbC5pZHgsIHNtID0gY2FuU3VtbW9uKHMsIGkpLCBtZyA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKTsgcmV0dXJuIHNtICYmIG1nID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLCBvciBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6IHNtID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLicgOiBtZyA/ICdEb21pbmlvbiBpcyBmdWxsOiB0YXAgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiAnTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLic7IH0pKCkgOiAnVGFwIGEgY2FyZCwgdGhlbiBhIHRpbGUuIFRhcCBhIHVuaXQgdG8gbWVyZ2UsIG1vdmUgb3IgcmVtb3ZlIGl0LicpXG4gICAgICA6IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ0JhdHRsZSEgVW5pdHMgZmlnaHQgb24gdGhlaXIgb3duLicgOiAnJztcbiAgICAkKCdzcGVlZCcpLnN0eWxlLmRpc3BsYXkgPSBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdmbGV4JyA6ICdub25lJztcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtc3BlZWRdJykuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsICtiLmRhdGFzZXQuc3BlZWQhID09PSBnLnRpbWVTY2FsZSkpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGIuZGF0YXNldC5jYW0gPT09IGcuY2FtTW9kZSkpO1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnRvZ2dsZSgnaW5iYXR0bGUnLCBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyk7IGF1ZGlvLnNldE1vZGUocGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnYmF0dGxlJyA6ICdidWlsZCcpO1xuICAgIC8vIG92ZXJsYXlcbiAgICBjb25zdCBvdiA9ICQoJ292ZXJsYXknKTsgb3YuY2xhc3NOYW1lID0gJyc7IG92LmlubmVySFRNTCA9ICcnO1xuICAgIGlmIChwaCA9PT0gJ2RyYWZ0JyAmJiBnLmRyYWZ0KSB7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPlZpY3RvcnkgRHJhZnQ8L2gyPjxkaXYgY2xhc3M9XCJzdWJcIj5XYXZlIGNsZWFyZWQuIERvbWluaW9uIGlzIG5vdyAke3MuY2FwfS4gS2VlcCBvbmU6PC9kaXY+PGRpdiBjbGFzcz1cInJvd1wiPiR7Zy5kcmFmdC5tYXAoKHNvdWw6IFNvdWxJZCwgaTogbnVtYmVyKSA9PiBgPGRpdiBjbGFzcz1cImNhcmQgYmlnXCIgZGF0YS1pPVwiJHtpfVwiPjxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PiR7SUNPTltzb3VsXX08ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj48ZGl2IGNsYXNzPVwicm9sZVwiPiR7Uk9MRV9URVhUW3NvdWxdfTwvZGl2PjwvZGl2PmApLmpvaW4oJycpfTwvZGl2PjwvZGl2PmA7XG4gICAgICBvdi5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignLmNhcmQnKS5mb3JFYWNoKChjKSA9PiAoYy5vbmNsaWNrID0gKCkgPT4gZy5waWNrRHJhZnQoK2MuZGF0YXNldC5pISkpKTtcbiAgICB9IGVsc2UgaWYgKHBoID09PSAnd29uJyB8fCBwaCA9PT0gJ2xvc3QnKSB7XG4gICAgICBjb25zdCBydyA9IHBoID09PSAnd29uJyA/IGcucmV3YXJkIDogbnVsbCwgc2sgPSAobjogbnVtYmVyKSA9PiBza3VsbEltZ3Mobik7XG4gICAgICBjb25zdCByZXdhcmRIdG1sID0gcncgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke3J3LnBhY2sgPyAocncuZmlyc3QgPyBgJHtpY29uSW1nKCdzaG9wJyl9IEZpcnN0IGNsZWFyISBZb3UgZWFybmVkIGEgJHtzayhydy5wYWNrLnRpZXIpfSBTb3VsIFBhY2suYCA6IGAke2ljb25JbWcoJ3Nob3AnKX0gUmVwbGF5IHJld2FyZDogYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gKSA6IGBSZXBsYXkgcHJvZ3Jlc3MgJHtydy5yZXBsYXlNZXRlcn0vJHtydy5yZXBsYXlOZWVkZWR9IHRvd2FyZCBhIFNvdWwgUGFjay5gfTwvZGl2PmAgOiAnJztcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+JHtwaCA9PT0gJ3dvbicgPyAnU3RhZ2UgY2xlYXJlZCEnIDogJ1N0YWdlIGxvc3QnfTwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPiR7Zy5sYXN0QmF0dGxlfTwvZGl2PiR7cmV3YXJkSHRtbH08ZGl2IGNsYXNzPVwicm93XCI+JHtydyAmJiBydy5wYWNrID8gJzxidXR0b24gaWQ9XCJ0b1Nob3BcIiBjbGFzcz1cImdvXCI+T3BlbiBwYWNrPC9idXR0b24+JyA6ICcnfTxidXR0b24gaWQ9XCJhZ2FpblwiIGNsYXNzPVwiJHtydyAmJiBydy5wYWNrID8gJ2JsdWUnIDogJ2dvJ31cIj4ke3BoID09PSAnd29uJyA/ICdQbGF5IGFnYWluJyA6ICdUcnkgYWdhaW4nfTwvYnV0dG9uPjxidXR0b24gaWQ9XCJ0b0hvbWVcIiBjbGFzcz1cImJsdWVcIj5Ib21lPC9idXR0b24+PC9kaXY+PC9kaXY+YDtcbiAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IGcubmV3UnVuKCk7ICQoJ3RvSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgICBjb25zdCB0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b1Nob3AnKTsgaWYgKHRzKSB0cy5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zaG9wJykpO1xuICAgIH1cbiAgICB0aGlzLnJlbmRlckRlYnVnTGl2ZSgpO1xuICAgIGlmIChwaCA9PT0gJ2J1aWxkJykgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IGcucmVmcmFtZUJ1aWxkKCkpOyAgICAgLy8gYWZ0ZXIgbGF5b3V0OiBrZWVwIHRoZSBncmlkIGNsZWFyIG9mIHRoZSBoYW5kIGFuZCBidXR0b25zXG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgcGFuZWxcbiAgcHJpdmF0ZSByZW5kZXJEZWJ1ZygpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBkID0gdGhpcy5kYmc7IGlmICghZC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSkgeyBkLmlubmVySFRNTCA9ICcnOyByZXR1cm47IH1cbiAgICBjb25zdCByb3cgPSAobGFiZWw6IHN0cmluZywgb2JqOiBhbnksIGtleTogc3RyaW5nIHwgbnVtYmVyLCBtaW46IG51bWJlciwgbWF4OiBudW1iZXIsIHN0ZXA6IG51bWJlcikgPT4gYDxsYWJlbD4ke2xhYmVsfSA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiJHttaW59XCIgbWF4PVwiJHttYXh9XCIgc3RlcD1cIiR7c3RlcH1cIiB2YWx1ZT1cIiR7b2JqW2tleV19XCIgZGF0YS1vPVwiJHtsYWJlbH1cIj48c3Bhbj4ke29ialtrZXldfTwvc3Bhbj48L2xhYmVsPmA7XG4gICAgZC5pbm5lckhUTUwgPSBgPGI+RGVidWcgKGxpdmUpPC9iPiA8c3BhbiBpZD1cImRiZ2Zwc1wiPjwvc3Bhbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+U3RhciBtdWx0aXBsaWVycyAoYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHkpXG4gICAgICAgICR7cm93KCdIUCB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdIUCB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnU2l6ZSAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAxLCAxLCAxLjYsIDAuMDIpfSR7cm93KCdTaXplIDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDIsIDEsIDIsIDAuMDIpfTwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48dGFibGU+PHRyPjx0aD48L3RoPjx0aD5ocDwvdGg+PHRoPmRtZzwvdGg+PHRoPnJhdGU8L3RoPjx0aD5yYW5nZTwvdGg+PHRoPnNwZDwvdGg+PC90cj4ke1NPVUxTLm1hcCgoaykgPT4gYDx0cj48dGQ+JHtJQ09OW2tdfTwvdGQ+JHtbJ2hwJywgJ2RtZycsICdpbnRlcnZhbCcsICdyYW5nZScsICdzcGVlZCddLm1hcCgoZikgPT4gYDx0ZD48aW5wdXQgY2xhc3M9XCJudW1cIiBkYXRhLXNvdWw9XCIke2t9XCIgZGF0YS1mPVwiJHtmfVwiIHZhbHVlPVwiJHsoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2tdW2ZdfVwiPjwvdGQ+YCkuam9pbignJyl9PC90cj5gKS5qb2luKCcnKX08L3RhYmxlPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5EaWZmaWN1bHR5IDxzZWxlY3QgaWQ9XCJkRGlmZlwiPiR7WydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5QZXJmb3JtYW5jZTxicj48c21hbGwgaWQ9XCJkYmdQZXJmXCI+bWVhc3VyaW5nXHUyMDI2PC9zbWFsbD48YnI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRGcHNcIiAke2cuc2hvd0ZwcyA/ICdjaGVja2VkJyA6ICcnfT4gU2hvdyBGUFMgb24gdGhlIGJhdHRsZSBzY3JlZW48L2xhYmVsPiA8YnV0dG9uIGlkPVwiZFBlcmZcIj5Db3B5IHBlcmYgcmVwb3J0PC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkT2Rkc1wiPlRlc3Qgb2RkcyAoMjAwIGZpZ2h0cyk8L2J1dHRvbj4gPHNwYW4gaWQ9XCJkT2Rkc091dFwiPiR7dGhpcy5vZGRzfTwvc3Bhbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRDb3B5XCI+Q29weSByZXBvcnQ8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXNldFwiPlJlc2V0IGJhbGFuY2U8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXN0YXJ0XCI+UmVzdGFydCBzdGFnZTwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5BZGQgY2FyZCA8c2VsZWN0IGlkPVwiZENhcmRcIj4ke1NPVUxTLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCI+JHtTT1VMX05BTUVba119PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxidXR0b24gaWQ9XCJkQWRkXCI+KzwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZERvbVwiPisyIERvbWluaW9uPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5MYXN0IHRhcDogPHNwYW4gaWQ9XCJkYmd0YXBcIj4ke2cubGFzdFRhcEluZm99PC9zcGFuPjwvc21hbGw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5TZWVkICR7Zy5zZWVkfS4gQWRkIDxjb2RlPj9zZWVkPTc8L2NvZGU+IHRvIHRoZSBsaW5rIHRvIHJlcGxheSB0aGUgc2FtZSBkcmF3cy48L3NtYWxsPjwvZGl2PmA7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dFt0eXBlPXJhbmdlXScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmlucHV0ID0gKCkgPT4ge1xuICAgICAgY29uc3QgbGFiID0gaW5wLmRhdGFzZXQubyE7IGNvbnN0IHYgPSAraW5wLnZhbHVlOyAoaW5wLm5leHRFbGVtZW50U2libGluZyBhcyBIVE1MRWxlbWVudCkudGV4dENvbnRlbnQgPSBTdHJpbmcodik7XG4gICAgICBjb25zdCBzZXQ6IFJlY29yZDxzdHJpbmcsICgpID0+IHZvaWQ+ID0geyAnSFAgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsxXSA9IHYpLCAnSFAgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsyXSA9IHYpLCAnRGFtYWdlIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzFdID0gdiksICdEYW1hZ2UgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMl0gPSB2KSwgJ1NpemUgMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMV0gPSB2KSwgJ1NpemUgM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMl0gPSB2KSB9O1xuICAgICAgc2V0W2xhYl0oKTsgZy5hcHBseUJhbGFuY2VDaGFuZ2UoKTtcbiAgICB9KSk7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dC5udW0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25jaGFuZ2UgPSAoKSA9PiB7IChCQUxBTkNFLnN0YXRzIGFzIGFueSlbaW5wLmRhdGFzZXQuc291bCFdW2lucC5kYXRhc2V0LmYhXSA9ICtpbnAudmFsdWU7IH0pKTtcbiAgICAkKCdkRGlmZicpLm9uY2hhbmdlID0gKGUpID0+IGcuY2hhbmdlRGlmZmljdWx0eSgoZS50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlKTtcbiAgICAkKCdkTWVyZ2VIYW5kJykub25jaGFuZ2UgPSAoZSkgPT4geyBnLnMucnVsZXMubWVyZ2UgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZCA/ICdoYW5kSW50b09uZVN0YXInIDogJ2RlcGxveWVkT25seSc7IGcuc3luY0J1aWxkKCk7IHRoaXMucmVuZGVyKCk7IH07XG4gICAgJCgnZE9kZHMnKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCByID0gZy50ZXN0T2RkcygyMDApOyB0aGlzLm9kZHMgPSBgJHtyLndpbn0lIHdpbiAoJHtyLm59IGZpZ2h0cywgYXZnICR7ci5hdmdUaW1lfXMpIHZzIHdhdmUgJHtnLnMud2F2ZX1gOyAkKCdkT2Rkc091dCcpLnRleHRDb250ZW50ID0gdGhpcy5vZGRzOyB9O1xuICAgICQoJ2RDb3B5Jykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucmVwb3J0KCk7IChuYXZpZ2F0b3IuY2xpcGJvYXJkID8gbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCkgOiBQcm9taXNlLnJlamVjdCgpKS50aGVuKCgpID0+IHRoaXMudG9hc3QoJ1JlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RGcHMnKS5vbmNoYW5nZSA9IChlKSA9PiBnLnNldFNob3dGcHMoKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQpO1xuICAgICQoJ2RQZXJmJykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucGVyZlJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdQZXJmIHJlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RSZXNldCcpLm9uY2xpY2sgPSAoKSA9PiB7IGcucmVzZXRCYWxhbmNlQWxsKCk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICAkKCdkUmVzdGFydCcpLm9uY2xpY2sgPSAoKSA9PiBnLnN0YXJ0U3RhZ2UoZy5zZWVkKTtcbiAgICAkKCdkQWRkJykub25jbGljayA9ICgpID0+IGcuYWRkQ2FyZCgoJCgnZENhcmQnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUgYXMgU291bElkKTsgJCgnZERvbScpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZERvbWluaW9uKDIpO1xuICB9XG4gIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ1BlcmYnKTsgaWYgKHBmKSB7IGNvbnN0IHAgPSB0aGlzLmcucGVyZkluZm8oKTsgcGYudGV4dENvbnRlbnQgPSBgJHtwLmZwcy50b0ZpeGVkKDApfSBmcHMgXHUwMEI3IGF2ZyAke3AuYXZnLnRvRml4ZWQoMSl9bXMgXHUwMEI3IHNsb3c1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMgXHUwMEI3IHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIFx1MDBCNyAke3AubWVzaGVzfSBtZXNoZXMgXHUwMEI3ICR7cC5wYXJ0aWNsZXN9IHBhcnRpY2xlIHN5c3RlbXMgXHUwMEI3ICR7cC5kcmF3c30gZHJhdyBjYWxsc2A7IH1cbiAgICBjb25zdCB0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ3RhcCcpOyBpZiAodCkgdC50ZXh0Q29udGVudCA9IHRoaXMuZy5sYXN0VGFwSW5mbztcbiAgfVxufVxuIiwgIi8vIFRoZSBwbGF5YWJsZSBwcm90b3R5cGU6IGJ1aWxkIHNjcmVlbiAtPiBiYXR0bGUgLT4gZHJhZnQgLT4gbmV4dCB3YXZlLCBidWlsdCBvbiB0aGUgdGVzdGVkIHJ1bGVzICsgYmF0dGxlIGVuZ2luZS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSwgcmVzZXRCYWxhbmNlLCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgR1JJRF9DRUxMUywgR1JJRF9DT0xTLCBHUklEX1JPV1MsIFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7XG4gIGFkdmFuY2VXYXZlLCBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNlbGxGcmVlLCBjb3N0LCBkaXNjYXJkUmVkcmF3LCBkaXNtaXNzLCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgZHJhZnRPcHRpb25zLCBmYWlsV2F2ZSxcbiAgbWVyZ2VEZXBsb3llZCwgbWVyZ2VGcm9tSGFuZCwgbW92ZVVuaXQsIG5ld1N0YWdlLCBub3JtYWxEcmF3LCBzdGFnZVdhdmVzLCBzdW1tb24sIHN3YXBTZWxsLCB0YWtlRHJhZnQsXG59IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgQmF0dGxlLCBjZWxsUG9zLCBGUk9OVF9YLCBHUklEX1NQLCBzaW11bGF0ZSB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB0eXBlIHsgQkV2ZW50IH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHsgZGlmZmljdWx0eU5hbWUsIGVuZW15V2F2ZSwgc2V0RGlmZmljdWx0eSB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgUFJPVE9UWVBFX1JVTEVTIH0gZnJvbSAnLi4vY29yZS9wcm90b3R5cGUudHMnO1xuaW1wb3J0IHsgbG9hZFNhdmUgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuaW1wb3J0IHsgTmVjcm9tYW5jZXIgfSBmcm9tICcuL25lY3JvbWFuY2VyLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgeyBjbGVhclJ1biwgbG9hZFJ1biwgc2F2ZVJ1biwgc2VyaWFsaXplU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bnNhdmUudHMnO1xuaW1wb3J0IHsgcmVjb3JkQ2xlYXJBbmRTYXZlIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5pbXBvcnQgdHlwZSB7IENsZWFyUmV3YXJkIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1blNuYXBzaG90IH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGNyZWF0ZVZpc3VhbCwgaXNUcmlwbywgbG9hZEFzc2V0cyB9IGZyb20gJy4vdmlzdWFscy50cyc7XG5pbXBvcnQgdHlwZSB7IEFzc2V0cywgVW5pdFZpc3VhbCB9IGZyb20gJy4vdmlzdWFscy50cyc7XG5pbXBvcnQgeyBVaSB9IGZyb20gJy4vdWkudHMnO1xuXG5leHBvcnQgdHlwZSBQaGFzZSA9ICdidWlsZCcgfCAndHJhbnNpdGlvbicgfCAnYmF0dGxlJyB8ICdkcmFmdCcgfCAnd29uJyB8ICdsb3N0JztcbnR5cGUgU2VsID0geyB0eXBlOiAnY2FyZCc7IGlkeDogbnVtYmVyIH0gfCB7IHR5cGU6ICd1bml0JzsgaWQ6IG51bWJlciB9IHwgbnVsbDtcblxuZXhwb3J0IGNsYXNzIEdhbWUge1xuICBlbmdpbmU6IGFueTsgc2NlbmU6IGFueTsgY2FtZXJhOiBhbnk7IEEhOiBBc3NldHM7IHVpITogVWk7XG4gIHMhOiBTdGF0ZTsgc2VlZCA9IDE7IGF0dGVtcHQgPSAwOyBwaGFzZTogUGhhc2UgPSAnYnVpbGQnOyBiYXR0bGU6IEJhdHRsZSB8IG51bGwgPSBudWxsOyB0aW1lU2NhbGUgPSAxO1xuICBzZWw6IFNlbCA9IG51bGw7IHN3YXBNb2RlID0gZmFsc2U7IGNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgZHJhZnQ6IFNvdWxJZFtdIHwgbnVsbCA9IG51bGw7IGxhc3RCYXR0bGUgPSAnJztcbiAgcHJpdmF0ZSB1bml0VmlzID0gbmV3IE1hcDxudW1iZXIsIFVuaXRWaXN1YWw+KCk7ICAgICAgICAvLyB1bml0IGlkIC0+IHZpc3VhbCAoeW91ciBhcm15LCBwZXJzaXN0cyBiZXR3ZWVuIHdhdmVzKVxuICBwcml2YXRlIHZpc1RvVW5pdCA9IG5ldyBNYXA8VW5pdFZpc3VhbCwgbnVtYmVyPigpO1xuICBwcml2YXRlIGZ2aXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgICAgIC8vIGZpZ2h0ZXIgaWQgLT4gdmlzdWFsIGR1cmluZyBhIGJhdHRsZVxuICBwcml2YXRlIGZVbml0ID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKTsgICAgICAgICAgICAgIC8vIGZpZ2h0ZXIgaWQgLT4gdW5pdCBpZCAocGxheWVyIHNpZGUpXG4gIHByaXZhdGUgbGFzdFN0YXRlID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZz4oKTtcbiAgcHJpdmF0ZSB0aWxlczogYW55W10gPSBbXTsgcHJpdmF0ZSB0aWxlTWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSByaW5nRng6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbWVyczogeyB0OiBudW1iZXI7IGZuOiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIGFjYyA9IDA7IHByaXZhdGUgY2FtRnJvbTogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UID0gMTsgcHJpdmF0ZSBjYW1EdXIgPSAyLjA7IHByaXZhdGUgcmVzdWx0QXQgPSAtMTsgcHJpdmF0ZSBoYW5kbGVkID0gZmFsc2U7IHByaXZhdGUgc3RhcnRTdGVwQXQgPSAwO1xuICBwcml2YXRlIGFycm93TWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd01lc2g6IGFueVtdID0gW107XG4gIG5lY3JvITogTmVjcm9tYW5jZXI7XG4gIC8qKiBXaGF0IHRoZSBsYXN0IHN0YWdlIGNsZWFyIGVhcm5lZCAoc2hvd24gb24gdGhlIHN0YWdlLWNsZWFyZWQgc2NyZWVuKS4gKi9cbiAgcmV3YXJkOiBDbGVhclJld2FyZCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNpbmUgPSBmYWxzZTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgcmVzdWx0IGN1dHNjZW5lIGlzIHBsYXlpbmc6IHRoZSBiYXR0bGUgY2FtZXJhIGFuZCBmaWdodGVyIHN5bmMgc3RhbmQgZG93blxuICBwcml2YXRlIHR3ZWVuczogeyB0OiBudW1iZXI7IGR1cjogbnVtYmVyOyBmbjogKHU6IG51bWJlcikgPT4gdm9pZDsgZG9uZT86ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgdHdlZW4oZHVyOiBudW1iZXIsIGZuOiAodTogbnVtYmVyKSA9PiB2b2lkLCBkb25lPzogKCkgPT4gdm9pZCkgeyB0aGlzLnR3ZWVucy5wdXNoKHsgdDogMCwgZHVyLCBmbiwgZG9uZSB9KTsgfVxuICAvKiogRmluaXNoIGV2ZXJ5IHJ1bm5pbmcgYW5pbWF0aW9uIGF0IG9uY2UgKHNvIG5vdGhpbmcgaXMgbGVmdCBoYWxmLXdheSBvciB1bmRpc3Bvc2VkIHdoZW4gdGhlIHBoYXNlIGNoYW5nZXMpLiAqL1xuICBwcml2YXRlIGZsdXNoVHdlZW5zKCkgeyBmb3IgKGNvbnN0IHcgb2YgdGhpcy50d2VlbnMuc3BsaWNlKDApKSB7IHcuZm4oMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgcHJpdmF0ZSBzZWVuTWVyZ2VzID0gMDtcblxuICBhc3luYyBpbml0KGNhbnZhczogSFRNTENhbnZhc0VsZW1lbnQpIHtcbiAgICBjb25zdCBxcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKTtcbiAgICB0aGlzLmVuZ2luZSA9IG5ldyBCQUJZTE9OLkVuZ2luZShjYW52YXMsIHRydWUsIHsgYW50aWFsaWFzOiB0cnVlLCBwb3dlclByZWZlcmVuY2U6ICdoaWdoLXBlcmZvcm1hbmNlJyB9KTtcbiAgICBjb25zdCBkcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxOyB0aGlzLmVuZ2luZS5zZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgxIC8gTWF0aC5taW4oZHByLCAxLjUpKTtcbiAgICBjb25zdCBzY2VuZSA9IHRoaXMuc2NlbmUgPSBuZXcgQkFCWUxPTi5TY2VuZSh0aGlzLmVuZ2luZSk7IHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wOSwgMC4wNywgMC4xMywgMSk7XG4gICAgY29uc3QgaGVtaSA9IG5ldyBCQUJZTE9OLkhlbWlzcGhlcmljTGlnaHQoJ2gnLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMSwgMC4zKSwgc2NlbmUpOyBoZW1pLmludGVuc2l0eSA9IDEuMDU7IGhlbWkuZ3JvdW5kQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4zMiwgMC4yNiwgMC40Mik7XG4gICAgY29uc3Qgc3VuID0gbmV3IEJBQllMT04uRGlyZWN0aW9uYWxMaWdodCgncycsIG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuNCwgLTEsIDAuNTUpLCBzY2VuZSk7IHN1bi5pbnRlbnNpdHkgPSAwLjg1O1xuICAgIHRoaXMuY2FtZXJhID0gbmV3IEJBQllMT04uRnJlZUNhbWVyYSgnY2FtJywgbmV3IEJBQllMT04uVmVjdG9yMygwLCA4LCAtOSksIHNjZW5lKTsgdGhpcy5jYW1lcmEubWluWiA9IDAuMTsgdGhpcy5jYW1lcmEubWF4WiA9IDIwMDsgdGhpcy5jYW1lcmEuZm92ID0gMC44OyB0aGlzLmNhbWVyYS5pbnB1dHMuY2xlYXIoKTtcblxuICAgIGNvbnN0IGdyb3VuZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdncm91bmQnLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0MCB9LCBzY2VuZSk7XG4gICAgY29uc3QgZ20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdnbScsIHNjZW5lKTsgZ20uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMTcsIDAuMTUsIDAuMjEpOyBnbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZ3JvdW5kLm1hdGVyaWFsID0gZ207IGdyb3VuZC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCB0ZWFtIG9mIFswLCAxXSBhcyBjb25zdCkgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHsgY29uc3QgdCA9IHRoaXMubWFrZVRpbGUodGVhbSwgYyk7IGlmICh0ZWFtID09PSAwKSB0aGlzLnRpbGVzLnB1c2godCk7IGVsc2UgdC5zZXRFbmFibGVkKGZhbHNlKTsgfVxuXG4gICAgdGhpcy5BID0gYXdhaXQgbG9hZEFzc2V0cyhzY2VuZSk7XG4gICAgdGhpcy5uZWNybyA9IG5ldyBOZWNyb21hbmNlcihzY2VuZSwgdGhpcy5BLnNvZnQpOyAgICAgICAvLyBzdGFuZHMganVzdCBiZWhpbmQgaGlzIGFybXkncyBiYWNrIGNvbHVtbiwgZmFjaW5nIHRoZSBiYXR0bGVmaWVsZFxuICAgIHRoaXMubmVjcm8uaG9sZGVyLnBvc2l0aW9uLnNldCgtKEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAtIDEuMDUsIDAsIDApOyB0aGlzLm5lY3JvLmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7XG4gICAgdGhpcy5hcnJvd01hdHMgPSBbMCwgMV0ubWFwKCh0KSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdhbScgKyB0LCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjMsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNywgMC4yNSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcmV0dXJuIG07IH0pO1xuICAgIHRoaXMudWkgPSBuZXcgVWkodGhpcyk7IHRoaXMuc2VlZCA9ICsocXMuZ2V0KCdzZWVkJykgfHwgMSk7IGlmIChxcy5nZXQoJ2ZwcycpKSB0aGlzLnNldFNob3dGcHModHJ1ZSk7XG5cbiAgICAvLyBUYXBzIGFyZSBkZXRlY3RlZCBoZXJlIChub3QgdGhyb3VnaCBCYWJ5bG9uKSBzbyB0aGV5IGJlaGF2ZSB0aGUgc2FtZSBpbiBTYWZhcmksIHRoZSBob21lLXNjcmVlbiBhcHAgYW5kIG9uIGRlc2t0b3AuXG4gICAgbGV0IGRvd246IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbG9jYWwgPSAoZTogUG9pbnRlckV2ZW50KSA9PiB7IGNvbnN0IHIgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7IHJldHVybiB7IHg6IGUuY2xpZW50WCAtIHIubGVmdCwgeTogZS5jbGllbnRZIC0gci50b3AgfTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmRvd24nLCAoZSkgPT4geyBkb3duID0geyAuLi5sb2NhbChlKSwgdDogcGVyZm9ybWFuY2Uubm93KCkgfTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJ1cCcsIChlKSA9PiB7IGlmICghZG93bikgcmV0dXJuOyBjb25zdCBwID0gbG9jYWwoZSk7IGNvbnN0IG1vdmVkID0gTWF0aC5oeXBvdChwLnggLSBkb3duLngsIHAueSAtIGRvd24ueSksIGR0ID0gcGVyZm9ybWFuY2Uubm93KCkgLSBkb3duLnQ7IGRvd24gPSBudWxsOyBpZiAobW92ZWQgPCAxNiAmJiBkdCA8IDkwMCkgdGhpcy50YXAocC54LCBwLnkpOyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmNhbmNlbCcsICgpID0+IHsgZG93biA9IG51bGw7IH0pO1xuICAgIHRoaXMuY2FudmFzID0gY2FudmFzOyBjb25zdCBvblJlc2l6ZSA9ICgpID0+IHRoaXMuaGFuZGxlUmVzaXplKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTsgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ29yaWVudGF0aW9uY2hhbmdlJywgKCkgPT4gc2V0VGltZW91dChvblJlc2l6ZSwgMjUwKSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydCkgKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKSBuZXcgKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKG9uUmVzaXplKS5vYnNlcnZlKGNhbnZhcyk7XG4gICAgaWYgKHFzLmdldCgnZ2FsbGVyeScpKSB7IHRoaXMuZ2FsbGVyeSgpOyByZXR1cm47IH1cbiAgICBjb25zdCBzYXZlZCA9IHFzLmdldCgnc2VlZCcpID8gbnVsbCA6IGxvYWRSdW4oKTsgICAgICAgICAgICAgICAgLy8gP3NlZWQ9TiBhbHdheXMgc3RhcnRzIGZyZXNoIChkZWJ1Z2dpbmcpOyBvdGhlcndpc2UgcGljayB1cCB3aGVyZSB0aGUgbGFzdCB2aXNpdCBsZWZ0IG9mZlxuICAgIGlmIChzYXZlZCkgdGhpcy5yZXN0b3JlKHNhdmVkKTsgZWxzZSB0aGlzLnN0YXJ0U3RhZ2UodGhpcy5zZWVkKTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKSwgcmF3ID0gbm93IC0gbGFzdDsgY29uc3QgZHQgPSBNYXRoLm1pbigwLjA1LCByYXcgLyAxMDAwKTsgbGFzdCA9IG5vdzsgaWYgKCF0aGlzLmFjdGl2ZSkgcmV0dXJuOyBpZiAoIXRoaXMuZnJvemVuKSB0aGlzLmZyYW1lKGR0KTsgc2NlbmUucmVuZGVyKCk7IHRoaXMucGVyZlRpY2socmF3KTsgfSk7XG4gIH1cbiAgLyoqIFRoZSBuYXZpZ2F0aW9uIHNoZWxsIGhpZGVzIHRoZSBiYXR0bGUgc2NyZWVuIHdoaWxlIGFub3RoZXIgdGFiIGlzIG9wZW46IHBhdXNlIHRoZSBnYW1lIHNvIGl0IGNvc3RzIG5vdGhpbmcuICovXG4gIHByaXZhdGUgYWN0aXZlID0gdHJ1ZTtcbiAgLyoqIERlYnVnOiBrZWVwIGRyYXdpbmcgYnV0IHN0b3AgYWR2YW5jaW5nIHRpbWUsIHNvIGEgbW9tZW50IGNhbiBiZSBzdGVwcGVkIHRocm91Z2ggd2l0aCBmcmFtZShkdCkgYW5kIHNjcmVlbnNob3R0ZWQuICovXG4gIGZyb3plbiA9IGZhbHNlO1xuICBzdGVwKGR0OiBudW1iZXIpIHsgdGhpcy5mcmFtZShkdCk7IH1cbiAgc2V0QWN0aXZlKG9uOiBib29sZWFuKSB7IHRoaXMuYWN0aXZlID0gb247IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzY2VuZSBoZWxwZXJzXG4gIHByaXZhdGUgbWFrZVRpbGUodGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHAgPSBjZWxsUG9zKHRlYW0sIGNlbGwpLCB0ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgndGlsZScgKyBjZWxsLCB7IHNpemU6IEdSSURfU1AgKiAwLjkyIH0sIHRoaXMuc2NlbmUpO1xuICAgIHQucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0LnBvc2l0aW9uLnNldChwLngsIDAuMDE1LCBwLnopO1xuICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd0bScsIHRoaXMuc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xOCwgMC4xMiwgMC40MikgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC40MiwgMC4xMiwgMC4xMik7IG0uYWxwaGEgPSAwLjU7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgdC5tYXRlcmlhbCA9IG07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgdC5tZXRhZGF0YSA9IHsga2luZDogJ3RpbGUnLCBjZWxsIH07IHRoaXMudGlsZU1hdHNbY2VsbF0gPSBtOyB9IGVsc2UgdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgcmV0dXJuIHQ7XG4gIH1cbiAgcHJpdmF0ZSB0aW50KGNlbGw6IG51bWJlciwgbW9kZTogJ25vcm1hbCcgfCAnZnJlZScgfCAnc2VsJyB8ICdwYXJ0bmVyJykge1xuICAgIGNvbnN0IG0gPSB0aGlzLnRpbGVNYXRzW2NlbGxdOyBjb25zdCBjID0geyBub3JtYWw6IFswLjE4LCAwLjEyLCAwLjQyLCAwLjVdLCBmcmVlOiBbMC4yLCAwLjc1LCAwLjU1LCAwLjddLCBzZWw6IFsxLCAwLjgyLCAwLjMsIDAuODVdLCBwYXJ0bmVyOiBbMC44NSwgMC4zNSwgMSwgMC44NV0gfVttb2RlXTtcbiAgICBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoY1swXSwgY1sxXSwgY1syXSk7IG0uYWxwaGEgPSBjWzNdO1xuICB9XG4gIGxhdGVyKHNlYzogbnVtYmVyLCBmbjogKCkgPT4gdm9pZCkgeyB0aGlzLnRpbWVycy5wdXNoKHsgdDogc2VjLCBmbiB9KTsgfVxuICBwcml2YXRlIGZ4UmluZyh4OiBudW1iZXIsIHo6IG51bWJlciwgY29sb3I6IGFueSwgcjA6IG51bWJlciwgcjE6IG51bWJlciwgZHVyOiBudW1iZXIpIHtcbiAgICBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnZngnLCB7IGRpYW1ldGVyOiAxLCB0aGlja25lc3M6IDAuMDM1LCB0ZXNzZWxsYXRpb246IDI4IH0sIHRoaXMuc2NlbmUpOyBtLnBvc2l0aW9uLnNldCh4LCAwLjA1LCB6KTsgbS5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgbW0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdmeG0nLCB0aGlzLnNjZW5lKTsgbW0uZW1pc3NpdmVDb2xvciA9IGNvbG9yOyBtbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtbS5hbHBoYSA9IDAuOTsgbS5tYXRlcmlhbCA9IG1tOyB0aGlzLnJpbmdGeC5wdXNoKHsgbSwgbW0sIHQ6IDAsIHIwLCByMSwgZHVyIH0pO1xuICB9XG4gIHByaXZhdGUgYnVyc3QoeDogbnVtYmVyLCB6OiBudW1iZXIsIGMxOiBudW1iZXJbXSwgYzI6IG51bWJlcltdLCBjb3VudDogbnVtYmVyKSB7XG4gICAgY29uc3QgcHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnYicsIDYwLCB0aGlzLnNjZW5lKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGhpcy5BLnNvZnQ7IHBzLmVtaXR0ZXIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKHgsIDAuMDUsIHopOyBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yLCAwLCAtMC4yKTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAwLjA1LCAwLjIpO1xuICAgIHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzEgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMiBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4xLCAwLCAwLjIsIDApO1xuICAgIHBzLm1pblNpemUgPSAwLjEyOyBwcy5tYXhTaXplID0gMC4zNDsgcHMubWluTGlmZVRpbWUgPSAwLjQ7IHBzLm1heExpZmVUaW1lID0gMC45OyBwcy5lbWl0UmF0ZSA9IDA7IHBzLm1hbnVhbEVtaXRDb3VudCA9IGNvdW50OyBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMSwgMS4zLCAtMSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDEsIDIuNCwgMSk7XG4gICAgcHMubWluRW1pdFBvd2VyID0gMC44OyBwcy5tYXhFbWl0UG93ZXIgPSAyOyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAtMiwgMCk7IHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMudGFyZ2V0U3RvcER1cmF0aW9uID0gMS4yOyBwcy5kaXNwb3NlT25TdG9wID0gdHJ1ZTsgcHMuc3RhcnQoKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGNhbWVyYVxuICBwcml2YXRlIHBvc2VzKCkge1xuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IGhhbGYgPSBGUk9OVF9YICsgKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCArIDEuNDtcbiAgICBjb25zdCBkID0gTWF0aC5tYXgoaGFsZiAvICh0YW5WICogYXNwKSwgKChHUklEX1JPV1MgKiBHUklEX1NQKSAvIDIgKyAyKSAvICh0YW5WICogMC41NSksIDgpO1xuICAgIGNvbnN0IGJhdHRsZSA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjEgKiBkLCAwLjQyICogZCArIDAuNSwgLTAuODYgKiBkKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuMzUsIDApIH07XG4gICAgLy8gQnVpbGQgdmlldzogKGFsbW9zdCkgc3RyYWlnaHQgZG93biwgd2l0aCB0aGUgd2hvbGUgZ3JpZCBpbnNpZGUgdGhlIGJhbmQgYmV0d2VlbiB0aGUgdG9wIGJhciBhbmQgdGhlIGhhbmQgb2YgY2FyZHMuXG4gICAgY29uc3QgY3ggPSAtKEZST05UX1ggKyAoKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCkgLyAyKSwgSCA9IE1hdGgubWF4KDEsIHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCk7XG4gICAgY29uc3QgYm94ID0gKGlkOiBzdHJpbmcpID0+IHsgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7IHJldHVybiBlbCAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGwgPyBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKSA6IG51bGw7IH07XG4gICAgY29uc3QgdG9wQmFyID0gYm94KCd0b3AnKSwgaGFuZCA9IGJveCgnaGFuZCcpLCBpbmZvID0gYm94KCdpbmZvJyk7XG4gICAgY29uc3QgVE9QID0gTWF0aC5taW4oMC4zMiwgdG9wQmFyID8gKHRvcEJhci5ib3R0b20gKyA2KSAvIEggOiAwLjEpO1xuICAgIGNvbnN0IEJPVFRPTSA9IE1hdGgubWluKDAuNSwgKEggLSBNYXRoLm1pbihoYW5kID8gaGFuZC50b3AgOiBILCBpbmZvID8gaW5mby50b3AgOiBIKSArIDYpIC8gSCk7XG4gICAgY29uc3QgYmFuZCA9IE1hdGgubWF4KDAuMywgMSAtIFRPUCAtIEJPVFRPTSksIGNlbnRlckZyYWMgPSBUT1AgKyBiYW5kIC8gMjsgICAgICAgICAgLy8gdGhlIGdyaWQncyBjZW50cmUgYXBwZWFycyBhdCB0aGlzIGZyYWN0aW9uIGZyb20gdGhlIHRvcFxuICAgIGNvbnN0IGd3ID0gR1JJRF9DT0xTICogR1JJRF9TUCArIDMuMiwgZ2ggPSBHUklEX1JPV1MgKiBHUklEX1NQICsgMC41OyAgICAgICAgICAgICAgICAvLyB0aGUgd2lkdGggYWxzbyBsZWF2ZXMgcm9vbSBmb3IgdGhlIE5lY3JvbWFuY2VyIGJlc2lkZSB0aGUgZ3JpZFxuICAgIGNvbnN0IGQyID0gTWF0aC5tYXgoZ2ggLyAoMiAqIHRhblYgKiBiYW5kKSwgZ3cgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjg4KSwgNC41KTtcbiAgICBjb25zdCBzaGlmdCA9ICgwLjUgLSBjZW50ZXJGcmFjKSAqIDIgKiBkMiAqIHRhblYsIGJ4ID0gY3ggLSAwLjY7XG4gICAgY29uc3QgYnVpbGQgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMyhieCwgZDIsIC1zaGlmdCAtIDAuMSAqIGQyKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCAwLCAtc2hpZnQpIH07XG4gICAgY29uc3QgbmVjcm8gPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMyhiYXR0bGUucG9zLnggLSAxLjQsIGJhdHRsZS5wb3MueSAqIDEuMTIsIGJhdHRsZS5wb3MueiAqIDEuMTIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEuNCwgMC4zNSwgMCkgfTsgICAvLyByZXN1bHQgY3V0c2NlbmVzOiBoaW0gYW5kIHRoZSBmaWVsZFxuICAgIHJldHVybiB7IGJhdHRsZSwgYnVpbGQsIG5lY3JvIH07XG4gIH1cbiAgLyoqIFRoZSBoYW5kIC8gaW5mbyBiYXIgY2FuIGNoYW5nZSBzaXplIGluIHRoZSBidWlsZCBwaGFzZSAobG9uZyBhYmlsaXR5IHRleHQsIG1vcmUgY2FyZHMpOiByZS1mcmFtZSBzbyB0aGUgZ3JpZCBuZXZlciBoaWRlcyBiZWhpbmQgaXQuICovXG4gIHJlZnJhbWVCdWlsZCgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCB0aGlzLmNhbVQgPCAxIHx8IHRoaXMuY2luZSB8fCAhdGhpcy5jYW52YXMpIHJldHVybjtcbiAgICBjb25zdCBwID0gdGhpcy5wb3NlcygpLmJ1aWxkLCBjID0gdGhpcy5jYW1lcmEucG9zaXRpb247XG4gICAgaWYgKCFpc0Zpbml0ZShwLnBvcy54KSB8fCBCQUJZTE9OLlZlY3RvcjMuRGlzdGFuY2UoYywgcC5wb3MpIDwgMC4wNikgcmV0dXJuO1xuICAgIHRoaXMudHdlZW5DYW0ocCwgMC4zNSk7XG4gIH1cbiAgcHJpdmF0ZSBjYW52YXMhOiBIVE1MQ2FudmFzRWxlbWVudDsgcHJpdmF0ZSBsYXN0VyA9IDA7IHByaXZhdGUgbGFzdEggPSAwOyBsYXN0VGFwSW5mbyA9ICcobm8gdGFwcyB5ZXQpJztcbiAgcHJpdmF0ZSBoYW5kbGVSZXNpemUoKSB7XG4gICAgaWYgKCF0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCB8fCAhdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KSByZXR1cm47ICAgLy8gaGlkZGVuIGJlaGluZCBhbm90aGVyIHRhYlxuICAgIHRoaXMuZW5naW5lLnJlc2l6ZSgpOyB0aGlzLmxhc3RXID0gdGhpcy5jYW52YXMuY2xpZW50V2lkdGg7IHRoaXMubGFzdEggPSB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcgJiYgdGhpcy5jYW1UID49IDEpIHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7XG4gIH1cbiAgLyoqIEEgdGFwIG9uIHRoZSAzRCB2aWV3OiBwaWNrIGEgdGlsZSBvciBhIHVuaXQuICovXG4gIHByaXZhdGUgdGFwKHg6IG51bWJlciwgeTogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IHRoaXMuc2NlbmUucGljayh4LCB5LCAobTogYW55KSA9PiAhIShtLm1ldGFkYXRhICYmIG0ubWV0YWRhdGEua2luZCkpO1xuICAgIGNvbnN0IG1kID0gcCAmJiBwLmhpdCA/IHAucGlja2VkTWVzaC5tZXRhZGF0YSA6IG51bGw7XG4gICAgdGhpcy5sYXN0VGFwSW5mbyA9IGB0YXAgJHtNYXRoLnJvdW5kKHgpfSwke01hdGgucm91bmQoeSl9IG9mICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSAtPiAke21kID8gKG1kLmtpbmQgPT09ICd0aWxlJyA/ICd0aWxlICcgKyBtZC5jZWxsIDogJ3VuaXQnKSA6ICdub3RoaW5nJ30gKHBoYXNlICR7dGhpcy5waGFzZX0pYDtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhbWQpIHJldHVybjtcbiAgICBpZiAobWQua2luZCA9PT0gJ3RpbGUnKSB0aGlzLm9uVGlsZShtZC5jZWxsKTsgZWxzZSBpZiAobWQua2luZCA9PT0gJ3VuaXQnKSB0aGlzLm9uVW5pdFZpc3VhbChtZC52aXN1YWwpO1xuICB9XG4gIHByaXZhdGUgc2V0Q2FtKHA6IGFueSkgeyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5jb3B5RnJvbShwLnBvcyk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChwLnRndC5jbG9uZSgpKTsgfVxuICBwcml2YXRlIHR3ZWVuQ2FtKHRvOiBhbnksIGR1cjogbnVtYmVyKSB7IHRoaXMuY2FtRnJvbSA9IHsgcG9zOiB0aGlzLmNhbWVyYS5wb3NpdGlvbi5jbG9uZSgpLCB0Z3Q6IHRoaXMuY2FtZXJhLmdldFRhcmdldCgpLmNsb25lKCkgfTsgdGhpcy5jYW1UbyA9IHRvOyB0aGlzLmNhbVQgPSAwOyB0aGlzLmNhbUR1ciA9IGR1cjsgfVxuXG4gIC8vIC0tLS0gYmF0dGxlIGNhbWVyYTogZm9sbG93cyB0aGUgZmlnaHRlcnMgdGhhdCBhcmUgc3RpbGwgYWxpdmUsIHNvIHRoZSBhY3Rpb24gKGFuZCB0aGUgcHVycGxlIGV5ZXMpIHN0YXlzIGxhcmdlIG9uIHNjcmVlblxuICBjYW1Nb2RlOiAnY2xvc2UnIHwgJ3dpZGUnID0gJ2Nsb3NlJzsgcHJpdmF0ZSBjYW1UZ3Q6IGFueSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAwKTtcbiAgc2V0Q2FtTW9kZShtOiAnY2xvc2UnIHwgJ3dpZGUnKSB7XG4gICAgdGhpcy5jYW1Nb2RlID0gbTtcbiAgICBpZiAobSA9PT0gJ3dpZGUnICYmIHRoaXMuYmF0dGxlKSB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDAuOSk7XG4gICAgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBwcml2YXRlIGZyYW1lQmF0dGxlKGR0OiBudW1iZXIpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7IGlmICghYikgcmV0dXJuOyBjb25zdCBhbGl2ZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKCFhbGl2ZS5sZW5ndGgpIHJldHVybjtcbiAgICBsZXQgeDAgPSAxZTksIHgxID0gLTFlOSwgejAgPSAxZTksIHoxID0gLTFlOTsgZm9yIChjb25zdCBmIG9mIGFsaXZlKSB7IHgwID0gTWF0aC5taW4oeDAsIGYueCk7IHgxID0gTWF0aC5tYXgoeDEsIGYueCk7IHowID0gTWF0aC5taW4oejAsIGYueik7IHoxID0gTWF0aC5tYXgoejEsIGYueik7IH1cbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCB3aWRlID0gdGhpcy5wb3NlcygpLmJhdHRsZSwgY3ggPSAoeDAgKyB4MSkgLyAyLCBjeiA9ICh6MCArIHoxKSAvIDI7XG4gICAgY29uc3QgZCA9IE1hdGgubWluKE1hdGgubWF4KCh4MSAtIHgwICsgMy40KSAvICgyICogdGFuViAqIGFzcCAqIDAuOSksICh6MSAtIHowICsgMy4yKSAvICgyICogdGFuViAqIDAuNjIpLCA1LjQpLCBNYXRoLmh5cG90KHdpZGUucG9zLnksIHdpZGUucG9zLnopKTtcbiAgICBjb25zdCB0Z3QgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4LCAwLjU1LCBjeiksIHBvcyA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3ggLSAwLjA2ICogZCwgMC4zMiAqIGQgKyAwLjUsIGN6IC0gMC45ICogZCk7XG4gICAgY29uc3QgayA9IDEgLSBNYXRoLmV4cCgtZHQgKiAyLjApO1xuICAgIHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1lcmEucG9zaXRpb24sIHBvcywgayk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1UZ3QsIHRndCwgayk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YWdlIGZsb3dcbiAgLyoqIFdyaXRlIHRoZSBydW4gdG8gZGlzayAoY2FsbSBtb21lbnRzIG9ubHk6IGJ1aWxkIHBoYXNlIGFuZCB0aGUgdmljdG9yeSBkcmFmdCkuICovXG4gIHByaXZhdGUgcGVyc2lzdFJ1bigpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzKSByZXR1cm47XG4gICAgICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHsgY2xlYXJSdW4oKTsgcmV0dXJuOyB9XG4gICAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyAmJiB0aGlzLnBoYXNlICE9PSAnZHJhZnQnKSByZXR1cm47XG4gICAgICBjb25zdCBzbmFwOiBSdW5TbmFwc2hvdCA9IHsgdjogMSwgc2VlZDogdGhpcy5zZWVkLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIGRpZmZpY3VsdHk6IGRpZmZpY3VsdHlOYW1lLCBwaGFzZTogdGhpcy5waGFzZSwgZHJhZnQ6IHRoaXMucGhhc2UgPT09ICdkcmFmdCcgPyB0aGlzLmRyYWZ0IDogbnVsbCwgc3RhdGU6IHNlcmlhbGl6ZVN0YXRlKHMpIH07XG4gICAgICBzYXZlUnVuKHNuYXApO1xuICAgIH0gY2F0Y2ggeyAvKiBuZXZlciBsZXQgc2F2aW5nIGJyZWFrIHRoZSBnYW1lICovIH1cbiAgfVxuICAvKiogUmVidWlsZCB0aGUgc2NyZWVuIGZyb20gYSBzYXZlZCBydW4gKGEgcmVsb2FkLCBvciBTYWZhcmkgZGlzY2FyZGluZyB0aGUgcGFnZSkuICovXG4gIHByaXZhdGUgcmVzdG9yZShyOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSkge1xuICAgIGNvbnN0IHsgc25hcCwgc3RhdGUgfSA9IHI7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMuZmx1c2hUd2VlbnMoKTsgdGhpcy5uZWNyby5yZXZpdmUoKTsgc2V0RGlmZmljdWx0eShzbmFwLmRpZmZpY3VsdHkpO1xuICAgIHRoaXMuc2VlZCA9IHNuYXAuc2VlZDsgdGhpcy5hdHRlbXB0ID0gc25hcC5hdHRlbXB0OyB0aGlzLnMgPSBzdGF0ZTsgdGhpcy5zZWVuTWVyZ2VzID0gc3RhdGUuc3RhdHMubWVyZ2VzO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IHNuYXAucGhhc2UgPT09ICdkcmFmdCcgPyBzbmFwLmRyYWZ0IDogbnVsbDsgdGhpcy5waGFzZSA9IHRoaXMuZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KGBSdW4gcmVzdG9yZWQ6IHdhdmUgJHtzdGF0ZS53YXZlfS8ke3N0YWdlV2F2ZXMoc3RhdGUpfSwgJHtzdGF0ZS5oZWFydHN9IGhlYXJ0JHtzdGF0ZS5oZWFydHMgPT09IDEgPyAnJyA6ICdzJ30uYCk7XG4gIH1cblxuICAvLyAtLS0tIHBlcmZvcm1hbmNlIHJlYWRvdXQ6IHJvbGxpbmcgZnJhbWUgc3RhdHMsIHBlci1iYXR0bGUgc3VtbWFyaWVzLCBvcHRpb25hbCBvbi1zY3JlZW4gRlBTLCBhbmQgYSBwYXN0ZS1mcmllbmRseSByZXBvcnRcbiAgc2hvd0ZwcyA9IGZhbHNlOyBwZXJmTm93ID0geyBmcHM6IDAsIGF2ZzogMCwgcDk1OiAwLCB3b3JzdDogMCB9OyBwZXJmTG9nOiBhbnlbXSA9IFtdO1xuICBwcml2YXRlIHBlcmZCdWYgPSBuZXcgRmxvYXQzMkFycmF5KDI0MCk7IHByaXZhdGUgcGVyZk4gPSAwOyBwcml2YXRlIHBlcmZJID0gMDsgcHJpdmF0ZSBwZXJmU2hvd25BdCA9IDA7IHByaXZhdGUgaW5zdHI6IGFueSA9IG51bGw7IHByaXZhdGUgZnBzSHVkOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGN1ckJhdHRsZTogeyBmcmFtZXM6IG51bWJlcjsgc3VtOiBudW1iZXI7IHdvcnN0OiBudW1iZXI7IHNsb3c6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHNldFNob3dGcHMob246IGJvb2xlYW4pIHtcbiAgICB0aGlzLnNob3dGcHMgPSBvbjtcbiAgICBpZiAob24gJiYgIXRoaXMuZnBzSHVkKSB7IGNvbnN0IGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgaC5pZCA9ICdmcHNIdWQnOyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JhdHRsZUhvc3QnKSB8fCBkb2N1bWVudC5ib2R5KS5hcHBlbmRDaGlsZChoKTsgdGhpcy5mcHNIdWQgPSBoOyB9XG4gICAgaWYgKHRoaXMuZnBzSHVkKSB0aGlzLmZwc0h1ZC5zdHlsZS5kaXNwbGF5ID0gb24gPyAnYmxvY2snIDogJ25vbmUnO1xuICB9XG4gIHByaXZhdGUgcGVyZlRpY2sobXM6IG51bWJlcikge1xuICAgIGlmIChtcyA+IDUwMCkgcmV0dXJuOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgdGFiIHdhcyBoaWRkZW4gb3IgdGhlIHBob25lIHBhdXNlZCB1czogbm90IGEgcmVhbCBmcmFtZVxuICAgIHRoaXMucGVyZkJ1Zlt0aGlzLnBlcmZJXSA9IG1zOyB0aGlzLnBlcmZJID0gKHRoaXMucGVyZkkgKyAxKSAlIHRoaXMucGVyZkJ1Zi5sZW5ndGg7IHRoaXMucGVyZk4gPSBNYXRoLm1pbih0aGlzLnBlcmZCdWYubGVuZ3RoLCB0aGlzLnBlcmZOICsgMSk7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlO1xuICAgIGlmIChjICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCB0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpKSB7IGMuZnJhbWVzKys7IGMuc3VtICs9IG1zOyBpZiAobXMgPiBjLndvcnN0KSBjLndvcnN0ID0gbXM7IGlmIChtcyA+IDMzLjQpIGMuc2xvdysrOyBjLnNjYWxlID0gTWF0aC5tYXgoYy5zY2FsZSwgdGhpcy50aW1lU2NhbGUpOyB9XG4gICAgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCk7IGlmIChub3cgLSB0aGlzLnBlcmZTaG93bkF0IDwgNTAwKSByZXR1cm47IHRoaXMucGVyZlNob3duQXQgPSBub3c7XG4gICAgY29uc3QgYSA9IEFycmF5LmZyb20odGhpcy5wZXJmQnVmLnN1YmFycmF5KDAsIHRoaXMucGVyZk4pKS5zb3J0KCh4LCB5KSA9PiB4IC0geSksIGF2ZyA9IGEucmVkdWNlKChuLCB4KSA9PiBuICsgeCwgMCkgLyBhLmxlbmd0aDtcbiAgICB0aGlzLnBlcmZOb3cgPSB7IGZwczogMTAwMCAvIGF2ZywgYXZnLCBwOTU6IGFbTWF0aC5mbG9vcihhLmxlbmd0aCAqIDAuOTUpXSA/PyAwLCB3b3JzdDogYVthLmxlbmd0aCAtIDFdID8/IDAgfTtcbiAgICBpZiAodGhpcy5mcHNIdWQgJiYgdGhpcy5zaG93RnBzKSB0aGlzLmZwc0h1ZC50ZXh0Q29udGVudCA9IGAke3RoaXMucGVyZk5vdy5mcHMudG9GaXhlZCgwKX0gZnBzICAke3RoaXMucGVyZk5vdy5hdmcudG9GaXhlZCgxKX1tcyAgc2xvdzUlICR7dGhpcy5wZXJmTm93LnA5NS50b0ZpeGVkKDApfW1zYDtcbiAgICB0aGlzLnVpLnJlbmRlckRlYnVnTGl2ZSgpO1xuICB9XG4gIHByaXZhdGUgYmVnaW5CYXR0bGVQZXJmKCkgeyB0aGlzLmN1ckJhdHRsZSA9IHsgZnJhbWVzOiAwLCBzdW06IDAsIHdvcnN0OiAwLCBzbG93OiAwLCBzY2FsZTogdGhpcy50aW1lU2NhbGUgfTsgfVxuICBwcml2YXRlIGVuZEJhdHRsZVBlcmYoKSB7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlOyB0aGlzLmN1ckJhdHRsZSA9IG51bGw7IGlmICghYyB8fCAhYy5mcmFtZXMpIHJldHVybjtcbiAgICB0aGlzLnBlcmZMb2cucHVzaCh7IHdhdmU6IHRoaXMucy53YXZlLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIHNwZWVkOiBjLnNjYWxlLCBmaWdodGVyczogdGhpcy5iYXR0bGUgPyB0aGlzLmJhdHRsZS5maWdodGVycy5sZW5ndGggOiAwLCBmcHM6ICsoMTAwMCAvIChjLnN1bSAvIGMuZnJhbWVzKSkudG9GaXhlZCgwKSwgd29yc3RNczogK2Mud29yc3QudG9GaXhlZCgwKSwgc2xvd1BjdDogKygoMTAwICogYy5zbG93KSAvIGMuZnJhbWVzKS50b0ZpeGVkKDEpIH0pO1xuICAgIGlmICh0aGlzLnBlcmZMb2cubGVuZ3RoID4gMTIpIHRoaXMucGVyZkxvZy5zaGlmdCgpO1xuICB9XG4gIHBlcmZJbmZvKCkge1xuICAgIGNvbnN0IHNjID0gdGhpcy5zY2VuZTsgaWYgKCF0aGlzLmluc3RyICYmIEJBQllMT04uU2NlbmVJbnN0cnVtZW50YXRpb24pIHRoaXMuaW5zdHIgPSBuZXcgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbihzYyk7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5wZXJmTm93LCBtZXNoZXM6IHNjLmdldEFjdGl2ZU1lc2hlcygpLmxlbmd0aCwgcGFydGljbGVzOiBzYy5wYXJ0aWNsZVN5c3RlbXMubGVuZ3RoLCBkcmF3czogdGhpcy5pbnN0ciA/IHRoaXMuaW5zdHIuZHJhd0NhbGxzQ291bnRlci5jdXJyZW50IDogLTEgfTtcbiAgfVxuICBwZXJmUmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcCA9IHRoaXMucGVyZkluZm8oKSwgZ2w6IGFueSA9IHRoaXMuZW5naW5lLmdldEdsSW5mbyA/IHRoaXMuZW5naW5lLmdldEdsSW5mbygpIDoge307XG4gICAgY29uc3Qgcm93cyA9IHRoaXMucGVyZkxvZy5tYXAoKHIpID0+IGAgIHdhdmUgJHtyLndhdmV9IHRyeSAke3IuYXR0ZW1wdH0gYXQgJHtyLnNwZWVkfXg6ICR7ci5mcHN9IGZwcyBhdmVyYWdlLCB3b3JzdCBmcmFtZSAke3Iud29yc3RNc31tcywgJHtyLnNsb3dQY3R9JSBzbG93IGZyYW1lcywgJHtyLmZpZ2h0ZXJzfSBmaWdodGVyc2ApO1xuICAgIHJldHVybiBbYFBFUkYgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9YCwgYGRldmljZTogJHtuYXZpZ2F0b3IudXNlckFnZW50fWAsIGBncHU6ICR7Z2wucmVuZGVyZXIgfHwgJz8nfSAoJHtnbC52ZW5kb3IgfHwgJz8nfSlgLFxuICAgICAgYHNjcmVlbiAke3NjcmVlbi53aWR0aH14JHtzY3JlZW4uaGVpZ2h0fSAgdmlld3BvcnQgJHtpbm5lcldpZHRofXgke2lubmVySGVpZ2h0fSAgZHByICR7ZGV2aWNlUGl4ZWxSYXRpb30gIHJlbmRlciAke3RoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCl9eCR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCl9ICBzY2FsaW5nIGxldmVsICR7dGhpcy5lbmdpbmUuZ2V0SGFyZHdhcmVTY2FsaW5nTGV2ZWwoKS50b0ZpeGVkKDIpfWAsXG4gICAgICBgbm93OiAke3AuZnBzLnRvRml4ZWQoMCl9IGZwcywgYXZlcmFnZSAke3AuYXZnLnRvRml4ZWQoMSl9bXMsIHNsb3dlc3QgNSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zLCB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyB8IGFjdGl2ZSBtZXNoZXMgJHtwLm1lc2hlc30sIHBhcnRpY2xlIHN5c3RlbXMgJHtwLnBhcnRpY2xlc30sIGRyYXcgY2FsbHMgJHtwLmRyYXdzfWAsXG4gICAgICBgc3RhdGU6IHBoYXNlICR7dGhpcy5waGFzZX0sIHNwZWVkICR7dGhpcy50aW1lU2NhbGV9eCwgY2FtZXJhICR7dGhpcy5jYW1Nb2RlfSwgZGlmZmljdWx0eSAke2RpZmZpY3VsdHlOYW1lfSwgd2F2ZSAke3RoaXMucy53YXZlfSwgdW5pdHMgJHt0aGlzLnMudW5pdHMubGVuZ3RofWAsXG4gICAgICBgYmF0dGxlcyAobmV3ZXN0IGxhc3QpOmAsIC4uLihyb3dzLmxlbmd0aCA/IHJvd3MgOiBbJyAgKG5vbmUgeWV0OiBwbGF5IGEgYmF0dGxlLCB0aGVuIGNvcHkgdGhpcyBhZ2FpbiknXSldLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgLyoqIEEgcnVuIHRoZSBwbGF5ZXIgaGFzIHJlYWxseSBzdGFydGVkIChzbyBIb21lIGNhbiBvZmZlciBDb250aW51ZSkuIE51bGwgYWZ0ZXIgYSBzdGFnZSB3YXMgd29uIG9yIGxvc3QsIG9yIGJlZm9yZSBhbnl0aGluZyB3YXMgZG9uZS4gKi9cbiAgcnVuSW5mbygpIHsgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzIHx8IHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gbnVsbDsgcmV0dXJuIChzLndhdmUgPiAxIHx8IHMudW5pdHMubGVuZ3RoID4gMCB8fCB0aGlzLmF0dGVtcHQgPiAwIHx8IHMuc3RhdHMuZmFpbHVyZXMgPiAwKSA/IHsgd2F2ZTogcy53YXZlLCB0b3RhbDogc3RhZ2VXYXZlcyhzKSwgaGVhcnRzOiBzLmhlYXJ0cywgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUgfSA6IG51bGw7IH1cbiAgLyoqIEZyZXNoIHJ1biB3aXRoIHRoZSBjdXJyZW50bHkgZXF1aXBwZWQgU291bCBEZWNrIChIb21lID4gU3RhcnQgQmF0dGxlIGNhbGxzIHRoaXMpLiAqL1xuICBuZXdSdW4oKSB7IHRoaXMuc3RhcnRTdGFnZShuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdzZWVkJykgPyB0aGlzLnNlZWQgOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IH1cbiAgc3RhcnRTdGFnZShzZWVkOiBudW1iZXIpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5yZXdhcmQgPSBudWxsOyB0aGlzLmZsdXNoVHdlZW5zKCk7IGlmICh0aGlzLm5lY3JvKSB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIHRoaXMuc2VlZCA9IHNlZWQ7IHRoaXMuYXR0ZW1wdCA9IDA7IGNvbnN0IHN2ID0gbG9hZFNhdmUoKTsgc2V0RGlmZmljdWx0eShzdi5kaWZmaWN1bHR5KTsgdGhpcy5zID0gbmV3U3RhZ2UoeyAuLi5QUk9UT1RZUEVfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdCgnU3RhZ2Ugc3RhcnQ6IDQgY2FyZHMsICcgKyB0aGlzLnMuY2FwICsgJyBEb21pbmlvbi4gU3VtbW9uLCBtZXJnZSwgdGhlbiBwcmVzcyBCQVRUTEUuJyk7XG4gIH1cbiAgcHJpdmF0ZSBjbGVhckJhdHRsZSgpIHtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYuZGlzcG9zZSgpOyB9KTsgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTsgdGhpcy5iYXR0bGUgPSBudWxsO1xuICAgIHRoaXMuYXJyb3dzLmZvckVhY2goKGEpID0+IGEubWVzaC5kaXNwb3NlKCkpOyB0aGlzLmFycm93cyA9IFtdO1xuICB9XG4gIHByaXZhdGUgcG9zKGNlbGw6IG51bWJlcikgeyByZXR1cm4gY2VsbFBvcygwLCBjZWxsKTsgfVxuICBzeW5jQnVpbGQoKSB7XG4gICAgdGhpcy5wZXJzaXN0UnVuKCk7XG4gICAgY29uc3QgbWVyZ2VkID0gdGhpcy5zLnN0YXRzLm1lcmdlcyA+IHRoaXMuc2Vlbk1lcmdlczsgdGhpcy5zZWVuTWVyZ2VzID0gdGhpcy5zLnN0YXRzLm1lcmdlcztcbiAgICBjb25zdCBncm93biA9IG1lcmdlZCA/IHRoaXMucy51bml0cy5maW5kKCh1KSA9PiB7IGNvbnN0IGd2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgcmV0dXJuICEhZ3YgJiYgZ3Yuc3RhciAhPT0gdS5zdGFyOyB9KSA6IHVuZGVmaW5lZDsgICAvLyB0aGUgdW5pdCB0aGF0IGp1c3QgZ2FpbmVkIGEgc3RhclxuICAgIGNvbnN0IGFsaXZlID0gbmV3IFNldCh0aGlzLnMudW5pdHMubWFwKCh1KSA9PiB1LmlkKSk7XG4gICAgZm9yIChjb25zdCBbaWQsIHZdIG9mIHRoaXMudW5pdFZpcykgaWYgKCFhbGl2ZS5oYXMoaWQpKSB7XG4gICAgICB0aGlzLnZpc1RvVW5pdC5kZWxldGUodik7IHRoaXMudW5pdFZpcy5kZWxldGUoaWQpOyBjb25zdCBwID0gdi5ob2xkZXIucG9zaXRpb247XG4gICAgICBpZiAoZ3Jvd24pIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBtZXJnZTogdGhlIGNvbnN1bWVkIHVuaXQgaXMgZHJhd24gaW50byB0aGUgc3Vydml2b3IgYW5kIHZhbmlzaGVzIGluIGEgZmxhc2hcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyhncm93bi5jZWxsKSwgeDAgPSBwLngsIHowID0gcC56LCBzYyA9IHYuaG9sZGVyLnNjYWxpbmcueDsgdi5wbGF5KCdpZGxlJyk7XG4gICAgICAgIHRoaXMudHdlZW4oMC4zMywgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjQsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwoc2MgKiAoMSAtIDAuNzUgKiB0KSk7IH0sXG4gICAgICAgICAgKCkgPT4geyB0aGlzLmJ1cnN0KHRvLngsIHRvLnosIFswLjg1LCAwLjYsIDEsIDAuOV0sIFswLjUsIDAuMywgMSwgMC43XSwgMTQpOyB2LmRpc3Bvc2UoKTsgfSk7XG4gICAgICB9IGVsc2UgeyB0aGlzLmJ1cnN0KHAueCwgcC56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDE2KTsgdi5kaXNwb3NlKCk7IH1cbiAgICB9XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykge1xuICAgICAgbGV0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTtcbiAgICAgIGlmICghdikgeyB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgdS5zb3VsLCAwLCB1LnN0YXIpOyB0aGlzLnVuaXRWaXMuc2V0KHUuaWQsIHYpOyB0aGlzLnZpc1RvVW5pdC5zZXQodiwgdS5pZCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTsgYXVkaW8ucGxheSgnc3VtbW9uJyk7IGNvbnN0IHZ2ID0gdjsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcpIHZ2LnBsYXkoJ2lkbGUnKTsgfSk7IH1cbiAgICAgIGVsc2UgeyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IGlmICh2LnN0YXIgIT09IHUuc3RhcikgeyBjb25zdCBmdiA9IHY7IHYuc2V0U3Rhcih1LnN0YXIpOyB0aGlzLmxhdGVyKGdyb3duICYmIGdyb3duLmlkID09PSB1LmlkID8gMC4zMyA6IDAsICgpID0+IHRoaXMubWVyZ2VGeChmdiwgcC54LCBwLnopKTsgfSB9XG4gICAgfVxuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsO1xuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB7XG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCBjYW5TdW1tb24odGhpcy5zLCBzZWwuaWR4KSA/ICdmcmVlJyA6ICdub3JtYWwnKTtcbiAgICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZUZyb21IYW5kKHRoaXMucywgc2VsLmlkeCwgdS5pZCkpIHRoaXMudGludCh1LmNlbGwsICdwYXJ0bmVyJyk7ICAgICAvLyB0aGUgY2FyZCBjYW4gbWVyZ2UgaW50byB0aGlzIHVuaXRcbiAgICB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7XG4gICAgICBjb25zdCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7XG4gICAgICBpZiAodSkgeyB0aGlzLnRpbnQodS5jZWxsLCAnc2VsJyk7IGZvciAoY29uc3QgbyBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZURlcGxveWVkKHUsIG8pKSB0aGlzLnRpbnQoby5jZWxsLCAncGFydG5lcicpOyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCAnZnJlZScpOyB9XG4gICAgfVxuICB9XG4gIC8qKiBUaGUgbWVyZ2UgbW9tZW50OiBhIGZsYXNoIG9mIHJpbmdzIGFuZCBzcGFya3MsIGEgcHVuY2ggaW4gc2l6ZSwgYSByaXNpbmcgY2hpbWUuICovXG4gIHByaXZhdGUgbWVyZ2VGeCh2OiBVbml0VmlzdWFsLCB4OiBudW1iZXIsIHo6IG51bWJlcikge1xuICAgIGF1ZGlvLnBsYXkoJ21lcmdlJyk7IHYucHVsc2UoKTsgY29uc3QgdGFyZ2V0ID0gdi5ob2xkZXIuc2NhbGluZy54O1xuICAgIHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjQpLCAwLjIsIDIuMCwgMC42NSk7IHRoaXMubGF0ZXIoMC4xMiwgKCkgPT4gdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDEsIDEpLCAwLjIsIDMuMCwgMC44KSk7XG4gICAgdGhpcy5idXJzdCh4LCB6LCBbMSwgMC44NSwgMC40LCAwLjldLCBbMC44LCAwLjQsIDEsIDAuOF0sIDQ2KTsgdGhpcy5idXJzdCh4LCB6LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDI0KTtcbiAgICB0aGlzLnR3ZWVuKDAuNTUsICh0KSA9PiB2LmhvbGRlci5zY2FsaW5nLnNldEFsbCh0YXJnZXQgKiAoMSArIDAuNDUgKiBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAoMSAtIHQgKiAwLjQpKSksICgpID0+IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRhcmdldCkpO1xuICB9XG4gIHByaXZhdGUgc3VtbW9uRngoeDogbnVtYmVyLCB6OiBudW1iZXIpIHsgdGhpcy5idXJzdCh4LCB6LCBbMC43LCAwLjMsIDEsIDAuOV0sIFswLjM1LCAwLjEsIDAuNywgMC44XSwgMzApOyB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjMsIDEpLCAwLjIsIDEuMiwgMC43KTsgfVxuXG4gIC8vIC0tLS0gcGxheWVyIGFjdGlvbnMgKGJ1aWxkIHBoYXNlKVxuICB0b2FzdChtc2c6IHN0cmluZykgeyB0aGlzLnVpLnRvYXN0KG1zZyk7IH1cbiAgb25DYXJkKGlkeDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoZGlzY2FyZFJlZHJhdyh0aGlzLnMsIGlkeCkpIHsgdGhpcy50b2FzdCgnU3dhcHBlZDogZHJldyBhIGRpZmZlcmVudCBTb3VsLicpOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnNlbC5pZHggPT09IGlkeCA/IG51bGwgOiB7IHR5cGU6ICdjYXJkJywgaWR4IH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25UaWxlKGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IGhlcmUgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7IGlmIChoZXJlKSB7IHRoaXMub25Vbml0VmlzdWFsKHRoaXMudW5pdFZpcy5nZXQoaGVyZS5pZCkhKTsgcmV0dXJuOyB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnKSB7XG4gICAgICBpZiAoY2FuU3VtbW9uKHMsIHNlbC5pZHgpKSB7IHN1bW1vbihzLCBzZWwuaWR4LCBjZWxsKTsgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgICBlbHNlIHsgY29uc3Qgc291bCA9IHMuaGFuZFtzZWwuaWR4XTsgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbjogJHtTT1VMX05BTUVbc291bF19IGNvc3RzICR7Y29zdChzb3VsLCAxKX0sIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApOyB9XG4gICAgfSBlbHNlIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0JykgeyBpZiAobW92ZVVuaXQocywgc2VsLmlkLCBjZWxsKSkgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25Vbml0VmlzdWFsKHY6IFVuaXRWaXN1YWwpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMudmlzVG9Vbml0LmdldCh2KTsgaWYgKGlkID09PSB1bmRlZmluZWQgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKSE7XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKHN3YXBTZWxsKHMsIGlkKSkgeyB0aGlzLnRvYXN0KGBTb2xkICR7U09VTF9OQU1FW3Uuc291bF19OiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuYCk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QodS5mcmVzaCA/IFwiWW91IGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kLlwiIDogJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgcy5oYW5kW3RoaXMuc2VsLmlkeF0gPT09IHUuc291bCAmJiB1LnN0YXIgPT09IDEgJiYgcy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicpIHtcbiAgICAgIGlmIChtZXJnZUZyb21IYW5kKHMsIHRoaXMuc2VsLmlkeCwgaWQpKSB7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCB0aGUgY2FyZCBpbnRvIGEgMi1zdGFyICR7U09VTF9OQU1FW3Uuc291bF19IWApOyB9XG4gICAgICBlbHNlIHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb24gdG8gbWVyZ2U6IGl0IG5lZWRzICR7Y29zdCh1LnNvdWwsIDIpIC0gY29zdCh1LnNvdWwsIDEpfSBtb3JlLCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkICE9PSBpZCkge1xuICAgICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gKHRoaXMuc2VsIGFzIGFueSkuaWQpITtcbiAgICAgIGlmIChjYW5NZXJnZURlcGxveWVkKGEsIHUpKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgdS5pZCk7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkOiBhLmlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIH0gZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCA9PT0gaWQgPyBudWxsIDogeyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgbWVyZ2VTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7IGNvbnN0IGIgPSBhICYmIHMudW5pdHMuZmluZCgobykgPT4gY2FuTWVyZ2VEZXBsb3llZChhLCBvKSk7XG4gICAgaWYgKGEgJiYgYikgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIGIuaWQpOyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy50b2FzdCgnTm8gbWF0Y2hpbmcgdW5pdCAoc2FtZSBTb3VsIGFuZCBzdGFycykgdG8gbWVyZ2Ugd2l0aC4nKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHJlbW92ZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmNvbmZpcm1SZW1vdmUpIHsgdGhpcy5jb25maXJtUmVtb3ZlID0gdHJ1ZTsgdGhpcy50b2FzdCgnVGFwIFJlbW92ZSBhZ2FpbiB0byBjb25maXJtLiBUaGUgY2FyZCBpcyBnb25lIGZvciB0aGlzIHN0YWdlLicpOyB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47IH1cbiAgICBkaXNtaXNzKHRoaXMucywgc2VsLmlkKTsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICB0b2dnbGVTd2FwKCkgeyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuOyBpZiAodGhpcy5zLmRpc2NhcmRVc2VkKSB7IHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IHJldHVybjsgfSB0aGlzLnN3YXBNb2RlID0gIXRoaXMuc3dhcE1vZGU7IHRoaXMuc2VsID0gbnVsbDsgaWYgKHRoaXMuc3dhcE1vZGUpIHRoaXMudG9hc3QoJ1N3YXA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkLCBvciBhIHVuaXQgKG5vdCBzdW1tb25lZCB0aGlzIHJvdW5kKSB0byBzZWxsLicpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gYmF0dGxlXG4gIHN0YXJ0QmF0dGxlKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICF0aGlzLnMudW5pdHMubGVuZ3RoKSB7IGlmICghdGhpcy5zLnVuaXRzLmxlbmd0aCkgdGhpcy50b2FzdCgnU3VtbW9uIGF0IGxlYXN0IG9uZSB1bml0IGZpcnN0LicpOyByZXR1cm47IH1cbiAgICB0aGlzLmZsdXNoVHdlZW5zKCk7IGF1ZGlvLnBsYXkoJ3N0YXJ0Jyk7IHRoaXMuYmVnaW5CYXR0bGVQZXJmKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuYXR0ZW1wdCsrOyB0aGlzLmhhbmRsZWQgPSBmYWxzZTsgdGhpcy5yZXN1bHRBdCA9IC0xO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHVuaXRzID0gcy51bml0cy5zbGljZSgpO1xuICAgIGNvbnN0IHNhdmVkID0gbG9hZFNhdmUoKS5zb3VscywgbGV2ZWxzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307IGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhzYXZlZCkpIGxldmVsc1trXSA9IChzYXZlZCBhcyBhbnkpW2tdLmxldmVsOyAgIC8vIHBlcm1hbmVudCBTb3VsIGxldmVsc1xuICAgIHRoaXMuYmF0dGxlID0gbmV3IEJhdHRsZSh1bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpLCB0aGlzLnNlZWQgKiAxMzEgKyBzLndhdmUgKiAxNyArIHRoaXMuYXR0ZW1wdCwgbGV2ZWxzKTtcbiAgICB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpO1xuICAgIHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmZvckVhY2goKGYpID0+IHtcbiAgICAgIGlmIChmLnRlYW0gPT09IDApIHsgY29uc3QgdSA9IHVuaXRzW2YuaWQgLSAxXTsgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmZVbml0LnNldChmLmlkLCB1LmlkKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBmLnNvdWwsIDEsIGYuc3Rhcik7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChmLngsIDAsIGYueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSAtTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHYuc3RhdGUgPT09ICdzcGF3bicpIHYucGxheSgnaWRsZScpOyB9KTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNywgMC42LCAwLjUsIDAuN10sIFswLjQsIDAuMzUsIDAuMywgMC42XSwgMTQpOyB9XG4gICAgfSk7XG4gICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHRoaXMudGludChjLCAnbm9ybWFsJyk7XG4gICAgdGhpcy5waGFzZSA9ICd0cmFuc2l0aW9uJzsgdGhpcy5zdGFydFN0ZXBBdCA9IDEuMDsgdGhpcy5hY2MgPSAwOyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDIuMik7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcHJpdmF0ZSBhcHBseUV2ZW50cyhldnM6IEJFdmVudFtdKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlITtcbiAgICBmb3IgKGNvbnN0IGUgb2YgZXZzKSB7XG4gICAgICBpZiAoZS50ID09PSAnc3dpbmcnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgdi5wbGF5KCdhdHRhY2snLCBlLnNwZWVkKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnaGl0JykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLnRvKTsgaWYgKHYpIHYucHVsc2UoKTsgaWYgKGUua2luZCA9PT0gJ2Fycm93JykgYXVkaW8ucGxheSgnaGl0QXJyb3cnKTsgZWxzZSBpZiAoZS5raW5kID09PSAnbWVsZWUnKSBhdWRpby5wbGF5KCdoaXQnKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnYXJyb3cnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5mcm9tKSEsIHRvID0gYi5ieUlkKGUudG8pITsgdGhpcy5zcGF3bkFycm93KGYudGVhbSwgZi54LCBmLnosIHRvLngsIHRvLnosIGUuZHVyKTsgYXVkaW8ucGxheSgnYXJyb3cnKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnZGVhdGgnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgeyB2LnBsYXkoJ2RlYXRoJyk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ2RlYXRoJyk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTIpOyBpZiAoZi50ZWFtID09PSAxKSB0aGlzLmxhdGVyKDUsICgpID0+IHsgaWYgKHRoaXMuZnZpcy5nZXQoZS5pZCkgPT09IHYgJiYgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgeyB2LmhvbGRlci5zZXRFbmFibGVkKGZhbHNlKTsgfSB9KTsgfSB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdjYXN0JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnY2FzdCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNSwgMC44LCAxKSwgMC4xNSwgMS4xLCAwLjM1KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAndGF1bnQnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCd0YXVudCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuMyksIDAuMywgQkFMQU5DRS50YXVudC5yYWRpdXMsIDAuNik7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3NtYXNoJykgeyBhdWRpby5wbGF5KCdzbWFzaCcpOyB0aGlzLmZ4UmluZyhlLngsIGUueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNSwgMC4yKSwgMC4yLCBlLnIgKiAxLjYsIDAuNDUpOyB9XG4gICAgfVxuICB9XG4gIHByaXZhdGUgc3Bhd25BcnJvdyh0ZWFtOiBudW1iZXIsIHgwOiBudW1iZXIsIHowOiBudW1iZXIsIHgxOiBudW1iZXIsIHoxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgbGV0IG1lc2ggPSB0aGlzLmFycm93TWVzaC5wb3AoKTtcbiAgICBpZiAoIW1lc2gpIHsgbWVzaCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2Fycm93JywgeyBoZWlnaHQ6IDAuNTUsIGRpYW1ldGVyOiAwLjAzNSB9LCB0aGlzLnNjZW5lKTsgbWVzaC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IG1lc2guaXNQaWNrYWJsZSA9IGZhbHNlOyBjb25zdCBob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdhcicsIHRoaXMuc2NlbmUpOyBtZXNoLnBhcmVudCA9IGhvbGRlcjsgbWVzaCA9IGhvbGRlcjsgfVxuICAgIG1lc2guc2V0RW5hYmxlZCh0cnVlKTsgbWVzaC5nZXRDaGlsZE1lc2hlcygpWzBdLm1hdGVyaWFsID0gdGhpcy5hcnJvd01hdHNbdGVhbV07XG4gICAgdGhpcy5hcnJvd3MucHVzaCh7IG1lc2gsIHgwLCB6MCwgeDEsIHoxLCB0OiAwLCBkdXIgfSk7XG4gIH1cblxuICBwcml2YXRlIGZyYW1lKGR0OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5jYW52YXMuY2xpZW50V2lkdGggIT09IHRoaXMubGFzdFcgfHwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0ICE9PSB0aGlzLmxhc3RIKSB0aGlzLmhhbmRsZVJlc2l6ZSgpOyAgIC8vIGUuZy4gdGhlIGhvbWUtc2NyZWVuIGFwcCByZXNpemluZyBhZnRlciBsYXVuY2hcbiAgICBmb3IgKGxldCBpID0gdGhpcy50aW1lcnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgdGhpcy50aW1lcnNbaV0udCAtPSBkdDsgaWYgKHRoaXMudGltZXJzW2ldLnQgPD0gMCkgeyBjb25zdCBmID0gdGhpcy50aW1lcnNbaV0uZm47IHRoaXMudGltZXJzLnNwbGljZShpLCAxKTsgZigpOyB9IH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5yaW5nRngubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgciA9IHRoaXMucmluZ0Z4W2ldOyByLnQgKz0gZHQ7IGNvbnN0IHUgPSByLnQgLyByLmR1ciwgcyA9IHIucjAgKyAoci5yMSAtIHIucjApICogdTsgci5tLnNjYWxpbmcuc2V0KHMsIHMsIHMpOyByLm1tLmFscGhhID0gMC45ICogKDEgLSB1KTsgaWYgKHUgPj0gMSkgeyByLm0uZGlzcG9zZSgpOyByLm1tLmRpc3Bvc2UoKTsgdGhpcy5yaW5nRnguc3BsaWNlKGksIDEpOyB9IH1cbiAgICBpZiAodGhpcy5jYW1UIDwgMSkgeyB0aGlzLmNhbVQgPSBNYXRoLm1pbigxLCB0aGlzLmNhbVQgKyBkdCAvIHRoaXMuY2FtRHVyKTsgY29uc3QgZSA9IHRoaXMuY2FtVCAqIHRoaXMuY2FtVCAqICgzIC0gMiAqIHRoaXMuY2FtVCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnBvcywgdGhpcy5jYW1Uby5wb3MsIGUpOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS50Z3QsIHRoaXMuY2FtVG8udGd0LCBlKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgJiYgdGhpcy5jYW1Nb2RlID09PSAnY2xvc2UnICYmICF0aGlzLmNpbmUpIHRoaXMuZnJhbWVCYXR0bGUoZHQpO1xuICAgIHRoaXMubmVjcm8udXBkYXRlKGR0KTtcbiAgICBmb3IgKGxldCBpID0gdGhpcy50d2VlbnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgdyA9IHRoaXMudHdlZW5zW2ldOyB3LnQgKz0gZHQ7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCB3LnQgLyB3LmR1cik7IHcuZm4odSk7IGlmICh1ID49IDEpIHsgdGhpcy50d2VlbnMuc3BsaWNlKGksIDEpOyBpZiAody5kb25lKSB3LmRvbmUoKTsgfSB9XG4gICAgZm9yIChjb25zdCB2IG9mIHRoaXMudW5pdFZpcy52YWx1ZXMoKSkgdi51cGRhdGUoZHQpO1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi51cGRhdGUoZHQpOyB9KTtcblxuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTtcbiAgICBpZiAoKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJyB8fCB0aGlzLnBoYXNlID09PSAnYmF0dGxlJykgJiYgYikge1xuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykgeyB0aGlzLnN0YXJ0U3RlcEF0IC09IGR0OyBpZiAodGhpcy5zdGFydFN0ZXBBdCA8PSAwKSB7IHRoaXMucGhhc2UgPSAnYmF0dGxlJzsgdGhpcy51aS5yZW5kZXIoKTsgfSB9XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpIHtcbiAgICAgICAgdGhpcy5hY2MgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTtcbiAgICAgICAgd2hpbGUgKHRoaXMuYWNjID49IDEgLyAzMCAmJiBiLndpbm5lciA8IDApIHsgYi5zdGVwKDEgLyAzMCk7IHRoaXMuYWNjIC09IDEgLyAzMDsgdGhpcy5hcHBseUV2ZW50cyhiLmRyYWluKCkpOyB9XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgaWYgKCF0aGlzLmNpbmUgJiYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IGYudGVhbSA9PT0gMSkpIHsgdi5ob2xkZXIucG9zaXRpb24ueCA9IGYueDsgdi5ob2xkZXIucG9zaXRpb24ueiA9IGYuejsgaWYgKGYuYWxpdmUgfHwgdHJ1ZSkgdi5ob2xkZXIucm90YXRpb24ueSA9IGYueWF3OyB9XG4gICAgICAgIGlmIChmLmFsaXZlKSB7IHYuc2V0SHAoZi5ocCAvIGYubWF4SHApOyBpZiAoZi5tYXhNYW5hKSB2LnNldE1hbmEoZi5tYW5hIC8gZi5tYXhNYW5hKTsgfVxuICAgICAgICBlbHNlIHYuc2V0TWFuYShudWxsKTtcbiAgICAgICAgaWYgKGYuc3RhdGUgIT09ICdhdHRhY2snICYmIGYuYWxpdmUpIHsgY29uc3Qgd2FudCA9IGYuc3RhdGUgPT09ICdydW4nID8gJ3J1bicgOiAnaWRsZSc7IGlmICh0aGlzLmxhc3RTdGF0ZS5nZXQoZi5pZCkgIT09IHdhbnQgfHwgKHYuc3RhdGUgIT09IHdhbnQgJiYgdi5zdGF0ZSAhPT0gJ3NwYXduJykpIHsgaWYgKHYuc3RhdGUgIT09ICdzcGF3bicpIHsgdi5wbGF5KHdhbnQgYXMgYW55KTsgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsIHdhbnQpOyB9IH0gfVxuICAgICAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHRoaXMubGFzdFN0YXRlLnNldChmLmlkLCAnYXR0YWNrJyk7XG4gICAgICB9XG4gICAgICBpZiAoYi53aW5uZXIgPj0gMCAmJiAhdGhpcy5oYW5kbGVkKSB7IHRoaXMuaGFuZGxlZCA9IHRydWU7IHRoaXMucmVzdWx0QXQgPSAxLjQ7IH1cbiAgICAgIGlmICh0aGlzLnJlc3VsdEF0ID4gMCkgeyB0aGlzLnJlc3VsdEF0IC09IGR0OyBpZiAodGhpcy5yZXN1bHRBdCA8PSAwKSB0aGlzLmhhbmRsZVJlc3VsdCgpOyB9XG4gICAgfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLmFycm93cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgYSA9IHRoaXMuYXJyb3dzW2ldOyBhLnQgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTsgY29uc3QgdSA9IE1hdGgubWluKDEsIGEudCAvIGEuZHVyKTtcbiAgICAgIGNvbnN0IHB4ID0gYS54MCArIChhLngxIC0gYS54MCkgKiB1LCBweiA9IGEuejAgKyAoYS56MSAtIGEuejApICogdSwgcHkgPSAwLjc1ICsgTWF0aC5zaW4odSAqIE1hdGguUEkpICogMC45IC0gdSAqIDAuMjU7XG4gICAgICBjb25zdCB1MiA9IE1hdGgubWluKDEsIHUgKyAwLjAzKSwgcXggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUyLCBxeiA9IGEuejAgKyAoYS56MSAtIGEuejApICogdTIsIHF5ID0gMC43NSArIE1hdGguc2luKHUyICogTWF0aC5QSSkgKiAwLjkgLSB1MiAqIDAuMjU7XG4gICAgICBhLm1lc2gucG9zaXRpb24uc2V0KHB4LCBweSwgcHopOyBhLm1lc2gubG9va0F0KG5ldyBCQUJZTE9OLlZlY3RvcjMocXgsIHF5LCBxeikpO1xuICAgICAgaWYgKHUgPj0gMSkgeyBhLm1lc2guc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuYXJyb3dNZXNoLnB1c2goYS5tZXNoKTsgdGhpcy5hcnJvd3Muc3BsaWNlKGksIDEpOyB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVSZXN1bHQoKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlISwgcyA9IHRoaXMucztcbiAgICB0aGlzLmVuZEJhdHRsZVBlcmYoKTtcbiAgICB0aGlzLmxhc3RCYXR0bGUgPSBgd2F2ZSAke3Mud2F2ZX0gYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH06ICR7Yi53aW5uZXIgPT09IDAgPyAnV09OJyA6ICdMT1NUJ30gaW4gJHtiLnRpbWUudG9GaXhlZCgxKX1zLCAke2IuY291bnQoMCl9IG9mIHlvdXJzIGFuZCAke2IuY291bnQoMSl9IGVuZW1pZXMgbGVmdGA7XG4gICAgaWYgKGIud2lubmVyID09PSAwKSB7XG4gICAgICB0aGlzLnBsYXlSZXN1bHQoJ3dpbicsICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgYXJteSBpcyByYWlzZWQgYWdhaW4sIHRoZW4gdGhlIG5leHQgd2F2ZSAvIHRoZSBkcmFmdFxuICAgICAgICB0aGlzLmNpbmUgPSBmYWxzZTtcbiAgICAgICAgaWYgKGFkdmFuY2VXYXZlKHMpKSB7XG4gICAgICAgICAgdGhpcy5waGFzZSA9ICd3b24nOyBjbGVhclJ1bigpO1xuICAgICAgICAgIHRyeSB7IHRoaXMucmV3YXJkID0gcmVjb3JkQ2xlYXJBbmRTYXZlKCdjcnlwdCcsIGRpZmZpY3VsdHlOYW1lIGFzIGFueSk7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2F2ZS1jaGFuZ2VkJykpOyB9IGNhdGNoIHsgdGhpcy5yZXdhcmQgPSBudWxsOyB9XG4gICAgICAgICAgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZHJhZnQgPSBkcmFmdE9wdGlvbnMocyk7IHRoaXMucGhhc2UgPSAnZHJhZnQnOyB0aGlzLnBlcnNpc3RSdW4oKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmYWlsV2F2ZShzKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy51aS5wdWxzZUhlYXJ0cygpOyAgICAgICAgICAgICAgICAgICAvLyB0aGUgaGVhcnQgaXMgbG9zdCB0aGUgbW9tZW50IGhlIGlzIGhpdFxuICAgICAgaWYgKHMuc3RhdHVzID09PSAnbG9zdCcpIHRoaXMucGxheVJlc3VsdCgnZmluYWwnLCAoKSA9PiB7IHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnBoYXNlID0gJ2xvc3QnOyBjbGVhclJ1bigpOyB0aGlzLnVpLnJlbmRlcigpOyB9KTtcbiAgICAgIGVsc2UgdGhpcy5wbGF5UmVzdWx0KCdsb3NzJywgKCkgPT4geyB0aGlzLnRvYXN0KCdZb3VyIGFybXkgZmVsbC4gLTEgaGVhcnQsICsxIGNhcmQsIHNhbWUgd2F2ZS4gUmVidWlsZCBhIGRpZmZlcmVudCBzdHJhdGVneS4nKTsgdGhpcy50b0J1aWxkKCk7IH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gcmVzdWx0IGN1dHNjZW5lcyAocGxhbiBzZWN0aW9ucyAxOS0yMik6IHRoZSBOZWNyb21hbmNlciB0YWtlcyB0aGUgaGl0LCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUsIHJhaXNlcyB0aGUgZmFsbGVuXG4gIHByaXZhdGUgcGxheVJlc3VsdChraW5kOiAnd2luJyB8ICdsb3NzJyB8ICdmaW5hbCcsIGRvbmU6ICgpID0+IHZvaWQpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBuID0gdGhpcy5uZWNybzsgdGhpcy5jaW5lID0gdHJ1ZTsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7XG4gICAgY29uc3QgaG9tZSA9ICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBldmVyeSBmYWxsZW4gYWxseSBpcyBwdWxsZWQgYmFjayB0byBpdHMgZ3JpZCB0aWxlIGFuZCBzdGFuZHMgdXBcbiAgICAgIG4uY2FzdCgpOyBhdWRpby5wbGF5KCdyZXN1cnJlY3QnKTsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpOyB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMC44NSwgMC41LCAxLCAwLjldLCBbMC41LCAwLjIsIDEsIDAuN10sIDMwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDApIGNvbnRpbnVlOyBjb25zdCB1aWQgPSB0aGlzLmZVbml0LmdldChmLmlkKSwgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1aWQpLCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF1IHx8ICF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyh1LmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoIWYuYWxpdmUpIHsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLmJ1cnN0KHgwLCB6MCwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxOCk7IHRoaXMuZnhSaW5nKHgwLCB6MCwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zNSwgMSksIDAuMywgMS42LCAwLjcpOyB9XG4gICAgICAgIHRoaXMudHdlZW4oMS4wLCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuNSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LmhvbGRlci5yb3RhdGlvbi55ICs9IChNYXRoLlBJIC8gMiAtIHYuaG9sZGVyLnJvdGF0aW9uLnkpICogTWF0aC5taW4oMSwgdCAqIDAuNSArIDAuMSk7IH0sXG4gICAgICAgICAgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC43NSwgMC40LCAxLCAwLjldLCBbMC40LCAwLjE1LCAwLjksIDAuN10sIDEwKTsgfSk7XG4gICAgICB9XG4gICAgfTtcbiAgICBpZiAoa2luZCA9PT0gJ3dpbicpIHsgbi5jYXN0KCk7IGF1ZGlvLnBsYXkoJ3ZpY3RvcnknKTsgdGhpcy5sYXRlcigwLjI1LCBob21lKTsgdGhpcy5sYXRlcigyLjAsIGRvbmUpOyByZXR1cm47IH1cbiAgICBuLmh1cnQoKTsgYXVkaW8ucGxheSgnaGVhcnRMb3N0Jyk7IHRoaXMubGF0ZXIoMC4xNSwgKCkgPT4geyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjMsIDAuMywgMC45XSwgWzAuOCwgMC4xLCAwLjIsIDAuNl0sIDE2KTsgfSk7XG4gICAgaWYgKGtpbmQgPT09ICdmaW5hbCcpIHsgdGhpcy5sYXRlcigwLjYsICgpID0+IHsgbi5kZWZlYXQoKTsgYXVkaW8ucGxheSgnZGVmZWF0Jyk7IH0pOyB0aGlzLmxhdGVyKDIuNiwgZG9uZSk7IHJldHVybjsgfVxuICAgIHRoaXMubGF0ZXIoMS4wLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwdWxzaW9uIHNob2Nrd2F2ZTogc3Vydml2b3JzIGFyZSBmbHVuZyBiYWNrIHRvIHdoZXJlIHRoZXkgc3RhcnRlZCBhbmQgaGVhbCB0byBmdWxsXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgnc2hvY2t3YXZlJyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTtcbiAgICAgIHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDAuODUsIDAuNTUsIDEpLCAwLjYsIDMwLCAxLjEpOyB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC40LCAyMiwgMC44KTtcbiAgICAgIHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjg1LCAxLCAwLjldLCBbMC43LCAwLjQsIDEsIDAuN10sIDQwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDEgfHwgIWYuYWxpdmUpIGNvbnRpbnVlOyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSBjZWxsUG9zKDEsIGYuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnB1bHNlKCk7XG4gICAgICAgIHRoaXMudHdlZW4oMC45LCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuOSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LnNldEhwKGYuaHAgLyBmLm1heEhwICsgKDEgLSBmLmhwIC8gZi5tYXhIcCkgKiB0KTsgfSwgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdi5zZXRIcCgxKTsgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5sYXRlcigyLjMsIGhvbWUpOyB0aGlzLmxhdGVyKDMuNywgZG9uZSk7XG4gIH1cbiAgcGlja0RyYWZ0KGlkeDogbnVtYmVyKSB7IGlmICghdGhpcy5kcmFmdCkgcmV0dXJuOyB0YWtlRHJhZnQodGhpcy5zLCB0aGlzLmRyYWZ0LCBpZHgpOyB0aGlzLmRyYWZ0ID0gbnVsbDsgbm9ybWFsRHJhdyh0aGlzLnMpOyB0aGlzLnRvQnVpbGQoKTsgfVxuICBwcml2YXRlIHRvQnVpbGQoKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMubmVjcm8ucmV2aXZlKCk7IHRoaXMuZmx1c2hUd2VlbnMoKTtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgeyAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVzdXJyZWN0aW9uOiBldmVyeW9uZSByaXNlcyBhZ2FpbiBhdCBmdWxsIGhlYWx0aFxuICAgICAgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LmhvbGRlci5zZXRFbmFibGVkKHRydWUpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7XG4gICAgICB0aGlzLmxhdGVyKDEuMSwgKCkgPT4gdi5wbGF5KCdpZGxlJykpO1xuICAgIH1cbiAgICB0aGlzLnBoYXNlID0gJ2J1aWxkJzsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyAgICAgICAgICAvLyBVSSBmaXJzdDogdGhlIGNhbWVyYSBtdXN0IG1lYXN1cmUgdGhlIGhhbmQgYW5kIGJ1dHRvbnMgd2hpbGUgdGhleSBhcmUgdmlzaWJsZVxuICAgIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJ1aWxkLCAxLjgpO1xuICB9XG4gIHNldFNwZWVkKGs6IG51bWJlcikgeyB0aGlzLnRpbWVTY2FsZSA9IGs7IHRoaXMudWkucmVuZGVyKCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBoZWxwZXJzXG4gIGFwcGx5QmFsYW5jZUNoYW5nZSgpIHsgdGhpcy51bml0VmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOyBpZiAodSkgdi5zZXRTdGFyKHUuc3Rhcik7IH0pOyB9XG4gIHRlc3RPZGRzKG4gPSAyMDApIHtcbiAgICBjb25zdCBzbG90cyA9IHRoaXMucy51bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVtaWVzID0gZW5lbXlXYXZlKHRoaXMucy53YXZlLCB0aGlzLnNlZWQpOyBsZXQgd2luID0gMCwgdCA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsgY29uc3QgciA9IHNpbXVsYXRlKHNsb3RzLCBlbmVtaWVzLCA1MDAwICsgaSk7IGlmIChyLndpbm5lciA9PT0gMCkgd2luKys7IHQgKz0gci50aW1lOyB9XG4gICAgcmV0dXJuIHsgd2luOiBNYXRoLnJvdW5kKCh3aW4gLyBuKSAqIDEwMCksIGF2Z1RpbWU6ICsodCAvIG4pLnRvRml4ZWQoMSksIG4gfTtcbiAgfVxuICBhZGRDYXJkKHNvdWw6IFNvdWxJZCkgeyB0aGlzLnMuaGFuZC5wdXNoKHNvdWwpOyB0aGlzLnMuc3RhdHMuZHJhd24rKzsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICBhZGREb21pbmlvbihuOiBudW1iZXIpIHsgdGhpcy5zLmNhcCArPSBuOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIHJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIGVuID0gZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKTtcbiAgICByZXR1cm4gW2BzZWVkICR7dGhpcy5zZWVkfSAgd2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfSAgaGVhcnRzICR7cy5oZWFydHN9ICBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0gIHBoYXNlICR7dGhpcy5waGFzZX0gIGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9YCxcbiAgICAgIGBoYW5kOiAke3MuaGFuZC5qb2luKCcsICcpIHx8ICcoZW1wdHkpJ31gLCBgYXJteTogJHtzLnVuaXRzLm1hcCgodSkgPT4gYCR7dS5zb3VsfSR7dS5zdGFyfUAke3UuY2VsbH1gKS5qb2luKCcgJykgfHwgJyhub25lKSd9YCwgYGVuZW15OiAke2VuLm1hcCgoZSkgPT4gZS5zb3VsICsgZS5zdGFyKS5qb2luKCcgJyl9YCxcbiAgICAgIGBkaWZmaWN1bHR5OiAke2RpZmZpY3VsdHlOYW1lfSAgbWVyZ2UtZnJvbS1oYW5kOiAke3MucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInfSAgc3dhcCB1c2VkOiAke3MuZGlzY2FyZFVzZWR9YCwgYGxhc3QgdGFwOiAke3RoaXMubGFzdFRhcEluZm99YCwgYHNjcmVlbjogJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IGRwciAke3dpbmRvdy5kZXZpY2VQaXhlbFJhdGlvfWAsIGBsYXN0IGJhdHRsZTogJHt0aGlzLmxhc3RCYXR0bGUgfHwgJy0nfWAsIGBsb2cgdGFpbDpgLCAuLi5zLmxvZy5zbGljZSgtOCksIGBiYWxhbmNlOiAke0pTT04uc3RyaW5naWZ5KHsgc3RhcjogQkFMQU5DRS5zdGFyLCBzdGF0czogQkFMQU5DRS5zdGF0cyB9KX1gXS5qb2luKCdcXG4nKTtcbiAgfVxuICByZXNldEJhbGFuY2VBbGwoKSB7IHJlc2V0QmFsYW5jZSgpOyB0aGlzLmFwcGx5QmFsYW5jZUNoYW5nZSgpOyB9XG4gIGdldCBkaWZmaWN1bHR5KCkgeyByZXR1cm4gZGlmZmljdWx0eU5hbWU7IH1cbiAgY2hhbmdlRGlmZmljdWx0eShuYW1lOiBzdHJpbmcpIHsgc2V0RGlmZmljdWx0eShuYW1lKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy50b2FzdChgRGlmZmljdWx0eTogJHtuYW1lfS4gQXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUuYCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBnYWxsZXJ5IChzdGFyIGxvb2tzKVxuICBnYWxsZXJ5KCkge1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmFkZCgnZ2FsbGVyeScpOyB0aGlzLm5lY3JvLnNldEVuYWJsZWQoZmFsc2UpOyBjb25zdCB2aXM6IFVuaXRWaXN1YWxbXSA9IFtdOyBsZXQgdGVhbTogMCB8IDEgPSAwO1xuICAgIGNvbnN0IHJlYnVpbGQgPSAoKSA9PiB7IHZpcy5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHZpcy5sZW5ndGggPSAwOyBTT1VMUy5mb3JFYWNoKChzb3VsLCBpKSA9PiBbMSwgMiwgM10uZm9yRWFjaCgoc3QsIGopID0+IHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHNvdWwsIHRlYW0sIHN0KTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KChpIC0gMi41KSAqIDIuNSwgMCwgKGogLSAxKSAqIC0yLjQpOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAqIDAuODU7IHYucGxheSgnaWRsZScpOyB2aXMucHVzaCh2KTsgfSkpOyB9O1xuICAgIHJlYnVpbGQoKTsgdGhpcy5jYW1lcmEucG9zaXRpb24uc2V0KDAsIDUuNiwgLTE0LjUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIC0wLjQpKTsgdGhpcy5jYW1lcmEuZm92ID0gMC44NTtcbiAgICAod2luZG93IGFzIGFueSkuX19nYWxsZXJ5ID0geyBzZXRUZWFtOiAodDogMCB8IDEpID0+IHsgdGVhbSA9IHQ7IHJlYnVpbGQoKTsgfSwgdmlzIH07XG4gICAgbGV0IGxhc3QgPSBwZXJmb3JtYW5jZS5ub3coKTsgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG4gPSBwZXJmb3JtYW5jZS5ub3coKSwgZHQgPSBNYXRoLm1pbigwLjA1LCAobiAtIGxhc3QpIC8gMTAwMCk7IGxhc3QgPSBuOyB2aXMuZm9yRWFjaCgodikgPT4gdi51cGRhdGUoZHQpKTsgdGhpcy5zY2VuZS5yZW5kZXIoKTsgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBHYW1lIH0gZnJvbSAnLi9nYW1lLnRzJztcblxuY29uc3QgZyA9IG5ldyBHYW1lKCk7XG4od2luZG93IGFzIGFueSkuX19nYW1lID0gZzsgICAgICAgICAgICAgICAgICAgICAgIC8vIGhhbmR5IGZvciBkZWJ1Z2dpbmcgZnJvbSB0aGUgYnJvd3NlciBjb25zb2xlXG5nLmluaXQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2MnKSBhcyBIVE1MQ2FudmFzRWxlbWVudClcbiAgLnRoZW4oKCkgPT4geyBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIGwuc3R5bGUuZGlzcGxheSA9ICdub25lJzsgKHdpbmRvdyBhcyBhbnkpLl9fZ2FtZVJlYWR5ID0gdHJ1ZTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nYW1lLXJlYWR5JykpOyB9KVxuICAuY2F0Y2goKGUpID0+IHtcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIHsgbC5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnOyBsLnRleHRDb250ZW50ID0gJ0Vycm9yOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogZSk7IH1cbiAgICBjb25zb2xlLmVycm9yKGUpO1xuICB9KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7OztBQW9DTyxNQUFNLFdBQW9CO0FBQUEsSUFDL0IsT0FBTztBQUFBLE1BQ0wsU0FBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxHQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxLQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFFBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEtBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsTUFDOUcsUUFBVyxFQUFFLElBQUksS0FBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sS0FBTSxPQUFPLEdBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLElBQUk7QUFBQSxNQUM5RyxNQUFXLEVBQUUsSUFBSSxLQUFLLEtBQUssSUFBSSxVQUFVLEtBQUssT0FBTyxNQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxLQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFdBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsTUFBTSxPQUFPLEtBQUssT0FBTyxLQUFLLE1BQU0sS0FBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsSUFDaEg7QUFBQTtBQUFBLElBRUEsTUFBTSxFQUFFLElBQUksQ0FBQyxHQUFHLEdBQUssR0FBRyxHQUFHLEtBQUssQ0FBQyxHQUFHLEtBQUssQ0FBRyxHQUFHLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxFQUFFO0FBQUEsSUFD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TSxHQUFHO0FBQUc7QUFBQSxRQUN6SyxLQUFLO0FBQWEsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxNQUFNLEtBQUssV0FBVyxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxVQUFVLE1BQU0sTUFBTSxLQUFLLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDNUssS0FBSztBQUFXLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsR0FBRztBQUFHO0FBQUEsUUFDekksS0FBSztBQUFVLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLElBQUksS0FBSyxRQUFRLEtBQUssR0FBRztBQUFHO0FBQUEsUUFDdEosS0FBSztBQUFjLGVBQUssS0FBSyxJQUFJLE1BQU0sUUFBUSxNQUFNLEdBQUcsS0FBSyxHQUFHO0FBQUcsZUFBSyxLQUFLLE1BQU0sTUFBTSxXQUFXLEtBQUssR0FBRyxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssR0FBSyxZQUFZLE1BQU0sS0FBSyxLQUFLLEdBQUc7QUFBRztBQUFBLFFBQ3pLLEtBQUs7QUFBYyxXQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxLQUFNLEdBQUc7QUFBRztBQUFBLFFBQzlMLEtBQUs7QUFBWSxlQUFLLEtBQUssTUFBTSxLQUFLLFlBQVksTUFBTSxHQUFHLEdBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsS0FBSyxNQUFNLEVBQUU7QUFBRyxXQUFDLE1BQU0sTUFBTSxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksS0FBSyxPQUFPLElBQUksSUFBSSxDQUFDO0FBQUc7QUFBQSxRQUMxTSxLQUFLO0FBQVcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEdBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsS0FBSyxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ25HLEtBQUs7QUFBWSxlQUFLLEtBQUssTUFBTSxNQUFNLFlBQVksSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDdEcsS0FBSztBQUFZLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLE1BQU0sWUFBWSxNQUFNLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQzdILEtBQUs7QUFBWSxlQUFLLEtBQUssVUFBVTtBQUFHLFdBQUMsS0FBSyxLQUFLLEtBQUssSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsS0FBSyxHQUFHLEVBQUU7QUFBRztBQUFBLFFBQ3pLLEtBQUs7QUFBYyxlQUFLLEtBQUssVUFBVTtBQUFHLFdBQUMsS0FBSyxLQUFLLEtBQUssTUFBTSxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxJQUFJLEtBQUssUUFBUSxNQUFNLEdBQUcsRUFBRTtBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxLQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUN0USxLQUFLO0FBQWUsV0FBQyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLE1BQU0sWUFBWSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUc7QUFBQSxRQUNsRyxLQUFLO0FBQVMsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxLQUFLLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFdBQVcsR0FBRztBQUFHO0FBQUEsTUFDN0s7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVPLE1BQU0sUUFBUSxJQUFJLFlBQVk7QUFDckMsRUFBQyxPQUFlLFVBQVU7QUFJMUIsTUFBTSxhQUFhLE1BQU0sTUFBTSxPQUFPO0FBQ3RDLGFBQVcsTUFBTSxDQUFDLGVBQWUsYUFBYSxZQUFZLFNBQVMsU0FBUyxFQUFHLFVBQVMsaUJBQWlCLElBQUksWUFBWSxFQUFFLFNBQVMsS0FBSyxDQUFDO0FBQzFJLFdBQVMsaUJBQWlCLFNBQVMsQ0FBQyxNQUFNO0FBQUUsVUFBTSxLQUFLLEVBQUU7QUFBOEIsUUFBSSxNQUFNLEdBQUcsV0FBVyxHQUFHLFFBQVEsd0JBQXdCLEVBQUcsT0FBTSxLQUFLLEtBQUs7QUFBQSxFQUFHLEdBQUcsSUFBSTtBQUMvSyxXQUFTLGlCQUFpQixvQkFBb0IsTUFBTTtBQUFFLFVBQU0sSUFBSyxNQUFjO0FBQTRCLFFBQUksQ0FBQyxFQUFHO0FBQVEsUUFBSSxTQUFTLE9BQVEsR0FBRSxRQUFRO0FBQUEsYUFBWSxNQUFNLFNBQVMsTUFBTSxJQUFLLEdBQUUsT0FBTztBQUFBLEVBQUcsQ0FBQztBQUM3TSxTQUFPLGlCQUFpQiwwQkFBMEIsTUFBTSxNQUFNLE9BQU8sQ0FBQzs7O0FDdkp0RSxNQUFNQyxPQUFNO0FBQ1osTUFBTUMsV0FBVTtBQVNULFdBQVMsZUFBZSxHQUEyQjtBQUN4RCxXQUFPO0FBQUEsTUFDTCxPQUFPLEtBQUssTUFBTSxLQUFLLFVBQVUsRUFBRSxLQUFLLENBQUM7QUFBQSxNQUFHLEtBQUssRUFBRSxNQUFNLEVBQUUsSUFBSSxNQUFNLEtBQUssRUFBRSxJQUFJLE1BQU0sRUFBRTtBQUFBLE1BQ3hGLE1BQU0sRUFBRTtBQUFBLE1BQU0sUUFBUSxFQUFFO0FBQUEsTUFBUSxLQUFLLEVBQUU7QUFBQSxNQUFLLE1BQU0sRUFBRSxLQUFLLE1BQU07QUFBQSxNQUFHLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFLEVBQUU7QUFBQSxNQUFHLFFBQVEsRUFBRTtBQUFBLE1BQVEsYUFBYSxFQUFFO0FBQUEsTUFDMUksUUFBUTtBQUFBLE1BQVksS0FBSyxFQUFFLElBQUksTUFBTSxHQUFHO0FBQUEsTUFBRyxPQUFPLEVBQUUsR0FBRyxFQUFFLE1BQU07QUFBQSxJQUNqRTtBQUFBLEVBQ0Y7QUFFQSxNQUFNLFNBQVMsQ0FBQyxNQUF3QixNQUFNLFNBQVMsQ0FBQztBQUN4RCxNQUFNLE1BQU0sQ0FBQyxHQUFRLElBQVksT0FBZSxPQUFPLFVBQVUsQ0FBQyxLQUFLLEtBQUssTUFBTSxLQUFLO0FBR2hGLFdBQVMsaUJBQWlCLEdBQXNCO0FBakN2RDtBQWtDRSxRQUFJO0FBQ0YsVUFBSSxDQUFDLEtBQUssT0FBTyxNQUFNLFNBQVUsUUFBTztBQUN4QyxZQUFNLElBQUksRUFBRTtBQUNaLFVBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxRQUFRLEVBQUUsS0FBSyxLQUFLLENBQUMsRUFBRSxNQUFNLFVBQVUsQ0FBQyxFQUFFLE1BQU0sTUFBTSxDQUFDLE1BQVcsT0FBTyxTQUFTLENBQUMsS0FBSyxJQUFJLENBQUMsRUFBRyxRQUFPO0FBQ3hILFVBQUksRUFBRSxVQUFVLGtCQUFrQixFQUFFLFVBQVUsa0JBQW1CLFFBQU87QUFDeEUsVUFBSSxFQUFFLFNBQVMsVUFBYSxFQUFFLE1BQU0sUUFBUSxFQUFFLElBQUksS0FBSyxFQUFFLEtBQUssVUFBVSxFQUFFLEtBQUssTUFBTSxNQUFNLEdBQUksUUFBTztBQUN0RyxZQUFNQyxlQUFhLE9BQUUsZUFBRixZQUFnQixFQUFFLE1BQU07QUFDM0MsVUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEdBQUcsS0FBSyxJQUFJQSxhQUFZLEVBQUUsTUFBTSxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxRQUFRLEdBQUcsTUFBTSxLQUFLLENBQUMsT0FBTyxTQUFTLEVBQUUsR0FBRyxLQUFLLEVBQUUsT0FBTyxFQUFHLFFBQU87QUFDeEksVUFBSSxDQUFDLE1BQU0sUUFBUSxFQUFFLElBQUksS0FBSyxFQUFFLEtBQUssU0FBUyxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sTUFBTSxFQUFHLFFBQU87QUFDbEYsVUFBSSxDQUFDLE1BQU0sUUFBUSxFQUFFLEtBQUssS0FBSyxFQUFFLE1BQU0sU0FBUyxXQUFZLFFBQU87QUFDbkUsVUFBSSxDQUFDLElBQUksRUFBRSxRQUFRLEdBQUcsR0FBRyxLQUFLLE9BQU8sRUFBRSxnQkFBZ0IsVUFBVyxRQUFPO0FBQ3pFLFlBQU0sUUFBUSxvQkFBSSxJQUFZLEdBQUcsTUFBTSxvQkFBSSxJQUFZLEdBQUcsUUFBZ0IsQ0FBQztBQUMzRSxpQkFBVyxLQUFLLEVBQUUsT0FBTztBQUN2QixZQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsTUFBTSxHQUFHLFFBQVEsS0FBSyxDQUFDLElBQUksRUFBRSxNQUFNLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsSUFBSSxHQUFHLEVBQUUsTUFBTSxLQUFLLE1BQU0sSUFBSSxFQUFFLElBQUksS0FBSyxJQUFJLElBQUksRUFBRSxFQUFFLEVBQUcsUUFBTztBQUNuSyxjQUFNLElBQUksRUFBRSxJQUFJO0FBQUcsWUFBSSxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQU0sS0FBSyxFQUFFLElBQUksRUFBRSxJQUFJLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNLE9BQU8sQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDO0FBQUEsTUFDdkg7QUFDQSxZQUFNLEtBQUssRUFBRTtBQUNiLFVBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxTQUFTLGFBQWEsYUFBYSxVQUFVLFVBQVUsRUFBRSxNQUFNLENBQUMsTUFBTSxPQUFPLFNBQVMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFDbkgsVUFBSSxDQUFDLEVBQUUsT0FBTyxDQUFDLE9BQU8sU0FBUyxFQUFFLElBQUksSUFBSSxLQUFLLENBQUMsT0FBTyxTQUFTLEVBQUUsSUFBSSxHQUFHLEVBQUcsUUFBTztBQUNsRixhQUFPO0FBQUEsUUFDTCxPQUFPO0FBQUEsUUFBWSxLQUFLLFFBQVEsRUFBRSxJQUFJLE1BQU0sRUFBRSxJQUFJLEdBQUc7QUFBQSxRQUFHLE1BQU0sRUFBRTtBQUFBLFFBQU0sUUFBUSxFQUFFO0FBQUEsUUFBUSxLQUFLLEVBQUU7QUFBQSxRQUFLLE1BQU0sRUFBRSxLQUFLLE1BQU07QUFBQSxRQUFHO0FBQUEsUUFBTyxRQUFRLEVBQUU7QUFBQSxRQUMzSSxhQUFhLEVBQUU7QUFBQSxRQUFhLFFBQVE7QUFBQSxRQUFZLEtBQUssTUFBTSxRQUFRLEVBQUUsR0FBRyxJQUFJLEVBQUUsSUFBSSxPQUFPLENBQUMsTUFBVyxPQUFPLE1BQU0sUUFBUSxFQUFFLE1BQU0sR0FBRyxJQUFJLENBQUM7QUFBQSxRQUMxSSxPQUFPLEVBQUUsT0FBTyxHQUFHLE9BQU8sV0FBVyxHQUFHLFdBQVcsV0FBVyxHQUFHLFdBQVcsUUFBUSxHQUFHLFFBQVEsVUFBVSxHQUFHLFNBQVM7QUFBQSxNQUN2SDtBQUFBLElBQ0YsUUFBUTtBQUFFLGFBQU87QUFBQSxJQUFNO0FBQUEsRUFDekI7QUFFTyxXQUFTLFFBQVEsTUFBbUIsUUFBc0IsYUFBYSxHQUFTO0FBQ3JGLFFBQUk7QUFBRSxVQUFJLE1BQU8sT0FBTSxRQUFRRixNQUFLLEtBQUssVUFBVSxJQUFJLENBQUM7QUFBQSxJQUFHLFFBQVE7QUFBQSxJQUF3RTtBQUFBLEVBQzdJO0FBQ08sV0FBUyxTQUFTLFFBQXNCLGFBQWEsR0FBUztBQUNuRSxRQUFJO0FBQUUsVUFBSSxTQUFVLE1BQWMsV0FBWSxDQUFDLE1BQWMsV0FBV0EsSUFBRztBQUFBLGVBQVksTUFBTyxPQUFNLFFBQVFBLE1BQUssRUFBRTtBQUFBLElBQUcsUUFBUTtBQUFBLElBQWU7QUFBQSxFQUMvSTtBQUNPLFdBQVMsUUFBUSxRQUFzQixhQUFhLEdBQStDO0FBQ3hHLFFBQUk7QUFDRixZQUFNLElBQUksU0FBUyxNQUFNLFFBQVFBLElBQUc7QUFBRyxVQUFJLENBQUMsRUFBRyxRQUFPO0FBQ3RELFlBQU0sSUFBSSxLQUFLLE1BQU0sQ0FBQztBQUN0QixVQUFJLENBQUMsS0FBSyxFQUFFLE1BQU1DLFlBQVksRUFBRSxVQUFVLFdBQVcsRUFBRSxVQUFVLFdBQVksQ0FBQyxPQUFPLFNBQVMsRUFBRSxJQUFJLEtBQUssQ0FBQyxPQUFPLFNBQVMsRUFBRSxPQUFPLEtBQUssT0FBTyxFQUFFLGVBQWUsU0FBVSxRQUFPO0FBQ2pMLFlBQU0sUUFBUSxpQkFBaUIsRUFBRSxLQUFLO0FBQUcsVUFBSSxDQUFDLE1BQU8sUUFBTztBQUM1RCxZQUFNLFFBQVEsRUFBRSxVQUFVLFdBQVcsTUFBTSxRQUFRLEVBQUUsS0FBSyxLQUFLLEVBQUUsTUFBTSxXQUFXLEtBQUssRUFBRSxNQUFNLE1BQU0sTUFBTSxJQUFJLEVBQUUsUUFBUTtBQUN6SCxhQUFPLEVBQUUsTUFBTSxFQUFFLEdBQUdBLFVBQVMsTUFBTSxFQUFFLE1BQU0sU0FBUyxFQUFFLFNBQVMsWUFBWSxFQUFFLFlBQVksT0FBTyxRQUFRLFVBQVUsU0FBUyxPQUFPLE9BQU8sRUFBRSxNQUFNLEdBQUcsTUFBTTtBQUFBLElBQzVKLFFBQVE7QUFBRSxhQUFPO0FBQUEsSUFBTTtBQUFBLEVBQ3pCOzs7QUNqRU8sTUFBTSxZQUFZO0FBR2xCLE1BQU0sVUFBVTtBQUFBLElBQ3JCLGdCQUFnQixFQUFFLE1BQU0sR0FBRyxRQUFRLEdBQUcsTUFBTSxHQUFHLFdBQVcsRUFBRTtBQUFBLElBQzVELFlBQVk7QUFBQSxJQUNaLHFCQUFxQjtBQUFBLEVBQ3ZCO0FBaUJPLFdBQVMsVUFBVSxNQUFZLE1BQWMsUUFBaUM7QUFDbkYsUUFBSSxLQUFLLE1BQU0sVUFBVSxVQUFXLFFBQU87QUFDM0MsVUFBTSxPQUFpQixFQUFFLElBQUksS0FBSyxjQUFjLE1BQU0sS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLFlBQVksS0FBSyxNQUFNLElBQUksQ0FBQyxDQUFDLEdBQUcsT0FBTztBQUNsSCxTQUFLLE1BQU0sS0FBSyxJQUFJO0FBQUcsV0FBTztBQUFBLEVBQ2hDO0FBYU8sV0FBUyxZQUFZLE1BQVksU0FBaUIsWUFBcUM7QUFwRDlGO0FBcURFLFVBQU0sTUFBTSxVQUFVLE1BQU0sWUFBWSxVQUFTLFVBQUssT0FBTyxHQUFHLE1BQWYsWUFBb0I7QUFDckUsU0FBSyxPQUFPLEdBQUcsSUFBSSxTQUFTO0FBQzVCLFFBQUksV0FBVyxFQUFHLFFBQU8sRUFBRSxPQUFPLE1BQU0sTUFBTSxVQUFVLE1BQU0sUUFBUSxlQUFlLFVBQVUsR0FBRyxzQkFBbUIsVUFBVSxHQUFHLGFBQWEsS0FBSyxhQUFhLGNBQWMsUUFBUSxvQkFBb0I7QUFDM00sU0FBSztBQUNMLFFBQUksT0FBd0I7QUFDNUIsUUFBSSxLQUFLLGVBQWUsUUFBUSxxQkFBcUI7QUFBRSxXQUFLLGVBQWUsUUFBUTtBQUFxQixhQUFPLFVBQVUsTUFBTSxRQUFRLFlBQVksZUFBZTtBQUFBLElBQUc7QUFDckssV0FBTyxFQUFFLE9BQU8sT0FBTyxNQUFNLGFBQWEsS0FBSyxhQUFhLGNBQWMsUUFBUSxvQkFBb0I7QUFBQSxFQUN4RztBQUdPLFdBQVMsbUJBQW1CLFNBQWlCLFlBQXdCLE9BQW1DO0FBQzdHLFVBQU0sSUFBSSxTQUFTLEtBQUs7QUFBRyxVQUFNLElBQUksWUFBWSxHQUFHLFNBQVMsVUFBVTtBQUFHLGNBQVUsR0FBRyxLQUFLO0FBQUcsV0FBTztBQUFBLEVBQ3hHOzs7QUN6Q0EsTUFBTSxPQUFtQixDQUFDLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sTUFBTSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssR0FBRyxDQUFDO0FBQ3pFLE1BQU0sT0FBTztBQUFBLElBQ1gsRUFBRSxNQUFNLElBQUksS0FBSyxNQUFNLEtBQUssTUFBTSxJQUFJLENBQUMsTUFBTSxNQUFNLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxNQUFNLE1BQU0sS0FBSyxHQUFHLEVBQUU7QUFBQSxJQUN2RixFQUFFLE1BQU0sSUFBSSxLQUFLLE1BQU0sS0FBSyxLQUFNLElBQUksQ0FBQyxNQUFNLE1BQU0sR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFBLElBQ3BGLEVBQUUsTUFBTSxJQUFJLEtBQUssS0FBTSxLQUFLLE1BQU0sSUFBSSxDQUFDLEdBQUcsTUFBTSxLQUFLLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsRUFDckY7QUFRQSxXQUFTLElBQUksT0FBWSxHQUFXLEdBQVdFLE9BQTZDLFFBQVEsTUFBTTtBQUN4RyxVQUFNLElBQUksSUFBSSxRQUFRLGVBQWUsTUFBTSxFQUFFLE9BQU8sR0FBRyxRQUFRLEVBQUUsR0FBRyxPQUFPLElBQUk7QUFBRyxJQUFBQSxNQUFLLEVBQUUsV0FBVyxDQUFDO0FBQUcsTUFBRSxPQUFPO0FBQUcsTUFBRSxXQUFXO0FBQU8sV0FBTztBQUFBLEVBQ2pKO0FBRUEsaUJBQXNCLFdBQVcsT0FBNkI7QUFDNUQsVUFBTSxPQUFPLElBQUksT0FBTyxJQUFJLElBQUksQ0FBQyxNQUFNO0FBQUUsWUFBTUMsS0FBSSxFQUFFLHFCQUFxQixJQUFJLElBQUksR0FBRyxJQUFJLElBQUksRUFBRTtBQUFHLE1BQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUFHLE1BQUFBLEdBQUUsYUFBYSxLQUFLLHVCQUF1QjtBQUFHLE1BQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUFHLFFBQUUsWUFBWUE7QUFBRyxRQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksRUFBRTtBQUFBLElBQUcsQ0FBQztBQUNoUixVQUFNLFVBQVUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNLElBQUksT0FBTyxLQUFLLElBQUksQ0FBQyxNQUFNO0FBQUUsUUFBRSxPQUFPO0FBQXdCLFFBQUUsWUFBWTtBQUFVLFFBQUUsWUFBWTtBQUFHLFFBQUUsY0FBYztBQUFXLFFBQUUsWUFBWSxNQUFNLElBQUksWUFBWSxNQUFNLElBQUksWUFBWTtBQUFXLFlBQU0sSUFBSSxTQUFJLE9BQU8sQ0FBQztBQUFHLFFBQUUsV0FBVyxHQUFHLElBQUksRUFBRTtBQUFHLFFBQUUsU0FBUyxHQUFHLElBQUksRUFBRTtBQUFBLElBQUcsQ0FBQyxDQUFDO0FBQ3ZULFVBQU0sV0FBVyxDQUFDLEdBQVdBLElBQVcsR0FBVyxJQUFJLE1BQU07QUFBRSxZQUFNLElBQUksSUFBSSxRQUFRLGlCQUFpQixNQUFNLEtBQUs7QUFBRyxRQUFFLGVBQWUsUUFBUSxPQUFPLE1BQU07QUFBRyxRQUFFLGdCQUFnQixJQUFJLFFBQVEsT0FBTyxHQUFHQSxJQUFHLENBQUM7QUFBRyxRQUFFLGtCQUFrQjtBQUFNLFFBQUUsUUFBUTtBQUFHLGFBQU87QUFBQSxJQUFHO0FBQzdQLFVBQU0sSUFBWTtBQUFBLE1BQ2hCO0FBQUEsTUFBTztBQUFBLE1BQU07QUFBQSxNQUFTLE9BQU8sQ0FBQztBQUFBLE1BQUcsU0FBUyxDQUFDLFNBQVMsTUFBTSxLQUFLLE1BQU0sR0FBRyxHQUFHLFNBQVMsTUFBTSxNQUFNLEtBQUssR0FBRyxDQUFDO0FBQUEsTUFBRyxTQUFTLFNBQVMsR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLE1BQ2hKLE9BQU8sU0FBUyxNQUFNLE1BQU0sTUFBTSxHQUFHO0FBQUEsTUFBRyxTQUFTLENBQUMsU0FBUyxNQUFNLE1BQU0sQ0FBQyxHQUFHLFNBQVMsR0FBRyxLQUFLLEdBQUcsQ0FBQztBQUFBLE1BQUcsVUFBVSxTQUFTLE1BQU0sTUFBTSxDQUFDO0FBQUEsSUFDckk7QUFDQSxVQUFNLE9BQTJFO0FBQUEsTUFDL0UsQ0FBQyxXQUFXLHdCQUF3Qiw4QkFBOEIsRUFBRSxNQUFNLFFBQVEsS0FBSyxPQUFPLFFBQVEsVUFBVSxPQUFPLFNBQVMsT0FBTyxTQUFTLE9BQU8sUUFBUSxHQUFHLE1BQU0sQ0FBRztBQUFBLE1BQzNLLENBQUMsVUFBVSxzQkFBc0IsNEJBQTRCLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFNBQVMsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLE9BQU8sR0FBRyxNQUFNLENBQUc7QUFBQSxJQUN0SztBQUNBLFVBQU0sUUFBUSxJQUFJLEtBQUssSUFBSSxPQUFPLENBQUMsTUFBTSxLQUFLLE9BQU8sT0FBTyxLQUFLLEtBQUssTUFBTTtBQUMxRSxZQUFNLFlBQVksTUFBTSxRQUFRLFlBQVksd0JBQXdCLFdBQVcsS0FBSyxLQUFLO0FBQ3pGLFFBQUUsTUFBTSxJQUFJLElBQUksRUFBRSxXQUFXLFVBQVUsSUFBSSxRQUFRLFFBQVEsWUFBWSxPQUFPLE9BQU8sT0FBTyxLQUFLLEdBQUcsT0FBTyxVQUFVLENBQUMsR0FBRyxLQUFLLE1BQU07QUFBQSxJQUN0SSxDQUFDLENBQUM7QUFDRixXQUFPO0FBQUEsRUFDVDtBQUdBLE1BQU0sT0FBTixNQUFXO0FBQUEsSUFFVCxZQUFvQixHQUFtQixRQUFxQixLQUFxQixRQUFnQjtBQUE3RTtBQUFtQjtBQUFxQjtBQUFxQjtBQURqRiwwQkFBUSxNQUFVO0FBQU0sMEJBQVEsUUFBWTtBQUFNLDBCQUFRO0FBQVksMEJBQVE7QUFBWSwwQkFBUTtBQUFXLDBCQUFRO0FBQVUsMEJBQVE7QUFBVSwwQkFBUTtBQUFZLDBCQUFRO0FBRTNLLFlBQU0sSUFBSSxFQUFFO0FBQ1osV0FBSyxPQUFPLFFBQVEsWUFBWSxXQUFXLFFBQVEsRUFBRSxRQUFRLEtBQUssSUFBSSxLQUFLLFNBQVMsSUFBSSxHQUFHLGNBQWMsR0FBRyxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxJQUFJLEtBQUssS0FBSztBQUFHLFdBQUssS0FBSyxTQUFTLElBQUk7QUFBTSxXQUFLLEtBQUssU0FBUztBQUFRLFdBQUssS0FBSyxhQUFhO0FBQ3RPLFdBQUssUUFBUSxJQUFJLFFBQVEsY0FBYyxTQUFTLENBQUM7QUFBRyxXQUFLLE1BQU0sU0FBUztBQUFRLFdBQUssTUFBTSxTQUFTLElBQUksTUFBTTtBQUFNLFdBQUssTUFBTSxnQkFBZ0IsUUFBUSxLQUFLO0FBQzVKLFdBQUssUUFBUSxRQUFRLFlBQVksWUFBWSxTQUFTLEVBQUUsT0FBTyxLQUFLLFFBQVEsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFLLE1BQU0sU0FBUyxLQUFLO0FBQU8sV0FBSyxNQUFNLFNBQVMsSUFBSTtBQUFNLFdBQUssTUFBTSxhQUFhO0FBQzlLLFlBQU0sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sQ0FBQztBQUFHLFNBQUcsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQUcsU0FBRyxrQkFBa0I7QUFBTSxTQUFHLDZCQUE2QjtBQUFNLFdBQUssTUFBTSxXQUFXO0FBQUksTUFBQyxLQUFLLE1BQWMsTUFBTTtBQUNsTixZQUFNLEtBQUssUUFBUSxZQUFZLFlBQVksTUFBTSxFQUFFLE9BQU8sS0FBSyxRQUFRLE1BQU0sR0FBRyxDQUFDO0FBQUcsU0FBRyxTQUFTLEtBQUs7QUFBTyxTQUFHLFdBQVcsRUFBRTtBQUFPLFNBQUcsYUFBYTtBQUFPLFdBQUssTUFBTTtBQUNySyxXQUFLLE9BQU8sUUFBUSxZQUFZLFlBQVksUUFBUSxFQUFFLE9BQU8sTUFBTSxRQUFRLEtBQUssR0FBRyxDQUFDO0FBQUcsV0FBSyxLQUFLLFNBQVMsS0FBSztBQUFPLFdBQUssS0FBSyxTQUFTLElBQUk7QUFBUSxXQUFLLEtBQUssYUFBYTtBQUM1SyxXQUFLLE1BQU0sUUFBUSxZQUFZLFlBQVksT0FBTyxFQUFFLE9BQU8sS0FBSyxRQUFRLEtBQUssR0FBRyxDQUFDO0FBQUcsV0FBSyxJQUFJLFNBQVMsS0FBSztBQUFPLFdBQUssSUFBSSxTQUFTLElBQUk7QUFBTyxXQUFLLElBQUksV0FBVyxFQUFFO0FBQU8sV0FBSyxJQUFJLGFBQWE7QUFDbE0sV0FBSyxRQUFRLFFBQVEsWUFBWSxZQUFZLFNBQVMsRUFBRSxPQUFPLE1BQU0sUUFBUSxLQUFLLEdBQUcsQ0FBQztBQUFHLFdBQUssTUFBTSxTQUFTLEtBQUs7QUFBTyxXQUFLLE1BQU0sU0FBUyxJQUFJLEdBQUcsT0FBTyxLQUFNO0FBQUcsV0FBSyxNQUFNLFdBQVcsRUFBRTtBQUFVLFdBQUssTUFBTSxhQUFhO0FBQzlOLFdBQUssSUFBSSxXQUFXLEtBQUs7QUFBRyxXQUFLLEtBQUssV0FBVyxLQUFLO0FBQUcsV0FBSyxJQUFJLFdBQVcsS0FBSztBQUFHLFdBQUssTUFBTSxXQUFXLEtBQUs7QUFBQSxJQUNsSDtBQUFBLElBQ0EsSUFBSSxNQUFhLE1BQWM7QUFDN0IsWUFBTSxJQUFJLEtBQUssRUFBRSxPQUFPLE1BQU0sS0FBSyxPQUFPLENBQUM7QUFDM0MsTUFBQyxLQUFLLE1BQWMsSUFBSSxpQkFBaUIsS0FBSyxFQUFFLFFBQVEsT0FBTyxDQUFDO0FBQ2hFLFdBQUssS0FBSyxXQUFXLEtBQUssRUFBRSxRQUFRLElBQUk7QUFBRyxXQUFLLEtBQUssV0FBVyxLQUFLLEVBQUUsUUFBUSxJQUFJO0FBQ25GLFVBQUksU0FBUyxHQUFHO0FBQ2QsWUFBSSxDQUFDLEtBQUssSUFBSTtBQUNaLGdCQUFNLEtBQUssSUFBSSxRQUFRLGVBQWUsUUFBUSxJQUFJLENBQUM7QUFBRyxhQUFHLGtCQUFrQixLQUFLLEVBQUU7QUFBTSxhQUFHLFVBQVUsS0FBSztBQUFRLGFBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxNQUFNLEdBQUcsSUFBSTtBQUFHLGFBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxLQUFLLEtBQUssTUFBTSxLQUFLLEdBQUc7QUFDbE8sYUFBRyxjQUFjO0FBQUssYUFBRyxjQUFjO0FBQUssYUFBRyxhQUFhLElBQUksUUFBUSxRQUFRLE9BQU8sS0FBSyxLQUFLO0FBQUcsYUFBRyxhQUFhLElBQUksUUFBUSxRQUFRLE1BQU0sS0FBSyxJQUFJO0FBQ3ZKLGFBQUcsZUFBZTtBQUFNLGFBQUcsZUFBZTtBQUFLLGFBQUcsVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssQ0FBQztBQUFHLGFBQUcsWUFBWSxRQUFRLGVBQWU7QUFBZSxlQUFLLEtBQUs7QUFBQSxRQUM3SjtBQUNBLGNBQU0sSUFBSSxLQUFLO0FBQUksVUFBRSxXQUFXLElBQUk7QUFBTSxVQUFFLFVBQVUsSUFBSTtBQUFLLFVBQUUsVUFBVSxJQUFJO0FBQUssVUFBRSxTQUFTLElBQUksUUFBUSxPQUFPLEdBQUcsSUFBSSxFQUFFO0FBQUcsVUFBRSxTQUFTLElBQUksUUFBUSxPQUFPLEdBQUcsSUFBSSxFQUFFO0FBQUcsVUFBRSxZQUFZLElBQUksUUFBUSxPQUFPLEtBQUssR0FBRyxLQUFLLENBQUM7QUFDdk4sWUFBSSxDQUFDLEVBQUUsVUFBVSxFQUFHLEdBQUUsTUFBTTtBQUFBLE1BQzlCLFdBQVcsS0FBSyxNQUFNLEtBQUssR0FBRyxVQUFVLEVBQUcsTUFBSyxHQUFHLEtBQUs7QUFDeEQsVUFBSSxRQUFRLEdBQUc7QUFDYixZQUFJLENBQUMsS0FBSyxNQUFNO0FBQUUsZUFBSyxPQUFPLFFBQVEsWUFBWSxZQUFZLFFBQVEsRUFBRSxVQUFVLE1BQU0sV0FBVyxNQUFNLGNBQWMsR0FBRyxHQUFHLENBQUM7QUFBRyxlQUFLLEtBQUssU0FBUyxLQUFLO0FBQVEsZUFBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLE1BQU07QUFBTSxlQUFLLEtBQUssV0FBVyxLQUFLLEVBQUU7QUFBUyxlQUFLLEtBQUssYUFBYTtBQUFBLFFBQU87QUFDNVEsYUFBSyxLQUFLLFdBQVcsSUFBSTtBQUFBLE1BQzNCLFdBQVcsS0FBSyxLQUFNLE1BQUssS0FBSyxXQUFXLEtBQUs7QUFBQSxJQUNsRDtBQUFBLElBQ0EsTUFBTSxHQUFrQjtBQUN0QixZQUFNLEtBQUssTUFBTTtBQUFNLFdBQUssSUFBSSxXQUFXLEVBQUU7QUFBRyxXQUFLLEtBQUssV0FBVyxFQUFFO0FBQ3ZFLFVBQUksSUFBSTtBQUFFLGNBQU0sSUFBSSxLQUFLLElBQUksTUFBTyxDQUFXO0FBQUcsYUFBSyxLQUFLLFFBQVEsSUFBSTtBQUFHLGFBQUssS0FBSyxTQUFTLElBQUksRUFBRSxRQUFRLElBQUksTUFBTTtBQUFBLE1BQUc7QUFBQSxJQUMzSDtBQUFBLElBQ0EsUUFBUSxHQUFrQjtBQUN4QixZQUFNLEtBQUssTUFBTTtBQUFNLFdBQUssSUFBSSxXQUFXLEVBQUU7QUFBRyxXQUFLLE1BQU0sV0FBVyxFQUFFO0FBQ3hFLFVBQUksSUFBSTtBQUFFLGNBQU0sSUFBSSxLQUFLLElBQUksTUFBTyxDQUFXO0FBQUcsYUFBSyxNQUFNLFFBQVEsSUFBSTtBQUFHLGFBQUssTUFBTSxTQUFTLElBQUksRUFBRSxRQUFRLElBQUksTUFBTTtBQUFBLE1BQUc7QUFBQSxJQUM3SDtBQUFBLElBQ0EsUUFBUSxJQUFhO0FBQUUsVUFBSSxLQUFLLElBQUk7QUFBRSxZQUFJLE1BQU0sQ0FBQyxLQUFLLEdBQUcsVUFBVSxFQUFHLE1BQUssR0FBRyxNQUFNO0FBQUcsWUFBSSxDQUFDLE1BQU0sS0FBSyxHQUFHLFVBQVUsRUFBRyxNQUFLLEdBQUcsS0FBSztBQUFBLE1BQUc7QUFBQSxJQUFFO0FBQUEsSUFDekksT0FBTyxJQUFZO0FBQUUsVUFBSSxLQUFLLFFBQVEsS0FBSyxLQUFLLFVBQVUsRUFBRyxNQUFLLEtBQUssU0FBUyxLQUFLLEtBQUs7QUFBQSxJQUFLO0FBQUEsSUFDL0YsVUFBVTtBQUFFLFVBQUksS0FBSyxJQUFJO0FBQUUsYUFBSyxHQUFHLEtBQUs7QUFBRyxhQUFLLEdBQUcsUUFBUTtBQUFBLE1BQUc7QUFBRSxPQUFDLEtBQUssTUFBTSxLQUFLLE1BQU0sS0FBSyxPQUFPLEtBQUssS0FBSyxLQUFLLE1BQU0sS0FBSyxLQUFLLEtBQUssS0FBSyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEtBQUssRUFBRSxRQUFRLENBQUM7QUFBRyxXQUFLLE1BQU0sUUFBUTtBQUFBLElBQUc7QUFBQSxFQUN4TTtBQUdBLE1BQU0sY0FBTixNQUF3QztBQUFBLElBR3RDLFlBQW9CLEdBQW1CLEtBQWUsTUFBYyxNQUFhLE1BQWM7QUFBM0U7QUFBbUI7QUFGdkM7QUFBYTtBQUFhLGtDQUFPO0FBQUcsbUNBQWdCO0FBQVE7QUFDNUQsMEJBQVE7QUFBVSwwQkFBUTtBQUFXLDBCQUFRLFNBQTZCLENBQUM7QUFBRywwQkFBUSxPQUFXO0FBQU0sMEJBQVE7QUFBWSwwQkFBUTtBQUFXLDBCQUFRLFVBQVM7QUFBRywwQkFBUTtBQUV4SyxZQUFNLElBQUksRUFBRSxPQUFPLE1BQU0sS0FBSyxPQUFPLEVBQUUsU0FBUyxFQUFFLEVBQUUsTUFBTSxHQUFHLENBQUM7QUFDOUQsV0FBSyxNQUFNLElBQUksVUFBVSx5QkFBeUIsQ0FBQyxNQUFjLElBQUksTUFBTSxLQUFLLE9BQU8sRUFBRSxrQkFBa0IsS0FBSyxDQUFDO0FBQ2pILFdBQUssU0FBUyxJQUFJLFFBQVEsY0FBYyxVQUFVLEtBQUssQ0FBQztBQUFHLFdBQUssSUFBSSxVQUFVLENBQUMsRUFBRSxTQUFTLEtBQUs7QUFDL0YsV0FBSyxPQUFPLEtBQUssSUFBSSxVQUFVLENBQUMsRUFBRSxlQUFlLEVBQUUsS0FBSyxDQUFDLE1BQVcsRUFBRSxLQUFLLFNBQVMsT0FBTyxDQUFDO0FBQzVGLFVBQUksQ0FBQyxJQUFJLFFBQVMsS0FBSSxVQUFVLEtBQUssS0FBSztBQUMxQyxXQUFLLElBQUksZ0JBQWdCLFFBQVEsQ0FBQ0EsT0FBVztBQUFFLFFBQUFBLEdBQUUsS0FBSztBQUFHLFFBQUFBLEdBQUUsaUJBQWlCO0FBQU0sUUFBQUEsR0FBRSxnQkFBZ0I7QUFBTSxhQUFLLE1BQU1BLEdBQUUsS0FBSyxNQUFNLEdBQUcsRUFBRSxDQUFDLENBQUMsSUFBSUE7QUFBQSxNQUFHLENBQUM7QUFDakosV0FBSyxJQUFJLFVBQVUsQ0FBQyxFQUFFLGVBQWUsRUFBRSxRQUFRLENBQUMsTUFBVztBQUFFLFVBQUUsMkJBQTJCO0FBQU0sVUFBRSxhQUFhO0FBQUEsTUFBTyxDQUFDO0FBQ3ZILFdBQUssTUFBTSxJQUFJO0FBQUssV0FBSyxPQUFPLElBQUk7QUFBTyxXQUFLLE9BQU87QUFDdkQsV0FBSyxPQUFPLElBQUksS0FBSyxHQUFHLEtBQUssUUFBUSxLQUFLLEtBQUssR0FBRztBQUNsRCxXQUFLLE9BQU8sUUFBUSxZQUFZLGVBQWUsUUFBUSxFQUFFLFFBQVEsS0FBSyxVQUFVLElBQUksR0FBRyxDQUFDO0FBQUcsV0FBSyxLQUFLLFNBQVMsS0FBSztBQUFRLFdBQUssS0FBSyxTQUFTLElBQUk7QUFBSyxXQUFLLEtBQUssYUFBYTtBQUFPLFdBQUssS0FBSyxhQUFhO0FBQzVNLFdBQUssUUFBUSxJQUFJO0FBQUcsV0FBSyxRQUFRLElBQUk7QUFBRyxXQUFLLEtBQUssV0FBVyxFQUFFLE1BQU0sUUFBUSxRQUFRLEtBQUs7QUFBQSxJQUM1RjtBQUFBLElBQ1EsV0FBVztBQUNqQixZQUFNLE1BQU0sS0FBSyxPQUFPLE1BQU0sS0FBSyxNQUFNLElBQUksS0FBSztBQUNsRCxVQUFJLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFFLGNBQU0sSUFBSSxFQUFFLFFBQVEsTUFBTSxPQUFPLEdBQUc7QUFBRyxZQUFJLEtBQUssU0FBUyxFQUFHLEdBQUUsZ0JBQWdCLEVBQUU7QUFBVSxjQUFNLElBQUksS0FBSyxLQUFLLE9BQU8sQ0FBQztBQUFHLFVBQUUsY0FBYyxJQUFJLFFBQVEsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztBQUFHLFVBQUUsU0FBUyxHQUFHLElBQUk7QUFBQSxNQUFHO0FBQzVOLFdBQUssS0FBSyxXQUFXLEVBQUUsU0FBUyxHQUFHO0FBQUEsSUFDckM7QUFBQSxJQUNBLFFBQVEsR0FBVTtBQUFFLFdBQUssT0FBTztBQUFHLFdBQUssU0FBUztBQUFHLFdBQUssS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJO0FBQUEsSUFBRztBQUFBLElBQ2pGLFFBQVEsSUFBWTtBQUFFLFdBQUssT0FBTztBQUFJLFdBQUssU0FBUztBQUFHLFdBQUssT0FBTyxRQUFRLE9BQU8sUUFBUSxLQUFLLE1BQU0sS0FBSyxDQUFDLElBQUksS0FBSyxJQUFJO0FBQUcsV0FBSyxLQUFLLElBQUksS0FBSyxNQUFNLEVBQUU7QUFBQSxJQUFHO0FBQUEsSUFDekosTUFBTSxHQUFrQjtBQUFFLFdBQUssS0FBSyxNQUFNLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDOUMsUUFBUSxHQUFrQjtBQUFFLFdBQUssS0FBSyxRQUFRLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDbEQsUUFBUTtBQUFFLFdBQUssU0FBUztBQUFBLElBQU07QUFBQSxJQUM5QixLQUFLLE9BQWUsUUFBUSxHQUFHO0FBQzdCLFlBQU1BLEtBQUksS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLEtBQUssQ0FBQztBQUFHLFVBQUksQ0FBQ0EsR0FBRztBQUFRLFlBQU0sT0FBTyxVQUFVLFVBQVUsVUFBVTtBQUN4RyxVQUFJLFFBQVEsS0FBSyxVQUFVLFNBQVMsS0FBSyxRQUFRQSxHQUFHO0FBQ3BELFVBQUksS0FBSyxJQUFLLE1BQUssSUFBSSxLQUFLO0FBQUcsTUFBQUEsR0FBRSxLQUFLO0FBQUcsTUFBQUEsR0FBRSxNQUFNLE1BQU0sT0FBT0EsR0FBRSxNQUFNQSxHQUFFLEVBQUU7QUFDMUUsVUFBSSxLQUFNLENBQUFBLEdBQUUsVUFBVUEsR0FBRSxPQUFPLEtBQUssT0FBTyxLQUFLQSxHQUFFLEtBQUtBLEdBQUUsS0FBSztBQUM5RCxXQUFLLE1BQU1BO0FBQUcsV0FBSyxRQUFRO0FBQU8sV0FBSyxLQUFLLFFBQVEsVUFBVSxPQUFPO0FBQUEsSUFDdkU7QUFBQSxJQUNBLE9BQU8sSUFBWTtBQUNqQixXQUFLLEtBQUssT0FBTyxFQUFFO0FBQ25CLFVBQUksS0FBSyxTQUFTLEdBQUc7QUFBRSxhQUFLLFVBQVU7QUFBSSxjQUFNLElBQUksSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sSUFBSSxPQUFPLEtBQUssRUFBRTtBQUFHLGFBQUssT0FBTyxRQUFRLE9BQU8sUUFBUSxLQUFLLE1BQU0sS0FBSyxPQUFPLENBQUMsSUFBSSxLQUFLLE9BQU8sQ0FBQztBQUFBLE1BQUc7QUFBQSxJQUNyTTtBQUFBLElBQ0EsVUFBVTtBQUFFLFdBQUssS0FBSyxRQUFRO0FBQUcsV0FBSyxJQUFJLGdCQUFnQixRQUFRLENBQUNBLE9BQVdBLEdBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxJQUFJLFVBQVUsUUFBUSxDQUFDLE1BQVcsRUFBRSxRQUFRLENBQUM7QUFBRyxXQUFLLEtBQUssUUFBUTtBQUFHLFdBQUssSUFBSSxVQUFVLENBQUMsRUFBRSxRQUFRLE9BQU8sS0FBSztBQUFHLFdBQUssT0FBTyxRQUFRO0FBQUEsSUFBRztBQUFBLEVBQzVPO0FBR0EsTUFBTSxLQUF5RztBQUFBLElBQzdHLFFBQVEsRUFBRSxLQUFLLFdBQVcsR0FBRyxNQUFNLEdBQUcsTUFBTSxNQUFNLE1BQU0sUUFBUSxVQUFVLE9BQU8sU0FBUztBQUFBLElBQzFGLFFBQVEsRUFBRSxLQUFLLFdBQVcsR0FBRyxLQUFLLEdBQUcsS0FBSyxNQUFNLE1BQU0sUUFBUSxVQUFVLE9BQU8sU0FBUztBQUFBLElBQ3hGLE1BQU0sRUFBRSxLQUFLLFdBQVcsR0FBRyxNQUFNLEdBQUcsTUFBTSxNQUFNLE1BQU0sUUFBUSxRQUFRLE9BQU8sT0FBTztBQUFBLElBQ3BGLFdBQVcsRUFBRSxLQUFLLFdBQVcsR0FBRyxNQUFNLEdBQUcsTUFBTSxNQUFNLE1BQU0sUUFBUSxPQUFPLE9BQU8sWUFBWTtBQUFBLEVBQy9GO0FBQ0EsTUFBTSxvQkFBTixNQUE4QztBQUFBLElBRzVDLFlBQW9CLEdBQW1CLE1BQWMsTUFBYSxNQUFjO0FBQTVEO0FBQW1CO0FBRnZDO0FBQWE7QUFBYSxrQ0FBTztBQUFHLG1DQUFnQjtBQUFRO0FBQzVELDBCQUFRO0FBQVUsMEJBQVEsUUFBYyxDQUFDO0FBQUcsMEJBQVE7QUFBUywwQkFBUTtBQUFZLDBCQUFRO0FBQVcsMEJBQVEsS0FBSSxLQUFLLE9BQU8sSUFBSTtBQUFHLDBCQUFRLE9BQU07QUFBRywwQkFBUSxPQUFNO0FBQUcsMEJBQVEsUUFBTztBQUFHLDBCQUFRLFVBQVM7QUFBRywwQkFBUSxRQUFjLENBQUM7QUFBRywwQkFBUTtBQUUzTyxZQUFNLElBQUksRUFBRSxPQUFPLElBQUksR0FBRyxJQUFJO0FBQUcsV0FBSyxPQUFPO0FBQzdDLFdBQUssU0FBUyxJQUFJLFFBQVEsY0FBYyxRQUFRLE1BQU0sQ0FBQztBQUFHLFdBQUssTUFBTSxJQUFJLFFBQVEsY0FBYyxPQUFPLENBQUM7QUFBRyxXQUFLLElBQUksU0FBUyxLQUFLO0FBQ2pJLFlBQU0sTUFBTSxDQUFDLEtBQWEsS0FBSyxNQUFNO0FBQUUsY0FBTSxJQUFJLElBQUksUUFBUSxpQkFBaUIsTUFBTSxDQUFDO0FBQUcsVUFBRSxlQUFlLFFBQVEsT0FBTyxjQUFjLEdBQUcsRUFBRSxNQUFNLElBQUk7QUFBRyxVQUFFLGdCQUFnQixJQUFJLFFBQVEsT0FBTyxLQUFLLEtBQUssR0FBRztBQUFHLFlBQUksR0FBSSxHQUFFLGdCQUFnQixFQUFFLGFBQWEsTUFBTSxFQUFFO0FBQUcsZUFBTztBQUFBLE1BQUc7QUFDM1EsWUFBTSxPQUFPLE1BQU0sUUFBUSxPQUFPLEVBQUUsSUFBSTtBQUN4QyxpQkFBVyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUc7QUFBRSxjQUFNLEtBQUssSUFBSSxRQUFRLGNBQWMsT0FBTyxDQUFDO0FBQUcsV0FBRyxTQUFTLEtBQUs7QUFBSyxXQUFHLFNBQVMsSUFBSSxLQUFLLEVBQUUsSUFBSSxNQUFNLE1BQU0sQ0FBQztBQUFHLGNBQU0sSUFBSSxRQUFRLFlBQVksZUFBZSxLQUFLLEVBQUUsUUFBUSxNQUFNLFVBQVUsRUFBRSxJQUFJLEtBQUssR0FBRyxDQUFDO0FBQUcsVUFBRSxTQUFTO0FBQUksVUFBRSxTQUFTLElBQUksQ0FBQyxPQUFPO0FBQUcsVUFBRSxXQUFXLElBQUksU0FBUztBQUFHLFVBQUUsYUFBYTtBQUFPLGFBQUssS0FBSyxLQUFLLEVBQUU7QUFBQSxNQUFHO0FBQzNWLFdBQUssT0FBTyxRQUFRLFlBQVksY0FBYyxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksR0FBRyxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksSUFBSSxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxLQUFLO0FBQUssV0FBSyxLQUFLLFNBQVMsSUFBSTtBQUFPLFdBQUssS0FBSyxXQUFXLElBQUksRUFBRSxHQUFHO0FBQUcsV0FBSyxLQUFLLGFBQWE7QUFDM04sWUFBTSxPQUFPLFFBQVEsWUFBWSxhQUFhLFFBQVEsRUFBRSxVQUFVLEVBQUUsT0FBTyxLQUFLLFVBQVUsR0FBRyxHQUFHLENBQUM7QUFBRyxXQUFLLFNBQVMsS0FBSztBQUFLLFdBQUssU0FBUyxJQUFJLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTztBQUFNLFdBQUssV0FBVyxJQUFJLEVBQUUsR0FBRztBQUFHLFdBQUssYUFBYTtBQUN4TixZQUFNLE9BQU8sSUFBSSxRQUFRLGlCQUFpQixPQUFPLENBQUM7QUFBRyxXQUFLLGVBQWUsUUFBUSxPQUFPLE1BQU07QUFBRyxXQUFLLGdCQUFnQixTQUFTLElBQUksSUFBSSxRQUFRLE9BQU8sTUFBTSxNQUFNLENBQUMsSUFBSSxJQUFJLFFBQVEsT0FBTyxHQUFHLE1BQU0sSUFBSTtBQUFHLE1BQUMsS0FBYSxPQUFPO0FBQy9OLGlCQUFXLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRztBQUFFLGNBQU0sSUFBSSxRQUFRLFlBQVksYUFBYSxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU8sSUFBSSxHQUFHLENBQUM7QUFBRyxVQUFFLFNBQVMsS0FBSztBQUFLLFVBQUUsU0FBUyxJQUFJLEtBQUssRUFBRSxPQUFPLEtBQUssS0FBSyxTQUFTLElBQUksTUFBTSxFQUFFLE9BQU8sSUFBSTtBQUFHLFVBQUUsV0FBVztBQUFNLFVBQUUsYUFBYTtBQUFBLE1BQU87QUFFcFAsV0FBSyxLQUFLLElBQUksUUFBUSxjQUFjLE1BQU0sQ0FBQztBQUFHLFdBQUssR0FBRyxTQUFTLEtBQUs7QUFBSyxXQUFLLEdBQUcsU0FBUyxJQUFJLEVBQUUsSUFBSSxLQUFLLE9BQU8sRUFBRSxJQUFJLE1BQU0sSUFBSTtBQUNoSSxZQUFNLEtBQUssSUFBSSxTQUFTLEdBQUcsT0FBTyxJQUFJLFNBQVM7QUFDL0MsWUFBTSxLQUFLLENBQUMsR0FBUSxNQUFjLE1BQVcsS0FBZSxPQUFZO0FBQUUsY0FBTSxJQUFJLFNBQVMsUUFBUSxRQUFRLFlBQVksVUFBVSxLQUFLLE1BQU0sQ0FBQyxJQUFJLFNBQVMsUUFBUSxRQUFRLFlBQVksZUFBZSxLQUFLLE1BQU0sQ0FBQyxJQUFJLFFBQVEsWUFBWSxhQUFhLEtBQUssTUFBTSxDQUFDO0FBQUcsVUFBRSxTQUFTLEtBQUs7QUFBSSxVQUFFLFNBQVMsSUFBSSxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztBQUFHLFVBQUUsV0FBVztBQUFJLFVBQUUsYUFBYTtBQUFPLGVBQU87QUFBQSxNQUFHO0FBQ3BYLFVBQUksRUFBRSxXQUFXLFNBQVUsSUFBRyxHQUFHLE9BQU8sRUFBRSxPQUFPLE1BQU0sUUFBUSxLQUFLLE9BQU8sS0FBSyxHQUFHLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxJQUFJO0FBQ3hHLFVBQUksRUFBRSxXQUFXLFVBQVU7QUFBRSxXQUFHLEdBQUcsT0FBTyxFQUFFLE9BQU8sTUFBTSxRQUFRLEtBQUssT0FBTyxLQUFLLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLElBQUk7QUFBRyxjQUFNLEtBQUssUUFBUSxZQUFZLGVBQWUsTUFBTSxFQUFFLFFBQVEsTUFBTSxVQUFVLEtBQUssR0FBRyxDQUFDO0FBQUcsV0FBRyxTQUFTLEtBQUs7QUFBSyxXQUFHLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxXQUFHLFNBQVMsSUFBSSxDQUFDLEVBQUUsSUFBSSxLQUFLLE9BQU8sRUFBRSxJQUFJLEtBQUssSUFBSTtBQUFHLFdBQUcsV0FBVyxJQUFJLFNBQVM7QUFBRyxXQUFHLGFBQWE7QUFBQSxNQUFPO0FBQ3BXLFVBQUksRUFBRSxXQUFXLFFBQVE7QUFBRSxXQUFHLEdBQUcsT0FBTyxFQUFFLFFBQVEsS0FBSyxVQUFVLEtBQUssR0FBRyxDQUFDLEdBQUcsT0FBTyxHQUFHLEdBQUcsRUFBRTtBQUFHLFdBQUcsR0FBRyxPQUFPLEVBQUUsVUFBVSxJQUFJLEdBQUcsQ0FBQyxHQUFHLE9BQU8sR0FBRyxHQUFHLElBQUk7QUFBQSxNQUFHO0FBQ3ZKLFVBQUksRUFBRSxXQUFXLE9BQU87QUFBRSxXQUFHLEdBQUcsT0FBTyxFQUFFLFFBQVEsS0FBSyxVQUFVLEtBQUssR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsRUFBRTtBQUFHLFdBQUcsR0FBRyxPQUFPLEVBQUUsT0FBTyxNQUFNLFFBQVEsTUFBTSxPQUFPLEtBQUssR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsSUFBSTtBQUFHLGNBQU0sT0FBTyxRQUFRLFlBQVksZUFBZSxRQUFRLEVBQUUsUUFBUSxLQUFLLGFBQWEsR0FBRyxnQkFBZ0IsRUFBRSxPQUFPLElBQUksR0FBRyxDQUFDO0FBQUcsYUFBSyxTQUFTLEtBQUs7QUFBSyxhQUFLLFNBQVMsSUFBSSxLQUFLLFNBQVMsSUFBSSxFQUFFLE9BQU87QUFBTSxhQUFLLFdBQVcsSUFBSSxTQUFTO0FBQUcsYUFBSyxhQUFhO0FBQUEsTUFBTztBQUM5YSxXQUFLLE1BQU0sT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPO0FBQU0sV0FBSyxPQUFPLElBQUksS0FBSyxHQUFHLEtBQUssUUFBUSxLQUFLLEtBQUssRUFBRSxJQUFJLEdBQUc7QUFDL0YsWUFBTSxNQUFNLElBQUksR0FBRyxLQUFLLElBQUksQ0FBQyxNQUFNO0FBQUUsVUFBRSxPQUFPO0FBQXdCLFVBQUUsWUFBWTtBQUFVLFVBQUUsWUFBWTtBQUFXLFVBQUUsY0FBYztBQUFRLFVBQUUsWUFBWTtBQUFHLFVBQUUsV0FBVyxFQUFFLFFBQVEsZUFBZSxLQUFLLEVBQUU7QUFBRyxVQUFFLFNBQVMsRUFBRSxRQUFRLGVBQWUsS0FBSyxFQUFFO0FBQUEsTUFBRyxDQUFDO0FBQy9QLFlBQU0sS0FBSyxRQUFRLFlBQVksWUFBWSxPQUFPLEVBQUUsT0FBTyxLQUFLLFFBQVEsSUFBSSxHQUFHLENBQUM7QUFBRyxTQUFHLFNBQVMsS0FBSztBQUFRLFNBQUcsU0FBUyxJQUFJO0FBQU0sU0FBRyxTQUFTLElBQUksS0FBSyxLQUFLLElBQUk7QUFBSyxTQUFHLGdCQUFnQixRQUFRLEtBQUs7QUFBbUIsWUFBTSxLQUFLLElBQUksUUFBUSxpQkFBaUIsTUFBTSxDQUFDO0FBQUcsU0FBRyxpQkFBaUI7QUFBSyxTQUFHLGdCQUFnQixRQUFRLE9BQU8sTUFBTTtBQUFHLFNBQUcsa0JBQWtCO0FBQU0sU0FBRyw2QkFBNkI7QUFBTSxTQUFHLFdBQVc7QUFBSSxTQUFHLGFBQWE7QUFBTyxTQUFHLFNBQVMsSUFBSSxLQUFLLE1BQU07QUFDbmQsV0FBSyxPQUFPLFFBQVEsWUFBWSxlQUFlLFFBQVEsRUFBRSxRQUFRLEtBQUssS0FBSyxVQUFVLEtBQUssSUFBSSxLQUFLLEVBQUUsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDO0FBQUcsV0FBSyxLQUFLLFNBQVMsS0FBSztBQUFRLFdBQUssS0FBSyxTQUFTLElBQUksS0FBSyxNQUFNO0FBQUcsV0FBSyxLQUFLLGFBQWE7QUFBTyxXQUFLLEtBQUssV0FBVyxFQUFFLE1BQU0sUUFBUSxRQUFRLEtBQUs7QUFDMVEsTUFBQyxLQUFhLFFBQVEsQ0FBQyxFQUFFO0FBQUcsV0FBSyxRQUFRLElBQUk7QUFBRyxXQUFLLFFBQVEsSUFBSTtBQUFHLFdBQUssS0FBSyxNQUFNO0FBQUEsSUFDdEY7QUFBQSxJQUNBLFFBQVEsR0FBVTtBQUFFLFdBQUssT0FBTztBQUFHLE1BQUMsS0FBYSxLQUFLLGdCQUFnQixNQUFNLElBQUksSUFBSSxRQUFRLE9BQU8sTUFBTSxNQUFNLENBQUMsSUFBSSxJQUFJLFFBQVEsT0FBTyxHQUFHLE1BQU0sSUFBSTtBQUFHLFdBQUssS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJO0FBQUEsSUFBRztBQUFBLElBQ3BMLFFBQVEsSUFBWTtBQUFFLFdBQUssT0FBTztBQUFJLFdBQUssT0FBTyxRQUFRLEtBQUssTUFBTSxLQUFLLENBQUM7QUFBRyxZQUFNLElBQUksS0FBSyxLQUFLLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxlQUFlLFFBQVEsT0FBTyxjQUFjLEdBQUcsS0FBSyxJQUFJLEVBQUUsR0FBRyxFQUFFLE1BQU0sSUFBSSxFQUFFLFNBQVMsSUFBSSxRQUFRLE9BQU8sS0FBSyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUFHLFdBQUssT0FBTyxRQUFRLE9BQU8sS0FBSyxJQUFJO0FBQUcsV0FBSyxLQUFLLElBQUksS0FBSyxNQUFNLEVBQUU7QUFBQSxJQUFHO0FBQUEsSUFDaFcsTUFBTSxHQUFrQjtBQUFFLFdBQUssS0FBSyxNQUFNLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDOUMsUUFBUSxHQUFrQjtBQUFFLFdBQUssS0FBSyxRQUFRLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDbEQsUUFBUTtBQUFFLFdBQUssU0FBUztBQUFBLElBQU07QUFBQSxJQUM5QixLQUFLLE9BQWUsUUFBUSxHQUFHO0FBQUUsVUFBSSxVQUFVLEtBQUssVUFBVSxVQUFVLFVBQVUsVUFBVSxPQUFRO0FBQVEsV0FBSyxRQUFRO0FBQU8sV0FBSyxNQUFNLEtBQUs7QUFBRyxXQUFLLE1BQU0sVUFBVSxXQUFZLFFBQVEsTUFBTSxLQUFLLElBQWMsRUFBRSxVQUFVLFFBQVMsVUFBVSxVQUFVLE1BQU0sVUFBVSxVQUFVLE1BQU07QUFBSyxXQUFLLEtBQUssUUFBUSxVQUFVLE9BQU87QUFBQSxJQUFHO0FBQUEsSUFDelUsT0FBTyxJQUFZO0FBQ2pCLFdBQUssS0FBSztBQUFJLFdBQUssS0FBSyxPQUFPLEVBQUU7QUFBRyxZQUFNLElBQUksS0FBSyxJQUFJLElBQUksS0FBSyxJQUFJLEtBQUssT0FBTyxLQUFLLEdBQUcsR0FBRyxJQUFJLEtBQUssS0FBSyxJQUFJLEtBQUs7QUFDbEgsUUFBRSxTQUFTLElBQUksR0FBRyxHQUFHLENBQUM7QUFBRyxRQUFFLFNBQVMsSUFBSSxHQUFHLEdBQUcsQ0FBQztBQUFHLFFBQUUsUUFBUSxPQUFPLENBQUM7QUFBRyxRQUFFLFNBQVMsSUFBSTtBQUFNLFdBQUssS0FBSyxRQUFRLENBQUMsTUFBTyxFQUFFLFNBQVMsSUFBSSxDQUFFO0FBQ3ZJLFVBQUksS0FBSyxVQUFVLE9BQVEsR0FBRSxTQUFTLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxHQUFHLElBQUk7QUFBQSxlQUMxRCxLQUFLLFVBQVUsT0FBTztBQUFFLGNBQU0sSUFBSSxLQUFLLElBQUk7QUFBSSxVQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLENBQUMsQ0FBQyxJQUFJO0FBQU0sVUFBRSxTQUFTLElBQUk7QUFBSyxhQUFLLEtBQUssQ0FBQyxFQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksQ0FBQyxJQUFJO0FBQUssYUFBSyxLQUFLLENBQUMsRUFBRSxTQUFTLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJO0FBQUssVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksQ0FBQyxJQUFJO0FBQUEsTUFBSyxXQUNwUCxLQUFLLFVBQVUsVUFBVTtBQUFFLGNBQU0sSUFBSSxJQUFJLE1BQU0sUUFBUSxJQUFJLE9BQU8sT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksT0FBTyxJQUFJO0FBQUcsVUFBRSxTQUFTLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLEtBQUssQ0FBQztBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUEsTUFBRyxXQUMxTixLQUFLLFVBQVUsU0FBUztBQUFFLGNBQU0sSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJO0FBQUksVUFBRSxRQUFRLE9BQU8sT0FBTyxPQUFPLENBQUM7QUFBRyxVQUFFLFNBQVMsS0FBSyxJQUFJLEtBQUs7QUFBQSxNQUFLLFdBQzFILEtBQUssVUFBVSxTQUFTO0FBQUUsY0FBTSxJQUFJLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSSxDQUFDLEtBQUssS0FBSyxJQUFJO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTztBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU87QUFBQSxNQUFHLFdBQzlILEtBQUssVUFBVSxTQUFTO0FBQUUsVUFBRSxTQUFTLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDLElBQUk7QUFBTSxVQUFFLFNBQVMsSUFBSTtBQUFBLE1BQU07QUFDOUcsVUFBSSxLQUFLLFNBQVMsR0FBRztBQUFFLGFBQUssVUFBVTtBQUFJLGNBQU0sSUFBSSxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxJQUFJLE9BQU8sS0FBSyxFQUFFO0FBQUcsYUFBSyxPQUFPLFFBQVEsT0FBTyxLQUFLLE9BQU8sQ0FBQztBQUFBLE1BQUc7QUFBQSxJQUNqSztBQUFBLElBQ0EsVUFBVTtBQUFFLFdBQUssS0FBSyxRQUFRO0FBQUcsV0FBSyxPQUFPLGVBQWUsRUFBRSxRQUFRLENBQUMsTUFBVyxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssT0FBTyxRQUFRO0FBQUEsSUFBRztBQUFBLEVBQ3pIO0FBRU8sV0FBUyxhQUFhLEdBQVcsTUFBYyxNQUFhLE1BQTBCO0FBQzNGLFVBQU0sTUFBTSxFQUFFLE1BQU0sSUFBSTtBQUN4QixXQUFPLE1BQU0sSUFBSSxZQUFZLEdBQUcsS0FBSyxNQUFNLE1BQU0sSUFBSSxJQUFJLElBQUksa0JBQWtCLEdBQUcsTUFBTSxNQUFNLElBQUk7QUFBQSxFQUNwRzs7O0FDOUxPLE1BQU0sVUFBVSxDQUFDLE1BQXdCLGtCQUFrQixJQUFJO0FBRS9ELE1BQU0sVUFBVSxDQUFDLEdBQWEsTUFBTSxTQUFpQixlQUFlLEdBQUcsVUFBVSxRQUFRLENBQUMsQ0FBQztBQUczRixNQUFNLFlBQXNDLEVBQUUsU0FBUyxXQUFXLFFBQVEsVUFBVSxRQUFRLFVBQVUsUUFBUSxVQUFVLE1BQU0sUUFBUSxXQUFXLFlBQVk7QUFJN0osTUFBTSxZQUFZLENBQUMsR0FBVyxNQUFNLFNBQWlCLFFBQVEsU0FBUyxHQUFHLEVBQUUsT0FBTyxLQUFLLElBQUksR0FBRyxDQUFDLENBQUM7QUFDaEcsTUFBTSxhQUFhLENBQUMsUUFBZ0IsTUFBTSxNQUFjLFFBQVEsU0FBUyxVQUFVLEVBQUUsT0FBTyxLQUFLLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxRQUFRLGVBQWUsVUFBVSxFQUFFLE9BQU8sS0FBSyxJQUFJLEdBQUcsTUFBTSxNQUFNLENBQUM7OztBQ2Y3TCxNQUFNLE9BQU8sT0FBTyxZQUFZLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLFFBQVEsVUFBVSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNsRixNQUFNLElBQUksQ0FBQyxPQUFlLFNBQVMsZUFBZSxFQUFFO0FBQ3BELE1BQU0sUUFBUSxDQUFDLE1BQWMsU0FBSSxPQUFPLENBQUM7QUFFbEMsTUFBTSxLQUFOLE1BQVM7QUFBQSxJQUVkLFlBQW9CQyxJQUFRO0FBQVIsK0JBQUFBO0FBRHBCLDBCQUFRLFVBQVM7QUFBRywwQkFBUTtBQUFrQiwwQkFBUSxRQUFPO0FBRTNELFFBQUUsU0FBUyxFQUFFLFVBQVUsTUFBTSxPQUFPLGNBQWMsSUFBSSxNQUFNLGVBQWUsQ0FBQztBQUM1RSxRQUFFLFdBQVcsRUFBRSxVQUFVLE1BQU1BLEdBQUUsWUFBWTtBQUFHLFFBQUUsU0FBUyxFQUFFLFVBQVUsTUFBTUEsR0FBRSxXQUFXO0FBQzFGLFFBQUUsVUFBVSxFQUFFLFVBQVUsTUFBTUEsR0FBRSxjQUFjO0FBQUcsUUFBRSxXQUFXLEVBQUUsVUFBVSxNQUFNQSxHQUFFLGVBQWU7QUFDakcsZUFBUyxpQkFBOEIsY0FBYyxFQUFFLFFBQVEsQ0FBQyxNQUFPLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFNBQVMsQ0FBQyxFQUFFLFFBQVEsS0FBTSxDQUFFO0FBQ3ZILGVBQVMsaUJBQThCLFlBQVksRUFBRSxRQUFRLENBQUMsTUFBTyxFQUFFLFVBQVUsTUFBTUEsR0FBRSxXQUFXLEVBQUUsUUFBUSxHQUFJLENBQUU7QUFDcEgsUUFBRSxNQUFNLEVBQUUsVUFBVSxNQUFNO0FBQUUsYUFBSyxJQUFJLFVBQVUsT0FBTyxNQUFNO0FBQUcsYUFBSyxZQUFZO0FBQUEsTUFBRztBQUNuRixZQUFNLE1BQU0sTUFBTTtBQUFFLFVBQUUsVUFBVSxFQUFFLFVBQVUsT0FBTyxPQUFPLENBQUMsTUFBTSxLQUFLO0FBQUcsVUFBRSxRQUFRLEVBQUUsVUFBVSxPQUFPLE9BQU8sQ0FBQyxNQUFNLEdBQUc7QUFBRyxjQUFNLEtBQUssRUFBRSxRQUFRLEVBQUUsY0FBYyxLQUFLO0FBQUcsWUFBSSxHQUFJLElBQUcsTUFBTSxRQUFRLE1BQU0sTUFBTSxhQUFhLFdBQVc7QUFBQSxNQUFHO0FBQ3ZPLFFBQUUsVUFBVSxFQUFFLFVBQVUsTUFBTTtBQUFFLGNBQU0sU0FBUyxDQUFDLE1BQU0sS0FBSztBQUFHLFlBQUk7QUFBQSxNQUFHO0FBQUcsUUFBRSxRQUFRLEVBQUUsVUFBVSxNQUFNO0FBQUUsY0FBTSxPQUFPLENBQUMsTUFBTSxHQUFHO0FBQUcsWUFBSTtBQUFBLE1BQUc7QUFDdkksYUFBTyxpQkFBaUIsa0JBQWtCLEdBQUc7QUFBRyxVQUFJO0FBQ3BELFdBQUssTUFBTSxFQUFFLE9BQU87QUFBRyxVQUFJLElBQUksZ0JBQWdCLFNBQVMsTUFBTSxFQUFFLElBQUksT0FBTyxFQUFHLE1BQUssSUFBSSxVQUFVLElBQUksTUFBTTtBQUMzRyxXQUFLLFlBQVk7QUFBQSxJQUNuQjtBQUFBO0FBQUEsSUFHQSxjQUFjO0FBQUUsWUFBTSxJQUFJLEVBQUUsUUFBUTtBQUFHLFFBQUUsVUFBVSxPQUFPLE1BQU07QUFBRyxXQUFLLEVBQUU7QUFBYSxRQUFFLFVBQVUsSUFBSSxNQUFNO0FBQUEsSUFBRztBQUFBLElBQ2hILE1BQU0sS0FBYTtBQUFFLFlBQU0sSUFBSSxFQUFFLE9BQU87QUFBRyxRQUFFLGNBQWM7QUFBSyxRQUFFLFVBQVUsSUFBSSxNQUFNO0FBQUcsbUJBQWEsS0FBSyxNQUFNO0FBQUcsV0FBSyxTQUFTLE9BQU8sV0FBVyxNQUFNLEVBQUUsVUFBVSxPQUFPLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRztBQUFBLElBRTdMLFNBQVM7QUFDUCxZQUFNQSxLQUFJLEtBQUssR0FBRyxJQUFJQSxHQUFFLEdBQUcsS0FBS0EsR0FBRSxPQUFPLFFBQVEsT0FBTztBQUN4RCxRQUFFLFFBQVEsRUFBRSxZQUFZLFdBQVcsRUFBRSxNQUFNO0FBQzNDLFFBQUUsTUFBTSxFQUFFLGNBQWMsUUFBUSxFQUFFLElBQUksSUFBSSxXQUFXLENBQUMsQ0FBQztBQUN2RCxZQUFNLE9BQU8sYUFBYSxDQUFDO0FBQUcsUUFBRSxLQUFLLEVBQUUsY0FBYyxHQUFHLElBQUksSUFBSSxFQUFFLEdBQUc7QUFBSSxNQUFDLEVBQUUsU0FBUyxFQUFrQixNQUFNLFFBQVEsS0FBSyxJQUFJLEtBQU0sT0FBTyxFQUFFLE1BQU8sR0FBRyxJQUFJO0FBRTNKLFlBQU0sS0FBSyxZQUFZLFVBQVUsRUFBRSxNQUFNQSxHQUFFLElBQUksQ0FBQztBQUNoRCxRQUFFLE9BQU8sRUFBRSxZQUFZLHdCQUF3QixHQUFHLElBQUksQ0FBQyxNQUFNLDJCQUEyQixLQUFLLEVBQUUsSUFBYyxDQUFDLGdCQUFnQixVQUFVLEVBQUUsSUFBYyxDQUFDLDhCQUEyQixFQUFFLEtBQUssMkJBQTJCLE1BQU0sRUFBRSxJQUFJLENBQUMsZUFBZSxFQUFFLEtBQUssRUFBRSxJQUFJO0FBRS9QLFlBQU0sT0FBTyxFQUFFLE1BQU07QUFBRyxXQUFLLFlBQVk7QUFDekMsUUFBRSxLQUFLLFFBQVEsQ0FBQyxNQUFjLE1BQWM7QUFDMUMsY0FBTSxLQUFLLFNBQVMsY0FBYyxLQUFLO0FBQUcsY0FBTSxNQUFNQSxHQUFFLE9BQU9BLEdBQUUsSUFBSSxTQUFTLFVBQVVBLEdBQUUsSUFBSSxRQUFRO0FBQUcsY0FBTSxTQUFTLFVBQVUsR0FBRyxDQUFDLEdBQUcsV0FBVyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQVcsaUJBQWlCLEdBQUcsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLFNBQVMsVUFBVTtBQUMvTixXQUFHLFlBQVksVUFBVSxNQUFNLFNBQVMsT0FBTyxDQUFDLFVBQVUsQ0FBQ0EsR0FBRSxXQUFXLFNBQVMsT0FBT0EsR0FBRSxXQUFXLFVBQVU7QUFDL0csY0FBTSxNQUFNLFNBQVMsbUNBQW1DLFdBQVcsMENBQTBDO0FBQzdHLFdBQUcsWUFBWSxxQkFBcUIsS0FBSyxNQUFNLENBQUMsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLG1CQUFtQixVQUFVLElBQUksQ0FBQyx5QkFBeUIsR0FBRztBQUFVLFdBQUcsUUFBUSxVQUFVLElBQUksS0FBSyxTQUFTLEtBQUssV0FBVyw4RUFBOEU7QUFDalIsV0FBRyxVQUFVLE1BQU1BLEdBQUUsT0FBTyxDQUFDO0FBQUcsYUFBSyxZQUFZLEVBQUU7QUFBQSxNQUNyRCxDQUFDO0FBQ0QsVUFBSSxDQUFDLEVBQUUsS0FBSyxPQUFRLE1BQUssWUFBWTtBQUVyQyxNQUFDLEVBQUUsV0FBVyxFQUF3QixXQUFXLENBQUMsU0FBUyxDQUFDLEVBQUUsTUFBTTtBQUNwRSxZQUFNLEtBQUssRUFBRSxTQUFTO0FBQXdCLFNBQUcsV0FBVyxDQUFDLFNBQVMsRUFBRTtBQUFhLFNBQUcsVUFBVSxPQUFPLE1BQU1BLEdBQUUsUUFBUTtBQUFHLFNBQUcsY0FBYyxFQUFFLGNBQWMsY0FBY0EsR0FBRSxXQUFXLDhCQUE4QjtBQUN0TixZQUFNLE9BQU9BLEdBQUUsT0FBT0EsR0FBRSxJQUFJLFNBQVMsU0FBUyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQVcsRUFBRSxPQUFPQSxHQUFFLElBQUksRUFBRSxJQUFJO0FBQzVGLFlBQU0sVUFBVSxRQUFRLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBVyxpQkFBaUIsTUFBTSxDQUFDLENBQUM7QUFDMUUsUUFBRSxXQUFXLEVBQUUsTUFBTSxVQUFVLFNBQVMsT0FBTyxTQUFTO0FBQVEsTUFBQyxFQUFFLFVBQVUsRUFBd0IsV0FBVyxDQUFDO0FBQ2pILFFBQUUsV0FBVyxFQUFFLGNBQWNBLEdBQUUsZ0JBQWdCLG1CQUFtQjtBQUNsRSxRQUFFLE1BQU0sRUFBRSxjQUFjLFFBQVNBLEdBQUUsV0FBVyw0SEFDMUMsT0FBTyxHQUFHLFVBQVUsS0FBSyxJQUFjLENBQUMsSUFBSSxNQUFNLEtBQUssSUFBSSxDQUFDLGFBQVEsVUFBVSxLQUFLLElBQWMsQ0FBQyxLQUFLLFVBQVUsMkNBQXNDLEVBQUUsS0FDekpBLEdBQUUsT0FBT0EsR0FBRSxJQUFJLFNBQVMsU0FBUyxHQUFHLFVBQVUsRUFBRSxLQUFLQSxHQUFFLElBQUksR0FBRyxDQUFXLENBQUMsS0FBSyxVQUFVLEVBQUUsS0FBS0EsR0FBRSxJQUFJLEdBQUcsQ0FBVyxDQUFDLGdCQUFXLE1BQU07QUFBRSxjQUFNLElBQUlBLEdBQUUsSUFBSSxLQUFLLEtBQUssVUFBVSxHQUFHLENBQUMsR0FBRyxLQUFLLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBVyxpQkFBaUIsR0FBRyxHQUFHLEVBQUUsRUFBRSxDQUFDO0FBQUcsZUFBTyxNQUFNLEtBQUsseUVBQXlFLEtBQUssZ0NBQWdDLEtBQUssZ0VBQWdFO0FBQUEsTUFBNEMsR0FBRyxJQUFJLHFFQUN4ZSxPQUFPLFlBQVksT0FBTyxlQUFlLHNDQUFzQztBQUNuRixRQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsT0FBTyxZQUFZLE9BQU8sZUFBZSxTQUFTO0FBQzdFLGVBQVMsaUJBQThCLGNBQWMsRUFBRSxRQUFRLENBQUMsTUFBTSxFQUFFLFVBQVUsT0FBTyxNQUFNLENBQUMsRUFBRSxRQUFRLFVBQVdBLEdBQUUsU0FBUyxDQUFDO0FBQ2pJLGVBQVMsaUJBQThCLFlBQVksRUFBRSxRQUFRLENBQUMsTUFBTSxFQUFFLFVBQVUsT0FBTyxNQUFNLEVBQUUsUUFBUSxRQUFRQSxHQUFFLE9BQU8sQ0FBQztBQUN6SCxlQUFTLEtBQUssVUFBVSxPQUFPLFlBQVksT0FBTyxZQUFZLE9BQU8sWUFBWTtBQUFHLFlBQU0sUUFBUSxPQUFPLFlBQVksT0FBTyxlQUFlLFdBQVcsT0FBTztBQUU3SixZQUFNLEtBQUssRUFBRSxTQUFTO0FBQUcsU0FBRyxZQUFZO0FBQUksU0FBRyxZQUFZO0FBQzNELFVBQUksT0FBTyxXQUFXQSxHQUFFLE9BQU87QUFDN0IsV0FBRyxZQUFZO0FBQVEsV0FBRyxZQUFZLHlGQUF5RixFQUFFLEdBQUcscUNBQXFDQSxHQUFFLE1BQU0sSUFBSSxDQUFDLE1BQWMsTUFBYyxpQ0FBaUMsQ0FBQyx1QkFBdUIsS0FBSyxNQUFNLENBQUMsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLG1CQUFtQixVQUFVLElBQUksQ0FBQywyQkFBMkIsVUFBVSxJQUFJLENBQUMsY0FBYyxFQUFFLEtBQUssRUFBRSxDQUFDO0FBQy9ZLFdBQUcsaUJBQThCLE9BQU8sRUFBRSxRQUFRLENBQUMsTUFBTyxFQUFFLFVBQVUsTUFBTUEsR0FBRSxVQUFVLENBQUMsRUFBRSxRQUFRLENBQUUsQ0FBRTtBQUFBLE1BQ3pHLFdBQVcsT0FBTyxTQUFTLE9BQU8sUUFBUTtBQUN4QyxjQUFNLEtBQUssT0FBTyxRQUFRQSxHQUFFLFNBQVMsTUFBTSxLQUFLLENBQUMsTUFBYyxVQUFVLENBQUM7QUFDMUUsY0FBTSxhQUFhLEtBQUssMERBQTBELEdBQUcsT0FBUSxHQUFHLFFBQVEsR0FBRyxRQUFRLE1BQU0sQ0FBQyw4QkFBOEIsR0FBRyxHQUFHLEtBQUssSUFBSSxDQUFDLGdCQUFnQixHQUFHLFFBQVEsTUFBTSxDQUFDLHFCQUFxQixHQUFHLEdBQUcsS0FBSyxJQUFJLENBQUMsZ0JBQWlCLG1CQUFtQixHQUFHLFdBQVcsSUFBSSxHQUFHLFlBQVksc0JBQXNCLFdBQVc7QUFDclYsV0FBRyxZQUFZO0FBQVEsV0FBRyxZQUFZLHdCQUF3QixPQUFPLFFBQVEsbUJBQW1CLFlBQVkseUJBQXlCQSxHQUFFLFVBQVUsU0FBUyxVQUFVLG9CQUFvQixNQUFNLEdBQUcsT0FBTyxzREFBc0QsRUFBRSw2QkFBNkIsTUFBTSxHQUFHLE9BQU8sU0FBUyxJQUFJLEtBQUssT0FBTyxRQUFRLGVBQWUsV0FBVztBQUN4VyxVQUFFLE9BQU8sRUFBRSxVQUFVLE1BQU1BLEdBQUUsT0FBTztBQUFHLFVBQUUsUUFBUSxFQUFFLFVBQVUsTUFBTSxPQUFPLGNBQWMsSUFBSSxNQUFNLGVBQWUsQ0FBQztBQUNsSCxjQUFNLEtBQUssU0FBUyxlQUFlLFFBQVE7QUFBRyxZQUFJLEdBQUksSUFBRyxVQUFVLE1BQU0sT0FBTyxjQUFjLElBQUksTUFBTSxlQUFlLENBQUM7QUFBQSxNQUMxSDtBQUNBLFdBQUssZ0JBQWdCO0FBQ3JCLFVBQUksT0FBTyxRQUFTLHVCQUFzQixNQUFNQSxHQUFFLGFBQWEsQ0FBQztBQUFBLElBQ2xFO0FBQUE7QUFBQSxJQUdRLGNBQWM7QUFDcEIsWUFBTUEsS0FBSSxLQUFLLEdBQUcsSUFBSSxLQUFLO0FBQUssVUFBSSxDQUFDLEVBQUUsVUFBVSxTQUFTLE1BQU0sR0FBRztBQUFFLFVBQUUsWUFBWTtBQUFJO0FBQUEsTUFBUTtBQUMvRixZQUFNLE1BQU0sQ0FBQyxPQUFlLEtBQVUsS0FBc0IsS0FBYSxLQUFhLFNBQWlCLFVBQVUsS0FBSyw2QkFBNkIsR0FBRyxVQUFVLEdBQUcsV0FBVyxJQUFJLFlBQVksSUFBSSxHQUFHLENBQUMsYUFBYSxLQUFLLFdBQVcsSUFBSSxHQUFHLENBQUM7QUFDM08sUUFBRSxZQUFZO0FBQUE7QUFBQSxVQUVSLElBQUksZ0JBQVcsUUFBUSxLQUFLLElBQUksR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxnQkFBVyxRQUFRLEtBQUssSUFBSSxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLG9CQUFlLFFBQVEsS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLElBQUksb0JBQWUsUUFBUSxLQUFLLEtBQUssR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxnQkFBVyxRQUFRLEtBQUssT0FBTyxHQUFHLEdBQUcsS0FBSyxJQUFJLENBQUMsR0FBRyxJQUFJLGdCQUFXLFFBQVEsS0FBSyxPQUFPLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQztBQUFBLGlIQUM5TSxNQUFNLElBQUksQ0FBQyxNQUFNLFdBQVcsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sT0FBTyxZQUFZLFNBQVMsT0FBTyxFQUFFLElBQUksQ0FBQyxNQUFNLHFDQUFxQyxDQUFDLGFBQWEsQ0FBQyxZQUFhLFFBQVEsTUFBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFBQSx3REFDM1IsQ0FBQyxRQUFRLFVBQVUsUUFBUSxXQUFXLEVBQUUsSUFBSSxDQUFDLE1BQU0sa0JBQWtCLENBQUMsS0FBS0EsR0FBRSxlQUFlLElBQUksYUFBYSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFBQSx3RUFDekhBLEdBQUUsRUFBRSxNQUFNLFVBQVUsb0JBQW9CLFlBQVksRUFBRTtBQUFBLGdJQUNIQSxHQUFFLFVBQVUsWUFBWSxFQUFFO0FBQUEsaUdBQ3BELEtBQUssSUFBSTtBQUFBO0FBQUEsc0RBRXBELE1BQU0sSUFBSSxDQUFDLE1BQU0sa0JBQWtCLENBQUMsS0FBSyxVQUFVLENBQUMsQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFBQSw2REFDbkVBLEdBQUUsV0FBVztBQUFBLHNDQUNwQ0EsR0FBRSxJQUFJO0FBQ3hDLFFBQUUsaUJBQW1DLG1CQUFtQixFQUFFLFFBQVEsQ0FBQyxRQUFTLElBQUksVUFBVSxNQUFNO0FBQzlGLGNBQU0sTUFBTSxJQUFJLFFBQVE7QUFBSSxjQUFNLElBQUksQ0FBQyxJQUFJO0FBQU8sUUFBQyxJQUFJLG1CQUFtQyxjQUFjLE9BQU8sQ0FBQztBQUNoSCxjQUFNLE1BQWtDLEVBQUUsZ0JBQVcsTUFBTyxRQUFRLEtBQUssR0FBRyxDQUFDLElBQUksR0FBSSxnQkFBVyxNQUFPLFFBQVEsS0FBSyxHQUFHLENBQUMsSUFBSSxHQUFJLG9CQUFlLE1BQU8sUUFBUSxLQUFLLElBQUksQ0FBQyxJQUFJLEdBQUksb0JBQWUsTUFBTyxRQUFRLEtBQUssSUFBSSxDQUFDLElBQUksR0FBSSxnQkFBVyxNQUFPLFFBQVEsS0FBSyxNQUFNLENBQUMsSUFBSSxHQUFJLGdCQUFXLE1BQU8sUUFBUSxLQUFLLE1BQU0sQ0FBQyxJQUFJLEVBQUc7QUFDM1QsWUFBSSxHQUFHLEVBQUU7QUFBRyxRQUFBQSxHQUFFLG1CQUFtQjtBQUFBLE1BQ25DLENBQUU7QUFDRixRQUFFLGlCQUFtQyxXQUFXLEVBQUUsUUFBUSxDQUFDLFFBQVMsSUFBSSxXQUFXLE1BQU07QUFBRSxRQUFDLFFBQVEsTUFBYyxJQUFJLFFBQVEsSUFBSyxFQUFFLElBQUksUUFBUSxDQUFFLElBQUksQ0FBQyxJQUFJO0FBQUEsTUFBTyxDQUFFO0FBQ3JLLFFBQUUsT0FBTyxFQUFFLFdBQVcsQ0FBQyxNQUFNQSxHQUFFLGlCQUFrQixFQUFFLE9BQTZCLEtBQUs7QUFDckYsUUFBRSxZQUFZLEVBQUUsV0FBVyxDQUFDLE1BQU07QUFBRSxRQUFBQSxHQUFFLEVBQUUsTUFBTSxRQUFTLEVBQUUsT0FBNEIsVUFBVSxvQkFBb0I7QUFBZ0IsUUFBQUEsR0FBRSxVQUFVO0FBQUcsYUFBSyxPQUFPO0FBQUEsTUFBRztBQUNqSyxRQUFFLE9BQU8sRUFBRSxVQUFVLE1BQU07QUFBRSxjQUFNLElBQUlBLEdBQUUsU0FBUyxHQUFHO0FBQUcsYUFBSyxPQUFPLEdBQUcsRUFBRSxHQUFHLFVBQVUsRUFBRSxDQUFDLGdCQUFnQixFQUFFLE9BQU8sY0FBY0EsR0FBRSxFQUFFLElBQUk7QUFBSSxVQUFFLFVBQVUsRUFBRSxjQUFjLEtBQUs7QUFBQSxNQUFNO0FBQ25MLFFBQUUsT0FBTyxFQUFFLFVBQVUsTUFBTTtBQUFFLGNBQU0sSUFBSUEsR0FBRSxPQUFPO0FBQUcsU0FBQyxVQUFVLFlBQVksVUFBVSxVQUFVLFVBQVUsQ0FBQyxJQUFJLFFBQVEsT0FBTyxHQUFHLEtBQUssTUFBTSxLQUFLLE1BQU0sb0NBQW9DLENBQUMsRUFBRSxNQUFNLE1BQU07QUFBRSxpQkFBTyxxQkFBcUIsQ0FBQztBQUFBLFFBQUcsQ0FBQztBQUFBLE1BQUc7QUFDOU8sUUFBRSxNQUFNLEVBQUUsV0FBVyxDQUFDLE1BQU1BLEdBQUUsV0FBWSxFQUFFLE9BQTRCLE9BQU87QUFDL0UsUUFBRSxPQUFPLEVBQUUsVUFBVSxNQUFNO0FBQUUsY0FBTSxJQUFJQSxHQUFFLFdBQVc7QUFBRyxTQUFDLFVBQVUsWUFBWSxVQUFVLFVBQVUsVUFBVSxDQUFDLElBQUksUUFBUSxPQUFPLEdBQUcsS0FBSyxNQUFNLEtBQUssTUFBTSx5Q0FBeUMsQ0FBQyxFQUFFLE1BQU0sTUFBTTtBQUFFLGlCQUFPLHFCQUFxQixDQUFDO0FBQUEsUUFBRyxDQUFDO0FBQUEsTUFBRztBQUN2UCxRQUFFLFFBQVEsRUFBRSxVQUFVLE1BQU07QUFBRSxRQUFBQSxHQUFFLGdCQUFnQjtBQUFHLGFBQUssWUFBWTtBQUFBLE1BQUc7QUFDdkUsUUFBRSxVQUFVLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFdBQVdBLEdBQUUsSUFBSTtBQUNqRCxRQUFFLE1BQU0sRUFBRSxVQUFVLE1BQU1BLEdBQUUsUUFBUyxFQUFFLE9BQU8sRUFBd0IsS0FBZTtBQUFHLFFBQUUsTUFBTSxFQUFFLFVBQVUsTUFBTUEsR0FBRSxZQUFZLENBQUM7QUFBQSxJQUNuSTtBQUFBLElBQ0Esa0JBQWtCO0FBQ2hCLFlBQU0sSUFBSSxTQUFTLGVBQWUsUUFBUTtBQUFHLFVBQUksRUFBRyxHQUFFLGNBQWMsR0FBRyxLQUFLLEVBQUUsS0FBSztBQUNuRixZQUFNLEtBQUssU0FBUyxlQUFlLFNBQVM7QUFBRyxVQUFJLElBQUk7QUFBRSxjQUFNLElBQUksS0FBSyxFQUFFLFNBQVM7QUFBRyxXQUFHLGNBQWMsR0FBRyxFQUFFLElBQUksUUFBUSxDQUFDLENBQUMsaUJBQWMsRUFBRSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGtCQUFlLEVBQUUsSUFBSSxRQUFRLENBQUMsQ0FBQyxpQkFBYyxFQUFFLE1BQU0sUUFBUSxDQUFDLENBQUMsV0FBUSxFQUFFLE1BQU0sZ0JBQWEsRUFBRSxTQUFTLDBCQUF1QixFQUFFLEtBQUs7QUFBQSxNQUFlO0FBQzVTLFlBQU0sSUFBSSxTQUFTLGVBQWUsUUFBUTtBQUFHLFVBQUksRUFBRyxHQUFFLGNBQWMsS0FBSyxFQUFFO0FBQUEsSUFDN0U7QUFBQSxFQUNGOzs7QUMxRk8sTUFBTSxPQUFOLE1BQVc7QUFBQSxJQUFYO0FBQ0w7QUFBYTtBQUFZO0FBQWE7QUFBWTtBQUNsRDtBQUFXLGtDQUFPO0FBQUcscUNBQVU7QUFBRyxtQ0FBZTtBQUFTLG9DQUF3QjtBQUFNLHVDQUFZO0FBQ3BHLGlDQUFXO0FBQU0sc0NBQVc7QUFBTywyQ0FBZ0I7QUFBTyxtQ0FBeUI7QUFBTSx3Q0FBYTtBQUN0RywwQkFBUSxXQUFVLG9CQUFJLElBQXdCO0FBQzlDO0FBQUEsMEJBQVEsYUFBWSxvQkFBSSxJQUF3QjtBQUNoRCwwQkFBUSxRQUFPLG9CQUFJLElBQXdCO0FBQzNDO0FBQUEsMEJBQVEsU0FBUSxvQkFBSSxJQUFvQjtBQUN4QztBQUFBLDBCQUFRLGFBQVksb0JBQUksSUFBb0I7QUFDNUMsMEJBQVEsU0FBZSxDQUFDO0FBQUcsMEJBQVEsWUFBa0IsQ0FBQztBQUFHLDBCQUFRLFVBQWdCLENBQUM7QUFBRywwQkFBUSxVQUFnQixDQUFDO0FBQUcsMEJBQVEsVUFBMEMsQ0FBQztBQUNwSywwQkFBUSxPQUFNO0FBQUcsMEJBQVEsV0FBZTtBQUFNLDBCQUFRLFNBQWE7QUFBTSwwQkFBUSxRQUFPO0FBQUcsMEJBQVEsVUFBUztBQUFLLDBCQUFRLFlBQVc7QUFBSSwwQkFBUSxXQUFVO0FBQU8sMEJBQVEsZUFBYztBQUN2TCwwQkFBUSxhQUFtQixDQUFDO0FBQUcsMEJBQVEsYUFBbUIsQ0FBQztBQUMzRDtBQUVBO0FBQUEsb0NBQTZCO0FBQzdCLDBCQUFRLFFBQU87QUFDZjtBQUFBLDBCQUFRLFVBQW1GLENBQUM7QUFJNUYsMEJBQVEsY0FBYTtBQXNDckI7QUFBQSwwQkFBUSxVQUFTO0FBRWpCO0FBQUEsb0NBQVM7QUF1RFQsMEJBQVE7QUFBNEIsMEJBQVEsU0FBUTtBQUFHLDBCQUFRLFNBQVE7QUFBRyx5Q0FBYztBQWtCeEY7QUFBQSxxQ0FBNEI7QUFBUywwQkFBUSxVQUFjLElBQUksUUFBUSxRQUFRLEdBQUcsS0FBSyxDQUFDO0FBdUN4RjtBQUFBLHFDQUFVO0FBQU8scUNBQVUsRUFBRSxLQUFLLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxPQUFPLEVBQUU7QUFBRyxxQ0FBaUIsQ0FBQztBQUNuRiwwQkFBUSxXQUFVLElBQUksYUFBYSxHQUFHO0FBQUcsMEJBQVEsU0FBUTtBQUFHLDBCQUFRLFNBQVE7QUFBRywwQkFBUSxlQUFjO0FBQUcsMEJBQVEsU0FBYTtBQUFNLDBCQUFRLFVBQTZCO0FBQ3hLLDBCQUFRLGFBQWdHO0FBQUE7QUFBQSxJQTdKaEcsTUFBTSxLQUFhLElBQXlCLE1BQW1CO0FBQUUsV0FBSyxPQUFPLEtBQUssRUFBRSxHQUFHLEdBQUcsS0FBSyxJQUFJLEtBQUssQ0FBQztBQUFBLElBQUc7QUFBQTtBQUFBLElBRTVHLGNBQWM7QUFBRSxpQkFBVyxLQUFLLEtBQUssT0FBTyxPQUFPLENBQUMsR0FBRztBQUFFLFVBQUUsR0FBRyxDQUFDO0FBQUcsWUFBSSxFQUFFLEtBQU0sR0FBRSxLQUFLO0FBQUEsTUFBRztBQUFBLElBQUU7QUFBQSxJQUdsRyxNQUFNLEtBQUssUUFBMkI7QUFDcEMsWUFBTSxLQUFLLElBQUksZ0JBQWdCLFNBQVMsTUFBTTtBQUM5QyxXQUFLLFNBQVMsSUFBSSxRQUFRLE9BQU8sUUFBUSxNQUFNLEVBQUUsV0FBVyxNQUFNLGlCQUFpQixtQkFBbUIsQ0FBQztBQUN2RyxZQUFNLE1BQU0sT0FBTyxvQkFBb0I7QUFBRyxXQUFLLE9BQU8sd0JBQXdCLElBQUksS0FBSyxJQUFJLEtBQUssR0FBRyxDQUFDO0FBQ3BHLFlBQU0sUUFBUSxLQUFLLFFBQVEsSUFBSSxRQUFRLE1BQU0sS0FBSyxNQUFNO0FBQUcsWUFBTSxhQUFhLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxNQUFNLENBQUM7QUFDcEgsWUFBTSxPQUFPLElBQUksUUFBUSxpQkFBaUIsS0FBSyxJQUFJLFFBQVEsUUFBUSxLQUFLLEdBQUcsR0FBRyxHQUFHLEtBQUs7QUFBRyxXQUFLLFlBQVk7QUFBTSxXQUFLLGNBQWMsSUFBSSxRQUFRLE9BQU8sTUFBTSxNQUFNLElBQUk7QUFDdEssWUFBTSxNQUFNLElBQUksUUFBUSxpQkFBaUIsS0FBSyxJQUFJLFFBQVEsUUFBUSxNQUFNLElBQUksSUFBSSxHQUFHLEtBQUs7QUFBRyxVQUFJLFlBQVk7QUFDM0csV0FBSyxTQUFTLElBQUksUUFBUSxXQUFXLE9BQU8sSUFBSSxRQUFRLFFBQVEsR0FBRyxHQUFHLEVBQUUsR0FBRyxLQUFLO0FBQUcsV0FBSyxPQUFPLE9BQU87QUFBSyxXQUFLLE9BQU8sT0FBTztBQUFLLFdBQUssT0FBTyxNQUFNO0FBQUssV0FBSyxPQUFPLE9BQU8sTUFBTTtBQUVuTCxZQUFNLFNBQVMsUUFBUSxZQUFZLGFBQWEsVUFBVSxFQUFFLE9BQU8sSUFBSSxRQUFRLEdBQUcsR0FBRyxLQUFLO0FBQzFGLFlBQU0sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sS0FBSztBQUFHLFNBQUcsZUFBZSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sSUFBSTtBQUFHLFNBQUcsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQUcsYUFBTyxXQUFXO0FBQUksYUFBTyxhQUFhO0FBQ25NLGlCQUFXLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBWSxVQUFTLElBQUksR0FBRyxJQUFJLFlBQVksS0FBSztBQUFFLGNBQU0sSUFBSSxLQUFLLFNBQVMsTUFBTSxDQUFDO0FBQUcsWUFBSSxTQUFTLEVBQUcsTUFBSyxNQUFNLEtBQUssQ0FBQztBQUFBLFlBQVEsR0FBRSxXQUFXLEtBQUs7QUFBQSxNQUFHO0FBRTNLLFdBQUssSUFBSSxNQUFNLFdBQVcsS0FBSztBQUMvQixXQUFLLFFBQVEsSUFBSSxZQUFZLE9BQU8sS0FBSyxFQUFFLElBQUk7QUFDL0MsV0FBSyxNQUFNLE9BQU8sU0FBUyxJQUFJLEVBQUUsV0FBVyxZQUFZLEtBQUssV0FBVyxNQUFNLEdBQUcsQ0FBQztBQUFHLFdBQUssTUFBTSxPQUFPLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFDOUgsV0FBSyxZQUFZLENBQUMsR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU07QUFBRSxjQUFNLElBQUksSUFBSSxRQUFRLGlCQUFpQixPQUFPLEdBQUcsS0FBSztBQUFHLFVBQUUsZUFBZSxRQUFRLE9BQU8sTUFBTTtBQUFHLFVBQUUsZ0JBQWdCLE1BQU0sSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLEtBQUssQ0FBQyxJQUFJLElBQUksUUFBUSxPQUFPLEdBQUcsS0FBSyxJQUFJO0FBQUcsVUFBRSxrQkFBa0I7QUFBTSxlQUFPO0FBQUEsTUFBRyxDQUFDO0FBQzdRLFdBQUssS0FBSyxJQUFJLEdBQUcsSUFBSTtBQUFHLFdBQUssT0FBTyxFQUFFLEdBQUcsSUFBSSxNQUFNLEtBQUs7QUFBSSxVQUFJLEdBQUcsSUFBSSxLQUFLLEVBQUcsTUFBSyxXQUFXLElBQUk7QUFHbkcsVUFBSSxPQUFtRDtBQUN2RCxZQUFNLFFBQVEsQ0FBQyxNQUFvQjtBQUFFLGNBQU0sSUFBSSxPQUFPLHNCQUFzQjtBQUFHLGVBQU8sRUFBRSxHQUFHLEVBQUUsVUFBVSxFQUFFLE1BQU0sR0FBRyxFQUFFLFVBQVUsRUFBRSxJQUFJO0FBQUEsTUFBRztBQUN2SSxhQUFPLGlCQUFpQixlQUFlLENBQUMsTUFBTTtBQUFFLGVBQU8sRUFBRSxHQUFHLE1BQU0sQ0FBQyxHQUFHLEdBQUcsWUFBWSxJQUFJLEVBQUU7QUFBQSxNQUFHLENBQUM7QUFDL0YsYUFBTyxpQkFBaUIsYUFBYSxDQUFDLE1BQU07QUFBRSxZQUFJLENBQUMsS0FBTTtBQUFRLGNBQU0sSUFBSSxNQUFNLENBQUM7QUFBRyxjQUFNLFFBQVEsS0FBSyxNQUFNLEVBQUUsSUFBSSxLQUFLLEdBQUcsRUFBRSxJQUFJLEtBQUssQ0FBQyxHQUFHLEtBQUssWUFBWSxJQUFJLElBQUksS0FBSztBQUFHLGVBQU87QUFBTSxZQUFJLFFBQVEsTUFBTSxLQUFLLElBQUssTUFBSyxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUM7QUFBQSxNQUFHLENBQUM7QUFDMU8sYUFBTyxpQkFBaUIsaUJBQWlCLE1BQU07QUFBRSxlQUFPO0FBQUEsTUFBTSxDQUFDO0FBQy9ELFdBQUssU0FBUztBQUFRLFlBQU0sV0FBVyxNQUFNLEtBQUssYUFBYTtBQUMvRCxhQUFPLGlCQUFpQixVQUFVLFFBQVE7QUFBRyxhQUFPLGlCQUFpQixxQkFBcUIsTUFBTSxXQUFXLFVBQVUsR0FBRyxDQUFDO0FBQ3pILFVBQUssT0FBZSxlQUFnQixDQUFDLE9BQWUsZUFBZSxpQkFBaUIsVUFBVSxRQUFRO0FBQ3RHLFVBQUssT0FBZSxlQUFnQixLQUFLLE9BQWUsZUFBZSxRQUFRLEVBQUUsUUFBUSxNQUFNO0FBQy9GLFVBQUksR0FBRyxJQUFJLFNBQVMsR0FBRztBQUFFLGFBQUssUUFBUTtBQUFHO0FBQUEsTUFBUTtBQUNqRCxZQUFNLFFBQVEsR0FBRyxJQUFJLE1BQU0sSUFBSSxPQUFPLFFBQVE7QUFDOUMsVUFBSSxNQUFPLE1BQUssUUFBUSxLQUFLO0FBQUEsVUFBUSxNQUFLLFdBQVcsS0FBSyxJQUFJO0FBQzlELFVBQUksT0FBTyxZQUFZLElBQUk7QUFDM0IsV0FBSyxPQUFPLGNBQWMsTUFBTTtBQUFFLGNBQU0sTUFBTSxZQUFZLElBQUksR0FBRyxNQUFNLE1BQU07QUFBTSxjQUFNLEtBQUssS0FBSyxJQUFJLE1BQU0sTUFBTSxHQUFJO0FBQUcsZUFBTztBQUFLLFlBQUksQ0FBQyxLQUFLLE9BQVE7QUFBUSxZQUFJLENBQUMsS0FBSyxPQUFRLE1BQUssTUFBTSxFQUFFO0FBQUcsY0FBTSxPQUFPO0FBQUcsYUFBSyxTQUFTLEdBQUc7QUFBQSxNQUFHLENBQUM7QUFBQSxJQUN6TztBQUFBLElBS0EsS0FBSyxJQUFZO0FBQUUsV0FBSyxNQUFNLEVBQUU7QUFBQSxJQUFHO0FBQUEsSUFDbkMsVUFBVSxJQUFhO0FBQUUsV0FBSyxTQUFTO0FBQUEsSUFBSTtBQUFBO0FBQUEsSUFHbkMsU0FBUyxNQUFhLE1BQWM7QUFDMUMsWUFBTSxJQUFJLFFBQVEsTUFBTSxJQUFJLEdBQUcsSUFBSSxRQUFRLFlBQVksWUFBWSxTQUFTLE1BQU0sRUFBRSxNQUFNLFVBQVUsS0FBSyxHQUFHLEtBQUssS0FBSztBQUN0SCxRQUFFLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxRQUFFLFNBQVMsSUFBSSxFQUFFLEdBQUcsT0FBTyxFQUFFLENBQUM7QUFDMUQsWUFBTSxJQUFJLElBQUksUUFBUSxpQkFBaUIsTUFBTSxLQUFLLEtBQUs7QUFBRyxRQUFFLGVBQWUsUUFBUSxPQUFPLE1BQU07QUFBRyxRQUFFLGdCQUFnQixTQUFTLElBQUksSUFBSSxRQUFRLE9BQU8sTUFBTSxNQUFNLElBQUksSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sSUFBSTtBQUFHLFFBQUUsUUFBUTtBQUFLLFFBQUUsa0JBQWtCO0FBQU0sUUFBRSxXQUFXO0FBQ3JRLFVBQUksU0FBUyxHQUFHO0FBQUUsVUFBRSxXQUFXLEVBQUUsTUFBTSxRQUFRLEtBQUs7QUFBRyxhQUFLLFNBQVMsSUFBSSxJQUFJO0FBQUEsTUFBRyxNQUFPLEdBQUUsYUFBYTtBQUN0RyxhQUFPO0FBQUEsSUFDVDtBQUFBLElBQ1EsS0FBSyxNQUFjLE1BQTZDO0FBQ3RFLFlBQU0sSUFBSSxLQUFLLFNBQVMsSUFBSTtBQUFHLFlBQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxNQUFNLE1BQU0sTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLEtBQUssTUFBTSxNQUFNLEdBQUcsR0FBRyxLQUFLLENBQUMsR0FBRyxNQUFNLEtBQUssSUFBSSxHQUFHLFNBQVMsQ0FBQyxNQUFNLE1BQU0sR0FBRyxJQUFJLEVBQUUsRUFBRSxJQUFJO0FBQzFLLFFBQUUsZ0JBQWdCLElBQUksUUFBUSxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQUcsUUFBRSxRQUFRLEVBQUUsQ0FBQztBQUFBLElBQ3ZFO0FBQUEsSUFDQSxNQUFNLEtBQWEsSUFBZ0I7QUFBRSxXQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsS0FBSyxHQUFHLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDL0QsT0FBTyxHQUFXLEdBQVcsT0FBWSxJQUFZLElBQVksS0FBYTtBQUNwRixZQUFNLElBQUksUUFBUSxZQUFZLFlBQVksTUFBTSxFQUFFLFVBQVUsR0FBRyxXQUFXLE9BQU8sY0FBYyxHQUFHLEdBQUcsS0FBSyxLQUFLO0FBQUcsUUFBRSxTQUFTLElBQUksR0FBRyxNQUFNLENBQUM7QUFBRyxRQUFFLGFBQWE7QUFDN0osWUFBTSxLQUFLLElBQUksUUFBUSxpQkFBaUIsT0FBTyxLQUFLLEtBQUs7QUFBRyxTQUFHLGdCQUFnQjtBQUFPLFNBQUcsa0JBQWtCO0FBQU0sU0FBRyxRQUFRO0FBQUssUUFBRSxXQUFXO0FBQUksV0FBSyxPQUFPLEtBQUssRUFBRSxHQUFHLElBQUksR0FBRyxHQUFHLElBQUksSUFBSSxJQUFJLENBQUM7QUFBQSxJQUNqTTtBQUFBLElBQ1EsTUFBTSxHQUFXLEdBQVcsSUFBYyxJQUFjLE9BQWU7QUFDN0UsWUFBTSxLQUFLLElBQUksUUFBUSxlQUFlLEtBQUssSUFBSSxLQUFLLEtBQUs7QUFBRyxTQUFHLGtCQUFrQixLQUFLLEVBQUU7QUFBTSxTQUFHLFVBQVUsSUFBSSxRQUFRLFFBQVEsR0FBRyxNQUFNLENBQUM7QUFBRyxTQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBRyxTQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsS0FBSyxNQUFNLEdBQUc7QUFDbFAsU0FBRyxTQUFTLElBQUksUUFBUSxPQUFPLEdBQUksRUFBdUM7QUFBRyxTQUFHLFNBQVMsSUFBSSxRQUFRLE9BQU8sR0FBSSxFQUF1QztBQUFHLFNBQUcsWUFBWSxJQUFJLFFBQVEsT0FBTyxLQUFLLEdBQUcsS0FBSyxDQUFDO0FBQzFNLFNBQUcsVUFBVTtBQUFNLFNBQUcsVUFBVTtBQUFNLFNBQUcsY0FBYztBQUFLLFNBQUcsY0FBYztBQUFLLFNBQUcsV0FBVztBQUFHLFNBQUcsa0JBQWtCO0FBQU8sU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLElBQUksS0FBSyxFQUFFO0FBQUcsU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLEdBQUcsS0FBSyxDQUFDO0FBQzlOLFNBQUcsZUFBZTtBQUFLLFNBQUcsZUFBZTtBQUFHLFNBQUcsVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLElBQUksQ0FBQztBQUFHLFNBQUcsWUFBWSxRQUFRLGVBQWU7QUFBZSxTQUFHLHFCQUFxQjtBQUFLLFNBQUcsZ0JBQWdCO0FBQU0sU0FBRyxNQUFNO0FBQUEsSUFDOU07QUFBQTtBQUFBLElBR1EsUUFBUTtBQUNkLFlBQU0sTUFBTSxLQUFLLE9BQU8sZUFBZSxJQUFJLEtBQUssT0FBTyxnQkFBZ0IsR0FBRyxPQUFPLEtBQUssSUFBSSxLQUFLLE9BQU8sTUFBTSxDQUFDO0FBQzdHLFlBQU0sT0FBTyxXQUFXLFlBQVksS0FBSyxVQUFVO0FBQ25ELFlBQU0sSUFBSSxLQUFLLElBQUksUUFBUSxPQUFPLE9BQVEsWUFBWSxVQUFXLElBQUksTUFBTSxPQUFPLE9BQU8sQ0FBQztBQUMxRixZQUFNLFNBQVMsRUFBRSxLQUFLLElBQUksUUFBUSxRQUFRLE9BQU8sR0FBRyxPQUFPLElBQUksS0FBSyxRQUFRLENBQUMsR0FBRyxLQUFLLElBQUksUUFBUSxRQUFRLEdBQUcsTUFBTSxDQUFDLEVBQUU7QUFFckgsWUFBTSxLQUFLLEVBQUUsV0FBWSxZQUFZLEtBQUssVUFBVyxJQUFJLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLFlBQVk7QUFDakcsWUFBTSxNQUFNLENBQUMsT0FBZTtBQUFFLGNBQU0sS0FBSyxTQUFTLGVBQWUsRUFBRTtBQUFHLGVBQU8sTUFBTSxHQUFHLGlCQUFpQixPQUFPLEdBQUcsc0JBQXNCLElBQUk7QUFBQSxNQUFNO0FBQ2pKLFlBQU0sU0FBUyxJQUFJLEtBQUssR0FBRyxPQUFPLElBQUksTUFBTSxHQUFHLE9BQU8sSUFBSSxNQUFNO0FBQ2hFLFlBQU0sTUFBTSxLQUFLLElBQUksTUFBTSxVQUFVLE9BQU8sU0FBUyxLQUFLLElBQUksR0FBRztBQUNqRSxZQUFNLFNBQVMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLElBQUksT0FBTyxLQUFLLE1BQU0sR0FBRyxPQUFPLEtBQUssTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDO0FBQzdGLFlBQU0sT0FBTyxLQUFLLElBQUksS0FBSyxJQUFJLE1BQU0sTUFBTSxHQUFHLGFBQWEsTUFBTSxPQUFPO0FBQ3hFLFlBQU0sS0FBSyxZQUFZLFVBQVUsS0FBSyxLQUFLLFlBQVksVUFBVTtBQUNqRSxZQUFNLEtBQUssS0FBSyxJQUFJLE1BQU0sSUFBSSxPQUFPLE9BQU8sTUFBTSxJQUFJLE9BQU8sTUFBTSxPQUFPLEdBQUc7QUFDN0UsWUFBTSxTQUFTLE1BQU0sY0FBYyxJQUFJLEtBQUssTUFBTSxLQUFLLEtBQUs7QUFDNUQsWUFBTSxRQUFRLEVBQUUsS0FBSyxJQUFJLFFBQVEsUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLE1BQU0sRUFBRSxHQUFHLEtBQUssSUFBSSxRQUFRLFFBQVEsSUFBSSxHQUFHLENBQUMsS0FBSyxFQUFFO0FBQzdHLFlBQU0sUUFBUSxFQUFFLEtBQUssSUFBSSxRQUFRLFFBQVEsT0FBTyxJQUFJLElBQUksS0FBSyxPQUFPLElBQUksSUFBSSxNQUFNLE9BQU8sSUFBSSxJQUFJLElBQUksR0FBRyxLQUFLLElBQUksUUFBUSxRQUFRLE1BQU0sTUFBTSxDQUFDLEVBQUU7QUFDaEosYUFBTyxFQUFFLFFBQVEsT0FBTyxNQUFNO0FBQUEsSUFDaEM7QUFBQTtBQUFBLElBRUEsZUFBZTtBQUNiLFVBQUksS0FBSyxVQUFVLFdBQVcsS0FBSyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsS0FBSyxPQUFRO0FBQzFFLFlBQU0sSUFBSSxLQUFLLE1BQU0sRUFBRSxPQUFPLElBQUksS0FBSyxPQUFPO0FBQzlDLFVBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEtBQUssUUFBUSxRQUFRLFNBQVMsR0FBRyxFQUFFLEdBQUcsSUFBSSxLQUFNO0FBQ3JFLFdBQUssU0FBUyxHQUFHLElBQUk7QUFBQSxJQUN2QjtBQUFBLElBRVEsZUFBZTtBQUNyQixVQUFJLENBQUMsS0FBSyxPQUFPLGVBQWUsQ0FBQyxLQUFLLE9BQU8sYUFBYztBQUMzRCxXQUFLLE9BQU8sT0FBTztBQUFHLFdBQUssUUFBUSxLQUFLLE9BQU87QUFBYSxXQUFLLFFBQVEsS0FBSyxPQUFPO0FBQ3JGLFVBQUksS0FBSyxVQUFVLFdBQVcsS0FBSyxRQUFRLEVBQUcsTUFBSyxPQUFPLEtBQUssTUFBTSxFQUFFLEtBQUs7QUFBQSxJQUM5RTtBQUFBO0FBQUEsSUFFUSxJQUFJLEdBQVcsR0FBVztBQUNoQyxZQUFNLElBQUksS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsTUFBVyxDQUFDLEVBQUUsRUFBRSxZQUFZLEVBQUUsU0FBUyxLQUFLO0FBQzdFLFlBQU0sS0FBSyxLQUFLLEVBQUUsTUFBTSxFQUFFLFdBQVcsV0FBVztBQUNoRCxXQUFLLGNBQWMsT0FBTyxLQUFLLE1BQU0sQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLENBQUMsQ0FBQyxPQUFPLEtBQUssT0FBTyxXQUFXLElBQUksS0FBSyxPQUFPLFlBQVksT0FBTyxLQUFNLEdBQUcsU0FBUyxTQUFTLFVBQVUsR0FBRyxPQUFPLFNBQVUsU0FBUyxXQUFXLEtBQUssS0FBSztBQUNoTixVQUFJLEtBQUssVUFBVSxXQUFXLENBQUMsR0FBSTtBQUNuQyxVQUFJLEdBQUcsU0FBUyxPQUFRLE1BQUssT0FBTyxHQUFHLElBQUk7QUFBQSxlQUFZLEdBQUcsU0FBUyxPQUFRLE1BQUssYUFBYSxHQUFHLE1BQU07QUFBQSxJQUN4RztBQUFBLElBQ1EsT0FBTyxHQUFRO0FBQUUsV0FBSyxPQUFPLFNBQVMsU0FBUyxFQUFFLEdBQUc7QUFBRyxXQUFLLE9BQU8sVUFBVSxFQUFFLElBQUksTUFBTSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQzdGLFNBQVMsSUFBUyxLQUFhO0FBQUUsV0FBSyxVQUFVLEVBQUUsS0FBSyxLQUFLLE9BQU8sU0FBUyxNQUFNLEdBQUcsS0FBSyxLQUFLLE9BQU8sVUFBVSxFQUFFLE1BQU0sRUFBRTtBQUFHLFdBQUssUUFBUTtBQUFJLFdBQUssT0FBTztBQUFHLFdBQUssU0FBUztBQUFBLElBQUs7QUFBQSxJQUl4TCxXQUFXLEdBQXFCO0FBQzlCLFdBQUssVUFBVTtBQUNmLFVBQUksTUFBTSxVQUFVLEtBQUssT0FBUSxNQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsUUFBUSxHQUFHO0FBQ3ZFLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDakI7QUFBQSxJQUNRLFlBQVksSUFBWTtBQUM5QixZQUFNLElBQUksS0FBSztBQUFRLFVBQUksQ0FBQyxFQUFHO0FBQVEsWUFBTSxRQUFRLEVBQUUsU0FBUyxPQUFPLENBQUMsTUFBTSxFQUFFLEtBQUs7QUFBRyxVQUFJLENBQUMsTUFBTSxPQUFRO0FBQzNHLFVBQUksS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLEtBQUssS0FBSztBQUFNLGlCQUFXLEtBQUssT0FBTztBQUFFLGFBQUssS0FBSyxJQUFJLElBQUksRUFBRSxDQUFDO0FBQUcsYUFBSyxLQUFLLElBQUksSUFBSSxFQUFFLENBQUM7QUFBRyxhQUFLLEtBQUssSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUFHLGFBQUssS0FBSyxJQUFJLElBQUksRUFBRSxDQUFDO0FBQUEsTUFBRztBQUN2SyxZQUFNLE1BQU0sS0FBSyxPQUFPLGVBQWUsSUFBSSxLQUFLLE9BQU8sZ0JBQWdCLEdBQUcsT0FBTyxLQUFLLElBQUksS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUM3RyxZQUFNLE9BQU8sS0FBSyxNQUFNLEVBQUUsUUFBUSxNQUFNLEtBQUssTUFBTSxHQUFHLE1BQU0sS0FBSyxNQUFNO0FBQ3ZFLFlBQU0sSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxNQUFNLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLE9BQU8sR0FBRyxHQUFHLEtBQUssTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksQ0FBQyxDQUFDO0FBQ25KLFlBQU0sTUFBTSxJQUFJLFFBQVEsUUFBUSxJQUFJLE1BQU0sRUFBRSxHQUFHLE1BQU0sSUFBSSxRQUFRLFFBQVEsS0FBSyxPQUFPLEdBQUcsT0FBTyxJQUFJLEtBQUssS0FBSyxNQUFNLENBQUM7QUFDcEgsWUFBTSxJQUFJLElBQUksS0FBSyxJQUFJLENBQUMsS0FBSyxDQUFHO0FBQ2hDLFdBQUssT0FBTyxXQUFXLFFBQVEsUUFBUSxLQUFLLEtBQUssT0FBTyxVQUFVLEtBQUssQ0FBQztBQUFHLFdBQUssU0FBUyxRQUFRLFFBQVEsS0FBSyxLQUFLLFFBQVEsS0FBSyxDQUFDO0FBQUcsV0FBSyxPQUFPLFVBQVUsS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUFBLElBQy9LO0FBQUE7QUFBQTtBQUFBLElBSVEsYUFBYTtBQUNuQixVQUFJO0FBQ0YsY0FBTSxJQUFJLEtBQUs7QUFBRyxZQUFJLENBQUMsRUFBRztBQUMxQixZQUFJLEVBQUUsV0FBVyxZQUFZO0FBQUUsbUJBQVM7QUFBRztBQUFBLFFBQVE7QUFDbkQsWUFBSSxLQUFLLFVBQVUsV0FBVyxLQUFLLFVBQVUsUUFBUztBQUN0RCxjQUFNLE9BQW9CLEVBQUUsR0FBRyxHQUFHLE1BQU0sS0FBSyxNQUFNLFNBQVMsS0FBSyxTQUFTLFlBQVksZ0JBQWdCLE9BQU8sS0FBSyxPQUFPLE9BQU8sS0FBSyxVQUFVLFVBQVUsS0FBSyxRQUFRLE1BQU0sT0FBTyxlQUFlLENBQUMsRUFBRTtBQUNyTSxnQkFBUSxJQUFJO0FBQUEsTUFDZCxRQUFRO0FBQUEsTUFBd0M7QUFBQSxJQUNsRDtBQUFBO0FBQUEsSUFFUSxRQUFRLEdBQXdDO0FBQ3RELFlBQU0sRUFBRSxNQUFNLE1BQU0sSUFBSTtBQUN4QixXQUFLLE9BQU87QUFBTyxXQUFLLFlBQVk7QUFBRyxXQUFLLE1BQU0sT0FBTztBQUFHLG9CQUFjLEtBQUssVUFBVTtBQUN6RixXQUFLLE9BQU8sS0FBSztBQUFNLFdBQUssVUFBVSxLQUFLO0FBQVMsV0FBSyxJQUFJO0FBQU8sV0FBSyxhQUFhLE1BQU0sTUFBTTtBQUNsRyxXQUFLLFlBQVk7QUFBRyxPQUFDLEdBQUcsS0FBSyxRQUFRLE9BQU8sQ0FBQyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxRQUFRLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUN2SCxXQUFLLE1BQU07QUFBTSxXQUFLLFdBQVc7QUFBTyxXQUFLLFFBQVEsS0FBSyxVQUFVLFVBQVUsS0FBSyxRQUFRO0FBQU0sV0FBSyxRQUFRLEtBQUssUUFBUSxVQUFVO0FBQ3JJLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUcsV0FBSyxPQUFPLEtBQUssTUFBTSxFQUFFLEtBQUs7QUFBRyxXQUFLLE1BQU0sc0JBQXNCLE1BQU0sSUFBSSxJQUFJLFdBQVcsS0FBSyxDQUFDLEtBQUssTUFBTSxNQUFNLFNBQVMsTUFBTSxXQUFXLElBQUksS0FBSyxHQUFHLEdBQUc7QUFBQSxJQUNqTTtBQUFBLElBTUEsV0FBVyxJQUFhO0FBQ3RCLFdBQUssVUFBVTtBQUNmLFVBQUksTUFBTSxDQUFDLEtBQUssUUFBUTtBQUFFLGNBQU0sSUFBSSxTQUFTLGNBQWMsS0FBSztBQUFHLFVBQUUsS0FBSztBQUFVLFNBQUMsU0FBUyxlQUFlLFlBQVksS0FBSyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBQUcsYUFBSyxTQUFTO0FBQUEsTUFBRztBQUM5SyxVQUFJLEtBQUssT0FBUSxNQUFLLE9BQU8sTUFBTSxVQUFVLEtBQUssVUFBVTtBQUFBLElBQzlEO0FBQUEsSUFDUSxTQUFTLElBQVk7QUFqTi9CO0FBa05JLFVBQUksS0FBSyxJQUFLO0FBQ2QsV0FBSyxRQUFRLEtBQUssS0FBSyxJQUFJO0FBQUksV0FBSyxTQUFTLEtBQUssUUFBUSxLQUFLLEtBQUssUUFBUTtBQUFRLFdBQUssUUFBUSxLQUFLLElBQUksS0FBSyxRQUFRLFFBQVEsS0FBSyxRQUFRLENBQUM7QUFDN0ksWUFBTSxJQUFJLEtBQUs7QUFDZixVQUFJLE1BQU0sS0FBSyxVQUFVLFlBQVksS0FBSyxVQUFVLGVBQWU7QUFBRSxVQUFFO0FBQVUsVUFBRSxPQUFPO0FBQUksWUFBSSxLQUFLLEVBQUUsTUFBTyxHQUFFLFFBQVE7QUFBSSxZQUFJLEtBQUssS0FBTSxHQUFFO0FBQVEsVUFBRSxRQUFRLEtBQUssSUFBSSxFQUFFLE9BQU8sS0FBSyxTQUFTO0FBQUEsTUFBRztBQUNwTSxZQUFNLE1BQU0sWUFBWSxJQUFJO0FBQUcsVUFBSSxNQUFNLEtBQUssY0FBYyxJQUFLO0FBQVEsV0FBSyxjQUFjO0FBQzVGLFlBQU0sSUFBSSxNQUFNLEtBQUssS0FBSyxRQUFRLFNBQVMsR0FBRyxLQUFLLEtBQUssQ0FBQyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLENBQUMsSUFBSSxFQUFFO0FBQ3pILFdBQUssVUFBVSxFQUFFLEtBQUssTUFBTyxLQUFLLEtBQUssTUFBSyxPQUFFLEtBQUssTUFBTSxFQUFFLFNBQVMsSUFBSSxDQUFDLE1BQTdCLFlBQWtDLEdBQUcsUUFBTyxPQUFFLEVBQUUsU0FBUyxDQUFDLE1BQWQsWUFBbUIsRUFBRTtBQUM3RyxVQUFJLEtBQUssVUFBVSxLQUFLLFFBQVMsTUFBSyxPQUFPLGNBQWMsR0FBRyxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsQ0FBQyxTQUFTLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLENBQUM7QUFDdEssV0FBSyxHQUFHLGdCQUFnQjtBQUFBLElBQzFCO0FBQUEsSUFDUSxrQkFBa0I7QUFBRSxXQUFLLFlBQVksRUFBRSxRQUFRLEdBQUcsS0FBSyxHQUFHLE9BQU8sR0FBRyxNQUFNLEdBQUcsT0FBTyxLQUFLLFVBQVU7QUFBQSxJQUFHO0FBQUEsSUFDdEcsZ0JBQWdCO0FBQ3RCLFlBQU0sSUFBSSxLQUFLO0FBQVcsV0FBSyxZQUFZO0FBQU0sVUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLE9BQVE7QUFDdEUsV0FBSyxRQUFRLEtBQUssRUFBRSxNQUFNLEtBQUssRUFBRSxNQUFNLFNBQVMsS0FBSyxTQUFTLE9BQU8sRUFBRSxPQUFPLFVBQVUsS0FBSyxTQUFTLEtBQUssT0FBTyxTQUFTLFNBQVMsR0FBRyxLQUFLLEVBQUUsT0FBUSxFQUFFLE1BQU0sRUFBRSxTQUFTLFFBQVEsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxFQUFFLE1BQU0sUUFBUSxDQUFDLEdBQUcsU0FBUyxFQUFHLE1BQU0sRUFBRSxPQUFRLEVBQUUsUUFBUSxRQUFRLENBQUMsRUFBRSxDQUFDO0FBQ3JRLFVBQUksS0FBSyxRQUFRLFNBQVMsR0FBSSxNQUFLLFFBQVEsTUFBTTtBQUFBLElBQ25EO0FBQUEsSUFDQSxXQUFXO0FBQ1QsWUFBTSxLQUFLLEtBQUs7QUFBTyxVQUFJLENBQUMsS0FBSyxTQUFTLFFBQVEscUJBQXNCLE1BQUssUUFBUSxJQUFJLFFBQVEscUJBQXFCLEVBQUU7QUFDeEgsYUFBTyxFQUFFLEdBQUcsS0FBSyxTQUFTLFFBQVEsR0FBRyxnQkFBZ0IsRUFBRSxRQUFRLFdBQVcsR0FBRyxnQkFBZ0IsUUFBUSxPQUFPLEtBQUssUUFBUSxLQUFLLE1BQU0saUJBQWlCLFVBQVUsR0FBRztBQUFBLElBQ3BLO0FBQUEsSUFDQSxhQUFxQjtBQUNuQixZQUFNLElBQUksS0FBSyxTQUFTLEdBQUcsS0FBVSxLQUFLLE9BQU8sWUFBWSxLQUFLLE9BQU8sVUFBVSxJQUFJLENBQUM7QUFDeEYsWUFBTSxPQUFPLEtBQUssUUFBUSxJQUFJLENBQUMsTUFBTSxVQUFVLEVBQUUsSUFBSSxRQUFRLEVBQUUsT0FBTyxPQUFPLEVBQUUsS0FBSyxNQUFNLEVBQUUsR0FBRyw2QkFBNkIsRUFBRSxPQUFPLE9BQU8sRUFBRSxPQUFPLGtCQUFrQixFQUFFLFFBQVEsV0FBVztBQUM1TCxhQUFPO0FBQUEsUUFBQyxTQUFRLG9CQUFJLEtBQUssR0FBRSxZQUFZLENBQUM7QUFBQSxRQUFJLFdBQVcsVUFBVSxTQUFTO0FBQUEsUUFBSSxRQUFRLEdBQUcsWUFBWSxHQUFHLEtBQUssR0FBRyxVQUFVLEdBQUc7QUFBQSxRQUMzSCxVQUFVLE9BQU8sS0FBSyxJQUFJLE9BQU8sTUFBTSxjQUFjLFVBQVUsSUFBSSxXQUFXLFNBQVMsZ0JBQWdCLFlBQVksS0FBSyxPQUFPLGVBQWUsQ0FBQyxJQUFJLEtBQUssT0FBTyxnQkFBZ0IsQ0FBQyxtQkFBbUIsS0FBSyxPQUFPLHdCQUF3QixFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBQUEsUUFDblAsUUFBUSxFQUFFLElBQUksUUFBUSxDQUFDLENBQUMsaUJBQWlCLEVBQUUsSUFBSSxRQUFRLENBQUMsQ0FBQyxrQkFBa0IsRUFBRSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGFBQWEsRUFBRSxNQUFNLFFBQVEsQ0FBQyxDQUFDLHNCQUFzQixFQUFFLE1BQU0sc0JBQXNCLEVBQUUsU0FBUyxnQkFBZ0IsRUFBRSxLQUFLO0FBQUEsUUFDaE4sZ0JBQWdCLEtBQUssS0FBSyxXQUFXLEtBQUssU0FBUyxhQUFhLEtBQUssT0FBTyxnQkFBZ0IsY0FBYyxVQUFVLEtBQUssRUFBRSxJQUFJLFdBQVcsS0FBSyxFQUFFLE1BQU0sTUFBTTtBQUFBLFFBQzdKO0FBQUEsUUFBMEIsR0FBSSxLQUFLLFNBQVMsT0FBTyxDQUFDLG1EQUFtRDtBQUFBLE1BQUUsRUFBRSxLQUFLLElBQUk7QUFBQSxJQUN4SDtBQUFBO0FBQUEsSUFHQSxVQUFVO0FBQUUsWUFBTSxJQUFJLEtBQUs7QUFBRyxVQUFJLENBQUMsS0FBSyxFQUFFLFdBQVcsV0FBWSxRQUFPO0FBQU0sYUFBUSxFQUFFLE9BQU8sS0FBSyxFQUFFLE1BQU0sU0FBUyxLQUFLLEtBQUssVUFBVSxLQUFLLEVBQUUsTUFBTSxXQUFXLElBQUssRUFBRSxNQUFNLEVBQUUsTUFBTSxPQUFPLFdBQVcsQ0FBQyxHQUFHLFFBQVEsRUFBRSxRQUFRLFlBQVksZUFBZSxJQUFJO0FBQUEsSUFBTTtBQUFBO0FBQUEsSUFFblEsU0FBUztBQUFFLFdBQUssV0FBVyxJQUFJLGdCQUFnQixTQUFTLE1BQU0sRUFBRSxJQUFJLE1BQU0sSUFBSSxLQUFLLE9BQU8sS0FBSyxNQUFNLEtBQUssT0FBTyxJQUFJLEdBQUcsSUFBSSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQ2hJLFdBQVcsTUFBYztBQUN2QixXQUFLLE9BQU87QUFBTyxXQUFLLFNBQVM7QUFBTSxXQUFLLFlBQVk7QUFBRyxVQUFJLEtBQUssTUFBTyxNQUFLLE1BQU0sT0FBTztBQUM3RixXQUFLLE9BQU87QUFBTSxXQUFLLFVBQVU7QUFBRyxZQUFNLEtBQUssU0FBUztBQUFHLG9CQUFjLEdBQUcsVUFBVTtBQUFHLFdBQUssSUFBSSxTQUFTLEVBQUUsR0FBRyxpQkFBaUIsTUFBTSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUcsV0FBSyxhQUFhO0FBQzNLLFdBQUssWUFBWTtBQUFHLE9BQUMsR0FBRyxLQUFLLFFBQVEsT0FBTyxDQUFDLEVBQUUsUUFBUSxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUM7QUFBRyxXQUFLLFFBQVEsTUFBTTtBQUFHLFdBQUssVUFBVSxNQUFNO0FBQ3ZILFdBQUssTUFBTTtBQUFNLFdBQUssV0FBVztBQUFPLFdBQUssUUFBUTtBQUFNLFdBQUssUUFBUTtBQUN4RSxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFHLFdBQUssT0FBTyxLQUFLLE1BQU0sRUFBRSxLQUFLO0FBQUcsV0FBSyxNQUFNLDJCQUEyQixLQUFLLEVBQUUsTUFBTSw4Q0FBOEM7QUFBQSxJQUN4SztBQUFBLElBQ1EsY0FBYztBQUNwQixXQUFLLEtBQUssUUFBUSxDQUFDLEdBQUcsT0FBTztBQUFFLFlBQUksQ0FBQyxLQUFLLE1BQU0sSUFBSSxFQUFFLEVBQUcsR0FBRSxRQUFRO0FBQUEsTUFBRyxDQUFDO0FBQUcsV0FBSyxLQUFLLE1BQU07QUFBRyxXQUFLLE1BQU0sTUFBTTtBQUFHLFdBQUssVUFBVSxNQUFNO0FBQUcsV0FBSyxTQUFTO0FBQ3RKLFdBQUssT0FBTyxRQUFRLENBQUMsTUFBTSxFQUFFLEtBQUssUUFBUSxDQUFDO0FBQUcsV0FBSyxTQUFTLENBQUM7QUFBQSxJQUMvRDtBQUFBLElBQ1EsSUFBSSxNQUFjO0FBQUUsYUFBTyxRQUFRLEdBQUcsSUFBSTtBQUFBLElBQUc7QUFBQSxJQUNyRCxZQUFZO0FBQ1YsV0FBSyxXQUFXO0FBQ2hCLFlBQU0sU0FBUyxLQUFLLEVBQUUsTUFBTSxTQUFTLEtBQUs7QUFBWSxXQUFLLGFBQWEsS0FBSyxFQUFFLE1BQU07QUFDckYsWUFBTSxRQUFRLFNBQVMsS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU07QUFBRSxjQUFNLEtBQUssS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUcsZUFBTyxDQUFDLENBQUMsTUFBTSxHQUFHLFNBQVMsRUFBRTtBQUFBLE1BQU0sQ0FBQyxJQUFJO0FBQzdILFlBQU0sUUFBUSxJQUFJLElBQUksS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7QUFDbkQsaUJBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxLQUFLLFFBQVMsS0FBSSxDQUFDLE1BQU0sSUFBSSxFQUFFLEdBQUc7QUFDdEQsYUFBSyxVQUFVLE9BQU8sQ0FBQztBQUFHLGFBQUssUUFBUSxPQUFPLEVBQUU7QUFBRyxjQUFNLElBQUksRUFBRSxPQUFPO0FBQ3RFLFlBQUksT0FBTztBQUNULGdCQUFNLEtBQUssS0FBSyxJQUFJLE1BQU0sSUFBSSxHQUFHLEtBQUssRUFBRSxHQUFHLEtBQUssRUFBRSxHQUFHLEtBQUssRUFBRSxPQUFPLFFBQVE7QUFBRyxZQUFFLEtBQUssTUFBTTtBQUMzRixlQUFLO0FBQUEsWUFBTTtBQUFBLFlBQU0sQ0FBQyxNQUFNO0FBQUUsZ0JBQUUsT0FBTyxTQUFTLElBQUksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDO0FBQUcsZ0JBQUUsT0FBTyxRQUFRLE9BQU8sTUFBTSxJQUFJLE9BQU8sRUFBRTtBQUFBLFlBQUc7QUFBQSxZQUN0SyxNQUFNO0FBQUUsbUJBQUssTUFBTSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLEVBQUU7QUFBRyxnQkFBRSxRQUFRO0FBQUEsWUFBRztBQUFBLFVBQUM7QUFBQSxRQUMvRixPQUFPO0FBQUUsZUFBSyxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFHLFlBQUUsUUFBUTtBQUFBLFFBQUc7QUFBQSxNQUM5RjtBQUNBLGlCQUFXLEtBQUssS0FBSyxFQUFFLE9BQU87QUFDNUIsWUFBSSxJQUFJLEtBQUssUUFBUSxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQU0sSUFBSSxLQUFLLElBQUksRUFBRSxJQUFJO0FBQ3pELFlBQUksQ0FBQyxHQUFHO0FBQUUsY0FBSSxhQUFhLEtBQUssR0FBRyxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUk7QUFBRyxlQUFLLFFBQVEsSUFBSSxFQUFFLElBQUksQ0FBQztBQUFHLGVBQUssVUFBVSxJQUFJLEdBQUcsRUFBRSxFQUFFO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFHLFlBQUUsS0FBSyxPQUFPO0FBQUcsZUFBSyxTQUFTLEVBQUUsR0FBRyxFQUFFLENBQUM7QUFBRyxnQkFBTSxLQUFLLFFBQVE7QUFBRyxnQkFBTSxLQUFLO0FBQUcsZUFBSyxNQUFNLEtBQUssTUFBTTtBQUFFLGdCQUFJLEtBQUssVUFBVSxRQUFTLElBQUcsS0FBSyxNQUFNO0FBQUEsVUFBRyxDQUFDO0FBQUEsUUFBRyxPQUN4VTtBQUFFLFlBQUUsT0FBTyxTQUFTLElBQUksRUFBRSxHQUFHLEdBQUcsRUFBRSxDQUFDO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxjQUFJLEVBQUUsU0FBUyxFQUFFLE1BQU07QUFBRSxrQkFBTSxLQUFLO0FBQUcsY0FBRSxRQUFRLEVBQUUsSUFBSTtBQUFHLGlCQUFLLE1BQU0sU0FBUyxNQUFNLE9BQU8sRUFBRSxLQUFLLE9BQU8sR0FBRyxNQUFNLEtBQUssUUFBUSxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztBQUFBLFVBQUc7QUFBQSxRQUFFO0FBQUEsTUFDak87QUFDQSxlQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxNQUFLLEtBQUssR0FBRyxRQUFRO0FBQzFELFlBQU0sTUFBTSxLQUFLO0FBQ2pCLFVBQUksT0FBTyxJQUFJLFNBQVMsVUFBVSxLQUFLLFVBQVUsU0FBUztBQUN4RCxpQkFBUyxJQUFJLEdBQUcsSUFBSSxZQUFZLElBQUssS0FBSSxTQUFTLEtBQUssR0FBRyxDQUFDLEVBQUcsTUFBSyxLQUFLLEdBQUcsVUFBVSxLQUFLLEdBQUcsSUFBSSxHQUFHLElBQUksU0FBUyxRQUFRO0FBQ3pILG1CQUFXLEtBQUssS0FBSyxFQUFFLE1BQU8sS0FBSSxpQkFBaUIsS0FBSyxHQUFHLElBQUksS0FBSyxFQUFFLEVBQUUsRUFBRyxNQUFLLEtBQUssRUFBRSxNQUFNLFNBQVM7QUFBQSxNQUN4RztBQUNBLFVBQUksT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUM5QixjQUFNLElBQUksS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLElBQUksRUFBRTtBQUNsRCxZQUFJLEdBQUc7QUFBRSxlQUFLLEtBQUssRUFBRSxNQUFNLEtBQUs7QUFBRyxxQkFBVyxLQUFLLEtBQUssRUFBRSxNQUFPLEtBQUksaUJBQWlCLEdBQUcsQ0FBQyxFQUFHLE1BQUssS0FBSyxFQUFFLE1BQU0sU0FBUztBQUFHLG1CQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxLQUFJLFNBQVMsS0FBSyxHQUFHLENBQUMsRUFBRyxNQUFLLEtBQUssR0FBRyxNQUFNO0FBQUEsUUFBRztBQUFBLE1BQ2pOO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFUSxRQUFRLEdBQWUsR0FBVyxHQUFXO0FBQ25ELFlBQU0sS0FBSyxPQUFPO0FBQUcsUUFBRSxNQUFNO0FBQUcsWUFBTSxTQUFTLEVBQUUsT0FBTyxRQUFRO0FBQ2hFLFdBQUssT0FBTyxHQUFHLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxNQUFNLEdBQUcsR0FBRyxLQUFLLEdBQUssSUFBSTtBQUFHLFdBQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxPQUFPLEdBQUcsR0FBRyxJQUFJLFFBQVEsT0FBTyxHQUFHLEdBQUcsQ0FBQyxHQUFHLEtBQUssR0FBSyxHQUFHLENBQUM7QUFDekosV0FBSyxNQUFNLEdBQUcsR0FBRyxDQUFDLEdBQUcsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQUcsV0FBSyxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQzNILFdBQUssTUFBTSxNQUFNLENBQUMsTUFBTSxFQUFFLE9BQU8sUUFBUSxPQUFPLFVBQVUsSUFBSSxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxLQUFLLElBQUksSUFBSSxLQUFLLEdBQUcsTUFBTSxFQUFFLE9BQU8sUUFBUSxPQUFPLE1BQU0sQ0FBQztBQUFBLElBQ3JKO0FBQUEsSUFDUSxTQUFTLEdBQVcsR0FBVztBQUFFLFdBQUssTUFBTSxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLEdBQUcsQ0FBQyxNQUFNLEtBQUssS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFHLFdBQUssT0FBTyxHQUFHLEdBQUcsSUFBSSxRQUFRLE9BQU8sS0FBSyxLQUFLLENBQUMsR0FBRyxLQUFLLEtBQUssR0FBRztBQUFBLElBQUc7QUFBQTtBQUFBLElBRzdLLE1BQU0sS0FBYTtBQUFFLFdBQUssR0FBRyxNQUFNLEdBQUc7QUFBQSxJQUFHO0FBQUEsSUFDekMsT0FBTyxLQUFhO0FBQ2xCLFVBQUksS0FBSyxVQUFVLFFBQVM7QUFDNUIsVUFBSSxLQUFLLFVBQVU7QUFBRSxZQUFJLGNBQWMsS0FBSyxHQUFHLEdBQUcsR0FBRztBQUFFLGVBQUssTUFBTSxpQ0FBaUM7QUFBRyxlQUFLLFdBQVc7QUFBQSxRQUFPLE1BQU8sTUFBSyxNQUFNLCtCQUErQjtBQUFBLE1BQUcsTUFDNUssTUFBSyxNQUFNLEtBQUssT0FBTyxLQUFLLElBQUksU0FBUyxVQUFVLEtBQUssSUFBSSxRQUFRLE1BQU0sT0FBTyxFQUFFLE1BQU0sUUFBUSxJQUFJO0FBQzFHLFdBQUssZ0JBQWdCO0FBQU8sV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUMvRDtBQUFBLElBQ0EsT0FBTyxNQUFjO0FBQ25CLFlBQU0sSUFBSSxLQUFLLEdBQUcsTUFBTSxLQUFLO0FBQUssVUFBSSxLQUFLLFVBQVUsUUFBUztBQUM5RCxZQUFNLE9BQU8sRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxJQUFJO0FBQUcsVUFBSSxNQUFNO0FBQUUsYUFBSyxhQUFhLEtBQUssUUFBUSxJQUFJLEtBQUssRUFBRSxDQUFFO0FBQUc7QUFBQSxNQUFRO0FBQ3RILFVBQUksT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUM5QixZQUFJLFVBQVUsR0FBRyxJQUFJLEdBQUcsR0FBRztBQUFFLGlCQUFPLEdBQUcsSUFBSSxLQUFLLElBQUk7QUFBRyxlQUFLLE1BQU07QUFBQSxRQUFNLE9BQ25FO0FBQUUsZ0JBQU0sT0FBTyxFQUFFLEtBQUssSUFBSSxHQUFHO0FBQUcsZUFBSyxNQUFNLHdCQUF3QixVQUFVLElBQUksQ0FBQyxVQUFVLEtBQUssTUFBTSxDQUFDLENBQUMsY0FBYyxhQUFhLENBQUMsQ0FBQyxRQUFRO0FBQUEsUUFBRztBQUFBLE1BQ3hKLFdBQVcsT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUFFLFlBQUksU0FBUyxHQUFHLElBQUksSUFBSSxJQUFJLEVBQUcsTUFBSyxNQUFNO0FBQUEsTUFBTTtBQUN6RixXQUFLLGdCQUFnQjtBQUFPLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDL0Q7QUFBQSxJQUNBLGFBQWEsR0FBZTtBQUMxQixZQUFNLEtBQUssS0FBSyxVQUFVLElBQUksQ0FBQztBQUFHLFVBQUksT0FBTyxVQUFhLEtBQUssVUFBVSxRQUFTO0FBQ2xGLFlBQU0sSUFBSSxLQUFLLEdBQUcsSUFBSSxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUU7QUFDckQsVUFBSSxLQUFLLFVBQVU7QUFBRSxZQUFJLFNBQVMsR0FBRyxFQUFFLEdBQUc7QUFBRSxlQUFLLE1BQU0sUUFBUSxVQUFVLEVBQUUsSUFBSSxDQUFDLDBCQUEwQjtBQUFHLGVBQUssV0FBVztBQUFBLFFBQU8sTUFBTyxNQUFLLE1BQU0sRUFBRSxRQUFRLG1EQUFtRCwrQkFBK0I7QUFBQSxNQUFHLFdBQzVPLEtBQUssT0FBTyxLQUFLLElBQUksU0FBUyxVQUFVLEVBQUUsS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsS0FBSyxFQUFFLE1BQU0sVUFBVSxtQkFBbUI7QUFDdkksWUFBSSxjQUFjLEdBQUcsS0FBSyxJQUFJLEtBQUssRUFBRSxHQUFHO0FBQUUsZUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLEdBQUc7QUFBRyxlQUFLLE1BQU0saUNBQWlDLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRztBQUFBLFFBQUcsTUFDekksTUFBSyxNQUFNLDBDQUEwQyxLQUFLLEVBQUUsTUFBTSxDQUFDLElBQUksS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDLG1CQUFtQixhQUFhLENBQUMsQ0FBQyxRQUFRO0FBQUEsTUFDdkksV0FDUyxLQUFLLE9BQU8sS0FBSyxJQUFJLFNBQVMsVUFBVSxLQUFLLElBQUksT0FBTyxJQUFJO0FBQ25FLGNBQU0sSUFBSSxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFRLEtBQUssSUFBWSxFQUFFO0FBQzNELFlBQUksaUJBQWlCLEdBQUcsQ0FBQyxHQUFHO0FBQUUsd0JBQWMsR0FBRyxFQUFFLElBQUksRUFBRSxFQUFFO0FBQUcsZUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLElBQUksRUFBRSxHQUFHO0FBQUcsZUFBSyxNQUFNLGlCQUFpQixFQUFFLElBQUksU0FBUyxVQUFVLEVBQUUsSUFBSSxDQUFDLEdBQUc7QUFBQSxRQUFHLE1BQU8sTUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLEdBQUc7QUFBQSxNQUM1TSxNQUFPLE1BQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxJQUFJLFNBQVMsVUFBVSxLQUFLLElBQUksT0FBTyxLQUFLLE9BQU8sRUFBRSxNQUFNLFFBQVEsR0FBRztBQUN6RyxXQUFLLGdCQUFnQjtBQUFPLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDL0Q7QUFBQSxJQUNBLGdCQUFnQjtBQUNkLFlBQU0sSUFBSSxLQUFLLEdBQUcsTUFBTSxLQUFLO0FBQUssVUFBSSxDQUFDLE9BQU8sSUFBSSxTQUFTLE9BQVE7QUFDbkUsWUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sSUFBSSxFQUFFO0FBQUcsWUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLGlCQUFpQixHQUFHLENBQUMsQ0FBQztBQUN6RyxVQUFJLEtBQUssR0FBRztBQUFFLHNCQUFjLEdBQUcsRUFBRSxJQUFJLEVBQUUsRUFBRTtBQUFHLGFBQUssTUFBTSxpQkFBaUIsRUFBRSxJQUFJLFNBQVMsVUFBVSxFQUFFLElBQUksQ0FBQyxHQUFHO0FBQUEsTUFBRyxNQUFPLE1BQUssTUFBTSx1REFBdUQ7QUFDdkwsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUNuQztBQUFBLElBQ0EsaUJBQWlCO0FBQ2YsWUFBTSxNQUFNLEtBQUs7QUFBSyxVQUFJLENBQUMsT0FBTyxJQUFJLFNBQVMsT0FBUTtBQUN2RCxVQUFJLENBQUMsS0FBSyxlQUFlO0FBQUUsYUFBSyxnQkFBZ0I7QUFBTSxhQUFLLE1BQU0sK0RBQStEO0FBQUcsYUFBSyxHQUFHLE9BQU87QUFBRztBQUFBLE1BQVE7QUFDN0osY0FBUSxLQUFLLEdBQUcsSUFBSSxFQUFFO0FBQUcsV0FBSyxNQUFNO0FBQU0sV0FBSyxnQkFBZ0I7QUFBTyxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFBLElBQ3pHO0FBQUEsSUFDQSxhQUFhO0FBQUUsVUFBSSxLQUFLLFVBQVUsUUFBUztBQUFRLFVBQUksS0FBSyxFQUFFLGFBQWE7QUFBRSxhQUFLLE1BQU0sK0JBQStCO0FBQUc7QUFBQSxNQUFRO0FBQUUsV0FBSyxXQUFXLENBQUMsS0FBSztBQUFVLFdBQUssTUFBTTtBQUFNLFVBQUksS0FBSyxTQUFVLE1BQUssTUFBTSxnRkFBZ0Y7QUFBRyxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFBLElBQUc7QUFBQTtBQUFBLElBRzFVLGNBQWM7QUFDWixVQUFJLEtBQUssVUFBVSxXQUFXLENBQUMsS0FBSyxFQUFFLE1BQU0sUUFBUTtBQUFFLFlBQUksQ0FBQyxLQUFLLEVBQUUsTUFBTSxPQUFRLE1BQUssTUFBTSxpQ0FBaUM7QUFBRztBQUFBLE1BQVE7QUFDdkksV0FBSyxZQUFZO0FBQUcsWUFBTSxLQUFLLE9BQU87QUFBRyxXQUFLLGdCQUFnQjtBQUM5RCxXQUFLLE1BQU07QUFBTSxXQUFLLFdBQVc7QUFBTyxXQUFLO0FBQVcsV0FBSyxVQUFVO0FBQU8sV0FBSyxXQUFXO0FBQzlGLFlBQU0sSUFBSSxLQUFLLEdBQUcsUUFBUSxFQUFFLE1BQU0sTUFBTTtBQUN4QyxZQUFNLFFBQVEsU0FBUyxFQUFFLE9BQU8sU0FBaUMsQ0FBQztBQUFHLGlCQUFXLEtBQUssT0FBTyxLQUFLLEtBQUssRUFBRyxRQUFPLENBQUMsSUFBSyxNQUFjLENBQUMsRUFBRTtBQUN2SSxXQUFLLFNBQVMsSUFBSSxPQUFPLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsVUFBVSxFQUFFLE1BQU0sS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLE1BQU0sRUFBRSxPQUFPLEtBQUssS0FBSyxTQUFTLE1BQU07QUFDN0ssV0FBSyxLQUFLLE1BQU07QUFBRyxXQUFLLE1BQU0sTUFBTTtBQUFHLFdBQUssVUFBVSxNQUFNO0FBQzVELFdBQUssT0FBTyxTQUFTLFFBQVEsQ0FBQyxNQUFNO0FBQ2xDLFlBQUksRUFBRSxTQUFTLEdBQUc7QUFBRSxnQkFBTSxJQUFJLE1BQU0sRUFBRSxLQUFLLENBQUM7QUFBRyxnQkFBTSxJQUFJLEtBQUssUUFBUSxJQUFJLEVBQUUsRUFBRTtBQUFJLGVBQUssS0FBSyxJQUFJLEVBQUUsSUFBSSxDQUFDO0FBQUcsZUFBSyxNQUFNLElBQUksRUFBRSxJQUFJLEVBQUUsRUFBRTtBQUFHLFlBQUUsTUFBTSxDQUFDO0FBQUcsWUFBRSxRQUFRLEVBQUUsVUFBVSxJQUFJLElBQUk7QUFBQSxRQUFHLE9BQzlLO0FBQUUsZ0JBQU0sSUFBSSxhQUFhLEtBQUssR0FBRyxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUk7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUFHLFlBQUUsT0FBTyxTQUFTLElBQUksQ0FBQyxLQUFLLEtBQUs7QUFBRyxZQUFFLEtBQUssT0FBTztBQUFHLFlBQUUsTUFBTSxDQUFDO0FBQUcsWUFBRSxRQUFRLEVBQUUsVUFBVSxJQUFJLElBQUk7QUFBRyxlQUFLLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQztBQUFHLGVBQUssTUFBTSxLQUFLLE1BQU07QUFBRSxnQkFBSSxFQUFFLFVBQVUsUUFBUyxHQUFFLEtBQUssTUFBTTtBQUFBLFVBQUcsQ0FBQztBQUFHLGVBQUssTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxRQUFHO0FBQUEsTUFDdFcsQ0FBQztBQUNELGVBQVMsSUFBSSxHQUFHLElBQUksWUFBWSxJQUFLLE1BQUssS0FBSyxHQUFHLFFBQVE7QUFDMUQsV0FBSyxRQUFRO0FBQWMsV0FBSyxjQUFjO0FBQUssV0FBSyxNQUFNO0FBQUcsV0FBSyxTQUFTLEtBQUssTUFBTSxFQUFFLFFBQVEsR0FBRztBQUFHLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDN0k7QUFBQSxJQUNR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V0FBVyxLQUFLO0FBQUcsWUFBTSxNQUFvQixDQUFDO0FBQUcsVUFBSSxPQUFjO0FBQ3RILFlBQU0sVUFBVSxNQUFNO0FBQUUsWUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUFHLFlBQUksU0FBUztBQUFHLGNBQU0sUUFBUSxDQUFDLE1BQU0sTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLElBQUksTUFBTTtBQUFFLGdCQUFNLElBQUksYUFBYSxLQUFLLEdBQUcsTUFBTSxNQUFNLEVBQUU7QUFBRyxZQUFFLE9BQU8sU0FBUyxLQUFLLElBQUksT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLElBQUk7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFNLFlBQUUsS0FBSyxNQUFNO0FBQUcsY0FBSSxLQUFLLENBQUM7QUFBQSxRQUFHLENBQUMsQ0FBQztBQUFBLE1BQUc7QUFDdFQsY0FBUTtBQUFHLFdBQUssT0FBTyxTQUFTLElBQUksR0FBRyxLQUFLLEtBQUs7QUFBRyxXQUFLLE9BQU8sVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssSUFBSSxDQUFDO0FBQUcsV0FBSyxPQUFPLE1BQU07QUFDaEksTUFBQyxPQUFlLFlBQVksRUFBRSxTQUFTLENBQUMsTUFBYTtBQUFFLGVBQU87QUFBRyxnQkFBUTtBQUFBLE1BQUcsR0FBRyxJQUFJO0FBQ25GLFVBQUksT0FBTyxZQUFZLElBQUk7QUFBRyxXQUFLLE9BQU8sY0FBYyxNQUFNO0FBQUUsY0FBTSxJQUFJLFlBQVksSUFBSSxHQUFHLEtBQUssS0FBSyxJQUFJLE9BQU8sSUFBSSxRQUFRLEdBQUk7QUFBRyxlQUFPO0FBQUcsWUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxDQUFDO0FBQUcsYUFBSyxNQUFNLE9BQU87QUFBQSxNQUFHLENBQUM7QUFBQSxJQUN6TTtBQUFBLEVBQ0Y7OztBQ2xmQSxNQUFNLElBQUksSUFBSSxLQUFLO0FBQ25CLEVBQUMsT0FBZSxTQUFTO0FBQ3pCLElBQUUsS0FBSyxTQUFTLGVBQWUsR0FBRyxDQUFzQixFQUNyRCxLQUFLLE1BQU07QUFBRSxVQUFNLElBQUksU0FBUyxlQUFlLFNBQVM7QUFBRyxRQUFJLEVBQUcsR0FBRSxNQUFNLFVBQVU7QUFBUSxJQUFDLE9BQWUsY0FBYztBQUFNLFdBQU8sY0FBYyxJQUFJLE1BQU0sa0JBQWtCLENBQUM7QUFBQSxFQUFHLENBQUMsRUFDdEwsTUFBTSxDQUFDLE1BQU07QUFDWixVQUFNLElBQUksU0FBUyxlQUFlLFNBQVM7QUFBRyxRQUFJLEdBQUc7QUFBRSxRQUFFLE1BQU0sVUFBVTtBQUFRLFFBQUUsY0FBYyxhQUFhLEtBQUssRUFBRSxVQUFVLEVBQUUsVUFBVTtBQUFBLElBQUk7QUFDL0ksWUFBUSxNQUFNLENBQUM7QUFBQSxFQUNqQixDQUFDOyIsCiAgIm5hbWVzIjogWyJ0ZyIsICJnIiwgImciLCAiS0VZIiwgIlZFUlNJT04iLCAic3RhZ2VXYXZlcyIsICJkcmF3IiwgImciLCAiZyJdCn0K
