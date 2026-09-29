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
  function makeRng(seed) {
    let a = seed >>> 0;
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
      pick: (items) => items[Math.floor(next() * items.length)]
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
    constructor(players, enemies, seed = 1) {
      __publicField(this, "time", 0);
      __publicField(this, "fighters", []);
      __publicField(this, "events", []);
      __publicField(this, "winner", -1);
      __publicField(this, "rng");
      __publicField(this, "pending", []);
      __publicField(this, "nextId", 1);
      __publicField(this, "flip", false);
      this.rng = makeRng(seed);
      for (const p of players) this.add(0, p.soul, p.star, p.cell);
      const cells = enemyCells(enemies);
      enemies.forEach((e, i) => this.add(1, e.soul, e.star, cells[i]));
    }
    add(team, soul, star, cell) {
      var _a, _b;
      const B = BALANCE, st = B.stats[soul], p = cellPos(team, cell);
      const hp = st.hp * B.star.hp[star - 1];
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
        dmg: st.dmg * B.star.dmg[star - 1],
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

  // core/save.ts
  var DECK_SIZE = 6;
  var KEY = "necro-save";
  var VERSION = 1;
  var DIFFICULTIES = ["easy", "normal", "hard", "nightmare"];
  function defaultSave() {
    const souls = {};
    for (const id of SOULS) souls[id] = { level: 1, copies: 0 };
    return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls, settings: { music: true, sfx: true }, difficulty: "normal" };
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

  // game/ui.ts
  var ICON = { warrior: "\u{1F480}", archer: "\u{1F3F9}", goblin: "\u{1F5E1}\uFE0F", knight: "\u{1F6E1}\uFE0F", ogre: "\u{1F528}", barbarian: "\u{1FA93}" };
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
      $("hearts").textContent = "\u2764\uFE0F".repeat(s.hearts) + "\u{1F5A4}".repeat(Math.max(0, 3 - s.hearts));
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
        el.innerHTML = `<div class="cost">${cost(soul, 1)}</div><div class="ic">${ICON[soul]}</div><div class="nm">${SOUL_NAME[soul]}</div><div class="cs">${tag}</div>`;
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
        ov.innerHTML = `<div class="box"><h2>Victory Draft</h2><div class="sub">Wave cleared. Dominion is now ${s.cap}. Keep one:</div><div class="row">${g2.draft.map((soul, i) => `<div class="card big" data-i="${i}"><div class="cost">${cost(soul, 1)}</div><div class="ic">${ICON[soul]}</div><div class="nm">${SOUL_NAME[soul]}</div><div class="role">${ROLE_TEXT[soul]}</div></div>`).join("")}</div></div>`;
        ov.querySelectorAll(".card").forEach((c) => c.onclick = () => g2.pickDraft(+c.dataset.i));
      } else if (ph === "won" || ph === "lost") {
        ov.className = "show";
        ov.innerHTML = `<div class="box"><h2>${ph === "won" ? "Stage cleared!" : "Stage lost"}</h2><div class="sub">${g2.lastBattle}</div><div class="row"><button id="again" class="go">${ph === "won" ? "Play again" : "Try again"}</button><button id="toHome" class="blue">Home</button></div></div>`;
        $("again").onclick = () => g2.newRun();
        $("toHome").onclick = () => window.dispatchEvent(new Event("necro-go-home"));
      }
      this.renderDebugLive();
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
      if (f) f.textContent = `${this.g.engine.getFps().toFixed(0)} fps \u2022 ${this.g.phase}`;
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
      this.startStage(this.seed);
      let last = performance.now();
      this.engine.runRenderLoop(() => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1e3);
        last = now;
        if (!this.active) return;
        if (!this.frozen) this.frame(dt);
        scene.render();
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
      this.setCam(this.poses().build);
      this.syncBuild();
      this.ui.render();
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
      this.sel = null;
      this.swapMode = false;
      this.attempt++;
      this.handled = false;
      this.resultAt = -1;
      const s = this.s, units = s.units.slice();
      this.battle = new Battle(units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell })), enemyWave(s.wave, this.seed), this.seed * 131 + s.wave * 17 + this.attempt);
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
      this.lastBattle = `wave ${s.wave} attempt ${this.attempt}: ${b.winner === 0 ? "WON" : "LOST"} in ${b.time.toFixed(1)}s, ${b.count(0)} of yours and ${b.count(1)} enemies left`;
      if (b.winner === 0) {
        this.playResult("win", () => {
          this.cine = false;
          if (advanceWave(s)) {
            this.phase = "won";
            this.ui.render();
            return;
          }
          this.draft = draftOptions(s);
          this.phase = "draft";
          this.ui.render();
        });
      } else {
        failWave(s);
        this.ui.render();
        this.ui.pulseHearts();
        if (s.status === "lost") this.playResult("final", () => {
          this.cine = false;
          this.phase = "lost";
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
      this.tweenCam(this.poses().build, 1.8);
      this.syncBuild();
      this.ui.render();
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2NvcmUvYmF0dGxlLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9zYXZlLnRzIiwgIi4uL2dhbWUvbmVjcm9tYW5jZXIudHMiLCAiLi4vZ2FtZS9hdWRpby50cyIsICIuLi9nYW1lL3Zpc3VhbHMudHMiLCAiLi4vZ2FtZS91aS50cyIsICIuLi9nYW1lL2dhbWUudHMiLCAiLi4vZ2FtZS9tYWluLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBTSU5HTEUgU09VUkNFIE9GIFRSVVRIIGZvciBldmVyeSBudW1iZXIgdGhhdCBhZmZlY3RzIGNvbWJhdC5cbi8vIFRoZSBkZWJ1ZyBwYW5lbCBlZGl0cyBCQUxBTkNFIGxpdmU7IGByZXNldEJhbGFuY2UoKWAgcmVzdG9yZXMgdGhlc2UgZGVmYXVsdHMuXG4vLyBBbGwgdmFsdWVzIGFyZSBmaXJzdC1wYXNzIGd1ZXNzZXMgbWVhbnQgdG8gYmUgdHVuZWQgYnkgcGxheWluZyBhbmQgYnkgYG5vZGUgc2ltL2NhbXBhaWduLnRzYC5cblxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXRTdGF0cyB7XG4gIGhwOiBudW1iZXI7ICAgICAgICAgLy8gMS1zdGFyIGhpdCBwb2ludHNcbiAgZG1nOiBudW1iZXI7ICAgICAgICAvLyAxLXN0YXIgZGFtYWdlIHBlciBoaXQgKHBlciBhcnJvdyBmb3IgdGhlIEFyY2hlcilcbiAgaW50ZXJ2YWw6IG51bWJlcjsgICAvLyBzZWNvbmRzIGJldHdlZW4gYXR0YWNrc1xuICByYW5nZTogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyAoY2VudHJlIHRvIGNlbnRyZSlcbiAgc3BlZWQ6IG51bWJlcjsgICAgICAvLyBtZXRyZXMgcGVyIHNlY29uZFxuICBzaXplOiBudW1iZXI7ICAgICAgIC8vIGJvZHkgcmFkaXVzLCB1c2VkIGZvciBzcGFjaW5nIGFuZCB2aXN1YWxzXG4gIGFuaW1MZW46IG51bWJlcjsgICAgLy8gc2Vjb25kczogbGVuZ3RoIG9mIHRoaXMgdW5pdCdzIGF0dGFjayBjbGlwIGF0IG5vcm1hbCBzcGVlZFxuICBoaXRGcmFjOiBudW1iZXI7ICAgIC8vIDAtMTogaG93IGZhciBpbnRvIHRoZSBjbGlwIHRoZSBibG93IGxhbmRzIC8gdGhlIGFycm93IGlzIHJlbGVhc2VkXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQmFsYW5jZSB7XG4gIHN0YXRzOiBSZWNvcmQ8U291bElkLCBVbml0U3RhdHM+O1xuICBzdGFyOiB7XG4gICAgaHA6IG51bWJlcltdOyAgICAgLy8gbXVsdGlwbGllciBhdCAxLCAyLCAzIHN0YXJzXG4gICAgZG1nOiBudW1iZXJbXTtcbiAgICBzY2FsZTogbnVtYmVyW107ICAvLyB2aXN1YWwgc2l6ZVxuICB9O1xuICBwaGFsYW54OiB7IHJhZGl1czogbnVtYmVyOyBwZXJBbGx5OiBudW1iZXI7IG1heFN0YWNrczogbnVtYmVyIH07ICAgICAgICAgIC8vIFNrZWxldG9uIFdhcnJpb3JcbiAgbWFuYTogUGFydGlhbDxSZWNvcmQ8U291bElkLCB7IG1heDogbnVtYmVyOyBwZXJBdHRhY2s6IG51bWJlcjsgcGVySGl0OiBudW1iZXIgfT4+OyAvLyB1bml0cyBXSVRIIGEgc2tpbGw7IHRoZSByZXN0IGFyZSBwYXNzaXZlLW9ubHlcbiAgdm9sbGV5OiB7IHRhcmdldHM6IG51bWJlcjsgcHJvamVjdGlsZVNwZWVkOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAvLyBTa2VsZXRvbiBBcmNoZXIgc2tpbGw6IFNwbGl0IEFycm93XG4gIG9wcG9ydHVuaXN0OiB7IGJvbnVzOiBudW1iZXI7IHNlZWtSYWRpdXM6IG51bWJlcjsgd291bmRlZFdlaWdodDogbnVtYmVyIH07IC8vIEdvYmxpblxuICB0YXVudDogeyBkdXJhdGlvbjogbnVtYmVyOyByYWRpdXM6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEtuaWdodCBza2lsbFxuICBzbWFzaDogeyBtdWx0OiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE9ncmUgc2tpbGxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiBudW1iZXI7IG1heFN0YWNrczogbnVtYmVyOyByZXNldEFmdGVyOiBudW1iZXIgfTsgICAgICAvLyBCYXJiYXJpYW5cbiAgLyoqIFBMQUNFSE9MREVSIHBlcm1hbmVudC1sZXZlbCBncm93dGggKHBlciBsZXZlbCBhYm92ZSAxKS4gU2hvd24gb24gdGhlIFNvdWxzIHBhZ2U7IE5PVCBhcHBsaWVkIGluIGJhdHRsZXMgeWV0LiAqL1xuICBsZXZlbDogeyBocDogbnVtYmVyOyBkbWc6IG51bWJlcjsgY29waWVzVG9MZXZlbDogbnVtYmVyW10gfTtcbiAgc2ltOiB7IHNlcGFyYXRpb246IG51bWJlcjsgaGl0RnJhY3Rpb246IG51bWJlcjsgdGltZUxpbWl0OiBudW1iZXI7IHJldGFyZ2V0RXZlcnk6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVFM6IEJhbGFuY2UgPSB7XG4gIHN0YXRzOiB7XG4gICAgd2FycmlvcjogICB7IGhwOiA2MCwgIGRtZzogOCwgIGludGVydmFsOiAwLjksIHJhbmdlOiAwLjg1LCBzcGVlZDogMS40LCBzaXplOiAwLjI4LCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNDcgfSxcbiAgICBhcmNoZXI6ICAgIHsgaHA6IDQwLCAgZG1nOiA3LCAgaW50ZXJ2YWw6IDEuNywgcmFuZ2U6IDUuMCwgIHNwZWVkOiAxLjEsIHNpemU6IDAuMjYsIGFuaW1MZW46IDEuNSwgaGl0RnJhYzogMC43OCB9LFxuICAgIGdvYmxpbjogICAgeyBocDogNDUsICBkbWc6IDksICBpbnRlcnZhbDogMC44LCByYW5nZTogMC44LCAgc3BlZWQ6IDEuNywgc2l6ZTogMC4yNCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgICBrbmlnaHQ6ICAgIHsgaHA6IDEzMCwgZG1nOiA5LCAgaW50ZXJ2YWw6IDEuMSwgcmFuZ2U6IDAuOSwgIHNwZWVkOiAxLjAsIHNpemU6IDAuMzIsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAgb2dyZTogICAgICB7IGhwOiAxNzAsIGRtZzogMTYsIGludGVydmFsOiAxLjksIHJhbmdlOiAxLjA1LCBzcGVlZDogMC44LCBzaXplOiAwLjQyLCBhbmltTGVuOiAxLjIsIGhpdEZyYWM6IDAuNTUgfSxcbiAgICBiYXJiYXJpYW46IHsgaHA6IDc1LCAgZG1nOiA4LCAgaW50ZXJ2YWw6IDAuOTUsIHJhbmdlOiAwLjksIHNwZWVkOiAxLjUsIHNpemU6IDAuMzAsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gIH0sXG4gIC8vIFwiYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHlcIjogSFAgZ3Jvd3MgZmFzdGVyIHRoYW4gZGFtYWdlIHBlciBzdGFyXG4gIHN0YXI6IHsgaHA6IFsxLCAyLjAsIDMuMl0sIGRtZzogWzEsIDEuNSwgMi4wXSwgc2NhbGU6IFsxLCAxLjEyLCAxLjI1XSB9LFxuICBwaGFsYW54OiB7IHJhZGl1czogMi4wLCBwZXJBbGx5OiAwLjA4LCBtYXhTdGFja3M6IDMgfSxcbiAgLy8gbWFuYSBmaWxscyBmYXN0OiBhIGJhc2ljIGF0dGFjayBnaXZlcyBwZXJBdHRhY2ssIHRha2luZyBhIGhpdCBnaXZlcyBwZXJIaXQ7IGEgZnVsbCBiYXIgZmlyZXMgdGhlIHNraWxsIG9uIHRoZSBuZXh0IGF0dGFjaywgdGhlbiByZXNldHNcbiAgbWFuYToge1xuICAgIGFyY2hlcjogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTcGxpdCBBcnJvdyBhYm91dCBldmVyeSAzcmQgc2hvdFxuICAgIG9ncmU6ICAgeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTbWFzaCBhYm91dCBldmVyeSAzcmQgc3dpbmdcbiAgICBrbmlnaHQ6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMjUsIHBlckhpdDogMTIgfSwgICAgLy8gVGF1bnQgZXZlcnkgfjQgc3dpbmdzLCBzb29uZXIgd2hlbiBoZSBpcyBiZWluZyBoaXRcbiAgfSxcbiAgdm9sbGV5OiB7IHRhcmdldHM6IDMsIHByb2plY3RpbGVTcGVlZDogMTQgfSxcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IDAuNSwgc2Vla1JhZGl1czogNC4wLCB3b3VuZGVkV2VpZ2h0OiAxLjUgfSxcbiAgdGF1bnQ6IHsgZHVyYXRpb246IDMsIHJhZGl1czogNC41IH0sXG4gIHNtYXNoOiB7IG11bHQ6IDIuMCwgcmFkaXVzOiAxLjYgfSxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiAwLjEyLCBtYXhTdGFja3M6IDgsIHJlc2V0QWZ0ZXI6IDAuNiB9LFxuICBsZXZlbDogeyBocDogMC4wOCwgZG1nOiAwLjA4LCBjb3BpZXNUb0xldmVsOiBbNSwgMTAsIDIwLCA0MCwgODAsIDEyMCwgMjAwLCAzMDAsIDUwMF0gfSxcbiAgc2ltOiB7IHNlcGFyYXRpb246IDAuNiwgaGl0RnJhY3Rpb246IDAuNDcsIHRpbWVMaW1pdDogMTIwLCByZXRhcmdldEV2ZXJ5OiAwLjUgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBCQUxBTkNFOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRCYWxhbmNlKCk6IHZvaWQge1xuICBjb25zdCBmcmVzaDogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGZyZXNoKSBhcyAoa2V5b2YgQmFsYW5jZSlbXSkgKEJBTEFOQ0UgYXMgYW55KVtrXSA9IChmcmVzaCBhcyBhbnkpW2tdO1xufVxuXG5leHBvcnQgY29uc3QgUk9MRV9URVhUOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnQ2hlYXAgYW5kIGZhc3QuIFRvdWdoZXIgbmVhciBvdGhlciBXYXJyaW9ycy4nLFxuICBhcmNoZXI6ICdGcmFnaWxlLiBTa2lsbDogU3BsaXQgQXJyb3cgaGl0cyAzIGRpZmZlcmVudCBlbmVtaWVzLicsXG4gIGdvYmxpbjogJ0Zhc3QuIEhpdHMgaGFyZGVyIG9uIGVuZW1pZXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLicsXG4gIGtuaWdodDogJ1RhbmsuIFNraWxsOiBUYXVudCBwdWxscyBlbmVtaWVzIG9udG8gaGltLicsXG4gIG9ncmU6ICdTbG93LCBodWdlIGRhbWFnZS4gU2tpbGw6IFNtYXNoLCBhIGJpZyBhcmVhIHNsYW0uJyxcbiAgYmFyYmFyaWFuOiAnU3dpbmdzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgaGl0LicsXG59O1xuXG5leHBvcnQgY29uc3QgU09VTF9OQU1FOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnU2tlbGV0b24gV2FycmlvcicsIGFyY2hlcjogJ1NrZWxldG9uIEFyY2hlcicsIGdvYmxpbjogJ0dvYmxpbicsXG4gIGtuaWdodDogJ0tuaWdodCcsIG9ncmU6ICdPZ3JlJywgYmFyYmFyaWFuOiAnQmFyYmFyaWFuJyxcbn07XG5cbi8qKiBBYmlsaXR5IGJsdXJicyBmb3IgdGhlIFNvdWxzIHBhZ2UsIHdpdGggdGhlIGxpdmUgbnVtYmVycyBmaWxsZWQgaW4uICovXG5leHBvcnQgZnVuY3Rpb24gYWJpbGl0eUluZm8oc291bDogU291bElkKTogeyBraW5kOiAnc2tpbGwnIHwgJ3Bhc3NpdmUnOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZyB9IHtcbiAgY29uc3QgQiA9IEJBTEFOQ0UsIHBjdCA9ICh4OiBudW1iZXIpID0+IE1hdGgucm91bmQoeCAqIDEwMCkgKyAnJSc7XG4gIHN3aXRjaCAoc291bCkge1xuICAgIGNhc2UgJ3dhcnJpb3InOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdQaGFsYW54JywgdGV4dDogYFRha2VzICR7cGN0KEIucGhhbGFueC5wZXJBbGx5KX0gbGVzcyBkYW1hZ2UgZm9yIGVhY2ggb3RoZXIgU2tlbGV0b24gV2FycmlvciB3aXRoaW4gJHtCLnBoYWxhbngucmFkaXVzfW0gKHVwIHRvICR7Qi5waGFsYW54Lm1heFN0YWNrc30pLmAgfTtcbiAgICBjYXNlICdnb2JsaW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdPcHBvcnR1bmlzdCcsIHRleHQ6IGBEZWFscyAke3BjdChCLm9wcG9ydHVuaXN0LmJvbnVzKX0gbW9yZSBkYW1hZ2UgdG8gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2UsIGFuZCBwcmVmZXJzIHN1Y2ggdGFyZ2V0cy5gIH07XG4gICAgY2FzZSAnYmFyYmFyaWFuJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnRnJlbnp5JywgdGV4dDogYEF0dGFja3MgJHtwY3QoQi5mcmVuenkucGVyU3dpbmcpfSBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nICh1cCB0byAke0IuZnJlbnp5Lm1heFN0YWNrc30gdGltZXMpLmAgfTtcbiAgICBjYXNlICdhcmNoZXInOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU3BsaXQgQXJyb3cnLCB0ZXh0OiBgQmFzaWMgc2hvdHMgZmlyZSBvbmUgYXJyb3cuIFdoZW4gbWFuYSBpcyBmdWxsLCB0aGUgbmV4dCBzaG90IGZpcmVzIGF0IHVwIHRvICR7Qi52b2xsZXkudGFyZ2V0c30gZGlmZmVyZW50IGVuZW1pZXMuYCB9O1xuICAgIGNhc2UgJ2tuaWdodCc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdUYXVudCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgZW5lbWllcyB3aXRoaW4gJHtCLnRhdW50LnJhZGl1c31tIG11c3QgYXR0YWNrIGhpbSBmb3IgJHtCLnRhdW50LmR1cmF0aW9ufXMuYCB9O1xuICAgIGNhc2UgJ29ncmUnOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU21hc2gnLCB0ZXh0OiBgV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHN3aW5nIGRlYWxzICR7Qi5zbWFzaC5tdWx0fXggZGFtYWdlIGFuZCBoaXRzIGVuZW1pZXMgbmVhciB0aGUgdGFyZ2V0IGZvciA2MCUgYXMgbXVjaC5gIH07XG4gIH1cbn1cbiIsICIvLyBEZXNpZ24gZGF0YSBzdHJhaWdodCBmcm9tIHRoZSBwbGFuIGRvYy4gQW55dGhpbmcgbWFya2VkIFBMQUNFSE9MREVSIGlzIG5vdCBpbiB0aGUgZG9jIHlldC5cblxuZXhwb3J0IHR5cGUgU291bElkID0gJ3dhcnJpb3InIHwgJ2FyY2hlcicgfCAnZ29ibGluJyB8ICdrbmlnaHQnIHwgJ29ncmUnIHwgJ2JhcmJhcmlhbic7XG5cbmV4cG9ydCBjb25zdCBTT1VMUzogU291bElkW10gPSBbJ3dhcnJpb3InLCAnYXJjaGVyJywgJ2dvYmxpbicsICdrbmlnaHQnLCAnb2dyZScsICdiYXJiYXJpYW4nXTtcblxuLyoqIERvbWluaW9uIGNvc3QgcGVyIHN0YXIgbGV2ZWw6IGluZGV4IDAgPSAxIHN0YXIsIDEgPSAyIHN0YXJzLCAyID0gMyBzdGFycyAoMyBzdGFycyBpcyB0aGUgbWF4KS4gKi9cbmV4cG9ydCBjb25zdCBDT1NUOiBSZWNvcmQ8U291bElkLCBudW1iZXJbXT4gPSB7XG4gIHdhcnJpb3I6IFsyLCAzLCA0XSxcbiAgYXJjaGVyOiBbNCwgNiwgOV0sXG4gIGdvYmxpbjogWzMsIDQsIDZdLFxuICBrbmlnaHQ6IFs1LCA3LCAxMF0sXG4gIG9ncmU6IFs3LCAxMCwgMTVdLFxuICBiYXJiYXJpYW46IFs1LCA3LCAxMF0sIC8vIFBMQUNFSE9MREVSOiB0aGUgZG9jIGhhcyBubyBjb3N0IGZvciB0aGUgc2l4dGggU291bCB5ZXRcbn07XG5cbmV4cG9ydCBjb25zdCBNQVhfU1RBUiA9IDM7XG5leHBvcnQgY29uc3QgR1JJRF9DRUxMUyA9IDEyOyAvLyA0IHggM1xuXG4vKiogRG9taW5pb24gY2FwIHBlciB3YXZlIChpbmRleCAwID0gd2F2ZSAxKS4gKi9cbmV4cG9ydCBjb25zdCBDVVJWRVM6IFJlY29yZDxzdHJpbmcsIG51bWJlcltdPiA9IHtcbiAgLy8gTE9DS0VEIChjb25maXJtZWQpOiArNCBmb3Igd2F2ZXMgMi01LCB0aGVuICszIGZvciB3YXZlcyA2LTEwIC0+IDQwXG4gIGRvYzogWzksIDEzLCAxNywgMjEsIDI1LCAyOCwgMzEsIDM0LCAzNywgNDBdLFxuICAvLyBOT1QgVVNFRDogbWlzcmVtZW1iZXJlZCB2YXJpYW50ICgrMyB0aHJvdWdoIHdhdmUgNiwgdGhlbiArMikgdGhhdCBvbmx5IHJlYWNoZXMgMzIuIEtlcHQgZm9yIGNvbXBhcmlzb24gb25seS5cbiAgcmVjYWxsZWQ6IFs5LCAxMiwgMTUsIDE4LCAyMSwgMjQsIDI2LCAyOCwgMzAsIDMyXSxcbn07XG5cbmV4cG9ydCBjb25zdCBIRUFSVFMgPSAzO1xuZXhwb3J0IGNvbnN0IFNUQVJUX0hBTkQgPSA0O1xuZXhwb3J0IGNvbnN0IFdBVkVTID0gMTA7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnVsZXMge1xuICAvKiogRG9taW5pb24gY2FwIHBlciB3YXZlLiAqL1xuICBjdXJ2ZTogbnVtYmVyW107XG4gIC8qKlxuICAgKiAnZGVwbG95ZWRPbmx5Jzogb25seSB0d28gZGVwbG95ZWQgdW5pdHMgb2YgdGhlIHNhbWUgc3RhciBjYW4gbWVyZ2UgKGRvYyBhcyB3cml0dGVuKS5cbiAgICogJ2hhbmRJbnRvT25lU3Rhcic6IGFkZGl0aW9uYWxseSBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIGJlIHBsYXllZCBvbnRvIGEgZGVwbG95ZWRcbiAgICogMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bCB0byBtZXJnZSBpbW1lZGlhdGVseSAocGF5cyBvbmx5IHRoZSBjb3N0IGRpZmZlcmVuY2UpLlxuICAgKi9cbiAgbWVyZ2U6ICdkZXBsb3llZE9ubHknIHwgJ2hhbmRJbnRvT25lU3Rhcic7XG4gIC8qKiBDYXJkLWluZmxvdyBrbm9icyAoYWxsIG9wdGlvbmFsOyBkZWZhdWx0cyByZXByb2R1Y2UgdGhlIGRvYykuICovXG4gIHN0YXJ0SGFuZD86IG51bWJlcjsgICAgICAgICAgICAvLyBkZWZhdWx0IDRcbiAgZHJhZnRQaWNrcz86IG51bWJlcjsgICAgICAgICAgIC8vIGNhcmRzIGtlcHQgZnJvbSB0aGUgMy1jYXJkIFZpY3RvcnkgRHJhZnQsIGRlZmF1bHQgMVxuICBub3JtYWxEcmF3V2F2ZXM/OiBudW1iZXJbXTsgICAgLy8gd2F2ZXMgKGJlaW5nIGVudGVyZWQpIHRoYXQgYWxzbyBnaXZlIHRoZSBub3JtYWwgcmFuZG9tIGRyYXc7IGRlZmF1bHQgPSBhbGxcbiAgLyoqIFNvdWxzIHRoaXMgcnVuIG1heSBkcmF3IGZyb20gKHRoZSBlcXVpcHBlZCBTb3VsIERlY2ssIG1heCA2KS4gRGVmYXVsdDogZXZlcnkgU291bC4gKi9cbiAgcG9vbD86IFNvdWxJZFtdO1xuICBzdGFnZVdhdmVzPzogbnVtYmVyOyAgICAgICAgICAgLy8gd2F2ZXMgaW4gdGhpcyBzdGFnZTsgZGVmYXVsdCAxMCAodGhlIHBsYXlhYmxlIHByb3RvdHlwZSB1c2VzIDMpXG59XG5cbmV4cG9ydCBjb25zdCBHUklEX0NPTFMgPSA0LCBHUklEX1JPV1MgPSAzOyAgIC8vIDQgeCAzID0gR1JJRF9DRUxMUzsgY29sdW1uIEdSSURfQ09MUy0xIGlzIHRoZSBmcm9udCBsaW5lXG4iLCAiLy8gU21hbGwgc2VlZGVkIFJORyAobXVsYmVycnkzMikuIFNhbWUgc2VlZCAtPiBzYW1lIHJ1biwgc28gYW55IGJ1ZyByZXBvcnQgaXMgcmVwcm9kdWNpYmxlLlxuXG5leHBvcnQgaW50ZXJmYWNlIFJuZyB7XG4gIG5leHQoKTogbnVtYmVyOyAgICAgICAgICAgICAgLy8gWzAsIDEpXG4gIGludChuOiBudW1iZXIpOiBudW1iZXI7ICAgICAgLy8gWzAsIG4pXG4gIHBpY2s8VD4oaXRlbXM6IHJlYWRvbmx5IFRbXSk6IFQ7XG4gIHNlZWQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSbmcoc2VlZDogbnVtYmVyKTogUm5nIHtcbiAgbGV0IGEgPSBzZWVkID4+PiAwO1xuICBjb25zdCBuZXh0ID0gKCkgPT4ge1xuICAgIGEgPSAoYSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gYTtcbiAgICB0ID0gTWF0aC5pbXVsKHQgXiAodCA+Pj4gMTUpLCB0IHwgMSk7XG4gICAgdCBePSB0ICsgTWF0aC5pbXVsKHQgXiAodCA+Pj4gNyksIHQgfCA2MSk7XG4gICAgcmV0dXJuICgodCBeICh0ID4+PiAxNCkpID4+PiAwKSAvIDQyOTQ5NjcyOTY7XG4gIH07XG4gIHJldHVybiB7XG4gICAgc2VlZCxcbiAgICBuZXh0LFxuICAgIGludDogKG4pID0+IE1hdGguZmxvb3IobmV4dCgpICogbiksXG4gICAgcGljazogKGl0ZW1zKSA9PiBpdGVtc1tNYXRoLmZsb29yKG5leHQoKSAqIGl0ZW1zLmxlbmd0aCldLFxuICB9O1xufVxuIiwgIi8vIFB1cmUgZ2FtZSBydWxlcyBmb3Igb25lIHN0YWdlLiBObyBncmFwaGljcywgbm8gY29tYmF0OiBqdXN0IGNhcmRzLCBEb21pbmlvbiwgZ3JpZCwgbWVyZ2UsIHdhdmVzLCBoZWFydHMuXG4vLyBFdmVyeSBtdXRhdGlvbiBnb2VzIHRocm91Z2ggYSBmdW5jdGlvbiBoZXJlIGFuZCBhcHBlbmRzIHRvIHN0YXRlLmxvZywgc28gcnVucyBjYW4gYmUgcmVwbGF5ZWQgYW5kIGluc3BlY3RlZC5cblxuaW1wb3J0IHsgQ09TVCwgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMsIFNUQVJUX0hBTkQsIFdBVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMsIFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdCB7IGlkOiBudW1iZXI7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7IGZyZXNoPzogYm9vbGVhbiB9ICAgLy8gZnJlc2ggPSBzdW1tb25lZCB0aGlzIGJ1aWxkIHBoYXNlXG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdGUge1xuICBydWxlczogUnVsZXM7XG4gIHJuZzogUm5nO1xuICB3YXZlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAvLyAxLWJhc2VkXG4gIGhlYXJ0czogbnVtYmVyO1xuICBjYXA6IG51bWJlcjtcbiAgaGFuZDogU291bElkW107XG4gIHVuaXRzOiBVbml0W107XG4gIG5leHRJZDogbnVtYmVyO1xuICBkaXNjYXJkVXNlZDogYm9vbGVhbjsgICAgICAgICAvLyBvbmNlLXBlci1idWlsZC1waGFzZSByZWRyYXdcbiAgc3RhdHVzOiAnYnVpbGRpbmcnIHwgJ3dvbicgfCAnbG9zdCc7XG4gIGxvZzogc3RyaW5nW107XG4gIHN0YXRzOiB7IGRyYXduOiBudW1iZXI7IGRpc2NhcmRlZDogbnVtYmVyOyBkaXNtaXNzZWQ6IG51bWJlcjsgbWVyZ2VzOiBudW1iZXI7IGZhaWx1cmVzOiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGNvc3QgPSAoc291bDogU291bElkLCBzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG5leHBvcnQgY29uc3QgY2FyZHNJbiA9IChzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gMiAqKiAoc3RhciAtIDEpOyAgICAgLy8gY2FyZHMgYSB1bml0IGlzIFwid29ydGhcIlxuZXhwb3J0IGNvbnN0IGRvbWluaW9uVXNlZCA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNvc3QodS5zb3VsLCB1LnN0YXIpLCAwKTtcbmV4cG9ydCBjb25zdCBkb21pbmlvbkZyZWUgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5jYXAgLSBkb21pbmlvblVzZWQocyk7XG5cbmZ1bmN0aW9uIGxvZyhzOiBTdGF0ZSwgbXNnOiBzdHJpbmcpIHsgcy5sb2cucHVzaChgW3cke3Mud2F2ZX1dICR7bXNnfWApOyB9XG4vKiogVGhlIFNvdWxzIHRoaXMgcnVuIGRyYXdzIGZyb206IHRoZSBlcXVpcHBlZCBkZWNrLCBvciBldmVyeXRoaW5nIGlmIG5vIGRlY2sgd2FzIGdpdmVuLiAqL1xuZXhwb3J0IGNvbnN0IHBvb2xPZiA9IChzOiBTdGF0ZSk6IFNvdWxJZFtdID0+IChzLnJ1bGVzLnBvb2wgJiYgcy5ydWxlcy5wb29sLmxlbmd0aCA/IHMucnVsZXMucG9vbCA6IFNPVUxTKTtcbmZ1bmN0aW9uIGRyYXcoczogU3RhdGUsIHdoeTogc3RyaW5nLCBub3Q/OiBTb3VsSWQpOiBTb3VsSWQge1xuICBjb25zdCBhbGwgPSBwb29sT2YocyksIG90aGVycyA9IG5vdCA/IGFsbC5maWx0ZXIoKHgpID0+IHggIT09IG5vdCkgOiBhbGw7XG4gIGNvbnN0IHBvb2wgPSBvdGhlcnMubGVuZ3RoID8gb3RoZXJzIDogYWxsOyAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBzd2FwIG5ldmVyIGhhbmRzIHlvdSBiYWNrIHRoZSBTb3VsIHlvdSBnYXZlIHVwICh1bmxlc3MgaXQgaXMgdGhlIG9ubHkgb25lIGVxdWlwcGVkKVxuICBjb25zdCBjID0gcy5ybmcucGljayhwb29sKTtcbiAgcy5oYW5kLnB1c2goYyk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmF3ICR7Y30gKCR7d2h5fSlgKTtcbiAgcmV0dXJuIGM7XG59XG5cbi8qKiBBIG5ldyBidWlsZCBwaGFzZSBiZWdpbnM6IHRoZSBvbmNlLXBlci1waGFzZSBzd2FwIGNvbWVzIGJhY2sgYW5kIG5vdGhpbmcgY291bnRzIGFzIFwic3VtbW9uZWQgdGhpcyByb3VuZFwiLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5ld1BoYXNlKHM6IFN0YXRlKTogdm9pZCB7XG4gIHMuZGlzY2FyZFVzZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIHUuZnJlc2ggPSBmYWxzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld1N0YWdlKHJ1bGVzOiBSdWxlcywgc2VlZDogbnVtYmVyKTogU3RhdGUge1xuICBjb25zdCBzOiBTdGF0ZSA9IHtcbiAgICBydWxlcywgcm5nOiBtYWtlUm5nKHNlZWQpLCB3YXZlOiAxLCBoZWFydHM6IEhFQVJUUywgY2FwOiBydWxlcy5jdXJ2ZVswXSwgaGFuZDogW10sIHVuaXRzOiBbXSwgbmV4dElkOiAxLFxuICAgIGRpc2NhcmRVc2VkOiBmYWxzZSwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IFtdLFxuICAgIHN0YXRzOiB7IGRyYXduOiAwLCBkaXNjYXJkZWQ6IDAsIGRpc21pc3NlZDogMCwgbWVyZ2VzOiAwLCBmYWlsdXJlczogMCB9LFxuICB9O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IChydWxlcy5zdGFydEhhbmQgPz8gU1RBUlRfSEFORCk7IGkrKykgZHJhdyhzLCAnc3RhcnRpbmcgaGFuZCcpO1xuICByZXR1cm4gcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZWVDZWxsKHM6IFN0YXRlKTogbnVtYmVyIHtcbiAgY29uc3QgdGFrZW4gPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmICghdGFrZW4uaGFzKGMpKSByZXR1cm4gYztcbiAgcmV0dXJuIC0xO1xufVxuXG4vLyAtLS0tIGJ1aWxkLXBoYXNlIGFjdGlvbnMgKGVhY2ggcmV0dXJucyB0cnVlIHdoZW4gaXQgaGFwcGVuZWQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XTtcbiAgcmV0dXJuIHNvdWwgIT09IHVuZGVmaW5lZCAmJiBmcmVlQ2VsbChzKSA+PSAwICYmIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2VsbEZyZWUoczogU3RhdGUsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICByZXR1cm4gY2VsbCA+PSAwICYmIGNlbGwgPCBHUklEX0NFTExTICYmICFzLnVuaXRzLnNvbWUoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7XG59XG5cbi8qKiBTdW1tb24gYSBoYW5kIGNhcmQgb250byBhIHNwZWNpZmljIGZyZWUgY2VsbCAoZGVmYXVsdDogdGhlIGZpcnN0IGZyZWUgb25lKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgY2VsbD86IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN1bW1vbihzLCBoYW5kSWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoY2VsbCAhPT0gdW5kZWZpbmVkICYmICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdTogVW5pdCA9IHsgaWQ6IHMubmV4dElkKyssIHNvdWwsIHN0YXI6IDEsIGNlbGw6IGNlbGwgPz8gZnJlZUNlbGwocyksIGZyZXNoOiB0cnVlIH07XG4gIHMudW5pdHMucHVzaCh1KTtcbiAgbG9nKHMsIGBzdW1tb24gJHtzb3VsfSAxKiAtPiBjZWxsICR7dS5jZWxsfSAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZURlcGxveWVkKGE6IFVuaXQsIGI6IFVuaXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuaWQgIT09IGIuaWQgJiYgYS5zb3VsID09PSBiLnNvdWwgJiYgYS5zdGFyID09PSBiLnN0YXIgJiYgYS5zdGFyIDwgTUFYX1NUQVI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZURlcGxveWVkKHM6IFN0YXRlLCBhSWQ6IG51bWJlciwgYklkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYUlkKSwgYiA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYklkKTtcbiAgaWYgKCFhIHx8ICFiIHx8ICFjYW5NZXJnZURlcGxveWVkKGEsIGIpKSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigodSkgPT4gdS5pZCAhPT0gYi5pZCk7XG4gIGEuZnJlc2ggPSAhIShhLmZyZXNoIHx8IGIuZnJlc2gpO1xuICBhLnN0YXIrKztcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZSAke2Euc291bH0gJHthLnN0YXIgLSAxfSorJHthLnN0YXIgLSAxfSogLT4gJHthLnN0YXJ9KiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSwgY2VsbHMgJHtzLnVuaXRzLmxlbmd0aH0vJHtHUklEX0NFTExTfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiAnaGFuZEludG9PbmVTdGFyJyBydWxlOiBwbGF5IGEgMS1zdGFyIGNhcmQgb250byBhIGRlcGxveWVkIDEtc3RhciB1bml0IG9mIHRoZSBzYW1lIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5ydWxlcy5tZXJnZSAhPT0gJ2hhbmRJbnRvT25lU3RhcicpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XSwgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCFzb3VsIHx8ICF1IHx8IHUuc291bCAhPT0gc291bCB8fCB1LnN0YXIgIT09IDEpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIGNvc3Qoc291bCwgMikgLSBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5NZXJnZUZyb21IYW5kKHMsIGhhbmRJZHgsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICB1LnN0YXIgPSAyO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlLWZyb20taGFuZCAke3NvdWx9IC0+ICR7dS5zb3VsfSAyKiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkaXNtaXNzKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgZGlzbWlzcyAke3Uuc291bH0gJHt1LnN0YXJ9KiAocGVybWFuZW50bHkgcmVtb3ZlZClgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAxOiBkaXNjYXJkIGEgaGFuZCBjYXJkIGFuZCBkcmF3IGEgcmFuZG9tIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNjYXJkUmVkcmF3KHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMuZGlzY2FyZFVzZWQgfHwgaGFuZElkeCA8IDAgfHwgaGFuZElkeCA+PSBzLmhhbmQubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGMgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNjYXJkZWQrKztcbiAgbG9nKHMsIGBzd2FwOiBkaXNjYXJkICR7Y31gKTtcbiAgZHJhdyhzLCAnc3dhcCcsIGMpO1xuICByZXR1cm4gdHJ1ZTtcbn1cbmV4cG9ydCBjb25zdCBzd2FwRGlzY2FyZCA9IGRpc2NhcmRSZWRyYXc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5Td2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgcmV0dXJuICFzLmRpc2NhcmRVc2VkICYmICEhdSAmJiAhdS5mcmVzaDsgICAgICAgICAgLy8gY2FuJ3Qgc2VsbCBhIHVuaXQgeW91IHN1bW1vbmVkIHRoaXMgcm91bmRcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDI6IHNlbGwgYSBkZXBsb3llZCB1bml0IChub3Qgb25lIHN1bW1vbmVkIHRoaXMgcm91bmQpIGFuZCBkcmF3IGEgY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN3YXBTZWxsKHMsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBzd2FwOiBzZWxsICR7dS5zb3VsfSAke3Uuc3Rhcn0qYCk7XG4gIGRyYXcocywgJ3N3YXAnLCB1LnNvdWwpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1vdmVVbml0KHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlciwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSB8fCAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgbG9nKHMsIGBtb3ZlICR7dS5zb3VsfSBjZWxsICR7dS5jZWxsfSAtPiAke2NlbGx9YCk7IHUuY2VsbCA9IGNlbGw7IHJldHVybiB0cnVlO1xufVxuXG4vLyAtLS0tIHdhdmUgcmVzdWx0cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBEcmFmdCBjaG9pY2VzIGZvciBhZnRlciBhIGNsZWFyZWQgd2F2ZTogMyByYW5kb20gY2FyZHMsIGR1cGxpY2F0ZXMgYWxsb3dlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkcmFmdE9wdGlvbnMoczogU3RhdGUpOiBTb3VsSWRbXSB7XG4gIGNvbnN0IHAgPSBwb29sT2Yocyk7XG4gIHJldHVybiBbcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKV07XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQ6IHJhaXNlIHRoZSBjYXAsIHJlc29sdmUgdGhlIFZpY3RvcnkgRHJhZnQsIGRyYXcgMSBub3JtYWwgY2FyZC4gKi9cbmV4cG9ydCBjb25zdCBzdGFnZVdhdmVzID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMucnVsZXMuc3RhZ2VXYXZlcyA/PyBXQVZFUztcblxuLyoqIFN0ZXAgMSBvZiBhIGNsZWFyZWQgd2F2ZTogaXMgdGhlIHN0YWdlIG92ZXI/IElmIG5vdCwgcmFpc2UgdGhlIGNhcCBhbmQgc3RhcnQgdGhlIG5leHQgYnVpbGQgcGhhc2UuIFJldHVybnMgdHJ1ZSB3aGVuIHRoZSBzdGFnZSBpcyB3b24uICovXG5leHBvcnQgZnVuY3Rpb24gYWR2YW5jZVdhdmUoczogU3RhdGUpOiBib29sZWFuIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gcy5zdGF0dXMgPT09ICd3b24nO1xuICBpZiAocy53YXZlID49IHN0YWdlV2F2ZXMocykpIHsgcy5zdGF0dXMgPSAnd29uJzsgbG9nKHMsICdzdGFnZSBjbGVhcmVkJyk7IHJldHVybiB0cnVlOyB9XG4gIHMud2F2ZSsrO1xuICBzLmNhcCA9IHMucnVsZXMuY3VydmVbcy53YXZlIC0gMV07XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYHdhdmUgY2xlYXJlZCAtPiBjYXAgJHtzLmNhcH1gKTtcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU3RlcCAyOiB0aGUgcGxheWVyIGtlcHQgYGlkeGAgZnJvbSB0aGUgb2ZmZXJlZCBkcmFmdCBjYXJkcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0YWtlRHJhZnQoczogU3RhdGUsIG9wdHM6IFNvdWxJZFtdLCBpZHg6IG51bWJlcik6IHZvaWQge1xuICBjb25zdCBwaWNrID0gb3B0c1tNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGlkeCkpXTtcbiAgcy5oYW5kLnB1c2gocGljayk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmFmdCBbJHtvcHRzLmpvaW4oJywgJyl9XSAtPiB0b29rICR7cGlja31gKTtcbn1cblxuLyoqIFN0ZXAgMzogdGhlIGJvbnVzIG5vcm1hbCBkcmF3IChvbmx5IG9uIHRoZSB3YXZlcyB0aGUgcnVsZXMgYWxsb3cpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbERyYXcoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMucnVsZXMubm9ybWFsRHJhd1dhdmVzID8gcy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMuaW5jbHVkZXMocy53YXZlKSA6IHRydWUpIGRyYXcocywgJ3dhdmUgY2xlYXInKTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZCAoYWxsIHRocmVlIHN0ZXBzIGluIG9uZSBjYWxsLCBmb3Igc2ltdWxhdGlvbnMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyV2F2ZShzOiBTdGF0ZSwgY2hvb3NlOiAob3B0czogU291bElkW10pID0+IG51bWJlcik6IHZvaWQge1xuICBpZiAoYWR2YW5jZVdhdmUocykpIHJldHVybjtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIGxldCBvcHRzID0gZHJhZnRPcHRpb25zKHMpO1xuICBjb25zdCBvZmZlcmVkID0gb3B0cy5qb2luKCcsICcpO1xuICBjb25zdCB0b29rOiBTb3VsSWRbXSA9IFtdO1xuICBmb3IgKGxldCBwID0gMDsgcCA8IChzLnJ1bGVzLmRyYWZ0UGlja3MgPz8gMSk7IHArKykge1xuICAgIGNvbnN0IGlkeCA9IE1hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgY2hvb3NlKG9wdHMpKSk7XG4gICAgdG9vay5wdXNoKG9wdHNbaWR4XSk7IHMuaGFuZC5wdXNoKG9wdHNbaWR4XSk7IHMuc3RhdHMuZHJhd24rKztcbiAgICBvcHRzID0gb3B0cy5maWx0ZXIoKF8sIGkpID0+IGkgIT09IGlkeCk7XG4gIH1cbiAgbG9nKHMsIGBkcmFmdCBbJHtvZmZlcmVkfV0gLT4gdG9vayAke3Rvb2suam9pbignLCAnKX1gKTtcbiAgbm9ybWFsRHJhdyhzKTtcbn1cblxuLyoqIEFybXkgd2lwZWQ6IGxvc2UgYSBoZWFydCwgY2FwIGRvZXMgTk9UIHJpc2UsIGVuZW1pZXMgcmVzZXQsICsxIGNhcmQsIHJlZHJhdyBhbGxvd2VkIGFnYWluLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZhaWxXYXZlKHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBzLmhlYXJ0cy0tOyBzLnN0YXRzLmZhaWx1cmVzKys7XG4gIGlmIChzLmhlYXJ0cyA8PSAwKSB7IHMuc3RhdHVzID0gJ2xvc3QnOyBsb2cocywgJ25vIGhlYXJ0cyBsZWZ0OiBzdGFnZSBsb3N0Jyk7IHJldHVybjsgfVxuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGBhcm15IHdpcGVkOiBoZWFydHMgJHtzLmhlYXJ0c30sIGNhcCBzdGF5cyAke3MuY2FwfWApO1xuICBkcmF3KHMsICdmYWlsZWQgYXR0ZW1wdCcpO1xufVxuXG4vLyAtLS0tIGludmFyaWFudHMgKGNhbGxlZCBieSB0aGUgc2ltdWxhdG9yIGFmdGVyIGV2ZXJ5IHdhdmU7IHRocm93IHdpdGggYSByZWFkYWJsZSBtZXNzYWdlKSAtLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjaGVja0ludmFyaWFudHMoczogU3RhdGUpOiB2b2lkIHtcbiAgY29uc3QgZmFpbCA9IChtOiBzdHJpbmcpID0+IHsgdGhyb3cgbmV3IEVycm9yKGBJTlZBUklBTlQgJHttfVxcbmAgKyBzLmxvZy5zbGljZSgtMTIpLmpvaW4oJ1xcbicpKTsgfTtcbiAgaWYgKHMudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgZmFpbChgbW9yZSB1bml0cyAoJHtzLnVuaXRzLmxlbmd0aH0pIHRoYW4gY2VsbHNgKTtcbiAgY29uc3QgY2VsbHMgPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgaWYgKGNlbGxzLnNpemUgIT09IHMudW5pdHMubGVuZ3RoKSBmYWlsKCd0d28gdW5pdHMgc2hhcmUgYSBjZWxsJyk7XG4gIGlmIChkb21pbmlvblVzZWQocykgPiBzLmNhcCkgZmFpbChgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9IGV4Y2VlZHMgY2FwICR7cy5jYXB9YCk7XG4gIGZvciAoY29uc3QgdSBvZiBzLnVuaXRzKSBpZiAodS5zdGFyIDwgMSB8fCB1LnN0YXIgPiBNQVhfU1RBUikgZmFpbChgdW5pdCBzdGFyICR7dS5zdGFyfSBvdXQgb2YgcmFuZ2VgKTtcbiAgLy8gZXZlcnkgZHJhd24gY2FyZCBpcyBlaXRoZXIgaW4gaGFuZCwgd29ydGggY2FyZHMgb24gdGhlIGZpZWxkLCBkaXNjYXJkZWQsIG9yIGRpc21pc3NlZFxuICBjb25zdCBvbkZpZWxkID0gcy51bml0cy5yZWR1Y2UoKG4sIHUpID0+IG4gKyBjYXJkc0luKHUuc3RhciksIDApO1xuICBjb25zdCBhY2NvdW50ZWQgPSBzLmhhbmQubGVuZ3RoICsgb25GaWVsZCArIHMuc3RhdHMuZGlzY2FyZGVkICsgcy5zdGF0cy5kaXNtaXNzZWQ7XG4gIGlmIChhY2NvdW50ZWQgIT09IHMuc3RhdHMuZHJhd24pIGZhaWwoYGNhcmQgY29uc2VydmF0aW9uOiBkcmF3biAke3Muc3RhdHMuZHJhd259ICE9IGFjY291bnRlZCAke2FjY291bnRlZH1gKTtcbn1cbiIsICIvLyBBdXRvLWJhdHRsZSBzaW11bGF0aW9uOiBwdXJlIGxvZ2ljLCBubyBncmFwaGljcy4gRGV0ZXJtaW5pc3RpYyBmb3IgYSBnaXZlbiBzZWVkLlxuLy8gVGhlIHJlbmRlcmVyIG9ubHkgcmVhZHMgZmlnaHRlcnMgKyBldmVudHM7IGl0IG5ldmVyIGRlY2lkZXMgYW55dGhpbmcuXG4vL1xuLy8gQWJpbGl0aWVzIChudW1iZXJzIGxpdmUgaW4gYmFsYW5jZS50cyk6XG4vLyAgIFNrZWxldG9uIFdhcnJpb3IgIFBoYWxhbnggICAgIHRha2VzIGxlc3MgZGFtYWdlIGZvciBlYWNoIG5lYXJieSBhbGxpZWQgV2FycmlvciAoY2FwcGVkKVxuLy8gICBTa2VsZXRvbiBBcmNoZXIgICBTcGxpdCBBcnJvdyAoc2tpbGwpIG9uZSBhcnJvdyBhdCBlYWNoIG9mIHVwIHRvIDMgZGlmZmVyZW50IGVuZW1pZXM7IGJhc2ljIHNob3RzIGFyZSBhIHNpbmdsZSBhcnJvd1xuLy8gICBHb2JsaW4gICAgICAgICAgICBPcHBvcnR1bmlzdCArZGFtYWdlIG9uIGFuIGVuZW15IHRoYXQgaXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlOyBwcmVmZXJzIHN1Y2ggdGFyZ2V0c1xuLy8gICBLbmlnaHQgICAgICAgICAgICBUYXVudCAoc2tpbGwpICBmb3JjZXMgbmVhcmJ5IGVuZW1pZXMgdG8gYXR0YWNrIGhpbVxuLy8gICBPZ3JlICAgICAgICAgICAgICBTbWFzaCAoc2tpbGwpICBoZWF2eSBzbGFtIHRoYXQgYWxzbyBoaXRzIGVuZW1pZXMgbmVhciB0aGUgaW1wYWN0XG4vLyBTa2lsbHMgcnVuIG9uIG1hbmE6IGJhc2ljIGF0dGFja3MgYW5kIGRhbWFnZSB0YWtlbiBmaWxsIGEgYmFyOyB3aGVuIGZ1bGwsIHRoZSBuZXh0IGF0dGFjayBpcyB0aGUgc2tpbGwgYW5kIHRoZSBiYXIgcmVzZXRzLlxuLy8gV2FycmlvciwgR29ibGluIGFuZCBCYXJiYXJpYW4gaGF2ZSBwYXNzaXZlcyBvbmx5IChubyBtYW5hKS5cbi8vICAgQmFyYmFyaWFuICAgICAgICAgRnJlbnp5ICAgICAgYXR0YWNrcyBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nXG5cbmltcG9ydCB7IEdSSURfQ09MUywgR1JJRF9ST1dTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgY29uc3QgR1JJRF9TUCA9IDEuMzsgICAgIC8vIG1ldHJlcyBiZXR3ZWVuIGdyaWQgY2VsbHNcbmV4cG9ydCBjb25zdCBGUk9OVF9YID0gMS43OyAgICAgLy8gZnJvbnQgbGluZSdzIGRpc3RhbmNlIGZyb20gdGhlIGNlbnRyZSBsaW5lXG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xvdCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXIgfVxuXG4vKiogV29ybGQgcG9zaXRpb24gb2YgYSBncmlkIGNlbGwgZm9yIGEgdGVhbSAodGVhbSAwID0gbGVmdCwgZmFjZXMgK1g7IHRlYW0gMSA9IHJpZ2h0LCBmYWNlcyAtWCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2VsbFBvcyh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKTogeyB4OiBudW1iZXI7IHo6IG51bWJlciB9IHtcbiAgY29uc3Qgcm93ID0gTWF0aC5mbG9vcihjZWxsIC8gR1JJRF9DT0xTKSwgY29sID0gY2VsbCAlIEdSSURfQ09MUztcbiAgY29uc3QgZGVwdGggPSBHUklEX0NPTFMgLSAxIC0gY29sOyAgICAgICAgICAgICAgICAgICAgICAgLy8gMCA9IGZyb250IGxpbmVcbiAgcmV0dXJuIHsgeDogKEZST05UX1ggKyBkZXB0aCAqIEdSSURfU1ApICogKHRlYW0gPT09IDAgPyAtMSA6IDEpLCB6OiAocm93IC0gKEdSSURfUk9XUyAtIDEpIC8gMikgKiBHUklEX1NQIH07XG59XG5cbmNvbnN0IEZST05UTkVTUzogUmVjb3JkPFNvdWxJZCwgbnVtYmVyPiA9IHsga25pZ2h0OiA1LCBvZ3JlOiA0LCB3YXJyaW9yOiAzLCBiYXJiYXJpYW46IDMsIGdvYmxpbjogMiwgYXJjaGVyOiAwIH07XG4vKiogVGhlIGVuZW15IGFybXkgaXMgcGxhY2VkIGF1dG9tYXRpY2FsbHkgKHRhbmtzIHVwIGZyb250LCBhcmNoZXJzIGJlaGluZCk7IHRoZSBwbGF5ZXIgb25seSBldmVyIHNlZXMgaXRzIGNvbXBvc2l0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZW15Q2VsbHMoc3BlY3M6IFNwZWNbXSk6IG51bWJlcltdIHtcbiAgY29uc3QgY2VsbHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DT0xTICogR1JJRF9ST1dTOyBjKyspIGNlbGxzLnB1c2goYyk7XG4gIGNlbGxzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBkYSA9IEdSSURfQ09MUyAtIDEgLSAoYSAlIEdSSURfQ09MUyksIGRiID0gR1JJRF9DT0xTIC0gMSAtIChiICUgR1JJRF9DT0xTKTtcbiAgICBpZiAoZGEgIT09IGRiKSByZXR1cm4gZGEgLSBkYjtcbiAgICByZXR1cm4gTWF0aC5hYnMoTWF0aC5mbG9vcihhIC8gR1JJRF9DT0xTKSAtIDEpIC0gTWF0aC5hYnMoTWF0aC5mbG9vcihiIC8gR1JJRF9DT0xTKSAtIDEpO1xuICB9KTtcbiAgY29uc3Qgb3JkZXIgPSBzcGVjcy5tYXAoKHMsIGkpID0+IGkpLnNvcnQoKGksIGopID0+IEZST05UTkVTU1tzcGVjc1tqXS5zb3VsXSAtIEZST05UTkVTU1tzcGVjc1tpXS5zb3VsXSk7XG4gIGNvbnN0IG91dCA9IG5ldyBBcnJheTxudW1iZXI+KHNwZWNzLmxlbmd0aCk7XG4gIG9yZGVyLmZvckVhY2goKGlkeCwgaykgPT4geyBvdXRbaWR4XSA9IGNlbGxzW2tdOyB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IHR5cGUgRlN0YXRlID0gJ2lkbGUnIHwgJ3J1bicgfCAnYXR0YWNrJyB8ICdkZWFkJztcbmV4cG9ydCBpbnRlcmZhY2UgRmlnaHRlciB7XG4gIGlkOiBudW1iZXI7IHRlYW06IDAgfCAxOyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyO1xuICB4OiBudW1iZXI7IHo6IG51bWJlcjsgeWF3OiBudW1iZXI7XG4gIGhwOiBudW1iZXI7IG1heEhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBpbnRlcnZhbDogbnVtYmVyOyByYW5nZTogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyByYWRpdXM6IG51bWJlcjtcbiAgYWxpdmU6IGJvb2xlYW47IHN0YXRlOiBGU3RhdGU7XG4gIHRhcmdldDogbnVtYmVyOyByZXRhcmdldEF0OiBudW1iZXI7IGZvcmNlZFRhcmdldDogbnVtYmVyOyBmb3JjZWRVbnRpbDogbnVtYmVyO1xuICBuZXh0QXR0YWNrOiBudW1iZXI7IGF0dGFja1N0YXJ0OiBudW1iZXI7IGF0dGFja0R1cjogbnVtYmVyOyBhbmltU3BlZWQ6IG51bWJlcjsgaGl0RG9uZTogYm9vbGVhbjtcbiAgbWFuYTogbnVtYmVyOyBtYXhNYW5hOiBudW1iZXI7IGNhc3Rpbmc6IGJvb2xlYW47IGZyZW56eTogbnVtYmVyOyBkZWFkQXQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgQkV2ZW50ID1cbiAgfCB7IHQ6ICdzd2luZyc7IGlkOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdoaXQnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyOyBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ2Fycm93JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnZGVhdGgnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdjYXN0JzsgaWQ6IG51bWJlcjsgc2tpbGw6ICdzcGxpdCcgfCAndGF1bnQnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAndGF1bnQnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdzbWFzaCc7IGlkOiBudW1iZXI7IHg6IG51bWJlcjsgejogbnVtYmVyOyByOiBudW1iZXIgfVxuICB8IHsgdDogJ2ZyZW56eSc7IGlkOiBudW1iZXI7IHN0YWNrczogbnVtYmVyIH07XG5cbmV4cG9ydCBjbGFzcyBCYXR0bGUge1xuICB0aW1lID0gMDtcbiAgZmlnaHRlcnM6IEZpZ2h0ZXJbXSA9IFtdO1xuICBldmVudHM6IEJFdmVudFtdID0gW107XG4gIHdpbm5lcjogLTEgfCAwIHwgMSA9IC0xO1xuICBybmc6IFJuZztcbiAgcHJpdmF0ZSBwZW5kaW5nOiB7IGF0OiBudW1iZXI7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXIgfVtdID0gW107XG4gIHByaXZhdGUgbmV4dElkID0gMTtcbiAgcHJpdmF0ZSBmbGlwID0gZmFsc2U7XG5cbiAgY29uc3RydWN0b3IocGxheWVyczogU2xvdFtdLCBlbmVtaWVzOiBTcGVjW10sIHNlZWQgPSAxKSB7XG4gICAgdGhpcy5ybmcgPSBtYWtlUm5nKHNlZWQpO1xuICAgIGZvciAoY29uc3QgcCBvZiBwbGF5ZXJzKSB0aGlzLmFkZCgwLCBwLnNvdWwsIHAuc3RhciwgcC5jZWxsKTtcbiAgICBjb25zdCBjZWxscyA9IGVuZW15Q2VsbHMoZW5lbWllcyk7XG4gICAgZW5lbWllcy5mb3JFYWNoKChlLCBpKSA9PiB0aGlzLmFkZCgxLCBlLnNvdWwsIGUuc3RhciwgY2VsbHNbaV0pKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkKHRlYW06IDAgfCAxLCBzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlciwgY2VsbDogbnVtYmVyKTogRmlnaHRlciB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tzb3VsXSwgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCk7XG4gICAgY29uc3QgaHAgPSBzdC5ocCAqIEIuc3Rhci5ocFtzdGFyIC0gMV07XG4gICAgY29uc3QgZjogRmlnaHRlciA9IHtcbiAgICAgIGlkOiB0aGlzLm5leHRJZCsrLCB0ZWFtLCBzb3VsLCBzdGFyLCBjZWxsLCB4OiBwLngsIHo6IHAueiwgeWF3OiB0ZWFtID09PSAwID8gMCA6IE1hdGguUEksXG4gICAgICBocCwgbWF4SHA6IGhwLCBkbWc6IHN0LmRtZyAqIEIuc3Rhci5kbWdbc3RhciAtIDFdLCBpbnRlcnZhbDogc3QuaW50ZXJ2YWwsIHJhbmdlOiBzdC5yYW5nZSwgc3BlZWQ6IHN0LnNwZWVkLCByYWRpdXM6IHN0LnNpemUgKiBCLnN0YXIuc2NhbGVbc3RhciAtIDFdLFxuICAgICAgYWxpdmU6IHRydWUsIHN0YXRlOiAnaWRsZScsIHRhcmdldDogLTEsIHJldGFyZ2V0QXQ6IDAsIGZvcmNlZFRhcmdldDogLTEsIGZvcmNlZFVudGlsOiAwLFxuICAgICAgbmV4dEF0dGFjazogdGhpcy5ybmcubmV4dCgpICogMC4zLCBhdHRhY2tTdGFydDogLTksIGF0dGFja0R1cjogMSwgYW5pbVNwZWVkOiAxLCBoaXRGcmFjOiAwLCBoaXREb25lOiB0cnVlLFxuICAgICAgbWFuYTogMCwgbWF4TWFuYTogQi5tYW5hW3NvdWxdPy5tYXggPz8gMCwgY2FzdGluZzogZmFsc2UsIGZyZW56eTogMCwgZGVhZEF0OiAwLFxuICAgIH0gYXMgRmlnaHRlcjtcbiAgICB0aGlzLmZpZ2h0ZXJzLnB1c2goZik7IHJldHVybiBmO1xuICB9XG5cbiAgYnlJZChpZDogbnVtYmVyKTogRmlnaHRlciB8IHVuZGVmaW5lZCB7IHJldHVybiBpZCA8IDAgPyB1bmRlZmluZWQgOiB0aGlzLmZpZ2h0ZXJzW2lkIC0gMV07IH1cbiAgZm9lcyhmOiBGaWdodGVyKTogRmlnaHRlcltdIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8udGVhbSAhPT0gZi50ZWFtKTsgfVxuICBjb3VudCh0ZWFtOiAwIHwgMSk6IG51bWJlciB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLnJlZHVjZSgobiwgZikgPT4gbiArIChmLmFsaXZlICYmIGYudGVhbSA9PT0gdGVhbSA/IDEgOiAwKSwgMCk7IH1cbiAgZHJhaW4oKTogQkV2ZW50W10geyBjb25zdCBlID0gdGhpcy5ldmVudHM7IHRoaXMuZXZlbnRzID0gW107IHJldHVybiBlOyB9XG5cbiAgc3RlcChkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMud2lubmVyID49IDApIHJldHVybjtcbiAgICB0aGlzLnRpbWUgKz0gZHQ7IHRoaXMuZmxpcCA9ICF0aGlzLmZsaXA7XG4gICAgLy8gYXJyb3dzIHRoYXQgaGF2ZSBmaW5pc2hlZCBmbHlpbmdcbiAgICBmb3IgKGxldCBpID0gdGhpcy5wZW5kaW5nLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wZW5kaW5nW2ldO1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBwLmF0KSB7XG4gICAgICAgIHRoaXMucGVuZGluZy5zcGxpY2UoaSwgMSk7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5ieUlkKHAudG8pLCBmcm9tID0gdGhpcy5ieUlkKHAuZnJvbSk7XG4gICAgICAgIGlmICh0byAmJiB0by5hbGl2ZSAmJiBmcm9tKSB0aGlzLmRhbWFnZSh0bywgcC5kbWcsIGZyb20sICdhcnJvdycpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvcmRlciA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKHRoaXMuZmxpcCkgb3JkZXIucmV2ZXJzZSgpO1xuICAgIGZvciAoY29uc3QgZiBvZiBvcmRlcikgaWYgKGYuYWxpdmUpIHRoaXMudXBkYXRlKGYsIGR0KTtcbiAgICBjb25zdCBhID0gdGhpcy5jb3VudCgwKSwgYiA9IHRoaXMuY291bnQoMSk7XG4gICAgaWYgKCFhIHx8ICFiKSB0aGlzLndpbm5lciA9IGEgPyAwIDogMTtcbiAgICBlbHNlIGlmICh0aGlzLnRpbWUgPj0gQkFMQU5DRS5zaW0udGltZUxpbWl0KSB7XG4gICAgICBjb25zdCBocCA9ICh0OiAwIHwgMSkgPT4gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB0KS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCk7XG4gICAgICB0aGlzLndpbm5lciA9IGhwKDApID4gaHAoMSkgPyAwIDogMTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyLWZpZ2h0ZXIgdXBkYXRlXG4gIHByaXZhdGUgdXBkYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07XG4gICAgdGhpcy5zZXBhcmF0ZShmLCBkdCk7XG5cbiAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHtcbiAgICAgIGNvbnN0IHQgPSB0aGlzLnRpbWUgLSBmLmF0dGFja1N0YXJ0O1xuICAgICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAodGcgJiYgdGcuYWxpdmUpIHRoaXMuZmFjZShmLCB0Zy54IC0gZi54LCB0Zy56IC0gZi56LCBkdCk7XG4gICAgICBpZiAoIWYuaGl0RG9uZSAmJiB0ID49IGYuYXR0YWNrRHVyICogc3QuaGl0RnJhYykgeyBmLmhpdERvbmUgPSB0cnVlOyB0aGlzLnJlc29sdmVIaXQoZik7IH1cbiAgICAgIGlmICh0ID49IGYuYXR0YWNrRHVyKSBmLnN0YXRlID0gJ2lkbGUnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFjcXVpcmUoZik7XG4gICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmICghdGcgfHwgIXRnLmFsaXZlKSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IHJldHVybjsgfVxuICAgIGNvbnN0IGR4ID0gdGcueCAtIGYueCwgZHogPSB0Zy56IC0gZi56LCBkaXN0ID0gTWF0aC5oeXBvdChkeCwgZHopO1xuICAgIHRoaXMuZmFjZShmLCBkeCwgZHosIGR0KTtcbiAgICBpZiAoZGlzdCA8PSBmLnJhbmdlKSB7XG4gICAgICBpZiAodGhpcy50aW1lID49IGYubmV4dEF0dGFjaykgdGhpcy5zdGFydEF0dGFjayhmKTsgZWxzZSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IH1cbiAgICB9IGVsc2Uge1xuICAgICAgZi5zdGF0ZSA9ICdydW4nOyBjb25zdCBrID0gZi5zcGVlZCAqIGR0IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCk7IGYueCArPSBkeCAqIGs7IGYueiArPSBkeiAqIGs7IHRoaXMuZnJlbnp5RGVjYXkoZik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBmcmVuenlEZWNheShmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicgJiYgZi5mcmVuenkgPiAwICYmIHRoaXMudGltZSAtIChmLmF0dGFja1N0YXJ0ICsgZi5hdHRhY2tEdXIpID4gQkFMQU5DRS5mcmVuenkucmVzZXRBZnRlcikgZi5mcmVuenkgPSAwO1xuICB9XG5cbiAgcHJpdmF0ZSBmYWNlKGY6IEZpZ2h0ZXIsIGR4OiBudW1iZXIsIGR6OiBudW1iZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAoZHggKiBkeCArIGR6ICogZHogPCAxZS02KSByZXR1cm47XG4gICAgY29uc3Qgd2FudCA9IE1hdGguYXRhbjIoZHgsIGR6KTsgbGV0IGQgPSAoKHdhbnQgLSBmLnlhdyArIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSArIDIgKiBNYXRoLlBJKSAlICgyICogTWF0aC5QSSkgLSBNYXRoLlBJO1xuICAgIGYueWF3ICs9IE1hdGgubWF4KC05ICogZHQsIE1hdGgubWluKDkgKiBkdCwgZCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXBhcmF0ZShmOiBGaWdodGVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgayA9ICh3YW50IC0gbSkgLyBNYXRoLm1heChtLCAxZS0zKTsgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBmLnggKz0gcHggKiBzOyBmLnogKz0gcHogKiBzO1xuICB9XG5cbiAgcHJpdmF0ZSBhY3F1aXJlKGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5mb3JjZWRUYXJnZXQgPj0gMCkge1xuICAgICAgY29uc3QgZnQgPSB0aGlzLmJ5SWQoZi5mb3JjZWRUYXJnZXQpO1xuICAgICAgaWYgKGZ0ICYmIGZ0LmFsaXZlICYmIHRoaXMudGltZSA8IGYuZm9yY2VkVW50aWwpIHsgZi50YXJnZXQgPSBmdC5pZDsgcmV0dXJuOyB9XG4gICAgICBmLmZvcmNlZFRhcmdldCA9IC0xO1xuICAgIH1cbiAgICBjb25zdCBjdXIgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmIChjdXIgJiYgY3VyLmFsaXZlICYmIHRoaXMudGltZSA8IGYucmV0YXJnZXRBdCkgcmV0dXJuO1xuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoc2NvcmUgPCBicykgeyBicyA9IHNjb3JlOyBiZXN0ID0gbzsgfVxuICAgIH1cbiAgICBmLnRhcmdldCA9IGJlc3QuaWQ7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0QXR0YWNrKGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07IGxldCBlZmYgPSBmLmludGVydmFsO1xuICAgIGlmIChmLnNvdWwgPT09ICdiYXJiYXJpYW4nKSB7IGYuZnJlbnp5ID0gTWF0aC5taW4oQi5mcmVuenkubWF4U3RhY2tzLCBmLmZyZW56eSArIDEpOyBlZmYgPSBmLmludGVydmFsIC8gKDEgKyBmLmZyZW56eSAqIEIuZnJlbnp5LnBlclN3aW5nKTsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdmcmVuenknLCBpZDogZi5pZCwgc3RhY2tzOiBmLmZyZW56eSB9KTsgfVxuICAgIGYuYXR0YWNrRHVyID0gTWF0aC5taW4oc3QuYW5pbUxlbiwgZWZmICogMC45NSk7IGYuYW5pbVNwZWVkID0gc3QuYW5pbUxlbiAvIGYuYXR0YWNrRHVyO1xuICAgIGYuYXR0YWNrU3RhcnQgPSB0aGlzLnRpbWU7IGYubmV4dEF0dGFjayA9IHRoaXMudGltZSArIE1hdGgubWF4KGVmZiwgZi5hdHRhY2tEdXIpOyBmLmhpdERvbmUgPSBmYWxzZTsgZi5zdGF0ZSA9ICdhdHRhY2snO1xuICAgIGYuY2FzdGluZyA9IGYubWF4TWFuYSA+IDAgJiYgZi5tYW5hID49IGYubWF4TWFuYTsgaWYgKGYuY2FzdGluZykgeyBmLm1hbmEgPSAwOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2Nhc3QnLCBpZDogZi5pZCwgc2tpbGw6IGYuc291bCA9PT0gJ2FyY2hlcicgPyAnc3BsaXQnIDogZi5zb3VsID09PSAna25pZ2h0JyA/ICd0YXVudCcgOiAnc21hc2gnIH0pOyB9XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdzd2luZycsIGlkOiBmLmlkLCBzcGVlZDogZi5hbmltU3BlZWQsIGR1cjogZi5hdHRhY2tEdXIgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVIaXQoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFOyBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7IGlmICghdGcgfHwgIXRnLmFsaXZlKSByZXR1cm47XG4gICAgY29uc3QgTSA9IEIubWFuYVtmLnNvdWxdOyBpZiAoTSAmJiAhZi5jYXN0aW5nKSBmLm1hbmEgPSBNYXRoLm1pbihNLm1heCwgZi5tYW5hICsgTS5wZXJBdHRhY2spO1xuICAgIGlmIChmLnNvdWwgPT09ICdhcmNoZXInKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGJhc2ljOiBvbmUgYXJyb3cuIFNraWxsIChTcGxpdCBBcnJvdyk6IG9uZSBhcnJvdyBhdCBlYWNoIG9mIHVwIHRvIDMgZGlmZmVyZW50IGVuZW1pZXNcbiAgICAgIGNvbnN0IHJlYWNoID0gZi5yYW5nZSAqIDEuMjU7XG4gICAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpLm1hcCgobykgPT4gKHsgbywgZDogTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgfSkpLmZpbHRlcigoZSkgPT4gZS5kIDw9IHJlYWNoKS5zb3J0KChhLCBiKSA9PiBhLmQgLSBiLmQpO1xuICAgICAgY29uc3QgcGlja2VkID0gZi5jYXN0aW5nID8gW3RnLCAuLi5mb2VzLm1hcCgoZSkgPT4gZS5vKS5maWx0ZXIoKG8pID0+IG8uaWQgIT09IHRnLmlkKV0uc2xpY2UoMCwgQi52b2xsZXkudGFyZ2V0cykgOiBbdGddO1xuICAgICAgZm9yIChjb25zdCBvIG9mIHBpY2tlZCkge1xuICAgICAgICBjb25zdCBkdXIgPSBNYXRoLm1heCgwLjE1LCBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSAvIEIudm9sbGV5LnByb2plY3RpbGVTcGVlZCk7XG4gICAgICAgIHRoaXMucGVuZGluZy5wdXNoKHsgYXQ6IHRoaXMudGltZSArIGR1ciwgZnJvbTogZi5pZCwgdG86IG8uaWQsIGRtZzogZi5kbWcgfSk7XG4gICAgICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnYXJyb3cnLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZHVyIH0pO1xuICAgICAgfVxuICAgICAgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjtcbiAgICB9XG4gICAgaWYgKE1hdGguaHlwb3QodGcueCAtIGYueCwgdGcueiAtIGYueikgPiBmLnJhbmdlICogMS41KSB7IGYuY2FzdGluZyA9IGZhbHNlOyByZXR1cm47IH0gICAvLyB0YXJnZXQgc2xpcHBlZCBhd2F5OiB0aGUgYmxvdyBtaXNzZXNcbiAgICBsZXQgZG1nID0gZi5kbWc7XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicpIHsgY29uc3QgZW5nID0gdGhpcy5ieUlkKHRnLnRhcmdldCk7IGlmIChlbmcgJiYgZW5nLmFsaXZlICYmIGVuZy50ZWFtID09PSBmLnRlYW0gJiYgZW5nLmlkICE9PSBmLmlkKSBkbWcgKj0gMSArIEIub3Bwb3J0dW5pc3QuYm9udXM7IH1cbiAgICBpZiAoZi5jYXN0aW5nKSB7XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTtcbiAgICAgIGlmIChmLnNvdWwgPT09ICdvZ3JlJykge1xuICAgICAgICBkbWcgKj0gQi5zbWFzaC5tdWx0OyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3NtYXNoJywgaWQ6IGYuaWQsIHg6IHRnLngsIHo6IHRnLnosIHI6IEIuc21hc2gucmFkaXVzIH0pO1xuICAgICAgICBmb3IgKGNvbnN0IG8gb2YgdGhpcy5mb2VzKGYpKSBpZiAoby5pZCAhPT0gdGcuaWQgJiYgTWF0aC5oeXBvdChvLnggLSB0Zy54LCBvLnogLSB0Zy56KSA8PSBCLnNtYXNoLnJhZGl1cykgdGhpcy5kYW1hZ2UobywgZG1nICogMC42LCBmLCAnc21hc2gnKTtcbiAgICAgICAgdGhpcy5kYW1hZ2UodGcsIGRtZywgZiwgJ3NtYXNoJyk7IHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChmLnNvdWwgPT09ICdrbmlnaHQnKSB7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSA8PSBCLnRhdW50LnJhZGl1cykgeyBvLmZvcmNlZFRhcmdldCA9IGYuaWQ7IG8uZm9yY2VkVW50aWwgPSB0aGlzLnRpbWUgKyBCLnRhdW50LmR1cmF0aW9uOyBvLnJldGFyZ2V0QXQgPSAwOyB9XG4gICAgICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAndGF1bnQnLCBpZDogZi5pZCB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5kYW1hZ2UodGcsIGRtZywgZiwgJ21lbGVlJyk7XG4gIH1cblxuICBwcml2YXRlIGRhbWFnZSh0OiBGaWdodGVyLCBhbW91bnQ6IG51bWJlciwgZnJvbTogRmlnaHRlciwga2luZDogJ21lbGVlJyB8ICdhcnJvdycgfCAnc21hc2gnKTogdm9pZCB7XG4gICAgaWYgKCF0LmFsaXZlKSByZXR1cm47XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGxldCByZWQgPSAwO1xuICAgIGlmICh0LnNvdWwgPT09ICd3YXJyaW9yJykge1xuICAgICAgY29uc3QgbiA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8gIT09IHQgJiYgby50ZWFtID09PSB0LnRlYW0gJiYgby5zb3VsID09PSAnd2FycmlvcicgJiYgTWF0aC5oeXBvdChvLnggLSB0LngsIG8ueiAtIHQueikgPD0gQi5waGFsYW54LnJhZGl1cykubGVuZ3RoO1xuICAgICAgcmVkID0gTWF0aC5taW4oQi5waGFsYW54Lm1heFN0YWNrcywgbikgKiBCLnBoYWxhbngucGVyQWxseTtcbiAgICB9XG4gICAgY29uc3QgZG1nID0gYW1vdW50ICogKDEgLSByZWQpOyB0LmhwIC09IGRtZztcbiAgICBjb25zdCBNID0gQi5tYW5hW3Quc291bF07IGlmIChNICYmIHQuaHAgPiAwKSB0Lm1hbmEgPSBNYXRoLm1pbihNLm1heCwgdC5tYW5hICsgTS5wZXJIaXQpO1xuICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnaGl0JywgZnJvbTogZnJvbS5pZCwgdG86IHQuaWQsIGRtZywga2luZCB9KTtcbiAgICBpZiAodC5ocCA8PSAwKSB7IHQuaHAgPSAwOyB0LmFsaXZlID0gZmFsc2U7IHQuc3RhdGUgPSAnZGVhZCc7IHQuZGVhZEF0ID0gdGhpcy50aW1lOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2RlYXRoJywgaWQ6IHQuaWQgfSk7IH1cbiAgfVxufVxuXG4vKiogUnVuIGEgd2hvbGUgZmlnaHQgd2l0aG91dCBhbnkgZ3JhcGhpY3MuIFJldHVybnMgd2hvIHdvbiBhbmQgaG93IGl0IHdlbnQuICovXG5leHBvcnQgZnVuY3Rpb24gc2ltdWxhdGUocGxheWVyczogU2xvdFtdLCBlbmVtaWVzOiBTcGVjW10sIHNlZWQgPSAxLCBtYXhTZWNvbmRzID0gMTMwKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQpO1xuICB3aGlsZSAoYi53aW5uZXIgPCAwICYmIGIudGltZSA8IG1heFNlY29uZHMpIGIuc3RlcCgxIC8gMzApO1xuICBjb25zdCB3ID0gKGIud2lubmVyIDwgMCA/IDEgOiBiLndpbm5lcikgYXMgMCB8IDE7XG4gIGNvbnN0IG1pbmUgPSBiLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHcpO1xuICByZXR1cm4geyB3aW5uZXI6IHcsIHRpbWU6IGIudGltZSwgbGVmdDogbWluZS5sZW5ndGgsIGhwTGVmdDogbWluZS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCkgfTtcbn1cbiIsICIvLyBFbmVteSB3YXZlcy4gU2FtZSB1bml0IHBvb2wgYXMgdGhlIHBsYXllci4gVGhlIGJ1aWxkIHNjcmVlbiBwcmV2aWV3cyB0aGUgQ09NUE9TSVRJT04gb25seSwgbmV2ZXIgcG9zaXRpb25zLlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMsIFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRW5lbXlTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXIgfVxuXG5jb25zdCBMRVRURVI6IFJlY29yZDxzdHJpbmcsIFNvdWxJZD4gPSB7IFc6ICd3YXJyaW9yJywgQTogJ2FyY2hlcicsIEc6ICdnb2JsaW4nLCBLOiAna25pZ2h0JywgTzogJ29ncmUnLCBCOiAnYmFyYmFyaWFuJyB9O1xuY29uc3QgcGFyc2VXYXZlID0gKHM6IHN0cmluZyk6IEVuZW15U3BlY1tdID0+IHMuc3BsaXQoJyAnKS5tYXAoKHQpID0+ICh7IHNvdWw6IExFVFRFUlt0WzBdXSwgc3RhcjogK3RbMV0gfSkpO1xuXG4vKipcbiAqIERpZmZpY3VsdHkgcHJlc2V0cyBmb3IgU3RhZ2UgMSAoMTAgd2F2ZXMpIChXIHdhcnJpb3IsIEEgYXJjaGVyLCBHIGdvYmxpbiwgSyBrbmlnaHQsIE8gb2dyZTsgZGlnaXQgPSBzdGFycykuXG4gKiBNZWFzdXJlZCB3aXRoIHNpbS90dW5lX3dhdmVzLnRzIGFnYWluc3Qgc3RhbmQtaW4gcGxheWVycyAoY29tcGV0ZW50IC8gY2FyZWxlc3MpLCBzdGFnZS1jbGVhciByYXRlOlxuICogICBlYXN5ICAgfjEwMCUgLyB+OTAlICAgICAgbm9ybWFsIH45NCUgLyB+NTElICAgICAgaGFyZCB+NzUlIC8gfjI2JVxuICogQSByZWFsIGh1bWFuIG9uIGEgcGhvbmUgaXMgbXVjaCBsZXNzIGNhcmVmdWwgdGhhbiB0aGUgY29tcGV0ZW50IHN0YW5kLWluLCBzbyBcIm5vcm1hbFwiIGlzIHRoZSBkZWZhdWx0LlxuICovXG5leHBvcnQgY29uc3QgRElGRklDVUxUWTogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0ge1xuICBlYXN5OiBbJ1cxJywgJ0sxIFcxJywgJ08xIFcxIEcxJywgJ0sxIEExIFcxJywgJ08xIEExIEcxJywgJ0sxIE8xIEExJywgJ0sxIE8xIEExIEcxJywgJ08xIEsxIEExIEcxJywgJ08xIEsxIEExIEIxJywgJ08yIEsxIEExIEcxJ10sXG4gIG5vcm1hbDogWydXMSBBMScsICdLMSBHMSBXMScsICdPMSBBMSBHMSBXMScsICdLMSBPMSBBMSBXMScsICdPMSBLMSBBMSBHMSBXMScsICdBMiBLMSBPMSBHMSBXMScsICdLMSBPMSBBMSBHMSBXMScsICdPMSBLMSBBMSBCMSBHMScsICdPMSBLMSBBMiBCMSBHMScsICdPMiBLMSBBMSBCMSBHMSBXMSddLFxuICBoYXJkOiBbJ1cxIEExJywgJ0sxIEcxIFcxIEExJywgJ08xIEExIEcxIFcxJywgJ0sxIE8xIEExIFcxIEcxJywgJ08xIEsxIEEyIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxJywgJ0sxIE8xIEExIEcxIFcyJywgJ08xIEsxIEEyIEIxIEcxJywgJ08yIEsxIEEyIEIxIEcxJywgJ08yIEsyIEExIEIxIEcxIFcxJ10sXG4gIG5pZ2h0bWFyZTogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMScsICdPMSBBMSBHMSBXMSBCMScsICdLMSBPMSBBMSBXMSBHMScsICdPMSBLMSBBMiBHMSBXMScsICdBMiBLMSBPMSBHMSBXMSBCMScsICdLMSBPMSBBMiBHMSBXMSBCMScsICdPMSBLMiBBMiBCMSBHMScsICdPMiBLMSBBMiBCMSBHMSBXMScsICdPMiBLMiBBMiBCMSBHMSBXMSddLFxufTtcblxuLyoqIE5hbWVzIGFuZCBvbmUtbGluZSBwcm9taXNlcyBmb3IgdGhlIGRpZmZpY3VsdHkgcGlja2VyLiBNZWFzdXJlZCBzdGFnZS1jbGVhciByYXRlcyAoY29tcGV0ZW50IC8gY2FyZWxlc3Mgc3RhbmQtaW4pOiBlYXN5IDk4LzkwLCBub3JtYWwgODIvNDQsIGhhcmQgNTYvMTYsIG5pZ2h0bWFyZSAzMC84LiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFlfSU5GTyA9IFtcbiAgeyBpZDogJ2Vhc3knLCBsYWJlbDogJ0Vhc3knLCBibHVyYjogJ1NtYWxsZXIgZW5lbXkgYXJtaWVzLiBSZWxheCBhbmQgbGVhcm4gaG93IG1lcmdpbmcgd29ya3MuJyB9LFxuICB7IGlkOiAnbm9ybWFsJywgbGFiZWw6ICdOb3JtYWwnLCBibHVyYjogJ0EgZmFpciBmaWdodC4gTW9zdCBwbGF5ZXJzIGNsZWFyIGl0IHdpdGhpbiBhIHJ1biBvciB0d28uJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnU2hhcnBlciBhcm1pZXMuIE1pc3Rha2VzIGNvc3QgaGVhcnRzLicgfSxcbiAgeyBpZDogJ25pZ2h0bWFyZScsIGxhYmVsOiAnTmlnaHRtYXJlJywgYmx1cmI6ICdTdGFycyBhbmQgc2tpbGxzIGV2ZXJ5d2hlcmUuIEV4cGVjdCB0byBsb3NlIGhlYXJ0cywgYW5kIHRvIGVhcm4gdGhlIHdpbi4nIH0sXG5dO1xuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZSA9ICdub3JtYWwnO1xuXG4vKiogSGFuZC1hdXRob3JlZCB3YXZlcyBmb3IgU3RhZ2UgMSAoMTAgd2F2ZXMpLiBCdWRnZXRzIH4gdGhlIHBsYXllcidzIGNhcCBhdCB0aGF0IHdhdmUuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXREaWZmaWN1bHR5LiAqL1xuZXhwb3J0IGNvbnN0IEFVVEhPUkVEOiBFbmVteVNwZWNbXVtdID0gRElGRklDVUxUWS5ub3JtYWwubWFwKHBhcnNlV2F2ZSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXREaWZmaWN1bHR5KG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIURJRkZJQ1VMVFlbbmFtZV0pIHJldHVybjtcbiAgZGlmZmljdWx0eU5hbWUgPSBuYW1lOyBBVVRIT1JFRC5sZW5ndGggPSAwOyBESUZGSUNVTFRZW25hbWVdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG5cbmV4cG9ydCBjb25zdCB3YXZlQ29zdCA9ICh3OiBFbmVteVNwZWNbXSk6IG51bWJlciA9PiB3LnJlZHVjZSgobiwgZSkgPT4gbiArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXSwgMCk7XG5cbi8qKiBFbmVteSBhcm15IGZvciBhIHdhdmUgKDEtYmFzZWQpLiBXYXZlcyBwYXN0IHRoZSBhdXRob3JlZCBvbmVzIGFyZSBnZW5lcmF0ZWQgZnJvbSBhIGZpeGVkIHNlZWQgc28gcmV0cmllcyBmYWNlIHRoZSBzYW1lIGFybXkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlXYXZlKHdhdmU6IG51bWJlciwgc3RhZ2VTZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgaWYgKHdhdmUgPD0gQVVUSE9SRUQubGVuZ3RoKSByZXR1cm4gQVVUSE9SRURbd2F2ZSAtIDFdLm1hcCgoZSkgPT4gKHsgLi4uZSB9KSk7XG4gIGNvbnN0IGNhcCA9IENVUlZFUy5kb2NbTWF0aC5taW4od2F2ZSwgQ1VSVkVTLmRvYy5sZW5ndGgpIC0gMV07XG4gIGNvbnN0IGJ1ZGdldCA9IE1hdGgucm91bmQoY2FwICogMC45Mik7XG4gIGNvbnN0IHJuZyA9IG1ha2VSbmcoc3RhZ2VTZWVkICogMTAwOSArIHdhdmUgKiA3OTE5KTtcbiAgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA0MCAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2soU09VTFMpO1xuICAgIGxldCBzdGFyID0gMTtcbiAgICBpZiAocm5nLm5leHQoKSA8IDAuMzUgJiYgQ09TVFtzb3VsXVsxXSA8PSBsZWZ0KSBzdGFyID0gMjtcbiAgICBpZiAod2F2ZSA+PSA2ICYmIHJuZy5uZXh0KCkgPCAwLjI1ICYmIENPU1Rbc291bF1bMl0gPD0gbGVmdCkgc3RhciA9IDM7XG4gICAgY29uc3QgYyA9IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICAgIGlmIChjIDw9IGxlZnQgJiYgYXJteS5sZW5ndGggPCAxMikgeyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IGM7IH1cbiAgfVxuICByZXR1cm4gYXJteTtcbn1cblxuLyoqIFdoYXQgdGhlIGJ1aWxkIHNjcmVlbiBzaG93czogY291bnRzIHBlciBTb3VsIGFuZCBzdGFyLCBubyBwb3NpdGlvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcHJldmlld1RleHQodzogRW5lbXlTcGVjW10pOiB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH1bXSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXA8c3RyaW5nLCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH0+KCk7XG4gIGZvciAoY29uc3QgZSBvZiB3KSB7XG4gICAgY29uc3QgayA9IGUuc291bCArIGUuc3RhcjtcbiAgICBjb25zdCBjdXIgPSBtYXAuZ2V0KGspO1xuICAgIGlmIChjdXIpIGN1ci5jb3VudCsrOyBlbHNlIG1hcC5zZXQoaywgeyBzb3VsOiBlLnNvdWwsIHN0YXI6IGUuc3RhciwgY291bnQ6IDEgfSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldO1xufVxuIiwgImltcG9ydCB7IENVUlZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuLyoqXG4gKiBSdWxlcyBmb3IgdGhlIHBsYXlhYmxlIFN0YWdlIDEgKDEwIHdhdmVzKTogZG9jIERvbWluaW9uIGN1cnZlLCBib251cyBkcmF3IG9ubHkgb24gdGhlIGVhcmx5IHdhdmVzLlxuICogbWVyZ2UgJ2hhbmRJbnRvT25lU3Rhcic6IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gbWVyZ2Ugc3RyYWlnaHQgaW50byBhIG1hdGNoaW5nIGRlcGxveWVkIDEtc3RhciB1bml0IChwYXlpbmcgb25seSB0aGUgY29zdFxuICogZGlmZmVyZW5jZSkuIFdpdGhvdXQgaXQgdGhlIGNhcCBjYW4gYmxvY2sgYSBtZXJnZSB5b3UgY291bGQgYWZmb3JkICh5b3Ugd291bGQgbmVlZCByb29tIHRvIHN1bW1vbiBCT1RIIGNvcGllcyBmaXJzdCkuXG4gKiBUaGUgZGVidWcgcGFuZWwgY2FuIHN3aXRjaCB0aGlzIGJhY2sgdG8gdGhlIGRvYydzIGRlcGxveWVkLW9ubHkgcnVsZS5cbiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPVFlQRV9SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBDVVJWRVMuZG9jLCBtZXJnZTogJ2hhbmRJbnRvT25lU3RhcicsIHN0YWdlV2F2ZXM6IDEwLCBub3JtYWxEcmF3V2F2ZXM6IFsyLCAzLCA0LCA1XSB9O1xuIiwgIi8vIFRoZSBwbGF5ZXIncyBzYXZlZCBwcm9ncmVzcy4gRnJhbWV3b3JrLWZyZWUgc28gdGhlIGdhbWUgYnVuZGxlIGFuZCB0aGUgbmF2aWdhdGlvbiBzaGVsbCBib3RoIHVzZSBpdC5cbi8vIFN0b3JlZCBpbiBsb2NhbFN0b3JhZ2UgYXMgSlNPTi4gRXZlcnkgcmVhZC93cml0ZSBpcyBndWFyZGVkOiBwcml2YXRlIHdpbmRvd3MgYW5kIGJsb2NrZWQgc3RvcmFnZSBtdXN0IG5ldmVyIGJyZWFrIHRoZSBnYW1lLlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBjb25zdCBERUNLX1NJWkUgPSA2OyAgICAgICAgICAgICAgICAgICAgIC8vIGRvYzogc2l4IGVxdWlwcGVkIFNvdWxzIHBlciBzdGFnZVxuY29uc3QgS0VZID0gJ25lY3JvLXNhdmUnO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCB0eXBlIERpZmZpY3VsdHkgPSAnZWFzeScgfCAnbm9ybWFsJyB8ICdoYXJkJyB8ICduaWdodG1hcmUnO1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVElFUzogRGlmZmljdWx0eVtdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuZXhwb3J0IGludGVyZmFjZSBTZXR0aW5ncyB7IG11c2ljOiBib29sZWFuOyBzZng6IGJvb2xlYW4gfVxuZXhwb3J0IGludGVyZmFjZSBTb3VsUHJvZ3Jlc3MgeyBsZXZlbDogbnVtYmVyOyBjb3BpZXM6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNhdmUge1xuICB2OiBudW1iZXI7XG4gIGRlY2s6IFNvdWxJZFtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBlcXVpcHBlZCBTb3VscywgYXQgbW9zdCBERUNLX1NJWkUsIGF0IGxlYXN0IDFcbiAgc291bHM6IFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47ICAgICAgICAgIC8vIFBMQUNFSE9MREVSIHByb2dyZXNzaW9uIHVudGlsIHBhY2tzIGV4aXN0XG4gIHNldHRpbmdzOiBTZXR0aW5nczsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzb3VuZCBzd2l0Y2hlczsgYm90aCBvbiBieSBkZWZhdWx0XG4gIGRpZmZpY3VsdHk6IERpZmZpY3VsdHk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBjaG9zZW4gb24gSG9tZTsgYXBwbGllcyB0byB0aGUgbmV4dCBydW5cbn1cbmV4cG9ydCBpbnRlcmZhY2UgU3RvcmUgeyBnZXRJdGVtKGs6IHN0cmluZyk6IHN0cmluZyB8IG51bGw7IHNldEl0ZW0oazogc3RyaW5nLCB2OiBzdHJpbmcpOiB2b2lkIH1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRTYXZlKCk6IFNhdmUge1xuICBjb25zdCBzb3VscyA9IHt9IGFzIFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47XG4gIGZvciAoY29uc3QgaWQgb2YgU09VTFMpIHNvdWxzW2lkXSA9IHsgbGV2ZWw6IDEsIGNvcGllczogMCB9O1xuICByZXR1cm4geyB2OiBWRVJTSU9OLCBkZWNrOiBTT1VMUy5zbGljZSgwLCBERUNLX1NJWkUpLCBzb3Vscywgc2V0dGluZ3M6IHsgbXVzaWM6IHRydWUsIHNmeDogdHJ1ZSB9LCBkaWZmaWN1bHR5OiAnbm9ybWFsJyB9O1xufVxuXG5mdW5jdGlvbiBicm93c2VyU3RvcmUoKTogU3RvcmUgfCBudWxsIHsgdHJ5IHsgcmV0dXJuIHR5cGVvZiBsb2NhbFN0b3JhZ2UgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGxvY2FsU3RvcmFnZTsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9IH1cblxuLyoqIFJlcGFpciB3aGF0ZXZlciB3YXMgc3RvcmVkOiB1bmtub3duIFNvdWxzIGRyb3BwZWQsIGR1cGxpY2F0ZXMgcmVtb3ZlZCwgZGVjayBjYXBwZWQsIG5vdGhpbmcgZW1wdHkuIE9sZCB2ZXJzaW9ucyBrZWVwIHRoZWlyIHByb2dyZXNzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplKHJhdzogYW55KTogU2F2ZSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0U2F2ZSgpO1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IGRlY2s6IFNvdWxJZFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5kZWNrKSkgZm9yIChjb25zdCBkIG9mIHJhdy5kZWNrKSBpZiAoU09VTFMuaW5jbHVkZXMoZCkgJiYgIWRlY2suaW5jbHVkZXMoZCkgJiYgZGVjay5sZW5ndGggPCBERUNLX1NJWkUpIGRlY2sucHVzaChkKTtcbiAgaWYgKGRlY2subGVuZ3RoKSBiYXNlLmRlY2sgPSBkZWNrO1xuICBpZiAocmF3LnNvdWxzICYmIHR5cGVvZiByYXcuc291bHMgPT09ICdvYmplY3QnKSB7XG4gICAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykge1xuICAgICAgY29uc3QgcCA9IHJhdy5zb3Vsc1tpZF07XG4gICAgICBpZiAocCAmJiBOdW1iZXIuaXNGaW5pdGUocC5sZXZlbCkgJiYgTnVtYmVyLmlzRmluaXRlKHAuY29waWVzKSkgYmFzZS5zb3Vsc1tpZF0gPSB7IGxldmVsOiBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHAubGV2ZWwpKSwgY29waWVzOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHAuY29waWVzKSkgfTtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5zZXR0aW5ncyAmJiB0eXBlb2YgcmF3LnNldHRpbmdzID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLm11c2ljID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3MubXVzaWMgPSByYXcuc2V0dGluZ3MubXVzaWM7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3Muc2Z4ID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3Muc2Z4ID0gcmF3LnNldHRpbmdzLnNmeDtcbiAgfVxuICBpZiAoRElGRklDVUxUSUVTLmluY2x1ZGVzKHJhdy5kaWZmaWN1bHR5KSkgYmFzZS5kaWZmaWN1bHR5ID0gcmF3LmRpZmZpY3VsdHk7XG4gIHJldHVybiBiYXNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbG9hZFNhdmUoc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2F2ZSB7XG4gIHRyeSB7IGNvbnN0IHQgPSBzdG9yZSAmJiBzdG9yZS5nZXRJdGVtKEtFWSk7IHJldHVybiBzYW5pdGl6ZSh0ID8gSlNPTi5wYXJzZSh0KSA6IG51bGwpOyB9IGNhdGNoIHsgcmV0dXJuIGRlZmF1bHRTYXZlKCk7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHdyaXRlU2F2ZShzYXZlOiBTYXZlLCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlKSBzdG9yZS5zZXRJdGVtKEtFWSwgSlNPTi5zdHJpbmdpZnkoc2F2ZSkpOyB9IGNhdGNoIHsgLyogc3RvcmFnZSBmdWxsIG9yIGJsb2NrZWQ6IGtlZXAgcGxheWluZyAqLyB9XG59XG5cbi8qKiBDaGFuZ2Ugc291bmQgc2V0dGluZ3Mgd2l0aG91dCB0b3VjaGluZyB0aGUgcmVzdCBvZiB0aGUgc2F2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1cGRhdGVTZXR0aW5ncyhwYXRjaDogUGFydGlhbDxTZXR0aW5ncz4sIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IFNldHRpbmdzIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgcy5zZXR0aW5ncyA9IHsgLi4ucy5zZXR0aW5ncywgLi4ucGF0Y2ggfTsgd3JpdGVTYXZlKHMsIHN0b3JlKTsgcmV0dXJuIHMuc2V0dGluZ3M7XG59XG5cbi8qKiBSZW1lbWJlciB0aGUgY2hvc2VuIGRpZmZpY3VsdHkgd2l0aG91dCB0b3VjaGluZyB0aGUgcmVzdCBvZiB0aGUgc2F2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1cGRhdGVEaWZmaWN1bHR5KGQ6IERpZmZpY3VsdHksIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IERpZmZpY3VsdHkge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLmRpZmZpY3VsdHkgPSBESUZGSUNVTFRJRVMuaW5jbHVkZXMoZCkgPyBkIDogcy5kaWZmaWN1bHR5OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5kaWZmaWN1bHR5O1xufVxuIiwgIi8vIFRoZSBwbGF5ZXIncyBjaGFyYWN0ZXI6IHRoZSBOZWNyb21hbmNlci4gQSBwcm9jZWR1cmFsIHBsYWNlaG9sZGVyIChubyBUcmlwbyBtb2RlbCB5ZXQpOiBob29kZWQgcm9iZSwgZ2xvd2luZyBwdXJwbGUgZXllcywgY3J5c3RhbCBzdGFmZi5cbi8vIEhlIHN0YW5kcyBiZXNpZGUgdGhlIGdyaWQsIHRha2VzIHRoZSBoaXQgd2hlbiBhbiBhcm15IGlzIHdpcGVkIChoZWFydHMgYXJlIEhJUyBoZWFsdGgpLCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUgYW5kIHJhaXNlc1xuLy8gdGhlIGZhbGxlbi4gRXZlcnl0aGluZyBoZXJlIGlzIGFuaW1hdGlvbiBvbmx5OyB0aGUgcnVsZXMgbGl2ZSBpbiBjb3JlL3J1bGVzLnRzLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5cbmV4cG9ydCBjbGFzcyBOZWNyb21hbmNlciB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbjsgbG9jYWwgK1ogaXMgaGlzIGZhY2luZyAodGhlIGdhbWUgcm90YXRlcyBoaW0gdG8gZmFjZSB0aGUgYmF0dGxlZmllbGQpXG4gIHByaXZhdGUgcmlnOiBhbnk7IHByaXZhdGUgc3RhZmZQaXZvdDogYW55OyBwcml2YXRlIGNyeXN0YWw6IGFueTsgcHJpdmF0ZSBjcnlzdGFsTWF0OiBhbnk7IHByaXZhdGUgcm9iZU1hdDogYW55OyBwcml2YXRlIGV5ZU1hdDogYW55OyBwcml2YXRlIHBzOiBhbnk7IHByaXZhdGUgZ2xvdzogYW55O1xuICBwcml2YXRlIHQgPSAwOyBwcml2YXRlIGh1cnRUID0gMDsgcHJpdmF0ZSBjYXN0VCA9IDA7IHByaXZhdGUgZG93biA9IDA7IHByaXZhdGUgZG93blRhcmdldCA9IDA7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSBzY2VuZTogYW55LCBwcml2YXRlIHNvZnQ6IGFueSkge1xuICAgIGNvbnN0IHMgPSBzY2VuZSwgbWF0ID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGVyID0gMCwgZWcgPSAwLCBlYiA9IDApID0+IHtcbiAgICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdubScsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKGVyLCBlZywgZWIpOyBtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyByZXR1cm4gbTtcbiAgICB9O1xuICAgIGNvbnN0IGdsb3dNYXQgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYSA9IDEpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ25nJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHIsIGcsIGIpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYWxwaGEgPSBhOyByZXR1cm4gbTsgfTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ25lY3JvJywgcyk7IHRoaXMucmlnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbmVjcm9SaWcnLCBzKTsgdGhpcy5yaWcucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgY29uc3QgYWRkID0gKG1lc2g6IGFueSwgcGFyZW50ID0gdGhpcy5yaWcpID0+IHsgbWVzaC5wYXJlbnQgPSBwYXJlbnQ7IG1lc2guaXNQaWNrYWJsZSA9IGZhbHNlOyByZXR1cm4gbWVzaDsgfTtcbiAgICB0aGlzLnJvYmVNYXQgPSBtYXQoMC4wOSwgMC4wMywgMC4xNiwgMC4wNSwgMC4wMiwgMC4xKTtcbiAgICBjb25zdCByb2JlID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3JvYmUnLCB7IGhlaWdodDogMC44MiwgZGlhbWV0ZXJUb3A6IDAuMywgZGlhbWV0ZXJCb3R0b206IDAuOCwgdGVzc2VsbGF0aW9uOiAyMCB9LCBzKSk7IHJvYmUucG9zaXRpb24ueSA9IDAuNDE7IHJvYmUubWF0ZXJpYWwgPSB0aGlzLnJvYmVNYXQ7XG4gICAgY29uc3QgaGVtID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2hlbScsIHsgZGlhbWV0ZXI6IDAuNzgsIHRoaWNrbmVzczogMC4wMzUsIHRlc3NlbGxhdGlvbjogMjggfSwgcykpOyBoZW0ucG9zaXRpb24ueSA9IDAuMDM7IGhlbS5tYXRlcmlhbCA9IGdsb3dNYXQoMC45LCAwLjcsIDAuMjUpO1xuICAgIGNvbnN0IG1hbnRsZSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnbWFudGxlJywgeyBkaWFtZXRlcjogMC42LCBzZWdtZW50czogMTIgfSwgcykpOyBtYW50bGUuc2NhbGluZy5zZXQoMSwgMC41LCAwLjgpOyBtYW50bGUucG9zaXRpb24ueSA9IDAuODsgbWFudGxlLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IGhvb2QgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2hvb2QnLCB7IGRpYW1ldGVyOiAwLjU2LCBzZWdtZW50czogMTQgfSwgcykpOyBob29kLnBvc2l0aW9uLnkgPSAxLjA7IGhvb2QubWF0ZXJpYWwgPSB0aGlzLnJvYmVNYXQ7XG4gICAgY29uc3QgdGlwID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3RpcCcsIHsgaGVpZ2h0OiAwLjQsIGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogMC4zNCwgdGVzc2VsbGF0aW9uOiAxNCB9LCBzKSk7IHRpcC5wb3NpdGlvbi5zZXQoMCwgMS4yOCwgLTAuMDYpOyB0aXAucm90YXRpb24ueCA9IC0wLjM1OyB0aXAubWF0ZXJpYWwgPSB0aGlzLnJvYmVNYXQ7XG4gICAgY29uc3QgZmFjZSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZmFjZScsIHsgZGlhbWV0ZXI6IDAuMzgsIHNlZ21lbnRzOiAxMiB9LCBzKSk7IGZhY2UucG9zaXRpb24uc2V0KDAsIDAuOTksIDAuMTIpOyBmYWNlLm1hdGVyaWFsID0gbWF0KDAuMDIsIDAsIDAuMDUpO1xuICAgIHRoaXMuZXllTWF0ID0gZ2xvd01hdCgwLjksIDAuNCwgMSk7XG4gICAgZm9yIChjb25zdCB4IG9mIFstMC4wNzUsIDAuMDc1XSkgeyBjb25zdCBlID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdleWUnLCB7IGRpYW1ldGVyOiAwLjA3NSwgc2VnbWVudHM6IDggfSwgcykpOyBlLnBvc2l0aW9uLnNldCh4LCAxLjAsIDAuMjg1KTsgZS5zY2FsaW5nLnogPSAwLjY7IGUubWF0ZXJpYWwgPSB0aGlzLmV5ZU1hdDsgfVxuICAgIHRoaXMuZ2xvdyA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdleWVHbG93JywgeyBzaXplOiAwLjUgfSwgcykpOyB0aGlzLmdsb3cucG9zaXRpb24uc2V0KDAsIDEuMCwgMC4zMyk7IHRoaXMuZ2xvdy5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMO1xuICAgIGNvbnN0IGdtID0gZ2xvd01hdCgwLjcsIDAuMjUsIDEsIDAuNTUpOyBnbS5lbWlzc2l2ZVRleHR1cmUgPSBzb2Z0OyBnbS5vcGFjaXR5VGV4dHVyZSA9IHNvZnQ7IHRoaXMuZ2xvdy5tYXRlcmlhbCA9IGdtO1xuICAgIGNvbnN0IGhhbmQgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2hhbmQnLCB7IGRpYW1ldGVyOiAwLjEyLCBzZWdtZW50czogOCB9LCBzKSk7IGhhbmQucG9zaXRpb24uc2V0KC0wLjMyLCAwLjYyLCAwLjEyKTsgaGFuZC5tYXRlcmlhbCA9IG1hdCgwLjgsIDAuNzUsIDAuNjUpO1xuICAgIC8vIHN0YWZmOiBwaXZvdCBhdCB0aGUgcmlnaHQgaGFuZCBzbyByYWlzaW5nIGl0IGlzIG9uZSByb3RhdGlvblxuICAgIHRoaXMuc3RhZmZQaXZvdCA9IGFkZChuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdzdGFmZlBpdm90JywgcykpOyB0aGlzLnN0YWZmUGl2b3QucG9zaXRpb24uc2V0KDAuMzQsIDAuNiwgMC4xNCk7XG4gICAgY29uc3Qgcm9kID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3JvZCcsIHsgaGVpZ2h0OiAxLjUsIGRpYW1ldGVyOiAwLjA0NSwgdGVzc2VsbGF0aW9uOiA4IH0sIHMpLCB0aGlzLnN0YWZmUGl2b3QpOyByb2QucG9zaXRpb24ueSA9IDAuNDU7IHJvZC5tYXRlcmlhbCA9IG1hdCgwLjI4LCAwLjE3LCAwLjEpO1xuICAgIHRoaXMuY3J5c3RhbE1hdCA9IGdsb3dNYXQoMC43NSwgMC4zNSwgMSk7XG4gICAgdGhpcy5jcnlzdGFsID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUG9seWhlZHJvbignY3J5c3RhbCcsIHsgdHlwZTogMSwgc2l6ZTogMC4xMiB9LCBzKSwgdGhpcy5zdGFmZlBpdm90KTsgdGhpcy5jcnlzdGFsLnBvc2l0aW9uLnkgPSAxLjI4OyB0aGlzLmNyeXN0YWwuc2NhbGluZy55ID0gMS41OyB0aGlzLmNyeXN0YWwucm90YXRpb24ueCA9IDAuNDsgdGhpcy5jcnlzdGFsLm1hdGVyaWFsID0gdGhpcy5jcnlzdGFsTWF0O1xuICAgIGNvbnN0IHJpbmcgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdiYXNlJywgeyByYWRpdXM6IDAuNjIsIHRlc3NlbGxhdGlvbjogMzAgfSwgcyksIHRoaXMuaG9sZGVyKTsgcmluZy5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHJpbmcubWF0ZXJpYWwgPSBnbG93TWF0KDAuNCwgMC4xNSwgMC43NSwgMC41NSk7XG4gICAgLy8gYXVyYVxuICAgIGNvbnN0IHBzID0gdGhpcy5wcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCduZWNyb0F1cmEnLCA4MCwgcyk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHNvZnQ7IHBzLmVtaXR0ZXIgPSB0aGlzLmhvbGRlcjtcbiAgICBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4zLCAwLCAtMC4zKTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4zLCAwLjksIDAuMyk7IHBzLm1pbkxpZmVUaW1lID0gMC42OyBwcy5tYXhMaWZlVGltZSA9IDEuMztcbiAgICBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xNSwgMC45LCAtMC4xNSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMTUsIDEuNiwgMC4xNSk7IHBzLm1pbkVtaXRQb3dlciA9IDAuMzsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApO1xuICAgIHBzLm1pblNpemUgPSAwLjA3OyBwcy5tYXhTaXplID0gMC4yOyBwcy5lbWl0UmF0ZSA9IDMwOyBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC44LCAwLjM1LCAxLCAwLjcpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC40NSwgMC4xNSwgMC45LCAwLjUpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4yLCAwLCAwLjQsIDApO1xuICAgIHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMuc3RhcnQoKTtcbiAgfVxuXG4gIHNldEVuYWJsZWQob246IGJvb2xlYW4pIHsgdGhpcy5ob2xkZXIuc2V0RW5hYmxlZChvbik7IGlmIChvbikgdGhpcy5wcy5zdGFydCgpOyBlbHNlIHRoaXMucHMuc3RvcCgpOyB9XG4gIC8qKiBXb3JsZCBwb3NpdGlvbiBvZiB0aGUgc3RhZmYgY3J5c3RhbCAoZm9yIHNwZWxsIGVmZmVjdHMpLiAqL1xuICBjcnlzdGFsUG9zKCk6IGFueSB7IHRoaXMuaG9sZGVyLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgdGhpcy5yaWcuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpOyB0aGlzLnN0YWZmUGl2b3QuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpOyB0aGlzLmNyeXN0YWwuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpOyByZXR1cm4gdGhpcy5jcnlzdGFsLmdldEFic29sdXRlUG9zaXRpb24oKS5jbG9uZSgpOyB9XG5cbiAgaHVydCgpIHsgdGhpcy5odXJ0VCA9IDAuODsgfVxuICBjYXN0KCkgeyB0aGlzLmNhc3RUID0gMS4xOyB9XG4gIC8qKiBUaGUgbGFzdCBoZWFydCBpcyBnb25lOiBoZSBzaW5rcyB0byBoaXMga25lZXMsIHRoZSBleWVzIGRpbS4gKi9cbiAgZGVmZWF0KCkgeyB0aGlzLmRvd25UYXJnZXQgPSAxOyB9XG4gIHJldml2ZSgpIHsgdGhpcy5kb3duVGFyZ2V0ID0gMDsgdGhpcy5odXJ0VCA9IDA7IHRoaXMuY2FzdFQgPSAwOyB9XG5cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLnQgKz0gZHQ7XG4gICAgdGhpcy5kb3duICs9ICh0aGlzLmRvd25UYXJnZXQgLSB0aGlzLmRvd24pICogTWF0aC5taW4oMSwgZHQgKiAzKTtcbiAgICBjb25zdCBib2IgPSBNYXRoLnNpbih0aGlzLnQgKiAyKSAqIDAuMDM1ICogKDEgLSB0aGlzLmRvd24pO1xuICAgIGxldCByZWNvaWwgPSAwLCBmbGFzaCA9IDA7XG4gICAgaWYgKHRoaXMuaHVydFQgPiAwKSB7IHRoaXMuaHVydFQgPSBNYXRoLm1heCgwLCB0aGlzLmh1cnRUIC0gZHQpOyBjb25zdCB1ID0gdGhpcy5odXJ0VCAvIDAuODsgcmVjb2lsID0gTWF0aC5zaW4odSAqIE1hdGguUEkpICogMC40MjsgZmxhc2ggPSB1OyB9XG4gICAgbGV0IHJhaXNlID0gMDtcbiAgICBpZiAodGhpcy5jYXN0VCA+IDApIHsgdGhpcy5jYXN0VCA9IE1hdGgubWF4KDAsIHRoaXMuY2FzdFQgLSBkdCk7IGNvbnN0IHUgPSB0aGlzLmNhc3RUIC8gMS4xOyByYWlzZSA9IE1hdGguc2luKE1hdGgubWluKDEsICgxIC0gdSkgKiAxLjYpICogTWF0aC5QSSAqIDAuNSkgKiAodSA+IDAuMjUgPyAxIDogdSAvIDAuMjUpOyB9XG4gICAgdGhpcy5yaWcucG9zaXRpb24ueSA9IGJvYiAtIDAuMjggKiB0aGlzLmRvd247IHRoaXMucmlnLnJvdGF0aW9uLnggPSAtcmVjb2lsICsgMC45ICogdGhpcy5kb3duOyB0aGlzLnJpZy5yb3RhdGlvbi56ID0gTWF0aC5zaW4odGhpcy50ICogMS4zKSAqIDAuMDMgKyBNYXRoLnNpbih0aGlzLmh1cnRUICogNjApICogMC4wMyAqICh0aGlzLmh1cnRUID4gMCA/IDEgOiAwKTtcbiAgICB0aGlzLnN0YWZmUGl2b3Qucm90YXRpb24ueiA9IC0wLjE1ICogcmFpc2UgLSAwLjA1OyB0aGlzLnN0YWZmUGl2b3Qucm90YXRpb24ueCA9IC0wLjQ1ICogcmFpc2U7IHRoaXMuc3RhZmZQaXZvdC5wb3NpdGlvbi55ID0gMC42ICsgMC4zNSAqIHJhaXNlO1xuICAgIHRoaXMuY3J5c3RhbC5yb3RhdGlvbi55ICs9IGR0ICogKDIgKyA2ICogcmFpc2UpOyBjb25zdCBwdWxzZSA9IDEgKyAwLjEyICogTWF0aC5zaW4odGhpcy50ICogNCkgKyAxLjEgKiByYWlzZTsgdGhpcy5jcnlzdGFsLnNjYWxpbmcuc2V0KHB1bHNlLCAxLjUgKiBwdWxzZSwgcHVsc2UpO1xuICAgIGNvbnN0IGRpbSA9IDEgLSAwLjg1ICogdGhpcy5kb3duO1xuICAgIHRoaXMuY3J5c3RhbE1hdC5lbWlzc2l2ZUNvbG9yLnNldCgoMC43NSArIDAuMjUgKiByYWlzZSkgKiBkaW0sICgwLjM1ICsgMC40ICogcmFpc2UpICogZGltLCAxICogZGltKTtcbiAgICB0aGlzLmV5ZU1hdC5lbWlzc2l2ZUNvbG9yLnNldCgwLjkgKiBkaW0gKyBmbGFzaCAqIDAuMSwgKDAuNCArIDAuMjUgKiByYWlzZSkgKiBkaW0gKiAoMSAtIGZsYXNoICogMC42KSwgMSAqIGRpbSAqICgxIC0gZmxhc2ggKiAwLjcpKTtcbiAgICB0aGlzLnJvYmVNYXQuZW1pc3NpdmVDb2xvci5zZXQoMC4wNSArIGZsYXNoICogMC42LCAwLjAyLCAwLjEgKiAoMSAtIGZsYXNoKSk7XG4gICAgdGhpcy5nbG93LnNjYWxpbmcuc2V0QWxsKDAuNiArIDAuOSAqIGRpbSArIHJhaXNlICogMC44KTtcbiAgICB0aGlzLnBzLmVtaXRSYXRlID0gKDMwICsgOTAgKiByYWlzZSkgKiBkaW07XG4gIH1cblxuICBkaXNwb3NlKCkgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuIiwgIi8vIEFsbCBzb3VuZCBpcyBzeW50aGVzaXplZCBpbiB0aGUgYnJvd3NlciB3aXRoIHRoZSBXZWIgQXVkaW8gQVBJOiBubyBhdWRpbyBmaWxlcyB0byBkb3dubG9hZCwgbGljZW5zZSBvciBzaGlwLlxuLy8gVHdvIGluZGVwZW5kZW50IHN3aXRjaGVzIChtdXNpYywgc291bmQgZWZmZWN0cyksIHNhdmVkIGluIHRoZSBwbGF5ZXIncyBzYXZlLiBQaG9uZXMgb25seSBhbGxvdyBzb3VuZCBhZnRlciBhIHRhcCwgc28gbm90aGluZyBzdGFydHNcbi8vIHVudGlsIHRoZSBmaXJzdCB0b3VjaC9jbGljayAoYHVubG9ja2ApLlxuaW1wb3J0IHsgbG9hZFNhdmUsIHVwZGF0ZVNldHRpbmdzIH0gZnJvbSAnLi4vY29yZS9zYXZlLnRzJztcblxuZXhwb3J0IHR5cGUgU2Z4ID0gJ3RhcCcgfCAnc3VtbW9uJyB8ICdtZXJnZScgfCAnaGl0JyB8ICdoaXRBcnJvdycgfCAnc21hc2gnIHwgJ2Fycm93JyB8ICdkZWF0aCcgfCAnY2FzdCcgfCAndGF1bnQnIHwgJ3Nob2Nrd2F2ZScgfCAncmVzdXJyZWN0JyB8ICdoZWFydExvc3QnIHwgJ3ZpY3RvcnknIHwgJ2RlZmVhdCcgfCAnc3RhcnQnO1xuZXhwb3J0IHR5cGUgTW9kZSA9ICdidWlsZCcgfCAnYmF0dGxlJztcblxuLy8gTXVzaWM6IEEgbWlub3IsIDgwIGJwbSwgZm91ciBiYXJzIGxvb3BpbmcgKEFtLCBGLCBDLCBFKS4gUm9vdCBub3RlIGZpcnN0LCB0aGVuIGNob3JkIHRvbmVzIChIeikuXG5jb25zdCBDSE9SRFM6IG51bWJlcltdW10gPSBbXG4gIFsxMTAsIDE2NC44MSwgMjIwLCAyNjEuNjMsIDMyOS42M10sXG4gIFs4Ny4zMSwgMTMwLjgxLCAxNzQuNjEsIDIyMCwgMjYxLjYzXSxcbiAgWzEzMC44MSwgMTk2LCAyNjEuNjMsIDMyOS42MywgMzkyXSxcbiAgWzgyLjQxLCAxMjMuNDcsIDE2NC44MSwgMjA3LjY1LCAyNDYuOTRdLFxuXTtcbmNvbnN0IEJFQVQgPSA2MCAvIDgwO1xuXG5jbGFzcyBBdWRpb0VuZ2luZSB7XG4gIHByaXZhdGUgY3R4OiBBdWRpb0NvbnRleHQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBtYXN0ZXIhOiBHYWluTm9kZTsgcHJpdmF0ZSBtdXNpY0J1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIHNmeEJ1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIG5vaXNlQnVmITogQXVkaW9CdWZmZXI7XG4gIG11c2ljID0gdHJ1ZTsgc2Z4ID0gdHJ1ZTsgbW9kZTogTW9kZSA9ICdidWlsZCc7XG4gIHByaXZhdGUgdGltZXIgPSAwOyBwcml2YXRlIG5leHRUID0gMDsgcHJpdmF0ZSBiZWF0ID0gMDsgcHJpdmF0ZSBzdGFtcHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcigpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB9XG5cbiAgcHJpdmF0ZSBzaWxlbnQ6IEhUTUxBdWRpb0VsZW1lbnQgfCBudWxsID0gbnVsbDsgcHJpdmF0ZSBwcmltZWQgPSBmYWxzZTtcbiAgLyoqIGlQaG9uZXMgbXV0ZSBXZWIgQXVkaW8gd2hlbiB0aGUgcmluZ2VyIHN3aXRjaCBpcyBvbiwgdW5sZXNzIHRoZSBwYWdlIGlzIHBsYXlpbmcgXCJyZWFsXCIgbWVkaWEuIEEgc2lsZW50IGxvb3BpbmcgPGF1ZGlvPiBlbGVtZW50IChwbHVzIHRoZVxuICAgKiAgYXVkaW9TZXNzaW9uIGhpbnQgb24gbmV3ZXIgaU9TKSBtb3ZlcyB0aGUgcGFnZSB0byB0aGUgcGxheWJhY2sgY2hhbm5lbCwgc28gdGhlIGdhbWUgaXMgaGVhcmQgZXZlbiB3aXRoIHRoZSBzd2l0Y2ggb24gc2lsZW50LiAqL1xuICBwcml2YXRlIHBsYXliYWNrQ2hhbm5lbCgpIHtcbiAgICB0cnkgeyBjb25zdCBhID0gKG5hdmlnYXRvciBhcyBhbnkpLmF1ZGlvU2Vzc2lvbjsgaWYgKGEpIGEudHlwZSA9ICdwbGF5YmFjayc7IH0gY2F0Y2ggeyAvKiBub3Qgc3VwcG9ydGVkICovIH1cbiAgICBpZiAodGhpcy5zaWxlbnQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbiA9IDQ0MSwgYnVmID0gbmV3IEFycmF5QnVmZmVyKDQ0ICsgbiAqIDIpLCB2ID0gbmV3IERhdGFWaWV3KGJ1ZiksIHN0ciA9IChvOiBudW1iZXIsIHQ6IHN0cmluZykgPT4geyBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspIHYuc2V0VWludDgobyArIGksIHQuY2hhckNvZGVBdChpKSk7IH07XG4gICAgICBzdHIoMCwgJ1JJRkYnKTsgdi5zZXRVaW50MzIoNCwgMzYgKyBuICogMiwgdHJ1ZSk7IHN0cig4LCAnV0FWRScpOyBzdHIoMTIsICdmbXQgJyk7IHYuc2V0VWludDMyKDE2LCAxNiwgdHJ1ZSk7IHYuc2V0VWludDE2KDIwLCAxLCB0cnVlKTsgdi5zZXRVaW50MTYoMjIsIDEsIHRydWUpO1xuICAgICAgdi5zZXRVaW50MzIoMjQsIDQ0MTAwLCB0cnVlKTsgdi5zZXRVaW50MzIoMjgsIDg4MjAwLCB0cnVlKTsgdi5zZXRVaW50MTYoMzIsIDIsIHRydWUpOyB2LnNldFVpbnQxNigzNCwgMTYsIHRydWUpOyBzdHIoMzYsICdkYXRhJyk7IHYuc2V0VWludDMyKDQwLCBuICogMiwgdHJ1ZSk7XG4gICAgICBjb25zdCBlbCA9IG5ldyBBdWRpbyhVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtidWZdLCB7IHR5cGU6ICdhdWRpby93YXYnIH0pKSk7IGVsLmxvb3AgPSB0cnVlOyBlbC52b2x1bWUgPSAwLjAxOyBlbC5zZXRBdHRyaWJ1dGUoJ3BsYXlzaW5saW5lJywgJycpOyB0aGlzLnNpbGVudCA9IGVsO1xuICAgICAgZWwucGxheSgpLmNhdGNoKCgpID0+IHsgdGhpcy5zaWxlbnQgPSBudWxsOyB9KTtcbiAgICB9IGNhdGNoIHsgLyogZmluZTogc291bmQgc3RpbGwgd29ya3MsIGp1c3QgZm9sbG93cyB0aGUgc2lsZW50IHN3aXRjaCAqLyB9XG4gIH1cbiAgLyoqIFdoYXQgdGhlIFNldHRpbmdzIHBhZ2Ugc2hvd3Mgc28gYSBzaWxlbnQgcGhvbmUgY2FuIGJlIGRpYWdub3NlZC4gKi9cbiAgc3RhdHVzKCk6IHsgc3RhdGU6IHN0cmluZzsgdW5sb2NrZWQ6IGJvb2xlYW4gfSB7IHJldHVybiB7IHN0YXRlOiB0aGlzLmN0eCA/IHRoaXMuY3R4LnN0YXRlIDogJ25vdCBzdGFydGVkJywgdW5sb2NrZWQ6ICEhdGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgPT09ICdydW5uaW5nJyB9OyB9XG4gIC8qKiBUaGUgU2V0dGluZ3MgcGFnZSdzIFRlc3Qgc291bmQgYnV0dG9uOiB1bmxvY2sgYW5kIG1ha2UgYSBjbGVhcmx5IGF1ZGlibGUgc291bmQuICovXG4gIHRlc3QoKSB7IHRoaXMudW5sb2NrKCk7IGNvbnN0IHQgPSAoKSA9PiB7IHRoaXMucGxheSgndmljdG9yeScpOyB9OyBpZiAodGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkudGhlbih0KS5jYXRjaCgoKSA9PiB7fSk7IGVsc2UgdCgpOyB9XG5cbiAgLyoqIENhbGwgZnJvbSBhIHVzZXIgZ2VzdHVyZSAodGFwL2NsaWNrKS4gU2FmZSB0byBjYWxsIHJlcGVhdGVkbHkuICovXG4gIHVubG9jaygpIHtcbiAgICB0aGlzLnBsYXliYWNrQ2hhbm5lbCgpO1xuICAgIGlmICghdGhpcy5jdHgpIHtcbiAgICAgIGNvbnN0IEMgPSAod2luZG93IGFzIGFueSkuQXVkaW9Db250ZXh0IHx8ICh3aW5kb3cgYXMgYW55KS53ZWJraXRBdWRpb0NvbnRleHQ7IGlmICghQykgcmV0dXJuO1xuICAgICAgY29uc3QgY3R4OiBBdWRpb0NvbnRleHQgPSB0aGlzLmN0eCA9IG5ldyBDKCk7XG4gICAgICBjb25zdCBjb21wID0gY3R4LmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvcigpOyBjb21wLmNvbm5lY3QoY3R4LmRlc3RpbmF0aW9uKTtcbiAgICAgIHRoaXMubWFzdGVyID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tYXN0ZXIuZ2Fpbi52YWx1ZSA9IDAuOTsgdGhpcy5tYXN0ZXIuY29ubmVjdChjb21wKTtcbiAgICAgIHRoaXMubXVzaWNCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm11c2ljQnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpOyB0aGlzLnNmeEJ1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMuc2Z4QnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpO1xuICAgICAgY3R4Lm9uc3RhdGVjaGFuZ2UgPSAoKSA9PiB7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tYXVkaW8tc3RhdGUnKSk7IH07XG4gICAgICBjb25zdCBsZW4gPSBjdHguc2FtcGxlUmF0ZTsgdGhpcy5ub2lzZUJ1ZiA9IGN0eC5jcmVhdGVCdWZmZXIoMSwgbGVuLCBjdHguc2FtcGxlUmF0ZSk7IGNvbnN0IGQgPSB0aGlzLm5vaXNlQnVmLmdldENoYW5uZWxEYXRhKDApOyBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKSBkW2ldID0gTWF0aC5yYW5kb20oKSAqIDIgLSAxO1xuICAgIH1cbiAgICBpZiAodGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkuY2F0Y2goKCkgPT4ge30pOyAgICAgICAgICAgICAvLyAnc3VzcGVuZGVkJyBvciAoaU9TKSAnaW50ZXJydXB0ZWQnXG4gICAgaWYgKCF0aGlzLnByaW1lZCkgeyB0aGlzLnByaW1lZCA9IHRydWU7IHRyeSB7IGNvbnN0IGIgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXIoMSwgMSwgMjIwNTApLCBzID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyU291cmNlKCk7IHMuYnVmZmVyID0gYjsgcy5jb25uZWN0KHRoaXMuY3R4LmRlc3RpbmF0aW9uKTsgcy5zdGFydCgwKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9IH1cbiAgICB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTtcbiAgfVxuXG4gIHNldE11c2ljKG9uOiBib29sZWFuKSB7IHRoaXMubXVzaWMgPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBtdXNpYzogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyB9XG4gIHNldFNmeChvbjogYm9vbGVhbikgeyB0aGlzLnNmeCA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IHNmeDogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyBpZiAob24pIHRoaXMucGxheSgndGFwJyk7IH1cbiAgLyoqIFJlLXJlYWQgdGhlIHNhdmVkIHN3aXRjaGVzICh0aGUgc2hlbGwncyBTZXR0aW5ncyBwYWdlIGNoYW5nZXMgdGhlbSB0b28pLiAqL1xuICByZWxvYWQoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IH1cbiAgc2V0TW9kZShtOiBNb2RlKSB7IHRoaXMubW9kZSA9IG07IH1cblxuICBwcml2YXRlIGFwcGx5R2FpbnMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuOyBjb25zdCB0ID0gdGhpcy5jdHguY3VycmVudFRpbWU7XG4gICAgdGhpcy5tdXNpY0J1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLm11c2ljID8gMC41IDogMCwgdCwgMC4xNSk7IHRoaXMuc2Z4QnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMuc2Z4ID8gMC44IDogMCwgdCwgMC4wNSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbXVzaWNcbiAgcHJpdmF0ZSBzeW5jTXVzaWMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLm11c2ljICYmICF0aGlzLnRpbWVyKSB7IHRoaXMubmV4dFQgPSB0aGlzLmN0eC5jdXJyZW50VGltZSArIDAuMTU7IHRoaXMudGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy50aWNrKCksIDIwMCk7IH1cbiAgICBpZiAoIXRoaXMubXVzaWMgJiYgdGhpcy50aW1lcikgeyBjbGVhckludGVydmFsKHRoaXMudGltZXIpOyB0aGlzLnRpbWVyID0gMDsgfVxuICB9XG4gIHByaXZhdGUgdGljaygpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7IGlmIChjdHguc3RhdGUgIT09ICdydW5uaW5nJykgeyB0aGlzLm5leHRUID0gY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgcmV0dXJuOyB9XG4gICAgd2hpbGUgKHRoaXMubmV4dFQgPCBjdHguY3VycmVudFRpbWUgKyAwLjYpIHsgdGhpcy5wbGF5QmVhdCh0aGlzLmJlYXQsIHRoaXMubmV4dFQpOyB0aGlzLm5leHRUICs9IEJFQVQ7IHRoaXMuYmVhdCA9ICh0aGlzLmJlYXQgKyAxKSAlIDE2OyB9XG4gIH1cbiAgcHJpdmF0ZSBwbGF5QmVhdChiZWF0OiBudW1iZXIsIHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGNob3JkID0gQ0hPUkRTW01hdGguZmxvb3IoYmVhdCAvIDQpXSwgaW5CYXIgPSBiZWF0ICUgNCwgYmF0dGxlID0gdGhpcy5tb2RlID09PSAnYmF0dGxlJztcbiAgICBpZiAoaW5CYXIgPT09IDApIGZvciAoY29uc3QgZiBvZiBjaG9yZCkgdGhpcy52b2ljZShmLCAndHJpYW5nbGUnLCB0LCBCRUFUICogNCArIDAuOCwgMC4wNDUsIDAuOSwgOTAwKTsgICAvLyBzbG93IHBhZFxuICAgIGlmIChpbkJhciA9PT0gMCB8fCBpbkJhciA9PT0gMikgdGhpcy52b2ljZShjaG9yZFswXSwgJ3NpbmUnLCB0LCBCRUFUICogMS42LCAwLjE2LCAwLjAyLCA0MDApOyAgICAgICAgICAvLyBiYXNzXG4gICAgaWYgKGJhdHRsZSkge1xuICAgICAgdGhpcy5raWNrKHQsIDAuMzIpOyBpZiAoaW5CYXIgPT09IDIpIHRoaXMua2ljayh0ICsgQkVBVCAqIDAuNSwgMC4xOCk7XG4gICAgICB0aGlzLm5vaXNlKHQgKyBCRUFUICogMC41LCAwLjA1LCAwLjA1LCAnaGlnaHBhc3MnLCA3MDAwKTsgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDEuNSAlIEJFQVQsIDAuMDUsIDAuMDMsICdoaWdocGFzcycsIDcwMDApO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAyOyBpKyspIHRoaXMudm9pY2UoY2hvcmRbMSArICgoYmVhdCAqIDIgKyBpKSAlIDQpXSAqIDIsICd0cmlhbmdsZScsIHQgKyBpICogQkVBVCAvIDIsIDAuMjIsIDAuMDUsIDAuMDA1LCAyNTAwKTsgICAvLyBwbHVjayBhcnBlZ2dpb1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHZvaWNlKGZyZXE6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgYXR0YWNrOiBudW1iZXIsIGxwOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS52YWx1ZSA9IGZyZXE7IGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBNYXRoLm1heCgwLjAwNSwgYXR0YWNrKSk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGtpY2sodDogbnVtYmVyLCBnYWluOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZSgxMzAsIHQpOyBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDQyLCB0ICsgMC4xNCk7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgMC4yKTtcbiAgICBvLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyAwLjI1KTtcbiAgfVxuICBwcml2YXRlIG5vaXNlKHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBidXM6IEdhaW5Ob2RlID0gdGhpcy5tdXNpY0J1cywgc3dlZXBUbz86IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbiA9IGN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgbi5idWZmZXIgPSB0aGlzLm5vaXNlQnVmOyBmLnR5cGUgPSB0eXBlOyBmLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHN3ZWVwVG8pIGYuZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc3dlZXBUbywgdCArIGR1cik7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG4uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QoYnVzKTsgbi5zdGFydCh0LCBNYXRoLnJhbmRvbSgpICogMC41KTsgbi5zdG9wKHQgKyBkdXIgKyAwLjAyKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzb3VuZCBlZmZlY3RzXG4gIHByaXZhdGUgdG9uZShmcmVxOiBudW1iZXIsIGR1cjogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZ2FpbjogbnVtYmVyLCBkZWxheSA9IDAsIHNsaWRlVG8/OiBudW1iZXIsIGF0dGFjayA9IDAuMDA1LCBscCA9IDgwMDApIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIHQgPSBjdHguY3VycmVudFRpbWUgKyBkZWxheSwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc2xpZGVUbykgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzbGlkZVRvLCB0ICsgZHVyKTtcbiAgICBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIGF0dGFjayk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLnNmeEJ1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBoaXNzKGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgZGVsYXkgPSAwLCBzd2VlcFRvPzogbnVtYmVyKSB7IHRoaXMubm9pc2UodGhpcy5jdHghLmN1cnJlbnRUaW1lICsgZGVsYXksIGR1ciwgZ2FpbiwgdHlwZSwgZnJlcSwgdGhpcy5zZnhCdXMsIHN3ZWVwVG8pOyB9XG4gIHByaXZhdGUgdGhyb3R0bGUoa2V5OiBzdHJpbmcsIG1zOiBudW1iZXIpIHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpOyBpZiAobiAtICh0aGlzLnN0YW1wc1trZXldIHx8IDApIDwgbXMpIHJldHVybiBmYWxzZTsgdGhpcy5zdGFtcHNba2V5XSA9IG47IHJldHVybiB0cnVlOyB9XG5cbiAgcGxheShuYW1lOiBTZngpIHtcbiAgICBpZiAoIXRoaXMuY3R4IHx8ICF0aGlzLnNmeCB8fCB0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSByZXR1cm47XG4gICAgc3dpdGNoIChuYW1lKSB7XG4gICAgICBjYXNlICd0YXAnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ3RhcCcsIDQwKSkgcmV0dXJuOyB0aGlzLnRvbmUoNzYwLCAwLjA2LCAnc2luZScsIDAuMjIsIDAsIDExMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3N1bW1vbic6IHRoaXMuaGlzcygwLjQsIDAuMTQsICdiYW5kcGFzcycsIDUwMCwgMCwgMjUwMCk7IHRoaXMudG9uZSgyMjAsIDAuNCwgJ3Nhd3Rvb3RoJywgMC4xLCAwLCA2NjAsIDAuMDUsIDE4MDApOyB0aGlzLnRvbmUoMTMyMCwgMC4yLCAnc2luZScsIDAuMSwgMC4xOCk7IGJyZWFrO1xuICAgICAgY2FzZSAnbWVyZ2UnOiBbNTIzLCA2NTksIDc4NCwgMTA0Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuMzUsICd0cmlhbmdsZScsIDAuMiwgaSAqIDAuMDcpKTsgdGhpcy5oaXNzKDAuNSwgMC4wOCwgJ2hpZ2hwYXNzJywgNTAwMCwgMC4xKTsgdGhpcy50b25lKDExMCwgMC4zLCAnc2luZScsIDAuMzUsIDAsIDUwKTsgdGhpcy50b25lKDE1NjgsIDAuNSwgJ3NpbmUnLCAwLjA4LCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ2hpdCc6IGlmICghdGhpcy50aHJvdHRsZSgnaGl0JywgNDUpKSByZXR1cm47IHRoaXMuaGlzcygwLjA3LCAwLjI0LCAnbG93cGFzcycsIDE4MDApOyB0aGlzLnRvbmUoMTcwLCAwLjA5LCAnc2luZScsIDAuMjIsIDAsIDgwKTsgYnJlYWs7XG4gICAgICBjYXNlICdoaXRBcnJvdyc6IGlmICghdGhpcy50aHJvdHRsZSgnaGl0QScsIDQ1KSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4wNSwgMC4xNCwgJ2JhbmRwYXNzJywgMzAwMCk7IHRoaXMudG9uZSg3MDAsIDAuMDYsICd0cmlhbmdsZScsIDAuMDYsIDAsIDQwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc21hc2gnOiB0aGlzLnRvbmUoOTUsIDAuMzgsICdzaW5lJywgMC41LCAwLCAzNCk7IHRoaXMuaGlzcygwLjMyLCAwLjM1LCAnbG93cGFzcycsIDEwMDAsIDAsIDIwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnYXJyb3cnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2Fycm93JywgNjApKSByZXR1cm47IHRoaXMuaGlzcygwLjE0LCAwLjEsICdiYW5kcGFzcycsIDE4MDAsIDAsIDQyMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2RlYXRoJzogaWYgKCF0aGlzLnRocm90dGxlKCdkZWF0aCcsIDcwKSkgcmV0dXJuOyB0aGlzLnRvbmUoMzAwLCAwLjQsICdzYXd0b290aCcsIDAuMTQsIDAsIDcwLCAwLjAxLCA5MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2Nhc3QnOiB0aGlzLnRvbmUoMzAwLCAwLjQ1LCAnc2luZScsIDAuMTgsIDAsIDkwMCwgMC4wNSk7IHRoaXMudG9uZSg0NTAsIDAuNDUsICdzaW5lJywgMC4xLCAwLjA1LCAxMzUwLCAwLjA1KTsgdGhpcy50b25lKDE4MDAsIDAuMjUsICdzaW5lJywgMC4wNSwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICd0YXVudCc6IHRoaXMudG9uZSgxOTYsIDAuNSwgJ3NxdWFyZScsIDAuMDgsIDAsIDE4MCwgMC4wMywgNzAwKTsgdGhpcy50b25lKDE0NywgMC41LCAnc2F3dG9vdGgnLCAwLjA4LCAwLjAyLCAxNDAsIDAuMDMsIDYwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc2hvY2t3YXZlJzogdGhpcy50b25lKDIyMCwgMS4xLCAnc2luZScsIDAuNSwgMCwgMjgsIDAuMDIpOyB0aGlzLmhpc3MoMS4wLCAwLjM1LCAnbG93cGFzcycsIDMwMDAsIDAsIDE1MCk7IHRoaXMudG9uZSg4ODAsIDAuOCwgJ3NpbmUnLCAwLjA4LCAwLCAyMjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3Jlc3VycmVjdCc6IFsyMjAsIDI3NywgMzMwLCA0NDAsIDU1NF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDEuMSwgJ3RyaWFuZ2xlJywgMC4xLCBpICogMC4xMiwgZiAqIDEuMTIsIDAuMykpOyB0aGlzLmhpc3MoMC45LCAwLjA2LCAnaGlnaHBhc3MnLCA0NTAwLCAwLjIpOyBicmVhaztcbiAgICAgIGNhc2UgJ2hlYXJ0TG9zdCc6IHRoaXMudG9uZSgxMTAsIDAuNywgJ3Nhd3Rvb3RoJywgMC4yOCwgMCwgNTAsIDAuMDEsIDQ1MCk7IHRoaXMuaGlzcygwLjE4LCAwLjIsICdsb3dwYXNzJywgOTAwKTsgdGhpcy50b25lKDIzMywgMC41LCAnc3F1YXJlJywgMC4wNSwgMC4wMiwgMjIwLCAwLjAxLCA1MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3ZpY3RvcnknOiBbMzkyLCA0OTQsIDU4NywgNzg0XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC41LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4xMSkpOyB0aGlzLnRvbmUoMTk2LCAwLjksICdzaW5lJywgMC4yKTsgYnJlYWs7XG4gICAgICBjYXNlICdkZWZlYXQnOiBbMzMwLCAyOTQsIDI0NywgMTk2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC43LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4yOCwgZiAqIDAuOTcpKTsgdGhpcy50b25lKDgyLCAxLjYsICdzaW5lJywgMC4zLCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3N0YXJ0JzogdGhpcy50b25lKDE0NywgMC45LCAnc2F3dG9vdGgnLCAwLjEzLCAwLCAxNTAsIDAuMTUsIDY1MCk7IHRoaXMudG9uZSgyMjAsIDAuOSwgJ3Nhd3Rvb3RoJywgMC4wOSwgMC4wNSwgMjI0LCAwLjE1LCA2NTApOyB0aGlzLmhpc3MoMC42LCAwLjA2LCAnbG93cGFzcycsIDYwMCk7IGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYXVkaW8gPSBuZXcgQXVkaW9FbmdpbmUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2F1ZGlvID0gYXVkaW87XG5cbi8vIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdG91Y2g6IHRoZSBmaXJzdCB0YXAgYW55d2hlcmUgdW5sb2NrcyBpdC4gRXZlcnkgYnV0dG9uIGFsc28gZ2V0cyBhIHNtYWxsIGNsaWNrLlxuLy8gaU9TIG9ubHkgYWNjZXB0cyBhbiB1bmxvY2sgZnJvbSBhIEZJTklTSEVEIHRhcCAodG91Y2hlbmQgLyBjbGljayksIG5vdCBmcm9tIHRoZSBzdGFydCBvZiBvbmUsIHNvIGxpc3RlbiB0byBhbGwgb2YgdGhlbS5cbmNvbnN0IHVubG9ja09uY2UgPSAoKSA9PiBhdWRpby51bmxvY2soKTtcbmZvciAoY29uc3QgZXYgb2YgWydwb2ludGVyZG93bicsICdwb2ludGVydXAnLCAndG91Y2hlbmQnLCAnY2xpY2snLCAna2V5ZG93biddKSBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKGV2LCB1bmxvY2tPbmNlLCB7IGNhcHR1cmU6IHRydWUgfSk7XG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGNvbnN0IGVsID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsOyBpZiAoZWwgJiYgZWwuY2xvc2VzdCAmJiBlbC5jbG9zZXN0KCdidXR0b24sIGEuYnRuLCAucmFpbCBhJykpIGF1ZGlvLnBsYXkoJ3RhcCcpOyB9LCB0cnVlKTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Zpc2liaWxpdHljaGFuZ2UnLCAoKSA9PiB7IGNvbnN0IGMgPSAoYXVkaW8gYXMgYW55KS5jdHggYXMgQXVkaW9Db250ZXh0IHwgbnVsbDsgaWYgKCFjKSByZXR1cm47IGlmIChkb2N1bWVudC5oaWRkZW4pIGMuc3VzcGVuZCgpOyBlbHNlIGlmIChhdWRpby5tdXNpYyB8fCBhdWRpby5zZngpIGMucmVzdW1lKCk7IH0pO1xud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzLWNoYW5nZWQnLCAoKSA9PiBhdWRpby5yZWxvYWQoKSk7XG4iLCAiLy8gRXZlcnl0aGluZyB5b3UgU0VFIGZvciBhIHVuaXQ6IHJlYWwgVHJpcG8gbW9kZWxzIChTa2VsZXRvbiBXYXJyaW9yLCBTa2VsZXRvbiBBcmNoZXIpLCBzaW1wbGUgc3RhbmQtaW5zIGZvciB0aGUgZm91clxuLy8gY2hhcmFjdGVycyB0aGF0IGFyZSBub3QgZ2VuZXJhdGVkIHlldCwgYW5kIHRoZSBcInN0YXIgbG9va1wiIGxheWVyZWQgb24gdG9wIG9mIGJvdGggKHNpemUsIHRpbnQsIGF1cmEsIGhhbG8sIGJhZGdlKS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5cbmV4cG9ydCB0eXBlIFZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhdGgnIHwgJ3NwYXduJyB8ICdjaGVlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbiArIHlhdyBoZXJlXG4gIHRlYW06IDAgfCAxOyBzdGFyOiBudW1iZXI7IHN0YXRlOiBWU3RhdGU7IHRvcDogbnVtYmVyO1xuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkPzogbnVtYmVyKTogdm9pZDtcbiAgc2V0U3RhcihzdGFyOiBudW1iZXIpOiB2b2lkO1xuICBzZXRUZWFtKHRlYW06IDAgfCAxKTogdm9pZDtcbiAgc2V0SHAoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7ICAvLyBudWxsIGhpZGVzIHRoZSBoZWFsdGggYmFyXG4gIHNldE1hbmEoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7IC8vIG51bGwgaGlkZXMgdGhlIG1hbmEgYmFyICh1bml0cyB3aXRob3V0IGEgc2tpbGwpXG4gIHB1bHNlKCk6IHZvaWQ7ICAgICAgICAgICAgICAgICAgICAgLy8gYnJpZWYgaGl0IHJlYWN0aW9uXG4gIHVwZGF0ZShkdDogbnVtYmVyKTogdm9pZDtcbiAgZGlzcG9zZSgpOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YXIgbG9va3Ncbi8vIDEgc3RhciA9IHRoZSBwbGFpbiBtb2RlbC4gMiBzdGFycyA9IGEgbGl0dGxlIGJpZ2dlciwgY29vbCBzaWx2ZXItYmx1ZSB0aW50LCBicmlnaHRlciBhdXJhLiAzIHN0YXJzID0gYmlnZ2VzdCwgd2FybSBnb2xkIHRpbnQsXG4vLyBzdHJvbmcgZ29sZC12aW9sZXQgYXVyYSBhbmQgYSBmbG9hdGluZyBnb2xkIGhhbG8uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBmcmVlOiBubyBleHRyYSBUcmlwbyBnZW5lcmF0aW9ucy5cbmNvbnN0IFRJTlQ6IG51bWJlcltdW10gPSBbWzEsIDEsIDFdLCBbMC44NiwgMC45NSwgMS4xOF0sIFsxLjI1LCAxLjEsIDAuN11dO1xuY29uc3QgQVVSQSA9IFtcbiAgeyByYXRlOiAxNCwgbWluOiAwLjA2LCBtYXg6IDAuMTYsIGMxOiBbMC43OCwgMC4zNSwgMSwgMC43XSwgYzI6IFswLjQ1LCAwLjE1LCAwLjksIDAuNV0gfSxcbiAgeyByYXRlOiAyNiwgbWluOiAwLjA4LCBtYXg6IDAuMjAsIGMxOiBbMC44NSwgMC42NSwgMSwgMC44XSwgYzI6IFswLjU1LCAwLjQsIDEsIDAuNl0gfSxcbiAgeyByYXRlOiA0NCwgbWluOiAwLjEwLCBtYXg6IDAuMjYsIGMxOiBbMSwgMC44NSwgMC40LCAwLjg1XSwgYzI6IFswLjgsIDAuMywgMSwgMC43XSB9LFxuXTtcblxuZXhwb3J0IGludGVyZmFjZSBBc3NldHMge1xuICBzY2VuZTogYW55OyBzb2Z0OiBhbnk7IHN0YXJUZXg6IGFueVtdOyB0cmlwbzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBUcmlwb0NmZz4+O1xuICByaW5nTWF0OiBhbnlbXTsgaGFsb01hdDogYW55OyBiYXJCZzogYW55OyBiYXJGaWxsOiBhbnlbXTsgbWFuYUZpbGw6IGFueTtcbn1cbmludGVyZmFjZSBUcmlwb0NmZyB7IGNvbnRhaW5lcjogYW55OyBlbmVteVRleDogYW55OyBjbGlwczogUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPjsgbWF0Q2FjaGU6IFJlY29yZDxzdHJpbmcsIGFueT47IGJhc2VNYXQ/OiBhbnk7IHRvcDogbnVtYmVyOyBzY2FsZTogbnVtYmVyIH1cblxuZnVuY3Rpb24gZHluKHNjZW5lOiBhbnksIHc6IG51bWJlciwgaDogbnVtYmVyLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkLCBhbHBoYSA9IHRydWUpIHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdkdCcsIHsgd2lkdGg6IHcsIGhlaWdodDogaCB9LCBzY2VuZSwgdHJ1ZSk7IGRyYXcodC5nZXRDb250ZXh0KCkpOyB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gYWxwaGE7IHJldHVybiB0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFzc2V0cyhzY2VuZTogYW55KTogUHJvbWlzZTxBc3NldHM+IHtcbiAgY29uc3Qgc29mdCA9IGR5bihzY2VuZSwgNjQsIDY0LCAoYykgPT4geyBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCgzMiwgMzIsIDAsIDMyLCAzMiwgMzIpOyBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgyNTUsMjU1LDI1NSwxKScpOyBnLmFkZENvbG9yU3RvcCgwLjQsICdyZ2JhKDI1NSwyNTUsMjU1LC41NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTsgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IH0pO1xuICBjb25zdCBzdGFyVGV4ID0gWzEsIDIsIDNdLm1hcCgobikgPT4gZHluKHNjZW5lLCAxOTIsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCA0MHB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlU3R5bGUgPSAnIzFhMTAyMCc7IGMuZmlsbFN0eWxlID0gbiA9PT0gMyA/ICcjZmZkMjRhJyA6IG4gPT09IDIgPyAnI2Q3ZTZmZicgOiAnI2YwZDlhMCc7IGNvbnN0IHMgPSAnXHUyNjA1Jy5yZXBlYXQobik7IGMuc3Ryb2tlVGV4dChzLCA5NiwgMzgpOyBjLmZpbGxUZXh0KHMsIDk2LCAzOCk7IH0pKTtcbiAgY29uc3QgZW1pc3NpdmUgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYSA9IDEpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2VtJywgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gIGNvbnN0IEE6IEFzc2V0cyA9IHtcbiAgICBzY2VuZSwgc29mdCwgc3RhclRleCwgdHJpcG86IHt9LCByaW5nTWF0OiBbZW1pc3NpdmUoMC41NSwgMC4yLCAwLjk1LCAwLjkpLCBlbWlzc2l2ZSgwLjk1LCAwLjI1LCAwLjIsIDAuOSldLCBoYWxvTWF0OiBlbWlzc2l2ZSgxLCAwLjgyLCAwLjMsIDAuOTUpLFxuICAgIGJhckJnOiBlbWlzc2l2ZSgwLjA1LCAwLjA1LCAwLjA4LCAwLjcpLCBiYXJGaWxsOiBbZW1pc3NpdmUoMC41NSwgMC4zNSwgMSksIGVtaXNzaXZlKDEsIDAuNCwgMC4zKV0sIG1hbmFGaWxsOiBlbWlzc2l2ZSgwLjI1LCAwLjc1LCAxKSxcbiAgfTtcbiAgY29uc3QgZGVmczogW1NvdWxJZCwgc3RyaW5nLCBzdHJpbmcsIFJlY29yZDxWU3RhdGUsIHN0cmluZz4sIG51bWJlciwgbnVtYmVyXVtdID0gW1xuICAgIFsnd2FycmlvcicsICdza2VsZXRvbl93YXJyaW9yLmdsYicsICdza2VsZXRvbl93YXJyaW9yX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQmxvY2snIH0sIDEuMDUsIDEuMF0sXG4gICAgWydhcmNoZXInLCAnU2tlbGV0b25BcmNoZXIuZ2xiJywgJ1NrZWxldG9uQXJjaGVyX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdTaG9vdCcsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdGbGV4JyB9LCAxLjA1LCAxLjBdLFxuICBdO1xuICBhd2FpdCBQcm9taXNlLmFsbChkZWZzLm1hcChhc3luYyAoW3NvdWwsIGdsYiwgZW5lbXksIGNsaXBzLCB0b3AsIHNjYWxlXSkgPT4ge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCBnbGIsIHNjZW5lKTtcbiAgICBBLnRyaXBvW3NvdWxdID0geyBjb250YWluZXIsIGVuZW15VGV4OiBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvJyArIGVuZW15LCBzY2VuZSwgZmFsc2UsIGZhbHNlKSwgY2xpcHMsIG1hdENhY2hlOiB7fSwgdG9wLCBzY2FsZSB9O1xuICB9KSk7XG4gIHJldHVybiBBO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNoYXJlZCBkZWNvcmF0aW9uXG5jbGFzcyBEZWNvIHtcbiAgcHJpdmF0ZSBwczogYW55ID0gbnVsbDsgcHJpdmF0ZSBoYWxvOiBhbnkgPSBudWxsOyBwcml2YXRlIGJhZGdlOiBhbnk7IHByaXZhdGUgc3RhcnM6IGFueTsgcHJpdmF0ZSBmaWxsOiBhbnk7IHByaXZhdGUgYmFyOiBhbnk7IHByaXZhdGUgbWJnOiBhbnk7IHByaXZhdGUgbWZpbGw6IGFueTsgcHJpdmF0ZSByaW5nOiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHBhcmVudDogYW55LCBwcml2YXRlIHRvcDogbnVtYmVyLCBwcml2YXRlIHJhZGl1czogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmU7XG4gICAgdGhpcy5yaW5nID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdyaW5nJywgeyByYWRpdXM6IE1hdGgubWF4KDAuMywgcmFkaXVzICogMS4xNSksIHRlc3NlbGxhdGlvbjogMjYgfSwgcyk7IHRoaXMucmluZy5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHRoaXMucmluZy5wb3NpdGlvbi55ID0gMC4wMjsgdGhpcy5yaW5nLnBhcmVudCA9IHBhcmVudDsgdGhpcy5yaW5nLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLmJhZGdlID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnYmFkZ2UnLCBzKTsgdGhpcy5iYWRnZS5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMuYmFkZ2UucG9zaXRpb24ueSA9IHRvcCArIDAuMzI7IHRoaXMuYmFkZ2UuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDtcbiAgICB0aGlzLnN0YXJzID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnc3RhcnMnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4xNSB9LCBzKTsgdGhpcy5zdGFycy5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLnN0YXJzLnBvc2l0aW9uLnkgPSAwLjExOyB0aGlzLnN0YXJzLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBzbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3NtJywgcyk7IHNtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBzbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBzbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHRoaXMuc3RhcnMubWF0ZXJpYWwgPSBzbTsgKHRoaXMuc3RhcnMgYXMgYW55KS5fc20gPSBzbTtcbiAgICBjb25zdCBiZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2JnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDg1IH0sIHMpOyBiZy5wYXJlbnQgPSB0aGlzLmJhZGdlOyBiZy5tYXRlcmlhbCA9IEEuYmFyQmc7IGJnLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5iYXIgPSBiZztcbiAgICB0aGlzLmZpbGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdmaWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjA1IH0sIHMpOyB0aGlzLmZpbGwucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5maWxsLnBvc2l0aW9uLnogPSAtMC4wMDI7IHRoaXMuZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdtYmcnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5tYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5tYmcucG9zaXRpb24ueSA9IC0wLjA3OyB0aGlzLm1iZy5tYXRlcmlhbCA9IEEuYmFyQmc7IHRoaXMubWJnLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLm1maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWZpbGwnLCB7IHdpZHRoOiAwLjU2LCBoZWlnaHQ6IDAuMDMgfSwgcyk7IHRoaXMubWZpbGwucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5tZmlsbC5wb3NpdGlvbi5zZXQoMCwgLTAuMDcsIC0wLjAwMik7IHRoaXMubWZpbGwubWF0ZXJpYWwgPSBBLm1hbmFGaWxsOyB0aGlzLm1maWxsLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLmJhci5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5maWxsLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1iZy5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBzZXQodGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLkEuc2NlbmUsIGNmZyA9IEFVUkFbc3RhciAtIDFdO1xuICAgICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtLmRpZmZ1c2VUZXh0dXJlID0gdGhpcy5BLnN0YXJUZXhbc3RhciAtIDFdO1xuICAgIHRoaXMucmluZy5tYXRlcmlhbCA9IHRoaXMuQS5yaW5nTWF0W3RlYW1dOyB0aGlzLmZpbGwubWF0ZXJpYWwgPSB0aGlzLkEuYmFyRmlsbFt0ZWFtXTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmFpc2VkIGJ5IHRoZSBOZWNyb21hbmNlcjogcHVycGxlIGF1cmEgdGhhdCBncm93cyB3aXRoIHN0YXJzXG4gICAgICBpZiAoIXRoaXMucHMpIHtcbiAgICAgICAgY29uc3QgcHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnYXVyYScsIDcwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGhpcy5BLnNvZnQ7IHBzLmVtaXR0ZXIgPSB0aGlzLnBhcmVudDsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgdGhpcy50b3AgKiAwLjUsIDAuMik7XG4gICAgICAgIHBzLm1pbkxpZmVUaW1lID0gMC41OyBwcy5tYXhMaWZlVGltZSA9IDEuMTsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMTUsIDAuOCwgLTAuMTUpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjE1LCAxLjUsIDAuMTUpO1xuICAgICAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjM1OyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7IHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgdGhpcy5wcyA9IHBzO1xuICAgICAgfVxuICAgICAgY29uc3QgcCA9IHRoaXMucHM7IHAuZW1pdFJhdGUgPSBjZmcucmF0ZTsgcC5taW5TaXplID0gY2ZnLm1pbjsgcC5tYXhTaXplID0gY2ZnLm1heDsgcC5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uY2ZnLmMxKTsgcC5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uY2ZnLmMyKTsgcC5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4yLCAwLCAwLjQsIDApO1xuICAgICAgaWYgKCFwLmlzU3RhcnRlZCgpKSBwLnN0YXJ0KCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLnBzICYmIHRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RvcCgpO1xuICAgIGlmIChzdGFyID49IDMpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBnb2xkIGhhbG8gYWJvdmUgdGhlIGhlYWRcbiAgICAgIGlmICghdGhpcy5oYWxvKSB7IHRoaXMuaGFsbyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2hhbG8nLCB7IGRpYW1ldGVyOiAwLjU1LCB0aGlja25lc3M6IDAuMDQsIHRlc3NlbGxhdGlvbjogMjQgfSwgcyk7IHRoaXMuaGFsby5wYXJlbnQgPSB0aGlzLnBhcmVudDsgdGhpcy5oYWxvLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuMDg7IHRoaXMuaGFsby5tYXRlcmlhbCA9IHRoaXMuQS5oYWxvTWF0OyB0aGlzLmhhbG8uaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgICB0aGlzLmhhbG8uc2V0RW5hYmxlZCh0cnVlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuaGFsbykgdGhpcy5oYWxvLnNldEVuYWJsZWQoZmFsc2UpO1xuICB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHtcbiAgICBjb25zdCBvbiA9IGYgIT09IG51bGw7IHRoaXMuYmFyLnNldEVuYWJsZWQob24pOyB0aGlzLmZpbGwuc2V0RW5hYmxlZChvbik7XG4gICAgaWYgKG9uKSB7IGNvbnN0IGsgPSBNYXRoLm1heCgwLjAwMSwgZiBhcyBudW1iZXIpOyB0aGlzLmZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5maWxsLnBvc2l0aW9uLnggPSAtKDAuNTYgKiAoMSAtIGspKSAvIDI7IH1cbiAgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHtcbiAgICBjb25zdCBvbiA9IGYgIT09IG51bGw7IHRoaXMubWJnLnNldEVuYWJsZWQob24pOyB0aGlzLm1maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5tZmlsbC5zY2FsaW5nLnggPSBrOyB0aGlzLm1maWxsLnBvc2l0aW9uLnggPSAtKDAuNTYgKiAoMSAtIGspKSAvIDI7IH1cbiAgfVxuICBzZXRBdXJhKG9uOiBib29sZWFuKSB7IGlmICh0aGlzLnBzKSB7IGlmIChvbiAmJiAhdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdGFydCgpOyBpZiAoIW9uICYmIHRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RvcCgpOyB9IH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHsgaWYgKHRoaXMuaGFsbyAmJiB0aGlzLmhhbG8uaXNFbmFibGVkKCkpIHRoaXMuaGFsby5yb3RhdGlvbi55ICs9IGR0ICogMS42OyB9XG4gIGRpc3Bvc2UoKSB7IGlmICh0aGlzLnBzKSB7IHRoaXMucHMuc3RvcCgpOyB0aGlzLnBzLmRpc3Bvc2UoKTsgfSBbdGhpcy5oYWxvLCB0aGlzLnJpbmcsIHRoaXMuc3RhcnMsIHRoaXMuYmFyLCB0aGlzLmZpbGwsIHRoaXMubWJnLCB0aGlzLm1maWxsXS5mb3JFYWNoKChtKSA9PiBtICYmIG0uZGlzcG9zZSgpKTsgdGhpcy5iYWRnZS5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSByZWFsIG1vZGVsc1xuY2xhc3MgVHJpcG9WaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgZW50OiBhbnk7IHByaXZhdGUgYm9keTogYW55OyBwcml2YXRlIGFuaW1zOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307IHByaXZhdGUgY3VyOiBhbnkgPSBudWxsOyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHB1bHNlVCA9IDA7IHByaXZhdGUgYmFzZTogbnVtYmVyO1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBjZmc6IFRyaXBvQ2ZnLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZSwgdWlkID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNyk7XG4gICAgdGhpcy5lbnQgPSBjZmcuY29udGFpbmVyLmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ18nICsgdWlkLCBmYWxzZSwgeyBkb05vdEluc3RhbnRpYXRlOiB0cnVlIH0pO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgndW5pdF8nICsgdWlkLCBzKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIHRoaXMuYm9keSA9IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZpbmQoKG06IGFueSkgPT4gbS5uYW1lLmluY2x1ZGVzKCdfQm9keScpKTtcbiAgICBpZiAoIWNmZy5iYXNlTWF0KSBjZmcuYmFzZU1hdCA9IHRoaXMuYm9keS5tYXRlcmlhbDtcbiAgICB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiB7IGcuc3RvcCgpOyBnLmVuYWJsZUJsZW5kaW5nID0gdHJ1ZTsgZy5ibGVuZGluZ1NwZWVkID0gMC4xMjsgdGhpcy5hbmltc1tnLm5hbWUuc3BsaXQoJ18nKVswXV0gPSBnOyB9KTtcbiAgICB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfSk7XG4gICAgdGhpcy50b3AgPSBjZmcudG9wOyB0aGlzLmJhc2UgPSBjZmcuc2NhbGU7IHRoaXMudGVhbSA9IHRlYW07XG4gICAgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCAwLjMpO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogMS4zLCBkaWFtZXRlcjogMC44IH0sIHMpOyB0aGlzLnBpY2sucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMucGljay5wb3NpdGlvbi55ID0gMC42OyB0aGlzLnBpY2sudmlzaWJpbGl0eSA9IDAuMDAxOyB0aGlzLnBpY2suaXNQaWNrYWJsZSA9IHRydWU7XG4gICAgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgfVxuICBwcml2YXRlIGFwcGx5TWF0KCkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMudGVhbSArICdfJyArIHRoaXMuc3RhciwgYyA9IHRoaXMuY2ZnO1xuICAgIGlmICghYy5tYXRDYWNoZVtrZXldKSB7IGNvbnN0IG0gPSBjLmJhc2VNYXQuY2xvbmUoJ21fJyArIGtleSk7IGlmICh0aGlzLnRlYW0gPT09IDEpIG0uYWxiZWRvVGV4dHVyZSA9IGMuZW5lbXlUZXg7IGNvbnN0IHQgPSBUSU5UW3RoaXMuc3RhciAtIDFdOyBtLmFsYmVkb0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHRbMF0sIHRbMV0sIHRbMl0pOyBjLm1hdENhY2hlW2tleV0gPSBtOyB9XG4gICAgdGhpcy5ib2R5Lm1hdGVyaWFsID0gYy5tYXRDYWNoZVtrZXldO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKEJBTEFOQ0Uuc3Rhci5zY2FsZVtzdCAtIDFdICogdGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmFuaW1zW3RoaXMuY2ZnLmNsaXBzW3N0YXRlXV07IGlmICghZykgcmV0dXJuOyBjb25zdCBsb29wID0gc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bic7XG4gICAgaWYgKGxvb3AgJiYgdGhpcy5zdGF0ZSA9PT0gc3RhdGUgJiYgdGhpcy5jdXIgPT09IGcpIHJldHVybjtcbiAgICBpZiAodGhpcy5jdXIpIHRoaXMuY3VyLnN0b3AoKTsgZy5zdG9wKCk7IGcuc3RhcnQobG9vcCwgc3BlZWQsIGcuZnJvbSwgZy50byk7XG4gICAgaWYgKGxvb3ApIGcuZ29Ub0ZyYW1lKGcuZnJvbSArIE1hdGgucmFuZG9tKCkgKiAoZy50byAtIGcuZnJvbSkpO1xuICAgIHRoaXMuY3VyID0gZzsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7XG4gIH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLmRlY28udXBkYXRlKGR0KTtcbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKEJBTEFOQ0Uuc3Rhci5zY2FsZVt0aGlzLnN0YXIgLSAxXSAqIHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5kZWNvLmRpc3Bvc2UoKTsgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4gZy5kaXNwb3NlKCkpOyB0aGlzLmVudC5za2VsZXRvbnMuZm9yRWFjaCgoczogYW55KSA9PiBzLmRpc3Bvc2UoKSk7IHRoaXMucGljay5kaXNwb3NlKCk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5kaXNwb3NlKGZhbHNlLCBmYWxzZSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YW5kLWluc1xuY29uc3QgUEg6IFJlY29yZDxzdHJpbmcsIHsgY29sOiBzdHJpbmc7IHc6IG51bWJlcjsgaDogbnVtYmVyOyBoZWFkOiBudW1iZXI7IHdlYXBvbjogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0+ID0ge1xuICBnb2JsaW46IHsgY29sOiAnIzYzYjEzZicsIHc6IDAuMzYsIGg6IDAuNDIsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ2RhZ2dlcicsIGxhYmVsOiAnR09CTElOJyB9LFxuICBrbmlnaHQ6IHsgY29sOiAnIzhlYTlkYycsIHc6IDAuNSwgaDogMC42LCBoZWFkOiAwLjM2LCB3ZWFwb246ICdzaGllbGQnLCBsYWJlbDogJ0tOSUdIVCcgfSxcbiAgb2dyZTogeyBjb2w6ICcjYThhNjRhJywgdzogMC44NSwgaDogMC44NSwgaGVhZDogMC40Miwgd2VhcG9uOiAnbWFjZScsIGxhYmVsOiAnT0dSRScgfSxcbiAgYmFyYmFyaWFuOiB7IGNvbDogJyNkNjhhNTUnLCB3OiAwLjUyLCBoOiAwLjYyLCBoZWFkOiAwLjM4LCB3ZWFwb246ICdheGUnLCBsYWJlbDogJ0JBUkJBUklBTicgfSxcbn07XG5jbGFzcyBQbGFjZWhvbGRlclZpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSByaWc6IGFueTsgcHJpdmF0ZSBsZWdzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHdwOiBhbnk7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgdCA9IE1hdGgucmFuZG9tKCkgKiA2OyBwcml2YXRlIHN0MCA9IDA7IHByaXZhdGUgZHVyID0gMTsgcHJpdmF0ZSBiYXNlID0gMTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIG1hdHM6IGFueVtdID0gW107IHByaXZhdGUgYm9keTogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBzb3VsOiBzdHJpbmcsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZSwgZCA9IFBIW3NvdWxdOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncGhfJyArIHNvdWwsIHMpOyB0aGlzLnJpZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3JpZycsIHMpOyB0aGlzLnJpZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICBjb25zdCBtYXQgPSAoaGV4OiBzdHJpbmcsIGVtID0gMCkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgncG0nLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5Gcm9tSGV4U3RyaW5nKGhleCkuc2NhbGUoMC43Mik7IG0uc3BlY3VsYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjEsIDAuMSwgMC4xKTsgaWYgKGVtKSBtLmVtaXNzaXZlQ29sb3IgPSBtLmRpZmZ1c2VDb2xvci5zY2FsZShlbSk7IHJldHVybiBtOyB9O1xuICAgIGNvbnN0IGxlZ0ggPSAwLjIyLCBib2R5WSA9IGxlZ0ggKyBkLmggLyAyO1xuICAgIGZvciAoY29uc3Qgc3ggb2YgWy0xLCAxXSkgeyBjb25zdCBsZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2xlZycsIHMpOyBsZy5wYXJlbnQgPSB0aGlzLnJpZzsgbGcucG9zaXRpb24uc2V0KHN4ICogZC53ICogMC4yMiwgbGVnSCwgMCk7IGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdsJywgeyBoZWlnaHQ6IGxlZ0gsIGRpYW1ldGVyOiBkLncgKiAwLjI4IH0sIHMpOyBtLnBhcmVudCA9IGxnOyBtLnBvc2l0aW9uLnkgPSAtbGVnSCAvIDI7IG0ubWF0ZXJpYWwgPSBtYXQoJyM0YTM4MjYnKTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMubGVncy5wdXNoKGxnKTsgfVxuICAgIHRoaXMuYm9keSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ2Fwc3VsZSgnYm9keScsIHsgcmFkaXVzOiBkLncgLyAyLCBoZWlnaHQ6IGQuaCArIGQudyAqIDAuNCB9LCBzKTsgdGhpcy5ib2R5LnBhcmVudCA9IHRoaXMucmlnOyB0aGlzLmJvZHkucG9zaXRpb24ueSA9IGJvZHlZOyB0aGlzLmJvZHkubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyB0aGlzLmJvZHkuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IGhlYWQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnaGVhZCcsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDEuNSwgc2VnbWVudHM6IDEyIH0sIHMpOyBoZWFkLnBhcmVudCA9IHRoaXMucmlnOyBoZWFkLnBvc2l0aW9uLnkgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMC41NTsgaGVhZC5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IGhlYWQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IGV5ZU0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdleWUnLCBzKTsgZXllTS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBleWVNLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyAodGhpcyBhcyBhbnkpLmV5ZU0gPSBleWVNO1xuICAgIGZvciAoY29uc3Qgc3ggb2YgWy0xLCAxXSkgeyBjb25zdCBlID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2UnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAwLjMgfSwgcyk7IGUucGFyZW50ID0gdGhpcy5yaWc7IGUucG9zaXRpb24uc2V0KHN4ICogZC5oZWFkICogMC4zLCBoZWFkLnBvc2l0aW9uLnkgKyAwLjAyLCBkLmhlYWQgKiAwLjY2KTsgZS5tYXRlcmlhbCA9IGV5ZU07IGUuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgLy8gd2VhcG9uIHBpdm90IGF0IHRoZSBzaG91bGRlciwgb24gdGhlIGNoYXJhY3RlcidzIHJpZ2h0ICgteCBpcyBmaW5lIGZvciBhIHN0YW5kLWluKVxuICAgIHRoaXMud3AgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd3cCcsIHMpOyB0aGlzLndwLnBhcmVudCA9IHRoaXMucmlnOyB0aGlzLndwLnBvc2l0aW9uLnNldChkLncgKiAwLjYsIGxlZ0ggKyBkLmggKiAwLjg1LCAwLjA1KTtcbiAgICBjb25zdCB3bSA9IG1hdCgnIzdhNWEzMCcpLCBpcm9uID0gbWF0KCcjOWFhMWFkJyk7XG4gICAgY29uc3QgbWsgPSAobTogYW55LCBraW5kOiBzdHJpbmcsIGRpbXM6IGFueSwgcG9zOiBudW1iZXJbXSwgbXQ6IGFueSkgPT4geyBjb25zdCB4ID0ga2luZCA9PT0gJ2JveCcgPyBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUJveCgndycsIGRpbXMsIHMpIDoga2luZCA9PT0gJ2N5bCcgPyBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCd3JywgZGltcywgcykgOiBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgndycsIGRpbXMsIHMpOyB4LnBhcmVudCA9IHRoaXMud3A7IHgucG9zaXRpb24uc2V0KHBvc1swXSwgcG9zWzFdLCBwb3NbMl0pOyB4Lm1hdGVyaWFsID0gbXQ7IHguaXNQaWNrYWJsZSA9IGZhbHNlOyByZXR1cm4geDsgfTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdkYWdnZXInKSBtaygwLCAnYm94JywgeyB3aWR0aDogMC4wNSwgaGVpZ2h0OiAwLjMsIGRlcHRoOiAwLjAzIH0sIFswLCAtMC4yLCAwLjEyXSwgaXJvbik7XG4gICAgaWYgKGQud2VhcG9uID09PSAnc2hpZWxkJykgeyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4wNiwgaGVpZ2h0OiAwLjUsIGRlcHRoOiAwLjA0IH0sIFswLCAtMC4zLCAwLjE0XSwgaXJvbik7IGNvbnN0IHNoID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignc2gnLCB7IGhlaWdodDogMC4wNSwgZGlhbWV0ZXI6IDAuNTUgfSwgcyk7IHNoLnBhcmVudCA9IHRoaXMucmlnOyBzaC5yb3RhdGlvbi56ID0gTWF0aC5QSSAvIDI7IHNoLnBvc2l0aW9uLnNldCgtZC53ICogMC43LCBsZWdIICsgZC5oICogMC42LCAwLjA1KTsgc2gubWF0ZXJpYWwgPSBtYXQoJyNkOGI2NGEnKTsgc2guaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnbWFjZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjksIGRpYW1ldGVyOiAwLjA4IH0sIFswLCAtMC4zNSwgMC4zXSwgd20pOyBtaygwLCAnc3BoJywgeyBkaWFtZXRlcjogMC40IH0sIFswLCAtMC44NSwgMC40XSwgaXJvbik7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdheGUnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC42LCBkaWFtZXRlcjogMC4wNSB9LCBbMCwgLTAuMiwgMC4xNV0sIHdtKTsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMzIsIGhlaWdodDogMC4yMiwgZGVwdGg6IDAuMDUgfSwgWzAsIC0wLjUsIDAuMTVdLCBpcm9uKTsgY29uc3QgaGFpciA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2hhaXInLCB7IGhlaWdodDogMC4zLCBkaWFtZXRlclRvcDogMCwgZGlhbWV0ZXJCb3R0b206IGQuaGVhZCAqIDEuMiB9LCBzKTsgaGFpci5wYXJlbnQgPSB0aGlzLnJpZzsgaGFpci5wb3NpdGlvbi55ID0gaGVhZC5wb3NpdGlvbi55ICsgZC5oZWFkICogMC43NTsgaGFpci5tYXRlcmlhbCA9IG1hdCgnI2MyMmExYycpOyBoYWlyLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIHRoaXMudG9wID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDEuMzU7IHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgZC53ICogMC43KTtcbiAgICBjb25zdCBsYmwgPSBkeW4ocywgMjU2LCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgMjZweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5maWxsU3R5bGUgPSAnI2ZmZmZmZic7IGMuc3Ryb2tlU3R5bGUgPSAnIzExMSc7IGMubGluZVdpZHRoID0gNTsgYy5zdHJva2VUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgYy5maWxsVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IH0pO1xuICAgIGNvbnN0IGxwID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbGJsJywgeyB3aWR0aDogMS4xLCBoZWlnaHQ6IDAuMiB9LCBzKTsgbHAucGFyZW50ID0gdGhpcy5ob2xkZXI7IGxwLnBvc2l0aW9uLnkgPSAtMC4xOyBscC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDIgKiAwLjA7IGxwLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7IGNvbnN0IGxtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbG0nLCBzKTsgbG0uZGlmZnVzZVRleHR1cmUgPSBsYmw7IGxtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBsbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBsbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IGxwLm1hdGVyaWFsID0gbG07IGxwLmlzUGlja2FibGUgPSBmYWxzZTsgbHAucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC42MjtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IHRoaXMudG9wLCBkaWFtZXRlcjogTWF0aC5tYXgoMC43LCBkLncgKiAxLjMpIH0sIHMpOyB0aGlzLnBpY2sucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMucGljay5wb3NpdGlvbi55ID0gdGhpcy50b3AgLyAyOyB0aGlzLnBpY2sudmlzaWJpbGl0eSA9IDAuMDAxOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gICAgKHRoaXMgYXMgYW55KS5wYXJ0cyA9IFtscF07IHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBsYXkoJ2lkbGUnKTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7ICh0aGlzIGFzIGFueSkuZXllTS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5iYXNlID0gQkFMQU5DRS5zdGFyLnNjYWxlW3N0IC0gMV07IGNvbnN0IHQgPSBUSU5UW3N0IC0gMV07IHRoaXMuYm9keS5tYXRlcmlhbC5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5Gcm9tSGV4U3RyaW5nKFBIW3RoaXMuc291bF0uY29sKS5zY2FsZSgwLjcyKS5tdWx0aXBseShuZXcgQkFCWUxPTi5Db2xvcjMoTWF0aC5taW4oMSwgdFswXSksIE1hdGgubWluKDEsIHRbMV0pLCBNYXRoLm1pbigxLCB0WzJdKSkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0KHRoaXMudGVhbSwgc3QpOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0TWFuYShmKTsgfVxuICBwdWxzZSgpIHsgdGhpcy5wdWxzZVQgPSAwLjE2OyB9XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQgPSAxKSB7IGlmIChzdGF0ZSA9PT0gdGhpcy5zdGF0ZSAmJiAoc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bicpKSByZXR1cm47IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5zdDAgPSB0aGlzLnQ7IHRoaXMuZHVyID0gc3RhdGUgPT09ICdhdHRhY2snID8gKEJBTEFOQ0Uuc3RhdHNbdGhpcy5zb3VsIGFzIFNvdWxJZF0uYW5pbUxlbiAvIHNwZWVkKSA6IHN0YXRlID09PSAnZGVhdGgnID8gMC42IDogc3RhdGUgPT09ICdzcGF3bicgPyAwLjkgOiAxLjA7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTsgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMudCArPSBkdDsgdGhpcy5kZWNvLnVwZGF0ZShkdCk7IGNvbnN0IHAgPSBNYXRoLm1pbigxLCAodGhpcy50IC0gdGhpcy5zdDApIC8gdGhpcy5kdXIpLCBSID0gdGhpcy5yaWcsIFcgPSB0aGlzLndwO1xuICAgIFIucG9zaXRpb24uc2V0KDAsIDAsIDApOyBSLnJvdGF0aW9uLnNldCgwLCAwLCAwKTsgUi5zY2FsaW5nLnNldEFsbCgxKTsgVy5yb3RhdGlvbi54ID0gLTAuNDsgdGhpcy5sZWdzLmZvckVhY2goKGwpID0+IChsLnJvdGF0aW9uLnggPSAwKSk7XG4gICAgaWYgKHRoaXMuc3RhdGUgPT09ICdpZGxlJykgUi5wb3NpdGlvbi55ID0gTWF0aC5zaW4odGhpcy50ICogMi4yKSAqIDAuMDEyO1xuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdydW4nKSB7IGNvbnN0IHcgPSB0aGlzLnQgKiAxMDsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odykpICogMC4wNzsgUi5yb3RhdGlvbi54ID0gMC4yOyB0aGlzLmxlZ3NbMF0ucm90YXRpb24ueCA9IE1hdGguc2luKHcpICogMC45OyB0aGlzLmxlZ3NbMV0ucm90YXRpb24ueCA9IC1NYXRoLnNpbih3KSAqIDAuOTsgVy5yb3RhdGlvbi54ID0gLTAuNCArIE1hdGguc2luKHcpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2F0dGFjaycpIHsgY29uc3QgayA9IHAgPCAwLjQgPyAtMi40ICogKHAgLyAwLjQpIDogLTIuNCArIDMuNCAqIE1hdGgubWluKDEsIChwIC0gMC40KSAvIDAuMjUpOyBXLnJvdGF0aW9uLnggPSBrOyBSLnBvc2l0aW9uLnogPSAwLjE0ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyBSLnJvdGF0aW9uLnggPSAwLjE1ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgeyBjb25zdCBlID0gcCAqIHAgKiAoMyAtIDIgKiBwKTsgUi5zY2FsaW5nLnNldEFsbCgwLjAxICsgMC45OSAqIGUpOyBSLnBvc2l0aW9uLnkgPSAoZSAtIDEpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2RlYXRoJykgeyBjb25zdCBlID0gcCAqIHA7IFIucm90YXRpb24ueCA9IC1NYXRoLlBJIC8gMiAqIGU7IFIucG9zaXRpb24ueSA9IDAuMjUgKiBlOyBSLnBvc2l0aW9uLnogPSAtMC4yICogZTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odGhpcy50ICogNykpICogMC4xNTsgVy5yb3RhdGlvbi54ID0gLTIuNjsgfVxuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVZpc3VhbChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcik6IFVuaXRWaXN1YWwge1xuICBjb25zdCBjZmcgPSBBLnRyaXBvW3NvdWxdO1xuICByZXR1cm4gY2ZnID8gbmV3IFRyaXBvVmlzdWFsKEEsIGNmZywgc291bCwgdGVhbSwgc3RhcikgOiBuZXcgUGxhY2Vob2xkZXJWaXN1YWwoQSwgc291bCwgdGVhbSwgc3Rhcik7XG59XG5leHBvcnQgY29uc3QgaXNUcmlwbyA9IChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCkgPT4gISFBLnRyaXBvW3NvdWxdO1xuIiwgIi8vIERPTSB1c2VyIGludGVyZmFjZTogdG9wIGJhciwgZW5lbXkgcHJldmlldywgaGFuZCBvZiBjYXJkcywgYnV0dG9ucywgZHJhZnQgb3ZlcmxheSwgdG9hc3RzIGFuZCB0aGUgZGVidWcgcGFuZWwuXG5pbXBvcnQgeyBCQUxBTkNFLCBST0xFX1RFWFQsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgeyBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNvc3QsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBzdGFnZVdhdmVzIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBlbmVteVdhdmUsIHByZXZpZXdUZXh0IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuXG5jb25zdCBJQ09OOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0geyB3YXJyaW9yOiAnXFx1ezFGNDgwfScsIGFyY2hlcjogJ1xcdXsxRjNGOX0nLCBnb2JsaW46ICdcXHV7MUY1RTF9XHVGRTBGJywga25pZ2h0OiAnXFx1ezFGNkUxfVx1RkUwRicsIG9ncmU6ICdcXHV7MUY1Mjh9JywgYmFyYmFyaWFuOiAnXFx1ezFGQTkzfScgfTtcbmNvbnN0ICQgPSAoaWQ6IHN0cmluZykgPT4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpITtcbmNvbnN0IHN0YXJzID0gKG46IG51bWJlcikgPT4gJ1x1MjYwNScucmVwZWF0KG4pO1xuXG5leHBvcnQgY2xhc3MgVWkge1xuICBwcml2YXRlIHRvYXN0VCA9IDA7IHByaXZhdGUgZGJnOiBIVE1MRWxlbWVudDsgcHJpdmF0ZSBvZGRzID0gJyc7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgZzogYW55KSB7XG4gICAgJCgnYnRuSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgJCgnYnRuQmF0dGxlJykub25jbGljayA9ICgpID0+IGcuc3RhcnRCYXR0bGUoKTsgJCgnYnRuU3dhcCcpLm9uY2xpY2sgPSAoKSA9PiBnLnRvZ2dsZVN3YXAoKTtcbiAgICAkKCdidG5NZXJnZScpLm9uY2xpY2sgPSAoKSA9PiBnLm1lcmdlU2VsZWN0ZWQoKTsgJCgnYnRuUmVtb3ZlJykub25jbGljayA9ICgpID0+IGcucmVtb3ZlU2VsZWN0ZWQoKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtc3BlZWRdJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0U3BlZWQoK2IuZGF0YXNldC5zcGVlZCEpKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRDYW1Nb2RlKGIuZGF0YXNldC5jYW0hKSkpO1xuICAgICQoJ2dlYXInKS5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmRiZy5jbGFzc0xpc3QudG9nZ2xlKCdvcGVuJyk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICBjb25zdCBzbmQgPSAoKSA9PiB7ICQoJ2J0bk11c2ljJykuY2xhc3NMaXN0LnRvZ2dsZSgnb2ZmJywgIWF1ZGlvLm11c2ljKTsgJCgnYnRuU2Z4JykuY2xhc3NMaXN0LnRvZ2dsZSgnb2ZmJywgIWF1ZGlvLnNmeCk7IH07XG4gICAgJCgnYnRuTXVzaWMnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRNdXNpYyghYXVkaW8ubXVzaWMpOyBzbmQoKTsgfTsgJCgnYnRuU2Z4Jykub25jbGljayA9ICgpID0+IHsgYXVkaW8uc2V0U2Z4KCFhdWRpby5zZngpOyBzbmQoKTsgfTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MnLCBzbmQpOyBzbmQoKTtcbiAgICB0aGlzLmRiZyA9ICQoJ2RlYnVnJyk7IGlmIChuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdkZWJ1ZycpKSB0aGlzLmRiZy5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gICAgdGhpcy5yZW5kZXJEZWJ1ZygpO1xuICB9XG5cbiAgLyoqIFRoZSBOZWNyb21hbmNlciBqdXN0IGxvc3QgYSBoZWFydDogbWFrZSB0aGUgaGVhcnRzIGJ1bXAuICovXG4gIHB1bHNlSGVhcnRzKCkgeyBjb25zdCBoID0gJCgnaGVhcnRzJyk7IGguY2xhc3NMaXN0LnJlbW92ZSgnaHVydCcpOyB2b2lkIGgub2Zmc2V0V2lkdGg7IGguY2xhc3NMaXN0LmFkZCgnaHVydCcpOyB9XG4gIHRvYXN0KG1zZzogc3RyaW5nKSB7IGNvbnN0IHQgPSAkKCd0b2FzdCcpOyB0LnRleHRDb250ZW50ID0gbXNnOyB0LmNsYXNzTGlzdC5hZGQoJ3Nob3cnKTsgY2xlYXJUaW1lb3V0KHRoaXMudG9hc3RUKTsgdGhpcy50b2FzdFQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0LmNsYXNzTGlzdC5yZW1vdmUoJ3Nob3cnKSwgMzYwMCk7IH1cblxuICByZW5kZXIoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgcyA9IGcucywgcGggPSBnLnBoYXNlLCBidWlsZCA9IHBoID09PSAnYnVpbGQnO1xuICAgICQoJ2hlYXJ0cycpLnRleHRDb250ZW50ID0gJ1x1Mjc2NFx1RkUwRicucmVwZWF0KHMuaGVhcnRzKSArICdcXHV7MUY1QTR9Jy5yZXBlYXQoTWF0aC5tYXgoMCwgMyAtIHMuaGVhcnRzKSk7XG4gICAgJCgnd2F2ZScpLnRleHRDb250ZW50ID0gYFdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX1gO1xuICAgIGNvbnN0IHVzZWQgPSBkb21pbmlvblVzZWQocyk7ICQoJ2RvbScpLnRleHRDb250ZW50ID0gYCR7dXNlZH0vJHtzLmNhcH1gOyAoJCgnZG9tZmlsbCcpIGFzIEhUTUxFbGVtZW50KS5zdHlsZS53aWR0aCA9IE1hdGgubWluKDEwMCwgKHVzZWQgLyBzLmNhcCkgKiAxMDApICsgJyUnO1xuICAgIC8vIGVuZW15IHByZXZpZXc6IHdoYXQgaXMgY29taW5nLCBuZXZlciB3aGVyZVxuICAgIGNvbnN0IHB2ID0gcHJldmlld1RleHQoZW5lbXlXYXZlKHMud2F2ZSwgZy5zZWVkKSk7XG4gICAgJCgnZW5lbXknKS5pbm5lckhUTUwgPSBgPGI+TmV4dCBlbmVtaWVzPC9iPmAgKyBwdi5tYXAoKHApID0+IGA8ZGl2IGNsYXNzPVwiZXJvd1wiPjxzcGFuPiR7SUNPTltwLnNvdWwgYXMgU291bElkXX08L3NwYW4+PHNwYW4+JHtTT1VMX05BTUVbcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuIGNsYXNzPVwieFwiPlx1MDBENyR7cC5jb3VudH08L3NwYW4+PHNwYW4gY2xhc3M9XCJzdFwiPiR7c3RhcnMocC5zdGFyKX08L3NwYW4+PC9kaXY+YCkuam9pbignJykgKyBgPGRpdiBjbGFzcz1cImhpbnRcIj5Qb3NpdGlvbnMgc3RheSBoaWRkZW4gdW50aWwgdGhlIGJhdHRsZS48L2Rpdj5gO1xuICAgIC8vIGhhbmRcbiAgICBjb25zdCBoYW5kID0gJCgnaGFuZCcpOyBoYW5kLmlubmVySFRNTCA9ICcnO1xuICAgIHMuaGFuZC5mb3JFYWNoKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4ge1xuICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgY29uc3Qgc2VsID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIGcuc2VsLmlkeCA9PT0gaTsgY29uc3QgYWZmb3JkID0gY2FuU3VtbW9uKHMsIGkpLCBjYW5NZXJnZSA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKSwgdXNhYmxlID0gYWZmb3JkIHx8IGNhbk1lcmdlO1xuICAgICAgZWwuY2xhc3NOYW1lID0gJ2NhcmQnICsgKHNlbCA/ICcgc2VsJyA6ICcnKSArICghdXNhYmxlICYmICFnLnN3YXBNb2RlID8gJyBkaXMnIDogJycpICsgKGcuc3dhcE1vZGUgPyAnIHN3YXAnIDogJycpO1xuICAgICAgY29uc3QgdGFnID0gYWZmb3JkID8gYDxzcGFuIGNsYXNzPVwib2tcIj5TdW1tb248L3NwYW4+YCA6IGNhbk1lcmdlID8gJzxzcGFuIGNsYXNzPVwib2sgbWdcIj5NZXJnZSBvbmx5PC9zcGFuPicgOiAnPHNwYW4gY2xhc3M9XCJub1wiPk5vIHJvb208L3NwYW4+JztcbiAgICAgIGVsLmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiY29zdFwiPiR7Y29zdChzb3VsLCAxKX08L2Rpdj48ZGl2IGNsYXNzPVwiaWNcIj4ke0lDT05bc291bF19PC9kaXY+PGRpdiBjbGFzcz1cIm5tXCI+JHtTT1VMX05BTUVbc291bF19PC9kaXY+PGRpdiBjbGFzcz1cImNzXCI+JHt0YWd9PC9kaXY+YDsgZWwudGl0bGUgPSBST0xFX1RFWFRbc291bF0gKyAoYWZmb3JkID8gJycgOiBjYW5NZXJnZSA/ICcgLSBEb21pbmlvbiBpcyBmdWxsLCBidXQgeW91IGNhbiBtZXJnZSBpdCBpbnRvIHlvdXIgbWF0Y2hpbmcgMS1zdGFyIHVuaXQuJyA6ICcgLSBOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJyk7XG4gICAgICBlbC5vbmNsaWNrID0gKCkgPT4gZy5vbkNhcmQoaSk7IGhhbmQuYXBwZW5kQ2hpbGQoZWwpO1xuICAgIH0pO1xuICAgIGlmICghcy5oYW5kLmxlbmd0aCkgaGFuZC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cImVtcHR5XCI+Tm8gY2FyZHMgaW4gaGFuZDwvZGl2Pic7XG4gICAgLy8gYnV0dG9uc1xuICAgICgkKCdidG5CYXR0bGUnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhYnVpbGQgfHwgIXMudW5pdHMubGVuZ3RoO1xuICAgIGNvbnN0IHN3ID0gJCgnYnRuU3dhcCcpIGFzIEhUTUxCdXR0b25FbGVtZW50OyBzdy5kaXNhYmxlZCA9ICFidWlsZCB8fCBzLmRpc2NhcmRVc2VkOyBzdy5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGcuc3dhcE1vZGUpOyBzdy50ZXh0Q29udGVudCA9IHMuZGlzY2FyZFVzZWQgPyAnU3dhcCB1c2VkJyA6IGcuc3dhcE1vZGUgPyAnU3dhcDogcGljayBhIGNhcmQgb3IgdW5pdCcgOiAnU3dhcCAoMS9yb3VuZCknO1xuICAgIGNvbnN0IHNlbFUgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAndW5pdCcgPyBzLnVuaXRzLmZpbmQoKHU6IGFueSkgPT4gdS5pZCA9PT0gZy5zZWwuaWQpIDogbnVsbDtcbiAgICBjb25zdCBwYXJ0bmVyID0gc2VsVSAmJiBzLnVuaXRzLnNvbWUoKG86IGFueSkgPT4gY2FuTWVyZ2VEZXBsb3llZChzZWxVLCBvKSk7XG4gICAgJCgndW5pdHBhbmVsJykuc3R5bGUuZGlzcGxheSA9IGJ1aWxkICYmIHNlbFUgPyAnZmxleCcgOiAnbm9uZSc7ICgkKCdidG5NZXJnZScpIGFzIEhUTUxCdXR0b25FbGVtZW50KS5kaXNhYmxlZCA9ICFwYXJ0bmVyO1xuICAgICQoJ2J0blJlbW92ZScpLnRleHRDb250ZW50ID0gZy5jb25maXJtUmVtb3ZlID8gJ0NvbmZpcm0gcmVtb3ZlJyA6ICdSZW1vdmUnO1xuICAgICQoJ2luZm8nKS50ZXh0Q29udGVudCA9IGJ1aWxkID8gKGcuc3dhcE1vZGUgPyAnU1dBUDogdGFwIGEgaGFuZCBjYXJkIHRvIGRpc2NhcmQgaXQsIG9yIHRhcCBhIHVuaXQgeW91IGRpZCBub3Qgc3VtbW9uIHRoaXMgcm91bmQgdG8gc2VsbCBpdC4gWW91IGRyYXcgYSBkaWZmZXJlbnQgU291bC4nXG4gICAgICA6IHNlbFUgPyBgJHtTT1VMX05BTUVbc2VsVS5zb3VsIGFzIFNvdWxJZF19ICR7c3RhcnMoc2VsVS5zdGFyKX0gIFx1MjAyMiAgJHtST0xFX1RFWFRbc2VsVS5zb3VsIGFzIFNvdWxJZF19ICAke3BhcnRuZXIgPyAnXHUyMDIyIFRhcCBhIGdsb3dpbmcgcGFydG5lciB0byBtZXJnZS4nIDogJyd9YFxuICAgICAgOiBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAnY2FyZCcgPyBgJHtTT1VMX05BTUVbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX06ICR7Uk9MRV9URVhUW3MuaGFuZFtnLnNlbC5pZHhdIGFzIFNvdWxJZF19ICBcdTIwMjIgIGAgKyAoKCkgPT4geyBjb25zdCBpID0gZy5zZWwuaWR4LCBzbSA9IGNhblN1bW1vbihzLCBpKSwgbWcgPSBzLnVuaXRzLnNvbWUoKHU6IGFueSkgPT4gY2FuTWVyZ2VGcm9tSGFuZChzLCBpLCB1LmlkKSk7IHJldHVybiBzbSAmJiBtZyA/ICdUYXAgYSBncmVlbiB0aWxlIHRvIHN1bW1vbiwgb3IgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiBzbSA/ICdUYXAgYSBncmVlbiB0aWxlIHRvIHN1bW1vbi4nIDogbWcgPyAnRG9taW5pb24gaXMgZnVsbDogdGFwIGEgZ2xvd2luZyBwdXJwbGUgdW5pdCB0byBtZXJnZSBpdCBpbi4nIDogJ05vdCBlbm91Z2ggZnJlZSBEb21pbmlvbiB0byBzdW1tb24gdGhpcy4nOyB9KSgpIDogJ1RhcCBhIGNhcmQsIHRoZW4gYSB0aWxlLiBUYXAgYSB1bml0IHRvIG1lcmdlLCBtb3ZlIG9yIHJlbW92ZSBpdC4nKVxuICAgICAgOiBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdCYXR0bGUhIFVuaXRzIGZpZ2h0IG9uIHRoZWlyIG93bi4nIDogJyc7XG4gICAgJCgnc3BlZWQnKS5zdHlsZS5kaXNwbGF5ID0gcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnZmxleCcgOiAnbm9uZSc7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLXNwZWVkXScpLmZvckVhY2goKGIpID0+IGIuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCArYi5kYXRhc2V0LnNwZWVkISA9PT0gZy50aW1lU2NhbGUpKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IGIuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBiLmRhdGFzZXQuY2FtID09PSBnLmNhbU1vZGUpKTtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC50b2dnbGUoJ2luYmF0dGxlJywgcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicpOyBhdWRpby5zZXRNb2RlKHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2JhdHRsZScgOiAnYnVpbGQnKTtcbiAgICAvLyBvdmVybGF5XG4gICAgY29uc3Qgb3YgPSAkKCdvdmVybGF5Jyk7IG92LmNsYXNzTmFtZSA9ICcnOyBvdi5pbm5lckhUTUwgPSAnJztcbiAgICBpZiAocGggPT09ICdkcmFmdCcgJiYgZy5kcmFmdCkge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5WaWN0b3J5IERyYWZ0PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+V2F2ZSBjbGVhcmVkLiBEb21pbmlvbiBpcyBub3cgJHtzLmNhcH0uIEtlZXAgb25lOjwvZGl2PjxkaXYgY2xhc3M9XCJyb3dcIj4ke2cuZHJhZnQubWFwKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4gYDxkaXYgY2xhc3M9XCJjYXJkIGJpZ1wiIGRhdGEtaT1cIiR7aX1cIj48ZGl2IGNsYXNzPVwiY29zdFwiPiR7Y29zdChzb3VsLCAxKX08L2Rpdj48ZGl2IGNsYXNzPVwiaWNcIj4ke0lDT05bc291bF19PC9kaXY+PGRpdiBjbGFzcz1cIm5tXCI+JHtTT1VMX05BTUVbc291bF19PC9kaXY+PGRpdiBjbGFzcz1cInJvbGVcIj4ke1JPTEVfVEVYVFtzb3VsXX08L2Rpdj48L2Rpdj5gKS5qb2luKCcnKX08L2Rpdj48L2Rpdj5gO1xuICAgICAgb3YucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJy5jYXJkJykuZm9yRWFjaCgoYykgPT4gKGMub25jbGljayA9ICgpID0+IGcucGlja0RyYWZ0KCtjLmRhdGFzZXQuaSEpKSk7XG4gICAgfSBlbHNlIGlmIChwaCA9PT0gJ3dvbicgfHwgcGggPT09ICdsb3N0Jykge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj4ke3BoID09PSAnd29uJyA/ICdTdGFnZSBjbGVhcmVkIScgOiAnU3RhZ2UgbG9zdCd9PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+JHtnLmxhc3RCYXR0bGV9PC9kaXY+PGRpdiBjbGFzcz1cInJvd1wiPjxidXR0b24gaWQ9XCJhZ2FpblwiIGNsYXNzPVwiZ29cIj4ke3BoID09PSAnd29uJyA/ICdQbGF5IGFnYWluJyA6ICdUcnkgYWdhaW4nfTwvYnV0dG9uPjxidXR0b24gaWQ9XCJ0b0hvbWVcIiBjbGFzcz1cImJsdWVcIj5Ib21lPC9idXR0b24+PC9kaXY+PC9kaXY+YDtcbiAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IGcubmV3UnVuKCk7ICQoJ3RvSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgfVxuICAgIHRoaXMucmVuZGVyRGVidWdMaXZlKCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgcGFuZWxcbiAgcHJpdmF0ZSByZW5kZXJEZWJ1ZygpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBkID0gdGhpcy5kYmc7IGlmICghZC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSkgeyBkLmlubmVySFRNTCA9ICcnOyByZXR1cm47IH1cbiAgICBjb25zdCByb3cgPSAobGFiZWw6IHN0cmluZywgb2JqOiBhbnksIGtleTogc3RyaW5nIHwgbnVtYmVyLCBtaW46IG51bWJlciwgbWF4OiBudW1iZXIsIHN0ZXA6IG51bWJlcikgPT4gYDxsYWJlbD4ke2xhYmVsfSA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiJHttaW59XCIgbWF4PVwiJHttYXh9XCIgc3RlcD1cIiR7c3RlcH1cIiB2YWx1ZT1cIiR7b2JqW2tleV19XCIgZGF0YS1vPVwiJHtsYWJlbH1cIj48c3Bhbj4ke29ialtrZXldfTwvc3Bhbj48L2xhYmVsPmA7XG4gICAgZC5pbm5lckhUTUwgPSBgPGI+RGVidWcgKGxpdmUpPC9iPiA8c3BhbiBpZD1cImRiZ2Zwc1wiPjwvc3Bhbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+U3RhciBtdWx0aXBsaWVycyAoYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHkpXG4gICAgICAgICR7cm93KCdIUCB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdIUCB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnU2l6ZSAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAxLCAxLCAxLjYsIDAuMDIpfSR7cm93KCdTaXplIDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDIsIDEsIDIsIDAuMDIpfTwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48dGFibGU+PHRyPjx0aD48L3RoPjx0aD5ocDwvdGg+PHRoPmRtZzwvdGg+PHRoPnJhdGU8L3RoPjx0aD5yYW5nZTwvdGg+PHRoPnNwZDwvdGg+PC90cj4ke1NPVUxTLm1hcCgoaykgPT4gYDx0cj48dGQ+JHtJQ09OW2tdfTwvdGQ+JHtbJ2hwJywgJ2RtZycsICdpbnRlcnZhbCcsICdyYW5nZScsICdzcGVlZCddLm1hcCgoZikgPT4gYDx0ZD48aW5wdXQgY2xhc3M9XCJudW1cIiBkYXRhLXNvdWw9XCIke2t9XCIgZGF0YS1mPVwiJHtmfVwiIHZhbHVlPVwiJHsoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2tdW2ZdfVwiPjwvdGQ+YCkuam9pbignJyl9PC90cj5gKS5qb2luKCcnKX08L3RhYmxlPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5EaWZmaWN1bHR5IDxzZWxlY3QgaWQ9XCJkRGlmZlwiPiR7WydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZE9kZHNcIj5UZXN0IG9kZHMgKDIwMCBmaWdodHMpPC9idXR0b24+IDxzcGFuIGlkPVwiZE9kZHNPdXRcIj4ke3RoaXMub2Rkc308L3NwYW4+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkQ29weVwiPkNvcHkgcmVwb3J0PC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzZXRcIj5SZXNldCBiYWxhbmNlPC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzdGFydFwiPlJlc3RhcnQgc3RhZ2U8L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+QWRkIGNhcmQgPHNlbGVjdCBpZD1cImRDYXJkXCI+JHtTT1VMUy5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiPiR7U09VTF9OQU1FW2tdfTwvb3B0aW9uPmApLmpvaW4oJycpfTwvc2VsZWN0PiA8YnV0dG9uIGlkPVwiZEFkZFwiPis8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImREb21cIj4rMiBEb21pbmlvbjwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+TGFzdCB0YXA6IDxzcGFuIGlkPVwiZGJndGFwXCI+JHtnLmxhc3RUYXBJbmZvfTwvc3Bhbj48L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+U2VlZCAke2cuc2VlZH0uIEFkZCA8Y29kZT4/c2VlZD03PC9jb2RlPiB0byB0aGUgbGluayB0byByZXBsYXkgdGhlIHNhbWUgZHJhd3MuPC9zbWFsbD48L2Rpdj5gO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXRbdHlwZT1yYW5nZV0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25pbnB1dCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGxhYiA9IGlucC5kYXRhc2V0Lm8hOyBjb25zdCB2ID0gK2lucC52YWx1ZTsgKGlucC5uZXh0RWxlbWVudFNpYmxpbmcgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gU3RyaW5nKHYpO1xuICAgICAgY29uc3Qgc2V0OiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkPiA9IHsgJ0hQIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMV0gPSB2KSwgJ0hQIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMl0gPSB2KSwgJ0RhbWFnZSB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1sxXSA9IHYpLCAnRGFtYWdlIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzJdID0gdiksICdTaXplIDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzFdID0gdiksICdTaXplIDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzJdID0gdikgfTtcbiAgICAgIHNldFtsYWJdKCk7IGcuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7XG4gICAgfSkpO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXQubnVtJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uY2hhbmdlID0gKCkgPT4geyAoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2lucC5kYXRhc2V0LnNvdWwhXVtpbnAuZGF0YXNldC5mIV0gPSAraW5wLnZhbHVlOyB9KSk7XG4gICAgJCgnZERpZmYnKS5vbmNoYW5nZSA9IChlKSA9PiBnLmNoYW5nZURpZmZpY3VsdHkoKGUudGFyZ2V0IGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSk7XG4gICAgJCgnZE1lcmdlSGFuZCcpLm9uY2hhbmdlID0gKGUpID0+IHsgZy5zLnJ1bGVzLm1lcmdlID0gKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQgPyAnaGFuZEludG9PbmVTdGFyJyA6ICdkZXBsb3llZE9ubHknOyBnLnN5bmNCdWlsZCgpOyB0aGlzLnJlbmRlcigpOyB9O1xuICAgICQoJ2RPZGRzJykub25jbGljayA9ICgpID0+IHsgY29uc3QgciA9IGcudGVzdE9kZHMoMjAwKTsgdGhpcy5vZGRzID0gYCR7ci53aW59JSB3aW4gKCR7ci5ufSBmaWdodHMsIGF2ZyAke3IuYXZnVGltZX1zKSB2cyB3YXZlICR7Zy5zLndhdmV9YDsgJCgnZE9kZHNPdXQnKS50ZXh0Q29udGVudCA9IHRoaXMub2RkczsgfTtcbiAgICAkKCdkQ29weScpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdSZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkUmVzZXQnKS5vbmNsaWNrID0gKCkgPT4geyBnLnJlc2V0QmFsYW5jZUFsbCgpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgJCgnZFJlc3RhcnQnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydFN0YWdlKGcuc2VlZCk7XG4gICAgJCgnZEFkZCcpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZENhcmQoKCQoJ2RDYXJkJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlIGFzIFNvdWxJZCk7ICQoJ2REb20nKS5vbmNsaWNrID0gKCkgPT4gZy5hZGREb21pbmlvbigyKTtcbiAgfVxuICBwcml2YXRlIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5lbmdpbmUuZ2V0RnBzKCkudG9GaXhlZCgwKX0gZnBzIFx1MjAyMiAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJndGFwJyk7IGlmICh0KSB0LnRleHRDb250ZW50ID0gdGhpcy5nLmxhc3RUYXBJbmZvO1xuICB9XG59XG4iLCAiLy8gVGhlIHBsYXlhYmxlIHByb3RvdHlwZTogYnVpbGQgc2NyZWVuIC0+IGJhdHRsZSAtPiBkcmFmdCAtPiBuZXh0IHdhdmUsIGJ1aWx0IG9uIHRoZSB0ZXN0ZWQgcnVsZXMgKyBiYXR0bGUgZW5naW5lLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFLCByZXNldEJhbGFuY2UsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBHUklEX0NFTExTLCBHUklEX0NPTFMsIEdSSURfUk9XUywgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHtcbiAgYWR2YW5jZVdhdmUsIGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY2VsbEZyZWUsIGNvc3QsIGRpc2NhcmRSZWRyYXcsIGRpc21pc3MsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBkcmFmdE9wdGlvbnMsIGZhaWxXYXZlLFxuICBtZXJnZURlcGxveWVkLCBtZXJnZUZyb21IYW5kLCBtb3ZlVW5pdCwgbmV3U3RhZ2UsIG5vcm1hbERyYXcsIHN0YWdlV2F2ZXMsIHN1bW1vbiwgc3dhcFNlbGwsIHRha2VEcmFmdCxcbn0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBCYXR0bGUsIGNlbGxQb3MsIEZST05UX1gsIEdSSURfU1AsIHNpbXVsYXRlIH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHR5cGUgeyBCRXZlbnQgfSBmcm9tICcuLi9jb3JlL2JhdHRsZS50cyc7XG5pbXBvcnQgeyBkaWZmaWN1bHR5TmFtZSwgZW5lbXlXYXZlLCBzZXREaWZmaWN1bHR5IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuLi9jb3JlL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgeyBsb2FkU2F2ZSB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5pbXBvcnQgeyBOZWNyb21hbmNlciB9IGZyb20gJy4vbmVjcm9tYW5jZXIudHMnO1xuaW1wb3J0IHsgYXVkaW8gfSBmcm9tICcuL2F1ZGlvLnRzJztcbmltcG9ydCB7IGNyZWF0ZVZpc3VhbCwgaXNUcmlwbywgbG9hZEFzc2V0cyB9IGZyb20gJy4vdmlzdWFscy50cyc7XG5pbXBvcnQgdHlwZSB7IEFzc2V0cywgVW5pdFZpc3VhbCB9IGZyb20gJy4vdmlzdWFscy50cyc7XG5pbXBvcnQgeyBVaSB9IGZyb20gJy4vdWkudHMnO1xuXG5leHBvcnQgdHlwZSBQaGFzZSA9ICdidWlsZCcgfCAndHJhbnNpdGlvbicgfCAnYmF0dGxlJyB8ICdkcmFmdCcgfCAnd29uJyB8ICdsb3N0JztcbnR5cGUgU2VsID0geyB0eXBlOiAnY2FyZCc7IGlkeDogbnVtYmVyIH0gfCB7IHR5cGU6ICd1bml0JzsgaWQ6IG51bWJlciB9IHwgbnVsbDtcblxuZXhwb3J0IGNsYXNzIEdhbWUge1xuICBlbmdpbmU6IGFueTsgc2NlbmU6IGFueTsgY2FtZXJhOiBhbnk7IEEhOiBBc3NldHM7IHVpITogVWk7XG4gIHMhOiBTdGF0ZTsgc2VlZCA9IDE7IGF0dGVtcHQgPSAwOyBwaGFzZTogUGhhc2UgPSAnYnVpbGQnOyBiYXR0bGU6IEJhdHRsZSB8IG51bGwgPSBudWxsOyB0aW1lU2NhbGUgPSAxO1xuICBzZWw6IFNlbCA9IG51bGw7IHN3YXBNb2RlID0gZmFsc2U7IGNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgZHJhZnQ6IFNvdWxJZFtdIHwgbnVsbCA9IG51bGw7IGxhc3RCYXR0bGUgPSAnJztcbiAgcHJpdmF0ZSB1bml0VmlzID0gbmV3IE1hcDxudW1iZXIsIFVuaXRWaXN1YWw+KCk7ICAgICAgICAvLyB1bml0IGlkIC0+IHZpc3VhbCAoeW91ciBhcm15LCBwZXJzaXN0cyBiZXR3ZWVuIHdhdmVzKVxuICBwcml2YXRlIHZpc1RvVW5pdCA9IG5ldyBNYXA8VW5pdFZpc3VhbCwgbnVtYmVyPigpO1xuICBwcml2YXRlIGZ2aXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgICAgIC8vIGZpZ2h0ZXIgaWQgLT4gdmlzdWFsIGR1cmluZyBhIGJhdHRsZVxuICBwcml2YXRlIGZVbml0ID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKTsgICAgICAgICAgICAgIC8vIGZpZ2h0ZXIgaWQgLT4gdW5pdCBpZCAocGxheWVyIHNpZGUpXG4gIHByaXZhdGUgbGFzdFN0YXRlID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZz4oKTtcbiAgcHJpdmF0ZSB0aWxlczogYW55W10gPSBbXTsgcHJpdmF0ZSB0aWxlTWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSByaW5nRng6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbWVyczogeyB0OiBudW1iZXI7IGZuOiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIGFjYyA9IDA7IHByaXZhdGUgY2FtRnJvbTogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UID0gMTsgcHJpdmF0ZSBjYW1EdXIgPSAyLjA7IHByaXZhdGUgcmVzdWx0QXQgPSAtMTsgcHJpdmF0ZSBoYW5kbGVkID0gZmFsc2U7IHByaXZhdGUgc3RhcnRTdGVwQXQgPSAwO1xuICBwcml2YXRlIGFycm93TWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd01lc2g6IGFueVtdID0gW107XG4gIG5lY3JvITogTmVjcm9tYW5jZXI7XG4gIHByaXZhdGUgY2luZSA9IGZhbHNlOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSByZXN1bHQgY3V0c2NlbmUgaXMgcGxheWluZzogdGhlIGJhdHRsZSBjYW1lcmEgYW5kIGZpZ2h0ZXIgc3luYyBzdGFuZCBkb3duXG4gIHByaXZhdGUgdHdlZW5zOiB7IHQ6IG51bWJlcjsgZHVyOiBudW1iZXI7IGZuOiAodTogbnVtYmVyKSA9PiB2b2lkOyBkb25lPzogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSB0d2VlbihkdXI6IG51bWJlciwgZm46ICh1OiBudW1iZXIpID0+IHZvaWQsIGRvbmU/OiAoKSA9PiB2b2lkKSB7IHRoaXMudHdlZW5zLnB1c2goeyB0OiAwLCBkdXIsIGZuLCBkb25lIH0pOyB9XG4gIC8qKiBGaW5pc2ggZXZlcnkgcnVubmluZyBhbmltYXRpb24gYXQgb25jZSAoc28gbm90aGluZyBpcyBsZWZ0IGhhbGYtd2F5IG9yIHVuZGlzcG9zZWQgd2hlbiB0aGUgcGhhc2UgY2hhbmdlcykuICovXG4gIHByaXZhdGUgZmx1c2hUd2VlbnMoKSB7IGZvciAoY29uc3QgdyBvZiB0aGlzLnR3ZWVucy5zcGxpY2UoMCkpIHsgdy5mbigxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICBwcml2YXRlIHNlZW5NZXJnZXMgPSAwO1xuXG4gIGFzeW5jIGluaXQoY2FudmFzOiBIVE1MQ2FudmFzRWxlbWVudCkge1xuICAgIGNvbnN0IHFzID0gbmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpO1xuICAgIHRoaXMuZW5naW5lID0gbmV3IEJBQllMT04uRW5naW5lKGNhbnZhcywgdHJ1ZSwgeyBhbnRpYWxpYXM6IHRydWUsIHBvd2VyUHJlZmVyZW5jZTogJ2hpZ2gtcGVyZm9ybWFuY2UnIH0pO1xuICAgIGNvbnN0IGRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7IHRoaXMuZW5naW5lLnNldEhhcmR3YXJlU2NhbGluZ0xldmVsKDEgLyBNYXRoLm1pbihkcHIsIDEuNSkpO1xuICAgIGNvbnN0IHNjZW5lID0gdGhpcy5zY2VuZSA9IG5ldyBCQUJZTE9OLlNjZW5lKHRoaXMuZW5naW5lKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjA5LCAwLjA3LCAwLjEzLCAxKTtcbiAgICBjb25zdCBoZW1pID0gbmV3IEJBQllMT04uSGVtaXNwaGVyaWNMaWdodCgnaCcsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAxLCAwLjMpLCBzY2VuZSk7IGhlbWkuaW50ZW5zaXR5ID0gMS4wNTsgaGVtaS5ncm91bmRDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjMyLCAwLjI2LCAwLjQyKTtcbiAgICBjb25zdCBzdW4gPSBuZXcgQkFCWUxPTi5EaXJlY3Rpb25hbExpZ2h0KCdzJywgbmV3IEJBQllMT04uVmVjdG9yMygtMC40LCAtMSwgMC41NSksIHNjZW5lKTsgc3VuLmludGVuc2l0eSA9IDAuODU7XG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgQkFCWUxPTi5GcmVlQ2FtZXJhKCdjYW0nLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDgsIC05KSwgc2NlbmUpOyB0aGlzLmNhbWVyYS5taW5aID0gMC4xOyB0aGlzLmNhbWVyYS5tYXhaID0gMjAwOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg7IHRoaXMuY2FtZXJhLmlucHV0cy5jbGVhcigpO1xuXG4gICAgY29uc3QgZ3JvdW5kID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ2dyb3VuZCcsIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQwIH0sIHNjZW5lKTtcbiAgICBjb25zdCBnbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2dtJywgc2NlbmUpOyBnbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xNywgMC4xNSwgMC4yMSk7IGdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBncm91bmQubWF0ZXJpYWwgPSBnbTsgZ3JvdW5kLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHRlYW0gb2YgWzAsIDFdIGFzIGNvbnN0KSBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBjb25zdCB0ID0gdGhpcy5tYWtlVGlsZSh0ZWFtLCBjKTsgaWYgKHRlYW0gPT09IDApIHRoaXMudGlsZXMucHVzaCh0KTsgZWxzZSB0LnNldEVuYWJsZWQoZmFsc2UpOyB9XG5cbiAgICB0aGlzLkEgPSBhd2FpdCBsb2FkQXNzZXRzKHNjZW5lKTtcbiAgICB0aGlzLm5lY3JvID0gbmV3IE5lY3JvbWFuY2VyKHNjZW5lLCB0aGlzLkEuc29mdCk7ICAgICAgIC8vIHN0YW5kcyBqdXN0IGJlaGluZCBoaXMgYXJteSdzIGJhY2sgY29sdW1uLCBmYWNpbmcgdGhlIGJhdHRsZWZpZWxkXG4gICAgdGhpcy5uZWNyby5ob2xkZXIucG9zaXRpb24uc2V0KC0oRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC0gMS4wNSwgMCwgMCk7IHRoaXMubmVjcm8uaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjtcbiAgICB0aGlzLmFycm93TWF0cyA9IFswLCAxXS5tYXAoKHQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2FtJyArIHQsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMywgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC43LCAwLjI1KTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyByZXR1cm4gbTsgfSk7XG4gICAgdGhpcy51aSA9IG5ldyBVaSh0aGlzKTsgdGhpcy5zZWVkID0gKyhxcy5nZXQoJ3NlZWQnKSB8fCAxKTtcblxuICAgIC8vIFRhcHMgYXJlIGRldGVjdGVkIGhlcmUgKG5vdCB0aHJvdWdoIEJhYnlsb24pIHNvIHRoZXkgYmVoYXZlIHRoZSBzYW1lIGluIFNhZmFyaSwgdGhlIGhvbWUtc2NyZWVuIGFwcCBhbmQgb24gZGVza3RvcC5cbiAgICBsZXQgZG93bjogeyB4OiBudW1iZXI7IHk6IG51bWJlcjsgdDogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBsb2NhbCA9IChlOiBQb2ludGVyRXZlbnQpID0+IHsgY29uc3QgciA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsgcmV0dXJuIHsgeDogZS5jbGllbnRYIC0gci5sZWZ0LCB5OiBlLmNsaWVudFkgLSByLnRvcCB9OyB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyZG93bicsIChlKSA9PiB7IGRvd24gPSB7IC4uLmxvY2FsKGUpLCB0OiBwZXJmb3JtYW5jZS5ub3coKSB9OyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcnVwJywgKGUpID0+IHsgaWYgKCFkb3duKSByZXR1cm47IGNvbnN0IHAgPSBsb2NhbChlKTsgY29uc3QgbW92ZWQgPSBNYXRoLmh5cG90KHAueCAtIGRvd24ueCwgcC55IC0gZG93bi55KSwgZHQgPSBwZXJmb3JtYW5jZS5ub3coKSAtIGRvd24udDsgZG93biA9IG51bGw7IGlmIChtb3ZlZCA8IDE2ICYmIGR0IDwgOTAwKSB0aGlzLnRhcChwLngsIHAueSk7IH0pO1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyY2FuY2VsJywgKCkgPT4geyBkb3duID0gbnVsbDsgfSk7XG4gICAgdGhpcy5jYW52YXMgPSBjYW52YXM7IGNvbnN0IG9uUmVzaXplID0gKCkgPT4gdGhpcy5oYW5kbGVSZXNpemUoKTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpOyB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignb3JpZW50YXRpb25jaGFuZ2UnLCAoKSA9PiBzZXRUaW1lb3V0KG9uUmVzaXplLCAyNTApKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0KSAod2luZG93IGFzIGFueSkudmlzdWFsVmlld3BvcnQuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpO1xuICAgIGlmICgod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIpIG5ldyAod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIob25SZXNpemUpLm9ic2VydmUoY2FudmFzKTtcbiAgICBpZiAocXMuZ2V0KCdnYWxsZXJ5JykpIHsgdGhpcy5nYWxsZXJ5KCk7IHJldHVybjsgfVxuICAgIHRoaXMuc3RhcnRTdGFnZSh0aGlzLnNlZWQpO1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG5vdyA9IHBlcmZvcm1hbmNlLm5vdygpOyBjb25zdCBkdCA9IE1hdGgubWluKDAuMDUsIChub3cgLSBsYXN0KSAvIDEwMDApOyBsYXN0ID0gbm93OyBpZiAoIXRoaXMuYWN0aXZlKSByZXR1cm47IGlmICghdGhpcy5mcm96ZW4pIHRoaXMuZnJhbWUoZHQpOyBzY2VuZS5yZW5kZXIoKTsgfSk7XG4gIH1cbiAgLyoqIFRoZSBuYXZpZ2F0aW9uIHNoZWxsIGhpZGVzIHRoZSBiYXR0bGUgc2NyZWVuIHdoaWxlIGFub3RoZXIgdGFiIGlzIG9wZW46IHBhdXNlIHRoZSBnYW1lIHNvIGl0IGNvc3RzIG5vdGhpbmcuICovXG4gIHByaXZhdGUgYWN0aXZlID0gdHJ1ZTtcbiAgLyoqIERlYnVnOiBrZWVwIGRyYXdpbmcgYnV0IHN0b3AgYWR2YW5jaW5nIHRpbWUsIHNvIGEgbW9tZW50IGNhbiBiZSBzdGVwcGVkIHRocm91Z2ggd2l0aCBmcmFtZShkdCkgYW5kIHNjcmVlbnNob3R0ZWQuICovXG4gIGZyb3plbiA9IGZhbHNlO1xuICBzdGVwKGR0OiBudW1iZXIpIHsgdGhpcy5mcmFtZShkdCk7IH1cbiAgc2V0QWN0aXZlKG9uOiBib29sZWFuKSB7IHRoaXMuYWN0aXZlID0gb247IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzY2VuZSBoZWxwZXJzXG4gIHByaXZhdGUgbWFrZVRpbGUodGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHAgPSBjZWxsUG9zKHRlYW0sIGNlbGwpLCB0ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgndGlsZScgKyBjZWxsLCB7IHNpemU6IEdSSURfU1AgKiAwLjkyIH0sIHRoaXMuc2NlbmUpO1xuICAgIHQucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0LnBvc2l0aW9uLnNldChwLngsIDAuMDE1LCBwLnopO1xuICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd0bScsIHRoaXMuc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xOCwgMC4xMiwgMC40MikgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC40MiwgMC4xMiwgMC4xMik7IG0uYWxwaGEgPSAwLjU7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgdC5tYXRlcmlhbCA9IG07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgdC5tZXRhZGF0YSA9IHsga2luZDogJ3RpbGUnLCBjZWxsIH07IHRoaXMudGlsZU1hdHNbY2VsbF0gPSBtOyB9IGVsc2UgdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgcmV0dXJuIHQ7XG4gIH1cbiAgcHJpdmF0ZSB0aW50KGNlbGw6IG51bWJlciwgbW9kZTogJ25vcm1hbCcgfCAnZnJlZScgfCAnc2VsJyB8ICdwYXJ0bmVyJykge1xuICAgIGNvbnN0IG0gPSB0aGlzLnRpbGVNYXRzW2NlbGxdOyBjb25zdCBjID0geyBub3JtYWw6IFswLjE4LCAwLjEyLCAwLjQyLCAwLjVdLCBmcmVlOiBbMC4yLCAwLjc1LCAwLjU1LCAwLjddLCBzZWw6IFsxLCAwLjgyLCAwLjMsIDAuODVdLCBwYXJ0bmVyOiBbMC44NSwgMC4zNSwgMSwgMC44NV0gfVttb2RlXTtcbiAgICBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoY1swXSwgY1sxXSwgY1syXSk7IG0uYWxwaGEgPSBjWzNdO1xuICB9XG4gIGxhdGVyKHNlYzogbnVtYmVyLCBmbjogKCkgPT4gdm9pZCkgeyB0aGlzLnRpbWVycy5wdXNoKHsgdDogc2VjLCBmbiB9KTsgfVxuICBwcml2YXRlIGZ4UmluZyh4OiBudW1iZXIsIHo6IG51bWJlciwgY29sb3I6IGFueSwgcjA6IG51bWJlciwgcjE6IG51bWJlciwgZHVyOiBudW1iZXIpIHtcbiAgICBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnZngnLCB7IGRpYW1ldGVyOiAxLCB0aGlja25lc3M6IDAuMDM1LCB0ZXNzZWxsYXRpb246IDI4IH0sIHRoaXMuc2NlbmUpOyBtLnBvc2l0aW9uLnNldCh4LCAwLjA1LCB6KTsgbS5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgbW0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdmeG0nLCB0aGlzLnNjZW5lKTsgbW0uZW1pc3NpdmVDb2xvciA9IGNvbG9yOyBtbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtbS5hbHBoYSA9IDAuOTsgbS5tYXRlcmlhbCA9IG1tOyB0aGlzLnJpbmdGeC5wdXNoKHsgbSwgbW0sIHQ6IDAsIHIwLCByMSwgZHVyIH0pO1xuICB9XG4gIHByaXZhdGUgYnVyc3QoeDogbnVtYmVyLCB6OiBudW1iZXIsIGMxOiBudW1iZXJbXSwgYzI6IG51bWJlcltdLCBjb3VudDogbnVtYmVyKSB7XG4gICAgY29uc3QgcHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnYicsIDYwLCB0aGlzLnNjZW5lKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGhpcy5BLnNvZnQ7IHBzLmVtaXR0ZXIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKHgsIDAuMDUsIHopOyBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yLCAwLCAtMC4yKTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAwLjA1LCAwLjIpO1xuICAgIHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzEgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMiBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4xLCAwLCAwLjIsIDApO1xuICAgIHBzLm1pblNpemUgPSAwLjEyOyBwcy5tYXhTaXplID0gMC4zNDsgcHMubWluTGlmZVRpbWUgPSAwLjQ7IHBzLm1heExpZmVUaW1lID0gMC45OyBwcy5lbWl0UmF0ZSA9IDA7IHBzLm1hbnVhbEVtaXRDb3VudCA9IGNvdW50OyBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMSwgMS4zLCAtMSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDEsIDIuNCwgMSk7XG4gICAgcHMubWluRW1pdFBvd2VyID0gMC44OyBwcy5tYXhFbWl0UG93ZXIgPSAyOyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAtMiwgMCk7IHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMudGFyZ2V0U3RvcER1cmF0aW9uID0gMS4yOyBwcy5kaXNwb3NlT25TdG9wID0gdHJ1ZTsgcHMuc3RhcnQoKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGNhbWVyYVxuICBwcml2YXRlIHBvc2VzKCkge1xuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IGhhbGYgPSBGUk9OVF9YICsgKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCArIDEuNDtcbiAgICBjb25zdCBkID0gTWF0aC5tYXgoaGFsZiAvICh0YW5WICogYXNwKSwgKChHUklEX1JPV1MgKiBHUklEX1NQKSAvIDIgKyAyKSAvICh0YW5WICogMC41NSksIDgpO1xuICAgIGNvbnN0IGJhdHRsZSA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjEgKiBkLCAwLjQyICogZCArIDAuNSwgLTAuODYgKiBkKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuMzUsIDApIH07XG4gICAgLy8gQnVpbGQgdmlldzogKGFsbW9zdCkgc3RyYWlnaHQgZG93biwgd2l0aCB0aGUgd2hvbGUgZ3JpZCBpbnNpZGUgdGhlIGJhbmQgYmV0d2VlbiB0aGUgdG9wIGJhciBhbmQgdGhlIGhhbmQgb2YgY2FyZHMuXG4gICAgY29uc3QgY3ggPSAtKEZST05UX1ggKyAoKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCkgLyAyKSwgSCA9IE1hdGgubWF4KDEsIHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCk7XG4gICAgY29uc3QgYm94ID0gKGlkOiBzdHJpbmcpID0+IHsgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7IHJldHVybiBlbCAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGwgPyBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKSA6IG51bGw7IH07XG4gICAgY29uc3QgdG9wQmFyID0gYm94KCd0b3AnKSwgaGFuZCA9IGJveCgnaGFuZCcpLCBpbmZvID0gYm94KCdpbmZvJyk7XG4gICAgY29uc3QgVE9QID0gTWF0aC5taW4oMC4zMiwgdG9wQmFyID8gKHRvcEJhci5ib3R0b20gKyA2KSAvIEggOiAwLjEpO1xuICAgIGNvbnN0IEJPVFRPTSA9IE1hdGgubWluKDAuNSwgKEggLSBNYXRoLm1pbihoYW5kID8gaGFuZC50b3AgOiBILCBpbmZvID8gaW5mby50b3AgOiBIKSArIDYpIC8gSCk7XG4gICAgY29uc3QgYmFuZCA9IE1hdGgubWF4KDAuMywgMSAtIFRPUCAtIEJPVFRPTSksIGNlbnRlckZyYWMgPSBUT1AgKyBiYW5kIC8gMjsgICAgICAgICAgLy8gdGhlIGdyaWQncyBjZW50cmUgYXBwZWFycyBhdCB0aGlzIGZyYWN0aW9uIGZyb20gdGhlIHRvcFxuICAgIGNvbnN0IGd3ID0gR1JJRF9DT0xTICogR1JJRF9TUCArIDMuMiwgZ2ggPSBHUklEX1JPV1MgKiBHUklEX1NQICsgMC41OyAgICAgICAgICAgICAgICAvLyB0aGUgd2lkdGggYWxzbyBsZWF2ZXMgcm9vbSBmb3IgdGhlIE5lY3JvbWFuY2VyIGJlc2lkZSB0aGUgZ3JpZFxuICAgIGNvbnN0IGQyID0gTWF0aC5tYXgoZ2ggLyAoMiAqIHRhblYgKiBiYW5kKSwgZ3cgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjg4KSwgNC41KTtcbiAgICBjb25zdCBzaGlmdCA9ICgwLjUgLSBjZW50ZXJGcmFjKSAqIDIgKiBkMiAqIHRhblYsIGJ4ID0gY3ggLSAwLjY7XG4gICAgY29uc3QgYnVpbGQgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMyhieCwgZDIsIC1zaGlmdCAtIDAuMSAqIGQyKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCAwLCAtc2hpZnQpIH07XG4gICAgY29uc3QgbmVjcm8gPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMyhiYXR0bGUucG9zLnggLSAxLjQsIGJhdHRsZS5wb3MueSAqIDEuMTIsIGJhdHRsZS5wb3MueiAqIDEuMTIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEuNCwgMC4zNSwgMCkgfTsgICAvLyByZXN1bHQgY3V0c2NlbmVzOiBoaW0gYW5kIHRoZSBmaWVsZFxuICAgIHJldHVybiB7IGJhdHRsZSwgYnVpbGQsIG5lY3JvIH07XG4gIH1cbiAgcHJpdmF0ZSBjYW52YXMhOiBIVE1MQ2FudmFzRWxlbWVudDsgcHJpdmF0ZSBsYXN0VyA9IDA7IHByaXZhdGUgbGFzdEggPSAwOyBsYXN0VGFwSW5mbyA9ICcobm8gdGFwcyB5ZXQpJztcbiAgcHJpdmF0ZSBoYW5kbGVSZXNpemUoKSB7XG4gICAgaWYgKCF0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCB8fCAhdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KSByZXR1cm47ICAgLy8gaGlkZGVuIGJlaGluZCBhbm90aGVyIHRhYlxuICAgIHRoaXMuZW5naW5lLnJlc2l6ZSgpOyB0aGlzLmxhc3RXID0gdGhpcy5jYW52YXMuY2xpZW50V2lkdGg7IHRoaXMubGFzdEggPSB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcgJiYgdGhpcy5jYW1UID49IDEpIHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7XG4gIH1cbiAgLyoqIEEgdGFwIG9uIHRoZSAzRCB2aWV3OiBwaWNrIGEgdGlsZSBvciBhIHVuaXQuICovXG4gIHByaXZhdGUgdGFwKHg6IG51bWJlciwgeTogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IHRoaXMuc2NlbmUucGljayh4LCB5LCAobTogYW55KSA9PiAhIShtLm1ldGFkYXRhICYmIG0ubWV0YWRhdGEua2luZCkpO1xuICAgIGNvbnN0IG1kID0gcCAmJiBwLmhpdCA/IHAucGlja2VkTWVzaC5tZXRhZGF0YSA6IG51bGw7XG4gICAgdGhpcy5sYXN0VGFwSW5mbyA9IGB0YXAgJHtNYXRoLnJvdW5kKHgpfSwke01hdGgucm91bmQoeSl9IG9mICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSAtPiAke21kID8gKG1kLmtpbmQgPT09ICd0aWxlJyA/ICd0aWxlICcgKyBtZC5jZWxsIDogJ3VuaXQnKSA6ICdub3RoaW5nJ30gKHBoYXNlICR7dGhpcy5waGFzZX0pYDtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhbWQpIHJldHVybjtcbiAgICBpZiAobWQua2luZCA9PT0gJ3RpbGUnKSB0aGlzLm9uVGlsZShtZC5jZWxsKTsgZWxzZSBpZiAobWQua2luZCA9PT0gJ3VuaXQnKSB0aGlzLm9uVW5pdFZpc3VhbChtZC52aXN1YWwpO1xuICB9XG4gIHByaXZhdGUgc2V0Q2FtKHA6IGFueSkgeyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5jb3B5RnJvbShwLnBvcyk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChwLnRndC5jbG9uZSgpKTsgfVxuICBwcml2YXRlIHR3ZWVuQ2FtKHRvOiBhbnksIGR1cjogbnVtYmVyKSB7IHRoaXMuY2FtRnJvbSA9IHsgcG9zOiB0aGlzLmNhbWVyYS5wb3NpdGlvbi5jbG9uZSgpLCB0Z3Q6IHRoaXMuY2FtZXJhLmdldFRhcmdldCgpLmNsb25lKCkgfTsgdGhpcy5jYW1UbyA9IHRvOyB0aGlzLmNhbVQgPSAwOyB0aGlzLmNhbUR1ciA9IGR1cjsgfVxuXG4gIC8vIC0tLS0gYmF0dGxlIGNhbWVyYTogZm9sbG93cyB0aGUgZmlnaHRlcnMgdGhhdCBhcmUgc3RpbGwgYWxpdmUsIHNvIHRoZSBhY3Rpb24gKGFuZCB0aGUgcHVycGxlIGV5ZXMpIHN0YXlzIGxhcmdlIG9uIHNjcmVlblxuICBjYW1Nb2RlOiAnY2xvc2UnIHwgJ3dpZGUnID0gJ2Nsb3NlJzsgcHJpdmF0ZSBjYW1UZ3Q6IGFueSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAwKTtcbiAgc2V0Q2FtTW9kZShtOiAnY2xvc2UnIHwgJ3dpZGUnKSB7XG4gICAgdGhpcy5jYW1Nb2RlID0gbTtcbiAgICBpZiAobSA9PT0gJ3dpZGUnICYmIHRoaXMuYmF0dGxlKSB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDAuOSk7XG4gICAgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBwcml2YXRlIGZyYW1lQmF0dGxlKGR0OiBudW1iZXIpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7IGlmICghYikgcmV0dXJuOyBjb25zdCBhbGl2ZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKCFhbGl2ZS5sZW5ndGgpIHJldHVybjtcbiAgICBsZXQgeDAgPSAxZTksIHgxID0gLTFlOSwgejAgPSAxZTksIHoxID0gLTFlOTsgZm9yIChjb25zdCBmIG9mIGFsaXZlKSB7IHgwID0gTWF0aC5taW4oeDAsIGYueCk7IHgxID0gTWF0aC5tYXgoeDEsIGYueCk7IHowID0gTWF0aC5taW4oejAsIGYueik7IHoxID0gTWF0aC5tYXgoejEsIGYueik7IH1cbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCB3aWRlID0gdGhpcy5wb3NlcygpLmJhdHRsZSwgY3ggPSAoeDAgKyB4MSkgLyAyLCBjeiA9ICh6MCArIHoxKSAvIDI7XG4gICAgY29uc3QgZCA9IE1hdGgubWluKE1hdGgubWF4KCh4MSAtIHgwICsgMy40KSAvICgyICogdGFuViAqIGFzcCAqIDAuOSksICh6MSAtIHowICsgMy4yKSAvICgyICogdGFuViAqIDAuNjIpLCA1LjQpLCBNYXRoLmh5cG90KHdpZGUucG9zLnksIHdpZGUucG9zLnopKTtcbiAgICBjb25zdCB0Z3QgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4LCAwLjU1LCBjeiksIHBvcyA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3ggLSAwLjA2ICogZCwgMC4zMiAqIGQgKyAwLjUsIGN6IC0gMC45ICogZCk7XG4gICAgY29uc3QgayA9IDEgLSBNYXRoLmV4cCgtZHQgKiAyLjApO1xuICAgIHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1lcmEucG9zaXRpb24sIHBvcywgayk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1UZ3QsIHRndCwgayk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YWdlIGZsb3dcbiAgLyoqIEEgcnVuIHRoZSBwbGF5ZXIgaGFzIHJlYWxseSBzdGFydGVkIChzbyBIb21lIGNhbiBvZmZlciBDb250aW51ZSkuIE51bGwgYWZ0ZXIgYSBzdGFnZSB3YXMgd29uIG9yIGxvc3QsIG9yIGJlZm9yZSBhbnl0aGluZyB3YXMgZG9uZS4gKi9cbiAgcnVuSW5mbygpIHsgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzIHx8IHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gbnVsbDsgcmV0dXJuIChzLndhdmUgPiAxIHx8IHMudW5pdHMubGVuZ3RoID4gMCB8fCB0aGlzLmF0dGVtcHQgPiAwIHx8IHMuc3RhdHMuZmFpbHVyZXMgPiAwKSA/IHsgd2F2ZTogcy53YXZlLCB0b3RhbDogc3RhZ2VXYXZlcyhzKSwgaGVhcnRzOiBzLmhlYXJ0cywgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUgfSA6IG51bGw7IH1cbiAgLyoqIEZyZXNoIHJ1biB3aXRoIHRoZSBjdXJyZW50bHkgZXF1aXBwZWQgU291bCBEZWNrIChIb21lID4gU3RhcnQgQmF0dGxlIGNhbGxzIHRoaXMpLiAqL1xuICBuZXdSdW4oKSB7IHRoaXMuc3RhcnRTdGFnZShuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdzZWVkJykgPyB0aGlzLnNlZWQgOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IH1cbiAgc3RhcnRTdGFnZShzZWVkOiBudW1iZXIpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5mbHVzaFR3ZWVucygpOyBpZiAodGhpcy5uZWNybykgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICB0aGlzLnNlZWQgPSBzZWVkOyB0aGlzLmF0dGVtcHQgPSAwOyBjb25zdCBzdiA9IGxvYWRTYXZlKCk7IHNldERpZmZpY3VsdHkoc3YuZGlmZmljdWx0eSk7IHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uUFJPVE9UWVBFX1JVTEVTLCBwb29sOiBzdi5kZWNrIH0sIHNlZWQpOyB0aGlzLnNlZW5NZXJnZXMgPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IG51bGw7IHRoaXMucGhhc2UgPSAnYnVpbGQnOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudG9hc3QoJ1N0YWdlIHN0YXJ0OiA0IGNhcmRzLCAnICsgdGhpcy5zLmNhcCArICcgRG9taW5pb24uIFN1bW1vbiwgbWVyZ2UsIHRoZW4gcHJlc3MgQkFUVExFLicpO1xuICB9XG4gIHByaXZhdGUgY2xlYXJCYXR0bGUoKSB7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LmRpc3Bvc2UoKTsgfSk7IHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7IHRoaXMuYmF0dGxlID0gbnVsbDtcbiAgICB0aGlzLmFycm93cy5mb3JFYWNoKChhKSA9PiBhLm1lc2guZGlzcG9zZSgpKTsgdGhpcy5hcnJvd3MgPSBbXTtcbiAgfVxuICBwcml2YXRlIHBvcyhjZWxsOiBudW1iZXIpIHsgcmV0dXJuIGNlbGxQb3MoMCwgY2VsbCk7IH1cbiAgc3luY0J1aWxkKCkge1xuICAgIGNvbnN0IG1lcmdlZCA9IHRoaXMucy5zdGF0cy5tZXJnZXMgPiB0aGlzLnNlZW5NZXJnZXM7IHRoaXMuc2Vlbk1lcmdlcyA9IHRoaXMucy5zdGF0cy5tZXJnZXM7XG4gICAgY29uc3QgZ3Jvd24gPSBtZXJnZWQgPyB0aGlzLnMudW5pdHMuZmluZCgodSkgPT4geyBjb25zdCBndiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IHJldHVybiAhIWd2ICYmIGd2LnN0YXIgIT09IHUuc3RhcjsgfSkgOiB1bmRlZmluZWQ7ICAgLy8gdGhlIHVuaXQgdGhhdCBqdXN0IGdhaW5lZCBhIHN0YXJcbiAgICBjb25zdCBhbGl2ZSA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gdS5pZCkpO1xuICAgIGZvciAoY29uc3QgW2lkLCB2XSBvZiB0aGlzLnVuaXRWaXMpIGlmICghYWxpdmUuaGFzKGlkKSkge1xuICAgICAgdGhpcy52aXNUb1VuaXQuZGVsZXRlKHYpOyB0aGlzLnVuaXRWaXMuZGVsZXRlKGlkKTsgY29uc3QgcCA9IHYuaG9sZGVyLnBvc2l0aW9uO1xuICAgICAgaWYgKGdyb3duKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbWVyZ2U6IHRoZSBjb25zdW1lZCB1bml0IGlzIGRyYXduIGludG8gdGhlIHN1cnZpdm9yIGFuZCB2YW5pc2hlcyBpbiBhIGZsYXNoXG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3MoZ3Jvd24uY2VsbCksIHgwID0gcC54LCB6MCA9IHAueiwgc2MgPSB2LmhvbGRlci5zY2FsaW5nLng7IHYucGxheSgnaWRsZScpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuMzMsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC40LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHNjICogKDEgLSAwLjc1ICogdCkpOyB9LFxuICAgICAgICAgICgpID0+IHsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDE0KTsgdi5kaXNwb3NlKCk7IH0pO1xuICAgICAgfSBlbHNlIHsgdGhpcy5idXJzdChwLngsIHAueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxNik7IHYuZGlzcG9zZSgpOyB9XG4gICAgfVxuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHtcbiAgICAgIGxldCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7XG4gICAgICBpZiAoIXYpIHsgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHUuc291bCwgMCwgdS5zdGFyKTsgdGhpcy51bml0VmlzLnNldCh1LmlkLCB2KTsgdGhpcy52aXNUb1VuaXQuc2V0KHYsIHUuaWQpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7IGF1ZGlvLnBsYXkoJ3N1bW1vbicpOyBjb25zdCB2diA9IHY7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB2di5wbGF5KCdpZGxlJyk7IH0pOyB9XG4gICAgICBlbHNlIHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyBpZiAodi5zdGFyICE9PSB1LnN0YXIpIHsgY29uc3QgZnYgPSB2OyB2LnNldFN0YXIodS5zdGFyKTsgdGhpcy5sYXRlcihncm93biAmJiBncm93bi5pZCA9PT0gdS5pZCA/IDAuMzMgOiAwLCAoKSA9PiB0aGlzLm1lcmdlRngoZnYsIHAueCwgcC56KSk7IH0gfVxuICAgIH1cbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDtcbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5waGFzZSA9PT0gJ2J1aWxkJykge1xuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgY2FuU3VtbW9uKHRoaXMucywgc2VsLmlkeCkgPyAnZnJlZScgOiAnbm9ybWFsJyk7XG4gICAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VGcm9tSGFuZCh0aGlzLnMsIHNlbC5pZHgsIHUuaWQpKSB0aGlzLnRpbnQodS5jZWxsLCAncGFydG5lcicpOyAgICAgLy8gdGhlIGNhcmQgY2FuIG1lcmdlIGludG8gdGhpcyB1bml0XG4gICAgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0Jykge1xuICAgICAgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpO1xuICAgICAgaWYgKHUpIHsgdGhpcy50aW50KHUuY2VsbCwgJ3NlbCcpOyBmb3IgKGNvbnN0IG8gb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VEZXBsb3llZCh1LCBvKSkgdGhpcy50aW50KG8uY2VsbCwgJ3BhcnRuZXInKTsgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgJ2ZyZWUnKTsgfVxuICAgIH1cbiAgfVxuICAvKiogVGhlIG1lcmdlIG1vbWVudDogYSBmbGFzaCBvZiByaW5ncyBhbmQgc3BhcmtzLCBhIHB1bmNoIGluIHNpemUsIGEgcmlzaW5nIGNoaW1lLiAqL1xuICBwcml2YXRlIG1lcmdlRngodjogVW5pdFZpc3VhbCwgeDogbnVtYmVyLCB6OiBudW1iZXIpIHtcbiAgICBhdWRpby5wbGF5KCdtZXJnZScpOyB2LnB1bHNlKCk7IGNvbnN0IHRhcmdldCA9IHYuaG9sZGVyLnNjYWxpbmcueDtcbiAgICB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC40KSwgMC4yLCAyLjAsIDAuNjUpOyB0aGlzLmxhdGVyKDAuMTIsICgpID0+IHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC4yLCAzLjAsIDAuOCkpO1xuICAgIHRoaXMuYnVyc3QoeCwgeiwgWzEsIDAuODUsIDAuNCwgMC45XSwgWzAuOCwgMC40LCAxLCAwLjhdLCA0Nik7IHRoaXMuYnVyc3QoeCwgeiwgWzAuODUsIDAuNiwgMSwgMC45XSwgWzAuNSwgMC4zLCAxLCAwLjddLCAyNCk7XG4gICAgdGhpcy50d2VlbigwLjU1LCAodCkgPT4gdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGFyZ2V0ICogKDEgKyAwLjQ1ICogTWF0aC5zaW4odCAqIE1hdGguUEkpICogKDEgLSB0ICogMC40KSkpLCAoKSA9PiB2LmhvbGRlci5zY2FsaW5nLnNldEFsbCh0YXJnZXQpKTtcbiAgfVxuICBwcml2YXRlIHN1bW1vbkZ4KHg6IG51bWJlciwgejogbnVtYmVyKSB7IHRoaXMuYnVyc3QoeCwgeiwgWzAuNywgMC4zLCAxLCAwLjldLCBbMC4zNSwgMC4xLCAwLjcsIDAuOF0sIDMwKTsgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zLCAxKSwgMC4yLCAxLjIsIDAuNyk7IH1cblxuICAvLyAtLS0tIHBsYXllciBhY3Rpb25zIChidWlsZCBwaGFzZSlcbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgdGhpcy51aS50b2FzdChtc2cpOyB9XG4gIG9uQ2FyZChpZHg6IG51bWJlcikge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKGRpc2NhcmRSZWRyYXcodGhpcy5zLCBpZHgpKSB7IHRoaXMudG9hc3QoJ1N3YXBwZWQ6IGRyZXcgYSBkaWZmZXJlbnQgU291bC4nKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5zZWwuaWR4ID09PSBpZHggPyBudWxsIDogeyB0eXBlOiAnY2FyZCcsIGlkeCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVGlsZShjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBoZXJlID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpOyBpZiAoaGVyZSkgeyB0aGlzLm9uVW5pdFZpc3VhbCh0aGlzLnVuaXRWaXMuZ2V0KGhlcmUuaWQpISk7IHJldHVybjsgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJykge1xuICAgICAgaWYgKGNhblN1bW1vbihzLCBzZWwuaWR4KSkgeyBzdW1tb24ocywgc2VsLmlkeCwgY2VsbCk7IHRoaXMuc2VsID0gbnVsbDsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHNvdWwgPSBzLmhhbmRbc2VsLmlkeF07IHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb246ICR7U09VTF9OQU1FW3NvdWxdfSBjb3N0cyAke2Nvc3Qoc291bCwgMSl9LCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTsgfVxuICAgIH0gZWxzZSBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHsgaWYgKG1vdmVVbml0KHMsIHNlbC5pZCwgY2VsbCkpIHRoaXMuc2VsID0gbnVsbDsgfVxuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVW5pdFZpc3VhbCh2OiBVbml0VmlzdWFsKSB7XG4gICAgY29uc3QgaWQgPSB0aGlzLnZpc1RvVW5pdC5nZXQodik7IGlmIChpZCA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCkhO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChzd2FwU2VsbChzLCBpZCkpIHsgdGhpcy50b2FzdChgU29sZCAke1NPVUxfTkFNRVt1LnNvdWxdfTogZHJldyBhIGRpZmZlcmVudCBTb3VsLmApOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KHUuZnJlc2ggPyBcIllvdSBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZC5cIiA6ICdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHMuaGFuZFt0aGlzLnNlbC5pZHhdID09PSB1LnNvdWwgJiYgdS5zdGFyID09PSAxICYmIHMucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInKSB7XG4gICAgICBpZiAobWVyZ2VGcm9tSGFuZChzLCB0aGlzLnNlbC5pZHgsIGlkKSkgeyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgdGhlIGNhcmQgaW50byBhIDItc3RhciAke1NPVUxfTkFNRVt1LnNvdWxdfSFgKTsgfVxuICAgICAgZWxzZSB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uIHRvIG1lcmdlOiBpdCBuZWVkcyAke2Nvc3QodS5zb3VsLCAyKSAtIGNvc3QodS5zb3VsLCAxKX0gbW9yZSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCAhPT0gaWQpIHtcbiAgICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09ICh0aGlzLnNlbCBhcyBhbnkpLmlkKSE7XG4gICAgICBpZiAoY2FuTWVyZ2VEZXBsb3llZChhLCB1KSkgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIHUuaWQpOyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZDogYS5pZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB9IGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgPT09IGlkID8gbnVsbCA6IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG1lcmdlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpOyBjb25zdCBiID0gYSAmJiBzLnVuaXRzLmZpbmQoKG8pID0+IGNhbk1lcmdlRGVwbG95ZWQoYSwgbykpO1xuICAgIGlmIChhICYmIGIpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCBiLmlkKTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMudG9hc3QoJ05vIG1hdGNoaW5nIHVuaXQgKHNhbWUgU291bCBhbmQgc3RhcnMpIHRvIG1lcmdlIHdpdGguJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICByZW1vdmVTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGlmICghdGhpcy5jb25maXJtUmVtb3ZlKSB7IHRoaXMuY29uZmlybVJlbW92ZSA9IHRydWU7IHRoaXMudG9hc3QoJ1RhcCBSZW1vdmUgYWdhaW4gdG8gY29uZmlybS4gVGhlIGNhcmQgaXMgZ29uZSBmb3IgdGhpcyBzdGFnZS4nKTsgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuOyB9XG4gICAgZGlzbWlzcyh0aGlzLnMsIHNlbC5pZCk7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgdG9nZ2xlU3dhcCgpIHsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjsgaWYgKHRoaXMucy5kaXNjYXJkVXNlZCkgeyB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyByZXR1cm47IH0gdGhpcy5zd2FwTW9kZSA9ICF0aGlzLnN3YXBNb2RlOyB0aGlzLnNlbCA9IG51bGw7IGlmICh0aGlzLnN3YXBNb2RlKSB0aGlzLnRvYXN0KCdTd2FwOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCwgb3IgYSB1bml0IChub3Qgc3VtbW9uZWQgdGhpcyByb3VuZCkgdG8gc2VsbC4nKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGJhdHRsZVxuICBzdGFydEJhdHRsZSgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhdGhpcy5zLnVuaXRzLmxlbmd0aCkgeyBpZiAoIXRoaXMucy51bml0cy5sZW5ndGgpIHRoaXMudG9hc3QoJ1N1bW1vbiBhdCBsZWFzdCBvbmUgdW5pdCBmaXJzdC4nKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5mbHVzaFR3ZWVucygpOyBhdWRpby5wbGF5KCdzdGFydCcpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmF0dGVtcHQrKzsgdGhpcy5oYW5kbGVkID0gZmFsc2U7IHRoaXMucmVzdWx0QXQgPSAtMTtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1bml0cyA9IHMudW5pdHMuc2xpY2UoKTtcbiAgICB0aGlzLmJhdHRsZSA9IG5ldyBCYXR0bGUodW5pdHMubWFwKCh1KSA9PiAoeyBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsIH0pKSwgZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKSwgdGhpcy5zZWVkICogMTMxICsgcy53YXZlICogMTcgKyB0aGlzLmF0dGVtcHQpO1xuICAgIHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7XG4gICAgdGhpcy5iYXR0bGUuZmlnaHRlcnMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgaWYgKGYudGVhbSA9PT0gMCkgeyBjb25zdCB1ID0gdW5pdHNbZi5pZCAtIDFdOyBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMuZlVuaXQuc2V0KGYuaWQsIHUuaWQpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB9XG4gICAgICBlbHNlIHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIGYuc291bCwgMSwgZi5zdGFyKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KGYueCwgMCwgZi56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IC1NYXRoLlBJIC8gMjsgdi5wbGF5KCdzcGF3bicpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmxhdGVyKDEuMSwgKCkgPT4geyBpZiAodi5zdGF0ZSA9PT0gJ3NwYXduJykgdi5wbGF5KCdpZGxlJyk7IH0pOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC43LCAwLjYsIDAuNSwgMC43XSwgWzAuNCwgMC4zNSwgMC4zLCAwLjZdLCAxNCk7IH1cbiAgICB9KTtcbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICB0aGlzLnBoYXNlID0gJ3RyYW5zaXRpb24nOyB0aGlzLnN0YXJ0U3RlcEF0ID0gMS4wOyB0aGlzLmFjYyA9IDA7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMi4yKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBwcml2YXRlIGFwcGx5RXZlbnRzKGV2czogQkV2ZW50W10pIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhO1xuICAgIGZvciAoY29uc3QgZSBvZiBldnMpIHtcbiAgICAgIGlmIChlLnQgPT09ICdzd2luZycpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB2LnBsYXkoJ2F0dGFjaycsIGUuc3BlZWQpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdoaXQnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUudG8pOyBpZiAodikgdi5wdWxzZSgpOyBpZiAoZS5raW5kID09PSAnYXJyb3cnKSBhdWRpby5wbGF5KCdoaXRBcnJvdycpOyBlbHNlIGlmIChlLmtpbmQgPT09ICdtZWxlZScpIGF1ZGlvLnBsYXkoJ2hpdCcpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdhcnJvdycpIHsgY29uc3QgZiA9IGIuYnlJZChlLmZyb20pISwgdG8gPSBiLmJ5SWQoZS50bykhOyB0aGlzLnNwYXduQXJyb3coZi50ZWFtLCBmLngsIGYueiwgdG8ueCwgdG8ueiwgZS5kdXIpOyBhdWRpby5wbGF5KCdhcnJvdycpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdkZWF0aCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB7IHYucGxheSgnZGVhdGgnKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnZGVhdGgnKTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxMik7IGlmIChmLnRlYW0gPT09IDEpIHRoaXMubGF0ZXIoNSwgKCkgPT4geyBpZiAodGhpcy5mdmlzLmdldChlLmlkKSA9PT0gdiAmJiB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSB7IHYuaG9sZGVyLnNldEVuYWJsZWQoZmFsc2UpOyB9IH0pOyB9IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Nhc3QnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCdjYXN0Jyk7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC41LCAwLjgsIDEpLCAwLjE1LCAxLjEsIDAuMzUpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICd0YXVudCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ3RhdW50Jyk7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC4zKSwgMC4zLCBCQUxBTkNFLnRhdW50LnJhZGl1cywgMC42KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnc21hc2gnKSB7IGF1ZGlvLnBsYXkoJ3NtYXNoJyk7IHRoaXMuZnhSaW5nKGUueCwgZS56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC41LCAwLjIpLCAwLjIsIGUuciAqIDEuNiwgMC40NSk7IH1cbiAgICB9XG4gIH1cbiAgcHJpdmF0ZSBzcGF3bkFycm93KHRlYW06IG51bWJlciwgeDA6IG51bWJlciwgejA6IG51bWJlciwgeDE6IG51bWJlciwgejE6IG51bWJlciwgZHVyOiBudW1iZXIpIHtcbiAgICBsZXQgbWVzaCA9IHRoaXMuYXJyb3dNZXNoLnBvcCgpO1xuICAgIGlmICghbWVzaCkgeyBtZXNoID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignYXJyb3cnLCB7IGhlaWdodDogMC41NSwgZGlhbWV0ZXI6IDAuMDM1IH0sIHRoaXMuc2NlbmUpOyBtZXNoLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgbWVzaC5pc1BpY2thYmxlID0gZmFsc2U7IGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2FyJywgdGhpcy5zY2VuZSk7IG1lc2gucGFyZW50ID0gaG9sZGVyOyBtZXNoID0gaG9sZGVyOyB9XG4gICAgbWVzaC5zZXRFbmFibGVkKHRydWUpOyBtZXNoLmdldENoaWxkTWVzaGVzKClbMF0ubWF0ZXJpYWwgPSB0aGlzLmFycm93TWF0c1t0ZWFtXTtcbiAgICB0aGlzLmFycm93cy5wdXNoKHsgbWVzaCwgeDAsIHowLCB4MSwgejEsIHQ6IDAsIGR1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZnJhbWUoZHQ6IG51bWJlcikge1xuICAgIGlmICh0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCAhPT0gdGhpcy5sYXN0VyB8fCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQgIT09IHRoaXMubGFzdEgpIHRoaXMuaGFuZGxlUmVzaXplKCk7ICAgLy8gZS5nLiB0aGUgaG9tZS1zY3JlZW4gYXBwIHJlc2l6aW5nIGFmdGVyIGxhdW5jaFxuICAgIGZvciAobGV0IGkgPSB0aGlzLnRpbWVycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyB0aGlzLnRpbWVyc1tpXS50IC09IGR0OyBpZiAodGhpcy50aW1lcnNbaV0udCA8PSAwKSB7IGNvbnN0IGYgPSB0aGlzLnRpbWVyc1tpXS5mbjsgdGhpcy50aW1lcnMuc3BsaWNlKGksIDEpOyBmKCk7IH0gfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLnJpbmdGeC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCByID0gdGhpcy5yaW5nRnhbaV07IHIudCArPSBkdDsgY29uc3QgdSA9IHIudCAvIHIuZHVyLCBzID0gci5yMCArIChyLnIxIC0gci5yMCkgKiB1OyByLm0uc2NhbGluZy5zZXQocywgcywgcyk7IHIubW0uYWxwaGEgPSAwLjkgKiAoMSAtIHUpOyBpZiAodSA+PSAxKSB7IHIubS5kaXNwb3NlKCk7IHIubW0uZGlzcG9zZSgpOyB0aGlzLnJpbmdGeC5zcGxpY2UoaSwgMSk7IH0gfVxuICAgIGlmICh0aGlzLmNhbVQgPCAxKSB7IHRoaXMuY2FtVCA9IE1hdGgubWluKDEsIHRoaXMuY2FtVCArIGR0IC8gdGhpcy5jYW1EdXIpOyBjb25zdCBlID0gdGhpcy5jYW1UICogdGhpcy5jYW1UICogKDMgLSAyICogdGhpcy5jYW1UKTsgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20ucG9zLCB0aGlzLmNhbVRvLnBvcywgZSk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnRndCwgdGhpcy5jYW1Uby50Z3QsIGUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyAmJiB0aGlzLmNhbU1vZGUgPT09ICdjbG9zZScgJiYgIXRoaXMuY2luZSkgdGhpcy5mcmFtZUJhdHRsZShkdCk7XG4gICAgdGhpcy5uZWNyby51cGRhdGUoZHQpO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnR3ZWVucy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCB3ID0gdGhpcy50d2VlbnNbaV07IHcudCArPSBkdDsgY29uc3QgdSA9IE1hdGgubWluKDEsIHcudCAvIHcuZHVyKTsgdy5mbih1KTsgaWYgKHUgPj0gMSkgeyB0aGlzLnR3ZWVucy5zcGxpY2UoaSwgMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgICBmb3IgKGNvbnN0IHYgb2YgdGhpcy51bml0VmlzLnZhbHVlcygpKSB2LnVwZGF0ZShkdCk7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LnVwZGF0ZShkdCk7IH0pO1xuXG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlO1xuICAgIGlmICgodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nIHx8IHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSAmJiBiKSB7XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nKSB7IHRoaXMuc3RhcnRTdGVwQXQgLT0gZHQ7IGlmICh0aGlzLnN0YXJ0U3RlcEF0IDw9IDApIHsgdGhpcy5waGFzZSA9ICdiYXR0bGUnOyB0aGlzLnVpLnJlbmRlcigpOyB9IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJykge1xuICAgICAgICB0aGlzLmFjYyArPSBkdCAqIHRoaXMudGltZVNjYWxlO1xuICAgICAgICB3aGlsZSAodGhpcy5hY2MgPj0gMSAvIDMwICYmIGIud2lubmVyIDwgMCkgeyBiLnN0ZXAoMSAvIDMwKTsgdGhpcy5hY2MgLT0gMSAvIDMwOyB0aGlzLmFwcGx5RXZlbnRzKGIuZHJhaW4oKSk7IH1cbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoIXRoaXMuY2luZSAmJiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgfHwgZi50ZWFtID09PSAxKSkgeyB2LmhvbGRlci5wb3NpdGlvbi54ID0gZi54OyB2LmhvbGRlci5wb3NpdGlvbi56ID0gZi56OyBpZiAoZi5hbGl2ZSB8fCB0cnVlKSB2LmhvbGRlci5yb3RhdGlvbi55ID0gZi55YXc7IH1cbiAgICAgICAgaWYgKGYuYWxpdmUpIHsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCk7IGlmIChmLm1heE1hbmEpIHYuc2V0TWFuYShmLm1hbmEgLyBmLm1heE1hbmEpOyB9XG4gICAgICAgIGVsc2Ugdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoZi5zdGF0ZSAhPT0gJ2F0dGFjaycgJiYgZi5hbGl2ZSkgeyBjb25zdCB3YW50ID0gZi5zdGF0ZSA9PT0gJ3J1bicgPyAncnVuJyA6ICdpZGxlJzsgaWYgKHRoaXMubGFzdFN0YXRlLmdldChmLmlkKSAhPT0gd2FudCB8fCAodi5zdGF0ZSAhPT0gd2FudCAmJiB2LnN0YXRlICE9PSAnc3Bhd24nKSkgeyBpZiAodi5zdGF0ZSAhPT0gJ3NwYXduJykgeyB2LnBsYXkod2FudCBhcyBhbnkpOyB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgd2FudCk7IH0gfSB9XG4gICAgICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsICdhdHRhY2snKTtcbiAgICAgIH1cbiAgICAgIGlmIChiLndpbm5lciA+PSAwICYmICF0aGlzLmhhbmRsZWQpIHsgdGhpcy5oYW5kbGVkID0gdHJ1ZTsgdGhpcy5yZXN1bHRBdCA9IDEuNDsgfVxuICAgICAgaWYgKHRoaXMucmVzdWx0QXQgPiAwKSB7IHRoaXMucmVzdWx0QXQgLT0gZHQ7IGlmICh0aGlzLnJlc3VsdEF0IDw9IDApIHRoaXMuaGFuZGxlUmVzdWx0KCk7IH1cbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuYXJyb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBhID0gdGhpcy5hcnJvd3NbaV07IGEudCArPSBkdCAqIHRoaXMudGltZVNjYWxlOyBjb25zdCB1ID0gTWF0aC5taW4oMSwgYS50IC8gYS5kdXIpO1xuICAgICAgY29uc3QgcHggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUsIHB6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1LCBweSA9IDAuNzUgKyBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjkgLSB1ICogMC4yNTtcbiAgICAgIGNvbnN0IHUyID0gTWF0aC5taW4oMSwgdSArIDAuMDMpLCBxeCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdTIsIHF6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1MiwgcXkgPSAwLjc1ICsgTWF0aC5zaW4odTIgKiBNYXRoLlBJKSAqIDAuOSAtIHUyICogMC4yNTtcbiAgICAgIGEubWVzaC5wb3NpdGlvbi5zZXQocHgsIHB5LCBweik7IGEubWVzaC5sb29rQXQobmV3IEJBQllMT04uVmVjdG9yMyhxeCwgcXksIHF6KSk7XG4gICAgICBpZiAodSA+PSAxKSB7IGEubWVzaC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5hcnJvd01lc2gucHVzaChhLm1lc2gpOyB0aGlzLmFycm93cy5zcGxpY2UoaSwgMSk7IH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVJlc3VsdCgpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBzID0gdGhpcy5zO1xuICAgIHRoaXMubGFzdEJhdHRsZSA9IGB3YXZlICR7cy53YXZlfSBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fTogJHtiLndpbm5lciA9PT0gMCA/ICdXT04nIDogJ0xPU1QnfSBpbiAke2IudGltZS50b0ZpeGVkKDEpfXMsICR7Yi5jb3VudCgwKX0gb2YgeW91cnMgYW5kICR7Yi5jb3VudCgxKX0gZW5lbWllcyBsZWZ0YDtcbiAgICBpZiAoYi53aW5uZXIgPT09IDApIHtcbiAgICAgIHRoaXMucGxheVJlc3VsdCgnd2luJywgKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBhcm15IGlzIHJhaXNlZCBhZ2FpbiwgdGhlbiB0aGUgbmV4dCB3YXZlIC8gdGhlIGRyYWZ0XG4gICAgICAgIHRoaXMuY2luZSA9IGZhbHNlO1xuICAgICAgICBpZiAoYWR2YW5jZVdhdmUocykpIHsgdGhpcy5waGFzZSA9ICd3b24nOyB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47IH1cbiAgICAgICAgdGhpcy5kcmFmdCA9IGRyYWZ0T3B0aW9ucyhzKTsgdGhpcy5waGFzZSA9ICdkcmFmdCc7IHRoaXMudWkucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmFpbFdhdmUocyk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudWkucHVsc2VIZWFydHMoKTsgICAgICAgICAgICAgICAgICAgLy8gdGhlIGhlYXJ0IGlzIGxvc3QgdGhlIG1vbWVudCBoZSBpcyBoaXRcbiAgICAgIGlmIChzLnN0YXR1cyA9PT0gJ2xvc3QnKSB0aGlzLnBsYXlSZXN1bHQoJ2ZpbmFsJywgKCkgPT4geyB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5waGFzZSA9ICdsb3N0JzsgdGhpcy51aS5yZW5kZXIoKTsgfSk7XG4gICAgICBlbHNlIHRoaXMucGxheVJlc3VsdCgnbG9zcycsICgpID0+IHsgdGhpcy50b2FzdCgnWW91ciBhcm15IGZlbGwuIC0xIGhlYXJ0LCArMSBjYXJkLCBzYW1lIHdhdmUuIFJlYnVpbGQgYSBkaWZmZXJlbnQgc3RyYXRlZ3kuJyk7IHRoaXMudG9CdWlsZCgpOyB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIHJlc3VsdCBjdXRzY2VuZXMgKHBsYW4gc2VjdGlvbnMgMTktMjIpOiB0aGUgTmVjcm9tYW5jZXIgdGFrZXMgdGhlIGhpdCwgdW5sZWFzaGVzIHRoZSByZXB1bHNpb24gc2hvY2t3YXZlLCByYWlzZXMgdGhlIGZhbGxlblxuICBwcml2YXRlIHBsYXlSZXN1bHQoa2luZDogJ3dpbicgfCAnbG9zcycgfCAnZmluYWwnLCBkb25lOiAoKSA9PiB2b2lkKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlISwgbiA9IHRoaXMubmVjcm87IHRoaXMuY2luZSA9IHRydWU7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLm5lY3JvLCAxLjEpO1xuICAgIGNvbnN0IGhvbWUgPSAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXZlcnkgZmFsbGVuIGFsbHkgaXMgcHVsbGVkIGJhY2sgdG8gaXRzIGdyaWQgdGlsZSBhbmQgc3RhbmRzIHVwXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgncmVzdXJyZWN0Jyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy5idXJzdChjLngsIGMueiwgWzAuODUsIDAuNSwgMSwgMC45XSwgWzAuNSwgMC4yLCAxLCAwLjddLCAzMCk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBpZiAoZi50ZWFtICE9PSAwKSBjb250aW51ZTsgY29uc3QgdWlkID0gdGhpcy5mVW5pdC5nZXQoZi5pZCksIHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdWlkKSwgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdSB8fCAhdikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3ModS5jZWxsKSwgeDAgPSB2LmhvbGRlci5wb3NpdGlvbi54LCB6MCA9IHYuaG9sZGVyLnBvc2l0aW9uLno7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTtcbiAgICAgICAgaWYgKCFmLmFsaXZlKSB7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5idXJzdCh4MCwgejAsIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTgpOyB0aGlzLmZ4UmluZyh4MCwgejAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjcsIDAuMzUsIDEpLCAwLjMsIDEuNiwgMC43KTsgfVxuICAgICAgICB0aGlzLnR3ZWVuKDEuMCwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjUsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIucm90YXRpb24ueSArPSAoTWF0aC5QSSAvIDIgLSB2LmhvbGRlci5yb3RhdGlvbi55KSAqIE1hdGgubWluKDEsIHQgKiAwLjUgKyAwLjEpOyB9LFxuICAgICAgICAgICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHRoaXMuYnVyc3QodG8ueCwgdG8ueiwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxMCk7IH0pO1xuICAgICAgfVxuICAgIH07XG4gICAgaWYgKGtpbmQgPT09ICd3aW4nKSB7IG4uY2FzdCgpOyBhdWRpby5wbGF5KCd2aWN0b3J5Jyk7IHRoaXMubGF0ZXIoMC4yNSwgaG9tZSk7IHRoaXMubGF0ZXIoMi4wLCBkb25lKTsgcmV0dXJuOyB9XG4gICAgbi5odXJ0KCk7IGF1ZGlvLnBsYXkoJ2hlYXJ0TG9zdCcpOyB0aGlzLmxhdGVyKDAuMTUsICgpID0+IHsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpOyB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMSwgMC4zLCAwLjMsIDAuOV0sIFswLjgsIDAuMSwgMC4yLCAwLjZdLCAxNik7IH0pO1xuICAgIGlmIChraW5kID09PSAnZmluYWwnKSB7IHRoaXMubGF0ZXIoMC42LCAoKSA9PiB7IG4uZGVmZWF0KCk7IGF1ZGlvLnBsYXkoJ2RlZmVhdCcpOyB9KTsgdGhpcy5sYXRlcigyLjYsIGRvbmUpOyByZXR1cm47IH1cbiAgICB0aGlzLmxhdGVyKDEuMCwgKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlcHVsc2lvbiBzaG9ja3dhdmU6IHN1cnZpdm9ycyBhcmUgZmx1bmcgYmFjayB0byB3aGVyZSB0aGV5IHN0YXJ0ZWQgYW5kIGhlYWwgdG8gZnVsbFxuICAgICAgbi5jYXN0KCk7IGF1ZGlvLnBsYXkoJ3Nob2Nrd2F2ZScpOyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7XG4gICAgICB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjg1LCAwLjU1LCAxKSwgMC42LCAzMCwgMS4xKTsgdGhpcy5meFJpbmcoYy54LCAwLCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMSwgMSksIDAuNCwgMjIsIDAuOCk7XG4gICAgICB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMSwgMC44NSwgMSwgMC45XSwgWzAuNywgMC40LCAxLCAwLjddLCA0MCk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBpZiAoZi50ZWFtICE9PSAxIHx8ICFmLmFsaXZlKSBjb250aW51ZTsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRvID0gY2VsbFBvcygxLCBmLmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5wdWxzZSgpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuOSwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjksIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCArICgxIC0gZi5ocCAvIGYubWF4SHApICogdCk7IH0sICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHYuc2V0SHAoMSk7IH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHRoaXMubGF0ZXIoMi4zLCBob21lKTsgdGhpcy5sYXRlcigzLjcsIGRvbmUpO1xuICB9XG4gIHBpY2tEcmFmdChpZHg6IG51bWJlcikgeyBpZiAoIXRoaXMuZHJhZnQpIHJldHVybjsgdGFrZURyYWZ0KHRoaXMucywgdGhpcy5kcmFmdCwgaWR4KTsgdGhpcy5kcmFmdCA9IG51bGw7IG5vcm1hbERyYXcodGhpcy5zKTsgdGhpcy50b0J1aWxkKCk7IH1cbiAgcHJpdmF0ZSB0b0J1aWxkKCkge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLm5lY3JvLnJldml2ZSgpOyB0aGlzLmZsdXNoVHdlZW5zKCk7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpO1xuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHsgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlc3VycmVjdGlvbjogZXZlcnlvbmUgcmlzZXMgYWdhaW4gYXQgZnVsbCBoZWFsdGhcbiAgICAgIGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgdi5ob2xkZXIuc2V0RW5hYmxlZCh0cnVlKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopO1xuICAgICAgdGhpcy5sYXRlcigxLjEsICgpID0+IHYucGxheSgnaWRsZScpKTtcbiAgICB9XG4gICAgdGhpcy5waGFzZSA9ICdidWlsZCc7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYnVpbGQsIDEuOCk7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgc2V0U3BlZWQoazogbnVtYmVyKSB7IHRoaXMudGltZVNjYWxlID0gazsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIGhlbHBlcnNcbiAgYXBwbHlCYWxhbmNlQ2hhbmdlKCkgeyB0aGlzLnVuaXRWaXMuZm9yRWFjaCgodiwgaWQpID0+IHsgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7IGlmICh1KSB2LnNldFN0YXIodS5zdGFyKTsgfSk7IH1cbiAgdGVzdE9kZHMobiA9IDIwMCkge1xuICAgIGNvbnN0IHNsb3RzID0gdGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW1pZXMgPSBlbmVteVdhdmUodGhpcy5zLndhdmUsIHRoaXMuc2VlZCk7IGxldCB3aW4gPSAwLCB0ID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykgeyBjb25zdCByID0gc2ltdWxhdGUoc2xvdHMsIGVuZW1pZXMsIDUwMDAgKyBpKTsgaWYgKHIud2lubmVyID09PSAwKSB3aW4rKzsgdCArPSByLnRpbWU7IH1cbiAgICByZXR1cm4geyB3aW46IE1hdGgucm91bmQoKHdpbiAvIG4pICogMTAwKSwgYXZnVGltZTogKyh0IC8gbikudG9GaXhlZCgxKSwgbiB9O1xuICB9XG4gIGFkZENhcmQoc291bDogU291bElkKSB7IHRoaXMucy5oYW5kLnB1c2goc291bCk7IHRoaXMucy5zdGF0cy5kcmF3bisrOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIGFkZERvbWluaW9uKG46IG51bWJlcikgeyB0aGlzLnMuY2FwICs9IG47IHRoaXMudWkucmVuZGVyKCk7IH1cbiAgcmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgZW4gPSBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpO1xuICAgIHJldHVybiBbYHNlZWQgJHt0aGlzLnNlZWR9ICB3YXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9ICBoZWFydHMgJHtzLmhlYXJ0c30gIGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSAgcGhhc2UgJHt0aGlzLnBoYXNlfSAgYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH1gLFxuICAgICAgYGhhbmQ6ICR7cy5oYW5kLmpvaW4oJywgJykgfHwgJyhlbXB0eSknfWAsIGBhcm15OiAke3MudW5pdHMubWFwKCh1KSA9PiBgJHt1LnNvdWx9JHt1LnN0YXJ9QCR7dS5jZWxsfWApLmpvaW4oJyAnKSB8fCAnKG5vbmUpJ31gLCBgZW5lbXk6ICR7ZW4ubWFwKChlKSA9PiBlLnNvdWwgKyBlLnN0YXIpLmpvaW4oJyAnKX1gLFxuICAgICAgYGRpZmZpY3VsdHk6ICR7ZGlmZmljdWx0eU5hbWV9ICBtZXJnZS1mcm9tLWhhbmQ6ICR7cy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3Rhcid9ICBzd2FwIHVzZWQ6ICR7cy5kaXNjYXJkVXNlZH1gLCBgbGFzdCB0YXA6ICR7dGhpcy5sYXN0VGFwSW5mb31gLCBgc2NyZWVuOiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gZHByICR7d2luZG93LmRldmljZVBpeGVsUmF0aW99YCwgYGxhc3QgYmF0dGxlOiAke3RoaXMubGFzdEJhdHRsZSB8fCAnLSd9YCwgYGxvZyB0YWlsOmAsIC4uLnMubG9nLnNsaWNlKC04KSwgYGJhbGFuY2U6ICR7SlNPTi5zdHJpbmdpZnkoeyBzdGFyOiBCQUxBTkNFLnN0YXIsIHN0YXRzOiBCQUxBTkNFLnN0YXRzIH0pfWBdLmpvaW4oJ1xcbicpO1xuICB9XG4gIHJlc2V0QmFsYW5jZUFsbCgpIHsgcmVzZXRCYWxhbmNlKCk7IHRoaXMuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7IH1cbiAgZ2V0IGRpZmZpY3VsdHkoKSB7IHJldHVybiBkaWZmaWN1bHR5TmFtZTsgfVxuICBjaGFuZ2VEaWZmaWN1bHR5KG5hbWU6IHN0cmluZykgeyBzZXREaWZmaWN1bHR5KG5hbWUpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnRvYXN0KGBEaWZmaWN1bHR5OiAke25hbWV9LiBBcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZS5gKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGdhbGxlcnkgKHN0YXIgbG9va3MpXG4gIGdhbGxlcnkoKSB7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QuYWRkKCdnYWxsZXJ5Jyk7IHRoaXMubmVjcm8uc2V0RW5hYmxlZChmYWxzZSk7IGNvbnN0IHZpczogVW5pdFZpc3VhbFtdID0gW107IGxldCB0ZWFtOiAwIHwgMSA9IDA7XG4gICAgY29uc3QgcmVidWlsZCA9ICgpID0+IHsgdmlzLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdmlzLmxlbmd0aCA9IDA7IFNPVUxTLmZvckVhY2goKHNvdWwsIGkpID0+IFsxLCAyLCAzXS5mb3JFYWNoKChzdCwgaikgPT4geyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgc291bCwgdGVhbSwgc3QpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoKGkgLSAyLjUpICogMi41LCAwLCAoaiAtIDEpICogLTIuNCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJICogMC44NTsgdi5wbGF5KCdpZGxlJyk7IHZpcy5wdXNoKHYpOyB9KSk7IH07XG4gICAgcmVidWlsZCgpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5zZXQoMCwgNS42LCAtMTQuNSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgLTAuNCkpOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg1O1xuICAgICh3aW5kb3cgYXMgYW55KS5fX2dhbGxlcnkgPSB7IHNldFRlYW06ICh0OiAwIHwgMSkgPT4geyB0ZWFtID0gdDsgcmVidWlsZCgpOyB9LCB2aXMgfTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpOyB0aGlzLmVuZ2luZS5ydW5SZW5kZXJMb29wKCgpID0+IHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpLCBkdCA9IE1hdGgubWluKDAuMDUsIChuIC0gbGFzdCkgLyAxMDAwKTsgbGFzdCA9IG47IHZpcy5mb3JFYWNoKCh2KSA9PiB2LnVwZGF0ZShkdCkpOyB0aGlzLnNjZW5lLnJlbmRlcigpOyB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEdhbWUgfSBmcm9tICcuL2dhbWUudHMnO1xuXG5jb25zdCBnID0gbmV3IEdhbWUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2dhbWUgPSBnOyAgICAgICAgICAgICAgICAgICAgICAgLy8gaGFuZHkgZm9yIGRlYnVnZ2luZyBmcm9tIHRoZSBicm93c2VyIGNvbnNvbGVcbmcuaW5pdChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYycpIGFzIEhUTUxDYW52YXNFbGVtZW50KVxuICAudGhlbigoKSA9PiB7IGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnOyAod2luZG93IGFzIGFueSkuX19nYW1lUmVhZHkgPSB0cnVlOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdhbWUtcmVhZHknKSk7IH0pXG4gIC5jYXRjaCgoZSkgPT4ge1xuICAgIGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgeyBsLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7IGwudGV4dENvbnRlbnQgPSAnRXJyb3I6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBlKTsgfVxuICAgIGNvbnNvbGUuZXJyb3IoZSk7XG4gIH0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBb0NPLE1BQU0sV0FBb0I7QUFBQSxJQUMvQixPQUFPO0FBQUEsTUFDTCxTQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxNQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFFBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEdBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEtBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sS0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLElBQUk7QUFBQSxNQUM5RyxRQUFXLEVBQUUsSUFBSSxLQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sR0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLE1BQzlHLE1BQVcsRUFBRSxJQUFJLEtBQUssS0FBSyxJQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEtBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csV0FBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxNQUFNLE9BQU8sS0FBSyxPQUFPLEtBQUssTUFBTSxLQUFNLFNBQVMsR0FBSyxTQUFTLElBQUk7QUFBQSxJQUNoSDtBQUFBO0FBQUEsSUFFQSxNQUFNLEVBQUUsSUFBSSxDQUFDLEdBQUcsR0FBSyxHQUFHLEdBQUcsS0FBSyxDQUFDLEdBQUcsS0FBSyxDQUFHLEdBQUcsT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEVBQUU7QUFBQSxJQUN0RSxTQUFTLEVBQUUsUUFBUSxHQUFLLFNBQVMsTUFBTSxXQUFXLEVBQUU7QUFBQTtBQUFBLElBRXBELE1BQU07QUFBQSxNQUNKLFFBQVEsRUFBRSxLQUFLLEtBQUssV0FBVyxJQUFJLFFBQVEsRUFBRTtBQUFBO0FBQUEsTUFDN0MsTUFBUSxFQUFFLEtBQUssS0FBSyxXQUFXLElBQUksUUFBUSxFQUFFO0FBQUE7QUFBQSxNQUM3QyxRQUFRLEVBQUUsS0FBSyxLQUFLLFdBQVcsSUFBSSxRQUFRLEdBQUc7QUFBQTtBQUFBLElBQ2hEO0FBQUEsSUFDQSxRQUFRLEVBQUUsU0FBUyxHQUFHLGlCQUFpQixHQUFHO0FBQUEsSUFDMUMsYUFBYSxFQUFFLE9BQU8sS0FBSyxZQUFZLEdBQUssZUFBZSxJQUFJO0FBQUEsSUFDL0QsT0FBTyxFQUFFLFVBQVUsR0FBRyxRQUFRLElBQUk7QUFBQSxJQUNsQyxPQUFPLEVBQUUsTUFBTSxHQUFLLFFBQVEsSUFBSTtBQUFBLElBQ2hDLFFBQVEsRUFBRSxVQUFVLE1BQU0sV0FBVyxHQUFHLFlBQVksSUFBSTtBQUFBLElBQ3hELE9BQU8sRUFBRSxJQUFJLE1BQU0sS0FBSyxNQUFNLGVBQWUsQ0FBQyxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFO0FBQUEsSUFDckYsS0FBSyxFQUFFLFlBQVksS0FBSyxhQUFhLE1BQU0sV0FBVyxLQUFLLGVBQWUsSUFBSTtBQUFBLEVBQ2hGO0FBRU8sTUFBTSxVQUFtQixLQUFLLE1BQU0sS0FBSyxVQUFVLFFBQVEsQ0FBQztBQUU1RCxXQUFTLGVBQXFCO0FBQ25DLFVBQU0sUUFBaUIsS0FBSyxNQUFNLEtBQUssVUFBVSxRQUFRLENBQUM7QUFDMUQsZUFBVyxLQUFLLE9BQU8sS0FBSyxLQUFLLEVBQXdCLENBQUMsUUFBZ0IsQ0FBQyxJQUFLLE1BQWMsQ0FBQztBQUFBLEVBQ2pHO0FBRU8sTUFBTSxZQUFvQztBQUFBLElBQy9DLFNBQVM7QUFBQSxJQUNULFFBQVE7QUFBQSxJQUNSLFFBQVE7QUFBQSxJQUNSLFFBQVE7QUFBQSxJQUNSLE1BQU07QUFBQSxJQUNOLFdBQVc7QUFBQSxFQUNiO0FBRU8sTUFBTSxZQUFvQztBQUFBLElBQy9DLFNBQVM7QUFBQSxJQUFvQixRQUFRO0FBQUEsSUFBbUIsUUFBUTtBQUFBLElBQ2hFLFFBQVE7QUFBQSxJQUFVLE1BQU07QUFBQSxJQUFRLFdBQVc7QUFBQSxFQUM3Qzs7O0FDOUVPLE1BQU0sUUFBa0IsQ0FBQyxXQUFXLFVBQVUsVUFBVSxVQUFVLFFBQVEsV0FBVztBQUdyRixNQUFNLE9BQWlDO0FBQUEsSUFDNUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFDakIsUUFBUSxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFDaEIsUUFBUSxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFDaEIsUUFBUSxDQUFDLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFDakIsTUFBTSxDQUFDLEdBQUcsSUFBSSxFQUFFO0FBQUEsSUFDaEIsV0FBVyxDQUFDLEdBQUcsR0FBRyxFQUFFO0FBQUE7QUFBQSxFQUN0QjtBQUVPLE1BQU0sV0FBVztBQUNqQixNQUFNLGFBQWE7QUFHbkIsTUFBTSxTQUFtQztBQUFBO0FBQUEsSUFFOUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQTtBQUFBLElBRTNDLFVBQVUsQ0FBQyxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsRUFDbEQ7QUFFTyxNQUFNLFNBQVM7QUFDZixNQUFNLGFBQWE7QUFDbkIsTUFBTSxRQUFRO0FBb0JkLE1BQU0sWUFBWTtBQUFsQixNQUFxQixZQUFZOzs7QUN4Q2pDLFdBQVMsUUFBUSxNQUFtQjtBQUN6QyxRQUFJLElBQUksU0FBUztBQUNqQixVQUFNLE9BQU8sTUFBTTtBQUNqQixVQUFLLElBQUksZUFBZ0I7QUFDekIsVUFBSSxJQUFJO0FBQ1IsVUFBSSxLQUFLLEtBQUssSUFBSyxNQUFNLElBQUssSUFBSSxDQUFDO0FBQ25DLFdBQUssSUFBSSxLQUFLLEtBQUssSUFBSyxNQUFNLEdBQUksSUFBSSxFQUFFO0FBQ3hDLGVBQVMsSUFBSyxNQUFNLFFBQVMsS0FBSztBQUFBLElBQ3BDO0FBQ0EsV0FBTztBQUFBLE1BQ0w7QUFBQSxNQUNBO0FBQUEsTUFDQSxLQUFLLENBQUMsTUFBTSxLQUFLLE1BQU0sS0FBSyxJQUFJLENBQUM7QUFBQSxNQUNqQyxNQUFNLENBQUMsVUFBVSxNQUFNLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFBQSxJQUMxRDtBQUFBLEVBQ0Y7OztBQ0NPLE1BQU0sT0FBTyxDQUFDLE1BQWMsU0FBeUIsS0FBSyxJQUFJLEVBQUUsT0FBTyxDQUFDO0FBQ3hFLE1BQU0sVUFBVSxDQUFDLFNBQXlCLE1BQU0sT0FBTztBQUN2RCxNQUFNLGVBQWUsQ0FBQyxNQUFxQixFQUFFLE1BQU0sT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLEVBQUUsSUFBSSxHQUFHLENBQUM7QUFDL0YsTUFBTSxlQUFlLENBQUMsTUFBcUIsRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUV4RSxXQUFTLElBQUksR0FBVSxLQUFhO0FBQUUsTUFBRSxJQUFJLEtBQUssS0FBSyxFQUFFLElBQUksS0FBSyxHQUFHLEVBQUU7QUFBQSxFQUFHO0FBRWxFLE1BQU0sU0FBUyxDQUFDLE1BQXdCLEVBQUUsTUFBTSxRQUFRLEVBQUUsTUFBTSxLQUFLLFNBQVMsRUFBRSxNQUFNLE9BQU87QUFDcEcsV0FBUyxLQUFLLEdBQVUsS0FBYSxLQUFzQjtBQUN6RCxVQUFNLE1BQU0sT0FBTyxDQUFDLEdBQUcsU0FBUyxNQUFNLElBQUksT0FBTyxDQUFDLE1BQU0sTUFBTSxHQUFHLElBQUk7QUFDckUsVUFBTSxPQUFPLE9BQU8sU0FBUyxTQUFTO0FBQ3RDLFVBQU0sSUFBSSxFQUFFLElBQUksS0FBSyxJQUFJO0FBQ3pCLE1BQUUsS0FBSyxLQUFLLENBQUM7QUFBRyxNQUFFLE1BQU07QUFDeEIsUUFBSSxHQUFHLFFBQVEsQ0FBQyxLQUFLLEdBQUcsR0FBRztBQUMzQixXQUFPO0FBQUEsRUFDVDtBQUdPLFdBQVMsU0FBUyxHQUFnQjtBQUN2QyxNQUFFLGNBQWM7QUFDaEIsZUFBVyxLQUFLLEVBQUUsTUFBTyxHQUFFLFFBQVE7QUFBQSxFQUNyQztBQUVPLFdBQVMsU0FBUyxPQUFjLE1BQXFCO0FBaEQ1RDtBQWlERSxVQUFNLElBQVc7QUFBQSxNQUNmO0FBQUEsTUFBTyxLQUFLLFFBQVEsSUFBSTtBQUFBLE1BQUcsTUFBTTtBQUFBLE1BQUcsUUFBUTtBQUFBLE1BQVEsS0FBSyxNQUFNLE1BQU0sQ0FBQztBQUFBLE1BQUcsTUFBTSxDQUFDO0FBQUEsTUFBRyxPQUFPLENBQUM7QUFBQSxNQUFHLFFBQVE7QUFBQSxNQUN0RyxhQUFhO0FBQUEsTUFBTyxRQUFRO0FBQUEsTUFBWSxLQUFLLENBQUM7QUFBQSxNQUM5QyxPQUFPLEVBQUUsT0FBTyxHQUFHLFdBQVcsR0FBRyxXQUFXLEdBQUcsUUFBUSxHQUFHLFVBQVUsRUFBRTtBQUFBLElBQ3hFO0FBQ0EsYUFBUyxJQUFJLEdBQUcsTUFBSyxXQUFNLGNBQU4sWUFBbUIsYUFBYSxJQUFLLE1BQUssR0FBRyxlQUFlO0FBQ2pGLFdBQU87QUFBQSxFQUNUO0FBRU8sV0FBUyxTQUFTLEdBQWtCO0FBQ3pDLFVBQU0sUUFBUSxJQUFJLElBQUksRUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDO0FBQ2hELGFBQVMsSUFBSSxHQUFHLElBQUksWUFBWSxJQUFLLEtBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxFQUFHLFFBQU87QUFDL0QsV0FBTztBQUFBLEVBQ1Q7QUFJTyxXQUFTLFVBQVUsR0FBVSxTQUEwQjtBQUM1RCxVQUFNLE9BQU8sRUFBRSxLQUFLLE9BQU87QUFDM0IsV0FBTyxTQUFTLFVBQWEsU0FBUyxDQUFDLEtBQUssS0FBSyxLQUFLLE1BQU0sQ0FBQyxLQUFLLGFBQWEsQ0FBQztBQUFBLEVBQ2xGO0FBRU8sV0FBUyxTQUFTLEdBQVUsTUFBdUI7QUFDeEQsV0FBTyxRQUFRLEtBQUssT0FBTyxjQUFjLENBQUMsRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxJQUFJO0FBQUEsRUFDL0U7QUFHTyxXQUFTLE9BQU8sR0FBVSxTQUFpQixNQUF3QjtBQUN4RSxRQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sRUFBRyxRQUFPO0FBQ25DLFFBQUksU0FBUyxVQUFhLENBQUMsU0FBUyxHQUFHLElBQUksRUFBRyxRQUFPO0FBQ3JELFVBQU0sT0FBTyxFQUFFLEtBQUssT0FBTyxTQUFTLENBQUMsRUFBRSxDQUFDO0FBQ3hDLFVBQU0sSUFBVSxFQUFFLElBQUksRUFBRSxVQUFVLE1BQU0sTUFBTSxHQUFHLE1BQU0sc0JBQVEsU0FBUyxDQUFDLEdBQUcsT0FBTyxLQUFLO0FBQ3hGLE1BQUUsTUFBTSxLQUFLLENBQUM7QUFDZCxRQUFJLEdBQUcsVUFBVSxJQUFJLGVBQWUsRUFBRSxJQUFJLGVBQWUsYUFBYSxDQUFDLENBQUMsSUFBSSxFQUFFLEdBQUcsR0FBRztBQUNwRixXQUFPO0FBQUEsRUFDVDtBQUVPLFdBQVMsaUJBQWlCLEdBQVMsR0FBa0I7QUFDMUQsV0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLE9BQU87QUFBQSxFQUM3RTtBQUVPLFdBQVMsY0FBYyxHQUFVLEtBQWEsS0FBc0I7QUFDekUsVUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sR0FBRyxHQUFHLElBQUksRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxHQUFHO0FBQ2pGLFFBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLGlCQUFpQixHQUFHLENBQUMsRUFBRyxRQUFPO0FBQ2hELE1BQUUsUUFBUSxFQUFFLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsRUFBRTtBQUM3QyxNQUFFLFFBQVEsQ0FBQyxFQUFFLEVBQUUsU0FBUyxFQUFFO0FBQzFCLE1BQUU7QUFDRixNQUFFLE1BQU07QUFDUixRQUFJLEdBQUcsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLFFBQVEsRUFBRSxJQUFJLGdCQUFnQixhQUFhLENBQUMsQ0FBQyxJQUFJLEVBQUUsR0FBRyxXQUFXLEVBQUUsTUFBTSxNQUFNLElBQUksVUFBVSxHQUFHO0FBQ25KLFdBQU87QUFBQSxFQUNUO0FBR08sV0FBUyxpQkFBaUIsR0FBVSxTQUFpQixRQUF5QjtBQUNuRixRQUFJLEVBQUUsTUFBTSxVQUFVLGtCQUFtQixRQUFPO0FBQ2hELFVBQU0sT0FBTyxFQUFFLEtBQUssT0FBTyxHQUFHLElBQUksRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxNQUFNO0FBQ3JFLFFBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxFQUFFLFNBQVMsUUFBUSxFQUFFLFNBQVMsRUFBRyxRQUFPO0FBQzNELFdBQU8sS0FBSyxNQUFNLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxLQUFLLGFBQWEsQ0FBQztBQUFBLEVBQ3hEO0FBRU8sV0FBUyxjQUFjLEdBQVUsU0FBaUIsUUFBeUI7QUFDaEYsUUFBSSxDQUFDLGlCQUFpQixHQUFHLFNBQVMsTUFBTSxFQUFHLFFBQU87QUFDbEQsVUFBTSxPQUFPLEVBQUUsS0FBSyxPQUFPLFNBQVMsQ0FBQyxFQUFFLENBQUM7QUFDeEMsVUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sTUFBTTtBQUM3QyxNQUFFLE9BQU87QUFDVCxNQUFFLE1BQU07QUFDUixRQUFJLEdBQUcsbUJBQW1CLElBQUksT0FBTyxFQUFFLElBQUksa0JBQWtCLGFBQWEsQ0FBQyxDQUFDLElBQUksRUFBRSxHQUFHLEdBQUc7QUFDeEYsV0FBTztBQUFBLEVBQ1Q7QUFFTyxXQUFTLFFBQVEsR0FBVSxRQUF5QjtBQUN6RCxVQUFNLElBQUksRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxNQUFNO0FBQzdDLFFBQUksQ0FBQyxFQUFHLFFBQU87QUFDZixNQUFFLFFBQVEsRUFBRSxNQUFNLE9BQU8sQ0FBQyxNQUFNLEVBQUUsT0FBTyxNQUFNO0FBQy9DLE1BQUUsTUFBTSxhQUFhLFFBQVEsRUFBRSxJQUFJO0FBQ25DLFFBQUksR0FBRyxXQUFXLEVBQUUsSUFBSSxJQUFJLEVBQUUsSUFBSSx5QkFBeUI7QUFDM0QsV0FBTztBQUFBLEVBQ1Q7QUFHTyxXQUFTLGNBQWMsR0FBVSxTQUEwQjtBQUNoRSxRQUFJLEVBQUUsZUFBZSxVQUFVLEtBQUssV0FBVyxFQUFFLEtBQUssT0FBUSxRQUFPO0FBQ3JFLFVBQU0sSUFBSSxFQUFFLEtBQUssT0FBTyxTQUFTLENBQUMsRUFBRSxDQUFDO0FBQ3JDLE1BQUUsY0FBYztBQUFNLE1BQUUsTUFBTTtBQUM5QixRQUFJLEdBQUcsaUJBQWlCLENBQUMsRUFBRTtBQUMzQixTQUFLLEdBQUcsUUFBUSxDQUFDO0FBQ2pCLFdBQU87QUFBQSxFQUNUO0FBR08sV0FBUyxZQUFZLEdBQVUsUUFBeUI7QUFDN0QsVUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sTUFBTTtBQUM3QyxXQUFPLENBQUMsRUFBRSxlQUFlLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBRTtBQUFBLEVBQ3JDO0FBR08sV0FBUyxTQUFTLEdBQVUsUUFBeUI7QUFDMUQsUUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLEVBQUcsUUFBTztBQUNwQyxVQUFNLElBQUksRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxNQUFNO0FBQzdDLE1BQUUsUUFBUSxFQUFFLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxPQUFPLE1BQU07QUFDL0MsTUFBRSxjQUFjO0FBQU0sTUFBRSxNQUFNLGFBQWEsUUFBUSxFQUFFLElBQUk7QUFDekQsUUFBSSxHQUFHLGNBQWMsRUFBRSxJQUFJLElBQUksRUFBRSxJQUFJLEdBQUc7QUFDeEMsU0FBSyxHQUFHLFFBQVEsRUFBRSxJQUFJO0FBQ3RCLFdBQU87QUFBQSxFQUNUO0FBRU8sV0FBUyxTQUFTLEdBQVUsUUFBZ0IsTUFBdUI7QUFDeEUsVUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sTUFBTTtBQUM3QyxRQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsR0FBRyxJQUFJLEVBQUcsUUFBTztBQUNyQyxRQUFJLEdBQUcsUUFBUSxFQUFFLElBQUksU0FBUyxFQUFFLElBQUksT0FBTyxJQUFJLEVBQUU7QUFBRyxNQUFFLE9BQU87QUFBTSxXQUFPO0FBQUEsRUFDNUU7QUFLTyxXQUFTLGFBQWEsR0FBb0I7QUFDL0MsVUFBTSxJQUFJLE9BQU8sQ0FBQztBQUNsQixXQUFPLENBQUMsRUFBRSxJQUFJLEtBQUssQ0FBQyxHQUFHLEVBQUUsSUFBSSxLQUFLLENBQUMsR0FBRyxFQUFFLElBQUksS0FBSyxDQUFDLENBQUM7QUFBQSxFQUNyRDtBQUdPLE1BQU0sYUFBYSxDQUFDLE1BQWtCO0FBMUs3QztBQTBLZ0QsbUJBQUUsTUFBTSxlQUFSLFlBQXNCO0FBQUE7QUFHL0QsV0FBUyxZQUFZLEdBQW1CO0FBQzdDLFFBQUksRUFBRSxXQUFXLFdBQVksUUFBTyxFQUFFLFdBQVc7QUFDakQsUUFBSSxFQUFFLFFBQVEsV0FBVyxDQUFDLEdBQUc7QUFBRSxRQUFFLFNBQVM7QUFBTyxVQUFJLEdBQUcsZUFBZTtBQUFHLGFBQU87QUFBQSxJQUFNO0FBQ3ZGLE1BQUU7QUFDRixNQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxPQUFPLENBQUM7QUFDaEMsYUFBUyxDQUFDO0FBQ1YsUUFBSSxHQUFHLHVCQUF1QixFQUFFLEdBQUcsRUFBRTtBQUNyQyxXQUFPO0FBQUEsRUFDVDtBQUdPLFdBQVMsVUFBVSxHQUFVLE1BQWdCLEtBQW1CO0FBQ3JFLFVBQU0sT0FBTyxLQUFLLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxLQUFLLFNBQVMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUM3RCxNQUFFLEtBQUssS0FBSyxJQUFJO0FBQUcsTUFBRSxNQUFNO0FBQzNCLFFBQUksR0FBRyxVQUFVLEtBQUssS0FBSyxJQUFJLENBQUMsYUFBYSxJQUFJLEVBQUU7QUFBQSxFQUNyRDtBQUdPLFdBQVMsV0FBVyxHQUFnQjtBQUN6QyxRQUFJLEVBQUUsTUFBTSxrQkFBa0IsRUFBRSxNQUFNLGdCQUFnQixTQUFTLEVBQUUsSUFBSSxJQUFJLEtBQU0sTUFBSyxHQUFHLFlBQVk7QUFBQSxFQUNyRztBQW1CTyxXQUFTLFNBQVMsR0FBZ0I7QUFDdkMsUUFBSSxFQUFFLFdBQVcsV0FBWTtBQUM3QixNQUFFO0FBQVUsTUFBRSxNQUFNO0FBQ3BCLFFBQUksRUFBRSxVQUFVLEdBQUc7QUFBRSxRQUFFLFNBQVM7QUFBUSxVQUFJLEdBQUcsNEJBQTRCO0FBQUc7QUFBQSxJQUFRO0FBQ3RGLGFBQVMsQ0FBQztBQUNWLFFBQUksR0FBRyxzQkFBc0IsRUFBRSxNQUFNLGVBQWUsRUFBRSxHQUFHLEVBQUU7QUFDM0QsU0FBSyxHQUFHLGdCQUFnQjtBQUFBLEVBQzFCOzs7QUN4TU8sTUFBTSxVQUFVO0FBQ2hCLE1BQU0sVUFBVTtBQU1oQixXQUFTLFFBQVEsTUFBYSxNQUF3QztBQUMzRSxVQUFNLE1BQU0sS0FBSyxNQUFNLE9BQU8sU0FBUyxHQUFHLE1BQU0sT0FBTztBQUN2RCxVQUFNLFFBQVEsWUFBWSxJQUFJO0FBQzlCLFdBQU8sRUFBRSxJQUFJLFVBQVUsUUFBUSxZQUFZLFNBQVMsSUFBSSxLQUFLLElBQUksSUFBSSxPQUFPLFlBQVksS0FBSyxLQUFLLFFBQVE7QUFBQSxFQUM1RztBQUVBLE1BQU0sWUFBb0MsRUFBRSxRQUFRLEdBQUcsTUFBTSxHQUFHLFNBQVMsR0FBRyxXQUFXLEdBQUcsUUFBUSxHQUFHLFFBQVEsRUFBRTtBQUV4RyxXQUFTLFdBQVcsT0FBeUI7QUFDbEQsVUFBTSxRQUFrQixDQUFDO0FBQ3pCLGFBQVMsSUFBSSxHQUFHLElBQUksWUFBWSxXQUFXLElBQUssT0FBTSxLQUFLLENBQUM7QUFDNUQsVUFBTSxLQUFLLENBQUMsR0FBRyxNQUFNO0FBQ25CLFlBQU0sS0FBSyxZQUFZLElBQUssSUFBSSxXQUFZLEtBQUssWUFBWSxJQUFLLElBQUk7QUFDdEUsVUFBSSxPQUFPLEdBQUksUUFBTyxLQUFLO0FBQzNCLGFBQU8sS0FBSyxJQUFJLEtBQUssTUFBTSxJQUFJLFNBQVMsSUFBSSxDQUFDLElBQUksS0FBSyxJQUFJLEtBQUssTUFBTSxJQUFJLFNBQVMsSUFBSSxDQUFDO0FBQUEsSUFDekYsQ0FBQztBQUNELFVBQU0sUUFBUSxNQUFNLElBQUksQ0FBQyxHQUFHLE1BQU0sQ0FBQyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sVUFBVSxNQUFNLENBQUMsRUFBRSxJQUFJLElBQUksVUFBVSxNQUFNLENBQUMsRUFBRSxJQUFJLENBQUM7QUFDdkcsVUFBTSxNQUFNLElBQUksTUFBYyxNQUFNLE1BQU07QUFDMUMsVUFBTSxRQUFRLENBQUMsS0FBSyxNQUFNO0FBQUUsVUFBSSxHQUFHLElBQUksTUFBTSxDQUFDO0FBQUEsSUFBRyxDQUFDO0FBQ2xELFdBQU87QUFBQSxFQUNUO0FBdUJPLE1BQU0sU0FBTixNQUFhO0FBQUEsSUFVbEIsWUFBWSxTQUFpQixTQUFpQixPQUFPLEdBQUc7QUFUeEQsa0NBQU87QUFDUCxzQ0FBc0IsQ0FBQztBQUN2QixvQ0FBbUIsQ0FBQztBQUNwQixvQ0FBcUI7QUFDckI7QUFDQSwwQkFBUSxXQUFtRSxDQUFDO0FBQzVFLDBCQUFRLFVBQVM7QUFDakIsMEJBQVEsUUFBTztBQUdiLFdBQUssTUFBTSxRQUFRLElBQUk7QUFDdkIsaUJBQVcsS0FBSyxRQUFTLE1BQUssSUFBSSxHQUFHLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxJQUFJO0FBQzNELFlBQU0sUUFBUSxXQUFXLE9BQU87QUFDaEMsY0FBUSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssSUFBSSxHQUFHLEVBQUUsTUFBTSxFQUFFLE1BQU0sTUFBTSxDQUFDLENBQUMsQ0FBQztBQUFBLElBQ2pFO0FBQUEsSUFFUSxJQUFJLE1BQWEsTUFBYyxNQUFjLE1BQXVCO0FBdEY5RTtBQXVGSSxZQUFNLElBQUksU0FBUyxLQUFLLEVBQUUsTUFBTSxJQUFJLEdBQUcsSUFBSSxRQUFRLE1BQU0sSUFBSTtBQUM3RCxZQUFNLEtBQUssR0FBRyxLQUFLLEVBQUUsS0FBSyxHQUFHLE9BQU8sQ0FBQztBQUNyQyxZQUFNLElBQWE7QUFBQSxRQUNqQixJQUFJLEtBQUs7QUFBQSxRQUFVO0FBQUEsUUFBTTtBQUFBLFFBQU07QUFBQSxRQUFNO0FBQUEsUUFBTSxHQUFHLEVBQUU7QUFBQSxRQUFHLEdBQUcsRUFBRTtBQUFBLFFBQUcsS0FBSyxTQUFTLElBQUksSUFBSSxLQUFLO0FBQUEsUUFDdEY7QUFBQSxRQUFJLE9BQU87QUFBQSxRQUFJLEtBQUssR0FBRyxNQUFNLEVBQUUsS0FBSyxJQUFJLE9BQU8sQ0FBQztBQUFBLFFBQUcsVUFBVSxHQUFHO0FBQUEsUUFBVSxPQUFPLEdBQUc7QUFBQSxRQUFPLE9BQU8sR0FBRztBQUFBLFFBQU8sUUFBUSxHQUFHLE9BQU8sRUFBRSxLQUFLLE1BQU0sT0FBTyxDQUFDO0FBQUEsUUFDbkosT0FBTztBQUFBLFFBQU0sT0FBTztBQUFBLFFBQVEsUUFBUTtBQUFBLFFBQUksWUFBWTtBQUFBLFFBQUcsY0FBYztBQUFBLFFBQUksYUFBYTtBQUFBLFFBQ3RGLFlBQVksS0FBSyxJQUFJLEtBQUssSUFBSTtBQUFBLFFBQUssYUFBYTtBQUFBLFFBQUksV0FBVztBQUFBLFFBQUcsV0FBVztBQUFBLFFBQUcsU0FBUztBQUFBLFFBQUcsU0FBUztBQUFBLFFBQ3JHLE1BQU07QUFBQSxRQUFHLFVBQVMsYUFBRSxLQUFLLElBQUksTUFBWCxtQkFBYyxRQUFkLFlBQXFCO0FBQUEsUUFBRyxTQUFTO0FBQUEsUUFBTyxRQUFRO0FBQUEsUUFBRyxRQUFRO0FBQUEsTUFDL0U7QUFDQSxXQUFLLFNBQVMsS0FBSyxDQUFDO0FBQUcsYUFBTztBQUFBLElBQ2hDO0FBQUEsSUFFQSxLQUFLLElBQWlDO0FBQUUsYUFBTyxLQUFLLElBQUksU0FBWSxLQUFLLFNBQVMsS0FBSyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQzNGLEtBQUssR0FBdUI7QUFBRSxhQUFPLEtBQUssU0FBUyxPQUFPLENBQUMsTUFBTSxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsSUFBSTtBQUFBLElBQUc7QUFBQSxJQUNoRyxNQUFNLE1BQXFCO0FBQUUsYUFBTyxLQUFLLFNBQVMsT0FBTyxDQUFDLEdBQUcsTUFBTSxLQUFLLEVBQUUsU0FBUyxFQUFFLFNBQVMsT0FBTyxJQUFJLElBQUksQ0FBQztBQUFBLElBQUc7QUFBQSxJQUNqSCxRQUFrQjtBQUFFLFlBQU0sSUFBSSxLQUFLO0FBQVEsV0FBSyxTQUFTLENBQUM7QUFBRyxhQUFPO0FBQUEsSUFBRztBQUFBLElBRXZFLEtBQUssSUFBa0I7QUFDckIsVUFBSSxLQUFLLFVBQVUsRUFBRztBQUN0QixXQUFLLFFBQVE7QUFBSSxXQUFLLE9BQU8sQ0FBQyxLQUFLO0FBRW5DLGVBQVMsSUFBSSxLQUFLLFFBQVEsU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQ2pELGNBQU0sSUFBSSxLQUFLLFFBQVEsQ0FBQztBQUN4QixZQUFJLEtBQUssUUFBUSxFQUFFLElBQUk7QUFDckIsZUFBSyxRQUFRLE9BQU8sR0FBRyxDQUFDO0FBQ3hCLGdCQUFNLEtBQUssS0FBSyxLQUFLLEVBQUUsRUFBRSxHQUFHLE9BQU8sS0FBSyxLQUFLLEVBQUUsSUFBSTtBQUNuRCxjQUFJLE1BQU0sR0FBRyxTQUFTLEtBQU0sTUFBSyxPQUFPLElBQUksRUFBRSxLQUFLLE1BQU0sT0FBTztBQUFBLFFBQ2xFO0FBQUEsTUFDRjtBQUNBLFlBQU0sUUFBUSxLQUFLLFNBQVMsT0FBTyxDQUFDLE1BQU0sRUFBRSxLQUFLO0FBQUcsVUFBSSxLQUFLLEtBQU0sT0FBTSxRQUFRO0FBQ2pGLGlCQUFXLEtBQUssTUFBTyxLQUFJLEVBQUUsTUFBTyxNQUFLLE9BQU8sR0FBRyxFQUFFO0FBQ3JELFlBQU0sSUFBSSxLQUFLLE1BQU0sQ0FBQyxHQUFHLElBQUksS0FBSyxNQUFNLENBQUM7QUFDekMsVUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFHLE1BQUssU0FBUyxJQUFJLElBQUk7QUFBQSxlQUMzQixLQUFLLFFBQVEsUUFBUSxJQUFJLFdBQVc7QUFDM0MsY0FBTSxLQUFLLENBQUMsTUFBYSxLQUFLLFNBQVMsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLEVBQUUsT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQztBQUNwSCxhQUFLLFNBQVMsR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLElBQUksSUFBSTtBQUFBLE1BQ3BDO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFHUSxPQUFPLEdBQVksSUFBa0I7QUFDM0MsWUFBTSxJQUFJLFNBQVMsS0FBSyxFQUFFLE1BQU0sRUFBRSxJQUFJO0FBQ3RDLFdBQUssU0FBUyxHQUFHLEVBQUU7QUFFbkIsVUFBSSxFQUFFLFVBQVUsVUFBVTtBQUN4QixjQUFNLElBQUksS0FBSyxPQUFPLEVBQUU7QUFDeEIsY0FBTUEsTUFBSyxLQUFLLEtBQUssRUFBRSxNQUFNO0FBQUcsWUFBSUEsT0FBTUEsSUFBRyxNQUFPLE1BQUssS0FBSyxHQUFHQSxJQUFHLElBQUksRUFBRSxHQUFHQSxJQUFHLElBQUksRUFBRSxHQUFHLEVBQUU7QUFDM0YsWUFBSSxDQUFDLEVBQUUsV0FBVyxLQUFLLEVBQUUsWUFBWSxHQUFHLFNBQVM7QUFBRSxZQUFFLFVBQVU7QUFBTSxlQUFLLFdBQVcsQ0FBQztBQUFBLFFBQUc7QUFDekYsWUFBSSxLQUFLLEVBQUUsVUFBVyxHQUFFLFFBQVE7QUFDaEM7QUFBQSxNQUNGO0FBQ0EsV0FBSyxRQUFRLENBQUM7QUFDZCxZQUFNLEtBQUssS0FBSyxLQUFLLEVBQUUsTUFBTTtBQUM3QixVQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsT0FBTztBQUFFLFVBQUUsUUFBUTtBQUFRLGFBQUssWUFBWSxDQUFDO0FBQUc7QUFBQSxNQUFRO0FBQ3ZFLFlBQU0sS0FBSyxHQUFHLElBQUksRUFBRSxHQUFHLEtBQUssR0FBRyxJQUFJLEVBQUUsR0FBRyxPQUFPLEtBQUssTUFBTSxJQUFJLEVBQUU7QUFDaEUsV0FBSyxLQUFLLEdBQUcsSUFBSSxJQUFJLEVBQUU7QUFDdkIsVUFBSSxRQUFRLEVBQUUsT0FBTztBQUNuQixZQUFJLEtBQUssUUFBUSxFQUFFLFdBQVksTUFBSyxZQUFZLENBQUM7QUFBQSxhQUFRO0FBQUUsWUFBRSxRQUFRO0FBQVEsZUFBSyxZQUFZLENBQUM7QUFBQSxRQUFHO0FBQUEsTUFDcEcsT0FBTztBQUNMLFVBQUUsUUFBUTtBQUFPLGNBQU0sSUFBSSxFQUFFLFFBQVEsS0FBSyxLQUFLLElBQUksTUFBTSxJQUFJO0FBQUcsVUFBRSxLQUFLLEtBQUs7QUFBRyxVQUFFLEtBQUssS0FBSztBQUFHLGFBQUssWUFBWSxDQUFDO0FBQUEsTUFDbEg7QUFBQSxJQUNGO0FBQUEsSUFFUSxZQUFZLEdBQWtCO0FBQ3BDLFVBQUksRUFBRSxTQUFTLGVBQWUsRUFBRSxTQUFTLEtBQUssS0FBSyxRQUFRLEVBQUUsY0FBYyxFQUFFLGFBQWEsUUFBUSxPQUFPLFdBQVksR0FBRSxTQUFTO0FBQUEsSUFDbEk7QUFBQSxJQUVRLEtBQUssR0FBWSxJQUFZLElBQVksSUFBa0I7QUFDakUsVUFBSSxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQU07QUFDOUIsWUFBTSxPQUFPLEtBQUssTUFBTSxJQUFJLEVBQUU7QUFBRyxVQUFJLE1BQU0sT0FBTyxFQUFFLE1BQU0sS0FBSyxPQUFPLElBQUksS0FBSyxNQUFNLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxNQUFNLEtBQUs7QUFDekgsUUFBRSxPQUFPLEtBQUssSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxDQUFDLENBQUM7QUFBQSxJQUNoRDtBQUFBLElBRVEsU0FBUyxHQUFZLElBQWtCO0FBQzdDLFVBQUksS0FBSyxHQUFHLEtBQUs7QUFDakIsaUJBQVcsS0FBSyxLQUFLLFVBQVU7QUFDN0IsWUFBSSxNQUFNLEtBQUssQ0FBQyxFQUFFLE1BQU87QUFDekIsY0FBTSxLQUFLLEVBQUUsSUFBSSxFQUFFLEdBQUcsS0FBSyxFQUFFLElBQUksRUFBRSxHQUFHLElBQUksS0FBSyxNQUFNLElBQUksRUFBRSxHQUFHLFFBQVEsRUFBRSxTQUFTLEVBQUUsVUFBVSxPQUFPO0FBQ3BHLFlBQUksS0FBSyxLQUFNO0FBQ2YsY0FBTSxLQUFLLE9BQU8sS0FBSyxLQUFLLElBQUksR0FBRyxJQUFJO0FBQUcsZUFBTyxJQUFJLE9BQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxNQUFPLE1BQU07QUFBRyxlQUFPLElBQUksT0FBUSxLQUFLLElBQUksS0FBSyxJQUFJLE1BQU8sTUFBTTtBQUFBLE1BQ25KO0FBQ0EsWUFBTSxJQUFJLEtBQUssSUFBSSxHQUFHLEtBQUssQ0FBQztBQUFHLFFBQUUsS0FBSyxLQUFLO0FBQUcsUUFBRSxLQUFLLEtBQUs7QUFBQSxJQUM1RDtBQUFBLElBRVEsUUFBUSxHQUFrQjtBQUNoQyxVQUFJLEVBQUUsZ0JBQWdCLEdBQUc7QUFDdkIsY0FBTSxLQUFLLEtBQUssS0FBSyxFQUFFLFlBQVk7QUFDbkMsWUFBSSxNQUFNLEdBQUcsU0FBUyxLQUFLLE9BQU8sRUFBRSxhQUFhO0FBQUUsWUFBRSxTQUFTLEdBQUc7QUFBSTtBQUFBLFFBQVE7QUFDN0UsVUFBRSxlQUFlO0FBQUEsTUFDbkI7QUFDQSxZQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsTUFBTTtBQUM5QixVQUFJLE9BQU8sSUFBSSxTQUFTLEtBQUssT0FBTyxFQUFFLFdBQVk7QUFDbEQsUUFBRSxhQUFhLEtBQUssT0FBTyxRQUFRLElBQUksaUJBQWlCLE1BQU0sTUFBTSxLQUFLLElBQUksS0FBSztBQUNsRixZQUFNLE9BQU8sS0FBSyxLQUFLLENBQUM7QUFBRyxVQUFJLENBQUMsS0FBSyxRQUFRO0FBQUUsVUFBRSxTQUFTO0FBQUk7QUFBQSxNQUFRO0FBQ3RFLFVBQUksT0FBTyxLQUFLLENBQUMsR0FBRyxLQUFLO0FBQ3pCLGlCQUFXLEtBQUssTUFBTTtBQUNwQixZQUFJLFFBQVEsS0FBSyxNQUFNLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUMzQyxZQUFJLEVBQUUsU0FBUyxVQUFVO0FBRXZCLGdCQUFNLFVBQVUsS0FBSyxLQUFLLEVBQUUsTUFBTTtBQUFHLGdCQUFNLE9BQU8sQ0FBQyxDQUFDLFdBQVcsUUFBUSxTQUFTLFFBQVEsU0FBUyxFQUFFLFFBQVEsUUFBUSxPQUFPLEVBQUU7QUFDNUgsY0FBSSxRQUFRLFFBQVEsUUFBUSxZQUFZLGFBQWEsRUFBRyxVQUFTO0FBQ2pFLG1CQUFTLFFBQVEsWUFBWSxpQkFBaUIsSUFBSSxFQUFFLEtBQUssRUFBRTtBQUFBLFFBQzdEO0FBQ0EsWUFBSSxRQUFRLElBQUk7QUFBRSxlQUFLO0FBQU8saUJBQU87QUFBQSxRQUFHO0FBQUEsTUFDMUM7QUFDQSxRQUFFLFNBQVMsS0FBSztBQUFBLElBQ2xCO0FBQUEsSUFFUSxZQUFZLEdBQWtCO0FBQ3BDLFlBQU0sSUFBSSxTQUFTLEtBQUssRUFBRSxNQUFNLEVBQUUsSUFBSTtBQUFHLFVBQUksTUFBTSxFQUFFO0FBQ3JELFVBQUksRUFBRSxTQUFTLGFBQWE7QUFBRSxVQUFFLFNBQVMsS0FBSyxJQUFJLEVBQUUsT0FBTyxXQUFXLEVBQUUsU0FBUyxDQUFDO0FBQUcsY0FBTSxFQUFFLFlBQVksSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPO0FBQVcsYUFBSyxPQUFPLEtBQUssRUFBRSxHQUFHLFVBQVUsSUFBSSxFQUFFLElBQUksUUFBUSxFQUFFLE9BQU8sQ0FBQztBQUFBLE1BQUc7QUFDM00sUUFBRSxZQUFZLEtBQUssSUFBSSxHQUFHLFNBQVMsTUFBTSxJQUFJO0FBQUcsUUFBRSxZQUFZLEdBQUcsVUFBVSxFQUFFO0FBQzdFLFFBQUUsY0FBYyxLQUFLO0FBQU0sUUFBRSxhQUFhLEtBQUssT0FBTyxLQUFLLElBQUksS0FBSyxFQUFFLFNBQVM7QUFBRyxRQUFFLFVBQVU7QUFBTyxRQUFFLFFBQVE7QUFDL0csUUFBRSxVQUFVLEVBQUUsVUFBVSxLQUFLLEVBQUUsUUFBUSxFQUFFO0FBQVMsVUFBSSxFQUFFLFNBQVM7QUFBRSxVQUFFLE9BQU87QUFBRyxhQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsUUFBUSxJQUFJLEVBQUUsSUFBSSxPQUFPLEVBQUUsU0FBUyxXQUFXLFVBQVUsRUFBRSxTQUFTLFdBQVcsVUFBVSxRQUFRLENBQUM7QUFBQSxNQUFHO0FBQzFNLFdBQUssT0FBTyxLQUFLLEVBQUUsR0FBRyxTQUFTLElBQUksRUFBRSxJQUFJLE9BQU8sRUFBRSxXQUFXLEtBQUssRUFBRSxVQUFVLENBQUM7QUFBQSxJQUNqRjtBQUFBLElBRVEsV0FBVyxHQUFrQjtBQUNuQyxZQUFNLElBQUk7QUFBUyxZQUFNLEtBQUssS0FBSyxLQUFLLEVBQUUsTUFBTTtBQUFHLFVBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxNQUFPO0FBQ3pFLFlBQU0sSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJO0FBQUcsVUFBSSxLQUFLLENBQUMsRUFBRSxRQUFTLEdBQUUsT0FBTyxLQUFLLElBQUksRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFNBQVM7QUFDNUYsVUFBSSxFQUFFLFNBQVMsVUFBVTtBQUN2QixjQUFNLFFBQVEsRUFBRSxRQUFRO0FBQ3hCLGNBQU0sT0FBTyxLQUFLLEtBQUssQ0FBQyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxHQUFHLEtBQUssTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBRSxLQUFLLEtBQUssRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDdkksY0FBTSxTQUFTLEVBQUUsVUFBVSxDQUFDLElBQUksR0FBRyxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxNQUFNLEVBQUUsT0FBTyxHQUFHLEVBQUUsQ0FBQyxFQUFFLE1BQU0sR0FBRyxFQUFFLE9BQU8sT0FBTyxJQUFJLENBQUMsRUFBRTtBQUN2SCxtQkFBVyxLQUFLLFFBQVE7QUFDdEIsZ0JBQU0sTUFBTSxLQUFLLElBQUksTUFBTSxLQUFLLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxDQUFDLElBQUksRUFBRSxPQUFPLGVBQWU7QUFDdEYsZUFBSyxRQUFRLEtBQUssRUFBRSxJQUFJLEtBQUssT0FBTyxLQUFLLE1BQU0sRUFBRSxJQUFJLElBQUksRUFBRSxJQUFJLEtBQUssRUFBRSxJQUFJLENBQUM7QUFDM0UsZUFBSyxPQUFPLEtBQUssRUFBRSxHQUFHLFNBQVMsTUFBTSxFQUFFLElBQUksSUFBSSxFQUFFLElBQUksSUFBSSxDQUFDO0FBQUEsUUFDNUQ7QUFDQSxVQUFFLFVBQVU7QUFBTztBQUFBLE1BQ3JCO0FBQ0EsVUFBSSxLQUFLLE1BQU0sR0FBRyxJQUFJLEVBQUUsR0FBRyxHQUFHLElBQUksRUFBRSxDQUFDLElBQUksRUFBRSxRQUFRLEtBQUs7QUFBRSxVQUFFLFVBQVU7QUFBTztBQUFBLE1BQVE7QUFDckYsVUFBSSxNQUFNLEVBQUU7QUFDWixVQUFJLEVBQUUsU0FBUyxVQUFVO0FBQUUsY0FBTSxNQUFNLEtBQUssS0FBSyxHQUFHLE1BQU07QUFBRyxZQUFJLE9BQU8sSUFBSSxTQUFTLElBQUksU0FBUyxFQUFFLFFBQVEsSUFBSSxPQUFPLEVBQUUsR0FBSSxRQUFPLElBQUksRUFBRSxZQUFZO0FBQUEsTUFBTztBQUM3SixVQUFJLEVBQUUsU0FBUztBQUNiLFVBQUUsVUFBVTtBQUNaLFlBQUksRUFBRSxTQUFTLFFBQVE7QUFDckIsaUJBQU8sRUFBRSxNQUFNO0FBQU0sZUFBSyxPQUFPLEtBQUssRUFBRSxHQUFHLFNBQVMsSUFBSSxFQUFFLElBQUksR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxFQUFFLE1BQU0sT0FBTyxDQUFDO0FBQ25HLHFCQUFXLEtBQUssS0FBSyxLQUFLLENBQUMsRUFBRyxLQUFJLEVBQUUsT0FBTyxHQUFHLE1BQU0sS0FBSyxNQUFNLEVBQUUsSUFBSSxHQUFHLEdBQUcsRUFBRSxJQUFJLEdBQUcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxPQUFRLE1BQUssT0FBTyxHQUFHLE1BQU0sS0FBSyxHQUFHLE9BQU87QUFDOUksZUFBSyxPQUFPLElBQUksS0FBSyxHQUFHLE9BQU87QUFBRztBQUFBLFFBQ3BDO0FBQ0EsWUFBSSxFQUFFLFNBQVMsVUFBVTtBQUN2QixxQkFBVyxLQUFLLEtBQUssS0FBSyxDQUFDLEVBQUcsS0FBSSxLQUFLLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxDQUFDLEtBQUssRUFBRSxNQUFNLFFBQVE7QUFBRSxjQUFFLGVBQWUsRUFBRTtBQUFJLGNBQUUsY0FBYyxLQUFLLE9BQU8sRUFBRSxNQUFNO0FBQVUsY0FBRSxhQUFhO0FBQUEsVUFBRztBQUMvSyxlQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsU0FBUyxJQUFJLEVBQUUsR0FBRyxDQUFDO0FBQUEsUUFDM0M7QUFBQSxNQUNGO0FBQ0EsV0FBSyxPQUFPLElBQUksS0FBSyxHQUFHLE9BQU87QUFBQSxJQUNqQztBQUFBLElBRVEsT0FBTyxHQUFZLFFBQWdCLE1BQWUsTUFBeUM7QUFDakcsVUFBSSxDQUFDLEVBQUUsTUFBTztBQUNkLFlBQU0sSUFBSTtBQUFTLFVBQUksTUFBTTtBQUM3QixVQUFJLEVBQUUsU0FBUyxXQUFXO0FBQ3hCLGNBQU0sSUFBSSxLQUFLLFNBQVMsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLE1BQU0sS0FBSyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsU0FBUyxhQUFhLEtBQUssTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLENBQUMsS0FBSyxFQUFFLFFBQVEsTUFBTSxFQUFFO0FBQy9KLGNBQU0sS0FBSyxJQUFJLEVBQUUsUUFBUSxXQUFXLENBQUMsSUFBSSxFQUFFLFFBQVE7QUFBQSxNQUNyRDtBQUNBLFlBQU0sTUFBTSxVQUFVLElBQUk7QUFBTSxRQUFFLE1BQU07QUFDeEMsWUFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUk7QUFBRyxVQUFJLEtBQUssRUFBRSxLQUFLLEVBQUcsR0FBRSxPQUFPLEtBQUssSUFBSSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsTUFBTTtBQUN2RixXQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLEVBQUUsSUFBSSxLQUFLLEtBQUssQ0FBQztBQUNqRSxVQUFJLEVBQUUsTUFBTSxHQUFHO0FBQUUsVUFBRSxLQUFLO0FBQUcsVUFBRSxRQUFRO0FBQU8sVUFBRSxRQUFRO0FBQVEsVUFBRSxTQUFTLEtBQUs7QUFBTSxhQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsU0FBUyxJQUFJLEVBQUUsR0FBRyxDQUFDO0FBQUEsTUFBRztBQUFBLElBQ2xJO0FBQUEsRUFDRjtBQUdPLFdBQVMsU0FBUyxTQUFpQixTQUFpQixPQUFPLEdBQUcsYUFBYSxLQUFvRTtBQUNwSixVQUFNLElBQUksSUFBSSxPQUFPLFNBQVMsU0FBUyxJQUFJO0FBQzNDLFdBQU8sRUFBRSxTQUFTLEtBQUssRUFBRSxPQUFPLFdBQVksR0FBRSxLQUFLLElBQUksRUFBRTtBQUN6RCxVQUFNLElBQUssRUFBRSxTQUFTLElBQUksSUFBSSxFQUFFO0FBQ2hDLFVBQU0sT0FBTyxFQUFFLFNBQVMsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDO0FBQzdELFdBQU8sRUFBRSxRQUFRLEdBQUcsTUFBTSxFQUFFLE1BQU0sTUFBTSxLQUFLLFFBQVEsUUFBUSxLQUFLLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsRUFBRTtBQUFBLEVBQzVHOzs7QUN6UEEsTUFBTSxTQUFpQyxFQUFFLEdBQUcsV0FBVyxHQUFHLFVBQVUsR0FBRyxVQUFVLEdBQUcsVUFBVSxHQUFHLFFBQVEsR0FBRyxZQUFZO0FBQ3hILE1BQU0sWUFBWSxDQUFDLE1BQTJCLEVBQUUsTUFBTSxHQUFHLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLE9BQU8sRUFBRSxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTtBQVFwRyxNQUFNLGFBQXVDO0FBQUEsSUFDbEQsTUFBTSxDQUFDLE1BQU0sU0FBUyxZQUFZLFlBQVksWUFBWSxZQUFZLGVBQWUsZUFBZSxlQUFlLGFBQWE7QUFBQSxJQUNoSSxRQUFRLENBQUMsU0FBUyxZQUFZLGVBQWUsZUFBZSxrQkFBa0Isa0JBQWtCLGtCQUFrQixrQkFBa0Isa0JBQWtCLG1CQUFtQjtBQUFBLElBQ3pLLE1BQU0sQ0FBQyxTQUFTLGVBQWUsZUFBZSxrQkFBa0Isa0JBQWtCLHFCQUFxQixrQkFBa0Isa0JBQWtCLGtCQUFrQixtQkFBbUI7QUFBQSxJQUNoTCxXQUFXLENBQUMsWUFBWSxlQUFlLGtCQUFrQixrQkFBa0Isa0JBQWtCLHFCQUFxQixxQkFBcUIsa0JBQWtCLHFCQUFxQixtQkFBbUI7QUFBQSxFQUNuTTtBQVNPLE1BQUksaUJBQWlCO0FBR3JCLE1BQU0sV0FBMEIsV0FBVyxPQUFPLElBQUksU0FBUztBQUUvRCxXQUFTLGNBQWMsTUFBb0I7QUFDaEQsUUFBSSxDQUFDLFdBQVcsSUFBSSxFQUFHO0FBQ3ZCLHFCQUFpQjtBQUFNLGFBQVMsU0FBUztBQUFHLGVBQVcsSUFBSSxFQUFFLFFBQVEsQ0FBQyxNQUFNLFNBQVMsS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDO0FBQUEsRUFDekc7QUFLTyxXQUFTLFVBQVUsTUFBYyxZQUFZLEdBQWdCO0FBQ2xFLFFBQUksUUFBUSxTQUFTLE9BQVEsUUFBTyxTQUFTLE9BQU8sQ0FBQyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFLEVBQUU7QUFDNUUsVUFBTSxNQUFNLE9BQU8sSUFBSSxLQUFLLElBQUksTUFBTSxPQUFPLElBQUksTUFBTSxJQUFJLENBQUM7QUFDNUQsVUFBTSxTQUFTLEtBQUssTUFBTSxNQUFNLElBQUk7QUFDcEMsVUFBTSxNQUFNLFFBQVEsWUFBWSxPQUFPLE9BQU8sSUFBSTtBQUNsRCxVQUFNLE9BQW9CLENBQUM7QUFDM0IsUUFBSSxPQUFPO0FBQ1gsYUFBUyxRQUFRLEdBQUcsUUFBUSxNQUFNLFFBQVEsR0FBRyxTQUFTO0FBQ3BELFlBQU0sT0FBTyxJQUFJLEtBQUssS0FBSztBQUMzQixVQUFJLE9BQU87QUFDWCxVQUFJLElBQUksS0FBSyxJQUFJLFFBQVEsS0FBSyxJQUFJLEVBQUUsQ0FBQyxLQUFLLEtBQU0sUUFBTztBQUN2RCxVQUFJLFFBQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxRQUFRLEtBQUssSUFBSSxFQUFFLENBQUMsS0FBSyxLQUFNLFFBQU87QUFDcEUsWUFBTSxJQUFJLEtBQUssSUFBSSxFQUFFLE9BQU8sQ0FBQztBQUM3QixVQUFJLEtBQUssUUFBUSxLQUFLLFNBQVMsSUFBSTtBQUFFLGFBQUssS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDO0FBQUcsZ0JBQVE7QUFBQSxNQUFHO0FBQUEsSUFDN0U7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUdPLFdBQVMsWUFBWSxHQUFpRTtBQUMzRixVQUFNLE1BQU0sb0JBQUksSUFBMkQ7QUFDM0UsZUFBVyxLQUFLLEdBQUc7QUFDakIsWUFBTSxJQUFJLEVBQUUsT0FBTyxFQUFFO0FBQ3JCLFlBQU0sTUFBTSxJQUFJLElBQUksQ0FBQztBQUNyQixVQUFJLElBQUssS0FBSTtBQUFBLFVBQWMsS0FBSSxJQUFJLEdBQUcsRUFBRSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsTUFBTSxPQUFPLEVBQUUsQ0FBQztBQUFBLElBQ2hGO0FBQ0EsV0FBTyxDQUFDLEdBQUcsSUFBSSxPQUFPLENBQUM7QUFBQSxFQUN6Qjs7O0FDOURPLE1BQU0sa0JBQXlCLEVBQUUsT0FBTyxPQUFPLEtBQUssT0FBTyxtQkFBbUIsWUFBWSxJQUFJLGlCQUFpQixDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUMsRUFBRTs7O0FDSDVILE1BQU0sWUFBWTtBQUN6QixNQUFNLE1BQU07QUFDWixNQUFNLFVBQVU7QUFHVCxNQUFNLGVBQTZCLENBQUMsUUFBUSxVQUFVLFFBQVEsV0FBVztBQVl6RSxXQUFTLGNBQW9CO0FBQ2xDLFVBQU0sUUFBUSxDQUFDO0FBQ2YsZUFBVyxNQUFNLE1BQU8sT0FBTSxFQUFFLElBQUksRUFBRSxPQUFPLEdBQUcsUUFBUSxFQUFFO0FBQzFELFdBQU8sRUFBRSxHQUFHLFNBQVMsTUFBTSxNQUFNLE1BQU0sR0FBRyxTQUFTLEdBQUcsT0FBTyxVQUFVLEVBQUUsT0FBTyxNQUFNLEtBQUssS0FBSyxHQUFHLFlBQVksU0FBUztBQUFBLEVBQzFIO0FBRUEsV0FBUyxlQUE2QjtBQUFFLFFBQUk7QUFBRSxhQUFPLE9BQU8saUJBQWlCLGNBQWMsT0FBTztBQUFBLElBQWMsUUFBUTtBQUFFLGFBQU87QUFBQSxJQUFNO0FBQUEsRUFBRTtBQUdsSSxXQUFTLFNBQVMsS0FBZ0I7QUFDdkMsVUFBTSxPQUFPLFlBQVk7QUFDekIsUUFBSSxDQUFDLE9BQU8sT0FBTyxRQUFRLFNBQVUsUUFBTztBQUM1QyxVQUFNLE9BQWlCLENBQUM7QUFDeEIsUUFBSSxNQUFNLFFBQVEsSUFBSSxJQUFJO0FBQUcsaUJBQVcsS0FBSyxJQUFJLEtBQU0sS0FBSSxNQUFNLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxTQUFTLENBQUMsS0FBSyxLQUFLLFNBQVMsVUFBVyxNQUFLLEtBQUssQ0FBQztBQUFBO0FBQ3pJLFFBQUksS0FBSyxPQUFRLE1BQUssT0FBTztBQUM3QixRQUFJLElBQUksU0FBUyxPQUFPLElBQUksVUFBVSxVQUFVO0FBQzlDLGlCQUFXLE1BQU0sT0FBTztBQUN0QixjQUFNLElBQUksSUFBSSxNQUFNLEVBQUU7QUFDdEIsWUFBSSxLQUFLLE9BQU8sU0FBUyxFQUFFLEtBQUssS0FBSyxPQUFPLFNBQVMsRUFBRSxNQUFNLEVBQUcsTUFBSyxNQUFNLEVBQUUsSUFBSSxFQUFFLE9BQU8sS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLEVBQUUsS0FBSyxDQUFDLEdBQUcsUUFBUSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sRUFBRSxNQUFNLENBQUMsRUFBRTtBQUFBLE1BQ3hLO0FBQUEsSUFDRjtBQUNBLFFBQUksSUFBSSxZQUFZLE9BQU8sSUFBSSxhQUFhLFVBQVU7QUFDcEQsVUFBSSxPQUFPLElBQUksU0FBUyxVQUFVLFVBQVcsTUFBSyxTQUFTLFFBQVEsSUFBSSxTQUFTO0FBQ2hGLFVBQUksT0FBTyxJQUFJLFNBQVMsUUFBUSxVQUFXLE1BQUssU0FBUyxNQUFNLElBQUksU0FBUztBQUFBLElBQzlFO0FBQ0EsUUFBSSxhQUFhLFNBQVMsSUFBSSxVQUFVLEVBQUcsTUFBSyxhQUFhLElBQUk7QUFDakUsV0FBTztBQUFBLEVBQ1Q7QUFFTyxXQUFTLFNBQVMsUUFBc0IsYUFBYSxHQUFTO0FBQ25FLFFBQUk7QUFBRSxZQUFNLElBQUksU0FBUyxNQUFNLFFBQVEsR0FBRztBQUFHLGFBQU8sU0FBUyxJQUFJLEtBQUssTUFBTSxDQUFDLElBQUksSUFBSTtBQUFBLElBQUcsUUFBUTtBQUFFLGFBQU8sWUFBWTtBQUFBLElBQUc7QUFBQSxFQUMxSDtBQUVPLFdBQVMsVUFBVSxNQUFZLFFBQXNCLGFBQWEsR0FBUztBQUNoRixRQUFJO0FBQUUsVUFBSSxNQUFPLE9BQU0sUUFBUSxLQUFLLEtBQUssVUFBVSxJQUFJLENBQUM7QUFBQSxJQUFHLFFBQVE7QUFBQSxJQUE4QztBQUFBLEVBQ25IO0FBR08sV0FBUyxlQUFlLE9BQTBCLFFBQXNCLGFBQWEsR0FBYTtBQUN2RyxVQUFNLElBQUksU0FBUyxLQUFLO0FBQUcsTUFBRSxXQUFXLEVBQUUsR0FBRyxFQUFFLFVBQVUsR0FBRyxNQUFNO0FBQUcsY0FBVSxHQUFHLEtBQUs7QUFBRyxXQUFPLEVBQUU7QUFBQSxFQUNyRzs7O0FDMURPLE1BQU0sY0FBTixNQUFrQjtBQUFBLElBS3ZCLFlBQW9CLE9BQW9CLE1BQVc7QUFBL0I7QUFBb0I7QUFKeEM7QUFDQTtBQUFBLDBCQUFRO0FBQVUsMEJBQVE7QUFBaUIsMEJBQVE7QUFBYywwQkFBUTtBQUFpQiwwQkFBUTtBQUFjLDBCQUFRO0FBQWEsMEJBQVE7QUFBUywwQkFBUTtBQUM5SiwwQkFBUSxLQUFJO0FBQUcsMEJBQVEsU0FBUTtBQUFHLDBCQUFRLFNBQVE7QUFBRywwQkFBUSxRQUFPO0FBQUcsMEJBQVEsY0FBYTtBQUcxRixZQUFNLElBQUksT0FBTyxNQUFNLENBQUMsR0FBV0MsSUFBVyxHQUFXLEtBQUssR0FBRyxLQUFLLEdBQUcsS0FBSyxNQUFNO0FBQ2xGLGNBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sQ0FBQztBQUFHLFVBQUUsZUFBZSxJQUFJLFFBQVEsT0FBTyxHQUFHQSxJQUFHLENBQUM7QUFBRyxVQUFFLGdCQUFnQixJQUFJLFFBQVEsT0FBTyxJQUFJLElBQUksRUFBRTtBQUFHLFVBQUUsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQUcsZUFBTztBQUFBLE1BQ3BNO0FBQ0EsWUFBTSxVQUFVLENBQUMsR0FBV0EsSUFBVyxHQUFXLElBQUksTUFBTTtBQUFFLGNBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sQ0FBQztBQUFHLFVBQUUsZUFBZSxRQUFRLE9BQU8sTUFBTTtBQUFHLFVBQUUsZ0JBQWdCLElBQUksUUFBUSxPQUFPLEdBQUdBLElBQUcsQ0FBQztBQUFHLFVBQUUsa0JBQWtCO0FBQU0sVUFBRSxRQUFRO0FBQUcsZUFBTztBQUFBLE1BQUc7QUFDeFAsV0FBSyxTQUFTLElBQUksUUFBUSxjQUFjLFNBQVMsQ0FBQztBQUFHLFdBQUssTUFBTSxJQUFJLFFBQVEsY0FBYyxZQUFZLENBQUM7QUFBRyxXQUFLLElBQUksU0FBUyxLQUFLO0FBQ2pJLFlBQU0sTUFBTSxDQUFDLE1BQVcsU0FBUyxLQUFLLFFBQVE7QUFBRSxhQUFLLFNBQVM7QUFBUSxhQUFLLGFBQWE7QUFBTyxlQUFPO0FBQUEsTUFBTTtBQUM1RyxXQUFLLFVBQVUsSUFBSSxNQUFNLE1BQU0sTUFBTSxNQUFNLE1BQU0sR0FBRztBQUNwRCxZQUFNLE9BQU8sSUFBSSxRQUFRLFlBQVksZUFBZSxRQUFRLEVBQUUsUUFBUSxNQUFNLGFBQWEsS0FBSyxnQkFBZ0IsS0FBSyxjQUFjLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFBRyxXQUFLLFNBQVMsSUFBSTtBQUFNLFdBQUssV0FBVyxLQUFLO0FBQ3pMLFlBQU0sTUFBTSxJQUFJLFFBQVEsWUFBWSxZQUFZLE9BQU8sRUFBRSxVQUFVLE1BQU0sV0FBVyxPQUFPLGNBQWMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUFHLFVBQUksU0FBUyxJQUFJO0FBQU0sVUFBSSxXQUFXLFFBQVEsS0FBSyxLQUFLLElBQUk7QUFDaEwsWUFBTSxTQUFTLElBQUksUUFBUSxZQUFZLGFBQWEsVUFBVSxFQUFFLFVBQVUsS0FBSyxVQUFVLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFBRyxhQUFPLFFBQVEsSUFBSSxHQUFHLEtBQUssR0FBRztBQUFHLGFBQU8sU0FBUyxJQUFJO0FBQUssYUFBTyxXQUFXLEtBQUs7QUFDckwsWUFBTSxPQUFPLElBQUksUUFBUSxZQUFZLGFBQWEsUUFBUSxFQUFFLFVBQVUsTUFBTSxVQUFVLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFBRyxXQUFLLFNBQVMsSUFBSTtBQUFLLFdBQUssV0FBVyxLQUFLO0FBQzdJLFlBQU0sTUFBTSxJQUFJLFFBQVEsWUFBWSxlQUFlLE9BQU8sRUFBRSxRQUFRLEtBQUssYUFBYSxHQUFHLGdCQUFnQixNQUFNLGNBQWMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUFHLFVBQUksU0FBUyxJQUFJLEdBQUcsTUFBTSxLQUFLO0FBQUcsVUFBSSxTQUFTLElBQUk7QUFBTyxVQUFJLFdBQVcsS0FBSztBQUN0TixZQUFNLE9BQU8sSUFBSSxRQUFRLFlBQVksYUFBYSxRQUFRLEVBQUUsVUFBVSxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUFHLFdBQUssU0FBUyxJQUFJLEdBQUcsTUFBTSxJQUFJO0FBQUcsV0FBSyxXQUFXLElBQUksTUFBTSxHQUFHLElBQUk7QUFDcEssV0FBSyxTQUFTLFFBQVEsS0FBSyxLQUFLLENBQUM7QUFDakMsaUJBQVcsS0FBSyxDQUFDLFFBQVEsS0FBSyxHQUFHO0FBQUUsY0FBTSxJQUFJLElBQUksUUFBUSxZQUFZLGFBQWEsT0FBTyxFQUFFLFVBQVUsT0FBTyxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFBRyxVQUFFLFNBQVMsSUFBSSxHQUFHLEdBQUssS0FBSztBQUFHLFVBQUUsUUFBUSxJQUFJO0FBQUssVUFBRSxXQUFXLEtBQUs7QUFBQSxNQUFRO0FBQzVNLFdBQUssT0FBTyxJQUFJLFFBQVEsWUFBWSxZQUFZLFdBQVcsRUFBRSxNQUFNLElBQUksR0FBRyxDQUFDLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxJQUFJLEdBQUcsR0FBSyxJQUFJO0FBQUcsV0FBSyxLQUFLLGdCQUFnQixRQUFRLEtBQUs7QUFDNUosWUFBTSxLQUFLLFFBQVEsS0FBSyxNQUFNLEdBQUcsSUFBSTtBQUFHLFNBQUcsa0JBQWtCO0FBQU0sU0FBRyxpQkFBaUI7QUFBTSxXQUFLLEtBQUssV0FBVztBQUNsSCxZQUFNLE9BQU8sSUFBSSxRQUFRLFlBQVksYUFBYSxRQUFRLEVBQUUsVUFBVSxNQUFNLFVBQVUsRUFBRSxHQUFHLENBQUMsQ0FBQztBQUFHLFdBQUssU0FBUyxJQUFJLE9BQU8sTUFBTSxJQUFJO0FBQUcsV0FBSyxXQUFXLElBQUksS0FBSyxNQUFNLElBQUk7QUFFekssV0FBSyxhQUFhLElBQUksSUFBSSxRQUFRLGNBQWMsY0FBYyxDQUFDLENBQUM7QUFBRyxXQUFLLFdBQVcsU0FBUyxJQUFJLE1BQU0sS0FBSyxJQUFJO0FBQy9HLFlBQU0sTUFBTSxJQUFJLFFBQVEsWUFBWSxlQUFlLE9BQU8sRUFBRSxRQUFRLEtBQUssVUFBVSxPQUFPLGNBQWMsRUFBRSxHQUFHLENBQUMsR0FBRyxLQUFLLFVBQVU7QUFBRyxVQUFJLFNBQVMsSUFBSTtBQUFNLFVBQUksV0FBVyxJQUFJLE1BQU0sTUFBTSxHQUFHO0FBQzVMLFdBQUssYUFBYSxRQUFRLE1BQU0sTUFBTSxDQUFDO0FBQ3ZDLFdBQUssVUFBVSxJQUFJLFFBQVEsWUFBWSxpQkFBaUIsV0FBVyxFQUFFLE1BQU0sR0FBRyxNQUFNLEtBQUssR0FBRyxDQUFDLEdBQUcsS0FBSyxVQUFVO0FBQUcsV0FBSyxRQUFRLFNBQVMsSUFBSTtBQUFNLFdBQUssUUFBUSxRQUFRLElBQUk7QUFBSyxXQUFLLFFBQVEsU0FBUyxJQUFJO0FBQUssV0FBSyxRQUFRLFdBQVcsS0FBSztBQUM1TyxZQUFNLE9BQU8sSUFBSSxRQUFRLFlBQVksV0FBVyxRQUFRLEVBQUUsUUFBUSxNQUFNLGNBQWMsR0FBRyxHQUFHLENBQUMsR0FBRyxLQUFLLE1BQU07QUFBRyxXQUFLLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxXQUFLLFNBQVMsSUFBSTtBQUFNLFdBQUssV0FBVyxRQUFRLEtBQUssTUFBTSxNQUFNLElBQUk7QUFFbE4sWUFBTSxLQUFLLEtBQUssS0FBSyxJQUFJLFFBQVEsZUFBZSxhQUFhLElBQUksQ0FBQztBQUFHLFNBQUcsa0JBQWtCO0FBQU0sU0FBRyxVQUFVLEtBQUs7QUFDbEgsU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLE1BQU0sR0FBRyxJQUFJO0FBQUcsU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLEtBQUssS0FBSyxHQUFHO0FBQUcsU0FBRyxjQUFjO0FBQUssU0FBRyxjQUFjO0FBQy9JLFNBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxPQUFPLEtBQUssS0FBSztBQUFHLFNBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxNQUFNLEtBQUssSUFBSTtBQUFHLFNBQUcsZUFBZTtBQUFLLFNBQUcsZUFBZTtBQUFLLFNBQUcsVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssQ0FBQztBQUN0TSxTQUFHLFVBQVU7QUFBTSxTQUFHLFVBQVU7QUFBSyxTQUFHLFdBQVc7QUFBSSxTQUFHLFNBQVMsSUFBSSxRQUFRLE9BQU8sS0FBSyxNQUFNLEdBQUcsR0FBRztBQUFHLFNBQUcsU0FBUyxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sS0FBSyxHQUFHO0FBQUcsU0FBRyxZQUFZLElBQUksUUFBUSxPQUFPLEtBQUssR0FBRyxLQUFLLENBQUM7QUFDaE4sU0FBRyxZQUFZLFFBQVEsZUFBZTtBQUFlLFNBQUcsTUFBTTtBQUFBLElBQ2hFO0FBQUEsSUFFQSxXQUFXLElBQWE7QUFBRSxXQUFLLE9BQU8sV0FBVyxFQUFFO0FBQUcsVUFBSSxHQUFJLE1BQUssR0FBRyxNQUFNO0FBQUEsVUFBUSxNQUFLLEdBQUcsS0FBSztBQUFBLElBQUc7QUFBQTtBQUFBLElBRXBHLGFBQWtCO0FBQUUsV0FBSyxPQUFPLG1CQUFtQixJQUFJO0FBQUcsV0FBSyxJQUFJLG1CQUFtQixJQUFJO0FBQUcsV0FBSyxXQUFXLG1CQUFtQixJQUFJO0FBQUcsV0FBSyxRQUFRLG1CQUFtQixJQUFJO0FBQUcsYUFBTyxLQUFLLFFBQVEsb0JBQW9CLEVBQUUsTUFBTTtBQUFBLElBQUc7QUFBQSxJQUVqTyxPQUFPO0FBQUUsV0FBSyxRQUFRO0FBQUEsSUFBSztBQUFBLElBQzNCLE9BQU87QUFBRSxXQUFLLFFBQVE7QUFBQSxJQUFLO0FBQUE7QUFBQSxJQUUzQixTQUFTO0FBQUUsV0FBSyxhQUFhO0FBQUEsSUFBRztBQUFBLElBQ2hDLFNBQVM7QUFBRSxXQUFLLGFBQWE7QUFBRyxXQUFLLFFBQVE7QUFBRyxXQUFLLFFBQVE7QUFBQSxJQUFHO0FBQUEsSUFFaEUsT0FBTyxJQUFZO0FBQ2pCLFdBQUssS0FBSztBQUNWLFdBQUssU0FBUyxLQUFLLGFBQWEsS0FBSyxRQUFRLEtBQUssSUFBSSxHQUFHLEtBQUssQ0FBQztBQUMvRCxZQUFNLE1BQU0sS0FBSyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksU0FBUyxJQUFJLEtBQUs7QUFDckQsVUFBSSxTQUFTLEdBQUcsUUFBUTtBQUN4QixVQUFJLEtBQUssUUFBUSxHQUFHO0FBQUUsYUFBSyxRQUFRLEtBQUssSUFBSSxHQUFHLEtBQUssUUFBUSxFQUFFO0FBQUcsY0FBTSxJQUFJLEtBQUssUUFBUTtBQUFLLGlCQUFTLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJO0FBQU0sZ0JBQVE7QUFBQSxNQUFHO0FBQy9JLFVBQUksUUFBUTtBQUNaLFVBQUksS0FBSyxRQUFRLEdBQUc7QUFBRSxhQUFLLFFBQVEsS0FBSyxJQUFJLEdBQUcsS0FBSyxRQUFRLEVBQUU7QUFBRyxjQUFNLElBQUksS0FBSyxRQUFRO0FBQUssZ0JBQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxHQUFHLElBQUksS0FBSyxLQUFLLEdBQUcsS0FBSyxJQUFJLE9BQU8sSUFBSSxJQUFJO0FBQUEsTUFBTztBQUN2TCxXQUFLLElBQUksU0FBUyxJQUFJLE1BQU0sT0FBTyxLQUFLO0FBQU0sV0FBSyxJQUFJLFNBQVMsSUFBSSxDQUFDLFNBQVMsTUFBTSxLQUFLO0FBQU0sV0FBSyxJQUFJLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLFFBQVEsRUFBRSxJQUFJLFFBQVEsS0FBSyxRQUFRLElBQUksSUFBSTtBQUM5TSxXQUFLLFdBQVcsU0FBUyxJQUFJLFFBQVEsUUFBUTtBQUFNLFdBQUssV0FBVyxTQUFTLElBQUksUUFBUTtBQUFPLFdBQUssV0FBVyxTQUFTLElBQUksTUFBTSxPQUFPO0FBQ3pJLFdBQUssUUFBUSxTQUFTLEtBQUssTUFBTSxJQUFJLElBQUk7QUFBUSxZQUFNLFFBQVEsSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLElBQUksQ0FBQyxJQUFJLE1BQU07QUFBTyxXQUFLLFFBQVEsUUFBUSxJQUFJLE9BQU8sTUFBTSxPQUFPLEtBQUs7QUFDaEssWUFBTSxNQUFNLElBQUksT0FBTyxLQUFLO0FBQzVCLFdBQUssV0FBVyxjQUFjLEtBQUssT0FBTyxPQUFPLFNBQVMsTUFBTSxPQUFPLE1BQU0sU0FBUyxLQUFLLElBQUksR0FBRztBQUNsRyxXQUFLLE9BQU8sY0FBYyxJQUFJLE1BQU0sTUFBTSxRQUFRLE1BQU0sTUFBTSxPQUFPLFNBQVMsT0FBTyxJQUFJLFFBQVEsTUFBTSxJQUFJLE9BQU8sSUFBSSxRQUFRLElBQUk7QUFDbEksV0FBSyxRQUFRLGNBQWMsSUFBSSxPQUFPLFFBQVEsS0FBSyxNQUFNLE9BQU8sSUFBSSxNQUFNO0FBQzFFLFdBQUssS0FBSyxRQUFRLE9BQU8sTUFBTSxNQUFNLE1BQU0sUUFBUSxHQUFHO0FBQ3RELFdBQUssR0FBRyxZQUFZLEtBQUssS0FBSyxTQUFTO0FBQUEsSUFDekM7QUFBQSxJQUVBLFVBQVU7QUFBRSxXQUFLLEdBQUcsS0FBSztBQUFHLFdBQUssR0FBRyxRQUFRO0FBQUcsV0FBSyxPQUFPLGVBQWUsRUFBRSxRQUFRLENBQUMsTUFBVyxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssT0FBTyxRQUFRO0FBQUEsSUFBRztBQUFBLEVBQ3ZJOzs7QUNoRUEsTUFBTSxTQUFxQjtBQUFBLElBQ3pCLENBQUMsS0FBSyxRQUFRLEtBQUssUUFBUSxNQUFNO0FBQUEsSUFDakMsQ0FBQyxPQUFPLFFBQVEsUUFBUSxLQUFLLE1BQU07QUFBQSxJQUNuQyxDQUFDLFFBQVEsS0FBSyxRQUFRLFFBQVEsR0FBRztBQUFBLElBQ2pDLENBQUMsT0FBTyxRQUFRLFFBQVEsUUFBUSxNQUFNO0FBQUEsRUFDeEM7QUFDQSxNQUFNLE9BQU8sS0FBSztBQUVsQixNQUFNLGNBQU4sTUFBa0I7QUFBQSxJQU1oQixjQUFjO0FBTGQsMEJBQVEsT0FBMkI7QUFDbkMsMEJBQVE7QUFBbUIsMEJBQVE7QUFBcUIsMEJBQVE7QUFBbUIsMEJBQVE7QUFDM0YsbUNBQVE7QUFBTSxpQ0FBTTtBQUFNLGtDQUFhO0FBQ3ZDLDBCQUFRLFNBQVE7QUFBRywwQkFBUSxTQUFRO0FBQUcsMEJBQVEsUUFBTztBQUFHLDBCQUFRLFVBQWlDLENBQUM7QUFJbEcsMEJBQVEsVUFBa0M7QUFBTSwwQkFBUSxVQUFTO0FBRmpELFlBQU0sSUFBSSxTQUFTLEVBQUU7QUFBVSxXQUFLLFFBQVEsRUFBRTtBQUFPLFdBQUssTUFBTSxFQUFFO0FBQUEsSUFBSztBQUFBO0FBQUE7QUFBQSxJQUsvRSxrQkFBa0I7QUFDeEIsVUFBSTtBQUFFLGNBQU0sSUFBSyxVQUFrQjtBQUFjLFlBQUksRUFBRyxHQUFFLE9BQU87QUFBQSxNQUFZLFFBQVE7QUFBQSxNQUFzQjtBQUMzRyxVQUFJLEtBQUssT0FBUTtBQUNqQixVQUFJO0FBQ0YsY0FBTSxJQUFJLEtBQUssTUFBTSxJQUFJLFlBQVksS0FBSyxJQUFJLENBQUMsR0FBRyxJQUFJLElBQUksU0FBUyxHQUFHLEdBQUcsTUFBTSxDQUFDLEdBQVcsTUFBYztBQUFFLG1CQUFTLElBQUksR0FBRyxJQUFJLEVBQUUsUUFBUSxJQUFLLEdBQUUsU0FBUyxJQUFJLEdBQUcsRUFBRSxXQUFXLENBQUMsQ0FBQztBQUFBLFFBQUc7QUFDbEwsWUFBSSxHQUFHLE1BQU07QUFBRyxVQUFFLFVBQVUsR0FBRyxLQUFLLElBQUksR0FBRyxJQUFJO0FBQUcsWUFBSSxHQUFHLE1BQU07QUFBRyxZQUFJLElBQUksTUFBTTtBQUFHLFVBQUUsVUFBVSxJQUFJLElBQUksSUFBSTtBQUFHLFVBQUUsVUFBVSxJQUFJLEdBQUcsSUFBSTtBQUFHLFVBQUUsVUFBVSxJQUFJLEdBQUcsSUFBSTtBQUMvSixVQUFFLFVBQVUsSUFBSSxPQUFPLElBQUk7QUFBRyxVQUFFLFVBQVUsSUFBSSxPQUFPLElBQUk7QUFBRyxVQUFFLFVBQVUsSUFBSSxHQUFHLElBQUk7QUFBRyxVQUFFLFVBQVUsSUFBSSxJQUFJLElBQUk7QUFBRyxZQUFJLElBQUksTUFBTTtBQUFHLFVBQUUsVUFBVSxJQUFJLElBQUksR0FBRyxJQUFJO0FBQzdKLGNBQU0sS0FBSyxJQUFJLE1BQU0sSUFBSSxnQkFBZ0IsSUFBSSxLQUFLLENBQUMsR0FBRyxHQUFHLEVBQUUsTUFBTSxZQUFZLENBQUMsQ0FBQyxDQUFDO0FBQUcsV0FBRyxPQUFPO0FBQU0sV0FBRyxTQUFTO0FBQU0sV0FBRyxhQUFhLGVBQWUsRUFBRTtBQUFHLGFBQUssU0FBUztBQUN2SyxXQUFHLEtBQUssRUFBRSxNQUFNLE1BQU07QUFBRSxlQUFLLFNBQVM7QUFBQSxRQUFNLENBQUM7QUFBQSxNQUMvQyxRQUFRO0FBQUEsTUFBZ0U7QUFBQSxJQUMxRTtBQUFBO0FBQUEsSUFFQSxTQUErQztBQUFFLGFBQU8sRUFBRSxPQUFPLEtBQUssTUFBTSxLQUFLLElBQUksUUFBUSxlQUFlLFVBQVUsQ0FBQyxDQUFDLEtBQUssT0FBTyxLQUFLLElBQUksVUFBVSxVQUFVO0FBQUEsSUFBRztBQUFBO0FBQUEsSUFFcEssT0FBTztBQUFFLFdBQUssT0FBTztBQUFHLFlBQU0sSUFBSSxNQUFNO0FBQUUsYUFBSyxLQUFLLFNBQVM7QUFBQSxNQUFHO0FBQUcsVUFBSSxLQUFLLE9BQU8sS0FBSyxJQUFJLFVBQVUsVUFBVyxNQUFLLElBQUksT0FBTyxFQUFFLEtBQUssQ0FBQyxFQUFFLE1BQU0sTUFBTTtBQUFBLE1BQUMsQ0FBQztBQUFBLFVBQVEsR0FBRTtBQUFBLElBQUc7QUFBQTtBQUFBLElBR3RLLFNBQVM7QUFDUCxXQUFLLGdCQUFnQjtBQUNyQixVQUFJLENBQUMsS0FBSyxLQUFLO0FBQ2IsY0FBTSxJQUFLLE9BQWUsZ0JBQWlCLE9BQWU7QUFBb0IsWUFBSSxDQUFDLEVBQUc7QUFDdEYsY0FBTSxNQUFvQixLQUFLLE1BQU0sSUFBSSxFQUFFO0FBQzNDLGNBQU0sT0FBTyxJQUFJLHlCQUF5QjtBQUFHLGFBQUssUUFBUSxJQUFJLFdBQVc7QUFDekUsYUFBSyxTQUFTLElBQUksV0FBVztBQUFHLGFBQUssT0FBTyxLQUFLLFFBQVE7QUFBSyxhQUFLLE9BQU8sUUFBUSxJQUFJO0FBQ3RGLGFBQUssV0FBVyxJQUFJLFdBQVc7QUFBRyxhQUFLLFNBQVMsUUFBUSxLQUFLLE1BQU07QUFBRyxhQUFLLFNBQVMsSUFBSSxXQUFXO0FBQUcsYUFBSyxPQUFPLFFBQVEsS0FBSyxNQUFNO0FBQ3JJLFlBQUksZ0JBQWdCLE1BQU07QUFBRSxpQkFBTyxjQUFjLElBQUksTUFBTSxtQkFBbUIsQ0FBQztBQUFBLFFBQUc7QUFDbEYsY0FBTSxNQUFNLElBQUk7QUFBWSxhQUFLLFdBQVcsSUFBSSxhQUFhLEdBQUcsS0FBSyxJQUFJLFVBQVU7QUFBRyxjQUFNLElBQUksS0FBSyxTQUFTLGVBQWUsQ0FBQztBQUFHLGlCQUFTLElBQUksR0FBRyxJQUFJLEtBQUssSUFBSyxHQUFFLENBQUMsSUFBSSxLQUFLLE9BQU8sSUFBSSxJQUFJO0FBQUEsTUFDNUw7QUFDQSxVQUFJLEtBQUssSUFBSSxVQUFVLFVBQVcsTUFBSyxJQUFJLE9BQU8sRUFBRSxNQUFNLE1BQU07QUFBQSxNQUFDLENBQUM7QUFDbEUsVUFBSSxDQUFDLEtBQUssUUFBUTtBQUFFLGFBQUssU0FBUztBQUFNLFlBQUk7QUFBRSxnQkFBTSxJQUFJLEtBQUssSUFBSSxhQUFhLEdBQUcsR0FBRyxLQUFLLEdBQUcsSUFBSSxLQUFLLElBQUksbUJBQW1CO0FBQUcsWUFBRSxTQUFTO0FBQUcsWUFBRSxRQUFRLEtBQUssSUFBSSxXQUFXO0FBQUcsWUFBRSxNQUFNLENBQUM7QUFBQSxRQUFHLFFBQVE7QUFBQSxRQUFlO0FBQUEsTUFBRTtBQUNuTixXQUFLLFdBQVc7QUFBRyxXQUFLLFVBQVU7QUFBQSxJQUNwQztBQUFBLElBRUEsU0FBUyxJQUFhO0FBQUUsV0FBSyxRQUFRO0FBQUkscUJBQWUsRUFBRSxPQUFPLEdBQUcsQ0FBQztBQUFHLFdBQUssV0FBVztBQUFHLFdBQUssVUFBVTtBQUFHLGFBQU8sY0FBYyxJQUFJLE1BQU0sZ0JBQWdCLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDaEssT0FBTyxJQUFhO0FBQUUsV0FBSyxNQUFNO0FBQUkscUJBQWUsRUFBRSxLQUFLLEdBQUcsQ0FBQztBQUFHLFdBQUssV0FBVztBQUFHLGFBQU8sY0FBYyxJQUFJLE1BQU0sZ0JBQWdCLENBQUM7QUFBRyxVQUFJLEdBQUksTUFBSyxLQUFLLEtBQUs7QUFBQSxJQUFHO0FBQUE7QUFBQSxJQUVsSyxTQUFTO0FBQUUsWUFBTSxJQUFJLFNBQVMsRUFBRTtBQUFVLFdBQUssUUFBUSxFQUFFO0FBQU8sV0FBSyxNQUFNLEVBQUU7QUFBSyxXQUFLLFdBQVc7QUFBRyxXQUFLLFVBQVU7QUFBQSxJQUFHO0FBQUEsSUFDdkgsUUFBUSxHQUFTO0FBQUUsV0FBSyxPQUFPO0FBQUEsSUFBRztBQUFBLElBRTFCLGFBQWE7QUFDbkIsVUFBSSxDQUFDLEtBQUssSUFBSztBQUFRLFlBQU0sSUFBSSxLQUFLLElBQUk7QUFDMUMsV0FBSyxTQUFTLEtBQUssZ0JBQWdCLEtBQUssUUFBUSxNQUFNLEdBQUcsR0FBRyxJQUFJO0FBQUcsV0FBSyxPQUFPLEtBQUssZ0JBQWdCLEtBQUssTUFBTSxNQUFNLEdBQUcsR0FBRyxJQUFJO0FBQUEsSUFDakk7QUFBQTtBQUFBLElBR1EsWUFBWTtBQUNsQixVQUFJLENBQUMsS0FBSyxJQUFLO0FBQ2YsVUFBSSxLQUFLLFNBQVMsQ0FBQyxLQUFLLE9BQU87QUFBRSxhQUFLLFFBQVEsS0FBSyxJQUFJLGNBQWM7QUFBTSxhQUFLLFFBQVEsT0FBTyxZQUFZLE1BQU0sS0FBSyxLQUFLLEdBQUcsR0FBRztBQUFBLE1BQUc7QUFDcEksVUFBSSxDQUFDLEtBQUssU0FBUyxLQUFLLE9BQU87QUFBRSxzQkFBYyxLQUFLLEtBQUs7QUFBRyxhQUFLLFFBQVE7QUFBQSxNQUFHO0FBQUEsSUFDOUU7QUFBQSxJQUNRLE9BQU87QUFDYixZQUFNLE1BQU0sS0FBSztBQUFNLFVBQUksSUFBSSxVQUFVLFdBQVc7QUFBRSxhQUFLLFFBQVEsSUFBSSxjQUFjO0FBQU07QUFBQSxNQUFRO0FBQ25HLGFBQU8sS0FBSyxRQUFRLElBQUksY0FBYyxLQUFLO0FBQUUsYUFBSyxTQUFTLEtBQUssTUFBTSxLQUFLLEtBQUs7QUFBRyxhQUFLLFNBQVM7QUFBTSxhQUFLLFFBQVEsS0FBSyxPQUFPLEtBQUs7QUFBQSxNQUFJO0FBQUEsSUFDM0k7QUFBQSxJQUNRLFNBQVMsTUFBYyxHQUFXO0FBQ3hDLFlBQU0sUUFBUSxPQUFPLEtBQUssTUFBTSxPQUFPLENBQUMsQ0FBQyxHQUFHLFFBQVEsT0FBTyxHQUFHLFNBQVMsS0FBSyxTQUFTO0FBQ3JGLFVBQUksVUFBVSxFQUFHLFlBQVcsS0FBSyxNQUFPLE1BQUssTUFBTSxHQUFHLFlBQVksR0FBRyxPQUFPLElBQUksS0FBSyxPQUFPLEtBQUssR0FBRztBQUNwRyxVQUFJLFVBQVUsS0FBSyxVQUFVLEVBQUcsTUFBSyxNQUFNLE1BQU0sQ0FBQyxHQUFHLFFBQVEsR0FBRyxPQUFPLEtBQUssTUFBTSxNQUFNLEdBQUc7QUFDM0YsVUFBSSxRQUFRO0FBQ1YsYUFBSyxLQUFLLEdBQUcsSUFBSTtBQUFHLFlBQUksVUFBVSxFQUFHLE1BQUssS0FBSyxJQUFJLE9BQU8sS0FBSyxJQUFJO0FBQ25FLGFBQUssTUFBTSxJQUFJLE9BQU8sS0FBSyxNQUFNLE1BQU0sWUFBWSxHQUFJO0FBQUcsYUFBSyxNQUFNLElBQUksT0FBTyxNQUFNLE1BQU0sTUFBTSxNQUFNLFlBQVksR0FBSTtBQUN4SCxpQkFBUyxJQUFJLEdBQUcsSUFBSSxHQUFHLElBQUssTUFBSyxNQUFNLE1BQU0sS0FBTSxPQUFPLElBQUksS0FBSyxDQUFFLElBQUksR0FBRyxZQUFZLElBQUksSUFBSSxPQUFPLEdBQUcsTUFBTSxNQUFNLE1BQU8sSUFBSTtBQUFBLE1BQ25JO0FBQUEsSUFDRjtBQUFBLElBQ1EsTUFBTSxNQUFjLE1BQXNCLEdBQVcsS0FBYSxNQUFjLFFBQWdCLElBQVk7QUFDbEgsWUFBTSxNQUFNLEtBQUssS0FBTSxJQUFJLElBQUksaUJBQWlCLEdBQUdDLEtBQUksSUFBSSxXQUFXLEdBQUcsSUFBSSxJQUFJLG1CQUFtQjtBQUNwRyxRQUFFLE9BQU87QUFBTSxRQUFFLFVBQVUsUUFBUTtBQUFNLFFBQUUsT0FBTztBQUFXLFFBQUUsVUFBVSxRQUFRO0FBQ2pGLE1BQUFBLEdBQUUsS0FBSyxlQUFlLE1BQVEsQ0FBQztBQUFHLE1BQUFBLEdBQUUsS0FBSyx3QkFBd0IsTUFBTSxJQUFJLEtBQUssSUFBSSxNQUFPLE1BQU0sQ0FBQztBQUFHLE1BQUFBLEdBQUUsS0FBSyw2QkFBNkIsTUFBUSxJQUFJLEdBQUc7QUFDeEosUUFBRSxRQUFRLENBQUM7QUFBRyxRQUFFLFFBQVFBLEVBQUM7QUFBRyxNQUFBQSxHQUFFLFFBQVEsS0FBSyxRQUFRO0FBQUcsUUFBRSxNQUFNLENBQUM7QUFBRyxRQUFFLEtBQUssSUFBSSxNQUFNLElBQUk7QUFBQSxJQUN6RjtBQUFBLElBQ1EsS0FBSyxHQUFXLE1BQWM7QUFDcEMsWUFBTSxNQUFNLEtBQUssS0FBTSxJQUFJLElBQUksaUJBQWlCLEdBQUdBLEtBQUksSUFBSSxXQUFXO0FBQ3RFLFFBQUUsVUFBVSxlQUFlLEtBQUssQ0FBQztBQUFHLFFBQUUsVUFBVSw2QkFBNkIsSUFBSSxJQUFJLElBQUk7QUFBRyxNQUFBQSxHQUFFLEtBQUssZUFBZSxNQUFNLENBQUM7QUFBRyxNQUFBQSxHQUFFLEtBQUssNkJBQTZCLE1BQVEsSUFBSSxHQUFHO0FBQy9LLFFBQUUsUUFBUUEsRUFBQztBQUFHLE1BQUFBLEdBQUUsUUFBUSxLQUFLLFFBQVE7QUFBRyxRQUFFLE1BQU0sQ0FBQztBQUFHLFFBQUUsS0FBSyxJQUFJLElBQUk7QUFBQSxJQUNyRTtBQUFBLElBQ1EsTUFBTSxHQUFXLEtBQWEsTUFBYyxNQUF3QixNQUFjLE1BQWdCLEtBQUssVUFBVSxTQUFrQjtBQUN6SSxZQUFNLE1BQU0sS0FBSyxLQUFNLElBQUksSUFBSSxtQkFBbUIsR0FBRyxJQUFJLElBQUksbUJBQW1CLEdBQUdBLEtBQUksSUFBSSxXQUFXO0FBQ3RHLFFBQUUsU0FBUyxLQUFLO0FBQVUsUUFBRSxPQUFPO0FBQU0sUUFBRSxVQUFVLGVBQWUsTUFBTSxDQUFDO0FBQUcsVUFBSSxRQUFTLEdBQUUsVUFBVSw2QkFBNkIsU0FBUyxJQUFJLEdBQUc7QUFDcEosTUFBQUEsR0FBRSxLQUFLLGVBQWUsTUFBTSxDQUFDO0FBQUcsTUFBQUEsR0FBRSxLQUFLLDZCQUE2QixNQUFRLElBQUksR0FBRztBQUNuRixRQUFFLFFBQVEsQ0FBQztBQUFHLFFBQUUsUUFBUUEsRUFBQztBQUFHLE1BQUFBLEdBQUUsUUFBUSxHQUFHO0FBQUcsUUFBRSxNQUFNLEdBQUcsS0FBSyxPQUFPLElBQUksR0FBRztBQUFHLFFBQUUsS0FBSyxJQUFJLE1BQU0sSUFBSTtBQUFBLElBQ3BHO0FBQUE7QUFBQSxJQUdRLEtBQUssTUFBYyxLQUFhLE1BQXNCLE1BQWMsUUFBUSxHQUFHLFNBQWtCLFNBQVMsTUFBTyxLQUFLLEtBQU07QUFDbEksWUFBTSxNQUFNLEtBQUssS0FBTSxJQUFJLElBQUksY0FBYyxPQUFPLElBQUksSUFBSSxpQkFBaUIsR0FBR0EsS0FBSSxJQUFJLFdBQVcsR0FBRyxJQUFJLElBQUksbUJBQW1CO0FBQ2pJLFFBQUUsT0FBTztBQUFNLFFBQUUsVUFBVSxlQUFlLE1BQU0sQ0FBQztBQUFHLFVBQUksUUFBUyxHQUFFLFVBQVUsNkJBQTZCLFNBQVMsSUFBSSxHQUFHO0FBQzFILFFBQUUsT0FBTztBQUFXLFFBQUUsVUFBVSxRQUFRO0FBQUksTUFBQUEsR0FBRSxLQUFLLGVBQWUsTUFBUSxDQUFDO0FBQUcsTUFBQUEsR0FBRSxLQUFLLHdCQUF3QixNQUFNLElBQUksTUFBTTtBQUFHLE1BQUFBLEdBQUUsS0FBSyw2QkFBNkIsTUFBUSxJQUFJLEdBQUc7QUFDbkwsUUFBRSxRQUFRLENBQUM7QUFBRyxRQUFFLFFBQVFBLEVBQUM7QUFBRyxNQUFBQSxHQUFFLFFBQVEsS0FBSyxNQUFNO0FBQUcsUUFBRSxNQUFNLENBQUM7QUFBRyxRQUFFLEtBQUssSUFBSSxNQUFNLElBQUk7QUFBQSxJQUN2RjtBQUFBLElBQ1EsS0FBSyxLQUFhLE1BQWMsTUFBd0IsTUFBYyxRQUFRLEdBQUcsU0FBa0I7QUFBRSxXQUFLLE1BQU0sS0FBSyxJQUFLLGNBQWMsT0FBTyxLQUFLLE1BQU0sTUFBTSxNQUFNLEtBQUssUUFBUSxPQUFPO0FBQUEsSUFBRztBQUFBLElBQzdMLFNBQVMsS0FBYSxJQUFZO0FBQUUsWUFBTSxJQUFJLFlBQVksSUFBSTtBQUFHLFVBQUksS0FBSyxLQUFLLE9BQU8sR0FBRyxLQUFLLEtBQUssR0FBSSxRQUFPO0FBQU8sV0FBSyxPQUFPLEdBQUcsSUFBSTtBQUFHLGFBQU87QUFBQSxJQUFNO0FBQUEsSUFFaEssS0FBSyxNQUFXO0FBQ2QsVUFBSSxDQUFDLEtBQUssT0FBTyxDQUFDLEtBQUssT0FBTyxLQUFLLElBQUksVUFBVSxVQUFXO0FBQzVELGNBQVEsTUFBTTtBQUFBLFFBQ1osS0FBSztBQUFPLGNBQUksQ0FBQyxLQUFLLFNBQVMsT0FBTyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ2hHLEtBQUs7QUFBVSxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBSyxHQUFHLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksS0FBSyxHQUFHLEtBQUssTUFBTSxJQUFJO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLEtBQUssSUFBSTtBQUFHO0FBQUEsUUFDbEssS0FBSztBQUFTLFdBQUMsS0FBSyxLQUFLLEtBQUssSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLEtBQUssSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDdE8sS0FBSztBQUFPLGNBQUksQ0FBQyxLQUFLLFNBQVMsT0FBTyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxNQUFNLFdBQVcsSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsRUFBRTtBQUFHO0FBQUEsUUFDdEksS0FBSztBQUFZLGNBQUksQ0FBQyxLQUFLLFNBQVMsUUFBUSxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxNQUFNLFlBQVksR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxNQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDbEosS0FBSztBQUFTLGVBQUssS0FBSyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUcsRUFBRTtBQUFHLGVBQUssS0FBSyxNQUFNLE1BQU0sV0FBVyxLQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDdkcsS0FBSztBQUFTLGNBQUksQ0FBQyxLQUFLLFNBQVMsU0FBUyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxLQUFLLFlBQVksTUFBTSxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ3hHLEtBQUs7QUFBUyxjQUFJLENBQUMsS0FBSyxTQUFTLFNBQVMsRUFBRSxFQUFHO0FBQVEsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDaEgsS0FBSztBQUFRLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsS0FBSyxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLEtBQUssTUFBTSxNQUFNLElBQUk7QUFBRyxlQUFLLEtBQUssTUFBTSxNQUFNLFFBQVEsTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUM5SixLQUFLO0FBQVMsZUFBSyxLQUFLLEtBQUssS0FBSyxVQUFVLE1BQU0sR0FBRyxLQUFLLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQ25JLEtBQUs7QUFBYSxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsS0FBSyxHQUFHLElBQUksSUFBSTtBQUFHLGVBQUssS0FBSyxHQUFLLE1BQU0sV0FBVyxLQUFNLEdBQUcsR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxNQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDM0osS0FBSztBQUFhLFdBQUMsS0FBSyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksS0FBSyxJQUFJLE1BQU0sSUFBSSxNQUFNLEdBQUcsQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQ3pLLEtBQUs7QUFBYSxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxXQUFXLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFVBQVUsTUFBTSxNQUFNLEtBQUssTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUM1SyxLQUFLO0FBQVcsV0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxHQUFHO0FBQUc7QUFBQSxRQUN6SSxLQUFLO0FBQVUsV0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssSUFBSSxLQUFLLFFBQVEsS0FBSyxHQUFHO0FBQUc7QUFBQSxRQUN0SixLQUFLO0FBQVMsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxLQUFLLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFdBQVcsR0FBRztBQUFHO0FBQUEsTUFDN0s7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVPLE1BQU0sUUFBUSxJQUFJLFlBQVk7QUFDckMsRUFBQyxPQUFlLFVBQVU7QUFJMUIsTUFBTSxhQUFhLE1BQU0sTUFBTSxPQUFPO0FBQ3RDLGFBQVcsTUFBTSxDQUFDLGVBQWUsYUFBYSxZQUFZLFNBQVMsU0FBUyxFQUFHLFVBQVMsaUJBQWlCLElBQUksWUFBWSxFQUFFLFNBQVMsS0FBSyxDQUFDO0FBQzFJLFdBQVMsaUJBQWlCLFNBQVMsQ0FBQyxNQUFNO0FBQUUsVUFBTSxLQUFLLEVBQUU7QUFBOEIsUUFBSSxNQUFNLEdBQUcsV0FBVyxHQUFHLFFBQVEsd0JBQXdCLEVBQUcsT0FBTSxLQUFLLEtBQUs7QUFBQSxFQUFHLEdBQUcsSUFBSTtBQUMvSyxXQUFTLGlCQUFpQixvQkFBb0IsTUFBTTtBQUFFLFVBQU0sSUFBSyxNQUFjO0FBQTRCLFFBQUksQ0FBQyxFQUFHO0FBQVEsUUFBSSxTQUFTLE9BQVEsR0FBRSxRQUFRO0FBQUEsYUFBWSxNQUFNLFNBQVMsTUFBTSxJQUFLLEdBQUUsT0FBTztBQUFBLEVBQUcsQ0FBQztBQUM3TSxTQUFPLGlCQUFpQiwwQkFBMEIsTUFBTSxNQUFNLE9BQU8sQ0FBQzs7O0FDaEl0RSxNQUFNLE9BQW1CLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxHQUFHLENBQUM7QUFDekUsTUFBTSxPQUFPO0FBQUEsSUFDWCxFQUFFLE1BQU0sSUFBSSxLQUFLLE1BQU0sS0FBSyxNQUFNLElBQUksQ0FBQyxNQUFNLE1BQU0sR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLE1BQU0sTUFBTSxLQUFLLEdBQUcsRUFBRTtBQUFBLElBQ3ZGLEVBQUUsTUFBTSxJQUFJLEtBQUssTUFBTSxLQUFLLEtBQU0sSUFBSSxDQUFDLE1BQU0sTUFBTSxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFDcEYsRUFBRSxNQUFNLElBQUksS0FBSyxLQUFNLEtBQUssTUFBTSxJQUFJLENBQUMsR0FBRyxNQUFNLEtBQUssSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxFQUNyRjtBQVFBLFdBQVMsSUFBSSxPQUFZLEdBQVcsR0FBV0MsT0FBNkMsUUFBUSxNQUFNO0FBQ3hHLFVBQU0sSUFBSSxJQUFJLFFBQVEsZUFBZSxNQUFNLEVBQUUsT0FBTyxHQUFHLFFBQVEsRUFBRSxHQUFHLE9BQU8sSUFBSTtBQUFHLElBQUFBLE1BQUssRUFBRSxXQUFXLENBQUM7QUFBRyxNQUFFLE9BQU87QUFBRyxNQUFFLFdBQVc7QUFBTyxXQUFPO0FBQUEsRUFDako7QUFFQSxpQkFBc0IsV0FBVyxPQUE2QjtBQUM1RCxVQUFNLE9BQU8sSUFBSSxPQUFPLElBQUksSUFBSSxDQUFDLE1BQU07QUFBRSxZQUFNQyxLQUFJLEVBQUUscUJBQXFCLElBQUksSUFBSSxHQUFHLElBQUksSUFBSSxFQUFFO0FBQUcsTUFBQUEsR0FBRSxhQUFhLEdBQUcscUJBQXFCO0FBQUcsTUFBQUEsR0FBRSxhQUFhLEtBQUssdUJBQXVCO0FBQUcsTUFBQUEsR0FBRSxhQUFhLEdBQUcscUJBQXFCO0FBQUcsUUFBRSxZQUFZQTtBQUFHLFFBQUUsU0FBUyxHQUFHLEdBQUcsSUFBSSxFQUFFO0FBQUEsSUFBRyxDQUFDO0FBQ2hSLFVBQU0sVUFBVSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sSUFBSSxPQUFPLEtBQUssSUFBSSxDQUFDLE1BQU07QUFBRSxRQUFFLE9BQU87QUFBd0IsUUFBRSxZQUFZO0FBQVUsUUFBRSxZQUFZO0FBQUcsUUFBRSxjQUFjO0FBQVcsUUFBRSxZQUFZLE1BQU0sSUFBSSxZQUFZLE1BQU0sSUFBSSxZQUFZO0FBQVcsWUFBTSxJQUFJLFNBQUksT0FBTyxDQUFDO0FBQUcsUUFBRSxXQUFXLEdBQUcsSUFBSSxFQUFFO0FBQUcsUUFBRSxTQUFTLEdBQUcsSUFBSSxFQUFFO0FBQUEsSUFBRyxDQUFDLENBQUM7QUFDdlQsVUFBTSxXQUFXLENBQUMsR0FBV0EsSUFBVyxHQUFXLElBQUksTUFBTTtBQUFFLFlBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sS0FBSztBQUFHLFFBQUUsZUFBZSxRQUFRLE9BQU8sTUFBTTtBQUFHLFFBQUUsZ0JBQWdCLElBQUksUUFBUSxPQUFPLEdBQUdBLElBQUcsQ0FBQztBQUFHLFFBQUUsa0JBQWtCO0FBQU0sUUFBRSxRQUFRO0FBQUcsYUFBTztBQUFBLElBQUc7QUFDN1AsVUFBTSxJQUFZO0FBQUEsTUFDaEI7QUFBQSxNQUFPO0FBQUEsTUFBTTtBQUFBLE1BQVMsT0FBTyxDQUFDO0FBQUEsTUFBRyxTQUFTLENBQUMsU0FBUyxNQUFNLEtBQUssTUFBTSxHQUFHLEdBQUcsU0FBUyxNQUFNLE1BQU0sS0FBSyxHQUFHLENBQUM7QUFBQSxNQUFHLFNBQVMsU0FBUyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsTUFDaEosT0FBTyxTQUFTLE1BQU0sTUFBTSxNQUFNLEdBQUc7QUFBQSxNQUFHLFNBQVMsQ0FBQyxTQUFTLE1BQU0sTUFBTSxDQUFDLEdBQUcsU0FBUyxHQUFHLEtBQUssR0FBRyxDQUFDO0FBQUEsTUFBRyxVQUFVLFNBQVMsTUFBTSxNQUFNLENBQUM7QUFBQSxJQUNySTtBQUNBLFVBQU0sT0FBMkU7QUFBQSxNQUMvRSxDQUFDLFdBQVcsd0JBQXdCLDhCQUE4QixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsTUFBTSxDQUFHO0FBQUEsTUFDM0ssQ0FBQyxVQUFVLHNCQUFzQiw0QkFBNEIsRUFBRSxNQUFNLFFBQVEsS0FBSyxPQUFPLFFBQVEsU0FBUyxPQUFPLFNBQVMsT0FBTyxTQUFTLE9BQU8sT0FBTyxHQUFHLE1BQU0sQ0FBRztBQUFBLElBQ3RLO0FBQ0EsVUFBTSxRQUFRLElBQUksS0FBSyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssT0FBTyxPQUFPLEtBQUssS0FBSyxNQUFNO0FBQzFFLFlBQU0sWUFBWSxNQUFNLFFBQVEsWUFBWSx3QkFBd0IsV0FBVyxLQUFLLEtBQUs7QUFDekYsUUFBRSxNQUFNLElBQUksSUFBSSxFQUFFLFdBQVcsVUFBVSxJQUFJLFFBQVEsUUFBUSxZQUFZLE9BQU8sT0FBTyxPQUFPLEtBQUssR0FBRyxPQUFPLFVBQVUsQ0FBQyxHQUFHLEtBQUssTUFBTTtBQUFBLElBQ3RJLENBQUMsQ0FBQztBQUNGLFdBQU87QUFBQSxFQUNUO0FBR0EsTUFBTSxPQUFOLE1BQVc7QUFBQSxJQUVULFlBQW9CLEdBQW1CLFFBQXFCLEtBQXFCLFFBQWdCO0FBQTdFO0FBQW1CO0FBQXFCO0FBQXFCO0FBRGpGLDBCQUFRLE1BQVU7QUFBTSwwQkFBUSxRQUFZO0FBQU0sMEJBQVE7QUFBWSwwQkFBUTtBQUFZLDBCQUFRO0FBQVcsMEJBQVE7QUFBVSwwQkFBUTtBQUFVLDBCQUFRO0FBQVksMEJBQVE7QUFFM0ssWUFBTSxJQUFJLEVBQUU7QUFDWixXQUFLLE9BQU8sUUFBUSxZQUFZLFdBQVcsUUFBUSxFQUFFLFFBQVEsS0FBSyxJQUFJLEtBQUssU0FBUyxJQUFJLEdBQUcsY0FBYyxHQUFHLEdBQUcsQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQUcsV0FBSyxLQUFLLFNBQVMsSUFBSTtBQUFNLFdBQUssS0FBSyxTQUFTO0FBQVEsV0FBSyxLQUFLLGFBQWE7QUFDdE8sV0FBSyxRQUFRLElBQUksUUFBUSxjQUFjLFNBQVMsQ0FBQztBQUFHLFdBQUssTUFBTSxTQUFTO0FBQVEsV0FBSyxNQUFNLFNBQVMsSUFBSSxNQUFNO0FBQU0sV0FBSyxNQUFNLGdCQUFnQixRQUFRLEtBQUs7QUFDNUosV0FBSyxRQUFRLFFBQVEsWUFBWSxZQUFZLFNBQVMsRUFBRSxPQUFPLEtBQUssUUFBUSxLQUFLLEdBQUcsQ0FBQztBQUFHLFdBQUssTUFBTSxTQUFTLEtBQUs7QUFBTyxXQUFLLE1BQU0sU0FBUyxJQUFJO0FBQU0sV0FBSyxNQUFNLGFBQWE7QUFDOUssWUFBTSxLQUFLLElBQUksUUFBUSxpQkFBaUIsTUFBTSxDQUFDO0FBQUcsU0FBRyxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxTQUFHLGtCQUFrQjtBQUFNLFNBQUcsNkJBQTZCO0FBQU0sV0FBSyxNQUFNLFdBQVc7QUFBSSxNQUFDLEtBQUssTUFBYyxNQUFNO0FBQ2xOLFlBQU0sS0FBSyxRQUFRLFlBQVksWUFBWSxNQUFNLEVBQUUsT0FBTyxLQUFLLFFBQVEsTUFBTSxHQUFHLENBQUM7QUFBRyxTQUFHLFNBQVMsS0FBSztBQUFPLFNBQUcsV0FBVyxFQUFFO0FBQU8sU0FBRyxhQUFhO0FBQU8sV0FBSyxNQUFNO0FBQ3JLLFdBQUssT0FBTyxRQUFRLFlBQVksWUFBWSxRQUFRLEVBQUUsT0FBTyxNQUFNLFFBQVEsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxLQUFLO0FBQU8sV0FBSyxLQUFLLFNBQVMsSUFBSTtBQUFRLFdBQUssS0FBSyxhQUFhO0FBQzVLLFdBQUssTUFBTSxRQUFRLFlBQVksWUFBWSxPQUFPLEVBQUUsT0FBTyxLQUFLLFFBQVEsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFLLElBQUksU0FBUyxLQUFLO0FBQU8sV0FBSyxJQUFJLFNBQVMsSUFBSTtBQUFPLFdBQUssSUFBSSxXQUFXLEVBQUU7QUFBTyxXQUFLLElBQUksYUFBYTtBQUNsTSxXQUFLLFFBQVEsUUFBUSxZQUFZLFlBQVksU0FBUyxFQUFFLE9BQU8sTUFBTSxRQUFRLEtBQUssR0FBRyxDQUFDO0FBQUcsV0FBSyxNQUFNLFNBQVMsS0FBSztBQUFPLFdBQUssTUFBTSxTQUFTLElBQUksR0FBRyxPQUFPLEtBQU07QUFBRyxXQUFLLE1BQU0sV0FBVyxFQUFFO0FBQVUsV0FBSyxNQUFNLGFBQWE7QUFDOU4sV0FBSyxJQUFJLFdBQVcsS0FBSztBQUFHLFdBQUssS0FBSyxXQUFXLEtBQUs7QUFBRyxXQUFLLElBQUksV0FBVyxLQUFLO0FBQUcsV0FBSyxNQUFNLFdBQVcsS0FBSztBQUFBLElBQ2xIO0FBQUEsSUFDQSxJQUFJLE1BQWEsTUFBYztBQUM3QixZQUFNLElBQUksS0FBSyxFQUFFLE9BQU8sTUFBTSxLQUFLLE9BQU8sQ0FBQztBQUMzQyxNQUFDLEtBQUssTUFBYyxJQUFJLGlCQUFpQixLQUFLLEVBQUUsUUFBUSxPQUFPLENBQUM7QUFDaEUsV0FBSyxLQUFLLFdBQVcsS0FBSyxFQUFFLFFBQVEsSUFBSTtBQUFHLFdBQUssS0FBSyxXQUFXLEtBQUssRUFBRSxRQUFRLElBQUk7QUFDbkYsVUFBSSxTQUFTLEdBQUc7QUFDZCxZQUFJLENBQUMsS0FBSyxJQUFJO0FBQ1osZ0JBQU0sS0FBSyxJQUFJLFFBQVEsZUFBZSxRQUFRLElBQUksQ0FBQztBQUFHLGFBQUcsa0JBQWtCLEtBQUssRUFBRTtBQUFNLGFBQUcsVUFBVSxLQUFLO0FBQVEsYUFBRyxhQUFhLElBQUksUUFBUSxRQUFRLE1BQU0sR0FBRyxJQUFJO0FBQUcsYUFBRyxhQUFhLElBQUksUUFBUSxRQUFRLEtBQUssS0FBSyxNQUFNLEtBQUssR0FBRztBQUNsTyxhQUFHLGNBQWM7QUFBSyxhQUFHLGNBQWM7QUFBSyxhQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsT0FBTyxLQUFLLEtBQUs7QUFBRyxhQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsTUFBTSxLQUFLLElBQUk7QUFDdkosYUFBRyxlQUFlO0FBQU0sYUFBRyxlQUFlO0FBQUssYUFBRyxVQUFVLElBQUksUUFBUSxRQUFRLEdBQUcsS0FBSyxDQUFDO0FBQUcsYUFBRyxZQUFZLFFBQVEsZUFBZTtBQUFlLGVBQUssS0FBSztBQUFBLFFBQzdKO0FBQ0EsY0FBTSxJQUFJLEtBQUs7QUFBSSxVQUFFLFdBQVcsSUFBSTtBQUFNLFVBQUUsVUFBVSxJQUFJO0FBQUssVUFBRSxVQUFVLElBQUk7QUFBSyxVQUFFLFNBQVMsSUFBSSxRQUFRLE9BQU8sR0FBRyxJQUFJLEVBQUU7QUFBRyxVQUFFLFNBQVMsSUFBSSxRQUFRLE9BQU8sR0FBRyxJQUFJLEVBQUU7QUFBRyxVQUFFLFlBQVksSUFBSSxRQUFRLE9BQU8sS0FBSyxHQUFHLEtBQUssQ0FBQztBQUN2TixZQUFJLENBQUMsRUFBRSxVQUFVLEVBQUcsR0FBRSxNQUFNO0FBQUEsTUFDOUIsV0FBVyxLQUFLLE1BQU0sS0FBSyxHQUFHLFVBQVUsRUFBRyxNQUFLLEdBQUcsS0FBSztBQUN4RCxVQUFJLFFBQVEsR0FBRztBQUNiLFlBQUksQ0FBQyxLQUFLLE1BQU07QUFBRSxlQUFLLE9BQU8sUUFBUSxZQUFZLFlBQVksUUFBUSxFQUFFLFVBQVUsTUFBTSxXQUFXLE1BQU0sY0FBYyxHQUFHLEdBQUcsQ0FBQztBQUFHLGVBQUssS0FBSyxTQUFTLEtBQUs7QUFBUSxlQUFLLEtBQUssU0FBUyxJQUFJLEtBQUssTUFBTTtBQUFNLGVBQUssS0FBSyxXQUFXLEtBQUssRUFBRTtBQUFTLGVBQUssS0FBSyxhQUFhO0FBQUEsUUFBTztBQUM1USxhQUFLLEtBQUssV0FBVyxJQUFJO0FBQUEsTUFDM0IsV0FBVyxLQUFLLEtBQU0sTUFBSyxLQUFLLFdBQVcsS0FBSztBQUFBLElBQ2xEO0FBQUEsSUFDQSxNQUFNLEdBQWtCO0FBQ3RCLFlBQU0sS0FBSyxNQUFNO0FBQU0sV0FBSyxJQUFJLFdBQVcsRUFBRTtBQUFHLFdBQUssS0FBSyxXQUFXLEVBQUU7QUFDdkUsVUFBSSxJQUFJO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSSxNQUFPLENBQVc7QUFBRyxhQUFLLEtBQUssUUFBUSxJQUFJO0FBQUcsYUFBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLFFBQVEsSUFBSSxNQUFNO0FBQUEsTUFBRztBQUFBLElBQzNIO0FBQUEsSUFDQSxRQUFRLEdBQWtCO0FBQ3hCLFlBQU0sS0FBSyxNQUFNO0FBQU0sV0FBSyxJQUFJLFdBQVcsRUFBRTtBQUFHLFdBQUssTUFBTSxXQUFXLEVBQUU7QUFDeEUsVUFBSSxJQUFJO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSSxNQUFPLENBQVc7QUFBRyxhQUFLLE1BQU0sUUFBUSxJQUFJO0FBQUcsYUFBSyxNQUFNLFNBQVMsSUFBSSxFQUFFLFFBQVEsSUFBSSxNQUFNO0FBQUEsTUFBRztBQUFBLElBQzdIO0FBQUEsSUFDQSxRQUFRLElBQWE7QUFBRSxVQUFJLEtBQUssSUFBSTtBQUFFLFlBQUksTUFBTSxDQUFDLEtBQUssR0FBRyxVQUFVLEVBQUcsTUFBSyxHQUFHLE1BQU07QUFBRyxZQUFJLENBQUMsTUFBTSxLQUFLLEdBQUcsVUFBVSxFQUFHLE1BQUssR0FBRyxLQUFLO0FBQUEsTUFBRztBQUFBLElBQUU7QUFBQSxJQUN6SSxPQUFPLElBQVk7QUFBRSxVQUFJLEtBQUssUUFBUSxLQUFLLEtBQUssVUFBVSxFQUFHLE1BQUssS0FBSyxTQUFTLEtBQUssS0FBSztBQUFBLElBQUs7QUFBQSxJQUMvRixVQUFVO0FBQUUsVUFBSSxLQUFLLElBQUk7QUFBRSxhQUFLLEdBQUcsS0FBSztBQUFHLGFBQUssR0FBRyxRQUFRO0FBQUEsTUFBRztBQUFFLE9BQUMsS0FBSyxNQUFNLEtBQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLEtBQUssS0FBSyxLQUFLLEVBQUUsUUFBUSxDQUFDLE1BQU0sS0FBSyxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssTUFBTSxRQUFRO0FBQUEsSUFBRztBQUFBLEVBQ3hNO0FBR0EsTUFBTSxjQUFOLE1BQXdDO0FBQUEsSUFHdEMsWUFBb0IsR0FBbUIsS0FBZSxNQUFjLE1BQWEsTUFBYztBQUEzRTtBQUFtQjtBQUZ2QztBQUFhO0FBQWEsa0NBQU87QUFBRyxtQ0FBZ0I7QUFBUTtBQUM1RCwwQkFBUTtBQUFVLDBCQUFRO0FBQVcsMEJBQVEsU0FBNkIsQ0FBQztBQUFHLDBCQUFRLE9BQVc7QUFBTSwwQkFBUTtBQUFZLDBCQUFRO0FBQVcsMEJBQVEsVUFBUztBQUFHLDBCQUFRO0FBRXhLLFlBQU0sSUFBSSxFQUFFLE9BQU8sTUFBTSxLQUFLLE9BQU8sRUFBRSxTQUFTLEVBQUUsRUFBRSxNQUFNLEdBQUcsQ0FBQztBQUM5RCxXQUFLLE1BQU0sSUFBSSxVQUFVLHlCQUF5QixDQUFDLE1BQWMsSUFBSSxNQUFNLEtBQUssT0FBTyxFQUFFLGtCQUFrQixLQUFLLENBQUM7QUFDakgsV0FBSyxTQUFTLElBQUksUUFBUSxjQUFjLFVBQVUsS0FBSyxDQUFDO0FBQUcsV0FBSyxJQUFJLFVBQVUsQ0FBQyxFQUFFLFNBQVMsS0FBSztBQUMvRixXQUFLLE9BQU8sS0FBSyxJQUFJLFVBQVUsQ0FBQyxFQUFFLGVBQWUsRUFBRSxLQUFLLENBQUMsTUFBVyxFQUFFLEtBQUssU0FBUyxPQUFPLENBQUM7QUFDNUYsVUFBSSxDQUFDLElBQUksUUFBUyxLQUFJLFVBQVUsS0FBSyxLQUFLO0FBQzFDLFdBQUssSUFBSSxnQkFBZ0IsUUFBUSxDQUFDQSxPQUFXO0FBQUUsUUFBQUEsR0FBRSxLQUFLO0FBQUcsUUFBQUEsR0FBRSxpQkFBaUI7QUFBTSxRQUFBQSxHQUFFLGdCQUFnQjtBQUFNLGFBQUssTUFBTUEsR0FBRSxLQUFLLE1BQU0sR0FBRyxFQUFFLENBQUMsQ0FBQyxJQUFJQTtBQUFBLE1BQUcsQ0FBQztBQUNqSixXQUFLLElBQUksVUFBVSxDQUFDLEVBQUUsZUFBZSxFQUFFLFFBQVEsQ0FBQyxNQUFXO0FBQUUsVUFBRSwyQkFBMkI7QUFBTSxVQUFFLGFBQWE7QUFBQSxNQUFPLENBQUM7QUFDdkgsV0FBSyxNQUFNLElBQUk7QUFBSyxXQUFLLE9BQU8sSUFBSTtBQUFPLFdBQUssT0FBTztBQUN2RCxXQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUcsS0FBSyxRQUFRLEtBQUssS0FBSyxHQUFHO0FBQ2xELFdBQUssT0FBTyxRQUFRLFlBQVksZUFBZSxRQUFRLEVBQUUsUUFBUSxLQUFLLFVBQVUsSUFBSSxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxLQUFLO0FBQVEsV0FBSyxLQUFLLFNBQVMsSUFBSTtBQUFLLFdBQUssS0FBSyxhQUFhO0FBQU8sV0FBSyxLQUFLLGFBQWE7QUFDNU0sV0FBSyxRQUFRLElBQUk7QUFBRyxXQUFLLFFBQVEsSUFBSTtBQUFHLFdBQUssS0FBSyxXQUFXLEVBQUUsTUFBTSxRQUFRLFFBQVEsS0FBSztBQUFBLElBQzVGO0FBQUEsSUFDUSxXQUFXO0FBQ2pCLFlBQU0sTUFBTSxLQUFLLE9BQU8sTUFBTSxLQUFLLE1BQU0sSUFBSSxLQUFLO0FBQ2xELFVBQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQUUsY0FBTSxJQUFJLEVBQUUsUUFBUSxNQUFNLE9BQU8sR0FBRztBQUFHLFlBQUksS0FBSyxTQUFTLEVBQUcsR0FBRSxnQkFBZ0IsRUFBRTtBQUFVLGNBQU0sSUFBSSxLQUFLLEtBQUssT0FBTyxDQUFDO0FBQUcsVUFBRSxjQUFjLElBQUksUUFBUSxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQUcsVUFBRSxTQUFTLEdBQUcsSUFBSTtBQUFBLE1BQUc7QUFDNU4sV0FBSyxLQUFLLFdBQVcsRUFBRSxTQUFTLEdBQUc7QUFBQSxJQUNyQztBQUFBLElBQ0EsUUFBUSxHQUFVO0FBQUUsV0FBSyxPQUFPO0FBQUcsV0FBSyxTQUFTO0FBQUcsV0FBSyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFDakYsUUFBUSxJQUFZO0FBQUUsV0FBSyxPQUFPO0FBQUksV0FBSyxTQUFTO0FBQUcsV0FBSyxPQUFPLFFBQVEsT0FBTyxRQUFRLEtBQUssTUFBTSxLQUFLLENBQUMsSUFBSSxLQUFLLElBQUk7QUFBRyxXQUFLLEtBQUssSUFBSSxLQUFLLE1BQU0sRUFBRTtBQUFBLElBQUc7QUFBQSxJQUN6SixNQUFNLEdBQWtCO0FBQUUsV0FBSyxLQUFLLE1BQU0sQ0FBQztBQUFBLElBQUc7QUFBQSxJQUM5QyxRQUFRLEdBQWtCO0FBQUUsV0FBSyxLQUFLLFFBQVEsQ0FBQztBQUFBLElBQUc7QUFBQSxJQUNsRCxRQUFRO0FBQUUsV0FBSyxTQUFTO0FBQUEsSUFBTTtBQUFBLElBQzlCLEtBQUssT0FBZSxRQUFRLEdBQUc7QUFDN0IsWUFBTUEsS0FBSSxLQUFLLE1BQU0sS0FBSyxJQUFJLE1BQU0sS0FBSyxDQUFDO0FBQUcsVUFBSSxDQUFDQSxHQUFHO0FBQVEsWUFBTSxPQUFPLFVBQVUsVUFBVSxVQUFVO0FBQ3hHLFVBQUksUUFBUSxLQUFLLFVBQVUsU0FBUyxLQUFLLFFBQVFBLEdBQUc7QUFDcEQsVUFBSSxLQUFLLElBQUssTUFBSyxJQUFJLEtBQUs7QUFBRyxNQUFBQSxHQUFFLEtBQUs7QUFBRyxNQUFBQSxHQUFFLE1BQU0sTUFBTSxPQUFPQSxHQUFFLE1BQU1BLEdBQUUsRUFBRTtBQUMxRSxVQUFJLEtBQU0sQ0FBQUEsR0FBRSxVQUFVQSxHQUFFLE9BQU8sS0FBSyxPQUFPLEtBQUtBLEdBQUUsS0FBS0EsR0FBRSxLQUFLO0FBQzlELFdBQUssTUFBTUE7QUFBRyxXQUFLLFFBQVE7QUFBTyxXQUFLLEtBQUssUUFBUSxVQUFVLE9BQU87QUFBQSxJQUN2RTtBQUFBLElBQ0EsT0FBTyxJQUFZO0FBQ2pCLFdBQUssS0FBSyxPQUFPLEVBQUU7QUFDbkIsVUFBSSxLQUFLLFNBQVMsR0FBRztBQUFFLGFBQUssVUFBVTtBQUFJLGNBQU0sSUFBSSxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxJQUFJLE9BQU8sS0FBSyxFQUFFO0FBQUcsYUFBSyxPQUFPLFFBQVEsT0FBTyxRQUFRLEtBQUssTUFBTSxLQUFLLE9BQU8sQ0FBQyxJQUFJLEtBQUssT0FBTyxDQUFDO0FBQUEsTUFBRztBQUFBLElBQ3JNO0FBQUEsSUFDQSxVQUFVO0FBQUUsV0FBSyxLQUFLLFFBQVE7QUFBRyxXQUFLLElBQUksZ0JBQWdCLFFBQVEsQ0FBQ0EsT0FBV0EsR0FBRSxRQUFRLENBQUM7QUFBRyxXQUFLLElBQUksVUFBVSxRQUFRLENBQUMsTUFBVyxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssS0FBSyxRQUFRO0FBQUcsV0FBSyxJQUFJLFVBQVUsQ0FBQyxFQUFFLFFBQVEsT0FBTyxLQUFLO0FBQUcsV0FBSyxPQUFPLFFBQVE7QUFBQSxJQUFHO0FBQUEsRUFDNU87QUFHQSxNQUFNLEtBQXlHO0FBQUEsSUFDN0csUUFBUSxFQUFFLEtBQUssV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLE1BQU0sTUFBTSxRQUFRLFVBQVUsT0FBTyxTQUFTO0FBQUEsSUFDMUYsUUFBUSxFQUFFLEtBQUssV0FBVyxHQUFHLEtBQUssR0FBRyxLQUFLLE1BQU0sTUFBTSxRQUFRLFVBQVUsT0FBTyxTQUFTO0FBQUEsSUFDeEYsTUFBTSxFQUFFLEtBQUssV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLE1BQU0sTUFBTSxRQUFRLFFBQVEsT0FBTyxPQUFPO0FBQUEsSUFDcEYsV0FBVyxFQUFFLEtBQUssV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLE1BQU0sTUFBTSxRQUFRLE9BQU8sT0FBTyxZQUFZO0FBQUEsRUFDL0Y7QUFDQSxNQUFNLG9CQUFOLE1BQThDO0FBQUEsSUFHNUMsWUFBb0IsR0FBbUIsTUFBYyxNQUFhLE1BQWM7QUFBNUQ7QUFBbUI7QUFGdkM7QUFBYTtBQUFhLGtDQUFPO0FBQUcsbUNBQWdCO0FBQVE7QUFDNUQsMEJBQVE7QUFBVSwwQkFBUSxRQUFjLENBQUM7QUFBRywwQkFBUTtBQUFTLDBCQUFRO0FBQVksMEJBQVE7QUFBVywwQkFBUSxLQUFJLEtBQUssT0FBTyxJQUFJO0FBQUcsMEJBQVEsT0FBTTtBQUFHLDBCQUFRLE9BQU07QUFBRywwQkFBUSxRQUFPO0FBQUcsMEJBQVEsVUFBUztBQUFHLDBCQUFRLFFBQWMsQ0FBQztBQUFHLDBCQUFRO0FBRTNPLFlBQU0sSUFBSSxFQUFFLE9BQU8sSUFBSSxHQUFHLElBQUk7QUFBRyxXQUFLLE9BQU87QUFDN0MsV0FBSyxTQUFTLElBQUksUUFBUSxjQUFjLFFBQVEsTUFBTSxDQUFDO0FBQUcsV0FBSyxNQUFNLElBQUksUUFBUSxjQUFjLE9BQU8sQ0FBQztBQUFHLFdBQUssSUFBSSxTQUFTLEtBQUs7QUFDakksWUFBTSxNQUFNLENBQUMsS0FBYSxLQUFLLE1BQU07QUFBRSxjQUFNLElBQUksSUFBSSxRQUFRLGlCQUFpQixNQUFNLENBQUM7QUFBRyxVQUFFLGVBQWUsUUFBUSxPQUFPLGNBQWMsR0FBRyxFQUFFLE1BQU0sSUFBSTtBQUFHLFVBQUUsZ0JBQWdCLElBQUksUUFBUSxPQUFPLEtBQUssS0FBSyxHQUFHO0FBQUcsWUFBSSxHQUFJLEdBQUUsZ0JBQWdCLEVBQUUsYUFBYSxNQUFNLEVBQUU7QUFBRyxlQUFPO0FBQUEsTUFBRztBQUMzUSxZQUFNLE9BQU8sTUFBTSxRQUFRLE9BQU8sRUFBRSxJQUFJO0FBQ3hDLGlCQUFXLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRztBQUFFLGNBQU0sS0FBSyxJQUFJLFFBQVEsY0FBYyxPQUFPLENBQUM7QUFBRyxXQUFHLFNBQVMsS0FBSztBQUFLLFdBQUcsU0FBUyxJQUFJLEtBQUssRUFBRSxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQUcsY0FBTSxJQUFJLFFBQVEsWUFBWSxlQUFlLEtBQUssRUFBRSxRQUFRLE1BQU0sVUFBVSxFQUFFLElBQUksS0FBSyxHQUFHLENBQUM7QUFBRyxVQUFFLFNBQVM7QUFBSSxVQUFFLFNBQVMsSUFBSSxDQUFDLE9BQU87QUFBRyxVQUFFLFdBQVcsSUFBSSxTQUFTO0FBQUcsVUFBRSxhQUFhO0FBQU8sYUFBSyxLQUFLLEtBQUssRUFBRTtBQUFBLE1BQUc7QUFDM1YsV0FBSyxPQUFPLFFBQVEsWUFBWSxjQUFjLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxHQUFHLFFBQVEsRUFBRSxJQUFJLEVBQUUsSUFBSSxJQUFJLEdBQUcsQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLEtBQUs7QUFBSyxXQUFLLEtBQUssU0FBUyxJQUFJO0FBQU8sV0FBSyxLQUFLLFdBQVcsSUFBSSxFQUFFLEdBQUc7QUFBRyxXQUFLLEtBQUssYUFBYTtBQUMzTixZQUFNLE9BQU8sUUFBUSxZQUFZLGFBQWEsUUFBUSxFQUFFLFVBQVUsRUFBRSxPQUFPLEtBQUssVUFBVSxHQUFHLEdBQUcsQ0FBQztBQUFHLFdBQUssU0FBUyxLQUFLO0FBQUssV0FBSyxTQUFTLElBQUksT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPO0FBQU0sV0FBSyxXQUFXLElBQUksRUFBRSxHQUFHO0FBQUcsV0FBSyxhQUFhO0FBQ3hOLFlBQU0sT0FBTyxJQUFJLFFBQVEsaUJBQWlCLE9BQU8sQ0FBQztBQUFHLFdBQUssZUFBZSxRQUFRLE9BQU8sTUFBTTtBQUFHLFdBQUssZ0JBQWdCLFNBQVMsSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sQ0FBQyxJQUFJLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxJQUFJO0FBQUcsTUFBQyxLQUFhLE9BQU87QUFDL04saUJBQVcsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHO0FBQUUsY0FBTSxJQUFJLFFBQVEsWUFBWSxhQUFhLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTyxJQUFJLEdBQUcsQ0FBQztBQUFHLFVBQUUsU0FBUyxLQUFLO0FBQUssVUFBRSxTQUFTLElBQUksS0FBSyxFQUFFLE9BQU8sS0FBSyxLQUFLLFNBQVMsSUFBSSxNQUFNLEVBQUUsT0FBTyxJQUFJO0FBQUcsVUFBRSxXQUFXO0FBQU0sVUFBRSxhQUFhO0FBQUEsTUFBTztBQUVwUCxXQUFLLEtBQUssSUFBSSxRQUFRLGNBQWMsTUFBTSxDQUFDO0FBQUcsV0FBSyxHQUFHLFNBQVMsS0FBSztBQUFLLFdBQUssR0FBRyxTQUFTLElBQUksRUFBRSxJQUFJLEtBQUssT0FBTyxFQUFFLElBQUksTUFBTSxJQUFJO0FBQ2hJLFlBQU0sS0FBSyxJQUFJLFNBQVMsR0FBRyxPQUFPLElBQUksU0FBUztBQUMvQyxZQUFNLEtBQUssQ0FBQyxHQUFRLE1BQWMsTUFBVyxLQUFlLE9BQVk7QUFBRSxjQUFNLElBQUksU0FBUyxRQUFRLFFBQVEsWUFBWSxVQUFVLEtBQUssTUFBTSxDQUFDLElBQUksU0FBUyxRQUFRLFFBQVEsWUFBWSxlQUFlLEtBQUssTUFBTSxDQUFDLElBQUksUUFBUSxZQUFZLGFBQWEsS0FBSyxNQUFNLENBQUM7QUFBRyxVQUFFLFNBQVMsS0FBSztBQUFJLFVBQUUsU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDO0FBQUcsVUFBRSxXQUFXO0FBQUksVUFBRSxhQUFhO0FBQU8sZUFBTztBQUFBLE1BQUc7QUFDcFgsVUFBSSxFQUFFLFdBQVcsU0FBVSxJQUFHLEdBQUcsT0FBTyxFQUFFLE9BQU8sTUFBTSxRQUFRLEtBQUssT0FBTyxLQUFLLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLElBQUk7QUFDeEcsVUFBSSxFQUFFLFdBQVcsVUFBVTtBQUFFLFdBQUcsR0FBRyxPQUFPLEVBQUUsT0FBTyxNQUFNLFFBQVEsS0FBSyxPQUFPLEtBQUssR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsSUFBSTtBQUFHLGNBQU0sS0FBSyxRQUFRLFlBQVksZUFBZSxNQUFNLEVBQUUsUUFBUSxNQUFNLFVBQVUsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFHLFNBQVMsS0FBSztBQUFLLFdBQUcsU0FBUyxJQUFJLEtBQUssS0FBSztBQUFHLFdBQUcsU0FBUyxJQUFJLENBQUMsRUFBRSxJQUFJLEtBQUssT0FBTyxFQUFFLElBQUksS0FBSyxJQUFJO0FBQUcsV0FBRyxXQUFXLElBQUksU0FBUztBQUFHLFdBQUcsYUFBYTtBQUFBLE1BQU87QUFDcFcsVUFBSSxFQUFFLFdBQVcsUUFBUTtBQUFFLFdBQUcsR0FBRyxPQUFPLEVBQUUsUUFBUSxLQUFLLFVBQVUsS0FBSyxHQUFHLENBQUMsR0FBRyxPQUFPLEdBQUcsR0FBRyxFQUFFO0FBQUcsV0FBRyxHQUFHLE9BQU8sRUFBRSxVQUFVLElBQUksR0FBRyxDQUFDLEdBQUcsT0FBTyxHQUFHLEdBQUcsSUFBSTtBQUFBLE1BQUc7QUFDdkosVUFBSSxFQUFFLFdBQVcsT0FBTztBQUFFLFdBQUcsR0FBRyxPQUFPLEVBQUUsUUFBUSxLQUFLLFVBQVUsS0FBSyxHQUFHLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxFQUFFO0FBQUcsV0FBRyxHQUFHLE9BQU8sRUFBRSxPQUFPLE1BQU0sUUFBUSxNQUFNLE9BQU8sS0FBSyxHQUFHLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxJQUFJO0FBQUcsY0FBTSxPQUFPLFFBQVEsWUFBWSxlQUFlLFFBQVEsRUFBRSxRQUFRLEtBQUssYUFBYSxHQUFHLGdCQUFnQixFQUFFLE9BQU8sSUFBSSxHQUFHLENBQUM7QUFBRyxhQUFLLFNBQVMsS0FBSztBQUFLLGFBQUssU0FBUyxJQUFJLEtBQUssU0FBUyxJQUFJLEVBQUUsT0FBTztBQUFNLGFBQUssV0FBVyxJQUFJLFNBQVM7QUFBRyxhQUFLLGFBQWE7QUFBQSxNQUFPO0FBQzlhLFdBQUssTUFBTSxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU87QUFBTSxXQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUcsS0FBSyxRQUFRLEtBQUssS0FBSyxFQUFFLElBQUksR0FBRztBQUMvRixZQUFNLE1BQU0sSUFBSSxHQUFHLEtBQUssSUFBSSxDQUFDLE1BQU07QUFBRSxVQUFFLE9BQU87QUFBd0IsVUFBRSxZQUFZO0FBQVUsVUFBRSxZQUFZO0FBQVcsVUFBRSxjQUFjO0FBQVEsVUFBRSxZQUFZO0FBQUcsVUFBRSxXQUFXLEVBQUUsUUFBUSxlQUFlLEtBQUssRUFBRTtBQUFHLFVBQUUsU0FBUyxFQUFFLFFBQVEsZUFBZSxLQUFLLEVBQUU7QUFBQSxNQUFHLENBQUM7QUFDL1AsWUFBTSxLQUFLLFFBQVEsWUFBWSxZQUFZLE9BQU8sRUFBRSxPQUFPLEtBQUssUUFBUSxJQUFJLEdBQUcsQ0FBQztBQUFHLFNBQUcsU0FBUyxLQUFLO0FBQVEsU0FBRyxTQUFTLElBQUk7QUFBTSxTQUFHLFNBQVMsSUFBSSxLQUFLLEtBQUssSUFBSTtBQUFLLFNBQUcsZ0JBQWdCLFFBQVEsS0FBSztBQUFtQixZQUFNLEtBQUssSUFBSSxRQUFRLGlCQUFpQixNQUFNLENBQUM7QUFBRyxTQUFHLGlCQUFpQjtBQUFLLFNBQUcsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQUcsU0FBRyxrQkFBa0I7QUFBTSxTQUFHLDZCQUE2QjtBQUFNLFNBQUcsV0FBVztBQUFJLFNBQUcsYUFBYTtBQUFPLFNBQUcsU0FBUyxJQUFJLEtBQUssTUFBTTtBQUNuZCxXQUFLLE9BQU8sUUFBUSxZQUFZLGVBQWUsUUFBUSxFQUFFLFFBQVEsS0FBSyxLQUFLLFVBQVUsS0FBSyxJQUFJLEtBQUssRUFBRSxJQUFJLEdBQUcsRUFBRSxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxLQUFLO0FBQVEsV0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLE1BQU07QUFBRyxXQUFLLEtBQUssYUFBYTtBQUFPLFdBQUssS0FBSyxXQUFXLEVBQUUsTUFBTSxRQUFRLFFBQVEsS0FBSztBQUMxUSxNQUFDLEtBQWEsUUFBUSxDQUFDLEVBQUU7QUFBRyxXQUFLLFFBQVEsSUFBSTtBQUFHLFdBQUssUUFBUSxJQUFJO0FBQUcsV0FBSyxLQUFLLE1BQU07QUFBQSxJQUN0RjtBQUFBLElBQ0EsUUFBUSxHQUFVO0FBQUUsV0FBSyxPQUFPO0FBQUcsTUFBQyxLQUFhLEtBQUssZ0JBQWdCLE1BQU0sSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sQ0FBQyxJQUFJLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxJQUFJO0FBQUcsV0FBSyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFDcEwsUUFBUSxJQUFZO0FBQUUsV0FBSyxPQUFPO0FBQUksV0FBSyxPQUFPLFFBQVEsS0FBSyxNQUFNLEtBQUssQ0FBQztBQUFHLFlBQU0sSUFBSSxLQUFLLEtBQUssQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLGVBQWUsUUFBUSxPQUFPLGNBQWMsR0FBRyxLQUFLLElBQUksRUFBRSxHQUFHLEVBQUUsTUFBTSxJQUFJLEVBQUUsU0FBUyxJQUFJLFFBQVEsT0FBTyxLQUFLLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQUcsV0FBSyxPQUFPLFFBQVEsT0FBTyxLQUFLLElBQUk7QUFBRyxXQUFLLEtBQUssSUFBSSxLQUFLLE1BQU0sRUFBRTtBQUFBLElBQUc7QUFBQSxJQUNoVyxNQUFNLEdBQWtCO0FBQUUsV0FBSyxLQUFLLE1BQU0sQ0FBQztBQUFBLElBQUc7QUFBQSxJQUM5QyxRQUFRLEdBQWtCO0FBQUUsV0FBSyxLQUFLLFFBQVEsQ0FBQztBQUFBLElBQUc7QUFBQSxJQUNsRCxRQUFRO0FBQUUsV0FBSyxTQUFTO0FBQUEsSUFBTTtBQUFBLElBQzlCLEtBQUssT0FBZSxRQUFRLEdBQUc7QUFBRSxVQUFJLFVBQVUsS0FBSyxVQUFVLFVBQVUsVUFBVSxVQUFVLE9BQVE7QUFBUSxXQUFLLFFBQVE7QUFBTyxXQUFLLE1BQU0sS0FBSztBQUFHLFdBQUssTUFBTSxVQUFVLFdBQVksUUFBUSxNQUFNLEtBQUssSUFBYyxFQUFFLFVBQVUsUUFBUyxVQUFVLFVBQVUsTUFBTSxVQUFVLFVBQVUsTUFBTTtBQUFLLFdBQUssS0FBSyxRQUFRLFVBQVUsT0FBTztBQUFBLElBQUc7QUFBQSxJQUN6VSxPQUFPLElBQVk7QUFDakIsV0FBSyxLQUFLO0FBQUksV0FBSyxLQUFLLE9BQU8sRUFBRTtBQUFHLFlBQU0sSUFBSSxLQUFLLElBQUksSUFBSSxLQUFLLElBQUksS0FBSyxPQUFPLEtBQUssR0FBRyxHQUFHLElBQUksS0FBSyxLQUFLLElBQUksS0FBSztBQUNsSCxRQUFFLFNBQVMsSUFBSSxHQUFHLEdBQUcsQ0FBQztBQUFHLFFBQUUsU0FBUyxJQUFJLEdBQUcsR0FBRyxDQUFDO0FBQUcsUUFBRSxRQUFRLE9BQU8sQ0FBQztBQUFHLFFBQUUsU0FBUyxJQUFJO0FBQU0sV0FBSyxLQUFLLFFBQVEsQ0FBQyxNQUFPLEVBQUUsU0FBUyxJQUFJLENBQUU7QUFDdkksVUFBSSxLQUFLLFVBQVUsT0FBUSxHQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsSUFBSTtBQUFBLGVBQzFELEtBQUssVUFBVSxPQUFPO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSTtBQUFJLFVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDLElBQUk7QUFBTSxVQUFFLFNBQVMsSUFBSTtBQUFLLGFBQUssS0FBSyxDQUFDLEVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxhQUFLLEtBQUssQ0FBQyxFQUFFLFNBQVMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBQSxNQUFLLFdBQ3BQLEtBQUssVUFBVSxVQUFVO0FBQUUsY0FBTSxJQUFJLElBQUksTUFBTSxRQUFRLElBQUksT0FBTyxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksSUFBSSxPQUFPLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxLQUFLLENBQUM7QUFBQSxNQUFHLFdBQzFOLEtBQUssVUFBVSxTQUFTO0FBQUUsY0FBTSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUk7QUFBSSxVQUFFLFFBQVEsT0FBTyxPQUFPLE9BQU8sQ0FBQztBQUFHLFVBQUUsU0FBUyxLQUFLLElBQUksS0FBSztBQUFBLE1BQUssV0FDMUgsS0FBSyxVQUFVLFNBQVM7QUFBRSxjQUFNLElBQUksSUFBSTtBQUFHLFVBQUUsU0FBUyxJ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LEdBQUcsS0FBSyxPQUFPLE1BQU0sRUFBRSxPQUFPLEtBQUssS0FBSyxPQUFPO0FBQ3JLLFdBQUssS0FBSyxNQUFNO0FBQUcsV0FBSyxNQUFNLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1RCxXQUFLLE9BQU8sU0FBUyxRQUFRLENBQUMsTUFBTTtBQUNsQyxZQUFJLEVBQUUsU0FBUyxHQUFHO0FBQUUsZ0JBQU0sSUFBSSxNQUFNLEVBQUUsS0FBSyxDQUFDO0FBQUcsZ0JBQU0sSUFBSSxLQUFLLFFBQVEsSUFBSSxFQUFFLEVBQUU7QUFBSSxlQUFLLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQztBQUFHLGVBQUssTUFBTSxJQUFJLEVBQUUsSUFBSSxFQUFFLEVBQUU7QUFBRyxZQUFFLE1BQU0sQ0FBQztBQUFHLFlBQUUsUUFBUSxFQUFFLFVBQVUsSUFBSSxJQUFJO0FBQUEsUUFBRyxPQUM5SztBQUFFLGdCQUFNLElBQUksYUFBYSxLQUFLLEdBQUcsRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLENBQUMsS0FBSyxLQUFLO0FBQUcsWUFBRSxLQUFLLE9BQU87QUFBRyxZQUFFLE1BQU0sQ0FBQztBQUFHLFlBQUUsUUFBUSxFQUFFLFVBQVUsSUFBSSxJQUFJO0FBQUcsZUFBSyxLQUFLLElBQUksRUFBRSxJQUFJLENBQUM7QUFBRyxlQUFLLE1BQU0sS0FBSyxNQUFNO0FBQUUsZ0JBQUksRUFBRSxVQUFVLFFBQVMsR0FBRSxLQUFLLE1BQU07QUFBQSxVQUFHLENBQUM7QUFBRyxlQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsUUFBRztBQUFBLE1BQ3RXLENBQUM7QUFDRCxlQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxNQUFLLEtBQUss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O0FBQUcsVUFBSSxPQUFjO0FBQ3RILFlBQU0sVUFBVSxNQUFNO0FBQUUsWUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUFHLFlBQUksU0FBUztBQUFHLGNBQU0sUUFBUSxDQUFDLE1BQU0sTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLElBQUksTUFBTTtBQUFFLGdCQUFNLElBQUksYUFBYSxLQUFLLEdBQUcsTUFBTSxNQUFNLEVBQUU7QUFBRyxZQUFFLE9BQU8sU0FBUyxLQUFLLElBQUksT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLElBQUk7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFNLFlBQUUsS0FBSyxNQUFNO0FBQUcsY0FBSSxLQUFLLENBQUM7QUFBQSxRQUFHLENBQUMsQ0FBQztBQUFBLE1BQUc7QUFDdFQsY0FBUTtBQUFHLFdBQUssT0FBTyxTQUFTLElBQUksR0FBRyxLQUFLLEtBQUs7QUFBRyxXQUFLLE9BQU8sVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssSUFBSSxDQUFDO0FBQUcsV0FBSyxPQUFPLE1BQU07QUFDaEksTUFBQyxPQUFlLFlBQVksRUFBRSxTQUFTLENBQUMsTUFBYTtBQUFFLGVBQU87QUFBRyxnQkFBUTtBQUFBLE1BQUcsR0FBRyxJQUFJO0FBQ25GLFVBQUksT0FBTyxZQUFZLElBQUk7QUFBRyxXQUFLLE9BQU8sY0FBYyxNQUFNO0FBQUUsY0FBTSxJQUFJLFlBQVksSUFBSSxHQUFHLEtBQUssS0FBSyxJQUFJLE9BQU8sSUFBSSxRQUFRLEdBQUk7QUFBRyxlQUFPO0FBQUcsWUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxDQUFDO0FBQUcsYUFBSyxNQUFNLE9BQU87QUFBQSxNQUFHLENBQUM7QUFBQSxJQUN6TTtBQUFBLEVBQ0Y7OztBQy9aQSxNQUFNLElBQUksSUFBSSxLQUFLO0FBQ25CLEVBQUMsT0FBZSxTQUFTO0FBQ3pCLElBQUUsS0FBSyxTQUFTLGVBQWUsR0FBRyxDQUFzQixFQUNyRCxLQUFLLE1BQU07QUFBRSxVQUFNLElBQUksU0FBUyxlQUFlLFNBQVM7QUFBRyxRQUFJLEVBQUcsR0FBRSxNQUFNLFVBQVU7QUFBUSxJQUFDLE9BQWUsY0FBYztBQUFNLFdBQU8sY0FBYyxJQUFJLE1BQU0sa0JBQWtCLENBQUM7QUFBQSxFQUFHLENBQUMsRUFDdEwsTUFBTSxDQUFDLE1BQU07QUFDWixVQUFNLElBQUksU0FBUyxlQUFlLFNBQVM7QUFBRyxRQUFJLEdBQUc7QUFBRSxRQUFFLE1BQU0sVUFBVTtBQUFRLFFBQUUsY0FBYyxhQUFhLEtBQUssRUFBRSxVQUFVLEVBQUUsVUFBVTtBQUFBLElBQUk7QUFDL0ksWUFBUSxNQUFNLENBQUM7QUFBQSxFQUNqQixDQUFDOyIsCiAgIm5hbWVzIjogWyJ0ZyIsICJnIiwgImciLCAiZHJhdyIsICJnIiwgImciXQp9Cg==
