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
    easy: ["W1", "K1 W1", "O1 W1 G1"],
    normal: ["W1 A1", "K1 G1 W1", "O1 A1 G1 W1"],
    hard: ["W1 A1", "K1 G1 W1 A1", "O1 A1 G1 W1"]
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
  var PROTOTYPE_RULES = { curve: CURVES.doc.slice(0, 3), merge: "handIntoOneStar", stageWaves: 3, normalDrawWaves: [2, 3, 4, 5] };

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
      /** The navigation shell hides the battle screen while another tab is open: pause the game so it costs nothing. */
      __publicField(this, "active", true);
      __publicField(this, "canvas");
      __publicField(this, "lastW", 0);
      __publicField(this, "lastH", 0);
      __publicField(this, "lastTapInfo", "(no taps yet)");
      // ---- battle camera: follows the fighters that are still alive, so the action (and the purple eyes) stays large on screen
      __publicField(this, "camMode", "close");
      __publicField(this, "camTgt", new BABYLON.Vector3(0, 0.5, 0));
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
        this.frame(dt);
        scene.render();
      });
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
      const gw = GRID_COLS * GRID_SP + 0.5, gh = GRID_ROWS * GRID_SP + 0.5;
      const d2 = Math.max(gh / (2 * tanV * band), gw / (2 * tanV * asp * 0.88), 4.5);
      const shift = (0.5 - centerFrac) * 2 * d2 * tanV;
      const build = { pos: new BABYLON.Vector3(cx, d2, -shift - 0.1 * d2), tgt: new BABYLON.Vector3(cx, 0, -shift) };
      return { battle, build };
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
      } else if (this.phase === "battle" && this.camMode === "close") this.frameBattle(dt);
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
          if (this.phase === "battle" || f.team === 1) {
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
        if (advanceWave(s)) {
          this.phase = "won";
          this.ui.render();
          return;
        }
        this.draft = draftOptions(s);
        this.phase = "draft";
        this.ui.render();
      } else {
        failWave(s);
        if (s.status === "lost") {
          this.phase = "lost";
          this.ui.render();
          return;
        }
        this.toast("Your army fell. -1 heart, +1 card, same wave. Rebuild a different strategy.");
        this.toBuild();
      }
    }
    pickDraft(idx) {
      if (!this.draft) return;
      takeDraft(this.s, this.draft, idx);
      this.draft = null;
      normalDraw(this.s);
      this.toBuild();
    }
    toBuild() {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2NvcmUvYmF0dGxlLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9zYXZlLnRzIiwgIi4uL2dhbWUvdmlzdWFscy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXSB9O1xuICBzaW06IHsgc2VwYXJhdGlvbjogbnVtYmVyOyBoaXRGcmFjdGlvbjogbnVtYmVyOyB0aW1lTGltaXQ6IG51bWJlcjsgcmV0YXJnZXRFdmVyeTogbnVtYmVyIH07XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUUzogQmFsYW5jZSA9IHtcbiAgc3RhdHM6IHtcbiAgICB3YXJyaW9yOiAgIHsgaHA6IDYwLCAgZG1nOiA4LCAgaW50ZXJ2YWw6IDAuOSwgcmFuZ2U6IDAuODUsIHNwZWVkOiAxLjQsIHNpemU6IDAuMjgsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC40NyB9LFxuICAgIGFyY2hlcjogICAgeyBocDogNDAsICBkbWc6IDcsICBpbnRlcnZhbDogMS43LCByYW5nZTogNS4wLCAgc3BlZWQ6IDEuMSwgc2l6ZTogMC4yNiwgYW5pbUxlbjogMS41LCBoaXRGcmFjOiAwLjc4IH0sXG4gICAgZ29ibGluOiAgICB7IGhwOiA0NSwgIGRtZzogOSwgIGludGVydmFsOiAwLjgsIHJhbmdlOiAwLjgsICBzcGVlZDogMS43LCBzaXplOiAwLjI0LCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIGtuaWdodDogICAgeyBocDogMTMwLCBkbWc6IDksICBpbnRlcnZhbDogMS4xLCByYW5nZTogMC45LCAgc3BlZWQ6IDEuMCwgc2l6ZTogMC4zMiwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgICBvZ3JlOiAgICAgIHsgaHA6IDE3MCwgZG1nOiAxNiwgaW50ZXJ2YWw6IDEuOSwgcmFuZ2U6IDEuMDUsIHNwZWVkOiAwLjgsIHNpemU6IDAuNDIsIGFuaW1MZW46IDEuMiwgaGl0RnJhYzogMC41NSB9LFxuICAgIGJhcmJhcmlhbjogeyBocDogNzUsICBkbWc6IDgsICBpbnRlcnZhbDogMC45NSwgcmFuZ2U6IDAuOSwgc3BlZWQ6IDEuNSwgc2l6ZTogMC4zMCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgfSxcbiAgLy8gXCJib2RpZXMgPSBkYW1hZ2UsIHN0YXJzID0gZHVyYWJpbGl0eVwiOiBIUCBncm93cyBmYXN0ZXIgdGhhbiBkYW1hZ2UgcGVyIHN0YXJcbiAgc3RhcjogeyBocDogWzEsIDIuMCwgMy4yXSwgZG1nOiBbMSwgMS41LCAyLjBdLCBzY2FsZTogWzEsIDEuMTIsIDEuMjVdIH0sXG4gIHBoYWxhbng6IHsgcmFkaXVzOiAyLjAsIHBlckFsbHk6IDAuMDgsIG1heFN0YWNrczogMyB9LFxuICAvLyBtYW5hIGZpbGxzIGZhc3Q6IGEgYmFzaWMgYXR0YWNrIGdpdmVzIHBlckF0dGFjaywgdGFraW5nIGEgaGl0IGdpdmVzIHBlckhpdDsgYSBmdWxsIGJhciBmaXJlcyB0aGUgc2tpbGwgb24gdGhlIG5leHQgYXR0YWNrLCB0aGVuIHJlc2V0c1xuICBtYW5hOiB7XG4gICAgYXJjaGVyOiB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDM0LCBwZXJIaXQ6IDYgfSwgICAgIC8vIFNwbGl0IEFycm93IGFib3V0IGV2ZXJ5IDNyZCBzaG90XG4gICAgb2dyZTogICB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDM0LCBwZXJIaXQ6IDYgfSwgICAgIC8vIFNtYXNoIGFib3V0IGV2ZXJ5IDNyZCBzd2luZ1xuICAgIGtuaWdodDogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAyNSwgcGVySGl0OiAxMiB9LCAgICAvLyBUYXVudCBldmVyeSB+NCBzd2luZ3MsIHNvb25lciB3aGVuIGhlIGlzIGJlaW5nIGhpdFxuICB9LFxuICB2b2xsZXk6IHsgdGFyZ2V0czogMywgcHJvamVjdGlsZVNwZWVkOiAxNCB9LFxuICBvcHBvcnR1bmlzdDogeyBib251czogMC41LCBzZWVrUmFkaXVzOiA0LjAsIHdvdW5kZWRXZWlnaHQ6IDEuNSB9LFxuICB0YXVudDogeyBkdXJhdGlvbjogMywgcmFkaXVzOiA0LjUgfSxcbiAgc21hc2g6IHsgbXVsdDogMi4wLCByYWRpdXM6IDEuNiB9LFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IDAuMTIsIG1heFN0YWNrczogOCwgcmVzZXRBZnRlcjogMC42IH0sXG4gIGxldmVsOiB7IGhwOiAwLjA4LCBkbWc6IDAuMDgsIGNvcGllc1RvTGV2ZWw6IFs1LCAxMCwgMjAsIDQwLCA4MCwgMTIwLCAyMDAsIDMwMCwgNTAwXSB9LFxuICBzaW06IHsgc2VwYXJhdGlvbjogMC42LCBoaXRGcmFjdGlvbjogMC40NywgdGltZUxpbWl0OiAxMjAsIHJldGFyZ2V0RXZlcnk6IDAuNSB9LFxufTtcblxuZXhwb3J0IGNvbnN0IEJBTEFOQ0U6IEJhbGFuY2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNldEJhbGFuY2UoKTogdm9pZCB7XG4gIGNvbnN0IGZyZXNoOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoZnJlc2gpIGFzIChrZXlvZiBCYWxhbmNlKVtdKSAoQkFMQU5DRSBhcyBhbnkpW2tdID0gKGZyZXNoIGFzIGFueSlba107XG59XG5cbmV4cG9ydCBjb25zdCBST0xFX1RFWFQ6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdDaGVhcCBhbmQgZmFzdC4gVG91Z2hlciBuZWFyIG90aGVyIFdhcnJpb3JzLicsXG4gIGFyY2hlcjogJ0ZyYWdpbGUuIFNraWxsOiBTcGxpdCBBcnJvdyBoaXRzIDMgZGlmZmVyZW50IGVuZW1pZXMuJyxcbiAgZ29ibGluOiAnRmFzdC4gSGl0cyBoYXJkZXIgb24gZW5lbWllcyBmaWdodGluZyBzb21lb25lIGVsc2UuJyxcbiAga25pZ2h0OiAnVGFuay4gU2tpbGw6IFRhdW50IHB1bGxzIGVuZW1pZXMgb250byBoaW0uJyxcbiAgb2dyZTogJ1Nsb3csIGh1Z2UgZGFtYWdlLiBTa2lsbDogU21hc2gsIGEgYmlnIGFyZWEgc2xhbS4nLFxuICBiYXJiYXJpYW46ICdTd2luZ3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBoaXQuJyxcbn07XG5cbmV4cG9ydCBjb25zdCBTT1VMX05BTUU6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdTa2VsZXRvbiBXYXJyaW9yJywgYXJjaGVyOiAnU2tlbGV0b24gQXJjaGVyJywgZ29ibGluOiAnR29ibGluJyxcbiAga25pZ2h0OiAnS25pZ2h0Jywgb2dyZTogJ09ncmUnLCBiYXJiYXJpYW46ICdCYXJiYXJpYW4nLFxufTtcblxuLyoqIEFiaWxpdHkgYmx1cmJzIGZvciB0aGUgU291bHMgcGFnZSwgd2l0aCB0aGUgbGl2ZSBudW1iZXJzIGZpbGxlZCBpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhYmlsaXR5SW5mbyhzb3VsOiBTb3VsSWQpOiB7IGtpbmQ6ICdza2lsbCcgfCAncGFzc2l2ZSc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nIH0ge1xuICBjb25zdCBCID0gQkFMQU5DRSwgcGN0ID0gKHg6IG51bWJlcikgPT4gTWF0aC5yb3VuZCh4ICogMTAwKSArICclJztcbiAgc3dpdGNoIChzb3VsKSB7XG4gICAgY2FzZSAnd2Fycmlvcic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ1BoYWxhbngnLCB0ZXh0OiBgVGFrZXMgJHtwY3QoQi5waGFsYW54LnBlckFsbHkpfSBsZXNzIGRhbWFnZSBmb3IgZWFjaCBvdGhlciBTa2VsZXRvbiBXYXJyaW9yIHdpdGhpbiAke0IucGhhbGFueC5yYWRpdXN9bSAodXAgdG8gJHtCLnBoYWxhbngubWF4U3RhY2tzfSkuYCB9O1xuICAgIGNhc2UgJ2dvYmxpbic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ09wcG9ydHVuaXN0JywgdGV4dDogYERlYWxzICR7cGN0KEIub3Bwb3J0dW5pc3QuYm9udXMpfSBtb3JlIGRhbWFnZSB0byBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZSwgYW5kIHByZWZlcnMgc3VjaCB0YXJnZXRzLmAgfTtcbiAgICBjYXNlICdiYXJiYXJpYW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdGcmVuenknLCB0ZXh0OiBgQXR0YWNrcyAke3BjdChCLmZyZW56eS5wZXJTd2luZyl9IGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmcgKHVwIHRvICR7Qi5mcmVuenkubWF4U3RhY2tzfSB0aW1lcykuYCB9O1xuICAgIGNhc2UgJ2FyY2hlcic6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTcGxpdCBBcnJvdycsIHRleHQ6IGBCYXNpYyBzaG90cyBmaXJlIG9uZSBhcnJvdy4gV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHNob3QgZmlyZXMgYXQgdXAgdG8gJHtCLnZvbGxleS50YXJnZXRzfSBkaWZmZXJlbnQgZW5lbWllcy5gIH07XG4gICAgY2FzZSAna25pZ2h0JzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1RhdW50JywgdGV4dDogYFdoZW4gbWFuYSBpcyBmdWxsLCBlbmVtaWVzIHdpdGhpbiAke0IudGF1bnQucmFkaXVzfW0gbXVzdCBhdHRhY2sgaGltIGZvciAke0IudGF1bnQuZHVyYXRpb259cy5gIH07XG4gICAgY2FzZSAnb2dyZSc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTbWFzaCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgdGhlIG5leHQgc3dpbmcgZGVhbHMgJHtCLnNtYXNoLm11bHR9eCBkYW1hZ2UgYW5kIGhpdHMgZW5lbWllcyBuZWFyIHRoZSB0YXJnZXQgZm9yIDYwJSBhcyBtdWNoLmAgfTtcbiAgfVxufVxuIiwgIi8vIERlc2lnbiBkYXRhIHN0cmFpZ2h0IGZyb20gdGhlIHBsYW4gZG9jLiBBbnl0aGluZyBtYXJrZWQgUExBQ0VIT0xERVIgaXMgbm90IGluIHRoZSBkb2MgeWV0LlxuXG5leHBvcnQgdHlwZSBTb3VsSWQgPSAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJztcblxuZXhwb3J0IGNvbnN0IFNPVUxTOiBTb3VsSWRbXSA9IFsnd2FycmlvcicsICdhcmNoZXInLCAnZ29ibGluJywgJ2tuaWdodCcsICdvZ3JlJywgJ2JhcmJhcmlhbiddO1xuXG4vKiogRG9taW5pb24gY29zdCBwZXIgc3RhciBsZXZlbDogaW5kZXggMCA9IDEgc3RhciwgMSA9IDIgc3RhcnMsIDIgPSAzIHN0YXJzICgzIHN0YXJzIGlzIHRoZSBtYXgpLiAqL1xuZXhwb3J0IGNvbnN0IENPU1Q6IFJlY29yZDxTb3VsSWQsIG51bWJlcltdPiA9IHtcbiAgd2FycmlvcjogWzIsIDMsIDRdLFxuICBhcmNoZXI6IFs0LCA2LCA5XSxcbiAgZ29ibGluOiBbMywgNCwgNl0sXG4gIGtuaWdodDogWzUsIDcsIDEwXSxcbiAgb2dyZTogWzcsIDEwLCAxNV0sXG4gIGJhcmJhcmlhbjogWzUsIDcsIDEwXSwgLy8gUExBQ0VIT0xERVI6IHRoZSBkb2MgaGFzIG5vIGNvc3QgZm9yIHRoZSBzaXh0aCBTb3VsIHlldFxufTtcblxuZXhwb3J0IGNvbnN0IE1BWF9TVEFSID0gMztcbmV4cG9ydCBjb25zdCBHUklEX0NFTExTID0gMTI7IC8vIDQgeCAzXG5cbi8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUgKGluZGV4IDAgPSB3YXZlIDEpLiAqL1xuZXhwb3J0IGNvbnN0IENVUlZFUzogUmVjb3JkPHN0cmluZywgbnVtYmVyW10+ID0ge1xuICAvLyBMT0NLRUQgKGNvbmZpcm1lZCk6ICs0IGZvciB3YXZlcyAyLTUsIHRoZW4gKzMgZm9yIHdhdmVzIDYtMTAgLT4gNDBcbiAgZG9jOiBbOSwgMTMsIDE3LCAyMSwgMjUsIDI4LCAzMSwgMzQsIDM3LCA0MF0sXG4gIC8vIE5PVCBVU0VEOiBtaXNyZW1lbWJlcmVkIHZhcmlhbnQgKCszIHRocm91Z2ggd2F2ZSA2LCB0aGVuICsyKSB0aGF0IG9ubHkgcmVhY2hlcyAzMi4gS2VwdCBmb3IgY29tcGFyaXNvbiBvbmx5LlxuICByZWNhbGxlZDogWzksIDEyLCAxNSwgMTgsIDIxLCAyNCwgMjYsIDI4LCAzMCwgMzJdLFxufTtcblxuZXhwb3J0IGNvbnN0IEhFQVJUUyA9IDM7XG5leHBvcnQgY29uc3QgU1RBUlRfSEFORCA9IDQ7XG5leHBvcnQgY29uc3QgV0FWRVMgPSAxMDtcblxuZXhwb3J0IGludGVyZmFjZSBSdWxlcyB7XG4gIC8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUuICovXG4gIGN1cnZlOiBudW1iZXJbXTtcbiAgLyoqXG4gICAqICdkZXBsb3llZE9ubHknOiBvbmx5IHR3byBkZXBsb3llZCB1bml0cyBvZiB0aGUgc2FtZSBzdGFyIGNhbiBtZXJnZSAoZG9jIGFzIHdyaXR0ZW4pLlxuICAgKiAnaGFuZEludG9PbmVTdGFyJzogYWRkaXRpb25hbGx5IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gYmUgcGxheWVkIG9udG8gYSBkZXBsb3llZFxuICAgKiAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsIHRvIG1lcmdlIGltbWVkaWF0ZWx5IChwYXlzIG9ubHkgdGhlIGNvc3QgZGlmZmVyZW5jZSkuXG4gICAqL1xuICBtZXJnZTogJ2RlcGxveWVkT25seScgfCAnaGFuZEludG9PbmVTdGFyJztcbiAgLyoqIENhcmQtaW5mbG93IGtub2JzIChhbGwgb3B0aW9uYWw7IGRlZmF1bHRzIHJlcHJvZHVjZSB0aGUgZG9jKS4gKi9cbiAgc3RhcnRIYW5kPzogbnVtYmVyOyAgICAgICAgICAgIC8vIGRlZmF1bHQgNFxuICBkcmFmdFBpY2tzPzogbnVtYmVyOyAgICAgICAgICAgLy8gY2FyZHMga2VwdCBmcm9tIHRoZSAzLWNhcmQgVmljdG9yeSBEcmFmdCwgZGVmYXVsdCAxXG4gIG5vcm1hbERyYXdXYXZlcz86IG51bWJlcltdOyAgICAvLyB3YXZlcyAoYmVpbmcgZW50ZXJlZCkgdGhhdCBhbHNvIGdpdmUgdGhlIG5vcm1hbCByYW5kb20gZHJhdzsgZGVmYXVsdCA9IGFsbFxuICAvKiogU291bHMgdGhpcyBydW4gbWF5IGRyYXcgZnJvbSAodGhlIGVxdWlwcGVkIFNvdWwgRGVjaywgbWF4IDYpLiBEZWZhdWx0OiBldmVyeSBTb3VsLiAqL1xuICBwb29sPzogU291bElkW107XG4gIHN0YWdlV2F2ZXM/OiBudW1iZXI7ICAgICAgICAgICAvLyB3YXZlcyBpbiB0aGlzIHN0YWdlOyBkZWZhdWx0IDEwICh0aGUgcGxheWFibGUgcHJvdG90eXBlIHVzZXMgMylcbn1cblxuZXhwb3J0IGNvbnN0IEdSSURfQ09MUyA9IDQsIEdSSURfUk9XUyA9IDM7ICAgLy8gNCB4IDMgPSBHUklEX0NFTExTOyBjb2x1bW4gR1JJRF9DT0xTLTEgaXMgdGhlIGZyb250IGxpbmVcbiIsICIvLyBTbWFsbCBzZWVkZWQgUk5HIChtdWxiZXJyeTMyKS4gU2FtZSBzZWVkIC0+IHNhbWUgcnVuLCBzbyBhbnkgYnVnIHJlcG9ydCBpcyByZXByb2R1Y2libGUuXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgbmV4dCgpOiBudW1iZXI7ICAgICAgICAgICAgICAvLyBbMCwgMSlcbiAgaW50KG46IG51bWJlcik6IG51bWJlcjsgICAgICAvLyBbMCwgbilcbiAgcGljazxUPihpdGVtczogcmVhZG9ubHkgVFtdKTogVDtcbiAgc2VlZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWFrZVJuZyhzZWVkOiBudW1iZXIpOiBSbmcge1xuICBsZXQgYSA9IHNlZWQgPj4+IDA7XG4gIGNvbnN0IG5leHQgPSAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBhO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBzZWVkLFxuICAgIG5leHQsXG4gICAgaW50OiAobikgPT4gTWF0aC5mbG9vcihuZXh0KCkgKiBuKSxcbiAgICBwaWNrOiAoaXRlbXMpID0+IGl0ZW1zW01hdGguZmxvb3IobmV4dCgpICogaXRlbXMubGVuZ3RoKV0sXG4gIH07XG59XG4iLCAiLy8gUHVyZSBnYW1lIHJ1bGVzIGZvciBvbmUgc3RhZ2UuIE5vIGdyYXBoaWNzLCBubyBjb21iYXQ6IGp1c3QgY2FyZHMsIERvbWluaW9uLCBncmlkLCBtZXJnZSwgd2F2ZXMsIGhlYXJ0cy5cbi8vIEV2ZXJ5IG11dGF0aW9uIGdvZXMgdGhyb3VnaCBhIGZ1bmN0aW9uIGhlcmUgYW5kIGFwcGVuZHMgdG8gc3RhdGUubG9nLCBzbyBydW5zIGNhbiBiZSByZXBsYXllZCBhbmQgaW5zcGVjdGVkLlxuXG5pbXBvcnQgeyBDT1NULCBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUywgU1RBUlRfSEFORCwgV0FWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0IHsgaWQ6IG51bWJlcjsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjsgZnJlc2g/OiBib29sZWFuIH0gICAvLyBmcmVzaCA9IHN1bW1vbmVkIHRoaXMgYnVpbGQgcGhhc2VcblxuZXhwb3J0IGludGVyZmFjZSBTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlcztcbiAgcm5nOiBSbmc7XG4gIHdhdmU6IG51bWJlcjsgICAgICAgICAgICAgICAgIC8vIDEtYmFzZWRcbiAgaGVhcnRzOiBudW1iZXI7XG4gIGNhcDogbnVtYmVyO1xuICBoYW5kOiBTb3VsSWRbXTtcbiAgdW5pdHM6IFVuaXRbXTtcbiAgbmV4dElkOiBudW1iZXI7XG4gIGRpc2NhcmRVc2VkOiBib29sZWFuOyAgICAgICAgIC8vIG9uY2UtcGVyLWJ1aWxkLXBoYXNlIHJlZHJhd1xuICBzdGF0dXM6ICdidWlsZGluZycgfCAnd29uJyB8ICdsb3N0JztcbiAgbG9nOiBzdHJpbmdbXTtcbiAgc3RhdHM6IHsgZHJhd246IG51bWJlcjsgZGlzY2FyZGVkOiBudW1iZXI7IGRpc21pc3NlZDogbnVtYmVyOyBtZXJnZXM6IG51bWJlcjsgZmFpbHVyZXM6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgY29zdCA9IChzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlcik6IG51bWJlciA9PiBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbmV4cG9ydCBjb25zdCBjYXJkc0luID0gKHN0YXI6IG51bWJlcik6IG51bWJlciA9PiAyICoqIChzdGFyIC0gMSk7ICAgICAvLyBjYXJkcyBhIHVuaXQgaXMgXCJ3b3J0aFwiXG5leHBvcnQgY29uc3QgZG9taW5pb25Vc2VkID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY29zdCh1LnNvdWwsIHUuc3RhciksIDApO1xuZXhwb3J0IGNvbnN0IGRvbWluaW9uRnJlZSA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLmNhcCAtIGRvbWluaW9uVXNlZChzKTtcblxuZnVuY3Rpb24gbG9nKHM6IFN0YXRlLCBtc2c6IHN0cmluZykgeyBzLmxvZy5wdXNoKGBbdyR7cy53YXZlfV0gJHttc2d9YCk7IH1cbi8qKiBUaGUgU291bHMgdGhpcyBydW4gZHJhd3MgZnJvbTogdGhlIGVxdWlwcGVkIGRlY2ssIG9yIGV2ZXJ5dGhpbmcgaWYgbm8gZGVjayB3YXMgZ2l2ZW4uICovXG5leHBvcnQgY29uc3QgcG9vbE9mID0gKHM6IFN0YXRlKTogU291bElkW10gPT4gKHMucnVsZXMucG9vbCAmJiBzLnJ1bGVzLnBvb2wubGVuZ3RoID8gcy5ydWxlcy5wb29sIDogU09VTFMpO1xuZnVuY3Rpb24gZHJhdyhzOiBTdGF0ZSwgd2h5OiBzdHJpbmcsIG5vdD86IFNvdWxJZCk6IFNvdWxJZCB7XG4gIGNvbnN0IGFsbCA9IHBvb2xPZihzKSwgb3RoZXJzID0gbm90ID8gYWxsLmZpbHRlcigoeCkgPT4geCAhPT0gbm90KSA6IGFsbDtcbiAgY29uc3QgcG9vbCA9IG90aGVycy5sZW5ndGggPyBvdGhlcnMgOiBhbGw7ICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHN3YXAgbmV2ZXIgaGFuZHMgeW91IGJhY2sgdGhlIFNvdWwgeW91IGdhdmUgdXAgKHVubGVzcyBpdCBpcyB0aGUgb25seSBvbmUgZXF1aXBwZWQpXG4gIGNvbnN0IGMgPSBzLnJuZy5waWNrKHBvb2wpO1xuICBzLmhhbmQucHVzaChjKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYXcgJHtjfSAoJHt3aHl9KWApO1xuICByZXR1cm4gYztcbn1cblxuLyoqIEEgbmV3IGJ1aWxkIHBoYXNlIGJlZ2luczogdGhlIG9uY2UtcGVyLXBoYXNlIHN3YXAgY29tZXMgYmFjayBhbmQgbm90aGluZyBjb3VudHMgYXMgXCJzdW1tb25lZCB0aGlzIHJvdW5kXCIuICovXG5leHBvcnQgZnVuY3Rpb24gbmV3UGhhc2UoczogU3RhdGUpOiB2b2lkIHtcbiAgcy5kaXNjYXJkVXNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgdS5mcmVzaCA9IGZhbHNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3U3RhZ2UocnVsZXM6IFJ1bGVzLCBzZWVkOiBudW1iZXIpOiBTdGF0ZSB7XG4gIGNvbnN0IHM6IFN0YXRlID0ge1xuICAgIHJ1bGVzLCBybmc6IG1ha2VSbmcoc2VlZCksIHdhdmU6IDEsIGhlYXJ0czogSEVBUlRTLCBjYXA6IHJ1bGVzLmN1cnZlWzBdLCBoYW5kOiBbXSwgdW5pdHM6IFtdLCBuZXh0SWQ6IDEsXG4gICAgZGlzY2FyZFVzZWQ6IGZhbHNlLCBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogW10sXG4gICAgc3RhdHM6IHsgZHJhd246IDAsIGRpc2NhcmRlZDogMCwgZGlzbWlzc2VkOiAwLCBtZXJnZXM6IDAsIGZhaWx1cmVzOiAwIH0sXG4gIH07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgKHJ1bGVzLnN0YXJ0SGFuZCA/PyBTVEFSVF9IQU5EKTsgaSsrKSBkcmF3KHMsICdzdGFydGluZyBoYW5kJyk7XG4gIHJldHVybiBzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlZUNlbGwoczogU3RhdGUpOiBudW1iZXIge1xuICBjb25zdCB0YWtlbiA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKCF0YWtlbi5oYXMoYykpIHJldHVybiBjO1xuICByZXR1cm4gLTE7XG59XG5cbi8vIC0tLS0gYnVpbGQtcGhhc2UgYWN0aW9ucyAoZWFjaCByZXR1cm5zIHRydWUgd2hlbiBpdCBoYXBwZW5lZCkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5TdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdO1xuICByZXR1cm4gc291bCAhPT0gdW5kZWZpbmVkICYmIGZyZWVDZWxsKHMpID49IDAgJiYgY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjZWxsRnJlZShzOiBTdGF0ZSwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIHJldHVybiBjZWxsID49IDAgJiYgY2VsbCA8IEdSSURfQ0VMTFMgJiYgIXMudW5pdHMuc29tZSgodSkgPT4gdS5jZWxsID09PSBjZWxsKTtcbn1cblxuLyoqIFN1bW1vbiBhIGhhbmQgY2FyZCBvbnRvIGEgc3BlY2lmaWMgZnJlZSBjZWxsIChkZWZhdWx0OiB0aGUgZmlyc3QgZnJlZSBvbmUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCBjZWxsPzogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3VtbW9uKHMsIGhhbmRJZHgpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChjZWxsICE9PSB1bmRlZmluZWQgJiYgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1OiBVbml0ID0geyBpZDogcy5uZXh0SWQrKywgc291bCwgc3RhcjogMSwgY2VsbDogY2VsbCA/PyBmcmVlQ2VsbChzKSwgZnJlc2g6IHRydWUgfTtcbiAgcy51bml0cy5wdXNoKHUpO1xuICBsb2cocywgYHN1bW1vbiAke3NvdWx9IDEqIC0+IGNlbGwgJHt1LmNlbGx9ICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRGVwbG95ZWQoYTogVW5pdCwgYjogVW5pdCk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5pZCAhPT0gYi5pZCAmJiBhLnNvdWwgPT09IGIuc291bCAmJiBhLnN0YXIgPT09IGIuc3RhciAmJiBhLnN0YXIgPCBNQVhfU1RBUjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRGVwbG95ZWQoczogU3RhdGUsIGFJZDogbnVtYmVyLCBiSWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBhID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBhSWQpLCBiID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBiSWQpO1xuICBpZiAoIWEgfHwgIWIgfHwgIWNhbk1lcmdlRGVwbG95ZWQoYSwgYikpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh1KSA9PiB1LmlkICE9PSBiLmlkKTtcbiAgYS5mcmVzaCA9ICEhKGEuZnJlc2ggfHwgYi5mcmVzaCk7XG4gIGEuc3RhcisrO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlICR7YS5zb3VsfSAke2Euc3RhciAtIDF9Kiske2Euc3RhciAtIDF9KiAtPiAke2Euc3Rhcn0qICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9LCBjZWxscyAke3MudW5pdHMubGVuZ3RofS8ke0dSSURfQ0VMTFN9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqICdoYW5kSW50b09uZVN0YXInIHJ1bGU6IHBsYXkgYSAxLXN0YXIgY2FyZCBvbnRvIGEgZGVwbG95ZWQgMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLnJ1bGVzLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXNvdWwgfHwgIXUgfHwgdS5zb3VsICE9PSBzb3VsIHx8IHUuc3RhciAhPT0gMSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gY29zdChzb3VsLCAyKSAtIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhbk1lcmdlRnJvbUhhbmQocywgaGFuZElkeCwgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHUuc3RhciA9IDI7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UtZnJvbS1oYW5kICR7c291bH0gLT4gJHt1LnNvdWx9IDIqICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRpc21pc3MoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBkaXNtaXNzICR7dS5zb3VsfSAke3Uuc3Rhcn0qIChwZXJtYW5lbnRseSByZW1vdmVkKWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDE6IGRpc2NhcmQgYSBoYW5kIGNhcmQgYW5kIGRyYXcgYSByYW5kb20gY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2NhcmRSZWRyYXcoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5kaXNjYXJkVXNlZCB8fCBoYW5kSWR4IDwgMCB8fCBoYW5kSWR4ID49IHMuaGFuZC5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgYyA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc2NhcmRlZCsrO1xuICBsb2cocywgYHN3YXA6IGRpc2NhcmQgJHtjfWApO1xuICBkcmF3KHMsICdzd2FwJywgYyk7XG4gIHJldHVybiB0cnVlO1xufVxuZXhwb3J0IGNvbnN0IHN3YXBEaXNjYXJkID0gZGlzY2FyZFJlZHJhdztcblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICByZXR1cm4gIXMuZGlzY2FyZFVzZWQgJiYgISF1ICYmICF1LmZyZXNoOyAgICAgICAgICAvLyBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZFxufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMjogc2VsbCBhIGRlcGxveWVkIHVuaXQgKG5vdCBvbmUgc3VtbW9uZWQgdGhpcyByb3VuZCkgYW5kIGRyYXcgYSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gc3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3dhcFNlbGwocywgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYHN3YXA6IHNlbGwgJHt1LnNvdWx9ICR7dS5zdGFyfSpgKTtcbiAgZHJhdyhzLCAnc3dhcCcsIHUuc291bCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbW92ZVVuaXQoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1IHx8ICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBsb2cocywgYG1vdmUgJHt1LnNvdWx9IGNlbGwgJHt1LmNlbGx9IC0+ICR7Y2VsbH1gKTsgdS5jZWxsID0gY2VsbDsgcmV0dXJuIHRydWU7XG59XG5cbi8vIC0tLS0gd2F2ZSByZXN1bHRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERyYWZ0IGNob2ljZXMgZm9yIGFmdGVyIGEgY2xlYXJlZCB3YXZlOiAzIHJhbmRvbSBjYXJkcywgZHVwbGljYXRlcyBhbGxvd2VkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRyYWZ0T3B0aW9ucyhzOiBTdGF0ZSk6IFNvdWxJZFtdIHtcbiAgY29uc3QgcCA9IHBvb2xPZihzKTtcbiAgcmV0dXJuIFtzLnJuZy5waWNrKHApLCBzLnJuZy5waWNrKHApLCBzLnJuZy5waWNrKHApXTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZDogcmFpc2UgdGhlIGNhcCwgcmVzb2x2ZSB0aGUgVmljdG9yeSBEcmFmdCwgZHJhdyAxIG5vcm1hbCBjYXJkLiAqL1xuZXhwb3J0IGNvbnN0IHN0YWdlV2F2ZXMgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5ydWxlcy5zdGFnZVdhdmVzID8/IFdBVkVTO1xuXG4vKiogU3RlcCAxIG9mIGEgY2xlYXJlZCB3YXZlOiBpcyB0aGUgc3RhZ2Ugb3Zlcj8gSWYgbm90LCByYWlzZSB0aGUgY2FwIGFuZCBzdGFydCB0aGUgbmV4dCBidWlsZCBwaGFzZS4gUmV0dXJucyB0cnVlIHdoZW4gdGhlIHN0YWdlIGlzIHdvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlV2F2ZShzOiBTdGF0ZSk6IGJvb2xlYW4ge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBzLnN0YXR1cyA9PT0gJ3dvbic7XG4gIGlmIChzLndhdmUgPj0gc3RhZ2VXYXZlcyhzKSkgeyBzLnN0YXR1cyA9ICd3b24nOyBsb2cocywgJ3N0YWdlIGNsZWFyZWQnKTsgcmV0dXJuIHRydWU7IH1cbiAgcy53YXZlKys7XG4gIHMuY2FwID0gcy5ydWxlcy5jdXJ2ZVtzLndhdmUgLSAxXTtcbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgd2F2ZSBjbGVhcmVkIC0+IGNhcCAke3MuY2FwfWApO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTdGVwIDI6IHRoZSBwbGF5ZXIga2VwdCBgaWR4YCBmcm9tIHRoZSBvZmZlcmVkIGRyYWZ0IGNhcmRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRha2VEcmFmdChzOiBTdGF0ZSwgb3B0czogU291bElkW10sIGlkeDogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IHBpY2sgPSBvcHRzW01hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgaWR4KSldO1xuICBzLmhhbmQucHVzaChwaWNrKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYWZ0IFske29wdHMuam9pbignLCAnKX1dIC0+IHRvb2sgJHtwaWNrfWApO1xufVxuXG4vKiogU3RlcCAzOiB0aGUgYm9udXMgbm9ybWFsIGRyYXcgKG9ubHkgb24gdGhlIHdhdmVzIHRoZSBydWxlcyBhbGxvdykuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsRHJhdyhzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMgPyBzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcy5pbmNsdWRlcyhzLndhdmUpIDogdHJ1ZSkgZHJhdyhzLCAnd2F2ZSBjbGVhcicpO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkIChhbGwgdGhyZWUgc3RlcHMgaW4gb25lIGNhbGwsIGZvciBzaW11bGF0aW9ucykuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJXYXZlKHM6IFN0YXRlLCBjaG9vc2U6IChvcHRzOiBTb3VsSWRbXSkgPT4gbnVtYmVyKTogdm9pZCB7XG4gIGlmIChhZHZhbmNlV2F2ZShzKSkgcmV0dXJuO1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgbGV0IG9wdHMgPSBkcmFmdE9wdGlvbnMocyk7XG4gIGNvbnN0IG9mZmVyZWQgPSBvcHRzLmpvaW4oJywgJyk7XG4gIGNvbnN0IHRvb2s6IFNvdWxJZFtdID0gW107XG4gIGZvciAobGV0IHAgPSAwOyBwIDwgKHMucnVsZXMuZHJhZnRQaWNrcyA/PyAxKTsgcCsrKSB7XG4gICAgY29uc3QgaWR4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBjaG9vc2Uob3B0cykpKTtcbiAgICB0b29rLnB1c2gob3B0c1tpZHhdKTsgcy5oYW5kLnB1c2gob3B0c1tpZHhdKTsgcy5zdGF0cy5kcmF3bisrO1xuICAgIG9wdHMgPSBvcHRzLmZpbHRlcigoXywgaSkgPT4gaSAhPT0gaWR4KTtcbiAgfVxuICBsb2cocywgYGRyYWZ0IFske29mZmVyZWR9XSAtPiB0b29rICR7dG9vay5qb2luKCcsICcpfWApO1xuICBub3JtYWxEcmF3KHMpO1xufVxuXG4vKiogQXJteSB3aXBlZDogbG9zZSBhIGhlYXJ0LCBjYXAgZG9lcyBOT1QgcmlzZSwgZW5lbWllcyByZXNldCwgKzEgY2FyZCwgcmVkcmF3IGFsbG93ZWQgYWdhaW4uICovXG5leHBvcnQgZnVuY3Rpb24gZmFpbFdhdmUoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIHMuaGVhcnRzLS07IHMuc3RhdHMuZmFpbHVyZXMrKztcbiAgaWYgKHMuaGVhcnRzIDw9IDApIHsgcy5zdGF0dXMgPSAnbG9zdCc7IGxvZyhzLCAnbm8gaGVhcnRzIGxlZnQ6IHN0YWdlIGxvc3QnKTsgcmV0dXJuOyB9XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYGFybXkgd2lwZWQ6IGhlYXJ0cyAke3MuaGVhcnRzfSwgY2FwIHN0YXlzICR7cy5jYXB9YCk7XG4gIGRyYXcocywgJ2ZhaWxlZCBhdHRlbXB0Jyk7XG59XG5cbi8vIC0tLS0gaW52YXJpYW50cyAoY2FsbGVkIGJ5IHRoZSBzaW11bGF0b3IgYWZ0ZXIgZXZlcnkgd2F2ZTsgdGhyb3cgd2l0aCBhIHJlYWRhYmxlIG1lc3NhZ2UpIC0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrSW52YXJpYW50cyhzOiBTdGF0ZSk6IHZvaWQge1xuICBjb25zdCBmYWlsID0gKG06IHN0cmluZykgPT4geyB0aHJvdyBuZXcgRXJyb3IoYElOVkFSSUFOVCAke219XFxuYCArIHMubG9nLnNsaWNlKC0xMikuam9pbignXFxuJykpOyB9O1xuICBpZiAocy51bml0cy5sZW5ndGggPiBHUklEX0NFTExTKSBmYWlsKGBtb3JlIHVuaXRzICgke3MudW5pdHMubGVuZ3RofSkgdGhhbiBjZWxsc2ApO1xuICBjb25zdCBjZWxscyA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBpZiAoY2VsbHMuc2l6ZSAhPT0gcy51bml0cy5sZW5ndGgpIGZhaWwoJ3R3byB1bml0cyBzaGFyZSBhIGNlbGwnKTtcbiAgaWYgKGRvbWluaW9uVXNlZChzKSA+IHMuY2FwKSBmYWlsKGBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0gZXhjZWVkcyBjYXAgJHtzLmNhcH1gKTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIGlmICh1LnN0YXIgPCAxIHx8IHUuc3RhciA+IE1BWF9TVEFSKSBmYWlsKGB1bml0IHN0YXIgJHt1LnN0YXJ9IG91dCBvZiByYW5nZWApO1xuICAvLyBldmVyeSBkcmF3biBjYXJkIGlzIGVpdGhlciBpbiBoYW5kLCB3b3J0aCBjYXJkcyBvbiB0aGUgZmllbGQsIGRpc2NhcmRlZCwgb3IgZGlzbWlzc2VkXG4gIGNvbnN0IG9uRmllbGQgPSBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNhcmRzSW4odS5zdGFyKSwgMCk7XG4gIGNvbnN0IGFjY291bnRlZCA9IHMuaGFuZC5sZW5ndGggKyBvbkZpZWxkICsgcy5zdGF0cy5kaXNjYXJkZWQgKyBzLnN0YXRzLmRpc21pc3NlZDtcbiAgaWYgKGFjY291bnRlZCAhPT0gcy5zdGF0cy5kcmF3bikgZmFpbChgY2FyZCBjb25zZXJ2YXRpb246IGRyYXduICR7cy5zdGF0cy5kcmF3bn0gIT0gYWNjb3VudGVkICR7YWNjb3VudGVkfWApO1xufVxuIiwgIi8vIEF1dG8tYmF0dGxlIHNpbXVsYXRpb246IHB1cmUgbG9naWMsIG5vIGdyYXBoaWNzLiBEZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHNlZWQuXG4vLyBUaGUgcmVuZGVyZXIgb25seSByZWFkcyBmaWdodGVycyArIGV2ZW50czsgaXQgbmV2ZXIgZGVjaWRlcyBhbnl0aGluZy5cbi8vXG4vLyBBYmlsaXRpZXMgKG51bWJlcnMgbGl2ZSBpbiBiYWxhbmNlLnRzKTpcbi8vICAgU2tlbGV0b24gV2FycmlvciAgUGhhbGFueCAgICAgdGFrZXMgbGVzcyBkYW1hZ2UgZm9yIGVhY2ggbmVhcmJ5IGFsbGllZCBXYXJyaW9yIChjYXBwZWQpXG4vLyAgIFNrZWxldG9uIEFyY2hlciAgIFNwbGl0IEFycm93IChza2lsbCkgb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllczsgYmFzaWMgc2hvdHMgYXJlIGEgc2luZ2xlIGFycm93XG4vLyAgIEdvYmxpbiAgICAgICAgICAgIE9wcG9ydHVuaXN0ICtkYW1hZ2Ugb24gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2U7IHByZWZlcnMgc3VjaCB0YXJnZXRzXG4vLyAgIEtuaWdodCAgICAgICAgICAgIFRhdW50IChza2lsbCkgIGZvcmNlcyBuZWFyYnkgZW5lbWllcyB0byBhdHRhY2sgaGltXG4vLyAgIE9ncmUgICAgICAgICAgICAgIFNtYXNoIChza2lsbCkgIGhlYXZ5IHNsYW0gdGhhdCBhbHNvIGhpdHMgZW5lbWllcyBuZWFyIHRoZSBpbXBhY3Rcbi8vIFNraWxscyBydW4gb24gbWFuYTogYmFzaWMgYXR0YWNrcyBhbmQgZGFtYWdlIHRha2VuIGZpbGwgYSBiYXI7IHdoZW4gZnVsbCwgdGhlIG5leHQgYXR0YWNrIGlzIHRoZSBza2lsbCBhbmQgdGhlIGJhciByZXNldHMuXG4vLyBXYXJyaW9yLCBHb2JsaW4gYW5kIEJhcmJhcmlhbiBoYXZlIHBhc3NpdmVzIG9ubHkgKG5vIG1hbmEpLlxuLy8gICBCYXJiYXJpYW4gICAgICAgICBGcmVuenkgICAgICBhdHRhY2tzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmdcblxuaW1wb3J0IHsgR1JJRF9DT0xTLCBHUklEX1JPV1MgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBjb25zdCBHUklEX1NQID0gMS4zOyAgICAgLy8gbWV0cmVzIGJldHdlZW4gZ3JpZCBjZWxsc1xuZXhwb3J0IGNvbnN0IEZST05UX1ggPSAxLjc7ICAgICAvLyBmcm9udCBsaW5lJ3MgZGlzdGFuY2UgZnJvbSB0aGUgY2VudHJlIGxpbmVcblxuZXhwb3J0IGludGVyZmFjZSBTbG90IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5cbi8qKiBXb3JsZCBwb3NpdGlvbiBvZiBhIGdyaWQgY2VsbCBmb3IgYSB0ZWFtICh0ZWFtIDAgPSBsZWZ0LCBmYWNlcyArWDsgdGVhbSAxID0gcmlnaHQsIGZhY2VzIC1YKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjZWxsUG9zKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpOiB7IHg6IG51bWJlcjsgejogbnVtYmVyIH0ge1xuICBjb25zdCByb3cgPSBNYXRoLmZsb29yKGNlbGwgLyBHUklEX0NPTFMpLCBjb2wgPSBjZWxsICUgR1JJRF9DT0xTO1xuICBjb25zdCBkZXB0aCA9IEdSSURfQ09MUyAtIDEgLSBjb2w7ICAgICAgICAgICAgICAgICAgICAgICAvLyAwID0gZnJvbnQgbGluZVxuICByZXR1cm4geyB4OiAoRlJPTlRfWCArIGRlcHRoICogR1JJRF9TUCkgKiAodGVhbSA9PT0gMCA/IC0xIDogMSksIHo6IChyb3cgLSAoR1JJRF9ST1dTIC0gMSkgLyAyKSAqIEdSSURfU1AgfTtcbn1cblxuY29uc3QgRlJPTlRORVNTOiBSZWNvcmQ8U291bElkLCBudW1iZXI+ID0geyBrbmlnaHQ6IDUsIG9ncmU6IDQsIHdhcnJpb3I6IDMsIGJhcmJhcmlhbjogMywgZ29ibGluOiAyLCBhcmNoZXI6IDAgfTtcbi8qKiBUaGUgZW5lbXkgYXJteSBpcyBwbGFjZWQgYXV0b21hdGljYWxseSAodGFua3MgdXAgZnJvbnQsIGFyY2hlcnMgYmVoaW5kKTsgdGhlIHBsYXllciBvbmx5IGV2ZXIgc2VlcyBpdHMgY29tcG9zaXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlDZWxscyhzcGVjczogU3BlY1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBjZWxsczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NPTFMgKiBHUklEX1JPV1M7IGMrKykgY2VsbHMucHVzaChjKTtcbiAgY2VsbHMuc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IGRhID0gR1JJRF9DT0xTIC0gMSAtIChhICUgR1JJRF9DT0xTKSwgZGIgPSBHUklEX0NPTFMgLSAxIC0gKGIgJSBHUklEX0NPTFMpO1xuICAgIGlmIChkYSAhPT0gZGIpIHJldHVybiBkYSAtIGRiO1xuICAgIHJldHVybiBNYXRoLmFicyhNYXRoLmZsb29yKGEgLyBHUklEX0NPTFMpIC0gMSkgLSBNYXRoLmFicyhNYXRoLmZsb29yKGIgLyBHUklEX0NPTFMpIC0gMSk7XG4gIH0pO1xuICBjb25zdCBvcmRlciA9IHNwZWNzLm1hcCgocywgaSkgPT4gaSkuc29ydCgoaSwgaikgPT4gRlJPTlRORVNTW3NwZWNzW2pdLnNvdWxdIC0gRlJPTlRORVNTW3NwZWNzW2ldLnNvdWxdKTtcbiAgY29uc3Qgb3V0ID0gbmV3IEFycmF5PG51bWJlcj4oc3BlY3MubGVuZ3RoKTtcbiAgb3JkZXIuZm9yRWFjaCgoaWR4LCBrKSA9PiB7IG91dFtpZHhdID0gY2VsbHNba107IH0pO1xuICByZXR1cm4gb3V0O1xufVxuXG5leHBvcnQgdHlwZSBGU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYWQnO1xuZXhwb3J0IGludGVyZmFjZSBGaWdodGVyIHtcbiAgaWQ6IG51bWJlcjsgdGVhbTogMCB8IDE7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7XG4gIHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc6IG51bWJlcjtcbiAgaHA6IG51bWJlcjsgbWF4SHA6IG51bWJlcjsgZG1nOiBudW1iZXI7IGludGVydmFsOiBudW1iZXI7IHJhbmdlOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IHJhZGl1czogbnVtYmVyO1xuICBhbGl2ZTogYm9vbGVhbjsgc3RhdGU6IEZTdGF0ZTtcbiAgdGFyZ2V0OiBudW1iZXI7IHJldGFyZ2V0QXQ6IG51bWJlcjsgZm9yY2VkVGFyZ2V0OiBudW1iZXI7IGZvcmNlZFVudGlsOiBudW1iZXI7XG4gIG5leHRBdHRhY2s6IG51bWJlcjsgYXR0YWNrU3RhcnQ6IG51bWJlcjsgYXR0YWNrRHVyOiBudW1iZXI7IGFuaW1TcGVlZDogbnVtYmVyOyBoaXREb25lOiBib29sZWFuO1xuICBtYW5hOiBudW1iZXI7IG1heE1hbmE6IG51bWJlcjsgY2FzdGluZzogYm9vbGVhbjsgZnJlbnp5OiBudW1iZXI7IGRlYWRBdDogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBCRXZlbnQgPVxuICB8IHsgdDogJ3N3aW5nJzsgaWQ6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2hpdCc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXI7IGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAnYXJyb3cnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdkZWF0aCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ2Nhc3QnOyBpZDogbnVtYmVyOyBza2lsbDogJ3NwbGl0JyB8ICd0YXVudCcgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICd0YXVudCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ3NtYXNoJzsgaWQ6IG51bWJlcjsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHI6IG51bWJlciB9XG4gIHwgeyB0OiAnZnJlbnp5JzsgaWQ6IG51bWJlcjsgc3RhY2tzOiBudW1iZXIgfTtcblxuZXhwb3J0IGNsYXNzIEJhdHRsZSB7XG4gIHRpbWUgPSAwO1xuICBmaWdodGVyczogRmlnaHRlcltdID0gW107XG4gIGV2ZW50czogQkV2ZW50W10gPSBbXTtcbiAgd2lubmVyOiAtMSB8IDAgfCAxID0gLTE7XG4gIHJuZzogUm5nO1xuICBwcml2YXRlIHBlbmRpbmc6IHsgYXQ6IG51bWJlcjsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlciB9W10gPSBbXTtcbiAgcHJpdmF0ZSBuZXh0SWQgPSAxO1xuICBwcml2YXRlIGZsaXAgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEpIHtcbiAgICB0aGlzLnJuZyA9IG1ha2VSbmcoc2VlZCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHBsYXllcnMpIHRoaXMuYWRkKDAsIHAuc291bCwgcC5zdGFyLCBwLmNlbGwpO1xuICAgIGNvbnN0IGNlbGxzID0gZW5lbXlDZWxscyhlbmVtaWVzKTtcbiAgICBlbmVtaWVzLmZvckVhY2goKGUsIGkpID0+IHRoaXMuYWRkKDEsIGUuc291bCwgZS5zdGFyLCBjZWxsc1tpXSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIpOiBGaWdodGVyIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW3NvdWxdLCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKTtcbiAgICBjb25zdCBocCA9IHN0LmhwICogQi5zdGFyLmhwW3N0YXIgLSAxXTtcbiAgICBjb25zdCBmOiBGaWdodGVyID0ge1xuICAgICAgaWQ6IHRoaXMubmV4dElkKyssIHRlYW0sIHNvdWwsIHN0YXIsIGNlbGwsIHg6IHAueCwgejogcC56LCB5YXc6IHRlYW0gPT09IDAgPyAwIDogTWF0aC5QSSxcbiAgICAgIGhwLCBtYXhIcDogaHAsIGRtZzogc3QuZG1nICogQi5zdGFyLmRtZ1tzdGFyIC0gMV0sIGludGVydmFsOiBzdC5pbnRlcnZhbCwgcmFuZ2U6IHN0LnJhbmdlLCBzcGVlZDogc3Quc3BlZWQsIHJhZGl1czogc3Quc2l6ZSAqIEIuc3Rhci5zY2FsZVtzdGFyIC0gMV0sXG4gICAgICBhbGl2ZTogdHJ1ZSwgc3RhdGU6ICdpZGxlJywgdGFyZ2V0OiAtMSwgcmV0YXJnZXRBdDogMCwgZm9yY2VkVGFyZ2V0OiAtMSwgZm9yY2VkVW50aWw6IDAsXG4gICAgICBuZXh0QXR0YWNrOiB0aGlzLnJuZy5uZXh0KCkgKiAwLjMsIGF0dGFja1N0YXJ0OiAtOSwgYXR0YWNrRHVyOiAxLCBhbmltU3BlZWQ6IDEsIGhpdEZyYWM6IDAsIGhpdERvbmU6IHRydWUsXG4gICAgICBtYW5hOiAwLCBtYXhNYW5hOiBCLm1hbmFbc291bF0/Lm1heCA/PyAwLCBjYXN0aW5nOiBmYWxzZSwgZnJlbnp5OiAwLCBkZWFkQXQ6IDAsXG4gICAgfSBhcyBGaWdodGVyO1xuICAgIHRoaXMuZmlnaHRlcnMucHVzaChmKTsgcmV0dXJuIGY7XG4gIH1cblxuICBieUlkKGlkOiBudW1iZXIpOiBGaWdodGVyIHwgdW5kZWZpbmVkIHsgcmV0dXJuIGlkIDwgMCA/IHVuZGVmaW5lZCA6IHRoaXMuZmlnaHRlcnNbaWQgLSAxXTsgfVxuICBmb2VzKGY6IEZpZ2h0ZXIpOiBGaWdodGVyW10geyByZXR1cm4gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgby50ZWFtICE9PSBmLnRlYW0pOyB9XG4gIGNvdW50KHRlYW06IDAgfCAxKTogbnVtYmVyIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMucmVkdWNlKChuLCBmKSA9PiBuICsgKGYuYWxpdmUgJiYgZi50ZWFtID09PSB0ZWFtID8gMSA6IDApLCAwKTsgfVxuICBkcmFpbigpOiBCRXZlbnRbXSB7IGNvbnN0IGUgPSB0aGlzLmV2ZW50czsgdGhpcy5ldmVudHMgPSBbXTsgcmV0dXJuIGU7IH1cblxuICBzdGVwKGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy53aW5uZXIgPj0gMCkgcmV0dXJuO1xuICAgIHRoaXMudGltZSArPSBkdDsgdGhpcy5mbGlwID0gIXRoaXMuZmxpcDtcbiAgICAvLyBhcnJvd3MgdGhhdCBoYXZlIGZpbmlzaGVkIGZseWluZ1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnBlbmRpbmcubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBlbmRpbmdbaV07XG4gICAgICBpZiAodGhpcy50aW1lID49IHAuYXQpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnNwbGljZShpLCAxKTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLmJ5SWQocC50byksIGZyb20gPSB0aGlzLmJ5SWQocC5mcm9tKTtcbiAgICAgICAgaWYgKHRvICYmIHRvLmFsaXZlICYmIGZyb20pIHRoaXMuZGFtYWdlKHRvLCBwLmRtZywgZnJvbSwgJ2Fycm93Jyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG9yZGVyID0gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAodGhpcy5mbGlwKSBvcmRlci5yZXZlcnNlKCk7XG4gICAgZm9yIChjb25zdCBmIG9mIG9yZGVyKSBpZiAoZi5hbGl2ZSkgdGhpcy51cGRhdGUoZiwgZHQpO1xuICAgIGNvbnN0IGEgPSB0aGlzLmNvdW50KDApLCBiID0gdGhpcy5jb3VudCgxKTtcbiAgICBpZiAoIWEgfHwgIWIpIHRoaXMud2lubmVyID0gYSA/IDAgOiAxO1xuICAgIGVsc2UgaWYgKHRoaXMudGltZSA+PSBCQUxBTkNFLnNpbS50aW1lTGltaXQpIHtcbiAgICAgIGNvbnN0IGhwID0gKHQ6IDAgfCAxKSA9PiB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHQpLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKTtcbiAgICAgIHRoaXMud2lubmVyID0gaHAoMCkgPiBocCgxKSA/IDAgOiAxO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwZXItZmlnaHRlciB1cGRhdGVcbiAgcHJpdmF0ZSB1cGRhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTtcbiAgICB0aGlzLnNlcGFyYXRlKGYsIGR0KTtcblxuICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykge1xuICAgICAgY29uc3QgdCA9IHRoaXMudGltZSAtIGYuYXR0YWNrU3RhcnQ7XG4gICAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7IGlmICh0ZyAmJiB0Zy5hbGl2ZSkgdGhpcy5mYWNlKGYsIHRnLnggLSBmLngsIHRnLnogLSBmLnosIGR0KTtcbiAgICAgIGlmICghZi5oaXREb25lICYmIHQgPj0gZi5hdHRhY2tEdXIgKiBzdC5oaXRGcmFjKSB7IGYuaGl0RG9uZSA9IHRydWU7IHRoaXMucmVzb2x2ZUhpdChmKTsgfVxuICAgICAgaWYgKHQgPj0gZi5hdHRhY2tEdXIpIGYuc3RhdGUgPSAnaWRsZSc7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYWNxdWlyZShmKTtcbiAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgcmV0dXJuOyB9XG4gICAgY29uc3QgZHggPSB0Zy54IC0gZi54LCBkeiA9IHRnLnogLSBmLnosIGRpc3QgPSBNYXRoLmh5cG90KGR4LCBkeik7XG4gICAgdGhpcy5mYWNlKGYsIGR4LCBkeiwgZHQpO1xuICAgIGlmIChkaXN0IDw9IGYucmFuZ2UpIHtcbiAgICAgIGlmICh0aGlzLnRpbWUgPj0gZi5uZXh0QXR0YWNrKSB0aGlzLnN0YXJ0QXR0YWNrKGYpOyBlbHNlIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmLnN0YXRlID0gJ3J1bic7IGNvbnN0IGsgPSBmLnNwZWVkICogZHQgLyBNYXRoLm1heChkaXN0LCAxZS00KTsgZi54ICs9IGR4ICogazsgZi56ICs9IGR6ICogazsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICBwcml2YXRlIHNlcGFyYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBsZXQgcHggPSAwLCBweiA9IDA7XG4gICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZmlnaHRlcnMpIHtcbiAgICAgIGlmIChvID09PSBmIHx8ICFvLmFsaXZlKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGR4ID0gZi54IC0gby54LCBkeiA9IGYueiAtIG8ueiwgbSA9IE1hdGguaHlwb3QoZHgsIGR6KSwgd2FudCA9IChmLnJhZGl1cyArIG8ucmFkaXVzKSAqIDEuMDUgKyAwLjA4O1xuICAgICAgaWYgKG0gPj0gd2FudCkgY29udGludWU7XG4gICAgICBjb25zdCBrID0gKHdhbnQgLSBtKSAvIE1hdGgubWF4KG0sIDFlLTMpOyBweCArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR4KSAqIGs7IHB6ICs9IChtIDwgMWUtMyA/ICh0aGlzLnJuZy5uZXh0KCkgLSAwLjUpIDogZHopICogaztcbiAgICB9XG4gICAgY29uc3QgcyA9IE1hdGgubWluKDEsIGR0ICogNik7IGYueCArPSBweCAqIHM7IGYueiArPSBweiAqIHM7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgZi5yZXRhcmdldEF0ID0gdGhpcy50aW1lICsgQkFMQU5DRS5zaW0ucmV0YXJnZXRFdmVyeSAqICgwLjggKyAwLjQgKiB0aGlzLnJuZy5uZXh0KCkpO1xuICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZik7IGlmICghZm9lcy5sZW5ndGgpIHsgZi50YXJnZXQgPSAtMTsgcmV0dXJuOyB9XG4gICAgbGV0IGJlc3QgPSBmb2VzWzBdLCBicyA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgbyBvZiBmb2VzKSB7XG4gICAgICBsZXQgc2NvcmUgPSBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KTtcbiAgICAgIGlmIChmLnNvdWwgPT09ICdnb2JsaW4nKSB7XG4gICAgICAgIC8vIGtpbGwtc3RlYWw6IHByZWZlciBuZWFyYnkgZW5lbWllcyBhbHJlYWR5IGZpZ2h0aW5nIG9uZSBvZiBvdXIgYWxsaWVzLCBhbmQgd291bmRlZCBvbmVzXG4gICAgICAgIGNvbnN0IGVuZ2FnZWQgPSB0aGlzLmJ5SWQoby50YXJnZXQpOyBjb25zdCBidXN5ID0gISFlbmdhZ2VkICYmIGVuZ2FnZWQuYWxpdmUgJiYgZW5nYWdlZC50ZWFtID09PSBmLnRlYW0gJiYgZW5nYWdlZC5pZCAhPT0gZi5pZDtcbiAgICAgICAgaWYgKGJ1c3kgJiYgc2NvcmUgPCBCQUxBTkNFLm9wcG9ydHVuaXN0LnNlZWtSYWRpdXMgKyAyKSBzY29yZSAtPSAzO1xuICAgICAgICBzY29yZSAtPSBCQUxBTkNFLm9wcG9ydHVuaXN0LndvdW5kZWRXZWlnaHQgKiAoMSAtIG8uaHAgLyBvLm1heEhwKTtcbiAgICAgIH1cbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzApOiB7IHdpbm5lcjogMCB8IDE7IHRpbWU6IG51bWJlcjsgbGVmdDogbnVtYmVyOyBocExlZnQ6IG51bWJlciB9IHtcbiAgY29uc3QgYiA9IG5ldyBCYXR0bGUocGxheWVycywgZW5lbWllcywgc2VlZCk7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgIi8vIEVuZW15IHdhdmVzLiBTYW1lIHVuaXQgcG9vbCBhcyB0aGUgcGxheWVyLiBUaGUgYnVpbGQgc2NyZWVuIHByZXZpZXdzIHRoZSBDT01QT1NJVElPTiBvbmx5LCBuZXZlciBwb3NpdGlvbnMuXG5cbmltcG9ydCB7IENPU1QsIENVUlZFUywgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBFbmVteVNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5cbmNvbnN0IExFVFRFUjogUmVjb3JkPHN0cmluZywgU291bElkPiA9IHsgVzogJ3dhcnJpb3InLCBBOiAnYXJjaGVyJywgRzogJ2dvYmxpbicsIEs6ICdrbmlnaHQnLCBPOiAnb2dyZScsIEI6ICdiYXJiYXJpYW4nIH07XG5jb25zdCBwYXJzZVdhdmUgPSAoczogc3RyaW5nKTogRW5lbXlTcGVjW10gPT4gcy5zcGxpdCgnICcpLm1hcCgodCkgPT4gKHsgc291bDogTEVUVEVSW3RbMF1dLCBzdGFyOiArdFsxXSB9KSk7XG5cbi8qKlxuICogRGlmZmljdWx0eSBwcmVzZXRzIGZvciB0aGUgMy13YXZlIHByb3RvdHlwZSAoVyB3YXJyaW9yLCBBIGFyY2hlciwgRyBnb2JsaW4sIEsga25pZ2h0LCBPIG9ncmU7IGRpZ2l0ID0gc3RhcnMpLlxuICogTWVhc3VyZWQgd2l0aCBzaW0vdHVuZV93YXZlcy50cyBhZ2FpbnN0IHN0YW5kLWluIHBsYXllcnMgKGNvbXBldGVudCAvIGNhcmVsZXNzKSwgc3RhZ2UtY2xlYXIgcmF0ZTpcbiAqICAgZWFzeSAgIH4xMDAlIC8gfjkwJSAgICAgIG5vcm1hbCB+OTQlIC8gfjUxJSAgICAgIGhhcmQgfjc1JSAvIH4yNiVcbiAqIEEgcmVhbCBodW1hbiBvbiBhIHBob25lIGlzIG11Y2ggbGVzcyBjYXJlZnVsIHRoYW4gdGhlIGNvbXBldGVudCBzdGFuZC1pbiwgc28gXCJub3JtYWxcIiBpcyB0aGUgZGVmYXVsdC5cbiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFk6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMScsICdLMSBXMScsICdPMSBXMSBHMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEnLCAnTzEgQTEgRzEgVzEnXSxcbiAgaGFyZDogWydXMSBBMScsICdLMSBHMSBXMSBBMScsICdPMSBBMSBHMSBXMSddLFxufTtcbmV4cG9ydCBsZXQgZGlmZmljdWx0eU5hbWUgPSAnbm9ybWFsJztcblxuLyoqIEhhbmQtYXV0aG9yZWQgb3BlbmluZyB3YXZlcyAocHJvdG90eXBlIHN0YWdlIGlzIDMgd2F2ZXMpLiBCdWRnZXRzIH4gdGhlIHBsYXllcidzIGNhcCBhdCB0aGF0IHdhdmUuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXREaWZmaWN1bHR5LiAqL1xuZXhwb3J0IGNvbnN0IEFVVEhPUkVEOiBFbmVteVNwZWNbXVtdID0gRElGRklDVUxUWS5ub3JtYWwubWFwKHBhcnNlV2F2ZSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXREaWZmaWN1bHR5KG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIURJRkZJQ1VMVFlbbmFtZV0pIHJldHVybjtcbiAgZGlmZmljdWx0eU5hbWUgPSBuYW1lOyBBVVRIT1JFRC5sZW5ndGggPSAwOyBESUZGSUNVTFRZW25hbWVdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG5cbmV4cG9ydCBjb25zdCB3YXZlQ29zdCA9ICh3OiBFbmVteVNwZWNbXSk6IG51bWJlciA9PiB3LnJlZHVjZSgobiwgZSkgPT4gbiArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXSwgMCk7XG5cbi8qKiBFbmVteSBhcm15IGZvciBhIHdhdmUgKDEtYmFzZWQpLiBXYXZlcyBwYXN0IHRoZSBhdXRob3JlZCBvbmVzIGFyZSBnZW5lcmF0ZWQgZnJvbSBhIGZpeGVkIHNlZWQgc28gcmV0cmllcyBmYWNlIHRoZSBzYW1lIGFybXkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlXYXZlKHdhdmU6IG51bWJlciwgc3RhZ2VTZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgaWYgKHdhdmUgPD0gQVVUSE9SRUQubGVuZ3RoKSByZXR1cm4gQVVUSE9SRURbd2F2ZSAtIDFdLm1hcCgoZSkgPT4gKHsgLi4uZSB9KSk7XG4gIGNvbnN0IGNhcCA9IENVUlZFUy5kb2NbTWF0aC5taW4od2F2ZSwgQ1VSVkVTLmRvYy5sZW5ndGgpIC0gMV07XG4gIGNvbnN0IGJ1ZGdldCA9IE1hdGgucm91bmQoY2FwICogMC45Mik7XG4gIGNvbnN0IHJuZyA9IG1ha2VSbmcoc3RhZ2VTZWVkICogMTAwOSArIHdhdmUgKiA3OTE5KTtcbiAgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA0MCAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2soU09VTFMpO1xuICAgIGxldCBzdGFyID0gMTtcbiAgICBpZiAocm5nLm5leHQoKSA8IDAuMzUgJiYgQ09TVFtzb3VsXVsxXSA8PSBsZWZ0KSBzdGFyID0gMjtcbiAgICBpZiAod2F2ZSA+PSA2ICYmIHJuZy5uZXh0KCkgPCAwLjI1ICYmIENPU1Rbc291bF1bMl0gPD0gbGVmdCkgc3RhciA9IDM7XG4gICAgY29uc3QgYyA9IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICAgIGlmIChjIDw9IGxlZnQgJiYgYXJteS5sZW5ndGggPCAxMikgeyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IGM7IH1cbiAgfVxuICByZXR1cm4gYXJteTtcbn1cblxuLyoqIFdoYXQgdGhlIGJ1aWxkIHNjcmVlbiBzaG93czogY291bnRzIHBlciBTb3VsIGFuZCBzdGFyLCBubyBwb3NpdGlvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcHJldmlld1RleHQodzogRW5lbXlTcGVjW10pOiB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH1bXSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXA8c3RyaW5nLCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH0+KCk7XG4gIGZvciAoY29uc3QgZSBvZiB3KSB7XG4gICAgY29uc3QgayA9IGUuc291bCArIGUuc3RhcjtcbiAgICBjb25zdCBjdXIgPSBtYXAuZ2V0KGspO1xuICAgIGlmIChjdXIpIGN1ci5jb3VudCsrOyBlbHNlIG1hcC5zZXQoaywgeyBzb3VsOiBlLnNvdWwsIHN0YXI6IGUuc3RhciwgY291bnQ6IDEgfSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldO1xufVxuIiwgImltcG9ydCB7IENVUlZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuLyoqXG4gKiBSdWxlcyBmb3IgdGhlIHBsYXlhYmxlIDMtd2F2ZSBwcm90b3R5cGU6IGRvYyBEb21pbmlvbiBjdXJ2ZSwgYm9udXMgZHJhdyBvbmx5IG9uIHRoZSBlYXJseSB3YXZlcy5cbiAqIG1lcmdlICdoYW5kSW50b09uZVN0YXInOiBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIG1lcmdlIHN0cmFpZ2h0IGludG8gYSBtYXRjaGluZyBkZXBsb3llZCAxLXN0YXIgdW5pdCAocGF5aW5nIG9ubHkgdGhlIGNvc3RcbiAqIGRpZmZlcmVuY2UpLiBXaXRob3V0IGl0IHRoZSBjYXAgY2FuIGJsb2NrIGEgbWVyZ2UgeW91IGNvdWxkIGFmZm9yZCAoeW91IHdvdWxkIG5lZWQgcm9vbSB0byBzdW1tb24gQk9USCBjb3BpZXMgZmlyc3QpLlxuICogVGhlIGRlYnVnIHBhbmVsIGNhbiBzd2l0Y2ggdGhpcyBiYWNrIHRvIHRoZSBkb2MncyBkZXBsb3llZC1vbmx5IHJ1bGUuXG4gKi9cbmV4cG9ydCBjb25zdCBQUk9UT1RZUEVfUlVMRVM6IFJ1bGVzID0geyBjdXJ2ZTogQ1VSVkVTLmRvYy5zbGljZSgwLCAzKSwgbWVyZ2U6ICdoYW5kSW50b09uZVN0YXInLCBzdGFnZVdhdmVzOiAzLCBub3JtYWxEcmF3V2F2ZXM6IFsyLCAzLCA0LCA1XSB9O1xuIiwgIi8vIFRoZSBwbGF5ZXIncyBzYXZlZCBwcm9ncmVzcy4gRnJhbWV3b3JrLWZyZWUgc28gdGhlIGdhbWUgYnVuZGxlIGFuZCB0aGUgbmF2aWdhdGlvbiBzaGVsbCBib3RoIHVzZSBpdC5cbi8vIFN0b3JlZCBpbiBsb2NhbFN0b3JhZ2UgYXMgSlNPTi4gRXZlcnkgcmVhZC93cml0ZSBpcyBndWFyZGVkOiBwcml2YXRlIHdpbmRvd3MgYW5kIGJsb2NrZWQgc3RvcmFnZSBtdXN0IG5ldmVyIGJyZWFrIHRoZSBnYW1lLlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBjb25zdCBERUNLX1NJWkUgPSA2OyAgICAgICAgICAgICAgICAgICAgIC8vIGRvYzogc2l4IGVxdWlwcGVkIFNvdWxzIHBlciBzdGFnZVxuY29uc3QgS0VZID0gJ25lY3JvLXNhdmUnO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU291bFByb2dyZXNzIHsgbGV2ZWw6IG51bWJlcjsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTYXZlIHtcbiAgdjogbnVtYmVyO1xuICBkZWNrOiBTb3VsSWRbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXF1aXBwZWQgU291bHMsIGF0IG1vc3QgREVDS19TSVpFLCBhdCBsZWFzdCAxXG4gIHNvdWxzOiBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+OyAgICAgICAgICAvLyBQTEFDRUhPTERFUiBwcm9ncmVzc2lvbiB1bnRpbCBwYWNrcyBleGlzdFxufVxuZXhwb3J0IGludGVyZmFjZSBTdG9yZSB7IGdldEl0ZW0oazogc3RyaW5nKTogc3RyaW5nIHwgbnVsbDsgc2V0SXRlbShrOiBzdHJpbmcsIHY6IHN0cmluZyk6IHZvaWQgfVxuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFNhdmUoKTogU2F2ZSB7XG4gIGNvbnN0IHNvdWxzID0ge30gYXMgUmVjb3JkPFNvdWxJZCwgU291bFByb2dyZXNzPjtcbiAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykgc291bHNbaWRdID0geyBsZXZlbDogMSwgY29waWVzOiAwIH07XG4gIHJldHVybiB7IHY6IFZFUlNJT04sIGRlY2s6IFNPVUxTLnNsaWNlKDAsIERFQ0tfU0laRSksIHNvdWxzIH07XG59XG5cbmZ1bmN0aW9uIGJyb3dzZXJTdG9yZSgpOiBTdG9yZSB8IG51bGwgeyB0cnkgeyByZXR1cm4gdHlwZW9mIGxvY2FsU3RvcmFnZSA9PT0gJ3VuZGVmaW5lZCcgPyBudWxsIDogbG9jYWxTdG9yYWdlOyB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH0gfVxuXG4vKiogUmVwYWlyIHdoYXRldmVyIHdhcyBzdG9yZWQ6IHVua25vd24gU291bHMgZHJvcHBlZCwgZHVwbGljYXRlcyByZW1vdmVkLCBkZWNrIGNhcHBlZCwgbm90aGluZyBlbXB0eS4gT2xkIHZlcnNpb25zIGtlZXAgdGhlaXIgcHJvZ3Jlc3MuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemUocmF3OiBhbnkpOiBTYXZlIHtcbiAgY29uc3QgYmFzZSA9IGRlZmF1bHRTYXZlKCk7XG4gIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09ICdvYmplY3QnKSByZXR1cm4gYmFzZTtcbiAgY29uc3QgZGVjazogU291bElkW10gPSBbXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LmRlY2spKSBmb3IgKGNvbnN0IGQgb2YgcmF3LmRlY2spIGlmIChTT1VMUy5pbmNsdWRlcyhkKSAmJiAhZGVjay5pbmNsdWRlcyhkKSAmJiBkZWNrLmxlbmd0aCA8IERFQ0tfU0laRSkgZGVjay5wdXNoKGQpO1xuICBpZiAoZGVjay5sZW5ndGgpIGJhc2UuZGVjayA9IGRlY2s7XG4gIGlmIChyYXcuc291bHMgJiYgdHlwZW9mIHJhdy5zb3VscyA9PT0gJ29iamVjdCcpIHtcbiAgICBmb3IgKGNvbnN0IGlkIG9mIFNPVUxTKSB7XG4gICAgICBjb25zdCBwID0gcmF3LnNvdWxzW2lkXTtcbiAgICAgIGlmIChwICYmIE51bWJlci5pc0Zpbml0ZShwLmxldmVsKSAmJiBOdW1iZXIuaXNGaW5pdGUocC5jb3BpZXMpKSBiYXNlLnNvdWxzW2lkXSA9IHsgbGV2ZWw6IE1hdGgubWF4KDEsIE1hdGguZmxvb3IocC5sZXZlbCkpLCBjb3BpZXM6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IocC5jb3BpZXMpKSB9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gYmFzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRTYXZlKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IFNhdmUge1xuICB0cnkgeyBjb25zdCB0ID0gc3RvcmUgJiYgc3RvcmUuZ2V0SXRlbShLRVkpOyByZXR1cm4gc2FuaXRpemUodCA/IEpTT04ucGFyc2UodCkgOiBudWxsKTsgfSBjYXRjaCB7IHJldHVybiBkZWZhdWx0U2F2ZSgpOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZVNhdmUoc2F2ZTogU2F2ZSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogdm9pZCB7XG4gIHRyeSB7IGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksIEpTT04uc3RyaW5naWZ5KHNhdmUpKTsgfSBjYXRjaCB7IC8qIHN0b3JhZ2UgZnVsbCBvciBibG9ja2VkOiBrZWVwIHBsYXlpbmcgKi8gfVxufVxuIiwgIi8vIEV2ZXJ5dGhpbmcgeW91IFNFRSBmb3IgYSB1bml0OiByZWFsIFRyaXBvIG1vZGVscyAoU2tlbGV0b24gV2FycmlvciwgU2tlbGV0b24gQXJjaGVyKSwgc2ltcGxlIHN0YW5kLWlucyBmb3IgdGhlIGZvdXJcbi8vIGNoYXJhY3RlcnMgdGhhdCBhcmUgbm90IGdlbmVyYXRlZCB5ZXQsIGFuZCB0aGUgXCJzdGFyIGxvb2tcIiBsYXllcmVkIG9uIHRvcCBvZiBib3RoIChzaXplLCB0aW50LCBhdXJhLCBoYWxvLCBiYWRnZSkuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuXG5leHBvcnQgdHlwZSBWU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYXRoJyB8ICdzcGF3bicgfCAnY2hlZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb24gKyB5YXcgaGVyZVxuICB0ZWFtOiAwIHwgMTsgc3RhcjogbnVtYmVyOyBzdGF0ZTogVlN0YXRlOyB0b3A6IG51bWJlcjtcbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZD86IG51bWJlcik6IHZvaWQ7XG4gIHNldFN0YXIoc3RhcjogbnVtYmVyKTogdm9pZDtcbiAgc2V0VGVhbSh0ZWFtOiAwIHwgMSk6IHZvaWQ7XG4gIHNldEhwKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAgLy8gbnVsbCBoaWRlcyB0aGUgaGVhbHRoIGJhclxuICBzZXRNYW5hKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAvLyBudWxsIGhpZGVzIHRoZSBtYW5hIGJhciAodW5pdHMgd2l0aG91dCBhIHNraWxsKVxuICBwdWxzZSgpOiB2b2lkOyAgICAgICAgICAgICAgICAgICAgIC8vIGJyaWVmIGhpdCByZWFjdGlvblxuICB1cGRhdGUoZHQ6IG51bWJlcik6IHZvaWQ7XG4gIGRpc3Bvc2UoKTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFyIGxvb2tzXG4vLyAxIHN0YXIgPSB0aGUgcGxhaW4gbW9kZWwuIDIgc3RhcnMgPSBhIGxpdHRsZSBiaWdnZXIsIGNvb2wgc2lsdmVyLWJsdWUgdGludCwgYnJpZ2h0ZXIgYXVyYS4gMyBzdGFycyA9IGJpZ2dlc3QsIHdhcm0gZ29sZCB0aW50LFxuLy8gc3Ryb25nIGdvbGQtdmlvbGV0IGF1cmEgYW5kIGEgZmxvYXRpbmcgZ29sZCBoYWxvLiBFdmVyeXRoaW5nIGhlcmUgaXMgZnJlZTogbm8gZXh0cmEgVHJpcG8gZ2VuZXJhdGlvbnMuXG5jb25zdCBUSU5UOiBudW1iZXJbXVtdID0gW1sxLCAxLCAxXSwgWzAuODYsIDAuOTUsIDEuMThdLCBbMS4yNSwgMS4xLCAwLjddXTtcbmNvbnN0IEFVUkEgPSBbXG4gIHsgcmF0ZTogMTQsIG1pbjogMC4wNiwgbWF4OiAwLjE2LCBjMTogWzAuNzgsIDAuMzUsIDEsIDAuN10sIGMyOiBbMC40NSwgMC4xNSwgMC45LCAwLjVdIH0sXG4gIHsgcmF0ZTogMjYsIG1pbjogMC4wOCwgbWF4OiAwLjIwLCBjMTogWzAuODUsIDAuNjUsIDEsIDAuOF0sIGMyOiBbMC41NSwgMC40LCAxLCAwLjZdIH0sXG4gIHsgcmF0ZTogNDQsIG1pbjogMC4xMCwgbWF4OiAwLjI2LCBjMTogWzEsIDAuODUsIDAuNCwgMC44NV0sIGMyOiBbMC44LCAwLjMsIDEsIDAuN10gfSxcbl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRzIHtcbiAgc2NlbmU6IGFueTsgc29mdDogYW55OyBzdGFyVGV4OiBhbnlbXTsgdHJpcG86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgVHJpcG9DZmc+PjtcbiAgcmluZ01hdDogYW55W107IGhhbG9NYXQ6IGFueTsgYmFyQmc6IGFueTsgYmFyRmlsbDogYW55W107IG1hbmFGaWxsOiBhbnk7XG59XG5pbnRlcmZhY2UgVHJpcG9DZmcgeyBjb250YWluZXI6IGFueTsgZW5lbXlUZXg6IGFueTsgY2xpcHM6IFJlY29yZDxWU3RhdGUsIHN0cmluZz47IG1hdENhY2hlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+OyBiYXNlTWF0PzogYW55OyB0b3A6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9XG5cbmZ1bmN0aW9uIGR5bihzY2VuZTogYW55LCB3OiBudW1iZXIsIGg6IG51bWJlciwgZHJhdzogKGM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCkgPT4gdm9pZCwgYWxwaGEgPSB0cnVlKSB7XG4gIGNvbnN0IHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnZHQnLCB7IHdpZHRoOiB3LCBoZWlnaHQ6IGggfSwgc2NlbmUsIHRydWUpOyBkcmF3KHQuZ2V0Q29udGV4dCgpKTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IGFscGhhOyByZXR1cm4gdDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRBc3NldHMoc2NlbmU6IGFueSk6IFByb21pc2U8QXNzZXRzPiB7XG4gIGNvbnN0IHNvZnQgPSBkeW4oc2NlbmUsIDY0LCA2NCwgKGMpID0+IHsgY29uc3QgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwuNTUpJyk7IGcuYWRkQ29sb3JTdG9wKDEsICdyZ2JhKDI1NSwyNTUsMjU1LDApJyk7IGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCA2NCwgNjQpOyB9KTtcbiAgY29uc3Qgc3RhclRleCA9IFsxLCAyLCAzXS5tYXAoKG4pID0+IGR5bihzY2VuZSwgMTkyLCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgNDBweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVN0eWxlID0gJyMxYTEwMjAnOyBjLmZpbGxTdHlsZSA9IG4gPT09IDMgPyAnI2ZmZDI0YScgOiBuID09PSAyID8gJyNkN2U2ZmYnIDogJyNmMGQ5YTAnOyBjb25zdCBzID0gJ1x1MjYwNScucmVwZWF0KG4pOyBjLnN0cm9rZVRleHQocywgOTYsIDM4KTsgYy5maWxsVGV4dChzLCA5NiwgMzgpOyB9KSk7XG4gIGNvbnN0IGVtaXNzaXZlID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdlbScsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IGE7IHJldHVybiBtOyB9O1xuICBjb25zdCBBOiBBc3NldHMgPSB7XG4gICAgc2NlbmUsIHNvZnQsIHN0YXJUZXgsIHRyaXBvOiB7fSwgcmluZ01hdDogW2VtaXNzaXZlKDAuNTUsIDAuMiwgMC45NSwgMC45KSwgZW1pc3NpdmUoMC45NSwgMC4yNSwgMC4yLCAwLjkpXSwgaGFsb01hdDogZW1pc3NpdmUoMSwgMC44MiwgMC4zLCAwLjk1KSxcbiAgICBiYXJCZzogZW1pc3NpdmUoMC4wNSwgMC4wNSwgMC4wOCwgMC43KSwgYmFyRmlsbDogW2VtaXNzaXZlKDAuNTUsIDAuMzUsIDEpLCBlbWlzc2l2ZSgxLCAwLjQsIDAuMyldLCBtYW5hRmlsbDogZW1pc3NpdmUoMC4yNSwgMC43NSwgMSksXG4gIH07XG4gIGNvbnN0IGRlZnM6IFtTb3VsSWQsIHN0cmluZywgc3RyaW5nLCBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+LCBudW1iZXIsIG51bWJlcl1bXSA9IFtcbiAgICBbJ3dhcnJpb3InLCAnc2tlbGV0b25fd2Fycmlvci5nbGInLCAnc2tlbGV0b25fd2Fycmlvcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0Jsb2NrJyB9LCAxLjA1LCAxLjBdLFxuICAgIFsnYXJjaGVyJywgJ1NrZWxldG9uQXJjaGVyLmdsYicsICdTa2VsZXRvbkFyY2hlcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnU2hvb3QnLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnRmxleCcgfSwgMS4wNSwgMS4wXSxcbiAgXTtcbiAgYXdhaXQgUHJvbWlzZS5hbGwoZGVmcy5tYXAoYXN5bmMgKFtzb3VsLCBnbGIsIGVuZW15LCBjbGlwcywgdG9wLCBzY2FsZV0pID0+IHtcbiAgICBjb25zdCBjb250YWluZXIgPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgZ2xiLCBzY2VuZSk7XG4gICAgQS50cmlwb1tzb3VsXSA9IHsgY29udGFpbmVyLCBlbmVteVRleDogbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBlbmVteSwgc2NlbmUsIGZhbHNlLCBmYWxzZSksIGNsaXBzLCBtYXRDYWNoZToge30sIHRvcCwgc2NhbGUgfTtcbiAgfSkpO1xuICByZXR1cm4gQTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzaGFyZWQgZGVjb3JhdGlvblxuY2xhc3MgRGVjbyB7XG4gIHByaXZhdGUgcHM6IGFueSA9IG51bGw7IHByaXZhdGUgaGFsbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBiYWRnZTogYW55OyBwcml2YXRlIHN0YXJzOiBhbnk7IHByaXZhdGUgZmlsbDogYW55OyBwcml2YXRlIGJhcjogYW55OyBwcml2YXRlIG1iZzogYW55OyBwcml2YXRlIG1maWxsOiBhbnk7IHByaXZhdGUgcmluZzogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBwYXJlbnQ6IGFueSwgcHJpdmF0ZSB0b3A6IG51bWJlciwgcHJpdmF0ZSByYWRpdXM6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lO1xuICAgIHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygncmluZycsIHsgcmFkaXVzOiBNYXRoLm1heCgwLjMsIHJhZGl1cyAqIDEuMTUpLCB0ZXNzZWxsYXRpb246IDI2IH0sIHMpOyB0aGlzLnJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0aGlzLnJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHRoaXMucmluZy5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMucmluZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYWRnZSA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2JhZGdlJywgcyk7IHRoaXMuYmFkZ2UucGFyZW50ID0gcGFyZW50OyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0b3AgKyAwLjMyOyB0aGlzLmJhZGdlLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgdGhpcy5zdGFycyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3N0YXJzJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMTUgfSwgcyk7IHRoaXMuc3RhcnMucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5zdGFycy5wb3NpdGlvbi55ID0gMC4xMTsgdGhpcy5zdGFycy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzbScsIHMpOyBzbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgc20uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgc20udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB0aGlzLnN0YXJzLm1hdGVyaWFsID0gc207ICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtID0gc207XG4gICAgY29uc3QgYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdiZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA4NSB9LCBzKTsgYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgYmcubWF0ZXJpYWwgPSBBLmJhckJnOyBiZy5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMuYmFyID0gYmc7XG4gICAgdGhpcy5maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuZmlsbC5wb3NpdGlvbi56ID0gLTAuMDAyOyB0aGlzLmZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWJnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMubWJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWJnLnBvc2l0aW9uLnkgPSAtMC4wNzsgdGhpcy5tYmcubWF0ZXJpYWwgPSBBLmJhckJnOyB0aGlzLm1iZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21maWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjAzIH0sIHMpOyB0aGlzLm1maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWZpbGwucG9zaXRpb24uc2V0KDAsIC0wLjA3LCAtMC4wMDIpOyB0aGlzLm1maWxsLm1hdGVyaWFsID0gQS5tYW5hRmlsbDsgdGhpcy5tZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYXIuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuZmlsbC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tYmcuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgc2V0KHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5BLnNjZW5lLCBjZmcgPSBBVVJBW3N0YXIgLSAxXTtcbiAgICAodGhpcy5zdGFycyBhcyBhbnkpLl9zbS5kaWZmdXNlVGV4dHVyZSA9IHRoaXMuQS5zdGFyVGV4W3N0YXIgLSAxXTtcbiAgICB0aGlzLnJpbmcubWF0ZXJpYWwgPSB0aGlzLkEucmluZ01hdFt0ZWFtXTsgdGhpcy5maWxsLm1hdGVyaWFsID0gdGhpcy5BLmJhckZpbGxbdGVhbV07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJhaXNlZCBieSB0aGUgTmVjcm9tYW5jZXI6IHB1cnBsZSBhdXJhIHRoYXQgZ3Jvd3Mgd2l0aCBzdGFyc1xuICAgICAgaWYgKCF0aGlzLnBzKSB7XG4gICAgICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2F1cmEnLCA3MCwgcyk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5wYXJlbnQ7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIHRoaXMudG9wICogMC41LCAwLjIpO1xuICAgICAgICBwcy5taW5MaWZlVGltZSA9IDAuNTsgcHMubWF4TGlmZVRpbWUgPSAxLjE7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjgsIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS41LCAwLjE1KTtcbiAgICAgICAgcHMubWluRW1pdFBvd2VyID0gMC4zNTsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHRoaXMucHMgPSBwcztcbiAgICAgIH1cbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBzOyBwLmVtaXRSYXRlID0gY2ZnLnJhdGU7IHAubWluU2l6ZSA9IGNmZy5taW47IHAubWF4U2l6ZSA9IGNmZy5tYXg7IHAuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMSk7IHAuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMik7IHAuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICAgIGlmICghcC5pc1N0YXJ0ZWQoKSkgcC5zdGFydCgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wcyAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTtcbiAgICBpZiAoc3RhciA+PSAzKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBoYWxvIGFib3ZlIHRoZSBoZWFkXG4gICAgICBpZiAoIXRoaXMuaGFsbykgeyB0aGlzLmhhbG8gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoYWxvJywgeyBkaWFtZXRlcjogMC41NSwgdGhpY2tuZXNzOiAwLjA0LCB0ZXNzZWxsYXRpb246IDI0IH0sIHMpOyB0aGlzLmhhbG8ucGFyZW50ID0gdGhpcy5wYXJlbnQ7IHRoaXMuaGFsby5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjA4OyB0aGlzLmhhbG8ubWF0ZXJpYWwgPSB0aGlzLkEuaGFsb01hdDsgdGhpcy5oYWxvLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgICAgdGhpcy5oYWxvLnNldEVuYWJsZWQodHJ1ZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmhhbG8pIHRoaXMuaGFsby5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLmJhci5zZXRFbmFibGVkKG9uKTsgdGhpcy5maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMuZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLm1iZy5zZXRFbmFibGVkKG9uKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMubWZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5tZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0QXVyYShvbjogYm9vbGVhbikgeyBpZiAodGhpcy5wcykgeyBpZiAob24gJiYgIXRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RhcnQoKTsgaWYgKCFvbiAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTsgfSB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7IGlmICh0aGlzLmhhbG8gJiYgdGhpcy5oYWxvLmlzRW5hYmxlZCgpKSB0aGlzLmhhbG8ucm90YXRpb24ueSArPSBkdCAqIDEuNjsgfVxuICBkaXNwb3NlKCkgeyBpZiAodGhpcy5wcykgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IH0gW3RoaXMuaGFsbywgdGhpcy5yaW5nLCB0aGlzLnN0YXJzLCB0aGlzLmJhciwgdGhpcy5maWxsLCB0aGlzLm1iZywgdGhpcy5tZmlsbF0uZm9yRWFjaCgobSkgPT4gbSAmJiBtLmRpc3Bvc2UoKSk7IHRoaXMuYmFkZ2UuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcmVhbCBtb2RlbHNcbmNsYXNzIFRyaXBvVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIGVudDogYW55OyBwcml2YXRlIGJvZHk6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIGJhc2U6IG51bWJlcjtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgY2ZnOiBUcmlwb0NmZywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIHVpZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDcpO1xuICAgIHRoaXMuZW50ID0gY2ZnLmNvbnRhaW5lci5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIHVpZCwgZmFsc2UsIHsgZG9Ob3RJbnN0YW50aWF0ZTogdHJ1ZSB9KTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3VuaXRfJyArIHVpZCwgcyk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICB0aGlzLmJvZHkgPSB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5maW5kKChtOiBhbnkpID0+IG0ubmFtZS5pbmNsdWRlcygnX0JvZHknKSk7XG4gICAgaWYgKCFjZmcuYmFzZU1hdCkgY2ZnLmJhc2VNYXQgPSB0aGlzLmJvZHkubWF0ZXJpYWw7XG4gICAgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4geyBnLnN0b3AoKTsgZy5lbmFibGVCbGVuZGluZyA9IHRydWU7IGcuYmxlbmRpbmdTcGVlZCA9IDAuMTI7IHRoaXMuYW5pbXNbZy5uYW1lLnNwbGl0KCdfJylbMF1dID0gZzsgfSk7XG4gICAgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uYWx3YXlzU2VsZWN0QXNBY3RpdmVNZXNoID0gdHJ1ZTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH0pO1xuICAgIHRoaXMudG9wID0gY2ZnLnRvcDsgdGhpcy5iYXNlID0gY2ZnLnNjYWxlOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgMC4zKTtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IDEuMywgZGlhbWV0ZXI6IDAuOCB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IDAuNjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLmlzUGlja2FibGUgPSB0cnVlO1xuICAgIHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gIH1cbiAgcHJpdmF0ZSBhcHBseU1hdCgpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLnRlYW0gKyAnXycgKyB0aGlzLnN0YXIsIGMgPSB0aGlzLmNmZztcbiAgICBpZiAoIWMubWF0Q2FjaGVba2V5XSkgeyBjb25zdCBtID0gYy5iYXNlTWF0LmNsb25lKCdtXycgKyBrZXkpOyBpZiAodGhpcy50ZWFtID09PSAxKSBtLmFsYmVkb1RleHR1cmUgPSBjLmVuZW15VGV4OyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgbS5hbGJlZG9Db2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyh0WzBdLCB0WzFdLCB0WzJdKTsgYy5tYXRDYWNoZVtrZXldID0gbTsgfVxuICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IGMubWF0Q2FjaGVba2V5XTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbChCQUxBTkNFLnN0YXIuc2NhbGVbc3QgLSAxXSAqIHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHtcbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1t0aGlzLmNmZy5jbGlwc1tzdGF0ZV1dOyBpZiAoIWcpIHJldHVybjsgY29uc3QgbG9vcCA9IHN0YXRlID09PSAnaWRsZScgfHwgc3RhdGUgPT09ICdydW4nO1xuICAgIGlmIChsb29wICYmIHRoaXMuc3RhdGUgPT09IHN0YXRlICYmIHRoaXMuY3VyID09PSBnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGxvb3AsIHNwZWVkLCBnLmZyb20sIGcudG8pO1xuICAgIGlmIChsb29wKSBnLmdvVG9GcmFtZShnLmZyb20gKyBNYXRoLnJhbmRvbSgpICogKGcudG8gLSBnLmZyb20pKTtcbiAgICB0aGlzLmN1ciA9IGc7IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpO1xuICB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy5kZWNvLnVwZGF0ZShkdCk7XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbChCQUxBTkNFLnN0YXIuc2NhbGVbdGhpcy5zdGFyIC0gMV0gKiB0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IGcuZGlzcG9zZSgpKTsgdGhpcy5lbnQuc2tlbGV0b25zLmZvckVhY2goKHM6IGFueSkgPT4gcy5kaXNwb3NlKCkpOyB0aGlzLnBpY2suZGlzcG9zZSgpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0uZGlzcG9zZShmYWxzZSwgZmFsc2UpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFuZC1pbnNcbmNvbnN0IFBIOiBSZWNvcmQ8c3RyaW5nLCB7IGNvbDogc3RyaW5nOyB3OiBudW1iZXI7IGg6IG51bWJlcjsgaGVhZDogbnVtYmVyOyB3ZWFwb246IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9PiA9IHtcbiAgZ29ibGluOiB7IGNvbDogJyM2M2IxM2YnLCB3OiAwLjM2LCBoOiAwLjQyLCBoZWFkOiAwLjM2LCB3ZWFwb246ICdkYWdnZXInLCBsYWJlbDogJ0dPQkxJTicgfSxcbiAga25pZ2h0OiB7IGNvbDogJyM4ZWE5ZGMnLCB3OiAwLjUsIGg6IDAuNiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnc2hpZWxkJywgbGFiZWw6ICdLTklHSFQnIH0sXG4gIG9ncmU6IHsgY29sOiAnI2E4YTY0YScsIHc6IDAuODUsIGg6IDAuODUsIGhlYWQ6IDAuNDIsIHdlYXBvbjogJ21hY2UnLCBsYWJlbDogJ09HUkUnIH0sXG4gIGJhcmJhcmlhbjogeyBjb2w6ICcjZDY4YTU1JywgdzogMC41MiwgaDogMC42MiwgaGVhZDogMC4zOCwgd2VhcG9uOiAnYXhlJywgbGFiZWw6ICdCQVJCQVJJQU4nIH0sXG59O1xuY2xhc3MgUGxhY2Vob2xkZXJWaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgcmlnOiBhbnk7IHByaXZhdGUgbGVnczogYW55W10gPSBbXTsgcHJpdmF0ZSB3cDogYW55OyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHQgPSBNYXRoLnJhbmRvbSgpICogNjsgcHJpdmF0ZSBzdDAgPSAwOyBwcml2YXRlIGR1ciA9IDE7IHByaXZhdGUgYmFzZSA9IDE7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBtYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGJvZHk6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgc291bDogc3RyaW5nLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIGQgPSBQSFtzb3VsXTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3BoXycgKyBzb3VsLCBzKTsgdGhpcy5yaWcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdyaWcnLCBzKTsgdGhpcy5yaWcucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgY29uc3QgbWF0ID0gKGhleDogc3RyaW5nLCBlbSA9IDApID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3BtJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhoZXgpLnNjYWxlKDAuNzIpOyBtLnNwZWN1bGFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xLCAwLjEsIDAuMSk7IGlmIChlbSkgbS5lbWlzc2l2ZUNvbG9yID0gbS5kaWZmdXNlQ29sb3Iuc2NhbGUoZW0pOyByZXR1cm4gbTsgfTtcbiAgICBjb25zdCBsZWdIID0gMC4yMiwgYm9keVkgPSBsZWdIICsgZC5oIC8gMjtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgbGcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdsZWcnLCBzKTsgbGcucGFyZW50ID0gdGhpcy5yaWc7IGxnLnBvc2l0aW9uLnNldChzeCAqIGQudyAqIDAuMjIsIGxlZ0gsIDApOyBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignbCcsIHsgaGVpZ2h0OiBsZWdILCBkaWFtZXRlcjogZC53ICogMC4yOCB9LCBzKTsgbS5wYXJlbnQgPSBsZzsgbS5wb3NpdGlvbi55ID0gLWxlZ0ggLyAyOyBtLm1hdGVyaWFsID0gbWF0KCcjNGEzODI2Jyk7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmxlZ3MucHVzaChsZyk7IH1cbiAgICB0aGlzLmJvZHkgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUNhcHN1bGUoJ2JvZHknLCB7IHJhZGl1czogZC53IC8gMiwgaGVpZ2h0OiBkLmggKyBkLncgKiAwLjQgfSwgcyk7IHRoaXMuYm9keS5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy5ib2R5LnBvc2l0aW9uLnkgPSBib2R5WTsgdGhpcy5ib2R5Lm1hdGVyaWFsID0gbWF0KGQuY29sKTsgdGhpcy5ib2R5LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBoZWFkID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2hlYWQnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAxLjUsIHNlZ21lbnRzOiAxMiB9LCBzKTsgaGVhZC5wYXJlbnQgPSB0aGlzLnJpZzsgaGVhZC5wb3NpdGlvbi55ID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDAuNTU7IGhlYWQubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyBoZWFkLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBleWVNID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZXllJywgcyk7IGV5ZU0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZXllTS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgKHRoaXMgYXMgYW55KS5leWVNID0gZXllTTtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgZSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdlJywgeyBkaWFtZXRlcjogZC5oZWFkICogMC4zIH0sIHMpOyBlLnBhcmVudCA9IHRoaXMucmlnOyBlLnBvc2l0aW9uLnNldChzeCAqIGQuaGVhZCAqIDAuMywgaGVhZC5wb3NpdGlvbi55ICsgMC4wMiwgZC5oZWFkICogMC42Nik7IGUubWF0ZXJpYWwgPSBleWVNOyBlLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIC8vIHdlYXBvbiBwaXZvdCBhdCB0aGUgc2hvdWxkZXIsIG9uIHRoZSBjaGFyYWN0ZXIncyByaWdodCAoLXggaXMgZmluZSBmb3IgYSBzdGFuZC1pbilcbiAgICB0aGlzLndwID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnd3AnLCBzKTsgdGhpcy53cC5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy53cC5wb3NpdGlvbi5zZXQoZC53ICogMC42LCBsZWdIICsgZC5oICogMC44NSwgMC4wNSk7XG4gICAgY29uc3Qgd20gPSBtYXQoJyM3YTVhMzAnKSwgaXJvbiA9IG1hdCgnIzlhYTFhZCcpO1xuICAgIGNvbnN0IG1rID0gKG06IGFueSwga2luZDogc3RyaW5nLCBkaW1zOiBhbnksIHBvczogbnVtYmVyW10sIG10OiBhbnkpID0+IHsgY29uc3QgeCA9IGtpbmQgPT09ICdib3gnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVCb3goJ3cnLCBkaW1zLCBzKSA6IGtpbmQgPT09ICdjeWwnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigndycsIGRpbXMsIHMpIDogQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ3cnLCBkaW1zLCBzKTsgeC5wYXJlbnQgPSB0aGlzLndwOyB4LnBvc2l0aW9uLnNldChwb3NbMF0sIHBvc1sxXSwgcG9zWzJdKTsgeC5tYXRlcmlhbCA9IG10OyB4LmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIHg7IH07XG4gICAgaWYgKGQud2VhcG9uID09PSAnZGFnZ2VyJykgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDUsIGhlaWdodDogMC4zLCBkZXB0aDogMC4wMyB9LCBbMCwgLTAuMiwgMC4xMl0sIGlyb24pO1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ3NoaWVsZCcpIHsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDYsIGhlaWdodDogMC41LCBkZXB0aDogMC4wNCB9LCBbMCwgLTAuMywgMC4xNF0sIGlyb24pOyBjb25zdCBzaCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3NoJywgeyBoZWlnaHQ6IDAuMDUsIGRpYW1ldGVyOiAwLjU1IH0sIHMpOyBzaC5wYXJlbnQgPSB0aGlzLnJpZzsgc2gucm90YXRpb24ueiA9IE1hdGguUEkgLyAyOyBzaC5wb3NpdGlvbi5zZXQoLWQudyAqIDAuNywgbGVnSCArIGQuaCAqIDAuNiwgMC4wNSk7IHNoLm1hdGVyaWFsID0gbWF0KCcjZDhiNjRhJyk7IHNoLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ21hY2UnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC45LCBkaWFtZXRlcjogMC4wOCB9LCBbMCwgLTAuMzUsIDAuM10sIHdtKTsgbWsoMCwgJ3NwaCcsIHsgZGlhbWV0ZXI6IDAuNCB9LCBbMCwgLTAuODUsIDAuNF0sIGlyb24pOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnYXhlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuNiwgZGlhbWV0ZXI6IDAuMDUgfSwgWzAsIC0wLjIsIDAuMTVdLCB3bSk7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjMyLCBoZWlnaHQ6IDAuMjIsIGRlcHRoOiAwLjA1IH0sIFswLCAtMC41LCAwLjE1XSwgaXJvbik7IGNvbnN0IGhhaXIgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdoYWlyJywgeyBoZWlnaHQ6IDAuMywgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiBkLmhlYWQgKiAxLjIgfSwgcyk7IGhhaXIucGFyZW50ID0gdGhpcy5yaWc7IGhhaXIucG9zaXRpb24ueSA9IGhlYWQucG9zaXRpb24ueSArIGQuaGVhZCAqIDAuNzU7IGhhaXIubWF0ZXJpYWwgPSBtYXQoJyNjMjJhMWMnKTsgaGFpci5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICB0aGlzLnRvcCA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAxLjM1OyB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIGQudyAqIDAuNyk7XG4gICAgY29uc3QgbGJsID0gZHluKHMsIDI1NiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDI2cHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMuZmlsbFN0eWxlID0gJyNmZmZmZmYnOyBjLnN0cm9rZVN0eWxlID0gJyMxMTEnOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IGMuZmlsbFRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyB9KTtcbiAgICBjb25zdCBscCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2xibCcsIHsgd2lkdGg6IDEuMSwgaGVpZ2h0OiAwLjIgfSwgcyk7IGxwLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBscC5wb3NpdGlvbi55ID0gLTAuMTsgbHAucm90YXRpb24ueCA9IE1hdGguUEkgLyAyICogMC4wOyBscC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBjb25zdCBsbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2xtJywgcyk7IGxtLmRpZmZ1c2VUZXh0dXJlID0gbGJsOyBsbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBscC5tYXRlcmlhbCA9IGxtOyBscC5pc1BpY2thYmxlID0gZmFsc2U7IGxwLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuNjI7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiB0aGlzLnRvcCwgZGlhbWV0ZXI6IE1hdGgubWF4KDAuNywgZC53ICogMS4zKSB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IHRoaXMudG9wIC8gMjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICAgICh0aGlzIGFzIGFueSkucGFydHMgPSBbbHBdOyB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5wbGF5KCdpZGxlJyk7XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyAodGhpcyBhcyBhbnkpLmV5ZU0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYmFzZSA9IEJBTEFOQ0Uuc3Rhci5zY2FsZVtzdCAtIDFdOyBjb25zdCB0ID0gVElOVFtzdCAtIDFdOyB0aGlzLmJvZHkubWF0ZXJpYWwuZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhQSFt0aGlzLnNvdWxdLmNvbCkuc2NhbGUoMC43MikubXVsdGlwbHkobmV3IEJBQllMT04uQ29sb3IzKE1hdGgubWluKDEsIHRbMF0pLCBNYXRoLm1pbigxLCB0WzFdKSwgTWF0aC5taW4oMSwgdFsyXSkpKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkgeyBpZiAoc3RhdGUgPT09IHRoaXMuc3RhdGUgJiYgKHN0YXRlID09PSAnaWRsZScgfHwgc3RhdGUgPT09ICdydW4nKSkgcmV0dXJuOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuc3QwID0gdGhpcy50OyB0aGlzLmR1ciA9IHN0YXRlID09PSAnYXR0YWNrJyA/IChCQUxBTkNFLnN0YXRzW3RoaXMuc291bCBhcyBTb3VsSWRdLmFuaW1MZW4gLyBzcGVlZCkgOiBzdGF0ZSA9PT0gJ2RlYXRoJyA/IDAuNiA6IHN0YXRlID09PSAnc3Bhd24nID8gMC45IDogMS4wOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7IH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLnQgKz0gZHQ7IHRoaXMuZGVjby51cGRhdGUoZHQpOyBjb25zdCBwID0gTWF0aC5taW4oMSwgKHRoaXMudCAtIHRoaXMuc3QwKSAvIHRoaXMuZHVyKSwgUiA9IHRoaXMucmlnLCBXID0gdGhpcy53cDtcbiAgICBSLnBvc2l0aW9uLnNldCgwLCAwLCAwKTsgUi5yb3RhdGlvbi5zZXQoMCwgMCwgMCk7IFIuc2NhbGluZy5zZXRBbGwoMSk7IFcucm90YXRpb24ueCA9IC0wLjQ7IHRoaXMubGVncy5mb3JFYWNoKChsKSA9PiAobC5yb3RhdGlvbi54ID0gMCkpO1xuICAgIGlmICh0aGlzLnN0YXRlID09PSAnaWRsZScpIFIucG9zaXRpb24ueSA9IE1hdGguc2luKHRoaXMudCAqIDIuMikgKiAwLjAxMjtcbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAncnVuJykgeyBjb25zdCB3ID0gdGhpcy50ICogMTA7IFIucG9zaXRpb24ueSA9IE1hdGguYWJzKE1hdGguc2luKHcpKSAqIDAuMDc7IFIucm90YXRpb24ueCA9IDAuMjsgdGhpcy5sZWdzWzBdLnJvdGF0aW9uLnggPSBNYXRoLnNpbih3KSAqIDAuOTsgdGhpcy5sZWdzWzFdLnJvdGF0aW9uLnggPSAtTWF0aC5zaW4odykgKiAwLjk7IFcucm90YXRpb24ueCA9IC0wLjQgKyBNYXRoLnNpbih3KSAqIDAuNDsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdhdHRhY2snKSB7IGNvbnN0IGsgPSBwIDwgMC40ID8gLTIuNCAqIChwIC8gMC40KSA6IC0yLjQgKyAzLjQgKiBNYXRoLm1pbigxLCAocCAtIDAuNCkgLyAwLjI1KTsgVy5yb3RhdGlvbi54ID0gazsgUi5wb3NpdGlvbi56ID0gMC4xNCAqIE1hdGguc2luKE1hdGguUEkgKiBwKTsgUi5yb3RhdGlvbi54ID0gMC4xNSAqIE1hdGguc2luKE1hdGguUEkgKiBwKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHsgY29uc3QgZSA9IHAgKiBwICogKDMgLSAyICogcCk7IFIuc2NhbGluZy5zZXRBbGwoMC4wMSArIDAuOTkgKiBlKTsgUi5wb3NpdGlvbi55ID0gKGUgLSAxKSAqIDAuNDsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdkZWF0aCcpIHsgY29uc3QgZSA9IHAgKiBwOyBSLnJvdGF0aW9uLnggPSAtTWF0aC5QSSAvIDIgKiBlOyBSLnBvc2l0aW9uLnkgPSAwLjI1ICogZTsgUi5wb3NpdGlvbi56ID0gLTAuMiAqIGU7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnY2hlZXInKSB7IFIucG9zaXRpb24ueSA9IE1hdGguYWJzKE1hdGguc2luKHRoaXMudCAqIDcpKSAqIDAuMTU7IFcucm90YXRpb24ueCA9IC0yLjY7IH1cbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5kZWNvLmRpc3Bvc2UoKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVWaXN1YWwoQTogQXNzZXRzLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpOiBVbml0VmlzdWFsIHtcbiAgY29uc3QgY2ZnID0gQS50cmlwb1tzb3VsXTtcbiAgcmV0dXJuIGNmZyA/IG5ldyBUcmlwb1Zpc3VhbChBLCBjZmcsIHNvdWwsIHRlYW0sIHN0YXIpIDogbmV3IFBsYWNlaG9sZGVyVmlzdWFsKEEsIHNvdWwsIHRlYW0sIHN0YXIpO1xufVxuZXhwb3J0IGNvbnN0IGlzVHJpcG8gPSAoQTogQXNzZXRzLCBzb3VsOiBTb3VsSWQpID0+ICEhQS50cmlwb1tzb3VsXTtcbiIsICIvLyBET00gdXNlciBpbnRlcmZhY2U6IHRvcCBiYXIsIGVuZW15IHByZXZpZXcsIGhhbmQgb2YgY2FyZHMsIGJ1dHRvbnMsIGRyYWZ0IG92ZXJsYXksIHRvYXN0cyBhbmQgdGhlIGRlYnVnIHBhbmVsLlxuaW1wb3J0IHsgQkFMQU5DRSwgUk9MRV9URVhULCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgY2FuTWVyZ2VEZXBsb3llZCwgY2FuTWVyZ2VGcm9tSGFuZCwgY2FuU3VtbW9uLCBjb3N0LCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgc3RhZ2VXYXZlcyB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgZW5lbXlXYXZlLCBwcmV2aWV3VGV4dCB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuXG5jb25zdCBJQ09OOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0geyB3YXJyaW9yOiAnXFx1ezFGNDgwfScsIGFyY2hlcjogJ1xcdXsxRjNGOX0nLCBnb2JsaW46ICdcXHV7MUY1RTF9XHVGRTBGJywga25pZ2h0OiAnXFx1ezFGNkUxfVx1RkUwRicsIG9ncmU6ICdcXHV7MUY1Mjh9JywgYmFyYmFyaWFuOiAnXFx1ezFGQTkzfScgfTtcbmNvbnN0ICQgPSAoaWQ6IHN0cmluZykgPT4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpITtcbmNvbnN0IHN0YXJzID0gKG46IG51bWJlcikgPT4gJ1x1MjYwNScucmVwZWF0KG4pO1xuXG5leHBvcnQgY2xhc3MgVWkge1xuICBwcml2YXRlIHRvYXN0VCA9IDA7IHByaXZhdGUgZGJnOiBIVE1MRWxlbWVudDsgcHJpdmF0ZSBvZGRzID0gJyc7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgZzogYW55KSB7XG4gICAgJCgnYnRuQmF0dGxlJykub25jbGljayA9ICgpID0+IGcuc3RhcnRCYXR0bGUoKTsgJCgnYnRuU3dhcCcpLm9uY2xpY2sgPSAoKSA9PiBnLnRvZ2dsZVN3YXAoKTtcbiAgICAkKCdidG5NZXJnZScpLm9uY2xpY2sgPSAoKSA9PiBnLm1lcmdlU2VsZWN0ZWQoKTsgJCgnYnRuUmVtb3ZlJykub25jbGljayA9ICgpID0+IGcucmVtb3ZlU2VsZWN0ZWQoKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtc3BlZWRdJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0U3BlZWQoK2IuZGF0YXNldC5zcGVlZCEpKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRDYW1Nb2RlKGIuZGF0YXNldC5jYW0hKSkpO1xuICAgICQoJ2dlYXInKS5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmRiZy5jbGFzc0xpc3QudG9nZ2xlKCdvcGVuJyk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICB0aGlzLmRiZyA9ICQoJ2RlYnVnJyk7IGlmIChuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdkZWJ1ZycpKSB0aGlzLmRiZy5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gICAgdGhpcy5yZW5kZXJEZWJ1ZygpO1xuICB9XG5cbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgY29uc3QgdCA9ICQoJ3RvYXN0Jyk7IHQudGV4dENvbnRlbnQgPSBtc2c7IHQuY2xhc3NMaXN0LmFkZCgnc2hvdycpOyBjbGVhclRpbWVvdXQodGhpcy50b2FzdFQpOyB0aGlzLnRvYXN0VCA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHQuY2xhc3NMaXN0LnJlbW92ZSgnc2hvdycpLCAzNjAwKTsgfVxuXG4gIHJlbmRlcigpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBzID0gZy5zLCBwaCA9IGcucGhhc2UsIGJ1aWxkID0gcGggPT09ICdidWlsZCc7XG4gICAgJCgnaGVhcnRzJykudGV4dENvbnRlbnQgPSAnXHUyNzY0XHVGRTBGJy5yZXBlYXQocy5oZWFydHMpICsgJ1xcdXsxRjVBNH0nLnJlcGVhdChNYXRoLm1heCgwLCAzIC0gcy5oZWFydHMpKTtcbiAgICAkKCd3YXZlJykudGV4dENvbnRlbnQgPSBgV2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfWA7XG4gICAgY29uc3QgdXNlZCA9IGRvbWluaW9uVXNlZChzKTsgJCgnZG9tJykudGV4dENvbnRlbnQgPSBgJHt1c2VkfS8ke3MuY2FwfWA7ICgkKCdkb21maWxsJykgYXMgSFRNTEVsZW1lbnQpLnN0eWxlLndpZHRoID0gTWF0aC5taW4oMTAwLCAodXNlZCAvIHMuY2FwKSAqIDEwMCkgKyAnJSc7XG4gICAgLy8gZW5lbXkgcHJldmlldzogd2hhdCBpcyBjb21pbmcsIG5ldmVyIHdoZXJlXG4gICAgY29uc3QgcHYgPSBwcmV2aWV3VGV4dChlbmVteVdhdmUocy53YXZlLCBnLnNlZWQpKTtcbiAgICAkKCdlbmVteScpLmlubmVySFRNTCA9IGA8Yj5OZXh0IGVuZW1pZXM8L2I+YCArIHB2Lm1hcCgocCkgPT4gYDxkaXYgY2xhc3M9XCJlcm93XCI+PHNwYW4+JHtJQ09OW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3Bhbj4ke1NPVUxfTkFNRVtwLnNvdWwgYXMgU291bElkXX08L3NwYW4+PHNwYW4gY2xhc3M9XCJ4XCI+XHUwMEQ3JHtwLmNvdW50fTwvc3Bhbj48c3BhbiBjbGFzcz1cInN0XCI+JHtzdGFycyhwLnN0YXIpfTwvc3Bhbj48L2Rpdj5gKS5qb2luKCcnKSArIGA8ZGl2IGNsYXNzPVwiaGludFwiPlBvc2l0aW9ucyBzdGF5IGhpZGRlbiB1bnRpbCB0aGUgYmF0dGxlLjwvZGl2PmA7XG4gICAgLy8gaGFuZFxuICAgIGNvbnN0IGhhbmQgPSAkKCdoYW5kJyk7IGhhbmQuaW5uZXJIVE1MID0gJyc7XG4gICAgcy5oYW5kLmZvckVhY2goKHNvdWw6IFNvdWxJZCwgaTogbnVtYmVyKSA9PiB7XG4gICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBjb25zdCBzZWwgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAnY2FyZCcgJiYgZy5zZWwuaWR4ID09PSBpOyBjb25zdCBhZmZvcmQgPSBjYW5TdW1tb24ocywgaSksIGNhbk1lcmdlID0gcy51bml0cy5zb21lKCh1OiBhbnkpID0+IGNhbk1lcmdlRnJvbUhhbmQocywgaSwgdS5pZCkpLCB1c2FibGUgPSBhZmZvcmQgfHwgY2FuTWVyZ2U7XG4gICAgICBlbC5jbGFzc05hbWUgPSAnY2FyZCcgKyAoc2VsID8gJyBzZWwnIDogJycpICsgKCF1c2FibGUgJiYgIWcuc3dhcE1vZGUgPyAnIGRpcycgOiAnJykgKyAoZy5zd2FwTW9kZSA/ICcgc3dhcCcgOiAnJyk7XG4gICAgICBjb25zdCB0YWcgPSBhZmZvcmQgPyBgPHNwYW4gY2xhc3M9XCJva1wiPlN1bW1vbjwvc3Bhbj5gIDogY2FuTWVyZ2UgPyAnPHNwYW4gY2xhc3M9XCJvayBtZ1wiPk1lcmdlIG9ubHk8L3NwYW4+JyA6ICc8c3BhbiBjbGFzcz1cIm5vXCI+Tm8gcm9vbTwvc3Bhbj4nO1xuICAgICAgZWwuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PjxkaXYgY2xhc3M9XCJpY1wiPiR7SUNPTltzb3VsXX08L2Rpdj48ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj48ZGl2IGNsYXNzPVwiY3NcIj4ke3RhZ308L2Rpdj5gOyBlbC50aXRsZSA9IFJPTEVfVEVYVFtzb3VsXSArIChhZmZvcmQgPyAnJyA6IGNhbk1lcmdlID8gJyAtIERvbWluaW9uIGlzIGZ1bGwsIGJ1dCB5b3UgY2FuIG1lcmdlIGl0IGludG8geW91ciBtYXRjaGluZyAxLXN0YXIgdW5pdC4nIDogJyAtIE5vdCBlbm91Z2ggZnJlZSBEb21pbmlvbiB0byBzdW1tb24gdGhpcy4nKTtcbiAgICAgIGVsLm9uY2xpY2sgPSAoKSA9PiBnLm9uQ2FyZChpKTsgaGFuZC5hcHBlbmRDaGlsZChlbCk7XG4gICAgfSk7XG4gICAgaWYgKCFzLmhhbmQubGVuZ3RoKSBoYW5kLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPVwiZW1wdHlcIj5ObyBjYXJkcyBpbiBoYW5kPC9kaXY+JztcbiAgICAvLyBidXR0b25zXG4gICAgKCQoJ2J0bkJhdHRsZScpIGFzIEhUTUxCdXR0b25FbGVtZW50KS5kaXNhYmxlZCA9ICFidWlsZCB8fCAhcy51bml0cy5sZW5ndGg7XG4gICAgY29uc3Qgc3cgPSAkKCdidG5Td2FwJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQ7IHN3LmRpc2FibGVkID0gIWJ1aWxkIHx8IHMuZGlzY2FyZFVzZWQ7IHN3LmNsYXNzTGlzdC50b2dnbGUoJ29uJywgZy5zd2FwTW9kZSk7IHN3LnRleHRDb250ZW50ID0gcy5kaXNjYXJkVXNlZCA/ICdTd2FwIHVzZWQnIDogZy5zd2FwTW9kZSA/ICdTd2FwOiBwaWNrIGEgY2FyZCBvciB1bml0JyA6ICdTd2FwICgxL3JvdW5kKSc7XG4gICAgY29uc3Qgc2VsVSA9IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICd1bml0JyA/IHMudW5pdHMuZmluZCgodTogYW55KSA9PiB1LmlkID09PSBnLnNlbC5pZCkgOiBudWxsO1xuICAgIGNvbnN0IHBhcnRuZXIgPSBzZWxVICYmIHMudW5pdHMuc29tZSgobzogYW55KSA9PiBjYW5NZXJnZURlcGxveWVkKHNlbFUsIG8pKTtcbiAgICAkKCd1bml0cGFuZWwnKS5zdHlsZS5kaXNwbGF5ID0gYnVpbGQgJiYgc2VsVSA/ICdmbGV4JyA6ICdub25lJzsgKCQoJ2J0bk1lcmdlJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQpLmRpc2FibGVkID0gIXBhcnRuZXI7XG4gICAgJCgnYnRuUmVtb3ZlJykudGV4dENvbnRlbnQgPSBnLmNvbmZpcm1SZW1vdmUgPyAnQ29uZmlybSByZW1vdmUnIDogJ1JlbW92ZSc7XG4gICAgJCgnaW5mbycpLnRleHRDb250ZW50ID0gYnVpbGQgPyAoZy5zd2FwTW9kZSA/ICdTV0FQOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCBpdCwgb3IgdGFwIGEgdW5pdCB5b3UgZGlkIG5vdCBzdW1tb24gdGhpcyByb3VuZCB0byBzZWxsIGl0LiBZb3UgZHJhdyBhIGRpZmZlcmVudCBTb3VsLidcbiAgICAgIDogc2VsVSA/IGAke1NPVUxfTkFNRVtzZWxVLnNvdWwgYXMgU291bElkXX0gJHtzdGFycyhzZWxVLnN0YXIpfSAgXHUyMDIyICAke1JPTEVfVEVYVFtzZWxVLnNvdWwgYXMgU291bElkXX0gICR7cGFydG5lciA/ICdcdTIwMjIgVGFwIGEgZ2xvd2luZyBwYXJ0bmVyIHRvIG1lcmdlLicgOiAnJ31gXG4gICAgICA6IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyA/IGAke1NPVUxfTkFNRVtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfTogJHtST0xFX1RFWFRbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX0gIFx1MjAyMiAgYCArICgoKSA9PiB7IGNvbnN0IGkgPSBnLnNlbC5pZHgsIHNtID0gY2FuU3VtbW9uKHMsIGkpLCBtZyA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKTsgcmV0dXJuIHNtICYmIG1nID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLCBvciBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6IHNtID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLicgOiBtZyA/ICdEb21pbmlvbiBpcyBmdWxsOiB0YXAgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiAnTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLic7IH0pKCkgOiAnVGFwIGEgY2FyZCwgdGhlbiBhIHRpbGUuIFRhcCBhIHVuaXQgdG8gbWVyZ2UsIG1vdmUgb3IgcmVtb3ZlIGl0LicpXG4gICAgICA6IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ0JhdHRsZSEgVW5pdHMgZmlnaHQgb24gdGhlaXIgb3duLicgOiAnJztcbiAgICAkKCdzcGVlZCcpLnN0eWxlLmRpc3BsYXkgPSBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdmbGV4JyA6ICdub25lJztcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtc3BlZWRdJykuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsICtiLmRhdGFzZXQuc3BlZWQhID09PSBnLnRpbWVTY2FsZSkpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGIuZGF0YXNldC5jYW0gPT09IGcuY2FtTW9kZSkpO1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnRvZ2dsZSgnaW5iYXR0bGUnLCBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyk7XG4gICAgLy8gb3ZlcmxheVxuICAgIGNvbnN0IG92ID0gJCgnb3ZlcmxheScpOyBvdi5jbGFzc05hbWUgPSAnJzsgb3YuaW5uZXJIVE1MID0gJyc7XG4gICAgaWYgKHBoID09PSAnZHJhZnQnICYmIGcuZHJhZnQpIHtcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+VmljdG9yeSBEcmFmdDwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPldhdmUgY2xlYXJlZC4gRG9taW5pb24gaXMgbm93ICR7cy5jYXB9LiBLZWVwIG9uZTo8L2Rpdj48ZGl2IGNsYXNzPVwicm93XCI+JHtnLmRyYWZ0Lm1hcCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IGA8ZGl2IGNsYXNzPVwiY2FyZCBiaWdcIiBkYXRhLWk9XCIke2l9XCI+PGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+PGRpdiBjbGFzcz1cImljXCI+JHtJQ09OW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJyb2xlXCI+JHtST0xFX1RFWFRbc291bF19PC9kaXY+PC9kaXY+YCkuam9pbignJyl9PC9kaXY+PC9kaXY+YDtcbiAgICAgIG92LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCcuY2FyZCcpLmZvckVhY2goKGMpID0+IChjLm9uY2xpY2sgPSAoKSA9PiBnLnBpY2tEcmFmdCgrYy5kYXRhc2V0LmkhKSkpO1xuICAgIH0gZWxzZSBpZiAocGggPT09ICd3b24nIHx8IHBoID09PSAnbG9zdCcpIHtcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+JHtwaCA9PT0gJ3dvbicgPyAnU3RhZ2UgY2xlYXJlZCEnIDogJ1N0YWdlIGxvc3QnfTwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPiR7Zy5sYXN0QmF0dGxlfTwvZGl2PjxidXR0b24gaWQ9XCJhZ2FpblwiPiR7cGggPT09ICd3b24nID8gJ1BsYXkgYWdhaW4nIDogJ1RyeSBhZ2Fpbid9PC9idXR0b24+PC9kaXY+YDtcbiAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IGcuc3RhcnRTdGFnZShnLnNlZWQgKyAxKTtcbiAgICB9XG4gICAgdGhpcy5yZW5kZXJEZWJ1Z0xpdmUoKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBwYW5lbFxuICBwcml2YXRlIHJlbmRlckRlYnVnKCkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmcsIGQgPSB0aGlzLmRiZzsgaWYgKCFkLmNsYXNzTGlzdC5jb250YWlucygnb3BlbicpKSB7IGQuaW5uZXJIVE1MID0gJyc7IHJldHVybjsgfVxuICAgIGNvbnN0IHJvdyA9IChsYWJlbDogc3RyaW5nLCBvYmo6IGFueSwga2V5OiBzdHJpbmcgfCBudW1iZXIsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlciwgc3RlcDogbnVtYmVyKSA9PiBgPGxhYmVsPiR7bGFiZWx9IDxpbnB1dCB0eXBlPVwicmFuZ2VcIiBtaW49XCIke21pbn1cIiBtYXg9XCIke21heH1cIiBzdGVwPVwiJHtzdGVwfVwiIHZhbHVlPVwiJHtvYmpba2V5XX1cIiBkYXRhLW89XCIke2xhYmVsfVwiPjxzcGFuPiR7b2JqW2tleV19PC9zcGFuPjwvbGFiZWw+YDtcbiAgICBkLmlubmVySFRNTCA9IGA8Yj5EZWJ1ZyAobGl2ZSk8L2I+IDxzcGFuIGlkPVwiZGJnZnBzXCI+PC9zcGFuPlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5TdGFyIG11bHRpcGxpZXJzIChib2RpZXMgPSBkYW1hZ2UsIHN0YXJzID0gZHVyYWJpbGl0eSlcbiAgICAgICAgJHtyb3coJ0hQIHggMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5ocCwgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0hQIHggM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5ocCwgMiwgMSwgNiwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAxLCAxLCA0LCAwLjA1KX0ke3JvdygnRGFtYWdlIHggM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5kbWcsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdTaXplIDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDEsIDEsIDEuNiwgMC4wMil9JHtyb3coJ1NpemUgM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5zY2FsZSwgMiwgMSwgMiwgMC4wMil9PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjx0YWJsZT48dHI+PHRoPjwvdGg+PHRoPmhwPC90aD48dGg+ZG1nPC90aD48dGg+cmF0ZTwvdGg+PHRoPnJhbmdlPC90aD48dGg+c3BkPC90aD48L3RyPiR7U09VTFMubWFwKChrKSA9PiBgPHRyPjx0ZD4ke0lDT05ba119PC90ZD4ke1snaHAnLCAnZG1nJywgJ2ludGVydmFsJywgJ3JhbmdlJywgJ3NwZWVkJ10ubWFwKChmKSA9PiBgPHRkPjxpbnB1dCBjbGFzcz1cIm51bVwiIGRhdGEtc291bD1cIiR7a31cIiBkYXRhLWY9XCIke2Z9XCIgdmFsdWU9XCIkeyhCQUxBTkNFLnN0YXRzIGFzIGFueSlba11bZl19XCI+PC90ZD5gKS5qb2luKCcnKX08L3RyPmApLmpvaW4oJycpfTwvdGFibGU+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPkRpZmZpY3VsdHkgPHNlbGVjdCBpZD1cImREaWZmXCI+JHtbJ2Vhc3knLCAnbm9ybWFsJywgJ2hhcmQnXS5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiICR7Zy5kaWZmaWN1bHR5ID09PSBrID8gJ3NlbGVjdGVkJyA6ICcnfT4ke2t9PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxzbWFsbD4oYXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUpPC9zbWFsbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRNZXJnZUhhbmRcIiAke2cucy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicgPyAnY2hlY2tlZCcgOiAnJ30+IE1lcmdlIGEgaGFuZCBjYXJkIHN0cmFpZ2h0IGludG8gYSBkZXBsb3llZCB1bml0IChvZmYgPSBkb2MgcnVsZTogYm90aCBjb3BpZXMgbXVzdCBiZSBvbiB0aGUgYm9hcmQpPC9sYWJlbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRPZGRzXCI+VGVzdCBvZGRzICgyMDAgZmlnaHRzKTwvYnV0dG9uPiA8c3BhbiBpZD1cImRPZGRzT3V0XCI+JHt0aGlzLm9kZHN9PC9zcGFuPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZENvcHlcIj5Db3B5IHJlcG9ydDwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZFJlc2V0XCI+UmVzZXQgYmFsYW5jZTwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZFJlc3RhcnRcIj5SZXN0YXJ0IHN0YWdlPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPkFkZCBjYXJkIDxzZWxlY3QgaWQ9XCJkQ2FyZFwiPiR7U09VTFMubWFwKChrKSA9PiBgPG9wdGlvbiB2YWx1ZT1cIiR7a31cIj4ke1NPVUxfTkFNRVtrXX08L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPGJ1dHRvbiBpZD1cImRBZGRcIj4rPC9idXR0b24+IDxidXR0b24gaWQ9XCJkRG9tXCI+KzIgRG9taW5pb248L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHNtYWxsPkxhc3QgdGFwOiA8c3BhbiBpZD1cImRiZ3RhcFwiPiR7Zy5sYXN0VGFwSW5mb308L3NwYW4+PC9zbWFsbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHNtYWxsPlNlZWQgJHtnLnNlZWR9LiBBZGQgPGNvZGU+P3NlZWQ9NzwvY29kZT4gdG8gdGhlIGxpbmsgdG8gcmVwbGF5IHRoZSBzYW1lIGRyYXdzLjwvc21hbGw+PC9kaXY+YDtcbiAgICBkLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oJ2lucHV0W3R5cGU9cmFuZ2VdJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uaW5wdXQgPSAoKSA9PiB7XG4gICAgICBjb25zdCBsYWIgPSBpbnAuZGF0YXNldC5vITsgY29uc3QgdiA9ICtpbnAudmFsdWU7IChpbnAubmV4dEVsZW1lbnRTaWJsaW5nIGFzIEhUTUxFbGVtZW50KS50ZXh0Q29udGVudCA9IFN0cmluZyh2KTtcbiAgICAgIGNvbnN0IHNldDogUmVjb3JkPHN0cmluZywgKCkgPT4gdm9pZD4gPSB7ICdIUCB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmhwWzFdID0gdiksICdIUCB4IDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmhwWzJdID0gdiksICdEYW1hZ2UgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMV0gPSB2KSwgJ0RhbWFnZSB4IDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1syXSA9IHYpLCAnU2l6ZSAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5zY2FsZVsxXSA9IHYpLCAnU2l6ZSAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5zY2FsZVsyXSA9IHYpIH07XG4gICAgICBzZXRbbGFiXSgpOyBnLmFwcGx5QmFsYW5jZUNoYW5nZSgpO1xuICAgIH0pKTtcbiAgICBkLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oJ2lucHV0Lm51bScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmNoYW5nZSA9ICgpID0+IHsgKEJBTEFOQ0Uuc3RhdHMgYXMgYW55KVtpbnAuZGF0YXNldC5zb3VsIV1baW5wLmRhdGFzZXQuZiFdID0gK2lucC52YWx1ZTsgfSkpO1xuICAgICQoJ2REaWZmJykub25jaGFuZ2UgPSAoZSkgPT4gZy5jaGFuZ2VEaWZmaWN1bHR5KChlLnRhcmdldCBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUpO1xuICAgICQoJ2RNZXJnZUhhbmQnKS5vbmNoYW5nZSA9IChlKSA9PiB7IGcucy5ydWxlcy5tZXJnZSA9IChlLnRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS5jaGVja2VkID8gJ2hhbmRJbnRvT25lU3RhcicgOiAnZGVwbG95ZWRPbmx5JzsgZy5zeW5jQnVpbGQoKTsgdGhpcy5yZW5kZXIoKTsgfTtcbiAgICAkKCdkT2RkcycpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHIgPSBnLnRlc3RPZGRzKDIwMCk7IHRoaXMub2RkcyA9IGAke3Iud2lufSUgd2luICgke3Iubn0gZmlnaHRzLCBhdmcgJHtyLmF2Z1RpbWV9cykgdnMgd2F2ZSAke2cucy53YXZlfWA7ICQoJ2RPZGRzT3V0JykudGV4dENvbnRlbnQgPSB0aGlzLm9kZHM7IH07XG4gICAgJCgnZENvcHknKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCB0ID0gZy5yZXBvcnQoKTsgKG5hdmlnYXRvci5jbGlwYm9hcmQgPyBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KSA6IFByb21pc2UucmVqZWN0KCkpLnRoZW4oKCkgPT4gdGhpcy50b2FzdCgnUmVwb3J0IGNvcGllZC4gUGFzdGUgaXQgaW50byBjaGF0LicpKS5jYXRjaCgoKSA9PiB7IHByb21wdCgnQ29weSB0aGlzIHJlcG9ydDonLCB0KTsgfSk7IH07XG4gICAgJCgnZFJlc2V0Jykub25jbGljayA9ICgpID0+IHsgZy5yZXNldEJhbGFuY2VBbGwoKTsgdGhpcy5yZW5kZXJEZWJ1ZygpOyB9O1xuICAgICQoJ2RSZXN0YXJ0Jykub25jbGljayA9ICgpID0+IGcuc3RhcnRTdGFnZShnLnNlZWQpO1xuICAgICQoJ2RBZGQnKS5vbmNsaWNrID0gKCkgPT4gZy5hZGRDYXJkKCgkKCdkQ2FyZCcpIGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSBhcyBTb3VsSWQpOyAkKCdkRG9tJykub25jbGljayA9ICgpID0+IGcuYWRkRG9taW5pb24oMik7XG4gIH1cbiAgcHJpdmF0ZSByZW5kZXJEZWJ1Z0xpdmUoKSB7XG4gICAgY29uc3QgZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmdmcHMnKTsgaWYgKGYpIGYudGV4dENvbnRlbnQgPSBgJHt0aGlzLmcuZW5naW5lLmdldEZwcygpLnRvRml4ZWQoMCl9IGZwcyBcdTIwMjIgJHt0aGlzLmcucGhhc2V9YDtcbiAgICBjb25zdCB0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ3RhcCcpOyBpZiAodCkgdC50ZXh0Q29udGVudCA9IHRoaXMuZy5sYXN0VGFwSW5mbztcbiAgfVxufVxuIiwgIi8vIFRoZSBwbGF5YWJsZSBwcm90b3R5cGU6IGJ1aWxkIHNjcmVlbiAtPiBiYXR0bGUgLT4gZHJhZnQgLT4gbmV4dCB3YXZlLCBidWlsdCBvbiB0aGUgdGVzdGVkIHJ1bGVzICsgYmF0dGxlIGVuZ2luZS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSwgcmVzZXRCYWxhbmNlLCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgR1JJRF9DRUxMUywgR1JJRF9DT0xTLCBHUklEX1JPV1MsIFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7XG4gIGFkdmFuY2VXYXZlLCBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNlbGxGcmVlLCBjb3N0LCBkaXNjYXJkUmVkcmF3LCBkaXNtaXNzLCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgZHJhZnRPcHRpb25zLCBmYWlsV2F2ZSxcbiAgbWVyZ2VEZXBsb3llZCwgbWVyZ2VGcm9tSGFuZCwgbW92ZVVuaXQsIG5ld1N0YWdlLCBub3JtYWxEcmF3LCBzdGFnZVdhdmVzLCBzdW1tb24sIHN3YXBTZWxsLCB0YWtlRHJhZnQsXG59IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgQmF0dGxlLCBjZWxsUG9zLCBGUk9OVF9YLCBHUklEX1NQLCBzaW11bGF0ZSB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB0eXBlIHsgQkV2ZW50IH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHsgZGlmZmljdWx0eU5hbWUsIGVuZW15V2F2ZSwgc2V0RGlmZmljdWx0eSB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgUFJPVE9UWVBFX1JVTEVTIH0gZnJvbSAnLi4vY29yZS9wcm90b3R5cGUudHMnO1xuaW1wb3J0IHsgbG9hZFNhdmUgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuaW1wb3J0IHsgY3JlYXRlVmlzdWFsLCBpc1RyaXBvLCBsb2FkQXNzZXRzIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB0eXBlIHsgQXNzZXRzLCBVbml0VmlzdWFsIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB7IFVpIH0gZnJvbSAnLi91aS50cyc7XG5cbmV4cG9ydCB0eXBlIFBoYXNlID0gJ2J1aWxkJyB8ICd0cmFuc2l0aW9uJyB8ICdiYXR0bGUnIHwgJ2RyYWZ0JyB8ICd3b24nIHwgJ2xvc3QnO1xudHlwZSBTZWwgPSB7IHR5cGU6ICdjYXJkJzsgaWR4OiBudW1iZXIgfSB8IHsgdHlwZTogJ3VuaXQnOyBpZDogbnVtYmVyIH0gfCBudWxsO1xuXG5leHBvcnQgY2xhc3MgR2FtZSB7XG4gIGVuZ2luZTogYW55OyBzY2VuZTogYW55OyBjYW1lcmE6IGFueTsgQSE6IEFzc2V0czsgdWkhOiBVaTtcbiAgcyE6IFN0YXRlOyBzZWVkID0gMTsgYXR0ZW1wdCA9IDA7IHBoYXNlOiBQaGFzZSA9ICdidWlsZCc7IGJhdHRsZTogQmF0dGxlIHwgbnVsbCA9IG51bGw7IHRpbWVTY2FsZSA9IDE7XG4gIHNlbDogU2VsID0gbnVsbDsgc3dhcE1vZGUgPSBmYWxzZTsgY29uZmlybVJlbW92ZSA9IGZhbHNlOyBkcmFmdDogU291bElkW10gfCBudWxsID0gbnVsbDsgbGFzdEJhdHRsZSA9ICcnO1xuICBwcml2YXRlIHVuaXRWaXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgIC8vIHVuaXQgaWQgLT4gdmlzdWFsICh5b3VyIGFybXksIHBlcnNpc3RzIGJldHdlZW4gd2F2ZXMpXG4gIHByaXZhdGUgdmlzVG9Vbml0ID0gbmV3IE1hcDxVbml0VmlzdWFsLCBudW1iZXI+KCk7XG4gIHByaXZhdGUgZnZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB2aXN1YWwgZHVyaW5nIGEgYmF0dGxlXG4gIHByaXZhdGUgZlVuaXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpOyAgICAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB1bml0IGlkIChwbGF5ZXIgc2lkZSlcbiAgcHJpdmF0ZSBsYXN0U3RhdGUgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpO1xuICBwcml2YXRlIHRpbGVzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbGVNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHJpbmdGeDogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd3M6IGFueVtdID0gW107IHByaXZhdGUgdGltZXJzOiB7IHQ6IG51bWJlcjsgZm46ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgYWNjID0gMDsgcHJpdmF0ZSBjYW1Gcm9tOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVRvOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVQgPSAxOyBwcml2YXRlIGNhbUR1ciA9IDIuMDsgcHJpdmF0ZSByZXN1bHRBdCA9IC0xOyBwcml2YXRlIGhhbmRsZWQgPSBmYWxzZTsgcHJpdmF0ZSBzdGFydFN0ZXBBdCA9IDA7XG4gIHByaXZhdGUgYXJyb3dNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93TWVzaDogYW55W10gPSBbXTtcblxuICBhc3luYyBpbml0KGNhbnZhczogSFRNTENhbnZhc0VsZW1lbnQpIHtcbiAgICBjb25zdCBxcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKTtcbiAgICB0aGlzLmVuZ2luZSA9IG5ldyBCQUJZTE9OLkVuZ2luZShjYW52YXMsIHRydWUsIHsgYW50aWFsaWFzOiB0cnVlLCBwb3dlclByZWZlcmVuY2U6ICdoaWdoLXBlcmZvcm1hbmNlJyB9KTtcbiAgICBjb25zdCBkcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxOyB0aGlzLmVuZ2luZS5zZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgxIC8gTWF0aC5taW4oZHByLCAxLjUpKTtcbiAgICBjb25zdCBzY2VuZSA9IHRoaXMuc2NlbmUgPSBuZXcgQkFCWUxPTi5TY2VuZSh0aGlzLmVuZ2luZSk7IHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wOSwgMC4wNywgMC4xMywgMSk7XG4gICAgY29uc3QgaGVtaSA9IG5ldyBCQUJZTE9OLkhlbWlzcGhlcmljTGlnaHQoJ2gnLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMSwgMC4zKSwgc2NlbmUpOyBoZW1pLmludGVuc2l0eSA9IDEuMDU7IGhlbWkuZ3JvdW5kQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4zMiwgMC4yNiwgMC40Mik7XG4gICAgY29uc3Qgc3VuID0gbmV3IEJBQllMT04uRGlyZWN0aW9uYWxMaWdodCgncycsIG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuNCwgLTEsIDAuNTUpLCBzY2VuZSk7IHN1bi5pbnRlbnNpdHkgPSAwLjg1O1xuICAgIHRoaXMuY2FtZXJhID0gbmV3IEJBQllMT04uRnJlZUNhbWVyYSgnY2FtJywgbmV3IEJBQllMT04uVmVjdG9yMygwLCA4LCAtOSksIHNjZW5lKTsgdGhpcy5jYW1lcmEubWluWiA9IDAuMTsgdGhpcy5jYW1lcmEubWF4WiA9IDIwMDsgdGhpcy5jYW1lcmEuZm92ID0gMC44OyB0aGlzLmNhbWVyYS5pbnB1dHMuY2xlYXIoKTtcblxuICAgIGNvbnN0IGdyb3VuZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdncm91bmQnLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0MCB9LCBzY2VuZSk7XG4gICAgY29uc3QgZ20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdnbScsIHNjZW5lKTsgZ20uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMTcsIDAuMTUsIDAuMjEpOyBnbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZ3JvdW5kLm1hdGVyaWFsID0gZ207IGdyb3VuZC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCB0ZWFtIG9mIFswLCAxXSBhcyBjb25zdCkgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHsgY29uc3QgdCA9IHRoaXMubWFrZVRpbGUodGVhbSwgYyk7IGlmICh0ZWFtID09PSAwKSB0aGlzLnRpbGVzLnB1c2godCk7IGVsc2UgdC5zZXRFbmFibGVkKGZhbHNlKTsgfVxuXG4gICAgdGhpcy5BID0gYXdhaXQgbG9hZEFzc2V0cyhzY2VuZSk7XG4gICAgdGhpcy5hcnJvd01hdHMgPSBbMCwgMV0ubWFwKCh0KSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdhbScgKyB0LCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjMsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNywgMC4yNSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcmV0dXJuIG07IH0pO1xuICAgIHRoaXMudWkgPSBuZXcgVWkodGhpcyk7IHRoaXMuc2VlZCA9ICsocXMuZ2V0KCdzZWVkJykgfHwgMSk7XG5cbiAgICAvLyBUYXBzIGFyZSBkZXRlY3RlZCBoZXJlIChub3QgdGhyb3VnaCBCYWJ5bG9uKSBzbyB0aGV5IGJlaGF2ZSB0aGUgc2FtZSBpbiBTYWZhcmksIHRoZSBob21lLXNjcmVlbiBhcHAgYW5kIG9uIGRlc2t0b3AuXG4gICAgbGV0IGRvd246IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbG9jYWwgPSAoZTogUG9pbnRlckV2ZW50KSA9PiB7IGNvbnN0IHIgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7IHJldHVybiB7IHg6IGUuY2xpZW50WCAtIHIubGVmdCwgeTogZS5jbGllbnRZIC0gci50b3AgfTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmRvd24nLCAoZSkgPT4geyBkb3duID0geyAuLi5sb2NhbChlKSwgdDogcGVyZm9ybWFuY2Uubm93KCkgfTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJ1cCcsIChlKSA9PiB7IGlmICghZG93bikgcmV0dXJuOyBjb25zdCBwID0gbG9jYWwoZSk7IGNvbnN0IG1vdmVkID0gTWF0aC5oeXBvdChwLnggLSBkb3duLngsIHAueSAtIGRvd24ueSksIGR0ID0gcGVyZm9ybWFuY2Uubm93KCkgLSBkb3duLnQ7IGRvd24gPSBudWxsOyBpZiAobW92ZWQgPCAxNiAmJiBkdCA8IDkwMCkgdGhpcy50YXAocC54LCBwLnkpOyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmNhbmNlbCcsICgpID0+IHsgZG93biA9IG51bGw7IH0pO1xuICAgIHRoaXMuY2FudmFzID0gY2FudmFzOyBjb25zdCBvblJlc2l6ZSA9ICgpID0+IHRoaXMuaGFuZGxlUmVzaXplKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTsgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ29yaWVudGF0aW9uY2hhbmdlJywgKCkgPT4gc2V0VGltZW91dChvblJlc2l6ZSwgMjUwKSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydCkgKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKSBuZXcgKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKG9uUmVzaXplKS5vYnNlcnZlKGNhbnZhcyk7XG4gICAgaWYgKHFzLmdldCgnZ2FsbGVyeScpKSB7IHRoaXMuZ2FsbGVyeSgpOyByZXR1cm47IH1cbiAgICB0aGlzLnN0YXJ0U3RhZ2UodGhpcy5zZWVkKTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKTsgY29uc3QgZHQgPSBNYXRoLm1pbigwLjA1LCAobm93IC0gbGFzdCkgLyAxMDAwKTsgbGFzdCA9IG5vdzsgaWYgKCF0aGlzLmFjdGl2ZSkgcmV0dXJuOyB0aGlzLmZyYW1lKGR0KTsgc2NlbmUucmVuZGVyKCk7IH0pO1xuICB9XG4gIC8qKiBUaGUgbmF2aWdhdGlvbiBzaGVsbCBoaWRlcyB0aGUgYmF0dGxlIHNjcmVlbiB3aGlsZSBhbm90aGVyIHRhYiBpcyBvcGVuOiBwYXVzZSB0aGUgZ2FtZSBzbyBpdCBjb3N0cyBub3RoaW5nLiAqL1xuICBwcml2YXRlIGFjdGl2ZSA9IHRydWU7XG4gIHNldEFjdGl2ZShvbjogYm9vbGVhbikgeyB0aGlzLmFjdGl2ZSA9IG9uOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2NlbmUgaGVscGVyc1xuICBwcml2YXRlIG1ha2VUaWxlKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKSwgdCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3RpbGUnICsgY2VsbCwgeyBzaXplOiBHUklEX1NQICogMC45MiB9LCB0aGlzLnNjZW5lKTtcbiAgICB0LnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdC5wb3NpdGlvbi5zZXQocC54LCAwLjAxNSwgcC56KTtcbiAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndG0nLCB0aGlzLnNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuMTgsIDAuMTIsIDAuNDIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNDIsIDAuMTIsIDAuMTIpOyBtLmFscGhhID0gMC41OyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHQubWF0ZXJpYWwgPSBtO1xuICAgIGlmICh0ZWFtID09PSAwKSB7IHQubWV0YWRhdGEgPSB7IGtpbmQ6ICd0aWxlJywgY2VsbCB9OyB0aGlzLnRpbGVNYXRzW2NlbGxdID0gbTsgfSBlbHNlIHQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHJldHVybiB0O1xuICB9XG4gIHByaXZhdGUgdGludChjZWxsOiBudW1iZXIsIG1vZGU6ICdub3JtYWwnIHwgJ2ZyZWUnIHwgJ3NlbCcgfCAncGFydG5lcicpIHtcbiAgICBjb25zdCBtID0gdGhpcy50aWxlTWF0c1tjZWxsXTsgY29uc3QgYyA9IHsgbm9ybWFsOiBbMC4xOCwgMC4xMiwgMC40MiwgMC41XSwgZnJlZTogWzAuMiwgMC43NSwgMC41NSwgMC43XSwgc2VsOiBbMSwgMC44MiwgMC4zLCAwLjg1XSwgcGFydG5lcjogWzAuODUsIDAuMzUsIDEsIDAuODVdIH1bbW9kZV07XG4gICAgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pOyBtLmFscGhhID0gY1szXTtcbiAgfVxuICBsYXRlcihzZWM6IG51bWJlciwgZm46ICgpID0+IHZvaWQpIHsgdGhpcy50aW1lcnMucHVzaCh7IHQ6IHNlYywgZm4gfSk7IH1cbiAgcHJpdmF0ZSBmeFJpbmcoeDogbnVtYmVyLCB6OiBudW1iZXIsIGNvbG9yOiBhbnksIHIwOiBudW1iZXIsIHIxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2Z4JywgeyBkaWFtZXRlcjogMSwgdGhpY2tuZXNzOiAwLjAzNSwgdGVzc2VsbGF0aW9uOiAyOCB9LCB0aGlzLnNjZW5lKTsgbS5wb3NpdGlvbi5zZXQoeCwgMC4wNSwgeik7IG0uaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG1tID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZnhtJywgdGhpcy5zY2VuZSk7IG1tLmVtaXNzaXZlQ29sb3IgPSBjb2xvcjsgbW0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbW0uYWxwaGEgPSAwLjk7IG0ubWF0ZXJpYWwgPSBtbTsgdGhpcy5yaW5nRngucHVzaCh7IG0sIG1tLCB0OiAwLCByMCwgcjEsIGR1ciB9KTtcbiAgfVxuICBwcml2YXRlIGJ1cnN0KHg6IG51bWJlciwgejogbnVtYmVyLCBjMTogbnVtYmVyW10sIGMyOiBudW1iZXJbXSwgY291bnQ6IG51bWJlcikge1xuICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2InLCA2MCwgdGhpcy5zY2VuZSk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCAwLjA1LCB6KTsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMC4wNSwgMC4yKTtcbiAgICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMxIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzIgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMSwgMCwgMC4yLCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4xMjsgcHMubWF4U2l6ZSA9IDAuMzQ7IHBzLm1pbkxpZmVUaW1lID0gMC40OyBwcy5tYXhMaWZlVGltZSA9IDAuOTsgcHMuZW1pdFJhdGUgPSAwOyBwcy5tYW51YWxFbWl0Q291bnQgPSBjb3VudDsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEsIDEuMywgLTEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygxLCAyLjQsIDEpO1xuICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuODsgcHMubWF4RW1pdFBvd2VyID0gMjsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgLTIsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnRhcmdldFN0b3BEdXJhdGlvbiA9IDEuMjsgcHMuZGlzcG9zZU9uU3RvcCA9IHRydWU7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBjYW1lcmFcbiAgcHJpdmF0ZSBwb3NlcygpIHtcbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCBoYWxmID0gRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1AgKyAxLjQ7XG4gICAgY29uc3QgZCA9IE1hdGgubWF4KGhhbGYgLyAodGFuViAqIGFzcCksICgoR1JJRF9ST1dTICogR1JJRF9TUCkgLyAyICsgMikgLyAodGFuViAqIDAuNTUpLCA4KTtcbiAgICBjb25zdCBiYXR0bGUgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMygtMC4xICogZCwgMC40MiAqIGQgKyAwLjUsIC0wLjg2ICogZCksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjM1LCAwKSB9O1xuICAgIC8vIEJ1aWxkIHZpZXc6IChhbG1vc3QpIHN0cmFpZ2h0IGRvd24sIHdpdGggdGhlIHdob2xlIGdyaWQgaW5zaWRlIHRoZSBiYW5kIGJldHdlZW4gdGhlIHRvcCBiYXIgYW5kIHRoZSBoYW5kIG9mIGNhcmRzLlxuICAgIGNvbnN0IGN4ID0gLShGUk9OVF9YICsgKChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC8gMiksIEggPSBNYXRoLm1heCgxLCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpO1xuICAgIGNvbnN0IGJveCA9IChpZDogc3RyaW5nKSA9PiB7IGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOyByZXR1cm4gZWwgJiYgZWwub2Zmc2V0UGFyZW50ICE9PSBudWxsID8gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkgOiBudWxsOyB9O1xuICAgIGNvbnN0IHRvcEJhciA9IGJveCgndG9wJyksIGhhbmQgPSBib3goJ2hhbmQnKSwgaW5mbyA9IGJveCgnaW5mbycpO1xuICAgIGNvbnN0IFRPUCA9IE1hdGgubWluKDAuMzIsIHRvcEJhciA/ICh0b3BCYXIuYm90dG9tICsgNikgLyBIIDogMC4xKTtcbiAgICBjb25zdCBCT1RUT00gPSBNYXRoLm1pbigwLjUsIChIIC0gTWF0aC5taW4oaGFuZCA/IGhhbmQudG9wIDogSCwgaW5mbyA/IGluZm8udG9wIDogSCkgKyA2KSAvIEgpO1xuICAgIGNvbnN0IGJhbmQgPSBNYXRoLm1heCgwLjMsIDEgLSBUT1AgLSBCT1RUT00pLCBjZW50ZXJGcmFjID0gVE9QICsgYmFuZCAvIDI7ICAgICAgICAgIC8vIHRoZSBncmlkJ3MgY2VudHJlIGFwcGVhcnMgYXQgdGhpcyBmcmFjdGlvbiBmcm9tIHRoZSB0b3BcbiAgICBjb25zdCBndyA9IEdSSURfQ09MUyAqIEdSSURfU1AgKyAwLjUsIGdoID0gR1JJRF9ST1dTICogR1JJRF9TUCArIDAuNTtcbiAgICBjb25zdCBkMiA9IE1hdGgubWF4KGdoIC8gKDIgKiB0YW5WICogYmFuZCksIGd3IC8gKDIgKiB0YW5WICogYXNwICogMC44OCksIDQuNSk7XG4gICAgY29uc3Qgc2hpZnQgPSAoMC41IC0gY2VudGVyRnJhYykgKiAyICogZDIgKiB0YW5WO1xuICAgIGNvbnN0IGJ1aWxkID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3gsIGQyLCAtc2hpZnQgLSAwLjEgKiBkMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMyhjeCwgMCwgLXNoaWZ0KSB9O1xuICAgIHJldHVybiB7IGJhdHRsZSwgYnVpbGQgfTtcbiAgfVxuICBwcml2YXRlIGNhbnZhcyE6IEhUTUxDYW52YXNFbGVtZW50OyBwcml2YXRlIGxhc3RXID0gMDsgcHJpdmF0ZSBsYXN0SCA9IDA7IGxhc3RUYXBJbmZvID0gJyhubyB0YXBzIHlldCknO1xuICBwcml2YXRlIGhhbmRsZVJlc2l6ZSgpIHtcbiAgICBpZiAoIXRoaXMuY2FudmFzLmNsaWVudFdpZHRoIHx8ICF0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpIHJldHVybjsgICAvLyBoaWRkZW4gYmVoaW5kIGFub3RoZXIgdGFiXG4gICAgdGhpcy5lbmdpbmUucmVzaXplKCk7IHRoaXMubGFzdFcgPSB0aGlzLmNhbnZhcy5jbGllbnRXaWR0aDsgdGhpcy5sYXN0SCA9IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyAmJiB0aGlzLmNhbVQgPj0gMSkgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgfVxuICAvKiogQSB0YXAgb24gdGhlIDNEIHZpZXc6IHBpY2sgYSB0aWxlIG9yIGEgdW5pdC4gKi9cbiAgcHJpdmF0ZSB0YXAoeDogbnVtYmVyLCB5OiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gdGhpcy5zY2VuZS5waWNrKHgsIHksIChtOiBhbnkpID0+ICEhKG0ubWV0YWRhdGEgJiYgbS5tZXRhZGF0YS5raW5kKSk7XG4gICAgY29uc3QgbWQgPSBwICYmIHAuaGl0ID8gcC5waWNrZWRNZXNoLm1ldGFkYXRhIDogbnVsbDtcbiAgICB0aGlzLmxhc3RUYXBJbmZvID0gYHRhcCAke01hdGgucm91bmQoeCl9LCR7TWF0aC5yb3VuZCh5KX0gb2YgJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IC0+ICR7bWQgPyAobWQua2luZCA9PT0gJ3RpbGUnID8gJ3RpbGUgJyArIG1kLmNlbGwgOiAndW5pdCcpIDogJ25vdGhpbmcnfSAocGhhc2UgJHt0aGlzLnBoYXNlfSlgO1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICFtZCkgcmV0dXJuO1xuICAgIGlmIChtZC5raW5kID09PSAndGlsZScpIHRoaXMub25UaWxlKG1kLmNlbGwpOyBlbHNlIGlmIChtZC5raW5kID09PSAndW5pdCcpIHRoaXMub25Vbml0VmlzdWFsKG1kLnZpc3VhbCk7XG4gIH1cbiAgcHJpdmF0ZSBzZXRDYW0ocDogYW55KSB7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNvcHlGcm9tKHAucG9zKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHAudGd0LmNsb25lKCkpOyB9XG4gIHByaXZhdGUgdHdlZW5DYW0odG86IGFueSwgZHVyOiBudW1iZXIpIHsgdGhpcy5jYW1Gcm9tID0geyBwb3M6IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNsb25lKCksIHRndDogdGhpcy5jYW1lcmEuZ2V0VGFyZ2V0KCkuY2xvbmUoKSB9OyB0aGlzLmNhbVRvID0gdG87IHRoaXMuY2FtVCA9IDA7IHRoaXMuY2FtRHVyID0gZHVyOyB9XG5cbiAgLy8gLS0tLSBiYXR0bGUgY2FtZXJhOiBmb2xsb3dzIHRoZSBmaWdodGVycyB0aGF0IGFyZSBzdGlsbCBhbGl2ZSwgc28gdGhlIGFjdGlvbiAoYW5kIHRoZSBwdXJwbGUgZXllcykgc3RheXMgbGFyZ2Ugb24gc2NyZWVuXG4gIGNhbU1vZGU6ICdjbG9zZScgfCAnd2lkZScgPSAnY2xvc2UnOyBwcml2YXRlIGNhbVRndDogYW55ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIDApO1xuICBzZXRDYW1Nb2RlKG06ICdjbG9zZScgfCAnd2lkZScpIHtcbiAgICB0aGlzLmNhbU1vZGUgPSBtO1xuICAgIGlmIChtID09PSAnd2lkZScgJiYgdGhpcy5iYXR0bGUpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMC45KTtcbiAgICB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgZnJhbWVCYXR0bGUoZHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTsgaWYgKCFiKSByZXR1cm47IGNvbnN0IGFsaXZlID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAoIWFsaXZlLmxlbmd0aCkgcmV0dXJuO1xuICAgIGxldCB4MCA9IDFlOSwgeDEgPSAtMWU5LCB6MCA9IDFlOSwgejEgPSAtMWU5OyBmb3IgKGNvbnN0IGYgb2YgYWxpdmUpIHsgeDAgPSBNYXRoLm1pbih4MCwgZi54KTsgeDEgPSBNYXRoLm1heCh4MSwgZi54KTsgejAgPSBNYXRoLm1pbih6MCwgZi56KTsgejEgPSBNYXRoLm1heCh6MSwgZi56KTsgfVxuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IHdpZGUgPSB0aGlzLnBvc2VzKCkuYmF0dGxlLCBjeCA9ICh4MCArIHgxKSAvIDIsIGN6ID0gKHowICsgejEpIC8gMjtcbiAgICBjb25zdCBkID0gTWF0aC5taW4oTWF0aC5tYXgoKHgxIC0geDAgKyAzLjQpIC8gKDIgKiB0YW5WICogYXNwICogMC45KSwgKHoxIC0gejAgKyAzLjIpIC8gKDIgKiB0YW5WICogMC42MiksIDUuNCksIE1hdGguaHlwb3Qod2lkZS5wb3MueSwgd2lkZS5wb3MueikpO1xuICAgIGNvbnN0IHRndCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3gsIDAuNTUsIGN6KSwgcG9zID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCAtIDAuMDYgKiBkLCAwLjMyICogZCArIDAuNSwgY3ogLSAwLjkgKiBkKTtcbiAgICBjb25zdCBrID0gMSAtIE1hdGguZXhwKC1kdCAqIDIuMCk7XG4gICAgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbWVyYS5wb3NpdGlvbiwgcG9zLCBrKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbVRndCwgdGd0LCBrKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhZ2UgZmxvd1xuICAvKiogRnJlc2ggcnVuIHdpdGggdGhlIGN1cnJlbnRseSBlcXVpcHBlZCBTb3VsIERlY2sgKHRoZSBzaGVsbCdzIENhbXBhaWduID4gUGxheSBidXR0b24gY2FsbHMgdGhpcykuICovXG4gIG5ld1J1bigpIHsgdGhpcy5zdGFydFN0YWdlKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydFN0YWdlKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuc2VlZCA9IHNlZWQ7IHRoaXMuYXR0ZW1wdCA9IDA7IHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uUFJPVE9UWVBFX1JVTEVTLCBwb29sOiBsb2FkU2F2ZSgpLmRlY2sgfSwgc2VlZCk7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy50b2FzdCgnU3RhZ2Ugc3RhcnQ6IDQgY2FyZHMsICcgKyB0aGlzLnMuY2FwICsgJyBEb21pbmlvbi4gU3VtbW9uLCBtZXJnZSwgdGhlbiBwcmVzcyBCQVRUTEUuJyk7XG4gIH1cbiAgcHJpdmF0ZSBjbGVhckJhdHRsZSgpIHtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYuZGlzcG9zZSgpOyB9KTsgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTsgdGhpcy5iYXR0bGUgPSBudWxsO1xuICAgIHRoaXMuYXJyb3dzLmZvckVhY2goKGEpID0+IGEubWVzaC5kaXNwb3NlKCkpOyB0aGlzLmFycm93cyA9IFtdO1xuICB9XG4gIHByaXZhdGUgcG9zKGNlbGw6IG51bWJlcikgeyByZXR1cm4gY2VsbFBvcygwLCBjZWxsKTsgfVxuICBzeW5jQnVpbGQoKSB7XG4gICAgY29uc3QgYWxpdmUgPSBuZXcgU2V0KHRoaXMucy51bml0cy5tYXAoKHUpID0+IHUuaWQpKTtcbiAgICBmb3IgKGNvbnN0IFtpZCwgdl0gb2YgdGhpcy51bml0VmlzKSBpZiAoIWFsaXZlLmhhcyhpZCkpIHsgdGhpcy52aXNUb1VuaXQuZGVsZXRlKHYpOyBjb25zdCBwID0gdi5ob2xkZXIucG9zaXRpb247IHRoaXMuYnVyc3QocC54LCBwLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTYpOyB2LmRpc3Bvc2UoKTsgdGhpcy51bml0VmlzLmRlbGV0ZShpZCk7IH1cbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7XG4gICAgICBsZXQgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpO1xuICAgICAgaWYgKCF2KSB7IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCB1LnNvdWwsIDAsIHUuc3Rhcik7IHRoaXMudW5pdFZpcy5zZXQodS5pZCwgdik7IHRoaXMudmlzVG9Vbml0LnNldCh2LCB1LmlkKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopOyBjb25zdCB2diA9IHY7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB2di5wbGF5KCdpZGxlJyk7IH0pOyB9XG4gICAgICBlbHNlIHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyBpZiAodi5zdGFyICE9PSB1LnN0YXIpIHsgdi5zZXRTdGFyKHUuc3Rhcik7IHYucHVsc2UoKTsgdGhpcy5meFJpbmcocC54LCBwLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjQpLCAwLjIsIDEuNCwgMC42KTsgdGhpcy5idXJzdChwLngsIHAueiwgWzEsIDAuODUsIDAuNCwgMC45XSwgWzAuOCwgMC40LCAxLCAwLjhdLCAyNCk7IH0gfVxuICAgIH1cbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDtcbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5waGFzZSA9PT0gJ2J1aWxkJykge1xuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgY2FuU3VtbW9uKHRoaXMucywgc2VsLmlkeCkgPyAnZnJlZScgOiAnbm9ybWFsJyk7XG4gICAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VGcm9tSGFuZCh0aGlzLnMsIHNlbC5pZHgsIHUuaWQpKSB0aGlzLnRpbnQodS5jZWxsLCAncGFydG5lcicpOyAgICAgLy8gdGhlIGNhcmQgY2FuIG1lcmdlIGludG8gdGhpcyB1bml0XG4gICAgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0Jykge1xuICAgICAgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpO1xuICAgICAgaWYgKHUpIHsgdGhpcy50aW50KHUuY2VsbCwgJ3NlbCcpOyBmb3IgKGNvbnN0IG8gb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VEZXBsb3llZCh1LCBvKSkgdGhpcy50aW50KG8uY2VsbCwgJ3BhcnRuZXInKTsgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgJ2ZyZWUnKTsgfVxuICAgIH1cbiAgfVxuICBwcml2YXRlIHN1bW1vbkZ4KHg6IG51bWJlciwgejogbnVtYmVyKSB7IHRoaXMuYnVyc3QoeCwgeiwgWzAuNywgMC4zLCAxLCAwLjldLCBbMC4zNSwgMC4xLCAwLjcsIDAuOF0sIDMwKTsgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zLCAxKSwgMC4yLCAxLjIsIDAuNyk7IH1cblxuICAvLyAtLS0tIHBsYXllciBhY3Rpb25zIChidWlsZCBwaGFzZSlcbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgdGhpcy51aS50b2FzdChtc2cpOyB9XG4gIG9uQ2FyZChpZHg6IG51bWJlcikge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKGRpc2NhcmRSZWRyYXcodGhpcy5zLCBpZHgpKSB7IHRoaXMudG9hc3QoJ1N3YXBwZWQ6IGRyZXcgYSBkaWZmZXJlbnQgU291bC4nKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5zZWwuaWR4ID09PSBpZHggPyBudWxsIDogeyB0eXBlOiAnY2FyZCcsIGlkeCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVGlsZShjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBoZXJlID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpOyBpZiAoaGVyZSkgeyB0aGlzLm9uVW5pdFZpc3VhbCh0aGlzLnVuaXRWaXMuZ2V0KGhlcmUuaWQpISk7IHJldHVybjsgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJykge1xuICAgICAgaWYgKGNhblN1bW1vbihzLCBzZWwuaWR4KSkgeyBzdW1tb24ocywgc2VsLmlkeCwgY2VsbCk7IHRoaXMuc2VsID0gbnVsbDsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHNvdWwgPSBzLmhhbmRbc2VsLmlkeF07IHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb246ICR7U09VTF9OQU1FW3NvdWxdfSBjb3N0cyAke2Nvc3Qoc291bCwgMSl9LCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTsgfVxuICAgIH0gZWxzZSBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHsgaWYgKG1vdmVVbml0KHMsIHNlbC5pZCwgY2VsbCkpIHRoaXMuc2VsID0gbnVsbDsgfVxuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVW5pdFZpc3VhbCh2OiBVbml0VmlzdWFsKSB7XG4gICAgY29uc3QgaWQgPSB0aGlzLnZpc1RvVW5pdC5nZXQodik7IGlmIChpZCA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCkhO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChzd2FwU2VsbChzLCBpZCkpIHsgdGhpcy50b2FzdChgU29sZCAke1NPVUxfTkFNRVt1LnNvdWxdfTogZHJldyBhIGRpZmZlcmVudCBTb3VsLmApOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KHUuZnJlc2ggPyBcIllvdSBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZC5cIiA6ICdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHMuaGFuZFt0aGlzLnNlbC5pZHhdID09PSB1LnNvdWwgJiYgdS5zdGFyID09PSAxICYmIHMucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInKSB7XG4gICAgICBpZiAobWVyZ2VGcm9tSGFuZChzLCB0aGlzLnNlbC5pZHgsIGlkKSkgeyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgdGhlIGNhcmQgaW50byBhIDItc3RhciAke1NPVUxfTkFNRVt1LnNvdWxdfSFgKTsgfVxuICAgICAgZWxzZSB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uIHRvIG1lcmdlOiBpdCBuZWVkcyAke2Nvc3QodS5zb3VsLCAyKSAtIGNvc3QodS5zb3VsLCAxKX0gbW9yZSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCAhPT0gaWQpIHtcbiAgICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09ICh0aGlzLnNlbCBhcyBhbnkpLmlkKSE7XG4gICAgICBpZiAoY2FuTWVyZ2VEZXBsb3llZChhLCB1KSkgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIHUuaWQpOyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZDogYS5pZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB9IGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgPT09IGlkID8gbnVsbCA6IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG1lcmdlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpOyBjb25zdCBiID0gYSAmJiBzLnVuaXRzLmZpbmQoKG8pID0+IGNhbk1lcmdlRGVwbG95ZWQoYSwgbykpO1xuICAgIGlmIChhICYmIGIpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCBiLmlkKTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMudG9hc3QoJ05vIG1hdGNoaW5nIHVuaXQgKHNhbWUgU291bCBhbmQgc3RhcnMpIHRvIG1lcmdlIHdpdGguJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICByZW1vdmVTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGlmICghdGhpcy5jb25maXJtUmVtb3ZlKSB7IHRoaXMuY29uZmlybVJlbW92ZSA9IHRydWU7IHRoaXMudG9hc3QoJ1RhcCBSZW1vdmUgYWdhaW4gdG8gY29uZmlybS4gVGhlIGNhcmQgaXMgZ29uZSBmb3IgdGhpcyBzdGFnZS4nKTsgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuOyB9XG4gICAgZGlzbWlzcyh0aGlzLnMsIHNlbC5pZCk7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgdG9nZ2xlU3dhcCgpIHsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjsgaWYgKHRoaXMucy5kaXNjYXJkVXNlZCkgeyB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyByZXR1cm47IH0gdGhpcy5zd2FwTW9kZSA9ICF0aGlzLnN3YXBNb2RlOyB0aGlzLnNlbCA9IG51bGw7IGlmICh0aGlzLnN3YXBNb2RlKSB0aGlzLnRvYXN0KCdTd2FwOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCwgb3IgYSB1bml0IChub3Qgc3VtbW9uZWQgdGhpcyByb3VuZCkgdG8gc2VsbC4nKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGJhdHRsZVxuICBzdGFydEJhdHRsZSgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhdGhpcy5zLnVuaXRzLmxlbmd0aCkgeyBpZiAoIXRoaXMucy51bml0cy5sZW5ndGgpIHRoaXMudG9hc3QoJ1N1bW1vbiBhdCBsZWFzdCBvbmUgdW5pdCBmaXJzdC4nKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuYXR0ZW1wdCsrOyB0aGlzLmhhbmRsZWQgPSBmYWxzZTsgdGhpcy5yZXN1bHRBdCA9IC0xO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHVuaXRzID0gcy51bml0cy5zbGljZSgpO1xuICAgIHRoaXMuYmF0dGxlID0gbmV3IEJhdHRsZSh1bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpLCB0aGlzLnNlZWQgKiAxMzEgKyBzLndhdmUgKiAxNyArIHRoaXMuYXR0ZW1wdCk7XG4gICAgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTtcbiAgICB0aGlzLmJhdHRsZS5maWdodGVycy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICBpZiAoZi50ZWFtID09PSAwKSB7IGNvbnN0IHUgPSB1bml0c1tmLmlkIC0gMV07IGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5mVW5pdC5zZXQoZi5pZCwgdS5pZCk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IH1cbiAgICAgIGVsc2UgeyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgZi5zb3VsLCAxLCBmLnN0YXIpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoZi54LCAwLCBmLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gLU1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh2LnN0YXRlID09PSAnc3Bhd24nKSB2LnBsYXkoJ2lkbGUnKTsgfSk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjcsIDAuNiwgMC41LCAwLjddLCBbMC40LCAwLjM1LCAwLjMsIDAuNl0sIDE0KTsgfVxuICAgIH0pO1xuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIHRoaXMucGhhc2UgPSAndHJhbnNpdGlvbic7IHRoaXMuc3RhcnRTdGVwQXQgPSAxLjA7IHRoaXMuYWNjID0gMDsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAyLjIpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgYXBwbHlFdmVudHMoZXZzOiBCRXZlbnRbXSkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSE7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2cykge1xuICAgICAgaWYgKGUudCA9PT0gJ3N3aW5nJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHYucGxheSgnYXR0YWNrJywgZS5zcGVlZCk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2hpdCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS50byk7IGlmICh2KSB2LnB1bHNlKCk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Fycm93JykgeyBjb25zdCBmID0gYi5ieUlkKGUuZnJvbSkhLCB0byA9IGIuYnlJZChlLnRvKSE7IHRoaXMuc3Bhd25BcnJvdyhmLnRlYW0sIGYueCwgZi56LCB0by54LCB0by56LCBlLmR1cik7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2RlYXRoJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHsgdi5wbGF5KCdkZWF0aCcpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDEyKTsgaWYgKGYudGVhbSA9PT0gMSkgdGhpcy5sYXRlcig1LCAoKSA9PiB7IGlmICh0aGlzLmZ2aXMuZ2V0KGUuaWQpID09PSB2ICYmIHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHsgdi5ob2xkZXIuc2V0RW5hYmxlZChmYWxzZSk7IH0gfSk7IH0gfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnY2FzdCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC41LCAwLjgsIDEpLCAwLjE1LCAxLjEsIDAuMzUpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICd0YXVudCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC4zKSwgMC4zLCBCQUxBTkNFLnRhdW50LnJhZGl1cywgMC42KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnc21hc2gnKSB0aGlzLmZ4UmluZyhlLngsIGUueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNSwgMC4yKSwgMC4yLCBlLnIgKiAxLjYsIDAuNDUpO1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHNwYXduQXJyb3codGVhbTogbnVtYmVyLCB4MDogbnVtYmVyLCB6MDogbnVtYmVyLCB4MTogbnVtYmVyLCB6MTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGxldCBtZXNoID0gdGhpcy5hcnJvd01lc2gucG9wKCk7XG4gICAgaWYgKCFtZXNoKSB7IG1lc2ggPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdhcnJvdycsIHsgaGVpZ2h0OiAwLjU1LCBkaWFtZXRlcjogMC4wMzUgfSwgdGhpcy5zY2VuZSk7IG1lc2gucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyBtZXNoLmlzUGlja2FibGUgPSBmYWxzZTsgY29uc3QgaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnYXInLCB0aGlzLnNjZW5lKTsgbWVzaC5wYXJlbnQgPSBob2xkZXI7IG1lc2ggPSBob2xkZXI7IH1cbiAgICBtZXNoLnNldEVuYWJsZWQodHJ1ZSk7IG1lc2guZ2V0Q2hpbGRNZXNoZXMoKVswXS5tYXRlcmlhbCA9IHRoaXMuYXJyb3dNYXRzW3RlYW1dO1xuICAgIHRoaXMuYXJyb3dzLnB1c2goeyBtZXNoLCB4MCwgejAsIHgxLCB6MSwgdDogMCwgZHVyIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmcmFtZShkdDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMuY2FudmFzLmNsaWVudFdpZHRoICE9PSB0aGlzLmxhc3RXIHx8IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCAhPT0gdGhpcy5sYXN0SCkgdGhpcy5oYW5kbGVSZXNpemUoKTsgICAvLyBlLmcuIHRoZSBob21lLXNjcmVlbiBhcHAgcmVzaXppbmcgYWZ0ZXIgbGF1bmNoXG4gICAgZm9yIChsZXQgaSA9IHRoaXMudGltZXJzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IHRoaXMudGltZXJzW2ldLnQgLT0gZHQ7IGlmICh0aGlzLnRpbWVyc1tpXS50IDw9IDApIHsgY29uc3QgZiA9IHRoaXMudGltZXJzW2ldLmZuOyB0aGlzLnRpbWVycy5zcGxpY2UoaSwgMSk7IGYoKTsgfSB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMucmluZ0Z4Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHIgPSB0aGlzLnJpbmdGeFtpXTsgci50ICs9IGR0OyBjb25zdCB1ID0gci50IC8gci5kdXIsIHMgPSByLnIwICsgKHIucjEgLSByLnIwKSAqIHU7IHIubS5zY2FsaW5nLnNldChzLCBzLCBzKTsgci5tbS5hbHBoYSA9IDAuOSAqICgxIC0gdSk7IGlmICh1ID49IDEpIHsgci5tLmRpc3Bvc2UoKTsgci5tbS5kaXNwb3NlKCk7IHRoaXMucmluZ0Z4LnNwbGljZShpLCAxKTsgfSB9XG4gICAgaWYgKHRoaXMuY2FtVCA8IDEpIHsgdGhpcy5jYW1UID0gTWF0aC5taW4oMSwgdGhpcy5jYW1UICsgZHQgLyB0aGlzLmNhbUR1cik7IGNvbnN0IGUgPSB0aGlzLmNhbVQgKiB0aGlzLmNhbVQgKiAoMyAtIDIgKiB0aGlzLmNhbVQpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS5wb3MsIHRoaXMuY2FtVG8ucG9zLCBlKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20udGd0LCB0aGlzLmNhbVRvLnRndCwgZSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnICYmIHRoaXMuY2FtTW9kZSA9PT0gJ2Nsb3NlJykgdGhpcy5mcmFtZUJhdHRsZShkdCk7XG4gICAgZm9yIChjb25zdCB2IG9mIHRoaXMudW5pdFZpcy52YWx1ZXMoKSkgdi51cGRhdGUoZHQpO1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi51cGRhdGUoZHQpOyB9KTtcblxuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTtcbiAgICBpZiAoKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJyB8fCB0aGlzLnBoYXNlID09PSAnYmF0dGxlJykgJiYgYikge1xuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykgeyB0aGlzLnN0YXJ0U3RlcEF0IC09IGR0OyBpZiAodGhpcy5zdGFydFN0ZXBBdCA8PSAwKSB7IHRoaXMucGhhc2UgPSAnYmF0dGxlJzsgdGhpcy51aS5yZW5kZXIoKTsgfSB9XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpIHtcbiAgICAgICAgdGhpcy5hY2MgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTtcbiAgICAgICAgd2hpbGUgKHRoaXMuYWNjID49IDEgLyAzMCAmJiBiLndpbm5lciA8IDApIHsgYi5zdGVwKDEgLyAzMCk7IHRoaXMuYWNjIC09IDEgLyAzMDsgdGhpcy5hcHBseUV2ZW50cyhiLmRyYWluKCkpOyB9XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IGYudGVhbSA9PT0gMSkgeyB2LmhvbGRlci5wb3NpdGlvbi54ID0gZi54OyB2LmhvbGRlci5wb3NpdGlvbi56ID0gZi56OyBpZiAoZi5hbGl2ZSB8fCB0cnVlKSB2LmhvbGRlci5yb3RhdGlvbi55ID0gZi55YXc7IH1cbiAgICAgICAgaWYgKGYuYWxpdmUpIHsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCk7IGlmIChmLm1heE1hbmEpIHYuc2V0TWFuYShmLm1hbmEgLyBmLm1heE1hbmEpOyB9XG4gICAgICAgIGVsc2Ugdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoZi5zdGF0ZSAhPT0gJ2F0dGFjaycgJiYgZi5hbGl2ZSkgeyBjb25zdCB3YW50ID0gZi5zdGF0ZSA9PT0gJ3J1bicgPyAncnVuJyA6ICdpZGxlJzsgaWYgKHRoaXMubGFzdFN0YXRlLmdldChmLmlkKSAhPT0gd2FudCB8fCAodi5zdGF0ZSAhPT0gd2FudCAmJiB2LnN0YXRlICE9PSAnc3Bhd24nKSkgeyBpZiAodi5zdGF0ZSAhPT0gJ3NwYXduJykgeyB2LnBsYXkod2FudCBhcyBhbnkpOyB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgd2FudCk7IH0gfSB9XG4gICAgICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsICdhdHRhY2snKTtcbiAgICAgIH1cbiAgICAgIGlmIChiLndpbm5lciA+PSAwICYmICF0aGlzLmhhbmRsZWQpIHsgdGhpcy5oYW5kbGVkID0gdHJ1ZTsgdGhpcy5yZXN1bHRBdCA9IDEuNDsgfVxuICAgICAgaWYgKHRoaXMucmVzdWx0QXQgPiAwKSB7IHRoaXMucmVzdWx0QXQgLT0gZHQ7IGlmICh0aGlzLnJlc3VsdEF0IDw9IDApIHRoaXMuaGFuZGxlUmVzdWx0KCk7IH1cbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuYXJyb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBhID0gdGhpcy5hcnJvd3NbaV07IGEudCArPSBkdCAqIHRoaXMudGltZVNjYWxlOyBjb25zdCB1ID0gTWF0aC5taW4oMSwgYS50IC8gYS5kdXIpO1xuICAgICAgY29uc3QgcHggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUsIHB6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1LCBweSA9IDAuNzUgKyBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjkgLSB1ICogMC4yNTtcbiAgICAgIGNvbnN0IHUyID0gTWF0aC5taW4oMSwgdSArIDAuMDMpLCBxeCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdTIsIHF6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1MiwgcXkgPSAwLjc1ICsgTWF0aC5zaW4odTIgKiBNYXRoLlBJKSAqIDAuOSAtIHUyICogMC4yNTtcbiAgICAgIGEubWVzaC5wb3NpdGlvbi5zZXQocHgsIHB5LCBweik7IGEubWVzaC5sb29rQXQobmV3IEJBQllMT04uVmVjdG9yMyhxeCwgcXksIHF6KSk7XG4gICAgICBpZiAodSA+PSAxKSB7IGEubWVzaC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5hcnJvd01lc2gucHVzaChhLm1lc2gpOyB0aGlzLmFycm93cy5zcGxpY2UoaSwgMSk7IH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVJlc3VsdCgpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBzID0gdGhpcy5zO1xuICAgIHRoaXMubGFzdEJhdHRsZSA9IGB3YXZlICR7cy53YXZlfSBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fTogJHtiLndpbm5lciA9PT0gMCA/ICdXT04nIDogJ0xPU1QnfSBpbiAke2IudGltZS50b0ZpeGVkKDEpfXMsICR7Yi5jb3VudCgwKX0gb2YgeW91cnMgYW5kICR7Yi5jb3VudCgxKX0gZW5lbWllcyBsZWZ0YDtcbiAgICBpZiAoYi53aW5uZXIgPT09IDApIHtcbiAgICAgIGlmIChhZHZhbmNlV2F2ZShzKSkgeyB0aGlzLnBoYXNlID0gJ3dvbic7IHRoaXMudWkucmVuZGVyKCk7IHJldHVybjsgfVxuICAgICAgdGhpcy5kcmFmdCA9IGRyYWZ0T3B0aW9ucyhzKTsgdGhpcy5waGFzZSA9ICdkcmFmdCc7IHRoaXMudWkucmVuZGVyKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZhaWxXYXZlKHMpO1xuICAgICAgaWYgKHMuc3RhdHVzID09PSAnbG9zdCcpIHsgdGhpcy5waGFzZSA9ICdsb3N0JzsgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuOyB9XG4gICAgICB0aGlzLnRvYXN0KCdZb3VyIGFybXkgZmVsbC4gLTEgaGVhcnQsICsxIGNhcmQsIHNhbWUgd2F2ZS4gUmVidWlsZCBhIGRpZmZlcmVudCBzdHJhdGVneS4nKTsgdGhpcy50b0J1aWxkKCk7XG4gICAgfVxuICB9XG4gIHBpY2tEcmFmdChpZHg6IG51bWJlcikgeyBpZiAoIXRoaXMuZHJhZnQpIHJldHVybjsgdGFrZURyYWZ0KHRoaXMucywgdGhpcy5kcmFmdCwgaWR4KTsgdGhpcy5kcmFmdCA9IG51bGw7IG5vcm1hbERyYXcodGhpcy5zKTsgdGhpcy50b0J1aWxkKCk7IH1cbiAgcHJpdmF0ZSB0b0J1aWxkKCkge1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7ICAgICAgICAgICAgICAgICAgICAgICAvLyByZXN1cnJlY3Rpb246IGV2ZXJ5b25lIHJpc2VzIGFnYWluIGF0IGZ1bGwgaGVhbHRoXG4gICAgICBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYuaG9sZGVyLnNldEVuYWJsZWQodHJ1ZSk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTtcbiAgICAgIHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB2LnBsYXkoJ2lkbGUnKSk7XG4gICAgfVxuICAgIHRoaXMucGhhc2UgPSAnYnVpbGQnOyB0aGlzLnNlbCA9IG51bGw7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJ1aWxkLCAxLjgpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHNldFNwZWVkKGs6IG51bWJlcikgeyB0aGlzLnRpbWVTY2FsZSA9IGs7IHRoaXMudWkucmVuZGVyKCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBoZWxwZXJzXG4gIGFwcGx5QmFsYW5jZUNoYW5nZSgpIHsgdGhpcy51bml0VmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOyBpZiAodSkgdi5zZXRTdGFyKHUuc3Rhcik7IH0pOyB9XG4gIHRlc3RPZGRzKG4gPSAyMDApIHtcbiAgICBjb25zdCBzbG90cyA9IHRoaXMucy51bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVtaWVzID0gZW5lbXlXYXZlKHRoaXMucy53YXZlLCB0aGlzLnNlZWQpOyBsZXQgd2luID0gMCwgdCA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsgY29uc3QgciA9IHNpbXVsYXRlKHNsb3RzLCBlbmVtaWVzLCA1MDAwICsgaSk7IGlmIChyLndpbm5lciA9PT0gMCkgd2luKys7IHQgKz0gci50aW1lOyB9XG4gICAgcmV0dXJuIHsgd2luOiBNYXRoLnJvdW5kKCh3aW4gLyBuKSAqIDEwMCksIGF2Z1RpbWU6ICsodCAvIG4pLnRvRml4ZWQoMSksIG4gfTtcbiAgfVxuICBhZGRDYXJkKHNvdWw6IFNvdWxJZCkgeyB0aGlzLnMuaGFuZC5wdXNoKHNvdWwpOyB0aGlzLnMuc3RhdHMuZHJhd24rKzsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICBhZGREb21pbmlvbihuOiBudW1iZXIpIHsgdGhpcy5zLmNhcCArPSBuOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIHJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIGVuID0gZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKTtcbiAgICByZXR1cm4gW2BzZWVkICR7dGhpcy5zZWVkfSAgd2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfSAgaGVhcnRzICR7cy5oZWFydHN9ICBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0gIHBoYXNlICR7dGhpcy5waGFzZX0gIGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9YCxcbiAgICAgIGBoYW5kOiAke3MuaGFuZC5qb2luKCcsICcpIHx8ICcoZW1wdHkpJ31gLCBgYXJteTogJHtzLnVuaXRzLm1hcCgodSkgPT4gYCR7dS5zb3VsfSR7dS5zdGFyfUAke3UuY2VsbH1gKS5qb2luKCcgJykgfHwgJyhub25lKSd9YCwgYGVuZW15OiAke2VuLm1hcCgoZSkgPT4gZS5zb3VsICsgZS5zdGFyKS5qb2luKCcgJyl9YCxcbiAgICAgIGBkaWZmaWN1bHR5OiAke2RpZmZpY3VsdHlOYW1lfSAgbWVyZ2UtZnJvbS1oYW5kOiAke3MucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInfSAgc3dhcCB1c2VkOiAke3MuZGlzY2FyZFVzZWR9YCwgYGxhc3QgdGFwOiAke3RoaXMubGFzdFRhcEluZm99YCwgYHNjcmVlbjogJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IGRwciAke3dpbmRvdy5kZXZpY2VQaXhlbFJhdGlvfWAsIGBsYXN0IGJhdHRsZTogJHt0aGlzLmxhc3RCYXR0bGUgfHwgJy0nfWAsIGBsb2cgdGFpbDpgLCAuLi5zLmxvZy5zbGljZSgtOCksIGBiYWxhbmNlOiAke0pTT04uc3RyaW5naWZ5KHsgc3RhcjogQkFMQU5DRS5zdGFyLCBzdGF0czogQkFMQU5DRS5zdGF0cyB9KX1gXS5qb2luKCdcXG4nKTtcbiAgfVxuICByZXNldEJhbGFuY2VBbGwoKSB7IHJlc2V0QmFsYW5jZSgpOyB0aGlzLmFwcGx5QmFsYW5jZUNoYW5nZSgpOyB9XG4gIGdldCBkaWZmaWN1bHR5KCkgeyByZXR1cm4gZGlmZmljdWx0eU5hbWU7IH1cbiAgY2hhbmdlRGlmZmljdWx0eShuYW1lOiBzdHJpbmcpIHsgc2V0RGlmZmljdWx0eShuYW1lKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy50b2FzdChgRGlmZmljdWx0eTogJHtuYW1lfS4gQXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUuYCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBnYWxsZXJ5IChzdGFyIGxvb2tzKVxuICBnYWxsZXJ5KCkge1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmFkZCgnZ2FsbGVyeScpOyBjb25zdCB2aXM6IFVuaXRWaXN1YWxbXSA9IFtdOyBsZXQgdGVhbTogMCB8IDEgPSAwO1xuICAgIGNvbnN0IHJlYnVpbGQgPSAoKSA9PiB7IHZpcy5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHZpcy5sZW5ndGggPSAwOyBTT1VMUy5mb3JFYWNoKChzb3VsLCBpKSA9PiBbMSwgMiwgM10uZm9yRWFjaCgoc3QsIGopID0+IHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHNvdWwsIHRlYW0sIHN0KTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KChpIC0gMi41KSAqIDIuNSwgMCwgKGogLSAxKSAqIC0yLjQpOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAqIDAuODU7IHYucGxheSgnaWRsZScpOyB2aXMucHVzaCh2KTsgfSkpOyB9O1xuICAgIHJlYnVpbGQoKTsgdGhpcy5jYW1lcmEucG9zaXRpb24uc2V0KDAsIDUuNiwgLTE0LjUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIC0wLjQpKTsgdGhpcy5jYW1lcmEuZm92ID0gMC44NTtcbiAgICAod2luZG93IGFzIGFueSkuX19nYWxsZXJ5ID0geyBzZXRUZWFtOiAodDogMCB8IDEpID0+IHsgdGVhbSA9IHQ7IHJlYnVpbGQoKTsgfSwgdmlzIH07XG4gICAgbGV0IGxhc3QgPSBwZXJmb3JtYW5jZS5ub3coKTsgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG4gPSBwZXJmb3JtYW5jZS5ub3coKSwgZHQgPSBNYXRoLm1pbigwLjA1LCAobiAtIGxhc3QpIC8gMTAwMCk7IGxhc3QgPSBuOyB2aXMuZm9yRWFjaCgodikgPT4gdi51cGRhdGUoZHQpKTsgdGhpcy5zY2VuZS5yZW5kZXIoKTsgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBHYW1lIH0gZnJvbSAnLi9nYW1lLnRzJztcblxuY29uc3QgZyA9IG5ldyBHYW1lKCk7XG4od2luZG93IGFzIGFueSkuX19nYW1lID0gZzsgICAgICAgICAgICAgICAgICAgICAgIC8vIGhhbmR5IGZvciBkZWJ1Z2dpbmcgZnJvbSB0aGUgYnJvd3NlciBjb25zb2xlXG5nLmluaXQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2MnKSBhcyBIVE1MQ2FudmFzRWxlbWVudClcbiAgLnRoZW4oKCkgPT4geyBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIGwuc3R5bGUuZGlzcGxheSA9ICdub25lJzsgfSlcbiAgLmNhdGNoKChlKSA9PiB7XG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSB7IGwuc3R5bGUuZGlzcGxheSA9ICdmbGV4JzsgbC50ZXh0Q29udGVudCA9ICdFcnJvcjogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IGUpOyB9XG4gICAgY29uc29sZS5lcnJvcihlKTtcbiAgfSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFvQ08sTUFBTSxXQUFvQjtBQUFBLElBQy9CLE9BQU87QUFBQSxNQUNMLFNBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUks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
