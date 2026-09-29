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
  function draw(s, why, not) {
    const pool = not ? SOULS.filter((x) => x !== not) : SOULS;
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
    return [s.rng.pick(SOULS), s.rng.pick(SOULS), s.rng.pick(SOULS)];
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
        const afford = canSummon(s, i);
        el.className = "card" + (sel ? " sel" : "") + (!afford && !g2.swapMode ? " dis" : "") + (g2.swapMode ? " swap" : "");
        el.innerHTML = `<div class="cost">${cost(soul, 1)}</div><div class="ic">${ICON[soul]}</div><div class="nm">${SOUL_NAME[soul]}</div><div class="cs">\u2605</div>`;
        el.title = ROLE_TEXT[soul];
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
      $("info").textContent = build ? g2.swapMode ? "SWAP: tap a hand card to discard it, or tap a unit you did not summon this round to sell it. You draw a different Soul." : selU ? `${SOUL_NAME[selU.soul]} ${stars(selU.star)}  \u2022  ${ROLE_TEXT[selU.soul]}  ${partner ? "\u2022 Tap a glowing partner to merge." : ""}` : g2.sel && g2.sel.type === "card" ? `${SOUL_NAME[s.hand[g2.sel.idx]]}: ${ROLE_TEXT[s.hand[g2.sel.idx]]}  \u2022  Tap a green tile to summon${s.rules.merge === "handIntoOneStar" ? ", or a glowing purple unit to merge the card into it" : ""}.` : "Tap a card, then a tile. Tap a unit to merge, move or remove it." : ph === "battle" || ph === "transition" ? "Battle! Units fight on their own." : "";
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
        this.frame(dt);
        scene.render();
      });
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
    startStage(seed) {
      this.seed = seed;
      this.attempt = 0;
      this.s = newStage(PROTOTYPE_RULES, seed);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2NvcmUvYmF0dGxlLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vZ2FtZS92aXN1YWxzLnRzIiwgIi4uL2dhbWUvdWkudHMiLCAiLi4vZ2FtZS9nYW1lLnRzIiwgIi4uL2dhbWUvbWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gU0lOR0xFIFNPVVJDRSBPRiBUUlVUSCBmb3IgZXZlcnkgbnVtYmVyIHRoYXQgYWZmZWN0cyBjb21iYXQuXG4vLyBUaGUgZGVidWcgcGFuZWwgZWRpdHMgQkFMQU5DRSBsaXZlOyBgcmVzZXRCYWxhbmNlKClgIHJlc3RvcmVzIHRoZXNlIGRlZmF1bHRzLlxuLy8gQWxsIHZhbHVlcyBhcmUgZmlyc3QtcGFzcyBndWVzc2VzIG1lYW50IHRvIGJlIHR1bmVkIGJ5IHBsYXlpbmcgYW5kIGJ5IGBub2RlIHNpbS9jYW1wYWlnbi50c2AuXG5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0U3RhdHMge1xuICBocDogbnVtYmVyOyAgICAgICAgIC8vIDEtc3RhciBoaXQgcG9pbnRzXG4gIGRtZzogbnVtYmVyOyAgICAgICAgLy8gMS1zdGFyIGRhbWFnZSBwZXIgaGl0IChwZXIgYXJyb3cgZm9yIHRoZSBBcmNoZXIpXG4gIGludGVydmFsOiBudW1iZXI7ICAgLy8gc2Vjb25kcyBiZXR3ZWVuIGF0dGFja3NcbiAgcmFuZ2U6IG51bWJlcjsgICAgICAvLyBtZXRyZXMgKGNlbnRyZSB0byBjZW50cmUpXG4gIHNwZWVkOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIHBlciBzZWNvbmRcbiAgc2l6ZTogbnVtYmVyOyAgICAgICAvLyBib2R5IHJhZGl1cywgdXNlZCBmb3Igc3BhY2luZyBhbmQgdmlzdWFsc1xuICBhbmltTGVuOiBudW1iZXI7ICAgIC8vIHNlY29uZHM6IGxlbmd0aCBvZiB0aGlzIHVuaXQncyBhdHRhY2sgY2xpcCBhdCBub3JtYWwgc3BlZWRcbiAgaGl0RnJhYzogbnVtYmVyOyAgICAvLyAwLTE6IGhvdyBmYXIgaW50byB0aGUgY2xpcCB0aGUgYmxvdyBsYW5kcyAvIHRoZSBhcnJvdyBpcyByZWxlYXNlZFxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEJhbGFuY2Uge1xuICBzdGF0czogUmVjb3JkPFNvdWxJZCwgVW5pdFN0YXRzPjtcbiAgc3Rhcjoge1xuICAgIGhwOiBudW1iZXJbXTsgICAgIC8vIG11bHRpcGxpZXIgYXQgMSwgMiwgMyBzdGFyc1xuICAgIGRtZzogbnVtYmVyW107XG4gICAgc2NhbGU6IG51bWJlcltdOyAgLy8gdmlzdWFsIHNpemVcbiAgfTtcbiAgcGhhbGFueDogeyByYWRpdXM6IG51bWJlcjsgcGVyQWxseTogbnVtYmVyOyBtYXhTdGFja3M6IG51bWJlciB9OyAgICAgICAgICAvLyBTa2VsZXRvbiBXYXJyaW9yXG4gIG1hbmE6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgeyBtYXg6IG51bWJlcjsgcGVyQXR0YWNrOiBudW1iZXI7IHBlckhpdDogbnVtYmVyIH0+PjsgLy8gdW5pdHMgV0lUSCBhIHNraWxsOyB0aGUgcmVzdCBhcmUgcGFzc2l2ZS1vbmx5XG4gIHZvbGxleTogeyB0YXJnZXRzOiBudW1iZXI7IHByb2plY3RpbGVTcGVlZDogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgLy8gU2tlbGV0b24gQXJjaGVyIHNraWxsOiBTcGxpdCBBcnJvd1xuICBvcHBvcnR1bmlzdDogeyBib251czogbnVtYmVyOyBzZWVrUmFkaXVzOiBudW1iZXI7IHdvdW5kZWRXZWlnaHQ6IG51bWJlciB9OyAvLyBHb2JsaW5cbiAgdGF1bnQ6IHsgZHVyYXRpb246IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBLbmlnaHQgc2tpbGxcbiAgc21hc2g6IHsgbXVsdDogbnVtYmVyOyByYWRpdXM6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBPZ3JlIHNraWxsXG4gIGZyZW56eTogeyBwZXJTd2luZzogbnVtYmVyOyBtYXhTdGFja3M6IG51bWJlcjsgcmVzZXRBZnRlcjogbnVtYmVyIH07ICAgICAgLy8gQmFyYmFyaWFuXG4gIHNpbTogeyBzZXBhcmF0aW9uOiBudW1iZXI7IGhpdEZyYWN0aW9uOiBudW1iZXI7IHRpbWVMaW1pdDogbnVtYmVyOyByZXRhcmdldEV2ZXJ5OiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRTOiBCYWxhbmNlID0ge1xuICBzdGF0czoge1xuICAgIHdhcnJpb3I6ICAgeyBocDogNjAsICBkbWc6IDgsICBpbnRlcnZhbDogMC45LCByYW5nZTogMC44NSwgc3BlZWQ6IDEuNCwgc2l6ZTogMC4yOCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjQ3IH0sXG4gICAgYXJjaGVyOiAgICB7IGhwOiA0MCwgIGRtZzogNywgIGludGVydmFsOiAxLjcsIHJhbmdlOiA1LjAsICBzcGVlZDogMS4xLCBzaXplOiAwLjI2LCBhbmltTGVuOiAxLjUsIGhpdEZyYWM6IDAuNzggfSxcbiAgICBnb2JsaW46ICAgIHsgaHA6IDQ1LCAgZG1nOiA5LCAgaW50ZXJ2YWw6IDAuOCwgcmFuZ2U6IDAuOCwgIHNwZWVkOiAxLjcsIHNpemU6IDAuMjQsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAga25pZ2h0OiAgICB7IGhwOiAxMzAsIGRtZzogOSwgIGludGVydmFsOiAxLjEsIHJhbmdlOiAwLjksICBzcGVlZDogMS4wLCBzaXplOiAwLjMyLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIG9ncmU6ICAgICAgeyBocDogMTcwLCBkbWc6IDE2LCBpbnRlcnZhbDogMS45LCByYW5nZTogMS4wNSwgc3BlZWQ6IDAuOCwgc2l6ZTogMC40MiwgYW5pbUxlbjogMS4yLCBoaXRGcmFjOiAwLjU1IH0sXG4gICAgYmFyYmFyaWFuOiB7IGhwOiA3NSwgIGRtZzogOCwgIGludGVydmFsOiAwLjk1LCByYW5nZTogMC45LCBzcGVlZDogMS41LCBzaXplOiAwLjMwLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICB9LFxuICAvLyBcImJvZGllcyA9IGRhbWFnZSwgc3RhcnMgPSBkdXJhYmlsaXR5XCI6IEhQIGdyb3dzIGZhc3RlciB0aGFuIGRhbWFnZSBwZXIgc3RhclxuICBzdGFyOiB7IGhwOiBbMSwgMi4wLCAzLjJdLCBkbWc6IFsxLCAxLjUsIDIuMF0sIHNjYWxlOiBbMSwgMS4xMiwgMS4yNV0gfSxcbiAgcGhhbGFueDogeyByYWRpdXM6IDIuMCwgcGVyQWxseTogMC4wOCwgbWF4U3RhY2tzOiAzIH0sXG4gIC8vIG1hbmEgZmlsbHMgZmFzdDogYSBiYXNpYyBhdHRhY2sgZ2l2ZXMgcGVyQXR0YWNrLCB0YWtpbmcgYSBoaXQgZ2l2ZXMgcGVySGl0OyBhIGZ1bGwgYmFyIGZpcmVzIHRoZSBza2lsbCBvbiB0aGUgbmV4dCBhdHRhY2ssIHRoZW4gcmVzZXRzXG4gIG1hbmE6IHtcbiAgICBhcmNoZXI6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMzQsIHBlckhpdDogNiB9LCAgICAgLy8gU3BsaXQgQXJyb3cgYWJvdXQgZXZlcnkgM3JkIHNob3RcbiAgICBvZ3JlOiAgIHsgbWF4OiAxMDAsIHBlckF0dGFjazogMzQsIHBlckhpdDogNiB9LCAgICAgLy8gU21hc2ggYWJvdXQgZXZlcnkgM3JkIHN3aW5nXG4gICAga25pZ2h0OiB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDI1LCBwZXJIaXQ6IDEyIH0sICAgIC8vIFRhdW50IGV2ZXJ5IH40IHN3aW5ncywgc29vbmVyIHdoZW4gaGUgaXMgYmVpbmcgaGl0XG4gIH0sXG4gIHZvbGxleTogeyB0YXJnZXRzOiAzLCBwcm9qZWN0aWxlU3BlZWQ6IDE0IH0sXG4gIG9wcG9ydHVuaXN0OiB7IGJvbnVzOiAwLjUsIHNlZWtSYWRpdXM6IDQuMCwgd291bmRlZFdlaWdodDogMS41IH0sXG4gIHRhdW50OiB7IGR1cmF0aW9uOiAzLCByYWRpdXM6IDQuNSB9LFxuICBzbWFzaDogeyBtdWx0OiAyLjAsIHJhZGl1czogMS42IH0sXG4gIGZyZW56eTogeyBwZXJTd2luZzogMC4xMiwgbWF4U3RhY2tzOiA4LCByZXNldEFmdGVyOiAwLjYgfSxcbiAgc2ltOiB7IHNlcGFyYXRpb246IDAuNiwgaGl0RnJhY3Rpb246IDAuNDcsIHRpbWVMaW1pdDogMTIwLCByZXRhcmdldEV2ZXJ5OiAwLjUgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBCQUxBTkNFOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRCYWxhbmNlKCk6IHZvaWQge1xuICBjb25zdCBmcmVzaDogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGZyZXNoKSBhcyAoa2V5b2YgQmFsYW5jZSlbXSkgKEJBTEFOQ0UgYXMgYW55KVtrXSA9IChmcmVzaCBhcyBhbnkpW2tdO1xufVxuXG5leHBvcnQgY29uc3QgUk9MRV9URVhUOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnQ2hlYXAgYW5kIGZhc3QuIFRvdWdoZXIgbmVhciBvdGhlciBXYXJyaW9ycy4nLFxuICBhcmNoZXI6ICdGcmFnaWxlLiBTa2lsbDogU3BsaXQgQXJyb3cgaGl0cyAzIGRpZmZlcmVudCBlbmVtaWVzLicsXG4gIGdvYmxpbjogJ0Zhc3QuIEhpdHMgaGFyZGVyIG9uIGVuZW1pZXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLicsXG4gIGtuaWdodDogJ1RhbmsuIFNraWxsOiBUYXVudCBwdWxscyBlbmVtaWVzIG9udG8gaGltLicsXG4gIG9ncmU6ICdTbG93LCBodWdlIGRhbWFnZS4gU2tpbGw6IFNtYXNoLCBhIGJpZyBhcmVhIHNsYW0uJyxcbiAgYmFyYmFyaWFuOiAnU3dpbmdzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgaGl0LicsXG59O1xuXG5leHBvcnQgY29uc3QgU09VTF9OQU1FOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnU2tlbGV0b24gV2FycmlvcicsIGFyY2hlcjogJ1NrZWxldG9uIEFyY2hlcicsIGdvYmxpbjogJ0dvYmxpbicsXG4gIGtuaWdodDogJ0tuaWdodCcsIG9ncmU6ICdPZ3JlJywgYmFyYmFyaWFuOiAnQmFyYmFyaWFuJyxcbn07XG4iLCAiLy8gRGVzaWduIGRhdGEgc3RyYWlnaHQgZnJvbSB0aGUgcGxhbiBkb2MuIEFueXRoaW5nIG1hcmtlZCBQTEFDRUhPTERFUiBpcyBub3QgaW4gdGhlIGRvYyB5ZXQuXG5cbmV4cG9ydCB0eXBlIFNvdWxJZCA9ICd3YXJyaW9yJyB8ICdhcmNoZXInIHwgJ2dvYmxpbicgfCAna25pZ2h0JyB8ICdvZ3JlJyB8ICdiYXJiYXJpYW4nO1xuXG5leHBvcnQgY29uc3QgU09VTFM6IFNvdWxJZFtdID0gWyd3YXJyaW9yJywgJ2FyY2hlcicsICdnb2JsaW4nLCAna25pZ2h0JywgJ29ncmUnLCAnYmFyYmFyaWFuJ107XG5cbi8qKiBEb21pbmlvbiBjb3N0IHBlciBzdGFyIGxldmVsOiBpbmRleCAwID0gMSBzdGFyLCAxID0gMiBzdGFycywgMiA9IDMgc3RhcnMgKDMgc3RhcnMgaXMgdGhlIG1heCkuICovXG5leHBvcnQgY29uc3QgQ09TVDogUmVjb3JkPFNvdWxJZCwgbnVtYmVyW10+ID0ge1xuICB3YXJyaW9yOiBbMiwgMywgNF0sXG4gIGFyY2hlcjogWzQsIDYsIDldLFxuICBnb2JsaW46IFszLCA0LCA2XSxcbiAga25pZ2h0OiBbNSwgNywgMTBdLFxuICBvZ3JlOiBbNywgMTAsIDE1XSxcbiAgYmFyYmFyaWFuOiBbNSwgNywgMTBdLCAvLyBQTEFDRUhPTERFUjogdGhlIGRvYyBoYXMgbm8gY29zdCBmb3IgdGhlIHNpeHRoIFNvdWwgeWV0XG59O1xuXG5leHBvcnQgY29uc3QgTUFYX1NUQVIgPSAzO1xuZXhwb3J0IGNvbnN0IEdSSURfQ0VMTFMgPSAxMjsgLy8gNCB4IDNcblxuLyoqIERvbWluaW9uIGNhcCBwZXIgd2F2ZSAoaW5kZXggMCA9IHdhdmUgMSkuICovXG5leHBvcnQgY29uc3QgQ1VSVkVTOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT4gPSB7XG4gIC8vIExPQ0tFRCAoY29uZmlybWVkKTogKzQgZm9yIHdhdmVzIDItNSwgdGhlbiArMyBmb3Igd2F2ZXMgNi0xMCAtPiA0MFxuICBkb2M6IFs5LCAxMywgMTcsIDIxLCAyNSwgMjgsIDMxLCAzNCwgMzcsIDQwXSxcbiAgLy8gTk9UIFVTRUQ6IG1pc3JlbWVtYmVyZWQgdmFyaWFudCAoKzMgdGhyb3VnaCB3YXZlIDYsIHRoZW4gKzIpIHRoYXQgb25seSByZWFjaGVzIDMyLiBLZXB0IGZvciBjb21wYXJpc29uIG9ubHkuXG4gIHJlY2FsbGVkOiBbOSwgMTIsIDE1LCAxOCwgMjEsIDI0LCAyNiwgMjgsIDMwLCAzMl0sXG59O1xuXG5leHBvcnQgY29uc3QgSEVBUlRTID0gMztcbmV4cG9ydCBjb25zdCBTVEFSVF9IQU5EID0gNDtcbmV4cG9ydCBjb25zdCBXQVZFUyA9IDEwO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJ1bGVzIHtcbiAgLyoqIERvbWluaW9uIGNhcCBwZXIgd2F2ZS4gKi9cbiAgY3VydmU6IG51bWJlcltdO1xuICAvKipcbiAgICogJ2RlcGxveWVkT25seSc6IG9ubHkgdHdvIGRlcGxveWVkIHVuaXRzIG9mIHRoZSBzYW1lIHN0YXIgY2FuIG1lcmdlIChkb2MgYXMgd3JpdHRlbikuXG4gICAqICdoYW5kSW50b09uZVN0YXInOiBhZGRpdGlvbmFsbHkgYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBiZSBwbGF5ZWQgb250byBhIGRlcGxveWVkXG4gICAqIDEtc3RhciB1bml0IG9mIHRoZSBzYW1lIFNvdWwgdG8gbWVyZ2UgaW1tZWRpYXRlbHkgKHBheXMgb25seSB0aGUgY29zdCBkaWZmZXJlbmNlKS5cbiAgICovXG4gIG1lcmdlOiAnZGVwbG95ZWRPbmx5JyB8ICdoYW5kSW50b09uZVN0YXInO1xuICAvKiogQ2FyZC1pbmZsb3cga25vYnMgKGFsbCBvcHRpb25hbDsgZGVmYXVsdHMgcmVwcm9kdWNlIHRoZSBkb2MpLiAqL1xuICBzdGFydEhhbmQ/OiBudW1iZXI7ICAgICAgICAgICAgLy8gZGVmYXVsdCA0XG4gIGRyYWZ0UGlja3M/OiBudW1iZXI7ICAgICAgICAgICAvLyBjYXJkcyBrZXB0IGZyb20gdGhlIDMtY2FyZCBWaWN0b3J5IERyYWZ0LCBkZWZhdWx0IDFcbiAgbm9ybWFsRHJhd1dhdmVzPzogbnVtYmVyW107ICAgIC8vIHdhdmVzIChiZWluZyBlbnRlcmVkKSB0aGF0IGFsc28gZ2l2ZSB0aGUgbm9ybWFsIHJhbmRvbSBkcmF3OyBkZWZhdWx0ID0gYWxsXG4gIHN0YWdlV2F2ZXM/OiBudW1iZXI7ICAgICAgICAgICAvLyB3YXZlcyBpbiB0aGlzIHN0YWdlOyBkZWZhdWx0IDEwICh0aGUgcGxheWFibGUgcHJvdG90eXBlIHVzZXMgMylcbn1cblxuZXhwb3J0IGNvbnN0IEdSSURfQ09MUyA9IDQsIEdSSURfUk9XUyA9IDM7ICAgLy8gNCB4IDMgPSBHUklEX0NFTExTOyBjb2x1bW4gR1JJRF9DT0xTLTEgaXMgdGhlIGZyb250IGxpbmVcbiIsICIvLyBTbWFsbCBzZWVkZWQgUk5HIChtdWxiZXJyeTMyKS4gU2FtZSBzZWVkIC0+IHNhbWUgcnVuLCBzbyBhbnkgYnVnIHJlcG9ydCBpcyByZXByb2R1Y2libGUuXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgbmV4dCgpOiBudW1iZXI7ICAgICAgICAgICAgICAvLyBbMCwgMSlcbiAgaW50KG46IG51bWJlcik6IG51bWJlcjsgICAgICAvLyBbMCwgbilcbiAgcGljazxUPihpdGVtczogcmVhZG9ubHkgVFtdKTogVDtcbiAgc2VlZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWFrZVJuZyhzZWVkOiBudW1iZXIpOiBSbmcge1xuICBsZXQgYSA9IHNlZWQgPj4+IDA7XG4gIGNvbnN0IG5leHQgPSAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBhO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBzZWVkLFxuICAgIG5leHQsXG4gICAgaW50OiAobikgPT4gTWF0aC5mbG9vcihuZXh0KCkgKiBuKSxcbiAgICBwaWNrOiAoaXRlbXMpID0+IGl0ZW1zW01hdGguZmxvb3IobmV4dCgpICogaXRlbXMubGVuZ3RoKV0sXG4gIH07XG59XG4iLCAiLy8gUHVyZSBnYW1lIHJ1bGVzIGZvciBvbmUgc3RhZ2UuIE5vIGdyYXBoaWNzLCBubyBjb21iYXQ6IGp1c3QgY2FyZHMsIERvbWluaW9uLCBncmlkLCBtZXJnZSwgd2F2ZXMsIGhlYXJ0cy5cbi8vIEV2ZXJ5IG11dGF0aW9uIGdvZXMgdGhyb3VnaCBhIGZ1bmN0aW9uIGhlcmUgYW5kIGFwcGVuZHMgdG8gc3RhdGUubG9nLCBzbyBydW5zIGNhbiBiZSByZXBsYXllZCBhbmQgaW5zcGVjdGVkLlxuXG5pbXBvcnQgeyBDT1NULCBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUywgU1RBUlRfSEFORCwgV0FWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0IHsgaWQ6IG51bWJlcjsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjsgZnJlc2g/OiBib29sZWFuIH0gICAvLyBmcmVzaCA9IHN1bW1vbmVkIHRoaXMgYnVpbGQgcGhhc2VcblxuZXhwb3J0IGludGVyZmFjZSBTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlcztcbiAgcm5nOiBSbmc7XG4gIHdhdmU6IG51bWJlcjsgICAgICAgICAgICAgICAgIC8vIDEtYmFzZWRcbiAgaGVhcnRzOiBudW1iZXI7XG4gIGNhcDogbnVtYmVyO1xuICBoYW5kOiBTb3VsSWRbXTtcbiAgdW5pdHM6IFVuaXRbXTtcbiAgbmV4dElkOiBudW1iZXI7XG4gIGRpc2NhcmRVc2VkOiBib29sZWFuOyAgICAgICAgIC8vIG9uY2UtcGVyLWJ1aWxkLXBoYXNlIHJlZHJhd1xuICBzdGF0dXM6ICdidWlsZGluZycgfCAnd29uJyB8ICdsb3N0JztcbiAgbG9nOiBzdHJpbmdbXTtcbiAgc3RhdHM6IHsgZHJhd246IG51bWJlcjsgZGlzY2FyZGVkOiBudW1iZXI7IGRpc21pc3NlZDogbnVtYmVyOyBtZXJnZXM6IG51bWJlcjsgZmFpbHVyZXM6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgY29zdCA9IChzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlcik6IG51bWJlciA9PiBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbmV4cG9ydCBjb25zdCBjYXJkc0luID0gKHN0YXI6IG51bWJlcik6IG51bWJlciA9PiAyICoqIChzdGFyIC0gMSk7ICAgICAvLyBjYXJkcyBhIHVuaXQgaXMgXCJ3b3J0aFwiXG5leHBvcnQgY29uc3QgZG9taW5pb25Vc2VkID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY29zdCh1LnNvdWwsIHUuc3RhciksIDApO1xuZXhwb3J0IGNvbnN0IGRvbWluaW9uRnJlZSA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLmNhcCAtIGRvbWluaW9uVXNlZChzKTtcblxuZnVuY3Rpb24gbG9nKHM6IFN0YXRlLCBtc2c6IHN0cmluZykgeyBzLmxvZy5wdXNoKGBbdyR7cy53YXZlfV0gJHttc2d9YCk7IH1cbmZ1bmN0aW9uIGRyYXcoczogU3RhdGUsIHdoeTogc3RyaW5nLCBub3Q/OiBTb3VsSWQpOiBTb3VsSWQge1xuICBjb25zdCBwb29sID0gbm90ID8gU09VTFMuZmlsdGVyKCh4KSA9PiB4ICE9PSBub3QpIDogU09VTFM7ICAgICAgLy8gYSBzd2FwIG5ldmVyIGhhbmRzIHlvdSBiYWNrIHRoZSBTb3VsIHlvdSBnYXZlIHVwXG4gIGNvbnN0IGMgPSBzLnJuZy5waWNrKHBvb2wpO1xuICBzLmhhbmQucHVzaChjKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYXcgJHtjfSAoJHt3aHl9KWApO1xuICByZXR1cm4gYztcbn1cblxuLyoqIEEgbmV3IGJ1aWxkIHBoYXNlIGJlZ2luczogdGhlIG9uY2UtcGVyLXBoYXNlIHN3YXAgY29tZXMgYmFjayBhbmQgbm90aGluZyBjb3VudHMgYXMgXCJzdW1tb25lZCB0aGlzIHJvdW5kXCIuICovXG5leHBvcnQgZnVuY3Rpb24gbmV3UGhhc2UoczogU3RhdGUpOiB2b2lkIHtcbiAgcy5kaXNjYXJkVXNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgdS5mcmVzaCA9IGZhbHNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3U3RhZ2UocnVsZXM6IFJ1bGVzLCBzZWVkOiBudW1iZXIpOiBTdGF0ZSB7XG4gIGNvbnN0IHM6IFN0YXRlID0ge1xuICAgIHJ1bGVzLCBybmc6IG1ha2VSbmcoc2VlZCksIHdhdmU6IDEsIGhlYXJ0czogSEVBUlRTLCBjYXA6IHJ1bGVzLmN1cnZlWzBdLCBoYW5kOiBbXSwgdW5pdHM6IFtdLCBuZXh0SWQ6IDEsXG4gICAgZGlzY2FyZFVzZWQ6IGZhbHNlLCBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogW10sXG4gICAgc3RhdHM6IHsgZHJhd246IDAsIGRpc2NhcmRlZDogMCwgZGlzbWlzc2VkOiAwLCBtZXJnZXM6IDAsIGZhaWx1cmVzOiAwIH0sXG4gIH07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgKHJ1bGVzLnN0YXJ0SGFuZCA/PyBTVEFSVF9IQU5EKTsgaSsrKSBkcmF3KHMsICdzdGFydGluZyBoYW5kJyk7XG4gIHJldHVybiBzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlZUNlbGwoczogU3RhdGUpOiBudW1iZXIge1xuICBjb25zdCB0YWtlbiA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKCF0YWtlbi5oYXMoYykpIHJldHVybiBjO1xuICByZXR1cm4gLTE7XG59XG5cbi8vIC0tLS0gYnVpbGQtcGhhc2UgYWN0aW9ucyAoZWFjaCByZXR1cm5zIHRydWUgd2hlbiBpdCBoYXBwZW5lZCkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5TdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdO1xuICByZXR1cm4gc291bCAhPT0gdW5kZWZpbmVkICYmIGZyZWVDZWxsKHMpID49IDAgJiYgY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjZWxsRnJlZShzOiBTdGF0ZSwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIHJldHVybiBjZWxsID49IDAgJiYgY2VsbCA8IEdSSURfQ0VMTFMgJiYgIXMudW5pdHMuc29tZSgodSkgPT4gdS5jZWxsID09PSBjZWxsKTtcbn1cblxuLyoqIFN1bW1vbiBhIGhhbmQgY2FyZCBvbnRvIGEgc3BlY2lmaWMgZnJlZSBjZWxsIChkZWZhdWx0OiB0aGUgZmlyc3QgZnJlZSBvbmUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCBjZWxsPzogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3VtbW9uKHMsIGhhbmRJZHgpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChjZWxsICE9PSB1bmRlZmluZWQgJiYgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1OiBVbml0ID0geyBpZDogcy5uZXh0SWQrKywgc291bCwgc3RhcjogMSwgY2VsbDogY2VsbCA/PyBmcmVlQ2VsbChzKSwgZnJlc2g6IHRydWUgfTtcbiAgcy51bml0cy5wdXNoKHUpO1xuICBsb2cocywgYHN1bW1vbiAke3NvdWx9IDEqIC0+IGNlbGwgJHt1LmNlbGx9ICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRGVwbG95ZWQoYTogVW5pdCwgYjogVW5pdCk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5pZCAhPT0gYi5pZCAmJiBhLnNvdWwgPT09IGIuc291bCAmJiBhLnN0YXIgPT09IGIuc3RhciAmJiBhLnN0YXIgPCBNQVhfU1RBUjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRGVwbG95ZWQoczogU3RhdGUsIGFJZDogbnVtYmVyLCBiSWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCBhID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBhSWQpLCBiID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmlkID09PSBiSWQpO1xuICBpZiAoIWEgfHwgIWIgfHwgIWNhbk1lcmdlRGVwbG95ZWQoYSwgYikpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh1KSA9PiB1LmlkICE9PSBiLmlkKTtcbiAgYS5mcmVzaCA9ICEhKGEuZnJlc2ggfHwgYi5mcmVzaCk7XG4gIGEuc3RhcisrO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlICR7YS5zb3VsfSAke2Euc3RhciAtIDF9Kiske2Euc3RhciAtIDF9KiAtPiAke2Euc3Rhcn0qICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9LCBjZWxscyAke3MudW5pdHMubGVuZ3RofS8ke0dSSURfQ0VMTFN9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqICdoYW5kSW50b09uZVN0YXInIHJ1bGU6IHBsYXkgYSAxLXN0YXIgY2FyZCBvbnRvIGEgZGVwbG95ZWQgMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLnJ1bGVzLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kW2hhbmRJZHhdLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXNvdWwgfHwgIXUgfHwgdS5zb3VsICE9PSBzb3VsIHx8IHUuc3RhciAhPT0gMSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gY29zdChzb3VsLCAyKSAtIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhbk1lcmdlRnJvbUhhbmQocywgaGFuZElkeCwgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHUuc3RhciA9IDI7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UtZnJvbS1oYW5kICR7c291bH0gLT4gJHt1LnNvdWx9IDIqICAoZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9KWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRpc21pc3MoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBkaXNtaXNzICR7dS5zb3VsfSAke3Uuc3Rhcn0qIChwZXJtYW5lbnRseSByZW1vdmVkKWApO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDE6IGRpc2NhcmQgYSBoYW5kIGNhcmQgYW5kIGRyYXcgYSByYW5kb20gY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2NhcmRSZWRyYXcoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5kaXNjYXJkVXNlZCB8fCBoYW5kSWR4IDwgMCB8fCBoYW5kSWR4ID49IHMuaGFuZC5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgYyA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc2NhcmRlZCsrO1xuICBsb2cocywgYHN3YXA6IGRpc2NhcmQgJHtjfWApO1xuICBkcmF3KHMsICdzd2FwJywgYyk7XG4gIHJldHVybiB0cnVlO1xufVxuZXhwb3J0IGNvbnN0IHN3YXBEaXNjYXJkID0gZGlzY2FyZFJlZHJhdztcblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICByZXR1cm4gIXMuZGlzY2FyZFVzZWQgJiYgISF1ICYmICF1LmZyZXNoOyAgICAgICAgICAvLyBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZFxufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMjogc2VsbCBhIGRlcGxveWVkIHVuaXQgKG5vdCBvbmUgc3VtbW9uZWQgdGhpcyByb3VuZCkgYW5kIGRyYXcgYSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gc3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuU3dhcFNlbGwocywgdW5pdElkKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYHN3YXA6IHNlbGwgJHt1LnNvdWx9ICR7dS5zdGFyfSpgKTtcbiAgZHJhdyhzLCAnc3dhcCcsIHUuc291bCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbW92ZVVuaXQoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1IHx8ICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBsb2cocywgYG1vdmUgJHt1LnNvdWx9IGNlbGwgJHt1LmNlbGx9IC0+ICR7Y2VsbH1gKTsgdS5jZWxsID0gY2VsbDsgcmV0dXJuIHRydWU7XG59XG5cbi8vIC0tLS0gd2F2ZSByZXN1bHRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERyYWZ0IGNob2ljZXMgZm9yIGFmdGVyIGEgY2xlYXJlZCB3YXZlOiAzIHJhbmRvbSBjYXJkcywgZHVwbGljYXRlcyBhbGxvd2VkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRyYWZ0T3B0aW9ucyhzOiBTdGF0ZSk6IFNvdWxJZFtdIHtcbiAgcmV0dXJuIFtzLnJuZy5waWNrKFNPVUxTKSwgcy5ybmcucGljayhTT1VMUyksIHMucm5nLnBpY2soU09VTFMpXTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZDogcmFpc2UgdGhlIGNhcCwgcmVzb2x2ZSB0aGUgVmljdG9yeSBEcmFmdCwgZHJhdyAxIG5vcm1hbCBjYXJkLiAqL1xuZXhwb3J0IGNvbnN0IHN0YWdlV2F2ZXMgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5ydWxlcy5zdGFnZVdhdmVzID8/IFdBVkVTO1xuXG4vKiogU3RlcCAxIG9mIGEgY2xlYXJlZCB3YXZlOiBpcyB0aGUgc3RhZ2Ugb3Zlcj8gSWYgbm90LCByYWlzZSB0aGUgY2FwIGFuZCBzdGFydCB0aGUgbmV4dCBidWlsZCBwaGFzZS4gUmV0dXJucyB0cnVlIHdoZW4gdGhlIHN0YWdlIGlzIHdvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZhbmNlV2F2ZShzOiBTdGF0ZSk6IGJvb2xlYW4ge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBzLnN0YXR1cyA9PT0gJ3dvbic7XG4gIGlmIChzLndhdmUgPj0gc3RhZ2VXYXZlcyhzKSkgeyBzLnN0YXR1cyA9ICd3b24nOyBsb2cocywgJ3N0YWdlIGNsZWFyZWQnKTsgcmV0dXJuIHRydWU7IH1cbiAgcy53YXZlKys7XG4gIHMuY2FwID0gcy5ydWxlcy5jdXJ2ZVtzLndhdmUgLSAxXTtcbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgd2F2ZSBjbGVhcmVkIC0+IGNhcCAke3MuY2FwfWApO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTdGVwIDI6IHRoZSBwbGF5ZXIga2VwdCBgaWR4YCBmcm9tIHRoZSBvZmZlcmVkIGRyYWZ0IGNhcmRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRha2VEcmFmdChzOiBTdGF0ZSwgb3B0czogU291bElkW10sIGlkeDogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IHBpY2sgPSBvcHRzW01hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgaWR4KSldO1xuICBzLmhhbmQucHVzaChwaWNrKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYWZ0IFske29wdHMuam9pbignLCAnKX1dIC0+IHRvb2sgJHtwaWNrfWApO1xufVxuXG4vKiogU3RlcCAzOiB0aGUgYm9udXMgbm9ybWFsIGRyYXcgKG9ubHkgb24gdGhlIHdhdmVzIHRoZSBydWxlcyBhbGxvdykuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsRHJhdyhzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMgPyBzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcy5pbmNsdWRlcyhzLndhdmUpIDogdHJ1ZSkgZHJhdyhzLCAnd2F2ZSBjbGVhcicpO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkIChhbGwgdGhyZWUgc3RlcHMgaW4gb25lIGNhbGwsIGZvciBzaW11bGF0aW9ucykuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJXYXZlKHM6IFN0YXRlLCBjaG9vc2U6IChvcHRzOiBTb3VsSWRbXSkgPT4gbnVtYmVyKTogdm9pZCB7XG4gIGlmIChhZHZhbmNlV2F2ZShzKSkgcmV0dXJuO1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgbGV0IG9wdHMgPSBkcmFmdE9wdGlvbnMocyk7XG4gIGNvbnN0IG9mZmVyZWQgPSBvcHRzLmpvaW4oJywgJyk7XG4gIGNvbnN0IHRvb2s6IFNvdWxJZFtdID0gW107XG4gIGZvciAobGV0IHAgPSAwOyBwIDwgKHMucnVsZXMuZHJhZnRQaWNrcyA/PyAxKTsgcCsrKSB7XG4gICAgY29uc3QgaWR4ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBjaG9vc2Uob3B0cykpKTtcbiAgICB0b29rLnB1c2gob3B0c1tpZHhdKTsgcy5oYW5kLnB1c2gob3B0c1tpZHhdKTsgcy5zdGF0cy5kcmF3bisrO1xuICAgIG9wdHMgPSBvcHRzLmZpbHRlcigoXywgaSkgPT4gaSAhPT0gaWR4KTtcbiAgfVxuICBsb2cocywgYGRyYWZ0IFske29mZmVyZWR9XSAtPiB0b29rICR7dG9vay5qb2luKCcsICcpfWApO1xuICBub3JtYWxEcmF3KHMpO1xufVxuXG4vKiogQXJteSB3aXBlZDogbG9zZSBhIGhlYXJ0LCBjYXAgZG9lcyBOT1QgcmlzZSwgZW5lbWllcyByZXNldCwgKzEgY2FyZCwgcmVkcmF3IGFsbG93ZWQgYWdhaW4uICovXG5leHBvcnQgZnVuY3Rpb24gZmFpbFdhdmUoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIHMuaGVhcnRzLS07IHMuc3RhdHMuZmFpbHVyZXMrKztcbiAgaWYgKHMuaGVhcnRzIDw9IDApIHsgcy5zdGF0dXMgPSAnbG9zdCc7IGxvZyhzLCAnbm8gaGVhcnRzIGxlZnQ6IHN0YWdlIGxvc3QnKTsgcmV0dXJuOyB9XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYGFybXkgd2lwZWQ6IGhlYXJ0cyAke3MuaGVhcnRzfSwgY2FwIHN0YXlzICR7cy5jYXB9YCk7XG4gIGRyYXcocywgJ2ZhaWxlZCBhdHRlbXB0Jyk7XG59XG5cbi8vIC0tLS0gaW52YXJpYW50cyAoY2FsbGVkIGJ5IHRoZSBzaW11bGF0b3IgYWZ0ZXIgZXZlcnkgd2F2ZTsgdGhyb3cgd2l0aCBhIHJlYWRhYmxlIG1lc3NhZ2UpIC0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrSW52YXJpYW50cyhzOiBTdGF0ZSk6IHZvaWQge1xuICBjb25zdCBmYWlsID0gKG06IHN0cmluZykgPT4geyB0aHJvdyBuZXcgRXJyb3IoYElOVkFSSUFOVCAke219XFxuYCArIHMubG9nLnNsaWNlKC0xMikuam9pbignXFxuJykpOyB9O1xuICBpZiAocy51bml0cy5sZW5ndGggPiBHUklEX0NFTExTKSBmYWlsKGBtb3JlIHVuaXRzICgke3MudW5pdHMubGVuZ3RofSkgdGhhbiBjZWxsc2ApO1xuICBjb25zdCBjZWxscyA9IG5ldyBTZXQocy51bml0cy5tYXAoKHUpID0+IHUuY2VsbCkpO1xuICBpZiAoY2VsbHMuc2l6ZSAhPT0gcy51bml0cy5sZW5ndGgpIGZhaWwoJ3R3byB1bml0cyBzaGFyZSBhIGNlbGwnKTtcbiAgaWYgKGRvbWluaW9uVXNlZChzKSA+IHMuY2FwKSBmYWlsKGBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0gZXhjZWVkcyBjYXAgJHtzLmNhcH1gKTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIGlmICh1LnN0YXIgPCAxIHx8IHUuc3RhciA+IE1BWF9TVEFSKSBmYWlsKGB1bml0IHN0YXIgJHt1LnN0YXJ9IG91dCBvZiByYW5nZWApO1xuICAvLyBldmVyeSBkcmF3biBjYXJkIGlzIGVpdGhlciBpbiBoYW5kLCB3b3J0aCBjYXJkcyBvbiB0aGUgZmllbGQsIGRpc2NhcmRlZCwgb3IgZGlzbWlzc2VkXG4gIGNvbnN0IG9uRmllbGQgPSBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNhcmRzSW4odS5zdGFyKSwgMCk7XG4gIGNvbnN0IGFjY291bnRlZCA9IHMuaGFuZC5sZW5ndGggKyBvbkZpZWxkICsgcy5zdGF0cy5kaXNjYXJkZWQgKyBzLnN0YXRzLmRpc21pc3NlZDtcbiAgaWYgKGFjY291bnRlZCAhPT0gcy5zdGF0cy5kcmF3bikgZmFpbChgY2FyZCBjb25zZXJ2YXRpb246IGRyYXduICR7cy5zdGF0cy5kcmF3bn0gIT0gYWNjb3VudGVkICR7YWNjb3VudGVkfWApO1xufVxuIiwgIi8vIEF1dG8tYmF0dGxlIHNpbXVsYXRpb246IHB1cmUgbG9naWMsIG5vIGdyYXBoaWNzLiBEZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHNlZWQuXG4vLyBUaGUgcmVuZGVyZXIgb25seSByZWFkcyBmaWdodGVycyArIGV2ZW50czsgaXQgbmV2ZXIgZGVjaWRlcyBhbnl0aGluZy5cbi8vXG4vLyBBYmlsaXRpZXMgKG51bWJlcnMgbGl2ZSBpbiBiYWxhbmNlLnRzKTpcbi8vICAgU2tlbGV0b24gV2FycmlvciAgUGhhbGFueCAgICAgdGFrZXMgbGVzcyBkYW1hZ2UgZm9yIGVhY2ggbmVhcmJ5IGFsbGllZCBXYXJyaW9yIChjYXBwZWQpXG4vLyAgIFNrZWxldG9uIEFyY2hlciAgIFNwbGl0IEFycm93IChza2lsbCkgb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllczsgYmFzaWMgc2hvdHMgYXJlIGEgc2luZ2xlIGFycm93XG4vLyAgIEdvYmxpbiAgICAgICAgICAgIE9wcG9ydHVuaXN0ICtkYW1hZ2Ugb24gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2U7IHByZWZlcnMgc3VjaCB0YXJnZXRzXG4vLyAgIEtuaWdodCAgICAgICAgICAgIFRhdW50IChza2lsbCkgIGZvcmNlcyBuZWFyYnkgZW5lbWllcyB0byBhdHRhY2sgaGltXG4vLyAgIE9ncmUgICAgICAgICAgICAgIFNtYXNoIChza2lsbCkgIGhlYXZ5IHNsYW0gdGhhdCBhbHNvIGhpdHMgZW5lbWllcyBuZWFyIHRoZSBpbXBhY3Rcbi8vIFNraWxscyBydW4gb24gbWFuYTogYmFzaWMgYXR0YWNrcyBhbmQgZGFtYWdlIHRha2VuIGZpbGwgYSBiYXI7IHdoZW4gZnVsbCwgdGhlIG5leHQgYXR0YWNrIGlzIHRoZSBza2lsbCBhbmQgdGhlIGJhciByZXNldHMuXG4vLyBXYXJyaW9yLCBHb2JsaW4gYW5kIEJhcmJhcmlhbiBoYXZlIHBhc3NpdmVzIG9ubHkgKG5vIG1hbmEpLlxuLy8gICBCYXJiYXJpYW4gICAgICAgICBGcmVuenkgICAgICBhdHRhY2tzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmdcblxuaW1wb3J0IHsgR1JJRF9DT0xTLCBHUklEX1JPV1MgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBjb25zdCBHUklEX1NQID0gMS4zOyAgICAgLy8gbWV0cmVzIGJldHdlZW4gZ3JpZCBjZWxsc1xuZXhwb3J0IGNvbnN0IEZST05UX1ggPSAxLjc7ICAgICAvLyBmcm9udCBsaW5lJ3MgZGlzdGFuY2UgZnJvbSB0aGUgY2VudHJlIGxpbmVcblxuZXhwb3J0IGludGVyZmFjZSBTbG90IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5cbi8qKiBXb3JsZCBwb3NpdGlvbiBvZiBhIGdyaWQgY2VsbCBmb3IgYSB0ZWFtICh0ZWFtIDAgPSBsZWZ0LCBmYWNlcyArWDsgdGVhbSAxID0gcmlnaHQsIGZhY2VzIC1YKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjZWxsUG9zKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpOiB7IHg6IG51bWJlcjsgejogbnVtYmVyIH0ge1xuICBjb25zdCByb3cgPSBNYXRoLmZsb29yKGNlbGwgLyBHUklEX0NPTFMpLCBjb2wgPSBjZWxsICUgR1JJRF9DT0xTO1xuICBjb25zdCBkZXB0aCA9IEdSSURfQ09MUyAtIDEgLSBjb2w7ICAgICAgICAgICAgICAgICAgICAgICAvLyAwID0gZnJvbnQgbGluZVxuICByZXR1cm4geyB4OiAoRlJPTlRfWCArIGRlcHRoICogR1JJRF9TUCkgKiAodGVhbSA9PT0gMCA/IC0xIDogMSksIHo6IChyb3cgLSAoR1JJRF9ST1dTIC0gMSkgLyAyKSAqIEdSSURfU1AgfTtcbn1cblxuY29uc3QgRlJPTlRORVNTOiBSZWNvcmQ8U291bElkLCBudW1iZXI+ID0geyBrbmlnaHQ6IDUsIG9ncmU6IDQsIHdhcnJpb3I6IDMsIGJhcmJhcmlhbjogMywgZ29ibGluOiAyLCBhcmNoZXI6IDAgfTtcbi8qKiBUaGUgZW5lbXkgYXJteSBpcyBwbGFjZWQgYXV0b21hdGljYWxseSAodGFua3MgdXAgZnJvbnQsIGFyY2hlcnMgYmVoaW5kKTsgdGhlIHBsYXllciBvbmx5IGV2ZXIgc2VlcyBpdHMgY29tcG9zaXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlDZWxscyhzcGVjczogU3BlY1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBjZWxsczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NPTFMgKiBHUklEX1JPV1M7IGMrKykgY2VsbHMucHVzaChjKTtcbiAgY2VsbHMuc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IGRhID0gR1JJRF9DT0xTIC0gMSAtIChhICUgR1JJRF9DT0xTKSwgZGIgPSBHUklEX0NPTFMgLSAxIC0gKGIgJSBHUklEX0NPTFMpO1xuICAgIGlmIChkYSAhPT0gZGIpIHJldHVybiBkYSAtIGRiO1xuICAgIHJldHVybiBNYXRoLmFicyhNYXRoLmZsb29yKGEgLyBHUklEX0NPTFMpIC0gMSkgLSBNYXRoLmFicyhNYXRoLmZsb29yKGIgLyBHUklEX0NPTFMpIC0gMSk7XG4gIH0pO1xuICBjb25zdCBvcmRlciA9IHNwZWNzLm1hcCgocywgaSkgPT4gaSkuc29ydCgoaSwgaikgPT4gRlJPTlRORVNTW3NwZWNzW2pdLnNvdWxdIC0gRlJPTlRORVNTW3NwZWNzW2ldLnNvdWxdKTtcbiAgY29uc3Qgb3V0ID0gbmV3IEFycmF5PG51bWJlcj4oc3BlY3MubGVuZ3RoKTtcbiAgb3JkZXIuZm9yRWFjaCgoaWR4LCBrKSA9PiB7IG91dFtpZHhdID0gY2VsbHNba107IH0pO1xuICByZXR1cm4gb3V0O1xufVxuXG5leHBvcnQgdHlwZSBGU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYWQnO1xuZXhwb3J0IGludGVyZmFjZSBGaWdodGVyIHtcbiAgaWQ6IG51bWJlcjsgdGVhbTogMCB8IDE7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7XG4gIHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc6IG51bWJlcjtcbiAgaHA6IG51bWJlcjsgbWF4SHA6IG51bWJlcjsgZG1nOiBudW1iZXI7IGludGVydmFsOiBudW1iZXI7IHJhbmdlOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IHJhZGl1czogbnVtYmVyO1xuICBhbGl2ZTogYm9vbGVhbjsgc3RhdGU6IEZTdGF0ZTtcbiAgdGFyZ2V0OiBudW1iZXI7IHJldGFyZ2V0QXQ6IG51bWJlcjsgZm9yY2VkVGFyZ2V0OiBudW1iZXI7IGZvcmNlZFVudGlsOiBudW1iZXI7XG4gIG5leHRBdHRhY2s6IG51bWJlcjsgYXR0YWNrU3RhcnQ6IG51bWJlcjsgYXR0YWNrRHVyOiBudW1iZXI7IGFuaW1TcGVlZDogbnVtYmVyOyBoaXREb25lOiBib29sZWFuO1xuICBtYW5hOiBudW1iZXI7IG1heE1hbmE6IG51bWJlcjsgY2FzdGluZzogYm9vbGVhbjsgZnJlbnp5OiBudW1iZXI7IGRlYWRBdDogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBCRXZlbnQgPVxuICB8IHsgdDogJ3N3aW5nJzsgaWQ6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2hpdCc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXI7IGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAnYXJyb3cnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdkZWF0aCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ2Nhc3QnOyBpZDogbnVtYmVyOyBza2lsbDogJ3NwbGl0JyB8ICd0YXVudCcgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICd0YXVudCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ3NtYXNoJzsgaWQ6IG51bWJlcjsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHI6IG51bWJlciB9XG4gIHwgeyB0OiAnZnJlbnp5JzsgaWQ6IG51bWJlcjsgc3RhY2tzOiBudW1iZXIgfTtcblxuZXhwb3J0IGNsYXNzIEJhdHRsZSB7XG4gIHRpbWUgPSAwO1xuICBmaWdodGVyczogRmlnaHRlcltdID0gW107XG4gIGV2ZW50czogQkV2ZW50W10gPSBbXTtcbiAgd2lubmVyOiAtMSB8IDAgfCAxID0gLTE7XG4gIHJuZzogUm5nO1xuICBwcml2YXRlIHBlbmRpbmc6IHsgYXQ6IG51bWJlcjsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlciB9W10gPSBbXTtcbiAgcHJpdmF0ZSBuZXh0SWQgPSAxO1xuICBwcml2YXRlIGZsaXAgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEpIHtcbiAgICB0aGlzLnJuZyA9IG1ha2VSbmcoc2VlZCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHBsYXllcnMpIHRoaXMuYWRkKDAsIHAuc291bCwgcC5zdGFyLCBwLmNlbGwpO1xuICAgIGNvbnN0IGNlbGxzID0gZW5lbXlDZWxscyhlbmVtaWVzKTtcbiAgICBlbmVtaWVzLmZvckVhY2goKGUsIGkpID0+IHRoaXMuYWRkKDEsIGUuc291bCwgZS5zdGFyLCBjZWxsc1tpXSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIpOiBGaWdodGVyIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW3NvdWxdLCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKTtcbiAgICBjb25zdCBocCA9IHN0LmhwICogQi5zdGFyLmhwW3N0YXIgLSAxXTtcbiAgICBjb25zdCBmOiBGaWdodGVyID0ge1xuICAgICAgaWQ6IHRoaXMubmV4dElkKyssIHRlYW0sIHNvdWwsIHN0YXIsIGNlbGwsIHg6IHAueCwgejogcC56LCB5YXc6IHRlYW0gPT09IDAgPyAwIDogTWF0aC5QSSxcbiAgICAgIGhwLCBtYXhIcDogaHAsIGRtZzogc3QuZG1nICogQi5zdGFyLmRtZ1tzdGFyIC0gMV0sIGludGVydmFsOiBzdC5pbnRlcnZhbCwgcmFuZ2U6IHN0LnJhbmdlLCBzcGVlZDogc3Quc3BlZWQsIHJhZGl1czogc3Quc2l6ZSAqIEIuc3Rhci5zY2FsZVtzdGFyIC0gMV0sXG4gICAgICBhbGl2ZTogdHJ1ZSwgc3RhdGU6ICdpZGxlJywgdGFyZ2V0OiAtMSwgcmV0YXJnZXRBdDogMCwgZm9yY2VkVGFyZ2V0OiAtMSwgZm9yY2VkVW50aWw6IDAsXG4gICAgICBuZXh0QXR0YWNrOiB0aGlzLnJuZy5uZXh0KCkgKiAwLjMsIGF0dGFja1N0YXJ0OiAtOSwgYXR0YWNrRHVyOiAxLCBhbmltU3BlZWQ6IDEsIGhpdEZyYWM6IDAsIGhpdERvbmU6IHRydWUsXG4gICAgICBtYW5hOiAwLCBtYXhNYW5hOiBCLm1hbmFbc291bF0/Lm1heCA/PyAwLCBjYXN0aW5nOiBmYWxzZSwgZnJlbnp5OiAwLCBkZWFkQXQ6IDAsXG4gICAgfSBhcyBGaWdodGVyO1xuICAgIHRoaXMuZmlnaHRlcnMucHVzaChmKTsgcmV0dXJuIGY7XG4gIH1cblxuICBieUlkKGlkOiBudW1iZXIpOiBGaWdodGVyIHwgdW5kZWZpbmVkIHsgcmV0dXJuIGlkIDwgMCA/IHVuZGVmaW5lZCA6IHRoaXMuZmlnaHRlcnNbaWQgLSAxXTsgfVxuICBmb2VzKGY6IEZpZ2h0ZXIpOiBGaWdodGVyW10geyByZXR1cm4gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgby50ZWFtICE9PSBmLnRlYW0pOyB9XG4gIGNvdW50KHRlYW06IDAgfCAxKTogbnVtYmVyIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMucmVkdWNlKChuLCBmKSA9PiBuICsgKGYuYWxpdmUgJiYgZi50ZWFtID09PSB0ZWFtID8gMSA6IDApLCAwKTsgfVxuICBkcmFpbigpOiBCRXZlbnRbXSB7IGNvbnN0IGUgPSB0aGlzLmV2ZW50czsgdGhpcy5ldmVudHMgPSBbXTsgcmV0dXJuIGU7IH1cblxuICBzdGVwKGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy53aW5uZXIgPj0gMCkgcmV0dXJuO1xuICAgIHRoaXMudGltZSArPSBkdDsgdGhpcy5mbGlwID0gIXRoaXMuZmxpcDtcbiAgICAvLyBhcnJvd3MgdGhhdCBoYXZlIGZpbmlzaGVkIGZseWluZ1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnBlbmRpbmcubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBlbmRpbmdbaV07XG4gICAgICBpZiAodGhpcy50aW1lID49IHAuYXQpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnNwbGljZShpLCAxKTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLmJ5SWQocC50byksIGZyb20gPSB0aGlzLmJ5SWQocC5mcm9tKTtcbiAgICAgICAgaWYgKHRvICYmIHRvLmFsaXZlICYmIGZyb20pIHRoaXMuZGFtYWdlKHRvLCBwLmRtZywgZnJvbSwgJ2Fycm93Jyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG9yZGVyID0gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAodGhpcy5mbGlwKSBvcmRlci5yZXZlcnNlKCk7XG4gICAgZm9yIChjb25zdCBmIG9mIG9yZGVyKSBpZiAoZi5hbGl2ZSkgdGhpcy51cGRhdGUoZiwgZHQpO1xuICAgIGNvbnN0IGEgPSB0aGlzLmNvdW50KDApLCBiID0gdGhpcy5jb3VudCgxKTtcbiAgICBpZiAoIWEgfHwgIWIpIHRoaXMud2lubmVyID0gYSA/IDAgOiAxO1xuICAgIGVsc2UgaWYgKHRoaXMudGltZSA+PSBCQUxBTkNFLnNpbS50aW1lTGltaXQpIHtcbiAgICAgIGNvbnN0IGhwID0gKHQ6IDAgfCAxKSA9PiB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHQpLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKTtcbiAgICAgIHRoaXMud2lubmVyID0gaHAoMCkgPiBocCgxKSA/IDAgOiAxO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwZXItZmlnaHRlciB1cGRhdGVcbiAgcHJpdmF0ZSB1cGRhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTtcbiAgICB0aGlzLnNlcGFyYXRlKGYsIGR0KTtcblxuICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykge1xuICAgICAgY29uc3QgdCA9IHRoaXMudGltZSAtIGYuYXR0YWNrU3RhcnQ7XG4gICAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7IGlmICh0ZyAmJiB0Zy5hbGl2ZSkgdGhpcy5mYWNlKGYsIHRnLnggLSBmLngsIHRnLnogLSBmLnosIGR0KTtcbiAgICAgIGlmICghZi5oaXREb25lICYmIHQgPj0gZi5hdHRhY2tEdXIgKiBzdC5oaXRGcmFjKSB7IGYuaGl0RG9uZSA9IHRydWU7IHRoaXMucmVzb2x2ZUhpdChmKTsgfVxuICAgICAgaWYgKHQgPj0gZi5hdHRhY2tEdXIpIGYuc3RhdGUgPSAnaWRsZSc7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYWNxdWlyZShmKTtcbiAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgcmV0dXJuOyB9XG4gICAgY29uc3QgZHggPSB0Zy54IC0gZi54LCBkeiA9IHRnLnogLSBmLnosIGRpc3QgPSBNYXRoLmh5cG90KGR4LCBkeik7XG4gICAgdGhpcy5mYWNlKGYsIGR4LCBkeiwgZHQpO1xuICAgIGlmIChkaXN0IDw9IGYucmFuZ2UpIHtcbiAgICAgIGlmICh0aGlzLnRpbWUgPj0gZi5uZXh0QXR0YWNrKSB0aGlzLnN0YXJ0QXR0YWNrKGYpOyBlbHNlIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmLnN0YXRlID0gJ3J1bic7IGNvbnN0IGsgPSBmLnNwZWVkICogZHQgLyBNYXRoLm1heChkaXN0LCAxZS00KTsgZi54ICs9IGR4ICogazsgZi56ICs9IGR6ICogazsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICBwcml2YXRlIHNlcGFyYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBsZXQgcHggPSAwLCBweiA9IDA7XG4gICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZmlnaHRlcnMpIHtcbiAgICAgIGlmIChvID09PSBmIHx8ICFvLmFsaXZlKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGR4ID0gZi54IC0gby54LCBkeiA9IGYueiAtIG8ueiwgbSA9IE1hdGguaHlwb3QoZHgsIGR6KSwgd2FudCA9IChmLnJhZGl1cyArIG8ucmFkaXVzKSAqIDEuMDUgKyAwLjA4O1xuICAgICAgaWYgKG0gPj0gd2FudCkgY29udGludWU7XG4gICAgICBjb25zdCBrID0gKHdhbnQgLSBtKSAvIE1hdGgubWF4KG0sIDFlLTMpOyBweCArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR4KSAqIGs7IHB6ICs9IChtIDwgMWUtMyA/ICh0aGlzLnJuZy5uZXh0KCkgLSAwLjUpIDogZHopICogaztcbiAgICB9XG4gICAgY29uc3QgcyA9IE1hdGgubWluKDEsIGR0ICogNik7IGYueCArPSBweCAqIHM7IGYueiArPSBweiAqIHM7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgZi5yZXRhcmdldEF0ID0gdGhpcy50aW1lICsgQkFMQU5DRS5zaW0ucmV0YXJnZXRFdmVyeSAqICgwLjggKyAwLjQgKiB0aGlzLnJuZy5uZXh0KCkpO1xuICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZik7IGlmICghZm9lcy5sZW5ndGgpIHsgZi50YXJnZXQgPSAtMTsgcmV0dXJuOyB9XG4gICAgbGV0IGJlc3QgPSBmb2VzWzBdLCBicyA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgbyBvZiBmb2VzKSB7XG4gICAgICBsZXQgc2NvcmUgPSBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KTtcbiAgICAgIGlmIChmLnNvdWwgPT09ICdnb2JsaW4nKSB7XG4gICAgICAgIC8vIGtpbGwtc3RlYWw6IHByZWZlciBuZWFyYnkgZW5lbWllcyBhbHJlYWR5IGZpZ2h0aW5nIG9uZSBvZiBvdXIgYWxsaWVzLCBhbmQgd291bmRlZCBvbmVzXG4gICAgICAgIGNvbnN0IGVuZ2FnZWQgPSB0aGlzLmJ5SWQoby50YXJnZXQpOyBjb25zdCBidXN5ID0gISFlbmdhZ2VkICYmIGVuZ2FnZWQuYWxpdmUgJiYgZW5nYWdlZC50ZWFtID09PSBmLnRlYW0gJiYgZW5nYWdlZC5pZCAhPT0gZi5pZDtcbiAgICAgICAgaWYgKGJ1c3kgJiYgc2NvcmUgPCBCQUxBTkNFLm9wcG9ydHVuaXN0LnNlZWtSYWRpdXMgKyAyKSBzY29yZSAtPSAzO1xuICAgICAgICBzY29yZSAtPSBCQUxBTkNFLm9wcG9ydHVuaXN0LndvdW5kZWRXZWlnaHQgKiAoMSAtIG8uaHAgLyBvLm1heEhwKTtcbiAgICAgIH1cbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzApOiB7IHdpbm5lcjogMCB8IDE7IHRpbWU6IG51bWJlcjsgbGVmdDogbnVtYmVyOyBocExlZnQ6IG51bWJlciB9IHtcbiAgY29uc3QgYiA9IG5ldyBCYXR0bGUocGxheWVycywgZW5lbWllcywgc2VlZCk7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgIi8vIEVuZW15IHdhdmVzLiBTYW1lIHVuaXQgcG9vbCBhcyB0aGUgcGxheWVyLiBUaGUgYnVpbGQgc2NyZWVuIHByZXZpZXdzIHRoZSBDT01QT1NJVElPTiBvbmx5LCBuZXZlciBwb3NpdGlvbnMuXG5cbmltcG9ydCB7IENPU1QsIENVUlZFUywgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBFbmVteVNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5cbmNvbnN0IExFVFRFUjogUmVjb3JkPHN0cmluZywgU291bElkPiA9IHsgVzogJ3dhcnJpb3InLCBBOiAnYXJjaGVyJywgRzogJ2dvYmxpbicsIEs6ICdrbmlnaHQnLCBPOiAnb2dyZScsIEI6ICdiYXJiYXJpYW4nIH07XG5jb25zdCBwYXJzZVdhdmUgPSAoczogc3RyaW5nKTogRW5lbXlTcGVjW10gPT4gcy5zcGxpdCgnICcpLm1hcCgodCkgPT4gKHsgc291bDogTEVUVEVSW3RbMF1dLCBzdGFyOiArdFsxXSB9KSk7XG5cbi8qKlxuICogRGlmZmljdWx0eSBwcmVzZXRzIGZvciB0aGUgMy13YXZlIHByb3RvdHlwZSAoVyB3YXJyaW9yLCBBIGFyY2hlciwgRyBnb2JsaW4sIEsga25pZ2h0LCBPIG9ncmU7IGRpZ2l0ID0gc3RhcnMpLlxuICogTWVhc3VyZWQgd2l0aCBzaW0vdHVuZV93YXZlcy50cyBhZ2FpbnN0IHN0YW5kLWluIHBsYXllcnMgKGNvbXBldGVudCAvIGNhcmVsZXNzKSwgc3RhZ2UtY2xlYXIgcmF0ZTpcbiAqICAgZWFzeSAgIH4xMDAlIC8gfjkwJSAgICAgIG5vcm1hbCB+OTQlIC8gfjUxJSAgICAgIGhhcmQgfjc1JSAvIH4yNiVcbiAqIEEgcmVhbCBodW1hbiBvbiBhIHBob25lIGlzIG11Y2ggbGVzcyBjYXJlZnVsIHRoYW4gdGhlIGNvbXBldGVudCBzdGFuZC1pbiwgc28gXCJub3JtYWxcIiBpcyB0aGUgZGVmYXVsdC5cbiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFk6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMScsICdLMSBXMScsICdPMSBXMSBHMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEnLCAnTzEgQTEgRzEgVzEnXSxcbiAgaGFyZDogWydXMSBBMScsICdLMSBHMSBXMSBBMScsICdPMSBBMSBHMSBXMSddLFxufTtcbmV4cG9ydCBsZXQgZGlmZmljdWx0eU5hbWUgPSAnbm9ybWFsJztcblxuLyoqIEhhbmQtYXV0aG9yZWQgb3BlbmluZyB3YXZlcyAocHJvdG90eXBlIHN0YWdlIGlzIDMgd2F2ZXMpLiBCdWRnZXRzIH4gdGhlIHBsYXllcidzIGNhcCBhdCB0aGF0IHdhdmUuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXREaWZmaWN1bHR5LiAqL1xuZXhwb3J0IGNvbnN0IEFVVEhPUkVEOiBFbmVteVNwZWNbXVtdID0gRElGRklDVUxUWS5ub3JtYWwubWFwKHBhcnNlV2F2ZSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXREaWZmaWN1bHR5KG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIURJRkZJQ1VMVFlbbmFtZV0pIHJldHVybjtcbiAgZGlmZmljdWx0eU5hbWUgPSBuYW1lOyBBVVRIT1JFRC5sZW5ndGggPSAwOyBESUZGSUNVTFRZW25hbWVdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG5cbmV4cG9ydCBjb25zdCB3YXZlQ29zdCA9ICh3OiBFbmVteVNwZWNbXSk6IG51bWJlciA9PiB3LnJlZHVjZSgobiwgZSkgPT4gbiArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXSwgMCk7XG5cbi8qKiBFbmVteSBhcm15IGZvciBhIHdhdmUgKDEtYmFzZWQpLiBXYXZlcyBwYXN0IHRoZSBhdXRob3JlZCBvbmVzIGFyZSBnZW5lcmF0ZWQgZnJvbSBhIGZpeGVkIHNlZWQgc28gcmV0cmllcyBmYWNlIHRoZSBzYW1lIGFybXkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlXYXZlKHdhdmU6IG51bWJlciwgc3RhZ2VTZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgaWYgKHdhdmUgPD0gQVVUSE9SRUQubGVuZ3RoKSByZXR1cm4gQVVUSE9SRURbd2F2ZSAtIDFdLm1hcCgoZSkgPT4gKHsgLi4uZSB9KSk7XG4gIGNvbnN0IGNhcCA9IENVUlZFUy5kb2NbTWF0aC5taW4od2F2ZSwgQ1VSVkVTLmRvYy5sZW5ndGgpIC0gMV07XG4gIGNvbnN0IGJ1ZGdldCA9IE1hdGgucm91bmQoY2FwICogMC45Mik7XG4gIGNvbnN0IHJuZyA9IG1ha2VSbmcoc3RhZ2VTZWVkICogMTAwOSArIHdhdmUgKiA3OTE5KTtcbiAgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA0MCAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2soU09VTFMpO1xuICAgIGxldCBzdGFyID0gMTtcbiAgICBpZiAocm5nLm5leHQoKSA8IDAuMzUgJiYgQ09TVFtzb3VsXVsxXSA8PSBsZWZ0KSBzdGFyID0gMjtcbiAgICBpZiAod2F2ZSA+PSA2ICYmIHJuZy5uZXh0KCkgPCAwLjI1ICYmIENPU1Rbc291bF1bMl0gPD0gbGVmdCkgc3RhciA9IDM7XG4gICAgY29uc3QgYyA9IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICAgIGlmIChjIDw9IGxlZnQgJiYgYXJteS5sZW5ndGggPCAxMikgeyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IGM7IH1cbiAgfVxuICByZXR1cm4gYXJteTtcbn1cblxuLyoqIFdoYXQgdGhlIGJ1aWxkIHNjcmVlbiBzaG93czogY291bnRzIHBlciBTb3VsIGFuZCBzdGFyLCBubyBwb3NpdGlvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcHJldmlld1RleHQodzogRW5lbXlTcGVjW10pOiB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH1bXSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXA8c3RyaW5nLCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH0+KCk7XG4gIGZvciAoY29uc3QgZSBvZiB3KSB7XG4gICAgY29uc3QgayA9IGUuc291bCArIGUuc3RhcjtcbiAgICBjb25zdCBjdXIgPSBtYXAuZ2V0KGspO1xuICAgIGlmIChjdXIpIGN1ci5jb3VudCsrOyBlbHNlIG1hcC5zZXQoaywgeyBzb3VsOiBlLnNvdWwsIHN0YXI6IGUuc3RhciwgY291bnQ6IDEgfSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldO1xufVxuIiwgImltcG9ydCB7IENVUlZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuLyoqXG4gKiBSdWxlcyBmb3IgdGhlIHBsYXlhYmxlIDMtd2F2ZSBwcm90b3R5cGU6IGRvYyBEb21pbmlvbiBjdXJ2ZSwgYm9udXMgZHJhdyBvbmx5IG9uIHRoZSBlYXJseSB3YXZlcy5cbiAqIG1lcmdlICdoYW5kSW50b09uZVN0YXInOiBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIG1lcmdlIHN0cmFpZ2h0IGludG8gYSBtYXRjaGluZyBkZXBsb3llZCAxLXN0YXIgdW5pdCAocGF5aW5nIG9ubHkgdGhlIGNvc3RcbiAqIGRpZmZlcmVuY2UpLiBXaXRob3V0IGl0IHRoZSBjYXAgY2FuIGJsb2NrIGEgbWVyZ2UgeW91IGNvdWxkIGFmZm9yZCAoeW91IHdvdWxkIG5lZWQgcm9vbSB0byBzdW1tb24gQk9USCBjb3BpZXMgZmlyc3QpLlxuICogVGhlIGRlYnVnIHBhbmVsIGNhbiBzd2l0Y2ggdGhpcyBiYWNrIHRvIHRoZSBkb2MncyBkZXBsb3llZC1vbmx5IHJ1bGUuXG4gKi9cbmV4cG9ydCBjb25zdCBQUk9UT1RZUEVfUlVMRVM6IFJ1bGVzID0geyBjdXJ2ZTogQ1VSVkVTLmRvYy5zbGljZSgwLCAzKSwgbWVyZ2U6ICdoYW5kSW50b09uZVN0YXInLCBzdGFnZVdhdmVzOiAzLCBub3JtYWxEcmF3V2F2ZXM6IFsyLCAzLCA0LCA1XSB9O1xuIiwgIi8vIEV2ZXJ5dGhpbmcgeW91IFNFRSBmb3IgYSB1bml0OiByZWFsIFRyaXBvIG1vZGVscyAoU2tlbGV0b24gV2FycmlvciwgU2tlbGV0b24gQXJjaGVyKSwgc2ltcGxlIHN0YW5kLWlucyBmb3IgdGhlIGZvdXJcbi8vIGNoYXJhY3RlcnMgdGhhdCBhcmUgbm90IGdlbmVyYXRlZCB5ZXQsIGFuZCB0aGUgXCJzdGFyIGxvb2tcIiBsYXllcmVkIG9uIHRvcCBvZiBib3RoIChzaXplLCB0aW50LCBhdXJhLCBoYWxvLCBiYWRnZSkuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuXG5leHBvcnQgdHlwZSBWU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYXRoJyB8ICdzcGF3bicgfCAnY2hlZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb24gKyB5YXcgaGVyZVxuICB0ZWFtOiAwIHwgMTsgc3RhcjogbnVtYmVyOyBzdGF0ZTogVlN0YXRlOyB0b3A6IG51bWJlcjtcbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZD86IG51bWJlcik6IHZvaWQ7XG4gIHNldFN0YXIoc3RhcjogbnVtYmVyKTogdm9pZDtcbiAgc2V0VGVhbSh0ZWFtOiAwIHwgMSk6IHZvaWQ7XG4gIHNldEhwKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAgLy8gbnVsbCBoaWRlcyB0aGUgaGVhbHRoIGJhclxuICBzZXRNYW5hKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAvLyBudWxsIGhpZGVzIHRoZSBtYW5hIGJhciAodW5pdHMgd2l0aG91dCBhIHNraWxsKVxuICBwdWxzZSgpOiB2b2lkOyAgICAgICAgICAgICAgICAgICAgIC8vIGJyaWVmIGhpdCByZWFjdGlvblxuICB1cGRhdGUoZHQ6IG51bWJlcik6IHZvaWQ7XG4gIGRpc3Bvc2UoKTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFyIGxvb2tzXG4vLyAxIHN0YXIgPSB0aGUgcGxhaW4gbW9kZWwuIDIgc3RhcnMgPSBhIGxpdHRsZSBiaWdnZXIsIGNvb2wgc2lsdmVyLWJsdWUgdGludCwgYnJpZ2h0ZXIgYXVyYS4gMyBzdGFycyA9IGJpZ2dlc3QsIHdhcm0gZ29sZCB0aW50LFxuLy8gc3Ryb25nIGdvbGQtdmlvbGV0IGF1cmEgYW5kIGEgZmxvYXRpbmcgZ29sZCBoYWxvLiBFdmVyeXRoaW5nIGhlcmUgaXMgZnJlZTogbm8gZXh0cmEgVHJpcG8gZ2VuZXJhdGlvbnMuXG5jb25zdCBUSU5UOiBudW1iZXJbXVtdID0gW1sxLCAxLCAxXSwgWzAuODYsIDAuOTUsIDEuMThdLCBbMS4yNSwgMS4xLCAwLjddXTtcbmNvbnN0IEFVUkEgPSBbXG4gIHsgcmF0ZTogMTQsIG1pbjogMC4wNiwgbWF4OiAwLjE2LCBjMTogWzAuNzgsIDAuMzUsIDEsIDAuN10sIGMyOiBbMC40NSwgMC4xNSwgMC45LCAwLjVdIH0sXG4gIHsgcmF0ZTogMjYsIG1pbjogMC4wOCwgbWF4OiAwLjIwLCBjMTogWzAuODUsIDAuNjUsIDEsIDAuOF0sIGMyOiBbMC41NSwgMC40LCAxLCAwLjZdIH0sXG4gIHsgcmF0ZTogNDQsIG1pbjogMC4xMCwgbWF4OiAwLjI2LCBjMTogWzEsIDAuODUsIDAuNCwgMC44NV0sIGMyOiBbMC44LCAwLjMsIDEsIDAuN10gfSxcbl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRzIHtcbiAgc2NlbmU6IGFueTsgc29mdDogYW55OyBzdGFyVGV4OiBhbnlbXTsgdHJpcG86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgVHJpcG9DZmc+PjtcbiAgcmluZ01hdDogYW55W107IGhhbG9NYXQ6IGFueTsgYmFyQmc6IGFueTsgYmFyRmlsbDogYW55W107IG1hbmFGaWxsOiBhbnk7XG59XG5pbnRlcmZhY2UgVHJpcG9DZmcgeyBjb250YWluZXI6IGFueTsgZW5lbXlUZXg6IGFueTsgY2xpcHM6IFJlY29yZDxWU3RhdGUsIHN0cmluZz47IG1hdENhY2hlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+OyBiYXNlTWF0PzogYW55OyB0b3A6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9XG5cbmZ1bmN0aW9uIGR5bihzY2VuZTogYW55LCB3OiBudW1iZXIsIGg6IG51bWJlciwgZHJhdzogKGM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCkgPT4gdm9pZCwgYWxwaGEgPSB0cnVlKSB7XG4gIGNvbnN0IHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnZHQnLCB7IHdpZHRoOiB3LCBoZWlnaHQ6IGggfSwgc2NlbmUsIHRydWUpOyBkcmF3KHQuZ2V0Q29udGV4dCgpKTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IGFscGhhOyByZXR1cm4gdDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRBc3NldHMoc2NlbmU6IGFueSk6IFByb21pc2U8QXNzZXRzPiB7XG4gIGNvbnN0IHNvZnQgPSBkeW4oc2NlbmUsIDY0LCA2NCwgKGMpID0+IHsgY29uc3QgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwuNTUpJyk7IGcuYWRkQ29sb3JTdG9wKDEsICdyZ2JhKDI1NSwyNTUsMjU1LDApJyk7IGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCA2NCwgNjQpOyB9KTtcbiAgY29uc3Qgc3RhclRleCA9IFsxLCAyLCAzXS5tYXAoKG4pID0+IGR5bihzY2VuZSwgMTkyLCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgNDBweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVN0eWxlID0gJyMxYTEwMjAnOyBjLmZpbGxTdHlsZSA9IG4gPT09IDMgPyAnI2ZmZDI0YScgOiBuID09PSAyID8gJyNkN2U2ZmYnIDogJyNmMGQ5YTAnOyBjb25zdCBzID0gJ1x1MjYwNScucmVwZWF0KG4pOyBjLnN0cm9rZVRleHQocywgOTYsIDM4KTsgYy5maWxsVGV4dChzLCA5NiwgMzgpOyB9KSk7XG4gIGNvbnN0IGVtaXNzaXZlID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdlbScsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IGE7IHJldHVybiBtOyB9O1xuICBjb25zdCBBOiBBc3NldHMgPSB7XG4gICAgc2NlbmUsIHNvZnQsIHN0YXJUZXgsIHRyaXBvOiB7fSwgcmluZ01hdDogW2VtaXNzaXZlKDAuNTUsIDAuMiwgMC45NSwgMC45KSwgZW1pc3NpdmUoMC45NSwgMC4yNSwgMC4yLCAwLjkpXSwgaGFsb01hdDogZW1pc3NpdmUoMSwgMC44MiwgMC4zLCAwLjk1KSxcbiAgICBiYXJCZzogZW1pc3NpdmUoMC4wNSwgMC4wNSwgMC4wOCwgMC43KSwgYmFyRmlsbDogW2VtaXNzaXZlKDAuNTUsIDAuMzUsIDEpLCBlbWlzc2l2ZSgxLCAwLjQsIDAuMyldLCBtYW5hRmlsbDogZW1pc3NpdmUoMC4yNSwgMC43NSwgMSksXG4gIH07XG4gIGNvbnN0IGRlZnM6IFtTb3VsSWQsIHN0cmluZywgc3RyaW5nLCBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+LCBudW1iZXIsIG51bWJlcl1bXSA9IFtcbiAgICBbJ3dhcnJpb3InLCAnc2tlbGV0b25fd2Fycmlvci5nbGInLCAnc2tlbGV0b25fd2Fycmlvcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0Jsb2NrJyB9LCAxLjA1LCAxLjBdLFxuICAgIFsnYXJjaGVyJywgJ1NrZWxldG9uQXJjaGVyLmdsYicsICdTa2VsZXRvbkFyY2hlcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnU2hvb3QnLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnRmxleCcgfSwgMS4wNSwgMS4wXSxcbiAgXTtcbiAgYXdhaXQgUHJvbWlzZS5hbGwoZGVmcy5tYXAoYXN5bmMgKFtzb3VsLCBnbGIsIGVuZW15LCBjbGlwcywgdG9wLCBzY2FsZV0pID0+IHtcbiAgICBjb25zdCBjb250YWluZXIgPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgZ2xiLCBzY2VuZSk7XG4gICAgQS50cmlwb1tzb3VsXSA9IHsgY29udGFpbmVyLCBlbmVteVRleDogbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBlbmVteSwgc2NlbmUsIGZhbHNlLCBmYWxzZSksIGNsaXBzLCBtYXRDYWNoZToge30sIHRvcCwgc2NhbGUgfTtcbiAgfSkpO1xuICByZXR1cm4gQTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzaGFyZWQgZGVjb3JhdGlvblxuY2xhc3MgRGVjbyB7XG4gIHByaXZhdGUgcHM6IGFueSA9IG51bGw7IHByaXZhdGUgaGFsbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBiYWRnZTogYW55OyBwcml2YXRlIHN0YXJzOiBhbnk7IHByaXZhdGUgZmlsbDogYW55OyBwcml2YXRlIGJhcjogYW55OyBwcml2YXRlIG1iZzogYW55OyBwcml2YXRlIG1maWxsOiBhbnk7IHByaXZhdGUgcmluZzogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBwYXJlbnQ6IGFueSwgcHJpdmF0ZSB0b3A6IG51bWJlciwgcHJpdmF0ZSByYWRpdXM6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lO1xuICAgIHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygncmluZycsIHsgcmFkaXVzOiBNYXRoLm1heCgwLjMsIHJhZGl1cyAqIDEuMTUpLCB0ZXNzZWxsYXRpb246IDI2IH0sIHMpOyB0aGlzLnJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0aGlzLnJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHRoaXMucmluZy5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMucmluZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYWRnZSA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2JhZGdlJywgcyk7IHRoaXMuYmFkZ2UucGFyZW50ID0gcGFyZW50OyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0b3AgKyAwLjMyOyB0aGlzLmJhZGdlLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgdGhpcy5zdGFycyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3N0YXJzJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMTUgfSwgcyk7IHRoaXMuc3RhcnMucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5zdGFycy5wb3NpdGlvbi55ID0gMC4xMTsgdGhpcy5zdGFycy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzbScsIHMpOyBzbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgc20uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgc20udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB0aGlzLnN0YXJzLm1hdGVyaWFsID0gc207ICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtID0gc207XG4gICAgY29uc3QgYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdiZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA4NSB9LCBzKTsgYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgYmcubWF0ZXJpYWwgPSBBLmJhckJnOyBiZy5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMuYmFyID0gYmc7XG4gICAgdGhpcy5maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuZmlsbC5wb3NpdGlvbi56ID0gLTAuMDAyOyB0aGlzLmZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWJnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMubWJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWJnLnBvc2l0aW9uLnkgPSAtMC4wNzsgdGhpcy5tYmcubWF0ZXJpYWwgPSBBLmJhckJnOyB0aGlzLm1iZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21maWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjAzIH0sIHMpOyB0aGlzLm1maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWZpbGwucG9zaXRpb24uc2V0KDAsIC0wLjA3LCAtMC4wMDIpOyB0aGlzLm1maWxsLm1hdGVyaWFsID0gQS5tYW5hRmlsbDsgdGhpcy5tZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYXIuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuZmlsbC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tYmcuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgc2V0KHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5BLnNjZW5lLCBjZmcgPSBBVVJBW3N0YXIgLSAxXTtcbiAgICAodGhpcy5zdGFycyBhcyBhbnkpLl9zbS5kaWZmdXNlVGV4dHVyZSA9IHRoaXMuQS5zdGFyVGV4W3N0YXIgLSAxXTtcbiAgICB0aGlzLnJpbmcubWF0ZXJpYWwgPSB0aGlzLkEucmluZ01hdFt0ZWFtXTsgdGhpcy5maWxsLm1hdGVyaWFsID0gdGhpcy5BLmJhckZpbGxbdGVhbV07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJhaXNlZCBieSB0aGUgTmVjcm9tYW5jZXI6IHB1cnBsZSBhdXJhIHRoYXQgZ3Jvd3Mgd2l0aCBzdGFyc1xuICAgICAgaWYgKCF0aGlzLnBzKSB7XG4gICAgICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2F1cmEnLCA3MCwgcyk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5wYXJlbnQ7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIHRoaXMudG9wICogMC41LCAwLjIpO1xuICAgICAgICBwcy5taW5MaWZlVGltZSA9IDAuNTsgcHMubWF4TGlmZVRpbWUgPSAxLjE7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjgsIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS41LCAwLjE1KTtcbiAgICAgICAgcHMubWluRW1pdFBvd2VyID0gMC4zNTsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHRoaXMucHMgPSBwcztcbiAgICAgIH1cbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBzOyBwLmVtaXRSYXRlID0gY2ZnLnJhdGU7IHAubWluU2l6ZSA9IGNmZy5taW47IHAubWF4U2l6ZSA9IGNmZy5tYXg7IHAuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMSk7IHAuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMik7IHAuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICAgIGlmICghcC5pc1N0YXJ0ZWQoKSkgcC5zdGFydCgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wcyAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTtcbiAgICBpZiAoc3RhciA+PSAzKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBoYWxvIGFib3ZlIHRoZSBoZWFkXG4gICAgICBpZiAoIXRoaXMuaGFsbykgeyB0aGlzLmhhbG8gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoYWxvJywgeyBkaWFtZXRlcjogMC41NSwgdGhpY2tuZXNzOiAwLjA0LCB0ZXNzZWxsYXRpb246IDI0IH0sIHMpOyB0aGlzLmhhbG8ucGFyZW50ID0gdGhpcy5wYXJlbnQ7IHRoaXMuaGFsby5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjA4OyB0aGlzLmhhbG8ubWF0ZXJpYWwgPSB0aGlzLkEuaGFsb01hdDsgdGhpcy5oYWxvLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgICAgdGhpcy5oYWxvLnNldEVuYWJsZWQodHJ1ZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmhhbG8pIHRoaXMuaGFsby5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLmJhci5zZXRFbmFibGVkKG9uKTsgdGhpcy5maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMuZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLm1iZy5zZXRFbmFibGVkKG9uKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMubWZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5tZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0QXVyYShvbjogYm9vbGVhbikgeyBpZiAodGhpcy5wcykgeyBpZiAob24gJiYgIXRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RhcnQoKTsgaWYgKCFvbiAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTsgfSB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7IGlmICh0aGlzLmhhbG8gJiYgdGhpcy5oYWxvLmlzRW5hYmxlZCgpKSB0aGlzLmhhbG8ucm90YXRpb24ueSArPSBkdCAqIDEuNjsgfVxuICBkaXNwb3NlKCkgeyBpZiAodGhpcy5wcykgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IH0gW3RoaXMuaGFsbywgdGhpcy5yaW5nLCB0aGlzLnN0YXJzLCB0aGlzLmJhciwgdGhpcy5maWxsLCB0aGlzLm1iZywgdGhpcy5tZmlsbF0uZm9yRWFjaCgobSkgPT4gbSAmJiBtLmRpc3Bvc2UoKSk7IHRoaXMuYmFkZ2UuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcmVhbCBtb2RlbHNcbmNsYXNzIFRyaXBvVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIGVudDogYW55OyBwcml2YXRlIGJvZHk6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIGJhc2U6IG51bWJlcjtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgY2ZnOiBUcmlwb0NmZywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIHVpZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDcpO1xuICAgIHRoaXMuZW50ID0gY2ZnLmNvbnRhaW5lci5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIHVpZCwgZmFsc2UsIHsgZG9Ob3RJbnN0YW50aWF0ZTogdHJ1ZSB9KTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3VuaXRfJyArIHVpZCwgcyk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICB0aGlzLmJvZHkgPSB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5maW5kKChtOiBhbnkpID0+IG0ubmFtZS5pbmNsdWRlcygnX0JvZHknKSk7XG4gICAgaWYgKCFjZmcuYmFzZU1hdCkgY2ZnLmJhc2VNYXQgPSB0aGlzLmJvZHkubWF0ZXJpYWw7XG4gICAgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4geyBnLnN0b3AoKTsgZy5lbmFibGVCbGVuZGluZyA9IHRydWU7IGcuYmxlbmRpbmdTcGVlZCA9IDAuMTI7IHRoaXMuYW5pbXNbZy5uYW1lLnNwbGl0KCdfJylbMF1dID0gZzsgfSk7XG4gICAgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uYWx3YXlzU2VsZWN0QXNBY3RpdmVNZXNoID0gdHJ1ZTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH0pO1xuICAgIHRoaXMudG9wID0gY2ZnLnRvcDsgdGhpcy5iYXNlID0gY2ZnLnNjYWxlOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgMC4zKTtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IDEuMywgZGlhbWV0ZXI6IDAuOCB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IDAuNjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLmlzUGlja2FibGUgPSB0cnVlO1xuICAgIHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gIH1cbiAgcHJpdmF0ZSBhcHBseU1hdCgpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLnRlYW0gKyAnXycgKyB0aGlzLnN0YXIsIGMgPSB0aGlzLmNmZztcbiAgICBpZiAoIWMubWF0Q2FjaGVba2V5XSkgeyBjb25zdCBtID0gYy5iYXNlTWF0LmNsb25lKCdtXycgKyBrZXkpOyBpZiAodGhpcy50ZWFtID09PSAxKSBtLmFsYmVkb1RleHR1cmUgPSBjLmVuZW15VGV4OyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgbS5hbGJlZG9Db2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyh0WzBdLCB0WzFdLCB0WzJdKTsgYy5tYXRDYWNoZVtrZXldID0gbTsgfVxuICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IGMubWF0Q2FjaGVba2V5XTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbChCQUxBTkNFLnN0YXIuc2NhbGVbc3QgLSAxXSAqIHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHtcbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1t0aGlzLmNmZy5jbGlwc1tzdGF0ZV1dOyBpZiAoIWcpIHJldHVybjsgY29uc3QgbG9vcCA9IHN0YXRlID09PSAnaWRsZScgfHwgc3RhdGUgPT09ICdydW4nO1xuICAgIGlmIChsb29wICYmIHRoaXMuc3RhdGUgPT09IHN0YXRlICYmIHRoaXMuY3VyID09PSBnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGxvb3AsIHNwZWVkLCBnLmZyb20sIGcudG8pO1xuICAgIGlmIChsb29wKSBnLmdvVG9GcmFtZShnLmZyb20gKyBNYXRoLnJhbmRvbSgpICogKGcudG8gLSBnLmZyb20pKTtcbiAgICB0aGlzLmN1ciA9IGc7IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpO1xuICB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy5kZWNvLnVwZGF0ZShkdCk7XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbChCQUxBTkNFLnN0YXIuc2NhbGVbdGhpcy5zdGFyIC0gMV0gKiB0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IGcuZGlzcG9zZSgpKTsgdGhpcy5lbnQuc2tlbGV0b25zLmZvckVhY2goKHM6IGFueSkgPT4gcy5kaXNwb3NlKCkpOyB0aGlzLnBpY2suZGlzcG9zZSgpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0uZGlzcG9zZShmYWxzZSwgZmFsc2UpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFuZC1pbnNcbmNvbnN0IFBIOiBSZWNvcmQ8c3RyaW5nLCB7IGNvbDogc3RyaW5nOyB3OiBudW1iZXI7IGg6IG51bWJlcjsgaGVhZDogbnVtYmVyOyB3ZWFwb246IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9PiA9IHtcbiAgZ29ibGluOiB7IGNvbDogJyM2M2IxM2YnLCB3OiAwLjM2LCBoOiAwLjQyLCBoZWFkOiAwLjM2LCB3ZWFwb246ICdkYWdnZXInLCBsYWJlbDogJ0dPQkxJTicgfSxcbiAga25pZ2h0OiB7IGNvbDogJyM4ZWE5ZGMnLCB3OiAwLjUsIGg6IDAuNiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnc2hpZWxkJywgbGFiZWw6ICdLTklHSFQnIH0sXG4gIG9ncmU6IHsgY29sOiAnI2E4YTY0YScsIHc6IDAuODUsIGg6IDAuODUsIGhlYWQ6IDAuNDIsIHdlYXBvbjogJ21hY2UnLCBsYWJlbDogJ09HUkUnIH0sXG4gIGJhcmJhcmlhbjogeyBjb2w6ICcjZDY4YTU1JywgdzogMC41MiwgaDogMC42MiwgaGVhZDogMC4zOCwgd2VhcG9uOiAnYXhlJywgbGFiZWw6ICdCQVJCQVJJQU4nIH0sXG59O1xuY2xhc3MgUGxhY2Vob2xkZXJWaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgcmlnOiBhbnk7IHByaXZhdGUgbGVnczogYW55W10gPSBbXTsgcHJpdmF0ZSB3cDogYW55OyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHQgPSBNYXRoLnJhbmRvbSgpICogNjsgcHJpdmF0ZSBzdDAgPSAwOyBwcml2YXRlIGR1ciA9IDE7IHByaXZhdGUgYmFzZSA9IDE7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBtYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGJvZHk6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgc291bDogc3RyaW5nLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIGQgPSBQSFtzb3VsXTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3BoXycgKyBzb3VsLCBzKTsgdGhpcy5yaWcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdyaWcnLCBzKTsgdGhpcy5yaWcucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgY29uc3QgbWF0ID0gKGhleDogc3RyaW5nLCBlbSA9IDApID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3BtJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhoZXgpLnNjYWxlKDAuNzIpOyBtLnNwZWN1bGFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xLCAwLjEsIDAuMSk7IGlmIChlbSkgbS5lbWlzc2l2ZUNvbG9yID0gbS5kaWZmdXNlQ29sb3Iuc2NhbGUoZW0pOyByZXR1cm4gbTsgfTtcbiAgICBjb25zdCBsZWdIID0gMC4yMiwgYm9keVkgPSBsZWdIICsgZC5oIC8gMjtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgbGcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdsZWcnLCBzKTsgbGcucGFyZW50ID0gdGhpcy5yaWc7IGxnLnBvc2l0aW9uLnNldChzeCAqIGQudyAqIDAuMjIsIGxlZ0gsIDApOyBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignbCcsIHsgaGVpZ2h0OiBsZWdILCBkaWFtZXRlcjogZC53ICogMC4yOCB9LCBzKTsgbS5wYXJlbnQgPSBsZzsgbS5wb3NpdGlvbi55ID0gLWxlZ0ggLyAyOyBtLm1hdGVyaWFsID0gbWF0KCcjNGEzODI2Jyk7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmxlZ3MucHVzaChsZyk7IH1cbiAgICB0aGlzLmJvZHkgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUNhcHN1bGUoJ2JvZHknLCB7IHJhZGl1czogZC53IC8gMiwgaGVpZ2h0OiBkLmggKyBkLncgKiAwLjQgfSwgcyk7IHRoaXMuYm9keS5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy5ib2R5LnBvc2l0aW9uLnkgPSBib2R5WTsgdGhpcy5ib2R5Lm1hdGVyaWFsID0gbWF0KGQuY29sKTsgdGhpcy5ib2R5LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBoZWFkID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2hlYWQnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAxLjUsIHNlZ21lbnRzOiAxMiB9LCBzKTsgaGVhZC5wYXJlbnQgPSB0aGlzLnJpZzsgaGVhZC5wb3NpdGlvbi55ID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDAuNTU7IGhlYWQubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyBoZWFkLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBleWVNID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZXllJywgcyk7IGV5ZU0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZXllTS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgKHRoaXMgYXMgYW55KS5leWVNID0gZXllTTtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgZSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdlJywgeyBkaWFtZXRlcjogZC5oZWFkICogMC4zIH0sIHMpOyBlLnBhcmVudCA9IHRoaXMucmlnOyBlLnBvc2l0aW9uLnNldChzeCAqIGQuaGVhZCAqIDAuMywgaGVhZC5wb3NpdGlvbi55ICsgMC4wMiwgZC5oZWFkICogMC42Nik7IGUubWF0ZXJpYWwgPSBleWVNOyBlLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIC8vIHdlYXBvbiBwaXZvdCBhdCB0aGUgc2hvdWxkZXIsIG9uIHRoZSBjaGFyYWN0ZXIncyByaWdodCAoLXggaXMgZmluZSBmb3IgYSBzdGFuZC1pbilcbiAgICB0aGlzLndwID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnd3AnLCBzKTsgdGhpcy53cC5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy53cC5wb3NpdGlvbi5zZXQoZC53ICogMC42LCBsZWdIICsgZC5oICogMC44NSwgMC4wNSk7XG4gICAgY29uc3Qgd20gPSBtYXQoJyM3YTVhMzAnKSwgaXJvbiA9IG1hdCgnIzlhYTFhZCcpO1xuICAgIGNvbnN0IG1rID0gKG06IGFueSwga2luZDogc3RyaW5nLCBkaW1zOiBhbnksIHBvczogbnVtYmVyW10sIG10OiBhbnkpID0+IHsgY29uc3QgeCA9IGtpbmQgPT09ICdib3gnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVCb3goJ3cnLCBkaW1zLCBzKSA6IGtpbmQgPT09ICdjeWwnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigndycsIGRpbXMsIHMpIDogQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ3cnLCBkaW1zLCBzKTsgeC5wYXJlbnQgPSB0aGlzLndwOyB4LnBvc2l0aW9uLnNldChwb3NbMF0sIHBvc1sxXSwgcG9zWzJdKTsgeC5tYXRlcmlhbCA9IG10OyB4LmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIHg7IH07XG4gICAgaWYgKGQud2VhcG9uID09PSAnZGFnZ2VyJykgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDUsIGhlaWdodDogMC4zLCBkZXB0aDogMC4wMyB9LCBbMCwgLTAuMiwgMC4xMl0sIGlyb24pO1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ3NoaWVsZCcpIHsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDYsIGhlaWdodDogMC41LCBkZXB0aDogMC4wNCB9LCBbMCwgLTAuMywgMC4xNF0sIGlyb24pOyBjb25zdCBzaCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3NoJywgeyBoZWlnaHQ6IDAuMDUsIGRpYW1ldGVyOiAwLjU1IH0sIHMpOyBzaC5wYXJlbnQgPSB0aGlzLnJpZzsgc2gucm90YXRpb24ueiA9IE1hdGguUEkgLyAyOyBzaC5wb3NpdGlvbi5zZXQoLWQudyAqIDAuNywgbGVnSCArIGQuaCAqIDAuNiwgMC4wNSk7IHNoLm1hdGVyaWFsID0gbWF0KCcjZDhiNjRhJyk7IHNoLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ21hY2UnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC45LCBkaWFtZXRlcjogMC4wOCB9LCBbMCwgLTAuMzUsIDAuM10sIHdtKTsgbWsoMCwgJ3NwaCcsIHsgZGlhbWV0ZXI6IDAuNCB9LCBbMCwgLTAuODUsIDAuNF0sIGlyb24pOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnYXhlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuNiwgZGlhbWV0ZXI6IDAuMDUgfSwgWzAsIC0wLjIsIDAuMTVdLCB3bSk7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjMyLCBoZWlnaHQ6IDAuMjIsIGRlcHRoOiAwLjA1IH0sIFswLCAtMC41LCAwLjE1XSwgaXJvbik7IGNvbnN0IGhhaXIgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdoYWlyJywgeyBoZWlnaHQ6IDAuMywgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiBkLmhlYWQgKiAxLjIgfSwgcyk7IGhhaXIucGFyZW50ID0gdGhpcy5yaWc7IGhhaXIucG9zaXRpb24ueSA9IGhlYWQucG9zaXRpb24ueSArIGQuaGVhZCAqIDAuNzU7IGhhaXIubWF0ZXJpYWwgPSBtYXQoJyNjMjJhMWMnKTsgaGFpci5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICB0aGlzLnRvcCA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAxLjM1OyB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIGQudyAqIDAuNyk7XG4gICAgY29uc3QgbGJsID0gZHluKHMsIDI1NiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDI2cHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMuZmlsbFN0eWxlID0gJyNmZmZmZmYnOyBjLnN0cm9rZVN0eWxlID0gJyMxMTEnOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IGMuZmlsbFRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyB9KTtcbiAgICBjb25zdCBscCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2xibCcsIHsgd2lkdGg6IDEuMSwgaGVpZ2h0OiAwLjIgfSwgcyk7IGxwLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBscC5wb3NpdGlvbi55ID0gLTAuMTsgbHAucm90YXRpb24ueCA9IE1hdGguUEkgLyAyICogMC4wOyBscC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBjb25zdCBsbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2xtJywgcyk7IGxtLmRpZmZ1c2VUZXh0dXJlID0gbGJsOyBsbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBscC5tYXRlcmlhbCA9IGxtOyBscC5pc1BpY2thYmxlID0gZmFsc2U7IGxwLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuNjI7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiB0aGlzLnRvcCwgZGlhbWV0ZXI6IE1hdGgubWF4KDAuNywgZC53ICogMS4zKSB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IHRoaXMudG9wIC8gMjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICAgICh0aGlzIGFzIGFueSkucGFydHMgPSBbbHBdOyB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5wbGF5KCdpZGxlJyk7XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyAodGhpcyBhcyBhbnkpLmV5ZU0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYmFzZSA9IEJBTEFOQ0Uuc3Rhci5zY2FsZVtzdCAtIDFdOyBjb25zdCB0ID0gVElOVFtzdCAtIDFdOyB0aGlzLmJvZHkubWF0ZXJpYWwuZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhQSFt0aGlzLnNvdWxdLmNvbCkuc2NhbGUoMC43MikubXVsdGlwbHkobmV3IEJBQllMT04uQ29sb3IzKE1hdGgubWluKDEsIHRbMF0pLCBNYXRoLm1pbigxLCB0WzFdKSwgTWF0aC5taW4oMSwgdFsyXSkpKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkgeyBpZiAoc3RhdGUgPT09IHRoaXMuc3RhdGUgJiYgKHN0YXRlID09PSAnaWRsZScgfHwgc3RhdGUgPT09ICdydW4nKSkgcmV0dXJuOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuc3QwID0gdGhpcy50OyB0aGlzLmR1ciA9IHN0YXRlID09PSAnYXR0YWNrJyA/IChCQUxBTkNFLnN0YXRzW3RoaXMuc291bCBhcyBTb3VsSWRdLmFuaW1MZW4gLyBzcGVlZCkgOiBzdGF0ZSA9PT0gJ2RlYXRoJyA/IDAuNiA6IHN0YXRlID09PSAnc3Bhd24nID8gMC45IDogMS4wOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7IH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLnQgKz0gZHQ7IHRoaXMuZGVjby51cGRhdGUoZHQpOyBjb25zdCBwID0gTWF0aC5taW4oMSwgKHRoaXMudCAtIHRoaXMuc3QwKSAvIHRoaXMuZHVyKSwgUiA9IHRoaXMucmlnLCBXID0gdGhpcy53cDtcbiAgICBSLnBvc2l0aW9uLnNldCgwLCAwLCAwKTsgUi5yb3RhdGlvbi5zZXQoMCwgMCwgMCk7IFIuc2NhbGluZy5zZXRBbGwoMSk7IFcucm90YXRpb24ueCA9IC0wLjQ7IHRoaXMubGVncy5mb3JFYWNoKChsKSA9PiAobC5yb3RhdGlvbi54ID0gMCkpO1xuICAgIGlmICh0aGlzLnN0YXRlID09PSAnaWRsZScpIFIucG9zaXRpb24ueSA9IE1hdGguc2luKHRoaXMudCAqIDIuMikgKiAwLjAxMjtcbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAncnVuJykgeyBjb25zdCB3ID0gdGhpcy50ICogMTA7IFIucG9zaXRpb24ueSA9IE1hdGguYWJzKE1hdGguc2luKHcpKSAqIDAuMDc7IFIucm90YXRpb24ueCA9IDAuMjsgdGhpcy5sZWdzWzBdLnJvdGF0aW9uLnggPSBNYXRoLnNpbih3KSAqIDAuOTsgdGhpcy5sZWdzWzFdLnJvdGF0aW9uLnggPSAtTWF0aC5zaW4odykgKiAwLjk7IFcucm90YXRpb24ueCA9IC0wLjQgKyBNYXRoLnNpbih3KSAqIDAuNDsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdhdHRhY2snKSB7IGNvbnN0IGsgPSBwIDwgMC40ID8gLTIuNCAqIChwIC8gMC40KSA6IC0yLjQgKyAzLjQgKiBNYXRoLm1pbigxLCAocCAtIDAuNCkgLyAwLjI1KTsgVy5yb3RhdGlvbi54ID0gazsgUi5wb3NpdGlvbi56ID0gMC4xNCAqIE1hdGguc2luKE1hdGguUEkgKiBwKTsgUi5yb3RhdGlvbi54ID0gMC4xNSAqIE1hdGguc2luKE1hdGguUEkgKiBwKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHsgY29uc3QgZSA9IHAgKiBwICogKDMgLSAyICogcCk7IFIuc2NhbGluZy5zZXRBbGwoMC4wMSArIDAuOTkgKiBlKTsgUi5wb3NpdGlvbi55ID0gKGUgLSAxKSAqIDAuNDsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdkZWF0aCcpIHsgY29uc3QgZSA9IHAgKiBwOyBSLnJvdGF0aW9uLnggPSAtTWF0aC5QSSAvIDIgKiBlOyBSLnBvc2l0aW9uLnkgPSAwLjI1ICogZTsgUi5wb3NpdGlvbi56ID0gLTAuMiAqIGU7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnY2hlZXInKSB7IFIucG9zaXRpb24ueSA9IE1hdGguYWJzKE1hdGguc2luKHRoaXMudCAqIDcpKSAqIDAuMTU7IFcucm90YXRpb24ueCA9IC0yLjY7IH1cbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5kZWNvLmRpc3Bvc2UoKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVWaXN1YWwoQTogQXNzZXRzLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpOiBVbml0VmlzdWFsIHtcbiAgY29uc3QgY2ZnID0gQS50cmlwb1tzb3VsXTtcbiAgcmV0dXJuIGNmZyA/IG5ldyBUcmlwb1Zpc3VhbChBLCBjZmcsIHNvdWwsIHRlYW0sIHN0YXIpIDogbmV3IFBsYWNlaG9sZGVyVmlzdWFsKEEsIHNvdWwsIHRlYW0sIHN0YXIpO1xufVxuZXhwb3J0IGNvbnN0IGlzVHJpcG8gPSAoQTogQXNzZXRzLCBzb3VsOiBTb3VsSWQpID0+ICEhQS50cmlwb1tzb3VsXTtcbiIsICIvLyBET00gdXNlciBpbnRlcmZhY2U6IHRvcCBiYXIsIGVuZW15IHByZXZpZXcsIGhhbmQgb2YgY2FyZHMsIGJ1dHRvbnMsIGRyYWZ0IG92ZXJsYXksIHRvYXN0cyBhbmQgdGhlIGRlYnVnIHBhbmVsLlxuaW1wb3J0IHsgQkFMQU5DRSwgUk9MRV9URVhULCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgY2FuTWVyZ2VEZXBsb3llZCwgY2FuU3VtbW9uLCBjb3N0LCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgc3RhZ2VXYXZlcyB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgZW5lbXlXYXZlLCBwcmV2aWV3VGV4dCB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuXG5jb25zdCBJQ09OOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0geyB3YXJyaW9yOiAnXFx1ezFGNDgwfScsIGFyY2hlcjogJ1xcdXsxRjNGOX0nLCBnb2JsaW46ICdcXHV7MUY1RTF9XHVGRTBGJywga25pZ2h0OiAnXFx1ezFGNkUxfVx1RkUwRicsIG9ncmU6ICdcXHV7MUY1Mjh9JywgYmFyYmFyaWFuOiAnXFx1ezFGQTkzfScgfTtcbmNvbnN0ICQgPSAoaWQ6IHN0cmluZykgPT4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpITtcbmNvbnN0IHN0YXJzID0gKG46IG51bWJlcikgPT4gJ1x1MjYwNScucmVwZWF0KG4pO1xuXG5leHBvcnQgY2xhc3MgVWkge1xuICBwcml2YXRlIHRvYXN0VCA9IDA7IHByaXZhdGUgZGJnOiBIVE1MRWxlbWVudDsgcHJpdmF0ZSBvZGRzID0gJyc7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgZzogYW55KSB7XG4gICAgJCgnYnRuQmF0dGxlJykub25jbGljayA9ICgpID0+IGcuc3RhcnRCYXR0bGUoKTsgJCgnYnRuU3dhcCcpLm9uY2xpY2sgPSAoKSA9PiBnLnRvZ2dsZVN3YXAoKTtcbiAgICAkKCdidG5NZXJnZScpLm9uY2xpY2sgPSAoKSA9PiBnLm1lcmdlU2VsZWN0ZWQoKTsgJCgnYnRuUmVtb3ZlJykub25jbGljayA9ICgpID0+IGcucmVtb3ZlU2VsZWN0ZWQoKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtc3BlZWRdJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0U3BlZWQoK2IuZGF0YXNldC5zcGVlZCEpKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRDYW1Nb2RlKGIuZGF0YXNldC5jYW0hKSkpO1xuICAgICQoJ2dlYXInKS5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmRiZy5jbGFzc0xpc3QudG9nZ2xlKCdvcGVuJyk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICB0aGlzLmRiZyA9ICQoJ2RlYnVnJyk7IGlmIChuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdkZWJ1ZycpKSB0aGlzLmRiZy5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gICAgdGhpcy5yZW5kZXJEZWJ1ZygpO1xuICB9XG5cbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgY29uc3QgdCA9ICQoJ3RvYXN0Jyk7IHQudGV4dENvbnRlbnQgPSBtc2c7IHQuY2xhc3NMaXN0LmFkZCgnc2hvdycpOyBjbGVhclRpbWVvdXQodGhpcy50b2FzdFQpOyB0aGlzLnRvYXN0VCA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHQuY2xhc3NMaXN0LnJlbW92ZSgnc2hvdycpLCAzNjAwKTsgfVxuXG4gIHJlbmRlcigpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBzID0gZy5zLCBwaCA9IGcucGhhc2UsIGJ1aWxkID0gcGggPT09ICdidWlsZCc7XG4gICAgJCgnaGVhcnRzJykudGV4dENvbnRlbnQgPSAnXHUyNzY0XHVGRTBGJy5yZXBlYXQocy5oZWFydHMpICsgJ1xcdXsxRjVBNH0nLnJlcGVhdChNYXRoLm1heCgwLCAzIC0gcy5oZWFydHMpKTtcbiAgICAkKCd3YXZlJykudGV4dENvbnRlbnQgPSBgV2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfWA7XG4gICAgY29uc3QgdXNlZCA9IGRvbWluaW9uVXNlZChzKTsgJCgnZG9tJykudGV4dENvbnRlbnQgPSBgJHt1c2VkfS8ke3MuY2FwfWA7ICgkKCdkb21maWxsJykgYXMgSFRNTEVsZW1lbnQpLnN0eWxlLndpZHRoID0gTWF0aC5taW4oMTAwLCAodXNlZCAvIHMuY2FwKSAqIDEwMCkgKyAnJSc7XG4gICAgLy8gZW5lbXkgcHJldmlldzogd2hhdCBpcyBjb21pbmcsIG5ldmVyIHdoZXJlXG4gICAgY29uc3QgcHYgPSBwcmV2aWV3VGV4dChlbmVteVdhdmUocy53YXZlLCBnLnNlZWQpKTtcbiAgICAkKCdlbmVteScpLmlubmVySFRNTCA9IGA8Yj5OZXh0IGVuZW1pZXM8L2I+YCArIHB2Lm1hcCgocCkgPT4gYDxkaXYgY2xhc3M9XCJlcm93XCI+PHNwYW4+JHtJQ09OW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3Bhbj4ke1NPVUxfTkFNRVtwLnNvdWwgYXMgU291bElkXX08L3NwYW4+PHNwYW4gY2xhc3M9XCJ4XCI+XHUwMEQ3JHtwLmNvdW50fTwvc3Bhbj48c3BhbiBjbGFzcz1cInN0XCI+JHtzdGFycyhwLnN0YXIpfTwvc3Bhbj48L2Rpdj5gKS5qb2luKCcnKSArIGA8ZGl2IGNsYXNzPVwiaGludFwiPlBvc2l0aW9ucyBzdGF5IGhpZGRlbiB1bnRpbCB0aGUgYmF0dGxlLjwvZGl2PmA7XG4gICAgLy8gaGFuZFxuICAgIGNvbnN0IGhhbmQgPSAkKCdoYW5kJyk7IGhhbmQuaW5uZXJIVE1MID0gJyc7XG4gICAgcy5oYW5kLmZvckVhY2goKHNvdWw6IFNvdWxJZCwgaTogbnVtYmVyKSA9PiB7XG4gICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBjb25zdCBzZWwgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAnY2FyZCcgJiYgZy5zZWwuaWR4ID09PSBpOyBjb25zdCBhZmZvcmQgPSBjYW5TdW1tb24ocywgaSk7XG4gICAgICBlbC5jbGFzc05hbWUgPSAnY2FyZCcgKyAoc2VsID8gJyBzZWwnIDogJycpICsgKCFhZmZvcmQgJiYgIWcuc3dhcE1vZGUgPyAnIGRpcycgOiAnJykgKyAoZy5zd2FwTW9kZSA/ICcgc3dhcCcgOiAnJyk7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+PGRpdiBjbGFzcz1cImljXCI+JHtJQ09OW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJjc1wiPlx1MjYwNTwvZGl2PmA7IGVsLnRpdGxlID0gUk9MRV9URVhUW3NvdWxdO1xuICAgICAgZWwub25jbGljayA9ICgpID0+IGcub25DYXJkKGkpOyBoYW5kLmFwcGVuZENoaWxkKGVsKTtcbiAgICB9KTtcbiAgICBpZiAoIXMuaGFuZC5sZW5ndGgpIGhhbmQuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9XCJlbXB0eVwiPk5vIGNhcmRzIGluIGhhbmQ8L2Rpdj4nO1xuICAgIC8vIGJ1dHRvbnNcbiAgICAoJCgnYnRuQmF0dGxlJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQpLmRpc2FibGVkID0gIWJ1aWxkIHx8ICFzLnVuaXRzLmxlbmd0aDtcbiAgICBjb25zdCBzdyA9ICQoJ2J0blN3YXAnKSBhcyBIVE1MQnV0dG9uRWxlbWVudDsgc3cuZGlzYWJsZWQgPSAhYnVpbGQgfHwgcy5kaXNjYXJkVXNlZDsgc3cuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBnLnN3YXBNb2RlKTsgc3cudGV4dENvbnRlbnQgPSBzLmRpc2NhcmRVc2VkID8gJ1N3YXAgdXNlZCcgOiBnLnN3YXBNb2RlID8gJ1N3YXA6IHBpY2sgYSBjYXJkIG9yIHVuaXQnIDogJ1N3YXAgKDEvcm91bmQpJztcbiAgICBjb25zdCBzZWxVID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ3VuaXQnID8gcy51bml0cy5maW5kKCh1OiBhbnkpID0+IHUuaWQgPT09IGcuc2VsLmlkKSA6IG51bGw7XG4gICAgY29uc3QgcGFydG5lciA9IHNlbFUgJiYgcy51bml0cy5zb21lKChvOiBhbnkpID0+IGNhbk1lcmdlRGVwbG95ZWQoc2VsVSwgbykpO1xuICAgICQoJ3VuaXRwYW5lbCcpLnN0eWxlLmRpc3BsYXkgPSBidWlsZCAmJiBzZWxVID8gJ2ZsZXgnIDogJ25vbmUnOyAoJCgnYnRuTWVyZ2UnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhcGFydG5lcjtcbiAgICAkKCdidG5SZW1vdmUnKS50ZXh0Q29udGVudCA9IGcuY29uZmlybVJlbW92ZSA/ICdDb25maXJtIHJlbW92ZScgOiAnUmVtb3ZlJztcbiAgICAkKCdpbmZvJykudGV4dENvbnRlbnQgPSBidWlsZCA/IChnLnN3YXBNb2RlID8gJ1NXQVA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkIGl0LCBvciB0YXAgYSB1bml0IHlvdSBkaWQgbm90IHN1bW1vbiB0aGlzIHJvdW5kIHRvIHNlbGwgaXQuIFlvdSBkcmF3IGEgZGlmZmVyZW50IFNvdWwuJ1xuICAgICAgOiBzZWxVID8gYCR7U09VTF9OQU1FW3NlbFUuc291bCBhcyBTb3VsSWRdfSAke3N0YXJzKHNlbFUuc3Rhcil9ICBcdTIwMjIgICR7Uk9MRV9URVhUW3NlbFUuc291bCBhcyBTb3VsSWRdfSAgJHtwYXJ0bmVyID8gJ1x1MjAyMiBUYXAgYSBnbG93aW5nIHBhcnRuZXIgdG8gbWVyZ2UuJyA6ICcnfWBcbiAgICAgIDogZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnID8gYCR7U09VTF9OQU1FW3MuaGFuZFtnLnNlbC5pZHhdIGFzIFNvdWxJZF19OiAke1JPTEVfVEVYVFtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfSAgXHUyMDIyICBUYXAgYSBncmVlbiB0aWxlIHRvIHN1bW1vbiR7cy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicgPyAnLCBvciBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgdGhlIGNhcmQgaW50byBpdCcgOiAnJ30uYCA6ICdUYXAgYSBjYXJkLCB0aGVuIGEgdGlsZS4gVGFwIGEgdW5pdCB0byBtZXJnZSwgbW92ZSBvciByZW1vdmUgaXQuJylcbiAgICAgIDogcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnQmF0dGxlISBVbml0cyBmaWdodCBvbiB0aGVpciBvd24uJyA6ICcnO1xuICAgICQoJ3NwZWVkJykuc3R5bGUuZGlzcGxheSA9IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2ZsZXgnIDogJ25vbmUnO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zcGVlZF0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgK2IuZGF0YXNldC5zcGVlZCEgPT09IGcudGltZVNjYWxlKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgYi5kYXRhc2V0LmNhbSA9PT0gZy5jYW1Nb2RlKSk7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QudG9nZ2xlKCdpbmJhdHRsZScsIHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nKTtcbiAgICAvLyBvdmVybGF5XG4gICAgY29uc3Qgb3YgPSAkKCdvdmVybGF5Jyk7IG92LmNsYXNzTmFtZSA9ICcnOyBvdi5pbm5lckhUTUwgPSAnJztcbiAgICBpZiAocGggPT09ICdkcmFmdCcgJiYgZy5kcmFmdCkge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5WaWN0b3J5IERyYWZ0PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+V2F2ZSBjbGVhcmVkLiBEb21pbmlvbiBpcyBub3cgJHtzLmNhcH0uIEtlZXAgb25lOjwvZGl2PjxkaXYgY2xhc3M9XCJyb3dcIj4ke2cuZHJhZnQubWFwKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4gYDxkaXYgY2xhc3M9XCJjYXJkIGJpZ1wiIGRhdGEtaT1cIiR7aX1cIj48ZGl2IGNsYXNzPVwiY29zdFwiPiR7Y29zdChzb3VsLCAxKX08L2Rpdj48ZGl2IGNsYXNzPVwiaWNcIj4ke0lDT05bc291bF19PC9kaXY+PGRpdiBjbGFzcz1cIm5tXCI+JHtTT1VMX05BTUVbc291bF19PC9kaXY+PGRpdiBjbGFzcz1cInJvbGVcIj4ke1JPTEVfVEVYVFtzb3VsXX08L2Rpdj48L2Rpdj5gKS5qb2luKCcnKX08L2Rpdj48L2Rpdj5gO1xuICAgICAgb3YucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJy5jYXJkJykuZm9yRWFjaCgoYykgPT4gKGMub25jbGljayA9ICgpID0+IGcucGlja0RyYWZ0KCtjLmRhdGFzZXQuaSEpKSk7XG4gICAgfSBlbHNlIGlmIChwaCA9PT0gJ3dvbicgfHwgcGggPT09ICdsb3N0Jykge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj4ke3BoID09PSAnd29uJyA/ICdTdGFnZSBjbGVhcmVkIScgOiAnU3RhZ2UgbG9zdCd9PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+JHtnLmxhc3RCYXR0bGV9PC9kaXY+PGJ1dHRvbiBpZD1cImFnYWluXCI+JHtwaCA9PT0gJ3dvbicgPyAnUGxheSBhZ2FpbicgOiAnVHJ5IGFnYWluJ308L2J1dHRvbj48L2Rpdj5gO1xuICAgICAgJCgnYWdhaW4nKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydFN0YWdlKGcuc2VlZCArIDEpO1xuICAgIH1cbiAgICB0aGlzLnJlbmRlckRlYnVnTGl2ZSgpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIHBhbmVsXG4gIHByaXZhdGUgcmVuZGVyRGVidWcoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgZCA9IHRoaXMuZGJnOyBpZiAoIWQuY2xhc3NMaXN0LmNvbnRhaW5zKCdvcGVuJykpIHsgZC5pbm5lckhUTUwgPSAnJzsgcmV0dXJuOyB9XG4gICAgY29uc3Qgcm93ID0gKGxhYmVsOiBzdHJpbmcsIG9iajogYW55LCBrZXk6IHN0cmluZyB8IG51bWJlciwgbWluOiBudW1iZXIsIG1heDogbnVtYmVyLCBzdGVwOiBudW1iZXIpID0+IGA8bGFiZWw+JHtsYWJlbH0gPGlucHV0IHR5cGU9XCJyYW5nZVwiIG1pbj1cIiR7bWlufVwiIG1heD1cIiR7bWF4fVwiIHN0ZXA9XCIke3N0ZXB9XCIgdmFsdWU9XCIke29ialtrZXldfVwiIGRhdGEtbz1cIiR7bGFiZWx9XCI+PHNwYW4+JHtvYmpba2V5XX08L3NwYW4+PC9sYWJlbD5gO1xuICAgIGQuaW5uZXJIVE1MID0gYDxiPkRlYnVnIChsaXZlKTwvYj4gPHNwYW4gaWQ9XCJkYmdmcHNcIj48L3NwYW4+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPlN0YXIgbXVsdGlwbGllcnMgKGJvZGllcyA9IGRhbWFnZSwgc3RhcnMgPSBkdXJhYmlsaXR5KVxuICAgICAgICAke3JvdygnSFAgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAxLCAxLCA0LCAwLjA1KX0ke3JvdygnSFAgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnRGFtYWdlIHggMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5kbWcsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMiwgMSwgNiwgMC4wNSl9JHtyb3coJ1NpemUgMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5zY2FsZSwgMSwgMSwgMS42LCAwLjAyKX0ke3JvdygnU2l6ZSAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAyLCAxLCAyLCAwLjAyKX08L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHRhYmxlPjx0cj48dGg+PC90aD48dGg+aHA8L3RoPjx0aD5kbWc8L3RoPjx0aD5yYXRlPC90aD48dGg+cmFuZ2U8L3RoPjx0aD5zcGQ8L3RoPjwvdHI+JHtTT1VMUy5tYXAoKGspID0+IGA8dHI+PHRkPiR7SUNPTltrXX08L3RkPiR7WydocCcsICdkbWcnLCAnaW50ZXJ2YWwnLCAncmFuZ2UnLCAnc3BlZWQnXS5tYXAoKGYpID0+IGA8dGQ+PGlucHV0IGNsYXNzPVwibnVtXCIgZGF0YS1zb3VsPVwiJHtrfVwiIGRhdGEtZj1cIiR7Zn1cIiB2YWx1ZT1cIiR7KEJBTEFOQ0Uuc3RhdHMgYXMgYW55KVtrXVtmXX1cIj48L3RkPmApLmpvaW4oJycpfTwvdHI+YCkuam9pbignJyl9PC90YWJsZT48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+RGlmZmljdWx0eSA8c2VsZWN0IGlkPVwiZERpZmZcIj4ke1snZWFzeScsICdub3JtYWwnLCAnaGFyZCddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZE9kZHNcIj5UZXN0IG9kZHMgKDIwMCBmaWdodHMpPC9idXR0b24+IDxzcGFuIGlkPVwiZE9kZHNPdXRcIj4ke3RoaXMub2Rkc308L3NwYW4+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkQ29weVwiPkNvcHkgcmVwb3J0PC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzZXRcIj5SZXNldCBiYWxhbmNlPC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzdGFydFwiPlJlc3RhcnQgc3RhZ2U8L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+QWRkIGNhcmQgPHNlbGVjdCBpZD1cImRDYXJkXCI+JHtTT1VMUy5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiPiR7U09VTF9OQU1FW2tdfTwvb3B0aW9uPmApLmpvaW4oJycpfTwvc2VsZWN0PiA8YnV0dG9uIGlkPVwiZEFkZFwiPis8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImREb21cIj4rMiBEb21pbmlvbjwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+TGFzdCB0YXA6IDxzcGFuIGlkPVwiZGJndGFwXCI+JHtnLmxhc3RUYXBJbmZvfTwvc3Bhbj48L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+U2VlZCAke2cuc2VlZH0uIEFkZCA8Y29kZT4/c2VlZD03PC9jb2RlPiB0byB0aGUgbGluayB0byByZXBsYXkgdGhlIHNhbWUgZHJhd3MuPC9zbWFsbD48L2Rpdj5gO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXRbdHlwZT1yYW5nZV0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25pbnB1dCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGxhYiA9IGlucC5kYXRhc2V0Lm8hOyBjb25zdCB2ID0gK2lucC52YWx1ZTsgKGlucC5uZXh0RWxlbWVudFNpYmxpbmcgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gU3RyaW5nKHYpO1xuICAgICAgY29uc3Qgc2V0OiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkPiA9IHsgJ0hQIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMV0gPSB2KSwgJ0hQIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMl0gPSB2KSwgJ0RhbWFnZSB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1sxXSA9IHYpLCAnRGFtYWdlIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzJdID0gdiksICdTaXplIDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzFdID0gdiksICdTaXplIDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzJdID0gdikgfTtcbiAgICAgIHNldFtsYWJdKCk7IGcuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7XG4gICAgfSkpO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXQubnVtJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uY2hhbmdlID0gKCkgPT4geyAoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2lucC5kYXRhc2V0LnNvdWwhXVtpbnAuZGF0YXNldC5mIV0gPSAraW5wLnZhbHVlOyB9KSk7XG4gICAgJCgnZERpZmYnKS5vbmNoYW5nZSA9IChlKSA9PiBnLmNoYW5nZURpZmZpY3VsdHkoKGUudGFyZ2V0IGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSk7XG4gICAgJCgnZE1lcmdlSGFuZCcpLm9uY2hhbmdlID0gKGUpID0+IHsgZy5zLnJ1bGVzLm1lcmdlID0gKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQgPyAnaGFuZEludG9PbmVTdGFyJyA6ICdkZXBsb3llZE9ubHknOyBnLnN5bmNCdWlsZCgpOyB0aGlzLnJlbmRlcigpOyB9O1xuICAgICQoJ2RPZGRzJykub25jbGljayA9ICgpID0+IHsgY29uc3QgciA9IGcudGVzdE9kZHMoMjAwKTsgdGhpcy5vZGRzID0gYCR7ci53aW59JSB3aW4gKCR7ci5ufSBmaWdodHMsIGF2ZyAke3IuYXZnVGltZX1zKSB2cyB3YXZlICR7Zy5zLndhdmV9YDsgJCgnZE9kZHNPdXQnKS50ZXh0Q29udGVudCA9IHRoaXMub2RkczsgfTtcbiAgICAkKCdkQ29weScpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdSZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkUmVzZXQnKS5vbmNsaWNrID0gKCkgPT4geyBnLnJlc2V0QmFsYW5jZUFsbCgpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgJCgnZFJlc3RhcnQnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydFN0YWdlKGcuc2VlZCk7XG4gICAgJCgnZEFkZCcpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZENhcmQoKCQoJ2RDYXJkJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlIGFzIFNvdWxJZCk7ICQoJ2REb20nKS5vbmNsaWNrID0gKCkgPT4gZy5hZGREb21pbmlvbigyKTtcbiAgfVxuICBwcml2YXRlIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5lbmdpbmUuZ2V0RnBzKCkudG9GaXhlZCgwKX0gZnBzIFx1MjAyMiAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJndGFwJyk7IGlmICh0KSB0LnRleHRDb250ZW50ID0gdGhpcy5nLmxhc3RUYXBJbmZvO1xuICB9XG59XG4iLCAiLy8gVGhlIHBsYXlhYmxlIHByb3RvdHlwZTogYnVpbGQgc2NyZWVuIC0+IGJhdHRsZSAtPiBkcmFmdCAtPiBuZXh0IHdhdmUsIGJ1aWx0IG9uIHRoZSB0ZXN0ZWQgcnVsZXMgKyBiYXR0bGUgZW5naW5lLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFLCByZXNldEJhbGFuY2UsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBHUklEX0NFTExTLCBHUklEX0NPTFMsIEdSSURfUk9XUywgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHtcbiAgYWR2YW5jZVdhdmUsIGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY2VsbEZyZWUsIGNvc3QsIGRpc2NhcmRSZWRyYXcsIGRpc21pc3MsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBkcmFmdE9wdGlvbnMsIGZhaWxXYXZlLFxuICBtZXJnZURlcGxveWVkLCBtZXJnZUZyb21IYW5kLCBtb3ZlVW5pdCwgbmV3U3RhZ2UsIG5vcm1hbERyYXcsIHN0YWdlV2F2ZXMsIHN1bW1vbiwgc3dhcFNlbGwsIHRha2VEcmFmdCxcbn0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBCYXR0bGUsIGNlbGxQb3MsIEZST05UX1gsIEdSSURfU1AsIHNpbXVsYXRlIH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHR5cGUgeyBCRXZlbnQgfSBmcm9tICcuLi9jb3JlL2JhdHRsZS50cyc7XG5pbXBvcnQgeyBkaWZmaWN1bHR5TmFtZSwgZW5lbXlXYXZlLCBzZXREaWZmaWN1bHR5IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuLi9jb3JlL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgeyBjcmVhdGVWaXN1YWwsIGlzVHJpcG8sIGxvYWRBc3NldHMgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHR5cGUgeyBBc3NldHMsIFVuaXRWaXN1YWwgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHsgVWkgfSBmcm9tICcuL3VpLnRzJztcblxuZXhwb3J0IHR5cGUgUGhhc2UgPSAnYnVpbGQnIHwgJ3RyYW5zaXRpb24nIHwgJ2JhdHRsZScgfCAnZHJhZnQnIHwgJ3dvbicgfCAnbG9zdCc7XG50eXBlIFNlbCA9IHsgdHlwZTogJ2NhcmQnOyBpZHg6IG51bWJlciB9IHwgeyB0eXBlOiAndW5pdCc7IGlkOiBudW1iZXIgfSB8IG51bGw7XG5cbmV4cG9ydCBjbGFzcyBHYW1lIHtcbiAgZW5naW5lOiBhbnk7IHNjZW5lOiBhbnk7IGNhbWVyYTogYW55OyBBITogQXNzZXRzOyB1aSE6IFVpO1xuICBzITogU3RhdGU7IHNlZWQgPSAxOyBhdHRlbXB0ID0gMDsgcGhhc2U6IFBoYXNlID0gJ2J1aWxkJzsgYmF0dGxlOiBCYXR0bGUgfCBudWxsID0gbnVsbDsgdGltZVNjYWxlID0gMTtcbiAgc2VsOiBTZWwgPSBudWxsOyBzd2FwTW9kZSA9IGZhbHNlOyBjb25maXJtUmVtb3ZlID0gZmFsc2U7IGRyYWZ0OiBTb3VsSWRbXSB8IG51bGwgPSBudWxsOyBsYXN0QmF0dGxlID0gJyc7XG4gIHByaXZhdGUgdW5pdFZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgLy8gdW5pdCBpZCAtPiB2aXN1YWwgKHlvdXIgYXJteSwgcGVyc2lzdHMgYmV0d2VlbiB3YXZlcylcbiAgcHJpdmF0ZSB2aXNUb1VuaXQgPSBuZXcgTWFwPFVuaXRWaXN1YWwsIG51bWJlcj4oKTtcbiAgcHJpdmF0ZSBmdmlzID0gbmV3IE1hcDxudW1iZXIsIFVuaXRWaXN1YWw+KCk7ICAgICAgICAgICAvLyBmaWdodGVyIGlkIC0+IHZpc3VhbCBkdXJpbmcgYSBiYXR0bGVcbiAgcHJpdmF0ZSBmVW5pdCA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCk7ICAgICAgICAgICAgICAvLyBmaWdodGVyIGlkIC0+IHVuaXQgaWQgKHBsYXllciBzaWRlKVxuICBwcml2YXRlIGxhc3RTdGF0ZSA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmc+KCk7XG4gIHByaXZhdGUgdGlsZXM6IGFueVtdID0gW107IHByaXZhdGUgdGlsZU1hdHM6IGFueVtdID0gW107IHByaXZhdGUgcmluZ0Z4OiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93czogYW55W10gPSBbXTsgcHJpdmF0ZSB0aW1lcnM6IHsgdDogbnVtYmVyOyBmbjogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSBhY2MgPSAwOyBwcml2YXRlIGNhbUZyb206IGFueSA9IG51bGw7IHByaXZhdGUgY2FtVG86IGFueSA9IG51bGw7IHByaXZhdGUgY2FtVCA9IDE7IHByaXZhdGUgY2FtRHVyID0gMi4wOyBwcml2YXRlIHJlc3VsdEF0ID0gLTE7IHByaXZhdGUgaGFuZGxlZCA9IGZhbHNlOyBwcml2YXRlIHN0YXJ0U3RlcEF0ID0gMDtcbiAgcHJpdmF0ZSBhcnJvd01hdHM6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dNZXNoOiBhbnlbXSA9IFtdO1xuXG4gIGFzeW5jIGluaXQoY2FudmFzOiBIVE1MQ2FudmFzRWxlbWVudCkge1xuICAgIGNvbnN0IHFzID0gbmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpO1xuICAgIHRoaXMuZW5naW5lID0gbmV3IEJBQllMT04uRW5naW5lKGNhbnZhcywgdHJ1ZSwgeyBhbnRpYWxpYXM6IHRydWUsIHBvd2VyUHJlZmVyZW5jZTogJ2hpZ2gtcGVyZm9ybWFuY2UnIH0pO1xuICAgIGNvbnN0IGRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7IHRoaXMuZW5naW5lLnNldEhhcmR3YXJlU2NhbGluZ0xldmVsKDEgLyBNYXRoLm1pbihkcHIsIDEuNSkpO1xuICAgIGNvbnN0IHNjZW5lID0gdGhpcy5zY2VuZSA9IG5ldyBCQUJZTE9OLlNjZW5lKHRoaXMuZW5naW5lKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjA5LCAwLjA3LCAwLjEzLCAxKTtcbiAgICBjb25zdCBoZW1pID0gbmV3IEJBQllMT04uSGVtaXNwaGVyaWNMaWdodCgnaCcsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAxLCAwLjMpLCBzY2VuZSk7IGhlbWkuaW50ZW5zaXR5ID0gMS4wNTsgaGVtaS5ncm91bmRDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjMyLCAwLjI2LCAwLjQyKTtcbiAgICBjb25zdCBzdW4gPSBuZXcgQkFCWUxPTi5EaXJlY3Rpb25hbExpZ2h0KCdzJywgbmV3IEJBQllMT04uVmVjdG9yMygtMC40LCAtMSwgMC41NSksIHNjZW5lKTsgc3VuLmludGVuc2l0eSA9IDAuODU7XG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgQkFCWUxPTi5GcmVlQ2FtZXJhKCdjYW0nLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDgsIC05KSwgc2NlbmUpOyB0aGlzLmNhbWVyYS5taW5aID0gMC4xOyB0aGlzLmNhbWVyYS5tYXhaID0gMjAwOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg7IHRoaXMuY2FtZXJhLmlucHV0cy5jbGVhcigpO1xuXG4gICAgY29uc3QgZ3JvdW5kID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ2dyb3VuZCcsIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQwIH0sIHNjZW5lKTtcbiAgICBjb25zdCBnbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2dtJywgc2NlbmUpOyBnbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xNywgMC4xNSwgMC4yMSk7IGdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBncm91bmQubWF0ZXJpYWwgPSBnbTsgZ3JvdW5kLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHRlYW0gb2YgWzAsIDFdIGFzIGNvbnN0KSBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBjb25zdCB0ID0gdGhpcy5tYWtlVGlsZSh0ZWFtLCBjKTsgaWYgKHRlYW0gPT09IDApIHRoaXMudGlsZXMucHVzaCh0KTsgZWxzZSB0LnNldEVuYWJsZWQoZmFsc2UpOyB9XG5cbiAgICB0aGlzLkEgPSBhd2FpdCBsb2FkQXNzZXRzKHNjZW5lKTtcbiAgICB0aGlzLmFycm93TWF0cyA9IFswLCAxXS5tYXAoKHQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2FtJyArIHQsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMywgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC43LCAwLjI1KTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyByZXR1cm4gbTsgfSk7XG4gICAgdGhpcy51aSA9IG5ldyBVaSh0aGlzKTsgdGhpcy5zZWVkID0gKyhxcy5nZXQoJ3NlZWQnKSB8fCAxKTtcblxuICAgIC8vIFRhcHMgYXJlIGRldGVjdGVkIGhlcmUgKG5vdCB0aHJvdWdoIEJhYnlsb24pIHNvIHRoZXkgYmVoYXZlIHRoZSBzYW1lIGluIFNhZmFyaSwgdGhlIGhvbWUtc2NyZWVuIGFwcCBhbmQgb24gZGVza3RvcC5cbiAgICBsZXQgZG93bjogeyB4OiBudW1iZXI7IHk6IG51bWJlcjsgdDogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBsb2NhbCA9IChlOiBQb2ludGVyRXZlbnQpID0+IHsgY29uc3QgciA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsgcmV0dXJuIHsgeDogZS5jbGllbnRYIC0gci5sZWZ0LCB5OiBlLmNsaWVudFkgLSByLnRvcCB9OyB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyZG93bicsIChlKSA9PiB7IGRvd24gPSB7IC4uLmxvY2FsKGUpLCB0OiBwZXJmb3JtYW5jZS5ub3coKSB9OyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcnVwJywgKGUpID0+IHsgaWYgKCFkb3duKSByZXR1cm47IGNvbnN0IHAgPSBsb2NhbChlKTsgY29uc3QgbW92ZWQgPSBNYXRoLmh5cG90KHAueCAtIGRvd24ueCwgcC55IC0gZG93bi55KSwgZHQgPSBwZXJmb3JtYW5jZS5ub3coKSAtIGRvd24udDsgZG93biA9IG51bGw7IGlmIChtb3ZlZCA8IDE2ICYmIGR0IDwgOTAwKSB0aGlzLnRhcChwLngsIHAueSk7IH0pO1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyY2FuY2VsJywgKCkgPT4geyBkb3duID0gbnVsbDsgfSk7XG4gICAgdGhpcy5jYW52YXMgPSBjYW52YXM7IGNvbnN0IG9uUmVzaXplID0gKCkgPT4gdGhpcy5oYW5kbGVSZXNpemUoKTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpOyB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignb3JpZW50YXRpb25jaGFuZ2UnLCAoKSA9PiBzZXRUaW1lb3V0KG9uUmVzaXplLCAyNTApKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0KSAod2luZG93IGFzIGFueSkudmlzdWFsVmlld3BvcnQuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpO1xuICAgIGlmICgod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIpIG5ldyAod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIob25SZXNpemUpLm9ic2VydmUoY2FudmFzKTtcbiAgICBpZiAocXMuZ2V0KCdnYWxsZXJ5JykpIHsgdGhpcy5nYWxsZXJ5KCk7IHJldHVybjsgfVxuICAgIHRoaXMuc3RhcnRTdGFnZSh0aGlzLnNlZWQpO1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG5vdyA9IHBlcmZvcm1hbmNlLm5vdygpOyBjb25zdCBkdCA9IE1hdGgubWluKDAuMDUsIChub3cgLSBsYXN0KSAvIDEwMDApOyBsYXN0ID0gbm93OyB0aGlzLmZyYW1lKGR0KTsgc2NlbmUucmVuZGVyKCk7IH0pO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2NlbmUgaGVscGVyc1xuICBwcml2YXRlIG1ha2VUaWxlKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKSwgdCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3RpbGUnICsgY2VsbCwgeyBzaXplOiBHUklEX1NQICogMC45MiB9LCB0aGlzLnNjZW5lKTtcbiAgICB0LnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdC5wb3NpdGlvbi5zZXQocC54LCAwLjAxNSwgcC56KTtcbiAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndG0nLCB0aGlzLnNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuMTgsIDAuMTIsIDAuNDIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNDIsIDAuMTIsIDAuMTIpOyBtLmFscGhhID0gMC41OyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHQubWF0ZXJpYWwgPSBtO1xuICAgIGlmICh0ZWFtID09PSAwKSB7IHQubWV0YWRhdGEgPSB7IGtpbmQ6ICd0aWxlJywgY2VsbCB9OyB0aGlzLnRpbGVNYXRzW2NlbGxdID0gbTsgfSBlbHNlIHQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHJldHVybiB0O1xuICB9XG4gIHByaXZhdGUgdGludChjZWxsOiBudW1iZXIsIG1vZGU6ICdub3JtYWwnIHwgJ2ZyZWUnIHwgJ3NlbCcgfCAncGFydG5lcicpIHtcbiAgICBjb25zdCBtID0gdGhpcy50aWxlTWF0c1tjZWxsXTsgY29uc3QgYyA9IHsgbm9ybWFsOiBbMC4xOCwgMC4xMiwgMC40MiwgMC41XSwgZnJlZTogWzAuMiwgMC43NSwgMC41NSwgMC43XSwgc2VsOiBbMSwgMC44MiwgMC4zLCAwLjg1XSwgcGFydG5lcjogWzAuODUsIDAuMzUsIDEsIDAuODVdIH1bbW9kZV07XG4gICAgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pOyBtLmFscGhhID0gY1szXTtcbiAgfVxuICBsYXRlcihzZWM6IG51bWJlciwgZm46ICgpID0+IHZvaWQpIHsgdGhpcy50aW1lcnMucHVzaCh7IHQ6IHNlYywgZm4gfSk7IH1cbiAgcHJpdmF0ZSBmeFJpbmcoeDogbnVtYmVyLCB6OiBudW1iZXIsIGNvbG9yOiBhbnksIHIwOiBudW1iZXIsIHIxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2Z4JywgeyBkaWFtZXRlcjogMSwgdGhpY2tuZXNzOiAwLjAzNSwgdGVzc2VsbGF0aW9uOiAyOCB9LCB0aGlzLnNjZW5lKTsgbS5wb3NpdGlvbi5zZXQoeCwgMC4wNSwgeik7IG0uaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG1tID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZnhtJywgdGhpcy5zY2VuZSk7IG1tLmVtaXNzaXZlQ29sb3IgPSBjb2xvcjsgbW0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbW0uYWxwaGEgPSAwLjk7IG0ubWF0ZXJpYWwgPSBtbTsgdGhpcy5yaW5nRngucHVzaCh7IG0sIG1tLCB0OiAwLCByMCwgcjEsIGR1ciB9KTtcbiAgfVxuICBwcml2YXRlIGJ1cnN0KHg6IG51bWJlciwgejogbnVtYmVyLCBjMTogbnVtYmVyW10sIGMyOiBudW1iZXJbXSwgY291bnQ6IG51bWJlcikge1xuICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2InLCA2MCwgdGhpcy5zY2VuZSk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCAwLjA1LCB6KTsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMC4wNSwgMC4yKTtcbiAgICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMxIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzIgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMSwgMCwgMC4yLCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4xMjsgcHMubWF4U2l6ZSA9IDAuMzQ7IHBzLm1pbkxpZmVUaW1lID0gMC40OyBwcy5tYXhMaWZlVGltZSA9IDAuOTsgcHMuZW1pdFJhdGUgPSAwOyBwcy5tYW51YWxFbWl0Q291bnQgPSBjb3VudDsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEsIDEuMywgLTEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygxLCAyLjQsIDEpO1xuICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuODsgcHMubWF4RW1pdFBvd2VyID0gMjsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgLTIsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnRhcmdldFN0b3BEdXJhdGlvbiA9IDEuMjsgcHMuZGlzcG9zZU9uU3RvcCA9IHRydWU7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBjYW1lcmFcbiAgcHJpdmF0ZSBwb3NlcygpIHtcbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCBoYWxmID0gRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1AgKyAxLjQ7XG4gICAgY29uc3QgZCA9IE1hdGgubWF4KGhhbGYgLyAodGFuViAqIGFzcCksICgoR1JJRF9ST1dTICogR1JJRF9TUCkgLyAyICsgMikgLyAodGFuViAqIDAuNTUpLCA4KTtcbiAgICBjb25zdCBiYXR0bGUgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMygtMC4xICogZCwgMC40MiAqIGQgKyAwLjUsIC0wLjg2ICogZCksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjM1LCAwKSB9O1xuICAgIC8vIEJ1aWxkIHZpZXc6IChhbG1vc3QpIHN0cmFpZ2h0IGRvd24sIHdpdGggdGhlIHdob2xlIGdyaWQgaW5zaWRlIHRoZSBiYW5kIGJldHdlZW4gdGhlIHRvcCBiYXIgYW5kIHRoZSBoYW5kIG9mIGNhcmRzLlxuICAgIGNvbnN0IGN4ID0gLShGUk9OVF9YICsgKChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC8gMiksIEggPSBNYXRoLm1heCgxLCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpO1xuICAgIGNvbnN0IGJveCA9IChpZDogc3RyaW5nKSA9PiB7IGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOyByZXR1cm4gZWwgJiYgZWwub2Zmc2V0UGFyZW50ICE9PSBudWxsID8gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkgOiBudWxsOyB9O1xuICAgIGNvbnN0IHRvcEJhciA9IGJveCgndG9wJyksIGhhbmQgPSBib3goJ2hhbmQnKSwgaW5mbyA9IGJveCgnaW5mbycpO1xuICAgIGNvbnN0IFRPUCA9IE1hdGgubWluKDAuMzIsIHRvcEJhciA/ICh0b3BCYXIuYm90dG9tICsgNikgLyBIIDogMC4xKTtcbiAgICBjb25zdCBCT1RUT00gPSBNYXRoLm1pbigwLjUsIChIIC0gTWF0aC5taW4oaGFuZCA/IGhhbmQudG9wIDogSCwgaW5mbyA/IGluZm8udG9wIDogSCkgKyA2KSAvIEgpO1xuICAgIGNvbnN0IGJhbmQgPSBNYXRoLm1heCgwLjMsIDEgLSBUT1AgLSBCT1RUT00pLCBjZW50ZXJGcmFjID0gVE9QICsgYmFuZCAvIDI7ICAgICAgICAgIC8vIHRoZSBncmlkJ3MgY2VudHJlIGFwcGVhcnMgYXQgdGhpcyBmcmFjdGlvbiBmcm9tIHRoZSB0b3BcbiAgICBjb25zdCBndyA9IEdSSURfQ09MUyAqIEdSSURfU1AgKyAwLjUsIGdoID0gR1JJRF9ST1dTICogR1JJRF9TUCArIDAuNTtcbiAgICBjb25zdCBkMiA9IE1hdGgubWF4KGdoIC8gKDIgKiB0YW5WICogYmFuZCksIGd3IC8gKDIgKiB0YW5WICogYXNwICogMC44OCksIDQuNSk7XG4gICAgY29uc3Qgc2hpZnQgPSAoMC41IC0gY2VudGVyRnJhYykgKiAyICogZDIgKiB0YW5WO1xuICAgIGNvbnN0IGJ1aWxkID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3gsIGQyLCAtc2hpZnQgLSAwLjEgKiBkMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMyhjeCwgMCwgLXNoaWZ0KSB9O1xuICAgIHJldHVybiB7IGJhdHRsZSwgYnVpbGQgfTtcbiAgfVxuICBwcml2YXRlIGNhbnZhcyE6IEhUTUxDYW52YXNFbGVtZW50OyBwcml2YXRlIGxhc3RXID0gMDsgcHJpdmF0ZSBsYXN0SCA9IDA7IGxhc3RUYXBJbmZvID0gJyhubyB0YXBzIHlldCknO1xuICBwcml2YXRlIGhhbmRsZVJlc2l6ZSgpIHtcbiAgICB0aGlzLmVuZ2luZS5yZXNpemUoKTsgdGhpcy5sYXN0VyA9IHRoaXMuY2FudmFzLmNsaWVudFdpZHRoOyB0aGlzLmxhc3RIID0gdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnICYmIHRoaXMuY2FtVCA+PSAxKSB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpO1xuICB9XG4gIC8qKiBBIHRhcCBvbiB0aGUgM0QgdmlldzogcGljayBhIHRpbGUgb3IgYSB1bml0LiAqL1xuICBwcml2YXRlIHRhcCh4OiBudW1iZXIsIHk6IG51bWJlcikge1xuICAgIGNvbnN0IHAgPSB0aGlzLnNjZW5lLnBpY2soeCwgeSwgKG06IGFueSkgPT4gISEobS5tZXRhZGF0YSAmJiBtLm1ldGFkYXRhLmtpbmQpKTtcbiAgICBjb25zdCBtZCA9IHAgJiYgcC5oaXQgPyBwLnBpY2tlZE1lc2gubWV0YWRhdGEgOiBudWxsO1xuICAgIHRoaXMubGFzdFRhcEluZm8gPSBgdGFwICR7TWF0aC5yb3VuZCh4KX0sJHtNYXRoLnJvdW5kKHkpfSBvZiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gLT4gJHttZCA/IChtZC5raW5kID09PSAndGlsZScgPyAndGlsZSAnICsgbWQuY2VsbCA6ICd1bml0JykgOiAnbm90aGluZyd9IChwaGFzZSAke3RoaXMucGhhc2V9KWA7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgIW1kKSByZXR1cm47XG4gICAgaWYgKG1kLmtpbmQgPT09ICd0aWxlJykgdGhpcy5vblRpbGUobWQuY2VsbCk7IGVsc2UgaWYgKG1kLmtpbmQgPT09ICd1bml0JykgdGhpcy5vblVuaXRWaXN1YWwobWQudmlzdWFsKTtcbiAgfVxuICBwcml2YXRlIHNldENhbShwOiBhbnkpIHsgdGhpcy5jYW1lcmEucG9zaXRpb24uY29weUZyb20ocC5wb3MpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQocC50Z3QuY2xvbmUoKSk7IH1cbiAgcHJpdmF0ZSB0d2VlbkNhbSh0bzogYW55LCBkdXI6IG51bWJlcikgeyB0aGlzLmNhbUZyb20gPSB7IHBvczogdGhpcy5jYW1lcmEucG9zaXRpb24uY2xvbmUoKSwgdGd0OiB0aGlzLmNhbWVyYS5nZXRUYXJnZXQoKS5jbG9uZSgpIH07IHRoaXMuY2FtVG8gPSB0bzsgdGhpcy5jYW1UID0gMDsgdGhpcy5jYW1EdXIgPSBkdXI7IH1cblxuICAvLyAtLS0tIGJhdHRsZSBjYW1lcmE6IGZvbGxvd3MgdGhlIGZpZ2h0ZXJzIHRoYXQgYXJlIHN0aWxsIGFsaXZlLCBzbyB0aGUgYWN0aW9uIChhbmQgdGhlIHB1cnBsZSBleWVzKSBzdGF5cyBsYXJnZSBvbiBzY3JlZW5cbiAgY2FtTW9kZTogJ2Nsb3NlJyB8ICd3aWRlJyA9ICdjbG9zZSc7IHByaXZhdGUgY2FtVGd0OiBhbnkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgMCk7XG4gIHNldENhbU1vZGUobTogJ2Nsb3NlJyB8ICd3aWRlJykge1xuICAgIHRoaXMuY2FtTW9kZSA9IG07XG4gICAgaWYgKG0gPT09ICd3aWRlJyAmJiB0aGlzLmJhdHRsZSkgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAwLjkpO1xuICAgIHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcHJpdmF0ZSBmcmFtZUJhdHRsZShkdDogbnVtYmVyKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlOyBpZiAoIWIpIHJldHVybjsgY29uc3QgYWxpdmUgPSBiLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSk7IGlmICghYWxpdmUubGVuZ3RoKSByZXR1cm47XG4gICAgbGV0IHgwID0gMWU5LCB4MSA9IC0xZTksIHowID0gMWU5LCB6MSA9IC0xZTk7IGZvciAoY29uc3QgZiBvZiBhbGl2ZSkgeyB4MCA9IE1hdGgubWluKHgwLCBmLngpOyB4MSA9IE1hdGgubWF4KHgxLCBmLngpOyB6MCA9IE1hdGgubWluKHowLCBmLnopOyB6MSA9IE1hdGgubWF4KHoxLCBmLnopOyB9XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3Qgd2lkZSA9IHRoaXMucG9zZXMoKS5iYXR0bGUsIGN4ID0gKHgwICsgeDEpIC8gMiwgY3ogPSAoejAgKyB6MSkgLyAyO1xuICAgIGNvbnN0IGQgPSBNYXRoLm1pbihNYXRoLm1heCgoeDEgLSB4MCArIDMuNCkgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjkpLCAoejEgLSB6MCArIDMuMikgLyAoMiAqIHRhblYgKiAwLjYyKSwgNS40KSwgTWF0aC5oeXBvdCh3aWRlLnBvcy55LCB3aWRlLnBvcy56KSk7XG4gICAgY29uc3QgdGd0ID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCwgMC41NSwgY3opLCBwb3MgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4IC0gMC4wNiAqIGQsIDAuMzIgKiBkICsgMC41LCBjeiAtIDAuOSAqIGQpO1xuICAgIGNvbnN0IGsgPSAxIC0gTWF0aC5leHAoLWR0ICogMi4wKTtcbiAgICB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtZXJhLnBvc2l0aW9uLCBwb3MsIGspOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtVGd0LCB0Z3QsIGspOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFnZSBmbG93XG4gIHN0YXJ0U3RhZ2Uoc2VlZDogbnVtYmVyKSB7XG4gICAgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgdGhpcy5zID0gbmV3U3RhZ2UoUFJPVE9UWVBFX1JVTEVTLCBzZWVkKTtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJzsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnRvYXN0KCdTdGFnZSBzdGFydDogNCBjYXJkcywgJyArIHRoaXMucy5jYXAgKyAnIERvbWluaW9uLiBTdW1tb24sIG1lcmdlLCB0aGVuIHByZXNzIEJBVFRMRS4nKTtcbiAgfVxuICBwcml2YXRlIGNsZWFyQmF0dGxlKCkge1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi5kaXNwb3NlKCk7IH0pOyB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpOyB0aGlzLmJhdHRsZSA9IG51bGw7XG4gICAgdGhpcy5hcnJvd3MuZm9yRWFjaCgoYSkgPT4gYS5tZXNoLmRpc3Bvc2UoKSk7IHRoaXMuYXJyb3dzID0gW107XG4gIH1cbiAgcHJpdmF0ZSBwb3MoY2VsbDogbnVtYmVyKSB7IHJldHVybiBjZWxsUG9zKDAsIGNlbGwpOyB9XG4gIHN5bmNCdWlsZCgpIHtcbiAgICBjb25zdCBhbGl2ZSA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gdS5pZCkpO1xuICAgIGZvciAoY29uc3QgW2lkLCB2XSBvZiB0aGlzLnVuaXRWaXMpIGlmICghYWxpdmUuaGFzKGlkKSkgeyB0aGlzLnZpc1RvVW5pdC5kZWxldGUodik7IGNvbnN0IHAgPSB2LmhvbGRlci5wb3NpdGlvbjsgdGhpcy5idXJzdChwLngsIHAueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxNik7IHYuZGlzcG9zZSgpOyB0aGlzLnVuaXRWaXMuZGVsZXRlKGlkKTsgfVxuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHtcbiAgICAgIGxldCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7XG4gICAgICBpZiAoIXYpIHsgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHUuc291bCwgMCwgdS5zdGFyKTsgdGhpcy51bml0VmlzLnNldCh1LmlkLCB2KTsgdGhpcy52aXNUb1VuaXQuc2V0KHYsIHUuaWQpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7IGNvbnN0IHZ2ID0gdjsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcpIHZ2LnBsYXkoJ2lkbGUnKTsgfSk7IH1cbiAgICAgIGVsc2UgeyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IGlmICh2LnN0YXIgIT09IHUuc3RhcikgeyB2LnNldFN0YXIodS5zdGFyKTsgdi5wdWxzZSgpOyB0aGlzLmZ4UmluZyhwLngsIHAueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuNCksIDAuMiwgMS40LCAwLjYpOyB0aGlzLmJ1cnN0KHAueCwgcC56LCBbMSwgMC44NSwgMC40LCAwLjldLCBbMC44LCAwLjQsIDEsIDAuOF0sIDI0KTsgfSB9XG4gICAgfVxuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsO1xuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB7XG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCBjYW5TdW1tb24odGhpcy5zLCBzZWwuaWR4KSA/ICdmcmVlJyA6ICdub3JtYWwnKTtcbiAgICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZUZyb21IYW5kKHRoaXMucywgc2VsLmlkeCwgdS5pZCkpIHRoaXMudGludCh1LmNlbGwsICdwYXJ0bmVyJyk7ICAgICAvLyB0aGUgY2FyZCBjYW4gbWVyZ2UgaW50byB0aGlzIHVuaXRcbiAgICB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7XG4gICAgICBjb25zdCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7XG4gICAgICBpZiAodSkgeyB0aGlzLnRpbnQodS5jZWxsLCAnc2VsJyk7IGZvciAoY29uc3QgbyBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZURlcGxveWVkKHUsIG8pKSB0aGlzLnRpbnQoby5jZWxsLCAncGFydG5lcicpOyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCAnZnJlZScpOyB9XG4gICAgfVxuICB9XG4gIHByaXZhdGUgc3VtbW9uRngoeDogbnVtYmVyLCB6OiBudW1iZXIpIHsgdGhpcy5idXJzdCh4LCB6LCBbMC43LCAwLjMsIDEsIDAuOV0sIFswLjM1LCAwLjEsIDAuNywgMC44XSwgMzApOyB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjMsIDEpLCAwLjIsIDEuMiwgMC43KTsgfVxuXG4gIC8vIC0tLS0gcGxheWVyIGFjdGlvbnMgKGJ1aWxkIHBoYXNlKVxuICB0b2FzdChtc2c6IHN0cmluZykgeyB0aGlzLnVpLnRvYXN0KG1zZyk7IH1cbiAgb25DYXJkKGlkeDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoZGlzY2FyZFJlZHJhdyh0aGlzLnMsIGlkeCkpIHsgdGhpcy50b2FzdCgnU3dhcHBlZDogZHJldyBhIGRpZmZlcmVudCBTb3VsLicpOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnNlbC5pZHggPT09IGlkeCA/IG51bGwgOiB7IHR5cGU6ICdjYXJkJywgaWR4IH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25UaWxlKGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IGhlcmUgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7IGlmIChoZXJlKSB7IHRoaXMub25Vbml0VmlzdWFsKHRoaXMudW5pdFZpcy5nZXQoaGVyZS5pZCkhKTsgcmV0dXJuOyB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnKSB7XG4gICAgICBpZiAoY2FuU3VtbW9uKHMsIHNlbC5pZHgpKSB7IHN1bW1vbihzLCBzZWwuaWR4LCBjZWxsKTsgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgICBlbHNlIHsgY29uc3Qgc291bCA9IHMuaGFuZFtzZWwuaWR4XTsgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbjogJHtTT1VMX05BTUVbc291bF19IGNvc3RzICR7Y29zdChzb3VsLCAxKX0sIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApOyB9XG4gICAgfSBlbHNlIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0JykgeyBpZiAobW92ZVVuaXQocywgc2VsLmlkLCBjZWxsKSkgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25Vbml0VmlzdWFsKHY6IFVuaXRWaXN1YWwpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMudmlzVG9Vbml0LmdldCh2KTsgaWYgKGlkID09PSB1bmRlZmluZWQgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKSE7XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKHN3YXBTZWxsKHMsIGlkKSkgeyB0aGlzLnRvYXN0KGBTb2xkICR7U09VTF9OQU1FW3Uuc291bF19OiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuYCk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QodS5mcmVzaCA/IFwiWW91IGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kLlwiIDogJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgcy5oYW5kW3RoaXMuc2VsLmlkeF0gPT09IHUuc291bCAmJiB1LnN0YXIgPT09IDEgJiYgcy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicpIHtcbiAgICAgIGlmIChtZXJnZUZyb21IYW5kKHMsIHRoaXMuc2VsLmlkeCwgaWQpKSB7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCB0aGUgY2FyZCBpbnRvIGEgMi1zdGFyICR7U09VTF9OQU1FW3Uuc291bF19IWApOyB9XG4gICAgICBlbHNlIHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb24gdG8gbWVyZ2U6IGl0IG5lZWRzICR7Y29zdCh1LnNvdWwsIDIpIC0gY29zdCh1LnNvdWwsIDEpfSBtb3JlLCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkICE9PSBpZCkge1xuICAgICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gKHRoaXMuc2VsIGFzIGFueSkuaWQpITtcbiAgICAgIGlmIChjYW5NZXJnZURlcGxveWVkKGEsIHUpKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgdS5pZCk7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkOiBhLmlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIH0gZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCA9PT0gaWQgPyBudWxsIDogeyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgbWVyZ2VTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7IGNvbnN0IGIgPSBhICYmIHMudW5pdHMuZmluZCgobykgPT4gY2FuTWVyZ2VEZXBsb3llZChhLCBvKSk7XG4gICAgaWYgKGEgJiYgYikgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIGIuaWQpOyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy50b2FzdCgnTm8gbWF0Y2hpbmcgdW5pdCAoc2FtZSBTb3VsIGFuZCBzdGFycykgdG8gbWVyZ2Ugd2l0aC4nKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHJlbW92ZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmNvbmZpcm1SZW1vdmUpIHsgdGhpcy5jb25maXJtUmVtb3ZlID0gdHJ1ZTsgdGhpcy50b2FzdCgnVGFwIFJlbW92ZSBhZ2FpbiB0byBjb25maXJtLiBUaGUgY2FyZCBpcyBnb25lIGZvciB0aGlzIHN0YWdlLicpOyB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47IH1cbiAgICBkaXNtaXNzKHRoaXMucywgc2VsLmlkKTsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICB0b2dnbGVTd2FwKCkgeyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuOyBpZiAodGhpcy5zLmRpc2NhcmRVc2VkKSB7IHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IHJldHVybjsgfSB0aGlzLnN3YXBNb2RlID0gIXRoaXMuc3dhcE1vZGU7IHRoaXMuc2VsID0gbnVsbDsgaWYgKHRoaXMuc3dhcE1vZGUpIHRoaXMudG9hc3QoJ1N3YXA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkLCBvciBhIHVuaXQgKG5vdCBzdW1tb25lZCB0aGlzIHJvdW5kKSB0byBzZWxsLicpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gYmF0dGxlXG4gIHN0YXJ0QmF0dGxlKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICF0aGlzLnMudW5pdHMubGVuZ3RoKSB7IGlmICghdGhpcy5zLnVuaXRzLmxlbmd0aCkgdGhpcy50b2FzdCgnU3VtbW9uIGF0IGxlYXN0IG9uZSB1bml0IGZpcnN0LicpOyByZXR1cm47IH1cbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5hdHRlbXB0Kys7IHRoaXMuaGFuZGxlZCA9IGZhbHNlOyB0aGlzLnJlc3VsdEF0ID0gLTE7XG4gICAgY29uc3QgcyA9IHRoaXMucywgdW5pdHMgPSBzLnVuaXRzLnNsaWNlKCk7XG4gICAgdGhpcy5iYXR0bGUgPSBuZXcgQmF0dGxlKHVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW15V2F2ZShzLndhdmUsIHRoaXMuc2VlZCksIHRoaXMuc2VlZCAqIDEzMSArIHMud2F2ZSAqIDE3ICsgdGhpcy5hdHRlbXB0KTtcbiAgICB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpO1xuICAgIHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmZvckVhY2goKGYpID0+IHtcbiAgICAgIGlmIChmLnRlYW0gPT09IDApIHsgY29uc3QgdSA9IHVuaXRzW2YuaWQgLSAxXTsgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmZVbml0LnNldChmLmlkLCB1LmlkKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBmLnNvdWwsIDEsIGYuc3Rhcik7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChmLngsIDAsIGYueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSAtTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHYuc3RhdGUgPT09ICdzcGF3bicpIHYucGxheSgnaWRsZScpOyB9KTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNywgMC42LCAwLjUsIDAuN10sIFswLjQsIDAuMzUsIDAuMywgMC42XSwgMTQpOyB9XG4gICAgfSk7XG4gICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHRoaXMudGludChjLCAnbm9ybWFsJyk7XG4gICAgdGhpcy5waGFzZSA9ICd0cmFuc2l0aW9uJzsgdGhpcy5zdGFydFN0ZXBBdCA9IDEuMDsgdGhpcy5hY2MgPSAwOyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDIuMik7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcHJpdmF0ZSBhcHBseUV2ZW50cyhldnM6IEJFdmVudFtdKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlITtcbiAgICBmb3IgKGNvbnN0IGUgb2YgZXZzKSB7XG4gICAgICBpZiAoZS50ID09PSAnc3dpbmcnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgdi5wbGF5KCdhdHRhY2snLCBlLnNwZWVkKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnaGl0JykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLnRvKTsgaWYgKHYpIHYucHVsc2UoKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnYXJyb3cnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5mcm9tKSEsIHRvID0gYi5ieUlkKGUudG8pITsgdGhpcy5zcGF3bkFycm93KGYudGVhbSwgZi54LCBmLnosIHRvLngsIHRvLnosIGUuZHVyKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnZGVhdGgnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgeyB2LnBsYXkoJ2RlYXRoJyk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTIpOyBpZiAoZi50ZWFtID09PSAxKSB0aGlzLmxhdGVyKDUsICgpID0+IHsgaWYgKHRoaXMuZnZpcy5nZXQoZS5pZCkgPT09IHYgJiYgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgeyB2LmhvbGRlci5zZXRFbmFibGVkKGZhbHNlKTsgfSB9KTsgfSB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdjYXN0JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgdGhpcy5meFJpbmcoZi54LCBmLnosIG5ldyBCQUJZTE9OLkNvbG9yMygwLjUsIDAuOCwgMSksIDAuMTUsIDEuMSwgMC4zNSk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3RhdW50JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgdGhpcy5meFJpbmcoZi54LCBmLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjMpLCAwLjMsIEJBTEFOQ0UudGF1bnQucmFkaXVzLCAwLjYpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdzbWFzaCcpIHRoaXMuZnhSaW5nKGUueCwgZS56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC41LCAwLjIpLCAwLjIsIGUuciAqIDEuNiwgMC40NSk7XG4gICAgfVxuICB9XG4gIHByaXZhdGUgc3Bhd25BcnJvdyh0ZWFtOiBudW1iZXIsIHgwOiBudW1iZXIsIHowOiBudW1iZXIsIHgxOiBudW1iZXIsIHoxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgbGV0IG1lc2ggPSB0aGlzLmFycm93TWVzaC5wb3AoKTtcbiAgICBpZiAoIW1lc2gpIHsgbWVzaCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2Fycm93JywgeyBoZWlnaHQ6IDAuNTUsIGRpYW1ldGVyOiAwLjAzNSB9LCB0aGlzLnNjZW5lKTsgbWVzaC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IG1lc2guaXNQaWNrYWJsZSA9IGZhbHNlOyBjb25zdCBob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdhcicsIHRoaXMuc2NlbmUpOyBtZXNoLnBhcmVudCA9IGhvbGRlcjsgbWVzaCA9IGhvbGRlcjsgfVxuICAgIG1lc2guc2V0RW5hYmxlZCh0cnVlKTsgbWVzaC5nZXRDaGlsZE1lc2hlcygpWzBdLm1hdGVyaWFsID0gdGhpcy5hcnJvd01hdHNbdGVhbV07XG4gICAgdGhpcy5hcnJvd3MucHVzaCh7IG1lc2gsIHgwLCB6MCwgeDEsIHoxLCB0OiAwLCBkdXIgfSk7XG4gIH1cblxuICBwcml2YXRlIGZyYW1lKGR0OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5jYW52YXMuY2xpZW50V2lkdGggIT09IHRoaXMubGFzdFcgfHwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0ICE9PSB0aGlzLmxhc3RIKSB0aGlzLmhhbmRsZVJlc2l6ZSgpOyAgIC8vIGUuZy4gdGhlIGhvbWUtc2NyZWVuIGFwcCByZXNpemluZyBhZnRlciBsYXVuY2hcbiAgICBmb3IgKGxldCBpID0gdGhpcy50aW1lcnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgdGhpcy50aW1lcnNbaV0udCAtPSBkdDsgaWYgKHRoaXMudGltZXJzW2ldLnQgPD0gMCkgeyBjb25zdCBmID0gdGhpcy50aW1lcnNbaV0uZm47IHRoaXMudGltZXJzLnNwbGljZShpLCAxKTsgZigpOyB9IH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5yaW5nRngubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgciA9IHRoaXMucmluZ0Z4W2ldOyByLnQgKz0gZHQ7IGNvbnN0IHUgPSByLnQgLyByLmR1ciwgcyA9IHIucjAgKyAoci5yMSAtIHIucjApICogdTsgci5tLnNjYWxpbmcuc2V0KHMsIHMsIHMpOyByLm1tLmFscGhhID0gMC45ICogKDEgLSB1KTsgaWYgKHUgPj0gMSkgeyByLm0uZGlzcG9zZSgpOyByLm1tLmRpc3Bvc2UoKTsgdGhpcy5yaW5nRnguc3BsaWNlKGksIDEpOyB9IH1cbiAgICBpZiAodGhpcy5jYW1UIDwgMSkgeyB0aGlzLmNhbVQgPSBNYXRoLm1pbigxLCB0aGlzLmNhbVQgKyBkdCAvIHRoaXMuY2FtRHVyKTsgY29uc3QgZSA9IHRoaXMuY2FtVCAqIHRoaXMuY2FtVCAqICgzIC0gMiAqIHRoaXMuY2FtVCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnBvcywgdGhpcy5jYW1Uby5wb3MsIGUpOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS50Z3QsIHRoaXMuY2FtVG8udGd0LCBlKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgJiYgdGhpcy5jYW1Nb2RlID09PSAnY2xvc2UnKSB0aGlzLmZyYW1lQmF0dGxlKGR0KTtcbiAgICBmb3IgKGNvbnN0IHYgb2YgdGhpcy51bml0VmlzLnZhbHVlcygpKSB2LnVwZGF0ZShkdCk7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LnVwZGF0ZShkdCk7IH0pO1xuXG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlO1xuICAgIGlmICgodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nIHx8IHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSAmJiBiKSB7XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nKSB7IHRoaXMuc3RhcnRTdGVwQXQgLT0gZHQ7IGlmICh0aGlzLnN0YXJ0U3RlcEF0IDw9IDApIHsgdGhpcy5waGFzZSA9ICdiYXR0bGUnOyB0aGlzLnVpLnJlbmRlcigpOyB9IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJykge1xuICAgICAgICB0aGlzLmFjYyArPSBkdCAqIHRoaXMudGltZVNjYWxlO1xuICAgICAgICB3aGlsZSAodGhpcy5hY2MgPj0gMSAvIDMwICYmIGIud2lubmVyIDwgMCkgeyBiLnN0ZXAoMSAvIDMwKTsgdGhpcy5hY2MgLT0gMSAvIDMwOyB0aGlzLmFwcGx5RXZlbnRzKGIuZHJhaW4oKSk7IH1cbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgfHwgZi50ZWFtID09PSAxKSB7IHYuaG9sZGVyLnBvc2l0aW9uLnggPSBmLng7IHYuaG9sZGVyLnBvc2l0aW9uLnogPSBmLno7IGlmIChmLmFsaXZlIHx8IHRydWUpIHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBmLnlhdzsgfVxuICAgICAgICBpZiAoZi5hbGl2ZSkgeyB2LnNldEhwKGYuaHAgLyBmLm1heEhwKTsgaWYgKGYubWF4TWFuYSkgdi5zZXRNYW5hKGYubWFuYSAvIGYubWF4TWFuYSk7IH1cbiAgICAgICAgZWxzZSB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmIChmLnN0YXRlICE9PSAnYXR0YWNrJyAmJiBmLmFsaXZlKSB7IGNvbnN0IHdhbnQgPSBmLnN0YXRlID09PSAncnVuJyA/ICdydW4nIDogJ2lkbGUnOyBpZiAodGhpcy5sYXN0U3RhdGUuZ2V0KGYuaWQpICE9PSB3YW50IHx8ICh2LnN0YXRlICE9PSB3YW50ICYmIHYuc3RhdGUgIT09ICdzcGF3bicpKSB7IGlmICh2LnN0YXRlICE9PSAnc3Bhd24nKSB7IHYucGxheSh3YW50IGFzIGFueSk7IHRoaXMubGFzdFN0YXRlLnNldChmLmlkLCB3YW50KTsgfSB9IH1cbiAgICAgICAgaWYgKGYuc3RhdGUgPT09ICdhdHRhY2snKSB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgJ2F0dGFjaycpO1xuICAgICAgfVxuICAgICAgaWYgKGIud2lubmVyID49IDAgJiYgIXRoaXMuaGFuZGxlZCkgeyB0aGlzLmhhbmRsZWQgPSB0cnVlOyB0aGlzLnJlc3VsdEF0ID0gMS40OyB9XG4gICAgICBpZiAodGhpcy5yZXN1bHRBdCA+IDApIHsgdGhpcy5yZXN1bHRBdCAtPSBkdDsgaWYgKHRoaXMucmVzdWx0QXQgPD0gMCkgdGhpcy5oYW5kbGVSZXN1bHQoKTsgfVxuICAgIH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5hcnJvd3MubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGEgPSB0aGlzLmFycm93c1tpXTsgYS50ICs9IGR0ICogdGhpcy50aW1lU2NhbGU7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCBhLnQgLyBhLmR1cik7XG4gICAgICBjb25zdCBweCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdSwgcHogPSBhLnowICsgKGEuejEgLSBhLnowKSAqIHUsIHB5ID0gMC43NSArIE1hdGguc2luKHUgKiBNYXRoLlBJKSAqIDAuOSAtIHUgKiAwLjI1O1xuICAgICAgY29uc3QgdTIgPSBNYXRoLm1pbigxLCB1ICsgMC4wMyksIHF4ID0gYS54MCArIChhLngxIC0gYS54MCkgKiB1MiwgcXogPSBhLnowICsgKGEuejEgLSBhLnowKSAqIHUyLCBxeSA9IDAuNzUgKyBNYXRoLnNpbih1MiAqIE1hdGguUEkpICogMC45IC0gdTIgKiAwLjI1O1xuICAgICAgYS5tZXNoLnBvc2l0aW9uLnNldChweCwgcHksIHB6KTsgYS5tZXNoLmxvb2tBdChuZXcgQkFCWUxPTi5WZWN0b3IzKHF4LCBxeSwgcXopKTtcbiAgICAgIGlmICh1ID49IDEpIHsgYS5tZXNoLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLmFycm93TWVzaC5wdXNoKGEubWVzaCk7IHRoaXMuYXJyb3dzLnNwbGljZShpLCAxKTsgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlUmVzdWx0KCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIHMgPSB0aGlzLnM7XG4gICAgdGhpcy5sYXN0QmF0dGxlID0gYHdhdmUgJHtzLndhdmV9IGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9OiAke2Iud2lubmVyID09PSAwID8gJ1dPTicgOiAnTE9TVCd9IGluICR7Yi50aW1lLnRvRml4ZWQoMSl9cywgJHtiLmNvdW50KDApfSBvZiB5b3VycyBhbmQgJHtiLmNvdW50KDEpfSBlbmVtaWVzIGxlZnRgO1xuICAgIGlmIChiLndpbm5lciA9PT0gMCkge1xuICAgICAgaWYgKGFkdmFuY2VXYXZlKHMpKSB7IHRoaXMucGhhc2UgPSAnd29uJzsgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuOyB9XG4gICAgICB0aGlzLmRyYWZ0ID0gZHJhZnRPcHRpb25zKHMpOyB0aGlzLnBoYXNlID0gJ2RyYWZ0JzsgdGhpcy51aS5yZW5kZXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmFpbFdhdmUocyk7XG4gICAgICBpZiAocy5zdGF0dXMgPT09ICdsb3N0JykgeyB0aGlzLnBoYXNlID0gJ2xvc3QnOyB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47IH1cbiAgICAgIHRoaXMudG9hc3QoJ1lvdXIgYXJteSBmZWxsLiAtMSBoZWFydCwgKzEgY2FyZCwgc2FtZSB3YXZlLiBSZWJ1aWxkIGEgZGlmZmVyZW50IHN0cmF0ZWd5LicpOyB0aGlzLnRvQnVpbGQoKTtcbiAgICB9XG4gIH1cbiAgcGlja0RyYWZ0KGlkeDogbnVtYmVyKSB7IGlmICghdGhpcy5kcmFmdCkgcmV0dXJuOyB0YWtlRHJhZnQodGhpcy5zLCB0aGlzLmRyYWZ0LCBpZHgpOyB0aGlzLmRyYWZ0ID0gbnVsbDsgbm9ybWFsRHJhdyh0aGlzLnMpOyB0aGlzLnRvQnVpbGQoKTsgfVxuICBwcml2YXRlIHRvQnVpbGQoKSB7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpO1xuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHsgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlc3VycmVjdGlvbjogZXZlcnlvbmUgcmlzZXMgYWdhaW4gYXQgZnVsbCBoZWFsdGhcbiAgICAgIGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgdi5ob2xkZXIuc2V0RW5hYmxlZCh0cnVlKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopO1xuICAgICAgdGhpcy5sYXRlcigxLjEsICgpID0+IHYucGxheSgnaWRsZScpKTtcbiAgICB9XG4gICAgdGhpcy5waGFzZSA9ICdidWlsZCc7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYnVpbGQsIDEuOCk7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgc2V0U3BlZWQoazogbnVtYmVyKSB7IHRoaXMudGltZVNjYWxlID0gazsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIGhlbHBlcnNcbiAgYXBwbHlCYWxhbmNlQ2hhbmdlKCkgeyB0aGlzLnVuaXRWaXMuZm9yRWFjaCgodiwgaWQpID0+IHsgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7IGlmICh1KSB2LnNldFN0YXIodS5zdGFyKTsgfSk7IH1cbiAgdGVzdE9kZHMobiA9IDIwMCkge1xuICAgIGNvbnN0IHNsb3RzID0gdGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW1pZXMgPSBlbmVteVdhdmUodGhpcy5zLndhdmUsIHRoaXMuc2VlZCk7IGxldCB3aW4gPSAwLCB0ID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykgeyBjb25zdCByID0gc2ltdWxhdGUoc2xvdHMsIGVuZW1pZXMsIDUwMDAgKyBpKTsgaWYgKHIud2lubmVyID09PSAwKSB3aW4rKzsgdCArPSByLnRpbWU7IH1cbiAgICByZXR1cm4geyB3aW46IE1hdGgucm91bmQoKHdpbiAvIG4pICogMTAwKSwgYXZnVGltZTogKyh0IC8gbikudG9GaXhlZCgxKSwgbiB9O1xuICB9XG4gIGFkZENhcmQoc291bDogU291bElkKSB7IHRoaXMucy5oYW5kLnB1c2goc291bCk7IHRoaXMucy5zdGF0cy5kcmF3bisrOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIGFkZERvbWluaW9uKG46IG51bWJlcikgeyB0aGlzLnMuY2FwICs9IG47IHRoaXMudWkucmVuZGVyKCk7IH1cbiAgcmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgZW4gPSBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpO1xuICAgIHJldHVybiBbYHNlZWQgJHt0aGlzLnNlZWR9ICB3YXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9ICBoZWFydHMgJHtzLmhlYXJ0c30gIGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSAgcGhhc2UgJHt0aGlzLnBoYXNlfSAgYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH1gLFxuICAgICAgYGhhbmQ6ICR7cy5oYW5kLmpvaW4oJywgJykgfHwgJyhlbXB0eSknfWAsIGBhcm15OiAke3MudW5pdHMubWFwKCh1KSA9PiBgJHt1LnNvdWx9JHt1LnN0YXJ9QCR7dS5jZWxsfWApLmpvaW4oJyAnKSB8fCAnKG5vbmUpJ31gLCBgZW5lbXk6ICR7ZW4ubWFwKChlKSA9PiBlLnNvdWwgKyBlLnN0YXIpLmpvaW4oJyAnKX1gLFxuICAgICAgYGRpZmZpY3VsdHk6ICR7ZGlmZmljdWx0eU5hbWV9ICBtZXJnZS1mcm9tLWhhbmQ6ICR7cy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3Rhcid9ICBzd2FwIHVzZWQ6ICR7cy5kaXNjYXJkVXNlZH1gLCBgbGFzdCB0YXA6ICR7dGhpcy5sYXN0VGFwSW5mb31gLCBgc2NyZWVuOiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gZHByICR7d2luZG93LmRldmljZVBpeGVsUmF0aW99YCwgYGxhc3QgYmF0dGxlOiAke3RoaXMubGFzdEJhdHRsZSB8fCAnLSd9YCwgYGxvZyB0YWlsOmAsIC4uLnMubG9nLnNsaWNlKC04KSwgYGJhbGFuY2U6ICR7SlNPTi5zdHJpbmdpZnkoeyBzdGFyOiBCQUxBTkNFLnN0YXIsIHN0YXRzOiBCQUxBTkNFLnN0YXRzIH0pfWBdLmpvaW4oJ1xcbicpO1xuICB9XG4gIHJlc2V0QmFsYW5jZUFsbCgpIHsgcmVzZXRCYWxhbmNlKCk7IHRoaXMuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7IH1cbiAgZ2V0IGRpZmZpY3VsdHkoKSB7IHJldHVybiBkaWZmaWN1bHR5TmFtZTsgfVxuICBjaGFuZ2VEaWZmaWN1bHR5KG5hbWU6IHN0cmluZykgeyBzZXREaWZmaWN1bHR5KG5hbWUpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnRvYXN0KGBEaWZmaWN1bHR5OiAke25hbWV9LiBBcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZS5gKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGdhbGxlcnkgKHN0YXIgbG9va3MpXG4gIGdhbGxlcnkoKSB7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QuYWRkKCdnYWxsZXJ5Jyk7IGNvbnN0IHZpczogVW5pdFZpc3VhbFtdID0gW107IGxldCB0ZWFtOiAwIHwgMSA9IDA7XG4gICAgY29uc3QgcmVidWlsZCA9ICgpID0+IHsgdmlzLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdmlzLmxlbmd0aCA9IDA7IFNPVUxTLmZvckVhY2goKHNvdWwsIGkpID0+IFsxLCAyLCAzXS5mb3JFYWNoKChzdCwgaikgPT4geyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgc291bCwgdGVhbSwgc3QpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoKGkgLSAyLjUpICogMi41LCAwLCAoaiAtIDEpICogLTIuNCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJICogMC44NTsgdi5wbGF5KCdpZGxlJyk7IHZpcy5wdXNoKHYpOyB9KSk7IH07XG4gICAgcmVidWlsZCgpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5zZXQoMCwgNS42LCAtMTQuNSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgLTAuNCkpOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg1O1xuICAgICh3aW5kb3cgYXMgYW55KS5fX2dhbGxlcnkgPSB7IHNldFRlYW06ICh0OiAwIHwgMSkgPT4geyB0ZWFtID0gdDsgcmVidWlsZCgpOyB9LCB2aXMgfTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpOyB0aGlzLmVuZ2luZS5ydW5SZW5kZXJMb29wKCgpID0+IHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpLCBkdCA9IE1hdGgubWluKDAuMDUsIChuIC0gbGFzdCkgLyAxMDAwKTsgbGFzdCA9IG47IHZpcy5mb3JFYWNoKCh2KSA9PiB2LnVwZGF0ZShkdCkpOyB0aGlzLnNjZW5lLnJlbmRlcigpOyB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEdhbWUgfSBmcm9tICcuL2dhbWUudHMnO1xuXG5jb25zdCBnID0gbmV3IEdhbWUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2dhbWUgPSBnOyAgICAgICAgICAgICAgICAgICAgICAgLy8gaGFuZHkgZm9yIGRlYnVnZ2luZyBmcm9tIHRoZSBicm93c2VyIGNvbnNvbGVcbmcuaW5pdChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYycpIGFzIEhUTUxDYW52YXNFbGVtZW50KVxuICAudGhlbigoKSA9PiB7IGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnOyB9KVxuICAuY2F0Y2goKGUpID0+IHtcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIHsgbC5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnOyBsLnRleHRDb250ZW50ID0gJ0Vycm9yOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogZSk7IH1cbiAgICBjb25zb2xlLmVycm9yKGUpO1xuICB9KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7OztBQWtDTyxNQUFNLFdBQW9CO0FBQUEsSUFDL0IsT0FBTztBQUFBLE1BQ0wsU0FBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxHQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxLQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFFBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEtBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsTUFDOUcsUUFBVyxFQUFFLElBQUksS0FBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sS0FBTSxPQUFPLEdBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLElBQUk7QUFBQSxNQUM5RyxNQUFXLEVBQUUsSUFBSSxLQUFLLEtBQUssSUFBSSxVQUFVLEtBQUssT0FBTyxNQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxLQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFdBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsTUFBTSxPQUFPLEtBQUssT0FBTyxLQUFLLE1BQU0sS0FBTSxTQUFTLEdBQUssU0FB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TSxRQUFRLFFBQVEsS0FBSztBQUMxUSxNQUFDLEtBQWEsUUFBUSxDQUFDLEVBQUU7QUFBRyxXQUFLLFFBQVEsSUFBSTtBQUFHLFdBQUssUUFBUSxJQUFJO0FBQUcsV0FBSyxLQUFLLE1BQU07QUFBQSxJQUN0RjtBQUFBLElBQ0EsUUFBUSxHQUFVO0FBQUUsV0FBSyxPQUFPO0FBQUcsTUFBQyxLQUFhLEtBQUssZ0JBQWdCLE1BQU0sSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sQ0FBQyxJQUFJLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxJQUFJO0FBQUcsV0FBSyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFDcEwsUUFBUSxJQUFZO0FBQUUsV0FBSyxPQUFPO0FBQUksV0FBSyxPQUFPLFFBQVEsS0FBSyxNQUFNLEtBQUssQ0FBQztBQUFHLFlBQU0sSUFBSSxLQUFLLEtBQUssQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLGVBQWUsUUFBUSxPQUFPLGNBQWMsR0FBRyxLQUFLLElBQUksRUFBRSxHQUFHLEVBQUUsTUFBTSxJQUFJLEVBQUUsU0FBUyxJQUFJLFFBQVEsT0FBTyxLQUFLLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQUcsV0FBSyxPQUFPLFFBQVEsT0FBTyxLQUFLLElBQUk7QUFBRyxXQUFLLEtBQUssSUFBSSxLQUFLLE1BQU0sRUFBRTtBQUFBLElBQUc7QUFBQSxJQUNoVyxNQUFNLEdBQWtCO0FBQUUsV0FBSyxLQUFLLE1BQU0sQ0FBQztBQUFBLElBQUc7QUFBQSxJQUM5QyxRQUFRLEdBQWtCO0FBQUUsV0FBSyxLQUFLLFFBQVEsQ0FBQztBQUFBLElBQUc7QUFBQSxJQUNsRCxRQUFRO0FBQUUsV0FBSyxTQUFTO0FBQUEsSUFBTTtBQUFBLElBQzlCLEtBQUssT0FBZSxRQUFRLEdBQUc7QUFBRSxVQUFJLFVB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
