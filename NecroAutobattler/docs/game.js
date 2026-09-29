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
  function simulate(players, enemies, seed = 1, maxSeconds = 130, levels) {
    const b = new Battle(players, enemies, seed, levels);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2NvcmUvYmF0dGxlLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9wYWNrcy50cyIsICIuLi9jb3JlL3NhdmUudHMiLCAiLi4vZ2FtZS9uZWNyb21hbmNlci50cyIsICIuLi9nYW1lL2F1ZGlvLnRzIiwgIi4uL2NvcmUvcnVuc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvdmlzdWFscy50cyIsICIuLi91aS9pY29ucy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXSB9O1xuICBzaW06IHsgc2VwYXJhdGlvbjogbnVtYmVyOyBoaXRGcmFjdGlvbjogbnVtYmVyOyB0aW1lTGltaXQ6IG51bWJlcjsgcmV0YXJnZXRFdmVyeTogbnVtYmVyIH07XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUUzogQmFsYW5jZSA9IHtcbiAgc3RhdHM6IHtcbiAgICB3YXJyaW9yOiAgIHsgaHA6IDYwLCAgZG1nOiA4LCAgaW50ZXJ2YWw6IDAuOSwgcmFuZ2U6IDAuODUsIHNwZWVkOiAxLjQsIHNpemU6IDAuMjgsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC40NyB9LFxuICAgIGFyY2hlcjogICAgeyBocDogNDAsICBkbWc6IDcsICBpbnRlcnZhbDogMS43LCByYW5nZTogNS4wLCAgc3BlZWQ6IDEuMSwgc2l6ZTogMC4yNiwgYW5pbUxlbjogMS41LCBoaXRGcmFjOiAwLjc4IH0sXG4gICAgZ29ibGluOiAgICB7IGhwOiA0NSwgIGRtZzogOSwgIGludGVydmFsOiAwLjgsIHJhbmdlOiAwLjgsICBzcGVlZDogMS43LCBzaXplOiAwLjI0LCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIGtuaWdodDogICAgeyBocDogMTMwLCBkbWc6IDksICBpbnRlcnZhbDogMS4xLCByYW5nZTogMC45LCAgc3BlZWQ6IDEuMCwgc2l6ZTogMC4zMiwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgICBvZ3JlOiAgICAgIHsgaHA6IDE3MCwgZG1nOiAxNiwgaW50ZXJ2YWw6IDEuOSwgcmFuZ2U6IDEuMDUsIHNwZWVkOiAwLjgsIHNpemU6IDAuNDIsIGFuaW1MZW46IDEuMiwgaGl0RnJhYzogMC41NSB9LFxuICAgIGJhcmJhcmlhbjogeyBocDogNzUsICBkbWc6IDgsICBpbnRlcnZhbDogMC45NSwgcmFuZ2U6IDAuOSwgc3BlZWQ6IDEuNSwgc2l6ZTogMC4zMCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgfSxcbiAgLy8gXCJib2RpZXMgPSBkYW1hZ2UsIHN0YXJzID0gZHVyYWJpbGl0eVwiOiBIUCBncm93cyBmYXN0ZXIgdGhhbiBkYW1hZ2UgcGVyIHN0YXJcbiAgc3RhcjogeyBocDogWzEsIDIuMCwgMy4yXSwgZG1nOiBbMSwgMS41LCAyLjBdLCBzY2FsZTogWzEsIDEuMTIsIDEuMjVdIH0sXG4gIHBoYWxhbng6IHsgcmFkaXVzOiAyLjAsIHBlckFsbHk6IDAuMDgsIG1heFN0YWNrczogMyB9LFxuICAvLyBtYW5hIGZpbGxzIGZhc3Q6IGEgYmFzaWMgYXR0YWNrIGdpdmVzIHBlckF0dGFjaywgdGFraW5nIGEgaGl0IGdpdmVzIHBlckhpdDsgYSBmdWxsIGJhciBmaXJlcyB0aGUgc2tpbGwgb24gdGhlIG5leHQgYXR0YWNrLCB0aGVuIHJlc2V0c1xuICBtYW5hOiB7XG4gICAgYXJjaGVyOiB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDM0LCBwZXJIaXQ6IDYgfSwgICAgIC8vIFNwbGl0IEFycm93IGFib3V0IGV2ZXJ5IDNyZCBzaG90XG4gICAgb2dyZTogICB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDM0LCBwZXJIaXQ6IDYgfSwgICAgIC8vIFNtYXNoIGFib3V0IGV2ZXJ5IDNyZCBzd2luZ1xuICAgIGtuaWdodDogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAyNSwgcGVySGl0OiAxMiB9LCAgICAvLyBUYXVudCBldmVyeSB+NCBzd2luZ3MsIHNvb25lciB3aGVuIGhlIGlzIGJlaW5nIGhpdFxuICB9LFxuICB2b2xsZXk6IHsgdGFyZ2V0czogMywgcHJvamVjdGlsZVNwZWVkOiAxNCB9LFxuICBvcHBvcnR1bmlzdDogeyBib251czogMC41LCBzZWVrUmFkaXVzOiA0LjAsIHdvdW5kZWRXZWlnaHQ6IDEuNSB9LFxuICB0YXVudDogeyBkdXJhdGlvbjogMywgcmFkaXVzOiA0LjUgfSxcbiAgc21hc2g6IHsgbXVsdDogMi4wLCByYWRpdXM6IDEuNiB9LFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IDAuMTIsIG1heFN0YWNrczogOCwgcmVzZXRBZnRlcjogMC42IH0sXG4gIGxldmVsOiB7IGhwOiAwLjA4LCBkbWc6IDAuMDgsIGNvcGllc1RvTGV2ZWw6IFs1LCAxMCwgMjAsIDQwLCA4MCwgMTIwLCAyMDAsIDMwMCwgNTAwXSB9LFxuICBzaW06IHsgc2VwYXJhdGlvbjogMC42LCBoaXRGcmFjdGlvbjogMC40NywgdGltZUxpbWl0OiAxMjAsIHJldGFyZ2V0RXZlcnk6IDAuNSB9LFxufTtcblxuZXhwb3J0IGNvbnN0IEJBTEFOQ0U6IEJhbGFuY2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNldEJhbGFuY2UoKTogdm9pZCB7XG4gIGNvbnN0IGZyZXNoOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoZnJlc2gpIGFzIChrZXlvZiBCYWxhbmNlKVtdKSAoQkFMQU5DRSBhcyBhbnkpW2tdID0gKGZyZXNoIGFzIGFueSlba107XG59XG5cbmV4cG9ydCBjb25zdCBST0xFX1RFWFQ6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdDaGVhcCBhbmQgZmFzdC4gVG91Z2hlciBuZWFyIG90aGVyIFdhcnJpb3JzLicsXG4gIGFyY2hlcjogJ0ZyYWdpbGUuIFNraWxsOiBTcGxpdCBBcnJvdyBoaXRzIDMgZGlmZmVyZW50IGVuZW1pZXMuJyxcbiAgZ29ibGluOiAnRmFzdC4gSGl0cyBoYXJkZXIgb24gZW5lbWllcyBmaWdodGluZyBzb21lb25lIGVsc2UuJyxcbiAga25pZ2h0OiAnVGFuay4gU2tpbGw6IFRhdW50IHB1bGxzIGVuZW1pZXMgb250byBoaW0uJyxcbiAgb2dyZTogJ1Nsb3csIGh1Z2UgZGFtYWdlLiBTa2lsbDogU21hc2gsIGEgYmlnIGFyZWEgc2xhbS4nLFxuICBiYXJiYXJpYW46ICdTd2luZ3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBoaXQuJyxcbn07XG5cbmV4cG9ydCBjb25zdCBTT1VMX05BTUU6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdTa2VsZXRvbiBXYXJyaW9yJywgYXJjaGVyOiAnU2tlbGV0b24gQXJjaGVyJywgZ29ibGluOiAnR29ibGluJyxcbiAga25pZ2h0OiAnS25pZ2h0Jywgb2dyZTogJ09ncmUnLCBiYXJiYXJpYW46ICdCYXJiYXJpYW4nLFxufTtcblxuLyoqIEFiaWxpdHkgYmx1cmJzIGZvciB0aGUgU291bHMgcGFnZSwgd2l0aCB0aGUgbGl2ZSBudW1iZXJzIGZpbGxlZCBpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhYmlsaXR5SW5mbyhzb3VsOiBTb3VsSWQpOiB7IGtpbmQ6ICdza2lsbCcgfCAncGFzc2l2ZSc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nIH0ge1xuICBjb25zdCBCID0gQkFMQU5DRSwgcGN0ID0gKHg6IG51bWJlcikgPT4gTWF0aC5yb3VuZCh4ICogMTAwKSArICclJztcbiAgc3dpdGNoIChzb3VsKSB7XG4gICAgY2FzZSAnd2Fycmlvcic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ1BoYWxhbngnLCB0ZXh0OiBgVGFrZXMgJHtwY3QoQi5waGFsYW54LnBlckFsbHkpfSBsZXNzIGRhbWFnZSBmb3IgZWFjaCBvdGhlciBTa2VsZXRvbiBXYXJyaW9yIHdpdGhpbiAke0IucGhhbGFueC5yYWRpdXN9bSAodXAgdG8gJHtCLnBoYWxhbngubWF4U3RhY2tzfSkuYCB9O1xuICAgIGNhc2UgJ2dvYmxpbic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ09wcG9ydHVuaXN0JywgdGV4dDogYERlYWxzICR7cGN0KEIub3Bwb3J0dW5pc3QuYm9udXMpfSBtb3JlIGRhbWFnZSB0byBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZSwgYW5kIHByZWZlcnMgc3VjaCB0YXJnZXRzLmAgfTtcbiAgICBjYXNlICdiYXJiYXJpYW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdGcmVuenknLCB0ZXh0OiBgQXR0YWNrcyAke3BjdChCLmZyZW56eS5wZXJTd2luZyl9IGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmcgKHVwIHRvICR7Qi5mcmVuenkubWF4U3RhY2tzfSB0aW1lcykuYCB9O1xuICAgIGNhc2UgJ2FyY2hlcic6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTcGxpdCBBcnJvdycsIHRleHQ6IGBCYXNpYyBzaG90cyBmaXJlIG9uZSBhcnJvdy4gV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHNob3QgZmlyZXMgYXQgdXAgdG8gJHtCLnZvbGxleS50YXJnZXRzfSBkaWZmZXJlbnQgZW5lbWllcy5gIH07XG4gICAgY2FzZSAna25pZ2h0JzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1RhdW50JywgdGV4dDogYFdoZW4gbWFuYSBpcyBmdWxsLCBlbmVtaWVzIHdpdGhpbiAke0IudGF1bnQucmFkaXVzfW0gbXVzdCBhdHRhY2sgaGltIGZvciAke0IudGF1bnQuZHVyYXRpb259cy5gIH07XG4gICAgY2FzZSAnb2dyZSc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTbWFzaCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgdGhlIG5leHQgc3dpbmcgZGVhbHMgJHtCLnNtYXNoLm11bHR9eCBkYW1hZ2UgYW5kIGhpdHMgZW5lbWllcyBuZWFyIHRoZSB0YXJnZXQgZm9yIDYwJSBhcyBtdWNoLmAgfTtcbiAgfVxufVxuIiwgIi8vIERlc2lnbiBkYXRhIHN0cmFpZ2h0IGZyb20gdGhlIHBsYW4gZG9jLiBBbnl0aGluZyBtYXJrZWQgUExBQ0VIT0xERVIgaXMgbm90IGluIHRoZSBkb2MgeWV0LlxuXG5leHBvcnQgdHlwZSBTb3VsSWQgPSAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJztcblxuZXhwb3J0IGNvbnN0IFNPVUxTOiBTb3VsSWRbXSA9IFsnd2FycmlvcicsICdhcmNoZXInLCAnZ29ibGluJywgJ2tuaWdodCcsICdvZ3JlJywgJ2JhcmJhcmlhbiddO1xuXG4vKiogRG9taW5pb24gY29zdCBwZXIgc3RhciBsZXZlbDogaW5kZXggMCA9IDEgc3RhciwgMSA9IDIgc3RhcnMsIDIgPSAzIHN0YXJzICgzIHN0YXJzIGlzIHRoZSBtYXgpLiAqL1xuZXhwb3J0IGNvbnN0IENPU1Q6IFJlY29yZDxTb3VsSWQsIG51bWJlcltdPiA9IHtcbiAgd2FycmlvcjogWzIsIDMsIDRdLFxuICBhcmNoZXI6IFs0LCA2LCA5XSxcbiAgZ29ibGluOiBbMywgNCwgNl0sXG4gIGtuaWdodDogWzUsIDcsIDEwXSxcbiAgb2dyZTogWzcsIDEwLCAxNV0sXG4gIGJhcmJhcmlhbjogWzUsIDcsIDEwXSwgLy8gUExBQ0VIT0xERVI6IHRoZSBkb2MgaGFzIG5vIGNvc3QgZm9yIHRoZSBzaXh0aCBTb3VsIHlldFxufTtcblxuZXhwb3J0IGNvbnN0IE1BWF9TVEFSID0gMztcbmV4cG9ydCBjb25zdCBHUklEX0NFTExTID0gMTI7IC8vIDQgeCAzXG5cbi8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUgKGluZGV4IDAgPSB3YXZlIDEpLiAqL1xuZXhwb3J0IGNvbnN0IENVUlZFUzogUmVjb3JkPHN0cmluZywgbnVtYmVyW10+ID0ge1xuICAvLyBMT0NLRUQgKGNvbmZpcm1lZCk6ICs0IGZvciB3YXZlcyAyLTUsIHRoZW4gKzMgZm9yIHdhdmVzIDYtMTAgLT4gNDBcbiAgZG9jOiBbOSwgMTMsIDE3LCAyMSwgMjUsIDI4LCAzMSwgMzQsIDM3LCA0MF0sXG4gIC8vIE5PVCBVU0VEOiBtaXNyZW1lbWJlcmVkIHZhcmlhbnQgKCszIHRocm91Z2ggd2F2ZSA2LCB0aGVuICsyKSB0aGF0IG9ubHkgcmVhY2hlcyAzMi4gS2VwdCBmb3IgY29tcGFyaXNvbiBvbmx5LlxuICByZWNhbGxlZDogWzksIDEyLCAxNSwgMTgsIDIxLCAyNCwgMjYsIDI4LCAzMCwgMzJdLFxufTtcblxuZXhwb3J0IGNvbnN0IEhFQVJUUyA9IDM7XG5leHBvcnQgY29uc3QgU1RBUlRfSEFORCA9IDQ7XG5leHBvcnQgY29uc3QgV0FWRVMgPSAxMDtcblxuZXhwb3J0IGludGVyZmFjZSBSdWxlcyB7XG4gIC8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUuICovXG4gIGN1cnZlOiBudW1iZXJbXTtcbiAgLyoqXG4gICAqICdkZXBsb3llZE9ubHknOiBvbmx5IHR3byBkZXBsb3llZCB1bml0cyBvZiB0aGUgc2FtZSBzdGFyIGNhbiBtZXJnZSAoZG9jIGFzIHdyaXR0ZW4pLlxuICAgKiAnaGFuZEludG9PbmVTdGFyJzogYWRkaXRpb25hbGx5IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gYmUgcGxheWVkIG9udG8gYSBkZXBsb3llZFxuICAgKiAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsIHRvIG1lcmdlIGltbWVkaWF0ZWx5IChwYXlzIG9ubHkgdGhlIGNvc3QgZGlmZmVyZW5jZSkuXG4gICAqL1xuICBtZXJnZTogJ2RlcGxveWVkT25seScgfCAnaGFuZEludG9PbmVTdGFyJztcbiAgLyoqIENhcmQtaW5mbG93IGtub2JzIChhbGwgb3B0aW9uYWw7IGRlZmF1bHRzIHJlcHJvZHVjZSB0aGUgZG9jKS4gKi9cbiAgc3RhcnRIYW5kPzogbnVtYmVyOyAgICAgICAgICAgIC8vIGRlZmF1bHQgNFxuICBkcmFmdFBpY2tzPzogbnVtYmVyOyAgICAgICAgICAgLy8gY2FyZHMga2VwdCBmcm9tIHRoZSAzLWNhcmQgVmljdG9yeSBEcmFmdCwgZGVmYXVsdCAxXG4gIG5vcm1hbERyYXdXYXZlcz86IG51bWJlcltdOyAgICAvLyB3YXZlcyAoYmVpbmcgZW50ZXJlZCkgdGhhdCBhbHNvIGdpdmUgdGhlIG5vcm1hbCByYW5kb20gZHJhdzsgZGVmYXVsdCA9IGFsbFxuICAvKiogU291bHMgdGhpcyBydW4gbWF5IGRyYXcgZnJvbSAodGhlIGVxdWlwcGVkIFNvdWwgRGVjaywgbWF4IDYpLiBEZWZhdWx0OiBldmVyeSBTb3VsLiAqL1xuICBwb29sPzogU291bElkW107XG4gIHN0YWdlV2F2ZXM/OiBudW1iZXI7ICAgICAgICAgICAvLyB3YXZlcyBpbiB0aGlzIHN0YWdlOyBkZWZhdWx0IDEwICh0aGUgcGxheWFibGUgcHJvdG90eXBlIHVzZXMgMylcbn1cblxuZXhwb3J0IGNvbnN0IEdSSURfQ09MUyA9IDQsIEdSSURfUk9XUyA9IDM7ICAgLy8gNCB4IDMgPSBHUklEX0NFTExTOyBjb2x1bW4gR1JJRF9DT0xTLTEgaXMgdGhlIGZyb250IGxpbmVcbiIsICIvLyBTbWFsbCBzZWVkZWQgUk5HIChtdWxiZXJyeTMyKS4gU2FtZSBzZWVkIC0+IHNhbWUgcnVuLCBzbyBhbnkgYnVnIHJlcG9ydCBpcyByZXByb2R1Y2libGUuXG4vLyBgc3RhdGUoKWAgLyB0aGUgYHJlc3VtZWAgYXJndW1lbnQgbGV0IGEgc2F2ZWQgcnVuIGNvbnRpbnVlIGRyYXdpbmcgZXhhY3RseSB0aGUgY2FyZHMgaXQgd291bGQgaGF2ZSBkcmF3bi5cblxuZXhwb3J0IGludGVyZmFjZSBSbmcge1xuICBuZXh0KCk6IG51bWJlcjsgICAgICAgICAgICAgIC8vIFswLCAxKVxuICBpbnQobjogbnVtYmVyKTogbnVtYmVyOyAgICAgIC8vIFswLCBuKVxuICBwaWNrPFQ+KGl0ZW1zOiByZWFkb25seSBUW10pOiBUO1xuICBzZWVkOiBudW1iZXI7XG4gIHN0YXRlKCk6IG51bWJlcjsgICAgICAgICAgICAgLy8gdGhlIGdlbmVyYXRvcidzIGN1cnJlbnQgcG9zaXRpb24sIGZvciBzYXZpbmcgYSBydW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSbmcoc2VlZDogbnVtYmVyLCByZXN1bWU/OiBudW1iZXIpOiBSbmcge1xuICBsZXQgYSA9IChyZXN1bWUgPz8gc2VlZCkgPj4+IDA7XG4gIGNvbnN0IG5leHQgPSAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBhO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBzZWVkLFxuICAgIG5leHQsXG4gICAgaW50OiAobikgPT4gTWF0aC5mbG9vcihuZXh0KCkgKiBuKSxcbiAgICBwaWNrOiAoaXRlbXMpID0+IGl0ZW1zW01hdGguZmxvb3IobmV4dCgpICogaXRlbXMubGVuZ3RoKV0sXG4gICAgc3RhdGU6ICgpID0+IGEsXG4gIH07XG59XG4iLCAiLy8gUHVyZSBnYW1lIHJ1bGVzIGZvciBvbmUgc3RhZ2UuIE5vIGdyYXBoaWNzLCBubyBjb21iYXQ6IGp1c3QgY2FyZHMsIERvbWluaW9uLCBncmlkLCBtZXJnZSwgd2F2ZXMsIGhlYXJ0cy5cbi8vIEV2ZXJ5IG11dGF0aW9uIGdvZXMgdGhyb3VnaCBhIGZ1bmN0aW9uIGhlcmUgYW5kIGFwcGVuZHMgdG8gc3RhdGUubG9nLCBzbyBydW5zIGNhbiBiZSByZXBsYXllZCBhbmQgaW5zcGVjdGVkLlxuXG5pbXBvcnQgeyBDT1NULCBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUywgU1RBUlRfSEFORCwgV0FWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0IHsgaWQ6IG51bWJlcjsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjsgZnJlc2g/OiBib29sZWFuIH0gICAvLyBmcmVzaCA9IHN1bW1vbmVkIHRoaXMgYnVpbGQgcGhhc2VcblxuZXhwb3J0IGludGVyZmFjZSBTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlcztcbiAgcm5nOiBSbmc7XG4gIHdhdmU6IG51bWJlcjsgICAgICAgICAgICAgICAgIC8vIDEtYmFzZWRcbiAgaGVhcnRzOiBudW1iZXI7XG4gIGNhcDogbnVtYmVyO1xuICBoYW5kOiBTb3VsSWRbXTtcbiAgdW5pdHM6IFVuaXRbXTtcbiAgbmV4dElkOiBudW1iZXI7XG4gIGRpc2NhcmRVc2VkOiBib29sZWFuOyAgICAgICAgIC8vIG9uY2UtcGVyLWJ1aWxkLXBoYXNlIHJlZHJhd1xuICBzdGF0dXM6ICdidWlsZGluZycgfCAnd29uJyB8ICdsb3N0JztcbiAgbG9nOiBzdHJpbmdbXTtcbiAgc3RhdHM6IHsgZHJhd246IG51bWJlcjsgZGlzY2FyZGVkOiBudW1iZXI7IGRpc21pc3NlZDogbnVtYmVyOyBtZXJnZXM6IG51bWJlcjsgZmFpbHVyZXM6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgY29zdCA9IChzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlcik6IG51bWJlciA9PiBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbmV4cG9ydCBjb25zdCBjYXJkc0luID0gKHN0YXI6IG51bWJlcik6IG51bWJlciA9PiAyICoqIChzdGFyIC0gMSk7ICAgICAvLyBjYXJkcyBhIHVuaXQgaXMgXCJ3b3J0aFwiXG5leHBvcnQgY29uc3QgZG9taW5pb25Vc2VkID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY29zdCh1LnNvdWwsIHUuc3RhciksIDApO1xuZXhwb3J0IGNvbnN0IGRvbWluaW9uRnJlZSA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLmNhcCAtIGRvbWluaW9uVXNlZChzKTtcblxuZnVuY3Rpb24gbG9nKHM6IFN0YXRlLCBtc2c6IHN0cmluZykgeyBzLmxvZy5wdXNoKGBbdyR7cy53YXZlfV0gJHttc2d9YCk7IH1cbi8qKiBUaGUgU291bHMgdGhpcyBydW4gZHJhd3MgZnJvbTogdGhlIGVxdWlwcGVkIGRlY2ssIG9yIGV2ZXJ5dGhpbmcgaWYgbm8gZGVjayB3YXMgZ2l2ZW4uICovXG5leHBvcnQgY29uc3QgcG9vbE9mID0gKHM6IFN0YXRlKTogU291bElkW10gPT4gKHMucnVsZXMucG9vbCAmJiBzLnJ1bGVzLnBvb2wubGVuZ3RoID8gcy5ydWxlcy5wb29sIDogU09VTFMpO1xuZnVuY3Rpb24gZHJhdyhzOiBTdGF0ZSwgd2h5OiBzdHJpbmcsIG5vdD86IFNvdWxJZCk6IFNvdWxJZCB7XG4gIGNvbnN0IGFsbCA9IHBvb2xPZihzKSwgb3RoZXJzID0gbm90ID8gYWxsLmZpbHRlcigoeCkgPT4geCAhPT0gbm90KSA6IGFsbDtcbiAgY29uc3QgcG9vbCA9IG90aGVycy5sZW5ndGggPyBvdGhlcnMgOiBhbGw7ICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHN3YXAgbmV2ZXIgaGFuZHMgeW91IGJhY2sgdGhlIFNvdWwgeW91IGdhdmUgdXAgKHVubGVzcyBpdCBpcyB0aGUgb25seSBvbmUgZXF1aXBwZWQpXG4gIGNvbnN0IGMgPSBzLnJuZy5waWNrKHBvb2wpO1xuICBzLmhhbmQucHVzaChjKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYXcgJHtjfSAoJHt3aHl9KWApO1xuICByZXR1cm4gYztcbn1cblxuLyoqIEEgbmV3IGJ1aWxkIHBoYXNlIGJlZ2luczogdGhlIG9uY2UtcGVyLXBoYXNlIHN3YXAgY29tZXMgYmFjayBhbmQgbm90aGluZyBjb3VudHMgYXMgXCJzdW1tb25lZCB0aGlzIHJvdW5kXCIuICovXG5leHBvcnQgZnVuY3Rpb24gbmV3UGhhc2UoczogU3RhdGUpOiB2b2lkIHtcbiAgcy5kaXNjYXJkVXNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgdS5mcmVzaCA9IGZhbHNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3U3RhZ2UocnVsZXM6IFJ1bGVzLCBzZWVkOiBudW1iZXIpOiBTdGF0ZSB7XG4gIGNvbnN0IHM6IFN0YXRlID0ge1xuICAgIHJ1bGVzLCBybmc6IG1ha2VSbmcoc2VlZCksIHdhdmU6IDEsIGhlYXJ0czogSEVBUlRTLCBjYXA6IHJ1bGVzLmN1cnZlWzBdLCBoYW5kOiBbXSwgdW5pdHM6IFtdLCBuZXh0SWQ6IDEsXG4gICAgZGlzY2FyZFVzZWQ6IGZhbHNlLCBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogW10sXG4gICAgc3RhdHM6IHsgZHJhd246IDAsIGRpc2NhcmRlZDogMCwgZGlzbWlzc2VkOiAwLCBtZXJnZXM6IDAsIGZhaWx1cmVzOiAwIH0sXG4gIH07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgKHJ1bGVzLnN0YXJ0SGFuZCA/PyBTVEFSVF9IQU5EKTsgaSsrKSBkcmF3KHMsICdzdGFydGluZyBoYW5kJyk7XG4gIHJldHVybiBzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlZUNlbGwoczogU3RhdGUpOiBudW1iZXIge1xuICBjb25zdCB0YWtlbiA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKCF0YWtlbi5oYXMoYykpIHJldHVybiBjO1xuICByZXR1cm4gLTE7XG59XG5cbi8vIC0tLS0gYnVpbGQtcGhhc2UgYWN0aW9ucyAoZWFjaCByZXR1cm5zIHRydWUgd2hlbiBpdCBoYXBwZW5lZCkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5TdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdO1xuICByZXR1cm4gc291bCAhPT0gdW5kZWZpbmVkICYmIGZyZWVDZWxsKHMpID49IDAgJiYgY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjZWxsRnJlZShzOiBTdGF0ZSwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIHJldHVybiBjZWxsID49IDAgJiYgY2VsbCA8IEdSSURfQ0VMTFMgJiYgIXMudW5pdHMuc29tZSgodSkgPT4gdS5jZWxsID09PSBjZWxsKTtcbn1cblxuLyoqIFN1bW1vbiBhIGhhbmQgY2FyZCBvbnRvIGEgc3BlY2lmaWMgZnJlZSBjZWxsIChkZWZhdWx0OiB0aGUgZmlyc3QgZnJlZSBvbmUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCBjZWxsPzogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3VtbW9uKHMsIGhhbmRJZHgpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChjZWxsICE9PSB1bmRlZmluZWQgJiYgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1OiBVbml0ID0geyBpZDogcy5uZXh0SWQrKywgc291bCwgc3RhcjogMSwgY2VsbDogY2VsbCA/PyBmcmVlQ2VsbChzKSwgZnJlc2g6IHRydWUgfTtcbiAgcy51bml0cy5wdXNoKHUpO1xuICBsb2cocywgYHN1bW1vbiAke3NvdWx9IDEqIC0+IGNlbGwgJHt1LmNlbGx9ICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRGVwbG95ZWQoYTogVW5pdCwgYjogVW5pdCk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5pZCAhPT0gYi5pZCAmJiBhLnNvdWwgPT09IGIuc291bCAmJiBhLnN0YXIgPT09IGIuc3RhciAmJiBhLnN0YXIgPCBNQVhfU1RBUjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRGVwbG95ZWQoczogU3RhdGUsIGFJZDogbnVtYmVyLCBiSWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBhID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBhSWQpLCBiID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBiSWQpO1xuICBpZiAoIWEgfHwgIWIgfHwgIWNhbk1lcmdlRGVwbG95ZWQoYSwgYikpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh1KSA9PiB1LmlkICE9PSBiLmlkKTtcbiAgYS5mcmVzaCA9ICEhKGEuZnJlc2ggfHwgYi5mcmVzaCk7XG4gIGEuc3RhcisrO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlICR7YS5zb3VsfSAke2Euc3RhciAtIDF9Kiske2Euc3RhciAtIDF9KiAtPiAke2Euc3Rhcn0qICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9LCBjZWxscyAke3MudW5pdHMubGVuZ3RofS8ke0dSSURfQ0VMTFN9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqICdoYW5kSW50b09uZVN0YXInIHJ1bGU6IHBsYXkgYSAxLXN0YXIgY2FyZCBvbnRvIGEgZGVwbG95ZWQgMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLnJ1bGVzLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXNvdWwgfHwgIXUgfHwgdS5zb3VsICE9PSBzb3VsIHx8IHUuc3RhciAhPT0gMSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gY29zdChzb3VsLCAyKSAtIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhbk1lcmdlRnJvbUhhbmQocywgaGFuZElkeCwgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHUuc3RhciA9IDI7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UtZnJvbS1oYW5kICR7c291bH0gLT4gJHt1LnNvdWx9IDIqICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRpc21pc3MoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBkaXNtaXNzICR7dS5zb3VsfSAke3Uuc3Rhcn0qIChwZXJtYW5lbnRseSByZW1vdmVkKWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDE6IGRpc2NhcmQgYSBoYW5kIGNhcmQgYW5kIGRyYXcgYSByYW5kb20gY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2NhcmRSZWRyYXcoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5kaXNjYXJkVXNlZCB8fCBoYW5kSWR4IDwgMCB8fCBoYW5kSWR4ID49IHMuaGFuZC5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgYyA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc2NhcmRlZCsrO1xuICBsb2cocywgYHN3YXA6IGRpc2NhcmQgJHtjfWApO1xuICBkcmF3KHMsICdzd2FwJywgYyk7XG4gIHJldHVybiB0cnVlO1xufVxuZXhwb3J0IGNvbnN0IHN3YXBEaXNjYXJkID0gZGlzY2FyZFJlZHJhdztcblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICByZXR1cm4gIXMuZGlzY2FyZFVzZWQgJiYgISF1ICYmICF1LmZyZXNoOyAgICAgICAgICAvLyBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZFxufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMjogc2VsbCBhIGRlcGxveWVkIHVuaXQgKG5vdCBvbmUgc3VtbW9uZWQgdGhpcyByb3VuZCkgYW5kIGRyYXcgYSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gc3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3dhcFNlbGwocywgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYHN3YXA6IHNlbGwgJHt1LnNvdWx9ICR7dS5zdGFyfSpgKTtcbiAgZHJhdyhzLCAnc3dhcCcsIHUuc291bCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbW92ZVVuaXQoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1IHx8ICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBsb2cocywgYG1vdmUgJHt1LnNvdWx9IGNlbGwgJHt1LmNlbGx9IC0+ICR7Y2VsbH1gKTsgdS5jZWxsID0gY2VsbDsgcmV0dXJuIHRydWU7XG59XG5cbi8vIC0tLS0gd2F2ZSByZXN1bHRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERyYWZ0IGNob2ljZXMgZm9yIGFmdGVyIGEgY2xlYXJlZCB3YXZlOiAzIHJhbmRvbSBjYXJkcywgZHVwbGljYXRlcyBhbGxvd2VkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRyYWZ0T3B0aW9ucyhzOiBTdGF0ZSk6IFNvdWxJZFtdIHtcbiAgY29uc3QgcCA9IHBvb2xPZihzKTtcbiAgcmV0dXJuIFtzLnJuZy5waWNrKHApLCBzLnJuZy5waWNrKHApLCBzLnJuZy5waWNrKHApXTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZDogcmFpc2UgdGhlIGNhcCwgcmVzb2x2ZSB0aGUgVmljdG9yeSBEcmFmdCwgZHJhdyAxIG5vcm1hbCBjYXJkLiAqL1xuZXhwb3J0IGNvbnN0IHN0YWdlV2F2ZXMgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5ydWxlcy5zdGFnZVdhdmVzID8/IFdBVkVTO1xuXG4vKiogU3RlcCAxIG9mIGEgY2xlYXJlZCB3YXZlOiBpcyB0aGUgc3RhZ2Ugb3Zlcj8gSWYgbm90LCByYWlzZSB0aGUgY2FwIGFuZCBzdGFydCB0aGUgbmV4dCBidWlsZCBwaGFzZS4gUmV0dXJucyB0cnVlIHdoZW4gdGhlIHN0YWdlIGlzIHdvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlV2F2ZShzOiBTdGF0ZSk6IGJvb2xlYW4ge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBzLnN0YXR1cyA9PT0gJ3dvbic7XG4gIGlmIChzLndhdmUgPj0gc3RhZ2VXYXZlcyhzKSkgeyBzLnN0YXR1cyA9ICd3b24nOyBsb2cocywgJ3N0YWdlIGNsZWFyZWQnKTsgcmV0dXJuIHRydWU7IH1cbiAgcy53YXZlKys7XG4gIHMuY2FwID0gcy5ydWxlcy5jdXJ2ZVtzLndhdmUgLSAxXTtcbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgd2F2ZSBjbGVhcmVkIC0+IGNhcCAke3MuY2FwfWApO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTdGVwIDI6IHRoZSBwbGF5ZXIga2VwdCBgaWR4YCBmcm9tIHRoZSBvZmZlcmVkIGRyYWZ0IGNhcmRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRha2VEcmFmdChzOiBTdGF0ZSwgb3B0czogU291bElkW10sIGlkeDogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IHBpY2sgPSBvcHRzW01hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgaWR4KSldO1xuICBzLmhhbmQucHVzaChwaWNrKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYWZ0IFske29wdHMuam9pbignLCAnKX1dIC0+IHRvb2sgJHtwaWNrfWApO1xufVxuXG4vKiogU3RlcCAzOiB0aGUgYm9udXMgbm9ybWFsIGRyYXcgKG9ubHkgb24gdGhlIHdhdmVzIHRoZSBydWxlcyBhbGxvdykuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsRHJhdyhzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMgPyBzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcy5pbmNsdWRlcyhzLndhdmUpIDogdHJ1ZSkgZHJhdyhzLCAnd2F2ZSBjbGVhcicpO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkIChhbGwgdGhyZWUgc3RlcHMgaW4gb25lIGNhbGwsIGZvciBzaW11bGF0aW9ucykuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJXYXZlKHM6IFN0YXRlLCBjaG9vc2U6IChvcHRzOiBTb3VsSWRbXSkgPT4gbnVtYmVyKTogdm9pZCB7XG4gIGlmIChhZHZhbmNlV2F2ZShzKSkgcmV0dXJuO1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgbGV0IG9wdHMgPSBkcmFmdE9wdGlvbnMocyk7XG4gIGNvbnN0IG9mZmVyZWQgPSBvcHRzLmpvaW4oJywgJyk7XG4gIGNvbnN0IHRvb2s6IFNvdWxJZFtdID0gW107XG4gIGZvciAobGV0IHAgPSAwOyBwIDwgKHMucnVsZXMuZHJhZnRQaWNrcyA/PyAxKTsgcCsrKSB7XG4gICAgY29uc3QgaWR4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBjaG9vc2Uob3B0cykpKTtcbiAgICB0b29rLnB1c2gob3B0c1tpZHhdKTsgcy5oYW5kLnB1c2gob3B0c1tpZHhdKTsgcy5zdGF0cy5kcmF3bisrO1xuICAgIG9wdHMgPSBvcHRzLmZpbHRlcigoXywgaSkgPT4gaSAhPT0gaWR4KTtcbiAgfVxuICBsb2cocywgYGRyYWZ0IFske29mZmVyZWR9XSAtPiB0b29rICR7dG9vay5qb2luKCcsICcpfWApO1xuICBub3JtYWxEcmF3KHMpO1xufVxuXG4vKiogQXJteSB3aXBlZDogbG9zZSBhIGhlYXJ0LCBjYXAgZG9lcyBOT1QgcmlzZSwgZW5lbWllcyByZXNldCwgKzEgY2FyZCwgcmVkcmF3IGFsbG93ZWQgYWdhaW4uICovXG5leHBvcnQgZnVuY3Rpb24gZmFpbFdhdmUoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIHMuaGVhcnRzLS07IHMuc3RhdHMuZmFpbHVyZXMrKztcbiAgaWYgKHMuaGVhcnRzIDw9IDApIHsgcy5zdGF0dXMgPSAnbG9zdCc7IGxvZyhzLCAnbm8gaGVhcnRzIGxlZnQ6IHN0YWdlIGxvc3QnKTsgcmV0dXJuOyB9XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYGFybXkgd2lwZWQ6IGhlYXJ0cyAke3MuaGVhcnRzfSwgY2FwIHN0YXlzICR7cy5jYXB9YCk7XG4gIGRyYXcocywgJ2ZhaWxlZCBhdHRlbXB0Jyk7XG59XG5cbi8vIC0tLS0gaW52YXJpYW50cyAoY2FsbGVkIGJ5IHRoZSBzaW11bGF0b3IgYWZ0ZXIgZXZlcnkgd2F2ZTsgdGhyb3cgd2l0aCBhIHJlYWRhYmxlIG1lc3NhZ2UpIC0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrSW52YXJpYW50cyhzOiBTdGF0ZSk6IHZvaWQge1xuICBjb25zdCBmYWlsID0gKG06IHN0cmluZykgPT4geyB0aHJvdyBuZXcgRXJyb3IoYElOVkFSSUFOVCAke219XFxuYCArIHMubG9nLnNsaWNlKC0xMikuam9pbignXFxuJykpOyB9O1xuICBpZiAocy51bml0cy5sZW5ndGggPiBHUklEX0NFTExTKSBmYWlsKGBtb3JlIHVuaXRzICgke3MudW5pdHMubGVuZ3RofSkgdGhhbiBjZWxsc2ApO1xuICBjb25zdCBjZWxscyA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBpZiAoY2VsbHMuc2l6ZSAhPT0gcy51bml0cy5sZW5ndGgpIGZhaWwoJ3R3byB1bml0cyBzaGFyZSBhIGNlbGwnKTtcbiAgaWYgKGRvbWluaW9uVXNlZChzKSA+IHMuY2FwKSBmYWlsKGBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0gZXhjZWVkcyBjYXAgJHtzLmNhcH1gKTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIGlmICh1LnN0YXIgPCAxIHx8IHUuc3RhciA+IE1BWF9TVEFSKSBmYWlsKGB1bml0IHN0YXIgJHt1LnN0YXJ9IG91dCBvZiByYW5nZWApO1xuICAvLyBldmVyeSBkcmF3biBjYXJkIGlzIGVpdGhlciBpbiBoYW5kLCB3b3J0aCBjYXJkcyBvbiB0aGUgZmllbGQsIGRpc2NhcmRlZCwgb3IgZGlzbWlzc2VkXG4gIGNvbnN0IG9uRmllbGQgPSBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNhcmRzSW4odS5zdGFyKSwgMCk7XG4gIGNvbnN0IGFjY291bnRlZCA9IHMuaGFuZC5sZW5ndGggKyBvbkZpZWxkICsgcy5zdGF0cy5kaXNjYXJkZWQgKyBzLnN0YXRzLmRpc21pc3NlZDtcbiAgaWYgKGFjY291bnRlZCAhPT0gcy5zdGF0cy5kcmF3bikgZmFpbChgY2FyZCBjb25zZXJ2YXRpb246IGRyYXduICR7cy5zdGF0cy5kcmF3bn0gIT0gYWNjb3VudGVkICR7YWNjb3VudGVkfWApO1xufVxuIiwgIi8vIEF1dG8tYmF0dGxlIHNpbXVsYXRpb246IHB1cmUgbG9naWMsIG5vIGdyYXBoaWNzLiBEZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHNlZWQuXG4vLyBUaGUgcmVuZGVyZXIgb25seSByZWFkcyBmaWdodGVycyArIGV2ZW50czsgaXQgbmV2ZXIgZGVjaWRlcyBhbnl0aGluZy5cbi8vXG4vLyBBYmlsaXRpZXMgKG51bWJlcnMgbGl2ZSBpbiBiYWxhbmNlLnRzKTpcbi8vICAgU2tlbGV0b24gV2FycmlvciAgUGhhbGFueCAgICAgdGFrZXMgbGVzcyBkYW1hZ2UgZm9yIGVhY2ggbmVhcmJ5IGFsbGllZCBXYXJyaW9yIChjYXBwZWQpXG4vLyAgIFNrZWxldG9uIEFyY2hlciAgIFNwbGl0IEFycm93IChza2lsbCkgb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllczsgYmFzaWMgc2hvdHMgYXJlIGEgc2luZ2xlIGFycm93XG4vLyAgIEdvYmxpbiAgICAgICAgICAgIE9wcG9ydHVuaXN0ICtkYW1hZ2Ugb24gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2U7IHByZWZlcnMgc3VjaCB0YXJnZXRzXG4vLyAgIEtuaWdodCAgICAgICAgICAgIFRhdW50IChza2lsbCkgIGZvcmNlcyBuZWFyYnkgZW5lbWllcyB0byBhdHRhY2sgaGltXG4vLyAgIE9ncmUgICAgICAgICAgICAgIFNtYXNoIChza2lsbCkgIGhlYXZ5IHNsYW0gdGhhdCBhbHNvIGhpdHMgZW5lbWllcyBuZWFyIHRoZSBpbXBhY3Rcbi8vIFNraWxscyBydW4gb24gbWFuYTogYmFzaWMgYXR0YWNrcyBhbmQgZGFtYWdlIHRha2VuIGZpbGwgYSBiYXI7IHdoZW4gZnVsbCwgdGhlIG5leHQgYXR0YWNrIGlzIHRoZSBza2lsbCBhbmQgdGhlIGJhciByZXNldHMuXG4vLyBXYXJyaW9yLCBHb2JsaW4gYW5kIEJhcmJhcmlhbiBoYXZlIHBhc3NpdmVzIG9ubHkgKG5vIG1hbmEpLlxuLy8gICBCYXJiYXJpYW4gICAgICAgICBGcmVuenkgICAgICBhdHRhY2tzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmdcblxuaW1wb3J0IHsgR1JJRF9DT0xTLCBHUklEX1JPV1MgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBjb25zdCBHUklEX1NQID0gMS4zOyAgICAgLy8gbWV0cmVzIGJldHdlZW4gZ3JpZCBjZWxsc1xuZXhwb3J0IGNvbnN0IEZST05UX1ggPSAxLjc7ICAgICAvLyBmcm9udCBsaW5lJ3MgZGlzdGFuY2UgZnJvbSB0aGUgY2VudHJlIGxpbmVcblxuZXhwb3J0IGludGVyZmFjZSBTbG90IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5cbi8qKiBXb3JsZCBwb3NpdGlvbiBvZiBhIGdyaWQgY2VsbCBmb3IgYSB0ZWFtICh0ZWFtIDAgPSBsZWZ0LCBmYWNlcyArWDsgdGVhbSAxID0gcmlnaHQsIGZhY2VzIC1YKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjZWxsUG9zKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpOiB7IHg6IG51bWJlcjsgejogbnVtYmVyIH0ge1xuICBjb25zdCByb3cgPSBNYXRoLmZsb29yKGNlbGwgLyBHUklEX0NPTFMpLCBjb2wgPSBjZWxsICUgR1JJRF9DT0xTO1xuICBjb25zdCBkZXB0aCA9IEdSSURfQ09MUyAtIDEgLSBjb2w7ICAgICAgICAgICAgICAgICAgICAgICAvLyAwID0gZnJvbnQgbGluZVxuICByZXR1cm4geyB4OiAoRlJPTlRfWCArIGRlcHRoICogR1JJRF9TUCkgKiAodGVhbSA9PT0gMCA/IC0xIDogMSksIHo6IChyb3cgLSAoR1JJRF9ST1dTIC0gMSkgLyAyKSAqIEdSSURfU1AgfTtcbn1cblxuY29uc3QgRlJPTlRORVNTOiBSZWNvcmQ8U291bElkLCBudW1iZXI+ID0geyBrbmlnaHQ6IDUsIG9ncmU6IDQsIHdhcnJpb3I6IDMsIGJhcmJhcmlhbjogMywgZ29ibGluOiAyLCBhcmNoZXI6IDAgfTtcbi8qKiBUaGUgZW5lbXkgYXJteSBpcyBwbGFjZWQgYXV0b21hdGljYWxseSAodGFua3MgdXAgZnJvbnQsIGFyY2hlcnMgYmVoaW5kKTsgdGhlIHBsYXllciBvbmx5IGV2ZXIgc2VlcyBpdHMgY29tcG9zaXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlDZWxscyhzcGVjczogU3BlY1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBjZWxsczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NPTFMgKiBHUklEX1JPV1M7IGMrKykgY2VsbHMucHVzaChjKTtcbiAgY2VsbHMuc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IGRhID0gR1JJRF9DT0xTIC0gMSAtIChhICUgR1JJRF9DT0xTKSwgZGIgPSBHUklEX0NPTFMgLSAxIC0gKGIgJSBHUklEX0NPTFMpO1xuICAgIGlmIChkYSAhPT0gZGIpIHJldHVybiBkYSAtIGRiO1xuICAgIHJldHVybiBNYXRoLmFicyhNYXRoLmZsb29yKGEgLyBHUklEX0NPTFMpIC0gMSkgLSBNYXRoLmFicyhNYXRoLmZsb29yKGIgLyBHUklEX0NPTFMpIC0gMSk7XG4gIH0pO1xuICBjb25zdCBvcmRlciA9IHNwZWNzLm1hcCgocywgaSkgPT4gaSkuc29ydCgoaSwgaikgPT4gRlJPTlRORVNTW3NwZWNzW2pdLnNvdWxdIC0gRlJPTlRORVNTW3NwZWNzW2ldLnNvdWxdKTtcbiAgY29uc3Qgb3V0ID0gbmV3IEFycmF5PG51bWJlcj4oc3BlY3MubGVuZ3RoKTtcbiAgb3JkZXIuZm9yRWFjaCgoaWR4LCBrKSA9PiB7IG91dFtpZHhdID0gY2VsbHNba107IH0pO1xuICByZXR1cm4gb3V0O1xufVxuXG5leHBvcnQgdHlwZSBGU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYWQnO1xuZXhwb3J0IGludGVyZmFjZSBGaWdodGVyIHtcbiAgaWQ6IG51bWJlcjsgdGVhbTogMCB8IDE7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7XG4gIHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc6IG51bWJlcjtcbiAgaHA6IG51bWJlcjsgbWF4SHA6IG51bWJlcjsgZG1nOiBudW1iZXI7IGludGVydmFsOiBudW1iZXI7IHJhbmdlOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IHJhZGl1czogbnVtYmVyO1xuICBhbGl2ZTogYm9vbGVhbjsgc3RhdGU6IEZTdGF0ZTtcbiAgdGFyZ2V0OiBudW1iZXI7IHJldGFyZ2V0QXQ6IG51bWJlcjsgZm9yY2VkVGFyZ2V0OiBudW1iZXI7IGZvcmNlZFVudGlsOiBudW1iZXI7XG4gIG5leHRBdHRhY2s6IG51bWJlcjsgYXR0YWNrU3RhcnQ6IG51bWJlcjsgYXR0YWNrRHVyOiBudW1iZXI7IGFuaW1TcGVlZDogbnVtYmVyOyBoaXREb25lOiBib29sZWFuO1xuICBtYW5hOiBudW1iZXI7IG1heE1hbmE6IG51bWJlcjsgY2FzdGluZzogYm9vbGVhbjsgZnJlbnp5OiBudW1iZXI7IGRlYWRBdDogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBCRXZlbnQgPVxuICB8IHsgdDogJ3N3aW5nJzsgaWQ6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2hpdCc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXI7IGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAnYXJyb3cnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdkZWF0aCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ2Nhc3QnOyBpZDogbnVtYmVyOyBza2lsbDogJ3NwbGl0JyB8ICd0YXVudCcgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICd0YXVudCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ3NtYXNoJzsgaWQ6IG51bWJlcjsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHI6IG51bWJlciB9XG4gIHwgeyB0OiAnZnJlbnp5JzsgaWQ6IG51bWJlcjsgc3RhY2tzOiBudW1iZXIgfTtcblxuZXhwb3J0IGNsYXNzIEJhdHRsZSB7XG4gIHRpbWUgPSAwO1xuICBmaWdodGVyczogRmlnaHRlcltdID0gW107XG4gIGV2ZW50czogQkV2ZW50W10gPSBbXTtcbiAgd2lubmVyOiAtMSB8IDAgfCAxID0gLTE7XG4gIHJuZzogUm5nO1xuICBwcml2YXRlIHBlbmRpbmc6IHsgYXQ6IG51bWJlcjsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlciB9W10gPSBbXTtcbiAgcHJpdmF0ZSBuZXh0SWQgPSAxO1xuICBwcml2YXRlIGZsaXAgPSBmYWxzZTtcblxuICAvKiogYGxldmVsc2A6IHRoZSBwbGF5ZXIncyBwZXJtYW5lbnQgU291bCBsZXZlbHMgKGhlYWx0aCBhbmQgZGFtYWdlIGdyb3cgYSBsaXR0bGUgcGVyIGxldmVsKS4gRW5lbWllcyBuZXZlciB1c2UgdGhlbS4gKi9cbiAgY29uc3RydWN0b3IocGxheWVyczogU2xvdFtdLCBlbmVtaWVzOiBTcGVjW10sIHNlZWQgPSAxLCBsZXZlbHM/OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+KSB7XG4gICAgdGhpcy5ybmcgPSBtYWtlUm5nKHNlZWQpO1xuICAgIGZvciAoY29uc3QgcCBvZiBwbGF5ZXJzKSB0aGlzLmFkZCgwLCBwLnNvdWwsIHAuc3RhciwgcC5jZWxsLCBsZXZlbHM/LltwLnNvdWxdID8/IDEpO1xuICAgIGNvbnN0IGNlbGxzID0gZW5lbXlDZWxscyhlbmVtaWVzKTtcbiAgICBlbmVtaWVzLmZvckVhY2goKGUsIGkpID0+IHRoaXMuYWRkKDEsIGUuc291bCwgZS5zdGFyLCBjZWxsc1tpXSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIsIGxldmVsID0gMSk6IEZpZ2h0ZXIge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbc291bF0sIHAgPSBjZWxsUG9zKHRlYW0sIGNlbGwpO1xuICAgIGNvbnN0IGx2SHAgPSAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQi5sZXZlbC5ocCwgbHZEbWcgPSAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQi5sZXZlbC5kbWc7XG4gICAgY29uc3QgaHAgPSBzdC5ocCAqIEIuc3Rhci5ocFtzdGFyIC0gMV0gKiBsdkhwO1xuICAgIGNvbnN0IGY6IEZpZ2h0ZXIgPSB7XG4gICAgICBpZDogdGhpcy5uZXh0SWQrKywgdGVhbSwgc291bCwgc3RhciwgY2VsbCwgeDogcC54LCB6OiBwLnosIHlhdzogdGVhbSA9PT0gMCA/IDAgOiBNYXRoLlBJLFxuICAgICAgaHAsIG1heEhwOiBocCwgZG1nOiBzdC5kbWcgKiBCLnN0YXIuZG1nW3N0YXIgLSAxXSAqIGx2RG1nLCBpbnRlcnZhbDogc3QuaW50ZXJ2YWwsIHJhbmdlOiBzdC5yYW5nZSwgc3BlZWQ6IHN0LnNwZWVkLCByYWRpdXM6IHN0LnNpemUgKiBCLnN0YXIuc2NhbGVbc3RhciAtIDFdLFxuICAgICAgYWxpdmU6IHRydWUsIHN0YXRlOiAnaWRsZScsIHRhcmdldDogLTEsIHJldGFyZ2V0QXQ6IDAsIGZvcmNlZFRhcmdldDogLTEsIGZvcmNlZFVudGlsOiAwLFxuICAgICAgbmV4dEF0dGFjazogdGhpcy5ybmcubmV4dCgpICogMC4zLCBhdHRhY2tTdGFydDogLTksIGF0dGFja0R1cjogMSwgYW5pbVNwZWVkOiAxLCBoaXRGcmFjOiAwLCBoaXREb25lOiB0cnVlLFxuICAgICAgbWFuYTogMCwgbWF4TWFuYTogQi5tYW5hW3NvdWxdPy5tYXggPz8gMCwgY2FzdGluZzogZmFsc2UsIGZyZW56eTogMCwgZGVhZEF0OiAwLFxuICAgIH0gYXMgRmlnaHRlcjtcbiAgICB0aGlzLmZpZ2h0ZXJzLnB1c2goZik7IHJldHVybiBmO1xuICB9XG5cbiAgYnlJZChpZDogbnVtYmVyKTogRmlnaHRlciB8IHVuZGVmaW5lZCB7IHJldHVybiBpZCA8IDAgPyB1bmRlZmluZWQgOiB0aGlzLmZpZ2h0ZXJzW2lkIC0gMV07IH1cbiAgZm9lcyhmOiBGaWdodGVyKTogRmlnaHRlcltdIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8udGVhbSAhPT0gZi50ZWFtKTsgfVxuICBjb3VudCh0ZWFtOiAwIHwgMSk6IG51bWJlciB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLnJlZHVjZSgobiwgZikgPT4gbiArIChmLmFsaXZlICYmIGYudGVhbSA9PT0gdGVhbSA/IDEgOiAwKSwgMCk7IH1cbiAgZHJhaW4oKTogQkV2ZW50W10geyBjb25zdCBlID0gdGhpcy5ldmVudHM7IHRoaXMuZXZlbnRzID0gW107IHJldHVybiBlOyB9XG5cbiAgc3RlcChkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMud2lubmVyID49IDApIHJldHVybjtcbiAgICB0aGlzLnRpbWUgKz0gZHQ7IHRoaXMuZmxpcCA9ICF0aGlzLmZsaXA7XG4gICAgLy8gYXJyb3dzIHRoYXQgaGF2ZSBmaW5pc2hlZCBmbHlpbmdcbiAgICBmb3IgKGxldCBpID0gdGhpcy5wZW5kaW5nLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wZW5kaW5nW2ldO1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBwLmF0KSB7XG4gICAgICAgIHRoaXMucGVuZGluZy5zcGxpY2UoaSwgMSk7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5ieUlkKHAudG8pLCBmcm9tID0gdGhpcy5ieUlkKHAuZnJvbSk7XG4gICAgICAgIGlmICh0byAmJiB0by5hbGl2ZSAmJiBmcm9tKSB0aGlzLmRhbWFnZSh0bywgcC5kbWcsIGZyb20sICdhcnJvdycpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvcmRlciA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKHRoaXMuZmxpcCkgb3JkZXIucmV2ZXJzZSgpO1xuICAgIGZvciAoY29uc3QgZiBvZiBvcmRlcikgaWYgKGYuYWxpdmUpIHRoaXMudXBkYXRlKGYsIGR0KTtcbiAgICBjb25zdCBhID0gdGhpcy5jb3VudCgwKSwgYiA9IHRoaXMuY291bnQoMSk7XG4gICAgaWYgKCFhIHx8ICFiKSB0aGlzLndpbm5lciA9IGEgPyAwIDogMTtcbiAgICBlbHNlIGlmICh0aGlzLnRpbWUgPj0gQkFMQU5DRS5zaW0udGltZUxpbWl0KSB7XG4gICAgICBjb25zdCBocCA9ICh0OiAwIHwgMSkgPT4gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB0KS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCk7XG4gICAgICB0aGlzLndpbm5lciA9IGhwKDApID4gaHAoMSkgPyAwIDogMTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyLWZpZ2h0ZXIgdXBkYXRlXG4gIHByaXZhdGUgdXBkYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07XG4gICAgdGhpcy5zZXBhcmF0ZShmLCBkdCk7XG5cbiAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHtcbiAgICAgIGNvbnN0IHQgPSB0aGlzLnRpbWUgLSBmLmF0dGFja1N0YXJ0O1xuICAgICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAodGcgJiYgdGcuYWxpdmUpIHRoaXMuZmFjZShmLCB0Zy54IC0gZi54LCB0Zy56IC0gZi56LCBkdCk7XG4gICAgICBpZiAoIWYuaGl0RG9uZSAmJiB0ID49IGYuYXR0YWNrRHVyICogc3QuaGl0RnJhYykgeyBmLmhpdERvbmUgPSB0cnVlOyB0aGlzLnJlc29sdmVIaXQoZik7IH1cbiAgICAgIGlmICh0ID49IGYuYXR0YWNrRHVyKSBmLnN0YXRlID0gJ2lkbGUnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFjcXVpcmUoZik7XG4gICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmICghdGcgfHwgIXRnLmFsaXZlKSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IHJldHVybjsgfVxuICAgIGNvbnN0IGR4ID0gdGcueCAtIGYueCwgZHogPSB0Zy56IC0gZi56LCBkaXN0ID0gTWF0aC5oeXBvdChkeCwgZHopO1xuICAgIHRoaXMuZmFjZShmLCBkeCwgZHosIGR0KTtcbiAgICBpZiAoZGlzdCA8PSBmLnJhbmdlKSB7XG4gICAgICBpZiAodGhpcy50aW1lID49IGYubmV4dEF0dGFjaykgdGhpcy5zdGFydEF0dGFjayhmKTsgZWxzZSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IH1cbiAgICB9IGVsc2Uge1xuICAgICAgZi5zdGF0ZSA9ICdydW4nOyBjb25zdCBrID0gZi5zcGVlZCAqIGR0IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCk7IGYueCArPSBkeCAqIGs7IGYueiArPSBkeiAqIGs7IHRoaXMuZnJlbnp5RGVjYXkoZik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBmcmVuenlEZWNheShmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicgJiYgZi5mcmVuenkgPiAwICYmIHRoaXMudGltZSAtIChmLmF0dGFja1N0YXJ0ICsgZi5hdHRhY2tEdXIpID4gQkFMQU5DRS5mcmVuenkucmVzZXRBZnRlcikgZi5mcmVuenkgPSAwO1xuICB9XG5cbiAgcHJpdmF0ZSBmYWNlKGY6IEZpZ2h0ZXIsIGR4OiBudW1iZXIsIGR6OiBudW1iZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAoZHggKiBkeCArIGR6ICogZHogPCAxZS02KSByZXR1cm47XG4gICAgY29uc3Qgd2FudCA9IE1hdGguYXRhbjIoZHgsIGR6KTsgbGV0IGQgPSAoKHdhbnQgLSBmLnlhdyArIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSArIDIgKiBNYXRoLlBJKSAlICgyICogTWF0aC5QSSkgLSBNYXRoLlBJO1xuICAgIGYueWF3ICs9IE1hdGgubWF4KC05ICogZHQsIE1hdGgubWluKDkgKiBkdCwgZCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXBhcmF0ZShmOiBGaWdodGVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgayA9ICh3YW50IC0gbSkgLyBNYXRoLm1heChtLCAxZS0zKTsgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBmLnggKz0gcHggKiBzOyBmLnogKz0gcHogKiBzO1xuICB9XG5cbiAgcHJpdmF0ZSBhY3F1aXJlKGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5mb3JjZWRUYXJnZXQgPj0gMCkge1xuICAgICAgY29uc3QgZnQgPSB0aGlzLmJ5SWQoZi5mb3JjZWRUYXJnZXQpO1xuICAgICAgaWYgKGZ0ICYmIGZ0LmFsaXZlICYmIHRoaXMudGltZSA8IGYuZm9yY2VkVW50aWwpIHsgZi50YXJnZXQgPSBmdC5pZDsgcmV0dXJuOyB9XG4gICAgICBmLmZvcmNlZFRhcmdldCA9IC0xO1xuICAgIH1cbiAgICBjb25zdCBjdXIgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmIChjdXIgJiYgY3VyLmFsaXZlICYmIHRoaXMudGltZSA8IGYucmV0YXJnZXRBdCkgcmV0dXJuO1xuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoc2NvcmUgPCBicykgeyBicyA9IHNjb3JlOyBiZXN0ID0gbzsgfVxuICAgIH1cbiAgICBmLnRhcmdldCA9IGJlc3QuaWQ7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0QXR0YWNrKGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07IGxldCBlZmYgPSBmLmludGVydmFsO1xuICAgIGlmIChmLnNvdWwgPT09ICdiYXJiYXJpYW4nKSB7IGYuZnJlbnp5ID0gTWF0aC5taW4oQi5mcmVuenkubWF4U3RhY2tzLCBmLmZyZW56eSArIDEpOyBlZmYgPSBmLmludGVydmFsIC8gKDEgKyBmLmZyZW56eSAqIEIuZnJlbnp5LnBlclN3aW5nKTsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdmcmVuenknLCBpZDogZi5pZCwgc3RhY2tzOiBmLmZyZW56eSB9KTsgfVxuICAgIGYuYXR0YWNrRHVyID0gTWF0aC5taW4oc3QuYW5pbUxlbiwgZWZmICogMC45NSk7IGYuYW5pbVNwZWVkID0gc3QuYW5pbUxlbiAvIGYuYXR0YWNrRHVyO1xuICAgIGYuYXR0YWNrU3RhcnQgPSB0aGlzLnRpbWU7IGYubmV4dEF0dGFjayA9IHRoaXMudGltZSArIE1hdGgubWF4KGVmZiwgZi5hdHRhY2tEdXIpOyBmLmhpdERvbmUgPSBmYWxzZTsgZi5zdGF0ZSA9ICdhdHRhY2snO1xuICAgIGYuY2FzdGluZyA9IGYubWF4TWFuYSA+IDAgJiYgZi5tYW5hID49IGYubWF4TWFuYTsgaWYgKGYuY2FzdGluZykgeyBmLm1hbmEgPSAwOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2Nhc3QnLCBpZDogZi5pZCwgc2tpbGw6IGYuc291bCA9PT0gJ2FyY2hlcicgPyAnc3BsaXQnIDogZi5zb3VsID09PSAna25pZ2h0JyA/ICd0YXVudCcgOiAnc21hc2gnIH0pOyB9XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdzd2luZycsIGlkOiBmLmlkLCBzcGVlZDogZi5hbmltU3BlZWQsIGR1cjogZi5hdHRhY2tEdXIgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVIaXQoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFOyBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7IGlmICghdGcgfHwgIXRnLmFsaXZlKSByZXR1cm47XG4gICAgY29uc3QgTSA9IEIubWFuYVtmLnNvdWxdOyBpZiAoTSAmJiAhZi5jYXN0aW5nKSBmLm1hbmEgPSBNYXRoLm1pbihNLm1heCwgZi5tYW5hICsgTS5wZXJBdHRhY2spO1xuICAgIGlmIChmLnNvdWwgPT09ICdhcmNoZXInKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGJhc2ljOiBvbmUgYXJyb3cuIFNraWxsIChTcGxpdCBBcnJvdyk6IG9uZSBhcnJvdyBhdCBlYWNoIG9mIHVwIHRvIDMgZGlmZmVyZW50IGVuZW1pZXNcbiAgICAgIGNvbnN0IHJlYWNoID0gZi5yYW5nZSAqIDEuMjU7XG4gICAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpLm1hcCgobykgPT4gKHsgbywgZDogTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgfSkpLmZpbHRlcigoZSkgPT4gZS5kIDw9IHJlYWNoKS5zb3J0KChhLCBiKSA9PiBhLmQgLSBiLmQpO1xuICAgICAgY29uc3QgcGlja2VkID0gZi5jYXN0aW5nID8gW3RnLCAuLi5mb2VzLm1hcCgoZSkgPT4gZS5vKS5maWx0ZXIoKG8pID0+IG8uaWQgIT09IHRnLmlkKV0uc2xpY2UoMCwgQi52b2xsZXkudGFyZ2V0cykgOiBbdGddO1xuICAgICAgZm9yIChjb25zdCBvIG9mIHBpY2tlZCkge1xuICAgICAgICBjb25zdCBkdXIgPSBNYXRoLm1heCgwLjE1LCBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSAvIEIudm9sbGV5LnByb2plY3RpbGVTcGVlZCk7XG4gICAgICAgIHRoaXMucGVuZGluZy5wdXNoKHsgYXQ6IHRoaXMudGltZSArIGR1ciwgZnJvbTogZi5pZCwgdG86IG8uaWQsIGRtZzogZi5kbWcgfSk7XG4gICAgICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnYXJyb3cnLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZHVyIH0pO1xuICAgICAgfVxuICAgICAgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjtcbiAgICB9XG4gICAgaWYgKE1hdGguaHlwb3QodGcueCAtIGYueCwgdGcueiAtIGYueikgPiBmLnJhbmdlICogMS41KSB7IGYuY2FzdGluZyA9IGZhbHNlOyByZXR1cm47IH0gICAvLyB0YXJnZXQgc2xpcHBlZCBhd2F5OiB0aGUgYmxvdyBtaXNzZXNcbiAgICBsZXQgZG1nID0gZi5kbWc7XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicpIHsgY29uc3QgZW5nID0gdGhpcy5ieUlkKHRnLnRhcmdldCk7IGlmIChlbmcgJiYgZW5nLmFsaXZlICYmIGVuZy50ZWFtID09PSBmLnRlYW0gJiYgZW5nLmlkICE9PSBmLmlkKSBkbWcgKj0gMSArIEIub3Bwb3J0dW5pc3QuYm9udXM7IH1cbiAgICBpZiAoZi5jYXN0aW5nKSB7XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTtcbiAgICAgIGlmIChmLnNvdWwgPT09ICdvZ3JlJykge1xuICAgICAgICBkbWcgKj0gQi5zbWFzaC5tdWx0OyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3NtYXNoJywgaWQ6IGYuaWQsIHg6IHRnLngsIHo6IHRnLnosIHI6IEIuc21hc2gucmFkaXVzIH0pO1xuICAgICAgICBmb3IgKGNvbnN0IG8gb2YgdGhpcy5mb2VzKGYpKSBpZiAoby5pZCAhPT0gdGcuaWQgJiYgTWF0aC5oeXBvdChvLnggLSB0Zy54LCBvLnogLSB0Zy56KSA8PSBCLnNtYXNoLnJhZGl1cykgdGhpcy5kYW1hZ2UobywgZG1nICogMC42LCBmLCAnc21hc2gnKTtcbiAgICAgICAgdGhpcy5kYW1hZ2UodGcsIGRtZywgZiwgJ3NtYXNoJyk7IHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChmLnNvdWwgPT09ICdrbmlnaHQnKSB7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSA8PSBCLnRhdW50LnJhZGl1cykgeyBvLmZvcmNlZFRhcmdldCA9IGYuaWQ7IG8uZm9yY2VkVW50aWwgPSB0aGlzLnRpbWUgKyBCLnRhdW50LmR1cmF0aW9uOyBvLnJldGFyZ2V0QXQgPSAwOyB9XG4gICAgICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAndGF1bnQnLCBpZDogZi5pZCB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5kYW1hZ2UodGcsIGRtZywgZiwgJ21lbGVlJyk7XG4gIH1cblxuICBwcml2YXRlIGRhbWFnZSh0OiBGaWdodGVyLCBhbW91bnQ6IG51bWJlciwgZnJvbTogRmlnaHRlciwga2luZDogJ21lbGVlJyB8ICdhcnJvdycgfCAnc21hc2gnKTogdm9pZCB7XG4gICAgaWYgKCF0LmFsaXZlKSByZXR1cm47XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGxldCByZWQgPSAwO1xuICAgIGlmICh0LnNvdWwgPT09ICd3YXJyaW9yJykge1xuICAgICAgY29uc3QgbiA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8gIT09IHQgJiYgby50ZWFtID09PSB0LnRlYW0gJiYgby5zb3VsID09PSAnd2FycmlvcicgJiYgTWF0aC5oeXBvdChvLnggLSB0LngsIG8ueiAtIHQueikgPD0gQi5waGFsYW54LnJhZGl1cykubGVuZ3RoO1xuICAgICAgcmVkID0gTWF0aC5taW4oQi5waGFsYW54Lm1heFN0YWNrcywgbikgKiBCLnBoYWxhbngucGVyQWxseTtcbiAgICB9XG4gICAgY29uc3QgZG1nID0gYW1vdW50ICogKDEgLSByZWQpOyB0LmhwIC09IGRtZztcbiAgICBjb25zdCBNID0gQi5tYW5hW3Quc291bF07IGlmIChNICYmIHQuaHAgPiAwKSB0Lm1hbmEgPSBNYXRoLm1pbihNLm1heCwgdC5tYW5hICsgTS5wZXJIaXQpO1xuICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnaGl0JywgZnJvbTogZnJvbS5pZCwgdG86IHQuaWQsIGRtZywga2luZCB9KTtcbiAgICBpZiAodC5ocCA8PSAwKSB7IHQuaHAgPSAwOyB0LmFsaXZlID0gZmFsc2U7IHQuc3RhdGUgPSAnZGVhZCc7IHQuZGVhZEF0ID0gdGhpcy50aW1lOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2RlYXRoJywgaWQ6IHQuaWQgfSk7IH1cbiAgfVxufVxuXG4vKiogUnVuIGEgd2hvbGUgZmlnaHQgd2l0aG91dCBhbnkgZ3JhcGhpY3MuIFJldHVybnMgd2hvIHdvbiBhbmQgaG93IGl0IHdlbnQuICovXG5leHBvcnQgZnVuY3Rpb24gc2ltdWxhdGUocGxheWVyczogU2xvdFtdLCBlbmVtaWVzOiBTcGVjW10sIHNlZWQgPSAxLCBtYXhTZWNvbmRzID0gMTMwLCBsZXZlbHM/OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+KTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQsIGxldmVscyk7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgIi8vIEVuZW15IHdhdmVzLiBTYW1lIHVuaXQgcG9vbCBhcyB0aGUgcGxheWVyLiBUaGUgYnVpbGQgc2NyZWVuIHByZXZpZXdzIHRoZSBDT01QT1NJVElPTiBvbmx5LCBuZXZlciBwb3NpdGlvbnMuXG5cbmltcG9ydCB7IENPU1QsIENVUlZFUywgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBFbmVteVNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5cbmNvbnN0IExFVFRFUjogUmVjb3JkPHN0cmluZywgU291bElkPiA9IHsgVzogJ3dhcnJpb3InLCBBOiAnYXJjaGVyJywgRzogJ2dvYmxpbicsIEs6ICdrbmlnaHQnLCBPOiAnb2dyZScsIEI6ICdiYXJiYXJpYW4nIH07XG5jb25zdCBwYXJzZVdhdmUgPSAoczogc3RyaW5nKTogRW5lbXlTcGVjW10gPT4gcy5zcGxpdCgnICcpLm1hcCgodCkgPT4gKHsgc291bDogTEVUVEVSW3RbMF1dLCBzdGFyOiArdFsxXSB9KSk7XG5cbi8qKlxuICogRGlmZmljdWx0eSBwcmVzZXRzIGZvciBTdGFnZSAxICgxMCB3YXZlcykgKFcgd2FycmlvciwgQSBhcmNoZXIsIEcgZ29ibGluLCBLIGtuaWdodCwgTyBvZ3JlOyBkaWdpdCA9IHN0YXJzKS5cbiAqIE1lYXN1cmVkIHdpdGggc2ltL3R1bmVfd2F2ZXMudHMgYWdhaW5zdCBzdGFuZC1pbiBwbGF5ZXJzIChjb21wZXRlbnQgLyBjYXJlbGVzcyksIHN0YWdlLWNsZWFyIHJhdGU6XG4gKiAgIGVhc3kgICB+MTAwJSAvIH45MCUgICAgICBub3JtYWwgfjk0JSAvIH41MSUgICAgICBoYXJkIH43NSUgLyB+MjYlXG4gKiBBIHJlYWwgaHVtYW4gb24gYSBwaG9uZSBpcyBtdWNoIGxlc3MgY2FyZWZ1bCB0aGFuIHRoZSBjb21wZXRlbnQgc3RhbmQtaW4sIHNvIFwibm9ybWFsXCIgaXMgdGhlIGRlZmF1bHQuXG4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEnLCAnSzEgVzEnLCAnTzEgVzEgRzEnLCAnSzEgQTEgVzEnLCAnTzEgQTEgRzEnLCAnSzEgTzEgQTEnLCAnSzEgTzEgQTEgRzEnLCAnTzEgSzEgQTEgRzEnLCAnTzEgSzEgQTEgQjEnLCAnTzIgSzEgQTEgRzEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExJywgJ0sxIEcxIFcxJywgJ08xIEExIEcxIFcxJywgJ0sxIE8xIEExIFcxJywgJ08xIEsxIEExIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxJywgJ0sxIE8xIEExIEcxIFcxJywgJ08xIEsxIEExIEIxIEcxJywgJ08xIEsxIEEyIEIxIEcxJywgJ08yIEsxIEExIEIxIEcxIFcxJ10sXG4gIGhhcmQ6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEnLCAnTzEgQTEgRzEgVzEnLCAnSzEgTzEgQTEgVzEgRzEnLCAnTzEgSzEgQTIgRzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEnLCAnSzEgTzEgQTEgRzEgVzInLCAnTzEgSzEgQTIgQjEgRzEnLCAnTzIgSzEgQTIgQjEgRzEnLCAnTzIgSzIgQTEgQjEgRzEgVzEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExJywgJ08xIEExIEcxIFcxIEIxJywgJ0sxIE8xIEExIFcxIEcxJywgJ08xIEsxIEEyIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxJywgJ0sxIE8xIEEyIEcxIFcxIEIxJywgJ08xIEsyIEEyIEIxIEcxJywgJ08yIEsxIEEyIEIxIEcxIFcxJywgJ08yIEsyIEEyIEIxIEcxIFcxJ10sXG59O1xuXG4vKiogTmFtZXMgYW5kIG9uZS1saW5lIHByb21pc2VzIGZvciB0aGUgZGlmZmljdWx0eSBwaWNrZXIuIE1lYXN1cmVkIHN0YWdlLWNsZWFyIHJhdGVzIChjb21wZXRlbnQgLyBjYXJlbGVzcyBzdGFuZC1pbik6IGVhc3kgOTgvOTAsIG5vcm1hbCA4Mi80NCwgaGFyZCA1Ni8xNiwgbmlnaHRtYXJlIDMwLzguICovXG5leHBvcnQgY29uc3QgRElGRklDVUxUWV9JTkZPID0gW1xuICB7IGlkOiAnZWFzeScsIGxhYmVsOiAnRWFzeScsIGJsdXJiOiAnU21hbGxlciBlbmVteSBhcm1pZXMuIFJlbGF4IGFuZCBsZWFybiBob3cgbWVyZ2luZyB3b3Jrcy4nIH0sXG4gIHsgaWQ6ICdub3JtYWwnLCBsYWJlbDogJ05vcm1hbCcsIGJsdXJiOiAnQSBmYWlyIGZpZ2h0LiBNb3N0IHBsYXllcnMgY2xlYXIgaXQgd2l0aGluIGEgcnVuIG9yIHR3by4nIH0sXG4gIHsgaWQ6ICdoYXJkJywgbGFiZWw6ICdIYXJkJywgYmx1cmI6ICdTaGFycGVyIGFybWllcy4gTWlzdGFrZXMgY29zdCBoZWFydHMuJyB9LFxuICB7IGlkOiAnbmlnaHRtYXJlJywgbGFiZWw6ICdOaWdodG1hcmUnLCBibHVyYjogJ1N0YXJzIGFuZCBza2lsbHMgZXZlcnl3aGVyZS4gRXhwZWN0IHRvIGxvc2UgaGVhcnRzLCBhbmQgdG8gZWFybiB0aGUgd2luLicgfSxcbl07XG5leHBvcnQgbGV0IGRpZmZpY3VsdHlOYW1lID0gJ25vcm1hbCc7XG5cbi8qKiBIYW5kLWF1dGhvcmVkIHdhdmVzIGZvciBTdGFnZSAxICgxMCB3YXZlcykuIEJ1ZGdldHMgfiB0aGUgcGxheWVyJ3MgY2FwIGF0IHRoYXQgd2F2ZS4gRWRpdGVkIGluIHBsYWNlIGJ5IHNldERpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldERpZmZpY3VsdHkobmFtZTogc3RyaW5nKTogdm9pZCB7XG4gIGlmICghRElGRklDVUxUWVtuYW1lXSkgcmV0dXJuO1xuICBkaWZmaWN1bHR5TmFtZSA9IG5hbWU7IEFVVEhPUkVELmxlbmd0aCA9IDA7IERJRkZJQ1VMVFlbbmFtZV0uZm9yRWFjaCgodykgPT4gQVVUSE9SRUQucHVzaChwYXJzZVdhdmUodykpKTtcbn1cblxuZXhwb3J0IGNvbnN0IHdhdmVDb3N0ID0gKHc6IEVuZW15U3BlY1tdKTogbnVtYmVyID0+IHcucmVkdWNlKChuLCBlKSA9PiBuICsgQ09TVFtlLnNvdWxdW2Uuc3RhciAtIDFdLCAwKTtcblxuLyoqIEVuZW15IGFybXkgZm9yIGEgd2F2ZSAoMS1iYXNlZCkuIFdhdmVzIHBhc3QgdGhlIGF1dGhvcmVkIG9uZXMgYXJlIGdlbmVyYXRlZCBmcm9tIGEgZml4ZWQgc2VlZCBzbyByZXRyaWVzIGZhY2UgdGhlIHNhbWUgYXJteS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteVdhdmUod2F2ZTogbnVtYmVyLCBzdGFnZVNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBpZiAod2F2ZSA8PSBBVVRIT1JFRC5sZW5ndGgpIHJldHVybiBBVVRIT1JFRFt3YXZlIC0gMV0ubWFwKChlKSA9PiAoeyAuLi5lIH0pKTtcbiAgY29uc3QgY2FwID0gQ1VSVkVTLmRvY1tNYXRoLm1pbih3YXZlLCBDVVJWRVMuZG9jLmxlbmd0aCkgLSAxXTtcbiAgY29uc3QgYnVkZ2V0ID0gTWF0aC5yb3VuZChjYXAgKiAwLjkyKTtcbiAgY29uc3Qgcm5nID0gbWFrZVJuZyhzdGFnZVNlZWQgKiAxMDA5ICsgd2F2ZSAqIDc5MTkpO1xuICBjb25zdCBhcm15OiBFbmVteVNwZWNbXSA9IFtdO1xuICBsZXQgbGVmdCA9IGJ1ZGdldDtcbiAgZm9yIChsZXQgZ3VhcmQgPSAwOyBndWFyZCA8IDQwICYmIGxlZnQgPj0gMjsgZ3VhcmQrKykge1xuICAgIGNvbnN0IHNvdWwgPSBybmcucGljayhTT1VMUyk7XG4gICAgbGV0IHN0YXIgPSAxO1xuICAgIGlmIChybmcubmV4dCgpIDwgMC4zNSAmJiBDT1NUW3NvdWxdWzFdIDw9IGxlZnQpIHN0YXIgPSAyO1xuICAgIGlmICh3YXZlID49IDYgJiYgcm5nLm5leHQoKSA8IDAuMjUgJiYgQ09TVFtzb3VsXVsyXSA8PSBsZWZ0KSBzdGFyID0gMztcbiAgICBjb25zdCBjID0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gICAgaWYgKGMgPD0gbGVmdCAmJiBhcm15Lmxlbmd0aCA8IDEyKSB7IGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gYzsgfVxuICB9XG4gIHJldHVybiBhcm15O1xufVxuXG4vKiogV2hhdCB0aGUgYnVpbGQgc2NyZWVuIHNob3dzOiBjb3VudHMgcGVyIFNvdWwgYW5kIHN0YXIsIG5vIHBvc2l0aW9ucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmV2aWV3VGV4dCh3OiBFbmVteVNwZWNbXSk6IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfVtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfT4oKTtcbiAgZm9yIChjb25zdCBlIG9mIHcpIHtcbiAgICBjb25zdCBrID0gZS5zb3VsICsgZS5zdGFyO1xuICAgIGNvbnN0IGN1ciA9IG1hcC5nZXQoayk7XG4gICAgaWYgKGN1cikgY3VyLmNvdW50Kys7IGVsc2UgbWFwLnNldChrLCB7IHNvdWw6IGUuc291bCwgc3RhcjogZS5zdGFyLCBjb3VudDogMSB9KTtcbiAgfVxuICByZXR1cm4gWy4uLm1hcC52YWx1ZXMoKV07XG59XG4iLCAiaW1wb3J0IHsgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuXG4vKipcbiAqIFJ1bGVzIGZvciB0aGUgcGxheWFibGUgU3RhZ2UgMSAoMTAgd2F2ZXMpOiBkb2MgRG9taW5pb24gY3VydmUsIGJvbnVzIGRyYXcgb25seSBvbiB0aGUgZWFybHkgd2F2ZXMuXG4gKiBtZXJnZSAnaGFuZEludG9PbmVTdGFyJzogYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBtZXJnZSBzdHJhaWdodCBpbnRvIGEgbWF0Y2hpbmcgZGVwbG95ZWQgMS1zdGFyIHVuaXQgKHBheWluZyBvbmx5IHRoZSBjb3N0XG4gKiBkaWZmZXJlbmNlKS4gV2l0aG91dCBpdCB0aGUgY2FwIGNhbiBibG9jayBhIG1lcmdlIHlvdSBjb3VsZCBhZmZvcmQgKHlvdSB3b3VsZCBuZWVkIHJvb20gdG8gc3VtbW9uIEJPVEggY29waWVzIGZpcnN0KS5cbiAqIFRoZSBkZWJ1ZyBwYW5lbCBjYW4gc3dpdGNoIHRoaXMgYmFjayB0byB0aGUgZG9jJ3MgZGVwbG95ZWQtb25seSBydWxlLlxuICovXG5leHBvcnQgY29uc3QgUFJPVE9UWVBFX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IENVUlZFUy5kb2MsIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogMTAsIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG4iLCAiLy8gU291bCBQYWNrcyAocGxhbiBkb2Mgc2VjdGlvbiAxNykuIFB1cmUgcnVsZXMsIG5vIGdyYXBoaWNzLiBBTEwgTlVNQkVSUyBBUkUgUExBQ0VIT0xERVIgTEVWRVJTOiB3ZSBzZXR0bGVkIHRoZSBzdHJ1Y3R1cmUgZmlyc3QgYW5kIHdpbGwgdHVuZVxuLy8gcXVhbnRpdGllcyB3aXRoIHRoZSBwcm9ncmVzc2lvbiBzaW11bGF0aW9uIChzaW0vcHJvZ3Jlc3Npb24udHMpIG9uY2UgdGhlIGxvb3AgY2FuIGJlIHBsYXllZC5cbi8vXG4vLyAgIFNvdWwgcmFyaXR5ICAtPiBob3cgb2Z0ZW4gYSBTb3VsIHNob3dzIHVwIGFuZCBob3cgYmlnIGl0cyBzdGFjayBvZiBjb3BpZXMgdGVuZHMgdG8gYmUuXG4vLyAgIFBhY2sgdGllciAgICAtPiB0aGUgcGFjaydzIG92ZXJhbGwgdmFsdWUgKHNrdWxscywgMS0zIGZvciBub3cpOiBudW1iZXIgb2YgcmV2ZWFscyArIGhvdyBnb29kIHRoZSByYXJpdHkgb2RkcyBhcmUuXG4vLyAgIEEgcGFjayBoYXMgYSBTVEFSVElORyB0aWVyIGFuZCBtYXkgdXBncmFkZSB3aGlsZSBpdCBpcyBiZWluZyBvcGVuZWQ7IHRoZSByZXN1bHQgaXMgZGVjaWRlZCB1cCBmcm9udCwgdGhlIGFuaW1hdGlvbiBvbmx5IHNob3dzIGl0LlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IHR5cGUgUmFyaXR5ID0gJ2NvbW1vbicgfCAncmFyZScgfCAnZXBpYycgfCAnbGVnZW5kYXJ5JztcbmV4cG9ydCBjb25zdCBSQVJJVElFUzogUmFyaXR5W10gPSBbJ2NvbW1vbicsICdyYXJlJywgJ2VwaWMnLCAnbGVnZW5kYXJ5J107XG5leHBvcnQgY29uc3QgUkFSSVRZX05BTUU6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJ0NvbW1vbicsIHJhcmU6ICdSYXJlJywgZXBpYzogJ0VwaWMnLCBsZWdlbmRhcnk6ICdMZWdlbmRhcnknIH07XG5cbi8qKiBSYXJpdHkgcGVyIFNvdWwuIFBMQUNFSE9MREVSIGFzc2lnbm1lbnQgKG5vIExlZ2VuZGFyeSBTb3VsIGV4aXN0cyB5ZXQpLiAqL1xuZXhwb3J0IGNvbnN0IFJBUklUWV9PRjogUmVjb3JkPFNvdWxJZCwgUmFyaXR5PiA9IHsgd2FycmlvcjogJ2NvbW1vbicsIGdvYmxpbjogJ2NvbW1vbicsIGFyY2hlcjogJ3JhcmUnLCBrbmlnaHQ6ICdyYXJlJywgb2dyZTogJ2VwaWMnLCBiYXJiYXJpYW46ICdlcGljJyB9O1xuXG4vKiogUmFyZXIgU291bHMgdHVybiB1cCBpbiBzbWFsbGVyIHN0YWNrcywgc28gdGhleSBuZWVkIGZld2VyIGNvcGllcyBwZXIgbGV2ZWwgKG11bHRpcGxpZXIgb24gdGhlIGxldmVsIGNvc3RzKS4gUExBQ0VIT0xERVIuICovXG5leHBvcnQgY29uc3QgTEVWRUxfQ09TVF9NVUxUOiBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+ID0geyBjb21tb246IDEsIHJhcmU6IDAuNiwgZXBpYzogMC4zNSwgbGVnZW5kYXJ5OiAwLjIgfTtcblxuZXhwb3J0IGNvbnN0IFBBQ0tfVElFUlMgPSAzO1xuZXhwb3J0IGNvbnN0IFBBQ0sgPSB7XG4gIHJldmVhbHM6IFszLCA0LCA1XSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNlcGFyYXRlIHJldmVhbHMgcGVyIHRpZXIgKGluZGV4IDAgPSB0aWVyIDEpXG4gIHN0YWNrTXVsdDogWzEsIDEuNSwgMl0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvcHkgc3RhY2tzIGFyZSBiaWdnZXIgaW4gYmV0dGVyIHBhY2tzXG4gIC8qKiBSYXJpdHkgb2RkcyBwZXIgdGllciwgaW4gcGVyY2VudC4gKi9cbiAgb2RkczogW1xuICAgIHsgY29tbW9uOiA3MCwgcmFyZTogMjUsIGVwaWM6IDUsIGxlZ2VuZGFyeTogMCB9LFxuICAgIHsgY29tbW9uOiA1NSwgcmFyZTogMzMsIGVwaWM6IDExLCBsZWdlbmRhcnk6IDEgfSxcbiAgICB7IGNvbW1vbjogNDAsIHJhcmU6IDM4LCBlcGljOiAxOSwgbGVnZW5kYXJ5OiAzIH0sXG4gIF0gYXMgUmVjb3JkPFJhcml0eSwgbnVtYmVyPltdLFxuICAvKiogQ29waWVzIGluIG9uZSByZXZlYWwgYmVmb3JlIHRoZSB0aWVyIG11bHRpcGxpZXI6IFttaW4sIG1heF0uICovXG4gIHN0YWNrOiB7IGNvbW1vbjogWzYsIDEwXSwgcmFyZTogWzMsIDVdLCBlcGljOiBbMSwgM10sIGxlZ2VuZGFyeTogWzEsIDFdIH0gYXMgUmVjb3JkPFJhcml0eSwgW251bWJlciwgbnVtYmVyXT4sXG4gIC8qKiBDaGFuY2UgdG8ganVtcCB1cCBvbmUgdGllciBkdXJpbmcgdGhlIG9wZW5pbmcsIGZyb20gdGllciAxIGFuZCBmcm9tIHRpZXIgMiAoYSBsdWNreSBwYWNrIGNhbiBqdW1wIHR3aWNlKS4gKi9cbiAgdXBncmFkZUNoYW5jZTogWzAuMiwgMC4xMl0sXG59O1xuXG4vKiogQW4gdW5vcGVuZWQgcGFjayB0aGUgcGxheWVyIG93bnMuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhY2tJdGVtIHsgaWQ6IG51bWJlcjsgdGllcjogbnVtYmVyOyBzb3VyY2U6IHN0cmluZyB9XG5leHBvcnQgaW50ZXJmYWNlIFJldmVhbCB7IHNvdWw6IFNvdWxJZDsgcmFyaXR5OiBSYXJpdHk7IGNvcGllczogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgUGFja1Jlc3VsdCB7IHN0YXJ0VGllcjogbnVtYmVyOyBmaW5hbFRpZXI6IG51bWJlcjsgdXBncmFkZXM6IG51bWJlcltdOyByZXZlYWxzOiBSZXZlYWxbXSB9XG5cbmNvbnN0IHJhcml0eVJhbmsgPSAocjogUmFyaXR5KSA9PiBSQVJJVElFUy5pbmRleE9mKHIpO1xuXG5mdW5jdGlvbiByb2xsUmFyaXR5KHRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBSYXJpdHkge1xuICBjb25zdCBvZGRzID0gUEFDSy5vZGRzW3RpZXIgLSAxXTsgbGV0IHJvbGwgPSBybmcubmV4dCgpICogUkFSSVRJRVMucmVkdWNlKChuLCByKSA9PiBuICsgb2Rkc1tyXSwgMCk7XG4gIGZvciAoY29uc3QgciBvZiBSQVJJVElFUykgeyBpZiAocm9sbCA8IG9kZHNbcl0pIHJldHVybiByOyByb2xsIC09IG9kZHNbcl07IH1cbiAgcmV0dXJuICdjb21tb24nO1xufVxuXG4vKiogQSByYW5kb20gU291bCBvZiB0aGlzIHJhcml0eTsgaWYgdGhlIHJvc3RlciBoYXMgbm9uZSBvZiB0aGF0IHJhcml0eSB5ZXQsIHRoZSBuZXh0IGxvd2VyIG9uZSBpcyB1c2VkLiAqL1xuZnVuY3Rpb24gc291bE9mUmFyaXR5KHJhcml0eTogUmFyaXR5LCBybmc6IFJuZyk6IFNvdWxJZCB7XG4gIGZvciAobGV0IGkgPSByYXJpdHlSYW5rKHJhcml0eSk7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHBvb2wgPSBTT1VMUy5maWx0ZXIoKHMpID0+IFJBUklUWV9PRltzXSA9PT0gUkFSSVRJRVNbaV0pOyBpZiAocG9vbC5sZW5ndGgpIHJldHVybiBybmcucGljayhwb29sKTsgfVxuICByZXR1cm4gcm5nLnBpY2soU09VTFMpO1xufVxuXG4vKiogT3BlbiBhIHBhY2s6IHJvbGwgdXBncmFkZXMgZmlyc3QgKHNvIHRoZSBhbmltYXRpb24gY2FuIHBsYXkgdGhlbSBiZWZvcmUgdGhlIHBhY2sgdGVhcnMgb3BlbiksIHRoZW4gdGhlIHJldmVhbHMuIEJlc3QgcmV2ZWFsIGNvbWVzIGxhc3QuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblBhY2soc3RhcnRUaWVyOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB7XG4gIGNvbnN0IHQwID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcihzdGFydFRpZXIpKSksIHVwZ3JhZGVzOiBudW1iZXJbXSA9IFtdO1xuICBsZXQgdGllciA9IHQwO1xuICB3aGlsZSAodGllciA8IFBBQ0tfVElFUlMgJiYgcm5nLm5leHQoKSA8IFBBQ0sudXBncmFkZUNoYW5jZVt0aWVyIC0gMV0pIHsgdGllcisrOyB1cGdyYWRlcy5wdXNoKHRpZXIpOyB9XG4gIGNvbnN0IHJldmVhbHM6IFJldmVhbFtdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgUEFDSy5yZXZlYWxzW3RpZXIgLSAxXTsgaSsrKSB7XG4gICAgY29uc3QgcmFyaXR5ID0gcm9sbFJhcml0eSh0aWVyLCBybmcpLCBzb3VsID0gc291bE9mUmFyaXR5KHJhcml0eSwgcm5nKSwgW2xvLCBoaV0gPSBQQUNLLnN0YWNrW1JBUklUWV9PRltzb3VsXV07XG4gICAgcmV2ZWFscy5wdXNoKHsgc291bCwgcmFyaXR5OiBSQVJJVFlfT0Zbc291bF0sIGNvcGllczogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgobG8gKyBybmcuaW50KGhpIC0gbG8gKyAxKSkgKiBQQUNLLnN0YWNrTXVsdFt0aWVyIC0gMV0pKSB9KTtcbiAgfVxuICByZXZlYWxzLnNvcnQoKGEsIGIpID0+IHJhcml0eVJhbmsoYS5yYXJpdHkpIC0gcmFyaXR5UmFuayhiLnJhcml0eSkgfHwgYS5jb3BpZXMgLSBiLmNvcGllcyk7XG4gIHJldHVybiB7IHN0YXJ0VGllcjogdDAsIGZpbmFsVGllcjogdGllciwgdXBncmFkZXMsIHJldmVhbHMgfTtcbn1cblxuLyoqIFRvdGFsIGNvcGllcyBwZXIgU291bCBpbiBhIHJlc3VsdCAodGhlIHNhbWUgU291bCBjYW4gYmUgcmV2ZWFsZWQgbW9yZSB0aGFuIG9uY2UpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvcGllc0J5U291bChyZXN1bHQ6IFBhY2tSZXN1bHQpOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+IHtcbiAgY29uc3Qgb3V0OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+ID0ge307XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgb3V0W3Iuc291bF0gPSAob3V0W3Iuc291bF0gPz8gMCkgKyByLmNvcGllcztcbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3Mgc2F2ZWQgcHJvZ3Jlc3MuIEZyYW1ld29yay1mcmVlIHNvIHRoZSBnYW1lIGJ1bmRsZSBhbmQgdGhlIG5hdmlnYXRpb24gc2hlbGwgYm90aCB1c2UgaXQuXG4vLyBTdG9yZWQgaW4gbG9jYWxTdG9yYWdlIGFzIEpTT04uIEV2ZXJ5IHJlYWQvd3JpdGUgaXMgZ3VhcmRlZDogcHJpdmF0ZSB3aW5kb3dzIGFuZCBibG9ja2VkIHN0b3JhZ2UgbXVzdCBuZXZlciBicmVhayB0aGUgZ2FtZS5cblxuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUEFDS19USUVSUyB9IGZyb20gJy4vcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBQYWNrSXRlbSB9IGZyb20gJy4vcGFja3MudHMnO1xuXG5leHBvcnQgY29uc3QgREVDS19TSVpFID0gNjsgICAgICAgICAgICAgICAgICAgICAvLyBkb2M6IHNpeCBlcXVpcHBlZCBTb3VscyBwZXIgc3RhZ2VcbmNvbnN0IEtFWSA9ICduZWNyby1zYXZlJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgdHlwZSBEaWZmaWN1bHR5ID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGSUNVTFRJRVM6IERpZmZpY3VsdHlbXSA9IFsnZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXTtcbmV4cG9ydCBpbnRlcmZhY2UgU2V0dGluZ3MgeyBtdXNpYzogYm9vbGVhbjsgc2Z4OiBib29sZWFuIH1cbmV4cG9ydCBpbnRlcmZhY2UgU291bFByb2dyZXNzIHsgbGV2ZWw6IG51bWJlcjsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTYXZlIHtcbiAgdjogbnVtYmVyO1xuICBkZWNrOiBTb3VsSWRbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXF1aXBwZWQgU291bHMsIGF0IG1vc3QgREVDS19TSVpFLCBhdCBsZWFzdCAxXG4gIHNvdWxzOiBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+OyAgICAgICAgICAvLyBQTEFDRUhPTERFUiBwcm9ncmVzc2lvbiB1bnRpbCBwYWNrcyBleGlzdFxuICBzZXR0aW5nczogU2V0dGluZ3M7ICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc291bmQgc3dpdGNoZXM7IGJvdGggb24gYnkgZGVmYXVsdFxuICBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5OyAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hvc2VuIG9uIEhvbWU7IGFwcGxpZXMgdG8gdGhlIG5leHQgcnVuXG4gIHBhY2tzOiBQYWNrSXRlbVtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bm9wZW5lZCBTb3VsIFBhY2tzXG4gIG5leHRQYWNrSWQ6IG51bWJlcjtcbiAgY2xlYXJzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+OyAgICAgICAgICAgICAgIC8vIHN0YWdlIGNsZWFycywga2V5ZWQgJ3N0YWdlOmRpZmZpY3VsdHknXG4gIHJlcGxheU1ldGVyOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXBsYXkgY2xlYXJzIHRvd2FyZCB0aGUgbmV4dCByZXBsYXkgcGFja1xufVxuZXhwb3J0IGludGVyZmFjZSBTdG9yZSB7IGdldEl0ZW0oazogc3RyaW5nKTogc3RyaW5nIHwgbnVsbDsgc2V0SXRlbShrOiBzdHJpbmcsIHY6IHN0cmluZyk6IHZvaWQgfVxuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFNhdmUoKTogU2F2ZSB7XG4gIGNvbnN0IHNvdWxzID0ge30gYXMgUmVjb3JkPFNvdWxJZCwgU291bFByb2dyZXNzPjtcbiAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykgc291bHNbaWRdID0geyBsZXZlbDogMSwgY29waWVzOiAwIH07XG4gIHJldHVybiB7IHY6IFZFUlNJT04sIGRlY2s6IFNPVUxTLnNsaWNlKDAsIERFQ0tfU0laRSksIHNvdWxzLCBzZXR0aW5nczogeyBtdXNpYzogdHJ1ZSwgc2Z4OiB0cnVlIH0sIGRpZmZpY3VsdHk6ICdub3JtYWwnLCBwYWNrczogW10sIG5leHRQYWNrSWQ6IDEsIGNsZWFyczoge30sIHJlcGxheU1ldGVyOiAwIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicm93c2VyU3RvcmUoKTogU3RvcmUgfCBudWxsIHsgdHJ5IHsgcmV0dXJuIHR5cGVvZiBsb2NhbFN0b3JhZ2UgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGxvY2FsU3RvcmFnZTsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9IH1cblxuLyoqIFJlcGFpciB3aGF0ZXZlciB3YXMgc3RvcmVkOiB1bmtub3duIFNvdWxzIGRyb3BwZWQsIGR1cGxpY2F0ZXMgcmVtb3ZlZCwgZGVjayBjYXBwZWQsIG5vdGhpbmcgZW1wdHkuIE9sZCB2ZXJzaW9ucyBrZWVwIHRoZWlyIHByb2dyZXNzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplKHJhdzogYW55KTogU2F2ZSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0U2F2ZSgpO1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IGRlY2s6IFNvdWxJZFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5kZWNrKSkgZm9yIChjb25zdCBkIG9mIHJhdy5kZWNrKSBpZiAoU09VTFMuaW5jbHVkZXMoZCkgJiYgIWRlY2suaW5jbHVkZXMoZCkgJiYgZGVjay5sZW5ndGggPCBERUNLX1NJWkUpIGRlY2sucHVzaChkKTtcbiAgaWYgKGRlY2subGVuZ3RoKSBiYXNlLmRlY2sgPSBkZWNrO1xuICBpZiAocmF3LnNvdWxzICYmIHR5cGVvZiByYXcuc291bHMgPT09ICdvYmplY3QnKSB7XG4gICAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykge1xuICAgICAgY29uc3QgcCA9IHJhdy5zb3Vsc1tpZF07XG4gICAgICBpZiAocCAmJiBOdW1iZXIuaXNGaW5pdGUocC5sZXZlbCkgJiYgTnVtYmVyLmlzRmluaXRlKHAuY29waWVzKSkgYmFzZS5zb3Vsc1tpZF0gPSB7IGxldmVsOiBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHAubGV2ZWwpKSwgY29waWVzOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHAuY29waWVzKSkgfTtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5zZXR0aW5ncyAmJiB0eXBlb2YgcmF3LnNldHRpbmdzID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLm11c2ljID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3MubXVzaWMgPSByYXcuc2V0dGluZ3MubXVzaWM7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3Muc2Z4ID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3Muc2Z4ID0gcmF3LnNldHRpbmdzLnNmeDtcbiAgfVxuICBpZiAoRElGRklDVUxUSUVTLmluY2x1ZGVzKHJhdy5kaWZmaWN1bHR5KSkgYmFzZS5kaWZmaWN1bHR5ID0gcmF3LmRpZmZpY3VsdHk7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5wYWNrcykpIHtcbiAgICBjb25zdCBpZHMgPSBuZXcgU2V0PG51bWJlcj4oKTtcbiAgICBmb3IgKGNvbnN0IHAgb2YgcmF3LnBhY2tzKSB7XG4gICAgICBpZiAoYmFzZS5wYWNrcy5sZW5ndGggPj0gOTkgfHwgIXAgfHwgIU51bWJlci5pc0ludGVnZXIocC5pZCkgfHwgcC5pZCA8IDEgfHwgaWRzLmhhcyhwLmlkKSB8fCAhTnVtYmVyLmlzSW50ZWdlcihwLnRpZXIpIHx8IHAudGllciA8IDEgfHwgcC50aWVyID4gUEFDS19USUVSUykgY29udGludWU7XG4gICAgICBpZHMuYWRkKHAuaWQpOyBiYXNlLnBhY2tzLnB1c2goeyBpZDogcC5pZCwgdGllcjogcC50aWVyLCBzb3VyY2U6IHR5cGVvZiBwLnNvdXJjZSA9PT0gJ3N0cmluZycgPyBwLnNvdXJjZS5zbGljZSgwLCA0MCkgOiAnJyB9KTtcbiAgICB9XG4gIH1cbiAgY29uc3QgbWF4SWQgPSBiYXNlLnBhY2tzLnJlZHVjZSgobiwgcCkgPT4gTWF0aC5tYXgobiwgcC5pZCksIDApO1xuICBiYXNlLm5leHRQYWNrSWQgPSBNYXRoLm1heChtYXhJZCArIDEsIE51bWJlci5pc0ludGVnZXIocmF3Lm5leHRQYWNrSWQpICYmIHJhdy5uZXh0UGFja0lkID4gMCA/IHJhdy5uZXh0UGFja0lkIDogMSk7XG4gIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JykgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMocmF3LmNsZWFycykpIGlmICh0eXBlb2YgayA9PT0gJ3N0cmluZycgJiYgay5sZW5ndGggPCA0MCAmJiBOdW1iZXIuaXNJbnRlZ2VyKHYpICYmICh2IGFzIG51bWJlcikgPiAwKSBiYXNlLmNsZWFyc1trXSA9IHYgYXMgbnVtYmVyO1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcucmVwbGF5TWV0ZXIpICYmIHJhdy5yZXBsYXlNZXRlciA+PSAwICYmIHJhdy5yZXBsYXlNZXRlciA8IDUwKSBiYXNlLnJlcGxheU1ldGVyID0gcmF3LnJlcGxheU1ldGVyO1xuICByZXR1cm4gYmFzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRTYXZlKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IFNhdmUge1xuICB0cnkgeyBjb25zdCB0ID0gc3RvcmUgJiYgc3RvcmUuZ2V0SXRlbShLRVkpOyByZXR1cm4gc2FuaXRpemUodCA/IEpTT04ucGFyc2UodCkgOiBudWxsKTsgfSBjYXRjaCB7IHJldHVybiBkZWZhdWx0U2F2ZSgpOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZVNhdmUoc2F2ZTogU2F2ZSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogdm9pZCB7XG4gIHRyeSB7IGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksIEpTT04uc3RyaW5naWZ5KHNhdmUpKTsgfSBjYXRjaCB7IC8qIHN0b3JhZ2UgZnVsbCBvciBibG9ja2VkOiBrZWVwIHBsYXlpbmcgKi8gfVxufVxuXG4vKiogQ2hhbmdlIHNvdW5kIHNldHRpbmdzIHdpdGhvdXQgdG91Y2hpbmcgdGhlIHJlc3Qgb2YgdGhlIHNhdmUuICovXG5leHBvcnQgZnVuY3Rpb24gdXBkYXRlU2V0dGluZ3MocGF0Y2g6IFBhcnRpYWw8U2V0dGluZ3M+LCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTZXR0aW5ncyB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuc2V0dGluZ3MgPSB7IC4uLnMuc2V0dGluZ3MsIC4uLnBhdGNoIH07IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLnNldHRpbmdzO1xufVxuXG4vKiogUmVtZW1iZXIgdGhlIGNob3NlbiBkaWZmaWN1bHR5IHdpdGhvdXQgdG91Y2hpbmcgdGhlIHJlc3Qgb2YgdGhlIHNhdmUuICovXG5leHBvcnQgZnVuY3Rpb24gdXBkYXRlRGlmZmljdWx0eShkOiBEaWZmaWN1bHR5LCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBEaWZmaWN1bHR5IHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgcy5kaWZmaWN1bHR5ID0gRElGRklDVUxUSUVTLmluY2x1ZGVzKGQpID8gZCA6IHMuZGlmZmljdWx0eTsgd3JpdGVTYXZlKHMsIHN0b3JlKTsgcmV0dXJuIHMuZGlmZmljdWx0eTtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3MgY2hhcmFjdGVyOiB0aGUgTmVjcm9tYW5jZXIuIEEgcHJvY2VkdXJhbCBwbGFjZWhvbGRlciAobm8gVHJpcG8gbW9kZWwgeWV0KTogaG9vZGVkIHJvYmUsIGdsb3dpbmcgcHVycGxlIGV5ZXMsIGNyeXN0YWwgc3RhZmYuXG4vLyBIZSBzdGFuZHMgYmVzaWRlIHRoZSBncmlkLCB0YWtlcyB0aGUgaGl0IHdoZW4gYW4gYXJteSBpcyB3aXBlZCAoaGVhcnRzIGFyZSBISVMgaGVhbHRoKSwgdW5sZWFzaGVzIHRoZSByZXB1bHNpb24gc2hvY2t3YXZlIGFuZCByYWlzZXNcbi8vIHRoZSBmYWxsZW4uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBhbmltYXRpb24gb25seTsgdGhlIHJ1bGVzIGxpdmUgaW4gY29yZS9ydWxlcy50cy5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuXG5leHBvcnQgY2xhc3MgTmVjcm9tYW5jZXIge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb247IGxvY2FsICtaIGlzIGhpcyBmYWNpbmcgKHRoZSBnYW1lIHJvdGF0ZXMgaGltIHRvIGZhY2UgdGhlIGJhdHRsZWZpZWxkKVxuICBwcml2YXRlIHJpZzogYW55OyBwcml2YXRlIHN0YWZmUGl2b3Q6IGFueTsgcHJpdmF0ZSBjcnlzdGFsOiBhbnk7IHByaXZhdGUgY3J5c3RhbE1hdDogYW55OyBwcml2YXRlIHJvYmVNYXQ6IGFueTsgcHJpdmF0ZSBleWVNYXQ6IGFueTsgcHJpdmF0ZSBwczogYW55OyBwcml2YXRlIGdsb3c6IGFueTtcbiAgcHJpdmF0ZSB0ID0gMDsgcHJpdmF0ZSBodXJ0VCA9IDA7IHByaXZhdGUgY2FzdFQgPSAwOyBwcml2YXRlIGRvd24gPSAwOyBwcml2YXRlIGRvd25UYXJnZXQgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgc2NlbmU6IGFueSwgcHJpdmF0ZSBzb2Z0OiBhbnkpIHtcbiAgICBjb25zdCBzID0gc2NlbmUsIG1hdCA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyLCBlciA9IDAsIGVnID0gMCwgZWIgPSAwKSA9PiB7XG4gICAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbm0nLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhlciwgZWcsIGViKTsgbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgcmV0dXJuIG07XG4gICAgfTtcbiAgICBjb25zdCBnbG93TWF0ID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCduZycsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCduZWNybycsIHMpOyB0aGlzLnJpZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ25lY3JvUmlnJywgcyk7IHRoaXMucmlnLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIGNvbnN0IGFkZCA9IChtZXNoOiBhbnksIHBhcmVudCA9IHRoaXMucmlnKSA9PiB7IG1lc2gucGFyZW50ID0gcGFyZW50OyBtZXNoLmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIG1lc2g7IH07XG4gICAgdGhpcy5yb2JlTWF0ID0gbWF0KDAuMDksIDAuMDMsIDAuMTYsIDAuMDUsIDAuMDIsIDAuMSk7XG4gICAgY29uc3Qgcm9iZSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdyb2JlJywgeyBoZWlnaHQ6IDAuODIsIGRpYW1ldGVyVG9wOiAwLjMsIGRpYW1ldGVyQm90dG9tOiAwLjgsIHRlc3NlbGxhdGlvbjogMjAgfSwgcykpOyByb2JlLnBvc2l0aW9uLnkgPSAwLjQxOyByb2JlLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IGhlbSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoZW0nLCB7IGRpYW1ldGVyOiAwLjc4LCB0aGlja25lc3M6IDAuMDM1LCB0ZXNzZWxsYXRpb246IDI4IH0sIHMpKTsgaGVtLnBvc2l0aW9uLnkgPSAwLjAzOyBoZW0ubWF0ZXJpYWwgPSBnbG93TWF0KDAuOSwgMC43LCAwLjI1KTtcbiAgICBjb25zdCBtYW50bGUgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ21hbnRsZScsIHsgZGlhbWV0ZXI6IDAuNiwgc2VnbWVudHM6IDEyIH0sIHMpKTsgbWFudGxlLnNjYWxpbmcuc2V0KDEsIDAuNSwgMC44KTsgbWFudGxlLnBvc2l0aW9uLnkgPSAwLjg7IG1hbnRsZS5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCBob29kID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdob29kJywgeyBkaWFtZXRlcjogMC41Niwgc2VnbWVudHM6IDE0IH0sIHMpKTsgaG9vZC5wb3NpdGlvbi55ID0gMS4wOyBob29kLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IHRpcCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCd0aXAnLCB7IGhlaWdodDogMC40LCBkaWFtZXRlclRvcDogMCwgZGlhbWV0ZXJCb3R0b206IDAuMzQsIHRlc3NlbGxhdGlvbjogMTQgfSwgcykpOyB0aXAucG9zaXRpb24uc2V0KDAsIDEuMjgsIC0wLjA2KTsgdGlwLnJvdGF0aW9uLnggPSAtMC4zNTsgdGlwLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IGZhY2UgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2ZhY2UnLCB7IGRpYW1ldGVyOiAwLjM4LCBzZWdtZW50czogMTIgfSwgcykpOyBmYWNlLnBvc2l0aW9uLnNldCgwLCAwLjk5LCAwLjEyKTsgZmFjZS5tYXRlcmlhbCA9IG1hdCgwLjAyLCAwLCAwLjA1KTtcbiAgICB0aGlzLmV5ZU1hdCA9IGdsb3dNYXQoMC45LCAwLjQsIDEpO1xuICAgIGZvciAoY29uc3QgeCBvZiBbLTAuMDc1LCAwLjA3NV0pIHsgY29uc3QgZSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZXllJywgeyBkaWFtZXRlcjogMC4wNzUsIHNlZ21lbnRzOiA4IH0sIHMpKTsgZS5wb3NpdGlvbi5zZXQoeCwgMS4wLCAwLjI4NSk7IGUuc2NhbGluZy56ID0gMC42OyBlLm1hdGVyaWFsID0gdGhpcy5leWVNYXQ7IH1cbiAgICB0aGlzLmdsb3cgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZXllR2xvdycsIHsgc2l6ZTogMC41IH0sIHMpKTsgdGhpcy5nbG93LnBvc2l0aW9uLnNldCgwLCAxLjAsIDAuMzMpOyB0aGlzLmdsb3cuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDtcbiAgICBjb25zdCBnbSA9IGdsb3dNYXQoMC43LCAwLjI1LCAxLCAwLjU1KTsgZ20uZW1pc3NpdmVUZXh0dXJlID0gc29mdDsgZ20ub3BhY2l0eVRleHR1cmUgPSBzb2Z0OyB0aGlzLmdsb3cubWF0ZXJpYWwgPSBnbTtcbiAgICBjb25zdCBoYW5kID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdoYW5kJywgeyBkaWFtZXRlcjogMC4xMiwgc2VnbWVudHM6IDggfSwgcykpOyBoYW5kLnBvc2l0aW9uLnNldCgtMC4zMiwgMC42MiwgMC4xMik7IGhhbmQubWF0ZXJpYWwgPSBtYXQoMC44LCAwLjc1LCAwLjY1KTtcbiAgICAvLyBzdGFmZjogcGl2b3QgYXQgdGhlIHJpZ2h0IGhhbmQgc28gcmFpc2luZyBpdCBpcyBvbmUgcm90YXRpb25cbiAgICB0aGlzLnN0YWZmUGl2b3QgPSBhZGQobmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnc3RhZmZQaXZvdCcsIHMpKTsgdGhpcy5zdGFmZlBpdm90LnBvc2l0aW9uLnNldCgwLjM0LCAwLjYsIDAuMTQpO1xuICAgIGNvbnN0IHJvZCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdyb2QnLCB7IGhlaWdodDogMS41LCBkaWFtZXRlcjogMC4wNDUsIHRlc3NlbGxhdGlvbjogOCB9LCBzKSwgdGhpcy5zdGFmZlBpdm90KTsgcm9kLnBvc2l0aW9uLnkgPSAwLjQ1OyByb2QubWF0ZXJpYWwgPSBtYXQoMC4yOCwgMC4xNywgMC4xKTtcbiAgICB0aGlzLmNyeXN0YWxNYXQgPSBnbG93TWF0KDAuNzUsIDAuMzUsIDEpO1xuICAgIHRoaXMuY3J5c3RhbCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBvbHloZWRyb24oJ2NyeXN0YWwnLCB7IHR5cGU6IDEsIHNpemU6IDAuMTIgfSwgcyksIHRoaXMuc3RhZmZQaXZvdCk7IHRoaXMuY3J5c3RhbC5wb3NpdGlvbi55ID0gMS4yODsgdGhpcy5jcnlzdGFsLnNjYWxpbmcueSA9IDEuNTsgdGhpcy5jcnlzdGFsLnJvdGF0aW9uLnggPSAwLjQ7IHRoaXMuY3J5c3RhbC5tYXRlcmlhbCA9IHRoaXMuY3J5c3RhbE1hdDtcbiAgICBjb25zdCByaW5nID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygnYmFzZScsIHsgcmFkaXVzOiAwLjYyLCB0ZXNzZWxsYXRpb246IDMwIH0sIHMpLCB0aGlzLmhvbGRlcik7IHJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyByaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyByaW5nLm1hdGVyaWFsID0gZ2xvd01hdCgwLjQsIDAuMTUsIDAuNzUsIDAuNTUpO1xuICAgIC8vIGF1cmFcbiAgICBjb25zdCBwcyA9IHRoaXMucHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnbmVjcm9BdXJhJywgODAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSBzb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5ob2xkZXI7XG4gICAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMywgMCwgLTAuMyk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMywgMC45LCAwLjMpOyBwcy5taW5MaWZlVGltZSA9IDAuNjsgcHMubWF4TGlmZVRpbWUgPSAxLjM7XG4gICAgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMTUsIDAuOSwgLTAuMTUpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjE1LCAxLjYsIDAuMTUpOyBwcy5taW5FbWl0UG93ZXIgPSAwLjM7IHBzLm1heEVtaXRQb3dlciA9IDAuODsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4wNzsgcHMubWF4U2l6ZSA9IDAuMjsgcHMuZW1pdFJhdGUgPSAzMDsgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDAuOCwgMC4zNSwgMSwgMC43KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KDAuNDUsIDAuMTUsIDAuOSwgMC41KTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICBzZXRFbmFibGVkKG9uOiBib29sZWFuKSB7IHRoaXMuaG9sZGVyLnNldEVuYWJsZWQob24pOyBpZiAob24pIHRoaXMucHMuc3RhcnQoKTsgZWxzZSB0aGlzLnBzLnN0b3AoKTsgfVxuICAvKiogV29ybGQgcG9zaXRpb24gb2YgdGhlIHN0YWZmIGNyeXN0YWwgKGZvciBzcGVsbCBlZmZlY3RzKS4gKi9cbiAgY3J5c3RhbFBvcygpOiBhbnkgeyB0aGlzLmhvbGRlci5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHRoaXMucmlnLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgdGhpcy5zdGFmZlBpdm90LmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgdGhpcy5jcnlzdGFsLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgcmV0dXJuIHRoaXMuY3J5c3RhbC5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuY2xvbmUoKTsgfVxuXG4gIGh1cnQoKSB7IHRoaXMuaHVydFQgPSAwLjg7IH1cbiAgY2FzdCgpIHsgdGhpcy5jYXN0VCA9IDEuMTsgfVxuICAvKiogVGhlIGxhc3QgaGVhcnQgaXMgZ29uZTogaGUgc2lua3MgdG8gaGlzIGtuZWVzLCB0aGUgZXllcyBkaW0uICovXG4gIGRlZmVhdCgpIHsgdGhpcy5kb3duVGFyZ2V0ID0gMTsgfVxuICByZXZpdmUoKSB7IHRoaXMuZG93blRhcmdldCA9IDA7IHRoaXMuaHVydFQgPSAwOyB0aGlzLmNhc3RUID0gMDsgfVxuXG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0O1xuICAgIHRoaXMuZG93biArPSAodGhpcy5kb3duVGFyZ2V0IC0gdGhpcy5kb3duKSAqIE1hdGgubWluKDEsIGR0ICogMyk7XG4gICAgY29uc3QgYm9iID0gTWF0aC5zaW4odGhpcy50ICogMikgKiAwLjAzNSAqICgxIC0gdGhpcy5kb3duKTtcbiAgICBsZXQgcmVjb2lsID0gMCwgZmxhc2ggPSAwO1xuICAgIGlmICh0aGlzLmh1cnRUID4gMCkgeyB0aGlzLmh1cnRUID0gTWF0aC5tYXgoMCwgdGhpcy5odXJ0VCAtIGR0KTsgY29uc3QgdSA9IHRoaXMuaHVydFQgLyAwLjg7IHJlY29pbCA9IE1hdGguc2luKHUgKiBNYXRoLlBJKSAqIDAuNDI7IGZsYXNoID0gdTsgfVxuICAgIGxldCByYWlzZSA9IDA7XG4gICAgaWYgKHRoaXMuY2FzdFQgPiAwKSB7IHRoaXMuY2FzdFQgPSBNYXRoLm1heCgwLCB0aGlzLmNhc3RUIC0gZHQpOyBjb25zdCB1ID0gdGhpcy5jYXN0VCAvIDEuMTsgcmFpc2UgPSBNYXRoLnNpbihNYXRoLm1pbigxLCAoMSAtIHUpICogMS42KSAqIE1hdGguUEkgKiAwLjUpICogKHUgPiAwLjI1ID8gMSA6IHUgLyAwLjI1KTsgfVxuICAgIHRoaXMucmlnLnBvc2l0aW9uLnkgPSBib2IgLSAwLjI4ICogdGhpcy5kb3duOyB0aGlzLnJpZy5yb3RhdGlvbi54ID0gLXJlY29pbCArIDAuOSAqIHRoaXMuZG93bjsgdGhpcy5yaWcucm90YXRpb24ueiA9IE1hdGguc2luKHRoaXMudCAqIDEuMykgKiAwLjAzICsgTWF0aC5zaW4odGhpcy5odXJ0VCAqIDYwKSAqIDAuMDMgKiAodGhpcy5odXJ0VCA+IDAgPyAxIDogMCk7XG4gICAgdGhpcy5zdGFmZlBpdm90LnJvdGF0aW9uLnogPSAtMC4xNSAqIHJhaXNlIC0gMC4wNTsgdGhpcy5zdGFmZlBpdm90LnJvdGF0aW9uLnggPSAtMC40NSAqIHJhaXNlOyB0aGlzLnN0YWZmUGl2b3QucG9zaXRpb24ueSA9IDAuNiArIDAuMzUgKiByYWlzZTtcbiAgICB0aGlzLmNyeXN0YWwucm90YXRpb24ueSArPSBkdCAqICgyICsgNiAqIHJhaXNlKTsgY29uc3QgcHVsc2UgPSAxICsgMC4xMiAqIE1hdGguc2luKHRoaXMudCAqIDQpICsgMS4xICogcmFpc2U7IHRoaXMuY3J5c3RhbC5zY2FsaW5nLnNldChwdWxzZSwgMS41ICogcHVsc2UsIHB1bHNlKTtcbiAgICBjb25zdCBkaW0gPSAxIC0gMC44NSAqIHRoaXMuZG93bjtcbiAgICB0aGlzLmNyeXN0YWxNYXQuZW1pc3NpdmVDb2xvci5zZXQoKDAuNzUgKyAwLjI1ICogcmFpc2UpICogZGltLCAoMC4zNSArIDAuNCAqIHJhaXNlKSAqIGRpbSwgMSAqIGRpbSk7XG4gICAgdGhpcy5leWVNYXQuZW1pc3NpdmVDb2xvci5zZXQoMC45ICogZGltICsgZmxhc2ggKiAwLjEsICgwLjQgKyAwLjI1ICogcmFpc2UpICogZGltICogKDEgLSBmbGFzaCAqIDAuNiksIDEgKiBkaW0gKiAoMSAtIGZsYXNoICogMC43KSk7XG4gICAgdGhpcy5yb2JlTWF0LmVtaXNzaXZlQ29sb3Iuc2V0KDAuMDUgKyBmbGFzaCAqIDAuNiwgMC4wMiwgMC4xICogKDEgLSBmbGFzaCkpO1xuICAgIHRoaXMuZ2xvdy5zY2FsaW5nLnNldEFsbCgwLjYgKyAwLjkgKiBkaW0gKyByYWlzZSAqIDAuOCk7XG4gICAgdGhpcy5wcy5lbWl0UmF0ZSA9ICgzMCArIDkwICogcmFpc2UpICogZGltO1xuICB9XG5cbiAgZGlzcG9zZSgpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cbiIsICIvLyBBbGwgc291bmQgaXMgc3ludGhlc2l6ZWQgaW4gdGhlIGJyb3dzZXIgd2l0aCB0aGUgV2ViIEF1ZGlvIEFQSTogbm8gYXVkaW8gZmlsZXMgdG8gZG93bmxvYWQsIGxpY2Vuc2Ugb3Igc2hpcC5cbi8vIFR3byBpbmRlcGVuZGVudCBzd2l0Y2hlcyAobXVzaWMsIHNvdW5kIGVmZmVjdHMpLCBzYXZlZCBpbiB0aGUgcGxheWVyJ3Mgc2F2ZS4gUGhvbmVzIG9ubHkgYWxsb3cgc291bmQgYWZ0ZXIgYSB0YXAsIHNvIG5vdGhpbmcgc3RhcnRzXG4vLyB1bnRpbCB0aGUgZmlyc3QgdG91Y2gvY2xpY2sgKGB1bmxvY2tgKS5cbmltcG9ydCB7IGxvYWRTYXZlLCB1cGRhdGVTZXR0aW5ncyB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5cbmV4cG9ydCB0eXBlIFNmeCA9ICd0YXAnIHwgJ3N1bW1vbicgfCAnbWVyZ2UnIHwgJ2hpdCcgfCAnaGl0QXJyb3cnIHwgJ3NtYXNoJyB8ICdhcnJvdycgfCAnZGVhdGgnIHwgJ2Nhc3QnIHwgJ3RhdW50JyB8ICdzaG9ja3dhdmUnIHwgJ3Jlc3VycmVjdCcgfCAnaGVhcnRMb3N0JyB8ICd2aWN0b3J5JyB8ICdkZWZlYXQnIHwgJ3N0YXJ0J1xuICB8ICdwYWNrQ2hhcmdlJyB8ICdwYWNrVGllclVwJyB8ICdwYWNrVGVhcicgfCAncGFja0ZhbicgfCAncGFja0ZsaXAnIHwgJ3BhY2tSYXJlJyB8ICdwYWNrRXBpYycgfCAncGFja0xlZ2VuZCcgfCAncGFja0NvbGxlY3QnO1xuZXhwb3J0IHR5cGUgTW9kZSA9ICdidWlsZCcgfCAnYmF0dGxlJztcblxuLy8gTXVzaWM6IEEgbWlub3IsIDgwIGJwbSwgZm91ciBiYXJzIGxvb3BpbmcgKEFtLCBGLCBDLCBFKS4gUm9vdCBub3RlIGZpcnN0LCB0aGVuIGNob3JkIHRvbmVzIChIeikuXG5jb25zdCBDSE9SRFM6IG51bWJlcltdW10gPSBbXG4gIFsxMTAsIDE2NC44MSwgMjIwLCAyNjEuNjMsIDMyOS42M10sXG4gIFs4Ny4zMSwgMTMwLjgxLCAxNzQuNjEsIDIyMCwgMjYxLjYzXSxcbiAgWzEzMC44MSwgMTk2LCAyNjEuNjMsIDMyOS42MywgMzkyXSxcbiAgWzgyLjQxLCAxMjMuNDcsIDE2NC44MSwgMjA3LjY1LCAyNDYuOTRdLFxuXTtcbmNvbnN0IEJFQVQgPSA2MCAvIDgwO1xuXG5jbGFzcyBBdWRpb0VuZ2luZSB7XG4gIHByaXZhdGUgY3R4OiBBdWRpb0NvbnRleHQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBtYXN0ZXIhOiBHYWluTm9kZTsgcHJpdmF0ZSBtdXNpY0J1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIHNmeEJ1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIG5vaXNlQnVmITogQXVkaW9CdWZmZXI7XG4gIG11c2ljID0gdHJ1ZTsgc2Z4ID0gdHJ1ZTsgbW9kZTogTW9kZSA9ICdidWlsZCc7XG4gIHByaXZhdGUgdGltZXIgPSAwOyBwcml2YXRlIG5leHRUID0gMDsgcHJpdmF0ZSBiZWF0ID0gMDsgcHJpdmF0ZSBzdGFtcHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcigpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB9XG5cbiAgcHJpdmF0ZSBzaWxlbnQ6IEhUTUxBdWRpb0VsZW1lbnQgfCBudWxsID0gbnVsbDsgcHJpdmF0ZSBwcmltZWQgPSBmYWxzZTtcbiAgLyoqIGlQaG9uZXMgbXV0ZSBXZWIgQXVkaW8gd2hlbiB0aGUgcmluZ2VyIHN3aXRjaCBpcyBvbiwgdW5sZXNzIHRoZSBwYWdlIGlzIHBsYXlpbmcgXCJyZWFsXCIgbWVkaWEuIEEgc2lsZW50IGxvb3BpbmcgPGF1ZGlvPiBlbGVtZW50IChwbHVzIHRoZVxuICAgKiAgYXVkaW9TZXNzaW9uIGhpbnQgb24gbmV3ZXIgaU9TKSBtb3ZlcyB0aGUgcGFnZSB0byB0aGUgcGxheWJhY2sgY2hhbm5lbCwgc28gdGhlIGdhbWUgaXMgaGVhcmQgZXZlbiB3aXRoIHRoZSBzd2l0Y2ggb24gc2lsZW50LiAqL1xuICBwcml2YXRlIHBsYXliYWNrQ2hhbm5lbCgpIHtcbiAgICB0cnkgeyBjb25zdCBhID0gKG5hdmlnYXRvciBhcyBhbnkpLmF1ZGlvU2Vzc2lvbjsgaWYgKGEpIGEudHlwZSA9ICdwbGF5YmFjayc7IH0gY2F0Y2ggeyAvKiBub3Qgc3VwcG9ydGVkICovIH1cbiAgICBpZiAodGhpcy5zaWxlbnQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbiA9IDQ0MSwgYnVmID0gbmV3IEFycmF5QnVmZmVyKDQ0ICsgbiAqIDIpLCB2ID0gbmV3IERhdGFWaWV3KGJ1ZiksIHN0ciA9IChvOiBudW1iZXIsIHQ6IHN0cmluZykgPT4geyBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspIHYuc2V0VWludDgobyArIGksIHQuY2hhckNvZGVBdChpKSk7IH07XG4gICAgICBzdHIoMCwgJ1JJRkYnKTsgdi5zZXRVaW50MzIoNCwgMzYgKyBuICogMiwgdHJ1ZSk7IHN0cig4LCAnV0FWRScpOyBzdHIoMTIsICdmbXQgJyk7IHYuc2V0VWludDMyKDE2LCAxNiwgdHJ1ZSk7IHYuc2V0VWludDE2KDIwLCAxLCB0cnVlKTsgdi5zZXRVaW50MTYoMjIsIDEsIHRydWUpO1xuICAgICAgdi5zZXRVaW50MzIoMjQsIDQ0MTAwLCB0cnVlKTsgdi5zZXRVaW50MzIoMjgsIDg4MjAwLCB0cnVlKTsgdi5zZXRVaW50MTYoMzIsIDIsIHRydWUpOyB2LnNldFVpbnQxNigzNCwgMTYsIHRydWUpOyBzdHIoMzYsICdkYXRhJyk7IHYuc2V0VWludDMyKDQwLCBuICogMiwgdHJ1ZSk7XG4gICAgICBjb25zdCBlbCA9IG5ldyBBdWRpbyhVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtidWZdLCB7IHR5cGU6ICdhdWRpby93YXYnIH0pKSk7IGVsLmxvb3AgPSB0cnVlOyBlbC52b2x1bWUgPSAwLjAxOyBlbC5zZXRBdHRyaWJ1dGUoJ3BsYXlzaW5saW5lJywgJycpOyB0aGlzLnNpbGVudCA9IGVsO1xuICAgICAgZWwucGxheSgpLmNhdGNoKCgpID0+IHsgdGhpcy5zaWxlbnQgPSBudWxsOyB9KTtcbiAgICB9IGNhdGNoIHsgLyogZmluZTogc291bmQgc3RpbGwgd29ya3MsIGp1c3QgZm9sbG93cyB0aGUgc2lsZW50IHN3aXRjaCAqLyB9XG4gIH1cbiAgLyoqIFdoYXQgdGhlIFNldHRpbmdzIHBhZ2Ugc2hvd3Mgc28gYSBzaWxlbnQgcGhvbmUgY2FuIGJlIGRpYWdub3NlZC4gKi9cbiAgc3RhdHVzKCk6IHsgc3RhdGU6IHN0cmluZzsgdW5sb2NrZWQ6IGJvb2xlYW4gfSB7IHJldHVybiB7IHN0YXRlOiB0aGlzLmN0eCA/IHRoaXMuY3R4LnN0YXRlIDogJ25vdCBzdGFydGVkJywgdW5sb2NrZWQ6ICEhdGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgPT09ICdydW5uaW5nJyB9OyB9XG4gIC8qKiBUaGUgU2V0dGluZ3MgcGFnZSdzIFRlc3Qgc291bmQgYnV0dG9uOiB1bmxvY2sgYW5kIG1ha2UgYSBjbGVhcmx5IGF1ZGlibGUgc291bmQuICovXG4gIHRlc3QoKSB7IHRoaXMudW5sb2NrKCk7IGNvbnN0IHQgPSAoKSA9PiB7IHRoaXMucGxheSgndmljdG9yeScpOyB9OyBpZiAodGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkudGhlbih0KS5jYXRjaCgoKSA9PiB7fSk7IGVsc2UgdCgpOyB9XG5cbiAgLyoqIENhbGwgZnJvbSBhIHVzZXIgZ2VzdHVyZSAodGFwL2NsaWNrKS4gU2FmZSB0byBjYWxsIHJlcGVhdGVkbHkuICovXG4gIHVubG9jaygpIHtcbiAgICB0aGlzLnBsYXliYWNrQ2hhbm5lbCgpO1xuICAgIGlmICghdGhpcy5jdHgpIHtcbiAgICAgIGNvbnN0IEMgPSAod2luZG93IGFzIGFueSkuQXVkaW9Db250ZXh0IHx8ICh3aW5kb3cgYXMgYW55KS53ZWJraXRBdWRpb0NvbnRleHQ7IGlmICghQykgcmV0dXJuO1xuICAgICAgY29uc3QgY3R4OiBBdWRpb0NvbnRleHQgPSB0aGlzLmN0eCA9IG5ldyBDKCk7XG4gICAgICBjb25zdCBjb21wID0gY3R4LmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvcigpOyBjb21wLmNvbm5lY3QoY3R4LmRlc3RpbmF0aW9uKTtcbiAgICAgIHRoaXMubWFzdGVyID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tYXN0ZXIuZ2Fpbi52YWx1ZSA9IDAuOTsgdGhpcy5tYXN0ZXIuY29ubmVjdChjb21wKTtcbiAgICAgIHRoaXMubXVzaWNCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm11c2ljQnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpOyB0aGlzLnNmeEJ1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMuc2Z4QnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpO1xuICAgICAgY3R4Lm9uc3RhdGVjaGFuZ2UgPSAoKSA9PiB7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tYXVkaW8tc3RhdGUnKSk7IH07XG4gICAgICBjb25zdCBsZW4gPSBjdHguc2FtcGxlUmF0ZTsgdGhpcy5ub2lzZUJ1ZiA9IGN0eC5jcmVhdGVCdWZmZXIoMSwgbGVuLCBjdHguc2FtcGxlUmF0ZSk7IGNvbnN0IGQgPSB0aGlzLm5vaXNlQnVmLmdldENoYW5uZWxEYXRhKDApOyBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKSBkW2ldID0gTWF0aC5yYW5kb20oKSAqIDIgLSAxO1xuICAgIH1cbiAgICBpZiAodGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkuY2F0Y2goKCkgPT4ge30pOyAgICAgICAgICAgICAvLyAnc3VzcGVuZGVkJyBvciAoaU9TKSAnaW50ZXJydXB0ZWQnXG4gICAgaWYgKCF0aGlzLnByaW1lZCkgeyB0aGlzLnByaW1lZCA9IHRydWU7IHRyeSB7IGNvbnN0IGIgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXIoMSwgMSwgMjIwNTApLCBzID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyU291cmNlKCk7IHMuYnVmZmVyID0gYjsgcy5jb25uZWN0KHRoaXMuY3R4LmRlc3RpbmF0aW9uKTsgcy5zdGFydCgwKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9IH1cbiAgICB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTtcbiAgfVxuXG4gIHNldE11c2ljKG9uOiBib29sZWFuKSB7IHRoaXMubXVzaWMgPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBtdXNpYzogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyB9XG4gIHNldFNmeChvbjogYm9vbGVhbikgeyB0aGlzLnNmeCA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IHNmeDogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyBpZiAob24pIHRoaXMucGxheSgndGFwJyk7IH1cbiAgLyoqIFJlLXJlYWQgdGhlIHNhdmVkIHN3aXRjaGVzICh0aGUgc2hlbGwncyBTZXR0aW5ncyBwYWdlIGNoYW5nZXMgdGhlbSB0b28pLiAqL1xuICByZWxvYWQoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IH1cbiAgc2V0TW9kZShtOiBNb2RlKSB7IHRoaXMubW9kZSA9IG07IH1cblxuICBwcml2YXRlIGFwcGx5R2FpbnMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuOyBjb25zdCB0ID0gdGhpcy5jdHguY3VycmVudFRpbWU7XG4gICAgdGhpcy5tdXNpY0J1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLm11c2ljID8gMC41IDogMCwgdCwgMC4xNSk7IHRoaXMuc2Z4QnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMuc2Z4ID8gMC44IDogMCwgdCwgMC4wNSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbXVzaWNcbiAgcHJpdmF0ZSBzeW5jTXVzaWMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLm11c2ljICYmICF0aGlzLnRpbWVyKSB7IHRoaXMubmV4dFQgPSB0aGlzLmN0eC5jdXJyZW50VGltZSArIDAuMTU7IHRoaXMudGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy50aWNrKCksIDIwMCk7IH1cbiAgICBpZiAoIXRoaXMubXVzaWMgJiYgdGhpcy50aW1lcikgeyBjbGVhckludGVydmFsKHRoaXMudGltZXIpOyB0aGlzLnRpbWVyID0gMDsgfVxuICB9XG4gIHByaXZhdGUgdGljaygpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7IGlmIChjdHguc3RhdGUgIT09ICdydW5uaW5nJykgeyB0aGlzLm5leHRUID0gY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgcmV0dXJuOyB9XG4gICAgd2hpbGUgKHRoaXMubmV4dFQgPCBjdHguY3VycmVudFRpbWUgKyAwLjYpIHsgdGhpcy5wbGF5QmVhdCh0aGlzLmJlYXQsIHRoaXMubmV4dFQpOyB0aGlzLm5leHRUICs9IEJFQVQ7IHRoaXMuYmVhdCA9ICh0aGlzLmJlYXQgKyAxKSAlIDE2OyB9XG4gIH1cbiAgcHJpdmF0ZSBwbGF5QmVhdChiZWF0OiBudW1iZXIsIHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGNob3JkID0gQ0hPUkRTW01hdGguZmxvb3IoYmVhdCAvIDQpXSwgaW5CYXIgPSBiZWF0ICUgNCwgYmF0dGxlID0gdGhpcy5tb2RlID09PSAnYmF0dGxlJztcbiAgICBpZiAoaW5CYXIgPT09IDApIGZvciAoY29uc3QgZiBvZiBjaG9yZCkgdGhpcy52b2ljZShmLCAndHJpYW5nbGUnLCB0LCBCRUFUICogNCArIDAuOCwgMC4wNDUsIDAuOSwgOTAwKTsgICAvLyBzbG93IHBhZFxuICAgIGlmIChpbkJhciA9PT0gMCB8fCBpbkJhciA9PT0gMikgdGhpcy52b2ljZShjaG9yZFswXSwgJ3NpbmUnLCB0LCBCRUFUICogMS42LCAwLjE2LCAwLjAyLCA0MDApOyAgICAgICAgICAvLyBiYXNzXG4gICAgaWYgKGJhdHRsZSkge1xuICAgICAgdGhpcy5raWNrKHQsIDAuMzIpOyBpZiAoaW5CYXIgPT09IDIpIHRoaXMua2ljayh0ICsgQkVBVCAqIDAuNSwgMC4xOCk7XG4gICAgICB0aGlzLm5vaXNlKHQgKyBCRUFUICogMC41LCAwLjA1LCAwLjA1LCAnaGlnaHBhc3MnLCA3MDAwKTsgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDEuNSAlIEJFQVQsIDAuMDUsIDAuMDMsICdoaWdocGFzcycsIDcwMDApO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAyOyBpKyspIHRoaXMudm9pY2UoY2hvcmRbMSArICgoYmVhdCAqIDIgKyBpKSAlIDQpXSAqIDIsICd0cmlhbmdsZScsIHQgKyBpICogQkVBVCAvIDIsIDAuMjIsIDAuMDUsIDAuMDA1LCAyNTAwKTsgICAvLyBwbHVjayBhcnBlZ2dpb1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHZvaWNlKGZyZXE6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgYXR0YWNrOiBudW1iZXIsIGxwOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS52YWx1ZSA9IGZyZXE7IGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBNYXRoLm1heCgwLjAwNSwgYXR0YWNrKSk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGtpY2sodDogbnVtYmVyLCBnYWluOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZSgxMzAsIHQpOyBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDQyLCB0ICsgMC4xNCk7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgMC4yKTtcbiAgICBvLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyAwLjI1KTtcbiAgfVxuICBwcml2YXRlIG5vaXNlKHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBidXM6IEdhaW5Ob2RlID0gdGhpcy5tdXNpY0J1cywgc3dlZXBUbz86IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbiA9IGN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgbi5idWZmZXIgPSB0aGlzLm5vaXNlQnVmOyBmLnR5cGUgPSB0eXBlOyBmLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHN3ZWVwVG8pIGYuZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc3dlZXBUbywgdCArIGR1cik7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG4uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QoYnVzKTsgbi5zdGFydCh0LCBNYXRoLnJhbmRvbSgpICogMC41KTsgbi5zdG9wKHQgKyBkdXIgKyAwLjAyKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzb3VuZCBlZmZlY3RzXG4gIHByaXZhdGUgdG9uZShmcmVxOiBudW1iZXIsIGR1cjogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZ2FpbjogbnVtYmVyLCBkZWxheSA9IDAsIHNsaWRlVG8/OiBudW1iZXIsIGF0dGFjayA9IDAuMDA1LCBscCA9IDgwMDApIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIHQgPSBjdHguY3VycmVudFRpbWUgKyBkZWxheSwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc2xpZGVUbykgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzbGlkZVRvLCB0ICsgZHVyKTtcbiAgICBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIGF0dGFjayk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLnNmeEJ1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBoaXNzKGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgZGVsYXkgPSAwLCBzd2VlcFRvPzogbnVtYmVyKSB7IHRoaXMubm9pc2UodGhpcy5jdHghLmN1cnJlbnRUaW1lICsgZGVsYXksIGR1ciwgZ2FpbiwgdHlwZSwgZnJlcSwgdGhpcy5zZnhCdXMsIHN3ZWVwVG8pOyB9XG4gIHByaXZhdGUgdGhyb3R0bGUoa2V5OiBzdHJpbmcsIG1zOiBudW1iZXIpIHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpOyBpZiAobiAtICh0aGlzLnN0YW1wc1trZXldIHx8IDApIDwgbXMpIHJldHVybiBmYWxzZTsgdGhpcy5zdGFtcHNba2V5XSA9IG47IHJldHVybiB0cnVlOyB9XG5cbiAgcGxheShuYW1lOiBTZngpIHtcbiAgICBpZiAoIXRoaXMuY3R4IHx8ICF0aGlzLnNmeCB8fCB0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSByZXR1cm47XG4gICAgc3dpdGNoIChuYW1lKSB7XG4gICAgICBjYXNlICd0YXAnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ3RhcCcsIDQwKSkgcmV0dXJuOyB0aGlzLnRvbmUoNzYwLCAwLjA2LCAnc2luZScsIDAuMjIsIDAsIDExMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3N1bW1vbic6IHRoaXMuaGlzcygwLjQsIDAuMTQsICdiYW5kcGFzcycsIDUwMCwgMCwgMjUwMCk7IHRoaXMudG9uZSgyMjAsIDAuNCwgJ3Nhd3Rvb3RoJywgMC4xLCAwLCA2NjAsIDAuMDUsIDE4MDApOyB0aGlzLnRvbmUoMTMyMCwgMC4yLCAnc2luZScsIDAuMSwgMC4xOCk7IGJyZWFrO1xuICAgICAgY2FzZSAnbWVyZ2UnOiBbNTIzLCA2NTksIDc4NCwgMTA0Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuMzUsICd0cmlhbmdsZScsIDAuMiwgaSAqIDAuMDcpKTsgdGhpcy5oaXNzKDAuNSwgMC4wOCwgJ2hpZ2hwYXNzJywgNTAwMCwgMC4xKTsgdGhpcy50b25lKDExMCwgMC4zLCAnc2luZScsIDAuMzUsIDAsIDUwKTsgdGhpcy50b25lKDE1NjgsIDAuNSwgJ3NpbmUnLCAwLjA4LCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ2hpdCc6IGlmICghdGhpcy50aHJvdHRsZSgnaGl0JywgNDUpKSByZXR1cm47IHRoaXMuaGlzcygwLjA3LCAwLjI0LCAnbG93cGFzcycsIDE4MDApOyB0aGlzLnRvbmUoMTcwLCAwLjA5LCAnc2luZScsIDAuMjIsIDAsIDgwKTsgYnJlYWs7XG4gICAgICBjYXNlICdoaXRBcnJvdyc6IGlmICghdGhpcy50aHJvdHRsZSgnaGl0QScsIDQ1KSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4wNSwgMC4xNCwgJ2JhbmRwYXNzJywgMzAwMCk7IHRoaXMudG9uZSg3MDAsIDAuMDYsICd0cmlhbmdsZScsIDAuMDYsIDAsIDQwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc21hc2gnOiB0aGlzLnRvbmUoOTUsIDAuMzgsICdzaW5lJywgMC41LCAwLCAzNCk7IHRoaXMuaGlzcygwLjMyLCAwLjM1LCAnbG93cGFzcycsIDEwMDAsIDAsIDIwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnYXJyb3cnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2Fycm93JywgNjApKSByZXR1cm47IHRoaXMuaGlzcygwLjE0LCAwLjEsICdiYW5kcGFzcycsIDE4MDAsIDAsIDQyMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2RlYXRoJzogaWYgKCF0aGlzLnRocm90dGxlKCdkZWF0aCcsIDcwKSkgcmV0dXJuOyB0aGlzLnRvbmUoMzAwLCAwLjQsICdzYXd0b290aCcsIDAuMTQsIDAsIDcwLCAwLjAxLCA5MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2Nhc3QnOiB0aGlzLnRvbmUoMzAwLCAwLjQ1LCAnc2luZScsIDAuMTgsIDAsIDkwMCwgMC4wNSk7IHRoaXMudG9uZSg0NTAsIDAuNDUsICdzaW5lJywgMC4xLCAwLjA1LCAxMzUwLCAwLjA1KTsgdGhpcy50b25lKDE4MDAsIDAuMjUsICdzaW5lJywgMC4wNSwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICd0YXVudCc6IHRoaXMudG9uZSgxOTYsIDAuNSwgJ3NxdWFyZScsIDAuMDgsIDAsIDE4MCwgMC4wMywgNzAwKTsgdGhpcy50b25lKDE0NywgMC41LCAnc2F3dG9vdGgnLCAwLjA4LCAwLjAyLCAxNDAsIDAuMDMsIDYwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc2hvY2t3YXZlJzogdGhpcy50b25lKDIyMCwgMS4xLCAnc2luZScsIDAuNSwgMCwgMjgsIDAuMDIpOyB0aGlzLmhpc3MoMS4wLCAwLjM1LCAnbG93cGFzcycsIDMwMDAsIDAsIDE1MCk7IHRoaXMudG9uZSg4ODAsIDAuOCwgJ3NpbmUnLCAwLjA4LCAwLCAyMjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3Jlc3VycmVjdCc6IFsyMjAsIDI3NywgMzMwLCA0NDAsIDU1NF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDEuMSwgJ3RyaWFuZ2xlJywgMC4xLCBpICogMC4xMiwgZiAqIDEuMTIsIDAuMykpOyB0aGlzLmhpc3MoMC45LCAwLjA2LCAnaGlnaHBhc3MnLCA0NTAwLCAwLjIpOyBicmVhaztcbiAgICAgIGNhc2UgJ2hlYXJ0TG9zdCc6IHRoaXMudG9uZSgxMTAsIDAuNywgJ3Nhd3Rvb3RoJywgMC4yOCwgMCwgNTAsIDAuMDEsIDQ1MCk7IHRoaXMuaGlzcygwLjE4LCAwLjIsICdsb3dwYXNzJywgOTAwKTsgdGhpcy50b25lKDIzMywgMC41LCAnc3F1YXJlJywgMC4wNSwgMC4wMiwgMjIwLCAwLjAxLCA1MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3ZpY3RvcnknOiBbMzkyLCA0OTQsIDU4NywgNzg0XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC41LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4xMSkpOyB0aGlzLnRvbmUoMTk2LCAwLjksICdzaW5lJywgMC4yKTsgYnJlYWs7XG4gICAgICBjYXNlICdkZWZlYXQnOiBbMzMwLCAyOTQsIDI0NywgMTk2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC43LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4yOCwgZiAqIDAuOTcpKTsgdGhpcy50b25lKDgyLCAxLjYsICdzaW5lJywgMC4zLCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tDaGFyZ2UnOiB0aGlzLnRvbmUoOTAsIDEuMDUsICdzaW5lJywgMC4yNSwgMCwgMjYwLCAwLjIpOyB0aGlzLmhpc3MoMC45NSwgMC4xMiwgJ2xvd3Bhc3MnLCAzMDAsIDAsIDIyMDApOyB0aGlzLnRvbmUoMTgwLCAxLjAsICd0cmlhbmdsZScsIDAuMDYsIDAuMSwgNTIwLCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUaWVyVXAnOiBbNDQwLCA1NTQsIDY1OSwgODgwXS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA2KSk7IHRoaXMudG9uZSgxNzYwLCAwLjYsICdzaW5lJywgMC4wOSwgMC4yKTsgdGhpcy5oaXNzKDAuNCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUZWFyJzogdGhpcy5oaXNzKDAuMzUsIDAuMywgJ2JhbmRwYXNzJywgMTUwMCwgMCwgNjAwMCk7IHRoaXMudG9uZSgxMjAsIDAuNDUsICdzaW5lJywgMC40LCAwLjA1LCA0MCk7IFsxMDQ2LCAxMzE4LCAxNTY4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC42LCAndHJpYW5nbGUnLCAwLjEsIDAuMTIgKyBpICogMC4wNSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tGYW4nOiB0aGlzLmhpc3MoMC41LCAwLjEsICdoaWdocGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNjYwLCAwLjQ1LCAnc2luZScsIDAuMSwgMCwgMTMyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0ZsaXAnOiB0aGlzLmhpc3MoMC4wOCwgMC4xNSwgJ2JhbmRwYXNzJywgMjUwMCk7IHRoaXMudG9uZSg1MDAsIDAuMTIsICdzaW5lJywgMC4xNCwgMCwgODAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrUmFyZSc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzc4NCwgOTg4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40NSwgJ3RyaWFuZ2xlJywgMC4xNCwgMC4wNSArIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0VwaWMnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC43LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wNykpOyB0aGlzLnRvbmUoMTEwLCAwLjUsICdzaW5lJywgMC4zLCAwLCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0xlZ2VuZCc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA4KSk7IHRoaXMudG9uZSg4MiwgMC45LCAnc2luZScsIDAuMzUsIDAsIDUwKTsgdGhpcy5oaXNzKDAuOCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMjA5MywgMC43LCAnc2luZScsIDAuMDcsIDAuNCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NvbGxlY3QnOiBbNjU5LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wOSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3N0YXJ0JzogdGhpcy50b25lKDE0NywgMC45LCAnc2F3dG9vdGgnLCAwLjEzLCAwLCAxNTAsIDAuMTUsIDY1MCk7IHRoaXMudG9uZSgyMjAsIDAuOSwgJ3Nhd3Rvb3RoJywgMC4wOSwgMC4wNSwgMjI0LCAwLjE1LCA2NTApOyB0aGlzLmhpc3MoMC42LCAwLjA2LCAnbG93cGFzcycsIDYwMCk7IGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYXVkaW8gPSBuZXcgQXVkaW9FbmdpbmUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2F1ZGlvID0gYXVkaW87XG5cbi8vIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdG91Y2g6IHRoZSBmaXJzdCB0YXAgYW55d2hlcmUgdW5sb2NrcyBpdC4gRXZlcnkgYnV0dG9uIGFsc28gZ2V0cyBhIHNtYWxsIGNsaWNrLlxuLy8gaU9TIG9ubHkgYWNjZXB0cyBhbiB1bmxvY2sgZnJvbSBhIEZJTklTSEVEIHRhcCAodG91Y2hlbmQgLyBjbGljayksIG5vdCBmcm9tIHRoZSBzdGFydCBvZiBvbmUsIHNvIGxpc3RlbiB0byBhbGwgb2YgdGhlbS5cbmNvbnN0IHVubG9ja09uY2UgPSAoKSA9PiBhdWRpby51bmxvY2soKTtcbmZvciAoY29uc3QgZXYgb2YgWydwb2ludGVyZG93bicsICdwb2ludGVydXAnLCAndG91Y2hlbmQnLCAnY2xpY2snLCAna2V5ZG93biddKSBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKGV2LCB1bmxvY2tPbmNlLCB7IGNhcHR1cmU6IHRydWUgfSk7XG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGNvbnN0IGVsID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsOyBpZiAoZWwgJiYgZWwuY2xvc2VzdCAmJiBlbC5jbG9zZXN0KCdidXR0b24sIGEuYnRuLCAucmFpbCBhJykpIGF1ZGlvLnBsYXkoJ3RhcCcpOyB9LCB0cnVlKTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Zpc2liaWxpdHljaGFuZ2UnLCAoKSA9PiB7IGNvbnN0IGMgPSAoYXVkaW8gYXMgYW55KS5jdHggYXMgQXVkaW9Db250ZXh0IHwgbnVsbDsgaWYgKCFjKSByZXR1cm47IGlmIChkb2N1bWVudC5oaWRkZW4pIGMuc3VzcGVuZCgpOyBlbHNlIGlmIChhdWRpby5tdXNpYyB8fCBhdWRpby5zZngpIGMucmVzdW1lKCk7IH0pO1xud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzLWNoYW5nZWQnLCAoKSA9PiBhdWRpby5yZWxvYWQoKSk7XG4iLCAiLy8gU2F2aW5nIGEgcnVuIGluIHByb2dyZXNzIHNvIGl0IHN1cnZpdmVzIGEgcGFnZSByZWxvYWQgKFNhZmFyaSBvbiBhIHBob25lIGNhbiBkcm9wIHRoZSBwYWdlIGF0IGFueSB0aW1lKS5cbi8vIE9ubHkgY2FsbSBtb21lbnRzIGFyZSBzYXZlZDogdGhlIGJ1aWxkIHBoYXNlIGFuZCB0aGUgdmljdG9yeSBkcmFmdC4gQSBiYXR0bGUgaW4gcHJvZ3Jlc3MgaXMgbm90IHNhdmVkOyByZWxvYWRpbmcgZHVyaW5nIG9uZSBwdXRzIHlvdSBiYWNrXG4vLyBhdCB0aGUgYnVpbGQgc2NyZWVuIHlvdSBwcmVzc2VkIEJhdHRsZSBmcm9tIChub3RoaW5nIGxvc3QsIG5vdGhpbmcgZ2FpbmVkKS4gRXZlcnl0aGluZyByZWFkIGJhY2sgaXMgdmFsaWRhdGVkOyBhbnl0aGluZyBvZGQgaXMgaWdub3JlZC5cblxuaW1wb3J0IHsgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlLCBVbml0IH0gZnJvbSAnLi9ydWxlcy50cyc7XG5pbXBvcnQgeyBicm93c2VyU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5cbmNvbnN0IEtFWSA9ICduZWNyby1ydW4nO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VyaWFsaXplZFN0YXRlIHtcbiAgcnVsZXM6IFJ1bGVzOyBybmc6IHsgc2VlZDogbnVtYmVyOyBwb3M6IG51bWJlciB9O1xuICB3YXZlOiBudW1iZXI7IGhlYXJ0czogbnVtYmVyOyBjYXA6IG51bWJlcjsgaGFuZDogU291bElkW107IHVuaXRzOiBVbml0W107IG5leHRJZDogbnVtYmVyOyBkaXNjYXJkVXNlZDogYm9vbGVhbjtcbiAgc3RhdHVzOiAnYnVpbGRpbmcnOyBsb2c6IHN0cmluZ1tdOyBzdGF0czogU3RhdGVbJ3N0YXRzJ107XG59XG5leHBvcnQgaW50ZXJmYWNlIFJ1blNuYXBzaG90IHsgdjogbnVtYmVyOyBzZWVkOiBudW1iZXI7IGF0dGVtcHQ6IG51bWJlcjsgZGlmZmljdWx0eTogc3RyaW5nOyBwaGFzZTogJ2J1aWxkJyB8ICdkcmFmdCc7IGRyYWZ0OiBTb3VsSWRbXSB8IG51bGw7IHN0YXRlOiBTZXJpYWxpemVkU3RhdGUgfVxuXG5leHBvcnQgZnVuY3Rpb24gc2VyaWFsaXplU3RhdGUoczogU3RhdGUpOiBTZXJpYWxpemVkU3RhdGUge1xuICByZXR1cm4ge1xuICAgIHJ1bGVzOiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHMucnVsZXMpKSwgcm5nOiB7IHNlZWQ6IHMucm5nLnNlZWQsIHBvczogcy5ybmcuc3RhdGUoKSB9LFxuICAgIHdhdmU6IHMud2F2ZSwgaGVhcnRzOiBzLmhlYXJ0cywgY2FwOiBzLmNhcCwgaGFuZDogcy5oYW5kLnNsaWNlKCksIHVuaXRzOiBzLnVuaXRzLm1hcCgodSkgPT4gKHsgLi4udSB9KSksIG5leHRJZDogcy5uZXh0SWQsIGRpc2NhcmRVc2VkOiBzLmRpc2NhcmRVc2VkLFxuICAgIHN0YXR1czogJ2J1aWxkaW5nJywgbG9nOiBzLmxvZy5zbGljZSgtNDApLCBzdGF0czogeyAuLi5zLnN0YXRzIH0sXG4gIH07XG59XG5cbmNvbnN0IGlzU291bCA9ICh4OiBhbnkpOiB4IGlzIFNvdWxJZCA9PiBTT1VMUy5pbmNsdWRlcyh4KTtcbmNvbnN0IGludCA9ICh4OiBhbnksIGxvOiBudW1iZXIsIGhpOiBudW1iZXIpID0+IE51bWJlci5pc0ludGVnZXIoeCkgJiYgeCA+PSBsbyAmJiB4IDw9IGhpO1xuXG4vKiogUmVidWlsZCBhIFN0YXRlIGZyb20gc2F2ZWQgZGF0YSwgb3IgbnVsbCBpZiBhbnl0aGluZyBhYm91dCBpdCBpcyBub3QgYmVsaWV2YWJsZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXNlcmlhbGl6ZVN0YXRlKHg6IGFueSk6IFN0YXRlIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCF4IHx8IHR5cGVvZiB4ICE9PSAnb2JqZWN0JykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgciA9IHgucnVsZXM7XG4gICAgaWYgKCFyIHx8ICFBcnJheS5pc0FycmF5KHIuY3VydmUpIHx8ICFyLmN1cnZlLmxlbmd0aCB8fCAhci5jdXJ2ZS5ldmVyeSgobjogYW55KSA9PiBOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoci5tZXJnZSAhPT0gJ2RlcGxveWVkT25seScgJiYgci5tZXJnZSAhPT0gJ2hhbmRJbnRvT25lU3RhcicpIHJldHVybiBudWxsO1xuICAgIGlmIChyLnBvb2wgIT09IHVuZGVmaW5lZCAmJiAhKEFycmF5LmlzQXJyYXkoci5wb29sKSAmJiByLnBvb2wubGVuZ3RoICYmIHIucG9vbC5ldmVyeShpc1NvdWwpKSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgc3RhZ2VXYXZlcyA9IHIuc3RhZ2VXYXZlcyA/PyByLmN1cnZlLmxlbmd0aDtcbiAgICBpZiAoIWludCh4LndhdmUsIDEsIE1hdGgubWluKHN0YWdlV2F2ZXMsIHIuY3VydmUubGVuZ3RoKSkgfHwgIWludCh4LmhlYXJ0cywgMSwgSEVBUlRTKSB8fCAhTnVtYmVyLmlzRmluaXRlKHguY2FwKSB8fCB4LmNhcCA8PSAwKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoeC5oYW5kKSB8fCB4LmhhbmQubGVuZ3RoID4gNDAgfHwgIXguaGFuZC5ldmVyeShpc1NvdWwpKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoeC51bml0cykgfHwgeC51bml0cy5sZW5ndGggPiBHUklEX0NFTExTKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIWludCh4Lm5leHRJZCwgMSwgMWU2KSB8fCB0eXBlb2YgeC5kaXNjYXJkVXNlZCAhPT0gJ2Jvb2xlYW4nKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjZWxscyA9IG5ldyBTZXQ8bnVtYmVyPigpLCBpZHMgPSBuZXcgU2V0PG51bWJlcj4oKSwgdW5pdHM6IFVuaXRbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgdSBvZiB4LnVuaXRzKSB7XG4gICAgICBpZiAoIXUgfHwgIWlzU291bCh1LnNvdWwpIHx8ICFpbnQodS5zdGFyLCAxLCBNQVhfU1RBUikgfHwgIWludCh1LmNlbGwsIDAsIEdSSURfQ0VMTFMgLSAxKSB8fCAhaW50KHUuaWQsIDEsIHgubmV4dElkKSB8fCBjZWxscy5oYXModS5jZWxsKSB8fCBpZHMuaGFzKHUuaWQpKSByZXR1cm4gbnVsbDtcbiAgICAgIGNlbGxzLmFkZCh1LmNlbGwpOyBpZHMuYWRkKHUuaWQpOyB1bml0cy5wdXNoKHsgaWQ6IHUuaWQsIHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwsIGZyZXNoOiAhIXUuZnJlc2ggfSk7XG4gICAgfVxuICAgIGNvbnN0IHN0ID0geC5zdGF0cztcbiAgICBpZiAoIXN0IHx8ICFbJ2RyYXduJywgJ2Rpc2NhcmRlZCcsICdkaXNtaXNzZWQnLCAnbWVyZ2VzJywgJ2ZhaWx1cmVzJ10uZXZlcnkoKGspID0+IE51bWJlci5pc0Zpbml0ZShzdFtrXSkpKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIXgucm5nIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5ybmcuc2VlZCkgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnJuZy5wb3MpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4ge1xuICAgICAgcnVsZXM6IHIgYXMgUnVsZXMsIHJuZzogbWFrZVJuZyh4LnJuZy5zZWVkLCB4LnJuZy5wb3MpLCB3YXZlOiB4LndhdmUsIGhlYXJ0czogeC5oZWFydHMsIGNhcDogeC5jYXAsIGhhbmQ6IHguaGFuZC5zbGljZSgpLCB1bml0cywgbmV4dElkOiB4Lm5leHRJZCxcbiAgICAgIGRpc2NhcmRVc2VkOiB4LmRpc2NhcmRVc2VkLCBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogQXJyYXkuaXNBcnJheSh4LmxvZykgPyB4LmxvZy5maWx0ZXIoKGw6IGFueSkgPT4gdHlwZW9mIGwgPT09ICdzdHJpbmcnKS5zbGljZSgtNDApIDogW10sXG4gICAgICBzdGF0czogeyBkcmF3bjogc3QuZHJhd24sIGRpc2NhcmRlZDogc3QuZGlzY2FyZGVkLCBkaXNtaXNzZWQ6IHN0LmRpc21pc3NlZCwgbWVyZ2VzOiBzdC5tZXJnZXMsIGZhaWx1cmVzOiBzdC5mYWlsdXJlcyB9LFxuICAgIH07XG4gIH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2F2ZVJ1bihzbmFwOiBSdW5TbmFwc2hvdCwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogdm9pZCB7XG4gIHRyeSB7IGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksIEpTT04uc3RyaW5naWZ5KHNuYXApKTsgfSBjYXRjaCB7IC8qIHN0b3JhZ2UgZnVsbCBvciBibG9ja2VkOiB0aGUgcnVuIGp1c3Qgd2lsbCBub3Qgc3Vydml2ZSBhIHJlbG9hZCAqLyB9XG59XG5leHBvcnQgZnVuY3Rpb24gY2xlYXJSdW4oc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogdm9pZCB7XG4gIHRyeSB7IGlmIChzdG9yZSAmJiAoc3RvcmUgYXMgYW55KS5yZW1vdmVJdGVtKSAoc3RvcmUgYXMgYW55KS5yZW1vdmVJdGVtKEtFWSk7IGVsc2UgaWYgKHN0b3JlKSBzdG9yZS5zZXRJdGVtKEtFWSwgJycpOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cbn1cbmV4cG9ydCBmdW5jdGlvbiBsb2FkUnVuKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHsgc25hcDogUnVuU25hcHNob3Q7IHN0YXRlOiBTdGF0ZSB9IHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgaWYgKCF0KSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCB4ID0gSlNPTi5wYXJzZSh0KTtcbiAgICBpZiAoIXggfHwgeC52ICE9PSBWRVJTSU9OIHx8ICh4LnBoYXNlICE9PSAnYnVpbGQnICYmIHgucGhhc2UgIT09ICdkcmFmdCcpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5zZWVkKSB8fCAhTnVtYmVyLmlzRmluaXRlKHguYXR0ZW1wdCkgfHwgdHlwZW9mIHguZGlmZmljdWx0eSAhPT0gJ3N0cmluZycpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHN0YXRlID0gZGVzZXJpYWxpemVTdGF0ZSh4LnN0YXRlKTsgaWYgKCFzdGF0ZSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZHJhZnQgPSB4LnBoYXNlID09PSAnZHJhZnQnICYmIEFycmF5LmlzQXJyYXkoeC5kcmFmdCkgJiYgeC5kcmFmdC5sZW5ndGggPT09IDMgJiYgeC5kcmFmdC5ldmVyeShpc1NvdWwpID8geC5kcmFmdCA6IG51bGw7XG4gICAgcmV0dXJuIHsgc25hcDogeyB2OiBWRVJTSU9OLCBzZWVkOiB4LnNlZWQsIGF0dGVtcHQ6IHguYXR0ZW1wdCwgZGlmZmljdWx0eTogeC5kaWZmaWN1bHR5LCBwaGFzZTogZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJywgZHJhZnQsIHN0YXRlOiB4LnN0YXRlIH0sIHN0YXRlIH07XG4gIH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxufVxuZXhwb3J0IGNvbnN0IFJVTl9WRVJTSU9OID0gVkVSU0lPTjtcbiIsICIvLyBQZXJtYW5lbnQgcHJvZ3Jlc3Npb246IHN0YWdlIGNsZWFycyAtPiBTb3VsIFBhY2tzIC0+IGNvcGllcyAtPiBTb3VsIGxldmVscy4gUHVyZSBmdW5jdGlvbnMgdGhhdCBjaGFuZ2UgYSBTYXZlICh0aGUgY2FsbGVyIHBlcnNpc3RzIGl0KS5cbi8vIFBsYWNlaG9sZGVyIG51bWJlcnMsIGxpa2UgcGFja3MudHMuIEluLXJ1biBzdGFyIG1lcmdpbmcgaXMgYSBzZXBhcmF0ZSwgdGVtcG9yYXJ5IHN5c3RlbSBhbmQgbmV2ZXIgdG91Y2hlcyBhbnkgb2YgdGhpcy5cblxuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBMRVZFTF9DT1NUX01VTFQsIFBBQ0tfVElFUlMsIFJBUklUWV9PRiwgb3BlblBhY2sgfSBmcm9tICcuL3BhY2tzLnRzJztcbmltcG9ydCB0eXBlIHsgUGFja0l0ZW0sIFBhY2tSZXN1bHQgfSBmcm9tICcuL3BhY2tzLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHsgbG9hZFNhdmUsIHdyaXRlU2F2ZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IERpZmZpY3VsdHksIFNhdmUsIFN0b3JlIH0gZnJvbSAnLi9zYXZlLnRzJztcblxuZXhwb3J0IGNvbnN0IE1BWF9QQUNLUyA9IDk5O1xuXG4vKiogV2hlcmUgcGFja3MgY29tZSBmcm9tLiBQTEFDRUhPTERFUi4gRmlyc3QgY2xlYXIgb2YgYSBzdGFnZSBvbiBlYWNoIGRpZmZpY3VsdHkgZ2l2ZXMgb25lIGltcHJvdmVkIHBhY2s7IGxhdGVyIGNsZWFycyBmaWxsIGEgbWV0ZXIuICovXG5leHBvcnQgY29uc3QgUkVXQVJEUyA9IHtcbiAgZmlyc3RDbGVhclRpZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAyLCBoYXJkOiAyLCBuaWdodG1hcmU6IDMgfSBhcyBSZWNvcmQ8RGlmZmljdWx0eSwgbnVtYmVyPixcbiAgcmVwbGF5VGllcjogMSxcbiAgcmVwbGF5Q2xlYXJzUGVyUGFjazogMixcbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBsZXZlbHNcbmV4cG9ydCBjb25zdCBtYXhMZXZlbCA9ICgpOiBudW1iZXIgPT4gQkFMQU5DRS5sZXZlbC5jb3BpZXNUb0xldmVsLmxlbmd0aCArIDE7XG5leHBvcnQgY29uc3QgaXNNYXhMZXZlbCA9IChsZXZlbDogbnVtYmVyKTogYm9vbGVhbiA9PiBsZXZlbCA+PSBtYXhMZXZlbCgpO1xuLyoqIENvcGllcyBuZWVkZWQgdG8gdGFrZSBgc291bGAgZnJvbSBgbGV2ZWxgIHRvIHRoZSBuZXh0IG9uZSAoMCB3aGVuIGFscmVhZHkgbWF4KS4gUmFyZXIgU291bHMgbmVlZCBmZXdlci4gKi9cbmV4cG9ydCBjb25zdCBjb3BpZXNOZWVkZWQgPSAobGV2ZWw6IG51bWJlciwgc291bDogU291bElkKTogbnVtYmVyID0+IChpc01heExldmVsKGxldmVsKSA/IDAgOiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKEJBTEFOQ0UubGV2ZWwuY29waWVzVG9MZXZlbFtsZXZlbCAtIDFdICogTEVWRUxfQ09TVF9NVUxUW1JBUklUWV9PRltzb3VsXV0pKSk7XG5leHBvcnQgZnVuY3Rpb24gY2FuTGV2ZWxVcChzYXZlOiBTYXZlLCBzb3VsOiBTb3VsSWQpOiBib29sZWFuIHsgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IHJldHVybiAhaXNNYXhMZXZlbChwLmxldmVsKSAmJiBwLmNvcGllcyA+PSBjb3BpZXNOZWVkZWQocC5sZXZlbCwgc291bCk7IH1cbi8qKiBTcGVuZCB0aGUgY29waWVzLCBnYWluIGEgbGV2ZWwuIFJldHVybnMgZmFsc2UgaWYgdGhlIFNvdWwgaXMgbm90IHJlYWR5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxldmVsVXAoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogYm9vbGVhbiB7XG4gIGlmICghY2FuTGV2ZWxVcChzYXZlLCBzb3VsKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBwID0gc2F2ZS5zb3Vsc1tzb3VsXTsgcC5jb3BpZXMgLT0gY29waWVzTmVlZGVkKHAubGV2ZWwsIHNvdWwpOyBwLmxldmVsKys7IHJldHVybiB0cnVlO1xufVxuLyoqIE11bHRpcGxpZXIgYXBwbGllZCB0byBhIFNvdWwncyBoZWFsdGgvZGFtYWdlIGZyb20gaXRzIHBlcm1hbmVudCBsZXZlbCAobGV2ZWwgMSA9IDEuMCkuICovXG5leHBvcnQgY29uc3QgbGV2ZWxNdWx0ID0gKGxldmVsOiBudW1iZXIsIHN0YXQ6ICdocCcgfCAnZG1nJyk6IG51bWJlciA9PiAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQkFMQU5DRS5sZXZlbFtzdGF0XTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBhY2tzXG5leHBvcnQgZnVuY3Rpb24gZ3JhbnRQYWNrKHNhdmU6IFNhdmUsIHRpZXI6IG51bWJlciwgc291cmNlOiBzdHJpbmcpOiBQYWNrSXRlbSB8IG51bGwge1xuICBpZiAoc2F2ZS5wYWNrcy5sZW5ndGggPj0gTUFYX1BBQ0tTKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGFjazogUGFja0l0ZW0gPSB7IGlkOiBzYXZlLm5leHRQYWNrSWQrKywgdGllcjogTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcih0aWVyKSkpLCBzb3VyY2UgfTtcbiAgc2F2ZS5wYWNrcy5wdXNoKHBhY2spOyByZXR1cm4gcGFjaztcbn1cblxuLyoqIE9wZW4gYW4gb3duZWQgcGFjazogaXQgaXMgcmVtb3ZlZCBhbmQgaXRzIGNvcGllcyBhcmUgYWRkZWQgdG8gdGhlIFNvdWxzIGltbWVkaWF0ZWx5IChzbyBub3RoaW5nIGlzIGxvc3QgaWYgdGhlIHBhZ2UgY2xvc2VzIG1pZC1hbmltYXRpb24pLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5Pd25lZFBhY2soc2F2ZTogU2F2ZSwgcGFja0lkOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB8IG51bGwge1xuICBjb25zdCBpID0gc2F2ZS5wYWNrcy5maW5kSW5kZXgoKHApID0+IHAuaWQgPT09IHBhY2tJZCk7IGlmIChpIDwgMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhY2sgPSBzYXZlLnBhY2tzW2ldOyBzYXZlLnBhY2tzLnNwbGljZShpLCAxKTtcbiAgY29uc3QgcmVzdWx0ID0gb3BlblBhY2socGFjay50aWVyLCBybmcpO1xuICBmb3IgKGNvbnN0IHIgb2YgcmVzdWx0LnJldmVhbHMpIHNhdmUuc291bHNbci5zb3VsXS5jb3BpZXMgKz0gci5jb3BpZXM7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xlYXJSZXdhcmQgeyBmaXJzdDogYm9vbGVhbjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyByZXBsYXlNZXRlcjogbnVtYmVyOyByZXBsYXlOZWVkZWQ6IG51bWJlciB9XG4vKiogQSBzdGFnZSB3YXMgY2xlYXJlZCBvbiBgZGlmZmljdWx0eWAuIFRoZSBmaXJzdCBjbGVhciBvbiB0aGF0IGRpZmZpY3VsdHkgZ3JhbnRzIGEgYmV0dGVyIHBhY2s7IGxhdGVyIGNsZWFycyBmaWxsIHRoZSByZXBsYXkgbWV0ZXIuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQ2xlYXIoc2F2ZTogU2F2ZSwgc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5KTogQ2xlYXJSZXdhcmQge1xuICBjb25zdCBrZXkgPSBzdGFnZUlkICsgJzonICsgZGlmZmljdWx0eSwgYmVmb3JlID0gc2F2ZS5jbGVhcnNba2V5XSA/PyAwO1xuICBzYXZlLmNsZWFyc1trZXldID0gYmVmb3JlICsgMTtcbiAgaWYgKGJlZm9yZSA9PT0gMCkgcmV0dXJuIHsgZmlyc3Q6IHRydWUsIHBhY2s6IGdyYW50UGFjayhzYXZlLCBSRVdBUkRTLmZpcnN0Q2xlYXJUaWVyW2RpZmZpY3VsdHldLCAnRmlyc3QgY2xlYXIgXHUwMEI3ICcgKyBkaWZmaWN1bHR5KSwgcmVwbGF5TWV0ZXI6IHNhdmUucmVwbGF5TWV0ZXIsIHJlcGxheU5lZWRlZDogUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrIH07XG4gIHNhdmUucmVwbGF5TWV0ZXIrKztcbiAgbGV0IHBhY2s6IFBhY2tJdGVtIHwgbnVsbCA9IG51bGw7XG4gIGlmIChzYXZlLnJlcGxheU1ldGVyID49IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjaykgeyBzYXZlLnJlcGxheU1ldGVyIC09IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjazsgcGFjayA9IGdyYW50UGFjayhzYXZlLCBSRVdBUkRTLnJlcGxheVRpZXIsICdSZXBsYXkgcmV3YXJkJyk7IH1cbiAgcmV0dXJuIHsgZmlyc3Q6IGZhbHNlLCBwYWNrLCByZXBsYXlNZXRlcjogc2F2ZS5yZXBsYXlNZXRlciwgcmVwbGF5TmVlZGVkOiBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2sgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBlcnNpc3RlZCB3cmFwcGVycyAodXNlZCBieSB0aGUgZ2FtZSBidW5kbGUpXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQ2xlYXJBbmRTYXZlKHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBDbGVhclJld2FyZCB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IHIgPSByZWNvcmRDbGVhcihzLCBzdGFnZUlkLCBkaWZmaWN1bHR5KTsgd3JpdGVTYXZlKHMsIHN0b3JlKTsgcmV0dXJuIHI7XG59XG4iLCAiLy8gRXZlcnl0aGluZyB5b3UgU0VFIGZvciBhIHVuaXQ6IHJlYWwgVHJpcG8gbW9kZWxzIChTa2VsZXRvbiBXYXJyaW9yLCBTa2VsZXRvbiBBcmNoZXIpLCBzaW1wbGUgc3RhbmQtaW5zIGZvciB0aGUgZm91clxuLy8gY2hhcmFjdGVycyB0aGF0IGFyZSBub3QgZ2VuZXJhdGVkIHlldCwgYW5kIHRoZSBcInN0YXIgbG9va1wiIGxheWVyZWQgb24gdG9wIG9mIGJvdGggKHNpemUsIHRpbnQsIGF1cmEsIGhhbG8sIGJhZGdlKS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5cbmV4cG9ydCB0eXBlIFZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhdGgnIHwgJ3NwYXduJyB8ICdjaGVlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbiArIHlhdyBoZXJlXG4gIHRlYW06IDAgfCAxOyBzdGFyOiBudW1iZXI7IHN0YXRlOiBWU3RhdGU7IHRvcDogbnVtYmVyO1xuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkPzogbnVtYmVyKTogdm9pZDtcbiAgc2V0U3RhcihzdGFyOiBudW1iZXIpOiB2b2lkO1xuICBzZXRUZWFtKHRlYW06IDAgfCAxKTogdm9pZDtcbiAgc2V0SHAoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7ICAvLyBudWxsIGhpZGVzIHRoZSBoZWFsdGggYmFyXG4gIHNldE1hbmEoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7IC8vIG51bGwgaGlkZXMgdGhlIG1hbmEgYmFyICh1bml0cyB3aXRob3V0IGEgc2tpbGwpXG4gIHB1bHNlKCk6IHZvaWQ7ICAgICAgICAgICAgICAgICAgICAgLy8gYnJpZWYgaGl0IHJlYWN0aW9uXG4gIHVwZGF0ZShkdDogbnVtYmVyKTogdm9pZDtcbiAgZGlzcG9zZSgpOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YXIgbG9va3Ncbi8vIDEgc3RhciA9IHRoZSBwbGFpbiBtb2RlbC4gMiBzdGFycyA9IGEgbGl0dGxlIGJpZ2dlciwgY29vbCBzaWx2ZXItYmx1ZSB0aW50LCBicmlnaHRlciBhdXJhLiAzIHN0YXJzID0gYmlnZ2VzdCwgd2FybSBnb2xkIHRpbnQsXG4vLyBzdHJvbmcgZ29sZC12aW9sZXQgYXVyYSBhbmQgYSBmbG9hdGluZyBnb2xkIGhhbG8uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBmcmVlOiBubyBleHRyYSBUcmlwbyBnZW5lcmF0aW9ucy5cbmNvbnN0IFRJTlQ6IG51bWJlcltdW10gPSBbWzEsIDEsIDFdLCBbMC44NiwgMC45NSwgMS4xOF0sIFsxLjI1LCAxLjEsIDAuN11dO1xuY29uc3QgQVVSQSA9IFtcbiAgeyByYXRlOiAxNCwgbWluOiAwLjA2LCBtYXg6IDAuMTYsIGMxOiBbMC43OCwgMC4zNSwgMSwgMC43XSwgYzI6IFswLjQ1LCAwLjE1LCAwLjksIDAuNV0gfSxcbiAgeyByYXRlOiAyNiwgbWluOiAwLjA4LCBtYXg6IDAuMjAsIGMxOiBbMC44NSwgMC42NSwgMSwgMC44XSwgYzI6IFswLjU1LCAwLjQsIDEsIDAuNl0gfSxcbiAgeyByYXRlOiA0NCwgbWluOiAwLjEwLCBtYXg6IDAuMjYsIGMxOiBbMSwgMC44NSwgMC40LCAwLjg1XSwgYzI6IFswLjgsIDAuMywgMSwgMC43XSB9LFxuXTtcblxuZXhwb3J0IGludGVyZmFjZSBBc3NldHMge1xuICBzY2VuZTogYW55OyBzb2Z0OiBhbnk7IHN0YXJUZXg6IGFueVtdOyB0cmlwbzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBUcmlwb0NmZz4+O1xuICByaW5nTWF0OiBhbnlbXTsgaGFsb01hdDogYW55OyBiYXJCZzogYW55OyBiYXJGaWxsOiBhbnlbXTsgbWFuYUZpbGw6IGFueTtcbn1cbmludGVyZmFjZSBUcmlwb0NmZyB7IGNvbnRhaW5lcjogYW55OyBlbmVteVRleDogYW55OyBjbGlwczogUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPjsgbWF0Q2FjaGU6IFJlY29yZDxzdHJpbmcsIGFueT47IGJhc2VNYXQ/OiBhbnk7IHRvcDogbnVtYmVyOyBzY2FsZTogbnVtYmVyIH1cblxuZnVuY3Rpb24gZHluKHNjZW5lOiBhbnksIHc6IG51bWJlciwgaDogbnVtYmVyLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkLCBhbHBoYSA9IHRydWUpIHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdkdCcsIHsgd2lkdGg6IHcsIGhlaWdodDogaCB9LCBzY2VuZSwgdHJ1ZSk7IGRyYXcodC5nZXRDb250ZXh0KCkpOyB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gYWxwaGE7IHJldHVybiB0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFzc2V0cyhzY2VuZTogYW55KTogUHJvbWlzZTxBc3NldHM+IHtcbiAgY29uc3Qgc29mdCA9IGR5bihzY2VuZSwgNjQsIDY0LCAoYykgPT4geyBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCgzMiwgMzIsIDAsIDMyLCAzMiwgMzIpOyBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgyNTUsMjU1LDI1NSwxKScpOyBnLmFkZENvbG9yU3RvcCgwLjQsICdyZ2JhKDI1NSwyNTUsMjU1LC41NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTsgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IH0pO1xuICBjb25zdCBzdGFyVGV4ID0gWzEsIDIsIDNdLm1hcCgobikgPT4gZHluKHNjZW5lLCAxOTIsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCA0MHB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlU3R5bGUgPSAnIzFhMTAyMCc7IGMuZmlsbFN0eWxlID0gbiA9PT0gMyA/ICcjZmZkMjRhJyA6IG4gPT09IDIgPyAnI2Q3ZTZmZicgOiAnI2YwZDlhMCc7IGNvbnN0IHMgPSAnXHUyNjA1Jy5yZXBlYXQobik7IGMuc3Ryb2tlVGV4dChzLCA5NiwgMzgpOyBjLmZpbGxUZXh0KHMsIDk2LCAzOCk7IH0pKTtcbiAgY29uc3QgZW1pc3NpdmUgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYSA9IDEpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2VtJywgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gIGNvbnN0IEE6IEFzc2V0cyA9IHtcbiAgICBzY2VuZSwgc29mdCwgc3RhclRleCwgdHJpcG86IHt9LCByaW5nTWF0OiBbZW1pc3NpdmUoMC41NSwgMC4yLCAwLjk1LCAwLjkpLCBlbWlzc2l2ZSgwLjk1LCAwLjI1LCAwLjIsIDAuOSldLCBoYWxvTWF0OiBlbWlzc2l2ZSgxLCAwLjgyLCAwLjMsIDAuOTUpLFxuICAgIGJhckJnOiBlbWlzc2l2ZSgwLjA1LCAwLjA1LCAwLjA4LCAwLjcpLCBiYXJGaWxsOiBbZW1pc3NpdmUoMC41NSwgMC4zNSwgMSksIGVtaXNzaXZlKDEsIDAuNCwgMC4zKV0sIG1hbmFGaWxsOiBlbWlzc2l2ZSgwLjI1LCAwLjc1LCAxKSxcbiAgfTtcbiAgY29uc3QgZGVmczogW1NvdWxJZCwgc3RyaW5nLCBzdHJpbmcsIFJlY29yZDxWU3RhdGUsIHN0cmluZz4sIG51bWJlciwgbnVtYmVyXVtdID0gW1xuICAgIFsnd2FycmlvcicsICdza2VsZXRvbl93YXJyaW9yLmdsYicsICdza2VsZXRvbl93YXJyaW9yX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQmxvY2snIH0sIDEuMDUsIDEuMF0sXG4gICAgWydhcmNoZXInLCAnU2tlbGV0b25BcmNoZXIuZ2xiJywgJ1NrZWxldG9uQXJjaGVyX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdTaG9vdCcsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdGbGV4JyB9LCAxLjA1LCAxLjBdLFxuICBdO1xuICBhd2FpdCBQcm9taXNlLmFsbChkZWZzLm1hcChhc3luYyAoW3NvdWwsIGdsYiwgZW5lbXksIGNsaXBzLCB0b3AsIHNjYWxlXSkgPT4ge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCBnbGIsIHNjZW5lKTtcbiAgICBBLnRyaXBvW3NvdWxdID0geyBjb250YWluZXIsIGVuZW15VGV4OiBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvJyArIGVuZW15LCBzY2VuZSwgZmFsc2UsIGZhbHNlKSwgY2xpcHMsIG1hdENhY2hlOiB7fSwgdG9wLCBzY2FsZSB9O1xuICB9KSk7XG4gIHJldHVybiBBO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNoYXJlZCBkZWNvcmF0aW9uXG5jbGFzcyBEZWNvIHtcbiAgcHJpdmF0ZSBwczogYW55ID0gbnVsbDsgcHJpdmF0ZSBoYWxvOiBhbnkgPSBudWxsOyBwcml2YXRlIGJhZGdlOiBhbnk7IHByaXZhdGUgc3RhcnM6IGFueTsgcHJpdmF0ZSBmaWxsOiBhbnk7IHByaXZhdGUgYmFyOiBhbnk7IHByaXZhdGUgbWJnOiBhbnk7IHByaXZhdGUgbWZpbGw6IGFueTsgcHJpdmF0ZSByaW5nOiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHBhcmVudDogYW55LCBwcml2YXRlIHRvcDogbnVtYmVyLCBwcml2YXRlIHJhZGl1czogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmU7XG4gICAgdGhpcy5yaW5nID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdyaW5nJywgeyByYWRpdXM6IE1hdGgubWF4KDAuMywgcmFkaXVzICogMS4xNSksIHRlc3NlbGxhdGlvbjogMjYgfSwgcyk7IHRoaXMucmluZy5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHRoaXMucmluZy5wb3NpdGlvbi55ID0gMC4wMjsgdGhpcy5yaW5nLnBhcmVudCA9IHBhcmVudDsgdGhpcy5yaW5nLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLmJhZGdlID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnYmFkZ2UnLCBzKTsgdGhpcy5iYWRnZS5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMuYmFkZ2UucG9zaXRpb24ueSA9IHRvcCArIDAuMzI7IHRoaXMuYmFkZ2UuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDtcbiAgICB0aGlzLnN0YXJzID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnc3RhcnMnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4xNSB9LCBzKTsgdGhpcy5zdGFycy5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLnN0YXJzLnBvc2l0aW9uLnkgPSAwLjExOyB0aGlzLnN0YXJzLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBzbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3NtJywgcyk7IHNtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBzbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBzbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHRoaXMuc3RhcnMubWF0ZXJpYWwgPSBzbTsgKHRoaXMuc3RhcnMgYXMgYW55KS5fc20gPSBzbTtcbiAgICBjb25zdCBiZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2JnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDg1IH0sIHMpOyBiZy5wYXJlbnQgPSB0aGlzLmJhZGdlOyBiZy5tYXRlcmlhbCA9IEEuYmFyQmc7IGJnLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5iYXIgPSBiZztcbiAgICB0aGlzLmZpbGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdmaWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjA1IH0sIHMpOyB0aGlzLmZpbGwucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5maWxsLnBvc2l0aW9uLnogPSAtMC4wMDI7IHRoaXMuZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdtYmcnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5tYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5tYmcucG9zaXRpb24ueSA9IC0wLjA3OyB0aGlzLm1iZy5tYXRlcmlhbCA9IEEuYmFyQmc7IHRoaXMubWJnLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLm1maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWZpbGwnLCB7IHdpZHRoOiAwLjU2LCBoZWlnaHQ6IDAuMDMgfSwgcyk7IHRoaXMubWZpbGwucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5tZmlsbC5wb3NpdGlvbi5zZXQoMCwgLTAuMDcsIC0wLjAwMik7IHRoaXMubWZpbGwubWF0ZXJpYWwgPSBBLm1hbmFGaWxsOyB0aGlzLm1maWxsLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLmJhci5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5maWxsLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1iZy5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBzZXQodGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLkEuc2NlbmUsIGNmZyA9IEFVUkFbc3RhciAtIDFdO1xuICAgICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtLmRpZmZ1c2VUZXh0dXJlID0gdGhpcy5BLnN0YXJUZXhbc3RhciAtIDFdO1xuICAgIHRoaXMucmluZy5tYXRlcmlhbCA9IHRoaXMuQS5yaW5nTWF0W3RlYW1dOyB0aGlzLmZpbGwubWF0ZXJpYWwgPSB0aGlzLkEuYmFyRmlsbFt0ZWFtXTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmFpc2VkIGJ5IHRoZSBOZWNyb21hbmNlcjogcHVycGxlIGF1cmEgdGhhdCBncm93cyB3aXRoIHN0YXJzXG4gICAgICBpZiAoIXRoaXMucHMpIHtcbiAgICAgICAgY29uc3QgcHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnYXVyYScsIDcwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGhpcy5BLnNvZnQ7IHBzLmVtaXR0ZXIgPSB0aGlzLnBhcmVudDsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgdGhpcy50b3AgKiAwLjUsIDAuMik7XG4gICAgICAgIHBzLm1pbkxpZmVUaW1lID0gMC41OyBwcy5tYXhMaWZlVGltZSA9IDEuMTsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMTUsIDAuOCwgLTAuMTUpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjE1LCAxLjUsIDAuMTUpO1xuICAgICAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjM1OyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7IHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgdGhpcy5wcyA9IHBzO1xuICAgICAgfVxuICAgICAgY29uc3QgcCA9IHRoaXMucHM7IHAuZW1pdFJhdGUgPSBjZmcucmF0ZTsgcC5taW5TaXplID0gY2ZnLm1pbjsgcC5tYXhTaXplID0gY2ZnLm1heDsgcC5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uY2ZnLmMxKTsgcC5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uY2ZnLmMyKTsgcC5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4yLCAwLCAwLjQsIDApO1xuICAgICAgaWYgKCFwLmlzU3RhcnRlZCgpKSBwLnN0YXJ0KCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLnBzICYmIHRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RvcCgpO1xuICAgIGlmIChzdGFyID49IDMpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBnb2xkIGhhbG8gYWJvdmUgdGhlIGhlYWRcbiAgICAgIGlmICghdGhpcy5oYWxvKSB7IHRoaXMuaGFsbyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2hhbG8nLCB7IGRpYW1ldGVyOiAwLjU1LCB0aGlja25lc3M6IDAuMDQsIHRlc3NlbGxhdGlvbjogMjQgfSwgcyk7IHRoaXMuaGFsby5wYXJlbnQgPSB0aGlzLnBhcmVudDsgdGhpcy5oYWxvLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuMDg7IHRoaXMuaGFsby5tYXRlcmlhbCA9IHRoaXMuQS5oYWxvTWF0OyB0aGlzLmhhbG8uaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgICB0aGlzLmhhbG8uc2V0RW5hYmxlZCh0cnVlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuaGFsbykgdGhpcy5oYWxvLnNldEVuYWJsZWQoZmFsc2UpO1xuICB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHtcbiAgICBjb25zdCBvbiA9IGYgIT09IG51bGw7IHRoaXMuYmFyLnNldEVuYWJsZWQob24pOyB0aGlzLmZpbGwuc2V0RW5hYmxlZChvbik7XG4gICAgaWYgKG9uKSB7IGNvbnN0IGsgPSBNYXRoLm1heCgwLjAwMSwgZiBhcyBudW1iZXIpOyB0aGlzLmZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5maWxsLnBvc2l0aW9uLnggPSAtKDAuNTYgKiAoMSAtIGspKSAvIDI7IH1cbiAgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHtcbiAgICBjb25zdCBvbiA9IGYgIT09IG51bGw7IHRoaXMubWJnLnNldEVuYWJsZWQob24pOyB0aGlzLm1maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5tZmlsbC5zY2FsaW5nLnggPSBrOyB0aGlzLm1maWxsLnBvc2l0aW9uLnggPSAtKDAuNTYgKiAoMSAtIGspKSAvIDI7IH1cbiAgfVxuICBzZXRBdXJhKG9uOiBib29sZWFuKSB7IGlmICh0aGlzLnBzKSB7IGlmIChvbiAmJiAhdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdGFydCgpOyBpZiAoIW9uICYmIHRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RvcCgpOyB9IH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHsgaWYgKHRoaXMuaGFsbyAmJiB0aGlzLmhhbG8uaXNFbmFibGVkKCkpIHRoaXMuaGFsby5yb3RhdGlvbi55ICs9IGR0ICogMS42OyB9XG4gIGRpc3Bvc2UoKSB7IGlmICh0aGlzLnBzKSB7IHRoaXMucHMuc3RvcCgpOyB0aGlzLnBzLmRpc3Bvc2UoKTsgfSBbdGhpcy5oYWxvLCB0aGlzLnJpbmcsIHRoaXMuc3RhcnMsIHRoaXMuYmFyLCB0aGlzLmZpbGwsIHRoaXMubWJnLCB0aGlzLm1maWxsXS5mb3JFYWNoKChtKSA9PiBtICYmIG0uZGlzcG9zZSgpKTsgdGhpcy5iYWRnZS5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSByZWFsIG1vZGVsc1xuY2xhc3MgVHJpcG9WaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgZW50OiBhbnk7IHByaXZhdGUgYm9keTogYW55OyBwcml2YXRlIGFuaW1zOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307IHByaXZhdGUgY3VyOiBhbnkgPSBudWxsOyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHB1bHNlVCA9IDA7IHByaXZhdGUgYmFzZTogbnVtYmVyO1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBjZmc6IFRyaXBvQ2ZnLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZSwgdWlkID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNyk7XG4gICAgdGhpcy5lbnQgPSBjZmcuY29udGFpbmVyLmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ18nICsgdWlkLCBmYWxzZSwgeyBkb05vdEluc3RhbnRpYXRlOiB0cnVlIH0pO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgndW5pdF8nICsgdWlkLCBzKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIHRoaXMuYm9keSA9IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZpbmQoKG06IGFueSkgPT4gbS5uYW1lLmluY2x1ZGVzKCdfQm9keScpKTtcbiAgICBpZiAoIWNmZy5iYXNlTWF0KSBjZmcuYmFzZU1hdCA9IHRoaXMuYm9keS5tYXRlcmlhbDtcbiAgICB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiB7IGcuc3RvcCgpOyBnLmVuYWJsZUJsZW5kaW5nID0gdHJ1ZTsgZy5ibGVuZGluZ1NwZWVkID0gMC4xMjsgdGhpcy5hbmltc1tnLm5hbWUuc3BsaXQoJ18nKVswXV0gPSBnOyB9KTtcbiAgICB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfSk7XG4gICAgdGhpcy50b3AgPSBjZmcudG9wOyB0aGlzLmJhc2UgPSBjZmcuc2NhbGU7IHRoaXMudGVhbSA9IHRlYW07XG4gICAgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCAwLjMpO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogMS4zLCBkaWFtZXRlcjogMC44IH0sIHMpOyB0aGlzLnBpY2sucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMucGljay5wb3NpdGlvbi55ID0gMC42OyB0aGlzLnBpY2sudmlzaWJpbGl0eSA9IDAuMDAxOyB0aGlzLnBpY2suaXNQaWNrYWJsZSA9IHRydWU7XG4gICAgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgfVxuICBwcml2YXRlIGFwcGx5TWF0KCkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMudGVhbSArICdfJyArIHRoaXMuc3RhciwgYyA9IHRoaXMuY2ZnO1xuICAgIGlmICghYy5tYXRDYWNoZVtrZXldKSB7IGNvbnN0IG0gPSBjLmJhc2VNYXQuY2xvbmUoJ21fJyArIGtleSk7IGlmICh0aGlzLnRlYW0gPT09IDEpIG0uYWxiZWRvVGV4dHVyZSA9IGMuZW5lbXlUZXg7IGNvbnN0IHQgPSBUSU5UW3RoaXMuc3RhciAtIDFdOyBtLmFsYmVkb0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHRbMF0sIHRbMV0sIHRbMl0pOyBjLm1hdENhY2hlW2tleV0gPSBtOyB9XG4gICAgdGhpcy5ib2R5Lm1hdGVyaWFsID0gYy5tYXRDYWNoZVtrZXldO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKEJBTEFOQ0Uuc3Rhci5zY2FsZVtzdCAtIDFdICogdGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmFuaW1zW3RoaXMuY2ZnLmNsaXBzW3N0YXRlXV07IGlmICghZykgcmV0dXJuOyBjb25zdCBsb29wID0gc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bic7XG4gICAgaWYgKGxvb3AgJiYgdGhpcy5zdGF0ZSA9PT0gc3RhdGUgJiYgdGhpcy5jdXIgPT09IGcpIHJldHVybjtcbiAgICBpZiAodGhpcy5jdXIpIHRoaXMuY3VyLnN0b3AoKTsgZy5zdG9wKCk7IGcuc3RhcnQobG9vcCwgc3BlZWQsIGcuZnJvbSwgZy50byk7XG4gICAgaWYgKGxvb3ApIGcuZ29Ub0ZyYW1lKGcuZnJvbSArIE1hdGgucmFuZG9tKCkgKiAoZy50byAtIGcuZnJvbSkpO1xuICAgIHRoaXMuY3VyID0gZzsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7XG4gIH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLmRlY28udXBkYXRlKGR0KTtcbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKEJBTEFOQ0Uuc3Rhci5zY2FsZVt0aGlzLnN0YXIgLSAxXSAqIHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5kZWNvLmRpc3Bvc2UoKTsgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4gZy5kaXNwb3NlKCkpOyB0aGlzLmVudC5za2VsZXRvbnMuZm9yRWFjaCgoczogYW55KSA9PiBzLmRpc3Bvc2UoKSk7IHRoaXMucGljay5kaXNwb3NlKCk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5kaXNwb3NlKGZhbHNlLCBmYWxzZSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YW5kLWluc1xuY29uc3QgUEg6IFJlY29yZDxzdHJpbmcsIHsgY29sOiBzdHJpbmc7IHc6IG51bWJlcjsgaDogbnVtYmVyOyBoZWFkOiBudW1iZXI7IHdlYXBvbjogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0+ID0ge1xuICBnb2JsaW46IHsgY29sOiAnIzYzYjEzZicsIHc6IDAuMzYsIGg6IDAuNDIsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ2RhZ2dlcicsIGxhYmVsOiAnR09CTElOJyB9LFxuICBrbmlnaHQ6IHsgY29sOiAnIzhlYTlkYycsIHc6IDAuNSwgaDogMC42LCBoZWFkOiAwLjM2LCB3ZWFwb246ICdzaGllbGQnLCBsYWJlbDogJ0tOSUdIVCcgfSxcbiAgb2dyZTogeyBjb2w6ICcjYThhNjRhJywgdzogMC44NSwgaDogMC44NSwgaGVhZDogMC40Miwgd2VhcG9uOiAnbWFjZScsIGxhYmVsOiAnT0dSRScgfSxcbiAgYmFyYmFyaWFuOiB7IGNvbDogJyNkNjhhNTUnLCB3OiAwLjUyLCBoOiAwLjYyLCBoZWFkOiAwLjM4LCB3ZWFwb246ICdheGUnLCBsYWJlbDogJ0JBUkJBUklBTicgfSxcbn07XG5jbGFzcyBQbGFjZWhvbGRlclZpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSByaWc6IGFueTsgcHJpdmF0ZSBsZWdzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHdwOiBhbnk7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgdCA9IE1hdGgucmFuZG9tKCkgKiA2OyBwcml2YXRlIHN0MCA9IDA7IHByaXZhdGUgZHVyID0gMTsgcHJpdmF0ZSBiYXNlID0gMTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIG1hdHM6IGFueVtdID0gW107IHByaXZhdGUgYm9keTogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBzb3VsOiBzdHJpbmcsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZSwgZCA9IFBIW3NvdWxdOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncGhfJyArIHNvdWwsIHMpOyB0aGlzLnJpZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3JpZycsIHMpOyB0aGlzLnJpZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICBjb25zdCBtYXQgPSAoaGV4OiBzdHJpbmcsIGVtID0gMCkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgncG0nLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5Gcm9tSGV4U3RyaW5nKGhleCkuc2NhbGUoMC43Mik7IG0uc3BlY3VsYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjEsIDAuMSwgMC4xKTsgaWYgKGVtKSBtLmVtaXNzaXZlQ29sb3IgPSBtLmRpZmZ1c2VDb2xvci5zY2FsZShlbSk7IHJldHVybiBtOyB9O1xuICAgIGNvbnN0IGxlZ0ggPSAwLjIyLCBib2R5WSA9IGxlZ0ggKyBkLmggLyAyO1xuICAgIGZvciAoY29uc3Qgc3ggb2YgWy0xLCAxXSkgeyBjb25zdCBsZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2xlZycsIHMpOyBsZy5wYXJlbnQgPSB0aGlzLnJpZzsgbGcucG9zaXRpb24uc2V0KHN4ICogZC53ICogMC4yMiwgbGVnSCwgMCk7IGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdsJywgeyBoZWlnaHQ6IGxlZ0gsIGRpYW1ldGVyOiBkLncgKiAwLjI4IH0sIHMpOyBtLnBhcmVudCA9IGxnOyBtLnBvc2l0aW9uLnkgPSAtbGVnSCAvIDI7IG0ubWF0ZXJpYWwgPSBtYXQoJyM0YTM4MjYnKTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMubGVncy5wdXNoKGxnKTsgfVxuICAgIHRoaXMuYm9keSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ2Fwc3VsZSgnYm9keScsIHsgcmFkaXVzOiBkLncgLyAyLCBoZWlnaHQ6IGQuaCArIGQudyAqIDAuNCB9LCBzKTsgdGhpcy5ib2R5LnBhcmVudCA9IHRoaXMucmlnOyB0aGlzLmJvZHkucG9zaXRpb24ueSA9IGJvZHlZOyB0aGlzLmJvZHkubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyB0aGlzLmJvZHkuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IGhlYWQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnaGVhZCcsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDEuNSwgc2VnbWVudHM6IDEyIH0sIHMpOyBoZWFkLnBhcmVudCA9IHRoaXMucmlnOyBoZWFkLnBvc2l0aW9uLnkgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMC41NTsgaGVhZC5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IGhlYWQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IGV5ZU0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdleWUnLCBzKTsgZXllTS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBleWVNLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyAodGhpcyBhcyBhbnkpLmV5ZU0gPSBleWVNO1xuICAgIGZvciAoY29uc3Qgc3ggb2YgWy0xLCAxXSkgeyBjb25zdCBlID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2UnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAwLjMgfSwgcyk7IGUucGFyZW50ID0gdGhpcy5yaWc7IGUucG9zaXRpb24uc2V0KHN4ICogZC5oZWFkICogMC4zLCBoZWFkLnBvc2l0aW9uLnkgKyAwLjAyLCBkLmhlYWQgKiAwLjY2KTsgZS5tYXRlcmlhbCA9IGV5ZU07IGUuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgLy8gd2VhcG9uIHBpdm90IGF0IHRoZSBzaG91bGRlciwgb24gdGhlIGNoYXJhY3RlcidzIHJpZ2h0ICgteCBpcyBmaW5lIGZvciBhIHN0YW5kLWluKVxuICAgIHRoaXMud3AgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd3cCcsIHMpOyB0aGlzLndwLnBhcmVudCA9IHRoaXMucmlnOyB0aGlzLndwLnBvc2l0aW9uLnNldChkLncgKiAwLjYsIGxlZ0ggKyBkLmggKiAwLjg1LCAwLjA1KTtcbiAgICBjb25zdCB3bSA9IG1hdCgnIzdhNWEzMCcpLCBpcm9uID0gbWF0KCcjOWFhMWFkJyk7XG4gICAgY29uc3QgbWsgPSAobTogYW55LCBraW5kOiBzdHJpbmcsIGRpbXM6IGFueSwgcG9zOiBudW1iZXJbXSwgbXQ6IGFueSkgPT4geyBjb25zdCB4ID0ga2luZCA9PT0gJ2JveCcgPyBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUJveCgndycsIGRpbXMsIHMpIDoga2luZCA9PT0gJ2N5bCcgPyBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCd3JywgZGltcywgcykgOiBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgndycsIGRpbXMsIHMpOyB4LnBhcmVudCA9IHRoaXMud3A7IHgucG9zaXRpb24uc2V0KHBvc1swXSwgcG9zWzFdLCBwb3NbMl0pOyB4Lm1hdGVyaWFsID0gbXQ7IHguaXNQaWNrYWJsZSA9IGZhbHNlOyByZXR1cm4geDsgfTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdkYWdnZXInKSBtaygwLCAnYm94JywgeyB3aWR0aDogMC4wNSwgaGVpZ2h0OiAwLjMsIGRlcHRoOiAwLjAzIH0sIFswLCAtMC4yLCAwLjEyXSwgaXJvbik7XG4gICAgaWYgKGQud2VhcG9uID09PSAnc2hpZWxkJykgeyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4wNiwgaGVpZ2h0OiAwLjUsIGRlcHRoOiAwLjA0IH0sIFswLCAtMC4zLCAwLjE0XSwgaXJvbik7IGNvbnN0IHNoID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignc2gnLCB7IGhlaWdodDogMC4wNSwgZGlhbWV0ZXI6IDAuNTUgfSwgcyk7IHNoLnBhcmVudCA9IHRoaXMucmlnOyBzaC5yb3RhdGlvbi56ID0gTWF0aC5QSSAvIDI7IHNoLnBvc2l0aW9uLnNldCgtZC53ICogMC43LCBsZWdIICsgZC5oICogMC42LCAwLjA1KTsgc2gubWF0ZXJpYWwgPSBtYXQoJyNkOGI2NGEnKTsgc2guaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnbWFjZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjksIGRpYW1ldGVyOiAwLjA4IH0sIFswLCAtMC4zNSwgMC4zXSwgd20pOyBtaygwLCAnc3BoJywgeyBkaWFtZXRlcjogMC40IH0sIFswLCAtMC44NSwgMC40XSwgaXJvbik7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdheGUnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC42LCBkaWFtZXRlcjogMC4wNSB9LCBbMCwgLTAuMiwgMC4xNV0sIHdtKTsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMzIsIGhlaWdodDogMC4yMiwgZGVwdGg6IDAuMDUgfSwgWzAsIC0wLjUsIDAuMTVdLCBpcm9uKTsgY29uc3QgaGFpciA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2hhaXInLCB7IGhlaWdodDogMC4zLCBkaWFtZXRlclRvcDogMCwgZGlhbWV0ZXJCb3R0b206IGQuaGVhZCAqIDEuMiB9LCBzKTsgaGFpci5wYXJlbnQgPSB0aGlzLnJpZzsgaGFpci5wb3NpdGlvbi55ID0gaGVhZC5wb3NpdGlvbi55ICsgZC5oZWFkICogMC43NTsgaGFpci5tYXRlcmlhbCA9IG1hdCgnI2MyMmExYycpOyBoYWlyLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIHRoaXMudG9wID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDEuMzU7IHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgZC53ICogMC43KTtcbiAgICBjb25zdCBsYmwgPSBkeW4ocywgMjU2LCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgMjZweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5maWxsU3R5bGUgPSAnI2ZmZmZmZic7IGMuc3Ryb2tlU3R5bGUgPSAnIzExMSc7IGMubGluZVdpZHRoID0gNTsgYy5zdHJva2VUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgYy5maWxsVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IH0pO1xuICAgIGNvbnN0IGxwID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbGJsJywgeyB3aWR0aDogMS4xLCBoZWlnaHQ6IDAuMiB9LCBzKTsgbHAucGFyZW50ID0gdGhpcy5ob2xkZXI7IGxwLnBvc2l0aW9uLnkgPSAtMC4xOyBscC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDIgKiAwLjA7IGxwLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7IGNvbnN0IGxtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbG0nLCBzKTsgbG0uZGlmZnVzZVRleHR1cmUgPSBsYmw7IGxtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBsbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBsbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IGxwLm1hdGVyaWFsID0gbG07IGxwLmlzUGlja2FibGUgPSBmYWxzZTsgbHAucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC42MjtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IHRoaXMudG9wLCBkaWFtZXRlcjogTWF0aC5tYXgoMC43LCBkLncgKiAxLjMpIH0sIHMpOyB0aGlzLnBpY2sucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMucGljay5wb3NpdGlvbi55ID0gdGhpcy50b3AgLyAyOyB0aGlzLnBpY2sudmlzaWJpbGl0eSA9IDAuMDAxOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gICAgKHRoaXMgYXMgYW55KS5wYXJ0cyA9IFtscF07IHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBsYXkoJ2lkbGUnKTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7ICh0aGlzIGFzIGFueSkuZXllTS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5iYXNlID0gQkFMQU5DRS5zdGFyLnNjYWxlW3N0IC0gMV07IGNvbnN0IHQgPSBUSU5UW3N0IC0gMV07IHRoaXMuYm9keS5tYXRlcmlhbC5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5Gcm9tSGV4U3RyaW5nKFBIW3RoaXMuc291bF0uY29sKS5zY2FsZSgwLjcyKS5tdWx0aXBseShuZXcgQkFCWUxPTi5Db2xvcjMoTWF0aC5taW4oMSwgdFswXSksIE1hdGgubWluKDEsIHRbMV0pLCBNYXRoLm1pbigxLCB0WzJdKSkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0KHRoaXMudGVhbSwgc3QpOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0TWFuYShmKTsgfVxuICBwdWxzZSgpIHsgdGhpcy5wdWxzZVQgPSAwLjE2OyB9XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQgPSAxKSB7IGlmIChzdGF0ZSA9PT0gdGhpcy5zdGF0ZSAmJiAoc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bicpKSByZXR1cm47IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5zdDAgPSB0aGlzLnQ7IHRoaXMuZHVyID0gc3RhdGUgPT09ICdhdHRhY2snID8gKEJBTEFOQ0Uuc3RhdHNbdGhpcy5zb3VsIGFzIFNvdWxJZF0uYW5pbUxlbiAvIHNwZWVkKSA6IHN0YXRlID09PSAnZGVhdGgnID8gMC42IDogc3RhdGUgPT09ICdzcGF3bicgPyAwLjkgOiAxLjA7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTsgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMudCArPSBkdDsgdGhpcy5kZWNvLnVwZGF0ZShkdCk7IGNvbnN0IHAgPSBNYXRoLm1pbigxLCAodGhpcy50IC0gdGhpcy5zdDApIC8gdGhpcy5kdXIpLCBSID0gdGhpcy5yaWcsIFcgPSB0aGlzLndwO1xuICAgIFIucG9zaXRpb24uc2V0KDAsIDAsIDApOyBSLnJvdGF0aW9uLnNldCgwLCAwLCAwKTsgUi5zY2FsaW5nLnNldEFsbCgxKTsgVy5yb3RhdGlvbi54ID0gLTAuNDsgdGhpcy5sZWdzLmZvckVhY2goKGwpID0+IChsLnJvdGF0aW9uLnggPSAwKSk7XG4gICAgaWYgKHRoaXMuc3RhdGUgPT09ICdpZGxlJykgUi5wb3NpdGlvbi55ID0gTWF0aC5zaW4odGhpcy50ICogMi4yKSAqIDAuMDEyO1xuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdydW4nKSB7IGNvbnN0IHcgPSB0aGlzLnQgKiAxMDsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odykpICogMC4wNzsgUi5yb3RhdGlvbi54ID0gMC4yOyB0aGlzLmxlZ3NbMF0ucm90YXRpb24ueCA9IE1hdGguc2luKHcpICogMC45OyB0aGlzLmxlZ3NbMV0ucm90YXRpb24ueCA9IC1NYXRoLnNpbih3KSAqIDAuOTsgVy5yb3RhdGlvbi54ID0gLTAuNCArIE1hdGguc2luKHcpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2F0dGFjaycpIHsgY29uc3QgayA9IHAgPCAwLjQgPyAtMi40ICogKHAgLyAwLjQpIDogLTIuNCArIDMuNCAqIE1hdGgubWluKDEsIChwIC0gMC40KSAvIDAuMjUpOyBXLnJvdGF0aW9uLnggPSBrOyBSLnBvc2l0aW9uLnogPSAwLjE0ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyBSLnJvdGF0aW9uLnggPSAwLjE1ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgeyBjb25zdCBlID0gcCAqIHAgKiAoMyAtIDIgKiBwKTsgUi5zY2FsaW5nLnNldEFsbCgwLjAxICsgMC45OSAqIGUpOyBSLnBvc2l0aW9uLnkgPSAoZSAtIDEpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2RlYXRoJykgeyBjb25zdCBlID0gcCAqIHA7IFIucm90YXRpb24ueCA9IC1NYXRoLlBJIC8gMiAqIGU7IFIucG9zaXRpb24ueSA9IDAuMjUgKiBlOyBSLnBvc2l0aW9uLnogPSAtMC4yICogZTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odGhpcy50ICogNykpICogMC4xNTsgVy5yb3RhdGlvbi54ID0gLTIuNjsgfVxuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVZpc3VhbChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcik6IFVuaXRWaXN1YWwge1xuICBjb25zdCBjZmcgPSBBLnRyaXBvW3NvdWxdO1xuICByZXR1cm4gY2ZnID8gbmV3IFRyaXBvVmlzdWFsKEEsIGNmZywgc291bCwgdGVhbSwgc3RhcikgOiBuZXcgUGxhY2Vob2xkZXJWaXN1YWwoQSwgc291bCwgdGVhbSwgc3Rhcik7XG59XG5leHBvcnQgY29uc3QgaXNUcmlwbyA9IChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCkgPT4gISFBLnRyaXBvW3NvdWxdO1xuIiwgIi8vIFRoZSBnYW1lJ3MgaWNvbiBzZXQgKGN1c3RvbSBhcnQsIHNsaWNlZCBmcm9tIFBpcGVsaW5lL2ljb25zL3NoZWV0XyoucG5nIGJ5IFBpcGVsaW5lL2JsZW5kZXIvc2xpY2VfaWNvbnMucHkgLT4gZG9jcy9hc3NldHMvaWNvbnMvKi5wbmcpLlxuLy8gU2hhcmVkIGJ5IHRoZSAzRCBnYW1lJ3MgRE9NICh2YW5pbGxhKSBhbmQgdGhlIEFuZ3VsYXIgc2hlbGwuIE5vIGVtb2ppIGFueXdoZXJlOiBldmVyeSBnbHlwaCBpbiB0aGUgVUkgaXMgb25lIG9mIHRoZXNlIGltYWdlcy5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUmFyaXR5IH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5cbmV4cG9ydCB0eXBlIEljb25OYW1lID1cbiAgfCAnaG9tZScgfCAnc291bHMnIHwgJ3Nob3AnIHwgJ3NldHRpbmdzJyB8ICdjbG9zZSdcbiAgfCAnaGVhcnQnIHwgJ2hlYXJ0X2VtcHR5JyB8ICdkb21pbmlvbicgfCAnc3RhcicgfCAnbG9jaydcbiAgfCAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJ1xuICB8ICdnZW1fY29tbW9uJyB8ICdnZW1fcmFyZScgfCAnZ2VtX2VwaWMnIHwgJ2dlbV9sZWdlbmRhcnknXG4gIHwgJ211c2ljJyB8ICdzb3VuZF9vbicgfCAnc291bmRfb2ZmJyB8ICd1cGdyYWRlJyB8ICdzd2FwJ1xuICB8ICdtZXJnZScgfCAncmVtb3ZlJyB8ICdjaGVjaycgfCAnYmFjaycgfCAnaW5mbyc7XG5cbi8qKiBSZWxhdGl2ZSB0byB0aGUgcGFnZSwgc28gaXQgd29ya3Mgb24gR2l0SHViIFBhZ2VzIHVuZGVyIC9yZXBvLW5hbWUvLiAqL1xuZXhwb3J0IGNvbnN0IGljb25VcmwgPSAobjogSWNvbk5hbWUpOiBzdHJpbmcgPT4gJ2Fzc2V0cy9pY29ucy8nICsgbiArICcucG5nJztcbi8qKiBBbiA8aW1nPiBhcyBhbiBIVE1MIHN0cmluZywgZm9yIHRoZSBnYW1lJ3MgaGFuZC1idWlsdCBET00uICovXG5leHBvcnQgY29uc3QgaWNvbkltZyA9IChuOiBJY29uTmFtZSwgY2xzID0gJ2ljJyk6IHN0cmluZyA9PiBgPGltZyBjbGFzcz1cIiR7Y2xzfVwiIHNyYz1cIiR7aWNvblVybChuKX1cIiBhbHQ9XCJcIiBkcmFnZ2FibGU9XCJmYWxzZVwiPmA7XG5cbi8qKiBFYWNoIFNvdWwgaXMgc2hvd24gYnkgaXRzIHdlYXBvbi9yb2xlIGljb24gdW50aWwgcmVhbCBwb3J0cmFpdHMgZXhpc3QuICovXG5leHBvcnQgY29uc3QgU09VTF9JQ09OOiBSZWNvcmQ8U291bElkLCBJY29uTmFtZT4gPSB7IHdhcnJpb3I6ICd3YXJyaW9yJywgYXJjaGVyOiAnYXJjaGVyJywgZ29ibGluOiAnZ29ibGluJywga25pZ2h0OiAna25pZ2h0Jywgb2dyZTogJ29ncmUnLCBiYXJiYXJpYW46ICdiYXJiYXJpYW4nIH07XG5leHBvcnQgY29uc3QgUkFSSVRZX0dFTTogUmVjb3JkPFJhcml0eSwgSWNvbk5hbWU+ID0geyBjb21tb246ICdnZW1fY29tbW9uJywgcmFyZTogJ2dlbV9yYXJlJywgZXBpYzogJ2dlbV9lcGljJywgbGVnZW5kYXJ5OiAnZ2VtX2xlZ2VuZGFyeScgfTtcblxuLyoqIFBhY2sgdGllcnMgYXJlIHNob3duIGFzIHNrdWxscyAobmV2ZXIgc3RhcnM6IHN0YXJzIG1lYW4gYW4gaW4tcnVuIG1lcmdlIGxldmVsKS4gKi9cbmV4cG9ydCBjb25zdCBza3VsbEltZ3MgPSAobjogbnVtYmVyLCBjbHMgPSAnc2snKTogc3RyaW5nID0+IGljb25JbWcoJ3NvdWxzJywgY2xzKS5yZXBlYXQoTWF0aC5tYXgoMSwgbikpO1xuZXhwb3J0IGNvbnN0IGhlYXJ0c0h0bWwgPSAoaGVhcnRzOiBudW1iZXIsIG1heCA9IDMpOiBzdHJpbmcgPT4gaWNvbkltZygnaGVhcnQnLCAnaWMgaGVhcnQnKS5yZXBlYXQoTWF0aC5tYXgoMCwgaGVhcnRzKSkgKyBpY29uSW1nKCdoZWFydF9lbXB0eScsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBtYXggLSBoZWFydHMpKTtcbiIsICIvLyBET00gdXNlciBpbnRlcmZhY2U6IHRvcCBiYXIsIGVuZW15IHByZXZpZXcsIGhhbmQgb2YgY2FyZHMsIGJ1dHRvbnMsIGRyYWZ0IG92ZXJsYXksIHRvYXN0cyBhbmQgdGhlIGRlYnVnIHBhbmVsLlxuaW1wb3J0IHsgQkFMQU5DRSwgUk9MRV9URVhULCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgY2FuTWVyZ2VEZXBsb3llZCwgY2FuTWVyZ2VGcm9tSGFuZCwgY2FuU3VtbW9uLCBjb3N0LCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgc3RhZ2VXYXZlcyB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgZW5lbXlXYXZlLCBwcmV2aWV3VGV4dCB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgYXVkaW8gfSBmcm9tICcuL2F1ZGlvLnRzJztcbmltcG9ydCB7IFNPVUxfSUNPTiwgaGVhcnRzSHRtbCwgaWNvbkltZywgaWNvblVybCwgc2t1bGxJbWdzIH0gZnJvbSAnLi4vdWkvaWNvbnMudHMnO1xuXG5jb25zdCBJQ09OID0gT2JqZWN0LmZyb21FbnRyaWVzKFNPVUxTLm1hcCgocykgPT4gW3MsIGljb25JbWcoU09VTF9JQ09OW3NdLCAnaWMnKV0pKSBhcyBSZWNvcmQ8U291bElkLCBzdHJpbmc+O1xuY29uc3QgJCA9IChpZDogc3RyaW5nKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkhO1xuY29uc3Qgc3RhcnMgPSAobjogbnVtYmVyKSA9PiAnXHUyNjA1Jy5yZXBlYXQobik7XG5cbmV4cG9ydCBjbGFzcyBVaSB7XG4gIHByaXZhdGUgdG9hc3RUID0gMDsgcHJpdmF0ZSBkYmc6IEhUTUxFbGVtZW50OyBwcml2YXRlIG9kZHMgPSAnJztcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBnOiBhbnkpIHtcbiAgICAkKCdidG5Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAkKCdidG5CYXR0bGUnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydEJhdHRsZSgpOyAkKCdidG5Td2FwJykub25jbGljayA9ICgpID0+IGcudG9nZ2xlU3dhcCgpO1xuICAgICQoJ2J0bk1lcmdlJykub25jbGljayA9ICgpID0+IGcubWVyZ2VTZWxlY3RlZCgpOyAkKCdidG5SZW1vdmUnKS5vbmNsaWNrID0gKCkgPT4gZy5yZW1vdmVTZWxlY3RlZCgpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zcGVlZF0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRTcGVlZCgrYi5kYXRhc2V0LnNwZWVkISkpKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiBnLnNldENhbU1vZGUoYi5kYXRhc2V0LmNhbSEpKSk7XG4gICAgJCgnZ2VhcicpLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuZGJnLmNsYXNzTGlzdC50b2dnbGUoJ29wZW4nKTsgdGhpcy5yZW5kZXJEZWJ1ZygpOyB9O1xuICAgIGNvbnN0IHNuZCA9ICgpID0+IHsgJCgnYnRuTXVzaWMnKS5jbGFzc0xpc3QudG9nZ2xlKCdvZmYnLCAhYXVkaW8ubXVzaWMpOyAkKCdidG5TZngnKS5jbGFzc0xpc3QudG9nZ2xlKCdvZmYnLCAhYXVkaW8uc2Z4KTsgY29uc3Qgc2kgPSAkKCdidG5TZngnKS5xdWVyeVNlbGVjdG9yKCdpbWcnKTsgaWYgKHNpKSBzaS5zcmMgPSBpY29uVXJsKGF1ZGlvLnNmeCA/ICdzb3VuZF9vbicgOiAnc291bmRfb2ZmJyk7IH07XG4gICAgJCgnYnRuTXVzaWMnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRNdXNpYyghYXVkaW8ubXVzaWMpOyBzbmQoKTsgfTsgJCgnYnRuU2Z4Jykub25jbGljayA9ICgpID0+IHsgYXVkaW8uc2V0U2Z4KCFhdWRpby5zZngpOyBzbmQoKTsgfTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MnLCBzbmQpOyBzbmQoKTtcbiAgICB0aGlzLmRiZyA9ICQoJ2RlYnVnJyk7IGlmIChuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdkZWJ1ZycpKSB0aGlzLmRiZy5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gICAgdGhpcy5yZW5kZXJEZWJ1ZygpO1xuICB9XG5cbiAgLyoqIFRoZSBOZWNyb21hbmNlciBqdXN0IGxvc3QgYSBoZWFydDogbWFrZSB0aGUgaGVhcnRzIGJ1bXAuICovXG4gIHB1bHNlSGVhcnRzKCkgeyBjb25zdCBoID0gJCgnaGVhcnRzJyk7IGguY2xhc3NMaXN0LnJlbW92ZSgnaHVydCcpOyB2b2lkIGgub2Zmc2V0V2lkdGg7IGguY2xhc3NMaXN0LmFkZCgnaHVydCcpOyB9XG4gIHRvYXN0KG1zZzogc3RyaW5nKSB7IGNvbnN0IHQgPSAkKCd0b2FzdCcpOyB0LnRleHRDb250ZW50ID0gbXNnOyB0LmNsYXNzTGlzdC5hZGQoJ3Nob3cnKTsgY2xlYXJUaW1lb3V0KHRoaXMudG9hc3RUKTsgdGhpcy50b2FzdFQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0LmNsYXNzTGlzdC5yZW1vdmUoJ3Nob3cnKSwgMzYwMCk7IH1cblxuICByZW5kZXIoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgcyA9IGcucywgcGggPSBnLnBoYXNlLCBidWlsZCA9IHBoID09PSAnYnVpbGQnO1xuICAgICQoJ2hlYXJ0cycpLmlubmVySFRNTCA9IGhlYXJ0c0h0bWwocy5oZWFydHMpO1xuICAgICQoJ3dhdmUnKS50ZXh0Q29udGVudCA9IGBXYXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9YDtcbiAgICBjb25zdCB1c2VkID0gZG9taW5pb25Vc2VkKHMpOyAkKCdkb20nKS50ZXh0Q29udGVudCA9IGAke3VzZWR9LyR7cy5jYXB9YDsgKCQoJ2RvbWZpbGwnKSBhcyBIVE1MRWxlbWVudCkuc3R5bGUud2lkdGggPSBNYXRoLm1pbigxMDAsICh1c2VkIC8gcy5jYXApICogMTAwKSArICclJztcbiAgICAvLyBlbmVteSBwcmV2aWV3OiB3aGF0IGlzIGNvbWluZywgbmV2ZXIgd2hlcmVcbiAgICBjb25zdCBwdiA9IHByZXZpZXdUZXh0KGVuZW15V2F2ZShzLndhdmUsIGcuc2VlZCkpO1xuICAgICQoJ2VuZW15JykuaW5uZXJIVE1MID0gYDxiPk5leHQgZW5lbWllczwvYj5gICsgcHYubWFwKChwKSA9PiBgPGRpdiBjbGFzcz1cImVyb3dcIj48c3Bhbj4ke0lDT05bcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuPiR7U09VTF9OQU1FW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3BhbiBjbGFzcz1cInhcIj5cdTAwRDcke3AuY291bnR9PC9zcGFuPjxzcGFuIGNsYXNzPVwic3RcIj4ke3N0YXJzKHAuc3Rhcil9PC9zcGFuPjwvZGl2PmApLmpvaW4oJycpICsgYDxkaXYgY2xhc3M9XCJoaW50XCI+UG9zaXRpb25zIHN0YXkgaGlkZGVuIHVudGlsIHRoZSBiYXR0bGUuPC9kaXY+YDtcbiAgICAvLyBoYW5kXG4gICAgY29uc3QgaGFuZCA9ICQoJ2hhbmQnKTsgaGFuZC5pbm5lckhUTUwgPSAnJztcbiAgICBzLmhhbmQuZm9yRWFjaCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IHtcbiAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGNvbnN0IHNlbCA9IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiBnLnNlbC5pZHggPT09IGk7IGNvbnN0IGFmZm9yZCA9IGNhblN1bW1vbihzLCBpKSwgY2FuTWVyZ2UgPSBzLnVuaXRzLnNvbWUoKHU6IGFueSkgPT4gY2FuTWVyZ2VGcm9tSGFuZChzLCBpLCB1LmlkKSksIHVzYWJsZSA9IGFmZm9yZCB8fCBjYW5NZXJnZTtcbiAgICAgIGVsLmNsYXNzTmFtZSA9ICdjYXJkJyArIChzZWwgPyAnIHNlbCcgOiAnJykgKyAoIXVzYWJsZSAmJiAhZy5zd2FwTW9kZSA/ICcgZGlzJyA6ICcnKSArIChnLnN3YXBNb2RlID8gJyBzd2FwJyA6ICcnKTtcbiAgICAgIGNvbnN0IHRhZyA9IGFmZm9yZCA/IGA8c3BhbiBjbGFzcz1cIm9rXCI+U3VtbW9uPC9zcGFuPmAgOiBjYW5NZXJnZSA/ICc8c3BhbiBjbGFzcz1cIm9rIG1nXCI+TWVyZ2Ugb25seTwvc3Bhbj4nIDogJzxzcGFuIGNsYXNzPVwibm9cIj5ObyByb29tPC9zcGFuPic7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHtJQ09OW3NvdWxdfTxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJjc1wiPiR7dGFnfTwvZGl2PmA7IGVsLnRpdGxlID0gUk9MRV9URVhUW3NvdWxdICsgKGFmZm9yZCA/ICcnIDogY2FuTWVyZ2UgPyAnIC0gRG9taW5pb24gaXMgZnVsbCwgYnV0IHlvdSBjYW4gbWVyZ2UgaXQgaW50byB5b3VyIG1hdGNoaW5nIDEtc3RhciB1bml0LicgOiAnIC0gTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLicpO1xuICAgICAgZWwub25jbGljayA9ICgpID0+IGcub25DYXJkKGkpOyBoYW5kLmFwcGVuZENoaWxkKGVsKTtcbiAgICB9KTtcbiAgICBpZiAoIXMuaGFuZC5sZW5ndGgpIGhhbmQuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9XCJlbXB0eVwiPk5vIGNhcmRzIGluIGhhbmQ8L2Rpdj4nO1xuICAgIC8vIGJ1dHRvbnNcbiAgICAoJCgnYnRuQmF0dGxlJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQpLmRpc2FibGVkID0gIWJ1aWxkIHx8ICFzLnVuaXRzLmxlbmd0aDtcbiAgICBjb25zdCBzdyA9ICQoJ2J0blN3YXAnKSBhcyBIVE1MQnV0dG9uRWxlbWVudDsgc3cuZGlzYWJsZWQgPSAhYnVpbGQgfHwgcy5kaXNjYXJkVXNlZDsgc3cuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBnLnN3YXBNb2RlKTsgc3cudGV4dENvbnRlbnQgPSBzLmRpc2NhcmRVc2VkID8gJ1N3YXAgdXNlZCcgOiBnLnN3YXBNb2RlID8gJ1N3YXA6IHBpY2sgYSBjYXJkIG9yIHVuaXQnIDogJ1N3YXAgKDEvcm91bmQpJztcbiAgICBjb25zdCBzZWxVID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ3VuaXQnID8gcy51bml0cy5maW5kKCh1OiBhbnkpID0+IHUuaWQgPT09IGcuc2VsLmlkKSA6IG51bGw7XG4gICAgY29uc3QgcGFydG5lciA9IHNlbFUgJiYgcy51bml0cy5zb21lKChvOiBhbnkpID0+IGNhbk1lcmdlRGVwbG95ZWQoc2VsVSwgbykpO1xuICAgICQoJ3VuaXRwYW5lbCcpLnN0eWxlLmRpc3BsYXkgPSBidWlsZCAmJiBzZWxVID8gJ2ZsZXgnIDogJ25vbmUnOyAoJCgnYnRuTWVyZ2UnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhcGFydG5lcjtcbiAgICAkKCdidG5SZW1vdmUnKS50ZXh0Q29udGVudCA9IGcuY29uZmlybVJlbW92ZSA/ICdDb25maXJtIHJlbW92ZScgOiAnUmVtb3ZlJztcbiAgICAkKCdpbmZvJykudGV4dENvbnRlbnQgPSBidWlsZCA/IChnLnN3YXBNb2RlID8gJ1NXQVA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkIGl0LCBvciB0YXAgYSB1bml0IHlvdSBkaWQgbm90IHN1bW1vbiB0aGlzIHJvdW5kIHRvIHNlbGwgaXQuIFlvdSBkcmF3IGEgZGlmZmVyZW50IFNvdWwuJ1xuICAgICAgOiBzZWxVID8gYCR7U09VTF9OQU1FW3NlbFUuc291bCBhcyBTb3VsSWRdfSAke3N0YXJzKHNlbFUuc3Rhcil9ICBcdTIwMjIgICR7Uk9MRV9URVhUW3NlbFUuc291bCBhcyBTb3VsSWRdfSAgJHtwYXJ0bmVyID8gJ1x1MjAyMiBUYXAgYSBnbG93aW5nIHBhcnRuZXIgdG8gbWVyZ2UuJyA6ICcnfWBcbiAgICAgIDogZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnID8gYCR7U09VTF9OQU1FW3MuaGFuZFtnLnNlbC5pZHhdIGFzIFNvdWxJZF19OiAke1JPTEVfVEVYVFtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfSAgXHUyMDIyICBgICsgKCgpID0+IHsgY29uc3QgaSA9IGcuc2VsLmlkeCwgc20gPSBjYW5TdW1tb24ocywgaSksIG1nID0gcy51bml0cy5zb21lKCh1OiBhbnkpID0+IGNhbk1lcmdlRnJvbUhhbmQocywgaSwgdS5pZCkpOyByZXR1cm4gc20gJiYgbWcgPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24sIG9yIGEgZ2xvd2luZyBwdXJwbGUgdW5pdCB0byBtZXJnZSBpdCBpbi4nIDogc20gPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24uJyA6IG1nID8gJ0RvbWluaW9uIGlzIGZ1bGw6IHRhcCBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6ICdOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJzsgfSkoKSA6ICdUYXAgYSBjYXJkLCB0aGVuIGEgdGlsZS4gVGFwIGEgdW5pdCB0byBtZXJnZSwgbW92ZSBvciByZW1vdmUgaXQuJylcbiAgICAgIDogcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnQmF0dGxlISBVbml0cyBmaWdodCBvbiB0aGVpciBvd24uJyA6ICcnO1xuICAgICQoJ3NwZWVkJykuc3R5bGUuZGlzcGxheSA9IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2ZsZXgnIDogJ25vbmUnO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zcGVlZF0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgK2IuZGF0YXNldC5zcGVlZCEgPT09IGcudGltZVNjYWxlKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgYi5kYXRhc2V0LmNhbSA9PT0gZy5jYW1Nb2RlKSk7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QudG9nZ2xlKCdpbmJhdHRsZScsIHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nKTsgYXVkaW8uc2V0TW9kZShwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdiYXR0bGUnIDogJ2J1aWxkJyk7XG4gICAgLy8gb3ZlcmxheVxuICAgIGNvbnN0IG92ID0gJCgnb3ZlcmxheScpOyBvdi5jbGFzc05hbWUgPSAnJzsgb3YuaW5uZXJIVE1MID0gJyc7XG4gICAgaWYgKHBoID09PSAnZHJhZnQnICYmIGcuZHJhZnQpIHtcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+VmljdG9yeSBEcmFmdDwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPldhdmUgY2xlYXJlZC4gRG9taW5pb24gaXMgbm93ICR7cy5jYXB9LiBLZWVwIG9uZTo8L2Rpdj48ZGl2IGNsYXNzPVwicm93XCI+JHtnLmRyYWZ0Lm1hcCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IGA8ZGl2IGNsYXNzPVwiY2FyZCBiaWdcIiBkYXRhLWk9XCIke2l9XCI+PGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHtJQ09OW3NvdWxdfTxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJyb2xlXCI+JHtST0xFX1RFWFRbc291bF19PC9kaXY+PC9kaXY+YCkuam9pbignJyl9PC9kaXY+PC9kaXY+YDtcbiAgICAgIG92LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCcuY2FyZCcpLmZvckVhY2goKGMpID0+IChjLm9uY2xpY2sgPSAoKSA9PiBnLnBpY2tEcmFmdCgrYy5kYXRhc2V0LmkhKSkpO1xuICAgIH0gZWxzZSBpZiAocGggPT09ICd3b24nIHx8IHBoID09PSAnbG9zdCcpIHtcbiAgICAgIGNvbnN0IHJ3ID0gcGggPT09ICd3b24nID8gZy5yZXdhcmQgOiBudWxsLCBzayA9IChuOiBudW1iZXIpID0+IHNrdWxsSW1ncyhuKTtcbiAgICAgIGNvbnN0IHJld2FyZEh0bWwgPSBydyA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7cncucGFjayA/IChydy5maXJzdCA/IGAke2ljb25JbWcoJ3Nob3AnKX0gRmlyc3QgY2xlYXIhIFlvdSBlYXJuZWQgYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gIDogYCR7aWNvbkltZygnc2hvcCcpfSBSZXBsYXkgcmV3YXJkOiBhICR7c2socncucGFjay50aWVyKX0gU291bCBQYWNrLmApIDogYFJlcGxheSBwcm9ncmVzcyAke3J3LnJlcGxheU1ldGVyfS8ke3J3LnJlcGxheU5lZWRlZH0gdG93YXJkIGEgU291bCBQYWNrLmB9PC9kaXY+YCA6ICcnO1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj4ke3BoID09PSAnd29uJyA/ICdTdGFnZSBjbGVhcmVkIScgOiAnU3RhZ2UgbG9zdCd9PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+JHtnLmxhc3RCYXR0bGV9PC9kaXY+JHtyZXdhcmRIdG1sfTxkaXYgY2xhc3M9XCJyb3dcIj4ke3J3ICYmIHJ3LnBhY2sgPyAnPGJ1dHRvbiBpZD1cInRvU2hvcFwiIGNsYXNzPVwiZ29cIj5PcGVuIHBhY2s8L2J1dHRvbj4nIDogJyd9PGJ1dHRvbiBpZD1cImFnYWluXCIgY2xhc3M9XCIke3J3ICYmIHJ3LnBhY2sgPyAnYmx1ZScgOiAnZ28nfVwiPiR7cGggPT09ICd3b24nID8gJ1BsYXkgYWdhaW4nIDogJ1RyeSBhZ2Fpbid9PC9idXR0b24+PGJ1dHRvbiBpZD1cInRvSG9tZVwiIGNsYXNzPVwiYmx1ZVwiPkhvbWU8L2J1dHRvbj48L2Rpdj48L2Rpdj5gO1xuICAgICAgJCgnYWdhaW4nKS5vbmNsaWNrID0gKCkgPT4gZy5uZXdSdW4oKTsgJCgndG9Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAgIGNvbnN0IHRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvU2hvcCcpOyBpZiAodHMpIHRzLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLXNob3AnKSk7XG4gICAgfVxuICAgIHRoaXMucmVuZGVyRGVidWdMaXZlKCk7XG4gICAgaWYgKHBoID09PSAnYnVpbGQnKSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4gZy5yZWZyYW1lQnVpbGQoKSk7ICAgICAvLyBhZnRlciBsYXlvdXQ6IGtlZXAgdGhlIGdyaWQgY2xlYXIgb2YgdGhlIGhhbmQgYW5kIGJ1dHRvbnNcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBwYW5lbFxuICBwcml2YXRlIHJlbmRlckRlYnVnKCkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmcsIGQgPSB0aGlzLmRiZzsgaWYgKCFkLmNsYXNzTGlzdC5jb250YWlucygnb3BlbicpKSB7IGQuaW5uZXJIVE1MID0gJyc7IHJldHVybjsgfVxuICAgIGNvbnN0IHJvdyA9IChsYWJlbDogc3RyaW5nLCBvYmo6IGFueSwga2V5OiBzdHJpbmcgfCBudW1iZXIsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlciwgc3RlcDogbnVtYmVyKSA9PiBgPGxhYmVsPiR7bGFiZWx9IDxpbnB1dCB0eXBlPVwicmFuZ2VcIiBtaW49XCIke21pbn1cIiBtYXg9XCIke21heH1cIiBzdGVwPVwiJHtzdGVwfVwiIHZhbHVlPVwiJHtvYmpba2V5XX1cIiBkYXRhLW89XCIke2xhYmVsfVwiPjxzcGFuPiR7b2JqW2tleV19PC9zcGFuPjwvbGFiZWw+YDtcbiAgICBkLmlubmVySFRNTCA9IGA8Yj5EZWJ1ZyAobGl2ZSk8L2I+IDxzcGFuIGlkPVwiZGJnZnBzXCI+PC9zcGFuPlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5TdGFyIG11bHRpcGxpZXJzIChib2RpZXMgPSBkYW1hZ2UsIHN0YXJzID0gZHVyYWJpbGl0eSlcbiAgICAgICAgJHtyb3coJ0hQIHggMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5ocCwgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0hQIHggM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5ocCwgMiwgMSwgNiwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAxLCAxLCA0LCAwLjA1KX0ke3JvdygnRGFtYWdlIHggM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5kbWcsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdTaXplIDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDEsIDEsIDEuNiwgMC4wMil9JHtyb3coJ1NpemUgM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5zY2FsZSwgMiwgMSwgMiwgMC4wMil9PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjx0YWJsZT48dHI+PHRoPjwvdGg+PHRoPmhwPC90aD48dGg+ZG1nPC90aD48dGg+cmF0ZTwvdGg+PHRoPnJhbmdlPC90aD48dGg+c3BkPC90aD48L3RyPiR7U09VTFMubWFwKChrKSA9PiBgPHRyPjx0ZD4ke0lDT05ba119PC90ZD4ke1snaHAnLCAnZG1nJywgJ2ludGVydmFsJywgJ3JhbmdlJywgJ3NwZWVkJ10ubWFwKChmKSA9PiBgPHRkPjxpbnB1dCBjbGFzcz1cIm51bVwiIGRhdGEtc291bD1cIiR7a31cIiBkYXRhLWY9XCIke2Z9XCIgdmFsdWU9XCIkeyhCQUxBTkNFLnN0YXRzIGFzIGFueSlba11bZl19XCI+PC90ZD5gKS5qb2luKCcnKX08L3RyPmApLmpvaW4oJycpfTwvdGFibGU+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPkRpZmZpY3VsdHkgPHNlbGVjdCBpZD1cImREaWZmXCI+JHtbJ2Vhc3knLCAnbm9ybWFsJywgJ2hhcmQnLCAnbmlnaHRtYXJlJ10ubWFwKChrKSA9PiBgPG9wdGlvbiB2YWx1ZT1cIiR7a31cIiAke2cuZGlmZmljdWx0eSA9PT0gayA/ICdzZWxlY3RlZCcgOiAnJ30+JHtrfTwvb3B0aW9uPmApLmpvaW4oJycpfTwvc2VsZWN0PiA8c21hbGw+KGFwcGxpZXMgdG8gdGhlIG5leHQgYmF0dGxlKTwvc21hbGw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxsYWJlbD48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgaWQ9XCJkTWVyZ2VIYW5kXCIgJHtnLnMucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInID8gJ2NoZWNrZWQnIDogJyd9PiBNZXJnZSBhIGhhbmQgY2FyZCBzdHJhaWdodCBpbnRvIGEgZGVwbG95ZWQgdW5pdCAob2ZmID0gZG9jIHJ1bGU6IGJvdGggY29waWVzIG11c3QgYmUgb24gdGhlIGJvYXJkKTwvbGFiZWw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPlBlcmZvcm1hbmNlPGJyPjxzbWFsbCBpZD1cImRiZ1BlcmZcIj5tZWFzdXJpbmdcdTIwMjY8L3NtYWxsPjxicj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZEZwc1wiICR7Zy5zaG93RnBzID8gJ2NoZWNrZWQnIDogJyd9PiBTaG93IEZQUyBvbiB0aGUgYmF0dGxlIHNjcmVlbjwvbGFiZWw+IDxidXR0b24gaWQ9XCJkUGVyZlwiPkNvcHkgcGVyZiByZXBvcnQ8L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRPZGRzXCI+VGVzdCBvZGRzICgyMDAgZmlnaHRzKTwvYnV0dG9uPiA8c3BhbiBpZD1cImRPZGRzT3V0XCI+JHt0aGlzLm9kZHN9PC9zcGFuPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZENvcHlcIj5Db3B5IHJlcG9ydDwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZFJlc2V0XCI+UmVzZXQgYmFsYW5jZTwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZFJlc3RhcnRcIj5SZXN0YXJ0IHN0YWdlPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPkFkZCBjYXJkIDxzZWxlY3QgaWQ9XCJkQ2FyZFwiPiR7U09VTFMubWFwKChrKSA9PiBgPG9wdGlvbiB2YWx1ZT1cIiR7a31cIj4ke1NPVUxfTkFNRVtrXX08L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPGJ1dHRvbiBpZD1cImRBZGRcIj4rPC9idXR0b24+IDxidXR0b24gaWQ9XCJkRG9tXCI+KzIgRG9taW5pb248L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHNtYWxsPkxhc3QgdGFwOiA8c3BhbiBpZD1cImRiZ3RhcFwiPiR7Zy5sYXN0VGFwSW5mb308L3NwYW4+PC9zbWFsbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHNtYWxsPlNlZWQgJHtnLnNlZWR9LiBBZGQgPGNvZGU+P3NlZWQ9NzwvY29kZT4gdG8gdGhlIGxpbmsgdG8gcmVwbGF5IHRoZSBzYW1lIGRyYXdzLjwvc21hbGw+PC9kaXY+YDtcbiAgICBkLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oJ2lucHV0W3R5cGU9cmFuZ2VdJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uaW5wdXQgPSAoKSA9PiB7XG4gICAgICBjb25zdCBsYWIgPSBpbnAuZGF0YXNldC5vITsgY29uc3QgdiA9ICtpbnAudmFsdWU7IChpbnAubmV4dEVsZW1lbnRTaWJsaW5nIGFzIEhUTUxFbGVtZW50KS50ZXh0Q29udGVudCA9IFN0cmluZyh2KTtcbiAgICAgIGNvbnN0IHNldDogUmVjb3JkPHN0cmluZywgKCkgPT4gdm9pZD4gPSB7ICdIUCB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmhwWzFdID0gdiksICdIUCB4IDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmhwWzJdID0gdiksICdEYW1hZ2UgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMV0gPSB2KSwgJ0RhbWFnZSB4IDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1syXSA9IHYpLCAnU2l6ZSAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5zY2FsZVsxXSA9IHYpLCAnU2l6ZSAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5zY2FsZVsyXSA9IHYpIH07XG4gICAgICBzZXRbbGFiXSgpOyBnLmFwcGx5QmFsYW5jZUNoYW5nZSgpO1xuICAgIH0pKTtcbiAgICBkLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oJ2lucHV0Lm51bScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmNoYW5nZSA9ICgpID0+IHsgKEJBTEFOQ0Uuc3RhdHMgYXMgYW55KVtpbnAuZGF0YXNldC5zb3VsIV1baW5wLmRhdGFzZXQuZiFdID0gK2lucC52YWx1ZTsgfSkpO1xuICAgICQoJ2REaWZmJykub25jaGFuZ2UgPSAoZSkgPT4gZy5jaGFuZ2VEaWZmaWN1bHR5KChlLnRhcmdldCBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUpO1xuICAgICQoJ2RNZXJnZUhhbmQnKS5vbmNoYW5nZSA9IChlKSA9PiB7IGcucy5ydWxlcy5tZXJnZSA9IChlLnRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS5jaGVja2VkID8gJ2hhbmRJbnRvT25lU3RhcicgOiAnZGVwbG95ZWRPbmx5JzsgZy5zeW5jQnVpbGQoKTsgdGhpcy5yZW5kZXIoKTsgfTtcbiAgICAkKCdkT2RkcycpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHIgPSBnLnRlc3RPZGRzKDIwMCk7IHRoaXMub2RkcyA9IGAke3Iud2lufSUgd2luICgke3Iubn0gZmlnaHRzLCBhdmcgJHtyLmF2Z1RpbWV9cykgdnMgd2F2ZSAke2cucy53YXZlfWA7ICQoJ2RPZGRzT3V0JykudGV4dENvbnRlbnQgPSB0aGlzLm9kZHM7IH07XG4gICAgJCgnZENvcHknKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCB0ID0gZy5yZXBvcnQoKTsgKG5hdmlnYXRvci5jbGlwYm9hcmQgPyBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KSA6IFByb21pc2UucmVqZWN0KCkpLnRoZW4oKCkgPT4gdGhpcy50b2FzdCgnUmVwb3J0IGNvcGllZC4gUGFzdGUgaXQgaW50byBjaGF0LicpKS5jYXRjaCgoKSA9PiB7IHByb21wdCgnQ29weSB0aGlzIHJlcG9ydDonLCB0KTsgfSk7IH07XG4gICAgJCgnZEZwcycpLm9uY2hhbmdlID0gKGUpID0+IGcuc2V0U2hvd0ZwcygoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZCk7XG4gICAgJCgnZFBlcmYnKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCB0ID0gZy5wZXJmUmVwb3J0KCk7IChuYXZpZ2F0b3IuY2xpcGJvYXJkID8gbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCkgOiBQcm9taXNlLnJlamVjdCgpKS50aGVuKCgpID0+IHRoaXMudG9hc3QoJ1BlcmYgcmVwb3J0IGNvcGllZC4gUGFzdGUgaXQgaW50byBjaGF0LicpKS5jYXRjaCgoKSA9PiB7IHByb21wdCgnQ29weSB0aGlzIHJlcG9ydDonLCB0KTsgfSk7IH07XG4gICAgJCgnZFJlc2V0Jykub25jbGljayA9ICgpID0+IHsgZy5yZXNldEJhbGFuY2VBbGwoKTsgdGhpcy5yZW5kZXJEZWJ1ZygpOyB9O1xuICAgICQoJ2RSZXN0YXJ0Jykub25jbGljayA9ICgpID0+IGcuc3RhcnRTdGFnZShnLnNlZWQpO1xuICAgICQoJ2RBZGQnKS5vbmNsaWNrID0gKCkgPT4gZy5hZGRDYXJkKCgkKCdkQ2FyZCcpIGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSBhcyBTb3VsSWQpOyAkKCdkRG9tJykub25jbGljayA9ICgpID0+IGcuYWRkRG9taW5pb24oMik7XG4gIH1cbiAgcmVuZGVyRGVidWdMaXZlKCkge1xuICAgIGNvbnN0IGYgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJnZnBzJyk7IGlmIChmKSBmLnRleHRDb250ZW50ID0gYCR7dGhpcy5nLnBoYXNlfWA7XG4gICAgY29uc3QgcGYgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJnUGVyZicpOyBpZiAocGYpIHsgY29uc3QgcCA9IHRoaXMuZy5wZXJmSW5mbygpOyBwZi50ZXh0Q29udGVudCA9IGAke3AuZnBzLnRvRml4ZWQoMCl9IGZwcyBcdTAwQjcgYXZnICR7cC5hdmcudG9GaXhlZCgxKX1tcyBcdTAwQjcgc2xvdzUlICR7cC5wOTUudG9GaXhlZCgwKX1tcyBcdTAwQjcgd29yc3QgJHtwLndvcnN0LnRvRml4ZWQoMCl9bXMgXHUwMEI3ICR7cC5tZXNoZXN9IG1lc2hlcyBcdTAwQjcgJHtwLnBhcnRpY2xlc30gcGFydGljbGUgc3lzdGVtcyBcdTAwQjcgJHtwLmRyYXdzfSBkcmF3IGNhbGxzYDsgfVxuICAgIGNvbnN0IHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJndGFwJyk7IGlmICh0KSB0LnRleHRDb250ZW50ID0gdGhpcy5nLmxhc3RUYXBJbmZvO1xuICB9XG59XG4iLCAiLy8gVGhlIHBsYXlhYmxlIHByb3RvdHlwZTogYnVpbGQgc2NyZWVuIC0+IGJhdHRsZSAtPiBkcmFmdCAtPiBuZXh0IHdhdmUsIGJ1aWx0IG9uIHRoZSB0ZXN0ZWQgcnVsZXMgKyBiYXR0bGUgZW5naW5lLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFLCByZXNldEJhbGFuY2UsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBHUklEX0NFTExTLCBHUklEX0NPTFMsIEdSSURfUk9XUywgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHtcbiAgYWR2YW5jZVdhdmUsIGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY2VsbEZyZWUsIGNvc3QsIGRpc2NhcmRSZWRyYXcsIGRpc21pc3MsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBkcmFmdE9wdGlvbnMsIGZhaWxXYXZlLFxuICBtZXJnZURlcGxveWVkLCBtZXJnZUZyb21IYW5kLCBtb3ZlVW5pdCwgbmV3U3RhZ2UsIG5vcm1hbERyYXcsIHN0YWdlV2F2ZXMsIHN1bW1vbiwgc3dhcFNlbGwsIHRha2VEcmFmdCxcbn0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBCYXR0bGUsIGNlbGxQb3MsIEZST05UX1gsIEdSSURfU1AsIHNpbXVsYXRlIH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHR5cGUgeyBCRXZlbnQgfSBmcm9tICcuLi9jb3JlL2JhdHRsZS50cyc7XG5pbXBvcnQgeyBkaWZmaWN1bHR5TmFtZSwgZW5lbXlXYXZlLCBzZXREaWZmaWN1bHR5IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuLi9jb3JlL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgeyBsb2FkU2F2ZSB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5pbXBvcnQgeyBOZWNyb21hbmNlciB9IGZyb20gJy4vbmVjcm9tYW5jZXIudHMnO1xuaW1wb3J0IHsgYXVkaW8gfSBmcm9tICcuL2F1ZGlvLnRzJztcbmltcG9ydCB7IGNsZWFyUnVuLCBsb2FkUnVuLCBzYXZlUnVuLCBzZXJpYWxpemVTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVuc2F2ZS50cyc7XG5pbXBvcnQgeyByZWNvcmRDbGVhckFuZFNhdmUgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB0eXBlIHsgQ2xlYXJSZXdhcmQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB0eXBlIHsgUnVuU25hcHNob3QgfSBmcm9tICcuLi9jb3JlL3J1bnNhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgY3JlYXRlVmlzdWFsLCBpc1RyaXBvLCBsb2FkQXNzZXRzIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB0eXBlIHsgQXNzZXRzLCBVbml0VmlzdWFsIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB7IFVpIH0gZnJvbSAnLi91aS50cyc7XG5cbmV4cG9ydCB0eXBlIFBoYXNlID0gJ2J1aWxkJyB8ICd0cmFuc2l0aW9uJyB8ICdiYXR0bGUnIHwgJ2RyYWZ0JyB8ICd3b24nIHwgJ2xvc3QnO1xudHlwZSBTZWwgPSB7IHR5cGU6ICdjYXJkJzsgaWR4OiBudW1iZXIgfSB8IHsgdHlwZTogJ3VuaXQnOyBpZDogbnVtYmVyIH0gfCBudWxsO1xuXG5leHBvcnQgY2xhc3MgR2FtZSB7XG4gIGVuZ2luZTogYW55OyBzY2VuZTogYW55OyBjYW1lcmE6IGFueTsgQSE6IEFzc2V0czsgdWkhOiBVaTtcbiAgcyE6IFN0YXRlOyBzZWVkID0gMTsgYXR0ZW1wdCA9IDA7IHBoYXNlOiBQaGFzZSA9ICdidWlsZCc7IGJhdHRsZTogQmF0dGxlIHwgbnVsbCA9IG51bGw7IHRpbWVTY2FsZSA9IDE7XG4gIHNlbDogU2VsID0gbnVsbDsgc3dhcE1vZGUgPSBmYWxzZTsgY29uZmlybVJlbW92ZSA9IGZhbHNlOyBkcmFmdDogU291bElkW10gfCBudWxsID0gbnVsbDsgbGFzdEJhdHRsZSA9ICcnO1xuICBwcml2YXRlIHVuaXRWaXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgIC8vIHVuaXQgaWQgLT4gdmlzdWFsICh5b3VyIGFybXksIHBlcnNpc3RzIGJldHdlZW4gd2F2ZXMpXG4gIHByaXZhdGUgdmlzVG9Vbml0ID0gbmV3IE1hcDxVbml0VmlzdWFsLCBudW1iZXI+KCk7XG4gIHByaXZhdGUgZnZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB2aXN1YWwgZHVyaW5nIGEgYmF0dGxlXG4gIHByaXZhdGUgZlVuaXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpOyAgICAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB1bml0IGlkIChwbGF5ZXIgc2lkZSlcbiAgcHJpdmF0ZSBsYXN0U3RhdGUgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpO1xuICBwcml2YXRlIHRpbGVzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbGVNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHJpbmdGeDogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd3M6IGFueVtdID0gW107IHByaXZhdGUgdGltZXJzOiB7IHQ6IG51bWJlcjsgZm46ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgYWNjID0gMDsgcHJpdmF0ZSBjYW1Gcm9tOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVRvOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVQgPSAxOyBwcml2YXRlIGNhbUR1ciA9IDIuMDsgcHJpdmF0ZSByZXN1bHRBdCA9IC0xOyBwcml2YXRlIGhhbmRsZWQgPSBmYWxzZTsgcHJpdmF0ZSBzdGFydFN0ZXBBdCA9IDA7XG4gIHByaXZhdGUgYXJyb3dNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93TWVzaDogYW55W10gPSBbXTtcbiAgbmVjcm8hOiBOZWNyb21hbmNlcjtcbiAgLyoqIFdoYXQgdGhlIGxhc3Qgc3RhZ2UgY2xlYXIgZWFybmVkIChzaG93biBvbiB0aGUgc3RhZ2UtY2xlYXJlZCBzY3JlZW4pLiAqL1xuICByZXdhcmQ6IENsZWFyUmV3YXJkIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2luZSA9IGZhbHNlOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSByZXN1bHQgY3V0c2NlbmUgaXMgcGxheWluZzogdGhlIGJhdHRsZSBjYW1lcmEgYW5kIGZpZ2h0ZXIgc3luYyBzdGFuZCBkb3duXG4gIHByaXZhdGUgdHdlZW5zOiB7IHQ6IG51bWJlcjsgZHVyOiBudW1iZXI7IGZuOiAodTogbnVtYmVyKSA9PiB2b2lkOyBkb25lPzogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSB0d2VlbihkdXI6IG51bWJlciwgZm46ICh1OiBudW1iZXIpID0+IHZvaWQsIGRvbmU/OiAoKSA9PiB2b2lkKSB7IHRoaXMudHdlZW5zLnB1c2goeyB0OiAwLCBkdXIsIGZuLCBkb25lIH0pOyB9XG4gIC8qKiBGaW5pc2ggZXZlcnkgcnVubmluZyBhbmltYXRpb24gYXQgb25jZSAoc28gbm90aGluZyBpcyBsZWZ0IGhhbGYtd2F5IG9yIHVuZGlzcG9zZWQgd2hlbiB0aGUgcGhhc2UgY2hhbmdlcykuICovXG4gIHByaXZhdGUgZmx1c2hUd2VlbnMoKSB7IGZvciAoY29uc3QgdyBvZiB0aGlzLnR3ZWVucy5zcGxpY2UoMCkpIHsgdy5mbigxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICBwcml2YXRlIHNlZW5NZXJnZXMgPSAwO1xuXG4gIGFzeW5jIGluaXQoY2FudmFzOiBIVE1MQ2FudmFzRWxlbWVudCkge1xuICAgIGNvbnN0IHFzID0gbmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpO1xuICAgIHRoaXMuZW5naW5lID0gbmV3IEJBQllMT04uRW5naW5lKGNhbnZhcywgdHJ1ZSwgeyBhbnRpYWxpYXM6IHRydWUsIHBvd2VyUHJlZmVyZW5jZTogJ2hpZ2gtcGVyZm9ybWFuY2UnIH0pO1xuICAgIGNvbnN0IGRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7IHRoaXMuZW5naW5lLnNldEhhcmR3YXJlU2NhbGluZ0xldmVsKDEgLyBNYXRoLm1pbihkcHIsIDEuNSkpO1xuICAgIGNvbnN0IHNjZW5lID0gdGhpcy5zY2VuZSA9IG5ldyBCQUJZTE9OLlNjZW5lKHRoaXMuZW5naW5lKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjA5LCAwLjA3LCAwLjEzLCAxKTtcbiAgICBjb25zdCBoZW1pID0gbmV3IEJBQllMT04uSGVtaXNwaGVyaWNMaWdodCgnaCcsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAxLCAwLjMpLCBzY2VuZSk7IGhlbWkuaW50ZW5zaXR5ID0gMS4wNTsgaGVtaS5ncm91bmRDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjMyLCAwLjI2LCAwLjQyKTtcbiAgICBjb25zdCBzdW4gPSBuZXcgQkFCWUxPTi5EaXJlY3Rpb25hbExpZ2h0KCdzJywgbmV3IEJBQllMT04uVmVjdG9yMygtMC40LCAtMSwgMC41NSksIHNjZW5lKTsgc3VuLmludGVuc2l0eSA9IDAuODU7XG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgQkFCWUxPTi5GcmVlQ2FtZXJhKCdjYW0nLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDgsIC05KSwgc2NlbmUpOyB0aGlzLmNhbWVyYS5taW5aID0gMC4xOyB0aGlzLmNhbWVyYS5tYXhaID0gMjAwOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg7IHRoaXMuY2FtZXJhLmlucHV0cy5jbGVhcigpO1xuXG4gICAgY29uc3QgZ3JvdW5kID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ2dyb3VuZCcsIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQwIH0sIHNjZW5lKTtcbiAgICBjb25zdCBnbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2dtJywgc2NlbmUpOyBnbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xNywgMC4xNSwgMC4yMSk7IGdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBncm91bmQubWF0ZXJpYWwgPSBnbTsgZ3JvdW5kLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHRlYW0gb2YgWzAsIDFdIGFzIGNvbnN0KSBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBjb25zdCB0ID0gdGhpcy5tYWtlVGlsZSh0ZWFtLCBjKTsgaWYgKHRlYW0gPT09IDApIHRoaXMudGlsZXMucHVzaCh0KTsgZWxzZSB0LnNldEVuYWJsZWQoZmFsc2UpOyB9XG5cbiAgICB0aGlzLkEgPSBhd2FpdCBsb2FkQXNzZXRzKHNjZW5lKTtcbiAgICB0aGlzLm5lY3JvID0gbmV3IE5lY3JvbWFuY2VyKHNjZW5lLCB0aGlzLkEuc29mdCk7ICAgICAgIC8vIHN0YW5kcyBqdXN0IGJlaGluZCBoaXMgYXJteSdzIGJhY2sgY29sdW1uLCBmYWNpbmcgdGhlIGJhdHRsZWZpZWxkXG4gICAgdGhpcy5uZWNyby5ob2xkZXIucG9zaXRpb24uc2V0KC0oRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC0gMS4wNSwgMCwgMCk7IHRoaXMubmVjcm8uaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjtcbiAgICB0aGlzLmFycm93TWF0cyA9IFswLCAxXS5tYXAoKHQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2FtJyArIHQsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMywgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC43LCAwLjI1KTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyByZXR1cm4gbTsgfSk7XG4gICAgdGhpcy51aSA9IG5ldyBVaSh0aGlzKTsgdGhpcy5zZWVkID0gKyhxcy5nZXQoJ3NlZWQnKSB8fCAxKTsgaWYgKHFzLmdldCgnZnBzJykpIHRoaXMuc2V0U2hvd0Zwcyh0cnVlKTtcblxuICAgIC8vIFRhcHMgYXJlIGRldGVjdGVkIGhlcmUgKG5vdCB0aHJvdWdoIEJhYnlsb24pIHNvIHRoZXkgYmVoYXZlIHRoZSBzYW1lIGluIFNhZmFyaSwgdGhlIGhvbWUtc2NyZWVuIGFwcCBhbmQgb24gZGVza3RvcC5cbiAgICBsZXQgZG93bjogeyB4OiBudW1iZXI7IHk6IG51bWJlcjsgdDogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBsb2NhbCA9IChlOiBQb2ludGVyRXZlbnQpID0+IHsgY29uc3QgciA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsgcmV0dXJuIHsgeDogZS5jbGllbnRYIC0gci5sZWZ0LCB5OiBlLmNsaWVudFkgLSByLnRvcCB9OyB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyZG93bicsIChlKSA9PiB7IGRvd24gPSB7IC4uLmxvY2FsKGUpLCB0OiBwZXJmb3JtYW5jZS5ub3coKSB9OyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcnVwJywgKGUpID0+IHsgaWYgKCFkb3duKSByZXR1cm47IGNvbnN0IHAgPSBsb2NhbChlKTsgY29uc3QgbW92ZWQgPSBNYXRoLmh5cG90KHAueCAtIGRvd24ueCwgcC55IC0gZG93bi55KSwgZHQgPSBwZXJmb3JtYW5jZS5ub3coKSAtIGRvd24udDsgZG93biA9IG51bGw7IGlmIChtb3ZlZCA8IDE2ICYmIGR0IDwgOTAwKSB0aGlzLnRhcChwLngsIHAueSk7IH0pO1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyY2FuY2VsJywgKCkgPT4geyBkb3duID0gbnVsbDsgfSk7XG4gICAgdGhpcy5jYW52YXMgPSBjYW52YXM7IGNvbnN0IG9uUmVzaXplID0gKCkgPT4gdGhpcy5oYW5kbGVSZXNpemUoKTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpOyB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignb3JpZW50YXRpb25jaGFuZ2UnLCAoKSA9PiBzZXRUaW1lb3V0KG9uUmVzaXplLCAyNTApKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0KSAod2luZG93IGFzIGFueSkudmlzdWFsVmlld3BvcnQuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpO1xuICAgIGlmICgod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIpIG5ldyAod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIob25SZXNpemUpLm9ic2VydmUoY2FudmFzKTtcbiAgICBpZiAocXMuZ2V0KCdnYWxsZXJ5JykpIHsgdGhpcy5nYWxsZXJ5KCk7IHJldHVybjsgfVxuICAgIGNvbnN0IHNhdmVkID0gcXMuZ2V0KCdzZWVkJykgPyBudWxsIDogbG9hZFJ1bigpOyAgICAgICAgICAgICAgICAvLyA/c2VlZD1OIGFsd2F5cyBzdGFydHMgZnJlc2ggKGRlYnVnZ2luZyk7IG90aGVyd2lzZSBwaWNrIHVwIHdoZXJlIHRoZSBsYXN0IHZpc2l0IGxlZnQgb2ZmXG4gICAgaWYgKHNhdmVkKSB0aGlzLnJlc3RvcmUoc2F2ZWQpOyBlbHNlIHRoaXMuc3RhcnRTdGFnZSh0aGlzLnNlZWQpO1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG5vdyA9IHBlcmZvcm1hbmNlLm5vdygpLCByYXcgPSBub3cgLSBsYXN0OyBjb25zdCBkdCA9IE1hdGgubWluKDAuMDUsIHJhdyAvIDEwMDApOyBsYXN0ID0gbm93OyBpZiAoIXRoaXMuYWN0aXZlKSByZXR1cm47IGlmICghdGhpcy5mcm96ZW4pIHRoaXMuZnJhbWUoZHQpOyBzY2VuZS5yZW5kZXIoKTsgdGhpcy5wZXJmVGljayhyYXcpOyB9KTtcbiAgfVxuICAvKiogVGhlIG5hdmlnYXRpb24gc2hlbGwgaGlkZXMgdGhlIGJhdHRsZSBzY3JlZW4gd2hpbGUgYW5vdGhlciB0YWIgaXMgb3BlbjogcGF1c2UgdGhlIGdhbWUgc28gaXQgY29zdHMgbm90aGluZy4gKi9cbiAgcHJpdmF0ZSBhY3RpdmUgPSB0cnVlO1xuICAvKiogRGVidWc6IGtlZXAgZHJhd2luZyBidXQgc3RvcCBhZHZhbmNpbmcgdGltZSwgc28gYSBtb21lbnQgY2FuIGJlIHN0ZXBwZWQgdGhyb3VnaCB3aXRoIGZyYW1lKGR0KSBhbmQgc2NyZWVuc2hvdHRlZC4gKi9cbiAgZnJvemVuID0gZmFsc2U7XG4gIHN0ZXAoZHQ6IG51bWJlcikgeyB0aGlzLmZyYW1lKGR0KTsgfVxuICBzZXRBY3RpdmUob246IGJvb2xlYW4pIHsgdGhpcy5hY3RpdmUgPSBvbjsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNjZW5lIGhlbHBlcnNcbiAgcHJpdmF0ZSBtYWtlVGlsZSh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCksIHQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCd0aWxlJyArIGNlbGwsIHsgc2l6ZTogR1JJRF9TUCAqIDAuOTIgfSwgdGhpcy5zY2VuZSk7XG4gICAgdC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHQucG9zaXRpb24uc2V0KHAueCwgMC4wMTUsIHAueik7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3RtJywgdGhpcy5zY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjEyLCAwLjQyKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQyLCAwLjEyLCAwLjEyKTsgbS5hbHBoYSA9IDAuNTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB0Lm1hdGVyaWFsID0gbTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyB0Lm1ldGFkYXRhID0geyBraW5kOiAndGlsZScsIGNlbGwgfTsgdGhpcy50aWxlTWF0c1tjZWxsXSA9IG07IH0gZWxzZSB0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICByZXR1cm4gdDtcbiAgfVxuICBwcml2YXRlIHRpbnQoY2VsbDogbnVtYmVyLCBtb2RlOiAnbm9ybWFsJyB8ICdmcmVlJyB8ICdzZWwnIHwgJ3BhcnRuZXInKSB7XG4gICAgY29uc3QgbSA9IHRoaXMudGlsZU1hdHNbY2VsbF07IGNvbnN0IGMgPSB7IG5vcm1hbDogWzAuMTgsIDAuMTIsIDAuNDIsIDAuNV0sIGZyZWU6IFswLjIsIDAuNzUsIDAuNTUsIDAuN10sIHNlbDogWzEsIDAuODIsIDAuMywgMC44NV0sIHBhcnRuZXI6IFswLjg1LCAwLjM1LCAxLCAwLjg1XSB9W21vZGVdO1xuICAgIG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhjWzBdLCBjWzFdLCBjWzJdKTsgbS5hbHBoYSA9IGNbM107XG4gIH1cbiAgbGF0ZXIoc2VjOiBudW1iZXIsIGZuOiAoKSA9PiB2b2lkKSB7IHRoaXMudGltZXJzLnB1c2goeyB0OiBzZWMsIGZuIH0pOyB9XG4gIHByaXZhdGUgZnhSaW5nKHg6IG51bWJlciwgejogbnVtYmVyLCBjb2xvcjogYW55LCByMDogbnVtYmVyLCByMTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdmeCcsIHsgZGlhbWV0ZXI6IDEsIHRoaWNrbmVzczogMC4wMzUsIHRlc3NlbGxhdGlvbjogMjggfSwgdGhpcy5zY2VuZSk7IG0ucG9zaXRpb24uc2V0KHgsIDAuMDUsIHopOyBtLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBtbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2Z4bScsIHRoaXMuc2NlbmUpOyBtbS5lbWlzc2l2ZUNvbG9yID0gY29sb3I7IG1tLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG1tLmFscGhhID0gMC45OyBtLm1hdGVyaWFsID0gbW07IHRoaXMucmluZ0Z4LnB1c2goeyBtLCBtbSwgdDogMCwgcjAsIHIxLCBkdXIgfSk7XG4gIH1cbiAgcHJpdmF0ZSBidXJzdCh4OiBudW1iZXIsIHo6IG51bWJlciwgYzE6IG51bWJlcltdLCBjMjogbnVtYmVyW10sIGNvdW50OiBudW1iZXIpIHtcbiAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdiJywgNjAsIHRoaXMuc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoeCwgMC4wNSwgeik7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIDAuMDUsIDAuMik7XG4gICAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMSBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMyIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjEsIDAsIDAuMiwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMTI7IHBzLm1heFNpemUgPSAwLjM0OyBwcy5taW5MaWZlVGltZSA9IDAuNDsgcHMubWF4TGlmZVRpbWUgPSAwLjk7IHBzLmVtaXRSYXRlID0gMDsgcHMubWFudWFsRW1pdENvdW50ID0gY291bnQ7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLCAxLjMsIC0xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMSwgMi40LCAxKTtcbiAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjg7IHBzLm1heEVtaXRQb3dlciA9IDI7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIC0yLCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy50YXJnZXRTdG9wRHVyYXRpb24gPSAxLjI7IHBzLmRpc3Bvc2VPblN0b3AgPSB0cnVlOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gY2FtZXJhXG4gIHByaXZhdGUgcG9zZXMoKSB7XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3QgaGFsZiA9IEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQICsgMS40O1xuICAgIGNvbnN0IGQgPSBNYXRoLm1heChoYWxmIC8gKHRhblYgKiBhc3ApLCAoKEdSSURfUk9XUyAqIEdSSURfU1ApIC8gMiArIDIpIC8gKHRhblYgKiAwLjU1KSwgOCk7XG4gICAgY29uc3QgYmF0dGxlID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMSAqIGQsIDAuNDIgKiBkICsgMC41LCAtMC44NiAqIGQpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC4zNSwgMCkgfTtcbiAgICAvLyBCdWlsZCB2aWV3OiAoYWxtb3N0KSBzdHJhaWdodCBkb3duLCB3aXRoIHRoZSB3aG9sZSBncmlkIGluc2lkZSB0aGUgYmFuZCBiZXR3ZWVuIHRoZSB0b3AgYmFyIGFuZCB0aGUgaGFuZCBvZiBjYXJkcy5cbiAgICBjb25zdCBjeCA9IC0oRlJPTlRfWCArICgoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAvIDIpLCBIID0gTWF0aC5tYXgoMSwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KTtcbiAgICBjb25zdCBib3ggPSAoaWQ6IHN0cmluZykgPT4geyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsgcmV0dXJuIGVsICYmIGVsLm9mZnNldFBhcmVudCAhPT0gbnVsbCA/IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpIDogbnVsbDsgfTtcbiAgICBjb25zdCB0b3BCYXIgPSBib3goJ3RvcCcpLCBoYW5kID0gYm94KCdoYW5kJyksIGluZm8gPSBib3goJ2luZm8nKTtcbiAgICBjb25zdCBUT1AgPSBNYXRoLm1pbigwLjMyLCB0b3BCYXIgPyAodG9wQmFyLmJvdHRvbSArIDYpIC8gSCA6IDAuMSk7XG4gICAgY29uc3QgQk9UVE9NID0gTWF0aC5taW4oMC41LCAoSCAtIE1hdGgubWluKGhhbmQgPyBoYW5kLnRvcCA6IEgsIGluZm8gPyBpbmZvLnRvcCA6IEgpICsgNikgLyBIKTtcbiAgICBjb25zdCBiYW5kID0gTWF0aC5tYXgoMC4zLCAxIC0gVE9QIC0gQk9UVE9NKSwgY2VudGVyRnJhYyA9IFRPUCArIGJhbmQgLyAyOyAgICAgICAgICAvLyB0aGUgZ3JpZCdzIGNlbnRyZSBhcHBlYXJzIGF0IHRoaXMgZnJhY3Rpb24gZnJvbSB0aGUgdG9wXG4gICAgY29uc3QgZ3cgPSBHUklEX0NPTFMgKiBHUklEX1NQICsgMy4yLCBnaCA9IEdSSURfUk9XUyAqIEdSSURfU1AgKyAwLjU7ICAgICAgICAgICAgICAgIC8vIHRoZSB3aWR0aCBhbHNvIGxlYXZlcyByb29tIGZvciB0aGUgTmVjcm9tYW5jZXIgYmVzaWRlIHRoZSBncmlkXG4gICAgY29uc3QgZDIgPSBNYXRoLm1heChnaCAvICgyICogdGFuViAqIGJhbmQpLCBndyAvICgyICogdGFuViAqIGFzcCAqIDAuODgpLCA0LjUpO1xuICAgIGNvbnN0IHNoaWZ0ID0gKDAuNSAtIGNlbnRlckZyYWMpICogMiAqIGQyICogdGFuViwgYnggPSBjeCAtIDAuNjtcbiAgICBjb25zdCBidWlsZCA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCBkMiwgLXNoaWZ0IC0gMC4xICogZDIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIDAsIC1zaGlmdCkgfTtcbiAgICBjb25zdCBuZWNybyA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJhdHRsZS5wb3MueCAtIDEuNCwgYmF0dGxlLnBvcy55ICogMS4xMiwgYmF0dGxlLnBvcy56ICogMS4xMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygtMS40LCAwLjM1LCAwKSB9OyAgIC8vIHJlc3VsdCBjdXRzY2VuZXM6IGhpbSBhbmQgdGhlIGZpZWxkXG4gICAgcmV0dXJuIHsgYmF0dGxlLCBidWlsZCwgbmVjcm8gfTtcbiAgfVxuICAvKiogVGhlIGhhbmQgLyBpbmZvIGJhciBjYW4gY2hhbmdlIHNpemUgaW4gdGhlIGJ1aWxkIHBoYXNlIChsb25nIGFiaWxpdHkgdGV4dCwgbW9yZSBjYXJkcyk6IHJlLWZyYW1lIHNvIHRoZSBncmlkIG5ldmVyIGhpZGVzIGJlaGluZCBpdC4gKi9cbiAgcmVmcmFtZUJ1aWxkKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8IHRoaXMuY2FtVCA8IDEgfHwgdGhpcy5jaW5lIHx8ICF0aGlzLmNhbnZhcykgcmV0dXJuO1xuICAgIGNvbnN0IHAgPSB0aGlzLnBvc2VzKCkuYnVpbGQsIGMgPSB0aGlzLmNhbWVyYS5wb3NpdGlvbjtcbiAgICBpZiAoIWlzRmluaXRlKHAucG9zLngpIHx8IEJBQllMT04uVmVjdG9yMy5EaXN0YW5jZShjLCBwLnBvcykgPCAwLjA2KSByZXR1cm47XG4gICAgdGhpcy50d2VlbkNhbShwLCAwLjM1KTtcbiAgfVxuICBwcml2YXRlIGNhbnZhcyE6IEhUTUxDYW52YXNFbGVtZW50OyBwcml2YXRlIGxhc3RXID0gMDsgcHJpdmF0ZSBsYXN0SCA9IDA7IGxhc3RUYXBJbmZvID0gJyhubyB0YXBzIHlldCknO1xuICBwcml2YXRlIGhhbmRsZVJlc2l6ZSgpIHtcbiAgICBpZiAoIXRoaXMuY2FudmFzLmNsaWVudFdpZHRoIHx8ICF0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpIHJldHVybjsgICAvLyBoaWRkZW4gYmVoaW5kIGFub3RoZXIgdGFiXG4gICAgdGhpcy5lbmdpbmUucmVzaXplKCk7IHRoaXMubGFzdFcgPSB0aGlzLmNhbnZhcy5jbGllbnRXaWR0aDsgdGhpcy5sYXN0SCA9IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyAmJiB0aGlzLmNhbVQgPj0gMSkgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgfVxuICAvKiogQSB0YXAgb24gdGhlIDNEIHZpZXc6IHBpY2sgYSB0aWxlIG9yIGEgdW5pdC4gKi9cbiAgcHJpdmF0ZSB0YXAoeDogbnVtYmVyLCB5OiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gdGhpcy5zY2VuZS5waWNrKHgsIHksIChtOiBhbnkpID0+ICEhKG0ubWV0YWRhdGEgJiYgbS5tZXRhZGF0YS5raW5kKSk7XG4gICAgY29uc3QgbWQgPSBwICYmIHAuaGl0ID8gcC5waWNrZWRNZXNoLm1ldGFkYXRhIDogbnVsbDtcbiAgICB0aGlzLmxhc3RUYXBJbmZvID0gYHRhcCAke01hdGgucm91bmQoeCl9LCR7TWF0aC5yb3VuZCh5KX0gb2YgJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IC0+ICR7bWQgPyAobWQua2luZCA9PT0gJ3RpbGUnID8gJ3RpbGUgJyArIG1kLmNlbGwgOiAndW5pdCcpIDogJ25vdGhpbmcnfSAocGhhc2UgJHt0aGlzLnBoYXNlfSlgO1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICFtZCkgcmV0dXJuO1xuICAgIGlmIChtZC5raW5kID09PSAndGlsZScpIHRoaXMub25UaWxlKG1kLmNlbGwpOyBlbHNlIGlmIChtZC5raW5kID09PSAndW5pdCcpIHRoaXMub25Vbml0VmlzdWFsKG1kLnZpc3VhbCk7XG4gIH1cbiAgcHJpdmF0ZSBzZXRDYW0ocDogYW55KSB7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNvcHlGcm9tKHAucG9zKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHAudGd0LmNsb25lKCkpOyB9XG4gIHByaXZhdGUgdHdlZW5DYW0odG86IGFueSwgZHVyOiBudW1iZXIpIHsgdGhpcy5jYW1Gcm9tID0geyBwb3M6IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNsb25lKCksIHRndDogdGhpcy5jYW1lcmEuZ2V0VGFyZ2V0KCkuY2xvbmUoKSB9OyB0aGlzLmNhbVRvID0gdG87IHRoaXMuY2FtVCA9IDA7IHRoaXMuY2FtRHVyID0gZHVyOyB9XG5cbiAgLy8gLS0tLSBiYXR0bGUgY2FtZXJhOiBmb2xsb3dzIHRoZSBmaWdodGVycyB0aGF0IGFyZSBzdGlsbCBhbGl2ZSwgc28gdGhlIGFjdGlvbiAoYW5kIHRoZSBwdXJwbGUgZXllcykgc3RheXMgbGFyZ2Ugb24gc2NyZWVuXG4gIGNhbU1vZGU6ICdjbG9zZScgfCAnd2lkZScgPSAnY2xvc2UnOyBwcml2YXRlIGNhbVRndDogYW55ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIDApO1xuICBzZXRDYW1Nb2RlKG06ICdjbG9zZScgfCAnd2lkZScpIHtcbiAgICB0aGlzLmNhbU1vZGUgPSBtO1xuICAgIGlmIChtID09PSAnd2lkZScgJiYgdGhpcy5iYXR0bGUpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMC45KTtcbiAgICB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgZnJhbWVCYXR0bGUoZHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTsgaWYgKCFiKSByZXR1cm47IGNvbnN0IGFsaXZlID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAoIWFsaXZlLmxlbmd0aCkgcmV0dXJuO1xuICAgIGxldCB4MCA9IDFlOSwgeDEgPSAtMWU5LCB6MCA9IDFlOSwgejEgPSAtMWU5OyBmb3IgKGNvbnN0IGYgb2YgYWxpdmUpIHsgeDAgPSBNYXRoLm1pbih4MCwgZi54KTsgeDEgPSBNYXRoLm1heCh4MSwgZi54KTsgejAgPSBNYXRoLm1pbih6MCwgZi56KTsgejEgPSBNYXRoLm1heCh6MSwgZi56KTsgfVxuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IHdpZGUgPSB0aGlzLnBvc2VzKCkuYmF0dGxlLCBjeCA9ICh4MCArIHgxKSAvIDIsIGN6ID0gKHowICsgejEpIC8gMjtcbiAgICBjb25zdCBkID0gTWF0aC5taW4oTWF0aC5tYXgoKHgxIC0geDAgKyAzLjQpIC8gKDIgKiB0YW5WICogYXNwICogMC45KSwgKHoxIC0gejAgKyAzLjIpIC8gKDIgKiB0YW5WICogMC42MiksIDUuNCksIE1hdGguaHlwb3Qod2lkZS5wb3MueSwgd2lkZS5wb3MueikpO1xuICAgIGNvbnN0IHRndCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3gsIDAuNTUsIGN6KSwgcG9zID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCAtIDAuMDYgKiBkLCAwLjMyICogZCArIDAuNSwgY3ogLSAwLjkgKiBkKTtcbiAgICBjb25zdCBrID0gMSAtIE1hdGguZXhwKC1kdCAqIDIuMCk7XG4gICAgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbWVyYS5wb3NpdGlvbiwgcG9zLCBrKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbVRndCwgdGd0LCBrKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhZ2UgZmxvd1xuICAvKiogV3JpdGUgdGhlIHJ1biB0byBkaXNrIChjYWxtIG1vbWVudHMgb25seTogYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0KS4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0UnVuKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMpIHJldHVybjtcbiAgICAgIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgeyBjbGVhclJ1bigpOyByZXR1cm47IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnICYmIHRoaXMucGhhc2UgIT09ICdkcmFmdCcpIHJldHVybjtcbiAgICAgIGNvbnN0IHNuYXA6IFJ1blNuYXBzaG90ID0geyB2OiAxLCBzZWVkOiB0aGlzLnNlZWQsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUsIHBoYXNlOiB0aGlzLnBoYXNlLCBkcmFmdDogdGhpcy5waGFzZSA9PT0gJ2RyYWZ0JyA/IHRoaXMuZHJhZnQgOiBudWxsLCBzdGF0ZTogc2VyaWFsaXplU3RhdGUocykgfTtcbiAgICAgIHNhdmVSdW4oc25hcCk7XG4gICAgfSBjYXRjaCB7IC8qIG5ldmVyIGxldCBzYXZpbmcgYnJlYWsgdGhlIGdhbWUgKi8gfVxuICB9XG4gIC8qKiBSZWJ1aWxkIHRoZSBzY3JlZW4gZnJvbSBhIHNhdmVkIHJ1biAoYSByZWxvYWQsIG9yIFNhZmFyaSBkaXNjYXJkaW5nIHRoZSBwYWdlKS4gKi9cbiAgcHJpdmF0ZSByZXN0b3JlKHI6IHsgc25hcDogUnVuU25hcHNob3Q7IHN0YXRlOiBTdGF0ZSB9KSB7XG4gICAgY29uc3QgeyBzbmFwLCBzdGF0ZSB9ID0gcjtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5mbHVzaFR3ZWVucygpOyB0aGlzLm5lY3JvLnJldml2ZSgpOyBzZXREaWZmaWN1bHR5KHNuYXAuZGlmZmljdWx0eSk7XG4gICAgdGhpcy5zZWVkID0gc25hcC5zZWVkOyB0aGlzLmF0dGVtcHQgPSBzbmFwLmF0dGVtcHQ7IHRoaXMucyA9IHN0YXRlOyB0aGlzLnNlZW5NZXJnZXMgPSBzdGF0ZS5zdGF0cy5tZXJnZXM7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gc25hcC5waGFzZSA9PT0gJ2RyYWZ0JyA/IHNuYXAuZHJhZnQgOiBudWxsOyB0aGlzLnBoYXNlID0gdGhpcy5kcmFmdCA/ICdkcmFmdCcgOiAnYnVpbGQnO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7IHRoaXMudG9hc3QoYFJ1biByZXN0b3JlZDogd2F2ZSAke3N0YXRlLndhdmV9LyR7c3RhZ2VXYXZlcyhzdGF0ZSl9LCAke3N0YXRlLmhlYXJ0c30gaGVhcnQke3N0YXRlLmhlYXJ0cyA9PT0gMSA/ICcnIDogJ3MnfS5gKTtcbiAgfVxuXG4gIC8vIC0tLS0gcGVyZm9ybWFuY2UgcmVhZG91dDogcm9sbGluZyBmcmFtZSBzdGF0cywgcGVyLWJhdHRsZSBzdW1tYXJpZXMsIG9wdGlvbmFsIG9uLXNjcmVlbiBGUFMsIGFuZCBhIHBhc3RlLWZyaWVuZGx5IHJlcG9ydFxuICBzaG93RnBzID0gZmFsc2U7IHBlcmZOb3cgPSB7IGZwczogMCwgYXZnOiAwLCBwOTU6IDAsIHdvcnN0OiAwIH07IHBlcmZMb2c6IGFueVtdID0gW107XG4gIHByaXZhdGUgcGVyZkJ1ZiA9IG5ldyBGbG9hdDMyQXJyYXkoMjQwKTsgcHJpdmF0ZSBwZXJmTiA9IDA7IHByaXZhdGUgcGVyZkkgPSAwOyBwcml2YXRlIHBlcmZTaG93bkF0ID0gMDsgcHJpdmF0ZSBpbnN0cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBmcHNIdWQ6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY3VyQmF0dGxlOiB7IGZyYW1lczogbnVtYmVyOyBzdW06IG51bWJlcjsgd29yc3Q6IG51bWJlcjsgc2xvdzogbnVtYmVyOyBzY2FsZTogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgc2V0U2hvd0ZwcyhvbjogYm9vbGVhbikge1xuICAgIHRoaXMuc2hvd0ZwcyA9IG9uO1xuICAgIGlmIChvbiAmJiAhdGhpcy5mcHNIdWQpIHsgY29uc3QgaCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBoLmlkID0gJ2Zwc0h1ZCc7IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYmF0dGxlSG9zdCcpIHx8IGRvY3VtZW50LmJvZHkpLmFwcGVuZENoaWxkKGgpOyB0aGlzLmZwc0h1ZCA9IGg7IH1cbiAgICBpZiAodGhpcy5mcHNIdWQpIHRoaXMuZnBzSHVkLnN0eWxlLmRpc3BsYXkgPSBvbiA/ICdibG9jaycgOiAnbm9uZSc7XG4gIH1cbiAgcHJpdmF0ZSBwZXJmVGljayhtczogbnVtYmVyKSB7XG4gICAgaWYgKG1zID4gNTAwKSByZXR1cm47ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSB0YWIgd2FzIGhpZGRlbiBvciB0aGUgcGhvbmUgcGF1c2VkIHVzOiBub3QgYSByZWFsIGZyYW1lXG4gICAgdGhpcy5wZXJmQnVmW3RoaXMucGVyZkldID0gbXM7IHRoaXMucGVyZkkgPSAodGhpcy5wZXJmSSArIDEpICUgdGhpcy5wZXJmQnVmLmxlbmd0aDsgdGhpcy5wZXJmTiA9IE1hdGgubWluKHRoaXMucGVyZkJ1Zi5sZW5ndGgsIHRoaXMucGVyZk4gKyAxKTtcbiAgICBjb25zdCBjID0gdGhpcy5jdXJCYXR0bGU7XG4gICAgaWYgKGMgJiYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykpIHsgYy5mcmFtZXMrKzsgYy5zdW0gKz0gbXM7IGlmIChtcyA+IGMud29yc3QpIGMud29yc3QgPSBtczsgaWYgKG1zID4gMzMuNCkgYy5zbG93Kys7IGMuc2NhbGUgPSBNYXRoLm1heChjLnNjYWxlLCB0aGlzLnRpbWVTY2FsZSk7IH1cbiAgICBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKTsgaWYgKG5vdyAtIHRoaXMucGVyZlNob3duQXQgPCA1MDApIHJldHVybjsgdGhpcy5wZXJmU2hvd25BdCA9IG5vdztcbiAgICBjb25zdCBhID0gQXJyYXkuZnJvbSh0aGlzLnBlcmZCdWYuc3ViYXJyYXkoMCwgdGhpcy5wZXJmTikpLnNvcnQoKHgsIHkpID0+IHggLSB5KSwgYXZnID0gYS5yZWR1Y2UoKG4sIHgpID0+IG4gKyB4LCAwKSAvIGEubGVuZ3RoO1xuICAgIHRoaXMucGVyZk5vdyA9IHsgZnBzOiAxMDAwIC8gYXZnLCBhdmcsIHA5NTogYVtNYXRoLmZsb29yKGEubGVuZ3RoICogMC45NSldID8/IDAsIHdvcnN0OiBhW2EubGVuZ3RoIC0gMV0gPz8gMCB9O1xuICAgIGlmICh0aGlzLmZwc0h1ZCAmJiB0aGlzLnNob3dGcHMpIHRoaXMuZnBzSHVkLnRleHRDb250ZW50ID0gYCR7dGhpcy5wZXJmTm93LmZwcy50b0ZpeGVkKDApfSBmcHMgICR7dGhpcy5wZXJmTm93LmF2Zy50b0ZpeGVkKDEpfW1zICBzbG93NSUgJHt0aGlzLnBlcmZOb3cucDk1LnRvRml4ZWQoMCl9bXNgO1xuICAgIHRoaXMudWkucmVuZGVyRGVidWdMaXZlKCk7XG4gIH1cbiAgcHJpdmF0ZSBiZWdpbkJhdHRsZVBlcmYoKSB7IHRoaXMuY3VyQmF0dGxlID0geyBmcmFtZXM6IDAsIHN1bTogMCwgd29yc3Q6IDAsIHNsb3c6IDAsIHNjYWxlOiB0aGlzLnRpbWVTY2FsZSB9OyB9XG4gIHByaXZhdGUgZW5kQmF0dGxlUGVyZigpIHtcbiAgICBjb25zdCBjID0gdGhpcy5jdXJCYXR0bGU7IHRoaXMuY3VyQmF0dGxlID0gbnVsbDsgaWYgKCFjIHx8ICFjLmZyYW1lcykgcmV0dXJuO1xuICAgIHRoaXMucGVyZkxvZy5wdXNoKHsgd2F2ZTogdGhpcy5zLndhdmUsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgc3BlZWQ6IGMuc2NhbGUsIGZpZ2h0ZXJzOiB0aGlzLmJhdHRsZSA/IHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmxlbmd0aCA6IDAsIGZwczogKygxMDAwIC8gKGMuc3VtIC8gYy5mcmFtZXMpKS50b0ZpeGVkKDApLCB3b3JzdE1zOiArYy53b3JzdC50b0ZpeGVkKDApLCBzbG93UGN0OiArKCgxMDAgKiBjLnNsb3cpIC8gYy5mcmFtZXMpLnRvRml4ZWQoMSkgfSk7XG4gICAgaWYgKHRoaXMucGVyZkxvZy5sZW5ndGggPiAxMikgdGhpcy5wZXJmTG9nLnNoaWZ0KCk7XG4gIH1cbiAgcGVyZkluZm8oKSB7XG4gICAgY29uc3Qgc2MgPSB0aGlzLnNjZW5lOyBpZiAoIXRoaXMuaW5zdHIgJiYgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbikgdGhpcy5pbnN0ciA9IG5ldyBCQUJZTE9OLlNjZW5lSW5zdHJ1bWVudGF0aW9uKHNjKTtcbiAgICByZXR1cm4geyAuLi50aGlzLnBlcmZOb3csIG1lc2hlczogc2MuZ2V0QWN0aXZlTWVzaGVzKCkubGVuZ3RoLCBwYXJ0aWNsZXM6IHNjLnBhcnRpY2xlU3lzdGVtcy5sZW5ndGgsIGRyYXdzOiB0aGlzLmluc3RyID8gdGhpcy5pbnN0ci5kcmF3Q2FsbHNDb3VudGVyLmN1cnJlbnQgOiAtMSB9O1xuICB9XG4gIHBlcmZSZXBvcnQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBwID0gdGhpcy5wZXJmSW5mbygpLCBnbDogYW55ID0gdGhpcy5lbmdpbmUuZ2V0R2xJbmZvID8gdGhpcy5lbmdpbmUuZ2V0R2xJbmZvKCkgOiB7fTtcbiAgICBjb25zdCByb3dzID0gdGhpcy5wZXJmTG9nLm1hcCgocikgPT4gYCAgd2F2ZSAke3Iud2F2ZX0gdHJ5ICR7ci5hdHRlbXB0fSBhdCAke3Iuc3BlZWR9eDogJHtyLmZwc30gZnBzIGF2ZXJhZ2UsIHdvcnN0IGZyYW1lICR7ci53b3JzdE1zfW1zLCAke3Iuc2xvd1BjdH0lIHNsb3cgZnJhbWVzLCAke3IuZmlnaHRlcnN9IGZpZ2h0ZXJzYCk7XG4gICAgcmV0dXJuIFtgUEVSRiAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1gLCBgZGV2aWNlOiAke25hdmlnYXRvci51c2VyQWdlbnR9YCwgYGdwdTogJHtnbC5yZW5kZXJlciB8fCAnPyd9ICgke2dsLnZlbmRvciB8fCAnPyd9KWAsXG4gICAgICBgc2NyZWVuICR7c2NyZWVuLndpZHRofXgke3NjcmVlbi5oZWlnaHR9ICB2aWV3cG9ydCAke2lubmVyV2lkdGh9eCR7aW5uZXJIZWlnaHR9ICBkcHIgJHtkZXZpY2VQaXhlbFJhdGlvfSAgcmVuZGVyICR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKX14JHt0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKX0gIHNjYWxpbmcgbGV2ZWwgJHt0aGlzLmVuZ2luZS5nZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgpLnRvRml4ZWQoMil9YCxcbiAgICAgIGBub3c6ICR7cC5mcHMudG9GaXhlZCgwKX0gZnBzLCBhdmVyYWdlICR7cC5hdmcudG9GaXhlZCgxKX1tcywgc2xvd2VzdCA1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMsIHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIHwgYWN0aXZlIG1lc2hlcyAke3AubWVzaGVzfSwgcGFydGljbGUgc3lzdGVtcyAke3AucGFydGljbGVzfSwgZHJhdyBjYWxscyAke3AuZHJhd3N9YCxcbiAgICAgIGBzdGF0ZTogcGhhc2UgJHt0aGlzLnBoYXNlfSwgc3BlZWQgJHt0aGlzLnRpbWVTY2FsZX14LCBjYW1lcmEgJHt0aGlzLmNhbU1vZGV9LCBkaWZmaWN1bHR5ICR7ZGlmZmljdWx0eU5hbWV9LCB3YXZlICR7dGhpcy5zLndhdmV9LCB1bml0cyAke3RoaXMucy51bml0cy5sZW5ndGh9YCxcbiAgICAgIGBiYXR0bGVzIChuZXdlc3QgbGFzdCk6YCwgLi4uKHJvd3MubGVuZ3RoID8gcm93cyA6IFsnICAobm9uZSB5ZXQ6IHBsYXkgYSBiYXR0bGUsIHRoZW4gY29weSB0aGlzIGFnYWluKSddKV0uam9pbignXFxuJyk7XG4gIH1cblxuICAvKiogQSBydW4gdGhlIHBsYXllciBoYXMgcmVhbGx5IHN0YXJ0ZWQgKHNvIEhvbWUgY2FuIG9mZmVyIENvbnRpbnVlKS4gTnVsbCBhZnRlciBhIHN0YWdlIHdhcyB3b24gb3IgbG9zdCwgb3IgYmVmb3JlIGFueXRoaW5nIHdhcyBkb25lLiAqL1xuICBydW5JbmZvKCkgeyBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMgfHwgcy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBudWxsOyByZXR1cm4gKHMud2F2ZSA+IDEgfHwgcy51bml0cy5sZW5ndGggPiAwIHx8IHRoaXMuYXR0ZW1wdCA+IDAgfHwgcy5zdGF0cy5mYWlsdXJlcyA+IDApID8geyB3YXZlOiBzLndhdmUsIHRvdGFsOiBzdGFnZVdhdmVzKHMpLCBoZWFydHM6IHMuaGVhcnRzLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5TmFtZSB9IDogbnVsbDsgfVxuICAvKiogRnJlc2ggcnVuIHdpdGggdGhlIGN1cnJlbnRseSBlcXVpcHBlZCBTb3VsIERlY2sgKEhvbWUgPiBTdGFydCBCYXR0bGUgY2FsbHMgdGhpcykuICovXG4gIG5ld1J1bigpIHsgdGhpcy5zdGFydFN0YWdlKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydFN0YWdlKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpOyBzZXREaWZmaWN1bHR5KHN2LmRpZmZpY3VsdHkpOyB0aGlzLnMgPSBuZXdTdGFnZSh7IC4uLlBST1RPVFlQRV9SVUxFUywgcG9vbDogc3YuZGVjayB9LCBzZWVkKTsgdGhpcy5zZWVuTWVyZ2VzID0gMDtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KCdTdGFnZSBzdGFydDogNCBjYXJkcywgJyArIHRoaXMucy5jYXAgKyAnIERvbWluaW9uLiBTdW1tb24sIG1lcmdlLCB0aGVuIHByZXNzIEJBVFRMRS4nKTtcbiAgfVxuICBwcml2YXRlIGNsZWFyQmF0dGxlKCkge1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi5kaXNwb3NlKCk7IH0pOyB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpOyB0aGlzLmJhdHRsZSA9IG51bGw7XG4gICAgdGhpcy5hcnJvd3MuZm9yRWFjaCgoYSkgPT4gYS5tZXNoLmRpc3Bvc2UoKSk7IHRoaXMuYXJyb3dzID0gW107XG4gIH1cbiAgcHJpdmF0ZSBwb3MoY2VsbDogbnVtYmVyKSB7IHJldHVybiBjZWxsUG9zKDAsIGNlbGwpOyB9XG4gIHN5bmNCdWlsZCgpIHtcbiAgICB0aGlzLnBlcnNpc3RSdW4oKTtcbiAgICBjb25zdCBtZXJnZWQgPSB0aGlzLnMuc3RhdHMubWVyZ2VzID4gdGhpcy5zZWVuTWVyZ2VzOyB0aGlzLnNlZW5NZXJnZXMgPSB0aGlzLnMuc3RhdHMubWVyZ2VzO1xuICAgIGNvbnN0IGdyb3duID0gbWVyZ2VkID8gdGhpcy5zLnVuaXRzLmZpbmQoKHUpID0+IHsgY29uc3QgZ3YgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpOyByZXR1cm4gISFndiAmJiBndi5zdGFyICE9PSB1LnN0YXI7IH0pIDogdW5kZWZpbmVkOyAgIC8vIHRoZSB1bml0IHRoYXQganVzdCBnYWluZWQgYSBzdGFyXG4gICAgY29uc3QgYWxpdmUgPSBuZXcgU2V0KHRoaXMucy51bml0cy5tYXAoKHUpID0+IHUuaWQpKTtcbiAgICBmb3IgKGNvbnN0IFtpZCwgdl0gb2YgdGhpcy51bml0VmlzKSBpZiAoIWFsaXZlLmhhcyhpZCkpIHtcbiAgICAgIHRoaXMudmlzVG9Vbml0LmRlbGV0ZSh2KTsgdGhpcy51bml0VmlzLmRlbGV0ZShpZCk7IGNvbnN0IHAgPSB2LmhvbGRlci5wb3NpdGlvbjtcbiAgICAgIGlmIChncm93bikgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG1lcmdlOiB0aGUgY29uc3VtZWQgdW5pdCBpcyBkcmF3biBpbnRvIHRoZSBzdXJ2aXZvciBhbmQgdmFuaXNoZXMgaW4gYSBmbGFzaFxuICAgICAgICBjb25zdCB0byA9IHRoaXMucG9zKGdyb3duLmNlbGwpLCB4MCA9IHAueCwgejAgPSBwLnosIHNjID0gdi5ob2xkZXIuc2NhbGluZy54OyB2LnBsYXkoJ2lkbGUnKTtcbiAgICAgICAgdGhpcy50d2VlbigwLjMzLCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuNCwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LmhvbGRlci5zY2FsaW5nLnNldEFsbChzYyAqICgxIC0gMC43NSAqIHQpKTsgfSxcbiAgICAgICAgICAoKSA9PiB7IHRoaXMuYnVyc3QodG8ueCwgdG8ueiwgWzAuODUsIDAuNiwgMSwgMC45XSwgWzAuNSwgMC4zLCAxLCAwLjddLCAxNCk7IHYuZGlzcG9zZSgpOyB9KTtcbiAgICAgIH0gZWxzZSB7IHRoaXMuYnVyc3QocC54LCBwLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTYpOyB2LmRpc3Bvc2UoKTsgfVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7XG4gICAgICBsZXQgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpO1xuICAgICAgaWYgKCF2KSB7IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCB1LnNvdWwsIDAsIHUuc3Rhcik7IHRoaXMudW5pdFZpcy5zZXQodS5pZCwgdik7IHRoaXMudmlzVG9Vbml0LnNldCh2LCB1LmlkKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopOyBhdWRpby5wbGF5KCdzdW1tb24nKTsgY29uc3QgdnYgPSB2OyB0aGlzLmxhdGVyKDEuMSwgKCkgPT4geyBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJykgdnYucGxheSgnaWRsZScpOyB9KTsgfVxuICAgICAgZWxzZSB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgaWYgKHYuc3RhciAhPT0gdS5zdGFyKSB7IGNvbnN0IGZ2ID0gdjsgdi5zZXRTdGFyKHUuc3Rhcik7IHRoaXMubGF0ZXIoZ3Jvd24gJiYgZ3Jvd24uaWQgPT09IHUuaWQgPyAwLjMzIDogMCwgKCkgPT4gdGhpcy5tZXJnZUZ4KGZ2LCBwLngsIHAueikpOyB9IH1cbiAgICB9XG4gICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHRoaXMudGludChjLCAnbm9ybWFsJyk7XG4gICAgY29uc3Qgc2VsID0gdGhpcy5zZWw7XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnICYmIHRoaXMucGhhc2UgPT09ICdidWlsZCcpIHtcbiAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoY2VsbEZyZWUodGhpcy5zLCBjKSkgdGhpcy50aW50KGMsIGNhblN1bW1vbih0aGlzLnMsIHNlbC5pZHgpID8gJ2ZyZWUnIDogJ25vcm1hbCcpO1xuICAgICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgaWYgKGNhbk1lcmdlRnJvbUhhbmQodGhpcy5zLCBzZWwuaWR4LCB1LmlkKSkgdGhpcy50aW50KHUuY2VsbCwgJ3BhcnRuZXInKTsgICAgIC8vIHRoZSBjYXJkIGNhbiBtZXJnZSBpbnRvIHRoaXMgdW5pdFxuICAgIH1cbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHtcbiAgICAgIGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gc2VsLmlkKTtcbiAgICAgIGlmICh1KSB7IHRoaXMudGludCh1LmNlbGwsICdzZWwnKTsgZm9yIChjb25zdCBvIG9mIHRoaXMucy51bml0cykgaWYgKGNhbk1lcmdlRGVwbG95ZWQodSwgbykpIHRoaXMudGludChvLmNlbGwsICdwYXJ0bmVyJyk7IGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoY2VsbEZyZWUodGhpcy5zLCBjKSkgdGhpcy50aW50KGMsICdmcmVlJyk7IH1cbiAgICB9XG4gIH1cbiAgLyoqIFRoZSBtZXJnZSBtb21lbnQ6IGEgZmxhc2ggb2YgcmluZ3MgYW5kIHNwYXJrcywgYSBwdW5jaCBpbiBzaXplLCBhIHJpc2luZyBjaGltZS4gKi9cbiAgcHJpdmF0ZSBtZXJnZUZ4KHY6IFVuaXRWaXN1YWwsIHg6IG51bWJlciwgejogbnVtYmVyKSB7XG4gICAgYXVkaW8ucGxheSgnbWVyZ2UnKTsgdi5wdWxzZSgpOyBjb25zdCB0YXJnZXQgPSB2LmhvbGRlci5zY2FsaW5nLng7XG4gICAgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuNCksIDAuMiwgMi4wLCAwLjY1KTsgdGhpcy5sYXRlcigwLjEyLCAoKSA9PiB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMSwgMSksIDAuMiwgMy4wLCAwLjgpKTtcbiAgICB0aGlzLmJ1cnN0KHgsIHosIFsxLCAwLjg1LCAwLjQsIDAuOV0sIFswLjgsIDAuNCwgMSwgMC44XSwgNDYpOyB0aGlzLmJ1cnN0KHgsIHosIFswLjg1LCAwLjYsIDEsIDAuOV0sIFswLjUsIDAuMywgMSwgMC43XSwgMjQpO1xuICAgIHRoaXMudHdlZW4oMC41NSwgKHQpID0+IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRhcmdldCAqICgxICsgMC40NSAqIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqICgxIC0gdCAqIDAuNCkpKSwgKCkgPT4gdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGFyZ2V0KSk7XG4gIH1cbiAgcHJpdmF0ZSBzdW1tb25GeCh4OiBudW1iZXIsIHo6IG51bWJlcikgeyB0aGlzLmJ1cnN0KHgsIHosIFswLjcsIDAuMywgMSwgMC45XSwgWzAuMzUsIDAuMSwgMC43LCAwLjhdLCAzMCk7IHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygwLjcsIDAuMywgMSksIDAuMiwgMS4yLCAwLjcpOyB9XG5cbiAgLy8gLS0tLSBwbGF5ZXIgYWN0aW9ucyAoYnVpbGQgcGhhc2UpXG4gIHRvYXN0KG1zZzogc3RyaW5nKSB7IHRoaXMudWkudG9hc3QobXNnKTsgfVxuICBvbkNhcmQoaWR4OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChkaXNjYXJkUmVkcmF3KHRoaXMucywgaWR4KSkgeyB0aGlzLnRvYXN0KCdTd2FwcGVkOiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuJyk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIHRoaXMuc2VsID0gdGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHRoaXMuc2VsLmlkeCA9PT0gaWR4ID8gbnVsbCA6IHsgdHlwZTogJ2NhcmQnLCBpZHggfTtcbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBvblRpbGUoY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgY29uc3QgaGVyZSA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5jZWxsID09PSBjZWxsKTsgaWYgKGhlcmUpIHsgdGhpcy5vblVuaXRWaXN1YWwodGhpcy51bml0VmlzLmdldChoZXJlLmlkKSEpOyByZXR1cm47IH1cbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcpIHtcbiAgICAgIGlmIChjYW5TdW1tb24ocywgc2VsLmlkeCkpIHsgc3VtbW9uKHMsIHNlbC5pZHgsIGNlbGwpOyB0aGlzLnNlbCA9IG51bGw7IH1cbiAgICAgIGVsc2UgeyBjb25zdCBzb3VsID0gcy5oYW5kW3NlbC5pZHhdOyB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uOiAke1NPVUxfTkFNRVtzb3VsXX0gY29zdHMgJHtjb3N0KHNvdWwsIDEpfSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7IH1cbiAgICB9IGVsc2UgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7IGlmIChtb3ZlVW5pdChzLCBzZWwuaWQsIGNlbGwpKSB0aGlzLnNlbCA9IG51bGw7IH1cbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBvblVuaXRWaXN1YWwodjogVW5pdFZpc3VhbCkge1xuICAgIGNvbnN0IGlkID0gdGhpcy52aXNUb1VuaXQuZ2V0KHYpOyBpZiAoaWQgPT09IHVuZGVmaW5lZCB8fCB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgY29uc3QgcyA9IHRoaXMucywgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpITtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoc3dhcFNlbGwocywgaWQpKSB7IHRoaXMudG9hc3QoYFNvbGQgJHtTT1VMX05BTUVbdS5zb3VsXX06IGRyZXcgYSBkaWZmZXJlbnQgU291bC5gKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCh1LmZyZXNoID8gXCJZb3UgY2FuJ3Qgc2VsbCBhIHVuaXQgeW91IHN1bW1vbmVkIHRoaXMgcm91bmQuXCIgOiAnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiBzLmhhbmRbdGhpcy5zZWwuaWR4XSA9PT0gdS5zb3VsICYmIHUuc3RhciA9PT0gMSAmJiBzLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJykge1xuICAgICAgaWYgKG1lcmdlRnJvbUhhbmQocywgdGhpcy5zZWwuaWR4LCBpZCkpIHsgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTsgdGhpcy50b2FzdChgTWVyZ2VkIHRoZSBjYXJkIGludG8gYSAyLXN0YXIgJHtTT1VMX05BTUVbdS5zb3VsXX0hYCk7IH1cbiAgICAgIGVsc2UgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbiB0byBtZXJnZTogaXQgbmVlZHMgJHtjb3N0KHUuc291bCwgMikgLSBjb3N0KHUuc291bCwgMSl9IG1vcmUsIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApO1xuICAgIH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgIT09IGlkKSB7XG4gICAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSAodGhpcy5zZWwgYXMgYW55KS5pZCkhO1xuICAgICAgaWYgKGNhbk1lcmdlRGVwbG95ZWQoYSwgdSkpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCB1LmlkKTsgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQ6IGEuaWQgfTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgfSBlbHNlIHRoaXMuc2VsID0gdGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkID09PSBpZCA/IG51bGwgOiB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBtZXJnZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gc2VsLmlkKTsgY29uc3QgYiA9IGEgJiYgcy51bml0cy5maW5kKChvKSA9PiBjYW5NZXJnZURlcGxveWVkKGEsIG8pKTtcbiAgICBpZiAoYSAmJiBiKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgYi5pZCk7IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnRvYXN0KCdObyBtYXRjaGluZyB1bml0IChzYW1lIFNvdWwgYW5kIHN0YXJzKSB0byBtZXJnZSB3aXRoLicpO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcmVtb3ZlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3Qgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBpZiAoIXRoaXMuY29uZmlybVJlbW92ZSkgeyB0aGlzLmNvbmZpcm1SZW1vdmUgPSB0cnVlOyB0aGlzLnRvYXN0KCdUYXAgUmVtb3ZlIGFnYWluIHRvIGNvbmZpcm0uIFRoZSBjYXJkIGlzIGdvbmUgZm9yIHRoaXMgc3RhZ2UuJyk7IHRoaXMudWkucmVuZGVyKCk7IHJldHVybjsgfVxuICAgIGRpc21pc3ModGhpcy5zLCBzZWwuaWQpOyB0aGlzLnNlbCA9IG51bGw7IHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHRvZ2dsZVN3YXAoKSB7IGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47IGlmICh0aGlzLnMuZGlzY2FyZFVzZWQpIHsgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgcmV0dXJuOyB9IHRoaXMuc3dhcE1vZGUgPSAhdGhpcy5zd2FwTW9kZTsgdGhpcy5zZWwgPSBudWxsOyBpZiAodGhpcy5zd2FwTW9kZSkgdGhpcy50b2FzdCgnU3dhcDogdGFwIGEgaGFuZCBjYXJkIHRvIGRpc2NhcmQsIG9yIGEgdW5pdCAobm90IHN1bW1vbmVkIHRoaXMgcm91bmQpIHRvIHNlbGwuJyk7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBiYXR0bGVcbiAgc3RhcnRCYXR0bGUoKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgIXRoaXMucy51bml0cy5sZW5ndGgpIHsgaWYgKCF0aGlzLnMudW5pdHMubGVuZ3RoKSB0aGlzLnRvYXN0KCdTdW1tb24gYXQgbGVhc3Qgb25lIHVuaXQgZmlyc3QuJyk7IHJldHVybjsgfVxuICAgIHRoaXMuZmx1c2hUd2VlbnMoKTsgYXVkaW8ucGxheSgnc3RhcnQnKTsgdGhpcy5iZWdpbkJhdHRsZVBlcmYoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5hdHRlbXB0Kys7IHRoaXMuaGFuZGxlZCA9IGZhbHNlOyB0aGlzLnJlc3VsdEF0ID0gLTE7XG4gICAgY29uc3QgcyA9IHRoaXMucywgdW5pdHMgPSBzLnVuaXRzLnNsaWNlKCk7XG4gICAgY29uc3Qgc2F2ZWQgPSBsb2FkU2F2ZSgpLnNvdWxzLCBsZXZlbHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTsgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHNhdmVkKSkgbGV2ZWxzW2tdID0gKHNhdmVkIGFzIGFueSlba10ubGV2ZWw7ICAgLy8gcGVybWFuZW50IFNvdWwgbGV2ZWxzXG4gICAgdGhpcy5iYXR0bGUgPSBuZXcgQmF0dGxlKHVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW15V2F2ZShzLndhdmUsIHRoaXMuc2VlZCksIHRoaXMuc2VlZCAqIDEzMSArIHMud2F2ZSAqIDE3ICsgdGhpcy5hdHRlbXB0LCBsZXZlbHMpO1xuICAgIHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7XG4gICAgdGhpcy5iYXR0bGUuZmlnaHRlcnMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgaWYgKGYudGVhbSA9PT0gMCkgeyBjb25zdCB1ID0gdW5pdHNbZi5pZCAtIDFdOyBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMuZlVuaXQuc2V0KGYuaWQsIHUuaWQpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB9XG4gICAgICBlbHNlIHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIGYuc291bCwgMSwgZi5zdGFyKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KGYueCwgMCwgZi56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IC1NYXRoLlBJIC8gMjsgdi5wbGF5KCdzcGF3bicpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmxhdGVyKDEuMSwgKCkgPT4geyBpZiAodi5zdGF0ZSA9PT0gJ3NwYXduJykgdi5wbGF5KCdpZGxlJyk7IH0pOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC43LCAwLjYsIDAuNSwgMC43XSwgWzAuNCwgMC4zNSwgMC4zLCAwLjZdLCAxNCk7IH1cbiAgICB9KTtcbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICB0aGlzLnBoYXNlID0gJ3RyYW5zaXRpb24nOyB0aGlzLnN0YXJ0U3RlcEF0ID0gMS4wOyB0aGlzLmFjYyA9IDA7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMi4yKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBwcml2YXRlIGFwcGx5RXZlbnRzKGV2czogQkV2ZW50W10pIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhO1xuICAgIGZvciAoY29uc3QgZSBvZiBldnMpIHtcbiAgICAgIGlmIChlLnQgPT09ICdzd2luZycpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB2LnBsYXkoJ2F0dGFjaycsIGUuc3BlZWQpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdoaXQnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUudG8pOyBpZiAodikgdi5wdWxzZSgpOyBpZiAoZS5raW5kID09PSAnYXJyb3cnKSBhdWRpby5wbGF5KCdoaXRBcnJvdycpOyBlbHNlIGlmIChlLmtpbmQgPT09ICdtZWxlZScpIGF1ZGlvLnBsYXkoJ2hpdCcpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdhcnJvdycpIHsgY29uc3QgZiA9IGIuYnlJZChlLmZyb20pISwgdG8gPSBiLmJ5SWQoZS50bykhOyB0aGlzLnNwYXduQXJyb3coZi50ZWFtLCBmLngsIGYueiwgdG8ueCwgdG8ueiwgZS5kdXIpOyBhdWRpby5wbGF5KCdhcnJvdycpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdkZWF0aCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB7IHYucGxheSgnZGVhdGgnKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnZGVhdGgnKTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxMik7IGlmIChmLnRlYW0gPT09IDEpIHRoaXMubGF0ZXIoNSwgKCkgPT4geyBpZiAodGhpcy5mdmlzLmdldChlLmlkKSA9PT0gdiAmJiB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSB7IHYuaG9sZGVyLnNldEVuYWJsZWQoZmFsc2UpOyB9IH0pOyB9IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Nhc3QnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCdjYXN0Jyk7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC41LCAwLjgsIDEpLCAwLjE1LCAxLjEsIDAuMzUpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICd0YXVudCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ3RhdW50Jyk7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC4zKSwgMC4zLCBCQUxBTkNFLnRhdW50LnJhZGl1cywgMC42KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnc21hc2gnKSB7IGF1ZGlvLnBsYXkoJ3NtYXNoJyk7IHRoaXMuZnhSaW5nKGUueCwgZS56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC41LCAwLjIpLCAwLjIsIGUuciAqIDEuNiwgMC40NSk7IH1cbiAgICB9XG4gIH1cbiAgcHJpdmF0ZSBzcGF3bkFycm93KHRlYW06IG51bWJlciwgeDA6IG51bWJlciwgejA6IG51bWJlciwgeDE6IG51bWJlciwgejE6IG51bWJlciwgZHVyOiBudW1iZXIpIHtcbiAgICBsZXQgbWVzaCA9IHRoaXMuYXJyb3dNZXNoLnBvcCgpO1xuICAgIGlmICghbWVzaCkgeyBtZXNoID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignYXJyb3cnLCB7IGhlaWdodDogMC41NSwgZGlhbWV0ZXI6IDAuMDM1IH0sIHRoaXMuc2NlbmUpOyBtZXNoLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgbWVzaC5pc1BpY2thYmxlID0gZmFsc2U7IGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2FyJywgdGhpcy5zY2VuZSk7IG1lc2gucGFyZW50ID0gaG9sZGVyOyBtZXNoID0gaG9sZGVyOyB9XG4gICAgbWVzaC5zZXRFbmFibGVkKHRydWUpOyBtZXNoLmdldENoaWxkTWVzaGVzKClbMF0ubWF0ZXJpYWwgPSB0aGlzLmFycm93TWF0c1t0ZWFtXTtcbiAgICB0aGlzLmFycm93cy5wdXNoKHsgbWVzaCwgeDAsIHowLCB4MSwgejEsIHQ6IDAsIGR1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZnJhbWUoZHQ6IG51bWJlcikge1xuICAgIGlmICh0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCAhPT0gdGhpcy5sYXN0VyB8fCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQgIT09IHRoaXMubGFzdEgpIHRoaXMuaGFuZGxlUmVzaXplKCk7ICAgLy8gZS5nLiB0aGUgaG9tZS1zY3JlZW4gYXBwIHJlc2l6aW5nIGFmdGVyIGxhdW5jaFxuICAgIGZvciAobGV0IGkgPSB0aGlzLnRpbWVycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyB0aGlzLnRpbWVyc1tpXS50IC09IGR0OyBpZiAodGhpcy50aW1lcnNbaV0udCA8PSAwKSB7IGNvbnN0IGYgPSB0aGlzLnRpbWVyc1tpXS5mbjsgdGhpcy50aW1lcnMuc3BsaWNlKGksIDEpOyBmKCk7IH0gfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLnJpbmdGeC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCByID0gdGhpcy5yaW5nRnhbaV07IHIudCArPSBkdDsgY29uc3QgdSA9IHIudCAvIHIuZHVyLCBzID0gci5yMCArIChyLnIxIC0gci5yMCkgKiB1OyByLm0uc2NhbGluZy5zZXQocywgcywgcyk7IHIubW0uYWxwaGEgPSAwLjkgKiAoMSAtIHUpOyBpZiAodSA+PSAxKSB7IHIubS5kaXNwb3NlKCk7IHIubW0uZGlzcG9zZSgpOyB0aGlzLnJpbmdGeC5zcGxpY2UoaSwgMSk7IH0gfVxuICAgIGlmICh0aGlzLmNhbVQgPCAxKSB7IHRoaXMuY2FtVCA9IE1hdGgubWluKDEsIHRoaXMuY2FtVCArIGR0IC8gdGhpcy5jYW1EdXIpOyBjb25zdCBlID0gdGhpcy5jYW1UICogdGhpcy5jYW1UICogKDMgLSAyICogdGhpcy5jYW1UKTsgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20ucG9zLCB0aGlzLmNhbVRvLnBvcywgZSk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnRndCwgdGhpcy5jYW1Uby50Z3QsIGUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyAmJiB0aGlzLmNhbU1vZGUgPT09ICdjbG9zZScgJiYgIXRoaXMuY2luZSkgdGhpcy5mcmFtZUJhdHRsZShkdCk7XG4gICAgdGhpcy5uZWNyby51cGRhdGUoZHQpO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnR3ZWVucy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCB3ID0gdGhpcy50d2VlbnNbaV07IHcudCArPSBkdDsgY29uc3QgdSA9IE1hdGgubWluKDEsIHcudCAvIHcuZHVyKTsgdy5mbih1KTsgaWYgKHUgPj0gMSkgeyB0aGlzLnR3ZWVucy5zcGxpY2UoaSwgMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgICBmb3IgKGNvbnN0IHYgb2YgdGhpcy51bml0VmlzLnZhbHVlcygpKSB2LnVwZGF0ZShkdCk7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LnVwZGF0ZShkdCk7IH0pO1xuXG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlO1xuICAgIGlmICgodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nIHx8IHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSAmJiBiKSB7XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nKSB7IHRoaXMuc3RhcnRTdGVwQXQgLT0gZHQ7IGlmICh0aGlzLnN0YXJ0U3RlcEF0IDw9IDApIHsgdGhpcy5waGFzZSA9ICdiYXR0bGUnOyB0aGlzLnVpLnJlbmRlcigpOyB9IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJykge1xuICAgICAgICB0aGlzLmFjYyArPSBkdCAqIHRoaXMudGltZVNjYWxlO1xuICAgICAgICB3aGlsZSAodGhpcy5hY2MgPj0gMSAvIDMwICYmIGIud2lubmVyIDwgMCkgeyBiLnN0ZXAoMSAvIDMwKTsgdGhpcy5hY2MgLT0gMSAvIDMwOyB0aGlzLmFwcGx5RXZlbnRzKGIuZHJhaW4oKSk7IH1cbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoIXRoaXMuY2luZSAmJiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgfHwgZi50ZWFtID09PSAxKSkgeyB2LmhvbGRlci5wb3NpdGlvbi54ID0gZi54OyB2LmhvbGRlci5wb3NpdGlvbi56ID0gZi56OyBpZiAoZi5hbGl2ZSB8fCB0cnVlKSB2LmhvbGRlci5yb3RhdGlvbi55ID0gZi55YXc7IH1cbiAgICAgICAgaWYgKGYuYWxpdmUpIHsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCk7IGlmIChmLm1heE1hbmEpIHYuc2V0TWFuYShmLm1hbmEgLyBmLm1heE1hbmEpOyB9XG4gICAgICAgIGVsc2Ugdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoZi5zdGF0ZSAhPT0gJ2F0dGFjaycgJiYgZi5hbGl2ZSkgeyBjb25zdCB3YW50ID0gZi5zdGF0ZSA9PT0gJ3J1bicgPyAncnVuJyA6ICdpZGxlJzsgaWYgKHRoaXMubGFzdFN0YXRlLmdldChmLmlkKSAhPT0gd2FudCB8fCAodi5zdGF0ZSAhPT0gd2FudCAmJiB2LnN0YXRlICE9PSAnc3Bhd24nKSkgeyBpZiAodi5zdGF0ZSAhPT0gJ3NwYXduJykgeyB2LnBsYXkod2FudCBhcyBhbnkpOyB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgd2FudCk7IH0gfSB9XG4gICAgICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsICdhdHRhY2snKTtcbiAgICAgIH1cbiAgICAgIGlmIChiLndpbm5lciA+PSAwICYmICF0aGlzLmhhbmRsZWQpIHsgdGhpcy5oYW5kbGVkID0gdHJ1ZTsgdGhpcy5yZXN1bHRBdCA9IDEuNDsgfVxuICAgICAgaWYgKHRoaXMucmVzdWx0QXQgPiAwKSB7IHRoaXMucmVzdWx0QXQgLT0gZHQ7IGlmICh0aGlzLnJlc3VsdEF0IDw9IDApIHRoaXMuaGFuZGxlUmVzdWx0KCk7IH1cbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuYXJyb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBhID0gdGhpcy5hcnJvd3NbaV07IGEudCArPSBkdCAqIHRoaXMudGltZVNjYWxlOyBjb25zdCB1ID0gTWF0aC5taW4oMSwgYS50IC8gYS5kdXIpO1xuICAgICAgY29uc3QgcHggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUsIHB6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1LCBweSA9IDAuNzUgKyBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjkgLSB1ICogMC4yNTtcbiAgICAgIGNvbnN0IHUyID0gTWF0aC5taW4oMSwgdSArIDAuMDMpLCBxeCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdTIsIHF6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1MiwgcXkgPSAwLjc1ICsgTWF0aC5zaW4odTIgKiBNYXRoLlBJKSAqIDAuOSAtIHUyICogMC4yNTtcbiAgICAgIGEubWVzaC5wb3NpdGlvbi5zZXQocHgsIHB5LCBweik7IGEubWVzaC5sb29rQXQobmV3IEJBQllMT04uVmVjdG9yMyhxeCwgcXksIHF6KSk7XG4gICAgICBpZiAodSA+PSAxKSB7IGEubWVzaC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5hcnJvd01lc2gucHVzaChhLm1lc2gpOyB0aGlzLmFycm93cy5zcGxpY2UoaSwgMSk7IH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVJlc3VsdCgpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBzID0gdGhpcy5zO1xuICAgIHRoaXMuZW5kQmF0dGxlUGVyZigpO1xuICAgIHRoaXMubGFzdEJhdHRsZSA9IGB3YXZlICR7cy53YXZlfSBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fTogJHtiLndpbm5lciA9PT0gMCA/ICdXT04nIDogJ0xPU1QnfSBpbiAke2IudGltZS50b0ZpeGVkKDEpfXMsICR7Yi5jb3VudCgwKX0gb2YgeW91cnMgYW5kICR7Yi5jb3VudCgxKX0gZW5lbWllcyBsZWZ0YDtcbiAgICBpZiAoYi53aW5uZXIgPT09IDApIHtcbiAgICAgIHRoaXMucGxheVJlc3VsdCgnd2luJywgKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBhcm15IGlzIHJhaXNlZCBhZ2FpbiwgdGhlbiB0aGUgbmV4dCB3YXZlIC8gdGhlIGRyYWZ0XG4gICAgICAgIHRoaXMuY2luZSA9IGZhbHNlO1xuICAgICAgICBpZiAoYWR2YW5jZVdhdmUocykpIHtcbiAgICAgICAgICB0aGlzLnBoYXNlID0gJ3dvbic7IGNsZWFyUnVuKCk7XG4gICAgICAgICAgdHJ5IHsgdGhpcy5yZXdhcmQgPSByZWNvcmRDbGVhckFuZFNhdmUoJ2NyeXB0JywgZGlmZmljdWx0eU5hbWUgYXMgYW55KTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7IH0gY2F0Y2ggeyB0aGlzLnJld2FyZCA9IG51bGw7IH1cbiAgICAgICAgICB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5kcmFmdCA9IGRyYWZ0T3B0aW9ucyhzKTsgdGhpcy5waGFzZSA9ICdkcmFmdCc7IHRoaXMucGVyc2lzdFJ1bigpOyB0aGlzLnVpLnJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZhaWxXYXZlKHMpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnVpLnB1bHNlSGVhcnRzKCk7ICAgICAgICAgICAgICAgICAgIC8vIHRoZSBoZWFydCBpcyBsb3N0IHRoZSBtb21lbnQgaGUgaXMgaGl0XG4gICAgICBpZiAocy5zdGF0dXMgPT09ICdsb3N0JykgdGhpcy5wbGF5UmVzdWx0KCdmaW5hbCcsICgpID0+IHsgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucGhhc2UgPSAnbG9zdCc7IGNsZWFyUnVuKCk7IHRoaXMudWkucmVuZGVyKCk7IH0pO1xuICAgICAgZWxzZSB0aGlzLnBsYXlSZXN1bHQoJ2xvc3MnLCAoKSA9PiB7IHRoaXMudG9hc3QoJ1lvdXIgYXJteSBmZWxsLiAtMSBoZWFydCwgKzEgY2FyZCwgc2FtZSB3YXZlLiBSZWJ1aWxkIGEgZGlmZmVyZW50IHN0cmF0ZWd5LicpOyB0aGlzLnRvQnVpbGQoKTsgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLSByZXN1bHQgY3V0c2NlbmVzIChwbGFuIHNlY3Rpb25zIDE5LTIyKTogdGhlIE5lY3JvbWFuY2VyIHRha2VzIHRoZSBoaXQsIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSwgcmFpc2VzIHRoZSBmYWxsZW5cbiAgcHJpdmF0ZSBwbGF5UmVzdWx0KGtpbmQ6ICd3aW4nIHwgJ2xvc3MnIHwgJ2ZpbmFsJywgZG9uZTogKCkgPT4gdm9pZCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIG4gPSB0aGlzLm5lY3JvOyB0aGlzLmNpbmUgPSB0cnVlOyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5uZWNybywgMS4xKTtcbiAgICBjb25zdCBob21lID0gKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGV2ZXJ5IGZhbGxlbiBhbGx5IGlzIHB1bGxlZCBiYWNrIHRvIGl0cyBncmlkIHRpbGUgYW5kIHN0YW5kcyB1cFxuICAgICAgbi5jYXN0KCk7IGF1ZGlvLnBsYXkoJ3Jlc3VycmVjdCcpOyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFswLjg1LCAwLjUsIDEsIDAuOV0sIFswLjUsIDAuMiwgMSwgMC43XSwgMzApO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgaWYgKGYudGVhbSAhPT0gMCkgY29udGludWU7IGNvbnN0IHVpZCA9IHRoaXMuZlVuaXQuZ2V0KGYuaWQpLCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVpZCksIHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXUgfHwgIXYpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0byA9IHRoaXMucG9zKHUuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmICghZi5hbGl2ZSkgeyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuYnVyc3QoeDAsIHowLCBbMC43NSwgMC40LCAxLCAwLjldLCBbMC40LCAwLjE1LCAwLjksIDAuN10sIDE4KTsgdGhpcy5meFJpbmcoeDAsIHowLCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjM1LCAxKSwgMC4zLCAxLjYsIDAuNyk7IH1cbiAgICAgICAgdGhpcy50d2VlbigxLjAsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC41LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgKz0gKE1hdGguUEkgLyAyIC0gdi5ob2xkZXIucm90YXRpb24ueSkgKiBNYXRoLm1pbigxLCB0ICogMC41ICsgMC4xKTsgfSxcbiAgICAgICAgICAoKSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnkgPSAwOyB0aGlzLmJ1cnN0KHRvLngsIHRvLnosIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTApOyB9KTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGlmIChraW5kID09PSAnd2luJykgeyBuLmNhc3QoKTsgYXVkaW8ucGxheSgndmljdG9yeScpOyB0aGlzLmxhdGVyKDAuMjUsIGhvbWUpOyB0aGlzLmxhdGVyKDIuMCwgZG9uZSk7IHJldHVybjsgfVxuICAgIG4uaHVydCgpOyBhdWRpby5wbGF5KCdoZWFydExvc3QnKTsgdGhpcy5sYXRlcigwLjE1LCAoKSA9PiB7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy5idXJzdChjLngsIGMueiwgWzEsIDAuMywgMC4zLCAwLjldLCBbMC44LCAwLjEsIDAuMiwgMC42XSwgMTYpOyB9KTtcbiAgICBpZiAoa2luZCA9PT0gJ2ZpbmFsJykgeyB0aGlzLmxhdGVyKDAuNiwgKCkgPT4geyBuLmRlZmVhdCgpOyBhdWRpby5wbGF5KCdkZWZlYXQnKTsgfSk7IHRoaXMubGF0ZXIoMi42LCBkb25lKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5sYXRlcigxLjAsICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXB1bHNpb24gc2hvY2t3YXZlOiBzdXJ2aXZvcnMgYXJlIGZsdW5nIGJhY2sgdG8gd2hlcmUgdGhleSBzdGFydGVkIGFuZCBoZWFsIHRvIGZ1bGxcbiAgICAgIG4uY2FzdCgpOyBhdWRpby5wbGF5KCdzaG9ja3dhdmUnKTsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpO1xuICAgICAgdGhpcy5meFJpbmcoYy54LCAwLCBuZXcgQkFCWUxPTi5Db2xvcjMoMC44NSwgMC41NSwgMSksIDAuNiwgMzAsIDEuMSk7IHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDEsIDEpLCAwLjQsIDIyLCAwLjgpO1xuICAgICAgdGhpcy5idXJzdChjLngsIGMueiwgWzEsIDAuODUsIDEsIDAuOV0sIFswLjcsIDAuNCwgMSwgMC43XSwgNDApO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgaWYgKGYudGVhbSAhPT0gMSB8fCAhZi5hbGl2ZSkgY29udGludWU7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0byA9IGNlbGxQb3MoMSwgZi5jZWxsKSwgeDAgPSB2LmhvbGRlci5wb3NpdGlvbi54LCB6MCA9IHYuaG9sZGVyLnBvc2l0aW9uLno7IHYucHVsc2UoKTtcbiAgICAgICAgdGhpcy50d2VlbigwLjksICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC45LCB6MCArICh0by56IC0gejApICogdCk7IHYuc2V0SHAoZi5ocCAvIGYubWF4SHAgKyAoMSAtIGYuaHAgLyBmLm1heEhwKSAqIHQpOyB9LCAoKSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnkgPSAwOyB2LnNldEhwKDEpOyB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB0aGlzLmxhdGVyKDIuMywgaG9tZSk7IHRoaXMubGF0ZXIoMy43LCBkb25lKTtcbiAgfVxuICBwaWNrRHJhZnQoaWR4OiBudW1iZXIpIHsgaWYgKCF0aGlzLmRyYWZ0KSByZXR1cm47IHRha2VEcmFmdCh0aGlzLnMsIHRoaXMuZHJhZnQsIGlkeCk7IHRoaXMuZHJhZnQgPSBudWxsOyBub3JtYWxEcmF3KHRoaXMucyk7IHRoaXMudG9CdWlsZCgpOyB9XG4gIHByaXZhdGUgdG9CdWlsZCgpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5uZWNyby5yZXZpdmUoKTsgdGhpcy5mbHVzaFR3ZWVucygpO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7ICAgICAgICAgICAgICAgICAgICAgICAvLyByZXN1cnJlY3Rpb246IGV2ZXJ5b25lIHJpc2VzIGFnYWluIGF0IGZ1bGwgaGVhbHRoXG4gICAgICBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYuaG9sZGVyLnNldEVuYWJsZWQodHJ1ZSk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTtcbiAgICAgIHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB2LnBsYXkoJ2lkbGUnKSk7XG4gICAgfVxuICAgIHRoaXMucGhhc2UgPSAnYnVpbGQnOyB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7ICAgICAgICAgIC8vIFVJIGZpcnN0OiB0aGUgY2FtZXJhIG11c3QgbWVhc3VyZSB0aGUgaGFuZCBhbmQgYnV0dG9ucyB3aGlsZSB0aGV5IGFyZSB2aXNpYmxlXG4gICAgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYnVpbGQsIDEuOCk7XG4gIH1cbiAgc2V0U3BlZWQoazogbnVtYmVyKSB7IHRoaXMudGltZVNjYWxlID0gazsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIGhlbHBlcnNcbiAgYXBwbHlCYWxhbmNlQ2hhbmdlKCkgeyB0aGlzLnVuaXRWaXMuZm9yRWFjaCgodiwgaWQpID0+IHsgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7IGlmICh1KSB2LnNldFN0YXIodS5zdGFyKTsgfSk7IH1cbiAgdGVzdE9kZHMobiA9IDIwMCkge1xuICAgIGNvbnN0IHNsb3RzID0gdGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW1pZXMgPSBlbmVteVdhdmUodGhpcy5zLndhdmUsIHRoaXMuc2VlZCk7IGxldCB3aW4gPSAwLCB0ID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykgeyBjb25zdCByID0gc2ltdWxhdGUoc2xvdHMsIGVuZW1pZXMsIDUwMDAgKyBpKTsgaWYgKHIud2lubmVyID09PSAwKSB3aW4rKzsgdCArPSByLnRpbWU7IH1cbiAgICByZXR1cm4geyB3aW46IE1hdGgucm91bmQoKHdpbiAvIG4pICogMTAwKSwgYXZnVGltZTogKyh0IC8gbikudG9GaXhlZCgxKSwgbiB9O1xuICB9XG4gIGFkZENhcmQoc291bDogU291bElkKSB7IHRoaXMucy5oYW5kLnB1c2goc291bCk7IHRoaXMucy5zdGF0cy5kcmF3bisrOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIGFkZERvbWluaW9uKG46IG51bWJlcikgeyB0aGlzLnMuY2FwICs9IG47IHRoaXMudWkucmVuZGVyKCk7IH1cbiAgcmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgZW4gPSBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpO1xuICAgIHJldHVybiBbYHNlZWQgJHt0aGlzLnNlZWR9ICB3YXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9ICBoZWFydHMgJHtzLmhlYXJ0c30gIGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSAgcGhhc2UgJHt0aGlzLnBoYXNlfSAgYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH1gLFxuICAgICAgYGhhbmQ6ICR7cy5oYW5kLmpvaW4oJywgJykgfHwgJyhlbXB0eSknfWAsIGBhcm15OiAke3MudW5pdHMubWFwKCh1KSA9PiBgJHt1LnNvdWx9JHt1LnN0YXJ9QCR7dS5jZWxsfWApLmpvaW4oJyAnKSB8fCAnKG5vbmUpJ31gLCBgZW5lbXk6ICR7ZW4ubWFwKChlKSA9PiBlLnNvdWwgKyBlLnN0YXIpLmpvaW4oJyAnKX1gLFxuICAgICAgYGRpZmZpY3VsdHk6ICR7ZGlmZmljdWx0eU5hbWV9ICBtZXJnZS1mcm9tLWhhbmQ6ICR7cy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3Rhcid9ICBzd2FwIHVzZWQ6ICR7cy5kaXNjYXJkVXNlZH1gLCBgbGFzdCB0YXA6ICR7dGhpcy5sYXN0VGFwSW5mb31gLCBgc2NyZWVuOiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gZHByICR7d2luZG93LmRldmljZVBpeGVsUmF0aW99YCwgYGxhc3QgYmF0dGxlOiAke3RoaXMubGFzdEJhdHRsZSB8fCAnLSd9YCwgYGxvZyB0YWlsOmAsIC4uLnMubG9nLnNsaWNlKC04KSwgYGJhbGFuY2U6ICR7SlNPTi5zdHJpbmdpZnkoeyBzdGFyOiBCQUxBTkNFLnN0YXIsIHN0YXRzOiBCQUxBTkNFLnN0YXRzIH0pfWBdLmpvaW4oJ1xcbicpO1xuICB9XG4gIHJlc2V0QmFsYW5jZUFsbCgpIHsgcmVzZXRCYWxhbmNlKCk7IHRoaXMuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7IH1cbiAgZ2V0IGRpZmZpY3VsdHkoKSB7IHJldHVybiBkaWZmaWN1bHR5TmFtZTsgfVxuICBjaGFuZ2VEaWZmaWN1bHR5KG5hbWU6IHN0cmluZykgeyBzZXREaWZmaWN1bHR5KG5hbWUpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnRvYXN0KGBEaWZmaWN1bHR5OiAke25hbWV9LiBBcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZS5gKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGdhbGxlcnkgKHN0YXIgbG9va3MpXG4gIGdhbGxlcnkoKSB7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QuYWRkKCdnYWxsZXJ5Jyk7IHRoaXMubmVjcm8uc2V0RW5hYmxlZChmYWxzZSk7IGNvbnN0IHZpczogVW5pdFZpc3VhbFtdID0gW107IGxldCB0ZWFtOiAwIHwgMSA9IDA7XG4gICAgY29uc3QgcmVidWlsZCA9ICgpID0+IHsgdmlzLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdmlzLmxlbmd0aCA9IDA7IFNPVUxTLmZvckVhY2goKHNvdWwsIGkpID0+IFsxLCAyLCAzXS5mb3JFYWNoKChzdCwgaikgPT4geyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgc291bCwgdGVhbSwgc3QpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoKGkgLSAyLjUpICogMi41LCAwLCAoaiAtIDEpICogLTIuNCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJICogMC44NTsgdi5wbGF5KCdpZGxlJyk7IHZpcy5wdXNoKHYpOyB9KSk7IH07XG4gICAgcmVidWlsZCgpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5zZXQoMCwgNS42LCAtMTQuNSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgLTAuNCkpOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg1O1xuICAgICh3aW5kb3cgYXMgYW55KS5fX2dhbGxlcnkgPSB7IHNldFRlYW06ICh0OiAwIHwgMSkgPT4geyB0ZWFtID0gdDsgcmVidWlsZCgpOyB9LCB2aXMgfTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpOyB0aGlzLmVuZ2luZS5ydW5SZW5kZXJMb29wKCgpID0+IHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpLCBkdCA9IE1hdGgubWluKDAuMDUsIChuIC0gbGFzdCkgLyAxMDAwKTsgbGFzdCA9IG47IHZpcy5mb3JFYWNoKCh2KSA9PiB2LnVwZGF0ZShkdCkpOyB0aGlzLnNjZW5lLnJlbmRlcigpOyB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEdhbWUgfSBmcm9tICcuL2dhbWUudHMnO1xuXG5jb25zdCBnID0gbmV3IEdhbWUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2dhbWUgPSBnOyAgICAgICAgICAgICAgICAgICAgICAgLy8gaGFuZHkgZm9yIGRlYnVnZ2luZyBmcm9tIHRoZSBicm93c2VyIGNvbnNvbGVcbmcuaW5pdChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYycpIGFzIEhUTUxDYW52YXNFbGVtZW50KVxuICAudGhlbigoKSA9PiB7IGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnOyAod2luZG93IGFzIGFueSkuX19nYW1lUmVhZHkgPSB0cnVlOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdhbWUtcmVhZHknKSk7IH0pXG4gIC5jYXRjaCgoZSkgPT4ge1xuICAgIGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgeyBsLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7IGwudGV4dENvbnRlbnQgPSAnRXJyb3I6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBlKTsgfVxuICAgIGNvbnNvbGUuZXJyb3IoZSk7XG4gIH0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBb0NPLE1BQU0sV0FBb0I7QUFBQSxJQUMvQixPQUFPO0FBQUEsTUFDTCxTQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxNQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFFBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEdBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEtBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sS0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLElBQUk7QUFBQSxNQUM5RyxRQUFXLEVBQUUsSUFBSSxLQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sR0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLE1BQzlHLE1BQVcsRUFBRSxJQUFJLEtBQUssS0FBSyxJQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEtBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csV0FBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxNQUFNLE9BQU8sS0FBSyxPQUFPLEtBQUssTUFBTSxLQUFNLFNBQVMsR0FBSyxTQUFTLElBQUk7QUFBQSxJQUNoSDtBQUFBO0FBQUEsSUFFQSxNQUFNLEVBQUUsSUFBSSxDQUFDLEdBQUcsR0FBSyxHQUFHLEdBQUcsS0FBSyxDQUFDLEdBQUcsS0FB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SSxNQUFNLElBQUksTUFBTSxHQUFHLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUN6SyxLQUFLO0FBQWEsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxNQUFNLEtBQUssV0FBVyxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxVQUFVLE1BQU0sTUFBTSxLQUFLLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDNUssS0FBSztBQUFXLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsR0FBRztBQUFHO0FBQUEsUUFDekksS0FBSztBQUFVLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLElBQUksS0FBSyxRQUFRLEtBQUssR0FBRztBQUFHO0FBQUEsUUFDdEosS0FBSztBQUFjLGVBQUssS0FBSyxJQUFJLE1BQU0sUUFBUSxNQUFNLEdBQUcsS0FBSyxHQUFHO0FBQUcsZUFBSyxLQUFLLE1BQU0sTUFBTSxXQUFXLEtBQUssR0FBRyxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssR0FBSyxZQUFZLE1BQU0sS0FBSyxLQUFLLEdBQUc7QUFBRztBQUFBLFFBQ3pLLEtBQUs7QUFBYyxXQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHLGVBQUssS0FB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LFdBQUssVUFBVSxNQUFNO0FBQzVELFdBQUssT0FBTyxTQUFTLFFBQVEsQ0FBQyxNQUFNO0FBQ2xDLFlBQUksRUFBRSxTQUFTLEdBQUc7QUFBRSxnQkFBTSxJQUFJLE1BQU0sRUFBRSxLQUFLLENBQUM7QUFBRyxnQkFBTSxJQUFJLEtBQUssUUFBUSxJQUFJLEVBQUUsRUFBRTtBQUFJLGVBQUssS0FBSyxJQUFJLEVBQUUsSUFBSSxDQUFDO0FBQUcsZUFBSyxNQUFNLElBQUksRUFBRSxJQUFJLEVBQUUsRUFBRTtBQUFHLFlBQUUsTUFBTSxDQUFDO0FBQUcsWUFBRSxRQUFRLEVBQUUsVUFBVSxJQUFJLElBQUk7QUFBQSxRQUFHLE9BQzlLO0FBQUUsZ0JBQU0sSUFBSSxhQUFhLEtBQUssR0FBRyxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUk7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUFHLFlBQUUsT0FBTyxTQUFTLElBQUksQ0FBQyxLQUFLLEtBQUs7QUFBRyxZQUFFLEtBQUssT0FBTztBQUFHLFlBQUUsTUFBTSxDQUFDO0FBQUcsWUFBRSxRQUFRLEVBQUUsVUFBVSxJQUFJLElBQUk7QUFBRyxlQUFLLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQztBQUFHLGVBQUssTUFBTSxLQUFLLE1BQU07QUFBRSxnQkFBSSxFQUFFLFVBQVUsUUFBUyxHQUFFLEtBQUssTUFBTTtBQUFBLFVBQUcsQ0FBQztBQUFHLGVBQUssTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxRQUFHO0FBQUEsTUFDdFcsQ0FBQztBQUNELGVBQVMsSUFBSSxHQUFHLElBQUksWUFBWSxJQUFLLE1BQUssS0FBSyxHQUFHLFFBQVE7QUFDMUQsV0FBSyxRQUFRO0FBQWMsV0FBSyxjQUFjO0FBQUssV0FBSyxNQUFNO0FBQUcsV0FBSyxTQUFTLEtBQUssTUFBTSxFQUFFLFFBQVEs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Q0Y7OztBQ2xmQSxNQUFNLElBQUksSUFBSSxLQUFLO0FBQ25CLEVBQUMsT0FBZSxTQUFTO0FBQ3pCLElBQUUsS0FBSyxTQUFTLGVBQWUsR0FBRyxDQUFzQixFQUNyRCxLQUFLLE1BQU07QUFBRSxVQUFNLElBQUksU0FBUyxlQUFlLFNBQVM7QUFBRyxRQUFJLEVBQUcsR0FBRSxNQUFNLFVBQVU7QUFBUSxJQUFDLE9BQWUsY0FBYztBQUFNLFdBQU8sY0FBYyxJQUFJLE1BQU0sa0JBQWtCLENBQUM7QUFBQSxFQUFHLENBQUMsRUFDdEwsTUFBTSxDQUFDLE1BQU07QUFDWixVQUFNLElBQUksU0FBUyxlQUFlLFNBQVM7QUFBRyxRQUFJLEdBQUc7QUFBRSxRQUFFLE1BQU0sVUFBVTtBQUFRLFFBQUUsY0FBYyxhQUFhLEtBQUssRUFBRSxVQUFVLEVBQUUsVUFBVTtBQUFBLElBQUk7QUFDL0ksWUFBUSxNQUFNLENBQUM7QUFBQSxFQUNqQixDQUFDOyIsCiAgIm5hbWVzIjogWyJ0ZyIsICJnIiwgImciLCAiS0VZIiwgIlZFUlNJT04iLCAic3RhZ2VXYXZlcyIsICJkcmF3IiwgImciLCAiZyJdCn0K
