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
    level: { hp: 0.08, dmg: 0.08, copiesToLevel: [5, 10, 20, 40, 80, 120, 200, 300, 500], goldToLevel: [6e3, 12e3, 24e3, 48e3, 96e3, 168e3, 27e4, 42e4, 66e4] },
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

  // game/arena.ts
  var TILE_METRES = 5;
  function runeTexture(scene) {
    const S = 512, tex = new BABYLON.DynamicTexture("runes", { width: S, height: S }, scene, true), c = tex.getContext();
    c.clearRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.lineCap = "round";
    c.lineJoin = "round";
    const ring = (r, w, a) => {
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.lineWidth = w;
      c.strokeStyle = `rgba(47,217,166,${a})`;
      c.stroke();
    };
    c.shadowColor = "rgba(47,217,166,0.9)";
    c.shadowBlur = 10;
    ring(236, 4, 0.75);
    ring(214, 2, 0.5);
    ring(120, 3, 0.7);
    c.strokeStyle = "rgba(47,217,166,0.7)";
    c.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      c.save();
      c.rotate(i * Math.PI / 2 + Math.PI / 4);
      c.beginPath();
      c.moveTo(0, -30);
      c.lineTo(0, -230);
      c.stroke();
      c.beginPath();
      c.moveTo(-14, -120);
      c.lineTo(0, -160);
      c.lineTo(14, -120);
      c.stroke();
      c.restore();
    }
    c.lineWidth = 2;
    c.strokeStyle = "rgba(47,217,166,0.55)";
    for (let i = 0; i < 12; i++) {
      c.save();
      c.rotate(i * Math.PI / 6);
      c.beginPath();
      c.moveTo(0, -214);
      c.lineTo(0, -236);
      c.stroke();
      c.restore();
    }
    tex.update();
    tex.hasAlpha = true;
    return tex;
  }
  var CRYPT_LAYOUT = [
    { prop: "arch", x: -6.5, z: 6.4 },
    { prop: "arch", x: 0, z: 6.9, s: 1.15 },
    { prop: "arch", x: 6.5, z: 6.4 },
    { prop: "pillar", x: -10.2, z: 5.6, yaw: 0.4 },
    { prop: "pillar", x: -3.2, z: 5.9, yaw: 2.1 },
    { prop: "pillar", x: 3.3, z: 5.8, yaw: 4 },
    { prop: "pillar", x: 10.2, z: 5.6, yaw: 1.2 },
    { prop: "brazier", x: -4.6, z: 5.2 },
    { prop: "brazier", x: 4.6, z: 5.2 },
    { prop: "brazier", x: -10.5, z: 0.8 },
    { prop: "brazier", x: 10.5, z: 0.8 },
    { prop: "wall", x: -8.6, z: 6, yaw: 0.1 },
    { prop: "wall", x: 8.6, z: 6, yaw: -0.1 },
    { prop: "wall", x: -11.4, z: -2.6, yaw: 1.4 },
    { prop: "wall", x: 11.4, z: -2.6, yaw: 1.7 },
    { prop: "fence", x: -8, z: -4.6 },
    { prop: "fence", x: -6.7, z: -4.7 },
    { prop: "fence", x: 6.7, z: -4.7 },
    { prop: "fence", x: 8, z: -4.6 },
    { prop: "bones", x: -3.5, z: -4.4, yaw: 0.7, s: 0.5 },
    { prop: "bones", x: 4.2, z: -4.6, yaw: 2.5, s: 0.5 },
    { prop: "bones", x: 9.4, z: 3.2, yaw: 1, s: 0.6 },
    { prop: "bones", x: -9.6, z: -3.4, yaw: 3.6, s: 0.6 }
  ];
  var GRAVEYARD_LAYOUT = [
    // fewer arches, a broken row of gravestone pillars, bones everywhere
    { prop: "arch", x: -9.5, z: 6.4 },
    { prop: "arch", x: 9.5, z: 6.4 },
    { prop: "pillar", x: -11, z: 5.2, yaw: 0.4, s: 0.9 },
    { prop: "pillar", x: -7.6, z: 6.3, yaw: 2.1 },
    { prop: "pillar", x: -4.4, z: 5.6, yaw: 4, s: 0.8 },
    { prop: "pillar", x: -1.2, z: 6.5, yaw: 1.2 },
    { prop: "pillar", x: 2.2, z: 5.7, yaw: 3.1, s: 0.9 },
    { prop: "pillar", x: 5.5, z: 6.4, yaw: 5 },
    { prop: "pillar", x: 8.2, z: 5.5, yaw: 0.9, s: 0.85 },
    { prop: "pillar", x: 11, z: 5, yaw: 2.6 },
    { prop: "brazier", x: -11, z: 0.8 },
    { prop: "brazier", x: 11, z: 0.8 },
    { prop: "brazier", x: 0.6, z: 5, s: 0.9 },
    { prop: "wall", x: -5.6, z: 6.6, yaw: 0.2 },
    { prop: "wall", x: 3.8, z: 6.7, yaw: -0.2 },
    { prop: "wall", x: -11.6, z: -2.4, yaw: 1.5 },
    { prop: "fence", x: -4.2, z: -4.7 },
    { prop: "fence", x: 4.4, z: -4.7 },
    { prop: "fence", x: 11.2, z: -2.2, yaw: 1.6 },
    { prop: "bones", x: -5.5, z: 4.6, yaw: 0.7, s: 0.6 },
    { prop: "bones", x: 3.2, z: 4.4, yaw: 2.5, s: 0.7 },
    { prop: "bones", x: 8.2, z: 3.2, yaw: 1, s: 0.6 },
    { prop: "bones", x: -9.2, z: 3.4, yaw: 3.6, s: 0.6 },
    { prop: "bones", x: 7, z: -4.5, yaw: 0.3, s: 0.5 },
    { prop: "bones", x: -7.4, z: -4.3, yaw: 4.1, s: 0.5 },
    { prop: "bones", x: 0.2, z: -4.8, yaw: 5.2, s: 0.5 },
    { prop: "bones", x: 10.2, z: -0.6, yaw: 2, s: 0.6 }
  ];
  var BASTION_LAYOUT = [
    // a fortress: gates between long walls, braziers along the battlements, fences on the flanks
    { prop: "arch", x: -5.8, z: 6.5, s: 1.1 },
    { prop: "arch", x: 0, z: 7, s: 1.3 },
    { prop: "arch", x: 5.8, z: 6.5, s: 1.1 },
    { prop: "wall", x: -9.4, z: 6, s: 1.3 },
    { prop: "wall", x: -2.9, z: 6.4, s: 1.2 },
    { prop: "wall", x: 2.9, z: 6.4, s: 1.2 },
    { prop: "wall", x: 9.4, z: 6, s: 1.3 },
    { prop: "wall", x: -12.2, z: 2.6, yaw: 1.57, s: 1.3 },
    { prop: "wall", x: 12.2, z: 2.6, yaw: 1.57, s: 1.3 },
    { prop: "wall", x: -12.2, z: -1.6, yaw: 1.57 },
    { prop: "wall", x: 12.2, z: -1.6, yaw: 1.57 },
    { prop: "pillar", x: -11.2, z: 5.6, yaw: 0.4, s: 1.1 },
    { prop: "pillar", x: 11.2, z: 5.6, yaw: 1.2, s: 1.1 },
    { prop: "brazier", x: -3.2, z: 5.2 },
    { prop: "brazier", x: 3.2, z: 5.2 },
    { prop: "brazier", x: -10.6, z: 1 },
    { prop: "brazier", x: 10.6, z: 1 },
    { prop: "brazier", x: -7.2, z: -4.6, s: 0.9 },
    { prop: "brazier", x: 7.2, z: -4.6, s: 0.9 },
    { prop: "fence", x: -4.6, z: -4.8 },
    { prop: "fence", x: -3.3, z: -4.8 },
    { prop: "fence", x: 3.3, z: -4.8 },
    { prop: "fence", x: 4.6, z: -4.8 },
    { prop: "fence", x: -11.6, z: -3.4, yaw: 1.5 },
    { prop: "fence", x: 11.6, z: -3.4, yaw: 1.5 },
    { prop: "bones", x: -1.5, z: -4.5, yaw: 0.7, s: 0.5 },
    { prop: "bones", x: 9.4, z: 3.2, yaw: 1, s: 0.5 },
    { prop: "bones", x: -9.6, z: -3, yaw: 3.6, s: 0.5 }
  ];
  var THEMES = {
    crypt: { layout: CRYPT_LAYOUT, floor: [0.62, 0.7, 0.7], fog: [0.02, 0.05, 0.06], mist: [0.2, 0.6, 0.55], wall: [0.75, 0.85, 0.9], flameA: [0.35, 1, 0.8], flameB: [0.1, 0.8, 0.6], rune: [0.18, 0.85, 0.65] },
    graveyard: { layout: GRAVEYARD_LAYOUT, floor: [0.62, 0.74, 0.52], fog: [0.03, 0.05, 0.025], mist: [0.42, 0.6, 0.22], wall: [0.7, 0.85, 0.62], flameA: [0.75, 1, 0.4], flameB: [0.4, 0.8, 0.2], rune: [0.5, 0.8, 0.25] },
    endless: { layout: CRYPT_LAYOUT, floor: [0.78, 0.62, 0.68], fog: [0.06, 0.02, 0.035], mist: [0.75, 0.3, 0.4], wall: [0.92, 0.68, 0.78], flameA: [1, 0.62, 0.3], flameB: [0.9, 0.25, 0.15], rune: [0.9, 0.35, 0.3] },
    bastion: { layout: BASTION_LAYOUT, floor: [0.6, 0.62, 0.9], fog: [0.03, 0.03, 0.08], mist: [0.4, 0.4, 0.85], wall: [0.72, 0.72, 1], flameA: [0.6, 0.65, 1], flameB: [0.4, 0.3, 0.95], rune: [0.45, 0.4, 0.95] }
  };
  function flame(scene, tex, x, y, z, k, a, b) {
    const ps = new BABYLON.ParticleSystem("fire", 18, scene);
    ps.particleTexture = tex;
    ps.emitter = new BABYLON.Vector3(x, y, z);
    ps.minEmitBox = new BABYLON.Vector3(-0.22 * k, 0, -0.22 * k);
    ps.maxEmitBox = new BABYLON.Vector3(0.22 * k, 0, 0.22 * k);
    ps.direction1 = new BABYLON.Vector3(-0.1, 1, -0.1);
    ps.direction2 = new BABYLON.Vector3(0.1, 1.4, 0.1);
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1;
    ps.emitRate = 20;
    ps.minSize = 0.35 * k;
    ps.maxSize = 0.7 * k;
    ps.minEmitPower = 0.5 * k;
    ps.maxEmitPower = 1 * k;
    ps.color1 = new BABYLON.Color4(a[0], a[1], a[2], 0.9);
    ps.color2 = new BABYLON.Color4(b[0], b[1], b[2], 0.8);
    ps.colorDead = new BABYLON.Color4(b[0] * 0.1, b[1] * 0.3, b[2] * 0.3, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new BABYLON.Vector3(0, 0.4, 0);
    ps.start();
    return ps;
  }
  function glowTexture(scene) {
    const t = new BABYLON.DynamicTexture("glow", { width: 64, height: 64 }, scene, true), c = t.getContext(), g2 = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g2.addColorStop(0, "rgba(255,255,255,1)");
    g2.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g2.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g2;
    c.fillRect(0, 0, 64, 64);
    t.update();
    t.hasAlpha = true;
    return t;
  }
  async function loadKit(scene) {
    const box = await BABYLON.SceneLoader.LoadAssetContainerAsync("assets/arena/", "props.glb", scene);
    box.addAllToScene();
    const root = box.meshes.find((m) => m.name === "__root__"), src = {};
    for (const m of box.meshes) if (m.name !== "__root__" && m.getTotalVertices() > 0) {
      src[m.name] = m;
      m.setEnabled(false);
      m.isPickable = false;
    }
    const glow = glowTexture(scene);
    let made = { holders: [], fires: [] }, n = 0;
    return {
      apply(t) {
        var _a, _b, _c, _d, _e, _f;
        for (const h of made.holders) h.dispose();
        for (const f of made.fires) f.dispose(false);
        for (const p of t.layout) {
          const base = src[p.prop];
          if (!base) continue;
          const inst = base.createInstance(p.prop + n++);
          inst.isPickable = false;
          inst.rotationQuaternion = (_b = (_a = root.rotationQuaternion) == null ? void 0 : _a.clone()) != null ? _b : null;
          if (!inst.rotationQuaternion) inst.rotation = root.rotation.clone();
          inst.scaling = root.scaling.clone();
          const holder = new BABYLON.TransformNode("holder" + n, scene);
          holder.position.set(p.x, 0, p.z);
          holder.rotation.y = (_c = p.yaw) != null ? _c : 0;
          holder.scaling.setAll((_d = p.s) != null ? _d : 1);
          inst.parent = holder;
          made.holders.push(holder);
          if (p.prop === "brazier") made.fires.push(flame(scene, glow, p.x, 1.25 * ((_e = p.s) != null ? _e : 1), p.z, (_f = p.s) != null ? _f : 1, t.flameA, t.flameB));
        }
      }
    };
  }
  function buildArena(scene, ground) {
    const tex = new BABYLON.Texture("assets/arena/floor.webp", scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    tex.uScale = 60 / TILE_METRES;
    tex.vScale = 40 / TILE_METRES;
    tex.anisotropicFilteringLevel = 4;
    const gm = new BABYLON.StandardMaterial("gm", scene);
    gm.diffuseTexture = tex;
    gm.specularColor = BABYLON.Color3.Black();
    gm.diffuseColor = new BABYLON.Color3(0.62, 0.7, 0.7);
    ground.material = gm;
    const decal = BABYLON.MeshBuilder.CreateGround("runes", { width: 5.2, height: 5.2 }, scene);
    decal.position.y = 0.012;
    decal.isPickable = false;
    const rm = new BABYLON.StandardMaterial("rm", scene);
    rm.diffuseTexture = runeTexture(scene);
    rm.diffuseTexture.hasAlpha = true;
    rm.useAlphaFromDiffuseTexture = true;
    rm.emissiveColor = new BABYLON.Color3(0.18, 0.85, 0.65);
    rm.disableLighting = true;
    rm.alpha = 0.55;
    rm.backFaceCulling = false;
    decal.material = rm;
    scene.clearColor = new BABYLON.Color4(0.02, 0.05, 0.06, 1);
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = new BABYLON.Color3(0.02, 0.05, 0.06);
    scene.fogStart = 24;
    scene.fogEnd = 56;
    const cave = buildCave(scene, tex);
    let kit = null, want = "crypt", shown = "";
    const show = () => {
      var _a;
      const t = (_a = THEMES[want]) != null ? _a : THEMES.crypt;
      if (want === shown && kit) return;
      const col = (c) => new BABYLON.Color3(c[0], c[1], c[2]);
      gm.diffuseColor = col(t.floor);
      cave.wallMat.diffuseColor = col(t.wall);
      rm.emissiveColor = col(t.rune);
      for (const m of cave.mistMats) m.emissiveColor = col(t.mist);
      scene.fogColor = col(t.fog);
      scene.clearColor = new BABYLON.Color4(t.fog[0], t.fog[1], t.fog[2], 1);
      if (kit) {
        kit.apply(t);
        shown = want;
      }
    };
    loadKit(scene).then((k) => {
      kit = k;
      shown = "";
      show();
    }).catch((e) => console.warn("arena props failed", e));
    return { update: (t) => {
      rm.alpha = 0.45 + 0.15 * Math.sin(t * 1.4);
      cave.update(t);
    }, setTheme: (stage) => {
      want = stage;
      show();
    } };
  }
  var RX = 20;
  var RZ = 15;
  var CZ = -4;
  var WALL_H = 16;
  var wobble = (a, y) => Math.sin(3 * a + 1.3) * 0.5 + Math.sin(7 * a + y * 0.5) * 0.3 + Math.sin(13 * a - y * 0.35) * 0.2 + Math.sin(23 * a + y) * 0.08;
  function mistTexture(scene, seed) {
    const S = 256, t = new BABYLON.DynamicTexture("mist" + seed, { width: S, height: S }, scene, true), c = t.getContext();
    c.clearRect(0, 0, S, S);
    let r = seed * 9301 + 49297;
    const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 46; i++) {
      const x = rnd() * S, y = rnd() * S, rad = 26 + rnd() * 46;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const g2 = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        g2.addColorStop(0, "rgba(255,255,255,0.5)");
        g2.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g2;
        c.fillRect(0, 0, S, S);
      }
    }
    t.update();
    t.hasAlpha = true;
    t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return t;
  }
  function buildCave(scene, floorTex) {
    const N = 120, M = 12, pos = [], uv = [], col = [], idx = [];
    for (let j = 0; j <= M; j++) for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2, h = j / M * WALL_H, k = 1 + 0.06 * wobble(a, h) + (j === 0 ? 0 : 0.05 * Math.sin(a * 5 + j));
      const overhang = 1 - 0.1 * Math.sin(j / M * Math.PI);
      pos.push(Math.cos(a) * RX * k * overhang, h, CZ + Math.sin(a) * RZ * k * overhang);
      uv.push(i / N * 14, j / M * 3.2);
      const b = Math.max(0.06, 1 - j / M * 0.9);
      col.push(b * 0.8, b, b, 1);
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const wall = new BABYLON.Mesh("cave", scene), vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.uvs = uv;
    vd.colors = col;
    const nrm = [];
    BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
    vd.normals = nrm;
    vd.applyToMesh(wall);
    const wm = new BABYLON.StandardMaterial("cavem", scene);
    wm.diffuseTexture = floorTex.clone();
    wm.diffuseTexture.uScale = 1;
    wm.diffuseTexture.vScale = 1;
    wm.specularColor = BABYLON.Color3.Black();
    wm.backFaceCulling = false;
    wm.diffuseColor = new BABYLON.Color3(0.75, 0.85, 0.9);
    wall.material = wm;
    wall.isPickable = false;
    wall.useVertexColors = true;
    wm.useVertexColor = true;
    const spire = BABYLON.MeshBuilder.CreateCylinder("spire", { diameterTop: 0, diameterBottom: 1.6, height: 1, tessellation: 5 }, scene);
    const sm = new BABYLON.StandardMaterial("spirem", scene);
    sm.diffuseColor = new BABYLON.Color3(0.03, 0.045, 0.055);
    sm.specularColor = BABYLON.Color3.Black();
    sm.emissiveColor = new BABYLON.Color3(4e-3, 0.012, 0.014);
    spire.material = sm;
    spire.convertToFlatShadedMesh();
    spire.setEnabled(false);
    spire.isPickable = false;
    let r = 12345;
    const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 46; i++) {
      const a = i / 46 * Math.PI * 2 + (rnd() - 0.5) * 0.12, d = 0.86 + rnd() * 0.1, hgt = 1.4 + rnd() * 3.2, w = 0.7 + rnd() * 1;
      const s = spire.createInstance("sp" + i);
      s.isPickable = false;
      s.position.set(Math.cos(a) * RX * d, hgt / 2 - 0.2, CZ + Math.sin(a) * RZ * d);
      s.scaling.set(w, hgt, w);
      s.rotation.y = rnd() * 6;
      s.rotation.z = (rnd() - 0.5) * 0.18;
    }
    const layers = [0.28, 0.75].map((y, n) => {
      const p = BABYLON.MeshBuilder.CreateGround("mist" + n, { width: 60, height: 44 }, scene);
      p.position.y = y;
      p.isPickable = false;
      const m = new BABYLON.StandardMaterial("mistm" + n, scene), t = mistTexture(scene, n + 3);
      t.uScale = 5 - n;
      t.vScale = 3.4 - n * 0.6;
      m.diffuseTexture = t;
      m.useAlphaFromDiffuseTexture = true;
      m.emissiveColor = new BABYLON.Color3(0.2, 0.6, 0.55);
      m.disableLighting = true;
      m.alpha = 0.15 - n * 0.06;
      m.backFaceCulling = false;
      m.disableDepthWrite = true;
      p.material = m;
      p.alphaIndex = 5 + n;
      return { t, n, m };
    });
    const vt = new BABYLON.DynamicTexture("vig", { width: 256, height: 256 }, scene, true), vc = vt.getContext(), g2 = vc.createRadialGradient(128, 128, 0, 128, 128, 128);
    g2.addColorStop(0, "rgba(0,0,0,0)");
    g2.addColorStop(0.42, "rgba(0,0,0,0)");
    g2.addColorStop(0.8, "rgba(0,4,6,0.7)");
    g2.addColorStop(1, "rgba(0,4,6,0.95)");
    vc.fillStyle = g2;
    vc.fillRect(0, 0, 256, 256);
    vt.update();
    vt.hasAlpha = true;
    const vig = BABYLON.MeshBuilder.CreateGround("vig", { width: 46, height: 30 }, scene);
    vig.position.y = 0.03;
    vig.isPickable = false;
    const vm = new BABYLON.StandardMaterial("vigm", scene);
    vm.diffuseTexture = vt;
    vm.useAlphaFromDiffuseTexture = true;
    vm.disableLighting = true;
    vm.emissiveColor = new BABYLON.Color3(0, 0.01, 0.015);
    vm.disableDepthWrite = true;
    vig.material = vm;
    vig.alphaIndex = 1;
    return { wallMat: wm, mistMats: layers.map((l) => l.m), update: (t) => {
      for (const l of layers) {
        l.t.uOffset = t * (6e-3 + l.n * 4e-3);
        l.t.vOffset = t * 3e-3 * (l.n ? -1 : 1);
      }
    } };
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
        let mx = dx / Math.max(dist, 1e-4), mz = dz / Math.max(dist, 1e-4);
        let sx = 0, sz = 0;
        for (const o of this.fighters) {
          if (o === f || !o.alive || o.id === tg.id) continue;
          const ox = o.x - f.x, oz = o.z - f.z, along = ox * mx + oz * mz, reach = f.radius + o.radius + 0.35;
          if (along <= 0 || along > reach + 0.9) continue;
          const lat = ox * -mz + oz * mx, need = f.radius + o.radius + 0.12;
          if (Math.abs(lat) >= need) continue;
          const side = lat === 0 ? f.id % 2 ? 1 : -1 : lat > 0 ? -1 : 1, w = (1 - Math.abs(lat) / need) * (1 - Math.max(0, along - reach) / 0.9);
          sx += -mz * side * w * 1.6;
          sz += mx * side * w * 1.6;
        }
        if (sx || sz) {
          mx += sx;
          mz += sz;
          const l = Math.hypot(mx, mz) || 1;
          mx /= l;
          mz /= l;
        }
        f.x += mx * f.speed * dt;
        f.z += mz * f.speed * dt;
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
    /**
     * Keep fighters from stacking without shoving anyone across the map.
     * - A fighter that is standing and fighting is "planted": it barely moves; the ones still WALKING yield to it.
     * - Heavier units (Ogre, Knight) push lighter ones more than the other way round.
     * - The total push on one fighter is capped per second, so a crowd can never slide a unit far.
     */
    separate(f, dt) {
      const planted = (u) => u.state === "attack" || u.state === "idle", mass = (u) => u.radius * u.radius;
      let px = 0, pz = 0;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        const dx = f.x - o.x, dz = f.z - o.z, m = Math.hypot(dx, dz), want = (f.radius + o.radius) * 1.05 + 0.08;
        if (m >= want) continue;
        let share = mass(o) / (mass(f) + mass(o));
        const pf = planted(f), po = planted(o);
        if (pf && !po) share *= 0.12;
        else if (!pf && po) share = Math.min(1, share * 1.5 + 0.35);
        else if (pf && po) share *= 0.35;
        const k = (want - m) / Math.max(m, 1e-3) * share * 2;
        px += (m < 1e-3 ? this.rng.next() - 0.5 : dx) * k;
        pz += (m < 1e-3 ? this.rng.next() - 0.5 : dz) * k;
      }
      const s = Math.min(1, dt * 6);
      let mx = px * s, mz = pz * s;
      const cap = (planted(f) ? 0.5 : 1.6) * dt, len = Math.hypot(mx, mz);
      if (len > cap) {
        mx *= cap / len;
        mz *= cap / len;
      }
      f.x += mx;
      f.z += mz;
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
      if (f.soul === "goblin" && cur && cur.alive && Math.hypot(cur.x - f.x, cur.z - f.z) <= f.range * 1.3) return;
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
        if (f.soul === "goblin" && o.id === f.target) score -= 1.5;
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

  // core/endless.ts
  var ENDLESS_ID = "endless";
  var ENDLESS_PACK_EVERY = 10;
  var MAX_UNITS = 12;
  var TUNE = { start: 5, slope: 3, lateSlope: 0.8, maxBudget: 150, powerSlope: 0.012, champion: 1 };
  function endlessBudget(n) {
    const w = Math.max(1, n), early = TUNE.start + TUNE.slope * (Math.min(w, 10) - 1);
    return Math.round(Math.min(TUNE.maxBudget, early + (w > 10 ? TUNE.lateSlope * (w - 10) : 0)));
  }
  function endlessPower(n) {
    const w = Math.max(1, n), base = w <= 10 ? 1 : 1 + TUNE.powerSlope * (w - 10);
    return +(w % 10 === 0 ? base * TUNE.champion : base).toFixed(3);
  }
  var endlessPackTier = (n) => n >= 30 ? 3 : n >= 20 ? 2 : 1;
  var ROLE = { tank: ["knight", "ogre"], brute: ["barbarian", "ogre"], ranged: ["archer"], fodder: ["warrior", "goblin"] };
  var TEMPLATES = [
    { id: "wall", mix: [["tank", 3], ["ranged", 2], ["fodder", 1]] },
    { id: "swarm", mix: [["fodder", 5], ["ranged", 1], ["tank", 1]] },
    { id: "brutes", mix: [["brute", 4], ["fodder", 1], ["ranged", 1]] },
    { id: "mixed", mix: [["tank", 1], ["brute", 1], ["ranged", 1], ["fodder", 2]] }
  ];
  var WARMUP = { id: "warmup", mix: [["fodder", 3], ["ranged", 1]] };
  function endlessTemplate(n, seed) {
    if (n <= 2) return WARMUP;
    return TEMPLATES[Math.floor(makeRng(seed * 4099 + n * 31 + 5).next() * TEMPLATES.length)];
  }
  function endlessWave(n, seed = 0) {
    const wave = Math.max(1, Math.floor(n)), rng = makeRng(seed * 1009 + wave * 7919 + 17), tpl = endlessTemplate(wave, seed);
    let left = endlessBudget(wave);
    const army = [];
    if (wave % 10 === 0 && left >= 20) {
      const soul = rng.next() < 0.5 ? "ogre" : "knight", star = wave >= 40 ? 3 : 2;
      army.push({ soul, star });
      left -= COST[soul][star - 1];
    }
    const total = tpl.mix.reduce((a, [, w]) => a + w, 0);
    for (let guard = 0; guard < 80 && army.length < MAX_UNITS && left >= 2; guard++) {
      let r = rng.next() * total, role = tpl.mix[0][0];
      for (const [ro, w] of tpl.mix) {
        r -= w;
        if (r <= 0) {
          role = ro;
          break;
        }
      }
      let options = ROLE[role].filter((s) => COST[s][0] <= left);
      if (!options.length) options = ROLE.fodder.filter((s) => COST[s][0] <= left);
      if (!options.length) break;
      const soul = rng.pick(options), per = left / Math.max(1, MAX_UNITS - army.length);
      let star = 1;
      for (let s = 3; s >= 2; s--) if (COST[soul][s - 1] <= left && COST[soul][s - 1] <= Math.max(COST[soul][0], per * 1.2)) {
        star = s;
        break;
      }
      army.push({ soul, star });
      left -= COST[soul][star - 1];
    }
    return army;
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
  var GRAVEYARD = {
    easy: ["W1 A1", "K1 G1 W1", "O1 W1 W1 W1 G1", "O1 G2 G1 A1", "O1 W1 W1 W1 A1 A1", "K1 W1 W1 W1 A1 A1 A1", "O1 W1 W1 W1 W1 W1 A1", "O1 W1 W1 W1 W1 G1 G1 G1", "K1 W1 W1 W1 W1 W1 G2 G1 A1", "K1 W1 W1 W1 W1 G1 G1 G1 G1 A1"],
    normal: ["W1 A1", "K1 G1 W1 A1 W1", "K1 W1 W1 W1 G1 A1", "O1 W1 W1 G1 G1 G1 G1", "O1 W2 W1 W1 W1 W1 W1 G1 A1", "K1 W1 W1 W1 W1 W1 G1 G1 G1 A1 A1", "K1 W1 W1 W1 G1 A1 A1 A1", "O1 W1 W1 G1 G1 A1 A1 A1 A1", "K2 W1 W1 W1 W1 W1 W1 G1 G1 G1 A1 A1", "O1 W2 W1 W1 W1 W1 W1 G1 G1 A1 A1 A1"],
    hard: ["W1 A1 G1", "K1 G1 W1 A1 W1", "O1 W1 W1 W1 W1 G2 A1", "O1 W1 W1 G1 G1 A1 A1", "O1 W1 W1 W1 W1 W1 G1 G1 A1 A1 A1", "K1 W3 W2 W2 W2 W1 W1 W1 W1 A1 A1 A1", "O1 W3 W2 W2 W2 W2 W1 W1 W1 G3 G2 A1", "O2 W2 W2 W1 W1 W1 G2 G1 G1 G1 A2 A1", "K3 W3 W3 W3 W2 W2 W1 W1 G2 G1 G1 A3", "K3 W3 W3 W2 W2 W1 G3 G2 G2 G1 A2 A1"],
    nightmare: ["W1 A1 G1", "K1 G1 W1 A1 W1", "O1 W1 W1 W1 G1 G1 A1", "O1 W1 W1 W1 W1 G1 G1 A1", "K1 W1 W1 W1 W1 W1 W1 W1 W1 A2 A1 A1", "O1 W3 W2 W1 W1 W1 W1 W1 G2 G1 G1 A1", "O1 W2 W1 W1 W1 G2 G1 G1 G1 A2 A1 A1", "O2 W2 W1 W1 W1 W1 G2 G1 G1 A2 A1 A1", "K2 W3 W1 W1 W1 G2 G2 G1 A3 A2 A1 A1", "O2 W1 W1 W1 G2 G2 G2 G1 G1 A3 A2 A1"]
  };
  var BASTION = {
    easy: ["W1 A1", "K1 G1 W1 A1 W1", "K1 K1 A1 A1", "K1 K1 K1 A1 A1", "K1 O1 B1 B1 A1", "K1 K1 O1 O1 A1 A1", "K1 K1 O1 B1 A1", "K1 K1 K1 O1 B1 B1", "K2 K1 O1 O1 B1 B1", "K1 K1 O1 O1 B1 B1 A1"],
    normal: ["W1 A1 G1", "K1 G1 W1 A1 W1", "K1 K1 K1 A1 A1", "O1 O1 B1 B1", "K2 K1 K1 O1 B1 B1", "K1 O1 O1 B1 B1 A1 A1", "K2 K1 K1 K1 B2 B1 B1 A1", "K2 K1 K1 O1 B1 B1 A2 A1", "K2 K2 O2 B1 B1 A2 A2 A1", "K2 K2 K2 K1 B2 B2 A3 A1"],
    hard: ["W1 A1 G1", "K1 G1 W1 A1 W1", "K1 K1 B1 A1 A1", "K1 K1 O1 A1 A1", "K1 O1 B1 B1 B1 A1 A1", "K1 K1 K1 O1 O1 B1 A1", "K1 K1 K1 K1 O1 B1 B1 B1", "K2 K1 K1 O1 O1 B1 B1 A1", "K2 K1 O1 O1 B1 B1 B1 A3", "K2 K2 K1 K1 O1 O1 B3 B1"],
    nightmare: ["W1 A1 G1", "K1 G1 W1 A1 W1", "K1 K1 O1 B1", "K2 K1 K1 O1", "K2 K1 K1 K1 K1 O1", "K1 K1 K1 O1 O1 B1 A1", "K1 K1 K1 B2 B1 B1 A2 A1", "K1 O1 O1 O1 B2 A1 A1 A1", "K1 O2 O1 O1 O1 B1 B1 A1", "K3 K2 K1 K1 K1 O2 B1 B1"]
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
      lists: GRAVEYARD,
      power: { easy: 1, normal: 1.02, hard: 0.85, nightmare: 1.05 },
      rec: { easy: 2, normal: 4, hard: 6, nightmare: 8 }
    },
    {
      id: "bastion",
      name: "The Bone Bastion",
      blurb: "A fortress of the fallen. Only well-levelled armies hold the gate.",
      lists: BASTION,
      power: { easy: 1, normal: 1, hard: 1.25, nightmare: 1.3 },
      rec: { easy: 4, normal: 6, hard: 8, nightmare: 10 }
    }
  ];
  var stageIndex = (id) => Math.max(0, STAGES.findIndex((s) => s.id === id));
  var stageById = (id) => STAGES[stageIndex(id)];
  var difficultyName = "normal";
  var currentStageId = "crypt";
  var power = 1;
  var endlessMode = false;
  var dailyRewrite = null;
  var enemyPower = (wave = 1) => endlessMode ? endlessPower(wave) : power;
  var isEndless = () => endlessMode;
  var AUTHORED = DIFFICULTY.normal.map(parseWave);
  function setStageDifficulty(stage, name) {
    const st = stageById(stage);
    if (!DIFFS.includes(name)) return;
    endlessMode = false;
    dailyRewrite = null;
    currentStageId = st.id;
    difficultyName = name;
    power = st.power[name];
    AUTHORED.length = 0;
    st.lists[name].forEach((w) => AUTHORED.push(parseWave(w)));
  }
  function setDaily(mod, day) {
    var _a;
    setStageDifficulty("crypt", "normal");
    dailyRewrite = (_a = mod.enemy) != null ? _a : null;
    currentStageId = "daily";
    difficultyName = String(day);
    power = mod.power;
  }
  function setEndless() {
    endlessMode = true;
    dailyRewrite = null;
    currentStageId = ENDLESS_ID;
    difficultyName = "endless";
    power = 1;
    AUTHORED.length = 0;
  }
  function setDifficulty(name) {
    setStageDifficulty(currentStageId, name);
  }
  var waveCost = (w) => w.reduce((n, e) => n + COST[e.soul][e.star - 1], 0);
  function enemyWave(wave, stageSeed = 0) {
    if (endlessMode) return endlessWave(wave, stageSeed);
    if (wave <= AUTHORED.length) {
      const w = AUTHORED[wave - 1].map((e) => ({ ...e }));
      return dailyRewrite ? dailyRewrite(w, wave) : w;
    }
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
  var ENDLESS_LEN = 300;
  var ENDLESS_RULES = { curve: Array.from({ length: ENDLESS_LEN }, (_, i) => CURVES.doc[Math.min(i, CURVES.doc.length - 1)]), merge: "handIntoOneStar", stageWaves: ENDLESS_LEN, normalDrawWaves: [2, 3, 4, 5] };

  // core/daily.ts
  var DAILY_ID = "daily";
  var DAILY_MIN_CAP = 4;
  var MAX_UNITS2 = 12;
  function crowd(budget) {
    const out = [];
    let left = budget;
    for (let i = 0; out.length < MAX_UNITS2; i++) {
      const soul = i % 3 === 2 ? "goblin" : "warrior";
      if (COST[soul][0] > left) break;
      out.push({ soul, star: 1 });
      left -= COST[soul][0];
    }
    return out.length ? out : [{ soul: "warrior", star: 1 }];
  }
  var MODIFIERS = [
    { id: "empowered", name: "Empowered", text: "Enemies are 25% stronger.", power: 1.25, capDelta: 0 },
    {
      id: "melee",
      name: "No Archers",
      text: "Enemy Archers are replaced by Warriors, but everyone hits harder.",
      power: 1.15,
      capDelta: 0,
      enemy: (w) => w.map((e) => e.soul === "archer" ? { soul: "warrior", star: e.star } : e)
    },
    {
      id: "swarm",
      name: "Swarm",
      text: "Waves are crowds of Warriors and Goblins.",
      power: 0.85,
      capDelta: 0,
      enemy: (w) => crowd(Math.round(waveCost(w) * 1.15))
    },
    { id: "cramped", name: "Cramped", text: "Your Dominion is 4 lower every wave.", power: 1, capDelta: -4 },
    {
      id: "veterans",
      name: "Veterans",
      text: "Enemy Ogres and Knights are a star higher.",
      power: 0.9,
      capDelta: 0,
      enemy: (w) => w.map((e) => e.soul === "ogre" || e.soul === "knight" ? { soul: e.soul, star: Math.min(3, e.star + 1) } : e)
    }
  ];
  var dayNumber = (d = /* @__PURE__ */ new Date()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  var isValidDay = (n) => Number.isInteger(n) && n > 0 && n < 1e6;
  var modifierFor = (day) => MODIFIERS[(day % MODIFIERS.length + MODIFIERS.length) % MODIFIERS.length];
  function dailyRules(mod, pool) {
    return { ...PROTOTYPE_RULES, curve: CURVES.doc.map((c) => Math.max(DAILY_MIN_CAP, c + mod.capDelta)), pool };
  }

  // core/packs.ts
  var RARITY_OF = { warrior: "common", goblin: "common", archer: "rare", knight: "rare", ogre: "epic", barbarian: "epic" };
  var PACK_TIERS = 3;

  // core/save.ts
  var DECK_SIZE = 6;
  var KEY = "necro-save";
  var VERSION = 1;
  var DIFFICULTIES = ["easy", "normal", "hard", "nightmare"];
  var CATCH_UP_GOLD = 4e4;
  function defaultSave() {
    const souls = {};
    for (const id of SOULS) souls[id] = { level: 1, copies: 0 };
    return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls, settings: { music: true, sfx: true }, difficulty: "normal", stage: "crypt", seen: [], packs: [], nextPackId: 1, clears: {}, replayMeter: 0, endless: { best: 0 }, goldScale: 2, gold: 0, daily: null };
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
    if (raw.endless && Number.isInteger(raw.endless.best) && raw.endless.best >= 0 && raw.endless.best <= 9999) base.endless.best = raw.endless.best;
    if (Number.isInteger(raw.gold) && raw.gold >= 0 && raw.gold <= 1e9) base.gold = raw.goldScale === 2 ? raw.gold : Math.min(1e9, raw.gold * 100);
    else if (raw.gold === void 0 && Object.keys(base.clears).length) base.gold = CATCH_UP_GOLD;
    if (raw.daily && Number.isInteger(raw.daily.day) && raw.daily.day > 0 && raw.daily.day < 1e6) base.daily = { day: raw.daily.day, won: !!raw.daily.won };
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

  // core/progress.ts
  var MAX_PACKS = 99;
  var REWARDS = {
    firstClearTier: { easy: 1, normal: 2, hard: 2, nightmare: 3 },
    replayTier: 1,
    replayClearsPerPack: 2
  };
  var GOLD = { tierMult: { easy: 0.6, normal: 1, hard: 1.4, nightmare: 2 }, packPerTier: 1500, dailyWin: 5e3 };
  var waveGold = (stage, tier) => {
    var _a;
    return Math.max(1, Math.round(100 * (6 + 2 * stageIndex(stage)) * ((_a = GOLD.tierMult[tier]) != null ? _a : 1)));
  };
  var endlessWaveGold = (wave) => 100 * (8 + Math.floor(0.6 * Math.max(1, wave)));
  function addGold(save, n) {
    const g2 = Math.max(0, Math.floor(n));
    save.gold = Math.min(1e9, save.gold + g2);
    return g2;
  }
  function addGoldAndSave(n, store) {
    const s = loadSave(store);
    const g2 = addGold(s, n);
    writeSave(s, store);
    return g2;
  }
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
  function recordDailyWin(save, day) {
    if (save.daily && save.daily.day === day && save.daily.won) return { first: false, pack: null, gold: 0 };
    save.daily = { day, won: true };
    return { first: true, pack: grantPack(save, 1, "Daily challenge"), gold: addGold(save, GOLD.dailyWin) };
  }
  function recordDailyWinAndSave(day, store) {
    const s = loadSave(store);
    const r = recordDailyWin(s, day);
    writeSave(s, store);
    return r;
  }
  function recordEndlessWave(save, wave) {
    const newBest = wave > save.endless.best;
    if (newBest) save.endless.best = wave;
    const pack = wave > 0 && wave % ENDLESS_PACK_EVERY === 0 ? grantPack(save, endlessPackTier(wave), "Endless \xB7 wave " + wave) : null;
    return { wave, pack, newBest };
  }
  function recordEndlessWaveAndSave(wave, store) {
    const s = loadSave(store);
    const r = recordEndlessWave(s, wave);
    writeSave(s, store);
    return r;
  }
  var endlessUnlocked = (save) => clearCount(save, STAGES[STAGES.length - 1].id, "normal") > 0;
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
    if (endlessUnlocked(save)) keys.push("endless");
    return keys;
  }
  var TIER_NAME = { hard: "Hard mode", nightmare: "Nightmare mode" };
  function describeUnlock(key) {
    var _a;
    if (key === "endless") return "Endless Depths (new mode)";
    const [kind, stage, tier] = key.split(":");
    if (kind === "stage") return stageById(stage).name + " (new stage)";
    return ((_a = TIER_NAME[tier]) != null ? _a : tier) + " on " + stageById(stage).name;
  }
  function recordClear(save, stageId, difficulty) {
    const before = unlockedKeys(save), r = recordClearBase(save, stageId, difficulty);
    return { ...r, unlocked: unlockedKeys(save).filter((k) => !before.includes(k)) };
  }

  // game/necromancer.ts
  var Necromancer = class {
    constructor(scene, soft, container) {
      __publicField(this, "scene", scene);
      __publicField(this, "soft", soft);
      __publicField(this, "holder");
      // TransformNode: the game sets position; local +Z is his facing (the game rotates him to face the battlefield)
      __publicField(this, "ent");
      __publicField(this, "anims", {});
      __publicField(this, "cur", null);
      __publicField(this, "hand", null);
      __publicField(this, "ring");
      __publicField(this, "ps");
      __publicField(this, "t", 0);
      __publicField(this, "idleT", 0);
      __publicField(this, "nextTap", 8);
      __publicField(this, "busy", false);
      __publicField(this, "downed", false);
      __publicField(this, "S", 1.35);
      __publicField(this, "holdEnd", false);
      const s = scene;
      this.holder = new BABYLON.TransformNode("necro", s);
      this.ent = container.instantiateModelsToScene((n) => n + "_necro", false, { doNotInstantiate: true });
      const root = this.ent.rootNodes[0];
      root.parent = this.holder;
      this.holder.scaling.setAll(this.S);
      root.getChildMeshes().forEach((m) => {
        m.isPickable = false;
        m.alwaysSelectAsActiveMesh = true;
      });
      this.ent.animationGroups.forEach((g2) => {
        g2.stop();
        g2.enableBlending = true;
        g2.blendingSpeed = 0.12;
        this.anims[g2.name.split("_")[0]] = g2;
      });
      this.hand = root.getChildTransformNodes(false).find((n) => n.name.includes("Socket_Weapon")) || null;
      this.play("Idle", true);
      const ring = this.ring = BABYLON.MeshBuilder.CreateDisc("base", { radius: 0.5, tessellation: 30 }, s);
      ring.parent = this.holder;
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.02;
      ring.isPickable = false;
      const rm = new BABYLON.StandardMaterial("nr", s);
      rm.diffuseColor = BABYLON.Color3.Black();
      rm.emissiveColor = new BABYLON.Color3(0.4, 0.15, 0.75);
      rm.disableLighting = true;
      rm.alpha = 0.55;
      ring.material = rm;
      const ps = this.ps = new BABYLON.ParticleSystem("necroAura", 80, s);
      ps.particleTexture = soft;
      ps.emitter = this.holder;
      ps.minEmitBox = new BABYLON.Vector3(-0.25, 0, -0.25);
      ps.maxEmitBox = new BABYLON.Vector3(0.25, 0.8, 0.25);
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
    play(name, loop = false, hold = false) {
      const g2 = this.anims[name];
      if (!g2) return;
      if (this.cur && this.cur !== g2) this.cur.stop();
      g2.stop();
      g2.start(loop, 1, g2.from, g2.to);
      this.cur = g2;
      this.busy = !loop;
      this.holdEnd = hold;
    }
    setEnabled(on) {
      this.holder.setEnabled(on);
      if (on) this.ps.start();
      else this.ps.stop();
    }
    /** World position of the staff crystal (for spell effects): above the hand that holds the staff. */
    crystalPos() {
      this.holder.computeWorldMatrix(true);
      const base = this.hand ? (this.hand.computeWorldMatrix(true), this.hand.getAbsolutePosition().clone()) : this.holder.getAbsolutePosition().add(new BABYLON.Vector3(0, 0.6 * this.S, 0));
      return base.add(new BABYLON.Vector3(0, 0.62 * this.S, 0));
    }
    hurt() {
      if (!this.downed) this.play("Hurt");
    }
    cast() {
      if (!this.downed) this.play("Cast");
    }
    /** The last heart is gone: he sinks to his knees. */
    defeat() {
      this.downed = true;
      this.play("Down", false, true);
    }
    revive() {
      if (this.downed) {
        this.downed = false;
        this.play("Revive");
      } else if (this.busy && this.cur !== this.anims["Idle"]) this.play("Idle", true);
    }
    update(dt) {
      this.t += dt;
      if (this.cur && !this.cur.isStarted && !this.downed) this.play("Idle", true);
      else if (this.cur && !this.cur.isStarted && this.downed && !this.holdEnd) this.play("Idle", true);
      if (!this.busy && !this.downed) {
        this.idleT += dt;
        if (this.idleT > this.nextTap) {
          this.idleT = 0;
          this.nextTap = 9 + Math.random() * 8;
          this.play("Tap");
        }
      }
      this.ps.emitRate = this.downed ? 6 : this.busy && this.cur === this.anims["Cast"] ? 110 : 30;
    }
    dispose() {
      this.ps.stop();
      this.ps.dispose();
      this.ent.animationGroups.forEach((g2) => g2.dispose());
      this.ent.skeletons.forEach((s) => s.dispose());
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
    /** A Soul's voice, synthesized: skeleton rattle, archer whistle, goblin cackle, knight grunt, ogre growl, barbarian roar. `k` shifts the pitch (enemies a little lower), `delay` staggers a chorus. */
    bark(soul, delay = 0, k = 1) {
      if (!this.ctx || !this.sfx || this.ctx.state !== "running" || !this.throttle("bark" + soul, 350)) return;
      const T = (f, d, type, g2, dl, slide, att, lp) => this.tone(f * k, d, type, g2, delay + dl, slide ? slide * k : void 0, att, lp);
      const H = (d, g2, type, f, dl, sw) => this.hiss(d, g2, type, f, delay + dl, sw);
      switch (soul) {
        case "warrior":
          [0, 0.06, 0.12, 0.19].forEach((dl) => H(0.03, 0.16, "highpass", 3500, dl));
          T(520, 0.22, "square", 0.07, 0, 280, 5e-3, 1800);
          break;
        case "archer":
          T(900, 0.16, "sine", 0.13, 0, 1350, 0.01);
          T(1350, 0.22, "sine", 0.11, 0.16, 760, 0.01);
          break;
        case "goblin":
          [0, 0.11, 0.22].forEach((dl, i) => T(500 + i * 70, 0.1, "sawtooth", 0.09, dl, 620 + i * 70, 5e-3, 2600));
          H(0.3, 0.05, "bandpass", 2200, 0);
          break;
        case "knight":
          T(150, 0.32, "sawtooth", 0.12, 0, 105, 0.02, 900);
          T(225, 0.3, "square", 0.05, 0.02, 160, 0.02, 900);
          H(0.08, 0.12, "highpass", 4500, 0.1);
          break;
        case "ogre":
          T(75, 0.75, "sawtooth", 0.2, 0, 52, 0.05, 320);
          T(112, 0.7, "sawtooth", 0.08, 0.03, 80, 0.05, 420);
          H(0.6, 0.12, "lowpass", 420, 0.02, 140);
          break;
        case "barbarian":
          T(170, 0.5, "sawtooth", 0.14, 0, 340, 0.03, 1400);
          T(340, 0.45, "sawtooth", 0.08, 0.1, 210, 0.03, 1600);
          H(0.45, 0.1, "bandpass", 900, 0, 500);
          break;
      }
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
      return { snap: { v: VERSION2, seed: x.seed, attempt: x.attempt, stage: typeof x.stage === "string" ? x.stage : "crypt", difficulty: x.difficulty, phase: draft ? "draft" : "build", draft, state: x.state, startBest: Number.isInteger(x.startBest) && x.startBest >= 0 && x.startBest <= 9999 ? x.startBest : void 0 }, state };
    } catch {
      return null;
    }
  }

  // game/visuals.ts
  var TINT = [[1, 1, 1], [0.86, 0.95, 1.18], [1.25, 1.1, 0.7]];
  var AURA = [
    { rate: 14, min: 0.06, max: 0.16, c1: [0.78, 0.35, 1, 0.7], c2: [0.45, 0.15, 0.9, 0.5] },
    { rate: 26, min: 0.08, max: 0.2, c1: [0.85, 0.65, 1, 0.8], c2: [0.55, 0.4, 1, 0.6] },
    { rate: 44, min: 0.1, max: 0.26, c1: [1, 0.85, 0.4, 0.85], c2: [0.8, 0.3, 1, 0.7] }
  ];
  var VOCAL = /* @__PURE__ */ new Set(["Roar", "Thump", "Stomp", "Snicker", "Scheme", "Boast", "Flex", "DoubleBiceps", "Fumble", "ShieldBonk", "Bonk"]);
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
      emote: {},
      ringMat: [emissive(0.55, 0.2, 0.95, 0.9), emissive(0.95, 0.25, 0.2, 0.9)],
      haloMat: emissive(1, 0.82, 0.3, 0.95),
      barBg: emissive(0.05, 0.05, 0.08, 0.7),
      barFill: [emissive(0.55, 0.35, 1), emissive(1, 0.4, 0.3)],
      manaFill: emissive(0.25, 0.75, 1)
    };
    const zzz = dyn(scene, 128, 128, (c) => {
      c.textAlign = "center";
      c.lineWidth = 9;
      c.strokeStyle = "#150d26";
      c.fillStyle = "#e8d8ff";
      c.lineJoin = "round";
      for (const [ch, size, x, y] of [["Z", 64, 34, 100], ["z", 48, 74, 66], ["z", 34, 104, 38]]) {
        c.font = "italic 900 " + size + "px sans-serif";
        c.strokeText(ch, x, y);
        c.fillText(ch, x, y);
      }
    });
    const zm = new BABYLON.StandardMaterial("zzz", scene);
    zm.diffuseTexture = zzz;
    zm.useAlphaFromDiffuseTexture = true;
    zm.emissiveColor = BABYLON.Color3.White();
    zm.disableLighting = true;
    zm.backFaceCulling = false;
    A.emote["zzz"] = zm;
    const icon = (name, draw2) => {
      const m = new BABYLON.StandardMaterial(name, scene);
      m.diffuseTexture = dyn(scene, 128, 128, draw2);
      m.useAlphaFromDiffuseTexture = true;
      m.emissiveColor = BABYLON.Color3.White();
      m.disableLighting = true;
      m.backFaceCulling = false;
      A.emote[name] = m;
    };
    const glyph = (ch, fill) => (c) => {
      c.textAlign = "center";
      c.lineWidth = 12;
      c.strokeStyle = "#150d26";
      c.lineJoin = "round";
      c.fillStyle = fill;
      c.font = "900 104px sans-serif";
      c.strokeText(ch, 64, 100);
      c.fillText(ch, 64, 100);
    };
    icon("?", glyph("?", "#ffe27a"));
    icon("!", glyph("!", "#ff9a7a"));
    icon("sweat", (c) => {
      c.lineWidth = 8;
      c.strokeStyle = "#15304a";
      c.fillStyle = "#9fe4ff";
      c.beginPath();
      c.moveTo(64, 14);
      c.bezierCurveTo(104, 62, 104, 108, 64, 112);
      c.bezierCurveTo(24, 108, 24, 62, 64, 14);
      c.closePath();
      c.stroke();
      c.fill();
    });
    icon("sparkle", (c) => {
      c.lineWidth = 7;
      c.strokeStyle = "#3a2a05";
      c.fillStyle = "#fff2a8";
      const star = (x, y, r) => {
        c.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4, rr = i % 2 ? r * 0.28 : r;
          c.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr);
        }
        c.closePath();
        c.stroke();
        c.fill();
      };
      star(56, 70, 50);
      star(102, 28, 20);
      star(26, 24, 14);
    });
    const defs = [
      ["warrior", "SkeletonWarrior.glb", "SkeletonWarrior_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Cheer" }, 1.05, 1, { flavor: { clips: [{ clip: "Trip", emote: "!" }, { clip: "Bonk", emote: "?" }, { clip: "Wobble", emote: "sweat" }, { clip: "Wave", emote: "sparkle" }, { clip: "Fumble", emote: "!" }, { clip: "ShieldBonk", emote: "?" }], min: 8, max: 15 }, cheers: [{ clip: "Cheer", emote: "sparkle" }, { clip: "Wave", emote: "sparkle" }, { clip: "Trip", emote: "!" }], eyes: "SkeletonWarrior_eyes.png" }],
      ["archer", "SkeletonArcher.glb", "SkeletonArcher_enemy.jpg", { idle: "Idle", run: "Run", attack: "Shoot", death: "Death", spawn: "Spawn", cheer: "Flex" }, 1.05, 1, { flavor: { clips: [{ clip: "Flex", emote: "sparkle" }, { clip: "DoubleBiceps", emote: "sparkle" }, { clip: "BoneCrack" }, { clip: "BowTwirl", emote: "sparkle" }], min: 8, max: 15 }, cheers: [{ clip: "Flex", emote: "sparkle" }, { clip: "DoubleBiceps", emote: "sparkle" }, { clip: "BowTwirl", emote: "sparkle" }], eyes: "SkeletonArcher_eyes.png" }],
      ["goblin", "Goblin.glb", "Goblin_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Cheer" }, 1, 0.85, { flavor: { clips: [{ clip: "Scheme", emote: "!" }, { clip: "Peek", emote: "?" }, { clip: "Spin", emote: "sparkle" }, { clip: "Snicker", emote: "sparkle" }], min: 6, max: 12 }, cheers: [{ clip: "Cheer", emote: "sparkle" }, { clip: "Snicker", emote: "sparkle" }, { clip: "Spin", emote: "sparkle" }], eyes: "Goblin_eyes.png" }],
      ["knight", "Knight.glb", "Knight_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Pose" }, 1, 1.05, { flavor: { clips: [{ clip: "Salute", emote: "sparkle" }, { clip: "Boast", emote: "!" }, { clip: "Admire", emote: "sparkle" }, { clip: "Pray", emote: "sparkle" }], min: 8, max: 15 }, cheers: [{ clip: "Pose", emote: "sparkle" }, { clip: "Salute", emote: "sparkle" }, { clip: "Boast", emote: "!" }, { clip: "Pray", emote: "sparkle" }], eyes: "Knight_eyes.png" }],
      ["barbarian", "Barbarian.glb", "Barbarian_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Cheer" }, 1, 1.05, { flavor: { clips: [{ clip: "Roar", emote: "!" }, { clip: "ChestBeat" }, { clip: "Stomp", emote: "!" }], min: 7, max: 13 }, cheers: [{ clip: "Cheer", emote: "sparkle" }, { clip: "Roar", emote: "!" }, { clip: "ChestBeat" }], eyes: "Barbarian_eyes.png" }],
      ["ogre", "Ogre.glb", "Ogre_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Cheer" }, 1.02, 1.12, { starScale: [1, 1.3, 1.65], flavor: { clips: [{ clip: "Yawn", emote: "zzz" }, { clip: "Scratch" }, { clip: "Stomp", emote: "!" }, { clip: "Thump" }], min: 9, max: 16 }, cheers: [{ clip: "Cheer" }, { clip: "Thump", emote: "!" }, { clip: "Stomp", emote: "!" }], spawnEmote: "zzz", eyes: "Ogre_eyes.png" }]
    ];
    const necroP = BABYLON.SceneLoader.LoadAssetContainerAsync("assets/", "Necromancer.glb", scene).then((c) => {
      A.necro = c;
    }).catch(() => {
    });
    const arrowP = BABYLON.SceneLoader.LoadAssetContainerAsync("assets/", "Arrow.glb", scene).then((c) => {
      A.arrow = c;
    }).catch(() => {
    });
    await Promise.all([arrowP, necroP, ...defs.map(async ([soul, glb, enemy, clips, top, scale, extra]) => {
      const container = await BABYLON.SceneLoader.LoadAssetContainerAsync("assets/", glb, scene);
      A.tripo[soul] = { container, enemyTex: new BABYLON.Texture("assets/" + enemy, scene, false, false), clips, matCache: {}, top, scale, ...extra || {}, eyeTex: extra && extra.eyes ? new BABYLON.Texture("assets/" + extra.eyes, scene, false, false) : void 0 };
    })]);
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
    /** The bars keep the same size and the same small gap above the head however big the unit grows. */
    fit(k) {
      this.badge.scaling.setAll(1 / k);
      this.badge.position.y = this.top + 0.3 / k;
      if (this.halo) this.halo.position.y = this.top + 0.08;
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
      __publicField(this, "lastFlavor", "");
      __publicField(this, "uid", "");
      __publicField(this, "own", null);
      __publicField(this, "idleT", 0);
      __publicField(this, "nextFlavor", 1e9);
      __publicField(this, "flavorOn", false);
      __publicField(this, "queued", false);
      __publicField(this, "spawnT", 0);
      __publicField(this, "eyeK", 0.65);
      __publicField(this, "emotes", []);
      __publicField(this, "soulId");
      this.soulId = soul;
      const s = A.scene, uid = Math.random().toString(36).slice(2, 7);
      this.uid = uid;
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
      if (cfg.flavor) this.nextFlavor = cfg.flavor.min + Math.random() * (cfg.flavor.max - cfg.flavor.min);
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
      if (c.eyeTex) {
        if (!this.own) {
          this.own = c.baseMat.clone("own_" + this.uid);
          this.own.emissiveTexture = c.eyeTex;
          this.own.emissiveIntensity = this.eyeK;
        }
        this.own.albedoTexture = this.team === 1 ? c.enemyTex : c.baseMat.albedoTexture;
        const t = TINT[this.star - 1];
        this.own.albedoColor = new BABYLON.Color3(t[0], t[1], t[2]);
        this.own.emissiveColor = this.team === 1 ? new BABYLON.Color3(1, 0.72, 0.2) : new BABYLON.Color3(0.78, 0.3, 1);
        this.body.material = this.own;
        return;
      }
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
      this.holder.scaling.setAll(this.sc(st) * this.base);
      this.deco.set(this.team, st);
      this.deco.fit(this.sc(st) * this.base);
    }
    sc(st) {
      return (this.cfg.starScale || BALANCE.star.scale)[st - 1];
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
      let clip = this.cfg.clips[state], pose;
      if (state === "cheer" && this.cfg.cheers) {
        pose = this.cfg.cheers[Math.floor(Math.random() * this.cfg.cheers.length)];
        clip = pose.clip;
      }
      const g2 = this.anims[clip];
      if (!g2) return;
      const loop = state === "idle" || state === "run";
      if (state === "idle" && this.state === "spawn" && this.cur && this.cur.isStarted && this.cfg.flavor) {
        this.queued = true;
        return;
      }
      if (loop && this.state === state && this.cur === g2) return;
      this.queued = false;
      this.flavorOn = false;
      this.idleT = 0;
      if (this.cur) this.cur.stop();
      g2.stop();
      g2.start(loop, speed, g2.from, g2.to);
      if (loop) g2.goToFrame(g2.from + Math.random() * (g2.to - g2.from));
      this.cur = g2;
      this.state = state;
      this.deco.setAura(state !== "death");
      if (pose && pose.emote) this.emote(pose.emote, 0.35);
      if (state === "spawn") {
        this.spawnT = 0;
        if (this.cfg.spawnEmote) {
          this.emote(this.cfg.spawnEmote, 0.1);
          this.emote(this.cfg.spawnEmote, 0.7);
        }
      }
    }
    /** A little picture that floats up over the head and fades (a sleepy "Zzz"). */
    emote(kind, delay = 0) {
      const mat = this.A.emote[kind];
      if (!mat) return;
      const pl = BABYLON.MeshBuilder.CreatePlane("emo", { size: 0.42 }, this.A.scene);
      pl.parent = this.holder;
      pl.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      pl.material = mat;
      pl.isPickable = false;
      pl.visibility = 0;
      const y0 = this.top + 0.02;
      pl.position.set(0.16, y0, 0);
      this.emotes.push({ m: pl, t: -delay, y0 });
    }
    /** After standing idle for a while: play the unit's flavour clip once (the Ogre yawns), then go back to idling. */
    startFlavor() {
      const f = this.cfg.flavor;
      this.idleT = 0;
      let pool = f.clips.filter((c) => c.clip !== this.lastFlavor && this.anims[c.clip]);
      if (!pool.length) pool = f.clips.filter((c) => this.anims[c.clip]);
      if (!pool.length) return;
      const pose = pool[Math.floor(Math.random() * pool.length)], g2 = this.anims[pose.clip];
      this.lastFlavor = pose.clip;
      if (this.cur) this.cur.stop();
      g2.stop();
      g2.start(false, 1, g2.from, g2.to);
      this.cur = g2;
      this.flavorOn = true;
      this.nextFlavor = f.min + Math.random() * (f.max - f.min);
      if (VOCAL.has(pose.clip)) audio.bark(this.soulId, 0.25);
      if (pose.emote) {
        this.emote(pose.emote, 0.4);
        if (pose.emote === "zzz") this.emote(pose.emote, 1.2);
      }
    }
    update(dt) {
      this.deco.update(dt);
      if (this.cur && !this.cur.isStarted) {
        if (this.queued) {
          this.queued = false;
          this.play("idle");
        } else if (this.flavorOn) {
          this.flavorOn = false;
          this.play("idle");
        } else if (this.state === "cheer") this.play("idle");
      }
      if (this.cfg.flavor && this.state === "idle" && !this.flavorOn && this.holder.isEnabled()) {
        this.idleT += dt;
        if (this.idleT >= this.nextFlavor) this.startFlavor();
      }
      if (this.state === "spawn") this.spawnT += dt;
      for (let i = this.emotes.length - 1; i >= 0; i--) {
        const e = this.emotes[i];
        e.t += dt;
        if (e.t < 0) continue;
        const k = e.t / 1.9;
        if (k >= 1) {
          e.m.dispose();
          this.emotes.splice(i, 1);
          continue;
        }
        e.m.visibility = Math.min(1, e.t / 0.2) * (1 - k * k);
        e.m.position.set(0.16 + 0.05 * Math.sin(e.t * 3), e.y0 + e.t * 0.2, 0);
        e.m.scaling.setAll(0.7 + 0.5 * k);
      }
      if (this.own) {
        let target = 0.65;
        if (this.state === "spawn") target = 0.08 + 0.92 * Math.max(0, Math.min(1, (this.spawnT / 1.67 - 0.45) / 0.3));
        else if (this.state === "idle") target = this.flavorOn ? 0.25 : 0.65;
        else if (this.state === "run") target = 1;
        else if (this.state === "attack") target = 1.7;
        else if (this.state === "cheer") target = 1.4;
        else if (this.state === "death") target = 0.05;
        this.eyeK += (target - this.eyeK) * Math.min(1, dt * 7);
        this.own.emissiveIntensity = this.eyeK;
      }
      if (this.pulseT > 0) {
        this.pulseT -= dt;
        const k = 1 + 0.09 * Math.sin(Math.max(0, this.pulseT) / 0.16 * Math.PI);
        this.holder.scaling.setAll(this.sc(this.star) * this.base * k);
      }
    }
    dispose() {
      this.emotes.forEach((e) => e.m.dispose());
      if (this.own) this.own.dispose();
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
      this.deco.fit(this.base);
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
  var fmt = (n) => Math.round(n).toLocaleString("en-US");

  // ui/portraits.ts
  var PORTRAIT = { warrior: "assets/portraits/warrior_head.png", archer: "assets/portraits/archer_head.png", ogre: "assets/portraits/ogre_head.png", goblin: "assets/portraits/goblin_head.png", knight: "assets/portraits/knight_head.png", barbarian: "assets/portraits/barbarian_head.png" };
  var RARITY_HEX = { common: "#b8c0cc", rare: "#4aa3ff", epic: "#b26bff", legendary: "#ffcc33" };
  var hasArt = (s) => !!PORTRAIT[s];
  var soulArt = (s) => {
    var _a;
    return (_a = PORTRAIT[s]) != null ? _a : iconUrl(SOUL_ICON[s]);
  };
  var rarityColor = (s) => RARITY_HEX[RARITY_OF[s]];
  var artBg = (s) => {
    const c = rarityColor(s);
    return `radial-gradient(ellipse at 50% 80%, ${c}77 0%, ${c}26 46%, transparent 74%), linear-gradient(#2b2444,#0d0919)`;
  };

  // game/ui.ts
  var portraitHtml = (s) => `<div class="pt" style="background:${artBg(s)}"><img src="${soulArt(s)}" alt="" draggable="false"></div>`;
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
      $("btnRemove").onclick = () => g2.removeSelected();
      $("btnSpeed").onclick = () => g2.setSpeed(g2.timeScale > 1 ? 1 : 2);
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
      $("wave").textContent = isEndless() ? `Wave ${s.wave}` : `Wave ${s.wave}/${stageWaves(s)}`;
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
        const art = hasArt(soul);
        el.className = "card" + (art ? " art" : "") + (sel ? " sel" : "") + (!usable && !g2.swapMode ? " dis" : "") + (g2.swapMode ? " swap" : "");
        const tag = afford ? `<span class="ok">Summon</span>` : canMerge ? '<span class="ok mg">Merge only</span>' : '<span class="no">No room</span>';
        if (art) el.style.borderColor = rarityColor(soul);
        el.innerHTML = `<div class="cost">${cost(soul, 1)}</div>${art ? portraitHtml(soul) : ICON[soul] + `<div class="nm">${SOUL_NAME[soul]}</div>`}<div class="cs">${tag}</div>`;
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
      $("btnRemove").textContent = g2.confirmRemove ? "Confirm remove" : "Remove";
      $("info").textContent = build ? g2.swapMode ? "SWAP: tap a hand card to discard it, or tap a unit you did not summon this round to sell it. You draw a different Soul." : selU ? `${SOUL_NAME[selU.soul]} ${stars(selU.star)}  \u2022  ${ROLE_TEXT[selU.soul]}  ${partner ? "\u2022 Tap the matching unit to merge into a stronger star." : ""}` : g2.sel && g2.sel.type === "card" ? `${SOUL_NAME[s.hand[g2.sel.idx]]}: ${ROLE_TEXT[s.hand[g2.sel.idx]]}  \u2022  ` + (() => {
        const i = g2.sel.idx, sm = canSummon(s, i), mg = s.units.some((u) => canMergeFromHand(s, i, u.id));
        return sm && mg ? "Tap a green tile to summon, or a glowing purple unit to merge it in." : sm ? "Tap a green tile to summon." : mg ? "Dominion is full: tap a glowing purple unit to merge it in." : "Not enough free Dominion to summon this.";
      })() : "Tap a card, then a tile. Tap a unit to merge, move or remove it." : ph === "battle" || ph === "transition" ? "Battle! Units fight on their own." : "";
      $("speed").style.display = ph === "battle" || ph === "transition" ? "flex" : "none";
      const fast = g2.speedUnlocked();
      if (!fast && g2.timeScale > 1) g2.timeScale = 1;
      const sb = $("btnSpeed");
      sb.style.display = fast ? "" : "none";
      sb.textContent = g2.timeScale + "x";
      sb.classList.toggle("on", g2.timeScale > 1);
      document.querySelectorAll("[data-cam]").forEach((b) => b.classList.toggle("on", b.dataset.cam === g2.camMode));
      document.body.classList.toggle("inbattle", ph === "battle" || ph === "transition");
      audio.setMode(ph === "battle" || ph === "transition" ? "battle" : "build");
      const ov = $("overlay");
      ov.className = "";
      ov.innerHTML = "";
      if (ph === "draft" && g2.draft) {
        ov.className = "show";
        ov.innerHTML = `<div class="box"><h2>Victory Draft</h2><div class="sub">Wave cleared. Dominion is now ${s.cap}.${g2.lastGold ? ` <b style="color:#ffd24a">+${fmt(g2.lastGold)}</b> ${iconImg("gold")}` : ""} Keep one:</div><div class="row">${g2.draft.map((soul, i) => `<div class="card big${hasArt(soul) ? " art" : ""}" data-i="${i}"${hasArt(soul) ? ` style="border-color:${rarityColor(soul)}"` : ""}><div class="cost">${cost(soul, 1)}</div>${hasArt(soul) ? portraitHtml(soul) : ICON[soul]}<div class="nm">${SOUL_NAME[soul]}</div><div class="role">${ROLE_TEXT[soul]}</div></div>`).join("")}</div></div>`;
        ov.querySelectorAll(".card").forEach((c) => c.onclick = () => g2.pickDraft(+c.dataset.i));
      } else if (ph === "won" || ph === "lost") {
        const rw = ph === "won" ? g2.reward : null, sk = (n) => skullImgs(n);
        const unlockHtml = rw && rw.unlocked && rw.unlocked.length ? `<div class="sub" style="color:#7ef2c8;font-weight:700">${iconImg("check")} Unlocked: ${rw.unlocked.map((k) => describeUnlock(k)).join(" \xB7 ")}</div>` : "";
        const goldHtml = g2.runGold ? `<div class="sub" style="color:#ffd24a;font-weight:700">${iconImg("gold")} Gold earned this run: ${fmt(g2.runGold)}</div>` : "";
        const dr = ph === "won" && g2.daily ? g2.dailyReward : null;
        const dailyHtml = g2.daily ? dr ? `<div class="sub" style="color:#ffd24a;font-weight:700">${dr.pack ? `${iconImg("shop")} Daily complete! You earned a ${sk(1)} Soul Pack and ${fmt(dr.gold)} ${iconImg("gold")}.` : "Daily complete again. The reward comes once per day: see you tomorrow!"}</div>` : "" : "";
        const rewardHtml = goldHtml + dailyHtml + unlockHtml + (rw ? `<div class="sub" style="color:#ffd24a;font-weight:700">${rw.pack ? rw.first ? `${iconImg("shop")} First clear! You earned a ${sk(rw.pack.tier)} Soul Pack.` : `${iconImg("shop")} Replay reward: a ${sk(rw.pack.tier)} Soul Pack.` : `Replay progress ${rw.replayMeter}/${rw.replayNeeded} toward a Soul Pack.`}</div>` : "");
        if (ph === "lost" && isEndless() && g2.endless) {
          const e = g2.endless, rec = e.cleared > e.startBest;
          ov.className = "show";
          ov.innerHTML = `<div class="box"><h2>Run over</h2><div class="sub">You cleared ${e.cleared} wave${e.cleared === 1 ? "" : "s"}. ${rec ? '<b style="color:#ffd24a">New best depth!</b>' : "Best: wave " + Math.max(e.startBest, e.cleared) + "."}</div>${g2.runGold ? `<div class="sub" style="color:#ffd24a;font-weight:700">${iconImg("gold")} Gold earned this run: ${fmt(g2.runGold)}</div>` : ""}${e.packs ? `<div class="sub" style="color:#ffd24a;font-weight:700">${iconImg("shop")} ${e.packs} Soul Pack${e.packs === 1 ? "" : "s"} earned this run.</div>` : '<div class="sub">Clear wave 10 to earn a Soul Pack.</div>'}<div class="row">${e.packs ? '<button id="toShop" class="go">Open pack</button>' : ""}<button id="again" class="${e.packs ? "blue" : "go"}">Go again</button><button id="toHome" class="blue">Home</button></div></div>`;
          $("again").onclick = () => g2.newEndless();
          $("toHome").onclick = () => window.dispatchEvent(new Event("necro-go-home"));
          const ts2 = document.getElementById("toShop");
          if (ts2) ts2.onclick = () => window.dispatchEvent(new Event("necro-go-shop"));
        } else {
          ov.className = "show";
          ov.innerHTML = `<div class="box"><h2>${g2.daily ? ph === "won" ? "Daily complete!" : "Challenge failed" : ph === "won" ? "Stage cleared!" : "Stage lost"}</h2><div class="sub">${g2.lastBattle}</div>${rewardHtml}<div class="row">${rw && rw.pack || dr && dr.pack ? '<button id="toShop" class="go">Open pack</button>' : ""}<button id="again" class="${rw && rw.pack || dr && dr.pack ? "blue" : "go"}">${ph === "won" ? "Play again" : "Try again"}</button><button id="toHome" class="blue">Home</button></div></div>`;
          $("again").onclick = () => g2.daily ? g2.newDaily() : g2.newRun();
          $("toHome").onclick = () => window.dispatchEvent(new Event("necro-go-home"));
          const ts = document.getElementById("toShop");
          if (ts) ts.onclick = () => window.dispatchEvent(new Event("necro-go-shop"));
        }
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
      __publicField(this, "daily", null);
      __publicField(this, "dailyReward", null);
      // the Daily Challenge run in progress, and what its win paid
      __publicField(this, "lastGold", 0);
      __publicField(this, "runGold", 0);
      // gold from the wave just cleared, and from this whole run
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
      __publicField(this, "arena");
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
      /** The endless run in progress: the best depth when it began (to spot a new record), the waves cleared so far, and the packs earned. */
      __publicField(this, "endless", null);
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
      __publicField(this, "arrowBase", []);
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
      ground.isPickable = false;
      const arena = this.arena = buildArena(scene, ground);
      scene.onBeforeRenderObservable.add(() => arena.update(performance.now() / 1e3));
      for (const team of [0, 1]) for (let c = 0; c < GRID_CELLS; c++) {
        const t = this.makeTile(team, c);
        if (team === 0) this.tiles.push(t);
        else t.setEnabled(false);
      }
      this.A = await loadAssets(scene);
      this.necro = new Necromancer(scene, this.A.soft, this.A.necro);
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
    /** The placement grid is a build-screen tool: hide it during the fight so the battle looks like a scene, not a board. */
    showGrid(on) {
      for (const t of this.tiles) t.setEnabled(on);
    }
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
      var _a;
      try {
        const s = this.s;
        if (!s) return;
        if (s.status !== "building") {
          clearRun();
          return;
        }
        if (this.phase !== "build" && this.phase !== "draft") return;
        const snap = { v: 1, seed: this.seed, attempt: this.attempt, stage: currentStageId, difficulty: difficultyName, phase: this.phase, draft: this.phase === "draft" ? this.draft : null, state: serializeState(s), startBest: (_a = this.endless) == null ? void 0 : _a.startBest };
        saveRun(snap);
      } catch {
      }
    }
    /** Rebuild the screen from a saved run (a reload, or Safari discarding the page). */
    restore(r) {
      var _a;
      const { snap, state } = r;
      this.cine = false;
      this.flushTweens();
      this.necro.revive();
      this.daily = null;
      if (snap.stage === DAILY_ID && isValidDay(+snap.difficulty)) {
        const day = +snap.difficulty, mod = modifierFor(day);
        setDaily(mod, day);
        this.daily = { day, mod };
        this.endless = null;
        this.arena.setTheme("crypt");
      } else if (snap.stage === ENDLESS_ID) {
        setEndless();
        const done = Math.max(0, state.wave - 1);
        this.endless = { startBest: (_a = snap.startBest) != null ? _a : loadSave().endless.best, cleared: done, packs: Math.floor(done / ENDLESS_PACK_EVERY) };
      } else {
        setStageDifficulty(snap.stage, snap.difficulty);
        this.endless = null;
      }
      if (!this.daily) this.arena.setTheme(currentStageId);
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
      this.showGrid(this.phase === "build");
      this.syncBuild();
      this.ui.render();
      this.setCam(this.poses().build);
      this.toast(`Run restored: wave ${isEndless() ? state.wave : state.wave + "/" + stageWaves(state)}, ${state.hearts} heart${state.hearts === 1 ? "" : "s"}.`);
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
    /** Give up the run in progress (Home > New battle, after the player confirms): the saved run is dropped and Home lets them pick any stage or mode. Gold and packs already earned stay. */
    abandonRun() {
      this.startStage(Math.floor(Math.random() * 1e6) + 1);
      clearRun();
    }
    newRun() {
      this.startStage(new URLSearchParams(location.search).get("seed") ? this.seed : Math.floor(Math.random() * 1e6) + 1);
    }
    startStage(seed) {
      this.cine = false;
      this.reward = null;
      this.flushTweens();
      if (this.necro) this.necro.revive();
      this.runGold = 0;
      this.lastGold = 0;
      this.daily = null;
      this.dailyReward = null;
      this.seed = seed;
      this.attempt = 0;
      this.endless = null;
      const sv = loadSave(), pl = playable(sv);
      setStageDifficulty(pl.stage, pl.difficulty);
      this.arena.setTheme(currentStageId);
      this.s = newStage({ ...PROTOTYPE_RULES, pool: sv.deck }, seed);
      this.seenMerges = 0;
      this.clearBattle();
      this.showGrid(true);
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
    /** Today's Daily Challenge (Home > Daily Challenge): the same seed and twist for everyone on the same day. Retry as often as you like; the reward is paid once. */
    newDaily() {
      this.startDaily(dayNumber());
    }
    startDaily(day) {
      this.cine = false;
      this.reward = null;
      this.flushTweens();
      if (this.necro) this.necro.revive();
      const mod = modifierFor(day), sv = loadSave();
      setDaily(mod, day);
      this.arena.setTheme("crypt");
      this.runGold = 0;
      this.lastGold = 0;
      this.dailyReward = null;
      this.endless = null;
      this.daily = { day, mod };
      this.seed = day;
      this.attempt = 0;
      this.s = newStage(dailyRules(mod, sv.deck), this.seed);
      this.seenMerges = 0;
      this.clearBattle();
      this.showGrid(true);
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
      this.toast(`Daily Challenge: ${mod.name}. ${mod.text}`);
    }
    /** Fresh Endless Depths run (Home > Endless Depths calls this): same rules as a stage, but the waves never stop and the enemy keeps growing. */
    newEndless() {
      this.startEndless(new URLSearchParams(location.search).get("seed") ? this.seed : Math.floor(Math.random() * 1e6) + 1);
    }
    startEndless(seed) {
      this.cine = false;
      this.reward = null;
      this.flushTweens();
      if (this.necro) this.necro.revive();
      this.runGold = 0;
      this.lastGold = 0;
      this.daily = null;
      this.dailyReward = null;
      this.seed = seed;
      this.attempt = 0;
      const sv = loadSave();
      setEndless();
      this.arena.setTheme(ENDLESS_ID);
      this.endless = { startBest: sv.endless.best, cleared: 0, packs: 0 };
      this.s = newStage({ ...ENDLESS_RULES, pool: sv.deck }, seed);
      this.seenMerges = 0;
      this.clearBattle();
      this.showGrid(true);
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
      this.toast("Endless Depths: how deep can you go? A Soul Pack every 10 waves.");
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
    /** For the tutorial spotlight: where an empty tile (the one nearest the middle of the grid) is on the screen, in CSS pixels, or null. */
    emptyTileRect() {
      if (!this.s || !this.canvas || this.phase !== "build") return null;
      const used = new Set(this.s.units.map((u) => u.cell));
      let mx = 0, mz = 0;
      const all = Array.from({ length: GRID_CELLS }, (_, c) => this.pos(c));
      all.forEach((p2) => {
        mx += p2.x / GRID_CELLS;
        mz += p2.z / GRID_CELLS;
      });
      let best = -1, bd = 1e9;
      for (let c = 0; c < GRID_CELLS; c++) {
        if (used.has(c)) continue;
        const d = Math.hypot(all[c].x - mx, all[c].z - mz);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best < 0) return null;
      const p = all[best], h = GRID_SP * 0.46, W = this.engine.getRenderWidth(), H = this.engine.getRenderHeight(), vp = this.camera.viewport.toGlobal(W, H), m = this.scene.getTransformMatrix();
      const pts = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([dx, dz]) => BABYLON.Vector3.Project(new BABYLON.Vector3(p.x + dx, 0.02, p.z + dz), BABYLON.Matrix.Identity(), m, vp));
      const r = this.canvas.getBoundingClientRect(), kx = r.width / W, ky = r.height / H, xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (!isFinite(x0 + x1 + y0 + y1)) return null;
      return { x: r.left + x0 * kx, y: r.top + y0 * ky, w: (x1 - x0) * kx, h: (y1 - y0) * ky };
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
      this.showGrid(false);
      this.sel = null;
      this.swapMode = false;
      this.attempt++;
      this.handled = false;
      this.resultAt = -1;
      const s = this.s, units = s.units.slice();
      const saved = loadSave().souls, levels = {};
      for (const k of Object.keys(saved)) levels[k] = saved[k].level;
      this.battle = new Battle(units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell })), enemyWave(s.wave, this.seed), this.seed * 131 + s.wave * 17 + this.attempt, levels, enemyPower(s.wave));
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
      this.battleRoar();
    }
    applyEvents(evs) {
      const b = this.battle;
      for (const e of evs) {
        if (e.t === "swing") {
          const v = this.fvis.get(e.id);
          if (v) v.play("attack", e.speed);
          if (Math.random() < 0.08) {
            const f = b.byId(e.id);
            if (f) audio.bark(f.soul, 0, f.team === 0 ? 1 : 0.85);
          }
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
    /** The arrow's own material with a faint glow in the team colour (purple for yours, amber for the enemy's), so you can still tell whose it is. */
    arrowTeamMat(team) {
      if (this.arrowBase[team]) return this.arrowBase[team];
      const src = this.A.arrow.materials && this.A.arrow.materials[0];
      if (!src) return null;
      const m = src.clone("arrowT" + team);
      const c = team === 0 ? new BABYLON.Color3(0.55, 0.2, 0.85) : new BABYLON.Color3(0.9, 0.55, 0.15);
      if ("emissiveColor" in m) m.emissiveColor = c.scale(0.035);
      this.arrowBase[team] = m;
      return m;
    }
    spawnArrow(team, x0, z0, x1, z1, dur) {
      let mesh = this.arrowMesh.pop();
      if (!mesh) {
        const holder = new BABYLON.TransformNode("ar", this.scene);
        holder.scaling.setAll(0.65);
        if (this.A.arrow) {
          const ent = this.A.arrow.instantiateModelsToScene((n) => n + "_" + Math.random().toString(36).slice(2, 6), false);
          ent.rootNodes[0].parent = holder;
          ent.rootNodes[0].getChildMeshes().forEach((m) => {
            m.isPickable = false;
            m.alwaysSelectAsActiveMesh = true;
          });
        } else {
          const cyl = BABYLON.MeshBuilder.CreateCylinder("arrow", { height: 0.55, diameter: 0.035 }, this.scene);
          cyl.rotation.x = Math.PI / 2;
          cyl.isPickable = false;
          cyl.parent = holder;
          cyl.material = this.arrowMats[team];
        }
        mesh = holder;
      }
      mesh.setEnabled(true);
      if (this.A.arrow) {
        const tm = this.arrowTeamMat(team);
        mesh.getChildMeshes().forEach((m) => {
          if (tm) m.material = tm;
        });
      }
      this.arrows.push({ mesh, x0, z0, x1, z1, t: 0, dur });
    }
    /** Battle cry: up to three different Souls from your army bellow in turn, and one from the enemy answers, a little lower. */
    battleRoar() {
      const b = this.battle;
      if (!b) return;
      const mine = /* @__PURE__ */ new Set(), theirs = /* @__PURE__ */ new Set();
      for (const f of b.fighters) (f.team === 0 ? mine : theirs).add(f.soul);
      [...mine].slice(0, 3).forEach((soul, i) => audio.bark(soul, 0.15 + 0.16 * i, 1));
      const e = [...theirs][0];
      if (e) audio.bark(e, 0.55, 0.82);
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
          if (f.state !== "attack" && f.alive && v.state !== "cheer") {
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
          try {
            this.lastGold = this.daily ? 0 : addGoldAndSave(isEndless() ? endlessWaveGold(s.wave) : waveGold(currentStageId, difficultyName));
            this.runGold += this.lastGold;
            window.dispatchEvent(new Event("necro-save-changed"));
          } catch {
            this.lastGold = 0;
          }
          if (isEndless() && this.endless) {
            try {
              const r = recordEndlessWaveAndSave(s.wave);
              this.endless.cleared = s.wave;
              window.dispatchEvent(new Event("necro-save-changed"));
              if (r.pack) {
                this.endless.packs++;
                this.toast("Wave " + s.wave + " cleared! You earned a Soul Pack (see the Shop).");
              }
            } catch {
            }
          }
          if (advanceWave(s)) {
            this.phase = "won";
            clearRun();
            try {
              if (this.daily) {
                this.dailyReward = recordDailyWinAndSave(this.daily.day);
                this.reward = null;
              } else this.reward = recordClearAndSave(currentStageId, difficultyName);
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
      if (kind !== "win") this.tweenCam(this.poses().necro, 1.1);
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
        audio.play("victory");
        for (const f of b.fighters) if (f.team === 0 && f.alive) {
          const v = this.fvis.get(f.id);
          if (v) this.later(Math.random() * 0.35, () => {
            v.play("cheer");
            audio.bark(f.soul);
          });
        }
        this.later(1.6, () => {
          this.tweenCam(this.poses().necro, 1.1);
          n.cast();
        });
        this.later(1.85, home);
        this.later(3.6, done);
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
      this.showGrid(true);
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
    /** 2x and 4x battle speed open once the campaign is finished (the last stage cleared on Normal). ?debug or ?speed=1 opens them for testing. */
    speedUnlocked() {
      const q = new URLSearchParams(location.search);
      return !!(q.get("debug") || q.get("speed")) || endlessUnlocked(loadSave());
    }
    setSpeed(k) {
      if (k > 1 && !this.speedUnlocked()) return;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2dhbWUvYXJlbmEudHMiLCAiLi4vY29yZS9iYXR0bGUudHMiLCAiLi4vY29yZS9lbmRsZXNzLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9kYWlseS50cyIsICIuLi9jb3JlL3BhY2tzLnRzIiwgIi4uL2NvcmUvc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvbmVjcm9tYW5jZXIudHMiLCAiLi4vZ2FtZS9hdWRpby50cyIsICIuLi9jb3JlL3J1bnNhdmUudHMiLCAiLi4vZ2FtZS92aXN1YWxzLnRzIiwgIi4uL3VpL2ljb25zLnRzIiwgIi4uL3VpL3BvcnRyYWl0cy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXTsgZ29sZFRvTGV2ZWw6IG51bWJlcltdIH07XG4gIHNpbTogeyBzZXBhcmF0aW9uOiBudW1iZXI7IGhpdEZyYWN0aW9uOiBudW1iZXI7IHRpbWVMaW1pdDogbnVtYmVyOyByZXRhcmdldEV2ZXJ5OiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRTOiBCYWxhbmNlID0ge1xuICBzdGF0czoge1xuICAgIHdhcnJpb3I6ICAgeyBocDogNjAsICBkbWc6IDgsICBpbnRlcnZhbDogMC45LCByYW5nZTogMC44NSwgc3BlZWQ6IDEuNCwgc2l6ZTogMC4yOCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjQ3IH0sXG4gICAgYXJjaGVyOiAgICB7IGhwOiA0MCwgIGRtZzogNywgIGludGVydmFsOiAxLjcsIHJhbmdlOiA1LjAsICBzcGVlZDogMS4xLCBzaXplOiAwLjI2LCBhbmltTGVuOiAxLjUsIGhpdEZyYWM6IDAuNzggfSxcbiAgICBnb2JsaW46ICAgIHsgaHA6IDQ1LCAgZG1nOiA5LCAgaW50ZXJ2YWw6IDAuOCwgcmFuZ2U6IDAuOCwgIHNwZWVkOiAxLjcsIHNpemU6IDAuMjQsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAga25pZ2h0OiAgICB7IGhwOiAxMzAsIGRtZzogOSwgIGludGVydmFsOiAxLjEsIHJhbmdlOiAwLjksICBzcGVlZDogMS4wLCBzaXplOiAwLjMyLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIG9ncmU6ICAgICAgeyBocDogMTcwLCBkbWc6IDE2LCBpbnRlcnZhbDogMS45LCByYW5nZTogMS4wNSwgc3BlZWQ6IDAuOCwgc2l6ZTogMC40MiwgYW5pbUxlbjogMS4yLCBoaXRGcmFjOiAwLjU1IH0sXG4gICAgYmFyYmFyaWFuOiB7IGhwOiA3NSwgIGRtZzogOCwgIGludGVydmFsOiAwLjk1LCByYW5nZTogMC45LCBzcGVlZDogMS41LCBzaXplOiAwLjMwLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICB9LFxuICAvLyBcImJvZGllcyA9IGRhbWFnZSwgc3RhcnMgPSBkdXJhYmlsaXR5XCI6IEhQIGdyb3dzIGZhc3RlciB0aGFuIGRhbWFnZSBwZXIgc3RhclxuICBzdGFyOiB7IGhwOiBbMSwgMi4wLCAzLjJdLCBkbWc6IFsxLCAxLjUsIDIuMF0sIHNjYWxlOiBbMSwgMS4xMiwgMS4yNV0gfSxcbiAgcGhhbGFueDogeyByYWRpdXM6IDIuMCwgcGVyQWxseTogMC4wOCwgbWF4U3RhY2tzOiAzIH0sXG4gIC8vIG1hbmEgZmlsbHMgZmFzdDogYSBiYXNpYyBhdHRhY2sgZ2l2ZXMgcGVyQXR0YWNrLCB0YWtpbmcgYSBoaXQgZ2l2ZXMgcGVySGl0OyBhIGZ1bGwgYmFyIGZpcmVzIHRoZSBza2lsbCBvbiB0aGUgbmV4dCBhdHRhY2ssIHRoZW4gcmVzZXRzXG4gIG1hbmE6IHtcbiAgICBhcmNoZXI6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMzQsIHBlckhpdDogNiB9LCAgICAgLy8gU3BsaXQgQXJyb3cgYWJvdXQgZXZlcnkgM3JkIHNob3RcbiAgICBvZ3JlOiAgIHsgbWF4OiAxMDAsIHBlckF0dGFjazogMzQsIHBlckhpdDogNiB9LCAgICAgLy8gU21hc2ggYWJvdXQgZXZlcnkgM3JkIHN3aW5nXG4gICAga25pZ2h0OiB7IG1heDogMTAwLCBwZXJBdHRhY2s6IDI1LCBwZXJIaXQ6IDEyIH0sICAgIC8vIFRhdW50IGV2ZXJ5IH40IHN3aW5ncywgc29vbmVyIHdoZW4gaGUgaXMgYmVpbmcgaGl0XG4gIH0sXG4gIHZvbGxleTogeyB0YXJnZXRzOiAzLCBwcm9qZWN0aWxlU3BlZWQ6IDE0IH0sXG4gIG9wcG9ydHVuaXN0OiB7IGJvbnVzOiAwLjUsIHNlZWtSYWRpdXM6IDQuMCwgd291bmRlZFdlaWdodDogMS41IH0sXG4gIHRhdW50OiB7IGR1cmF0aW9uOiAzLCByYWRpdXM6IDQuNSB9LFxuICBzbWFzaDogeyBtdWx0OiAyLjAsIHJhZGl1czogMS42IH0sXG4gIGZyZW56eTogeyBwZXJTd2luZzogMC4xMiwgbWF4U3RhY2tzOiA4LCByZXNldEFmdGVyOiAwLjYgfSxcbiAgbGV2ZWw6IHsgaHA6IDAuMDgsIGRtZzogMC4wOCwgY29waWVzVG9MZXZlbDogWzUsIDEwLCAyMCwgNDAsIDgwLCAxMjAsIDIwMCwgMzAwLCA1MDBdLCBnb2xkVG9MZXZlbDogWzYwMDAsIDEyMDAwLCAyNDAwMCwgNDgwMDAsIDk2MDAwLCAxNjgwMDAsIDI3MDAwMCwgNDIwMDAwLCA2NjAwMDBdIH0sXG4gIHNpbTogeyBzZXBhcmF0aW9uOiAwLjYsIGhpdEZyYWN0aW9uOiAwLjQ3LCB0aW1lTGltaXQ6IDEyMCwgcmV0YXJnZXRFdmVyeTogMC41IH0sXG59O1xuXG5leHBvcnQgY29uc3QgQkFMQU5DRTogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0QmFsYW5jZSgpOiB2b2lkIHtcbiAgY29uc3QgZnJlc2g6IEJhbGFuY2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSk7XG4gIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhmcmVzaCkgYXMgKGtleW9mIEJhbGFuY2UpW10pIChCQUxBTkNFIGFzIGFueSlba10gPSAoZnJlc2ggYXMgYW55KVtrXTtcbn1cblxuZXhwb3J0IGNvbnN0IFJPTEVfVEVYVDogUmVjb3JkPFNvdWxJZCwgc3RyaW5nPiA9IHtcbiAgd2FycmlvcjogJ0NoZWFwIGFuZCBmYXN0LiBUb3VnaGVyIG5lYXIgb3RoZXIgV2FycmlvcnMuJyxcbiAgYXJjaGVyOiAnRnJhZ2lsZS4gU2tpbGw6IFNwbGl0IEFycm93IGhpdHMgMyBkaWZmZXJlbnQgZW5lbWllcy4nLFxuICBnb2JsaW46ICdGYXN0LiBIaXRzIGhhcmRlciBvbiBlbmVtaWVzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZS4nLFxuICBrbmlnaHQ6ICdUYW5rLiBTa2lsbDogVGF1bnQgcHVsbHMgZW5lbWllcyBvbnRvIGhpbS4nLFxuICBvZ3JlOiAnU2xvdywgaHVnZSBkYW1hZ2UuIFNraWxsOiBTbWFzaCwgYSBiaWcgYXJlYSBzbGFtLicsXG4gIGJhcmJhcmlhbjogJ1N3aW5ncyBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIGhpdC4nLFxufTtcblxuZXhwb3J0IGNvbnN0IFNPVUxfTkFNRTogUmVjb3JkPFNvdWxJZCwgc3RyaW5nPiA9IHtcbiAgd2FycmlvcjogJ1NrZWxldG9uIFdhcnJpb3InLCBhcmNoZXI6ICdTa2VsZXRvbiBBcmNoZXInLCBnb2JsaW46ICdHb2JsaW4nLFxuICBrbmlnaHQ6ICdLbmlnaHQnLCBvZ3JlOiAnT2dyZScsIGJhcmJhcmlhbjogJ0JhcmJhcmlhbicsXG59O1xuXG4vKiogQWJpbGl0eSBibHVyYnMgZm9yIHRoZSBTb3VscyBwYWdlLCB3aXRoIHRoZSBsaXZlIG51bWJlcnMgZmlsbGVkIGluLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFiaWxpdHlJbmZvKHNvdWw6IFNvdWxJZCk6IHsga2luZDogJ3NraWxsJyB8ICdwYXNzaXZlJzsgbmFtZTogc3RyaW5nOyB0ZXh0OiBzdHJpbmcgfSB7XG4gIGNvbnN0IEIgPSBCQUxBTkNFLCBwY3QgPSAoeDogbnVtYmVyKSA9PiBNYXRoLnJvdW5kKHggKiAxMDApICsgJyUnO1xuICBzd2l0Y2ggKHNvdWwpIHtcbiAgICBjYXNlICd3YXJyaW9yJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnUGhhbGFueCcsIHRleHQ6IGBUYWtlcyAke3BjdChCLnBoYWxhbngucGVyQWxseSl9IGxlc3MgZGFtYWdlIGZvciBlYWNoIG90aGVyIFNrZWxldG9uIFdhcnJpb3Igd2l0aGluICR7Qi5waGFsYW54LnJhZGl1c31tICh1cCB0byAke0IucGhhbGFueC5tYXhTdGFja3N9KS5gIH07XG4gICAgY2FzZSAnZ29ibGluJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnT3Bwb3J0dW5pc3QnLCB0ZXh0OiBgRGVhbHMgJHtwY3QoQi5vcHBvcnR1bmlzdC5ib251cyl9IG1vcmUgZGFtYWdlIHRvIGFuIGVuZW15IHRoYXQgaXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLCBhbmQgcHJlZmVycyBzdWNoIHRhcmdldHMuYCB9O1xuICAgIGNhc2UgJ2JhcmJhcmlhbic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ0ZyZW56eScsIHRleHQ6IGBBdHRhY2tzICR7cGN0KEIuZnJlbnp5LnBlclN3aW5nKX0gZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBzd2luZyAodXAgdG8gJHtCLmZyZW56eS5tYXhTdGFja3N9IHRpbWVzKS5gIH07XG4gICAgY2FzZSAnYXJjaGVyJzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1NwbGl0IEFycm93JywgdGV4dDogYEJhc2ljIHNob3RzIGZpcmUgb25lIGFycm93LiBXaGVuIG1hbmEgaXMgZnVsbCwgdGhlIG5leHQgc2hvdCBmaXJlcyBhdCB1cCB0byAke0Iudm9sbGV5LnRhcmdldHN9IGRpZmZlcmVudCBlbmVtaWVzLmAgfTtcbiAgICBjYXNlICdrbmlnaHQnOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnVGF1bnQnLCB0ZXh0OiBgV2hlbiBtYW5hIGlzIGZ1bGwsIGVuZW1pZXMgd2l0aGluICR7Qi50YXVudC5yYWRpdXN9bSBtdXN0IGF0dGFjayBoaW0gZm9yICR7Qi50YXVudC5kdXJhdGlvbn1zLmAgfTtcbiAgICBjYXNlICdvZ3JlJzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1NtYXNoJywgdGV4dDogYFdoZW4gbWFuYSBpcyBmdWxsLCB0aGUgbmV4dCBzd2luZyBkZWFscyAke0Iuc21hc2gubXVsdH14IGRhbWFnZSBhbmQgaGl0cyBlbmVtaWVzIG5lYXIgdGhlIHRhcmdldCBmb3IgNjAlIGFzIG11Y2guYCB9O1xuICB9XG59XG4iLCAiLy8gRGVzaWduIGRhdGEgc3RyYWlnaHQgZnJvbSB0aGUgcGxhbiBkb2MuIEFueXRoaW5nIG1hcmtlZCBQTEFDRUhPTERFUiBpcyBub3QgaW4gdGhlIGRvYyB5ZXQuXG5cbmV4cG9ydCB0eXBlIFNvdWxJZCA9ICd3YXJyaW9yJyB8ICdhcmNoZXInIHwgJ2dvYmxpbicgfCAna25pZ2h0JyB8ICdvZ3JlJyB8ICdiYXJiYXJpYW4nO1xuXG5leHBvcnQgY29uc3QgU09VTFM6IFNvdWxJZFtdID0gWyd3YXJyaW9yJywgJ2FyY2hlcicsICdnb2JsaW4nLCAna25pZ2h0JywgJ29ncmUnLCAnYmFyYmFyaWFuJ107XG5cbi8qKiBEb21pbmlvbiBjb3N0IHBlciBzdGFyIGxldmVsOiBpbmRleCAwID0gMSBzdGFyLCAxID0gMiBzdGFycywgMiA9IDMgc3RhcnMgKDMgc3RhcnMgaXMgdGhlIG1heCkuICovXG5leHBvcnQgY29uc3QgQ09TVDogUmVjb3JkPFNvdWxJZCwgbnVtYmVyW10+ID0ge1xuICB3YXJyaW9yOiBbMiwgMywgNF0sXG4gIGFyY2hlcjogWzQsIDYsIDldLFxuICBnb2JsaW46IFszLCA0LCA2XSxcbiAga25pZ2h0OiBbNSwgNywgMTBdLFxuICBvZ3JlOiBbNywgMTAsIDE1XSxcbiAgYmFyYmFyaWFuOiBbNSwgNywgMTBdLCAvLyBQTEFDRUhPTERFUjogdGhlIGRvYyBoYXMgbm8gY29zdCBmb3IgdGhlIHNpeHRoIFNvdWwgeWV0XG59O1xuXG5leHBvcnQgY29uc3QgTUFYX1NUQVIgPSAzO1xuZXhwb3J0IGNvbnN0IEdSSURfQ0VMTFMgPSAxMjsgLy8gNCB4IDNcblxuLyoqIERvbWluaW9uIGNhcCBwZXIgd2F2ZSAoaW5kZXggMCA9IHdhdmUgMSkuICovXG5leHBvcnQgY29uc3QgQ1VSVkVTOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT4gPSB7XG4gIC8vIExPQ0tFRCAoY29uZmlybWVkKTogKzQgZm9yIHdhdmVzIDItNSwgdGhlbiArMyBmb3Igd2F2ZXMgNi0xMCAtPiA0MFxuICBkb2M6IFs5LCAxMywgMTcsIDIxLCAyNSwgMjgsIDMxLCAzNCwgMzcsIDQwXSxcbiAgLy8gTk9UIFVTRUQ6IG1pc3JlbWVtYmVyZWQgdmFyaWFudCAoKzMgdGhyb3VnaCB3YXZlIDYsIHRoZW4gKzIpIHRoYXQgb25seSByZWFjaGVzIDMyLiBLZXB0IGZvciBjb21wYXJpc29uIG9ubHkuXG4gIHJlY2FsbGVkOiBbOSwgMTIsIDE1LCAxOCwgMjEsIDI0LCAyNiwgMjgsIDMwLCAzMl0sXG59O1xuXG5leHBvcnQgY29uc3QgSEVBUlRTID0gMztcbmV4cG9ydCBjb25zdCBTVEFSVF9IQU5EID0gNDtcbmV4cG9ydCBjb25zdCBXQVZFUyA9IDEwO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJ1bGVzIHtcbiAgLyoqIERvbWluaW9uIGNhcCBwZXIgd2F2ZS4gKi9cbiAgY3VydmU6IG51bWJlcltdO1xuICAvKipcbiAgICogJ2RlcGxveWVkT25seSc6IG9ubHkgdHdvIGRlcGxveWVkIHVuaXRzIG9mIHRoZSBzYW1lIHN0YXIgY2FuIG1lcmdlIChkb2MgYXMgd3JpdHRlbikuXG4gICAqICdoYW5kSW50b09uZVN0YXInOiBhZGRpdGlvbmFsbHkgYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBiZSBwbGF5ZWQgb250byBhIGRlcGxveWVkXG4gICAqIDEtc3RhciB1bml0IG9mIHRoZSBzYW1lIFNvdWwgdG8gbWVyZ2UgaW1tZWRpYXRlbHkgKHBheXMgb25seSB0aGUgY29zdCBkaWZmZXJlbmNlKS5cbiAgICovXG4gIG1lcmdlOiAnZGVwbG95ZWRPbmx5JyB8ICdoYW5kSW50b09uZVN0YXInO1xuICAvKiogQ2FyZC1pbmZsb3cga25vYnMgKGFsbCBvcHRpb25hbDsgZGVmYXVsdHMgcmVwcm9kdWNlIHRoZSBkb2MpLiAqL1xuICBzdGFydEhhbmQ/OiBudW1iZXI7ICAgICAgICAgICAgLy8gZGVmYXVsdCA0XG4gIGRyYWZ0UGlja3M/OiBudW1iZXI7ICAgICAgICAgICAvLyBjYXJkcyBrZXB0IGZyb20gdGhlIDMtY2FyZCBWaWN0b3J5IERyYWZ0LCBkZWZhdWx0IDFcbiAgbm9ybWFsRHJhd1dhdmVzPzogbnVtYmVyW107ICAgIC8vIHdhdmVzIChiZWluZyBlbnRlcmVkKSB0aGF0IGFsc28gZ2l2ZSB0aGUgbm9ybWFsIHJhbmRvbSBkcmF3OyBkZWZhdWx0ID0gYWxsXG4gIC8qKiBTb3VscyB0aGlzIHJ1biBtYXkgZHJhdyBmcm9tICh0aGUgZXF1aXBwZWQgU291bCBEZWNrLCBtYXggNikuIERlZmF1bHQ6IGV2ZXJ5IFNvdWwuICovXG4gIHBvb2w/OiBTb3VsSWRbXTtcbiAgc3RhZ2VXYXZlcz86IG51bWJlcjsgICAgICAgICAgIC8vIHdhdmVzIGluIHRoaXMgc3RhZ2U7IGRlZmF1bHQgMTAgKHRoZSBwbGF5YWJsZSBwcm90b3R5cGUgdXNlcyAzKVxufVxuXG5leHBvcnQgY29uc3QgR1JJRF9DT0xTID0gNCwgR1JJRF9ST1dTID0gMzsgICAvLyA0IHggMyA9IEdSSURfQ0VMTFM7IGNvbHVtbiBHUklEX0NPTFMtMSBpcyB0aGUgZnJvbnQgbGluZVxuIiwgIi8vIFNtYWxsIHNlZWRlZCBSTkcgKG11bGJlcnJ5MzIpLiBTYW1lIHNlZWQgLT4gc2FtZSBydW4sIHNvIGFueSBidWcgcmVwb3J0IGlzIHJlcHJvZHVjaWJsZS5cbi8vIGBzdGF0ZSgpYCAvIHRoZSBgcmVzdW1lYCBhcmd1bWVudCBsZXQgYSBzYXZlZCBydW4gY29udGludWUgZHJhd2luZyBleGFjdGx5IHRoZSBjYXJkcyBpdCB3b3VsZCBoYXZlIGRyYXduLlxuXG5leHBvcnQgaW50ZXJmYWNlIFJuZyB7XG4gIG5leHQoKTogbnVtYmVyOyAgICAgICAgICAgICAgLy8gWzAsIDEpXG4gIGludChuOiBudW1iZXIpOiBudW1iZXI7ICAgICAgLy8gWzAsIG4pXG4gIHBpY2s8VD4oaXRlbXM6IHJlYWRvbmx5IFRbXSk6IFQ7XG4gIHNlZWQ6IG51bWJlcjtcbiAgc3RhdGUoKTogbnVtYmVyOyAgICAgICAgICAgICAvLyB0aGUgZ2VuZXJhdG9yJ3MgY3VycmVudCBwb3NpdGlvbiwgZm9yIHNhdmluZyBhIHJ1blxufVxuXG5leHBvcnQgZnVuY3Rpb24gbWFrZVJuZyhzZWVkOiBudW1iZXIsIHJlc3VtZT86IG51bWJlcik6IFJuZyB7XG4gIGxldCBhID0gKHJlc3VtZSA/PyBzZWVkKSA+Pj4gMDtcbiAgY29uc3QgbmV4dCA9ICgpID0+IHtcbiAgICBhID0gKGEgKyAweDZkMmI3OWY1KSA+Pj4gMDtcbiAgICBsZXQgdCA9IGE7XG4gICAgdCA9IE1hdGguaW11bCh0IF4gKHQgPj4+IDE1KSwgdCB8IDEpO1xuICAgIHQgXj0gdCArIE1hdGguaW11bCh0IF4gKHQgPj4+IDcpLCB0IHwgNjEpO1xuICAgIHJldHVybiAoKHQgXiAodCA+Pj4gMTQpKSA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xuICB9O1xuICByZXR1cm4ge1xuICAgIHNlZWQsXG4gICAgbmV4dCxcbiAgICBpbnQ6IChuKSA9PiBNYXRoLmZsb29yKG5leHQoKSAqIG4pLFxuICAgIHBpY2s6IChpdGVtcykgPT4gaXRlbXNbTWF0aC5mbG9vcihuZXh0KCkgKiBpdGVtcy5sZW5ndGgpXSxcbiAgICBzdGF0ZTogKCkgPT4gYSxcbiAgfTtcbn1cbiIsICIvLyBQdXJlIGdhbWUgcnVsZXMgZm9yIG9uZSBzdGFnZS4gTm8gZ3JhcGhpY3MsIG5vIGNvbWJhdDoganVzdCBjYXJkcywgRG9taW5pb24sIGdyaWQsIG1lcmdlLCB3YXZlcywgaGVhcnRzLlxuLy8gRXZlcnkgbXV0YXRpb24gZ29lcyB0aHJvdWdoIGEgZnVuY3Rpb24gaGVyZSBhbmQgYXBwZW5kcyB0byBzdGF0ZS5sb2csIHNvIHJ1bnMgY2FuIGJlIHJlcGxheWVkIGFuZCBpbnNwZWN0ZWQuXG5cbmltcG9ydCB7IENPU1QsIEdSSURfQ0VMTFMsIEhFQVJUUywgTUFYX1NUQVIsIFNPVUxTLCBTVEFSVF9IQU5ELCBXQVZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzLCBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXQgeyBpZDogbnVtYmVyOyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyOyBmcmVzaD86IGJvb2xlYW4gfSAgIC8vIGZyZXNoID0gc3VtbW9uZWQgdGhpcyBidWlsZCBwaGFzZVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0YXRlIHtcbiAgcnVsZXM6IFJ1bGVzO1xuICBybmc6IFJuZztcbiAgd2F2ZTogbnVtYmVyOyAgICAgICAgICAgICAgICAgLy8gMS1iYXNlZFxuICBoZWFydHM6IG51bWJlcjtcbiAgY2FwOiBudW1iZXI7XG4gIGhhbmQ6IFNvdWxJZFtdO1xuICB1bml0czogVW5pdFtdO1xuICBuZXh0SWQ6IG51bWJlcjtcbiAgZGlzY2FyZFVzZWQ6IGJvb2xlYW47ICAgICAgICAgLy8gb25jZS1wZXItYnVpbGQtcGhhc2UgcmVkcmF3XG4gIHN0YXR1czogJ2J1aWxkaW5nJyB8ICd3b24nIHwgJ2xvc3QnO1xuICBsb2c6IHN0cmluZ1tdO1xuICBzdGF0czogeyBkcmF3bjogbnVtYmVyOyBkaXNjYXJkZWQ6IG51bWJlcjsgZGlzbWlzc2VkOiBudW1iZXI7IG1lcmdlczogbnVtYmVyOyBmYWlsdXJlczogbnVtYmVyIH07XG59XG5cbmV4cG9ydCBjb25zdCBjb3N0ID0gKHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyKTogbnVtYmVyID0+IENPU1Rbc291bF1bc3RhciAtIDFdO1xuZXhwb3J0IGNvbnN0IGNhcmRzSW4gPSAoc3RhcjogbnVtYmVyKTogbnVtYmVyID0+IDIgKiogKHN0YXIgLSAxKTsgICAgIC8vIGNhcmRzIGEgdW5pdCBpcyBcIndvcnRoXCJcbmV4cG9ydCBjb25zdCBkb21pbmlvblVzZWQgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy51bml0cy5yZWR1Y2UoKG4sIHUpID0+IG4gKyBjb3N0KHUuc291bCwgdS5zdGFyKSwgMCk7XG5leHBvcnQgY29uc3QgZG9taW5pb25GcmVlID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMuY2FwIC0gZG9taW5pb25Vc2VkKHMpO1xuXG5mdW5jdGlvbiBsb2coczogU3RhdGUsIG1zZzogc3RyaW5nKSB7IHMubG9nLnB1c2goYFt3JHtzLndhdmV9XSAke21zZ31gKTsgfVxuLyoqIFRoZSBTb3VscyB0aGlzIHJ1biBkcmF3cyBmcm9tOiB0aGUgZXF1aXBwZWQgZGVjaywgb3IgZXZlcnl0aGluZyBpZiBubyBkZWNrIHdhcyBnaXZlbi4gKi9cbmV4cG9ydCBjb25zdCBwb29sT2YgPSAoczogU3RhdGUpOiBTb3VsSWRbXSA9PiAocy5ydWxlcy5wb29sICYmIHMucnVsZXMucG9vbC5sZW5ndGggPyBzLnJ1bGVzLnBvb2wgOiBTT1VMUyk7XG5mdW5jdGlvbiBkcmF3KHM6IFN0YXRlLCB3aHk6IHN0cmluZywgbm90PzogU291bElkKTogU291bElkIHtcbiAgY29uc3QgYWxsID0gcG9vbE9mKHMpLCBvdGhlcnMgPSBub3QgPyBhbGwuZmlsdGVyKCh4KSA9PiB4ICE9PSBub3QpIDogYWxsO1xuICBjb25zdCBwb29sID0gb3RoZXJzLmxlbmd0aCA/IG90aGVycyA6IGFsbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgc3dhcCBuZXZlciBoYW5kcyB5b3UgYmFjayB0aGUgU291bCB5b3UgZ2F2ZSB1cCAodW5sZXNzIGl0IGlzIHRoZSBvbmx5IG9uZSBlcXVpcHBlZClcbiAgY29uc3QgYyA9IHMucm5nLnBpY2socG9vbCk7XG4gIHMuaGFuZC5wdXNoKGMpOyBzLnN0YXRzLmRyYXduKys7XG4gIGxvZyhzLCBgZHJhdyAke2N9ICgke3doeX0pYCk7XG4gIHJldHVybiBjO1xufVxuXG4vKiogQSBuZXcgYnVpbGQgcGhhc2UgYmVnaW5zOiB0aGUgb25jZS1wZXItcGhhc2Ugc3dhcCBjb21lcyBiYWNrIGFuZCBub3RoaW5nIGNvdW50cyBhcyBcInN1bW1vbmVkIHRoaXMgcm91bmRcIi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuZXdQaGFzZShzOiBTdGF0ZSk6IHZvaWQge1xuICBzLmRpc2NhcmRVc2VkID0gZmFsc2U7XG4gIGZvciAoY29uc3QgdSBvZiBzLnVuaXRzKSB1LmZyZXNoID0gZmFsc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBuZXdTdGFnZShydWxlczogUnVsZXMsIHNlZWQ6IG51bWJlcik6IFN0YXRlIHtcbiAgY29uc3QgczogU3RhdGUgPSB7XG4gICAgcnVsZXMsIHJuZzogbWFrZVJuZyhzZWVkKSwgd2F2ZTogMSwgaGVhcnRzOiBIRUFSVFMsIGNhcDogcnVsZXMuY3VydmVbMF0sIGhhbmQ6IFtdLCB1bml0czogW10sIG5leHRJZDogMSxcbiAgICBkaXNjYXJkVXNlZDogZmFsc2UsIHN0YXR1czogJ2J1aWxkaW5nJywgbG9nOiBbXSxcbiAgICBzdGF0czogeyBkcmF3bjogMCwgZGlzY2FyZGVkOiAwLCBkaXNtaXNzZWQ6IDAsIG1lcmdlczogMCwgZmFpbHVyZXM6IDAgfSxcbiAgfTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAocnVsZXMuc3RhcnRIYW5kID8/IFNUQVJUX0hBTkQpOyBpKyspIGRyYXcocywgJ3N0YXJ0aW5nIGhhbmQnKTtcbiAgcmV0dXJuIHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmcmVlQ2VsbChzOiBTdGF0ZSk6IG51bWJlciB7XG4gIGNvbnN0IHRha2VuID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoIXRha2VuLmhhcyhjKSkgcmV0dXJuIGM7XG4gIHJldHVybiAtMTtcbn1cblxuLy8gLS0tLSBidWlsZC1waGFzZSBhY3Rpb25zIChlYWNoIHJldHVybnMgdHJ1ZSB3aGVuIGl0IGhhcHBlbmVkKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF07XG4gIHJldHVybiBzb3VsICE9PSB1bmRlZmluZWQgJiYgZnJlZUNlbGwocykgPj0gMCAmJiBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNlbGxGcmVlKHM6IFN0YXRlLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgcmV0dXJuIGNlbGwgPj0gMCAmJiBjZWxsIDwgR1JJRF9DRUxMUyAmJiAhcy51bml0cy5zb21lKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpO1xufVxuXG4vKiogU3VtbW9uIGEgaGFuZCBjYXJkIG9udG8gYSBzcGVjaWZpYyBmcmVlIGNlbGwgKGRlZmF1bHQ6IHRoZSBmaXJzdCBmcmVlIG9uZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIGNlbGw/OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5TdW1tb24ocywgaGFuZElkeCkpIHJldHVybiBmYWxzZTtcbiAgaWYgKGNlbGwgIT09IHVuZGVmaW5lZCAmJiAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHU6IFVuaXQgPSB7IGlkOiBzLm5leHRJZCsrLCBzb3VsLCBzdGFyOiAxLCBjZWxsOiBjZWxsID8/IGZyZWVDZWxsKHMpLCBmcmVzaDogdHJ1ZSB9O1xuICBzLnVuaXRzLnB1c2godSk7XG4gIGxvZyhzLCBgc3VtbW9uICR7c291bH0gMSogLT4gY2VsbCAke3UuY2VsbH0gIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VEZXBsb3llZChhOiBVbml0LCBiOiBVbml0KTogYm9vbGVhbiB7XG4gIHJldHVybiBhLmlkICE9PSBiLmlkICYmIGEuc291bCA9PT0gYi5zb3VsICYmIGEuc3RhciA9PT0gYi5zdGFyICYmIGEuc3RhciA8IE1BWF9TVEFSO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VEZXBsb3llZChzOiBTdGF0ZSwgYUlkOiBudW1iZXIsIGJJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGFJZCksIGIgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGJJZCk7XG4gIGlmICghYSB8fCAhYiB8fCAhY2FuTWVyZ2VEZXBsb3llZChhLCBiKSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHUpID0+IHUuaWQgIT09IGIuaWQpO1xuICBhLmZyZXNoID0gISEoYS5mcmVzaCB8fCBiLmZyZXNoKTtcbiAgYS5zdGFyKys7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UgJHthLnNvdWx9ICR7YS5zdGFyIC0gMX0qKyR7YS5zdGFyIC0gMX0qIC0+ICR7YS5zdGFyfSogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0sIGNlbGxzICR7cy51bml0cy5sZW5ndGh9LyR7R1JJRF9DRUxMU30pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogJ2hhbmRJbnRvT25lU3RhcicgcnVsZTogcGxheSBhIDEtc3RhciBjYXJkIG9udG8gYSBkZXBsb3llZCAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMucnVsZXMubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF0sIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghc291bCB8fCAhdSB8fCB1LnNvdWwgIT09IHNvdWwgfHwgdS5zdGFyICE9PSAxKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBjb3N0KHNvdWwsIDIpIC0gY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuTWVyZ2VGcm9tSGFuZChzLCBoYW5kSWR4LCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgdS5zdGFyID0gMjtcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZS1mcm9tLWhhbmQgJHtzb3VsfSAtPiAke3Uuc291bH0gMiogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGlzbWlzcyhzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1KSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYGRpc21pc3MgJHt1LnNvdWx9ICR7dS5zdGFyfSogKHBlcm1hbmVudGx5IHJlbW92ZWQpYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMTogZGlzY2FyZCBhIGhhbmQgY2FyZCBhbmQgZHJhdyBhIHJhbmRvbSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzY2FyZFJlZHJhdyhzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLmRpc2NhcmRVc2VkIHx8IGhhbmRJZHggPCAwIHx8IGhhbmRJZHggPj0gcy5oYW5kLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzY2FyZGVkKys7XG4gIGxvZyhzLCBgc3dhcDogZGlzY2FyZCAke2N9YCk7XG4gIGRyYXcocywgJ3N3YXAnLCBjKTtcbiAgcmV0dXJuIHRydWU7XG59XG5leHBvcnQgY29uc3Qgc3dhcERpc2NhcmQgPSBkaXNjYXJkUmVkcmF3O1xuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIHJldHVybiAhcy5kaXNjYXJkVXNlZCAmJiAhIXUgJiYgIXUuZnJlc2g7ICAgICAgICAgIC8vIGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kXG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAyOiBzZWxsIGEgZGVwbG95ZWQgdW5pdCAobm90IG9uZSBzdW1tb25lZCB0aGlzIHJvdW5kKSBhbmQgZHJhdyBhIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzd2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5Td2FwU2VsbChzLCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgc3dhcDogc2VsbCAke3Uuc291bH0gJHt1LnN0YXJ9KmApO1xuICBkcmF3KHMsICdzd2FwJywgdS5zb3VsKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtb3ZlVW5pdChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUgfHwgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGxvZyhzLCBgbW92ZSAke3Uuc291bH0gY2VsbCAke3UuY2VsbH0gLT4gJHtjZWxsfWApOyB1LmNlbGwgPSBjZWxsOyByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gLS0tLSB3YXZlIHJlc3VsdHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRHJhZnQgY2hvaWNlcyBmb3IgYWZ0ZXIgYSBjbGVhcmVkIHdhdmU6IDMgcmFuZG9tIGNhcmRzLCBkdXBsaWNhdGVzIGFsbG93ZWQuICovXG5leHBvcnQgZnVuY3Rpb24gZHJhZnRPcHRpb25zKHM6IFN0YXRlKTogU291bElkW10ge1xuICBjb25zdCBwID0gcG9vbE9mKHMpO1xuICByZXR1cm4gW3Mucm5nLnBpY2socCksIHMucm5nLnBpY2socCksIHMucm5nLnBpY2socCldO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkOiByYWlzZSB0aGUgY2FwLCByZXNvbHZlIHRoZSBWaWN0b3J5IERyYWZ0LCBkcmF3IDEgbm9ybWFsIGNhcmQuICovXG5leHBvcnQgY29uc3Qgc3RhZ2VXYXZlcyA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnJ1bGVzLnN0YWdlV2F2ZXMgPz8gV0FWRVM7XG5cbi8qKiBTdGVwIDEgb2YgYSBjbGVhcmVkIHdhdmU6IGlzIHRoZSBzdGFnZSBvdmVyPyBJZiBub3QsIHJhaXNlIHRoZSBjYXAgYW5kIHN0YXJ0IHRoZSBuZXh0IGJ1aWxkIHBoYXNlLiBSZXR1cm5zIHRydWUgd2hlbiB0aGUgc3RhZ2UgaXMgd29uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2VXYXZlKHM6IFN0YXRlKTogYm9vbGVhbiB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuIHMuc3RhdHVzID09PSAnd29uJztcbiAgaWYgKHMud2F2ZSA+PSBzdGFnZVdhdmVzKHMpKSB7IHMuc3RhdHVzID0gJ3dvbic7IGxvZyhzLCAnc3RhZ2UgY2xlYXJlZCcpOyByZXR1cm4gdHJ1ZTsgfVxuICBzLndhdmUrKztcbiAgcy5jYXAgPSBzLnJ1bGVzLmN1cnZlW3Mud2F2ZSAtIDFdO1xuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGB3YXZlIGNsZWFyZWQgLT4gY2FwICR7cy5jYXB9YCk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFN0ZXAgMjogdGhlIHBsYXllciBrZXB0IGBpZHhgIGZyb20gdGhlIG9mZmVyZWQgZHJhZnQgY2FyZHMuICovXG5leHBvcnQgZnVuY3Rpb24gdGFrZURyYWZ0KHM6IFN0YXRlLCBvcHRzOiBTb3VsSWRbXSwgaWR4OiBudW1iZXIpOiB2b2lkIHtcbiAgY29uc3QgcGljayA9IG9wdHNbTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBpZHgpKV07XG4gIHMuaGFuZC5wdXNoKHBpY2spOyBzLnN0YXRzLmRyYXduKys7XG4gIGxvZyhzLCBgZHJhZnQgWyR7b3B0cy5qb2luKCcsICcpfV0gLT4gdG9vayAke3BpY2t9YCk7XG59XG5cbi8qKiBTdGVwIDM6IHRoZSBib251cyBub3JtYWwgZHJhdyAob25seSBvbiB0aGUgd2F2ZXMgdGhlIHJ1bGVzIGFsbG93KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxEcmF3KHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcyA/IHMucnVsZXMubm9ybWFsRHJhd1dhdmVzLmluY2x1ZGVzKHMud2F2ZSkgOiB0cnVlKSBkcmF3KHMsICd3YXZlIGNsZWFyJyk7XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQgKGFsbCB0aHJlZSBzdGVwcyBpbiBvbmUgY2FsbCwgZm9yIHNpbXVsYXRpb25zKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhcldhdmUoczogU3RhdGUsIGNob29zZTogKG9wdHM6IFNvdWxJZFtdKSA9PiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKGFkdmFuY2VXYXZlKHMpKSByZXR1cm47XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBsZXQgb3B0cyA9IGRyYWZ0T3B0aW9ucyhzKTtcbiAgY29uc3Qgb2ZmZXJlZCA9IG9wdHMuam9pbignLCAnKTtcbiAgY29uc3QgdG9vazogU291bElkW10gPSBbXTtcbiAgZm9yIChsZXQgcCA9IDA7IHAgPCAocy5ydWxlcy5kcmFmdFBpY2tzID8/IDEpOyBwKyspIHtcbiAgICBjb25zdCBpZHggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGNob29zZShvcHRzKSkpO1xuICAgIHRvb2sucHVzaChvcHRzW2lkeF0pOyBzLmhhbmQucHVzaChvcHRzW2lkeF0pOyBzLnN0YXRzLmRyYXduKys7XG4gICAgb3B0cyA9IG9wdHMuZmlsdGVyKChfLCBpKSA9PiBpICE9PSBpZHgpO1xuICB9XG4gIGxvZyhzLCBgZHJhZnQgWyR7b2ZmZXJlZH1dIC0+IHRvb2sgJHt0b29rLmpvaW4oJywgJyl9YCk7XG4gIG5vcm1hbERyYXcocyk7XG59XG5cbi8qKiBBcm15IHdpcGVkOiBsb3NlIGEgaGVhcnQsIGNhcCBkb2VzIE5PVCByaXNlLCBlbmVtaWVzIHJlc2V0LCArMSBjYXJkLCByZWRyYXcgYWxsb3dlZCBhZ2Fpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmYWlsV2F2ZShzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgcy5oZWFydHMtLTsgcy5zdGF0cy5mYWlsdXJlcysrO1xuICBpZiAocy5oZWFydHMgPD0gMCkgeyBzLnN0YXR1cyA9ICdsb3N0JzsgbG9nKHMsICdubyBoZWFydHMgbGVmdDogc3RhZ2UgbG9zdCcpOyByZXR1cm47IH1cbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgYXJteSB3aXBlZDogaGVhcnRzICR7cy5oZWFydHN9LCBjYXAgc3RheXMgJHtzLmNhcH1gKTtcbiAgZHJhdyhzLCAnZmFpbGVkIGF0dGVtcHQnKTtcbn1cblxuLy8gLS0tLSBpbnZhcmlhbnRzIChjYWxsZWQgYnkgdGhlIHNpbXVsYXRvciBhZnRlciBldmVyeSB3YXZlOyB0aHJvdyB3aXRoIGEgcmVhZGFibGUgbWVzc2FnZSkgLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2hlY2tJbnZhcmlhbnRzKHM6IFN0YXRlKTogdm9pZCB7XG4gIGNvbnN0IGZhaWwgPSAobTogc3RyaW5nKSA9PiB7IHRocm93IG5ldyBFcnJvcihgSU5WQVJJQU5UICR7bX1cXG5gICsgcy5sb2cuc2xpY2UoLTEyKS5qb2luKCdcXG4nKSk7IH07XG4gIGlmIChzLnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIGZhaWwoYG1vcmUgdW5pdHMgKCR7cy51bml0cy5sZW5ndGh9KSB0aGFuIGNlbGxzYCk7XG4gIGNvbnN0IGNlbGxzID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGlmIChjZWxscy5zaXplICE9PSBzLnVuaXRzLmxlbmd0aCkgZmFpbCgndHdvIHVuaXRzIHNoYXJlIGEgY2VsbCcpO1xuICBpZiAoZG9taW5pb25Vc2VkKHMpID4gcy5jYXApIGZhaWwoYGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfSBleGNlZWRzIGNhcCAke3MuY2FwfWApO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgaWYgKHUuc3RhciA8IDEgfHwgdS5zdGFyID4gTUFYX1NUQVIpIGZhaWwoYHVuaXQgc3RhciAke3Uuc3Rhcn0gb3V0IG9mIHJhbmdlYCk7XG4gIC8vIGV2ZXJ5IGRyYXduIGNhcmQgaXMgZWl0aGVyIGluIGhhbmQsIHdvcnRoIGNhcmRzIG9uIHRoZSBmaWVsZCwgZGlzY2FyZGVkLCBvciBkaXNtaXNzZWRcbiAgY29uc3Qgb25GaWVsZCA9IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY2FyZHNJbih1LnN0YXIpLCAwKTtcbiAgY29uc3QgYWNjb3VudGVkID0gcy5oYW5kLmxlbmd0aCArIG9uRmllbGQgKyBzLnN0YXRzLmRpc2NhcmRlZCArIHMuc3RhdHMuZGlzbWlzc2VkO1xuICBpZiAoYWNjb3VudGVkICE9PSBzLnN0YXRzLmRyYXduKSBmYWlsKGBjYXJkIGNvbnNlcnZhdGlvbjogZHJhd24gJHtzLnN0YXRzLmRyYXdufSAhPSBhY2NvdW50ZWQgJHthY2NvdW50ZWR9YCk7XG59XG4iLCAiLy8gVGhlIGJhdHRsZWZpZWxkJ3MgbG9vazogYSB0aWxlZCBjcnlwdCBmbG9vciwgYSBnbG93aW5nIHJ1bmUgY2lyY2xlIGluIHRoZSBtaWRkbGUsIGFuZCBhIGRhcmsgbWlzdHkgc3Vycm91bmQuIFB1cmUgZGVjb3JhdGlvbiAobm8gZ2FtZSBydWxlcykuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuY29uc3QgVElMRV9NRVRSRVMgPSA1OyAgICAvLyBvbmUgcmVwZWF0IG9mIHRoZSBmbG9vciBwaWN0dXJlIGNvdmVycyB0aGlzIG1hbnkgbWV0cmVzLCBzbyBzbGFicyBjb21lIG91dCBhYm91dCBhIG1ldHJlIHdpZGVcblxuLyoqIERyYXcgdGhlIHJ1bmUgY2lyY2xlIG9uY2Ugb250byBhIGNhbnZhczsgaXQgYmVjb21lcyBhIHNlZS10aHJvdWdoIGRlY2FsIG9uIHRoZSBmbG9vci4gKi9cbmZ1bmN0aW9uIHJ1bmVUZXh0dXJlKHNjZW5lOiBhbnkpOiBhbnkge1xuICBjb25zdCBTID0gNTEyLCB0ZXggPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgncnVuZXMnLCB7IHdpZHRoOiBTLCBoZWlnaHQ6IFMgfSwgc2NlbmUsIHRydWUpLCBjID0gdGV4LmdldENvbnRleHQoKTtcbiAgYy5jbGVhclJlY3QoMCwgMCwgUywgUyk7IGMudHJhbnNsYXRlKFMgLyAyLCBTIC8gMik7IGMubGluZUNhcCA9ICdyb3VuZCc7IGMubGluZUpvaW4gPSAncm91bmQnO1xuICBjb25zdCByaW5nID0gKHI6IG51bWJlciwgdzogbnVtYmVyLCBhOiBudW1iZXIpID0+IHsgYy5iZWdpblBhdGgoKTsgYy5hcmMoMCwgMCwgciwgMCwgTWF0aC5QSSAqIDIpOyBjLmxpbmVXaWR0aCA9IHc7IGMuc3Ryb2tlU3R5bGUgPSBgcmdiYSg0NywyMTcsMTY2LCR7YX0pYDsgYy5zdHJva2UoKTsgfTtcbiAgYy5zaGFkb3dDb2xvciA9ICdyZ2JhKDQ3LDIxNywxNjYsMC45KSc7IGMuc2hhZG93Qmx1ciA9IDEwO1xuICByaW5nKDIzNiwgNCwgMC43NSk7IHJpbmcoMjE0LCAyLCAwLjUpOyByaW5nKDEyMCwgMywgMC43KTtcbiAgYy5zdHJva2VTdHlsZSA9ICdyZ2JhKDQ3LDIxNywxNjYsMC43KSc7IGMubGluZVdpZHRoID0gMztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0OyBpKyspIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZvdXIgbG9uZyBzcGlrZXMsIGxpa2UgYSBjb21wYXNzXG4gICAgYy5zYXZlKCk7IGMucm90YXRlKChpICogTWF0aC5QSSkgLyAyICsgTWF0aC5QSSAvIDQpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMzApOyBjLmxpbmVUbygwLCAtMjMwKTsgYy5zdHJva2UoKTtcbiAgICBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygtMTQsIC0xMjApOyBjLmxpbmVUbygwLCAtMTYwKTsgYy5saW5lVG8oMTQsIC0xMjApOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTtcbiAgfVxuICBjLmxpbmVXaWR0aCA9IDI7IGMuc3Ryb2tlU3R5bGUgPSAncmdiYSg0NywyMTcsMTY2LDAuNTUpJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMjsgaSsrKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNtYWxsIHRpY2sgbWFya3MgYmV0d2VlbiB0aGUgdHdvIG91dGVyIHJpbmdzXG4gICAgYy5zYXZlKCk7IGMucm90YXRlKChpICogTWF0aC5QSSkgLyA2KTsgYy5iZWdpblBhdGgoKTsgYy5tb3ZlVG8oMCwgLTIxNCk7IGMubGluZVRvKDAsIC0yMzYpOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTtcbiAgfVxuICB0ZXgudXBkYXRlKCk7IHRleC5oYXNBbHBoYSA9IHRydWU7IHJldHVybiB0ZXg7XG59XG5cbmludGVyZmFjZSBQbGFjZW1lbnQgeyBwcm9wOiBzdHJpbmc7IHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc/OiBudW1iZXI7IHM/OiBudW1iZXIgfVxuLyoqIFdoZXJlIHRoZSBwcm9wcyBzdGFuZC4gVGFsbCB0aGluZ3MgZ28gYmVoaW5kIGFuZCBiZXNpZGUgdGhlIGZpZWxkOyBvbmx5IGxvdyB0aGluZ3MgKGZlbmNlLCBib25lcywgd2FsbCkgc3RhbmQgYmV0d2VlbiB0aGUgY2FtZXJhIGFuZCB0aGUgdW5pdHMuICovXG5jb25zdCBDUllQVF9MQVlPVVQ6IFBsYWNlbWVudFtdID0gW1xuICB7IHByb3A6ICdhcmNoJywgeDogLTYuNSwgejogNi40IH0sIHsgcHJvcDogJ2FyY2gnLCB4OiAwLCB6OiA2LjksIHM6IDEuMTUgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDYuNSwgejogNi40IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMC4yLCB6OiA1LjYsIHlhdzogMC40IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0zLjIsIHo6IDUuOSwgeWF3OiAyLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMy4zLCB6OiA1LjgsIHlhdzogNC4wIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDEwLjIsIHo6IDUuNiwgeWF3OiAxLjIgfSxcbiAgeyBwcm9wOiAnYnJhemllcicsIHg6IC00LjYsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogNC42LCB6OiA1LjIgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IC0xMC41LCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDEwLjUsIHo6IDAuOCB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTguNiwgejogNi4wLCB5YXc6IDAuMSB9LCB7IHByb3A6ICd3YWxsJywgeDogOC42LCB6OiA2LjAsIHlhdzogLTAuMSB9LCB7IHByb3A6ICd3YWxsJywgeDogLTExLjQsIHo6IC0yLjYsIHlhdzogMS40IH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAxMS40LCB6OiAtMi42LCB5YXc6IDEuNyB9LFxuICB7IHByb3A6ICdmZW5jZScsIHg6IC04LjAsIHo6IC00LjYgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNi43LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogNi43LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogOC4wLCB6OiAtNC42IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogLTMuNSwgejogLTQuNCwgeWF3OiAwLjcsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDQuMiwgejogLTQuNiwgeWF3OiAyLjUsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDkuNCwgejogMy4yLCB5YXc6IDEuMCwgczogMC42IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuNiwgejogLTMuNCwgeWF3OiAzLjYsIHM6IDAuNiB9LFxuXTtcbmNvbnN0IEdSQVZFWUFSRF9MQVlPVVQ6IFBsYWNlbWVudFtdID0gWyAgICAgIC8vIGZld2VyIGFyY2hlcywgYSBicm9rZW4gcm93IG9mIGdyYXZlc3RvbmUgcGlsbGFycywgYm9uZXMgZXZlcnl3aGVyZVxuICB7IHByb3A6ICdhcmNoJywgeDogLTkuNSwgejogNi40IH0sIHsgcHJvcDogJ2FyY2gnLCB4OiA5LjUsIHo6IDYuNCB9LFxuICB7IHByb3A6ICdwaWxsYXInLCB4OiAtMTEsIHo6IDUuMiwgeWF3OiAwLjQsIHM6IDAuOSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAtNy42LCB6OiA2LjMsIHlhdzogMi4xIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC00LjQsIHo6IDUuNiwgeWF3OiA0LjAsIHM6IDAuOCB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAtMS4yLCB6OiA2LjUsIHlhdzogMS4yIH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IDIuMiwgejogNS43LCB5YXc6IDMuMSwgczogMC45IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDUuNSwgejogNi40LCB5YXc6IDUuMCB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiA4LjIsIHo6IDUuNSwgeWF3OiAwLjksIHM6IDAuODUgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTEsIHo6IDUuMCwgeWF3OiAyLjYgfSxcbiAgeyBwcm9wOiAnYnJhemllcicsIHg6IC0xMSwgejogMC44IH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAxMSwgejogMC44IH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAwLjYsIHo6IDUuMCwgczogMC45IH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtNS42LCB6OiA2LjYsIHlhdzogMC4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAzLjgsIHo6IDYuNywgeWF3OiAtMC4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTEuNiwgejogLTIuNCwgeWF3OiAxLjUgfSxcbiAgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNC4yLCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogNC40LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogMTEuMiwgejogLTIuMiwgeWF3OiAxLjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiAtNS41LCB6OiA0LjYsIHlhdzogMC43LCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAzLjIsIHo6IDQuNCwgeWF3OiAyLjUsIHM6IDAuNyB9LCB7IHByb3A6ICdib25lcycsIHg6IDguMiwgejogMy4yLCB5YXc6IDEuMCwgczogMC42IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuMiwgejogMy40LCB5YXc6IDMuNiwgczogMC42IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogNywgejogLTQuNSwgeWF3OiAwLjMsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IC03LjQsIHo6IC00LjMsIHlhdzogNC4xLCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAwLjIsIHo6IC00LjgsIHlhdzogNS4yLCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAxMC4yLCB6OiAtMC42LCB5YXc6IDIuMCwgczogMC42IH0sXG5dO1xuY29uc3QgQkFTVElPTl9MQVlPVVQ6IFBsYWNlbWVudFtdID0gWyAgICAgICAgLy8gYSBmb3J0cmVzczogZ2F0ZXMgYmV0d2VlbiBsb25nIHdhbGxzLCBicmF6aWVycyBhbG9uZyB0aGUgYmF0dGxlbWVudHMsIGZlbmNlcyBvbiB0aGUgZmxhbmtzXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtNS44LCB6OiA2LjUsIHM6IDEuMSB9LCB7IHByb3A6ICdhcmNoJywgeDogMCwgejogNy4wLCBzOiAxLjMgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDUuOCwgejogNi41LCBzOiAxLjEgfSxcbiAgeyBwcm9wOiAnd2FsbCcsIHg6IC05LjQsIHo6IDYuMCwgczogMS4zIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMi45LCB6OiA2LjQsIHM6IDEuMiB9LCB7IHByb3A6ICd3YWxsJywgeDogMi45LCB6OiA2LjQsIHM6IDEuMiB9LCB7IHByb3A6ICd3YWxsJywgeDogOS40LCB6OiA2LjAsIHM6IDEuMyB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTEyLjIsIHo6IDIuNiwgeWF3OiAxLjU3LCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDEyLjIsIHo6IDIuNiwgeWF3OiAxLjU3LCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0xMi4yLCB6OiAtMS42LCB5YXc6IDEuNTcgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDEyLjIsIHo6IC0xLjYsIHlhdzogMS41NyB9LFxuICB7IHByb3A6ICdwaWxsYXInLCB4OiAtMTEuMiwgejogNS42LCB5YXc6IDAuNCwgczogMS4xIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDExLjIsIHo6IDUuNiwgeWF3OiAxLjIsIHM6IDEuMSB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTMuMiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAzLjIsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogLTEwLjYsIHo6IDEuMCB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogMTAuNiwgejogMS4wIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtNy4yLCB6OiAtNC42LCBzOiAwLjkgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDcuMiwgejogLTQuNiwgczogMC45IH0sXG4gIHsgcHJvcDogJ2ZlbmNlJywgeDogLTQuNiwgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC0zLjMsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAzLjMsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA0LjYsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAtMTEuNiwgejogLTMuNCwgeWF3OiAxLjUgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAxMS42LCB6OiAtMy40LCB5YXc6IDEuNSB9LFxuICB7IHByb3A6ICdib25lcycsIHg6IC0xLjUsIHo6IC00LjUsIHlhdzogMC43LCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiA5LjQsIHo6IDMuMiwgeWF3OiAxLjAsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IC05LjYsIHo6IC0zLjAsIHlhdzogMy42LCBzOiAwLjUgfSxcbl07XG5cbnR5cGUgQzMgPSBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5pbnRlcmZhY2UgVGhlbWUgeyBsYXlvdXQ6IFBsYWNlbWVudFtdOyBmbG9vcjogQzM7IGZvZzogQzM7IG1pc3Q6IEMzOyB3YWxsOiBDMzsgZmxhbWVBOiBDMzsgZmxhbWVCOiBDMzsgcnVuZTogQzMgfVxuLyoqIE9uZSBsb29rIHBlciBjYW1wYWlnbiBzdGFnZSAoaWRzIG1hdGNoIFNUQUdFUyBpbiBjb3JlL3dhdmVzLnRzKS4gVW5rbm93biBpZHMgdXNlIHRoZSBjcnlwdCBsb29rLiAqL1xuY29uc3QgVEhFTUVTOiBSZWNvcmQ8c3RyaW5nLCBUaGVtZT4gPSB7XG4gIGNyeXB0OiB7IGxheW91dDogQ1JZUFRfTEFZT1VULCBmbG9vcjogWzAuNjIsIDAuNywgMC43XSwgZm9nOiBbMC4wMiwgMC4wNSwgMC4wNl0sIG1pc3Q6IFswLjIsIDAuNiwgMC41NV0sIHdhbGw6IFswLjc1LCAwLjg1LCAwLjldLCBmbGFtZUE6IFswLjM1LCAxLCAwLjhdLCBmbGFtZUI6IFswLjEsIDAuOCwgMC42XSwgcnVuZTogWzAuMTgsIDAuODUsIDAuNjVdIH0sXG4gIGdyYXZleWFyZDogeyBsYXlvdXQ6IEdSQVZFWUFSRF9MQVlPVVQsIGZsb29yOiBbMC42MiwgMC43NCwgMC41Ml0sIGZvZzogWzAuMDMsIDAuMDUsIDAuMDI1XSwgbWlzdDogWzAuNDIsIDAuNiwgMC4yMl0sIHdhbGw6IFswLjcsIDAuODUsIDAuNjJdLCBmbGFtZUE6IFswLjc1LCAxLCAwLjRdLCBmbGFtZUI6IFswLjQsIDAuOCwgMC4yXSwgcnVuZTogWzAuNSwgMC44LCAwLjI1XSB9LFxuICBlbmRsZXNzOiB7IGxheW91dDogQ1JZUFRfTEFZT1VULCBmbG9vcjogWzAuNzgsIDAuNjIsIDAuNjhdLCBmb2c6IFswLjA2LCAwLjAyLCAwLjAzNV0sIG1pc3Q6IFswLjc1LCAwLjMsIDAuNF0sIHdhbGw6IFswLjkyLCAwLjY4LCAwLjc4XSwgZmxhbWVBOiBbMSwgMC42MiwgMC4zXSwgZmxhbWVCOiBbMC45LCAwLjI1LCAwLjE1XSwgcnVuZTogWzAuOSwgMC4zNSwgMC4zXSB9LFxuICBiYXN0aW9uOiB7IGxheW91dDogQkFTVElPTl9MQVlPVVQsIGZsb29yOiBbMC42LCAwLjYyLCAwLjldLCBmb2c6IFswLjAzLCAwLjAzLCAwLjA4XSwgbWlzdDogWzAuNCwgMC40LCAwLjg1XSwgd2FsbDogWzAuNzIsIDAuNzIsIDFdLCBmbGFtZUE6IFswLjYsIDAuNjUsIDFdLCBmbGFtZUI6IFswLjQsIDAuMywgMC45NV0sIHJ1bmU6IFswLjQ1LCAwLjQsIDAuOTVdIH0sXG59O1xuXG5cbi8qKiBCdWlsZCB0aGUgdGVhbCBzb3VsZmlyZSBvdmVyIGEgYnJhemllcjogYSBzbWFsbCBzb2Z0IGZsYW1lIHRoYXQgZmxpY2tlcnMuICovXG5mdW5jdGlvbiBmbGFtZShzY2VuZTogYW55LCB0ZXg6IGFueSwgeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlciwgazogbnVtYmVyLCBhOiBDMywgYjogQzMpOiBhbnkge1xuICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdmaXJlJywgMTgsIHNjZW5lKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGV4OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCB5LCB6KTtcbiAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMjIgKiBrLCAwLCAtMC4yMiAqIGspOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIyICogaywgMCwgMC4yMiAqIGspO1xuICBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xLCAxLCAtMC4xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xLCAxLjQsIDAuMSk7XG4gIHBzLm1pbkxpZmVUaW1lID0gMC41OyBwcy5tYXhMaWZlVGltZSA9IDEuMDsgcHMuZW1pdFJhdGUgPSAyMDsgcHMubWluU2l6ZSA9IDAuMzUgKiBrOyBwcy5tYXhTaXplID0gMC43ICogazsgcHMubWluRW1pdFBvd2VyID0gMC41ICogazsgcHMubWF4RW1pdFBvd2VyID0gMS4wICogaztcbiAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KGFbMF0sIGFbMV0sIGFbMl0sIDAuOSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNChiWzBdLCBiWzFdLCBiWzJdLCAwLjgpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoYlswXSAqIDAuMSwgYlsxXSAqIDAuMywgYlsyXSAqIDAuMywgMCk7XG4gIHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTsgcHMuc3RhcnQoKTsgcmV0dXJuIHBzO1xufVxuXG4vKiogU29mdCByb3VuZCBibG9iIHVzZWQgZm9yIHRoZSBmbGFtZXMuICovXG5mdW5jdGlvbiBnbG93VGV4dHVyZShzY2VuZTogYW55KTogYW55IHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdnbG93JywgeyB3aWR0aDogNjQsIGhlaWdodDogNjQgfSwgc2NlbmUsIHRydWUpLCBjID0gdC5nZXRDb250ZXh0KCksIGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KDMyLCAzMiwgMCwgMzIsIDMyLCAzMik7XG4gIGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDEpJyk7IGcuYWRkQ29sb3JTdG9wKDAuNCwgJ3JnYmEoMjU1LDI1NSwyNTUsMC40NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcbiAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IHQudXBkYXRlKCk7IHQuaGFzQWxwaGEgPSB0cnVlOyByZXR1cm4gdDtcbn1cblxuLyoqIExvYWQgdGhlIHByb3Aga2l0IG9uY2U7IGFwcGx5KHRoZW1lKSB0aGVuIHN0YW5kcyBjb3BpZXMgb2YgZWFjaCBwaWVjZSBhcm91bmQgdGhlIGZpZWxkICh0aGV5IHNoYXJlIG9uZSBtZXNoIGFuZCBvbmUgdGV4dHVyZSwgc28gdGhleSBjb3N0IGFsbW9zdCBub3RoaW5nKS4gKi9cbmFzeW5jIGZ1bmN0aW9uIGxvYWRLaXQoc2NlbmU6IGFueSk6IFByb21pc2U8eyBhcHBseSh0OiBUaGVtZSk6IHZvaWQgfT4ge1xuICBjb25zdCBib3ggPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvYXJlbmEvJywgJ3Byb3BzLmdsYicsIHNjZW5lKTtcbiAgYm94LmFkZEFsbFRvU2NlbmUoKTtcbiAgY29uc3Qgcm9vdCA9IGJveC5tZXNoZXMuZmluZCgobTogYW55KSA9PiBtLm5hbWUgPT09ICdfX3Jvb3RfXycpLCBzcmM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgZm9yIChjb25zdCBtIG9mIGJveC5tZXNoZXMpIGlmIChtLm5hbWUgIT09ICdfX3Jvb3RfXycgJiYgbS5nZXRUb3RhbFZlcnRpY2VzKCkgPiAwKSB7IHNyY1ttLm5hbWVdID0gbTsgbS5zZXRFbmFibGVkKGZhbHNlKTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgY29uc3QgZ2xvdyA9IGdsb3dUZXh0dXJlKHNjZW5lKTsgbGV0IG1hZGU6IHsgaG9sZGVyczogYW55W107IGZpcmVzOiBhbnlbXSB9ID0geyBob2xkZXJzOiBbXSwgZmlyZXM6IFtdIH0sIG4gPSAwO1xuICByZXR1cm4ge1xuICAgIGFwcGx5KHQ6IFRoZW1lKSB7XG4gICAgICBmb3IgKGNvbnN0IGggb2YgbWFkZS5ob2xkZXJzKSBoLmRpc3Bvc2UoKTsgZm9yIChjb25zdCBmIG9mIG1hZGUuZmlyZXMpIGYuZGlzcG9zZShmYWxzZSk7ICAgLy8gZmFsc2U6IGtlZXAgdGhlIHNoYXJlZCBnbG93IHRleHR1cmUgbWFkZSA9IHsgaG9sZGVyczogW10sIGZpcmVzOiBbXSB9O1xuICAgICAgZm9yIChjb25zdCBwIG9mIHQubGF5b3V0KSB7XG4gICAgICAgIGNvbnN0IGJhc2UgPSBzcmNbcC5wcm9wXTsgaWYgKCFiYXNlKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgaW5zdCA9IGJhc2UuY3JlYXRlSW5zdGFuY2UocC5wcm9wICsgbisrKTsgaW5zdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgICAgIGluc3Qucm90YXRpb25RdWF0ZXJuaW9uID0gcm9vdC5yb3RhdGlvblF1YXRlcm5pb24/LmNsb25lKCkgPz8gbnVsbDsgaWYgKCFpbnN0LnJvdGF0aW9uUXVhdGVybmlvbikgaW5zdC5yb3RhdGlvbiA9IHJvb3Qucm90YXRpb24uY2xvbmUoKTsgaW5zdC5zY2FsaW5nID0gcm9vdC5zY2FsaW5nLmNsb25lKCk7XG4gICAgICAgIGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2hvbGRlcicgKyBuLCBzY2VuZSk7IGhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyBob2xkZXIucm90YXRpb24ueSA9IHAueWF3ID8/IDA7IGhvbGRlci5zY2FsaW5nLnNldEFsbChwLnMgPz8gMSk7XG4gICAgICAgIGluc3QucGFyZW50ID0gaG9sZGVyOyBtYWRlLmhvbGRlcnMucHVzaChob2xkZXIpO1xuICAgICAgICBpZiAocC5wcm9wID09PSAnYnJhemllcicpIG1hZGUuZmlyZXMucHVzaChmbGFtZShzY2VuZSwgZ2xvdywgcC54LCAxLjI1ICogKHAucyA/PyAxKSwgcC56LCBwLnMgPz8gMSwgdC5mbGFtZUEsIHQuZmxhbWVCKSk7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQXJlbmEoc2NlbmU6IGFueSwgZ3JvdW5kOiBhbnkpOiB7IHVwZGF0ZSh0OiBudW1iZXIpOiB2b2lkOyBzZXRUaGVtZShzdGFnZTogc3RyaW5nKTogdm9pZCB9IHtcbiAgLy8gLS0tLSBmbG9vclxuICBjb25zdCB0ZXggPSBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvYXJlbmEvZmxvb3Iud2VicCcsIHNjZW5lLCBmYWxzZSwgdHJ1ZSwgQkFCWUxPTi5UZXh0dXJlLlRSSUxJTkVBUl9TQU1QTElOR01PREUpO1xuICB0ZXgudVNjYWxlID0gNjAgLyBUSUxFX01FVFJFUzsgdGV4LnZTY2FsZSA9IDQwIC8gVElMRV9NRVRSRVM7IHRleC5hbmlzb3Ryb3BpY0ZpbHRlcmluZ0xldmVsID0gNDtcbiAgY29uc3QgZ20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdnbScsIHNjZW5lKTsgZ20uZGlmZnVzZVRleHR1cmUgPSB0ZXg7IGdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpO1xuICBnbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC42MiwgMC43LCAwLjcpOyBncm91bmQubWF0ZXJpYWwgPSBnbTtcblxuICAvLyAtLS0tIHJ1bmUgY2lyY2xlIGluIHRoZSBtaWRkbGUgb2YgdGhlIGZpZWxkXG4gIGNvbnN0IGRlY2FsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ3J1bmVzJywgeyB3aWR0aDogNS4yLCBoZWlnaHQ6IDUuMiB9LCBzY2VuZSk7XG4gIGRlY2FsLnBvc2l0aW9uLnkgPSAwLjAxMjsgZGVjYWwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICBjb25zdCBybSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3JtJywgc2NlbmUpOyBybS5kaWZmdXNlVGV4dHVyZSA9IHJ1bmVUZXh0dXJlKHNjZW5lKTsgcm0uZGlmZnVzZVRleHR1cmUuaGFzQWxwaGEgPSB0cnVlOyBybS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7XG4gIHJtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xOCwgMC44NSwgMC42NSk7IHJtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHJtLmFscGhhID0gMC41NTsgcm0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IGRlY2FsLm1hdGVyaWFsID0gcm07XG5cbiAgLy8gLS0tLSBkYXJrIHRlYWwgc3Vycm91bmQgdGhhdCBzd2FsbG93cyB0aGUgZmFyIGVkZ2Ugb2YgdGhlIGZsb29yXG4gIHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wMiwgMC4wNSwgMC4wNiwgMSk7XG4gIHNjZW5lLmZvZ01vZGUgPSBCQUJZTE9OLlNjZW5lLkZPR01PREVfTElORUFSOyBzY2VuZS5mb2dDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAyLCAwLjA1LCAwLjA2KTsgc2NlbmUuZm9nU3RhcnQgPSAyNDsgc2NlbmUuZm9nRW5kID0gNTY7XG5cbiAgY29uc3QgY2F2ZSA9IGJ1aWxkQ2F2ZShzY2VuZSwgdGV4KTtcbiAgbGV0IGtpdDogeyBhcHBseSh0OiBUaGVtZSk6IHZvaWQgfSB8IG51bGwgPSBudWxsLCB3YW50ID0gJ2NyeXB0Jywgc2hvd24gPSAnJztcbiAgY29uc3Qgc2hvdyA9ICgpID0+IHtcbiAgICBjb25zdCB0ID0gVEhFTUVTW3dhbnRdID8/IFRIRU1FUy5jcnlwdDsgaWYgKHdhbnQgPT09IHNob3duICYmIGtpdCkgcmV0dXJuO1xuICAgIGNvbnN0IGNvbCA9IChjOiBDMykgPT4gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pO1xuICAgIGdtLmRpZmZ1c2VDb2xvciA9IGNvbCh0LmZsb29yKTsgY2F2ZS53YWxsTWF0LmRpZmZ1c2VDb2xvciA9IGNvbCh0LndhbGwpOyBybS5lbWlzc2l2ZUNvbG9yID0gY29sKHQucnVuZSk7XG4gICAgZm9yIChjb25zdCBtIG9mIGNhdmUubWlzdE1hdHMpIG0uZW1pc3NpdmVDb2xvciA9IGNvbCh0Lm1pc3QpO1xuICAgIHNjZW5lLmZvZ0NvbG9yID0gY29sKHQuZm9nKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCh0LmZvZ1swXSwgdC5mb2dbMV0sIHQuZm9nWzJdLCAxKTtcbiAgICBpZiAoa2l0KSB7IGtpdC5hcHBseSh0KTsgc2hvd24gPSB3YW50OyB9XG4gIH07XG4gIGxvYWRLaXQoc2NlbmUpLnRoZW4oKGspID0+IHsga2l0ID0gazsgc2hvd24gPSAnJzsgc2hvdygpOyB9KS5jYXRjaCgoZSkgPT4gY29uc29sZS53YXJuKCdhcmVuYSBwcm9wcyBmYWlsZWQnLCBlKSk7XG5cbiAgcmV0dXJuIHsgdXBkYXRlOiAodDogbnVtYmVyKSA9PiB7IHJtLmFscGhhID0gMC40NSArIDAuMTUgKiBNYXRoLnNpbih0ICogMS40KTsgY2F2ZS51cGRhdGUodCk7IH0sIHNldFRoZW1lOiAoc3RhZ2U6IHN0cmluZykgPT4geyB3YW50ID0gc3RhZ2U7IHNob3coKTsgfSB9O1xufVxuXG4vLyAtLS0tIHRoZSBjYXZlOiBhIHJvdWdoIHN0b25lIHdhbGwgYWxsIHRoZSB3YXkgcm91bmQsIHJvY2sgc3BpcmVzIGFsb25nIGl0cyBmb290LCBkcmlmdGluZyBtaXN0LCBhbmQgYSBkYXJrIHZpZ25ldHRlIG9uIHRoZSBmbG9vclxuY29uc3QgUlggPSAyMCwgUlogPSAxNSwgQ1ogPSAtNCwgV0FMTF9IID0gMTY7ICAgLy8gb3ZhbCByaW5nIGNlbnRyZWQgYSBsaXR0bGUgYmVoaW5kIHRoZSBmaWVsZDogdGhlIGZhciB3YWxsIHN0YW5kcyBhYm91dCAxMSBtIHBhc3QgdGhlIGNlbnRyZVxuY29uc3Qgd29iYmxlID0gKGE6IG51bWJlciwgeTogbnVtYmVyKTogbnVtYmVyID0+IE1hdGguc2luKDMgKiBhICsgMS4zKSAqIDAuNSArIE1hdGguc2luKDcgKiBhICsgeSAqIDAuNSkgKiAwLjMgKyBNYXRoLnNpbigxMyAqIGEgLSB5ICogMC4zNSkgKiAwLjIgKyBNYXRoLnNpbigyMyAqIGEgKyB5KSAqIDAuMDg7XG5cbmZ1bmN0aW9uIG1pc3RUZXh0dXJlKHNjZW5lOiBhbnksIHNlZWQ6IG51bWJlcik6IGFueSB7XG4gIGNvbnN0IFMgPSAyNTYsIHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnbWlzdCcgKyBzZWVkLCB7IHdpZHRoOiBTLCBoZWlnaHQ6IFMgfSwgc2NlbmUsIHRydWUpLCBjID0gdC5nZXRDb250ZXh0KCk7XG4gIGMuY2xlYXJSZWN0KDAsIDAsIFMsIFMpO1xuICBsZXQgciA9IHNlZWQgKiA5MzAxICsgNDkyOTc7IGNvbnN0IHJuZCA9ICgpID0+IChyID0gKHIgKiA5MzAxICsgNDkyOTcpICUgMjMzMjgwKSAvIDIzMzI4MDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0NjsgaSsrKSB7XG4gICAgY29uc3QgeCA9IHJuZCgpICogUywgeSA9IHJuZCgpICogUywgcmFkID0gMjYgKyBybmQoKSAqIDQ2O1xuICAgIGZvciAoY29uc3QgZHggb2YgWy1TLCAwLCBTXSkgZm9yIChjb25zdCBkeSBvZiBbLVMsIDAsIFNdKSB7ICAgICAgICAgIC8vIGRyYXcgd3JhcHBlZCBjb3BpZXMgc28gdGhlIHBpY3R1cmUgdGlsZXMgd2l0aCBubyBzZWFtXG4gICAgICBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCh4ICsgZHgsIHkgKyBkeSwgMCwgeCArIGR4LCB5ICsgZHksIHJhZCk7IGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDAuNSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcbiAgICAgIGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCBTLCBTKTtcbiAgICB9XG4gIH1cbiAgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IHRydWU7IHQud3JhcFUgPSB0LndyYXBWID0gQkFCWUxPTi5UZXh0dXJlLldSQVBfQUREUkVTU01PREU7IHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBidWlsZENhdmUoc2NlbmU6IGFueSwgZmxvb3JUZXg6IGFueSk6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHdhbGxNYXQ6IGFueTsgbWlzdE1hdHM6IGFueVtdIH0ge1xuICAvLyByb3VnaCB3YWxsOiBhbiBvdmFsIHJpbmcgd2hvc2UgcmFkaXVzIHdvYmJsZXMgd2l0aCBhbmdsZSBhbmQgaGVpZ2h0LCBkYXJrZXIgdGhlIGhpZ2hlciBpdCBnb2VzXG4gIGNvbnN0IE4gPSAxMjAsIE0gPSAxMiwgcG9zOiBudW1iZXJbXSA9IFtdLCB1djogbnVtYmVyW10gPSBbXSwgY29sOiBudW1iZXJbXSA9IFtdLCBpZHg6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGogPSAwOyBqIDw9IE07IGorKykgZm9yIChsZXQgaSA9IDA7IGkgPD0gTjsgaSsrKSB7XG4gICAgY29uc3QgYSA9IChpIC8gTikgKiBNYXRoLlBJICogMiwgaCA9IChqIC8gTSkgKiBXQUxMX0gsIGsgPSAxICsgMC4wNiAqIHdvYmJsZShhLCBoKSArIChqID09PSAwID8gMCA6IDAuMDUgKiBNYXRoLnNpbihhICogNSArIGopKTtcbiAgICBjb25zdCBvdmVyaGFuZyA9IDEgLSAwLjEgKiBNYXRoLnNpbigoaiAvIE0pICogTWF0aC5QSSk7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gbGVhbnMgaW4gYSBsaXR0bGUgc28gaXQgZmVlbHMgbGlrZSBhIGNhdmVyblxuICAgIHBvcy5wdXNoKE1hdGguY29zKGEpICogUlggKiBrICogb3ZlcmhhbmcsIGgsIENaICsgTWF0aC5zaW4oYSkgKiBSWiAqIGsgKiBvdmVyaGFuZyk7IHV2LnB1c2goKGkgLyBOKSAqIDE0LCAoaiAvIE0pICogMy4yKTtcbiAgICBjb25zdCBiID0gTWF0aC5tYXgoMC4wNiwgMS4wIC0gKGogLyBNKSAqIDAuOSk7IGNvbC5wdXNoKGIgKiAwLjgsIGIsIGIsIDEpO1xuICB9XG4gIGZvciAobGV0IGogPSAwOyBqIDwgTTsgaisrKSBmb3IgKGxldCBpID0gMDsgaSA8IE47IGkrKykgeyBjb25zdCBhID0gaiAqIChOICsgMSkgKyBpLCBiID0gYSArIDEsIGMgPSBhICsgTiArIDEsIGQgPSBjICsgMTsgaWR4LnB1c2goYSwgYywgYiwgYiwgYywgZCk7IH1cbiAgY29uc3Qgd2FsbCA9IG5ldyBCQUJZTE9OLk1lc2goJ2NhdmUnLCBzY2VuZSksIHZkID0gbmV3IEJBQllMT04uVmVydGV4RGF0YSgpOyB2ZC5wb3NpdGlvbnMgPSBwb3M7IHZkLmluZGljZXMgPSBpZHg7IHZkLnV2cyA9IHV2OyB2ZC5jb2xvcnMgPSBjb2w7XG4gIGNvbnN0IG5ybTogbnVtYmVyW10gPSBbXTsgQkFCWUxPTi5WZXJ0ZXhEYXRhLkNvbXB1dGVOb3JtYWxzKHBvcywgaWR4LCBucm0pOyB2ZC5ub3JtYWxzID0gbnJtOyB2ZC5hcHBseVRvTWVzaCh3YWxsKTtcbiAgY29uc3Qgd20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdjYXZlbScsIHNjZW5lKTsgd20uZGlmZnVzZVRleHR1cmUgPSBmbG9vclRleC5jbG9uZSgpOyB3bS5kaWZmdXNlVGV4dHVyZS51U2NhbGUgPSAxOyB3bS5kaWZmdXNlVGV4dHVyZS52U2NhbGUgPSAxO1xuICB3bS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgd20uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IHdtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjg1LCAwLjkpOyB3YWxsLm1hdGVyaWFsID0gd207IHdhbGwuaXNQaWNrYWJsZSA9IGZhbHNlOyB3YWxsLnVzZVZlcnRleENvbG9ycyA9IHRydWU7IHdtLnVzZVZlcnRleENvbG9yID0gdHJ1ZTtcbiAgLy8gcm9jayBzcGlyZXMgc3RhbmRpbmcgYWxvbmcgdGhlIGZvb3Qgb2YgdGhlIHdhbGwgKG9uZSBzaGFyZWQgbWVzaCwgbWFueSBjb3BpZXMpXG4gIGNvbnN0IHNwaXJlID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignc3BpcmUnLCB7IGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogMS42LCBoZWlnaHQ6IDEsIHRlc3NlbGxhdGlvbjogNSB9LCBzY2VuZSk7XG4gIGNvbnN0IHNtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnc3BpcmVtJywgc2NlbmUpOyBzbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4wMywgMC4wNDUsIDAuMDU1KTsgc20uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHNtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4wMDQsIDAuMDEyLCAwLjAxNCk7IHNwaXJlLm1hdGVyaWFsID0gc207XG4gIHNwaXJlLmNvbnZlcnRUb0ZsYXRTaGFkZWRNZXNoKCk7IHNwaXJlLnNldEVuYWJsZWQoZmFsc2UpOyBzcGlyZS5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGxldCByID0gMTIzNDU7IGNvbnN0IHJuZCA9ICgpID0+IChyID0gKHIgKiA5MzAxICsgNDkyOTcpICUgMjMzMjgwKSAvIDIzMzI4MDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0NjsgaSsrKSB7XG4gICAgY29uc3QgYSA9IChpIC8gNDYpICogTWF0aC5QSSAqIDIgKyAocm5kKCkgLSAwLjUpICogMC4xMiwgZCA9IDAuODYgKyBybmQoKSAqIDAuMSwgaGd0ID0gMS40ICsgcm5kKCkgKiAzLjIsIHcgPSAwLjcgKyBybmQoKSAqIDEuMDtcbiAgICBjb25zdCBzID0gc3BpcmUuY3JlYXRlSW5zdGFuY2UoJ3NwJyArIGkpOyBzLmlzUGlja2FibGUgPSBmYWxzZTsgcy5wb3NpdGlvbi5zZXQoTWF0aC5jb3MoYSkgKiBSWCAqIGQsIGhndCAvIDIgLSAwLjIsIENaICsgTWF0aC5zaW4oYSkgKiBSWiAqIGQpO1xuICAgIHMuc2NhbGluZy5zZXQodywgaGd0LCB3KTsgcy5yb3RhdGlvbi55ID0gcm5kKCkgKiA2OyBzLnJvdGF0aW9uLnogPSAocm5kKCkgLSAwLjUpICogMC4xODtcbiAgfVxuICAvLyBtaXN0OiB0d28gc2xvdyBsYXllcnMganVzdCBhYm92ZSB0aGUgZmxvb3JcbiAgY29uc3QgbGF5ZXJzID0gWzAuMjgsIDAuNzVdLm1hcCgoeSwgbikgPT4ge1xuICAgIGNvbnN0IHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgnbWlzdCcgKyBuLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0NCB9LCBzY2VuZSk7IHAucG9zaXRpb24ueSA9IHk7IHAuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdtaXN0bScgKyBuLCBzY2VuZSksIHQgPSBtaXN0VGV4dHVyZShzY2VuZSwgbiArIDMpOyB0LnVTY2FsZSA9IDUgLSBuOyB0LnZTY2FsZSA9IDMuNCAtIG4gKiAwLjY7XG4gICAgbS5kaWZmdXNlVGV4dHVyZSA9IHQ7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4yLCAwLjYsIDAuNTUpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYWxwaGEgPSAwLjE1IC0gbiAqIDAuMDY7IG0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7XG4gICAgbS5kaXNhYmxlRGVwdGhXcml0ZSA9IHRydWU7IHAubWF0ZXJpYWwgPSBtOyBwLmFscGhhSW5kZXggPSA1ICsgbjsgcmV0dXJuIHsgdCwgbiwgbSB9O1xuICB9KTtcbiAgLy8gdmlnbmV0dGU6IGRhcmtlbnMgdGhlIGZsb29yIHRvd2FyZCB0aGUgZWRnZXMgc28gdGhlIGZpZWxkIGxvb2tzIGxpa2UgYSBsaXQgcG9vbCBpbnNpZGUgdGhlIGNhdmVcbiAgY29uc3QgdnQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgndmlnJywgeyB3aWR0aDogMjU2LCBoZWlnaHQ6IDI1NiB9LCBzY2VuZSwgdHJ1ZSksIHZjID0gdnQuZ2V0Q29udGV4dCgpLCBnID0gdmMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMTI4LCAxMjgsIDAsIDEyOCwgMTI4LCAxMjgpO1xuICBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgwLDAsMCwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjQyLCAncmdiYSgwLDAsMCwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjgsICdyZ2JhKDAsNCw2LDAuNyknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMCw0LDYsMC45NSknKTtcbiAgdmMuZmlsbFN0eWxlID0gZzsgdmMuZmlsbFJlY3QoMCwgMCwgMjU2LCAyNTYpOyB2dC51cGRhdGUoKTsgdnQuaGFzQWxwaGEgPSB0cnVlO1xuICBjb25zdCB2aWcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgndmlnJywgeyB3aWR0aDogNDYsIGhlaWdodDogMzAgfSwgc2NlbmUpOyB2aWcucG9zaXRpb24ueSA9IDAuMDM7IHZpZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGNvbnN0IHZtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndmlnbScsIHNjZW5lKTsgdm0uZGlmZnVzZVRleHR1cmUgPSB2dDsgdm0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB2bS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB2bS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAsIDAuMDEsIDAuMDE1KTsgdm0uZGlzYWJsZURlcHRoV3JpdGUgPSB0cnVlOyB2aWcubWF0ZXJpYWwgPSB2bTsgdmlnLmFscGhhSW5kZXggPSAxO1xuICByZXR1cm4geyB3YWxsTWF0OiB3bSwgbWlzdE1hdHM6IGxheWVycy5tYXAoKGwpID0+IGwubSksIHVwZGF0ZTogKHQ6IG51bWJlcikgPT4geyBmb3IgKGNvbnN0IGwgb2YgbGF5ZXJzKSB7IGwudC51T2Zmc2V0ID0gdCAqICgwLjAwNiArIGwubiAqIDAuMDA0KTsgbC50LnZPZmZzZXQgPSB0ICogMC4wMDMgKiAobC5uID8gLTEgOiAxKTsgfSB9IH07XG59XG4iLCAiLy8gQXV0by1iYXR0bGUgc2ltdWxhdGlvbjogcHVyZSBsb2dpYywgbm8gZ3JhcGhpY3MuIERldGVybWluaXN0aWMgZm9yIGEgZ2l2ZW4gc2VlZC5cbi8vIFRoZSByZW5kZXJlciBvbmx5IHJlYWRzIGZpZ2h0ZXJzICsgZXZlbnRzOyBpdCBuZXZlciBkZWNpZGVzIGFueXRoaW5nLlxuLy9cbi8vIEFiaWxpdGllcyAobnVtYmVycyBsaXZlIGluIGJhbGFuY2UudHMpOlxuLy8gICBTa2VsZXRvbiBXYXJyaW9yICBQaGFsYW54ICAgICB0YWtlcyBsZXNzIGRhbWFnZSBmb3IgZWFjaCBuZWFyYnkgYWxsaWVkIFdhcnJpb3IgKGNhcHBlZClcbi8vICAgU2tlbGV0b24gQXJjaGVyICAgU3BsaXQgQXJyb3cgKHNraWxsKSBvbmUgYXJyb3cgYXQgZWFjaCBvZiB1cCB0byAzIGRpZmZlcmVudCBlbmVtaWVzOyBiYXNpYyBzaG90cyBhcmUgYSBzaW5nbGUgYXJyb3dcbi8vICAgR29ibGluICAgICAgICAgICAgT3Bwb3J0dW5pc3QgK2RhbWFnZSBvbiBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZTsgcHJlZmVycyBzdWNoIHRhcmdldHNcbi8vICAgS25pZ2h0ICAgICAgICAgICAgVGF1bnQgKHNraWxsKSAgZm9yY2VzIG5lYXJieSBlbmVtaWVzIHRvIGF0dGFjayBoaW1cbi8vICAgT2dyZSAgICAgICAgICAgICAgU21hc2ggKHNraWxsKSAgaGVhdnkgc2xhbSB0aGF0IGFsc28gaGl0cyBlbmVtaWVzIG5lYXIgdGhlIGltcGFjdFxuLy8gU2tpbGxzIHJ1biBvbiBtYW5hOiBiYXNpYyBhdHRhY2tzIGFuZCBkYW1hZ2UgdGFrZW4gZmlsbCBhIGJhcjsgd2hlbiBmdWxsLCB0aGUgbmV4dCBhdHRhY2sgaXMgdGhlIHNraWxsIGFuZCB0aGUgYmFyIHJlc2V0cy5cbi8vIFdhcnJpb3IsIEdvYmxpbiBhbmQgQmFyYmFyaWFuIGhhdmUgcGFzc2l2ZXMgb25seSAobm8gbWFuYSkuXG4vLyAgIEJhcmJhcmlhbiAgICAgICAgIEZyZW56eSAgICAgIGF0dGFja3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBzd2luZ1xuXG5pbXBvcnQgeyBHUklEX0NPTFMsIEdSSURfUk9XUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi9iYWxhbmNlLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGNvbnN0IEdSSURfU1AgPSAxLjM7ICAgICAvLyBtZXRyZXMgYmV0d2VlbiBncmlkIGNlbGxzXG5leHBvcnQgY29uc3QgRlJPTlRfWCA9IDEuNzsgICAgIC8vIGZyb250IGxpbmUncyBkaXN0YW5jZSBmcm9tIHRoZSBjZW50cmUgbGluZVxuXG5leHBvcnQgaW50ZXJmYWNlIFNsb3QgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgU3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyIH1cblxuLyoqIFdvcmxkIHBvc2l0aW9uIG9mIGEgZ3JpZCBjZWxsIGZvciBhIHRlYW0gKHRlYW0gMCA9IGxlZnQsIGZhY2VzICtYOyB0ZWFtIDEgPSByaWdodCwgZmFjZXMgLVgpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNlbGxQb3ModGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcik6IHsgeDogbnVtYmVyOyB6OiBudW1iZXIgfSB7XG4gIGNvbnN0IHJvdyA9IE1hdGguZmxvb3IoY2VsbCAvIEdSSURfQ09MUyksIGNvbCA9IGNlbGwgJSBHUklEX0NPTFM7XG4gIGNvbnN0IGRlcHRoID0gR1JJRF9DT0xTIC0gMSAtIGNvbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIDAgPSBmcm9udCBsaW5lXG4gIHJldHVybiB7IHg6IChGUk9OVF9YICsgZGVwdGggKiBHUklEX1NQKSAqICh0ZWFtID09PSAwID8gLTEgOiAxKSwgejogKHJvdyAtIChHUklEX1JPV1MgLSAxKSAvIDIpICogR1JJRF9TUCB9O1xufVxuXG5jb25zdCBGUk9OVE5FU1M6IFJlY29yZDxTb3VsSWQsIG51bWJlcj4gPSB7IGtuaWdodDogNSwgb2dyZTogNCwgd2FycmlvcjogMywgYmFyYmFyaWFuOiAzLCBnb2JsaW46IDIsIGFyY2hlcjogMCB9O1xuLyoqIFRoZSBlbmVteSBhcm15IGlzIHBsYWNlZCBhdXRvbWF0aWNhbGx5ICh0YW5rcyB1cCBmcm9udCwgYXJjaGVycyBiZWhpbmQpOyB0aGUgcGxheWVyIG9ubHkgZXZlciBzZWVzIGl0cyBjb21wb3NpdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteUNlbGxzKHNwZWNzOiBTcGVjW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IGNlbGxzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ09MUyAqIEdSSURfUk9XUzsgYysrKSBjZWxscy5wdXNoKGMpO1xuICBjZWxscy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgZGEgPSBHUklEX0NPTFMgLSAxIC0gKGEgJSBHUklEX0NPTFMpLCBkYiA9IEdSSURfQ09MUyAtIDEgLSAoYiAlIEdSSURfQ09MUyk7XG4gICAgaWYgKGRhICE9PSBkYikgcmV0dXJuIGRhIC0gZGI7XG4gICAgcmV0dXJuIE1hdGguYWJzKE1hdGguZmxvb3IoYSAvIEdSSURfQ09MUykgLSAxKSAtIE1hdGguYWJzKE1hdGguZmxvb3IoYiAvIEdSSURfQ09MUykgLSAxKTtcbiAgfSk7XG4gIGNvbnN0IG9yZGVyID0gc3BlY3MubWFwKChzLCBpKSA9PiBpKS5zb3J0KChpLCBqKSA9PiBGUk9OVE5FU1Nbc3BlY3Nbal0uc291bF0gLSBGUk9OVE5FU1Nbc3BlY3NbaV0uc291bF0pO1xuICBjb25zdCBvdXQgPSBuZXcgQXJyYXk8bnVtYmVyPihzcGVjcy5sZW5ndGgpO1xuICBvcmRlci5mb3JFYWNoKChpZHgsIGspID0+IHsgb3V0W2lkeF0gPSBjZWxsc1trXTsgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCB0eXBlIEZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhZCc7XG5leHBvcnQgaW50ZXJmYWNlIEZpZ2h0ZXIge1xuICBpZDogbnVtYmVyOyB0ZWFtOiAwIHwgMTsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjtcbiAgeDogbnVtYmVyOyB6OiBudW1iZXI7IHlhdzogbnVtYmVyO1xuICBocDogbnVtYmVyOyBtYXhIcDogbnVtYmVyOyBkbWc6IG51bWJlcjsgaW50ZXJ2YWw6IG51bWJlcjsgcmFuZ2U6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXI7XG4gIGFsaXZlOiBib29sZWFuOyBzdGF0ZTogRlN0YXRlO1xuICB0YXJnZXQ6IG51bWJlcjsgcmV0YXJnZXRBdDogbnVtYmVyOyBmb3JjZWRUYXJnZXQ6IG51bWJlcjsgZm9yY2VkVW50aWw6IG51bWJlcjtcbiAgbmV4dEF0dGFjazogbnVtYmVyOyBhdHRhY2tTdGFydDogbnVtYmVyOyBhdHRhY2tEdXI6IG51bWJlcjsgYW5pbVNwZWVkOiBudW1iZXI7IGhpdERvbmU6IGJvb2xlYW47XG4gIG1hbmE6IG51bWJlcjsgbWF4TWFuYTogbnVtYmVyOyBjYXN0aW5nOiBib29sZWFuOyBmcmVuenk6IG51bWJlcjsgZGVhZEF0OiBudW1iZXI7XG59XG5cbmV4cG9ydCB0eXBlIEJFdmVudCA9XG4gIHwgeyB0OiAnc3dpbmcnOyBpZDogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnaGl0JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlcjsga2luZDogJ21lbGVlJyB8ICdhcnJvdycgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICdhcnJvdyc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2RlYXRoJzsgaWQ6IG51bWJlciB9XG4gIHwgeyB0OiAnY2FzdCc7IGlkOiBudW1iZXI7IHNraWxsOiAnc3BsaXQnIHwgJ3RhdW50JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ3RhdW50JzsgaWQ6IG51bWJlciB9XG4gIHwgeyB0OiAnc21hc2gnOyBpZDogbnVtYmVyOyB4OiBudW1iZXI7IHo6IG51bWJlcjsgcjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdmcmVuenknOyBpZDogbnVtYmVyOyBzdGFja3M6IG51bWJlciB9O1xuXG5leHBvcnQgY2xhc3MgQmF0dGxlIHtcbiAgdGltZSA9IDA7XG4gIGZpZ2h0ZXJzOiBGaWdodGVyW10gPSBbXTtcbiAgZXZlbnRzOiBCRXZlbnRbXSA9IFtdO1xuICB3aW5uZXI6IC0xIHwgMCB8IDEgPSAtMTtcbiAgcm5nOiBSbmc7XG4gIHByaXZhdGUgcGVuZGluZzogeyBhdDogbnVtYmVyOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyIH1bXSA9IFtdO1xuICBwcml2YXRlIG5leHRJZCA9IDE7XG4gIHByaXZhdGUgZW5lbXlQb3dlciA9IDE7XG4gIHByaXZhdGUgZmxpcCA9IGZhbHNlO1xuXG4gIC8qKiBgbGV2ZWxzYDogdGhlIHBsYXllcidzIHBlcm1hbmVudCBTb3VsIGxldmVscyAoaGVhbHRoIGFuZCBkYW1hZ2UgZ3JvdyBhIGxpdHRsZSBwZXIgbGV2ZWwpLiBFbmVtaWVzIG5ldmVyIHVzZSB0aGVtLiAqL1xuICAvKiogYGVuZW15UG93ZXJgOiBoZWFsdGggYW5kIGRhbWFnZSBtdWx0aXBsaWVyIGZvciB0aGUgZW5lbXkgdGVhbSBvbmx5IChzdGFnZSBzdHJlbmd0aDsgMSA9IGFzIHdyaXR0ZW4pLiAqL1xuICBjb25zdHJ1Y3RvcihwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKSB7XG4gICAgdGhpcy5ybmcgPSBtYWtlUm5nKHNlZWQpOyB0aGlzLmVuZW15UG93ZXIgPSBlbmVteVBvd2VyO1xuICAgIGZvciAoY29uc3QgcCBvZiBwbGF5ZXJzKSB0aGlzLmFkZCgwLCBwLnNvdWwsIHAuc3RhciwgcC5jZWxsLCBsZXZlbHM/LltwLnNvdWxdID8/IDEpO1xuICAgIGNvbnN0IGNlbGxzID0gZW5lbXlDZWxscyhlbmVtaWVzKTtcbiAgICBlbmVtaWVzLmZvckVhY2goKGUsIGkpID0+IHRoaXMuYWRkKDEsIGUuc291bCwgZS5zdGFyLCBjZWxsc1tpXSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIsIGxldmVsID0gMSk6IEZpZ2h0ZXIge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbc291bF0sIHAgPSBjZWxsUG9zKHRlYW0sIGNlbGwpO1xuICAgIGNvbnN0IGx2SHAgPSAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQi5sZXZlbC5ocCwgbHZEbWcgPSAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQi5sZXZlbC5kbWc7XG4gICAgY29uc3QgcHcgPSB0ZWFtID09PSAxID8gdGhpcy5lbmVteVBvd2VyIDogMTtcbiAgICBjb25zdCBocCA9IHN0LmhwICogQi5zdGFyLmhwW3N0YXIgLSAxXSAqIGx2SHAgKiBwdztcbiAgICBjb25zdCBmOiBGaWdodGVyID0ge1xuICAgICAgaWQ6IHRoaXMubmV4dElkKyssIHRlYW0sIHNvdWwsIHN0YXIsIGNlbGwsIHg6IHAueCwgejogcC56LCB5YXc6IHRlYW0gPT09IDAgPyAwIDogTWF0aC5QSSxcbiAgICAgIGhwLCBtYXhIcDogaHAsIGRtZzogc3QuZG1nICogQi5zdGFyLmRtZ1tzdGFyIC0gMV0gKiBsdkRtZyAqIHB3LCBpbnRlcnZhbDogc3QuaW50ZXJ2YWwsIHJhbmdlOiBzdC5yYW5nZSwgc3BlZWQ6IHN0LnNwZWVkLCByYWRpdXM6IHN0LnNpemUgKiBCLnN0YXIuc2NhbGVbc3RhciAtIDFdLFxuICAgICAgYWxpdmU6IHRydWUsIHN0YXRlOiAnaWRsZScsIHRhcmdldDogLTEsIHJldGFyZ2V0QXQ6IDAsIGZvcmNlZFRhcmdldDogLTEsIGZvcmNlZFVudGlsOiAwLFxuICAgICAgbmV4dEF0dGFjazogdGhpcy5ybmcubmV4dCgpICogMC4zLCBhdHRhY2tTdGFydDogLTksIGF0dGFja0R1cjogMSwgYW5pbVNwZWVkOiAxLCBoaXRGcmFjOiAwLCBoaXREb25lOiB0cnVlLFxuICAgICAgbWFuYTogMCwgbWF4TWFuYTogQi5tYW5hW3NvdWxdPy5tYXggPz8gMCwgY2FzdGluZzogZmFsc2UsIGZyZW56eTogMCwgZGVhZEF0OiAwLFxuICAgIH0gYXMgRmlnaHRlcjtcbiAgICB0aGlzLmZpZ2h0ZXJzLnB1c2goZik7IHJldHVybiBmO1xuICB9XG5cbiAgYnlJZChpZDogbnVtYmVyKTogRmlnaHRlciB8IHVuZGVmaW5lZCB7IHJldHVybiBpZCA8IDAgPyB1bmRlZmluZWQgOiB0aGlzLmZpZ2h0ZXJzW2lkIC0gMV07IH1cbiAgZm9lcyhmOiBGaWdodGVyKTogRmlnaHRlcltdIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8udGVhbSAhPT0gZi50ZWFtKTsgfVxuICBjb3VudCh0ZWFtOiAwIHwgMSk6IG51bWJlciB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLnJlZHVjZSgobiwgZikgPT4gbiArIChmLmFsaXZlICYmIGYudGVhbSA9PT0gdGVhbSA/IDEgOiAwKSwgMCk7IH1cbiAgZHJhaW4oKTogQkV2ZW50W10geyBjb25zdCBlID0gdGhpcy5ldmVudHM7IHRoaXMuZXZlbnRzID0gW107IHJldHVybiBlOyB9XG5cbiAgc3RlcChkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMud2lubmVyID49IDApIHJldHVybjtcbiAgICB0aGlzLnRpbWUgKz0gZHQ7IHRoaXMuZmxpcCA9ICF0aGlzLmZsaXA7XG4gICAgLy8gYXJyb3dzIHRoYXQgaGF2ZSBmaW5pc2hlZCBmbHlpbmdcbiAgICBmb3IgKGxldCBpID0gdGhpcy5wZW5kaW5nLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wZW5kaW5nW2ldO1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBwLmF0KSB7XG4gICAgICAgIHRoaXMucGVuZGluZy5zcGxpY2UoaSwgMSk7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5ieUlkKHAudG8pLCBmcm9tID0gdGhpcy5ieUlkKHAuZnJvbSk7XG4gICAgICAgIGlmICh0byAmJiB0by5hbGl2ZSAmJiBmcm9tKSB0aGlzLmRhbWFnZSh0bywgcC5kbWcsIGZyb20sICdhcnJvdycpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvcmRlciA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKHRoaXMuZmxpcCkgb3JkZXIucmV2ZXJzZSgpO1xuICAgIGZvciAoY29uc3QgZiBvZiBvcmRlcikgaWYgKGYuYWxpdmUpIHRoaXMudXBkYXRlKGYsIGR0KTtcbiAgICBjb25zdCBhID0gdGhpcy5jb3VudCgwKSwgYiA9IHRoaXMuY291bnQoMSk7XG4gICAgaWYgKCFhIHx8ICFiKSB0aGlzLndpbm5lciA9IGEgPyAwIDogMTtcbiAgICBlbHNlIGlmICh0aGlzLnRpbWUgPj0gQkFMQU5DRS5zaW0udGltZUxpbWl0KSB7XG4gICAgICBjb25zdCBocCA9ICh0OiAwIHwgMSkgPT4gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB0KS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCk7XG4gICAgICB0aGlzLndpbm5lciA9IGhwKDApID4gaHAoMSkgPyAwIDogMTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyLWZpZ2h0ZXIgdXBkYXRlXG4gIHByaXZhdGUgdXBkYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07XG4gICAgdGhpcy5zZXBhcmF0ZShmLCBkdCk7XG5cbiAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHtcbiAgICAgIGNvbnN0IHQgPSB0aGlzLnRpbWUgLSBmLmF0dGFja1N0YXJ0O1xuICAgICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAodGcgJiYgdGcuYWxpdmUpIHRoaXMuZmFjZShmLCB0Zy54IC0gZi54LCB0Zy56IC0gZi56LCBkdCk7XG4gICAgICBpZiAoIWYuaGl0RG9uZSAmJiB0ID49IGYuYXR0YWNrRHVyICogc3QuaGl0RnJhYykgeyBmLmhpdERvbmUgPSB0cnVlOyB0aGlzLnJlc29sdmVIaXQoZik7IH1cbiAgICAgIGlmICh0ID49IGYuYXR0YWNrRHVyKSBmLnN0YXRlID0gJ2lkbGUnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFjcXVpcmUoZik7XG4gICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmICghdGcgfHwgIXRnLmFsaXZlKSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IHJldHVybjsgfVxuICAgIGNvbnN0IGR4ID0gdGcueCAtIGYueCwgZHogPSB0Zy56IC0gZi56LCBkaXN0ID0gTWF0aC5oeXBvdChkeCwgZHopO1xuICAgIHRoaXMuZmFjZShmLCBkeCwgZHosIGR0KTtcbiAgICBpZiAoZGlzdCA8PSBmLnJhbmdlKSB7XG4gICAgICBpZiAodGhpcy50aW1lID49IGYubmV4dEF0dGFjaykgdGhpcy5zdGFydEF0dGFjayhmKTsgZWxzZSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IH1cbiAgICB9IGVsc2Uge1xuICAgICAgZi5zdGF0ZSA9ICdydW4nOyBsZXQgbXggPSBkeCAvIE1hdGgubWF4KGRpc3QsIDFlLTQpLCBteiA9IGR6IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCk7XG4gICAgICAvLyB3YWxrIEFST1VORCBhbnlvbmUgc3RhbmRpbmcgaW4gdGhlIHdheSAoYWxsaWVzIGFuZCBlbmVtaWVzIGFsaWtlLCBleGNlcHQgdGhlIHRhcmdldCk6IGVhY2ggYmxvY2tlciBhaGVhZCBiZW5kcyB0aGUgaGVhZGluZyBhd2F5IGZyb20gaXRcbiAgICAgIGxldCBzeCA9IDAsIHN6ID0gMDtcbiAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChvID09PSBmIHx8ICFvLmFsaXZlIHx8IG8uaWQgPT09IHRnLmlkKSBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgb3ggPSBvLnggLSBmLngsIG96ID0gby56IC0gZi56LCBhbG9uZyA9IG94ICogbXggKyBveiAqIG16LCByZWFjaCA9IGYucmFkaXVzICsgby5yYWRpdXMgKyAwLjM1O1xuICAgICAgICBpZiAoYWxvbmcgPD0gMCB8fCBhbG9uZyA+IHJlYWNoICsgMC45KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgbGF0ID0gb3ggKiAtbXogKyBveiAqIG14LCBuZWVkID0gZi5yYWRpdXMgKyBvLnJhZGl1cyArIDAuMTI7IGlmIChNYXRoLmFicyhsYXQpID49IG5lZWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBzaWRlID0gbGF0ID09PSAwID8gKGYuaWQgJSAyID8gMSA6IC0xKSA6IChsYXQgPiAwID8gLTEgOiAxKSwgdyA9ICgxIC0gTWF0aC5hYnMobGF0KSAvIG5lZWQpICogKDEgLSBNYXRoLm1heCgwLCBhbG9uZyAtIHJlYWNoKSAvIDAuOSk7XG4gICAgICAgIHN4ICs9IC1teiAqIHNpZGUgKiB3ICogMS42OyBzeiArPSBteCAqIHNpZGUgKiB3ICogMS42O1xuICAgICAgfVxuICAgICAgaWYgKHN4IHx8IHN6KSB7IG14ICs9IHN4OyBteiArPSBzejsgY29uc3QgbCA9IE1hdGguaHlwb3QobXgsIG16KSB8fCAxOyBteCAvPSBsOyBteiAvPSBsOyB9XG4gICAgICBmLnggKz0gbXggKiBmLnNwZWVkICogZHQ7IGYueiArPSBteiAqIGYuc3BlZWQgKiBkdDsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICAvKipcbiAgICogS2VlcCBmaWdodGVycyBmcm9tIHN0YWNraW5nIHdpdGhvdXQgc2hvdmluZyBhbnlvbmUgYWNyb3NzIHRoZSBtYXAuXG4gICAqIC0gQSBmaWdodGVyIHRoYXQgaXMgc3RhbmRpbmcgYW5kIGZpZ2h0aW5nIGlzIFwicGxhbnRlZFwiOiBpdCBiYXJlbHkgbW92ZXM7IHRoZSBvbmVzIHN0aWxsIFdBTEtJTkcgeWllbGQgdG8gaXQuXG4gICAqIC0gSGVhdmllciB1bml0cyAoT2dyZSwgS25pZ2h0KSBwdXNoIGxpZ2h0ZXIgb25lcyBtb3JlIHRoYW4gdGhlIG90aGVyIHdheSByb3VuZC5cbiAgICogLSBUaGUgdG90YWwgcHVzaCBvbiBvbmUgZmlnaHRlciBpcyBjYXBwZWQgcGVyIHNlY29uZCwgc28gYSBjcm93ZCBjYW4gbmV2ZXIgc2xpZGUgYSB1bml0IGZhci5cbiAgICovXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IHBsYW50ZWQgPSAodTogRmlnaHRlcikgPT4gdS5zdGF0ZSA9PT0gJ2F0dGFjaycgfHwgdS5zdGF0ZSA9PT0gJ2lkbGUnLCBtYXNzID0gKHU6IEZpZ2h0ZXIpID0+IHUucmFkaXVzICogdS5yYWRpdXM7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgbGV0IHNoYXJlID0gbWFzcyhvKSAvIChtYXNzKGYpICsgbWFzcyhvKSk7ICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgbGlnaHRlciBvbmUgb2YgdGhlIHBhaXIgbW92ZXMgbW9yZVxuICAgICAgY29uc3QgcGYgPSBwbGFudGVkKGYpLCBwbyA9IHBsYW50ZWQobyk7XG4gICAgICBpZiAocGYgJiYgIXBvKSBzaGFyZSAqPSAwLjEyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZiBpcyBzdGFuZGluZyBpdHMgZ3JvdW5kOiB0aGUgd2Fsa2VyIG8gZ29lcyBhcm91bmRcbiAgICAgIGVsc2UgaWYgKCFwZiAmJiBwbykgc2hhcmUgPSBNYXRoLm1pbigxLCBzaGFyZSAqIDEuNSArIDAuMzUpOyAgICAvLyBmIGlzIHdhbGtpbmcgaW50byBhIHBsYW50ZWQgdW5pdDogZiB5aWVsZHNcbiAgICAgIGVsc2UgaWYgKHBmICYmIHBvKSBzaGFyZSAqPSAwLjM1OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0d28gc3RhbmRpbmcgdW5pdHMgb3ZlcmxhcCBhIGxpdHRsZTogZWFzZSBhcGFydCB2ZXJ5IHNsb3dseVxuICAgICAgY29uc3QgayA9ICgod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMykpICogc2hhcmUgKiAyO1xuICAgICAgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBsZXQgbXggPSBweCAqIHMsIG16ID0gcHogKiBzO1xuICAgIGNvbnN0IGNhcCA9IChwbGFudGVkKGYpID8gMC41IDogMS42KSAqIGR0LCBsZW4gPSBNYXRoLmh5cG90KG14LCBteik7ICAgLy8gbWV0cmVzIHBlciBzZWNvbmQsIHN0YW5kaW5nIHZzIHdhbGtpbmdcbiAgICBpZiAobGVuID4gY2FwKSB7IG14ICo9IGNhcCAvIGxlbjsgbXogKj0gY2FwIC8gbGVuOyB9XG4gICAgZi54ICs9IG14OyBmLnogKz0gbXo7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicgJiYgY3VyICYmIGN1ci5hbGl2ZSAmJiBNYXRoLmh5cG90KGN1ci54IC0gZi54LCBjdXIueiAtIGYueikgPD0gZi5yYW5nZSAqIDEuMykgcmV0dXJuOyAgIC8vIGFscmVhZHkgaW4gcmVhY2ggb2Ygc29tZW9uZTogaGl0IHRoZW0sIGRvbid0IHdhbmRlciBvZmYgYWZ0ZXIgYSBqdWljaWVyIHRhcmdldFxuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJyAmJiBvLmlkID09PSBmLnRhcmdldCkgc2NvcmUgLT0gMS41OyAgIC8vIHN0aWNrIHdpdGggYSB0YXJnZXQgdW5sZXNzIGFub3RoZXIgaXMgY2xlYXJseSBiZXR0ZXJcbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzAsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQsIGxldmVscywgZW5lbXlQb3dlcik7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgIi8vIEVuZGxlc3MgRGVwdGhzOiBlbmVteSB3YXZlcyBidWlsdCBmcm9tIGEgQlVER0VUIGluc3RlYWQgb2YgYSBoYW5kLXdyaXR0ZW4gbGlzdCwgc28gdGhlIG1vZGUgbmV2ZXIgcnVucyBvdXQgb2Ygd2F2ZXMuXG4vLyBUaGUgYnVkZ2V0IGlzIHRoZSBlbmVteSB0ZWFtJ3MgdG90YWwgRG9taW5pb24gY29zdCAodGhlIHNhbWUgQ09TVCB0YWJsZSB0aGUgcGxheWVyIHBheXMgZnJvbSkuIFdhdmVzIGFyZSBidWlsdCBmcm9tIHJvbGUgVEVNUExBVEVTIHNvIHRoZXlcbi8vIGxvb2sgZGVzaWduZWQgKGEgZnJvbnQgbGluZSB3aXRoIGFyY2hlcnMgYmVoaW5kLCBhIHN3YXJtLCBhIGJydXRlIHNxdWFkKSBpbnN0ZWFkIG9mIGEgcmFuZG9tIHBpbGUuIEV2ZXJ5dGhpbmcgaXMgc2VlZGVkOiB0aGUgc2FtZSBzZWVkIGdpdmVzXG4vLyB0aGUgc2FtZSB3YXZlcywgc28gYSByZXRyeSAob3IgYSBkYWlseSBzZWVkKSBmYWNlcyBleGFjdGx5IHRoZSBzYW1lIGFybXkuXG4vL1xuLy8gVGhlIHBsYXllcidzIGFybXkgaXMgY2FwcGVkIG9uIHB1cnBvc2UgKERvbWluaW9uIHN0b3BzIGF0IDQwLCB0aGUgZ3JpZCBob2xkcyAxMiksIHNvIGF0IHNvbWUgcG9pbnQgdGhlIGVuZW15IHNpbXBseSBvdXQtc2NhbGVzIGl0OiB0aGF0IGlzIHRoZVxuLy8gXCJoYXJkIHdhbGxcIi4gT25jZSB0aGUgYnVkZ2V0IGZpbGxzIHRoZSAxMiBzbG90cyB3aXRoIHVwZ3JhZGVkIHVuaXRzLCBgZW5kbGVzc1Bvd2VyYCAodGhlIGhpZGRlbiBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIpIGtlZXBzIGNsaW1iaW5nLlxuLy8gTnVtYmVycyBoZXJlIGFyZSB0dW5lZCB3aXRoIHNpbS9lbmRsZXNzX2N1cnZlLnRzLlxuXG5pbXBvcnQgeyBDT1NUIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IEVuZW15U3BlYyB9IGZyb20gJy4vd2F2ZXMudHMnO1xuXG5leHBvcnQgY29uc3QgRU5ETEVTU19JRCA9ICdlbmRsZXNzJztcbi8qKiBBIHBhY2sgaXMgZ3JhbnRlZCBldmVyeSB0aGlzLW1hbnkgd2F2ZXMgY2xlYXJlZCBpbiBhbiBlbmRsZXNzIHJ1bi4gKi9cbmV4cG9ydCBjb25zdCBFTkRMRVNTX1BBQ0tfRVZFUlkgPSAxMDtcbmNvbnN0IE1BWF9VTklUUyA9IDEyO1xuXG4vKiogVGhlIHR1bmluZyBrbm9icyAoc2ltL2VuZGxlc3NfY3VydmUudHMgc3dlZXBzIHRoZW0pLiAqL1xuZXhwb3J0IGNvbnN0IFRVTkUgPSB7IHN0YXJ0OiA1LCBzbG9wZTogMy4wLCBsYXRlU2xvcGU6IDAuOCwgbWF4QnVkZ2V0OiAxNTAsIHBvd2VyU2xvcGU6IDAuMDEyLCBjaGFtcGlvbjogMS4wIH07XG4vKiogVG90YWwgRG9taW5pb24gY29zdCBvZiB0aGUgZW5lbXkgdGVhbSBhdCB3YXZlIGBuYCAoMS1iYXNlZCk6IGEgZ2VudGxlIHN0YXJ0IChhYm91dCB0aGUgTm9ybWFsIGNhbXBhaWduIGJ5IHdhdmUgMTApLCB0aGVuIGl0IGtlZXBzIHJpc2luZy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzQnVkZ2V0KG46IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHcgPSBNYXRoLm1heCgxLCBuKSwgZWFybHkgPSBUVU5FLnN0YXJ0ICsgVFVORS5zbG9wZSAqIChNYXRoLm1pbih3LCAxMCkgLSAxKTtcbiAgcmV0dXJuIE1hdGgucm91bmQoTWF0aC5taW4oVFVORS5tYXhCdWRnZXQsIGVhcmx5ICsgKHcgPiAxMCA/IFRVTkUubGF0ZVNsb3BlICogKHcgLSAxMCkgOiAwKSkpO1xufVxuLyoqIEhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXI6IDEuMCB0aHJvdWdoIHdhdmUgMTAsIHRoZW4gcmlzaW5nOyBldmVyeSAxMHRoIChjaGFtcGlvbikgd2F2ZSBnZXRzIGEgbGl0dGxlIGV4dHJhLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NQb3dlcihuOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgbiksIGJhc2UgPSB3IDw9IDEwID8gMSA6IDEgKyBUVU5FLnBvd2VyU2xvcGUgKiAodyAtIDEwKTtcbiAgcmV0dXJuICsodyAlIDEwID09PSAwID8gYmFzZSAqIFRVTkUuY2hhbXBpb24gOiBiYXNlKS50b0ZpeGVkKDMpO1xufVxuLyoqIFBhY2sgdGllciBmb3IgY2xlYXJpbmcgd2F2ZSBgbmAgKG9ubHkgbWVhbmluZ2Z1bCB3aGVuIG4gaXMgYSBtdWx0aXBsZSBvZiBFTkRMRVNTX1BBQ0tfRVZFUlkpLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NQYWNrVGllciA9IChuOiBudW1iZXIpOiBudW1iZXIgPT4gKG4gPj0gMzAgPyAzIDogbiA+PSAyMCA/IDIgOiAxKTtcblxudHlwZSBSb2xlID0gJ3RhbmsnIHwgJ2JydXRlJyB8ICdyYW5nZWQnIHwgJ2ZvZGRlcic7XG5jb25zdCBST0xFOiBSZWNvcmQ8Um9sZSwgU291bElkW10+ID0geyB0YW5rOiBbJ2tuaWdodCcsICdvZ3JlJ10sIGJydXRlOiBbJ2JhcmJhcmlhbicsICdvZ3JlJ10sIHJhbmdlZDogWydhcmNoZXInXSwgZm9kZGVyOiBbJ3dhcnJpb3InLCAnZ29ibGluJ10gfTtcbmV4cG9ydCBpbnRlcmZhY2UgVGVtcGxhdGUgeyBpZDogc3RyaW5nOyBtaXg6IFtSb2xlLCBudW1iZXJdW10gfVxuZXhwb3J0IGNvbnN0IFRFTVBMQVRFUzogVGVtcGxhdGVbXSA9IFtcbiAgeyBpZDogJ3dhbGwnLCBtaXg6IFtbJ3RhbmsnLCAzXSwgWydyYW5nZWQnLCAyXSwgWydmb2RkZXInLCAxXV0gfSxcbiAgeyBpZDogJ3N3YXJtJywgbWl4OiBbWydmb2RkZXInLCA1XSwgWydyYW5nZWQnLCAxXSwgWyd0YW5rJywgMV1dIH0sXG4gIHsgaWQ6ICdicnV0ZXMnLCBtaXg6IFtbJ2JydXRlJywgNF0sIFsnZm9kZGVyJywgMV0sIFsncmFuZ2VkJywgMV1dIH0sXG4gIHsgaWQ6ICdtaXhlZCcsIG1peDogW1sndGFuaycsIDFdLCBbJ2JydXRlJywgMV0sIFsncmFuZ2VkJywgMV0sIFsnZm9kZGVyJywgMl1dIH0sXG5dO1xuXG4vKiogV2F2ZXMgMS0yIGFyZSBhIGdlbnRsZSB3YXJtLXVwOiBjaGVhcCBmb2RkZXIgKGFuZCBhbiBhcmNoZXIpLCBubyB0YW5rcyBvciBicnV0ZXMsIHNvIG5vYm9keSBsb3NlcyBhIGhlYXJ0IHRvIHRoZSBmaXJzdCBmaWdodC4gKi9cbmNvbnN0IFdBUk1VUDogVGVtcGxhdGUgPSB7IGlkOiAnd2FybXVwJywgbWl4OiBbWydmb2RkZXInLCAzXSwgWydyYW5nZWQnLCAxXV0gfTtcbi8qKiBXaGljaCB0ZW1wbGF0ZSBhIHdhdmUgdXNlcyAoc2VlZGVkIHBlciB3YXZlLCBzbyBpdCBkb2VzIG5vdCBkZXBlbmQgb24gd2hhdCBjYW1lIGJlZm9yZSkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc1RlbXBsYXRlKG46IG51bWJlciwgc2VlZDogbnVtYmVyKTogVGVtcGxhdGUge1xuICBpZiAobiA8PSAyKSByZXR1cm4gV0FSTVVQO1xuICByZXR1cm4gVEVNUExBVEVTW01hdGguZmxvb3IobWFrZVJuZyhzZWVkICogNDA5OSArIG4gKiAzMSArIDUpLm5leHQoKSAqIFRFTVBMQVRFUy5sZW5ndGgpXTtcbn1cblxuLyoqIFRoZSBlbmVteSBhcm15IGZvciBlbmRsZXNzIHdhdmUgYG5gICgxLWJhc2VkKS4gQXQgbW9zdCAxMiB1bml0czsgdGhlIHdob2xlIGJ1ZGdldCBpcyBzcGVudCB1bmxlc3Mgbm8gdW5pdCBmaXRzIHdoYXQgaXMgbGVmdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzV2F2ZShuOiBudW1iZXIsIHNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBjb25zdCB3YXZlID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihuKSksIHJuZyA9IG1ha2VSbmcoc2VlZCAqIDEwMDkgKyB3YXZlICogNzkxOSArIDE3KSwgdHBsID0gZW5kbGVzc1RlbXBsYXRlKHdhdmUsIHNlZWQpO1xuICBsZXQgbGVmdCA9IGVuZGxlc3NCdWRnZXQod2F2ZSk7IGNvbnN0IGFybXk6IEVuZW15U3BlY1tdID0gW107XG4gIGlmICh3YXZlICUgMTAgPT09IDAgJiYgbGVmdCA+PSAyMCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hhbXBpb24gd2F2ZTogb25lIHN0YXJyZWQgYnJ1dGUgdXAgZnJvbnQgKDIgc3RhcnMsIDMgZnJvbSB3YXZlIDQwKSwgdGhlbiB0aGUgdXN1YWwgZXNjb3J0XG4gICAgY29uc3Qgc291bDogU291bElkID0gcm5nLm5leHQoKSA8IDAuNSA/ICdvZ3JlJyA6ICdrbmlnaHQnLCBzdGFyID0gd2F2ZSA+PSA0MCA/IDMgOiAyOyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICB9XG4gIGNvbnN0IHRvdGFsID0gdHBsLm1peC5yZWR1Y2UoKGEsIFssIHddKSA9PiBhICsgdywgMCk7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA4MCAmJiBhcm15Lmxlbmd0aCA8IE1BWF9VTklUUyAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBsZXQgciA9IHJuZy5uZXh0KCkgKiB0b3RhbCwgcm9sZTogUm9sZSA9IHRwbC5taXhbMF1bMF07XG4gICAgZm9yIChjb25zdCBbcm8sIHddIG9mIHRwbC5taXgpIHsgciAtPSB3OyBpZiAociA8PSAwKSB7IHJvbGUgPSBybzsgYnJlYWs7IH0gfVxuICAgIGxldCBvcHRpb25zID0gUk9MRVtyb2xlXS5maWx0ZXIoKHMpID0+IENPU1Rbc11bMF0gPD0gbGVmdCk7XG4gICAgaWYgKCFvcHRpb25zLmxlbmd0aCkgb3B0aW9ucyA9IFJPTEUuZm9kZGVyLmZpbHRlcigocykgPT4gQ09TVFtzXVswXSA8PSBsZWZ0KTtcbiAgICBpZiAoIW9wdGlvbnMubGVuZ3RoKSBicmVhaztcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2sob3B0aW9ucyksIHBlciA9IGxlZnQgLyBNYXRoLm1heCgxLCBNQVhfVU5JVFMgLSBhcm15Lmxlbmd0aCk7XG4gICAgbGV0IHN0YXIgPSAxOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzcGFyZSBidWRnZXQgcGVyIGZyZWUgc2xvdCBidXlzIHN0YXJzXG4gICAgZm9yIChsZXQgcyA9IDM7IHMgPj0gMjsgcy0tKSBpZiAoQ09TVFtzb3VsXVtzIC0gMV0gPD0gbGVmdCAmJiBDT1NUW3NvdWxdW3MgLSAxXSA8PSBNYXRoLm1heChDT1NUW3NvdWxdWzBdLCBwZXIgKiAxLjIpKSB7IHN0YXIgPSBzOyBicmVhazsgfVxuICAgIGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gIH1cbiAgcmV0dXJuIGFybXk7XG59XG4iLCAiLy8gRW5lbXkgd2F2ZXMgYW5kIHRoZSBjYW1wYWlnbidzIHN0YWdlcy4gU2FtZSB1bml0IHBvb2wgYXMgdGhlIHBsYXllci4gVGhlIGJ1aWxkIHNjcmVlbiBwcmV2aWV3cyB0aGUgQ09NUE9TSVRJT04gb25seSwgbmV2ZXIgcG9zaXRpb25zLlxuLy9cbi8vIEVhY2ggU1RBR0UgaGFzIGZvdXIgZGlmZmljdWx0eSB0aWVycyAoZWFzeSAvIG5vcm1hbCAvIGhhcmQgLyBuaWdodG1hcmUpLiBMYXRlciBzdGFnZXMgYXJlIGhhcmRlcjogdGhleSByZXVzZSB0b3VnaGVyIHdhdmUgbGlzdHMgYW5kIGEgaGlkZGVuXG4vLyBFTkVNWSBQT1dFUiBtdWx0aXBsaWVyIChoZWFsdGggYW5kIGRhbWFnZSBvZiBlbmVteSB1bml0cykgdHVuZWQgcGVyIHN0YWdlIGFuZCB0aWVyIHdpdGggc2ltL2NhbGlicmF0ZV9wb3dlci50cywgc28gdGhhdCB0aGUgY29tcGV0ZW50XG4vLyBzdGFuZC1pbiBwbGF5ZXIgY2xlYXJzIGVhY2ggdGllciBhYm91dCA2MCUgb2YgdGhlIHRpbWUgYXQgdGhhdCB0aWVyJ3MgUkVDT01NRU5ERUQgU09VTCBMRVZFTCAoZXZlcnkgU291bCBhdCB0aGF0IGxldmVsKS5cbi8vIFVubG9jayBydWxlcyBsaXZlIGluIHByb2dyZXNzLnRzOiBFYXN5IGFuZCBOb3JtYWwgYXJlIGFsd2F5cyBvcGVuOyBjbGVhcmluZyBOb3JtYWwgb3BlbnMgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2U7IGNsZWFyaW5nIEhhcmQgb3BlbnMgTmlnaHRtYXJlLlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMsIFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IEVORExFU1NfSUQsIGVuZGxlc3NQb3dlciwgZW5kbGVzc1dhdmUgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBFbmVteVNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5leHBvcnQgdHlwZSBEaWZmID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGUzogRGlmZltdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuXG5jb25zdCBMRVRURVI6IFJlY29yZDxzdHJpbmcsIFNvdWxJZD4gPSB7IFc6ICd3YXJyaW9yJywgQTogJ2FyY2hlcicsIEc6ICdnb2JsaW4nLCBLOiAna25pZ2h0JywgTzogJ29ncmUnLCBCOiAnYmFyYmFyaWFuJyB9O1xuY29uc3QgcGFyc2VXYXZlID0gKHM6IHN0cmluZyk6IEVuZW15U3BlY1tdID0+IHMuc3BsaXQoJyAnKS5tYXAoKHQpID0+ICh7IHNvdWw6IExFVFRFUlt0WzBdXSwgc3RhcjogK3RbMV0gfSkpO1xuXG4vKipcbiAqIFdhdmUgbGlzdHMgKFcgd2FycmlvciwgQSBhcmNoZXIsIEcgZ29ibGluLCBLIGtuaWdodCwgTyBvZ3JlLCBCIGJhcmJhcmlhbjsgZGlnaXQgPSBzdGFycykuIFRoZXNlIGZvdXIgd2VyZSB0dW5lZCBmb3IgU3RhZ2UgMTsgbGF0ZXIgc3RhZ2VzXG4gKiByZXVzZSB0aGVtIG9uZSB0aWVyIHVwIGFuZCBhZGQgZW5lbXkgcG93ZXIuIEhhcmQgYW5kIE5pZ2h0bWFyZSBhcmUgdm9sdW1lLWRyaXZlbiAodXAgdG8gMTIgZW5lbWllcykuXG4gKiBDb21wZXRlbnQgc3RhbmQtaW4gY2xlYXIgcmF0ZSB3aXRoIEVWRVJZIFNvdWwgYXQgbGV2ZWwgMSAvIDQgLyA2OiBlYXN5IDk4LzEwMC8xMDAsIG5vcm1hbCA4Mi85OC8xMDAsIGhhcmQgNy82MC84NywgbmlnaHRtYXJlIDAvMzMvNzQuXG4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEnLCAnSzEgVzEnLCAnTzEgVzEgRzEnLCAnSzEgQTEgVzEnLCAnTzEgQTEgRzEnLCAnSzEgTzEgQTEnLCAnSzEgTzEgQTEgRzEnLCAnTzEgSzEgQTEgRzEnLCAnTzEgSzEgQTEgQjEnLCAnTzIgSzEgQTEgRzEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExJywgJ0sxIEcxIFcxJywgJ08xIEExIEcxIFcxJywgJ0sxIE8xIEExIFcxJywgJ08xIEsxIEExIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxJywgJ0sxIE8xIEExIEcxIFcxJywgJ08xIEsxIEExIEIxIEcxJywgJ08xIEsxIEEyIEIxIEcxJywgJ08yIEsxIEExIEIxIEcxIFcxJ10sXG4gIGhhcmQ6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgQTEgRzEgVzEgVzEnLCAnSzEgTzEgQTEgVzEgRzEgVzEnLCAnTzEgSzEgQTIgRzEgVzEgVzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEgVzEgVzEnLCAnSzEgTzEgQTEgRzEgVzIgVzEgVzEnLCAnTzEgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzIgQTEgQjEgRzEgVzEgVzEgVzEgRzEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ08xIEExIEcxIFcxIEIxIFcxJywgJ0sxIE8xIEExIFcxIEcxIFcxIFcxJywgJ08xIEsxIEEyIEcxIFcxIEIxIFcxIFcxIEcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxIFcxIFcxIEcxIEcxJywgJ0sxIE8xIEEyIEcxIFcxIEIxIFcxIFcxIEcxIEcxIEIxJywgJ08xIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxJywgJ08yIEsxIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJywgJ08yIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJ10sXG59O1xuXG4vKiogU3RhZ2UgMiwgdGhlIFN1bmtlbiBHcmF2ZXlhcmQ6IGNyb3dkcy4gU2FtZSBEb21pbmlvbiBjb3N0IHBlciB3YXZlIGFzIHRoZSBsaXN0cyBvbmUgdGllciB1cCwgYnV0IGJ1aWx0IGZyb20gbWFueSBXYXJyaW9ycywgR29ibGlucyBhbmQgQXJjaGVycyB3aXRoIGEgS25pZ2h0IG9yIE9ncmUgaG9sZGluZyB0aGUgZnJvbnQgKHNpbS9hdXRob3Jfc3RhZ2VzLnRzKS4gKi9cbmNvbnN0IEdSQVZFWUFSRDogUmVjb3JkPERpZmYsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMSBBMScsICdLMSBHMSBXMScsICdPMSBXMSBXMSBXMSBHMScsICdPMSBHMiBHMSBBMScsICdPMSBXMSBXMSBXMSBBMSBBMScsICdLMSBXMSBXMSBXMSBBMSBBMSBBMScsICdPMSBXMSBXMSBXMSBXMSBXMSBBMScsICdPMSBXMSBXMSBXMSBXMSBHMSBHMSBHMScsICdLMSBXMSBXMSBXMSBXMSBXMSBHMiBHMSBBMScsICdLMSBXMSBXMSBXMSBXMSBHMSBHMSBHMSBHMSBBMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgVzEgVzEgVzEgRzEgQTEnLCAnTzEgVzEgVzEgRzEgRzEgRzEgRzEnLCAnTzEgVzIgVzEgVzEgVzEgVzEgVzEgRzEgQTEnLCAnSzEgVzEgVzEgVzEgVzEgVzEgRzEgRzEgRzEgQTEgQTEnLCAnSzEgVzEgVzEgVzEgRzEgQTEgQTEgQTEnLCAnTzEgVzEgVzEgRzEgRzEgQTEgQTEgQTEgQTEnLCAnSzIgVzEgVzEgVzEgVzEgVzEgVzEgRzEgRzEgRzEgQTEgQTEnLCAnTzEgVzIgVzEgVzEgVzEgVzEgVzEgRzEgRzEgQTEgQTEgQTEnXSxcbiAgaGFyZDogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBXMSBXMSBXMSBXMSBHMiBBMScsICdPMSBXMSBXMSBHMSBHMSBBMSBBMScsICdPMSBXMSBXMSBXMSBXMSBXMSBHMSBHMSBBMSBBMSBBMScsICdLMSBXMyBXMiBXMiBXMiBXMSBXMSBXMSBXMSBBMSBBMSBBMScsICdPMSBXMyBXMiBXMiBXMiBXMiBXMSBXMSBXMSBHMyBHMiBBMScsICdPMiBXMiBXMiBXMSBXMSBXMSBHMiBHMSBHMSBHMSBBMiBBMScsICdLMyBXMyBXMyBXMyBXMiBXMiBXMSBXMSBHMiBHMSBHMSBBMycsICdLMyBXMyBXMyBXMiBXMiBXMSBHMyBHMiBHMiBHMSBBMiBBMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgVzEgVzEgVzEgRzEgRzEgQTEnLCAnTzEgVzEgVzEgVzEgVzEgRzEgRzEgQTEnLCAnSzEgVzEgVzEgVzEgVzEgVzEgVzEgVzEgVzEgQTIgQTEgQTEnLCAnTzEgVzMgVzIgVzEgVzEgVzEgVzEgVzEgRzIgRzEgRzEgQTEnLCAnTzEgVzIgVzEgVzEgVzEgRzIgRzEgRzEgRzEgQTIgQTEgQTEnLCAnTzIgVzIgVzEgVzEgVzEgVzEgRzIgRzEgRzEgQTIgQTEgQTEnLCAnSzIgVzMgVzEgVzEgVzEgRzIgRzIgRzEgQTMgQTIgQTEgQTEnLCAnTzIgVzEgVzEgVzEgRzIgRzIgRzIgRzEgRzEgQTMgQTIgQTEnXSxcbn07XG4vKiogU3RhZ2UgMywgdGhlIEJvbmUgQmFzdGlvbjogZmV3ZXIsIGhlYXZpZXIgYXJtaWVzIG9mIEtuaWdodHMsIE9ncmVzIGFuZCBCYXJiYXJpYW5zIHdpdGggQXJjaGVycyBiZWhpbmQgKHNpbS9hdXRob3Jfc3RhZ2VzLnRzKS4gKi9cbmNvbnN0IEJBU1RJT046IFJlY29yZDxEaWZmLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgQTEgQTEnLCAnSzEgSzEgSzEgQTEgQTEnLCAnSzEgTzEgQjEgQjEgQTEnLCAnSzEgSzEgTzEgTzEgQTEgQTEnLCAnSzEgSzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgTzEgQjEgQjEnLCAnSzIgSzEgTzEgTzEgQjEgQjEnLCAnSzEgSzEgTzEgTzEgQjEgQjEgQTEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ0sxIEsxIEsxIEExIEExJywgJ08xIE8xIEIxIEIxJywgJ0syIEsxIEsxIE8xIEIxIEIxJywgJ0sxIE8xIE8xIEIxIEIxIEExIEExJywgJ0syIEsxIEsxIEsxIEIyIEIxIEIxIEExJywgJ0syIEsxIEsxIE8xIEIxIEIxIEEyIEExJywgJ0syIEsyIE8yIEIxIEIxIEEyIEEyIEExJywgJ0syIEsyIEsyIEsxIEIyIEIyIEEzIEExJ10sXG4gIGhhcmQ6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgQjEgQTEgQTEnLCAnSzEgSzEgTzEgQTEgQTEnLCAnSzEgTzEgQjEgQjEgQjEgQTEgQTEnLCAnSzEgSzEgSzEgTzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgSzEgTzEgQjEgQjEgQjEnLCAnSzIgSzEgSzEgTzEgTzEgQjEgQjEgQTEnLCAnSzIgSzEgTzEgTzEgQjEgQjEgQjEgQTMnLCAnSzIgSzIgSzEgSzEgTzEgTzEgQjMgQjEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ0sxIEsxIE8xIEIxJywgJ0syIEsxIEsxIE8xJywgJ0syIEsxIEsxIEsxIEsxIE8xJywgJ0sxIEsxIEsxIE8xIE8xIEIxIEExJywgJ0sxIEsxIEsxIEIyIEIxIEIxIEEyIEExJywgJ0sxIE8xIE8xIE8xIEIyIEExIEExIEExJywgJ0sxIE8yIE8xIE8xIE8xIEIxIEIxIEExJywgJ0szIEsyIEsxIEsxIEsxIE8yIEIxIEIxJ10sXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFN0YWdlRGVmIHtcbiAgaWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBibHVyYjogc3RyaW5nO1xuICBsaXN0czogUmVjb3JkPERpZmYsIHN0cmluZ1tdPjsgICAgICAgICAgLy8gdGhlIDEwIGVuZW15IHdhdmVzIGZvciBlYWNoIHRpZXJcbiAgcG93ZXI6IFJlY29yZDxEaWZmLCBudW1iZXI+OyAgICAgICAgICAgIC8vIGhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIGVhY2ggdGllciAoMSA9IGFzIHdyaXR0ZW4pXG4gIHJlYzogUmVjb3JkPERpZmYsIG51bWJlcj47ICAgICAgICAgICAgICAvLyByZWNvbW1lbmRlZCBTb3VsIGxldmVsIGZvciBlYWNoIHRpZXIgKGEgaGludCBvbiBIb21lLCBuZXZlciBhIGxvY2spXG59XG5cbi8qKiBUaGUgY2FtcGFpZ24uIE5hbWVzIGFyZSBwbGFjZWhvbGRlcnMuIFBvd2VyIG51bWJlcnMgY29tZSBmcm9tIHNpbS9jYWxpYnJhdGVfcG93ZXIudHMuICovXG5leHBvcnQgY29uc3QgU1RBR0VTOiBTdGFnZURlZltdID0gW1xuICB7IGlkOiAnY3J5cHQnLCBuYW1lOiAnVGhlIFJlc3RsZXNzIENyeXB0JywgYmx1cmI6ICdSYWlzZSB5b3VyIGFybXkuIFRoZSBkZWFkIGhlcmUgYXJlIG9ubHkganVzdCBzdGlycmluZy4nLFxuICAgIGxpc3RzOiB7IGVhc3k6IERJRkZJQ1VMVFkuZWFzeSwgbm9ybWFsOiBESUZGSUNVTFRZLm5vcm1hbCwgaGFyZDogRElGRklDVUxUWS5oYXJkLCBuaWdodG1hcmU6IERJRkZJQ1VMVFkubmlnaHRtYXJlIH0sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLCBoYXJkOiAxLCBuaWdodG1hcmU6IDEgfSwgcmVjOiB7IGVhc3k6IDEsIG5vcm1hbDogMSwgaGFyZDogNCwgbmlnaHRtYXJlOiA2IH0gfSxcbiAgeyBpZDogJ2dyYXZleWFyZCcsIG5hbWU6ICdUaGUgU3Vua2VuIEdyYXZleWFyZCcsIGJsdXJiOiAnQmlnZ2VyIGNyb3dkcyBjcmF3bCBvdXQgb2YgdGhlIG11ZC4gTGV2ZWwgeW91ciBTb3VscyBiZWZvcmUgeW91IGNvbWUuJyxcbiAgICBsaXN0czogR1JBVkVZQVJELFxuICAgIHBvd2VyOiB7IGVhc3k6IDEsIG5vcm1hbDogMS4wMiwgaGFyZDogMC44NSwgbmlnaHRtYXJlOiAxLjA1IH0sIHJlYzogeyBlYXN5OiAyLCBub3JtYWw6IDQsIGhhcmQ6IDYsIG5pZ2h0bWFyZTogOCB9IH0sXG4gIHsgaWQ6ICdiYXN0aW9uJywgbmFtZTogJ1RoZSBCb25lIEJhc3Rpb24nLCBibHVyYjogJ0EgZm9ydHJlc3Mgb2YgdGhlIGZhbGxlbi4gT25seSB3ZWxsLWxldmVsbGVkIGFybWllcyBob2xkIHRoZSBnYXRlLicsXG4gICAgbGlzdHM6IEJBU1RJT04sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLjAsIGhhcmQ6IDEuMjUsIG5pZ2h0bWFyZTogMS4zIH0sIHJlYzogeyBlYXN5OiA0LCBub3JtYWw6IDYsIGhhcmQ6IDgsIG5pZ2h0bWFyZTogMTAgfSB9LFxuXTtcbmV4cG9ydCBjb25zdCBzdGFnZUluZGV4ID0gKGlkOiBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMCwgU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gaWQpKTtcbmV4cG9ydCBjb25zdCBzdGFnZUJ5SWQgPSAoaWQ6IHN0cmluZyk6IFN0YWdlRGVmID0+IFNUQUdFU1tzdGFnZUluZGV4KGlkKV07XG5cbi8qKiBOYW1lcyBhbmQgb25lLWxpbmUgcHJvbWlzZXMgZm9yIHRoZSBkaWZmaWN1bHR5IHBpY2tlci4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZX0lORk8gPSBbXG4gIHsgaWQ6ICdlYXN5JywgbGFiZWw6ICdFYXN5JywgYmx1cmI6ICdTbWFsbGVyIGVuZW15IGFybWllcy4gUmVsYXggYW5kIGxlYXJuIGhvdyBtZXJnaW5nIHdvcmtzLicgfSxcbiAgeyBpZDogJ25vcm1hbCcsIGxhYmVsOiAnTm9ybWFsJywgYmx1cmI6ICdUaGUgc3RhbmRhcmQgZmlnaHQuIENsZWFyaW5nIGl0IHVubG9ja3MgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2UuJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnQmlnZ2VyIGFybWllcyB3aXRoIG1vcmUgZm9kZGVyLiBCZXR0ZXIgZmlyc3QtY2xlYXIgcmV3YXJkcy4gQ2xlYXJpbmcgaXQgdW5sb2NrcyBOaWdodG1hcmUuJyB9LFxuICB7IGlkOiAnbmlnaHRtYXJlJywgbGFiZWw6ICdOaWdodG1hcmUnLCBibHVyYjogJ0EgcGFja2VkIGJhdHRsZWZpZWxkIG9mIHN0YXJzIGFuZCBza2lsbHMuIEJ1aWx0IGZvciB3ZWxsLWxldmVsbGVkIFNvdWxzLicgfSxcbl07XG5cbi8vIC0tLS0gd2hhdCB0aGUgbmV4dCBiYXR0bGUgdXNlcyAoc2V0IHdoZW4gYSBydW4gc3RhcnRzKVxuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZTogc3RyaW5nID0gJ25vcm1hbCc7XG5leHBvcnQgbGV0IGN1cnJlbnRTdGFnZUlkOiBzdHJpbmcgPSAnY3J5cHQnO1xubGV0IHBvd2VyID0gMSwgZW5kbGVzc01vZGUgPSBmYWxzZTtcbmxldCBkYWlseVJld3JpdGU6ICgodzogRW5lbXlTcGVjW10sIHdhdmU6IG51bWJlcikgPT4gRW5lbXlTcGVjW10pIHwgbnVsbCA9IG51bGw7ICAgLy8gc2V0IG9ubHkgZHVyaW5nIGEgRGFpbHkgQ2hhbGxlbmdlIHJ1blxuLyoqIEVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGN1cnJlbnQgc3RhZ2UgYW5kIHRpZXIgKGluIGVuZGxlc3MgbW9kZSBpdCBkZXBlbmRzIG9uIHRoZSB3YXZlKS4gKi9cbmV4cG9ydCBjb25zdCBlbmVteVBvd2VyID0gKHdhdmUgPSAxKTogbnVtYmVyID0+IChlbmRsZXNzTW9kZSA/IGVuZGxlc3NQb3dlcih3YXZlKSA6IHBvd2VyKTtcbmV4cG9ydCBjb25zdCBpc0VuZGxlc3MgPSAoKTogYm9vbGVhbiA9PiBlbmRsZXNzTW9kZTtcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyICgxMCB3YXZlcykuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXRTdGFnZURpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFN0YWdlRGlmZmljdWx0eShzdGFnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBzdGFnZUJ5SWQoc3RhZ2UpOyBpZiAoIURJRkZTLmluY2x1ZGVzKG5hbWUgYXMgRGlmZikpIHJldHVybjtcbiAgZW5kbGVzc01vZGUgPSBmYWxzZTsgZGFpbHlSZXdyaXRlID0gbnVsbDsgY3VycmVudFN0YWdlSWQgPSBzdC5pZDsgZGlmZmljdWx0eU5hbWUgPSBuYW1lOyBwb3dlciA9IHN0LnBvd2VyW25hbWUgYXMgRGlmZl07XG4gIEFVVEhPUkVELmxlbmd0aCA9IDA7IHN0Lmxpc3RzW25hbWUgYXMgRGlmZl0uZm9yRWFjaCgodykgPT4gQVVUSE9SRUQucHVzaChwYXJzZVdhdmUodykpKTtcbn1cbi8qKiBTd2l0Y2ggdG8gdGhlIERhaWx5IENoYWxsZW5nZTogU3RhZ2UgMSBOb3JtYWwgd2l0aCB0aGUgZGF5J3MgdHdpc3QgKHNlZSBjb3JlL2RhaWx5LnRzKS4gYGRheWAgaXMga2VwdCBhcyB0aGUgJ2RpZmZpY3VsdHknIHNvIGEgc2F2ZWQgcnVuIGNhbiByZWJ1aWxkIHRoZSBzYW1lIGRheS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXREYWlseShtb2Q6IHsgcG93ZXI6IG51bWJlcjsgZW5lbXk/OiAodzogRW5lbXlTcGVjW10sIHdhdmU6IG51bWJlcikgPT4gRW5lbXlTcGVjW10gfSwgZGF5OiBudW1iZXIpOiB2b2lkIHtcbiAgc2V0U3RhZ2VEaWZmaWN1bHR5KCdjcnlwdCcsICdub3JtYWwnKTsgZGFpbHlSZXdyaXRlID0gbW9kLmVuZW15ID8/IG51bGw7IGN1cnJlbnRTdGFnZUlkID0gJ2RhaWx5JzsgZGlmZmljdWx0eU5hbWUgPSBTdHJpbmcoZGF5KTsgcG93ZXIgPSBtb2QucG93ZXI7XG59XG4vKiogU3dpdGNoIHRvIEVuZGxlc3MgRGVwdGhzOiB3YXZlcyBjb21lIGZyb20gY29yZS9lbmRsZXNzLnRzIGluc3RlYWQgb2YgYSBzdGFnZSBsaXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldEVuZGxlc3MoKTogdm9pZCB7IGVuZGxlc3NNb2RlID0gdHJ1ZTsgZGFpbHlSZXdyaXRlID0gbnVsbDsgY3VycmVudFN0YWdlSWQgPSBFTkRMRVNTX0lEOyBkaWZmaWN1bHR5TmFtZSA9ICdlbmRsZXNzJzsgcG93ZXIgPSAxOyBBVVRIT1JFRC5sZW5ndGggPSAwOyB9XG4vKiogQ2hhbmdlIHRoZSB0aWVyIHdpdGhpbiB0aGUgY3VycmVudCBzdGFnZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXREaWZmaWN1bHR5KG5hbWU6IHN0cmluZyk6IHZvaWQgeyBzZXRTdGFnZURpZmZpY3VsdHkoY3VycmVudFN0YWdlSWQsIG5hbWUpOyB9XG5cbmV4cG9ydCBjb25zdCB3YXZlQ29zdCA9ICh3OiBFbmVteVNwZWNbXSk6IG51bWJlciA9PiB3LnJlZHVjZSgobiwgZSkgPT4gbiArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXSwgMCk7XG5cbi8qKiBFbmVteSBhcm15IGZvciBhIHdhdmUgKDEtYmFzZWQpLiBXYXZlcyBwYXN0IHRoZSBhdXRob3JlZCBvbmVzIGFyZSBnZW5lcmF0ZWQgZnJvbSBhIGZpeGVkIHNlZWQgc28gcmV0cmllcyBmYWNlIHRoZSBzYW1lIGFybXkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlXYXZlKHdhdmU6IG51bWJlciwgc3RhZ2VTZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgaWYgKGVuZGxlc3NNb2RlKSByZXR1cm4gZW5kbGVzc1dhdmUod2F2ZSwgc3RhZ2VTZWVkKTtcbiAgaWYgKHdhdmUgPD0gQVVUSE9SRUQubGVuZ3RoKSB7IGNvbnN0IHcgPSBBVVRIT1JFRFt3YXZlIC0gMV0ubWFwKChlKSA9PiAoeyAuLi5lIH0pKTsgcmV0dXJuIGRhaWx5UmV3cml0ZSA/IGRhaWx5UmV3cml0ZSh3LCB3YXZlKSA6IHc7IH1cbiAgY29uc3QgY2FwID0gQ1VSVkVTLmRvY1tNYXRoLm1pbih3YXZlLCBDVVJWRVMuZG9jLmxlbmd0aCkgLSAxXTtcbiAgY29uc3QgYnVkZ2V0ID0gTWF0aC5yb3VuZChjYXAgKiAwLjkyKTtcbiAgY29uc3Qgcm5nID0gbWFrZVJuZyhzdGFnZVNlZWQgKiAxMDA5ICsgd2F2ZSAqIDc5MTkpO1xuICBjb25zdCBhcm15OiBFbmVteVNwZWNbXSA9IFtdO1xuICBsZXQgbGVmdCA9IGJ1ZGdldDtcbiAgZm9yIChsZXQgZ3VhcmQgPSAwOyBndWFyZCA8IDQwICYmIGxlZnQgPj0gMjsgZ3VhcmQrKykge1xuICAgIGNvbnN0IHNvdWwgPSBybmcucGljayhTT1VMUyk7XG4gICAgbGV0IHN0YXIgPSAxO1xuICAgIGlmIChybmcubmV4dCgpIDwgMC4zNSAmJiBDT1NUW3NvdWxdWzFdIDw9IGxlZnQpIHN0YXIgPSAyO1xuICAgIGlmICh3YXZlID49IDYgJiYgcm5nLm5leHQoKSA8IDAuMjUgJiYgQ09TVFtzb3VsXVsyXSA8PSBsZWZ0KSBzdGFyID0gMztcbiAgICBjb25zdCBjID0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gICAgaWYgKGMgPD0gbGVmdCAmJiBhcm15Lmxlbmd0aCA8IDEyKSB7IGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gYzsgfVxuICB9XG4gIHJldHVybiBhcm15O1xufVxuXG4vKiogV2hhdCB0aGUgYnVpbGQgc2NyZWVuIHNob3dzOiBjb3VudHMgcGVyIFNvdWwgYW5kIHN0YXIsIG5vIHBvc2l0aW9ucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmV2aWV3VGV4dCh3OiBFbmVteVNwZWNbXSk6IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfVtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfT4oKTtcbiAgZm9yIChjb25zdCBlIG9mIHcpIHtcbiAgICBjb25zdCBrID0gZS5zb3VsICsgZS5zdGFyO1xuICAgIGNvbnN0IGN1ciA9IG1hcC5nZXQoayk7XG4gICAgaWYgKGN1cikgY3VyLmNvdW50Kys7IGVsc2UgbWFwLnNldChrLCB7IHNvdWw6IGUuc291bCwgc3RhcjogZS5zdGFyLCBjb3VudDogMSB9KTtcbiAgfVxuICByZXR1cm4gWy4uLm1hcC52YWx1ZXMoKV07XG59XG4iLCAiaW1wb3J0IHsgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuXG4vKipcbiAqIFJ1bGVzIGZvciB0aGUgcGxheWFibGUgU3RhZ2UgMSAoMTAgd2F2ZXMpOiBkb2MgRG9taW5pb24gY3VydmUsIGJvbnVzIGRyYXcgb25seSBvbiB0aGUgZWFybHkgd2F2ZXMuXG4gKiBtZXJnZSAnaGFuZEludG9PbmVTdGFyJzogYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBtZXJnZSBzdHJhaWdodCBpbnRvIGEgbWF0Y2hpbmcgZGVwbG95ZWQgMS1zdGFyIHVuaXQgKHBheWluZyBvbmx5IHRoZSBjb3N0XG4gKiBkaWZmZXJlbmNlKS4gV2l0aG91dCBpdCB0aGUgY2FwIGNhbiBibG9jayBhIG1lcmdlIHlvdSBjb3VsZCBhZmZvcmQgKHlvdSB3b3VsZCBuZWVkIHJvb20gdG8gc3VtbW9uIEJPVEggY29waWVzIGZpcnN0KS5cbiAqIFRoZSBkZWJ1ZyBwYW5lbCBjYW4gc3dpdGNoIHRoaXMgYmFjayB0byB0aGUgZG9jJ3MgZGVwbG95ZWQtb25seSBydWxlLlxuICovXG5leHBvcnQgY29uc3QgUFJPVE9UWVBFX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IENVUlZFUy5kb2MsIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogMTAsIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG5cbi8qKlxuICogRW5kbGVzcyBEZXB0aHM6IHRoZSBjYW1wYWlnbidzIERvbWluaW9uIGN1cnZlIGZvciB3YXZlcyAxLTEwLCB0aGVuIGhlbGQgYXQgNDAgKHRoZSBwbGF5ZXIncyBhcm15IGlzIGNhcHBlZCBvbiBwdXJwb3NlOyB0aGUgZW5lbXkga2VlcHMgZ3Jvd2luZywgc2VlIGVuZGxlc3MudHMpLlxuICogVGhlIGN1cnZlIGlzIGxvbmcgZW5vdWdoIHRoYXQgYSBydW4gZW5kcyBieSBsb3NpbmcgaGVhcnRzLCBuZXZlciBieSBcImNsZWFyaW5nXCIgdGhlIHN0YWdlIChjb3JlL3J1bGVzLnRzIHJlYWRzIGN1cnZlW3dhdmUtMV0pLlxuICovXG5jb25zdCBFTkRMRVNTX0xFTiA9IDMwMDtcbmV4cG9ydCBjb25zdCBFTkRMRVNTX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IEFycmF5LmZyb20oeyBsZW5ndGg6IEVORExFU1NfTEVOIH0sIChfLCBpKSA9PiBDVVJWRVMuZG9jW01hdGgubWluKGksIENVUlZFUy5kb2MubGVuZ3RoIC0gMSldKSwgbWVyZ2U6ICdoYW5kSW50b09uZVN0YXInLCBzdGFnZVdhdmVzOiBFTkRMRVNTX0xFTiwgbm9ybWFsRHJhd1dhdmVzOiBbMiwgMywgNCwgNV0gfTtcbiIsICIvLyBUaGUgRGFpbHkgQ2hhbGxlbmdlOiBTdGFnZSAxIChOb3JtYWwpIHdpdGggT05FIHR3aXN0IHRoYXQgY2hhbmdlcyBldmVyeSBkYXkuIEV2ZXJ5b25lIGdldHMgdGhlIHNhbWUgdHdpc3QgYW5kIHRoZSBzYW1lIHNlZWQgb24gdGhlIHNhbWUgZGF5XG4vLyAoYm90aCBjb21lIGZyb20gdGhlIGNhbGVuZGFyIGRhdGUsIHNvIG5vIHNlcnZlciBpcyBuZWVkZWQpLiBSZXRyeSBhcyBvZnRlbiBhcyB5b3UgbGlrZTsgdGhlIHJld2FyZCAoYSBwYWNrIGFuZCBzb21lIGdvbGQpIGlzIHBhaWQgb25jZSBwZXIgZGF5LlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgdHlwZSB7IEVuZW15U3BlYyB9IGZyb20gJy4vd2F2ZXMudHMnO1xuaW1wb3J0IHsgd2F2ZUNvc3QgfSBmcm9tICcuL3dhdmVzLnRzJztcblxuZXhwb3J0IGNvbnN0IERBSUxZX0lEID0gJ2RhaWx5JztcblxuZXhwb3J0IGludGVyZmFjZSBEYWlseU1vZCB7XG4gIGlkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nO1xuICBwb3dlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgIC8vIGhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBkYXlcbiAgY2FwRGVsdGE6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAvLyBjaGFuZ2UgdG8gdGhlIHBsYXllcidzIERvbWluaW9uIGV2ZXJ5IHdhdmUgKG5ldmVyIGJlbG93IERBSUxZX01JTl9DQVApXG4gIGVuZW15PzogKHc6IEVuZW15U3BlY1tdLCB3YXZlOiBudW1iZXIpID0+IEVuZW15U3BlY1tdOyAgIC8vIHJld3JpdGVzIGVhY2ggZW5lbXkgd2F2ZVxufVxuZXhwb3J0IGNvbnN0IERBSUxZX01JTl9DQVAgPSA0O1xuY29uc3QgTUFYX1VOSVRTID0gMTI7XG5cbi8qKiBBIGNyb3dkIG9mIFdhcnJpb3JzIGFuZCBHb2JsaW5zIHRoYXQgY29zdHMgYWJvdXQgYGJ1ZGdldGAgRG9taW5pb24uICovXG5mdW5jdGlvbiBjcm93ZChidWRnZXQ6IG51bWJlcik6IEVuZW15U3BlY1tdIHtcbiAgY29uc3Qgb3V0OiBFbmVteVNwZWNbXSA9IFtdOyBsZXQgbGVmdCA9IGJ1ZGdldDtcbiAgZm9yIChsZXQgaSA9IDA7IG91dC5sZW5ndGggPCBNQVhfVU5JVFM7IGkrKykge1xuICAgIGNvbnN0IHNvdWwgPSBpICUgMyA9PT0gMiA/ICdnb2JsaW4nIDogJ3dhcnJpb3InOyBpZiAoQ09TVFtzb3VsXVswXSA+IGxlZnQpIGJyZWFrO1xuICAgIG91dC5wdXNoKHsgc291bCwgc3RhcjogMSB9KTsgbGVmdCAtPSBDT1NUW3NvdWxdWzBdO1xuICB9XG4gIHJldHVybiBvdXQubGVuZ3RoID8gb3V0IDogW3sgc291bDogJ3dhcnJpb3InLCBzdGFyOiAxIH1dO1xufVxuXG5leHBvcnQgY29uc3QgTU9ESUZJRVJTOiBEYWlseU1vZFtdID0gW1xuICB7IGlkOiAnZW1wb3dlcmVkJywgbmFtZTogJ0VtcG93ZXJlZCcsIHRleHQ6ICdFbmVtaWVzIGFyZSAyNSUgc3Ryb25nZXIuJywgcG93ZXI6IDEuMjUsIGNhcERlbHRhOiAwIH0sXG4gIHsgaWQ6ICdtZWxlZScsIG5hbWU6ICdObyBBcmNoZXJzJywgdGV4dDogJ0VuZW15IEFyY2hlcnMgYXJlIHJlcGxhY2VkIGJ5IFdhcnJpb3JzLCBidXQgZXZlcnlvbmUgaGl0cyBoYXJkZXIuJywgcG93ZXI6IDEuMTUsIGNhcERlbHRhOiAwLFxuICAgIGVuZW15OiAodykgPT4gdy5tYXAoKGUpID0+IChlLnNvdWwgPT09ICdhcmNoZXInID8geyBzb3VsOiAnd2FycmlvcicgYXMgY29uc3QsIHN0YXI6IGUuc3RhciB9IDogZSkpIH0sXG4gIHsgaWQ6ICdzd2FybScsIG5hbWU6ICdTd2FybScsIHRleHQ6ICdXYXZlcyBhcmUgY3Jvd2RzIG9mIFdhcnJpb3JzIGFuZCBHb2JsaW5zLicsIHBvd2VyOiAwLjg1LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IGNyb3dkKE1hdGgucm91bmQod2F2ZUNvc3QodykgKiAxLjE1KSkgfSxcbiAgeyBpZDogJ2NyYW1wZWQnLCBuYW1lOiAnQ3JhbXBlZCcsIHRleHQ6ICdZb3VyIERvbWluaW9uIGlzIDQgbG93ZXIgZXZlcnkgd2F2ZS4nLCBwb3dlcjogMSwgY2FwRGVsdGE6IC00IH0sXG4gIHsgaWQ6ICd2ZXRlcmFucycsIG5hbWU6ICdWZXRlcmFucycsIHRleHQ6ICdFbmVteSBPZ3JlcyBhbmQgS25pZ2h0cyBhcmUgYSBzdGFyIGhpZ2hlci4nLCBwb3dlcjogMC45LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IHcubWFwKChlKSA9PiAoZS5zb3VsID09PSAnb2dyZScgfHwgZS5zb3VsID09PSAna25pZ2h0JyA/IHsgc291bDogZS5zb3VsLCBzdGFyOiBNYXRoLm1pbigzLCBlLnN0YXIgKyAxKSB9IDogZSkpIH0sXG5dO1xuXG4vKiogV2hvbGUgZGF5cyBzaW5jZSAxIEphbnVhcnkgMTk3MCBpbiB0aGUgcGxheWVyJ3Mgb3duIGNhbGVuZGFyICh0aGUgZGF5IGNoYW5nZXMgYXQgdGhlaXIgbWlkbmlnaHQpLiAqL1xuZXhwb3J0IGNvbnN0IGRheU51bWJlciA9IChkOiBEYXRlID0gbmV3IERhdGUoKSk6IG51bWJlciA9PiBNYXRoLmZsb29yKERhdGUuVVRDKGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSkgLyA4NjQwMDAwMCk7XG5leHBvcnQgY29uc3QgaXNWYWxpZERheSA9IChuOiBudW1iZXIpOiBib29sZWFuID0+IE51bWJlci5pc0ludGVnZXIobikgJiYgbiA+IDAgJiYgbiA8IDFlNjtcbmV4cG9ydCBjb25zdCBtb2RpZmllckZvciA9IChkYXk6IG51bWJlcik6IERhaWx5TW9kID0+IE1PRElGSUVSU1soKGRheSAlIE1PRElGSUVSUy5sZW5ndGgpICsgTU9ESUZJRVJTLmxlbmd0aCkgJSBNT0RJRklFUlMubGVuZ3RoXTtcbi8qKiBUaGUgcGxheWVyJ3MgcnVsZXMgZm9yIHRoZSBkYXk6IHRoZSBjYW1wYWlnbidzIERvbWluaW9uIGN1cnZlLCBzaGlmdGVkIGJ5IHRoZSBtb2RpZmllci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkYWlseVJ1bGVzKG1vZDogRGFpbHlNb2QsIHBvb2w6IFJ1bGVzWydwb29sJ10pOiBSdWxlcyB7XG4gIHJldHVybiB7IC4uLlBST1RPVFlQRV9SVUxFUywgY3VydmU6IENVUlZFUy5kb2MubWFwKChjKSA9PiBNYXRoLm1heChEQUlMWV9NSU5fQ0FQLCBjICsgbW9kLmNhcERlbHRhKSksIHBvb2wgfTtcbn1cbiIsICIvLyBTb3VsIFBhY2tzIChwbGFuIGRvYyBzZWN0aW9uIDE3KS4gUHVyZSBydWxlcywgbm8gZ3JhcGhpY3MuIEFMTCBOVU1CRVJTIEFSRSBQTEFDRUhPTERFUiBMRVZFUlM6IHdlIHNldHRsZWQgdGhlIHN0cnVjdHVyZSBmaXJzdCBhbmQgd2lsbCB0dW5lXG4vLyBxdWFudGl0aWVzIHdpdGggdGhlIHByb2dyZXNzaW9uIHNpbXVsYXRpb24gKHNpbS9wcm9ncmVzc2lvbi50cykgb25jZSB0aGUgbG9vcCBjYW4gYmUgcGxheWVkLlxuLy9cbi8vICAgU291bCByYXJpdHkgIC0+IGhvdyBvZnRlbiBhIFNvdWwgc2hvd3MgdXAgYW5kIGhvdyBiaWcgaXRzIHN0YWNrIG9mIGNvcGllcyB0ZW5kcyB0byBiZS5cbi8vICAgUGFjayB0aWVyICAgIC0+IHRoZSBwYWNrJ3Mgb3ZlcmFsbCB2YWx1ZSAoc2t1bGxzLCAxLTMgZm9yIG5vdyk6IG51bWJlciBvZiByZXZlYWxzICsgaG93IGdvb2QgdGhlIHJhcml0eSBvZGRzIGFyZS5cbi8vICAgQSBwYWNrIGhhcyBhIFNUQVJUSU5HIHRpZXIgYW5kIG1heSB1cGdyYWRlIHdoaWxlIGl0IGlzIGJlaW5nIG9wZW5lZDsgdGhlIHJlc3VsdCBpcyBkZWNpZGVkIHVwIGZyb250LCB0aGUgYW5pbWF0aW9uIG9ubHkgc2hvd3MgaXQuXG5cbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgdHlwZSBSYXJpdHkgPSAnY29tbW9uJyB8ICdyYXJlJyB8ICdlcGljJyB8ICdsZWdlbmRhcnknO1xuZXhwb3J0IGNvbnN0IFJBUklUSUVTOiBSYXJpdHlbXSA9IFsnY29tbW9uJywgJ3JhcmUnLCAnZXBpYycsICdsZWdlbmRhcnknXTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfTkFNRTogUmVjb3JkPFJhcml0eSwgc3RyaW5nPiA9IHsgY29tbW9uOiAnQ29tbW9uJywgcmFyZTogJ1JhcmUnLCBlcGljOiAnRXBpYycsIGxlZ2VuZGFyeTogJ0xlZ2VuZGFyeScgfTtcblxuLyoqIFJhcml0eSBwZXIgU291bC4gUExBQ0VIT0xERVIgYXNzaWdubWVudCAobm8gTGVnZW5kYXJ5IFNvdWwgZXhpc3RzIHlldCkuICovXG5leHBvcnQgY29uc3QgUkFSSVRZX09GOiBSZWNvcmQ8U291bElkLCBSYXJpdHk+ID0geyB3YXJyaW9yOiAnY29tbW9uJywgZ29ibGluOiAnY29tbW9uJywgYXJjaGVyOiAncmFyZScsIGtuaWdodDogJ3JhcmUnLCBvZ3JlOiAnZXBpYycsIGJhcmJhcmlhbjogJ2VwaWMnIH07XG5cbi8qKiBSYXJlciBTb3VscyB0dXJuIHVwIGluIHNtYWxsZXIgc3RhY2tzLCBzbyB0aGV5IG5lZWQgZmV3ZXIgY29waWVzIHBlciBsZXZlbCAobXVsdGlwbGllciBvbiB0aGUgbGV2ZWwgY29zdHMpLiBQTEFDRUhPTERFUi4gKi9cbmV4cG9ydCBjb25zdCBMRVZFTF9DT1NUX01VTFQ6IFJlY29yZDxSYXJpdHksIG51bWJlcj4gPSB7IGNvbW1vbjogMSwgcmFyZTogMC42LCBlcGljOiAwLjM1LCBsZWdlbmRhcnk6IDAuMiB9O1xuXG5leHBvcnQgY29uc3QgUEFDS19USUVSUyA9IDM7XG5leHBvcnQgY29uc3QgUEFDSyA9IHtcbiAgcmV2ZWFsczogWzMsIDQsIDVdLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2VwYXJhdGUgcmV2ZWFscyBwZXIgdGllciAoaW5kZXggMCA9IHRpZXIgMSlcbiAgc3RhY2tNdWx0OiBbMSwgMS41LCAyXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29weSBzdGFja3MgYXJlIGJpZ2dlciBpbiBiZXR0ZXIgcGFja3NcbiAgLyoqIFJhcml0eSBvZGRzIHBlciB0aWVyLCBpbiBwZXJjZW50LiAqL1xuICBvZGRzOiBbXG4gICAgeyBjb21tb246IDcwLCByYXJlOiAyNSwgZXBpYzogNSwgbGVnZW5kYXJ5OiAwIH0sXG4gICAgeyBjb21tb246IDU1LCByYXJlOiAzMywgZXBpYzogMTEsIGxlZ2VuZGFyeTogMSB9LFxuICAgIHsgY29tbW9uOiA0MCwgcmFyZTogMzgsIGVwaWM6IDE5LCBsZWdlbmRhcnk6IDMgfSxcbiAgXSBhcyBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+W10sXG4gIC8qKiBDb3BpZXMgaW4gb25lIHJldmVhbCBiZWZvcmUgdGhlIHRpZXIgbXVsdGlwbGllcjogW21pbiwgbWF4XS4gKi9cbiAgc3RhY2s6IHsgY29tbW9uOiBbNiwgMTBdLCByYXJlOiBbMywgNV0sIGVwaWM6IFsxLCAzXSwgbGVnZW5kYXJ5OiBbMSwgMV0gfSBhcyBSZWNvcmQ8UmFyaXR5LCBbbnVtYmVyLCBudW1iZXJdPixcbiAgLyoqIENoYW5jZSB0byBqdW1wIHVwIG9uZSB0aWVyIGR1cmluZyB0aGUgb3BlbmluZywgZnJvbSB0aWVyIDEgYW5kIGZyb20gdGllciAyIChhIGx1Y2t5IHBhY2sgY2FuIGp1bXAgdHdpY2UpLiAqL1xuICB1cGdyYWRlQ2hhbmNlOiBbMC4yLCAwLjEyXSxcbn07XG5cbi8qKiBBbiB1bm9wZW5lZCBwYWNrIHRoZSBwbGF5ZXIgb3ducy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFja0l0ZW0geyBpZDogbnVtYmVyOyB0aWVyOiBudW1iZXI7IHNvdXJjZTogc3RyaW5nIH1cbmV4cG9ydCBpbnRlcmZhY2UgUmV2ZWFsIHsgc291bDogU291bElkOyByYXJpdHk6IFJhcml0eTsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBQYWNrUmVzdWx0IHsgc3RhcnRUaWVyOiBudW1iZXI7IGZpbmFsVGllcjogbnVtYmVyOyB1cGdyYWRlczogbnVtYmVyW107IHJldmVhbHM6IFJldmVhbFtdIH1cblxuY29uc3QgcmFyaXR5UmFuayA9IChyOiBSYXJpdHkpID0+IFJBUklUSUVTLmluZGV4T2Yocik7XG5cbmZ1bmN0aW9uIHJvbGxSYXJpdHkodGllcjogbnVtYmVyLCBybmc6IFJuZyk6IFJhcml0eSB7XG4gIGNvbnN0IG9kZHMgPSBQQUNLLm9kZHNbdGllciAtIDFdOyBsZXQgcm9sbCA9IHJuZy5uZXh0KCkgKiBSQVJJVElFUy5yZWR1Y2UoKG4sIHIpID0+IG4gKyBvZGRzW3JdLCAwKTtcbiAgZm9yIChjb25zdCByIG9mIFJBUklUSUVTKSB7IGlmIChyb2xsIDwgb2Rkc1tyXSkgcmV0dXJuIHI7IHJvbGwgLT0gb2Rkc1tyXTsgfVxuICByZXR1cm4gJ2NvbW1vbic7XG59XG5cbi8qKiBBIHJhbmRvbSBTb3VsIG9mIHRoaXMgcmFyaXR5OyBpZiB0aGUgcm9zdGVyIGhhcyBub25lIG9mIHRoYXQgcmFyaXR5IHlldCwgdGhlIG5leHQgbG93ZXIgb25lIGlzIHVzZWQuICovXG5mdW5jdGlvbiBzb3VsT2ZSYXJpdHkocmFyaXR5OiBSYXJpdHksIHJuZzogUm5nKTogU291bElkIHtcbiAgZm9yIChsZXQgaSA9IHJhcml0eVJhbmsocmFyaXR5KTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgcG9vbCA9IFNPVUxTLmZpbHRlcigocykgPT4gUkFSSVRZX09GW3NdID09PSBSQVJJVElFU1tpXSk7IGlmIChwb29sLmxlbmd0aCkgcmV0dXJuIHJuZy5waWNrKHBvb2wpOyB9XG4gIHJldHVybiBybmcucGljayhTT1VMUyk7XG59XG5cbi8qKiBPcGVuIGEgcGFjazogcm9sbCB1cGdyYWRlcyBmaXJzdCAoc28gdGhlIGFuaW1hdGlvbiBjYW4gcGxheSB0aGVtIGJlZm9yZSB0aGUgcGFjayB0ZWFycyBvcGVuKSwgdGhlbiB0aGUgcmV2ZWFscy4gQmVzdCByZXZlYWwgY29tZXMgbGFzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuUGFjayhzdGFydFRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBQYWNrUmVzdWx0IHtcbiAgY29uc3QgdDAgPSBNYXRoLm1heCgxLCBNYXRoLm1pbihQQUNLX1RJRVJTLCBNYXRoLmZsb29yKHN0YXJ0VGllcikpKSwgdXBncmFkZXM6IG51bWJlcltdID0gW107XG4gIGxldCB0aWVyID0gdDA7XG4gIHdoaWxlICh0aWVyIDwgUEFDS19USUVSUyAmJiBybmcubmV4dCgpIDwgUEFDSy51cGdyYWRlQ2hhbmNlW3RpZXIgLSAxXSkgeyB0aWVyKys7IHVwZ3JhZGVzLnB1c2godGllcik7IH1cbiAgY29uc3QgcmV2ZWFsczogUmV2ZWFsW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBQQUNLLnJldmVhbHNbdGllciAtIDFdOyBpKyspIHtcbiAgICBjb25zdCByYXJpdHkgPSByb2xsUmFyaXR5KHRpZXIsIHJuZyksIHNvdWwgPSBzb3VsT2ZSYXJpdHkocmFyaXR5LCBybmcpLCBbbG8sIGhpXSA9IFBBQ0suc3RhY2tbUkFSSVRZX09GW3NvdWxdXTtcbiAgICByZXZlYWxzLnB1c2goeyBzb3VsLCByYXJpdHk6IFJBUklUWV9PRltzb3VsXSwgY29waWVzOiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKChsbyArIHJuZy5pbnQoaGkgLSBsbyArIDEpKSAqIFBBQ0suc3RhY2tNdWx0W3RpZXIgLSAxXSkpIH0pO1xuICB9XG4gIHJldmVhbHMuc29ydCgoYSwgYikgPT4gcmFyaXR5UmFuayhhLnJhcml0eSkgLSByYXJpdHlSYW5rKGIucmFyaXR5KSB8fCBhLmNvcGllcyAtIGIuY29waWVzKTtcbiAgcmV0dXJuIHsgc3RhcnRUaWVyOiB0MCwgZmluYWxUaWVyOiB0aWVyLCB1cGdyYWRlcywgcmV2ZWFscyB9O1xufVxuXG4vKiogVG90YWwgY29waWVzIHBlciBTb3VsIGluIGEgcmVzdWx0ICh0aGUgc2FtZSBTb3VsIGNhbiBiZSByZXZlYWxlZCBtb3JlIHRoYW4gb25jZSkuICovXG5leHBvcnQgZnVuY3Rpb24gY29waWVzQnlTb3VsKHJlc3VsdDogUGFja1Jlc3VsdCk6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4ge1xuICBjb25zdCBvdXQ6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4gPSB7fTtcbiAgZm9yIChjb25zdCByIG9mIHJlc3VsdC5yZXZlYWxzKSBvdXRbci5zb3VsXSA9IChvdXRbci5zb3VsXSA/PyAwKSArIHIuY29waWVzO1xuICByZXR1cm4gb3V0O1xufVxuIiwgIi8vIFRoZSBwbGF5ZXIncyBzYXZlZCBwcm9ncmVzcy4gRnJhbWV3b3JrLWZyZWUgc28gdGhlIGdhbWUgYnVuZGxlIGFuZCB0aGUgbmF2aWdhdGlvbiBzaGVsbCBib3RoIHVzZSBpdC5cbi8vIFN0b3JlZCBpbiBsb2NhbFN0b3JhZ2UgYXMgSlNPTi4gRXZlcnkgcmVhZC93cml0ZSBpcyBndWFyZGVkOiBwcml2YXRlIHdpbmRvd3MgYW5kIGJsb2NrZWQgc3RvcmFnZSBtdXN0IG5ldmVyIGJyZWFrIHRoZSBnYW1lLlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBQQUNLX1RJRVJTIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5cbmV4cG9ydCBjb25zdCBERUNLX1NJWkUgPSA2OyAgICAgICAgICAgICAgICAgICAgIC8vIGRvYzogc2l4IGVxdWlwcGVkIFNvdWxzIHBlciBzdGFnZVxuY29uc3QgS0VZID0gJ25lY3JvLXNhdmUnO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCB0eXBlIERpZmZpY3VsdHkgPSAnZWFzeScgfCAnbm9ybWFsJyB8ICdoYXJkJyB8ICduaWdodG1hcmUnO1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVElFUzogRGlmZmljdWx0eVtdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuZXhwb3J0IGludGVyZmFjZSBTZXR0aW5ncyB7IG11c2ljOiBib29sZWFuOyBzZng6IGJvb2xlYW4gfVxuZXhwb3J0IGludGVyZmFjZSBTb3VsUHJvZ3Jlc3MgeyBsZXZlbDogbnVtYmVyOyBjb3BpZXM6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNhdmUge1xuICB2OiBudW1iZXI7XG4gIGRlY2s6IFNvdWxJZFtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBlcXVpcHBlZCBTb3VscywgYXQgbW9zdCBERUNLX1NJWkUsIGF0IGxlYXN0IDFcbiAgc291bHM6IFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47ICAgICAgICAgIC8vIFBMQUNFSE9MREVSIHByb2dyZXNzaW9uIHVudGlsIHBhY2tzIGV4aXN0XG4gIHNldHRpbmdzOiBTZXR0aW5nczsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzb3VuZCBzd2l0Y2hlczsgYm90aCBvbiBieSBkZWZhdWx0XG4gIGRpZmZpY3VsdHk6IERpZmZpY3VsdHk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBjaG9zZW4gb24gSG9tZTsgYXBwbGllcyB0byB0aGUgbmV4dCBydW5cbiAgc3RhZ2U6IHN0cmluZzsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBzdGFnZSBwaWNrZWQgb24gSG9tZSAoaWQgZnJvbSB3YXZlcy50cyBTVEFHRVMpXG4gIHNlZW46IHN0cmluZ1tdIHwgbnVsbDsgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bmxvY2sga2V5cyB3aG9zZSBjZWxlYnJhdGlvbiB3YXMgYWxyZWFkeSBzaG93biAobnVsbDogb2xkZXIgc2F2ZSwgc2VlZGVkIG9uIGZpcnN0IGxvb2spXG4gIHBhY2tzOiBQYWNrSXRlbVtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bm9wZW5lZCBTb3VsIFBhY2tzXG4gIG5leHRQYWNrSWQ6IG51bWJlcjtcbiAgY2xlYXJzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+OyAgICAgICAgICAgICAgIC8vIHN0YWdlIGNsZWFycywga2V5ZWQgJ3N0YWdlOmRpZmZpY3VsdHknXG4gIHJlcGxheU1ldGVyOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXBsYXkgY2xlYXJzIHRvd2FyZCB0aGUgbmV4dCByZXBsYXkgcGFja1xuICBlbmRsZXNzOiB7IGJlc3Q6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgLy8gRW5kbGVzcyBEZXB0aHM6IHRoZSBkZWVwZXN0IHdhdmUgY2xlYXJlZFxuICBnb2xkU2NhbGU6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gMiA9IGdvbGQgaW4gdGhlIGN1cnJlbnQgKHgxMDApIHVuaXRzOyBhIHNhdmUgd2l0aG91dCBpdCBob2xkcyBnb2xkIGluIHRoZSBvbGQgc21hbGwgdW5pdHMgYW5kIGlzIGNvbnZlcnRlZCBvbiBsb2FkXG4gIGdvbGQ6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzcGVudCBvbiBTb3VsIGxldmVsLXVwcyAoYWxvbmdzaWRlIGNvcGllcyk7IGVhcm5lZCBwZXIgd2F2ZSBjbGVhcmVkIGFuZCBmcm9tIG9wZW5pbmcgcGFja3NcbiAgZGFpbHk6IHsgZGF5OiBudW1iZXI7IHdvbjogYm9vbGVhbiB9IHwgbnVsbDsgIC8vIHRoZSBsYXN0IERhaWx5IENoYWxsZW5nZSBkYXkgcGxheWVkIGFuZCB3aGV0aGVyIGl0cyBvbmUtdGltZSByZXdhcmQgd2FzIHRha2VuXG59XG4vKiogR29sZCBnaXZlbiBvbmNlIHRvIGEgc2F2ZSB0aGF0IHByZWRhdGVzIGdvbGQgYW5kIGhhcyBwcm9ncmVzcy4gKi9cbmV4cG9ydCBjb25zdCBDQVRDSF9VUF9HT0xEID0gNDAwMDA7XG5leHBvcnQgaW50ZXJmYWNlIFN0b3JlIHsgZ2V0SXRlbShrOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsOyBzZXRJdGVtKGs6IHN0cmluZywgdjogc3RyaW5nKTogdm9pZCB9XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0U2F2ZSgpOiBTYXZlIHtcbiAgY29uc3Qgc291bHMgPSB7fSBhcyBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+O1xuICBmb3IgKGNvbnN0IGlkIG9mIFNPVUxTKSBzb3Vsc1tpZF0gPSB7IGxldmVsOiAxLCBjb3BpZXM6IDAgfTtcbiAgcmV0dXJuIHsgdjogVkVSU0lPTiwgZGVjazogU09VTFMuc2xpY2UoMCwgREVDS19TSVpFKSwgc291bHMsIHNldHRpbmdzOiB7IG11c2ljOiB0cnVlLCBzZng6IHRydWUgfSwgZGlmZmljdWx0eTogJ25vcm1hbCcsIHN0YWdlOiAnY3J5cHQnLCBzZWVuOiBbXSwgcGFja3M6IFtdLCBuZXh0UGFja0lkOiAxLCBjbGVhcnM6IHt9LCByZXBsYXlNZXRlcjogMCwgZW5kbGVzczogeyBiZXN0OiAwIH0sIGdvbGRTY2FsZTogMiwgZ29sZDogMCwgZGFpbHk6IG51bGwgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJyb3dzZXJTdG9yZSgpOiBTdG9yZSB8IG51bGwgeyB0cnkgeyByZXR1cm4gdHlwZW9mIGxvY2FsU3RvcmFnZSA9PT0gJ3VuZGVmaW5lZCcgPyBudWxsIDogbG9jYWxTdG9yYWdlOyB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH0gfVxuXG4vKiogUmVwYWlyIHdoYXRldmVyIHdhcyBzdG9yZWQ6IHVua25vd24gU291bHMgZHJvcHBlZCwgZHVwbGljYXRlcyByZW1vdmVkLCBkZWNrIGNhcHBlZCwgbm90aGluZyBlbXB0eS4gT2xkIHZlcnNpb25zIGtlZXAgdGhlaXIgcHJvZ3Jlc3MuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemUocmF3OiBhbnkpOiBTYXZlIHtcbiAgY29uc3QgYmFzZSA9IGRlZmF1bHRTYXZlKCk7XG4gIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09ICdvYmplY3QnKSByZXR1cm4gYmFzZTtcbiAgY29uc3QgZGVjazogU291bElkW10gPSBbXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LmRlY2spKSBmb3IgKGNvbnN0IGQgb2YgcmF3LmRlY2spIGlmIChTT1VMUy5pbmNsdWRlcyhkKSAmJiAhZGVjay5pbmNsdWRlcyhkKSAmJiBkZWNrLmxlbmd0aCA8IERFQ0tfU0laRSkgZGVjay5wdXNoKGQpO1xuICBpZiAoZGVjay5sZW5ndGgpIGJhc2UuZGVjayA9IGRlY2s7XG4gIGlmIChyYXcuc291bHMgJiYgdHlwZW9mIHJhdy5zb3VscyA9PT0gJ29iamVjdCcpIHtcbiAgICBmb3IgKGNvbnN0IGlkIG9mIFNPVUxTKSB7XG4gICAgICBjb25zdCBwID0gcmF3LnNvdWxzW2lkXTtcbiAgICAgIGlmIChwICYmIE51bWJlci5pc0Zpbml0ZShwLmxldmVsKSAmJiBOdW1iZXIuaXNGaW5pdGUocC5jb3BpZXMpKSBiYXNlLnNvdWxzW2lkXSA9IHsgbGV2ZWw6IE1hdGgubWF4KDEsIE1hdGguZmxvb3IocC5sZXZlbCkpLCBjb3BpZXM6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IocC5jb3BpZXMpKSB9O1xuICAgIH1cbiAgfVxuICBpZiAocmF3LnNldHRpbmdzICYmIHR5cGVvZiByYXcuc2V0dGluZ3MgPT09ICdvYmplY3QnKSB7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3MubXVzaWMgPT09ICdib29sZWFuJykgYmFzZS5zZXR0aW5ncy5tdXNpYyA9IHJhdy5zZXR0aW5ncy5tdXNpYztcbiAgICBpZiAodHlwZW9mIHJhdy5zZXR0aW5ncy5zZnggPT09ICdib29sZWFuJykgYmFzZS5zZXR0aW5ncy5zZnggPSByYXcuc2V0dGluZ3Muc2Z4O1xuICB9XG4gIGlmIChESUZGSUNVTFRJRVMuaW5jbHVkZXMocmF3LmRpZmZpY3VsdHkpKSBiYXNlLmRpZmZpY3VsdHkgPSByYXcuZGlmZmljdWx0eTtcbiAgaWYgKHR5cGVvZiByYXcuc3RhZ2UgPT09ICdzdHJpbmcnICYmIC9eW2EtejAtOV8tXXsxLDI0fSQvLnRlc3QocmF3LnN0YWdlKSkgYmFzZS5zdGFnZSA9IHJhdy5zdGFnZTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LnNlZW4pKSBiYXNlLnNlZW4gPSByYXcuc2Vlbi5maWx0ZXIoKGs6IGFueSkgPT4gdHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDApLnNsaWNlKC04MCk7XG4gIGVsc2UgaWYgKHJhdy5jbGVhcnMgJiYgdHlwZW9mIHJhdy5jbGVhcnMgPT09ICdvYmplY3QnICYmIE9iamVjdC5rZXlzKHJhdy5jbGVhcnMpLmxlbmd0aCkgYmFzZS5zZWVuID0gbnVsbDsgICAgLy8gYW4gZXhpc3RpbmcgcGxheWVyOiBkbyBub3QgcmVwbGF5IG9sZCB1bmxvY2tzXG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5wYWNrcykpIHtcbiAgICBjb25zdCBpZHMgPSBuZXcgU2V0PG51bWJlcj4oKTtcbiAgICBmb3IgKGNvbnN0IHAgb2YgcmF3LnBhY2tzKSB7XG4gICAgICBpZiAoYmFzZS5wYWNrcy5sZW5ndGggPj0gOTkgfHwgIXAgfHwgIU51bWJlci5pc0ludGVnZXIocC5pZCkgfHwgcC5pZCA8IDEgfHwgaWRzLmhhcyhwLmlkKSB8fCAhTnVtYmVyLmlzSW50ZWdlcihwLnRpZXIpIHx8IHAudGllciA8IDEgfHwgcC50aWVyID4gUEFDS19USUVSUykgY29udGludWU7XG4gICAgICBpZHMuYWRkKHAuaWQpOyBiYXNlLnBhY2tzLnB1c2goeyBpZDogcC5pZCwgdGllcjogcC50aWVyLCBzb3VyY2U6IHR5cGVvZiBwLnNvdXJjZSA9PT0gJ3N0cmluZycgPyBwLnNvdXJjZS5zbGljZSgwLCA0MCkgOiAnJyB9KTtcbiAgICB9XG4gIH1cbiAgY29uc3QgbWF4SWQgPSBiYXNlLnBhY2tzLnJlZHVjZSgobiwgcCkgPT4gTWF0aC5tYXgobiwgcC5pZCksIDApO1xuICBiYXNlLm5leHRQYWNrSWQgPSBNYXRoLm1heChtYXhJZCArIDEsIE51bWJlci5pc0ludGVnZXIocmF3Lm5leHRQYWNrSWQpICYmIHJhdy5uZXh0UGFja0lkID4gMCA/IHJhdy5uZXh0UGFja0lkIDogMSk7XG4gIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JykgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMocmF3LmNsZWFycykpIGlmICh0eXBlb2YgayA9PT0gJ3N0cmluZycgJiYgay5sZW5ndGggPCA0MCAmJiBOdW1iZXIuaXNJbnRlZ2VyKHYpICYmICh2IGFzIG51bWJlcikgPiAwKSBiYXNlLmNsZWFyc1trXSA9IHYgYXMgbnVtYmVyO1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcucmVwbGF5TWV0ZXIpICYmIHJhdy5yZXBsYXlNZXRlciA+PSAwICYmIHJhdy5yZXBsYXlNZXRlciA8IDUwKSBiYXNlLnJlcGxheU1ldGVyID0gcmF3LnJlcGxheU1ldGVyO1xuICBpZiAocmF3LmVuZGxlc3MgJiYgTnVtYmVyLmlzSW50ZWdlcihyYXcuZW5kbGVzcy5iZXN0KSAmJiByYXcuZW5kbGVzcy5iZXN0ID49IDAgJiYgcmF3LmVuZGxlc3MuYmVzdCA8PSA5OTk5KSBiYXNlLmVuZGxlc3MuYmVzdCA9IHJhdy5lbmRsZXNzLmJlc3Q7XG4gIGlmIChOdW1iZXIuaXNJbnRlZ2VyKHJhdy5nb2xkKSAmJiByYXcuZ29sZCA+PSAwICYmIHJhdy5nb2xkIDw9IDFlOSkgYmFzZS5nb2xkID0gcmF3LmdvbGRTY2FsZSA9PT0gMiA/IHJhdy5nb2xkIDogTWF0aC5taW4oMWU5LCByYXcuZ29sZCAqIDEwMCk7ICAgLy8gZWFybHkgc2F2ZXMgY291bnRlZCBnb2xkIGluIHVuaXRzIDEwMCB0aW1lcyBzbWFsbGVyXG4gIGVsc2UgaWYgKHJhdy5nb2xkID09PSB1bmRlZmluZWQgJiYgT2JqZWN0LmtleXMoYmFzZS5jbGVhcnMpLmxlbmd0aCkgYmFzZS5nb2xkID0gQ0FUQ0hfVVBfR09MRDsgICAgICAgIC8vIGEgcGxheWVyIGZyb20gYmVmb3JlIGdvbGQgZXhpc3RlZDogb25lLXRpbWUgZ3JhbnQgc28gdGhlIG5ldyBjb3N0IGRvZXMgbm90IGxvY2sgdGhlaXIgc3RvY2twaWxlZCBjb3BpZXNcbiAgaWYgKHJhdy5kYWlseSAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5kYWlseS5kYXkpICYmIHJhdy5kYWlseS5kYXkgPiAwICYmIHJhdy5kYWlseS5kYXkgPCAxZTYpIGJhc2UuZGFpbHkgPSB7IGRheTogcmF3LmRhaWx5LmRheSwgd29uOiAhIXJhdy5kYWlseS53b24gfTtcbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cblxuLyoqIENoYW5nZSBzb3VuZCBzZXR0aW5ncyB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzKHBhdGNoOiBQYXJ0aWFsPFNldHRpbmdzPiwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2V0dGluZ3Mge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLnNldHRpbmdzID0geyAuLi5zLnNldHRpbmdzLCAuLi5wYXRjaCB9OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5zZXR0aW5ncztcbn1cblxuLyoqIFJlbWVtYmVyIHRoZSBjaG9zZW4gZGlmZmljdWx0eSB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZURpZmZpY3VsdHkoZDogRGlmZmljdWx0eSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogRGlmZmljdWx0eSB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuZGlmZmljdWx0eSA9IERJRkZJQ1VMVElFUy5pbmNsdWRlcyhkKSA/IGQgOiBzLmRpZmZpY3VsdHk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLmRpZmZpY3VsdHk7XG59XG4iLCAiLy8gUGVybWFuZW50IHByb2dyZXNzaW9uOiBzdGFnZSBjbGVhcnMgLT4gU291bCBQYWNrcyAtPiBjb3BpZXMgLT4gU291bCBsZXZlbHMuIFB1cmUgZnVuY3Rpb25zIHRoYXQgY2hhbmdlIGEgU2F2ZSAodGhlIGNhbGxlciBwZXJzaXN0cyBpdCkuXG4vLyBQbGFjZWhvbGRlciBudW1iZXJzLCBsaWtlIHBhY2tzLnRzLiBJbi1ydW4gc3RhciBtZXJnaW5nIGlzIGEgc2VwYXJhdGUsIHRlbXBvcmFyeSBzeXN0ZW0gYW5kIG5ldmVyIHRvdWNoZXMgYW55IG9mIHRoaXMuXG5cbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19QQUNLX0VWRVJZLCBlbmRsZXNzUGFja1RpZXIgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgTEVWRUxfQ09TVF9NVUxULCBQQUNLX1RJRVJTLCBSQVJJVFlfT0YsIG9wZW5QYWNrIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtLCBQYWNrUmVzdWx0IH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlLCB3cml0ZVNhdmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHsgU1RBR0VTLCBzdGFnZUJ5SWQsIHN0YWdlSW5kZXggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB0eXBlIHsgRGlmZmljdWx0eSwgU2F2ZSwgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5leHBvcnQgY29uc3QgTUFYX1BBQ0tTID0gOTk7XG5cbi8qKiBXaGVyZSBwYWNrcyBjb21lIGZyb20uIFBMQUNFSE9MREVSLiBGaXJzdCBjbGVhciBvZiBhIHN0YWdlIG9uIGVhY2ggZGlmZmljdWx0eSBnaXZlcyBvbmUgaW1wcm92ZWQgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgYSBtZXRlci4gKi9cbmV4cG9ydCBjb25zdCBSRVdBUkRTID0ge1xuICBmaXJzdENsZWFyVGllcjogeyBlYXN5OiAxLCBub3JtYWw6IDIsIGhhcmQ6IDIsIG5pZ2h0bWFyZTogMyB9IGFzIFJlY29yZDxEaWZmaWN1bHR5LCBudW1iZXI+LFxuICByZXBsYXlUaWVyOiAxLFxuICByZXBsYXlDbGVhcnNQZXJQYWNrOiAyLFxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGxldmVsc1xuZXhwb3J0IGNvbnN0IG1heExldmVsID0gKCk6IG51bWJlciA9PiBCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWwubGVuZ3RoICsgMTtcbmV4cG9ydCBjb25zdCBpc01heExldmVsID0gKGxldmVsOiBudW1iZXIpOiBib29sZWFuID0+IGxldmVsID49IG1heExldmVsKCk7XG4vKiogQ29waWVzIG5lZWRlZCB0byB0YWtlIGBzb3VsYCBmcm9tIGBsZXZlbGAgdG8gdGhlIG5leHQgb25lICgwIHdoZW4gYWxyZWFkeSBtYXgpLiBSYXJlciBTb3VscyBuZWVkIGZld2VyLiAqL1xuZXhwb3J0IGNvbnN0IGNvcGllc05lZWRlZCA9IChsZXZlbDogbnVtYmVyLCBzb3VsOiBTb3VsSWQpOiBudW1iZXIgPT4gKGlzTWF4TGV2ZWwobGV2ZWwpID8gMCA6IE1hdGgubWF4KDEsIE1hdGgucm91bmQoQkFMQU5DRS5sZXZlbC5jb3BpZXNUb0xldmVsW2xldmVsIC0gMV0gKiBMRVZFTF9DT1NUX01VTFRbUkFSSVRZX09GW3NvdWxdXSkpKTtcbi8qKlxuICogT25lIHJlcXVpcmVtZW50IG9mIGFuIHVwZ3JhZGUuIFRvZGF5IG9ubHkgY29waWVzOyB0aGUgY29uZmlybSBwb3B1cCBsaXN0cyBldmVyeSBlbnRyeSB3aXRoIGhhdmUgLyBuZWVkLCBhbmQgQ29uZmlybSBpcyBhbGxvd2VkIG9ubHkgd2hlbiBhbGwgYXJlIG1ldC5cbiAqIEdvbGQgd2lsbCBzaW1wbHkgYmVjb21lIGEgc2Vjb25kIGVudHJ5IGhlcmUgKHsgaWQ6ICdnb2xkJywgLi4uIH0pIGFuZCBiZSBzcGVudCBpbiBsZXZlbFVwKCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBncmFkZUNvc3QgeyBpZDogJ2NvcGllcycgfCAnZ29sZCc7IGxhYmVsOiBzdHJpbmc7IGhhdmU6IG51bWJlcjsgbmVlZDogbnVtYmVyOyBvazogYm9vbGVhbiB9XG4vKiogR29sZCB0byB0YWtlIGEgU291bCBmcm9tIGBsZXZlbGAgdG8gdGhlIG5leHQgb25lICgwIGF0IG1heCkuICovXG5leHBvcnQgY29uc3QgZ29sZE5lZWRlZCA9IChsZXZlbDogbnVtYmVyKTogbnVtYmVyID0+IChpc01heExldmVsKGxldmVsKSA/IDAgOiBCQUxBTkNFLmxldmVsLmdvbGRUb0xldmVsW2xldmVsIC0gMV0pO1xuZXhwb3J0IGZ1bmN0aW9uIHVwZ3JhZGVDb3N0cyhzYXZlOiBTYXZlLCBzb3VsOiBTb3VsSWQpOiBVcGdyYWRlQ29zdFtdIHtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IGlmIChpc01heExldmVsKHAubGV2ZWwpKSByZXR1cm4gW107XG4gIGNvbnN0IG5lZWQgPSBjb3BpZXNOZWVkZWQocC5sZXZlbCwgc291bCk7XG4gIGNvbnN0IGdvbGQgPSBnb2xkTmVlZGVkKHAubGV2ZWwpO1xuICByZXR1cm4gW3sgaWQ6ICdjb3BpZXMnLCBsYWJlbDogJ0NvcGllcycsIGhhdmU6IHAuY29waWVzLCBuZWVkLCBvazogcC5jb3BpZXMgPj0gbmVlZCB9LCB7IGlkOiAnZ29sZCcsIGxhYmVsOiAnR29sZCcsIGhhdmU6IHNhdmUuZ29sZCwgbmVlZDogZ29sZCwgb2s6IHNhdmUuZ29sZCA+PSBnb2xkIH1dO1xufVxuZXhwb3J0IGNvbnN0IGNhbkFmZm9yZCA9IChjb3N0czogVXBncmFkZUNvc3RbXSk6IGJvb2xlYW4gPT4gY29zdHMubGVuZ3RoID4gMCAmJiBjb3N0cy5ldmVyeSgoYykgPT4gYy5vayk7XG5leHBvcnQgY29uc3QgY2FuTGV2ZWxVcCA9IChzYXZlOiBTYXZlLCBzb3VsOiBTb3VsSWQpOiBib29sZWFuID0+IGNhbkFmZm9yZCh1cGdyYWRlQ29zdHMoc2F2ZSwgc291bCkpO1xuLyoqIFBheSBldmVyeSBjb3N0IGFuZCBnYWluIGEgbGV2ZWwuIFJldHVybnMgZmFsc2UgKGFuZCBjaGFuZ2VzIG5vdGhpbmcpIGlmIHRoZSBTb3VsIGlzIG5vdCByZWFkeS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsZXZlbFVwKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4ge1xuICBjb25zdCBjb3N0cyA9IHVwZ3JhZGVDb3N0cyhzYXZlLCBzb3VsKTsgaWYgKCFjYW5BZmZvcmQoY29zdHMpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHAgPSBzYXZlLnNvdWxzW3NvdWxdOyBmb3IgKGNvbnN0IGMgb2YgY29zdHMpIHsgaWYgKGMuaWQgPT09ICdjb3BpZXMnKSBwLmNvcGllcyAtPSBjLm5lZWQ7IGVsc2Ugc2F2ZS5nb2xkIC09IGMubmVlZDsgfVxuICBwLmxldmVsKys7IHJldHVybiB0cnVlO1xufVxuLyoqIERlYnVnZ2luZzogcHV0IGV2ZXJ5IFNvdWwgYmFjayB0byBsZXZlbCAxIChjb3BpZXMgYXJlIGtlcHQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0TGV2ZWxzKHNhdmU6IFNhdmUpOiB2b2lkIHsgZm9yIChjb25zdCBrIG9mIFNPVUxTKSBzYXZlLnNvdWxzW2tdLmxldmVsID0gMTsgfVxuLyoqIERlYnVnZ2luZzogZm9yZ2V0IGFsbCBjb2xsZWN0ZWQgY29waWVzIChsZXZlbHMgYXJlIGtlcHQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyQ29waWVzKHNhdmU6IFNhdmUpOiB2b2lkIHsgZm9yIChjb25zdCBrIG9mIFNPVUxTKSBzYXZlLnNvdWxzW2tdLmNvcGllcyA9IDA7IH1cbi8qKiBNdWx0aXBsaWVyIGFwcGxpZWQgdG8gYSBTb3VsJ3MgaGVhbHRoL2RhbWFnZSBmcm9tIGl0cyBwZXJtYW5lbnQgbGV2ZWwgKGxldmVsIDEgPSAxLjApLiAqL1xuZXhwb3J0IGNvbnN0IGxldmVsTXVsdCA9IChsZXZlbDogbnVtYmVyLCBzdGF0OiAnaHAnIHwgJ2RtZycpOiBudW1iZXIgPT4gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEJBTEFOQ0UubGV2ZWxbc3RhdF07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBnb2xkXG5leHBvcnQgY29uc3QgR09MRCA9IHsgdGllck11bHQ6IHsgZWFzeTogMC42LCBub3JtYWw6IDEsIGhhcmQ6IDEuNCwgbmlnaHRtYXJlOiAyIH0gYXMgUmVjb3JkPERpZmZpY3VsdHksIG51bWJlcj4sIHBhY2tQZXJUaWVyOiAxNTAwLCBkYWlseVdpbjogNTAwMCB9O1xuLyoqIEdvbGQgZm9yIGNsZWFyaW5nIG9uZSBjYW1wYWlnbiB3YXZlOiBtb3JlIGluIGxhdGVyIHN0YWdlcyBhbmQgb24gaGFyZGVyIHRpZXJzLiAqL1xuZXhwb3J0IGNvbnN0IHdhdmVHb2xkID0gKHN0YWdlOiBzdHJpbmcsIHRpZXI6IERpZmZpY3VsdHkgfCBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgxMDAgKiAoNiArIDIgKiBzdGFnZUluZGV4KHN0YWdlKSkgKiAoR09MRC50aWVyTXVsdFt0aWVyIGFzIERpZmZpY3VsdHldID8/IDEpKSk7XG4vKiogR29sZCBmb3IgY2xlYXJpbmcgb25lIEVuZGxlc3Mgd2F2ZS4gKi9cbmV4cG9ydCBjb25zdCBlbmRsZXNzV2F2ZUdvbGQgPSAod2F2ZTogbnVtYmVyKTogbnVtYmVyID0+IDEwMCAqICg4ICsgTWF0aC5mbG9vcigwLjYgKiBNYXRoLm1heCgxLCB3YXZlKSkpO1xuLyoqIEdvbGQgZm9yIG9wZW5pbmcgYSBwYWNrIHRoYXQgZmluaXNoZWQgYXQgYHRpZXJgLiAqL1xuZXhwb3J0IGNvbnN0IHBhY2tHb2xkID0gKHRpZXI6IG51bWJlcik6IG51bWJlciA9PiBHT0xELnBhY2tQZXJUaWVyICogTWF0aC5tYXgoMSwgdGllcik7XG5leHBvcnQgZnVuY3Rpb24gYWRkR29sZChzYXZlOiBTYXZlLCBuOiBudW1iZXIpOiBudW1iZXIgeyBjb25zdCBnID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihuKSk7IHNhdmUuZ29sZCA9IE1hdGgubWluKDFlOSwgc2F2ZS5nb2xkICsgZyk7IHJldHVybiBnOyB9XG5leHBvcnQgZnVuY3Rpb24gYWRkR29sZEFuZFNhdmUobjogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IG51bWJlciB7IGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IGcgPSBhZGRHb2xkKHMsIG4pOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gZzsgfVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGFja3NcbmV4cG9ydCBmdW5jdGlvbiBncmFudFBhY2soc2F2ZTogU2F2ZSwgdGllcjogbnVtYmVyLCBzb3VyY2U6IHN0cmluZyk6IFBhY2tJdGVtIHwgbnVsbCB7XG4gIGlmIChzYXZlLnBhY2tzLmxlbmd0aCA+PSBNQVhfUEFDS1MpIHJldHVybiBudWxsO1xuICBjb25zdCBwYWNrOiBQYWNrSXRlbSA9IHsgaWQ6IHNhdmUubmV4dFBhY2tJZCsrLCB0aWVyOiBNYXRoLm1heCgxLCBNYXRoLm1pbihQQUNLX1RJRVJTLCBNYXRoLmZsb29yKHRpZXIpKSksIHNvdXJjZSB9O1xuICBzYXZlLnBhY2tzLnB1c2gocGFjayk7IHJldHVybiBwYWNrO1xufVxuXG4vKiogT3BlbiBhbiBvd25lZCBwYWNrOiBpdCBpcyByZW1vdmVkIGFuZCBpdHMgY29waWVzIGFyZSBhZGRlZCB0byB0aGUgU291bHMgaW1tZWRpYXRlbHkgKHNvIG5vdGhpbmcgaXMgbG9zdCBpZiB0aGUgcGFnZSBjbG9zZXMgbWlkLWFuaW1hdGlvbikuICovXG5leHBvcnQgZnVuY3Rpb24gb3Blbk93bmVkUGFjayhzYXZlOiBTYXZlLCBwYWNrSWQ6IG51bWJlciwgcm5nOiBSbmcpOiBQYWNrUmVzdWx0IHwgbnVsbCB7XG4gIGNvbnN0IGkgPSBzYXZlLnBhY2tzLmZpbmRJbmRleCgocCkgPT4gcC5pZCA9PT0gcGFja0lkKTsgaWYgKGkgPCAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGFjayA9IHNhdmUucGFja3NbaV07IHNhdmUucGFja3Muc3BsaWNlKGksIDEpO1xuICBjb25zdCByZXN1bHQgPSBvcGVuUGFjayhwYWNrLnRpZXIsIHJuZyk7XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgc2F2ZS5zb3Vsc1tyLnNvdWxdLmNvcGllcyArPSByLmNvcGllcztcbiAgYWRkR29sZChzYXZlLCBwYWNrR29sZChyZXN1bHQuZmluYWxUaWVyKSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xlYXJSZXdhcmQgeyBmaXJzdDogYm9vbGVhbjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyByZXBsYXlNZXRlcjogbnVtYmVyOyByZXBsYXlOZWVkZWQ6IG51bWJlcjsgdW5sb2NrZWQ6IHN0cmluZ1tdIH1cbi8qKiBBIHN0YWdlIHdhcyBjbGVhcmVkIG9uIGBkaWZmaWN1bHR5YC4gVGhlIGZpcnN0IGNsZWFyIG9uIHRoYXQgZGlmZmljdWx0eSBncmFudHMgYSBiZXR0ZXIgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgdGhlIHJlcGxheSBtZXRlci4gKi9cbmZ1bmN0aW9uIHJlY29yZENsZWFyQmFzZShzYXZlOiBTYXZlLCBzdGFnZUlkOiBzdHJpbmcsIGRpZmZpY3VsdHk6IERpZmZpY3VsdHkpOiBPbWl0PENsZWFyUmV3YXJkLCAndW5sb2NrZWQnPiB7XG4gIGNvbnN0IGtleSA9IHN0YWdlSWQgKyAnOicgKyBkaWZmaWN1bHR5LCBiZWZvcmUgPSBzYXZlLmNsZWFyc1trZXldID8/IDA7XG4gIHNhdmUuY2xlYXJzW2tleV0gPSBiZWZvcmUgKyAxO1xuICBpZiAoYmVmb3JlID09PSAwKSByZXR1cm4geyBmaXJzdDogdHJ1ZSwgcGFjazogZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMuZmlyc3RDbGVhclRpZXJbZGlmZmljdWx0eV0sICdGaXJzdCBjbGVhciBcdTAwQjcgJyArIGRpZmZpY3VsdHkpLCByZXBsYXlNZXRlcjogc2F2ZS5yZXBsYXlNZXRlciwgcmVwbGF5TmVlZGVkOiBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2sgfTtcbiAgc2F2ZS5yZXBsYXlNZXRlcisrO1xuICBsZXQgcGFjazogUGFja0l0ZW0gfCBudWxsID0gbnVsbDtcbiAgaWYgKHNhdmUucmVwbGF5TWV0ZXIgPj0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrKSB7IHNhdmUucmVwbGF5TWV0ZXIgLT0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrOyBwYWNrID0gZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMucmVwbGF5VGllciwgJ1JlcGxheSByZXdhcmQnKTsgfVxuICByZXR1cm4geyBmaXJzdDogZmFsc2UsIHBhY2ssIHJlcGxheU1ldGVyOiBzYXZlLnJlcGxheU1ldGVyLCByZXBsYXlOZWVkZWQ6IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjayB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyc2lzdGVkIHdyYXBwZXJzICh1c2VkIGJ5IHRoZSBnYW1lIGJ1bmRsZSlcbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRDbGVhckFuZFNhdmUoc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5LCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZENsZWFyKHMsIHN0YWdlSWQsIGRpZmZpY3VsdHkpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIERhaWx5IENoYWxsZW5nZVxuZXhwb3J0IGludGVyZmFjZSBEYWlseVJld2FyZCB7IGZpcnN0OiBib29sZWFuOyBwYWNrOiBQYWNrSXRlbSB8IG51bGw7IGdvbGQ6IG51bWJlciB9XG4vKiogVGhlIGRheSdzIGNoYWxsZW5nZSB3YXMgd29uLiBPbmx5IHRoZSBmaXJzdCB3aW4gb2YgYSBnaXZlbiBkYXkgcGF5cyAoYSBUaWVyIDEgcGFjayBhbmQgc29tZSBnb2xkKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmREYWlseVdpbihzYXZlOiBTYXZlLCBkYXk6IG51bWJlcik6IERhaWx5UmV3YXJkIHtcbiAgaWYgKHNhdmUuZGFpbHkgJiYgc2F2ZS5kYWlseS5kYXkgPT09IGRheSAmJiBzYXZlLmRhaWx5LndvbikgcmV0dXJuIHsgZmlyc3Q6IGZhbHNlLCBwYWNrOiBudWxsLCBnb2xkOiAwIH07XG4gIHNhdmUuZGFpbHkgPSB7IGRheSwgd29uOiB0cnVlIH07XG4gIHJldHVybiB7IGZpcnN0OiB0cnVlLCBwYWNrOiBncmFudFBhY2soc2F2ZSwgMSwgJ0RhaWx5IGNoYWxsZW5nZScpLCBnb2xkOiBhZGRHb2xkKHNhdmUsIEdPTEQuZGFpbHlXaW4pIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRGFpbHlXaW5BbmRTYXZlKGRheTogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IERhaWx5UmV3YXJkIHsgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZERhaWx5V2luKHMsIGRheSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByOyB9XG4vKiogSGFzIHRvZGF5J3MgcmV3YXJkIGFscmVhZHkgYmVlbiB0YWtlbj8gKi9cbmV4cG9ydCBjb25zdCBkYWlseURvbmUgPSAoc2F2ZTogU2F2ZSwgZGF5OiBudW1iZXIpOiBib29sZWFuID0+ICEhc2F2ZS5kYWlseSAmJiBzYXZlLmRhaWx5LmRheSA9PT0gZGF5ICYmIHNhdmUuZGFpbHkud29uO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gRW5kbGVzcyBEZXB0aHNcbmV4cG9ydCBpbnRlcmZhY2UgRW5kbGVzc1Jld2FyZCB7IHdhdmU6IG51bWJlcjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyBuZXdCZXN0OiBib29sZWFuIH1cbi8qKiBXYXZlIGB3YXZlYCBvZiBhbiBlbmRsZXNzIHJ1biB3YXMgY2xlYXJlZDogYSBwYWNrIG9uIGV2ZXJ5IDEwdGggd2F2ZSAoYmV0dGVyIHRpZXJzIGRlZXBlciksIGFuZCB0aGUgYmVzdCBkZXB0aCBpcyByZW1lbWJlcmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZEVuZGxlc3NXYXZlKHNhdmU6IFNhdmUsIHdhdmU6IG51bWJlcik6IEVuZGxlc3NSZXdhcmQge1xuICBjb25zdCBuZXdCZXN0ID0gd2F2ZSA+IHNhdmUuZW5kbGVzcy5iZXN0OyBpZiAobmV3QmVzdCkgc2F2ZS5lbmRsZXNzLmJlc3QgPSB3YXZlO1xuICBjb25zdCBwYWNrID0gd2F2ZSA+IDAgJiYgd2F2ZSAlIEVORExFU1NfUEFDS19FVkVSWSA9PT0gMCA/IGdyYW50UGFjayhzYXZlLCBlbmRsZXNzUGFja1RpZXIod2F2ZSksICdFbmRsZXNzIFx1MDBCNyB3YXZlICcgKyB3YXZlKSA6IG51bGw7XG4gIHJldHVybiB7IHdhdmUsIHBhY2ssIG5ld0Jlc3QgfTtcbn1cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFbmRsZXNzV2F2ZUFuZFNhdmUod2F2ZTogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IEVuZGxlc3NSZXdhcmQge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBjb25zdCByID0gcmVjb3JkRW5kbGVzc1dhdmUocywgd2F2ZSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByO1xufVxuLyoqIEVuZGxlc3MgRGVwdGhzIG9wZW5zIG9uY2UgdGhlIGxhc3QgY2FtcGFpZ24gc3RhZ2UgaGFzIGJlZW4gY2xlYXJlZCBvbiBOb3JtYWwuICovXG5leHBvcnQgY29uc3QgZW5kbGVzc1VubG9ja2VkID0gKHNhdmU6IFNhdmUpOiBib29sZWFuID0+IGNsZWFyQ291bnQoc2F2ZSwgU1RBR0VTW1NUQUdFUy5sZW5ndGggLSAxXS5pZCwgJ25vcm1hbCcpID4gMDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHVubG9jayBydWxlc1xuLy8gRWFzeSBhbmQgTm9ybWFsIGFyZSBvcGVuIG9uIGV2ZXJ5IHVubG9ja2VkIHN0YWdlLiBDbGVhcmluZyBOb3JtYWwgb3BlbnMgSGFyZCBvbiB0aGF0IHN0YWdlIEFORCB1bmxvY2tzIHRoZSBuZXh0IHN0YWdlLiBDbGVhcmluZyBIYXJkIG9wZW5zIE5pZ2h0bWFyZS5cbmV4cG9ydCBjb25zdCBjbGVhckNvdW50ID0gKHNhdmU6IFNhdmUsIHN0YWdlOiBzdHJpbmcsIGQ6IERpZmZpY3VsdHkpOiBudW1iZXIgPT4gc2F2ZS5jbGVhcnNbc3RhZ2UgKyAnOicgKyBkXSA/PyAwO1xuZXhwb3J0IGZ1bmN0aW9uIHN0YWdlVW5sb2NrZWQoc2F2ZTogU2F2ZSwgaW5kZXg6IG51bWJlcik6IGJvb2xlYW4geyByZXR1cm4gaW5kZXggPD0gMCB8fCAoaW5kZXggPCBTVEFHRVMubGVuZ3RoICYmIGNsZWFyQ291bnQoc2F2ZSwgU1RBR0VTW2luZGV4IC0gMV0uaWQsICdub3JtYWwnKSA+IDApOyB9XG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eVVubG9ja2VkKHNhdmU6IFNhdmUsIHN0YWdlOiBzdHJpbmcsIGQ6IERpZmZpY3VsdHkpOiBib29sZWFuIHtcbiAgY29uc3QgaWR4ID0gU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gc3RhZ2UpOyBpZiAoaWR4IDwgMCB8fCAhc3RhZ2VVbmxvY2tlZChzYXZlLCBpZHgpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChkID09PSAnZWFzeScgfHwgZCA9PT0gJ25vcm1hbCcpIHJldHVybiB0cnVlO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gY2xlYXJDb3VudChzYXZlLCBzdGFnZSwgJ25vcm1hbCcpID4gMCA6IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdoYXJkJykgPiAwO1xufVxuLyoqIFdoeSBhIHN0YWdlIGlzIGxvY2tlZCAoZW1wdHkgd2hlbiBpdCBpcyBvcGVuKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFnZUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgaW5kZXg6IG51bWJlcik6IHN0cmluZyB7IHJldHVybiBzdGFnZVVubG9ja2VkKHNhdmUsIGluZGV4KSA/ICcnIDogJ0NsZWFyICcgKyBTVEFHRVNbaW5kZXggLSAxXS5uYW1lICsgJyBvbiBOb3JtYWwgdG8gdW5sb2NrLic7IH1cbi8qKiBXaHkgYSB0aWVyIGlzIGxvY2tlZCAoZW1wdHkgd2hlbiBpdCBpcyBvcGVuKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaWZmaWN1bHR5TG9ja1JlYXNvbihzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogc3RyaW5nIHtcbiAgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdGFnZSwgZCkpIHJldHVybiAnJztcbiAgY29uc3QgaWR4ID0gc3RhZ2VJbmRleChzdGFnZSk7IGlmICghc3RhZ2VVbmxvY2tlZChzYXZlLCBpZHgpKSByZXR1cm4gc3RhZ2VMb2NrUmVhc29uKHNhdmUsIGlkeCk7XG4gIHJldHVybiBkID09PSAnaGFyZCcgPyAnQ2xlYXIgJyArIHN0YWdlQnlJZChzdGFnZSkubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jayBIYXJkLicgOiAnQ2xlYXIgJyArIHN0YWdlQnlJZChzdGFnZSkubmFtZSArICcgb24gSGFyZCB0byB1bmxvY2sgTmlnaHRtYXJlLic7XG59XG4vKiogV2hhdGV2ZXIgd2FzIHNhdmVkLCBtYWtlIGl0IGEgc3RhZ2UgYW5kIHRpZXIgdGhlIHBsYXllciBtYXkgYWN0dWFsbHkgcGxheS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwbGF5YWJsZShzYXZlOiBTYXZlKTogeyBzdGFnZTogc3RyaW5nOyBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5IH0ge1xuICBsZXQgaWR4ID0gc3RhZ2VJbmRleChzYXZlLnN0YWdlKTsgd2hpbGUgKGlkeCA+IDAgJiYgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgaWR4LS07XG4gIGNvbnN0IHN0YWdlID0gU1RBR0VTW2lkeF0uaWQ7XG4gIHJldHVybiB7IHN0YWdlLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIHNhdmUuZGlmZmljdWx0eSkgPyBzYXZlLmRpZmZpY3VsdHkgOiAnbm9ybWFsJyB9O1xufVxuXG4vKiogRXZlcnkgdW5sb2NrIHRoZSBwbGF5ZXIgbWF5IGJlIGNlbGVicmF0ZWQgZm9yOiBsYXRlciBzdGFnZXMgYW5kIHRoZSBIYXJkIC8gTmlnaHRtYXJlIHRpZXJzIChFYXN5LCBOb3JtYWwgYW5kIFN0YWdlIDEgYXJlIG9wZW4gZnJvbSB0aGUgc3RhcnQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVubG9ja2VkS2V5cyhzYXZlOiBTYXZlKTogc3RyaW5nW10ge1xuICBjb25zdCBrZXlzOiBzdHJpbmdbXSA9IFtdO1xuICBTVEFHRVMuZm9yRWFjaCgoc3QsIGkpID0+IHtcbiAgICBpZiAoaSA+IDAgJiYgc3RhZ2VVbmxvY2tlZChzYXZlLCBpKSkga2V5cy5wdXNoKCdzdGFnZTonICsgc3QuaWQpO1xuICAgIGZvciAoY29uc3QgZCBvZiBbJ2hhcmQnLCAnbmlnaHRtYXJlJ10gYXMgRGlmZmljdWx0eVtdKSBpZiAoZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0LmlkLCBkKSkga2V5cy5wdXNoKCd0aWVyOicgKyBzdC5pZCArICc6JyArIGQpO1xuICB9KTtcbiAgaWYgKGVuZGxlc3NVbmxvY2tlZChzYXZlKSkga2V5cy5wdXNoKCdlbmRsZXNzJyk7XG4gIHJldHVybiBrZXlzO1xufVxuLyoqIFVubG9ja3Mgbm90IHlldCBjZWxlYnJhdGVkLiAqL1xuZXhwb3J0IGNvbnN0IG5ld1VubG9ja3MgPSAoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdID0+IHVubG9ja2VkS2V5cyhzYXZlKS5maWx0ZXIoKGspID0+ICEoc2F2ZS5zZWVuID8/IFtdKS5pbmNsdWRlcyhrKSk7XG5jb25zdCBUSUVSX05BTUU6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IGhhcmQ6ICdIYXJkIG1vZGUnLCBuaWdodG1hcmU6ICdOaWdodG1hcmUgbW9kZScgfTtcbi8qKiBXb3JkcyBmb3IgYW4gdW5sb2NrIGtleSwgZm9yIGJhbm5lcnMuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVVbmxvY2soa2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoa2V5ID09PSAnZW5kbGVzcycpIHJldHVybiAnRW5kbGVzcyBEZXB0aHMgKG5ldyBtb2RlKSc7XG4gIGNvbnN0IFtraW5kLCBzdGFnZSwgdGllcl0gPSBrZXkuc3BsaXQoJzonKTtcbiAgaWYgKGtpbmQgPT09ICdzdGFnZScpIHJldHVybiBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIChuZXcgc3RhZ2UpJztcbiAgcmV0dXJuIChUSUVSX05BTUVbdGllcl0gPz8gdGllcikgKyAnIG9uICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWU7XG59XG4vKiogQ2xlYXJpbmcgYSBzdGFnZTogcmV3YXJkcywgYW5kIHdoaWNoIHVubG9ja3MgdGhpcyBjbGVhciBvcGVuZWQuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQ2xlYXIoc2F2ZTogU2F2ZSwgc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5KTogQ2xlYXJSZXdhcmQge1xuICBjb25zdCBiZWZvcmUgPSB1bmxvY2tlZEtleXMoc2F2ZSksIHIgPSByZWNvcmRDbGVhckJhc2Uoc2F2ZSwgc3RhZ2VJZCwgZGlmZmljdWx0eSk7XG4gIHJldHVybiB7IC4uLnIsIHVubG9ja2VkOiB1bmxvY2tlZEtleXMoc2F2ZSkuZmlsdGVyKChrKSA9PiAhYmVmb3JlLmluY2x1ZGVzKGspKSB9O1xufVxuIiwgIi8vIFRoZSBwbGF5ZXIncyBjaGFyYWN0ZXI6IHRoZSBOZWNyb21hbmNlciAoYSByaWdnZWQgVHJpcG8gbW9kZWwsIFBpcGVsaW5lL3VuaXRzL25lY3JvbWFuY2VyLmpzb24pLlxuLy8gSGUgc3RhbmRzIGJlc2lkZSB0aGUgZ3JpZCwgdGFrZXMgdGhlIGhpdCB3aGVuIGFuIGFybXkgaXMgd2lwZWQgKGhlYXJ0cyBhcmUgSElTIGhlYWx0aCksIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSBhbmQgcmFpc2VzXG4vLyB0aGUgZmFsbGVuLiBFdmVyeXRoaW5nIGhlcmUgaXMgYW5pbWF0aW9uIG9ubHk7IHRoZSBydWxlcyBsaXZlIGluIGNvcmUvcnVsZXMudHMuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuZXhwb3J0IGNsYXNzIE5lY3JvbWFuY2VyIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uOyBsb2NhbCArWiBpcyBoaXMgZmFjaW5nICh0aGUgZ2FtZSByb3RhdGVzIGhpbSB0byBmYWNlIHRoZSBiYXR0bGVmaWVsZClcbiAgcHJpdmF0ZSBlbnQ6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBoYW5kOiBhbnkgPSBudWxsOyBwcml2YXRlIHJpbmc6IGFueTsgcHJpdmF0ZSBwczogYW55O1xuICBwcml2YXRlIHQgPSAwOyBwcml2YXRlIGlkbGVUID0gMDsgcHJpdmF0ZSBuZXh0VGFwID0gODsgcHJpdmF0ZSBidXN5ID0gZmFsc2U7IHByaXZhdGUgZG93bmVkID0gZmFsc2U7IHByaXZhdGUgcmVhZG9ubHkgUyA9IDEuMzU7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSBzY2VuZTogYW55LCBwcml2YXRlIHNvZnQ6IGFueSwgY29udGFpbmVyOiBhbnkpIHtcbiAgICBjb25zdCBzID0gc2NlbmU7XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCduZWNybycsIHMpO1xuICAgIHRoaXMuZW50ID0gY29udGFpbmVyLmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ19uZWNybycsIGZhbHNlLCB7IGRvTm90SW5zdGFudGlhdGU6IHRydWUgfSk7XG4gICAgY29uc3Qgcm9vdCA9IHRoaXMuZW50LnJvb3ROb2Rlc1swXTsgcm9vdC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5TKTtcbiAgICByb290LmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IH0pO1xuICAgIHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IHsgZy5zdG9wKCk7IGcuZW5hYmxlQmxlbmRpbmcgPSB0cnVlOyBnLmJsZW5kaW5nU3BlZWQgPSAwLjEyOyB0aGlzLmFuaW1zW2cubmFtZS5zcGxpdCgnXycpWzBdXSA9IGc7IH0pO1xuICAgIHRoaXMuaGFuZCA9IHJvb3QuZ2V0Q2hpbGRUcmFuc2Zvcm1Ob2RlcyhmYWxzZSkuZmluZCgobjogYW55KSA9PiBuLm5hbWUuaW5jbHVkZXMoJ1NvY2tldF9XZWFwb24nKSkgfHwgbnVsbDtcbiAgICB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTtcbiAgICBjb25zdCByaW5nID0gdGhpcy5yaW5nID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdiYXNlJywgeyByYWRpdXM6IDAuNSwgdGVzc2VsbGF0aW9uOiAzMCB9LCBzKTsgcmluZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgcmluZy5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHJpbmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IHJtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbnInLCBzKTsgcm0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgcm0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQsIDAuMTUsIDAuNzUpOyBybS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBybS5hbHBoYSA9IDAuNTU7IHJpbmcubWF0ZXJpYWwgPSBybTtcbiAgICBjb25zdCBwcyA9IHRoaXMucHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnbmVjcm9BdXJhJywgODAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSBzb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5ob2xkZXI7XG4gICAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMjUsIDAsIC0wLjI1KTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yNSwgMC44LCAwLjI1KTsgcHMubWluTGlmZVRpbWUgPSAwLjY7IHBzLm1heExpZmVUaW1lID0gMS4zO1xuICAgIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjksIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS42LCAwLjE1KTsgcHMubWluRW1pdFBvd2VyID0gMC4zOyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMDc7IHBzLm1heFNpemUgPSAwLjI7IHBzLmVtaXRSYXRlID0gMzA7IHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjgsIDAuMzUsIDEsIDAuNyk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjQ1LCAwLjE1LCAwLjksIDAuNSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBwbGF5KG5hbWU6IHN0cmluZywgbG9vcCA9IGZhbHNlLCBob2xkID0gZmFsc2UpIHtcbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tuYW1lXTsgaWYgKCFnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuY3VyICYmIHRoaXMuY3VyICE9PSBnKSB0aGlzLmN1ci5zdG9wKCk7XG4gICAgZy5zdG9wKCk7IGcuc3RhcnQobG9vcCwgMSwgZy5mcm9tLCBnLnRvKTsgdGhpcy5jdXIgPSBnOyB0aGlzLmJ1c3kgPSAhbG9vcDsgdGhpcy5ob2xkRW5kID0gaG9sZDtcbiAgfVxuICBwcml2YXRlIGhvbGRFbmQgPSBmYWxzZTtcbiAgc2V0RW5hYmxlZChvbjogYm9vbGVhbikgeyB0aGlzLmhvbGRlci5zZXRFbmFibGVkKG9uKTsgaWYgKG9uKSB0aGlzLnBzLnN0YXJ0KCk7IGVsc2UgdGhpcy5wcy5zdG9wKCk7IH1cbiAgLyoqIFdvcmxkIHBvc2l0aW9uIG9mIHRoZSBzdGFmZiBjcnlzdGFsIChmb3Igc3BlbGwgZWZmZWN0cyk6IGFib3ZlIHRoZSBoYW5kIHRoYXQgaG9sZHMgdGhlIHN0YWZmLiAqL1xuICBjcnlzdGFsUG9zKCk6IGFueSB7XG4gICAgdGhpcy5ob2xkZXIuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpO1xuICAgIGNvbnN0IGJhc2UgPSB0aGlzLmhhbmQgPyAodGhpcy5oYW5kLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKSwgdGhpcy5oYW5kLmdldEFic29sdXRlUG9zaXRpb24oKS5jbG9uZSgpKSA6IHRoaXMuaG9sZGVyLmdldEFic29sdXRlUG9zaXRpb24oKS5hZGQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjYgKiB0aGlzLlMsIDApKTtcbiAgICByZXR1cm4gYmFzZS5hZGQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjYyICogdGhpcy5TLCAwKSk7XG4gIH1cblxuICBodXJ0KCkgeyBpZiAoIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0h1cnQnKTsgfVxuICBjYXN0KCkgeyBpZiAoIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0Nhc3QnKTsgfVxuICAvKiogVGhlIGxhc3QgaGVhcnQgaXMgZ29uZTogaGUgc2lua3MgdG8gaGlzIGtuZWVzLiAqL1xuICBkZWZlYXQoKSB7IHRoaXMuZG93bmVkID0gdHJ1ZTsgdGhpcy5wbGF5KCdEb3duJywgZmFsc2UsIHRydWUpOyB9XG4gIHJldml2ZSgpIHsgaWYgKHRoaXMuZG93bmVkKSB7IHRoaXMuZG93bmVkID0gZmFsc2U7IHRoaXMucGxheSgnUmV2aXZlJyk7IH0gZWxzZSBpZiAodGhpcy5idXN5ICYmIHRoaXMuY3VyICE9PSB0aGlzLmFuaW1zWydJZGxlJ10pIHRoaXMucGxheSgnSWRsZScsIHRydWUpOyB9XG5cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLnQgKz0gZHQ7XG4gICAgaWYgKHRoaXMuY3VyICYmICF0aGlzLmN1ci5pc1N0YXJ0ZWQgJiYgIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTsgICAgICAgICAgICAgIC8vIGEgb25lLXNob3QgZmluaXNoZWRcbiAgICBlbHNlIGlmICh0aGlzLmN1ciAmJiAhdGhpcy5jdXIuaXNTdGFydGVkICYmIHRoaXMuZG93bmVkICYmICF0aGlzLmhvbGRFbmQpIHRoaXMucGxheSgnSWRsZScsIHRydWUpO1xuICAgIGlmICghdGhpcy5idXN5ICYmICF0aGlzLmRvd25lZCkgeyB0aGlzLmlkbGVUICs9IGR0OyBpZiAodGhpcy5pZGxlVCA+IHRoaXMubmV4dFRhcCkgeyB0aGlzLmlkbGVUID0gMDsgdGhpcy5uZXh0VGFwID0gOSArIE1hdGgucmFuZG9tKCkgKiA4OyB0aGlzLnBsYXkoJ1RhcCcpOyB9IH1cbiAgICB0aGlzLnBzLmVtaXRSYXRlID0gdGhpcy5kb3duZWQgPyA2IDogKHRoaXMuYnVzeSAmJiB0aGlzLmN1ciA9PT0gdGhpcy5hbmltc1snQ2FzdCddID8gMTEwIDogMzApO1xuICB9XG5cbiAgZGlzcG9zZSgpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG4iLCAiLy8gQWxsIHNvdW5kIGlzIHN5bnRoZXNpemVkIGluIHRoZSBicm93c2VyIHdpdGggdGhlIFdlYiBBdWRpbyBBUEk6IG5vIGF1ZGlvIGZpbGVzIHRvIGRvd25sb2FkLCBsaWNlbnNlIG9yIHNoaXAuXG4vLyBUd28gaW5kZXBlbmRlbnQgc3dpdGNoZXMgKG11c2ljLCBzb3VuZCBlZmZlY3RzKSwgc2F2ZWQgaW4gdGhlIHBsYXllcidzIHNhdmUuIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdGFwLCBzbyBub3RoaW5nIHN0YXJ0c1xuLy8gdW50aWwgdGhlIGZpcnN0IHRvdWNoL2NsaWNrIChgdW5sb2NrYCkuXG5pbXBvcnQgeyBsb2FkU2F2ZSwgdXBkYXRlU2V0dGluZ3MgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuXG5leHBvcnQgdHlwZSBTZnggPSAndGFwJyB8ICdzdW1tb24nIHwgJ21lcmdlJyB8ICdoaXQnIHwgJ2hpdEFycm93JyB8ICdzbWFzaCcgfCAnYXJyb3cnIHwgJ2RlYXRoJyB8ICdjYXN0JyB8ICd0YXVudCcgfCAnc2hvY2t3YXZlJyB8ICdyZXN1cnJlY3QnIHwgJ2hlYXJ0TG9zdCcgfCAndmljdG9yeScgfCAnZGVmZWF0JyB8ICdzdGFydCdcbiAgfCAndW5sb2NrJyB8ICdwYWNrQ2hhcmdlJyB8ICdwYWNrVGllclVwJyB8ICdwYWNrVGVhcicgfCAncGFja0ZhbicgfCAncGFja0ZsaXAnIHwgJ3BhY2tSYXJlJyB8ICdwYWNrRXBpYycgfCAncGFja0xlZ2VuZCcgfCAncGFja0NvbGxlY3QnO1xuZXhwb3J0IHR5cGUgTW9kZSA9ICdidWlsZCcgfCAnYmF0dGxlJztcblxuLy8gTXVzaWM6IEEgbWlub3IsIDgwIGJwbSwgZm91ciBiYXJzIGxvb3BpbmcgKEFtLCBGLCBDLCBFKS4gUm9vdCBub3RlIGZpcnN0LCB0aGVuIGNob3JkIHRvbmVzIChIeikuXG5jb25zdCBDSE9SRFM6IG51bWJlcltdW10gPSBbXG4gIFsxMTAsIDE2NC44MSwgMjIwLCAyNjEuNjMsIDMyOS42M10sXG4gIFs4Ny4zMSwgMTMwLjgxLCAxNzQuNjEsIDIyMCwgMjYxLjYzXSxcbiAgWzEzMC44MSwgMTk2LCAyNjEuNjMsIDMyOS42MywgMzkyXSxcbiAgWzgyLjQxLCAxMjMuNDcsIDE2NC44MSwgMjA3LjY1LCAyNDYuOTRdLFxuXTtcbmNvbnN0IEJFQVQgPSA2MCAvIDgwO1xuXG5jbGFzcyBBdWRpb0VuZ2luZSB7XG4gIHByaXZhdGUgY3R4OiBBdWRpb0NvbnRleHQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBtYXN0ZXIhOiBHYWluTm9kZTsgcHJpdmF0ZSBtdXNpY0J1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIHNmeEJ1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIG5vaXNlQnVmITogQXVkaW9CdWZmZXI7XG4gIG11c2ljID0gdHJ1ZTsgc2Z4ID0gdHJ1ZTsgbW9kZTogTW9kZSA9ICdidWlsZCc7XG4gIHByaXZhdGUgdGltZXIgPSAwOyBwcml2YXRlIG5leHRUID0gMDsgcHJpdmF0ZSBiZWF0ID0gMDsgcHJpdmF0ZSBzdGFtcHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcigpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB9XG5cbiAgcHJpdmF0ZSBzaWxlbnQ6IEhUTUxBdWRpb0VsZW1lbnQgfCBudWxsID0gbnVsbDsgcHJpdmF0ZSBwcmltZWQgPSBmYWxzZTtcbiAgLyoqIGlQaG9uZXMgbXV0ZSBXZWIgQXVkaW8gd2hlbiB0aGUgcmluZ2VyIHN3aXRjaCBpcyBvbiwgdW5sZXNzIHRoZSBwYWdlIGlzIHBsYXlpbmcgXCJyZWFsXCIgbWVkaWEuIEEgc2lsZW50IGxvb3BpbmcgPGF1ZGlvPiBlbGVtZW50IChwbHVzIHRoZVxuICAgKiAgYXVkaW9TZXNzaW9uIGhpbnQgb24gbmV3ZXIgaU9TKSBtb3ZlcyB0aGUgcGFnZSB0byB0aGUgcGxheWJhY2sgY2hhbm5lbCwgc28gdGhlIGdhbWUgaXMgaGVhcmQgZXZlbiB3aXRoIHRoZSBzd2l0Y2ggb24gc2lsZW50LiAqL1xuICBwcml2YXRlIHBsYXliYWNrQ2hhbm5lbCgpIHtcbiAgICB0cnkgeyBjb25zdCBhID0gKG5hdmlnYXRvciBhcyBhbnkpLmF1ZGlvU2Vzc2lvbjsgaWYgKGEpIGEudHlwZSA9ICdwbGF5YmFjayc7IH0gY2F0Y2ggeyAvKiBub3Qgc3VwcG9ydGVkICovIH1cbiAgICBpZiAodGhpcy5zaWxlbnQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbiA9IDQ0MSwgYnVmID0gbmV3IEFycmF5QnVmZmVyKDQ0ICsgbiAqIDIpLCB2ID0gbmV3IERhdGFWaWV3KGJ1ZiksIHN0ciA9IChvOiBudW1iZXIsIHQ6IHN0cmluZykgPT4geyBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspIHYuc2V0VWludDgobyArIGksIHQuY2hhckNvZGVBdChpKSk7IH07XG4gICAgICBzdHIoMCwgJ1JJRkYnKTsgdi5zZXRVaW50MzIoNCwgMzYgKyBuICogMiwgdHJ1ZSk7IHN0cig4LCAnV0FWRScpOyBzdHIoMTIsICdmbXQgJyk7IHYuc2V0VWludDMyKDE2LCAxNiwgdHJ1ZSk7IHYuc2V0VWludDE2KDIwLCAxLCB0cnVlKTsgdi5zZXRVaW50MTYoMjIsIDEsIHRydWUpO1xuICAgICAgdi5zZXRVaW50MzIoMjQsIDQ0MTAwLCB0cnVlKTsgdi5zZXRVaW50MzIoMjgsIDg4MjAwLCB0cnVlKTsgdi5zZXRVaW50MTYoMzIsIDIsIHRydWUpOyB2LnNldFVpbnQxNigzNCwgMTYsIHRydWUpOyBzdHIoMzYsICdkYXRhJyk7IHYuc2V0VWludDMyKDQwLCBuICogMiwgdHJ1ZSk7XG4gICAgICBjb25zdCBlbCA9IG5ldyBBdWRpbyhVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtidWZdLCB7IHR5cGU6ICdhdWRpby93YXYnIH0pKSk7IGVsLmxvb3AgPSB0cnVlOyBlbC52b2x1bWUgPSAwLjAxOyBlbC5zZXRBdHRyaWJ1dGUoJ3BsYXlzaW5saW5lJywgJycpOyB0aGlzLnNpbGVudCA9IGVsO1xuICAgICAgZWwucGxheSgpLmNhdGNoKCgpID0+IHsgdGhpcy5zaWxlbnQgPSBudWxsOyB9KTtcbiAgICB9IGNhdGNoIHsgLyogZmluZTogc291bmQgc3RpbGwgd29ya3MsIGp1c3QgZm9sbG93cyB0aGUgc2lsZW50IHN3aXRjaCAqLyB9XG4gIH1cbiAgLyoqIFdoYXQgdGhlIFNldHRpbmdzIHBhZ2Ugc2hvd3Mgc28gYSBzaWxlbnQgcGhvbmUgY2FuIGJlIGRpYWdub3NlZC4gKi9cbiAgc3RhdHVzKCk6IHsgc3RhdGU6IHN0cmluZzsgdW5sb2NrZWQ6IGJvb2xlYW4gfSB7IHJldHVybiB7IHN0YXRlOiB0aGlzLmN0eCA/IHRoaXMuY3R4LnN0YXRlIDogJ25vdCBzdGFydGVkJywgdW5sb2NrZWQ6ICEhdGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgPT09ICdydW5uaW5nJyB9OyB9XG4gIC8qKiBUaGUgU2V0dGluZ3MgcGFnZSdzIFRlc3Qgc291bmQgYnV0dG9uOiB1bmxvY2sgYW5kIG1ha2UgYSBjbGVhcmx5IGF1ZGlibGUgc291bmQuICovXG4gIHRlc3QoKSB7IHRoaXMudW5sb2NrKCk7IGNvbnN0IHQgPSAoKSA9PiB7IHRoaXMucGxheSgndmljdG9yeScpOyB9OyBpZiAodGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkudGhlbih0KS5jYXRjaCgoKSA9PiB7fSk7IGVsc2UgdCgpOyB9XG5cbiAgLyoqIENhbGwgZnJvbSBhIHVzZXIgZ2VzdHVyZSAodGFwL2NsaWNrKS4gU2FmZSB0byBjYWxsIHJlcGVhdGVkbHkuICovXG4gIHVubG9jaygpIHtcbiAgICB0aGlzLnBsYXliYWNrQ2hhbm5lbCgpO1xuICAgIGlmICghdGhpcy5jdHgpIHtcbiAgICAgIGNvbnN0IEMgPSAod2luZG93IGFzIGFueSkuQXVkaW9Db250ZXh0IHx8ICh3aW5kb3cgYXMgYW55KS53ZWJraXRBdWRpb0NvbnRleHQ7IGlmICghQykgcmV0dXJuO1xuICAgICAgY29uc3QgY3R4OiBBdWRpb0NvbnRleHQgPSB0aGlzLmN0eCA9IG5ldyBDKCk7XG4gICAgICBjb25zdCBjb21wID0gY3R4LmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvcigpOyBjb21wLmNvbm5lY3QoY3R4LmRlc3RpbmF0aW9uKTtcbiAgICAgIHRoaXMubWFzdGVyID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tYXN0ZXIuZ2Fpbi52YWx1ZSA9IDAuOTsgdGhpcy5tYXN0ZXIuY29ubmVjdChjb21wKTtcbiAgICAgIHRoaXMubXVzaWNCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm11c2ljQnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpOyB0aGlzLnNmeEJ1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMuc2Z4QnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpO1xuICAgICAgY3R4Lm9uc3RhdGVjaGFuZ2UgPSAoKSA9PiB7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tYXVkaW8tc3RhdGUnKSk7IH07XG4gICAgICBjb25zdCBsZW4gPSBjdHguc2FtcGxlUmF0ZTsgdGhpcy5ub2lzZUJ1ZiA9IGN0eC5jcmVhdGVCdWZmZXIoMSwgbGVuLCBjdHguc2FtcGxlUmF0ZSk7IGNvbnN0IGQgPSB0aGlzLm5vaXNlQnVmLmdldENoYW5uZWxEYXRhKDApOyBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKSBkW2ldID0gTWF0aC5yYW5kb20oKSAqIDIgLSAxO1xuICAgIH1cbiAgICBpZiAodGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkuY2F0Y2goKCkgPT4ge30pOyAgICAgICAgICAgICAvLyAnc3VzcGVuZGVkJyBvciAoaU9TKSAnaW50ZXJydXB0ZWQnXG4gICAgaWYgKCF0aGlzLnByaW1lZCkgeyB0aGlzLnByaW1lZCA9IHRydWU7IHRyeSB7IGNvbnN0IGIgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXIoMSwgMSwgMjIwNTApLCBzID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyU291cmNlKCk7IHMuYnVmZmVyID0gYjsgcy5jb25uZWN0KHRoaXMuY3R4LmRlc3RpbmF0aW9uKTsgcy5zdGFydCgwKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9IH1cbiAgICB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTtcbiAgfVxuXG4gIHNldE11c2ljKG9uOiBib29sZWFuKSB7IHRoaXMubXVzaWMgPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBtdXNpYzogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyB9XG4gIHNldFNmeChvbjogYm9vbGVhbikgeyB0aGlzLnNmeCA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IHNmeDogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyBpZiAob24pIHRoaXMucGxheSgndGFwJyk7IH1cbiAgLyoqIFJlLXJlYWQgdGhlIHNhdmVkIHN3aXRjaGVzICh0aGUgc2hlbGwncyBTZXR0aW5ncyBwYWdlIGNoYW5nZXMgdGhlbSB0b28pLiAqL1xuICByZWxvYWQoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IH1cbiAgc2V0TW9kZShtOiBNb2RlKSB7IHRoaXMubW9kZSA9IG07IH1cblxuICBwcml2YXRlIGFwcGx5R2FpbnMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuOyBjb25zdCB0ID0gdGhpcy5jdHguY3VycmVudFRpbWU7XG4gICAgdGhpcy5tdXNpY0J1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLm11c2ljID8gMC41IDogMCwgdCwgMC4xNSk7IHRoaXMuc2Z4QnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMuc2Z4ID8gMC44IDogMCwgdCwgMC4wNSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbXVzaWNcbiAgcHJpdmF0ZSBzeW5jTXVzaWMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLm11c2ljICYmICF0aGlzLnRpbWVyKSB7IHRoaXMubmV4dFQgPSB0aGlzLmN0eC5jdXJyZW50VGltZSArIDAuMTU7IHRoaXMudGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy50aWNrKCksIDIwMCk7IH1cbiAgICBpZiAoIXRoaXMubXVzaWMgJiYgdGhpcy50aW1lcikgeyBjbGVhckludGVydmFsKHRoaXMudGltZXIpOyB0aGlzLnRpbWVyID0gMDsgfVxuICB9XG4gIHByaXZhdGUgdGljaygpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7IGlmIChjdHguc3RhdGUgIT09ICdydW5uaW5nJykgeyB0aGlzLm5leHRUID0gY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgcmV0dXJuOyB9XG4gICAgd2hpbGUgKHRoaXMubmV4dFQgPCBjdHguY3VycmVudFRpbWUgKyAwLjYpIHsgdGhpcy5wbGF5QmVhdCh0aGlzLmJlYXQsIHRoaXMubmV4dFQpOyB0aGlzLm5leHRUICs9IEJFQVQ7IHRoaXMuYmVhdCA9ICh0aGlzLmJlYXQgKyAxKSAlIDE2OyB9XG4gIH1cbiAgcHJpdmF0ZSBwbGF5QmVhdChiZWF0OiBudW1iZXIsIHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGNob3JkID0gQ0hPUkRTW01hdGguZmxvb3IoYmVhdCAvIDQpXSwgaW5CYXIgPSBiZWF0ICUgNCwgYmF0dGxlID0gdGhpcy5tb2RlID09PSAnYmF0dGxlJztcbiAgICBpZiAoaW5CYXIgPT09IDApIGZvciAoY29uc3QgZiBvZiBjaG9yZCkgdGhpcy52b2ljZShmLCAndHJpYW5nbGUnLCB0LCBCRUFUICogNCArIDAuOCwgMC4wNDUsIDAuOSwgOTAwKTsgICAvLyBzbG93IHBhZFxuICAgIGlmIChpbkJhciA9PT0gMCB8fCBpbkJhciA9PT0gMikgdGhpcy52b2ljZShjaG9yZFswXSwgJ3NpbmUnLCB0LCBCRUFUICogMS42LCAwLjE2LCAwLjAyLCA0MDApOyAgICAgICAgICAvLyBiYXNzXG4gICAgaWYgKGJhdHRsZSkge1xuICAgICAgdGhpcy5raWNrKHQsIDAuMzIpOyBpZiAoaW5CYXIgPT09IDIpIHRoaXMua2ljayh0ICsgQkVBVCAqIDAuNSwgMC4xOCk7XG4gICAgICB0aGlzLm5vaXNlKHQgKyBCRUFUICogMC41LCAwLjA1LCAwLjA1LCAnaGlnaHBhc3MnLCA3MDAwKTsgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDEuNSAlIEJFQVQsIDAuMDUsIDAuMDMsICdoaWdocGFzcycsIDcwMDApO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAyOyBpKyspIHRoaXMudm9pY2UoY2hvcmRbMSArICgoYmVhdCAqIDIgKyBpKSAlIDQpXSAqIDIsICd0cmlhbmdsZScsIHQgKyBpICogQkVBVCAvIDIsIDAuMjIsIDAuMDUsIDAuMDA1LCAyNTAwKTsgICAvLyBwbHVjayBhcnBlZ2dpb1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHZvaWNlKGZyZXE6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgYXR0YWNrOiBudW1iZXIsIGxwOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS52YWx1ZSA9IGZyZXE7IGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBNYXRoLm1heCgwLjAwNSwgYXR0YWNrKSk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGtpY2sodDogbnVtYmVyLCBnYWluOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZSgxMzAsIHQpOyBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDQyLCB0ICsgMC4xNCk7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgMC4yKTtcbiAgICBvLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyAwLjI1KTtcbiAgfVxuICBwcml2YXRlIG5vaXNlKHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBidXM6IEdhaW5Ob2RlID0gdGhpcy5tdXNpY0J1cywgc3dlZXBUbz86IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbiA9IGN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgbi5idWZmZXIgPSB0aGlzLm5vaXNlQnVmOyBmLnR5cGUgPSB0eXBlOyBmLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHN3ZWVwVG8pIGYuZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc3dlZXBUbywgdCArIGR1cik7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG4uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QoYnVzKTsgbi5zdGFydCh0LCBNYXRoLnJhbmRvbSgpICogMC41KTsgbi5zdG9wKHQgKyBkdXIgKyAwLjAyKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzb3VuZCBlZmZlY3RzXG4gIHByaXZhdGUgdG9uZShmcmVxOiBudW1iZXIsIGR1cjogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZ2FpbjogbnVtYmVyLCBkZWxheSA9IDAsIHNsaWRlVG8/OiBudW1iZXIsIGF0dGFjayA9IDAuMDA1LCBscCA9IDgwMDApIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIHQgPSBjdHguY3VycmVudFRpbWUgKyBkZWxheSwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc2xpZGVUbykgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzbGlkZVRvLCB0ICsgZHVyKTtcbiAgICBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIGF0dGFjayk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLnNmeEJ1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBoaXNzKGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgZGVsYXkgPSAwLCBzd2VlcFRvPzogbnVtYmVyKSB7IHRoaXMubm9pc2UodGhpcy5jdHghLmN1cnJlbnRUaW1lICsgZGVsYXksIGR1ciwgZ2FpbiwgdHlwZSwgZnJlcSwgdGhpcy5zZnhCdXMsIHN3ZWVwVG8pOyB9XG4gIHByaXZhdGUgdGhyb3R0bGUoa2V5OiBzdHJpbmcsIG1zOiBudW1iZXIpIHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpOyBpZiAobiAtICh0aGlzLnN0YW1wc1trZXldIHx8IDApIDwgbXMpIHJldHVybiBmYWxzZTsgdGhpcy5zdGFtcHNba2V5XSA9IG47IHJldHVybiB0cnVlOyB9XG5cbiAgLyoqIEEgU291bCdzIHZvaWNlLCBzeW50aGVzaXplZDogc2tlbGV0b24gcmF0dGxlLCBhcmNoZXIgd2hpc3RsZSwgZ29ibGluIGNhY2tsZSwga25pZ2h0IGdydW50LCBvZ3JlIGdyb3dsLCBiYXJiYXJpYW4gcm9hci4gYGtgIHNoaWZ0cyB0aGUgcGl0Y2ggKGVuZW1pZXMgYSBsaXR0bGUgbG93ZXIpLCBgZGVsYXlgIHN0YWdnZXJzIGEgY2hvcnVzLiAqL1xuICBiYXJrKHNvdWw6IHN0cmluZywgZGVsYXkgPSAwLCBrID0gMSkge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuc2Z4IHx8IHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycgfHwgIXRoaXMudGhyb3R0bGUoJ2JhcmsnICsgc291bCwgMzUwKSkgcmV0dXJuO1xuICAgIGNvbnN0IFQgPSAoZjogbnVtYmVyLCBkOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCBnOiBudW1iZXIsIGRsOiBudW1iZXIsIHNsaWRlPzogbnVtYmVyLCBhdHQ/OiBudW1iZXIsIGxwPzogbnVtYmVyKSA9PiB0aGlzLnRvbmUoZiAqIGssIGQsIHR5cGUsIGcsIGRlbGF5ICsgZGwsIHNsaWRlID8gc2xpZGUgKiBrIDogdW5kZWZpbmVkLCBhdHQsIGxwKTtcbiAgICBjb25zdCBIID0gKGQ6IG51bWJlciwgZzogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmOiBudW1iZXIsIGRsOiBudW1iZXIsIHN3PzogbnVtYmVyKSA9PiB0aGlzLmhpc3MoZCwgZywgdHlwZSwgZiwgZGVsYXkgKyBkbCwgc3cpO1xuICAgIHN3aXRjaCAoc291bCkge1xuICAgICAgY2FzZSAnd2Fycmlvcic6IFswLCAwLjA2LCAwLjEyLCAwLjE5XS5mb3JFYWNoKChkbCkgPT4gSCgwLjAzLCAwLjE2LCAnaGlnaHBhc3MnLCAzNTAwLCBkbCkpOyBUKDUyMCwgMC4yMiwgJ3NxdWFyZScsIDAuMDcsIDAsIDI4MCwgMC4wMDUsIDE4MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2FyY2hlcic6IFQoOTAwLCAwLjE2LCAnc2luZScsIDAuMTMsIDAsIDEzNTAsIDAuMDEpOyBUKDEzNTAsIDAuMjIsICdzaW5lJywgMC4xMSwgMC4xNiwgNzYwLCAwLjAxKTsgYnJlYWs7XG4gICAgICBjYXNlICdnb2JsaW4nOiBbMCwgMC4xMSwgMC4yMl0uZm9yRWFjaCgoZGwsIGkpID0+IFQoNTAwICsgaSAqIDcwLCAwLjEsICdzYXd0b290aCcsIDAuMDksIGRsLCA2MjAgKyBpICogNzAsIDAuMDA1LCAyNjAwKSk7IEgoMC4zLCAwLjA1LCAnYmFuZHBhc3MnLCAyMjAwLCAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdrbmlnaHQnOiBUKDE1MCwgMC4zMiwgJ3Nhd3Rvb3RoJywgMC4xMiwgMCwgMTA1LCAwLjAyLCA5MDApOyBUKDIyNSwgMC4zLCAnc3F1YXJlJywgMC4wNSwgMC4wMiwgMTYwLCAwLjAyLCA5MDApOyBIKDAuMDgsIDAuMTIsICdoaWdocGFzcycsIDQ1MDAsIDAuMSk7IGJyZWFrO1xuICAgICAgY2FzZSAnb2dyZSc6IFQoNzUsIDAuNzUsICdzYXd0b290aCcsIDAuMiwgMCwgNTIsIDAuMDUsIDMyMCk7IFQoMTEyLCAwLjcsICdzYXd0b290aCcsIDAuMDgsIDAuMDMsIDgwLCAwLjA1LCA0MjApOyBIKDAuNiwgMC4xMiwgJ2xvd3Bhc3MnLCA0MjAsIDAuMDIsIDE0MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnYmFyYmFyaWFuJzogVCgxNzAsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4xNCwgMCwgMzQwLCAwLjAzLCAxNDAwKTsgVCgzNDAsIDAuNDUsICdzYXd0b290aCcsIDAuMDgsIDAuMSwgMjEwLCAwLjAzLCAxNjAwKTsgSCgwLjQ1LCAwLjEsICdiYW5kcGFzcycsIDkwMCwgMCwgNTAwKTsgYnJlYWs7XG4gICAgfVxuICB9XG4gIHBsYXkobmFtZTogU2Z4KSB7XG4gICAgaWYgKCF0aGlzLmN0eCB8fCAhdGhpcy5zZnggfHwgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgcmV0dXJuO1xuICAgIHN3aXRjaCAobmFtZSkge1xuICAgICAgY2FzZSAndGFwJzogaWYgKCF0aGlzLnRocm90dGxlKCd0YXAnLCA0MCkpIHJldHVybjsgdGhpcy50b25lKDc2MCwgMC4wNiwgJ3NpbmUnLCAwLjIyLCAwLCAxMTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzdW1tb24nOiB0aGlzLmhpc3MoMC40LCAwLjE0LCAnYmFuZHBhc3MnLCA1MDAsIDAsIDI1MDApOyB0aGlzLnRvbmUoMjIwLCAwLjQsICdzYXd0b290aCcsIDAuMSwgMCwgNjYwLCAwLjA1LCAxODAwKTsgdGhpcy50b25lKDEzMjAsIDAuMiwgJ3NpbmUnLCAwLjEsIDAuMTgpOyBicmVhaztcbiAgICAgIGNhc2UgJ21lcmdlJzogWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDgsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjM1LCAwLCA1MCk7IHRoaXMudG9uZSgxNTY4LCAwLjUsICdzaW5lJywgMC4wOCwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICdoaXQnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdCcsIDQ1KSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4wNywgMC4yNCwgJ2xvd3Bhc3MnLCAxODAwKTsgdGhpcy50b25lKDE3MCwgMC4wOSwgJ3NpbmUnLCAwLjIyLCAwLCA4MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0QXJyb3cnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdEEnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDUsIDAuMTQsICdiYW5kcGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNzAwLCAwLjA2LCAndHJpYW5nbGUnLCAwLjA2LCAwLCA0MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3NtYXNoJzogdGhpcy50b25lKDk1LCAwLjM4LCAnc2luZScsIDAuNSwgMCwgMzQpOyB0aGlzLmhpc3MoMC4zMiwgMC4zNSwgJ2xvd3Bhc3MnLCAxMDAwLCAwLCAyMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2Fycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdhcnJvdycsIDYwKSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4xNCwgMC4xLCAnYmFuZHBhc3MnLCAxODAwLCAwLCA0MjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdkZWF0aCc6IGlmICghdGhpcy50aHJvdHRsZSgnZGVhdGgnLCA3MCkpIHJldHVybjsgdGhpcy50b25lKDMwMCwgMC40LCAnc2F3dG9vdGgnLCAwLjE0LCAwLCA3MCwgMC4wMSwgOTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdjYXN0JzogdGhpcy50b25lKDMwMCwgMC40NSwgJ3NpbmUnLCAwLjE4LCAwLCA5MDAsIDAuMDUpOyB0aGlzLnRvbmUoNDUwLCAwLjQ1LCAnc2luZScsIDAuMSwgMC4wNSwgMTM1MCwgMC4wNSk7IHRoaXMudG9uZSgxODAwLCAwLjI1LCAnc2luZScsIDAuMDUsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndGF1bnQnOiB0aGlzLnRvbmUoMTk2LCAwLjUsICdzcXVhcmUnLCAwLjA4LCAwLCAxODAsIDAuMDMsIDcwMCk7IHRoaXMudG9uZSgxNDcsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4wOCwgMC4wMiwgMTQwLCAwLjAzLCA2MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3Nob2Nrd2F2ZSc6IHRoaXMudG9uZSgyMjAsIDEuMSwgJ3NpbmUnLCAwLjUsIDAsIDI4LCAwLjAyKTsgdGhpcy5oaXNzKDEuMCwgMC4zNSwgJ2xvd3Bhc3MnLCAzMDAwLCAwLCAxNTApOyB0aGlzLnRvbmUoODgwLCAwLjgsICdzaW5lJywgMC4wOCwgMCwgMjIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdyZXN1cnJlY3QnOiBbMjIwLCAyNzcsIDMzMCwgNDQwLCA1NTRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMSwgaSAqIDAuMTIsIGYgKiAxLjEyLCAwLjMpKTsgdGhpcy5oaXNzKDAuOSwgMC4wNiwgJ2hpZ2hwYXNzJywgNDUwMCwgMC4yKTsgYnJlYWs7XG4gICAgICBjYXNlICdoZWFydExvc3QnOiB0aGlzLnRvbmUoMTEwLCAwLjcsICdzYXd0b290aCcsIDAuMjgsIDAsIDUwLCAwLjAxLCA0NTApOyB0aGlzLmhpc3MoMC4xOCwgMC4yLCAnbG93cGFzcycsIDkwMCk7IHRoaXMudG9uZSgyMzMsIDAuNSwgJ3NxdWFyZScsIDAuMDUsIDAuMDIsIDIyMCwgMC4wMSwgNTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICd2aWN0b3J5JzogWzM5MiwgNDk0LCA1ODcsIDc4NF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMTEpKTsgdGhpcy50b25lKDE5NiwgMC45LCAnc2luZScsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVmZWF0JzogWzMzMCwgMjk0LCAyNDcsIDE5Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNywgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMjgsIGYgKiAwLjk3KSk7IHRoaXMudG9uZSg4MiwgMS42LCAnc2luZScsIDAuMywgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICd1bmxvY2snOiBbMC4zNSwgMC40NywgMC41OSwgMC43MV0uZm9yRWFjaCgoZCwgaSkgPT4geyB0aGlzLmhpc3MoMC4wNSwgMC4yMiwgJ2JhbmRwYXNzJywgOTAwICsgaSAqIDEyMCwgZCk7IHRoaXMudG9uZSgxNzAgKyBpICogMTIsIDAuMDcsICdzcXVhcmUnLCAwLjA2LCBkLCB1bmRlZmluZWQsIDAuMDAyLCA2MDApOyB9KTsgWzc4NCwgMTA0NiwgMTMxOF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNiwgJ3RyaWFuZ2xlJywgMC4xNiwgMS4xNSArIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDksICdoaWdocGFzcycsIDUwMDAsIDEuMik7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjI1LCAxLjE1LCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NoYXJnZSc6IHRoaXMudG9uZSg5MCwgMS4wNSwgJ3NpbmUnLCAwLjI1LCAwLCAyNjAsIDAuMik7IHRoaXMuaGlzcygwLjk1LCAwLjEyLCAnbG93cGFzcycsIDMwMCwgMCwgMjIwMCk7IHRoaXMudG9uZSgxODAsIDEuMCwgJ3RyaWFuZ2xlJywgMC4wNiwgMC4xLCA1MjAsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1RpZXJVcCc6IFs0NDAsIDU1NCwgNjU5LCA4ODBdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjQsICd0cmlhbmdsZScsIDAuMiwgaSAqIDAuMDYpKTsgdGhpcy50b25lKDE3NjAsIDAuNiwgJ3NpbmUnLCAwLjA5LCAwLjIpOyB0aGlzLmhpc3MoMC40LCAwLjEsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1RlYXInOiB0aGlzLmhpc3MoMC4zNSwgMC4zLCAnYmFuZHBhc3MnLCAxNTAwLCAwLCA2MDAwKTsgdGhpcy50b25lKDEyMCwgMC40NSwgJ3NpbmUnLCAwLjQsIDAuMDUsIDQwKTsgWzEwNDYsIDEzMTgsIDE1NjhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjYsICd0cmlhbmdsZScsIDAuMSwgMC4xMiArIGkgKiAwLjA1KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0Zhbic6IHRoaXMuaGlzcygwLjUsIDAuMSwgJ2hpZ2hwYXNzJywgMzAwMCk7IHRoaXMudG9uZSg2NjAsIDAuNDUsICdzaW5lJywgMC4xLCAwLCAxMzIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRmxpcCc6IHRoaXMuaGlzcygwLjA4LCAwLjE1LCAnYmFuZHBhc3MnLCAyNTAwKTsgdGhpcy50b25lKDUwMCwgMC4xMiwgJ3NpbmUnLCAwLjE0LCAwLCA4MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tSYXJlJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNzg0LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjQ1LCAndHJpYW5nbGUnLCAwLjE0LCAwLjA1ICsgaSAqIDAuMDkpKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRXBpYyc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjcsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA3KSk7IHRoaXMudG9uZSgxMTAsIDAuNSwgJ3NpbmUnLCAwLjMsIDAsIDYwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrTGVnZW5kJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNTIzLCA2NTksIDc4NCwgMTA0NiwgMTMxOF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDEuMSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMDgpKTsgdGhpcy50b25lKDgyLCAwLjksICdzaW5lJywgMC4zNSwgMCwgNTApOyB0aGlzLmhpc3MoMC44LCAwLjEsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgyMDkzLCAwLjcsICdzaW5lJywgMC4wNywgMC40KTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrQ29sbGVjdCc6IFs2NTksIDk4OF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuMzUsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAnc3RhcnQnOiB0aGlzLnRvbmUoMTQ3LCAwLjksICdzYXd0b290aCcsIDAuMTMsIDAsIDE1MCwgMC4xNSwgNjUwKTsgdGhpcy50b25lKDIyMCwgMC45LCAnc2F3dG9vdGgnLCAwLjA5LCAwLjA1LCAyMjQsIDAuMTUsIDY1MCk7IHRoaXMuaGlzcygwLjYsIDAuMDYsICdsb3dwYXNzJywgNjAwKTsgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBhdWRpbyA9IG5ldyBBdWRpb0VuZ2luZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fYXVkaW8gPSBhdWRpbztcblxuLy8gUGhvbmVzIG9ubHkgYWxsb3cgc291bmQgYWZ0ZXIgYSB0b3VjaDogdGhlIGZpcnN0IHRhcCBhbnl3aGVyZSB1bmxvY2tzIGl0LiBFdmVyeSBidXR0b24gYWxzbyBnZXRzIGEgc21hbGwgY2xpY2suXG4vLyBpT1Mgb25seSBhY2NlcHRzIGFuIHVubG9jayBmcm9tIGEgRklOSVNIRUQgdGFwICh0b3VjaGVuZCAvIGNsaWNrKSwgbm90IGZyb20gdGhlIHN0YXJ0IG9mIG9uZSwgc28gbGlzdGVuIHRvIGFsbCBvZiB0aGVtLlxuY29uc3QgdW5sb2NrT25jZSA9ICgpID0+IGF1ZGlvLnVubG9jaygpO1xuZm9yIChjb25zdCBldiBvZiBbJ3BvaW50ZXJkb3duJywgJ3BvaW50ZXJ1cCcsICd0b3VjaGVuZCcsICdjbGljaycsICdrZXlkb3duJ10pIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXYsIHVubG9ja09uY2UsIHsgY2FwdHVyZTogdHJ1ZSB9KTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgY29uc3QgZWwgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7IGlmIChlbCAmJiBlbC5jbG9zZXN0ICYmIGVsLmNsb3Nlc3QoJ2J1dHRvbiwgYS5idG4sIC5yYWlsIGEnKSkgYXVkaW8ucGxheSgndGFwJyk7IH0sIHRydWUpO1xuZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigndmlzaWJpbGl0eWNoYW5nZScsICgpID0+IHsgY29uc3QgYyA9IChhdWRpbyBhcyBhbnkpLmN0eCBhcyBBdWRpb0NvbnRleHQgfCBudWxsOyBpZiAoIWMpIHJldHVybjsgaWYgKGRvY3VtZW50LmhpZGRlbikgYy5zdXNwZW5kKCk7IGVsc2UgaWYgKGF1ZGlvLm11c2ljIHx8IGF1ZGlvLnNmeCkgYy5yZXN1bWUoKTsgfSk7XG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MtY2hhbmdlZCcsICgpID0+IGF1ZGlvLnJlbG9hZCgpKTtcbiIsICIvLyBTYXZpbmcgYSBydW4gaW4gcHJvZ3Jlc3Mgc28gaXQgc3Vydml2ZXMgYSBwYWdlIHJlbG9hZCAoU2FmYXJpIG9uIGEgcGhvbmUgY2FuIGRyb3AgdGhlIHBhZ2UgYXQgYW55IHRpbWUpLlxuLy8gT25seSBjYWxtIG1vbWVudHMgYXJlIHNhdmVkOiB0aGUgYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0LiBBIGJhdHRsZSBpbiBwcm9ncmVzcyBpcyBub3Qgc2F2ZWQ7IHJlbG9hZGluZyBkdXJpbmcgb25lIHB1dHMgeW91IGJhY2tcbi8vIGF0IHRoZSBidWlsZCBzY3JlZW4geW91IHByZXNzZWQgQmF0dGxlIGZyb20gKG5vdGhpbmcgbG9zdCwgbm90aGluZyBnYWluZWQpLiBFdmVyeXRoaW5nIHJlYWQgYmFjayBpcyB2YWxpZGF0ZWQ7IGFueXRoaW5nIG9kZCBpcyBpZ25vcmVkLlxuXG5pbXBvcnQgeyBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzLCBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUsIFVuaXQgfSBmcm9tICcuL3J1bGVzLnRzJztcbmltcG9ydCB7IGJyb3dzZXJTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0b3JlIH0gZnJvbSAnLi9zYXZlLnRzJztcblxuY29uc3QgS0VZID0gJ25lY3JvLXJ1bic7XG5jb25zdCBWRVJTSU9OID0gMTtcblxuZXhwb3J0IGludGVyZmFjZSBTZXJpYWxpemVkU3RhdGUge1xuICBydWxlczogUnVsZXM7IHJuZzogeyBzZWVkOiBudW1iZXI7IHBvczogbnVtYmVyIH07XG4gIHdhdmU6IG51bWJlcjsgaGVhcnRzOiBudW1iZXI7IGNhcDogbnVtYmVyOyBoYW5kOiBTb3VsSWRbXTsgdW5pdHM6IFVuaXRbXTsgbmV4dElkOiBudW1iZXI7IGRpc2NhcmRVc2VkOiBib29sZWFuO1xuICBzdGF0dXM6ICdidWlsZGluZyc7IGxvZzogc3RyaW5nW107IHN0YXRzOiBTdGF0ZVsnc3RhdHMnXTtcbn1cbmV4cG9ydCBpbnRlcmZhY2UgUnVuU25hcHNob3QgeyB2OiBudW1iZXI7IHNlZWQ6IG51bWJlcjsgYXR0ZW1wdDogbnVtYmVyOyBzdGFnZTogc3RyaW5nOyBkaWZmaWN1bHR5OiBzdHJpbmc7IHBoYXNlOiAnYnVpbGQnIHwgJ2RyYWZ0JzsgZHJhZnQ6IFNvdWxJZFtdIHwgbnVsbDsgc3RhdGU6IFNlcmlhbGl6ZWRTdGF0ZTsgc3RhcnRCZXN0PzogbnVtYmVyIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZVN0YXRlKHM6IFN0YXRlKTogU2VyaWFsaXplZFN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBydWxlczogSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzLnJ1bGVzKSksIHJuZzogeyBzZWVkOiBzLnJuZy5zZWVkLCBwb3M6IHMucm5nLnN0YXRlKCkgfSxcbiAgICB3YXZlOiBzLndhdmUsIGhlYXJ0czogcy5oZWFydHMsIGNhcDogcy5jYXAsIGhhbmQ6IHMuaGFuZC5zbGljZSgpLCB1bml0czogcy51bml0cy5tYXAoKHUpID0+ICh7IC4uLnUgfSkpLCBuZXh0SWQ6IHMubmV4dElkLCBkaXNjYXJkVXNlZDogcy5kaXNjYXJkVXNlZCxcbiAgICBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogcy5sb2cuc2xpY2UoLTQwKSwgc3RhdHM6IHsgLi4ucy5zdGF0cyB9LFxuICB9O1xufVxuXG5jb25zdCBpc1NvdWwgPSAoeDogYW55KTogeCBpcyBTb3VsSWQgPT4gU09VTFMuaW5jbHVkZXMoeCk7XG5jb25zdCBpbnQgPSAoeDogYW55LCBsbzogbnVtYmVyLCBoaTogbnVtYmVyKSA9PiBOdW1iZXIuaXNJbnRlZ2VyKHgpICYmIHggPj0gbG8gJiYgeCA8PSBoaTtcblxuLyoqIFJlYnVpbGQgYSBTdGF0ZSBmcm9tIHNhdmVkIGRhdGEsIG9yIG51bGwgaWYgYW55dGhpbmcgYWJvdXQgaXQgaXMgbm90IGJlbGlldmFibGUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVTdGF0ZSh4OiBhbnkpOiBTdGF0ZSB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHIgPSB4LnJ1bGVzO1xuICAgIGlmICghciB8fCAhQXJyYXkuaXNBcnJheShyLmN1cnZlKSB8fCAhci5jdXJ2ZS5sZW5ndGggfHwgIXIuY3VydmUuZXZlcnkoKG46IGFueSkgPT4gTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIubWVyZ2UgIT09ICdkZXBsb3llZE9ubHknICYmIHIubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoci5wb29sICE9PSB1bmRlZmluZWQgJiYgIShBcnJheS5pc0FycmF5KHIucG9vbCkgJiYgci5wb29sLmxlbmd0aCAmJiByLnBvb2wuZXZlcnkoaXNTb3VsKSkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHN0YWdlV2F2ZXMgPSByLnN0YWdlV2F2ZXMgPz8gci5jdXJ2ZS5sZW5ndGg7XG4gICAgaWYgKCFpbnQoeC53YXZlLCAxLCBNYXRoLm1pbihzdGFnZVdhdmVzLCByLmN1cnZlLmxlbmd0aCkpIHx8ICFpbnQoeC5oZWFydHMsIDEsIEhFQVJUUykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmNhcCkgfHwgeC5jYXAgPD0gMCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHguaGFuZCkgfHwgeC5oYW5kLmxlbmd0aCA+IDQwIHx8ICF4LmhhbmQuZXZlcnkoaXNTb3VsKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHgudW5pdHMpIHx8IHgudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFpbnQoeC5uZXh0SWQsIDEsIDFlNikgfHwgdHlwZW9mIHguZGlzY2FyZFVzZWQgIT09ICdib29sZWFuJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY2VsbHMgPSBuZXcgU2V0PG51bWJlcj4oKSwgaWRzID0gbmV3IFNldDxudW1iZXI+KCksIHVuaXRzOiBVbml0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgeC51bml0cykge1xuICAgICAgaWYgKCF1IHx8ICFpc1NvdWwodS5zb3VsKSB8fCAhaW50KHUuc3RhciwgMSwgTUFYX1NUQVIpIHx8ICFpbnQodS5jZWxsLCAwLCBHUklEX0NFTExTIC0gMSkgfHwgIWludCh1LmlkLCAxLCB4Lm5leHRJZCkgfHwgY2VsbHMuaGFzKHUuY2VsbCkgfHwgaWRzLmhhcyh1LmlkKSkgcmV0dXJuIG51bGw7XG4gICAgICBjZWxscy5hZGQodS5jZWxsKTsgaWRzLmFkZCh1LmlkKTsgdW5pdHMucHVzaCh7IGlkOiB1LmlkLCBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsLCBmcmVzaDogISF1LmZyZXNoIH0pO1xuICAgIH1cbiAgICBjb25zdCBzdCA9IHguc3RhdHM7XG4gICAgaWYgKCFzdCB8fCAhWydkcmF3bicsICdkaXNjYXJkZWQnLCAnZGlzbWlzc2VkJywgJ21lcmdlcycsICdmYWlsdXJlcyddLmV2ZXJ5KChrKSA9PiBOdW1iZXIuaXNGaW5pdGUoc3Rba10pKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF4LnJuZyB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5ybmcucG9zKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bGVzOiByIGFzIFJ1bGVzLCBybmc6IG1ha2VSbmcoeC5ybmcuc2VlZCwgeC5ybmcucG9zKSwgd2F2ZTogeC53YXZlLCBoZWFydHM6IHguaGVhcnRzLCBjYXA6IHguY2FwLCBoYW5kOiB4LmhhbmQuc2xpY2UoKSwgdW5pdHMsIG5leHRJZDogeC5uZXh0SWQsXG4gICAgICBkaXNjYXJkVXNlZDogeC5kaXNjYXJkVXNlZCwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IEFycmF5LmlzQXJyYXkoeC5sb2cpID8geC5sb2cuZmlsdGVyKChsOiBhbnkpID0+IHR5cGVvZiBsID09PSAnc3RyaW5nJykuc2xpY2UoLTQwKSA6IFtdLFxuICAgICAgc3RhdHM6IHsgZHJhd246IHN0LmRyYXduLCBkaXNjYXJkZWQ6IHN0LmRpc2NhcmRlZCwgZGlzbWlzc2VkOiBzdC5kaXNtaXNzZWQsIG1lcmdlczogc3QubWVyZ2VzLCBmYWlsdXJlczogc3QuZmFpbHVyZXMgfSxcbiAgICB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhdmVSdW4oc25hcDogUnVuU25hcHNob3QsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzbmFwKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDogdGhlIHJ1biBqdXN0IHdpbGwgbm90IHN1cnZpdmUgYSByZWxvYWQgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyUnVuKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUgJiYgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbSkgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbShLRVkpOyBlbHNlIGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksICcnKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG59XG5leHBvcnQgZnVuY3Rpb24gbG9hZFJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IHQgPSBzdG9yZSAmJiBzdG9yZS5nZXRJdGVtKEtFWSk7IGlmICghdCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgeCA9IEpTT04ucGFyc2UodCk7XG4gICAgaWYgKCF4IHx8IHgudiAhPT0gVkVSU0lPTiB8fCAoeC5waGFzZSAhPT0gJ2J1aWxkJyAmJiB4LnBoYXNlICE9PSAnZHJhZnQnKSB8fCAhTnVtYmVyLmlzRmluaXRlKHguc2VlZCkgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmF0dGVtcHQpIHx8IHR5cGVvZiB4LmRpZmZpY3VsdHkgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGF0ZSA9IGRlc2VyaWFsaXplU3RhdGUoeC5zdGF0ZSk7IGlmICghc3RhdGUpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGRyYWZ0ID0geC5waGFzZSA9PT0gJ2RyYWZ0JyAmJiBBcnJheS5pc0FycmF5KHguZHJhZnQpICYmIHguZHJhZnQubGVuZ3RoID09PSAzICYmIHguZHJhZnQuZXZlcnkoaXNTb3VsKSA/IHguZHJhZnQgOiBudWxsO1xuICAgIHJldHVybiB7IHNuYXA6IHsgdjogVkVSU0lPTiwgc2VlZDogeC5zZWVkLCBhdHRlbXB0OiB4LmF0dGVtcHQsIHN0YWdlOiB0eXBlb2YgeC5zdGFnZSA9PT0gJ3N0cmluZycgPyB4LnN0YWdlIDogJ2NyeXB0JywgZGlmZmljdWx0eTogeC5kaWZmaWN1bHR5LCBwaGFzZTogZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJywgZHJhZnQsIHN0YXRlOiB4LnN0YXRlLCBzdGFydEJlc3Q6IE51bWJlci5pc0ludGVnZXIoeC5zdGFydEJlc3QpICYmIHguc3RhcnRCZXN0ID49IDAgJiYgeC5zdGFydEJlc3QgPD0gOTk5OSA/IHguc3RhcnRCZXN0IDogdW5kZWZpbmVkIH0sIHN0YXRlIH07XG4gIH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxufVxuZXhwb3J0IGNvbnN0IFJVTl9WRVJTSU9OID0gVkVSU0lPTjtcbiIsICIvLyBFdmVyeXRoaW5nIHlvdSBTRUUgZm9yIGEgdW5pdDogcmVhbCBUcmlwbyBtb2RlbHMgKFNrZWxldG9uIFdhcnJpb3IsIFNrZWxldG9uIEFyY2hlciksIHNpbXBsZSBzdGFuZC1pbnMgZm9yIHRoZSBmb3VyXG4vLyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBnZW5lcmF0ZWQgeWV0LCBhbmQgdGhlIFwic3RhciBsb29rXCIgbGF5ZXJlZCBvbiB0b3Agb2YgYm90aCAoc2l6ZSwgdGludCwgYXVyYSwgaGFsbywgYmFkZ2UpLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5cbmV4cG9ydCB0eXBlIFZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhdGgnIHwgJ3NwYXduJyB8ICdjaGVlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbiArIHlhdyBoZXJlXG4gIHRlYW06IDAgfCAxOyBzdGFyOiBudW1iZXI7IHN0YXRlOiBWU3RhdGU7IHRvcDogbnVtYmVyO1xuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkPzogbnVtYmVyKTogdm9pZDtcbiAgc2V0U3RhcihzdGFyOiBudW1iZXIpOiB2b2lkO1xuICBzZXRUZWFtKHRlYW06IDAgfCAxKTogdm9pZDtcbiAgc2V0SHAoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7ICAvLyBudWxsIGhpZGVzIHRoZSBoZWFsdGggYmFyXG4gIHNldE1hbmEoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7IC8vIG51bGwgaGlkZXMgdGhlIG1hbmEgYmFyICh1bml0cyB3aXRob3V0IGEgc2tpbGwpXG4gIHB1bHNlKCk6IHZvaWQ7ICAgICAgICAgICAgICAgICAgICAgLy8gYnJpZWYgaGl0IHJlYWN0aW9uXG4gIHVwZGF0ZShkdDogbnVtYmVyKTogdm9pZDtcbiAgZGlzcG9zZSgpOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YXIgbG9va3Ncbi8vIDEgc3RhciA9IHRoZSBwbGFpbiBtb2RlbC4gMiBzdGFycyA9IGEgbGl0dGxlIGJpZ2dlciwgY29vbCBzaWx2ZXItYmx1ZSB0aW50LCBicmlnaHRlciBhdXJhLiAzIHN0YXJzID0gYmlnZ2VzdCwgd2FybSBnb2xkIHRpbnQsXG4vLyBzdHJvbmcgZ29sZC12aW9sZXQgYXVyYSBhbmQgYSBmbG9hdGluZyBnb2xkIGhhbG8uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBmcmVlOiBubyBleHRyYSBUcmlwbyBnZW5lcmF0aW9ucy5cbmNvbnN0IFRJTlQ6IG51bWJlcltdW10gPSBbWzEsIDEsIDFdLCBbMC44NiwgMC45NSwgMS4xOF0sIFsxLjI1LCAxLjEsIDAuN11dO1xuY29uc3QgQVVSQSA9IFtcbiAgeyByYXRlOiAxNCwgbWluOiAwLjA2LCBtYXg6IDAuMTYsIGMxOiBbMC43OCwgMC4zNSwgMSwgMC43XSwgYzI6IFswLjQ1LCAwLjE1LCAwLjksIDAuNV0gfSxcbiAgeyByYXRlOiAyNiwgbWluOiAwLjA4LCBtYXg6IDAuMjAsIGMxOiBbMC44NSwgMC42NSwgMSwgMC44XSwgYzI6IFswLjU1LCAwLjQsIDEsIDAuNl0gfSxcbiAgeyByYXRlOiA0NCwgbWluOiAwLjEwLCBtYXg6IDAuMjYsIGMxOiBbMSwgMC44NSwgMC40LCAwLjg1XSwgYzI6IFswLjgsIDAuMywgMSwgMC43XSB9LFxuXTtcblxuZXhwb3J0IGludGVyZmFjZSBBc3NldHMge1xuICBzY2VuZTogYW55OyBzb2Z0OiBhbnk7IHN0YXJUZXg6IGFueVtdOyB0cmlwbzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBUcmlwb0NmZz4+OyBlbW90ZTogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgcmluZ01hdDogYW55W107IGhhbG9NYXQ6IGFueTsgYmFyQmc6IGFueTsgYmFyRmlsbDogYW55W107IG1hbmFGaWxsOiBhbnk7IGFycm93PzogYW55OyBuZWNybz86IGFueTtcbn1cbi8qKiBGbGF2b3VyIGEgdW5pdCBjYW4gaGF2ZTogYSBjbGlwIGl0IHBsYXlzIG5vdyBhbmQgdGhlbiB3aGVuIGl0IGhhcyBzdG9vZCBpZGxlIGZvciBhIHdoaWxlLCBhIHNtYWxsIGVtb3RlLCBhbmQgYW4gZXllLWdsb3cgbWFzayAoZXllcyBkaW0gd2hlbiBzbGVlcHksIGZsYXJlIHdoZW4gaXQgZmlnaHRzKS4gKi9cbi8qKiBJZGxlIGNsaXBzIHdoZXJlIHRoZSB1bml0IG1ha2VzIGEgbm9pc2UuICovXG5jb25zdCBWT0NBTCA9IG5ldyBTZXQoWydSb2FyJywgJ1RodW1wJywgJ1N0b21wJywgJ1NuaWNrZXInLCAnU2NoZW1lJywgJ0JvYXN0JywgJ0ZsZXgnLCAnRG91YmxlQmljZXBzJywgJ0Z1bWJsZScsICdTaGllbGRCb25rJywgJ0JvbmsnXSk7XG5pbnRlcmZhY2UgUG9zZSB7IGNsaXA6IHN0cmluZzsgZW1vdGU/OiBzdHJpbmcgfVxuaW50ZXJmYWNlIEZsYXZvciB7IGNsaXBzOiBQb3NlW107IG1pbjogbnVtYmVyOyBtYXg6IG51bWJlciB9XG5pbnRlcmZhY2UgVHJpcG9DZmcgeyBjb250YWluZXI6IGFueTsgZW5lbXlUZXg6IGFueTsgY2xpcHM6IFJlY29yZDxWU3RhdGUsIHN0cmluZz47IG1hdENhY2hlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+OyBiYXNlTWF0PzogYW55OyB0b3A6IG51bWJlcjsgc2NhbGU6IG51bWJlcjsgZmxhdm9yPzogRmxhdm9yOyBjaGVlcnM/OiBQb3NlW107IHNwYXduRW1vdGU/OiBzdHJpbmc7IGV5ZXM/OiBzdHJpbmc7IGV5ZVRleD86IGFueTsgc3RhclNjYWxlPzogbnVtYmVyW10gfVxuXG5mdW5jdGlvbiBkeW4oc2NlbmU6IGFueSwgdzogbnVtYmVyLCBoOiBudW1iZXIsIGRyYXc6IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHZvaWQsIGFscGhhID0gdHJ1ZSkge1xuICBjb25zdCB0ID0gbmV3IEJBQllMT04uRHluYW1pY1RleHR1cmUoJ2R0JywgeyB3aWR0aDogdywgaGVpZ2h0OiBoIH0sIHNjZW5lLCB0cnVlKTsgZHJhdyh0LmdldENvbnRleHQoKSk7IHQudXBkYXRlKCk7IHQuaGFzQWxwaGEgPSBhbHBoYTsgcmV0dXJuIHQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkQXNzZXRzKHNjZW5lOiBhbnkpOiBQcm9taXNlPEFzc2V0cz4ge1xuICBjb25zdCBzb2Z0ID0gZHluKHNjZW5lLCA2NCwgNjQsIChjKSA9PiB7IGNvbnN0IGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KDMyLCAzMiwgMCwgMzIsIDMyLCAzMik7IGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDEpJyk7IGcuYWRkQ29sb3JTdG9wKDAuNCwgJ3JnYmEoMjU1LDI1NSwyNTUsLjU1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpOyBjLmZpbGxTdHlsZSA9IGc7IGMuZmlsbFJlY3QoMCwgMCwgNjQsIDY0KTsgfSk7XG4gIGNvbnN0IHN0YXJUZXggPSBbMSwgMiwgM10ubWFwKChuKSA9PiBkeW4oc2NlbmUsIDE5MiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDQwcHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gNTsgYy5zdHJva2VTdHlsZSA9ICcjMWExMDIwJzsgYy5maWxsU3R5bGUgPSBuID09PSAzID8gJyNmZmQyNGEnIDogbiA9PT0gMiA/ICcjZDdlNmZmJyA6ICcjZjBkOWEwJzsgY29uc3QgcyA9ICdcdTI2MDUnLnJlcGVhdChuKTsgYy5zdHJva2VUZXh0KHMsIDk2LCAzOCk7IGMuZmlsbFRleHQocywgOTYsIDM4KTsgfSkpO1xuICBjb25zdCBlbWlzc2l2ZSA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyLCBhID0gMSkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZW0nLCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHIsIGcsIGIpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYWxwaGEgPSBhOyByZXR1cm4gbTsgfTtcbiAgY29uc3QgQTogQXNzZXRzID0ge1xuICAgIHNjZW5lLCBzb2Z0LCBzdGFyVGV4LCB0cmlwbzoge30sIGVtb3RlOiB7fSwgcmluZ01hdDogW2VtaXNzaXZlKDAuNTUsIDAuMiwgMC45NSwgMC45KSwgZW1pc3NpdmUoMC45NSwgMC4yNSwgMC4yLCAwLjkpXSwgaGFsb01hdDogZW1pc3NpdmUoMSwgMC44MiwgMC4zLCAwLjk1KSxcbiAgICBiYXJCZzogZW1pc3NpdmUoMC4wNSwgMC4wNSwgMC4wOCwgMC43KSwgYmFyRmlsbDogW2VtaXNzaXZlKDAuNTUsIDAuMzUsIDEpLCBlbWlzc2l2ZSgxLCAwLjQsIDAuMyldLCBtYW5hRmlsbDogZW1pc3NpdmUoMC4yNSwgMC43NSwgMSksXG4gIH07XG4gIC8vIFwiWnp6XCIgdGhhdCBmbG9hdHMgdXAgb3ZlciBhIHNsZWVweSB1bml0XG4gIGNvbnN0IHp6eiA9IGR5bihzY2VuZSwgMTI4LCAxMjgsIChjKSA9PiB7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gOTsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5maWxsU3R5bGUgPSAnI2U4ZDhmZic7IGMubGluZUpvaW4gPSAncm91bmQnO1xuICAgIGZvciAoY29uc3QgW2NoLCBzaXplLCB4LCB5XSBvZiBbWydaJywgNjQsIDM0LCAxMDBdLCBbJ3onLCA0OCwgNzQsIDY2XSwgWyd6JywgMzQsIDEwNCwgMzhdXSBhcyBbc3RyaW5nLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXVtdKSB7IGMuZm9udCA9ICdpdGFsaWMgOTAwICcgKyBzaXplICsgJ3B4IHNhbnMtc2VyaWYnOyBjLnN0cm9rZVRleHQoY2gsIHgsIHkpOyBjLmZpbGxUZXh0KGNoLCB4LCB5KTsgfSB9KTtcbiAgY29uc3Qgem0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd6enonLCBzY2VuZSk7IHptLmRpZmZ1c2VUZXh0dXJlID0genp6OyB6bS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHptLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyB6bS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB6bS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgQS5lbW90ZVsnenp6J10gPSB6bTtcbiAgY29uc3QgaWNvbiA9IChuYW1lOiBzdHJpbmcsIGRyYXc6IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHZvaWQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwobmFtZSwgc2NlbmUpOyBtLmRpZmZ1c2VUZXh0dXJlID0gZHluKHNjZW5lLCAxMjgsIDEyOCwgZHJhdyk7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IEEuZW1vdGVbbmFtZV0gPSBtOyB9O1xuICBjb25zdCBnbHlwaCA9IChjaDogc3RyaW5nLCBmaWxsOiBzdHJpbmcpID0+IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSAxMjsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7IGMuZmlsbFN0eWxlID0gZmlsbDsgYy5mb250ID0gJzkwMCAxMDRweCBzYW5zLXNlcmlmJzsgYy5zdHJva2VUZXh0KGNoLCA2NCwgMTAwKTsgYy5maWxsVGV4dChjaCwgNjQsIDEwMCk7IH07XG4gIGljb24oJz8nLCBnbHlwaCgnPycsICcjZmZlMjdhJykpOyBpY29uKCchJywgZ2x5cGgoJyEnLCAnI2ZmOWE3YScpKTtcbiAgaWNvbignc3dlYXQnLCAoYykgPT4geyBjLmxpbmVXaWR0aCA9IDg7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MzA0YSc7IGMuZmlsbFN0eWxlID0gJyM5ZmU0ZmYnOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbyg2NCwgMTQpOyBjLmJlemllckN1cnZlVG8oMTA0LCA2MiwgMTA0LCAxMDgsIDY0LCAxMTIpOyBjLmJlemllckN1cnZlVG8oMjQsIDEwOCwgMjQsIDYyLCA2NCwgMTQpOyBjLmNsb3NlUGF0aCgpOyBjLnN0cm9rZSgpOyBjLmZpbGwoKTsgfSk7XG4gIGljb24oJ3NwYXJrbGUnLCAoYykgPT4geyBjLmxpbmVXaWR0aCA9IDc7IGMuc3Ryb2tlU3R5bGUgPSAnIzNhMmEwNSc7IGMuZmlsbFN0eWxlID0gJyNmZmYyYTgnOyBjb25zdCBzdGFyID0gKHg6IG51bWJlciwgeTogbnVtYmVyLCByOiBudW1iZXIpID0+IHsgYy5iZWdpblBhdGgoKTsgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspIHsgY29uc3QgYSA9IGkgKiBNYXRoLlBJIC8gNCwgcnIgPSBpICUgMiA/IHIgKiAwLjI4IDogcjsgYy5saW5lVG8oeCArIE1hdGguc2luKGEpICogcnIsIHkgLSBNYXRoLmNvcyhhKSAqIHJyKTsgfSBjLmNsb3NlUGF0aCgpOyBjLnN0cm9rZSgpOyBjLmZpbGwoKTsgfTsgc3Rhcig1NiwgNzAsIDUwKTsgc3RhcigxMDIsIDI4LCAyMCk7IHN0YXIoMjYsIDI0LCAxNCk7IH0pO1xuICBjb25zdCBkZWZzOiBbU291bElkLCBzdHJpbmcsIHN0cmluZywgUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPiwgbnVtYmVyLCBudW1iZXIsIGFueT9dW10gPSBbXG4gICAgWyd3YXJyaW9yJywgJ1NrZWxldG9uV2Fycmlvci5nbGInLCAnU2tlbGV0b25XYXJyaW9yX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdUcmlwJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdCb25rJywgZW1vdGU6ICc/JyB9LCB7IGNsaXA6ICdXb2JibGUnLCBlbW90ZTogJ3N3ZWF0JyB9LCB7IGNsaXA6ICdXYXZlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdGdW1ibGUnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1NoaWVsZEJvbmsnLCBlbW90ZTogJz8nIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1dhdmUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1RyaXAnLCBlbW90ZTogJyEnIH1dLCBleWVzOiAnU2tlbGV0b25XYXJyaW9yX2V5ZXMucG5nJyB9XSxcbiAgICBbJ2FyY2hlcicsICdTa2VsZXRvbkFyY2hlci5nbGInLCAnU2tlbGV0b25BcmNoZXJfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ1Nob290JywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0ZsZXgnIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdGbGV4JywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdEb3VibGVCaWNlcHMnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvbmVDcmFjaycgfSwgeyBjbGlwOiAnQm93VHdpcmwnLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnRmxleCcsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRG91YmxlQmljZXBzJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb3dUd2lybCcsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdTa2VsZXRvbkFyY2hlcl9leWVzLnBuZycgfV0sXG4gICAgWydnb2JsaW4nLCAnR29ibGluLmdsYicsICdHb2JsaW5fZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wLCAwLjg1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1NjaGVtZScsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnUGVlaycsIGVtb3RlOiAnPycgfSwgeyBjbGlwOiAnU3BpbicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU25pY2tlcicsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogNiwgbWF4OiAxMiB9LCBjaGVlcnM6IFt7IGNsaXA6ICdDaGVlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU25pY2tlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU3BpbicsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdHb2JsaW5fZXllcy5wbmcnIH1dLFxuICAgIFsna25pZ2h0JywgJ0tuaWdodC5nbGInLCAnS25pZ2h0X2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnUG9zZScgfSwgMS4wLCAxLjA1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1NhbHV0ZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnQm9hc3QnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0FkbWlyZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnUHJheScsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogOCwgbWF4OiAxNSB9LCBjaGVlcnM6IFt7IGNsaXA6ICdQb3NlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdTYWx1dGUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvYXN0JywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdQcmF5JywgZW1vdGU6ICdzcGFya2xlJyB9XSwgZXllczogJ0tuaWdodF9leWVzLnBuZycgfV0sXG4gICAgWydiYXJiYXJpYW4nLCAnQmFyYmFyaWFuLmdsYicsICdCYXJiYXJpYW5fZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wLCAxLjA1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1JvYXInLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0NoZXN0QmVhdCcgfSwgeyBjbGlwOiAnU3RvbXAnLCBlbW90ZTogJyEnIH1dLCBtaW46IDcsIG1heDogMTMgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1JvYXInLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0NoZXN0QmVhdCcgfV0sIGV5ZXM6ICdCYXJiYXJpYW5fZXllcy5wbmcnIH1dLFxuICAgIFsnb2dyZScsICdPZ3JlLmdsYicsICdPZ3JlX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMDIsIDEuMTIsIHsgc3RhclNjYWxlOiBbMSwgMS4zLCAxLjY1XSwgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnWWF3bicsIGVtb3RlOiAnenp6JyB9LCB7IGNsaXA6ICdTY3JhdGNoJyB9LCB7IGNsaXA6ICdTdG9tcCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnVGh1bXAnIH1dLCBtaW46IDksIG1heDogMTYgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInIH0sIHsgY2xpcDogJ1RodW1wJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdTdG9tcCcsIGVtb3RlOiAnIScgfV0sIHNwYXduRW1vdGU6ICd6enonLCBleWVzOiAnT2dyZV9leWVzLnBuZycgfV0sXG4gIF07XG4gIGNvbnN0IG5lY3JvUCA9IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCAnTmVjcm9tYW5jZXIuZ2xiJywgc2NlbmUpLnRoZW4oKGM6IGFueSkgPT4geyBBLm5lY3JvID0gYzsgfSkuY2F0Y2goKCkgPT4geyAvKiB0aGUgZ2FtZSBjYW5ub3Qgc2hvdyBoaW0gKi8gfSk7XG4gIGNvbnN0IGFycm93UCA9IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCAnQXJyb3cuZ2xiJywgc2NlbmUpLnRoZW4oKGM6IGFueSkgPT4geyBBLmFycm93ID0gYzsgfSkuY2F0Y2goKCkgPT4geyAvKiBmYWxscyBiYWNrIHRvIHRoZSBwbGFpbiBsaW5lICovIH0pO1xuICBhd2FpdCBQcm9taXNlLmFsbChbYXJyb3dQLCBuZWNyb1AsIC4uLmRlZnMubWFwKGFzeW5jIChbc291bCwgZ2xiLCBlbmVteSwgY2xpcHMsIHRvcCwgc2NhbGUsIGV4dHJhXSkgPT4ge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCBnbGIsIHNjZW5lKTtcbiAgICBBLnRyaXBvW3NvdWxdID0geyBjb250YWluZXIsIGVuZW15VGV4OiBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvJyArIGVuZW15LCBzY2VuZSwgZmFsc2UsIGZhbHNlKSwgY2xpcHMsIG1hdENhY2hlOiB7fSwgdG9wLCBzY2FsZSwgLi4uKGV4dHJhIHx8IHt9KSwgZXllVGV4OiBleHRyYSAmJiBleHRyYS5leWVzID8gbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBleHRyYS5leWVzLCBzY2VuZSwgZmFsc2UsIGZhbHNlKSA6IHVuZGVmaW5lZCB9O1xuICB9KV0pO1xuICByZXR1cm4gQTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzaGFyZWQgZGVjb3JhdGlvblxuY2xhc3MgRGVjbyB7XG4gIHByaXZhdGUgcHM6IGFueSA9IG51bGw7IHByaXZhdGUgaGFsbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBiYWRnZTogYW55OyBwcml2YXRlIHN0YXJzOiBhbnk7IHByaXZhdGUgZmlsbDogYW55OyBwcml2YXRlIGJhcjogYW55OyBwcml2YXRlIG1iZzogYW55OyBwcml2YXRlIG1maWxsOiBhbnk7IHByaXZhdGUgcmluZzogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBwYXJlbnQ6IGFueSwgcHJpdmF0ZSB0b3A6IG51bWJlciwgcHJpdmF0ZSByYWRpdXM6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lO1xuICAgIHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygncmluZycsIHsgcmFkaXVzOiBNYXRoLm1heCgwLjMsIHJhZGl1cyAqIDEuMTUpLCB0ZXNzZWxsYXRpb246IDI2IH0sIHMpOyB0aGlzLnJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0aGlzLnJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHRoaXMucmluZy5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMucmluZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYWRnZSA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2JhZGdlJywgcyk7IHRoaXMuYmFkZ2UucGFyZW50ID0gcGFyZW50OyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0b3AgKyAwLjMyOyB0aGlzLmJhZGdlLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgdGhpcy5zdGFycyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3N0YXJzJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMTUgfSwgcyk7IHRoaXMuc3RhcnMucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5zdGFycy5wb3NpdGlvbi55ID0gMC4xMTsgdGhpcy5zdGFycy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzbScsIHMpOyBzbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgc20uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgc20udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB0aGlzLnN0YXJzLm1hdGVyaWFsID0gc207ICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtID0gc207XG4gICAgY29uc3QgYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdiZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA4NSB9LCBzKTsgYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgYmcubWF0ZXJpYWwgPSBBLmJhckJnOyBiZy5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMuYmFyID0gYmc7XG4gICAgdGhpcy5maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuZmlsbC5wb3NpdGlvbi56ID0gLTAuMDAyOyB0aGlzLmZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWJnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMubWJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWJnLnBvc2l0aW9uLnkgPSAtMC4wNzsgdGhpcy5tYmcubWF0ZXJpYWwgPSBBLmJhckJnOyB0aGlzLm1iZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21maWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjAzIH0sIHMpOyB0aGlzLm1maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWZpbGwucG9zaXRpb24uc2V0KDAsIC0wLjA3LCAtMC4wMDIpOyB0aGlzLm1maWxsLm1hdGVyaWFsID0gQS5tYW5hRmlsbDsgdGhpcy5tZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYXIuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuZmlsbC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tYmcuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgLyoqIFRoZSBiYXJzIGtlZXAgdGhlIHNhbWUgc2l6ZSBhbmQgdGhlIHNhbWUgc21hbGwgZ2FwIGFib3ZlIHRoZSBoZWFkIGhvd2V2ZXIgYmlnIHRoZSB1bml0IGdyb3dzLiAqL1xuICBmaXQoazogbnVtYmVyKSB7IHRoaXMuYmFkZ2Uuc2NhbGluZy5zZXRBbGwoMSAvIGspOyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuMyAvIGs7IGlmICh0aGlzLmhhbG8pIHRoaXMuaGFsby5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjA4OyB9XG4gIHNldCh0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IHRoaXMuQS5zY2VuZSwgY2ZnID0gQVVSQVtzdGFyIC0gMV07XG4gICAgKHRoaXMuc3RhcnMgYXMgYW55KS5fc20uZGlmZnVzZVRleHR1cmUgPSB0aGlzLkEuc3RhclRleFtzdGFyIC0gMV07XG4gICAgdGhpcy5yaW5nLm1hdGVyaWFsID0gdGhpcy5BLnJpbmdNYXRbdGVhbV07IHRoaXMuZmlsbC5tYXRlcmlhbCA9IHRoaXMuQS5iYXJGaWxsW3RlYW1dO1xuICAgIGlmICh0ZWFtID09PSAwKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByYWlzZWQgYnkgdGhlIE5lY3JvbWFuY2VyOiBwdXJwbGUgYXVyYSB0aGF0IGdyb3dzIHdpdGggc3RhcnNcbiAgICAgIGlmICghdGhpcy5wcykge1xuICAgICAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdhdXJhJywgNzAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IHRoaXMucGFyZW50OyBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yLCAwLCAtMC4yKTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCB0aGlzLnRvcCAqIDAuNSwgMC4yKTtcbiAgICAgICAgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMS4xOyBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xNSwgMC44LCAtMC4xNSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMTUsIDEuNSwgMC4xNSk7XG4gICAgICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuMzU7IHBzLm1heEVtaXRQb3dlciA9IDAuODsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyB0aGlzLnBzID0gcHM7XG4gICAgICB9XG4gICAgICBjb25zdCBwID0gdGhpcy5wczsgcC5lbWl0UmF0ZSA9IGNmZy5yYXRlOyBwLm1pblNpemUgPSBjZmcubWluOyBwLm1heFNpemUgPSBjZmcubWF4OyBwLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi5jZmcuYzEpOyBwLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi5jZmcuYzIpOyBwLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgICBpZiAoIXAuaXNTdGFydGVkKCkpIHAuc3RhcnQoKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMucHMgJiYgdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdG9wKCk7XG4gICAgaWYgKHN0YXIgPj0gMykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGdvbGQgaGFsbyBhYm92ZSB0aGUgaGVhZFxuICAgICAgaWYgKCF0aGlzLmhhbG8pIHsgdGhpcy5oYWxvID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnaGFsbycsIHsgZGlhbWV0ZXI6IDAuNTUsIHRoaWNrbmVzczogMC4wNCwgdGVzc2VsbGF0aW9uOiAyNCB9LCBzKTsgdGhpcy5oYWxvLnBhcmVudCA9IHRoaXMucGFyZW50OyB0aGlzLmhhbG8ucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4wODsgdGhpcy5oYWxvLm1hdGVyaWFsID0gdGhpcy5BLmhhbG9NYXQ7IHRoaXMuaGFsby5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAgIHRoaXMuaGFsby5zZXRFbmFibGVkKHRydWUpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5oYWxvKSB0aGlzLmhhbG8uc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5iYXIuc2V0RW5hYmxlZChvbik7IHRoaXMuZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMuZmlsbC5zY2FsaW5nLnggPSBrOyB0aGlzLmZpbGwucG9zaXRpb24ueCA9IC0oMC41NiAqICgxIC0gaykpIC8gMjsgfVxuICB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5tYmcuc2V0RW5hYmxlZChvbik7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChvbik7XG4gICAgaWYgKG9uKSB7IGNvbnN0IGsgPSBNYXRoLm1heCgwLjAwMSwgZiBhcyBudW1iZXIpOyB0aGlzLm1maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMubWZpbGwucG9zaXRpb24ueCA9IC0oMC41NiAqICgxIC0gaykpIC8gMjsgfVxuICB9XG4gIHNldEF1cmEob246IGJvb2xlYW4pIHsgaWYgKHRoaXMucHMpIHsgaWYgKG9uICYmICF0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0YXJ0KCk7IGlmICghb24gJiYgdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdG9wKCk7IH0gfVxuICB1cGRhdGUoZHQ6IG51bWJlcikgeyBpZiAodGhpcy5oYWxvICYmIHRoaXMuaGFsby5pc0VuYWJsZWQoKSkgdGhpcy5oYWxvLnJvdGF0aW9uLnkgKz0gZHQgKiAxLjY7IH1cbiAgZGlzcG9zZSgpIHsgaWYgKHRoaXMucHMpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB9IFt0aGlzLmhhbG8sIHRoaXMucmluZywgdGhpcy5zdGFycywgdGhpcy5iYXIsIHRoaXMuZmlsbCwgdGhpcy5tYmcsIHRoaXMubWZpbGxdLmZvckVhY2goKG0pID0+IG0gJiYgbS5kaXNwb3NlKCkpOyB0aGlzLmJhZGdlLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHJlYWwgbW9kZWxzXG5jbGFzcyBUcmlwb1Zpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSBlbnQ6IGFueTsgcHJpdmF0ZSBib2R5OiBhbnk7IHByaXZhdGUgYW5pbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTsgcHJpdmF0ZSBjdXI6IGFueSA9IG51bGw7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBiYXNlOiBudW1iZXI7XG4gIHByaXZhdGUgbGFzdEZsYXZvciA9ICcnOyBwcml2YXRlIHVpZCA9ICcnOyBwcml2YXRlIG93bjogYW55ID0gbnVsbDsgcHJpdmF0ZSBpZGxlVCA9IDA7IHByaXZhdGUgbmV4dEZsYXZvciA9IDFlOTsgcHJpdmF0ZSBmbGF2b3JPbiA9IGZhbHNlOyBwcml2YXRlIHF1ZXVlZCA9IGZhbHNlOyBwcml2YXRlIHNwYXduVCA9IDA7IHByaXZhdGUgZXllSyA9IDAuNjU7IHByaXZhdGUgZW1vdGVzOiB7IG06IGFueTsgdDogbnVtYmVyOyB5MDogbnVtYmVyIH1bXSA9IFtdO1xuICBwcml2YXRlIHNvdWxJZDogU291bElkO1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBjZmc6IFRyaXBvQ2ZnLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICB0aGlzLnNvdWxJZCA9IHNvdWw7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIHVpZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDcpOyB0aGlzLnVpZCA9IHVpZDtcbiAgICB0aGlzLmVudCA9IGNmZy5jb250YWluZXIuaW5zdGFudGlhdGVNb2RlbHNUb1NjZW5lKChuOiBzdHJpbmcpID0+IG4gKyAnXycgKyB1aWQsIGZhbHNlLCB7IGRvTm90SW5zdGFudGlhdGU6IHRydWUgfSk7XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd1bml0XycgKyB1aWQsIHMpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgdGhpcy5ib2R5ID0gdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZmluZCgobTogYW55KSA9PiBtLm5hbWUuaW5jbHVkZXMoJ19Cb2R5JykpO1xuICAgIGlmICghY2ZnLmJhc2VNYXQpIGNmZy5iYXNlTWF0ID0gdGhpcy5ib2R5Lm1hdGVyaWFsO1xuICAgIHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IHsgZy5zdG9wKCk7IGcuZW5hYmxlQmxlbmRpbmcgPSB0cnVlOyBnLmJsZW5kaW5nU3BlZWQgPSAwLjEyOyB0aGlzLmFuaW1zW2cubmFtZS5zcGxpdCgnXycpWzBdXSA9IGc7IH0pO1xuICAgIHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB9KTtcbiAgICB0aGlzLnRvcCA9IGNmZy50b3A7IHRoaXMuYmFzZSA9IGNmZy5zY2FsZTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICBpZiAoY2ZnLmZsYXZvcikgdGhpcy5uZXh0Rmxhdm9yID0gY2ZnLmZsYXZvci5taW4gKyBNYXRoLnJhbmRvbSgpICogKGNmZy5mbGF2b3IubWF4IC0gY2ZnLmZsYXZvci5taW4pO1xuICAgIHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgMC4zKTtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IDEuMywgZGlhbWV0ZXI6IDAuOCB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IDAuNjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLmlzUGlja2FibGUgPSB0cnVlO1xuICAgIHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gIH1cbiAgcHJpdmF0ZSBhcHBseU1hdCgpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLnRlYW0gKyAnXycgKyB0aGlzLnN0YXIsIGMgPSB0aGlzLmNmZztcbiAgICBpZiAoYy5leWVUZXgpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgdW5pdCBoYXMgZ2xvd2luZyBleWVzOiBpdCBnZXRzIGl0cyBvd24gbWF0ZXJpYWwgc28gaXRzIGdsb3cgY2FuIGNoYW5nZSBvbiBpdHMgb3duXG4gICAgICBpZiAoIXRoaXMub3duKSB7IHRoaXMub3duID0gYy5iYXNlTWF0LmNsb25lKCdvd25fJyArIHRoaXMudWlkKTsgdGhpcy5vd24uZW1pc3NpdmVUZXh0dXJlID0gYy5leWVUZXg7IHRoaXMub3duLmVtaXNzaXZlSW50ZW5zaXR5ID0gdGhpcy5leWVLOyB9XG4gICAgICB0aGlzLm93bi5hbGJlZG9UZXh0dXJlID0gdGhpcy50ZWFtID09PSAxID8gYy5lbmVteVRleCA6IGMuYmFzZU1hdC5hbGJlZG9UZXh0dXJlOyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgdGhpcy5vd24uYWxiZWRvQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjModFswXSwgdFsxXSwgdFsyXSk7XG4gICAgICB0aGlzLm93bi5lbWlzc2l2ZUNvbG9yID0gdGhpcy50ZWFtID09PSAxID8gbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNzIsIDAuMikgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC43OCwgMC4zLCAxKTtcbiAgICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IHRoaXMub3duOyByZXR1cm47XG4gICAgfVxuICAgIGlmICghYy5tYXRDYWNoZVtrZXldKSB7IGNvbnN0IG0gPSBjLmJhc2VNYXQuY2xvbmUoJ21fJyArIGtleSk7IGlmICh0aGlzLnRlYW0gPT09IDEpIG0uYWxiZWRvVGV4dHVyZSA9IGMuZW5lbXlUZXg7IGNvbnN0IHQgPSBUSU5UW3RoaXMuc3RhciAtIDFdOyBtLmFsYmVkb0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHRbMF0sIHRbMV0sIHRbMl0pOyBjLm1hdENhY2hlW2tleV0gPSBtOyB9XG4gICAgdGhpcy5ib2R5Lm1hdGVyaWFsID0gYy5tYXRDYWNoZVtrZXldO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuc2Moc3QpICogdGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgdGhpcy5kZWNvLmZpdCh0aGlzLnNjKHN0KSAqIHRoaXMuYmFzZSk7IH1cbiAgcHJpdmF0ZSBzYyhzdDogbnVtYmVyKSB7IHJldHVybiAodGhpcy5jZmcuc3RhclNjYWxlIHx8IEJBTEFOQ0Uuc3Rhci5zY2FsZSlbc3QgLSAxXTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkge1xuICAgIGxldCBjbGlwID0gdGhpcy5jZmcuY2xpcHNbc3RhdGVdLCBwb3NlOiBQb3NlIHwgdW5kZWZpbmVkO1xuICAgIGlmIChzdGF0ZSA9PT0gJ2NoZWVyJyAmJiB0aGlzLmNmZy5jaGVlcnMpIHsgcG9zZSA9IHRoaXMuY2ZnLmNoZWVyc1tNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0aGlzLmNmZy5jaGVlcnMubGVuZ3RoKV07IGNsaXAgPSBwb3NlLmNsaXA7IH1cbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tjbGlwXTsgaWYgKCFnKSByZXR1cm47IGNvbnN0IGxvb3AgPSBzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJztcbiAgICBpZiAoc3RhdGUgPT09ICdpZGxlJyAmJiB0aGlzLnN0YXRlID09PSAnc3Bhd24nICYmIHRoaXMuY3VyICYmIHRoaXMuY3VyLmlzU3RhcnRlZCAmJiB0aGlzLmNmZy5mbGF2b3IpIHsgdGhpcy5xdWV1ZWQgPSB0cnVlOyByZXR1cm47IH0gICAvLyBsZXQgdGhlIHdha2UtdXAgcGxheSB0byB0aGUgZW5kXG4gICAgaWYgKGxvb3AgJiYgdGhpcy5zdGF0ZSA9PT0gc3RhdGUgJiYgdGhpcy5jdXIgPT09IGcpIHJldHVybjtcbiAgICB0aGlzLnF1ZXVlZCA9IGZhbHNlOyB0aGlzLmZsYXZvck9uID0gZmFsc2U7IHRoaXMuaWRsZVQgPSAwO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChsb29wLCBzcGVlZCwgZy5mcm9tLCBnLnRvKTtcbiAgICBpZiAobG9vcCkgZy5nb1RvRnJhbWUoZy5mcm9tICsgTWF0aC5yYW5kb20oKSAqIChnLnRvIC0gZy5mcm9tKSk7XG4gICAgdGhpcy5jdXIgPSBnOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTtcbiAgICBpZiAocG9zZSAmJiBwb3NlLmVtb3RlKSB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuMzUpO1xuICAgIGlmIChzdGF0ZSA9PT0gJ3NwYXduJykgeyB0aGlzLnNwYXduVCA9IDA7IGlmICh0aGlzLmNmZy5zcGF3bkVtb3RlKSB7IHRoaXMuZW1vdGUodGhpcy5jZmcuc3Bhd25FbW90ZSwgMC4xKTsgdGhpcy5lbW90ZSh0aGlzLmNmZy5zcGF3bkVtb3RlLCAwLjcpOyB9IH1cbiAgfVxuICAvKiogQSBsaXR0bGUgcGljdHVyZSB0aGF0IGZsb2F0cyB1cCBvdmVyIHRoZSBoZWFkIGFuZCBmYWRlcyAoYSBzbGVlcHkgXCJaenpcIikuICovXG4gIHByaXZhdGUgZW1vdGUoa2luZDogc3RyaW5nLCBkZWxheSA9IDApIHtcbiAgICBjb25zdCBtYXQgPSB0aGlzLkEuZW1vdGVba2luZF07IGlmICghbWF0KSByZXR1cm47XG4gICAgY29uc3QgcGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdlbW8nLCB7IHNpemU6IDAuNDIgfSwgdGhpcy5BLnNjZW5lKTsgcGwucGFyZW50ID0gdGhpcy5ob2xkZXI7IHBsLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7IHBsLm1hdGVyaWFsID0gbWF0OyBwbC5pc1BpY2thYmxlID0gZmFsc2U7IHBsLnZpc2liaWxpdHkgPSAwO1xuICAgIGNvbnN0IHkwID0gdGhpcy50b3AgKyAwLjAyOyBwbC5wb3NpdGlvbi5zZXQoMC4xNiwgeTAsIDApOyB0aGlzLmVtb3Rlcy5wdXNoKHsgbTogcGwsIHQ6IC1kZWxheSwgeTAgfSk7XG4gIH1cbiAgLyoqIEFmdGVyIHN0YW5kaW5nIGlkbGUgZm9yIGEgd2hpbGU6IHBsYXkgdGhlIHVuaXQncyBmbGF2b3VyIGNsaXAgb25jZSAodGhlIE9ncmUgeWF3bnMpLCB0aGVuIGdvIGJhY2sgdG8gaWRsaW5nLiAqL1xuICBwcml2YXRlIHN0YXJ0Rmxhdm9yKCkge1xuICAgIGNvbnN0IGYgPSB0aGlzLmNmZy5mbGF2b3IhOyB0aGlzLmlkbGVUID0gMDtcbiAgICBsZXQgcG9vbCA9IGYuY2xpcHMuZmlsdGVyKChjKSA9PiBjLmNsaXAgIT09IHRoaXMubGFzdEZsYXZvciAmJiB0aGlzLmFuaW1zW2MuY2xpcF0pOyBpZiAoIXBvb2wubGVuZ3RoKSBwb29sID0gZi5jbGlwcy5maWx0ZXIoKGMpID0+IHRoaXMuYW5pbXNbYy5jbGlwXSk7IGlmICghcG9vbC5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCBwb3NlID0gcG9vbFtNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBwb29sLmxlbmd0aCldLCBnID0gdGhpcy5hbmltc1twb3NlLmNsaXBdOyB0aGlzLmxhc3RGbGF2b3IgPSBwb3NlLmNsaXA7XG4gICAgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGZhbHNlLCAxLCBnLmZyb20sIGcudG8pOyB0aGlzLmN1ciA9IGc7IHRoaXMuZmxhdm9yT24gPSB0cnVlOyB0aGlzLm5leHRGbGF2b3IgPSBmLm1pbiArIE1hdGgucmFuZG9tKCkgKiAoZi5tYXggLSBmLm1pbik7XG4gICAgaWYgKFZPQ0FMLmhhcyhwb3NlLmNsaXApKSBhdWRpby5iYXJrKHRoaXMuc291bElkLCAwLjI1KTtcbiAgICBpZiAocG9zZS5lbW90ZSkgeyB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuNCk7IGlmIChwb3NlLmVtb3RlID09PSAnenp6JykgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAxLjIpOyB9XG4gIH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLmRlY28udXBkYXRlKGR0KTtcbiAgICBpZiAodGhpcy5jdXIgJiYgIXRoaXMuY3VyLmlzU3RhcnRlZCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhIG9uZS1zaG90IGNsaXAgZmluaXNoZWRcbiAgICAgIGlmICh0aGlzLnF1ZXVlZCkgeyB0aGlzLnF1ZXVlZCA9IGZhbHNlOyB0aGlzLnBsYXkoJ2lkbGUnKTsgfSBlbHNlIGlmICh0aGlzLmZsYXZvck9uKSB7IHRoaXMuZmxhdm9yT24gPSBmYWxzZTsgdGhpcy5wbGF5KCdpZGxlJyk7IH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgdGhpcy5wbGF5KCdpZGxlJyk7XG4gICAgfVxuICAgIGlmICh0aGlzLmNmZy5mbGF2b3IgJiYgdGhpcy5zdGF0ZSA9PT0gJ2lkbGUnICYmICF0aGlzLmZsYXZvck9uICYmIHRoaXMuaG9sZGVyLmlzRW5hYmxlZCgpKSB7IHRoaXMuaWRsZVQgKz0gZHQ7IGlmICh0aGlzLmlkbGVUID49IHRoaXMubmV4dEZsYXZvcikgdGhpcy5zdGFydEZsYXZvcigpOyB9XG4gICAgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHRoaXMuc3Bhd25UICs9IGR0O1xuICAgIGZvciAobGV0IGkgPSB0aGlzLmVtb3Rlcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgZSA9IHRoaXMuZW1vdGVzW2ldOyBlLnQgKz0gZHQ7IGlmIChlLnQgPCAwKSBjb250aW51ZTsgY29uc3QgayA9IGUudCAvIDEuOTtcbiAgICAgIGlmIChrID49IDEpIHsgZS5tLmRpc3Bvc2UoKTsgdGhpcy5lbW90ZXMuc3BsaWNlKGksIDEpOyBjb250aW51ZTsgfVxuICAgICAgZS5tLnZpc2liaWxpdHkgPSBNYXRoLm1pbigxLCBlLnQgLyAwLjIpICogKDEgLSBrICogayk7IGUubS5wb3NpdGlvbi5zZXQoMC4xNiArIDAuMDUgKiBNYXRoLnNpbihlLnQgKiAzKSwgZS55MCArIGUudCAqIDAuMiwgMCk7IGUubS5zY2FsaW5nLnNldEFsbCgwLjcgKyAwLjUgKiBrKTtcbiAgICB9XG4gICAgaWYgKHRoaXMub3duKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGV5ZSBnbG93IGZvbGxvd3MgdGhlIG1vb2Q6IGRpbSB3aGVuIHNsZWVweSwgYnJpZ2h0IHdoZW4gYXdha2UsIGZsYXJpbmcgaW4gYSBmaWdodFxuICAgICAgbGV0IHRhcmdldCA9IDAuNjU7XG4gICAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgdGFyZ2V0ID0gMC4wOCArIDAuOTIgKiBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCAodGhpcy5zcGF3blQgLyAxLjY3IC0gMC40NSkgLyAwLjMpKTtcbiAgICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdpZGxlJykgdGFyZ2V0ID0gdGhpcy5mbGF2b3JPbiA/IDAuMjUgOiAwLjY1O1xuICAgICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHRhcmdldCA9IDEuMDsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2F0dGFjaycpIHRhcmdldCA9IDEuNzsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgdGFyZ2V0ID0gMS40OyBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB0YXJnZXQgPSAwLjA1O1xuICAgICAgdGhpcy5leWVLICs9ICh0YXJnZXQgLSB0aGlzLmV5ZUspICogTWF0aC5taW4oMSwgZHQgKiA3KTsgdGhpcy5vd24uZW1pc3NpdmVJbnRlbnNpdHkgPSB0aGlzLmV5ZUs7XG4gICAgfVxuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5zYyh0aGlzLnN0YXIpICogdGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmVtb3Rlcy5mb3JFYWNoKChlKSA9PiBlLm0uZGlzcG9zZSgpKTsgaWYgKHRoaXMub3duKSB0aGlzLm93bi5kaXNwb3NlKCk7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IGcuZGlzcG9zZSgpKTsgdGhpcy5lbnQuc2tlbGV0b25zLmZvckVhY2goKHM6IGFueSkgPT4gcy5kaXNwb3NlKCkpOyB0aGlzLnBpY2suZGlzcG9zZSgpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0uZGlzcG9zZShmYWxzZSwgZmFsc2UpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFuZC1pbnNcbmNvbnN0IFBIOiBSZWNvcmQ8c3RyaW5nLCB7IGNvbDogc3RyaW5nOyB3OiBudW1iZXI7IGg6IG51bWJlcjsgaGVhZDogbnVtYmVyOyB3ZWFwb246IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9PiA9IHtcbiAgZ29ibGluOiB7IGNvbDogJyM2M2IxM2YnLCB3OiAwLjM2LCBoOiAwLjQyLCBoZWFkOiAwLjM2LCB3ZWFwb246ICdkYWdnZXInLCBsYWJlbDogJ0dPQkxJTicgfSxcbiAga25pZ2h0OiB7IGNvbDogJyM4ZWE5ZGMnLCB3OiAwLjUsIGg6IDAuNiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnc2hpZWxkJywgbGFiZWw6ICdLTklHSFQnIH0sXG4gIG9ncmU6IHsgY29sOiAnI2E4YTY0YScsIHc6IDAuODUsIGg6IDAuODUsIGhlYWQ6IDAuNDIsIHdlYXBvbjogJ21hY2UnLCBsYWJlbDogJ09HUkUnIH0sXG4gIGJhcmJhcmlhbjogeyBjb2w6ICcjZDY4YTU1JywgdzogMC41MiwgaDogMC42MiwgaGVhZDogMC4zOCwgd2VhcG9uOiAnYXhlJywgbGFiZWw6ICdCQVJCQVJJQU4nIH0sXG59O1xuY2xhc3MgUGxhY2Vob2xkZXJWaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgcmlnOiBhbnk7IHByaXZhdGUgbGVnczogYW55W10gPSBbXTsgcHJpdmF0ZSB3cDogYW55OyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHQgPSBNYXRoLnJhbmRvbSgpICogNjsgcHJpdmF0ZSBzdDAgPSAwOyBwcml2YXRlIGR1ciA9IDE7IHByaXZhdGUgYmFzZSA9IDE7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBtYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGJvZHk6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgc291bDogc3RyaW5nLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIGQgPSBQSFtzb3VsXTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3BoXycgKyBzb3VsLCBzKTsgdGhpcy5yaWcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdyaWcnLCBzKTsgdGhpcy5yaWcucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgY29uc3QgbWF0ID0gKGhleDogc3RyaW5nLCBlbSA9IDApID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3BtJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhoZXgpLnNjYWxlKDAuNzIpOyBtLnNwZWN1bGFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xLCAwLjEsIDAuMSk7IGlmIChlbSkgbS5lbWlzc2l2ZUNvbG9yID0gbS5kaWZmdXNlQ29sb3Iuc2NhbGUoZW0pOyByZXR1cm4gbTsgfTtcbiAgICBjb25zdCBsZWdIID0gMC4yMiwgYm9keVkgPSBsZWdIICsgZC5oIC8gMjtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgbGcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdsZWcnLCBzKTsgbGcucGFyZW50ID0gdGhpcy5yaWc7IGxnLnBvc2l0aW9uLnNldChzeCAqIGQudyAqIDAuMjIsIGxlZ0gsIDApOyBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignbCcsIHsgaGVpZ2h0OiBsZWdILCBkaWFtZXRlcjogZC53ICogMC4yOCB9LCBzKTsgbS5wYXJlbnQgPSBsZzsgbS5wb3NpdGlvbi55ID0gLWxlZ0ggLyAyOyBtLm1hdGVyaWFsID0gbWF0KCcjNGEzODI2Jyk7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmxlZ3MucHVzaChsZyk7IH1cbiAgICB0aGlzLmJvZHkgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUNhcHN1bGUoJ2JvZHknLCB7IHJhZGl1czogZC53IC8gMiwgaGVpZ2h0OiBkLmggKyBkLncgKiAwLjQgfSwgcyk7IHRoaXMuYm9keS5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy5ib2R5LnBvc2l0aW9uLnkgPSBib2R5WTsgdGhpcy5ib2R5Lm1hdGVyaWFsID0gbWF0KGQuY29sKTsgdGhpcy5ib2R5LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBoZWFkID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2hlYWQnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAxLjUsIHNlZ21lbnRzOiAxMiB9LCBzKTsgaGVhZC5wYXJlbnQgPSB0aGlzLnJpZzsgaGVhZC5wb3NpdGlvbi55ID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDAuNTU7IGhlYWQubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyBoZWFkLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBleWVNID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZXllJywgcyk7IGV5ZU0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZXllTS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgKHRoaXMgYXMgYW55KS5leWVNID0gZXllTTtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgZSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdlJywgeyBkaWFtZXRlcjogZC5oZWFkICogMC4zIH0sIHMpOyBlLnBhcmVudCA9IHRoaXMucmlnOyBlLnBvc2l0aW9uLnNldChzeCAqIGQuaGVhZCAqIDAuMywgaGVhZC5wb3NpdGlvbi55ICsgMC4wMiwgZC5oZWFkICogMC42Nik7IGUubWF0ZXJpYWwgPSBleWVNOyBlLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIC8vIHdlYXBvbiBwaXZvdCBhdCB0aGUgc2hvdWxkZXIsIG9uIHRoZSBjaGFyYWN0ZXIncyByaWdodCAoLXggaXMgZmluZSBmb3IgYSBzdGFuZC1pbilcbiAgICB0aGlzLndwID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnd3AnLCBzKTsgdGhpcy53cC5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy53cC5wb3NpdGlvbi5zZXQoZC53ICogMC42LCBsZWdIICsgZC5oICogMC44NSwgMC4wNSk7XG4gICAgY29uc3Qgd20gPSBtYXQoJyM3YTVhMzAnKSwgaXJvbiA9IG1hdCgnIzlhYTFhZCcpO1xuICAgIGNvbnN0IG1rID0gKG06IGFueSwga2luZDogc3RyaW5nLCBkaW1zOiBhbnksIHBvczogbnVtYmVyW10sIG10OiBhbnkpID0+IHsgY29uc3QgeCA9IGtpbmQgPT09ICdib3gnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVCb3goJ3cnLCBkaW1zLCBzKSA6IGtpbmQgPT09ICdjeWwnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigndycsIGRpbXMsIHMpIDogQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ3cnLCBkaW1zLCBzKTsgeC5wYXJlbnQgPSB0aGlzLndwOyB4LnBvc2l0aW9uLnNldChwb3NbMF0sIHBvc1sxXSwgcG9zWzJdKTsgeC5tYXRlcmlhbCA9IG10OyB4LmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIHg7IH07XG4gICAgaWYgKGQud2VhcG9uID09PSAnZGFnZ2VyJykgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDUsIGhlaWdodDogMC4zLCBkZXB0aDogMC4wMyB9LCBbMCwgLTAuMiwgMC4xMl0sIGlyb24pO1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ3NoaWVsZCcpIHsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDYsIGhlaWdodDogMC41LCBkZXB0aDogMC4wNCB9LCBbMCwgLTAuMywgMC4xNF0sIGlyb24pOyBjb25zdCBzaCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3NoJywgeyBoZWlnaHQ6IDAuMDUsIGRpYW1ldGVyOiAwLjU1IH0sIHMpOyBzaC5wYXJlbnQgPSB0aGlzLnJpZzsgc2gucm90YXRpb24ueiA9IE1hdGguUEkgLyAyOyBzaC5wb3NpdGlvbi5zZXQoLWQudyAqIDAuNywgbGVnSCArIGQuaCAqIDAuNiwgMC4wNSk7IHNoLm1hdGVyaWFsID0gbWF0KCcjZDhiNjRhJyk7IHNoLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ21hY2UnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC45LCBkaWFtZXRlcjogMC4wOCB9LCBbMCwgLTAuMzUsIDAuM10sIHdtKTsgbWsoMCwgJ3NwaCcsIHsgZGlhbWV0ZXI6IDAuNCB9LCBbMCwgLTAuODUsIDAuNF0sIGlyb24pOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnYXhlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuNiwgZGlhbWV0ZXI6IDAuMDUgfSwgWzAsIC0wLjIsIDAuMTVdLCB3bSk7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjMyLCBoZWlnaHQ6IDAuMjIsIGRlcHRoOiAwLjA1IH0sIFswLCAtMC41LCAwLjE1XSwgaXJvbik7IGNvbnN0IGhhaXIgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdoYWlyJywgeyBoZWlnaHQ6IDAuMywgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiBkLmhlYWQgKiAxLjIgfSwgcyk7IGhhaXIucGFyZW50ID0gdGhpcy5yaWc7IGhhaXIucG9zaXRpb24ueSA9IGhlYWQucG9zaXRpb24ueSArIGQuaGVhZCAqIDAuNzU7IGhhaXIubWF0ZXJpYWwgPSBtYXQoJyNjMjJhMWMnKTsgaGFpci5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICB0aGlzLnRvcCA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAxLjM1OyB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIGQudyAqIDAuNyk7XG4gICAgY29uc3QgbGJsID0gZHluKHMsIDI1NiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDI2cHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMuZmlsbFN0eWxlID0gJyNmZmZmZmYnOyBjLnN0cm9rZVN0eWxlID0gJyMxMTEnOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IGMuZmlsbFRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyB9KTtcbiAgICBjb25zdCBscCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2xibCcsIHsgd2lkdGg6IDEuMSwgaGVpZ2h0OiAwLjIgfSwgcyk7IGxwLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBscC5wb3NpdGlvbi55ID0gLTAuMTsgbHAucm90YXRpb24ueCA9IE1hdGguUEkgLyAyICogMC4wOyBscC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBjb25zdCBsbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2xtJywgcyk7IGxtLmRpZmZ1c2VUZXh0dXJlID0gbGJsOyBsbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBscC5tYXRlcmlhbCA9IGxtOyBscC5pc1BpY2thYmxlID0gZmFsc2U7IGxwLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuNjI7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiB0aGlzLnRvcCwgZGlhbWV0ZXI6IE1hdGgubWF4KDAuNywgZC53ICogMS4zKSB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IHRoaXMudG9wIC8gMjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICAgICh0aGlzIGFzIGFueSkucGFydHMgPSBbbHBdOyB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5wbGF5KCdpZGxlJyk7XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyAodGhpcyBhcyBhbnkpLmV5ZU0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYmFzZSA9IEJBTEFOQ0Uuc3Rhci5zY2FsZVtzdCAtIDFdOyBjb25zdCB0ID0gVElOVFtzdCAtIDFdOyB0aGlzLmJvZHkubWF0ZXJpYWwuZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhQSFt0aGlzLnNvdWxdLmNvbCkuc2NhbGUoMC43MikubXVsdGlwbHkobmV3IEJBQllMT04uQ29sb3IzKE1hdGgubWluKDEsIHRbMF0pLCBNYXRoLm1pbigxLCB0WzFdKSwgTWF0aC5taW4oMSwgdFsyXSkpKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgdGhpcy5kZWNvLmZpdCh0aGlzLmJhc2UpOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0TWFuYShmKTsgfVxuICBwdWxzZSgpIHsgdGhpcy5wdWxzZVQgPSAwLjE2OyB9XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQgPSAxKSB7IGlmIChzdGF0ZSA9PT0gdGhpcy5zdGF0ZSAmJiAoc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bicpKSByZXR1cm47IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5zdDAgPSB0aGlzLnQ7IHRoaXMuZHVyID0gc3RhdGUgPT09ICdhdHRhY2snID8gKEJBTEFOQ0Uuc3RhdHNbdGhpcy5zb3VsIGFzIFNvdWxJZF0uYW5pbUxlbiAvIHNwZWVkKSA6IHN0YXRlID09PSAnZGVhdGgnID8gMC42IDogc3RhdGUgPT09ICdzcGF3bicgPyAwLjkgOiAxLjA7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTsgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMudCArPSBkdDsgdGhpcy5kZWNvLnVwZGF0ZShkdCk7IGNvbnN0IHAgPSBNYXRoLm1pbigxLCAodGhpcy50IC0gdGhpcy5zdDApIC8gdGhpcy5kdXIpLCBSID0gdGhpcy5yaWcsIFcgPSB0aGlzLndwO1xuICAgIFIucG9zaXRpb24uc2V0KDAsIDAsIDApOyBSLnJvdGF0aW9uLnNldCgwLCAwLCAwKTsgUi5zY2FsaW5nLnNldEFsbCgxKTsgVy5yb3RhdGlvbi54ID0gLTAuNDsgdGhpcy5sZWdzLmZvckVhY2goKGwpID0+IChsLnJvdGF0aW9uLnggPSAwKSk7XG4gICAgaWYgKHRoaXMuc3RhdGUgPT09ICdpZGxlJykgUi5wb3NpdGlvbi55ID0gTWF0aC5zaW4odGhpcy50ICogMi4yKSAqIDAuMDEyO1xuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdydW4nKSB7IGNvbnN0IHcgPSB0aGlzLnQgKiAxMDsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odykpICogMC4wNzsgUi5yb3RhdGlvbi54ID0gMC4yOyB0aGlzLmxlZ3NbMF0ucm90YXRpb24ueCA9IE1hdGguc2luKHcpICogMC45OyB0aGlzLmxlZ3NbMV0ucm90YXRpb24ueCA9IC1NYXRoLnNpbih3KSAqIDAuOTsgVy5yb3RhdGlvbi54ID0gLTAuNCArIE1hdGguc2luKHcpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2F0dGFjaycpIHsgY29uc3QgayA9IHAgPCAwLjQgPyAtMi40ICogKHAgLyAwLjQpIDogLTIuNCArIDMuNCAqIE1hdGgubWluKDEsIChwIC0gMC40KSAvIDAuMjUpOyBXLnJvdGF0aW9uLnggPSBrOyBSLnBvc2l0aW9uLnogPSAwLjE0ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyBSLnJvdGF0aW9uLnggPSAwLjE1ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgeyBjb25zdCBlID0gcCAqIHAgKiAoMyAtIDIgKiBwKTsgUi5zY2FsaW5nLnNldEFsbCgwLjAxICsgMC45OSAqIGUpOyBSLnBvc2l0aW9uLnkgPSAoZSAtIDEpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2RlYXRoJykgeyBjb25zdCBlID0gcCAqIHA7IFIucm90YXRpb24ueCA9IC1NYXRoLlBJIC8gMiAqIGU7IFIucG9zaXRpb24ueSA9IDAuMjUgKiBlOyBSLnBvc2l0aW9uLnogPSAtMC4yICogZTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odGhpcy50ICogNykpICogMC4xNTsgVy5yb3RhdGlvbi54ID0gLTIuNjsgfVxuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVZpc3VhbChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcik6IFVuaXRWaXN1YWwge1xuICBjb25zdCBjZmcgPSBBLnRyaXBvW3NvdWxdO1xuICByZXR1cm4gY2ZnID8gbmV3IFRyaXBvVmlzdWFsKEEsIGNmZywgc291bCwgdGVhbSwgc3RhcikgOiBuZXcgUGxhY2Vob2xkZXJWaXN1YWwoQSwgc291bCwgdGVhbSwgc3Rhcik7XG59XG5leHBvcnQgY29uc3QgaXNUcmlwbyA9IChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCkgPT4gISFBLnRyaXBvW3NvdWxdO1xuIiwgIi8vIFRoZSBnYW1lJ3MgaWNvbiBzZXQgKGN1c3RvbSBhcnQsIHNsaWNlZCBmcm9tIFBpcGVsaW5lL2ljb25zL3NoZWV0XyoucG5nIGJ5IFBpcGVsaW5lL2JsZW5kZXIvc2xpY2VfaWNvbnMucHkgLT4gZG9jcy9hc3NldHMvaWNvbnMvKi5wbmcpLlxuLy8gU2hhcmVkIGJ5IHRoZSAzRCBnYW1lJ3MgRE9NICh2YW5pbGxhKSBhbmQgdGhlIEFuZ3VsYXIgc2hlbGwuIE5vIGVtb2ppIGFueXdoZXJlOiBldmVyeSBnbHlwaCBpbiB0aGUgVUkgaXMgb25lIG9mIHRoZXNlIGltYWdlcy5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUmFyaXR5IH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5cbmV4cG9ydCB0eXBlIEljb25OYW1lID1cbiAgfCAnaG9tZScgfCAnc291bHMnIHwgJ3Nob3AnIHwgJ3NldHRpbmdzJyB8ICdjbG9zZSdcbiAgfCAnaGVhcnQnIHwgJ2hlYXJ0X2VtcHR5JyB8ICdkb21pbmlvbicgfCAnc3RhcicgfCAnbG9jaydcbiAgfCAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJ1xuICB8ICdnZW1fY29tbW9uJyB8ICdnZW1fcmFyZScgfCAnZ2VtX2VwaWMnIHwgJ2dlbV9sZWdlbmRhcnknXG4gIHwgJ211c2ljJyB8ICdzb3VuZF9vbicgfCAnc291bmRfb2ZmJyB8ICd1cGdyYWRlJyB8ICdzd2FwJ1xuICB8ICdtZXJnZScgfCAncmVtb3ZlJyB8ICdjaGVjaycgfCAnYmFjaycgfCAnaW5mbycgfCAnZ29sZCc7XG5cbi8qKiBSZWxhdGl2ZSB0byB0aGUgcGFnZSwgc28gaXQgd29ya3Mgb24gR2l0SHViIFBhZ2VzIHVuZGVyIC9yZXBvLW5hbWUvLiAqL1xuZXhwb3J0IGNvbnN0IGljb25VcmwgPSAobjogSWNvbk5hbWUpOiBzdHJpbmcgPT4gJ2Fzc2V0cy9pY29ucy8nICsgbiArICcucG5nJztcbi8qKiBBbiA8aW1nPiBhcyBhbiBIVE1MIHN0cmluZywgZm9yIHRoZSBnYW1lJ3MgaGFuZC1idWlsdCBET00uICovXG5leHBvcnQgY29uc3QgaWNvbkltZyA9IChuOiBJY29uTmFtZSwgY2xzID0gJ2ljJyk6IHN0cmluZyA9PiBgPGltZyBjbGFzcz1cIiR7Y2xzfVwiIHNyYz1cIiR7aWNvblVybChuKX1cIiBhbHQ9XCJcIiBkcmFnZ2FibGU9XCJmYWxzZVwiPmA7XG5cbi8qKiBFYWNoIFNvdWwgaXMgc2hvd24gYnkgaXRzIHdlYXBvbi9yb2xlIGljb24gdW50aWwgcmVhbCBwb3J0cmFpdHMgZXhpc3QuICovXG5leHBvcnQgY29uc3QgU09VTF9JQ09OOiBSZWNvcmQ8U291bElkLCBJY29uTmFtZT4gPSB7IHdhcnJpb3I6ICd3YXJyaW9yJywgYXJjaGVyOiAnYXJjaGVyJywgZ29ibGluOiAnZ29ibGluJywga25pZ2h0OiAna25pZ2h0Jywgb2dyZTogJ29ncmUnLCBiYXJiYXJpYW46ICdiYXJiYXJpYW4nIH07XG5leHBvcnQgY29uc3QgUkFSSVRZX0dFTTogUmVjb3JkPFJhcml0eSwgSWNvbk5hbWU+ID0geyBjb21tb246ICdnZW1fY29tbW9uJywgcmFyZTogJ2dlbV9yYXJlJywgZXBpYzogJ2dlbV9lcGljJywgbGVnZW5kYXJ5OiAnZ2VtX2xlZ2VuZGFyeScgfTtcblxuLyoqIFBhY2sgdGllcnMgYXJlIHNob3duIGFzIHNrdWxscyAobmV2ZXIgc3RhcnM6IHN0YXJzIG1lYW4gYW4gaW4tcnVuIG1lcmdlIGxldmVsKS4gKi9cbmV4cG9ydCBjb25zdCBza3VsbEltZ3MgPSAobjogbnVtYmVyLCBjbHMgPSAnc2snKTogc3RyaW5nID0+IGljb25JbWcoJ3NvdWxzJywgY2xzKS5yZXBlYXQoTWF0aC5tYXgoMSwgbikpO1xuZXhwb3J0IGNvbnN0IGhlYXJ0c0h0bWwgPSAoaGVhcnRzOiBudW1iZXIsIG1heCA9IDMpOiBzdHJpbmcgPT4gaWNvbkltZygnaGVhcnQnLCAnaWMgaGVhcnQnKS5yZXBlYXQoTWF0aC5tYXgoMCwgaGVhcnRzKSkgKyBpY29uSW1nKCdoZWFydF9lbXB0eScsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBtYXggLSBoZWFydHMpKTtcbi8qKiBBIG51bWJlciB3aXRoIHRob3VzYW5kcyBzZXBhcmF0b3JzIChnb2xkIGdldHMgYmlnKTogMTI1MDAgLT4gXCIxMiw1MDBcIi4gKi9cbmV4cG9ydCBjb25zdCBmbXQgPSAobjogbnVtYmVyKTogc3RyaW5nID0+IE1hdGgucm91bmQobikudG9Mb2NhbGVTdHJpbmcoJ2VuLVVTJyk7XG4iLCAiLy8gUmVuZGVyZWQgU291bCBwb3J0cmFpdHMgKFBpcGVsaW5lL2JsZW5kZXIvcmVuZGVyX3BvcnRyYWl0LnB5LCBoZWFkLWFuZC1zaG91bGRlcnMgbW9kZSksIHNoYXJlZCBieSB0aGUgQW5ndWxhciBwYWdlcyBhbmQgdGhlIGJhdHRsZSBzY3JlZW4uXG4vLyBTb3VscyB3aXRob3V0IGEgcG9ydHJhaXQgeWV0IGZhbGwgYmFjayB0byB0aGVpciByb2xlIGljb24gb24gYSBjb2xvdXJlZCBjYXJkLlxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgUkFSSVRZX09GIH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJhcml0eSB9IGZyb20gJy4uL2NvcmUvcGFja3MudHMnO1xuaW1wb3J0IHsgU09VTF9JQ09OLCBpY29uVXJsIH0gZnJvbSAnLi9pY29ucy50cyc7XG5cbmNvbnN0IFBPUlRSQUlUOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHN0cmluZz4+ID0geyB3YXJyaW9yOiAnYXNzZXRzL3BvcnRyYWl0cy93YXJyaW9yX2hlYWQucG5nJywgYXJjaGVyOiAnYXNzZXRzL3BvcnRyYWl0cy9hcmNoZXJfaGVhZC5wbmcnLCBvZ3JlOiAnYXNzZXRzL3BvcnRyYWl0cy9vZ3JlX2hlYWQucG5nJywgZ29ibGluOiAnYXNzZXRzL3BvcnRyYWl0cy9nb2JsaW5faGVhZC5wbmcnLCBrbmlnaHQ6ICdhc3NldHMvcG9ydHJhaXRzL2tuaWdodF9oZWFkLnBuZycsIGJhcmJhcmlhbjogJ2Fzc2V0cy9wb3J0cmFpdHMvYmFyYmFyaWFuX2hlYWQucG5nJyB9O1xuY29uc3QgUkFSSVRZX0hFWDogUmVjb3JkPFJhcml0eSwgc3RyaW5nPiA9IHsgY29tbW9uOiAnI2I4YzBjYycsIHJhcmU6ICcjNGFhM2ZmJywgZXBpYzogJyNiMjZiZmYnLCBsZWdlbmRhcnk6ICcjZmZjYzMzJyB9O1xuZXhwb3J0IGNvbnN0IGhhc0FydCA9IChzOiBTb3VsSWQpOiBib29sZWFuID0+ICEhUE9SVFJBSVRbc107XG5leHBvcnQgY29uc3Qgc291bEFydCA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4gUE9SVFJBSVRbc10gPz8gaWNvblVybChTT1VMX0lDT05bc10pO1xuZXhwb3J0IGNvbnN0IHJhcml0eUNvbG9yID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiBSQVJJVFlfSEVYW1JBUklUWV9PRltzXV07XG4vKiogQ2FyZCBiYWNrZHJvcCBmb3IgYSBwb3J0cmFpdDogYSBnbG93IGluIHRoZSByYXJpdHkgY29sb3VyIGJlaGluZCB0aGUgZmlndXJlLCBvbiBhIGRhcmsgY3J5cHQgZ3JhZGllbnQuICovXG5leHBvcnQgY29uc3QgYXJ0QmcgPSAoczogU291bElkKTogc3RyaW5nID0+IHsgY29uc3QgYyA9IHJhcml0eUNvbG9yKHMpOyByZXR1cm4gYHJhZGlhbC1ncmFkaWVudChlbGxpcHNlIGF0IDUwJSA4MCUsICR7Y303NyAwJSwgJHtjfTI2IDQ2JSwgdHJhbnNwYXJlbnQgNzQlKSwgbGluZWFyLWdyYWRpZW50KCMyYjI0NDQsIzBkMDkxOSlgOyB9O1xuIiwgIi8vIERPTSB1c2VyIGludGVyZmFjZTogdG9wIGJhciwgZW5lbXkgcHJldmlldywgaGFuZCBvZiBjYXJkcywgYnV0dG9ucywgZHJhZnQgb3ZlcmxheSwgdG9hc3RzIGFuZCB0aGUgZGVidWcgcGFuZWwuXG5pbXBvcnQgeyBCQUxBTkNFLCBST0xFX1RFWFQsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgeyBpc0VuZGxlc3MgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY29zdCwgZG9taW5pb25GcmVlLCBkb21pbmlvblVzZWQsIHN0YWdlV2F2ZXMgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGVuZW15V2F2ZSwgcHJldmlld1RleHQgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgeyBhcnRCZywgaGFzQXJ0LCByYXJpdHlDb2xvciwgc291bEFydCB9IGZyb20gJy4uL3VpL3BvcnRyYWl0cy50cyc7XG5pbXBvcnQgeyBTT1VMX0lDT04sIGhlYXJ0c0h0bWwsIGZtdCwgaWNvbkltZywgaWNvblVybCwgc2t1bGxJbWdzIH0gZnJvbSAnLi4vdWkvaWNvbnMudHMnO1xuaW1wb3J0IHsgZGVzY3JpYmVVbmxvY2sgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcblxuY29uc3QgcG9ydHJhaXRIdG1sID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiBgPGRpdiBjbGFzcz1cInB0XCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiR7YXJ0Qmcocyl9XCI+PGltZyBzcmM9XCIke3NvdWxBcnQocyl9XCIgYWx0PVwiXCIgZHJhZ2dhYmxlPVwiZmFsc2VcIj48L2Rpdj5gO1xuY29uc3QgSUNPTiA9IE9iamVjdC5mcm9tRW50cmllcyhTT1VMUy5tYXAoKHMpID0+IFtzLCBpY29uSW1nKFNPVUxfSUNPTltzXSwgJ2ljJyldKSkgYXMgUmVjb3JkPFNvdWxJZCwgc3RyaW5nPjtcbmNvbnN0ICQgPSAoaWQ6IHN0cmluZykgPT4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpITtcbmNvbnN0IHN0YXJzID0gKG46IG51bWJlcikgPT4gJ1x1MjYwNScucmVwZWF0KG4pO1xuXG5leHBvcnQgY2xhc3MgVWkge1xuICBwcml2YXRlIHRvYXN0VCA9IDA7IHByaXZhdGUgZGJnOiBIVE1MRWxlbWVudDsgcHJpdmF0ZSBvZGRzID0gJyc7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgZzogYW55KSB7XG4gICAgJCgnYnRuSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgJCgnYnRuQmF0dGxlJykub25jbGljayA9ICgpID0+IGcuc3RhcnRCYXR0bGUoKTsgJCgnYnRuU3dhcCcpLm9uY2xpY2sgPSAoKSA9PiBnLnRvZ2dsZVN3YXAoKTtcbiAgICAkKCdidG5SZW1vdmUnKS5vbmNsaWNrID0gKCkgPT4gZy5yZW1vdmVTZWxlY3RlZCgpO1xuICAgICQoJ2J0blNwZWVkJykub25jbGljayA9ICgpID0+IGcuc2V0U3BlZWQoZy50aW1lU2NhbGUgPiAxID8gMSA6IDIpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0Q2FtTW9kZShiLmRhdGFzZXQuY2FtISkpKTtcbiAgICAkKCdnZWFyJykub25jbGljayA9ICgpID0+IHsgdGhpcy5kYmcuY2xhc3NMaXN0LnRvZ2dsZSgnb3BlbicpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgY29uc3Qgc25kID0gKCkgPT4geyAkKCdidG5NdXNpYycpLmNsYXNzTGlzdC50b2dnbGUoJ29mZicsICFhdWRpby5tdXNpYyk7ICQoJ2J0blNmeCcpLmNsYXNzTGlzdC50b2dnbGUoJ29mZicsICFhdWRpby5zZngpOyBjb25zdCBzaSA9ICQoJ2J0blNmeCcpLnF1ZXJ5U2VsZWN0b3IoJ2ltZycpOyBpZiAoc2kpIHNpLnNyYyA9IGljb25VcmwoYXVkaW8uc2Z4ID8gJ3NvdW5kX29uJyA6ICdzb3VuZF9vZmYnKTsgfTtcbiAgICAkKCdidG5NdXNpYycpLm9uY2xpY2sgPSAoKSA9PiB7IGF1ZGlvLnNldE11c2ljKCFhdWRpby5tdXNpYyk7IHNuZCgpOyB9OyAkKCdidG5TZngnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRTZngoIWF1ZGlvLnNmeCk7IHNuZCgpOyB9O1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCduZWNyby1zZXR0aW5ncycsIHNuZCk7IHNuZCgpO1xuICAgIHRoaXMuZGJnID0gJCgnZGVidWcnKTsgaWYgKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ2RlYnVnJykpIHRoaXMuZGJnLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgICB0aGlzLnJlbmRlckRlYnVnKCk7XG4gIH1cblxuICAvKiogVGhlIE5lY3JvbWFuY2VyIGp1c3QgbG9zdCBhIGhlYXJ0OiBtYWtlIHRoZSBoZWFydHMgYnVtcC4gKi9cbiAgcHVsc2VIZWFydHMoKSB7IGNvbnN0IGggPSAkKCdoZWFydHMnKTsgaC5jbGFzc0xpc3QucmVtb3ZlKCdodXJ0Jyk7IHZvaWQgaC5vZmZzZXRXaWR0aDsgaC5jbGFzc0xpc3QuYWRkKCdodXJ0Jyk7IH1cbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgY29uc3QgdCA9ICQoJ3RvYXN0Jyk7IHQudGV4dENvbnRlbnQgPSBtc2c7IHQuY2xhc3NMaXN0LmFkZCgnc2hvdycpOyBjbGVhclRpbWVvdXQodGhpcy50b2FzdFQpOyB0aGlzLnRvYXN0VCA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHQuY2xhc3NMaXN0LnJlbW92ZSgnc2hvdycpLCAzNjAwKTsgfVxuXG4gIHJlbmRlcigpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBzID0gZy5zLCBwaCA9IGcucGhhc2UsIGJ1aWxkID0gcGggPT09ICdidWlsZCc7XG4gICAgJCgnaGVhcnRzJykuaW5uZXJIVE1MID0gaGVhcnRzSHRtbChzLmhlYXJ0cyk7XG4gICAgJCgnd2F2ZScpLnRleHRDb250ZW50ID0gaXNFbmRsZXNzKCkgPyBgV2F2ZSAke3Mud2F2ZX1gIDogYFdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX1gO1xuICAgIGNvbnN0IHVzZWQgPSBkb21pbmlvblVzZWQocyk7ICQoJ2RvbScpLnRleHRDb250ZW50ID0gYCR7dXNlZH0vJHtzLmNhcH1gOyAoJCgnZG9tZmlsbCcpIGFzIEhUTUxFbGVtZW50KS5zdHlsZS53aWR0aCA9IE1hdGgubWluKDEwMCwgKHVzZWQgLyBzLmNhcCkgKiAxMDApICsgJyUnO1xuICAgIC8vIGVuZW15IHByZXZpZXc6IHdoYXQgaXMgY29taW5nLCBuZXZlciB3aGVyZVxuICAgIGNvbnN0IHB2ID0gcHJldmlld1RleHQoZW5lbXlXYXZlKHMud2F2ZSwgZy5zZWVkKSk7XG4gICAgJCgnZW5lbXknKS5pbm5lckhUTUwgPSBgPGI+TmV4dCBlbmVtaWVzPC9iPmAgKyBwdi5tYXAoKHApID0+IGA8ZGl2IGNsYXNzPVwiZXJvd1wiPjxzcGFuPiR7SUNPTltwLnNvdWwgYXMgU291bElkXX08L3NwYW4+PHNwYW4+JHtTT1VMX05BTUVbcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuIGNsYXNzPVwieFwiPlx1MDBENyR7cC5jb3VudH08L3NwYW4+PHNwYW4gY2xhc3M9XCJzdFwiPiR7c3RhcnMocC5zdGFyKX08L3NwYW4+PC9kaXY+YCkuam9pbignJykgKyBgPGRpdiBjbGFzcz1cImhpbnRcIj5Qb3NpdGlvbnMgc3RheSBoaWRkZW4gdW50aWwgdGhlIGJhdHRsZS48L2Rpdj5gO1xuICAgIC8vIGhhbmRcbiAgICBjb25zdCBoYW5kID0gJCgnaGFuZCcpOyBoYW5kLmlubmVySFRNTCA9ICcnO1xuICAgIHMuaGFuZC5mb3JFYWNoKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4ge1xuICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgY29uc3Qgc2VsID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIGcuc2VsLmlkeCA9PT0gaTsgY29uc3QgYWZmb3JkID0gY2FuU3VtbW9uKHMsIGkpLCBjYW5NZXJnZSA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKSwgdXNhYmxlID0gYWZmb3JkIHx8IGNhbk1lcmdlO1xuICAgICAgY29uc3QgYXJ0ID0gaGFzQXJ0KHNvdWwpOyBlbC5jbGFzc05hbWUgPSAnY2FyZCcgKyAoYXJ0ID8gJyBhcnQnIDogJycpICsgKHNlbCA/ICcgc2VsJyA6ICcnKSArICghdXNhYmxlICYmICFnLnN3YXBNb2RlID8gJyBkaXMnIDogJycpICsgKGcuc3dhcE1vZGUgPyAnIHN3YXAnIDogJycpO1xuICAgICAgY29uc3QgdGFnID0gYWZmb3JkID8gYDxzcGFuIGNsYXNzPVwib2tcIj5TdW1tb248L3NwYW4+YCA6IGNhbk1lcmdlID8gJzxzcGFuIGNsYXNzPVwib2sgbWdcIj5NZXJnZSBvbmx5PC9zcGFuPicgOiAnPHNwYW4gY2xhc3M9XCJub1wiPk5vIHJvb208L3NwYW4+JztcbiAgICAgIGlmIChhcnQpIGVsLnN0eWxlLmJvcmRlckNvbG9yID0gcmFyaXR5Q29sb3Ioc291bCk7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHthcnQgPyBwb3J0cmFpdEh0bWwoc291bCkgOiBJQ09OW3NvdWxdICsgYDxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PmB9PGRpdiBjbGFzcz1cImNzXCI+JHt0YWd9PC9kaXY+YDsgZWwudGl0bGUgPSBST0xFX1RFWFRbc291bF0gKyAoYWZmb3JkID8gJycgOiBjYW5NZXJnZSA/ICcgLSBEb21pbmlvbiBpcyBmdWxsLCBidXQgeW91IGNhbiBtZXJnZSBpdCBpbnRvIHlvdXIgbWF0Y2hpbmcgMS1zdGFyIHVuaXQuJyA6ICcgLSBOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJyk7XG4gICAgICBlbC5vbmNsaWNrID0gKCkgPT4gZy5vbkNhcmQoaSk7IGhhbmQuYXBwZW5kQ2hpbGQoZWwpO1xuICAgIH0pO1xuICAgIGlmICghcy5oYW5kLmxlbmd0aCkgaGFuZC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cImVtcHR5XCI+Tm8gY2FyZHMgaW4gaGFuZDwvZGl2Pic7XG4gICAgLy8gYnV0dG9uc1xuICAgICgkKCdidG5CYXR0bGUnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhYnVpbGQgfHwgIXMudW5pdHMubGVuZ3RoO1xuICAgIGNvbnN0IHN3ID0gJCgnYnRuU3dhcCcpIGFzIEhUTUxCdXR0b25FbGVtZW50OyBzdy5kaXNhYmxlZCA9ICFidWlsZCB8fCBzLmRpc2NhcmRVc2VkOyBzdy5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGcuc3dhcE1vZGUpOyBzdy50ZXh0Q29udGVudCA9IHMuZGlzY2FyZFVzZWQgPyAnU3dhcCB1c2VkJyA6IGcuc3dhcE1vZGUgPyAnU3dhcDogcGljayBhIGNhcmQgb3IgdW5pdCcgOiAnU3dhcCAoMS9yb3VuZCknO1xuICAgIGNvbnN0IHNlbFUgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAndW5pdCcgPyBzLnVuaXRzLmZpbmQoKHU6IGFueSkgPT4gdS5pZCA9PT0gZy5zZWwuaWQpIDogbnVsbDtcbiAgICBjb25zdCBwYXJ0bmVyID0gc2VsVSAmJiBzLnVuaXRzLnNvbWUoKG86IGFueSkgPT4gY2FuTWVyZ2VEZXBsb3llZChzZWxVLCBvKSk7XG4gICAgJCgndW5pdHBhbmVsJykuc3R5bGUuZGlzcGxheSA9IGJ1aWxkICYmIHNlbFUgPyAnZmxleCcgOiAnbm9uZSc7XG4gICAgJCgnYnRuUmVtb3ZlJykudGV4dENvbnRlbnQgPSBnLmNvbmZpcm1SZW1vdmUgPyAnQ29uZmlybSByZW1vdmUnIDogJ1JlbW92ZSc7XG4gICAgJCgnaW5mbycpLnRleHRDb250ZW50ID0gYnVpbGQgPyAoZy5zd2FwTW9kZSA/ICdTV0FQOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCBpdCwgb3IgdGFwIGEgdW5pdCB5b3UgZGlkIG5vdCBzdW1tb24gdGhpcyByb3VuZCB0byBzZWxsIGl0LiBZb3UgZHJhdyBhIGRpZmZlcmVudCBTb3VsLidcbiAgICAgIDogc2VsVSA/IGAke1NPVUxfTkFNRVtzZWxVLnNvdWwgYXMgU291bElkXX0gJHtzdGFycyhzZWxVLnN0YXIpfSAgXHUyMDIyICAke1JPTEVfVEVYVFtzZWxVLnNvdWwgYXMgU291bElkXX0gICR7cGFydG5lciA/ICdcdTIwMjIgVGFwIHRoZSBtYXRjaGluZyB1bml0IHRvIG1lcmdlIGludG8gYSBzdHJvbmdlciBzdGFyLicgOiAnJ31gXG4gICAgICA6IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyA/IGAke1NPVUxfTkFNRVtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfTogJHtST0xFX1RFWFRbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX0gIFx1MjAyMiAgYCArICgoKSA9PiB7IGNvbnN0IGkgPSBnLnNlbC5pZHgsIHNtID0gY2FuU3VtbW9uKHMsIGkpLCBtZyA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKTsgcmV0dXJuIHNtICYmIG1nID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLCBvciBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6IHNtID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLicgOiBtZyA/ICdEb21pbmlvbiBpcyBmdWxsOiB0YXAgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiAnTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLic7IH0pKCkgOiAnVGFwIGEgY2FyZCwgdGhlbiBhIHRpbGUuIFRhcCBhIHVuaXQgdG8gbWVyZ2UsIG1vdmUgb3IgcmVtb3ZlIGl0LicpXG4gICAgICA6IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ0JhdHRsZSEgVW5pdHMgZmlnaHQgb24gdGhlaXIgb3duLicgOiAnJztcbiAgICAkKCdzcGVlZCcpLnN0eWxlLmRpc3BsYXkgPSBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdmbGV4JyA6ICdub25lJztcbiAgICBjb25zdCBmYXN0ID0gZy5zcGVlZFVubG9ja2VkKCk7IGlmICghZmFzdCAmJiBnLnRpbWVTY2FsZSA+IDEpIGcudGltZVNjYWxlID0gMTtcbiAgICBjb25zdCBzYiA9ICQoJ2J0blNwZWVkJyk7IHNiLnN0eWxlLmRpc3BsYXkgPSBmYXN0ID8gJycgOiAnbm9uZSc7IHNiLnRleHRDb250ZW50ID0gZy50aW1lU2NhbGUgKyAneCc7IHNiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgZy50aW1lU2NhbGUgPiAxKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IGIuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBiLmRhdGFzZXQuY2FtID09PSBnLmNhbU1vZGUpKTtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC50b2dnbGUoJ2luYmF0dGxlJywgcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicpOyBhdWRpby5zZXRNb2RlKHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2JhdHRsZScgOiAnYnVpbGQnKTtcbiAgICAvLyBvdmVybGF5XG4gICAgY29uc3Qgb3YgPSAkKCdvdmVybGF5Jyk7IG92LmNsYXNzTmFtZSA9ICcnOyBvdi5pbm5lckhUTUwgPSAnJztcbiAgICBpZiAocGggPT09ICdkcmFmdCcgJiYgZy5kcmFmdCkge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5WaWN0b3J5IERyYWZ0PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+V2F2ZSBjbGVhcmVkLiBEb21pbmlvbiBpcyBub3cgJHtzLmNhcH0uJHtnLmxhc3RHb2xkID8gYCA8YiBzdHlsZT1cImNvbG9yOiNmZmQyNGFcIj4rJHtmbXQoZy5sYXN0R29sZCl9PC9iPiAke2ljb25JbWcoJ2dvbGQnKX1gIDogJyd9IEtlZXAgb25lOjwvZGl2PjxkaXYgY2xhc3M9XCJyb3dcIj4ke2cuZHJhZnQubWFwKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4gYDxkaXYgY2xhc3M9XCJjYXJkIGJpZyR7aGFzQXJ0KHNvdWwpID8gJyBhcnQnIDogJyd9XCIgZGF0YS1pPVwiJHtpfVwiJHtoYXNBcnQoc291bCkgPyBgIHN0eWxlPVwiYm9yZGVyLWNvbG9yOiR7cmFyaXR5Q29sb3Ioc291bCl9XCJgIDogJyd9PjxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PiR7aGFzQXJ0KHNvdWwpID8gcG9ydHJhaXRIdG1sKHNvdWwpIDogSUNPTltzb3VsXX08ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj48ZGl2IGNsYXNzPVwicm9sZVwiPiR7Uk9MRV9URVhUW3NvdWxdfTwvZGl2PjwvZGl2PmApLmpvaW4oJycpfTwvZGl2PjwvZGl2PmA7XG4gICAgICBvdi5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignLmNhcmQnKS5mb3JFYWNoKChjKSA9PiAoYy5vbmNsaWNrID0gKCkgPT4gZy5waWNrRHJhZnQoK2MuZGF0YXNldC5pISkpKTtcbiAgICB9IGVsc2UgaWYgKHBoID09PSAnd29uJyB8fCBwaCA9PT0gJ2xvc3QnKSB7XG4gICAgICBjb25zdCBydyA9IHBoID09PSAnd29uJyA/IGcucmV3YXJkIDogbnVsbCwgc2sgPSAobjogbnVtYmVyKSA9PiBza3VsbEltZ3Mobik7XG4gICAgICBjb25zdCB1bmxvY2tIdG1sID0gcncgJiYgcncudW5sb2NrZWQgJiYgcncudW5sb2NrZWQubGVuZ3RoID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiM3ZWYyYzg7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdjaGVjaycpfSBVbmxvY2tlZDogJHtydy51bmxvY2tlZC5tYXAoKGs6IHN0cmluZykgPT4gZGVzY3JpYmVVbmxvY2soaykpLmpvaW4oJyBcXHUwMGI3ICcpfTwvZGl2PmAgOiAnJztcbiAgICAgIGNvbnN0IGdvbGRIdG1sID0gZy5ydW5Hb2xkID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdnb2xkJyl9IEdvbGQgZWFybmVkIHRoaXMgcnVuOiAke2ZtdChnLnJ1bkdvbGQpfTwvZGl2PmAgOiAnJztcbiAgICAgIGNvbnN0IGRyID0gcGggPT09ICd3b24nICYmIGcuZGFpbHkgPyBnLmRhaWx5UmV3YXJkIDogbnVsbDtcbiAgICAgIGNvbnN0IGRhaWx5SHRtbCA9IGcuZGFpbHkgPyAoZHIgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2RyLnBhY2sgPyBgJHtpY29uSW1nKCdzaG9wJyl9IERhaWx5IGNvbXBsZXRlISBZb3UgZWFybmVkIGEgJHtzaygxKX0gU291bCBQYWNrIGFuZCAke2ZtdChkci5nb2xkKX0gJHtpY29uSW1nKCdnb2xkJyl9LmAgOiAnRGFpbHkgY29tcGxldGUgYWdhaW4uIFRoZSByZXdhcmQgY29tZXMgb25jZSBwZXIgZGF5OiBzZWUgeW91IHRvbW9ycm93ISd9PC9kaXY+YCA6ICcnKSA6ICcnO1xuICAgICAgY29uc3QgcmV3YXJkSHRtbCA9IGdvbGRIdG1sICsgZGFpbHlIdG1sICsgdW5sb2NrSHRtbCArIChydyA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7cncucGFjayA/IChydy5maXJzdCA/IGAke2ljb25JbWcoJ3Nob3AnKX0gRmlyc3QgY2xlYXIhIFlvdSBlYXJuZWQgYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gIDogYCR7aWNvbkltZygnc2hvcCcpfSBSZXBsYXkgcmV3YXJkOiBhICR7c2socncucGFjay50aWVyKX0gU291bCBQYWNrLmApIDogYFJlcGxheSBwcm9ncmVzcyAke3J3LnJlcGxheU1ldGVyfS8ke3J3LnJlcGxheU5lZWRlZH0gdG93YXJkIGEgU291bCBQYWNrLmB9PC9kaXY+YCA6ICcnKTtcbiAgICAgIGlmIChwaCA9PT0gJ2xvc3QnICYmIGlzRW5kbGVzcygpICYmIGcuZW5kbGVzcykgeyAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGVuZCBvZiBhbiBlbmRsZXNzIHJ1bjogaG93IGRlZXAsIGFueSByZWNvcmQsIHBhY2tzIGVhcm5lZFxuICAgICAgICBjb25zdCBlID0gZy5lbmRsZXNzLCByZWMgPSBlLmNsZWFyZWQgPiBlLnN0YXJ0QmVzdDtcbiAgICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5SdW4gb3ZlcjwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPllvdSBjbGVhcmVkICR7ZS5jbGVhcmVkfSB3YXZlJHtlLmNsZWFyZWQgPT09IDEgPyAnJyA6ICdzJ30uICR7cmVjID8gJzxiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YVwiPk5ldyBiZXN0IGRlcHRoITwvYj4nIDogJ0Jlc3Q6IHdhdmUgJyArIE1hdGgubWF4KGUuc3RhcnRCZXN0LCBlLmNsZWFyZWQpICsgJy4nfTwvZGl2PiR7Zy5ydW5Hb2xkID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdnb2xkJyl9IEdvbGQgZWFybmVkIHRoaXMgcnVuOiAke2ZtdChnLnJ1bkdvbGQpfTwvZGl2PmAgOiAnJ30ke2UucGFja3MgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ3Nob3AnKX0gJHtlLnBhY2tzfSBTb3VsIFBhY2ske2UucGFja3MgPT09IDEgPyAnJyA6ICdzJ30gZWFybmVkIHRoaXMgcnVuLjwvZGl2PmAgOiAnPGRpdiBjbGFzcz1cInN1YlwiPkNsZWFyIHdhdmUgMTAgdG8gZWFybiBhIFNvdWwgUGFjay48L2Rpdj4nfTxkaXYgY2xhc3M9XCJyb3dcIj4ke2UucGFja3MgPyAnPGJ1dHRvbiBpZD1cInRvU2hvcFwiIGNsYXNzPVwiZ29cIj5PcGVuIHBhY2s8L2J1dHRvbj4nIDogJyd9PGJ1dHRvbiBpZD1cImFnYWluXCIgY2xhc3M9XCIke2UucGFja3MgPyAnYmx1ZScgOiAnZ28nfVwiPkdvIGFnYWluPC9idXR0b24+PGJ1dHRvbiBpZD1cInRvSG9tZVwiIGNsYXNzPVwiYmx1ZVwiPkhvbWU8L2J1dHRvbj48L2Rpdj48L2Rpdj5gO1xuICAgICAgICAkKCdhZ2FpbicpLm9uY2xpY2sgPSAoKSA9PiBnLm5ld0VuZGxlc3MoKTsgJCgndG9Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAgICAgY29uc3QgdHMyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvU2hvcCcpOyBpZiAodHMyKSB0czIub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc2hvcCcpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPiR7Zy5kYWlseSA/IChwaCA9PT0gJ3dvbicgPyAnRGFpbHkgY29tcGxldGUhJyA6ICdDaGFsbGVuZ2UgZmFpbGVkJykgOiBwaCA9PT0gJ3dvbicgPyAnU3RhZ2UgY2xlYXJlZCEnIDogJ1N0YWdlIGxvc3QnfTwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPiR7Zy5sYXN0QmF0dGxlfTwvZGl2PiR7cmV3YXJkSHRtbH08ZGl2IGNsYXNzPVwicm93XCI+JHsocncgJiYgcncucGFjaykgfHwgKGRyICYmIGRyLnBhY2spID8gJzxidXR0b24gaWQ9XCJ0b1Nob3BcIiBjbGFzcz1cImdvXCI+T3BlbiBwYWNrPC9idXR0b24+JyA6ICcnfTxidXR0b24gaWQ9XCJhZ2FpblwiIGNsYXNzPVwiJHsocncgJiYgcncucGFjaykgfHwgKGRyICYmIGRyLnBhY2spID8gJ2JsdWUnIDogJ2dvJ31cIj4ke3BoID09PSAnd29uJyA/ICdQbGF5IGFnYWluJyA6ICdUcnkgYWdhaW4nfTwvYnV0dG9uPjxidXR0b24gaWQ9XCJ0b0hvbWVcIiBjbGFzcz1cImJsdWVcIj5Ib21lPC9idXR0b24+PC9kaXY+PC9kaXY+YDtcbiAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IChnLmRhaWx5ID8gZy5uZXdEYWlseSgpIDogZy5uZXdSdW4oKSk7ICQoJ3RvSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgICBjb25zdCB0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b1Nob3AnKTsgaWYgKHRzKSB0cy5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zaG9wJykpO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnJlbmRlckRlYnVnTGl2ZSgpO1xuICAgIGlmIChwaCA9PT0gJ2J1aWxkJykgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IGcucmVmcmFtZUJ1aWxkKCkpOyAgICAgLy8gYWZ0ZXIgbGF5b3V0OiBrZWVwIHRoZSBncmlkIGNsZWFyIG9mIHRoZSBoYW5kIGFuZCBidXR0b25zXG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgcGFuZWxcbiAgcHJpdmF0ZSByZW5kZXJEZWJ1ZygpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBkID0gdGhpcy5kYmc7IGlmICghZC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSkgeyBkLmlubmVySFRNTCA9ICcnOyByZXR1cm47IH1cbiAgICBjb25zdCByb3cgPSAobGFiZWw6IHN0cmluZywgb2JqOiBhbnksIGtleTogc3RyaW5nIHwgbnVtYmVyLCBtaW46IG51bWJlciwgbWF4OiBudW1iZXIsIHN0ZXA6IG51bWJlcikgPT4gYDxsYWJlbD4ke2xhYmVsfSA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiJHttaW59XCIgbWF4PVwiJHttYXh9XCIgc3RlcD1cIiR7c3RlcH1cIiB2YWx1ZT1cIiR7b2JqW2tleV19XCIgZGF0YS1vPVwiJHtsYWJlbH1cIj48c3Bhbj4ke29ialtrZXldfTwvc3Bhbj48L2xhYmVsPmA7XG4gICAgZC5pbm5lckhUTUwgPSBgPGI+RGVidWcgKGxpdmUpPC9iPiA8c3BhbiBpZD1cImRiZ2Zwc1wiPjwvc3Bhbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+U3RhciBtdWx0aXBsaWVycyAoYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHkpXG4gICAgICAgICR7cm93KCdIUCB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdIUCB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnU2l6ZSAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAxLCAxLCAxLjYsIDAuMDIpfSR7cm93KCdTaXplIDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDIsIDEsIDIsIDAuMDIpfTwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48dGFibGU+PHRyPjx0aD48L3RoPjx0aD5ocDwvdGg+PHRoPmRtZzwvdGg+PHRoPnJhdGU8L3RoPjx0aD5yYW5nZTwvdGg+PHRoPnNwZDwvdGg+PC90cj4ke1NPVUxTLm1hcCgoaykgPT4gYDx0cj48dGQ+JHtJQ09OW2tdfTwvdGQ+JHtbJ2hwJywgJ2RtZycsICdpbnRlcnZhbCcsICdyYW5nZScsICdzcGVlZCddLm1hcCgoZikgPT4gYDx0ZD48aW5wdXQgY2xhc3M9XCJudW1cIiBkYXRhLXNvdWw9XCIke2t9XCIgZGF0YS1mPVwiJHtmfVwiIHZhbHVlPVwiJHsoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2tdW2ZdfVwiPjwvdGQ+YCkuam9pbignJyl9PC90cj5gKS5qb2luKCcnKX08L3RhYmxlPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5EaWZmaWN1bHR5IDxzZWxlY3QgaWQ9XCJkRGlmZlwiPiR7WydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5QZXJmb3JtYW5jZTxicj48c21hbGwgaWQ9XCJkYmdQZXJmXCI+bWVhc3VyaW5nXHUyMDI2PC9zbWFsbD48YnI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRGcHNcIiAke2cuc2hvd0ZwcyA/ICdjaGVja2VkJyA6ICcnfT4gU2hvdyBGUFMgb24gdGhlIGJhdHRsZSBzY3JlZW48L2xhYmVsPiA8YnV0dG9uIGlkPVwiZFBlcmZcIj5Db3B5IHBlcmYgcmVwb3J0PC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkT2Rkc1wiPlRlc3Qgb2RkcyAoMjAwIGZpZ2h0cyk8L2J1dHRvbj4gPHNwYW4gaWQ9XCJkT2Rkc091dFwiPiR7dGhpcy5vZGRzfTwvc3Bhbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRDb3B5XCI+Q29weSByZXBvcnQ8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXNldFwiPlJlc2V0IGJhbGFuY2U8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXN0YXJ0XCI+UmVzdGFydCBzdGFnZTwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5BZGQgY2FyZCA8c2VsZWN0IGlkPVwiZENhcmRcIj4ke1NPVUxTLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCI+JHtTT1VMX05BTUVba119PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxidXR0b24gaWQ9XCJkQWRkXCI+KzwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZERvbVwiPisyIERvbWluaW9uPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5MYXN0IHRhcDogPHNwYW4gaWQ9XCJkYmd0YXBcIj4ke2cubGFzdFRhcEluZm99PC9zcGFuPjwvc21hbGw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5TZWVkICR7Zy5zZWVkfS4gQWRkIDxjb2RlPj9zZWVkPTc8L2NvZGU+IHRvIHRoZSBsaW5rIHRvIHJlcGxheSB0aGUgc2FtZSBkcmF3cy48L3NtYWxsPjwvZGl2PmA7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dFt0eXBlPXJhbmdlXScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmlucHV0ID0gKCkgPT4ge1xuICAgICAgY29uc3QgbGFiID0gaW5wLmRhdGFzZXQubyE7IGNvbnN0IHYgPSAraW5wLnZhbHVlOyAoaW5wLm5leHRFbGVtZW50U2libGluZyBhcyBIVE1MRWxlbWVudCkudGV4dENvbnRlbnQgPSBTdHJpbmcodik7XG4gICAgICBjb25zdCBzZXQ6IFJlY29yZDxzdHJpbmcsICgpID0+IHZvaWQ+ID0geyAnSFAgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsxXSA9IHYpLCAnSFAgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsyXSA9IHYpLCAnRGFtYWdlIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzFdID0gdiksICdEYW1hZ2UgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMl0gPSB2KSwgJ1NpemUgMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMV0gPSB2KSwgJ1NpemUgM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMl0gPSB2KSB9O1xuICAgICAgc2V0W2xhYl0oKTsgZy5hcHBseUJhbGFuY2VDaGFuZ2UoKTtcbiAgICB9KSk7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dC5udW0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25jaGFuZ2UgPSAoKSA9PiB7IChCQUxBTkNFLnN0YXRzIGFzIGFueSlbaW5wLmRhdGFzZXQuc291bCFdW2lucC5kYXRhc2V0LmYhXSA9ICtpbnAudmFsdWU7IH0pKTtcbiAgICAkKCdkRGlmZicpLm9uY2hhbmdlID0gKGUpID0+IGcuY2hhbmdlRGlmZmljdWx0eSgoZS50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlKTtcbiAgICAkKCdkTWVyZ2VIYW5kJykub25jaGFuZ2UgPSAoZSkgPT4geyBnLnMucnVsZXMubWVyZ2UgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZCA/ICdoYW5kSW50b09uZVN0YXInIDogJ2RlcGxveWVkT25seSc7IGcuc3luY0J1aWxkKCk7IHRoaXMucmVuZGVyKCk7IH07XG4gICAgJCgnZE9kZHMnKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCByID0gZy50ZXN0T2RkcygyMDApOyB0aGlzLm9kZHMgPSBgJHtyLndpbn0lIHdpbiAoJHtyLm59IGZpZ2h0cywgYXZnICR7ci5hdmdUaW1lfXMpIHZzIHdhdmUgJHtnLnMud2F2ZX1gOyAkKCdkT2Rkc091dCcpLnRleHRDb250ZW50ID0gdGhpcy5vZGRzOyB9O1xuICAgICQoJ2RDb3B5Jykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucmVwb3J0KCk7IChuYXZpZ2F0b3IuY2xpcGJvYXJkID8gbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCkgOiBQcm9taXNlLnJlamVjdCgpKS50aGVuKCgpID0+IHRoaXMudG9hc3QoJ1JlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RGcHMnKS5vbmNoYW5nZSA9IChlKSA9PiBnLnNldFNob3dGcHMoKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQpO1xuICAgICQoJ2RQZXJmJykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucGVyZlJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdQZXJmIHJlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RSZXNldCcpLm9uY2xpY2sgPSAoKSA9PiB7IGcucmVzZXRCYWxhbmNlQWxsKCk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICAkKCdkUmVzdGFydCcpLm9uY2xpY2sgPSAoKSA9PiBnLnN0YXJ0U3RhZ2UoZy5zZWVkKTtcbiAgICAkKCdkQWRkJykub25jbGljayA9ICgpID0+IGcuYWRkQ2FyZCgoJCgnZENhcmQnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUgYXMgU291bElkKTsgJCgnZERvbScpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZERvbWluaW9uKDIpO1xuICB9XG4gIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ1BlcmYnKTsgaWYgKHBmKSB7IGNvbnN0IHAgPSB0aGlzLmcucGVyZkluZm8oKTsgcGYudGV4dENvbnRlbnQgPSBgJHtwLmZwcy50b0ZpeGVkKDApfSBmcHMgXHUwMEI3IGF2ZyAke3AuYXZnLnRvRml4ZWQoMSl9bXMgXHUwMEI3IHNsb3c1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMgXHUwMEI3IHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIFx1MDBCNyAke3AubWVzaGVzfSBtZXNoZXMgXHUwMEI3ICR7cC5wYXJ0aWNsZXN9IHBhcnRpY2xlIHN5c3RlbXMgXHUwMEI3ICR7cC5kcmF3c30gZHJhdyBjYWxsc2A7IH1cbiAgICBjb25zdCB0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ3RhcCcpOyBpZiAodCkgdC50ZXh0Q29udGVudCA9IHRoaXMuZy5sYXN0VGFwSW5mbztcbiAgfVxufVxuIiwgIi8vIFRoZSBwbGF5YWJsZSBwcm90b3R5cGU6IGJ1aWxkIHNjcmVlbiAtPiBiYXR0bGUgLT4gZHJhZnQgLT4gbmV4dCB3YXZlLCBidWlsdCBvbiB0aGUgdGVzdGVkIHJ1bGVzICsgYmF0dGxlIGVuZ2luZS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSwgcmVzZXRCYWxhbmNlLCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgR1JJRF9DRUxMUywgR1JJRF9DT0xTLCBHUklEX1JPV1MsIFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7XG4gIGFkdmFuY2VXYXZlLCBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNlbGxGcmVlLCBjb3N0LCBkaXNjYXJkUmVkcmF3LCBkaXNtaXNzLCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgZHJhZnRPcHRpb25zLCBmYWlsV2F2ZSxcbiAgbWVyZ2VEZXBsb3llZCwgbWVyZ2VGcm9tSGFuZCwgbW92ZVVuaXQsIG5ld1N0YWdlLCBub3JtYWxEcmF3LCBzdGFnZVdhdmVzLCBzdW1tb24sIHN3YXBTZWxsLCB0YWtlRHJhZnQsXG59IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgYnVpbGRBcmVuYSB9IGZyb20gJy4vYXJlbmEudHMnO1xuaW1wb3J0IHsgQmF0dGxlLCBjZWxsUG9zLCBGUk9OVF9YLCBHUklEX1NQLCBzaW11bGF0ZSB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB0eXBlIHsgQkV2ZW50IH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHsgY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lLCBlbmVteVBvd2VyLCBlbmVteVdhdmUsIGlzRW5kbGVzcywgc2V0RGlmZmljdWx0eSwgc2V0RW5kbGVzcywgc2V0U3RhZ2VEaWZmaWN1bHR5LCBzZXREYWlseSB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19JRCwgRU5ETEVTU19QQUNLX0VWRVJZIH0gZnJvbSAnLi4vY29yZS9lbmRsZXNzLnRzJztcbmltcG9ydCB7IERBSUxZX0lELCBkYWlseVJ1bGVzLCBkYXlOdW1iZXIsIGlzVmFsaWREYXksIG1vZGlmaWVyRm9yIH0gZnJvbSAnLi4vY29yZS9kYWlseS50cyc7XG5pbXBvcnQgdHlwZSB7IERhaWx5TW9kIH0gZnJvbSAnLi4vY29yZS9kYWlseS50cyc7XG5pbXBvcnQgeyBFTkRMRVNTX1JVTEVTLCBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuLi9jb3JlL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgeyBsb2FkU2F2ZSB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5pbXBvcnQgeyBlbmRsZXNzVW5sb2NrZWQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB7IE5lY3JvbWFuY2VyIH0gZnJvbSAnLi9uZWNyb21hbmNlci50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgY2xlYXJSdW4sIGxvYWRSdW4sIHNhdmVSdW4sIHNlcmlhbGl6ZVN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB7IGFkZEdvbGRBbmRTYXZlLCBlbmRsZXNzV2F2ZUdvbGQsIHBsYXlhYmxlLCByZWNvcmRDbGVhckFuZFNhdmUsIHJlY29yZERhaWx5V2luQW5kU2F2ZSwgcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlLCB3YXZlR29sZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBEYWlseVJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBDbGVhclJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSdW5TbmFwc2hvdCB9IGZyb20gJy4uL2NvcmUvcnVuc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBjcmVhdGVWaXN1YWwsIGlzVHJpcG8sIGxvYWRBc3NldHMgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHR5cGUgeyBBc3NldHMsIFVuaXRWaXN1YWwgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHsgVWkgfSBmcm9tICcuL3VpLnRzJztcblxuZXhwb3J0IHR5cGUgUGhhc2UgPSAnYnVpbGQnIHwgJ3RyYW5zaXRpb24nIHwgJ2JhdHRsZScgfCAnZHJhZnQnIHwgJ3dvbicgfCAnbG9zdCc7XG50eXBlIFNlbCA9IHsgdHlwZTogJ2NhcmQnOyBpZHg6IG51bWJlciB9IHwgeyB0eXBlOiAndW5pdCc7IGlkOiBudW1iZXIgfSB8IG51bGw7XG5cbmV4cG9ydCBjbGFzcyBHYW1lIHtcbiAgZW5naW5lOiBhbnk7IHNjZW5lOiBhbnk7IGNhbWVyYTogYW55OyBBITogQXNzZXRzOyB1aSE6IFVpO1xuICBkYWlseTogeyBkYXk6IG51bWJlcjsgbW9kOiBEYWlseU1vZCB9IHwgbnVsbCA9IG51bGw7IGRhaWx5UmV3YXJkOiBEYWlseVJld2FyZCB8IG51bGwgPSBudWxsOyAgIC8vIHRoZSBEYWlseSBDaGFsbGVuZ2UgcnVuIGluIHByb2dyZXNzLCBhbmQgd2hhdCBpdHMgd2luIHBhaWRcbiAgbGFzdEdvbGQgPSAwOyBydW5Hb2xkID0gMDsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBmcm9tIHRoZSB3YXZlIGp1c3QgY2xlYXJlZCwgYW5kIGZyb20gdGhpcyB3aG9sZSBydW5cbiAgcyE6IFN0YXRlOyBzZWVkID0gMTsgYXR0ZW1wdCA9IDA7IHBoYXNlOiBQaGFzZSA9ICdidWlsZCc7IGJhdHRsZTogQmF0dGxlIHwgbnVsbCA9IG51bGw7IHRpbWVTY2FsZSA9IDE7XG4gIHNlbDogU2VsID0gbnVsbDsgc3dhcE1vZGUgPSBmYWxzZTsgY29uZmlybVJlbW92ZSA9IGZhbHNlOyBkcmFmdDogU291bElkW10gfCBudWxsID0gbnVsbDsgbGFzdEJhdHRsZSA9ICcnO1xuICBwcml2YXRlIHVuaXRWaXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgIC8vIHVuaXQgaWQgLT4gdmlzdWFsICh5b3VyIGFybXksIHBlcnNpc3RzIGJldHdlZW4gd2F2ZXMpXG4gIHByaXZhdGUgdmlzVG9Vbml0ID0gbmV3IE1hcDxVbml0VmlzdWFsLCBudW1iZXI+KCk7XG4gIHByaXZhdGUgZnZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB2aXN1YWwgZHVyaW5nIGEgYmF0dGxlXG4gIHByaXZhdGUgZlVuaXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpOyAgICAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB1bml0IGlkIChwbGF5ZXIgc2lkZSlcbiAgcHJpdmF0ZSBsYXN0U3RhdGUgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpO1xuICBwcml2YXRlIGFyZW5hITogeyB1cGRhdGUodDogbnVtYmVyKTogdm9pZDsgc2V0VGhlbWUoc3RhZ2U6IHN0cmluZyk6IHZvaWQgfTtcbiAgcHJpdmF0ZSB0aWxlczogYW55W10gPSBbXTsgcHJpdmF0ZSB0aWxlTWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSByaW5nRng6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbWVyczogeyB0OiBudW1iZXI7IGZuOiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIGFjYyA9IDA7IHByaXZhdGUgY2FtRnJvbTogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UID0gMTsgcHJpdmF0ZSBjYW1EdXIgPSAyLjA7IHByaXZhdGUgcmVzdWx0QXQgPSAtMTsgcHJpdmF0ZSBoYW5kbGVkID0gZmFsc2U7IHByaXZhdGUgc3RhcnRTdGVwQXQgPSAwO1xuICBwcml2YXRlIGFycm93TWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd01lc2g6IGFueVtdID0gW107XG4gIG5lY3JvITogTmVjcm9tYW5jZXI7XG4gIC8qKiBXaGF0IHRoZSBsYXN0IHN0YWdlIGNsZWFyIGVhcm5lZCAoc2hvd24gb24gdGhlIHN0YWdlLWNsZWFyZWQgc2NyZWVuKS4gKi9cbiAgcmV3YXJkOiBDbGVhclJld2FyZCB8IG51bGwgPSBudWxsO1xuICAvKiogVGhlIGVuZGxlc3MgcnVuIGluIHByb2dyZXNzOiB0aGUgYmVzdCBkZXB0aCB3aGVuIGl0IGJlZ2FuICh0byBzcG90IGEgbmV3IHJlY29yZCksIHRoZSB3YXZlcyBjbGVhcmVkIHNvIGZhciwgYW5kIHRoZSBwYWNrcyBlYXJuZWQuICovXG4gIGVuZGxlc3M6IHsgc3RhcnRCZXN0OiBudW1iZXI7IGNsZWFyZWQ6IG51bWJlcjsgcGFja3M6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2luZSA9IGZhbHNlOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSByZXN1bHQgY3V0c2NlbmUgaXMgcGxheWluZzogdGhlIGJhdHRsZSBjYW1lcmEgYW5kIGZpZ2h0ZXIgc3luYyBzdGFuZCBkb3duXG4gIHByaXZhdGUgdHdlZW5zOiB7IHQ6IG51bWJlcjsgZHVyOiBudW1iZXI7IGZuOiAodTogbnVtYmVyKSA9PiB2b2lkOyBkb25lPzogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSB0d2VlbihkdXI6IG51bWJlciwgZm46ICh1OiBudW1iZXIpID0+IHZvaWQsIGRvbmU/OiAoKSA9PiB2b2lkKSB7IHRoaXMudHdlZW5zLnB1c2goeyB0OiAwLCBkdXIsIGZuLCBkb25lIH0pOyB9XG4gIC8qKiBGaW5pc2ggZXZlcnkgcnVubmluZyBhbmltYXRpb24gYXQgb25jZSAoc28gbm90aGluZyBpcyBsZWZ0IGhhbGYtd2F5IG9yIHVuZGlzcG9zZWQgd2hlbiB0aGUgcGhhc2UgY2hhbmdlcykuICovXG4gIHByaXZhdGUgZmx1c2hUd2VlbnMoKSB7IGZvciAoY29uc3QgdyBvZiB0aGlzLnR3ZWVucy5zcGxpY2UoMCkpIHsgdy5mbigxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICBwcml2YXRlIHNlZW5NZXJnZXMgPSAwO1xuXG4gIGFzeW5jIGluaXQoY2FudmFzOiBIVE1MQ2FudmFzRWxlbWVudCkge1xuICAgIGNvbnN0IHFzID0gbmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpO1xuICAgIHRoaXMuZW5naW5lID0gbmV3IEJBQllMT04uRW5naW5lKGNhbnZhcywgdHJ1ZSwgeyBhbnRpYWxpYXM6IHRydWUsIHBvd2VyUHJlZmVyZW5jZTogJ2hpZ2gtcGVyZm9ybWFuY2UnIH0pO1xuICAgIGNvbnN0IGRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7IHRoaXMuZW5naW5lLnNldEhhcmR3YXJlU2NhbGluZ0xldmVsKDEgLyBNYXRoLm1pbihkcHIsIDEuNSkpO1xuICAgIGNvbnN0IHNjZW5lID0gdGhpcy5zY2VuZSA9IG5ldyBCQUJZTE9OLlNjZW5lKHRoaXMuZW5naW5lKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjA5LCAwLjA3LCAwLjEzLCAxKTtcbiAgICBjb25zdCBoZW1pID0gbmV3IEJBQllMT04uSGVtaXNwaGVyaWNMaWdodCgnaCcsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAxLCAwLjMpLCBzY2VuZSk7IGhlbWkuaW50ZW5zaXR5ID0gMS4wNTsgaGVtaS5ncm91bmRDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjMyLCAwLjI2LCAwLjQyKTtcbiAgICBjb25zdCBzdW4gPSBuZXcgQkFCWUxPTi5EaXJlY3Rpb25hbExpZ2h0KCdzJywgbmV3IEJBQllMT04uVmVjdG9yMygtMC40LCAtMSwgMC41NSksIHNjZW5lKTsgc3VuLmludGVuc2l0eSA9IDAuODU7XG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgQkFCWUxPTi5GcmVlQ2FtZXJhKCdjYW0nLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDgsIC05KSwgc2NlbmUpOyB0aGlzLmNhbWVyYS5taW5aID0gMC4xOyB0aGlzLmNhbWVyYS5tYXhaID0gMjAwOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg7IHRoaXMuY2FtZXJhLmlucHV0cy5jbGVhcigpO1xuXG4gICAgY29uc3QgZ3JvdW5kID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ2dyb3VuZCcsIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQwIH0sIHNjZW5lKTtcbiAgICBncm91bmQuaXNQaWNrYWJsZSA9IGZhbHNlOyBjb25zdCBhcmVuYSA9IHRoaXMuYXJlbmEgPSBidWlsZEFyZW5hKHNjZW5lLCBncm91bmQpOyBzY2VuZS5vbkJlZm9yZVJlbmRlck9ic2VydmFibGUuYWRkKCgpID0+IGFyZW5hLnVwZGF0ZShwZXJmb3JtYW5jZS5ub3coKSAvIDEwMDApKTtcbiAgICBmb3IgKGNvbnN0IHRlYW0gb2YgWzAsIDFdIGFzIGNvbnN0KSBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBjb25zdCB0ID0gdGhpcy5tYWtlVGlsZSh0ZWFtLCBjKTsgaWYgKHRlYW0gPT09IDApIHRoaXMudGlsZXMucHVzaCh0KTsgZWxzZSB0LnNldEVuYWJsZWQoZmFsc2UpOyB9XG5cbiAgICB0aGlzLkEgPSBhd2FpdCBsb2FkQXNzZXRzKHNjZW5lKTtcbiAgICB0aGlzLm5lY3JvID0gbmV3IE5lY3JvbWFuY2VyKHNjZW5lLCB0aGlzLkEuc29mdCwgdGhpcy5BLm5lY3JvKTsgICAgICAgLy8gc3RhbmRzIGp1c3QgYmVoaW5kIGhpcyBhcm15J3MgYmFjayBjb2x1bW4sIGZhY2luZyB0aGUgYmF0dGxlZmllbGRcbiAgICB0aGlzLm5lY3JvLmhvbGRlci5wb3NpdGlvbi5zZXQoLShGUk9OVF9YICsgKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCkgLSAxLjA1LCAwLCAwKTsgdGhpcy5uZWNyby5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyO1xuICAgIHRoaXMuYXJyb3dNYXRzID0gWzAsIDFdLm1hcCgodCkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnYW0nICsgdCwgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4zLCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjcsIDAuMjUpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHJldHVybiBtOyB9KTtcbiAgICB0aGlzLnVpID0gbmV3IFVpKHRoaXMpOyB0aGlzLnNlZWQgPSArKHFzLmdldCgnc2VlZCcpIHx8IDEpOyBpZiAocXMuZ2V0KCdmcHMnKSkgdGhpcy5zZXRTaG93RnBzKHRydWUpO1xuXG4gICAgLy8gVGFwcyBhcmUgZGV0ZWN0ZWQgaGVyZSAobm90IHRocm91Z2ggQmFieWxvbikgc28gdGhleSBiZWhhdmUgdGhlIHNhbWUgaW4gU2FmYXJpLCB0aGUgaG9tZS1zY3JlZW4gYXBwIGFuZCBvbiBkZXNrdG9wLlxuICAgIGxldCBkb3duOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB0OiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xuICAgIGNvbnN0IGxvY2FsID0gKGU6IFBvaW50ZXJFdmVudCkgPT4geyBjb25zdCByID0gY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpOyByZXR1cm4geyB4OiBlLmNsaWVudFggLSByLmxlZnQsIHk6IGUuY2xpZW50WSAtIHIudG9wIH07IH07XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJkb3duJywgKGUpID0+IHsgZG93biA9IHsgLi4ubG9jYWwoZSksIHQ6IHBlcmZvcm1hbmNlLm5vdygpIH07IH0pO1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVydXAnLCAoZSkgPT4geyBpZiAoIWRvd24pIHJldHVybjsgY29uc3QgcCA9IGxvY2FsKGUpOyBjb25zdCBtb3ZlZCA9IE1hdGguaHlwb3QocC54IC0gZG93bi54LCBwLnkgLSBkb3duLnkpLCBkdCA9IHBlcmZvcm1hbmNlLm5vdygpIC0gZG93bi50OyBkb3duID0gbnVsbDsgaWYgKG1vdmVkIDwgMTYgJiYgZHQgPCA5MDApIHRoaXMudGFwKHAueCwgcC55KTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJjYW5jZWwnLCAoKSA9PiB7IGRvd24gPSBudWxsOyB9KTtcbiAgICB0aGlzLmNhbnZhcyA9IGNhbnZhczsgY29uc3Qgb25SZXNpemUgPSAoKSA9PiB0aGlzLmhhbmRsZVJlc2l6ZSgpO1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBvblJlc2l6ZSk7IHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdvcmllbnRhdGlvbmNoYW5nZScsICgpID0+IHNldFRpbWVvdXQob25SZXNpemUsIDI1MCkpO1xuICAgIGlmICgod2luZG93IGFzIGFueSkudmlzdWFsVmlld3BvcnQpICh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydC5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBvblJlc2l6ZSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS5SZXNpemVPYnNlcnZlcikgbmV3ICh3aW5kb3cgYXMgYW55KS5SZXNpemVPYnNlcnZlcihvblJlc2l6ZSkub2JzZXJ2ZShjYW52YXMpO1xuICAgIGlmIChxcy5nZXQoJ2dhbGxlcnknKSkgeyB0aGlzLmdhbGxlcnkoKTsgcmV0dXJuOyB9XG4gICAgY29uc3Qgc2F2ZWQgPSBxcy5nZXQoJ3NlZWQnKSA/IG51bGwgOiBsb2FkUnVuKCk7ICAgICAgICAgICAgICAgIC8vID9zZWVkPU4gYWx3YXlzIHN0YXJ0cyBmcmVzaCAoZGVidWdnaW5nKTsgb3RoZXJ3aXNlIHBpY2sgdXAgd2hlcmUgdGhlIGxhc3QgdmlzaXQgbGVmdCBvZmZcbiAgICBpZiAoc2F2ZWQpIHRoaXMucmVzdG9yZShzYXZlZCk7IGVsc2UgdGhpcy5zdGFydFN0YWdlKHRoaXMuc2VlZCk7XG4gICAgbGV0IGxhc3QgPSBwZXJmb3JtYW5jZS5ub3coKTtcbiAgICB0aGlzLmVuZ2luZS5ydW5SZW5kZXJMb29wKCgpID0+IHsgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCksIHJhdyA9IG5vdyAtIGxhc3Q7IGNvbnN0IGR0ID0gTWF0aC5taW4oMC4wNSwgcmF3IC8gMTAwMCk7IGxhc3QgPSBub3c7IGlmICghdGhpcy5hY3RpdmUpIHJldHVybjsgaWYgKCF0aGlzLmZyb3plbikgdGhpcy5mcmFtZShkdCk7IHNjZW5lLnJlbmRlcigpOyB0aGlzLnBlcmZUaWNrKHJhdyk7IH0pO1xuICB9XG4gIC8qKiBUaGUgbmF2aWdhdGlvbiBzaGVsbCBoaWRlcyB0aGUgYmF0dGxlIHNjcmVlbiB3aGlsZSBhbm90aGVyIHRhYiBpcyBvcGVuOiBwYXVzZSB0aGUgZ2FtZSBzbyBpdCBjb3N0cyBub3RoaW5nLiAqL1xuICBwcml2YXRlIGFjdGl2ZSA9IHRydWU7XG4gIC8qKiBEZWJ1Zzoga2VlcCBkcmF3aW5nIGJ1dCBzdG9wIGFkdmFuY2luZyB0aW1lLCBzbyBhIG1vbWVudCBjYW4gYmUgc3RlcHBlZCB0aHJvdWdoIHdpdGggZnJhbWUoZHQpIGFuZCBzY3JlZW5zaG90dGVkLiAqL1xuICBmcm96ZW4gPSBmYWxzZTtcbiAgc3RlcChkdDogbnVtYmVyKSB7IHRoaXMuZnJhbWUoZHQpOyB9XG4gIHNldEFjdGl2ZShvbjogYm9vbGVhbikgeyB0aGlzLmFjdGl2ZSA9IG9uOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2NlbmUgaGVscGVyc1xuICAvKiogVGhlIHBsYWNlbWVudCBncmlkIGlzIGEgYnVpbGQtc2NyZWVuIHRvb2w6IGhpZGUgaXQgZHVyaW5nIHRoZSBmaWdodCBzbyB0aGUgYmF0dGxlIGxvb2tzIGxpa2UgYSBzY2VuZSwgbm90IGEgYm9hcmQuICovXG4gIHByaXZhdGUgc2hvd0dyaWQob246IGJvb2xlYW4pIHsgZm9yIChjb25zdCB0IG9mIHRoaXMudGlsZXMpIHQuc2V0RW5hYmxlZChvbik7IH1cbiAgcHJpdmF0ZSBtYWtlVGlsZSh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCksIHQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCd0aWxlJyArIGNlbGwsIHsgc2l6ZTogR1JJRF9TUCAqIDAuOTIgfSwgdGhpcy5zY2VuZSk7XG4gICAgdC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHQucG9zaXRpb24uc2V0KHAueCwgMC4wMTUsIHAueik7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3RtJywgdGhpcy5zY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjEyLCAwLjQyKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQyLCAwLjEyLCAwLjEyKTsgbS5hbHBoYSA9IDAuNTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB0Lm1hdGVyaWFsID0gbTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyB0Lm1ldGFkYXRhID0geyBraW5kOiAndGlsZScsIGNlbGwgfTsgdGhpcy50aWxlTWF0c1tjZWxsXSA9IG07IH0gZWxzZSB0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICByZXR1cm4gdDtcbiAgfVxuICBwcml2YXRlIHRpbnQoY2VsbDogbnVtYmVyLCBtb2RlOiAnbm9ybWFsJyB8ICdmcmVlJyB8ICdzZWwnIHwgJ3BhcnRuZXInKSB7XG4gICAgY29uc3QgbSA9IHRoaXMudGlsZU1hdHNbY2VsbF07IGNvbnN0IGMgPSB7IG5vcm1hbDogWzAuMTgsIDAuMTIsIDAuNDIsIDAuNV0sIGZyZWU6IFswLjIsIDAuNzUsIDAuNTUsIDAuN10sIHNlbDogWzEsIDAuODIsIDAuMywgMC44NV0sIHBhcnRuZXI6IFswLjg1LCAwLjM1LCAxLCAwLjg1XSB9W21vZGVdO1xuICAgIG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhjWzBdLCBjWzFdLCBjWzJdKTsgbS5hbHBoYSA9IGNbM107XG4gIH1cbiAgbGF0ZXIoc2VjOiBudW1iZXIsIGZuOiAoKSA9PiB2b2lkKSB7IHRoaXMudGltZXJzLnB1c2goeyB0OiBzZWMsIGZuIH0pOyB9XG4gIHByaXZhdGUgZnhSaW5nKHg6IG51bWJlciwgejogbnVtYmVyLCBjb2xvcjogYW55LCByMDogbnVtYmVyLCByMTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdmeCcsIHsgZGlhbWV0ZXI6IDEsIHRoaWNrbmVzczogMC4wMzUsIHRlc3NlbGxhdGlvbjogMjggfSwgdGhpcy5zY2VuZSk7IG0ucG9zaXRpb24uc2V0KHgsIDAuMDUsIHopOyBtLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBtbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2Z4bScsIHRoaXMuc2NlbmUpOyBtbS5lbWlzc2l2ZUNvbG9yID0gY29sb3I7IG1tLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG1tLmFscGhhID0gMC45OyBtLm1hdGVyaWFsID0gbW07IHRoaXMucmluZ0Z4LnB1c2goeyBtLCBtbSwgdDogMCwgcjAsIHIxLCBkdXIgfSk7XG4gIH1cbiAgcHJpdmF0ZSBidXJzdCh4OiBudW1iZXIsIHo6IG51bWJlciwgYzE6IG51bWJlcltdLCBjMjogbnVtYmVyW10sIGNvdW50OiBudW1iZXIpIHtcbiAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdiJywgNjAsIHRoaXMuc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoeCwgMC4wNSwgeik7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIDAuMDUsIDAuMik7XG4gICAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMSBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMyIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjEsIDAsIDAuMiwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMTI7IHBzLm1heFNpemUgPSAwLjM0OyBwcy5taW5MaWZlVGltZSA9IDAuNDsgcHMubWF4TGlmZVRpbWUgPSAwLjk7IHBzLmVtaXRSYXRlID0gMDsgcHMubWFudWFsRW1pdENvdW50ID0gY291bnQ7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLCAxLjMsIC0xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMSwgMi40LCAxKTtcbiAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjg7IHBzLm1heEVtaXRQb3dlciA9IDI7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIC0yLCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy50YXJnZXRTdG9wRHVyYXRpb24gPSAxLjI7IHBzLmRpc3Bvc2VPblN0b3AgPSB0cnVlOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gY2FtZXJhXG4gIHByaXZhdGUgcG9zZXMoKSB7XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3QgaGFsZiA9IEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQICsgMS40O1xuICAgIGNvbnN0IGQgPSBNYXRoLm1heChoYWxmIC8gKHRhblYgKiBhc3ApLCAoKEdSSURfUk9XUyAqIEdSSURfU1ApIC8gMiArIDIpIC8gKHRhblYgKiAwLjU1KSwgOCk7XG4gICAgY29uc3QgYmF0dGxlID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMSAqIGQsIDAuNDIgKiBkICsgMC41LCAtMC44NiAqIGQpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC4zNSwgMCkgfTtcbiAgICAvLyBCdWlsZCB2aWV3OiAoYWxtb3N0KSBzdHJhaWdodCBkb3duLCB3aXRoIHRoZSB3aG9sZSBncmlkIGluc2lkZSB0aGUgYmFuZCBiZXR3ZWVuIHRoZSB0b3AgYmFyIGFuZCB0aGUgaGFuZCBvZiBjYXJkcy5cbiAgICBjb25zdCBjeCA9IC0oRlJPTlRfWCArICgoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAvIDIpLCBIID0gTWF0aC5tYXgoMSwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KTtcbiAgICBjb25zdCBib3ggPSAoaWQ6IHN0cmluZykgPT4geyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsgcmV0dXJuIGVsICYmIGVsLm9mZnNldFBhcmVudCAhPT0gbnVsbCA/IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpIDogbnVsbDsgfTtcbiAgICBjb25zdCB0b3BCYXIgPSBib3goJ3RvcCcpLCBoYW5kID0gYm94KCdoYW5kJyksIGluZm8gPSBib3goJ2luZm8nKTtcbiAgICBjb25zdCBUT1AgPSBNYXRoLm1pbigwLjMyLCB0b3BCYXIgPyAodG9wQmFyLmJvdHRvbSArIDYpIC8gSCA6IDAuMSk7XG4gICAgY29uc3QgQk9UVE9NID0gTWF0aC5taW4oMC41LCAoSCAtIE1hdGgubWluKGhhbmQgPyBoYW5kLnRvcCA6IEgsIGluZm8gPyBpbmZvLnRvcCA6IEgpICsgNikgLyBIKTtcbiAgICBjb25zdCBiYW5kID0gTWF0aC5tYXgoMC4zLCAxIC0gVE9QIC0gQk9UVE9NKSwgY2VudGVyRnJhYyA9IFRPUCArIGJhbmQgLyAyOyAgICAgICAgICAvLyB0aGUgZ3JpZCdzIGNlbnRyZSBhcHBlYXJzIGF0IHRoaXMgZnJhY3Rpb24gZnJvbSB0aGUgdG9wXG4gICAgY29uc3QgZ3cgPSBHUklEX0NPTFMgKiBHUklEX1NQICsgMy4yLCBnaCA9IEdSSURfUk9XUyAqIEdSSURfU1AgKyAwLjU7ICAgICAgICAgICAgICAgIC8vIHRoZSB3aWR0aCBhbHNvIGxlYXZlcyByb29tIGZvciB0aGUgTmVjcm9tYW5jZXIgYmVzaWRlIHRoZSBncmlkXG4gICAgY29uc3QgZDIgPSBNYXRoLm1heChnaCAvICgyICogdGFuViAqIGJhbmQpLCBndyAvICgyICogdGFuViAqIGFzcCAqIDAuODgpLCA0LjUpO1xuICAgIGNvbnN0IHNoaWZ0ID0gKDAuNSAtIGNlbnRlckZyYWMpICogMiAqIGQyICogdGFuViwgYnggPSBjeCAtIDAuNjtcbiAgICBjb25zdCBidWlsZCA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCBkMiwgLXNoaWZ0IC0gMC4xICogZDIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIDAsIC1zaGlmdCkgfTtcbiAgICBjb25zdCBuZWNybyA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJhdHRsZS5wb3MueCAtIDEuNCwgYmF0dGxlLnBvcy55ICogMS4xMiwgYmF0dGxlLnBvcy56ICogMS4xMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygtMS40LCAwLjM1LCAwKSB9OyAgIC8vIHJlc3VsdCBjdXRzY2VuZXM6IGhpbSBhbmQgdGhlIGZpZWxkXG4gICAgcmV0dXJuIHsgYmF0dGxlLCBidWlsZCwgbmVjcm8gfTtcbiAgfVxuICAvKiogVGhlIGhhbmQgLyBpbmZvIGJhciBjYW4gY2hhbmdlIHNpemUgaW4gdGhlIGJ1aWxkIHBoYXNlIChsb25nIGFiaWxpdHkgdGV4dCwgbW9yZSBjYXJkcyk6IHJlLWZyYW1lIHNvIHRoZSBncmlkIG5ldmVyIGhpZGVzIGJlaGluZCBpdC4gKi9cbiAgcmVmcmFtZUJ1aWxkKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8IHRoaXMuY2FtVCA8IDEgfHwgdGhpcy5jaW5lIHx8ICF0aGlzLmNhbnZhcykgcmV0dXJuO1xuICAgIGNvbnN0IHAgPSB0aGlzLnBvc2VzKCkuYnVpbGQsIGMgPSB0aGlzLmNhbWVyYS5wb3NpdGlvbjtcbiAgICBpZiAoIWlzRmluaXRlKHAucG9zLngpIHx8IEJBQllMT04uVmVjdG9yMy5EaXN0YW5jZShjLCBwLnBvcykgPCAwLjA2KSByZXR1cm47XG4gICAgdGhpcy50d2VlbkNhbShwLCAwLjM1KTtcbiAgfVxuICBwcml2YXRlIGNhbnZhcyE6IEhUTUxDYW52YXNFbGVtZW50OyBwcml2YXRlIGxhc3RXID0gMDsgcHJpdmF0ZSBsYXN0SCA9IDA7IGxhc3RUYXBJbmZvID0gJyhubyB0YXBzIHlldCknO1xuICBwcml2YXRlIGhhbmRsZVJlc2l6ZSgpIHtcbiAgICBpZiAoIXRoaXMuY2FudmFzLmNsaWVudFdpZHRoIHx8ICF0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpIHJldHVybjsgICAvLyBoaWRkZW4gYmVoaW5kIGFub3RoZXIgdGFiXG4gICAgdGhpcy5lbmdpbmUucmVzaXplKCk7IHRoaXMubGFzdFcgPSB0aGlzLmNhbnZhcy5jbGllbnRXaWR0aDsgdGhpcy5sYXN0SCA9IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyAmJiB0aGlzLmNhbVQgPj0gMSkgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgfVxuICAvKiogQSB0YXAgb24gdGhlIDNEIHZpZXc6IHBpY2sgYSB0aWxlIG9yIGEgdW5pdC4gKi9cbiAgcHJpdmF0ZSB0YXAoeDogbnVtYmVyLCB5OiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gdGhpcy5zY2VuZS5waWNrKHgsIHksIChtOiBhbnkpID0+ICEhKG0ubWV0YWRhdGEgJiYgbS5tZXRhZGF0YS5raW5kKSk7XG4gICAgY29uc3QgbWQgPSBwICYmIHAuaGl0ID8gcC5waWNrZWRNZXNoLm1ldGFkYXRhIDogbnVsbDtcbiAgICB0aGlzLmxhc3RUYXBJbmZvID0gYHRhcCAke01hdGgucm91bmQoeCl9LCR7TWF0aC5yb3VuZCh5KX0gb2YgJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IC0+ICR7bWQgPyAobWQua2luZCA9PT0gJ3RpbGUnID8gJ3RpbGUgJyArIG1kLmNlbGwgOiAndW5pdCcpIDogJ25vdGhpbmcnfSAocGhhc2UgJHt0aGlzLnBoYXNlfSlgO1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICFtZCkgcmV0dXJuO1xuICAgIGlmIChtZC5raW5kID09PSAndGlsZScpIHRoaXMub25UaWxlKG1kLmNlbGwpOyBlbHNlIGlmIChtZC5raW5kID09PSAndW5pdCcpIHRoaXMub25Vbml0VmlzdWFsKG1kLnZpc3VhbCk7XG4gIH1cbiAgcHJpdmF0ZSBzZXRDYW0ocDogYW55KSB7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNvcHlGcm9tKHAucG9zKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHAudGd0LmNsb25lKCkpOyB9XG4gIHByaXZhdGUgdHdlZW5DYW0odG86IGFueSwgZHVyOiBudW1iZXIpIHsgdGhpcy5jYW1Gcm9tID0geyBwb3M6IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNsb25lKCksIHRndDogdGhpcy5jYW1lcmEuZ2V0VGFyZ2V0KCkuY2xvbmUoKSB9OyB0aGlzLmNhbVRvID0gdG87IHRoaXMuY2FtVCA9IDA7IHRoaXMuY2FtRHVyID0gZHVyOyB9XG5cbiAgLy8gLS0tLSBiYXR0bGUgY2FtZXJhOiBmb2xsb3dzIHRoZSBmaWdodGVycyB0aGF0IGFyZSBzdGlsbCBhbGl2ZSwgc28gdGhlIGFjdGlvbiAoYW5kIHRoZSBwdXJwbGUgZXllcykgc3RheXMgbGFyZ2Ugb24gc2NyZWVuXG4gIGNhbU1vZGU6ICdjbG9zZScgfCAnd2lkZScgPSAnY2xvc2UnOyBwcml2YXRlIGNhbVRndDogYW55ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIDApO1xuICBzZXRDYW1Nb2RlKG06ICdjbG9zZScgfCAnd2lkZScpIHtcbiAgICB0aGlzLmNhbU1vZGUgPSBtO1xuICAgIGlmIChtID09PSAnd2lkZScgJiYgdGhpcy5iYXR0bGUpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMC45KTtcbiAgICB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgZnJhbWVCYXR0bGUoZHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTsgaWYgKCFiKSByZXR1cm47IGNvbnN0IGFsaXZlID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAoIWFsaXZlLmxlbmd0aCkgcmV0dXJuO1xuICAgIGxldCB4MCA9IDFlOSwgeDEgPSAtMWU5LCB6MCA9IDFlOSwgejEgPSAtMWU5OyBmb3IgKGNvbnN0IGYgb2YgYWxpdmUpIHsgeDAgPSBNYXRoLm1pbih4MCwgZi54KTsgeDEgPSBNYXRoLm1heCh4MSwgZi54KTsgejAgPSBNYXRoLm1pbih6MCwgZi56KTsgejEgPSBNYXRoLm1heCh6MSwgZi56KTsgfVxuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IHdpZGUgPSB0aGlzLnBvc2VzKCkuYmF0dGxlLCBjeCA9ICh4MCArIHgxKSAvIDIsIGN6ID0gKHowICsgejEpIC8gMjtcbiAgICBjb25zdCBkID0gTWF0aC5taW4oTWF0aC5tYXgoKHgxIC0geDAgKyAzLjQpIC8gKDIgKiB0YW5WICogYXNwICogMC45KSwgKHoxIC0gejAgKyAzLjIpIC8gKDIgKiB0YW5WICogMC42MiksIDUuNCksIE1hdGguaHlwb3Qod2lkZS5wb3MueSwgd2lkZS5wb3MueikpO1xuICAgIGNvbnN0IHRndCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3gsIDAuNTUsIGN6KSwgcG9zID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCAtIDAuMDYgKiBkLCAwLjMyICogZCArIDAuNSwgY3ogLSAwLjkgKiBkKTtcbiAgICBjb25zdCBrID0gMSAtIE1hdGguZXhwKC1kdCAqIDIuMCk7XG4gICAgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbWVyYS5wb3NpdGlvbiwgcG9zLCBrKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbVRndCwgdGd0LCBrKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhZ2UgZmxvd1xuICAvKiogV3JpdGUgdGhlIHJ1biB0byBkaXNrIChjYWxtIG1vbWVudHMgb25seTogYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0KS4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0UnVuKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMpIHJldHVybjtcbiAgICAgIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgeyBjbGVhclJ1bigpOyByZXR1cm47IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnICYmIHRoaXMucGhhc2UgIT09ICdkcmFmdCcpIHJldHVybjtcbiAgICAgIGNvbnN0IHNuYXA6IFJ1blNuYXBzaG90ID0geyB2OiAxLCBzZWVkOiB0aGlzLnNlZWQsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgc3RhZ2U6IGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5TmFtZSwgcGhhc2U6IHRoaXMucGhhc2UsIGRyYWZ0OiB0aGlzLnBoYXNlID09PSAnZHJhZnQnID8gdGhpcy5kcmFmdCA6IG51bGwsIHN0YXRlOiBzZXJpYWxpemVTdGF0ZShzKSwgc3RhcnRCZXN0OiB0aGlzLmVuZGxlc3M/LnN0YXJ0QmVzdCB9O1xuICAgICAgc2F2ZVJ1bihzbmFwKTtcbiAgICB9IGNhdGNoIHsgLyogbmV2ZXIgbGV0IHNhdmluZyBicmVhayB0aGUgZ2FtZSAqLyB9XG4gIH1cbiAgLyoqIFJlYnVpbGQgdGhlIHNjcmVlbiBmcm9tIGEgc2F2ZWQgcnVuIChhIHJlbG9hZCwgb3IgU2FmYXJpIGRpc2NhcmRpbmcgdGhlIHBhZ2UpLiAqL1xuICBwcml2YXRlIHJlc3RvcmUocjogeyBzbmFwOiBSdW5TbmFwc2hvdDsgc3RhdGU6IFN0YXRlIH0pIHtcbiAgICBjb25zdCB7IHNuYXAsIHN0YXRlIH0gPSByO1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLmZsdXNoVHdlZW5zKCk7IHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5kYWlseSA9IG51bGw7XG4gICAgaWYgKHNuYXAuc3RhZ2UgPT09IERBSUxZX0lEICYmIGlzVmFsaWREYXkoK3NuYXAuZGlmZmljdWx0eSkpIHsgY29uc3QgZGF5ID0gK3NuYXAuZGlmZmljdWx0eSwgbW9kID0gbW9kaWZpZXJGb3IoZGF5KTsgc2V0RGFpbHkobW9kLCBkYXkpOyB0aGlzLmRhaWx5ID0geyBkYXksIG1vZCB9OyB0aGlzLmVuZGxlc3MgPSBudWxsOyB0aGlzLmFyZW5hLnNldFRoZW1lKCdjcnlwdCcpOyB9XG4gICAgZWxzZSBpZiAoc25hcC5zdGFnZSA9PT0gRU5ETEVTU19JRCkgeyBzZXRFbmRsZXNzKCk7IGNvbnN0IGRvbmUgPSBNYXRoLm1heCgwLCBzdGF0ZS53YXZlIC0gMSk7IHRoaXMuZW5kbGVzcyA9IHsgc3RhcnRCZXN0OiBzbmFwLnN0YXJ0QmVzdCA/PyBsb2FkU2F2ZSgpLmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogZG9uZSwgcGFja3M6IE1hdGguZmxvb3IoZG9uZSAvIEVORExFU1NfUEFDS19FVkVSWSkgfTsgfSBlbHNlIHsgc2V0U3RhZ2VEaWZmaWN1bHR5KHNuYXAuc3RhZ2UsIHNuYXAuZGlmZmljdWx0eSk7IHRoaXMuZW5kbGVzcyA9IG51bGw7IH1cbiAgICBpZiAoIXRoaXMuZGFpbHkpIHRoaXMuYXJlbmEuc2V0VGhlbWUoY3VycmVudFN0YWdlSWQpO1xuICAgIHRoaXMuc2VlZCA9IHNuYXAuc2VlZDsgdGhpcy5hdHRlbXB0ID0gc25hcC5hdHRlbXB0OyB0aGlzLnMgPSBzdGF0ZTsgdGhpcy5zZWVuTWVyZ2VzID0gc3RhdGUuc3RhdHMubWVyZ2VzO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IHNuYXAucGhhc2UgPT09ICdkcmFmdCcgPyBzbmFwLmRyYWZ0IDogbnVsbDsgdGhpcy5waGFzZSA9IHRoaXMuZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJzsgdGhpcy5zaG93R3JpZCh0aGlzLnBoYXNlID09PSAnYnVpbGQnKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KGBSdW4gcmVzdG9yZWQ6IHdhdmUgJHtpc0VuZGxlc3MoKSA/IHN0YXRlLndhdmUgOiBzdGF0ZS53YXZlICsgJy8nICsgc3RhZ2VXYXZlcyhzdGF0ZSl9LCAke3N0YXRlLmhlYXJ0c30gaGVhcnQke3N0YXRlLmhlYXJ0cyA9PT0gMSA/ICcnIDogJ3MnfS5gKTtcbiAgfVxuXG4gIC8vIC0tLS0gcGVyZm9ybWFuY2UgcmVhZG91dDogcm9sbGluZyBmcmFtZSBzdGF0cywgcGVyLWJhdHRsZSBzdW1tYXJpZXMsIG9wdGlvbmFsIG9uLXNjcmVlbiBGUFMsIGFuZCBhIHBhc3RlLWZyaWVuZGx5IHJlcG9ydFxuICBzaG93RnBzID0gZmFsc2U7IHBlcmZOb3cgPSB7IGZwczogMCwgYXZnOiAwLCBwOTU6IDAsIHdvcnN0OiAwIH07IHBlcmZMb2c6IGFueVtdID0gW107XG4gIHByaXZhdGUgcGVyZkJ1ZiA9IG5ldyBGbG9hdDMyQXJyYXkoMjQwKTsgcHJpdmF0ZSBwZXJmTiA9IDA7IHByaXZhdGUgcGVyZkkgPSAwOyBwcml2YXRlIHBlcmZTaG93bkF0ID0gMDsgcHJpdmF0ZSBpbnN0cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBmcHNIdWQ6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY3VyQmF0dGxlOiB7IGZyYW1lczogbnVtYmVyOyBzdW06IG51bWJlcjsgd29yc3Q6IG51bWJlcjsgc2xvdzogbnVtYmVyOyBzY2FsZTogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgc2V0U2hvd0ZwcyhvbjogYm9vbGVhbikge1xuICAgIHRoaXMuc2hvd0ZwcyA9IG9uO1xuICAgIGlmIChvbiAmJiAhdGhpcy5mcHNIdWQpIHsgY29uc3QgaCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBoLmlkID0gJ2Zwc0h1ZCc7IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYmF0dGxlSG9zdCcpIHx8IGRvY3VtZW50LmJvZHkpLmFwcGVuZENoaWxkKGgpOyB0aGlzLmZwc0h1ZCA9IGg7IH1cbiAgICBpZiAodGhpcy5mcHNIdWQpIHRoaXMuZnBzSHVkLnN0eWxlLmRpc3BsYXkgPSBvbiA/ICdibG9jaycgOiAnbm9uZSc7XG4gIH1cbiAgcHJpdmF0ZSBwZXJmVGljayhtczogbnVtYmVyKSB7XG4gICAgaWYgKG1zID4gNTAwKSByZXR1cm47ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSB0YWIgd2FzIGhpZGRlbiBvciB0aGUgcGhvbmUgcGF1c2VkIHVzOiBub3QgYSByZWFsIGZyYW1lXG4gICAgdGhpcy5wZXJmQnVmW3RoaXMucGVyZkldID0gbXM7IHRoaXMucGVyZkkgPSAodGhpcy5wZXJmSSArIDEpICUgdGhpcy5wZXJmQnVmLmxlbmd0aDsgdGhpcy5wZXJmTiA9IE1hdGgubWluKHRoaXMucGVyZkJ1Zi5sZW5ndGgsIHRoaXMucGVyZk4gKyAxKTtcbiAgICBjb25zdCBjID0gdGhpcy5jdXJCYXR0bGU7XG4gICAgaWYgKGMgJiYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykpIHsgYy5mcmFtZXMrKzsgYy5zdW0gKz0gbXM7IGlmIChtcyA+IGMud29yc3QpIGMud29yc3QgPSBtczsgaWYgKG1zID4gMzMuNCkgYy5zbG93Kys7IGMuc2NhbGUgPSBNYXRoLm1heChjLnNjYWxlLCB0aGlzLnRpbWVTY2FsZSk7IH1cbiAgICBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKTsgaWYgKG5vdyAtIHRoaXMucGVyZlNob3duQXQgPCA1MDApIHJldHVybjsgdGhpcy5wZXJmU2hvd25BdCA9IG5vdztcbiAgICBjb25zdCBhID0gQXJyYXkuZnJvbSh0aGlzLnBlcmZCdWYuc3ViYXJyYXkoMCwgdGhpcy5wZXJmTikpLnNvcnQoKHgsIHkpID0+IHggLSB5KSwgYXZnID0gYS5yZWR1Y2UoKG4sIHgpID0+IG4gKyB4LCAwKSAvIGEubGVuZ3RoO1xuICAgIHRoaXMucGVyZk5vdyA9IHsgZnBzOiAxMDAwIC8gYXZnLCBhdmcsIHA5NTogYVtNYXRoLmZsb29yKGEubGVuZ3RoICogMC45NSldID8/IDAsIHdvcnN0OiBhW2EubGVuZ3RoIC0gMV0gPz8gMCB9O1xuICAgIGlmICh0aGlzLmZwc0h1ZCAmJiB0aGlzLnNob3dGcHMpIHRoaXMuZnBzSHVkLnRleHRDb250ZW50ID0gYCR7dGhpcy5wZXJmTm93LmZwcy50b0ZpeGVkKDApfSBmcHMgICR7dGhpcy5wZXJmTm93LmF2Zy50b0ZpeGVkKDEpfW1zICBzbG93NSUgJHt0aGlzLnBlcmZOb3cucDk1LnRvRml4ZWQoMCl9bXNgO1xuICAgIHRoaXMudWkucmVuZGVyRGVidWdMaXZlKCk7XG4gIH1cbiAgcHJpdmF0ZSBiZWdpbkJhdHRsZVBlcmYoKSB7IHRoaXMuY3VyQmF0dGxlID0geyBmcmFtZXM6IDAsIHN1bTogMCwgd29yc3Q6IDAsIHNsb3c6IDAsIHNjYWxlOiB0aGlzLnRpbWVTY2FsZSB9OyB9XG4gIHByaXZhdGUgZW5kQmF0dGxlUGVyZigpIHtcbiAgICBjb25zdCBjID0gdGhpcy5jdXJCYXR0bGU7IHRoaXMuY3VyQmF0dGxlID0gbnVsbDsgaWYgKCFjIHx8ICFjLmZyYW1lcykgcmV0dXJuO1xuICAgIHRoaXMucGVyZkxvZy5wdXNoKHsgd2F2ZTogdGhpcy5zLndhdmUsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgc3BlZWQ6IGMuc2NhbGUsIGZpZ2h0ZXJzOiB0aGlzLmJhdHRsZSA/IHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmxlbmd0aCA6IDAsIGZwczogKygxMDAwIC8gKGMuc3VtIC8gYy5mcmFtZXMpKS50b0ZpeGVkKDApLCB3b3JzdE1zOiArYy53b3JzdC50b0ZpeGVkKDApLCBzbG93UGN0OiArKCgxMDAgKiBjLnNsb3cpIC8gYy5mcmFtZXMpLnRvRml4ZWQoMSkgfSk7XG4gICAgaWYgKHRoaXMucGVyZkxvZy5sZW5ndGggPiAxMikgdGhpcy5wZXJmTG9nLnNoaWZ0KCk7XG4gIH1cbiAgcGVyZkluZm8oKSB7XG4gICAgY29uc3Qgc2MgPSB0aGlzLnNjZW5lOyBpZiAoIXRoaXMuaW5zdHIgJiYgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbikgdGhpcy5pbnN0ciA9IG5ldyBCQUJZTE9OLlNjZW5lSW5zdHJ1bWVudGF0aW9uKHNjKTtcbiAgICByZXR1cm4geyAuLi50aGlzLnBlcmZOb3csIG1lc2hlczogc2MuZ2V0QWN0aXZlTWVzaGVzKCkubGVuZ3RoLCBwYXJ0aWNsZXM6IHNjLnBhcnRpY2xlU3lzdGVtcy5sZW5ndGgsIGRyYXdzOiB0aGlzLmluc3RyID8gdGhpcy5pbnN0ci5kcmF3Q2FsbHNDb3VudGVyLmN1cnJlbnQgOiAtMSB9O1xuICB9XG4gIHBlcmZSZXBvcnQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBwID0gdGhpcy5wZXJmSW5mbygpLCBnbDogYW55ID0gdGhpcy5lbmdpbmUuZ2V0R2xJbmZvID8gdGhpcy5lbmdpbmUuZ2V0R2xJbmZvKCkgOiB7fTtcbiAgICBjb25zdCByb3dzID0gdGhpcy5wZXJmTG9nLm1hcCgocikgPT4gYCAgd2F2ZSAke3Iud2F2ZX0gdHJ5ICR7ci5hdHRlbXB0fSBhdCAke3Iuc3BlZWR9eDogJHtyLmZwc30gZnBzIGF2ZXJhZ2UsIHdvcnN0IGZyYW1lICR7ci53b3JzdE1zfW1zLCAke3Iuc2xvd1BjdH0lIHNsb3cgZnJhbWVzLCAke3IuZmlnaHRlcnN9IGZpZ2h0ZXJzYCk7XG4gICAgcmV0dXJuIFtgUEVSRiAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1gLCBgZGV2aWNlOiAke25hdmlnYXRvci51c2VyQWdlbnR9YCwgYGdwdTogJHtnbC5yZW5kZXJlciB8fCAnPyd9ICgke2dsLnZlbmRvciB8fCAnPyd9KWAsXG4gICAgICBgc2NyZWVuICR7c2NyZWVuLndpZHRofXgke3NjcmVlbi5oZWlnaHR9ICB2aWV3cG9ydCAke2lubmVyV2lkdGh9eCR7aW5uZXJIZWlnaHR9ICBkcHIgJHtkZXZpY2VQaXhlbFJhdGlvfSAgcmVuZGVyICR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKX14JHt0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKX0gIHNjYWxpbmcgbGV2ZWwgJHt0aGlzLmVuZ2luZS5nZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgpLnRvRml4ZWQoMil9YCxcbiAgICAgIGBub3c6ICR7cC5mcHMudG9GaXhlZCgwKX0gZnBzLCBhdmVyYWdlICR7cC5hdmcudG9GaXhlZCgxKX1tcywgc2xvd2VzdCA1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMsIHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIHwgYWN0aXZlIG1lc2hlcyAke3AubWVzaGVzfSwgcGFydGljbGUgc3lzdGVtcyAke3AucGFydGljbGVzfSwgZHJhdyBjYWxscyAke3AuZHJhd3N9YCxcbiAgICAgIGBzdGF0ZTogcGhhc2UgJHt0aGlzLnBoYXNlfSwgc3BlZWQgJHt0aGlzLnRpbWVTY2FsZX14LCBjYW1lcmEgJHt0aGlzLmNhbU1vZGV9LCBkaWZmaWN1bHR5ICR7ZGlmZmljdWx0eU5hbWV9LCB3YXZlICR7dGhpcy5zLndhdmV9LCB1bml0cyAke3RoaXMucy51bml0cy5sZW5ndGh9YCxcbiAgICAgIGBiYXR0bGVzIChuZXdlc3QgbGFzdCk6YCwgLi4uKHJvd3MubGVuZ3RoID8gcm93cyA6IFsnICAobm9uZSB5ZXQ6IHBsYXkgYSBiYXR0bGUsIHRoZW4gY29weSB0aGlzIGFnYWluKSddKV0uam9pbignXFxuJyk7XG4gIH1cblxuICAvKiogQSBydW4gdGhlIHBsYXllciBoYXMgcmVhbGx5IHN0YXJ0ZWQgKHNvIEhvbWUgY2FuIG9mZmVyIENvbnRpbnVlKS4gTnVsbCBhZnRlciBhIHN0YWdlIHdhcyB3b24gb3IgbG9zdCwgb3IgYmVmb3JlIGFueXRoaW5nIHdhcyBkb25lLiAqL1xuICBydW5JbmZvKCkgeyBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMgfHwgcy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBudWxsOyByZXR1cm4gKHMud2F2ZSA+IDEgfHwgcy51bml0cy5sZW5ndGggPiAwIHx8IHRoaXMuYXR0ZW1wdCA+IDAgfHwgcy5zdGF0cy5mYWlsdXJlcyA+IDApID8geyB3YXZlOiBzLndhdmUsIHRvdGFsOiBzdGFnZVdhdmVzKHMpLCBoZWFydHM6IHMuaGVhcnRzLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5TmFtZSwgc3RhZ2U6IGN1cnJlbnRTdGFnZUlkIH0gOiBudWxsOyB9XG4gIC8qKiBGcmVzaCBydW4gd2l0aCB0aGUgY3VycmVudGx5IGVxdWlwcGVkIFNvdWwgRGVjayAoSG9tZSA+IFN0YXJ0IEJhdHRsZSBjYWxscyB0aGlzKS4gKi9cbiAgLyoqIEdpdmUgdXAgdGhlIHJ1biBpbiBwcm9ncmVzcyAoSG9tZSA+IE5ldyBiYXR0bGUsIGFmdGVyIHRoZSBwbGF5ZXIgY29uZmlybXMpOiB0aGUgc2F2ZWQgcnVuIGlzIGRyb3BwZWQgYW5kIEhvbWUgbGV0cyB0aGVtIHBpY2sgYW55IHN0YWdlIG9yIG1vZGUuIEdvbGQgYW5kIHBhY2tzIGFscmVhZHkgZWFybmVkIHN0YXkuICovXG4gIGFiYW5kb25SdW4oKSB7IHRoaXMuc3RhcnRTdGFnZShNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IGNsZWFyUnVuKCk7IH1cbiAgbmV3UnVuKCkgeyB0aGlzLnN0YXJ0U3RhZ2UobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnc2VlZCcpID8gdGhpcy5zZWVkIDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMWU2KSArIDEpOyB9XG4gIHN0YXJ0U3RhZ2Uoc2VlZDogbnVtYmVyKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucmV3YXJkID0gbnVsbDsgdGhpcy5mbHVzaFR3ZWVucygpOyBpZiAodGhpcy5uZWNybykgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICB0aGlzLnJ1bkdvbGQgPSAwOyB0aGlzLmxhc3RHb2xkID0gMDsgdGhpcy5kYWlseSA9IG51bGw7IHRoaXMuZGFpbHlSZXdhcmQgPSBudWxsOyB0aGlzLnNlZWQgPSBzZWVkOyB0aGlzLmF0dGVtcHQgPSAwOyB0aGlzLmVuZGxlc3MgPSBudWxsOyBjb25zdCBzdiA9IGxvYWRTYXZlKCksIHBsID0gcGxheWFibGUoc3YpOyBzZXRTdGFnZURpZmZpY3VsdHkocGwuc3RhZ2UsIHBsLmRpZmZpY3VsdHkpOyB0aGlzLmFyZW5hLnNldFRoZW1lKGN1cnJlbnRTdGFnZUlkKTsgdGhpcy5zID0gbmV3U3RhZ2UoeyAuLi5QUk9UT1RZUEVfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpOyAgIC8vIChhIGJhdHRsZSBsZWZ0IGhhbGYtd2F5IGhhZCBoaWRkZW4gdGhlIGdyaWQpXG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KCdTdGFnZSBzdGFydDogNCBjYXJkcywgJyArIHRoaXMucy5jYXAgKyAnIERvbWluaW9uLiBTdW1tb24sIG1lcmdlLCB0aGVuIHByZXNzIEJBVFRMRS4nKTtcbiAgfVxuICAvKiogVG9kYXkncyBEYWlseSBDaGFsbGVuZ2UgKEhvbWUgPiBEYWlseSBDaGFsbGVuZ2UpOiB0aGUgc2FtZSBzZWVkIGFuZCB0d2lzdCBmb3IgZXZlcnlvbmUgb24gdGhlIHNhbWUgZGF5LiBSZXRyeSBhcyBvZnRlbiBhcyB5b3UgbGlrZTsgdGhlIHJld2FyZCBpcyBwYWlkIG9uY2UuICovXG4gIG5ld0RhaWx5KCkgeyB0aGlzLnN0YXJ0RGFpbHkoZGF5TnVtYmVyKCkpOyB9XG4gIHN0YXJ0RGFpbHkoZGF5OiBudW1iZXIpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5yZXdhcmQgPSBudWxsOyB0aGlzLmZsdXNoVHdlZW5zKCk7IGlmICh0aGlzLm5lY3JvKSB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIGNvbnN0IG1vZCA9IG1vZGlmaWVyRm9yKGRheSksIHN2ID0gbG9hZFNhdmUoKTsgc2V0RGFpbHkobW9kLCBkYXkpOyB0aGlzLmFyZW5hLnNldFRoZW1lKCdjcnlwdCcpO1xuICAgIHRoaXMucnVuR29sZCA9IDA7IHRoaXMubGFzdEdvbGQgPSAwOyB0aGlzLmRhaWx5UmV3YXJkID0gbnVsbDsgdGhpcy5lbmRsZXNzID0gbnVsbDsgdGhpcy5kYWlseSA9IHsgZGF5LCBtb2QgfTsgdGhpcy5zZWVkID0gZGF5OyB0aGlzLmF0dGVtcHQgPSAwO1xuICAgIHRoaXMucyA9IG5ld1N0YWdlKGRhaWx5UnVsZXMobW9kLCBzdi5kZWNrKSwgdGhpcy5zZWVkKTsgdGhpcy5zZWVuTWVyZ2VzID0gMDtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KGBEYWlseSBDaGFsbGVuZ2U6ICR7bW9kLm5hbWV9LiAke21vZC50ZXh0fWApO1xuICB9XG4gIC8qKiBGcmVzaCBFbmRsZXNzIERlcHRocyBydW4gKEhvbWUgPiBFbmRsZXNzIERlcHRocyBjYWxscyB0aGlzKTogc2FtZSBydWxlcyBhcyBhIHN0YWdlLCBidXQgdGhlIHdhdmVzIG5ldmVyIHN0b3AgYW5kIHRoZSBlbmVteSBrZWVwcyBncm93aW5nLiAqL1xuICBuZXdFbmRsZXNzKCkgeyB0aGlzLnN0YXJ0RW5kbGVzcyhuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdzZWVkJykgPyB0aGlzLnNlZWQgOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IH1cbiAgc3RhcnRFbmRsZXNzKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5ydW5Hb2xkID0gMDsgdGhpcy5sYXN0R29sZCA9IDA7IHRoaXMuZGFpbHkgPSBudWxsOyB0aGlzLmRhaWx5UmV3YXJkID0gbnVsbDsgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpOyBzZXRFbmRsZXNzKCk7IHRoaXMuYXJlbmEuc2V0VGhlbWUoRU5ETEVTU19JRCk7XG4gICAgdGhpcy5lbmRsZXNzID0geyBzdGFydEJlc3Q6IHN2LmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogMCwgcGFja3M6IDAgfTtcbiAgICB0aGlzLnMgPSBuZXdTdGFnZSh7IC4uLkVORExFU1NfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpOyAgIC8vIChhIGJhdHRsZSBsZWZ0IGhhbGYtd2F5IGhhZCBoaWRkZW4gdGhlIGdyaWQpXG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KCdFbmRsZXNzIERlcHRoczogaG93IGRlZXAgY2FuIHlvdSBnbz8gQSBTb3VsIFBhY2sgZXZlcnkgMTAgd2F2ZXMuJyk7XG4gIH1cbiAgcHJpdmF0ZSBjbGVhckJhdHRsZSgpIHtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYuZGlzcG9zZSgpOyB9KTsgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTsgdGhpcy5iYXR0bGUgPSBudWxsO1xuICAgIHRoaXMuYXJyb3dzLmZvckVhY2goKGEpID0+IGEubWVzaC5kaXNwb3NlKCkpOyB0aGlzLmFycm93cyA9IFtdO1xuICB9XG4gIHByaXZhdGUgcG9zKGNlbGw6IG51bWJlcikgeyByZXR1cm4gY2VsbFBvcygwLCBjZWxsKTsgfVxuICAvKiogRm9yIHRoZSB0dXRvcmlhbCBzcG90bGlnaHQ6IHdoZXJlIGFuIGVtcHR5IHRpbGUgKHRoZSBvbmUgbmVhcmVzdCB0aGUgbWlkZGxlIG9mIHRoZSBncmlkKSBpcyBvbiB0aGUgc2NyZWVuLCBpbiBDU1MgcGl4ZWxzLCBvciBudWxsLiAqL1xuICBlbXB0eVRpbGVSZWN0KCk6IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHc6IG51bWJlcjsgaDogbnVtYmVyIH0gfCBudWxsIHtcbiAgICBpZiAoIXRoaXMucyB8fCAhdGhpcy5jYW52YXMgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgdXNlZCA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodTogYW55KSA9PiB1LmNlbGwpKTsgbGV0IG14ID0gMCwgbXogPSAwOyBjb25zdCBhbGwgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBHUklEX0NFTExTIH0sIChfLCBjKSA9PiB0aGlzLnBvcyhjKSk7IGFsbC5mb3JFYWNoKChwKSA9PiB7IG14ICs9IHAueCAvIEdSSURfQ0VMTFM7IG16ICs9IHAueiAvIEdSSURfQ0VMTFM7IH0pO1xuICAgIGxldCBiZXN0ID0gLTEsIGJkID0gMWU5OyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBpZiAodXNlZC5oYXMoYykpIGNvbnRpbnVlOyBjb25zdCBkID0gTWF0aC5oeXBvdChhbGxbY10ueCAtIG14LCBhbGxbY10ueiAtIG16KTsgaWYgKGQgPCBiZCkgeyBiZCA9IGQ7IGJlc3QgPSBjOyB9IH1cbiAgICBpZiAoYmVzdCA8IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHAgPSBhbGxbYmVzdF0sIGggPSBHUklEX1NQICogMC40NiwgVyA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCksIEggPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdnAgPSB0aGlzLmNhbWVyYS52aWV3cG9ydC50b0dsb2JhbChXLCBIKSwgbSA9IHRoaXMuc2NlbmUuZ2V0VHJhbnNmb3JtTWF0cml4KCk7XG4gICAgY29uc3QgcHRzID0gW1staCwgLWhdLCBbaCwgLWhdLCBbaCwgaF0sIFstaCwgaF1dLm1hcCgoW2R4LCBkel0pID0+IEJBQllMT04uVmVjdG9yMy5Qcm9qZWN0KG5ldyBCQUJZTE9OLlZlY3RvcjMocC54ICsgZHgsIDAuMDIsIHAueiArIGR6KSwgQkFCWUxPTi5NYXRyaXguSWRlbnRpdHkoKSwgbSwgdnApKTtcbiAgICBjb25zdCByID0gdGhpcy5jYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCksIGt4ID0gci53aWR0aCAvIFcsIGt5ID0gci5oZWlnaHQgLyBILCB4cyA9IHB0cy5tYXAoKHE6IGFueSkgPT4gcS54KSwgeXMgPSBwdHMubWFwKChxOiBhbnkpID0+IHEueSk7XG4gICAgY29uc3QgeDAgPSBNYXRoLm1pbiguLi54cyksIHgxID0gTWF0aC5tYXgoLi4ueHMpLCB5MCA9IE1hdGgubWluKC4uLnlzKSwgeTEgPSBNYXRoLm1heCguLi55cyk7XG4gICAgaWYgKCFpc0Zpbml0ZSh4MCArIHgxICsgeTAgKyB5MSkpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IHg6IHIubGVmdCArIHgwICoga3gsIHk6IHIudG9wICsgeTAgKiBreSwgdzogKHgxIC0geDApICoga3gsIGg6ICh5MSAtIHkwKSAqIGt5IH07XG4gIH1cbiAgc3luY0J1aWxkKCkge1xuICAgIHRoaXMucGVyc2lzdFJ1bigpO1xuICAgIGNvbnN0IG1lcmdlZCA9IHRoaXMucy5zdGF0cy5tZXJnZXMgPiB0aGlzLnNlZW5NZXJnZXM7IHRoaXMuc2Vlbk1lcmdlcyA9IHRoaXMucy5zdGF0cy5tZXJnZXM7XG4gICAgY29uc3QgZ3Jvd24gPSBtZXJnZWQgPyB0aGlzLnMudW5pdHMuZmluZCgodSkgPT4geyBjb25zdCBndiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IHJldHVybiAhIWd2ICYmIGd2LnN0YXIgIT09IHUuc3RhcjsgfSkgOiB1bmRlZmluZWQ7ICAgLy8gdGhlIHVuaXQgdGhhdCBqdXN0IGdhaW5lZCBhIHN0YXJcbiAgICBjb25zdCBhbGl2ZSA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gdS5pZCkpO1xuICAgIGZvciAoY29uc3QgW2lkLCB2XSBvZiB0aGlzLnVuaXRWaXMpIGlmICghYWxpdmUuaGFzKGlkKSkge1xuICAgICAgdGhpcy52aXNUb1VuaXQuZGVsZXRlKHYpOyB0aGlzLnVuaXRWaXMuZGVsZXRlKGlkKTsgY29uc3QgcCA9IHYuaG9sZGVyLnBvc2l0aW9uO1xuICAgICAgaWYgKGdyb3duKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbWVyZ2U6IHRoZSBjb25zdW1lZCB1bml0IGlzIGRyYXduIGludG8gdGhlIHN1cnZpdm9yIGFuZCB2YW5pc2hlcyBpbiBhIGZsYXNoXG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3MoZ3Jvd24uY2VsbCksIHgwID0gcC54LCB6MCA9IHAueiwgc2MgPSB2LmhvbGRlci5zY2FsaW5nLng7IHYucGxheSgnaWRsZScpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuMzMsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC40LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHNjICogKDEgLSAwLjc1ICogdCkpOyB9LFxuICAgICAgICAgICgpID0+IHsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDE0KTsgdi5kaXNwb3NlKCk7IH0pO1xuICAgICAgfSBlbHNlIHsgdGhpcy5idXJzdChwLngsIHAueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxNik7IHYuZGlzcG9zZSgpOyB9XG4gICAgfVxuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHtcbiAgICAgIGxldCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7XG4gICAgICBpZiAoIXYpIHsgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHUuc291bCwgMCwgdS5zdGFyKTsgdGhpcy51bml0VmlzLnNldCh1LmlkLCB2KTsgdGhpcy52aXNUb1VuaXQuc2V0KHYsIHUuaWQpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7IGF1ZGlvLnBsYXkoJ3N1bW1vbicpOyBjb25zdCB2diA9IHY7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB2di5wbGF5KCdpZGxlJyk7IH0pOyB9XG4gICAgICBlbHNlIHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyBpZiAodi5zdGFyICE9PSB1LnN0YXIpIHsgY29uc3QgZnYgPSB2OyB2LnNldFN0YXIodS5zdGFyKTsgdGhpcy5sYXRlcihncm93biAmJiBncm93bi5pZCA9PT0gdS5pZCA/IDAuMzMgOiAwLCAoKSA9PiB0aGlzLm1lcmdlRngoZnYsIHAueCwgcC56KSk7IH0gfVxuICAgIH1cbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDtcbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5waGFzZSA9PT0gJ2J1aWxkJykge1xuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgY2FuU3VtbW9uKHRoaXMucywgc2VsLmlkeCkgPyAnZnJlZScgOiAnbm9ybWFsJyk7XG4gICAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VGcm9tSGFuZCh0aGlzLnMsIHNlbC5pZHgsIHUuaWQpKSB0aGlzLnRpbnQodS5jZWxsLCAncGFydG5lcicpOyAgICAgLy8gdGhlIGNhcmQgY2FuIG1lcmdlIGludG8gdGhpcyB1bml0XG4gICAgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0Jykge1xuICAgICAgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpO1xuICAgICAgaWYgKHUpIHsgdGhpcy50aW50KHUuY2VsbCwgJ3NlbCcpOyBmb3IgKGNvbnN0IG8gb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VEZXBsb3llZCh1LCBvKSkgdGhpcy50aW50KG8uY2VsbCwgJ3BhcnRuZXInKTsgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgJ2ZyZWUnKTsgfVxuICAgIH1cbiAgfVxuICAvKiogVGhlIG1lcmdlIG1vbWVudDogYSBmbGFzaCBvZiByaW5ncyBhbmQgc3BhcmtzLCBhIHB1bmNoIGluIHNpemUsIGEgcmlzaW5nIGNoaW1lLiAqL1xuICBwcml2YXRlIG1lcmdlRngodjogVW5pdFZpc3VhbCwgeDogbnVtYmVyLCB6OiBudW1iZXIpIHtcbiAgICBhdWRpby5wbGF5KCdtZXJnZScpOyB2LnB1bHNlKCk7IGNvbnN0IHRhcmdldCA9IHYuaG9sZGVyLnNjYWxpbmcueDtcbiAgICB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC40KSwgMC4yLCAyLjAsIDAuNjUpOyB0aGlzLmxhdGVyKDAuMTIsICgpID0+IHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC4yLCAzLjAsIDAuOCkpO1xuICAgIHRoaXMuYnVyc3QoeCwgeiwgWzEsIDAuODUsIDAuNCwgMC45XSwgWzAuOCwgMC40LCAxLCAwLjhdLCA0Nik7IHRoaXMuYnVyc3QoeCwgeiwgWzAuODUsIDAuNiwgMSwgMC45XSwgWzAuNSwgMC4zLCAxLCAwLjddLCAyNCk7XG4gICAgdGhpcy50d2VlbigwLjU1LCAodCkgPT4gdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGFyZ2V0ICogKDEgKyAwLjQ1ICogTWF0aC5zaW4odCAqIE1hdGguUEkpICogKDEgLSB0ICogMC40KSkpLCAoKSA9PiB2LmhvbGRlci5zY2FsaW5nLnNldEFsbCh0YXJnZXQpKTtcbiAgfVxuICBwcml2YXRlIHN1bW1vbkZ4KHg6IG51bWJlciwgejogbnVtYmVyKSB7IHRoaXMuYnVyc3QoeCwgeiwgWzAuNywgMC4zLCAxLCAwLjldLCBbMC4zNSwgMC4xLCAwLjcsIDAuOF0sIDMwKTsgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zLCAxKSwgMC4yLCAxLjIsIDAuNyk7IH1cblxuICAvLyAtLS0tIHBsYXllciBhY3Rpb25zIChidWlsZCBwaGFzZSlcbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgdGhpcy51aS50b2FzdChtc2cpOyB9XG4gIG9uQ2FyZChpZHg6IG51bWJlcikge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKGRpc2NhcmRSZWRyYXcodGhpcy5zLCBpZHgpKSB7IHRoaXMudG9hc3QoJ1N3YXBwZWQ6IGRyZXcgYSBkaWZmZXJlbnQgU291bC4nKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5zZWwuaWR4ID09PSBpZHggPyBudWxsIDogeyB0eXBlOiAnY2FyZCcsIGlkeCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVGlsZShjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBoZXJlID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpOyBpZiAoaGVyZSkgeyB0aGlzLm9uVW5pdFZpc3VhbCh0aGlzLnVuaXRWaXMuZ2V0KGhlcmUuaWQpISk7IHJldHVybjsgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJykge1xuICAgICAgaWYgKGNhblN1bW1vbihzLCBzZWwuaWR4KSkgeyBzdW1tb24ocywgc2VsLmlkeCwgY2VsbCk7IHRoaXMuc2VsID0gbnVsbDsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHNvdWwgPSBzLmhhbmRbc2VsLmlkeF07IHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb246ICR7U09VTF9OQU1FW3NvdWxdfSBjb3N0cyAke2Nvc3Qoc291bCwgMSl9LCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTsgfVxuICAgIH0gZWxzZSBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHsgaWYgKG1vdmVVbml0KHMsIHNlbC5pZCwgY2VsbCkpIHRoaXMuc2VsID0gbnVsbDsgfVxuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVW5pdFZpc3VhbCh2OiBVbml0VmlzdWFsKSB7XG4gICAgY29uc3QgaWQgPSB0aGlzLnZpc1RvVW5pdC5nZXQodik7IGlmIChpZCA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCkhO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChzd2FwU2VsbChzLCBpZCkpIHsgdGhpcy50b2FzdChgU29sZCAke1NPVUxfTkFNRVt1LnNvdWxdfTogZHJldyBhIGRpZmZlcmVudCBTb3VsLmApOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KHUuZnJlc2ggPyBcIllvdSBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZC5cIiA6ICdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHMuaGFuZFt0aGlzLnNlbC5pZHhdID09PSB1LnNvdWwgJiYgdS5zdGFyID09PSAxICYmIHMucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInKSB7XG4gICAgICBpZiAobWVyZ2VGcm9tSGFuZChzLCB0aGlzLnNlbC5pZHgsIGlkKSkgeyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgdGhlIGNhcmQgaW50byBhIDItc3RhciAke1NPVUxfTkFNRVt1LnNvdWxdfSFgKTsgfVxuICAgICAgZWxzZSB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uIHRvIG1lcmdlOiBpdCBuZWVkcyAke2Nvc3QodS5zb3VsLCAyKSAtIGNvc3QodS5zb3VsLCAxKX0gbW9yZSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCAhPT0gaWQpIHtcbiAgICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09ICh0aGlzLnNlbCBhcyBhbnkpLmlkKSE7XG4gICAgICBpZiAoY2FuTWVyZ2VEZXBsb3llZChhLCB1KSkgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIHUuaWQpOyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZDogYS5pZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB9IGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgPT09IGlkID8gbnVsbCA6IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG1lcmdlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpOyBjb25zdCBiID0gYSAmJiBzLnVuaXRzLmZpbmQoKG8pID0+IGNhbk1lcmdlRGVwbG95ZWQoYSwgbykpO1xuICAgIGlmIChhICYmIGIpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCBiLmlkKTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMudG9hc3QoJ05vIG1hdGNoaW5nIHVuaXQgKHNhbWUgU291bCBhbmQgc3RhcnMpIHRvIG1lcmdlIHdpdGguJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICByZW1vdmVTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGlmICghdGhpcy5jb25maXJtUmVtb3ZlKSB7IHRoaXMuY29uZmlybVJlbW92ZSA9IHRydWU7IHRoaXMudG9hc3QoJ1RhcCBSZW1vdmUgYWdhaW4gdG8gY29uZmlybS4gVGhlIGNhcmQgaXMgZ29uZSBmb3IgdGhpcyBzdGFnZS4nKTsgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuOyB9XG4gICAgZGlzbWlzcyh0aGlzLnMsIHNlbC5pZCk7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgdG9nZ2xlU3dhcCgpIHsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjsgaWYgKHRoaXMucy5kaXNjYXJkVXNlZCkgeyB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyByZXR1cm47IH0gdGhpcy5zd2FwTW9kZSA9ICF0aGlzLnN3YXBNb2RlOyB0aGlzLnNlbCA9IG51bGw7IGlmICh0aGlzLnN3YXBNb2RlKSB0aGlzLnRvYXN0KCdTd2FwOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCwgb3IgYSB1bml0IChub3Qgc3VtbW9uZWQgdGhpcyByb3VuZCkgdG8gc2VsbC4nKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGJhdHRsZVxuICBzdGFydEJhdHRsZSgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhdGhpcy5zLnVuaXRzLmxlbmd0aCkgeyBpZiAoIXRoaXMucy51bml0cy5sZW5ndGgpIHRoaXMudG9hc3QoJ1N1bW1vbiBhdCBsZWFzdCBvbmUgdW5pdCBmaXJzdC4nKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5mbHVzaFR3ZWVucygpOyBhdWRpby5wbGF5KCdzdGFydCcpOyB0aGlzLmJlZ2luQmF0dGxlUGVyZigpOyB0aGlzLnNob3dHcmlkKGZhbHNlKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5hdHRlbXB0Kys7IHRoaXMuaGFuZGxlZCA9IGZhbHNlOyB0aGlzLnJlc3VsdEF0ID0gLTE7XG4gICAgY29uc3QgcyA9IHRoaXMucywgdW5pdHMgPSBzLnVuaXRzLnNsaWNlKCk7XG4gICAgY29uc3Qgc2F2ZWQgPSBsb2FkU2F2ZSgpLnNvdWxzLCBsZXZlbHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTsgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHNhdmVkKSkgbGV2ZWxzW2tdID0gKHNhdmVkIGFzIGFueSlba10ubGV2ZWw7ICAgLy8gcGVybWFuZW50IFNvdWwgbGV2ZWxzXG4gICAgdGhpcy5iYXR0bGUgPSBuZXcgQmF0dGxlKHVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW15V2F2ZShzLndhdmUsIHRoaXMuc2VlZCksIHRoaXMuc2VlZCAqIDEzMSArIHMud2F2ZSAqIDE3ICsgdGhpcy5hdHRlbXB0LCBsZXZlbHMsIGVuZW15UG93ZXIocy53YXZlKSk7XG4gICAgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTtcbiAgICB0aGlzLmJhdHRsZS5maWdodGVycy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICBpZiAoZi50ZWFtID09PSAwKSB7IGNvbnN0IHUgPSB1bml0c1tmLmlkIC0gMV07IGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5mVW5pdC5zZXQoZi5pZCwgdS5pZCk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IH1cbiAgICAgIGVsc2UgeyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgZi5zb3VsLCAxLCBmLnN0YXIpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoZi54LCAwLCBmLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gLU1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh2LnN0YXRlID09PSAnc3Bhd24nKSB2LnBsYXkoJ2lkbGUnKTsgfSk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjcsIDAuNiwgMC41LCAwLjddLCBbMC40LCAwLjM1LCAwLjMsIDAuNl0sIDE0KTsgfVxuICAgIH0pO1xuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIHRoaXMucGhhc2UgPSAndHJhbnNpdGlvbic7IHRoaXMuc3RhcnRTdGVwQXQgPSAxLjA7IHRoaXMuYWNjID0gMDsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAyLjIpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLmJhdHRsZVJvYXIoKTtcbiAgfVxuICBwcml2YXRlIGFwcGx5RXZlbnRzKGV2czogQkV2ZW50W10pIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhO1xuICAgIGZvciAoY29uc3QgZSBvZiBldnMpIHtcbiAgICAgIGlmIChlLnQgPT09ICdzd2luZycpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB2LnBsYXkoJ2F0dGFjaycsIGUuc3BlZWQpOyBpZiAoTWF0aC5yYW5kb20oKSA8IDAuMDgpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKTsgaWYgKGYpIGF1ZGlvLmJhcmsoZi5zb3VsLCAwLCBmLnRlYW0gPT09IDAgPyAxIDogMC44NSk7IH0gfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnaGl0JykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLnRvKTsgaWYgKHYpIHYucHVsc2UoKTsgaWYgKGUua2luZCA9PT0gJ2Fycm93JykgYXVkaW8ucGxheSgnaGl0QXJyb3cnKTsgZWxzZSBpZiAoZS5raW5kID09PSAnbWVsZWUnKSBhdWRpby5wbGF5KCdoaXQnKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnYXJyb3cnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5mcm9tKSEsIHRvID0gYi5ieUlkKGUudG8pITsgdGhpcy5zcGF3bkFycm93KGYudGVhbSwgZi54LCBmLnosIHRvLngsIHRvLnosIGUuZHVyKTsgYXVkaW8ucGxheSgnYXJyb3cnKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnZGVhdGgnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgeyB2LnBsYXkoJ2RlYXRoJyk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ2RlYXRoJyk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTIpOyBpZiAoZi50ZWFtID09PSAxKSB0aGlzLmxhdGVyKDUsICgpID0+IHsgaWYgKHRoaXMuZnZpcy5nZXQoZS5pZCkgPT09IHYgJiYgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgeyB2LmhvbGRlci5zZXRFbmFibGVkKGZhbHNlKTsgfSB9KTsgfSB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdjYXN0JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnY2FzdCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNSwgMC44LCAxKSwgMC4xNSwgMS4xLCAwLjM1KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAndGF1bnQnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCd0YXVudCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuMyksIDAuMywgQkFMQU5DRS50YXVudC5yYWRpdXMsIDAuNik7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3NtYXNoJykgeyBhdWRpby5wbGF5KCdzbWFzaCcpOyB0aGlzLmZ4UmluZyhlLngsIGUueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNSwgMC4yKSwgMC4yLCBlLnIgKiAxLjYsIDAuNDUpOyB9XG4gICAgfVxuICB9XG4gIHByaXZhdGUgYXJyb3dCYXNlOiBhbnlbXSA9IFtdO1xuICAvKiogVGhlIGFycm93J3Mgb3duIG1hdGVyaWFsIHdpdGggYSBmYWludCBnbG93IGluIHRoZSB0ZWFtIGNvbG91ciAocHVycGxlIGZvciB5b3VycywgYW1iZXIgZm9yIHRoZSBlbmVteSdzKSwgc28geW91IGNhbiBzdGlsbCB0ZWxsIHdob3NlIGl0IGlzLiAqL1xuICBwcml2YXRlIGFycm93VGVhbU1hdCh0ZWFtOiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5hcnJvd0Jhc2VbdGVhbV0pIHJldHVybiB0aGlzLmFycm93QmFzZVt0ZWFtXTtcbiAgICBjb25zdCBzcmMgPSB0aGlzLkEuYXJyb3cubWF0ZXJpYWxzICYmIHRoaXMuQS5hcnJvdy5tYXRlcmlhbHNbMF07IGlmICghc3JjKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBtID0gc3JjLmNsb25lKCdhcnJvd1QnICsgdGVhbSk7IGNvbnN0IGMgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNTUsIDAuMiwgMC44NSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC45LCAwLjU1LCAwLjE1KTtcbiAgICBpZiAoJ2VtaXNzaXZlQ29sb3InIGluIG0pIG0uZW1pc3NpdmVDb2xvciA9IGMuc2NhbGUoMC4wMzUpOyB0aGlzLmFycm93QmFzZVt0ZWFtXSA9IG07IHJldHVybiBtO1xuICB9XG4gIHByaXZhdGUgc3Bhd25BcnJvdyh0ZWFtOiBudW1iZXIsIHgwOiBudW1iZXIsIHowOiBudW1iZXIsIHgxOiBudW1iZXIsIHoxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgbGV0IG1lc2ggPSB0aGlzLmFycm93TWVzaC5wb3AoKTtcbiAgICBpZiAoIW1lc2gpIHtcbiAgICAgIGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2FyJywgdGhpcy5zY2VuZSk7IGhvbGRlci5zY2FsaW5nLnNldEFsbCgwLjY1KTsgICAvLyA1NSBjbSB3YXMgbG9uZyBuZXh0IHRvIGEgY2hpYmkgR29ibGluXG4gICAgICBpZiAodGhpcy5BLmFycm93KSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHJlYWwgYXJyb3cgbW9kZWwgKG1ldGFsIGhlYWQsIGZsZXRjaGluZyk6IG9uZSBpbnN0YW5jZSBwZXIgZmx5aW5nIGFycm93XG4gICAgICAgIGNvbnN0IGVudCA9IHRoaXMuQS5hcnJvdy5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpLCBmYWxzZSk7XG4gICAgICAgIGVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gaG9sZGVyOyBlbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IH0pO1xuICAgICAgfSBlbHNlIHsgY29uc3QgY3lsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignYXJyb3cnLCB7IGhlaWdodDogMC41NSwgZGlhbWV0ZXI6IDAuMDM1IH0sIHRoaXMuc2NlbmUpOyBjeWwucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyBjeWwuaXNQaWNrYWJsZSA9IGZhbHNlOyBjeWwucGFyZW50ID0gaG9sZGVyOyBjeWwubWF0ZXJpYWwgPSB0aGlzLmFycm93TWF0c1t0ZWFtXTsgfVxuICAgICAgbWVzaCA9IGhvbGRlcjtcbiAgICB9XG4gICAgbWVzaC5zZXRFbmFibGVkKHRydWUpO1xuICAgIGlmICh0aGlzLkEuYXJyb3cpIHsgY29uc3QgdG0gPSB0aGlzLmFycm93VGVhbU1hdCh0ZWFtKTsgbWVzaC5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBpZiAodG0pIG0ubWF0ZXJpYWwgPSB0bTsgfSk7IH1cbiAgICB0aGlzLmFycm93cy5wdXNoKHsgbWVzaCwgeDAsIHowLCB4MSwgejEsIHQ6IDAsIGR1ciB9KTtcbiAgfVxuXG4gIC8qKiBCYXR0bGUgY3J5OiB1cCB0byB0aHJlZSBkaWZmZXJlbnQgU291bHMgZnJvbSB5b3VyIGFybXkgYmVsbG93IGluIHR1cm4sIGFuZCBvbmUgZnJvbSB0aGUgZW5lbXkgYW5zd2VycywgYSBsaXR0bGUgbG93ZXIuICovXG4gIHByaXZhdGUgYmF0dGxlUm9hcigpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7IGlmICghYikgcmV0dXJuOyBjb25zdCBtaW5lID0gbmV3IFNldDxzdHJpbmc+KCksIHRoZWlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSAoZi50ZWFtID09PSAwID8gbWluZSA6IHRoZWlycykuYWRkKGYuc291bCk7XG4gICAgWy4uLm1pbmVdLnNsaWNlKDAsIDMpLmZvckVhY2goKHNvdWwsIGkpID0+IGF1ZGlvLmJhcmsoc291bCwgMC4xNSArIDAuMTYgKiBpLCAxKSk7IGNvbnN0IGUgPSBbLi4udGhlaXJzXVswXTsgaWYgKGUpIGF1ZGlvLmJhcmsoZSwgMC41NSwgMC44Mik7XG4gIH1cblxuICBwcml2YXRlIGZyYW1lKGR0OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5jYW52YXMuY2xpZW50V2lkdGggIT09IHRoaXMubGFzdFcgfHwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0ICE9PSB0aGlzLmxhc3RIKSB0aGlzLmhhbmRsZVJlc2l6ZSgpOyAgIC8vIGUuZy4gdGhlIGhvbWUtc2NyZWVuIGFwcCByZXNpemluZyBhZnRlciBsYXVuY2hcbiAgICBmb3IgKGxldCBpID0gdGhpcy50aW1lcnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgdGhpcy50aW1lcnNbaV0udCAtPSBkdDsgaWYgKHRoaXMudGltZXJzW2ldLnQgPD0gMCkgeyBjb25zdCBmID0gdGhpcy50aW1lcnNbaV0uZm47IHRoaXMudGltZXJzLnNwbGljZShpLCAxKTsgZigpOyB9IH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5yaW5nRngubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgciA9IHRoaXMucmluZ0Z4W2ldOyByLnQgKz0gZHQ7IGNvbnN0IHUgPSByLnQgLyByLmR1ciwgcyA9IHIucjAgKyAoci5yMSAtIHIucjApICogdTsgci5tLnNjYWxpbmcuc2V0KHMsIHMsIHMpOyByLm1tLmFscGhhID0gMC45ICogKDEgLSB1KTsgaWYgKHUgPj0gMSkgeyByLm0uZGlzcG9zZSgpOyByLm1tLmRpc3Bvc2UoKTsgdGhpcy5yaW5nRnguc3BsaWNlKGksIDEpOyB9IH1cbiAgICBpZiAodGhpcy5jYW1UIDwgMSkgeyB0aGlzLmNhbVQgPSBNYXRoLm1pbigxLCB0aGlzLmNhbVQgKyBkdCAvIHRoaXMuY2FtRHVyKTsgY29uc3QgZSA9IHRoaXMuY2FtVCAqIHRoaXMuY2FtVCAqICgzIC0gMiAqIHRoaXMuY2FtVCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnBvcywgdGhpcy5jYW1Uby5wb3MsIGUpOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS50Z3QsIHRoaXMuY2FtVG8udGd0LCBlKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgJiYgdGhpcy5jYW1Nb2RlID09PSAnY2xvc2UnICYmICF0aGlzLmNpbmUpIHRoaXMuZnJhbWVCYXR0bGUoZHQpO1xuICAgIHRoaXMubmVjcm8udXBkYXRlKGR0KTtcbiAgICBmb3IgKGxldCBpID0gdGhpcy50d2VlbnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgdyA9IHRoaXMudHdlZW5zW2ldOyB3LnQgKz0gZHQ7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCB3LnQgLyB3LmR1cik7IHcuZm4odSk7IGlmICh1ID49IDEpIHsgdGhpcy50d2VlbnMuc3BsaWNlKGksIDEpOyBpZiAody5kb25lKSB3LmRvbmUoKTsgfSB9XG4gICAgZm9yIChjb25zdCB2IG9mIHRoaXMudW5pdFZpcy52YWx1ZXMoKSkgdi51cGRhdGUoZHQpO1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi51cGRhdGUoZHQpOyB9KTtcblxuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTtcbiAgICBpZiAoKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJyB8fCB0aGlzLnBoYXNlID09PSAnYmF0dGxlJykgJiYgYikge1xuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykgeyB0aGlzLnN0YXJ0U3RlcEF0IC09IGR0OyBpZiAodGhpcy5zdGFydFN0ZXBBdCA8PSAwKSB7IHRoaXMucGhhc2UgPSAnYmF0dGxlJzsgdGhpcy51aS5yZW5kZXIoKTsgfSB9XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpIHtcbiAgICAgICAgdGhpcy5hY2MgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTtcbiAgICAgICAgd2hpbGUgKHRoaXMuYWNjID49IDEgLyAzMCAmJiBiLndpbm5lciA8IDApIHsgYi5zdGVwKDEgLyAzMCk7IHRoaXMuYWNjIC09IDEgLyAzMDsgdGhpcy5hcHBseUV2ZW50cyhiLmRyYWluKCkpOyB9XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgaWYgKCF0aGlzLmNpbmUgJiYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IGYudGVhbSA9PT0gMSkpIHsgdi5ob2xkZXIucG9zaXRpb24ueCA9IGYueDsgdi5ob2xkZXIucG9zaXRpb24ueiA9IGYuejsgaWYgKGYuYWxpdmUgfHwgdHJ1ZSkgdi5ob2xkZXIucm90YXRpb24ueSA9IGYueWF3OyB9XG4gICAgICAgIGlmIChmLmFsaXZlKSB7IHYuc2V0SHAoZi5ocCAvIGYubWF4SHApOyBpZiAoZi5tYXhNYW5hKSB2LnNldE1hbmEoZi5tYW5hIC8gZi5tYXhNYW5hKTsgfVxuICAgICAgICBlbHNlIHYuc2V0TWFuYShudWxsKTtcbiAgICAgICAgaWYgKGYuc3RhdGUgIT09ICdhdHRhY2snICYmIGYuYWxpdmUgJiYgdi5zdGF0ZSAhPT0gJ2NoZWVyJykgeyBjb25zdCB3YW50ID0gZi5zdGF0ZSA9PT0gJ3J1bicgPyAncnVuJyA6ICdpZGxlJzsgaWYgKHRoaXMubGFzdFN0YXRlLmdldChmLmlkKSAhPT0gd2FudCB8fCAodi5zdGF0ZSAhPT0gd2FudCAmJiB2LnN0YXRlICE9PSAnc3Bhd24nKSkgeyBpZiAodi5zdGF0ZSAhPT0gJ3NwYXduJykgeyB2LnBsYXkod2FudCBhcyBhbnkpOyB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgd2FudCk7IH0gfSB9XG4gICAgICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsICdhdHRhY2snKTtcbiAgICAgIH1cbiAgICAgIGlmIChiLndpbm5lciA+PSAwICYmICF0aGlzLmhhbmRsZWQpIHsgdGhpcy5oYW5kbGVkID0gdHJ1ZTsgdGhpcy5yZXN1bHRBdCA9IDEuNDsgfVxuICAgICAgaWYgKHRoaXMucmVzdWx0QXQgPiAwKSB7IHRoaXMucmVzdWx0QXQgLT0gZHQ7IGlmICh0aGlzLnJlc3VsdEF0IDw9IDApIHRoaXMuaGFuZGxlUmVzdWx0KCk7IH1cbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuYXJyb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBhID0gdGhpcy5hcnJvd3NbaV07IGEudCArPSBkdCAqIHRoaXMudGltZVNjYWxlOyBjb25zdCB1ID0gTWF0aC5taW4oMSwgYS50IC8gYS5kdXIpO1xuICAgICAgY29uc3QgcHggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUsIHB6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1LCBweSA9IDAuNzUgKyBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjkgLSB1ICogMC4yNTtcbiAgICAgIGNvbnN0IHUyID0gTWF0aC5taW4oMSwgdSArIDAuMDMpLCBxeCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdTIsIHF6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1MiwgcXkgPSAwLjc1ICsgTWF0aC5zaW4odTIgKiBNYXRoLlBJKSAqIDAuOSAtIHUyICogMC4yNTtcbiAgICAgIGEubWVzaC5wb3NpdGlvbi5zZXQocHgsIHB5LCBweik7IGEubWVzaC5sb29rQXQobmV3IEJBQllMT04uVmVjdG9yMyhxeCwgcXksIHF6KSk7XG4gICAgICBpZiAodSA+PSAxKSB7IGEubWVzaC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5hcnJvd01lc2gucHVzaChhLm1lc2gpOyB0aGlzLmFycm93cy5zcGxpY2UoaSwgMSk7IH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVJlc3VsdCgpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBzID0gdGhpcy5zO1xuICAgIHRoaXMuZW5kQmF0dGxlUGVyZigpO1xuICAgIHRoaXMubGFzdEJhdHRsZSA9IGB3YXZlICR7cy53YXZlfSBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fTogJHtiLndpbm5lciA9PT0gMCA/ICdXT04nIDogJ0xPU1QnfSBpbiAke2IudGltZS50b0ZpeGVkKDEpfXMsICR7Yi5jb3VudCgwKX0gb2YgeW91cnMgYW5kICR7Yi5jb3VudCgxKX0gZW5lbWllcyBsZWZ0YDtcbiAgICBpZiAoYi53aW5uZXIgPT09IDApIHtcbiAgICAgIHRoaXMucGxheVJlc3VsdCgnd2luJywgKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBhcm15IGlzIHJhaXNlZCBhZ2FpbiwgdGhlbiB0aGUgbmV4dCB3YXZlIC8gdGhlIGRyYWZ0XG4gICAgICAgIHRoaXMuY2luZSA9IGZhbHNlO1xuICAgICAgICB0cnkgeyB0aGlzLmxhc3RHb2xkID0gdGhpcy5kYWlseSA/IDAgOiBhZGRHb2xkQW5kU2F2ZShpc0VuZGxlc3MoKSA/IGVuZGxlc3NXYXZlR29sZChzLndhdmUpIDogd2F2ZUdvbGQoY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lIGFzIGFueSkpOyB0aGlzLnJ1bkdvbGQgKz0gdGhpcy5sYXN0R29sZDsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7IH0gY2F0Y2ggeyB0aGlzLmxhc3RHb2xkID0gMDsgfVxuICAgICAgICBpZiAoaXNFbmRsZXNzKCkgJiYgdGhpcy5lbmRsZXNzKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHIgPSByZWNvcmRFbmRsZXNzV2F2ZUFuZFNhdmUocy53YXZlKTsgdGhpcy5lbmRsZXNzLmNsZWFyZWQgPSBzLndhdmU7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2F2ZS1jaGFuZ2VkJykpO1xuICAgICAgICAgICAgaWYgKHIucGFjaykgeyB0aGlzLmVuZGxlc3MucGFja3MrKzsgdGhpcy50b2FzdCgnV2F2ZSAnICsgcy53YXZlICsgJyBjbGVhcmVkISBZb3UgZWFybmVkIGEgU291bCBQYWNrIChzZWUgdGhlIFNob3ApLicpOyB9XG4gICAgICAgICAgfSBjYXRjaCB7IC8qIHNhdmluZyBtdXN0IG5ldmVyIGJyZWFrIGEgcnVuICovIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoYWR2YW5jZVdhdmUocykpIHtcbiAgICAgICAgICB0aGlzLnBoYXNlID0gJ3dvbic7IGNsZWFyUnVuKCk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRhaWx5KSB7IHRoaXMuZGFpbHlSZXdhcmQgPSByZWNvcmREYWlseVdpbkFuZFNhdmUodGhpcy5kYWlseS5kYXkpOyB0aGlzLnJld2FyZCA9IG51bGw7IH0gZWxzZSB0aGlzLnJld2FyZCA9IHJlY29yZENsZWFyQW5kU2F2ZShjdXJyZW50U3RhZ2VJZCwgZGlmZmljdWx0eU5hbWUgYXMgYW55KTtcbiAgICAgICAgICAgIHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2F2ZS1jaGFuZ2VkJykpO1xuICAgICAgICAgIH0gY2F0Y2ggeyB0aGlzLnJld2FyZCA9IG51bGw7IH1cbiAgICAgICAgICB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5kcmFmdCA9IGRyYWZ0T3B0aW9ucyhzKTsgdGhpcy5waGFzZSA9ICdkcmFmdCc7IHRoaXMucGVyc2lzdFJ1bigpOyB0aGlzLnVpLnJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZhaWxXYXZlKHMpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnVpLnB1bHNlSGVhcnRzKCk7ICAgICAgICAgICAgICAgICAgIC8vIHRoZSBoZWFydCBpcyBsb3N0IHRoZSBtb21lbnQgaGUgaXMgaGl0XG4gICAgICBpZiAocy5zdGF0dXMgPT09ICdsb3N0JykgdGhpcy5wbGF5UmVzdWx0KCdmaW5hbCcsICgpID0+IHsgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucGhhc2UgPSAnbG9zdCc7IGNsZWFyUnVuKCk7IHRoaXMudWkucmVuZGVyKCk7IH0pO1xuICAgICAgZWxzZSB0aGlzLnBsYXlSZXN1bHQoJ2xvc3MnLCAoKSA9PiB7IHRoaXMudG9hc3QoJ1lvdXIgYXJteSBmZWxsLiAtMSBoZWFydCwgKzEgY2FyZCwgc2FtZSB3YXZlLiBSZWJ1aWxkIGEgZGlmZmVyZW50IHN0cmF0ZWd5LicpOyB0aGlzLnRvQnVpbGQoKTsgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLSByZXN1bHQgY3V0c2NlbmVzIChwbGFuIHNlY3Rpb25zIDE5LTIyKTogdGhlIE5lY3JvbWFuY2VyIHRha2VzIHRoZSBoaXQsIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSwgcmFpc2VzIHRoZSBmYWxsZW5cbiAgcHJpdmF0ZSBwbGF5UmVzdWx0KGtpbmQ6ICd3aW4nIHwgJ2xvc3MnIHwgJ2ZpbmFsJywgZG9uZTogKCkgPT4gdm9pZCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIG4gPSB0aGlzLm5lY3JvOyB0aGlzLmNpbmUgPSB0cnVlOyBpZiAoa2luZCAhPT0gJ3dpbicpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLm5lY3JvLCAxLjEpO1xuICAgIGNvbnN0IGhvbWUgPSAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXZlcnkgZmFsbGVuIGFsbHkgaXMgcHVsbGVkIGJhY2sgdG8gaXRzIGdyaWQgdGlsZSBhbmQgc3RhbmRzIHVwXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgncmVzdXJyZWN0Jyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy5idXJzdChjLngsIGMueiwgWzAuODUsIDAuNSwgMSwgMC45XSwgWzAuNSwgMC4yLCAxLCAwLjddLCAzMCk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBpZiAoZi50ZWFtICE9PSAwKSBjb250aW51ZTsgY29uc3QgdWlkID0gdGhpcy5mVW5pdC5nZXQoZi5pZCksIHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdWlkKSwgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdSB8fCAhdikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3ModS5jZWxsKSwgeDAgPSB2LmhvbGRlci5wb3NpdGlvbi54LCB6MCA9IHYuaG9sZGVyLnBvc2l0aW9uLno7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTtcbiAgICAgICAgaWYgKCFmLmFsaXZlKSB7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5idXJzdCh4MCwgejAsIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTgpOyB0aGlzLmZ4UmluZyh4MCwgejAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjcsIDAuMzUsIDEpLCAwLjMsIDEuNiwgMC43KTsgfVxuICAgICAgICB0aGlzLnR3ZWVuKDEuMCwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjUsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIucm90YXRpb24ueSArPSAoTWF0aC5QSSAvIDIgLSB2LmhvbGRlci5yb3RhdGlvbi55KSAqIE1hdGgubWluKDEsIHQgKiAwLjUgKyAwLjEpOyB9LFxuICAgICAgICAgICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHRoaXMuYnVyc3QodG8ueCwgdG8ueiwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxMCk7IH0pO1xuICAgICAgfVxuICAgIH07XG4gICAgaWYgKGtpbmQgPT09ICd3aW4nKSB7XG4gICAgICAvLyB0aGUgc3Vydml2b3JzIGNlbGVicmF0ZSByaWdodCB3aGVyZSB0aGV5IHN0YW5kIChwdXJlbHkgdmlzdWFsKSwgVEhFTiB0aGUgY2FtZXJhIHN3aW5ncyB0byB0aGUgTmVjcm9tYW5jZXIgYW5kIHRoZSBhcm15IGlzIHJhaXNlZFxuICAgICAgYXVkaW8ucGxheSgndmljdG9yeScpO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIGlmIChmLnRlYW0gPT09IDAgJiYgZi5hbGl2ZSkgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKHYpIHRoaXMubGF0ZXIoTWF0aC5yYW5kb20oKSAqIDAuMzUsICgpID0+IHsgdi5wbGF5KCdjaGVlcicpOyBhdWRpby5iYXJrKGYuc291bCk7IH0pOyB9XG4gICAgICB0aGlzLmxhdGVyKDEuNiwgKCkgPT4geyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5uZWNybywgMS4xKTsgbi5jYXN0KCk7IH0pO1xuICAgICAgdGhpcy5sYXRlcigxLjg1LCBob21lKTsgdGhpcy5sYXRlcigzLjYsIGRvbmUpOyByZXR1cm47XG4gICAgfVxuICAgIG4uaHVydCgpOyBhdWRpby5wbGF5KCdoZWFydExvc3QnKTsgdGhpcy5sYXRlcigwLjE1LCAoKSA9PiB7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy5idXJzdChjLngsIGMueiwgWzEsIDAuMywgMC4zLCAwLjldLCBbMC44LCAwLjEsIDAuMiwgMC42XSwgMTYpOyB9KTtcbiAgICBpZiAoa2luZCA9PT0gJ2ZpbmFsJykgeyB0aGlzLmxhdGVyKDAuNiwgKCkgPT4geyBuLmRlZmVhdCgpOyBhdWRpby5wbGF5KCdkZWZlYXQnKTsgfSk7IHRoaXMubGF0ZXIoMi42LCBkb25lKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5sYXRlcigxLjAsICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXB1bHNpb24gc2hvY2t3YXZlOiBzdXJ2aXZvcnMgYXJlIGZsdW5nIGJhY2sgdG8gd2hlcmUgdGhleSBzdGFydGVkIGFuZCBoZWFsIHRvIGZ1bGxcbiAgICAgIG4uY2FzdCgpOyBhdWRpby5wbGF5KCdzaG9ja3dhdmUnKTsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpO1xuICAgICAgdGhpcy5meFJpbmcoYy54LCAwLCBuZXcgQkFCWUxPTi5Db2xvcjMoMC44NSwgMC41NSwgMSksIDAuNiwgMzAsIDEuMSk7IHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDEsIDEpLCAwLjQsIDIyLCAwLjgpO1xuICAgICAgdGhpcy5idXJzdChjLngsIGMueiwgWzEsIDAuODUsIDEsIDAuOV0sIFswLjcsIDAuNCwgMSwgMC43XSwgNDApO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgaWYgKGYudGVhbSAhPT0gMSB8fCAhZi5hbGl2ZSkgY29udGludWU7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0byA9IGNlbGxQb3MoMSwgZi5jZWxsKSwgeDAgPSB2LmhvbGRlci5wb3NpdGlvbi54LCB6MCA9IHYuaG9sZGVyLnBvc2l0aW9uLno7IHYucHVsc2UoKTtcbiAgICAgICAgdGhpcy50d2VlbigwLjksICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC45LCB6MCArICh0by56IC0gejApICogdCk7IHYuc2V0SHAoZi5ocCAvIGYubWF4SHAgKyAoMSAtIGYuaHAgLyBmLm1heEhwKSAqIHQpOyB9LCAoKSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnkgPSAwOyB2LnNldEhwKDEpOyB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB0aGlzLmxhdGVyKDIuMywgaG9tZSk7IHRoaXMubGF0ZXIoMy43LCBkb25lKTtcbiAgfVxuICBwaWNrRHJhZnQoaWR4OiBudW1iZXIpIHsgaWYgKCF0aGlzLmRyYWZ0KSByZXR1cm47IHRha2VEcmFmdCh0aGlzLnMsIHRoaXMuZHJhZnQsIGlkeCk7IHRoaXMuZHJhZnQgPSBudWxsOyBub3JtYWxEcmF3KHRoaXMucyk7IHRoaXMudG9CdWlsZCgpOyB9XG4gIHByaXZhdGUgdG9CdWlsZCgpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5uZWNyby5yZXZpdmUoKTsgdGhpcy5mbHVzaFR3ZWVucygpO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgdGhpcy5zaG93R3JpZCh0cnVlKTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7ICAgICAgICAgICAgICAgICAgICAgICAvLyByZXN1cnJlY3Rpb246IGV2ZXJ5b25lIHJpc2VzIGFnYWluIGF0IGZ1bGwgaGVhbHRoXG4gICAgICBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYuaG9sZGVyLnNldEVuYWJsZWQodHJ1ZSk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTtcbiAgICAgIHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB2LnBsYXkoJ2lkbGUnKSk7XG4gICAgfVxuICAgIHRoaXMucGhhc2UgPSAnYnVpbGQnOyB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7ICAgICAgICAgIC8vIFVJIGZpcnN0OiB0aGUgY2FtZXJhIG11c3QgbWVhc3VyZSB0aGUgaGFuZCBhbmQgYnV0dG9ucyB3aGlsZSB0aGV5IGFyZSB2aXNpYmxlXG4gICAgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYnVpbGQsIDEuOCk7XG4gIH1cbiAgLyoqIDJ4IGFuZCA0eCBiYXR0bGUgc3BlZWQgb3BlbiBvbmNlIHRoZSBjYW1wYWlnbiBpcyBmaW5pc2hlZCAodGhlIGxhc3Qgc3RhZ2UgY2xlYXJlZCBvbiBOb3JtYWwpLiA/ZGVidWcgb3IgP3NwZWVkPTEgb3BlbnMgdGhlbSBmb3IgdGVzdGluZy4gKi9cbiAgc3BlZWRVbmxvY2tlZCgpOiBib29sZWFuIHsgY29uc3QgcSA9IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKTsgcmV0dXJuICEhKHEuZ2V0KCdkZWJ1ZycpIHx8IHEuZ2V0KCdzcGVlZCcpKSB8fCBlbmRsZXNzVW5sb2NrZWQobG9hZFNhdmUoKSk7IH1cbiAgc2V0U3BlZWQoazogbnVtYmVyKSB7XG4gICAgaWYgKGsgPiAxICYmICF0aGlzLnNwZWVkVW5sb2NrZWQoKSkgcmV0dXJuO1xuICAgIHRoaXMudGltZVNjYWxlID0gazsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIGhlbHBlcnNcbiAgYXBwbHlCYWxhbmNlQ2hhbmdlKCkgeyB0aGlzLnVuaXRWaXMuZm9yRWFjaCgodiwgaWQpID0+IHsgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7IGlmICh1KSB2LnNldFN0YXIodS5zdGFyKTsgfSk7IH1cbiAgdGVzdE9kZHMobiA9IDIwMCkge1xuICAgIGNvbnN0IHNsb3RzID0gdGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW1pZXMgPSBlbmVteVdhdmUodGhpcy5zLndhdmUsIHRoaXMuc2VlZCk7IGxldCB3aW4gPSAwLCB0ID0gMDtcbiAgICBjb25zdCBsdjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9LCBzdiA9IGxvYWRTYXZlKCkuc291bHM7IGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhzdikpIGx2W2tdID0gKHN2IGFzIGFueSlba10ubGV2ZWw7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsgY29uc3QgciA9IHNpbXVsYXRlKHNsb3RzLCBlbmVtaWVzLCA1MDAwICsgaSwgMTMwLCBsdiwgZW5lbXlQb3dlcigpKTsgaWYgKHIud2lubmVyID09PSAwKSB3aW4rKzsgdCArPSByLnRpbWU7IH1cbiAgICByZXR1cm4geyB3aW46IE1hdGgucm91bmQoKHdpbiAvIG4pICogMTAwKSwgYXZnVGltZTogKyh0IC8gbikudG9GaXhlZCgxKSwgbiB9O1xuICB9XG4gIGFkZENhcmQoc291bDogU291bElkKSB7IHRoaXMucy5oYW5kLnB1c2goc291bCk7IHRoaXMucy5zdGF0cy5kcmF3bisrOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIGFkZERvbWluaW9uKG46IG51bWJlcikgeyB0aGlzLnMuY2FwICs9IG47IHRoaXMudWkucmVuZGVyKCk7IH1cbiAgcmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgZW4gPSBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpO1xuICAgIHJldHVybiBbYHN0YWdlICR7Y3VycmVudFN0YWdlSWR9LyR7ZGlmZmljdWx0eU5hbWV9ICBzZWVkICR7dGhpcy5zZWVkfSAgd2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfSAgaGVhcnRzICR7cy5oZWFydHN9ICBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0gIHBoYXNlICR7dGhpcy5waGFzZX0gIGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9YCxcbiAgICAgIGBoYW5kOiAke3MuaGFuZC5qb2luKCcsICcpIHx8ICcoZW1wdHkpJ31gLCBgYXJteTogJHtzLnVuaXRzLm1hcCgodSkgPT4gYCR7dS5zb3VsfSR7dS5zdGFyfUAke3UuY2VsbH1gKS5qb2luKCcgJykgfHwgJyhub25lKSd9YCwgYGVuZW15OiAke2VuLm1hcCgoZSkgPT4gZS5zb3VsICsgZS5zdGFyKS5qb2luKCcgJyl9YCxcbiAgICAgIGBkaWZmaWN1bHR5OiAke2RpZmZpY3VsdHlOYW1lfSAgbWVyZ2UtZnJvbS1oYW5kOiAke3MucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInfSAgc3dhcCB1c2VkOiAke3MuZGlzY2FyZFVzZWR9YCwgYGxhc3QgdGFwOiAke3RoaXMubGFzdFRhcEluZm99YCwgYHNjcmVlbjogJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IGRwciAke3dpbmRvdy5kZXZpY2VQaXhlbFJhdGlvfWAsIGBsYXN0IGJhdHRsZTogJHt0aGlzLmxhc3RCYXR0bGUgfHwgJy0nfWAsIGBsb2cgdGFpbDpgLCAuLi5zLmxvZy5zbGljZSgtOCksIGBiYWxhbmNlOiAke0pTT04uc3RyaW5naWZ5KHsgc3RhcjogQkFMQU5DRS5zdGFyLCBzdGF0czogQkFMQU5DRS5zdGF0cyB9KX1gXS5qb2luKCdcXG4nKTtcbiAgfVxuICByZXNldEJhbGFuY2VBbGwoKSB7IHJlc2V0QmFsYW5jZSgpOyB0aGlzLmFwcGx5QmFsYW5jZUNoYW5nZSgpOyB9XG4gIGdldCBkaWZmaWN1bHR5KCkgeyByZXR1cm4gZGlmZmljdWx0eU5hbWU7IH1cbiAgY2hhbmdlRGlmZmljdWx0eShuYW1lOiBzdHJpbmcpIHsgc2V0RGlmZmljdWx0eShuYW1lKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy50b2FzdChgRGlmZmljdWx0eTogJHtuYW1lfS4gQXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUuYCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBnYWxsZXJ5IChzdGFyIGxvb2tzKVxuICBnYWxsZXJ5KCkge1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmFkZCgnZ2FsbGVyeScpOyB0aGlzLm5lY3JvLnNldEVuYWJsZWQoZmFsc2UpOyBjb25zdCB2aXM6IFVuaXRWaXN1YWxbXSA9IFtdOyBsZXQgdGVhbTogMCB8IDEgPSAwO1xuICAgIGNvbnN0IHJlYnVpbGQgPSAoKSA9PiB7IHZpcy5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHZpcy5sZW5ndGggPSAwOyBTT1VMUy5mb3JFYWNoKChzb3VsLCBpKSA9PiBbMSwgMiwgM10uZm9yRWFjaCgoc3QsIGopID0+IHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHNvdWwsIHRlYW0sIHN0KTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KChpIC0gMi41KSAqIDIuNSwgMCwgKGogLSAxKSAqIC0yLjQpOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAqIDAuODU7IHYucGxheSgnaWRsZScpOyB2aXMucHVzaCh2KTsgfSkpOyB9O1xuICAgIHJlYnVpbGQoKTsgdGhpcy5jYW1lcmEucG9zaXRpb24uc2V0KDAsIDUuNiwgLTE0LjUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIC0wLjQpKTsgdGhpcy5jYW1lcmEuZm92ID0gMC44NTtcbiAgICAod2luZG93IGFzIGFueSkuX19nYWxsZXJ5ID0geyBzZXRUZWFtOiAodDogMCB8IDEpID0+IHsgdGVhbSA9IHQ7IHJlYnVpbGQoKTsgfSwgdmlzIH07XG4gICAgbGV0IGxhc3QgPSBwZXJmb3JtYW5jZS5ub3coKTsgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG4gPSBwZXJmb3JtYW5jZS5ub3coKSwgZHQgPSBNYXRoLm1pbigwLjA1LCAobiAtIGxhc3QpIC8gMTAwMCk7IGxhc3QgPSBuOyB2aXMuZm9yRWFjaCgodikgPT4gdi51cGRhdGUoZHQpKTsgdGhpcy5zY2VuZS5yZW5kZXIoKTsgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBHYW1lIH0gZnJvbSAnLi9nYW1lLnRzJztcblxuY29uc3QgZyA9IG5ldyBHYW1lKCk7XG4od2luZG93IGFzIGFueSkuX19nYW1lID0gZzsgICAgICAgICAgICAgICAgICAgICAgIC8vIGhhbmR5IGZvciBkZWJ1Z2dpbmcgZnJvbSB0aGUgYnJvd3NlciBjb25zb2xlXG5nLmluaXQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2MnKSBhcyBIVE1MQ2FudmFzRWxlbWVudClcbiAgLnRoZW4oKCkgPT4geyBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIGwuc3R5bGUuZGlzcGxheSA9ICdub25lJzsgKHdpbmRvdyBhcyBhbnkpLl9fZ2FtZVJlYWR5ID0gdHJ1ZTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nYW1lLXJlYWR5JykpOyB9KVxuICAuY2F0Y2goKGUpID0+IHtcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIHsgbC5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnOyBsLnRleHRDb250ZW50ID0gJ0Vycm9yOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogZSk7IH1cbiAgICBjb25zb2xlLmVycm9yKGUpO1xuICB9KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7OztBQW9DTyxNQUFNLFdBQW9CO0FBQUEsSUFDL0IsT0FBTztBQUFBLE1BQ0wsU0FBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxHQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxLQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFFBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEtBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsTUFDOUcsUUFBVyxFQUFFLElBQUksS0FBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sS0FBTSxPQUFPLEdB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LElBQUksR0FBRyxJQUFJLElBQUksS0FBSztBQUMzQixRQUFFLEtBQUs7QUFBRyxRQUFFLE9BQVEsSUFBSSxLQUFLLEtBQU0sQ0FBQztBQUFHLFFBQUUsVUFBVTtBQUFHLFFBQUUsT0FBTyxHQUFHLElBQUk7QUFBRyxRQUFFLE9BQU8sR0FBRyxJQUFJO0FBQUcsUUFBRSxPQUFPO0FBQUcsUUFBRSxRQUFRO0FBQUEsSUFDcEg7QUFDQSxRQUFJLE9BQU87QUFBRyxRQUFJLFdBQVc7QUFBTSxXQUFPO0FBQUEsRUFDNUM7QUFJQSxNQUFNLGVBQTRCO0FBQUEsSUFDaEMsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxHQUFHLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUMzRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE9BQU8sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQ3pMLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsT0FBTyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUNySixFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxHQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsR0FBSyxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQ3BMLEVBQUUsTUFBTSxTQUFTLEdBQUcsSUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsR0FBSyxHQUFHLEtBQUs7QUFBQSxJQUMvSSxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxFQUN4TjtBQUNBLE1BQU0sbUJBQWdDO0FBQUE7QUFBQSxJQUNwQyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDbEUsRUFBRSxNQUFNLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQ3hNLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEVBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsR0FBSyxLQUFLLElBQUk7QUFBQSxJQUNyTSxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQ25ILEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUN0SSxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQ3JILEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQ25OLEVBQUUsTUFBTSxTQUFTLEdBQUcsR0FBRyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLEVBQ3ZOO0FBQ0EsTUFBTSxpQkFBOEI7QUFBQTtBQUFBLElBQ2xDLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEdBQUcsR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUMxSCxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQ3ZLLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLEtBQUssS0FBSyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUs7QUFBQSxJQUN6TSxFQUFFLE1BQU0sVUFBVSxHQUFHLE9BQU8sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQzVHLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsT0FBTyxHQUFHLEVBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLEVBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQ2xQLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQzlPLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFB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LEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxLQUFNLEdBQUc7QUFBRztBQUFBLFFBQzlMLEtBQUs7QUFBWSxlQUFLLEtBQUssTUFBTSxLQUFLLFlBQVksTUFBTSxHQUFHLEdBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsS0FBSyxNQUFNLEVBQUU7QUFBRyxXQUFDLE1BQU0sTUFBTSxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksS0FBSyxPQUFPLElBQUksSUFBSSxDQUFDO0FBQUc7QUFBQSxRQUMxTSxLQUFLO0FBQVcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEdBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsS0FBSyxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ25HLEtBQUs7QUFBWSxlQUFLLEtBQUssTUFBTSxNQUFNLFlBQVksSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDdEcsS0FBSztBQUFZLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLE1BQU0sWUFBWSxNQUFNLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQzdILEtBQUs7QUFBWSxlQUFLLEtBQUssVUFBVTtBQUFHLFdBQUMsS0FBSyxLQUFLLEtBQUssSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsS0FBSyxHQUFHLEVBQUU7QUFBRztBQUFB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LElBQUksR0FBRyxJQUFJO0FBQUEsZUFDMUQsS0FBSyxVQUFVLE9BQU87QUFBRSxjQUFNLElBQUksS0FBSyxJQUFJO0FBQUksVUFBRSxTQUFTLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxDQUFDLENBQUMsSUFBSTtBQUFNLFVBQUUsU0FBUyxJQUFJO0FBQUssYUFBSyxLQUFLLENBQUMsRUFBRSxTQUFTLElBQUksS0FBSyxJQUFJLENBQUMsSUFBSTtBQUFLLGFBQUssS0FBSyxDQUFDLEVBQUUsU0FBUyxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSTtBQUFLLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLENBQUMsSUFBSTtBQUFBLE1BQUssV0FDcFAsS0FBSyxVQUFVLFVBQVU7QUFBRSxjQUFNLElBQUksSUFBSSxNQUFNLFFBQVEsSUFBSSxPQUFPLE9BQU8sTUFBTSxLQUFLLElBQUksSUFBSSxJQUFJLE9BQU8sSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxLQUFLLENBQUM7QUFBRyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLEtBQUssQ0FBQztBQUFBLE1BQUcsV0FDMU4sS0FBSyxVQUFVLFNBQVM7QUFBRSxjQUFNLElBQUksSUFBSSxLQUFLLElBQUksSUFBSTtBQUFJLFVBQUUsUUFBUSxPQUFPLE9BQU8sT0FBTyxDQUFDO0FBQUcsVUFBRSxTQUFTLEtBQUssSUFBSSxLQUFLO0FBQUEsTUFBSyxXQUMxSCxLQUFLLFVBQVUsU0FBUztBQUFFLGNBQU0sSUFBSSxJQUFJO0FBQUcsVUFBRSxTQUFTLElBQUksQ0FBQyxLQUFLLEtBQUssSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU87QUFBRyxVQUFFLFNBQVMsSUFBSSxPQUFPO0FBQUEsTUFBRyxXQUM5SCxLQUFLLFVBQVUsU0FBUztBQUFFLFVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLENBQUMsQ0FBQyxJQUFJ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
