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
    hard: ["W1 A1", "K1 G1 W1 A1", "O1 A1 G1 W1", "K1 O1 A1 W1 G1", "O1 K1 A2 G1 W1", "A2 K1 O1 G1 W1 B1", "K1 O1 A1 G1 W2", "O1 K1 A2 B1 G1", "O2 K1 A2 B1 G1", "O2 K2 A1 B1 G1 W1"]
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
  function defaultSave() {
    const souls = {};
    for (const id of SOULS) souls[id] = { level: 1, copies: 0 };
    return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls };
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
      const ov = $("overlay");
      ov.className = "";
      ov.innerHTML = "";
      if (ph === "draft" && g2.draft) {
        ov.className = "show";
        ov.innerHTML = `<div class="box"><h2>Victory Draft</h2><div class="sub">Wave cleared. Dominion is now ${s.cap}. Keep one:</div><div class="row">${g2.draft.map((soul, i) => `<div class="card big" data-i="${i}"><div class="cost">${cost(soul, 1)}</div><div class="ic">${ICON[soul]}</div><div class="nm">${SOUL_NAME[soul]}</div><div class="role">${ROLE_TEXT[soul]}</div></div>`).join("")}</div></div>`;
        ov.querySelectorAll(".card").forEach((c) => c.onclick = () => g2.pickDraft(+c.dataset.i));
      } else if (ph === "won" || ph === "lost") {
        ov.className = "show";
        ov.innerHTML = `<div class="box"><h2>${ph === "won" ? "Stage cleared!" : "Stage lost"}</h2><div class="sub">${g2.lastBattle}</div><button id="again">${ph === "won" ? "Play again" : "Try again"}</button></div>`;
        $("again").onclick = () => g2.startStage(g2.seed + 1);
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
      <div class="dsec">Difficulty <select id="dDiff">${["easy", "normal", "hard"].map((k) => `<option value="${k}" ${g2.difficulty === k ? "selected" : ""}>${k}</option>`).join("")}</select> <small>(applies to the next battle)</small></div>
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
    /** Fresh run with the currently equipped Soul Deck (the shell's Campaign > Play button calls this). */
    newRun() {
      this.startStage(new URLSearchParams(location.search).get("seed") ? this.seed : Math.floor(Math.random() * 1e6) + 1);
    }
    startStage(seed) {
      this.cine = false;
      this.tweens.length = 0;
      if (this.necro) this.necro.revive();
      this.seed = seed;
      this.attempt = 0;
      this.s = newStage({ ...PROTOTYPE_RULES, pool: loadSave().deck }, seed);
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
      const alive = new Set(this.s.units.map((u) => u.id));
      for (const [id, v] of this.unitVis) if (!alive.has(id)) {
        this.visToUnit.delete(v);
        const p = v.holder.position;
        this.burst(p.x, p.z, [0.6, 0.5, 0.7, 0.8], [0.3, 0.2, 0.5, 0.6], 16);
        v.dispose();
        this.unitVis.delete(id);
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
          const vv = v;
          this.later(1.1, () => {
            if (this.phase === "build") vv.play("idle");
          });
        } else {
          v.holder.position.set(p.x, 0, p.z);
          v.holder.rotation.y = Math.PI / 2;
          if (v.star !== u.star) {
            v.setStar(u.star);
            v.pulse();
            this.fxRing(p.x, p.z, new BABYLON.Color3(1, 0.85, 0.4), 0.2, 1.4, 0.6);
            this.burst(p.x, p.z, [1, 0.85, 0.4, 0.9], [0.8, 0.4, 1, 0.8], 24);
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
        } else if (e.t === "arrow") {
          const f = b.byId(e.from), to = b.byId(e.to);
          this.spawnArrow(f.team, f.x, f.z, to.x, to.z, e.dur);
        } else if (e.t === "death") {
          const v = this.fvis.get(e.id);
          if (v) {
            v.play("death");
            v.setHp(null);
            v.setMana(null);
            const f = b.byId(e.id);
            this.burst(f.x, f.z, [0.6, 0.5, 0.7, 0.8], [0.3, 0.2, 0.5, 0.6], 12);
            if (f.team === 1) this.later(5, () => {
              if (this.fvis.get(e.id) === v && this.phase !== "build") {
                v.holder.setEnabled(false);
              }
            });
          }
        } else if (e.t === "cast") {
          const f = b.byId(e.id);
          this.fxRing(f.x, f.z, new BABYLON.Color3(0.5, 0.8, 1), 0.15, 1.1, 0.35);
        } else if (e.t === "taunt") {
          const f = b.byId(e.id);
          this.fxRing(f.x, f.z, new BABYLON.Color3(1, 0.85, 0.3), 0.3, BALANCE.taunt.radius, 0.6);
        } else if (e.t === "smash") this.fxRing(e.x, e.z, new BABYLON.Color3(1, 0.5, 0.2), 0.2, e.r * 1.6, 0.45);
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
        this.later(0.25, home);
        this.later(2, done);
        return;
      }
      n.hurt();
      this.later(0.15, () => {
        const c = n.crystalPos();
        this.burst(c.x, c.z, [1, 0.3, 0.3, 0.9], [0.8, 0.1, 0.2, 0.6], 16);
      });
      if (kind === "final") {
        this.later(0.6, () => n.defeat());
        this.later(2.6, done);
        return;
      }
      this.later(1, () => {
        n.cast();
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
      this.tweens.length = 0;
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
  }).catch((e) => {
    const l = document.getElementById("loading");
    if (l) {
      l.style.display = "flex";
      l.textContent = "Error: " + (e && e.message ? e.message : e);
    }
    console.error(e);
  });
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2NvcmUvYmF0dGxlLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9zYXZlLnRzIiwgIi4uL2dhbWUvbmVjcm9tYW5jZXIudHMiLCAiLi4vZ2FtZS92aXN1YWxzLnRzIiwgIi4uL2dhbWUvdWkudHMiLCAiLi4vZ2FtZS9nYW1lLnRzIiwgIi4uL2dhbWUvbWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gU0lOR0xFIFNPVVJDRSBPRiBUUlVUSCBmb3IgZXZlcnkgbnVtYmVyIHRoYXQgYWZmZWN0cyBjb21iYXQuXG4vLyBUaGUgZGVidWcgcGFuZWwgZWRpdHMgQkFMQU5DRSBsaXZlOyBgcmVzZXRCYWxhbmNlKClgIHJlc3RvcmVzIHRoZXNlIGRlZmF1bHRzLlxuLy8gQWxsIHZhbHVlcyBhcmUgZmlyc3QtcGFzcyBndWVzc2VzIG1lYW50IHRvIGJlIHR1bmVkIGJ5IHBsYXlpbmcgYW5kIGJ5IGBub2RlIHNpbS9jYW1wYWlnbi50c2AuXG5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0U3RhdHMge1xuICBocDogbnVtYmVyOyAgICAgICAgIC8vIDEtc3RhciBoaXQgcG9pbnRzXG4gIGRtZzogbnVtYmVyOyAgICAgICAgLy8gMS1zdGFyIGRhbWFnZSBwZXIgaGl0IChwZXIgYXJyb3cgZm9yIHRoZSBBcmNoZXIpXG4gIGludGVydmFsOiBudW1iZXI7ICAgLy8gc2Vjb25kcyBiZXR3ZWVuIGF0dGFja3NcbiAgcmFuZ2U6IG51bWJlcjsgICAgICAvLyBtZXRyZXMgKGNlbnRyZSB0byBjZW50cmUpXG4gIHNwZWVkOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIHBlciBzZWNvbmRcbiAgc2l6ZTogbnVtYmVyOyAgICAgICAvLyBib2R5IHJhZGl1cywgdXNlZCBmb3Igc3BhY2luZyBhbmQgdmlzdWFsc1xuICBhbmltTGVuOiBudW1iZXI7ICAgIC8vIHNlY29uZHM6IGxlbmd0aCBvZiB0aGlzIHVuaXQncyBhdHRhY2sgY2xpcCBhdCBub3JtYWwgc3BlZWRcbiAgaGl0RnJhYzogbnVtYmVyOyAgICAvLyAwLTE6IGhvdyBmYXIgaW50byB0aGUgY2xpcCB0aGUgYmxvdyBsYW5kcyAvIHRoZSBhcnJvdyBpcyByZWxlYXNlZFxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEJhbGFuY2Uge1xuICBzdGF0czogUmVjb3JkPFNvdWxJZCwgVW5pdFN0YXRzPjtcbiAgc3Rhcjoge1xuICAgIGhwOiBudW1iZXJbXTsgICAgIC8vIG11bHRpcGxpZXIgYXQgMSwgMiwgMyBzdGFyc1xuICAgIGRtZzogbnVtYmVyW107XG4gICAgc2NhbGU6IG51bWJlcltdOyAgLy8gdmlzdWFsIHNpemVcbiAgfTtcbiAgcGhhbGFueDogeyByYWRpdXM6IG51bWJlcjsgcGVyQWxseTogbnVtYmVyOyBtYXhTdGFja3M6IG51bWJlciB9OyAgICAgICAgICAvLyBTa2VsZXRvbiBXYXJyaW9yXG4gIG1hbmE6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgeyBtYXg6IG51bWJlcjsgcGVyQXR0YWNrOiBudW1iZXI7IHBlckhpdDogbnVtYmVyIH0+PjsgLy8gdW5pdHMgV0lUSCBhIHNraWxsOyB0aGUgcmVzdCBhcmUgcGFzc2l2ZS1vbmx5XG4gIHZvbGxleTogeyB0YXJnZXRzOiBudW1iZXI7IHByb2plY3RpbGVTcGVlZDogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgLy8gU2tlbGV0b24gQXJjaGVyIHNraWxsOiBTcGxpdCBBcnJvd1xuICBvcHBvcnR1bmlzdDogeyBib251czogbnVtYmVyOyBzZWVrUmFkaXVzOiBudW1iZXI7IHdvdW5kZWRXZWlnaHQ6IG51bWJlciB9OyAvLyBHb2JsaW5cbiAgdGF1bnQ6IHsgZHVyYXRpb246IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBLbmlnaHQgc2tpbGxcbiAgc21hc2g6IHsgbXVsdDogbnVtYmVyOyByYWRpdXM6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBPZ3JlIHNraWxsXG4gIGZyZW56eTogeyBwZXJTd2luZzogbnVtYmVyOyBtYXhTdGFja3M6IG51bWJlcjsgcmVzZXRBZnRlcjogbnVtYmVyIH07ICAgICAgLy8gQmFyYmFyaWFuXG4gIC8qKiBQTEFDRUhPTERFUiBwZXJtYW5lbnQtbGV2ZWwgZ3Jvd3RoIChwZXIgbGV2ZWwgYWJvdmUgMSkuIFNob3duIG9uIHRoZSBTb3VscyBwYWdlOyBOT1QgYXBwbGllZCBpbiBiYXR0bGVzIHlldC4gKi9cbiAgbGV2ZWw6IHsgaHA6IG51bWJlcjsgZG1nOiBudW1iZXI7IGNvcGllc1RvTGV2ZWw6IG51bWJlcltdIH07XG4gIHNpbTogeyBzZXBhcmF0aW9uOiBudW1iZXI7IGhpdEZyYWN0aW9uOiBudW1iZXI7IHRpbWVMaW1pdDogbnVtYmVyOyByZXRhcmdldEV2ZXJ5OiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRTOiBCYWxhbmNlID0ge1xuICBzdGF0czoge1xuICAgIHdhcnJpb3I6ICAgeyBocDogNjAsICBkbWc6IDgsICBpbnRlcnZhbDogMC45LCByYW5nZTogMC44NSwgc3BlZWQ6IDEuNCwgc2l6ZTogMC4yOCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjQ3IH0sXG4gICAgYXJjaGVyOiAgICB7IGhwOiA0MCwgIGRtZzogNywgIGludGVydmFsOiAxLjcsIHJhbmdlOiA1LjAsICBzcGVlZDogMS4xLCBzaXplOiAwLjI2LCBhbmltTGVuOiAxLjUsIGhpdEZyYWM6IDAuNzggfSxcbiAgICBnb2JsaW46ICAgIHsgaHA6IDQ1LCAgZG1nOiA5LCAgaW50ZXJ2YWw6IDAuOCwgcmFuZ2U6IDAuOCwgIHNwZWVkOiAxLjcsIHNpemU6IDAuMjQsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAga25pZ2h0OiAgICB7IGhwOiAxMzAsIGRtZzogOSwgIGludGVydmFsOiAxLjEsIHJhbmdlOiAwLjksICBzcGVlZDogMS4wLCBzaXplOiAwLjMyLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIG9ncmU6ICAgICAgeyBocDogMTcwLCBkbWc6IDE2LCBpbnRlcnZhbDogMS45LCByYW5nZTogMS4wNSwgc3BlZWQ6IDAuOCwgc2l6ZTogMC40MiwgYW5pbUxlbjogMS4yLCBoaXRGcmFjOiAwLjU1IH0sXG4gICAgYmFyYmFyaWFuOiB7IGhwOiA3NSwgIGRtZzogOCwgIGludGVydmFsOiAwLjk1LCByYW5nZTogMC45LCBzcGVlZDogMS41LCBzaXplOiAwLjMwLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICB9LFxuICAvLyBcImJvZGllcyA9IGRhbWFnZSwgc3RhcnMgPSBkdXJhYmlsaXR5XCI6IEhQIGdyb3dzIGZhc3RlciB0aGFuIGRhbWFnZSBwZXIgc3RhclxuICBzdGFyOiB7IGhwOiBbMSwgMi4wLCAzLjJdLCBkbWc6IFsxLCAxLjUsIDIuMF0sIHNjYWxlOiBbMSwgMS4xMiwgMS4yNV0gfSxcbiAgcGhhbGFueDogeyByYWRpdXM6IDIuMCwgcGVyQWxseTogMC4wOCwgbWF4U3RhY2tzOiAzIH0sXG4gIC8vIG1hbmEgZmlsbHMgZmFzdDogYSBiYXNpYyBhdHRhY2sgZ2l2ZXMgcGVyQXR0YWNrLCB0YWtpbmcgYSBoaXQgZ2l2ZXMgcGVySGl0OyBhIGZ1bGwgYmFyIGZpcmVzIHRoZSBza2lsbCBvbiB0aGUgbmV4dCBhdHRhY2ssIHRoZW4gcmVzZXRzXG4gIG1hbmE6IHtcbiAgICBhcmNoZXI6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMzQsIHBlckhpdDogNiB9LCAgICAgLy8gU3BsaXQgQXJyb3cgYWJvdXQgZXZlcnkgM3JkIHNob3RcbiAgICBvZ3JlOiAgIHsgbWF4OiAxMDAsIHBlckF0dGFjazogMzQsIHBlckhpdDogNiB9LCAgICAgLy8gU21hc2ggYWJvdXQgZXZlcnkgM3JkIHN3aW5nXG4gICAga25pZ2h0OiB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDI1LCBwZXJIaXQ6IDEyIH0sICAgIC8vIFRhdW50IGV2ZXJ5IH40IHN3aW5ncywgc29vbmVyIHdoZW4gaGUgaXMgYmVpbmcgaGl0XG4gIH0sXG4gIHZvbGxleTogeyB0YXJnZXRzOiAzLCBwcm9qZWN0aWxlU3BlZWQ6IDE0IH0sXG4gIG9wcG9ydHVuaXN0OiB7IGJvbnVzOiAwLjUsIHNlZWtSYWRpdXM6IDQuMCwgd291bmRlZFdlaWdodDogMS41IH0sXG4gIHRhdW50OiB7IGR1cmF0aW9uOiAzLCByYWRpdXM6IDQuNSB9LFxuICBzbWFzaDogeyBtdWx0OiAyLjAsIHJhZGl1czogMS42IH0sXG4gIGZyZW56eTogeyBwZXJTd2luZzogMC4xMiwgbWF4U3RhY2tzOiA4LCByZXNldEFmdGVyOiAwLjYgfSxcbiAgbGV2ZWw6IHsgaHA6IDAuMDgsIGRtZzogMC4wOCwgY29waWVzVG9MZXZlbDogWzUsIDEwLCAyMCwgNDAsIDgwLCAxMjAsIDIwMCwgMzAwLCA1MDBdIH0sXG4gIHNpbTogeyBzZXBhcmF0aW9uOiAwLjYsIGhpdEZyYWN0aW9uOiAwLjQ3LCB0aW1lTGltaXQ6IDEyMCwgcmV0YXJnZXRFdmVyeTogMC41IH0sXG59O1xuXG5leHBvcnQgY29uc3QgQkFMQU5DRTogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0QmFsYW5jZSgpOiB2b2lkIHtcbiAgY29uc3QgZnJlc2g6IEJhbGFuY2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSk7XG4gIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhmcmVzaCkgYXMgKGtleW9mIEJhbGFuY2UpW10pIChCQUxBTkNFIGFzIGFueSlba10gPSAoZnJlc2ggYXMgYW55KVtrXTtcbn1cblxuZXhwb3J0IGNvbnN0IFJPTEVfVEVYVDogUmVjb3JkPFNvdWxJZCwgc3RyaW5nPiA9IHtcbiAgd2FycmlvcjogJ0NoZWFwIGFuZCBmYXN0LiBUb3VnaGVyIG5lYXIgb3RoZXIgV2FycmlvcnMuJyxcbiAgYXJjaGVyOiAnRnJhZ2lsZS4gU2tpbGw6IFNwbGl0IEFycm93IGhpdHMgMyBkaWZmZXJlbnQgZW5lbWllcy4nLFxuICBnb2JsaW46ICdGYXN0LiBIaXRzIGhhcmRlciBvbiBlbmVtaWVzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZS4nLFxuICBrbmlnaHQ6ICdUYW5rLiBTa2lsbDogVGF1bnQgcHVsbHMgZW5lbWllcyBvbnRvIGhpbS4nLFxuICBvZ3JlOiAnU2xvdywgaHVnZSBkYW1hZ2UuIFNraWxsOiBTbWFzaCwgYSBiaWcgYXJlYSBzbGFtLicsXG4gIGJhcmJhcmlhbjogJ1N3aW5ncyBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIGhpdC4nLFxufTtcblxuZXhwb3J0IGNvbnN0IFNPVUxfTkFNRTogUmVjb3JkPFNvdWxJZCwgc3RyaW5nPiA9IHtcbiAgd2FycmlvcjogJ1NrZWxldG9uIFdhcnJpb3InLCBhcmNoZXI6ICdTa2VsZXRvbiBBcmNoZXInLCBnb2JsaW46ICdHb2JsaW4nLFxuICBrbmlnaHQ6ICdLbmlnaHQnLCBvZ3JlOiAnT2dyZScsIGJhcmJhcmlhbjogJ0JhcmJhcmlhbicsXG59O1xuXG4vKiogQWJpbGl0eSBibHVyYnMgZm9yIHRoZSBTb3VscyBwYWdlLCB3aXRoIHRoZSBsaXZlIG51bWJlcnMgZmlsbGVkIGluLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFiaWxpdHlJbmZvKHNvdWw6IFNvdWxJZCk6IHsga2luZDogJ3NraWxsJyB8ICdwYXNzaXZlJzsgbmFtZTogc3RyaW5nOyB0ZXh0OiBzdHJpbmcgfSB7XG4gIGNvbnN0IEIgPSBCQUxBTkNFLCBwY3QgPSAoeDogbnVtYmVyKSA9PiBNYXRoLnJvdW5kKHggKiAxMDApICsgJyUnO1xuICBzd2l0Y2ggKHNvdWwpIHtcbiAgICBjYXNlICd3YXJyaW9yJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnUGhhbGFueCcsIHRleHQ6IGBUYWtlcyAke3BjdChCLnBoYWxhbngucGVyQWxseSl9IGxlc3MgZGFtYWdlIGZvciBlYWNoIG90aGVyIFNrZWxldG9uIFdhcnJpb3Igd2l0aGluICR7Qi5waGFsYW54LnJhZGl1c31tICh1cCB0byAke0IucGhhbGFueC5tYXhTdGFja3N9KS5gIH07XG4gICAgY2FzZSAnZ29ibGluJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnT3Bwb3J0dW5pc3QnLCB0ZXh0OiBgRGVhbHMgJHtwY3QoQi5vcHBvcnR1bmlzdC5ib251cyl9IG1vcmUgZGFtYWdlIHRvIGFuIGVuZW15IHRoYXQgaXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLCBhbmQgcHJlZmVycyBzdWNoIHRhcmdldHMuYCB9O1xuICAgIGNhc2UgJ2JhcmJhcmlhbic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ0ZyZW56eScsIHRleHQ6IGBBdHRhY2tzICR7cGN0KEIuZnJlbnp5LnBlclN3aW5nKX0gZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBzd2luZyAodXAgdG8gJHtCLmZyZW56eS5tYXhTdGFja3N9IHRpbWVzKS5gIH07XG4gICAgY2FzZSAnYXJjaGVyJzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1NwbGl0IEFycm93JywgdGV4dDogYEJhc2ljIHNob3RzIGZpcmUgb25lIGFycm93LiBXaGVuIG1hbmEgaXMgZnVsbCwgdGhlIG5leHQgc2hvdCBmaXJlcyBhdCB1cCB0byAke0Iudm9sbGV5LnRhcmdldHN9IGRpZmZlcmVudCBlbmVtaWVzLmAgfTtcbiAgICBjYXNlICdrbmlnaHQnOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnVGF1bnQnLCB0ZXh0OiBgV2hlbiBtYW5hIGlzIGZ1bGwsIGVuZW1pZXMgd2l0aGluICR7Qi50YXVudC5yYWRpdXN9bSBtdXN0IGF0dGFjayBoaW0gZm9yICR7Qi50YXVudC5kdXJhdGlvbn1zLmAgfTtcbiAgICBjYXNlICdvZ3JlJzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1NtYXNoJywgdGV4dDogYFdoZW4gbWFuYSBpcyBmdWxsLCB0aGUgbmV4dCBzd2luZyBkZWFscyAke0Iuc21hc2gubXVsdH14IGRhbWFnZSBhbmQgaGl0cyBlbmVtaWVzIG5lYXIgdGhlIHRhcmdldCBmb3IgNjAlIGFzIG11Y2guYCB9O1xuICB9XG59XG4iLCAiLy8gRGVzaWduIGRhdGEgc3RyYWlnaHQgZnJvbSB0aGUgcGxhbiBkb2MuIEFueXRoaW5nIG1hcmtlZCBQTEFDRUhPTERFUiBpcyBub3QgaW4gdGhlIGRvYyB5ZXQuXG5cbmV4cG9ydCB0eXBlIFNvdWxJZCA9ICd3YXJyaW9yJyB8ICdhcmNoZXInIHwgJ2dvYmxpbicgfCAna25pZ2h0JyB8ICdvZ3JlJyB8ICdiYXJiYXJpYW4nO1xuXG5leHBvcnQgY29uc3QgU09VTFM6IFNvdWxJZFtdID0gWyd3YXJyaW9yJywgJ2FyY2hlcicsICdnb2JsaW4nLCAna25pZ2h0JywgJ29ncmUnLCAnYmFyYmFyaWFuJ107XG5cbi8qKiBEb21pbmlvbiBjb3N0IHBlciBzdGFyIGxldmVsOiBpbmRleCAwID0gMSBzdGFyLCAxID0gMiBzdGFycywgMiA9IDMgc3RhcnMgKDMgc3RhcnMgaXMgdGhlIG1heCkuICovXG5leHBvcnQgY29uc3QgQ09TVDogUmVjb3JkPFNvdWxJZCwgbnVtYmVyW10+ID0ge1xuICB3YXJyaW9yOiBbMiwgMywgNF0sXG4gIGFyY2hlcjogWzQsIDYsIDldLFxuICBnb2JsaW46IFszLCA0LCA2XSxcbiAga25pZ2h0OiBbNSwgNywgMTBdLFxuICBvZ3JlOiBbNywgMTAsIDE1XSxcbiAgYmFyYmFyaWFuOiBbNSwgNywgMTBdLCAvLyBQTEFDRUhPTERFUjogdGhlIGRvYyBoYXMgbm8gY29zdCBmb3IgdGhlIHNpeHRoIFNvdWwgeWV0XG59O1xuXG5leHBvcnQgY29uc3QgTUFYX1NUQVIgPSAzO1xuZXhwb3J0IGNvbnN0IEdSSURfQ0VMTFMgPSAxMjsgLy8gNCB4IDNcblxuLyoqIERvbWluaW9uIGNhcCBwZXIgd2F2ZSAoaW5kZXggMCA9IHdhdmUgMSkuICovXG5leHBvcnQgY29uc3QgQ1VSVkVTOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT4gPSB7XG4gIC8vIExPQ0tFRCAoY29uZmlybWVkKTogKzQgZm9yIHdhdmVzIDItNSwgdGhlbiArMyBmb3Igd2F2ZXMgNi0xMCAtPiA0MFxuICBkb2M6IFs5LCAxMywgMTcsIDIxLCAyNSwgMjgsIDMxLCAzNCwgMzcsIDQwXSxcbiAgLy8gTk9UIFVTRUQ6IG1pc3JlbWVtYmVyZWQgdmFyaWFudCAoKzMgdGhyb3VnaCB3YXZlIDYsIHRoZW4gKzIpIHRoYXQgb25seSByZWFjaGVzIDMyLiBLZXB0IGZvciBjb21wYXJpc29uIG9ubHkuXG4gIHJlY2FsbGVkOiBbOSwgMTIsIDE1LCAxOCwgMjEsIDI0LCAyNiwgMjgsIDMwLCAzMl0sXG59O1xuXG5leHBvcnQgY29uc3QgSEVBUlRTID0gMztcbmV4cG9ydCBjb25zdCBTVEFSVF9IQU5EID0gNDtcbmV4cG9ydCBjb25zdCBXQVZFUyA9IDEwO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJ1bGVzIHtcbiAgLyoqIERvbWluaW9uIGNhcCBwZXIgd2F2ZS4gKi9cbiAgY3VydmU6IG51bWJlcltdO1xuICAvKipcbiAgICogJ2RlcGxveWVkT25seSc6IG9ubHkgdHdvIGRlcGxveWVkIHVuaXRzIG9mIHRoZSBzYW1lIHN0YXIgY2FuIG1lcmdlIChkb2MgYXMgd3JpdHRlbikuXG4gICAqICdoYW5kSW50b09uZVN0YXInOiBhZGRpdGlvbmFsbHkgYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBiZSBwbGF5ZWQgb250byBhIGRlcGxveWVkXG4gICAqIDEtc3RhciB1bml0IG9mIHRoZSBzYW1lIFNvdWwgdG8gbWVyZ2UgaW1tZWRpYXRlbHkgKHBheXMgb25seSB0aGUgY29zdCBkaWZmZXJlbmNlKS5cbiAgICovXG4gIG1lcmdlOiAnZGVwbG95ZWRPbmx5JyB8ICdoYW5kSW50b09uZVN0YXInO1xuICAvKiogQ2FyZC1pbmZsb3cga25vYnMgKGFsbCBvcHRpb25hbDsgZGVmYXVsdHMgcmVwcm9kdWNlIHRoZSBkb2MpLiAqL1xuICBzdGFydEhhbmQ/OiBudW1iZXI7ICAgICAgICAgICAgLy8gZGVmYXVsdCA0XG4gIGRyYWZ0UGlja3M/OiBudW1iZXI7ICAgICAgICAgICAvLyBjYXJkcyBrZXB0IGZyb20gdGhlIDMtY2FyZCBWaWN0b3J5IERyYWZ0LCBkZWZhdWx0IDFcbiAgbm9ybWFsRHJhd1dhdmVzPzogbnVtYmVyW107ICAgIC8vIHdhdmVzIChiZWluZyBlbnRlcmVkKSB0aGF0IGFsc28gZ2l2ZSB0aGUgbm9ybWFsIHJhbmRvbSBkcmF3OyBkZWZhdWx0ID0gYWxsXG4gIC8qKiBTb3VscyB0aGlzIHJ1biBtYXkgZHJhdyBmcm9tICh0aGUgZXF1aXBwZWQgU291bCBEZWNrLCBtYXggNikuIERlZmF1bHQ6IGV2ZXJ5IFNvdWwuICovXG4gIHBvb2w/OiBTb3VsSWRbXTtcbiAgc3RhZ2VXYXZlcz86IG51bWJlcjsgICAgICAgICAgIC8vIHdhdmVzIGluIHRoaXMgc3RhZ2U7IGRlZmF1bHQgMTAgKHRoZSBwbGF5YWJsZSBwcm90b3R5cGUgdXNlcyAzKVxufVxuXG5leHBvcnQgY29uc3QgR1JJRF9DT0xTID0gNCwgR1JJRF9ST1dTID0gMzsgICAvLyA0IHggMyA9IEdSSURfQ0VMTFM7IGNvbHVtbiBHUklEX0NPTFMtMSBpcyB0aGUgZnJvbnQgbGluZVxuIiwgIi8vIFNtYWxsIHNlZWRlZCBSTkcgKG11bGJlcnJ5MzIpLiBTYW1lIHNlZWQgLT4gc2FtZSBydW4sIHNvIGFueSBidWcgcmVwb3J0IGlzIHJlcHJvZHVjaWJsZS5cblxuZXhwb3J0IGludGVyZmFjZSBSbmcge1xuICBuZXh0KCk6IG51bWJlcjsgICAgICAgICAgICAgIC8vIFswLCAxKVxuICBpbnQobjogbnVtYmVyKTogbnVtYmVyOyAgICAgIC8vIFswLCBuKVxuICBwaWNrPFQ+KGl0ZW1zOiByZWFkb25seSBUW10pOiBUO1xuICBzZWVkOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYWtlUm5nKHNlZWQ6IG51bWJlcik6IFJuZyB7XG4gIGxldCBhID0gc2VlZCA+Pj4gMDtcbiAgY29uc3QgbmV4dCA9ICgpID0+IHtcbiAgICBhID0gKGEgKyAweDZkMmI3OWY1KSA+Pj4gMDtcbiAgICBsZXQgdCA9IGE7XG4gICAgdCA9IE1hdGguaW11bCh0IF4gKHQgPj4+IDE1KSwgdCB8IDEpO1xuICAgIHQgXj0gdCArIE1hdGguaW11bCh0IF4gKHQgPj4+IDcpLCB0IHwgNjEpO1xuICAgIHJldHVybiAoKHQgXiAodCA+Pj4gMTQpKSA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xuICB9O1xuICByZXR1cm4ge1xuICAgIHNlZWQsXG4gICAgbmV4dCxcbiAgICBpbnQ6IChuKSA9PiBNYXRoLmZsb29yKG5leHQoKSAqIG4pLFxuICAgIHBpY2s6IChpdGVtcykgPT4gaXRlbXNbTWF0aC5mbG9vcihuZXh0KCkgKiBpdGVtcy5sZW5ndGgpXSxcbiAgfTtcbn1cbiIsICIvLyBQdXJlIGdhbWUgcnVsZXMgZm9yIG9uZSBzdGFnZS4gTm8gZ3JhcGhpY3MsIG5vIGNvbWJhdDoganVzdCBjYXJkcywgRG9taW5pb24sIGdyaWQsIG1lcmdlLCB3YXZlcywgaGVhcnRzLlxuLy8gRXZlcnkgbXV0YXRpb24gZ29lcyB0aHJvdWdoIGEgZnVuY3Rpb24gaGVyZSBhbmQgYXBwZW5kcyB0byBzdGF0ZS5sb2csIHNvIHJ1bnMgY2FuIGJlIHJlcGxheWVkIGFuZCBpbnNwZWN0ZWQuXG5cbmltcG9ydCB7IENPU1QsIEdSSURfQ0VMTFMsIEhFQVJUUywgTUFYX1NUQVIsIFNPVUxTLCBTVEFSVF9IQU5ELCBXQVZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzLCBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXQgeyBpZDogbnVtYmVyOyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyOyBmcmVzaD86IGJvb2xlYW4gfSAgIC8vIGZyZXNoID0gc3VtbW9uZWQgdGhpcyBidWlsZCBwaGFzZVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0YXRlIHtcbiAgcnVsZXM6IFJ1bGVzO1xuICBybmc6IFJuZztcbiAgd2F2ZTogbnVtYmVyOyAgICAgICAgICAgICAgICAgLy8gMS1iYXNlZFxuICBoZWFydHM6IG51bWJlcjtcbiAgY2FwOiBudW1iZXI7XG4gIGhhbmQ6IFNvdWxJZFtdO1xuICB1bml0czogVW5pdFtdO1xuICBuZXh0SWQ6IG51bWJlcjtcbiAgZGlzY2FyZFVzZWQ6IGJvb2xlYW47ICAgICAgICAgLy8gb25jZS1wZXItYnVpbGQtcGhhc2UgcmVkcmF3XG4gIHN0YXR1czogJ2J1aWxkaW5nJyB8ICd3b24nIHwgJ2xvc3QnO1xuICBsb2c6IHN0cmluZ1tdO1xuICBzdGF0czogeyBkcmF3bjogbnVtYmVyOyBkaXNjYXJkZWQ6IG51bWJlcjsgZGlzbWlzc2VkOiBudW1iZXI7IG1lcmdlczogbnVtYmVyOyBmYWlsdXJlczogbnVtYmVyIH07XG59XG5cbmV4cG9ydCBjb25zdCBjb3N0ID0gKHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyKTogbnVtYmVyID0+IENPU1Rbc291bF1bc3RhciAtIDFdO1xuZXhwb3J0IGNvbnN0IGNhcmRzSW4gPSAoc3RhcjogbnVtYmVyKTogbnVtYmVyID0+IDIgKiogKHN0YXIgLSAxKTsgICAgIC8vIGNhcmRzIGEgdW5pdCBpcyBcIndvcnRoXCJcbmV4cG9ydCBjb25zdCBkb21pbmlvblVzZWQgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy51bml0cy5yZWR1Y2UoKG4sIHUpID0+IG4gKyBjb3N0KHUuc291bCwgdS5zdGFyKSwgMCk7XG5leHBvcnQgY29uc3QgZG9taW5pb25GcmVlID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMuY2FwIC0gZG9taW5pb25Vc2VkKHMpO1xuXG5mdW5jdGlvbiBsb2coczogU3RhdGUsIG1zZzogc3RyaW5nKSB7IHMubG9nLnB1c2goYFt3JHtzLndhdmV9XSAke21zZ31gKTsgfVxuLyoqIFRoZSBTb3VscyB0aGlzIHJ1biBkcmF3cyBmcm9tOiB0aGUgZXF1aXBwZWQgZGVjaywgb3IgZXZlcnl0aGluZyBpZiBubyBkZWNrIHdhcyBnaXZlbi4gKi9cbmV4cG9ydCBjb25zdCBwb29sT2YgPSAoczogU3RhdGUpOiBTb3VsSWRbXSA9PiAocy5ydWxlcy5wb29sICYmIHMucnVsZXMucG9vbC5sZW5ndGggPyBzLnJ1bGVzLnBvb2wgOiBTT1VMUyk7XG5mdW5jdGlvbiBkcmF3KHM6IFN0YXRlLCB3aHk6IHN0cmluZywgbm90PzogU291bElkKTogU291bElkIHtcbiAgY29uc3QgYWxsID0gcG9vbE9mKHMpLCBvdGhlcnMgPSBub3QgPyBhbGwuZmlsdGVyKCh4KSA9PiB4ICE9PSBub3QpIDogYWxsO1xuICBjb25zdCBwb29sID0gb3RoZXJzLmxlbmd0aCA/IG90aGVycyA6IGFsbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgc3dhcCBuZXZlciBoYW5kcyB5b3UgYmFjayB0aGUgU291bCB5b3UgZ2F2ZSB1cCAodW5sZXNzIGl0IGlzIHRoZSBvbmx5IG9uZSBlcXVpcHBlZClcbiAgY29uc3QgYyA9IHMucm5nLnBpY2socG9vbCk7XG4gIHMuaGFuZC5wdXNoKGMpOyBzLnN0YXRzLmRyYXduKys7XG4gIGxvZyhzLCBgZHJhdyAke2N9ICgke3doeX0pYCk7XG4gIHJldHVybiBjO1xufVxuXG4vKiogQSBuZXcgYnVpbGQgcGhhc2UgYmVnaW5zOiB0aGUgb25jZS1wZXItcGhhc2Ugc3dhcCBjb21lcyBiYWNrIGFuZCBub3RoaW5nIGNvdW50cyBhcyBcInN1bW1vbmVkIHRoaXMgcm91bmRcIi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuZXdQaGFzZShzOiBTdGF0ZSk6IHZvaWQge1xuICBzLmRpc2NhcmRVc2VkID0gZmFsc2U7XG4gIGZvciAoY29uc3QgdSBvZiBzLnVuaXRzKSB1LmZyZXNoID0gZmFsc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBuZXdTdGFnZShydWxlczogUnVsZXMsIHNlZWQ6IG51bWJlcik6IFN0YXRlIHtcbiAgY29uc3QgczogU3RhdGUgPSB7XG4gICAgcnVsZXMsIHJuZzogbWFrZVJuZyhzZWVkKSwgd2F2ZTogMSwgaGVhcnRzOiBIRUFSVFMsIGNhcDogcnVsZXMuY3VydmVbMF0sIGhhbmQ6IFtdLCB1bml0czogW10sIG5leHRJZDogMSxcbiAgICBkaXNjYXJkVXNlZDogZmFsc2UsIHN0YXR1czogJ2J1aWxkaW5nJywgbG9nOiBbXSxcbiAgICBzdGF0czogeyBkcmF3bjogMCwgZGlzY2FyZGVkOiAwLCBkaXNtaXNzZWQ6IDAsIG1lcmdlczogMCwgZmFpbHVyZXM6IDAgfSxcbiAgfTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAocnVsZXMuc3RhcnRIYW5kID8/IFNUQVJUX0hBTkQpOyBpKyspIGRyYXcocywgJ3N0YXJ0aW5nIGhhbmQnKTtcbiAgcmV0dXJuIHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmcmVlQ2VsbChzOiBTdGF0ZSk6IG51bWJlciB7XG4gIGNvbnN0IHRha2VuID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoIXRha2VuLmhhcyhjKSkgcmV0dXJuIGM7XG4gIHJldHVybiAtMTtcbn1cblxuLy8gLS0tLSBidWlsZC1waGFzZSBhY3Rpb25zIChlYWNoIHJldHVybnMgdHJ1ZSB3aGVuIGl0IGhhcHBlbmVkKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF07XG4gIHJldHVybiBzb3VsICE9PSB1bmRlZmluZWQgJiYgZnJlZUNlbGwocykgPj0gMCAmJiBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNlbGxGcmVlKHM6IFN0YXRlLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgcmV0dXJuIGNlbGwgPj0gMCAmJiBjZWxsIDwgR1JJRF9DRUxMUyAmJiAhcy51bml0cy5zb21lKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpO1xufVxuXG4vKiogU3VtbW9uIGEgaGFuZCBjYXJkIG9udG8gYSBzcGVjaWZpYyBmcmVlIGNlbGwgKGRlZmF1bHQ6IHRoZSBmaXJzdCBmcmVlIG9uZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIGNlbGw/OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5TdW1tb24ocywgaGFuZElkeCkpIHJldHVybiBmYWxzZTtcbiAgaWYgKGNlbGwgIT09IHVuZGVmaW5lZCAmJiAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHU6IFVuaXQgPSB7IGlkOiBzLm5leHRJZCsrLCBzb3VsLCBzdGFyOiAxLCBjZWxsOiBjZWxsID8/IGZyZWVDZWxsKHMpLCBmcmVzaDogdHJ1ZSB9O1xuICBzLnVuaXRzLnB1c2godSk7XG4gIGxvZyhzLCBgc3VtbW9uICR7c291bH0gMSogLT4gY2VsbCAke3UuY2VsbH0gIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VEZXBsb3llZChhOiBVbml0LCBiOiBVbml0KTogYm9vbGVhbiB7XG4gIHJldHVybiBhLmlkICE9PSBiLmlkICYmIGEuc291bCA9PT0gYi5zb3VsICYmIGEuc3RhciA9PT0gYi5zdGFyICYmIGEuc3RhciA8IE1BWF9TVEFSO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VEZXBsb3llZChzOiBTdGF0ZSwgYUlkOiBudW1iZXIsIGJJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGFJZCksIGIgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGJJZCk7XG4gIGlmICghYSB8fCAhYiB8fCAhY2FuTWVyZ2VEZXBsb3llZChhLCBiKSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHUpID0+IHUuaWQgIT09IGIuaWQpO1xuICBhLmZyZXNoID0gISEoYS5mcmVzaCB8fCBiLmZyZXNoKTtcbiAgYS5zdGFyKys7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UgJHthLnNvdWx9ICR7YS5zdGFyIC0gMX0qKyR7YS5zdGFyIC0gMX0qIC0+ICR7YS5zdGFyfSogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0sIGNlbGxzICR7cy51bml0cy5sZW5ndGh9LyR7R1JJRF9DRUxMU30pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogJ2hhbmRJbnRvT25lU3RhcicgcnVsZTogcGxheSBhIDEtc3RhciBjYXJkIG9udG8gYSBkZXBsb3llZCAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMucnVsZXMubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF0sIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghc291bCB8fCAhdSB8fCB1LnNvdWwgIT09IHNvdWwgfHwgdS5zdGFyICE9PSAxKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBjb3N0KHNvdWwsIDIpIC0gY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuTWVyZ2VGcm9tSGFuZChzLCBoYW5kSWR4LCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgdS5zdGFyID0gMjtcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZS1mcm9tLWhhbmQgJHtzb3VsfSAtPiAke3Uuc291bH0gMiogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGlzbWlzcyhzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1KSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYGRpc21pc3MgJHt1LnNvdWx9ICR7dS5zdGFyfSogKHBlcm1hbmVudGx5IHJlbW92ZWQpYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMTogZGlzY2FyZCBhIGhhbmQgY2FyZCBhbmQgZHJhdyBhIHJhbmRvbSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzY2FyZFJlZHJhdyhzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLmRpc2NhcmRVc2VkIHx8IGhhbmRJZHggPCAwIHx8IGhhbmRJZHggPj0gcy5oYW5kLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzY2FyZGVkKys7XG4gIGxvZyhzLCBgc3dhcDogZGlzY2FyZCAke2N9YCk7XG4gIGRyYXcocywgJ3N3YXAnLCBjKTtcbiAgcmV0dXJuIHRydWU7XG59XG5leHBvcnQgY29uc3Qgc3dhcERpc2NhcmQgPSBkaXNjYXJkUmVkcmF3O1xuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIHJldHVybiAhcy5kaXNjYXJkVXNlZCAmJiAhIXUgJiYgIXUuZnJlc2g7ICAgICAgICAgIC8vIGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kXG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAyOiBzZWxsIGEgZGVwbG95ZWQgdW5pdCAobm90IG9uZSBzdW1tb25lZCB0aGlzIHJvdW5kKSBhbmQgZHJhdyBhIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzd2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5Td2FwU2VsbChzLCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgc3dhcDogc2VsbCAke3Uuc291bH0gJHt1LnN0YXJ9KmApO1xuICBkcmF3KHMsICdzd2FwJywgdS5zb3VsKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtb3ZlVW5pdChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUgfHwgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGxvZyhzLCBgbW92ZSAke3Uuc291bH0gY2VsbCAke3UuY2VsbH0gLT4gJHtjZWxsfWApOyB1LmNlbGwgPSBjZWxsOyByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gLS0tLSB3YXZlIHJlc3VsdHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRHJhZnQgY2hvaWNlcyBmb3IgYWZ0ZXIgYSBjbGVhcmVkIHdhdmU6IDMgcmFuZG9tIGNhcmRzLCBkdXBsaWNhdGVzIGFsbG93ZWQuICovXG5leHBvcnQgZnVuY3Rpb24gZHJhZnRPcHRpb25zKHM6IFN0YXRlKTogU291bElkW10ge1xuICBjb25zdCBwID0gcG9vbE9mKHMpO1xuICByZXR1cm4gW3Mucm5nLnBpY2socCksIHMucm5nLnBpY2socCksIHMucm5nLnBpY2socCldO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkOiByYWlzZSB0aGUgY2FwLCByZXNvbHZlIHRoZSBWaWN0b3J5IERyYWZ0LCBkcmF3IDEgbm9ybWFsIGNhcmQuICovXG5leHBvcnQgY29uc3Qgc3RhZ2VXYXZlcyA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnJ1bGVzLnN0YWdlV2F2ZXMgPz8gV0FWRVM7XG5cbi8qKiBTdGVwIDEgb2YgYSBjbGVhcmVkIHdhdmU6IGlzIHRoZSBzdGFnZSBvdmVyPyBJZiBub3QsIHJhaXNlIHRoZSBjYXAgYW5kIHN0YXJ0IHRoZSBuZXh0IGJ1aWxkIHBoYXNlLiBSZXR1cm5zIHRydWUgd2hlbiB0aGUgc3RhZ2UgaXMgd29uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2VXYXZlKHM6IFN0YXRlKTogYm9vbGVhbiB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuIHMuc3RhdHVzID09PSAnd29uJztcbiAgaWYgKHMud2F2ZSA+PSBzdGFnZVdhdmVzKHMpKSB7IHMuc3RhdHVzID0gJ3dvbic7IGxvZyhzLCAnc3RhZ2UgY2xlYXJlZCcpOyByZXR1cm4gdHJ1ZTsgfVxuICBzLndhdmUrKztcbiAgcy5jYXAgPSBzLnJ1bGVzLmN1cnZlW3Mud2F2ZSAtIDFdO1xuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGB3YXZlIGNsZWFyZWQgLT4gY2FwICR7cy5jYXB9YCk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFN0ZXAgMjogdGhlIHBsYXllciBrZXB0IGBpZHhgIGZyb20gdGhlIG9mZmVyZWQgZHJhZnQgY2FyZHMuICovXG5leHBvcnQgZnVuY3Rpb24gdGFrZURyYWZ0KHM6IFN0YXRlLCBvcHRzOiBTb3VsSWRbXSwgaWR4OiBudW1iZXIpOiB2b2lkIHtcbiAgY29uc3QgcGljayA9IG9wdHNbTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBpZHgpKV07XG4gIHMuaGFuZC5wdXNoKHBpY2spOyBzLnN0YXRzLmRyYXduKys7XG4gIGxvZyhzLCBgZHJhZnQgWyR7b3B0cy5qb2luKCcsICcpfV0gLT4gdG9vayAke3BpY2t9YCk7XG59XG5cbi8qKiBTdGVwIDM6IHRoZSBib251cyBub3JtYWwgZHJhdyAob25seSBvbiB0aGUgd2F2ZXMgdGhlIHJ1bGVzIGFsbG93KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxEcmF3KHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcyA/IHMucnVsZXMubm9ybWFsRHJhd1dhdmVzLmluY2x1ZGVzKHMud2F2ZSkgOiB0cnVlKSBkcmF3KHMsICd3YXZlIGNsZWFyJyk7XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQgKGFsbCB0aHJlZSBzdGVwcyBpbiBvbmUgY2FsbCwgZm9yIHNpbXVsYXRpb25zKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhcldhdmUoczogU3RhdGUsIGNob29zZTogKG9wdHM6IFNvdWxJZFtdKSA9PiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKGFkdmFuY2VXYXZlKHMpKSByZXR1cm47XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBsZXQgb3B0cyA9IGRyYWZ0T3B0aW9ucyhzKTtcbiAgY29uc3Qgb2ZmZXJlZCA9IG9wdHMuam9pbignLCAnKTtcbiAgY29uc3QgdG9vazogU291bElkW10gPSBbXTtcbiAgZm9yIChsZXQgcCA9IDA7IHAgPCAocy5ydWxlcy5kcmFmdFBpY2tzID8/IDEpOyBwKyspIHtcbiAgICBjb25zdCBpZHggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGNob29zZShvcHRzKSkpO1xuICAgIHRvb2sucHVzaChvcHRzW2lkeF0pOyBzLmhhbmQucHVzaChvcHRzW2lkeF0pOyBzLnN0YXRzLmRyYXduKys7XG4gICAgb3B0cyA9IG9wdHMuZmlsdGVyKChfLCBpKSA9PiBpICE9PSBpZHgpO1xuICB9XG4gIGxvZyhzLCBgZHJhZnQgWyR7b2ZmZXJlZH1dIC0+IHRvb2sgJHt0b29rLmpvaW4oJywgJyl9YCk7XG4gIG5vcm1hbERyYXcocyk7XG59XG5cbi8qKiBBcm15IHdpcGVkOiBsb3NlIGEgaGVhcnQsIGNhcCBkb2VzIE5PVCByaXNlLCBlbmVtaWVzIHJlc2V0LCArMSBjYXJkLCByZWRyYXcgYWxsb3dlZCBhZ2Fpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmYWlsV2F2ZShzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgcy5oZWFydHMtLTsgcy5zdGF0cy5mYWlsdXJlcysrO1xuICBpZiAocy5oZWFydHMgPD0gMCkgeyBzLnN0YXR1cyA9ICdsb3N0JzsgbG9nKHMsICdubyBoZWFydHMgbGVmdDogc3RhZ2UgbG9zdCcpOyByZXR1cm47IH1cbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgYXJteSB3aXBlZDogaGVhcnRzICR7cy5oZWFydHN9LCBjYXAgc3RheXMgJHtzLmNhcH1gKTtcbiAgZHJhdyhzLCAnZmFpbGVkIGF0dGVtcHQnKTtcbn1cblxuLy8gLS0tLSBpbnZhcmlhbnRzIChjYWxsZWQgYnkgdGhlIHNpbXVsYXRvciBhZnRlciBldmVyeSB3YXZlOyB0aHJvdyB3aXRoIGEgcmVhZGFibGUgbWVzc2FnZSkgLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2hlY2tJbnZhcmlhbnRzKHM6IFN0YXRlKTogdm9pZCB7XG4gIGNvbnN0IGZhaWwgPSAobTogc3RyaW5nKSA9PiB7IHRocm93IG5ldyBFcnJvcihgSU5WQVJJQU5UICR7bX1cXG5gICsgcy5sb2cuc2xpY2UoLTEyKS5qb2luKCdcXG4nKSk7IH07XG4gIGlmIChzLnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIGZhaWwoYG1vcmUgdW5pdHMgKCR7cy51bml0cy5sZW5ndGh9KSB0aGFuIGNlbGxzYCk7XG4gIGNvbnN0IGNlbGxzID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGlmIChjZWxscy5zaXplICE9PSBzLnVuaXRzLmxlbmd0aCkgZmFpbCgndHdvIHVuaXRzIHNoYXJlIGEgY2VsbCcpO1xuICBpZiAoZG9taW5pb25Vc2VkKHMpID4gcy5jYXApIGZhaWwoYGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfSBleGNlZWRzIGNhcCAke3MuY2FwfWApO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgaWYgKHUuc3RhciA8IDEgfHwgdS5zdGFyID4gTUFYX1NUQVIpIGZhaWwoYHVuaXQgc3RhciAke3Uuc3Rhcn0gb3V0IG9mIHJhbmdlYCk7XG4gIC8vIGV2ZXJ5IGRyYXduIGNhcmQgaXMgZWl0aGVyIGluIGhhbmQsIHdvcnRoIGNhcmRzIG9uIHRoZSBmaWVsZCwgZGlzY2FyZGVkLCBvciBkaXNtaXNzZWRcbiAgY29uc3Qgb25GaWVsZCA9IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY2FyZHNJbih1LnN0YXIpLCAwKTtcbiAgY29uc3QgYWNjb3VudGVkID0gcy5oYW5kLmxlbmd0aCArIG9uRmllbGQgKyBzLnN0YXRzLmRpc2NhcmRlZCArIHMuc3RhdHMuZGlzbWlzc2VkO1xuICBpZiAoYWNjb3VudGVkICE9PSBzLnN0YXRzLmRyYXduKSBmYWlsKGBjYXJkIGNvbnNlcnZhdGlvbjogZHJhd24gJHtzLnN0YXRzLmRyYXdufSAhPSBhY2NvdW50ZWQgJHthY2NvdW50ZWR9YCk7XG59XG4iLCAiLy8gQXV0by1iYXR0bGUgc2ltdWxhdGlvbjogcHVyZSBsb2dpYywgbm8gZ3JhcGhpY3MuIERldGVybWluaXN0aWMgZm9yIGEgZ2l2ZW4gc2VlZC5cbi8vIFRoZSByZW5kZXJlciBvbmx5IHJlYWRzIGZpZ2h0ZXJzICsgZXZlbnRzOyBpdCBuZXZlciBkZWNpZGVzIGFueXRoaW5nLlxuLy9cbi8vIEFiaWxpdGllcyAobnVtYmVycyBsaXZlIGluIGJhbGFuY2UudHMpOlxuLy8gICBTa2VsZXRvbiBXYXJyaW9yICBQaGFsYW54ICAgICB0YWtlcyBsZXNzIGRhbWFnZSBmb3IgZWFjaCBuZWFyYnkgYWxsaWVkIFdhcnJpb3IgKGNhcHBlZClcbi8vICAgU2tlbGV0b24gQXJjaGVyICAgU3BsaXQgQXJyb3cgKHNraWxsKSBvbmUgYXJyb3cgYXQgZWFjaCBvZiB1cCB0byAzIGRpZmZlcmVudCBlbmVtaWVzOyBiYXNpYyBzaG90cyBhcmUgYSBzaW5nbGUgYXJyb3dcbi8vICAgR29ibGluICAgICAgICAgICAgT3Bwb3J0dW5pc3QgK2RhbWFnZSBvbiBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZTsgcHJlZmVycyBzdWNoIHRhcmdldHNcbi8vICAgS25pZ2h0ICAgICAgICAgICAgVGF1bnQgKHNraWxsKSAgZm9yY2VzIG5lYXJieSBlbmVtaWVzIHRvIGF0dGFjayBoaW1cbi8vICAgT2dyZSAgICAgICAgICAgICAgU21hc2ggKHNraWxsKSAgaGVhdnkgc2xhbSB0aGF0IGFsc28gaGl0cyBlbmVtaWVzIG5lYXIgdGhlIGltcGFjdFxuLy8gU2tpbGxzIHJ1biBvbiBtYW5hOiBiYXNpYyBhdHRhY2tzIGFuZCBkYW1hZ2UgdGFrZW4gZmlsbCBhIGJhcjsgd2hlbiBmdWxsLCB0aGUgbmV4dCBhdHRhY2sgaXMgdGhlIHNraWxsIGFuZCB0aGUgYmFyIHJlc2V0cy5cbi8vIFdhcnJpb3IsIEdvYmxpbiBhbmQgQmFyYmFyaWFuIGhhdmUgcGFzc2l2ZXMgb25seSAobm8gbWFuYSkuXG4vLyAgIEJhcmJhcmlhbiAgICAgICAgIEZyZW56eSAgICAgIGF0dGFja3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBzd2luZ1xuXG5pbXBvcnQgeyBHUklEX0NPTFMsIEdSSURfUk9XUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi9iYWxhbmNlLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGNvbnN0IEdSSURfU1AgPSAxLjM7ICAgICAvLyBtZXRyZXMgYmV0d2VlbiBncmlkIGNlbGxzXG5leHBvcnQgY29uc3QgRlJPTlRfWCA9IDEuNzsgICAgIC8vIGZyb250IGxpbmUncyBkaXN0YW5jZSBmcm9tIHRoZSBjZW50cmUgbGluZVxuXG5leHBvcnQgaW50ZXJmYWNlIFNsb3QgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgU3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyIH1cblxuLyoqIFdvcmxkIHBvc2l0aW9uIG9mIGEgZ3JpZCBjZWxsIGZvciBhIHRlYW0gKHRlYW0gMCA9IGxlZnQsIGZhY2VzICtYOyB0ZWFtIDEgPSByaWdodCwgZmFjZXMgLVgpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNlbGxQb3ModGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcik6IHsgeDogbnVtYmVyOyB6OiBudW1iZXIgfSB7XG4gIGNvbnN0IHJvdyA9IE1hdGguZmxvb3IoY2VsbCAvIEdSSURfQ09MUyksIGNvbCA9IGNlbGwgJSBHUklEX0NPTFM7XG4gIGNvbnN0IGRlcHRoID0gR1JJRF9DT0xTIC0gMSAtIGNvbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIDAgPSBmcm9udCBsaW5lXG4gIHJldHVybiB7IHg6IChGUk9OVF9YICsgZGVwdGggKiBHUklEX1NQKSAqICh0ZWFtID09PSAwID8gLTEgOiAxKSwgejogKHJvdyAtIChHUklEX1JPV1MgLSAxKSAvIDIpICogR1JJRF9TUCB9O1xufVxuXG5jb25zdCBGUk9OVE5FU1M6IFJlY29yZDxTb3VsSWQsIG51bWJlcj4gPSB7IGtuaWdodDogNSwgb2dyZTogNCwgd2FycmlvcjogMywgYmFyYmFyaWFuOiAzLCBnb2JsaW46IDIsIGFyY2hlcjogMCB9O1xuLyoqIFRoZSBlbmVteSBhcm15IGlzIHBsYWNlZCBhdXRvbWF0aWNhbGx5ICh0YW5rcyB1cCBmcm9udCwgYXJjaGVycyBiZWhpbmQpOyB0aGUgcGxheWVyIG9ubHkgZXZlciBzZWVzIGl0cyBjb21wb3NpdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteUNlbGxzKHNwZWNzOiBTcGVjW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IGNlbGxzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ09MUyAqIEdSSURfUk9XUzsgYysrKSBjZWxscy5wdXNoKGMpO1xuICBjZWxscy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgZGEgPSBHUklEX0NPTFMgLSAxIC0gKGEgJSBHUklEX0NPTFMpLCBkYiA9IEdSSURfQ09MUyAtIDEgLSAoYiAlIEdSSURfQ09MUyk7XG4gICAgaWYgKGRhICE9PSBkYikgcmV0dXJuIGRhIC0gZGI7XG4gICAgcmV0dXJuIE1hdGguYWJzKE1hdGguZmxvb3IoYSAvIEdSSURfQ09MUykgLSAxKSAtIE1hdGguYWJzKE1hdGguZmxvb3IoYiAvIEdSSURfQ09MUykgLSAxKTtcbiAgfSk7XG4gIGNvbnN0IG9yZGVyID0gc3BlY3MubWFwKChzLCBpKSA9PiBpKS5zb3J0KChpLCBqKSA9PiBGUk9OVE5FU1Nbc3BlY3Nbal0uc291bF0gLSBGUk9OVE5FU1Nbc3BlY3NbaV0uc291bF0pO1xuICBjb25zdCBvdXQgPSBuZXcgQXJyYXk8bnVtYmVyPihzcGVjcy5sZW5ndGgpO1xuICBvcmRlci5mb3JFYWNoKChpZHgsIGspID0+IHsgb3V0W2lkeF0gPSBjZWxsc1trXTsgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCB0eXBlIEZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhZCc7XG5leHBvcnQgaW50ZXJmYWNlIEZpZ2h0ZXIge1xuICBpZDogbnVtYmVyOyB0ZWFtOiAwIHwgMTsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjtcbiAgeDogbnVtYmVyOyB6OiBudW1iZXI7IHlhdzogbnVtYmVyO1xuICBocDogbnVtYmVyOyBtYXhIcDogbnVtYmVyOyBkbWc6IG51bWJlcjsgaW50ZXJ2YWw6IG51bWJlcjsgcmFuZ2U6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXI7XG4gIGFsaXZlOiBib29sZWFuOyBzdGF0ZTogRlN0YXRlO1xuICB0YXJnZXQ6IG51bWJlcjsgcmV0YXJnZXRBdDogbnVtYmVyOyBmb3JjZWRUYXJnZXQ6IG51bWJlcjsgZm9yY2VkVW50aWw6IG51bWJlcjtcbiAgbmV4dEF0dGFjazogbnVtYmVyOyBhdHRhY2tTdGFydDogbnVtYmVyOyBhdHRhY2tEdXI6IG51bWJlcjsgYW5pbVNwZWVkOiBudW1iZXI7IGhpdERvbmU6IGJvb2xlYW47XG4gIG1hbmE6IG51bWJlcjsgbWF4TWFuYTogbnVtYmVyOyBjYXN0aW5nOiBib29sZWFuOyBmcmVuenk6IG51bWJlcjsgZGVhZEF0OiBudW1iZXI7XG59XG5cbmV4cG9ydCB0eXBlIEJFdmVudCA9XG4gIHwgeyB0OiAnc3dpbmcnOyBpZDogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnaGl0JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlcjsga2luZDogJ21lbGVlJyB8ICdhcnJvdycgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICdhcnJvdyc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2RlYXRoJzsgaWQ6IG51bWJlciB9XG4gIHwgeyB0OiAnY2FzdCc7IGlkOiBudW1iZXI7IHNraWxsOiAnc3BsaXQnIHwgJ3RhdW50JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ3RhdW50JzsgaWQ6IG51bWJlciB9XG4gIHwgeyB0OiAnc21hc2gnOyBpZDogbnVtYmVyOyB4OiBudW1iZXI7IHo6IG51bWJlcjsgcjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdmcmVuenknOyBpZDogbnVtYmVyOyBzdGFja3M6IG51bWJlciB9O1xuXG5leHBvcnQgY2xhc3MgQmF0dGxlIHtcbiAgdGltZSA9IDA7XG4gIGZpZ2h0ZXJzOiBGaWdodGVyW10gPSBbXTtcbiAgZXZlbnRzOiBCRXZlbnRbXSA9IFtdO1xuICB3aW5uZXI6IC0xIHwgMCB8IDEgPSAtMTtcbiAgcm5nOiBSbmc7XG4gIHByaXZhdGUgcGVuZGluZzogeyBhdDogbnVtYmVyOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyIH1bXSA9IFtdO1xuICBwcml2YXRlIG5leHRJZCA9IDE7XG4gIHByaXZhdGUgZmxpcCA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSkge1xuICAgIHRoaXMucm5nID0gbWFrZVJuZyhzZWVkKTtcbiAgICBmb3IgKGNvbnN0IHAgb2YgcGxheWVycykgdGhpcy5hZGQoMCwgcC5zb3VsLCBwLnN0YXIsIHAuY2VsbCk7XG4gICAgY29uc3QgY2VsbHMgPSBlbmVteUNlbGxzKGVuZW1pZXMpO1xuICAgIGVuZW1pZXMuZm9yRWFjaCgoZSwgaSkgPT4gdGhpcy5hZGQoMSwgZS5zb3VsLCBlLnN0YXIsIGNlbGxzW2ldKSk7XG4gIH1cblxuICBwcml2YXRlIGFkZCh0ZWFtOiAwIHwgMSwgc291bDogU291bElkLCBzdGFyOiBudW1iZXIsIGNlbGw6IG51bWJlcik6IEZpZ2h0ZXIge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbc291bF0sIHAgPSBjZWxsUG9zKHRlYW0sIGNlbGwpO1xuICAgIGNvbnN0IGhwID0gc3QuaHAgKiBCLnN0YXIuaHBbc3RhciAtIDFdO1xuICAgIGNvbnN0IGY6IEZpZ2h0ZXIgPSB7XG4gICAgICBpZDogdGhpcy5uZXh0SWQrKywgdGVhbSwgc291bCwgc3RhciwgY2VsbCwgeDogcC54LCB6OiBwLnosIHlhdzogdGVhbSA9PT0gMCA/IDAgOiBNYXRoLlBJLFxuICAgICAgaHAsIG1heEhwOiBocCwgZG1nOiBzdC5kbWcgKiBCLnN0YXIuZG1nW3N0YXIgLSAxXSwgaW50ZXJ2YWw6IHN0LmludGVydmFsLCByYW5nZTogc3QucmFuZ2UsIHNwZWVkOiBzdC5zcGVlZCwgcmFkaXVzOiBzdC5zaXplICogQi5zdGFyLnNjYWxlW3N0YXIgLSAxXSxcbiAgICAgIGFsaXZlOiB0cnVlLCBzdGF0ZTogJ2lkbGUnLCB0YXJnZXQ6IC0xLCByZXRhcmdldEF0OiAwLCBmb3JjZWRUYXJnZXQ6IC0xLCBmb3JjZWRVbnRpbDogMCxcbiAgICAgIG5leHRBdHRhY2s6IHRoaXMucm5nLm5leHQoKSAqIDAuMywgYXR0YWNrU3RhcnQ6IC05LCBhdHRhY2tEdXI6IDEsIGFuaW1TcGVlZDogMSwgaGl0RnJhYzogMCwgaGl0RG9uZTogdHJ1ZSxcbiAgICAgIG1hbmE6IDAsIG1heE1hbmE6IEIubWFuYVtzb3VsXT8ubWF4ID8/IDAsIGNhc3Rpbmc6IGZhbHNlLCBmcmVuenk6IDAsIGRlYWRBdDogMCxcbiAgICB9IGFzIEZpZ2h0ZXI7XG4gICAgdGhpcy5maWdodGVycy5wdXNoKGYpOyByZXR1cm4gZjtcbiAgfVxuXG4gIGJ5SWQoaWQ6IG51bWJlcik6IEZpZ2h0ZXIgfCB1bmRlZmluZWQgeyByZXR1cm4gaWQgPCAwID8gdW5kZWZpbmVkIDogdGhpcy5maWdodGVyc1tpZCAtIDFdOyB9XG4gIGZvZXMoZjogRmlnaHRlcik6IEZpZ2h0ZXJbXSB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigobykgPT4gby5hbGl2ZSAmJiBvLnRlYW0gIT09IGYudGVhbSk7IH1cbiAgY291bnQodGVhbTogMCB8IDEpOiBudW1iZXIgeyByZXR1cm4gdGhpcy5maWdodGVycy5yZWR1Y2UoKG4sIGYpID0+IG4gKyAoZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHRlYW0gPyAxIDogMCksIDApOyB9XG4gIGRyYWluKCk6IEJFdmVudFtdIHsgY29uc3QgZSA9IHRoaXMuZXZlbnRzOyB0aGlzLmV2ZW50cyA9IFtdOyByZXR1cm4gZTsgfVxuXG4gIHN0ZXAoZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0aGlzLndpbm5lciA+PSAwKSByZXR1cm47XG4gICAgdGhpcy50aW1lICs9IGR0OyB0aGlzLmZsaXAgPSAhdGhpcy5mbGlwO1xuICAgIC8vIGFycm93cyB0aGF0IGhhdmUgZmluaXNoZWQgZmx5aW5nXG4gICAgZm9yIChsZXQgaSA9IHRoaXMucGVuZGluZy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgcCA9IHRoaXMucGVuZGluZ1tpXTtcbiAgICAgIGlmICh0aGlzLnRpbWUgPj0gcC5hdCkge1xuICAgICAgICB0aGlzLnBlbmRpbmcuc3BsaWNlKGksIDEpO1xuICAgICAgICBjb25zdCB0byA9IHRoaXMuYnlJZChwLnRvKSwgZnJvbSA9IHRoaXMuYnlJZChwLmZyb20pO1xuICAgICAgICBpZiAodG8gJiYgdG8uYWxpdmUgJiYgZnJvbSkgdGhpcy5kYW1hZ2UodG8sIHAuZG1nLCBmcm9tLCAnYXJyb3cnKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgb3JkZXIgPSB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSk7IGlmICh0aGlzLmZsaXApIG9yZGVyLnJldmVyc2UoKTtcbiAgICBmb3IgKGNvbnN0IGYgb2Ygb3JkZXIpIGlmIChmLmFsaXZlKSB0aGlzLnVwZGF0ZShmLCBkdCk7XG4gICAgY29uc3QgYSA9IHRoaXMuY291bnQoMCksIGIgPSB0aGlzLmNvdW50KDEpO1xuICAgIGlmICghYSB8fCAhYikgdGhpcy53aW5uZXIgPSBhID8gMCA6IDE7XG4gICAgZWxzZSBpZiAodGhpcy50aW1lID49IEJBTEFOQ0Uuc2ltLnRpbWVMaW1pdCkge1xuICAgICAgY29uc3QgaHAgPSAodDogMCB8IDEpID0+IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdCkucmVkdWNlKChuLCBmKSA9PiBuICsgZi5ocCAvIGYubWF4SHAsIDApO1xuICAgICAgdGhpcy53aW5uZXIgPSBocCgwKSA+IGhwKDEpID8gMCA6IDE7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBlci1maWdodGVyIHVwZGF0ZVxuICBwcml2YXRlIHVwZGF0ZShmOiBGaWdodGVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tmLnNvdWxdO1xuICAgIHRoaXMuc2VwYXJhdGUoZiwgZHQpO1xuXG4gICAgaWYgKGYuc3RhdGUgPT09ICdhdHRhY2snKSB7XG4gICAgICBjb25zdCB0ID0gdGhpcy50aW1lIC0gZi5hdHRhY2tTdGFydDtcbiAgICAgIGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKHRnICYmIHRnLmFsaXZlKSB0aGlzLmZhY2UoZiwgdGcueCAtIGYueCwgdGcueiAtIGYueiwgZHQpO1xuICAgICAgaWYgKCFmLmhpdERvbmUgJiYgdCA+PSBmLmF0dGFja0R1ciAqIHN0LmhpdEZyYWMpIHsgZi5oaXREb25lID0gdHJ1ZTsgdGhpcy5yZXNvbHZlSGl0KGYpOyB9XG4gICAgICBpZiAodCA+PSBmLmF0dGFja0R1cikgZi5zdGF0ZSA9ICdpZGxlJztcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5hY3F1aXJlKGYpO1xuICAgIGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTtcbiAgICBpZiAoIXRnIHx8ICF0Zy5hbGl2ZSkgeyBmLnN0YXRlID0gJ2lkbGUnOyB0aGlzLmZyZW56eURlY2F5KGYpOyByZXR1cm47IH1cbiAgICBjb25zdCBkeCA9IHRnLnggLSBmLngsIGR6ID0gdGcueiAtIGYueiwgZGlzdCA9IE1hdGguaHlwb3QoZHgsIGR6KTtcbiAgICB0aGlzLmZhY2UoZiwgZHgsIGR6LCBkdCk7XG4gICAgaWYgKGRpc3QgPD0gZi5yYW5nZSkge1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBmLm5leHRBdHRhY2spIHRoaXMuc3RhcnRBdHRhY2soZik7IGVsc2UgeyBmLnN0YXRlID0gJ2lkbGUnOyB0aGlzLmZyZW56eURlY2F5KGYpOyB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGYuc3RhdGUgPSAncnVuJzsgY29uc3QgayA9IGYuc3BlZWQgKiBkdCAvIE1hdGgubWF4KGRpc3QsIDFlLTQpOyBmLnggKz0gZHggKiBrOyBmLnogKz0gZHogKiBrOyB0aGlzLmZyZW56eURlY2F5KGYpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZnJlbnp5RGVjYXkoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLnNvdWwgPT09ICdiYXJiYXJpYW4nICYmIGYuZnJlbnp5ID4gMCAmJiB0aGlzLnRpbWUgLSAoZi5hdHRhY2tTdGFydCArIGYuYXR0YWNrRHVyKSA+IEJBTEFOQ0UuZnJlbnp5LnJlc2V0QWZ0ZXIpIGYuZnJlbnp5ID0gMDtcbiAgfVxuXG4gIHByaXZhdGUgZmFjZShmOiBGaWdodGVyLCBkeDogbnVtYmVyLCBkejogbnVtYmVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKGR4ICogZHggKyBkeiAqIGR6IDwgMWUtNikgcmV0dXJuO1xuICAgIGNvbnN0IHdhbnQgPSBNYXRoLmF0YW4yKGR4LCBkeik7IGxldCBkID0gKCh3YW50IC0gZi55YXcgKyBNYXRoLlBJKSAlICgyICogTWF0aC5QSSkgKyAyICogTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpIC0gTWF0aC5QSTtcbiAgICBmLnlhdyArPSBNYXRoLm1heCgtOSAqIGR0LCBNYXRoLm1pbig5ICogZHQsIGQpKTtcbiAgfVxuXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGxldCBweCA9IDAsIHB6ID0gMDtcbiAgICBmb3IgKGNvbnN0IG8gb2YgdGhpcy5maWdodGVycykge1xuICAgICAgaWYgKG8gPT09IGYgfHwgIW8uYWxpdmUpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZHggPSBmLnggLSBvLngsIGR6ID0gZi56IC0gby56LCBtID0gTWF0aC5oeXBvdChkeCwgZHopLCB3YW50ID0gKGYucmFkaXVzICsgby5yYWRpdXMpICogMS4wNSArIDAuMDg7XG4gICAgICBpZiAobSA+PSB3YW50KSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGsgPSAod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMyk7IHB4ICs9IChtIDwgMWUtMyA/ICh0aGlzLnJuZy5uZXh0KCkgLSAwLjUpIDogZHgpICogazsgcHogKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeikgKiBrO1xuICAgIH1cbiAgICBjb25zdCBzID0gTWF0aC5taW4oMSwgZHQgKiA2KTsgZi54ICs9IHB4ICogczsgZi56ICs9IHB6ICogcztcbiAgfVxuXG4gIHByaXZhdGUgYWNxdWlyZShmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgaWYgKGYuZm9yY2VkVGFyZ2V0ID49IDApIHtcbiAgICAgIGNvbnN0IGZ0ID0gdGhpcy5ieUlkKGYuZm9yY2VkVGFyZ2V0KTtcbiAgICAgIGlmIChmdCAmJiBmdC5hbGl2ZSAmJiB0aGlzLnRpbWUgPCBmLmZvcmNlZFVudGlsKSB7IGYudGFyZ2V0ID0gZnQuaWQ7IHJldHVybjsgfVxuICAgICAgZi5mb3JjZWRUYXJnZXQgPSAtMTtcbiAgICB9XG4gICAgY29uc3QgY3VyID0gdGhpcy5ieUlkKGYudGFyZ2V0KTtcbiAgICBpZiAoY3VyICYmIGN1ci5hbGl2ZSAmJiB0aGlzLnRpbWUgPCBmLnJldGFyZ2V0QXQpIHJldHVybjtcbiAgICBmLnJldGFyZ2V0QXQgPSB0aGlzLnRpbWUgKyBCQUxBTkNFLnNpbS5yZXRhcmdldEV2ZXJ5ICogKDAuOCArIDAuNCAqIHRoaXMucm5nLm5leHQoKSk7XG4gICAgY29uc3QgZm9lcyA9IHRoaXMuZm9lcyhmKTsgaWYgKCFmb2VzLmxlbmd0aCkgeyBmLnRhcmdldCA9IC0xOyByZXR1cm47IH1cbiAgICBsZXQgYmVzdCA9IGZvZXNbMF0sIGJzID0gSW5maW5pdHk7XG4gICAgZm9yIChjb25zdCBvIG9mIGZvZXMpIHtcbiAgICAgIGxldCBzY29yZSA9IE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicpIHtcbiAgICAgICAgLy8ga2lsbC1zdGVhbDogcHJlZmVyIG5lYXJieSBlbmVtaWVzIGFscmVhZHkgZmlnaHRpbmcgb25lIG9mIG91ciBhbGxpZXMsIGFuZCB3b3VuZGVkIG9uZXNcbiAgICAgICAgY29uc3QgZW5nYWdlZCA9IHRoaXMuYnlJZChvLnRhcmdldCk7IGNvbnN0IGJ1c3kgPSAhIWVuZ2FnZWQgJiYgZW5nYWdlZC5hbGl2ZSAmJiBlbmdhZ2VkLnRlYW0gPT09IGYudGVhbSAmJiBlbmdhZ2VkLmlkICE9PSBmLmlkO1xuICAgICAgICBpZiAoYnVzeSAmJiBzY29yZSA8IEJBTEFOQ0Uub3Bwb3J0dW5pc3Quc2Vla1JhZGl1cyArIDIpIHNjb3JlIC09IDM7XG4gICAgICAgIHNjb3JlIC09IEJBTEFOQ0Uub3Bwb3J0dW5pc3Qud291bmRlZFdlaWdodCAqICgxIC0gby5ocCAvIG8ubWF4SHApO1xuICAgICAgfVxuICAgICAgaWYgKHNjb3JlIDwgYnMpIHsgYnMgPSBzY29yZTsgYmVzdCA9IG87IH1cbiAgICB9XG4gICAgZi50YXJnZXQgPSBiZXN0LmlkO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGFydEF0dGFjayhmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tmLnNvdWxdOyBsZXQgZWZmID0gZi5pbnRlcnZhbDtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJykgeyBmLmZyZW56eSA9IE1hdGgubWluKEIuZnJlbnp5Lm1heFN0YWNrcywgZi5mcmVuenkgKyAxKTsgZWZmID0gZi5pbnRlcnZhbCAvICgxICsgZi5mcmVuenkgKiBCLmZyZW56eS5wZXJTd2luZyk7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZnJlbnp5JywgaWQ6IGYuaWQsIHN0YWNrczogZi5mcmVuenkgfSk7IH1cbiAgICBmLmF0dGFja0R1ciA9IE1hdGgubWluKHN0LmFuaW1MZW4sIGVmZiAqIDAuOTUpOyBmLmFuaW1TcGVlZCA9IHN0LmFuaW1MZW4gLyBmLmF0dGFja0R1cjtcbiAgICBmLmF0dGFja1N0YXJ0ID0gdGhpcy50aW1lOyBmLm5leHRBdHRhY2sgPSB0aGlzLnRpbWUgKyBNYXRoLm1heChlZmYsIGYuYXR0YWNrRHVyKTsgZi5oaXREb25lID0gZmFsc2U7IGYuc3RhdGUgPSAnYXR0YWNrJztcbiAgICBmLmNhc3RpbmcgPSBmLm1heE1hbmEgPiAwICYmIGYubWFuYSA+PSBmLm1heE1hbmE7IGlmIChmLmNhc3RpbmcpIHsgZi5tYW5hID0gMDsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdjYXN0JywgaWQ6IGYuaWQsIHNraWxsOiBmLnNvdWwgPT09ICdhcmNoZXInID8gJ3NwbGl0JyA6IGYuc291bCA9PT0gJ2tuaWdodCcgPyAndGF1bnQnIDogJ3NtYXNoJyB9KTsgfVxuICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc3dpbmcnLCBpZDogZi5pZCwgc3BlZWQ6IGYuYW5pbVNwZWVkLCBkdXI6IGYuYXR0YWNrRHVyIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlSGl0KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAoIXRnIHx8ICF0Zy5hbGl2ZSkgcmV0dXJuO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbZi5zb3VsXTsgaWYgKE0gJiYgIWYuY2FzdGluZykgZi5tYW5hID0gTWF0aC5taW4oTS5tYXgsIGYubWFuYSArIE0ucGVyQXR0YWNrKTtcbiAgICBpZiAoZi5zb3VsID09PSAnYXJjaGVyJykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBiYXNpYzogb25lIGFycm93LiBTa2lsbCAoU3BsaXQgQXJyb3cpOiBvbmUgYXJyb3cgYXQgZWFjaCBvZiB1cCB0byAzIGRpZmZlcmVudCBlbmVtaWVzXG4gICAgICBjb25zdCByZWFjaCA9IGYucmFuZ2UgKiAxLjI1O1xuICAgICAgY29uc3QgZm9lcyA9IHRoaXMuZm9lcyhmKS5tYXAoKG8pID0+ICh7IG8sIGQ6IE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIH0pKS5maWx0ZXIoKGUpID0+IGUuZCA8PSByZWFjaCkuc29ydCgoYSwgYikgPT4gYS5kIC0gYi5kKTtcbiAgICAgIGNvbnN0IHBpY2tlZCA9IGYuY2FzdGluZyA/IFt0ZywgLi4uZm9lcy5tYXAoKGUpID0+IGUubykuZmlsdGVyKChvKSA9PiBvLmlkICE9PSB0Zy5pZCldLnNsaWNlKDAsIEIudm9sbGV5LnRhcmdldHMpIDogW3RnXTtcbiAgICAgIGZvciAoY29uc3QgbyBvZiBwaWNrZWQpIHtcbiAgICAgICAgY29uc3QgZHVyID0gTWF0aC5tYXgoMC4xNSwgTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgLyBCLnZvbGxleS5wcm9qZWN0aWxlU3BlZWQpO1xuICAgICAgICB0aGlzLnBlbmRpbmcucHVzaCh7IGF0OiB0aGlzLnRpbWUgKyBkdXIsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkbWc6IGYuZG1nIH0pO1xuICAgICAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2Fycm93JywgZnJvbTogZi5pZCwgdG86IG8uaWQsIGR1ciB9KTtcbiAgICAgIH1cbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlOyByZXR1cm47XG4gICAgfVxuICAgIGlmIChNYXRoLmh5cG90KHRnLnggLSBmLngsIHRnLnogLSBmLnopID4gZi5yYW5nZSAqIDEuNSkgeyBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuOyB9ICAgLy8gdGFyZ2V0IHNsaXBwZWQgYXdheTogdGhlIGJsb3cgbWlzc2VzXG4gICAgbGV0IGRtZyA9IGYuZG1nO1xuICAgIGlmIChmLnNvdWwgPT09ICdnb2JsaW4nKSB7IGNvbnN0IGVuZyA9IHRoaXMuYnlJZCh0Zy50YXJnZXQpOyBpZiAoZW5nICYmIGVuZy5hbGl2ZSAmJiBlbmcudGVhbSA9PT0gZi50ZWFtICYmIGVuZy5pZCAhPT0gZi5pZCkgZG1nICo9IDEgKyBCLm9wcG9ydHVuaXN0LmJvbnVzOyB9XG4gICAgaWYgKGYuY2FzdGluZykge1xuICAgICAgZi5jYXN0aW5nID0gZmFsc2U7XG4gICAgICBpZiAoZi5zb3VsID09PSAnb2dyZScpIHtcbiAgICAgICAgZG1nICo9IEIuc21hc2gubXVsdDsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdzbWFzaCcsIGlkOiBmLmlkLCB4OiB0Zy54LCB6OiB0Zy56LCByOiBCLnNtYXNoLnJhZGl1cyB9KTtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKG8uaWQgIT09IHRnLmlkICYmIE1hdGguaHlwb3Qoby54IC0gdGcueCwgby56IC0gdGcueikgPD0gQi5zbWFzaC5yYWRpdXMpIHRoaXMuZGFtYWdlKG8sIGRtZyAqIDAuNiwgZiwgJ3NtYXNoJyk7XG4gICAgICAgIHRoaXMuZGFtYWdlKHRnLCBkbWcsIGYsICdzbWFzaCcpOyByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAna25pZ2h0Jykge1xuICAgICAgICBmb3IgKGNvbnN0IG8gb2YgdGhpcy5mb2VzKGYpKSBpZiAoTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgPD0gQi50YXVudC5yYWRpdXMpIHsgby5mb3JjZWRUYXJnZXQgPSBmLmlkOyBvLmZvcmNlZFVudGlsID0gdGhpcy50aW1lICsgQi50YXVudC5kdXJhdGlvbjsgby5yZXRhcmdldEF0ID0gMDsgfVxuICAgICAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3RhdW50JywgaWQ6IGYuaWQgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuZGFtYWdlKHRnLCBkbWcsIGYsICdtZWxlZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBkYW1hZ2UodDogRmlnaHRlciwgYW1vdW50OiBudW1iZXIsIGZyb206IEZpZ2h0ZXIsIGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyk6IHZvaWQge1xuICAgIGlmICghdC5hbGl2ZSkgcmV0dXJuO1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFOyBsZXQgcmVkID0gMDtcbiAgICBpZiAodC5zb3VsID09PSAnd2FycmlvcicpIHtcbiAgICAgIGNvbnN0IG4gPSB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigobykgPT4gby5hbGl2ZSAmJiBvICE9PSB0ICYmIG8udGVhbSA9PT0gdC50ZWFtICYmIG8uc291bCA9PT0gJ3dhcnJpb3InICYmIE1hdGguaHlwb3Qoby54IC0gdC54LCBvLnogLSB0LnopIDw9IEIucGhhbGFueC5yYWRpdXMpLmxlbmd0aDtcbiAgICAgIHJlZCA9IE1hdGgubWluKEIucGhhbGFueC5tYXhTdGFja3MsIG4pICogQi5waGFsYW54LnBlckFsbHk7XG4gICAgfVxuICAgIGNvbnN0IGRtZyA9IGFtb3VudCAqICgxIC0gcmVkKTsgdC5ocCAtPSBkbWc7XG4gICAgY29uc3QgTSA9IEIubWFuYVt0LnNvdWxdOyBpZiAoTSAmJiB0LmhwID4gMCkgdC5tYW5hID0gTWF0aC5taW4oTS5tYXgsIHQubWFuYSArIE0ucGVySGl0KTtcbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2hpdCcsIGZyb206IGZyb20uaWQsIHRvOiB0LmlkLCBkbWcsIGtpbmQgfSk7XG4gICAgaWYgKHQuaHAgPD0gMCkgeyB0LmhwID0gMDsgdC5hbGl2ZSA9IGZhbHNlOyB0LnN0YXRlID0gJ2RlYWQnOyB0LmRlYWRBdCA9IHRoaXMudGltZTsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdkZWF0aCcsIGlkOiB0LmlkIH0pOyB9XG4gIH1cbn1cblxuLyoqIFJ1biBhIHdob2xlIGZpZ2h0IHdpdGhvdXQgYW55IGdyYXBoaWNzLiBSZXR1cm5zIHdobyB3b24gYW5kIGhvdyBpdCB3ZW50LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpbXVsYXRlKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSwgbWF4U2Vjb25kcyA9IDEzMCk6IHsgd2lubmVyOiAwIHwgMTsgdGltZTogbnVtYmVyOyBsZWZ0OiBudW1iZXI7IGhwTGVmdDogbnVtYmVyIH0ge1xuICBjb25zdCBiID0gbmV3IEJhdHRsZShwbGF5ZXJzLCBlbmVtaWVzLCBzZWVkKTtcbiAgd2hpbGUgKGIud2lubmVyIDwgMCAmJiBiLnRpbWUgPCBtYXhTZWNvbmRzKSBiLnN0ZXAoMSAvIDMwKTtcbiAgY29uc3QgdyA9IChiLndpbm5lciA8IDAgPyAxIDogYi53aW5uZXIpIGFzIDAgfCAxO1xuICBjb25zdCBtaW5lID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB3KTtcbiAgcmV0dXJuIHsgd2lubmVyOiB3LCB0aW1lOiBiLnRpbWUsIGxlZnQ6IG1pbmUubGVuZ3RoLCBocExlZnQ6IG1pbmUucmVkdWNlKChuLCBmKSA9PiBuICsgZi5ocCAvIGYubWF4SHAsIDApIH07XG59XG4iLCAiLy8gRW5lbXkgd2F2ZXMuIFNhbWUgdW5pdCBwb29sIGFzIHRoZSBwbGF5ZXIuIFRoZSBidWlsZCBzY3JlZW4gcHJldmlld3MgdGhlIENPTVBPU0lUSU9OIG9ubHksIG5ldmVyIHBvc2l0aW9ucy5cblxuaW1wb3J0IHsgQ09TVCwgQ1VSVkVTLCBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVuZW15U3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyIH1cblxuY29uc3QgTEVUVEVSOiBSZWNvcmQ8c3RyaW5nLCBTb3VsSWQ+ID0geyBXOiAnd2FycmlvcicsIEE6ICdhcmNoZXInLCBHOiAnZ29ibGluJywgSzogJ2tuaWdodCcsIE86ICdvZ3JlJywgQjogJ2JhcmJhcmlhbicgfTtcbmNvbnN0IHBhcnNlV2F2ZSA9IChzOiBzdHJpbmcpOiBFbmVteVNwZWNbXSA9PiBzLnNwbGl0KCcgJykubWFwKCh0KSA9PiAoeyBzb3VsOiBMRVRURVJbdFswXV0sIHN0YXI6ICt0WzFdIH0pKTtcblxuLyoqXG4gKiBEaWZmaWN1bHR5IHByZXNldHMgZm9yIFN0YWdlIDEgKDEwIHdhdmVzKSAoVyB3YXJyaW9yLCBBIGFyY2hlciwgRyBnb2JsaW4sIEsga25pZ2h0LCBPIG9ncmU7IGRpZ2l0ID0gc3RhcnMpLlxuICogTWVhc3VyZWQgd2l0aCBzaW0vdHVuZV93YXZlcy50cyBhZ2FpbnN0IHN0YW5kLWluIHBsYXllcnMgKGNvbXBldGVudCAvIGNhcmVsZXNzKSwgc3RhZ2UtY2xlYXIgcmF0ZTpcbiAqICAgZWFzeSAgIH4xMDAlIC8gfjkwJSAgICAgIG5vcm1hbCB+OTQlIC8gfjUxJSAgICAgIGhhcmQgfjc1JSAvIH4yNiVcbiAqIEEgcmVhbCBodW1hbiBvbiBhIHBob25lIGlzIG11Y2ggbGVzcyBjYXJlZnVsIHRoYW4gdGhlIGNvbXBldGVudCBzdGFuZC1pbiwgc28gXCJub3JtYWxcIiBpcyB0aGUgZGVmYXVsdC5cbiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFk6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMScsICdLMSBXMScsICdPMSBXMSBHMScsICdLMSBBMSBXMScsICdPMSBBMSBHMScsICdLMSBPMSBBMScsICdLMSBPMSBBMSBHMScsICdPMSBLMSBBMSBHMScsICdPMSBLMSBBMSBCMScsICdPMiBLMSBBMSBHMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEnLCAnTzEgQTEgRzEgVzEnLCAnSzEgTzEgQTEgVzEnLCAnTzEgSzEgQTEgRzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEnLCAnSzEgTzEgQTEgRzEgVzEnLCAnTzEgSzEgQTEgQjEgRzEnLCAnTzEgSzEgQTIgQjEgRzEnLCAnTzIgSzEgQTEgQjEgRzEgVzEnXSxcbiAgaGFyZDogWydXMSBBMScsICdLMSBHMSBXMSBBMScsICdPMSBBMSBHMSBXMScsICdLMSBPMSBBMSBXMSBHMScsICdPMSBLMSBBMiBHMSBXMScsICdBMiBLMSBPMSBHMSBXMSBCMScsICdLMSBPMSBBMSBHMSBXMicsICdPMSBLMSBBMiBCMSBHMScsICdPMiBLMSBBMiBCMSBHMScsICdPMiBLMiBBMSBCMSBHMSBXMSddLFxufTtcbmV4cG9ydCBsZXQgZGlmZmljdWx0eU5hbWUgPSAnbm9ybWFsJztcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIFN0YWdlIDEgKDEwIHdhdmVzKS4gQnVkZ2V0cyB+IHRoZSBwbGF5ZXIncyBjYXAgYXQgdGhhdCB3YXZlLiBFZGl0ZWQgaW4gcGxhY2UgYnkgc2V0RGlmZmljdWx0eS4gKi9cbmV4cG9ydCBjb25zdCBBVVRIT1JFRDogRW5lbXlTcGVjW11bXSA9IERJRkZJQ1VMVFkubm9ybWFsLm1hcChwYXJzZVdhdmUpO1xuXG5leHBvcnQgZnVuY3Rpb24gc2V0RGlmZmljdWx0eShuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKCFESUZGSUNVTFRZW25hbWVdKSByZXR1cm47XG4gIGRpZmZpY3VsdHlOYW1lID0gbmFtZTsgQVVUSE9SRUQubGVuZ3RoID0gMDsgRElGRklDVUxUWVtuYW1lXS5mb3JFYWNoKCh3KSA9PiBBVVRIT1JFRC5wdXNoKHBhcnNlV2F2ZSh3KSkpO1xufVxuXG5leHBvcnQgY29uc3Qgd2F2ZUNvc3QgPSAodzogRW5lbXlTcGVjW10pOiBudW1iZXIgPT4gdy5yZWR1Y2UoKG4sIGUpID0+IG4gKyBDT1NUW2Uuc291bF1bZS5zdGFyIC0gMV0sIDApO1xuXG4vKiogRW5lbXkgYXJteSBmb3IgYSB3YXZlICgxLWJhc2VkKS4gV2F2ZXMgcGFzdCB0aGUgYXV0aG9yZWQgb25lcyBhcmUgZ2VuZXJhdGVkIGZyb20gYSBmaXhlZCBzZWVkIHNvIHJldHJpZXMgZmFjZSB0aGUgc2FtZSBhcm15LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZW15V2F2ZSh3YXZlOiBudW1iZXIsIHN0YWdlU2VlZCA9IDApOiBFbmVteVNwZWNbXSB7XG4gIGlmICh3YXZlIDw9IEFVVEhPUkVELmxlbmd0aCkgcmV0dXJuIEFVVEhPUkVEW3dhdmUgLSAxXS5tYXAoKGUpID0+ICh7IC4uLmUgfSkpO1xuICBjb25zdCBjYXAgPSBDVVJWRVMuZG9jW01hdGgubWluKHdhdmUsIENVUlZFUy5kb2MubGVuZ3RoKSAtIDFdO1xuICBjb25zdCBidWRnZXQgPSBNYXRoLnJvdW5kKGNhcCAqIDAuOTIpO1xuICBjb25zdCBybmcgPSBtYWtlUm5nKHN0YWdlU2VlZCAqIDEwMDkgKyB3YXZlICogNzkxOSk7XG4gIGNvbnN0IGFybXk6IEVuZW15U3BlY1tdID0gW107XG4gIGxldCBsZWZ0ID0gYnVkZ2V0O1xuICBmb3IgKGxldCBndWFyZCA9IDA7IGd1YXJkIDwgNDAgJiYgbGVmdCA+PSAyOyBndWFyZCsrKSB7XG4gICAgY29uc3Qgc291bCA9IHJuZy5waWNrKFNPVUxTKTtcbiAgICBsZXQgc3RhciA9IDE7XG4gICAgaWYgKHJuZy5uZXh0KCkgPCAwLjM1ICYmIENPU1Rbc291bF1bMV0gPD0gbGVmdCkgc3RhciA9IDI7XG4gICAgaWYgKHdhdmUgPj0gNiAmJiBybmcubmV4dCgpIDwgMC4yNSAmJiBDT1NUW3NvdWxdWzJdIDw9IGxlZnQpIHN0YXIgPSAzO1xuICAgIGNvbnN0IGMgPSBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbiAgICBpZiAoYyA8PSBsZWZ0ICYmIGFybXkubGVuZ3RoIDwgMTIpIHsgYXJteS5wdXNoKHsgc291bCwgc3RhciB9KTsgbGVmdCAtPSBjOyB9XG4gIH1cbiAgcmV0dXJuIGFybXk7XG59XG5cbi8qKiBXaGF0IHRoZSBidWlsZCBzY3JlZW4gc2hvd3M6IGNvdW50cyBwZXIgU291bCBhbmQgc3Rhciwgbm8gcG9zaXRpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByZXZpZXdUZXh0KHc6IEVuZW15U3BlY1tdKTogeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY291bnQ6IG51bWJlciB9W10ge1xuICBjb25zdCBtYXAgPSBuZXcgTWFwPHN0cmluZywgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY291bnQ6IG51bWJlciB9PigpO1xuICBmb3IgKGNvbnN0IGUgb2Ygdykge1xuICAgIGNvbnN0IGsgPSBlLnNvdWwgKyBlLnN0YXI7XG4gICAgY29uc3QgY3VyID0gbWFwLmdldChrKTtcbiAgICBpZiAoY3VyKSBjdXIuY291bnQrKzsgZWxzZSBtYXAuc2V0KGssIHsgc291bDogZS5zb3VsLCBzdGFyOiBlLnN0YXIsIGNvdW50OiAxIH0pO1xuICB9XG4gIHJldHVybiBbLi4ubWFwLnZhbHVlcygpXTtcbn1cbiIsICJpbXBvcnQgeyBDVVJWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcyB9IGZyb20gJy4vZGF0YS50cyc7XG5cbi8qKlxuICogUnVsZXMgZm9yIHRoZSBwbGF5YWJsZSBTdGFnZSAxICgxMCB3YXZlcyk6IGRvYyBEb21pbmlvbiBjdXJ2ZSwgYm9udXMgZHJhdyBvbmx5IG9uIHRoZSBlYXJseSB3YXZlcy5cbiAqIG1lcmdlICdoYW5kSW50b09uZVN0YXInOiBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIG1lcmdlIHN0cmFpZ2h0IGludG8gYSBtYXRjaGluZyBkZXBsb3llZCAxLXN0YXIgdW5pdCAocGF5aW5nIG9ubHkgdGhlIGNvc3RcbiAqIGRpZmZlcmVuY2UpLiBXaXRob3V0IGl0IHRoZSBjYXAgY2FuIGJsb2NrIGEgbWVyZ2UgeW91IGNvdWxkIGFmZm9yZCAoeW91IHdvdWxkIG5lZWQgcm9vbSB0byBzdW1tb24gQk9USCBjb3BpZXMgZmlyc3QpLlxuICogVGhlIGRlYnVnIHBhbmVsIGNhbiBzd2l0Y2ggdGhpcyBiYWNrIHRvIHRoZSBkb2MncyBkZXBsb3llZC1vbmx5IHJ1bGUuXG4gKi9cbmV4cG9ydCBjb25zdCBQUk9UT1RZUEVfUlVMRVM6IFJ1bGVzID0geyBjdXJ2ZTogQ1VSVkVTLmRvYywgbWVyZ2U6ICdoYW5kSW50b09uZVN0YXInLCBzdGFnZVdhdmVzOiAxMCwgbm9ybWFsRHJhd1dhdmVzOiBbMiwgMywgNCwgNV0gfTtcbiIsICIvLyBUaGUgcGxheWVyJ3Mgc2F2ZWQgcHJvZ3Jlc3MuIEZyYW1ld29yay1mcmVlIHNvIHRoZSBnYW1lIGJ1bmRsZSBhbmQgdGhlIG5hdmlnYXRpb24gc2hlbGwgYm90aCB1c2UgaXQuXG4vLyBTdG9yZWQgaW4gbG9jYWxTdG9yYWdlIGFzIEpTT04uIEV2ZXJ5IHJlYWQvd3JpdGUgaXMgZ3VhcmRlZDogcHJpdmF0ZSB3aW5kb3dzIGFuZCBibG9ja2VkIHN0b3JhZ2UgbXVzdCBuZXZlciBicmVhayB0aGUgZ2FtZS5cblxuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuXG5leHBvcnQgY29uc3QgREVDS19TSVpFID0gNjsgICAgICAgICAgICAgICAgICAgICAvLyBkb2M6IHNpeCBlcXVpcHBlZCBTb3VscyBwZXIgc3RhZ2VcbmNvbnN0IEtFWSA9ICduZWNyby1zYXZlJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNvdWxQcm9ncmVzcyB7IGxldmVsOiBudW1iZXI7IGNvcGllczogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgU2F2ZSB7XG4gIHY6IG51bWJlcjtcbiAgZGVjazogU291bElkW107ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGVxdWlwcGVkIFNvdWxzLCBhdCBtb3N0IERFQ0tfU0laRSwgYXQgbGVhc3QgMVxuICBzb3VsczogUmVjb3JkPFNvdWxJZCwgU291bFByb2dyZXNzPjsgICAgICAgICAgLy8gUExBQ0VIT0xERVIgcHJvZ3Jlc3Npb24gdW50aWwgcGFja3MgZXhpc3Rcbn1cbmV4cG9ydCBpbnRlcmZhY2UgU3RvcmUgeyBnZXRJdGVtKGs6IHN0cmluZyk6IHN0cmluZyB8IG51bGw7IHNldEl0ZW0oazogc3RyaW5nLCB2OiBzdHJpbmcpOiB2b2lkIH1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRTYXZlKCk6IFNhdmUge1xuICBjb25zdCBzb3VscyA9IHt9IGFzIFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47XG4gIGZvciAoY29uc3QgaWQgb2YgU09VTFMpIHNvdWxzW2lkXSA9IHsgbGV2ZWw6IDEsIGNvcGllczogMCB9O1xuICByZXR1cm4geyB2OiBWRVJTSU9OLCBkZWNrOiBTT1VMUy5zbGljZSgwLCBERUNLX1NJWkUpLCBzb3VscyB9O1xufVxuXG5mdW5jdGlvbiBicm93c2VyU3RvcmUoKTogU3RvcmUgfCBudWxsIHsgdHJ5IHsgcmV0dXJuIHR5cGVvZiBsb2NhbFN0b3JhZ2UgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGxvY2FsU3RvcmFnZTsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9IH1cblxuLyoqIFJlcGFpciB3aGF0ZXZlciB3YXMgc3RvcmVkOiB1bmtub3duIFNvdWxzIGRyb3BwZWQsIGR1cGxpY2F0ZXMgcmVtb3ZlZCwgZGVjayBjYXBwZWQsIG5vdGhpbmcgZW1wdHkuIE9sZCB2ZXJzaW9ucyBrZWVwIHRoZWlyIHByb2dyZXNzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplKHJhdzogYW55KTogU2F2ZSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0U2F2ZSgpO1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IGRlY2s6IFNvdWxJZFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5kZWNrKSkgZm9yIChjb25zdCBkIG9mIHJhdy5kZWNrKSBpZiAoU09VTFMuaW5jbHVkZXMoZCkgJiYgIWRlY2suaW5jbHVkZXMoZCkgJiYgZGVjay5sZW5ndGggPCBERUNLX1NJWkUpIGRlY2sucHVzaChkKTtcbiAgaWYgKGRlY2subGVuZ3RoKSBiYXNlLmRlY2sgPSBkZWNrO1xuICBpZiAocmF3LnNvdWxzICYmIHR5cGVvZiByYXcuc291bHMgPT09ICdvYmplY3QnKSB7XG4gICAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykge1xuICAgICAgY29uc3QgcCA9IHJhdy5zb3Vsc1tpZF07XG4gICAgICBpZiAocCAmJiBOdW1iZXIuaXNGaW5pdGUocC5sZXZlbCkgJiYgTnVtYmVyLmlzRmluaXRlKHAuY29waWVzKSkgYmFzZS5zb3Vsc1tpZF0gPSB7IGxldmVsOiBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHAubGV2ZWwpKSwgY29waWVzOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHAuY29waWVzKSkgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cbiIsICIvLyBUaGUgcGxheWVyJ3MgY2hhcmFjdGVyOiB0aGUgTmVjcm9tYW5jZXIuIEEgcHJvY2VkdXJhbCBwbGFjZWhvbGRlciAobm8gVHJpcG8gbW9kZWwgeWV0KTogaG9vZGVkIHJvYmUsIGdsb3dpbmcgcHVycGxlIGV5ZXMsIGNyeXN0YWwgc3RhZmYuXG4vLyBIZSBzdGFuZHMgYmVzaWRlIHRoZSBncmlkLCB0YWtlcyB0aGUgaGl0IHdoZW4gYW4gYXJteSBpcyB3aXBlZCAoaGVhcnRzIGFyZSBISVMgaGVhbHRoKSwgdW5sZWFzaGVzIHRoZSByZXB1bHNpb24gc2hvY2t3YXZlIGFuZCByYWlzZXNcbi8vIHRoZSBmYWxsZW4uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBhbmltYXRpb24gb25seTsgdGhlIHJ1bGVzIGxpdmUgaW4gY29yZS9ydWxlcy50cy5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuXG5leHBvcnQgY2xhc3MgTmVjcm9tYW5jZXIge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb247IGxvY2FsICtaIGlzIGhpcyBmYWNpbmcgKHRoZSBnYW1lIHJvdGF0ZXMgaGltIHRvIGZhY2UgdGhlIGJhdHRsZWZpZWxkKVxuICBwcml2YXRlIHJpZzogYW55OyBwcml2YXRlIHN0YWZmUGl2b3Q6IGFueTsgcHJpdmF0ZSBjcnlzdGFsOiBhbnk7IHByaXZhdGUgY3J5c3RhbE1hdDogYW55OyBwcml2YXRlIHJvYmVNYXQ6IGFueTsgcHJpdmF0ZSBleWVNYXQ6IGFueTsgcHJpdmF0ZSBwczogYW55OyBwcml2YXRlIGdsb3c6IGFueTtcbiAgcHJpdmF0ZSB0ID0gMDsgcHJpdmF0ZSBodXJ0VCA9IDA7IHByaXZhdGUgY2FzdFQgPSAwOyBwcml2YXRlIGRvd24gPSAwOyBwcml2YXRlIGRvd25UYXJnZXQgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgc2NlbmU6IGFueSwgcHJpdmF0ZSBzb2Z0OiBhbnkpIHtcbiAgICBjb25zdCBzID0gc2NlbmUsIG1hdCA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyLCBlciA9IDAsIGVnID0gMCwgZWIgPSAwKSA9PiB7XG4gICAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbm0nLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhlciwgZWcsIGViKTsgbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgcmV0dXJuIG07XG4gICAgfTtcbiAgICBjb25zdCBnbG93TWF0ID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCduZycsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCduZWNybycsIHMpOyB0aGlzLnJpZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ25lY3JvUmlnJywgcyk7IHRoaXMucmlnLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIGNvbnN0IGFkZCA9IChtZXNoOiBhbnksIHBhcmVudCA9IHRoaXMucmlnKSA9PiB7IG1lc2gucGFyZW50ID0gcGFyZW50OyBtZXNoLmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIG1lc2g7IH07XG4gICAgdGhpcy5yb2JlTWF0ID0gbWF0KDAuMDksIDAuMDMsIDAuMTYsIDAuMDUsIDAuMDIsIDAuMSk7XG4gICAgY29uc3Qgcm9iZSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdyb2JlJywgeyBoZWlnaHQ6IDAuODIsIGRpYW1ldGVyVG9wOiAwLjMsIGRpYW1ldGVyQm90dG9tOiAwLjgsIHRlc3NlbGxhdGlvbjogMjAgfSwgcykpOyByb2JlLnBvc2l0aW9uLnkgPSAwLjQxOyByb2JlLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IGhlbSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoZW0nLCB7IGRpYW1ldGVyOiAwLjc4LCB0aGlja25lc3M6IDAuMDM1LCB0ZXNzZWxsYXRpb246IDI4IH0sIHMpKTsgaGVtLnBvc2l0aW9uLnkgPSAwLjAzOyBoZW0ubWF0ZXJpYWwgPSBnbG93TWF0KDAuOSwgMC43LCAwLjI1KTtcbiAgICBjb25zdCBtYW50bGUgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ21hbnRsZScsIHsgZGlhbWV0ZXI6IDAuNiwgc2VnbWVudHM6IDEyIH0sIHMpKTsgbWFudGxlLnNjYWxpbmcuc2V0KDEsIDAuNSwgMC44KTsgbWFudGxlLnBvc2l0aW9uLnkgPSAwLjg7IG1hbnRsZS5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCBob29kID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdob29kJywgeyBkaWFtZXRlcjogMC41Niwgc2VnbWVudHM6IDE0IH0sIHMpKTsgaG9vZC5wb3NpdGlvbi55ID0gMS4wOyBob29kLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IHRpcCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCd0aXAnLCB7IGhlaWdodDogMC40LCBkaWFtZXRlclRvcDogMCwgZGlhbWV0ZXJCb3R0b206IDAuMzQsIHRlc3NlbGxhdGlvbjogMTQgfSwgcykpOyB0aXAucG9zaXRpb24uc2V0KDAsIDEuMjgsIC0wLjA2KTsgdGlwLnJvdGF0aW9uLnggPSAtMC4zNTsgdGlwLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IGZhY2UgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2ZhY2UnLCB7IGRpYW1ldGVyOiAwLjM4LCBzZWdtZW50czogMTIgfSwgcykpOyBmYWNlLnBvc2l0aW9uLnNldCgwLCAwLjk5LCAwLjEyKTsgZmFjZS5tYXRlcmlhbCA9IG1hdCgwLjAyLCAwLCAwLjA1KTtcbiAgICB0aGlzLmV5ZU1hdCA9IGdsb3dNYXQoMC45LCAwLjQsIDEpO1xuICAgIGZvciAoY29uc3QgeCBvZiBbLTAuMDc1LCAwLjA3NV0pIHsgY29uc3QgZSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZXllJywgeyBkaWFtZXRlcjogMC4wNzUsIHNlZ21lbnRzOiA4IH0sIHMpKTsgZS5wb3NpdGlvbi5zZXQoeCwgMS4wLCAwLjI4NSk7IGUuc2NhbGluZy56ID0gMC42OyBlLm1hdGVyaWFsID0gdGhpcy5leWVNYXQ7IH1cbiAgICB0aGlzLmdsb3cgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZXllR2xvdycsIHsgc2l6ZTogMC41IH0sIHMpKTsgdGhpcy5nbG93LnBvc2l0aW9uLnNldCgwLCAxLjAsIDAuMzMpOyB0aGlzLmdsb3cuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDtcbiAgICBjb25zdCBnbSA9IGdsb3dNYXQoMC43LCAwLjI1LCAxLCAwLjU1KTsgZ20uZW1pc3NpdmVUZXh0dXJlID0gc29mdDsgZ20ub3BhY2l0eVRleHR1cmUgPSBzb2Z0OyB0aGlzLmdsb3cubWF0ZXJpYWwgPSBnbTtcbiAgICBjb25zdCBoYW5kID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdoYW5kJywgeyBkaWFtZXRlcjogMC4xMiwgc2VnbWVudHM6IDggfSwgcykpOyBoYW5kLnBvc2l0aW9uLnNldCgtMC4zMiwgMC42MiwgMC4xMik7IGhhbmQubWF0ZXJpYWwgPSBtYXQoMC44LCAwLjc1LCAwLjY1KTtcbiAgICAvLyBzdGFmZjogcGl2b3QgYXQgdGhlIHJpZ2h0IGhhbmQgc28gcmFpc2luZyBpdCBpcyBvbmUgcm90YXRpb25cbiAgICB0aGlzLnN0YWZmUGl2b3QgPSBhZGQobmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnc3RhZmZQaXZvdCcsIHMpKTsgdGhpcy5zdGFmZlBpdm90LnBvc2l0aW9uLnNldCgwLjM0LCAwLjYsIDAuMTQpO1xuICAgIGNvbnN0IHJvZCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdyb2QnLCB7IGhlaWdodDogMS41LCBkaWFtZXRlcjogMC4wNDUsIHRlc3NlbGxhdGlvbjogOCB9LCBzKSwgdGhpcy5zdGFmZlBpdm90KTsgcm9kLnBvc2l0aW9uLnkgPSAwLjQ1OyByb2QubWF0ZXJpYWwgPSBtYXQoMC4yOCwgMC4xNywgMC4xKTtcbiAgICB0aGlzLmNyeXN0YWxNYXQgPSBnbG93TWF0KDAuNzUsIDAuMzUsIDEpO1xuICAgIHRoaXMuY3J5c3RhbCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBvbHloZWRyb24oJ2NyeXN0YWwnLCB7IHR5cGU6IDEsIHNpemU6IDAuMTIgfSwgcyksIHRoaXMuc3RhZmZQaXZvdCk7IHRoaXMuY3J5c3RhbC5wb3NpdGlvbi55ID0gMS4yODsgdGhpcy5jcnlzdGFsLnNjYWxpbmcueSA9IDEuNTsgdGhpcy5jcnlzdGFsLnJvdGF0aW9uLnggPSAwLjQ7IHRoaXMuY3J5c3RhbC5tYXRlcmlhbCA9IHRoaXMuY3J5c3RhbE1hdDtcbiAgICBjb25zdCByaW5nID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygnYmFzZScsIHsgcmFkaXVzOiAwLjYyLCB0ZXNzZWxsYXRpb246IDMwIH0sIHMpLCB0aGlzLmhvbGRlcik7IHJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyByaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyByaW5nLm1hdGVyaWFsID0gZ2xvd01hdCgwLjQsIDAuMTUsIDAuNzUsIDAuNTUpO1xuICAgIC8vIGF1cmFcbiAgICBjb25zdCBwcyA9IHRoaXMucHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnbmVjcm9BdXJhJywgODAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSBzb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5ob2xkZXI7XG4gICAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMywgMCwgLTAuMyk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMywgMC45LCAwLjMpOyBwcy5taW5MaWZlVGltZSA9IDAuNjsgcHMubWF4TGlmZVRpbWUgPSAxLjM7XG4gICAgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMTUsIDAuOSwgLTAuMTUpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjE1LCAxLjYsIDAuMTUpOyBwcy5taW5FbWl0UG93ZXIgPSAwLjM7IHBzLm1heEVtaXRQb3dlciA9IDAuODsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4wNzsgcHMubWF4U2l6ZSA9IDAuMjsgcHMuZW1pdFJhdGUgPSAzMDsgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDAuOCwgMC4zNSwgMSwgMC43KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KDAuNDUsIDAuMTUsIDAuOSwgMC41KTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICBzZXRFbmFibGVkKG9uOiBib29sZWFuKSB7IHRoaXMuaG9sZGVyLnNldEVuYWJsZWQob24pOyBpZiAob24pIHRoaXMucHMuc3RhcnQoKTsgZWxzZSB0aGlzLnBzLnN0b3AoKTsgfVxuICAvKiogV29ybGQgcG9zaXRpb24gb2YgdGhlIHN0YWZmIGNyeXN0YWwgKGZvciBzcGVsbCBlZmZlY3RzKS4gKi9cbiAgY3J5c3RhbFBvcygpOiBhbnkgeyB0aGlzLmhvbGRlci5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHRoaXMucmlnLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgdGhpcy5zdGFmZlBpdm90LmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgdGhpcy5jcnlzdGFsLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgcmV0dXJuIHRoaXMuY3J5c3RhbC5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuY2xvbmUoKTsgfVxuXG4gIGh1cnQoKSB7IHRoaXMuaHVydFQgPSAwLjg7IH1cbiAgY2FzdCgpIHsgdGhpcy5jYXN0VCA9IDEuMTsgfVxuICAvKiogVGhlIGxhc3QgaGVhcnQgaXMgZ29uZTogaGUgc2lua3MgdG8gaGlzIGtuZWVzLCB0aGUgZXllcyBkaW0uICovXG4gIGRlZmVhdCgpIHsgdGhpcy5kb3duVGFyZ2V0ID0gMTsgfVxuICByZXZpdmUoKSB7IHRoaXMuZG93blRhcmdldCA9IDA7IHRoaXMuaHVydFQgPSAwOyB0aGlzLmNhc3RUID0gMDsgfVxuXG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0O1xuICAgIHRoaXMuZG93biArPSAodGhpcy5kb3duVGFyZ2V0IC0gdGhpcy5kb3duKSAqIE1hdGgubWluKDEsIGR0ICogMyk7XG4gICAgY29uc3QgYm9iID0gTWF0aC5zaW4odGhpcy50ICogMikgKiAwLjAzNSAqICgxIC0gdGhpcy5kb3duKTtcbiAgICBsZXQgcmVjb2lsID0gMCwgZmxhc2ggPSAwO1xuICAgIGlmICh0aGlzLmh1cnRUID4gMCkgeyB0aGlzLmh1cnRUID0gTWF0aC5tYXgoMCwgdGhpcy5odXJ0VCAtIGR0KTsgY29uc3QgdSA9IHRoaXMuaHVydFQgLyAwLjg7IHJlY29pbCA9IE1hdGguc2luKHUgKiBNYXRoLlBJKSAqIDAuNDI7IGZsYXNoID0gdTsgfVxuICAgIGxldCByYWlzZSA9IDA7XG4gICAgaWYgKHRoaXMuY2FzdFQgPiAwKSB7IHRoaXMuY2FzdFQgPSBNYXRoLm1heCgwLCB0aGlzLmNhc3RUIC0gZHQpOyBjb25zdCB1ID0gdGhpcy5jYXN0VCAvIDEuMTsgcmFpc2UgPSBNYXRoLnNpbihNYXRoLm1pbigxLCAoMSAtIHUpICogMS42KSAqIE1hdGguUEkgKiAwLjUpICogKHUgPiAwLjI1ID8gMSA6IHUgLyAwLjI1KTsgfVxuICAgIHRoaXMucmlnLnBvc2l0aW9uLnkgPSBib2IgLSAwLjI4ICogdGhpcy5kb3duOyB0aGlzLnJpZy5yb3RhdGlvbi54ID0gLXJlY29pbCArIDAuOSAqIHRoaXMuZG93bjsgdGhpcy5yaWcucm90YXRpb24ueiA9IE1hdGguc2luKHRoaXMudCAqIDEuMykgKiAwLjAzICsgTWF0aC5zaW4odGhpcy5odXJ0VCAqIDYwKSAqIDAuMDMgKiAodGhpcy5odXJ0VCA+IDAgPyAxIDogMCk7XG4gICAgdGhpcy5zdGFmZlBpdm90LnJvdGF0aW9uLnogPSAtMC4xNSAqIHJhaXNlIC0gMC4wNTsgdGhpcy5zdGFmZlBpdm90LnJvdGF0aW9uLnggPSAtMC40NSAqIHJhaXNlOyB0aGlzLnN0YWZmUGl2b3QucG9zaXRpb24ueSA9IDAuNiArIDAuMzUgKiByYWlzZTtcbiAgICB0aGlzLmNyeXN0YWwucm90YXRpb24ueSArPSBkdCAqICgyICsgNiAqIHJhaXNlKTsgY29uc3QgcHVsc2UgPSAxICsgMC4xMiAqIE1hdGguc2luKHRoaXMudCAqIDQpICsgMS4xICogcmFpc2U7IHRoaXMuY3J5c3RhbC5zY2FsaW5nLnNldChwdWxzZSwgMS41ICogcHVsc2UsIHB1bHNlKTtcbiAgICBjb25zdCBkaW0gPSAxIC0gMC44NSAqIHRoaXMuZG93bjtcbiAgICB0aGlzLmNyeXN0YWxNYXQuZW1pc3NpdmVDb2xvci5zZXQoKDAuNzUgKyAwLjI1ICogcmFpc2UpICogZGltLCAoMC4zNSArIDAuNCAqIHJhaXNlKSAqIGRpbSwgMSAqIGRpbSk7XG4gICAgdGhpcy5leWVNYXQuZW1pc3NpdmVDb2xvci5zZXQoMC45ICogZGltICsgZmxhc2ggKiAwLjEsICgwLjQgKyAwLjI1ICogcmFpc2UpICogZGltICogKDEgLSBmbGFzaCAqIDAuNiksIDEgKiBkaW0gKiAoMSAtIGZsYXNoICogMC43KSk7XG4gICAgdGhpcy5yb2JlTWF0LmVtaXNzaXZlQ29sb3Iuc2V0KDAuMDUgKyBmbGFzaCAqIDAuNiwgMC4wMiwgMC4xICogKDEgLSBmbGFzaCkpO1xuICAgIHRoaXMuZ2xvdy5zY2FsaW5nLnNldEFsbCgwLjYgKyAwLjkgKiBkaW0gKyByYWlzZSAqIDAuOCk7XG4gICAgdGhpcy5wcy5lbWl0UmF0ZSA9ICgzMCArIDkwICogcmFpc2UpICogZGltO1xuICB9XG5cbiAgZGlzcG9zZSgpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cbiIsICIvLyBFdmVyeXRoaW5nIHlvdSBTRUUgZm9yIGEgdW5pdDogcmVhbCBUcmlwbyBtb2RlbHMgKFNrZWxldG9uIFdhcnJpb3IsIFNrZWxldG9uIEFyY2hlciksIHNpbXBsZSBzdGFuZC1pbnMgZm9yIHRoZSBmb3VyXG4vLyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBnZW5lcmF0ZWQgeWV0LCBhbmQgdGhlIFwic3RhciBsb29rXCIgbGF5ZXJlZCBvbiB0b3Agb2YgYm90aCAoc2l6ZSwgdGludCwgYXVyYSwgaGFsbywgYmFkZ2UpLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcblxuZXhwb3J0IHR5cGUgVlN0YXRlID0gJ2lkbGUnIHwgJ3J1bicgfCAnYXR0YWNrJyB8ICdkZWF0aCcgfCAnc3Bhd24nIHwgJ2NoZWVyJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uICsgeWF3IGhlcmVcbiAgdGVhbTogMCB8IDE7IHN0YXI6IG51bWJlcjsgc3RhdGU6IFZTdGF0ZTsgdG9wOiBudW1iZXI7XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQ/OiBudW1iZXIpOiB2b2lkO1xuICBzZXRTdGFyKHN0YXI6IG51bWJlcik6IHZvaWQ7XG4gIHNldFRlYW0odGVhbTogMCB8IDEpOiB2b2lkO1xuICBzZXRIcChmcmFjOiBudW1iZXIgfCBudWxsKTogdm9pZDsgIC8vIG51bGwgaGlkZXMgdGhlIGhlYWx0aCBiYXJcbiAgc2V0TWFuYShmcmFjOiBudW1iZXIgfCBudWxsKTogdm9pZDsgLy8gbnVsbCBoaWRlcyB0aGUgbWFuYSBiYXIgKHVuaXRzIHdpdGhvdXQgYSBza2lsbClcbiAgcHVsc2UoKTogdm9pZDsgICAgICAgICAgICAgICAgICAgICAvLyBicmllZiBoaXQgcmVhY3Rpb25cbiAgdXBkYXRlKGR0OiBudW1iZXIpOiB2b2lkO1xuICBkaXNwb3NlKCk6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhciBsb29rc1xuLy8gMSBzdGFyID0gdGhlIHBsYWluIG1vZGVsLiAyIHN0YXJzID0gYSBsaXR0bGUgYmlnZ2VyLCBjb29sIHNpbHZlci1ibHVlIHRpbnQsIGJyaWdodGVyIGF1cmEuIDMgc3RhcnMgPSBiaWdnZXN0LCB3YXJtIGdvbGQgdGludCxcbi8vIHN0cm9uZyBnb2xkLXZpb2xldCBhdXJhIGFuZCBhIGZsb2F0aW5nIGdvbGQgaGFsby4gRXZlcnl0aGluZyBoZXJlIGlzIGZyZWU6IG5vIGV4dHJhIFRyaXBvIGdlbmVyYXRpb25zLlxuY29uc3QgVElOVDogbnVtYmVyW11bXSA9IFtbMSwgMSwgMV0sIFswLjg2LCAwLjk1LCAxLjE4XSwgWzEuMjUsIDEuMSwgMC43XV07XG5jb25zdCBBVVJBID0gW1xuICB7IHJhdGU6IDE0LCBtaW46IDAuMDYsIG1heDogMC4xNiwgYzE6IFswLjc4LCAwLjM1LCAxLCAwLjddLCBjMjogWzAuNDUsIDAuMTUsIDAuOSwgMC41XSB9LFxuICB7IHJhdGU6IDI2LCBtaW46IDAuMDgsIG1heDogMC4yMCwgYzE6IFswLjg1LCAwLjY1LCAxLCAwLjhdLCBjMjogWzAuNTUsIDAuNCwgMSwgMC42XSB9LFxuICB7IHJhdGU6IDQ0LCBtaW46IDAuMTAsIG1heDogMC4yNiwgYzE6IFsxLCAwLjg1LCAwLjQsIDAuODVdLCBjMjogWzAuOCwgMC4zLCAxLCAwLjddIH0sXG5dO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFzc2V0cyB7XG4gIHNjZW5lOiBhbnk7IHNvZnQ6IGFueTsgc3RhclRleDogYW55W107IHRyaXBvOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIFRyaXBvQ2ZnPj47XG4gIHJpbmdNYXQ6IGFueVtdOyBoYWxvTWF0OiBhbnk7IGJhckJnOiBhbnk7IGJhckZpbGw6IGFueVtdOyBtYW5hRmlsbDogYW55O1xufVxuaW50ZXJmYWNlIFRyaXBvQ2ZnIHsgY29udGFpbmVyOiBhbnk7IGVuZW15VGV4OiBhbnk7IGNsaXBzOiBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+OyBtYXRDYWNoZTogUmVjb3JkPHN0cmluZywgYW55PjsgYmFzZU1hdD86IGFueTsgdG9wOiBudW1iZXI7IHNjYWxlOiBudW1iZXIgfVxuXG5mdW5jdGlvbiBkeW4oc2NlbmU6IGFueSwgdzogbnVtYmVyLCBoOiBudW1iZXIsIGRyYXc6IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHZvaWQsIGFscGhhID0gdHJ1ZSkge1xuICBjb25zdCB0ID0gbmV3IEJBQllMT04uRHluYW1pY1RleHR1cmUoJ2R0JywgeyB3aWR0aDogdywgaGVpZ2h0OiBoIH0sIHNjZW5lLCB0cnVlKTsgZHJhdyh0LmdldENvbnRleHQoKSk7IHQudXBkYXRlKCk7IHQuaGFzQWxwaGEgPSBhbHBoYTsgcmV0dXJuIHQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkQXNzZXRzKHNjZW5lOiBhbnkpOiBQcm9taXNlPEFzc2V0cz4ge1xuICBjb25zdCBzb2Z0ID0gZHluKHNjZW5lLCA2NCwgNjQsIChjKSA9PiB7IGNvbnN0IGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KDMyLCAzMiwgMCwgMzIsIDMyLCAzMik7IGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDEpJyk7IGcuYWRkQ29sb3JTdG9wKDAuNCwgJ3JnYmEoMjU1LDI1NSwyNTUsLjU1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpOyBjLmZpbGxTdHlsZSA9IGc7IGMuZmlsbFJlY3QoMCwgMCwgNjQsIDY0KTsgfSk7XG4gIGNvbnN0IHN0YXJUZXggPSBbMSwgMiwgM10ubWFwKChuKSA9PiBkeW4oc2NlbmUsIDE5MiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDQwcHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gNTsgYy5zdHJva2VTdHlsZSA9ICcjMWExMDIwJzsgYy5maWxsU3R5bGUgPSBuID09PSAzID8gJyNmZmQyNGEnIDogbiA9PT0gMiA/ICcjZDdlNmZmJyA6ICcjZjBkOWEwJzsgY29uc3QgcyA9ICdcdTI2MDUnLnJlcGVhdChuKTsgYy5zdHJva2VUZXh0KHMsIDk2LCAzOCk7IGMuZmlsbFRleHQocywgOTYsIDM4KTsgfSkpO1xuICBjb25zdCBlbWlzc2l2ZSA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyLCBhID0gMSkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZW0nLCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHIsIGcsIGIpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYWxwaGEgPSBhOyByZXR1cm4gbTsgfTtcbiAgY29uc3QgQTogQXNzZXRzID0ge1xuICAgIHNjZW5lLCBzb2Z0LCBzdGFyVGV4LCB0cmlwbzoge30sIHJpbmdNYXQ6IFtlbWlzc2l2ZSgwLjU1LCAwLjIsIDAuOTUsIDAuOSksIGVtaXNzaXZlKDAuOTUsIDAuMjUsIDAuMiwgMC45KV0sIGhhbG9NYXQ6IGVtaXNzaXZlKDEsIDAuODIsIDAuMywgMC45NSksXG4gICAgYmFyQmc6IGVtaXNzaXZlKDAuMDUsIDAuMDUsIDAuMDgsIDAuNyksIGJhckZpbGw6IFtlbWlzc2l2ZSgwLjU1LCAwLjM1LCAxKSwgZW1pc3NpdmUoMSwgMC40LCAwLjMpXSwgbWFuYUZpbGw6IGVtaXNzaXZlKDAuMjUsIDAuNzUsIDEpLFxuICB9O1xuICBjb25zdCBkZWZzOiBbU291bElkLCBzdHJpbmcsIHN0cmluZywgUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPiwgbnVtYmVyLCBudW1iZXJdW10gPSBbXG4gICAgWyd3YXJyaW9yJywgJ3NrZWxldG9uX3dhcnJpb3IuZ2xiJywgJ3NrZWxldG9uX3dhcnJpb3JfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdCbG9jaycgfSwgMS4wNSwgMS4wXSxcbiAgICBbJ2FyY2hlcicsICdTa2VsZXRvbkFyY2hlci5nbGInLCAnU2tlbGV0b25BcmNoZXJfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ1Nob290JywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0ZsZXgnIH0sIDEuMDUsIDEuMF0sXG4gIF07XG4gIGF3YWl0IFByb21pc2UuYWxsKGRlZnMubWFwKGFzeW5jIChbc291bCwgZ2xiLCBlbmVteSwgY2xpcHMsIHRvcCwgc2NhbGVdKSA9PiB7XG4gICAgY29uc3QgY29udGFpbmVyID0gYXdhaXQgQkFCWUxPTi5TY2VuZUxvYWRlci5Mb2FkQXNzZXRDb250YWluZXJBc3luYygnYXNzZXRzLycsIGdsYiwgc2NlbmUpO1xuICAgIEEudHJpcG9bc291bF0gPSB7IGNvbnRhaW5lciwgZW5lbXlUZXg6IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy8nICsgZW5lbXksIHNjZW5lLCBmYWxzZSwgZmFsc2UpLCBjbGlwcywgbWF0Q2FjaGU6IHt9LCB0b3AsIHNjYWxlIH07XG4gIH0pKTtcbiAgcmV0dXJuIEE7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2hhcmVkIGRlY29yYXRpb25cbmNsYXNzIERlY28ge1xuICBwcml2YXRlIHBzOiBhbnkgPSBudWxsOyBwcml2YXRlIGhhbG86IGFueSA9IG51bGw7IHByaXZhdGUgYmFkZ2U6IGFueTsgcHJpdmF0ZSBzdGFyczogYW55OyBwcml2YXRlIGZpbGw6IGFueTsgcHJpdmF0ZSBiYXI6IGFueTsgcHJpdmF0ZSBtYmc6IGFueTsgcHJpdmF0ZSBtZmlsbDogYW55OyBwcml2YXRlIHJpbmc6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgcGFyZW50OiBhbnksIHByaXZhdGUgdG9wOiBudW1iZXIsIHByaXZhdGUgcmFkaXVzOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZTtcbiAgICB0aGlzLnJpbmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZURpc2MoJ3JpbmcnLCB7IHJhZGl1czogTWF0aC5tYXgoMC4zLCByYWRpdXMgKiAxLjE1KSwgdGVzc2VsbGF0aW9uOiAyNiB9LCBzKTsgdGhpcy5yaW5nLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdGhpcy5yaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyB0aGlzLnJpbmcucGFyZW50ID0gcGFyZW50OyB0aGlzLnJpbmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMuYmFkZ2UgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdiYWRnZScsIHMpOyB0aGlzLmJhZGdlLnBhcmVudCA9IHBhcmVudDsgdGhpcy5iYWRnZS5wb3NpdGlvbi55ID0gdG9wICsgMC4zMjsgdGhpcy5iYWRnZS5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMO1xuICAgIHRoaXMuc3RhcnMgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdzdGFycycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjE1IH0sIHMpOyB0aGlzLnN0YXJzLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuc3RhcnMucG9zaXRpb24ueSA9IDAuMTE7IHRoaXMuc3RhcnMuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IHNtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnc20nLCBzKTsgc20uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IHNtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHNtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgdGhpcy5zdGFycy5tYXRlcmlhbCA9IHNtOyAodGhpcy5zdGFycyBhcyBhbnkpLl9zbSA9IHNtO1xuICAgIGNvbnN0IGJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnYmcnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4wODUgfSwgcyk7IGJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IGJnLm1hdGVyaWFsID0gQS5iYXJCZzsgYmcuaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmJhciA9IGJnO1xuICAgIHRoaXMuZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2ZpbGwnLCB7IHdpZHRoOiAwLjU2LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMuZmlsbC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLmZpbGwucG9zaXRpb24ueiA9IC0wLjAwMjsgdGhpcy5maWxsLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLm1iZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21iZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA1IH0sIHMpOyB0aGlzLm1iZy5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLm1iZy5wb3NpdGlvbi55ID0gLTAuMDc7IHRoaXMubWJnLm1hdGVyaWFsID0gQS5iYXJCZzsgdGhpcy5tYmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWZpbGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdtZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wMyB9LCBzKTsgdGhpcy5tZmlsbC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLm1maWxsLnBvc2l0aW9uLnNldCgwLCAtMC4wNywgLTAuMDAyKTsgdGhpcy5tZmlsbC5tYXRlcmlhbCA9IEEubWFuYUZpbGw7IHRoaXMubWZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMuYmFyLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLmZpbGwuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWJnLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1maWxsLnNldEVuYWJsZWQoZmFsc2UpO1xuICB9XG4gIHNldCh0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IHRoaXMuQS5zY2VuZSwgY2ZnID0gQVVSQVtzdGFyIC0gMV07XG4gICAgKHRoaXMuc3RhcnMgYXMgYW55KS5fc20uZGlmZnVzZVRleHR1cmUgPSB0aGlzLkEuc3RhclRleFtzdGFyIC0gMV07XG4gICAgdGhpcy5yaW5nLm1hdGVyaWFsID0gdGhpcy5BLnJpbmdNYXRbdGVhbV07IHRoaXMuZmlsbC5tYXRlcmlhbCA9IHRoaXMuQS5iYXJGaWxsW3RlYW1dO1xuICAgIGlmICh0ZWFtID09PSAwKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByYWlzZWQgYnkgdGhlIE5lY3JvbWFuY2VyOiBwdXJwbGUgYXVyYSB0aGF0IGdyb3dzIHdpdGggc3RhcnNcbiAgICAgIGlmICghdGhpcy5wcykge1xuICAgICAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdhdXJhJywgNzAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IHRoaXMucGFyZW50OyBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yLCAwLCAtMC4yKTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCB0aGlzLnRvcCAqIDAuNSwgMC4yKTtcbiAgICAgICAgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMS4xOyBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xNSwgMC44LCAtMC4xNSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMTUsIDEuNSwgMC4xNSk7XG4gICAgICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuMzU7IHBzLm1heEVtaXRQb3dlciA9IDAuODsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyB0aGlzLnBzID0gcHM7XG4gICAgICB9XG4gICAgICBjb25zdCBwID0gdGhpcy5wczsgcC5lbWl0UmF0ZSA9IGNmZy5yYXRlOyBwLm1pblNpemUgPSBjZmcubWluOyBwLm1heFNpemUgPSBjZmcubWF4OyBwLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi5jZmcuYzEpOyBwLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi5jZmcuYzIpOyBwLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgICBpZiAoIXAuaXNTdGFydGVkKCkpIHAuc3RhcnQoKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMucHMgJiYgdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdG9wKCk7XG4gICAgaWYgKHN0YXIgPj0gMykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGdvbGQgaGFsbyBhYm92ZSB0aGUgaGVhZFxuICAgICAgaWYgKCF0aGlzLmhhbG8pIHsgdGhpcy5oYWxvID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnaGFsbycsIHsgZGlhbWV0ZXI6IDAuNTUsIHRoaWNrbmVzczogMC4wNCwgdGVzc2VsbGF0aW9uOiAyNCB9LCBzKTsgdGhpcy5oYWxvLnBhcmVudCA9IHRoaXMucGFyZW50OyB0aGlzLmhhbG8ucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4wODsgdGhpcy5oYWxvLm1hdGVyaWFsID0gdGhpcy5BLmhhbG9NYXQ7IHRoaXMuaGFsby5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAgIHRoaXMuaGFsby5zZXRFbmFibGVkKHRydWUpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5oYWxvKSB0aGlzLmhhbG8uc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5iYXIuc2V0RW5hYmxlZChvbik7IHRoaXMuZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMuZmlsbC5zY2FsaW5nLnggPSBrOyB0aGlzLmZpbGwucG9zaXRpb24ueCA9IC0oMC41NiAqICgxIC0gaykpIC8gMjsgfVxuICB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5tYmcuc2V0RW5hYmxlZChvbik7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChvbik7XG4gICAgaWYgKG9uKSB7IGNvbnN0IGsgPSBNYXRoLm1heCgwLjAwMSwgZiBhcyBudW1iZXIpOyB0aGlzLm1maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMubWZpbGwucG9zaXRpb24ueCA9IC0oMC41NiAqICgxIC0gaykpIC8gMjsgfVxuICB9XG4gIHNldEF1cmEob246IGJvb2xlYW4pIHsgaWYgKHRoaXMucHMpIHsgaWYgKG9uICYmICF0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0YXJ0KCk7IGlmICghb24gJiYgdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdG9wKCk7IH0gfVxuICB1cGRhdGUoZHQ6IG51bWJlcikgeyBpZiAodGhpcy5oYWxvICYmIHRoaXMuaGFsby5pc0VuYWJsZWQoKSkgdGhpcy5oYWxvLnJvdGF0aW9uLnkgKz0gZHQgKiAxLjY7IH1cbiAgZGlzcG9zZSgpIHsgaWYgKHRoaXMucHMpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB9IFt0aGlzLmhhbG8sIHRoaXMucmluZywgdGhpcy5zdGFycywgdGhpcy5iYXIsIHRoaXMuZmlsbCwgdGhpcy5tYmcsIHRoaXMubWZpbGxdLmZvckVhY2goKG0pID0+IG0gJiYgbS5kaXNwb3NlKCkpOyB0aGlzLmJhZGdlLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHJlYWwgbW9kZWxzXG5jbGFzcyBUcmlwb1Zpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSBlbnQ6IGFueTsgcHJpdmF0ZSBib2R5OiBhbnk7IHByaXZhdGUgYW5pbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTsgcHJpdmF0ZSBjdXI6IGFueSA9IG51bGw7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBiYXNlOiBudW1iZXI7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIGNmZzogVHJpcG9DZmcsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCB1aWQgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA3KTtcbiAgICB0aGlzLmVudCA9IGNmZy5jb250YWluZXIuaW5zdGFudGlhdGVNb2RlbHNUb1NjZW5lKChuOiBzdHJpbmcpID0+IG4gKyAnXycgKyB1aWQsIGZhbHNlLCB7IGRvTm90SW5zdGFudGlhdGU6IHRydWUgfSk7XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd1bml0XycgKyB1aWQsIHMpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgdGhpcy5ib2R5ID0gdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZmluZCgobTogYW55KSA9PiBtLm5hbWUuaW5jbHVkZXMoJ19Cb2R5JykpO1xuICAgIGlmICghY2ZnLmJhc2VNYXQpIGNmZy5iYXNlTWF0ID0gdGhpcy5ib2R5Lm1hdGVyaWFsO1xuICAgIHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IHsgZy5zdG9wKCk7IGcuZW5hYmxlQmxlbmRpbmcgPSB0cnVlOyBnLmJsZW5kaW5nU3BlZWQgPSAwLjEyOyB0aGlzLmFuaW1zW2cubmFtZS5zcGxpdCgnXycpWzBdXSA9IGc7IH0pO1xuICAgIHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB9KTtcbiAgICB0aGlzLnRvcCA9IGNmZy50b3A7IHRoaXMuYmFzZSA9IGNmZy5zY2FsZTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIDAuMyk7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiAxLjMsIGRpYW1ldGVyOiAwLjggfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSAwLjY7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5pc1BpY2thYmxlID0gdHJ1ZTtcbiAgICB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICB9XG4gIHByaXZhdGUgYXBwbHlNYXQoKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy50ZWFtICsgJ18nICsgdGhpcy5zdGFyLCBjID0gdGhpcy5jZmc7XG4gICAgaWYgKCFjLm1hdENhY2hlW2tleV0pIHsgY29uc3QgbSA9IGMuYmFzZU1hdC5jbG9uZSgnbV8nICsga2V5KTsgaWYgKHRoaXMudGVhbSA9PT0gMSkgbS5hbGJlZG9UZXh0dXJlID0gYy5lbmVteVRleDsgY29uc3QgdCA9IFRJTlRbdGhpcy5zdGFyIC0gMV07IG0uYWxiZWRvQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjModFswXSwgdFsxXSwgdFsyXSk7IGMubWF0Q2FjaGVba2V5XSA9IG07IH1cbiAgICB0aGlzLmJvZHkubWF0ZXJpYWwgPSBjLm1hdENhY2hlW2tleV07XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwoQkFMQU5DRS5zdGFyLnNjYWxlW3N0IC0gMV0gKiB0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0KHRoaXMudGVhbSwgc3QpOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0TWFuYShmKTsgfVxuICBwdWxzZSgpIHsgdGhpcy5wdWxzZVQgPSAwLjE2OyB9XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQgPSAxKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbdGhpcy5jZmcuY2xpcHNbc3RhdGVdXTsgaWYgKCFnKSByZXR1cm47IGNvbnN0IGxvb3AgPSBzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJztcbiAgICBpZiAobG9vcCAmJiB0aGlzLnN0YXRlID09PSBzdGF0ZSAmJiB0aGlzLmN1ciA9PT0gZykgcmV0dXJuO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChsb29wLCBzcGVlZCwgZy5mcm9tLCBnLnRvKTtcbiAgICBpZiAobG9vcCkgZy5nb1RvRnJhbWUoZy5mcm9tICsgTWF0aC5yYW5kb20oKSAqIChnLnRvIC0gZy5mcm9tKSk7XG4gICAgdGhpcy5jdXIgPSBnOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTtcbiAgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMuZGVjby51cGRhdGUoZHQpO1xuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwoQkFMQU5DRS5zdGFyLnNjYWxlW3RoaXMuc3RhciAtIDFdICogdGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5waWNrLmRpc3Bvc2UoKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmRpc3Bvc2UoZmFsc2UsIGZhbHNlKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhbmQtaW5zXG5jb25zdCBQSDogUmVjb3JkPHN0cmluZywgeyBjb2w6IHN0cmluZzsgdzogbnVtYmVyOyBoOiBudW1iZXI7IGhlYWQ6IG51bWJlcjsgd2VhcG9uOiBzdHJpbmc7IGxhYmVsOiBzdHJpbmcgfT4gPSB7XG4gIGdvYmxpbjogeyBjb2w6ICcjNjNiMTNmJywgdzogMC4zNiwgaDogMC40MiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnZGFnZ2VyJywgbGFiZWw6ICdHT0JMSU4nIH0sXG4gIGtuaWdodDogeyBjb2w6ICcjOGVhOWRjJywgdzogMC41LCBoOiAwLjYsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ3NoaWVsZCcsIGxhYmVsOiAnS05JR0hUJyB9LFxuICBvZ3JlOiB7IGNvbDogJyNhOGE2NGEnLCB3OiAwLjg1LCBoOiAwLjg1LCBoZWFkOiAwLjQyLCB3ZWFwb246ICdtYWNlJywgbGFiZWw6ICdPR1JFJyB9LFxuICBiYXJiYXJpYW46IHsgY29sOiAnI2Q2OGE1NScsIHc6IDAuNTIsIGg6IDAuNjIsIGhlYWQ6IDAuMzgsIHdlYXBvbjogJ2F4ZScsIGxhYmVsOiAnQkFSQkFSSUFOJyB9LFxufTtcbmNsYXNzIFBsYWNlaG9sZGVyVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIHJpZzogYW55OyBwcml2YXRlIGxlZ3M6IGFueVtdID0gW107IHByaXZhdGUgd3A6IGFueTsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSB0ID0gTWF0aC5yYW5kb20oKSAqIDY7IHByaXZhdGUgc3QwID0gMDsgcHJpdmF0ZSBkdXIgPSAxOyBwcml2YXRlIGJhc2UgPSAxOyBwcml2YXRlIHB1bHNlVCA9IDA7IHByaXZhdGUgbWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBib2R5OiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHNvdWw6IHN0cmluZywgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCBkID0gUEhbc291bF07IHRoaXMudGVhbSA9IHRlYW07XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdwaF8nICsgc291bCwgcyk7IHRoaXMucmlnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncmlnJywgcyk7IHRoaXMucmlnLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIGNvbnN0IG1hdCA9IChoZXg6IHN0cmluZywgZW0gPSAwKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdwbScsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoaGV4KS5zY2FsZSgwLjcyKTsgbS5zcGVjdWxhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMSwgMC4xLCAwLjEpOyBpZiAoZW0pIG0uZW1pc3NpdmVDb2xvciA9IG0uZGlmZnVzZUNvbG9yLnNjYWxlKGVtKTsgcmV0dXJuIG07IH07XG4gICAgY29uc3QgbGVnSCA9IDAuMjIsIGJvZHlZID0gbGVnSCArIGQuaCAvIDI7XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGxnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbGVnJywgcyk7IGxnLnBhcmVudCA9IHRoaXMucmlnOyBsZy5wb3NpdGlvbi5zZXQoc3ggKiBkLncgKiAwLjIyLCBsZWdILCAwKTsgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2wnLCB7IGhlaWdodDogbGVnSCwgZGlhbWV0ZXI6IGQudyAqIDAuMjggfSwgcyk7IG0ucGFyZW50ID0gbGc7IG0ucG9zaXRpb24ueSA9IC1sZWdIIC8gMjsgbS5tYXRlcmlhbCA9IG1hdCgnIzRhMzgyNicpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5sZWdzLnB1c2gobGcpOyB9XG4gICAgdGhpcy5ib2R5ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDYXBzdWxlKCdib2R5JywgeyByYWRpdXM6IGQudyAvIDIsIGhlaWdodDogZC5oICsgZC53ICogMC40IH0sIHMpOyB0aGlzLmJvZHkucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMuYm9keS5wb3NpdGlvbi55ID0gYm9keVk7IHRoaXMuYm9keS5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IHRoaXMuYm9keS5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgaGVhZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdoZWFkJywgeyBkaWFtZXRlcjogZC5oZWFkICogMS41LCBzZWdtZW50czogMTIgfSwgcyk7IGhlYWQucGFyZW50ID0gdGhpcy5yaWc7IGhlYWQucG9zaXRpb24ueSA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAwLjU1OyBoZWFkLm1hdGVyaWFsID0gbWF0KGQuY29sKTsgaGVhZC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgZXllTSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2V5ZScsIHMpOyBleWVNLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IGV5ZU0uZW1pc3NpdmVDb2xvciA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7ICh0aGlzIGFzIGFueSkuZXllTSA9IGV5ZU07XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZScsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDAuMyB9LCBzKTsgZS5wYXJlbnQgPSB0aGlzLnJpZzsgZS5wb3NpdGlvbi5zZXQoc3ggKiBkLmhlYWQgKiAwLjMsIGhlYWQucG9zaXRpb24ueSArIDAuMDIsIGQuaGVhZCAqIDAuNjYpOyBlLm1hdGVyaWFsID0gZXllTTsgZS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAvLyB3ZWFwb24gcGl2b3QgYXQgdGhlIHNob3VsZGVyLCBvbiB0aGUgY2hhcmFjdGVyJ3MgcmlnaHQgKC14IGlzIGZpbmUgZm9yIGEgc3RhbmQtaW4pXG4gICAgdGhpcy53cCA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3dwJywgcyk7IHRoaXMud3AucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMud3AucG9zaXRpb24uc2V0KGQudyAqIDAuNiwgbGVnSCArIGQuaCAqIDAuODUsIDAuMDUpO1xuICAgIGNvbnN0IHdtID0gbWF0KCcjN2E1YTMwJyksIGlyb24gPSBtYXQoJyM5YWExYWQnKTtcbiAgICBjb25zdCBtayA9IChtOiBhbnksIGtpbmQ6IHN0cmluZywgZGltczogYW55LCBwb3M6IG51bWJlcltdLCBtdDogYW55KSA9PiB7IGNvbnN0IHggPSBraW5kID09PSAnYm94JyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQm94KCd3JywgZGltcywgcykgOiBraW5kID09PSAnY3lsJyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3cnLCBkaW1zLCBzKSA6IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCd3JywgZGltcywgcyk7IHgucGFyZW50ID0gdGhpcy53cDsgeC5wb3NpdGlvbi5zZXQocG9zWzBdLCBwb3NbMV0sIHBvc1syXSk7IHgubWF0ZXJpYWwgPSBtdDsgeC5pc1BpY2thYmxlID0gZmFsc2U7IHJldHVybiB4OyB9O1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ2RhZ2dlcicpIG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA1LCBoZWlnaHQ6IDAuMywgZGVwdGg6IDAuMDMgfSwgWzAsIC0wLjIsIDAuMTJdLCBpcm9uKTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdzaGllbGQnKSB7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA2LCBoZWlnaHQ6IDAuNSwgZGVwdGg6IDAuMDQgfSwgWzAsIC0wLjMsIDAuMTRdLCBpcm9uKTsgY29uc3Qgc2ggPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzaCcsIHsgaGVpZ2h0OiAwLjA1LCBkaWFtZXRlcjogMC41NSB9LCBzKTsgc2gucGFyZW50ID0gdGhpcy5yaWc7IHNoLnJvdGF0aW9uLnogPSBNYXRoLlBJIC8gMjsgc2gucG9zaXRpb24uc2V0KC1kLncgKiAwLjcsIGxlZ0ggKyBkLmggKiAwLjYsIDAuMDUpOyBzaC5tYXRlcmlhbCA9IG1hdCgnI2Q4YjY0YScpOyBzaC5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdtYWNlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuOSwgZGlhbWV0ZXI6IDAuMDggfSwgWzAsIC0wLjM1LCAwLjNdLCB3bSk7IG1rKDAsICdzcGgnLCB7IGRpYW1ldGVyOiAwLjQgfSwgWzAsIC0wLjg1LCAwLjRdLCBpcm9uKTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ2F4ZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjYsIGRpYW1ldGVyOiAwLjA1IH0sIFswLCAtMC4yLCAwLjE1XSwgd20pOyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4zMiwgaGVpZ2h0OiAwLjIyLCBkZXB0aDogMC4wNSB9LCBbMCwgLTAuNSwgMC4xNV0sIGlyb24pOyBjb25zdCBoYWlyID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignaGFpcicsIHsgaGVpZ2h0OiAwLjMsIGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogZC5oZWFkICogMS4yIH0sIHMpOyBoYWlyLnBhcmVudCA9IHRoaXMucmlnOyBoYWlyLnBvc2l0aW9uLnkgPSBoZWFkLnBvc2l0aW9uLnkgKyBkLmhlYWQgKiAwLjc1OyBoYWlyLm1hdGVyaWFsID0gbWF0KCcjYzIyYTFjJyk7IGhhaXIuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgdGhpcy50b3AgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMS4zNTsgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCBkLncgKiAwLjcpO1xuICAgIGNvbnN0IGxibCA9IGR5bihzLCAyNTYsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCAyNnB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmZpbGxTdHlsZSA9ICcjZmZmZmZmJzsgYy5zdHJva2VTdHlsZSA9ICcjMTExJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyBjLmZpbGxUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgfSk7XG4gICAgY29uc3QgbHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdsYmwnLCB7IHdpZHRoOiAxLjEsIGhlaWdodDogMC4yIH0sIHMpOyBscC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgbHAucG9zaXRpb24ueSA9IC0wLjE7IGxwLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMiAqIDAuMDsgbHAuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDsgY29uc3QgbG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdsbScsIHMpOyBsbS5kaWZmdXNlVGV4dHVyZSA9IGxibDsgbG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IGxtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IGxtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbHAubWF0ZXJpYWwgPSBsbTsgbHAuaXNQaWNrYWJsZSA9IGZhbHNlOyBscC5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjYyO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogdGhpcy50b3AsIGRpYW1ldGVyOiBNYXRoLm1heCgwLjcsIGQudyAqIDEuMykgfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCAvIDI7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgICAodGhpcyBhcyBhbnkpLnBhcnRzID0gW2xwXTsgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGxheSgnaWRsZScpO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgKHRoaXMgYXMgYW55KS5leWVNLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmJhc2UgPSBCQUxBTkNFLnN0YXIuc2NhbGVbc3QgLSAxXTsgY29uc3QgdCA9IFRJTlRbc3QgLSAxXTsgdGhpcy5ib2R5Lm1hdGVyaWFsLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoUEhbdGhpcy5zb3VsXS5jb2wpLnNjYWxlKDAuNzIpLm11bHRpcGx5KG5ldyBCQUJZTE9OLkNvbG9yMyhNYXRoLm1pbigxLCB0WzBdKSwgTWF0aC5taW4oMSwgdFsxXSksIE1hdGgubWluKDEsIHRbMl0pKSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHsgaWYgKHN0YXRlID09PSB0aGlzLnN0YXRlICYmIChzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJykpIHJldHVybjsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLnN0MCA9IHRoaXMudDsgdGhpcy5kdXIgPSBzdGF0ZSA9PT0gJ2F0dGFjaycgPyAoQkFMQU5DRS5zdGF0c1t0aGlzLnNvdWwgYXMgU291bElkXS5hbmltTGVuIC8gc3BlZWQpIDogc3RhdGUgPT09ICdkZWF0aCcgPyAwLjYgOiBzdGF0ZSA9PT0gJ3NwYXduJyA/IDAuOSA6IDEuMDsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpOyB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0OyB0aGlzLmRlY28udXBkYXRlKGR0KTsgY29uc3QgcCA9IE1hdGgubWluKDEsICh0aGlzLnQgLSB0aGlzLnN0MCkgLyB0aGlzLmR1ciksIFIgPSB0aGlzLnJpZywgVyA9IHRoaXMud3A7XG4gICAgUi5wb3NpdGlvbi5zZXQoMCwgMCwgMCk7IFIucm90YXRpb24uc2V0KDAsIDAsIDApOyBSLnNjYWxpbmcuc2V0QWxsKDEpOyBXLnJvdGF0aW9uLnggPSAtMC40OyB0aGlzLmxlZ3MuZm9yRWFjaCgobCkgPT4gKGwucm90YXRpb24ueCA9IDApKTtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ2lkbGUnKSBSLnBvc2l0aW9uLnkgPSBNYXRoLnNpbih0aGlzLnQgKiAyLjIpICogMC4wMTI7XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHsgY29uc3QgdyA9IHRoaXMudCAqIDEwOyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih3KSkgKiAwLjA3OyBSLnJvdGF0aW9uLnggPSAwLjI7IHRoaXMubGVnc1swXS5yb3RhdGlvbi54ID0gTWF0aC5zaW4odykgKiAwLjk7IHRoaXMubGVnc1sxXS5yb3RhdGlvbi54ID0gLU1hdGguc2luKHcpICogMC45OyBXLnJvdGF0aW9uLnggPSAtMC40ICsgTWF0aC5zaW4odykgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnYXR0YWNrJykgeyBjb25zdCBrID0gcCA8IDAuNCA/IC0yLjQgKiAocCAvIDAuNCkgOiAtMi40ICsgMy40ICogTWF0aC5taW4oMSwgKHAgLSAwLjQpIC8gMC4yNSk7IFcucm90YXRpb24ueCA9IGs7IFIucG9zaXRpb24ueiA9IDAuMTQgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IFIucm90YXRpb24ueCA9IDAuMTUgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB7IGNvbnN0IGUgPSBwICogcCAqICgzIC0gMiAqIHApOyBSLnNjYWxpbmcuc2V0QWxsKDAuMDEgKyAwLjk5ICogZSk7IFIucG9zaXRpb24ueSA9IChlIC0gMSkgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB7IGNvbnN0IGUgPSBwICogcDsgUi5yb3RhdGlvbi54ID0gLU1hdGguUEkgLyAyICogZTsgUi5wb3NpdGlvbi55ID0gMC4yNSAqIGU7IFIucG9zaXRpb24ueiA9IC0wLjIgKiBlOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgeyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih0aGlzLnQgKiA3KSkgKiAwLjE1OyBXLnJvdGF0aW9uLnggPSAtMi42OyB9XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmlzdWFsKEE6IEFzc2V0cywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKTogVW5pdFZpc3VhbCB7XG4gIGNvbnN0IGNmZyA9IEEudHJpcG9bc291bF07XG4gIHJldHVybiBjZmcgPyBuZXcgVHJpcG9WaXN1YWwoQSwgY2ZnLCBzb3VsLCB0ZWFtLCBzdGFyKSA6IG5ldyBQbGFjZWhvbGRlclZpc3VhbChBLCBzb3VsLCB0ZWFtLCBzdGFyKTtcbn1cbmV4cG9ydCBjb25zdCBpc1RyaXBvID0gKEE6IEFzc2V0cywgc291bDogU291bElkKSA9PiAhIUEudHJpcG9bc291bF07XG4iLCAiLy8gRE9NIHVzZXIgaW50ZXJmYWNlOiB0b3AgYmFyLCBlbmVteSBwcmV2aWV3LCBoYW5kIG9mIGNhcmRzLCBidXR0b25zLCBkcmFmdCBvdmVybGF5LCB0b2FzdHMgYW5kIHRoZSBkZWJ1ZyBwYW5lbC5cbmltcG9ydCB7IEJBTEFOQ0UsIFJPTEVfVEVYVCwgU09VTF9OQU1FIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7IGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY29zdCwgZG9taW5pb25GcmVlLCBkb21pbmlvblVzZWQsIHN0YWdlV2F2ZXMgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGVuZW15V2F2ZSwgcHJldmlld1RleHQgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcblxuY29uc3QgSUNPTjogUmVjb3JkPFNvdWxJZCwgc3RyaW5nPiA9IHsgd2FycmlvcjogJ1xcdXsxRjQ4MH0nLCBhcmNoZXI6ICdcXHV7MUYzRjl9JywgZ29ibGluOiAnXFx1ezFGNUUxfVx1RkUwRicsIGtuaWdodDogJ1xcdXsxRjZFMX1cdUZFMEYnLCBvZ3JlOiAnXFx1ezFGNTI4fScsIGJhcmJhcmlhbjogJ1xcdXsxRkE5M30nIH07XG5jb25zdCAkID0gKGlkOiBzdHJpbmcpID0+IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSE7XG5jb25zdCBzdGFycyA9IChuOiBudW1iZXIpID0+ICdcdTI2MDUnLnJlcGVhdChuKTtcblxuZXhwb3J0IGNsYXNzIFVpIHtcbiAgcHJpdmF0ZSB0b2FzdFQgPSAwOyBwcml2YXRlIGRiZzogSFRNTEVsZW1lbnQ7IHByaXZhdGUgb2RkcyA9ICcnO1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIGc6IGFueSkge1xuICAgICQoJ2J0bkJhdHRsZScpLm9uY2xpY2sgPSAoKSA9PiBnLnN0YXJ0QmF0dGxlKCk7ICQoJ2J0blN3YXAnKS5vbmNsaWNrID0gKCkgPT4gZy50b2dnbGVTd2FwKCk7XG4gICAgJCgnYnRuTWVyZ2UnKS5vbmNsaWNrID0gKCkgPT4gZy5tZXJnZVNlbGVjdGVkKCk7ICQoJ2J0blJlbW92ZScpLm9uY2xpY2sgPSAoKSA9PiBnLnJlbW92ZVNlbGVjdGVkKCk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLXNwZWVkXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiBnLnNldFNwZWVkKCtiLmRhdGFzZXQuc3BlZWQhKSkpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0Q2FtTW9kZShiLmRhdGFzZXQuY2FtISkpKTtcbiAgICAkKCdnZWFyJykub25jbGljayA9ICgpID0+IHsgdGhpcy5kYmcuY2xhc3NMaXN0LnRvZ2dsZSgnb3BlbicpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgdGhpcy5kYmcgPSAkKCdkZWJ1ZycpOyBpZiAobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnZGVidWcnKSkgdGhpcy5kYmcuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICAgIHRoaXMucmVuZGVyRGVidWcoKTtcbiAgfVxuXG4gIC8qKiBUaGUgTmVjcm9tYW5jZXIganVzdCBsb3N0IGEgaGVhcnQ6IG1ha2UgdGhlIGhlYXJ0cyBidW1wLiAqL1xuICBwdWxzZUhlYXJ0cygpIHsgY29uc3QgaCA9ICQoJ2hlYXJ0cycpOyBoLmNsYXNzTGlzdC5yZW1vdmUoJ2h1cnQnKTsgdm9pZCBoLm9mZnNldFdpZHRoOyBoLmNsYXNzTGlzdC5hZGQoJ2h1cnQnKTsgfVxuICB0b2FzdChtc2c6IHN0cmluZykgeyBjb25zdCB0ID0gJCgndG9hc3QnKTsgdC50ZXh0Q29udGVudCA9IG1zZzsgdC5jbGFzc0xpc3QuYWRkKCdzaG93Jyk7IGNsZWFyVGltZW91dCh0aGlzLnRvYXN0VCk7IHRoaXMudG9hc3RUID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4gdC5jbGFzc0xpc3QucmVtb3ZlKCdzaG93JyksIDM2MDApOyB9XG5cbiAgcmVuZGVyKCkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmcsIHMgPSBnLnMsIHBoID0gZy5waGFzZSwgYnVpbGQgPSBwaCA9PT0gJ2J1aWxkJztcbiAgICAkKCdoZWFydHMnKS50ZXh0Q29udGVudCA9ICdcdTI3NjRcdUZFMEYnLnJlcGVhdChzLmhlYXJ0cykgKyAnXFx1ezFGNUE0fScucmVwZWF0KE1hdGgubWF4KDAsIDMgLSBzLmhlYXJ0cykpO1xuICAgICQoJ3dhdmUnKS50ZXh0Q29udGVudCA9IGBXYXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9YDtcbiAgICBjb25zdCB1c2VkID0gZG9taW5pb25Vc2VkKHMpOyAkKCdkb20nKS50ZXh0Q29udGVudCA9IGAke3VzZWR9LyR7cy5jYXB9YDsgKCQoJ2RvbWZpbGwnKSBhcyBIVE1MRWxlbWVudCkuc3R5bGUud2lkdGggPSBNYXRoLm1pbigxMDAsICh1c2VkIC8gcy5jYXApICogMTAwKSArICclJztcbiAgICAvLyBlbmVteSBwcmV2aWV3OiB3aGF0IGlzIGNvbWluZywgbmV2ZXIgd2hlcmVcbiAgICBjb25zdCBwdiA9IHByZXZpZXdUZXh0KGVuZW15V2F2ZShzLndhdmUsIGcuc2VlZCkpO1xuICAgICQoJ2VuZW15JykuaW5uZXJIVE1MID0gYDxiPk5leHQgZW5lbWllczwvYj5gICsgcHYubWFwKChwKSA9PiBgPGRpdiBjbGFzcz1cImVyb3dcIj48c3Bhbj4ke0lDT05bcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuPiR7U09VTF9OQU1FW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3BhbiBjbGFzcz1cInhcIj5cdTAwRDcke3AuY291bnR9PC9zcGFuPjxzcGFuIGNsYXNzPVwic3RcIj4ke3N0YXJzKHAuc3Rhcil9PC9zcGFuPjwvZGl2PmApLmpvaW4oJycpICsgYDxkaXYgY2xhc3M9XCJoaW50XCI+UG9zaXRpb25zIHN0YXkgaGlkZGVuIHVudGlsIHRoZSBiYXR0bGUuPC9kaXY+YDtcbiAgICAvLyBoYW5kXG4gICAgY29uc3QgaGFuZCA9ICQoJ2hhbmQnKTsgaGFuZC5pbm5lckhUTUwgPSAnJztcbiAgICBzLmhhbmQuZm9yRWFjaCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IHtcbiAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGNvbnN0IHNlbCA9IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiBnLnNlbC5pZHggPT09IGk7IGNvbnN0IGFmZm9yZCA9IGNhblN1bW1vbihzLCBpKSwgY2FuTWVyZ2UgPSBzLnVuaXRzLnNvbWUoKHU6IGFueSkgPT4gY2FuTWVyZ2VGcm9tSGFuZChzLCBpLCB1LmlkKSksIHVzYWJsZSA9IGFmZm9yZCB8fCBjYW5NZXJnZTtcbiAgICAgIGVsLmNsYXNzTmFtZSA9ICdjYXJkJyArIChzZWwgPyAnIHNlbCcgOiAnJykgKyAoIXVzYWJsZSAmJiAhZy5zd2FwTW9kZSA/ICcgZGlzJyA6ICcnKSArIChnLnN3YXBNb2RlID8gJyBzd2FwJyA6ICcnKTtcbiAgICAgIGNvbnN0IHRhZyA9IGFmZm9yZCA/IGA8c3BhbiBjbGFzcz1cIm9rXCI+U3VtbW9uPC9zcGFuPmAgOiBjYW5NZXJnZSA/ICc8c3BhbiBjbGFzcz1cIm9rIG1nXCI+TWVyZ2Ugb25seTwvc3Bhbj4nIDogJzxzcGFuIGNsYXNzPVwibm9cIj5ObyByb29tPC9zcGFuPic7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+PGRpdiBjbGFzcz1cImljXCI+JHtJQ09OW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJjc1wiPiR7dGFnfTwvZGl2PmA7IGVsLnRpdGxlID0gUk9MRV9URVhUW3NvdWxdICsgKGFmZm9yZCA/ICcnIDogY2FuTWVyZ2UgPyAnIC0gRG9taW5pb24gaXMgZnVsbCwgYnV0IHlvdSBjYW4gbWVyZ2UgaXQgaW50byB5b3VyIG1hdGNoaW5nIDEtc3RhciB1bml0LicgOiAnIC0gTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLicpO1xuICAgICAgZWwub25jbGljayA9ICgpID0+IGcub25DYXJkKGkpOyBoYW5kLmFwcGVuZENoaWxkKGVsKTtcbiAgICB9KTtcbiAgICBpZiAoIXMuaGFuZC5sZW5ndGgpIGhhbmQuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9XCJlbXB0eVwiPk5vIGNhcmRzIGluIGhhbmQ8L2Rpdj4nO1xuICAgIC8vIGJ1dHRvbnNcbiAgICAoJCgnYnRuQmF0dGxlJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQpLmRpc2FibGVkID0gIWJ1aWxkIHx8ICFzLnVuaXRzLmxlbmd0aDtcbiAgICBjb25zdCBzdyA9ICQoJ2J0blN3YXAnKSBhcyBIVE1MQnV0dG9uRWxlbWVudDsgc3cuZGlzYWJsZWQgPSAhYnVpbGQgfHwgcy5kaXNjYXJkVXNlZDsgc3cuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBnLnN3YXBNb2RlKTsgc3cudGV4dENvbnRlbnQgPSBzLmRpc2NhcmRVc2VkID8gJ1N3YXAgdXNlZCcgOiBnLnN3YXBNb2RlID8gJ1N3YXA6IHBpY2sgYSBjYXJkIG9yIHVuaXQnIDogJ1N3YXAgKDEvcm91bmQpJztcbiAgICBjb25zdCBzZWxVID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ3VuaXQnID8gcy51bml0cy5maW5kKCh1OiBhbnkpID0+IHUuaWQgPT09IGcuc2VsLmlkKSA6IG51bGw7XG4gICAgY29uc3QgcGFydG5lciA9IHNlbFUgJiYgcy51bml0cy5zb21lKChvOiBhbnkpID0+IGNhbk1lcmdlRGVwbG95ZWQoc2VsVSwgbykpO1xuICAgICQoJ3VuaXRwYW5lbCcpLnN0eWxlLmRpc3BsYXkgPSBidWlsZCAmJiBzZWxVID8gJ2ZsZXgnIDogJ25vbmUnOyAoJCgnYnRuTWVyZ2UnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhcGFydG5lcjtcbiAgICAkKCdidG5SZW1vdmUnKS50ZXh0Q29udGVudCA9IGcuY29uZmlybVJlbW92ZSA/ICdDb25maXJtIHJlbW92ZScgOiAnUmVtb3ZlJztcbiAgICAkKCdpbmZvJykudGV4dENvbnRlbnQgPSBidWlsZCA/IChnLnN3YXBNb2RlID8gJ1NXQVA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkIGl0LCBvciB0YXAgYSB1bml0IHlvdSBkaWQgbm90IHN1bW1vbiB0aGlzIHJvdW5kIHRvIHNlbGwgaXQuIFlvdSBkcmF3IGEgZGlmZmVyZW50IFNvdWwuJ1xuICAgICAgOiBzZWxVID8gYCR7U09VTF9OQU1FW3NlbFUuc291bCBhcyBTb3VsSWRdfSAke3N0YXJzKHNlbFUuc3Rhcil9ICBcdTIwMjIgICR7Uk9MRV9URVhUW3NlbFUuc291bCBhcyBTb3VsSWRdfSAgJHtwYXJ0bmVyID8gJ1x1MjAyMiBUYXAgYSBnbG93aW5nIHBhcnRuZXIgdG8gbWVyZ2UuJyA6ICcnfWBcbiAgICAgIDogZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnID8gYCR7U09VTF9OQU1FW3MuaGFuZFtnLnNlbC5pZHhdIGFzIFNvdWxJZF19OiAke1JPTEVfVEVYVFtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfSAgXHUyMDIyICBgICsgKCgpID0+IHsgY29uc3QgaSA9IGcuc2VsLmlkeCwgc20gPSBjYW5TdW1tb24ocywgaSksIG1nID0gcy51bml0cy5zb21lKCh1OiBhbnkpID0+IGNhbk1lcmdlRnJvbUhhbmQocywgaSwgdS5pZCkpOyByZXR1cm4gc20gJiYgbWcgPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24sIG9yIGEgZ2xvd2luZyBwdXJwbGUgdW5pdCB0byBtZXJnZSBpdCBpbi4nIDogc20gPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24uJyA6IG1nID8gJ0RvbWluaW9uIGlzIGZ1bGw6IHRhcCBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6ICdOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJzsgfSkoKSA6ICdUYXAgYSBjYXJkLCB0aGVuIGEgdGlsZS4gVGFwIGEgdW5pdCB0byBtZXJnZSwgbW92ZSBvciByZW1vdmUgaXQuJylcbiAgICAgIDogcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnQmF0dGxlISBVbml0cyBmaWdodCBvbiB0aGVpciBvd24uJyA6ICcnO1xuICAgICQoJ3NwZWVkJykuc3R5bGUuZGlzcGxheSA9IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2ZsZXgnIDogJ25vbmUnO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zcGVlZF0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgK2IuZGF0YXNldC5zcGVlZCEgPT09IGcudGltZVNjYWxlKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgYi5kYXRhc2V0LmNhbSA9PT0gZy5jYW1Nb2RlKSk7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QudG9nZ2xlKCdpbmJhdHRsZScsIHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nKTtcbiAgICAvLyBvdmVybGF5XG4gICAgY29uc3Qgb3YgPSAkKCdvdmVybGF5Jyk7IG92LmNsYXNzTmFtZSA9ICcnOyBvdi5pbm5lckhUTUwgPSAnJztcbiAgICBpZiAocGggPT09ICdkcmFmdCcgJiYgZy5kcmFmdCkge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5WaWN0b3J5IERyYWZ0PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+V2F2ZSBjbGVhcmVkLiBEb21pbmlvbiBpcyBub3cgJHtzLmNhcH0uIEtlZXAgb25lOjwvZGl2PjxkaXYgY2xhc3M9XCJyb3dcIj4ke2cuZHJhZnQubWFwKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4gYDxkaXYgY2xhc3M9XCJjYXJkIGJpZ1wiIGRhdGEtaT1cIiR7aX1cIj48ZGl2IGNsYXNzPVwiY29zdFwiPiR7Y29zdChzb3VsLCAxKX08L2Rpdj48ZGl2IGNsYXNzPVwiaWNcIj4ke0lDT05bc291bF19PC9kaXY+PGRpdiBjbGFzcz1cIm5tXCI+JHtTT1VMX05BTUVbc291bF19PC9kaXY+PGRpdiBjbGFzcz1cInJvbGVcIj4ke1JPTEVfVEVYVFtzb3VsXX08L2Rpdj48L2Rpdj5gKS5qb2luKCcnKX08L2Rpdj48L2Rpdj5gO1xuICAgICAgb3YucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJy5jYXJkJykuZm9yRWFjaCgoYykgPT4gKGMub25jbGljayA9ICgpID0+IGcucGlja0RyYWZ0KCtjLmRhdGFzZXQuaSEpKSk7XG4gICAgfSBlbHNlIGlmIChwaCA9PT0gJ3dvbicgfHwgcGggPT09ICdsb3N0Jykge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj4ke3BoID09PSAnd29uJyA/ICdTdGFnZSBjbGVhcmVkIScgOiAnU3RhZ2UgbG9zdCd9PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+JHtnLmxhc3RCYXR0bGV9PC9kaXY+PGJ1dHRvbiBpZD1cImFnYWluXCI+JHtwaCA9PT0gJ3dvbicgPyAnUGxheSBhZ2FpbicgOiAnVHJ5IGFnYWluJ308L2J1dHRvbj48L2Rpdj5gO1xuICAgICAgJCgnYWdhaW4nKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydFN0YWdlKGcuc2VlZCArIDEpO1xuICAgIH1cbiAgICB0aGlzLnJlbmRlckRlYnVnTGl2ZSgpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIHBhbmVsXG4gIHByaXZhdGUgcmVuZGVyRGVidWcoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgZCA9IHRoaXMuZGJnOyBpZiAoIWQuY2xhc3NMaXN0LmNvbnRhaW5zKCdvcGVuJykpIHsgZC5pbm5lckhUTUwgPSAnJzsgcmV0dXJuOyB9XG4gICAgY29uc3Qgcm93ID0gKGxhYmVsOiBzdHJpbmcsIG9iajogYW55LCBrZXk6IHN0cmluZyB8IG51bWJlciwgbWluOiBudW1iZXIsIG1heDogbnVtYmVyLCBzdGVwOiBudW1iZXIpID0+IGA8bGFiZWw+JHtsYWJlbH0gPGlucHV0IHR5cGU9XCJyYW5nZVwiIG1pbj1cIiR7bWlufVwiIG1heD1cIiR7bWF4fVwiIHN0ZXA9XCIke3N0ZXB9XCIgdmFsdWU9XCIke29ialtrZXldfVwiIGRhdGEtbz1cIiR7bGFiZWx9XCI+PHNwYW4+JHtvYmpba2V5XX08L3NwYW4+PC9sYWJlbD5gO1xuICAgIGQuaW5uZXJIVE1MID0gYDxiPkRlYnVnIChsaXZlKTwvYj4gPHNwYW4gaWQ9XCJkYmdmcHNcIj48L3NwYW4+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPlN0YXIgbXVsdGlwbGllcnMgKGJvZGllcyA9IGRhbWFnZSwgc3RhcnMgPSBkdXJhYmlsaXR5KVxuICAgICAgICAke3JvdygnSFAgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAxLCAxLCA0LCAwLjA1KX0ke3JvdygnSFAgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnRGFtYWdlIHggMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5kbWcsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMiwgMSwgNiwgMC4wNSl9JHtyb3coJ1NpemUgMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5zY2FsZSwgMSwgMSwgMS42LCAwLjAyKX0ke3JvdygnU2l6ZSAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAyLCAxLCAyLCAwLjAyKX08L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHRhYmxlPjx0cj48dGg+PC90aD48dGg+aHA8L3RoPjx0aD5kbWc8L3RoPjx0aD5yYXRlPC90aD48dGg+cmFuZ2U8L3RoPjx0aD5zcGQ8L3RoPjwvdHI+JHtTT1VMUy5tYXAoKGspID0+IGA8dHI+PHRkPiR7SUNPTltrXX08L3RkPiR7WydocCcsICdkbWcnLCAnaW50ZXJ2YWwnLCAncmFuZ2UnLCAnc3BlZWQnXS5tYXAoKGYpID0+IGA8dGQ+PGlucHV0IGNsYXNzPVwibnVtXCIgZGF0YS1zb3VsPVwiJHtrfVwiIGRhdGEtZj1cIiR7Zn1cIiB2YWx1ZT1cIiR7KEJBTEFOQ0Uuc3RhdHMgYXMgYW55KVtrXVtmXX1cIj48L3RkPmApLmpvaW4oJycpfTwvdHI+YCkuam9pbignJyl9PC90YWJsZT48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+RGlmZmljdWx0eSA8c2VsZWN0IGlkPVwiZERpZmZcIj4ke1snZWFzeScsICdub3JtYWwnLCAnaGFyZCddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZE9kZHNcIj5UZXN0IG9kZHMgKDIwMCBmaWdodHMpPC9idXR0b24+IDxzcGFuIGlkPVwiZE9kZHNPdXRcIj4ke3RoaXMub2Rkc308L3NwYW4+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkQ29weVwiPkNvcHkgcmVwb3J0PC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzZXRcIj5SZXNldCBiYWxhbmNlPC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzdGFydFwiPlJlc3RhcnQgc3RhZ2U8L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+QWRkIGNhcmQgPHNlbGVjdCBpZD1cImRDYXJkXCI+JHtTT1VMUy5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiPiR7U09VTF9OQU1FW2tdfTwvb3B0aW9uPmApLmpvaW4oJycpfTwvc2VsZWN0PiA8YnV0dG9uIGlkPVwiZEFkZFwiPis8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImREb21cIj4rMiBEb21pbmlvbjwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+TGFzdCB0YXA6IDxzcGFuIGlkPVwiZGJndGFwXCI+JHtnLmxhc3RUYXBJbmZvfTwvc3Bhbj48L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+U2VlZCAke2cuc2VlZH0uIEFkZCA8Y29kZT4/c2VlZD03PC9jb2RlPiB0byB0aGUgbGluayB0byByZXBsYXkgdGhlIHNhbWUgZHJhd3MuPC9zbWFsbD48L2Rpdj5gO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXRbdHlwZT1yYW5nZV0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25pbnB1dCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGxhYiA9IGlucC5kYXRhc2V0Lm8hOyBjb25zdCB2ID0gK2lucC52YWx1ZTsgKGlucC5uZXh0RWxlbWVudFNpYmxpbmcgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gU3RyaW5nKHYpO1xuICAgICAgY29uc3Qgc2V0OiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkPiA9IHsgJ0hQIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMV0gPSB2KSwgJ0hQIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMl0gPSB2KSwgJ0RhbWFnZSB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1sxXSA9IHYpLCAnRGFtYWdlIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzJdID0gdiksICdTaXplIDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzFdID0gdiksICdTaXplIDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzJdID0gdikgfTtcbiAgICAgIHNldFtsYWJdKCk7IGcuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7XG4gICAgfSkpO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXQubnVtJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uY2hhbmdlID0gKCkgPT4geyAoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2lucC5kYXRhc2V0LnNvdWwhXVtpbnAuZGF0YXNldC5mIV0gPSAraW5wLnZhbHVlOyB9KSk7XG4gICAgJCgnZERpZmYnKS5vbmNoYW5nZSA9IChlKSA9PiBnLmNoYW5nZURpZmZpY3VsdHkoKGUudGFyZ2V0IGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSk7XG4gICAgJCgnZE1lcmdlSGFuZCcpLm9uY2hhbmdlID0gKGUpID0+IHsgZy5zLnJ1bGVzLm1lcmdlID0gKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQgPyAnaGFuZEludG9PbmVTdGFyJyA6ICdkZXBsb3llZE9ubHknOyBnLnN5bmNCdWlsZCgpOyB0aGlzLnJlbmRlcigpOyB9O1xuICAgICQoJ2RPZGRzJykub25jbGljayA9ICgpID0+IHsgY29uc3QgciA9IGcudGVzdE9kZHMoMjAwKTsgdGhpcy5vZGRzID0gYCR7ci53aW59JSB3aW4gKCR7ci5ufSBmaWdodHMsIGF2ZyAke3IuYXZnVGltZX1zKSB2cyB3YXZlICR7Zy5zLndhdmV9YDsgJCgnZE9kZHNPdXQnKS50ZXh0Q29udGVudCA9IHRoaXMub2RkczsgfTtcbiAgICAkKCdkQ29weScpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdSZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkUmVzZXQnKS5vbmNsaWNrID0gKCkgPT4geyBnLnJlc2V0QmFsYW5jZUFsbCgpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgJCgnZFJlc3RhcnQnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydFN0YWdlKGcuc2VlZCk7XG4gICAgJCgnZEFkZCcpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZENhcmQoKCQoJ2RDYXJkJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlIGFzIFNvdWxJZCk7ICQoJ2REb20nKS5vbmNsaWNrID0gKCkgPT4gZy5hZGREb21pbmlvbigyKTtcbiAgfVxuICBwcml2YXRlIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5lbmdpbmUuZ2V0RnBzKCkudG9GaXhlZCgwKX0gZnBzIFx1MjAyMiAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJndGFwJyk7IGlmICh0KSB0LnRleHRDb250ZW50ID0gdGhpcy5nLmxhc3RUYXBJbmZvO1xuICB9XG59XG4iLCAiLy8gVGhlIHBsYXlhYmxlIHByb3RvdHlwZTogYnVpbGQgc2NyZWVuIC0+IGJhdHRsZSAtPiBkcmFmdCAtPiBuZXh0IHdhdmUsIGJ1aWx0IG9uIHRoZSB0ZXN0ZWQgcnVsZXMgKyBiYXR0bGUgZW5naW5lLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFLCByZXNldEJhbGFuY2UsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBHUklEX0NFTExTLCBHUklEX0NPTFMsIEdSSURfUk9XUywgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHtcbiAgYWR2YW5jZVdhdmUsIGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY2VsbEZyZWUsIGNvc3QsIGRpc2NhcmRSZWRyYXcsIGRpc21pc3MsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBkcmFmdE9wdGlvbnMsIGZhaWxXYXZlLFxuICBtZXJnZURlcGxveWVkLCBtZXJnZUZyb21IYW5kLCBtb3ZlVW5pdCwgbmV3U3RhZ2UsIG5vcm1hbERyYXcsIHN0YWdlV2F2ZXMsIHN1bW1vbiwgc3dhcFNlbGwsIHRha2VEcmFmdCxcbn0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBCYXR0bGUsIGNlbGxQb3MsIEZST05UX1gsIEdSSURfU1AsIHNpbXVsYXRlIH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHR5cGUgeyBCRXZlbnQgfSBmcm9tICcuLi9jb3JlL2JhdHRsZS50cyc7XG5pbXBvcnQgeyBkaWZmaWN1bHR5TmFtZSwgZW5lbXlXYXZlLCBzZXREaWZmaWN1bHR5IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuLi9jb3JlL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgeyBsb2FkU2F2ZSB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5pbXBvcnQgeyBOZWNyb21hbmNlciB9IGZyb20gJy4vbmVjcm9tYW5jZXIudHMnO1xuaW1wb3J0IHsgY3JlYXRlVmlzdWFsLCBpc1RyaXBvLCBsb2FkQXNzZXRzIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB0eXBlIHsgQXNzZXRzLCBVbml0VmlzdWFsIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB7IFVpIH0gZnJvbSAnLi91aS50cyc7XG5cbmV4cG9ydCB0eXBlIFBoYXNlID0gJ2J1aWxkJyB8ICd0cmFuc2l0aW9uJyB8ICdiYXR0bGUnIHwgJ2RyYWZ0JyB8ICd3b24nIHwgJ2xvc3QnO1xudHlwZSBTZWwgPSB7IHR5cGU6ICdjYXJkJzsgaWR4OiBudW1iZXIgfSB8IHsgdHlwZTogJ3VuaXQnOyBpZDogbnVtYmVyIH0gfCBudWxsO1xuXG5leHBvcnQgY2xhc3MgR2FtZSB7XG4gIGVuZ2luZTogYW55OyBzY2VuZTogYW55OyBjYW1lcmE6IGFueTsgQSE6IEFzc2V0czsgdWkhOiBVaTtcbiAgcyE6IFN0YXRlOyBzZWVkID0gMTsgYXR0ZW1wdCA9IDA7IHBoYXNlOiBQaGFzZSA9ICdidWlsZCc7IGJhdHRsZTogQmF0dGxlIHwgbnVsbCA9IG51bGw7IHRpbWVTY2FsZSA9IDE7XG4gIHNlbDogU2VsID0gbnVsbDsgc3dhcE1vZGUgPSBmYWxzZTsgY29uZmlybVJlbW92ZSA9IGZhbHNlOyBkcmFmdDogU291bElkW10gfCBudWxsID0gbnVsbDsgbGFzdEJhdHRsZSA9ICcnO1xuICBwcml2YXRlIHVuaXRWaXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgIC8vIHVuaXQgaWQgLT4gdmlzdWFsICh5b3VyIGFybXksIHBlcnNpc3RzIGJldHdlZW4gd2F2ZXMpXG4gIHByaXZhdGUgdmlzVG9Vbml0ID0gbmV3IE1hcDxVbml0VmlzdWFsLCBudW1iZXI+KCk7XG4gIHByaXZhdGUgZnZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB2aXN1YWwgZHVyaW5nIGEgYmF0dGxlXG4gIHByaXZhdGUgZlVuaXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpOyAgICAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB1bml0IGlkIChwbGF5ZXIgc2lkZSlcbiAgcHJpdmF0ZSBsYXN0U3RhdGUgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpO1xuICBwcml2YXRlIHRpbGVzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbGVNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHJpbmdGeDogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd3M6IGFueVtdID0gW107IHByaXZhdGUgdGltZXJzOiB7IHQ6IG51bWJlcjsgZm46ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgYWNjID0gMDsgcHJpdmF0ZSBjYW1Gcm9tOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVRvOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVQgPSAxOyBwcml2YXRlIGNhbUR1ciA9IDIuMDsgcHJpdmF0ZSByZXN1bHRBdCA9IC0xOyBwcml2YXRlIGhhbmRsZWQgPSBmYWxzZTsgcHJpdmF0ZSBzdGFydFN0ZXBBdCA9IDA7XG4gIHByaXZhdGUgYXJyb3dNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93TWVzaDogYW55W10gPSBbXTtcbiAgbmVjcm8hOiBOZWNyb21hbmNlcjtcbiAgcHJpdmF0ZSBjaW5lID0gZmFsc2U7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHJlc3VsdCBjdXRzY2VuZSBpcyBwbGF5aW5nOiB0aGUgYmF0dGxlIGNhbWVyYSBhbmQgZmlnaHRlciBzeW5jIHN0YW5kIGRvd25cbiAgcHJpdmF0ZSB0d2VlbnM6IHsgdDogbnVtYmVyOyBkdXI6IG51bWJlcjsgZm46ICh1OiBudW1iZXIpID0+IHZvaWQ7IGRvbmU/OiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIHR3ZWVuKGR1cjogbnVtYmVyLCBmbjogKHU6IG51bWJlcikgPT4gdm9pZCwgZG9uZT86ICgpID0+IHZvaWQpIHsgdGhpcy50d2VlbnMucHVzaCh7IHQ6IDAsIGR1ciwgZm4sIGRvbmUgfSk7IH1cblxuICBhc3luYyBpbml0KGNhbnZhczogSFRNTENhbnZhc0VsZW1lbnQpIHtcbiAgICBjb25zdCBxcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKTtcbiAgICB0aGlzLmVuZ2luZSA9IG5ldyBCQUJZTE9OLkVuZ2luZShjYW52YXMsIHRydWUsIHsgYW50aWFsaWFzOiB0cnVlLCBwb3dlclByZWZlcmVuY2U6ICdoaWdoLXBlcmZvcm1hbmNlJyB9KTtcbiAgICBjb25zdCBkcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxOyB0aGlzLmVuZ2luZS5zZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgxIC8gTWF0aC5taW4oZHByLCAxLjUpKTtcbiAgICBjb25zdCBzY2VuZSA9IHRoaXMuc2NlbmUgPSBuZXcgQkFCWUxPTi5TY2VuZSh0aGlzLmVuZ2luZSk7IHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wOSwgMC4wNywgMC4xMywgMSk7XG4gICAgY29uc3QgaGVtaSA9IG5ldyBCQUJZTE9OLkhlbWlzcGhlcmljTGlnaHQoJ2gnLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMSwgMC4zKSwgc2NlbmUpOyBoZW1pLmludGVuc2l0eSA9IDEuMDU7IGhlbWkuZ3JvdW5kQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4zMiwgMC4yNiwgMC40Mik7XG4gICAgY29uc3Qgc3VuID0gbmV3IEJBQllMT04uRGlyZWN0aW9uYWxMaWdodCgncycsIG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuNCwgLTEsIDAuNTUpLCBzY2VuZSk7IHN1bi5pbnRlbnNpdHkgPSAwLjg1O1xuICAgIHRoaXMuY2FtZXJhID0gbmV3IEJBQllMT04uRnJlZUNhbWVyYSgnY2FtJywgbmV3IEJBQllMT04uVmVjdG9yMygwLCA4LCAtOSksIHNjZW5lKTsgdGhpcy5jYW1lcmEubWluWiA9IDAuMTsgdGhpcy5jYW1lcmEubWF4WiA9IDIwMDsgdGhpcy5jYW1lcmEuZm92ID0gMC44OyB0aGlzLmNhbWVyYS5pbnB1dHMuY2xlYXIoKTtcblxuICAgIGNvbnN0IGdyb3VuZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdncm91bmQnLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0MCB9LCBzY2VuZSk7XG4gICAgY29uc3QgZ20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdnbScsIHNjZW5lKTsgZ20uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMTcsIDAuMTUsIDAuMjEpOyBnbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZ3JvdW5kLm1hdGVyaWFsID0gZ207IGdyb3VuZC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCB0ZWFtIG9mIFswLCAxXSBhcyBjb25zdCkgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHsgY29uc3QgdCA9IHRoaXMubWFrZVRpbGUodGVhbSwgYyk7IGlmICh0ZWFtID09PSAwKSB0aGlzLnRpbGVzLnB1c2godCk7IGVsc2UgdC5zZXRFbmFibGVkKGZhbHNlKTsgfVxuXG4gICAgdGhpcy5BID0gYXdhaXQgbG9hZEFzc2V0cyhzY2VuZSk7XG4gICAgdGhpcy5uZWNybyA9IG5ldyBOZWNyb21hbmNlcihzY2VuZSwgdGhpcy5BLnNvZnQpOyAgICAgICAvLyBzdGFuZHMganVzdCBiZWhpbmQgaGlzIGFybXkncyBiYWNrIGNvbHVtbiwgZmFjaW5nIHRoZSBiYXR0bGVmaWVsZFxuICAgIHRoaXMubmVjcm8uaG9sZGVyLnBvc2l0aW9uLnNldCgtKEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAtIDEuMDUsIDAsIDApOyB0aGlzLm5lY3JvLmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7XG4gICAgdGhpcy5hcnJvd01hdHMgPSBbMCwgMV0ubWFwKCh0KSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdhbScgKyB0LCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjMsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNywgMC4yNSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcmV0dXJuIG07IH0pO1xuICAgIHRoaXMudWkgPSBuZXcgVWkodGhpcyk7IHRoaXMuc2VlZCA9ICsocXMuZ2V0KCdzZWVkJykgfHwgMSk7XG5cbiAgICAvLyBUYXBzIGFyZSBkZXRlY3RlZCBoZXJlIChub3QgdGhyb3VnaCBCYWJ5bG9uKSBzbyB0aGV5IGJlaGF2ZSB0aGUgc2FtZSBpbiBTYWZhcmksIHRoZSBob21lLXNjcmVlbiBhcHAgYW5kIG9uIGRlc2t0b3AuXG4gICAgbGV0IGRvd246IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbG9jYWwgPSAoZTogUG9pbnRlckV2ZW50KSA9PiB7IGNvbnN0IHIgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7IHJldHVybiB7IHg6IGUuY2xpZW50WCAtIHIubGVmdCwgeTogZS5jbGllbnRZIC0gci50b3AgfTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmRvd24nLCAoZSkgPT4geyBkb3duID0geyAuLi5sb2NhbChlKSwgdDogcGVyZm9ybWFuY2Uubm93KCkgfTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJ1cCcsIChlKSA9PiB7IGlmICghZG93bikgcmV0dXJuOyBjb25zdCBwID0gbG9jYWwoZSk7IGNvbnN0IG1vdmVkID0gTWF0aC5oeXBvdChwLnggLSBkb3duLngsIHAueSAtIGRvd24ueSksIGR0ID0gcGVyZm9ybWFuY2Uubm93KCkgLSBkb3duLnQ7IGRvd24gPSBudWxsOyBpZiAobW92ZWQgPCAxNiAmJiBkdCA8IDkwMCkgdGhpcy50YXAocC54LCBwLnkpOyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmNhbmNlbCcsICgpID0+IHsgZG93biA9IG51bGw7IH0pO1xuICAgIHRoaXMuY2FudmFzID0gY2FudmFzOyBjb25zdCBvblJlc2l6ZSA9ICgpID0+IHRoaXMuaGFuZGxlUmVzaXplKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTsgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ29yaWVudGF0aW9uY2hhbmdlJywgKCkgPT4gc2V0VGltZW91dChvblJlc2l6ZSwgMjUwKSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydCkgKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKSBuZXcgKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKG9uUmVzaXplKS5vYnNlcnZlKGNhbnZhcyk7XG4gICAgaWYgKHFzLmdldCgnZ2FsbGVyeScpKSB7IHRoaXMuZ2FsbGVyeSgpOyByZXR1cm47IH1cbiAgICB0aGlzLnN0YXJ0U3RhZ2UodGhpcy5zZWVkKTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKTsgY29uc3QgZHQgPSBNYXRoLm1pbigwLjA1LCAobm93IC0gbGFzdCkgLyAxMDAwKTsgbGFzdCA9IG5vdzsgaWYgKCF0aGlzLmFjdGl2ZSkgcmV0dXJuOyBpZiAoIXRoaXMuZnJvemVuKSB0aGlzLmZyYW1lKGR0KTsgc2NlbmUucmVuZGVyKCk7IH0pO1xuICB9XG4gIC8qKiBUaGUgbmF2aWdhdGlvbiBzaGVsbCBoaWRlcyB0aGUgYmF0dGxlIHNjcmVlbiB3aGlsZSBhbm90aGVyIHRhYiBpcyBvcGVuOiBwYXVzZSB0aGUgZ2FtZSBzbyBpdCBjb3N0cyBub3RoaW5nLiAqL1xuICBwcml2YXRlIGFjdGl2ZSA9IHRydWU7XG4gIC8qKiBEZWJ1Zzoga2VlcCBkcmF3aW5nIGJ1dCBzdG9wIGFkdmFuY2luZyB0aW1lLCBzbyBhIG1vbWVudCBjYW4gYmUgc3RlcHBlZCB0aHJvdWdoIHdpdGggZnJhbWUoZHQpIGFuZCBzY3JlZW5zaG90dGVkLiAqL1xuICBmcm96ZW4gPSBmYWxzZTtcbiAgc3RlcChkdDogbnVtYmVyKSB7IHRoaXMuZnJhbWUoZHQpOyB9XG4gIHNldEFjdGl2ZShvbjogYm9vbGVhbikgeyB0aGlzLmFjdGl2ZSA9IG9uOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2NlbmUgaGVscGVyc1xuICBwcml2YXRlIG1ha2VUaWxlKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKSwgdCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3RpbGUnICsgY2VsbCwgeyBzaXplOiBHUklEX1NQICogMC45MiB9LCB0aGlzLnNjZW5lKTtcbiAgICB0LnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdC5wb3NpdGlvbi5zZXQocC54LCAwLjAxNSwgcC56KTtcbiAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndG0nLCB0aGlzLnNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuMTgsIDAuMTIsIDAuNDIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNDIsIDAuMTIsIDAuMTIpOyBtLmFscGhhID0gMC41OyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHQubWF0ZXJpYWwgPSBtO1xuICAgIGlmICh0ZWFtID09PSAwKSB7IHQubWV0YWRhdGEgPSB7IGtpbmQ6ICd0aWxlJywgY2VsbCB9OyB0aGlzLnRpbGVNYXRzW2NlbGxdID0gbTsgfSBlbHNlIHQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHJldHVybiB0O1xuICB9XG4gIHByaXZhdGUgdGludChjZWxsOiBudW1iZXIsIG1vZGU6ICdub3JtYWwnIHwgJ2ZyZWUnIHwgJ3NlbCcgfCAncGFydG5lcicpIHtcbiAgICBjb25zdCBtID0gdGhpcy50aWxlTWF0c1tjZWxsXTsgY29uc3QgYyA9IHsgbm9ybWFsOiBbMC4xOCwgMC4xMiwgMC40MiwgMC41XSwgZnJlZTogWzAuMiwgMC43NSwgMC41NSwgMC43XSwgc2VsOiBbMSwgMC44MiwgMC4zLCAwLjg1XSwgcGFydG5lcjogWzAuODUsIDAuMzUsIDEsIDAuODVdIH1bbW9kZV07XG4gICAgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pOyBtLmFscGhhID0gY1szXTtcbiAgfVxuICBsYXRlcihzZWM6IG51bWJlciwgZm46ICgpID0+IHZvaWQpIHsgdGhpcy50aW1lcnMucHVzaCh7IHQ6IHNlYywgZm4gfSk7IH1cbiAgcHJpdmF0ZSBmeFJpbmcoeDogbnVtYmVyLCB6OiBudW1iZXIsIGNvbG9yOiBhbnksIHIwOiBudW1iZXIsIHIxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2Z4JywgeyBkaWFtZXRlcjogMSwgdGhpY2tuZXNzOiAwLjAzNSwgdGVzc2VsbGF0aW9uOiAyOCB9LCB0aGlzLnNjZW5lKTsgbS5wb3NpdGlvbi5zZXQoeCwgMC4wNSwgeik7IG0uaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG1tID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZnhtJywgdGhpcy5zY2VuZSk7IG1tLmVtaXNzaXZlQ29sb3IgPSBjb2xvcjsgbW0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbW0uYWxwaGEgPSAwLjk7IG0ubWF0ZXJpYWwgPSBtbTsgdGhpcy5yaW5nRngucHVzaCh7IG0sIG1tLCB0OiAwLCByMCwgcjEsIGR1ciB9KTtcbiAgfVxuICBwcml2YXRlIGJ1cnN0KHg6IG51bWJlciwgejogbnVtYmVyLCBjMTogbnVtYmVyW10sIGMyOiBudW1iZXJbXSwgY291bnQ6IG51bWJlcikge1xuICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2InLCA2MCwgdGhpcy5zY2VuZSk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCAwLjA1LCB6KTsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMC4wNSwgMC4yKTtcbiAgICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMxIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzIgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMSwgMCwgMC4yLCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4xMjsgcHMubWF4U2l6ZSA9IDAuMzQ7IHBzLm1pbkxpZmVUaW1lID0gMC40OyBwcy5tYXhMaWZlVGltZSA9IDAuOTsgcHMuZW1pdFJhdGUgPSAwOyBwcy5tYW51YWxFbWl0Q291bnQgPSBjb3VudDsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEsIDEuMywgLTEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygxLCAyLjQsIDEpO1xuICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuODsgcHMubWF4RW1pdFBvd2VyID0gMjsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgLTIsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnRhcmdldFN0b3BEdXJhdGlvbiA9IDEuMjsgcHMuZGlzcG9zZU9uU3RvcCA9IHRydWU7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBjYW1lcmFcbiAgcHJpdmF0ZSBwb3NlcygpIHtcbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCBoYWxmID0gRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1AgKyAxLjQ7XG4gICAgY29uc3QgZCA9IE1hdGgubWF4KGhhbGYgLyAodGFuViAqIGFzcCksICgoR1JJRF9ST1dTICogR1JJRF9TUCkgLyAyICsgMikgLyAodGFuViAqIDAuNTUpLCA4KTtcbiAgICBjb25zdCBiYXR0bGUgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMygtMC4xICogZCwgMC40MiAqIGQgKyAwLjUsIC0wLjg2ICogZCksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjM1LCAwKSB9O1xuICAgIC8vIEJ1aWxkIHZpZXc6IChhbG1vc3QpIHN0cmFpZ2h0IGRvd24sIHdpdGggdGhlIHdob2xlIGdyaWQgaW5zaWRlIHRoZSBiYW5kIGJldHdlZW4gdGhlIHRvcCBiYXIgYW5kIHRoZSBoYW5kIG9mIGNhcmRzLlxuICAgIGNvbnN0IGN4ID0gLShGUk9OVF9YICsgKChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC8gMiksIEggPSBNYXRoLm1heCgxLCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpO1xuICAgIGNvbnN0IGJveCA9IChpZDogc3RyaW5nKSA9PiB7IGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOyByZXR1cm4gZWwgJiYgZWwub2Zmc2V0UGFyZW50ICE9PSBudWxsID8gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkgOiBudWxsOyB9O1xuICAgIGNvbnN0IHRvcEJhciA9IGJveCgndG9wJyksIGhhbmQgPSBib3goJ2hhbmQnKSwgaW5mbyA9IGJveCgnaW5mbycpO1xuICAgIGNvbnN0IFRPUCA9IE1hdGgubWluKDAuMzIsIHRvcEJhciA/ICh0b3BCYXIuYm90dG9tICsgNikgLyBIIDogMC4xKTtcbiAgICBjb25zdCBCT1RUT00gPSBNYXRoLm1pbigwLjUsIChIIC0gTWF0aC5taW4oaGFuZCA/IGhhbmQudG9wIDogSCwgaW5mbyA/IGluZm8udG9wIDogSCkgKyA2KSAvIEgpO1xuICAgIGNvbnN0IGJhbmQgPSBNYXRoLm1heCgwLjMsIDEgLSBUT1AgLSBCT1RUT00pLCBjZW50ZXJGcmFjID0gVE9QICsgYmFuZCAvIDI7ICAgICAgICAgIC8vIHRoZSBncmlkJ3MgY2VudHJlIGFwcGVhcnMgYXQgdGhpcyBmcmFjdGlvbiBmcm9tIHRoZSB0b3BcbiAgICBjb25zdCBndyA9IEdSSURfQ09MUyAqIEdSSURfU1AgKyAzLjIsIGdoID0gR1JJRF9ST1dTICogR1JJRF9TUCArIDAuNTsgICAgICAgICAgICAgICAgLy8gdGhlIHdpZHRoIGFsc28gbGVhdmVzIHJvb20gZm9yIHRoZSBOZWNyb21hbmNlciBiZXNpZGUgdGhlIGdyaWRcbiAgICBjb25zdCBkMiA9IE1hdGgubWF4KGdoIC8gKDIgKiB0YW5WICogYmFuZCksIGd3IC8gKDIgKiB0YW5WICogYXNwICogMC44OCksIDQuNSk7XG4gICAgY29uc3Qgc2hpZnQgPSAoMC41IC0gY2VudGVyRnJhYykgKiAyICogZDIgKiB0YW5WLCBieCA9IGN4IC0gMC42O1xuICAgIGNvbnN0IGJ1aWxkID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIGQyLCAtc2hpZnQgLSAwLjEgKiBkMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMyhieCwgMCwgLXNoaWZ0KSB9O1xuICAgIGNvbnN0IG5lY3JvID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYmF0dGxlLnBvcy54IC0gMS40LCBiYXR0bGUucG9zLnkgKiAxLjEyLCBiYXR0bGUucG9zLnogKiAxLjEyKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLjQsIDAuMzUsIDApIH07ICAgLy8gcmVzdWx0IGN1dHNjZW5lczogaGltIGFuZCB0aGUgZmllbGRcbiAgICByZXR1cm4geyBiYXR0bGUsIGJ1aWxkLCBuZWNybyB9O1xuICB9XG4gIHByaXZhdGUgY2FudmFzITogSFRNTENhbnZhc0VsZW1lbnQ7IHByaXZhdGUgbGFzdFcgPSAwOyBwcml2YXRlIGxhc3RIID0gMDsgbGFzdFRhcEluZm8gPSAnKG5vIHRhcHMgeWV0KSc7XG4gIHByaXZhdGUgaGFuZGxlUmVzaXplKCkge1xuICAgIGlmICghdGhpcy5jYW52YXMuY2xpZW50V2lkdGggfHwgIXRoaXMuY2FudmFzLmNsaWVudEhlaWdodCkgcmV0dXJuOyAgIC8vIGhpZGRlbiBiZWhpbmQgYW5vdGhlciB0YWJcbiAgICB0aGlzLmVuZ2luZS5yZXNpemUoKTsgdGhpcy5sYXN0VyA9IHRoaXMuY2FudmFzLmNsaWVudFdpZHRoOyB0aGlzLmxhc3RIID0gdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnICYmIHRoaXMuY2FtVCA+PSAxKSB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpO1xuICB9XG4gIC8qKiBBIHRhcCBvbiB0aGUgM0QgdmlldzogcGljayBhIHRpbGUgb3IgYSB1bml0LiAqL1xuICBwcml2YXRlIHRhcCh4OiBudW1iZXIsIHk6IG51bWJlcikge1xuICAgIGNvbnN0IHAgPSB0aGlzLnNjZW5lLnBpY2soeCwgeSwgKG06IGFueSkgPT4gISEobS5tZXRhZGF0YSAmJiBtLm1ldGFkYXRhLmtpbmQpKTtcbiAgICBjb25zdCBtZCA9IHAgJiYgcC5oaXQgPyBwLnBpY2tlZE1lc2gubWV0YWRhdGEgOiBudWxsO1xuICAgIHRoaXMubGFzdFRhcEluZm8gPSBgdGFwICR7TWF0aC5yb3VuZCh4KX0sJHtNYXRoLnJvdW5kKHkpfSBvZiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gLT4gJHttZCA/IChtZC5raW5kID09PSAndGlsZScgPyAndGlsZSAnICsgbWQuY2VsbCA6ICd1bml0JykgOiAnbm90aGluZyd9IChwaGFzZSAke3RoaXMucGhhc2V9KWA7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgIW1kKSByZXR1cm47XG4gICAgaWYgKG1kLmtpbmQgPT09ICd0aWxlJykgdGhpcy5vblRpbGUobWQuY2VsbCk7IGVsc2UgaWYgKG1kLmtpbmQgPT09ICd1bml0JykgdGhpcy5vblVuaXRWaXN1YWwobWQudmlzdWFsKTtcbiAgfVxuICBwcml2YXRlIHNldENhbShwOiBhbnkpIHsgdGhpcy5jYW1lcmEucG9zaXRpb24uY29weUZyb20ocC5wb3MpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQocC50Z3QuY2xvbmUoKSk7IH1cbiAgcHJpdmF0ZSB0d2VlbkNhbSh0bzogYW55LCBkdXI6IG51bWJlcikgeyB0aGlzLmNhbUZyb20gPSB7IHBvczogdGhpcy5jYW1lcmEucG9zaXRpb24uY2xvbmUoKSwgdGd0OiB0aGlzLmNhbWVyYS5nZXRUYXJnZXQoKS5jbG9uZSgpIH07IHRoaXMuY2FtVG8gPSB0bzsgdGhpcy5jYW1UID0gMDsgdGhpcy5jYW1EdXIgPSBkdXI7IH1cblxuICAvLyAtLS0tIGJhdHRsZSBjYW1lcmE6IGZvbGxvd3MgdGhlIGZpZ2h0ZXJzIHRoYXQgYXJlIHN0aWxsIGFsaXZlLCBzbyB0aGUgYWN0aW9uIChhbmQgdGhlIHB1cnBsZSBleWVzKSBzdGF5cyBsYXJnZSBvbiBzY3JlZW5cbiAgY2FtTW9kZTogJ2Nsb3NlJyB8ICd3aWRlJyA9ICdjbG9zZSc7IHByaXZhdGUgY2FtVGd0OiBhbnkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgMCk7XG4gIHNldENhbU1vZGUobTogJ2Nsb3NlJyB8ICd3aWRlJykge1xuICAgIHRoaXMuY2FtTW9kZSA9IG07XG4gICAgaWYgKG0gPT09ICd3aWRlJyAmJiB0aGlzLmJhdHRsZSkgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAwLjkpO1xuICAgIHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcHJpdmF0ZSBmcmFtZUJhdHRsZShkdDogbnVtYmVyKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlOyBpZiAoIWIpIHJldHVybjsgY29uc3QgYWxpdmUgPSBiLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSk7IGlmICghYWxpdmUubGVuZ3RoKSByZXR1cm47XG4gICAgbGV0IHgwID0gMWU5LCB4MSA9IC0xZTksIHowID0gMWU5LCB6MSA9IC0xZTk7IGZvciAoY29uc3QgZiBvZiBhbGl2ZSkgeyB4MCA9IE1hdGgubWluKHgwLCBmLngpOyB4MSA9IE1hdGgubWF4KHgxLCBmLngpOyB6MCA9IE1hdGgubWluKHowLCBmLnopOyB6MSA9IE1hdGgubWF4KHoxLCBmLnopOyB9XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3Qgd2lkZSA9IHRoaXMucG9zZXMoKS5iYXR0bGUsIGN4ID0gKHgwICsgeDEpIC8gMiwgY3ogPSAoejAgKyB6MSkgLyAyO1xuICAgIGNvbnN0IGQgPSBNYXRoLm1pbihNYXRoLm1heCgoeDEgLSB4MCArIDMuNCkgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjkpLCAoejEgLSB6MCArIDMuMikgLyAoMiAqIHRhblYgKiAwLjYyKSwgNS40KSwgTWF0aC5oeXBvdCh3aWRlLnBvcy55LCB3aWRlLnBvcy56KSk7XG4gICAgY29uc3QgdGd0ID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCwgMC41NSwgY3opLCBwb3MgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4IC0gMC4wNiAqIGQsIDAuMzIgKiBkICsgMC41LCBjeiAtIDAuOSAqIGQpO1xuICAgIGNvbnN0IGsgPSAxIC0gTWF0aC5leHAoLWR0ICogMi4wKTtcbiAgICB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtZXJhLnBvc2l0aW9uLCBwb3MsIGspOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtVGd0LCB0Z3QsIGspOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFnZSBmbG93XG4gIC8qKiBGcmVzaCBydW4gd2l0aCB0aGUgY3VycmVudGx5IGVxdWlwcGVkIFNvdWwgRGVjayAodGhlIHNoZWxsJ3MgQ2FtcGFpZ24gPiBQbGF5IGJ1dHRvbiBjYWxscyB0aGlzKS4gKi9cbiAgbmV3UnVuKCkgeyB0aGlzLnN0YXJ0U3RhZ2UobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnc2VlZCcpID8gdGhpcy5zZWVkIDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMWU2KSArIDEpOyB9XG4gIHN0YXJ0U3RhZ2Uoc2VlZDogbnVtYmVyKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMudHdlZW5zLmxlbmd0aCA9IDA7IGlmICh0aGlzLm5lY3JvKSB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIHRoaXMuc2VlZCA9IHNlZWQ7IHRoaXMuYXR0ZW1wdCA9IDA7IHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uUFJPVE9UWVBFX1JVTEVTLCBwb29sOiBsb2FkU2F2ZSgpLmRlY2sgfSwgc2VlZCk7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy50b2FzdCgnU3RhZ2Ugc3RhcnQ6IDQgY2FyZHMsICcgKyB0aGlzLnMuY2FwICsgJyBEb21pbmlvbi4gU3VtbW9uLCBtZXJnZSwgdGhlbiBwcmVzcyBCQVRUTEUuJyk7XG4gIH1cbiAgcHJpdmF0ZSBjbGVhckJhdHRsZSgpIHtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYuZGlzcG9zZSgpOyB9KTsgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTsgdGhpcy5iYXR0bGUgPSBudWxsO1xuICAgIHRoaXMuYXJyb3dzLmZvckVhY2goKGEpID0+IGEubWVzaC5kaXNwb3NlKCkpOyB0aGlzLmFycm93cyA9IFtdO1xuICB9XG4gIHByaXZhdGUgcG9zKGNlbGw6IG51bWJlcikgeyByZXR1cm4gY2VsbFBvcygwLCBjZWxsKTsgfVxuICBzeW5jQnVpbGQoKSB7XG4gICAgY29uc3QgYWxpdmUgPSBuZXcgU2V0KHRoaXMucy51bml0cy5tYXAoKHUpID0+IHUuaWQpKTtcbiAgICBmb3IgKGNvbnN0IFtpZCwgdl0gb2YgdGhpcy51bml0VmlzKSBpZiAoIWFsaXZlLmhhcyhpZCkpIHsgdGhpcy52aXNUb1VuaXQuZGVsZXRlKHYpOyBjb25zdCBwID0gdi5ob2xkZXIucG9zaXRpb247IHRoaXMuYnVyc3QocC54LCBwLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTYpOyB2LmRpc3Bvc2UoKTsgdGhpcy51bml0VmlzLmRlbGV0ZShpZCk7IH1cbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7XG4gICAgICBsZXQgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpO1xuICAgICAgaWYgKCF2KSB7IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCB1LnNvdWwsIDAsIHUuc3Rhcik7IHRoaXMudW5pdFZpcy5zZXQodS5pZCwgdik7IHRoaXMudmlzVG9Vbml0LnNldCh2LCB1LmlkKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopOyBjb25zdCB2diA9IHY7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB2di5wbGF5KCdpZGxlJyk7IH0pOyB9XG4gICAgICBlbHNlIHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyBpZiAodi5zdGFyICE9PSB1LnN0YXIpIHsgdi5zZXRTdGFyKHUuc3Rhcik7IHYucHVsc2UoKTsgdGhpcy5meFJpbmcocC54LCBwLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjQpLCAwLjIsIDEuNCwgMC42KTsgdGhpcy5idXJzdChwLngsIHAueiwgWzEsIDAuODUsIDAuNCwgMC45XSwgWzAuOCwgMC40LCAxLCAwLjhdLCAyNCk7IH0gfVxuICAgIH1cbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDtcbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5waGFzZSA9PT0gJ2J1aWxkJykge1xuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgY2FuU3VtbW9uKHRoaXMucywgc2VsLmlkeCkgPyAnZnJlZScgOiAnbm9ybWFsJyk7XG4gICAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VGcm9tSGFuZCh0aGlzLnMsIHNlbC5pZHgsIHUuaWQpKSB0aGlzLnRpbnQodS5jZWxsLCAncGFydG5lcicpOyAgICAgLy8gdGhlIGNhcmQgY2FuIG1lcmdlIGludG8gdGhpcyB1bml0XG4gICAgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0Jykge1xuICAgICAgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpO1xuICAgICAgaWYgKHUpIHsgdGhpcy50aW50KHUuY2VsbCwgJ3NlbCcpOyBmb3IgKGNvbnN0IG8gb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VEZXBsb3llZCh1LCBvKSkgdGhpcy50aW50KG8uY2VsbCwgJ3BhcnRuZXInKTsgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgJ2ZyZWUnKTsgfVxuICAgIH1cbiAgfVxuICBwcml2YXRlIHN1bW1vbkZ4KHg6IG51bWJlciwgejogbnVtYmVyKSB7IHRoaXMuYnVyc3QoeCwgeiwgWzAuNywgMC4zLCAxLCAwLjldLCBbMC4zNSwgMC4xLCAwLjcsIDAuOF0sIDMwKTsgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zLCAxKSwgMC4yLCAxLjIsIDAuNyk7IH1cblxuICAvLyAtLS0tIHBsYXllciBhY3Rpb25zIChidWlsZCBwaGFzZSlcbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgdGhpcy51aS50b2FzdChtc2cpOyB9XG4gIG9uQ2FyZChpZHg6IG51bWJlcikge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKGRpc2NhcmRSZWRyYXcodGhpcy5zLCBpZHgpKSB7IHRoaXMudG9hc3QoJ1N3YXBwZWQ6IGRyZXcgYSBkaWZmZXJlbnQgU291bC4nKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5zZWwuaWR4ID09PSBpZHggPyBudWxsIDogeyB0eXBlOiAnY2FyZCcsIGlkeCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVGlsZShjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBoZXJlID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpOyBpZiAoaGVyZSkgeyB0aGlzLm9uVW5pdFZpc3VhbCh0aGlzLnVuaXRWaXMuZ2V0KGhlcmUuaWQpISk7IHJldHVybjsgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJykge1xuICAgICAgaWYgKGNhblN1bW1vbihzLCBzZWwuaWR4KSkgeyBzdW1tb24ocywgc2VsLmlkeCwgY2VsbCk7IHRoaXMuc2VsID0gbnVsbDsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHNvdWwgPSBzLmhhbmRbc2VsLmlkeF07IHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb246ICR7U09VTF9OQU1FW3NvdWxdfSBjb3N0cyAke2Nvc3Qoc291bCwgMSl9LCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTsgfVxuICAgIH0gZWxzZSBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHsgaWYgKG1vdmVVbml0KHMsIHNlbC5pZCwgY2VsbCkpIHRoaXMuc2VsID0gbnVsbDsgfVxuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVW5pdFZpc3VhbCh2OiBVbml0VmlzdWFsKSB7XG4gICAgY29uc3QgaWQgPSB0aGlzLnZpc1RvVW5pdC5nZXQodik7IGlmIChpZCA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCkhO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChzd2FwU2VsbChzLCBpZCkpIHsgdGhpcy50b2FzdChgU29sZCAke1NPVUxfTkFNRVt1LnNvdWxdfTogZHJldyBhIGRpZmZlcmVudCBTb3VsLmApOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KHUuZnJlc2ggPyBcIllvdSBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZC5cIiA6ICdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHMuaGFuZFt0aGlzLnNlbC5pZHhdID09PSB1LnNvdWwgJiYgdS5zdGFyID09PSAxICYmIHMucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInKSB7XG4gICAgICBpZiAobWVyZ2VGcm9tSGFuZChzLCB0aGlzLnNlbC5pZHgsIGlkKSkgeyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgdGhlIGNhcmQgaW50byBhIDItc3RhciAke1NPVUxfTkFNRVt1LnNvdWxdfSFgKTsgfVxuICAgICAgZWxzZSB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uIHRvIG1lcmdlOiBpdCBuZWVkcyAke2Nvc3QodS5zb3VsLCAyKSAtIGNvc3QodS5zb3VsLCAxKX0gbW9yZSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCAhPT0gaWQpIHtcbiAgICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09ICh0aGlzLnNlbCBhcyBhbnkpLmlkKSE7XG4gICAgICBpZiAoY2FuTWVyZ2VEZXBsb3llZChhLCB1KSkgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIHUuaWQpOyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZDogYS5pZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB9IGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgPT09IGlkID8gbnVsbCA6IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG1lcmdlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpOyBjb25zdCBiID0gYSAmJiBzLnVuaXRzLmZpbmQoKG8pID0+IGNhbk1lcmdlRGVwbG95ZWQoYSwgbykpO1xuICAgIGlmIChhICYmIGIpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCBiLmlkKTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMudG9hc3QoJ05vIG1hdGNoaW5nIHVuaXQgKHNhbWUgU291bCBhbmQgc3RhcnMpIHRvIG1lcmdlIHdpdGguJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICByZW1vdmVTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGlmICghdGhpcy5jb25maXJtUmVtb3ZlKSB7IHRoaXMuY29uZmlybVJlbW92ZSA9IHRydWU7IHRoaXMudG9hc3QoJ1RhcCBSZW1vdmUgYWdhaW4gdG8gY29uZmlybS4gVGhlIGNhcmQgaXMgZ29uZSBmb3IgdGhpcyBzdGFnZS4nKTsgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuOyB9XG4gICAgZGlzbWlzcyh0aGlzLnMsIHNlbC5pZCk7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgdG9nZ2xlU3dhcCgpIHsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjsgaWYgKHRoaXMucy5kaXNjYXJkVXNlZCkgeyB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyByZXR1cm47IH0gdGhpcy5zd2FwTW9kZSA9ICF0aGlzLnN3YXBNb2RlOyB0aGlzLnNlbCA9IG51bGw7IGlmICh0aGlzLnN3YXBNb2RlKSB0aGlzLnRvYXN0KCdTd2FwOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCwgb3IgYSB1bml0IChub3Qgc3VtbW9uZWQgdGhpcyByb3VuZCkgdG8gc2VsbC4nKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGJhdHRsZVxuICBzdGFydEJhdHRsZSgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhdGhpcy5zLnVuaXRzLmxlbmd0aCkgeyBpZiAoIXRoaXMucy51bml0cy5sZW5ndGgpIHRoaXMudG9hc3QoJ1N1bW1vbiBhdCBsZWFzdCBvbmUgdW5pdCBmaXJzdC4nKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuYXR0ZW1wdCsrOyB0aGlzLmhhbmRsZWQgPSBmYWxzZTsgdGhpcy5yZXN1bHRBdCA9IC0xO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHVuaXRzID0gcy51bml0cy5zbGljZSgpO1xuICAgIHRoaXMuYmF0dGxlID0gbmV3IEJhdHRsZSh1bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpLCB0aGlzLnNlZWQgKiAxMzEgKyBzLndhdmUgKiAxNyArIHRoaXMuYXR0ZW1wdCk7XG4gICAgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTtcbiAgICB0aGlzLmJhdHRsZS5maWdodGVycy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICBpZiAoZi50ZWFtID09PSAwKSB7IGNvbnN0IHUgPSB1bml0c1tmLmlkIC0gMV07IGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5mVW5pdC5zZXQoZi5pZCwgdS5pZCk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IH1cbiAgICAgIGVsc2UgeyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgZi5zb3VsLCAxLCBmLnN0YXIpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoZi54LCAwLCBmLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gLU1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh2LnN0YXRlID09PSAnc3Bhd24nKSB2LnBsYXkoJ2lkbGUnKTsgfSk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjcsIDAuNiwgMC41LCAwLjddLCBbMC40LCAwLjM1LCAwLjMsIDAuNl0sIDE0KTsgfVxuICAgIH0pO1xuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIHRoaXMucGhhc2UgPSAndHJhbnNpdGlvbic7IHRoaXMuc3RhcnRTdGVwQXQgPSAxLjA7IHRoaXMuYWNjID0gMDsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAyLjIpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgYXBwbHlFdmVudHMoZXZzOiBCRXZlbnRbXSkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSE7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2cykge1xuICAgICAgaWYgKGUudCA9PT0gJ3N3aW5nJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHYucGxheSgnYXR0YWNrJywgZS5zcGVlZCk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2hpdCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS50byk7IGlmICh2KSB2LnB1bHNlKCk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Fycm93JykgeyBjb25zdCBmID0gYi5ieUlkKGUuZnJvbSkhLCB0byA9IGIuYnlJZChlLnRvKSE7IHRoaXMuc3Bhd25BcnJvdyhmLnRlYW0sIGYueCwgZi56LCB0by54LCB0by56LCBlLmR1cik7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2RlYXRoJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHsgdi5wbGF5KCdkZWF0aCcpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDEyKTsgaWYgKGYudGVhbSA9PT0gMSkgdGhpcy5sYXRlcig1LCAoKSA9PiB7IGlmICh0aGlzLmZ2aXMuZ2V0KGUuaWQpID09PSB2ICYmIHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHsgdi5ob2xkZXIuc2V0RW5hYmxlZChmYWxzZSk7IH0gfSk7IH0gfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnY2FzdCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC41LCAwLjgsIDEpLCAwLjE1LCAxLjEsIDAuMzUpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICd0YXVudCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC4zKSwgMC4zLCBCQUxBTkNFLnRhdW50LnJhZGl1cywgMC42KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnc21hc2gnKSB0aGlzLmZ4UmluZyhlLngsIGUueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNSwgMC4yKSwgMC4yLCBlLnIgKiAxLjYsIDAuNDUpO1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHNwYXduQXJyb3codGVhbTogbnVtYmVyLCB4MDogbnVtYmVyLCB6MDogbnVtYmVyLCB4MTogbnVtYmVyLCB6MTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGxldCBtZXNoID0gdGhpcy5hcnJvd01lc2gucG9wKCk7XG4gICAgaWYgKCFtZXNoKSB7IG1lc2ggPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdhcnJvdycsIHsgaGVpZ2h0OiAwLjU1LCBkaWFtZXRlcjogMC4wMzUgfSwgdGhpcy5zY2VuZSk7IG1lc2gucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyBtZXNoLmlzUGlja2FibGUgPSBmYWxzZTsgY29uc3QgaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnYXInLCB0aGlzLnNjZW5lKTsgbWVzaC5wYXJlbnQgPSBob2xkZXI7IG1lc2ggPSBob2xkZXI7IH1cbiAgICBtZXNoLnNldEVuYWJsZWQodHJ1ZSk7IG1lc2guZ2V0Q2hpbGRNZXNoZXMoKVswXS5tYXRlcmlhbCA9IHRoaXMuYXJyb3dNYXRzW3RlYW1dO1xuICAgIHRoaXMuYXJyb3dzLnB1c2goeyBtZXNoLCB4MCwgejAsIHgxLCB6MSwgdDogMCwgZHVyIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmcmFtZShkdDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMuY2FudmFzLmNsaWVudFdpZHRoICE9PSB0aGlzLmxhc3RXIHx8IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCAhPT0gdGhpcy5sYXN0SCkgdGhpcy5oYW5kbGVSZXNpemUoKTsgICAvLyBlLmcuIHRoZSBob21lLXNjcmVlbiBhcHAgcmVzaXppbmcgYWZ0ZXIgbGF1bmNoXG4gICAgZm9yIChsZXQgaSA9IHRoaXMudGltZXJzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IHRoaXMudGltZXJzW2ldLnQgLT0gZHQ7IGlmICh0aGlzLnRpbWVyc1tpXS50IDw9IDApIHsgY29uc3QgZiA9IHRoaXMudGltZXJzW2ldLmZuOyB0aGlzLnRpbWVycy5zcGxpY2UoaSwgMSk7IGYoKTsgfSB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMucmluZ0Z4Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHIgPSB0aGlzLnJpbmdGeFtpXTsgci50ICs9IGR0OyBjb25zdCB1ID0gci50IC8gci5kdXIsIHMgPSByLnIwICsgKHIucjEgLSByLnIwKSAqIHU7IHIubS5zY2FsaW5nLnNldChzLCBzLCBzKTsgci5tbS5hbHBoYSA9IDAuOSAqICgxIC0gdSk7IGlmICh1ID49IDEpIHsgci5tLmRpc3Bvc2UoKTsgci5tbS5kaXNwb3NlKCk7IHRoaXMucmluZ0Z4LnNwbGljZShpLCAxKTsgfSB9XG4gICAgaWYgKHRoaXMuY2FtVCA8IDEpIHsgdGhpcy5jYW1UID0gTWF0aC5taW4oMSwgdGhpcy5jYW1UICsgZHQgLyB0aGlzLmNhbUR1cik7IGNvbnN0IGUgPSB0aGlzLmNhbVQgKiB0aGlzLmNhbVQgKiAoMyAtIDIgKiB0aGlzLmNhbVQpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS5wb3MsIHRoaXMuY2FtVG8ucG9zLCBlKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20udGd0LCB0aGlzLmNhbVRvLnRndCwgZSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnICYmIHRoaXMuY2FtTW9kZSA9PT0gJ2Nsb3NlJyAmJiAhdGhpcy5jaW5lKSB0aGlzLmZyYW1lQmF0dGxlKGR0KTtcbiAgICB0aGlzLm5lY3JvLnVwZGF0ZShkdCk7XG4gICAgZm9yIChsZXQgaSA9IHRoaXMudHdlZW5zLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHcgPSB0aGlzLnR3ZWVuc1tpXTsgdy50ICs9IGR0OyBjb25zdCB1ID0gTWF0aC5taW4oMSwgdy50IC8gdy5kdXIpOyB3LmZuKHUpOyBpZiAodSA+PSAxKSB7IHRoaXMudHdlZW5zLnNwbGljZShpLCAxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICAgIGZvciAoY29uc3QgdiBvZiB0aGlzLnVuaXRWaXMudmFsdWVzKCkpIHYudXBkYXRlKGR0KTtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYudXBkYXRlKGR0KTsgfSk7XG5cbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7XG4gICAgaWYgKCh0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicgfHwgdGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpICYmIGIpIHtcbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpIHsgdGhpcy5zdGFydFN0ZXBBdCAtPSBkdDsgaWYgKHRoaXMuc3RhcnRTdGVwQXQgPD0gMCkgeyB0aGlzLnBoYXNlID0gJ2JhdHRsZSc7IHRoaXMudWkucmVuZGVyKCk7IH0gfVxuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSB7XG4gICAgICAgIHRoaXMuYWNjICs9IGR0ICogdGhpcy50aW1lU2NhbGU7XG4gICAgICAgIHdoaWxlICh0aGlzLmFjYyA+PSAxIC8gMzAgJiYgYi53aW5uZXIgPCAwKSB7IGIuc3RlcCgxIC8gMzApOyB0aGlzLmFjYyAtPSAxIC8gMzA7IHRoaXMuYXBwbHlFdmVudHMoYi5kcmFpbigpKTsgfVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdikgY29udGludWU7XG4gICAgICAgIGlmICghdGhpcy5jaW5lICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCBmLnRlYW0gPT09IDEpKSB7IHYuaG9sZGVyLnBvc2l0aW9uLnggPSBmLng7IHYuaG9sZGVyLnBvc2l0aW9uLnogPSBmLno7IGlmIChmLmFsaXZlIHx8IHRydWUpIHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBmLnlhdzsgfVxuICAgICAgICBpZiAoZi5hbGl2ZSkgeyB2LnNldEhwKGYuaHAgLyBmLm1heEhwKTsgaWYgKGYubWF4TWFuYSkgdi5zZXRNYW5hKGYubWFuYSAvIGYubWF4TWFuYSk7IH1cbiAgICAgICAgZWxzZSB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmIChmLnN0YXRlICE9PSAnYXR0YWNrJyAmJiBmLmFsaXZlKSB7IGNvbnN0IHdhbnQgPSBmLnN0YXRlID09PSAncnVuJyA/ICdydW4nIDogJ2lkbGUnOyBpZiAodGhpcy5sYXN0U3RhdGUuZ2V0KGYuaWQpICE9PSB3YW50IHx8ICh2LnN0YXRlICE9PSB3YW50ICYmIHYuc3RhdGUgIT09ICdzcGF3bicpKSB7IGlmICh2LnN0YXRlICE9PSAnc3Bhd24nKSB7IHYucGxheSh3YW50IGFzIGFueSk7IHRoaXMubGFzdFN0YXRlLnNldChmLmlkLCB3YW50KTsgfSB9IH1cbiAgICAgICAgaWYgKGYuc3RhdGUgPT09ICdhdHRhY2snKSB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgJ2F0dGFjaycpO1xuICAgICAgfVxuICAgICAgaWYgKGIud2lubmVyID49IDAgJiYgIXRoaXMuaGFuZGxlZCkgeyB0aGlzLmhhbmRsZWQgPSB0cnVlOyB0aGlzLnJlc3VsdEF0ID0gMS40OyB9XG4gICAgICBpZiAodGhpcy5yZXN1bHRBdCA+IDApIHsgdGhpcy5yZXN1bHRBdCAtPSBkdDsgaWYgKHRoaXMucmVzdWx0QXQgPD0gMCkgdGhpcy5oYW5kbGVSZXN1bHQoKTsgfVxuICAgIH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5hcnJvd3MubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGEgPSB0aGlzLmFycm93c1tpXTsgYS50ICs9IGR0ICogdGhpcy50aW1lU2NhbGU7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCBhLnQgLyBhLmR1cik7XG4gICAgICBjb25zdCBweCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdSwgcHogPSBhLnowICsgKGEuejEgLSBhLnowKSAqIHUsIHB5ID0gMC43NSArIE1hdGguc2luKHUgKiBNYXRoLlBJKSAqIDAuOSAtIHUgKiAwLjI1O1xuICAgICAgY29uc3QgdTIgPSBNYXRoLm1pbigxLCB1ICsgMC4wMyksIHF4ID0gYS54MCArIChhLngxIC0gYS54MCkgKiB1MiwgcXogPSBhLnowICsgKGEuejEgLSBhLnowKSAqIHUyLCBxeSA9IDAuNzUgKyBNYXRoLnNpbih1MiAqIE1hdGguUEkpICogMC45IC0gdTIgKiAwLjI1O1xuICAgICAgYS5tZXNoLnBvc2l0aW9uLnNldChweCwgcHksIHB6KTsgYS5tZXNoLmxvb2tBdChuZXcgQkFCWUxPTi5WZWN0b3IzKHF4LCBxeSwgcXopKTtcbiAgICAgIGlmICh1ID49IDEpIHsgYS5tZXNoLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLmFycm93TWVzaC5wdXNoKGEubWVzaCk7IHRoaXMuYXJyb3dzLnNwbGljZShpLCAxKTsgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlUmVzdWx0KCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIHMgPSB0aGlzLnM7XG4gICAgdGhpcy5sYXN0QmF0dGxlID0gYHdhdmUgJHtzLndhdmV9IGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9OiAke2Iud2lubmVyID09PSAwID8gJ1dPTicgOiAnTE9TVCd9IGluICR7Yi50aW1lLnRvRml4ZWQoMSl9cywgJHtiLmNvdW50KDApfSBvZiB5b3VycyBhbmQgJHtiLmNvdW50KDEpfSBlbmVtaWVzIGxlZnRgO1xuICAgIGlmIChiLndpbm5lciA9PT0gMCkge1xuICAgICAgdGhpcy5wbGF5UmVzdWx0KCd3aW4nLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGFybXkgaXMgcmFpc2VkIGFnYWluLCB0aGVuIHRoZSBuZXh0IHdhdmUgLyB0aGUgZHJhZnRcbiAgICAgICAgdGhpcy5jaW5lID0gZmFsc2U7XG4gICAgICAgIGlmIChhZHZhbmNlV2F2ZShzKSkgeyB0aGlzLnBoYXNlID0gJ3dvbic7IHRoaXMudWkucmVuZGVyKCk7IHJldHVybjsgfVxuICAgICAgICB0aGlzLmRyYWZ0ID0gZHJhZnRPcHRpb25zKHMpOyB0aGlzLnBoYXNlID0gJ2RyYWZ0JzsgdGhpcy51aS5yZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmYWlsV2F2ZShzKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy51aS5wdWxzZUhlYXJ0cygpOyAgICAgICAgICAgICAgICAgICAvLyB0aGUgaGVhcnQgaXMgbG9zdCB0aGUgbW9tZW50IGhlIGlzIGhpdFxuICAgICAgaWYgKHMuc3RhdHVzID09PSAnbG9zdCcpIHRoaXMucGxheVJlc3VsdCgnZmluYWwnLCAoKSA9PiB7IHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnBoYXNlID0gJ2xvc3QnOyB0aGlzLnVpLnJlbmRlcigpOyB9KTtcbiAgICAgIGVsc2UgdGhpcy5wbGF5UmVzdWx0KCdsb3NzJywgKCkgPT4geyB0aGlzLnRvYXN0KCdZb3VyIGFybXkgZmVsbC4gLTEgaGVhcnQsICsxIGNhcmQsIHNhbWUgd2F2ZS4gUmVidWlsZCBhIGRpZmZlcmVudCBzdHJhdGVneS4nKTsgdGhpcy50b0J1aWxkKCk7IH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gcmVzdWx0IGN1dHNjZW5lcyAocGxhbiBzZWN0aW9ucyAxOS0yMik6IHRoZSBOZWNyb21hbmNlciB0YWtlcyB0aGUgaGl0LCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUsIHJhaXNlcyB0aGUgZmFsbGVuXG4gIHByaXZhdGUgcGxheVJlc3VsdChraW5kOiAnd2luJyB8ICdsb3NzJyB8ICdmaW5hbCcsIGRvbmU6ICgpID0+IHZvaWQpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBuID0gdGhpcy5uZWNybzsgdGhpcy5jaW5lID0gdHJ1ZTsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7XG4gICAgY29uc3QgaG9tZSA9ICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBldmVyeSBmYWxsZW4gYWxseSBpcyBwdWxsZWQgYmFjayB0byBpdHMgZ3JpZCB0aWxlIGFuZCBzdGFuZHMgdXBcbiAgICAgIG4uY2FzdCgpOyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFswLjg1LCAwLjUsIDEsIDAuOV0sIFswLjUsIDAuMiwgMSwgMC43XSwgMzApO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgaWYgKGYudGVhbSAhPT0gMCkgY29udGludWU7IGNvbnN0IHVpZCA9IHRoaXMuZlVuaXQuZ2V0KGYuaWQpLCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVpZCksIHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXUgfHwgIXYpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0byA9IHRoaXMucG9zKHUuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmICghZi5hbGl2ZSkgeyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuYnVyc3QoeDAsIHowLCBbMC43NSwgMC40LCAxLCAwLjldLCBbMC40LCAwLjE1LCAwLjksIDAuN10sIDE4KTsgdGhpcy5meFJpbmcoeDAsIHowLCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjM1LCAxKSwgMC4zLCAxLjYsIDAuNyk7IH1cbiAgICAgICAgdGhpcy50d2VlbigxLjAsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC41LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgKz0gKE1hdGguUEkgLyAyIC0gdi5ob2xkZXIucm90YXRpb24ueSkgKiBNYXRoLm1pbigxLCB0ICogMC41ICsgMC4xKTsgfSxcbiAgICAgICAgICAoKSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnkgPSAwOyB0aGlzLmJ1cnN0KHRvLngsIHRvLnosIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTApOyB9KTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGlmIChraW5kID09PSAnd2luJykgeyBuLmNhc3QoKTsgdGhpcy5sYXRlcigwLjI1LCBob21lKTsgdGhpcy5sYXRlcigyLjAsIGRvbmUpOyByZXR1cm47IH1cbiAgICBuLmh1cnQoKTsgdGhpcy5sYXRlcigwLjE1LCAoKSA9PiB7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy5idXJzdChjLngsIGMueiwgWzEsIDAuMywgMC4zLCAwLjldLCBbMC44LCAwLjEsIDAuMiwgMC42XSwgMTYpOyB9KTtcbiAgICBpZiAoa2luZCA9PT0gJ2ZpbmFsJykgeyB0aGlzLmxhdGVyKDAuNiwgKCkgPT4gbi5kZWZlYXQoKSk7IHRoaXMubGF0ZXIoMi42LCBkb25lKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5sYXRlcigxLjAsICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXB1bHNpb24gc2hvY2t3YXZlOiBzdXJ2aXZvcnMgYXJlIGZsdW5nIGJhY2sgdG8gd2hlcmUgdGhleSBzdGFydGVkIGFuZCBoZWFsIHRvIGZ1bGxcbiAgICAgIG4uY2FzdCgpOyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7XG4gICAgICB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjg1LCAwLjU1LCAxKSwgMC42LCAzMCwgMS4xKTsgdGhpcy5meFJpbmcoYy54LCAwLCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMSwgMSksIDAuNCwgMjIsIDAuOCk7XG4gICAgICB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMSwgMC44NSwgMSwgMC45XSwgWzAuNywgMC40LCAxLCAwLjddLCA0MCk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBpZiAoZi50ZWFtICE9PSAxIHx8ICFmLmFsaXZlKSBjb250aW51ZTsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRvID0gY2VsbFBvcygxLCBmLmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5wdWxzZSgpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuOSwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjksIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCArICgxIC0gZi5ocCAvIGYubWF4SHApICogdCk7IH0sICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHYuc2V0SHAoMSk7IH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHRoaXMubGF0ZXIoMi4zLCBob21lKTsgdGhpcy5sYXRlcigzLjcsIGRvbmUpO1xuICB9XG4gIHBpY2tEcmFmdChpZHg6IG51bWJlcikgeyBpZiAoIXRoaXMuZHJhZnQpIHJldHVybjsgdGFrZURyYWZ0KHRoaXMucywgdGhpcy5kcmFmdCwgaWR4KTsgdGhpcy5kcmFmdCA9IG51bGw7IG5vcm1hbERyYXcodGhpcy5zKTsgdGhpcy50b0J1aWxkKCk7IH1cbiAgcHJpdmF0ZSB0b0J1aWxkKCkge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLm5lY3JvLnJldml2ZSgpOyB0aGlzLnR3ZWVucy5sZW5ndGggPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7ICAgICAgICAgICAgICAgICAgICAgICAvLyByZXN1cnJlY3Rpb246IGV2ZXJ5b25lIHJpc2VzIGFnYWluIGF0IGZ1bGwgaGVhbHRoXG4gICAgICBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYuaG9sZGVyLnNldEVuYWJsZWQodHJ1ZSk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTtcbiAgICAgIHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB2LnBsYXkoJ2lkbGUnKSk7XG4gICAgfVxuICAgIHRoaXMucGhhc2UgPSAnYnVpbGQnOyB0aGlzLnNlbCA9IG51bGw7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJ1aWxkLCAxLjgpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHNldFNwZWVkKGs6IG51bWJlcikgeyB0aGlzLnRpbWVTY2FsZSA9IGs7IHRoaXMudWkucmVuZGVyKCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBoZWxwZXJzXG4gIGFwcGx5QmFsYW5jZUNoYW5nZSgpIHsgdGhpcy51bml0VmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOyBpZiAodSkgdi5zZXRTdGFyKHUuc3Rhcik7IH0pOyB9XG4gIHRlc3RPZGRzKG4gPSAyMDApIHtcbiAgICBjb25zdCBzbG90cyA9IHRoaXMucy51bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVtaWVzID0gZW5lbXlXYXZlKHRoaXMucy53YXZlLCB0aGlzLnNlZWQpOyBsZXQgd2luID0gMCwgdCA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsgY29uc3QgciA9IHNpbXVsYXRlKHNsb3RzLCBlbmVtaWVzLCA1MDAwICsgaSk7IGlmIChyLndpbm5lciA9PT0gMCkgd2luKys7IHQgKz0gci50aW1lOyB9XG4gICAgcmV0dXJuIHsgd2luOiBNYXRoLnJvdW5kKCh3aW4gLyBuKSAqIDEwMCksIGF2Z1RpbWU6ICsodCAvIG4pLnRvRml4ZWQoMSksIG4gfTtcbiAgfVxuICBhZGRDYXJkKHNvdWw6IFNvdWxJZCkgeyB0aGlzLnMuaGFuZC5wdXNoKHNvdWwpOyB0aGlzLnMuc3RhdHMuZHJhd24rKzsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICBhZGREb21pbmlvbihuOiBudW1iZXIpIHsgdGhpcy5zLmNhcCArPSBuOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIHJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIGVuID0gZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKTtcbiAgICByZXR1cm4gW2BzZWVkICR7dGhpcy5zZWVkfSAgd2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfSAgaGVhcnRzICR7cy5oZWFydHN9ICBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0gIHBoYXNlICR7dGhpcy5waGFzZX0gIGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9YCxcbiAgICAgIGBoYW5kOiAke3MuaGFuZC5qb2luKCcsICcpIHx8ICcoZW1wdHkpJ31gLCBgYXJteTogJHtzLnVuaXRzLm1hcCgodSkgPT4gYCR7dS5zb3VsfSR7dS5zdGFyfUAke3UuY2VsbH1gKS5qb2luKCcgJykgfHwgJyhub25lKSd9YCwgYGVuZW15OiAke2VuLm1hcCgoZSkgPT4gZS5zb3VsICsgZS5zdGFyKS5qb2luKCcgJyl9YCxcbiAgICAgIGBkaWZmaWN1bHR5OiAke2RpZmZpY3VsdHlOYW1lfSAgbWVyZ2UtZnJvbS1oYW5kOiAke3MucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInfSAgc3dhcCB1c2VkOiAke3MuZGlzY2FyZFVzZWR9YCwgYGxhc3QgdGFwOiAke3RoaXMubGFzdFRhcEluZm99YCwgYHNjcmVlbjogJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IGRwciAke3dpbmRvdy5kZXZpY2VQaXhlbFJhdGlvfWAsIGBsYXN0IGJhdHRsZTogJHt0aGlzLmxhc3RCYXR0bGUgfHwgJy0nfWAsIGBsb2cgdGFpbDpgLCAuLi5zLmxvZy5zbGljZSgtOCksIGBiYWxhbmNlOiAke0pTT04uc3RyaW5naWZ5KHsgc3RhcjogQkFMQU5DRS5zdGFyLCBzdGF0czogQkFMQU5DRS5zdGF0cyB9KX1gXS5qb2luKCdcXG4nKTtcbiAgfVxuICByZXNldEJhbGFuY2VBbGwoKSB7IHJlc2V0QmFsYW5jZSgpOyB0aGlzLmFwcGx5QmFsYW5jZUNoYW5nZSgpOyB9XG4gIGdldCBkaWZmaWN1bHR5KCkgeyByZXR1cm4gZGlmZmljdWx0eU5hbWU7IH1cbiAgY2hhbmdlRGlmZmljdWx0eShuYW1lOiBzdHJpbmcpIHsgc2V0RGlmZmljdWx0eShuYW1lKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy50b2FzdChgRGlmZmljdWx0eTogJHtuYW1lfS4gQXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUuYCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBnYWxsZXJ5IChzdGFyIGxvb2tzKVxuICBnYWxsZXJ5KCkge1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmFkZCgnZ2FsbGVyeScpOyB0aGlzLm5lY3JvLnNldEVuYWJsZWQoZmFsc2UpOyBjb25zdCB2aXM6IFVuaXRWaXN1YWxbXSA9IFtdOyBsZXQgdGVhbTogMCB8IDEgPSAwO1xuICAgIGNvbnN0IHJlYnVpbGQgPSAoKSA9PiB7IHZpcy5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHZpcy5sZW5ndGggPSAwOyBTT1VMUy5mb3JFYWNoKChzb3VsLCBpKSA9PiBbMSwgMiwgM10uZm9yRWFjaCgoc3QsIGopID0+IHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHNvdWwsIHRlYW0sIHN0KTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KChpIC0gMi41KSAqIDIuNSwgMCwgKGogLSAxKSAqIC0yLjQpOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAqIDAuODU7IHYucGxheSgnaWRsZScpOyB2aXMucHVzaCh2KTsgfSkpOyB9O1xuICAgIHJlYnVpbGQoKTsgdGhpcy5jYW1lcmEucG9zaXRpb24uc2V0KDAsIDUuNiwgLTE0LjUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIC0wLjQpKTsgdGhpcy5jYW1lcmEuZm92ID0gMC44NTtcbiAgICAod2luZG93IGFzIGFueSkuX19nYWxsZXJ5ID0geyBzZXRUZWFtOiAodDogMCB8IDEpID0+IHsgdGVhbSA9IHQ7IHJlYnVpbGQoKTsgfSwgdmlzIH07XG4gICAgbGV0IGxhc3QgPSBwZXJmb3JtYW5jZS5ub3coKTsgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG4gPSBwZXJmb3JtYW5jZS5ub3coKSwgZHQgPSBNYXRoLm1pbigwLjA1LCAobiAtIGxhc3QpIC8gMTAwMCk7IGxhc3QgPSBuOyB2aXMuZm9yRWFjaCgodikgPT4gdi51cGRhdGUoZHQpKTsgdGhpcy5zY2VuZS5yZW5kZXIoKTsgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBHYW1lIH0gZnJvbSAnLi9nYW1lLnRzJztcblxuY29uc3QgZyA9IG5ldyBHYW1lKCk7XG4od2luZG93IGFzIGFueSkuX19nYW1lID0gZzsgICAgICAgICAgICAgICAgICAgICAgIC8vIGhhbmR5IGZvciBkZWJ1Z2dpbmcgZnJvbSB0aGUgYnJvd3NlciBjb25zb2xlXG5nLmluaXQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2MnKSBhcyBIVE1MQ2FudmFzRWxlbWVudClcbiAgLnRoZW4oKCkgPT4geyBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIGwuc3R5bGUuZGlzcGxheSA9ICdub25lJzsgfSlcbiAgLmNhdGNoKChlKSA9PiB7XG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSB7IGwuc3R5bGUuZGlzcGxheSA9ICdmbGV4JzsgbC50ZXh0Q29udGVudCA9ICdFcnJvcjogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IGUpOyB9XG4gICAgY29uc29sZS5lcnJvcihlKTtcbiAgfSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFvQ08sTUFBTSxXQUFvQjtBQUFBLElBQy9CLE9BQU87QUFBQSxNQUNMLFNBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sR0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLE1BQzlHLFFBQVcsRUFBRSxJQUFJLEtBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEtBQU0sT0FBTyxHQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsTUFDOUcsTUFBVyxFQUFFLElBQUksS0FBSyxLQUFLLElBQUksVUFBVSxLQUFLLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxXQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLE1BQU0sT0FBTyxLQUFLLE9BQU8sS0FBSyxNQUFNLEtBQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLElBQ2hIO0FBQUE7QUFBQSxJQUVBLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRyxHQUFLLEdBQUcsR0FBRyxLQUFLLENBQUMsR0FBRyxLQUFL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LFdBQUssTUFBTSxNQUFNO0FBQUcsV0FBSyxVQUFVLE1BQU07QUFDNUQsV0FBSyxPQUFPLFNBQVMsUUFBUSxDQUFDLE1BQU07QUFDbEMsWUFBSSxFQUFFLFNBQVMsR0FBRztBQUFFLGdCQUFNLElBQUksTUFBTSxFQUFFLEtBQUssQ0FBQztBQUFHLGdCQUFNLElBQUksS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUksZUFBSyxLQUFLLElBQUksRUFBRSxJQUFJLENBQUM7QUFBRyxlQUFLLE1BQU0sSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFO0FBQUcsWUFBRSxNQUFNLENBQUM7QUFBRyxZQUFFLFFBQVEsRUFBRSxVQUFVLElBQUksSUFBSTtBQUFBLFFBQUcsT0FDOUs7QUFBRSxnQkFBTSxJQUFJLGFBQWEsS0FBSyxHQUFHLEVBQUUsTUFBTSxHQUFHLEVBQUUsSUFBSTtBQUFHLFlBQUUsT0FBTyxTQUFTLElBQUksRUFBRSxHQUFHLEdBQUcsRUFBRSxDQUFDO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxDQUFDLEtBQUssS0FBSztBQUFHLFlBQUUsS0FBSyxPQUFPO0FBQUcsWUFBRSxNQUFNLENBQUM7QUFBRyxZQUFFLFFBQVEsRUFBRSxVQUFVLElBQUksSUFBSTtBQUFHLGVBQUssS0FBSyxJQUFJLEVBQUUsSUFBSSxDQUFDO0FBQUcsZUFBSyxNQUFNLEtBQUssTUFBTTtBQUFFLGdCQUFJLEVBQUUsVUFBVSxRQUFTLEdBQUUsS0FBSyxNQUFNO0FBQUEsVUFBRyxDQUFDO0FBQUcsZUFBSyxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLE1BQU0sS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFBLFFBQUc7QUFBQSxNQUN0VyxDQUFDO0FBQ0QsZUFBUyxJQUFJLEdBQUcsSUFBSSxZQUFZLElBQUssTUFBSyxLQUFLLEdBQUcsUUFBUTtBQUMxRCxXQUFLLFFBQVE7QUFBYyxXQUFLLGNBQWM7QUFBSyxXQUFLLE1BQU07QUFBRyxXQUFLLFNBQVMs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
