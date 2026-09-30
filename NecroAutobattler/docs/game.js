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

  // core/endless.ts
  var ENDLESS_ID = "endless";
  var ENDLESS_PACK_EVERY = 10;
  var MAX_UNITS = 12;
  var TUNE = { start: 5, slope: 3, lateSlope: 0.8, maxBudget: 150, powerSlope: 0.03, champion: 1 };
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
  var endlessMode = false;
  var enemyPower = (wave = 1) => endlessMode ? endlessPower(wave) : power;
  var isEndless = () => endlessMode;
  var AUTHORED = DIFFICULTY.normal.map(parseWave);
  function setStageDifficulty(stage, name) {
    const st = stageById(stage);
    if (!DIFFS.includes(name)) return;
    endlessMode = false;
    currentStageId = st.id;
    difficultyName = name;
    power = st.power[name];
    AUTHORED.length = 0;
    st.lists[name].forEach((w) => AUTHORED.push(parseWave(w)));
  }
  function setEndless() {
    endlessMode = true;
    currentStageId = ENDLESS_ID;
    difficultyName = "endless";
    power = 1;
    AUTHORED.length = 0;
  }
  function setDifficulty(name) {
    setStageDifficulty(currentStageId, name);
  }
  function enemyWave(wave, stageSeed = 0) {
    if (endlessMode) return endlessWave(wave, stageSeed);
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
  var ENDLESS_LEN = 300;
  var ENDLESS_RULES = { curve: Array.from({ length: ENDLESS_LEN }, (_, i) => CURVES.doc[Math.min(i, CURVES.doc.length - 1)]), merge: "handIntoOneStar", stageWaves: ENDLESS_LEN, normalDrawWaves: [2, 3, 4, 5] };

  // core/packs.ts
  var RARITY_OF = { warrior: "common", goblin: "common", archer: "rare", knight: "rare", ogre: "epic", barbarian: "epic" };
  var PACK_TIERS = 3;

  // core/save.ts
  var DECK_SIZE = 6;
  var KEY = "necro-save";
  var VERSION = 1;
  var DIFFICULTIES = ["easy", "normal", "hard", "nightmare"];
  function defaultSave() {
    const souls = {};
    for (const id of SOULS) souls[id] = { level: 1, copies: 0 };
    return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls, settings: { music: true, sfx: true }, difficulty: "normal", stage: "crypt", seen: [], packs: [], nextPackId: 1, clears: {}, replayMeter: 0, endless: { best: 0 } };
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
      return { snap: { v: VERSION2, seed: x.seed, attempt: x.attempt, stage: typeof x.stage === "string" ? x.stage : "crypt", difficulty: x.difficulty, phase: draft ? "draft" : "build", draft, state: x.state, startBest: Number.isInteger(x.startBest) && x.startBest >= 0 && x.startBest <= 9999 ? x.startBest : void 0 }, state };
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
      ["warrior", "SkeletonWarrior.glb", "SkeletonWarrior_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Cheer" }, 1.05, 1, { flavor: { clips: [{ clip: "Trip", emote: "!" }, { clip: "Bonk", emote: "?" }, { clip: "Wobble", emote: "sweat" }, { clip: "Wave", emote: "sparkle" }], min: 8, max: 15 }, cheers: [{ clip: "Cheer", emote: "sparkle" }, { clip: "Wave", emote: "sparkle" }, { clip: "Trip", emote: "!" }], eyes: "SkeletonWarrior_eyes.png" }],
      ["archer", "SkeletonArcher.glb", "SkeletonArcher_enemy.jpg", { idle: "Idle", run: "Run", attack: "Shoot", death: "Death", spawn: "Spawn", cheer: "Flex" }, 1.05, 1, { flavor: { clips: [{ clip: "Flex", emote: "sparkle" }, { clip: "DoubleBiceps", emote: "sparkle" }, { clip: "BoneCrack" }, { clip: "BowTwirl", emote: "sparkle" }], min: 8, max: 15 }, cheers: [{ clip: "Flex", emote: "sparkle" }, { clip: "DoubleBiceps", emote: "sparkle" }, { clip: "BowTwirl", emote: "sparkle" }], eyes: "SkeletonArcher_eyes.png" }],
      ["ogre", "Ogre.glb", "Ogre_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Cheer" }, 1.1, 1.12, { starScale: [1, 1.3, 1.65], flavor: { clips: [{ clip: "Yawn", emote: "zzz" }], min: 9, max: 16 }, spawnEmote: "zzz", eyes: "Ogre_eyes.png" }]
    ];
    await Promise.all(defs.map(async ([soul, glb, enemy, clips, top, scale, extra]) => {
      const container = await BABYLON.SceneLoader.LoadAssetContainerAsync("assets/", glb, scene);
      A.tripo[soul] = { container, enemyTex: new BABYLON.Texture("assets/" + enemy, scene, false, false), clips, matCache: {}, top, scale, ...extra || {}, eyeTex: extra && extra.eyes ? new BABYLON.Texture("assets/" + extra.eyes, scene, false, false) : void 0 };
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

  // ui/portraits.ts
  var PORTRAIT = { warrior: "assets/portraits/warrior_head.png", archer: "assets/portraits/archer_head.png", ogre: "assets/portraits/ogre_head.png" };
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
        ov.innerHTML = `<div class="box"><h2>Victory Draft</h2><div class="sub">Wave cleared. Dominion is now ${s.cap}. Keep one:</div><div class="row">${g2.draft.map((soul, i) => `<div class="card big${hasArt(soul) ? " art" : ""}" data-i="${i}"${hasArt(soul) ? ` style="border-color:${rarityColor(soul)}"` : ""}><div class="cost">${cost(soul, 1)}</div>${hasArt(soul) ? portraitHtml(soul) : ICON[soul]}<div class="nm">${SOUL_NAME[soul]}</div><div class="role">${ROLE_TEXT[soul]}</div></div>`).join("")}</div></div>`;
        ov.querySelectorAll(".card").forEach((c) => c.onclick = () => g2.pickDraft(+c.dataset.i));
      } else if (ph === "won" || ph === "lost") {
        const rw = ph === "won" ? g2.reward : null, sk = (n) => skullImgs(n);
        const unlockHtml = rw && rw.unlocked && rw.unlocked.length ? `<div class="sub" style="color:#7ef2c8;font-weight:700">${iconImg("check")} Unlocked: ${rw.unlocked.map((k) => describeUnlock(k)).join(" \xB7 ")}</div>` : "";
        const rewardHtml = unlockHtml + (rw ? `<div class="sub" style="color:#ffd24a;font-weight:700">${rw.pack ? rw.first ? `${iconImg("shop")} First clear! You earned a ${sk(rw.pack.tier)} Soul Pack.` : `${iconImg("shop")} Replay reward: a ${sk(rw.pack.tier)} Soul Pack.` : `Replay progress ${rw.replayMeter}/${rw.replayNeeded} toward a Soul Pack.`}</div>` : "");
        if (ph === "lost" && isEndless() && g2.endless) {
          const e = g2.endless, rec = e.cleared > e.startBest;
          ov.className = "show";
          ov.innerHTML = `<div class="box"><h2>Run over</h2><div class="sub">You cleared ${e.cleared} wave${e.cleared === 1 ? "" : "s"}. ${rec ? '<b style="color:#ffd24a">New best depth!</b>' : "Best: wave " + Math.max(e.startBest, e.cleared) + "."}</div>${e.packs ? `<div class="sub" style="color:#ffd24a;font-weight:700">${iconImg("shop")} ${e.packs} Soul Pack${e.packs === 1 ? "" : "s"} earned this run.</div>` : '<div class="sub">Clear wave 10 to earn a Soul Pack.</div>'}<div class="row">${e.packs ? '<button id="toShop" class="go">Open pack</button>' : ""}<button id="again" class="${e.packs ? "blue" : "go"}">Go again</button><button id="toHome" class="blue">Home</button></div></div>`;
          $("again").onclick = () => g2.newEndless();
          $("toHome").onclick = () => window.dispatchEvent(new Event("necro-go-home"));
          const ts2 = document.getElementById("toShop");
          if (ts2) ts2.onclick = () => window.dispatchEvent(new Event("necro-go-shop"));
        } else {
          ov.className = "show";
          ov.innerHTML = `<div class="box"><h2>${ph === "won" ? "Stage cleared!" : "Stage lost"}</h2><div class="sub">${g2.lastBattle}</div>${rewardHtml}<div class="row">${rw && rw.pack ? '<button id="toShop" class="go">Open pack</button>' : ""}<button id="again" class="${rw && rw.pack ? "blue" : "go"}">${ph === "won" ? "Play again" : "Try again"}</button><button id="toHome" class="blue">Home</button></div></div>`;
          $("again").onclick = () => g2.newRun();
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
      if (snap.stage === ENDLESS_ID) {
        setEndless();
        const done = Math.max(0, state.wave - 1);
        this.endless = { startBest: (_a = snap.startBest) != null ? _a : loadSave().endless.best, cleared: done, packs: Math.floor(done / ENDLESS_PACK_EVERY) };
      } else {
        setStageDifficulty(snap.stage, snap.difficulty);
        this.endless = null;
      }
      this.arena.setTheme(currentStageId);
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
      this.endless = null;
      const sv = loadSave(), pl = playable(sv);
      setStageDifficulty(pl.stage, pl.difficulty);
      this.arena.setTheme(currentStageId);
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
    /** Fresh Endless Depths run (Home > Endless Depths calls this): same rules as a stage, but the waves never stop and the enemy keeps growing. */
    newEndless() {
      this.startEndless(new URLSearchParams(location.search).get("seed") ? this.seed : Math.floor(Math.random() * 1e6) + 1);
    }
    startEndless(seed) {
      this.cine = false;
      this.reward = null;
      this.flushTweens();
      if (this.necro) this.necro.revive();
      this.seed = seed;
      this.attempt = 0;
      const sv = loadSave();
      setEndless();
      this.arena.setTheme(ENDLESS_ID);
      this.endless = { startBest: sv.endless.best, cleared: 0, packs: 0 };
      this.s = newStage({ ...ENDLESS_RULES, pool: sv.deck }, seed);
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
          if (v) this.later(Math.random() * 0.35, () => v.play("cheer"));
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2dhbWUvYXJlbmEudHMiLCAiLi4vY29yZS9iYXR0bGUudHMiLCAiLi4vY29yZS9lbmRsZXNzLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9wYWNrcy50cyIsICIuLi9jb3JlL3NhdmUudHMiLCAiLi4vZ2FtZS9uZWNyb21hbmNlci50cyIsICIuLi9nYW1lL2F1ZGlvLnRzIiwgIi4uL2NvcmUvcnVuc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvdmlzdWFscy50cyIsICIuLi91aS9pY29ucy50cyIsICIuLi91aS9wb3J0cmFpdHMudHMiLCAiLi4vZ2FtZS91aS50cyIsICIuLi9nYW1lL2dhbWUudHMiLCAiLi4vZ2FtZS9tYWluLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBTSU5HTEUgU09VUkNFIE9GIFRSVVRIIGZvciBldmVyeSBudW1iZXIgdGhhdCBhZmZlY3RzIGNvbWJhdC5cbi8vIFRoZSBkZWJ1ZyBwYW5lbCBlZGl0cyBCQUxBTkNFIGxpdmU7IGByZXNldEJhbGFuY2UoKWAgcmVzdG9yZXMgdGhlc2UgZGVmYXVsdHMuXG4vLyBBbGwgdmFsdWVzIGFyZSBmaXJzdC1wYXNzIGd1ZXNzZXMgbWVhbnQgdG8gYmUgdHVuZWQgYnkgcGxheWluZyBhbmQgYnkgYG5vZGUgc2ltL2NhbXBhaWduLnRzYC5cblxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXRTdGF0cyB7XG4gIGhwOiBudW1iZXI7ICAgICAgICAgLy8gMS1zdGFyIGhpdCBwb2ludHNcbiAgZG1nOiBudW1iZXI7ICAgICAgICAvLyAxLXN0YXIgZGFtYWdlIHBlciBoaXQgKHBlciBhcnJvdyBmb3IgdGhlIEFyY2hlcilcbiAgaW50ZXJ2YWw6IG51bWJlcjsgICAvLyBzZWNvbmRzIGJldHdlZW4gYXR0YWNrc1xuICByYW5nZTogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyAoY2VudHJlIHRvIGNlbnRyZSlcbiAgc3BlZWQ6IG51bWJlcjsgICAgICAvLyBtZXRyZXMgcGVyIHNlY29uZFxuICBzaXplOiBudW1iZXI7ICAgICAgIC8vIGJvZHkgcmFkaXVzLCB1c2VkIGZvciBzcGFjaW5nIGFuZCB2aXN1YWxzXG4gIGFuaW1MZW46IG51bWJlcjsgICAgLy8gc2Vjb25kczogbGVuZ3RoIG9mIHRoaXMgdW5pdCdzIGF0dGFjayBjbGlwIGF0IG5vcm1hbCBzcGVlZFxuICBoaXRGcmFjOiBudW1iZXI7ICAgIC8vIDAtMTogaG93IGZhciBpbnRvIHRoZSBjbGlwIHRoZSBibG93IGxhbmRzIC8gdGhlIGFycm93IGlzIHJlbGVhc2VkXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQmFsYW5jZSB7XG4gIHN0YXRzOiBSZWNvcmQ8U291bElkLCBVbml0U3RhdHM+O1xuICBzdGFyOiB7XG4gICAgaHA6IG51bWJlcltdOyAgICAgLy8gbXVsdGlwbGllciBhdCAxLCAyLCAzIHN0YXJzXG4gICAgZG1nOiBudW1iZXJbXTtcbiAgICBzY2FsZTogbnVtYmVyW107ICAvLyB2aXN1YWwgc2l6ZVxuICB9O1xuICBwaGFsYW54OiB7IHJhZGl1czogbnVtYmVyOyBwZXJBbGx5OiBudW1iZXI7IG1heFN0YWNrczogbnVtYmVyIH07ICAgICAgICAgIC8vIFNrZWxldG9uIFdhcnJpb3JcbiAgbWFuYTogUGFydGlhbDxSZWNvcmQ8U291bElkLCB7IG1heDogbnVtYmVyOyBwZXJBdHRhY2s6IG51bWJlcjsgcGVySGl0OiBudW1iZXIgfT4+OyAvLyB1bml0cyBXSVRIIGEgc2tpbGw7IHRoZSByZXN0IGFyZSBwYXNzaXZlLW9ubHlcbiAgdm9sbGV5OiB7IHRhcmdldHM6IG51bWJlcjsgcHJvamVjdGlsZVNwZWVkOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAvLyBTa2VsZXRvbiBBcmNoZXIgc2tpbGw6IFNwbGl0IEFycm93XG4gIG9wcG9ydHVuaXN0OiB7IGJvbnVzOiBudW1iZXI7IHNlZWtSYWRpdXM6IG51bWJlcjsgd291bmRlZFdlaWdodDogbnVtYmVyIH07IC8vIEdvYmxpblxuICB0YXVudDogeyBkdXJhdGlvbjogbnVtYmVyOyByYWRpdXM6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEtuaWdodCBza2lsbFxuICBzbWFzaDogeyBtdWx0OiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE9ncmUgc2tpbGxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiBudW1iZXI7IG1heFN0YWNrczogbnVtYmVyOyByZXNldEFmdGVyOiBudW1iZXIgfTsgICAgICAvLyBCYXJiYXJpYW5cbiAgLyoqIFBMQUNFSE9MREVSIHBlcm1hbmVudC1sZXZlbCBncm93dGggKHBlciBsZXZlbCBhYm92ZSAxKS4gU2hvd24gb24gdGhlIFNvdWxzIHBhZ2U7IE5PVCBhcHBsaWVkIGluIGJhdHRsZXMgeWV0LiAqL1xuICBsZXZlbDogeyBocDogbnVtYmVyOyBkbWc6IG51bWJlcjsgY29waWVzVG9MZXZlbDogbnVtYmVyW10gfTtcbiAgc2ltOiB7IHNlcGFyYXRpb246IG51bWJlcjsgaGl0RnJhY3Rpb246IG51bWJlcjsgdGltZUxpbWl0OiBudW1iZXI7IHJldGFyZ2V0RXZlcnk6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVFM6IEJhbGFuY2UgPSB7XG4gIHN0YXRzOiB7XG4gICAgd2FycmlvcjogICB7IGhwOiA2MCwgIGRtZzogOCwgIGludGVydmFsOiAwLjksIHJhbmdlOiAwLjg1LCBzcGVlZDogMS40LCBzaXplOiAwLjI4LCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNDcgfSxcbiAgICBhcmNoZXI6ICAgIHsgaHA6IDQwLCAgZG1nOiA3LCAgaW50ZXJ2YWw6IDEuNywgcmFuZ2U6IDUuMCwgIHNwZWVkOiAxLjEsIHNpemU6IDAuMjYsIGFuaW1MZW46IDEuNSwgaGl0RnJhYzogMC43OCB9LFxuICAgIGdvYmxpbjogICAgeyBocDogNDUsICBkbWc6IDksICBpbnRlcnZhbDogMC44LCByYW5nZTogMC44LCAgc3BlZWQ6IDEuNywgc2l6ZTogMC4yNCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgICBrbmlnaHQ6ICAgIHsgaHA6IDEzMCwgZG1nOiA5LCAgaW50ZXJ2YWw6IDEuMSwgcmFuZ2U6IDAuOSwgIHNwZWVkOiAxLjAsIHNpemU6IDAuMzIsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAgb2dyZTogICAgICB7IGhwOiAxNzAsIGRtZzogMTYsIGludGVydmFsOiAxLjksIHJhbmdlOiAxLjA1LCBzcGVlZDogMC44LCBzaXplOiAwLjQyLCBhbmltTGVuOiAxLjIsIGhpdEZyYWM6IDAuNTUgfSxcbiAgICBiYXJiYXJpYW46IHsgaHA6IDc1LCAgZG1nOiA4LCAgaW50ZXJ2YWw6IDAuOTUsIHJhbmdlOiAwLjksIHNwZWVkOiAxLjUsIHNpemU6IDAuMzAsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gIH0sXG4gIC8vIFwiYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHlcIjogSFAgZ3Jvd3MgZmFzdGVyIHRoYW4gZGFtYWdlIHBlciBzdGFyXG4gIHN0YXI6IHsgaHA6IFsxLCAyLjAsIDMuMl0sIGRtZzogWzEsIDEuNSwgMi4wXSwgc2NhbGU6IFsxLCAxLjEyLCAxLjI1XSB9LFxuICBwaGFsYW54OiB7IHJhZGl1czogMi4wLCBwZXJBbGx5OiAwLjA4LCBtYXhTdGFja3M6IDMgfSxcbiAgLy8gbWFuYSBmaWxscyBmYXN0OiBhIGJhc2ljIGF0dGFjayBnaXZlcyBwZXJBdHRhY2ssIHRha2luZyBhIGhpdCBnaXZlcyBwZXJIaXQ7IGEgZnVsbCBiYXIgZmlyZXMgdGhlIHNraWxsIG9uIHRoZSBuZXh0IGF0dGFjaywgdGhlbiByZXNldHNcbiAgbWFuYToge1xuICAgIGFyY2hlcjogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTcGxpdCBBcnJvdyBhYm91dCBldmVyeSAzcmQgc2hvdFxuICAgIG9ncmU6ICAgeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTbWFzaCBhYm91dCBldmVyeSAzcmQgc3dpbmdcbiAgICBrbmlnaHQ6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMjUsIHBlckhpdDogMTIgfSwgICAgLy8gVGF1bnQgZXZlcnkgfjQgc3dpbmdzLCBzb29uZXIgd2hlbiBoZSBpcyBiZWluZyBoaXRcbiAgfSxcbiAgdm9sbGV5OiB7IHRhcmdldHM6IDMsIHByb2plY3RpbGVTcGVlZDogMTQgfSxcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IDAuNSwgc2Vla1JhZGl1czogNC4wLCB3b3VuZGVkV2VpZ2h0OiAxLjUgfSxcbiAgdGF1bnQ6IHsgZHVyYXRpb246IDMsIHJhZGl1czogNC41IH0sXG4gIHNtYXNoOiB7IG11bHQ6IDIuMCwgcmFkaXVzOiAxLjYgfSxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiAwLjEyLCBtYXhTdGFja3M6IDgsIHJlc2V0QWZ0ZXI6IDAuNiB9LFxuICBsZXZlbDogeyBocDogMC4wOCwgZG1nOiAwLjA4LCBjb3BpZXNUb0xldmVsOiBbNSwgMTAsIDIwLCA0MCwgODAsIDEyMCwgMjAwLCAzMDAsIDUwMF0gfSxcbiAgc2ltOiB7IHNlcGFyYXRpb246IDAuNiwgaGl0RnJhY3Rpb246IDAuNDcsIHRpbWVMaW1pdDogMTIwLCByZXRhcmdldEV2ZXJ5OiAwLjUgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBCQUxBTkNFOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRCYWxhbmNlKCk6IHZvaWQge1xuICBjb25zdCBmcmVzaDogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGZyZXNoKSBhcyAoa2V5b2YgQmFsYW5jZSlbXSkgKEJBTEFOQ0UgYXMgYW55KVtrXSA9IChmcmVzaCBhcyBhbnkpW2tdO1xufVxuXG5leHBvcnQgY29uc3QgUk9MRV9URVhUOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnQ2hlYXAgYW5kIGZhc3QuIFRvdWdoZXIgbmVhciBvdGhlciBXYXJyaW9ycy4nLFxuICBhcmNoZXI6ICdGcmFnaWxlLiBTa2lsbDogU3BsaXQgQXJyb3cgaGl0cyAzIGRpZmZlcmVudCBlbmVtaWVzLicsXG4gIGdvYmxpbjogJ0Zhc3QuIEhpdHMgaGFyZGVyIG9uIGVuZW1pZXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLicsXG4gIGtuaWdodDogJ1RhbmsuIFNraWxsOiBUYXVudCBwdWxscyBlbmVtaWVzIG9udG8gaGltLicsXG4gIG9ncmU6ICdTbG93LCBodWdlIGRhbWFnZS4gU2tpbGw6IFNtYXNoLCBhIGJpZyBhcmVhIHNsYW0uJyxcbiAgYmFyYmFyaWFuOiAnU3dpbmdzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgaGl0LicsXG59O1xuXG5leHBvcnQgY29uc3QgU09VTF9OQU1FOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnU2tlbGV0b24gV2FycmlvcicsIGFyY2hlcjogJ1NrZWxldG9uIEFyY2hlcicsIGdvYmxpbjogJ0dvYmxpbicsXG4gIGtuaWdodDogJ0tuaWdodCcsIG9ncmU6ICdPZ3JlJywgYmFyYmFyaWFuOiAnQmFyYmFyaWFuJyxcbn07XG5cbi8qKiBBYmlsaXR5IGJsdXJicyBmb3IgdGhlIFNvdWxzIHBhZ2UsIHdpdGggdGhlIGxpdmUgbnVtYmVycyBmaWxsZWQgaW4uICovXG5leHBvcnQgZnVuY3Rpb24gYWJpbGl0eUluZm8oc291bDogU291bElkKTogeyBraW5kOiAnc2tpbGwnIHwgJ3Bhc3NpdmUnOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZyB9IHtcbiAgY29uc3QgQiA9IEJBTEFOQ0UsIHBjdCA9ICh4OiBudW1iZXIpID0+IE1hdGgucm91bmQoeCAqIDEwMCkgKyAnJSc7XG4gIHN3aXRjaCAoc291bCkge1xuICAgIGNhc2UgJ3dhcnJpb3InOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdQaGFsYW54JywgdGV4dDogYFRha2VzICR7cGN0KEIucGhhbGFueC5wZXJBbGx5KX0gbGVzcyBkYW1hZ2UgZm9yIGVhY2ggb3RoZXIgU2tlbGV0b24gV2FycmlvciB3aXRoaW4gJHtCLnBoYWxhbngucmFkaXVzfW0gKHVwIHRvICR7Qi5waGFsYW54Lm1heFN0YWNrc30pLmAgfTtcbiAgICBjYXNlICdnb2JsaW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdPcHBvcnR1bmlzdCcsIHRleHQ6IGBEZWFscyAke3BjdChCLm9wcG9ydHVuaXN0LmJvbnVzKX0gbW9yZSBkYW1hZ2UgdG8gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2UsIGFuZCBwcmVmZXJzIHN1Y2ggdGFyZ2V0cy5gIH07XG4gICAgY2FzZSAnYmFyYmFyaWFuJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnRnJlbnp5JywgdGV4dDogYEF0dGFja3MgJHtwY3QoQi5mcmVuenkucGVyU3dpbmcpfSBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nICh1cCB0byAke0IuZnJlbnp5Lm1heFN0YWNrc30gdGltZXMpLmAgfTtcbiAgICBjYXNlICdhcmNoZXInOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU3BsaXQgQXJyb3cnLCB0ZXh0OiBgQmFzaWMgc2hvdHMgZmlyZSBvbmUgYXJyb3cuIFdoZW4gbWFuYSBpcyBmdWxsLCB0aGUgbmV4dCBzaG90IGZpcmVzIGF0IHVwIHRvICR7Qi52b2xsZXkudGFyZ2V0c30gZGlmZmVyZW50IGVuZW1pZXMuYCB9O1xuICAgIGNhc2UgJ2tuaWdodCc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdUYXVudCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgZW5lbWllcyB3aXRoaW4gJHtCLnRhdW50LnJhZGl1c31tIG11c3QgYXR0YWNrIGhpbSBmb3IgJHtCLnRhdW50LmR1cmF0aW9ufXMuYCB9O1xuICAgIGNhc2UgJ29ncmUnOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU21hc2gnLCB0ZXh0OiBgV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHN3aW5nIGRlYWxzICR7Qi5zbWFzaC5tdWx0fXggZGFtYWdlIGFuZCBoaXRzIGVuZW1pZXMgbmVhciB0aGUgdGFyZ2V0IGZvciA2MCUgYXMgbXVjaC5gIH07XG4gIH1cbn1cbiIsICIvLyBEZXNpZ24gZGF0YSBzdHJhaWdodCBmcm9tIHRoZSBwbGFuIGRvYy4gQW55dGhpbmcgbWFya2VkIFBMQUNFSE9MREVSIGlzIG5vdCBpbiB0aGUgZG9jIHlldC5cblxuZXhwb3J0IHR5cGUgU291bElkID0gJ3dhcnJpb3InIHwgJ2FyY2hlcicgfCAnZ29ibGluJyB8ICdrbmlnaHQnIHwgJ29ncmUnIHwgJ2JhcmJhcmlhbic7XG5cbmV4cG9ydCBjb25zdCBTT1VMUzogU291bElkW10gPSBbJ3dhcnJpb3InLCAnYXJjaGVyJywgJ2dvYmxpbicsICdrbmlnaHQnLCAnb2dyZScsICdiYXJiYXJpYW4nXTtcblxuLyoqIERvbWluaW9uIGNvc3QgcGVyIHN0YXIgbGV2ZWw6IGluZGV4IDAgPSAxIHN0YXIsIDEgPSAyIHN0YXJzLCAyID0gMyBzdGFycyAoMyBzdGFycyBpcyB0aGUgbWF4KS4gKi9cbmV4cG9ydCBjb25zdCBDT1NUOiBSZWNvcmQ8U291bElkLCBudW1iZXJbXT4gPSB7XG4gIHdhcnJpb3I6IFsyLCAzLCA0XSxcbiAgYXJjaGVyOiBbNCwgNiwgOV0sXG4gIGdvYmxpbjogWzMsIDQsIDZdLFxuICBrbmlnaHQ6IFs1LCA3LCAxMF0sXG4gIG9ncmU6IFs3LCAxMCwgMTVdLFxuICBiYXJiYXJpYW46IFs1LCA3LCAxMF0sIC8vIFBMQUNFSE9MREVSOiB0aGUgZG9jIGhhcyBubyBjb3N0IGZvciB0aGUgc2l4dGggU291bCB5ZXRcbn07XG5cbmV4cG9ydCBjb25zdCBNQVhfU1RBUiA9IDM7XG5leHBvcnQgY29uc3QgR1JJRF9DRUxMUyA9IDEyOyAvLyA0IHggM1xuXG4vKiogRG9taW5pb24gY2FwIHBlciB3YXZlIChpbmRleCAwID0gd2F2ZSAxKS4gKi9cbmV4cG9ydCBjb25zdCBDVVJWRVM6IFJlY29yZDxzdHJpbmcsIG51bWJlcltdPiA9IHtcbiAgLy8gTE9DS0VEIChjb25maXJtZWQpOiArNCBmb3Igd2F2ZXMgMi01LCB0aGVuICszIGZvciB3YXZlcyA2LTEwIC0+IDQwXG4gIGRvYzogWzksIDEzLCAxNywgMjEsIDI1LCAyOCwgMzEsIDM0LCAzNywgNDBdLFxuICAvLyBOT1QgVVNFRDogbWlzcmVtZW1iZXJlZCB2YXJpYW50ICgrMyB0aHJvdWdoIHdhdmUgNiwgdGhlbiArMikgdGhhdCBvbmx5IHJlYWNoZXMgMzIuIEtlcHQgZm9yIGNvbXBhcmlzb24gb25seS5cbiAgcmVjYWxsZWQ6IFs5LCAxMiwgMTUsIDE4LCAyMSwgMjQsIDI2LCAyOCwgMzAsIDMyXSxcbn07XG5cbmV4cG9ydCBjb25zdCBIRUFSVFMgPSAzO1xuZXhwb3J0IGNvbnN0IFNUQVJUX0hBTkQgPSA0O1xuZXhwb3J0IGNvbnN0IFdBVkVTID0gMTA7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnVsZXMge1xuICAvKiogRG9taW5pb24gY2FwIHBlciB3YXZlLiAqL1xuICBjdXJ2ZTogbnVtYmVyW107XG4gIC8qKlxuICAgKiAnZGVwbG95ZWRPbmx5Jzogb25seSB0d28gZGVwbG95ZWQgdW5pdHMgb2YgdGhlIHNhbWUgc3RhciBjYW4gbWVyZ2UgKGRvYyBhcyB3cml0dGVuKS5cbiAgICogJ2hhbmRJbnRvT25lU3Rhcic6IGFkZGl0aW9uYWxseSBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIGJlIHBsYXllZCBvbnRvIGEgZGVwbG95ZWRcbiAgICogMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bCB0byBtZXJnZSBpbW1lZGlhdGVseSAocGF5cyBvbmx5IHRoZSBjb3N0IGRpZmZlcmVuY2UpLlxuICAgKi9cbiAgbWVyZ2U6ICdkZXBsb3llZE9ubHknIHwgJ2hhbmRJbnRvT25lU3Rhcic7XG4gIC8qKiBDYXJkLWluZmxvdyBrbm9icyAoYWxsIG9wdGlvbmFsOyBkZWZhdWx0cyByZXByb2R1Y2UgdGhlIGRvYykuICovXG4gIHN0YXJ0SGFuZD86IG51bWJlcjsgICAgICAgICAgICAvLyBkZWZhdWx0IDRcbiAgZHJhZnRQaWNrcz86IG51bWJlcjsgICAgICAgICAgIC8vIGNhcmRzIGtlcHQgZnJvbSB0aGUgMy1jYXJkIFZpY3RvcnkgRHJhZnQsIGRlZmF1bHQgMVxuICBub3JtYWxEcmF3V2F2ZXM/OiBudW1iZXJbXTsgICAgLy8gd2F2ZXMgKGJlaW5nIGVudGVyZWQpIHRoYXQgYWxzbyBnaXZlIHRoZSBub3JtYWwgcmFuZG9tIGRyYXc7IGRlZmF1bHQgPSBhbGxcbiAgLyoqIFNvdWxzIHRoaXMgcnVuIG1heSBkcmF3IGZyb20gKHRoZSBlcXVpcHBlZCBTb3VsIERlY2ssIG1heCA2KS4gRGVmYXVsdDogZXZlcnkgU291bC4gKi9cbiAgcG9vbD86IFNvdWxJZFtdO1xuICBzdGFnZVdhdmVzPzogbnVtYmVyOyAgICAgICAgICAgLy8gd2F2ZXMgaW4gdGhpcyBzdGFnZTsgZGVmYXVsdCAxMCAodGhlIHBsYXlhYmxlIHByb3RvdHlwZSB1c2VzIDMpXG59XG5cbmV4cG9ydCBjb25zdCBHUklEX0NPTFMgPSA0LCBHUklEX1JPV1MgPSAzOyAgIC8vIDQgeCAzID0gR1JJRF9DRUxMUzsgY29sdW1uIEdSSURfQ09MUy0xIGlzIHRoZSBmcm9udCBsaW5lXG4iLCAiLy8gU21hbGwgc2VlZGVkIFJORyAobXVsYmVycnkzMikuIFNhbWUgc2VlZCAtPiBzYW1lIHJ1biwgc28gYW55IGJ1ZyByZXBvcnQgaXMgcmVwcm9kdWNpYmxlLlxuLy8gYHN0YXRlKClgIC8gdGhlIGByZXN1bWVgIGFyZ3VtZW50IGxldCBhIHNhdmVkIHJ1biBjb250aW51ZSBkcmF3aW5nIGV4YWN0bHkgdGhlIGNhcmRzIGl0IHdvdWxkIGhhdmUgZHJhd24uXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgbmV4dCgpOiBudW1iZXI7ICAgICAgICAgICAgICAvLyBbMCwgMSlcbiAgaW50KG46IG51bWJlcik6IG51bWJlcjsgICAgICAvLyBbMCwgbilcbiAgcGljazxUPihpdGVtczogcmVhZG9ubHkgVFtdKTogVDtcbiAgc2VlZDogbnVtYmVyO1xuICBzdGF0ZSgpOiBudW1iZXI7ICAgICAgICAgICAgIC8vIHRoZSBnZW5lcmF0b3IncyBjdXJyZW50IHBvc2l0aW9uLCBmb3Igc2F2aW5nIGEgcnVuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYWtlUm5nKHNlZWQ6IG51bWJlciwgcmVzdW1lPzogbnVtYmVyKTogUm5nIHtcbiAgbGV0IGEgPSAocmVzdW1lID8/IHNlZWQpID4+PiAwO1xuICBjb25zdCBuZXh0ID0gKCkgPT4ge1xuICAgIGEgPSAoYSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gYTtcbiAgICB0ID0gTWF0aC5pbXVsKHQgXiAodCA+Pj4gMTUpLCB0IHwgMSk7XG4gICAgdCBePSB0ICsgTWF0aC5pbXVsKHQgXiAodCA+Pj4gNyksIHQgfCA2MSk7XG4gICAgcmV0dXJuICgodCBeICh0ID4+PiAxNCkpID4+PiAwKSAvIDQyOTQ5NjcyOTY7XG4gIH07XG4gIHJldHVybiB7XG4gICAgc2VlZCxcbiAgICBuZXh0LFxuICAgIGludDogKG4pID0+IE1hdGguZmxvb3IobmV4dCgpICogbiksXG4gICAgcGljazogKGl0ZW1zKSA9PiBpdGVtc1tNYXRoLmZsb29yKG5leHQoKSAqIGl0ZW1zLmxlbmd0aCldLFxuICAgIHN0YXRlOiAoKSA9PiBhLFxuICB9O1xufVxuIiwgIi8vIFB1cmUgZ2FtZSBydWxlcyBmb3Igb25lIHN0YWdlLiBObyBncmFwaGljcywgbm8gY29tYmF0OiBqdXN0IGNhcmRzLCBEb21pbmlvbiwgZ3JpZCwgbWVyZ2UsIHdhdmVzLCBoZWFydHMuXG4vLyBFdmVyeSBtdXRhdGlvbiBnb2VzIHRocm91Z2ggYSBmdW5jdGlvbiBoZXJlIGFuZCBhcHBlbmRzIHRvIHN0YXRlLmxvZywgc28gcnVucyBjYW4gYmUgcmVwbGF5ZWQgYW5kIGluc3BlY3RlZC5cblxuaW1wb3J0IHsgQ09TVCwgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMsIFNUQVJUX0hBTkQsIFdBVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMsIFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdCB7IGlkOiBudW1iZXI7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7IGZyZXNoPzogYm9vbGVhbiB9ICAgLy8gZnJlc2ggPSBzdW1tb25lZCB0aGlzIGJ1aWxkIHBoYXNlXG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdGUge1xuICBydWxlczogUnVsZXM7XG4gIHJuZzogUm5nO1xuICB3YXZlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAvLyAxLWJhc2VkXG4gIGhlYXJ0czogbnVtYmVyO1xuICBjYXA6IG51bWJlcjtcbiAgaGFuZDogU291bElkW107XG4gIHVuaXRzOiBVbml0W107XG4gIG5leHRJZDogbnVtYmVyO1xuICBkaXNjYXJkVXNlZDogYm9vbGVhbjsgICAgICAgICAvLyBvbmNlLXBlci1idWlsZC1waGFzZSByZWRyYXdcbiAgc3RhdHVzOiAnYnVpbGRpbmcnIHwgJ3dvbicgfCAnbG9zdCc7XG4gIGxvZzogc3RyaW5nW107XG4gIHN0YXRzOiB7IGRyYXduOiBudW1iZXI7IGRpc2NhcmRlZDogbnVtYmVyOyBkaXNtaXNzZWQ6IG51bWJlcjsgbWVyZ2VzOiBudW1iZXI7IGZhaWx1cmVzOiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGNvc3QgPSAoc291bDogU291bElkLCBzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG5leHBvcnQgY29uc3QgY2FyZHNJbiA9IChzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gMiAqKiAoc3RhciAtIDEpOyAgICAgLy8gY2FyZHMgYSB1bml0IGlzIFwid29ydGhcIlxuZXhwb3J0IGNvbnN0IGRvbWluaW9uVXNlZCA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNvc3QodS5zb3VsLCB1LnN0YXIpLCAwKTtcbmV4cG9ydCBjb25zdCBkb21pbmlvbkZyZWUgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5jYXAgLSBkb21pbmlvblVzZWQocyk7XG5cbmZ1bmN0aW9uIGxvZyhzOiBTdGF0ZSwgbXNnOiBzdHJpbmcpIHsgcy5sb2cucHVzaChgW3cke3Mud2F2ZX1dICR7bXNnfWApOyB9XG4vKiogVGhlIFNvdWxzIHRoaXMgcnVuIGRyYXdzIGZyb206IHRoZSBlcXVpcHBlZCBkZWNrLCBvciBldmVyeXRoaW5nIGlmIG5vIGRlY2sgd2FzIGdpdmVuLiAqL1xuZXhwb3J0IGNvbnN0IHBvb2xPZiA9IChzOiBTdGF0ZSk6IFNvdWxJZFtdID0+IChzLnJ1bGVzLnBvb2wgJiYgcy5ydWxlcy5wb29sLmxlbmd0aCA/IHMucnVsZXMucG9vbCA6IFNPVUxTKTtcbmZ1bmN0aW9uIGRyYXcoczogU3RhdGUsIHdoeTogc3RyaW5nLCBub3Q/OiBTb3VsSWQpOiBTb3VsSWQge1xuICBjb25zdCBhbGwgPSBwb29sT2YocyksIG90aGVycyA9IG5vdCA/IGFsbC5maWx0ZXIoKHgpID0+IHggIT09IG5vdCkgOiBhbGw7XG4gIGNvbnN0IHBvb2wgPSBvdGhlcnMubGVuZ3RoID8gb3RoZXJzIDogYWxsOyAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBzd2FwIG5ldmVyIGhhbmRzIHlvdSBiYWNrIHRoZSBTb3VsIHlvdSBnYXZlIHVwICh1bmxlc3MgaXQgaXMgdGhlIG9ubHkgb25lIGVxdWlwcGVkKVxuICBjb25zdCBjID0gcy5ybmcucGljayhwb29sKTtcbiAgcy5oYW5kLnB1c2goYyk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmF3ICR7Y30gKCR7d2h5fSlgKTtcbiAgcmV0dXJuIGM7XG59XG5cbi8qKiBBIG5ldyBidWlsZCBwaGFzZSBiZWdpbnM6IHRoZSBvbmNlLXBlci1waGFzZSBzd2FwIGNvbWVzIGJhY2sgYW5kIG5vdGhpbmcgY291bnRzIGFzIFwic3VtbW9uZWQgdGhpcyByb3VuZFwiLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5ld1BoYXNlKHM6IFN0YXRlKTogdm9pZCB7XG4gIHMuZGlzY2FyZFVzZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIHUuZnJlc2ggPSBmYWxzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld1N0YWdlKHJ1bGVzOiBSdWxlcywgc2VlZDogbnVtYmVyKTogU3RhdGUge1xuICBjb25zdCBzOiBTdGF0ZSA9IHtcbiAgICBydWxlcywgcm5nOiBtYWtlUm5nKHNlZWQpLCB3YXZlOiAxLCBoZWFydHM6IEhFQVJUUywgY2FwOiBydWxlcy5jdXJ2ZVswXSwgaGFuZDogW10sIHVuaXRzOiBbXSwgbmV4dElkOiAxLFxuICAgIGRpc2NhcmRVc2VkOiBmYWxzZSwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IFtdLFxuICAgIHN0YXRzOiB7IGRyYXduOiAwLCBkaXNjYXJkZWQ6IDAsIGRpc21pc3NlZDogMCwgbWVyZ2VzOiAwLCBmYWlsdXJlczogMCB9LFxuICB9O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IChydWxlcy5zdGFydEhhbmQgPz8gU1RBUlRfSEFORCk7IGkrKykgZHJhdyhzLCAnc3RhcnRpbmcgaGFuZCcpO1xuICByZXR1cm4gcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZWVDZWxsKHM6IFN0YXRlKTogbnVtYmVyIHtcbiAgY29uc3QgdGFrZW4gPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmICghdGFrZW4uaGFzKGMpKSByZXR1cm4gYztcbiAgcmV0dXJuIC0xO1xufVxuXG4vLyAtLS0tIGJ1aWxkLXBoYXNlIGFjdGlvbnMgKGVhY2ggcmV0dXJucyB0cnVlIHdoZW4gaXQgaGFwcGVuZWQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XTtcbiAgcmV0dXJuIHNvdWwgIT09IHVuZGVmaW5lZCAmJiBmcmVlQ2VsbChzKSA+PSAwICYmIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2VsbEZyZWUoczogU3RhdGUsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICByZXR1cm4gY2VsbCA+PSAwICYmIGNlbGwgPCBHUklEX0NFTExTICYmICFzLnVuaXRzLnNvbWUoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7XG59XG5cbi8qKiBTdW1tb24gYSBoYW5kIGNhcmQgb250byBhIHNwZWNpZmljIGZyZWUgY2VsbCAoZGVmYXVsdDogdGhlIGZpcnN0IGZyZWUgb25lKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgY2VsbD86IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN1bW1vbihzLCBoYW5kSWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoY2VsbCAhPT0gdW5kZWZpbmVkICYmICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdTogVW5pdCA9IHsgaWQ6IHMubmV4dElkKyssIHNvdWwsIHN0YXI6IDEsIGNlbGw6IGNlbGwgPz8gZnJlZUNlbGwocyksIGZyZXNoOiB0cnVlIH07XG4gIHMudW5pdHMucHVzaCh1KTtcbiAgbG9nKHMsIGBzdW1tb24gJHtzb3VsfSAxKiAtPiBjZWxsICR7dS5jZWxsfSAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZURlcGxveWVkKGE6IFVuaXQsIGI6IFVuaXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuaWQgIT09IGIuaWQgJiYgYS5zb3VsID09PSBiLnNvdWwgJiYgYS5zdGFyID09PSBiLnN0YXIgJiYgYS5zdGFyIDwgTUFYX1NUQVI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZURlcGxveWVkKHM6IFN0YXRlLCBhSWQ6IG51bWJlciwgYklkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYUlkKSwgYiA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYklkKTtcbiAgaWYgKCFhIHx8ICFiIHx8ICFjYW5NZXJnZURlcGxveWVkKGEsIGIpKSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigodSkgPT4gdS5pZCAhPT0gYi5pZCk7XG4gIGEuZnJlc2ggPSAhIShhLmZyZXNoIHx8IGIuZnJlc2gpO1xuICBhLnN0YXIrKztcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZSAke2Euc291bH0gJHthLnN0YXIgLSAxfSorJHthLnN0YXIgLSAxfSogLT4gJHthLnN0YXJ9KiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSwgY2VsbHMgJHtzLnVuaXRzLmxlbmd0aH0vJHtHUklEX0NFTExTfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiAnaGFuZEludG9PbmVTdGFyJyBydWxlOiBwbGF5IGEgMS1zdGFyIGNhcmQgb250byBhIGRlcGxveWVkIDEtc3RhciB1bml0IG9mIHRoZSBzYW1lIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5ydWxlcy5tZXJnZSAhPT0gJ2hhbmRJbnRvT25lU3RhcicpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XSwgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCFzb3VsIHx8ICF1IHx8IHUuc291bCAhPT0gc291bCB8fCB1LnN0YXIgIT09IDEpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIGNvc3Qoc291bCwgMikgLSBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5NZXJnZUZyb21IYW5kKHMsIGhhbmRJZHgsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICB1LnN0YXIgPSAyO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlLWZyb20taGFuZCAke3NvdWx9IC0+ICR7dS5zb3VsfSAyKiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkaXNtaXNzKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgZGlzbWlzcyAke3Uuc291bH0gJHt1LnN0YXJ9KiAocGVybWFuZW50bHkgcmVtb3ZlZClgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAxOiBkaXNjYXJkIGEgaGFuZCBjYXJkIGFuZCBkcmF3IGEgcmFuZG9tIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNjYXJkUmVkcmF3KHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMuZGlzY2FyZFVzZWQgfHwgaGFuZElkeCA8IDAgfHwgaGFuZElkeCA+PSBzLmhhbmQubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGMgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNjYXJkZWQrKztcbiAgbG9nKHMsIGBzd2FwOiBkaXNjYXJkICR7Y31gKTtcbiAgZHJhdyhzLCAnc3dhcCcsIGMpO1xuICByZXR1cm4gdHJ1ZTtcbn1cbmV4cG9ydCBjb25zdCBzd2FwRGlzY2FyZCA9IGRpc2NhcmRSZWRyYXc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5Td2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgcmV0dXJuICFzLmRpc2NhcmRVc2VkICYmICEhdSAmJiAhdS5mcmVzaDsgICAgICAgICAgLy8gY2FuJ3Qgc2VsbCBhIHVuaXQgeW91IHN1bW1vbmVkIHRoaXMgcm91bmRcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDI6IHNlbGwgYSBkZXBsb3llZCB1bml0IChub3Qgb25lIHN1bW1vbmVkIHRoaXMgcm91bmQpIGFuZCBkcmF3IGEgY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN3YXBTZWxsKHMsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBzd2FwOiBzZWxsICR7dS5zb3VsfSAke3Uuc3Rhcn0qYCk7XG4gIGRyYXcocywgJ3N3YXAnLCB1LnNvdWwpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1vdmVVbml0KHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlciwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSB8fCAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgbG9nKHMsIGBtb3ZlICR7dS5zb3VsfSBjZWxsICR7dS5jZWxsfSAtPiAke2NlbGx9YCk7IHUuY2VsbCA9IGNlbGw7IHJldHVybiB0cnVlO1xufVxuXG4vLyAtLS0tIHdhdmUgcmVzdWx0cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBEcmFmdCBjaG9pY2VzIGZvciBhZnRlciBhIGNsZWFyZWQgd2F2ZTogMyByYW5kb20gY2FyZHMsIGR1cGxpY2F0ZXMgYWxsb3dlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkcmFmdE9wdGlvbnMoczogU3RhdGUpOiBTb3VsSWRbXSB7XG4gIGNvbnN0IHAgPSBwb29sT2Yocyk7XG4gIHJldHVybiBbcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKV07XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQ6IHJhaXNlIHRoZSBjYXAsIHJlc29sdmUgdGhlIFZpY3RvcnkgRHJhZnQsIGRyYXcgMSBub3JtYWwgY2FyZC4gKi9cbmV4cG9ydCBjb25zdCBzdGFnZVdhdmVzID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMucnVsZXMuc3RhZ2VXYXZlcyA/PyBXQVZFUztcblxuLyoqIFN0ZXAgMSBvZiBhIGNsZWFyZWQgd2F2ZTogaXMgdGhlIHN0YWdlIG92ZXI/IElmIG5vdCwgcmFpc2UgdGhlIGNhcCBhbmQgc3RhcnQgdGhlIG5leHQgYnVpbGQgcGhhc2UuIFJldHVybnMgdHJ1ZSB3aGVuIHRoZSBzdGFnZSBpcyB3b24uICovXG5leHBvcnQgZnVuY3Rpb24gYWR2YW5jZVdhdmUoczogU3RhdGUpOiBib29sZWFuIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gcy5zdGF0dXMgPT09ICd3b24nO1xuICBpZiAocy53YXZlID49IHN0YWdlV2F2ZXMocykpIHsgcy5zdGF0dXMgPSAnd29uJzsgbG9nKHMsICdzdGFnZSBjbGVhcmVkJyk7IHJldHVybiB0cnVlOyB9XG4gIHMud2F2ZSsrO1xuICBzLmNhcCA9IHMucnVsZXMuY3VydmVbcy53YXZlIC0gMV07XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYHdhdmUgY2xlYXJlZCAtPiBjYXAgJHtzLmNhcH1gKTtcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU3RlcCAyOiB0aGUgcGxheWVyIGtlcHQgYGlkeGAgZnJvbSB0aGUgb2ZmZXJlZCBkcmFmdCBjYXJkcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0YWtlRHJhZnQoczogU3RhdGUsIG9wdHM6IFNvdWxJZFtdLCBpZHg6IG51bWJlcik6IHZvaWQge1xuICBjb25zdCBwaWNrID0gb3B0c1tNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGlkeCkpXTtcbiAgcy5oYW5kLnB1c2gocGljayk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmFmdCBbJHtvcHRzLmpvaW4oJywgJyl9XSAtPiB0b29rICR7cGlja31gKTtcbn1cblxuLyoqIFN0ZXAgMzogdGhlIGJvbnVzIG5vcm1hbCBkcmF3IChvbmx5IG9uIHRoZSB3YXZlcyB0aGUgcnVsZXMgYWxsb3cpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbERyYXcoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMucnVsZXMubm9ybWFsRHJhd1dhdmVzID8gcy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMuaW5jbHVkZXMocy53YXZlKSA6IHRydWUpIGRyYXcocywgJ3dhdmUgY2xlYXInKTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZCAoYWxsIHRocmVlIHN0ZXBzIGluIG9uZSBjYWxsLCBmb3Igc2ltdWxhdGlvbnMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyV2F2ZShzOiBTdGF0ZSwgY2hvb3NlOiAob3B0czogU291bElkW10pID0+IG51bWJlcik6IHZvaWQge1xuICBpZiAoYWR2YW5jZVdhdmUocykpIHJldHVybjtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIGxldCBvcHRzID0gZHJhZnRPcHRpb25zKHMpO1xuICBjb25zdCBvZmZlcmVkID0gb3B0cy5qb2luKCcsICcpO1xuICBjb25zdCB0b29rOiBTb3VsSWRbXSA9IFtdO1xuICBmb3IgKGxldCBwID0gMDsgcCA8IChzLnJ1bGVzLmRyYWZ0UGlja3MgPz8gMSk7IHArKykge1xuICAgIGNvbnN0IGlkeCA9IE1hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgY2hvb3NlKG9wdHMpKSk7XG4gICAgdG9vay5wdXNoKG9wdHNbaWR4XSk7IHMuaGFuZC5wdXNoKG9wdHNbaWR4XSk7IHMuc3RhdHMuZHJhd24rKztcbiAgICBvcHRzID0gb3B0cy5maWx0ZXIoKF8sIGkpID0+IGkgIT09IGlkeCk7XG4gIH1cbiAgbG9nKHMsIGBkcmFmdCBbJHtvZmZlcmVkfV0gLT4gdG9vayAke3Rvb2suam9pbignLCAnKX1gKTtcbiAgbm9ybWFsRHJhdyhzKTtcbn1cblxuLyoqIEFybXkgd2lwZWQ6IGxvc2UgYSBoZWFydCwgY2FwIGRvZXMgTk9UIHJpc2UsIGVuZW1pZXMgcmVzZXQsICsxIGNhcmQsIHJlZHJhdyBhbGxvd2VkIGFnYWluLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZhaWxXYXZlKHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBzLmhlYXJ0cy0tOyBzLnN0YXRzLmZhaWx1cmVzKys7XG4gIGlmIChzLmhlYXJ0cyA8PSAwKSB7IHMuc3RhdHVzID0gJ2xvc3QnOyBsb2cocywgJ25vIGhlYXJ0cyBsZWZ0OiBzdGFnZSBsb3N0Jyk7IHJldHVybjsgfVxuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGBhcm15IHdpcGVkOiBoZWFydHMgJHtzLmhlYXJ0c30sIGNhcCBzdGF5cyAke3MuY2FwfWApO1xuICBkcmF3KHMsICdmYWlsZWQgYXR0ZW1wdCcpO1xufVxuXG4vLyAtLS0tIGludmFyaWFudHMgKGNhbGxlZCBieSB0aGUgc2ltdWxhdG9yIGFmdGVyIGV2ZXJ5IHdhdmU7IHRocm93IHdpdGggYSByZWFkYWJsZSBtZXNzYWdlKSAtLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjaGVja0ludmFyaWFudHMoczogU3RhdGUpOiB2b2lkIHtcbiAgY29uc3QgZmFpbCA9IChtOiBzdHJpbmcpID0+IHsgdGhyb3cgbmV3IEVycm9yKGBJTlZBUklBTlQgJHttfVxcbmAgKyBzLmxvZy5zbGljZSgtMTIpLmpvaW4oJ1xcbicpKTsgfTtcbiAgaWYgKHMudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgZmFpbChgbW9yZSB1bml0cyAoJHtzLnVuaXRzLmxlbmd0aH0pIHRoYW4gY2VsbHNgKTtcbiAgY29uc3QgY2VsbHMgPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgaWYgKGNlbGxzLnNpemUgIT09IHMudW5pdHMubGVuZ3RoKSBmYWlsKCd0d28gdW5pdHMgc2hhcmUgYSBjZWxsJyk7XG4gIGlmIChkb21pbmlvblVzZWQocykgPiBzLmNhcCkgZmFpbChgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9IGV4Y2VlZHMgY2FwICR7cy5jYXB9YCk7XG4gIGZvciAoY29uc3QgdSBvZiBzLnVuaXRzKSBpZiAodS5zdGFyIDwgMSB8fCB1LnN0YXIgPiBNQVhfU1RBUikgZmFpbChgdW5pdCBzdGFyICR7dS5zdGFyfSBvdXQgb2YgcmFuZ2VgKTtcbiAgLy8gZXZlcnkgZHJhd24gY2FyZCBpcyBlaXRoZXIgaW4gaGFuZCwgd29ydGggY2FyZHMgb24gdGhlIGZpZWxkLCBkaXNjYXJkZWQsIG9yIGRpc21pc3NlZFxuICBjb25zdCBvbkZpZWxkID0gcy51bml0cy5yZWR1Y2UoKG4sIHUpID0+IG4gKyBjYXJkc0luKHUuc3RhciksIDApO1xuICBjb25zdCBhY2NvdW50ZWQgPSBzLmhhbmQubGVuZ3RoICsgb25GaWVsZCArIHMuc3RhdHMuZGlzY2FyZGVkICsgcy5zdGF0cy5kaXNtaXNzZWQ7XG4gIGlmIChhY2NvdW50ZWQgIT09IHMuc3RhdHMuZHJhd24pIGZhaWwoYGNhcmQgY29uc2VydmF0aW9uOiBkcmF3biAke3Muc3RhdHMuZHJhd259ICE9IGFjY291bnRlZCAke2FjY291bnRlZH1gKTtcbn1cbiIsICIvLyBUaGUgYmF0dGxlZmllbGQncyBsb29rOiBhIHRpbGVkIGNyeXB0IGZsb29yLCBhIGdsb3dpbmcgcnVuZSBjaXJjbGUgaW4gdGhlIG1pZGRsZSwgYW5kIGEgZGFyayBtaXN0eSBzdXJyb3VuZC4gUHVyZSBkZWNvcmF0aW9uIChubyBnYW1lIHJ1bGVzKS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuXG5jb25zdCBUSUxFX01FVFJFUyA9IDU7ICAgIC8vIG9uZSByZXBlYXQgb2YgdGhlIGZsb29yIHBpY3R1cmUgY292ZXJzIHRoaXMgbWFueSBtZXRyZXMsIHNvIHNsYWJzIGNvbWUgb3V0IGFib3V0IGEgbWV0cmUgd2lkZVxuXG4vKiogRHJhdyB0aGUgcnVuZSBjaXJjbGUgb25jZSBvbnRvIGEgY2FudmFzOyBpdCBiZWNvbWVzIGEgc2VlLXRocm91Z2ggZGVjYWwgb24gdGhlIGZsb29yLiAqL1xuZnVuY3Rpb24gcnVuZVRleHR1cmUoc2NlbmU6IGFueSk6IGFueSB7XG4gIGNvbnN0IFMgPSA1MTIsIHRleCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdydW5lcycsIHsgd2lkdGg6IFMsIGhlaWdodDogUyB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0ZXguZ2V0Q29udGV4dCgpO1xuICBjLmNsZWFyUmVjdCgwLCAwLCBTLCBTKTsgYy50cmFuc2xhdGUoUyAvIDIsIFMgLyAyKTsgYy5saW5lQ2FwID0gJ3JvdW5kJzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7XG4gIGNvbnN0IHJpbmcgPSAocjogbnVtYmVyLCB3OiBudW1iZXIsIGE6IG51bWJlcikgPT4geyBjLmJlZ2luUGF0aCgpOyBjLmFyYygwLCAwLCByLCAwLCBNYXRoLlBJICogMik7IGMubGluZVdpZHRoID0gdzsgYy5zdHJva2VTdHlsZSA9IGByZ2JhKDQ3LDIxNywxNjYsJHthfSlgOyBjLnN0cm9rZSgpOyB9O1xuICBjLnNoYWRvd0NvbG9yID0gJ3JnYmEoNDcsMjE3LDE2NiwwLjkpJzsgYy5zaGFkb3dCbHVyID0gMTA7XG4gIHJpbmcoMjM2LCA0LCAwLjc1KTsgcmluZygyMTQsIDIsIDAuNSk7IHJpbmcoMTIwLCAzLCAwLjcpO1xuICBjLnN0cm9rZVN0eWxlID0gJ3JnYmEoNDcsMjE3LDE2NiwwLjcpJzsgYy5saW5lV2lkdGggPSAzO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ7IGkrKykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZm91ciBsb25nIHNwaWtlcywgbGlrZSBhIGNvbXBhc3NcbiAgICBjLnNhdmUoKTsgYy5yb3RhdGUoKGkgKiBNYXRoLlBJKSAvIDIgKyBNYXRoLlBJIC8gNCk7IGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKDAsIC0zMCk7IGMubGluZVRvKDAsIC0yMzApOyBjLnN0cm9rZSgpO1xuICAgIGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKC0xNCwgLTEyMCk7IGMubGluZVRvKDAsIC0xNjApOyBjLmxpbmVUbygxNCwgLTEyMCk7IGMuc3Ryb2tlKCk7IGMucmVzdG9yZSgpO1xuICB9XG4gIGMubGluZVdpZHRoID0gMjsgYy5zdHJva2VTdHlsZSA9ICdyZ2JhKDQ3LDIxNywxNjYsMC41NSknO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDEyOyBpKyspIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc21hbGwgdGljayBtYXJrcyBiZXR3ZWVuIHRoZSB0d28gb3V0ZXIgcmluZ3NcbiAgICBjLnNhdmUoKTsgYy5yb3RhdGUoKGkgKiBNYXRoLlBJKSAvIDYpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMjE0KTsgYy5saW5lVG8oMCwgLTIzNik7IGMuc3Ryb2tlKCk7IGMucmVzdG9yZSgpO1xuICB9XG4gIHRleC51cGRhdGUoKTsgdGV4Lmhhc0FscGhhID0gdHJ1ZTsgcmV0dXJuIHRleDtcbn1cblxuaW50ZXJmYWNlIFBsYWNlbWVudCB7IHByb3A6IHN0cmluZzsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHlhdz86IG51bWJlcjsgcz86IG51bWJlciB9XG4vKiogV2hlcmUgdGhlIHByb3BzIHN0YW5kLiBUYWxsIHRoaW5ncyBnbyBiZWhpbmQgYW5kIGJlc2lkZSB0aGUgZmllbGQ7IG9ubHkgbG93IHRoaW5ncyAoZmVuY2UsIGJvbmVzLCB3YWxsKSBzdGFuZCBiZXR3ZWVuIHRoZSBjYW1lcmEgYW5kIHRoZSB1bml0cy4gKi9cbmNvbnN0IENSWVBUX0xBWU9VVDogUGxhY2VtZW50W10gPSBbXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtNi41LCB6OiA2LjQgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDAsIHo6IDYuOSwgczogMS4xNSB9LCB7IHByb3A6ICdhcmNoJywgeDogNi41LCB6OiA2LjQgfSxcbiAgeyBwcm9wOiAncGlsbGFyJywgeDogLTEwLjIsIHo6IDUuNiwgeWF3OiAwLjQgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogLTMuMiwgejogNS45LCB5YXc6IDIuMSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAzLjMsIHo6IDUuOCwgeWF3OiA0LjAgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTAuMiwgejogNS42LCB5YXc6IDEuMiB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTQuNiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiA0LjYsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogLTEwLjUsIHo6IDAuOCB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogMTAuNSwgejogMC44IH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtOC42LCB6OiA2LjAsIHlhdzogMC4xIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiA4LjYsIHo6IDYuMCwgeWF3OiAtMC4xIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTEuNCwgejogLTIuNiwgeWF3OiAxLjQgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDExLjQsIHo6IC0yLjYsIHlhdzogMS43IH0sXG4gIHsgcHJvcDogJ2ZlbmNlJywgeDogLTguMCwgejogLTQuNiB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC02LjcsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA2LjcsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA4LjAsIHo6IC00LjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiAtMy41LCB6OiAtNC40LCB5YXc6IDAuNywgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogNC4yLCB6OiAtNC42LCB5YXc6IDIuNSwgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogOS40LCB6OiAzLjIsIHlhdzogMS4wLCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAtOS42LCB6OiAtMy40LCB5YXc6IDMuNiwgczogMC42IH0sXG5dO1xuY29uc3QgR1JBVkVZQVJEX0xBWU9VVDogUGxhY2VtZW50W10gPSBbICAgICAgLy8gZmV3ZXIgYXJjaGVzLCBhIGJyb2tlbiByb3cgb2YgZ3JhdmVzdG9uZSBwaWxsYXJzLCBib25lcyBldmVyeXdoZXJlXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtOS41LCB6OiA2LjQgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDkuNSwgejogNi40IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMSwgejogNS4yLCB5YXc6IDAuNCwgczogMC45IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC03LjYsIHo6IDYuMywgeWF3OiAyLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogLTQuNCwgejogNS42LCB5YXc6IDQuMCwgczogMC44IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xLjIsIHo6IDYuNSwgeWF3OiAxLjIgfSxcbiAgeyBwcm9wOiAncGlsbGFyJywgeDogMi4yLCB6OiA1LjcsIHlhdzogMy4xLCBzOiAwLjkgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogNS41LCB6OiA2LjQsIHlhdzogNS4wIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDguMiwgejogNS41LCB5YXc6IDAuOSwgczogMC44NSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAxMSwgejogNS4wLCB5YXc6IDIuNiB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTExLCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDExLCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDAuNiwgejogNS4wLCBzOiAwLjkgfSxcbiAgeyBwcm9wOiAnd2FsbCcsIHg6IC01LjYsIHo6IDYuNiwgeWF3OiAwLjIgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDMuOCwgejogNi43LCB5YXc6IC0wLjIgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0xMS42LCB6OiAtMi40LCB5YXc6IDEuNSB9LFxuICB7IHByb3A6ICdmZW5jZScsIHg6IC00LjIsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA0LjQsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAxMS4yLCB6OiAtMi4yLCB5YXc6IDEuNiB9LFxuICB7IHByb3A6ICdib25lcycsIHg6IC01LjUsIHo6IDQuNiwgeWF3OiAwLjcsIHM6IDAuNiB9LCB7IHByb3A6ICdib25lcycsIHg6IDMuMiwgejogNC40LCB5YXc6IDIuNSwgczogMC43IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogOC4yLCB6OiAzLjIsIHlhdzogMS4wLCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAtOS4yLCB6OiAzLjQsIHlhdzogMy42LCBzOiAwLjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiA3LCB6OiAtNC41LCB5YXc6IDAuMywgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTcuNCwgejogLTQuMywgeWF3OiA0LjEsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDAuMiwgejogLTQuOCwgeWF3OiA1LjIsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDEwLjIsIHo6IC0wLjYsIHlhdzogMi4wLCBzOiAwLjYgfSxcbl07XG5jb25zdCBCQVNUSU9OX0xBWU9VVDogUGxhY2VtZW50W10gPSBbICAgICAgICAvLyBhIGZvcnRyZXNzOiBnYXRlcyBiZXR3ZWVuIGxvbmcgd2FsbHMsIGJyYXppZXJzIGFsb25nIHRoZSBiYXR0bGVtZW50cywgZmVuY2VzIG9uIHRoZSBmbGFua3NcbiAgeyBwcm9wOiAnYXJjaCcsIHg6IC01LjgsIHo6IDYuNSwgczogMS4xIH0sIHsgcHJvcDogJ2FyY2gnLCB4OiAwLCB6OiA3LjAsIHM6IDEuMyB9LCB7IHByb3A6ICdhcmNoJywgeDogNS44LCB6OiA2LjUsIHM6IDEuMSB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTkuNCwgejogNi4wLCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0yLjksIHo6IDYuNCwgczogMS4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAyLjksIHo6IDYuNCwgczogMS4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiA5LjQsIHo6IDYuMCwgczogMS4zIH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTIuMiwgejogMi42LCB5YXc6IDEuNTcsIHM6IDEuMyB9LCB7IHByb3A6ICd3YWxsJywgeDogMTIuMiwgejogMi42LCB5YXc6IDEuNTcsIHM6IDEuMyB9LCB7IHByb3A6ICd3YWxsJywgeDogLTEyLjIsIHo6IC0xLjYsIHlhdzogMS41NyB9LCB7IHByb3A6ICd3YWxsJywgeDogMTIuMiwgejogLTEuNiwgeWF3OiAxLjU3IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMS4yLCB6OiA1LjYsIHlhdzogMC40LCBzOiAxLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTEuMiwgejogNS42LCB5YXc6IDEuMiwgczogMS4xIH0sXG4gIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtMy4yLCB6OiA1LjIgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDMuMiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtMTAuNiwgejogMS4wIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAxMC42LCB6OiAxLjAgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IC03LjIsIHo6IC00LjYsIHM6IDAuOSB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogNy4yLCB6OiAtNC42LCBzOiAwLjkgfSxcbiAgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNC42LCB6OiAtNC44IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogLTMuMywgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDMuMywgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDQuNiwgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC0xMS42LCB6OiAtMy40LCB5YXc6IDEuNSB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDExLjYsIHo6IC0zLjQsIHlhdzogMS41IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogLTEuNSwgejogLTQuNSwgeWF3OiAwLjcsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDkuNCwgejogMy4yLCB5YXc6IDEuMCwgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuNiwgejogLTMuMCwgeWF3OiAzLjYsIHM6IDAuNSB9LFxuXTtcblxudHlwZSBDMyA9IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcbmludGVyZmFjZSBUaGVtZSB7IGxheW91dDogUGxhY2VtZW50W107IGZsb29yOiBDMzsgZm9nOiBDMzsgbWlzdDogQzM7IHdhbGw6IEMzOyBmbGFtZUE6IEMzOyBmbGFtZUI6IEMzOyBydW5lOiBDMyB9XG4vKiogT25lIGxvb2sgcGVyIGNhbXBhaWduIHN0YWdlIChpZHMgbWF0Y2ggU1RBR0VTIGluIGNvcmUvd2F2ZXMudHMpLiBVbmtub3duIGlkcyB1c2UgdGhlIGNyeXB0IGxvb2suICovXG5jb25zdCBUSEVNRVM6IFJlY29yZDxzdHJpbmcsIFRoZW1lPiA9IHtcbiAgY3J5cHQ6IHsgbGF5b3V0OiBDUllQVF9MQVlPVVQsIGZsb29yOiBbMC42MiwgMC43LCAwLjddLCBmb2c6IFswLjAyLCAwLjA1LCAwLjA2XSwgbWlzdDogWzAuMiwgMC42LCAwLjU1XSwgd2FsbDogWzAuNzUsIDAuODUsIDAuOV0sIGZsYW1lQTogWzAuMzUsIDEsIDAuOF0sIGZsYW1lQjogWzAuMSwgMC44LCAwLjZdLCBydW5lOiBbMC4xOCwgMC44NSwgMC42NV0gfSxcbiAgZ3JhdmV5YXJkOiB7IGxheW91dDogR1JBVkVZQVJEX0xBWU9VVCwgZmxvb3I6IFswLjYyLCAwLjc0LCAwLjUyXSwgZm9nOiBbMC4wMywgMC4wNSwgMC4wMjVdLCBtaXN0OiBbMC40MiwgMC42LCAwLjIyXSwgd2FsbDogWzAuNywgMC44NSwgMC42Ml0sIGZsYW1lQTogWzAuNzUsIDEsIDAuNF0sIGZsYW1lQjogWzAuNCwgMC44LCAwLjJdLCBydW5lOiBbMC41LCAwLjgsIDAuMjVdIH0sXG4gIGVuZGxlc3M6IHsgbGF5b3V0OiBDUllQVF9MQVlPVVQsIGZsb29yOiBbMC43OCwgMC42MiwgMC42OF0sIGZvZzogWzAuMDYsIDAuMDIsIDAuMDM1XSwgbWlzdDogWzAuNzUsIDAuMywgMC40XSwgd2FsbDogWzAuOTIsIDAuNjgsIDAuNzhdLCBmbGFtZUE6IFsxLCAwLjYyLCAwLjNdLCBmbGFtZUI6IFswLjksIDAuMjUsIDAuMTVdLCBydW5lOiBbMC45LCAwLjM1LCAwLjNdIH0sXG4gIGJhc3Rpb246IHsgbGF5b3V0OiBCQVNUSU9OX0xBWU9VVCwgZmxvb3I6IFswLjYsIDAuNjIsIDAuOV0sIGZvZzogWzAuMDMsIDAuMDMsIDAuMDhdLCBtaXN0OiBbMC40LCAwLjQsIDAuODVdLCB3YWxsOiBbMC43MiwgMC43MiwgMV0sIGZsYW1lQTogWzAuNiwgMC42NSwgMV0sIGZsYW1lQjogWzAuNCwgMC4zLCAwLjk1XSwgcnVuZTogWzAuNDUsIDAuNCwgMC45NV0gfSxcbn07XG5cblxuLyoqIEJ1aWxkIHRoZSB0ZWFsIHNvdWxmaXJlIG92ZXIgYSBicmF6aWVyOiBhIHNtYWxsIHNvZnQgZmxhbWUgdGhhdCBmbGlja2Vycy4gKi9cbmZ1bmN0aW9uIGZsYW1lKHNjZW5lOiBhbnksIHRleDogYW55LCB4OiBudW1iZXIsIHk6IG51bWJlciwgejogbnVtYmVyLCBrOiBudW1iZXIsIGE6IEMzLCBiOiBDMyk6IGFueSB7XG4gIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2ZpcmUnLCAxOCwgc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0ZXg7IHBzLmVtaXR0ZXIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKHgsIHksIHopO1xuICBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yMiAqIGssIDAsIC0wLjIyICogayk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMjIgKiBrLCAwLCAwLjIyICogayk7XG4gIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjEsIDEsIC0wLjEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjEsIDEuNCwgMC4xKTtcbiAgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMS4wOyBwcy5lbWl0UmF0ZSA9IDIwOyBwcy5taW5TaXplID0gMC4zNSAqIGs7IHBzLm1heFNpemUgPSAwLjcgKiBrOyBwcy5taW5FbWl0UG93ZXIgPSAwLjUgKiBrOyBwcy5tYXhFbWl0UG93ZXIgPSAxLjAgKiBrO1xuICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoYVswXSwgYVsxXSwgYVsyXSwgMC45KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KGJbMF0sIGJbMV0sIGJbMl0sIDAuOCk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNChiWzBdICogMC4xLCBiWzFdICogMC4zLCBiWzJdICogMC4zLCAwKTtcbiAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5zdGFydCgpOyByZXR1cm4gcHM7XG59XG5cbi8qKiBTb2Z0IHJvdW5kIGJsb2IgdXNlZCBmb3IgdGhlIGZsYW1lcy4gKi9cbmZ1bmN0aW9uIGdsb3dUZXh0dXJlKHNjZW5lOiBhbnkpOiBhbnkge1xuICBjb25zdCB0ID0gbmV3IEJBQllMT04uRHluYW1pY1RleHR1cmUoJ2dsb3cnLCB7IHdpZHRoOiA2NCwgaGVpZ2h0OiA2NCB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0LmdldENvbnRleHQoKSwgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTtcbiAgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwwLjQ1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICBjLmZpbGxTdHlsZSA9IGc7IGMuZmlsbFJlY3QoMCwgMCwgNjQsIDY0KTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IHRydWU7IHJldHVybiB0O1xufVxuXG4vKiogTG9hZCB0aGUgcHJvcCBraXQgb25jZTsgYXBwbHkodGhlbWUpIHRoZW4gc3RhbmRzIGNvcGllcyBvZiBlYWNoIHBpZWNlIGFyb3VuZCB0aGUgZmllbGQgKHRoZXkgc2hhcmUgb25lIG1lc2ggYW5kIG9uZSB0ZXh0dXJlLCBzbyB0aGV5IGNvc3QgYWxtb3N0IG5vdGhpbmcpLiAqL1xuYXN5bmMgZnVuY3Rpb24gbG9hZEtpdChzY2VuZTogYW55KTogUHJvbWlzZTx7IGFwcGx5KHQ6IFRoZW1lKTogdm9pZCB9PiB7XG4gIGNvbnN0IGJveCA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy9hcmVuYS8nLCAncHJvcHMuZ2xiJywgc2NlbmUpO1xuICBib3guYWRkQWxsVG9TY2VuZSgpO1xuICBjb25zdCByb290ID0gYm94Lm1lc2hlcy5maW5kKChtOiBhbnkpID0+IG0ubmFtZSA9PT0gJ19fcm9vdF9fJyksIHNyYzogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICBmb3IgKGNvbnN0IG0gb2YgYm94Lm1lc2hlcykgaWYgKG0ubmFtZSAhPT0gJ19fcm9vdF9fJyAmJiBtLmdldFRvdGFsVmVydGljZXMoKSA+IDApIHsgc3JjW20ubmFtZV0gPSBtOyBtLnNldEVuYWJsZWQoZmFsc2UpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICBjb25zdCBnbG93ID0gZ2xvd1RleHR1cmUoc2NlbmUpOyBsZXQgbWFkZTogeyBob2xkZXJzOiBhbnlbXTsgZmlyZXM6IGFueVtdIH0gPSB7IGhvbGRlcnM6IFtdLCBmaXJlczogW10gfSwgbiA9IDA7XG4gIHJldHVybiB7XG4gICAgYXBwbHkodDogVGhlbWUpIHtcbiAgICAgIGZvciAoY29uc3QgaCBvZiBtYWRlLmhvbGRlcnMpIGguZGlzcG9zZSgpOyBmb3IgKGNvbnN0IGYgb2YgbWFkZS5maXJlcykgZi5kaXNwb3NlKGZhbHNlKTsgICAvLyBmYWxzZToga2VlcCB0aGUgc2hhcmVkIGdsb3cgdGV4dHVyZSBtYWRlID0geyBob2xkZXJzOiBbXSwgZmlyZXM6IFtdIH07XG4gICAgICBmb3IgKGNvbnN0IHAgb2YgdC5sYXlvdXQpIHtcbiAgICAgICAgY29uc3QgYmFzZSA9IHNyY1twLnByb3BdOyBpZiAoIWJhc2UpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBpbnN0ID0gYmFzZS5jcmVhdGVJbnN0YW5jZShwLnByb3AgKyBuKyspOyBpbnN0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICAgICAgaW5zdC5yb3RhdGlvblF1YXRlcm5pb24gPSByb290LnJvdGF0aW9uUXVhdGVybmlvbj8uY2xvbmUoKSA/PyBudWxsOyBpZiAoIWluc3Qucm90YXRpb25RdWF0ZXJuaW9uKSBpbnN0LnJvdGF0aW9uID0gcm9vdC5yb3RhdGlvbi5jbG9uZSgpOyBpbnN0LnNjYWxpbmcgPSByb290LnNjYWxpbmcuY2xvbmUoKTtcbiAgICAgICAgY29uc3QgaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnaG9sZGVyJyArIG4sIHNjZW5lKTsgaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IGhvbGRlci5yb3RhdGlvbi55ID0gcC55YXcgPz8gMDsgaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHAucyA/PyAxKTtcbiAgICAgICAgaW5zdC5wYXJlbnQgPSBob2xkZXI7IG1hZGUuaG9sZGVycy5wdXNoKGhvbGRlcik7XG4gICAgICAgIGlmIChwLnByb3AgPT09ICdicmF6aWVyJykgbWFkZS5maXJlcy5wdXNoKGZsYW1lKHNjZW5lLCBnbG93LCBwLngsIDEuMjUgKiAocC5zID8/IDEpLCBwLnosIHAucyA/PyAxLCB0LmZsYW1lQSwgdC5mbGFtZUIpKTtcbiAgICAgIH1cbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRBcmVuYShzY2VuZTogYW55LCBncm91bmQ6IGFueSk6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHNldFRoZW1lKHN0YWdlOiBzdHJpbmcpOiB2b2lkIH0ge1xuICAvLyAtLS0tIGZsb29yXG4gIGNvbnN0IHRleCA9IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy9hcmVuYS9mbG9vci53ZWJwJywgc2NlbmUsIGZhbHNlLCB0cnVlLCBCQUJZTE9OLlRleHR1cmUuVFJJTElORUFSX1NBTVBMSU5HTU9ERSk7XG4gIHRleC51U2NhbGUgPSA2MCAvIFRJTEVfTUVUUkVTOyB0ZXgudlNjYWxlID0gNDAgLyBUSUxFX01FVFJFUzsgdGV4LmFuaXNvdHJvcGljRmlsdGVyaW5nTGV2ZWwgPSA0O1xuICBjb25zdCBnbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2dtJywgc2NlbmUpOyBnbS5kaWZmdXNlVGV4dHVyZSA9IHRleDsgZ20uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7XG4gIGdtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjYyLCAwLjcsIDAuNyk7IGdyb3VuZC5tYXRlcmlhbCA9IGdtO1xuXG4gIC8vIC0tLS0gcnVuZSBjaXJjbGUgaW4gdGhlIG1pZGRsZSBvZiB0aGUgZmllbGRcbiAgY29uc3QgZGVjYWwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgncnVuZXMnLCB7IHdpZHRoOiA1LjIsIGhlaWdodDogNS4yIH0sIHNjZW5lKTtcbiAgZGVjYWwucG9zaXRpb24ueSA9IDAuMDEyOyBkZWNhbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGNvbnN0IHJtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgncm0nLCBzY2VuZSk7IHJtLmRpZmZ1c2VUZXh0dXJlID0gcnVuZVRleHR1cmUoc2NlbmUpOyBybS5kaWZmdXNlVGV4dHVyZS5oYXNBbHBoYSA9IHRydWU7IHJtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTtcbiAgcm0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjg1LCAwLjY1KTsgcm0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcm0uYWxwaGEgPSAwLjU1OyBybS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgZGVjYWwubWF0ZXJpYWwgPSBybTtcblxuICAvLyAtLS0tIGRhcmsgdGVhbCBzdXJyb3VuZCB0aGF0IHN3YWxsb3dzIHRoZSBmYXIgZWRnZSBvZiB0aGUgZmxvb3JcbiAgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjAyLCAwLjA1LCAwLjA2LCAxKTtcbiAgc2NlbmUuZm9nTW9kZSA9IEJBQllMT04uU2NlbmUuRk9HTU9ERV9MSU5FQVI7IHNjZW5lLmZvZ0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMDIsIDAuMDUsIDAuMDYpOyBzY2VuZS5mb2dTdGFydCA9IDI0OyBzY2VuZS5mb2dFbmQgPSA1NjtcblxuICBjb25zdCBjYXZlID0gYnVpbGRDYXZlKHNjZW5lLCB0ZXgpO1xuICBsZXQga2l0OiB7IGFwcGx5KHQ6IFRoZW1lKTogdm9pZCB9IHwgbnVsbCA9IG51bGwsIHdhbnQgPSAnY3J5cHQnLCBzaG93biA9ICcnO1xuICBjb25zdCBzaG93ID0gKCkgPT4ge1xuICAgIGNvbnN0IHQgPSBUSEVNRVNbd2FudF0gPz8gVEhFTUVTLmNyeXB0OyBpZiAod2FudCA9PT0gc2hvd24gJiYga2l0KSByZXR1cm47XG4gICAgY29uc3QgY29sID0gKGM6IEMzKSA9PiBuZXcgQkFCWUxPTi5Db2xvcjMoY1swXSwgY1sxXSwgY1syXSk7XG4gICAgZ20uZGlmZnVzZUNvbG9yID0gY29sKHQuZmxvb3IpOyBjYXZlLndhbGxNYXQuZGlmZnVzZUNvbG9yID0gY29sKHQud2FsbCk7IHJtLmVtaXNzaXZlQ29sb3IgPSBjb2wodC5ydW5lKTtcbiAgICBmb3IgKGNvbnN0IG0gb2YgY2F2ZS5taXN0TWF0cykgbS5lbWlzc2l2ZUNvbG9yID0gY29sKHQubWlzdCk7XG4gICAgc2NlbmUuZm9nQ29sb3IgPSBjb2wodC5mb2cpOyBzY2VuZS5jbGVhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3I0KHQuZm9nWzBdLCB0LmZvZ1sxXSwgdC5mb2dbMl0sIDEpO1xuICAgIGlmIChraXQpIHsga2l0LmFwcGx5KHQpOyBzaG93biA9IHdhbnQ7IH1cbiAgfTtcbiAgbG9hZEtpdChzY2VuZSkudGhlbigoaykgPT4geyBraXQgPSBrOyBzaG93biA9ICcnOyBzaG93KCk7IH0pLmNhdGNoKChlKSA9PiBjb25zb2xlLndhcm4oJ2FyZW5hIHByb3BzIGZhaWxlZCcsIGUpKTtcblxuICByZXR1cm4geyB1cGRhdGU6ICh0OiBudW1iZXIpID0+IHsgcm0uYWxwaGEgPSAwLjQ1ICsgMC4xNSAqIE1hdGguc2luKHQgKiAxLjQpOyBjYXZlLnVwZGF0ZSh0KTsgfSwgc2V0VGhlbWU6IChzdGFnZTogc3RyaW5nKSA9PiB7IHdhbnQgPSBzdGFnZTsgc2hvdygpOyB9IH07XG59XG5cbi8vIC0tLS0gdGhlIGNhdmU6IGEgcm91Z2ggc3RvbmUgd2FsbCBhbGwgdGhlIHdheSByb3VuZCwgcm9jayBzcGlyZXMgYWxvbmcgaXRzIGZvb3QsIGRyaWZ0aW5nIG1pc3QsIGFuZCBhIGRhcmsgdmlnbmV0dGUgb24gdGhlIGZsb29yXG5jb25zdCBSWCA9IDIwLCBSWiA9IDE1LCBDWiA9IC00LCBXQUxMX0ggPSAxNjsgICAvLyBvdmFsIHJpbmcgY2VudHJlZCBhIGxpdHRsZSBiZWhpbmQgdGhlIGZpZWxkOiB0aGUgZmFyIHdhbGwgc3RhbmRzIGFib3V0IDExIG0gcGFzdCB0aGUgY2VudHJlXG5jb25zdCB3b2JibGUgPSAoYTogbnVtYmVyLCB5OiBudW1iZXIpOiBudW1iZXIgPT4gTWF0aC5zaW4oMyAqIGEgKyAxLjMpICogMC41ICsgTWF0aC5zaW4oNyAqIGEgKyB5ICogMC41KSAqIDAuMyArIE1hdGguc2luKDEzICogYSAtIHkgKiAwLjM1KSAqIDAuMiArIE1hdGguc2luKDIzICogYSArIHkpICogMC4wODtcblxuZnVuY3Rpb24gbWlzdFRleHR1cmUoc2NlbmU6IGFueSwgc2VlZDogbnVtYmVyKTogYW55IHtcbiAgY29uc3QgUyA9IDI1NiwgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdtaXN0JyArIHNlZWQsIHsgd2lkdGg6IFMsIGhlaWdodDogUyB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0LmdldENvbnRleHQoKTtcbiAgYy5jbGVhclJlY3QoMCwgMCwgUywgUyk7XG4gIGxldCByID0gc2VlZCAqIDkzMDEgKyA0OTI5NzsgY29uc3Qgcm5kID0gKCkgPT4gKHIgPSAociAqIDkzMDEgKyA0OTI5NykgJSAyMzMyODApIC8gMjMzMjgwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ2OyBpKyspIHtcbiAgICBjb25zdCB4ID0gcm5kKCkgKiBTLCB5ID0gcm5kKCkgKiBTLCByYWQgPSAyNiArIHJuZCgpICogNDY7XG4gICAgZm9yIChjb25zdCBkeCBvZiBbLVMsIDAsIFNdKSBmb3IgKGNvbnN0IGR5IG9mIFstUywgMCwgU10pIHsgICAgICAgICAgLy8gZHJhdyB3cmFwcGVkIGNvcGllcyBzbyB0aGUgcGljdHVyZSB0aWxlcyB3aXRoIG5vIHNlYW1cbiAgICAgIGNvbnN0IGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KHggKyBkeCwgeSArIGR5LCAwLCB4ICsgZHgsIHkgKyBkeSwgcmFkKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMC41KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICAgICAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIFMsIFMpO1xuICAgIH1cbiAgfVxuICB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gdHJ1ZTsgdC53cmFwVSA9IHQud3JhcFYgPSBCQUJZTE9OLlRleHR1cmUuV1JBUF9BRERSRVNTTU9ERTsgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkQ2F2ZShzY2VuZTogYW55LCBmbG9vclRleDogYW55KTogeyB1cGRhdGUodDogbnVtYmVyKTogdm9pZDsgd2FsbE1hdDogYW55OyBtaXN0TWF0czogYW55W10gfSB7XG4gIC8vIHJvdWdoIHdhbGw6IGFuIG92YWwgcmluZyB3aG9zZSByYWRpdXMgd29iYmxlcyB3aXRoIGFuZ2xlIGFuZCBoZWlnaHQsIGRhcmtlciB0aGUgaGlnaGVyIGl0IGdvZXNcbiAgY29uc3QgTiA9IDEyMCwgTSA9IDEyLCBwb3M6IG51bWJlcltdID0gW10sIHV2OiBudW1iZXJbXSA9IFtdLCBjb2w6IG51bWJlcltdID0gW10sIGlkeDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaiA9IDA7IGogPD0gTTsgaisrKSBmb3IgKGxldCBpID0gMDsgaSA8PSBOOyBpKyspIHtcbiAgICBjb25zdCBhID0gKGkgLyBOKSAqIE1hdGguUEkgKiAyLCBoID0gKGogLyBNKSAqIFdBTExfSCwgayA9IDEgKyAwLjA2ICogd29iYmxlKGEsIGgpICsgKGogPT09IDAgPyAwIDogMC4wNSAqIE1hdGguc2luKGEgKiA1ICsgaikpO1xuICAgIGNvbnN0IG92ZXJoYW5nID0gMSAtIDAuMSAqIE1hdGguc2luKChqIC8gTSkgKiBNYXRoLlBJKTsgICAgICAgICAgICAgICAgICAgICAgICAvLyBsZWFucyBpbiBhIGxpdHRsZSBzbyBpdCBmZWVscyBsaWtlIGEgY2F2ZXJuXG4gICAgcG9zLnB1c2goTWF0aC5jb3MoYSkgKiBSWCAqIGsgKiBvdmVyaGFuZywgaCwgQ1ogKyBNYXRoLnNpbihhKSAqIFJaICogayAqIG92ZXJoYW5nKTsgdXYucHVzaCgoaSAvIE4pICogMTQsIChqIC8gTSkgKiAzLjIpO1xuICAgIGNvbnN0IGIgPSBNYXRoLm1heCgwLjA2LCAxLjAgLSAoaiAvIE0pICogMC45KTsgY29sLnB1c2goYiAqIDAuOCwgYiwgYiwgMSk7XG4gIH1cbiAgZm9yIChsZXQgaiA9IDA7IGogPCBNOyBqKyspIGZvciAobGV0IGkgPSAwOyBpIDwgTjsgaSsrKSB7IGNvbnN0IGEgPSBqICogKE4gKyAxKSArIGksIGIgPSBhICsgMSwgYyA9IGEgKyBOICsgMSwgZCA9IGMgKyAxOyBpZHgucHVzaChhLCBjLCBiLCBiLCBjLCBkKTsgfVxuICBjb25zdCB3YWxsID0gbmV3IEJBQllMT04uTWVzaCgnY2F2ZScsIHNjZW5lKSwgdmQgPSBuZXcgQkFCWUxPTi5WZXJ0ZXhEYXRhKCk7IHZkLnBvc2l0aW9ucyA9IHBvczsgdmQuaW5kaWNlcyA9IGlkeDsgdmQudXZzID0gdXY7IHZkLmNvbG9ycyA9IGNvbDtcbiAgY29uc3QgbnJtOiBudW1iZXJbXSA9IFtdOyBCQUJZTE9OLlZlcnRleERhdGEuQ29tcHV0ZU5vcm1hbHMocG9zLCBpZHgsIG5ybSk7IHZkLm5vcm1hbHMgPSBucm07IHZkLmFwcGx5VG9NZXNoKHdhbGwpO1xuICBjb25zdCB3bSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2NhdmVtJywgc2NlbmUpOyB3bS5kaWZmdXNlVGV4dHVyZSA9IGZsb29yVGV4LmNsb25lKCk7IHdtLmRpZmZ1c2VUZXh0dXJlLnVTY2FsZSA9IDE7IHdtLmRpZmZ1c2VUZXh0dXJlLnZTY2FsZSA9IDE7XG4gIHdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyB3bS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgd20uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuODUsIDAuOSk7IHdhbGwubWF0ZXJpYWwgPSB3bTsgd2FsbC5pc1BpY2thYmxlID0gZmFsc2U7IHdhbGwudXNlVmVydGV4Q29sb3JzID0gdHJ1ZTsgd20udXNlVmVydGV4Q29sb3IgPSB0cnVlO1xuICAvLyByb2NrIHNwaXJlcyBzdGFuZGluZyBhbG9uZyB0aGUgZm9vdCBvZiB0aGUgd2FsbCAob25lIHNoYXJlZCBtZXNoLCBtYW55IGNvcGllcylcbiAgY29uc3Qgc3BpcmUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzcGlyZScsIHsgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiAxLjYsIGhlaWdodDogMSwgdGVzc2VsbGF0aW9uOiA1IH0sIHNjZW5lKTtcbiAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzcGlyZW0nLCBzY2VuZSk7IHNtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAzLCAwLjA0NSwgMC4wNTUpOyBzbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgc20uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAwNCwgMC4wMTIsIDAuMDE0KTsgc3BpcmUubWF0ZXJpYWwgPSBzbTtcbiAgc3BpcmUuY29udmVydFRvRmxhdFNoYWRlZE1lc2goKTsgc3BpcmUuc2V0RW5hYmxlZChmYWxzZSk7IHNwaXJlLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgbGV0IHIgPSAxMjM0NTsgY29uc3Qgcm5kID0gKCkgPT4gKHIgPSAociAqIDkzMDEgKyA0OTI5NykgJSAyMzMyODApIC8gMjMzMjgwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ2OyBpKyspIHtcbiAgICBjb25zdCBhID0gKGkgLyA0NikgKiBNYXRoLlBJICogMiArIChybmQoKSAtIDAuNSkgKiAwLjEyLCBkID0gMC44NiArIHJuZCgpICogMC4xLCBoZ3QgPSAxLjQgKyBybmQoKSAqIDMuMiwgdyA9IDAuNyArIHJuZCgpICogMS4wO1xuICAgIGNvbnN0IHMgPSBzcGlyZS5jcmVhdGVJbnN0YW5jZSgnc3AnICsgaSk7IHMuaXNQaWNrYWJsZSA9IGZhbHNlOyBzLnBvc2l0aW9uLnNldChNYXRoLmNvcyhhKSAqIFJYICogZCwgaGd0IC8gMiAtIDAuMiwgQ1ogKyBNYXRoLnNpbihhKSAqIFJaICogZCk7XG4gICAgcy5zY2FsaW5nLnNldCh3LCBoZ3QsIHcpOyBzLnJvdGF0aW9uLnkgPSBybmQoKSAqIDY7IHMucm90YXRpb24ueiA9IChybmQoKSAtIDAuNSkgKiAwLjE4O1xuICB9XG4gIC8vIG1pc3Q6IHR3byBzbG93IGxheWVycyBqdXN0IGFib3ZlIHRoZSBmbG9vclxuICBjb25zdCBsYXllcnMgPSBbMC4yOCwgMC43NV0ubWFwKCh5LCBuKSA9PiB7XG4gICAgY29uc3QgcCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdtaXN0JyArIG4sIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQ0IH0sIHNjZW5lKTsgcC5wb3NpdGlvbi55ID0geTsgcC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ21pc3RtJyArIG4sIHNjZW5lKSwgdCA9IG1pc3RUZXh0dXJlKHNjZW5lLCBuICsgMyk7IHQudVNjYWxlID0gNSAtIG47IHQudlNjYWxlID0gMy40IC0gbiAqIDAuNjtcbiAgICBtLmRpZmZ1c2VUZXh0dXJlID0gdDsgbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjIsIDAuNiwgMC41NSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IDAuMTUgLSBuICogMC4wNjsgbS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTtcbiAgICBtLmRpc2FibGVEZXB0aFdyaXRlID0gdHJ1ZTsgcC5tYXRlcmlhbCA9IG07IHAuYWxwaGFJbmRleCA9IDUgKyBuOyByZXR1cm4geyB0LCBuLCBtIH07XG4gIH0pO1xuICAvLyB2aWduZXR0ZTogZGFya2VucyB0aGUgZmxvb3IgdG93YXJkIHRoZSBlZGdlcyBzbyB0aGUgZmllbGQgbG9va3MgbGlrZSBhIGxpdCBwb29sIGluc2lkZSB0aGUgY2F2ZVxuICBjb25zdCB2dCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCd2aWcnLCB7IHdpZHRoOiAyNTYsIGhlaWdodDogMjU2IH0sIHNjZW5lLCB0cnVlKSwgdmMgPSB2dC5nZXRDb250ZXh0KCksIGcgPSB2Yy5jcmVhdGVSYWRpYWxHcmFkaWVudCgxMjgsIDEyOCwgMCwgMTI4LCAxMjgsIDEyOCk7XG4gIGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDAsMCwwLDApJyk7IGcuYWRkQ29sb3JTdG9wKDAuNDIsICdyZ2JhKDAsMCwwLDApJyk7IGcuYWRkQ29sb3JTdG9wKDAuOCwgJ3JnYmEoMCw0LDYsMC43KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgwLDQsNiwwLjk1KScpO1xuICB2Yy5maWxsU3R5bGUgPSBnOyB2Yy5maWxsUmVjdCgwLCAwLCAyNTYsIDI1Nik7IHZ0LnVwZGF0ZSgpOyB2dC5oYXNBbHBoYSA9IHRydWU7XG4gIGNvbnN0IHZpZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCd2aWcnLCB7IHdpZHRoOiA0NiwgaGVpZ2h0OiAzMCB9LCBzY2VuZSk7IHZpZy5wb3NpdGlvbi55ID0gMC4wMzsgdmlnLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgY29uc3Qgdm0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd2aWdtJywgc2NlbmUpOyB2bS5kaWZmdXNlVGV4dHVyZSA9IHZ0OyB2bS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHZtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHZtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMCwgMC4wMSwgMC4wMTUpOyB2bS5kaXNhYmxlRGVwdGhXcml0ZSA9IHRydWU7IHZpZy5tYXRlcmlhbCA9IHZtOyB2aWcuYWxwaGFJbmRleCA9IDE7XG4gIHJldHVybiB7IHdhbGxNYXQ6IHdtLCBtaXN0TWF0czogbGF5ZXJzLm1hcCgobCkgPT4gbC5tKSwgdXBkYXRlOiAodDogbnVtYmVyKSA9PiB7IGZvciAoY29uc3QgbCBvZiBsYXllcnMpIHsgbC50LnVPZmZzZXQgPSB0ICogKDAuMDA2ICsgbC5uICogMC4wMDQpOyBsLnQudk9mZnNldCA9IHQgKiAwLjAwMyAqIChsLm4gPyAtMSA6IDEpOyB9IH0gfTtcbn1cbiIsICIvLyBBdXRvLWJhdHRsZSBzaW11bGF0aW9uOiBwdXJlIGxvZ2ljLCBubyBncmFwaGljcy4gRGV0ZXJtaW5pc3RpYyBmb3IgYSBnaXZlbiBzZWVkLlxuLy8gVGhlIHJlbmRlcmVyIG9ubHkgcmVhZHMgZmlnaHRlcnMgKyBldmVudHM7IGl0IG5ldmVyIGRlY2lkZXMgYW55dGhpbmcuXG4vL1xuLy8gQWJpbGl0aWVzIChudW1iZXJzIGxpdmUgaW4gYmFsYW5jZS50cyk6XG4vLyAgIFNrZWxldG9uIFdhcnJpb3IgIFBoYWxhbnggICAgIHRha2VzIGxlc3MgZGFtYWdlIGZvciBlYWNoIG5lYXJieSBhbGxpZWQgV2FycmlvciAoY2FwcGVkKVxuLy8gICBTa2VsZXRvbiBBcmNoZXIgICBTcGxpdCBBcnJvdyAoc2tpbGwpIG9uZSBhcnJvdyBhdCBlYWNoIG9mIHVwIHRvIDMgZGlmZmVyZW50IGVuZW1pZXM7IGJhc2ljIHNob3RzIGFyZSBhIHNpbmdsZSBhcnJvd1xuLy8gICBHb2JsaW4gICAgICAgICAgICBPcHBvcnR1bmlzdCArZGFtYWdlIG9uIGFuIGVuZW15IHRoYXQgaXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlOyBwcmVmZXJzIHN1Y2ggdGFyZ2V0c1xuLy8gICBLbmlnaHQgICAgICAgICAgICBUYXVudCAoc2tpbGwpICBmb3JjZXMgbmVhcmJ5IGVuZW1pZXMgdG8gYXR0YWNrIGhpbVxuLy8gICBPZ3JlICAgICAgICAgICAgICBTbWFzaCAoc2tpbGwpICBoZWF2eSBzbGFtIHRoYXQgYWxzbyBoaXRzIGVuZW1pZXMgbmVhciB0aGUgaW1wYWN0XG4vLyBTa2lsbHMgcnVuIG9uIG1hbmE6IGJhc2ljIGF0dGFja3MgYW5kIGRhbWFnZSB0YWtlbiBmaWxsIGEgYmFyOyB3aGVuIGZ1bGwsIHRoZSBuZXh0IGF0dGFjayBpcyB0aGUgc2tpbGwgYW5kIHRoZSBiYXIgcmVzZXRzLlxuLy8gV2FycmlvciwgR29ibGluIGFuZCBCYXJiYXJpYW4gaGF2ZSBwYXNzaXZlcyBvbmx5IChubyBtYW5hKS5cbi8vICAgQmFyYmFyaWFuICAgICAgICAgRnJlbnp5ICAgICAgYXR0YWNrcyBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nXG5cbmltcG9ydCB7IEdSSURfQ09MUywgR1JJRF9ST1dTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgY29uc3QgR1JJRF9TUCA9IDEuMzsgICAgIC8vIG1ldHJlcyBiZXR3ZWVuIGdyaWQgY2VsbHNcbmV4cG9ydCBjb25zdCBGUk9OVF9YID0gMS43OyAgICAgLy8gZnJvbnQgbGluZSdzIGRpc3RhbmNlIGZyb20gdGhlIGNlbnRyZSBsaW5lXG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xvdCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXIgfVxuXG4vKiogV29ybGQgcG9zaXRpb24gb2YgYSBncmlkIGNlbGwgZm9yIGEgdGVhbSAodGVhbSAwID0gbGVmdCwgZmFjZXMgK1g7IHRlYW0gMSA9IHJpZ2h0LCBmYWNlcyAtWCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2VsbFBvcyh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKTogeyB4OiBudW1iZXI7IHo6IG51bWJlciB9IHtcbiAgY29uc3Qgcm93ID0gTWF0aC5mbG9vcihjZWxsIC8gR1JJRF9DT0xTKSwgY29sID0gY2VsbCAlIEdSSURfQ09MUztcbiAgY29uc3QgZGVwdGggPSBHUklEX0NPTFMgLSAxIC0gY29sOyAgICAgICAgICAgICAgICAgICAgICAgLy8gMCA9IGZyb250IGxpbmVcbiAgcmV0dXJuIHsgeDogKEZST05UX1ggKyBkZXB0aCAqIEdSSURfU1ApICogKHRlYW0gPT09IDAgPyAtMSA6IDEpLCB6OiAocm93IC0gKEdSSURfUk9XUyAtIDEpIC8gMikgKiBHUklEX1NQIH07XG59XG5cbmNvbnN0IEZST05UTkVTUzogUmVjb3JkPFNvdWxJZCwgbnVtYmVyPiA9IHsga25pZ2h0OiA1LCBvZ3JlOiA0LCB3YXJyaW9yOiAzLCBiYXJiYXJpYW46IDMsIGdvYmxpbjogMiwgYXJjaGVyOiAwIH07XG4vKiogVGhlIGVuZW15IGFybXkgaXMgcGxhY2VkIGF1dG9tYXRpY2FsbHkgKHRhbmtzIHVwIGZyb250LCBhcmNoZXJzIGJlaGluZCk7IHRoZSBwbGF5ZXIgb25seSBldmVyIHNlZXMgaXRzIGNvbXBvc2l0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZW15Q2VsbHMoc3BlY3M6IFNwZWNbXSk6IG51bWJlcltdIHtcbiAgY29uc3QgY2VsbHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DT0xTICogR1JJRF9ST1dTOyBjKyspIGNlbGxzLnB1c2goYyk7XG4gIGNlbGxzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBkYSA9IEdSSURfQ09MUyAtIDEgLSAoYSAlIEdSSURfQ09MUyksIGRiID0gR1JJRF9DT0xTIC0gMSAtIChiICUgR1JJRF9DT0xTKTtcbiAgICBpZiAoZGEgIT09IGRiKSByZXR1cm4gZGEgLSBkYjtcbiAgICByZXR1cm4gTWF0aC5hYnMoTWF0aC5mbG9vcihhIC8gR1JJRF9DT0xTKSAtIDEpIC0gTWF0aC5hYnMoTWF0aC5mbG9vcihiIC8gR1JJRF9DT0xTKSAtIDEpO1xuICB9KTtcbiAgY29uc3Qgb3JkZXIgPSBzcGVjcy5tYXAoKHMsIGkpID0+IGkpLnNvcnQoKGksIGopID0+IEZST05UTkVTU1tzcGVjc1tqXS5zb3VsXSAtIEZST05UTkVTU1tzcGVjc1tpXS5zb3VsXSk7XG4gIGNvbnN0IG91dCA9IG5ldyBBcnJheTxudW1iZXI+KHNwZWNzLmxlbmd0aCk7XG4gIG9yZGVyLmZvckVhY2goKGlkeCwgaykgPT4geyBvdXRbaWR4XSA9IGNlbGxzW2tdOyB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IHR5cGUgRlN0YXRlID0gJ2lkbGUnIHwgJ3J1bicgfCAnYXR0YWNrJyB8ICdkZWFkJztcbmV4cG9ydCBpbnRlcmZhY2UgRmlnaHRlciB7XG4gIGlkOiBudW1iZXI7IHRlYW06IDAgfCAxOyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyO1xuICB4OiBudW1iZXI7IHo6IG51bWJlcjsgeWF3OiBudW1iZXI7XG4gIGhwOiBudW1iZXI7IG1heEhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBpbnRlcnZhbDogbnVtYmVyOyByYW5nZTogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyByYWRpdXM6IG51bWJlcjtcbiAgYWxpdmU6IGJvb2xlYW47IHN0YXRlOiBGU3RhdGU7XG4gIHRhcmdldDogbnVtYmVyOyByZXRhcmdldEF0OiBudW1iZXI7IGZvcmNlZFRhcmdldDogbnVtYmVyOyBmb3JjZWRVbnRpbDogbnVtYmVyO1xuICBuZXh0QXR0YWNrOiBudW1iZXI7IGF0dGFja1N0YXJ0OiBudW1iZXI7IGF0dGFja0R1cjogbnVtYmVyOyBhbmltU3BlZWQ6IG51bWJlcjsgaGl0RG9uZTogYm9vbGVhbjtcbiAgbWFuYTogbnVtYmVyOyBtYXhNYW5hOiBudW1iZXI7IGNhc3Rpbmc6IGJvb2xlYW47IGZyZW56eTogbnVtYmVyOyBkZWFkQXQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgQkV2ZW50ID1cbiAgfCB7IHQ6ICdzd2luZyc7IGlkOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdoaXQnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyOyBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ2Fycm93JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnZGVhdGgnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdjYXN0JzsgaWQ6IG51bWJlcjsgc2tpbGw6ICdzcGxpdCcgfCAndGF1bnQnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAndGF1bnQnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdzbWFzaCc7IGlkOiBudW1iZXI7IHg6IG51bWJlcjsgejogbnVtYmVyOyByOiBudW1iZXIgfVxuICB8IHsgdDogJ2ZyZW56eSc7IGlkOiBudW1iZXI7IHN0YWNrczogbnVtYmVyIH07XG5cbmV4cG9ydCBjbGFzcyBCYXR0bGUge1xuICB0aW1lID0gMDtcbiAgZmlnaHRlcnM6IEZpZ2h0ZXJbXSA9IFtdO1xuICBldmVudHM6IEJFdmVudFtdID0gW107XG4gIHdpbm5lcjogLTEgfCAwIHwgMSA9IC0xO1xuICBybmc6IFJuZztcbiAgcHJpdmF0ZSBwZW5kaW5nOiB7IGF0OiBudW1iZXI7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXIgfVtdID0gW107XG4gIHByaXZhdGUgbmV4dElkID0gMTtcbiAgcHJpdmF0ZSBlbmVteVBvd2VyID0gMTtcbiAgcHJpdmF0ZSBmbGlwID0gZmFsc2U7XG5cbiAgLyoqIGBsZXZlbHNgOiB0aGUgcGxheWVyJ3MgcGVybWFuZW50IFNvdWwgbGV2ZWxzIChoZWFsdGggYW5kIGRhbWFnZSBncm93IGEgbGl0dGxlIHBlciBsZXZlbCkuIEVuZW1pZXMgbmV2ZXIgdXNlIHRoZW0uICovXG4gIC8qKiBgZW5lbXlQb3dlcmA6IGhlYWx0aCBhbmQgZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBlbmVteSB0ZWFtIG9ubHkgKHN0YWdlIHN0cmVuZ3RoOyAxID0gYXMgd3JpdHRlbikuICovXG4gIGNvbnN0cnVjdG9yKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSwgbGV2ZWxzPzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiwgZW5lbXlQb3dlciA9IDEpIHtcbiAgICB0aGlzLnJuZyA9IG1ha2VSbmcoc2VlZCk7IHRoaXMuZW5lbXlQb3dlciA9IGVuZW15UG93ZXI7XG4gICAgZm9yIChjb25zdCBwIG9mIHBsYXllcnMpIHRoaXMuYWRkKDAsIHAuc291bCwgcC5zdGFyLCBwLmNlbGwsIGxldmVscz8uW3Auc291bF0gPz8gMSk7XG4gICAgY29uc3QgY2VsbHMgPSBlbmVteUNlbGxzKGVuZW1pZXMpO1xuICAgIGVuZW1pZXMuZm9yRWFjaCgoZSwgaSkgPT4gdGhpcy5hZGQoMSwgZS5zb3VsLCBlLnN0YXIsIGNlbGxzW2ldKSk7XG4gIH1cblxuICBwcml2YXRlIGFkZCh0ZWFtOiAwIHwgMSwgc291bDogU291bElkLCBzdGFyOiBudW1iZXIsIGNlbGw6IG51bWJlciwgbGV2ZWwgPSAxKTogRmlnaHRlciB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tzb3VsXSwgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCk7XG4gICAgY29uc3QgbHZIcCA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmhwLCBsdkRtZyA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmRtZztcbiAgICBjb25zdCBwdyA9IHRlYW0gPT09IDEgPyB0aGlzLmVuZW15UG93ZXIgOiAxO1xuICAgIGNvbnN0IGhwID0gc3QuaHAgKiBCLnN0YXIuaHBbc3RhciAtIDFdICogbHZIcCAqIHB3O1xuICAgIGNvbnN0IGY6IEZpZ2h0ZXIgPSB7XG4gICAgICBpZDogdGhpcy5uZXh0SWQrKywgdGVhbSwgc291bCwgc3RhciwgY2VsbCwgeDogcC54LCB6OiBwLnosIHlhdzogdGVhbSA9PT0gMCA/IDAgOiBNYXRoLlBJLFxuICAgICAgaHAsIG1heEhwOiBocCwgZG1nOiBzdC5kbWcgKiBCLnN0YXIuZG1nW3N0YXIgLSAxXSAqIGx2RG1nICogcHcsIGludGVydmFsOiBzdC5pbnRlcnZhbCwgcmFuZ2U6IHN0LnJhbmdlLCBzcGVlZDogc3Quc3BlZWQsIHJhZGl1czogc3Quc2l6ZSAqIEIuc3Rhci5zY2FsZVtzdGFyIC0gMV0sXG4gICAgICBhbGl2ZTogdHJ1ZSwgc3RhdGU6ICdpZGxlJywgdGFyZ2V0OiAtMSwgcmV0YXJnZXRBdDogMCwgZm9yY2VkVGFyZ2V0OiAtMSwgZm9yY2VkVW50aWw6IDAsXG4gICAgICBuZXh0QXR0YWNrOiB0aGlzLnJuZy5uZXh0KCkgKiAwLjMsIGF0dGFja1N0YXJ0OiAtOSwgYXR0YWNrRHVyOiAxLCBhbmltU3BlZWQ6IDEsIGhpdEZyYWM6IDAsIGhpdERvbmU6IHRydWUsXG4gICAgICBtYW5hOiAwLCBtYXhNYW5hOiBCLm1hbmFbc291bF0/Lm1heCA/PyAwLCBjYXN0aW5nOiBmYWxzZSwgZnJlbnp5OiAwLCBkZWFkQXQ6IDAsXG4gICAgfSBhcyBGaWdodGVyO1xuICAgIHRoaXMuZmlnaHRlcnMucHVzaChmKTsgcmV0dXJuIGY7XG4gIH1cblxuICBieUlkKGlkOiBudW1iZXIpOiBGaWdodGVyIHwgdW5kZWZpbmVkIHsgcmV0dXJuIGlkIDwgMCA/IHVuZGVmaW5lZCA6IHRoaXMuZmlnaHRlcnNbaWQgLSAxXTsgfVxuICBmb2VzKGY6IEZpZ2h0ZXIpOiBGaWdodGVyW10geyByZXR1cm4gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgby50ZWFtICE9PSBmLnRlYW0pOyB9XG4gIGNvdW50KHRlYW06IDAgfCAxKTogbnVtYmVyIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMucmVkdWNlKChuLCBmKSA9PiBuICsgKGYuYWxpdmUgJiYgZi50ZWFtID09PSB0ZWFtID8gMSA6IDApLCAwKTsgfVxuICBkcmFpbigpOiBCRXZlbnRbXSB7IGNvbnN0IGUgPSB0aGlzLmV2ZW50czsgdGhpcy5ldmVudHMgPSBbXTsgcmV0dXJuIGU7IH1cblxuICBzdGVwKGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy53aW5uZXIgPj0gMCkgcmV0dXJuO1xuICAgIHRoaXMudGltZSArPSBkdDsgdGhpcy5mbGlwID0gIXRoaXMuZmxpcDtcbiAgICAvLyBhcnJvd3MgdGhhdCBoYXZlIGZpbmlzaGVkIGZseWluZ1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnBlbmRpbmcubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBlbmRpbmdbaV07XG4gICAgICBpZiAodGhpcy50aW1lID49IHAuYXQpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnNwbGljZShpLCAxKTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLmJ5SWQocC50byksIGZyb20gPSB0aGlzLmJ5SWQocC5mcm9tKTtcbiAgICAgICAgaWYgKHRvICYmIHRvLmFsaXZlICYmIGZyb20pIHRoaXMuZGFtYWdlKHRvLCBwLmRtZywgZnJvbSwgJ2Fycm93Jyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG9yZGVyID0gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAodGhpcy5mbGlwKSBvcmRlci5yZXZlcnNlKCk7XG4gICAgZm9yIChjb25zdCBmIG9mIG9yZGVyKSBpZiAoZi5hbGl2ZSkgdGhpcy51cGRhdGUoZiwgZHQpO1xuICAgIGNvbnN0IGEgPSB0aGlzLmNvdW50KDApLCBiID0gdGhpcy5jb3VudCgxKTtcbiAgICBpZiAoIWEgfHwgIWIpIHRoaXMud2lubmVyID0gYSA/IDAgOiAxO1xuICAgIGVsc2UgaWYgKHRoaXMudGltZSA+PSBCQUxBTkNFLnNpbS50aW1lTGltaXQpIHtcbiAgICAgIGNvbnN0IGhwID0gKHQ6IDAgfCAxKSA9PiB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHQpLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKTtcbiAgICAgIHRoaXMud2lubmVyID0gaHAoMCkgPiBocCgxKSA/IDAgOiAxO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwZXItZmlnaHRlciB1cGRhdGVcbiAgcHJpdmF0ZSB1cGRhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTtcbiAgICB0aGlzLnNlcGFyYXRlKGYsIGR0KTtcblxuICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykge1xuICAgICAgY29uc3QgdCA9IHRoaXMudGltZSAtIGYuYXR0YWNrU3RhcnQ7XG4gICAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7IGlmICh0ZyAmJiB0Zy5hbGl2ZSkgdGhpcy5mYWNlKGYsIHRnLnggLSBmLngsIHRnLnogLSBmLnosIGR0KTtcbiAgICAgIGlmICghZi5oaXREb25lICYmIHQgPj0gZi5hdHRhY2tEdXIgKiBzdC5oaXRGcmFjKSB7IGYuaGl0RG9uZSA9IHRydWU7IHRoaXMucmVzb2x2ZUhpdChmKTsgfVxuICAgICAgaWYgKHQgPj0gZi5hdHRhY2tEdXIpIGYuc3RhdGUgPSAnaWRsZSc7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYWNxdWlyZShmKTtcbiAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgcmV0dXJuOyB9XG4gICAgY29uc3QgZHggPSB0Zy54IC0gZi54LCBkeiA9IHRnLnogLSBmLnosIGRpc3QgPSBNYXRoLmh5cG90KGR4LCBkeik7XG4gICAgdGhpcy5mYWNlKGYsIGR4LCBkeiwgZHQpO1xuICAgIGlmIChkaXN0IDw9IGYucmFuZ2UpIHtcbiAgICAgIGlmICh0aGlzLnRpbWUgPj0gZi5uZXh0QXR0YWNrKSB0aGlzLnN0YXJ0QXR0YWNrKGYpOyBlbHNlIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmLnN0YXRlID0gJ3J1bic7IGNvbnN0IGsgPSBmLnNwZWVkICogZHQgLyBNYXRoLm1heChkaXN0LCAxZS00KTsgZi54ICs9IGR4ICogazsgZi56ICs9IGR6ICogazsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICAvKipcbiAgICogS2VlcCBmaWdodGVycyBmcm9tIHN0YWNraW5nIHdpdGhvdXQgc2hvdmluZyBhbnlvbmUgYWNyb3NzIHRoZSBtYXAuXG4gICAqIC0gQSBmaWdodGVyIHRoYXQgaXMgc3RhbmRpbmcgYW5kIGZpZ2h0aW5nIGlzIFwicGxhbnRlZFwiOiBpdCBiYXJlbHkgbW92ZXM7IHRoZSBvbmVzIHN0aWxsIFdBTEtJTkcgeWllbGQgdG8gaXQuXG4gICAqIC0gSGVhdmllciB1bml0cyAoT2dyZSwgS25pZ2h0KSBwdXNoIGxpZ2h0ZXIgb25lcyBtb3JlIHRoYW4gdGhlIG90aGVyIHdheSByb3VuZC5cbiAgICogLSBUaGUgdG90YWwgcHVzaCBvbiBvbmUgZmlnaHRlciBpcyBjYXBwZWQgcGVyIHNlY29uZCwgc28gYSBjcm93ZCBjYW4gbmV2ZXIgc2xpZGUgYSB1bml0IGZhci5cbiAgICovXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IHBsYW50ZWQgPSAodTogRmlnaHRlcikgPT4gdS5zdGF0ZSA9PT0gJ2F0dGFjaycgfHwgdS5zdGF0ZSA9PT0gJ2lkbGUnLCBtYXNzID0gKHU6IEZpZ2h0ZXIpID0+IHUucmFkaXVzICogdS5yYWRpdXM7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgbGV0IHNoYXJlID0gbWFzcyhvKSAvIChtYXNzKGYpICsgbWFzcyhvKSk7ICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgbGlnaHRlciBvbmUgb2YgdGhlIHBhaXIgbW92ZXMgbW9yZVxuICAgICAgY29uc3QgcGYgPSBwbGFudGVkKGYpLCBwbyA9IHBsYW50ZWQobyk7XG4gICAgICBpZiAocGYgJiYgIXBvKSBzaGFyZSAqPSAwLjEyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZiBpcyBzdGFuZGluZyBpdHMgZ3JvdW5kOiB0aGUgd2Fsa2VyIG8gZ29lcyBhcm91bmRcbiAgICAgIGVsc2UgaWYgKCFwZiAmJiBwbykgc2hhcmUgPSBNYXRoLm1pbigxLCBzaGFyZSAqIDEuNSArIDAuMzUpOyAgICAvLyBmIGlzIHdhbGtpbmcgaW50byBhIHBsYW50ZWQgdW5pdDogZiB5aWVsZHNcbiAgICAgIGVsc2UgaWYgKHBmICYmIHBvKSBzaGFyZSAqPSAwLjM1OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0d28gc3RhbmRpbmcgdW5pdHMgb3ZlcmxhcCBhIGxpdHRsZTogZWFzZSBhcGFydCB2ZXJ5IHNsb3dseVxuICAgICAgY29uc3QgayA9ICgod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMykpICogc2hhcmUgKiAyO1xuICAgICAgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBsZXQgbXggPSBweCAqIHMsIG16ID0gcHogKiBzO1xuICAgIGNvbnN0IGNhcCA9IChwbGFudGVkKGYpID8gMC41IDogMS42KSAqIGR0LCBsZW4gPSBNYXRoLmh5cG90KG14LCBteik7ICAgLy8gbWV0cmVzIHBlciBzZWNvbmQsIHN0YW5kaW5nIHZzIHdhbGtpbmdcbiAgICBpZiAobGVuID4gY2FwKSB7IG14ICo9IGNhcCAvIGxlbjsgbXogKj0gY2FwIC8gbGVuOyB9XG4gICAgZi54ICs9IG14OyBmLnogKz0gbXo7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgZi5yZXRhcmdldEF0ID0gdGhpcy50aW1lICsgQkFMQU5DRS5zaW0ucmV0YXJnZXRFdmVyeSAqICgwLjggKyAwLjQgKiB0aGlzLnJuZy5uZXh0KCkpO1xuICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZik7IGlmICghZm9lcy5sZW5ndGgpIHsgZi50YXJnZXQgPSAtMTsgcmV0dXJuOyB9XG4gICAgbGV0IGJlc3QgPSBmb2VzWzBdLCBicyA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgbyBvZiBmb2VzKSB7XG4gICAgICBsZXQgc2NvcmUgPSBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KTtcbiAgICAgIGlmIChmLnNvdWwgPT09ICdnb2JsaW4nKSB7XG4gICAgICAgIC8vIGtpbGwtc3RlYWw6IHByZWZlciBuZWFyYnkgZW5lbWllcyBhbHJlYWR5IGZpZ2h0aW5nIG9uZSBvZiBvdXIgYWxsaWVzLCBhbmQgd291bmRlZCBvbmVzXG4gICAgICAgIGNvbnN0IGVuZ2FnZWQgPSB0aGlzLmJ5SWQoby50YXJnZXQpOyBjb25zdCBidXN5ID0gISFlbmdhZ2VkICYmIGVuZ2FnZWQuYWxpdmUgJiYgZW5nYWdlZC50ZWFtID09PSBmLnRlYW0gJiYgZW5nYWdlZC5pZCAhPT0gZi5pZDtcbiAgICAgICAgaWYgKGJ1c3kgJiYgc2NvcmUgPCBCQUxBTkNFLm9wcG9ydHVuaXN0LnNlZWtSYWRpdXMgKyAyKSBzY29yZSAtPSAzO1xuICAgICAgICBzY29yZSAtPSBCQUxBTkNFLm9wcG9ydHVuaXN0LndvdW5kZWRXZWlnaHQgKiAoMSAtIG8uaHAgLyBvLm1heEhwKTtcbiAgICAgIH1cbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzAsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQsIGxldmVscywgZW5lbXlQb3dlcik7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgIi8vIEVuZGxlc3MgRGVwdGhzOiBlbmVteSB3YXZlcyBidWlsdCBmcm9tIGEgQlVER0VUIGluc3RlYWQgb2YgYSBoYW5kLXdyaXR0ZW4gbGlzdCwgc28gdGhlIG1vZGUgbmV2ZXIgcnVucyBvdXQgb2Ygd2F2ZXMuXG4vLyBUaGUgYnVkZ2V0IGlzIHRoZSBlbmVteSB0ZWFtJ3MgdG90YWwgRG9taW5pb24gY29zdCAodGhlIHNhbWUgQ09TVCB0YWJsZSB0aGUgcGxheWVyIHBheXMgZnJvbSkuIFdhdmVzIGFyZSBidWlsdCBmcm9tIHJvbGUgVEVNUExBVEVTIHNvIHRoZXlcbi8vIGxvb2sgZGVzaWduZWQgKGEgZnJvbnQgbGluZSB3aXRoIGFyY2hlcnMgYmVoaW5kLCBhIHN3YXJtLCBhIGJydXRlIHNxdWFkKSBpbnN0ZWFkIG9mIGEgcmFuZG9tIHBpbGUuIEV2ZXJ5dGhpbmcgaXMgc2VlZGVkOiB0aGUgc2FtZSBzZWVkIGdpdmVzXG4vLyB0aGUgc2FtZSB3YXZlcywgc28gYSByZXRyeSAob3IgYSBkYWlseSBzZWVkKSBmYWNlcyBleGFjdGx5IHRoZSBzYW1lIGFybXkuXG4vL1xuLy8gVGhlIHBsYXllcidzIGFybXkgaXMgY2FwcGVkIG9uIHB1cnBvc2UgKERvbWluaW9uIHN0b3BzIGF0IDQwLCB0aGUgZ3JpZCBob2xkcyAxMiksIHNvIGF0IHNvbWUgcG9pbnQgdGhlIGVuZW15IHNpbXBseSBvdXQtc2NhbGVzIGl0OiB0aGF0IGlzIHRoZVxuLy8gXCJoYXJkIHdhbGxcIi4gT25jZSB0aGUgYnVkZ2V0IGZpbGxzIHRoZSAxMiBzbG90cyB3aXRoIHVwZ3JhZGVkIHVuaXRzLCBgZW5kbGVzc1Bvd2VyYCAodGhlIGhpZGRlbiBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIpIGtlZXBzIGNsaW1iaW5nLlxuLy8gTnVtYmVycyBoZXJlIGFyZSB0dW5lZCB3aXRoIHNpbS9lbmRsZXNzX2N1cnZlLnRzLlxuXG5pbXBvcnQgeyBDT1NUIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IEVuZW15U3BlYyB9IGZyb20gJy4vd2F2ZXMudHMnO1xuXG5leHBvcnQgY29uc3QgRU5ETEVTU19JRCA9ICdlbmRsZXNzJztcbi8qKiBBIHBhY2sgaXMgZ3JhbnRlZCBldmVyeSB0aGlzLW1hbnkgd2F2ZXMgY2xlYXJlZCBpbiBhbiBlbmRsZXNzIHJ1bi4gKi9cbmV4cG9ydCBjb25zdCBFTkRMRVNTX1BBQ0tfRVZFUlkgPSAxMDtcbmNvbnN0IE1BWF9VTklUUyA9IDEyO1xuXG4vKiogVGhlIHR1bmluZyBrbm9icyAoc2ltL2VuZGxlc3NfY3VydmUudHMgc3dlZXBzIHRoZW0pLiAqL1xuZXhwb3J0IGNvbnN0IFRVTkUgPSB7IHN0YXJ0OiA1LCBzbG9wZTogMy4wLCBsYXRlU2xvcGU6IDAuOCwgbWF4QnVkZ2V0OiAxNTAsIHBvd2VyU2xvcGU6IDAuMDMsIGNoYW1waW9uOiAxLjAgfTtcbi8qKiBUb3RhbCBEb21pbmlvbiBjb3N0IG9mIHRoZSBlbmVteSB0ZWFtIGF0IHdhdmUgYG5gICgxLWJhc2VkKTogYSBnZW50bGUgc3RhcnQgKGFib3V0IHRoZSBOb3JtYWwgY2FtcGFpZ24gYnkgd2F2ZSAxMCksIHRoZW4gaXQga2VlcHMgcmlzaW5nLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NCdWRnZXQobjogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDEsIG4pLCBlYXJseSA9IFRVTkUuc3RhcnQgKyBUVU5FLnNsb3BlICogKE1hdGgubWluKHcsIDEwKSAtIDEpO1xuICByZXR1cm4gTWF0aC5yb3VuZChNYXRoLm1pbihUVU5FLm1heEJ1ZGdldCwgZWFybHkgKyAodyA+IDEwID8gVFVORS5sYXRlU2xvcGUgKiAodyAtIDEwKSA6IDApKSk7XG59XG4vKiogSGlkZGVuIGVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllcjogMS4wIHRocm91Z2ggd2F2ZSAxMCwgdGhlbiByaXNpbmc7IGV2ZXJ5IDEwdGggKGNoYW1waW9uKSB3YXZlIGdldHMgYSBsaXR0bGUgZXh0cmEuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc1Bvd2VyKG46IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHcgPSBNYXRoLm1heCgxLCBuKSwgYmFzZSA9IHcgPD0gMTAgPyAxIDogMSArIFRVTkUucG93ZXJTbG9wZSAqICh3IC0gMTApO1xuICByZXR1cm4gKyh3ICUgMTAgPT09IDAgPyBiYXNlICogVFVORS5jaGFtcGlvbiA6IGJhc2UpLnRvRml4ZWQoMyk7XG59XG4vKiogUGFjayB0aWVyIGZvciBjbGVhcmluZyB3YXZlIGBuYCAob25seSBtZWFuaW5nZnVsIHdoZW4gbiBpcyBhIG11bHRpcGxlIG9mIEVORExFU1NfUEFDS19FVkVSWSkuICovXG5leHBvcnQgY29uc3QgZW5kbGVzc1BhY2tUaWVyID0gKG46IG51bWJlcik6IG51bWJlciA9PiAobiA+PSAzMCA/IDMgOiBuID49IDIwID8gMiA6IDEpO1xuXG50eXBlIFJvbGUgPSAndGFuaycgfCAnYnJ1dGUnIHwgJ3JhbmdlZCcgfCAnZm9kZGVyJztcbmNvbnN0IFJPTEU6IFJlY29yZDxSb2xlLCBTb3VsSWRbXT4gPSB7IHRhbms6IFsna25pZ2h0JywgJ29ncmUnXSwgYnJ1dGU6IFsnYmFyYmFyaWFuJywgJ29ncmUnXSwgcmFuZ2VkOiBbJ2FyY2hlciddLCBmb2RkZXI6IFsnd2FycmlvcicsICdnb2JsaW4nXSB9O1xuZXhwb3J0IGludGVyZmFjZSBUZW1wbGF0ZSB7IGlkOiBzdHJpbmc7IG1peDogW1JvbGUsIG51bWJlcl1bXSB9XG5leHBvcnQgY29uc3QgVEVNUExBVEVTOiBUZW1wbGF0ZVtdID0gW1xuICB7IGlkOiAnd2FsbCcsIG1peDogW1sndGFuaycsIDNdLCBbJ3JhbmdlZCcsIDJdLCBbJ2ZvZGRlcicsIDFdXSB9LFxuICB7IGlkOiAnc3dhcm0nLCBtaXg6IFtbJ2ZvZGRlcicsIDVdLCBbJ3JhbmdlZCcsIDFdLCBbJ3RhbmsnLCAxXV0gfSxcbiAgeyBpZDogJ2JydXRlcycsIG1peDogW1snYnJ1dGUnLCA0XSwgWydmb2RkZXInLCAxXSwgWydyYW5nZWQnLCAxXV0gfSxcbiAgeyBpZDogJ21peGVkJywgbWl4OiBbWyd0YW5rJywgMV0sIFsnYnJ1dGUnLCAxXSwgWydyYW5nZWQnLCAxXSwgWydmb2RkZXInLCAyXV0gfSxcbl07XG5cbi8qKiBXYXZlcyAxLTIgYXJlIGEgZ2VudGxlIHdhcm0tdXA6IGNoZWFwIGZvZGRlciAoYW5kIGFuIGFyY2hlciksIG5vIHRhbmtzIG9yIGJydXRlcywgc28gbm9ib2R5IGxvc2VzIGEgaGVhcnQgdG8gdGhlIGZpcnN0IGZpZ2h0LiAqL1xuY29uc3QgV0FSTVVQOiBUZW1wbGF0ZSA9IHsgaWQ6ICd3YXJtdXAnLCBtaXg6IFtbJ2ZvZGRlcicsIDNdLCBbJ3JhbmdlZCcsIDFdXSB9O1xuLyoqIFdoaWNoIHRlbXBsYXRlIGEgd2F2ZSB1c2VzIChzZWVkZWQgcGVyIHdhdmUsIHNvIGl0IGRvZXMgbm90IGRlcGVuZCBvbiB3aGF0IGNhbWUgYmVmb3JlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzVGVtcGxhdGUobjogbnVtYmVyLCBzZWVkOiBudW1iZXIpOiBUZW1wbGF0ZSB7XG4gIGlmIChuIDw9IDIpIHJldHVybiBXQVJNVVA7XG4gIHJldHVybiBURU1QTEFURVNbTWF0aC5mbG9vcihtYWtlUm5nKHNlZWQgKiA0MDk5ICsgbiAqIDMxICsgNSkubmV4dCgpICogVEVNUExBVEVTLmxlbmd0aCldO1xufVxuXG4vKiogVGhlIGVuZW15IGFybXkgZm9yIGVuZGxlc3Mgd2F2ZSBgbmAgKDEtYmFzZWQpLiBBdCBtb3N0IDEyIHVuaXRzOyB0aGUgd2hvbGUgYnVkZ2V0IGlzIHNwZW50IHVubGVzcyBubyB1bml0IGZpdHMgd2hhdCBpcyBsZWZ0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NXYXZlKG46IG51bWJlciwgc2VlZCA9IDApOiBFbmVteVNwZWNbXSB7XG4gIGNvbnN0IHdhdmUgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKG4pKSwgcm5nID0gbWFrZVJuZyhzZWVkICogMTAwOSArIHdhdmUgKiA3OTE5ICsgMTcpLCB0cGwgPSBlbmRsZXNzVGVtcGxhdGUod2F2ZSwgc2VlZCk7XG4gIGxldCBsZWZ0ID0gZW5kbGVzc0J1ZGdldCh3YXZlKTsgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgaWYgKHdhdmUgJSAxMCA9PT0gMCAmJiBsZWZ0ID49IDIwKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjaGFtcGlvbiB3YXZlOiBvbmUgc3RhcnJlZCBicnV0ZSB1cCBmcm9udCAoMiBzdGFycywgMyBmcm9tIHdhdmUgNDApLCB0aGVuIHRoZSB1c3VhbCBlc2NvcnRcbiAgICBjb25zdCBzb3VsOiBTb3VsSWQgPSBybmcubmV4dCgpIDwgMC41ID8gJ29ncmUnIDogJ2tuaWdodCcsIHN0YXIgPSB3YXZlID49IDQwID8gMyA6IDI7IGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gIH1cbiAgY29uc3QgdG90YWwgPSB0cGwubWl4LnJlZHVjZSgoYSwgWywgd10pID0+IGEgKyB3LCAwKTtcbiAgZm9yIChsZXQgZ3VhcmQgPSAwOyBndWFyZCA8IDgwICYmIGFybXkubGVuZ3RoIDwgTUFYX1VOSVRTICYmIGxlZnQgPj0gMjsgZ3VhcmQrKykge1xuICAgIGxldCByID0gcm5nLm5leHQoKSAqIHRvdGFsLCByb2xlOiBSb2xlID0gdHBsLm1peFswXVswXTtcbiAgICBmb3IgKGNvbnN0IFtybywgd10gb2YgdHBsLm1peCkgeyByIC09IHc7IGlmIChyIDw9IDApIHsgcm9sZSA9IHJvOyBicmVhazsgfSB9XG4gICAgbGV0IG9wdGlvbnMgPSBST0xFW3JvbGVdLmZpbHRlcigocykgPT4gQ09TVFtzXVswXSA8PSBsZWZ0KTtcbiAgICBpZiAoIW9wdGlvbnMubGVuZ3RoKSBvcHRpb25zID0gUk9MRS5mb2RkZXIuZmlsdGVyKChzKSA9PiBDT1NUW3NdWzBdIDw9IGxlZnQpO1xuICAgIGlmICghb3B0aW9ucy5sZW5ndGgpIGJyZWFrO1xuICAgIGNvbnN0IHNvdWwgPSBybmcucGljayhvcHRpb25zKSwgcGVyID0gbGVmdCAvIE1hdGgubWF4KDEsIE1BWF9VTklUUyAtIGFybXkubGVuZ3RoKTtcbiAgICBsZXQgc3RhciA9IDE7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNwYXJlIGJ1ZGdldCBwZXIgZnJlZSBzbG90IGJ1eXMgc3RhcnNcbiAgICBmb3IgKGxldCBzID0gMzsgcyA+PSAyOyBzLS0pIGlmIChDT1NUW3NvdWxdW3MgLSAxXSA8PSBsZWZ0ICYmIENPU1Rbc291bF1bcyAtIDFdIDw9IE1hdGgubWF4KENPU1Rbc291bF1bMF0sIHBlciAqIDEuMikpIHsgc3RhciA9IHM7IGJyZWFrOyB9XG4gICAgYXJteS5wdXNoKHsgc291bCwgc3RhciB9KTsgbGVmdCAtPSBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbiAgfVxuICByZXR1cm4gYXJteTtcbn1cbiIsICIvLyBFbmVteSB3YXZlcyBhbmQgdGhlIGNhbXBhaWduJ3Mgc3RhZ2VzLiBTYW1lIHVuaXQgcG9vbCBhcyB0aGUgcGxheWVyLiBUaGUgYnVpbGQgc2NyZWVuIHByZXZpZXdzIHRoZSBDT01QT1NJVElPTiBvbmx5LCBuZXZlciBwb3NpdGlvbnMuXG4vL1xuLy8gRWFjaCBTVEFHRSBoYXMgZm91ciBkaWZmaWN1bHR5IHRpZXJzIChlYXN5IC8gbm9ybWFsIC8gaGFyZCAvIG5pZ2h0bWFyZSkuIExhdGVyIHN0YWdlcyBhcmUgaGFyZGVyOiB0aGV5IHJldXNlIHRvdWdoZXIgd2F2ZSBsaXN0cyBhbmQgYSBoaWRkZW5cbi8vIEVORU1ZIFBPV0VSIG11bHRpcGxpZXIgKGhlYWx0aCBhbmQgZGFtYWdlIG9mIGVuZW15IHVuaXRzKSB0dW5lZCBwZXIgc3RhZ2UgYW5kIHRpZXIgd2l0aCBzaW0vY2FsaWJyYXRlX3Bvd2VyLnRzLCBzbyB0aGF0IHRoZSBjb21wZXRlbnRcbi8vIHN0YW5kLWluIHBsYXllciBjbGVhcnMgZWFjaCB0aWVyIGFib3V0IDYwJSBvZiB0aGUgdGltZSBhdCB0aGF0IHRpZXIncyBSRUNPTU1FTkRFRCBTT1VMIExFVkVMIChldmVyeSBTb3VsIGF0IHRoYXQgbGV2ZWwpLlxuLy8gVW5sb2NrIHJ1bGVzIGxpdmUgaW4gcHJvZ3Jlc3MudHM6IEVhc3kgYW5kIE5vcm1hbCBhcmUgYWx3YXlzIG9wZW47IGNsZWFyaW5nIE5vcm1hbCBvcGVucyBIYXJkIGFuZCB0aGUgbmV4dCBzdGFnZTsgY2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5cbmltcG9ydCB7IENPU1QsIENVUlZFUywgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19JRCwgZW5kbGVzc1Bvd2VyLCBlbmRsZXNzV2F2ZSB9IGZyb20gJy4vZW5kbGVzcy50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVuZW15U3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyIH1cbmV4cG9ydCB0eXBlIERpZmYgPSAnZWFzeScgfCAnbm9ybWFsJyB8ICdoYXJkJyB8ICduaWdodG1hcmUnO1xuZXhwb3J0IGNvbnN0IERJRkZTOiBEaWZmW10gPSBbJ2Vhc3knLCAnbm9ybWFsJywgJ2hhcmQnLCAnbmlnaHRtYXJlJ107XG5cbmNvbnN0IExFVFRFUjogUmVjb3JkPHN0cmluZywgU291bElkPiA9IHsgVzogJ3dhcnJpb3InLCBBOiAnYXJjaGVyJywgRzogJ2dvYmxpbicsIEs6ICdrbmlnaHQnLCBPOiAnb2dyZScsIEI6ICdiYXJiYXJpYW4nIH07XG5jb25zdCBwYXJzZVdhdmUgPSAoczogc3RyaW5nKTogRW5lbXlTcGVjW10gPT4gcy5zcGxpdCgnICcpLm1hcCgodCkgPT4gKHsgc291bDogTEVUVEVSW3RbMF1dLCBzdGFyOiArdFsxXSB9KSk7XG5cbi8qKlxuICogV2F2ZSBsaXN0cyAoVyB3YXJyaW9yLCBBIGFyY2hlciwgRyBnb2JsaW4sIEsga25pZ2h0LCBPIG9ncmUsIEIgYmFyYmFyaWFuOyBkaWdpdCA9IHN0YXJzKS4gVGhlc2UgZm91ciB3ZXJlIHR1bmVkIGZvciBTdGFnZSAxOyBsYXRlciBzdGFnZXNcbiAqIHJldXNlIHRoZW0gb25lIHRpZXIgdXAgYW5kIGFkZCBlbmVteSBwb3dlci4gSGFyZCBhbmQgTmlnaHRtYXJlIGFyZSB2b2x1bWUtZHJpdmVuICh1cCB0byAxMiBlbmVtaWVzKS5cbiAqIENvbXBldGVudCBzdGFuZC1pbiBjbGVhciByYXRlIHdpdGggRVZFUlkgU291bCBhdCBsZXZlbCAxIC8gNCAvIDY6IGVhc3kgOTgvMTAwLzEwMCwgbm9ybWFsIDgyLzk4LzEwMCwgaGFyZCA3LzYwLzg3LCBuaWdodG1hcmUgMC8zMy83NC5cbiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFk6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMScsICdLMSBXMScsICdPMSBXMSBHMScsICdLMSBBMSBXMScsICdPMSBBMSBHMScsICdLMSBPMSBBMScsICdLMSBPMSBBMSBHMScsICdPMSBLMSBBMSBHMScsICdPMSBLMSBBMSBCMScsICdPMiBLMSBBMSBHMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEnLCAnTzEgQTEgRzEgVzEnLCAnSzEgTzEgQTEgVzEnLCAnTzEgSzEgQTEgRzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEnLCAnSzEgTzEgQTEgRzEgVzEnLCAnTzEgSzEgQTEgQjEgRzEnLCAnTzEgSzEgQTIgQjEgRzEnLCAnTzIgSzEgQTEgQjEgRzEgVzEnXSxcbiAgaGFyZDogWydXMSBBMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBBMSBHMSBXMSBXMScsICdLMSBPMSBBMSBXMSBHMSBXMScsICdPMSBLMSBBMiBHMSBXMSBXMSBXMScsICdBMiBLMSBPMSBHMSBXMSBCMSBXMSBXMScsICdLMSBPMSBBMSBHMSBXMiBXMSBXMScsICdPMSBLMSBBMiBCMSBHMSBXMSBXMSBHMScsICdPMiBLMSBBMiBCMSBHMSBXMSBXMSBHMScsICdPMiBLMiBBMSBCMSBHMSBXMSBXMSBXMSBHMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgQTEgRzEgVzEgQjEgVzEnLCAnSzEgTzEgQTEgVzEgRzEgVzEgVzEnLCAnTzEgSzEgQTIgRzEgVzEgQjEgVzEgVzEgRzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEgVzEgVzEgRzEgRzEnLCAnSzEgTzEgQTIgRzEgVzEgQjEgVzEgVzEgRzEgRzEgQjEnLCAnTzEgSzIgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEnLCAnTzIgSzEgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEgSzEnLCAnTzIgSzIgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEgSzEnXSxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhZ2VEZWYge1xuICBpZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IGJsdXJiOiBzdHJpbmc7XG4gIGxpc3RzOiBSZWNvcmQ8RGlmZiwgc3RyaW5nW10+OyAgICAgICAgICAvLyB0aGUgMTAgZW5lbXkgd2F2ZXMgZm9yIGVhY2ggdGllclxuICBwb3dlcjogUmVjb3JkPERpZmYsIG51bWJlcj47ICAgICAgICAgICAgLy8gaGlkZGVuIGVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgZWFjaCB0aWVyICgxID0gYXMgd3JpdHRlbilcbiAgcmVjOiBSZWNvcmQ8RGlmZiwgbnVtYmVyPjsgICAgICAgICAgICAgIC8vIHJlY29tbWVuZGVkIFNvdWwgbGV2ZWwgZm9yIGVhY2ggdGllciAoYSBoaW50IG9uIEhvbWUsIG5ldmVyIGEgbG9jaylcbn1cblxuLyoqIFRoZSBjYW1wYWlnbi4gTmFtZXMgYXJlIHBsYWNlaG9sZGVycy4gUG93ZXIgbnVtYmVycyBjb21lIGZyb20gc2ltL2NhbGlicmF0ZV9wb3dlci50cy4gKi9cbmV4cG9ydCBjb25zdCBTVEFHRVM6IFN0YWdlRGVmW10gPSBbXG4gIHsgaWQ6ICdjcnlwdCcsIG5hbWU6ICdUaGUgUmVzdGxlc3MgQ3J5cHQnLCBibHVyYjogJ1JhaXNlIHlvdXIgYXJteS4gVGhlIGRlYWQgaGVyZSBhcmUgb25seSBqdXN0IHN0aXJyaW5nLicsXG4gICAgbGlzdHM6IHsgZWFzeTogRElGRklDVUxUWS5lYXN5LCBub3JtYWw6IERJRkZJQ1VMVFkubm9ybWFsLCBoYXJkOiBESUZGSUNVTFRZLmhhcmQsIG5pZ2h0bWFyZTogRElGRklDVUxUWS5uaWdodG1hcmUgfSxcbiAgICBwb3dlcjogeyBlYXN5OiAxLCBub3JtYWw6IDEsIGhhcmQ6IDEsIG5pZ2h0bWFyZTogMSB9LCByZWM6IHsgZWFzeTogMSwgbm9ybWFsOiAxLCBoYXJkOiA0LCBuaWdodG1hcmU6IDYgfSB9LFxuICB7IGlkOiAnZ3JhdmV5YXJkJywgbmFtZTogJ1RoZSBTdW5rZW4gR3JhdmV5YXJkJywgYmx1cmI6ICdCaWdnZXIgY3Jvd2RzIGNyYXdsIG91dCBvZiB0aGUgbXVkLiBMZXZlbCB5b3VyIFNvdWxzIGJlZm9yZSB5b3UgY29tZS4nLFxuICAgIGxpc3RzOiB7IGVhc3k6IERJRkZJQ1VMVFkubm9ybWFsLCBub3JtYWw6IERJRkZJQ1VMVFkuaGFyZCwgaGFyZDogRElGRklDVUxUWS5uaWdodG1hcmUsIG5pZ2h0bWFyZTogRElGRklDVUxUWS5uaWdodG1hcmUgfSxcbiAgICBwb3dlcjogeyBlYXN5OiAxLjA1LCBub3JtYWw6IDEsIGhhcmQ6IDEuMDUsIG5pZ2h0bWFyZTogMS4xNSB9LCByZWM6IHsgZWFzeTogMiwgbm9ybWFsOiA0LCBoYXJkOiA2LCBuaWdodG1hcmU6IDggfSB9LFxuICB7IGlkOiAnYmFzdGlvbicsIG5hbWU6ICdUaGUgQm9uZSBCYXN0aW9uJywgYmx1cmI6ICdBIGZvcnRyZXNzIG9mIHRoZSBmYWxsZW4uIE9ubHkgd2VsbC1sZXZlbGxlZCBhcm1pZXMgaG9sZCB0aGUgZ2F0ZS4nLFxuICAgIGxpc3RzOiB7IGVhc3k6IERJRkZJQ1VMVFkuaGFyZCwgbm9ybWFsOiBESUZGSUNVTFRZLm5pZ2h0bWFyZSwgaGFyZDogRElGRklDVUxUWS5uaWdodG1hcmUsIG5pZ2h0bWFyZTogRElGRklDVUxUWS5uaWdodG1hcmUgfSxcbiAgICBwb3dlcjogeyBlYXN5OiAwLjksIG5vcm1hbDogMS4wNSwgaGFyZDogMS4xNSwgbmlnaHRtYXJlOiAxLjMgfSwgcmVjOiB7IGVhc3k6IDQsIG5vcm1hbDogNiwgaGFyZDogOCwgbmlnaHRtYXJlOiAxMCB9IH0sXG5dO1xuZXhwb3J0IGNvbnN0IHN0YWdlSW5kZXggPSAoaWQ6IHN0cmluZyk6IG51bWJlciA9PiBNYXRoLm1heCgwLCBTVEFHRVMuZmluZEluZGV4KChzKSA9PiBzLmlkID09PSBpZCkpO1xuZXhwb3J0IGNvbnN0IHN0YWdlQnlJZCA9IChpZDogc3RyaW5nKTogU3RhZ2VEZWYgPT4gU1RBR0VTW3N0YWdlSW5kZXgoaWQpXTtcblxuLyoqIE5hbWVzIGFuZCBvbmUtbGluZSBwcm9taXNlcyBmb3IgdGhlIGRpZmZpY3VsdHkgcGlja2VyLiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFlfSU5GTyA9IFtcbiAgeyBpZDogJ2Vhc3knLCBsYWJlbDogJ0Vhc3knLCBibHVyYjogJ1NtYWxsZXIgZW5lbXkgYXJtaWVzLiBSZWxheCBhbmQgbGVhcm4gaG93IG1lcmdpbmcgd29ya3MuJyB9LFxuICB7IGlkOiAnbm9ybWFsJywgbGFiZWw6ICdOb3JtYWwnLCBibHVyYjogJ1RoZSBzdGFuZGFyZCBmaWdodC4gQ2xlYXJpbmcgaXQgdW5sb2NrcyBIYXJkIGFuZCB0aGUgbmV4dCBzdGFnZS4nIH0sXG4gIHsgaWQ6ICdoYXJkJywgbGFiZWw6ICdIYXJkJywgYmx1cmI6ICdCaWdnZXIgYXJtaWVzIHdpdGggbW9yZSBmb2RkZXIuIEJldHRlciBmaXJzdC1jbGVhciByZXdhcmRzLiBDbGVhcmluZyBpdCB1bmxvY2tzIE5pZ2h0bWFyZS4nIH0sXG4gIHsgaWQ6ICduaWdodG1hcmUnLCBsYWJlbDogJ05pZ2h0bWFyZScsIGJsdXJiOiAnQSBwYWNrZWQgYmF0dGxlZmllbGQgb2Ygc3RhcnMgYW5kIHNraWxscy4gQnVpbHQgZm9yIHdlbGwtbGV2ZWxsZWQgU291bHMuJyB9LFxuXTtcblxuLy8gLS0tLSB3aGF0IHRoZSBuZXh0IGJhdHRsZSB1c2VzIChzZXQgd2hlbiBhIHJ1biBzdGFydHMpXG5leHBvcnQgbGV0IGRpZmZpY3VsdHlOYW1lOiBzdHJpbmcgPSAnbm9ybWFsJztcbmV4cG9ydCBsZXQgY3VycmVudFN0YWdlSWQ6IHN0cmluZyA9ICdjcnlwdCc7XG5sZXQgcG93ZXIgPSAxLCBlbmRsZXNzTW9kZSA9IGZhbHNlO1xuLyoqIEVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGN1cnJlbnQgc3RhZ2UgYW5kIHRpZXIgKGluIGVuZGxlc3MgbW9kZSBpdCBkZXBlbmRzIG9uIHRoZSB3YXZlKS4gKi9cbmV4cG9ydCBjb25zdCBlbmVteVBvd2VyID0gKHdhdmUgPSAxKTogbnVtYmVyID0+IChlbmRsZXNzTW9kZSA/IGVuZGxlc3NQb3dlcih3YXZlKSA6IHBvd2VyKTtcbmV4cG9ydCBjb25zdCBpc0VuZGxlc3MgPSAoKTogYm9vbGVhbiA9PiBlbmRsZXNzTW9kZTtcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyICgxMCB3YXZlcykuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXRTdGFnZURpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFN0YWdlRGlmZmljdWx0eShzdGFnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBzdGFnZUJ5SWQoc3RhZ2UpOyBpZiAoIURJRkZTLmluY2x1ZGVzKG5hbWUgYXMgRGlmZikpIHJldHVybjtcbiAgZW5kbGVzc01vZGUgPSBmYWxzZTsgY3VycmVudFN0YWdlSWQgPSBzdC5pZDsgZGlmZmljdWx0eU5hbWUgPSBuYW1lOyBwb3dlciA9IHN0LnBvd2VyW25hbWUgYXMgRGlmZl07XG4gIEFVVEhPUkVELmxlbmd0aCA9IDA7IHN0Lmxpc3RzW25hbWUgYXMgRGlmZl0uZm9yRWFjaCgodykgPT4gQVVUSE9SRUQucHVzaChwYXJzZVdhdmUodykpKTtcbn1cbi8qKiBTd2l0Y2ggdG8gRW5kbGVzcyBEZXB0aHM6IHdhdmVzIGNvbWUgZnJvbSBjb3JlL2VuZGxlc3MudHMgaW5zdGVhZCBvZiBhIHN0YWdlIGxpc3QuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0RW5kbGVzcygpOiB2b2lkIHsgZW5kbGVzc01vZGUgPSB0cnVlOyBjdXJyZW50U3RhZ2VJZCA9IEVORExFU1NfSUQ7IGRpZmZpY3VsdHlOYW1lID0gJ2VuZGxlc3MnOyBwb3dlciA9IDE7IEFVVEhPUkVELmxlbmd0aCA9IDA7IH1cbi8qKiBDaGFuZ2UgdGhlIHRpZXIgd2l0aGluIHRoZSBjdXJyZW50IHN0YWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldERpZmZpY3VsdHkobmFtZTogc3RyaW5nKTogdm9pZCB7IHNldFN0YWdlRGlmZmljdWx0eShjdXJyZW50U3RhZ2VJZCwgbmFtZSk7IH1cblxuZXhwb3J0IGNvbnN0IHdhdmVDb3N0ID0gKHc6IEVuZW15U3BlY1tdKTogbnVtYmVyID0+IHcucmVkdWNlKChuLCBlKSA9PiBuICsgQ09TVFtlLnNvdWxdW2Uuc3RhciAtIDFdLCAwKTtcblxuLyoqIEVuZW15IGFybXkgZm9yIGEgd2F2ZSAoMS1iYXNlZCkuIFdhdmVzIHBhc3QgdGhlIGF1dGhvcmVkIG9uZXMgYXJlIGdlbmVyYXRlZCBmcm9tIGEgZml4ZWQgc2VlZCBzbyByZXRyaWVzIGZhY2UgdGhlIHNhbWUgYXJteS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteVdhdmUod2F2ZTogbnVtYmVyLCBzdGFnZVNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBpZiAoZW5kbGVzc01vZGUpIHJldHVybiBlbmRsZXNzV2F2ZSh3YXZlLCBzdGFnZVNlZWQpO1xuICBpZiAod2F2ZSA8PSBBVVRIT1JFRC5sZW5ndGgpIHJldHVybiBBVVRIT1JFRFt3YXZlIC0gMV0ubWFwKChlKSA9PiAoeyAuLi5lIH0pKTtcbiAgY29uc3QgY2FwID0gQ1VSVkVTLmRvY1tNYXRoLm1pbih3YXZlLCBDVVJWRVMuZG9jLmxlbmd0aCkgLSAxXTtcbiAgY29uc3QgYnVkZ2V0ID0gTWF0aC5yb3VuZChjYXAgKiAwLjkyKTtcbiAgY29uc3Qgcm5nID0gbWFrZVJuZyhzdGFnZVNlZWQgKiAxMDA5ICsgd2F2ZSAqIDc5MTkpO1xuICBjb25zdCBhcm15OiBFbmVteVNwZWNbXSA9IFtdO1xuICBsZXQgbGVmdCA9IGJ1ZGdldDtcbiAgZm9yIChsZXQgZ3VhcmQgPSAwOyBndWFyZCA8IDQwICYmIGxlZnQgPj0gMjsgZ3VhcmQrKykge1xuICAgIGNvbnN0IHNvdWwgPSBybmcucGljayhTT1VMUyk7XG4gICAgbGV0IHN0YXIgPSAxO1xuICAgIGlmIChybmcubmV4dCgpIDwgMC4zNSAmJiBDT1NUW3NvdWxdWzFdIDw9IGxlZnQpIHN0YXIgPSAyO1xuICAgIGlmICh3YXZlID49IDYgJiYgcm5nLm5leHQoKSA8IDAuMjUgJiYgQ09TVFtzb3VsXVsyXSA8PSBsZWZ0KSBzdGFyID0gMztcbiAgICBjb25zdCBjID0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gICAgaWYgKGMgPD0gbGVmdCAmJiBhcm15Lmxlbmd0aCA8IDEyKSB7IGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gYzsgfVxuICB9XG4gIHJldHVybiBhcm15O1xufVxuXG4vKiogV2hhdCB0aGUgYnVpbGQgc2NyZWVuIHNob3dzOiBjb3VudHMgcGVyIFNvdWwgYW5kIHN0YXIsIG5vIHBvc2l0aW9ucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmV2aWV3VGV4dCh3OiBFbmVteVNwZWNbXSk6IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfVtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfT4oKTtcbiAgZm9yIChjb25zdCBlIG9mIHcpIHtcbiAgICBjb25zdCBrID0gZS5zb3VsICsgZS5zdGFyO1xuICAgIGNvbnN0IGN1ciA9IG1hcC5nZXQoayk7XG4gICAgaWYgKGN1cikgY3VyLmNvdW50Kys7IGVsc2UgbWFwLnNldChrLCB7IHNvdWw6IGUuc291bCwgc3RhcjogZS5zdGFyLCBjb3VudDogMSB9KTtcbiAgfVxuICByZXR1cm4gWy4uLm1hcC52YWx1ZXMoKV07XG59XG4iLCAiaW1wb3J0IHsgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuXG4vKipcbiAqIFJ1bGVzIGZvciB0aGUgcGxheWFibGUgU3RhZ2UgMSAoMTAgd2F2ZXMpOiBkb2MgRG9taW5pb24gY3VydmUsIGJvbnVzIGRyYXcgb25seSBvbiB0aGUgZWFybHkgd2F2ZXMuXG4gKiBtZXJnZSAnaGFuZEludG9PbmVTdGFyJzogYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBtZXJnZSBzdHJhaWdodCBpbnRvIGEgbWF0Y2hpbmcgZGVwbG95ZWQgMS1zdGFyIHVuaXQgKHBheWluZyBvbmx5IHRoZSBjb3N0XG4gKiBkaWZmZXJlbmNlKS4gV2l0aG91dCBpdCB0aGUgY2FwIGNhbiBibG9jayBhIG1lcmdlIHlvdSBjb3VsZCBhZmZvcmQgKHlvdSB3b3VsZCBuZWVkIHJvb20gdG8gc3VtbW9uIEJPVEggY29waWVzIGZpcnN0KS5cbiAqIFRoZSBkZWJ1ZyBwYW5lbCBjYW4gc3dpdGNoIHRoaXMgYmFjayB0byB0aGUgZG9jJ3MgZGVwbG95ZWQtb25seSBydWxlLlxuICovXG5leHBvcnQgY29uc3QgUFJPVE9UWVBFX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IENVUlZFUy5kb2MsIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogMTAsIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG5cbi8qKlxuICogRW5kbGVzcyBEZXB0aHM6IHRoZSBjYW1wYWlnbidzIERvbWluaW9uIGN1cnZlIGZvciB3YXZlcyAxLTEwLCB0aGVuIGhlbGQgYXQgNDAgKHRoZSBwbGF5ZXIncyBhcm15IGlzIGNhcHBlZCBvbiBwdXJwb3NlOyB0aGUgZW5lbXkga2VlcHMgZ3Jvd2luZywgc2VlIGVuZGxlc3MudHMpLlxuICogVGhlIGN1cnZlIGlzIGxvbmcgZW5vdWdoIHRoYXQgYSBydW4gZW5kcyBieSBsb3NpbmcgaGVhcnRzLCBuZXZlciBieSBcImNsZWFyaW5nXCIgdGhlIHN0YWdlIChjb3JlL3J1bGVzLnRzIHJlYWRzIGN1cnZlW3dhdmUtMV0pLlxuICovXG5jb25zdCBFTkRMRVNTX0xFTiA9IDMwMDtcbmV4cG9ydCBjb25zdCBFTkRMRVNTX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IEFycmF5LmZyb20oeyBsZW5ndGg6IEVORExFU1NfTEVOIH0sIChfLCBpKSA9PiBDVVJWRVMuZG9jW01hdGgubWluKGksIENVUlZFUy5kb2MubGVuZ3RoIC0gMSldKSwgbWVyZ2U6ICdoYW5kSW50b09uZVN0YXInLCBzdGFnZVdhdmVzOiBFTkRMRVNTX0xFTiwgbm9ybWFsRHJhd1dhdmVzOiBbMiwgMywgNCwgNV0gfTtcbiIsICIvLyBTb3VsIFBhY2tzIChwbGFuIGRvYyBzZWN0aW9uIDE3KS4gUHVyZSBydWxlcywgbm8gZ3JhcGhpY3MuIEFMTCBOVU1CRVJTIEFSRSBQTEFDRUhPTERFUiBMRVZFUlM6IHdlIHNldHRsZWQgdGhlIHN0cnVjdHVyZSBmaXJzdCBhbmQgd2lsbCB0dW5lXG4vLyBxdWFudGl0aWVzIHdpdGggdGhlIHByb2dyZXNzaW9uIHNpbXVsYXRpb24gKHNpbS9wcm9ncmVzc2lvbi50cykgb25jZSB0aGUgbG9vcCBjYW4gYmUgcGxheWVkLlxuLy9cbi8vICAgU291bCByYXJpdHkgIC0+IGhvdyBvZnRlbiBhIFNvdWwgc2hvd3MgdXAgYW5kIGhvdyBiaWcgaXRzIHN0YWNrIG9mIGNvcGllcyB0ZW5kcyB0byBiZS5cbi8vICAgUGFjayB0aWVyICAgIC0+IHRoZSBwYWNrJ3Mgb3ZlcmFsbCB2YWx1ZSAoc2t1bGxzLCAxLTMgZm9yIG5vdyk6IG51bWJlciBvZiByZXZlYWxzICsgaG93IGdvb2QgdGhlIHJhcml0eSBvZGRzIGFyZS5cbi8vICAgQSBwYWNrIGhhcyBhIFNUQVJUSU5HIHRpZXIgYW5kIG1heSB1cGdyYWRlIHdoaWxlIGl0IGlzIGJlaW5nIG9wZW5lZDsgdGhlIHJlc3VsdCBpcyBkZWNpZGVkIHVwIGZyb250LCB0aGUgYW5pbWF0aW9uIG9ubHkgc2hvd3MgaXQuXG5cbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgdHlwZSBSYXJpdHkgPSAnY29tbW9uJyB8ICdyYXJlJyB8ICdlcGljJyB8ICdsZWdlbmRhcnknO1xuZXhwb3J0IGNvbnN0IFJBUklUSUVTOiBSYXJpdHlbXSA9IFsnY29tbW9uJywgJ3JhcmUnLCAnZXBpYycsICdsZWdlbmRhcnknXTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfTkFNRTogUmVjb3JkPFJhcml0eSwgc3RyaW5nPiA9IHsgY29tbW9uOiAnQ29tbW9uJywgcmFyZTogJ1JhcmUnLCBlcGljOiAnRXBpYycsIGxlZ2VuZGFyeTogJ0xlZ2VuZGFyeScgfTtcblxuLyoqIFJhcml0eSBwZXIgU291bC4gUExBQ0VIT0xERVIgYXNzaWdubWVudCAobm8gTGVnZW5kYXJ5IFNvdWwgZXhpc3RzIHlldCkuICovXG5leHBvcnQgY29uc3QgUkFSSVRZX09GOiBSZWNvcmQ8U291bElkLCBSYXJpdHk+ID0geyB3YXJyaW9yOiAnY29tbW9uJywgZ29ibGluOiAnY29tbW9uJywgYXJjaGVyOiAncmFyZScsIGtuaWdodDogJ3JhcmUnLCBvZ3JlOiAnZXBpYycsIGJhcmJhcmlhbjogJ2VwaWMnIH07XG5cbi8qKiBSYXJlciBTb3VscyB0dXJuIHVwIGluIHNtYWxsZXIgc3RhY2tzLCBzbyB0aGV5IG5lZWQgZmV3ZXIgY29waWVzIHBlciBsZXZlbCAobXVsdGlwbGllciBvbiB0aGUgbGV2ZWwgY29zdHMpLiBQTEFDRUhPTERFUi4gKi9cbmV4cG9ydCBjb25zdCBMRVZFTF9DT1NUX01VTFQ6IFJlY29yZDxSYXJpdHksIG51bWJlcj4gPSB7IGNvbW1vbjogMSwgcmFyZTogMC42LCBlcGljOiAwLjM1LCBsZWdlbmRhcnk6IDAuMiB9O1xuXG5leHBvcnQgY29uc3QgUEFDS19USUVSUyA9IDM7XG5leHBvcnQgY29uc3QgUEFDSyA9IHtcbiAgcmV2ZWFsczogWzMsIDQsIDVdLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2VwYXJhdGUgcmV2ZWFscyBwZXIgdGllciAoaW5kZXggMCA9IHRpZXIgMSlcbiAgc3RhY2tNdWx0OiBbMSwgMS41LCAyXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29weSBzdGFja3MgYXJlIGJpZ2dlciBpbiBiZXR0ZXIgcGFja3NcbiAgLyoqIFJhcml0eSBvZGRzIHBlciB0aWVyLCBpbiBwZXJjZW50LiAqL1xuICBvZGRzOiBbXG4gICAgeyBjb21tb246IDcwLCByYXJlOiAyNSwgZXBpYzogNSwgbGVnZW5kYXJ5OiAwIH0sXG4gICAgeyBjb21tb246IDU1LCByYXJlOiAzMywgZXBpYzogMTEsIGxlZ2VuZGFyeTogMSB9LFxuICAgIHsgY29tbW9uOiA0MCwgcmFyZTogMzgsIGVwaWM6IDE5LCBsZWdlbmRhcnk6IDMgfSxcbiAgXSBhcyBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+W10sXG4gIC8qKiBDb3BpZXMgaW4gb25lIHJldmVhbCBiZWZvcmUgdGhlIHRpZXIgbXVsdGlwbGllcjogW21pbiwgbWF4XS4gKi9cbiAgc3RhY2s6IHsgY29tbW9uOiBbNiwgMTBdLCByYXJlOiBbMywgNV0sIGVwaWM6IFsxLCAzXSwgbGVnZW5kYXJ5OiBbMSwgMV0gfSBhcyBSZWNvcmQ8UmFyaXR5LCBbbnVtYmVyLCBudW1iZXJdPixcbiAgLyoqIENoYW5jZSB0byBqdW1wIHVwIG9uZSB0aWVyIGR1cmluZyB0aGUgb3BlbmluZywgZnJvbSB0aWVyIDEgYW5kIGZyb20gdGllciAyIChhIGx1Y2t5IHBhY2sgY2FuIGp1bXAgdHdpY2UpLiAqL1xuICB1cGdyYWRlQ2hhbmNlOiBbMC4yLCAwLjEyXSxcbn07XG5cbi8qKiBBbiB1bm9wZW5lZCBwYWNrIHRoZSBwbGF5ZXIgb3ducy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFja0l0ZW0geyBpZDogbnVtYmVyOyB0aWVyOiBudW1iZXI7IHNvdXJjZTogc3RyaW5nIH1cbmV4cG9ydCBpbnRlcmZhY2UgUmV2ZWFsIHsgc291bDogU291bElkOyByYXJpdHk6IFJhcml0eTsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBQYWNrUmVzdWx0IHsgc3RhcnRUaWVyOiBudW1iZXI7IGZpbmFsVGllcjogbnVtYmVyOyB1cGdyYWRlczogbnVtYmVyW107IHJldmVhbHM6IFJldmVhbFtdIH1cblxuY29uc3QgcmFyaXR5UmFuayA9IChyOiBSYXJpdHkpID0+IFJBUklUSUVTLmluZGV4T2Yocik7XG5cbmZ1bmN0aW9uIHJvbGxSYXJpdHkodGllcjogbnVtYmVyLCBybmc6IFJuZyk6IFJhcml0eSB7XG4gIGNvbnN0IG9kZHMgPSBQQUNLLm9kZHNbdGllciAtIDFdOyBsZXQgcm9sbCA9IHJuZy5uZXh0KCkgKiBSQVJJVElFUy5yZWR1Y2UoKG4sIHIpID0+IG4gKyBvZGRzW3JdLCAwKTtcbiAgZm9yIChjb25zdCByIG9mIFJBUklUSUVTKSB7IGlmIChyb2xsIDwgb2Rkc1tyXSkgcmV0dXJuIHI7IHJvbGwgLT0gb2Rkc1tyXTsgfVxuICByZXR1cm4gJ2NvbW1vbic7XG59XG5cbi8qKiBBIHJhbmRvbSBTb3VsIG9mIHRoaXMgcmFyaXR5OyBpZiB0aGUgcm9zdGVyIGhhcyBub25lIG9mIHRoYXQgcmFyaXR5IHlldCwgdGhlIG5leHQgbG93ZXIgb25lIGlzIHVzZWQuICovXG5mdW5jdGlvbiBzb3VsT2ZSYXJpdHkocmFyaXR5OiBSYXJpdHksIHJuZzogUm5nKTogU291bElkIHtcbiAgZm9yIChsZXQgaSA9IHJhcml0eVJhbmsocmFyaXR5KTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgcG9vbCA9IFNPVUxTLmZpbHRlcigocykgPT4gUkFSSVRZX09GW3NdID09PSBSQVJJVElFU1tpXSk7IGlmIChwb29sLmxlbmd0aCkgcmV0dXJuIHJuZy5waWNrKHBvb2wpOyB9XG4gIHJldHVybiBybmcucGljayhTT1VMUyk7XG59XG5cbi8qKiBPcGVuIGEgcGFjazogcm9sbCB1cGdyYWRlcyBmaXJzdCAoc28gdGhlIGFuaW1hdGlvbiBjYW4gcGxheSB0aGVtIGJlZm9yZSB0aGUgcGFjayB0ZWFycyBvcGVuKSwgdGhlbiB0aGUgcmV2ZWFscy4gQmVzdCByZXZlYWwgY29tZXMgbGFzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuUGFjayhzdGFydFRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBQYWNrUmVzdWx0IHtcbiAgY29uc3QgdDAgPSBNYXRoLm1heCgxLCBNYXRoLm1pbihQQUNLX1RJRVJTLCBNYXRoLmZsb29yKHN0YXJ0VGllcikpKSwgdXBncmFkZXM6IG51bWJlcltdID0gW107XG4gIGxldCB0aWVyID0gdDA7XG4gIHdoaWxlICh0aWVyIDwgUEFDS19USUVSUyAmJiBybmcubmV4dCgpIDwgUEFDSy51cGdyYWRlQ2hhbmNlW3RpZXIgLSAxXSkgeyB0aWVyKys7IHVwZ3JhZGVzLnB1c2godGllcik7IH1cbiAgY29uc3QgcmV2ZWFsczogUmV2ZWFsW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBQQUNLLnJldmVhbHNbdGllciAtIDFdOyBpKyspIHtcbiAgICBjb25zdCByYXJpdHkgPSByb2xsUmFyaXR5KHRpZXIsIHJuZyksIHNvdWwgPSBzb3VsT2ZSYXJpdHkocmFyaXR5LCBybmcpLCBbbG8sIGhpXSA9IFBBQ0suc3RhY2tbUkFSSVRZX09GW3NvdWxdXTtcbiAgICByZXZlYWxzLnB1c2goeyBzb3VsLCByYXJpdHk6IFJBUklUWV9PRltzb3VsXSwgY29waWVzOiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKChsbyArIHJuZy5pbnQoaGkgLSBsbyArIDEpKSAqIFBBQ0suc3RhY2tNdWx0W3RpZXIgLSAxXSkpIH0pO1xuICB9XG4gIHJldmVhbHMuc29ydCgoYSwgYikgPT4gcmFyaXR5UmFuayhhLnJhcml0eSkgLSByYXJpdHlSYW5rKGIucmFyaXR5KSB8fCBhLmNvcGllcyAtIGIuY29waWVzKTtcbiAgcmV0dXJuIHsgc3RhcnRUaWVyOiB0MCwgZmluYWxUaWVyOiB0aWVyLCB1cGdyYWRlcywgcmV2ZWFscyB9O1xufVxuXG4vKiogVG90YWwgY29waWVzIHBlciBTb3VsIGluIGEgcmVzdWx0ICh0aGUgc2FtZSBTb3VsIGNhbiBiZSByZXZlYWxlZCBtb3JlIHRoYW4gb25jZSkuICovXG5leHBvcnQgZnVuY3Rpb24gY29waWVzQnlTb3VsKHJlc3VsdDogUGFja1Jlc3VsdCk6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4ge1xuICBjb25zdCBvdXQ6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4gPSB7fTtcbiAgZm9yIChjb25zdCByIG9mIHJlc3VsdC5yZXZlYWxzKSBvdXRbci5zb3VsXSA9IChvdXRbci5zb3VsXSA/PyAwKSArIHIuY29waWVzO1xuICByZXR1cm4gb3V0O1xufVxuIiwgIi8vIFRoZSBwbGF5ZXIncyBzYXZlZCBwcm9ncmVzcy4gRnJhbWV3b3JrLWZyZWUgc28gdGhlIGdhbWUgYnVuZGxlIGFuZCB0aGUgbmF2aWdhdGlvbiBzaGVsbCBib3RoIHVzZSBpdC5cbi8vIFN0b3JlZCBpbiBsb2NhbFN0b3JhZ2UgYXMgSlNPTi4gRXZlcnkgcmVhZC93cml0ZSBpcyBndWFyZGVkOiBwcml2YXRlIHdpbmRvd3MgYW5kIGJsb2NrZWQgc3RvcmFnZSBtdXN0IG5ldmVyIGJyZWFrIHRoZSBnYW1lLlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBQQUNLX1RJRVJTIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5cbmV4cG9ydCBjb25zdCBERUNLX1NJWkUgPSA2OyAgICAgICAgICAgICAgICAgICAgIC8vIGRvYzogc2l4IGVxdWlwcGVkIFNvdWxzIHBlciBzdGFnZVxuY29uc3QgS0VZID0gJ25lY3JvLXNhdmUnO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCB0eXBlIERpZmZpY3VsdHkgPSAnZWFzeScgfCAnbm9ybWFsJyB8ICdoYXJkJyB8ICduaWdodG1hcmUnO1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVElFUzogRGlmZmljdWx0eVtdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuZXhwb3J0IGludGVyZmFjZSBTZXR0aW5ncyB7IG11c2ljOiBib29sZWFuOyBzZng6IGJvb2xlYW4gfVxuZXhwb3J0IGludGVyZmFjZSBTb3VsUHJvZ3Jlc3MgeyBsZXZlbDogbnVtYmVyOyBjb3BpZXM6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNhdmUge1xuICB2OiBudW1iZXI7XG4gIGRlY2s6IFNvdWxJZFtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBlcXVpcHBlZCBTb3VscywgYXQgbW9zdCBERUNLX1NJWkUsIGF0IGxlYXN0IDFcbiAgc291bHM6IFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47ICAgICAgICAgIC8vIFBMQUNFSE9MREVSIHByb2dyZXNzaW9uIHVudGlsIHBhY2tzIGV4aXN0XG4gIHNldHRpbmdzOiBTZXR0aW5nczsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzb3VuZCBzd2l0Y2hlczsgYm90aCBvbiBieSBkZWZhdWx0XG4gIGRpZmZpY3VsdHk6IERpZmZpY3VsdHk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBjaG9zZW4gb24gSG9tZTsgYXBwbGllcyB0byB0aGUgbmV4dCBydW5cbiAgc3RhZ2U6IHN0cmluZzsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBzdGFnZSBwaWNrZWQgb24gSG9tZSAoaWQgZnJvbSB3YXZlcy50cyBTVEFHRVMpXG4gIHNlZW46IHN0cmluZ1tdIHwgbnVsbDsgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bmxvY2sga2V5cyB3aG9zZSBjZWxlYnJhdGlvbiB3YXMgYWxyZWFkeSBzaG93biAobnVsbDogb2xkZXIgc2F2ZSwgc2VlZGVkIG9uIGZpcnN0IGxvb2spXG4gIHBhY2tzOiBQYWNrSXRlbVtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bm9wZW5lZCBTb3VsIFBhY2tzXG4gIG5leHRQYWNrSWQ6IG51bWJlcjtcbiAgY2xlYXJzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+OyAgICAgICAgICAgICAgIC8vIHN0YWdlIGNsZWFycywga2V5ZWQgJ3N0YWdlOmRpZmZpY3VsdHknXG4gIHJlcGxheU1ldGVyOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXBsYXkgY2xlYXJzIHRvd2FyZCB0aGUgbmV4dCByZXBsYXkgcGFja1xuICBlbmRsZXNzOiB7IGJlc3Q6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgLy8gRW5kbGVzcyBEZXB0aHM6IHRoZSBkZWVwZXN0IHdhdmUgY2xlYXJlZFxufVxuZXhwb3J0IGludGVyZmFjZSBTdG9yZSB7IGdldEl0ZW0oazogc3RyaW5nKTogc3RyaW5nIHwgbnVsbDsgc2V0SXRlbShrOiBzdHJpbmcsIHY6IHN0cmluZyk6IHZvaWQgfVxuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFNhdmUoKTogU2F2ZSB7XG4gIGNvbnN0IHNvdWxzID0ge30gYXMgUmVjb3JkPFNvdWxJZCwgU291bFByb2dyZXNzPjtcbiAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykgc291bHNbaWRdID0geyBsZXZlbDogMSwgY29waWVzOiAwIH07XG4gIHJldHVybiB7IHY6IFZFUlNJT04sIGRlY2s6IFNPVUxTLnNsaWNlKDAsIERFQ0tfU0laRSksIHNvdWxzLCBzZXR0aW5nczogeyBtdXNpYzogdHJ1ZSwgc2Z4OiB0cnVlIH0sIGRpZmZpY3VsdHk6ICdub3JtYWwnLCBzdGFnZTogJ2NyeXB0Jywgc2VlbjogW10sIHBhY2tzOiBbXSwgbmV4dFBhY2tJZDogMSwgY2xlYXJzOiB7fSwgcmVwbGF5TWV0ZXI6IDAsIGVuZGxlc3M6IHsgYmVzdDogMCB9IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicm93c2VyU3RvcmUoKTogU3RvcmUgfCBudWxsIHsgdHJ5IHsgcmV0dXJuIHR5cGVvZiBsb2NhbFN0b3JhZ2UgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGxvY2FsU3RvcmFnZTsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9IH1cblxuLyoqIFJlcGFpciB3aGF0ZXZlciB3YXMgc3RvcmVkOiB1bmtub3duIFNvdWxzIGRyb3BwZWQsIGR1cGxpY2F0ZXMgcmVtb3ZlZCwgZGVjayBjYXBwZWQsIG5vdGhpbmcgZW1wdHkuIE9sZCB2ZXJzaW9ucyBrZWVwIHRoZWlyIHByb2dyZXNzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplKHJhdzogYW55KTogU2F2ZSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0U2F2ZSgpO1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IGRlY2s6IFNvdWxJZFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5kZWNrKSkgZm9yIChjb25zdCBkIG9mIHJhdy5kZWNrKSBpZiAoU09VTFMuaW5jbHVkZXMoZCkgJiYgIWRlY2suaW5jbHVkZXMoZCkgJiYgZGVjay5sZW5ndGggPCBERUNLX1NJWkUpIGRlY2sucHVzaChkKTtcbiAgaWYgKGRlY2subGVuZ3RoKSBiYXNlLmRlY2sgPSBkZWNrO1xuICBpZiAocmF3LnNvdWxzICYmIHR5cGVvZiByYXcuc291bHMgPT09ICdvYmplY3QnKSB7XG4gICAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykge1xuICAgICAgY29uc3QgcCA9IHJhdy5zb3Vsc1tpZF07XG4gICAgICBpZiAocCAmJiBOdW1iZXIuaXNGaW5pdGUocC5sZXZlbCkgJiYgTnVtYmVyLmlzRmluaXRlKHAuY29waWVzKSkgYmFzZS5zb3Vsc1tpZF0gPSB7IGxldmVsOiBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHAubGV2ZWwpKSwgY29waWVzOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHAuY29waWVzKSkgfTtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5zZXR0aW5ncyAmJiB0eXBlb2YgcmF3LnNldHRpbmdzID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLm11c2ljID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3MubXVzaWMgPSByYXcuc2V0dGluZ3MubXVzaWM7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3Muc2Z4ID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3Muc2Z4ID0gcmF3LnNldHRpbmdzLnNmeDtcbiAgfVxuICBpZiAoRElGRklDVUxUSUVTLmluY2x1ZGVzKHJhdy5kaWZmaWN1bHR5KSkgYmFzZS5kaWZmaWN1bHR5ID0gcmF3LmRpZmZpY3VsdHk7XG4gIGlmICh0eXBlb2YgcmF3LnN0YWdlID09PSAnc3RyaW5nJyAmJiAvXlthLXowLTlfLV17MSwyNH0kLy50ZXN0KHJhdy5zdGFnZSkpIGJhc2Uuc3RhZ2UgPSByYXcuc3RhZ2U7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5zZWVuKSkgYmFzZS5zZWVuID0gcmF3LnNlZW4uZmlsdGVyKChrOiBhbnkpID0+IHR5cGVvZiBrID09PSAnc3RyaW5nJyAmJiBrLmxlbmd0aCA8IDQwKS5zbGljZSgtODApO1xuICBlbHNlIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyhyYXcuY2xlYXJzKS5sZW5ndGgpIGJhc2Uuc2VlbiA9IG51bGw7ICAgIC8vIGFuIGV4aXN0aW5nIHBsYXllcjogZG8gbm90IHJlcGxheSBvbGQgdW5sb2Nrc1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcucGFja3MpKSB7XG4gICAgY29uc3QgaWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHJhdy5wYWNrcykge1xuICAgICAgaWYgKGJhc2UucGFja3MubGVuZ3RoID49IDk5IHx8ICFwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHAuaWQpIHx8IHAuaWQgPCAxIHx8IGlkcy5oYXMocC5pZCkgfHwgIU51bWJlci5pc0ludGVnZXIocC50aWVyKSB8fCBwLnRpZXIgPCAxIHx8IHAudGllciA+IFBBQ0tfVElFUlMpIGNvbnRpbnVlO1xuICAgICAgaWRzLmFkZChwLmlkKTsgYmFzZS5wYWNrcy5wdXNoKHsgaWQ6IHAuaWQsIHRpZXI6IHAudGllciwgc291cmNlOiB0eXBlb2YgcC5zb3VyY2UgPT09ICdzdHJpbmcnID8gcC5zb3VyY2Uuc2xpY2UoMCwgNDApIDogJycgfSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IG1heElkID0gYmFzZS5wYWNrcy5yZWR1Y2UoKG4sIHApID0+IE1hdGgubWF4KG4sIHAuaWQpLCAwKTtcbiAgYmFzZS5uZXh0UGFja0lkID0gTWF0aC5tYXgobWF4SWQgKyAxLCBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5uZXh0UGFja0lkKSAmJiByYXcubmV4dFBhY2tJZCA+IDAgPyByYXcubmV4dFBhY2tJZCA6IDEpO1xuICBpZiAocmF3LmNsZWFycyAmJiB0eXBlb2YgcmF3LmNsZWFycyA9PT0gJ29iamVjdCcpIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHJhdy5jbGVhcnMpKSBpZiAodHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDAgJiYgTnVtYmVyLmlzSW50ZWdlcih2KSAmJiAodiBhcyBudW1iZXIpID4gMCkgYmFzZS5jbGVhcnNba10gPSB2IGFzIG51bWJlcjtcbiAgaWYgKE51bWJlci5pc0ludGVnZXIocmF3LnJlcGxheU1ldGVyKSAmJiByYXcucmVwbGF5TWV0ZXIgPj0gMCAmJiByYXcucmVwbGF5TWV0ZXIgPCA1MCkgYmFzZS5yZXBsYXlNZXRlciA9IHJhdy5yZXBsYXlNZXRlcjtcbiAgaWYgKHJhdy5lbmRsZXNzICYmIE51bWJlci5pc0ludGVnZXIocmF3LmVuZGxlc3MuYmVzdCkgJiYgcmF3LmVuZGxlc3MuYmVzdCA+PSAwICYmIHJhdy5lbmRsZXNzLmJlc3QgPD0gOTk5OSkgYmFzZS5lbmRsZXNzLmJlc3QgPSByYXcuZW5kbGVzcy5iZXN0O1xuICByZXR1cm4gYmFzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRTYXZlKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IFNhdmUge1xuICB0cnkgeyBjb25zdCB0ID0gc3RvcmUgJiYgc3RvcmUuZ2V0SXRlbShLRVkpOyByZXR1cm4gc2FuaXRpemUodCA/IEpTT04ucGFyc2UodCkgOiBudWxsKTsgfSBjYXRjaCB7IHJldHVybiBkZWZhdWx0U2F2ZSgpOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZVNhdmUoc2F2ZTogU2F2ZSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogdm9pZCB7XG4gIHRyeSB7IGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksIEpTT04uc3RyaW5naWZ5KHNhdmUpKTsgfSBjYXRjaCB7IC8qIHN0b3JhZ2UgZnVsbCBvciBibG9ja2VkOiBrZWVwIHBsYXlpbmcgKi8gfVxufVxuXG4vKiogQ2hhbmdlIHNvdW5kIHNldHRpbmdzIHdpdGhvdXQgdG91Y2hpbmcgdGhlIHJlc3Qgb2YgdGhlIHNhdmUuICovXG5leHBvcnQgZnVuY3Rpb24gdXBkYXRlU2V0dGluZ3MocGF0Y2g6IFBhcnRpYWw8U2V0dGluZ3M+LCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTZXR0aW5ncyB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuc2V0dGluZ3MgPSB7IC4uLnMuc2V0dGluZ3MsIC4uLnBhdGNoIH07IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLnNldHRpbmdzO1xufVxuXG4vKiogUmVtZW1iZXIgdGhlIGNob3NlbiBkaWZmaWN1bHR5IHdpdGhvdXQgdG91Y2hpbmcgdGhlIHJlc3Qgb2YgdGhlIHNhdmUuICovXG5leHBvcnQgZnVuY3Rpb24gdXBkYXRlRGlmZmljdWx0eShkOiBEaWZmaWN1bHR5LCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBEaWZmaWN1bHR5IHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgcy5kaWZmaWN1bHR5ID0gRElGRklDVUxUSUVTLmluY2x1ZGVzKGQpID8gZCA6IHMuZGlmZmljdWx0eTsgd3JpdGVTYXZlKHMsIHN0b3JlKTsgcmV0dXJuIHMuZGlmZmljdWx0eTtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3MgY2hhcmFjdGVyOiB0aGUgTmVjcm9tYW5jZXIuIEEgcHJvY2VkdXJhbCBwbGFjZWhvbGRlciAobm8gVHJpcG8gbW9kZWwgeWV0KTogaG9vZGVkIHJvYmUsIGdsb3dpbmcgcHVycGxlIGV5ZXMsIGNyeXN0YWwgc3RhZmYuXG4vLyBIZSBzdGFuZHMgYmVzaWRlIHRoZSBncmlkLCB0YWtlcyB0aGUgaGl0IHdoZW4gYW4gYXJteSBpcyB3aXBlZCAoaGVhcnRzIGFyZSBISVMgaGVhbHRoKSwgdW5sZWFzaGVzIHRoZSByZXB1bHNpb24gc2hvY2t3YXZlIGFuZCByYWlzZXNcbi8vIHRoZSBmYWxsZW4uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBhbmltYXRpb24gb25seTsgdGhlIHJ1bGVzIGxpdmUgaW4gY29yZS9ydWxlcy50cy5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuXG5leHBvcnQgY2xhc3MgTmVjcm9tYW5jZXIge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb247IGxvY2FsICtaIGlzIGhpcyBmYWNpbmcgKHRoZSBnYW1lIHJvdGF0ZXMgaGltIHRvIGZhY2UgdGhlIGJhdHRsZWZpZWxkKVxuICBwcml2YXRlIHJpZzogYW55OyBwcml2YXRlIHN0YWZmUGl2b3Q6IGFueTsgcHJpdmF0ZSBjcnlzdGFsOiBhbnk7IHByaXZhdGUgY3J5c3RhbE1hdDogYW55OyBwcml2YXRlIHJvYmVNYXQ6IGFueTsgcHJpdmF0ZSBleWVNYXQ6IGFueTsgcHJpdmF0ZSBwczogYW55OyBwcml2YXRlIGdsb3c6IGFueTtcbiAgcHJpdmF0ZSB0ID0gMDsgcHJpdmF0ZSBodXJ0VCA9IDA7IHByaXZhdGUgY2FzdFQgPSAwOyBwcml2YXRlIGRvd24gPSAwOyBwcml2YXRlIGRvd25UYXJnZXQgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgc2NlbmU6IGFueSwgcHJpdmF0ZSBzb2Z0OiBhbnkpIHtcbiAgICBjb25zdCBzID0gc2NlbmUsIG1hdCA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyLCBlciA9IDAsIGVnID0gMCwgZWIgPSAwKSA9PiB7XG4gICAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbm0nLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhlciwgZWcsIGViKTsgbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgcmV0dXJuIG07XG4gICAgfTtcbiAgICBjb25zdCBnbG93TWF0ID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCduZycsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCduZWNybycsIHMpOyB0aGlzLnJpZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ25lY3JvUmlnJywgcyk7IHRoaXMucmlnLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIGNvbnN0IGFkZCA9IChtZXNoOiBhbnksIHBhcmVudCA9IHRoaXMucmlnKSA9PiB7IG1lc2gucGFyZW50ID0gcGFyZW50OyBtZXNoLmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIG1lc2g7IH07XG4gICAgdGhpcy5yb2JlTWF0ID0gbWF0KDAuMDksIDAuMDMsIDAuMTYsIDAuMDUsIDAuMDIsIDAuMSk7XG4gICAgY29uc3Qgcm9iZSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdyb2JlJywgeyBoZWlnaHQ6IDAuODIsIGRpYW1ldGVyVG9wOiAwLjMsIGRpYW1ldGVyQm90dG9tOiAwLjgsIHRlc3NlbGxhdGlvbjogMjAgfSwgcykpOyByb2JlLnBvc2l0aW9uLnkgPSAwLjQxOyByb2JlLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IGhlbSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoZW0nLCB7IGRpYW1ldGVyOiAwLjc4LCB0aGlja25lc3M6IDAuMDM1LCB0ZXNzZWxsYXRpb246IDI4IH0sIHMpKTsgaGVtLnBvc2l0aW9uLnkgPSAwLjAzOyBoZW0ubWF0ZXJpYWwgPSBnbG93TWF0KDAuOSwgMC43LCAwLjI1KTtcbiAgICBjb25zdCBtYW50bGUgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ21hbnRsZScsIHsgZGlhbWV0ZXI6IDAuNiwgc2VnbWVudHM6IDEyIH0sIHMpKTsgbWFudGxlLnNjYWxpbmcuc2V0KDEsIDAuNSwgMC44KTsgbWFudGxlLnBvc2l0aW9uLnkgPSAwLjg7IG1hbnRsZS5tYXRlcmlhbCA9IHRoaXMucm9iZU1hdDtcbiAgICBjb25zdCBob29kID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdob29kJywgeyBkaWFtZXRlcjogMC41Niwgc2VnbWVudHM6IDE0IH0sIHMpKTsgaG9vZC5wb3NpdGlvbi55ID0gMS4wOyBob29kLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IHRpcCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCd0aXAnLCB7IGhlaWdodDogMC40LCBkaWFtZXRlclRvcDogMCwgZGlhbWV0ZXJCb3R0b206IDAuMzQsIHRlc3NlbGxhdGlvbjogMTQgfSwgcykpOyB0aXAucG9zaXRpb24uc2V0KDAsIDEuMjgsIC0wLjA2KTsgdGlwLnJvdGF0aW9uLnggPSAtMC4zNTsgdGlwLm1hdGVyaWFsID0gdGhpcy5yb2JlTWF0O1xuICAgIGNvbnN0IGZhY2UgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2ZhY2UnLCB7IGRpYW1ldGVyOiAwLjM4LCBzZWdtZW50czogMTIgfSwgcykpOyBmYWNlLnBvc2l0aW9uLnNldCgwLCAwLjk5LCAwLjEyKTsgZmFjZS5tYXRlcmlhbCA9IG1hdCgwLjAyLCAwLCAwLjA1KTtcbiAgICB0aGlzLmV5ZU1hdCA9IGdsb3dNYXQoMC45LCAwLjQsIDEpO1xuICAgIGZvciAoY29uc3QgeCBvZiBbLTAuMDc1LCAwLjA3NV0pIHsgY29uc3QgZSA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZXllJywgeyBkaWFtZXRlcjogMC4wNzUsIHNlZ21lbnRzOiA4IH0sIHMpKTsgZS5wb3NpdGlvbi5zZXQoeCwgMS4wLCAwLjI4NSk7IGUuc2NhbGluZy56ID0gMC42OyBlLm1hdGVyaWFsID0gdGhpcy5leWVNYXQ7IH1cbiAgICB0aGlzLmdsb3cgPSBhZGQoQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZXllR2xvdycsIHsgc2l6ZTogMC41IH0sIHMpKTsgdGhpcy5nbG93LnBvc2l0aW9uLnNldCgwLCAxLjAsIDAuMzMpOyB0aGlzLmdsb3cuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDtcbiAgICBjb25zdCBnbSA9IGdsb3dNYXQoMC43LCAwLjI1LCAxLCAwLjU1KTsgZ20uZW1pc3NpdmVUZXh0dXJlID0gc29mdDsgZ20ub3BhY2l0eVRleHR1cmUgPSBzb2Z0OyB0aGlzLmdsb3cubWF0ZXJpYWwgPSBnbTtcbiAgICBjb25zdCBoYW5kID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdoYW5kJywgeyBkaWFtZXRlcjogMC4xMiwgc2VnbWVudHM6IDggfSwgcykpOyBoYW5kLnBvc2l0aW9uLnNldCgtMC4zMiwgMC42MiwgMC4xMik7IGhhbmQubWF0ZXJpYWwgPSBtYXQoMC44LCAwLjc1LCAwLjY1KTtcbiAgICAvLyBzdGFmZjogcGl2b3QgYXQgdGhlIHJpZ2h0IGhhbmQgc28gcmFpc2luZyBpdCBpcyBvbmUgcm90YXRpb25cbiAgICB0aGlzLnN0YWZmUGl2b3QgPSBhZGQobmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnc3RhZmZQaXZvdCcsIHMpKTsgdGhpcy5zdGFmZlBpdm90LnBvc2l0aW9uLnNldCgwLjM0LCAwLjYsIDAuMTQpO1xuICAgIGNvbnN0IHJvZCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdyb2QnLCB7IGhlaWdodDogMS41LCBkaWFtZXRlcjogMC4wNDUsIHRlc3NlbGxhdGlvbjogOCB9LCBzKSwgdGhpcy5zdGFmZlBpdm90KTsgcm9kLnBvc2l0aW9uLnkgPSAwLjQ1OyByb2QubWF0ZXJpYWwgPSBtYXQoMC4yOCwgMC4xNywgMC4xKTtcbiAgICB0aGlzLmNyeXN0YWxNYXQgPSBnbG93TWF0KDAuNzUsIDAuMzUsIDEpO1xuICAgIHRoaXMuY3J5c3RhbCA9IGFkZChCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBvbHloZWRyb24oJ2NyeXN0YWwnLCB7IHR5cGU6IDEsIHNpemU6IDAuMTIgfSwgcyksIHRoaXMuc3RhZmZQaXZvdCk7IHRoaXMuY3J5c3RhbC5wb3NpdGlvbi55ID0gMS4yODsgdGhpcy5jcnlzdGFsLnNjYWxpbmcueSA9IDEuNTsgdGhpcy5jcnlzdGFsLnJvdGF0aW9uLnggPSAwLjQ7IHRoaXMuY3J5c3RhbC5tYXRlcmlhbCA9IHRoaXMuY3J5c3RhbE1hdDtcbiAgICBjb25zdCByaW5nID0gYWRkKEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygnYmFzZScsIHsgcmFkaXVzOiAwLjYyLCB0ZXNzZWxsYXRpb246IDMwIH0sIHMpLCB0aGlzLmhvbGRlcik7IHJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyByaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyByaW5nLm1hdGVyaWFsID0gZ2xvd01hdCgwLjQsIDAuMTUsIDAuNzUsIDAuNTUpO1xuICAgIC8vIGF1cmFcbiAgICBjb25zdCBwcyA9IHRoaXMucHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnbmVjcm9BdXJhJywgODAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSBzb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5ob2xkZXI7XG4gICAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMywgMCwgLTAuMyk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMywgMC45LCAwLjMpOyBwcy5taW5MaWZlVGltZSA9IDAuNjsgcHMubWF4TGlmZVRpbWUgPSAxLjM7XG4gICAgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMTUsIDAuOSwgLTAuMTUpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjE1LCAxLjYsIDAuMTUpOyBwcy5taW5FbWl0UG93ZXIgPSAwLjM7IHBzLm1heEVtaXRQb3dlciA9IDAuODsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4wNzsgcHMubWF4U2l6ZSA9IDAuMjsgcHMuZW1pdFJhdGUgPSAzMDsgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDAuOCwgMC4zNSwgMSwgMC43KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KDAuNDUsIDAuMTUsIDAuOSwgMC41KTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICBzZXRFbmFibGVkKG9uOiBib29sZWFuKSB7IHRoaXMuaG9sZGVyLnNldEVuYWJsZWQob24pOyBpZiAob24pIHRoaXMucHMuc3RhcnQoKTsgZWxzZSB0aGlzLnBzLnN0b3AoKTsgfVxuICAvKiogV29ybGQgcG9zaXRpb24gb2YgdGhlIHN0YWZmIGNyeXN0YWwgKGZvciBzcGVsbCBlZmZlY3RzKS4gKi9cbiAgY3J5c3RhbFBvcygpOiBhbnkgeyB0aGlzLmhvbGRlci5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7IHRoaXMucmlnLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgdGhpcy5zdGFmZlBpdm90LmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgdGhpcy5jcnlzdGFsLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTsgcmV0dXJuIHRoaXMuY3J5c3RhbC5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuY2xvbmUoKTsgfVxuXG4gIGh1cnQoKSB7IHRoaXMuaHVydFQgPSAwLjg7IH1cbiAgY2FzdCgpIHsgdGhpcy5jYXN0VCA9IDEuMTsgfVxuICAvKiogVGhlIGxhc3QgaGVhcnQgaXMgZ29uZTogaGUgc2lua3MgdG8gaGlzIGtuZWVzLCB0aGUgZXllcyBkaW0uICovXG4gIGRlZmVhdCgpIHsgdGhpcy5kb3duVGFyZ2V0ID0gMTsgfVxuICByZXZpdmUoKSB7IHRoaXMuZG93blRhcmdldCA9IDA7IHRoaXMuaHVydFQgPSAwOyB0aGlzLmNhc3RUID0gMDsgfVxuXG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0O1xuICAgIHRoaXMuZG93biArPSAodGhpcy5kb3duVGFyZ2V0IC0gdGhpcy5kb3duKSAqIE1hdGgubWluKDEsIGR0ICogMyk7XG4gICAgY29uc3QgYm9iID0gTWF0aC5zaW4odGhpcy50ICogMikgKiAwLjAzNSAqICgxIC0gdGhpcy5kb3duKTtcbiAgICBsZXQgcmVjb2lsID0gMCwgZmxhc2ggPSAwO1xuICAgIGlmICh0aGlzLmh1cnRUID4gMCkgeyB0aGlzLmh1cnRUID0gTWF0aC5tYXgoMCwgdGhpcy5odXJ0VCAtIGR0KTsgY29uc3QgdSA9IHRoaXMuaHVydFQgLyAwLjg7IHJlY29pbCA9IE1hdGguc2luKHUgKiBNYXRoLlBJKSAqIDAuNDI7IGZsYXNoID0gdTsgfVxuICAgIGxldCByYWlzZSA9IDA7XG4gICAgaWYgKHRoaXMuY2FzdFQgPiAwKSB7IHRoaXMuY2FzdFQgPSBNYXRoLm1heCgwLCB0aGlzLmNhc3RUIC0gZHQpOyBjb25zdCB1ID0gdGhpcy5jYXN0VCAvIDEuMTsgcmFpc2UgPSBNYXRoLnNpbihNYXRoLm1pbigxLCAoMSAtIHUpICogMS42KSAqIE1hdGguUEkgKiAwLjUpICogKHUgPiAwLjI1ID8gMSA6IHUgLyAwLjI1KTsgfVxuICAgIHRoaXMucmlnLnBvc2l0aW9uLnkgPSBib2IgLSAwLjI4ICogdGhpcy5kb3duOyB0aGlzLnJpZy5yb3RhdGlvbi54ID0gLXJlY29pbCArIDAuOSAqIHRoaXMuZG93bjsgdGhpcy5yaWcucm90YXRpb24ueiA9IE1hdGguc2luKHRoaXMudCAqIDEuMykgKiAwLjAzICsgTWF0aC5zaW4odGhpcy5odXJ0VCAqIDYwKSAqIDAuMDMgKiAodGhpcy5odXJ0VCA+IDAgPyAxIDogMCk7XG4gICAgdGhpcy5zdGFmZlBpdm90LnJvdGF0aW9uLnogPSAtMC4xNSAqIHJhaXNlIC0gMC4wNTsgdGhpcy5zdGFmZlBpdm90LnJvdGF0aW9uLnggPSAtMC40NSAqIHJhaXNlOyB0aGlzLnN0YWZmUGl2b3QucG9zaXRpb24ueSA9IDAuNiArIDAuMzUgKiByYWlzZTtcbiAgICB0aGlzLmNyeXN0YWwucm90YXRpb24ueSArPSBkdCAqICgyICsgNiAqIHJhaXNlKTsgY29uc3QgcHVsc2UgPSAxICsgMC4xMiAqIE1hdGguc2luKHRoaXMudCAqIDQpICsgMS4xICogcmFpc2U7IHRoaXMuY3J5c3RhbC5zY2FsaW5nLnNldChwdWxzZSwgMS41ICogcHVsc2UsIHB1bHNlKTtcbiAgICBjb25zdCBkaW0gPSAxIC0gMC44NSAqIHRoaXMuZG93bjtcbiAgICB0aGlzLmNyeXN0YWxNYXQuZW1pc3NpdmVDb2xvci5zZXQoKDAuNzUgKyAwLjI1ICogcmFpc2UpICogZGltLCAoMC4zNSArIDAuNCAqIHJhaXNlKSAqIGRpbSwgMSAqIGRpbSk7XG4gICAgdGhpcy5leWVNYXQuZW1pc3NpdmVDb2xvci5zZXQoMC45ICogZGltICsgZmxhc2ggKiAwLjEsICgwLjQgKyAwLjI1ICogcmFpc2UpICogZGltICogKDEgLSBmbGFzaCAqIDAuNiksIDEgKiBkaW0gKiAoMSAtIGZsYXNoICogMC43KSk7XG4gICAgdGhpcy5yb2JlTWF0LmVtaXNzaXZlQ29sb3Iuc2V0KDAuMDUgKyBmbGFzaCAqIDAuNiwgMC4wMiwgMC4xICogKDEgLSBmbGFzaCkpO1xuICAgIHRoaXMuZ2xvdy5zY2FsaW5nLnNldEFsbCgwLjYgKyAwLjkgKiBkaW0gKyByYWlzZSAqIDAuOCk7XG4gICAgdGhpcy5wcy5lbWl0UmF0ZSA9ICgzMCArIDkwICogcmFpc2UpICogZGltO1xuICB9XG5cbiAgZGlzcG9zZSgpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cbiIsICIvLyBBbGwgc291bmQgaXMgc3ludGhlc2l6ZWQgaW4gdGhlIGJyb3dzZXIgd2l0aCB0aGUgV2ViIEF1ZGlvIEFQSTogbm8gYXVkaW8gZmlsZXMgdG8gZG93bmxvYWQsIGxpY2Vuc2Ugb3Igc2hpcC5cbi8vIFR3byBpbmRlcGVuZGVudCBzd2l0Y2hlcyAobXVzaWMsIHNvdW5kIGVmZmVjdHMpLCBzYXZlZCBpbiB0aGUgcGxheWVyJ3Mgc2F2ZS4gUGhvbmVzIG9ubHkgYWxsb3cgc291bmQgYWZ0ZXIgYSB0YXAsIHNvIG5vdGhpbmcgc3RhcnRzXG4vLyB1bnRpbCB0aGUgZmlyc3QgdG91Y2gvY2xpY2sgKGB1bmxvY2tgKS5cbmltcG9ydCB7IGxvYWRTYXZlLCB1cGRhdGVTZXR0aW5ncyB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5cbmV4cG9ydCB0eXBlIFNmeCA9ICd0YXAnIHwgJ3N1bW1vbicgfCAnbWVyZ2UnIHwgJ2hpdCcgfCAnaGl0QXJyb3cnIHwgJ3NtYXNoJyB8ICdhcnJvdycgfCAnZGVhdGgnIHwgJ2Nhc3QnIHwgJ3RhdW50JyB8ICdzaG9ja3dhdmUnIHwgJ3Jlc3VycmVjdCcgfCAnaGVhcnRMb3N0JyB8ICd2aWN0b3J5JyB8ICdkZWZlYXQnIHwgJ3N0YXJ0J1xuICB8ICd1bmxvY2snIHwgJ3BhY2tDaGFyZ2UnIHwgJ3BhY2tUaWVyVXAnIHwgJ3BhY2tUZWFyJyB8ICdwYWNrRmFuJyB8ICdwYWNrRmxpcCcgfCAncGFja1JhcmUnIHwgJ3BhY2tFcGljJyB8ICdwYWNrTGVnZW5kJyB8ICdwYWNrQ29sbGVjdCc7XG5leHBvcnQgdHlwZSBNb2RlID0gJ2J1aWxkJyB8ICdiYXR0bGUnO1xuXG4vLyBNdXNpYzogQSBtaW5vciwgODAgYnBtLCBmb3VyIGJhcnMgbG9vcGluZyAoQW0sIEYsIEMsIEUpLiBSb290IG5vdGUgZmlyc3QsIHRoZW4gY2hvcmQgdG9uZXMgKEh6KS5cbmNvbnN0IENIT1JEUzogbnVtYmVyW11bXSA9IFtcbiAgWzExMCwgMTY0LjgxLCAyMjAsIDI2MS42MywgMzI5LjYzXSxcbiAgWzg3LjMxLCAxMzAuODEsIDE3NC42MSwgMjIwLCAyNjEuNjNdLFxuICBbMTMwLjgxLCAxOTYsIDI2MS42MywgMzI5LjYzLCAzOTJdLFxuICBbODIuNDEsIDEyMy40NywgMTY0LjgxLCAyMDcuNjUsIDI0Ni45NF0sXG5dO1xuY29uc3QgQkVBVCA9IDYwIC8gODA7XG5cbmNsYXNzIEF1ZGlvRW5naW5lIHtcbiAgcHJpdmF0ZSBjdHg6IEF1ZGlvQ29udGV4dCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG1hc3RlciE6IEdhaW5Ob2RlOyBwcml2YXRlIG11c2ljQnVzITogR2Fpbk5vZGU7IHByaXZhdGUgc2Z4QnVzITogR2Fpbk5vZGU7IHByaXZhdGUgbm9pc2VCdWYhOiBBdWRpb0J1ZmZlcjtcbiAgbXVzaWMgPSB0cnVlOyBzZnggPSB0cnVlOyBtb2RlOiBNb2RlID0gJ2J1aWxkJztcbiAgcHJpdmF0ZSB0aW1lciA9IDA7IHByaXZhdGUgbmV4dFQgPSAwOyBwcml2YXRlIGJlYXQgPSAwOyBwcml2YXRlIHN0YW1wczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuXG4gIGNvbnN0cnVjdG9yKCkgeyBjb25zdCBzID0gbG9hZFNhdmUoKS5zZXR0aW5nczsgdGhpcy5tdXNpYyA9IHMubXVzaWM7IHRoaXMuc2Z4ID0gcy5zZng7IH1cblxuICBwcml2YXRlIHNpbGVudDogSFRNTEF1ZGlvRWxlbWVudCB8IG51bGwgPSBudWxsOyBwcml2YXRlIHByaW1lZCA9IGZhbHNlO1xuICAvKiogaVBob25lcyBtdXRlIFdlYiBBdWRpbyB3aGVuIHRoZSByaW5nZXIgc3dpdGNoIGlzIG9uLCB1bmxlc3MgdGhlIHBhZ2UgaXMgcGxheWluZyBcInJlYWxcIiBtZWRpYS4gQSBzaWxlbnQgbG9vcGluZyA8YXVkaW8+IGVsZW1lbnQgKHBsdXMgdGhlXG4gICAqICBhdWRpb1Nlc3Npb24gaGludCBvbiBuZXdlciBpT1MpIG1vdmVzIHRoZSBwYWdlIHRvIHRoZSBwbGF5YmFjayBjaGFubmVsLCBzbyB0aGUgZ2FtZSBpcyBoZWFyZCBldmVuIHdpdGggdGhlIHN3aXRjaCBvbiBzaWxlbnQuICovXG4gIHByaXZhdGUgcGxheWJhY2tDaGFubmVsKCkge1xuICAgIHRyeSB7IGNvbnN0IGEgPSAobmF2aWdhdG9yIGFzIGFueSkuYXVkaW9TZXNzaW9uOyBpZiAoYSkgYS50eXBlID0gJ3BsYXliYWNrJzsgfSBjYXRjaCB7IC8qIG5vdCBzdXBwb3J0ZWQgKi8gfVxuICAgIGlmICh0aGlzLnNpbGVudCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBuID0gNDQxLCBidWYgPSBuZXcgQXJyYXlCdWZmZXIoNDQgKyBuICogMiksIHYgPSBuZXcgRGF0YVZpZXcoYnVmKSwgc3RyID0gKG86IG51bWJlciwgdDogc3RyaW5nKSA9PiB7IGZvciAobGV0IGkgPSAwOyBpIDwgdC5sZW5ndGg7IGkrKykgdi5zZXRVaW50OChvICsgaSwgdC5jaGFyQ29kZUF0KGkpKTsgfTtcbiAgICAgIHN0cigwLCAnUklGRicpOyB2LnNldFVpbnQzMig0LCAzNiArIG4gKiAyLCB0cnVlKTsgc3RyKDgsICdXQVZFJyk7IHN0cigxMiwgJ2ZtdCAnKTsgdi5zZXRVaW50MzIoMTYsIDE2LCB0cnVlKTsgdi5zZXRVaW50MTYoMjAsIDEsIHRydWUpOyB2LnNldFVpbnQxNigyMiwgMSwgdHJ1ZSk7XG4gICAgICB2LnNldFVpbnQzMigyNCwgNDQxMDAsIHRydWUpOyB2LnNldFVpbnQzMigyOCwgODgyMDAsIHRydWUpOyB2LnNldFVpbnQxNigzMiwgMiwgdHJ1ZSk7IHYuc2V0VWludDE2KDM0LCAxNiwgdHJ1ZSk7IHN0cigzNiwgJ2RhdGEnKTsgdi5zZXRVaW50MzIoNDAsIG4gKiAyLCB0cnVlKTtcbiAgICAgIGNvbnN0IGVsID0gbmV3IEF1ZGlvKFVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW2J1Zl0sIHsgdHlwZTogJ2F1ZGlvL3dhdicgfSkpKTsgZWwubG9vcCA9IHRydWU7IGVsLnZvbHVtZSA9IDAuMDE7IGVsLnNldEF0dHJpYnV0ZSgncGxheXNpbmxpbmUnLCAnJyk7IHRoaXMuc2lsZW50ID0gZWw7XG4gICAgICBlbC5wbGF5KCkuY2F0Y2goKCkgPT4geyB0aGlzLnNpbGVudCA9IG51bGw7IH0pO1xuICAgIH0gY2F0Y2ggeyAvKiBmaW5lOiBzb3VuZCBzdGlsbCB3b3JrcywganVzdCBmb2xsb3dzIHRoZSBzaWxlbnQgc3dpdGNoICovIH1cbiAgfVxuICAvKiogV2hhdCB0aGUgU2V0dGluZ3MgcGFnZSBzaG93cyBzbyBhIHNpbGVudCBwaG9uZSBjYW4gYmUgZGlhZ25vc2VkLiAqL1xuICBzdGF0dXMoKTogeyBzdGF0ZTogc3RyaW5nOyB1bmxvY2tlZDogYm9vbGVhbiB9IHsgcmV0dXJuIHsgc3RhdGU6IHRoaXMuY3R4ID8gdGhpcy5jdHguc3RhdGUgOiAnbm90IHN0YXJ0ZWQnLCB1bmxvY2tlZDogISF0aGlzLmN0eCAmJiB0aGlzLmN0eC5zdGF0ZSA9PT0gJ3J1bm5pbmcnIH07IH1cbiAgLyoqIFRoZSBTZXR0aW5ncyBwYWdlJ3MgVGVzdCBzb3VuZCBidXR0b246IHVubG9jayBhbmQgbWFrZSBhIGNsZWFybHkgYXVkaWJsZSBzb3VuZC4gKi9cbiAgdGVzdCgpIHsgdGhpcy51bmxvY2soKTsgY29uc3QgdCA9ICgpID0+IHsgdGhpcy5wbGF5KCd2aWN0b3J5Jyk7IH07IGlmICh0aGlzLmN0eCAmJiB0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSB0aGlzLmN0eC5yZXN1bWUoKS50aGVuKHQpLmNhdGNoKCgpID0+IHt9KTsgZWxzZSB0KCk7IH1cblxuICAvKiogQ2FsbCBmcm9tIGEgdXNlciBnZXN0dXJlICh0YXAvY2xpY2spLiBTYWZlIHRvIGNhbGwgcmVwZWF0ZWRseS4gKi9cbiAgdW5sb2NrKCkge1xuICAgIHRoaXMucGxheWJhY2tDaGFubmVsKCk7XG4gICAgaWYgKCF0aGlzLmN0eCkge1xuICAgICAgY29uc3QgQyA9ICh3aW5kb3cgYXMgYW55KS5BdWRpb0NvbnRleHQgfHwgKHdpbmRvdyBhcyBhbnkpLndlYmtpdEF1ZGlvQ29udGV4dDsgaWYgKCFDKSByZXR1cm47XG4gICAgICBjb25zdCBjdHg6IEF1ZGlvQ29udGV4dCA9IHRoaXMuY3R4ID0gbmV3IEMoKTtcbiAgICAgIGNvbnN0IGNvbXAgPSBjdHguY3JlYXRlRHluYW1pY3NDb21wcmVzc29yKCk7IGNvbXAuY29ubmVjdChjdHguZGVzdGluYXRpb24pO1xuICAgICAgdGhpcy5tYXN0ZXIgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm1hc3Rlci5nYWluLnZhbHVlID0gMC45OyB0aGlzLm1hc3Rlci5jb25uZWN0KGNvbXApO1xuICAgICAgdGhpcy5tdXNpY0J1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMubXVzaWNCdXMuY29ubmVjdCh0aGlzLm1hc3Rlcik7IHRoaXMuc2Z4QnVzID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5zZnhCdXMuY29ubmVjdCh0aGlzLm1hc3Rlcik7XG4gICAgICBjdHgub25zdGF0ZWNoYW5nZSA9ICgpID0+IHsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1hdWRpby1zdGF0ZScpKTsgfTtcbiAgICAgIGNvbnN0IGxlbiA9IGN0eC5zYW1wbGVSYXRlOyB0aGlzLm5vaXNlQnVmID0gY3R4LmNyZWF0ZUJ1ZmZlcigxLCBsZW4sIGN0eC5zYW1wbGVSYXRlKTsgY29uc3QgZCA9IHRoaXMubm9pc2VCdWYuZ2V0Q2hhbm5lbERhdGEoMCk7IGZvciAobGV0IGkgPSAwOyBpIDwgbGVuOyBpKyspIGRbaV0gPSBNYXRoLnJhbmRvbSgpICogMiAtIDE7XG4gICAgfVxuICAgIGlmICh0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSB0aGlzLmN0eC5yZXN1bWUoKS5jYXRjaCgoKSA9PiB7fSk7ICAgICAgICAgICAgIC8vICdzdXNwZW5kZWQnIG9yIChpT1MpICdpbnRlcnJ1cHRlZCdcbiAgICBpZiAoIXRoaXMucHJpbWVkKSB7IHRoaXMucHJpbWVkID0gdHJ1ZTsgdHJ5IHsgY29uc3QgYiA9IHRoaXMuY3R4LmNyZWF0ZUJ1ZmZlcigxLCAxLCAyMjA1MCksIHMgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKTsgcy5idWZmZXIgPSBiOyBzLmNvbm5lY3QodGhpcy5jdHguZGVzdGluYXRpb24pOyBzLnN0YXJ0KDApOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH0gfVxuICAgIHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpO1xuICB9XG5cbiAgc2V0TXVzaWMob246IGJvb2xlYW4pIHsgdGhpcy5tdXNpYyA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IG11c2ljOiBvbiB9KTsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2V0dGluZ3MnKSk7IH1cbiAgc2V0U2Z4KG9uOiBib29sZWFuKSB7IHRoaXMuc2Z4ID0gb247IHVwZGF0ZVNldHRpbmdzKHsgc2Z4OiBvbiB9KTsgdGhpcy5hcHBseUdhaW5zKCk7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2V0dGluZ3MnKSk7IGlmIChvbikgdGhpcy5wbGF5KCd0YXAnKTsgfVxuICAvKiogUmUtcmVhZCB0aGUgc2F2ZWQgc3dpdGNoZXMgKHRoZSBzaGVsbCdzIFNldHRpbmdzIHBhZ2UgY2hhbmdlcyB0aGVtIHRvbykuICovXG4gIHJlbG9hZCgpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTsgfVxuICBzZXRNb2RlKG06IE1vZGUpIHsgdGhpcy5tb2RlID0gbTsgfVxuXG4gIHByaXZhdGUgYXBwbHlHYWlucygpIHtcbiAgICBpZiAoIXRoaXMuY3R4KSByZXR1cm47IGNvbnN0IHQgPSB0aGlzLmN0eC5jdXJyZW50VGltZTtcbiAgICB0aGlzLm11c2ljQnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMubXVzaWMgPyAwLjUgOiAwLCB0LCAwLjE1KTsgdGhpcy5zZnhCdXMuZ2Fpbi5zZXRUYXJnZXRBdFRpbWUodGhpcy5zZnggPyAwLjggOiAwLCB0LCAwLjA1KTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBtdXNpY1xuICBwcml2YXRlIHN5bmNNdXNpYygpIHtcbiAgICBpZiAoIXRoaXMuY3R4KSByZXR1cm47XG4gICAgaWYgKHRoaXMubXVzaWMgJiYgIXRoaXMudGltZXIpIHsgdGhpcy5uZXh0VCA9IHRoaXMuY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgdGhpcy50aW1lciA9IHdpbmRvdy5zZXRJbnRlcnZhbCgoKSA9PiB0aGlzLnRpY2soKSwgMjAwKTsgfVxuICAgIGlmICghdGhpcy5tdXNpYyAmJiB0aGlzLnRpbWVyKSB7IGNsZWFySW50ZXJ2YWwodGhpcy50aW1lcik7IHRoaXMudGltZXIgPSAwOyB9XG4gIH1cbiAgcHJpdmF0ZSB0aWNrKCkge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ITsgaWYgKGN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSB7IHRoaXMubmV4dFQgPSBjdHguY3VycmVudFRpbWUgKyAwLjE1OyByZXR1cm47IH1cbiAgICB3aGlsZSAodGhpcy5uZXh0VCA8IGN0eC5jdXJyZW50VGltZSArIDAuNikgeyB0aGlzLnBsYXlCZWF0KHRoaXMuYmVhdCwgdGhpcy5uZXh0VCk7IHRoaXMubmV4dFQgKz0gQkVBVDsgdGhpcy5iZWF0ID0gKHRoaXMuYmVhdCArIDEpICUgMTY7IH1cbiAgfVxuICBwcml2YXRlIHBsYXlCZWF0KGJlYXQ6IG51bWJlciwgdDogbnVtYmVyKSB7XG4gICAgY29uc3QgY2hvcmQgPSBDSE9SRFNbTWF0aC5mbG9vcihiZWF0IC8gNCldLCBpbkJhciA9IGJlYXQgJSA0LCBiYXR0bGUgPSB0aGlzLm1vZGUgPT09ICdiYXR0bGUnO1xuICAgIGlmIChpbkJhciA9PT0gMCkgZm9yIChjb25zdCBmIG9mIGNob3JkKSB0aGlzLnZvaWNlKGYsICd0cmlhbmdsZScsIHQsIEJFQVQgKiA0ICsgMC44LCAwLjA0NSwgMC45LCA5MDApOyAgIC8vIHNsb3cgcGFkXG4gICAgaWYgKGluQmFyID09PSAwIHx8IGluQmFyID09PSAyKSB0aGlzLnZvaWNlKGNob3JkWzBdLCAnc2luZScsIHQsIEJFQVQgKiAxLjYsIDAuMTYsIDAuMDIsIDQwMCk7ICAgICAgICAgIC8vIGJhc3NcbiAgICBpZiAoYmF0dGxlKSB7XG4gICAgICB0aGlzLmtpY2sodCwgMC4zMik7IGlmIChpbkJhciA9PT0gMikgdGhpcy5raWNrKHQgKyBCRUFUICogMC41LCAwLjE4KTtcbiAgICAgIHRoaXMubm9pc2UodCArIEJFQVQgKiAwLjUsIDAuMDUsIDAuMDUsICdoaWdocGFzcycsIDcwMDApOyB0aGlzLm5vaXNlKHQgKyBCRUFUICogMS41ICUgQkVBVCwgMC4wNSwgMC4wMywgJ2hpZ2hwYXNzJywgNzAwMCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDI7IGkrKykgdGhpcy52b2ljZShjaG9yZFsxICsgKChiZWF0ICogMiArIGkpICUgNCldICogMiwgJ3RyaWFuZ2xlJywgdCArIGkgKiBCRUFUIC8gMiwgMC4yMiwgMC4wNSwgMC4wMDUsIDI1MDApOyAgIC8vIHBsdWNrIGFycGVnZ2lvXG4gICAgfVxuICB9XG4gIHByaXZhdGUgdm9pY2UoZnJlcTogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgdDogbnVtYmVyLCBkdXI6IG51bWJlciwgZ2FpbjogbnVtYmVyLCBhdHRhY2s6IG51bWJlciwgbHA6IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnZhbHVlID0gZnJlcTsgZi50eXBlID0gJ2xvd3Bhc3MnOyBmLmZyZXF1ZW5jeS52YWx1ZSA9IGxwO1xuICAgIGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIE1hdGgubWF4KDAuMDA1LCBhdHRhY2spKTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgZHVyKTtcbiAgICBvLmNvbm5lY3QoZik7IGYuY29ubmVjdChnKTsgZy5jb25uZWN0KHRoaXMubXVzaWNCdXMpOyBvLnN0YXJ0KHQpOyBvLnN0b3AodCArIGR1ciArIDAuMDUpO1xuICB9XG4gIHByaXZhdGUga2ljayh0OiBudW1iZXIsIGdhaW46IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpO1xuICAgIG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKDEzMCwgdCk7IG8uZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoNDIsIHQgKyAwLjE0KTsgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyAwLjIpO1xuICAgIG8uY29ubmVjdChnKTsgZy5jb25uZWN0KHRoaXMubXVzaWNCdXMpOyBvLnN0YXJ0KHQpOyBvLnN0b3AodCArIDAuMjUpO1xuICB9XG4gIHByaXZhdGUgbm9pc2UodDogbnVtYmVyLCBkdXI6IG51bWJlciwgZ2FpbjogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmcmVxOiBudW1iZXIsIGJ1czogR2Fpbk5vZGUgPSB0aGlzLm11c2ljQnVzLCBzd2VlcFRvPzogbnVtYmVyKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCBuID0gY3R4LmNyZWF0ZUJ1ZmZlclNvdXJjZSgpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBuLmJ1ZmZlciA9IHRoaXMubm9pc2VCdWY7IGYudHlwZSA9IHR5cGU7IGYuZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc3dlZXBUbykgZi5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzd2VlcFRvLCB0ICsgZHVyKTtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoZ2FpbiwgdCk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgbi5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdChidXMpOyBuLnN0YXJ0KHQsIE1hdGgucmFuZG9tKCkgKiAwLjUpOyBuLnN0b3AodCArIGR1ciArIDAuMDIpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNvdW5kIGVmZmVjdHNcbiAgcHJpdmF0ZSB0b25lKGZyZXE6IG51bWJlciwgZHVyOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCBnYWluOiBudW1iZXIsIGRlbGF5ID0gMCwgc2xpZGVUbz86IG51bWJlciwgYXR0YWNrID0gMC4wMDUsIGxwID0gODAwMCkge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgdCA9IGN0eC5jdXJyZW50VGltZSArIGRlbGF5LCBvID0gY3R4LmNyZWF0ZU9zY2lsbGF0b3IoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCksIGYgPSBjdHguY3JlYXRlQmlxdWFkRmlsdGVyKCk7XG4gICAgby50eXBlID0gdHlwZTsgby5mcmVxdWVuY3kuc2V0VmFsdWVBdFRpbWUoZnJlcSwgdCk7IGlmIChzbGlkZVRvKSBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKHNsaWRlVG8sIHQgKyBkdXIpO1xuICAgIGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDsgZy5nYWluLnNldFZhbHVlQXRUaW1lKDAuMDAwMSwgdCk7IGcuZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZShnYWluLCB0ICsgYXR0YWNrKTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgZHVyKTtcbiAgICBvLmNvbm5lY3QoZik7IGYuY29ubmVjdChnKTsgZy5jb25uZWN0KHRoaXMuc2Z4QnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGhpc3MoZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBkZWxheSA9IDAsIHN3ZWVwVG8/OiBudW1iZXIpIHsgdGhpcy5ub2lzZSh0aGlzLmN0eCEuY3VycmVudFRpbWUgKyBkZWxheSwgZHVyLCBnYWluLCB0eXBlLCBmcmVxLCB0aGlzLnNmeEJ1cywgc3dlZXBUbyk7IH1cbiAgcHJpdmF0ZSB0aHJvdHRsZShrZXk6IHN0cmluZywgbXM6IG51bWJlcikgeyBjb25zdCBuID0gcGVyZm9ybWFuY2Uubm93KCk7IGlmIChuIC0gKHRoaXMuc3RhbXBzW2tleV0gfHwgMCkgPCBtcykgcmV0dXJuIGZhbHNlOyB0aGlzLnN0YW1wc1trZXldID0gbjsgcmV0dXJuIHRydWU7IH1cblxuICBwbGF5KG5hbWU6IFNmeCkge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuc2Z4IHx8IHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHJldHVybjtcbiAgICBzd2l0Y2ggKG5hbWUpIHtcbiAgICAgIGNhc2UgJ3RhcCc6IGlmICghdGhpcy50aHJvdHRsZSgndGFwJywgNDApKSByZXR1cm47IHRoaXMudG9uZSg3NjAsIDAuMDYsICdzaW5lJywgMC4yMiwgMCwgMTEwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc3VtbW9uJzogdGhpcy5oaXNzKDAuNCwgMC4xNCwgJ2JhbmRwYXNzJywgNTAwLCAwLCAyNTAwKTsgdGhpcy50b25lKDIyMCwgMC40LCAnc2F3dG9vdGgnLCAwLjEsIDAsIDY2MCwgMC4wNSwgMTgwMCk7IHRoaXMudG9uZSgxMzIwLCAwLjIsICdzaW5lJywgMC4xLCAwLjE4KTsgYnJlYWs7XG4gICAgICBjYXNlICdtZXJnZSc6IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC4zNSwgJ3RyaWFuZ2xlJywgMC4yLCBpICogMC4wNykpOyB0aGlzLmhpc3MoMC41LCAwLjA4LCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMTEwLCAwLjMsICdzaW5lJywgMC4zNSwgMCwgNTApOyB0aGlzLnRvbmUoMTU2OCwgMC41LCAnc2luZScsIDAuMDgsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0JzogaWYgKCF0aGlzLnRocm90dGxlKCdoaXQnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDcsIDAuMjQsICdsb3dwYXNzJywgMTgwMCk7IHRoaXMudG9uZSgxNzAsIDAuMDksICdzaW5lJywgMC4yMiwgMCwgODApOyBicmVhaztcbiAgICAgIGNhc2UgJ2hpdEFycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdoaXRBJywgNDUpKSByZXR1cm47IHRoaXMuaGlzcygwLjA1LCAwLjE0LCAnYmFuZHBhc3MnLCAzMDAwKTsgdGhpcy50b25lKDcwMCwgMC4wNiwgJ3RyaWFuZ2xlJywgMC4wNiwgMCwgNDAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzbWFzaCc6IHRoaXMudG9uZSg5NSwgMC4zOCwgJ3NpbmUnLCAwLjUsIDAsIDM0KTsgdGhpcy5oaXNzKDAuMzIsIDAuMzUsICdsb3dwYXNzJywgMTAwMCwgMCwgMjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdhcnJvdyc6IGlmICghdGhpcy50aHJvdHRsZSgnYXJyb3cnLCA2MCkpIHJldHVybjsgdGhpcy5oaXNzKDAuMTQsIDAuMSwgJ2JhbmRwYXNzJywgMTgwMCwgMCwgNDIwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVhdGgnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2RlYXRoJywgNzApKSByZXR1cm47IHRoaXMudG9uZSgzMDAsIDAuNCwgJ3Nhd3Rvb3RoJywgMC4xNCwgMCwgNzAsIDAuMDEsIDkwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnY2FzdCc6IHRoaXMudG9uZSgzMDAsIDAuNDUsICdzaW5lJywgMC4xOCwgMCwgOTAwLCAwLjA1KTsgdGhpcy50b25lKDQ1MCwgMC40NSwgJ3NpbmUnLCAwLjEsIDAuMDUsIDEzNTAsIDAuMDUpOyB0aGlzLnRvbmUoMTgwMCwgMC4yNSwgJ3NpbmUnLCAwLjA1LCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3RhdW50JzogdGhpcy50b25lKDE5NiwgMC41LCAnc3F1YXJlJywgMC4wOCwgMCwgMTgwLCAwLjAzLCA3MDApOyB0aGlzLnRvbmUoMTQ3LCAwLjUsICdzYXd0b290aCcsIDAuMDgsIDAuMDIsIDE0MCwgMC4wMywgNjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzaG9ja3dhdmUnOiB0aGlzLnRvbmUoMjIwLCAxLjEsICdzaW5lJywgMC41LCAwLCAyOCwgMC4wMik7IHRoaXMuaGlzcygxLjAsIDAuMzUsICdsb3dwYXNzJywgMzAwMCwgMCwgMTUwKTsgdGhpcy50b25lKDg4MCwgMC44LCAnc2luZScsIDAuMDgsIDAsIDIyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncmVzdXJyZWN0JzogWzIyMCwgMjc3LCAzMzAsIDQ0MCwgNTU0XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMS4xLCAndHJpYW5nbGUnLCAwLjEsIGkgKiAwLjEyLCBmICogMS4xMiwgMC4zKSk7IHRoaXMuaGlzcygwLjksIDAuMDYsICdoaWdocGFzcycsIDQ1MDAsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnaGVhcnRMb3N0JzogdGhpcy50b25lKDExMCwgMC43LCAnc2F3dG9vdGgnLCAwLjI4LCAwLCA1MCwgMC4wMSwgNDUwKTsgdGhpcy5oaXNzKDAuMTgsIDAuMiwgJ2xvd3Bhc3MnLCA5MDApOyB0aGlzLnRvbmUoMjMzLCAwLjUsICdzcXVhcmUnLCAwLjA1LCAwLjAyLCAyMjAsIDAuMDEsIDUwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAndmljdG9yeSc6IFszOTIsIDQ5NCwgNTg3LCA3ODRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjUsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjExKSk7IHRoaXMudG9uZSgxOTYsIDAuOSwgJ3NpbmUnLCAwLjIpOyBicmVhaztcbiAgICAgIGNhc2UgJ2RlZmVhdCc6IFszMzAsIDI5NCwgMjQ3LCAxOTZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjcsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjI4LCBmICogMC45NykpOyB0aGlzLnRvbmUoODIsIDEuNiwgJ3NpbmUnLCAwLjMsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndW5sb2NrJzogWzAuMzUsIDAuNDcsIDAuNTksIDAuNzFdLmZvckVhY2goKGQsIGkpID0+IHsgdGhpcy5oaXNzKDAuMDUsIDAuMjIsICdiYW5kcGFzcycsIDkwMCArIGkgKiAxMjAsIGQpOyB0aGlzLnRvbmUoMTcwICsgaSAqIDEyLCAwLjA3LCAnc3F1YXJlJywgMC4wNiwgZCwgdW5kZWZpbmVkLCAwLjAwMiwgNjAwKTsgfSk7IFs3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjYsICd0cmlhbmdsZScsIDAuMTYsIDEuMTUgKyBpICogMC4wNykpOyB0aGlzLmhpc3MoMC41LCAwLjA5LCAnaGlnaHBhc3MnLCA1MDAwLCAxLjIpOyB0aGlzLnRvbmUoMTEwLCAwLjMsICdzaW5lJywgMC4yNSwgMS4xNSwgNjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tDaGFyZ2UnOiB0aGlzLnRvbmUoOTAsIDEuMDUsICdzaW5lJywgMC4yNSwgMCwgMjYwLCAwLjIpOyB0aGlzLmhpc3MoMC45NSwgMC4xMiwgJ2xvd3Bhc3MnLCAzMDAsIDAsIDIyMDApOyB0aGlzLnRvbmUoMTgwLCAxLjAsICd0cmlhbmdsZScsIDAuMDYsIDAuMSwgNTIwLCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUaWVyVXAnOiBbNDQwLCA1NTQsIDY1OSwgODgwXS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA2KSk7IHRoaXMudG9uZSgxNzYwLCAwLjYsICdzaW5lJywgMC4wOSwgMC4yKTsgdGhpcy5oaXNzKDAuNCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUZWFyJzogdGhpcy5oaXNzKDAuMzUsIDAuMywgJ2JhbmRwYXNzJywgMTUwMCwgMCwgNjAwMCk7IHRoaXMudG9uZSgxMjAsIDAuNDUsICdzaW5lJywgMC40LCAwLjA1LCA0MCk7IFsxMDQ2LCAxMzE4LCAxNTY4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC42LCAndHJpYW5nbGUnLCAwLjEsIDAuMTIgKyBpICogMC4wNSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tGYW4nOiB0aGlzLmhpc3MoMC41LCAwLjEsICdoaWdocGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNjYwLCAwLjQ1LCAnc2luZScsIDAuMSwgMCwgMTMyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0ZsaXAnOiB0aGlzLmhpc3MoMC4wOCwgMC4xNSwgJ2JhbmRwYXNzJywgMjUwMCk7IHRoaXMudG9uZSg1MDAsIDAuMTIsICdzaW5lJywgMC4xNCwgMCwgODAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrUmFyZSc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzc4NCwgOTg4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40NSwgJ3RyaWFuZ2xlJywgMC4xNCwgMC4wNSArIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0VwaWMnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC43LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wNykpOyB0aGlzLnRvbmUoMTEwLCAwLjUsICdzaW5lJywgMC4zLCAwLCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0xlZ2VuZCc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA4KSk7IHRoaXMudG9uZSg4MiwgMC45LCAnc2luZScsIDAuMzUsIDAsIDUwKTsgdGhpcy5oaXNzKDAuOCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMjA5MywgMC43LCAnc2luZScsIDAuMDcsIDAuNCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NvbGxlY3QnOiBbNjU5LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wOSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3N0YXJ0JzogdGhpcy50b25lKDE0NywgMC45LCAnc2F3dG9vdGgnLCAwLjEzLCAwLCAxNTAsIDAuMTUsIDY1MCk7IHRoaXMudG9uZSgyMjAsIDAuOSwgJ3Nhd3Rvb3RoJywgMC4wOSwgMC4wNSwgMjI0LCAwLjE1LCA2NTApOyB0aGlzLmhpc3MoMC42LCAwLjA2LCAnbG93cGFzcycsIDYwMCk7IGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYXVkaW8gPSBuZXcgQXVkaW9FbmdpbmUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2F1ZGlvID0gYXVkaW87XG5cbi8vIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdG91Y2g6IHRoZSBmaXJzdCB0YXAgYW55d2hlcmUgdW5sb2NrcyBpdC4gRXZlcnkgYnV0dG9uIGFsc28gZ2V0cyBhIHNtYWxsIGNsaWNrLlxuLy8gaU9TIG9ubHkgYWNjZXB0cyBhbiB1bmxvY2sgZnJvbSBhIEZJTklTSEVEIHRhcCAodG91Y2hlbmQgLyBjbGljayksIG5vdCBmcm9tIHRoZSBzdGFydCBvZiBvbmUsIHNvIGxpc3RlbiB0byBhbGwgb2YgdGhlbS5cbmNvbnN0IHVubG9ja09uY2UgPSAoKSA9PiBhdWRpby51bmxvY2soKTtcbmZvciAoY29uc3QgZXYgb2YgWydwb2ludGVyZG93bicsICdwb2ludGVydXAnLCAndG91Y2hlbmQnLCAnY2xpY2snLCAna2V5ZG93biddKSBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKGV2LCB1bmxvY2tPbmNlLCB7IGNhcHR1cmU6IHRydWUgfSk7XG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGNvbnN0IGVsID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsOyBpZiAoZWwgJiYgZWwuY2xvc2VzdCAmJiBlbC5jbG9zZXN0KCdidXR0b24sIGEuYnRuLCAucmFpbCBhJykpIGF1ZGlvLnBsYXkoJ3RhcCcpOyB9LCB0cnVlKTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Zpc2liaWxpdHljaGFuZ2UnLCAoKSA9PiB7IGNvbnN0IGMgPSAoYXVkaW8gYXMgYW55KS5jdHggYXMgQXVkaW9Db250ZXh0IHwgbnVsbDsgaWYgKCFjKSByZXR1cm47IGlmIChkb2N1bWVudC5oaWRkZW4pIGMuc3VzcGVuZCgpOyBlbHNlIGlmIChhdWRpby5tdXNpYyB8fCBhdWRpby5zZngpIGMucmVzdW1lKCk7IH0pO1xud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzLWNoYW5nZWQnLCAoKSA9PiBhdWRpby5yZWxvYWQoKSk7XG4iLCAiLy8gU2F2aW5nIGEgcnVuIGluIHByb2dyZXNzIHNvIGl0IHN1cnZpdmVzIGEgcGFnZSByZWxvYWQgKFNhZmFyaSBvbiBhIHBob25lIGNhbiBkcm9wIHRoZSBwYWdlIGF0IGFueSB0aW1lKS5cbi8vIE9ubHkgY2FsbSBtb21lbnRzIGFyZSBzYXZlZDogdGhlIGJ1aWxkIHBoYXNlIGFuZCB0aGUgdmljdG9yeSBkcmFmdC4gQSBiYXR0bGUgaW4gcHJvZ3Jlc3MgaXMgbm90IHNhdmVkOyByZWxvYWRpbmcgZHVyaW5nIG9uZSBwdXRzIHlvdSBiYWNrXG4vLyBhdCB0aGUgYnVpbGQgc2NyZWVuIHlvdSBwcmVzc2VkIEJhdHRsZSBmcm9tIChub3RoaW5nIGxvc3QsIG5vdGhpbmcgZ2FpbmVkKS4gRXZlcnl0aGluZyByZWFkIGJhY2sgaXMgdmFsaWRhdGVkOyBhbnl0aGluZyBvZGQgaXMgaWdub3JlZC5cblxuaW1wb3J0IHsgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlLCBVbml0IH0gZnJvbSAnLi9ydWxlcy50cyc7XG5pbXBvcnQgeyBicm93c2VyU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5cbmNvbnN0IEtFWSA9ICduZWNyby1ydW4nO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VyaWFsaXplZFN0YXRlIHtcbiAgcnVsZXM6IFJ1bGVzOyBybmc6IHsgc2VlZDogbnVtYmVyOyBwb3M6IG51bWJlciB9O1xuICB3YXZlOiBudW1iZXI7IGhlYXJ0czogbnVtYmVyOyBjYXA6IG51bWJlcjsgaGFuZDogU291bElkW107IHVuaXRzOiBVbml0W107IG5leHRJZDogbnVtYmVyOyBkaXNjYXJkVXNlZDogYm9vbGVhbjtcbiAgc3RhdHVzOiAnYnVpbGRpbmcnOyBsb2c6IHN0cmluZ1tdOyBzdGF0czogU3RhdGVbJ3N0YXRzJ107XG59XG5leHBvcnQgaW50ZXJmYWNlIFJ1blNuYXBzaG90IHsgdjogbnVtYmVyOyBzZWVkOiBudW1iZXI7IGF0dGVtcHQ6IG51bWJlcjsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogc3RyaW5nOyBwaGFzZTogJ2J1aWxkJyB8ICdkcmFmdCc7IGRyYWZ0OiBTb3VsSWRbXSB8IG51bGw7IHN0YXRlOiBTZXJpYWxpemVkU3RhdGU7IHN0YXJ0QmVzdD86IG51bWJlciB9XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXJpYWxpemVTdGF0ZShzOiBTdGF0ZSk6IFNlcmlhbGl6ZWRTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgcnVsZXM6IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocy5ydWxlcykpLCBybmc6IHsgc2VlZDogcy5ybmcuc2VlZCwgcG9zOiBzLnJuZy5zdGF0ZSgpIH0sXG4gICAgd2F2ZTogcy53YXZlLCBoZWFydHM6IHMuaGVhcnRzLCBjYXA6IHMuY2FwLCBoYW5kOiBzLmhhbmQuc2xpY2UoKSwgdW5pdHM6IHMudW5pdHMubWFwKCh1KSA9PiAoeyAuLi51IH0pKSwgbmV4dElkOiBzLm5leHRJZCwgZGlzY2FyZFVzZWQ6IHMuZGlzY2FyZFVzZWQsXG4gICAgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IHMubG9nLnNsaWNlKC00MCksIHN0YXRzOiB7IC4uLnMuc3RhdHMgfSxcbiAgfTtcbn1cblxuY29uc3QgaXNTb3VsID0gKHg6IGFueSk6IHggaXMgU291bElkID0+IFNPVUxTLmluY2x1ZGVzKHgpO1xuY29uc3QgaW50ID0gKHg6IGFueSwgbG86IG51bWJlciwgaGk6IG51bWJlcikgPT4gTnVtYmVyLmlzSW50ZWdlcih4KSAmJiB4ID49IGxvICYmIHggPD0gaGk7XG5cbi8qKiBSZWJ1aWxkIGEgU3RhdGUgZnJvbSBzYXZlZCBkYXRhLCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IGl0IGlzIG5vdCBiZWxpZXZhYmxlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplU3RhdGUoeDogYW55KTogU3RhdGUgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBpZiAoIXggfHwgdHlwZW9mIHggIT09ICdvYmplY3QnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCByID0geC5ydWxlcztcbiAgICBpZiAoIXIgfHwgIUFycmF5LmlzQXJyYXkoci5jdXJ2ZSkgfHwgIXIuY3VydmUubGVuZ3RoIHx8ICFyLmN1cnZlLmV2ZXJ5KChuOiBhbnkpID0+IE51bWJlci5pc0Zpbml0ZShuKSAmJiBuID4gMCkpIHJldHVybiBudWxsO1xuICAgIGlmIChyLm1lcmdlICE9PSAnZGVwbG95ZWRPbmx5JyAmJiByLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIucG9vbCAhPT0gdW5kZWZpbmVkICYmICEoQXJyYXkuaXNBcnJheShyLnBvb2wpICYmIHIucG9vbC5sZW5ndGggJiYgci5wb29sLmV2ZXJ5KGlzU291bCkpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGFnZVdhdmVzID0gci5zdGFnZVdhdmVzID8/IHIuY3VydmUubGVuZ3RoO1xuICAgIGlmICghaW50KHgud2F2ZSwgMSwgTWF0aC5taW4oc3RhZ2VXYXZlcywgci5jdXJ2ZS5sZW5ndGgpKSB8fCAhaW50KHguaGVhcnRzLCAxLCBIRUFSVFMpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5jYXApIHx8IHguY2FwIDw9IDApIHJldHVybiBudWxsO1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh4LmhhbmQpIHx8IHguaGFuZC5sZW5ndGggPiA0MCB8fCAheC5oYW5kLmV2ZXJ5KGlzU291bCkpIHJldHVybiBudWxsO1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh4LnVuaXRzKSB8fCB4LnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIHJldHVybiBudWxsO1xuICAgIGlmICghaW50KHgubmV4dElkLCAxLCAxZTYpIHx8IHR5cGVvZiB4LmRpc2NhcmRVc2VkICE9PSAnYm9vbGVhbicpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNlbGxzID0gbmV3IFNldDxudW1iZXI+KCksIGlkcyA9IG5ldyBTZXQ8bnVtYmVyPigpLCB1bml0czogVW5pdFtdID0gW107XG4gICAgZm9yIChjb25zdCB1IG9mIHgudW5pdHMpIHtcbiAgICAgIGlmICghdSB8fCAhaXNTb3VsKHUuc291bCkgfHwgIWludCh1LnN0YXIsIDEsIE1BWF9TVEFSKSB8fCAhaW50KHUuY2VsbCwgMCwgR1JJRF9DRUxMUyAtIDEpIHx8ICFpbnQodS5pZCwgMSwgeC5uZXh0SWQpIHx8IGNlbGxzLmhhcyh1LmNlbGwpIHx8IGlkcy5oYXModS5pZCkpIHJldHVybiBudWxsO1xuICAgICAgY2VsbHMuYWRkKHUuY2VsbCk7IGlkcy5hZGQodS5pZCk7IHVuaXRzLnB1c2goeyBpZDogdS5pZCwgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCwgZnJlc2g6ICEhdS5mcmVzaCB9KTtcbiAgICB9XG4gICAgY29uc3Qgc3QgPSB4LnN0YXRzO1xuICAgIGlmICghc3QgfHwgIVsnZHJhd24nLCAnZGlzY2FyZGVkJywgJ2Rpc21pc3NlZCcsICdtZXJnZXMnLCAnZmFpbHVyZXMnXS5ldmVyeSgoaykgPT4gTnVtYmVyLmlzRmluaXRlKHN0W2tdKSkpIHJldHVybiBudWxsO1xuICAgIGlmICgheC5ybmcgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnJuZy5zZWVkKSB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnBvcykpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICBydWxlczogciBhcyBSdWxlcywgcm5nOiBtYWtlUm5nKHgucm5nLnNlZWQsIHgucm5nLnBvcyksIHdhdmU6IHgud2F2ZSwgaGVhcnRzOiB4LmhlYXJ0cywgY2FwOiB4LmNhcCwgaGFuZDogeC5oYW5kLnNsaWNlKCksIHVuaXRzLCBuZXh0SWQ6IHgubmV4dElkLFxuICAgICAgZGlzY2FyZFVzZWQ6IHguZGlzY2FyZFVzZWQsIHN0YXR1czogJ2J1aWxkaW5nJywgbG9nOiBBcnJheS5pc0FycmF5KHgubG9nKSA/IHgubG9nLmZpbHRlcigobDogYW55KSA9PiB0eXBlb2YgbCA9PT0gJ3N0cmluZycpLnNsaWNlKC00MCkgOiBbXSxcbiAgICAgIHN0YXRzOiB7IGRyYXduOiBzdC5kcmF3biwgZGlzY2FyZGVkOiBzdC5kaXNjYXJkZWQsIGRpc21pc3NlZDogc3QuZGlzbWlzc2VkLCBtZXJnZXM6IHN0Lm1lcmdlcywgZmFpbHVyZXM6IHN0LmZhaWx1cmVzIH0sXG4gICAgfTtcbiAgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYXZlUnVuKHNuYXA6IFJ1blNuYXBzaG90LCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlKSBzdG9yZS5zZXRJdGVtKEtFWSwgSlNPTi5zdHJpbmdpZnkoc25hcCkpOyB9IGNhdGNoIHsgLyogc3RvcmFnZSBmdWxsIG9yIGJsb2NrZWQ6IHRoZSBydW4ganVzdCB3aWxsIG5vdCBzdXJ2aXZlIGEgcmVsb2FkICovIH1cbn1cbmV4cG9ydCBmdW5jdGlvbiBjbGVhclJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlICYmIChzdG9yZSBhcyBhbnkpLnJlbW92ZUl0ZW0pIChzdG9yZSBhcyBhbnkpLnJlbW92ZUl0ZW0oS0VZKTsgZWxzZSBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCAnJyk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRSdW4oc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogeyBzbmFwOiBSdW5TbmFwc2hvdDsgc3RhdGU6IFN0YXRlIH0gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB0ID0gc3RvcmUgJiYgc3RvcmUuZ2V0SXRlbShLRVkpOyBpZiAoIXQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHggPSBKU09OLnBhcnNlKHQpO1xuICAgIGlmICgheCB8fCB4LnYgIT09IFZFUlNJT04gfHwgKHgucGhhc2UgIT09ICdidWlsZCcgJiYgeC5waGFzZSAhPT0gJ2RyYWZ0JykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5hdHRlbXB0KSB8fCB0eXBlb2YgeC5kaWZmaWN1bHR5ICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgc3RhdGUgPSBkZXNlcmlhbGl6ZVN0YXRlKHguc3RhdGUpOyBpZiAoIXN0YXRlKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBkcmFmdCA9IHgucGhhc2UgPT09ICdkcmFmdCcgJiYgQXJyYXkuaXNBcnJheSh4LmRyYWZ0KSAmJiB4LmRyYWZ0Lmxlbmd0aCA9PT0gMyAmJiB4LmRyYWZ0LmV2ZXJ5KGlzU291bCkgPyB4LmRyYWZ0IDogbnVsbDtcbiAgICByZXR1cm4geyBzbmFwOiB7IHY6IFZFUlNJT04sIHNlZWQ6IHguc2VlZCwgYXR0ZW1wdDogeC5hdHRlbXB0LCBzdGFnZTogdHlwZW9mIHguc3RhZ2UgPT09ICdzdHJpbmcnID8geC5zdGFnZSA6ICdjcnlwdCcsIGRpZmZpY3VsdHk6IHguZGlmZmljdWx0eSwgcGhhc2U6IGRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCcsIGRyYWZ0LCBzdGF0ZTogeC5zdGF0ZSwgc3RhcnRCZXN0OiBOdW1iZXIuaXNJbnRlZ2VyKHguc3RhcnRCZXN0KSAmJiB4LnN0YXJ0QmVzdCA+PSAwICYmIHguc3RhcnRCZXN0IDw9IDk5OTkgPyB4LnN0YXJ0QmVzdCA6IHVuZGVmaW5lZCB9LCBzdGF0ZSB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cbmV4cG9ydCBjb25zdCBSVU5fVkVSU0lPTiA9IFZFUlNJT047XG4iLCAiLy8gUGVybWFuZW50IHByb2dyZXNzaW9uOiBzdGFnZSBjbGVhcnMgLT4gU291bCBQYWNrcyAtPiBjb3BpZXMgLT4gU291bCBsZXZlbHMuIFB1cmUgZnVuY3Rpb25zIHRoYXQgY2hhbmdlIGEgU2F2ZSAodGhlIGNhbGxlciBwZXJzaXN0cyBpdCkuXG4vLyBQbGFjZWhvbGRlciBudW1iZXJzLCBsaWtlIHBhY2tzLnRzLiBJbi1ydW4gc3RhciBtZXJnaW5nIGlzIGEgc2VwYXJhdGUsIHRlbXBvcmFyeSBzeXN0ZW0gYW5kIG5ldmVyIHRvdWNoZXMgYW55IG9mIHRoaXMuXG5cbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19QQUNLX0VWRVJZLCBlbmRsZXNzUGFja1RpZXIgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgTEVWRUxfQ09TVF9NVUxULCBQQUNLX1RJRVJTLCBSQVJJVFlfT0YsIG9wZW5QYWNrIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtLCBQYWNrUmVzdWx0IH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlLCB3cml0ZVNhdmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHsgU1RBR0VTLCBzdGFnZUJ5SWQsIHN0YWdlSW5kZXggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB0eXBlIHsgRGlmZmljdWx0eSwgU2F2ZSwgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5leHBvcnQgY29uc3QgTUFYX1BBQ0tTID0gOTk7XG5cbi8qKiBXaGVyZSBwYWNrcyBjb21lIGZyb20uIFBMQUNFSE9MREVSLiBGaXJzdCBjbGVhciBvZiBhIHN0YWdlIG9uIGVhY2ggZGlmZmljdWx0eSBnaXZlcyBvbmUgaW1wcm92ZWQgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgYSBtZXRlci4gKi9cbmV4cG9ydCBjb25zdCBSRVdBUkRTID0ge1xuICBmaXJzdENsZWFyVGllcjogeyBlYXN5OiAxLCBub3JtYWw6IDIsIGhhcmQ6IDIsIG5pZ2h0bWFyZTogMyB9IGFzIFJlY29yZDxEaWZmaWN1bHR5LCBudW1iZXI+LFxuICByZXBsYXlUaWVyOiAxLFxuICByZXBsYXlDbGVhcnNQZXJQYWNrOiAyLFxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGxldmVsc1xuZXhwb3J0IGNvbnN0IG1heExldmVsID0gKCk6IG51bWJlciA9PiBCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWwubGVuZ3RoICsgMTtcbmV4cG9ydCBjb25zdCBpc01heExldmVsID0gKGxldmVsOiBudW1iZXIpOiBib29sZWFuID0+IGxldmVsID49IG1heExldmVsKCk7XG4vKiogQ29waWVzIG5lZWRlZCB0byB0YWtlIGBzb3VsYCBmcm9tIGBsZXZlbGAgdG8gdGhlIG5leHQgb25lICgwIHdoZW4gYWxyZWFkeSBtYXgpLiBSYXJlciBTb3VscyBuZWVkIGZld2VyLiAqL1xuZXhwb3J0IGNvbnN0IGNvcGllc05lZWRlZCA9IChsZXZlbDogbnVtYmVyLCBzb3VsOiBTb3VsSWQpOiBudW1iZXIgPT4gKGlzTWF4TGV2ZWwobGV2ZWwpID8gMCA6IE1hdGgubWF4KDEsIE1hdGgucm91bmQoQkFMQU5DRS5sZXZlbC5jb3BpZXNUb0xldmVsW2xldmVsIC0gMV0gKiBMRVZFTF9DT1NUX01VTFRbUkFSSVRZX09GW3NvdWxdXSkpKTtcbi8qKlxuICogT25lIHJlcXVpcmVtZW50IG9mIGFuIHVwZ3JhZGUuIFRvZGF5IG9ubHkgY29waWVzOyB0aGUgY29uZmlybSBwb3B1cCBsaXN0cyBldmVyeSBlbnRyeSB3aXRoIGhhdmUgLyBuZWVkLCBhbmQgQ29uZmlybSBpcyBhbGxvd2VkIG9ubHkgd2hlbiBhbGwgYXJlIG1ldC5cbiAqIEdvbGQgd2lsbCBzaW1wbHkgYmVjb21lIGEgc2Vjb25kIGVudHJ5IGhlcmUgKHsgaWQ6ICdnb2xkJywgLi4uIH0pIGFuZCBiZSBzcGVudCBpbiBsZXZlbFVwKCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBncmFkZUNvc3QgeyBpZDogJ2NvcGllcyc7IGxhYmVsOiBzdHJpbmc7IGhhdmU6IG51bWJlcjsgbmVlZDogbnVtYmVyOyBvazogYm9vbGVhbiB9XG5leHBvcnQgZnVuY3Rpb24gdXBncmFkZUNvc3RzKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IFVwZ3JhZGVDb3N0W10ge1xuICBjb25zdCBwID0gc2F2ZS5zb3Vsc1tzb3VsXTsgaWYgKGlzTWF4TGV2ZWwocC5sZXZlbCkpIHJldHVybiBbXTtcbiAgY29uc3QgbmVlZCA9IGNvcGllc05lZWRlZChwLmxldmVsLCBzb3VsKTtcbiAgcmV0dXJuIFt7IGlkOiAnY29waWVzJywgbGFiZWw6ICdDb3BpZXMnLCBoYXZlOiBwLmNvcGllcywgbmVlZCwgb2s6IHAuY29waWVzID49IG5lZWQgfV07XG59XG5leHBvcnQgY29uc3QgY2FuQWZmb3JkID0gKGNvc3RzOiBVcGdyYWRlQ29zdFtdKTogYm9vbGVhbiA9PiBjb3N0cy5sZW5ndGggPiAwICYmIGNvc3RzLmV2ZXJ5KChjKSA9PiBjLm9rKTtcbmV4cG9ydCBjb25zdCBjYW5MZXZlbFVwID0gKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4gPT4gY2FuQWZmb3JkKHVwZ3JhZGVDb3N0cyhzYXZlLCBzb3VsKSk7XG4vKiogUGF5IGV2ZXJ5IGNvc3QgYW5kIGdhaW4gYSBsZXZlbC4gUmV0dXJucyBmYWxzZSAoYW5kIGNoYW5nZXMgbm90aGluZykgaWYgdGhlIFNvdWwgaXMgbm90IHJlYWR5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxldmVsVXAoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogYm9vbGVhbiB7XG4gIGNvbnN0IGNvc3RzID0gdXBncmFkZUNvc3RzKHNhdmUsIHNvdWwpOyBpZiAoIWNhbkFmZm9yZChjb3N0cykpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IGZvciAoY29uc3QgYyBvZiBjb3N0cykgaWYgKGMuaWQgPT09ICdjb3BpZXMnKSBwLmNvcGllcyAtPSBjLm5lZWQ7XG4gIHAubGV2ZWwrKzsgcmV0dXJuIHRydWU7XG59XG4vKiogRGVidWdnaW5nOiBwdXQgZXZlcnkgU291bCBiYWNrIHRvIGxldmVsIDEgKGNvcGllcyBhcmUga2VwdCkuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRMZXZlbHMoc2F2ZTogU2F2ZSk6IHZvaWQgeyBmb3IgKGNvbnN0IGsgb2YgU09VTFMpIHNhdmUuc291bHNba10ubGV2ZWwgPSAxOyB9XG4vKiogRGVidWdnaW5nOiBmb3JnZXQgYWxsIGNvbGxlY3RlZCBjb3BpZXMgKGxldmVscyBhcmUga2VwdCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJDb3BpZXMoc2F2ZTogU2F2ZSk6IHZvaWQgeyBmb3IgKGNvbnN0IGsgb2YgU09VTFMpIHNhdmUuc291bHNba10uY29waWVzID0gMDsgfVxuLyoqIE11bHRpcGxpZXIgYXBwbGllZCB0byBhIFNvdWwncyBoZWFsdGgvZGFtYWdlIGZyb20gaXRzIHBlcm1hbmVudCBsZXZlbCAobGV2ZWwgMSA9IDEuMCkuICovXG5leHBvcnQgY29uc3QgbGV2ZWxNdWx0ID0gKGxldmVsOiBudW1iZXIsIHN0YXQ6ICdocCcgfCAnZG1nJyk6IG51bWJlciA9PiAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQkFMQU5DRS5sZXZlbFtzdGF0XTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBhY2tzXG5leHBvcnQgZnVuY3Rpb24gZ3JhbnRQYWNrKHNhdmU6IFNhdmUsIHRpZXI6IG51bWJlciwgc291cmNlOiBzdHJpbmcpOiBQYWNrSXRlbSB8IG51bGwge1xuICBpZiAoc2F2ZS5wYWNrcy5sZW5ndGggPj0gTUFYX1BBQ0tTKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGFjazogUGFja0l0ZW0gPSB7IGlkOiBzYXZlLm5leHRQYWNrSWQrKywgdGllcjogTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcih0aWVyKSkpLCBzb3VyY2UgfTtcbiAgc2F2ZS5wYWNrcy5wdXNoKHBhY2spOyByZXR1cm4gcGFjaztcbn1cblxuLyoqIE9wZW4gYW4gb3duZWQgcGFjazogaXQgaXMgcmVtb3ZlZCBhbmQgaXRzIGNvcGllcyBhcmUgYWRkZWQgdG8gdGhlIFNvdWxzIGltbWVkaWF0ZWx5IChzbyBub3RoaW5nIGlzIGxvc3QgaWYgdGhlIHBhZ2UgY2xvc2VzIG1pZC1hbmltYXRpb24pLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5Pd25lZFBhY2soc2F2ZTogU2F2ZSwgcGFja0lkOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB8IG51bGwge1xuICBjb25zdCBpID0gc2F2ZS5wYWNrcy5maW5kSW5kZXgoKHApID0+IHAuaWQgPT09IHBhY2tJZCk7IGlmIChpIDwgMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhY2sgPSBzYXZlLnBhY2tzW2ldOyBzYXZlLnBhY2tzLnNwbGljZShpLCAxKTtcbiAgY29uc3QgcmVzdWx0ID0gb3BlblBhY2socGFjay50aWVyLCBybmcpO1xuICBmb3IgKGNvbnN0IHIgb2YgcmVzdWx0LnJldmVhbHMpIHNhdmUuc291bHNbci5zb3VsXS5jb3BpZXMgKz0gci5jb3BpZXM7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xlYXJSZXdhcmQgeyBmaXJzdDogYm9vbGVhbjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyByZXBsYXlNZXRlcjogbnVtYmVyOyByZXBsYXlOZWVkZWQ6IG51bWJlcjsgdW5sb2NrZWQ6IHN0cmluZ1tdIH1cbi8qKiBBIHN0YWdlIHdhcyBjbGVhcmVkIG9uIGBkaWZmaWN1bHR5YC4gVGhlIGZpcnN0IGNsZWFyIG9uIHRoYXQgZGlmZmljdWx0eSBncmFudHMgYSBiZXR0ZXIgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgdGhlIHJlcGxheSBtZXRlci4gKi9cbmZ1bmN0aW9uIHJlY29yZENsZWFyQmFzZShzYXZlOiBTYXZlLCBzdGFnZUlkOiBzdHJpbmcsIGRpZmZpY3VsdHk6IERpZmZpY3VsdHkpOiBPbWl0PENsZWFyUmV3YXJkLCAndW5sb2NrZWQnPiB7XG4gIGNvbnN0IGtleSA9IHN0YWdlSWQgKyAnOicgKyBkaWZmaWN1bHR5LCBiZWZvcmUgPSBzYXZlLmNsZWFyc1trZXldID8/IDA7XG4gIHNhdmUuY2xlYXJzW2tleV0gPSBiZWZvcmUgKyAxO1xuICBpZiAoYmVmb3JlID09PSAwKSByZXR1cm4geyBmaXJzdDogdHJ1ZSwgcGFjazogZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMuZmlyc3RDbGVhclRpZXJbZGlmZmljdWx0eV0sICdGaXJzdCBjbGVhciBcdTAwQjcgJyArIGRpZmZpY3VsdHkpLCByZXBsYXlNZXRlcjogc2F2ZS5yZXBsYXlNZXRlciwgcmVwbGF5TmVlZGVkOiBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2sgfTtcbiAgc2F2ZS5yZXBsYXlNZXRlcisrO1xuICBsZXQgcGFjazogUGFja0l0ZW0gfCBudWxsID0gbnVsbDtcbiAgaWYgKHNhdmUucmVwbGF5TWV0ZXIgPj0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrKSB7IHNhdmUucmVwbGF5TWV0ZXIgLT0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrOyBwYWNrID0gZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMucmVwbGF5VGllciwgJ1JlcGxheSByZXdhcmQnKTsgfVxuICByZXR1cm4geyBmaXJzdDogZmFsc2UsIHBhY2ssIHJlcGxheU1ldGVyOiBzYXZlLnJlcGxheU1ldGVyLCByZXBsYXlOZWVkZWQ6IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjayB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyc2lzdGVkIHdyYXBwZXJzICh1c2VkIGJ5IHRoZSBnYW1lIGJ1bmRsZSlcbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRDbGVhckFuZFNhdmUoc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5LCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZENsZWFyKHMsIHN0YWdlSWQsIGRpZmZpY3VsdHkpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEVuZGxlc3MgRGVwdGhzXG5leHBvcnQgaW50ZXJmYWNlIEVuZGxlc3NSZXdhcmQgeyB3YXZlOiBudW1iZXI7IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgbmV3QmVzdDogYm9vbGVhbiB9XG4vKiogV2F2ZSBgd2F2ZWAgb2YgYW4gZW5kbGVzcyBydW4gd2FzIGNsZWFyZWQ6IGEgcGFjayBvbiBldmVyeSAxMHRoIHdhdmUgKGJldHRlciB0aWVycyBkZWVwZXIpLCBhbmQgdGhlIGJlc3QgZGVwdGggaXMgcmVtZW1iZXJlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFbmRsZXNzV2F2ZShzYXZlOiBTYXZlLCB3YXZlOiBudW1iZXIpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgbmV3QmVzdCA9IHdhdmUgPiBzYXZlLmVuZGxlc3MuYmVzdDsgaWYgKG5ld0Jlc3QpIHNhdmUuZW5kbGVzcy5iZXN0ID0gd2F2ZTtcbiAgY29uc3QgcGFjayA9IHdhdmUgPiAwICYmIHdhdmUgJSBFTkRMRVNTX1BBQ0tfRVZFUlkgPT09IDAgPyBncmFudFBhY2soc2F2ZSwgZW5kbGVzc1BhY2tUaWVyKHdhdmUpLCAnRW5kbGVzcyBcdTAwQjcgd2F2ZSAnICsgd2F2ZSkgOiBudWxsO1xuICByZXR1cm4geyB3YXZlLCBwYWNrLCBuZXdCZXN0IH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlKHdhdmU6IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZEVuZGxlc3NXYXZlKHMsIHdhdmUpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cbi8qKiBFbmRsZXNzIERlcHRocyBvcGVucyBvbmNlIHRoZSBsYXN0IGNhbXBhaWduIHN0YWdlIGhhcyBiZWVuIGNsZWFyZWQgb24gTm9ybWFsLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NVbmxvY2tlZCA9IChzYXZlOiBTYXZlKTogYm9vbGVhbiA9PiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tTVEFHRVMubGVuZ3RoIC0gMV0uaWQsICdub3JtYWwnKSA+IDA7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB1bmxvY2sgcnVsZXNcbi8vIEVhc3kgYW5kIE5vcm1hbCBhcmUgb3BlbiBvbiBldmVyeSB1bmxvY2tlZCBzdGFnZS4gQ2xlYXJpbmcgTm9ybWFsIG9wZW5zIEhhcmQgb24gdGhhdCBzdGFnZSBBTkQgdW5sb2NrcyB0aGUgbmV4dCBzdGFnZS4gQ2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5leHBvcnQgY29uc3QgY2xlYXJDb3VudCA9IChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogbnVtYmVyID0+IHNhdmUuY2xlYXJzW3N0YWdlICsgJzonICsgZF0gPz8gMDtcbmV4cG9ydCBmdW5jdGlvbiBzdGFnZVVubG9ja2VkKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBib29sZWFuIHsgcmV0dXJuIGluZGV4IDw9IDAgfHwgKGluZGV4IDwgU1RBR0VTLmxlbmd0aCAmJiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tpbmRleCAtIDFdLmlkLCAnbm9ybWFsJykgPiAwKTsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogYm9vbGVhbiB7XG4gIGNvbnN0IGlkeCA9IFNUQUdFUy5maW5kSW5kZXgoKHMpID0+IHMuaWQgPT09IHN0YWdlKTsgaWYgKGlkeCA8IDAgfHwgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZCA9PT0gJ2Vhc3knIHx8IGQgPT09ICdub3JtYWwnKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIGQgPT09ICdoYXJkJyA/IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdub3JtYWwnKSA+IDAgOiBjbGVhckNvdW50KHNhdmUsIHN0YWdlLCAnaGFyZCcpID4gMDtcbn1cbi8qKiBXaHkgYSBzdGFnZSBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhZ2VMb2NrUmVhc29uKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBzdHJpbmcgeyByZXR1cm4gc3RhZ2VVbmxvY2tlZChzYXZlLCBpbmRleCkgPyAnJyA6ICdDbGVhciAnICsgU1RBR0VTW2luZGV4IC0gMV0ubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jay4nOyB9XG4vKiogV2h5IGEgdGllciBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgc3RhZ2U6IHN0cmluZywgZDogRGlmZmljdWx0eSk6IHN0cmluZyB7XG4gIGlmIChkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIGQpKSByZXR1cm4gJyc7XG4gIGNvbnN0IGlkeCA9IHN0YWdlSW5kZXgoc3RhZ2UpOyBpZiAoIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIHN0YWdlTG9ja1JlYXNvbihzYXZlLCBpZHgpO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIE5vcm1hbCB0byB1bmxvY2sgSGFyZC4nIDogJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIEhhcmQgdG8gdW5sb2NrIE5pZ2h0bWFyZS4nO1xufVxuLyoqIFdoYXRldmVyIHdhcyBzYXZlZCwgbWFrZSBpdCBhIHN0YWdlIGFuZCB0aWVyIHRoZSBwbGF5ZXIgbWF5IGFjdHVhbGx5IHBsYXkuICovXG5leHBvcnQgZnVuY3Rpb24gcGxheWFibGUoc2F2ZTogU2F2ZSk6IHsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogRGlmZmljdWx0eSB9IHtcbiAgbGV0IGlkeCA9IHN0YWdlSW5kZXgoc2F2ZS5zdGFnZSk7IHdoaWxlIChpZHggPiAwICYmICFzdGFnZVVubG9ja2VkKHNhdmUsIGlkeCkpIGlkeC0tO1xuICBjb25zdCBzdGFnZSA9IFNUQUdFU1tpZHhdLmlkO1xuICByZXR1cm4geyBzdGFnZSwgZGlmZmljdWx0eTogZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0YWdlLCBzYXZlLmRpZmZpY3VsdHkpID8gc2F2ZS5kaWZmaWN1bHR5IDogJ25vcm1hbCcgfTtcbn1cblxuLyoqIEV2ZXJ5IHVubG9jayB0aGUgcGxheWVyIG1heSBiZSBjZWxlYnJhdGVkIGZvcjogbGF0ZXIgc3RhZ2VzIGFuZCB0aGUgSGFyZCAvIE5pZ2h0bWFyZSB0aWVycyAoRWFzeSwgTm9ybWFsIGFuZCBTdGFnZSAxIGFyZSBvcGVuIGZyb20gdGhlIHN0YXJ0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmxvY2tlZEtleXMoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qga2V5czogc3RyaW5nW10gPSBbXTtcbiAgU1RBR0VTLmZvckVhY2goKHN0LCBpKSA9PiB7XG4gICAgaWYgKGkgPiAwICYmIHN0YWdlVW5sb2NrZWQoc2F2ZSwgaSkpIGtleXMucHVzaCgnc3RhZ2U6JyArIHN0LmlkKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgWydoYXJkJywgJ25pZ2h0bWFyZSddIGFzIERpZmZpY3VsdHlbXSkgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdC5pZCwgZCkpIGtleXMucHVzaCgndGllcjonICsgc3QuaWQgKyAnOicgKyBkKTtcbiAgfSk7XG4gIGlmIChlbmRsZXNzVW5sb2NrZWQoc2F2ZSkpIGtleXMucHVzaCgnZW5kbGVzcycpO1xuICByZXR1cm4ga2V5cztcbn1cbi8qKiBVbmxvY2tzIG5vdCB5ZXQgY2VsZWJyYXRlZC4gKi9cbmV4cG9ydCBjb25zdCBuZXdVbmxvY2tzID0gKHNhdmU6IFNhdmUpOiBzdHJpbmdbXSA9PiB1bmxvY2tlZEtleXMoc2F2ZSkuZmlsdGVyKChrKSA9PiAhKHNhdmUuc2VlbiA/PyBbXSkuaW5jbHVkZXMoaykpO1xuY29uc3QgVElFUl9OQU1FOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBoYXJkOiAnSGFyZCBtb2RlJywgbmlnaHRtYXJlOiAnTmlnaHRtYXJlIG1vZGUnIH07XG4vKiogV29yZHMgZm9yIGFuIHVubG9jayBrZXksIGZvciBiYW5uZXJzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlVW5sb2NrKGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGtleSA9PT0gJ2VuZGxlc3MnKSByZXR1cm4gJ0VuZGxlc3MgRGVwdGhzIChuZXcgbW9kZSknO1xuICBjb25zdCBba2luZCwgc3RhZ2UsIHRpZXJdID0ga2V5LnNwbGl0KCc6Jyk7XG4gIGlmIChraW5kID09PSAnc3RhZ2UnKSByZXR1cm4gc3RhZ2VCeUlkKHN0YWdlKS5uYW1lICsgJyAobmV3IHN0YWdlKSc7XG4gIHJldHVybiAoVElFUl9OQU1FW3RpZXJdID8/IHRpZXIpICsgJyBvbiAnICsgc3RhZ2VCeUlkKHN0YWdlKS5uYW1lO1xufVxuLyoqIENsZWFyaW5nIGEgc3RhZ2U6IHJld2FyZHMsIGFuZCB3aGljaCB1bmxvY2tzIHRoaXMgY2xlYXIgb3BlbmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgYmVmb3JlID0gdW5sb2NrZWRLZXlzKHNhdmUpLCByID0gcmVjb3JkQ2xlYXJCYXNlKHNhdmUsIHN0YWdlSWQsIGRpZmZpY3VsdHkpO1xuICByZXR1cm4geyAuLi5yLCB1bmxvY2tlZDogdW5sb2NrZWRLZXlzKHNhdmUpLmZpbHRlcigoaykgPT4gIWJlZm9yZS5pbmNsdWRlcyhrKSkgfTtcbn1cbiIsICIvLyBFdmVyeXRoaW5nIHlvdSBTRUUgZm9yIGEgdW5pdDogcmVhbCBUcmlwbyBtb2RlbHMgKFNrZWxldG9uIFdhcnJpb3IsIFNrZWxldG9uIEFyY2hlciksIHNpbXBsZSBzdGFuZC1pbnMgZm9yIHRoZSBmb3VyXG4vLyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBnZW5lcmF0ZWQgeWV0LCBhbmQgdGhlIFwic3RhciBsb29rXCIgbGF5ZXJlZCBvbiB0b3Agb2YgYm90aCAoc2l6ZSwgdGludCwgYXVyYSwgaGFsbywgYmFkZ2UpLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcblxuZXhwb3J0IHR5cGUgVlN0YXRlID0gJ2lkbGUnIHwgJ3J1bicgfCAnYXR0YWNrJyB8ICdkZWF0aCcgfCAnc3Bhd24nIHwgJ2NoZWVyJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uICsgeWF3IGhlcmVcbiAgdGVhbTogMCB8IDE7IHN0YXI6IG51bWJlcjsgc3RhdGU6IFZTdGF0ZTsgdG9wOiBudW1iZXI7XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQ/OiBudW1iZXIpOiB2b2lkO1xuICBzZXRTdGFyKHN0YXI6IG51bWJlcik6IHZvaWQ7XG4gIHNldFRlYW0odGVhbTogMCB8IDEpOiB2b2lkO1xuICBzZXRIcChmcmFjOiBudW1iZXIgfCBudWxsKTogdm9pZDsgIC8vIG51bGwgaGlkZXMgdGhlIGhlYWx0aCBiYXJcbiAgc2V0TWFuYShmcmFjOiBudW1iZXIgfCBudWxsKTogdm9pZDsgLy8gbnVsbCBoaWRlcyB0aGUgbWFuYSBiYXIgKHVuaXRzIHdpdGhvdXQgYSBza2lsbClcbiAgcHVsc2UoKTogdm9pZDsgICAgICAgICAgICAgICAgICAgICAvLyBicmllZiBoaXQgcmVhY3Rpb25cbiAgdXBkYXRlKGR0OiBudW1iZXIpOiB2b2lkO1xuICBkaXNwb3NlKCk6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhciBsb29rc1xuLy8gMSBzdGFyID0gdGhlIHBsYWluIG1vZGVsLiAyIHN0YXJzID0gYSBsaXR0bGUgYmlnZ2VyLCBjb29sIHNpbHZlci1ibHVlIHRpbnQsIGJyaWdodGVyIGF1cmEuIDMgc3RhcnMgPSBiaWdnZXN0LCB3YXJtIGdvbGQgdGludCxcbi8vIHN0cm9uZyBnb2xkLXZpb2xldCBhdXJhIGFuZCBhIGZsb2F0aW5nIGdvbGQgaGFsby4gRXZlcnl0aGluZyBoZXJlIGlzIGZyZWU6IG5vIGV4dHJhIFRyaXBvIGdlbmVyYXRpb25zLlxuY29uc3QgVElOVDogbnVtYmVyW11bXSA9IFtbMSwgMSwgMV0sIFswLjg2LCAwLjk1LCAxLjE4XSwgWzEuMjUsIDEuMSwgMC43XV07XG5jb25zdCBBVVJBID0gW1xuICB7IHJhdGU6IDE0LCBtaW46IDAuMDYsIG1heDogMC4xNiwgYzE6IFswLjc4LCAwLjM1LCAxLCAwLjddLCBjMjogWzAuNDUsIDAuMTUsIDAuOSwgMC41XSB9LFxuICB7IHJhdGU6IDI2LCBtaW46IDAuMDgsIG1heDogMC4yMCwgYzE6IFswLjg1LCAwLjY1LCAxLCAwLjhdLCBjMjogWzAuNTUsIDAuNCwgMSwgMC42XSB9LFxuICB7IHJhdGU6IDQ0LCBtaW46IDAuMTAsIG1heDogMC4yNiwgYzE6IFsxLCAwLjg1LCAwLjQsIDAuODVdLCBjMjogWzAuOCwgMC4zLCAxLCAwLjddIH0sXG5dO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFzc2V0cyB7XG4gIHNjZW5lOiBhbnk7IHNvZnQ6IGFueTsgc3RhclRleDogYW55W107IHRyaXBvOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIFRyaXBvQ2ZnPj47IGVtb3RlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICByaW5nTWF0OiBhbnlbXTsgaGFsb01hdDogYW55OyBiYXJCZzogYW55OyBiYXJGaWxsOiBhbnlbXTsgbWFuYUZpbGw6IGFueTtcbn1cbi8qKiBGbGF2b3VyIGEgdW5pdCBjYW4gaGF2ZTogYSBjbGlwIGl0IHBsYXlzIG5vdyBhbmQgdGhlbiB3aGVuIGl0IGhhcyBzdG9vZCBpZGxlIGZvciBhIHdoaWxlLCBhIHNtYWxsIGVtb3RlLCBhbmQgYW4gZXllLWdsb3cgbWFzayAoZXllcyBkaW0gd2hlbiBzbGVlcHksIGZsYXJlIHdoZW4gaXQgZmlnaHRzKS4gKi9cbmludGVyZmFjZSBQb3NlIHsgY2xpcDogc3RyaW5nOyBlbW90ZT86IHN0cmluZyB9XG5pbnRlcmZhY2UgRmxhdm9yIHsgY2xpcHM6IFBvc2VbXTsgbWluOiBudW1iZXI7IG1heDogbnVtYmVyIH1cbmludGVyZmFjZSBUcmlwb0NmZyB7IGNvbnRhaW5lcjogYW55OyBlbmVteVRleDogYW55OyBjbGlwczogUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPjsgbWF0Q2FjaGU6IFJlY29yZDxzdHJpbmcsIGFueT47IGJhc2VNYXQ/OiBhbnk7IHRvcDogbnVtYmVyOyBzY2FsZTogbnVtYmVyOyBmbGF2b3I/OiBGbGF2b3I7IGNoZWVycz86IFBvc2VbXTsgc3Bhd25FbW90ZT86IHN0cmluZzsgZXllcz86IHN0cmluZzsgZXllVGV4PzogYW55OyBzdGFyU2NhbGU/OiBudW1iZXJbXSB9XG5cbmZ1bmN0aW9uIGR5bihzY2VuZTogYW55LCB3OiBudW1iZXIsIGg6IG51bWJlciwgZHJhdzogKGM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCkgPT4gdm9pZCwgYWxwaGEgPSB0cnVlKSB7XG4gIGNvbnN0IHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnZHQnLCB7IHdpZHRoOiB3LCBoZWlnaHQ6IGggfSwgc2NlbmUsIHRydWUpOyBkcmF3KHQuZ2V0Q29udGV4dCgpKTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IGFscGhhOyByZXR1cm4gdDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRBc3NldHMoc2NlbmU6IGFueSk6IFByb21pc2U8QXNzZXRzPiB7XG4gIGNvbnN0IHNvZnQgPSBkeW4oc2NlbmUsIDY0LCA2NCwgKGMpID0+IHsgY29uc3QgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwuNTUpJyk7IGcuYWRkQ29sb3JTdG9wKDEsICdyZ2JhKDI1NSwyNTUsMjU1LDApJyk7IGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCA2NCwgNjQpOyB9KTtcbiAgY29uc3Qgc3RhclRleCA9IFsxLCAyLCAzXS5tYXAoKG4pID0+IGR5bihzY2VuZSwgMTkyLCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgNDBweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVN0eWxlID0gJyMxYTEwMjAnOyBjLmZpbGxTdHlsZSA9IG4gPT09IDMgPyAnI2ZmZDI0YScgOiBuID09PSAyID8gJyNkN2U2ZmYnIDogJyNmMGQ5YTAnOyBjb25zdCBzID0gJ1x1MjYwNScucmVwZWF0KG4pOyBjLnN0cm9rZVRleHQocywgOTYsIDM4KTsgYy5maWxsVGV4dChzLCA5NiwgMzgpOyB9KSk7XG4gIGNvbnN0IGVtaXNzaXZlID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdlbScsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IGE7IHJldHVybiBtOyB9O1xuICBjb25zdCBBOiBBc3NldHMgPSB7XG4gICAgc2NlbmUsIHNvZnQsIHN0YXJUZXgsIHRyaXBvOiB7fSwgZW1vdGU6IHt9LCByaW5nTWF0OiBbZW1pc3NpdmUoMC41NSwgMC4yLCAwLjk1LCAwLjkpLCBlbWlzc2l2ZSgwLjk1LCAwLjI1LCAwLjIsIDAuOSldLCBoYWxvTWF0OiBlbWlzc2l2ZSgxLCAwLjgyLCAwLjMsIDAuOTUpLFxuICAgIGJhckJnOiBlbWlzc2l2ZSgwLjA1LCAwLjA1LCAwLjA4LCAwLjcpLCBiYXJGaWxsOiBbZW1pc3NpdmUoMC41NSwgMC4zNSwgMSksIGVtaXNzaXZlKDEsIDAuNCwgMC4zKV0sIG1hbmFGaWxsOiBlbWlzc2l2ZSgwLjI1LCAwLjc1LCAxKSxcbiAgfTtcbiAgLy8gXCJaenpcIiB0aGF0IGZsb2F0cyB1cCBvdmVyIGEgc2xlZXB5IHVuaXRcbiAgY29uc3Qgenp6ID0gZHluKHNjZW5lLCAxMjgsIDEyOCwgKGMpID0+IHsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA5OyBjLnN0cm9rZVN0eWxlID0gJyMxNTBkMjYnOyBjLmZpbGxTdHlsZSA9ICcjZThkOGZmJzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7XG4gICAgZm9yIChjb25zdCBbY2gsIHNpemUsIHgsIHldIG9mIFtbJ1onLCA2NCwgMzQsIDEwMF0sIFsneicsIDQ4LCA3NCwgNjZdLCBbJ3onLCAzNCwgMTA0LCAzOF1dIGFzIFtzdHJpbmcsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdW10pIHsgYy5mb250ID0gJ2l0YWxpYyA5MDAgJyArIHNpemUgKyAncHggc2Fucy1zZXJpZic7IGMuc3Ryb2tlVGV4dChjaCwgeCwgeSk7IGMuZmlsbFRleHQoY2gsIHgsIHkpOyB9IH0pO1xuICBjb25zdCB6bSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3p6eicsIHNjZW5lKTsgem0uZGlmZnVzZVRleHR1cmUgPSB6eno7IHptLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgem0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IHptLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHptLmJhY2tGYWNlQ3VsbGluZyA9IGZhbHNlOyBBLmVtb3RlWyd6enonXSA9IHptO1xuICBjb25zdCBpY29uID0gKG5hbWU6IHN0cmluZywgZHJhdzogKGM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCkgPT4gdm9pZCkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbChuYW1lLCBzY2VuZSk7IG0uZGlmZnVzZVRleHR1cmUgPSBkeW4oc2NlbmUsIDEyOCwgMTI4LCBkcmF3KTsgbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgQS5lbW90ZVtuYW1lXSA9IG07IH07XG4gIGNvbnN0IGdseXBoID0gKGNoOiBzdHJpbmcsIGZpbGw6IHN0cmluZykgPT4gKGM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCkgPT4geyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDEyOyBjLnN0cm9rZVN0eWxlID0gJyMxNTBkMjYnOyBjLmxpbmVKb2luID0gJ3JvdW5kJzsgYy5maWxsU3R5bGUgPSBmaWxsOyBjLmZvbnQgPSAnOTAwIDEwNHB4IHNhbnMtc2VyaWYnOyBjLnN0cm9rZVRleHQoY2gsIDY0LCAxMDApOyBjLmZpbGxUZXh0KGNoLCA2NCwgMTAwKTsgfTtcbiAgaWNvbignPycsIGdseXBoKCc/JywgJyNmZmUyN2EnKSk7IGljb24oJyEnLCBnbHlwaCgnIScsICcjZmY5YTdhJykpO1xuICBpY29uKCdzd2VhdCcsIChjKSA9PiB7IGMubGluZVdpZHRoID0gODsgYy5zdHJva2VTdHlsZSA9ICcjMTUzMDRhJzsgYy5maWxsU3R5bGUgPSAnIzlmZTRmZic7IGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKDY0LCAxNCk7IGMuYmV6aWVyQ3VydmVUbygxMDQsIDYyLCAxMDQsIDEwOCwgNjQsIDExMik7IGMuYmV6aWVyQ3VydmVUbygyNCwgMTA4LCAyNCwgNjIsIDY0LCAxNCk7IGMuY2xvc2VQYXRoKCk7IGMuc3Ryb2tlKCk7IGMuZmlsbCgpOyB9KTtcbiAgaWNvbignc3BhcmtsZScsIChjKSA9PiB7IGMubGluZVdpZHRoID0gNzsgYy5zdHJva2VTdHlsZSA9ICcjM2EyYTA1JzsgYy5maWxsU3R5bGUgPSAnI2ZmZjJhOCc7IGNvbnN0IHN0YXIgPSAoeDogbnVtYmVyLCB5OiBudW1iZXIsIHI6IG51bWJlcikgPT4geyBjLmJlZ2luUGF0aCgpOyBmb3IgKGxldCBpID0gMDsgaSA8IDg7IGkrKykgeyBjb25zdCBhID0gaSAqIE1hdGguUEkgLyA0LCByciA9IGkgJSAyID8gciAqIDAuMjggOiByOyBjLmxpbmVUbyh4ICsgTWF0aC5zaW4oYSkgKiByciwgeSAtIE1hdGguY29zKGEpICogcnIpOyB9IGMuY2xvc2VQYXRoKCk7IGMuc3Ryb2tlKCk7IGMuZmlsbCgpOyB9OyBzdGFyKDU2LCA3MCwgNTApOyBzdGFyKDEwMiwgMjgsIDIwKTsgc3RhcigyNiwgMjQsIDE0KTsgfSk7XG4gIGNvbnN0IGRlZnM6IFtTb3VsSWQsIHN0cmluZywgc3RyaW5nLCBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+LCBudW1iZXIsIG51bWJlciwgYW55P11bXSA9IFtcbiAgICBbJ3dhcnJpb3InLCAnU2tlbGV0b25XYXJyaW9yLmdsYicsICdTa2VsZXRvbldhcnJpb3JfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wNSwgMS4wLCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1RyaXAnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0JvbmsnLCBlbW90ZTogJz8nIH0sIHsgY2xpcDogJ1dvYmJsZScsIGVtb3RlOiAnc3dlYXQnIH0sIHsgY2xpcDogJ1dhdmUnLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1dhdmUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1RyaXAnLCBlbW90ZTogJyEnIH1dLCBleWVzOiAnU2tlbGV0b25XYXJyaW9yX2V5ZXMucG5nJyB9XSxcbiAgICBbJ2FyY2hlcicsICdTa2VsZXRvbkFyY2hlci5nbGInLCAnU2tlbGV0b25BcmNoZXJfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ1Nob290JywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0ZsZXgnIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdGbGV4JywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdEb3VibGVCaWNlcHMnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvbmVDcmFjaycgfSwgeyBjbGlwOiAnQm93VHdpcmwnLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnRmxleCcsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRG91YmxlQmljZXBzJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb3dUd2lybCcsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdTa2VsZXRvbkFyY2hlcl9leWVzLnBuZycgfV0sXG4gICAgWydvZ3JlJywgJ09ncmUuZ2xiJywgJ09ncmVfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4xLCAxLjEyLCB7IHN0YXJTY2FsZTogWzEsIDEuMywgMS42NV0sIGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1lhd24nLCBlbW90ZTogJ3p6eicgfV0sIG1pbjogOSwgbWF4OiAxNiB9LCBzcGF3bkVtb3RlOiAnenp6JywgZXllczogJ09ncmVfZXllcy5wbmcnIH1dLFxuICBdO1xuICBhd2FpdCBQcm9taXNlLmFsbChkZWZzLm1hcChhc3luYyAoW3NvdWwsIGdsYiwgZW5lbXksIGNsaXBzLCB0b3AsIHNjYWxlLCBleHRyYV0pID0+IHtcbiAgICBjb25zdCBjb250YWluZXIgPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgZ2xiLCBzY2VuZSk7XG4gICAgQS50cmlwb1tzb3VsXSA9IHsgY29udGFpbmVyLCBlbmVteVRleDogbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBlbmVteSwgc2NlbmUsIGZhbHNlLCBmYWxzZSksIGNsaXBzLCBtYXRDYWNoZToge30sIHRvcCwgc2NhbGUsIC4uLihleHRyYSB8fCB7fSksIGV5ZVRleDogZXh0cmEgJiYgZXh0cmEuZXllcyA/IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy8nICsgZXh0cmEuZXllcywgc2NlbmUsIGZhbHNlLCBmYWxzZSkgOiB1bmRlZmluZWQgfTtcbiAgfSkpO1xuICByZXR1cm4gQTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzaGFyZWQgZGVjb3JhdGlvblxuY2xhc3MgRGVjbyB7XG4gIHByaXZhdGUgcHM6IGFueSA9IG51bGw7IHByaXZhdGUgaGFsbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBiYWRnZTogYW55OyBwcml2YXRlIHN0YXJzOiBhbnk7IHByaXZhdGUgZmlsbDogYW55OyBwcml2YXRlIGJhcjogYW55OyBwcml2YXRlIG1iZzogYW55OyBwcml2YXRlIG1maWxsOiBhbnk7IHByaXZhdGUgcmluZzogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBwYXJlbnQ6IGFueSwgcHJpdmF0ZSB0b3A6IG51bWJlciwgcHJpdmF0ZSByYWRpdXM6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lO1xuICAgIHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygncmluZycsIHsgcmFkaXVzOiBNYXRoLm1heCgwLjMsIHJhZGl1cyAqIDEuMTUpLCB0ZXNzZWxsYXRpb246IDI2IH0sIHMpOyB0aGlzLnJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0aGlzLnJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHRoaXMucmluZy5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMucmluZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYWRnZSA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2JhZGdlJywgcyk7IHRoaXMuYmFkZ2UucGFyZW50ID0gcGFyZW50OyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0b3AgKyAwLjMyOyB0aGlzLmJhZGdlLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgdGhpcy5zdGFycyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3N0YXJzJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMTUgfSwgcyk7IHRoaXMuc3RhcnMucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5zdGFycy5wb3NpdGlvbi55ID0gMC4xMTsgdGhpcy5zdGFycy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzbScsIHMpOyBzbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgc20uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgc20udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB0aGlzLnN0YXJzLm1hdGVyaWFsID0gc207ICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtID0gc207XG4gICAgY29uc3QgYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdiZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA4NSB9LCBzKTsgYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgYmcubWF0ZXJpYWwgPSBBLmJhckJnOyBiZy5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMuYmFyID0gYmc7XG4gICAgdGhpcy5maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuZmlsbC5wb3NpdGlvbi56ID0gLTAuMDAyOyB0aGlzLmZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWJnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMubWJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWJnLnBvc2l0aW9uLnkgPSAtMC4wNzsgdGhpcy5tYmcubWF0ZXJpYWwgPSBBLmJhckJnOyB0aGlzLm1iZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21maWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjAzIH0sIHMpOyB0aGlzLm1maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWZpbGwucG9zaXRpb24uc2V0KDAsIC0wLjA3LCAtMC4wMDIpOyB0aGlzLm1maWxsLm1hdGVyaWFsID0gQS5tYW5hRmlsbDsgdGhpcy5tZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYXIuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuZmlsbC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tYmcuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgc2V0KHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5BLnNjZW5lLCBjZmcgPSBBVVJBW3N0YXIgLSAxXTtcbiAgICAodGhpcy5zdGFycyBhcyBhbnkpLl9zbS5kaWZmdXNlVGV4dHVyZSA9IHRoaXMuQS5zdGFyVGV4W3N0YXIgLSAxXTtcbiAgICB0aGlzLnJpbmcubWF0ZXJpYWwgPSB0aGlzLkEucmluZ01hdFt0ZWFtXTsgdGhpcy5maWxsLm1hdGVyaWFsID0gdGhpcy5BLmJhckZpbGxbdGVhbV07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJhaXNlZCBieSB0aGUgTmVjcm9tYW5jZXI6IHB1cnBsZSBhdXJhIHRoYXQgZ3Jvd3Mgd2l0aCBzdGFyc1xuICAgICAgaWYgKCF0aGlzLnBzKSB7XG4gICAgICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2F1cmEnLCA3MCwgcyk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5wYXJlbnQ7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIHRoaXMudG9wICogMC41LCAwLjIpO1xuICAgICAgICBwcy5taW5MaWZlVGltZSA9IDAuNTsgcHMubWF4TGlmZVRpbWUgPSAxLjE7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjgsIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS41LCAwLjE1KTtcbiAgICAgICAgcHMubWluRW1pdFBvd2VyID0gMC4zNTsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHRoaXMucHMgPSBwcztcbiAgICAgIH1cbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBzOyBwLmVtaXRSYXRlID0gY2ZnLnJhdGU7IHAubWluU2l6ZSA9IGNmZy5taW47IHAubWF4U2l6ZSA9IGNmZy5tYXg7IHAuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMSk7IHAuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMik7IHAuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICAgIGlmICghcC5pc1N0YXJ0ZWQoKSkgcC5zdGFydCgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wcyAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTtcbiAgICBpZiAoc3RhciA+PSAzKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBoYWxvIGFib3ZlIHRoZSBoZWFkXG4gICAgICBpZiAoIXRoaXMuaGFsbykgeyB0aGlzLmhhbG8gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoYWxvJywgeyBkaWFtZXRlcjogMC41NSwgdGhpY2tuZXNzOiAwLjA0LCB0ZXNzZWxsYXRpb246IDI0IH0sIHMpOyB0aGlzLmhhbG8ucGFyZW50ID0gdGhpcy5wYXJlbnQ7IHRoaXMuaGFsby5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjA4OyB0aGlzLmhhbG8ubWF0ZXJpYWwgPSB0aGlzLkEuaGFsb01hdDsgdGhpcy5oYWxvLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgICAgdGhpcy5oYWxvLnNldEVuYWJsZWQodHJ1ZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmhhbG8pIHRoaXMuaGFsby5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLmJhci5zZXRFbmFibGVkKG9uKTsgdGhpcy5maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMuZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLm1iZy5zZXRFbmFibGVkKG9uKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMubWZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5tZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0QXVyYShvbjogYm9vbGVhbikgeyBpZiAodGhpcy5wcykgeyBpZiAob24gJiYgIXRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RhcnQoKTsgaWYgKCFvbiAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTsgfSB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7IGlmICh0aGlzLmhhbG8gJiYgdGhpcy5oYWxvLmlzRW5hYmxlZCgpKSB0aGlzLmhhbG8ucm90YXRpb24ueSArPSBkdCAqIDEuNjsgfVxuICBkaXNwb3NlKCkgeyBpZiAodGhpcy5wcykgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IH0gW3RoaXMuaGFsbywgdGhpcy5yaW5nLCB0aGlzLnN0YXJzLCB0aGlzLmJhciwgdGhpcy5maWxsLCB0aGlzLm1iZywgdGhpcy5tZmlsbF0uZm9yRWFjaCgobSkgPT4gbSAmJiBtLmRpc3Bvc2UoKSk7IHRoaXMuYmFkZ2UuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcmVhbCBtb2RlbHNcbmNsYXNzIFRyaXBvVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIGVudDogYW55OyBwcml2YXRlIGJvZHk6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIGJhc2U6IG51bWJlcjtcbiAgcHJpdmF0ZSBsYXN0Rmxhdm9yID0gJyc7IHByaXZhdGUgdWlkID0gJyc7IHByaXZhdGUgb3duOiBhbnkgPSBudWxsOyBwcml2YXRlIGlkbGVUID0gMDsgcHJpdmF0ZSBuZXh0Rmxhdm9yID0gMWU5OyBwcml2YXRlIGZsYXZvck9uID0gZmFsc2U7IHByaXZhdGUgcXVldWVkID0gZmFsc2U7IHByaXZhdGUgc3Bhd25UID0gMDsgcHJpdmF0ZSBleWVLID0gMC42NTsgcHJpdmF0ZSBlbW90ZXM6IHsgbTogYW55OyB0OiBudW1iZXI7IHkwOiBudW1iZXIgfVtdID0gW107XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIGNmZzogVHJpcG9DZmcsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCB1aWQgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA3KTsgdGhpcy51aWQgPSB1aWQ7XG4gICAgdGhpcy5lbnQgPSBjZmcuY29udGFpbmVyLmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ18nICsgdWlkLCBmYWxzZSwgeyBkb05vdEluc3RhbnRpYXRlOiB0cnVlIH0pO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgndW5pdF8nICsgdWlkLCBzKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIHRoaXMuYm9keSA9IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZpbmQoKG06IGFueSkgPT4gbS5uYW1lLmluY2x1ZGVzKCdfQm9keScpKTtcbiAgICBpZiAoIWNmZy5iYXNlTWF0KSBjZmcuYmFzZU1hdCA9IHRoaXMuYm9keS5tYXRlcmlhbDtcbiAgICB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiB7IGcuc3RvcCgpOyBnLmVuYWJsZUJsZW5kaW5nID0gdHJ1ZTsgZy5ibGVuZGluZ1NwZWVkID0gMC4xMjsgdGhpcy5hbmltc1tnLm5hbWUuc3BsaXQoJ18nKVswXV0gPSBnOyB9KTtcbiAgICB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfSk7XG4gICAgdGhpcy50b3AgPSBjZmcudG9wOyB0aGlzLmJhc2UgPSBjZmcuc2NhbGU7IHRoaXMudGVhbSA9IHRlYW07XG4gICAgaWYgKGNmZy5mbGF2b3IpIHRoaXMubmV4dEZsYXZvciA9IGNmZy5mbGF2b3IubWluICsgTWF0aC5yYW5kb20oKSAqIChjZmcuZmxhdm9yLm1heCAtIGNmZy5mbGF2b3IubWluKTtcbiAgICB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIDAuMyk7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiAxLjMsIGRpYW1ldGVyOiAwLjggfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSAwLjY7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5pc1BpY2thYmxlID0gdHJ1ZTtcbiAgICB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICB9XG4gIHByaXZhdGUgYXBwbHlNYXQoKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy50ZWFtICsgJ18nICsgdGhpcy5zdGFyLCBjID0gdGhpcy5jZmc7XG4gICAgaWYgKGMuZXllVGV4KSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIHVuaXQgaGFzIGdsb3dpbmcgZXllczogaXQgZ2V0cyBpdHMgb3duIG1hdGVyaWFsIHNvIGl0cyBnbG93IGNhbiBjaGFuZ2Ugb24gaXRzIG93blxuICAgICAgaWYgKCF0aGlzLm93bikgeyB0aGlzLm93biA9IGMuYmFzZU1hdC5jbG9uZSgnb3duXycgKyB0aGlzLnVpZCk7IHRoaXMub3duLmVtaXNzaXZlVGV4dHVyZSA9IGMuZXllVGV4OyB0aGlzLm93bi5lbWlzc2l2ZUludGVuc2l0eSA9IHRoaXMuZXllSzsgfVxuICAgICAgdGhpcy5vd24uYWxiZWRvVGV4dHVyZSA9IHRoaXMudGVhbSA9PT0gMSA/IGMuZW5lbXlUZXggOiBjLmJhc2VNYXQuYWxiZWRvVGV4dHVyZTsgY29uc3QgdCA9IFRJTlRbdGhpcy5zdGFyIC0gMV07IHRoaXMub3duLmFsYmVkb0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHRbMF0sIHRbMV0sIHRbMl0pO1xuICAgICAgdGhpcy5vd24uZW1pc3NpdmVDb2xvciA9IHRoaXMudGVhbSA9PT0gMSA/IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjcyLCAwLjIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNzgsIDAuMywgMSk7XG4gICAgICB0aGlzLmJvZHkubWF0ZXJpYWwgPSB0aGlzLm93bjsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIWMubWF0Q2FjaGVba2V5XSkgeyBjb25zdCBtID0gYy5iYXNlTWF0LmNsb25lKCdtXycgKyBrZXkpOyBpZiAodGhpcy50ZWFtID09PSAxKSBtLmFsYmVkb1RleHR1cmUgPSBjLmVuZW15VGV4OyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgbS5hbGJlZG9Db2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyh0WzBdLCB0WzFdLCB0WzJdKTsgYy5tYXRDYWNoZVtrZXldID0gbTsgfVxuICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IGMubWF0Q2FjaGVba2V5XTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLnNjKHN0KSAqIHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IH1cbiAgcHJpdmF0ZSBzYyhzdDogbnVtYmVyKSB7IHJldHVybiAodGhpcy5jZmcuc3RhclNjYWxlIHx8IEJBTEFOQ0Uuc3Rhci5zY2FsZSlbc3QgLSAxXTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkge1xuICAgIGxldCBjbGlwID0gdGhpcy5jZmcuY2xpcHNbc3RhdGVdLCBwb3NlOiBQb3NlIHwgdW5kZWZpbmVkO1xuICAgIGlmIChzdGF0ZSA9PT0gJ2NoZWVyJyAmJiB0aGlzLmNmZy5jaGVlcnMpIHsgcG9zZSA9IHRoaXMuY2ZnLmNoZWVyc1tNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0aGlzLmNmZy5jaGVlcnMubGVuZ3RoKV07IGNsaXAgPSBwb3NlLmNsaXA7IH1cbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tjbGlwXTsgaWYgKCFnKSByZXR1cm47IGNvbnN0IGxvb3AgPSBzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJztcbiAgICBpZiAoc3RhdGUgPT09ICdpZGxlJyAmJiB0aGlzLnN0YXRlID09PSAnc3Bhd24nICYmIHRoaXMuY3VyICYmIHRoaXMuY3VyLmlzU3RhcnRlZCAmJiB0aGlzLmNmZy5mbGF2b3IpIHsgdGhpcy5xdWV1ZWQgPSB0cnVlOyByZXR1cm47IH0gICAvLyBsZXQgdGhlIHdha2UtdXAgcGxheSB0byB0aGUgZW5kXG4gICAgaWYgKGxvb3AgJiYgdGhpcy5zdGF0ZSA9PT0gc3RhdGUgJiYgdGhpcy5jdXIgPT09IGcpIHJldHVybjtcbiAgICB0aGlzLnF1ZXVlZCA9IGZhbHNlOyB0aGlzLmZsYXZvck9uID0gZmFsc2U7IHRoaXMuaWRsZVQgPSAwO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChsb29wLCBzcGVlZCwgZy5mcm9tLCBnLnRvKTtcbiAgICBpZiAobG9vcCkgZy5nb1RvRnJhbWUoZy5mcm9tICsgTWF0aC5yYW5kb20oKSAqIChnLnRvIC0gZy5mcm9tKSk7XG4gICAgdGhpcy5jdXIgPSBnOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTtcbiAgICBpZiAocG9zZSAmJiBwb3NlLmVtb3RlKSB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuMzUpO1xuICAgIGlmIChzdGF0ZSA9PT0gJ3NwYXduJykgeyB0aGlzLnNwYXduVCA9IDA7IGlmICh0aGlzLmNmZy5zcGF3bkVtb3RlKSB7IHRoaXMuZW1vdGUodGhpcy5jZmcuc3Bhd25FbW90ZSwgMC4xKTsgdGhpcy5lbW90ZSh0aGlzLmNmZy5zcGF3bkVtb3RlLCAwLjcpOyB9IH1cbiAgfVxuICAvKiogQSBsaXR0bGUgcGljdHVyZSB0aGF0IGZsb2F0cyB1cCBvdmVyIHRoZSBoZWFkIGFuZCBmYWRlcyAoYSBzbGVlcHkgXCJaenpcIikuICovXG4gIHByaXZhdGUgZW1vdGUoa2luZDogc3RyaW5nLCBkZWxheSA9IDApIHtcbiAgICBjb25zdCBtYXQgPSB0aGlzLkEuZW1vdGVba2luZF07IGlmICghbWF0KSByZXR1cm47XG4gICAgY29uc3QgcGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdlbW8nLCB7IHNpemU6IDAuNDIgfSwgdGhpcy5BLnNjZW5lKTsgcGwucGFyZW50ID0gdGhpcy5ob2xkZXI7IHBsLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7IHBsLm1hdGVyaWFsID0gbWF0OyBwbC5pc1BpY2thYmxlID0gZmFsc2U7IHBsLnZpc2liaWxpdHkgPSAwO1xuICAgIGNvbnN0IHkwID0gdGhpcy50b3AgKyAwLjAyOyBwbC5wb3NpdGlvbi5zZXQoMC4xNiwgeTAsIDApOyB0aGlzLmVtb3Rlcy5wdXNoKHsgbTogcGwsIHQ6IC1kZWxheSwgeTAgfSk7XG4gIH1cbiAgLyoqIEFmdGVyIHN0YW5kaW5nIGlkbGUgZm9yIGEgd2hpbGU6IHBsYXkgdGhlIHVuaXQncyBmbGF2b3VyIGNsaXAgb25jZSAodGhlIE9ncmUgeWF3bnMpLCB0aGVuIGdvIGJhY2sgdG8gaWRsaW5nLiAqL1xuICBwcml2YXRlIHN0YXJ0Rmxhdm9yKCkge1xuICAgIGNvbnN0IGYgPSB0aGlzLmNmZy5mbGF2b3IhOyB0aGlzLmlkbGVUID0gMDtcbiAgICBsZXQgcG9vbCA9IGYuY2xpcHMuZmlsdGVyKChjKSA9PiBjLmNsaXAgIT09IHRoaXMubGFzdEZsYXZvciAmJiB0aGlzLmFuaW1zW2MuY2xpcF0pOyBpZiAoIXBvb2wubGVuZ3RoKSBwb29sID0gZi5jbGlwcy5maWx0ZXIoKGMpID0+IHRoaXMuYW5pbXNbYy5jbGlwXSk7IGlmICghcG9vbC5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCBwb3NlID0gcG9vbFtNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBwb29sLmxlbmd0aCldLCBnID0gdGhpcy5hbmltc1twb3NlLmNsaXBdOyB0aGlzLmxhc3RGbGF2b3IgPSBwb3NlLmNsaXA7XG4gICAgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGZhbHNlLCAxLCBnLmZyb20sIGcudG8pOyB0aGlzLmN1ciA9IGc7IHRoaXMuZmxhdm9yT24gPSB0cnVlOyB0aGlzLm5leHRGbGF2b3IgPSBmLm1pbiArIE1hdGgucmFuZG9tKCkgKiAoZi5tYXggLSBmLm1pbik7XG4gICAgaWYgKHBvc2UuZW1vdGUpIHsgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAwLjQpOyBpZiAocG9zZS5lbW90ZSA9PT0gJ3p6eicpIHRoaXMuZW1vdGUocG9zZS5lbW90ZSwgMS4yKTsgfVxuICB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy5kZWNvLnVwZGF0ZShkdCk7XG4gICAgaWYgKHRoaXMuY3VyICYmICF0aGlzLmN1ci5pc1N0YXJ0ZWQpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBvbmUtc2hvdCBjbGlwIGZpbmlzaGVkXG4gICAgICBpZiAodGhpcy5xdWV1ZWQpIHsgdGhpcy5xdWV1ZWQgPSBmYWxzZTsgdGhpcy5wbGF5KCdpZGxlJyk7IH0gZWxzZSBpZiAodGhpcy5mbGF2b3JPbikgeyB0aGlzLmZsYXZvck9uID0gZmFsc2U7IHRoaXMucGxheSgnaWRsZScpOyB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHRoaXMucGxheSgnaWRsZScpO1xuICAgIH1cbiAgICBpZiAodGhpcy5jZmcuZmxhdm9yICYmIHRoaXMuc3RhdGUgPT09ICdpZGxlJyAmJiAhdGhpcy5mbGF2b3JPbiAmJiB0aGlzLmhvbGRlci5pc0VuYWJsZWQoKSkgeyB0aGlzLmlkbGVUICs9IGR0OyBpZiAodGhpcy5pZGxlVCA+PSB0aGlzLm5leHRGbGF2b3IpIHRoaXMuc3RhcnRGbGF2b3IoKTsgfVxuICAgIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB0aGlzLnNwYXduVCArPSBkdDtcbiAgICBmb3IgKGxldCBpID0gdGhpcy5lbW90ZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGUgPSB0aGlzLmVtb3Rlc1tpXTsgZS50ICs9IGR0OyBpZiAoZS50IDwgMCkgY29udGludWU7IGNvbnN0IGsgPSBlLnQgLyAxLjk7XG4gICAgICBpZiAoayA+PSAxKSB7IGUubS5kaXNwb3NlKCk7IHRoaXMuZW1vdGVzLnNwbGljZShpLCAxKTsgY29udGludWU7IH1cbiAgICAgIGUubS52aXNpYmlsaXR5ID0gTWF0aC5taW4oMSwgZS50IC8gMC4yKSAqICgxIC0gayAqIGspOyBlLm0ucG9zaXRpb24uc2V0KDAuMTYgKyAwLjA1ICogTWF0aC5zaW4oZS50ICogMyksIGUueTAgKyBlLnQgKiAwLjIsIDApOyBlLm0uc2NhbGluZy5zZXRBbGwoMC43ICsgMC41ICogayk7XG4gICAgfVxuICAgIGlmICh0aGlzLm93bikgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBleWUgZ2xvdyBmb2xsb3dzIHRoZSBtb29kOiBkaW0gd2hlbiBzbGVlcHksIGJyaWdodCB3aGVuIGF3YWtlLCBmbGFyaW5nIGluIGEgZmlnaHRcbiAgICAgIGxldCB0YXJnZXQgPSAwLjY1O1xuICAgICAgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHRhcmdldCA9IDAuMDggKyAwLjkyICogTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgKHRoaXMuc3Bhd25UIC8gMS42NyAtIDAuNDUpIC8gMC4zKSk7XG4gICAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnaWRsZScpIHRhcmdldCA9IHRoaXMuZmxhdm9yT24gPyAwLjI1IDogMC42NTtcbiAgICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdydW4nKSB0YXJnZXQgPSAxLjA7IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdhdHRhY2snKSB0YXJnZXQgPSAxLjc7IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHRhcmdldCA9IDEuNDsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2RlYXRoJykgdGFyZ2V0ID0gMC4wNTtcbiAgICAgIHRoaXMuZXllSyArPSAodGFyZ2V0IC0gdGhpcy5leWVLKSAqIE1hdGgubWluKDEsIGR0ICogNyk7IHRoaXMub3duLmVtaXNzaXZlSW50ZW5zaXR5ID0gdGhpcy5leWVLO1xuICAgIH1cbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuc2ModGhpcy5zdGFyKSAqIHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5lbW90ZXMuZm9yRWFjaCgoZSkgPT4gZS5tLmRpc3Bvc2UoKSk7IGlmICh0aGlzLm93bikgdGhpcy5vd24uZGlzcG9zZSgpOyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5waWNrLmRpc3Bvc2UoKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmRpc3Bvc2UoZmFsc2UsIGZhbHNlKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhbmQtaW5zXG5jb25zdCBQSDogUmVjb3JkPHN0cmluZywgeyBjb2w6IHN0cmluZzsgdzogbnVtYmVyOyBoOiBudW1iZXI7IGhlYWQ6IG51bWJlcjsgd2VhcG9uOiBzdHJpbmc7IGxhYmVsOiBzdHJpbmcgfT4gPSB7XG4gIGdvYmxpbjogeyBjb2w6ICcjNjNiMTNmJywgdzogMC4zNiwgaDogMC40MiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnZGFnZ2VyJywgbGFiZWw6ICdHT0JMSU4nIH0sXG4gIGtuaWdodDogeyBjb2w6ICcjOGVhOWRjJywgdzogMC41LCBoOiAwLjYsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ3NoaWVsZCcsIGxhYmVsOiAnS05JR0hUJyB9LFxuICBvZ3JlOiB7IGNvbDogJyNhOGE2NGEnLCB3OiAwLjg1LCBoOiAwLjg1LCBoZWFkOiAwLjQyLCB3ZWFwb246ICdtYWNlJywgbGFiZWw6ICdPR1JFJyB9LFxuICBiYXJiYXJpYW46IHsgY29sOiAnI2Q2OGE1NScsIHc6IDAuNTIsIGg6IDAuNjIsIGhlYWQ6IDAuMzgsIHdlYXBvbjogJ2F4ZScsIGxhYmVsOiAnQkFSQkFSSUFOJyB9LFxufTtcbmNsYXNzIFBsYWNlaG9sZGVyVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIHJpZzogYW55OyBwcml2YXRlIGxlZ3M6IGFueVtdID0gW107IHByaXZhdGUgd3A6IGFueTsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSB0ID0gTWF0aC5yYW5kb20oKSAqIDY7IHByaXZhdGUgc3QwID0gMDsgcHJpdmF0ZSBkdXIgPSAxOyBwcml2YXRlIGJhc2UgPSAxOyBwcml2YXRlIHB1bHNlVCA9IDA7IHByaXZhdGUgbWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBib2R5OiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHNvdWw6IHN0cmluZywgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCBkID0gUEhbc291bF07IHRoaXMudGVhbSA9IHRlYW07XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdwaF8nICsgc291bCwgcyk7IHRoaXMucmlnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncmlnJywgcyk7IHRoaXMucmlnLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIGNvbnN0IG1hdCA9IChoZXg6IHN0cmluZywgZW0gPSAwKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdwbScsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoaGV4KS5zY2FsZSgwLjcyKTsgbS5zcGVjdWxhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMSwgMC4xLCAwLjEpOyBpZiAoZW0pIG0uZW1pc3NpdmVDb2xvciA9IG0uZGlmZnVzZUNvbG9yLnNjYWxlKGVtKTsgcmV0dXJuIG07IH07XG4gICAgY29uc3QgbGVnSCA9IDAuMjIsIGJvZHlZID0gbGVnSCArIGQuaCAvIDI7XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGxnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbGVnJywgcyk7IGxnLnBhcmVudCA9IHRoaXMucmlnOyBsZy5wb3NpdGlvbi5zZXQoc3ggKiBkLncgKiAwLjIyLCBsZWdILCAwKTsgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2wnLCB7IGhlaWdodDogbGVnSCwgZGlhbWV0ZXI6IGQudyAqIDAuMjggfSwgcyk7IG0ucGFyZW50ID0gbGc7IG0ucG9zaXRpb24ueSA9IC1sZWdIIC8gMjsgbS5tYXRlcmlhbCA9IG1hdCgnIzRhMzgyNicpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5sZWdzLnB1c2gobGcpOyB9XG4gICAgdGhpcy5ib2R5ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDYXBzdWxlKCdib2R5JywgeyByYWRpdXM6IGQudyAvIDIsIGhlaWdodDogZC5oICsgZC53ICogMC40IH0sIHMpOyB0aGlzLmJvZHkucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMuYm9keS5wb3NpdGlvbi55ID0gYm9keVk7IHRoaXMuYm9keS5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IHRoaXMuYm9keS5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgaGVhZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdoZWFkJywgeyBkaWFtZXRlcjogZC5oZWFkICogMS41LCBzZWdtZW50czogMTIgfSwgcyk7IGhlYWQucGFyZW50ID0gdGhpcy5yaWc7IGhlYWQucG9zaXRpb24ueSA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAwLjU1OyBoZWFkLm1hdGVyaWFsID0gbWF0KGQuY29sKTsgaGVhZC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgZXllTSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2V5ZScsIHMpOyBleWVNLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IGV5ZU0uZW1pc3NpdmVDb2xvciA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7ICh0aGlzIGFzIGFueSkuZXllTSA9IGV5ZU07XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZScsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDAuMyB9LCBzKTsgZS5wYXJlbnQgPSB0aGlzLnJpZzsgZS5wb3NpdGlvbi5zZXQoc3ggKiBkLmhlYWQgKiAwLjMsIGhlYWQucG9zaXRpb24ueSArIDAuMDIsIGQuaGVhZCAqIDAuNjYpOyBlLm1hdGVyaWFsID0gZXllTTsgZS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAvLyB3ZWFwb24gcGl2b3QgYXQgdGhlIHNob3VsZGVyLCBvbiB0aGUgY2hhcmFjdGVyJ3MgcmlnaHQgKC14IGlzIGZpbmUgZm9yIGEgc3RhbmQtaW4pXG4gICAgdGhpcy53cCA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3dwJywgcyk7IHRoaXMud3AucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMud3AucG9zaXRpb24uc2V0KGQudyAqIDAuNiwgbGVnSCArIGQuaCAqIDAuODUsIDAuMDUpO1xuICAgIGNvbnN0IHdtID0gbWF0KCcjN2E1YTMwJyksIGlyb24gPSBtYXQoJyM5YWExYWQnKTtcbiAgICBjb25zdCBtayA9IChtOiBhbnksIGtpbmQ6IHN0cmluZywgZGltczogYW55LCBwb3M6IG51bWJlcltdLCBtdDogYW55KSA9PiB7IGNvbnN0IHggPSBraW5kID09PSAnYm94JyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQm94KCd3JywgZGltcywgcykgOiBraW5kID09PSAnY3lsJyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3cnLCBkaW1zLCBzKSA6IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCd3JywgZGltcywgcyk7IHgucGFyZW50ID0gdGhpcy53cDsgeC5wb3NpdGlvbi5zZXQocG9zWzBdLCBwb3NbMV0sIHBvc1syXSk7IHgubWF0ZXJpYWwgPSBtdDsgeC5pc1BpY2thYmxlID0gZmFsc2U7IHJldHVybiB4OyB9O1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ2RhZ2dlcicpIG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA1LCBoZWlnaHQ6IDAuMywgZGVwdGg6IDAuMDMgfSwgWzAsIC0wLjIsIDAuMTJdLCBpcm9uKTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdzaGllbGQnKSB7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA2LCBoZWlnaHQ6IDAuNSwgZGVwdGg6IDAuMDQgfSwgWzAsIC0wLjMsIDAuMTRdLCBpcm9uKTsgY29uc3Qgc2ggPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzaCcsIHsgaGVpZ2h0OiAwLjA1LCBkaWFtZXRlcjogMC41NSB9LCBzKTsgc2gucGFyZW50ID0gdGhpcy5yaWc7IHNoLnJvdGF0aW9uLnogPSBNYXRoLlBJIC8gMjsgc2gucG9zaXRpb24uc2V0KC1kLncgKiAwLjcsIGxlZ0ggKyBkLmggKiAwLjYsIDAuMDUpOyBzaC5tYXRlcmlhbCA9IG1hdCgnI2Q4YjY0YScpOyBzaC5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdtYWNlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuOSwgZGlhbWV0ZXI6IDAuMDggfSwgWzAsIC0wLjM1LCAwLjNdLCB3bSk7IG1rKDAsICdzcGgnLCB7IGRpYW1ldGVyOiAwLjQgfSwgWzAsIC0wLjg1LCAwLjRdLCBpcm9uKTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ2F4ZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjYsIGRpYW1ldGVyOiAwLjA1IH0sIFswLCAtMC4yLCAwLjE1XSwgd20pOyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4zMiwgaGVpZ2h0OiAwLjIyLCBkZXB0aDogMC4wNSB9LCBbMCwgLTAuNSwgMC4xNV0sIGlyb24pOyBjb25zdCBoYWlyID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignaGFpcicsIHsgaGVpZ2h0OiAwLjMsIGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogZC5oZWFkICogMS4yIH0sIHMpOyBoYWlyLnBhcmVudCA9IHRoaXMucmlnOyBoYWlyLnBvc2l0aW9uLnkgPSBoZWFkLnBvc2l0aW9uLnkgKyBkLmhlYWQgKiAwLjc1OyBoYWlyLm1hdGVyaWFsID0gbWF0KCcjYzIyYTFjJyk7IGhhaXIuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgdGhpcy50b3AgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMS4zNTsgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCBkLncgKiAwLjcpO1xuICAgIGNvbnN0IGxibCA9IGR5bihzLCAyNTYsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCAyNnB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmZpbGxTdHlsZSA9ICcjZmZmZmZmJzsgYy5zdHJva2VTdHlsZSA9ICcjMTExJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyBjLmZpbGxUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgfSk7XG4gICAgY29uc3QgbHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdsYmwnLCB7IHdpZHRoOiAxLjEsIGhlaWdodDogMC4yIH0sIHMpOyBscC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgbHAucG9zaXRpb24ueSA9IC0wLjE7IGxwLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMiAqIDAuMDsgbHAuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDsgY29uc3QgbG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdsbScsIHMpOyBsbS5kaWZmdXNlVGV4dHVyZSA9IGxibDsgbG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IGxtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IGxtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbHAubWF0ZXJpYWwgPSBsbTsgbHAuaXNQaWNrYWJsZSA9IGZhbHNlOyBscC5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjYyO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogdGhpcy50b3AsIGRpYW1ldGVyOiBNYXRoLm1heCgwLjcsIGQudyAqIDEuMykgfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCAvIDI7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgICAodGhpcyBhcyBhbnkpLnBhcnRzID0gW2xwXTsgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGxheSgnaWRsZScpO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgKHRoaXMgYXMgYW55KS5leWVNLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmJhc2UgPSBCQUxBTkNFLnN0YXIuc2NhbGVbc3QgLSAxXTsgY29uc3QgdCA9IFRJTlRbc3QgLSAxXTsgdGhpcy5ib2R5Lm1hdGVyaWFsLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoUEhbdGhpcy5zb3VsXS5jb2wpLnNjYWxlKDAuNzIpLm11bHRpcGx5KG5ldyBCQUJZTE9OLkNvbG9yMyhNYXRoLm1pbigxLCB0WzBdKSwgTWF0aC5taW4oMSwgdFsxXSksIE1hdGgubWluKDEsIHRbMl0pKSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHsgaWYgKHN0YXRlID09PSB0aGlzLnN0YXRlICYmIChzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJykpIHJldHVybjsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLnN0MCA9IHRoaXMudDsgdGhpcy5kdXIgPSBzdGF0ZSA9PT0gJ2F0dGFjaycgPyAoQkFMQU5DRS5zdGF0c1t0aGlzLnNvdWwgYXMgU291bElkXS5hbmltTGVuIC8gc3BlZWQpIDogc3RhdGUgPT09ICdkZWF0aCcgPyAwLjYgOiBzdGF0ZSA9PT0gJ3NwYXduJyA/IDAuOSA6IDEuMDsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpOyB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0OyB0aGlzLmRlY28udXBkYXRlKGR0KTsgY29uc3QgcCA9IE1hdGgubWluKDEsICh0aGlzLnQgLSB0aGlzLnN0MCkgLyB0aGlzLmR1ciksIFIgPSB0aGlzLnJpZywgVyA9IHRoaXMud3A7XG4gICAgUi5wb3NpdGlvbi5zZXQoMCwgMCwgMCk7IFIucm90YXRpb24uc2V0KDAsIDAsIDApOyBSLnNjYWxpbmcuc2V0QWxsKDEpOyBXLnJvdGF0aW9uLnggPSAtMC40OyB0aGlzLmxlZ3MuZm9yRWFjaCgobCkgPT4gKGwucm90YXRpb24ueCA9IDApKTtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ2lkbGUnKSBSLnBvc2l0aW9uLnkgPSBNYXRoLnNpbih0aGlzLnQgKiAyLjIpICogMC4wMTI7XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHsgY29uc3QgdyA9IHRoaXMudCAqIDEwOyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih3KSkgKiAwLjA3OyBSLnJvdGF0aW9uLnggPSAwLjI7IHRoaXMubGVnc1swXS5yb3RhdGlvbi54ID0gTWF0aC5zaW4odykgKiAwLjk7IHRoaXMubGVnc1sxXS5yb3RhdGlvbi54ID0gLU1hdGguc2luKHcpICogMC45OyBXLnJvdGF0aW9uLnggPSAtMC40ICsgTWF0aC5zaW4odykgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnYXR0YWNrJykgeyBjb25zdCBrID0gcCA8IDAuNCA/IC0yLjQgKiAocCAvIDAuNCkgOiAtMi40ICsgMy40ICogTWF0aC5taW4oMSwgKHAgLSAwLjQpIC8gMC4yNSk7IFcucm90YXRpb24ueCA9IGs7IFIucG9zaXRpb24ueiA9IDAuMTQgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IFIucm90YXRpb24ueCA9IDAuMTUgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB7IGNvbnN0IGUgPSBwICogcCAqICgzIC0gMiAqIHApOyBSLnNjYWxpbmcuc2V0QWxsKDAuMDEgKyAwLjk5ICogZSk7IFIucG9zaXRpb24ueSA9IChlIC0gMSkgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB7IGNvbnN0IGUgPSBwICogcDsgUi5yb3RhdGlvbi54ID0gLU1hdGguUEkgLyAyICogZTsgUi5wb3NpdGlvbi55ID0gMC4yNSAqIGU7IFIucG9zaXRpb24ueiA9IC0wLjIgKiBlOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgeyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih0aGlzLnQgKiA3KSkgKiAwLjE1OyBXLnJvdGF0aW9uLnggPSAtMi42OyB9XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmlzdWFsKEE6IEFzc2V0cywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKTogVW5pdFZpc3VhbCB7XG4gIGNvbnN0IGNmZyA9IEEudHJpcG9bc291bF07XG4gIHJldHVybiBjZmcgPyBuZXcgVHJpcG9WaXN1YWwoQSwgY2ZnLCBzb3VsLCB0ZWFtLCBzdGFyKSA6IG5ldyBQbGFjZWhvbGRlclZpc3VhbChBLCBzb3VsLCB0ZWFtLCBzdGFyKTtcbn1cbmV4cG9ydCBjb25zdCBpc1RyaXBvID0gKEE6IEFzc2V0cywgc291bDogU291bElkKSA9PiAhIUEudHJpcG9bc291bF07XG4iLCAiLy8gVGhlIGdhbWUncyBpY29uIHNldCAoY3VzdG9tIGFydCwgc2xpY2VkIGZyb20gUGlwZWxpbmUvaWNvbnMvc2hlZXRfKi5wbmcgYnkgUGlwZWxpbmUvYmxlbmRlci9zbGljZV9pY29ucy5weSAtPiBkb2NzL2Fzc2V0cy9pY29ucy8qLnBuZykuXG4vLyBTaGFyZWQgYnkgdGhlIDNEIGdhbWUncyBET00gKHZhbmlsbGEpIGFuZCB0aGUgQW5ndWxhciBzaGVsbC4gTm8gZW1vamkgYW55d2hlcmU6IGV2ZXJ5IGdseXBoIGluIHRoZSBVSSBpcyBvbmUgb2YgdGhlc2UgaW1hZ2VzLlxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSYXJpdHkgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcblxuZXhwb3J0IHR5cGUgSWNvbk5hbWUgPVxuICB8ICdob21lJyB8ICdzb3VscycgfCAnc2hvcCcgfCAnc2V0dGluZ3MnIHwgJ2Nsb3NlJ1xuICB8ICdoZWFydCcgfCAnaGVhcnRfZW1wdHknIHwgJ2RvbWluaW9uJyB8ICdzdGFyJyB8ICdsb2NrJ1xuICB8ICd3YXJyaW9yJyB8ICdhcmNoZXInIHwgJ2dvYmxpbicgfCAna25pZ2h0JyB8ICdvZ3JlJyB8ICdiYXJiYXJpYW4nXG4gIHwgJ2dlbV9jb21tb24nIHwgJ2dlbV9yYXJlJyB8ICdnZW1fZXBpYycgfCAnZ2VtX2xlZ2VuZGFyeSdcbiAgfCAnbXVzaWMnIHwgJ3NvdW5kX29uJyB8ICdzb3VuZF9vZmYnIHwgJ3VwZ3JhZGUnIHwgJ3N3YXAnXG4gIHwgJ21lcmdlJyB8ICdyZW1vdmUnIHwgJ2NoZWNrJyB8ICdiYWNrJyB8ICdpbmZvJztcblxuLyoqIFJlbGF0aXZlIHRvIHRoZSBwYWdlLCBzbyBpdCB3b3JrcyBvbiBHaXRIdWIgUGFnZXMgdW5kZXIgL3JlcG8tbmFtZS8uICovXG5leHBvcnQgY29uc3QgaWNvblVybCA9IChuOiBJY29uTmFtZSk6IHN0cmluZyA9PiAnYXNzZXRzL2ljb25zLycgKyBuICsgJy5wbmcnO1xuLyoqIEFuIDxpbWc+IGFzIGFuIEhUTUwgc3RyaW5nLCBmb3IgdGhlIGdhbWUncyBoYW5kLWJ1aWx0IERPTS4gKi9cbmV4cG9ydCBjb25zdCBpY29uSW1nID0gKG46IEljb25OYW1lLCBjbHMgPSAnaWMnKTogc3RyaW5nID0+IGA8aW1nIGNsYXNzPVwiJHtjbHN9XCIgc3JjPVwiJHtpY29uVXJsKG4pfVwiIGFsdD1cIlwiIGRyYWdnYWJsZT1cImZhbHNlXCI+YDtcblxuLyoqIEVhY2ggU291bCBpcyBzaG93biBieSBpdHMgd2VhcG9uL3JvbGUgaWNvbiB1bnRpbCByZWFsIHBvcnRyYWl0cyBleGlzdC4gKi9cbmV4cG9ydCBjb25zdCBTT1VMX0lDT046IFJlY29yZDxTb3VsSWQsIEljb25OYW1lPiA9IHsgd2FycmlvcjogJ3dhcnJpb3InLCBhcmNoZXI6ICdhcmNoZXInLCBnb2JsaW46ICdnb2JsaW4nLCBrbmlnaHQ6ICdrbmlnaHQnLCBvZ3JlOiAnb2dyZScsIGJhcmJhcmlhbjogJ2JhcmJhcmlhbicgfTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfR0VNOiBSZWNvcmQ8UmFyaXR5LCBJY29uTmFtZT4gPSB7IGNvbW1vbjogJ2dlbV9jb21tb24nLCByYXJlOiAnZ2VtX3JhcmUnLCBlcGljOiAnZ2VtX2VwaWMnLCBsZWdlbmRhcnk6ICdnZW1fbGVnZW5kYXJ5JyB9O1xuXG4vKiogUGFjayB0aWVycyBhcmUgc2hvd24gYXMgc2t1bGxzIChuZXZlciBzdGFyczogc3RhcnMgbWVhbiBhbiBpbi1ydW4gbWVyZ2UgbGV2ZWwpLiAqL1xuZXhwb3J0IGNvbnN0IHNrdWxsSW1ncyA9IChuOiBudW1iZXIsIGNscyA9ICdzaycpOiBzdHJpbmcgPT4gaWNvbkltZygnc291bHMnLCBjbHMpLnJlcGVhdChNYXRoLm1heCgxLCBuKSk7XG5leHBvcnQgY29uc3QgaGVhcnRzSHRtbCA9IChoZWFydHM6IG51bWJlciwgbWF4ID0gMyk6IHN0cmluZyA9PiBpY29uSW1nKCdoZWFydCcsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBoZWFydHMpKSArIGljb25JbWcoJ2hlYXJ0X2VtcHR5JywgJ2ljIGhlYXJ0JykucmVwZWF0KE1hdGgubWF4KDAsIG1heCAtIGhlYXJ0cykpO1xuIiwgIi8vIFJlbmRlcmVkIFNvdWwgcG9ydHJhaXRzIChQaXBlbGluZS9ibGVuZGVyL3JlbmRlcl9wb3J0cmFpdC5weSwgaGVhZC1hbmQtc2hvdWxkZXJzIG1vZGUpLCBzaGFyZWQgYnkgdGhlIEFuZ3VsYXIgcGFnZXMgYW5kIHRoZSBiYXR0bGUgc2NyZWVuLlxuLy8gU291bHMgd2l0aG91dCBhIHBvcnRyYWl0IHlldCBmYWxsIGJhY2sgdG8gdGhlaXIgcm9sZSBpY29uIG9uIGEgY29sb3VyZWQgY2FyZC5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7IFJBUklUWV9PRiB9IGZyb20gJy4uL2NvcmUvcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSYXJpdHkgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcbmltcG9ydCB7IFNPVUxfSUNPTiwgaWNvblVybCB9IGZyb20gJy4vaWNvbnMudHMnO1xuXG5jb25zdCBQT1JUUkFJVDogUGFydGlhbDxSZWNvcmQ8U291bElkLCBzdHJpbmc+PiA9IHsgd2FycmlvcjogJ2Fzc2V0cy9wb3J0cmFpdHMvd2Fycmlvcl9oZWFkLnBuZycsIGFyY2hlcjogJ2Fzc2V0cy9wb3J0cmFpdHMvYXJjaGVyX2hlYWQucG5nJywgb2dyZTogJ2Fzc2V0cy9wb3J0cmFpdHMvb2dyZV9oZWFkLnBuZycgfTtcbmNvbnN0IFJBUklUWV9IRVg6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJyNiOGMwY2MnLCByYXJlOiAnIzRhYTNmZicsIGVwaWM6ICcjYjI2YmZmJywgbGVnZW5kYXJ5OiAnI2ZmY2MzMycgfTtcbmV4cG9ydCBjb25zdCBoYXNBcnQgPSAoczogU291bElkKTogYm9vbGVhbiA9PiAhIVBPUlRSQUlUW3NdO1xuZXhwb3J0IGNvbnN0IHNvdWxBcnQgPSAoczogU291bElkKTogc3RyaW5nID0+IFBPUlRSQUlUW3NdID8/IGljb25VcmwoU09VTF9JQ09OW3NdKTtcbmV4cG9ydCBjb25zdCByYXJpdHlDb2xvciA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4gUkFSSVRZX0hFWFtSQVJJVFlfT0Zbc11dO1xuLyoqIENhcmQgYmFja2Ryb3AgZm9yIGEgcG9ydHJhaXQ6IGEgZ2xvdyBpbiB0aGUgcmFyaXR5IGNvbG91ciBiZWhpbmQgdGhlIGZpZ3VyZSwgb24gYSBkYXJrIGNyeXB0IGdyYWRpZW50LiAqL1xuZXhwb3J0IGNvbnN0IGFydEJnID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiB7IGNvbnN0IGMgPSByYXJpdHlDb2xvcihzKTsgcmV0dXJuIGByYWRpYWwtZ3JhZGllbnQoZWxsaXBzZSBhdCA1MCUgODAlLCAke2N9NzcgMCUsICR7Y30yNiA0NiUsIHRyYW5zcGFyZW50IDc0JSksIGxpbmVhci1ncmFkaWVudCgjMmIyNDQ0LCMwZDA5MTkpYDsgfTtcbiIsICIvLyBET00gdXNlciBpbnRlcmZhY2U6IHRvcCBiYXIsIGVuZW15IHByZXZpZXcsIGhhbmQgb2YgY2FyZHMsIGJ1dHRvbnMsIGRyYWZ0IG92ZXJsYXksIHRvYXN0cyBhbmQgdGhlIGRlYnVnIHBhbmVsLlxuaW1wb3J0IHsgQkFMQU5DRSwgUk9MRV9URVhULCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgaXNFbmRsZXNzIH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNvc3QsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBzdGFnZVdhdmVzIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBlbmVteVdhdmUsIHByZXZpZXdUZXh0IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgYXJ0QmcsIGhhc0FydCwgcmFyaXR5Q29sb3IsIHNvdWxBcnQgfSBmcm9tICcuLi91aS9wb3J0cmFpdHMudHMnO1xuaW1wb3J0IHsgU09VTF9JQ09OLCBoZWFydHNIdG1sLCBpY29uSW1nLCBpY29uVXJsLCBza3VsbEltZ3MgfSBmcm9tICcuLi91aS9pY29ucy50cyc7XG5pbXBvcnQgeyBkZXNjcmliZVVubG9jayB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuXG5jb25zdCBwb3J0cmFpdEh0bWwgPSAoczogU291bElkKTogc3RyaW5nID0+IGA8ZGl2IGNsYXNzPVwicHRcIiBzdHlsZT1cImJhY2tncm91bmQ6JHthcnRCZyhzKX1cIj48aW1nIHNyYz1cIiR7c291bEFydChzKX1cIiBhbHQ9XCJcIiBkcmFnZ2FibGU9XCJmYWxzZVwiPjwvZGl2PmA7XG5jb25zdCBJQ09OID0gT2JqZWN0LmZyb21FbnRyaWVzKFNPVUxTLm1hcCgocykgPT4gW3MsIGljb25JbWcoU09VTF9JQ09OW3NdLCAnaWMnKV0pKSBhcyBSZWNvcmQ8U291bElkLCBzdHJpbmc+O1xuY29uc3QgJCA9IChpZDogc3RyaW5nKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkhO1xuY29uc3Qgc3RhcnMgPSAobjogbnVtYmVyKSA9PiAnXHUyNjA1Jy5yZXBlYXQobik7XG5cbmV4cG9ydCBjbGFzcyBVaSB7XG4gIHByaXZhdGUgdG9hc3RUID0gMDsgcHJpdmF0ZSBkYmc6IEhUTUxFbGVtZW50OyBwcml2YXRlIG9kZHMgPSAnJztcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBnOiBhbnkpIHtcbiAgICAkKCdidG5Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAkKCdidG5CYXR0bGUnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydEJhdHRsZSgpOyAkKCdidG5Td2FwJykub25jbGljayA9ICgpID0+IGcudG9nZ2xlU3dhcCgpO1xuICAgICQoJ2J0bk1lcmdlJykub25jbGljayA9ICgpID0+IGcubWVyZ2VTZWxlY3RlZCgpOyAkKCdidG5SZW1vdmUnKS5vbmNsaWNrID0gKCkgPT4gZy5yZW1vdmVTZWxlY3RlZCgpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zcGVlZF0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRTcGVlZCgrYi5kYXRhc2V0LnNwZWVkISkpKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiBnLnNldENhbU1vZGUoYi5kYXRhc2V0LmNhbSEpKSk7XG4gICAgJCgnZ2VhcicpLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuZGJnLmNsYXNzTGlzdC50b2dnbGUoJ29wZW4nKTsgdGhpcy5yZW5kZXJEZWJ1ZygpOyB9O1xuICAgIGNvbnN0IHNuZCA9ICgpID0+IHsgJCgnYnRuTXVzaWMnKS5jbGFzc0xpc3QudG9nZ2xlKCdvZmYnLCAhYXVkaW8ubXVzaWMpOyAkKCdidG5TZngnKS5jbGFzc0xpc3QudG9nZ2xlKCdvZmYnLCAhYXVkaW8uc2Z4KTsgY29uc3Qgc2kgPSAkKCdidG5TZngnKS5xdWVyeVNlbGVjdG9yKCdpbWcnKTsgaWYgKHNpKSBzaS5zcmMgPSBpY29uVXJsKGF1ZGlvLnNmeCA/ICdzb3VuZF9vbicgOiAnc291bmRfb2ZmJyk7IH07XG4gICAgJCgnYnRuTXVzaWMnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRNdXNpYyghYXVkaW8ubXVzaWMpOyBzbmQoKTsgfTsgJCgnYnRuU2Z4Jykub25jbGljayA9ICgpID0+IHsgYXVkaW8uc2V0U2Z4KCFhdWRpby5zZngpOyBzbmQoKTsgfTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MnLCBzbmQpOyBzbmQoKTtcbiAgICB0aGlzLmRiZyA9ICQoJ2RlYnVnJyk7IGlmIChuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdkZWJ1ZycpKSB0aGlzLmRiZy5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gICAgdGhpcy5yZW5kZXJEZWJ1ZygpO1xuICB9XG5cbiAgLyoqIFRoZSBOZWNyb21hbmNlciBqdXN0IGxvc3QgYSBoZWFydDogbWFrZSB0aGUgaGVhcnRzIGJ1bXAuICovXG4gIHB1bHNlSGVhcnRzKCkgeyBjb25zdCBoID0gJCgnaGVhcnRzJyk7IGguY2xhc3NMaXN0LnJlbW92ZSgnaHVydCcpOyB2b2lkIGgub2Zmc2V0V2lkdGg7IGguY2xhc3NMaXN0LmFkZCgnaHVydCcpOyB9XG4gIHRvYXN0KG1zZzogc3RyaW5nKSB7IGNvbnN0IHQgPSAkKCd0b2FzdCcpOyB0LnRleHRDb250ZW50ID0gbXNnOyB0LmNsYXNzTGlzdC5hZGQoJ3Nob3cnKTsgY2xlYXJUaW1lb3V0KHRoaXMudG9hc3RUKTsgdGhpcy50b2FzdFQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0LmNsYXNzTGlzdC5yZW1vdmUoJ3Nob3cnKSwgMzYwMCk7IH1cblxuICByZW5kZXIoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgcyA9IGcucywgcGggPSBnLnBoYXNlLCBidWlsZCA9IHBoID09PSAnYnVpbGQnO1xuICAgICQoJ2hlYXJ0cycpLmlubmVySFRNTCA9IGhlYXJ0c0h0bWwocy5oZWFydHMpO1xuICAgICQoJ3dhdmUnKS50ZXh0Q29udGVudCA9IGlzRW5kbGVzcygpID8gYFdhdmUgJHtzLndhdmV9YCA6IGBXYXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9YDtcbiAgICBjb25zdCB1c2VkID0gZG9taW5pb25Vc2VkKHMpOyAkKCdkb20nKS50ZXh0Q29udGVudCA9IGAke3VzZWR9LyR7cy5jYXB9YDsgKCQoJ2RvbWZpbGwnKSBhcyBIVE1MRWxlbWVudCkuc3R5bGUud2lkdGggPSBNYXRoLm1pbigxMDAsICh1c2VkIC8gcy5jYXApICogMTAwKSArICclJztcbiAgICAvLyBlbmVteSBwcmV2aWV3OiB3aGF0IGlzIGNvbWluZywgbmV2ZXIgd2hlcmVcbiAgICBjb25zdCBwdiA9IHByZXZpZXdUZXh0KGVuZW15V2F2ZShzLndhdmUsIGcuc2VlZCkpO1xuICAgICQoJ2VuZW15JykuaW5uZXJIVE1MID0gYDxiPk5leHQgZW5lbWllczwvYj5gICsgcHYubWFwKChwKSA9PiBgPGRpdiBjbGFzcz1cImVyb3dcIj48c3Bhbj4ke0lDT05bcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuPiR7U09VTF9OQU1FW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3BhbiBjbGFzcz1cInhcIj5cdTAwRDcke3AuY291bnR9PC9zcGFuPjxzcGFuIGNsYXNzPVwic3RcIj4ke3N0YXJzKHAuc3Rhcil9PC9zcGFuPjwvZGl2PmApLmpvaW4oJycpICsgYDxkaXYgY2xhc3M9XCJoaW50XCI+UG9zaXRpb25zIHN0YXkgaGlkZGVuIHVudGlsIHRoZSBiYXR0bGUuPC9kaXY+YDtcbiAgICAvLyBoYW5kXG4gICAgY29uc3QgaGFuZCA9ICQoJ2hhbmQnKTsgaGFuZC5pbm5lckhUTUwgPSAnJztcbiAgICBzLmhhbmQuZm9yRWFjaCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IHtcbiAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGNvbnN0IHNlbCA9IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiBnLnNlbC5pZHggPT09IGk7IGNvbnN0IGFmZm9yZCA9IGNhblN1bW1vbihzLCBpKSwgY2FuTWVyZ2UgPSBzLnVuaXRzLnNvbWUoKHU6IGFueSkgPT4gY2FuTWVyZ2VGcm9tSGFuZChzLCBpLCB1LmlkKSksIHVzYWJsZSA9IGFmZm9yZCB8fCBjYW5NZXJnZTtcbiAgICAgIGNvbnN0IGFydCA9IGhhc0FydChzb3VsKTsgZWwuY2xhc3NOYW1lID0gJ2NhcmQnICsgKGFydCA/ICcgYXJ0JyA6ICcnKSArIChzZWwgPyAnIHNlbCcgOiAnJykgKyAoIXVzYWJsZSAmJiAhZy5zd2FwTW9kZSA/ICcgZGlzJyA6ICcnKSArIChnLnN3YXBNb2RlID8gJyBzd2FwJyA6ICcnKTtcbiAgICAgIGNvbnN0IHRhZyA9IGFmZm9yZCA/IGA8c3BhbiBjbGFzcz1cIm9rXCI+U3VtbW9uPC9zcGFuPmAgOiBjYW5NZXJnZSA/ICc8c3BhbiBjbGFzcz1cIm9rIG1nXCI+TWVyZ2Ugb25seTwvc3Bhbj4nIDogJzxzcGFuIGNsYXNzPVwibm9cIj5ObyByb29tPC9zcGFuPic7XG4gICAgICBpZiAoYXJ0KSBlbC5zdHlsZS5ib3JkZXJDb2xvciA9IHJhcml0eUNvbG9yKHNvdWwpO1xuICAgICAgZWwuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PiR7YXJ0ID8gcG9ydHJhaXRIdG1sKHNvdWwpIDogSUNPTltzb3VsXSArIGA8ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj5gfTxkaXYgY2xhc3M9XCJjc1wiPiR7dGFnfTwvZGl2PmA7IGVsLnRpdGxlID0gUk9MRV9URVhUW3NvdWxdICsgKGFmZm9yZCA/ICcnIDogY2FuTWVyZ2UgPyAnIC0gRG9taW5pb24gaXMgZnVsbCwgYnV0IHlvdSBjYW4gbWVyZ2UgaXQgaW50byB5b3VyIG1hdGNoaW5nIDEtc3RhciB1bml0LicgOiAnIC0gTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLicpO1xuICAgICAgZWwub25jbGljayA9ICgpID0+IGcub25DYXJkKGkpOyBoYW5kLmFwcGVuZENoaWxkKGVsKTtcbiAgICB9KTtcbiAgICBpZiAoIXMuaGFuZC5sZW5ndGgpIGhhbmQuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9XCJlbXB0eVwiPk5vIGNhcmRzIGluIGhhbmQ8L2Rpdj4nO1xuICAgIC8vIGJ1dHRvbnNcbiAgICAoJCgnYnRuQmF0dGxlJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQpLmRpc2FibGVkID0gIWJ1aWxkIHx8ICFzLnVuaXRzLmxlbmd0aDtcbiAgICBjb25zdCBzdyA9ICQoJ2J0blN3YXAnKSBhcyBIVE1MQnV0dG9uRWxlbWVudDsgc3cuZGlzYWJsZWQgPSAhYnVpbGQgfHwgcy5kaXNjYXJkVXNlZDsgc3cuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBnLnN3YXBNb2RlKTsgc3cudGV4dENvbnRlbnQgPSBzLmRpc2NhcmRVc2VkID8gJ1N3YXAgdXNlZCcgOiBnLnN3YXBNb2RlID8gJ1N3YXA6IHBpY2sgYSBjYXJkIG9yIHVuaXQnIDogJ1N3YXAgKDEvcm91bmQpJztcbiAgICBjb25zdCBzZWxVID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ3VuaXQnID8gcy51bml0cy5maW5kKCh1OiBhbnkpID0+IHUuaWQgPT09IGcuc2VsLmlkKSA6IG51bGw7XG4gICAgY29uc3QgcGFydG5lciA9IHNlbFUgJiYgcy51bml0cy5zb21lKChvOiBhbnkpID0+IGNhbk1lcmdlRGVwbG95ZWQoc2VsVSwgbykpO1xuICAgICQoJ3VuaXRwYW5lbCcpLnN0eWxlLmRpc3BsYXkgPSBidWlsZCAmJiBzZWxVID8gJ2ZsZXgnIDogJ25vbmUnOyAoJCgnYnRuTWVyZ2UnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhcGFydG5lcjtcbiAgICAkKCdidG5SZW1vdmUnKS50ZXh0Q29udGVudCA9IGcuY29uZmlybVJlbW92ZSA/ICdDb25maXJtIHJlbW92ZScgOiAnUmVtb3ZlJztcbiAgICAkKCdpbmZvJykudGV4dENvbnRlbnQgPSBidWlsZCA/IChnLnN3YXBNb2RlID8gJ1NXQVA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkIGl0LCBvciB0YXAgYSB1bml0IHlvdSBkaWQgbm90IHN1bW1vbiB0aGlzIHJvdW5kIHRvIHNlbGwgaXQuIFlvdSBkcmF3IGEgZGlmZmVyZW50IFNvdWwuJ1xuICAgICAgOiBzZWxVID8gYCR7U09VTF9OQU1FW3NlbFUuc291bCBhcyBTb3VsSWRdfSAke3N0YXJzKHNlbFUuc3Rhcil9ICBcdTIwMjIgICR7Uk9MRV9URVhUW3NlbFUuc291bCBhcyBTb3VsSWRdfSAgJHtwYXJ0bmVyID8gJ1x1MjAyMiBUYXAgYSBnbG93aW5nIHBhcnRuZXIgdG8gbWVyZ2UuJyA6ICcnfWBcbiAgICAgIDogZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnID8gYCR7U09VTF9OQU1FW3MuaGFuZFtnLnNlbC5pZHhdIGFzIFNvdWxJZF19OiAke1JPTEVfVEVYVFtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfSAgXHUyMDIyICBgICsgKCgpID0+IHsgY29uc3QgaSA9IGcuc2VsLmlkeCwgc20gPSBjYW5TdW1tb24ocywgaSksIG1nID0gcy51bml0cy5zb21lKCh1OiBhbnkpID0+IGNhbk1lcmdlRnJvbUhhbmQocywgaSwgdS5pZCkpOyByZXR1cm4gc20gJiYgbWcgPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24sIG9yIGEgZ2xvd2luZyBwdXJwbGUgdW5pdCB0byBtZXJnZSBpdCBpbi4nIDogc20gPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24uJyA6IG1nID8gJ0RvbWluaW9uIGlzIGZ1bGw6IHRhcCBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6ICdOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJzsgfSkoKSA6ICdUYXAgYSBjYXJkLCB0aGVuIGEgdGlsZS4gVGFwIGEgdW5pdCB0byBtZXJnZSwgbW92ZSBvciByZW1vdmUgaXQuJylcbiAgICAgIDogcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnQmF0dGxlISBVbml0cyBmaWdodCBvbiB0aGVpciBvd24uJyA6ICcnO1xuICAgICQoJ3NwZWVkJykuc3R5bGUuZGlzcGxheSA9IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2ZsZXgnIDogJ25vbmUnO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zcGVlZF0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgK2IuZGF0YXNldC5zcGVlZCEgPT09IGcudGltZVNjYWxlKSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgYi5kYXRhc2V0LmNhbSA9PT0gZy5jYW1Nb2RlKSk7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QudG9nZ2xlKCdpbmJhdHRsZScsIHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nKTsgYXVkaW8uc2V0TW9kZShwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdiYXR0bGUnIDogJ2J1aWxkJyk7XG4gICAgLy8gb3ZlcmxheVxuICAgIGNvbnN0IG92ID0gJCgnb3ZlcmxheScpOyBvdi5jbGFzc05hbWUgPSAnJzsgb3YuaW5uZXJIVE1MID0gJyc7XG4gICAgaWYgKHBoID09PSAnZHJhZnQnICYmIGcuZHJhZnQpIHtcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+VmljdG9yeSBEcmFmdDwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPldhdmUgY2xlYXJlZC4gRG9taW5pb24gaXMgbm93ICR7cy5jYXB9LiBLZWVwIG9uZTo8L2Rpdj48ZGl2IGNsYXNzPVwicm93XCI+JHtnLmRyYWZ0Lm1hcCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IGA8ZGl2IGNsYXNzPVwiY2FyZCBiaWcke2hhc0FydChzb3VsKSA/ICcgYXJ0JyA6ICcnfVwiIGRhdGEtaT1cIiR7aX1cIiR7aGFzQXJ0KHNvdWwpID8gYCBzdHlsZT1cImJvcmRlci1jb2xvcjoke3Jhcml0eUNvbG9yKHNvdWwpfVwiYCA6ICcnfT48ZGl2IGNsYXNzPVwiY29zdFwiPiR7Y29zdChzb3VsLCAxKX08L2Rpdj4ke2hhc0FydChzb3VsKSA/IHBvcnRyYWl0SHRtbChzb3VsKSA6IElDT05bc291bF19PGRpdiBjbGFzcz1cIm5tXCI+JHtTT1VMX05BTUVbc291bF19PC9kaXY+PGRpdiBjbGFzcz1cInJvbGVcIj4ke1JPTEVfVEVYVFtzb3VsXX08L2Rpdj48L2Rpdj5gKS5qb2luKCcnKX08L2Rpdj48L2Rpdj5gO1xuICAgICAgb3YucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJy5jYXJkJykuZm9yRWFjaCgoYykgPT4gKGMub25jbGljayA9ICgpID0+IGcucGlja0RyYWZ0KCtjLmRhdGFzZXQuaSEpKSk7XG4gICAgfSBlbHNlIGlmIChwaCA9PT0gJ3dvbicgfHwgcGggPT09ICdsb3N0Jykge1xuICAgICAgY29uc3QgcncgPSBwaCA9PT0gJ3dvbicgPyBnLnJld2FyZCA6IG51bGwsIHNrID0gKG46IG51bWJlcikgPT4gc2t1bGxJbWdzKG4pO1xuICAgICAgY29uc3QgdW5sb2NrSHRtbCA9IHJ3ICYmIHJ3LnVubG9ja2VkICYmIHJ3LnVubG9ja2VkLmxlbmd0aCA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojN2VmMmM4O2ZvbnQtd2VpZ2h0OjcwMFwiPiR7aWNvbkltZygnY2hlY2snKX0gVW5sb2NrZWQ6ICR7cncudW5sb2NrZWQubWFwKChrOiBzdHJpbmcpID0+IGRlc2NyaWJlVW5sb2NrKGspKS5qb2luKCcgXFx1MDBiNyAnKX08L2Rpdj5gIDogJyc7XG4gICAgICBjb25zdCByZXdhcmRIdG1sID0gdW5sb2NrSHRtbCArIChydyA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7cncucGFjayA/IChydy5maXJzdCA/IGAke2ljb25JbWcoJ3Nob3AnKX0gRmlyc3QgY2xlYXIhIFlvdSBlYXJuZWQgYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gIDogYCR7aWNvbkltZygnc2hvcCcpfSBSZXBsYXkgcmV3YXJkOiBhICR7c2socncucGFjay50aWVyKX0gU291bCBQYWNrLmApIDogYFJlcGxheSBwcm9ncmVzcyAke3J3LnJlcGxheU1ldGVyfS8ke3J3LnJlcGxheU5lZWRlZH0gdG93YXJkIGEgU291bCBQYWNrLmB9PC9kaXY+YCA6ICcnKTtcbiAgICAgIGlmIChwaCA9PT0gJ2xvc3QnICYmIGlzRW5kbGVzcygpICYmIGcuZW5kbGVzcykgeyAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGVuZCBvZiBhbiBlbmRsZXNzIHJ1bjogaG93IGRlZXAsIGFueSByZWNvcmQsIHBhY2tzIGVhcm5lZFxuICAgICAgICBjb25zdCBlID0gZy5lbmRsZXNzLCByZWMgPSBlLmNsZWFyZWQgPiBlLnN0YXJ0QmVzdDtcbiAgICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5SdW4gb3ZlcjwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPllvdSBjbGVhcmVkICR7ZS5jbGVhcmVkfSB3YXZlJHtlLmNsZWFyZWQgPT09IDEgPyAnJyA6ICdzJ30uICR7cmVjID8gJzxiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YVwiPk5ldyBiZXN0IGRlcHRoITwvYj4nIDogJ0Jlc3Q6IHdhdmUgJyArIE1hdGgubWF4KGUuc3RhcnRCZXN0LCBlLmNsZWFyZWQpICsgJy4nfTwvZGl2PiR7ZS5wYWNrcyA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7aWNvbkltZygnc2hvcCcpfSAke2UucGFja3N9IFNvdWwgUGFjayR7ZS5wYWNrcyA9PT0gMSA/ICcnIDogJ3MnfSBlYXJuZWQgdGhpcyBydW4uPC9kaXY+YCA6ICc8ZGl2IGNsYXNzPVwic3ViXCI+Q2xlYXIgd2F2ZSAxMCB0byBlYXJuIGEgU291bCBQYWNrLjwvZGl2Pid9PGRpdiBjbGFzcz1cInJvd1wiPiR7ZS5wYWNrcyA/ICc8YnV0dG9uIGlkPVwidG9TaG9wXCIgY2xhc3M9XCJnb1wiPk9wZW4gcGFjazwvYnV0dG9uPicgOiAnJ308YnV0dG9uIGlkPVwiYWdhaW5cIiBjbGFzcz1cIiR7ZS5wYWNrcyA/ICdibHVlJyA6ICdnbyd9XCI+R28gYWdhaW48L2J1dHRvbj48YnV0dG9uIGlkPVwidG9Ib21lXCIgY2xhc3M9XCJibHVlXCI+SG9tZTwvYnV0dG9uPjwvZGl2PjwvZGl2PmA7XG4gICAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IGcubmV3RW5kbGVzcygpOyAkKCd0b0hvbWUnKS5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1ob21lJykpO1xuICAgICAgICBjb25zdCB0czIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG9TaG9wJyk7IGlmICh0czIpIHRzMi5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zaG9wJykpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+JHtwaCA9PT0gJ3dvbicgPyAnU3RhZ2UgY2xlYXJlZCEnIDogJ1N0YWdlIGxvc3QnfTwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPiR7Zy5sYXN0QmF0dGxlfTwvZGl2PiR7cmV3YXJkSHRtbH08ZGl2IGNsYXNzPVwicm93XCI+JHtydyAmJiBydy5wYWNrID8gJzxidXR0b24gaWQ9XCJ0b1Nob3BcIiBjbGFzcz1cImdvXCI+T3BlbiBwYWNrPC9idXR0b24+JyA6ICcnfTxidXR0b24gaWQ9XCJhZ2FpblwiIGNsYXNzPVwiJHtydyAmJiBydy5wYWNrID8gJ2JsdWUnIDogJ2dvJ31cIj4ke3BoID09PSAnd29uJyA/ICdQbGF5IGFnYWluJyA6ICdUcnkgYWdhaW4nfTwvYnV0dG9uPjxidXR0b24gaWQ9XCJ0b0hvbWVcIiBjbGFzcz1cImJsdWVcIj5Ib21lPC9idXR0b24+PC9kaXY+PC9kaXY+YDtcbiAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IGcubmV3UnVuKCk7ICQoJ3RvSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgICBjb25zdCB0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b1Nob3AnKTsgaWYgKHRzKSB0cy5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zaG9wJykpO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnJlbmRlckRlYnVnTGl2ZSgpO1xuICAgIGlmIChwaCA9PT0gJ2J1aWxkJykgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IGcucmVmcmFtZUJ1aWxkKCkpOyAgICAgLy8gYWZ0ZXIgbGF5b3V0OiBrZWVwIHRoZSBncmlkIGNsZWFyIG9mIHRoZSBoYW5kIGFuZCBidXR0b25zXG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgcGFuZWxcbiAgcHJpdmF0ZSByZW5kZXJEZWJ1ZygpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBkID0gdGhpcy5kYmc7IGlmICghZC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSkgeyBkLmlubmVySFRNTCA9ICcnOyByZXR1cm47IH1cbiAgICBjb25zdCByb3cgPSAobGFiZWw6IHN0cmluZywgb2JqOiBhbnksIGtleTogc3RyaW5nIHwgbnVtYmVyLCBtaW46IG51bWJlciwgbWF4OiBudW1iZXIsIHN0ZXA6IG51bWJlcikgPT4gYDxsYWJlbD4ke2xhYmVsfSA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiJHttaW59XCIgbWF4PVwiJHttYXh9XCIgc3RlcD1cIiR7c3RlcH1cIiB2YWx1ZT1cIiR7b2JqW2tleV19XCIgZGF0YS1vPVwiJHtsYWJlbH1cIj48c3Bhbj4ke29ialtrZXldfTwvc3Bhbj48L2xhYmVsPmA7XG4gICAgZC5pbm5lckhUTUwgPSBgPGI+RGVidWcgKGxpdmUpPC9iPiA8c3BhbiBpZD1cImRiZ2Zwc1wiPjwvc3Bhbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+U3RhciBtdWx0aXBsaWVycyAoYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHkpXG4gICAgICAgICR7cm93KCdIUCB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdIUCB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnU2l6ZSAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAxLCAxLCAxLjYsIDAuMDIpfSR7cm93KCdTaXplIDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDIsIDEsIDIsIDAuMDIpfTwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48dGFibGU+PHRyPjx0aD48L3RoPjx0aD5ocDwvdGg+PHRoPmRtZzwvdGg+PHRoPnJhdGU8L3RoPjx0aD5yYW5nZTwvdGg+PHRoPnNwZDwvdGg+PC90cj4ke1NPVUxTLm1hcCgoaykgPT4gYDx0cj48dGQ+JHtJQ09OW2tdfTwvdGQ+JHtbJ2hwJywgJ2RtZycsICdpbnRlcnZhbCcsICdyYW5nZScsICdzcGVlZCddLm1hcCgoZikgPT4gYDx0ZD48aW5wdXQgY2xhc3M9XCJudW1cIiBkYXRhLXNvdWw9XCIke2t9XCIgZGF0YS1mPVwiJHtmfVwiIHZhbHVlPVwiJHsoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2tdW2ZdfVwiPjwvdGQ+YCkuam9pbignJyl9PC90cj5gKS5qb2luKCcnKX08L3RhYmxlPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5EaWZmaWN1bHR5IDxzZWxlY3QgaWQ9XCJkRGlmZlwiPiR7WydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5QZXJmb3JtYW5jZTxicj48c21hbGwgaWQ9XCJkYmdQZXJmXCI+bWVhc3VyaW5nXHUyMDI2PC9zbWFsbD48YnI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRGcHNcIiAke2cuc2hvd0ZwcyA/ICdjaGVja2VkJyA6ICcnfT4gU2hvdyBGUFMgb24gdGhlIGJhdHRsZSBzY3JlZW48L2xhYmVsPiA8YnV0dG9uIGlkPVwiZFBlcmZcIj5Db3B5IHBlcmYgcmVwb3J0PC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkT2Rkc1wiPlRlc3Qgb2RkcyAoMjAwIGZpZ2h0cyk8L2J1dHRvbj4gPHNwYW4gaWQ9XCJkT2Rkc091dFwiPiR7dGhpcy5vZGRzfTwvc3Bhbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRDb3B5XCI+Q29weSByZXBvcnQ8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXNldFwiPlJlc2V0IGJhbGFuY2U8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXN0YXJ0XCI+UmVzdGFydCBzdGFnZTwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5BZGQgY2FyZCA8c2VsZWN0IGlkPVwiZENhcmRcIj4ke1NPVUxTLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCI+JHtTT1VMX05BTUVba119PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxidXR0b24gaWQ9XCJkQWRkXCI+KzwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZERvbVwiPisyIERvbWluaW9uPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5MYXN0IHRhcDogPHNwYW4gaWQ9XCJkYmd0YXBcIj4ke2cubGFzdFRhcEluZm99PC9zcGFuPjwvc21hbGw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5TZWVkICR7Zy5zZWVkfS4gQWRkIDxjb2RlPj9zZWVkPTc8L2NvZGU+IHRvIHRoZSBsaW5rIHRvIHJlcGxheSB0aGUgc2FtZSBkcmF3cy48L3NtYWxsPjwvZGl2PmA7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dFt0eXBlPXJhbmdlXScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmlucHV0ID0gKCkgPT4ge1xuICAgICAgY29uc3QgbGFiID0gaW5wLmRhdGFzZXQubyE7IGNvbnN0IHYgPSAraW5wLnZhbHVlOyAoaW5wLm5leHRFbGVtZW50U2libGluZyBhcyBIVE1MRWxlbWVudCkudGV4dENvbnRlbnQgPSBTdHJpbmcodik7XG4gICAgICBjb25zdCBzZXQ6IFJlY29yZDxzdHJpbmcsICgpID0+IHZvaWQ+ID0geyAnSFAgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsxXSA9IHYpLCAnSFAgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsyXSA9IHYpLCAnRGFtYWdlIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzFdID0gdiksICdEYW1hZ2UgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMl0gPSB2KSwgJ1NpemUgMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMV0gPSB2KSwgJ1NpemUgM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMl0gPSB2KSB9O1xuICAgICAgc2V0W2xhYl0oKTsgZy5hcHBseUJhbGFuY2VDaGFuZ2UoKTtcbiAgICB9KSk7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dC5udW0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25jaGFuZ2UgPSAoKSA9PiB7IChCQUxBTkNFLnN0YXRzIGFzIGFueSlbaW5wLmRhdGFzZXQuc291bCFdW2lucC5kYXRhc2V0LmYhXSA9ICtpbnAudmFsdWU7IH0pKTtcbiAgICAkKCdkRGlmZicpLm9uY2hhbmdlID0gKGUpID0+IGcuY2hhbmdlRGlmZmljdWx0eSgoZS50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlKTtcbiAgICAkKCdkTWVyZ2VIYW5kJykub25jaGFuZ2UgPSAoZSkgPT4geyBnLnMucnVsZXMubWVyZ2UgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZCA/ICdoYW5kSW50b09uZVN0YXInIDogJ2RlcGxveWVkT25seSc7IGcuc3luY0J1aWxkKCk7IHRoaXMucmVuZGVyKCk7IH07XG4gICAgJCgnZE9kZHMnKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCByID0gZy50ZXN0T2RkcygyMDApOyB0aGlzLm9kZHMgPSBgJHtyLndpbn0lIHdpbiAoJHtyLm59IGZpZ2h0cywgYXZnICR7ci5hdmdUaW1lfXMpIHZzIHdhdmUgJHtnLnMud2F2ZX1gOyAkKCdkT2Rkc091dCcpLnRleHRDb250ZW50ID0gdGhpcy5vZGRzOyB9O1xuICAgICQoJ2RDb3B5Jykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucmVwb3J0KCk7IChuYXZpZ2F0b3IuY2xpcGJvYXJkID8gbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCkgOiBQcm9taXNlLnJlamVjdCgpKS50aGVuKCgpID0+IHRoaXMudG9hc3QoJ1JlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RGcHMnKS5vbmNoYW5nZSA9IChlKSA9PiBnLnNldFNob3dGcHMoKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQpO1xuICAgICQoJ2RQZXJmJykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucGVyZlJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdQZXJmIHJlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RSZXNldCcpLm9uY2xpY2sgPSAoKSA9PiB7IGcucmVzZXRCYWxhbmNlQWxsKCk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICAkKCdkUmVzdGFydCcpLm9uY2xpY2sgPSAoKSA9PiBnLnN0YXJ0U3RhZ2UoZy5zZWVkKTtcbiAgICAkKCdkQWRkJykub25jbGljayA9ICgpID0+IGcuYWRkQ2FyZCgoJCgnZENhcmQnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUgYXMgU291bElkKTsgJCgnZERvbScpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZERvbWluaW9uKDIpO1xuICB9XG4gIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ1BlcmYnKTsgaWYgKHBmKSB7IGNvbnN0IHAgPSB0aGlzLmcucGVyZkluZm8oKTsgcGYudGV4dENvbnRlbnQgPSBgJHtwLmZwcy50b0ZpeGVkKDApfSBmcHMgXHUwMEI3IGF2ZyAke3AuYXZnLnRvRml4ZWQoMSl9bXMgXHUwMEI3IHNsb3c1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMgXHUwMEI3IHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIFx1MDBCNyAke3AubWVzaGVzfSBtZXNoZXMgXHUwMEI3ICR7cC5wYXJ0aWNsZXN9IHBhcnRpY2xlIHN5c3RlbXMgXHUwMEI3ICR7cC5kcmF3c30gZHJhdyBjYWxsc2A7IH1cbiAgICBjb25zdCB0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ3RhcCcpOyBpZiAodCkgdC50ZXh0Q29udGVudCA9IHRoaXMuZy5sYXN0VGFwSW5mbztcbiAgfVxufVxuIiwgIi8vIFRoZSBwbGF5YWJsZSBwcm90b3R5cGU6IGJ1aWxkIHNjcmVlbiAtPiBiYXR0bGUgLT4gZHJhZnQgLT4gbmV4dCB3YXZlLCBidWlsdCBvbiB0aGUgdGVzdGVkIHJ1bGVzICsgYmF0dGxlIGVuZ2luZS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSwgcmVzZXRCYWxhbmNlLCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgR1JJRF9DRUxMUywgR1JJRF9DT0xTLCBHUklEX1JPV1MsIFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7XG4gIGFkdmFuY2VXYXZlLCBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNlbGxGcmVlLCBjb3N0LCBkaXNjYXJkUmVkcmF3LCBkaXNtaXNzLCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgZHJhZnRPcHRpb25zLCBmYWlsV2F2ZSxcbiAgbWVyZ2VEZXBsb3llZCwgbWVyZ2VGcm9tSGFuZCwgbW92ZVVuaXQsIG5ld1N0YWdlLCBub3JtYWxEcmF3LCBzdGFnZVdhdmVzLCBzdW1tb24sIHN3YXBTZWxsLCB0YWtlRHJhZnQsXG59IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgYnVpbGRBcmVuYSB9IGZyb20gJy4vYXJlbmEudHMnO1xuaW1wb3J0IHsgQmF0dGxlLCBjZWxsUG9zLCBGUk9OVF9YLCBHUklEX1NQLCBzaW11bGF0ZSB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB0eXBlIHsgQkV2ZW50IH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHsgY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lLCBlbmVteVBvd2VyLCBlbmVteVdhdmUsIGlzRW5kbGVzcywgc2V0RGlmZmljdWx0eSwgc2V0RW5kbGVzcywgc2V0U3RhZ2VEaWZmaWN1bHR5IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBFTkRMRVNTX0lELCBFTkRMRVNTX1BBQ0tfRVZFUlkgfSBmcm9tICcuLi9jb3JlL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19SVUxFUywgUFJPVE9UWVBFX1JVTEVTIH0gZnJvbSAnLi4vY29yZS9wcm90b3R5cGUudHMnO1xuaW1wb3J0IHsgbG9hZFNhdmUgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuaW1wb3J0IHsgTmVjcm9tYW5jZXIgfSBmcm9tICcuL25lY3JvbWFuY2VyLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgeyBjbGVhclJ1biwgbG9hZFJ1biwgc2F2ZVJ1biwgc2VyaWFsaXplU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bnNhdmUudHMnO1xuaW1wb3J0IHsgcGxheWFibGUsIHJlY29yZENsZWFyQW5kU2F2ZSwgcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5pbXBvcnQgdHlwZSB7IENsZWFyUmV3YXJkIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1blNuYXBzaG90IH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGNyZWF0ZVZpc3VhbCwgaXNUcmlwbywgbG9hZEFzc2V0cyB9IGZyb20gJy4vdmlzdWFscy50cyc7XG5pbXBvcnQgdHlwZSB7IEFzc2V0cywgVW5pdFZpc3VhbCB9IGZyb20gJy4vdmlzdWFscy50cyc7XG5pbXBvcnQgeyBVaSB9IGZyb20gJy4vdWkudHMnO1xuXG5leHBvcnQgdHlwZSBQaGFzZSA9ICdidWlsZCcgfCAndHJhbnNpdGlvbicgfCAnYmF0dGxlJyB8ICdkcmFmdCcgfCAnd29uJyB8ICdsb3N0JztcbnR5cGUgU2VsID0geyB0eXBlOiAnY2FyZCc7IGlkeDogbnVtYmVyIH0gfCB7IHR5cGU6ICd1bml0JzsgaWQ6IG51bWJlciB9IHwgbnVsbDtcblxuZXhwb3J0IGNsYXNzIEdhbWUge1xuICBlbmdpbmU6IGFueTsgc2NlbmU6IGFueTsgY2FtZXJhOiBhbnk7IEEhOiBBc3NldHM7IHVpITogVWk7XG4gIHMhOiBTdGF0ZTsgc2VlZCA9IDE7IGF0dGVtcHQgPSAwOyBwaGFzZTogUGhhc2UgPSAnYnVpbGQnOyBiYXR0bGU6IEJhdHRsZSB8IG51bGwgPSBudWxsOyB0aW1lU2NhbGUgPSAxO1xuICBzZWw6IFNlbCA9IG51bGw7IHN3YXBNb2RlID0gZmFsc2U7IGNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgZHJhZnQ6IFNvdWxJZFtdIHwgbnVsbCA9IG51bGw7IGxhc3RCYXR0bGUgPSAnJztcbiAgcHJpdmF0ZSB1bml0VmlzID0gbmV3IE1hcDxudW1iZXIsIFVuaXRWaXN1YWw+KCk7ICAgICAgICAvLyB1bml0IGlkIC0+IHZpc3VhbCAoeW91ciBhcm15LCBwZXJzaXN0cyBiZXR3ZWVuIHdhdmVzKVxuICBwcml2YXRlIHZpc1RvVW5pdCA9IG5ldyBNYXA8VW5pdFZpc3VhbCwgbnVtYmVyPigpO1xuICBwcml2YXRlIGZ2aXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgICAgIC8vIGZpZ2h0ZXIgaWQgLT4gdmlzdWFsIGR1cmluZyBhIGJhdHRsZVxuICBwcml2YXRlIGZVbml0ID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKTsgICAgICAgICAgICAgIC8vIGZpZ2h0ZXIgaWQgLT4gdW5pdCBpZCAocGxheWVyIHNpZGUpXG4gIHByaXZhdGUgbGFzdFN0YXRlID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZz4oKTtcbiAgcHJpdmF0ZSBhcmVuYSE6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHNldFRoZW1lKHN0YWdlOiBzdHJpbmcpOiB2b2lkIH07XG4gIHByaXZhdGUgdGlsZXM6IGFueVtdID0gW107IHByaXZhdGUgdGlsZU1hdHM6IGFueVtdID0gW107IHByaXZhdGUgcmluZ0Z4OiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93czogYW55W10gPSBbXTsgcHJpdmF0ZSB0aW1lcnM6IHsgdDogbnVtYmVyOyBmbjogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSBhY2MgPSAwOyBwcml2YXRlIGNhbUZyb206IGFueSA9IG51bGw7IHByaXZhdGUgY2FtVG86IGFueSA9IG51bGw7IHByaXZhdGUgY2FtVCA9IDE7IHByaXZhdGUgY2FtRHVyID0gMi4wOyBwcml2YXRlIHJlc3VsdEF0ID0gLTE7IHByaXZhdGUgaGFuZGxlZCA9IGZhbHNlOyBwcml2YXRlIHN0YXJ0U3RlcEF0ID0gMDtcbiAgcHJpdmF0ZSBhcnJvd01hdHM6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dNZXNoOiBhbnlbXSA9IFtdO1xuICBuZWNybyE6IE5lY3JvbWFuY2VyO1xuICAvKiogV2hhdCB0aGUgbGFzdCBzdGFnZSBjbGVhciBlYXJuZWQgKHNob3duIG9uIHRoZSBzdGFnZS1jbGVhcmVkIHNjcmVlbikuICovXG4gIHJld2FyZDogQ2xlYXJSZXdhcmQgfCBudWxsID0gbnVsbDtcbiAgLyoqIFRoZSBlbmRsZXNzIHJ1biBpbiBwcm9ncmVzczogdGhlIGJlc3QgZGVwdGggd2hlbiBpdCBiZWdhbiAodG8gc3BvdCBhIG5ldyByZWNvcmQpLCB0aGUgd2F2ZXMgY2xlYXJlZCBzbyBmYXIsIGFuZCB0aGUgcGFja3MgZWFybmVkLiAqL1xuICBlbmRsZXNzOiB7IHN0YXJ0QmVzdDogbnVtYmVyOyBjbGVhcmVkOiBudW1iZXI7IHBhY2tzOiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNpbmUgPSBmYWxzZTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgcmVzdWx0IGN1dHNjZW5lIGlzIHBsYXlpbmc6IHRoZSBiYXR0bGUgY2FtZXJhIGFuZCBmaWdodGVyIHN5bmMgc3RhbmQgZG93blxuICBwcml2YXRlIHR3ZWVuczogeyB0OiBudW1iZXI7IGR1cjogbnVtYmVyOyBmbjogKHU6IG51bWJlcikgPT4gdm9pZDsgZG9uZT86ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgdHdlZW4oZHVyOiBudW1iZXIsIGZuOiAodTogbnVtYmVyKSA9PiB2b2lkLCBkb25lPzogKCkgPT4gdm9pZCkgeyB0aGlzLnR3ZWVucy5wdXNoKHsgdDogMCwgZHVyLCBmbiwgZG9uZSB9KTsgfVxuICAvKiogRmluaXNoIGV2ZXJ5IHJ1bm5pbmcgYW5pbWF0aW9uIGF0IG9uY2UgKHNvIG5vdGhpbmcgaXMgbGVmdCBoYWxmLXdheSBvciB1bmRpc3Bvc2VkIHdoZW4gdGhlIHBoYXNlIGNoYW5nZXMpLiAqL1xuICBwcml2YXRlIGZsdXNoVHdlZW5zKCkgeyBmb3IgKGNvbnN0IHcgb2YgdGhpcy50d2VlbnMuc3BsaWNlKDApKSB7IHcuZm4oMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgcHJpdmF0ZSBzZWVuTWVyZ2VzID0gMDtcblxuICBhc3luYyBpbml0KGNhbnZhczogSFRNTENhbnZhc0VsZW1lbnQpIHtcbiAgICBjb25zdCBxcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKTtcbiAgICB0aGlzLmVuZ2luZSA9IG5ldyBCQUJZTE9OLkVuZ2luZShjYW52YXMsIHRydWUsIHsgYW50aWFsaWFzOiB0cnVlLCBwb3dlclByZWZlcmVuY2U6ICdoaWdoLXBlcmZvcm1hbmNlJyB9KTtcbiAgICBjb25zdCBkcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxOyB0aGlzLmVuZ2luZS5zZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgxIC8gTWF0aC5taW4oZHByLCAxLjUpKTtcbiAgICBjb25zdCBzY2VuZSA9IHRoaXMuc2NlbmUgPSBuZXcgQkFCWUxPTi5TY2VuZSh0aGlzLmVuZ2luZSk7IHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wOSwgMC4wNywgMC4xMywgMSk7XG4gICAgY29uc3QgaGVtaSA9IG5ldyBCQUJZTE9OLkhlbWlzcGhlcmljTGlnaHQoJ2gnLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMSwgMC4zKSwgc2NlbmUpOyBoZW1pLmludGVuc2l0eSA9IDEuMDU7IGhlbWkuZ3JvdW5kQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4zMiwgMC4yNiwgMC40Mik7XG4gICAgY29uc3Qgc3VuID0gbmV3IEJBQllMT04uRGlyZWN0aW9uYWxMaWdodCgncycsIG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuNCwgLTEsIDAuNTUpLCBzY2VuZSk7IHN1bi5pbnRlbnNpdHkgPSAwLjg1O1xuICAgIHRoaXMuY2FtZXJhID0gbmV3IEJBQllMT04uRnJlZUNhbWVyYSgnY2FtJywgbmV3IEJBQllMT04uVmVjdG9yMygwLCA4LCAtOSksIHNjZW5lKTsgdGhpcy5jYW1lcmEubWluWiA9IDAuMTsgdGhpcy5jYW1lcmEubWF4WiA9IDIwMDsgdGhpcy5jYW1lcmEuZm92ID0gMC44OyB0aGlzLmNhbWVyYS5pbnB1dHMuY2xlYXIoKTtcblxuICAgIGNvbnN0IGdyb3VuZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdncm91bmQnLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0MCB9LCBzY2VuZSk7XG4gICAgZ3JvdW5kLmlzUGlja2FibGUgPSBmYWxzZTsgY29uc3QgYXJlbmEgPSB0aGlzLmFyZW5hID0gYnVpbGRBcmVuYShzY2VuZSwgZ3JvdW5kKTsgc2NlbmUub25CZWZvcmVSZW5kZXJPYnNlcnZhYmxlLmFkZCgoKSA9PiBhcmVuYS51cGRhdGUocGVyZm9ybWFuY2Uubm93KCkgLyAxMDAwKSk7XG4gICAgZm9yIChjb25zdCB0ZWFtIG9mIFswLCAxXSBhcyBjb25zdCkgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHsgY29uc3QgdCA9IHRoaXMubWFrZVRpbGUodGVhbSwgYyk7IGlmICh0ZWFtID09PSAwKSB0aGlzLnRpbGVzLnB1c2godCk7IGVsc2UgdC5zZXRFbmFibGVkKGZhbHNlKTsgfVxuXG4gICAgdGhpcy5BID0gYXdhaXQgbG9hZEFzc2V0cyhzY2VuZSk7XG4gICAgdGhpcy5uZWNybyA9IG5ldyBOZWNyb21hbmNlcihzY2VuZSwgdGhpcy5BLnNvZnQpOyAgICAgICAvLyBzdGFuZHMganVzdCBiZWhpbmQgaGlzIGFybXkncyBiYWNrIGNvbHVtbiwgZmFjaW5nIHRoZSBiYXR0bGVmaWVsZFxuICAgIHRoaXMubmVjcm8uaG9sZGVyLnBvc2l0aW9uLnNldCgtKEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAtIDEuMDUsIDAsIDApOyB0aGlzLm5lY3JvLmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7XG4gICAgdGhpcy5hcnJvd01hdHMgPSBbMCwgMV0ubWFwKCh0KSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdhbScgKyB0LCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjMsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNywgMC4yNSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcmV0dXJuIG07IH0pO1xuICAgIHRoaXMudWkgPSBuZXcgVWkodGhpcyk7IHRoaXMuc2VlZCA9ICsocXMuZ2V0KCdzZWVkJykgfHwgMSk7IGlmIChxcy5nZXQoJ2ZwcycpKSB0aGlzLnNldFNob3dGcHModHJ1ZSk7XG5cbiAgICAvLyBUYXBzIGFyZSBkZXRlY3RlZCBoZXJlIChub3QgdGhyb3VnaCBCYWJ5bG9uKSBzbyB0aGV5IGJlaGF2ZSB0aGUgc2FtZSBpbiBTYWZhcmksIHRoZSBob21lLXNjcmVlbiBhcHAgYW5kIG9uIGRlc2t0b3AuXG4gICAgbGV0IGRvd246IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbG9jYWwgPSAoZTogUG9pbnRlckV2ZW50KSA9PiB7IGNvbnN0IHIgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7IHJldHVybiB7IHg6IGUuY2xpZW50WCAtIHIubGVmdCwgeTogZS5jbGllbnRZIC0gci50b3AgfTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmRvd24nLCAoZSkgPT4geyBkb3duID0geyAuLi5sb2NhbChlKSwgdDogcGVyZm9ybWFuY2Uubm93KCkgfTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJ1cCcsIChlKSA9PiB7IGlmICghZG93bikgcmV0dXJuOyBjb25zdCBwID0gbG9jYWwoZSk7IGNvbnN0IG1vdmVkID0gTWF0aC5oeXBvdChwLnggLSBkb3duLngsIHAueSAtIGRvd24ueSksIGR0ID0gcGVyZm9ybWFuY2Uubm93KCkgLSBkb3duLnQ7IGRvd24gPSBudWxsOyBpZiAobW92ZWQgPCAxNiAmJiBkdCA8IDkwMCkgdGhpcy50YXAocC54LCBwLnkpOyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmNhbmNlbCcsICgpID0+IHsgZG93biA9IG51bGw7IH0pO1xuICAgIHRoaXMuY2FudmFzID0gY2FudmFzOyBjb25zdCBvblJlc2l6ZSA9ICgpID0+IHRoaXMuaGFuZGxlUmVzaXplKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTsgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ29yaWVudGF0aW9uY2hhbmdlJywgKCkgPT4gc2V0VGltZW91dChvblJlc2l6ZSwgMjUwKSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydCkgKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKSBuZXcgKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKG9uUmVzaXplKS5vYnNlcnZlKGNhbnZhcyk7XG4gICAgaWYgKHFzLmdldCgnZ2FsbGVyeScpKSB7IHRoaXMuZ2FsbGVyeSgpOyByZXR1cm47IH1cbiAgICBjb25zdCBzYXZlZCA9IHFzLmdldCgnc2VlZCcpID8gbnVsbCA6IGxvYWRSdW4oKTsgICAgICAgICAgICAgICAgLy8gP3NlZWQ9TiBhbHdheXMgc3RhcnRzIGZyZXNoIChkZWJ1Z2dpbmcpOyBvdGhlcndpc2UgcGljayB1cCB3aGVyZSB0aGUgbGFzdCB2aXNpdCBsZWZ0IG9mZlxuICAgIGlmIChzYXZlZCkgdGhpcy5yZXN0b3JlKHNhdmVkKTsgZWxzZSB0aGlzLnN0YXJ0U3RhZ2UodGhpcy5zZWVkKTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKSwgcmF3ID0gbm93IC0gbGFzdDsgY29uc3QgZHQgPSBNYXRoLm1pbigwLjA1LCByYXcgLyAxMDAwKTsgbGFzdCA9IG5vdzsgaWYgKCF0aGlzLmFjdGl2ZSkgcmV0dXJuOyBpZiAoIXRoaXMuZnJvemVuKSB0aGlzLmZyYW1lKGR0KTsgc2NlbmUucmVuZGVyKCk7IHRoaXMucGVyZlRpY2socmF3KTsgfSk7XG4gIH1cbiAgLyoqIFRoZSBuYXZpZ2F0aW9uIHNoZWxsIGhpZGVzIHRoZSBiYXR0bGUgc2NyZWVuIHdoaWxlIGFub3RoZXIgdGFiIGlzIG9wZW46IHBhdXNlIHRoZSBnYW1lIHNvIGl0IGNvc3RzIG5vdGhpbmcuICovXG4gIHByaXZhdGUgYWN0aXZlID0gdHJ1ZTtcbiAgLyoqIERlYnVnOiBrZWVwIGRyYXdpbmcgYnV0IHN0b3AgYWR2YW5jaW5nIHRpbWUsIHNvIGEgbW9tZW50IGNhbiBiZSBzdGVwcGVkIHRocm91Z2ggd2l0aCBmcmFtZShkdCkgYW5kIHNjcmVlbnNob3R0ZWQuICovXG4gIGZyb3plbiA9IGZhbHNlO1xuICBzdGVwKGR0OiBudW1iZXIpIHsgdGhpcy5mcmFtZShkdCk7IH1cbiAgc2V0QWN0aXZlKG9uOiBib29sZWFuKSB7IHRoaXMuYWN0aXZlID0gb247IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzY2VuZSBoZWxwZXJzXG4gIC8qKiBUaGUgcGxhY2VtZW50IGdyaWQgaXMgYSBidWlsZC1zY3JlZW4gdG9vbDogaGlkZSBpdCBkdXJpbmcgdGhlIGZpZ2h0IHNvIHRoZSBiYXR0bGUgbG9va3MgbGlrZSBhIHNjZW5lLCBub3QgYSBib2FyZC4gKi9cbiAgcHJpdmF0ZSBzaG93R3JpZChvbjogYm9vbGVhbikgeyBmb3IgKGNvbnN0IHQgb2YgdGhpcy50aWxlcykgdC5zZXRFbmFibGVkKG9uKTsgfVxuICBwcml2YXRlIG1ha2VUaWxlKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKSwgdCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3RpbGUnICsgY2VsbCwgeyBzaXplOiBHUklEX1NQICogMC45MiB9LCB0aGlzLnNjZW5lKTtcbiAgICB0LnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdC5wb3NpdGlvbi5zZXQocC54LCAwLjAxNSwgcC56KTtcbiAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndG0nLCB0aGlzLnNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuMTgsIDAuMTIsIDAuNDIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNDIsIDAuMTIsIDAuMTIpOyBtLmFscGhhID0gMC41OyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHQubWF0ZXJpYWwgPSBtO1xuICAgIGlmICh0ZWFtID09PSAwKSB7IHQubWV0YWRhdGEgPSB7IGtpbmQ6ICd0aWxlJywgY2VsbCB9OyB0aGlzLnRpbGVNYXRzW2NlbGxdID0gbTsgfSBlbHNlIHQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHJldHVybiB0O1xuICB9XG4gIHByaXZhdGUgdGludChjZWxsOiBudW1iZXIsIG1vZGU6ICdub3JtYWwnIHwgJ2ZyZWUnIHwgJ3NlbCcgfCAncGFydG5lcicpIHtcbiAgICBjb25zdCBtID0gdGhpcy50aWxlTWF0c1tjZWxsXTsgY29uc3QgYyA9IHsgbm9ybWFsOiBbMC4xOCwgMC4xMiwgMC40MiwgMC41XSwgZnJlZTogWzAuMiwgMC43NSwgMC41NSwgMC43XSwgc2VsOiBbMSwgMC44MiwgMC4zLCAwLjg1XSwgcGFydG5lcjogWzAuODUsIDAuMzUsIDEsIDAuODVdIH1bbW9kZV07XG4gICAgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pOyBtLmFscGhhID0gY1szXTtcbiAgfVxuICBsYXRlcihzZWM6IG51bWJlciwgZm46ICgpID0+IHZvaWQpIHsgdGhpcy50aW1lcnMucHVzaCh7IHQ6IHNlYywgZm4gfSk7IH1cbiAgcHJpdmF0ZSBmeFJpbmcoeDogbnVtYmVyLCB6OiBudW1iZXIsIGNvbG9yOiBhbnksIHIwOiBudW1iZXIsIHIxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2Z4JywgeyBkaWFtZXRlcjogMSwgdGhpY2tuZXNzOiAwLjAzNSwgdGVzc2VsbGF0aW9uOiAyOCB9LCB0aGlzLnNjZW5lKTsgbS5wb3NpdGlvbi5zZXQoeCwgMC4wNSwgeik7IG0uaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG1tID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZnhtJywgdGhpcy5zY2VuZSk7IG1tLmVtaXNzaXZlQ29sb3IgPSBjb2xvcjsgbW0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbW0uYWxwaGEgPSAwLjk7IG0ubWF0ZXJpYWwgPSBtbTsgdGhpcy5yaW5nRngucHVzaCh7IG0sIG1tLCB0OiAwLCByMCwgcjEsIGR1ciB9KTtcbiAgfVxuICBwcml2YXRlIGJ1cnN0KHg6IG51bWJlciwgejogbnVtYmVyLCBjMTogbnVtYmVyW10sIGMyOiBudW1iZXJbXSwgY291bnQ6IG51bWJlcikge1xuICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2InLCA2MCwgdGhpcy5zY2VuZSk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCAwLjA1LCB6KTsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMC4wNSwgMC4yKTtcbiAgICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMxIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzIgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMSwgMCwgMC4yLCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4xMjsgcHMubWF4U2l6ZSA9IDAuMzQ7IHBzLm1pbkxpZmVUaW1lID0gMC40OyBwcy5tYXhMaWZlVGltZSA9IDAuOTsgcHMuZW1pdFJhdGUgPSAwOyBwcy5tYW51YWxFbWl0Q291bnQgPSBjb3VudDsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEsIDEuMywgLTEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygxLCAyLjQsIDEpO1xuICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuODsgcHMubWF4RW1pdFBvd2VyID0gMjsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgLTIsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnRhcmdldFN0b3BEdXJhdGlvbiA9IDEuMjsgcHMuZGlzcG9zZU9uU3RvcCA9IHRydWU7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBjYW1lcmFcbiAgcHJpdmF0ZSBwb3NlcygpIHtcbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCBoYWxmID0gRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1AgKyAxLjQ7XG4gICAgY29uc3QgZCA9IE1hdGgubWF4KGhhbGYgLyAodGFuViAqIGFzcCksICgoR1JJRF9ST1dTICogR1JJRF9TUCkgLyAyICsgMikgLyAodGFuViAqIDAuNTUpLCA4KTtcbiAgICBjb25zdCBiYXR0bGUgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMygtMC4xICogZCwgMC40MiAqIGQgKyAwLjUsIC0wLjg2ICogZCksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjM1LCAwKSB9O1xuICAgIC8vIEJ1aWxkIHZpZXc6IChhbG1vc3QpIHN0cmFpZ2h0IGRvd24sIHdpdGggdGhlIHdob2xlIGdyaWQgaW5zaWRlIHRoZSBiYW5kIGJldHdlZW4gdGhlIHRvcCBiYXIgYW5kIHRoZSBoYW5kIG9mIGNhcmRzLlxuICAgIGNvbnN0IGN4ID0gLShGUk9OVF9YICsgKChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC8gMiksIEggPSBNYXRoLm1heCgxLCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpO1xuICAgIGNvbnN0IGJveCA9IChpZDogc3RyaW5nKSA9PiB7IGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOyByZXR1cm4gZWwgJiYgZWwub2Zmc2V0UGFyZW50ICE9PSBudWxsID8gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkgOiBudWxsOyB9O1xuICAgIGNvbnN0IHRvcEJhciA9IGJveCgndG9wJyksIGhhbmQgPSBib3goJ2hhbmQnKSwgaW5mbyA9IGJveCgnaW5mbycpO1xuICAgIGNvbnN0IFRPUCA9IE1hdGgubWluKDAuMzIsIHRvcEJhciA/ICh0b3BCYXIuYm90dG9tICsgNikgLyBIIDogMC4xKTtcbiAgICBjb25zdCBCT1RUT00gPSBNYXRoLm1pbigwLjUsIChIIC0gTWF0aC5taW4oaGFuZCA/IGhhbmQudG9wIDogSCwgaW5mbyA/IGluZm8udG9wIDogSCkgKyA2KSAvIEgpO1xuICAgIGNvbnN0IGJhbmQgPSBNYXRoLm1heCgwLjMsIDEgLSBUT1AgLSBCT1RUT00pLCBjZW50ZXJGcmFjID0gVE9QICsgYmFuZCAvIDI7ICAgICAgICAgIC8vIHRoZSBncmlkJ3MgY2VudHJlIGFwcGVhcnMgYXQgdGhpcyBmcmFjdGlvbiBmcm9tIHRoZSB0b3BcbiAgICBjb25zdCBndyA9IEdSSURfQ09MUyAqIEdSSURfU1AgKyAzLjIsIGdoID0gR1JJRF9ST1dTICogR1JJRF9TUCArIDAuNTsgICAgICAgICAgICAgICAgLy8gdGhlIHdpZHRoIGFsc28gbGVhdmVzIHJvb20gZm9yIHRoZSBOZWNyb21hbmNlciBiZXNpZGUgdGhlIGdyaWRcbiAgICBjb25zdCBkMiA9IE1hdGgubWF4KGdoIC8gKDIgKiB0YW5WICogYmFuZCksIGd3IC8gKDIgKiB0YW5WICogYXNwICogMC44OCksIDQuNSk7XG4gICAgY29uc3Qgc2hpZnQgPSAoMC41IC0gY2VudGVyRnJhYykgKiAyICogZDIgKiB0YW5WLCBieCA9IGN4IC0gMC42O1xuICAgIGNvbnN0IGJ1aWxkID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIGQyLCAtc2hpZnQgLSAwLjEgKiBkMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMyhieCwgMCwgLXNoaWZ0KSB9O1xuICAgIGNvbnN0IG5lY3JvID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYmF0dGxlLnBvcy54IC0gMS40LCBiYXR0bGUucG9zLnkgKiAxLjEyLCBiYXR0bGUucG9zLnogKiAxLjEyKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLjQsIDAuMzUsIDApIH07ICAgLy8gcmVzdWx0IGN1dHNjZW5lczogaGltIGFuZCB0aGUgZmllbGRcbiAgICByZXR1cm4geyBiYXR0bGUsIGJ1aWxkLCBuZWNybyB9O1xuICB9XG4gIC8qKiBUaGUgaGFuZCAvIGluZm8gYmFyIGNhbiBjaGFuZ2Ugc2l6ZSBpbiB0aGUgYnVpbGQgcGhhc2UgKGxvbmcgYWJpbGl0eSB0ZXh0LCBtb3JlIGNhcmRzKTogcmUtZnJhbWUgc28gdGhlIGdyaWQgbmV2ZXIgaGlkZXMgYmVoaW5kIGl0LiAqL1xuICByZWZyYW1lQnVpbGQoKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgdGhpcy5jYW1UIDwgMSB8fCB0aGlzLmNpbmUgfHwgIXRoaXMuY2FudmFzKSByZXR1cm47XG4gICAgY29uc3QgcCA9IHRoaXMucG9zZXMoKS5idWlsZCwgYyA9IHRoaXMuY2FtZXJhLnBvc2l0aW9uO1xuICAgIGlmICghaXNGaW5pdGUocC5wb3MueCkgfHwgQkFCWUxPTi5WZWN0b3IzLkRpc3RhbmNlKGMsIHAucG9zKSA8IDAuMDYpIHJldHVybjtcbiAgICB0aGlzLnR3ZWVuQ2FtKHAsIDAuMzUpO1xuICB9XG4gIHByaXZhdGUgY2FudmFzITogSFRNTENhbnZhc0VsZW1lbnQ7IHByaXZhdGUgbGFzdFcgPSAwOyBwcml2YXRlIGxhc3RIID0gMDsgbGFzdFRhcEluZm8gPSAnKG5vIHRhcHMgeWV0KSc7XG4gIHByaXZhdGUgaGFuZGxlUmVzaXplKCkge1xuICAgIGlmICghdGhpcy5jYW52YXMuY2xpZW50V2lkdGggfHwgIXRoaXMuY2FudmFzLmNsaWVudEhlaWdodCkgcmV0dXJuOyAgIC8vIGhpZGRlbiBiZWhpbmQgYW5vdGhlciB0YWJcbiAgICB0aGlzLmVuZ2luZS5yZXNpemUoKTsgdGhpcy5sYXN0VyA9IHRoaXMuY2FudmFzLmNsaWVudFdpZHRoOyB0aGlzLmxhc3RIID0gdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnICYmIHRoaXMuY2FtVCA+PSAxKSB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpO1xuICB9XG4gIC8qKiBBIHRhcCBvbiB0aGUgM0QgdmlldzogcGljayBhIHRpbGUgb3IgYSB1bml0LiAqL1xuICBwcml2YXRlIHRhcCh4OiBudW1iZXIsIHk6IG51bWJlcikge1xuICAgIGNvbnN0IHAgPSB0aGlzLnNjZW5lLnBpY2soeCwgeSwgKG06IGFueSkgPT4gISEobS5tZXRhZGF0YSAmJiBtLm1ldGFkYXRhLmtpbmQpKTtcbiAgICBjb25zdCBtZCA9IHAgJiYgcC5oaXQgPyBwLnBpY2tlZE1lc2gubWV0YWRhdGEgOiBudWxsO1xuICAgIHRoaXMubGFzdFRhcEluZm8gPSBgdGFwICR7TWF0aC5yb3VuZCh4KX0sJHtNYXRoLnJvdW5kKHkpfSBvZiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gLT4gJHttZCA/IChtZC5raW5kID09PSAndGlsZScgPyAndGlsZSAnICsgbWQuY2VsbCA6ICd1bml0JykgOiAnbm90aGluZyd9IChwaGFzZSAke3RoaXMucGhhc2V9KWA7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgIW1kKSByZXR1cm47XG4gICAgaWYgKG1kLmtpbmQgPT09ICd0aWxlJykgdGhpcy5vblRpbGUobWQuY2VsbCk7IGVsc2UgaWYgKG1kLmtpbmQgPT09ICd1bml0JykgdGhpcy5vblVuaXRWaXN1YWwobWQudmlzdWFsKTtcbiAgfVxuICBwcml2YXRlIHNldENhbShwOiBhbnkpIHsgdGhpcy5jYW1lcmEucG9zaXRpb24uY29weUZyb20ocC5wb3MpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQocC50Z3QuY2xvbmUoKSk7IH1cbiAgcHJpdmF0ZSB0d2VlbkNhbSh0bzogYW55LCBkdXI6IG51bWJlcikgeyB0aGlzLmNhbUZyb20gPSB7IHBvczogdGhpcy5jYW1lcmEucG9zaXRpb24uY2xvbmUoKSwgdGd0OiB0aGlzLmNhbWVyYS5nZXRUYXJnZXQoKS5jbG9uZSgpIH07IHRoaXMuY2FtVG8gPSB0bzsgdGhpcy5jYW1UID0gMDsgdGhpcy5jYW1EdXIgPSBkdXI7IH1cblxuICAvLyAtLS0tIGJhdHRsZSBjYW1lcmE6IGZvbGxvd3MgdGhlIGZpZ2h0ZXJzIHRoYXQgYXJlIHN0aWxsIGFsaXZlLCBzbyB0aGUgYWN0aW9uIChhbmQgdGhlIHB1cnBsZSBleWVzKSBzdGF5cyBsYXJnZSBvbiBzY3JlZW5cbiAgY2FtTW9kZTogJ2Nsb3NlJyB8ICd3aWRlJyA9ICdjbG9zZSc7IHByaXZhdGUgY2FtVGd0OiBhbnkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgMCk7XG4gIHNldENhbU1vZGUobTogJ2Nsb3NlJyB8ICd3aWRlJykge1xuICAgIHRoaXMuY2FtTW9kZSA9IG07XG4gICAgaWYgKG0gPT09ICd3aWRlJyAmJiB0aGlzLmJhdHRsZSkgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAwLjkpO1xuICAgIHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcHJpdmF0ZSBmcmFtZUJhdHRsZShkdDogbnVtYmVyKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlOyBpZiAoIWIpIHJldHVybjsgY29uc3QgYWxpdmUgPSBiLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSk7IGlmICghYWxpdmUubGVuZ3RoKSByZXR1cm47XG4gICAgbGV0IHgwID0gMWU5LCB4MSA9IC0xZTksIHowID0gMWU5LCB6MSA9IC0xZTk7IGZvciAoY29uc3QgZiBvZiBhbGl2ZSkgeyB4MCA9IE1hdGgubWluKHgwLCBmLngpOyB4MSA9IE1hdGgubWF4KHgxLCBmLngpOyB6MCA9IE1hdGgubWluKHowLCBmLnopOyB6MSA9IE1hdGgubWF4KHoxLCBmLnopOyB9XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3Qgd2lkZSA9IHRoaXMucG9zZXMoKS5iYXR0bGUsIGN4ID0gKHgwICsgeDEpIC8gMiwgY3ogPSAoejAgKyB6MSkgLyAyO1xuICAgIGNvbnN0IGQgPSBNYXRoLm1pbihNYXRoLm1heCgoeDEgLSB4MCArIDMuNCkgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjkpLCAoejEgLSB6MCArIDMuMikgLyAoMiAqIHRhblYgKiAwLjYyKSwgNS40KSwgTWF0aC5oeXBvdCh3aWRlLnBvcy55LCB3aWRlLnBvcy56KSk7XG4gICAgY29uc3QgdGd0ID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCwgMC41NSwgY3opLCBwb3MgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4IC0gMC4wNiAqIGQsIDAuMzIgKiBkICsgMC41LCBjeiAtIDAuOSAqIGQpO1xuICAgIGNvbnN0IGsgPSAxIC0gTWF0aC5leHAoLWR0ICogMi4wKTtcbiAgICB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtZXJhLnBvc2l0aW9uLCBwb3MsIGspOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtVGd0LCB0Z3QsIGspOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFnZSBmbG93XG4gIC8qKiBXcml0ZSB0aGUgcnVuIHRvIGRpc2sgKGNhbG0gbW9tZW50cyBvbmx5OiBidWlsZCBwaGFzZSBhbmQgdGhlIHZpY3RvcnkgZHJhZnQpLiAqL1xuICBwcml2YXRlIHBlcnNpc3RSdW4oKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHMgPSB0aGlzLnM7IGlmICghcykgcmV0dXJuO1xuICAgICAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSB7IGNsZWFyUnVuKCk7IHJldHVybjsgfVxuICAgICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgJiYgdGhpcy5waGFzZSAhPT0gJ2RyYWZ0JykgcmV0dXJuO1xuICAgICAgY29uc3Qgc25hcDogUnVuU25hcHNob3QgPSB7IHY6IDEsIHNlZWQ6IHRoaXMuc2VlZCwgYXR0ZW1wdDogdGhpcy5hdHRlbXB0LCBzdGFnZTogY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHk6IGRpZmZpY3VsdHlOYW1lLCBwaGFzZTogdGhpcy5waGFzZSwgZHJhZnQ6IHRoaXMucGhhc2UgPT09ICdkcmFmdCcgPyB0aGlzLmRyYWZ0IDogbnVsbCwgc3RhdGU6IHNlcmlhbGl6ZVN0YXRlKHMpLCBzdGFydEJlc3Q6IHRoaXMuZW5kbGVzcz8uc3RhcnRCZXN0IH07XG4gICAgICBzYXZlUnVuKHNuYXApO1xuICAgIH0gY2F0Y2ggeyAvKiBuZXZlciBsZXQgc2F2aW5nIGJyZWFrIHRoZSBnYW1lICovIH1cbiAgfVxuICAvKiogUmVidWlsZCB0aGUgc2NyZWVuIGZyb20gYSBzYXZlZCBydW4gKGEgcmVsb2FkLCBvciBTYWZhcmkgZGlzY2FyZGluZyB0aGUgcGFnZSkuICovXG4gIHByaXZhdGUgcmVzdG9yZShyOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSkge1xuICAgIGNvbnN0IHsgc25hcCwgc3RhdGUgfSA9IHI7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMuZmx1c2hUd2VlbnMoKTsgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICBpZiAoc25hcC5zdGFnZSA9PT0gRU5ETEVTU19JRCkgeyBzZXRFbmRsZXNzKCk7IGNvbnN0IGRvbmUgPSBNYXRoLm1heCgwLCBzdGF0ZS53YXZlIC0gMSk7IHRoaXMuZW5kbGVzcyA9IHsgc3RhcnRCZXN0OiBzbmFwLnN0YXJ0QmVzdCA/PyBsb2FkU2F2ZSgpLmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogZG9uZSwgcGFja3M6IE1hdGguZmxvb3IoZG9uZSAvIEVORExFU1NfUEFDS19FVkVSWSkgfTsgfSBlbHNlIHsgc2V0U3RhZ2VEaWZmaWN1bHR5KHNuYXAuc3RhZ2UsIHNuYXAuZGlmZmljdWx0eSk7IHRoaXMuZW5kbGVzcyA9IG51bGw7IH1cbiAgICB0aGlzLmFyZW5hLnNldFRoZW1lKGN1cnJlbnRTdGFnZUlkKTtcbiAgICB0aGlzLnNlZWQgPSBzbmFwLnNlZWQ7IHRoaXMuYXR0ZW1wdCA9IHNuYXAuYXR0ZW1wdDsgdGhpcy5zID0gc3RhdGU7IHRoaXMuc2Vlbk1lcmdlcyA9IHN0YXRlLnN0YXRzLm1lcmdlcztcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBzbmFwLnBoYXNlID09PSAnZHJhZnQnID8gc25hcC5kcmFmdCA6IG51bGw7IHRoaXMucGhhc2UgPSB0aGlzLmRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdChgUnVuIHJlc3RvcmVkOiB3YXZlICR7aXNFbmRsZXNzKCkgPyBzdGF0ZS53YXZlIDogc3RhdGUud2F2ZSArICcvJyArIHN0YWdlV2F2ZXMoc3RhdGUpfSwgJHtzdGF0ZS5oZWFydHN9IGhlYXJ0JHtzdGF0ZS5oZWFydHMgPT09IDEgPyAnJyA6ICdzJ30uYCk7XG4gIH1cblxuICAvLyAtLS0tIHBlcmZvcm1hbmNlIHJlYWRvdXQ6IHJvbGxpbmcgZnJhbWUgc3RhdHMsIHBlci1iYXR0bGUgc3VtbWFyaWVzLCBvcHRpb25hbCBvbi1zY3JlZW4gRlBTLCBhbmQgYSBwYXN0ZS1mcmllbmRseSByZXBvcnRcbiAgc2hvd0ZwcyA9IGZhbHNlOyBwZXJmTm93ID0geyBmcHM6IDAsIGF2ZzogMCwgcDk1OiAwLCB3b3JzdDogMCB9OyBwZXJmTG9nOiBhbnlbXSA9IFtdO1xuICBwcml2YXRlIHBlcmZCdWYgPSBuZXcgRmxvYXQzMkFycmF5KDI0MCk7IHByaXZhdGUgcGVyZk4gPSAwOyBwcml2YXRlIHBlcmZJID0gMDsgcHJpdmF0ZSBwZXJmU2hvd25BdCA9IDA7IHByaXZhdGUgaW5zdHI6IGFueSA9IG51bGw7IHByaXZhdGUgZnBzSHVkOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGN1ckJhdHRsZTogeyBmcmFtZXM6IG51bWJlcjsgc3VtOiBudW1iZXI7IHdvcnN0OiBudW1iZXI7IHNsb3c6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHNldFNob3dGcHMob246IGJvb2xlYW4pIHtcbiAgICB0aGlzLnNob3dGcHMgPSBvbjtcbiAgICBpZiAob24gJiYgIXRoaXMuZnBzSHVkKSB7IGNvbnN0IGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgaC5pZCA9ICdmcHNIdWQnOyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JhdHRsZUhvc3QnKSB8fCBkb2N1bWVudC5ib2R5KS5hcHBlbmRDaGlsZChoKTsgdGhpcy5mcHNIdWQgPSBoOyB9XG4gICAgaWYgKHRoaXMuZnBzSHVkKSB0aGlzLmZwc0h1ZC5zdHlsZS5kaXNwbGF5ID0gb24gPyAnYmxvY2snIDogJ25vbmUnO1xuICB9XG4gIHByaXZhdGUgcGVyZlRpY2sobXM6IG51bWJlcikge1xuICAgIGlmIChtcyA+IDUwMCkgcmV0dXJuOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgdGFiIHdhcyBoaWRkZW4gb3IgdGhlIHBob25lIHBhdXNlZCB1czogbm90IGEgcmVhbCBmcmFtZVxuICAgIHRoaXMucGVyZkJ1Zlt0aGlzLnBlcmZJXSA9IG1zOyB0aGlzLnBlcmZJID0gKHRoaXMucGVyZkkgKyAxKSAlIHRoaXMucGVyZkJ1Zi5sZW5ndGg7IHRoaXMucGVyZk4gPSBNYXRoLm1pbih0aGlzLnBlcmZCdWYubGVuZ3RoLCB0aGlzLnBlcmZOICsgMSk7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlO1xuICAgIGlmIChjICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCB0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpKSB7IGMuZnJhbWVzKys7IGMuc3VtICs9IG1zOyBpZiAobXMgPiBjLndvcnN0KSBjLndvcnN0ID0gbXM7IGlmIChtcyA+IDMzLjQpIGMuc2xvdysrOyBjLnNjYWxlID0gTWF0aC5tYXgoYy5zY2FsZSwgdGhpcy50aW1lU2NhbGUpOyB9XG4gICAgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCk7IGlmIChub3cgLSB0aGlzLnBlcmZTaG93bkF0IDwgNTAwKSByZXR1cm47IHRoaXMucGVyZlNob3duQXQgPSBub3c7XG4gICAgY29uc3QgYSA9IEFycmF5LmZyb20odGhpcy5wZXJmQnVmLnN1YmFycmF5KDAsIHRoaXMucGVyZk4pKS5zb3J0KCh4LCB5KSA9PiB4IC0geSksIGF2ZyA9IGEucmVkdWNlKChuLCB4KSA9PiBuICsgeCwgMCkgLyBhLmxlbmd0aDtcbiAgICB0aGlzLnBlcmZOb3cgPSB7IGZwczogMTAwMCAvIGF2ZywgYXZnLCBwOTU6IGFbTWF0aC5mbG9vcihhLmxlbmd0aCAqIDAuOTUpXSA/PyAwLCB3b3JzdDogYVthLmxlbmd0aCAtIDFdID8/IDAgfTtcbiAgICBpZiAodGhpcy5mcHNIdWQgJiYgdGhpcy5zaG93RnBzKSB0aGlzLmZwc0h1ZC50ZXh0Q29udGVudCA9IGAke3RoaXMucGVyZk5vdy5mcHMudG9GaXhlZCgwKX0gZnBzICAke3RoaXMucGVyZk5vdy5hdmcudG9GaXhlZCgxKX1tcyAgc2xvdzUlICR7dGhpcy5wZXJmTm93LnA5NS50b0ZpeGVkKDApfW1zYDtcbiAgICB0aGlzLnVpLnJlbmRlckRlYnVnTGl2ZSgpO1xuICB9XG4gIHByaXZhdGUgYmVnaW5CYXR0bGVQZXJmKCkgeyB0aGlzLmN1ckJhdHRsZSA9IHsgZnJhbWVzOiAwLCBzdW06IDAsIHdvcnN0OiAwLCBzbG93OiAwLCBzY2FsZTogdGhpcy50aW1lU2NhbGUgfTsgfVxuICBwcml2YXRlIGVuZEJhdHRsZVBlcmYoKSB7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlOyB0aGlzLmN1ckJhdHRsZSA9IG51bGw7IGlmICghYyB8fCAhYy5mcmFtZXMpIHJldHVybjtcbiAgICB0aGlzLnBlcmZMb2cucHVzaCh7IHdhdmU6IHRoaXMucy53YXZlLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIHNwZWVkOiBjLnNjYWxlLCBmaWdodGVyczogdGhpcy5iYXR0bGUgPyB0aGlzLmJhdHRsZS5maWdodGVycy5sZW5ndGggOiAwLCBmcHM6ICsoMTAwMCAvIChjLnN1bSAvIGMuZnJhbWVzKSkudG9GaXhlZCgwKSwgd29yc3RNczogK2Mud29yc3QudG9GaXhlZCgwKSwgc2xvd1BjdDogKygoMTAwICogYy5zbG93KSAvIGMuZnJhbWVzKS50b0ZpeGVkKDEpIH0pO1xuICAgIGlmICh0aGlzLnBlcmZMb2cubGVuZ3RoID4gMTIpIHRoaXMucGVyZkxvZy5zaGlmdCgpO1xuICB9XG4gIHBlcmZJbmZvKCkge1xuICAgIGNvbnN0IHNjID0gdGhpcy5zY2VuZTsgaWYgKCF0aGlzLmluc3RyICYmIEJBQllMT04uU2NlbmVJbnN0cnVtZW50YXRpb24pIHRoaXMuaW5zdHIgPSBuZXcgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbihzYyk7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5wZXJmTm93LCBtZXNoZXM6IHNjLmdldEFjdGl2ZU1lc2hlcygpLmxlbmd0aCwgcGFydGljbGVzOiBzYy5wYXJ0aWNsZVN5c3RlbXMubGVuZ3RoLCBkcmF3czogdGhpcy5pbnN0ciA/IHRoaXMuaW5zdHIuZHJhd0NhbGxzQ291bnRlci5jdXJyZW50IDogLTEgfTtcbiAgfVxuICBwZXJmUmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcCA9IHRoaXMucGVyZkluZm8oKSwgZ2w6IGFueSA9IHRoaXMuZW5naW5lLmdldEdsSW5mbyA/IHRoaXMuZW5naW5lLmdldEdsSW5mbygpIDoge307XG4gICAgY29uc3Qgcm93cyA9IHRoaXMucGVyZkxvZy5tYXAoKHIpID0+IGAgIHdhdmUgJHtyLndhdmV9IHRyeSAke3IuYXR0ZW1wdH0gYXQgJHtyLnNwZWVkfXg6ICR7ci5mcHN9IGZwcyBhdmVyYWdlLCB3b3JzdCBmcmFtZSAke3Iud29yc3RNc31tcywgJHtyLnNsb3dQY3R9JSBzbG93IGZyYW1lcywgJHtyLmZpZ2h0ZXJzfSBmaWdodGVyc2ApO1xuICAgIHJldHVybiBbYFBFUkYgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9YCwgYGRldmljZTogJHtuYXZpZ2F0b3IudXNlckFnZW50fWAsIGBncHU6ICR7Z2wucmVuZGVyZXIgfHwgJz8nfSAoJHtnbC52ZW5kb3IgfHwgJz8nfSlgLFxuICAgICAgYHNjcmVlbiAke3NjcmVlbi53aWR0aH14JHtzY3JlZW4uaGVpZ2h0fSAgdmlld3BvcnQgJHtpbm5lcldpZHRofXgke2lubmVySGVpZ2h0fSAgZHByICR7ZGV2aWNlUGl4ZWxSYXRpb30gIHJlbmRlciAke3RoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCl9eCR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCl9ICBzY2FsaW5nIGxldmVsICR7dGhpcy5lbmdpbmUuZ2V0SGFyZHdhcmVTY2FsaW5nTGV2ZWwoKS50b0ZpeGVkKDIpfWAsXG4gICAgICBgbm93OiAke3AuZnBzLnRvRml4ZWQoMCl9IGZwcywgYXZlcmFnZSAke3AuYXZnLnRvRml4ZWQoMSl9bXMsIHNsb3dlc3QgNSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zLCB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyB8IGFjdGl2ZSBtZXNoZXMgJHtwLm1lc2hlc30sIHBhcnRpY2xlIHN5c3RlbXMgJHtwLnBhcnRpY2xlc30sIGRyYXcgY2FsbHMgJHtwLmRyYXdzfWAsXG4gICAgICBgc3RhdGU6IHBoYXNlICR7dGhpcy5waGFzZX0sIHNwZWVkICR7dGhpcy50aW1lU2NhbGV9eCwgY2FtZXJhICR7dGhpcy5jYW1Nb2RlfSwgZGlmZmljdWx0eSAke2RpZmZpY3VsdHlOYW1lfSwgd2F2ZSAke3RoaXMucy53YXZlfSwgdW5pdHMgJHt0aGlzLnMudW5pdHMubGVuZ3RofWAsXG4gICAgICBgYmF0dGxlcyAobmV3ZXN0IGxhc3QpOmAsIC4uLihyb3dzLmxlbmd0aCA/IHJvd3MgOiBbJyAgKG5vbmUgeWV0OiBwbGF5IGEgYmF0dGxlLCB0aGVuIGNvcHkgdGhpcyBhZ2FpbiknXSldLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgLyoqIEEgcnVuIHRoZSBwbGF5ZXIgaGFzIHJlYWxseSBzdGFydGVkIChzbyBIb21lIGNhbiBvZmZlciBDb250aW51ZSkuIE51bGwgYWZ0ZXIgYSBzdGFnZSB3YXMgd29uIG9yIGxvc3QsIG9yIGJlZm9yZSBhbnl0aGluZyB3YXMgZG9uZS4gKi9cbiAgcnVuSW5mbygpIHsgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzIHx8IHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gbnVsbDsgcmV0dXJuIChzLndhdmUgPiAxIHx8IHMudW5pdHMubGVuZ3RoID4gMCB8fCB0aGlzLmF0dGVtcHQgPiAwIHx8IHMuc3RhdHMuZmFpbHVyZXMgPiAwKSA/IHsgd2F2ZTogcy53YXZlLCB0b3RhbDogc3RhZ2VXYXZlcyhzKSwgaGVhcnRzOiBzLmhlYXJ0cywgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUsIHN0YWdlOiBjdXJyZW50U3RhZ2VJZCB9IDogbnVsbDsgfVxuICAvKiogRnJlc2ggcnVuIHdpdGggdGhlIGN1cnJlbnRseSBlcXVpcHBlZCBTb3VsIERlY2sgKEhvbWUgPiBTdGFydCBCYXR0bGUgY2FsbHMgdGhpcykuICovXG4gIG5ld1J1bigpIHsgdGhpcy5zdGFydFN0YWdlKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydFN0YWdlKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgdGhpcy5lbmRsZXNzID0gbnVsbDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpLCBwbCA9IHBsYXlhYmxlKHN2KTsgc2V0U3RhZ2VEaWZmaWN1bHR5KHBsLnN0YWdlLCBwbC5kaWZmaWN1bHR5KTsgdGhpcy5hcmVuYS5zZXRUaGVtZShjdXJyZW50U3RhZ2VJZCk7IHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uUFJPVE9UWVBFX1JVTEVTLCBwb29sOiBzdi5kZWNrIH0sIHNlZWQpOyB0aGlzLnNlZW5NZXJnZXMgPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IG51bGw7IHRoaXMucGhhc2UgPSAnYnVpbGQnO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7IHRoaXMudG9hc3QoJ1N0YWdlIHN0YXJ0OiA0IGNhcmRzLCAnICsgdGhpcy5zLmNhcCArICcgRG9taW5pb24uIFN1bW1vbiwgbWVyZ2UsIHRoZW4gcHJlc3MgQkFUVExFLicpO1xuICB9XG4gIC8qKiBGcmVzaCBFbmRsZXNzIERlcHRocyBydW4gKEhvbWUgPiBFbmRsZXNzIERlcHRocyBjYWxscyB0aGlzKTogc2FtZSBydWxlcyBhcyBhIHN0YWdlLCBidXQgdGhlIHdhdmVzIG5ldmVyIHN0b3AgYW5kIHRoZSBlbmVteSBrZWVwcyBncm93aW5nLiAqL1xuICBuZXdFbmRsZXNzKCkgeyB0aGlzLnN0YXJ0RW5kbGVzcyhuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdzZWVkJykgPyB0aGlzLnNlZWQgOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IH1cbiAgc3RhcnRFbmRsZXNzKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpOyBzZXRFbmRsZXNzKCk7IHRoaXMuYXJlbmEuc2V0VGhlbWUoRU5ETEVTU19JRCk7XG4gICAgdGhpcy5lbmRsZXNzID0geyBzdGFydEJlc3Q6IHN2LmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogMCwgcGFja3M6IDAgfTtcbiAgICB0aGlzLnMgPSBuZXdTdGFnZSh7IC4uLkVORExFU1NfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdCgnRW5kbGVzcyBEZXB0aHM6IGhvdyBkZWVwIGNhbiB5b3UgZ28/IEEgU291bCBQYWNrIGV2ZXJ5IDEwIHdhdmVzLicpO1xuICB9XG4gIHByaXZhdGUgY2xlYXJCYXR0bGUoKSB7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LmRpc3Bvc2UoKTsgfSk7IHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7IHRoaXMuYmF0dGxlID0gbnVsbDtcbiAgICB0aGlzLmFycm93cy5mb3JFYWNoKChhKSA9PiBhLm1lc2guZGlzcG9zZSgpKTsgdGhpcy5hcnJvd3MgPSBbXTtcbiAgfVxuICBwcml2YXRlIHBvcyhjZWxsOiBudW1iZXIpIHsgcmV0dXJuIGNlbGxQb3MoMCwgY2VsbCk7IH1cbiAgc3luY0J1aWxkKCkge1xuICAgIHRoaXMucGVyc2lzdFJ1bigpO1xuICAgIGNvbnN0IG1lcmdlZCA9IHRoaXMucy5zdGF0cy5tZXJnZXMgPiB0aGlzLnNlZW5NZXJnZXM7IHRoaXMuc2Vlbk1lcmdlcyA9IHRoaXMucy5zdGF0cy5tZXJnZXM7XG4gICAgY29uc3QgZ3Jvd24gPSBtZXJnZWQgPyB0aGlzLnMudW5pdHMuZmluZCgodSkgPT4geyBjb25zdCBndiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IHJldHVybiAhIWd2ICYmIGd2LnN0YXIgIT09IHUuc3RhcjsgfSkgOiB1bmRlZmluZWQ7ICAgLy8gdGhlIHVuaXQgdGhhdCBqdXN0IGdhaW5lZCBhIHN0YXJcbiAgICBjb25zdCBhbGl2ZSA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gdS5pZCkpO1xuICAgIGZvciAoY29uc3QgW2lkLCB2XSBvZiB0aGlzLnVuaXRWaXMpIGlmICghYWxpdmUuaGFzKGlkKSkge1xuICAgICAgdGhpcy52aXNUb1VuaXQuZGVsZXRlKHYpOyB0aGlzLnVuaXRWaXMuZGVsZXRlKGlkKTsgY29uc3QgcCA9IHYuaG9sZGVyLnBvc2l0aW9uO1xuICAgICAgaWYgKGdyb3duKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbWVyZ2U6IHRoZSBjb25zdW1lZCB1bml0IGlzIGRyYXduIGludG8gdGhlIHN1cnZpdm9yIGFuZCB2YW5pc2hlcyBpbiBhIGZsYXNoXG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3MoZ3Jvd24uY2VsbCksIHgwID0gcC54LCB6MCA9IHAueiwgc2MgPSB2LmhvbGRlci5zY2FsaW5nLng7IHYucGxheSgnaWRsZScpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuMzMsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC40LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHNjICogKDEgLSAwLjc1ICogdCkpOyB9LFxuICAgICAgICAgICgpID0+IHsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDE0KTsgdi5kaXNwb3NlKCk7IH0pO1xuICAgICAgfSBlbHNlIHsgdGhpcy5idXJzdChwLngsIHAueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxNik7IHYuZGlzcG9zZSgpOyB9XG4gICAgfVxuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHtcbiAgICAgIGxldCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7XG4gICAgICBpZiAoIXYpIHsgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHUuc291bCwgMCwgdS5zdGFyKTsgdGhpcy51bml0VmlzLnNldCh1LmlkLCB2KTsgdGhpcy52aXNUb1VuaXQuc2V0KHYsIHUuaWQpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7IGF1ZGlvLnBsYXkoJ3N1bW1vbicpOyBjb25zdCB2diA9IHY7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB2di5wbGF5KCdpZGxlJyk7IH0pOyB9XG4gICAgICBlbHNlIHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyBpZiAodi5zdGFyICE9PSB1LnN0YXIpIHsgY29uc3QgZnYgPSB2OyB2LnNldFN0YXIodS5zdGFyKTsgdGhpcy5sYXRlcihncm93biAmJiBncm93bi5pZCA9PT0gdS5pZCA/IDAuMzMgOiAwLCAoKSA9PiB0aGlzLm1lcmdlRngoZnYsIHAueCwgcC56KSk7IH0gfVxuICAgIH1cbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDtcbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5waGFzZSA9PT0gJ2J1aWxkJykge1xuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgY2FuU3VtbW9uKHRoaXMucywgc2VsLmlkeCkgPyAnZnJlZScgOiAnbm9ybWFsJyk7XG4gICAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VGcm9tSGFuZCh0aGlzLnMsIHNlbC5pZHgsIHUuaWQpKSB0aGlzLnRpbnQodS5jZWxsLCAncGFydG5lcicpOyAgICAgLy8gdGhlIGNhcmQgY2FuIG1lcmdlIGludG8gdGhpcyB1bml0XG4gICAgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0Jykge1xuICAgICAgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpO1xuICAgICAgaWYgKHUpIHsgdGhpcy50aW50KHUuY2VsbCwgJ3NlbCcpOyBmb3IgKGNvbnN0IG8gb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VEZXBsb3llZCh1LCBvKSkgdGhpcy50aW50KG8uY2VsbCwgJ3BhcnRuZXInKTsgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgJ2ZyZWUnKTsgfVxuICAgIH1cbiAgfVxuICAvKiogVGhlIG1lcmdlIG1vbWVudDogYSBmbGFzaCBvZiByaW5ncyBhbmQgc3BhcmtzLCBhIHB1bmNoIGluIHNpemUsIGEgcmlzaW5nIGNoaW1lLiAqL1xuICBwcml2YXRlIG1lcmdlRngodjogVW5pdFZpc3VhbCwgeDogbnVtYmVyLCB6OiBudW1iZXIpIHtcbiAgICBhdWRpby5wbGF5KCdtZXJnZScpOyB2LnB1bHNlKCk7IGNvbnN0IHRhcmdldCA9IHYuaG9sZGVyLnNjYWxpbmcueDtcbiAgICB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC40KSwgMC4yLCAyLjAsIDAuNjUpOyB0aGlzLmxhdGVyKDAuMTIsICgpID0+IHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC4yLCAzLjAsIDAuOCkpO1xuICAgIHRoaXMuYnVyc3QoeCwgeiwgWzEsIDAuODUsIDAuNCwgMC45XSwgWzAuOCwgMC40LCAxLCAwLjhdLCA0Nik7IHRoaXMuYnVyc3QoeCwgeiwgWzAuODUsIDAuNiwgMSwgMC45XSwgWzAuNSwgMC4zLCAxLCAwLjddLCAyNCk7XG4gICAgdGhpcy50d2VlbigwLjU1LCAodCkgPT4gdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGFyZ2V0ICogKDEgKyAwLjQ1ICogTWF0aC5zaW4odCAqIE1hdGguUEkpICogKDEgLSB0ICogMC40KSkpLCAoKSA9PiB2LmhvbGRlci5zY2FsaW5nLnNldEFsbCh0YXJnZXQpKTtcbiAgfVxuICBwcml2YXRlIHN1bW1vbkZ4KHg6IG51bWJlciwgejogbnVtYmVyKSB7IHRoaXMuYnVyc3QoeCwgeiwgWzAuNywgMC4zLCAxLCAwLjldLCBbMC4zNSwgMC4xLCAwLjcsIDAuOF0sIDMwKTsgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zLCAxKSwgMC4yLCAxLjIsIDAuNyk7IH1cblxuICAvLyAtLS0tIHBsYXllciBhY3Rpb25zIChidWlsZCBwaGFzZSlcbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgdGhpcy51aS50b2FzdChtc2cpOyB9XG4gIG9uQ2FyZChpZHg6IG51bWJlcikge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKGRpc2NhcmRSZWRyYXcodGhpcy5zLCBpZHgpKSB7IHRoaXMudG9hc3QoJ1N3YXBwZWQ6IGRyZXcgYSBkaWZmZXJlbnQgU291bC4nKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5zZWwuaWR4ID09PSBpZHggPyBudWxsIDogeyB0eXBlOiAnY2FyZCcsIGlkeCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVGlsZShjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBoZXJlID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpOyBpZiAoaGVyZSkgeyB0aGlzLm9uVW5pdFZpc3VhbCh0aGlzLnVuaXRWaXMuZ2V0KGhlcmUuaWQpISk7IHJldHVybjsgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJykge1xuICAgICAgaWYgKGNhblN1bW1vbihzLCBzZWwuaWR4KSkgeyBzdW1tb24ocywgc2VsLmlkeCwgY2VsbCk7IHRoaXMuc2VsID0gbnVsbDsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHNvdWwgPSBzLmhhbmRbc2VsLmlkeF07IHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb246ICR7U09VTF9OQU1FW3NvdWxdfSBjb3N0cyAke2Nvc3Qoc291bCwgMSl9LCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTsgfVxuICAgIH0gZWxzZSBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHsgaWYgKG1vdmVVbml0KHMsIHNlbC5pZCwgY2VsbCkpIHRoaXMuc2VsID0gbnVsbDsgfVxuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVW5pdFZpc3VhbCh2OiBVbml0VmlzdWFsKSB7XG4gICAgY29uc3QgaWQgPSB0aGlzLnZpc1RvVW5pdC5nZXQodik7IGlmIChpZCA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCkhO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChzd2FwU2VsbChzLCBpZCkpIHsgdGhpcy50b2FzdChgU29sZCAke1NPVUxfTkFNRVt1LnNvdWxdfTogZHJldyBhIGRpZmZlcmVudCBTb3VsLmApOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KHUuZnJlc2ggPyBcIllvdSBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZC5cIiA6ICdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHMuaGFuZFt0aGlzLnNlbC5pZHhdID09PSB1LnNvdWwgJiYgdS5zdGFyID09PSAxICYmIHMucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInKSB7XG4gICAgICBpZiAobWVyZ2VGcm9tSGFuZChzLCB0aGlzLnNlbC5pZHgsIGlkKSkgeyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgdGhlIGNhcmQgaW50byBhIDItc3RhciAke1NPVUxfTkFNRVt1LnNvdWxdfSFgKTsgfVxuICAgICAgZWxzZSB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uIHRvIG1lcmdlOiBpdCBuZWVkcyAke2Nvc3QodS5zb3VsLCAyKSAtIGNvc3QodS5zb3VsLCAxKX0gbW9yZSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCAhPT0gaWQpIHtcbiAgICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09ICh0aGlzLnNlbCBhcyBhbnkpLmlkKSE7XG4gICAgICBpZiAoY2FuTWVyZ2VEZXBsb3llZChhLCB1KSkgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIHUuaWQpOyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZDogYS5pZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB9IGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgPT09IGlkID8gbnVsbCA6IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG1lcmdlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpOyBjb25zdCBiID0gYSAmJiBzLnVuaXRzLmZpbmQoKG8pID0+IGNhbk1lcmdlRGVwbG95ZWQoYSwgbykpO1xuICAgIGlmIChhICYmIGIpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCBiLmlkKTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMudG9hc3QoJ05vIG1hdGNoaW5nIHVuaXQgKHNhbWUgU291bCBhbmQgc3RhcnMpIHRvIG1lcmdlIHdpdGguJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICByZW1vdmVTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGlmICghdGhpcy5jb25maXJtUmVtb3ZlKSB7IHRoaXMuY29uZmlybVJlbW92ZSA9IHRydWU7IHRoaXMudG9hc3QoJ1RhcCBSZW1vdmUgYWdhaW4gdG8gY29uZmlybS4gVGhlIGNhcmQgaXMgZ29uZSBmb3IgdGhpcyBzdGFnZS4nKTsgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuOyB9XG4gICAgZGlzbWlzcyh0aGlzLnMsIHNlbC5pZCk7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgdG9nZ2xlU3dhcCgpIHsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjsgaWYgKHRoaXMucy5kaXNjYXJkVXNlZCkgeyB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyByZXR1cm47IH0gdGhpcy5zd2FwTW9kZSA9ICF0aGlzLnN3YXBNb2RlOyB0aGlzLnNlbCA9IG51bGw7IGlmICh0aGlzLnN3YXBNb2RlKSB0aGlzLnRvYXN0KCdTd2FwOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCwgb3IgYSB1bml0IChub3Qgc3VtbW9uZWQgdGhpcyByb3VuZCkgdG8gc2VsbC4nKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGJhdHRsZVxuICBzdGFydEJhdHRsZSgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhdGhpcy5zLnVuaXRzLmxlbmd0aCkgeyBpZiAoIXRoaXMucy51bml0cy5sZW5ndGgpIHRoaXMudG9hc3QoJ1N1bW1vbiBhdCBsZWFzdCBvbmUgdW5pdCBmaXJzdC4nKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5mbHVzaFR3ZWVucygpOyBhdWRpby5wbGF5KCdzdGFydCcpOyB0aGlzLmJlZ2luQmF0dGxlUGVyZigpOyB0aGlzLnNob3dHcmlkKGZhbHNlKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5hdHRlbXB0Kys7IHRoaXMuaGFuZGxlZCA9IGZhbHNlOyB0aGlzLnJlc3VsdEF0ID0gLTE7XG4gICAgY29uc3QgcyA9IHRoaXMucywgdW5pdHMgPSBzLnVuaXRzLnNsaWNlKCk7XG4gICAgY29uc3Qgc2F2ZWQgPSBsb2FkU2F2ZSgpLnNvdWxzLCBsZXZlbHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTsgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHNhdmVkKSkgbGV2ZWxzW2tdID0gKHNhdmVkIGFzIGFueSlba10ubGV2ZWw7ICAgLy8gcGVybWFuZW50IFNvdWwgbGV2ZWxzXG4gICAgdGhpcy5iYXR0bGUgPSBuZXcgQmF0dGxlKHVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW15V2F2ZShzLndhdmUsIHRoaXMuc2VlZCksIHRoaXMuc2VlZCAqIDEzMSArIHMud2F2ZSAqIDE3ICsgdGhpcy5hdHRlbXB0LCBsZXZlbHMsIGVuZW15UG93ZXIocy53YXZlKSk7XG4gICAgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTtcbiAgICB0aGlzLmJhdHRsZS5maWdodGVycy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICBpZiAoZi50ZWFtID09PSAwKSB7IGNvbnN0IHUgPSB1bml0c1tmLmlkIC0gMV07IGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5mVW5pdC5zZXQoZi5pZCwgdS5pZCk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IH1cbiAgICAgIGVsc2UgeyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgZi5zb3VsLCAxLCBmLnN0YXIpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoZi54LCAwLCBmLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gLU1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh2LnN0YXRlID09PSAnc3Bhd24nKSB2LnBsYXkoJ2lkbGUnKTsgfSk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjcsIDAuNiwgMC41LCAwLjddLCBbMC40LCAwLjM1LCAwLjMsIDAuNl0sIDE0KTsgfVxuICAgIH0pO1xuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIHRoaXMucGhhc2UgPSAndHJhbnNpdGlvbic7IHRoaXMuc3RhcnRTdGVwQXQgPSAxLjA7IHRoaXMuYWNjID0gMDsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAyLjIpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgYXBwbHlFdmVudHMoZXZzOiBCRXZlbnRbXSkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSE7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2cykge1xuICAgICAgaWYgKGUudCA9PT0gJ3N3aW5nJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHYucGxheSgnYXR0YWNrJywgZS5zcGVlZCk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2hpdCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS50byk7IGlmICh2KSB2LnB1bHNlKCk7IGlmIChlLmtpbmQgPT09ICdhcnJvdycpIGF1ZGlvLnBsYXkoJ2hpdEFycm93Jyk7IGVsc2UgaWYgKGUua2luZCA9PT0gJ21lbGVlJykgYXVkaW8ucGxheSgnaGl0Jyk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Fycm93JykgeyBjb25zdCBmID0gYi5ieUlkKGUuZnJvbSkhLCB0byA9IGIuYnlJZChlLnRvKSE7IHRoaXMuc3Bhd25BcnJvdyhmLnRlYW0sIGYueCwgZi56LCB0by54LCB0by56LCBlLmR1cik7IGF1ZGlvLnBsYXkoJ2Fycm93Jyk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2RlYXRoJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHsgdi5wbGF5KCdkZWF0aCcpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCdkZWF0aCcpOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDEyKTsgaWYgKGYudGVhbSA9PT0gMSkgdGhpcy5sYXRlcig1LCAoKSA9PiB7IGlmICh0aGlzLmZ2aXMuZ2V0KGUuaWQpID09PSB2ICYmIHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHsgdi5ob2xkZXIuc2V0RW5hYmxlZChmYWxzZSk7IH0gfSk7IH0gfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnY2FzdCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ2Nhc3QnKTsgdGhpcy5meFJpbmcoZi54LCBmLnosIG5ldyBCQUJZTE9OLkNvbG9yMygwLjUsIDAuOCwgMSksIDAuMTUsIDEuMSwgMC4zNSk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3RhdW50JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgndGF1bnQnKTsgdGhpcy5meFJpbmcoZi54LCBmLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjMpLCAwLjMsIEJBTEFOQ0UudGF1bnQucmFkaXVzLCAwLjYpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdzbWFzaCcpIHsgYXVkaW8ucGxheSgnc21hc2gnKTsgdGhpcy5meFJpbmcoZS54LCBlLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjUsIDAuMiksIDAuMiwgZS5yICogMS42LCAwLjQ1KTsgfVxuICAgIH1cbiAgfVxuICBwcml2YXRlIHNwYXduQXJyb3codGVhbTogbnVtYmVyLCB4MDogbnVtYmVyLCB6MDogbnVtYmVyLCB4MTogbnVtYmVyLCB6MTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGxldCBtZXNoID0gdGhpcy5hcnJvd01lc2gucG9wKCk7XG4gICAgaWYgKCFtZXNoKSB7IG1lc2ggPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdhcnJvdycsIHsgaGVpZ2h0OiAwLjU1LCBkaWFtZXRlcjogMC4wMzUgfSwgdGhpcy5zY2VuZSk7IG1lc2gucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyBtZXNoLmlzUGlja2FibGUgPSBmYWxzZTsgY29uc3QgaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnYXInLCB0aGlzLnNjZW5lKTsgbWVzaC5wYXJlbnQgPSBob2xkZXI7IG1lc2ggPSBob2xkZXI7IH1cbiAgICBtZXNoLnNldEVuYWJsZWQodHJ1ZSk7IG1lc2guZ2V0Q2hpbGRNZXNoZXMoKVswXS5tYXRlcmlhbCA9IHRoaXMuYXJyb3dNYXRzW3RlYW1dO1xuICAgIHRoaXMuYXJyb3dzLnB1c2goeyBtZXNoLCB4MCwgejAsIHgxLCB6MSwgdDogMCwgZHVyIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmcmFtZShkdDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMuY2FudmFzLmNsaWVudFdpZHRoICE9PSB0aGlzLmxhc3RXIHx8IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCAhPT0gdGhpcy5sYXN0SCkgdGhpcy5oYW5kbGVSZXNpemUoKTsgICAvLyBlLmcuIHRoZSBob21lLXNjcmVlbiBhcHAgcmVzaXppbmcgYWZ0ZXIgbGF1bmNoXG4gICAgZm9yIChsZXQgaSA9IHRoaXMudGltZXJzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IHRoaXMudGltZXJzW2ldLnQgLT0gZHQ7IGlmICh0aGlzLnRpbWVyc1tpXS50IDw9IDApIHsgY29uc3QgZiA9IHRoaXMudGltZXJzW2ldLmZuOyB0aGlzLnRpbWVycy5zcGxpY2UoaSwgMSk7IGYoKTsgfSB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMucmluZ0Z4Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHIgPSB0aGlzLnJpbmdGeFtpXTsgci50ICs9IGR0OyBjb25zdCB1ID0gci50IC8gci5kdXIsIHMgPSByLnIwICsgKHIucjEgLSByLnIwKSAqIHU7IHIubS5zY2FsaW5nLnNldChzLCBzLCBzKTsgci5tbS5hbHBoYSA9IDAuOSAqICgxIC0gdSk7IGlmICh1ID49IDEpIHsgci5tLmRpc3Bvc2UoKTsgci5tbS5kaXNwb3NlKCk7IHRoaXMucmluZ0Z4LnNwbGljZShpLCAxKTsgfSB9XG4gICAgaWYgKHRoaXMuY2FtVCA8IDEpIHsgdGhpcy5jYW1UID0gTWF0aC5taW4oMSwgdGhpcy5jYW1UICsgZHQgLyB0aGlzLmNhbUR1cik7IGNvbnN0IGUgPSB0aGlzLmNhbVQgKiB0aGlzLmNhbVQgKiAoMyAtIDIgKiB0aGlzLmNhbVQpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS5wb3MsIHRoaXMuY2FtVG8ucG9zLCBlKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20udGd0LCB0aGlzLmNhbVRvLnRndCwgZSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnICYmIHRoaXMuY2FtTW9kZSA9PT0gJ2Nsb3NlJyAmJiAhdGhpcy5jaW5lKSB0aGlzLmZyYW1lQmF0dGxlKGR0KTtcbiAgICB0aGlzLm5lY3JvLnVwZGF0ZShkdCk7XG4gICAgZm9yIChsZXQgaSA9IHRoaXMudHdlZW5zLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHcgPSB0aGlzLnR3ZWVuc1tpXTsgdy50ICs9IGR0OyBjb25zdCB1ID0gTWF0aC5taW4oMSwgdy50IC8gdy5kdXIpOyB3LmZuKHUpOyBpZiAodSA+PSAxKSB7IHRoaXMudHdlZW5zLnNwbGljZShpLCAxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICAgIGZvciAoY29uc3QgdiBvZiB0aGlzLnVuaXRWaXMudmFsdWVzKCkpIHYudXBkYXRlKGR0KTtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYudXBkYXRlKGR0KTsgfSk7XG5cbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7XG4gICAgaWYgKCh0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicgfHwgdGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpICYmIGIpIHtcbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpIHsgdGhpcy5zdGFydFN0ZXBBdCAtPSBkdDsgaWYgKHRoaXMuc3RhcnRTdGVwQXQgPD0gMCkgeyB0aGlzLnBoYXNlID0gJ2JhdHRsZSc7IHRoaXMudWkucmVuZGVyKCk7IH0gfVxuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSB7XG4gICAgICAgIHRoaXMuYWNjICs9IGR0ICogdGhpcy50aW1lU2NhbGU7XG4gICAgICAgIHdoaWxlICh0aGlzLmFjYyA+PSAxIC8gMzAgJiYgYi53aW5uZXIgPCAwKSB7IGIuc3RlcCgxIC8gMzApOyB0aGlzLmFjYyAtPSAxIC8gMzA7IHRoaXMuYXBwbHlFdmVudHMoYi5kcmFpbigpKTsgfVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdikgY29udGludWU7XG4gICAgICAgIGlmICghdGhpcy5jaW5lICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCBmLnRlYW0gPT09IDEpKSB7IHYuaG9sZGVyLnBvc2l0aW9uLnggPSBmLng7IHYuaG9sZGVyLnBvc2l0aW9uLnogPSBmLno7IGlmIChmLmFsaXZlIHx8IHRydWUpIHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBmLnlhdzsgfVxuICAgICAgICBpZiAoZi5hbGl2ZSkgeyB2LnNldEhwKGYuaHAgLyBmLm1heEhwKTsgaWYgKGYubWF4TWFuYSkgdi5zZXRNYW5hKGYubWFuYSAvIGYubWF4TWFuYSk7IH1cbiAgICAgICAgZWxzZSB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmIChmLnN0YXRlICE9PSAnYXR0YWNrJyAmJiBmLmFsaXZlICYmIHYuc3RhdGUgIT09ICdjaGVlcicpIHsgY29uc3Qgd2FudCA9IGYuc3RhdGUgPT09ICdydW4nID8gJ3J1bicgOiAnaWRsZSc7IGlmICh0aGlzLmxhc3RTdGF0ZS5nZXQoZi5pZCkgIT09IHdhbnQgfHwgKHYuc3RhdGUgIT09IHdhbnQgJiYgdi5zdGF0ZSAhPT0gJ3NwYXduJykpIHsgaWYgKHYuc3RhdGUgIT09ICdzcGF3bicpIHsgdi5wbGF5KHdhbnQgYXMgYW55KTsgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsIHdhbnQpOyB9IH0gfVxuICAgICAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHRoaXMubGFzdFN0YXRlLnNldChmLmlkLCAnYXR0YWNrJyk7XG4gICAgICB9XG4gICAgICBpZiAoYi53aW5uZXIgPj0gMCAmJiAhdGhpcy5oYW5kbGVkKSB7IHRoaXMuaGFuZGxlZCA9IHRydWU7IHRoaXMucmVzdWx0QXQgPSAxLjQ7IH1cbiAgICAgIGlmICh0aGlzLnJlc3VsdEF0ID4gMCkgeyB0aGlzLnJlc3VsdEF0IC09IGR0OyBpZiAodGhpcy5yZXN1bHRBdCA8PSAwKSB0aGlzLmhhbmRsZVJlc3VsdCgpOyB9XG4gICAgfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLmFycm93cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgYSA9IHRoaXMuYXJyb3dzW2ldOyBhLnQgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTsgY29uc3QgdSA9IE1hdGgubWluKDEsIGEudCAvIGEuZHVyKTtcbiAgICAgIGNvbnN0IHB4ID0gYS54MCArIChhLngxIC0gYS54MCkgKiB1LCBweiA9IGEuejAgKyAoYS56MSAtIGEuejApICogdSwgcHkgPSAwLjc1ICsgTWF0aC5zaW4odSAqIE1hdGguUEkpICogMC45IC0gdSAqIDAuMjU7XG4gICAgICBjb25zdCB1MiA9IE1hdGgubWluKDEsIHUgKyAwLjAzKSwgcXggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUyLCBxeiA9IGEuejAgKyAoYS56MSAtIGEuejApICogdTIsIHF5ID0gMC43NSArIE1hdGguc2luKHUyICogTWF0aC5QSSkgKiAwLjkgLSB1MiAqIDAuMjU7XG4gICAgICBhLm1lc2gucG9zaXRpb24uc2V0KHB4LCBweSwgcHopOyBhLm1lc2gubG9va0F0KG5ldyBCQUJZTE9OLlZlY3RvcjMocXgsIHF5LCBxeikpO1xuICAgICAgaWYgKHUgPj0gMSkgeyBhLm1lc2guc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuYXJyb3dNZXNoLnB1c2goYS5tZXNoKTsgdGhpcy5hcnJvd3Muc3BsaWNlKGksIDEpOyB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVSZXN1bHQoKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlISwgcyA9IHRoaXMucztcbiAgICB0aGlzLmVuZEJhdHRsZVBlcmYoKTtcbiAgICB0aGlzLmxhc3RCYXR0bGUgPSBgd2F2ZSAke3Mud2F2ZX0gYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH06ICR7Yi53aW5uZXIgPT09IDAgPyAnV09OJyA6ICdMT1NUJ30gaW4gJHtiLnRpbWUudG9GaXhlZCgxKX1zLCAke2IuY291bnQoMCl9IG9mIHlvdXJzIGFuZCAke2IuY291bnQoMSl9IGVuZW1pZXMgbGVmdGA7XG4gICAgaWYgKGIud2lubmVyID09PSAwKSB7XG4gICAgICB0aGlzLnBsYXlSZXN1bHQoJ3dpbicsICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgYXJteSBpcyByYWlzZWQgYWdhaW4sIHRoZW4gdGhlIG5leHQgd2F2ZSAvIHRoZSBkcmFmdFxuICAgICAgICB0aGlzLmNpbmUgPSBmYWxzZTtcbiAgICAgICAgaWYgKGlzRW5kbGVzcygpICYmIHRoaXMuZW5kbGVzcykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByID0gcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlKHMud2F2ZSk7IHRoaXMuZW5kbGVzcy5jbGVhcmVkID0gcy53YXZlOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNhdmUtY2hhbmdlZCcpKTtcbiAgICAgICAgICAgIGlmIChyLnBhY2spIHsgdGhpcy5lbmRsZXNzLnBhY2tzKys7IHRoaXMudG9hc3QoJ1dhdmUgJyArIHMud2F2ZSArICcgY2xlYXJlZCEgWW91IGVhcm5lZCBhIFNvdWwgUGFjayAoc2VlIHRoZSBTaG9wKS4nKTsgfVxuICAgICAgICAgIH0gY2F0Y2ggeyAvKiBzYXZpbmcgbXVzdCBuZXZlciBicmVhayBhIHJ1biAqLyB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGFkdmFuY2VXYXZlKHMpKSB7XG4gICAgICAgICAgdGhpcy5waGFzZSA9ICd3b24nOyBjbGVhclJ1bigpO1xuICAgICAgICAgIHRyeSB7IHRoaXMucmV3YXJkID0gcmVjb3JkQ2xlYXJBbmRTYXZlKGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5TmFtZSBhcyBhbnkpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNhdmUtY2hhbmdlZCcpKTsgfSBjYXRjaCB7IHRoaXMucmV3YXJkID0gbnVsbDsgfVxuICAgICAgICAgIHRoaXMudWkucmVuZGVyKCk7IHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmRyYWZ0ID0gZHJhZnRPcHRpb25zKHMpOyB0aGlzLnBoYXNlID0gJ2RyYWZ0JzsgdGhpcy5wZXJzaXN0UnVuKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmFpbFdhdmUocyk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudWkucHVsc2VIZWFydHMoKTsgICAgICAgICAgICAgICAgICAgLy8gdGhlIGhlYXJ0IGlzIGxvc3QgdGhlIG1vbWVudCBoZSBpcyBoaXRcbiAgICAgIGlmIChzLnN0YXR1cyA9PT0gJ2xvc3QnKSB0aGlzLnBsYXlSZXN1bHQoJ2ZpbmFsJywgKCkgPT4geyB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5waGFzZSA9ICdsb3N0JzsgY2xlYXJSdW4oKTsgdGhpcy51aS5yZW5kZXIoKTsgfSk7XG4gICAgICBlbHNlIHRoaXMucGxheVJlc3VsdCgnbG9zcycsICgpID0+IHsgdGhpcy50b2FzdCgnWW91ciBhcm15IGZlbGwuIC0xIGhlYXJ0LCArMSBjYXJkLCBzYW1lIHdhdmUuIFJlYnVpbGQgYSBkaWZmZXJlbnQgc3RyYXRlZ3kuJyk7IHRoaXMudG9CdWlsZCgpOyB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIHJlc3VsdCBjdXRzY2VuZXMgKHBsYW4gc2VjdGlvbnMgMTktMjIpOiB0aGUgTmVjcm9tYW5jZXIgdGFrZXMgdGhlIGhpdCwgdW5sZWFzaGVzIHRoZSByZXB1bHNpb24gc2hvY2t3YXZlLCByYWlzZXMgdGhlIGZhbGxlblxuICBwcml2YXRlIHBsYXlSZXN1bHQoa2luZDogJ3dpbicgfCAnbG9zcycgfCAnZmluYWwnLCBkb25lOiAoKSA9PiB2b2lkKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlISwgbiA9IHRoaXMubmVjcm87IHRoaXMuY2luZSA9IHRydWU7IGlmIChraW5kICE9PSAnd2luJykgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7XG4gICAgY29uc3QgaG9tZSA9ICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBldmVyeSBmYWxsZW4gYWxseSBpcyBwdWxsZWQgYmFjayB0byBpdHMgZ3JpZCB0aWxlIGFuZCBzdGFuZHMgdXBcbiAgICAgIG4uY2FzdCgpOyBhdWRpby5wbGF5KCdyZXN1cnJlY3QnKTsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpOyB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMC44NSwgMC41LCAxLCAwLjldLCBbMC41LCAwLjIsIDEsIDAuN10sIDMwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDApIGNvbnRpbnVlOyBjb25zdCB1aWQgPSB0aGlzLmZVbml0LmdldChmLmlkKSwgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1aWQpLCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF1IHx8ICF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyh1LmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoIWYuYWxpdmUpIHsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLmJ1cnN0KHgwLCB6MCwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxOCk7IHRoaXMuZnhSaW5nKHgwLCB6MCwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zNSwgMSksIDAuMywgMS42LCAwLjcpOyB9XG4gICAgICAgIHRoaXMudHdlZW4oMS4wLCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuNSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LmhvbGRlci5yb3RhdGlvbi55ICs9IChNYXRoLlBJIC8gMiAtIHYuaG9sZGVyLnJvdGF0aW9uLnkpICogTWF0aC5taW4oMSwgdCAqIDAuNSArIDAuMSk7IH0sXG4gICAgICAgICAgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC43NSwgMC40LCAxLCAwLjldLCBbMC40LCAwLjE1LCAwLjksIDAuN10sIDEwKTsgfSk7XG4gICAgICB9XG4gICAgfTtcbiAgICBpZiAoa2luZCA9PT0gJ3dpbicpIHtcbiAgICAgIC8vIHRoZSBzdXJ2aXZvcnMgY2VsZWJyYXRlIHJpZ2h0IHdoZXJlIHRoZXkgc3RhbmQgKHB1cmVseSB2aXN1YWwpLCBUSEVOIHRoZSBjYW1lcmEgc3dpbmdzIHRvIHRoZSBOZWNyb21hbmNlciBhbmQgdGhlIGFybXkgaXMgcmFpc2VkXG4gICAgICBhdWRpby5wbGF5KCd2aWN0b3J5Jyk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykgaWYgKGYudGVhbSA9PT0gMCAmJiBmLmFsaXZlKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAodikgdGhpcy5sYXRlcihNYXRoLnJhbmRvbSgpICogMC4zNSwgKCkgPT4gdi5wbGF5KCdjaGVlcicpKTsgfVxuICAgICAgdGhpcy5sYXRlcigxLjYsICgpID0+IHsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7IG4uY2FzdCgpOyB9KTtcbiAgICAgIHRoaXMubGF0ZXIoMS44NSwgaG9tZSk7IHRoaXMubGF0ZXIoMy42LCBkb25lKTsgcmV0dXJuO1xuICAgIH1cbiAgICBuLmh1cnQoKTsgYXVkaW8ucGxheSgnaGVhcnRMb3N0Jyk7IHRoaXMubGF0ZXIoMC4xNSwgKCkgPT4geyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjMsIDAuMywgMC45XSwgWzAuOCwgMC4xLCAwLjIsIDAuNl0sIDE2KTsgfSk7XG4gICAgaWYgKGtpbmQgPT09ICdmaW5hbCcpIHsgdGhpcy5sYXRlcigwLjYsICgpID0+IHsgbi5kZWZlYXQoKTsgYXVkaW8ucGxheSgnZGVmZWF0Jyk7IH0pOyB0aGlzLmxhdGVyKDIuNiwgZG9uZSk7IHJldHVybjsgfVxuICAgIHRoaXMubGF0ZXIoMS4wLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwdWxzaW9uIHNob2Nrd2F2ZTogc3Vydml2b3JzIGFyZSBmbHVuZyBiYWNrIHRvIHdoZXJlIHRoZXkgc3RhcnRlZCBhbmQgaGVhbCB0byBmdWxsXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgnc2hvY2t3YXZlJyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTtcbiAgICAgIHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDAuODUsIDAuNTUsIDEpLCAwLjYsIDMwLCAxLjEpOyB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC40LCAyMiwgMC44KTtcbiAgICAgIHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjg1LCAxLCAwLjldLCBbMC43LCAwLjQsIDEsIDAuN10sIDQwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDEgfHwgIWYuYWxpdmUpIGNvbnRpbnVlOyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSBjZWxsUG9zKDEsIGYuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnB1bHNlKCk7XG4gICAgICAgIHRoaXMudHdlZW4oMC45LCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuOSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LnNldEhwKGYuaHAgLyBmLm1heEhwICsgKDEgLSBmLmhwIC8gZi5tYXhIcCkgKiB0KTsgfSwgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdi5zZXRIcCgxKTsgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5sYXRlcigyLjMsIGhvbWUpOyB0aGlzLmxhdGVyKDMuNywgZG9uZSk7XG4gIH1cbiAgcGlja0RyYWZ0KGlkeDogbnVtYmVyKSB7IGlmICghdGhpcy5kcmFmdCkgcmV0dXJuOyB0YWtlRHJhZnQodGhpcy5zLCB0aGlzLmRyYWZ0LCBpZHgpOyB0aGlzLmRyYWZ0ID0gbnVsbDsgbm9ybWFsRHJhdyh0aGlzLnMpOyB0aGlzLnRvQnVpbGQoKTsgfVxuICBwcml2YXRlIHRvQnVpbGQoKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMubmVjcm8ucmV2aXZlKCk7IHRoaXMuZmx1c2hUd2VlbnMoKTtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgeyAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVzdXJyZWN0aW9uOiBldmVyeW9uZSByaXNlcyBhZ2FpbiBhdCBmdWxsIGhlYWx0aFxuICAgICAgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LmhvbGRlci5zZXRFbmFibGVkKHRydWUpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7XG4gICAgICB0aGlzLmxhdGVyKDEuMSwgKCkgPT4gdi5wbGF5KCdpZGxlJykpO1xuICAgIH1cbiAgICB0aGlzLnBoYXNlID0gJ2J1aWxkJzsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyAgICAgICAgICAvLyBVSSBmaXJzdDogdGhlIGNhbWVyYSBtdXN0IG1lYXN1cmUgdGhlIGhhbmQgYW5kIGJ1dHRvbnMgd2hpbGUgdGhleSBhcmUgdmlzaWJsZVxuICAgIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJ1aWxkLCAxLjgpO1xuICB9XG4gIHNldFNwZWVkKGs6IG51bWJlcikgeyB0aGlzLnRpbWVTY2FsZSA9IGs7IHRoaXMudWkucmVuZGVyKCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBoZWxwZXJzXG4gIGFwcGx5QmFsYW5jZUNoYW5nZSgpIHsgdGhpcy51bml0VmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOyBpZiAodSkgdi5zZXRTdGFyKHUuc3Rhcik7IH0pOyB9XG4gIHRlc3RPZGRzKG4gPSAyMDApIHtcbiAgICBjb25zdCBzbG90cyA9IHRoaXMucy51bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVtaWVzID0gZW5lbXlXYXZlKHRoaXMucy53YXZlLCB0aGlzLnNlZWQpOyBsZXQgd2luID0gMCwgdCA9IDA7XG4gICAgY29uc3QgbHY6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fSwgc3YgPSBsb2FkU2F2ZSgpLnNvdWxzOyBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoc3YpKSBsdltrXSA9IChzdiBhcyBhbnkpW2tdLmxldmVsO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7IGNvbnN0IHIgPSBzaW11bGF0ZShzbG90cywgZW5lbWllcywgNTAwMCArIGksIDEzMCwgbHYsIGVuZW15UG93ZXIoKSk7IGlmIChyLndpbm5lciA9PT0gMCkgd2luKys7IHQgKz0gci50aW1lOyB9XG4gICAgcmV0dXJuIHsgd2luOiBNYXRoLnJvdW5kKCh3aW4gLyBuKSAqIDEwMCksIGF2Z1RpbWU6ICsodCAvIG4pLnRvRml4ZWQoMSksIG4gfTtcbiAgfVxuICBhZGRDYXJkKHNvdWw6IFNvdWxJZCkgeyB0aGlzLnMuaGFuZC5wdXNoKHNvdWwpOyB0aGlzLnMuc3RhdHMuZHJhd24rKzsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICBhZGREb21pbmlvbihuOiBudW1iZXIpIHsgdGhpcy5zLmNhcCArPSBuOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIHJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIGVuID0gZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKTtcbiAgICByZXR1cm4gW2BzdGFnZSAke2N1cnJlbnRTdGFnZUlkfS8ke2RpZmZpY3VsdHlOYW1lfSAgc2VlZCAke3RoaXMuc2VlZH0gIHdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX0gIGhlYXJ0cyAke3MuaGVhcnRzfSAgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9ICBwaGFzZSAke3RoaXMucGhhc2V9ICBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fWAsXG4gICAgICBgaGFuZDogJHtzLmhhbmQuam9pbignLCAnKSB8fCAnKGVtcHR5KSd9YCwgYGFybXk6ICR7cy51bml0cy5tYXAoKHUpID0+IGAke3Uuc291bH0ke3Uuc3Rhcn1AJHt1LmNlbGx9YCkuam9pbignICcpIHx8ICcobm9uZSknfWAsIGBlbmVteTogJHtlbi5tYXAoKGUpID0+IGUuc291bCArIGUuc3Rhcikuam9pbignICcpfWAsXG4gICAgICBgZGlmZmljdWx0eTogJHtkaWZmaWN1bHR5TmFtZX0gIG1lcmdlLWZyb20taGFuZDogJHtzLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJ30gIHN3YXAgdXNlZDogJHtzLmRpc2NhcmRVc2VkfWAsIGBsYXN0IHRhcDogJHt0aGlzLmxhc3RUYXBJbmZvfWAsIGBzY3JlZW46ICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSBkcHIgJHt3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpb31gLCBgbGFzdCBiYXR0bGU6ICR7dGhpcy5sYXN0QmF0dGxlIHx8ICctJ31gLCBgbG9nIHRhaWw6YCwgLi4ucy5sb2cuc2xpY2UoLTgpLCBgYmFsYW5jZTogJHtKU09OLnN0cmluZ2lmeSh7IHN0YXI6IEJBTEFOQ0Uuc3Rhciwgc3RhdHM6IEJBTEFOQ0Uuc3RhdHMgfSl9YF0uam9pbignXFxuJyk7XG4gIH1cbiAgcmVzZXRCYWxhbmNlQWxsKCkgeyByZXNldEJhbGFuY2UoKTsgdGhpcy5hcHBseUJhbGFuY2VDaGFuZ2UoKTsgfVxuICBnZXQgZGlmZmljdWx0eSgpIHsgcmV0dXJuIGRpZmZpY3VsdHlOYW1lOyB9XG4gIGNoYW5nZURpZmZpY3VsdHkobmFtZTogc3RyaW5nKSB7IHNldERpZmZpY3VsdHkobmFtZSk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudG9hc3QoYERpZmZpY3VsdHk6ICR7bmFtZX0uIEFwcGxpZXMgdG8gdGhlIG5leHQgYmF0dGxlLmApOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZ2FsbGVyeSAoc3RhciBsb29rcylcbiAgZ2FsbGVyeSgpIHtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5hZGQoJ2dhbGxlcnknKTsgdGhpcy5uZWNyby5zZXRFbmFibGVkKGZhbHNlKTsgY29uc3QgdmlzOiBVbml0VmlzdWFsW10gPSBbXTsgbGV0IHRlYW06IDAgfCAxID0gMDtcbiAgICBjb25zdCByZWJ1aWxkID0gKCkgPT4geyB2aXMuZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB2aXMubGVuZ3RoID0gMDsgU09VTFMuZm9yRWFjaCgoc291bCwgaSkgPT4gWzEsIDIsIDNdLmZvckVhY2goKHN0LCBqKSA9PiB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBzb3VsLCB0ZWFtLCBzdCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCgoaSAtIDIuNSkgKiAyLjUsIDAsIChqIC0gMSkgKiAtMi40KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgKiAwLjg1OyB2LnBsYXkoJ2lkbGUnKTsgdmlzLnB1c2godik7IH0pKTsgfTtcbiAgICByZWJ1aWxkKCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLnNldCgwLCA1LjYsIC0xNC41KTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAtMC40KSk7IHRoaXMuY2FtZXJhLmZvdiA9IDAuODU7XG4gICAgKHdpbmRvdyBhcyBhbnkpLl9fZ2FsbGVyeSA9IHsgc2V0VGVhbTogKHQ6IDAgfCAxKSA9PiB7IHRlYW0gPSB0OyByZWJ1aWxkKCk7IH0sIHZpcyB9O1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7IHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBuID0gcGVyZm9ybWFuY2Uubm93KCksIGR0ID0gTWF0aC5taW4oMC4wNSwgKG4gLSBsYXN0KSAvIDEwMDApOyBsYXN0ID0gbjsgdmlzLmZvckVhY2goKHYpID0+IHYudXBkYXRlKGR0KSk7IHRoaXMuc2NlbmUucmVuZGVyKCk7IH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgR2FtZSB9IGZyb20gJy4vZ2FtZS50cyc7XG5cbmNvbnN0IGcgPSBuZXcgR2FtZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fZ2FtZSA9IGc7ICAgICAgICAgICAgICAgICAgICAgICAvLyBoYW5keSBmb3IgZGVidWdnaW5nIGZyb20gdGhlIGJyb3dzZXIgY29uc29sZVxuZy5pbml0KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjJykgYXMgSFRNTENhbnZhc0VsZW1lbnQpXG4gIC50aGVuKCgpID0+IHsgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSBsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7ICh3aW5kb3cgYXMgYW55KS5fX2dhbWVSZWFkeSA9IHRydWU7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ2FtZS1yZWFkeScpKTsgfSlcbiAgLmNhdGNoKChlKSA9PiB7XG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSB7IGwuc3R5bGUuZGlzcGxheSA9ICdmbGV4JzsgbC50ZXh0Q29udGVudCA9ICdFcnJvcjogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IGUpOyB9XG4gICAgY29uc29sZS5lcnJvcihlKTtcbiAgfSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFvQ08sTUFBTSxXQUFvQjtBQUFBLElBQy9CLE9BQU87QUFBQSxNQUNMLFNBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sR0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFB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QUssS0FBSyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNwTCxFQUFFLE1BQU0sU0FBUyxHQUFHLElBQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEdBQUssR0FBRyxLQUFLO0FBQUEsSUFDL0ksRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsRUFDeE47QUFDQSxNQUFNLG1CQUFnQztBQUFBO0FBQUEsSUFDcEMsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQ2xFLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUN4TSxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLEdBQUssS0FBSyxJQUFJO0FBQUEsSUFDck0sRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUNuSCxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDdEksRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNySCxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUNuTixFQUFFLE1BQU0sU0FBUyxHQUFHLEdBQUcsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxFQUN2TjtBQUNBLE1BQU0saUJBQThCO0FBQUE7QUFBQSxJQUNsQyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxHQUFHLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDMUgsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUN2SyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxLQUFLLEtBQUssTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLO0FBQUEsSUFDek0sRUFBRSxNQUFNLFVBQVUsR0FBRyxPQUFPLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUM1RyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE9BQU8sR0FBRyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUNsUCxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUM5TyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsSUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsRUFDbEs7QUFLQSxNQUFNLFNBQWdDO0FBQUEsSUFDcEMsT0FBTyxFQUFFLFFBQVEsY0FBYyxPQUFPLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxLQUFLLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLENBQUMsTUFBTSxNQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxNQUFNLENBQUMsTUFBTSxNQUFNLElBQUksRUFBRTtBQUFBLElBQzVNLFdBQVcsRUFBRSxRQUFRLGtCQUFrQixPQUFPLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsTUFBTSxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxLQUFLLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxNQUFNLENBQUMsS0FBSyxLQUFLLElBQUksRUFBRTtBQUFBLElBQ3ROLFNBQVMsRUFBRSxRQUFRLGNBQWMsT0FBTyxDQUFDLE1BQU0sTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLE1BQU0sTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsTUFBTSxDQUFDLE1BQU0sTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLEdBQUcsTUFBTSxHQUFHLEdBQUcsUUFBUSxDQUFDLEtBQUssTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLEtBQUssTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUNsTixTQUFTLEVBQUUsUUFBUSxn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TSxJQUFJLElBQUksTUFBTSxVQUFVLE1BQU0sR0FBRyxRQUFXLE1BQU8sR0FBRztBQUFBLFVBQUcsQ0FBQztBQUFHLFdBQUMsS0FBSyxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sTUFBTSxFQUFFO0FBQUc7QUFBQSxRQUNuWCxLQUFLO0FBQWMsZUFBSyxLQUFLLElBQUksTUFBTSxRQUFRLE1BQU0sR0FBRyxLQUFLLEdBQUc7QUFBRyxlQUFLLEtBQUssTUFBTSxNQUFNLFdBQVcsS0FBSyxHQUFHLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxHQUFLLFlBQVksTUFBTSxLQUFLLEtBQUssR0FBRztBQUFHO0FBQUEsUUFDekssS0FBSztBQUFjLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLEtBQUssSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEtBQU0sR0FBRztBQUFHO0FBQUEsUUFDOUwsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLEtBQUssWUFBWSxNQUFNLEdBQUcsR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLE1BQU0sRUFBRTtBQUFHLFdBQUMsTUFBTSxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQzFNLEtBQUs7QUFBVyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDbkcsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUN0RyxLQUFLO0FBQVksZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLE1BQU0sT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDN0gsS0FBSztBQUFZLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEtBQUssS0FBSyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxLQUFLLEdBQUcsRUFBRTtBQUFHO0FBQUEsUUFDekssS0FBSztBQUFjLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEtBQUssS0FBSyxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLElBQUksS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEtBQU0sR0FBRztBQUFHLGVBQUssS0FBSyxNQUFNLEtBQUssUUFBUSxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQ3RRLEtBQUs7QUFBZSxXQUFDLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQ2xHLEtBQUs7QUFBUyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxHQUFHLEtBQUssTUFB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QUFRLFdBQVcsRUFBRSxJQUFJLENBQUM7QUFDak0sV0FBSyxLQUFLLE1BQU07QUFBRyxXQUFLLE1BQU0sTUFBTTtBQUFHLFdBQUssVUFBVSxNQUFNO0FBQzVELFdBQUssT0FBTyxTQUFTLFFBQVEsQ0FBQyxNQUFNO0FBQ2xDLFlBQUksRUFBRSxTQUFTLEdBQUc7QUFBRSxnQkFBTSxJQUFJLE1BQU0sRUFBRSxLQUFLLENBQUM7QUFBRyxnQkFBTSxJQUFJLEtBQUssUUFBUSxJQUFJLEVBQUUsRUFBRTtBQUFJLGVBQUssS0FBSyxJQUFJLEVBQUUsSUFBSSxDQUFDO0FBQUcsZUFBSyxNQUFNLElBQUksRUFBRSxJQUFJLEVBQUUsRUFBRTtBQUFHLFlBQUUsTUFBTSxDQUFDO0FBQUcsWUFBRSxRQUFRLEVBQUUsVUFBVSxJQUFJLElBQUk7QUFBQSxRQUFHLE9BQzlLO0FBQUUsZ0JBQU0sSUFBSSxhQUFhLEtBQUssR0FBRyxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUk7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUFHLFlBQUUsT0FBTyxTQUFTLElBQUksQ0FBQyxLQUFLLEtBQUs7QUFBRyxZQUFFLEtBQUssT0FBTztBQUFHLFlBQUUsTUFBTSxDQUFDO0FBQUcsWUFBRSxRQUFRLEVBQUUsVUFBVSxJQUFJLElBQUk7QUFBRyxlQUFLLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQztBQUFHLGVBQUssTUFBTSxLQUFLLE1BQU07QUFBRSxnQkFBSSxFQUFFLFVBQVUsUUFBUyxHQUFFLEtBQUssTUFBTTtBQUFBLFVBQUcsQ0FBQztBQUFHLGVBQUssTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxRQUFHO0FBQUEsTUFDdFcsQ0FBQztBQUNELGVBQVMsSUFBSSxHQUFHLElBQUksWUFBWSxJQUFLLE1BQUssS0FBSyxHQUFHLFFBQVE7QUFDMUQsV0FBSyxRQUFRO0FBQWMsV0FBSyxjQUFjO0FBQUssV0FBSyxNQUFNO0FBQUcsV0FBSyxTQUFTLEtBQUssTUFBTSxFQUFFLFFBQVEsR0FBRztBQUFHLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDN0k7QUFBQSxJQUNRLFlBQVksS0FBZTtBQUNqQyxZQUFNLElBQUksS0FBSztBQUNmLGlCQUFXLEtBQUssS0FBSztBQUNuQixZQUFJLEVBQUUsTUFBTSxTQUFTO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEVBQUcsR0FBRSxLQUFLLFVBQVUsRUFBRSxLQUFLO0FBQUEsUUFBRyxXQUMvRSxFQUFFLE1BQU0sT0FBTztBQUFFLGdCQUFNLElBQUksS0FBSyxLQUFLLElBQUksRUFBRSxFQUFFO0FBQUcsY0FBSSxFQUFHLEdBQUUsTUFBTTtBQUFHLGNBQUksRUFBRSxTQUFTLFFBQVMsT0FBTSxLQUFLLFVBQVU7QUFBQSxtQkFBWSxFQUFFLFNBQVMsUUFBUyxPQUFNLEtBQUssS0FBSztBQUFBLFFBQUcsV0FDbEssRUFBRSxNQUFNLFNBQVM7QUFBRSxnQkFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksR0FBSSxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7QUFBSSxlQUFLLFdBQVcsRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxFQUFFLEdBQUc7QUFBRyxnQkFBTSxLQUFLLE9BQU87QUFBQSxRQUFHLFdBQzdJLEVBQUUsTUFBTSxTQUFTO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEdBQUc7QUFBRSxjQUFFLEtBQUssT0FBTztBQUFHLGNBQUUsTUFBTSxJQUFJO0FBQUcsY0FBRSxRQUFRLElBQUk7QUFBRyxrQkFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUU7QUFBSSxrQkFBTSxLQUFLLE9BQU87QUFBRyxpQkFBSyxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFHLGdCQUFJLEVBQUUsU0FBUyxFQUFHLE1BQUssTUFBTSxHQUFHLE1BQU07QUFBRSxrQkFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUUsTUFBTSxLQUFLLEtBQUssVUFBVSxTQUFTO0FBQUUsa0JBQUUsT0FBTyxXQUFXLEtBQUs7QUFBQSxjQUFHO0FBQUEsWUFBRSxDQUFDO0FBQUEsVUFBRztBQUFBLFFBQUUsV0FDdlcsRUFBRSxNQUFNLFFBQVE7QUFBRSxnQkFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUU7QUFBSSxnQkFBTSxLQUFLLE1BQU07QUFBRyxlQUFLLE9BQU8sRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLFFBQVEsT0FBTyxLQUFLLEtBQUssQ0FBQyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsUUFBRyxXQUN4SSxFQUFFLE1BQU0sU0FBUztBQUFFLGdCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGdCQUFNLEtBQUssT0FBTztBQUFHLGVBQUssT0FBTyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxHQUFHLEdBQUcsS0FBSyxRQUFRLE1BQU0sUUFBUSxHQUFHO0FBQUEsUUFBRyxXQUMxSixFQUFFLE1BQU0sU0FBUztBQUFFLGdCQUFNLEtBQUssT0FBTztBQUFHLGVBQUssT0FBTyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUksUUFBUSxPQUFPLEdBQUcsS0FBSyxHQUFHLEdBQUcsS0FBSyxFQUFFLElBQUksS0FBSyxJQUFJO0FBQUEsUUFBRztBQUFBLE1BQ2pJO0FBQUEsSUFDRjtBQUFBLElBQ1EsV0FBVyxNQUFjLElBQVksSUFBWSxJQUFZLElBQVksS0FBYTtBQUM1RixVQUFJLE9BQU8sS0FBSyxVQUFVLElBQUk7QUFDOUIsVUFBSSxDQUFDLE1BQU07QUFBRSxlQUFPLFFBQVEsWUFBWSxlQUFlLFNBQVMsRUFBRSxRQUFRLE1BQU0sVUFBVSxNQUFNLEdBQUcsS0FBSyxLQUFLO0FBQUcsYUFBSyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQUcsYUFBSyxhQUFhO0FBQU8sY0FBTSxTQUFTLElBQUksUUFBUSxjQUFjLE1BQU0sS0FBSyxLQUFLO0FBQUcsYUFBSyxTQUFTO0FBQVEsZUFBTztBQUFBLE1BQVE7QUFDelEsV0FBSyxXQUFXLElBQUk7QUFBRyxXQUFLLGVBQWUsRUFBRSxDQUFDLEVBQUUsV0FBVyxLQUFLLFVBQVUsSUFBSTtBQUM5RSxXQUFLLE9BQU8sS0FBSyxFQUFFLE1BQU0sSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHLEdBQUcsSUFBSSxDQUFDO0FBQUEsSUFDdEQ7QUFBQSxJQUVRLE1BQU0sSUFBWTtBQUN4QixVQUFJLEtBQUssT0FBTyxnQkFBZ0IsS0FBSyxTQUFTLEtBQUssT0FBTyxpQkFBaUIsS0FBSyxNQUFPLE1BQUssYUFBYTtBQUN6RyxlQUFTLElBQUksS0FBSyxPQUFPLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFFLGFBQUssT0FBTyxDQUFDLEVBQUUsS0FBSztBQUFJLFlBQUksS0FBSyxPQUFPLENBQUMsRUFBRSxLQUFLLEdBQUc7QUFBRSxnQkFBTSxJQUFJLEtBQUssT0FBTyxDQUFDLEVBQUU7QUFBSSxlQUFLLE9BQU8sT0FBTyxHQUFHLENBQUM7QUFBRyxZQUFFO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDdkssZUFBUyxJQUFJLEtBQUssT0FBTyxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBRSxjQUFNLElBQUksS0FBSyxPQUFPLENBQUM7QUFBRyxVQUFFLEtBQUs7QUFBSSxjQUFNLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNO0FBQUcsVUFBRSxFQUFFLFFBQVEsSUFBSSxHQUFHLEdBQUcsQ0FBQztBQUFHLFVBQUUsR0FBRyxRQUFRLE9BQU8sSUFBSTtBQUFJLFlBQUksS0FBSyxHQUFHO0FBQUUsWUFBRSxFQUFFLFFBQVE7QUFBRyxZQUFFLEdBQUcsUUFBUTtBQUFHLGVBQUssT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFBLFFBQUc7QUFBQSxNQUFFO0FBQzdRLFVBQUksS0FBSyxPQUFPLEdBQUc7QUFBRSxhQUFLLE9BQU8sS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLEtBQUssS0FBSyxNQUFNO0FBQUcsY0FBTSxJQUFJLEtBQUssT0FBTyxLQUFLLFFBQVEsSUFBSSxJQUFJLEtBQUs7QUFBTyxhQUFLLE9BQU8sV0FBVyxRQUFRLFFBQVEsS0FBSyxLQUFLLFFBQVEsS0FBSyxLQUFLLE1BQU0sS0FBSyxDQUFDO0FBQUcsYUFBSyxTQUFTLFFBQVEsUUFBUSxLQUFLLEtBQUssUUFBUSxLQUFLLEtBQUssTUFBTSxLQUFLLENBQUM7QUFBRyxhQUFLLE9BQU8sVUFBVSxLQUFLLE9BQU8sTUFBTSxDQUFDO0FBQUEsTUFBRyxXQUNqVSxLQUFLLFVBQVUsWUFBWSxLQUFLLFlBQVksV0FBVyxDQUFDLEtBQUssS0FBTSxNQUFLLFlBQVksRUFBRTtBQUMvRixXQUFLLE1BQU0sT0FBTyxFQUFFO0FBQ3BCLGVBQVMsSUFBSSxLQUFLLE9BQU8sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUUsY0FBTSxJQUFJLEtBQUssT0FBTyxDQUFDO0FBQUcsVUFBRSxLQUFLO0FBQUksY0FBTSxJQUFJLEtBQUssSUFBSSxHQUFHLEVBQUUsSUFBSSxFQUFFLEdBQUc7QUFBRyxVQUFFLEdBQUcsQ0FBQztBQUFHLFlBQUksS0FBSyxHQUFHO0FBQUUsZUFBSyxPQUFPLE9BQU8sR0FBRyxDQUFDO0FBQUcsY0FBSSxFQUFFLEtBQU0sR0FBRSxLQUFLO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDdE0saUJBQVcsS0FBSyxLQUFLLFFBQVEsT0FBTyxFQUFHLEdBQUUsT0FBTyxFQUFFO0FBQ2xELFdBQUssS0FBSyxRQUFRLENBQUMsR0FBRyxPQUFPO0FBQUUsWUFBSSxDQUFDLEtBQUssTUFBTSxJQUFJLEVBQUUsRUFBRyxHQUFFLE9BQU8sRUFBRTtBQUFBLE1BQUcsQ0FBQztBQUV2RSxZQUFNLElBQUksS0FBSztBQUNmLFdBQUssS0FBSyxVQUFVLGdCQUFnQixLQUFLLFVBQVUsYUFBYSxHQUFHO0FBQ2pFLFlBQUksS0FBSyxVQUFVLGNBQWM7QUFBRSxlQUFLLGVBQWU7QUFBSSxjQUFJLEtBQUssZUFBZSxHQUFHO0FBQUUsaUJBQUssUUFBUTtBQUFVLGlCQUFLLEdBQUcsT0FBTztBQUFBLFVBQUc7QUFBQSxRQUFFO0FBQ25JLFlBQUksS0FBSyxVQUFVLFVBQVU7QUFDM0IsZUFBSyxPQUFPLEtBQUssS0FBSztBQUN0QixpQkFBTyxLQUFLLE9BQU8sSUFBSSxNQUFNLEVBQUUsU0FBUyxHQUFHO0FBQUUsY0FBRSxLQUFLLElBQUksRUFBRTtBQUFHLGlCQUFLLE9BQU8sSUFBSTtBQUFJLGlCQUFLLFlBQVksRUFBRSxNQUFNLENBQUM7QUFBQSxVQUFHO0FBQUEsUUFDaEg7QUFDQSxtQkFBVyxLQUFLLEVBQUUsVUFBVTtBQUMxQixnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksQ0FBQyxFQUFHO0FBQ3ZDLGNBQUksQ0FBQyxLQUFLLFNBQVMsS0FBSyxVQUFVLFlBQVksRUFBRSxTQUFTLElBQUk7QUFBRSxjQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBRyxjQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBRyxnQkFBSSxFQUFFLFNBQVMsS0FBTSxHQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBQSxVQUFLO0FBQ3ZLLGNBQUksRUFBRSxPQUFPO0FBQUUsY0FBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUs7QUFBRyxnQkFBSSxFQUFFLFFBQVMsR0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU87QUFBQSxVQUFHLE1BQ2pGLEdBQUUsUUFBUSxJQUFJO0FBQ25CLGNBQUksRUFBRSxVQUFVLFlBQVksRUFBRSxTQUFTLEVBQUUsVUFBVSxTQUFTO0FBQUUsa0JBQU0sT0FBTyxFQUFFLFVBQVUsUUFBUSxRQUFRO0FBQVEsZ0JBQUksS0FBSyxVQUFVLElBQUksRUFBRSxFQUFFLE1BQU0sUUFBUyxFQUFFLFVBQVUsUUFBUSxFQUFFLFVBQVUsU0FBVTtBQUFFLGtCQUFJLEVBQUUsVUFBVSxTQUFTO0FBQUUsa0JBQUUsS0FBSyxJQUFXO0FBQUcscUJBQUssVUFBVSxJQUFJLEVBQUUsSUFBSSxJQUFJO0FBQUEsY0FBRztBQUFBLFlBQUU7QUFBQSxVQUFFO0FBQ3pSLGNBQUksRUFBRSxVQUFVLFNBQVUsTUFBSyxVQUFVLElBQUksRUFBRSxJQUFJLFFBQVE7QUFBQSxRQUM3RDtBQUNBLFlBQUksRUFBRSxVQUFVLEtBQUssQ0FBQyxLQUFLLFNBQVM7QUFBRSxlQUFLLFVBQVU7QUFBTSxlQUFLLFdBQVc7QUFBQSxRQUFLO0FBQ2hGLFlBQUksS0FBSyxXQUFXLEdBQUc7QUFBRSxlQUFLLFlBQVk7QUFBSSxjQUFJLEtBQUssWUFBWSxFQUFHLE1BQUssYUFBYTtBQUFBLFFBQUc7QUFBQSxNQUM3RjtBQUNBLGVBQVMsSUFBSSxLQUFLLE9BQU8sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQ2hELGNBQU0sSUFBSSxLQUFLLE9BQU8sQ0FBQztBQUFHLFVBQUUsS0FBSyxLQUFLLEtBQUs7QUFBVyxjQUFNLElBQUksS0FBSyxJQUFJLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRztBQUN2RixjQUFNLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sR0FBRyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEdBQUcsS0FBSyxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLE1BQU0sSUFBSTtBQUNsSCxjQUFNLEtBQUssS0FBSyxJQUFJLEdBQUcsSUFBSSxJQUFJLEdBQUcsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sSUFBSSxLQUFLLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxFQUFFLElBQUksTUFBTSxLQUFLO0FBQ2xKLFVBQUUsS0FBSyxTQUFTLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBRyxVQUFFLEtBQUssT0FBTyxJQUFJLFFBQVEsUUFBUSxJQUFJLElBQUksRUFBRSxDQUFDO0FBQzlFLFlBQUksS0FBSyxHQUFHO0FBQUUsWUFBRSxLQUFLLFdBQVcsS0FBSztBQUFHLGVBQUssVUFBVSxLQUFLLEVBQUUsSUFBSTtBQUFHLGVBQUssT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFBLFFBQUc7QUFBQSxNQUNqRztBQUFBLElBQ0Y7QUFBQSxJQUVRLGVBQWU7QUFDckIsWUFBTSxJQUFJLEtBQUssUUFBUyxJQUFJLEtBQUs7QUFDakMsV0FBSyxjQUFjO0FBQ25CLFdBQUssYUFBYSxRQUFRLEVBQUUsSUFBSSxZQUFZLEtBQUssT0FBTyxLQUFLLEVBQUUsV0FBVyxJQUFJLFFBQVEsTUFBTSxPQUFPLEVBQUUsS0FBSyxRQUFRLENBQUMsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUMsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDL0osVUFBSSxFQUFFLFdBQVcsR0FBRztBQUNsQixhQUFLLFdBQVcsT0FBTyxNQUFNO0FBQzNCLGVBQUssT0FBTztBQUNaLGNBQUksVUFBVSxLQUFLLEtBQUssU0FBUztBQUMvQixnQkFBSTtBQUNGLG9CQUFNLElBQUkseUJBQXlCLEVBQUUsSUFBSTtBQUFHLG1CQUFLLFFBQVEsVUFBVSxFQUFFO0FBQU0scUJBQU8sY0FBYyxJQUFJLE1BQU0sb0JBQW9CLENBQUM7QUFDL0gsa0JBQUksRUFBRSxNQUFNO0FBQUUscUJBQUssUUFBUTtBQUFTLHFCQUFLLE1BQU0sVUFBVSxFQUFFLE9BQU8sa0RBQWtEO0FBQUEsY0FBRztBQUFBLFlBQ3pILFFBQVE7QUFBQSxZQUFzQztBQUFBLFVBQ2hEO0FBQ0EsY0FBSSxZQUFZLENBQUMsR0FBRztBQUNsQixpQkFBSyxRQUFRO0FBQU8scUJBQVM7QUFDN0IsZ0JBQUk7QUFBRSxtQkFBSyxTQUFTLG1CQUFtQixnQkFBZ0IsY0FBcUI7QUFBRyxxQkFBTyxjQUFjLElBQUksTUFBTSxvQkFBb0IsQ0FBQztBQUFBLFlBQUcsUUFBUTtBQUFFLG1CQUFLLFNBQVM7QUFBQSxZQUFNO0FBQ3BLLGlCQUFLLEdBQUcsT0FBTztBQUFHO0FBQUEsVUFDcEI7QUFDQSxlQUFLLFFBQVEsYUFBYSxDQUFDO0FBQUcsZUFBSyxRQUFRO0FBQVMsZUFBSyxXQUFXO0FBQUcsZUFBSyxHQUFHLE9BQU87QUFBQSxRQUN4RixDQUFDO0FBQUEsTUFDSCxPQUFPO0FBQ0wsaUJBQVMsQ0FBQztBQUFHLGFBQUssR0FBRyxPQUFPO0FBQUcsYUFBSyxHQUFHLFlBQVk7QUFDbkQsWUFBSSxFQUFFLFdBQVcsT0FBUSxNQUFLLFdBQVcsU0FBUyxNQUFNO0FBQUUsZUFBSyxPQUFPO0FBQU8sZUFBSyxRQUFRO0FBQVEsbUJBQVM7QUFBRyxlQUFLLEdBQUcsT0FBTztBQUFBLFFBQUcsQ0FBQztBQUFBLFlBQzVILE1BQUssV0FBVyxRQUFRLE1BQU07QUFBRSxlQUFLLE1BQU0sNkVBQTZFO0FBQUcsZUFBSyxRQUFRO0FBQUEsUUFBRyxDQUFDO0FBQUEsTUFDbko7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUdRLFdBQVcsTUFBZ0MsTUFBa0I7QUFDbkUsWUFBTSxJQUFJLEtBQUssUUFBUyxJQUFJLEtBQUs7QUFBTyxXQUFLLE9BQU87QUFBTSxVQUFJLFNBQVMsTUFBTyxNQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsT0FBTyxHQUFHO0FBQ25ILFlBQU0sT0FBTyxNQUFNO0FBQ2pCLFVBQUUsS0FBSztBQUFHLGNBQU0sS0FBSyxXQUFXO0FBQUcsY0FBTSxJQUFJLEVBQUUsV0FBVztBQUFHLGFBQUssTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLEVBQUU7QUFDN0gsbUJBQVcsS0FBSyxFQUFFLFVBQVU7QUFDMUIsY0FBSSxFQUFFLFNBQVMsRUFBRztBQUFVLGdCQUFNLE1BQU0sS0FBSyxNQUFNLElBQUksRUFBRSxFQUFFLEdBQUcsSUFBSSxLQUFLLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sR0FBRyxHQUFHLElBQUksS0FBSyxLQUFLLElBQUksRUFBRSxFQUFFO0FBQUcsY0FBSSxDQUFDLEtBQUssQ0FBQyxFQUFHO0FBQ2pKLGdCQUFNLEtBQUssS0FBSyxJQUFJLEVBQUUsSUFBSSxHQUFHLEtBQUssRUFBRSxPQUFPLFNBQVMsR0FBRyxLQUFLLEVBQUUsT0FBTyxTQUFTO0FBQUcsWUFBRSxNQUFNLElBQUk7QUFBRyxZQUFFLFFBQVEsSUFBSTtBQUM5RyxjQUFJLENBQUMsRUFBRSxPQUFPO0FBQUUsY0FBRSxLQUFLLE9BQU87QUFBRyxpQkFBSyxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUcsaUJBQUssT0FBTyxJQUFJLElBQUksSUFBSSxRQUFRLE9BQU8sS0FBSyxNQUFNLENBQUMsR0FBRyxLQUFLLEtBQUssR0FBRztBQUFBLFVBQUc7QUFDM0ssZUFBSztBQUFBLFlBQU07QUFBQSxZQUFLLENBQUMsTUFBTTtBQUFFLGdCQUFFLE9BQU8sU0FBUyxJQUFJLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRyxLQUFLLElBQUksSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQztBQUFHLGdCQUFFLE9BQU8sU0FBUyxNQUFNLEtBQUssS0FBSyxJQUFJLEVBQUUsT0FBTyxTQUFTLEtBQUssS0FBSyxJQUFJLEdBQUcsSUFBSSxNQUFNLEdBQUc7QUFBQSxZQUFHO0FBQUEsWUFDaE4sTUFBTTtBQUFFLGdCQUFFLE9BQU8sU0FBUyxJQUFJO0FBQUcsbUJBQUssTUFBTSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxZQUFHO0FBQUEsVUFBQztBQUFBLFFBQzlHO0FBQUEsTUFDRjtBQUNBLFVBQUksU0FBUyxPQUFPO0FBRWxCLGNBQU0sS0FBSyxTQUFTO0FBQ3BCLG1CQUFXLEtBQUssRUFBRSxTQUFVLEtBQUksRUFBRSxTQUFTLEtBQUssRUFBRSxPQUFPO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEVBQUcsTUFBSyxNQUFNLEtBQUssT0FBTyxJQUFJLE1BQU0sTUFBTSxFQUFFLEtBQUssT0FBTyxDQUFDO0FBQUEsUUFBRztBQUMxSixhQUFLLE1BQU0sS0FBSyxNQUFNO0FBQUUsZUFBSyxTQUFTLEtBQUssTUFBTSxFQUFFLE9BQU8sR0FBRztBQUFHLFlBQUUsS0FBSztBQUFBLFFBQUcsQ0FBQztBQUMzRSxhQUFLLE1BQU0sTUFBTSxJQUFJO0FBQUcsYUFBSyxNQUFNLEtBQUssSUFBSTtBQUFHO0FBQUEsTUFDakQ7QUFDQSxRQUFFLEtBQUs7QUFBRyxZQUFNLEtBQUssV0FBVztBQUFHLFdBQUssTUFBTSxNQUFNLE1BQU07QUFBRSxjQUFNLElBQUksRUFBRSxXQUFXO0FBQUcsYUFBSyxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFBLE1BQUcsQ0FBQztBQUMzSixVQUFJLFNBQVMsU0FBUztBQUFFLGFBQUssTUFBTSxLQUFLLE1BQU07QUFBRSxZQUFFLE9BQU87QUFBRyxnQkFBTSxLQUFLLFFBQVE7QUFBQSxRQUFHLENBQUM7QUFBRyxhQUFLLE1BQU0sS0FBSyxJQUFJO0FBQUc7QUFBQSxNQUFRO0FBQ3JILFdBQUssTUFBTSxHQUFLLE1BQU07QUFDcEIsVUFBRSxLQUFLO0FBQUcsY0FBTSxLQUFLLFdBQVc7QUFBRyxjQUFNLElBQUksRUFBRSxXQUFXO0FBQzFELGFBQUssT0FBTyxFQUFFLEdBQUcsR0FBRyxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHO0FBQUcsYUFBSyxPQUFPLEVBQUUsR0FBRyxHQUFHLElBQUksUUFBUSxPQUFPLEdBQUcsR0FBRyxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUc7QUFDbkksYUFBSyxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxHQUFHLE1BQU0sR0FBRyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLEdBQUcsRUFBRTtBQUM5RCxtQkFBVyxLQUFLLEVBQUUsVUFBVTtBQUMxQixjQUFJLEVBQUUsU0FBUyxLQUFLLENBQUMsRUFBRSxNQUFPO0FBQVUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLENBQUMsRUFBRztBQUMvRSxnQkFBTSxLQUFLLFFBQVEsR0FBRyxFQUFFLElBQUksR0FBRyxLQUFLLEVBQUUsT0FBTyxTQUFTLEdBQUcsS0FBSyxFQUFFLE9BQU8sU0FBUztBQUFHLFlBQUUsTUFBTTtBQUMzRixlQUFLLE1BQU0sS0FBSyxDQUFDLE1BQU07QUFBRSxjQUFFLE9BQU8sU0FBUyxJQUFJLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRyxLQUFLLElBQUksSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQztBQUFHLGNBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxTQUFTLElBQUksRUFBRSxLQUFLLEVBQUUsU0FBUyxDQUFDO0FBQUEsVUFBRyxHQUFHLE1BQU07QUFBRSxjQUFFLE9BQU8sU0FBUyxJQUFJO0FBQUcsY0FBRSxNQUFNLENBQUM7QUFBQSxVQUFHLENBQUM7QUFBQSxRQUNoTztBQUFBLE1BQ0YsQ0FBQztBQUNELFdBQUssTUFBTSxLQUFLLElBQUk7QUFBRyxXQUFLLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDN0M7QUFBQSxJQUNBLFVBQVUsS0FBYTtBQUFFLFVBQUksQ0FBQyxLQUFLLE1BQU87QUFBUSxnQkFBVSxLQUFLLEdBQUcsS0FBSyxPQUFPLEdBQUc7QUFBRyxXQUFLLFFBQVE7QUFBTSxpQkFBVyxLQUFLLENBQUM7QUFBRyxXQUFLLFFBQVE7QUFBQSxJQUFHO0FBQUEsSUFDckksVUFBVTtBQUNoQixXQUFLLE9BQU87QUFBTyxXQUFLLE1BQU0sT0FBTztBQUFHLFdBQUssWUFBWTtBQUN6RCxXQUFLLFlBQVk7QUFBRyxXQUFLLFNBQVMsSUFBSTtBQUN0QyxpQkFBVyxLQUFLLEtBQUssRUFBRSxPQUFPO0FBQzVCLGNBQU0sSUFBSSxLQUFLLFFBQVEsSUFBSSxFQUFFLEVBQUU7QUFBSSxjQUFNLElBQUksS0FBSyxJQUFJLEVBQUUsSUFBSTtBQUFHLFVBQUUsT0FBTyxTQUFTLElBQUksRUFBRSxHQUFHLEdBQUcsRUFBRSxDQUFDO0FBQUcsVUFBRSxPQUFPLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxVQUFFLE9BQU8sV0FBVyxJQUFJO0FBQUcsVUFBRSxNQUFNLElBQUk7QUFBRyxVQUFFLFFBQVEsSUFBSTtBQUFHLFVBQUUsS0FBSyxPQUFPO0FBQUcsYUFBSyxTQUFTLEVBQUUsR0FBRyxFQUFFLENBQUM7QUFDeE8sYUFBSyxNQUFNLEtBQUssTUFBTSxFQUFFLEtBQUssTUFBTSxDQUFDO0FBQUEsTUFDdEM7QUFDQSxXQUFLLFFBQVE7QUFBUyxXQUFLLE1BQU07QUFBTSxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUN4RSxXQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsT0FBTyxHQUFHO0FBQUEsSUFDdkM7QUFBQSxJQUNBLFNBQVMsR0FBVztBQUFFLFdBQUssWUFBWTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFBRztBQUFBO0FBQUEsSUFHNUQscUJBQXFCO0FBQUUsV0FBSyxRQUFRLFFBQVEsQ0FBQyxHQUFHLE9BQU87QUFBRSxjQUFNLElBQUksS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUU7QUFBRyxZQUFJLEVBQUcsR0FBRSxRQUFRLEVBQUUsSUFBSTtBQUFBLE1BQUcsQ0FBQztBQUFBLElBQUc7QUFBQSxJQUN4SSxTQUFTLElBQUksS0FBSztBQUNoQixZQUFNLFFBQVEsS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsVUFBVSxVQUFVLEtBQUssRUFBRSxNQUFNLEtBQUssSUFBSTtBQUFHLFVBQUksTUFBTSxHQUFHLElBQUk7QUFDckosWUFBTSxLQUE2QixDQUFDLEdBQUcsS0FBSyxTQUFTLEVBQUU7QUFBTyxpQkFBVyxLQUFLLE9BQU8sS0FBSyxFQUFFLEVBQUcsSUFBRyxDQUFDLElBQUssR0FBVyxDQUFDLEVBQUU7QUFDdEgsZUFBUyxJQUFJLEdBQUcsSUFBSSxHQUFHLEtBQUs7QUFBRSxjQUFNLElBQUksU0FBUyxPQUFPLFNBQVMsTUFBTyxHQUFHLEtBQUssSUFBSSxXQUFXLENBQUM7QUFBRyxZQUFJLEVBQUUsV0FBVyxFQUFHO0FBQU8sYUFBSyxFQUFFO0FBQUEsTUFBTTtBQUMzSSxhQUFPLEVBQUUsS0FBSyxLQUFLLE1BQU8sTUFBTSxJQUFLLEdBQUcsR0FBRyxTQUFTLEVBQUUsSUFBSSxHQUFHLFFBQVEsQ0FBQyxHQUFHLEVBQUU7QUFBQSxJQUM3RTtBQUFBLElBQ0EsUUFBUSxNQUFjO0FBQUUsV0FBSyxFQUFFLEtBQUssS0FBSyxJQUFJO0FBQUcsV0FBSyxFQUFFLE1BQU07QUFBUyxXQUFLLEdBQUcsT0FBTztBQUFBLElBQUc7QUFBQSxJQUN4RixZQUFZLEdBQVc7QUFBRSxXQUFLLEVBQUUsT0FBTztBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFBRztBQUFBLElBQzVELFNBQWlCO0FBQ2YsWUFBTSxJQUFJLEtBQUssR0FBRyxLQUFLLFVBQVUsRUFBRSxNQUFNLEtBQUssSUFBSTtBQUNsRCxhQUFPO0FBQUEsUUFBQyxTQUFTLGNBQWMsSUFBSSxjQUFjLFVBQVUsS0FBSyxJQUFJLFVBQVUsRUFBRSxJQUFJLElBQUksV0FBVyxDQUFDLENBQUMsWUFBWSxFQUFFLE1BQU0sY0FBYyxhQUFhLENBQUMsQ0FBQyxJQUFJLEVBQUUsR0FBRyxXQUFXLEtBQUssS0FBSyxhQUFhLEtBQUssT0FBTztBQUFBLFFBQzNNLFNBQVMsRUFBRSxLQUFLLEtBQUssSUFBSSxLQUFLLFNBQVM7QUFBQSxRQUFJLFNBQVMsRUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBRSxJQUFJLEdBQUcsRUFBRSxJQUFJLElBQUksRUFBRSxJQUFJLEVBQUUsRUFBRSxLQUFLLEdBQUcsS0FBSyxRQUFRO0FBQUEsUUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssR0FBRyxDQUFDO0FBQUEsUUFDbEwsZUFBZSxjQUFjLHNCQUFzQixFQUFFLE1BQU0sVUFBVSxpQkFBaUIsZ0JBQWdCLEVBQUUsV0FBVztBQUFBLFFBQUksYUFBYSxLQUFLLFdBQVc7QUFBQSxRQUFJLFdBQVcsS0FBSyxPQUFPLFdBQVcsSUFBSSxLQUFLLE9BQU8sWUFBWSxRQUFRLE9BQU8sZ0JBQWdCO0FBQUEsUUFBSSxnQkFBZ0IsS0FBSyxjQUFjLEdBQUc7QUFBQSxRQUFJO0FBQUEsUUFBYSxHQUFHLEVBQUUsSUFBSSxNQUFNLEVBQUU7QUFBQSxRQUFHLFlBQVksS0FBSyxVQUFVLEVBQUUsTUFBTSxRQUFRLE1BQU0sT0FBTyxRQUFRLE1BQU0sQ0FBQyxDQUFDO0FBQUEsTUFBRSxFQUFFLEtBQUssSUFBSTtBQUFBLElBQzdaO0FBQUEsSUFDQSxrQkFBa0I7QUFBRSxtQkFBYTtBQUFHLFdBQUssbUJBQW1CO0FBQUEsSUFBRztBQUFBLElBQy9ELElBQUksYUFBYTtBQUFFLGFBQU87QUFBQSxJQUFnQjtBQUFBLElBQzFDLGlCQUFpQixNQUFjO0FBQUUsb0JBQWMsSUFBSTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUcsV0FBSyxNQUFNLGVBQWUsSUFBSSwrQkFBK0I7QUFBQSxJQUFHO0FBQUE7QUFBQSxJQUd4SSxVQUFVO0FBQ1IsZUFBUyxLQUFLLFVBQVUsSUFBSSxTQUFTO0FBQUcsV0FBSyxNQUFNLFdBQVcsS0FBSztBQUFHLFlBQU0sTUFBb0IsQ0FBQztBQUFHLFVBQUksT0FBYztBQUN0SCxZQUFNLFVBQVUsTUFBTTtBQUFFLFlBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUM7QUFBRyxZQUFJLFNBQVM7QUFBRyxjQUFNLFFBQVEsQ0FBQyxNQUFNLE1BQU0sQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxJQUFJLE1BQU07QUFBRSxnQkFBTSxJQUFJLGFBQWEsS0FBSyxHQUFHLE1BQU0sTUFBTSxFQUFFO0FBQUcsWUFBRSxPQUFPLFNBQVMsS0FBSyxJQUFJLE9BQU8sS0FBSyxJQUFJLElBQUksS0FBSyxJQUFJO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBTSxZQUFFLEtBQUssTUFBTTtBQUFHLGNBQUksS0FBSyxDQUFDO0FBQUEsUUFBRyxDQUFDLENBQUM7QUFBQSxNQUFHO0FBQ3RULGNBQVE7QUFBRyxXQUFLLE9BQU8sU0FBUyxJQUFJLEdBQUcsS0FBSyxLQUFLO0FBQUcsV0FBSyxPQUFPLFVBQVUsSUFBSSxRQUFRLFFBQVEsR0FBRyxLQUFLLElBQUksQ0FBQztBQUFHLFdBQUssT0FBTyxNQUFNO0FBQ2hJLE1BQUMsT0FBZSxZQUFZLEVBQUUsU0FBUyxDQUFDLE1BQWE7QUFBRSxlQUFPO0FBQUcsZ0JBQVE7QUFBQSxNQUFHLEdBQUcsSUFBSTtBQUNuRixVQUFJLE9BQU8sWUFBWSxJQUFJO0FBQUcsV0FBSyxPQUFPLGNBQWMsTUFBTTtBQUFFLGNBQU0sSUFBSSxZQUFZLElBQUksR0FBRyxLQUFLLEtBQUssSUFBSSxPQUFPLElBQUksUUFBUSxHQUFJO0FBQUcsZUFBTztBQUFHLFlBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUFHLGFBQUssTUFBTSxPQUFPO0FBQUEsTUFBRyxDQUFDO0FBQUEsSUFDek07QUFBQSxFQUNGOzs7QUNuaEJBLE1BQU0sSUFBSSxJQUFJLEtBQUs7QUFDbkIsRUFBQyxPQUFlLFNBQVM7QUFDekIsSUFBRSxLQUFLLFNBQVMsZUFBZSxHQUFHLENBQXNCLEVBQ3JELEtBQUssTUFBTTtBQUFFLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksRUFBRyxHQUFFLE1BQU0sVUFBVTtBQUFRLElBQUMsT0FBZSxjQUFjO0FBQU0sV0FBTyxjQUFjLElBQUksTUFBTSxrQkFBa0IsQ0FBQztBQUFBLEVBQUcsQ0FBQyxFQUN0TCxNQUFNLENBQUMsTUFBTTtBQUNaLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksR0FBRztBQUFFLFFBQUUsTUFBTSxVQUFVO0FBQVEsUUFBRSxjQUFjLGFBQWEsS0FBSyxFQUFFLFVBQVUsRUFBRSxVQUFVO0FBQUEsSUFBSTtBQUMvSSxZQUFRLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLENBQUM7IiwKICAibmFtZXMiOiBbImciLCAiZW5lbXlQb3dlciIsICJ0ZyIsICJnIiwgImciLCAiS0VZIiwgIlZFUlNJT04iLCAic3RhZ2VXYXZlcyIsICJkcmF3IiwgImciLCAiZyJdCn0K
