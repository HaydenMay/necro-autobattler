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
    /** `enemyPower`: health and damage multiplier for the enemy team only (stage strength; 1 = as written). */
    constructor(players, enemies, seed = 1, levels, enemyPower2 = 1) {
      __publicField(this, "time", 0);
      __publicField(this, "fighters", []);
      __publicField(this, "events", []);
      __publicField(this, "winner", -1);
      __publicField(this, "rng");
      __publicField(this, "pending", []);
      __publicField(this, "nextId", 1);
      __publicField(this, "enemyPower", 1);
      __publicField(this, "flip", false);
      var _a;
      this.rng = makeRng(seed);
      this.enemyPower = enemyPower2;
      for (const p of players) this.add(0, p.soul, p.star, p.cell, (_a = levels == null ? void 0 : levels[p.soul]) != null ? _a : 1);
      const cells = enemyCells(enemies);
      enemies.forEach((e, i) => this.add(1, e.soul, e.star, cells[i]));
    }
    add(team, soul, star, cell, level = 1) {
      var _a, _b;
      const B = BALANCE, st = B.stats[soul], p = cellPos(team, cell);
      const lvHp = 1 + (Math.max(1, level) - 1) * B.level.hp, lvDmg = 1 + (Math.max(1, level) - 1) * B.level.dmg;
      const pw = team === 1 ? this.enemyPower : 1;
      const hp = st.hp * B.star.hp[star - 1] * lvHp * pw;
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
        dmg: st.dmg * B.star.dmg[star - 1] * lvDmg * pw,
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
  function simulate(players, enemies, seed = 1, maxSeconds = 130, levels, enemyPower2 = 1) {
    const b = new Battle(players, enemies, seed, levels, enemyPower2);
    while (b.winner < 0 && b.time < maxSeconds) b.step(1 / 30);
    const w = b.winner < 0 ? 1 : b.winner;
    const mine = b.fighters.filter((f) => f.alive && f.team === w);
    return { winner: w, time: b.time, left: mine.length, hpLeft: mine.reduce((n, f) => n + f.hp / f.maxHp, 0) };
  }

  // core/waves.ts
  var DIFFS = ["easy", "normal", "hard", "nightmare"];
  var LETTER = { W: "warrior", A: "archer", G: "goblin", K: "knight", O: "ogre", B: "barbarian" };
  var parseWave = (s) => s.split(" ").map((t) => ({ soul: LETTER[t[0]], star: +t[1] }));
  var DIFFICULTY = {
    easy: ["W1", "K1 W1", "O1 W1 G1", "K1 A1 W1", "O1 A1 G1", "K1 O1 A1", "K1 O1 A1 G1", "O1 K1 A1 G1", "O1 K1 A1 B1", "O2 K1 A1 G1"],
    normal: ["W1 A1", "K1 G1 W1", "O1 A1 G1 W1", "K1 O1 A1 W1", "O1 K1 A1 G1 W1", "A2 K1 O1 G1 W1", "K1 O1 A1 G1 W1", "O1 K1 A1 B1 G1", "O1 K1 A2 B1 G1", "O2 K1 A1 B1 G1 W1"],
    hard: ["W1 A1", "K1 G1 W1 A1 W1", "O1 A1 G1 W1 W1", "K1 O1 A1 W1 G1 W1", "O1 K1 A2 G1 W1 W1 W1", "A2 K1 O1 G1 W1 B1 W1 W1", "K1 O1 A1 G1 W2 W1 W1", "O1 K1 A2 B1 G1 W1 W1 G1", "O2 K1 A2 B1 G1 W1 W1 G1", "O2 K2 A1 B1 G1 W1 W1 W1 G1"],
    nightmare: ["W1 A1 G1", "K1 G1 W1 A1 W1", "O1 A1 G1 W1 B1 W1", "K1 O1 A1 W1 G1 W1 W1", "O1 K1 A2 G1 W1 B1 W1 W1 G1", "A2 K1 O1 G1 W1 B1 W1 W1 G1 G1", "K1 O1 A2 G1 W1 B1 W1 W1 G1 G1 B1", "O1 K2 A2 B1 G1 W1 W1 W1 G1 G1 B1", "O2 K1 A2 B1 G1 W1 W1 W1 G1 G1 B1 K1", "O2 K2 A2 B1 G1 W1 W1 W1 G1 G1 B1 K1"]
  };
  var STAGES = [
    {
      id: "crypt",
      name: "The Restless Crypt",
      blurb: "Raise your army. The dead here are only just stirring.",
      lists: { easy: DIFFICULTY.easy, normal: DIFFICULTY.normal, hard: DIFFICULTY.hard, nightmare: DIFFICULTY.nightmare },
      power: { easy: 1, normal: 1, hard: 1, nightmare: 1 },
      rec: { easy: 1, normal: 1, hard: 4, nightmare: 6 }
    },
    {
      id: "graveyard",
      name: "The Sunken Graveyard",
      blurb: "Bigger crowds crawl out of the mud. Level your Souls before you come.",
      lists: { easy: DIFFICULTY.normal, normal: DIFFICULTY.hard, hard: DIFFICULTY.nightmare, nightmare: DIFFICULTY.nightmare },
      power: { easy: 1.05, normal: 1, hard: 1.05, nightmare: 1.15 },
      rec: { easy: 2, normal: 4, hard: 6, nightmare: 8 }
    },
    {
      id: "bastion",
      name: "The Bone Bastion",
      blurb: "A fortress of the fallen. Only well-levelled armies hold the gate.",
      lists: { easy: DIFFICULTY.hard, normal: DIFFICULTY.nightmare, hard: DIFFICULTY.nightmare, nightmare: DIFFICULTY.nightmare },
      power: { easy: 0.9, normal: 1.05, hard: 1.15, nightmare: 1.3 },
      rec: { easy: 4, normal: 6, hard: 8, nightmare: 10 }
    }
  ];
  var stageIndex = (id) => Math.max(0, STAGES.findIndex((s) => s.id === id));
  var stageById = (id) => STAGES[stageIndex(id)];
  var difficultyName = "normal";
  var currentStageId = "crypt";
  var power = 1;
  var enemyPower = () => power;
  var AUTHORED = DIFFICULTY.normal.map(parseWave);
  function setStageDifficulty(stage, name) {
    const st = stageById(stage);
    if (!DIFFS.includes(name)) return;
    currentStageId = st.id;
    difficultyName = name;
    power = st.power[name];
    AUTHORED.length = 0;
    st.lists[name].forEach((w) => AUTHORED.push(parseWave(w)));
  }
  function setDifficulty(name) {
    setStageDifficulty(currentStageId, name);
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
    return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls, settings: { music: true, sfx: true }, difficulty: "normal", stage: "crypt", seen: [], packs: [], nextPackId: 1, clears: {}, replayMeter: 0 };
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
    if (typeof raw.stage === "string" && /^[a-z0-9_-]{1,24}$/.test(raw.stage)) base.stage = raw.stage;
    if (Array.isArray(raw.seen)) base.seen = raw.seen.filter((k) => typeof k === "string" && k.length < 40).slice(-80);
    else if (raw.clears && typeof raw.clears === "object" && Object.keys(raw.clears).length) base.seen = null;
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
        case "unlock":
          [0.35, 0.47, 0.59, 0.71].forEach((d, i) => {
            this.hiss(0.05, 0.22, "bandpass", 900 + i * 120, d);
            this.tone(170 + i * 12, 0.07, "square", 0.06, d, void 0, 2e-3, 600);
          });
          [784, 1046, 1318].forEach((f, i) => this.tone(f, 0.6, "triangle", 0.16, 1.15 + i * 0.07));
          this.hiss(0.5, 0.09, "highpass", 5e3, 1.2);
          this.tone(110, 0.3, "sine", 0.25, 1.15, 60);
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
      return { snap: { v: VERSION2, seed: x.seed, attempt: x.attempt, stage: typeof x.stage === "string" ? x.stage : "crypt", difficulty: x.difficulty, phase: draft ? "draft" : "build", draft, state: x.state }, state };
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
  function recordClearBase(save, stageId, difficulty) {
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
  var clearCount = (save, stage, d) => {
    var _a;
    return (_a = save.clears[stage + ":" + d]) != null ? _a : 0;
  };
  function stageUnlocked(save, index) {
    return index <= 0 || index < STAGES.length && clearCount(save, STAGES[index - 1].id, "normal") > 0;
  }
  function difficultyUnlocked(save, stage, d) {
    const idx = STAGES.findIndex((s) => s.id === stage);
    if (idx < 0 || !stageUnlocked(save, idx)) return false;
    if (d === "easy" || d === "normal") return true;
    return d === "hard" ? clearCount(save, stage, "normal") > 0 : clearCount(save, stage, "hard") > 0;
  }
  function playable(save) {
    let idx = stageIndex(save.stage);
    while (idx > 0 && !stageUnlocked(save, idx)) idx--;
    const stage = STAGES[idx].id;
    return { stage, difficulty: difficultyUnlocked(save, stage, save.difficulty) ? save.difficulty : "normal" };
  }
  function unlockedKeys(save) {
    const keys = [];
    STAGES.forEach((st, i) => {
      if (i > 0 && stageUnlocked(save, i)) keys.push("stage:" + st.id);
      for (const d of ["hard", "nightmare"]) if (difficultyUnlocked(save, st.id, d)) keys.push("tier:" + st.id + ":" + d);
    });
    return keys;
  }
  var TIER_NAME = { hard: "Hard mode", nightmare: "Nightmare mode" };
  function describeUnlock(key) {
    var _a;
    const [kind, stage, tier] = key.split(":");
    if (kind === "stage") return stageById(stage).name + " (new stage)";
    return ((_a = TIER_NAME[tier]) != null ? _a : tier) + " on " + stageById(stage).name;
  }
  function recordClear(save, stageId, difficulty) {
    const before = unlockedKeys(save), r = recordClearBase(save, stageId, difficulty);
    return { ...r, unlocked: unlockedKeys(save).filter((k) => !before.includes(k)) };
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
        const unlockHtml = rw && rw.unlocked && rw.unlocked.length ? `<div class="sub" style="color:#7ef2c8;font-weight:700">${iconImg("check")} Unlocked: ${rw.unlocked.map((k) => describeUnlock(k)).join(" \xB7 ")}</div>` : "";
        const rewardHtml = unlockHtml + (rw ? `<div class="sub" style="color:#ffd24a;font-weight:700">${rw.pack ? rw.first ? `${iconImg("shop")} First clear! You earned a ${sk(rw.pack.tier)} Soul Pack.` : `${iconImg("shop")} Replay reward: a ${sk(rw.pack.tier)} Soul Pack.` : `Replay progress ${rw.replayMeter}/${rw.replayNeeded} toward a Soul Pack.`}</div>` : "");
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
        const snap = { v: 1, seed: this.seed, attempt: this.attempt, stage: currentStageId, difficulty: difficultyName, phase: this.phase, draft: this.phase === "draft" ? this.draft : null, state: serializeState(s) };
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
      setStageDifficulty(snap.stage, snap.difficulty);
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
      return s.wave > 1 || s.units.length > 0 || this.attempt > 0 || s.stats.failures > 0 ? { wave: s.wave, total: stageWaves(s), hearts: s.hearts, difficulty: difficultyName, stage: currentStageId } : null;
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
      const sv = loadSave(), pl = playable(sv);
      setStageDifficulty(pl.stage, pl.difficulty);
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
      this.battle = new Battle(units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell })), enemyWave(s.wave, this.seed), this.seed * 131 + s.wave * 17 + this.attempt, levels, enemyPower());
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
              this.reward = recordClearAndSave(currentStageId, difficultyName);
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
      const lv = {}, sv = loadSave().souls;
      for (const k of Object.keys(sv)) lv[k] = sv[k].level;
      for (let i = 0; i < n; i++) {
        const r = simulate(slots, enemies, 5e3 + i, 130, lv, enemyPower());
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
        `stage ${currentStageId}/${difficultyName}  seed ${this.seed}  wave ${s.wave}/${stageWaves(s)}  hearts ${s.hearts}  dominion ${dominionUsed(s)}/${s.cap}  phase ${this.phase}  attempt ${this.attempt}`,
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2NvcmUvYmF0dGxlLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9wYWNrcy50cyIsICIuLi9jb3JlL3NhdmUudHMiLCAiLi4vZ2FtZS9uZWNyb21hbmNlci50cyIsICIuLi9nYW1lL2F1ZGlvLnRzIiwgIi4uL2NvcmUvcnVuc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvdmlzdWFscy50cyIsICIuLi91aS9pY29ucy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXSB9O1xuICBzaW06IHsgc2VwYXJhdGlvbjogbnVtYmVyOyBoaXRGcmFjdGlvbjogbnVtYmVyOyB0aW1lTGltaXQ6IG51bWJlcjsgcmV0YXJnZXRFdmVyeTogbnVtYmVyIH07XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUUzogQmFsYW5jZSA9IHtcbiAgc3RhdHM6IHtcbiAgICB3YXJyaW9yOiAgIHsgaHA6IDYwLCAgZG1nOiA4LCAgaW50ZXJ2YWw6IDAuOSwgcmFuZ2U6IDAuODUsIHNwZWVkOiAxLjQsIHNpemU6IDAuMjgsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC40NyB9LFxuICAgIGFyY2hlcjogICAgeyBocDogNDAsICBkbWc6IDcsICBpbnRlcnZhbDogMS43LCByYW5nZTogNS4wLCAgc3BlZWQ6IDEuMSwgc2l6ZTogMC4yNiwgYW5pbUxlbjogMS41LCBoaXRGcmFjOiAwLjc4IH0sXG4gICAgZ29ibGluOiAgICB7IGhwOiA0NSwgIGRtZzogOSwgIGludGVydmFsOiAwLjgsIHJhbmdlOiAwLjgsICBzcGVlZDogMS43LCBzaXplOiAwLjI0LCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIGtuaWdodDogICAgeyBocDogMTMwLCBkbWc6IDksICBpbnRlcnZhbDogMS4xLCByYW5nZTogMC45LCAgc3BlZWQ6IDEuMCwgc2l6ZTogMC4zMiwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgICBvZ3JlOiAgICAgIHsgaHA6IDE3MCwgZG1nOiAxNiwgaW50ZXJ2YWw6IDEuOSwgcmFuZ2U6IDEuMDUsIHNwZWVkOiAwLjgsIHNpemU6IDAuNDIsIGFuaW1MZW46IDEuMiwgaGl0RnJhYzogMC41NSB9LFxuICAgIGJhcmJhcmlhbjogeyBocDogNzUsICBkbWc6IDgsICBpbnRlcnZhbDogMC45NSwgcmFuZ2U6IDAuOSwgc3BlZWQ6IDEuNSwgc2l6ZTogMC4zMCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgfSxcbiAgLy8gXCJib2RpZXMgPSBkYW1hZ2UsIHN0YXJzID0gZHVyYWJpbGl0eVwiOiBIUCBncm93cyBmYXN0ZXIgdGhhbiBkYW1hZ2UgcGVyIHN0YXJcbiAgc3RhcjogeyBocDogWzEsIDIuMCwgMy4yXSwgZG1nOiBbMSwgMS41LCAyLjBdLCBzY2FsZTogWzEsIDEuMTIsIDEuMjVdIH0sXG4gIHBoYWxhbng6IHsgcmFkaXVzOiAyLjAsIHBlckFsbHk6IDAuMDgsIG1heFN0YWNrczogMyB9LFxuICAvLyBtYW5hIGZpbGxzIGZhc3Q6IGEgYmFzaWMgYXR0YWNrIGdpdmVzIHBlckF0dGFjaywgdGFraW5nIGEgaGl0IGdpdmVzIHBlckhpdDsgYSBmdWxsIGJhciBmaXJlcyB0aGUgc2tpbGwgb24gdGhlIG5leHQgYXR0YWNrLCB0aGVuIHJlc2V0c1xuICBtYW5hOiB7XG4gICAgYXJjaGVyOiB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDM0LCBwZXJIaXQ6IDYgfSwgICAgIC8vIFNwbGl0IEFycm93IGFib3V0IGV2ZXJ5IDNyZCBzaG90XG4gICAgb2dyZTogICB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDM0LCBwZXJIaXQ6IDYgfSwgICAgIC8vIFNtYXNoIGFib3V0IGV2ZXJ5IDNyZCBzd2luZ1xuICAgIGtuaWdodDogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAyNSwgcGVySGl0OiAxMiB9LCAgICAvLyBUYXVudCBldmVyeSB+NCBzd2luZ3MsIHNvb25lciB3aGVuIGhlIGlzIGJlaW5nIGhpdFxuICB9LFxuICB2b2xsZXk6IHsgdGFyZ2V0czogMywgcHJvamVjdGlsZVNwZWVkOiAxNCB9LFxuICBvcHBvcnR1bmlzdDogeyBib251czogMC41LCBzZWVrUmFkaXVzOiA0LjAsIHdvdW5kZWRXZWlnaHQ6IDEuNSB9LFxuICB0YXVudDogeyBkdXJhdGlvbjogMywgcmFkaXVzOiA0LjUgfSxcbiAgc21hc2g6IHsgbXVsdDogMi4wLCByYWRpdXM6IDEuNiB9LFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IDAuMTIsIG1heFN0YWNrczogOCwgcmVzZXRBZnRlcjogMC42IH0sXG4gIGxldmVsOiB7IGhwOiAwLjA4LCBkbWc6IDAuMDgsIGNvcGllc1RvTGV2ZWw6IFs1LCAxMCwgMjAsIDQwLCA4MCwgMTIwLCAyMDAsIDMwMCwgNTAwXSB9LFxuICBzaW06IHsgc2VwYXJhdGlvbjogMC42LCBoaXRGcmFjdGlvbjogMC40NywgdGltZUxpbWl0OiAxMjAsIHJldGFyZ2V0RXZlcnk6IDAuNSB9LFxufTtcblxuZXhwb3J0IGNvbnN0IEJBTEFOQ0U6IEJhbGFuY2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNldEJhbGFuY2UoKTogdm9pZCB7XG4gIGNvbnN0IGZyZXNoOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoZnJlc2gpIGFzIChrZXlvZiBCYWxhbmNlKVtdKSAoQkFMQU5DRSBhcyBhbnkpW2tdID0gKGZyZXNoIGFzIGFueSlba107XG59XG5cbmV4cG9ydCBjb25zdCBST0xFX1RFWFQ6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdDaGVhcCBhbmQgZmFzdC4gVG91Z2hlciBuZWFyIG90aGVyIFdhcnJpb3JzLicsXG4gIGFyY2hlcjogJ0ZyYWdpbGUuIFNraWxsOiBTcGxpdCBBcnJvdyBoaXRzIDMgZGlmZmVyZW50IGVuZW1pZXMuJyxcbiAgZ29ibGluOiAnRmFzdC4gSGl0cyBoYXJkZXIgb24gZW5lbWllcyBmaWdodGluZyBzb21lb25lIGVsc2UuJyxcbiAga25pZ2h0OiAnVGFuay4gU2tpbGw6IFRhdW50IHB1bGxzIGVuZW1pZXMgb250byBoaW0uJyxcbiAgb2dyZTogJ1Nsb3csIGh1Z2UgZGFtYWdlLiBTa2lsbDogU21hc2gsIGEgYmlnIGFyZWEgc2xhbS4nLFxuICBiYXJiYXJpYW46ICdTd2luZ3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBoaXQuJyxcbn07XG5cbmV4cG9ydCBjb25zdCBTT1VMX05BTUU6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdTa2VsZXRvbiBXYXJyaW9yJywgYXJjaGVyOiAnU2tlbGV0b24gQXJjaGVyJywgZ29ibGluOiAnR29ibGluJyxcbiAga25pZ2h0OiAnS25pZ2h0Jywgb2dyZTogJ09ncmUnLCBiYXJiYXJpYW46ICdCYXJiYXJpYW4nLFxufTtcblxuLyoqIEFiaWxpdHkgYmx1cmJzIGZvciB0aGUgU291bHMgcGFnZSwgd2l0aCB0aGUgbGl2ZSBudW1iZXJzIGZpbGxlZCBpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhYmlsaXR5SW5mbyhzb3VsOiBTb3VsSWQpOiB7IGtpbmQ6ICdza2lsbCcgfCAncGFzc2l2ZSc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nIH0ge1xuICBjb25zdCBCID0gQkFMQU5DRSwgcGN0ID0gKHg6IG51bWJlcikgPT4gTWF0aC5yb3VuZCh4ICogMTAwKSArICclJztcbiAgc3dpdGNoIChzb3VsKSB7XG4gICAgY2FzZSAnd2Fycmlvcic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ1BoYWxhbngnLCB0ZXh0OiBgVGFrZXMgJHtwY3QoQi5waGFsYW54LnBlckFsbHkpfSBsZXNzIGRhbWFnZSBmb3IgZWFjaCBvdGhlciBTa2VsZXRvbiBXYXJyaW9yIHdpdGhpbiAke0IucGhhbGFueC5yYWRpdXN9bSAodXAgdG8gJHtCLnBoYWxhbngubWF4U3RhY2tzfSkuYCB9O1xuICAgIGNhc2UgJ2dvYmxpbic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ09wcG9ydHVuaXN0JywgdGV4dDogYERlYWxzICR7cGN0KEIub3Bwb3J0dW5pc3QuYm9udXMpfSBtb3JlIGRhbWFnZSB0byBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZSwgYW5kIHByZWZlcnMgc3VjaCB0YXJnZXRzLmAgfTtcbiAgICBjYXNlICdiYXJiYXJpYW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdGcmVuenknLCB0ZXh0OiBgQXR0YWNrcyAke3BjdChCLmZyZW56eS5wZXJTd2luZyl9IGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmcgKHVwIHRvICR7Qi5mcmVuenkubWF4U3RhY2tzfSB0aW1lcykuYCB9O1xuICAgIGNhc2UgJ2FyY2hlcic6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTcGxpdCBBcnJvdycsIHRleHQ6IGBCYXNpYyBzaG90cyBmaXJlIG9uZSBhcnJvdy4gV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHNob3QgZmlyZXMgYXQgdXAgdG8gJHtCLnZvbGxleS50YXJnZXRzfSBkaWZmZXJlbnQgZW5lbWllcy5gIH07XG4gICAgY2FzZSAna25pZ2h0JzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1RhdW50JywgdGV4dDogYFdoZW4gbWFuYSBpcyBmdWxsLCBlbmVtaWVzIHdpdGhpbiAke0IudGF1bnQucmFkaXVzfW0gbXVzdCBhdHRhY2sgaGltIGZvciAke0IudGF1bnQuZHVyYXRpb259cy5gIH07XG4gICAgY2FzZSAnb2dyZSc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTbWFzaCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgdGhlIG5leHQgc3dpbmcgZGVhbHMgJHtCLnNtYXNoLm11bHR9eCBkYW1hZ2UgYW5kIGhpdHMgZW5lbWllcyBuZWFyIHRoZSB0YXJnZXQgZm9yIDYwJSBhcyBtdWNoLmAgfTtcbiAgfVxufVxuIiwgIi8vIERlc2lnbiBkYXRhIHN0cmFpZ2h0IGZyb20gdGhlIHBsYW4gZG9jLiBBbnl0aGluZyBtYXJrZWQgUExBQ0VIT0xERVIgaXMgbm90IGluIHRoZSBkb2MgeWV0LlxuXG5leHBvcnQgdHlwZSBTb3VsSWQgPSAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJztcblxuZXhwb3J0IGNvbnN0IFNPVUxTOiBTb3VsSWRbXSA9IFsnd2FycmlvcicsICdhcmNoZXInLCAnZ29ibGluJywgJ2tuaWdodCcsICdvZ3JlJywgJ2JhcmJhcmlhbiddO1xuXG4vKiogRG9taW5pb24gY29zdCBwZXIgc3RhciBsZXZlbDogaW5kZXggMCA9IDEgc3RhciwgMSA9IDIgc3RhcnMsIDIgPSAzIHN0YXJzICgzIHN0YXJzIGlzIHRoZSBtYXgpLiAqL1xuZXhwb3J0IGNvbnN0IENPU1Q6IFJlY29yZDxTb3VsSWQsIG51bWJlcltdPiA9IHtcbiAgd2FycmlvcjogWzIsIDMsIDRdLFxuICBhcmNoZXI6IFs0LCA2LCA5XSxcbiAgZ29ibGluOiBbMywgNCwgNl0sXG4gIGtuaWdodDogWzUsIDcsIDEwXSxcbiAgb2dyZTogWzcsIDEwLCAxNV0sXG4gIGJhcmJhcmlhbjogWzUsIDcsIDEwXSwgLy8gUExBQ0VIT0xERVI6IHRoZSBkb2MgaGFzIG5vIGNvc3QgZm9yIHRoZSBzaXh0aCBTb3VsIHlldFxufTtcblxuZXhwb3J0IGNvbnN0IE1BWF9TVEFSID0gMztcbmV4cG9ydCBjb25zdCBHUklEX0NFTExTID0gMTI7IC8vIDQgeCAzXG5cbi8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUgKGluZGV4IDAgPSB3YXZlIDEpLiAqL1xuZXhwb3J0IGNvbnN0IENVUlZFUzogUmVjb3JkPHN0cmluZywgbnVtYmVyW10+ID0ge1xuICAvLyBMT0NLRUQgKGNvbmZpcm1lZCk6ICs0IGZvciB3YXZlcyAyLTUsIHRoZW4gKzMgZm9yIHdhdmVzIDYtMTAgLT4gNDBcbiAgZG9jOiBbOSwgMTMsIDE3LCAyMSwgMjUsIDI4LCAzMSwgMzQsIDM3LCA0MF0sXG4gIC8vIE5PVCBVU0VEOiBtaXNyZW1lbWJlcmVkIHZhcmlhbnQgKCszIHRocm91Z2ggd2F2ZSA2LCB0aGVuICsyKSB0aGF0IG9ubHkgcmVhY2hlcyAzMi4gS2VwdCBmb3IgY29tcGFyaXNvbiBvbmx5LlxuICByZWNhbGxlZDogWzksIDEyLCAxNSwgMTgsIDIxLCAyNCwgMjYsIDI4LCAzMCwgMzJdLFxufTtcblxuZXhwb3J0IGNvbnN0IEhFQVJUUyA9IDM7XG5leHBvcnQgY29uc3QgU1RBUlRfSEFORCA9IDQ7XG5leHBvcnQgY29uc3QgV0FWRVMgPSAxMDtcblxuZXhwb3J0IGludGVyZmFjZSBSdWxlcyB7XG4gIC8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUuICovXG4gIGN1cnZlOiBudW1iZXJbXTtcbiAgLyoqXG4gICAqICdkZXBsb3llZE9ubHknOiBvbmx5IHR3byBkZXBsb3llZCB1bml0cyBvZiB0aGUgc2FtZSBzdGFyIGNhbiBtZXJnZSAoZG9jIGFzIHdyaXR0ZW4pLlxuICAgKiAnaGFuZEludG9PbmVTdGFyJzogYWRkaXRpb25hbGx5IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gYmUgcGxheWVkIG9udG8gYSBkZXBsb3llZFxuICAgKiAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsIHRvIG1lcmdlIGltbWVkaWF0ZWx5IChwYXlzIG9ubHkgdGhlIGNvc3QgZGlmZmVyZW5jZSkuXG4gICAqL1xuICBtZXJnZTogJ2RlcGxveWVkT25seScgfCAnaGFuZEludG9PbmVTdGFyJztcbiAgLyoqIENhcmQtaW5mbG93IGtub2JzIChhbGwgb3B0aW9uYWw7IGRlZmF1bHRzIHJlcHJvZHVjZSB0aGUgZG9jKS4gKi9cbiAgc3RhcnRIYW5kPzogbnVtYmVyOyAgICAgICAgICAgIC8vIGRlZmF1bHQgNFxuICBkcmFmdFBpY2tzPzogbnVtYmVyOyAgICAgICAgICAgLy8gY2FyZHMga2VwdCBmcm9tIHRoZSAzLWNhcmQgVmljdG9yeSBEcmFmdCwgZGVmYXVsdCAxXG4gIG5vcm1hbERyYXdXYXZlcz86IG51bWJlcltdOyAgICAvLyB3YXZlcyAoYmVpbmcgZW50ZXJlZCkgdGhhdCBhbHNvIGdpdmUgdGhlIG5vcm1hbCByYW5kb20gZHJhdzsgZGVmYXVsdCA9IGFsbFxuICAvKiogU291bHMgdGhpcyBydW4gbWF5IGRyYXcgZnJvbSAodGhlIGVxdWlwcGVkIFNvdWwgRGVjaywgbWF4IDYpLiBEZWZhdWx0OiBldmVyeSBTb3VsLiAqL1xuICBwb29sPzogU291bElkW107XG4gIHN0YWdlV2F2ZXM/OiBudW1iZXI7ICAgICAgICAgICAvLyB3YXZlcyBpbiB0aGlzIHN0YWdlOyBkZWZhdWx0IDEwICh0aGUgcGxheWFibGUgcHJvdG90eXBlIHVzZXMgMylcbn1cblxuZXhwb3J0IGNvbnN0IEdSSURfQ09MUyA9IDQsIEdSSURfUk9XUyA9IDM7ICAgLy8gNCB4IDMgPSBHUklEX0NFTExTOyBjb2x1bW4gR1JJRF9DT0xTLTEgaXMgdGhlIGZyb250IGxpbmVcbiIsICIvLyBTbWFsbCBzZWVkZWQgUk5HIChtdWxiZXJyeTMyKS4gU2FtZSBzZWVkIC0+IHNhbWUgcnVuLCBzbyBhbnkgYnVnIHJlcG9ydCBpcyByZXByb2R1Y2libGUuXG4vLyBgc3RhdGUoKWAgLyB0aGUgYHJlc3VtZWAgYXJndW1lbnQgbGV0IGEgc2F2ZWQgcnVuIGNvbnRpbnVlIGRyYXdpbmcgZXhhY3RseSB0aGUgY2FyZHMgaXQgd291bGQgaGF2ZSBkcmF3bi5cblxuZXhwb3J0IGludGVyZmFjZSBSbmcge1xuICBuZXh0KCk6IG51bWJlcjsgICAgICAgICAgICAgIC8vIFswLCAxKVxuICBpbnQobjogbnVtYmVyKTogbnVtYmVyOyAgICAgIC8vIFswLCBuKVxuICBwaWNrPFQ+KGl0ZW1zOiByZWFkb25seSBUW10pOiBUO1xuICBzZWVkOiBudW1iZXI7XG4gIHN0YXRlKCk6IG51bWJlcjsgICAgICAgICAgICAgLy8gdGhlIGdlbmVyYXRvcidzIGN1cnJlbnQgcG9zaXRpb24sIGZvciBzYXZpbmcgYSBydW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSbmcoc2VlZDogbnVtYmVyLCByZXN1bWU/OiBudW1iZXIpOiBSbmcge1xuICBsZXQgYSA9IChyZXN1bWUgPz8gc2VlZCkgPj4+IDA7XG4gIGNvbnN0IG5leHQgPSAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBhO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBzZWVkLFxuICAgIG5leHQsXG4gICAgaW50OiAobikgPT4gTWF0aC5mbG9vcihuZXh0KCkgKiBuKSxcbiAgICBwaWNrOiAoaXRlbXMpID0+IGl0ZW1zW01hdGguZmxvb3IobmV4dCgpICogaXRlbXMubGVuZ3RoKV0sXG4gICAgc3RhdGU6ICgpID0+IGEsXG4gIH07XG59XG4iLCAiLy8gUHVyZSBnYW1lIHJ1bGVzIGZvciBvbmUgc3RhZ2UuIE5vIGdyYXBoaWNzLCBubyBjb21iYXQ6IGp1c3QgY2FyZHMsIERvbWluaW9uLCBncmlkLCBtZXJnZSwgd2F2ZXMsIGhlYXJ0cy5cbi8vIEV2ZXJ5IG11dGF0aW9uIGdvZXMgdGhyb3VnaCBhIGZ1bmN0aW9uIGhlcmUgYW5kIGFwcGVuZHMgdG8gc3RhdGUubG9nLCBzbyBydW5zIGNhbiBiZSByZXBsYXllZCBhbmQgaW5zcGVjdGVkLlxuXG5pbXBvcnQgeyBDT1NULCBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUywgU1RBUlRfSEFORCwgV0FWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0IHsgaWQ6IG51bWJlcjsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjsgZnJlc2g/OiBib29sZWFuIH0gICAvLyBmcmVzaCA9IHN1bW1vbmVkIHRoaXMgYnVpbGQgcGhhc2VcblxuZXhwb3J0IGludGVyZmFjZSBTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlcztcbiAgcm5nOiBSbmc7XG4gIHdhdmU6IG51bWJlcjsgICAgICAgICAgICAgICAgIC8vIDEtYmFzZWRcbiAgaGVhcnRzOiBudW1iZXI7XG4gIGNhcDogbnVtYmVyO1xuICBoYW5kOiBTb3VsSWRbXTtcbiAgdW5pdHM6IFVuaXRbXTtcbiAgbmV4dElkOiBudW1iZXI7XG4gIGRpc2NhcmRVc2VkOiBib29sZWFuOyAgICAgICAgIC8vIG9uY2UtcGVyLWJ1aWxkLXBoYXNlIHJlZHJhd1xuICBzdGF0dXM6ICdidWlsZGluZycgfCAnd29uJyB8ICdsb3N0JztcbiAgbG9nOiBzdHJpbmdbXTtcbiAgc3RhdHM6IHsgZHJhd246IG51bWJlcjsgZGlzY2FyZGVkOiBudW1iZXI7IGRpc21pc3NlZDogbnVtYmVyOyBtZXJnZXM6IG51bWJlcjsgZmFpbHVyZXM6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgY29zdCA9IChzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlcik6IG51bWJlciA9PiBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbmV4cG9ydCBjb25zdCBjYXJkc0luID0gKHN0YXI6IG51bWJlcik6IG51bWJlciA9PiAyICoqIChzdGFyIC0gMSk7ICAgICAvLyBjYXJkcyBhIHVuaXQgaXMgXCJ3b3J0aFwiXG5leHBvcnQgY29uc3QgZG9taW5pb25Vc2VkID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY29zdCh1LnNvdWwsIHUuc3RhciksIDApO1xuZXhwb3J0IGNvbnN0IGRvbWluaW9uRnJlZSA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLmNhcCAtIGRvbWluaW9uVXNlZChzKTtcblxuZnVuY3Rpb24gbG9nKHM6IFN0YXRlLCBtc2c6IHN0cmluZykgeyBzLmxvZy5wdXNoKGBbdyR7cy53YXZlfV0gJHttc2d9YCk7IH1cbi8qKiBUaGUgU291bHMgdGhpcyBydW4gZHJhd3MgZnJvbTogdGhlIGVxdWlwcGVkIGRlY2ssIG9yIGV2ZXJ5dGhpbmcgaWYgbm8gZGVjayB3YXMgZ2l2ZW4uICovXG5leHBvcnQgY29uc3QgcG9vbE9mID0gKHM6IFN0YXRlKTogU291bElkW10gPT4gKHMucnVsZXMucG9vbCAmJiBzLnJ1bGVzLnBvb2wubGVuZ3RoID8gcy5ydWxlcy5wb29sIDogU09VTFMpO1xuZnVuY3Rpb24gZHJhdyhzOiBTdGF0ZSwgd2h5OiBzdHJpbmcsIG5vdD86IFNvdWxJZCk6IFNvdWxJZCB7XG4gIGNvbnN0IGFsbCA9IHBvb2xPZihzKSwgb3RoZXJzID0gbm90ID8gYWxsLmZpbHRlcigoeCkgPT4geCAhPT0gbm90KSA6IGFsbDtcbiAgY29uc3QgcG9vbCA9IG90aGVycy5sZW5ndGggPyBvdGhlcnMgOiBhbGw7ICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHN3YXAgbmV2ZXIgaGFuZHMgeW91IGJhY2sgdGhlIFNvdWwgeW91IGdhdmUgdXAgKHVubGVzcyBpdCBpcyB0aGUgb25seSBvbmUgZXF1aXBwZWQpXG4gIGNvbnN0IGMgPSBzLnJuZy5waWNrKHBvb2wpO1xuICBzLmhhbmQucHVzaChjKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYXcgJHtjfSAoJHt3aHl9KWApO1xuICByZXR1cm4gYztcbn1cblxuLyoqIEEgbmV3IGJ1aWxkIHBoYXNlIGJlZ2luczogdGhlIG9uY2UtcGVyLXBoYXNlIHN3YXAgY29tZXMgYmFjayBhbmQgbm90aGluZyBjb3VudHMgYXMgXCJzdW1tb25lZCB0aGlzIHJvdW5kXCIuICovXG5leHBvcnQgZnVuY3Rpb24gbmV3UGhhc2UoczogU3RhdGUpOiB2b2lkIHtcbiAgcy5kaXNjYXJkVXNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgdS5mcmVzaCA9IGZhbHNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3U3RhZ2UocnVsZXM6IFJ1bGVzLCBzZWVkOiBudW1iZXIpOiBTdGF0ZSB7XG4gIGNvbnN0IHM6IFN0YXRlID0ge1xuICAgIHJ1bGVzLCBybmc6IG1ha2VSbmcoc2VlZCksIHdhdmU6IDEsIGhlYXJ0czogSEVBUlRTLCBjYXA6IHJ1bGVzLmN1cnZlWzBdLCBoYW5kOiBbXSwgdW5pdHM6IFtdLCBuZXh0SWQ6IDEsXG4gICAgZGlzY2FyZFVzZWQ6IGZhbHNlLCBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogW10sXG4gICAgc3RhdHM6IHsgZHJhd246IDAsIGRpc2NhcmRlZDogMCwgZGlzbWlzc2VkOiAwLCBtZXJnZXM6IDAsIGZhaWx1cmVzOiAwIH0sXG4gIH07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgKHJ1bGVzLnN0YXJ0SGFuZCA/PyBTVEFSVF9IQU5EKTsgaSsrKSBkcmF3KHMsICdzdGFydGluZyBoYW5kJyk7XG4gIHJldHVybiBzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlZUNlbGwoczogU3RhdGUpOiBudW1iZXIge1xuICBjb25zdCB0YWtlbiA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKCF0YWtlbi5oYXMoYykpIHJldHVybiBjO1xuICByZXR1cm4gLTE7XG59XG5cbi8vIC0tLS0gYnVpbGQtcGhhc2UgYWN0aW9ucyAoZWFjaCByZXR1cm5zIHRydWUgd2hlbiBpdCBoYXBwZW5lZCkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5TdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdO1xuICByZXR1cm4gc291bCAhPT0gdW5kZWZpbmVkICYmIGZyZWVDZWxsKHMpID49IDAgJiYgY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjZWxsRnJlZShzOiBTdGF0ZSwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIHJldHVybiBjZWxsID49IDAgJiYgY2VsbCA8IEdSSURfQ0VMTFMgJiYgIXMudW5pdHMuc29tZSgodSkgPT4gdS5jZWxsID09PSBjZWxsKTtcbn1cblxuLyoqIFN1bW1vbiBhIGhhbmQgY2FyZCBvbnRvIGEgc3BlY2lmaWMgZnJlZSBjZWxsIChkZWZhdWx0OiB0aGUgZmlyc3QgZnJlZSBvbmUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCBjZWxsPzogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3VtbW9uKHMsIGhhbmRJZHgpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChjZWxsICE9PSB1bmRlZmluZWQgJiYgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1OiBVbml0ID0geyBpZDogcy5uZXh0SWQrKywgc291bCwgc3RhcjogMSwgY2VsbDogY2VsbCA/PyBmcmVlQ2VsbChzKSwgZnJlc2g6IHRydWUgfTtcbiAgcy51bml0cy5wdXNoKHUpO1xuICBsb2cocywgYHN1bW1vbiAke3NvdWx9IDEqIC0+IGNlbGwgJHt1LmNlbGx9ICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRGVwbG95ZWQoYTogVW5pdCwgYjogVW5pdCk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5pZCAhPT0gYi5pZCAmJiBhLnNvdWwgPT09IGIuc291bCAmJiBhLnN0YXIgPT09IGIuc3RhciAmJiBhLnN0YXIgPCBNQVhfU1RBUjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRGVwbG95ZWQoczogU3RhdGUsIGFJZDogbnVtYmVyLCBiSWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBhID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBhSWQpLCBiID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBiSWQpO1xuICBpZiAoIWEgfHwgIWIgfHwgIWNhbk1lcmdlRGVwbG95ZWQoYSwgYikpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh1KSA9PiB1LmlkICE9PSBiLmlkKTtcbiAgYS5mcmVzaCA9ICEhKGEuZnJlc2ggfHwgYi5mcmVzaCk7XG4gIGEuc3RhcisrO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlICR7YS5zb3VsfSAke2Euc3RhciAtIDF9Kiske2Euc3RhciAtIDF9KiAtPiAke2Euc3Rhcn0qICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9LCBjZWxscyAke3MudW5pdHMubGVuZ3RofS8ke0dSSURfQ0VMTFN9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqICdoYW5kSW50b09uZVN0YXInIHJ1bGU6IHBsYXkgYSAxLXN0YXIgY2FyZCBvbnRvIGEgZGVwbG95ZWQgMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLnJ1bGVzLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXNvdWwgfHwgIXUgfHwgdS5zb3VsICE9PSBzb3VsIHx8IHUuc3RhciAhPT0gMSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gY29zdChzb3VsLCAyKSAtIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhbk1lcmdlRnJvbUhhbmQocywgaGFuZElkeCwgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHUuc3RhciA9IDI7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UtZnJvbS1oYW5kICR7c291bH0gLT4gJHt1LnNvdWx9IDIqICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRpc21pc3MoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBkaXNtaXNzICR7dS5zb3VsfSAke3Uuc3Rhcn0qIChwZXJtYW5lbnRseSByZW1vdmVkKWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDE6IGRpc2NhcmQgYSBoYW5kIGNhcmQgYW5kIGRyYXcgYSByYW5kb20gY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2NhcmRSZWRyYXcoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5kaXNjYXJkVXNlZCB8fCBoYW5kSWR4IDwgMCB8fCBoYW5kSWR4ID49IHMuaGFuZC5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgYyA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc2NhcmRlZCsrO1xuICBsb2cocywgYHN3YXA6IGRpc2NhcmQgJHtjfWApO1xuICBkcmF3KHMsICdzd2FwJywgYyk7XG4gIHJldHVybiB0cnVlO1xufVxuZXhwb3J0IGNvbnN0IHN3YXBEaXNjYXJkID0gZGlzY2FyZFJlZHJhdztcblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICByZXR1cm4gIXMuZGlzY2FyZFVzZWQgJiYgISF1ICYmICF1LmZyZXNoOyAgICAgICAgICAvLyBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZFxufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMjogc2VsbCBhIGRlcGxveWVkIHVuaXQgKG5vdCBvbmUgc3VtbW9uZWQgdGhpcyByb3VuZCkgYW5kIGRyYXcgYSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gc3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3dhcFNlbGwocywgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYHN3YXA6IHNlbGwgJHt1LnNvdWx9ICR7dS5zdGFyfSpgKTtcbiAgZHJhdyhzLCAnc3dhcCcsIHUuc291bCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbW92ZVVuaXQoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1IHx8ICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBsb2cocywgYG1vdmUgJHt1LnNvdWx9IGNlbGwgJHt1LmNlbGx9IC0+ICR7Y2VsbH1gKTsgdS5jZWxsID0gY2VsbDsgcmV0dXJuIHRydWU7XG59XG5cbi8vIC0tLS0gd2F2ZSByZXN1bHRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERyYWZ0IGNob2ljZXMgZm9yIGFmdGVyIGEgY2xlYXJlZCB3YXZlOiAzIHJhbmRvbSBjYXJkcywgZHVwbGljYXRlcyBhbGxvd2VkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRyYWZ0T3B0aW9ucyhzOiBTdGF0ZSk6IFNvdWxJZFtdIHtcbiAgY29uc3QgcCA9IHBvb2xPZihzKTtcbiAgcmV0dXJuIFtzLnJuZy5waWNrKHApLCBzLnJuZy5waWNrKHApLCBzLnJuZy5waWNrKHApXTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZDogcmFpc2UgdGhlIGNhcCwgcmVzb2x2ZSB0aGUgVmljdG9yeSBEcmFmdCwgZHJhdyAxIG5vcm1hbCBjYXJkLiAqL1xuZXhwb3J0IGNvbnN0IHN0YWdlV2F2ZXMgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5ydWxlcy5zdGFnZVdhdmVzID8/IFdBVkVTO1xuXG4vKiogU3RlcCAxIG9mIGEgY2xlYXJlZCB3YXZlOiBpcyB0aGUgc3RhZ2Ugb3Zlcj8gSWYgbm90LCByYWlzZSB0aGUgY2FwIGFuZCBzdGFydCB0aGUgbmV4dCBidWlsZCBwaGFzZS4gUmV0dXJucyB0cnVlIHdoZW4gdGhlIHN0YWdlIGlzIHdvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlV2F2ZShzOiBTdGF0ZSk6IGJvb2xlYW4ge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBzLnN0YXR1cyA9PT0gJ3dvbic7XG4gIGlmIChzLndhdmUgPj0gc3RhZ2VXYXZlcyhzKSkgeyBzLnN0YXR1cyA9ICd3b24nOyBsb2cocywgJ3N0YWdlIGNsZWFyZWQnKTsgcmV0dXJuIHRydWU7IH1cbiAgcy53YXZlKys7XG4gIHMuY2FwID0gcy5ydWxlcy5jdXJ2ZVtzLndhdmUgLSAxXTtcbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgd2F2ZSBjbGVhcmVkIC0+IGNhcCAke3MuY2FwfWApO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTdGVwIDI6IHRoZSBwbGF5ZXIga2VwdCBgaWR4YCBmcm9tIHRoZSBvZmZlcmVkIGRyYWZ0IGNhcmRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRha2VEcmFmdChzOiBTdGF0ZSwgb3B0czogU291bElkW10sIGlkeDogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IHBpY2sgPSBvcHRzW01hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgaWR4KSldO1xuICBzLmhhbmQucHVzaChwaWNrKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYWZ0IFske29wdHMuam9pbignLCAnKX1dIC0+IHRvb2sgJHtwaWNrfWApO1xufVxuXG4vKiogU3RlcCAzOiB0aGUgYm9udXMgbm9ybWFsIGRyYXcgKG9ubHkgb24gdGhlIHdhdmVzIHRoZSBydWxlcyBhbGxvdykuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsRHJhdyhzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMgPyBzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcy5pbmNsdWRlcyhzLndhdmUpIDogdHJ1ZSkgZHJhdyhzLCAnd2F2ZSBjbGVhcicpO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkIChhbGwgdGhyZWUgc3RlcHMgaW4gb25lIGNhbGwsIGZvciBzaW11bGF0aW9ucykuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJXYXZlKHM6IFN0YXRlLCBjaG9vc2U6IChvcHRzOiBTb3VsSWRbXSkgPT4gbnVtYmVyKTogdm9pZCB7XG4gIGlmIChhZHZhbmNlV2F2ZShzKSkgcmV0dXJuO1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgbGV0IG9wdHMgPSBkcmFmdE9wdGlvbnMocyk7XG4gIGNvbnN0IG9mZmVyZWQgPSBvcHRzLmpvaW4oJywgJyk7XG4gIGNvbnN0IHRvb2s6IFNvdWxJZFtdID0gW107XG4gIGZvciAobGV0IHAgPSAwOyBwIDwgKHMucnVsZXMuZHJhZnRQaWNrcyA/PyAxKTsgcCsrKSB7XG4gICAgY29uc3QgaWR4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBjaG9vc2Uob3B0cykpKTtcbiAgICB0b29rLnB1c2gob3B0c1tpZHhdKTsgcy5oYW5kLnB1c2gob3B0c1tpZHhdKTsgcy5zdGF0cy5kcmF3bisrO1xuICAgIG9wdHMgPSBvcHRzLmZpbHRlcigoXywgaSkgPT4gaSAhPT0gaWR4KTtcbiAgfVxuICBsb2cocywgYGRyYWZ0IFske29mZmVyZWR9XSAtPiB0b29rICR7dG9vay5qb2luKCcsICcpfWApO1xuICBub3JtYWxEcmF3KHMpO1xufVxuXG4vKiogQXJteSB3aXBlZDogbG9zZSBhIGhlYXJ0LCBjYXAgZG9lcyBOT1QgcmlzZSwgZW5lbWllcyByZXNldCwgKzEgY2FyZCwgcmVkcmF3IGFsbG93ZWQgYWdhaW4uICovXG5leHBvcnQgZnVuY3Rpb24gZmFpbFdhdmUoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIHMuaGVhcnRzLS07IHMuc3RhdHMuZmFpbHVyZXMrKztcbiAgaWYgKHMuaGVhcnRzIDw9IDApIHsgcy5zdGF0dXMgPSAnbG9zdCc7IGxvZyhzLCAnbm8gaGVhcnRzIGxlZnQ6IHN0YWdlIGxvc3QnKTsgcmV0dXJuOyB9XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYGFybXkgd2lwZWQ6IGhlYXJ0cyAke3MuaGVhcnRzfSwgY2FwIHN0YXlzICR7cy5jYXB9YCk7XG4gIGRyYXcocywgJ2ZhaWxlZCBhdHRlbXB0Jyk7XG59XG5cbi8vIC0tLS0gaW52YXJpYW50cyAoY2FsbGVkIGJ5IHRoZSBzaW11bGF0b3IgYWZ0ZXIgZXZlcnkgd2F2ZTsgdGhyb3cgd2l0aCBhIHJlYWRhYmxlIG1lc3NhZ2UpIC0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrSW52YXJpYW50cyhzOiBTdGF0ZSk6IHZvaWQge1xuICBjb25zdCBmYWlsID0gKG06IHN0cmluZykgPT4geyB0aHJvdyBuZXcgRXJyb3IoYElOVkFSSUFOVCAke219XFxuYCArIHMubG9nLnNsaWNlKC0xMikuam9pbignXFxuJykpOyB9O1xuICBpZiAocy51bml0cy5sZW5ndGggPiBHUklEX0NFTExTKSBmYWlsKGBtb3JlIHVuaXRzICgke3MudW5pdHMubGVuZ3RofSkgdGhhbiBjZWxsc2ApO1xuICBjb25zdCBjZWxscyA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBpZiAoY2VsbHMuc2l6ZSAhPT0gcy51bml0cy5sZW5ndGgpIGZhaWwoJ3R3byB1bml0cyBzaGFyZSBhIGNlbGwnKTtcbiAgaWYgKGRvbWluaW9uVXNlZChzKSA+IHMuY2FwKSBmYWlsKGBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0gZXhjZWVkcyBjYXAgJHtzLmNhcH1gKTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIGlmICh1LnN0YXIgPCAxIHx8IHUuc3RhciA+IE1BWF9TVEFSKSBmYWlsKGB1bml0IHN0YXIgJHt1LnN0YXJ9IG91dCBvZiByYW5nZWApO1xuICAvLyBldmVyeSBkcmF3biBjYXJkIGlzIGVpdGhlciBpbiBoYW5kLCB3b3J0aCBjYXJkcyBvbiB0aGUgZmllbGQsIGRpc2NhcmRlZCwgb3IgZGlzbWlzc2VkXG4gIGNvbnN0IG9uRmllbGQgPSBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNhcmRzSW4odS5zdGFyKSwgMCk7XG4gIGNvbnN0IGFjY291bnRlZCA9IHMuaGFuZC5sZW5ndGggKyBvbkZpZWxkICsgcy5zdGF0cy5kaXNjYXJkZWQgKyBzLnN0YXRzLmRpc21pc3NlZDtcbiAgaWYgKGFjY291bnRlZCAhPT0gcy5zdGF0cy5kcmF3bikgZmFpbChgY2FyZCBjb25zZXJ2YXRpb246IGRyYXduICR7cy5zdGF0cy5kcmF3bn0gIT0gYWNjb3VudGVkICR7YWNjb3VudGVkfWApO1xufVxuIiwgIi8vIEF1dG8tYmF0dGxlIHNpbXVsYXRpb246IHB1cmUgbG9naWMsIG5vIGdyYXBoaWNzLiBEZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHNlZWQuXG4vLyBUaGUgcmVuZGVyZXIgb25seSByZWFkcyBmaWdodGVycyArIGV2ZW50czsgaXQgbmV2ZXIgZGVjaWRlcyBhbnl0aGluZy5cbi8vXG4vLyBBYmlsaXRpZXMgKG51bWJlcnMgbGl2ZSBpbiBiYWxhbmNlLnRzKTpcbi8vICAgU2tlbGV0b24gV2FycmlvciAgUGhhbGFueCAgICAgdGFrZXMgbGVzcyBkYW1hZ2UgZm9yIGVhY2ggbmVhcmJ5IGFsbGllZCBXYXJyaW9yIChjYXBwZWQpXG4vLyAgIFNrZWxldG9uIEFyY2hlciAgIFNwbGl0IEFycm93IChza2lsbCkgb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllczsgYmFzaWMgc2hvdHMgYXJlIGEgc2luZ2xlIGFycm93XG4vLyAgIEdvYmxpbiAgICAgICAgICAgIE9wcG9ydHVuaXN0ICtkYW1hZ2Ugb24gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2U7IHByZWZlcnMgc3VjaCB0YXJnZXRzXG4vLyAgIEtuaWdodCAgICAgICAgICAgIFRhdW50IChza2lsbCkgIGZvcmNlcyBuZWFyYnkgZW5lbWllcyB0byBhdHRhY2sgaGltXG4vLyAgIE9ncmUgICAgICAgICAgICAgIFNtYXNoIChza2lsbCkgIGhlYXZ5IHNsYW0gdGhhdCBhbHNvIGhpdHMgZW5lbWllcyBuZWFyIHRoZSBpbXBhY3Rcbi8vIFNraWxscyBydW4gb24gbWFuYTogYmFzaWMgYXR0YWNrcyBhbmQgZGFtYWdlIHRha2VuIGZpbGwgYSBiYXI7IHdoZW4gZnVsbCwgdGhlIG5leHQgYXR0YWNrIGlzIHRoZSBza2lsbCBhbmQgdGhlIGJhciByZXNldHMuXG4vLyBXYXJyaW9yLCBHb2JsaW4gYW5kIEJhcmJhcmlhbiBoYXZlIHBhc3NpdmVzIG9ubHkgKG5vIG1hbmEpLlxuLy8gICBCYXJiYXJpYW4gICAgICAgICBGcmVuenkgICAgICBhdHRhY2tzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmdcblxuaW1wb3J0IHsgR1JJRF9DT0xTLCBHUklEX1JPV1MgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBjb25zdCBHUklEX1NQID0gMS4zOyAgICAgLy8gbWV0cmVzIGJldHdlZW4gZ3JpZCBjZWxsc1xuZXhwb3J0IGNvbnN0IEZST05UX1ggPSAxLjc7ICAgICAvLyBmcm9udCBsaW5lJ3MgZGlzdGFuY2UgZnJvbSB0aGUgY2VudHJlIGxpbmVcblxuZXhwb3J0IGludGVyZmFjZSBTbG90IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5cbi8qKiBXb3JsZCBwb3NpdGlvbiBvZiBhIGdyaWQgY2VsbCBmb3IgYSB0ZWFtICh0ZWFtIDAgPSBsZWZ0LCBmYWNlcyArWDsgdGVhbSAxID0gcmlnaHQsIGZhY2VzIC1YKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjZWxsUG9zKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpOiB7IHg6IG51bWJlcjsgejogbnVtYmVyIH0ge1xuICBjb25zdCByb3cgPSBNYXRoLmZsb29yKGNlbGwgLyBHUklEX0NPTFMpLCBjb2wgPSBjZWxsICUgR1JJRF9DT0xTO1xuICBjb25zdCBkZXB0aCA9IEdSSURfQ09MUyAtIDEgLSBjb2w7ICAgICAgICAgICAgICAgICAgICAgICAvLyAwID0gZnJvbnQgbGluZVxuICByZXR1cm4geyB4OiAoRlJPTlRfWCArIGRlcHRoICogR1JJRF9TUCkgKiAodGVhbSA9PT0gMCA/IC0xIDogMSksIHo6IChyb3cgLSAoR1JJRF9ST1dTIC0gMSkgLyAyKSAqIEdSSURfU1AgfTtcbn1cblxuY29uc3QgRlJPTlRORVNTOiBSZWNvcmQ8U291bElkLCBudW1iZXI+ID0geyBrbmlnaHQ6IDUsIG9ncmU6IDQsIHdhcnJpb3I6IDMsIGJhcmJhcmlhbjogMywgZ29ibGluOiAyLCBhcmNoZXI6IDAgfTtcbi8qKiBUaGUgZW5lbXkgYXJteSBpcyBwbGFjZWQgYXV0b21hdGljYWxseSAodGFua3MgdXAgZnJvbnQsIGFyY2hlcnMgYmVoaW5kKTsgdGhlIHBsYXllciBvbmx5IGV2ZXIgc2VlcyBpdHMgY29tcG9zaXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlDZWxscyhzcGVjczogU3BlY1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBjZWxsczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NPTFMgKiBHUklEX1JPV1M7IGMrKykgY2VsbHMucHVzaChjKTtcbiAgY2VsbHMuc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IGRhID0gR1JJRF9DT0xTIC0gMSAtIChhICUgR1JJRF9DT0xTKSwgZGIgPSBHUklEX0NPTFMgLSAxIC0gKGIgJSBHUklEX0NPTFMpO1xuICAgIGlmIChkYSAhPT0gZGIpIHJldHVybiBkYSAtIGRiO1xuICAgIHJldHVybiBNYXRoLmFicyhNYXRoLmZsb29yKGEgLyBHUklEX0NPTFMpIC0gMSkgLSBNYXRoLmFicyhNYXRoLmZsb29yKGIgLyBHUklEX0NPTFMpIC0gMSk7XG4gIH0pO1xuICBjb25zdCBvcmRlciA9IHNwZWNzLm1hcCgocywgaSkgPT4gaSkuc29ydCgoaSwgaikgPT4gRlJPTlRORVNTW3NwZWNzW2pdLnNvdWxdIC0gRlJPTlRORVNTW3NwZWNzW2ldLnNvdWxdKTtcbiAgY29uc3Qgb3V0ID0gbmV3IEFycmF5PG51bWJlcj4oc3BlY3MubGVuZ3RoKTtcbiAgb3JkZXIuZm9yRWFjaCgoaWR4LCBrKSA9PiB7IG91dFtpZHhdID0gY2VsbHNba107IH0pO1xuICByZXR1cm4gb3V0O1xufVxuXG5leHBvcnQgdHlwZSBGU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYWQnO1xuZXhwb3J0IGludGVyZmFjZSBGaWdodGVyIHtcbiAgaWQ6IG51bWJlcjsgdGVhbTogMCB8IDE7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7XG4gIHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc6IG51bWJlcjtcbiAgaHA6IG51bWJlcjsgbWF4SHA6IG51bWJlcjsgZG1nOiBudW1iZXI7IGludGVydmFsOiBudW1iZXI7IHJhbmdlOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IHJhZGl1czogbnVtYmVyO1xuICBhbGl2ZTogYm9vbGVhbjsgc3RhdGU6IEZTdGF0ZTtcbiAgdGFyZ2V0OiBudW1iZXI7IHJldGFyZ2V0QXQ6IG51bWJlcjsgZm9yY2VkVGFyZ2V0OiBudW1iZXI7IGZvcmNlZFVudGlsOiBudW1iZXI7XG4gIG5leHRBdHRhY2s6IG51bWJlcjsgYXR0YWNrU3RhcnQ6IG51bWJlcjsgYXR0YWNrRHVyOiBudW1iZXI7IGFuaW1TcGVlZDogbnVtYmVyOyBoaXREb25lOiBib29sZWFuO1xuICBtYW5hOiBudW1iZXI7IG1heE1hbmE6IG51bWJlcjsgY2FzdGluZzogYm9vbGVhbjsgZnJlbnp5OiBudW1iZXI7IGRlYWRBdDogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBCRXZlbnQgPVxuICB8IHsgdDogJ3N3aW5nJzsgaWQ6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2hpdCc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXI7IGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAnYXJyb3cnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdkZWF0aCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ2Nhc3QnOyBpZDogbnVtYmVyOyBza2lsbDogJ3NwbGl0JyB8ICd0YXVudCcgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICd0YXVudCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ3NtYXNoJzsgaWQ6IG51bWJlcjsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHI6IG51bWJlciB9XG4gIHwgeyB0OiAnZnJlbnp5JzsgaWQ6IG51bWJlcjsgc3RhY2tzOiBudW1iZXIgfTtcblxuZXhwb3J0IGNsYXNzIEJhdHRsZSB7XG4gIHRpbWUgPSAwO1xuICBmaWdodGVyczogRmlnaHRlcltdID0gW107XG4gIGV2ZW50czogQkV2ZW50W10gPSBbXTtcbiAgd2lubmVyOiAtMSB8IDAgfCAxID0gLTE7XG4gIHJuZzogUm5nO1xuICBwcml2YXRlIHBlbmRpbmc6IHsgYXQ6IG51bWJlcjsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlciB9W10gPSBbXTtcbiAgcHJpdmF0ZSBuZXh0SWQgPSAxO1xuICBwcml2YXRlIGVuZW15UG93ZXIgPSAxO1xuICBwcml2YXRlIGZsaXAgPSBmYWxzZTtcblxuICAvKiogYGxldmVsc2A6IHRoZSBwbGF5ZXIncyBwZXJtYW5lbnQgU291bCBsZXZlbHMgKGhlYWx0aCBhbmQgZGFtYWdlIGdyb3cgYSBsaXR0bGUgcGVyIGxldmVsKS4gRW5lbWllcyBuZXZlciB1c2UgdGhlbS4gKi9cbiAgLyoqIGBlbmVteVBvd2VyYDogaGVhbHRoIGFuZCBkYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGVuZW15IHRlYW0gb25seSAoc3RhZ2Ugc3RyZW5ndGg7IDEgPSBhcyB3cml0dGVuKS4gKi9cbiAgY29uc3RydWN0b3IocGxheWVyczogU2xvdFtdLCBlbmVtaWVzOiBTcGVjW10sIHNlZWQgPSAxLCBsZXZlbHM/OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+LCBlbmVteVBvd2VyID0gMSkge1xuICAgIHRoaXMucm5nID0gbWFrZVJuZyhzZWVkKTsgdGhpcy5lbmVteVBvd2VyID0gZW5lbXlQb3dlcjtcbiAgICBmb3IgKGNvbnN0IHAgb2YgcGxheWVycykgdGhpcy5hZGQoMCwgcC5zb3VsLCBwLnN0YXIsIHAuY2VsbCwgbGV2ZWxzPy5bcC5zb3VsXSA/PyAxKTtcbiAgICBjb25zdCBjZWxscyA9IGVuZW15Q2VsbHMoZW5lbWllcyk7XG4gICAgZW5lbWllcy5mb3JFYWNoKChlLCBpKSA9PiB0aGlzLmFkZCgxLCBlLnNvdWwsIGUuc3RhciwgY2VsbHNbaV0pKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkKHRlYW06IDAgfCAxLCBzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlciwgY2VsbDogbnVtYmVyLCBsZXZlbCA9IDEpOiBGaWdodGVyIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW3NvdWxdLCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKTtcbiAgICBjb25zdCBsdkhwID0gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEIubGV2ZWwuaHAsIGx2RG1nID0gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEIubGV2ZWwuZG1nO1xuICAgIGNvbnN0IHB3ID0gdGVhbSA9PT0gMSA/IHRoaXMuZW5lbXlQb3dlciA6IDE7XG4gICAgY29uc3QgaHAgPSBzdC5ocCAqIEIuc3Rhci5ocFtzdGFyIC0gMV0gKiBsdkhwICogcHc7XG4gICAgY29uc3QgZjogRmlnaHRlciA9IHtcbiAgICAgIGlkOiB0aGlzLm5leHRJZCsrLCB0ZWFtLCBzb3VsLCBzdGFyLCBjZWxsLCB4OiBwLngsIHo6IHAueiwgeWF3OiB0ZWFtID09PSAwID8gMCA6IE1hdGguUEksXG4gICAgICBocCwgbWF4SHA6IGhwLCBkbWc6IHN0LmRtZyAqIEIuc3Rhci5kbWdbc3RhciAtIDFdICogbHZEbWcgKiBwdywgaW50ZXJ2YWw6IHN0LmludGVydmFsLCByYW5nZTogc3QucmFuZ2UsIHNwZWVkOiBzdC5zcGVlZCwgcmFkaXVzOiBzdC5zaXplICogQi5zdGFyLnNjYWxlW3N0YXIgLSAxXSxcbiAgICAgIGFsaXZlOiB0cnVlLCBzdGF0ZTogJ2lkbGUnLCB0YXJnZXQ6IC0xLCByZXRhcmdldEF0OiAwLCBmb3JjZWRUYXJnZXQ6IC0xLCBmb3JjZWRVbnRpbDogMCxcbiAgICAgIG5leHRBdHRhY2s6IHRoaXMucm5nLm5leHQoKSAqIDAuMywgYXR0YWNrU3RhcnQ6IC05LCBhdHRhY2tEdXI6IDEsIGFuaW1TcGVlZDogMSwgaGl0RnJhYzogMCwgaGl0RG9uZTogdHJ1ZSxcbiAgICAgIG1hbmE6IDAsIG1heE1hbmE6IEIubWFuYVtzb3VsXT8ubWF4ID8/IDAsIGNhc3Rpbmc6IGZhbHNlLCBmcmVuenk6IDAsIGRlYWRBdDogMCxcbiAgICB9IGFzIEZpZ2h0ZXI7XG4gICAgdGhpcy5maWdodGVycy5wdXNoKGYpOyByZXR1cm4gZjtcbiAgfVxuXG4gIGJ5SWQoaWQ6IG51bWJlcik6IEZpZ2h0ZXIgfCB1bmRlZmluZWQgeyByZXR1cm4gaWQgPCAwID8gdW5kZWZpbmVkIDogdGhpcy5maWdodGVyc1tpZCAtIDFdOyB9XG4gIGZvZXMoZjogRmlnaHRlcik6IEZpZ2h0ZXJbXSB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigobykgPT4gby5hbGl2ZSAmJiBvLnRlYW0gIT09IGYudGVhbSk7IH1cbiAgY291bnQodGVhbTogMCB8IDEpOiBudW1iZXIgeyByZXR1cm4gdGhpcy5maWdodGVycy5yZWR1Y2UoKG4sIGYpID0+IG4gKyAoZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHRlYW0gPyAxIDogMCksIDApOyB9XG4gIGRyYWluKCk6IEJFdmVudFtdIHsgY29uc3QgZSA9IHRoaXMuZXZlbnRzOyB0aGlzLmV2ZW50cyA9IFtdOyByZXR1cm4gZTsgfVxuXG4gIHN0ZXAoZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0aGlzLndpbm5lciA+PSAwKSByZXR1cm47XG4gICAgdGhpcy50aW1lICs9IGR0OyB0aGlzLmZsaXAgPSAhdGhpcy5mbGlwO1xuICAgIC8vIGFycm93cyB0aGF0IGhhdmUgZmluaXNoZWQgZmx5aW5nXG4gICAgZm9yIChsZXQgaSA9IHRoaXMucGVuZGluZy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgcCA9IHRoaXMucGVuZGluZ1tpXTtcbiAgICAgIGlmICh0aGlzLnRpbWUgPj0gcC5hdCkge1xuICAgICAgICB0aGlzLnBlbmRpbmcuc3BsaWNlKGksIDEpO1xuICAgICAgICBjb25zdCB0byA9IHRoaXMuYnlJZChwLnRvKSwgZnJvbSA9IHRoaXMuYnlJZChwLmZyb20pO1xuICAgICAgICBpZiAodG8gJiYgdG8uYWxpdmUgJiYgZnJvbSkgdGhpcy5kYW1hZ2UodG8sIHAuZG1nLCBmcm9tLCAnYXJyb3cnKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgb3JkZXIgPSB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSk7IGlmICh0aGlzLmZsaXApIG9yZGVyLnJldmVyc2UoKTtcbiAgICBmb3IgKGNvbnN0IGYgb2Ygb3JkZXIpIGlmIChmLmFsaXZlKSB0aGlzLnVwZGF0ZShmLCBkdCk7XG4gICAgY29uc3QgYSA9IHRoaXMuY291bnQoMCksIGIgPSB0aGlzLmNvdW50KDEpO1xuICAgIGlmICghYSB8fCAhYikgdGhpcy53aW5uZXIgPSBhID8gMCA6IDE7XG4gICAgZWxzZSBpZiAodGhpcy50aW1lID49IEJBTEFOQ0Uuc2ltLnRpbWVMaW1pdCkge1xuICAgICAgY29uc3QgaHAgPSAodDogMCB8IDEpID0+IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdCkucmVkdWNlKChuLCBmKSA9PiBuICsgZi5ocCAvIGYubWF4SHAsIDApO1xuICAgICAgdGhpcy53aW5uZXIgPSBocCgwKSA+IGhwKDEpID8gMCA6IDE7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBlci1maWdodGVyIHVwZGF0ZVxuICBwcml2YXRlIHVwZGF0ZShmOiBGaWdodGVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tmLnNvdWxdO1xuICAgIHRoaXMuc2VwYXJhdGUoZiwgZHQpO1xuXG4gICAgaWYgKGYuc3RhdGUgPT09ICdhdHRhY2snKSB7XG4gICAgICBjb25zdCB0ID0gdGhpcy50aW1lIC0gZi5hdHRhY2tTdGFydDtcbiAgICAgIGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKHRnICYmIHRnLmFsaXZlKSB0aGlzLmZhY2UoZiwgdGcueCAtIGYueCwgdGcueiAtIGYueiwgZHQpO1xuICAgICAgaWYgKCFmLmhpdERvbmUgJiYgdCA+PSBmLmF0dGFja0R1ciAqIHN0LmhpdEZyYWMpIHsgZi5oaXREb25lID0gdHJ1ZTsgdGhpcy5yZXNvbHZlSGl0KGYpOyB9XG4gICAgICBpZiAodCA+PSBmLmF0dGFja0R1cikgZi5zdGF0ZSA9ICdpZGxlJztcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5hY3F1aXJlKGYpO1xuICAgIGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTtcbiAgICBpZiAoIXRnIHx8ICF0Zy5hbGl2ZSkgeyBmLnN0YXRlID0gJ2lkbGUnOyB0aGlzLmZyZW56eURlY2F5KGYpOyByZXR1cm47IH1cbiAgICBjb25zdCBkeCA9IHRnLnggLSBmLngsIGR6ID0gdGcueiAtIGYueiwgZGlzdCA9IE1hdGguaHlwb3QoZHgsIGR6KTtcbiAgICB0aGlzLmZhY2UoZiwgZHgsIGR6LCBkdCk7XG4gICAgaWYgKGRpc3QgPD0gZi5yYW5nZSkge1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBmLm5leHRBdHRhY2spIHRoaXMuc3RhcnRBdHRhY2soZik7IGVsc2UgeyBmLnN0YXRlID0gJ2lkbGUnOyB0aGlzLmZyZW56eURlY2F5KGYpOyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGYuc3RhdGUgPSAncnVuJzsgY29uc3QgayA9IGYuc3BlZWQgKiBkdCAvIE1hdGgubWF4KGRpc3QsIDFlLTQpOyBmLnggKz0gZHggKiBrOyBmLnogKz0gZHogKiBrOyB0aGlzLmZyZW56eURlY2F5KGYpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZnJlbnp5RGVjYXkoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLnNvdWwgPT09ICdiYXJiYXJpYW4nICYmIGYuZnJlbnp5ID4gMCAmJiB0aGlzLnRpbWUgLSAoZi5hdHRhY2tTdGFydCArIGYuYXR0YWNrRHVyKSA+IEJBTEFOQ0UuZnJlbnp5LnJlc2V0QWZ0ZXIpIGYuZnJlbnp5ID0gMDtcbiAgfVxuXG4gIHByaXZhdGUgZmFjZShmOiBGaWdodGVyLCBkeDogbnVtYmVyLCBkejogbnVtYmVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKGR4ICogZHggKyBkeiAqIGR6IDwgMWUtNikgcmV0dXJuO1xuICAgIGNvbnN0IHdhbnQgPSBNYXRoLmF0YW4yKGR4LCBkeik7IGxldCBkID0gKCh3YW50IC0gZi55YXcgKyBNYXRoLlBJKSAlICgyICogTWF0aC5QSSkgKyAyICogTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpIC0gTWF0aC5QSTtcbiAgICBmLnlhdyArPSBNYXRoLm1heCgtOSAqIGR0LCBNYXRoLm1pbig5ICogZHQsIGQpKTtcbiAgfVxuXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGxldCBweCA9IDAsIHB6ID0gMDtcbiAgICBmb3IgKGNvbnN0IG8gb2YgdGhpcy5maWdodGVycykge1xuICAgICAgaWYgKG8gPT09IGYgfHwgIW8uYWxpdmUpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZHggPSBmLnggLSBvLngsIGR6ID0gZi56IC0gby56LCBtID0gTWF0aC5oeXBvdChkeCwgZHopLCB3YW50ID0gKGYucmFkaXVzICsgby5yYWRpdXMpICogMS4wNSArIDAuMDg7XG4gICAgICBpZiAobSA+PSB3YW50KSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGsgPSAod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMyk7IHB4ICs9IChtIDwgMWUtMyA/ICh0aGlzLnJuZy5uZXh0KCkgLSAwLjUpIDogZHgpICogazsgcHogKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeikgKiBrO1xuICAgIH1cbiAgICBjb25zdCBzID0gTWF0aC5taW4oMSwgZHQgKiA2KTsgZi54ICs9IHB4ICogczsgZi56ICs9IHB6ICogcztcbiAgfVxuXG4gIHByaXZhdGUgYWNxdWlyZShmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgaWYgKGYuZm9yY2VkVGFyZ2V0ID49IDApIHtcbiAgICAgIGNvbnN0IGZ0ID0gdGhpcy5ieUlkKGYuZm9yY2VkVGFyZ2V0KTtcbiAgICAgIGlmIChmdCAmJiBmdC5hbGl2ZSAmJiB0aGlzLnRpbWUgPCBmLmZvcmNlZFVudGlsKSB7IGYudGFyZ2V0ID0gZnQuaWQ7IHJldHVybjsgfVxuICAgICAgZi5mb3JjZWRUYXJnZXQgPSAtMTtcbiAgICB9XG4gICAgY29uc3QgY3VyID0gdGhpcy5ieUlkKGYudGFyZ2V0KTtcbiAgICBpZiAoY3VyICYmIGN1ci5hbGl2ZSAmJiB0aGlzLnRpbWUgPCBmLnJldGFyZ2V0QXQpIHJldHVybjtcbiAgICBmLnJldGFyZ2V0QXQgPSB0aGlzLnRpbWUgKyBCQUxBTkNFLnNpbS5yZXRhcmdldEV2ZXJ5ICogKDAuOCArIDAuNCAqIHRoaXMucm5nLm5leHQoKSk7XG4gICAgY29uc3QgZm9lcyA9IHRoaXMuZm9lcyhmKTsgaWYgKCFmb2VzLmxlbmd0aCkgeyBmLnRhcmdldCA9IC0xOyByZXR1cm47IH1cbiAgICBsZXQgYmVzdCA9IGZvZXNbMF0sIGJzID0gSW5maW5pdHk7XG4gICAgZm9yIChjb25zdCBvIG9mIGZvZXMpIHtcbiAgICAgIGxldCBzY29yZSA9IE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicpIHtcbiAgICAgICAgLy8ga2lsbC1zdGVhbDogcHJlZmVyIG5lYXJieSBlbmVtaWVzIGFscmVhZHkgZmlnaHRpbmcgb25lIG9mIG91ciBhbGxpZXMsIGFuZCB3b3VuZGVkIG9uZXNcbiAgICAgICAgY29uc3QgZW5nYWdlZCA9IHRoaXMuYnlJZChvLnRhcmdldCk7IGNvbnN0IGJ1c3kgPSAhIWVuZ2FnZWQgJiYgZW5nYWdlZC5hbGl2ZSAmJiBlbmdhZ2VkLnRlYW0gPT09IGYudGVhbSAmJiBlbmdhZ2VkLmlkICE9PSBmLmlkO1xuICAgICAgICBpZiAoYnVzeSAmJiBzY29yZSA8IEJBTEFOQ0Uub3Bwb3J0dW5pc3Quc2Vla1JhZGl1cyArIDIpIHNjb3JlIC09IDM7XG4gICAgICAgIHNjb3JlIC09IEJBTEFOQ0Uub3Bwb3J0dW5pc3Qud291bmRlZFdlaWdodCAqICgxIC0gby5ocCAvIG8ubWF4SHApO1xuICAgICAgfVxuICAgICAgaWYgKHNjb3JlIDwgYnMpIHsgYnMgPSBzY29yZTsgYmVzdCA9IG87IH1cbiAgICB9XG4gICAgZi50YXJnZXQgPSBiZXN0LmlkO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGFydEF0dGFjayhmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tmLnNvdWxdOyBsZXQgZWZmID0gZi5pbnRlcnZhbDtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJykgeyBmLmZyZW56eSA9IE1hdGgubWluKEIuZnJlbnp5Lm1heFN0YWNrcywgZi5mcmVuenkgKyAxKTsgZWZmID0gZi5pbnRlcnZhbCAvICgxICsgZi5mcmVuenkgKiBCLmZyZW56eS5wZXJTd2luZyk7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZnJlbnp5JywgaWQ6IGYuaWQsIHN0YWNrczogZi5mcmVuenkgfSk7IH1cbiAgICBmLmF0dGFja0R1ciA9IE1hdGgubWluKHN0LmFuaW1MZW4sIGVmZiAqIDAuOTUpOyBmLmFuaW1TcGVlZCA9IHN0LmFuaW1MZW4gLyBmLmF0dGFja0R1cjtcbiAgICBmLmF0dGFja1N0YXJ0ID0gdGhpcy50aW1lOyBmLm5leHRBdHRhY2sgPSB0aGlzLnRpbWUgKyBNYXRoLm1heChlZmYsIGYuYXR0YWNrRHVyKTsgZi5oaXREb25lID0gZmFsc2U7IGYuc3RhdGUgPSAnYXR0YWNrJztcbiAgICBmLmNhc3RpbmcgPSBmLm1heE1hbmEgPiAwICYmIGYubWFuYSA+PSBmLm1heE1hbmE7IGlmIChmLmNhc3RpbmcpIHsgZi5tYW5hID0gMDsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdjYXN0JywgaWQ6IGYuaWQsIHNraWxsOiBmLnNvdWwgPT09ICdhcmNoZXInID8gJ3NwbGl0JyA6IGYuc291bCA9PT0gJ2tuaWdodCcgPyAndGF1bnQnIDogJ3NtYXNoJyB9KTsgfVxuICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc3dpbmcnLCBpZDogZi5pZCwgc3BlZWQ6IGYuYW5pbVNwZWVkLCBkdXI6IGYuYXR0YWNrRHVyIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlSGl0KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAoIXRnIHx8ICF0Zy5hbGl2ZSkgcmV0dXJuO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbZi5zb3VsXTsgaWYgKE0gJiYgIWYuY2FzdGluZykgZi5tYW5hID0gTWF0aC5taW4oTS5tYXgsIGYubWFuYSArIE0ucGVyQXR0YWNrKTtcbiAgICBpZiAoZi5zb3VsID09PSAnYXJjaGVyJykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBiYXNpYzogb25lIGFycm93LiBTa2lsbCAoU3BsaXQgQXJyb3cpOiBvbmUgYXJyb3cgYXQgZWFjaCBvZiB1cCB0byAzIGRpZmZlcmVudCBlbmVtaWVzXG4gICAgICBjb25zdCByZWFjaCA9IGYucmFuZ2UgKiAxLjI1O1xuICAgICAgY29uc3QgZm9lcyA9IHRoaXMuZm9lcyhmKS5tYXAoKG8pID0+ICh7IG8sIGQ6IE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIH0pKS5maWx0ZXIoKGUpID0+IGUuZCA8PSByZWFjaCkuc29ydCgoYSwgYikgPT4gYS5kIC0gYi5kKTtcbiAgICAgIGNvbnN0IHBpY2tlZCA9IGYuY2FzdGluZyA/IFt0ZywgLi4uZm9lcy5tYXAoKGUpID0+IGUubykuZmlsdGVyKChvKSA9PiBvLmlkICE9PSB0Zy5pZCldLnNsaWNlKDAsIEIudm9sbGV5LnRhcmdldHMpIDogW3RnXTtcbiAgICAgIGZvciAoY29uc3QgbyBvZiBwaWNrZWQpIHtcbiAgICAgICAgY29uc3QgZHVyID0gTWF0aC5tYXgoMC4xNSwgTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgLyBCLnZvbGxleS5wcm9qZWN0aWxlU3BlZWQpO1xuICAgICAgICB0aGlzLnBlbmRpbmcucHVzaCh7IGF0OiB0aGlzLnRpbWUgKyBkdXIsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkbWc6IGYuZG1nIH0pO1xuICAgICAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2Fycm93JywgZnJvbTogZi5pZCwgdG86IG8uaWQsIGR1ciB9KTtcbiAgICAgIH1cbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlOyByZXR1cm47XG4gICAgfVxuICAgIGlmIChNYXRoLmh5cG90KHRnLnggLSBmLngsIHRnLnogLSBmLnopID4gZi5yYW5nZSAqIDEuNSkgeyBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuOyB9ICAgLy8gdGFyZ2V0IHNsaXBwZWQgYXdheTogdGhlIGJsb3cgbWlzc2VzXG4gICAgbGV0IGRtZyA9IGYuZG1nO1xuICAgIGlmIChmLnNvdWwgPT09ICdnb2JsaW4nKSB7IGNvbnN0IGVuZyA9IHRoaXMuYnlJZCh0Zy50YXJnZXQpOyBpZiAoZW5nICYmIGVuZy5hbGl2ZSAmJiBlbmcudGVhbSA9PT0gZi50ZWFtICYmIGVuZy5pZCAhPT0gZi5pZCkgZG1nICo9IDEgKyBCLm9wcG9ydHVuaXN0LmJvbnVzOyB9XG4gICAgaWYgKGYuY2FzdGluZykge1xuICAgICAgZi5jYXN0aW5nID0gZmFsc2U7XG4gICAgICBpZiAoZi5zb3VsID09PSAnb2dyZScpIHtcbiAgICAgICAgZG1nICo9IEIuc21hc2gubXVsdDsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdzbWFzaCcsIGlkOiBmLmlkLCB4OiB0Zy54LCB6OiB0Zy56LCByOiBCLnNtYXNoLnJhZGl1cyB9KTtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKG8uaWQgIT09IHRnLmlkICYmIE1hdGguaHlwb3Qoby54IC0gdGcueCwgby56IC0gdGcueikgPD0gQi5zbWFzaC5yYWRpdXMpIHRoaXMuZGFtYWdlKG8sIGRtZyAqIDAuNiwgZiwgJ3NtYXNoJyk7XG4gICAgICAgIHRoaXMuZGFtYWdlKHRnLCBkbWcsIGYsICdzbWFzaCcpOyByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAna25pZ2h0Jykge1xuICAgICAgICBmb3IgKGNvbnN0IG8gb2YgdGhpcy5mb2VzKGYpKSBpZiAoTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgPD0gQi50YXVudC5yYWRpdXMpIHsgby5mb3JjZWRUYXJnZXQgPSBmLmlkOyBvLmZvcmNlZFVudGlsID0gdGhpcy50aW1lICsgQi50YXVudC5kdXJhdGlvbjsgby5yZXRhcmdldEF0ID0gMDsgfVxuICAgICAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3RhdW50JywgaWQ6IGYuaWQgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuZGFtYWdlKHRnLCBkbWcsIGYsICdtZWxlZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBkYW1hZ2UodDogRmlnaHRlciwgYW1vdW50OiBudW1iZXIsIGZyb206IEZpZ2h0ZXIsIGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyk6IHZvaWQge1xuICAgIGlmICghdC5hbGl2ZSkgcmV0dXJuO1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFOyBsZXQgcmVkID0gMDtcbiAgICBpZiAodC5zb3VsID09PSAnd2FycmlvcicpIHtcbiAgICAgIGNvbnN0IG4gPSB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigobykgPT4gby5hbGl2ZSAmJiBvICE9PSB0ICYmIG8udGVhbSA9PT0gdC50ZWFtICYmIG8uc291bCA9PT0gJ3dhcnJpb3InICYmIE1hdGguaHlwb3Qoby54IC0gdC54LCBvLnogLSB0LnopIDw9IEIucGhhbGFueC5yYWRpdXMpLmxlbmd0aDtcbiAgICAgIHJlZCA9IE1hdGgubWluKEIucGhhbGFueC5tYXhTdGFja3MsIG4pICogQi5waGFsYW54LnBlckFsbHk7XG4gICAgfVxuICAgIGNvbnN0IGRtZyA9IGFtb3VudCAqICgxIC0gcmVkKTsgdC5ocCAtPSBkbWc7XG4gICAgY29uc3QgTSA9IEIubWFuYVt0LnNvdWxdOyBpZiAoTSAmJiB0LmhwID4gMCkgdC5tYW5hID0gTWF0aC5taW4oTS5tYXgsIHQubWFuYSArIE0ucGVySGl0KTtcbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2hpdCcsIGZyb206IGZyb20uaWQsIHRvOiB0LmlkLCBkbWcsIGtpbmQgfSk7XG4gICAgaWYgKHQuaHAgPD0gMCkgeyB0LmhwID0gMDsgdC5hbGl2ZSA9IGZhbHNlOyB0LnN0YXRlID0gJ2RlYWQnOyB0LmRlYWRBdCA9IHRoaXMudGltZTsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdkZWF0aCcsIGlkOiB0LmlkIH0pOyB9XG4gIH1cbn1cblxuLyoqIFJ1biBhIHdob2xlIGZpZ2h0IHdpdGhvdXQgYW55IGdyYXBoaWNzLiBSZXR1cm5zIHdobyB3b24gYW5kIGhvdyBpdCB3ZW50LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpbXVsYXRlKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSwgbWF4U2Vjb25kcyA9IDEzMCwgbGV2ZWxzPzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiwgZW5lbXlQb3dlciA9IDEpOiB7IHdpbm5lcjogMCB8IDE7IHRpbWU6IG51bWJlcjsgbGVmdDogbnVtYmVyOyBocExlZnQ6IG51bWJlciB9IHtcbiAgY29uc3QgYiA9IG5ldyBCYXR0bGUocGxheWVycywgZW5lbWllcywgc2VlZCwgbGV2ZWxzLCBlbmVteVBvd2VyKTtcbiAgd2hpbGUgKGIud2lubmVyIDwgMCAmJiBiLnRpbWUgPCBtYXhTZWNvbmRzKSBiLnN0ZXAoMSAvIDMwKTtcbiAgY29uc3QgdyA9IChiLndpbm5lciA8IDAgPyAxIDogYi53aW5uZXIpIGFzIDAgfCAxO1xuICBjb25zdCBtaW5lID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB3KTtcbiAgcmV0dXJuIHsgd2lubmVyOiB3LCB0aW1lOiBiLnRpbWUsIGxlZnQ6IG1pbmUubGVuZ3RoLCBocExlZnQ6IG1pbmUucmVkdWNlKChuLCBmKSA9PiBuICsgZi5ocCAvIGYubWF4SHAsIDApIH07XG59XG4iLCAiLy8gRW5lbXkgd2F2ZXMgYW5kIHRoZSBjYW1wYWlnbidzIHN0YWdlcy4gU2FtZSB1bml0IHBvb2wgYXMgdGhlIHBsYXllci4gVGhlIGJ1aWxkIHNjcmVlbiBwcmV2aWV3cyB0aGUgQ09NUE9TSVRJT04gb25seSwgbmV2ZXIgcG9zaXRpb25zLlxuLy9cbi8vIEVhY2ggU1RBR0UgaGFzIGZvdXIgZGlmZmljdWx0eSB0aWVycyAoZWFzeSAvIG5vcm1hbCAvIGhhcmQgLyBuaWdodG1hcmUpLiBMYXRlciBzdGFnZXMgYXJlIGhhcmRlcjogdGhleSByZXVzZSB0b3VnaGVyIHdhdmUgbGlzdHMgYW5kIGEgaGlkZGVuXG4vLyBFTkVNWSBQT1dFUiBtdWx0aXBsaWVyIChoZWFsdGggYW5kIGRhbWFnZSBvZiBlbmVteSB1bml0cykgdHVuZWQgcGVyIHN0YWdlIGFuZCB0aWVyIHdpdGggc2ltL2NhbGlicmF0ZV9wb3dlci50cywgc28gdGhhdCB0aGUgY29tcGV0ZW50XG4vLyBzdGFuZC1pbiBwbGF5ZXIgY2xlYXJzIGVhY2ggdGllciBhYm91dCA2MCUgb2YgdGhlIHRpbWUgYXQgdGhhdCB0aWVyJ3MgUkVDT01NRU5ERUQgU09VTCBMRVZFTCAoZXZlcnkgU291bCBhdCB0aGF0IGxldmVsKS5cbi8vIFVubG9jayBydWxlcyBsaXZlIGluIHByb2dyZXNzLnRzOiBFYXN5IGFuZCBOb3JtYWwgYXJlIGFsd2F5cyBvcGVuOyBjbGVhcmluZyBOb3JtYWwgb3BlbnMgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2U7IGNsZWFyaW5nIEhhcmQgb3BlbnMgTmlnaHRtYXJlLlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMsIFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRW5lbXlTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXIgfVxuZXhwb3J0IHR5cGUgRGlmZiA9ICdlYXN5JyB8ICdub3JtYWwnIHwgJ2hhcmQnIHwgJ25pZ2h0bWFyZSc7XG5leHBvcnQgY29uc3QgRElGRlM6IERpZmZbXSA9IFsnZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXTtcblxuY29uc3QgTEVUVEVSOiBSZWNvcmQ8c3RyaW5nLCBTb3VsSWQ+ID0geyBXOiAnd2FycmlvcicsIEE6ICdhcmNoZXInLCBHOiAnZ29ibGluJywgSzogJ2tuaWdodCcsIE86ICdvZ3JlJywgQjogJ2JhcmJhcmlhbicgfTtcbmNvbnN0IHBhcnNlV2F2ZSA9IChzOiBzdHJpbmcpOiBFbmVteVNwZWNbXSA9PiBzLnNwbGl0KCcgJykubWFwKCh0KSA9PiAoeyBzb3VsOiBMRVRURVJbdFswXV0sIHN0YXI6ICt0WzFdIH0pKTtcblxuLyoqXG4gKiBXYXZlIGxpc3RzIChXIHdhcnJpb3IsIEEgYXJjaGVyLCBHIGdvYmxpbiwgSyBrbmlnaHQsIE8gb2dyZSwgQiBiYXJiYXJpYW47IGRpZ2l0ID0gc3RhcnMpLiBUaGVzZSBmb3VyIHdlcmUgdHVuZWQgZm9yIFN0YWdlIDE7IGxhdGVyIHN0YWdlc1xuICogcmV1c2UgdGhlbSBvbmUgdGllciB1cCBhbmQgYWRkIGVuZW15IHBvd2VyLiBIYXJkIGFuZCBOaWdodG1hcmUgYXJlIHZvbHVtZS1kcml2ZW4gKHVwIHRvIDEyIGVuZW1pZXMpLlxuICogQ29tcGV0ZW50IHN0YW5kLWluIGNsZWFyIHJhdGUgd2l0aCBFVkVSWSBTb3VsIGF0IGxldmVsIDEgLyA0IC8gNjogZWFzeSA5OC8xMDAvMTAwLCBub3JtYWwgODIvOTgvMTAwLCBoYXJkIDcvNjAvODcsIG5pZ2h0bWFyZSAwLzMzLzc0LlxuICovXG5leHBvcnQgY29uc3QgRElGRklDVUxUWTogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0ge1xuICBlYXN5OiBbJ1cxJywgJ0sxIFcxJywgJ08xIFcxIEcxJywgJ0sxIEExIFcxJywgJ08xIEExIEcxJywgJ0sxIE8xIEExJywgJ0sxIE8xIEExIEcxJywgJ08xIEsxIEExIEcxJywgJ08xIEsxIEExIEIxJywgJ08yIEsxIEExIEcxJ10sXG4gIG5vcm1hbDogWydXMSBBMScsICdLMSBHMSBXMScsICdPMSBBMSBHMSBXMScsICdLMSBPMSBBMSBXMScsICdPMSBLMSBBMSBHMSBXMScsICdBMiBLMSBPMSBHMSBXMScsICdLMSBPMSBBMSBHMSBXMScsICdPMSBLMSBBMSBCMSBHMScsICdPMSBLMSBBMiBCMSBHMScsICdPMiBLMSBBMSBCMSBHMSBXMSddLFxuICBoYXJkOiBbJ1cxIEExJywgJ0sxIEcxIFcxIEExIFcxJywgJ08xIEExIEcxIFcxIFcxJywgJ0sxIE8xIEExIFcxIEcxIFcxJywgJ08xIEsxIEEyIEcxIFcxIFcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxIFcxIFcxJywgJ0sxIE8xIEExIEcxIFcyIFcxIFcxJywgJ08xIEsxIEEyIEIxIEcxIFcxIFcxIEcxJywgJ08yIEsxIEEyIEIxIEcxIFcxIFcxIEcxJywgJ08yIEsyIEExIEIxIEcxIFcxIFcxIFcxIEcxJ10sXG4gIG5pZ2h0bWFyZTogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBBMSBHMSBXMSBCMSBXMScsICdLMSBPMSBBMSBXMSBHMSBXMSBXMScsICdPMSBLMSBBMiBHMSBXMSBCMSBXMSBXMSBHMScsICdBMiBLMSBPMSBHMSBXMSBCMSBXMSBXMSBHMSBHMScsICdLMSBPMSBBMiBHMSBXMSBCMSBXMSBXMSBHMSBHMSBCMScsICdPMSBLMiBBMiBCMSBHMSBXMSBXMSBXMSBHMSBHMSBCMScsICdPMiBLMSBBMiBCMSBHMSBXMSBXMSBXMSBHMSBHMSBCMSBLMScsICdPMiBLMiBBMiBCMSBHMSBXMSBXMSBXMSBHMSBHMSBCMSBLMSddLFxufTtcblxuZXhwb3J0IGludGVyZmFjZSBTdGFnZURlZiB7XG4gIGlkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgYmx1cmI6IHN0cmluZztcbiAgbGlzdHM6IFJlY29yZDxEaWZmLCBzdHJpbmdbXT47ICAgICAgICAgIC8vIHRoZSAxMCBlbmVteSB3YXZlcyBmb3IgZWFjaCB0aWVyXG4gIHBvd2VyOiBSZWNvcmQ8RGlmZiwgbnVtYmVyPjsgICAgICAgICAgICAvLyBoaWRkZW4gZW5lbXkgaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyIGZvciBlYWNoIHRpZXIgKDEgPSBhcyB3cml0dGVuKVxuICByZWM6IFJlY29yZDxEaWZmLCBudW1iZXI+OyAgICAgICAgICAgICAgLy8gcmVjb21tZW5kZWQgU291bCBsZXZlbCBmb3IgZWFjaCB0aWVyIChhIGhpbnQgb24gSG9tZSwgbmV2ZXIgYSBsb2NrKVxufVxuXG4vKiogVGhlIGNhbXBhaWduLiBOYW1lcyBhcmUgcGxhY2Vob2xkZXJzLiBQb3dlciBudW1iZXJzIGNvbWUgZnJvbSBzaW0vY2FsaWJyYXRlX3Bvd2VyLnRzLiAqL1xuZXhwb3J0IGNvbnN0IFNUQUdFUzogU3RhZ2VEZWZbXSA9IFtcbiAgeyBpZDogJ2NyeXB0JywgbmFtZTogJ1RoZSBSZXN0bGVzcyBDcnlwdCcsIGJsdXJiOiAnUmFpc2UgeW91ciBhcm15LiBUaGUgZGVhZCBoZXJlIGFyZSBvbmx5IGp1c3Qgc3RpcnJpbmcuJyxcbiAgICBsaXN0czogeyBlYXN5OiBESUZGSUNVTFRZLmVhc3ksIG5vcm1hbDogRElGRklDVUxUWS5ub3JtYWwsIGhhcmQ6IERJRkZJQ1VMVFkuaGFyZCwgbmlnaHRtYXJlOiBESUZGSUNVTFRZLm5pZ2h0bWFyZSB9LFxuICAgIHBvd2VyOiB7IGVhc3k6IDEsIG5vcm1hbDogMSwgaGFyZDogMSwgbmlnaHRtYXJlOiAxIH0sIHJlYzogeyBlYXN5OiAxLCBub3JtYWw6IDEsIGhhcmQ6IDQsIG5pZ2h0bWFyZTogNiB9IH0sXG4gIHsgaWQ6ICdncmF2ZXlhcmQnLCBuYW1lOiAnVGhlIFN1bmtlbiBHcmF2ZXlhcmQnLCBibHVyYjogJ0JpZ2dlciBjcm93ZHMgY3Jhd2wgb3V0IG9mIHRoZSBtdWQuIExldmVsIHlvdXIgU291bHMgYmVmb3JlIHlvdSBjb21lLicsXG4gICAgbGlzdHM6IHsgZWFzeTogRElGRklDVUxUWS5ub3JtYWwsIG5vcm1hbDogRElGRklDVUxUWS5oYXJkLCBoYXJkOiBESUZGSUNVTFRZLm5pZ2h0bWFyZSwgbmlnaHRtYXJlOiBESUZGSUNVTFRZLm5pZ2h0bWFyZSB9LFxuICAgIHBvd2VyOiB7IGVhc3k6IDEuMDUsIG5vcm1hbDogMSwgaGFyZDogMS4wNSwgbmlnaHRtYXJlOiAxLjE1IH0sIHJlYzogeyBlYXN5OiAyLCBub3JtYWw6IDQsIGhhcmQ6IDYsIG5pZ2h0bWFyZTogOCB9IH0sXG4gIHsgaWQ6ICdiYXN0aW9uJywgbmFtZTogJ1RoZSBCb25lIEJhc3Rpb24nLCBibHVyYjogJ0EgZm9ydHJlc3Mgb2YgdGhlIGZhbGxlbi4gT25seSB3ZWxsLWxldmVsbGVkIGFybWllcyBob2xkIHRoZSBnYXRlLicsXG4gICAgbGlzdHM6IHsgZWFzeTogRElGRklDVUxUWS5oYXJkLCBub3JtYWw6IERJRkZJQ1VMVFkubmlnaHRtYXJlLCBoYXJkOiBESUZGSUNVTFRZLm5pZ2h0bWFyZSwgbmlnaHRtYXJlOiBESUZGSUNVTFRZLm5pZ2h0bWFyZSB9LFxuICAgIHBvd2VyOiB7IGVhc3k6IDAuOSwgbm9ybWFsOiAxLjA1LCBoYXJkOiAxLjE1LCBuaWdodG1hcmU6IDEuMyB9LCByZWM6IHsgZWFzeTogNCwgbm9ybWFsOiA2LCBoYXJkOiA4LCBuaWdodG1hcmU6IDEwIH0gfSxcbl07XG5leHBvcnQgY29uc3Qgc3RhZ2VJbmRleCA9IChpZDogc3RyaW5nKTogbnVtYmVyID0+IE1hdGgubWF4KDAsIFNUQUdFUy5maW5kSW5kZXgoKHMpID0+IHMuaWQgPT09IGlkKSk7XG5leHBvcnQgY29uc3Qgc3RhZ2VCeUlkID0gKGlkOiBzdHJpbmcpOiBTdGFnZURlZiA9PiBTVEFHRVNbc3RhZ2VJbmRleChpZCldO1xuXG4vKiogTmFtZXMgYW5kIG9uZS1saW5lIHByb21pc2VzIGZvciB0aGUgZGlmZmljdWx0eSBwaWNrZXIuICovXG5leHBvcnQgY29uc3QgRElGRklDVUxUWV9JTkZPID0gW1xuICB7IGlkOiAnZWFzeScsIGxhYmVsOiAnRWFzeScsIGJsdXJiOiAnU21hbGxlciBlbmVteSBhcm1pZXMuIFJlbGF4IGFuZCBsZWFybiBob3cgbWVyZ2luZyB3b3Jrcy4nIH0sXG4gIHsgaWQ6ICdub3JtYWwnLCBsYWJlbDogJ05vcm1hbCcsIGJsdXJiOiAnVGhlIHN0YW5kYXJkIGZpZ2h0LiBDbGVhcmluZyBpdCB1bmxvY2tzIEhhcmQgYW5kIHRoZSBuZXh0IHN0YWdlLicgfSxcbiAgeyBpZDogJ2hhcmQnLCBsYWJlbDogJ0hhcmQnLCBibHVyYjogJ0JpZ2dlciBhcm1pZXMgd2l0aCBtb3JlIGZvZGRlci4gQmV0dGVyIGZpcnN0LWNsZWFyIHJld2FyZHMuIENsZWFyaW5nIGl0IHVubG9ja3MgTmlnaHRtYXJlLicgfSxcbiAgeyBpZDogJ25pZ2h0bWFyZScsIGxhYmVsOiAnTmlnaHRtYXJlJywgYmx1cmI6ICdBIHBhY2tlZCBiYXR0bGVmaWVsZCBvZiBzdGFycyBhbmQgc2tpbGxzLiBCdWlsdCBmb3Igd2VsbC1sZXZlbGxlZCBTb3Vscy4nIH0sXG5dO1xuXG4vLyAtLS0tIHdoYXQgdGhlIG5leHQgYmF0dGxlIHVzZXMgKHNldCB3aGVuIGEgcnVuIHN0YXJ0cylcbmV4cG9ydCBsZXQgZGlmZmljdWx0eU5hbWU6IHN0cmluZyA9ICdub3JtYWwnO1xuZXhwb3J0IGxldCBjdXJyZW50U3RhZ2VJZDogc3RyaW5nID0gJ2NyeXB0JztcbmxldCBwb3dlciA9IDE7XG4vKiogRW5lbXkgaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyIGZvciB0aGUgY3VycmVudCBzdGFnZSBhbmQgdGllci4gKi9cbmV4cG9ydCBjb25zdCBlbmVteVBvd2VyID0gKCk6IG51bWJlciA9PiBwb3dlcjtcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyICgxMCB3YXZlcykuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXRTdGFnZURpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFN0YWdlRGlmZmljdWx0eShzdGFnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBzdGFnZUJ5SWQoc3RhZ2UpOyBpZiAoIURJRkZTLmluY2x1ZGVzKG5hbWUgYXMgRGlmZikpIHJldHVybjtcbiAgY3VycmVudFN0YWdlSWQgPSBzdC5pZDsgZGlmZmljdWx0eU5hbWUgPSBuYW1lOyBwb3dlciA9IHN0LnBvd2VyW25hbWUgYXMgRGlmZl07XG4gIEFVVEhPUkVELmxlbmd0aCA9IDA7IHN0Lmxpc3RzW25hbWUgYXMgRGlmZl0uZm9yRWFjaCgodykgPT4gQVVUSE9SRUQucHVzaChwYXJzZVdhdmUodykpKTtcbn1cbi8qKiBDaGFuZ2UgdGhlIHRpZXIgd2l0aGluIHRoZSBjdXJyZW50IHN0YWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldERpZmZpY3VsdHkobmFtZTogc3RyaW5nKTogdm9pZCB7IHNldFN0YWdlRGlmZmljdWx0eShjdXJyZW50U3RhZ2VJZCwgbmFtZSk7IH1cblxuZXhwb3J0IGNvbnN0IHdhdmVDb3N0ID0gKHc6IEVuZW15U3BlY1tdKTogbnVtYmVyID0+IHcucmVkdWNlKChuLCBlKSA9PiBuICsgQ09TVFtlLnNvdWxdW2Uuc3RhciAtIDFdLCAwKTtcblxuLyoqIEVuZW15IGFybXkgZm9yIGEgd2F2ZSAoMS1iYXNlZCkuIFdhdmVzIHBhc3QgdGhlIGF1dGhvcmVkIG9uZXMgYXJlIGdlbmVyYXRlZCBmcm9tIGEgZml4ZWQgc2VlZCBzbyByZXRyaWVzIGZhY2UgdGhlIHNhbWUgYXJteS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteVdhdmUod2F2ZTogbnVtYmVyLCBzdGFnZVNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBpZiAod2F2ZSA8PSBBVVRIT1JFRC5sZW5ndGgpIHJldHVybiBBVVRIT1JFRFt3YXZlIC0gMV0ubWFwKChlKSA9PiAoeyAuLi5lIH0pKTtcbiAgY29uc3QgY2FwID0gQ1VSVkVTLmRvY1tNYXRoLm1pbih3YXZlLCBDVVJWRVMuZG9jLmxlbmd0aCkgLSAxXTtcbiAgY29uc3QgYnVkZ2V0ID0gTWF0aC5yb3VuZChjYXAgKiAwLjkyKTtcbiAgY29uc3Qgcm5nID0gbWFrZVJuZyhzdGFnZVNlZWQgKiAxMDA5ICsgd2F2ZSAqIDc5MTkpO1xuICBjb25zdCBhcm15OiBFbmVteVNwZWNbXSA9IFtdO1xuICBsZXQgbGVmdCA9IGJ1ZGdldDtcbiAgZm9yIChsZXQgZ3VhcmQgPSAwOyBndWFyZCA8IDQwICYmIGxlZnQgPj0gMjsgZ3VhcmQrKykge1xuICAgIGNvbnN0IHNvdWwgPSBybmcucGljayhTT1VMUyk7XG4gICAgbGV0IHN0YXIgPSAxO1xuICAgIGlmIChybmcubmV4dCgpIDwgMC4zNSAmJiBDT1NUW3NvdWxdWzFdIDw9IGxlZnQpIHN0YXIgPSAyO1xuICAgIGlmICh3YXZlID49IDYgJiYgcm5nLm5leHQoKSA8IDAuMjUgJiYgQ09TVFtzb3VsXVsyXSA8PSBsZWZ0KSBzdGFyID0gMztcbiAgICBjb25zdCBjID0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gICAgaWYgKGMgPD0gbGVmdCAmJiBhcm15Lmxlbmd0aCA8IDEyKSB7IGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gYzsgfVxuICB9XG4gIHJldHVybiBhcm15O1xufVxuXG4vKiogV2hhdCB0aGUgYnVpbGQgc2NyZWVuIHNob3dzOiBjb3VudHMgcGVyIFNvdWwgYW5kIHN0YXIsIG5vIHBvc2l0aW9ucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmV2aWV3VGV4dCh3OiBFbmVteVNwZWNbXSk6IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfVtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfT4oKTtcbiAgZm9yIChjb25zdCBlIG9mIHcpIHtcbiAgICBjb25zdCBrID0gZS5zb3VsICsgZS5zdGFyO1xuICAgIGNvbnN0IGN1ciA9IG1hcC5nZXQoayk7XG4gICAgaWYgKGN1cikgY3VyLmNvdW50Kys7IGVsc2UgbWFwLnNldChrLCB7IHNvdWw6IGUuc291bCwgc3RhcjogZS5zdGFyLCBjb3VudDogMSB9KTtcbiAgfVxuICByZXR1cm4gWy4uLm1hcC52YWx1ZXMoKV07XG59XG4iLCAiaW1wb3J0IHsgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuXG4vKipcbiAqIFJ1bGVzIGZvciB0aGUgcGxheWFibGUgU3RhZ2UgMSAoMTAgd2F2ZXMpOiBkb2MgRG9taW5pb24gY3VydmUsIGJvbnVzIGRyYXcgb25seSBvbiB0aGUgZWFybHkgd2F2ZXMuXG4gKiBtZXJnZSAnaGFuZEludG9PbmVTdGFyJzogYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBtZXJnZSBzdHJhaWdodCBpbnRvIGEgbWF0Y2hpbmcgZGVwbG95ZWQgMS1zdGFyIHVuaXQgKHBheWluZyBvbmx5IHRoZSBjb3N0XG4gKiBkaWZmZXJlbmNlKS4gV2l0aG91dCBpdCB0aGUgY2FwIGNhbiBibG9jayBhIG1lcmdlIHlvdSBjb3VsZCBhZmZvcmQgKHlvdSB3b3VsZCBuZWVkIHJvb20gdG8gc3VtbW9uIEJPVEggY29waWVzIGZpcnN0KS5cbiAqIFRoZSBkZWJ1ZyBwYW5lbCBjYW4gc3dpdGNoIHRoaXMgYmFjayB0byB0aGUgZG9jJ3MgZGVwbG95ZWQtb25seSBydWxlLlxuICovXG5leHBvcnQgY29uc3QgUFJPVE9UWVBFX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IENVUlZFUy5kb2MsIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogMTAsIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG4iLCAiLy8gU291bCBQYWNrcyAocGxhbiBkb2Mgc2VjdGlvbiAxNykuIFB1cmUgcnVsZXMsIG5vIGdyYXBoaWNzLiBBTEwgTlVNQkVSUyBBUkUgUExBQ0VIT0xERVIgTEVWRVJTOiB3ZSBzZXR0bGVkIHRoZSBzdHJ1Y3R1cmUgZmlyc3QgYW5kIHdpbGwgdHVuZVxuLy8gcXVhbnRpdGllcyB3aXRoIHRoZSBwcm9ncmVzc2lvbiBzaW11bGF0aW9uIChzaW0vcHJvZ3Jlc3Npb24udHMpIG9uY2UgdGhlIGxvb3AgY2FuIGJlIHBsYXllZC5cbi8vXG4vLyAgIFNvdWwgcmFyaXR5ICAtPiBob3cgb2Z0ZW4gYSBTb3VsIHNob3dzIHVwIGFuZCBob3cgYmlnIGl0cyBzdGFjayBvZiBjb3BpZXMgdGVuZHMgdG8gYmUuXG4vLyAgIFBhY2sgdGllciAgICAtPiB0aGUgcGFjaydzIG92ZXJhbGwgdmFsdWUgKHNrdWxscywgMS0zIGZvciBub3cpOiBudW1iZXIgb2YgcmV2ZWFscyArIGhvdyBnb29kIHRoZSByYXJpdHkgb2RkcyBhcmUuXG4vLyAgIEEgcGFjayBoYXMgYSBTVEFSVElORyB0aWVyIGFuZCBtYXkgdXBncmFkZSB3aGlsZSBpdCBpcyBiZWluZyBvcGVuZWQ7IHRoZSByZXN1bHQgaXMgZGVjaWRlZCB1cCBmcm9udCwgdGhlIGFuaW1hdGlvbiBvbmx5IHNob3dzIGl0LlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IHR5cGUgUmFyaXR5ID0gJ2NvbW1vbicgfCAncmFyZScgfCAnZXBpYycgfCAnbGVnZW5kYXJ5JztcbmV4cG9ydCBjb25zdCBSQVJJVElFUzogUmFyaXR5W10gPSBbJ2NvbW1vbicsICdyYXJlJywgJ2VwaWMnLCAnbGVnZW5kYXJ5J107XG5leHBvcnQgY29uc3QgUkFSSVRZX05BTUU6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJ0NvbW1vbicsIHJhcmU6ICdSYXJlJywgZXBpYzogJ0VwaWMnLCBsZWdlbmRhcnk6ICdMZWdlbmRhcnknIH07XG5cbi8qKiBSYXJpdHkgcGVyIFNvdWwuIFBMQUNFSE9MREVSIGFzc2lnbm1lbnQgKG5vIExlZ2VuZGFyeSBTb3VsIGV4aXN0cyB5ZXQpLiAqL1xuZXhwb3J0IGNvbnN0IFJBUklUWV9PRjogUmVjb3JkPFNvdWxJZCwgUmFyaXR5PiA9IHsgd2FycmlvcjogJ2NvbW1vbicsIGdvYmxpbjogJ2NvbW1vbicsIGFyY2hlcjogJ3JhcmUnLCBrbmlnaHQ6ICdyYXJlJywgb2dyZTogJ2VwaWMnLCBiYXJiYXJpYW46ICdlcGljJyB9O1xuXG4vKiogUmFyZXIgU291bHMgdHVybiB1cCBpbiBzbWFsbGVyIHN0YWNrcywgc28gdGhleSBuZWVkIGZld2VyIGNvcGllcyBwZXIgbGV2ZWwgKG11bHRpcGxpZXIgb24gdGhlIGxldmVsIGNvc3RzKS4gUExBQ0VIT0xERVIuICovXG5leHBvcnQgY29uc3QgTEVWRUxfQ09TVF9NVUxUOiBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+ID0geyBjb21tb246IDEsIHJhcmU6IDAuNiwgZXBpYzogMC4zNSwgbGVnZW5kYXJ5OiAwLjIgfTtcblxuZXhwb3J0IGNvbnN0IFBBQ0tfVElFUlMgPSAzO1xuZXhwb3J0IGNvbnN0IFBBQ0sgPSB7XG4gIHJldmVhbHM6IFszLCA0LCA1XSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNlcGFyYXRlIHJldmVhbHMgcGVyIHRpZXIgKGluZGV4IDAgPSB0aWVyIDEpXG4gIHN0YWNrTXVsdDogWzEsIDEuNSwgMl0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvcHkgc3RhY2tzIGFyZSBiaWdnZXIgaW4gYmV0dGVyIHBhY2tzXG4gIC8qKiBSYXJpdHkgb2RkcyBwZXIgdGllciwgaW4gcGVyY2VudC4gKi9cbiAgb2RkczogW1xuICAgIHsgY29tbW9uOiA3MCwgcmFyZTogMjUsIGVwaWM6IDUsIGxlZ2VuZGFyeTogMCB9LFxuICAgIHsgY29tbW9uOiA1NSwgcmFyZTogMzMsIGVwaWM6IDExLCBsZWdlbmRhcnk6IDEgfSxcbiAgICB7IGNvbW1vbjogNDAsIHJhcmU6IDM4LCBlcGljOiAxOSwgbGVnZW5kYXJ5OiAzIH0sXG4gIF0gYXMgUmVjb3JkPFJhcml0eSwgbnVtYmVyPltdLFxuICAvKiogQ29waWVzIGluIG9uZSByZXZlYWwgYmVmb3JlIHRoZSB0aWVyIG11bHRpcGxpZXI6IFttaW4sIG1heF0uICovXG4gIHN0YWNrOiB7IGNvbW1vbjogWzYsIDEwXSwgcmFyZTogWzMsIDVdLCBlcGljOiBbMSwgM10sIGxlZ2VuZGFyeTogWzEsIDFdIH0gYXMgUmVjb3JkPFJhcml0eSwgW251bWJlciwgbnVtYmVyXT4sXG4gIC8qKiBDaGFuY2UgdG8ganVtcCB1cCBvbmUgdGllciBkdXJpbmcgdGhlIG9wZW5pbmcsIGZyb20gdGllciAxIGFuZCBmcm9tIHRpZXIgMiAoYSBsdWNreSBwYWNrIGNhbiBqdW1wIHR3aWNlKS4gKi9cbiAgdXBncmFkZUNoYW5jZTogWzAuMiwgMC4xMl0sXG59O1xuXG4vKiogQW4gdW5vcGVuZWQgcGFjayB0aGUgcGxheWVyIG93bnMuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhY2tJdGVtIHsgaWQ6IG51bWJlcjsgdGllcjogbnVtYmVyOyBzb3VyY2U6IHN0cmluZyB9XG5leHBvcnQgaW50ZXJmYWNlIFJldmVhbCB7IHNvdWw6IFNvdWxJZDsgcmFyaXR5OiBSYXJpdHk7IGNvcGllczogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgUGFja1Jlc3VsdCB7IHN0YXJ0VGllcjogbnVtYmVyOyBmaW5hbFRpZXI6IG51bWJlcjsgdXBncmFkZXM6IG51bWJlcltdOyByZXZlYWxzOiBSZXZlYWxbXSB9XG5cbmNvbnN0IHJhcml0eVJhbmsgPSAocjogUmFyaXR5KSA9PiBSQVJJVElFUy5pbmRleE9mKHIpO1xuXG5mdW5jdGlvbiByb2xsUmFyaXR5KHRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBSYXJpdHkge1xuICBjb25zdCBvZGRzID0gUEFDSy5vZGRzW3RpZXIgLSAxXTsgbGV0IHJvbGwgPSBybmcubmV4dCgpICogUkFSSVRJRVMucmVkdWNlKChuLCByKSA9PiBuICsgb2Rkc1tyXSwgMCk7XG4gIGZvciAoY29uc3QgciBvZiBSQVJJVElFUykgeyBpZiAocm9sbCA8IG9kZHNbcl0pIHJldHVybiByOyByb2xsIC09IG9kZHNbcl07IH1cbiAgcmV0dXJuICdjb21tb24nO1xufVxuXG4vKiogQSByYW5kb20gU291bCBvZiB0aGlzIHJhcml0eTsgaWYgdGhlIHJvc3RlciBoYXMgbm9uZSBvZiB0aGF0IHJhcml0eSB5ZXQsIHRoZSBuZXh0IGxvd2VyIG9uZSBpcyB1c2VkLiAqL1xuZnVuY3Rpb24gc291bE9mUmFyaXR5KHJhcml0eTogUmFyaXR5LCBybmc6IFJuZyk6IFNvdWxJZCB7XG4gIGZvciAobGV0IGkgPSByYXJpdHlSYW5rKHJhcml0eSk7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHBvb2wgPSBTT1VMUy5maWx0ZXIoKHMpID0+IFJBUklUWV9PRltzXSA9PT0gUkFSSVRJRVNbaV0pOyBpZiAocG9vbC5sZW5ndGgpIHJldHVybiBybmcucGljayhwb29sKTsgfVxuICByZXR1cm4gcm5nLnBpY2soU09VTFMpO1xufVxuXG4vKiogT3BlbiBhIHBhY2s6IHJvbGwgdXBncmFkZXMgZmlyc3QgKHNvIHRoZSBhbmltYXRpb24gY2FuIHBsYXkgdGhlbSBiZWZvcmUgdGhlIHBhY2sgdGVhcnMgb3BlbiksIHRoZW4gdGhlIHJldmVhbHMuIEJlc3QgcmV2ZWFsIGNvbWVzIGxhc3QuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblBhY2soc3RhcnRUaWVyOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB7XG4gIGNvbnN0IHQwID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcihzdGFydFRpZXIpKSksIHVwZ3JhZGVzOiBudW1iZXJbXSA9IFtdO1xuICBsZXQgdGllciA9IHQwO1xuICB3aGlsZSAodGllciA8IFBBQ0tfVElFUlMgJiYgcm5nLm5leHQoKSA8IFBBQ0sudXBncmFkZUNoYW5jZVt0aWVyIC0gMV0pIHsgdGllcisrOyB1cGdyYWRlcy5wdXNoKHRpZXIpOyB9XG4gIGNvbnN0IHJldmVhbHM6IFJldmVhbFtdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgUEFDSy5yZXZlYWxzW3RpZXIgLSAxXTsgaSsrKSB7XG4gICAgY29uc3QgcmFyaXR5ID0gcm9sbFJhcml0eSh0aWVyLCBybmcpLCBzb3VsID0gc291bE9mUmFyaXR5KHJhcml0eSwgcm5nKSwgW2xvLCBoaV0gPSBQQUNLLnN0YWNrW1JBUklUWV9PRltzb3VsXV07XG4gICAgcmV2ZWFscy5wdXNoKHsgc291bCwgcmFyaXR5OiBSQVJJVFlfT0Zbc291bF0sIGNvcGllczogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgobG8gKyBybmcuaW50KGhpIC0gbG8gKyAxKSkgKiBQQUNLLnN0YWNrTXVsdFt0aWVyIC0gMV0pKSB9KTtcbiAgfVxuICByZXZlYWxzLnNvcnQoKGEsIGIpID0+IHJhcml0eVJhbmsoYS5yYXJpdHkpIC0gcmFyaXR5UmFuayhiLnJhcml0eSkgfHwgYS5jb3BpZXMgLSBiLmNvcGllcyk7XG4gIHJldHVybiB7IHN0YXJ0VGllcjogdDAsIGZpbmFsVGllcjogdGllciwgdXBncmFkZXMsIHJldmVhbHMgfTtcbn1cblxuLyoqIFRvdGFsIGNvcGllcyBwZXIgU291bCBpbiBhIHJlc3VsdCAodGhlIHNhbWUgU291bCBjYW4gYmUgcmV2ZWFsZWQgbW9yZSB0aGFuIG9uY2UpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvcGllc0J5U291bChyZXN1bHQ6IFBhY2tSZXN1bHQpOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+IHtcbiAgY29uc3Qgb3V0OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+ID0ge307XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgb3V0W3Iuc291bF0gPSAob3V0W3Iuc291bF0gPz8gMCkgKyByLmNvcGllcztcbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3Mgc2F2ZWQgcHJvZ3Jlc3MuIEZyYW1ld29yay1mcmVlIHNvIHRoZSBnYW1lIGJ1bmRsZSBhbmQgdGhlIG5hdmlnYXRpb24gc2hlbGwgYm90aCB1c2UgaXQuXG4vLyBTdG9yZWQgaW4gbG9jYWxTdG9yYWdlIGFzIEpTT04uIEV2ZXJ5IHJlYWQvd3JpdGUgaXMgZ3VhcmRlZDogcHJpdmF0ZSB3aW5kb3dzIGFuZCBibG9ja2VkIHN0b3JhZ2UgbXVzdCBuZXZlciBicmVhayB0aGUgZ2FtZS5cblxuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUEFDS19USUVSUyB9IGZyb20gJy4vcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBQYWNrSXRlbSB9IGZyb20gJy4vcGFja3MudHMnO1xuXG5leHBvcnQgY29uc3QgREVDS19TSVpFID0gNjsgICAgICAgICAgICAgICAgICAgICAvLyBkb2M6IHNpeCBlcXVpcHBlZCBTb3VscyBwZXIgc3RhZ2VcbmNvbnN0IEtFWSA9ICduZWNyby1zYXZlJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgdHlwZSBEaWZmaWN1bHR5ID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGSUNVTFRJRVM6IERpZmZpY3VsdHlbXSA9IFsnZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXTtcbmV4cG9ydCBpbnRlcmZhY2UgU2V0dGluZ3MgeyBtdXNpYzogYm9vbGVhbjsgc2Z4OiBib29sZWFuIH1cbmV4cG9ydCBpbnRlcmZhY2UgU291bFByb2dyZXNzIHsgbGV2ZWw6IG51bWJlcjsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTYXZlIHtcbiAgdjogbnVtYmVyO1xuICBkZWNrOiBTb3VsSWRbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXF1aXBwZWQgU291bHMsIGF0IG1vc3QgREVDS19TSVpFLCBhdCBsZWFzdCAxXG4gIHNvdWxzOiBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+OyAgICAgICAgICAvLyBQTEFDRUhPTERFUiBwcm9ncmVzc2lvbiB1bnRpbCBwYWNrcyBleGlzdFxuICBzZXR0aW5nczogU2V0dGluZ3M7ICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc291bmQgc3dpdGNoZXM7IGJvdGggb24gYnkgZGVmYXVsdFxuICBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5OyAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hvc2VuIG9uIEhvbWU7IGFwcGxpZXMgdG8gdGhlIG5leHQgcnVuXG4gIHN0YWdlOiBzdHJpbmc7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgc3RhZ2UgcGlja2VkIG9uIEhvbWUgKGlkIGZyb20gd2F2ZXMudHMgU1RBR0VTKVxuICBzZWVuOiBzdHJpbmdbXSB8IG51bGw7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5sb2NrIGtleXMgd2hvc2UgY2VsZWJyYXRpb24gd2FzIGFscmVhZHkgc2hvd24gKG51bGw6IG9sZGVyIHNhdmUsIHNlZWRlZCBvbiBmaXJzdCBsb29rKVxuICBwYWNrczogUGFja0l0ZW1bXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5vcGVuZWQgU291bCBQYWNrc1xuICBuZXh0UGFja0lkOiBudW1iZXI7XG4gIGNsZWFyczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjsgICAgICAgICAgICAgICAvLyBzdGFnZSBjbGVhcnMsIGtleWVkICdzdGFnZTpkaWZmaWN1bHR5J1xuICByZXBsYXlNZXRlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwbGF5IGNsZWFycyB0b3dhcmQgdGhlIG5leHQgcmVwbGF5IHBhY2tcbn1cbmV4cG9ydCBpbnRlcmZhY2UgU3RvcmUgeyBnZXRJdGVtKGs6IHN0cmluZyk6IHN0cmluZyB8IG51bGw7IHNldEl0ZW0oazogc3RyaW5nLCB2OiBzdHJpbmcpOiB2b2lkIH1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRTYXZlKCk6IFNhdmUge1xuICBjb25zdCBzb3VscyA9IHt9IGFzIFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47XG4gIGZvciAoY29uc3QgaWQgb2YgU09VTFMpIHNvdWxzW2lkXSA9IHsgbGV2ZWw6IDEsIGNvcGllczogMCB9O1xuICByZXR1cm4geyB2OiBWRVJTSU9OLCBkZWNrOiBTT1VMUy5zbGljZSgwLCBERUNLX1NJWkUpLCBzb3Vscywgc2V0dGluZ3M6IHsgbXVzaWM6IHRydWUsIHNmeDogdHJ1ZSB9LCBkaWZmaWN1bHR5OiAnbm9ybWFsJywgc3RhZ2U6ICdjcnlwdCcsIHNlZW46IFtdLCBwYWNrczogW10sIG5leHRQYWNrSWQ6IDEsIGNsZWFyczoge30sIHJlcGxheU1ldGVyOiAwIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicm93c2VyU3RvcmUoKTogU3RvcmUgfCBudWxsIHsgdHJ5IHsgcmV0dXJuIHR5cGVvZiBsb2NhbFN0b3JhZ2UgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGxvY2FsU3RvcmFnZTsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9IH1cblxuLyoqIFJlcGFpciB3aGF0ZXZlciB3YXMgc3RvcmVkOiB1bmtub3duIFNvdWxzIGRyb3BwZWQsIGR1cGxpY2F0ZXMgcmVtb3ZlZCwgZGVjayBjYXBwZWQsIG5vdGhpbmcgZW1wdHkuIE9sZCB2ZXJzaW9ucyBrZWVwIHRoZWlyIHByb2dyZXNzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplKHJhdzogYW55KTogU2F2ZSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0U2F2ZSgpO1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IGRlY2s6IFNvdWxJZFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5kZWNrKSkgZm9yIChjb25zdCBkIG9mIHJhdy5kZWNrKSBpZiAoU09VTFMuaW5jbHVkZXMoZCkgJiYgIWRlY2suaW5jbHVkZXMoZCkgJiYgZGVjay5sZW5ndGggPCBERUNLX1NJWkUpIGRlY2sucHVzaChkKTtcbiAgaWYgKGRlY2subGVuZ3RoKSBiYXNlLmRlY2sgPSBkZWNrO1xuICBpZiAocmF3LnNvdWxzICYmIHR5cGVvZiByYXcuc291bHMgPT09ICdvYmplY3QnKSB7XG4gICAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykge1xuICAgICAgY29uc3QgcCA9IHJhdy5zb3Vsc1tpZF07XG4gICAgICBpZiAocCAmJiBOdW1iZXIuaXNGaW5pdGUocC5sZXZlbCkgJiYgTnVtYmVyLmlzRmluaXRlKHAuY29waWVzKSkgYmFzZS5zb3Vsc1tpZF0gPSB7IGxldmVsOiBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHAubGV2ZWwpKSwgY29waWVzOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHAuY29waWVzKSkgfTtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5zZXR0aW5ncyAmJiB0eXBlb2YgcmF3LnNldHRpbmdzID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLm11c2ljID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3MubXVzaWMgPSByYXcuc2V0dGluZ3MubXVzaWM7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3Muc2Z4ID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3Muc2Z4ID0gcmF3LnNldHRpbmdzLnNmeDtcbiAgfVxuICBpZiAoRElGRklDVUxUSUVTLmluY2x1ZGVzKHJhdy5kaWZmaWN1bHR5KSkgYmFzZS5kaWZmaWN1bHR5ID0gcmF3LmRpZmZpY3VsdHk7XG4gIGlmICh0eXBlb2YgcmF3LnN0YWdlID09PSAnc3RyaW5nJyAmJiAvXlthLXowLTlfLV17MSwyNH0kLy50ZXN0KHJhdy5zdGFnZSkpIGJhc2Uuc3RhZ2UgPSByYXcuc3RhZ2U7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5zZWVuKSkgYmFzZS5zZWVuID0gcmF3LnNlZW4uZmlsdGVyKChrOiBhbnkpID0+IHR5cGVvZiBrID09PSAnc3RyaW5nJyAmJiBrLmxlbmd0aCA8IDQwKS5zbGljZSgtODApO1xuICBlbHNlIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyhyYXcuY2xlYXJzKS5sZW5ndGgpIGJhc2Uuc2VlbiA9IG51bGw7ICAgIC8vIGFuIGV4aXN0aW5nIHBsYXllcjogZG8gbm90IHJlcGxheSBvbGQgdW5sb2Nrc1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcucGFja3MpKSB7XG4gICAgY29uc3QgaWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHJhdy5wYWNrcykge1xuICAgICAgaWYgKGJhc2UucGFja3MubGVuZ3RoID49IDk5IHx8ICFwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHAuaWQpIHx8IHAuaWQgPCAxIHx8IGlkcy5oYXMocC5pZCkgfHwgIU51bWJlci5pc0ludGVnZXIocC50aWVyKSB8fCBwLnRpZXIgPCAxIHx8IHAudGllciA+IFBBQ0tfVElFUlMpIGNvbnRpbnVlO1xuICAgICAgaWRzLmFkZChwLmlkKTsgYmFzZS5wYWNrcy5wdXNoKHsgaWQ6IHAuaWQsIHRpZXI6IHAudGllciwgc291cmNlOiB0eXBlb2YgcC5zb3VyY2UgPT09ICdzdHJpbmcnID8gcC5zb3VyY2Uuc2xpY2UoMCwgNDApIDogJycgfSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IG1heElkID0gYmFzZS5wYWNrcy5yZWR1Y2UoKG4sIHApID0+IE1hdGgubWF4KG4sIHAuaWQpLCAwKTtcbiAgYmFzZS5uZXh0UGFja0lkID0gTWF0aC5tYXgobWF4SWQgKyAxLCBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5uZXh0UGFja0lkKSAmJiByYXcubmV4dFBhY2tJZCA+IDAgPyByYXcubmV4dFBhY2tJZCA6IDEpO1xuICBpZiAocmF3LmNsZWFycyAmJiB0eXBlb2YgcmF3LmNsZWFycyA9PT0gJ29iamVjdCcpIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHJhdy5jbGVhcnMpKSBpZiAodHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDAgJiYgTnVtYmVyLmlzSW50ZWdlcih2KSAmJiAodiBhcyBudW1iZXIpID4gMCkgYmFzZS5jbGVhcnNba10gPSB2IGFzIG51bWJlcjtcbiAgaWYgKE51bWJlci5pc0ludGVnZXIocmF3LnJlcGxheU1ldGVyKSAmJiByYXcucmVwbGF5TWV0ZXIgPj0gMCAmJiByYXcucmVwbGF5TWV0ZXIgPCA1MCkgYmFzZS5yZXBsYXlNZXRlciA9IHJhdy5yZXBsYXlNZXRlcjtcbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cblxuLyoqIENoYW5nZSBzb3VuZCBzZXR0aW5ncyB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzKHBhdGNoOiBQYXJ0aWFsPFNldHRpbmdzPiwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2V0dGluZ3Mge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLnNldHRpbmdzID0geyAuLi5zLnNldHRpbmdzLCAuLi5wYXRjaCB9OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5zZXR0aW5ncztcbn1cblxuLyoqIFJlbWVtYmVyIHRoZSBjaG9zZW4gZGlmZmljdWx0eSB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZURpZmZpY3VsdHkoZDogRGlmZmljdWx0eSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogRGlmZmljdWx0eSB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuZGlmZmljdWx0eSA9IERJRkZJQ1VMVElFUy5pbmNsdWRlcyhkKSA/IGQgOiBzLmRpZmZpY3VsdHk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLmRpZmZpY3VsdHk7XG59XG4iLCAiLy8gVGhlIHBsYXllcidzIGNoYXJhY3RlcjogdGhlIE5lY3JvbWFuY2VyLiBBIHByb2NlZHVyYWwgcGxhY2Vob2xkZXIgKG5vIFRyaXBvIG1vZGVsIHlldCk6IGhvb2RlZCByb2JlLCBnbG93aW5nIHB1cnBsZSBleWVzLCBjcnlzdGFsIHN0YWZmLlxuLy8gSGUgc3RhbmRzIGJlc2lkZSB0aGUgZ3JpZCwgdGFrZXMgdGhlIGhpdCB3aGVuIGFuIGFybXkgaXMgd2lwZWQgKGhlYXJ0cyBhcmUgSElTIGhlYWx0aCksIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSBhbmQgcmFpc2VzXG4vLyB0aGUgZmFsbGVuLiBFdmVyeXRoaW5nIGhlcmUgaXMgYW5pbWF0aW9uIG9ubHk7IHRoZSBydWxlcyBsaXZlIGluIGNvcmUvcnVsZXMudHMuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuZXhwb3J0IGNsYXNzIE5lY3JvbWFuY2VyIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uOyBsb2NhbCArWiBpcyBoaXMgZmFjaW5nICh0aGUgZ2FtZSByb3RhdGVzIGhpbSB0byBmYWNlIHRoZSBiYXR0bGVmaWVsZClcbiAgcHJpdmF0ZSByaWc6IGFueTsgcHJpdmF0ZSBzdGFmZlBpdm90OiBhbnk7IHByaXZhdGUgY3J5c3RhbDogYW55OyBwcml2YXRlIGNyeXN0YWxNYXQ6IGFueTsgcHJpdmF0ZSByb2JlTWF0OiBhbnk7IHByaXZhdGUgZXllTWF0OiBhbnk7IHByaXZhdGUgcHM6IGFueTsgcHJpdmF0ZSBnbG93OiBhbnk7XG4gIHByaXZhdGUgdCA9IDA7IHByaXZhdGUgaHVydFQgPSAwOyBwcml2YXRlIGNhc3RUID0gMDsgcHJpdmF0ZSBkb3duID0gMDsgcHJpdmF0ZSBkb3duVGFyZ2V0ID0gMDtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHNjZW5lOiBhbnksIHByaXZhdGUgc29mdDogYW55KSB7XG4gICAgY29uc3QgcyA9IHNjZW5lLCBtYXQgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgZXIgPSAwLCBlZyA9IDAsIGViID0gMCkgPT4ge1xuICAgICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ25tJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHIsIGcsIGIpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoZXIsIGVnLCBlYik7IG0uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHJldHVybiBtO1xuICAgIH07XG4gICAgY29uc3QgZ2xvd01hdCA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyLCBhID0gMSkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbmcnLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IGE7IHJldHVybiBtOyB9O1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbmVjcm8nLCBzKTsgdGhpcy5yaWcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCduZWNyb1JpZycsIHMpOyB0aGlzLnJpZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICBjb25zdCBhZGQgPSAobWVzaDogYW55LCBwYXJlbnQgPSB0aGlzLnJpZykgPT4geyBtZXNoLnBhcmVudCA9IHBhcmVudDsgbWVzaC5pc1BpY2thYmxlID0gZmFsc2U7IHJldHVybiBtZXNoOyB9O1xuICAgIHRoaXMucm9iZU1hdCA9IG1hdCgwLjA5LCAwLjAzLCAwLjE2LCAwLjA1LCAwLjAyLCAwLjEpO1xuICAgIGNvbnN0IHJvYmUgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncm9iZScsIHsgaGVpZ2h0OiAwLjgyLCBkaWFtZXRlclRvcDogMC4zLCBkaWFtZXRlckJvdHRvbTogMC44LCB0ZXNzZWxsYXRpb246IDIwIH0sIHMpKTsgcm9iZS5wb3NpdGlvbi55ID0gMC40MTsgcm9iZS5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCBoZW0gPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnaGVtJywgeyBkaWFtZXRlcjogMC43OCwgdGhpY2tuZXNzOiAwLjAzNSwgdGVzc2VsbGF0aW9uOiAyOCB9LCBzKSk7IGhlbS5wb3NpdGlvbi55ID0gMC4wMzsgaGVtLm1hdGVyaWFsID0gZ2xvd01hdCgwLjksIDAuNywgMC4yNSk7XG4gICAgY29uc3QgbWFudGxlID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdtYW50bGUnLCB7IGRpYW1ldGVyOiAwLjYsIHNlZ21lbnRzOiAxMiB9LCBzKSk7IG1hbnRsZS5zY2FsaW5nLnNldCgxLCAwLjUsIDAuOCk7IG1hbnRsZS5wb3NpdGlvbi55ID0gMC44OyBtYW50bGUubWF0ZXJpYWwgPSB0aGlzLnJvYmVNYXQ7XG4gICAgY29uc3QgaG9vZCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnaG9vZCcsIHsgZGlhbWV0ZXI6IDAuNTYsIHNlZ21lbnRzOiAxNCB9LCBzKSk7IGhvb2QucG9zaXRpb24ueSA9IDEuMDsgaG9vZC5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCB0aXAgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigndGlwJywgeyBoZWlnaHQ6IDAuNCwgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiAwLjM0LCB0ZXNzZWxsYXRpb246IDE0IH0sIHMpKTsgdGlwLnBvc2l0aW9uLnNldCgwLCAxLjI4LCAtMC4wNik7IHRpcC5yb3RhdGlvbi54ID0gLTAuMzU7IHRpcC5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCBmYWNlID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdmYWNlJywgeyBkaWFtZXRlcjogMC4zOCwgc2VnbWVudHM6IDEyIH0sIHMpKTsgZmFjZS5wb3NpdGlvbi5zZXQoMCwgMC45OSwgMC4xMik7IGZhY2UubWF0ZXJpYWwgPSBtYXQoMC4wMiwgMCwgMC4wNSk7XG4gICAgdGhpcy5leWVNYXQgPSBnbG93TWF0KDAuOSwgMC40LCAxKTtcbiAgICBmb3IgKGNvbnN0IHggb2YgWy0wLjA3NSwgMC4wNzVdKSB7IGNvbnN0IGUgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2V5ZScsIHsgZGlhbWV0ZXI6IDAuMDc1LCBzZWdtZW50czogOCB9LCBzKSk7IGUucG9zaXRpb24uc2V0KHgsIDEuMCwgMC4yODUpOyBlLnNjYWxpbmcueiA9IDAuNjsgZS5tYXRlcmlhbCA9IHRoaXMuZXllTWF0OyB9XG4gICAgdGhpcy5nbG93ID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2V5ZUdsb3cnLCB7IHNpemU6IDAuNSB9LCBzKSk7IHRoaXMuZ2xvdy5wb3NpdGlvbi5zZXQoMCwgMS4wLCAwLjMzKTsgdGhpcy5nbG93LmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgY29uc3QgZ20gPSBnbG93TWF0KDAuNywgMC4yNSwgMSwgMC41NSk7IGdtLmVtaXNzaXZlVGV4dHVyZSA9IHNvZnQ7IGdtLm9wYWNpdHlUZXh0dXJlID0gc29mdDsgdGhpcy5nbG93Lm1hdGVyaWFsID0gZ207XG4gICAgY29uc3QgaGFuZCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnaGFuZCcsIHsgZGlhbWV0ZXI6IDAuMTIsIHNlZ21lbnRzOiA4IH0sIHMpKTsgaGFuZC5wb3NpdGlvbi5zZXQoLTAuMzIsIDAuNjIsIDAuMTIpOyBoYW5kLm1hdGVyaWFsID0gbWF0KDAuOCwgMC43NSwgMC42NSk7XG4gICAgLy8gc3RhZmY6IHBpdm90IGF0IHRoZSByaWdodCBoYW5kIHNvIHJhaXNpbmcgaXQgaXMgb25lIHJvdGF0aW9uXG4gICAgdGhpcy5zdGFmZlBpdm90ID0gYWRkKG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3N0YWZmUGl2b3QnLCBzKSk7IHRoaXMuc3RhZmZQaXZvdC5wb3NpdGlvbi5zZXQoMC4zNCwgMC42LCAwLjE0KTtcbiAgICBjb25zdCByb2QgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncm9kJywgeyBoZWlnaHQ6IDEuNSwgZGlhbWV0ZXI6IDAuMDQ1LCB0ZXNzZWxsYXRpb246IDggfSwgcyksIHRoaXMuc3RhZmZQaXZvdCk7IHJvZC5wb3NpdGlvbi55ID0gMC40NTsgcm9kLm1hdGVyaWFsID0gbWF0KDAuMjgsIDAuMTcsIDAuMSk7XG4gICAgdGhpcy5jcnlzdGFsTWF0ID0gZ2xvd01hdCgwLjc1LCAwLjM1LCAxKTtcbiAgICB0aGlzLmNyeXN0YWwgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQb2x5aGVkcm9uKCdjcnlzdGFsJywgeyB0eXBlOiAxLCBzaXplOiAwLjEyIH0sIHMpLCB0aGlzLnN0YWZmUGl2b3QpOyB0aGlzLmNyeXN0YWwucG9zaXRpb24ueSA9IDEuMjg7IHRoaXMuY3J5c3RhbC5zY2FsaW5nLnkgPSAxLjU7IHRoaXMuY3J5c3RhbC5yb3RhdGlvbi54ID0gMC40OyB0aGlzLmNyeXN0YWwubWF0ZXJpYWwgPSB0aGlzLmNyeXN0YWxNYXQ7XG4gICAgY29uc3QgcmluZyA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZURpc2MoJ2Jhc2UnLCB7IHJhZGl1czogMC42MiwgdGVzc2VsbGF0aW9uOiAzMCB9LCBzKSwgdGhpcy5ob2xkZXIpOyByaW5nLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgcmluZy5wb3NpdGlvbi55ID0gMC4wMjsgcmluZy5tYXRlcmlhbCA9IGdsb3dNYXQoMC40LCAwLjE1LCAwLjc1LCAwLjU1KTtcbiAgICAvLyBhdXJhXG4gICAgY29uc3QgcHMgPSB0aGlzLnBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ25lY3JvQXVyYScsIDgwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gc29mdDsgcHMuZW1pdHRlciA9IHRoaXMuaG9sZGVyO1xuICAgIHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjMsIDAsIC0wLjMpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjMsIDAuOSwgMC4zKTsgcHMubWluTGlmZVRpbWUgPSAwLjY7IHBzLm1heExpZmVUaW1lID0gMS4zO1xuICAgIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjksIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS42LCAwLjE1KTsgcHMubWluRW1pdFBvd2VyID0gMC4zOyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMDc7IHBzLm1heFNpemUgPSAwLjI7IHBzLmVtaXRSYXRlID0gMzA7IHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjgsIDAuMzUsIDEsIDAuNyk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjQ1LCAwLjE1LCAwLjksIDAuNSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgc2V0RW5hYmxlZChvbjogYm9vbGVhbikgeyB0aGlzLmhvbGRlci5zZXRFbmFibGVkKG9uKTsgaWYgKG9uKSB0aGlzLnBzLnN0YXJ0KCk7IGVsc2UgdGhpcy5wcy5zdG9wKCk7IH1cbiAgLyoqIFdvcmxkIHBvc2l0aW9uIG9mIHRoZSBzdGFmZiBjcnlzdGFsIChmb3Igc3BlbGwgZWZmZWN0cykuICovXG4gIGNyeXN0YWxQb3MoKTogYW55IHsgdGhpcy5ob2xkZXIuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpOyB0aGlzLnJpZy5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHRoaXMuc3RhZmZQaXZvdC5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHRoaXMuY3J5c3RhbC5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHJldHVybiB0aGlzLmNyeXN0YWwuZ2V0QWJzb2x1dGVQb3NpdGlvbigpLmNsb25lKCk7IH1cblxuICBodXJ0KCkgeyB0aGlzLmh1cnRUID0gMC44OyB9XG4gIGNhc3QoKSB7IHRoaXMuY2FzdFQgPSAxLjE7IH1cbiAgLyoqIFRoZSBsYXN0IGhlYXJ0IGlzIGdvbmU6IGhlIHNpbmtzIHRvIGhpcyBrbmVlcywgdGhlIGV5ZXMgZGltLiAqL1xuICBkZWZlYXQoKSB7IHRoaXMuZG93blRhcmdldCA9IDE7IH1cbiAgcmV2aXZlKCkgeyB0aGlzLmRvd25UYXJnZXQgPSAwOyB0aGlzLmh1cnRUID0gMDsgdGhpcy5jYXN0VCA9IDA7IH1cblxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMudCArPSBkdDtcbiAgICB0aGlzLmRvd24gKz0gKHRoaXMuZG93blRhcmdldCAtIHRoaXMuZG93bikgKiBNYXRoLm1pbigxLCBkdCAqIDMpO1xuICAgIGNvbnN0IGJvYiA9IE1hdGguc2luKHRoaXMudCAqIDIpICogMC4wMzUgKiAoMSAtIHRoaXMuZG93bik7XG4gICAgbGV0IHJlY29pbCA9IDAsIGZsYXNoID0gMDtcbiAgICBpZiAodGhpcy5odXJ0VCA+IDApIHsgdGhpcy5odXJ0VCA9IE1hdGgubWF4KDAsIHRoaXMuaHVydFQgLSBkdCk7IGNvbnN0IHUgPSB0aGlzLmh1cnRUIC8gMC44OyByZWNvaWwgPSBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjQyOyBmbGFzaCA9IHU7IH1cbiAgICBsZXQgcmFpc2UgPSAwO1xuICAgIGlmICh0aGlzLmNhc3RUID4gMCkgeyB0aGlzLmNhc3RUID0gTWF0aC5tYXgoMCwgdGhpcy5jYXN0VCAtIGR0KTsgY29uc3QgdSA9IHRoaXMuY2FzdFQgLyAxLjE7IHJhaXNlID0gTWF0aC5zaW4oTWF0aC5taW4oMSwgKDEgLSB1KSAqIDEuNikgKiBNYXRoLlBJICogMC41KSAqICh1ID4gMC4yNSA/IDEgOiB1IC8gMC4yNSk7IH1cbiAgICB0aGlzLnJpZy5wb3NpdGlvbi55ID0gYm9iIC0gMC4yOCAqIHRoaXMuZG93bjsgdGhpcy5yaWcucm90YXRpb24ueCA9IC1yZWNvaWwgKyAwLjkgKiB0aGlzLmRvd247IHRoaXMucmlnLnJvdGF0aW9uLnogPSBNYXRoLnNpbih0aGlzLnQgKiAxLjMpICogMC4wMyArIE1hdGguc2luKHRoaXMuaHVydFQgKiA2MCkgKiAwLjAzICogKHRoaXMuaHVydFQgPiAwID8gMSA6IDApO1xuICAgIHRoaXMuc3RhZmZQaXZvdC5yb3RhdGlvbi56ID0gLTAuMTUgKiByYWlzZSAtIDAuMDU7IHRoaXMuc3RhZmZQaXZvdC5yb3RhdGlvbi54ID0gLTAuNDUgKiByYWlzZTsgdGhpcy5zdGFmZlBpdm90LnBvc2l0aW9uLnkgPSAwLjYgKyAwLjM1ICogcmFpc2U7XG4gICAgdGhpcy5jcnlzdGFsLnJvdGF0aW9uLnkgKz0gZHQgKiAoMiArIDYgKiByYWlzZSk7IGNvbnN0IHB1bHNlID0gMSArIDAuMTIgKiBNYXRoLnNpbih0aGlzLnQgKiA0KSArIDEuMSAqIHJhaXNlOyB0aGlzLmNyeXN0YWwuc2NhbGluZy5zZXQocHVsc2UsIDEuNSAqIHB1bHNlLCBwdWxzZSk7XG4gICAgY29uc3QgZGltID0gMSAtIDAuODUgKiB0aGlzLmRvd247XG4gICAgdGhpcy5jcnlzdGFsTWF0LmVtaXNzaXZlQ29sb3Iuc2V0KCgwLjc1ICsgMC4yNSAqIHJhaXNlKSAqIGRpbSwgKDAuMzUgKyAwLjQgKiByYWlzZSkgKiBkaW0sIDEgKiBkaW0pO1xuICAgIHRoaXMuZXllTWF0LmVtaXNzaXZlQ29sb3Iuc2V0KDAuOSAqIGRpbSArIGZsYXNoICogMC4xLCAoMC40ICsgMC4yNSAqIHJhaXNlKSAqIGRpbSAqICgxIC0gZmxhc2ggKiAwLjYpLCAxICogZGltICogKDEgLSBmbGFzaCAqIDAuNykpO1xuICAgIHRoaXMucm9iZU1hdC5lbWlzc2l2ZUNvbG9yLnNldCgwLjA1ICsgZmxhc2ggKiAwLjYsIDAuMDIsIDAuMSAqICgxIC0gZmxhc2gpKTtcbiAgICB0aGlzLmdsb3cuc2NhbGluZy5zZXRBbGwoMC42ICsgMC45ICogZGltICsgcmFpc2UgKiAwLjgpO1xuICAgIHRoaXMucHMuZW1pdFJhdGUgPSAoMzAgKyA5MCAqIHJhaXNlKSAqIGRpbTtcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7IHRoaXMucHMuc3RvcCgpOyB0aGlzLnBzLmRpc3Bvc2UoKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG4iLCAiLy8gQWxsIHNvdW5kIGlzIHN5bnRoZXNpemVkIGluIHRoZSBicm93c2VyIHdpdGggdGhlIFdlYiBBdWRpbyBBUEk6IG5vIGF1ZGlvIGZpbGVzIHRvIGRvd25sb2FkLCBsaWNlbnNlIG9yIHNoaXAuXG4vLyBUd28gaW5kZXBlbmRlbnQgc3dpdGNoZXMgKG11c2ljLCBzb3VuZCBlZmZlY3RzKSwgc2F2ZWQgaW4gdGhlIHBsYXllcidzIHNhdmUuIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdGFwLCBzbyBub3RoaW5nIHN0YXJ0c1xuLy8gdW50aWwgdGhlIGZpcnN0IHRvdWNoL2NsaWNrIChgdW5sb2NrYCkuXG5pbXBvcnQgeyBsb2FkU2F2ZSwgdXBkYXRlU2V0dGluZ3MgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuXG5leHBvcnQgdHlwZSBTZnggPSAndGFwJyB8ICdzdW1tb24nIHwgJ21lcmdlJyB8ICdoaXQnIHwgJ2hpdEFycm93JyB8ICdzbWFzaCcgfCAnYXJyb3cnIHwgJ2RlYXRoJyB8ICdjYXN0JyB8ICd0YXVudCcgfCAnc2hvY2t3YXZlJyB8ICdyZXN1cnJlY3QnIHwgJ2hlYXJ0TG9zdCcgfCAndmljdG9yeScgfCAnZGVmZWF0JyB8ICdzdGFydCdcbiAgfCAndW5sb2NrJyB8ICdwYWNrQ2hhcmdlJyB8ICdwYWNrVGllclVwJyB8ICdwYWNrVGVhcicgfCAncGFja0ZhbicgfCAncGFja0ZsaXAnIHwgJ3BhY2tSYXJlJyB8ICdwYWNrRXBpYycgfCAncGFja0xlZ2VuZCcgfCAncGFja0NvbGxlY3QnO1xuZXhwb3J0IHR5cGUgTW9kZSA9ICdidWlsZCcgfCAnYmF0dGxlJztcblxuLy8gTXVzaWM6IEEgbWlub3IsIDgwIGJwbSwgZm91ciBiYXJzIGxvb3BpbmcgKEFtLCBGLCBDLCBFKS4gUm9vdCBub3RlIGZpcnN0LCB0aGVuIGNob3JkIHRvbmVzIChIeikuXG5jb25zdCBDSE9SRFM6IG51bWJlcltdW10gPSBbXG4gIFsxMTAsIDE2NC44MSwgMjIwLCAyNjEuNjMsIDMyOS42M10sXG4gIFs4Ny4zMSwgMTMwLjgxLCAxNzQuNjEsIDIyMCwgMjYxLjYzXSxcbiAgWzEzMC44MSwgMTk2LCAyNjEuNjMsIDMyOS42MywgMzkyXSxcbiAgWzgyLjQxLCAxMjMuNDcsIDE2NC44MSwgMjA3LjY1LCAyNDYuOTRdLFxuXTtcbmNvbnN0IEJFQVQgPSA2MCAvIDgwO1xuXG5jbGFzcyBBdWRpb0VuZ2luZSB7XG4gIHByaXZhdGUgY3R4OiBBdWRpb0NvbnRleHQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBtYXN0ZXIhOiBHYWluTm9kZTsgcHJpdmF0ZSBtdXNpY0J1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIHNmeEJ1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIG5vaXNlQnVmITogQXVkaW9CdWZmZXI7XG4gIG11c2ljID0gdHJ1ZTsgc2Z4ID0gdHJ1ZTsgbW9kZTogTW9kZSA9ICdidWlsZCc7XG4gIHByaXZhdGUgdGltZXIgPSAwOyBwcml2YXRlIG5leHRUID0gMDsgcHJpdmF0ZSBiZWF0ID0gMDsgcHJpdmF0ZSBzdGFtcHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcigpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB9XG5cbiAgcHJpdmF0ZSBzaWxlbnQ6IEhUTUxBdWRpb0VsZW1lbnQgfCBudWxsID0gbnVsbDsgcHJpdmF0ZSBwcmltZWQgPSBmYWxzZTtcbiAgLyoqIGlQaG9uZXMgbXV0ZSBXZWIgQXVkaW8gd2hlbiB0aGUgcmluZ2VyIHN3aXRjaCBpcyBvbiwgdW5sZXNzIHRoZSBwYWdlIGlzIHBsYXlpbmcgXCJyZWFsXCIgbWVkaWEuIEEgc2lsZW50IGxvb3BpbmcgPGF1ZGlvPiBlbGVtZW50IChwbHVzIHRoZVxuICAgKiAgYXVkaW9TZXNzaW9uIGhpbnQgb24gbmV3ZXIgaU9TKSBtb3ZlcyB0aGUgcGFnZSB0byB0aGUgcGxheWJhY2sgY2hhbm5lbCwgc28gdGhlIGdhbWUgaXMgaGVhcmQgZXZlbiB3aXRoIHRoZSBzd2l0Y2ggb24gc2lsZW50LiAqL1xuICBwcml2YXRlIHBsYXliYWNrQ2hhbm5lbCgpIHtcbiAgICB0cnkgeyBjb25zdCBhID0gKG5hdmlnYXRvciBhcyBhbnkpLmF1ZGlvU2Vzc2lvbjsgaWYgKGEpIGEudHlwZSA9ICdwbGF5YmFjayc7IH0gY2F0Y2ggeyAvKiBub3Qgc3VwcG9ydGVkICovIH1cbiAgICBpZiAodGhpcy5zaWxlbnQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbiA9IDQ0MSwgYnVmID0gbmV3IEFycmF5QnVmZmVyKDQ0ICsgbiAqIDIpLCB2ID0gbmV3IERhdGFWaWV3KGJ1ZiksIHN0ciA9IChvOiBudW1iZXIsIHQ6IHN0cmluZykgPT4geyBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspIHYuc2V0VWludDgobyArIGksIHQuY2hhckNvZGVBdChpKSk7IH07XG4gICAgICBzdHIoMCwgJ1JJRkYnKTsgdi5zZXRVaW50MzIoNCwgMzYgKyBuICogMiwgdHJ1ZSk7IHN0cig4LCAnV0FWRScpOyBzdHIoMTIsICdmbXQgJyk7IHYuc2V0VWludDMyKDE2LCAxNiwgdHJ1ZSk7IHYuc2V0VWludDE2KDIwLCAxLCB0cnVlKTsgdi5zZXRVaW50MTYoMjIsIDEsIHRydWUpO1xuICAgICAgdi5zZXRVaW50MzIoMjQsIDQ0MTAwLCB0cnVlKTsgdi5zZXRVaW50MzIoMjgsIDg4MjAwLCB0cnVlKTsgdi5zZXRVaW50MTYoMzIsIDIsIHRydWUpOyB2LnNldFVpbnQxNigzNCwgMTYsIHRydWUpOyBzdHIoMzYsICdkYXRhJyk7IHYuc2V0VWludDMyKDQwLCBuICogMiwgdHJ1ZSk7XG4gICAgICBjb25zdCBlbCA9IG5ldyBBdWRpbyhVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtidWZdLCB7IHR5cGU6ICdhdWRpby93YXYnIH0pKSk7IGVsLmxvb3AgPSB0cnVlOyBlbC52b2x1bWUgPSAwLjAxOyBlbC5zZXRBdHRyaWJ1dGUoJ3BsYXlzaW5saW5lJywgJycpOyB0aGlzLnNpbGVudCA9IGVsO1xuICAgICAgZWwucGxheSgpLmNhdGNoKCgpID0+IHsgdGhpcy5zaWxlbnQgPSBudWxsOyB9KTtcbiAgICB9IGNhdGNoIHsgLyogZmluZTogc291bmQgc3RpbGwgd29ya3MsIGp1c3QgZm9sbG93cyB0aGUgc2lsZW50IHN3aXRjaCAqLyB9XG4gIH1cbiAgLyoqIFdoYXQgdGhlIFNldHRpbmdzIHBhZ2Ugc2hvd3Mgc28gYSBzaWxlbnQgcGhvbmUgY2FuIGJlIGRpYWdub3NlZC4gKi9cbiAgc3RhdHVzKCk6IHsgc3RhdGU6IHN0cmluZzsgdW5sb2NrZWQ6IGJvb2xlYW4gfSB7IHJldHVybiB7IHN0YXRlOiB0aGlzLmN0eCA/IHRoaXMuY3R4LnN0YXRlIDogJ25vdCBzdGFydGVkJywgdW5sb2NrZWQ6ICEhdGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgPT09ICdydW5uaW5nJyB9OyB9XG4gIC8qKiBUaGUgU2V0dGluZ3MgcGFnZSdzIFRlc3Qgc291bmQgYnV0dG9uOiB1bmxvY2sgYW5kIG1ha2UgYSBjbGVhcmx5IGF1ZGlibGUgc291bmQuICovXG4gIHRlc3QoKSB7IHRoaXMudW5sb2NrKCk7IGNvbnN0IHQgPSAoKSA9PiB7IHRoaXMucGxheSgndmljdG9yeScpOyB9OyBpZiAodGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkudGhlbih0KS5jYXRjaCgoKSA9PiB7fSk7IGVsc2UgdCgpOyB9XG5cbiAgLyoqIENhbGwgZnJvbSBhIHVzZXIgZ2VzdHVyZSAodGFwL2NsaWNrKS4gU2FmZSB0byBjYWxsIHJlcGVhdGVkbHkuICovXG4gIHVubG9jaygpIHtcbiAgICB0aGlzLnBsYXliYWNrQ2hhbm5lbCgpO1xuICAgIGlmICghdGhpcy5jdHgpIHtcbiAgICAgIGNvbnN0IEMgPSAod2luZG93IGFzIGFueSkuQXVkaW9Db250ZXh0IHx8ICh3aW5kb3cgYXMgYW55KS53ZWJraXRBdWRpb0NvbnRleHQ7IGlmICghQykgcmV0dXJuO1xuICAgICAgY29uc3QgY3R4OiBBdWRpb0NvbnRleHQgPSB0aGlzLmN0eCA9IG5ldyBDKCk7XG4gICAgICBjb25zdCBjb21wID0gY3R4LmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvcigpOyBjb21wLmNvbm5lY3QoY3R4LmRlc3RpbmF0aW9uKTtcbiAgICAgIHRoaXMubWFzdGVyID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tYXN0ZXIuZ2Fpbi52YWx1ZSA9IDAuOTsgdGhpcy5tYXN0ZXIuY29ubmVjdChjb21wKTtcbiAgICAgIHRoaXMubXVzaWNCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm11c2ljQnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpOyB0aGlzLnNmeEJ1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMuc2Z4QnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpO1xuICAgICAgY3R4Lm9uc3RhdGVjaGFuZ2UgPSAoKSA9PiB7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tYXVkaW8tc3RhdGUnKSk7IH07XG4gICAgICBjb25zdCBsZW4gPSBjdHguc2FtcGxlUmF0ZTsgdGhpcy5ub2lzZUJ1ZiA9IGN0eC5jcmVhdGVCdWZmZXIoMSwgbGVuLCBjdHguc2FtcGxlUmF0ZSk7IGNvbnN0IGQgPSB0aGlzLm5vaXNlQnVmLmdldENoYW5uZWxEYXRhKDApOyBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKSBkW2ldID0gTWF0aC5yYW5kb20oKSAqIDIgLSAxO1xuICAgIH1cbiAgICBpZiAodGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkuY2F0Y2goKCkgPT4ge30pOyAgICAgICAgICAgICAvLyAnc3VzcGVuZGVkJyBvciAoaU9TKSAnaW50ZXJydXB0ZWQnXG4gICAgaWYgKCF0aGlzLnByaW1lZCkgeyB0aGlzLnByaW1lZCA9IHRydWU7IHRyeSB7IGNvbnN0IGIgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXIoMSwgMSwgMjIwNTApLCBzID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyU291cmNlKCk7IHMuYnVmZmVyID0gYjsgcy5jb25uZWN0KHRoaXMuY3R4LmRlc3RpbmF0aW9uKTsgcy5zdGFydCgwKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9IH1cbiAgICB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTtcbiAgfVxuXG4gIHNldE11c2ljKG9uOiBib29sZWFuKSB7IHRoaXMubXVzaWMgPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBtdXNpYzogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyB9XG4gIHNldFNmeChvbjogYm9vbGVhbikgeyB0aGlzLnNmeCA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IHNmeDogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyBpZiAob24pIHRoaXMucGxheSgndGFwJyk7IH1cbiAgLyoqIFJlLXJlYWQgdGhlIHNhdmVkIHN3aXRjaGVzICh0aGUgc2hlbGwncyBTZXR0aW5ncyBwYWdlIGNoYW5nZXMgdGhlbSB0b28pLiAqL1xuICByZWxvYWQoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IH1cbiAgc2V0TW9kZShtOiBNb2RlKSB7IHRoaXMubW9kZSA9IG07IH1cblxuICBwcml2YXRlIGFwcGx5R2FpbnMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuOyBjb25zdCB0ID0gdGhpcy5jdHguY3VycmVudFRpbWU7XG4gICAgdGhpcy5tdXNpY0J1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLm11c2ljID8gMC41IDogMCwgdCwgMC4xNSk7IHRoaXMuc2Z4QnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMuc2Z4ID8gMC44IDogMCwgdCwgMC4wNSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbXVzaWNcbiAgcHJpdmF0ZSBzeW5jTXVzaWMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLm11c2ljICYmICF0aGlzLnRpbWVyKSB7IHRoaXMubmV4dFQgPSB0aGlzLmN0eC5jdXJyZW50VGltZSArIDAuMTU7IHRoaXMudGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy50aWNrKCksIDIwMCk7IH1cbiAgICBpZiAoIXRoaXMubXVzaWMgJiYgdGhpcy50aW1lcikgeyBjbGVhckludGVydmFsKHRoaXMudGltZXIpOyB0aGlzLnRpbWVyID0gMDsgfVxuICB9XG4gIHByaXZhdGUgdGljaygpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7IGlmIChjdHguc3RhdGUgIT09ICdydW5uaW5nJykgeyB0aGlzLm5leHRUID0gY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgcmV0dXJuOyB9XG4gICAgd2hpbGUgKHRoaXMubmV4dFQgPCBjdHguY3VycmVudFRpbWUgKyAwLjYpIHsgdGhpcy5wbGF5QmVhdCh0aGlzLmJlYXQsIHRoaXMubmV4dFQpOyB0aGlzLm5leHRUICs9IEJFQVQ7IHRoaXMuYmVhdCA9ICh0aGlzLmJlYXQgKyAxKSAlIDE2OyB9XG4gIH1cbiAgcHJpdmF0ZSBwbGF5QmVhdChiZWF0OiBudW1iZXIsIHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGNob3JkID0gQ0hPUkRTW01hdGguZmxvb3IoYmVhdCAvIDQpXSwgaW5CYXIgPSBiZWF0ICUgNCwgYmF0dGxlID0gdGhpcy5tb2RlID09PSAnYmF0dGxlJztcbiAgICBpZiAoaW5CYXIgPT09IDApIGZvciAoY29uc3QgZiBvZiBjaG9yZCkgdGhpcy52b2ljZShmLCAndHJpYW5nbGUnLCB0LCBCRUFUICogNCArIDAuOCwgMC4wNDUsIDAuOSwgOTAwKTsgICAvLyBzbG93IHBhZFxuICAgIGlmIChpbkJhciA9PT0gMCB8fCBpbkJhciA9PT0gMikgdGhpcy52b2ljZShjaG9yZFswXSwgJ3NpbmUnLCB0LCBCRUFUICogMS42LCAwLjE2LCAwLjAyLCA0MDApOyAgICAgICAgICAvLyBiYXNzXG4gICAgaWYgKGJhdHRsZSkge1xuICAgICAgdGhpcy5raWNrKHQsIDAuMzIpOyBpZiAoaW5CYXIgPT09IDIpIHRoaXMua2ljayh0ICsgQkVBVCAqIDAuNSwgMC4xOCk7XG4gICAgICB0aGlzLm5vaXNlKHQgKyBCRUFUICogMC41LCAwLjA1LCAwLjA1LCAnaGlnaHBhc3MnLCA3MDAwKTsgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDEuNSAlIEJFQVQsIDAuMDUsIDAuMDMsICdoaWdocGFzcycsIDcwMDApO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAyOyBpKyspIHRoaXMudm9pY2UoY2hvcmRbMSArICgoYmVhdCAqIDIgKyBpKSAlIDQpXSAqIDIsICd0cmlhbmdsZScsIHQgKyBpICogQkVBVCAvIDIsIDAuMjIsIDAuMDUsIDAuMDA1LCAyNTAwKTsgICAvLyBwbHVjayBhcnBlZ2dpb1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHZvaWNlKGZyZXE6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgYXR0YWNrOiBudW1iZXIsIGxwOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS52YWx1ZSA9IGZyZXE7IGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBNYXRoLm1heCgwLjAwNSwgYXR0YWNrKSk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGtpY2sodDogbnVtYmVyLCBnYWluOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZSgxMzAsIHQpOyBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDQyLCB0ICsgMC4xNCk7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgMC4yKTtcbiAgICBvLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyAwLjI1KTtcbiAgfVxuICBwcml2YXRlIG5vaXNlKHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBidXM6IEdhaW5Ob2RlID0gdGhpcy5tdXNpY0J1cywgc3dlZXBUbz86IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbiA9IGN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgbi5idWZmZXIgPSB0aGlzLm5vaXNlQnVmOyBmLnR5cGUgPSB0eXBlOyBmLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHN3ZWVwVG8pIGYuZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc3dlZXBUbywgdCArIGR1cik7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG4uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QoYnVzKTsgbi5zdGFydCh0LCBNYXRoLnJhbmRvbSgpICogMC41KTsgbi5zdG9wKHQgKyBkdXIgKyAwLjAyKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzb3VuZCBlZmZlY3RzXG4gIHByaXZhdGUgdG9uZShmcmVxOiBudW1iZXIsIGR1cjogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZ2FpbjogbnVtYmVyLCBkZWxheSA9IDAsIHNsaWRlVG8/OiBudW1iZXIsIGF0dGFjayA9IDAuMDA1LCBscCA9IDgwMDApIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIHQgPSBjdHguY3VycmVudFRpbWUgKyBkZWxheSwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc2xpZGVUbykgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzbGlkZVRvLCB0ICsgZHVyKTtcbiAgICBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIGF0dGFjayk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLnNmeEJ1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBoaXNzKGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgZGVsYXkgPSAwLCBzd2VlcFRvPzogbnVtYmVyKSB7IHRoaXMubm9pc2UodGhpcy5jdHghLmN1cnJlbnRUaW1lICsgZGVsYXksIGR1ciwgZ2FpbiwgdHlwZSwgZnJlcSwgdGhpcy5zZnhCdXMsIHN3ZWVwVG8pOyB9XG4gIHByaXZhdGUgdGhyb3R0bGUoa2V5OiBzdHJpbmcsIG1zOiBudW1iZXIpIHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpOyBpZiAobiAtICh0aGlzLnN0YW1wc1trZXldIHx8IDApIDwgbXMpIHJldHVybiBmYWxzZTsgdGhpcy5zdGFtcHNba2V5XSA9IG47IHJldHVybiB0cnVlOyB9XG5cbiAgcGxheShuYW1lOiBTZngpIHtcbiAgICBpZiAoIXRoaXMuY3R4IHx8ICF0aGlzLnNmeCB8fCB0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSByZXR1cm47XG4gICAgc3dpdGNoIChuYW1lKSB7XG4gICAgICBjYXNlICd0YXAnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ3RhcCcsIDQwKSkgcmV0dXJuOyB0aGlzLnRvbmUoNzYwLCAwLjA2LCAnc2luZScsIDAuMjIsIDAsIDExMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3N1bW1vbic6IHRoaXMuaGlzcygwLjQsIDAuMTQsICdiYW5kcGFzcycsIDUwMCwgMCwgMjUwMCk7IHRoaXMudG9uZSgyMjAsIDAuNCwgJ3Nhd3Rvb3RoJywgMC4xLCAwLCA2NjAsIDAuMDUsIDE4MDApOyB0aGlzLnRvbmUoMTMyMCwgMC4yLCAnc2luZScsIDAuMSwgMC4xOCk7IGJyZWFrO1xuICAgICAgY2FzZSAnbWVyZ2UnOiBbNTIzLCA2NTksIDc4NCwgMTA0Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuMzUsICd0cmlhbmdsZScsIDAuMiwgaSAqIDAuMDcpKTsgdGhpcy5oaXNzKDAuNSwgMC4wOCwgJ2hpZ2hwYXNzJywgNTAwMCwgMC4xKTsgdGhpcy50b25lKDExMCwgMC4zLCAnc2luZScsIDAuMzUsIDAsIDUwKTsgdGhpcy50b25lKDE1NjgsIDAuNSwgJ3NpbmUnLCAwLjA4LCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ2hpdCc6IGlmICghdGhpcy50aHJvdHRsZSgnaGl0JywgNDUpKSByZXR1cm47IHRoaXMuaGlzcygwLjA3LCAwLjI0LCAnbG93cGFzcycsIDE4MDApOyB0aGlzLnRvbmUoMTcwLCAwLjA5LCAnc2luZScsIDAuMjIsIDAsIDgwKTsgYnJlYWs7XG4gICAgICBjYXNlICdoaXRBcnJvdyc6IGlmICghdGhpcy50aHJvdHRsZSgnaGl0QScsIDQ1KSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4wNSwgMC4xNCwgJ2JhbmRwYXNzJywgMzAwMCk7IHRoaXMudG9uZSg3MDAsIDAuMDYsICd0cmlhbmdsZScsIDAuMDYsIDAsIDQwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc21hc2gnOiB0aGlzLnRvbmUoOTUsIDAuMzgsICdzaW5lJywgMC41LCAwLCAzNCk7IHRoaXMuaGlzcygwLjMyLCAwLjM1LCAnbG93cGFzcycsIDEwMDAsIDAsIDIwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnYXJyb3cnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2Fycm93JywgNjApKSByZXR1cm47IHRoaXMuaGlzcygwLjE0LCAwLjEsICdiYW5kcGFzcycsIDE4MDAsIDAsIDQyMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2RlYXRoJzogaWYgKCF0aGlzLnRocm90dGxlKCdkZWF0aCcsIDcwKSkgcmV0dXJuOyB0aGlzLnRvbmUoMzAwLCAwLjQsICdzYXd0b290aCcsIDAuMTQsIDAsIDcwLCAwLjAxLCA5MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2Nhc3QnOiB0aGlzLnRvbmUoMzAwLCAwLjQ1LCAnc2luZScsIDAuMTgsIDAsIDkwMCwgMC4wNSk7IHRoaXMudG9uZSg0NTAsIDAuNDUsICdzaW5lJywgMC4xLCAwLjA1LCAxMzUwLCAwLjA1KTsgdGhpcy50b25lKDE4MDAsIDAuMjUsICdzaW5lJywgMC4wNSwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICd0YXVudCc6IHRoaXMudG9uZSgxOTYsIDAuNSwgJ3NxdWFyZScsIDAuMDgsIDAsIDE4MCwgMC4wMywgNzAwKTsgdGhpcy50b25lKDE0NywgMC41LCAnc2F3dG9vdGgnLCAwLjA4LCAwLjAyLCAxNDAsIDAuMDMsIDYwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc2hvY2t3YXZlJzogdGhpcy50b25lKDIyMCwgMS4xLCAnc2luZScsIDAuNSwgMCwgMjgsIDAuMDIpOyB0aGlzLmhpc3MoMS4wLCAwLjM1LCAnbG93cGFzcycsIDMwMDAsIDAsIDE1MCk7IHRoaXMudG9uZSg4ODAsIDAuOCwgJ3NpbmUnLCAwLjA4LCAwLCAyMjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3Jlc3VycmVjdCc6IFsyMjAsIDI3NywgMzMwLCA0NDAsIDU1NF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDEuMSwgJ3RyaWFuZ2xlJywgMC4xLCBpICogMC4xMiwgZiAqIDEuMTIsIDAuMykpOyB0aGlzLmhpc3MoMC45LCAwLjA2LCAnaGlnaHBhc3MnLCA0NTAwLCAwLjIpOyBicmVhaztcbiAgICAgIGNhc2UgJ2hlYXJ0TG9zdCc6IHRoaXMudG9uZSgxMTAsIDAuNywgJ3Nhd3Rvb3RoJywgMC4yOCwgMCwgNTAsIDAuMDEsIDQ1MCk7IHRoaXMuaGlzcygwLjE4LCAwLjIsICdsb3dwYXNzJywgOTAwKTsgdGhpcy50b25lKDIzMywgMC41LCAnc3F1YXJlJywgMC4wNSwgMC4wMiwgMjIwLCAwLjAxLCA1MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3ZpY3RvcnknOiBbMzkyLCA0OTQsIDU4NywgNzg0XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC41LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4xMSkpOyB0aGlzLnRvbmUoMTk2LCAwLjksICdzaW5lJywgMC4yKTsgYnJlYWs7XG4gICAgICBjYXNlICdkZWZlYXQnOiBbMzMwLCAyOTQsIDI0NywgMTk2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC43LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4yOCwgZiAqIDAuOTcpKTsgdGhpcy50b25lKDgyLCAxLjYsICdzaW5lJywgMC4zLCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3VubG9jayc6IFswLjM1LCAwLjQ3LCAwLjU5LCAwLjcxXS5mb3JFYWNoKChkLCBpKSA9PiB7IHRoaXMuaGlzcygwLjA1LCAwLjIyLCAnYmFuZHBhc3MnLCA5MDAgKyBpICogMTIwLCBkKTsgdGhpcy50b25lKDE3MCArIGkgKiAxMiwgMC4wNywgJ3NxdWFyZScsIDAuMDYsIGQsIHVuZGVmaW5lZCwgMC4wMDIsIDYwMCk7IH0pOyBbNzg0LCAxMDQ2LCAxMzE4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC42LCAndHJpYW5nbGUnLCAwLjE2LCAxLjE1ICsgaSAqIDAuMDcpKTsgdGhpcy5oaXNzKDAuNSwgMC4wOSwgJ2hpZ2hwYXNzJywgNTAwMCwgMS4yKTsgdGhpcy50b25lKDExMCwgMC4zLCAnc2luZScsIDAuMjUsIDEuMTUsIDYwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrQ2hhcmdlJzogdGhpcy50b25lKDkwLCAxLjA1LCAnc2luZScsIDAuMjUsIDAsIDI2MCwgMC4yKTsgdGhpcy5oaXNzKDAuOTUsIDAuMTIsICdsb3dwYXNzJywgMzAwLCAwLCAyMjAwKTsgdGhpcy50b25lKDE4MCwgMS4wLCAndHJpYW5nbGUnLCAwLjA2LCAwLjEsIDUyMCwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrVGllclVwJzogWzQ0MCwgNTU0LCA2NTksIDg4MF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNCwgJ3RyaWFuZ2xlJywgMC4yLCBpICogMC4wNikpOyB0aGlzLnRvbmUoMTc2MCwgMC42LCAnc2luZScsIDAuMDksIDAuMik7IHRoaXMuaGlzcygwLjQsIDAuMSwgJ2hpZ2hwYXNzJywgNTAwMCwgMC4xKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrVGVhcic6IHRoaXMuaGlzcygwLjM1LCAwLjMsICdiYW5kcGFzcycsIDE1MDAsIDAsIDYwMDApOyB0aGlzLnRvbmUoMTIwLCAwLjQ1LCAnc2luZScsIDAuNCwgMC4wNSwgNDApOyBbMTA0NiwgMTMxOCwgMTU2OF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNiwgJ3RyaWFuZ2xlJywgMC4xLCAwLjEyICsgaSAqIDAuMDUpKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRmFuJzogdGhpcy5oaXNzKDAuNSwgMC4xLCAnaGlnaHBhc3MnLCAzMDAwKTsgdGhpcy50b25lKDY2MCwgMC40NSwgJ3NpbmUnLCAwLjEsIDAsIDEzMjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tGbGlwJzogdGhpcy5oaXNzKDAuMDgsIDAuMTUsICdiYW5kcGFzcycsIDI1MDApOyB0aGlzLnRvbmUoNTAwLCAwLjEyLCAnc2luZScsIDAuMTQsIDAsIDgwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1JhcmUnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs3ODQsIDk4OF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNDUsICd0cmlhbmdsZScsIDAuMTQsIDAuMDUgKyBpICogMC4wOSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tFcGljJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNTIzLCA2NTksIDc4NCwgMTA0Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNywgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMDcpKTsgdGhpcy50b25lKDExMCwgMC41LCAnc2luZScsIDAuMywgMCwgNjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tMZWdlbmQnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs1MjMsIDY1OSwgNzg0LCAxMDQ2LCAxMzE4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMS4xLCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wOCkpOyB0aGlzLnRvbmUoODIsIDAuOSwgJ3NpbmUnLCAwLjM1LCAwLCA1MCk7IHRoaXMuaGlzcygwLjgsIDAuMSwgJ2hpZ2hwYXNzJywgNTAwMCwgMC4xKTsgdGhpcy50b25lKDIwOTMsIDAuNywgJ3NpbmUnLCAwLjA3LCAwLjQpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tDb2xsZWN0JzogWzY1OSwgOTg4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC4zNSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMDkpKTsgYnJlYWs7XG4gICAgICBjYXNlICdzdGFydCc6IHRoaXMudG9uZSgxNDcsIDAuOSwgJ3Nhd3Rvb3RoJywgMC4xMywgMCwgMTUwLCAwLjE1LCA2NTApOyB0aGlzLnRvbmUoMjIwLCAwLjksICdzYXd0b290aCcsIDAuMDksIDAuMDUsIDIyNCwgMC4xNSwgNjUwKTsgdGhpcy5oaXNzKDAuNiwgMC4wNiwgJ2xvd3Bhc3MnLCA2MDApOyBicmVhaztcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGF1ZGlvID0gbmV3IEF1ZGlvRW5naW5lKCk7XG4od2luZG93IGFzIGFueSkuX19hdWRpbyA9IGF1ZGlvO1xuXG4vLyBQaG9uZXMgb25seSBhbGxvdyBzb3VuZCBhZnRlciBhIHRvdWNoOiB0aGUgZmlyc3QgdGFwIGFueXdoZXJlIHVubG9ja3MgaXQuIEV2ZXJ5IGJ1dHRvbiBhbHNvIGdldHMgYSBzbWFsbCBjbGljay5cbi8vIGlPUyBvbmx5IGFjY2VwdHMgYW4gdW5sb2NrIGZyb20gYSBGSU5JU0hFRCB0YXAgKHRvdWNoZW5kIC8gY2xpY2spLCBub3QgZnJvbSB0aGUgc3RhcnQgb2Ygb25lLCBzbyBsaXN0ZW4gdG8gYWxsIG9mIHRoZW0uXG5jb25zdCB1bmxvY2tPbmNlID0gKCkgPT4gYXVkaW8udW5sb2NrKCk7XG5mb3IgKGNvbnN0IGV2IG9mIFsncG9pbnRlcmRvd24nLCAncG9pbnRlcnVwJywgJ3RvdWNoZW5kJywgJ2NsaWNrJywgJ2tleWRvd24nXSkgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldiwgdW5sb2NrT25jZSwgeyBjYXB0dXJlOiB0cnVlIH0pO1xuZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4geyBjb25zdCBlbCA9IGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50IHwgbnVsbDsgaWYgKGVsICYmIGVsLmNsb3Nlc3QgJiYgZWwuY2xvc2VzdCgnYnV0dG9uLCBhLmJ0biwgLnJhaWwgYScpKSBhdWRpby5wbGF5KCd0YXAnKTsgfSwgdHJ1ZSk7XG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCd2aXNpYmlsaXR5Y2hhbmdlJywgKCkgPT4geyBjb25zdCBjID0gKGF1ZGlvIGFzIGFueSkuY3R4IGFzIEF1ZGlvQ29udGV4dCB8IG51bGw7IGlmICghYykgcmV0dXJuOyBpZiAoZG9jdW1lbnQuaGlkZGVuKSBjLnN1c3BlbmQoKTsgZWxzZSBpZiAoYXVkaW8ubXVzaWMgfHwgYXVkaW8uc2Z4KSBjLnJlc3VtZSgpOyB9KTtcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCduZWNyby1zZXR0aW5ncy1jaGFuZ2VkJywgKCkgPT4gYXVkaW8ucmVsb2FkKCkpO1xuIiwgIi8vIFNhdmluZyBhIHJ1biBpbiBwcm9ncmVzcyBzbyBpdCBzdXJ2aXZlcyBhIHBhZ2UgcmVsb2FkIChTYWZhcmkgb24gYSBwaG9uZSBjYW4gZHJvcCB0aGUgcGFnZSBhdCBhbnkgdGltZSkuXG4vLyBPbmx5IGNhbG0gbW9tZW50cyBhcmUgc2F2ZWQ6IHRoZSBidWlsZCBwaGFzZSBhbmQgdGhlIHZpY3RvcnkgZHJhZnQuIEEgYmF0dGxlIGluIHByb2dyZXNzIGlzIG5vdCBzYXZlZDsgcmVsb2FkaW5nIGR1cmluZyBvbmUgcHV0cyB5b3UgYmFja1xuLy8gYXQgdGhlIGJ1aWxkIHNjcmVlbiB5b3UgcHJlc3NlZCBCYXR0bGUgZnJvbSAobm90aGluZyBsb3N0LCBub3RoaW5nIGdhaW5lZCkuIEV2ZXJ5dGhpbmcgcmVhZCBiYWNrIGlzIHZhbGlkYXRlZDsgYW55dGhpbmcgb2RkIGlzIGlnbm9yZWQuXG5cbmltcG9ydCB7IEdSSURfQ0VMTFMsIEhFQVJUUywgTUFYX1NUQVIsIFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMsIFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSwgVW5pdCB9IGZyb20gJy4vcnVsZXMudHMnO1xuaW1wb3J0IHsgYnJvd3NlclN0b3JlIH0gZnJvbSAnLi9zYXZlLnRzJztcbmltcG9ydCB0eXBlIHsgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5jb25zdCBLRVkgPSAnbmVjcm8tcnVuJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNlcmlhbGl6ZWRTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlczsgcm5nOiB7IHNlZWQ6IG51bWJlcjsgcG9zOiBudW1iZXIgfTtcbiAgd2F2ZTogbnVtYmVyOyBoZWFydHM6IG51bWJlcjsgY2FwOiBudW1iZXI7IGhhbmQ6IFNvdWxJZFtdOyB1bml0czogVW5pdFtdOyBuZXh0SWQ6IG51bWJlcjsgZGlzY2FyZFVzZWQ6IGJvb2xlYW47XG4gIHN0YXR1czogJ2J1aWxkaW5nJzsgbG9nOiBzdHJpbmdbXTsgc3RhdHM6IFN0YXRlWydzdGF0cyddO1xufVxuZXhwb3J0IGludGVyZmFjZSBSdW5TbmFwc2hvdCB7IHY6IG51bWJlcjsgc2VlZDogbnVtYmVyOyBhdHRlbXB0OiBudW1iZXI7IHN0YWdlOiBzdHJpbmc7IGRpZmZpY3VsdHk6IHN0cmluZzsgcGhhc2U6ICdidWlsZCcgfCAnZHJhZnQnOyBkcmFmdDogU291bElkW10gfCBudWxsOyBzdGF0ZTogU2VyaWFsaXplZFN0YXRlIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZVN0YXRlKHM6IFN0YXRlKTogU2VyaWFsaXplZFN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBydWxlczogSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzLnJ1bGVzKSksIHJuZzogeyBzZWVkOiBzLnJuZy5zZWVkLCBwb3M6IHMucm5nLnN0YXRlKCkgfSxcbiAgICB3YXZlOiBzLndhdmUsIGhlYXJ0czogcy5oZWFydHMsIGNhcDogcy5jYXAsIGhhbmQ6IHMuaGFuZC5zbGljZSgpLCB1bml0czogcy51bml0cy5tYXAoKHUpID0+ICh7IC4uLnUgfSkpLCBuZXh0SWQ6IHMubmV4dElkLCBkaXNjYXJkVXNlZDogcy5kaXNjYXJkVXNlZCxcbiAgICBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogcy5sb2cuc2xpY2UoLTQwKSwgc3RhdHM6IHsgLi4ucy5zdGF0cyB9LFxuICB9O1xufVxuXG5jb25zdCBpc1NvdWwgPSAoeDogYW55KTogeCBpcyBTb3VsSWQgPT4gU09VTFMuaW5jbHVkZXMoeCk7XG5jb25zdCBpbnQgPSAoeDogYW55LCBsbzogbnVtYmVyLCBoaTogbnVtYmVyKSA9PiBOdW1iZXIuaXNJbnRlZ2VyKHgpICYmIHggPj0gbG8gJiYgeCA8PSBoaTtcblxuLyoqIFJlYnVpbGQgYSBTdGF0ZSBmcm9tIHNhdmVkIGRhdGEsIG9yIG51bGwgaWYgYW55dGhpbmcgYWJvdXQgaXQgaXMgbm90IGJlbGlldmFibGUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVTdGF0ZSh4OiBhbnkpOiBTdGF0ZSB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHIgPSB4LnJ1bGVzO1xuICAgIGlmICghciB8fCAhQXJyYXkuaXNBcnJheShyLmN1cnZlKSB8fCAhci5jdXJ2ZS5sZW5ndGggfHwgIXIuY3VydmUuZXZlcnkoKG46IGFueSkgPT4gTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIubWVyZ2UgIT09ICdkZXBsb3llZE9ubHknICYmIHIubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoci5wb29sICE9PSB1bmRlZmluZWQgJiYgIShBcnJheS5pc0FycmF5KHIucG9vbCkgJiYgci5wb29sLmxlbmd0aCAmJiByLnBvb2wuZXZlcnkoaXNTb3VsKSkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHN0YWdlV2F2ZXMgPSByLnN0YWdlV2F2ZXMgPz8gci5jdXJ2ZS5sZW5ndGg7XG4gICAgaWYgKCFpbnQoeC53YXZlLCAxLCBNYXRoLm1pbihzdGFnZVdhdmVzLCByLmN1cnZlLmxlbmd0aCkpIHx8ICFpbnQoeC5oZWFydHMsIDEsIEhFQVJUUykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmNhcCkgfHwgeC5jYXAgPD0gMCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHguaGFuZCkgfHwgeC5oYW5kLmxlbmd0aCA+IDQwIHx8ICF4LmhhbmQuZXZlcnkoaXNTb3VsKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHgudW5pdHMpIHx8IHgudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFpbnQoeC5uZXh0SWQsIDEsIDFlNikgfHwgdHlwZW9mIHguZGlzY2FyZFVzZWQgIT09ICdib29sZWFuJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY2VsbHMgPSBuZXcgU2V0PG51bWJlcj4oKSwgaWRzID0gbmV3IFNldDxudW1iZXI+KCksIHVuaXRzOiBVbml0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgeC51bml0cykge1xuICAgICAgaWYgKCF1IHx8ICFpc1NvdWwodS5zb3VsKSB8fCAhaW50KHUuc3RhciwgMSwgTUFYX1NUQVIpIHx8ICFpbnQodS5jZWxsLCAwLCBHUklEX0NFTExTIC0gMSkgfHwgIWludCh1LmlkLCAxLCB4Lm5leHRJZCkgfHwgY2VsbHMuaGFzKHUuY2VsbCkgfHwgaWRzLmhhcyh1LmlkKSkgcmV0dXJuIG51bGw7XG4gICAgICBjZWxscy5hZGQodS5jZWxsKTsgaWRzLmFkZCh1LmlkKTsgdW5pdHMucHVzaCh7IGlkOiB1LmlkLCBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsLCBmcmVzaDogISF1LmZyZXNoIH0pO1xuICAgIH1cbiAgICBjb25zdCBzdCA9IHguc3RhdHM7XG4gICAgaWYgKCFzdCB8fCAhWydkcmF3bicsICdkaXNjYXJkZWQnLCAnZGlzbWlzc2VkJywgJ21lcmdlcycsICdmYWlsdXJlcyddLmV2ZXJ5KChrKSA9PiBOdW1iZXIuaXNGaW5pdGUoc3Rba10pKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF4LnJuZyB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5ybmcucG9zKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bGVzOiByIGFzIFJ1bGVzLCBybmc6IG1ha2VSbmcoeC5ybmcuc2VlZCwgeC5ybmcucG9zKSwgd2F2ZTogeC53YXZlLCBoZWFydHM6IHguaGVhcnRzLCBjYXA6IHguY2FwLCBoYW5kOiB4LmhhbmQuc2xpY2UoKSwgdW5pdHMsIG5leHRJZDogeC5uZXh0SWQsXG4gICAgICBkaXNjYXJkVXNlZDogeC5kaXNjYXJkVXNlZCwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IEFycmF5LmlzQXJyYXkoeC5sb2cpID8geC5sb2cuZmlsdGVyKChsOiBhbnkpID0+IHR5cGVvZiBsID09PSAnc3RyaW5nJykuc2xpY2UoLTQwKSA6IFtdLFxuICAgICAgc3RhdHM6IHsgZHJhd246IHN0LmRyYXduLCBkaXNjYXJkZWQ6IHN0LmRpc2NhcmRlZCwgZGlzbWlzc2VkOiBzdC5kaXNtaXNzZWQsIG1lcmdlczogc3QubWVyZ2VzLCBmYWlsdXJlczogc3QuZmFpbHVyZXMgfSxcbiAgICB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhdmVSdW4oc25hcDogUnVuU25hcHNob3QsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzbmFwKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDogdGhlIHJ1biBqdXN0IHdpbGwgbm90IHN1cnZpdmUgYSByZWxvYWQgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyUnVuKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUgJiYgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbSkgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbShLRVkpOyBlbHNlIGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksICcnKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG59XG5leHBvcnQgZnVuY3Rpb24gbG9hZFJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IHQgPSBzdG9yZSAmJiBzdG9yZS5nZXRJdGVtKEtFWSk7IGlmICghdCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgeCA9IEpTT04ucGFyc2UodCk7XG4gICAgaWYgKCF4IHx8IHgudiAhPT0gVkVSU0lPTiB8fCAoeC5waGFzZSAhPT0gJ2J1aWxkJyAmJiB4LnBoYXNlICE9PSAnZHJhZnQnKSB8fCAhTnVtYmVyLmlzRmluaXRlKHguc2VlZCkgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmF0dGVtcHQpIHx8IHR5cGVvZiB4LmRpZmZpY3VsdHkgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGF0ZSA9IGRlc2VyaWFsaXplU3RhdGUoeC5zdGF0ZSk7IGlmICghc3RhdGUpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGRyYWZ0ID0geC5waGFzZSA9PT0gJ2RyYWZ0JyAmJiBBcnJheS5pc0FycmF5KHguZHJhZnQpICYmIHguZHJhZnQubGVuZ3RoID09PSAzICYmIHguZHJhZnQuZXZlcnkoaXNTb3VsKSA/IHguZHJhZnQgOiBudWxsO1xuICAgIHJldHVybiB7IHNuYXA6IHsgdjogVkVSU0lPTiwgc2VlZDogeC5zZWVkLCBhdHRlbXB0OiB4LmF0dGVtcHQsIHN0YWdlOiB0eXBlb2YgeC5zdGFnZSA9PT0gJ3N0cmluZycgPyB4LnN0YWdlIDogJ2NyeXB0JywgZGlmZmljdWx0eTogeC5kaWZmaWN1bHR5LCBwaGFzZTogZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJywgZHJhZnQsIHN0YXRlOiB4LnN0YXRlIH0sIHN0YXRlIH07XG4gIH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxufVxuZXhwb3J0IGNvbnN0IFJVTl9WRVJTSU9OID0gVkVSU0lPTjtcbiIsICIvLyBQZXJtYW5lbnQgcHJvZ3Jlc3Npb246IHN0YWdlIGNsZWFycyAtPiBTb3VsIFBhY2tzIC0+IGNvcGllcyAtPiBTb3VsIGxldmVscy4gUHVyZSBmdW5jdGlvbnMgdGhhdCBjaGFuZ2UgYSBTYXZlICh0aGUgY2FsbGVyIHBlcnNpc3RzIGl0KS5cbi8vIFBsYWNlaG9sZGVyIG51bWJlcnMsIGxpa2UgcGFja3MudHMuIEluLXJ1biBzdGFyIG1lcmdpbmcgaXMgYSBzZXBhcmF0ZSwgdGVtcG9yYXJ5IHN5c3RlbSBhbmQgbmV2ZXIgdG91Y2hlcyBhbnkgb2YgdGhpcy5cblxuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBMRVZFTF9DT1NUX01VTFQsIFBBQ0tfVElFUlMsIFJBUklUWV9PRiwgb3BlblBhY2sgfSBmcm9tICcuL3BhY2tzLnRzJztcbmltcG9ydCB0eXBlIHsgUGFja0l0ZW0sIFBhY2tSZXN1bHQgfSBmcm9tICcuL3BhY2tzLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHsgbG9hZFNhdmUsIHdyaXRlU2F2ZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5pbXBvcnQgeyBTVEFHRVMsIHN0YWdlQnlJZCwgc3RhZ2VJbmRleCB9IGZyb20gJy4vd2F2ZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBEaWZmaWN1bHR5LCBTYXZlLCBTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5cbmV4cG9ydCBjb25zdCBNQVhfUEFDS1MgPSA5OTtcblxuLyoqIFdoZXJlIHBhY2tzIGNvbWUgZnJvbS4gUExBQ0VIT0xERVIuIEZpcnN0IGNsZWFyIG9mIGEgc3RhZ2Ugb24gZWFjaCBkaWZmaWN1bHR5IGdpdmVzIG9uZSBpbXByb3ZlZCBwYWNrOyBsYXRlciBjbGVhcnMgZmlsbCBhIG1ldGVyLiAqL1xuZXhwb3J0IGNvbnN0IFJFV0FSRFMgPSB7XG4gIGZpcnN0Q2xlYXJUaWVyOiB7IGVhc3k6IDEsIG5vcm1hbDogMiwgaGFyZDogMiwgbmlnaHRtYXJlOiAzIH0gYXMgUmVjb3JkPERpZmZpY3VsdHksIG51bWJlcj4sXG4gIHJlcGxheVRpZXI6IDEsXG4gIHJlcGxheUNsZWFyc1BlclBhY2s6IDIsXG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbGV2ZWxzXG5leHBvcnQgY29uc3QgbWF4TGV2ZWwgPSAoKTogbnVtYmVyID0+IEJBTEFOQ0UubGV2ZWwuY29waWVzVG9MZXZlbC5sZW5ndGggKyAxO1xuZXhwb3J0IGNvbnN0IGlzTWF4TGV2ZWwgPSAobGV2ZWw6IG51bWJlcik6IGJvb2xlYW4gPT4gbGV2ZWwgPj0gbWF4TGV2ZWwoKTtcbi8qKiBDb3BpZXMgbmVlZGVkIHRvIHRha2UgYHNvdWxgIGZyb20gYGxldmVsYCB0byB0aGUgbmV4dCBvbmUgKDAgd2hlbiBhbHJlYWR5IG1heCkuIFJhcmVyIFNvdWxzIG5lZWQgZmV3ZXIuICovXG5leHBvcnQgY29uc3QgY29waWVzTmVlZGVkID0gKGxldmVsOiBudW1iZXIsIHNvdWw6IFNvdWxJZCk6IG51bWJlciA9PiAoaXNNYXhMZXZlbChsZXZlbCkgPyAwIDogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZChCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWxbbGV2ZWwgLSAxXSAqIExFVkVMX0NPU1RfTVVMVFtSQVJJVFlfT0Zbc291bF1dKSkpO1xuZXhwb3J0IGZ1bmN0aW9uIGNhbkxldmVsVXAoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogYm9vbGVhbiB7IGNvbnN0IHAgPSBzYXZlLnNvdWxzW3NvdWxdOyByZXR1cm4gIWlzTWF4TGV2ZWwocC5sZXZlbCkgJiYgcC5jb3BpZXMgPj0gY29waWVzTmVlZGVkKHAubGV2ZWwsIHNvdWwpOyB9XG4vKiogU3BlbmQgdGhlIGNvcGllcywgZ2FpbiBhIGxldmVsLiBSZXR1cm5zIGZhbHNlIGlmIHRoZSBTb3VsIGlzIG5vdCByZWFkeS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsZXZlbFVwKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4ge1xuICBpZiAoIWNhbkxldmVsVXAoc2F2ZSwgc291bCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IHAuY29waWVzIC09IGNvcGllc05lZWRlZChwLmxldmVsLCBzb3VsKTsgcC5sZXZlbCsrOyByZXR1cm4gdHJ1ZTtcbn1cbi8qKiBNdWx0aXBsaWVyIGFwcGxpZWQgdG8gYSBTb3VsJ3MgaGVhbHRoL2RhbWFnZSBmcm9tIGl0cyBwZXJtYW5lbnQgbGV2ZWwgKGxldmVsIDEgPSAxLjApLiAqL1xuZXhwb3J0IGNvbnN0IGxldmVsTXVsdCA9IChsZXZlbDogbnVtYmVyLCBzdGF0OiAnaHAnIHwgJ2RtZycpOiBudW1iZXIgPT4gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEJBTEFOQ0UubGV2ZWxbc3RhdF07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwYWNrc1xuZXhwb3J0IGZ1bmN0aW9uIGdyYW50UGFjayhzYXZlOiBTYXZlLCB0aWVyOiBudW1iZXIsIHNvdXJjZTogc3RyaW5nKTogUGFja0l0ZW0gfCBudWxsIHtcbiAgaWYgKHNhdmUucGFja3MubGVuZ3RoID49IE1BWF9QQUNLUykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhY2s6IFBhY2tJdGVtID0geyBpZDogc2F2ZS5uZXh0UGFja0lkKyssIHRpZXI6IE1hdGgubWF4KDEsIE1hdGgubWluKFBBQ0tfVElFUlMsIE1hdGguZmxvb3IodGllcikpKSwgc291cmNlIH07XG4gIHNhdmUucGFja3MucHVzaChwYWNrKTsgcmV0dXJuIHBhY2s7XG59XG5cbi8qKiBPcGVuIGFuIG93bmVkIHBhY2s6IGl0IGlzIHJlbW92ZWQgYW5kIGl0cyBjb3BpZXMgYXJlIGFkZGVkIHRvIHRoZSBTb3VscyBpbW1lZGlhdGVseSAoc28gbm90aGluZyBpcyBsb3N0IGlmIHRoZSBwYWdlIGNsb3NlcyBtaWQtYW5pbWF0aW9uKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuT3duZWRQYWNrKHNhdmU6IFNhdmUsIHBhY2tJZDogbnVtYmVyLCBybmc6IFJuZyk6IFBhY2tSZXN1bHQgfCBudWxsIHtcbiAgY29uc3QgaSA9IHNhdmUucGFja3MuZmluZEluZGV4KChwKSA9PiBwLmlkID09PSBwYWNrSWQpOyBpZiAoaSA8IDApIHJldHVybiBudWxsO1xuICBjb25zdCBwYWNrID0gc2F2ZS5wYWNrc1tpXTsgc2F2ZS5wYWNrcy5zcGxpY2UoaSwgMSk7XG4gIGNvbnN0IHJlc3VsdCA9IG9wZW5QYWNrKHBhY2sudGllciwgcm5nKTtcbiAgZm9yIChjb25zdCByIG9mIHJlc3VsdC5yZXZlYWxzKSBzYXZlLnNvdWxzW3Iuc291bF0uY29waWVzICs9IHIuY29waWVzO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENsZWFyUmV3YXJkIHsgZmlyc3Q6IGJvb2xlYW47IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgcmVwbGF5TWV0ZXI6IG51bWJlcjsgcmVwbGF5TmVlZGVkOiBudW1iZXI7IHVubG9ja2VkOiBzdHJpbmdbXSB9XG4vKiogQSBzdGFnZSB3YXMgY2xlYXJlZCBvbiBgZGlmZmljdWx0eWAuIFRoZSBmaXJzdCBjbGVhciBvbiB0aGF0IGRpZmZpY3VsdHkgZ3JhbnRzIGEgYmV0dGVyIHBhY2s7IGxhdGVyIGNsZWFycyBmaWxsIHRoZSByZXBsYXkgbWV0ZXIuICovXG5mdW5jdGlvbiByZWNvcmRDbGVhckJhc2Uoc2F2ZTogU2F2ZSwgc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5KTogT21pdDxDbGVhclJld2FyZCwgJ3VubG9ja2VkJz4ge1xuICBjb25zdCBrZXkgPSBzdGFnZUlkICsgJzonICsgZGlmZmljdWx0eSwgYmVmb3JlID0gc2F2ZS5jbGVhcnNba2V5XSA/PyAwO1xuICBzYXZlLmNsZWFyc1trZXldID0gYmVmb3JlICsgMTtcbiAgaWYgKGJlZm9yZSA9PT0gMCkgcmV0dXJuIHsgZmlyc3Q6IHRydWUsIHBhY2s6IGdyYW50UGFjayhzYXZlLCBSRVdBUkRTLmZpcnN0Q2xlYXJUaWVyW2RpZmZpY3VsdHldLCAnRmlyc3QgY2xlYXIgXHUwMEI3ICcgKyBkaWZmaWN1bHR5KSwgcmVwbGF5TWV0ZXI6IHNhdmUucmVwbGF5TWV0ZXIsIHJlcGxheU5lZWRlZDogUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrIH07XG4gIHNhdmUucmVwbGF5TWV0ZXIrKztcbiAgbGV0IHBhY2s6IFBhY2tJdGVtIHwgbnVsbCA9IG51bGw7XG4gIGlmIChzYXZlLnJlcGxheU1ldGVyID49IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjaykgeyBzYXZlLnJlcGxheU1ldGVyIC09IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjazsgcGFjayA9IGdyYW50UGFjayhzYXZlLCBSRVdBUkRTLnJlcGxheVRpZXIsICdSZXBsYXkgcmV3YXJkJyk7IH1cbiAgcmV0dXJuIHsgZmlyc3Q6IGZhbHNlLCBwYWNrLCByZXBsYXlNZXRlcjogc2F2ZS5yZXBsYXlNZXRlciwgcmVwbGF5TmVlZGVkOiBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2sgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBlcnNpc3RlZCB3cmFwcGVycyAodXNlZCBieSB0aGUgZ2FtZSBidW5kbGUpXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQ2xlYXJBbmRTYXZlKHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBDbGVhclJld2FyZCB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IHIgPSByZWNvcmRDbGVhcihzLCBzdGFnZUlkLCBkaWZmaWN1bHR5KTsgd3JpdGVTYXZlKHMsIHN0b3JlKTsgcmV0dXJuIHI7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB1bmxvY2sgcnVsZXNcbi8vIEVhc3kgYW5kIE5vcm1hbCBhcmUgb3BlbiBvbiBldmVyeSB1bmxvY2tlZCBzdGFnZS4gQ2xlYXJpbmcgTm9ybWFsIG9wZW5zIEhhcmQgb24gdGhhdCBzdGFnZSBBTkQgdW5sb2NrcyB0aGUgbmV4dCBzdGFnZS4gQ2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5leHBvcnQgY29uc3QgY2xlYXJDb3VudCA9IChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogbnVtYmVyID0+IHNhdmUuY2xlYXJzW3N0YWdlICsgJzonICsgZF0gPz8gMDtcbmV4cG9ydCBmdW5jdGlvbiBzdGFnZVVubG9ja2VkKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBib29sZWFuIHsgcmV0dXJuIGluZGV4IDw9IDAgfHwgKGluZGV4IDwgU1RBR0VTLmxlbmd0aCAmJiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tpbmRleCAtIDFdLmlkLCAnbm9ybWFsJykgPiAwKTsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogYm9vbGVhbiB7XG4gIGNvbnN0IGlkeCA9IFNUQUdFUy5maW5kSW5kZXgoKHMpID0+IHMuaWQgPT09IHN0YWdlKTsgaWYgKGlkeCA8IDAgfHwgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZCA9PT0gJ2Vhc3knIHx8IGQgPT09ICdub3JtYWwnKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIGQgPT09ICdoYXJkJyA/IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdub3JtYWwnKSA+IDAgOiBjbGVhckNvdW50KHNhdmUsIHN0YWdlLCAnaGFyZCcpID4gMDtcbn1cbi8qKiBXaHkgYSBzdGFnZSBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhZ2VMb2NrUmVhc29uKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBzdHJpbmcgeyByZXR1cm4gc3RhZ2VVbmxvY2tlZChzYXZlLCBpbmRleCkgPyAnJyA6ICdDbGVhciAnICsgU1RBR0VTW2luZGV4IC0gMV0ubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jay4nOyB9XG4vKiogV2h5IGEgdGllciBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgc3RhZ2U6IHN0cmluZywgZDogRGlmZmljdWx0eSk6IHN0cmluZyB7XG4gIGlmIChkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIGQpKSByZXR1cm4gJyc7XG4gIGNvbnN0IGlkeCA9IHN0YWdlSW5kZXgoc3RhZ2UpOyBpZiAoIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIHN0YWdlTG9ja1JlYXNvbihzYXZlLCBpZHgpO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIE5vcm1hbCB0byB1bmxvY2sgSGFyZC4nIDogJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIEhhcmQgdG8gdW5sb2NrIE5pZ2h0bWFyZS4nO1xufVxuLyoqIFdoYXRldmVyIHdhcyBzYXZlZCwgbWFrZSBpdCBhIHN0YWdlIGFuZCB0aWVyIHRoZSBwbGF5ZXIgbWF5IGFjdHVhbGx5IHBsYXkuICovXG5leHBvcnQgZnVuY3Rpb24gcGxheWFibGUoc2F2ZTogU2F2ZSk6IHsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogRGlmZmljdWx0eSB9IHtcbiAgbGV0IGlkeCA9IHN0YWdlSW5kZXgoc2F2ZS5zdGFnZSk7IHdoaWxlIChpZHggPiAwICYmICFzdGFnZVVubG9ja2VkKHNhdmUsIGlkeCkpIGlkeC0tO1xuICBjb25zdCBzdGFnZSA9IFNUQUdFU1tpZHhdLmlkO1xuICByZXR1cm4geyBzdGFnZSwgZGlmZmljdWx0eTogZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0YWdlLCBzYXZlLmRpZmZpY3VsdHkpID8gc2F2ZS5kaWZmaWN1bHR5IDogJ25vcm1hbCcgfTtcbn1cblxuLyoqIEV2ZXJ5IHVubG9jayB0aGUgcGxheWVyIG1heSBiZSBjZWxlYnJhdGVkIGZvcjogbGF0ZXIgc3RhZ2VzIGFuZCB0aGUgSGFyZCAvIE5pZ2h0bWFyZSB0aWVycyAoRWFzeSwgTm9ybWFsIGFuZCBTdGFnZSAxIGFyZSBvcGVuIGZyb20gdGhlIHN0YXJ0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmxvY2tlZEtleXMoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qga2V5czogc3RyaW5nW10gPSBbXTtcbiAgU1RBR0VTLmZvckVhY2goKHN0LCBpKSA9PiB7XG4gICAgaWYgKGkgPiAwICYmIHN0YWdlVW5sb2NrZWQoc2F2ZSwgaSkpIGtleXMucHVzaCgnc3RhZ2U6JyArIHN0LmlkKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgWydoYXJkJywgJ25pZ2h0bWFyZSddIGFzIERpZmZpY3VsdHlbXSkgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdC5pZCwgZCkpIGtleXMucHVzaCgndGllcjonICsgc3QuaWQgKyAnOicgKyBkKTtcbiAgfSk7XG4gIHJldHVybiBrZXlzO1xufVxuLyoqIFVubG9ja3Mgbm90IHlldCBjZWxlYnJhdGVkLiAqL1xuZXhwb3J0IGNvbnN0IG5ld1VubG9ja3MgPSAoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdID0+IHVubG9ja2VkS2V5cyhzYXZlKS5maWx0ZXIoKGspID0+ICEoc2F2ZS5zZWVuID8/IFtdKS5pbmNsdWRlcyhrKSk7XG5jb25zdCBUSUVSX05BTUU6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IGhhcmQ6ICdIYXJkIG1vZGUnLCBuaWdodG1hcmU6ICdOaWdodG1hcmUgbW9kZScgfTtcbi8qKiBXb3JkcyBmb3IgYW4gdW5sb2NrIGtleSwgZm9yIGJhbm5lcnMuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVVbmxvY2soa2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBba2luZCwgc3RhZ2UsIHRpZXJdID0ga2V5LnNwbGl0KCc6Jyk7XG4gIGlmIChraW5kID09PSAnc3RhZ2UnKSByZXR1cm4gc3RhZ2VCeUlkKHN0YWdlKS5uYW1lICsgJyAobmV3IHN0YWdlKSc7XG4gIHJldHVybiAoVElFUl9OQU1FW3RpZXJdID8/IHRpZXIpICsgJyBvbiAnICsgc3RhZ2VCeUlkKHN0YWdlKS5uYW1lO1xufVxuLyoqIENsZWFyaW5nIGEgc3RhZ2U6IHJld2FyZHMsIGFuZCB3aGljaCB1bmxvY2tzIHRoaXMgY2xlYXIgb3BlbmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgYmVmb3JlID0gdW5sb2NrZWRLZXlzKHNhdmUpLCByID0gcmVjb3JkQ2xlYXJCYXNlKHNhdmUsIHN0YWdlSWQsIGRpZmZpY3VsdHkpO1xuICByZXR1cm4geyAuLi5yLCB1bmxvY2tlZDogdW5sb2NrZWRLZXlzKHNhdmUpLmZpbHRlcigoaykgPT4gIWJlZm9yZS5pbmNsdWRlcyhrKSkgfTtcbn1cbiIsICIvLyBFdmVyeXRoaW5nIHlvdSBTRUUgZm9yIGEgdW5pdDogcmVhbCBUcmlwbyBtb2RlbHMgKFNrZWxldG9uIFdhcnJpb3IsIFNrZWxldG9uIEFyY2hlciksIHNpbXBsZSBzdGFuZC1pbnMgZm9yIHRoZSBmb3VyXG4vLyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBnZW5lcmF0ZWQgeWV0LCBhbmQgdGhlIFwic3RhciBsb29rXCIgbGF5ZXJlZCBvbiB0b3Agb2YgYm90aCAoc2l6ZSwgdGludCwgYXVyYSwgaGFsbywgYmFkZ2UpLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcblxuZXhwb3J0IHR5cGUgVlN0YXRlID0gJ2lkbGUnIHwgJ3J1bicgfCAnYXR0YWNrJyB8ICdkZWF0aCcgfCAnc3Bhd24nIHwgJ2NoZWVyJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uICsgeWF3IGhlcmVcbiAgdGVhbTogMCB8IDE7IHN0YXI6IG51bWJlcjsgc3RhdGU6IFZTdGF0ZTsgdG9wOiBudW1iZXI7XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQ/OiBudW1iZXIpOiB2b2lkO1xuICBzZXRTdGFyKHN0YXI6IG51bWJlcik6IHZvaWQ7XG4gIHNldFRlYW0odGVhbTogMCB8IDEpOiB2b2lkO1xuICBzZXRIcChmcmFjOiBudW1iZXIgfCBudWxsKTogdm9pZDsgIC8vIG51bGwgaGlkZXMgdGhlIGhlYWx0aCBiYXJcbiAgc2V0TWFuYShmcmFjOiBudW1iZXIgfCBudWxsKTogdm9pZDsgLy8gbnVsbCBoaWRlcyB0aGUgbWFuYSBiYXIgKHVuaXRzIHdpdGhvdXQgYSBza2lsbClcbiAgcHVsc2UoKTogdm9pZDsgICAgICAgICAgICAgICAgICAgICAvLyBicmllZiBoaXQgcmVhY3Rpb25cbiAgdXBkYXRlKGR0OiBudW1iZXIpOiB2b2lkO1xuICBkaXNwb3NlKCk6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhciBsb29rc1xuLy8gMSBzdGFyID0gdGhlIHBsYWluIG1vZGVsLiAyIHN0YXJzID0gYSBsaXR0bGUgYmlnZ2VyLCBjb29sIHNpbHZlci1ibHVlIHRpbnQsIGJyaWdodGVyIGF1cmEuIDMgc3RhcnMgPSBiaWdnZXN0LCB3YXJtIGdvbGQgdGludCxcbi8vIHN0cm9uZyBnb2xkLXZpb2xldCBhdXJhIGFuZCBhIGZsb2F0aW5nIGdvbGQgaGFsby4gRXZlcnl0aGluZyBoZXJlIGlzIGZyZWU6IG5vIGV4dHJhIFRyaXBvIGdlbmVyYXRpb25zLlxuY29uc3QgVElOVDogbnVtYmVyW11bXSA9IFtbMSwgMSwgMV0sIFswLjg2LCAwLjk1LCAxLjE4XSwgWzEuMjUsIDEuMSwgMC43XV07XG5jb25zdCBBVVJBID0gW1xuICB7IHJhdGU6IDE0LCBtaW46IDAuMDYsIG1heDogMC4xNiwgYzE6IFswLjc4LCAwLjM1LCAxLCAwLjddLCBjMjogWzAuNDUsIDAuMTUsIDAuOSwgMC41XSB9LFxuICB7IHJhdGU6IDI2LCBtaW46IDAuMDgsIG1heDogMC4yMCwgYzE6IFswLjg1LCAwLjY1LCAxLCAwLjhdLCBjMjogWzAuNTUsIDAuNCwgMSwgMC42XSB9LFxuICB7IHJhdGU6IDQ0LCBtaW46IDAuMTAsIG1heDogMC4yNiwgYzE6IFsxLCAwLjg1LCAwLjQsIDAuODVdLCBjMjogWzAuOCwgMC4zLCAxLCAwLjddIH0sXG5dO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFzc2V0cyB7XG4gIHNjZW5lOiBhbnk7IHNvZnQ6IGFueTsgc3RhclRleDogYW55W107IHRyaXBvOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIFRyaXBvQ2ZnPj47XG4gIHJpbmdNYXQ6IGFueVtdOyBoYWxvTWF0OiBhbnk7IGJhckJnOiBhbnk7IGJhckZpbGw6IGFueVtdOyBtYW5hRmlsbDogYW55O1xufVxuaW50ZXJmYWNlIFRyaXBvQ2ZnIHsgY29udGFpbmVyOiBhbnk7IGVuZW15VGV4OiBhbnk7IGNsaXBzOiBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+OyBtYXRDYWNoZTogUmVjb3JkPHN0cmluZywgYW55PjsgYmFzZU1hdD86IGFueTsgdG9wOiBudW1iZXI7IHNjYWxlOiBudW1iZXIgfVxuXG5mdW5jdGlvbiBkeW4oc2NlbmU6IGFueSwgdzogbnVtYmVyLCBoOiBudW1iZXIsIGRyYXc6IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHZvaWQsIGFscGhhID0gdHJ1ZSkge1xuICBjb25zdCB0ID0gbmV3IEJBQllMT04uRHluYW1pY1RleHR1cmUoJ2R0JywgeyB3aWR0aDogdywgaGVpZ2h0OiBoIH0sIHNjZW5lLCB0cnVlKTsgZHJhdyh0LmdldENvbnRleHQoKSk7IHQudXBkYXRlKCk7IHQuaGFzQWxwaGEgPSBhbHBoYTsgcmV0dXJuIHQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkQXNzZXRzKHNjZW5lOiBhbnkpOiBQcm9taXNlPEFzc2V0cz4ge1xuICBjb25zdCBzb2Z0ID0gZHluKHNjZW5lLCA2NCwgNjQsIChjKSA9PiB7IGNvbnN0IGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KDMyLCAzMiwgMCwgMzIsIDMyLCAzMik7IGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDEpJyk7IGcuYWRkQ29sb3JTdG9wKDAuNCwgJ3JnYmEoMjU1LDI1NSwyNTUsLjU1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpOyBjLmZpbGxTdHlsZSA9IGc7IGMuZmlsbFJlY3QoMCwgMCwgNjQsIDY0KTsgfSk7XG4gIGNvbnN0IHN0YXJUZXggPSBbMSwgMiwgM10ubWFwKChuKSA9PiBkeW4oc2NlbmUsIDE5MiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDQwcHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gNTsgYy5zdHJva2VTdHlsZSA9ICcjMWExMDIwJzsgYy5maWxsU3R5bGUgPSBuID09PSAzID8gJyNmZmQyNGEnIDogbiA9PT0gMiA/ICcjZDdlNmZmJyA6ICcjZjBkOWEwJzsgY29uc3QgcyA9ICdcdTI2MDUnLnJlcGVhdChuKTsgYy5zdHJva2VUZXh0KHMsIDk2LCAzOCk7IGMuZmlsbFRleHQocywgOTYsIDM4KTsgfSkpO1xuICBjb25zdCBlbWlzc2l2ZSA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyLCBhID0gMSkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZW0nLCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHIsIGcsIGIpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYWxwaGEgPSBhOyByZXR1cm4gbTsgfTtcbiAgY29uc3QgQTogQXNzZXRzID0ge1xuICAgIHNjZW5lLCBzb2Z0LCBzdGFyVGV4LCB0cmlwbzoge30sIHJpbmdNYXQ6IFtlbWlzc2l2ZSgwLjU1LCAwLjIsIDAuOTUsIDAuOSksIGVtaXNzaXZlKDAuOTUsIDAuMjUsIDAuMiwgMC45KV0sIGhhbG9NYXQ6IGVtaXNzaXZlKDEsIDAuODIsIDAuMywgMC45NSksXG4gICAgYmFyQmc6IGVtaXNzaXZlKDAuMDUsIDAuMDUsIDAuMDgsIDAuNyksIGJhckZpbGw6IFtlbWlzc2l2ZSgwLjU1LCAwLjM1LCAxKSwgZW1pc3NpdmUoMSwgMC40LCAwLjMpXSwgbWFuYUZpbGw6IGVtaXNzaXZlKDAuMjUsIDAuNzUsIDEpLFxuICB9O1xuICBjb25zdCBkZWZzOiBbU291bElkLCBzdHJpbmcsIHN0cmluZywgUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPiwgbnVtYmVyLCBudW1iZXJdW10gPSBbXG4gICAgWyd3YXJyaW9yJywgJ3NrZWxldG9uX3dhcnJpb3IuZ2xiJywgJ3NrZWxldG9uX3dhcnJpb3JfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdCbG9jaycgfSwgMS4wNSwgMS4wXSxcbiAgICBbJ2FyY2hlcicsICdTa2VsZXRvbkFyY2hlci5nbGInLCAnU2tlbGV0b25BcmNoZXJfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ1Nob290JywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0ZsZXgnIH0sIDEuMDUsIDEuMF0sXG4gIF07XG4gIGF3YWl0IFByb21pc2UuYWxsKGRlZnMubWFwKGFzeW5jIChbc291bCwgZ2xiLCBlbmVteSwgY2xpcHMsIHRvcCwgc2NhbGVdKSA9PiB7XG4gICAgY29uc3QgY29udGFpbmVyID0gYXdhaXQgQkFCWUxPTi5TY2VuZUxvYWRlci5Mb2FkQXNzZXRDb250YWluZXJBc3luYygnYXNzZXRzLycsIGdsYiwgc2NlbmUpO1xuICAgIEEudHJpcG9bc291bF0gPSB7IGNvbnRhaW5lciwgZW5lbXlUZXg6IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy8nICsgZW5lbXksIHNjZW5lLCBmYWxzZSwgZmFsc2UpLCBjbGlwcywgbWF0Q2FjaGU6IHt9LCB0b3AsIHNjYWxlIH07XG4gIH0pKTtcbiAgcmV0dXJuIEE7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2hhcmVkIGRlY29yYXRpb25cbmNsYXNzIERlY28ge1xuICBwcml2YXRlIHBzOiBhbnkgPSBudWxsOyBwcml2YXRlIGhhbG86IGFueSA9IG51bGw7IHByaXZhdGUgYmFkZ2U6IGFueTsgcHJpdmF0ZSBzdGFyczogYW55OyBwcml2YXRlIGZpbGw6IGFueTsgcHJpdmF0ZSBiYXI6IGFueTsgcHJpdmF0ZSBtYmc6IGFueTsgcHJpdmF0ZSBtZmlsbDogYW55OyBwcml2YXRlIHJpbmc6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgcGFyZW50OiBhbnksIHByaXZhdGUgdG9wOiBudW1iZXIsIHByaXZhdGUgcmFkaXVzOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZTtcbiAgICB0aGlzLnJpbmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZURpc2MoJ3JpbmcnLCB7IHJhZGl1czogTWF0aC5tYXgoMC4zLCByYWRpdXMgKiAxLjE1KSwgdGVzc2VsbGF0aW9uOiAyNiB9LCBzKTsgdGhpcy5yaW5nLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdGhpcy5yaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyB0aGlzLnJpbmcucGFyZW50ID0gcGFyZW50OyB0aGlzLnJpbmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMuYmFkZ2UgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdiYWRnZScsIHMpOyB0aGlzLmJhZGdlLnBhcmVudCA9IHBhcmVudDsgdGhpcy5iYWRnZS5wb3NpdGlvbi55ID0gdG9wICsgMC4zMjsgdGhpcy5iYWRnZS5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMO1xuICAgIHRoaXMuc3RhcnMgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdzdGFycycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjE1IH0sIHMpOyB0aGlzLnN0YXJzLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuc3RhcnMucG9zaXRpb24ueSA9IDAuMTE7IHRoaXMuc3RhcnMuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IHNtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnc20nLCBzKTsgc20uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IHNtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHNtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgdGhpcy5zdGFycy5tYXRlcmlhbCA9IHNtOyAodGhpcy5zdGFycyBhcyBhbnkpLl9zbSA9IHNtO1xuICAgIGNvbnN0IGJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnYmcnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4wODUgfSwgcyk7IGJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IGJnLm1hdGVyaWFsID0gQS5iYXJCZzsgYmcuaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmJhciA9IGJnO1xuICAgIHRoaXMuZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2ZpbGwnLCB7IHdpZHRoOiAwLjU2LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMuZmlsbC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLmZpbGwucG9zaXRpb24ueiA9IC0wLjAwMjsgdGhpcy5maWxsLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLm1iZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21iZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA1IH0sIHMpOyB0aGlzLm1iZy5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLm1iZy5wb3NpdGlvbi55ID0gLTAuMDc7IHRoaXMubWJnLm1hdGVyaWFsID0gQS5iYXJCZzsgdGhpcy5tYmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWZpbGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdtZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wMyB9LCBzKTsgdGhpcy5tZmlsbC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLm1maWxsLnBvc2l0aW9uLnNldCgwLCAtMC4wNywgLTAuMDAyKTsgdGhpcy5tZmlsbC5tYXRlcmlhbCA9IEEubWFuYUZpbGw7IHRoaXMubWZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMuYmFyLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLmZpbGwuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWJnLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1maWxsLnNldEVuYWJsZWQoZmFsc2UpO1xuICB9XG4gIHNldCh0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IHRoaXMuQS5zY2VuZSwgY2ZnID0gQVVSQVtzdGFyIC0gMV07XG4gICAgKHRoaXMuc3RhcnMgYXMgYW55KS5fc20uZGlmZnVzZVRleHR1cmUgPSB0aGlzLkEuc3RhclRleFtzdGFyIC0gMV07XG4gICAgdGhpcy5yaW5nLm1hdGVyaWFsID0gdGhpcy5BLnJpbmdNYXRbdGVhbV07IHRoaXMuZmlsbC5tYXRlcmlhbCA9IHRoaXMuQS5iYXJGaWxsW3RlYW1dO1xuICAgIGlmICh0ZWFtID09PSAwKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByYWlzZWQgYnkgdGhlIE5lY3JvbWFuY2VyOiBwdXJwbGUgYXVyYSB0aGF0IGdyb3dzIHdpdGggc3RhcnNcbiAgICAgIGlmICghdGhpcy5wcykge1xuICAgICAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdhdXJhJywgNzAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IHRoaXMucGFyZW50OyBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yLCAwLCAtMC4yKTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCB0aGlzLnRvcCAqIDAuNSwgMC4yKTtcbiAgICAgICAgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMS4xOyBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xNSwgMC44LCAtMC4xNSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMTUsIDEuNSwgMC4xNSk7XG4gICAgICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuMzU7IHBzLm1heEVtaXRQb3dlciA9IDAuODsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyB0aGlzLnBzID0gcHM7XG4gICAgICB9XG4gICAgICBjb25zdCBwID0gdGhpcy5wczsgcC5lbWl0UmF0ZSA9IGNmZy5yYXRlOyBwLm1pblNpemUgPSBjZmcubWluOyBwLm1heFNpemUgPSBjZmcubWF4OyBwLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi5jZmcuYzEpOyBwLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi5jZmcuYzIpOyBwLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgICBpZiAoIXAuaXNTdGFydGVkKCkpIHAuc3RhcnQoKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMucHMgJiYgdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdG9wKCk7XG4gICAgaWYgKHN0YXIgPj0gMykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGdvbGQgaGFsbyBhYm92ZSB0aGUgaGVhZFxuICAgICAgaWYgKCF0aGlzLmhhbG8pIHsgdGhpcy5oYWxvID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnaGFsbycsIHsgZGlhbWV0ZXI6IDAuNTUsIHRoaWNrbmVzczogMC4wNCwgdGVzc2VsbGF0aW9uOiAyNCB9LCBzKTsgdGhpcy5oYWxvLnBhcmVudCA9IHRoaXMucGFyZW50OyB0aGlzLmhhbG8ucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4wODsgdGhpcy5oYWxvLm1hdGVyaWFsID0gdGhpcy5BLmhhbG9NYXQ7IHRoaXMuaGFsby5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAgIHRoaXMuaGFsby5zZXRFbmFibGVkKHRydWUpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5oYWxvKSB0aGlzLmhhbG8uc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5iYXIuc2V0RW5hYmxlZChvbik7IHRoaXMuZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMuZmlsbC5zY2FsaW5nLnggPSBrOyB0aGlzLmZpbGwucG9zaXRpb24ueCA9IC0oMC41NiAqICgxIC0gaykpIC8gMjsgfVxuICB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5tYmcuc2V0RW5hYmxlZChvbik7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChvbik7XG4gICAgaWYgKG9uKSB7IGNvbnN0IGsgPSBNYXRoLm1heCgwLjAwMSwgZiBhcyBudW1iZXIpOyB0aGlzLm1maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMubWZpbGwucG9zaXRpb24ueCA9IC0oMC41NiAqICgxIC0gaykpIC8gMjsgfVxuICB9XG4gIHNldEF1cmEob246IGJvb2xlYW4pIHsgaWYgKHRoaXMucHMpIHsgaWYgKG9uICYmICF0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0YXJ0KCk7IGlmICghb24gJiYgdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdG9wKCk7IH0gfVxuICB1cGRhdGUoZHQ6IG51bWJlcikgeyBpZiAodGhpcy5oYWxvICYmIHRoaXMuaGFsby5pc0VuYWJsZWQoKSkgdGhpcy5oYWxvLnJvdGF0aW9uLnkgKz0gZHQgKiAxLjY7IH1cbiAgZGlzcG9zZSgpIHsgaWYgKHRoaXMucHMpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB9IFt0aGlzLmhhbG8sIHRoaXMucmluZywgdGhpcy5zdGFycywgdGhpcy5iYXIsIHRoaXMuZmlsbCwgdGhpcy5tYmcsIHRoaXMubWZpbGxdLmZvckVhY2goKG0pID0+IG0gJiYgbS5kaXNwb3NlKCkpOyB0aGlzLmJhZGdlLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHJlYWwgbW9kZWxzXG5jbGFzcyBUcmlwb1Zpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSBlbnQ6IGFueTsgcHJpdmF0ZSBib2R5OiBhbnk7IHByaXZhdGUgYW5pbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTsgcHJpdmF0ZSBjdXI6IGFueSA9IG51bGw7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBiYXNlOiBudW1iZXI7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIGNmZzogVHJpcG9DZmcsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCB1aWQgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA3KTtcbiAgICB0aGlzLmVudCA9IGNmZy5jb250YWluZXIuaW5zdGFudGlhdGVNb2RlbHNUb1NjZW5lKChuOiBzdHJpbmcpID0+IG4gKyAnXycgKyB1aWQsIGZhbHNlLCB7IGRvTm90SW5zdGFudGlhdGU6IHRydWUgfSk7XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd1bml0XycgKyB1aWQsIHMpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgdGhpcy5ib2R5ID0gdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZmluZCgobTogYW55KSA9PiBtLm5hbWUuaW5jbHVkZXMoJ19Cb2R5JykpO1xuICAgIGlmICghY2ZnLmJhc2VNYXQpIGNmZy5iYXNlTWF0ID0gdGhpcy5ib2R5Lm1hdGVyaWFsO1xuICAgIHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IHsgZy5zdG9wKCk7IGcuZW5hYmxlQmxlbmRpbmcgPSB0cnVlOyBnLmJsZW5kaW5nU3BlZWQgPSAwLjEyOyB0aGlzLmFuaW1zW2cubmFtZS5zcGxpdCgnXycpWzBdXSA9IGc7IH0pO1xuICAgIHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB9KTtcbiAgICB0aGlzLnRvcCA9IGNmZy50b3A7IHRoaXMuYmFzZSA9IGNmZy5zY2FsZTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIDAuMyk7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiAxLjMsIGRpYW1ldGVyOiAwLjggfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSAwLjY7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5pc1BpY2thYmxlID0gdHJ1ZTtcbiAgICB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICB9XG4gIHByaXZhdGUgYXBwbHlNYXQoKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy50ZWFtICsgJ18nICsgdGhpcy5zdGFyLCBjID0gdGhpcy5jZmc7XG4gICAgaWYgKCFjLm1hdENhY2hlW2tleV0pIHsgY29uc3QgbSA9IGMuYmFzZU1hdC5jbG9uZSgnbV8nICsga2V5KTsgaWYgKHRoaXMudGVhbSA9PT0gMSkgbS5hbGJlZG9UZXh0dXJlID0gYy5lbmVteVRleDsgY29uc3QgdCA9IFRJTlRbdGhpcy5zdGFyIC0gMV07IG0uYWxiZWRvQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjModFswXSwgdFsxXSwgdFsyXSk7IGMubWF0Q2FjaGVba2V5XSA9IG07IH1cbiAgICB0aGlzLmJvZHkubWF0ZXJpYWwgPSBjLm1hdENhY2hlW2tleV07XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwoQkFMQU5DRS5zdGFyLnNjYWxlW3N0IC0gMV0gKiB0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0KHRoaXMudGVhbSwgc3QpOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0TWFuYShmKTsgfVxuICBwdWxzZSgpIHsgdGhpcy5wdWxzZVQgPSAwLjE2OyB9XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQgPSAxKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbdGhpcy5jZmcuY2xpcHNbc3RhdGVdXTsgaWYgKCFnKSByZXR1cm47IGNvbnN0IGxvb3AgPSBzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJztcbiAgICBpZiAobG9vcCAmJiB0aGlzLnN0YXRlID09PSBzdGF0ZSAmJiB0aGlzLmN1ciA9PT0gZykgcmV0dXJuO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChsb29wLCBzcGVlZCwgZy5mcm9tLCBnLnRvKTtcbiAgICBpZiAobG9vcCkgZy5nb1RvRnJhbWUoZy5mcm9tICsgTWF0aC5yYW5kb20oKSAqIChnLnRvIC0gZy5mcm9tKSk7XG4gICAgdGhpcy5jdXIgPSBnOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTtcbiAgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMuZGVjby51cGRhdGUoZHQpO1xuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwoQkFMQU5DRS5zdGFyLnNjYWxlW3RoaXMuc3RhciAtIDFdICogdGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5waWNrLmRpc3Bvc2UoKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmRpc3Bvc2UoZmFsc2UsIGZhbHNlKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhbmQtaW5zXG5jb25zdCBQSDogUmVjb3JkPHN0cmluZywgeyBjb2w6IHN0cmluZzsgdzogbnVtYmVyOyBoOiBudW1iZXI7IGhlYWQ6IG51bWJlcjsgd2VhcG9uOiBzdHJpbmc7IGxhYmVsOiBzdHJpbmcgfT4gPSB7XG4gIGdvYmxpbjogeyBjb2w6ICcjNjNiMTNmJywgdzogMC4zNiwgaDogMC40MiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnZGFnZ2VyJywgbGFiZWw6ICdHT0JMSU4nIH0sXG4gIGtuaWdodDogeyBjb2w6ICcjOGVhOWRjJywgdzogMC41LCBoOiAwLjYsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ3NoaWVsZCcsIGxhYmVsOiAnS05JR0hUJyB9LFxuICBvZ3JlOiB7IGNvbDogJyNhOGE2NGEnLCB3OiAwLjg1LCBoOiAwLjg1LCBoZWFkOiAwLjQyLCB3ZWFwb246ICdtYWNlJywgbGFiZWw6ICdPR1JFJyB9LFxuICBiYXJiYXJpYW46IHsgY29sOiAnI2Q2OGE1NScsIHc6IDAuNTIsIGg6IDAuNjIsIGhlYWQ6IDAuMzgsIHdlYXBvbjogJ2F4ZScsIGxhYmVsOiAnQkFSQkFSSUFOJyB9LFxufTtcbmNsYXNzIFBsYWNlaG9sZGVyVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIHJpZzogYW55OyBwcml2YXRlIGxlZ3M6IGFueVtdID0gW107IHByaXZhdGUgd3A6IGFueTsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSB0ID0gTWF0aC5yYW5kb20oKSAqIDY7IHByaXZhdGUgc3QwID0gMDsgcHJpdmF0ZSBkdXIgPSAxOyBwcml2YXRlIGJhc2UgPSAxOyBwcml2YXRlIHB1bHNlVCA9IDA7IHByaXZhdGUgbWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBib2R5OiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHNvdWw6IHN0cmluZywgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCBkID0gUEhbc291bF07IHRoaXMudGVhbSA9IHRlYW07XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdwaF8nICsgc291bCwgcyk7IHRoaXMucmlnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncmlnJywgcyk7IHRoaXMucmlnLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIGNvbnN0IG1hdCA9IChoZXg6IHN0cmluZywgZW0gPSAwKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdwbScsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoaGV4KS5zY2FsZSgwLjcyKTsgbS5zcGVjdWxhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMSwgMC4xLCAwLjEpOyBpZiAoZW0pIG0uZW1pc3NpdmVDb2xvciA9IG0uZGlmZnVzZUNvbG9yLnNjYWxlKGVtKTsgcmV0dXJuIG07IH07XG4gICAgY29uc3QgbGVnSCA9IDAuMjIsIGJvZHlZID0gbGVnSCArIGQuaCAvIDI7XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGxnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbGVnJywgcyk7IGxnLnBhcmVudCA9IHRoaXMucmlnOyBsZy5wb3NpdGlvbi5zZXQoc3ggKiBkLncgKiAwLjIyLCBsZWdILCAwKTsgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2wnLCB7IGhlaWdodDogbGVnSCwgZGlhbWV0ZXI6IGQudyAqIDAuMjggfSwgcyk7IG0ucGFyZW50ID0gbGc7IG0ucG9zaXRpb24ueSA9IC1sZWdIIC8gMjsgbS5tYXRlcmlhbCA9IG1hdCgnIzRhMzgyNicpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5sZWdzLnB1c2gobGcpOyB9XG4gICAgdGhpcy5ib2R5ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDYXBzdWxlKCdib2R5JywgeyByYWRpdXM6IGQudyAvIDIsIGhlaWdodDogZC5oICsgZC53ICogMC40IH0sIHMpOyB0aGlzLmJvZHkucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMuYm9keS5wb3NpdGlvbi55ID0gYm9keVk7IHRoaXMuYm9keS5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IHRoaXMuYm9keS5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgaGVhZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdoZWFkJywgeyBkaWFtZXRlcjogZC5oZWFkICogMS41LCBzZWdtZW50czogMTIgfSwgcyk7IGhlYWQucGFyZW50ID0gdGhpcy5yaWc7IGhlYWQucG9zaXRpb24ueSA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAwLjU1OyBoZWFkLm1hdGVyaWFsID0gbWF0KGQuY29sKTsgaGVhZC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgZXllTSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2V5ZScsIHMpOyBleWVNLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IGV5ZU0uZW1pc3NpdmVDb2xvciA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7ICh0aGlzIGFzIGFueSkuZXllTSA9IGV5ZU07XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZScsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDAuMyB9LCBzKTsgZS5wYXJlbnQgPSB0aGlzLnJpZzsgZS5wb3NpdGlvbi5zZXQoc3ggKiBkLmhlYWQgKiAwLjMsIGhlYWQucG9zaXRpb24ueSArIDAuMDIsIGQuaGVhZCAqIDAuNjYpOyBlLm1hdGVyaWFsID0gZXllTTsgZS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAvLyB3ZWFwb24gcGl2b3QgYXQgdGhlIHNob3VsZGVyLCBvbiB0aGUgY2hhcmFjdGVyJ3MgcmlnaHQgKC14IGlzIGZpbmUgZm9yIGEgc3RhbmQtaW4pXG4gICAgdGhpcy53cCA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3dwJywgcyk7IHRoaXMud3AucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMud3AucG9zaXRpb24uc2V0KGQudyAqIDAuNiwgbGVnSCArIGQuaCAqIDAuODUsIDAuMDUpO1xuICAgIGNvbnN0IHdtID0gbWF0KCcjN2E1YTMwJyksIGlyb24gPSBtYXQoJyM5YWExYWQnKTtcbiAgICBjb25zdCBtayA9IChtOiBhbnksIGtpbmQ6IHN0cmluZywgZGltczogYW55LCBwb3M6IG51bWJlcltdLCBtdDogYW55KSA9PiB7IGNvbnN0IHggPSBraW5kID09PSAnYm94JyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQm94KCd3JywgZGltcywgcykgOiBraW5kID09PSAnY3lsJyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3cnLCBkaW1zLCBzKSA6IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCd3JywgZGltcywgcyk7IHgucGFyZW50ID0gdGhpcy53cDsgeC5wb3NpdGlvbi5zZXQocG9zWzBdLCBwb3NbMV0sIHBvc1syXSk7IHgubWF0ZXJpYWwgPSBtdDsgeC5pc1BpY2thYmxlID0gZmFsc2U7IHJldHVybiB4OyB9O1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ2RhZ2dlcicpIG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA1LCBoZWlnaHQ6IDAuMywgZGVwdGg6IDAuMDMgfSwgWzAsIC0wLjIsIDAuMTJdLCBpcm9uKTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdzaGllbGQnKSB7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA2LCBoZWlnaHQ6IDAuNSwgZGVwdGg6IDAuMDQgfSwgWzAsIC0wLjMsIDAuMTRdLCBpcm9uKTsgY29uc3Qgc2ggPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzaCcsIHsgaGVpZ2h0OiAwLjA1LCBkaWFtZXRlcjogMC41NSB9LCBzKTsgc2gucGFyZW50ID0gdGhpcy5yaWc7IHNoLnJvdGF0aW9uLnogPSBNYXRoLlBJIC8gMjsgc2gucG9zaXRpb24uc2V0KC1kLncgKiAwLjcsIGxlZ0ggKyBkLmggKiAwLjYsIDAuMDUpOyBzaC5tYXRlcmlhbCA9IG1hdCgnI2Q4YjY0YScpOyBzaC5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdtYWNlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuOSwgZGlhbWV0ZXI6IDAuMDggfSwgWzAsIC0wLjM1LCAwLjNdLCB3bSk7IG1rKDAsICdzcGgnLCB7IGRpYW1ldGVyOiAwLjQgfSwgWzAsIC0wLjg1LCAwLjRdLCBpcm9uKTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ2F4ZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjYsIGRpYW1ldGVyOiAwLjA1IH0sIFswLCAtMC4yLCAwLjE1XSwgd20pOyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4zMiwgaGVpZ2h0OiAwLjIyLCBkZXB0aDogMC4wNSB9LCBbMCwgLTAuNSwgMC4xNV0sIGlyb24pOyBjb25zdCBoYWlyID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignaGFpcicsIHsgaGVpZ2h0OiAwLjMsIGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogZC5oZWFkICogMS4yIH0sIHMpOyBoYWlyLnBhcmVudCA9IHRoaXMucmlnOyBoYWlyLnBvc2l0aW9uLnkgPSBoZWFkLnBvc2l0aW9uLnkgKyBkLmhlYWQgKiAwLjc1OyBoYWlyLm1hdGVyaWFsID0gbWF0KCcjYzIyYTFjJyk7IGhhaXIuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgdGhpcy50b3AgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMS4zNTsgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCBkLncgKiAwLjcpO1xuICAgIGNvbnN0IGxibCA9IGR5bihzLCAyNTYsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCAyNnB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmZpbGxTdHlsZSA9ICcjZmZmZmZmJzsgYy5zdHJva2VTdHlsZSA9ICcjMTExJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyBjLmZpbGxUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgfSk7XG4gICAgY29uc3QgbHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdsYmwnLCB7IHdpZHRoOiAxLjEsIGhlaWdodDogMC4yIH0sIHMpOyBscC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgbHAucG9zaXRpb24ueSA9IC0wLjE7IGxwLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMiAqIDAuMDsgbHAuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDsgY29uc3QgbG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdsbScsIHMpOyBsbS5kaWZmdXNlVGV4dHVyZSA9IGxibDsgbG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IGxtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IGxtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbHAubWF0ZXJpYWwgPSBsbTsgbHAuaXNQaWNrYWJsZSA9IGZhbHNlOyBscC5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjYyO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogdGhpcy50b3AsIGRpYW1ldGVyOiBNYXRoLm1heCgwLjcsIGQudyAqIDEuMykgfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCAvIDI7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgICAodGhpcyBhcyBhbnkpLnBhcnRzID0gW2xwXTsgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGxheSgnaWRsZScpO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgKHRoaXMgYXMgYW55KS5leWVNLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmJhc2UgPSBCQUxBTkNFLnN0YXIuc2NhbGVbc3QgLSAxXTsgY29uc3QgdCA9IFRJTlRbc3QgLSAxXTsgdGhpcy5ib2R5Lm1hdGVyaWFsLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoUEhbdGhpcy5zb3VsXS5jb2wpLnNjYWxlKDAuNzIpLm11bHRpcGx5KG5ldyBCQUJZTE9OLkNvbG9yMyhNYXRoLm1pbigxLCB0WzBdKSwgTWF0aC5taW4oMSwgdFsxXSksIE1hdGgubWluKDEsIHRbMl0pKSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHsgaWYgKHN0YXRlID09PSB0aGlzLnN0YXRlICYmIChzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJykpIHJldHVybjsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLnN0MCA9IHRoaXMudDsgdGhpcy5kdXIgPSBzdGF0ZSA9PT0gJ2F0dGFjaycgPyAoQkFMQU5DRS5zdGF0c1t0aGlzLnNvdWwgYXMgU291bElkXS5hbmltTGVuIC8gc3BlZWQpIDogc3RhdGUgPT09ICdkZWF0aCcgPyAwLjYgOiBzdGF0ZSA9PT0gJ3NwYXduJyA/IDAuOSA6IDEuMDsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpOyB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0OyB0aGlzLmRlY28udXBkYXRlKGR0KTsgY29uc3QgcCA9IE1hdGgubWluKDEsICh0aGlzLnQgLSB0aGlzLnN0MCkgLyB0aGlzLmR1ciksIFIgPSB0aGlzLnJpZywgVyA9IHRoaXMud3A7XG4gICAgUi5wb3NpdGlvbi5zZXQoMCwgMCwgMCk7IFIucm90YXRpb24uc2V0KDAsIDAsIDApOyBSLnNjYWxpbmcuc2V0QWxsKDEpOyBXLnJvdGF0aW9uLnggPSAtMC40OyB0aGlzLmxlZ3MuZm9yRWFjaCgobCkgPT4gKGwucm90YXRpb24ueCA9IDApKTtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ2lkbGUnKSBSLnBvc2l0aW9uLnkgPSBNYXRoLnNpbih0aGlzLnQgKiAyLjIpICogMC4wMTI7XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHsgY29uc3QgdyA9IHRoaXMudCAqIDEwOyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih3KSkgKiAwLjA3OyBSLnJvdGF0aW9uLnggPSAwLjI7IHRoaXMubGVnc1swXS5yb3RhdGlvbi54ID0gTWF0aC5zaW4odykgKiAwLjk7IHRoaXMubGVnc1sxXS5yb3RhdGlvbi54ID0gLU1hdGguc2luKHcpICogMC45OyBXLnJvdGF0aW9uLnggPSAtMC40ICsgTWF0aC5zaW4odykgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnYXR0YWNrJykgeyBjb25zdCBrID0gcCA8IDAuNCA/IC0yLjQgKiAocCAvIDAuNCkgOiAtMi40ICsgMy40ICogTWF0aC5taW4oMSwgKHAgLSAwLjQpIC8gMC4yNSk7IFcucm90YXRpb24ueCA9IGs7IFIucG9zaXRpb24ueiA9IDAuMTQgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IFIucm90YXRpb24ueCA9IDAuMTUgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB7IGNvbnN0IGUgPSBwICogcCAqICgzIC0gMiAqIHApOyBSLnNjYWxpbmcuc2V0QWxsKDAuMDEgKyAwLjk5ICogZSk7IFIucG9zaXRpb24ueSA9IChlIC0gMSkgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB7IGNvbnN0IGUgPSBwICogcDsgUi5yb3RhdGlvbi54ID0gLU1hdGguUEkgLyAyICogZTsgUi5wb3NpdGlvbi55ID0gMC4yNSAqIGU7IFIucG9zaXRpb24ueiA9IC0wLjIgKiBlOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgeyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih0aGlzLnQgKiA3KSkgKiAwLjE1OyBXLnJvdGF0aW9uLnggPSAtMi42OyB9XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmlzdWFsKEE6IEFzc2V0cywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKTogVW5pdFZpc3VhbCB7XG4gIGNvbnN0IGNmZyA9IEEudHJpcG9bc291bF07XG4gIHJldHVybiBjZmcgPyBuZXcgVHJpcG9WaXN1YWwoQSwgY2ZnLCBzb3VsLCB0ZWFtLCBzdGFyKSA6IG5ldyBQbGFjZWhvbGRlclZpc3VhbChBLCBzb3VsLCB0ZWFtLCBzdGFyKTtcbn1cbmV4cG9ydCBjb25zdCBpc1RyaXBvID0gKEE6IEFzc2V0cywgc291bDogU291bElkKSA9PiAhIUEudHJpcG9bc291bF07XG4iLCAiLy8gVGhlIGdhbWUncyBpY29uIHNldCAoY3VzdG9tIGFydCwgc2xpY2VkIGZyb20gUGlwZWxpbmUvaWNvbnMvc2hlZXRfKi5wbmcgYnkgUGlwZWxpbmUvYmxlbmRlci9zbGljZV9pY29ucy5weSAtPiBkb2NzL2Fzc2V0cy9pY29ucy8qLnBuZykuXG4vLyBTaGFyZWQgYnkgdGhlIDNEIGdhbWUncyBET00gKHZhbmlsbGEpIGFuZCB0aGUgQW5ndWxhciBzaGVsbC4gTm8gZW1vamkgYW55d2hlcmU6IGV2ZXJ5IGdseXBoIGluIHRoZSBVSSBpcyBvbmUgb2YgdGhlc2UgaW1hZ2VzLlxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSYXJpdHkgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcblxuZXhwb3J0IHR5cGUgSWNvbk5hbWUgPVxuICB8ICdob21lJyB8ICdzb3VscycgfCAnc2hvcCcgfCAnc2V0dGluZ3MnIHwgJ2Nsb3NlJ1xuICB8ICdoZWFydCcgfCAnaGVhcnRfZW1wdHknIHwgJ2RvbWluaW9uJyB8ICdzdGFyJyB8ICdsb2NrJ1xuICB8ICd3YXJyaW9yJyB8ICdhcmNoZXInIHwgJ2dvYmxpbicgfCAna25pZ2h0JyB8ICdvZ3JlJyB8ICdiYXJiYXJpYW4nXG4gIHwgJ2dlbV9jb21tb24nIHwgJ2dlbV9yYXJlJyB8ICdnZW1fZXBpYycgfCAnZ2VtX2xlZ2VuZGFyeSdcbiAgfCAnbXVzaWMnIHwgJ3NvdW5kX29uJyB8ICdzb3VuZF9vZmYnIHwgJ3VwZ3JhZGUnIHwgJ3N3YXAnXG4gIHwgJ21lcmdlJyB8ICdyZW1vdmUnIHwgJ2NoZWNrJyB8ICdiYWNrJyB8ICdpbmZvJztcblxuLyoqIFJlbGF0aXZlIHRvIHRoZSBwYWdlLCBzbyBpdCB3b3JrcyBvbiBHaXRIdWIgUGFnZXMgdW5kZXIgL3JlcG8tbmFtZS8uICovXG5leHBvcnQgY29uc3QgaWNvblVybCA9IChuOiBJY29uTmFtZSk6IHN0cmluZyA9PiAnYXNzZXRzL2ljb25zLycgKyBuICsgJy5wbmcnO1xuLyoqIEFuIDxpbWc+IGFzIGFuIEhUTUwgc3RyaW5nLCBmb3IgdGhlIGdhbWUncyBoYW5kLWJ1aWx0IERPTS4gKi9cbmV4cG9ydCBjb25zdCBpY29uSW1nID0gKG46IEljb25OYW1lLCBjbHMgPSAnaWMnKTogc3RyaW5nID0+IGA8aW1nIGNsYXNzPVwiJHtjbHN9XCIgc3JjPVwiJHtpY29uVXJsKG4pfVwiIGFsdD1cIlwiIGRyYWdnYWJsZT1cImZhbHNlXCI+YDtcblxuLyoqIEVhY2ggU291bCBpcyBzaG93biBieSBpdHMgd2VhcG9uL3JvbGUgaWNvbiB1bnRpbCByZWFsIHBvcnRyYWl0cyBleGlzdC4gKi9cbmV4cG9ydCBjb25zdCBTT1VMX0lDT046IFJlY29yZDxTb3VsSWQsIEljb25OYW1lPiA9IHsgd2FycmlvcjogJ3dhcnJpb3InLCBhcmNoZXI6ICdhcmNoZXInLCBnb2JsaW46ICdnb2JsaW4nLCBrbmlnaHQ6ICdrbmlnaHQnLCBvZ3JlOiAnb2dyZScsIGJhcmJhcmlhbjogJ2JhcmJhcmlhbicgfTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfR0VNOiBSZWNvcmQ8UmFyaXR5LCBJY29uTmFtZT4gPSB7IGNvbW1vbjogJ2dlbV9jb21tb24nLCByYXJlOiAnZ2VtX3JhcmUnLCBlcGljOiAnZ2VtX2VwaWMnLCBsZWdlbmRhcnk6ICdnZW1fbGVnZW5kYXJ5JyB9O1xuXG4vKiogUGFjayB0aWVycyBhcmUgc2hvd24gYXMgc2t1bGxzIChuZXZlciBzdGFyczogc3RhcnMgbWVhbiBhbiBpbi1ydW4gbWVyZ2UgbGV2ZWwpLiAqL1xuZXhwb3J0IGNvbnN0IHNrdWxsSW1ncyA9IChuOiBudW1iZXIsIGNscyA9ICdzaycpOiBzdHJpbmcgPT4gaWNvbkltZygnc291bHMnLCBjbHMpLnJlcGVhdChNYXRoLm1heCgxLCBuKSk7XG5leHBvcnQgY29uc3QgaGVhcnRzSHRtbCA9IChoZWFydHM6IG51bWJlciwgbWF4ID0gMyk6IHN0cmluZyA9PiBpY29uSW1nKCdoZWFydCcsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBoZWFydHMpKSArIGljb25JbWcoJ2hlYXJ0X2VtcHR5JywgJ2ljIGhlYXJ0JykucmVwZWF0KE1hdGgubWF4KDAsIG1heCAtIGhlYXJ0cykpO1xuIiwgIi8vIERPTSB1c2VyIGludGVyZmFjZTogdG9wIGJhciwgZW5lbXkgcHJldmlldywgaGFuZCBvZiBjYXJkcywgYnV0dG9ucywgZHJhZnQgb3ZlcmxheSwgdG9hc3RzIGFuZCB0aGUgZGVidWcgcGFuZWwuXG5pbXBvcnQgeyBCQUxBTkNFLCBST0xFX1RFWFQsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgeyBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNvc3QsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBzdGFnZVdhdmVzIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBlbmVteVdhdmUsIHByZXZpZXdUZXh0IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgU09VTF9JQ09OLCBoZWFydHNIdG1sLCBpY29uSW1nLCBpY29uVXJsLCBza3VsbEltZ3MgfSBmcm9tICcuLi91aS9pY29ucy50cyc7XG5pbXBvcnQgeyBkZXNjcmliZVVubG9jayB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuXG5jb25zdCBJQ09OID0gT2JqZWN0LmZyb21FbnRyaWVzKFNPVUxTLm1hcCgocykgPT4gW3MsIGljb25JbWcoU09VTF9JQ09OW3NdLCAnaWMnKV0pKSBhcyBSZWNvcmQ8U291bElkLCBzdHJpbmc+O1xuY29uc3QgJCA9IChpZDogc3RyaW5nKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkhO1xuY29uc3Qgc3RhcnMgPSAobjogbnVtYmVyKSA9PiAnXHUyNjA1Jy5yZXBlYXQobik7XG5cbmV4cG9ydCBjbGFzcyBVaSB7XG4gIHByaXZhdGUgdG9hc3RUID0gMDsgcHJpdmF0ZSBkYmc6IEhUTUxFbGVtZW50OyBwcml2YXRlIG9kZHMgPSAnJztcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBnOiBhbnkpIHtcbiAgICAkKCdidG5Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAkKCdidG5CYXR0bGUnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydEJhdHRsZSgpOyAkKCdidG5Td2FwJykub25jbGljayA9ICgpID0+IGcudG9nZ2xlU3dhcCgpO1xuICAgICQoJ2J0bk1lcmdlJykub25jbGljayA9ICgpID0+IGcubWVyZ2VTZWxlY3RlZCgpOyAkKCdidG5SZW1vdmUnKS5vbmNsaWNrID0gKCkgPT4gZy5yZW1vdmVTZWxlY3RlZCgpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zcGVlZF0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRTcGVlZCgrYi5kYXRhc2V0LnNwZWVkISkpKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiBnLnNldENhbU1vZGUoYi5kYXRhc2V0LmNhbSEpKSk7XG4gICAgJCgnZ2VhcicpLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuZGJnLmNsYXNzTGlzdC50b2dnbGUoJ29wZW4nKTsgdGhpcy5yZW5kZXJEZWJ1ZygpOyB9O1xuICAgIGNvbnN0IHNuZCA9ICgpID0+IHsgJCgnYnRuTXVzaWMnKS5jbGFzc0xpc3QudG9nZ2xlKCdvZmYnLCAhYXVkaW8ubXVzaWMpOyAkKCdidG5TZngnKS5jbGFzc0xpc3QudG9nZ2xlKCdvZmYnLCAhYXVkaW8uc2Z4KTsgY29uc3Qgc2kgPSAkKCdidG5TZngnKS5xdWVyeVNlbGVjdG9yKCdpbWcnKTsgaWYgKHNpKSBzaS5zcmMgPSBpY29uVXJsKGF1ZGlvLnNmeCA/ICdzb3VuZF9vbicgOiAnc291bmRfb2ZmJyk7IH07XG4gICAgJCgnYnRuTXVzaWMnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRNdXNpYyghYXVkaW8ubXVzaWMpOyBzbmQoKTsgfTsgJCgnYnRuU2Z4Jykub25jbGljayA9ICgpID0+IHsgYXVkaW8uc2V0U2Z4KCFhdWRpby5zZngpOyBzbmQoKTsgfTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MnLCBzbmQpOyBzbmQoKTtcbiAgICB0aGlzLmRiZyA9ICQoJ2RlYnVnJyk7IGlmIChuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdkZWJ1ZycpKSB0aGlzLmRiZy5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gICAgdGhpcy5yZW5kZXJEZWJ1ZygpO1xuICB9XG5cbiAgLyoqIFRoZSBOZWNyb21hbmNlciBqdXN0IGxvc3QgYSBoZWFydDogbWFrZSB0aGUgaGVhcnRzIGJ1bXAuICovXG4gIHB1bHNlSGVhcnRzKCkgeyBjb25zdCBoID0gJCgnaGVhcnRzJyk7IGguY2xhc3NMaXN0LnJlbW92ZSgnaHVydCcpOyB2b2lkIGgub2Zmc2V0V2lkdGg7IGguY2xhc3NMaXN0LmFkZCgnaHVydCcpOyB9XG4gIHRvYXN0KG1zZzogc3RyaW5nKSB7IGNvbnN0IHQgPSAkKCd0b2FzdCcpOyB0LnRleHRDb250ZW50ID0gbXNnOyB0LmNsYXNzTGlzdC5hZGQoJ3Nob3cnKTsgY2xlYXJUaW1lb3V0KHRoaXMudG9hc3RUKTsgdGhpcy50b2FzdFQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0LmNsYXNzTGlzdC5yZW1vdmUoJ3Nob3cnKSwgMzYwMCk7IH1cblxuICByZW5kZXIoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgcyA9IGcucywgcGggPSBnLnBoYXNlLCBidWlsZCA9IHBoID09PSAnYnVpbGQnO1xuICAgICQoJ2hlYXJ0cycpLmlubmVySFRNTCA9IGhlYXJ0c0h0bWwocy5oZWFydHMpO1xuICAgICQoJ3dhdmUnKS50ZXh0Q29udGVudCA9IGBXYXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9YDtcbiAgICBjb25zdCB1c2VkID0gZG9taW5pb25Vc2VkKHMpOyAkKCdkb20nKS50ZXh0Q29udGVudCA9IGAke3VzZWR9LyR7cy5jYXB9YDsgKCQoJ2RvbWZpbGwnKSBhcyBIVE1MRWxlbWVudCkuc3R5bGUud2lkdGggPSBNYXRoLm1pbigxMDAsICh1c2VkIC8gcy5jYXApICogMTAwKSArICclJztcbiAgICAvLyBlbmVteSBwcmV2aWV3OiB3aGF0IGlzIGNvbWluZywgbmV2ZXIgd2hlcmVcbiAgICBjb25zdCBwdiA9IHByZXZpZXdUZXh0KGVuZW15V2F2ZShzLndhdmUsIGcuc2VlZCkpO1xuICAgICQoJ2VuZW15JykuaW5uZXJIVE1MID0gYDxiPk5leHQgZW5lbWllczwvYj5gICsgcHYubWFwKChwKSA9PiBgPGRpdiBjbGFzcz1cImVyb3dcIj48c3Bhbj4ke0lDT05bcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuPiR7U09VTF9OQU1FW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3BhbiBjbGFzcz1cInhcIj5cdTAwRDcke3AuY291bnR9PC9zcGFuPjxzcGFuIGNsYXNzPVwic3RcIj4ke3N0YXJzKHAuc3Rhcil9PC9zcGFuPjwvZGl2PmApLmpvaW4oJycpICsgYDxkaXYgY2xhc3M9XCJoaW50XCI+UG9zaXRpb25zIHN0YXkgaGlkZGVuIHVudGlsIHRoZSBiYXR0bGUuPC9kaXY+YDtcbiAgICAvLyBoYW5kXG4gICAgY29uc3QgaGFuZCA9ICQoJ2hhbmQnKTsgaGFuZC5pbm5lckhUTUwgPSAnJztcbiAgICBzLmhhbmQuZm9yRWFjaCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IHtcbiAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGNvbnN0IHNlbCA9IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiBnLnNlbC5pZHggPT09IGk7IGNvbnN0IGFmZm9yZCA9IGNhblN1bW1vbihzLCBpKSwgY2FuTWVyZ2UgPSBzLnVuaXRzLnNvbWUoKHU6IGFueSkgPT4gY2FuTWVyZ2VGcm9tSGFuZChzLCBpLCB1LmlkKSksIHVzYWJsZSA9IGFmZm9yZCB8fCBjYW5NZXJnZTtcbiAgICAgIGVsLmNsYXNzTmFtZSA9ICdjYXJkJyArIChzZWwgPyAnIHNlbCcgOiAnJykgKyAoIXVzYWJsZSAmJiAhZy5zd2FwTW9kZSA/ICcgZGlzJyA6ICcnKSArIChnLnN3YXBNb2RlID8gJyBzd2FwJyA6ICcnKTtcbiAgICAgIGNvbnN0IHRhZyA9IGFmZm9yZCA/IGA8c3BhbiBjbGFzcz1cIm9rXCI+U3VtbW9uPC9zcGFuPmAgOiBjYW5NZXJnZSA/ICc8c3BhbiBjbGFzcz1cIm9rIG1nXCI+TWVyZ2Ugb25seTwvc3Bhbj4nIDogJzxzcGFuIGNsYXNzPVwibm9cIj5ObyByb29tPC9zcGFuPic7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHtJQ09OW3NvdWxdfTxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJjc1wiPiR7dGFnfTwvZGl2PmA7IGVsLnRpdGxlID0gUk9MRV9URVhUW3NvdWxdICsgKGFmZm9yZCA/ICcnIDogY2FuTWVyZ2UgPyAnIC0gRG9taW5pb24gaXMgZnVsbCwgYnV0IHlvdSBjYW4gbWVyZ2UgaXQgaW50byB5b3VyIG1hdGNoaW5nIDEtc3RhciB1bml0LicgOiAnIC0gTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLicpO1xuICAgICAgZWwub25jbGljayA9ICgpID0+IGcub25DYXJkKGkpOyBoYW5kLmFwcGVuZENoaWxkKGVsKTtcbiAgICB9KTtcbiAgICBpZiAoIXMuaGFuZC5sZW5ndGgpIGhhbmQuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9XCJlbXB0eVwiPk5vIGNhcmRzIGluIGhhbmQ8L2Rpdj4nO1xuICAgIC8vIGJ1dHRvbnNcbiAgICAoJCgnYnRuQmF0dGxlJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQpLmRpc2FibGVkID0gIWJ1aWxkIHx8ICFzLnVuaXRzLmxlbmd0aDtcbiAgICBjb25zdCBzdyA9ICQoJ2J0blN3YXAnKSBhcyBIVE1MQnV0dG9uRWxlbWVudDsgc3cuZGlzYWJsZWQgPSAhYnVpbGQgfHwgcy5kaXNjYXJkVXNlZDsgc3cuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBnLnN3YXBNb2RlKTsgc3cudGV4dENvbnRlbnQgPSBzLmRpc2NhcmRVc2VkID8gJ1N3YXAgdXNlZCcgOiBnLnN3YXBNb2RlID8gJ1N3YXA6IHBpY2sgYSBjYXJkIG9yIHVuaXQnIDogJ1N3YXAgKDEvcm91bmQpJztcbiAgICBjb25zdCBzZWxVID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ3VuaXQnID8gcy51bml0cy5maW5kKCh1OiBhbnkpID0+IHUuaWQgPT09IGcuc2VsLmlkKSA6IG51bGw7XG4gICAgY29uc3QgcGFydG5lciA9IHNlbFUgJiYgcy51bml0cy5zb21lKChvOiBhbnkpID0+IGNhbk1lcmdlRGVwbG95ZWQoc2VsVSwgbykpO1xuICAgICQoJ3VuaXRwYW5lbCcpLnN0eWxlLmRpc3BsYXkgPSBidWlsZCAmJiBzZWxVID8gJ2ZsZXgnIDogJ25vbmUnOyAoJCgnYnRuTWVyZ2UnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhcGFydG5lcjtcbiAgICAkKCdidG5SZW1vdmUnKS50ZXh0Q29udGVudCA9IGcuY29uZmlybVJlbW92ZSA/ICdDb25maXJtIHJlbW92ZScgOiAnUmVtb3ZlJztcbiAgICAkKCdpbmZvJykudGV4dENvbnRlbnQgPSBidWlsZCA/IChnLnN3YXBNb2RlID8gJ1NXQVA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkIGl0LCBvciB0YXAgYSB1bml0IHlvdSBkaWQgbm90IHN1bW1vbiB0aGlzIHJvdW5kIHRvIHNlbGwgaXQuIFlvdSBkcmF3IGEgZGlmZmVyZW50IFNvdWwuJ1xuICAgICAgOiBzZWxVID8gYCR7U09VTF9OQU1FW3NlbFUuc291bCBhcyBTb3VsSWRdfSAke3N0YXJzKHNlbFUuc3Rhcil9ICBcdTIwMjIgICR7Uk9MRV9URVhUW3NlbFUuc291bCBhcyBTb3VsSWRdfSAgJHtwYXJ0bmVyID8gJ1x1MjAyMiBUYXAgYSBnbG93aW5nIHBhcnRuZXIgdG8gbWVyZ2UuJyA6ICcnfWBcbiAgICAgIDogZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnID8gYCR7U09VTF9OQU1FW3MuaGFuZFtnLnNlbC5pZHhdIGFzIFNvdWxJZF19OiAke1JPTEVfVEVYVFtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfSAgXHUyMDIyICBgICsgKCgpID0+IHsgY29uc3QgaSA9IGcuc2VsLmlkeCwgc20gPSBjYW5TdW1tb24ocywgaSksIG1nID0gcy51bml0cy5zb21lKCh1OiBhbnkpID0+IGNhbk1lcmdlRnJvbUhhbmQocywgaSwgdS5pZCkpOyByZXR1cm4gc20gJiYgbWcgPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24sIG9yIGEgZ2xvd2luZyBwdXJwbGUgdW5pdCB0byBtZXJnZSBpdCBpbi4nIDogc20gPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24uJyA6IG1nID8gJ0RvbWluaW9uIGlzIGZ1bGw6IHRhcCBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6ICdOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJzsgfSkoKSA6ICdUYXAgYSBjYXJkLCB0aGVuIGEgdGlsZS4gVGFwIGEgdW5pdCB0byBtZXJnZSwgbW92ZSBvciByZW1vdmUgaXQuJylcbiAgICAgIDogcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnQmF0dGxlISBVbml0cyBmaWdodCBvbiB0aGVpciBvd24uJyA6ICcnO1xuICAgICQoJ3NwZWVkJykuc3R5bGUuZGlzcGxheSA9IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2ZsZXgnIDogJ25vbmUnO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zcGVlZF0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgK2IuZGF0YXNldC5zcGVlZCEgPT09IGcudGltZVNjYWxlKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgYi5kYXRhc2V0LmNhbSA9PT0gZy5jYW1Nb2RlKSk7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QudG9nZ2xlKCdpbmJhdHRsZScsIHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nKTsgYXVkaW8uc2V0TW9kZShwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdiYXR0bGUnIDogJ2J1aWxkJyk7XG4gICAgLy8gb3ZlcmxheVxuICAgIGNvbnN0IG92ID0gJCgnb3ZlcmxheScpOyBvdi5jbGFzc05hbWUgPSAnJzsgb3YuaW5uZXJIVE1MID0gJyc7XG4gICAgaWYgKHBoID09PSAnZHJhZnQnICYmIGcuZHJhZnQpIHtcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+VmljdG9yeSBEcmFmdDwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPldhdmUgY2xlYXJlZC4gRG9taW5pb24gaXMgbm93ICR7cy5jYXB9LiBLZWVwIG9uZTo8L2Rpdj48ZGl2IGNsYXNzPVwicm93XCI+JHtnLmRyYWZ0Lm1hcCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IGA8ZGl2IGNsYXNzPVwiY2FyZCBiaWdcIiBkYXRhLWk9XCIke2l9XCI+PGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHtJQ09OW3NvdWxdfTxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJyb2xlXCI+JHtST0xFX1RFWFRbc291bF19PC9kaXY+PC9kaXY+YCkuam9pbignJyl9PC9kaXY+PC9kaXY+YDtcbiAgICAgIG92LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCcuY2FyZCcpLmZvckVhY2goKGMpID0+IChjLm9uY2xpY2sgPSAoKSA9PiBnLnBpY2tEcmFmdCgrYy5kYXRhc2V0LmkhKSkpO1xuICAgIH0gZWxzZSBpZiAocGggPT09ICd3b24nIHx8IHBoID09PSAnbG9zdCcpIHtcbiAgICAgIGNvbnN0IHJ3ID0gcGggPT09ICd3b24nID8gZy5yZXdhcmQgOiBudWxsLCBzayA9IChuOiBudW1iZXIpID0+IHNrdWxsSW1ncyhuKTtcbiAgICAgIGNvbnN0IHVubG9ja0h0bWwgPSBydyAmJiBydy51bmxvY2tlZCAmJiBydy51bmxvY2tlZC5sZW5ndGggPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6IzdlZjJjODtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ2NoZWNrJyl9IFVubG9ja2VkOiAke3J3LnVubG9ja2VkLm1hcCgoazogc3RyaW5nKSA9PiBkZXNjcmliZVVubG9jayhrKSkuam9pbignIFxcdTAwYjcgJyl9PC9kaXY+YCA6ICcnO1xuICAgICAgY29uc3QgcmV3YXJkSHRtbCA9IHVubG9ja0h0bWwgKyAocncgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke3J3LnBhY2sgPyAocncuZmlyc3QgPyBgJHtpY29uSW1nKCdzaG9wJyl9IEZpcnN0IGNsZWFyISBZb3UgZWFybmVkIGEgJHtzayhydy5wYWNrLnRpZXIpfSBTb3VsIFBhY2suYCA6IGAke2ljb25JbWcoJ3Nob3AnKX0gUmVwbGF5IHJld2FyZDogYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gKSA6IGBSZXBsYXkgcHJvZ3Jlc3MgJHtydy5yZXBsYXlNZXRlcn0vJHtydy5yZXBsYXlOZWVkZWR9IHRvd2FyZCBhIFNvdWwgUGFjay5gfTwvZGl2PmAgOiAnJyk7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPiR7cGggPT09ICd3b24nID8gJ1N0YWdlIGNsZWFyZWQhJyA6ICdTdGFnZSBsb3N0J308L2gyPjxkaXYgY2xhc3M9XCJzdWJcIj4ke2cubGFzdEJhdHRsZX08L2Rpdj4ke3Jld2FyZEh0bWx9PGRpdiBjbGFzcz1cInJvd1wiPiR7cncgJiYgcncucGFjayA/ICc8YnV0dG9uIGlkPVwidG9TaG9wXCIgY2xhc3M9XCJnb1wiPk9wZW4gcGFjazwvYnV0dG9uPicgOiAnJ308YnV0dG9uIGlkPVwiYWdhaW5cIiBjbGFzcz1cIiR7cncgJiYgcncucGFjayA/ICdibHVlJyA6ICdnbyd9XCI+JHtwaCA9PT0gJ3dvbicgPyAnUGxheSBhZ2FpbicgOiAnVHJ5IGFnYWluJ308L2J1dHRvbj48YnV0dG9uIGlkPVwidG9Ib21lXCIgY2xhc3M9XCJibHVlXCI+SG9tZTwvYnV0dG9uPjwvZGl2PjwvZGl2PmA7XG4gICAgICAkKCdhZ2FpbicpLm9uY2xpY2sgPSAoKSA9PiBnLm5ld1J1bigpOyAkKCd0b0hvbWUnKS5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1ob21lJykpO1xuICAgICAgY29uc3QgdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG9TaG9wJyk7IGlmICh0cykgdHMub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc2hvcCcpKTtcbiAgICB9XG4gICAgdGhpcy5yZW5kZXJEZWJ1Z0xpdmUoKTtcbiAgICBpZiAocGggPT09ICdidWlsZCcpIHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiBnLnJlZnJhbWVCdWlsZCgpKTsgICAgIC8vIGFmdGVyIGxheW91dDoga2VlcCB0aGUgZ3JpZCBjbGVhciBvZiB0aGUgaGFuZCBhbmQgYnV0dG9uc1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIHBhbmVsXG4gIHByaXZhdGUgcmVuZGVyRGVidWcoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgZCA9IHRoaXMuZGJnOyBpZiAoIWQuY2xhc3NMaXN0LmNvbnRhaW5zKCdvcGVuJykpIHsgZC5pbm5lckhUTUwgPSAnJzsgcmV0dXJuOyB9XG4gICAgY29uc3Qgcm93ID0gKGxhYmVsOiBzdHJpbmcsIG9iajogYW55LCBrZXk6IHN0cmluZyB8IG51bWJlciwgbWluOiBudW1iZXIsIG1heDogbnVtYmVyLCBzdGVwOiBudW1iZXIpID0+IGA8bGFiZWw+JHtsYWJlbH0gPGlucHV0IHR5cGU9XCJyYW5nZVwiIG1pbj1cIiR7bWlufVwiIG1heD1cIiR7bWF4fVwiIHN0ZXA9XCIke3N0ZXB9XCIgdmFsdWU9XCIke29ialtrZXldfVwiIGRhdGEtbz1cIiR7bGFiZWx9XCI+PHNwYW4+JHtvYmpba2V5XX08L3NwYW4+PC9sYWJlbD5gO1xuICAgIGQuaW5uZXJIVE1MID0gYDxiPkRlYnVnIChsaXZlKTwvYj4gPHNwYW4gaWQ9XCJkYmdmcHNcIj48L3NwYW4+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPlN0YXIgbXVsdGlwbGllcnMgKGJvZGllcyA9IGRhbWFnZSwgc3RhcnMgPSBkdXJhYmlsaXR5KVxuICAgICAgICAke3JvdygnSFAgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAxLCAxLCA0LCAwLjA1KX0ke3JvdygnSFAgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnRGFtYWdlIHggMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5kbWcsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMiwgMSwgNiwgMC4wNSl9JHtyb3coJ1NpemUgMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5zY2FsZSwgMSwgMSwgMS42LCAwLjAyKX0ke3JvdygnU2l6ZSAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAyLCAxLCAyLCAwLjAyKX08L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHRhYmxlPjx0cj48dGg+PC90aD48dGg+aHA8L3RoPjx0aD5kbWc8L3RoPjx0aD5yYXRlPC90aD48dGg+cmFuZ2U8L3RoPjx0aD5zcGQ8L3RoPjwvdHI+JHtTT1VMUy5tYXAoKGspID0+IGA8dHI+PHRkPiR7SUNPTltrXX08L3RkPiR7WydocCcsICdkbWcnLCAnaW50ZXJ2YWwnLCAncmFuZ2UnLCAnc3BlZWQnXS5tYXAoKGYpID0+IGA8dGQ+PGlucHV0IGNsYXNzPVwibnVtXCIgZGF0YS1zb3VsPVwiJHtrfVwiIGRhdGEtZj1cIiR7Zn1cIiB2YWx1ZT1cIiR7KEJBTEFOQ0Uuc3RhdHMgYXMgYW55KVtrXVtmXX1cIj48L3RkPmApLmpvaW4oJycpfTwvdHI+YCkuam9pbignJyl9PC90YWJsZT48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+RGlmZmljdWx0eSA8c2VsZWN0IGlkPVwiZERpZmZcIj4ke1snZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXS5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiICR7Zy5kaWZmaWN1bHR5ID09PSBrID8gJ3NlbGVjdGVkJyA6ICcnfT4ke2t9PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxzbWFsbD4oYXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUpPC9zbWFsbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRNZXJnZUhhbmRcIiAke2cucy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicgPyAnY2hlY2tlZCcgOiAnJ30+IE1lcmdlIGEgaGFuZCBjYXJkIHN0cmFpZ2h0IGludG8gYSBkZXBsb3llZCB1bml0IChvZmYgPSBkb2MgcnVsZTogYm90aCBjb3BpZXMgbXVzdCBiZSBvbiB0aGUgYm9hcmQpPC9sYWJlbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+UGVyZm9ybWFuY2U8YnI+PHNtYWxsIGlkPVwiZGJnUGVyZlwiPm1lYXN1cmluZ1x1MjAyNjwvc21hbGw+PGJyPjxsYWJlbD48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgaWQ9XCJkRnBzXCIgJHtnLnNob3dGcHMgPyAnY2hlY2tlZCcgOiAnJ30+IFNob3cgRlBTIG9uIHRoZSBiYXR0bGUgc2NyZWVuPC9sYWJlbD4gPGJ1dHRvbiBpZD1cImRQZXJmXCI+Q29weSBwZXJmIHJlcG9ydDwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZE9kZHNcIj5UZXN0IG9kZHMgKDIwMCBmaWdodHMpPC9idXR0b24+IDxzcGFuIGlkPVwiZE9kZHNPdXRcIj4ke3RoaXMub2Rkc308L3NwYW4+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkQ29weVwiPkNvcHkgcmVwb3J0PC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzZXRcIj5SZXNldCBiYWxhbmNlPC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzdGFydFwiPlJlc3RhcnQgc3RhZ2U8L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+QWRkIGNhcmQgPHNlbGVjdCBpZD1cImRDYXJkXCI+JHtTT1VMUy5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiPiR7U09VTF9OQU1FW2tdfTwvb3B0aW9uPmApLmpvaW4oJycpfTwvc2VsZWN0PiA8YnV0dG9uIGlkPVwiZEFkZFwiPis8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImREb21cIj4rMiBEb21pbmlvbjwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+TGFzdCB0YXA6IDxzcGFuIGlkPVwiZGJndGFwXCI+JHtnLmxhc3RUYXBJbmZvfTwvc3Bhbj48L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+U2VlZCAke2cuc2VlZH0uIEFkZCA8Y29kZT4/c2VlZD03PC9jb2RlPiB0byB0aGUgbGluayB0byByZXBsYXkgdGhlIHNhbWUgZHJhd3MuPC9zbWFsbD48L2Rpdj5gO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXRbdHlwZT1yYW5nZV0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25pbnB1dCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGxhYiA9IGlucC5kYXRhc2V0Lm8hOyBjb25zdCB2ID0gK2lucC52YWx1ZTsgKGlucC5uZXh0RWxlbWVudFNpYmxpbmcgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gU3RyaW5nKHYpO1xuICAgICAgY29uc3Qgc2V0OiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkPiA9IHsgJ0hQIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMV0gPSB2KSwgJ0hQIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMl0gPSB2KSwgJ0RhbWFnZSB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1sxXSA9IHYpLCAnRGFtYWdlIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzJdID0gdiksICdTaXplIDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzFdID0gdiksICdTaXplIDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzJdID0gdikgfTtcbiAgICAgIHNldFtsYWJdKCk7IGcuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7XG4gICAgfSkpO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXQubnVtJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uY2hhbmdlID0gKCkgPT4geyAoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2lucC5kYXRhc2V0LnNvdWwhXVtpbnAuZGF0YXNldC5mIV0gPSAraW5wLnZhbHVlOyB9KSk7XG4gICAgJCgnZERpZmYnKS5vbmNoYW5nZSA9IChlKSA9PiBnLmNoYW5nZURpZmZpY3VsdHkoKGUudGFyZ2V0IGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSk7XG4gICAgJCgnZE1lcmdlSGFuZCcpLm9uY2hhbmdlID0gKGUpID0+IHsgZy5zLnJ1bGVzLm1lcmdlID0gKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQgPyAnaGFuZEludG9PbmVTdGFyJyA6ICdkZXBsb3llZE9ubHknOyBnLnN5bmNCdWlsZCgpOyB0aGlzLnJlbmRlcigpOyB9O1xuICAgICQoJ2RPZGRzJykub25jbGljayA9ICgpID0+IHsgY29uc3QgciA9IGcudGVzdE9kZHMoMjAwKTsgdGhpcy5vZGRzID0gYCR7ci53aW59JSB3aW4gKCR7ci5ufSBmaWdodHMsIGF2ZyAke3IuYXZnVGltZX1zKSB2cyB3YXZlICR7Zy5zLndhdmV9YDsgJCgnZE9kZHNPdXQnKS50ZXh0Q29udGVudCA9IHRoaXMub2RkczsgfTtcbiAgICAkKCdkQ29weScpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdSZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkRnBzJykub25jaGFuZ2UgPSAoZSkgPT4gZy5zZXRTaG93RnBzKChlLnRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS5jaGVja2VkKTtcbiAgICAkKCdkUGVyZicpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnBlcmZSZXBvcnQoKTsgKG5hdmlnYXRvci5jbGlwYm9hcmQgPyBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KSA6IFByb21pc2UucmVqZWN0KCkpLnRoZW4oKCkgPT4gdGhpcy50b2FzdCgnUGVyZiByZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkUmVzZXQnKS5vbmNsaWNrID0gKCkgPT4geyBnLnJlc2V0QmFsYW5jZUFsbCgpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgJCgnZFJlc3RhcnQnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydFN0YWdlKGcuc2VlZCk7XG4gICAgJCgnZEFkZCcpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZENhcmQoKCQoJ2RDYXJkJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlIGFzIFNvdWxJZCk7ICQoJ2REb20nKS5vbmNsaWNrID0gKCkgPT4gZy5hZGREb21pbmlvbigyKTtcbiAgfVxuICByZW5kZXJEZWJ1Z0xpdmUoKSB7XG4gICAgY29uc3QgZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmdmcHMnKTsgaWYgKGYpIGYudGV4dENvbnRlbnQgPSBgJHt0aGlzLmcucGhhc2V9YDtcbiAgICBjb25zdCBwZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmdQZXJmJyk7IGlmIChwZikgeyBjb25zdCBwID0gdGhpcy5nLnBlcmZJbmZvKCk7IHBmLnRleHRDb250ZW50ID0gYCR7cC5mcHMudG9GaXhlZCgwKX0gZnBzIFx1MDBCNyBhdmcgJHtwLmF2Zy50b0ZpeGVkKDEpfW1zIFx1MDBCNyBzbG93NSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zIFx1MDBCNyB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyBcdTAwQjcgJHtwLm1lc2hlc30gbWVzaGVzIFx1MDBCNyAke3AucGFydGljbGVzfSBwYXJ0aWNsZSBzeXN0ZW1zIFx1MDBCNyAke3AuZHJhd3N9IGRyYXcgY2FsbHNgOyB9XG4gICAgY29uc3QgdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmd0YXAnKTsgaWYgKHQpIHQudGV4dENvbnRlbnQgPSB0aGlzLmcubGFzdFRhcEluZm87XG4gIH1cbn1cbiIsICIvLyBUaGUgcGxheWFibGUgcHJvdG90eXBlOiBidWlsZCBzY3JlZW4gLT4gYmF0dGxlIC0+IGRyYWZ0IC0+IG5leHQgd2F2ZSwgYnVpbHQgb24gdGhlIHRlc3RlZCBydWxlcyArIGJhdHRsZSBlbmdpbmUuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcbmltcG9ydCB7IEJBTEFOQ0UsIHJlc2V0QmFsYW5jZSwgU09VTF9OQU1FIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IEdSSURfQ0VMTFMsIEdSSURfQ09MUywgR1JJRF9ST1dTLCBTT1VMUyB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQge1xuICBhZHZhbmNlV2F2ZSwgY2FuTWVyZ2VEZXBsb3llZCwgY2FuTWVyZ2VGcm9tSGFuZCwgY2FuU3VtbW9uLCBjZWxsRnJlZSwgY29zdCwgZGlzY2FyZFJlZHJhdywgZGlzbWlzcywgZG9taW5pb25GcmVlLCBkb21pbmlvblVzZWQsIGRyYWZ0T3B0aW9ucywgZmFpbFdhdmUsXG4gIG1lcmdlRGVwbG95ZWQsIG1lcmdlRnJvbUhhbmQsIG1vdmVVbml0LCBuZXdTdGFnZSwgbm9ybWFsRHJhdywgc3RhZ2VXYXZlcywgc3VtbW9uLCBzd2FwU2VsbCwgdGFrZURyYWZ0LFxufSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IEJhdHRsZSwgY2VsbFBvcywgRlJPTlRfWCwgR1JJRF9TUCwgc2ltdWxhdGUgfSBmcm9tICcuLi9jb3JlL2JhdHRsZS50cyc7XG5pbXBvcnQgdHlwZSB7IEJFdmVudCB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB7IGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5TmFtZSwgZW5lbXlQb3dlciwgZW5lbXlXYXZlLCBzZXREaWZmaWN1bHR5LCBzZXRTdGFnZURpZmZpY3VsdHkgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IFBST1RPVFlQRV9SVUxFUyB9IGZyb20gJy4uL2NvcmUvcHJvdG90eXBlLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlIH0gZnJvbSAnLi4vY29yZS9zYXZlLnRzJztcbmltcG9ydCB7IE5lY3JvbWFuY2VyIH0gZnJvbSAnLi9uZWNyb21hbmNlci50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgY2xlYXJSdW4sIGxvYWRSdW4sIHNhdmVSdW4sIHNlcmlhbGl6ZVN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB7IHBsYXlhYmxlLCByZWNvcmRDbGVhckFuZFNhdmUgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB0eXBlIHsgQ2xlYXJSZXdhcmQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB0eXBlIHsgUnVuU25hcHNob3QgfSBmcm9tICcuLi9jb3JlL3J1bnNhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgY3JlYXRlVmlzdWFsLCBpc1RyaXBvLCBsb2FkQXNzZXRzIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB0eXBlIHsgQXNzZXRzLCBVbml0VmlzdWFsIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB7IFVpIH0gZnJvbSAnLi91aS50cyc7XG5cbmV4cG9ydCB0eXBlIFBoYXNlID0gJ2J1aWxkJyB8ICd0cmFuc2l0aW9uJyB8ICdiYXR0bGUnIHwgJ2RyYWZ0JyB8ICd3b24nIHwgJ2xvc3QnO1xudHlwZSBTZWwgPSB7IHR5cGU6ICdjYXJkJzsgaWR4OiBudW1iZXIgfSB8IHsgdHlwZTogJ3VuaXQnOyBpZDogbnVtYmVyIH0gfCBudWxsO1xuXG5leHBvcnQgY2xhc3MgR2FtZSB7XG4gIGVuZ2luZTogYW55OyBzY2VuZTogYW55OyBjYW1lcmE6IGFueTsgQSE6IEFzc2V0czsgdWkhOiBVaTtcbiAgcyE6IFN0YXRlOyBzZWVkID0gMTsgYXR0ZW1wdCA9IDA7IHBoYXNlOiBQaGFzZSA9ICdidWlsZCc7IGJhdHRsZTogQmF0dGxlIHwgbnVsbCA9IG51bGw7IHRpbWVTY2FsZSA9IDE7XG4gIHNlbDogU2VsID0gbnVsbDsgc3dhcE1vZGUgPSBmYWxzZTsgY29uZmlybVJlbW92ZSA9IGZhbHNlOyBkcmFmdDogU291bElkW10gfCBudWxsID0gbnVsbDsgbGFzdEJhdHRsZSA9ICcnO1xuICBwcml2YXRlIHVuaXRWaXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgIC8vIHVuaXQgaWQgLT4gdmlzdWFsICh5b3VyIGFybXksIHBlcnNpc3RzIGJldHdlZW4gd2F2ZXMpXG4gIHByaXZhdGUgdmlzVG9Vbml0ID0gbmV3IE1hcDxVbml0VmlzdWFsLCBudW1iZXI+KCk7XG4gIHByaXZhdGUgZnZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB2aXN1YWwgZHVyaW5nIGEgYmF0dGxlXG4gIHByaXZhdGUgZlVuaXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpOyAgICAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB1bml0IGlkIChwbGF5ZXIgc2lkZSlcbiAgcHJpdmF0ZSBsYXN0U3RhdGUgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpO1xuICBwcml2YXRlIHRpbGVzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbGVNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHJpbmdGeDogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd3M6IGFueVtdID0gW107IHByaXZhdGUgdGltZXJzOiB7IHQ6IG51bWJlcjsgZm46ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgYWNjID0gMDsgcHJpdmF0ZSBjYW1Gcm9tOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVRvOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVQgPSAxOyBwcml2YXRlIGNhbUR1ciA9IDIuMDsgcHJpdmF0ZSByZXN1bHRBdCA9IC0xOyBwcml2YXRlIGhhbmRsZWQgPSBmYWxzZTsgcHJpdmF0ZSBzdGFydFN0ZXBBdCA9IDA7XG4gIHByaXZhdGUgYXJyb3dNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93TWVzaDogYW55W10gPSBbXTtcbiAgbmVjcm8hOiBOZWNyb21hbmNlcjtcbiAgLyoqIFdoYXQgdGhlIGxhc3Qgc3RhZ2UgY2xlYXIgZWFybmVkIChzaG93biBvbiB0aGUgc3RhZ2UtY2xlYXJlZCBzY3JlZW4pLiAqL1xuICByZXdhcmQ6IENsZWFyUmV3YXJkIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2luZSA9IGZhbHNlOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSByZXN1bHQgY3V0c2NlbmUgaXMgcGxheWluZzogdGhlIGJhdHRsZSBjYW1lcmEgYW5kIGZpZ2h0ZXIgc3luYyBzdGFuZCBkb3duXG4gIHByaXZhdGUgdHdlZW5zOiB7IHQ6IG51bWJlcjsgZHVyOiBudW1iZXI7IGZuOiAodTogbnVtYmVyKSA9PiB2b2lkOyBkb25lPzogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSB0d2VlbihkdXI6IG51bWJlciwgZm46ICh1OiBudW1iZXIpID0+IHZvaWQsIGRvbmU/OiAoKSA9PiB2b2lkKSB7IHRoaXMudHdlZW5zLnB1c2goeyB0OiAwLCBkdXIsIGZuLCBkb25lIH0pOyB9XG4gIC8qKiBGaW5pc2ggZXZlcnkgcnVubmluZyBhbmltYXRpb24gYXQgb25jZSAoc28gbm90aGluZyBpcyBsZWZ0IGhhbGYtd2F5IG9yIHVuZGlzcG9zZWQgd2hlbiB0aGUgcGhhc2UgY2hhbmdlcykuICovXG4gIHByaXZhdGUgZmx1c2hUd2VlbnMoKSB7IGZvciAoY29uc3QgdyBvZiB0aGlzLnR3ZWVucy5zcGxpY2UoMCkpIHsgdy5mbigxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICBwcml2YXRlIHNlZW5NZXJnZXMgPSAwO1xuXG4gIGFzeW5jIGluaXQoY2FudmFzOiBIVE1MQ2FudmFzRWxlbWVudCkge1xuICAgIGNvbnN0IHFzID0gbmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpO1xuICAgIHRoaXMuZW5naW5lID0gbmV3IEJBQllMT04uRW5naW5lKGNhbnZhcywgdHJ1ZSwgeyBhbnRpYWxpYXM6IHRydWUsIHBvd2VyUHJlZmVyZW5jZTogJ2hpZ2gtcGVyZm9ybWFuY2UnIH0pO1xuICAgIGNvbnN0IGRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7IHRoaXMuZW5naW5lLnNldEhhcmR3YXJlU2NhbGluZ0xldmVsKDEgLyBNYXRoLm1pbihkcHIsIDEuNSkpO1xuICAgIGNvbnN0IHNjZW5lID0gdGhpcy5zY2VuZSA9IG5ldyBCQUJZTE9OLlNjZW5lKHRoaXMuZW5naW5lKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjA5LCAwLjA3LCAwLjEzLCAxKTtcbiAgICBjb25zdCBoZW1pID0gbmV3IEJBQllMT04uSGVtaXNwaGVyaWNMaWdodCgnaCcsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAxLCAwLjMpLCBzY2VuZSk7IGhlbWkuaW50ZW5zaXR5ID0gMS4wNTsgaGVtaS5ncm91bmRDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjMyLCAwLjI2LCAwLjQyKTtcbiAgICBjb25zdCBzdW4gPSBuZXcgQkFCWUxPTi5EaXJlY3Rpb25hbExpZ2h0KCdzJywgbmV3IEJBQllMT04uVmVjdG9yMygtMC40LCAtMSwgMC41NSksIHNjZW5lKTsgc3VuLmludGVuc2l0eSA9IDAuODU7XG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgQkFCWUxPTi5GcmVlQ2FtZXJhKCdjYW0nLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDgsIC05KSwgc2NlbmUpOyB0aGlzLmNhbWVyYS5taW5aID0gMC4xOyB0aGlzLmNhbWVyYS5tYXhaID0gMjAwOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg7IHRoaXMuY2FtZXJhLmlucHV0cy5jbGVhcigpO1xuXG4gICAgY29uc3QgZ3JvdW5kID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ2dyb3VuZCcsIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQwIH0sIHNjZW5lKTtcbiAgICBjb25zdCBnbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2dtJywgc2NlbmUpOyBnbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xNywgMC4xNSwgMC4yMSk7IGdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBncm91bmQubWF0ZXJpYWwgPSBnbTsgZ3JvdW5kLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHRlYW0gb2YgWzAsIDFdIGFzIGNvbnN0KSBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBjb25zdCB0ID0gdGhpcy5tYWtlVGlsZSh0ZWFtLCBjKTsgaWYgKHRlYW0gPT09IDApIHRoaXMudGlsZXMucHVzaCh0KTsgZWxzZSB0LnNldEVuYWJsZWQoZmFsc2UpOyB9XG5cbiAgICB0aGlzLkEgPSBhd2FpdCBsb2FkQXNzZXRzKHNjZW5lKTtcbiAgICB0aGlzLm5lY3JvID0gbmV3IE5lY3JvbWFuY2VyKHNjZW5lLCB0aGlzLkEuc29mdCk7ICAgICAgIC8vIHN0YW5kcyBqdXN0IGJlaGluZCBoaXMgYXJteSdzIGJhY2sgY29sdW1uLCBmYWNpbmcgdGhlIGJhdHRsZWZpZWxkXG4gICAgdGhpcy5uZWNyby5ob2xkZXIucG9zaXRpb24uc2V0KC0oRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC0gMS4wNSwgMCwgMCk7IHRoaXMubmVjcm8uaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjtcbiAgICB0aGlzLmFycm93TWF0cyA9IFswLCAxXS5tYXAoKHQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2FtJyArIHQsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMywgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC43LCAwLjI1KTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyByZXR1cm4gbTsgfSk7XG4gICAgdGhpcy51aSA9IG5ldyBVaSh0aGlzKTsgdGhpcy5zZWVkID0gKyhxcy5nZXQoJ3NlZWQnKSB8fCAxKTsgaWYgKHFzLmdldCgnZnBzJykpIHRoaXMuc2V0U2hvd0Zwcyh0cnVlKTtcblxuICAgIC8vIFRhcHMgYXJlIGRldGVjdGVkIGhlcmUgKG5vdCB0aHJvdWdoIEJhYnlsb24pIHNvIHRoZXkgYmVoYXZlIHRoZSBzYW1lIGluIFNhZmFyaSwgdGhlIGhvbWUtc2NyZWVuIGFwcCBhbmQgb24gZGVza3RvcC5cbiAgICBsZXQgZG93bjogeyB4OiBudW1iZXI7IHk6IG51bWJlcjsgdDogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBsb2NhbCA9IChlOiBQb2ludGVyRXZlbnQpID0+IHsgY29uc3QgciA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsgcmV0dXJuIHsgeDogZS5jbGllbnRYIC0gci5sZWZ0LCB5OiBlLmNsaWVudFkgLSByLnRvcCB9OyB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyZG93bicsIChlKSA9PiB7IGRvd24gPSB7IC4uLmxvY2FsKGUpLCB0OiBwZXJmb3JtYW5jZS5ub3coKSB9OyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcnVwJywgKGUpID0+IHsgaWYgKCFkb3duKSByZXR1cm47IGNvbnN0IHAgPSBsb2NhbChlKTsgY29uc3QgbW92ZWQgPSBNYXRoLmh5cG90KHAueCAtIGRvd24ueCwgcC55IC0gZG93bi55KSwgZHQgPSBwZXJmb3JtYW5jZS5ub3coKSAtIGRvd24udDsgZG93biA9IG51bGw7IGlmIChtb3ZlZCA8IDE2ICYmIGR0IDwgOTAwKSB0aGlzLnRhcChwLngsIHAueSk7IH0pO1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyY2FuY2VsJywgKCkgPT4geyBkb3duID0gbnVsbDsgfSk7XG4gICAgdGhpcy5jYW52YXMgPSBjYW52YXM7IGNvbnN0IG9uUmVzaXplID0gKCkgPT4gdGhpcy5oYW5kbGVSZXNpemUoKTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpOyB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignb3JpZW50YXRpb25jaGFuZ2UnLCAoKSA9PiBzZXRUaW1lb3V0KG9uUmVzaXplLCAyNTApKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0KSAod2luZG93IGFzIGFueSkudmlzdWFsVmlld3BvcnQuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpO1xuICAgIGlmICgod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIpIG5ldyAod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIob25SZXNpemUpLm9ic2VydmUoY2FudmFzKTtcbiAgICBpZiAocXMuZ2V0KCdnYWxsZXJ5JykpIHsgdGhpcy5nYWxsZXJ5KCk7IHJldHVybjsgfVxuICAgIGNvbnN0IHNhdmVkID0gcXMuZ2V0KCdzZWVkJykgPyBudWxsIDogbG9hZFJ1bigpOyAgICAgICAgICAgICAgICAvLyA/c2VlZD1OIGFsd2F5cyBzdGFydHMgZnJlc2ggKGRlYnVnZ2luZyk7IG90aGVyd2lzZSBwaWNrIHVwIHdoZXJlIHRoZSBsYXN0IHZpc2l0IGxlZnQgb2ZmXG4gICAgaWYgKHNhdmVkKSB0aGlzLnJlc3RvcmUoc2F2ZWQpOyBlbHNlIHRoaXMuc3RhcnRTdGFnZSh0aGlzLnNlZWQpO1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG5vdyA9IHBlcmZvcm1hbmNlLm5vdygpLCByYXcgPSBub3cgLSBsYXN0OyBjb25zdCBkdCA9IE1hdGgubWluKDAuMDUsIHJhdyAvIDEwMDApOyBsYXN0ID0gbm93OyBpZiAoIXRoaXMuYWN0aXZlKSByZXR1cm47IGlmICghdGhpcy5mcm96ZW4pIHRoaXMuZnJhbWUoZHQpOyBzY2VuZS5yZW5kZXIoKTsgdGhpcy5wZXJmVGljayhyYXcpOyB9KTtcbiAgfVxuICAvKiogVGhlIG5hdmlnYXRpb24gc2hlbGwgaGlkZXMgdGhlIGJhdHRsZSBzY3JlZW4gd2hpbGUgYW5vdGhlciB0YWIgaXMgb3BlbjogcGF1c2UgdGhlIGdhbWUgc28gaXQgY29zdHMgbm90aGluZy4gKi9cbiAgcHJpdmF0ZSBhY3RpdmUgPSB0cnVlO1xuICAvKiogRGVidWc6IGtlZXAgZHJhd2luZyBidXQgc3RvcCBhZHZhbmNpbmcgdGltZSwgc28gYSBtb21lbnQgY2FuIGJlIHN0ZXBwZWQgdGhyb3VnaCB3aXRoIGZyYW1lKGR0KSBhbmQgc2NyZWVuc2hvdHRlZC4gKi9cbiAgZnJvemVuID0gZmFsc2U7XG4gIHN0ZXAoZHQ6IG51bWJlcikgeyB0aGlzLmZyYW1lKGR0KTsgfVxuICBzZXRBY3RpdmUob246IGJvb2xlYW4pIHsgdGhpcy5hY3RpdmUgPSBvbjsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNjZW5lIGhlbHBlcnNcbiAgcHJpdmF0ZSBtYWtlVGlsZSh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCksIHQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCd0aWxlJyArIGNlbGwsIHsgc2l6ZTogR1JJRF9TUCAqIDAuOTIgfSwgdGhpcy5zY2VuZSk7XG4gICAgdC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHQucG9zaXRpb24uc2V0KHAueCwgMC4wMTUsIHAueik7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3RtJywgdGhpcy5zY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjEyLCAwLjQyKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQyLCAwLjEyLCAwLjEyKTsgbS5hbHBoYSA9IDAuNTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB0Lm1hdGVyaWFsID0gbTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyB0Lm1ldGFkYXRhID0geyBraW5kOiAndGlsZScsIGNlbGwgfTsgdGhpcy50aWxlTWF0c1tjZWxsXSA9IG07IH0gZWxzZSB0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICByZXR1cm4gdDtcbiAgfVxuICBwcml2YXRlIHRpbnQoY2VsbDogbnVtYmVyLCBtb2RlOiAnbm9ybWFsJyB8ICdmcmVlJyB8ICdzZWwnIHwgJ3BhcnRuZXInKSB7XG4gICAgY29uc3QgbSA9IHRoaXMudGlsZU1hdHNbY2VsbF07IGNvbnN0IGMgPSB7IG5vcm1hbDogWzAuMTgsIDAuMTIsIDAuNDIsIDAuNV0sIGZyZWU6IFswLjIsIDAuNzUsIDAuNTUsIDAuN10sIHNlbDogWzEsIDAuODIsIDAuMywgMC44NV0sIHBhcnRuZXI6IFswLjg1LCAwLjM1LCAxLCAwLjg1XSB9W21vZGVdO1xuICAgIG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhjWzBdLCBjWzFdLCBjWzJdKTsgbS5hbHBoYSA9IGNbM107XG4gIH1cbiAgbGF0ZXIoc2VjOiBudW1iZXIsIGZuOiAoKSA9PiB2b2lkKSB7IHRoaXMudGltZXJzLnB1c2goeyB0OiBzZWMsIGZuIH0pOyB9XG4gIHByaXZhdGUgZnhSaW5nKHg6IG51bWJlciwgejogbnVtYmVyLCBjb2xvcjogYW55LCByMDogbnVtYmVyLCByMTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdmeCcsIHsgZGlhbWV0ZXI6IDEsIHRoaWNrbmVzczogMC4wMzUsIHRlc3NlbGxhdGlvbjogMjggfSwgdGhpcy5zY2VuZSk7IG0ucG9zaXRpb24uc2V0KHgsIDAuMDUsIHopOyBtLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBtbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2Z4bScsIHRoaXMuc2NlbmUpOyBtbS5lbWlzc2l2ZUNvbG9yID0gY29sb3I7IG1tLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG1tLmFscGhhID0gMC45OyBtLm1hdGVyaWFsID0gbW07IHRoaXMucmluZ0Z4LnB1c2goeyBtLCBtbSwgdDogMCwgcjAsIHIxLCBkdXIgfSk7XG4gIH1cbiAgcHJpdmF0ZSBidXJzdCh4OiBudW1iZXIsIHo6IG51bWJlciwgYzE6IG51bWJlcltdLCBjMjogbnVtYmVyW10sIGNvdW50OiBudW1iZXIpIHtcbiAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdiJywgNjAsIHRoaXMuc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoeCwgMC4wNSwgeik7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIDAuMDUsIDAuMik7XG4gICAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMSBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMyIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjEsIDAsIDAuMiwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMTI7IHBzLm1heFNpemUgPSAwLjM0OyBwcy5taW5MaWZlVGltZSA9IDAuNDsgcHMubWF4TGlmZVRpbWUgPSAwLjk7IHBzLmVtaXRSYXRlID0gMDsgcHMubWFudWFsRW1pdENvdW50ID0gY291bnQ7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLCAxLjMsIC0xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMSwgMi40LCAxKTtcbiAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjg7IHBzLm1heEVtaXRQb3dlciA9IDI7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIC0yLCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy50YXJnZXRTdG9wRHVyYXRpb24gPSAxLjI7IHBzLmRpc3Bvc2VPblN0b3AgPSB0cnVlOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gY2FtZXJhXG4gIHByaXZhdGUgcG9zZXMoKSB7XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3QgaGFsZiA9IEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQICsgMS40O1xuICAgIGNvbnN0IGQgPSBNYXRoLm1heChoYWxmIC8gKHRhblYgKiBhc3ApLCAoKEdSSURfUk9XUyAqIEdSSURfU1ApIC8gMiArIDIpIC8gKHRhblYgKiAwLjU1KSwgOCk7XG4gICAgY29uc3QgYmF0dGxlID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMSAqIGQsIDAuNDIgKiBkICsgMC41LCAtMC44NiAqIGQpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC4zNSwgMCkgfTtcbiAgICAvLyBCdWlsZCB2aWV3OiAoYWxtb3N0KSBzdHJhaWdodCBkb3duLCB3aXRoIHRoZSB3aG9sZSBncmlkIGluc2lkZSB0aGUgYmFuZCBiZXR3ZWVuIHRoZSB0b3AgYmFyIGFuZCB0aGUgaGFuZCBvZiBjYXJkcy5cbiAgICBjb25zdCBjeCA9IC0oRlJPTlRfWCArICgoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAvIDIpLCBIID0gTWF0aC5tYXgoMSwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KTtcbiAgICBjb25zdCBib3ggPSAoaWQ6IHN0cmluZykgPT4geyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsgcmV0dXJuIGVsICYmIGVsLm9mZnNldFBhcmVudCAhPT0gbnVsbCA/IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpIDogbnVsbDsgfTtcbiAgICBjb25zdCB0b3BCYXIgPSBib3goJ3RvcCcpLCBoYW5kID0gYm94KCdoYW5kJyksIGluZm8gPSBib3goJ2luZm8nKTtcbiAgICBjb25zdCBUT1AgPSBNYXRoLm1pbigwLjMyLCB0b3BCYXIgPyAodG9wQmFyLmJvdHRvbSArIDYpIC8gSCA6IDAuMSk7XG4gICAgY29uc3QgQk9UVE9NID0gTWF0aC5taW4oMC41LCAoSCAtIE1hdGgubWluKGhhbmQgPyBoYW5kLnRvcCA6IEgsIGluZm8gPyBpbmZvLnRvcCA6IEgpICsgNikgLyBIKTtcbiAgICBjb25zdCBiYW5kID0gTWF0aC5tYXgoMC4zLCAxIC0gVE9QIC0gQk9UVE9NKSwgY2VudGVyRnJhYyA9IFRPUCArIGJhbmQgLyAyOyAgICAgICAgICAvLyB0aGUgZ3JpZCdzIGNlbnRyZSBhcHBlYXJzIGF0IHRoaXMgZnJhY3Rpb24gZnJvbSB0aGUgdG9wXG4gICAgY29uc3QgZ3cgPSBHUklEX0NPTFMgKiBHUklEX1NQICsgMy4yLCBnaCA9IEdSSURfUk9XUyAqIEdSSURfU1AgKyAwLjU7ICAgICAgICAgICAgICAgIC8vIHRoZSB3aWR0aCBhbHNvIGxlYXZlcyByb29tIGZvciB0aGUgTmVjcm9tYW5jZXIgYmVzaWRlIHRoZSBncmlkXG4gICAgY29uc3QgZDIgPSBNYXRoLm1heChnaCAvICgyICogdGFuViAqIGJhbmQpLCBndyAvICgyICogdGFuViAqIGFzcCAqIDAuODgpLCA0LjUpO1xuICAgIGNvbnN0IHNoaWZ0ID0gKDAuNSAtIGNlbnRlckZyYWMpICogMiAqIGQyICogdGFuViwgYnggPSBjeCAtIDAuNjtcbiAgICBjb25zdCBidWlsZCA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCBkMiwgLXNoaWZ0IC0gMC4xICogZDIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIDAsIC1zaGlmdCkgfTtcbiAgICBjb25zdCBuZWNybyA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJhdHRsZS5wb3MueCAtIDEuNCwgYmF0dGxlLnBvcy55ICogMS4xMiwgYmF0dGxlLnBvcy56ICogMS4xMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygtMS40LCAwLjM1LCAwKSB9OyAgIC8vIHJlc3VsdCBjdXRzY2VuZXM6IGhpbSBhbmQgdGhlIGZpZWxkXG4gICAgcmV0dXJuIHsgYmF0dGxlLCBidWlsZCwgbmVjcm8gfTtcbiAgfVxuICAvKiogVGhlIGhhbmQgLyBpbmZvIGJhciBjYW4gY2hhbmdlIHNpemUgaW4gdGhlIGJ1aWxkIHBoYXNlIChsb25nIGFiaWxpdHkgdGV4dCwgbW9yZSBjYXJkcyk6IHJlLWZyYW1lIHNvIHRoZSBncmlkIG5ldmVyIGhpZGVzIGJlaGluZCBpdC4gKi9cbiAgcmVmcmFtZUJ1aWxkKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8IHRoaXMuY2FtVCA8IDEgfHwgdGhpcy5jaW5lIHx8ICF0aGlzLmNhbnZhcykgcmV0dXJuO1xuICAgIGNvbnN0IHAgPSB0aGlzLnBvc2VzKCkuYnVpbGQsIGMgPSB0aGlzLmNhbWVyYS5wb3NpdGlvbjtcbiAgICBpZiAoIWlzRmluaXRlKHAucG9zLngpIHx8IEJBQllMT04uVmVjdG9yMy5EaXN0YW5jZShjLCBwLnBvcykgPCAwLjA2KSByZXR1cm47XG4gICAgdGhpcy50d2VlbkNhbShwLCAwLjM1KTtcbiAgfVxuICBwcml2YXRlIGNhbnZhcyE6IEhUTUxDYW52YXNFbGVtZW50OyBwcml2YXRlIGxhc3RXID0gMDsgcHJpdmF0ZSBsYXN0SCA9IDA7IGxhc3RUYXBJbmZvID0gJyhubyB0YXBzIHlldCknO1xuICBwcml2YXRlIGhhbmRsZVJlc2l6ZSgpIHtcbiAgICBpZiAoIXRoaXMuY2FudmFzLmNsaWVudFdpZHRoIHx8ICF0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpIHJldHVybjsgICAvLyBoaWRkZW4gYmVoaW5kIGFub3RoZXIgdGFiXG4gICAgdGhpcy5lbmdpbmUucmVzaXplKCk7IHRoaXMubGFzdFcgPSB0aGlzLmNhbnZhcy5jbGllbnRXaWR0aDsgdGhpcy5sYXN0SCA9IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyAmJiB0aGlzLmNhbVQgPj0gMSkgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgfVxuICAvKiogQSB0YXAgb24gdGhlIDNEIHZpZXc6IHBpY2sgYSB0aWxlIG9yIGEgdW5pdC4gKi9cbiAgcHJpdmF0ZSB0YXAoeDogbnVtYmVyLCB5OiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gdGhpcy5zY2VuZS5waWNrKHgsIHksIChtOiBhbnkpID0+ICEhKG0ubWV0YWRhdGEgJiYgbS5tZXRhZGF0YS5raW5kKSk7XG4gICAgY29uc3QgbWQgPSBwICYmIHAuaGl0ID8gcC5waWNrZWRNZXNoLm1ldGFkYXRhIDogbnVsbDtcbiAgICB0aGlzLmxhc3RUYXBJbmZvID0gYHRhcCAke01hdGgucm91bmQoeCl9LCR7TWF0aC5yb3VuZCh5KX0gb2YgJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IC0+ICR7bWQgPyAobWQua2luZCA9PT0gJ3RpbGUnID8gJ3RpbGUgJyArIG1kLmNlbGwgOiAndW5pdCcpIDogJ25vdGhpbmcnfSAocGhhc2UgJHt0aGlzLnBoYXNlfSlgO1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICFtZCkgcmV0dXJuO1xuICAgIGlmIChtZC5raW5kID09PSAndGlsZScpIHRoaXMub25UaWxlKG1kLmNlbGwpOyBlbHNlIGlmIChtZC5raW5kID09PSAndW5pdCcpIHRoaXMub25Vbml0VmlzdWFsKG1kLnZpc3VhbCk7XG4gIH1cbiAgcHJpdmF0ZSBzZXRDYW0ocDogYW55KSB7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNvcHlGcm9tKHAucG9zKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHAudGd0LmNsb25lKCkpOyB9XG4gIHByaXZhdGUgdHdlZW5DYW0odG86IGFueSwgZHVyOiBudW1iZXIpIHsgdGhpcy5jYW1Gcm9tID0geyBwb3M6IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNsb25lKCksIHRndDogdGhpcy5jYW1lcmEuZ2V0VGFyZ2V0KCkuY2xvbmUoKSB9OyB0aGlzLmNhbVRvID0gdG87IHRoaXMuY2FtVCA9IDA7IHRoaXMuY2FtRHVyID0gZHVyOyB9XG5cbiAgLy8gLS0tLSBiYXR0bGUgY2FtZXJhOiBmb2xsb3dzIHRoZSBmaWdodGVycyB0aGF0IGFyZSBzdGlsbCBhbGl2ZSwgc28gdGhlIGFjdGlvbiAoYW5kIHRoZSBwdXJwbGUgZXllcykgc3RheXMgbGFyZ2Ugb24gc2NyZWVuXG4gIGNhbU1vZGU6ICdjbG9zZScgfCAnd2lkZScgPSAnY2xvc2UnOyBwcml2YXRlIGNhbVRndDogYW55ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIDApO1xuICBzZXRDYW1Nb2RlKG06ICdjbG9zZScgfCAnd2lkZScpIHtcbiAgICB0aGlzLmNhbU1vZGUgPSBtO1xuICAgIGlmIChtID09PSAnd2lkZScgJiYgdGhpcy5iYXR0bGUpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMC45KTtcbiAgICB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgZnJhbWVCYXR0bGUoZHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTsgaWYgKCFiKSByZXR1cm47IGNvbnN0IGFsaXZlID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAoIWFsaXZlLmxlbmd0aCkgcmV0dXJuO1xuICAgIGxldCB4MCA9IDFlOSwgeDEgPSAtMWU5LCB6MCA9IDFlOSwgejEgPSAtMWU5OyBmb3IgKGNvbnN0IGYgb2YgYWxpdmUpIHsgeDAgPSBNYXRoLm1pbih4MCwgZi54KTsgeDEgPSBNYXRoLm1heCh4MSwgZi54KTsgejAgPSBNYXRoLm1pbih6MCwgZi56KTsgejEgPSBNYXRoLm1heCh6MSwgZi56KTsgfVxuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IHdpZGUgPSB0aGlzLnBvc2VzKCkuYmF0dGxlLCBjeCA9ICh4MCArIHgxKSAvIDIsIGN6ID0gKHowICsgejEpIC8gMjtcbiAgICBjb25zdCBkID0gTWF0aC5taW4oTWF0aC5tYXgoKHgxIC0geDAgKyAzLjQpIC8gKDIgKiB0YW5WICogYXNwICogMC45KSwgKHoxIC0gejAgKyAzLjIpIC8gKDIgKiB0YW5WICogMC42MiksIDUuNCksIE1hdGguaHlwb3Qod2lkZS5wb3MueSwgd2lkZS5wb3MueikpO1xuICAgIGNvbnN0IHRndCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3gsIDAuNTUsIGN6KSwgcG9zID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCAtIDAuMDYgKiBkLCAwLjMyICogZCArIDAuNSwgY3ogLSAwLjkgKiBkKTtcbiAgICBjb25zdCBrID0gMSAtIE1hdGguZXhwKC1kdCAqIDIuMCk7XG4gICAgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbWVyYS5wb3NpdGlvbiwgcG9zLCBrKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbVRndCwgdGd0LCBrKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhZ2UgZmxvd1xuICAvKiogV3JpdGUgdGhlIHJ1biB0byBkaXNrIChjYWxtIG1vbWVudHMgb25seTogYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0KS4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0UnVuKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMpIHJldHVybjtcbiAgICAgIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgeyBjbGVhclJ1bigpOyByZXR1cm47IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnICYmIHRoaXMucGhhc2UgIT09ICdkcmFmdCcpIHJldHVybjtcbiAgICAgIGNvbnN0IHNuYXA6IFJ1blNuYXBzaG90ID0geyB2OiAxLCBzZWVkOiB0aGlzLnNlZWQsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgc3RhZ2U6IGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5TmFtZSwgcGhhc2U6IHRoaXMucGhhc2UsIGRyYWZ0OiB0aGlzLnBoYXNlID09PSAnZHJhZnQnID8gdGhpcy5kcmFmdCA6IG51bGwsIHN0YXRlOiBzZXJpYWxpemVTdGF0ZShzKSB9O1xuICAgICAgc2F2ZVJ1bihzbmFwKTtcbiAgICB9IGNhdGNoIHsgLyogbmV2ZXIgbGV0IHNhdmluZyBicmVhayB0aGUgZ2FtZSAqLyB9XG4gIH1cbiAgLyoqIFJlYnVpbGQgdGhlIHNjcmVlbiBmcm9tIGEgc2F2ZWQgcnVuIChhIHJlbG9hZCwgb3IgU2FmYXJpIGRpc2NhcmRpbmcgdGhlIHBhZ2UpLiAqL1xuICBwcml2YXRlIHJlc3RvcmUocjogeyBzbmFwOiBSdW5TbmFwc2hvdDsgc3RhdGU6IFN0YXRlIH0pIHtcbiAgICBjb25zdCB7IHNuYXAsIHN0YXRlIH0gPSByO1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLmZsdXNoVHdlZW5zKCk7IHRoaXMubmVjcm8ucmV2aXZlKCk7IHNldFN0YWdlRGlmZmljdWx0eShzbmFwLnN0YWdlLCBzbmFwLmRpZmZpY3VsdHkpO1xuICAgIHRoaXMuc2VlZCA9IHNuYXAuc2VlZDsgdGhpcy5hdHRlbXB0ID0gc25hcC5hdHRlbXB0OyB0aGlzLnMgPSBzdGF0ZTsgdGhpcy5zZWVuTWVyZ2VzID0gc3RhdGUuc3RhdHMubWVyZ2VzO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IHNuYXAucGhhc2UgPT09ICdkcmFmdCcgPyBzbmFwLmRyYWZ0IDogbnVsbDsgdGhpcy5waGFzZSA9IHRoaXMuZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KGBSdW4gcmVzdG9yZWQ6IHdhdmUgJHtzdGF0ZS53YXZlfS8ke3N0YWdlV2F2ZXMoc3RhdGUpfSwgJHtzdGF0ZS5oZWFydHN9IGhlYXJ0JHtzdGF0ZS5oZWFydHMgPT09IDEgPyAnJyA6ICdzJ30uYCk7XG4gIH1cblxuICAvLyAtLS0tIHBlcmZvcm1hbmNlIHJlYWRvdXQ6IHJvbGxpbmcgZnJhbWUgc3RhdHMsIHBlci1iYXR0bGUgc3VtbWFyaWVzLCBvcHRpb25hbCBvbi1zY3JlZW4gRlBTLCBhbmQgYSBwYXN0ZS1mcmllbmRseSByZXBvcnRcbiAgc2hvd0ZwcyA9IGZhbHNlOyBwZXJmTm93ID0geyBmcHM6IDAsIGF2ZzogMCwgcDk1OiAwLCB3b3JzdDogMCB9OyBwZXJmTG9nOiBhbnlbXSA9IFtdO1xuICBwcml2YXRlIHBlcmZCdWYgPSBuZXcgRmxvYXQzMkFycmF5KDI0MCk7IHByaXZhdGUgcGVyZk4gPSAwOyBwcml2YXRlIHBlcmZJID0gMDsgcHJpdmF0ZSBwZXJmU2hvd25BdCA9IDA7IHByaXZhdGUgaW5zdHI6IGFueSA9IG51bGw7IHByaXZhdGUgZnBzSHVkOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGN1ckJhdHRsZTogeyBmcmFtZXM6IG51bWJlcjsgc3VtOiBudW1iZXI7IHdvcnN0OiBudW1iZXI7IHNsb3c6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHNldFNob3dGcHMob246IGJvb2xlYW4pIHtcbiAgICB0aGlzLnNob3dGcHMgPSBvbjtcbiAgICBpZiAob24gJiYgIXRoaXMuZnBzSHVkKSB7IGNvbnN0IGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgaC5pZCA9ICdmcHNIdWQnOyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JhdHRsZUhvc3QnKSB8fCBkb2N1bWVudC5ib2R5KS5hcHBlbmRDaGlsZChoKTsgdGhpcy5mcHNIdWQgPSBoOyB9XG4gICAgaWYgKHRoaXMuZnBzSHVkKSB0aGlzLmZwc0h1ZC5zdHlsZS5kaXNwbGF5ID0gb24gPyAnYmxvY2snIDogJ25vbmUnO1xuICB9XG4gIHByaXZhdGUgcGVyZlRpY2sobXM6IG51bWJlcikge1xuICAgIGlmIChtcyA+IDUwMCkgcmV0dXJuOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgdGFiIHdhcyBoaWRkZW4gb3IgdGhlIHBob25lIHBhdXNlZCB1czogbm90IGEgcmVhbCBmcmFtZVxuICAgIHRoaXMucGVyZkJ1Zlt0aGlzLnBlcmZJXSA9IG1zOyB0aGlzLnBlcmZJID0gKHRoaXMucGVyZkkgKyAxKSAlIHRoaXMucGVyZkJ1Zi5sZW5ndGg7IHRoaXMucGVyZk4gPSBNYXRoLm1pbih0aGlzLnBlcmZCdWYubGVuZ3RoLCB0aGlzLnBlcmZOICsgMSk7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlO1xuICAgIGlmIChjICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCB0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpKSB7IGMuZnJhbWVzKys7IGMuc3VtICs9IG1zOyBpZiAobXMgPiBjLndvcnN0KSBjLndvcnN0ID0gbXM7IGlmIChtcyA+IDMzLjQpIGMuc2xvdysrOyBjLnNjYWxlID0gTWF0aC5tYXgoYy5zY2FsZSwgdGhpcy50aW1lU2NhbGUpOyB9XG4gICAgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCk7IGlmIChub3cgLSB0aGlzLnBlcmZTaG93bkF0IDwgNTAwKSByZXR1cm47IHRoaXMucGVyZlNob3duQXQgPSBub3c7XG4gICAgY29uc3QgYSA9IEFycmF5LmZyb20odGhpcy5wZXJmQnVmLnN1YmFycmF5KDAsIHRoaXMucGVyZk4pKS5zb3J0KCh4LCB5KSA9PiB4IC0geSksIGF2ZyA9IGEucmVkdWNlKChuLCB4KSA9PiBuICsgeCwgMCkgLyBhLmxlbmd0aDtcbiAgICB0aGlzLnBlcmZOb3cgPSB7IGZwczogMTAwMCAvIGF2ZywgYXZnLCBwOTU6IGFbTWF0aC5mbG9vcihhLmxlbmd0aCAqIDAuOTUpXSA/PyAwLCB3b3JzdDogYVthLmxlbmd0aCAtIDFdID8/IDAgfTtcbiAgICBpZiAodGhpcy5mcHNIdWQgJiYgdGhpcy5zaG93RnBzKSB0aGlzLmZwc0h1ZC50ZXh0Q29udGVudCA9IGAke3RoaXMucGVyZk5vdy5mcHMudG9GaXhlZCgwKX0gZnBzICAke3RoaXMucGVyZk5vdy5hdmcudG9GaXhlZCgxKX1tcyAgc2xvdzUlICR7dGhpcy5wZXJmTm93LnA5NS50b0ZpeGVkKDApfW1zYDtcbiAgICB0aGlzLnVpLnJlbmRlckRlYnVnTGl2ZSgpO1xuICB9XG4gIHByaXZhdGUgYmVnaW5CYXR0bGVQZXJmKCkgeyB0aGlzLmN1ckJhdHRsZSA9IHsgZnJhbWVzOiAwLCBzdW06IDAsIHdvcnN0OiAwLCBzbG93OiAwLCBzY2FsZTogdGhpcy50aW1lU2NhbGUgfTsgfVxuICBwcml2YXRlIGVuZEJhdHRsZVBlcmYoKSB7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlOyB0aGlzLmN1ckJhdHRsZSA9IG51bGw7IGlmICghYyB8fCAhYy5mcmFtZXMpIHJldHVybjtcbiAgICB0aGlzLnBlcmZMb2cucHVzaCh7IHdhdmU6IHRoaXMucy53YXZlLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIHNwZWVkOiBjLnNjYWxlLCBmaWdodGVyczogdGhpcy5iYXR0bGUgPyB0aGlzLmJhdHRsZS5maWdodGVycy5sZW5ndGggOiAwLCBmcHM6ICsoMTAwMCAvIChjLnN1bSAvIGMuZnJhbWVzKSkudG9GaXhlZCgwKSwgd29yc3RNczogK2Mud29yc3QudG9GaXhlZCgwKSwgc2xvd1BjdDogKygoMTAwICogYy5zbG93KSAvIGMuZnJhbWVzKS50b0ZpeGVkKDEpIH0pO1xuICAgIGlmICh0aGlzLnBlcmZMb2cubGVuZ3RoID4gMTIpIHRoaXMucGVyZkxvZy5zaGlmdCgpO1xuICB9XG4gIHBlcmZJbmZvKCkge1xuICAgIGNvbnN0IHNjID0gdGhpcy5zY2VuZTsgaWYgKCF0aGlzLmluc3RyICYmIEJBQllMT04uU2NlbmVJbnN0cnVtZW50YXRpb24pIHRoaXMuaW5zdHIgPSBuZXcgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbihzYyk7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5wZXJmTm93LCBtZXNoZXM6IHNjLmdldEFjdGl2ZU1lc2hlcygpLmxlbmd0aCwgcGFydGljbGVzOiBzYy5wYXJ0aWNsZVN5c3RlbXMubGVuZ3RoLCBkcmF3czogdGhpcy5pbnN0ciA/IHRoaXMuaW5zdHIuZHJhd0NhbGxzQ291bnRlci5jdXJyZW50IDogLTEgfTtcbiAgfVxuICBwZXJmUmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcCA9IHRoaXMucGVyZkluZm8oKSwgZ2w6IGFueSA9IHRoaXMuZW5naW5lLmdldEdsSW5mbyA/IHRoaXMuZW5naW5lLmdldEdsSW5mbygpIDoge307XG4gICAgY29uc3Qgcm93cyA9IHRoaXMucGVyZkxvZy5tYXAoKHIpID0+IGAgIHdhdmUgJHtyLndhdmV9IHRyeSAke3IuYXR0ZW1wdH0gYXQgJHtyLnNwZWVkfXg6ICR7ci5mcHN9IGZwcyBhdmVyYWdlLCB3b3JzdCBmcmFtZSAke3Iud29yc3RNc31tcywgJHtyLnNsb3dQY3R9JSBzbG93IGZyYW1lcywgJHtyLmZpZ2h0ZXJzfSBmaWdodGVyc2ApO1xuICAgIHJldHVybiBbYFBFUkYgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9YCwgYGRldmljZTogJHtuYXZpZ2F0b3IudXNlckFnZW50fWAsIGBncHU6ICR7Z2wucmVuZGVyZXIgfHwgJz8nfSAoJHtnbC52ZW5kb3IgfHwgJz8nfSlgLFxuICAgICAgYHNjcmVlbiAke3NjcmVlbi53aWR0aH14JHtzY3JlZW4uaGVpZ2h0fSAgdmlld3BvcnQgJHtpbm5lcldpZHRofXgke2lubmVySGVpZ2h0fSAgZHByICR7ZGV2aWNlUGl4ZWxSYXRpb30gIHJlbmRlciAke3RoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCl9eCR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCl9ICBzY2FsaW5nIGxldmVsICR7dGhpcy5lbmdpbmUuZ2V0SGFyZHdhcmVTY2FsaW5nTGV2ZWwoKS50b0ZpeGVkKDIpfWAsXG4gICAgICBgbm93OiAke3AuZnBzLnRvRml4ZWQoMCl9IGZwcywgYXZlcmFnZSAke3AuYXZnLnRvRml4ZWQoMSl9bXMsIHNsb3dlc3QgNSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zLCB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyB8IGFjdGl2ZSBtZXNoZXMgJHtwLm1lc2hlc30sIHBhcnRpY2xlIHN5c3RlbXMgJHtwLnBhcnRpY2xlc30sIGRyYXcgY2FsbHMgJHtwLmRyYXdzfWAsXG4gICAgICBgc3RhdGU6IHBoYXNlICR7dGhpcy5waGFzZX0sIHNwZWVkICR7dGhpcy50aW1lU2NhbGV9eCwgY2FtZXJhICR7dGhpcy5jYW1Nb2RlfSwgZGlmZmljdWx0eSAke2RpZmZpY3VsdHlOYW1lfSwgd2F2ZSAke3RoaXMucy53YXZlfSwgdW5pdHMgJHt0aGlzLnMudW5pdHMubGVuZ3RofWAsXG4gICAgICBgYmF0dGxlcyAobmV3ZXN0IGxhc3QpOmAsIC4uLihyb3dzLmxlbmd0aCA/IHJvd3MgOiBbJyAgKG5vbmUgeWV0OiBwbGF5IGEgYmF0dGxlLCB0aGVuIGNvcHkgdGhpcyBhZ2FpbiknXSldLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgLyoqIEEgcnVuIHRoZSBwbGF5ZXIgaGFzIHJlYWxseSBzdGFydGVkIChzbyBIb21lIGNhbiBvZmZlciBDb250aW51ZSkuIE51bGwgYWZ0ZXIgYSBzdGFnZSB3YXMgd29uIG9yIGxvc3QsIG9yIGJlZm9yZSBhbnl0aGluZyB3YXMgZG9uZS4gKi9cbiAgcnVuSW5mbygpIHsgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzIHx8IHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gbnVsbDsgcmV0dXJuIChzLndhdmUgPiAxIHx8IHMudW5pdHMubGVuZ3RoID4gMCB8fCB0aGlzLmF0dGVtcHQgPiAwIHx8IHMuc3RhdHMuZmFpbHVyZXMgPiAwKSA/IHsgd2F2ZTogcy53YXZlLCB0b3RhbDogc3RhZ2VXYXZlcyhzKSwgaGVhcnRzOiBzLmhlYXJ0cywgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUsIHN0YWdlOiBjdXJyZW50U3RhZ2VJZCB9IDogbnVsbDsgfVxuICAvKiogRnJlc2ggcnVuIHdpdGggdGhlIGN1cnJlbnRseSBlcXVpcHBlZCBTb3VsIERlY2sgKEhvbWUgPiBTdGFydCBCYXR0bGUgY2FsbHMgdGhpcykuICovXG4gIG5ld1J1bigpIHsgdGhpcy5zdGFydFN0YWdlKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydFN0YWdlKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpLCBwbCA9IHBsYXlhYmxlKHN2KTsgc2V0U3RhZ2VEaWZmaWN1bHR5KHBsLnN0YWdlLCBwbC5kaWZmaWN1bHR5KTsgdGhpcy5zID0gbmV3U3RhZ2UoeyAuLi5QUk9UT1RZUEVfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdCgnU3RhZ2Ugc3RhcnQ6IDQgY2FyZHMsICcgKyB0aGlzLnMuY2FwICsgJyBEb21pbmlvbi4gU3VtbW9uLCBtZXJnZSwgdGhlbiBwcmVzcyBCQVRUTEUuJyk7XG4gIH1cbiAgcHJpdmF0ZSBjbGVhckJhdHRsZSgpIHtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYuZGlzcG9zZSgpOyB9KTsgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTsgdGhpcy5iYXR0bGUgPSBudWxsO1xuICAgIHRoaXMuYXJyb3dzLmZvckVhY2goKGEpID0+IGEubWVzaC5kaXNwb3NlKCkpOyB0aGlzLmFycm93cyA9IFtdO1xuICB9XG4gIHByaXZhdGUgcG9zKGNlbGw6IG51bWJlcikgeyByZXR1cm4gY2VsbFBvcygwLCBjZWxsKTsgfVxuICBzeW5jQnVpbGQoKSB7XG4gICAgdGhpcy5wZXJzaXN0UnVuKCk7XG4gICAgY29uc3QgbWVyZ2VkID0gdGhpcy5zLnN0YXRzLm1lcmdlcyA+IHRoaXMuc2Vlbk1lcmdlczsgdGhpcy5zZWVuTWVyZ2VzID0gdGhpcy5zLnN0YXRzLm1lcmdlcztcbiAgICBjb25zdCBncm93biA9IG1lcmdlZCA/IHRoaXMucy51bml0cy5maW5kKCh1KSA9PiB7IGNvbnN0IGd2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgcmV0dXJuICEhZ3YgJiYgZ3Yuc3RhciAhPT0gdS5zdGFyOyB9KSA6IHVuZGVmaW5lZDsgICAvLyB0aGUgdW5pdCB0aGF0IGp1c3QgZ2FpbmVkIGEgc3RhclxuICAgIGNvbnN0IGFsaXZlID0gbmV3IFNldCh0aGlzLnMudW5pdHMubWFwKCh1KSA9PiB1LmlkKSk7XG4gICAgZm9yIChjb25zdCBbaWQsIHZdIG9mIHRoaXMudW5pdFZpcykgaWYgKCFhbGl2ZS5oYXMoaWQpKSB7XG4gICAgICB0aGlzLnZpc1RvVW5pdC5kZWxldGUodik7IHRoaXMudW5pdFZpcy5kZWxldGUoaWQpOyBjb25zdCBwID0gdi5ob2xkZXIucG9zaXRpb247XG4gICAgICBpZiAoZ3Jvd24pIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBtZXJnZTogdGhlIGNvbnN1bWVkIHVuaXQgaXMgZHJhd24gaW50byB0aGUgc3Vydml2b3IgYW5kIHZhbmlzaGVzIGluIGEgZmxhc2hcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyhncm93bi5jZWxsKSwgeDAgPSBwLngsIHowID0gcC56LCBzYyA9IHYuaG9sZGVyLnNjYWxpbmcueDsgdi5wbGF5KCdpZGxlJyk7XG4gICAgICAgIHRoaXMudHdlZW4oMC4zMywgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjQsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwoc2MgKiAoMSAtIDAuNzUgKiB0KSk7IH0sXG4gICAgICAgICAgKCkgPT4geyB0aGlzLmJ1cnN0KHRvLngsIHRvLnosIFswLjg1LCAwLjYsIDEsIDAuOV0sIFswLjUsIDAuMywgMSwgMC43XSwgMTQpOyB2LmRpc3Bvc2UoKTsgfSk7XG4gICAgICB9IGVsc2UgeyB0aGlzLmJ1cnN0KHAueCwgcC56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDE2KTsgdi5kaXNwb3NlKCk7IH1cbiAgICB9XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykge1xuICAgICAgbGV0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTtcbiAgICAgIGlmICghdikgeyB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgdS5zb3VsLCAwLCB1LnN0YXIpOyB0aGlzLnVuaXRWaXMuc2V0KHUuaWQsIHYpOyB0aGlzLnZpc1RvVW5pdC5zZXQodiwgdS5pZCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTsgYXVkaW8ucGxheSgnc3VtbW9uJyk7IGNvbnN0IHZ2ID0gdjsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcpIHZ2LnBsYXkoJ2lkbGUnKTsgfSk7IH1cbiAgICAgIGVsc2UgeyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IGlmICh2LnN0YXIgIT09IHUuc3RhcikgeyBjb25zdCBmdiA9IHY7IHYuc2V0U3Rhcih1LnN0YXIpOyB0aGlzLmxhdGVyKGdyb3duICYmIGdyb3duLmlkID09PSB1LmlkID8gMC4zMyA6IDAsICgpID0+IHRoaXMubWVyZ2VGeChmdiwgcC54LCBwLnopKTsgfSB9XG4gICAgfVxuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsO1xuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB7XG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCBjYW5TdW1tb24odGhpcy5zLCBzZWwuaWR4KSA/ICdmcmVlJyA6ICdub3JtYWwnKTtcbiAgICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZUZyb21IYW5kKHRoaXMucywgc2VsLmlkeCwgdS5pZCkpIHRoaXMudGludCh1LmNlbGwsICdwYXJ0bmVyJyk7ICAgICAvLyB0aGUgY2FyZCBjYW4gbWVyZ2UgaW50byB0aGlzIHVuaXRcbiAgICB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7XG4gICAgICBjb25zdCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7XG4gICAgICBpZiAodSkgeyB0aGlzLnRpbnQodS5jZWxsLCAnc2VsJyk7IGZvciAoY29uc3QgbyBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZURlcGxveWVkKHUsIG8pKSB0aGlzLnRpbnQoby5jZWxsLCAncGFydG5lcicpOyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCAnZnJlZScpOyB9XG4gICAgfVxuICB9XG4gIC8qKiBUaGUgbWVyZ2UgbW9tZW50OiBhIGZsYXNoIG9mIHJpbmdzIGFuZCBzcGFya3MsIGEgcHVuY2ggaW4gc2l6ZSwgYSByaXNpbmcgY2hpbWUuICovXG4gIHByaXZhdGUgbWVyZ2VGeCh2OiBVbml0VmlzdWFsLCB4OiBudW1iZXIsIHo6IG51bWJlcikge1xuICAgIGF1ZGlvLnBsYXkoJ21lcmdlJyk7IHYucHVsc2UoKTsgY29uc3QgdGFyZ2V0ID0gdi5ob2xkZXIuc2NhbGluZy54O1xuICAgIHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjQpLCAwLjIsIDIuMCwgMC42NSk7IHRoaXMubGF0ZXIoMC4xMiwgKCkgPT4gdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDEsIDEpLCAwLjIsIDMuMCwgMC44KSk7XG4gICAgdGhpcy5idXJzdCh4LCB6LCBbMSwgMC44NSwgMC40LCAwLjldLCBbMC44LCAwLjQsIDEsIDAuOF0sIDQ2KTsgdGhpcy5idXJzdCh4LCB6LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDI0KTtcbiAgICB0aGlzLnR3ZWVuKDAuNTUsICh0KSA9PiB2LmhvbGRlci5zY2FsaW5nLnNldEFsbCh0YXJnZXQgKiAoMSArIDAuNDUgKiBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAoMSAtIHQgKiAwLjQpKSksICgpID0+IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRhcmdldCkpO1xuICB9XG4gIHByaXZhdGUgc3VtbW9uRngoeDogbnVtYmVyLCB6OiBudW1iZXIpIHsgdGhpcy5idXJzdCh4LCB6LCBbMC43LCAwLjMsIDEsIDAuOV0sIFswLjM1LCAwLjEsIDAuNywgMC44XSwgMzApOyB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjMsIDEpLCAwLjIsIDEuMiwgMC43KTsgfVxuXG4gIC8vIC0tLS0gcGxheWVyIGFjdGlvbnMgKGJ1aWxkIHBoYXNlKVxuICB0b2FzdChtc2c6IHN0cmluZykgeyB0aGlzLnVpLnRvYXN0KG1zZyk7IH1cbiAgb25DYXJkKGlkeDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoZGlzY2FyZFJlZHJhdyh0aGlzLnMsIGlkeCkpIHsgdGhpcy50b2FzdCgnU3dhcHBlZDogZHJldyBhIGRpZmZlcmVudCBTb3VsLicpOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnNlbC5pZHggPT09IGlkeCA/IG51bGwgOiB7IHR5cGU6ICdjYXJkJywgaWR4IH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25UaWxlKGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IGhlcmUgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7IGlmIChoZXJlKSB7IHRoaXMub25Vbml0VmlzdWFsKHRoaXMudW5pdFZpcy5nZXQoaGVyZS5pZCkhKTsgcmV0dXJuOyB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnKSB7XG4gICAgICBpZiAoY2FuU3VtbW9uKHMsIHNlbC5pZHgpKSB7IHN1bW1vbihzLCBzZWwuaWR4LCBjZWxsKTsgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgICBlbHNlIHsgY29uc3Qgc291bCA9IHMuaGFuZFtzZWwuaWR4XTsgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbjogJHtTT1VMX05BTUVbc291bF19IGNvc3RzICR7Y29zdChzb3VsLCAxKX0sIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApOyB9XG4gICAgfSBlbHNlIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0JykgeyBpZiAobW92ZVVuaXQocywgc2VsLmlkLCBjZWxsKSkgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25Vbml0VmlzdWFsKHY6IFVuaXRWaXN1YWwpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMudmlzVG9Vbml0LmdldCh2KTsgaWYgKGlkID09PSB1bmRlZmluZWQgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKSE7XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKHN3YXBTZWxsKHMsIGlkKSkgeyB0aGlzLnRvYXN0KGBTb2xkICR7U09VTF9OQU1FW3Uuc291bF19OiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuYCk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QodS5mcmVzaCA/IFwiWW91IGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kLlwiIDogJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgcy5oYW5kW3RoaXMuc2VsLmlkeF0gPT09IHUuc291bCAmJiB1LnN0YXIgPT09IDEgJiYgcy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicpIHtcbiAgICAgIGlmIChtZXJnZUZyb21IYW5kKHMsIHRoaXMuc2VsLmlkeCwgaWQpKSB7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCB0aGUgY2FyZCBpbnRvIGEgMi1zdGFyICR7U09VTF9OQU1FW3Uuc291bF19IWApOyB9XG4gICAgICBlbHNlIHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb24gdG8gbWVyZ2U6IGl0IG5lZWRzICR7Y29zdCh1LnNvdWwsIDIpIC0gY29zdCh1LnNvdWwsIDEpfSBtb3JlLCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkICE9PSBpZCkge1xuICAgICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gKHRoaXMuc2VsIGFzIGFueSkuaWQpITtcbiAgICAgIGlmIChjYW5NZXJnZURlcGxveWVkKGEsIHUpKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgdS5pZCk7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkOiBhLmlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIH0gZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCA9PT0gaWQgPyBudWxsIDogeyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgbWVyZ2VTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7IGNvbnN0IGIgPSBhICYmIHMudW5pdHMuZmluZCgobykgPT4gY2FuTWVyZ2VEZXBsb3llZChhLCBvKSk7XG4gICAgaWYgKGEgJiYgYikgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIGIuaWQpOyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy50b2FzdCgnTm8gbWF0Y2hpbmcgdW5pdCAoc2FtZSBTb3VsIGFuZCBzdGFycykgdG8gbWVyZ2Ugd2l0aC4nKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHJlbW92ZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmNvbmZpcm1SZW1vdmUpIHsgdGhpcy5jb25maXJtUmVtb3ZlID0gdHJ1ZTsgdGhpcy50b2FzdCgnVGFwIFJlbW92ZSBhZ2FpbiB0byBjb25maXJtLiBUaGUgY2FyZCBpcyBnb25lIGZvciB0aGlzIHN0YWdlLicpOyB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47IH1cbiAgICBkaXNtaXNzKHRoaXMucywgc2VsLmlkKTsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICB0b2dnbGVTd2FwKCkgeyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuOyBpZiAodGhpcy5zLmRpc2NhcmRVc2VkKSB7IHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IHJldHVybjsgfSB0aGlzLnN3YXBNb2RlID0gIXRoaXMuc3dhcE1vZGU7IHRoaXMuc2VsID0gbnVsbDsgaWYgKHRoaXMuc3dhcE1vZGUpIHRoaXMudG9hc3QoJ1N3YXA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkLCBvciBhIHVuaXQgKG5vdCBzdW1tb25lZCB0aGlzIHJvdW5kKSB0byBzZWxsLicpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gYmF0dGxlXG4gIHN0YXJ0QmF0dGxlKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICF0aGlzLnMudW5pdHMubGVuZ3RoKSB7IGlmICghdGhpcy5zLnVuaXRzLmxlbmd0aCkgdGhpcy50b2FzdCgnU3VtbW9uIGF0IGxlYXN0IG9uZSB1bml0IGZpcnN0LicpOyByZXR1cm47IH1cbiAgICB0aGlzLmZsdXNoVHdlZW5zKCk7IGF1ZGlvLnBsYXkoJ3N0YXJ0Jyk7IHRoaXMuYmVnaW5CYXR0bGVQZXJmKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuYXR0ZW1wdCsrOyB0aGlzLmhhbmRsZWQgPSBmYWxzZTsgdGhpcy5yZXN1bHRBdCA9IC0xO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHVuaXRzID0gcy51bml0cy5zbGljZSgpO1xuICAgIGNvbnN0IHNhdmVkID0gbG9hZFNhdmUoKS5zb3VscywgbGV2ZWxzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307IGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhzYXZlZCkpIGxldmVsc1trXSA9IChzYXZlZCBhcyBhbnkpW2tdLmxldmVsOyAgIC8vIHBlcm1hbmVudCBTb3VsIGxldmVsc1xuICAgIHRoaXMuYmF0dGxlID0gbmV3IEJhdHRsZSh1bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpLCB0aGlzLnNlZWQgKiAxMzEgKyBzLndhdmUgKiAxNyArIHRoaXMuYXR0ZW1wdCwgbGV2ZWxzLCBlbmVteVBvd2VyKCkpO1xuICAgIHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7XG4gICAgdGhpcy5iYXR0bGUuZmlnaHRlcnMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgaWYgKGYudGVhbSA9PT0gMCkgeyBjb25zdCB1ID0gdW5pdHNbZi5pZCAtIDFdOyBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMuZlVuaXQuc2V0KGYuaWQsIHUuaWQpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB9XG4gICAgICBlbHNlIHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIGYuc291bCwgMSwgZi5zdGFyKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KGYueCwgMCwgZi56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IC1NYXRoLlBJIC8gMjsgdi5wbGF5KCdzcGF3bicpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmxhdGVyKDEuMSwgKCkgPT4geyBpZiAodi5zdGF0ZSA9PT0gJ3NwYXduJykgdi5wbGF5KCdpZGxlJyk7IH0pOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC43LCAwLjYsIDAuNSwgMC43XSwgWzAuNCwgMC4zNSwgMC4zLCAwLjZdLCAxNCk7IH1cbiAgICB9KTtcbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICB0aGlzLnBoYXNlID0gJ3RyYW5zaXRpb24nOyB0aGlzLnN0YXJ0U3RlcEF0ID0gMS4wOyB0aGlzLmFjYyA9IDA7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMi4yKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBwcml2YXRlIGFwcGx5RXZlbnRzKGV2czogQkV2ZW50W10pIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhO1xuICAgIGZvciAoY29uc3QgZSBvZiBldnMpIHtcbiAgICAgIGlmIChlLnQgPT09ICdzd2luZycpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB2LnBsYXkoJ2F0dGFjaycsIGUuc3BlZWQpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdoaXQnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUudG8pOyBpZiAodikgdi5wdWxzZSgpOyBpZiAoZS5raW5kID09PSAnYXJyb3cnKSBhdWRpby5wbGF5KCdoaXRBcnJvdycpOyBlbHNlIGlmIChlLmtpbmQgPT09ICdtZWxlZScpIGF1ZGlvLnBsYXkoJ2hpdCcpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdhcnJvdycpIHsgY29uc3QgZiA9IGIuYnlJZChlLmZyb20pISwgdG8gPSBiLmJ5SWQoZS50bykhOyB0aGlzLnNwYXduQXJyb3coZi50ZWFtLCBmLngsIGYueiwgdG8ueCwgdG8ueiwgZS5kdXIpOyBhdWRpby5wbGF5KCdhcnJvdycpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdkZWF0aCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB7IHYucGxheSgnZGVhdGgnKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnZGVhdGgnKTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxMik7IGlmIChmLnRlYW0gPT09IDEpIHRoaXMubGF0ZXIoNSwgKCkgPT4geyBpZiAodGhpcy5mdmlzLmdldChlLmlkKSA9PT0gdiAmJiB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSB7IHYuaG9sZGVyLnNldEVuYWJsZWQoZmFsc2UpOyB9IH0pOyB9IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Nhc3QnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCdjYXN0Jyk7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC41LCAwLjgsIDEpLCAwLjE1LCAxLjEsIDAuMzUpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICd0YXVudCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ3RhdW50Jyk7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC4zKSwgMC4zLCBCQUxBTkNFLnRhdW50LnJhZGl1cywgMC42KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnc21hc2gnKSB7IGF1ZGlvLnBsYXkoJ3NtYXNoJyk7IHRoaXMuZnhSaW5nKGUueCwgZS56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC41LCAwLjIpLCAwLjIsIGUuciAqIDEuNiwgMC40NSk7IH1cbiAgICB9XG4gIH1cbiAgcHJpdmF0ZSBzcGF3bkFycm93KHRlYW06IG51bWJlciwgeDA6IG51bWJlciwgejA6IG51bWJlciwgeDE6IG51bWJlciwgejE6IG51bWJlciwgZHVyOiBudW1iZXIpIHtcbiAgICBsZXQgbWVzaCA9IHRoaXMuYXJyb3dNZXNoLnBvcCgpO1xuICAgIGlmICghbWVzaCkgeyBtZXNoID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignYXJyb3cnLCB7IGhlaWdodDogMC41NSwgZGlhbWV0ZXI6IDAuMDM1IH0sIHRoaXMuc2NlbmUpOyBtZXNoLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgbWVzaC5pc1BpY2thYmxlID0gZmFsc2U7IGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2FyJywgdGhpcy5zY2VuZSk7IG1lc2gucGFyZW50ID0gaG9sZGVyOyBtZXNoID0gaG9sZGVyOyB9XG4gICAgbWVzaC5zZXRFbmFibGVkKHRydWUpOyBtZXNoLmdldENoaWxkTWVzaGVzKClbMF0ubWF0ZXJpYWwgPSB0aGlzLmFycm93TWF0c1t0ZWFtXTtcbiAgICB0aGlzLmFycm93cy5wdXNoKHsgbWVzaCwgeDAsIHowLCB4MSwgejEsIHQ6IDAsIGR1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZnJhbWUoZHQ6IG51bWJlcikge1xuICAgIGlmICh0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCAhPT0gdGhpcy5sYXN0VyB8fCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQgIT09IHRoaXMubGFzdEgpIHRoaXMuaGFuZGxlUmVzaXplKCk7ICAgLy8gZS5nLiB0aGUgaG9tZS1zY3JlZW4gYXBwIHJlc2l6aW5nIGFmdGVyIGxhdW5jaFxuICAgIGZvciAobGV0IGkgPSB0aGlzLnRpbWVycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyB0aGlzLnRpbWVyc1tpXS50IC09IGR0OyBpZiAodGhpcy50aW1lcnNbaV0udCA8PSAwKSB7IGNvbnN0IGYgPSB0aGlzLnRpbWVyc1tpXS5mbjsgdGhpcy50aW1lcnMuc3BsaWNlKGksIDEpOyBmKCk7IH0gfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLnJpbmdGeC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCByID0gdGhpcy5yaW5nRnhbaV07IHIudCArPSBkdDsgY29uc3QgdSA9IHIudCAvIHIuZHVyLCBzID0gci5yMCArIChyLnIxIC0gci5yMCkgKiB1OyByLm0uc2NhbGluZy5zZXQocywgcywgcyk7IHIubW0uYWxwaGEgPSAwLjkgKiAoMSAtIHUpOyBpZiAodSA+PSAxKSB7IHIubS5kaXNwb3NlKCk7IHIubW0uZGlzcG9zZSgpOyB0aGlzLnJpbmdGeC5zcGxpY2UoaSwgMSk7IH0gfVxuICAgIGlmICh0aGlzLmNhbVQgPCAxKSB7IHRoaXMuY2FtVCA9IE1hdGgubWluKDEsIHRoaXMuY2FtVCArIGR0IC8gdGhpcy5jYW1EdXIpOyBjb25zdCBlID0gdGhpcy5jYW1UICogdGhpcy5jYW1UICogKDMgLSAyICogdGhpcy5jYW1UKTsgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20ucG9zLCB0aGlzLmNhbVRvLnBvcywgZSk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnRndCwgdGhpcy5jYW1Uby50Z3QsIGUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyAmJiB0aGlzLmNhbU1vZGUgPT09ICdjbG9zZScgJiYgIXRoaXMuY2luZSkgdGhpcy5mcmFtZUJhdHRsZShkdCk7XG4gICAgdGhpcy5uZWNyby51cGRhdGUoZHQpO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnR3ZWVucy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCB3ID0gdGhpcy50d2VlbnNbaV07IHcudCArPSBkdDsgY29uc3QgdSA9IE1hdGgubWluKDEsIHcudCAvIHcuZHVyKTsgdy5mbih1KTsgaWYgKHUgPj0gMSkgeyB0aGlzLnR3ZWVucy5zcGxpY2UoaSwgMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgICBmb3IgKGNvbnN0IHYgb2YgdGhpcy51bml0VmlzLnZhbHVlcygpKSB2LnVwZGF0ZShkdCk7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LnVwZGF0ZShkdCk7IH0pO1xuXG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlO1xuICAgIGlmICgodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nIHx8IHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSAmJiBiKSB7XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nKSB7IHRoaXMuc3RhcnRTdGVwQXQgLT0gZHQ7IGlmICh0aGlzLnN0YXJ0U3RlcEF0IDw9IDApIHsgdGhpcy5waGFzZSA9ICdiYXR0bGUnOyB0aGlzLnVpLnJlbmRlcigpOyB9IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJykge1xuICAgICAgICB0aGlzLmFjYyArPSBkdCAqIHRoaXMudGltZVNjYWxlO1xuICAgICAgICB3aGlsZSAodGhpcy5hY2MgPj0gMSAvIDMwICYmIGIud2lubmVyIDwgMCkgeyBiLnN0ZXAoMSAvIDMwKTsgdGhpcy5hY2MgLT0gMSAvIDMwOyB0aGlzLmFwcGx5RXZlbnRzKGIuZHJhaW4oKSk7IH1cbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoIXRoaXMuY2luZSAmJiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgfHwgZi50ZWFtID09PSAxKSkgeyB2LmhvbGRlci5wb3NpdGlvbi54ID0gZi54OyB2LmhvbGRlci5wb3NpdGlvbi56ID0gZi56OyBpZiAoZi5hbGl2ZSB8fCB0cnVlKSB2LmhvbGRlci5yb3RhdGlvbi55ID0gZi55YXc7IH1cbiAgICAgICAgaWYgKGYuYWxpdmUpIHsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCk7IGlmIChmLm1heE1hbmEpIHYuc2V0TWFuYShmLm1hbmEgLyBmLm1heE1hbmEpOyB9XG4gICAgICAgIGVsc2Ugdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoZi5zdGF0ZSAhPT0gJ2F0dGFjaycgJiYgZi5hbGl2ZSkgeyBjb25zdCB3YW50ID0gZi5zdGF0ZSA9PT0gJ3J1bicgPyAncnVuJyA6ICdpZGxlJzsgaWYgKHRoaXMubGFzdFN0YXRlLmdldChmLmlkKSAhPT0gd2FudCB8fCAodi5zdGF0ZSAhPT0gd2FudCAmJiB2LnN0YXRlICE9PSAnc3Bhd24nKSkgeyBpZiAodi5zdGF0ZSAhPT0gJ3NwYXduJykgeyB2LnBsYXkod2FudCBhcyBhbnkpOyB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgd2FudCk7IH0gfSB9XG4gICAgICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsICdhdHRhY2snKTtcbiAgICAgIH1cbiAgICAgIGlmIChiLndpbm5lciA+PSAwICYmICF0aGlzLmhhbmRsZWQpIHsgdGhpcy5oYW5kbGVkID0gdHJ1ZTsgdGhpcy5yZXN1bHRBdCA9IDEuNDsgfVxuICAgICAgaWYgKHRoaXMucmVzdWx0QXQgPiAwKSB7IHRoaXMucmVzdWx0QXQgLT0gZHQ7IGlmICh0aGlzLnJlc3VsdEF0IDw9IDApIHRoaXMuaGFuZGxlUmVzdWx0KCk7IH1cbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuYXJyb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBhID0gdGhpcy5hcnJvd3NbaV07IGEudCArPSBkdCAqIHRoaXMudGltZVNjYWxlOyBjb25zdCB1ID0gTWF0aC5taW4oMSwgYS50IC8gYS5kdXIpO1xuICAgICAgY29uc3QgcHggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUsIHB6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1LCBweSA9IDAuNzUgKyBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjkgLSB1ICogMC4yNTtcbiAgICAgIGNvbnN0IHUyID0gTWF0aC5taW4oMSwgdSArIDAuMDMpLCBxeCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdTIsIHF6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1MiwgcXkgPSAwLjc1ICsgTWF0aC5zaW4odTIgKiBNYXRoLlBJKSAqIDAuOSAtIHUyICogMC4yNTtcbiAgICAgIGEubWVzaC5wb3NpdGlvbi5zZXQocHgsIHB5LCBweik7IGEubWVzaC5sb29rQXQobmV3IEJBQllMT04uVmVjdG9yMyhxeCwgcXksIHF6KSk7XG4gICAgICBpZiAodSA+PSAxKSB7IGEubWVzaC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5hcnJvd01lc2gucHVzaChhLm1lc2gpOyB0aGlzLmFycm93cy5zcGxpY2UoaSwgMSk7IH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVJlc3VsdCgpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBzID0gdGhpcy5zO1xuICAgIHRoaXMuZW5kQmF0dGxlUGVyZigpO1xuICAgIHRoaXMubGFzdEJhdHRsZSA9IGB3YXZlICR7cy53YXZlfSBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fTogJHtiLndpbm5lciA9PT0gMCA/ICdXT04nIDogJ0xPU1QnfSBpbiAke2IudGltZS50b0ZpeGVkKDEpfXMsICR7Yi5jb3VudCgwKX0gb2YgeW91cnMgYW5kICR7Yi5jb3VudCgxKX0gZW5lbWllcyBsZWZ0YDtcbiAgICBpZiAoYi53aW5uZXIgPT09IDApIHtcbiAgICAgIHRoaXMucGxheVJlc3VsdCgnd2luJywgKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBhcm15IGlzIHJhaXNlZCBhZ2FpbiwgdGhlbiB0aGUgbmV4dCB3YXZlIC8gdGhlIGRyYWZ0XG4gICAgICAgIHRoaXMuY2luZSA9IGZhbHNlO1xuICAgICAgICBpZiAoYWR2YW5jZVdhdmUocykpIHtcbiAgICAgICAgICB0aGlzLnBoYXNlID0gJ3dvbic7IGNsZWFyUnVuKCk7XG4gICAgICAgICAgdHJ5IHsgdGhpcy5yZXdhcmQgPSByZWNvcmRDbGVhckFuZFNhdmUoY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lIGFzIGFueSk7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2F2ZS1jaGFuZ2VkJykpOyB9IGNhdGNoIHsgdGhpcy5yZXdhcmQgPSBudWxsOyB9XG4gICAgICAgICAgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZHJhZnQgPSBkcmFmdE9wdGlvbnMocyk7IHRoaXMucGhhc2UgPSAnZHJhZnQnOyB0aGlzLnBlcnNpc3RSdW4oKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmYWlsV2F2ZShzKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy51aS5wdWxzZUhlYXJ0cygpOyAgICAgICAgICAgICAgICAgICAvLyB0aGUgaGVhcnQgaXMgbG9zdCB0aGUgbW9tZW50IGhlIGlzIGhpdFxuICAgICAgaWYgKHMuc3RhdHVzID09PSAnbG9zdCcpIHRoaXMucGxheVJlc3VsdCgnZmluYWwnLCAoKSA9PiB7IHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnBoYXNlID0gJ2xvc3QnOyBjbGVhclJ1bigpOyB0aGlzLnVpLnJlbmRlcigpOyB9KTtcbiAgICAgIGVsc2UgdGhpcy5wbGF5UmVzdWx0KCdsb3NzJywgKCkgPT4geyB0aGlzLnRvYXN0KCdZb3VyIGFybXkgZmVsbC4gLTEgaGVhcnQsICsxIGNhcmQsIHNhbWUgd2F2ZS4gUmVidWlsZCBhIGRpZmZlcmVudCBzdHJhdGVneS4nKTsgdGhpcy50b0J1aWxkKCk7IH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gcmVzdWx0IGN1dHNjZW5lcyAocGxhbiBzZWN0aW9ucyAxOS0yMik6IHRoZSBOZWNyb21hbmNlciB0YWtlcyB0aGUgaGl0LCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUsIHJhaXNlcyB0aGUgZmFsbGVuXG4gIHByaXZhdGUgcGxheVJlc3VsdChraW5kOiAnd2luJyB8ICdsb3NzJyB8ICdmaW5hbCcsIGRvbmU6ICgpID0+IHZvaWQpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBuID0gdGhpcy5uZWNybzsgdGhpcy5jaW5lID0gdHJ1ZTsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7XG4gICAgY29uc3QgaG9tZSA9ICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBldmVyeSBmYWxsZW4gYWxseSBpcyBwdWxsZWQgYmFjayB0byBpdHMgZ3JpZCB0aWxlIGFuZCBzdGFuZHMgdXBcbiAgICAgIG4uY2FzdCgpOyBhdWRpby5wbGF5KCdyZXN1cnJlY3QnKTsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpOyB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMC44NSwgMC41LCAxLCAwLjldLCBbMC41LCAwLjIsIDEsIDAuN10sIDMwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDApIGNvbnRpbnVlOyBjb25zdCB1aWQgPSB0aGlzLmZVbml0LmdldChmLmlkKSwgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1aWQpLCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF1IHx8ICF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyh1LmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoIWYuYWxpdmUpIHsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLmJ1cnN0KHgwLCB6MCwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxOCk7IHRoaXMuZnhSaW5nKHgwLCB6MCwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zNSwgMSksIDAuMywgMS42LCAwLjcpOyB9XG4gICAgICAgIHRoaXMudHdlZW4oMS4wLCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuNSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LmhvbGRlci5yb3RhdGlvbi55ICs9IChNYXRoLlBJIC8gMiAtIHYuaG9sZGVyLnJvdGF0aW9uLnkpICogTWF0aC5taW4oMSwgdCAqIDAuNSArIDAuMSk7IH0sXG4gICAgICAgICAgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC43NSwgMC40LCAxLCAwLjldLCBbMC40LCAwLjE1LCAwLjksIDAuN10sIDEwKTsgfSk7XG4gICAgICB9XG4gICAgfTtcbiAgICBpZiAoa2luZCA9PT0gJ3dpbicpIHsgbi5jYXN0KCk7IGF1ZGlvLnBsYXkoJ3ZpY3RvcnknKTsgdGhpcy5sYXRlcigwLjI1LCBob21lKTsgdGhpcy5sYXRlcigyLjAsIGRvbmUpOyByZXR1cm47IH1cbiAgICBuLmh1cnQoKTsgYXVkaW8ucGxheSgnaGVhcnRMb3N0Jyk7IHRoaXMubGF0ZXIoMC4xNSwgKCkgPT4geyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjMsIDAuMywgMC45XSwgWzAuOCwgMC4xLCAwLjIsIDAuNl0sIDE2KTsgfSk7XG4gICAgaWYgKGtpbmQgPT09ICdmaW5hbCcpIHsgdGhpcy5sYXRlcigwLjYsICgpID0+IHsgbi5kZWZlYXQoKTsgYXVkaW8ucGxheSgnZGVmZWF0Jyk7IH0pOyB0aGlzLmxhdGVyKDIuNiwgZG9uZSk7IHJldHVybjsgfVxuICAgIHRoaXMubGF0ZXIoMS4wLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwdWxzaW9uIHNob2Nrd2F2ZTogc3Vydml2b3JzIGFyZSBmbHVuZyBiYWNrIHRvIHdoZXJlIHRoZXkgc3RhcnRlZCBhbmQgaGVhbCB0byBmdWxsXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgnc2hvY2t3YXZlJyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTtcbiAgICAgIHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDAuODUsIDAuNTUsIDEpLCAwLjYsIDMwLCAxLjEpOyB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC40LCAyMiwgMC44KTtcbiAgICAgIHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjg1LCAxLCAwLjldLCBbMC43LCAwLjQsIDEsIDAuN10sIDQwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDEgfHwgIWYuYWxpdmUpIGNvbnRpbnVlOyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSBjZWxsUG9zKDEsIGYuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnB1bHNlKCk7XG4gICAgICAgIHRoaXMudHdlZW4oMC45LCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuOSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LnNldEhwKGYuaHAgLyBmLm1heEhwICsgKDEgLSBmLmhwIC8gZi5tYXhIcCkgKiB0KTsgfSwgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdi5zZXRIcCgxKTsgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5sYXRlcigyLjMsIGhvbWUpOyB0aGlzLmxhdGVyKDMuNywgZG9uZSk7XG4gIH1cbiAgcGlja0RyYWZ0KGlkeDogbnVtYmVyKSB7IGlmICghdGhpcy5kcmFmdCkgcmV0dXJuOyB0YWtlRHJhZnQodGhpcy5zLCB0aGlzLmRyYWZ0LCBpZHgpOyB0aGlzLmRyYWZ0ID0gbnVsbDsgbm9ybWFsRHJhdyh0aGlzLnMpOyB0aGlzLnRvQnVpbGQoKTsgfVxuICBwcml2YXRlIHRvQnVpbGQoKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMubmVjcm8ucmV2aXZlKCk7IHRoaXMuZmx1c2hUd2VlbnMoKTtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgeyAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVzdXJyZWN0aW9uOiBldmVyeW9uZSByaXNlcyBhZ2FpbiBhdCBmdWxsIGhlYWx0aFxuICAgICAgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LmhvbGRlci5zZXRFbmFibGVkKHRydWUpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7XG4gICAgICB0aGlzLmxhdGVyKDEuMSwgKCkgPT4gdi5wbGF5KCdpZGxlJykpO1xuICAgIH1cbiAgICB0aGlzLnBoYXNlID0gJ2J1aWxkJzsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyAgICAgICAgICAvLyBVSSBmaXJzdDogdGhlIGNhbWVyYSBtdXN0IG1lYXN1cmUgdGhlIGhhbmQgYW5kIGJ1dHRvbnMgd2hpbGUgdGhleSBhcmUgdmlzaWJsZVxuICAgIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJ1aWxkLCAxLjgpO1xuICB9XG4gIHNldFNwZWVkKGs6IG51bWJlcikgeyB0aGlzLnRpbWVTY2FsZSA9IGs7IHRoaXMudWkucmVuZGVyKCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBoZWxwZXJzXG4gIGFwcGx5QmFsYW5jZUNoYW5nZSgpIHsgdGhpcy51bml0VmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOyBpZiAodSkgdi5zZXRTdGFyKHUuc3Rhcik7IH0pOyB9XG4gIHRlc3RPZGRzKG4gPSAyMDApIHtcbiAgICBjb25zdCBzbG90cyA9IHRoaXMucy51bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVtaWVzID0gZW5lbXlXYXZlKHRoaXMucy53YXZlLCB0aGlzLnNlZWQpOyBsZXQgd2luID0gMCwgdCA9IDA7XG4gICAgY29uc3QgbHY6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fSwgc3YgPSBsb2FkU2F2ZSgpLnNvdWxzOyBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoc3YpKSBsdltrXSA9IChzdiBhcyBhbnkpW2tdLmxldmVsO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7IGNvbnN0IHIgPSBzaW11bGF0ZShzbG90cywgZW5lbWllcywgNTAwMCArIGksIDEzMCwgbHYsIGVuZW15UG93ZXIoKSk7IGlmIChyLndpbm5lciA9PT0gMCkgd2luKys7IHQgKz0gci50aW1lOyB9XG4gICAgcmV0dXJuIHsgd2luOiBNYXRoLnJvdW5kKCh3aW4gLyBuKSAqIDEwMCksIGF2Z1RpbWU6ICsodCAvIG4pLnRvRml4ZWQoMSksIG4gfTtcbiAgfVxuICBhZGRDYXJkKHNvdWw6IFNvdWxJZCkgeyB0aGlzLnMuaGFuZC5wdXNoKHNvdWwpOyB0aGlzLnMuc3RhdHMuZHJhd24rKzsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICBhZGREb21pbmlvbihuOiBudW1iZXIpIHsgdGhpcy5zLmNhcCArPSBuOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIHJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIGVuID0gZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKTtcbiAgICByZXR1cm4gW2BzdGFnZSAke2N1cnJlbnRTdGFnZUlkfS8ke2RpZmZpY3VsdHlOYW1lfSAgc2VlZCAke3RoaXMuc2VlZH0gIHdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX0gIGhlYXJ0cyAke3MuaGVhcnRzfSAgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9ICBwaGFzZSAke3RoaXMucGhhc2V9ICBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fWAsXG4gICAgICBgaGFuZDogJHtzLmhhbmQuam9pbignLCAnKSB8fCAnKGVtcHR5KSd9YCwgYGFybXk6ICR7cy51bml0cy5tYXAoKHUpID0+IGAke3Uuc291bH0ke3Uuc3Rhcn1AJHt1LmNlbGx9YCkuam9pbignICcpIHx8ICcobm9uZSknfWAsIGBlbmVteTogJHtlbi5tYXAoKGUpID0+IGUuc291bCArIGUuc3Rhcikuam9pbignICcpfWAsXG4gICAgICBgZGlmZmljdWx0eTogJHtkaWZmaWN1bHR5TmFtZX0gIG1lcmdlLWZyb20taGFuZDogJHtzLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJ30gIHN3YXAgdXNlZDogJHtzLmRpc2NhcmRVc2VkfWAsIGBsYXN0IHRhcDogJHt0aGlzLmxhc3RUYXBJbmZvfWAsIGBzY3JlZW46ICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSBkcHIgJHt3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpb31gLCBgbGFzdCBiYXR0bGU6ICR7dGhpcy5sYXN0QmF0dGxlIHx8ICctJ31gLCBgbG9nIHRhaWw6YCwgLi4ucy5sb2cuc2xpY2UoLTgpLCBgYmFsYW5jZTogJHtKU09OLnN0cmluZ2lmeSh7IHN0YXI6IEJBTEFOQ0Uuc3Rhciwgc3RhdHM6IEJBTEFOQ0Uuc3RhdHMgfSl9YF0uam9pbignXFxuJyk7XG4gIH1cbiAgcmVzZXRCYWxhbmNlQWxsKCkgeyByZXNldEJhbGFuY2UoKTsgdGhpcy5hcHBseUJhbGFuY2VDaGFuZ2UoKTsgfVxuICBnZXQgZGlmZmljdWx0eSgpIHsgcmV0dXJuIGRpZmZpY3VsdHlOYW1lOyB9XG4gIGNoYW5nZURpZmZpY3VsdHkobmFtZTogc3RyaW5nKSB7IHNldERpZmZpY3VsdHkobmFtZSk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudG9hc3QoYERpZmZpY3VsdHk6ICR7bmFtZX0uIEFwcGxpZXMgdG8gdGhlIG5leHQgYmF0dGxlLmApOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZ2FsbGVyeSAoc3RhciBsb29rcylcbiAgZ2FsbGVyeSgpIHtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5hZGQoJ2dhbGxlcnknKTsgdGhpcy5uZWNyby5zZXRFbmFibGVkKGZhbHNlKTsgY29uc3QgdmlzOiBVbml0VmlzdWFsW10gPSBbXTsgbGV0IHRlYW06IDAgfCAxID0gMDtcbiAgICBjb25zdCByZWJ1aWxkID0gKCkgPT4geyB2aXMuZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB2aXMubGVuZ3RoID0gMDsgU09VTFMuZm9yRWFjaCgoc291bCwgaSkgPT4gWzEsIDIsIDNdLmZvckVhY2goKHN0LCBqKSA9PiB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBzb3VsLCB0ZWFtLCBzdCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCgoaSAtIDIuNSkgKiAyLjUsIDAsIChqIC0gMSkgKiAtMi40KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgKiAwLjg1OyB2LnBsYXkoJ2lkbGUnKTsgdmlzLnB1c2godik7IH0pKTsgfTtcbiAgICByZWJ1aWxkKCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLnNldCgwLCA1LjYsIC0xNC41KTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAtMC40KSk7IHRoaXMuY2FtZXJhLmZvdiA9IDAuODU7XG4gICAgKHdpbmRvdyBhcyBhbnkpLl9fZ2FsbGVyeSA9IHsgc2V0VGVhbTogKHQ6IDAgfCAxKSA9PiB7IHRlYW0gPSB0OyByZWJ1aWxkKCk7IH0sIHZpcyB9O1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7IHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBuID0gcGVyZm9ybWFuY2Uubm93KCksIGR0ID0gTWF0aC5taW4oMC4wNSwgKG4gLSBsYXN0KSAvIDEwMDApOyBsYXN0ID0gbjsgdmlzLmZvckVhY2goKHYpID0+IHYudXBkYXRlKGR0KSk7IHRoaXMuc2NlbmUucmVuZGVyKCk7IH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgR2FtZSB9IGZyb20gJy4vZ2FtZS50cyc7XG5cbmNvbnN0IGcgPSBuZXcgR2FtZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fZ2FtZSA9IGc7ICAgICAgICAgICAgICAgICAgICAgICAvLyBoYW5keSBmb3IgZGVidWdnaW5nIGZyb20gdGhlIGJyb3dzZXIgY29uc29sZVxuZy5pbml0KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjJykgYXMgSFRNTENhbnZhc0VsZW1lbnQpXG4gIC50aGVuKCgpID0+IHsgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSBsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7ICh3aW5kb3cgYXMgYW55KS5fX2dhbWVSZWFkeSA9IHRydWU7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ2FtZS1yZWFkeScpKTsgfSlcbiAgLmNhdGNoKChlKSA9PiB7XG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSB7IGwuc3R5bGUuZGlzcGxheSA9ICdmbGV4JzsgbC50ZXh0Q29udGVudCA9ICdFcnJvcjogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IGUpOyB9XG4gICAgY29uc29sZS5lcnJvcihlKTtcbiAgfSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFvQ08sTUFBTSxXQUFvQjtBQUFBLElBQy9CLE9BQU87QUFBQSxNQUNMLFNBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sR0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLE1BQzlHLFFBQVcsRUFBRSxJQUFJLEtBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEtBQU0sT0FBTyxHQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsTUFDOUcsTUFBVyxFQUFFLElBQUksS0FBSyxLQUFLLElBQUksVUFBVSxLQUFLLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxXQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLE1BQU0sT0FBTyxLQUFLLE9BQU8sS0FBSyxNQUFNLEtBQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLElBQ2hIO0FBQUE7QUFBQSxJQUVBLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRyxHQUFLLEdBQUcsR0FBRyxLQUFLLENBQUMsR0FBRyxLQUFLLENBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksRUFBRTtBQUFBLElBQ3RFLFNBQVMsRUFBRSxRQUFRLEdBQUssU0FBUyxNQUFNLFdBQVcsRUFBRTtBQUFBO0FBQUEsSUFFcEQsTUFBTTtBQUFBLE1BQ0osUUFBUSxFQUFFLEtBQUssS0FBSyxXQUFXLElBQUksUUFBUSxFQUFFO0FBQUE7QUFBQSxNQUM3QyxNQUFRLEVBQUUsS0FBSyxLQUFLLFdBQVcsSUFBSSxRQUFRLEVBQUU7QUFBQTtBQUFBLE1BQzdDLFFBQVEsRUFBRSxLQUFLLEtBQUssV0FBVyxJQUFJLFFBQVEsR0FBRztBQUFBO0FBQUEsSUFDaEQ7QUFBQSxJ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STtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLE1BQU0sRUFBRTtBQUFHLFdBQUMsTUFBTSxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQzFNLEtBQUs7QUFBVyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDbkcsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUN0RyxLQUFLO0FBQVksZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLE1BQU0sT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDN0gsS0FBSztBQUFZLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEtBQUssS0FBSyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxLQUFLLEdBQUcsRUFBRTtBQUFHO0FBQUEsUUFDekssS0FBSztBQUFjLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEtBQUssS0FBSyxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLElBQUksS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEtBQU0sR0FB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QyxFQUFFLFNBQVMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBQSxNQUFLLFdBQ3BQLEtBQUssVUFBVSxVQUFVO0FBQUUsY0FBTSxJQUFJLElBQUksTUFBTSxRQUFRLElBQUksT0FBTyxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksSUFBSSxPQUFPLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxLQUFLLENBQUM7QUFBQSxNQUFHLFdBQzFOLEtBQUssVUFBVSxTQUFTO0FBQUUsY0FBTSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUk7QUFBSSxVQUFFLFFBQVEsT0FBTyxPQUFPLE9BQU8sQ0FBQztBQUFHLFVBQUUsU0FBUyxLQUFLLElBQUksS0FBSztBQUFBLE1BQUssV0FDMUgsS0FBSyxVQUFVLFNBQVM7QUFBRSxjQUFNLElBQUksSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLENBQUMsS0FBSyxLQUFLLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSSxPQUFPO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTztBQUFBLE1BQUcsV0FDOUgsS0FBSyxVQUFVLFNBQVM7QUFBRSxVQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxDQUFDLENBQUMsSUFBSTtBQUFNLFVBQUUsU0FBUyxJQUFJO0FBQUEsTUFBTTtBQUM5RyxVQUFJLEtBQUssU0FBUyxHQUFHO0FBQUUsYUFBSyxVQUFVO0FBQUksY0FBTSxJQUFJLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLElBQUksT0FBTyxLQUFLLEVBQUU7QUFBRyxhQUFLLE9BQU8sUUFBUSxPQUFPLEtBQUssT0FBTyxDQUFDO0FBQUEsTUFBRztBQUFBLElBQ2pLO0FB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LEVBQUUsTUFBTSxPQUFPO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEVBQUcsR0FBRSxNQUFNO0FBQUcsY0FBSSxFQUFFLFNBQVMsUUFBUyxPQUFNLEtBQUssVUFBVTtBQUFBLG1CQUFZLEVBQUUsU0FBUyxRQUFTLE9BQU0sS0FBSyxLQUFLO0FBQUEsUUFBRyxXQUNsSyxFQUFFLE1BQU0sU0FBUztBQUFFLGdCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxHQUFJLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGVBQUssV0FBVyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEVBQUUsR0FBRztBQUFHLGdCQUFNLEtBQUssT0FBTztBQUFBLFFBQUcsV0FDN0ksRUFBRSxNQUFNLFNBQVM7QUFBRSxnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksR0FBRztBQUFFLGNBQUUsS0FBSyxPQUFPO0FBQUcsY0FBRSxNQUFNLElBQUk7QUFBRyxjQUFFLFFBQVEsSUFBSTtBQUFHLGtCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGtCQUFNLEtBQUssT0FBTztBQUFHLGlCQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUcsZ0JBQUksRUFBRSxTQUFTLEVBQUcsTUFBSyxNQUFNLEdBQUcsTUFBTTtBQUFFLGtCQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRSxNQUFNLEtBQUssS0FBSyxVQUFVLFNBQVM7QUFBRSxrQkFBRSxPQUFPLFdBQVcsS0FBSztBQUFBLGNBQUc7QUFBQSxZQUFFLENBQUM7QUFBQSxVQUFHO0FBQUEsUUFBRSxXQUN2VyxFQUFFLE1BQU0sUUFBUTtBQUFFLGdCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJ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LENBQUM7QUFBRyxVQUFJLE9BQWM7QUFDdEgsWUFBTSxVQUFVLE1BQU07QUFBRSxZQUFJLFFBQVEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQUcsWUFBSSxTQUFTO0FBQUcsY0FBTSxRQUFRLENBQUMsTUFBTSxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRSxRQUFRLENBQUMsSUFBSSxNQUFNO0FBQUUsZ0JBQU0sSUFBSSxhQUFhLEtBQUssR0FBRyxNQUFNLE1BQU0sRUFBRTtBQUFHLFlBQUUsT0FBTyxTQUFTLEtBQUssSUFBSSxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssSUFBSTtBQUFHLFlBQUUsT0FBTyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQU0sWUFBRSxLQUFLLE1BQU07QUFBRyxjQUFJLEtBQUssQ0FBQztBQUFBLFFBQUcsQ0FBQyxDQUFDO0FBQUEsTUFBRztBQUN0VCxjQUFRO0FBQUcsV0FBSyxPQUFPLFNBQVMsSUFBSSxHQUFHLEtBQUssS0FBSztBQUFHLFdBQUssT0FBTyxVQUFVLElBQUksUUFBUSxRQUFRLEdBQUcsS0FBSyxJQUFJLENBQUM7QUFBRyxXQUFLLE9BQU8sTUFBTTtBQUNoSSxNQUFDLE9BQWUsWUFBWSxFQUFFLFNBQVMsQ0FBQyxNQUFhO0FBQUUsZUFBTztBQUFHLGdCQUFRO0FBQUEsTUFBRyxHQUFHLElBQUk7QUFDbkYsVUFBSSxPQUFPLFlBQVksSUFBSTtBQUFHLFdBQUssT0FBTyxjQUFjLE1BQU07QUFBRSxjQUFNLElBQUksWUFBWSxJQUFJLEdBQUcsS0FBSyxLQUFLLElBQUksT0FBTyxJQUFJLFFBQVEsR0FBSTtBQUFHLGVBQU87QUFBRyxZQUFJLFFBQVEsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLENBQUM7QUFBRyxhQUFLLE1BQU0sT0FBTztBQUFBLE1BQUcsQ0FBQztBQUFBLElBQ3pNO0FBQUEsRUFDRjs7O0FDbmZBLE1BQU0sSUFBSSxJQUFJLEtBQUs7QUFDbkIsRUFBQyxPQUFlLFNBQVM7QUFDekIsSUFBRSxLQUFLLFNBQVMsZUFBZSxHQUFHLENBQXNCLEVBQ3JELEtBQUssTUFBTTtBQUFFLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksRUFBRyxHQUFFLE1BQU0sVUFBVTtBQUFRLElBQUMsT0FBZSxjQUFjO0FBQU0sV0FBTyxjQUFjLElBQUksTUFBTSxrQkFBa0IsQ0FBQztBQUFBLEVBQUcsQ0FBQyxFQUN0TCxNQUFNLENBQUMsTUFBTTtBQUNaLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksR0FBRztBQUFFLFFBQUUsTUFBTSxVQUFVO0FBQVEsUUFBRSxjQUFjLGFBQWEsS0FBSyxFQUFFLFVBQVUsRUFBRSxVQUFVO0FBQUEsSUFBSTtBQUMvSSxZQUFRLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLENBQUM7IiwKICAibmFtZXMiOiBbImVuZW15UG93ZXIiLCAidGciLCAiZyIsICJnIiwgIktFWSIsICJWRVJTSU9OIiwgInN0YWdlV2F2ZXMiLCAiZHJhdyIsICJnIiwgImciXQp9Cg==
