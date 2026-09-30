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
      $("btnRemove").textContent = g2.confirmRemove ? "Confirm remove" : "Remove";
      $("info").textContent = build ? g2.swapMode ? "SWAP: tap a hand card to discard it, or tap a unit you did not summon this round to sell it. You draw a different Soul." : selU ? `${SOUL_NAME[selU.soul]} ${stars(selU.star)}  \u2022  ${ROLE_TEXT[selU.soul]}  ${partner ? "\u2022 Tap the matching unit to merge into a stronger star." : ""}` : g2.sel && g2.sel.type === "card" ? `${SOUL_NAME[s.hand[g2.sel.idx]]}: ${ROLE_TEXT[s.hand[g2.sel.idx]]}  \u2022  ` + (() => {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2dhbWUvYXJlbmEudHMiLCAiLi4vY29yZS9iYXR0bGUudHMiLCAiLi4vY29yZS9lbmRsZXNzLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9wYWNrcy50cyIsICIuLi9jb3JlL3NhdmUudHMiLCAiLi4vZ2FtZS9uZWNyb21hbmNlci50cyIsICIuLi9nYW1lL2F1ZGlvLnRzIiwgIi4uL2NvcmUvcnVuc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvdmlzdWFscy50cyIsICIuLi91aS9pY29ucy50cyIsICIuLi91aS9wb3J0cmFpdHMudHMiLCAiLi4vZ2FtZS91aS50cyIsICIuLi9nYW1lL2dhbWUudHMiLCAiLi4vZ2FtZS9tYWluLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBTSU5HTEUgU09VUkNFIE9GIFRSVVRIIGZvciBldmVyeSBudW1iZXIgdGhhdCBhZmZlY3RzIGNvbWJhdC5cbi8vIFRoZSBkZWJ1ZyBwYW5lbCBlZGl0cyBCQUxBTkNFIGxpdmU7IGByZXNldEJhbGFuY2UoKWAgcmVzdG9yZXMgdGhlc2UgZGVmYXVsdHMuXG4vLyBBbGwgdmFsdWVzIGFyZSBmaXJzdC1wYXNzIGd1ZXNzZXMgbWVhbnQgdG8gYmUgdHVuZWQgYnkgcGxheWluZyBhbmQgYnkgYG5vZGUgc2ltL2NhbXBhaWduLnRzYC5cblxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXRTdGF0cyB7XG4gIGhwOiBudW1iZXI7ICAgICAgICAgLy8gMS1zdGFyIGhpdCBwb2ludHNcbiAgZG1nOiBudW1iZXI7ICAgICAgICAvLyAxLXN0YXIgZGFtYWdlIHBlciBoaXQgKHBlciBhcnJvdyBmb3IgdGhlIEFyY2hlcilcbiAgaW50ZXJ2YWw6IG51bWJlcjsgICAvLyBzZWNvbmRzIGJldHdlZW4gYXR0YWNrc1xuICByYW5nZTogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyAoY2VudHJlIHRvIGNlbnRyZSlcbiAgc3BlZWQ6IG51bWJlcjsgICAgICAvLyBtZXRyZXMgcGVyIHNlY29uZFxuICBzaXplOiBudW1iZXI7ICAgICAgIC8vIGJvZHkgcmFkaXVzLCB1c2VkIGZvciBzcGFjaW5nIGFuZCB2aXN1YWxzXG4gIGFuaW1MZW46IG51bWJlcjsgICAgLy8gc2Vjb25kczogbGVuZ3RoIG9mIHRoaXMgdW5pdCdzIGF0dGFjayBjbGlwIGF0IG5vcm1hbCBzcGVlZFxuICBoaXRGcmFjOiBudW1iZXI7ICAgIC8vIDAtMTogaG93IGZhciBpbnRvIHRoZSBjbGlwIHRoZSBibG93IGxhbmRzIC8gdGhlIGFycm93IGlzIHJlbGVhc2VkXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQmFsYW5jZSB7XG4gIHN0YXRzOiBSZWNvcmQ8U291bElkLCBVbml0U3RhdHM+O1xuICBzdGFyOiB7XG4gICAgaHA6IG51bWJlcltdOyAgICAgLy8gbXVsdGlwbGllciBhdCAxLCAyLCAzIHN0YXJzXG4gICAgZG1nOiBudW1iZXJbXTtcbiAgICBzY2FsZTogbnVtYmVyW107ICAvLyB2aXN1YWwgc2l6ZVxuICB9O1xuICBwaGFsYW54OiB7IHJhZGl1czogbnVtYmVyOyBwZXJBbGx5OiBudW1iZXI7IG1heFN0YWNrczogbnVtYmVyIH07ICAgICAgICAgIC8vIFNrZWxldG9uIFdhcnJpb3JcbiAgbWFuYTogUGFydGlhbDxSZWNvcmQ8U291bElkLCB7IG1heDogbnVtYmVyOyBwZXJBdHRhY2s6IG51bWJlcjsgcGVySGl0OiBudW1iZXIgfT4+OyAvLyB1bml0cyBXSVRIIGEgc2tpbGw7IHRoZSByZXN0IGFyZSBwYXNzaXZlLW9ubHlcbiAgdm9sbGV5OiB7IHRhcmdldHM6IG51bWJlcjsgcHJvamVjdGlsZVNwZWVkOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAvLyBTa2VsZXRvbiBBcmNoZXIgc2tpbGw6IFNwbGl0IEFycm93XG4gIG9wcG9ydHVuaXN0OiB7IGJvbnVzOiBudW1iZXI7IHNlZWtSYWRpdXM6IG51bWJlcjsgd291bmRlZFdlaWdodDogbnVtYmVyIH07IC8vIEdvYmxpblxuICB0YXVudDogeyBkdXJhdGlvbjogbnVtYmVyOyByYWRpdXM6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEtuaWdodCBza2lsbFxuICBzbWFzaDogeyBtdWx0OiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE9ncmUgc2tpbGxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiBudW1iZXI7IG1heFN0YWNrczogbnVtYmVyOyByZXNldEFmdGVyOiBudW1iZXIgfTsgICAgICAvLyBCYXJiYXJpYW5cbiAgLyoqIFBMQUNFSE9MREVSIHBlcm1hbmVudC1sZXZlbCBncm93dGggKHBlciBsZXZlbCBhYm92ZSAxKS4gU2hvd24gb24gdGhlIFNvdWxzIHBhZ2U7IE5PVCBhcHBsaWVkIGluIGJhdHRsZXMgeWV0LiAqL1xuICBsZXZlbDogeyBocDogbnVtYmVyOyBkbWc6IG51bWJlcjsgY29waWVzVG9MZXZlbDogbnVtYmVyW10gfTtcbiAgc2ltOiB7IHNlcGFyYXRpb246IG51bWJlcjsgaGl0RnJhY3Rpb246IG51bWJlcjsgdGltZUxpbWl0OiBudW1iZXI7IHJldGFyZ2V0RXZlcnk6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVFM6IEJhbGFuY2UgPSB7XG4gIHN0YXRzOiB7XG4gICAgd2FycmlvcjogICB7IGhwOiA2MCwgIGRtZzogOCwgIGludGVydmFsOiAwLjksIHJhbmdlOiAwLjg1LCBzcGVlZDogMS40LCBzaXplOiAwLjI4LCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNDcgfSxcbiAgICBhcmNoZXI6ICAgIHsgaHA6IDQwLCAgZG1nOiA3LCAgaW50ZXJ2YWw6IDEuNywgcmFuZ2U6IDUuMCwgIHNwZWVkOiAxLjEsIHNpemU6IDAuMjYsIGFuaW1MZW46IDEuNSwgaGl0RnJhYzogMC43OCB9LFxuICAgIGdvYmxpbjogICAgeyBocDogNDUsICBkbWc6IDksICBpbnRlcnZhbDogMC44LCByYW5nZTogMC44LCAgc3BlZWQ6IDEuNywgc2l6ZTogMC4yNCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjUgfSxcbiAgICBrbmlnaHQ6ICAgIHsgaHA6IDEzMCwgZG1nOiA5LCAgaW50ZXJ2YWw6IDEuMSwgcmFuZ2U6IDAuOSwgIHNwZWVkOiAxLjAsIHNpemU6IDAuMzIsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAgb2dyZTogICAgICB7IGhwOiAxNzAsIGRtZzogMTYsIGludGVydmFsOiAxLjksIHJhbmdlOiAxLjA1LCBzcGVlZDogMC44LCBzaXplOiAwLjQyLCBhbmltTGVuOiAxLjIsIGhpdEZyYWM6IDAuNTUgfSxcbiAgICBiYXJiYXJpYW46IHsgaHA6IDc1LCAgZG1nOiA4LCAgaW50ZXJ2YWw6IDAuOTUsIHJhbmdlOiAwLjksIHNwZWVkOiAxLjUsIHNpemU6IDAuMzAsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gIH0sXG4gIC8vIFwiYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHlcIjogSFAgZ3Jvd3MgZmFzdGVyIHRoYW4gZGFtYWdlIHBlciBzdGFyXG4gIHN0YXI6IHsgaHA6IFsxLCAyLjAsIDMuMl0sIGRtZzogWzEsIDEuNSwgMi4wXSwgc2NhbGU6IFsxLCAxLjEyLCAxLjI1XSB9LFxuICBwaGFsYW54OiB7IHJhZGl1czogMi4wLCBwZXJBbGx5OiAwLjA4LCBtYXhTdGFja3M6IDMgfSxcbiAgLy8gbWFuYSBmaWxscyBmYXN0OiBhIGJhc2ljIGF0dGFjayBnaXZlcyBwZXJBdHRhY2ssIHRha2luZyBhIGhpdCBnaXZlcyBwZXJIaXQ7IGEgZnVsbCBiYXIgZmlyZXMgdGhlIHNraWxsIG9uIHRoZSBuZXh0IGF0dGFjaywgdGhlbiByZXNldHNcbiAgbWFuYToge1xuICAgIGFyY2hlcjogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTcGxpdCBBcnJvdyBhYm91dCBldmVyeSAzcmQgc2hvdFxuICAgIG9ncmU6ICAgeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTbWFzaCBhYm91dCBldmVyeSAzcmQgc3dpbmdcbiAgICBrbmlnaHQ6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMjUsIHBlckhpdDogMTIgfSwgICAgLy8gVGF1bnQgZXZlcnkgfjQgc3dpbmdzLCBzb29uZXIgd2hlbiBoZSBpcyBiZWluZyBoaXRcbiAgfSxcbiAgdm9sbGV5OiB7IHRhcmdldHM6IDMsIHByb2plY3RpbGVTcGVlZDogMTQgfSxcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IDAuNSwgc2Vla1JhZGl1czogNC4wLCB3b3VuZGVkV2VpZ2h0OiAxLjUgfSxcbiAgdGF1bnQ6IHsgZHVyYXRpb246IDMsIHJhZGl1czogNC41IH0sXG4gIHNtYXNoOiB7IG11bHQ6IDIuMCwgcmFkaXVzOiAxLjYgfSxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiAwLjEyLCBtYXhTdGFja3M6IDgsIHJlc2V0QWZ0ZXI6IDAuNiB9LFxuICBsZXZlbDogeyBocDogMC4wOCwgZG1nOiAwLjA4LCBjb3BpZXNUb0xldmVsOiBbNSwgMTAsIDIwLCA0MCwgODAsIDEyMCwgMjAwLCAzMDAsIDUwMF0gfSxcbiAgc2ltOiB7IHNlcGFyYXRpb246IDAuNiwgaGl0RnJhY3Rpb246IDAuNDcsIHRpbWVMaW1pdDogMTIwLCByZXRhcmdldEV2ZXJ5OiAwLjUgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBCQUxBTkNFOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRCYWxhbmNlKCk6IHZvaWQge1xuICBjb25zdCBmcmVzaDogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGZyZXNoKSBhcyAoa2V5b2YgQmFsYW5jZSlbXSkgKEJBTEFOQ0UgYXMgYW55KVtrXSA9IChmcmVzaCBhcyBhbnkpW2tdO1xufVxuXG5leHBvcnQgY29uc3QgUk9MRV9URVhUOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnQ2hlYXAgYW5kIGZhc3QuIFRvdWdoZXIgbmVhciBvdGhlciBXYXJyaW9ycy4nLFxuICBhcmNoZXI6ICdGcmFnaWxlLiBTa2lsbDogU3BsaXQgQXJyb3cgaGl0cyAzIGRpZmZlcmVudCBlbmVtaWVzLicsXG4gIGdvYmxpbjogJ0Zhc3QuIEhpdHMgaGFyZGVyIG9uIGVuZW1pZXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLicsXG4gIGtuaWdodDogJ1RhbmsuIFNraWxsOiBUYXVudCBwdWxscyBlbmVtaWVzIG9udG8gaGltLicsXG4gIG9ncmU6ICdTbG93LCBodWdlIGRhbWFnZS4gU2tpbGw6IFNtYXNoLCBhIGJpZyBhcmVhIHNsYW0uJyxcbiAgYmFyYmFyaWFuOiAnU3dpbmdzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgaGl0LicsXG59O1xuXG5leHBvcnQgY29uc3QgU09VTF9OQU1FOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnU2tlbGV0b24gV2FycmlvcicsIGFyY2hlcjogJ1NrZWxldG9uIEFyY2hlcicsIGdvYmxpbjogJ0dvYmxpbicsXG4gIGtuaWdodDogJ0tuaWdodCcsIG9ncmU6ICdPZ3JlJywgYmFyYmFyaWFuOiAnQmFyYmFyaWFuJyxcbn07XG5cbi8qKiBBYmlsaXR5IGJsdXJicyBmb3IgdGhlIFNvdWxzIHBhZ2UsIHdpdGggdGhlIGxpdmUgbnVtYmVycyBmaWxsZWQgaW4uICovXG5leHBvcnQgZnVuY3Rpb24gYWJpbGl0eUluZm8oc291bDogU291bElkKTogeyBraW5kOiAnc2tpbGwnIHwgJ3Bhc3NpdmUnOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZyB9IHtcbiAgY29uc3QgQiA9IEJBTEFOQ0UsIHBjdCA9ICh4OiBudW1iZXIpID0+IE1hdGgucm91bmQoeCAqIDEwMCkgKyAnJSc7XG4gIHN3aXRjaCAoc291bCkge1xuICAgIGNhc2UgJ3dhcnJpb3InOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdQaGFsYW54JywgdGV4dDogYFRha2VzICR7cGN0KEIucGhhbGFueC5wZXJBbGx5KX0gbGVzcyBkYW1hZ2UgZm9yIGVhY2ggb3RoZXIgU2tlbGV0b24gV2FycmlvciB3aXRoaW4gJHtCLnBoYWxhbngucmFkaXVzfW0gKHVwIHRvICR7Qi5waGFsYW54Lm1heFN0YWNrc30pLmAgfTtcbiAgICBjYXNlICdnb2JsaW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdPcHBvcnR1bmlzdCcsIHRleHQ6IGBEZWFscyAke3BjdChCLm9wcG9ydHVuaXN0LmJvbnVzKX0gbW9yZSBkYW1hZ2UgdG8gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2UsIGFuZCBwcmVmZXJzIHN1Y2ggdGFyZ2V0cy5gIH07XG4gICAgY2FzZSAnYmFyYmFyaWFuJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnRnJlbnp5JywgdGV4dDogYEF0dGFja3MgJHtwY3QoQi5mcmVuenkucGVyU3dpbmcpfSBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nICh1cCB0byAke0IuZnJlbnp5Lm1heFN0YWNrc30gdGltZXMpLmAgfTtcbiAgICBjYXNlICdhcmNoZXInOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU3BsaXQgQXJyb3cnLCB0ZXh0OiBgQmFzaWMgc2hvdHMgZmlyZSBvbmUgYXJyb3cuIFdoZW4gbWFuYSBpcyBmdWxsLCB0aGUgbmV4dCBzaG90IGZpcmVzIGF0IHVwIHRvICR7Qi52b2xsZXkudGFyZ2V0c30gZGlmZmVyZW50IGVuZW1pZXMuYCB9O1xuICAgIGNhc2UgJ2tuaWdodCc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdUYXVudCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgZW5lbWllcyB3aXRoaW4gJHtCLnRhdW50LnJhZGl1c31tIG11c3QgYXR0YWNrIGhpbSBmb3IgJHtCLnRhdW50LmR1cmF0aW9ufXMuYCB9O1xuICAgIGNhc2UgJ29ncmUnOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU21hc2gnLCB0ZXh0OiBgV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHN3aW5nIGRlYWxzICR7Qi5zbWFzaC5tdWx0fXggZGFtYWdlIGFuZCBoaXRzIGVuZW1pZXMgbmVhciB0aGUgdGFyZ2V0IGZvciA2MCUgYXMgbXVjaC5gIH07XG4gIH1cbn1cbiIsICIvLyBEZXNpZ24gZGF0YSBzdHJhaWdodCBmcm9tIHRoZSBwbGFuIGRvYy4gQW55dGhpbmcgbWFya2VkIFBMQUNFSE9MREVSIGlzIG5vdCBpbiB0aGUgZG9jIHlldC5cblxuZXhwb3J0IHR5cGUgU291bElkID0gJ3dhcnJpb3InIHwgJ2FyY2hlcicgfCAnZ29ibGluJyB8ICdrbmlnaHQnIHwgJ29ncmUnIHwgJ2JhcmJhcmlhbic7XG5cbmV4cG9ydCBjb25zdCBTT1VMUzogU291bElkW10gPSBbJ3dhcnJpb3InLCAnYXJjaGVyJywgJ2dvYmxpbicsICdrbmlnaHQnLCAnb2dyZScsICdiYXJiYXJpYW4nXTtcblxuLyoqIERvbWluaW9uIGNvc3QgcGVyIHN0YXIgbGV2ZWw6IGluZGV4IDAgPSAxIHN0YXIsIDEgPSAyIHN0YXJzLCAyID0gMyBzdGFycyAoMyBzdGFycyBpcyB0aGUgbWF4KS4gKi9cbmV4cG9ydCBjb25zdCBDT1NUOiBSZWNvcmQ8U291bElkLCBudW1iZXJbXT4gPSB7XG4gIHdhcnJpb3I6IFsyLCAzLCA0XSxcbiAgYXJjaGVyOiBbNCwgNiwgOV0sXG4gIGdvYmxpbjogWzMsIDQsIDZdLFxuICBrbmlnaHQ6IFs1LCA3LCAxMF0sXG4gIG9ncmU6IFs3LCAxMCwgMTVdLFxuICBiYXJiYXJpYW46IFs1LCA3LCAxMF0sIC8vIFBMQUNFSE9MREVSOiB0aGUgZG9jIGhhcyBubyBjb3N0IGZvciB0aGUgc2l4dGggU291bCB5ZXRcbn07XG5cbmV4cG9ydCBjb25zdCBNQVhfU1RBUiA9IDM7XG5leHBvcnQgY29uc3QgR1JJRF9DRUxMUyA9IDEyOyAvLyA0IHggM1xuXG4vKiogRG9taW5pb24gY2FwIHBlciB3YXZlIChpbmRleCAwID0gd2F2ZSAxKS4gKi9cbmV4cG9ydCBjb25zdCBDVVJWRVM6IFJlY29yZDxzdHJpbmcsIG51bWJlcltdPiA9IHtcbiAgLy8gTE9DS0VEIChjb25maXJtZWQpOiArNCBmb3Igd2F2ZXMgMi01LCB0aGVuICszIGZvciB3YXZlcyA2LTEwIC0+IDQwXG4gIGRvYzogWzksIDEzLCAxNywgMjEsIDI1LCAyOCwgMzEsIDM0LCAzNywgNDBdLFxuICAvLyBOT1QgVVNFRDogbWlzcmVtZW1iZXJlZCB2YXJpYW50ICgrMyB0aHJvdWdoIHdhdmUgNiwgdGhlbiArMikgdGhhdCBvbmx5IHJlYWNoZXMgMzIuIEtlcHQgZm9yIGNvbXBhcmlzb24gb25seS5cbiAgcmVjYWxsZWQ6IFs5LCAxMiwgMTUsIDE4LCAyMSwgMjQsIDI2LCAyOCwgMzAsIDMyXSxcbn07XG5cbmV4cG9ydCBjb25zdCBIRUFSVFMgPSAzO1xuZXhwb3J0IGNvbnN0IFNUQVJUX0hBTkQgPSA0O1xuZXhwb3J0IGNvbnN0IFdBVkVTID0gMTA7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnVsZXMge1xuICAvKiogRG9taW5pb24gY2FwIHBlciB3YXZlLiAqL1xuICBjdXJ2ZTogbnVtYmVyW107XG4gIC8qKlxuICAgKiAnZGVwbG95ZWRPbmx5Jzogb25seSB0d28gZGVwbG95ZWQgdW5pdHMgb2YgdGhlIHNhbWUgc3RhciBjYW4gbWVyZ2UgKGRvYyBhcyB3cml0dGVuKS5cbiAgICogJ2hhbmRJbnRvT25lU3Rhcic6IGFkZGl0aW9uYWxseSBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIGJlIHBsYXllZCBvbnRvIGEgZGVwbG95ZWRcbiAgICogMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bCB0byBtZXJnZSBpbW1lZGlhdGVseSAocGF5cyBvbmx5IHRoZSBjb3N0IGRpZmZlcmVuY2UpLlxuICAgKi9cbiAgbWVyZ2U6ICdkZXBsb3llZE9ubHknIHwgJ2hhbmRJbnRvT25lU3Rhcic7XG4gIC8qKiBDYXJkLWluZmxvdyBrbm9icyAoYWxsIG9wdGlvbmFsOyBkZWZhdWx0cyByZXByb2R1Y2UgdGhlIGRvYykuICovXG4gIHN0YXJ0SGFuZD86IG51bWJlcjsgICAgICAgICAgICAvLyBkZWZhdWx0IDRcbiAgZHJhZnRQaWNrcz86IG51bWJlcjsgICAgICAgICAgIC8vIGNhcmRzIGtlcHQgZnJvbSB0aGUgMy1jYXJkIFZpY3RvcnkgRHJhZnQsIGRlZmF1bHQgMVxuICBub3JtYWxEcmF3V2F2ZXM/OiBudW1iZXJbXTsgICAgLy8gd2F2ZXMgKGJlaW5nIGVudGVyZWQpIHRoYXQgYWxzbyBnaXZlIHRoZSBub3JtYWwgcmFuZG9tIGRyYXc7IGRlZmF1bHQgPSBhbGxcbiAgLyoqIFNvdWxzIHRoaXMgcnVuIG1heSBkcmF3IGZyb20gKHRoZSBlcXVpcHBlZCBTb3VsIERlY2ssIG1heCA2KS4gRGVmYXVsdDogZXZlcnkgU291bC4gKi9cbiAgcG9vbD86IFNvdWxJZFtdO1xuICBzdGFnZVdhdmVzPzogbnVtYmVyOyAgICAgICAgICAgLy8gd2F2ZXMgaW4gdGhpcyBzdGFnZTsgZGVmYXVsdCAxMCAodGhlIHBsYXlhYmxlIHByb3RvdHlwZSB1c2VzIDMpXG59XG5cbmV4cG9ydCBjb25zdCBHUklEX0NPTFMgPSA0LCBHUklEX1JPV1MgPSAzOyAgIC8vIDQgeCAzID0gR1JJRF9DRUxMUzsgY29sdW1uIEdSSURfQ09MUy0xIGlzIHRoZSBmcm9udCBsaW5lXG4iLCAiLy8gU21hbGwgc2VlZGVkIFJORyAobXVsYmVycnkzMikuIFNhbWUgc2VlZCAtPiBzYW1lIHJ1biwgc28gYW55IGJ1ZyByZXBvcnQgaXMgcmVwcm9kdWNpYmxlLlxuLy8gYHN0YXRlKClgIC8gdGhlIGByZXN1bWVgIGFyZ3VtZW50IGxldCBhIHNhdmVkIHJ1biBjb250aW51ZSBkcmF3aW5nIGV4YWN0bHkgdGhlIGNhcmRzIGl0IHdvdWxkIGhhdmUgZHJhd24uXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgbmV4dCgpOiBudW1iZXI7ICAgICAgICAgICAgICAvLyBbMCwgMSlcbiAgaW50KG46IG51bWJlcik6IG51bWJlcjsgICAgICAvLyBbMCwgbilcbiAgcGljazxUPihpdGVtczogcmVhZG9ubHkgVFtdKTogVDtcbiAgc2VlZDogbnVtYmVyO1xuICBzdGF0ZSgpOiBudW1iZXI7ICAgICAgICAgICAgIC8vIHRoZSBnZW5lcmF0b3IncyBjdXJyZW50IHBvc2l0aW9uLCBmb3Igc2F2aW5nIGEgcnVuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYWtlUm5nKHNlZWQ6IG51bWJlciwgcmVzdW1lPzogbnVtYmVyKTogUm5nIHtcbiAgbGV0IGEgPSAocmVzdW1lID8/IHNlZWQpID4+PiAwO1xuICBjb25zdCBuZXh0ID0gKCkgPT4ge1xuICAgIGEgPSAoYSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gYTtcbiAgICB0ID0gTWF0aC5pbXVsKHQgXiAodCA+Pj4gMTUpLCB0IHwgMSk7XG4gICAgdCBePSB0ICsgTWF0aC5pbXVsKHQgXiAodCA+Pj4gNyksIHQgfCA2MSk7XG4gICAgcmV0dXJuICgodCBeICh0ID4+PiAxNCkpID4+PiAwKSAvIDQyOTQ5NjcyOTY7XG4gIH07XG4gIHJldHVybiB7XG4gICAgc2VlZCxcbiAgICBuZXh0LFxuICAgIGludDogKG4pID0+IE1hdGguZmxvb3IobmV4dCgpICogbiksXG4gICAgcGljazogKGl0ZW1zKSA9PiBpdGVtc1tNYXRoLmZsb29yKG5leHQoKSAqIGl0ZW1zLmxlbmd0aCldLFxuICAgIHN0YXRlOiAoKSA9PiBhLFxuICB9O1xufVxuIiwgIi8vIFB1cmUgZ2FtZSBydWxlcyBmb3Igb25lIHN0YWdlLiBObyBncmFwaGljcywgbm8gY29tYmF0OiBqdXN0IGNhcmRzLCBEb21pbmlvbiwgZ3JpZCwgbWVyZ2UsIHdhdmVzLCBoZWFydHMuXG4vLyBFdmVyeSBtdXRhdGlvbiBnb2VzIHRocm91Z2ggYSBmdW5jdGlvbiBoZXJlIGFuZCBhcHBlbmRzIHRvIHN0YXRlLmxvZywgc28gcnVucyBjYW4gYmUgcmVwbGF5ZWQgYW5kIGluc3BlY3RlZC5cblxuaW1wb3J0IHsgQ09TVCwgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMsIFNUQVJUX0hBTkQsIFdBVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMsIFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdCB7IGlkOiBudW1iZXI7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7IGZyZXNoPzogYm9vbGVhbiB9ICAgLy8gZnJlc2ggPSBzdW1tb25lZCB0aGlzIGJ1aWxkIHBoYXNlXG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdGUge1xuICBydWxlczogUnVsZXM7XG4gIHJuZzogUm5nO1xuICB3YXZlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAvLyAxLWJhc2VkXG4gIGhlYXJ0czogbnVtYmVyO1xuICBjYXA6IG51bWJlcjtcbiAgaGFuZDogU291bElkW107XG4gIHVuaXRzOiBVbml0W107XG4gIG5leHRJZDogbnVtYmVyO1xuICBkaXNjYXJkVXNlZDogYm9vbGVhbjsgICAgICAgICAvLyBvbmNlLXBlci1idWlsZC1waGFzZSByZWRyYXdcbiAgc3RhdHVzOiAnYnVpbGRpbmcnIHwgJ3dvbicgfCAnbG9zdCc7XG4gIGxvZzogc3RyaW5nW107XG4gIHN0YXRzOiB7IGRyYXduOiBudW1iZXI7IGRpc2NhcmRlZDogbnVtYmVyOyBkaXNtaXNzZWQ6IG51bWJlcjsgbWVyZ2VzOiBudW1iZXI7IGZhaWx1cmVzOiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGNvc3QgPSAoc291bDogU291bElkLCBzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG5leHBvcnQgY29uc3QgY2FyZHNJbiA9IChzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gMiAqKiAoc3RhciAtIDEpOyAgICAgLy8gY2FyZHMgYSB1bml0IGlzIFwid29ydGhcIlxuZXhwb3J0IGNvbnN0IGRvbWluaW9uVXNlZCA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNvc3QodS5zb3VsLCB1LnN0YXIpLCAwKTtcbmV4cG9ydCBjb25zdCBkb21pbmlvbkZyZWUgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5jYXAgLSBkb21pbmlvblVzZWQocyk7XG5cbmZ1bmN0aW9uIGxvZyhzOiBTdGF0ZSwgbXNnOiBzdHJpbmcpIHsgcy5sb2cucHVzaChgW3cke3Mud2F2ZX1dICR7bXNnfWApOyB9XG4vKiogVGhlIFNvdWxzIHRoaXMgcnVuIGRyYXdzIGZyb206IHRoZSBlcXVpcHBlZCBkZWNrLCBvciBldmVyeXRoaW5nIGlmIG5vIGRlY2sgd2FzIGdpdmVuLiAqL1xuZXhwb3J0IGNvbnN0IHBvb2xPZiA9IChzOiBTdGF0ZSk6IFNvdWxJZFtdID0+IChzLnJ1bGVzLnBvb2wgJiYgcy5ydWxlcy5wb29sLmxlbmd0aCA/IHMucnVsZXMucG9vbCA6IFNPVUxTKTtcbmZ1bmN0aW9uIGRyYXcoczogU3RhdGUsIHdoeTogc3RyaW5nLCBub3Q/OiBTb3VsSWQpOiBTb3VsSWQge1xuICBjb25zdCBhbGwgPSBwb29sT2YocyksIG90aGVycyA9IG5vdCA/IGFsbC5maWx0ZXIoKHgpID0+IHggIT09IG5vdCkgOiBhbGw7XG4gIGNvbnN0IHBvb2wgPSBvdGhlcnMubGVuZ3RoID8gb3RoZXJzIDogYWxsOyAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBzd2FwIG5ldmVyIGhhbmRzIHlvdSBiYWNrIHRoZSBTb3VsIHlvdSBnYXZlIHVwICh1bmxlc3MgaXQgaXMgdGhlIG9ubHkgb25lIGVxdWlwcGVkKVxuICBjb25zdCBjID0gcy5ybmcucGljayhwb29sKTtcbiAgcy5oYW5kLnB1c2goYyk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmF3ICR7Y30gKCR7d2h5fSlgKTtcbiAgcmV0dXJuIGM7XG59XG5cbi8qKiBBIG5ldyBidWlsZCBwaGFzZSBiZWdpbnM6IHRoZSBvbmNlLXBlci1waGFzZSBzd2FwIGNvbWVzIGJhY2sgYW5kIG5vdGhpbmcgY291bnRzIGFzIFwic3VtbW9uZWQgdGhpcyByb3VuZFwiLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5ld1BoYXNlKHM6IFN0YXRlKTogdm9pZCB7XG4gIHMuZGlzY2FyZFVzZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIHUuZnJlc2ggPSBmYWxzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld1N0YWdlKHJ1bGVzOiBSdWxlcywgc2VlZDogbnVtYmVyKTogU3RhdGUge1xuICBjb25zdCBzOiBTdGF0ZSA9IHtcbiAgICBydWxlcywgcm5nOiBtYWtlUm5nKHNlZWQpLCB3YXZlOiAxLCBoZWFydHM6IEhFQVJUUywgY2FwOiBydWxlcy5jdXJ2ZVswXSwgaGFuZDogW10sIHVuaXRzOiBbXSwgbmV4dElkOiAxLFxuICAgIGRpc2NhcmRVc2VkOiBmYWxzZSwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IFtdLFxuICAgIHN0YXRzOiB7IGRyYXduOiAwLCBkaXNjYXJkZWQ6IDAsIGRpc21pc3NlZDogMCwgbWVyZ2VzOiAwLCBmYWlsdXJlczogMCB9LFxuICB9O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IChydWxlcy5zdGFydEhhbmQgPz8gU1RBUlRfSEFORCk7IGkrKykgZHJhdyhzLCAnc3RhcnRpbmcgaGFuZCcpO1xuICByZXR1cm4gcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZWVDZWxsKHM6IFN0YXRlKTogbnVtYmVyIHtcbiAgY29uc3QgdGFrZW4gPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmICghdGFrZW4uaGFzKGMpKSByZXR1cm4gYztcbiAgcmV0dXJuIC0xO1xufVxuXG4vLyAtLS0tIGJ1aWxkLXBoYXNlIGFjdGlvbnMgKGVhY2ggcmV0dXJucyB0cnVlIHdoZW4gaXQgaGFwcGVuZWQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XTtcbiAgcmV0dXJuIHNvdWwgIT09IHVuZGVmaW5lZCAmJiBmcmVlQ2VsbChzKSA+PSAwICYmIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2VsbEZyZWUoczogU3RhdGUsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICByZXR1cm4gY2VsbCA+PSAwICYmIGNlbGwgPCBHUklEX0NFTExTICYmICFzLnVuaXRzLnNvbWUoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7XG59XG5cbi8qKiBTdW1tb24gYSBoYW5kIGNhcmQgb250byBhIHNwZWNpZmljIGZyZWUgY2VsbCAoZGVmYXVsdDogdGhlIGZpcnN0IGZyZWUgb25lKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgY2VsbD86IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN1bW1vbihzLCBoYW5kSWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoY2VsbCAhPT0gdW5kZWZpbmVkICYmICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdTogVW5pdCA9IHsgaWQ6IHMubmV4dElkKyssIHNvdWwsIHN0YXI6IDEsIGNlbGw6IGNlbGwgPz8gZnJlZUNlbGwocyksIGZyZXNoOiB0cnVlIH07XG4gIHMudW5pdHMucHVzaCh1KTtcbiAgbG9nKHMsIGBzdW1tb24gJHtzb3VsfSAxKiAtPiBjZWxsICR7dS5jZWxsfSAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZURlcGxveWVkKGE6IFVuaXQsIGI6IFVuaXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuaWQgIT09IGIuaWQgJiYgYS5zb3VsID09PSBiLnNvdWwgJiYgYS5zdGFyID09PSBiLnN0YXIgJiYgYS5zdGFyIDwgTUFYX1NUQVI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZURlcGxveWVkKHM6IFN0YXRlLCBhSWQ6IG51bWJlciwgYklkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYUlkKSwgYiA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYklkKTtcbiAgaWYgKCFhIHx8ICFiIHx8ICFjYW5NZXJnZURlcGxveWVkKGEsIGIpKSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigodSkgPT4gdS5pZCAhPT0gYi5pZCk7XG4gIGEuZnJlc2ggPSAhIShhLmZyZXNoIHx8IGIuZnJlc2gpO1xuICBhLnN0YXIrKztcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZSAke2Euc291bH0gJHthLnN0YXIgLSAxfSorJHthLnN0YXIgLSAxfSogLT4gJHthLnN0YXJ9KiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSwgY2VsbHMgJHtzLnVuaXRzLmxlbmd0aH0vJHtHUklEX0NFTExTfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiAnaGFuZEludG9PbmVTdGFyJyBydWxlOiBwbGF5IGEgMS1zdGFyIGNhcmQgb250byBhIGRlcGxveWVkIDEtc3RhciB1bml0IG9mIHRoZSBzYW1lIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5ydWxlcy5tZXJnZSAhPT0gJ2hhbmRJbnRvT25lU3RhcicpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XSwgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCFzb3VsIHx8ICF1IHx8IHUuc291bCAhPT0gc291bCB8fCB1LnN0YXIgIT09IDEpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIGNvc3Qoc291bCwgMikgLSBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5NZXJnZUZyb21IYW5kKHMsIGhhbmRJZHgsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICB1LnN0YXIgPSAyO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlLWZyb20taGFuZCAke3NvdWx9IC0+ICR7dS5zb3VsfSAyKiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkaXNtaXNzKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgZGlzbWlzcyAke3Uuc291bH0gJHt1LnN0YXJ9KiAocGVybWFuZW50bHkgcmVtb3ZlZClgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAxOiBkaXNjYXJkIGEgaGFuZCBjYXJkIGFuZCBkcmF3IGEgcmFuZG9tIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNjYXJkUmVkcmF3KHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMuZGlzY2FyZFVzZWQgfHwgaGFuZElkeCA8IDAgfHwgaGFuZElkeCA+PSBzLmhhbmQubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGMgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNjYXJkZWQrKztcbiAgbG9nKHMsIGBzd2FwOiBkaXNjYXJkICR7Y31gKTtcbiAgZHJhdyhzLCAnc3dhcCcsIGMpO1xuICByZXR1cm4gdHJ1ZTtcbn1cbmV4cG9ydCBjb25zdCBzd2FwRGlzY2FyZCA9IGRpc2NhcmRSZWRyYXc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5Td2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgcmV0dXJuICFzLmRpc2NhcmRVc2VkICYmICEhdSAmJiAhdS5mcmVzaDsgICAgICAgICAgLy8gY2FuJ3Qgc2VsbCBhIHVuaXQgeW91IHN1bW1vbmVkIHRoaXMgcm91bmRcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDI6IHNlbGwgYSBkZXBsb3llZCB1bml0IChub3Qgb25lIHN1bW1vbmVkIHRoaXMgcm91bmQpIGFuZCBkcmF3IGEgY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN3YXBTZWxsKHMsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBzd2FwOiBzZWxsICR7dS5zb3VsfSAke3Uuc3Rhcn0qYCk7XG4gIGRyYXcocywgJ3N3YXAnLCB1LnNvdWwpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1vdmVVbml0KHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlciwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSB8fCAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgbG9nKHMsIGBtb3ZlICR7dS5zb3VsfSBjZWxsICR7dS5jZWxsfSAtPiAke2NlbGx9YCk7IHUuY2VsbCA9IGNlbGw7IHJldHVybiB0cnVlO1xufVxuXG4vLyAtLS0tIHdhdmUgcmVzdWx0cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBEcmFmdCBjaG9pY2VzIGZvciBhZnRlciBhIGNsZWFyZWQgd2F2ZTogMyByYW5kb20gY2FyZHMsIGR1cGxpY2F0ZXMgYWxsb3dlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkcmFmdE9wdGlvbnMoczogU3RhdGUpOiBTb3VsSWRbXSB7XG4gIGNvbnN0IHAgPSBwb29sT2Yocyk7XG4gIHJldHVybiBbcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKV07XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQ6IHJhaXNlIHRoZSBjYXAsIHJlc29sdmUgdGhlIFZpY3RvcnkgRHJhZnQsIGRyYXcgMSBub3JtYWwgY2FyZC4gKi9cbmV4cG9ydCBjb25zdCBzdGFnZVdhdmVzID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMucnVsZXMuc3RhZ2VXYXZlcyA/PyBXQVZFUztcblxuLyoqIFN0ZXAgMSBvZiBhIGNsZWFyZWQgd2F2ZTogaXMgdGhlIHN0YWdlIG92ZXI/IElmIG5vdCwgcmFpc2UgdGhlIGNhcCBhbmQgc3RhcnQgdGhlIG5leHQgYnVpbGQgcGhhc2UuIFJldHVybnMgdHJ1ZSB3aGVuIHRoZSBzdGFnZSBpcyB3b24uICovXG5leHBvcnQgZnVuY3Rpb24gYWR2YW5jZVdhdmUoczogU3RhdGUpOiBib29sZWFuIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gcy5zdGF0dXMgPT09ICd3b24nO1xuICBpZiAocy53YXZlID49IHN0YWdlV2F2ZXMocykpIHsgcy5zdGF0dXMgPSAnd29uJzsgbG9nKHMsICdzdGFnZSBjbGVhcmVkJyk7IHJldHVybiB0cnVlOyB9XG4gIHMud2F2ZSsrO1xuICBzLmNhcCA9IHMucnVsZXMuY3VydmVbcy53YXZlIC0gMV07XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYHdhdmUgY2xlYXJlZCAtPiBjYXAgJHtzLmNhcH1gKTtcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU3RlcCAyOiB0aGUgcGxheWVyIGtlcHQgYGlkeGAgZnJvbSB0aGUgb2ZmZXJlZCBkcmFmdCBjYXJkcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0YWtlRHJhZnQoczogU3RhdGUsIG9wdHM6IFNvdWxJZFtdLCBpZHg6IG51bWJlcik6IHZvaWQge1xuICBjb25zdCBwaWNrID0gb3B0c1tNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGlkeCkpXTtcbiAgcy5oYW5kLnB1c2gocGljayk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmFmdCBbJHtvcHRzLmpvaW4oJywgJyl9XSAtPiB0b29rICR7cGlja31gKTtcbn1cblxuLyoqIFN0ZXAgMzogdGhlIGJvbnVzIG5vcm1hbCBkcmF3IChvbmx5IG9uIHRoZSB3YXZlcyB0aGUgcnVsZXMgYWxsb3cpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbERyYXcoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMucnVsZXMubm9ybWFsRHJhd1dhdmVzID8gcy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMuaW5jbHVkZXMocy53YXZlKSA6IHRydWUpIGRyYXcocywgJ3dhdmUgY2xlYXInKTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZCAoYWxsIHRocmVlIHN0ZXBzIGluIG9uZSBjYWxsLCBmb3Igc2ltdWxhdGlvbnMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyV2F2ZShzOiBTdGF0ZSwgY2hvb3NlOiAob3B0czogU291bElkW10pID0+IG51bWJlcik6IHZvaWQge1xuICBpZiAoYWR2YW5jZVdhdmUocykpIHJldHVybjtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIGxldCBvcHRzID0gZHJhZnRPcHRpb25zKHMpO1xuICBjb25zdCBvZmZlcmVkID0gb3B0cy5qb2luKCcsICcpO1xuICBjb25zdCB0b29rOiBTb3VsSWRbXSA9IFtdO1xuICBmb3IgKGxldCBwID0gMDsgcCA8IChzLnJ1bGVzLmRyYWZ0UGlja3MgPz8gMSk7IHArKykge1xuICAgIGNvbnN0IGlkeCA9IE1hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgY2hvb3NlKG9wdHMpKSk7XG4gICAgdG9vay5wdXNoKG9wdHNbaWR4XSk7IHMuaGFuZC5wdXNoKG9wdHNbaWR4XSk7IHMuc3RhdHMuZHJhd24rKztcbiAgICBvcHRzID0gb3B0cy5maWx0ZXIoKF8sIGkpID0+IGkgIT09IGlkeCk7XG4gIH1cbiAgbG9nKHMsIGBkcmFmdCBbJHtvZmZlcmVkfV0gLT4gdG9vayAke3Rvb2suam9pbignLCAnKX1gKTtcbiAgbm9ybWFsRHJhdyhzKTtcbn1cblxuLyoqIEFybXkgd2lwZWQ6IGxvc2UgYSBoZWFydCwgY2FwIGRvZXMgTk9UIHJpc2UsIGVuZW1pZXMgcmVzZXQsICsxIGNhcmQsIHJlZHJhdyBhbGxvd2VkIGFnYWluLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZhaWxXYXZlKHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBzLmhlYXJ0cy0tOyBzLnN0YXRzLmZhaWx1cmVzKys7XG4gIGlmIChzLmhlYXJ0cyA8PSAwKSB7IHMuc3RhdHVzID0gJ2xvc3QnOyBsb2cocywgJ25vIGhlYXJ0cyBsZWZ0OiBzdGFnZSBsb3N0Jyk7IHJldHVybjsgfVxuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGBhcm15IHdpcGVkOiBoZWFydHMgJHtzLmhlYXJ0c30sIGNhcCBzdGF5cyAke3MuY2FwfWApO1xuICBkcmF3KHMsICdmYWlsZWQgYXR0ZW1wdCcpO1xufVxuXG4vLyAtLS0tIGludmFyaWFudHMgKGNhbGxlZCBieSB0aGUgc2ltdWxhdG9yIGFmdGVyIGV2ZXJ5IHdhdmU7IHRocm93IHdpdGggYSByZWFkYWJsZSBtZXNzYWdlKSAtLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjaGVja0ludmFyaWFudHMoczogU3RhdGUpOiB2b2lkIHtcbiAgY29uc3QgZmFpbCA9IChtOiBzdHJpbmcpID0+IHsgdGhyb3cgbmV3IEVycm9yKGBJTlZBUklBTlQgJHttfVxcbmAgKyBzLmxvZy5zbGljZSgtMTIpLmpvaW4oJ1xcbicpKTsgfTtcbiAgaWYgKHMudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgZmFpbChgbW9yZSB1bml0cyAoJHtzLnVuaXRzLmxlbmd0aH0pIHRoYW4gY2VsbHNgKTtcbiAgY29uc3QgY2VsbHMgPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgaWYgKGNlbGxzLnNpemUgIT09IHMudW5pdHMubGVuZ3RoKSBmYWlsKCd0d28gdW5pdHMgc2hhcmUgYSBjZWxsJyk7XG4gIGlmIChkb21pbmlvblVzZWQocykgPiBzLmNhcCkgZmFpbChgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9IGV4Y2VlZHMgY2FwICR7cy5jYXB9YCk7XG4gIGZvciAoY29uc3QgdSBvZiBzLnVuaXRzKSBpZiAodS5zdGFyIDwgMSB8fCB1LnN0YXIgPiBNQVhfU1RBUikgZmFpbChgdW5pdCBzdGFyICR7dS5zdGFyfSBvdXQgb2YgcmFuZ2VgKTtcbiAgLy8gZXZlcnkgZHJhd24gY2FyZCBpcyBlaXRoZXIgaW4gaGFuZCwgd29ydGggY2FyZHMgb24gdGhlIGZpZWxkLCBkaXNjYXJkZWQsIG9yIGRpc21pc3NlZFxuICBjb25zdCBvbkZpZWxkID0gcy51bml0cy5yZWR1Y2UoKG4sIHUpID0+IG4gKyBjYXJkc0luKHUuc3RhciksIDApO1xuICBjb25zdCBhY2NvdW50ZWQgPSBzLmhhbmQubGVuZ3RoICsgb25GaWVsZCArIHMuc3RhdHMuZGlzY2FyZGVkICsgcy5zdGF0cy5kaXNtaXNzZWQ7XG4gIGlmIChhY2NvdW50ZWQgIT09IHMuc3RhdHMuZHJhd24pIGZhaWwoYGNhcmQgY29uc2VydmF0aW9uOiBkcmF3biAke3Muc3RhdHMuZHJhd259ICE9IGFjY291bnRlZCAke2FjY291bnRlZH1gKTtcbn1cbiIsICIvLyBUaGUgYmF0dGxlZmllbGQncyBsb29rOiBhIHRpbGVkIGNyeXB0IGZsb29yLCBhIGdsb3dpbmcgcnVuZSBjaXJjbGUgaW4gdGhlIG1pZGRsZSwgYW5kIGEgZGFyayBtaXN0eSBzdXJyb3VuZC4gUHVyZSBkZWNvcmF0aW9uIChubyBnYW1lIHJ1bGVzKS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuXG5jb25zdCBUSUxFX01FVFJFUyA9IDU7ICAgIC8vIG9uZSByZXBlYXQgb2YgdGhlIGZsb29yIHBpY3R1cmUgY292ZXJzIHRoaXMgbWFueSBtZXRyZXMsIHNvIHNsYWJzIGNvbWUgb3V0IGFib3V0IGEgbWV0cmUgd2lkZVxuXG4vKiogRHJhdyB0aGUgcnVuZSBjaXJjbGUgb25jZSBvbnRvIGEgY2FudmFzOyBpdCBiZWNvbWVzIGEgc2VlLXRocm91Z2ggZGVjYWwgb24gdGhlIGZsb29yLiAqL1xuZnVuY3Rpb24gcnVuZVRleHR1cmUoc2NlbmU6IGFueSk6IGFueSB7XG4gIGNvbnN0IFMgPSA1MTIsIHRleCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdydW5lcycsIHsgd2lkdGg6IFMsIGhlaWdodDogUyB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0ZXguZ2V0Q29udGV4dCgpO1xuICBjLmNsZWFyUmVjdCgwLCAwLCBTLCBTKTsgYy50cmFuc2xhdGUoUyAvIDIsIFMgLyAyKTsgYy5saW5lQ2FwID0gJ3JvdW5kJzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7XG4gIGNvbnN0IHJpbmcgPSAocjogbnVtYmVyLCB3OiBudW1iZXIsIGE6IG51bWJlcikgPT4geyBjLmJlZ2luUGF0aCgpOyBjLmFyYygwLCAwLCByLCAwLCBNYXRoLlBJICogMik7IGMubGluZVdpZHRoID0gdzsgYy5zdHJva2VTdHlsZSA9IGByZ2JhKDQ3LDIxNywxNjYsJHthfSlgOyBjLnN0cm9rZSgpOyB9O1xuICBjLnNoYWRvd0NvbG9yID0gJ3JnYmEoNDcsMjE3LDE2NiwwLjkpJzsgYy5zaGFkb3dCbHVyID0gMTA7XG4gIHJpbmcoMjM2LCA0LCAwLjc1KTsgcmluZygyMTQsIDIsIDAuNSk7IHJpbmcoMTIwLCAzLCAwLjcpO1xuICBjLnN0cm9rZVN0eWxlID0gJ3JnYmEoNDcsMjE3LDE2NiwwLjcpJzsgYy5saW5lV2lkdGggPSAzO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ7IGkrKykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZm91ciBsb25nIHNwaWtlcywgbGlrZSBhIGNvbXBhc3NcbiAgICBjLnNhdmUoKTsgYy5yb3RhdGUoKGkgKiBNYXRoLlBJKSAvIDIgKyBNYXRoLlBJIC8gNCk7IGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKDAsIC0zMCk7IGMubGluZVRvKDAsIC0yMzApOyBjLnN0cm9rZSgpO1xuICAgIGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKC0xNCwgLTEyMCk7IGMubGluZVRvKDAsIC0xNjApOyBjLmxpbmVUbygxNCwgLTEyMCk7IGMuc3Ryb2tlKCk7IGMucmVzdG9yZSgpO1xuICB9XG4gIGMubGluZVdpZHRoID0gMjsgYy5zdHJva2VTdHlsZSA9ICdyZ2JhKDQ3LDIxNywxNjYsMC41NSknO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDEyOyBpKyspIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc21hbGwgdGljayBtYXJrcyBiZXR3ZWVuIHRoZSB0d28gb3V0ZXIgcmluZ3NcbiAgICBjLnNhdmUoKTsgYy5yb3RhdGUoKGkgKiBNYXRoLlBJKSAvIDYpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMjE0KTsgYy5saW5lVG8oMCwgLTIzNik7IGMuc3Ryb2tlKCk7IGMucmVzdG9yZSgpO1xuICB9XG4gIHRleC51cGRhdGUoKTsgdGV4Lmhhc0FscGhhID0gdHJ1ZTsgcmV0dXJuIHRleDtcbn1cblxuaW50ZXJmYWNlIFBsYWNlbWVudCB7IHByb3A6IHN0cmluZzsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHlhdz86IG51bWJlcjsgcz86IG51bWJlciB9XG4vKiogV2hlcmUgdGhlIHByb3BzIHN0YW5kLiBUYWxsIHRoaW5ncyBnbyBiZWhpbmQgYW5kIGJlc2lkZSB0aGUgZmllbGQ7IG9ubHkgbG93IHRoaW5ncyAoZmVuY2UsIGJvbmVzLCB3YWxsKSBzdGFuZCBiZXR3ZWVuIHRoZSBjYW1lcmEgYW5kIHRoZSB1bml0cy4gKi9cbmNvbnN0IENSWVBUX0xBWU9VVDogUGxhY2VtZW50W10gPSBbXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtNi41LCB6OiA2LjQgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDAsIHo6IDYuOSwgczogMS4xNSB9LCB7IHByb3A6ICdhcmNoJywgeDogNi41LCB6OiA2LjQgfSxcbiAgeyBwcm9wOiAncGlsbGFyJywgeDogLTEwLjIsIHo6IDUuNiwgeWF3OiAwLjQgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogLTMuMiwgejogNS45LCB5YXc6IDIuMSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAzLjMsIHo6IDUuOCwgeWF3OiA0LjAgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTAuMiwgejogNS42LCB5YXc6IDEuMiB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTQuNiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiA0LjYsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogLTEwLjUsIHo6IDAuOCB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogMTAuNSwgejogMC44IH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtOC42LCB6OiA2LjAsIHlhdzogMC4xIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiA4LjYsIHo6IDYuMCwgeWF3OiAtMC4xIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTEuNCwgejogLTIuNiwgeWF3OiAxLjQgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDExLjQsIHo6IC0yLjYsIHlhdzogMS43IH0sXG4gIHsgcHJvcDogJ2ZlbmNlJywgeDogLTguMCwgejogLTQuNiB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC02LjcsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA2LjcsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA4LjAsIHo6IC00LjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiAtMy41LCB6OiAtNC40LCB5YXc6IDAuNywgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogNC4yLCB6OiAtNC42LCB5YXc6IDIuNSwgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogOS40LCB6OiAzLjIsIHlhdzogMS4wLCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAtOS42LCB6OiAtMy40LCB5YXc6IDMuNiwgczogMC42IH0sXG5dO1xuY29uc3QgR1JBVkVZQVJEX0xBWU9VVDogUGxhY2VtZW50W10gPSBbICAgICAgLy8gZmV3ZXIgYXJjaGVzLCBhIGJyb2tlbiByb3cgb2YgZ3JhdmVzdG9uZSBwaWxsYXJzLCBib25lcyBldmVyeXdoZXJlXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtOS41LCB6OiA2LjQgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDkuNSwgejogNi40IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMSwgejogNS4yLCB5YXc6IDAuNCwgczogMC45IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC03LjYsIHo6IDYuMywgeWF3OiAyLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogLTQuNCwgejogNS42LCB5YXc6IDQuMCwgczogMC44IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xLjIsIHo6IDYuNSwgeWF3OiAxLjIgfSxcbiAgeyBwcm9wOiAncGlsbGFyJywgeDogMi4yLCB6OiA1LjcsIHlhdzogMy4xLCBzOiAwLjkgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogNS41LCB6OiA2LjQsIHlhdzogNS4wIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDguMiwgejogNS41LCB5YXc6IDAuOSwgczogMC44NSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAxMSwgejogNS4wLCB5YXc6IDIuNiB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTExLCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDExLCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDAuNiwgejogNS4wLCBzOiAwLjkgfSxcbiAgeyBwcm9wOiAnd2FsbCcsIHg6IC01LjYsIHo6IDYuNiwgeWF3OiAwLjIgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDMuOCwgejogNi43LCB5YXc6IC0wLjIgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0xMS42LCB6OiAtMi40LCB5YXc6IDEuNSB9LFxuICB7IHByb3A6ICdmZW5jZScsIHg6IC00LjIsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA0LjQsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAxMS4yLCB6OiAtMi4yLCB5YXc6IDEuNiB9LFxuICB7IHByb3A6ICdib25lcycsIHg6IC01LjUsIHo6IDQuNiwgeWF3OiAwLjcsIHM6IDAuNiB9LCB7IHByb3A6ICdib25lcycsIHg6IDMuMiwgejogNC40LCB5YXc6IDIuNSwgczogMC43IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogOC4yLCB6OiAzLjIsIHlhdzogMS4wLCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAtOS4yLCB6OiAzLjQsIHlhdzogMy42LCBzOiAwLjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiA3LCB6OiAtNC41LCB5YXc6IDAuMywgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTcuNCwgejogLTQuMywgeWF3OiA0LjEsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDAuMiwgejogLTQuOCwgeWF3OiA1LjIsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDEwLjIsIHo6IC0wLjYsIHlhdzogMi4wLCBzOiAwLjYgfSxcbl07XG5jb25zdCBCQVNUSU9OX0xBWU9VVDogUGxhY2VtZW50W10gPSBbICAgICAgICAvLyBhIGZvcnRyZXNzOiBnYXRlcyBiZXR3ZWVuIGxvbmcgd2FsbHMsIGJyYXppZXJzIGFsb25nIHRoZSBiYXR0bGVtZW50cywgZmVuY2VzIG9uIHRoZSBmbGFua3NcbiAgeyBwcm9wOiAnYXJjaCcsIHg6IC01LjgsIHo6IDYuNSwgczogMS4xIH0sIHsgcHJvcDogJ2FyY2gnLCB4OiAwLCB6OiA3LjAsIHM6IDEuMyB9LCB7IHByb3A6ICdhcmNoJywgeDogNS44LCB6OiA2LjUsIHM6IDEuMSB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTkuNCwgejogNi4wLCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0yLjksIHo6IDYuNCwgczogMS4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAyLjksIHo6IDYuNCwgczogMS4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiA5LjQsIHo6IDYuMCwgczogMS4zIH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTIuMiwgejogMi42LCB5YXc6IDEuNTcsIHM6IDEuMyB9LCB7IHByb3A6ICd3YWxsJywgeDogMTIuMiwgejogMi42LCB5YXc6IDEuNTcsIHM6IDEuMyB9LCB7IHByb3A6ICd3YWxsJywgeDogLTEyLjIsIHo6IC0xLjYsIHlhdzogMS41NyB9LCB7IHByb3A6ICd3YWxsJywgeDogMTIuMiwgejogLTEuNiwgeWF3OiAxLjU3IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMS4yLCB6OiA1LjYsIHlhdzogMC40LCBzOiAxLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTEuMiwgejogNS42LCB5YXc6IDEuMiwgczogMS4xIH0sXG4gIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtMy4yLCB6OiA1LjIgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDMuMiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtMTAuNiwgejogMS4wIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAxMC42LCB6OiAxLjAgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IC03LjIsIHo6IC00LjYsIHM6IDAuOSB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogNy4yLCB6OiAtNC42LCBzOiAwLjkgfSxcbiAgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNC42LCB6OiAtNC44IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogLTMuMywgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDMuMywgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDQuNiwgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC0xMS42LCB6OiAtMy40LCB5YXc6IDEuNSB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDExLjYsIHo6IC0zLjQsIHlhdzogMS41IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogLTEuNSwgejogLTQuNSwgeWF3OiAwLjcsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDkuNCwgejogMy4yLCB5YXc6IDEuMCwgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuNiwgejogLTMuMCwgeWF3OiAzLjYsIHM6IDAuNSB9LFxuXTtcblxudHlwZSBDMyA9IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcbmludGVyZmFjZSBUaGVtZSB7IGxheW91dDogUGxhY2VtZW50W107IGZsb29yOiBDMzsgZm9nOiBDMzsgbWlzdDogQzM7IHdhbGw6IEMzOyBmbGFtZUE6IEMzOyBmbGFtZUI6IEMzOyBydW5lOiBDMyB9XG4vKiogT25lIGxvb2sgcGVyIGNhbXBhaWduIHN0YWdlIChpZHMgbWF0Y2ggU1RBR0VTIGluIGNvcmUvd2F2ZXMudHMpLiBVbmtub3duIGlkcyB1c2UgdGhlIGNyeXB0IGxvb2suICovXG5jb25zdCBUSEVNRVM6IFJlY29yZDxzdHJpbmcsIFRoZW1lPiA9IHtcbiAgY3J5cHQ6IHsgbGF5b3V0OiBDUllQVF9MQVlPVVQsIGZsb29yOiBbMC42MiwgMC43LCAwLjddLCBmb2c6IFswLjAyLCAwLjA1LCAwLjA2XSwgbWlzdDogWzAuMiwgMC42LCAwLjU1XSwgd2FsbDogWzAuNzUsIDAuODUsIDAuOV0sIGZsYW1lQTogWzAuMzUsIDEsIDAuOF0sIGZsYW1lQjogWzAuMSwgMC44LCAwLjZdLCBydW5lOiBbMC4xOCwgMC44NSwgMC42NV0gfSxcbiAgZ3JhdmV5YXJkOiB7IGxheW91dDogR1JBVkVZQVJEX0xBWU9VVCwgZmxvb3I6IFswLjYyLCAwLjc0LCAwLjUyXSwgZm9nOiBbMC4wMywgMC4wNSwgMC4wMjVdLCBtaXN0OiBbMC40MiwgMC42LCAwLjIyXSwgd2FsbDogWzAuNywgMC44NSwgMC42Ml0sIGZsYW1lQTogWzAuNzUsIDEsIDAuNF0sIGZsYW1lQjogWzAuNCwgMC44LCAwLjJdLCBydW5lOiBbMC41LCAwLjgsIDAuMjVdIH0sXG4gIGVuZGxlc3M6IHsgbGF5b3V0OiBDUllQVF9MQVlPVVQsIGZsb29yOiBbMC43OCwgMC42MiwgMC42OF0sIGZvZzogWzAuMDYsIDAuMDIsIDAuMDM1XSwgbWlzdDogWzAuNzUsIDAuMywgMC40XSwgd2FsbDogWzAuOTIsIDAuNjgsIDAuNzhdLCBmbGFtZUE6IFsxLCAwLjYyLCAwLjNdLCBmbGFtZUI6IFswLjksIDAuMjUsIDAuMTVdLCBydW5lOiBbMC45LCAwLjM1LCAwLjNdIH0sXG4gIGJhc3Rpb246IHsgbGF5b3V0OiBCQVNUSU9OX0xBWU9VVCwgZmxvb3I6IFswLjYsIDAuNjIsIDAuOV0sIGZvZzogWzAuMDMsIDAuMDMsIDAuMDhdLCBtaXN0OiBbMC40LCAwLjQsIDAuODVdLCB3YWxsOiBbMC43MiwgMC43MiwgMV0sIGZsYW1lQTogWzAuNiwgMC42NSwgMV0sIGZsYW1lQjogWzAuNCwgMC4zLCAwLjk1XSwgcnVuZTogWzAuNDUsIDAuNCwgMC45NV0gfSxcbn07XG5cblxuLyoqIEJ1aWxkIHRoZSB0ZWFsIHNvdWxmaXJlIG92ZXIgYSBicmF6aWVyOiBhIHNtYWxsIHNvZnQgZmxhbWUgdGhhdCBmbGlja2Vycy4gKi9cbmZ1bmN0aW9uIGZsYW1lKHNjZW5lOiBhbnksIHRleDogYW55LCB4OiBudW1iZXIsIHk6IG51bWJlciwgejogbnVtYmVyLCBrOiBudW1iZXIsIGE6IEMzLCBiOiBDMyk6IGFueSB7XG4gIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2ZpcmUnLCAxOCwgc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0ZXg7IHBzLmVtaXR0ZXIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKHgsIHksIHopO1xuICBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yMiAqIGssIDAsIC0wLjIyICogayk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMjIgKiBrLCAwLCAwLjIyICogayk7XG4gIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjEsIDEsIC0wLjEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjEsIDEuNCwgMC4xKTtcbiAgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMS4wOyBwcy5lbWl0UmF0ZSA9IDIwOyBwcy5taW5TaXplID0gMC4zNSAqIGs7IHBzLm1heFNpemUgPSAwLjcgKiBrOyBwcy5taW5FbWl0UG93ZXIgPSAwLjUgKiBrOyBwcy5tYXhFbWl0UG93ZXIgPSAxLjAgKiBrO1xuICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoYVswXSwgYVsxXSwgYVsyXSwgMC45KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KGJbMF0sIGJbMV0sIGJbMl0sIDAuOCk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNChiWzBdICogMC4xLCBiWzFdICogMC4zLCBiWzJdICogMC4zLCAwKTtcbiAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5zdGFydCgpOyByZXR1cm4gcHM7XG59XG5cbi8qKiBTb2Z0IHJvdW5kIGJsb2IgdXNlZCBmb3IgdGhlIGZsYW1lcy4gKi9cbmZ1bmN0aW9uIGdsb3dUZXh0dXJlKHNjZW5lOiBhbnkpOiBhbnkge1xuICBjb25zdCB0ID0gbmV3IEJBQllMT04uRHluYW1pY1RleHR1cmUoJ2dsb3cnLCB7IHdpZHRoOiA2NCwgaGVpZ2h0OiA2NCB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0LmdldENvbnRleHQoKSwgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTtcbiAgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwwLjQ1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICBjLmZpbGxTdHlsZSA9IGc7IGMuZmlsbFJlY3QoMCwgMCwgNjQsIDY0KTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IHRydWU7IHJldHVybiB0O1xufVxuXG4vKiogTG9hZCB0aGUgcHJvcCBraXQgb25jZTsgYXBwbHkodGhlbWUpIHRoZW4gc3RhbmRzIGNvcGllcyBvZiBlYWNoIHBpZWNlIGFyb3VuZCB0aGUgZmllbGQgKHRoZXkgc2hhcmUgb25lIG1lc2ggYW5kIG9uZSB0ZXh0dXJlLCBzbyB0aGV5IGNvc3QgYWxtb3N0IG5vdGhpbmcpLiAqL1xuYXN5bmMgZnVuY3Rpb24gbG9hZEtpdChzY2VuZTogYW55KTogUHJvbWlzZTx7IGFwcGx5KHQ6IFRoZW1lKTogdm9pZCB9PiB7XG4gIGNvbnN0IGJveCA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy9hcmVuYS8nLCAncHJvcHMuZ2xiJywgc2NlbmUpO1xuICBib3guYWRkQWxsVG9TY2VuZSgpO1xuICBjb25zdCByb290ID0gYm94Lm1lc2hlcy5maW5kKChtOiBhbnkpID0+IG0ubmFtZSA9PT0gJ19fcm9vdF9fJyksIHNyYzogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICBmb3IgKGNvbnN0IG0gb2YgYm94Lm1lc2hlcykgaWYgKG0ubmFtZSAhPT0gJ19fcm9vdF9fJyAmJiBtLmdldFRvdGFsVmVydGljZXMoKSA+IDApIHsgc3JjW20ubmFtZV0gPSBtOyBtLnNldEVuYWJsZWQoZmFsc2UpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICBjb25zdCBnbG93ID0gZ2xvd1RleHR1cmUoc2NlbmUpOyBsZXQgbWFkZTogeyBob2xkZXJzOiBhbnlbXTsgZmlyZXM6IGFueVtdIH0gPSB7IGhvbGRlcnM6IFtdLCBmaXJlczogW10gfSwgbiA9IDA7XG4gIHJldHVybiB7XG4gICAgYXBwbHkodDogVGhlbWUpIHtcbiAgICAgIGZvciAoY29uc3QgaCBvZiBtYWRlLmhvbGRlcnMpIGguZGlzcG9zZSgpOyBmb3IgKGNvbnN0IGYgb2YgbWFkZS5maXJlcykgZi5kaXNwb3NlKGZhbHNlKTsgICAvLyBmYWxzZToga2VlcCB0aGUgc2hhcmVkIGdsb3cgdGV4dHVyZSBtYWRlID0geyBob2xkZXJzOiBbXSwgZmlyZXM6IFtdIH07XG4gICAgICBmb3IgKGNvbnN0IHAgb2YgdC5sYXlvdXQpIHtcbiAgICAgICAgY29uc3QgYmFzZSA9IHNyY1twLnByb3BdOyBpZiAoIWJhc2UpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBpbnN0ID0gYmFzZS5jcmVhdGVJbnN0YW5jZShwLnByb3AgKyBuKyspOyBpbnN0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICAgICAgaW5zdC5yb3RhdGlvblF1YXRlcm5pb24gPSByb290LnJvdGF0aW9uUXVhdGVybmlvbj8uY2xvbmUoKSA/PyBudWxsOyBpZiAoIWluc3Qucm90YXRpb25RdWF0ZXJuaW9uKSBpbnN0LnJvdGF0aW9uID0gcm9vdC5yb3RhdGlvbi5jbG9uZSgpOyBpbnN0LnNjYWxpbmcgPSByb290LnNjYWxpbmcuY2xvbmUoKTtcbiAgICAgICAgY29uc3QgaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnaG9sZGVyJyArIG4sIHNjZW5lKTsgaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IGhvbGRlci5yb3RhdGlvbi55ID0gcC55YXcgPz8gMDsgaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHAucyA/PyAxKTtcbiAgICAgICAgaW5zdC5wYXJlbnQgPSBob2xkZXI7IG1hZGUuaG9sZGVycy5wdXNoKGhvbGRlcik7XG4gICAgICAgIGlmIChwLnByb3AgPT09ICdicmF6aWVyJykgbWFkZS5maXJlcy5wdXNoKGZsYW1lKHNjZW5lLCBnbG93LCBwLngsIDEuMjUgKiAocC5zID8/IDEpLCBwLnosIHAucyA/PyAxLCB0LmZsYW1lQSwgdC5mbGFtZUIpKTtcbiAgICAgIH1cbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRBcmVuYShzY2VuZTogYW55LCBncm91bmQ6IGFueSk6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHNldFRoZW1lKHN0YWdlOiBzdHJpbmcpOiB2b2lkIH0ge1xuICAvLyAtLS0tIGZsb29yXG4gIGNvbnN0IHRleCA9IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy9hcmVuYS9mbG9vci53ZWJwJywgc2NlbmUsIGZhbHNlLCB0cnVlLCBCQUJZTE9OLlRleHR1cmUuVFJJTElORUFSX1NBTVBMSU5HTU9ERSk7XG4gIHRleC51U2NhbGUgPSA2MCAvIFRJTEVfTUVUUkVTOyB0ZXgudlNjYWxlID0gNDAgLyBUSUxFX01FVFJFUzsgdGV4LmFuaXNvdHJvcGljRmlsdGVyaW5nTGV2ZWwgPSA0O1xuICBjb25zdCBnbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2dtJywgc2NlbmUpOyBnbS5kaWZmdXNlVGV4dHVyZSA9IHRleDsgZ20uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7XG4gIGdtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjYyLCAwLjcsIDAuNyk7IGdyb3VuZC5tYXRlcmlhbCA9IGdtO1xuXG4gIC8vIC0tLS0gcnVuZSBjaXJjbGUgaW4gdGhlIG1pZGRsZSBvZiB0aGUgZmllbGRcbiAgY29uc3QgZGVjYWwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgncnVuZXMnLCB7IHdpZHRoOiA1LjIsIGhlaWdodDogNS4yIH0sIHNjZW5lKTtcbiAgZGVjYWwucG9zaXRpb24ueSA9IDAuMDEyOyBkZWNhbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGNvbnN0IHJtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgncm0nLCBzY2VuZSk7IHJtLmRpZmZ1c2VUZXh0dXJlID0gcnVuZVRleHR1cmUoc2NlbmUpOyBybS5kaWZmdXNlVGV4dHVyZS5oYXNBbHBoYSA9IHRydWU7IHJtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTtcbiAgcm0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjg1LCAwLjY1KTsgcm0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcm0uYWxwaGEgPSAwLjU1OyBybS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgZGVjYWwubWF0ZXJpYWwgPSBybTtcblxuICAvLyAtLS0tIGRhcmsgdGVhbCBzdXJyb3VuZCB0aGF0IHN3YWxsb3dzIHRoZSBmYXIgZWRnZSBvZiB0aGUgZmxvb3JcbiAgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjAyLCAwLjA1LCAwLjA2LCAxKTtcbiAgc2NlbmUuZm9nTW9kZSA9IEJBQllMT04uU2NlbmUuRk9HTU9ERV9MSU5FQVI7IHNjZW5lLmZvZ0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMDIsIDAuMDUsIDAuMDYpOyBzY2VuZS5mb2dTdGFydCA9IDI0OyBzY2VuZS5mb2dFbmQgPSA1NjtcblxuICBjb25zdCBjYXZlID0gYnVpbGRDYXZlKHNjZW5lLCB0ZXgpO1xuICBsZXQga2l0OiB7IGFwcGx5KHQ6IFRoZW1lKTogdm9pZCB9IHwgbnVsbCA9IG51bGwsIHdhbnQgPSAnY3J5cHQnLCBzaG93biA9ICcnO1xuICBjb25zdCBzaG93ID0gKCkgPT4ge1xuICAgIGNvbnN0IHQgPSBUSEVNRVNbd2FudF0gPz8gVEhFTUVTLmNyeXB0OyBpZiAod2FudCA9PT0gc2hvd24gJiYga2l0KSByZXR1cm47XG4gICAgY29uc3QgY29sID0gKGM6IEMzKSA9PiBuZXcgQkFCWUxPTi5Db2xvcjMoY1swXSwgY1sxXSwgY1syXSk7XG4gICAgZ20uZGlmZnVzZUNvbG9yID0gY29sKHQuZmxvb3IpOyBjYXZlLndhbGxNYXQuZGlmZnVzZUNvbG9yID0gY29sKHQud2FsbCk7IHJtLmVtaXNzaXZlQ29sb3IgPSBjb2wodC5ydW5lKTtcbiAgICBmb3IgKGNvbnN0IG0gb2YgY2F2ZS5taXN0TWF0cykgbS5lbWlzc2l2ZUNvbG9yID0gY29sKHQubWlzdCk7XG4gICAgc2NlbmUuZm9nQ29sb3IgPSBjb2wodC5mb2cpOyBzY2VuZS5jbGVhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3I0KHQuZm9nWzBdLCB0LmZvZ1sxXSwgdC5mb2dbMl0sIDEpO1xuICAgIGlmIChraXQpIHsga2l0LmFwcGx5KHQpOyBzaG93biA9IHdhbnQ7IH1cbiAgfTtcbiAgbG9hZEtpdChzY2VuZSkudGhlbigoaykgPT4geyBraXQgPSBrOyBzaG93biA9ICcnOyBzaG93KCk7IH0pLmNhdGNoKChlKSA9PiBjb25zb2xlLndhcm4oJ2FyZW5hIHByb3BzIGZhaWxlZCcsIGUpKTtcblxuICByZXR1cm4geyB1cGRhdGU6ICh0OiBudW1iZXIpID0+IHsgcm0uYWxwaGEgPSAwLjQ1ICsgMC4xNSAqIE1hdGguc2luKHQgKiAxLjQpOyBjYXZlLnVwZGF0ZSh0KTsgfSwgc2V0VGhlbWU6IChzdGFnZTogc3RyaW5nKSA9PiB7IHdhbnQgPSBzdGFnZTsgc2hvdygpOyB9IH07XG59XG5cbi8vIC0tLS0gdGhlIGNhdmU6IGEgcm91Z2ggc3RvbmUgd2FsbCBhbGwgdGhlIHdheSByb3VuZCwgcm9jayBzcGlyZXMgYWxvbmcgaXRzIGZvb3QsIGRyaWZ0aW5nIG1pc3QsIGFuZCBhIGRhcmsgdmlnbmV0dGUgb24gdGhlIGZsb29yXG5jb25zdCBSWCA9IDIwLCBSWiA9IDE1LCBDWiA9IC00LCBXQUxMX0ggPSAxNjsgICAvLyBvdmFsIHJpbmcgY2VudHJlZCBhIGxpdHRsZSBiZWhpbmQgdGhlIGZpZWxkOiB0aGUgZmFyIHdhbGwgc3RhbmRzIGFib3V0IDExIG0gcGFzdCB0aGUgY2VudHJlXG5jb25zdCB3b2JibGUgPSAoYTogbnVtYmVyLCB5OiBudW1iZXIpOiBudW1iZXIgPT4gTWF0aC5zaW4oMyAqIGEgKyAxLjMpICogMC41ICsgTWF0aC5zaW4oNyAqIGEgKyB5ICogMC41KSAqIDAuMyArIE1hdGguc2luKDEzICogYSAtIHkgKiAwLjM1KSAqIDAuMiArIE1hdGguc2luKDIzICogYSArIHkpICogMC4wODtcblxuZnVuY3Rpb24gbWlzdFRleHR1cmUoc2NlbmU6IGFueSwgc2VlZDogbnVtYmVyKTogYW55IHtcbiAgY29uc3QgUyA9IDI1NiwgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdtaXN0JyArIHNlZWQsIHsgd2lkdGg6IFMsIGhlaWdodDogUyB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0LmdldENvbnRleHQoKTtcbiAgYy5jbGVhclJlY3QoMCwgMCwgUywgUyk7XG4gIGxldCByID0gc2VlZCAqIDkzMDEgKyA0OTI5NzsgY29uc3Qgcm5kID0gKCkgPT4gKHIgPSAociAqIDkzMDEgKyA0OTI5NykgJSAyMzMyODApIC8gMjMzMjgwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ2OyBpKyspIHtcbiAgICBjb25zdCB4ID0gcm5kKCkgKiBTLCB5ID0gcm5kKCkgKiBTLCByYWQgPSAyNiArIHJuZCgpICogNDY7XG4gICAgZm9yIChjb25zdCBkeCBvZiBbLVMsIDAsIFNdKSBmb3IgKGNvbnN0IGR5IG9mIFstUywgMCwgU10pIHsgICAgICAgICAgLy8gZHJhdyB3cmFwcGVkIGNvcGllcyBzbyB0aGUgcGljdHVyZSB0aWxlcyB3aXRoIG5vIHNlYW1cbiAgICAgIGNvbnN0IGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KHggKyBkeCwgeSArIGR5LCAwLCB4ICsgZHgsIHkgKyBkeSwgcmFkKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMC41KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICAgICAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIFMsIFMpO1xuICAgIH1cbiAgfVxuICB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gdHJ1ZTsgdC53cmFwVSA9IHQud3JhcFYgPSBCQUJZTE9OLlRleHR1cmUuV1JBUF9BRERSRVNTTU9ERTsgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkQ2F2ZShzY2VuZTogYW55LCBmbG9vclRleDogYW55KTogeyB1cGRhdGUodDogbnVtYmVyKTogdm9pZDsgd2FsbE1hdDogYW55OyBtaXN0TWF0czogYW55W10gfSB7XG4gIC8vIHJvdWdoIHdhbGw6IGFuIG92YWwgcmluZyB3aG9zZSByYWRpdXMgd29iYmxlcyB3aXRoIGFuZ2xlIGFuZCBoZWlnaHQsIGRhcmtlciB0aGUgaGlnaGVyIGl0IGdvZXNcbiAgY29uc3QgTiA9IDEyMCwgTSA9IDEyLCBwb3M6IG51bWJlcltdID0gW10sIHV2OiBudW1iZXJbXSA9IFtdLCBjb2w6IG51bWJlcltdID0gW10sIGlkeDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaiA9IDA7IGogPD0gTTsgaisrKSBmb3IgKGxldCBpID0gMDsgaSA8PSBOOyBpKyspIHtcbiAgICBjb25zdCBhID0gKGkgLyBOKSAqIE1hdGguUEkgKiAyLCBoID0gKGogLyBNKSAqIFdBTExfSCwgayA9IDEgKyAwLjA2ICogd29iYmxlKGEsIGgpICsgKGogPT09IDAgPyAwIDogMC4wNSAqIE1hdGguc2luKGEgKiA1ICsgaikpO1xuICAgIGNvbnN0IG92ZXJoYW5nID0gMSAtIDAuMSAqIE1hdGguc2luKChqIC8gTSkgKiBNYXRoLlBJKTsgICAgICAgICAgICAgICAgICAgICAgICAvLyBsZWFucyBpbiBhIGxpdHRsZSBzbyBpdCBmZWVscyBsaWtlIGEgY2F2ZXJuXG4gICAgcG9zLnB1c2goTWF0aC5jb3MoYSkgKiBSWCAqIGsgKiBvdmVyaGFuZywgaCwgQ1ogKyBNYXRoLnNpbihhKSAqIFJaICogayAqIG92ZXJoYW5nKTsgdXYucHVzaCgoaSAvIE4pICogMTQsIChqIC8gTSkgKiAzLjIpO1xuICAgIGNvbnN0IGIgPSBNYXRoLm1heCgwLjA2LCAxLjAgLSAoaiAvIE0pICogMC45KTsgY29sLnB1c2goYiAqIDAuOCwgYiwgYiwgMSk7XG4gIH1cbiAgZm9yIChsZXQgaiA9IDA7IGogPCBNOyBqKyspIGZvciAobGV0IGkgPSAwOyBpIDwgTjsgaSsrKSB7IGNvbnN0IGEgPSBqICogKE4gKyAxKSArIGksIGIgPSBhICsgMSwgYyA9IGEgKyBOICsgMSwgZCA9IGMgKyAxOyBpZHgucHVzaChhLCBjLCBiLCBiLCBjLCBkKTsgfVxuICBjb25zdCB3YWxsID0gbmV3IEJBQllMT04uTWVzaCgnY2F2ZScsIHNjZW5lKSwgdmQgPSBuZXcgQkFCWUxPTi5WZXJ0ZXhEYXRhKCk7IHZkLnBvc2l0aW9ucyA9IHBvczsgdmQuaW5kaWNlcyA9IGlkeDsgdmQudXZzID0gdXY7IHZkLmNvbG9ycyA9IGNvbDtcbiAgY29uc3QgbnJtOiBudW1iZXJbXSA9IFtdOyBCQUJZTE9OLlZlcnRleERhdGEuQ29tcHV0ZU5vcm1hbHMocG9zLCBpZHgsIG5ybSk7IHZkLm5vcm1hbHMgPSBucm07IHZkLmFwcGx5VG9NZXNoKHdhbGwpO1xuICBjb25zdCB3bSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2NhdmVtJywgc2NlbmUpOyB3bS5kaWZmdXNlVGV4dHVyZSA9IGZsb29yVGV4LmNsb25lKCk7IHdtLmRpZmZ1c2VUZXh0dXJlLnVTY2FsZSA9IDE7IHdtLmRpZmZ1c2VUZXh0dXJlLnZTY2FsZSA9IDE7XG4gIHdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyB3bS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgd20uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuODUsIDAuOSk7IHdhbGwubWF0ZXJpYWwgPSB3bTsgd2FsbC5pc1BpY2thYmxlID0gZmFsc2U7IHdhbGwudXNlVmVydGV4Q29sb3JzID0gdHJ1ZTsgd20udXNlVmVydGV4Q29sb3IgPSB0cnVlO1xuICAvLyByb2NrIHNwaXJlcyBzdGFuZGluZyBhbG9uZyB0aGUgZm9vdCBvZiB0aGUgd2FsbCAob25lIHNoYXJlZCBtZXNoLCBtYW55IGNvcGllcylcbiAgY29uc3Qgc3BpcmUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzcGlyZScsIHsgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiAxLjYsIGhlaWdodDogMSwgdGVzc2VsbGF0aW9uOiA1IH0sIHNjZW5lKTtcbiAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzcGlyZW0nLCBzY2VuZSk7IHNtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAzLCAwLjA0NSwgMC4wNTUpOyBzbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgc20uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAwNCwgMC4wMTIsIDAuMDE0KTsgc3BpcmUubWF0ZXJpYWwgPSBzbTtcbiAgc3BpcmUuY29udmVydFRvRmxhdFNoYWRlZE1lc2goKTsgc3BpcmUuc2V0RW5hYmxlZChmYWxzZSk7IHNwaXJlLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgbGV0IHIgPSAxMjM0NTsgY29uc3Qgcm5kID0gKCkgPT4gKHIgPSAociAqIDkzMDEgKyA0OTI5NykgJSAyMzMyODApIC8gMjMzMjgwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ2OyBpKyspIHtcbiAgICBjb25zdCBhID0gKGkgLyA0NikgKiBNYXRoLlBJICogMiArIChybmQoKSAtIDAuNSkgKiAwLjEyLCBkID0gMC44NiArIHJuZCgpICogMC4xLCBoZ3QgPSAxLjQgKyBybmQoKSAqIDMuMiwgdyA9IDAuNyArIHJuZCgpICogMS4wO1xuICAgIGNvbnN0IHMgPSBzcGlyZS5jcmVhdGVJbnN0YW5jZSgnc3AnICsgaSk7IHMuaXNQaWNrYWJsZSA9IGZhbHNlOyBzLnBvc2l0aW9uLnNldChNYXRoLmNvcyhhKSAqIFJYICogZCwgaGd0IC8gMiAtIDAuMiwgQ1ogKyBNYXRoLnNpbihhKSAqIFJaICogZCk7XG4gICAgcy5zY2FsaW5nLnNldCh3LCBoZ3QsIHcpOyBzLnJvdGF0aW9uLnkgPSBybmQoKSAqIDY7IHMucm90YXRpb24ueiA9IChybmQoKSAtIDAuNSkgKiAwLjE4O1xuICB9XG4gIC8vIG1pc3Q6IHR3byBzbG93IGxheWVycyBqdXN0IGFib3ZlIHRoZSBmbG9vclxuICBjb25zdCBsYXllcnMgPSBbMC4yOCwgMC43NV0ubWFwKCh5LCBuKSA9PiB7XG4gICAgY29uc3QgcCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdtaXN0JyArIG4sIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQ0IH0sIHNjZW5lKTsgcC5wb3NpdGlvbi55ID0geTsgcC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ21pc3RtJyArIG4sIHNjZW5lKSwgdCA9IG1pc3RUZXh0dXJlKHNjZW5lLCBuICsgMyk7IHQudVNjYWxlID0gNSAtIG47IHQudlNjYWxlID0gMy40IC0gbiAqIDAuNjtcbiAgICBtLmRpZmZ1c2VUZXh0dXJlID0gdDsgbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjIsIDAuNiwgMC41NSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IDAuMTUgLSBuICogMC4wNjsgbS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTtcbiAgICBtLmRpc2FibGVEZXB0aFdyaXRlID0gdHJ1ZTsgcC5tYXRlcmlhbCA9IG07IHAuYWxwaGFJbmRleCA9IDUgKyBuOyByZXR1cm4geyB0LCBuLCBtIH07XG4gIH0pO1xuICAvLyB2aWduZXR0ZTogZGFya2VucyB0aGUgZmxvb3IgdG93YXJkIHRoZSBlZGdlcyBzbyB0aGUgZmllbGQgbG9va3MgbGlrZSBhIGxpdCBwb29sIGluc2lkZSB0aGUgY2F2ZVxuICBjb25zdCB2dCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCd2aWcnLCB7IHdpZHRoOiAyNTYsIGhlaWdodDogMjU2IH0sIHNjZW5lLCB0cnVlKSwgdmMgPSB2dC5nZXRDb250ZXh0KCksIGcgPSB2Yy5jcmVhdGVSYWRpYWxHcmFkaWVudCgxMjgsIDEyOCwgMCwgMTI4LCAxMjgsIDEyOCk7XG4gIGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDAsMCwwLDApJyk7IGcuYWRkQ29sb3JTdG9wKDAuNDIsICdyZ2JhKDAsMCwwLDApJyk7IGcuYWRkQ29sb3JTdG9wKDAuOCwgJ3JnYmEoMCw0LDYsMC43KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgwLDQsNiwwLjk1KScpO1xuICB2Yy5maWxsU3R5bGUgPSBnOyB2Yy5maWxsUmVjdCgwLCAwLCAyNTYsIDI1Nik7IHZ0LnVwZGF0ZSgpOyB2dC5oYXNBbHBoYSA9IHRydWU7XG4gIGNvbnN0IHZpZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCd2aWcnLCB7IHdpZHRoOiA0NiwgaGVpZ2h0OiAzMCB9LCBzY2VuZSk7IHZpZy5wb3NpdGlvbi55ID0gMC4wMzsgdmlnLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgY29uc3Qgdm0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd2aWdtJywgc2NlbmUpOyB2bS5kaWZmdXNlVGV4dHVyZSA9IHZ0OyB2bS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHZtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHZtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMCwgMC4wMSwgMC4wMTUpOyB2bS5kaXNhYmxlRGVwdGhXcml0ZSA9IHRydWU7IHZpZy5tYXRlcmlhbCA9IHZtOyB2aWcuYWxwaGFJbmRleCA9IDE7XG4gIHJldHVybiB7IHdhbGxNYXQ6IHdtLCBtaXN0TWF0czogbGF5ZXJzLm1hcCgobCkgPT4gbC5tKSwgdXBkYXRlOiAodDogbnVtYmVyKSA9PiB7IGZvciAoY29uc3QgbCBvZiBsYXllcnMpIHsgbC50LnVPZmZzZXQgPSB0ICogKDAuMDA2ICsgbC5uICogMC4wMDQpOyBsLnQudk9mZnNldCA9IHQgKiAwLjAwMyAqIChsLm4gPyAtMSA6IDEpOyB9IH0gfTtcbn1cbiIsICIvLyBBdXRvLWJhdHRsZSBzaW11bGF0aW9uOiBwdXJlIGxvZ2ljLCBubyBncmFwaGljcy4gRGV0ZXJtaW5pc3RpYyBmb3IgYSBnaXZlbiBzZWVkLlxuLy8gVGhlIHJlbmRlcmVyIG9ubHkgcmVhZHMgZmlnaHRlcnMgKyBldmVudHM7IGl0IG5ldmVyIGRlY2lkZXMgYW55dGhpbmcuXG4vL1xuLy8gQWJpbGl0aWVzIChudW1iZXJzIGxpdmUgaW4gYmFsYW5jZS50cyk6XG4vLyAgIFNrZWxldG9uIFdhcnJpb3IgIFBoYWxhbnggICAgIHRha2VzIGxlc3MgZGFtYWdlIGZvciBlYWNoIG5lYXJieSBhbGxpZWQgV2FycmlvciAoY2FwcGVkKVxuLy8gICBTa2VsZXRvbiBBcmNoZXIgICBTcGxpdCBBcnJvdyAoc2tpbGwpIG9uZSBhcnJvdyBhdCBlYWNoIG9mIHVwIHRvIDMgZGlmZmVyZW50IGVuZW1pZXM7IGJhc2ljIHNob3RzIGFyZSBhIHNpbmdsZSBhcnJvd1xuLy8gICBHb2JsaW4gICAgICAgICAgICBPcHBvcnR1bmlzdCArZGFtYWdlIG9uIGFuIGVuZW15IHRoYXQgaXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlOyBwcmVmZXJzIHN1Y2ggdGFyZ2V0c1xuLy8gICBLbmlnaHQgICAgICAgICAgICBUYXVudCAoc2tpbGwpICBmb3JjZXMgbmVhcmJ5IGVuZW1pZXMgdG8gYXR0YWNrIGhpbVxuLy8gICBPZ3JlICAgICAgICAgICAgICBTbWFzaCAoc2tpbGwpICBoZWF2eSBzbGFtIHRoYXQgYWxzbyBoaXRzIGVuZW1pZXMgbmVhciB0aGUgaW1wYWN0XG4vLyBTa2lsbHMgcnVuIG9uIG1hbmE6IGJhc2ljIGF0dGFja3MgYW5kIGRhbWFnZSB0YWtlbiBmaWxsIGEgYmFyOyB3aGVuIGZ1bGwsIHRoZSBuZXh0IGF0dGFjayBpcyB0aGUgc2tpbGwgYW5kIHRoZSBiYXIgcmVzZXRzLlxuLy8gV2FycmlvciwgR29ibGluIGFuZCBCYXJiYXJpYW4gaGF2ZSBwYXNzaXZlcyBvbmx5IChubyBtYW5hKS5cbi8vICAgQmFyYmFyaWFuICAgICAgICAgRnJlbnp5ICAgICAgYXR0YWNrcyBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nXG5cbmltcG9ydCB7IEdSSURfQ09MUywgR1JJRF9ST1dTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgY29uc3QgR1JJRF9TUCA9IDEuMzsgICAgIC8vIG1ldHJlcyBiZXR3ZWVuIGdyaWQgY2VsbHNcbmV4cG9ydCBjb25zdCBGUk9OVF9YID0gMS43OyAgICAgLy8gZnJvbnQgbGluZSdzIGRpc3RhbmNlIGZyb20gdGhlIGNlbnRyZSBsaW5lXG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xvdCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXIgfVxuXG4vKiogV29ybGQgcG9zaXRpb24gb2YgYSBncmlkIGNlbGwgZm9yIGEgdGVhbSAodGVhbSAwID0gbGVmdCwgZmFjZXMgK1g7IHRlYW0gMSA9IHJpZ2h0LCBmYWNlcyAtWCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2VsbFBvcyh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKTogeyB4OiBudW1iZXI7IHo6IG51bWJlciB9IHtcbiAgY29uc3Qgcm93ID0gTWF0aC5mbG9vcihjZWxsIC8gR1JJRF9DT0xTKSwgY29sID0gY2VsbCAlIEdSSURfQ09MUztcbiAgY29uc3QgZGVwdGggPSBHUklEX0NPTFMgLSAxIC0gY29sOyAgICAgICAgICAgICAgICAgICAgICAgLy8gMCA9IGZyb250IGxpbmVcbiAgcmV0dXJuIHsgeDogKEZST05UX1ggKyBkZXB0aCAqIEdSSURfU1ApICogKHRlYW0gPT09IDAgPyAtMSA6IDEpLCB6OiAocm93IC0gKEdSSURfUk9XUyAtIDEpIC8gMikgKiBHUklEX1NQIH07XG59XG5cbmNvbnN0IEZST05UTkVTUzogUmVjb3JkPFNvdWxJZCwgbnVtYmVyPiA9IHsga25pZ2h0OiA1LCBvZ3JlOiA0LCB3YXJyaW9yOiAzLCBiYXJiYXJpYW46IDMsIGdvYmxpbjogMiwgYXJjaGVyOiAwIH07XG4vKiogVGhlIGVuZW15IGFybXkgaXMgcGxhY2VkIGF1dG9tYXRpY2FsbHkgKHRhbmtzIHVwIGZyb250LCBhcmNoZXJzIGJlaGluZCk7IHRoZSBwbGF5ZXIgb25seSBldmVyIHNlZXMgaXRzIGNvbXBvc2l0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZW15Q2VsbHMoc3BlY3M6IFNwZWNbXSk6IG51bWJlcltdIHtcbiAgY29uc3QgY2VsbHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DT0xTICogR1JJRF9ST1dTOyBjKyspIGNlbGxzLnB1c2goYyk7XG4gIGNlbGxzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBkYSA9IEdSSURfQ09MUyAtIDEgLSAoYSAlIEdSSURfQ09MUyksIGRiID0gR1JJRF9DT0xTIC0gMSAtIChiICUgR1JJRF9DT0xTKTtcbiAgICBpZiAoZGEgIT09IGRiKSByZXR1cm4gZGEgLSBkYjtcbiAgICByZXR1cm4gTWF0aC5hYnMoTWF0aC5mbG9vcihhIC8gR1JJRF9DT0xTKSAtIDEpIC0gTWF0aC5hYnMoTWF0aC5mbG9vcihiIC8gR1JJRF9DT0xTKSAtIDEpO1xuICB9KTtcbiAgY29uc3Qgb3JkZXIgPSBzcGVjcy5tYXAoKHMsIGkpID0+IGkpLnNvcnQoKGksIGopID0+IEZST05UTkVTU1tzcGVjc1tqXS5zb3VsXSAtIEZST05UTkVTU1tzcGVjc1tpXS5zb3VsXSk7XG4gIGNvbnN0IG91dCA9IG5ldyBBcnJheTxudW1iZXI+KHNwZWNzLmxlbmd0aCk7XG4gIG9yZGVyLmZvckVhY2goKGlkeCwgaykgPT4geyBvdXRbaWR4XSA9IGNlbGxzW2tdOyB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IHR5cGUgRlN0YXRlID0gJ2lkbGUnIHwgJ3J1bicgfCAnYXR0YWNrJyB8ICdkZWFkJztcbmV4cG9ydCBpbnRlcmZhY2UgRmlnaHRlciB7XG4gIGlkOiBudW1iZXI7IHRlYW06IDAgfCAxOyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyO1xuICB4OiBudW1iZXI7IHo6IG51bWJlcjsgeWF3OiBudW1iZXI7XG4gIGhwOiBudW1iZXI7IG1heEhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBpbnRlcnZhbDogbnVtYmVyOyByYW5nZTogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyByYWRpdXM6IG51bWJlcjtcbiAgYWxpdmU6IGJvb2xlYW47IHN0YXRlOiBGU3RhdGU7XG4gIHRhcmdldDogbnVtYmVyOyByZXRhcmdldEF0OiBudW1iZXI7IGZvcmNlZFRhcmdldDogbnVtYmVyOyBmb3JjZWRVbnRpbDogbnVtYmVyO1xuICBuZXh0QXR0YWNrOiBudW1iZXI7IGF0dGFja1N0YXJ0OiBudW1iZXI7IGF0dGFja0R1cjogbnVtYmVyOyBhbmltU3BlZWQ6IG51bWJlcjsgaGl0RG9uZTogYm9vbGVhbjtcbiAgbWFuYTogbnVtYmVyOyBtYXhNYW5hOiBudW1iZXI7IGNhc3Rpbmc6IGJvb2xlYW47IGZyZW56eTogbnVtYmVyOyBkZWFkQXQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgQkV2ZW50ID1cbiAgfCB7IHQ6ICdzd2luZyc7IGlkOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdoaXQnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyOyBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ2Fycm93JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnZGVhdGgnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdjYXN0JzsgaWQ6IG51bWJlcjsgc2tpbGw6ICdzcGxpdCcgfCAndGF1bnQnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAndGF1bnQnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdzbWFzaCc7IGlkOiBudW1iZXI7IHg6IG51bWJlcjsgejogbnVtYmVyOyByOiBudW1iZXIgfVxuICB8IHsgdDogJ2ZyZW56eSc7IGlkOiBudW1iZXI7IHN0YWNrczogbnVtYmVyIH07XG5cbmV4cG9ydCBjbGFzcyBCYXR0bGUge1xuICB0aW1lID0gMDtcbiAgZmlnaHRlcnM6IEZpZ2h0ZXJbXSA9IFtdO1xuICBldmVudHM6IEJFdmVudFtdID0gW107XG4gIHdpbm5lcjogLTEgfCAwIHwgMSA9IC0xO1xuICBybmc6IFJuZztcbiAgcHJpdmF0ZSBwZW5kaW5nOiB7IGF0OiBudW1iZXI7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXIgfVtdID0gW107XG4gIHByaXZhdGUgbmV4dElkID0gMTtcbiAgcHJpdmF0ZSBlbmVteVBvd2VyID0gMTtcbiAgcHJpdmF0ZSBmbGlwID0gZmFsc2U7XG5cbiAgLyoqIGBsZXZlbHNgOiB0aGUgcGxheWVyJ3MgcGVybWFuZW50IFNvdWwgbGV2ZWxzIChoZWFsdGggYW5kIGRhbWFnZSBncm93IGEgbGl0dGxlIHBlciBsZXZlbCkuIEVuZW1pZXMgbmV2ZXIgdXNlIHRoZW0uICovXG4gIC8qKiBgZW5lbXlQb3dlcmA6IGhlYWx0aCBhbmQgZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBlbmVteSB0ZWFtIG9ubHkgKHN0YWdlIHN0cmVuZ3RoOyAxID0gYXMgd3JpdHRlbikuICovXG4gIGNvbnN0cnVjdG9yKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSwgbGV2ZWxzPzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiwgZW5lbXlQb3dlciA9IDEpIHtcbiAgICB0aGlzLnJuZyA9IG1ha2VSbmcoc2VlZCk7IHRoaXMuZW5lbXlQb3dlciA9IGVuZW15UG93ZXI7XG4gICAgZm9yIChjb25zdCBwIG9mIHBsYXllcnMpIHRoaXMuYWRkKDAsIHAuc291bCwgcC5zdGFyLCBwLmNlbGwsIGxldmVscz8uW3Auc291bF0gPz8gMSk7XG4gICAgY29uc3QgY2VsbHMgPSBlbmVteUNlbGxzKGVuZW1pZXMpO1xuICAgIGVuZW1pZXMuZm9yRWFjaCgoZSwgaSkgPT4gdGhpcy5hZGQoMSwgZS5zb3VsLCBlLnN0YXIsIGNlbGxzW2ldKSk7XG4gIH1cblxuICBwcml2YXRlIGFkZCh0ZWFtOiAwIHwgMSwgc291bDogU291bElkLCBzdGFyOiBudW1iZXIsIGNlbGw6IG51bWJlciwgbGV2ZWwgPSAxKTogRmlnaHRlciB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tzb3VsXSwgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCk7XG4gICAgY29uc3QgbHZIcCA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmhwLCBsdkRtZyA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmRtZztcbiAgICBjb25zdCBwdyA9IHRlYW0gPT09IDEgPyB0aGlzLmVuZW15UG93ZXIgOiAxO1xuICAgIGNvbnN0IGhwID0gc3QuaHAgKiBCLnN0YXIuaHBbc3RhciAtIDFdICogbHZIcCAqIHB3O1xuICAgIGNvbnN0IGY6IEZpZ2h0ZXIgPSB7XG4gICAgICBpZDogdGhpcy5uZXh0SWQrKywgdGVhbSwgc291bCwgc3RhciwgY2VsbCwgeDogcC54LCB6OiBwLnosIHlhdzogdGVhbSA9PT0gMCA/IDAgOiBNYXRoLlBJLFxuICAgICAgaHAsIG1heEhwOiBocCwgZG1nOiBzdC5kbWcgKiBCLnN0YXIuZG1nW3N0YXIgLSAxXSAqIGx2RG1nICogcHcsIGludGVydmFsOiBzdC5pbnRlcnZhbCwgcmFuZ2U6IHN0LnJhbmdlLCBzcGVlZDogc3Quc3BlZWQsIHJhZGl1czogc3Quc2l6ZSAqIEIuc3Rhci5zY2FsZVtzdGFyIC0gMV0sXG4gICAgICBhbGl2ZTogdHJ1ZSwgc3RhdGU6ICdpZGxlJywgdGFyZ2V0OiAtMSwgcmV0YXJnZXRBdDogMCwgZm9yY2VkVGFyZ2V0OiAtMSwgZm9yY2VkVW50aWw6IDAsXG4gICAgICBuZXh0QXR0YWNrOiB0aGlzLnJuZy5uZXh0KCkgKiAwLjMsIGF0dGFja1N0YXJ0OiAtOSwgYXR0YWNrRHVyOiAxLCBhbmltU3BlZWQ6IDEsIGhpdEZyYWM6IDAsIGhpdERvbmU6IHRydWUsXG4gICAgICBtYW5hOiAwLCBtYXhNYW5hOiBCLm1hbmFbc291bF0/Lm1heCA/PyAwLCBjYXN0aW5nOiBmYWxzZSwgZnJlbnp5OiAwLCBkZWFkQXQ6IDAsXG4gICAgfSBhcyBGaWdodGVyO1xuICAgIHRoaXMuZmlnaHRlcnMucHVzaChmKTsgcmV0dXJuIGY7XG4gIH1cblxuICBieUlkKGlkOiBudW1iZXIpOiBGaWdodGVyIHwgdW5kZWZpbmVkIHsgcmV0dXJuIGlkIDwgMCA/IHVuZGVmaW5lZCA6IHRoaXMuZmlnaHRlcnNbaWQgLSAxXTsgfVxuICBmb2VzKGY6IEZpZ2h0ZXIpOiBGaWdodGVyW10geyByZXR1cm4gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgby50ZWFtICE9PSBmLnRlYW0pOyB9XG4gIGNvdW50KHRlYW06IDAgfCAxKTogbnVtYmVyIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMucmVkdWNlKChuLCBmKSA9PiBuICsgKGYuYWxpdmUgJiYgZi50ZWFtID09PSB0ZWFtID8gMSA6IDApLCAwKTsgfVxuICBkcmFpbigpOiBCRXZlbnRbXSB7IGNvbnN0IGUgPSB0aGlzLmV2ZW50czsgdGhpcy5ldmVudHMgPSBbXTsgcmV0dXJuIGU7IH1cblxuICBzdGVwKGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy53aW5uZXIgPj0gMCkgcmV0dXJuO1xuICAgIHRoaXMudGltZSArPSBkdDsgdGhpcy5mbGlwID0gIXRoaXMuZmxpcDtcbiAgICAvLyBhcnJvd3MgdGhhdCBoYXZlIGZpbmlzaGVkIGZseWluZ1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnBlbmRpbmcubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBlbmRpbmdbaV07XG4gICAgICBpZiAodGhpcy50aW1lID49IHAuYXQpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnNwbGljZShpLCAxKTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLmJ5SWQocC50byksIGZyb20gPSB0aGlzLmJ5SWQocC5mcm9tKTtcbiAgICAgICAgaWYgKHRvICYmIHRvLmFsaXZlICYmIGZyb20pIHRoaXMuZGFtYWdlKHRvLCBwLmRtZywgZnJvbSwgJ2Fycm93Jyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG9yZGVyID0gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAodGhpcy5mbGlwKSBvcmRlci5yZXZlcnNlKCk7XG4gICAgZm9yIChjb25zdCBmIG9mIG9yZGVyKSBpZiAoZi5hbGl2ZSkgdGhpcy51cGRhdGUoZiwgZHQpO1xuICAgIGNvbnN0IGEgPSB0aGlzLmNvdW50KDApLCBiID0gdGhpcy5jb3VudCgxKTtcbiAgICBpZiAoIWEgfHwgIWIpIHRoaXMud2lubmVyID0gYSA/IDAgOiAxO1xuICAgIGVsc2UgaWYgKHRoaXMudGltZSA+PSBCQUxBTkNFLnNpbS50aW1lTGltaXQpIHtcbiAgICAgIGNvbnN0IGhwID0gKHQ6IDAgfCAxKSA9PiB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHQpLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKTtcbiAgICAgIHRoaXMud2lubmVyID0gaHAoMCkgPiBocCgxKSA/IDAgOiAxO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwZXItZmlnaHRlciB1cGRhdGVcbiAgcHJpdmF0ZSB1cGRhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTtcbiAgICB0aGlzLnNlcGFyYXRlKGYsIGR0KTtcblxuICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykge1xuICAgICAgY29uc3QgdCA9IHRoaXMudGltZSAtIGYuYXR0YWNrU3RhcnQ7XG4gICAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7IGlmICh0ZyAmJiB0Zy5hbGl2ZSkgdGhpcy5mYWNlKGYsIHRnLnggLSBmLngsIHRnLnogLSBmLnosIGR0KTtcbiAgICAgIGlmICghZi5oaXREb25lICYmIHQgPj0gZi5hdHRhY2tEdXIgKiBzdC5oaXRGcmFjKSB7IGYuaGl0RG9uZSA9IHRydWU7IHRoaXMucmVzb2x2ZUhpdChmKTsgfVxuICAgICAgaWYgKHQgPj0gZi5hdHRhY2tEdXIpIGYuc3RhdGUgPSAnaWRsZSc7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYWNxdWlyZShmKTtcbiAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgcmV0dXJuOyB9XG4gICAgY29uc3QgZHggPSB0Zy54IC0gZi54LCBkeiA9IHRnLnogLSBmLnosIGRpc3QgPSBNYXRoLmh5cG90KGR4LCBkeik7XG4gICAgdGhpcy5mYWNlKGYsIGR4LCBkeiwgZHQpO1xuICAgIGlmIChkaXN0IDw9IGYucmFuZ2UpIHtcbiAgICAgIGlmICh0aGlzLnRpbWUgPj0gZi5uZXh0QXR0YWNrKSB0aGlzLnN0YXJ0QXR0YWNrKGYpOyBlbHNlIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmLnN0YXRlID0gJ3J1bic7IGNvbnN0IGsgPSBmLnNwZWVkICogZHQgLyBNYXRoLm1heChkaXN0LCAxZS00KTsgZi54ICs9IGR4ICogazsgZi56ICs9IGR6ICogazsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICAvKipcbiAgICogS2VlcCBmaWdodGVycyBmcm9tIHN0YWNraW5nIHdpdGhvdXQgc2hvdmluZyBhbnlvbmUgYWNyb3NzIHRoZSBtYXAuXG4gICAqIC0gQSBmaWdodGVyIHRoYXQgaXMgc3RhbmRpbmcgYW5kIGZpZ2h0aW5nIGlzIFwicGxhbnRlZFwiOiBpdCBiYXJlbHkgbW92ZXM7IHRoZSBvbmVzIHN0aWxsIFdBTEtJTkcgeWllbGQgdG8gaXQuXG4gICAqIC0gSGVhdmllciB1bml0cyAoT2dyZSwgS25pZ2h0KSBwdXNoIGxpZ2h0ZXIgb25lcyBtb3JlIHRoYW4gdGhlIG90aGVyIHdheSByb3VuZC5cbiAgICogLSBUaGUgdG90YWwgcHVzaCBvbiBvbmUgZmlnaHRlciBpcyBjYXBwZWQgcGVyIHNlY29uZCwgc28gYSBjcm93ZCBjYW4gbmV2ZXIgc2xpZGUgYSB1bml0IGZhci5cbiAgICovXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IHBsYW50ZWQgPSAodTogRmlnaHRlcikgPT4gdS5zdGF0ZSA9PT0gJ2F0dGFjaycgfHwgdS5zdGF0ZSA9PT0gJ2lkbGUnLCBtYXNzID0gKHU6IEZpZ2h0ZXIpID0+IHUucmFkaXVzICogdS5yYWRpdXM7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgbGV0IHNoYXJlID0gbWFzcyhvKSAvIChtYXNzKGYpICsgbWFzcyhvKSk7ICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgbGlnaHRlciBvbmUgb2YgdGhlIHBhaXIgbW92ZXMgbW9yZVxuICAgICAgY29uc3QgcGYgPSBwbGFudGVkKGYpLCBwbyA9IHBsYW50ZWQobyk7XG4gICAgICBpZiAocGYgJiYgIXBvKSBzaGFyZSAqPSAwLjEyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZiBpcyBzdGFuZGluZyBpdHMgZ3JvdW5kOiB0aGUgd2Fsa2VyIG8gZ29lcyBhcm91bmRcbiAgICAgIGVsc2UgaWYgKCFwZiAmJiBwbykgc2hhcmUgPSBNYXRoLm1pbigxLCBzaGFyZSAqIDEuNSArIDAuMzUpOyAgICAvLyBmIGlzIHdhbGtpbmcgaW50byBhIHBsYW50ZWQgdW5pdDogZiB5aWVsZHNcbiAgICAgIGVsc2UgaWYgKHBmICYmIHBvKSBzaGFyZSAqPSAwLjM1OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0d28gc3RhbmRpbmcgdW5pdHMgb3ZlcmxhcCBhIGxpdHRsZTogZWFzZSBhcGFydCB2ZXJ5IHNsb3dseVxuICAgICAgY29uc3QgayA9ICgod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMykpICogc2hhcmUgKiAyO1xuICAgICAgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBsZXQgbXggPSBweCAqIHMsIG16ID0gcHogKiBzO1xuICAgIGNvbnN0IGNhcCA9IChwbGFudGVkKGYpID8gMC41IDogMS42KSAqIGR0LCBsZW4gPSBNYXRoLmh5cG90KG14LCBteik7ICAgLy8gbWV0cmVzIHBlciBzZWNvbmQsIHN0YW5kaW5nIHZzIHdhbGtpbmdcbiAgICBpZiAobGVuID4gY2FwKSB7IG14ICo9IGNhcCAvIGxlbjsgbXogKj0gY2FwIC8gbGVuOyB9XG4gICAgZi54ICs9IG14OyBmLnogKz0gbXo7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicgJiYgY3VyICYmIGN1ci5hbGl2ZSAmJiBNYXRoLmh5cG90KGN1ci54IC0gZi54LCBjdXIueiAtIGYueikgPD0gZi5yYW5nZSAqIDEuMykgcmV0dXJuOyAgIC8vIGFscmVhZHkgaW4gcmVhY2ggb2Ygc29tZW9uZTogaGl0IHRoZW0sIGRvbid0IHdhbmRlciBvZmYgYWZ0ZXIgYSBqdWljaWVyIHRhcmdldFxuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJyAmJiBvLmlkID09PSBmLnRhcmdldCkgc2NvcmUgLT0gMS41OyAgIC8vIHN0aWNrIHdpdGggYSB0YXJnZXQgdW5sZXNzIGFub3RoZXIgaXMgY2xlYXJseSBiZXR0ZXJcbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzAsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQsIGxldmVscywgZW5lbXlQb3dlcik7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgIi8vIEVuZGxlc3MgRGVwdGhzOiBlbmVteSB3YXZlcyBidWlsdCBmcm9tIGEgQlVER0VUIGluc3RlYWQgb2YgYSBoYW5kLXdyaXR0ZW4gbGlzdCwgc28gdGhlIG1vZGUgbmV2ZXIgcnVucyBvdXQgb2Ygd2F2ZXMuXG4vLyBUaGUgYnVkZ2V0IGlzIHRoZSBlbmVteSB0ZWFtJ3MgdG90YWwgRG9taW5pb24gY29zdCAodGhlIHNhbWUgQ09TVCB0YWJsZSB0aGUgcGxheWVyIHBheXMgZnJvbSkuIFdhdmVzIGFyZSBidWlsdCBmcm9tIHJvbGUgVEVNUExBVEVTIHNvIHRoZXlcbi8vIGxvb2sgZGVzaWduZWQgKGEgZnJvbnQgbGluZSB3aXRoIGFyY2hlcnMgYmVoaW5kLCBhIHN3YXJtLCBhIGJydXRlIHNxdWFkKSBpbnN0ZWFkIG9mIGEgcmFuZG9tIHBpbGUuIEV2ZXJ5dGhpbmcgaXMgc2VlZGVkOiB0aGUgc2FtZSBzZWVkIGdpdmVzXG4vLyB0aGUgc2FtZSB3YXZlcywgc28gYSByZXRyeSAob3IgYSBkYWlseSBzZWVkKSBmYWNlcyBleGFjdGx5IHRoZSBzYW1lIGFybXkuXG4vL1xuLy8gVGhlIHBsYXllcidzIGFybXkgaXMgY2FwcGVkIG9uIHB1cnBvc2UgKERvbWluaW9uIHN0b3BzIGF0IDQwLCB0aGUgZ3JpZCBob2xkcyAxMiksIHNvIGF0IHNvbWUgcG9pbnQgdGhlIGVuZW15IHNpbXBseSBvdXQtc2NhbGVzIGl0OiB0aGF0IGlzIHRoZVxuLy8gXCJoYXJkIHdhbGxcIi4gT25jZSB0aGUgYnVkZ2V0IGZpbGxzIHRoZSAxMiBzbG90cyB3aXRoIHVwZ3JhZGVkIHVuaXRzLCBgZW5kbGVzc1Bvd2VyYCAodGhlIGhpZGRlbiBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIpIGtlZXBzIGNsaW1iaW5nLlxuLy8gTnVtYmVycyBoZXJlIGFyZSB0dW5lZCB3aXRoIHNpbS9lbmRsZXNzX2N1cnZlLnRzLlxuXG5pbXBvcnQgeyBDT1NUIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IEVuZW15U3BlYyB9IGZyb20gJy4vd2F2ZXMudHMnO1xuXG5leHBvcnQgY29uc3QgRU5ETEVTU19JRCA9ICdlbmRsZXNzJztcbi8qKiBBIHBhY2sgaXMgZ3JhbnRlZCBldmVyeSB0aGlzLW1hbnkgd2F2ZXMgY2xlYXJlZCBpbiBhbiBlbmRsZXNzIHJ1bi4gKi9cbmV4cG9ydCBjb25zdCBFTkRMRVNTX1BBQ0tfRVZFUlkgPSAxMDtcbmNvbnN0IE1BWF9VTklUUyA9IDEyO1xuXG4vKiogVGhlIHR1bmluZyBrbm9icyAoc2ltL2VuZGxlc3NfY3VydmUudHMgc3dlZXBzIHRoZW0pLiAqL1xuZXhwb3J0IGNvbnN0IFRVTkUgPSB7IHN0YXJ0OiA1LCBzbG9wZTogMy4wLCBsYXRlU2xvcGU6IDAuOCwgbWF4QnVkZ2V0OiAxNTAsIHBvd2VyU2xvcGU6IDAuMDEyLCBjaGFtcGlvbjogMS4wIH07XG4vKiogVG90YWwgRG9taW5pb24gY29zdCBvZiB0aGUgZW5lbXkgdGVhbSBhdCB3YXZlIGBuYCAoMS1iYXNlZCk6IGEgZ2VudGxlIHN0YXJ0IChhYm91dCB0aGUgTm9ybWFsIGNhbXBhaWduIGJ5IHdhdmUgMTApLCB0aGVuIGl0IGtlZXBzIHJpc2luZy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzQnVkZ2V0KG46IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHcgPSBNYXRoLm1heCgxLCBuKSwgZWFybHkgPSBUVU5FLnN0YXJ0ICsgVFVORS5zbG9wZSAqIChNYXRoLm1pbih3LCAxMCkgLSAxKTtcbiAgcmV0dXJuIE1hdGgucm91bmQoTWF0aC5taW4oVFVORS5tYXhCdWRnZXQsIGVhcmx5ICsgKHcgPiAxMCA/IFRVTkUubGF0ZVNsb3BlICogKHcgLSAxMCkgOiAwKSkpO1xufVxuLyoqIEhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXI6IDEuMCB0aHJvdWdoIHdhdmUgMTAsIHRoZW4gcmlzaW5nOyBldmVyeSAxMHRoIChjaGFtcGlvbikgd2F2ZSBnZXRzIGEgbGl0dGxlIGV4dHJhLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NQb3dlcihuOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgbiksIGJhc2UgPSB3IDw9IDEwID8gMSA6IDEgKyBUVU5FLnBvd2VyU2xvcGUgKiAodyAtIDEwKTtcbiAgcmV0dXJuICsodyAlIDEwID09PSAwID8gYmFzZSAqIFRVTkUuY2hhbXBpb24gOiBiYXNlKS50b0ZpeGVkKDMpO1xufVxuLyoqIFBhY2sgdGllciBmb3IgY2xlYXJpbmcgd2F2ZSBgbmAgKG9ubHkgbWVhbmluZ2Z1bCB3aGVuIG4gaXMgYSBtdWx0aXBsZSBvZiBFTkRMRVNTX1BBQ0tfRVZFUlkpLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NQYWNrVGllciA9IChuOiBudW1iZXIpOiBudW1iZXIgPT4gKG4gPj0gMzAgPyAzIDogbiA+PSAyMCA/IDIgOiAxKTtcblxudHlwZSBSb2xlID0gJ3RhbmsnIHwgJ2JydXRlJyB8ICdyYW5nZWQnIHwgJ2ZvZGRlcic7XG5jb25zdCBST0xFOiBSZWNvcmQ8Um9sZSwgU291bElkW10+ID0geyB0YW5rOiBbJ2tuaWdodCcsICdvZ3JlJ10sIGJydXRlOiBbJ2JhcmJhcmlhbicsICdvZ3JlJ10sIHJhbmdlZDogWydhcmNoZXInXSwgZm9kZGVyOiBbJ3dhcnJpb3InLCAnZ29ibGluJ10gfTtcbmV4cG9ydCBpbnRlcmZhY2UgVGVtcGxhdGUgeyBpZDogc3RyaW5nOyBtaXg6IFtSb2xlLCBudW1iZXJdW10gfVxuZXhwb3J0IGNvbnN0IFRFTVBMQVRFUzogVGVtcGxhdGVbXSA9IFtcbiAgeyBpZDogJ3dhbGwnLCBtaXg6IFtbJ3RhbmsnLCAzXSwgWydyYW5nZWQnLCAyXSwgWydmb2RkZXInLCAxXV0gfSxcbiAgeyBpZDogJ3N3YXJtJywgbWl4OiBbWydmb2RkZXInLCA1XSwgWydyYW5nZWQnLCAxXSwgWyd0YW5rJywgMV1dIH0sXG4gIHsgaWQ6ICdicnV0ZXMnLCBtaXg6IFtbJ2JydXRlJywgNF0sIFsnZm9kZGVyJywgMV0sIFsncmFuZ2VkJywgMV1dIH0sXG4gIHsgaWQ6ICdtaXhlZCcsIG1peDogW1sndGFuaycsIDFdLCBbJ2JydXRlJywgMV0sIFsncmFuZ2VkJywgMV0sIFsnZm9kZGVyJywgMl1dIH0sXG5dO1xuXG4vKiogV2F2ZXMgMS0yIGFyZSBhIGdlbnRsZSB3YXJtLXVwOiBjaGVhcCBmb2RkZXIgKGFuZCBhbiBhcmNoZXIpLCBubyB0YW5rcyBvciBicnV0ZXMsIHNvIG5vYm9keSBsb3NlcyBhIGhlYXJ0IHRvIHRoZSBmaXJzdCBmaWdodC4gKi9cbmNvbnN0IFdBUk1VUDogVGVtcGxhdGUgPSB7IGlkOiAnd2FybXVwJywgbWl4OiBbWydmb2RkZXInLCAzXSwgWydyYW5nZWQnLCAxXV0gfTtcbi8qKiBXaGljaCB0ZW1wbGF0ZSBhIHdhdmUgdXNlcyAoc2VlZGVkIHBlciB3YXZlLCBzbyBpdCBkb2VzIG5vdCBkZXBlbmQgb24gd2hhdCBjYW1lIGJlZm9yZSkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc1RlbXBsYXRlKG46IG51bWJlciwgc2VlZDogbnVtYmVyKTogVGVtcGxhdGUge1xuICBpZiAobiA8PSAyKSByZXR1cm4gV0FSTVVQO1xuICByZXR1cm4gVEVNUExBVEVTW01hdGguZmxvb3IobWFrZVJuZyhzZWVkICogNDA5OSArIG4gKiAzMSArIDUpLm5leHQoKSAqIFRFTVBMQVRFUy5sZW5ndGgpXTtcbn1cblxuLyoqIFRoZSBlbmVteSBhcm15IGZvciBlbmRsZXNzIHdhdmUgYG5gICgxLWJhc2VkKS4gQXQgbW9zdCAxMiB1bml0czsgdGhlIHdob2xlIGJ1ZGdldCBpcyBzcGVudCB1bmxlc3Mgbm8gdW5pdCBmaXRzIHdoYXQgaXMgbGVmdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzV2F2ZShuOiBudW1iZXIsIHNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBjb25zdCB3YXZlID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihuKSksIHJuZyA9IG1ha2VSbmcoc2VlZCAqIDEwMDkgKyB3YXZlICogNzkxOSArIDE3KSwgdHBsID0gZW5kbGVzc1RlbXBsYXRlKHdhdmUsIHNlZWQpO1xuICBsZXQgbGVmdCA9IGVuZGxlc3NCdWRnZXQod2F2ZSk7IGNvbnN0IGFybXk6IEVuZW15U3BlY1tdID0gW107XG4gIGlmICh3YXZlICUgMTAgPT09IDAgJiYgbGVmdCA+PSAyMCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hhbXBpb24gd2F2ZTogb25lIHN0YXJyZWQgYnJ1dGUgdXAgZnJvbnQgKDIgc3RhcnMsIDMgZnJvbSB3YXZlIDQwKSwgdGhlbiB0aGUgdXN1YWwgZXNjb3J0XG4gICAgY29uc3Qgc291bDogU291bElkID0gcm5nLm5leHQoKSA8IDAuNSA/ICdvZ3JlJyA6ICdrbmlnaHQnLCBzdGFyID0gd2F2ZSA+PSA0MCA/IDMgOiAyOyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICB9XG4gIGNvbnN0IHRvdGFsID0gdHBsLm1peC5yZWR1Y2UoKGEsIFssIHddKSA9PiBhICsgdywgMCk7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA4MCAmJiBhcm15Lmxlbmd0aCA8IE1BWF9VTklUUyAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBsZXQgciA9IHJuZy5uZXh0KCkgKiB0b3RhbCwgcm9sZTogUm9sZSA9IHRwbC5taXhbMF1bMF07XG4gICAgZm9yIChjb25zdCBbcm8sIHddIG9mIHRwbC5taXgpIHsgciAtPSB3OyBpZiAociA8PSAwKSB7IHJvbGUgPSBybzsgYnJlYWs7IH0gfVxuICAgIGxldCBvcHRpb25zID0gUk9MRVtyb2xlXS5maWx0ZXIoKHMpID0+IENPU1Rbc11bMF0gPD0gbGVmdCk7XG4gICAgaWYgKCFvcHRpb25zLmxlbmd0aCkgb3B0aW9ucyA9IFJPTEUuZm9kZGVyLmZpbHRlcigocykgPT4gQ09TVFtzXVswXSA8PSBsZWZ0KTtcbiAgICBpZiAoIW9wdGlvbnMubGVuZ3RoKSBicmVhaztcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2sob3B0aW9ucyksIHBlciA9IGxlZnQgLyBNYXRoLm1heCgxLCBNQVhfVU5JVFMgLSBhcm15Lmxlbmd0aCk7XG4gICAgbGV0IHN0YXIgPSAxOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzcGFyZSBidWRnZXQgcGVyIGZyZWUgc2xvdCBidXlzIHN0YXJzXG4gICAgZm9yIChsZXQgcyA9IDM7IHMgPj0gMjsgcy0tKSBpZiAoQ09TVFtzb3VsXVtzIC0gMV0gPD0gbGVmdCAmJiBDT1NUW3NvdWxdW3MgLSAxXSA8PSBNYXRoLm1heChDT1NUW3NvdWxdWzBdLCBwZXIgKiAxLjIpKSB7IHN0YXIgPSBzOyBicmVhazsgfVxuICAgIGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gIH1cbiAgcmV0dXJuIGFybXk7XG59XG4iLCAiLy8gRW5lbXkgd2F2ZXMgYW5kIHRoZSBjYW1wYWlnbidzIHN0YWdlcy4gU2FtZSB1bml0IHBvb2wgYXMgdGhlIHBsYXllci4gVGhlIGJ1aWxkIHNjcmVlbiBwcmV2aWV3cyB0aGUgQ09NUE9TSVRJT04gb25seSwgbmV2ZXIgcG9zaXRpb25zLlxuLy9cbi8vIEVhY2ggU1RBR0UgaGFzIGZvdXIgZGlmZmljdWx0eSB0aWVycyAoZWFzeSAvIG5vcm1hbCAvIGhhcmQgLyBuaWdodG1hcmUpLiBMYXRlciBzdGFnZXMgYXJlIGhhcmRlcjogdGhleSByZXVzZSB0b3VnaGVyIHdhdmUgbGlzdHMgYW5kIGEgaGlkZGVuXG4vLyBFTkVNWSBQT1dFUiBtdWx0aXBsaWVyIChoZWFsdGggYW5kIGRhbWFnZSBvZiBlbmVteSB1bml0cykgdHVuZWQgcGVyIHN0YWdlIGFuZCB0aWVyIHdpdGggc2ltL2NhbGlicmF0ZV9wb3dlci50cywgc28gdGhhdCB0aGUgY29tcGV0ZW50XG4vLyBzdGFuZC1pbiBwbGF5ZXIgY2xlYXJzIGVhY2ggdGllciBhYm91dCA2MCUgb2YgdGhlIHRpbWUgYXQgdGhhdCB0aWVyJ3MgUkVDT01NRU5ERUQgU09VTCBMRVZFTCAoZXZlcnkgU291bCBhdCB0aGF0IGxldmVsKS5cbi8vIFVubG9jayBydWxlcyBsaXZlIGluIHByb2dyZXNzLnRzOiBFYXN5IGFuZCBOb3JtYWwgYXJlIGFsd2F5cyBvcGVuOyBjbGVhcmluZyBOb3JtYWwgb3BlbnMgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2U7IGNsZWFyaW5nIEhhcmQgb3BlbnMgTmlnaHRtYXJlLlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMsIFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IEVORExFU1NfSUQsIGVuZGxlc3NQb3dlciwgZW5kbGVzc1dhdmUgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBFbmVteVNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5leHBvcnQgdHlwZSBEaWZmID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGUzogRGlmZltdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuXG5jb25zdCBMRVRURVI6IFJlY29yZDxzdHJpbmcsIFNvdWxJZD4gPSB7IFc6ICd3YXJyaW9yJywgQTogJ2FyY2hlcicsIEc6ICdnb2JsaW4nLCBLOiAna25pZ2h0JywgTzogJ29ncmUnLCBCOiAnYmFyYmFyaWFuJyB9O1xuY29uc3QgcGFyc2VXYXZlID0gKHM6IHN0cmluZyk6IEVuZW15U3BlY1tdID0+IHMuc3BsaXQoJyAnKS5tYXAoKHQpID0+ICh7IHNvdWw6IExFVFRFUlt0WzBdXSwgc3RhcjogK3RbMV0gfSkpO1xuXG4vKipcbiAqIFdhdmUgbGlzdHMgKFcgd2FycmlvciwgQSBhcmNoZXIsIEcgZ29ibGluLCBLIGtuaWdodCwgTyBvZ3JlLCBCIGJhcmJhcmlhbjsgZGlnaXQgPSBzdGFycykuIFRoZXNlIGZvdXIgd2VyZSB0dW5lZCBmb3IgU3RhZ2UgMTsgbGF0ZXIgc3RhZ2VzXG4gKiByZXVzZSB0aGVtIG9uZSB0aWVyIHVwIGFuZCBhZGQgZW5lbXkgcG93ZXIuIEhhcmQgYW5kIE5pZ2h0bWFyZSBhcmUgdm9sdW1lLWRyaXZlbiAodXAgdG8gMTIgZW5lbWllcykuXG4gKiBDb21wZXRlbnQgc3RhbmQtaW4gY2xlYXIgcmF0ZSB3aXRoIEVWRVJZIFNvdWwgYXQgbGV2ZWwgMSAvIDQgLyA2OiBlYXN5IDk4LzEwMC8xMDAsIG5vcm1hbCA4Mi85OC8xMDAsIGhhcmQgNy82MC84NywgbmlnaHRtYXJlIDAvMzMvNzQuXG4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEnLCAnSzEgVzEnLCAnTzEgVzEgRzEnLCAnSzEgQTEgVzEnLCAnTzEgQTEgRzEnLCAnSzEgTzEgQTEnLCAnSzEgTzEgQTEgRzEnLCAnTzEgSzEgQTEgRzEnLCAnTzEgSzEgQTEgQjEnLCAnTzIgSzEgQTEgRzEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExJywgJ0sxIEcxIFcxJywgJ08xIEExIEcxIFcxJywgJ0sxIE8xIEExIFcxJywgJ08xIEsxIEExIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxJywgJ0sxIE8xIEExIEcxIFcxJywgJ08xIEsxIEExIEIxIEcxJywgJ08xIEsxIEEyIEIxIEcxJywgJ08yIEsxIEExIEIxIEcxIFcxJ10sXG4gIGhhcmQ6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgQTEgRzEgVzEgVzEnLCAnSzEgTzEgQTEgVzEgRzEgVzEnLCAnTzEgSzEgQTIgRzEgVzEgVzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEgVzEgVzEnLCAnSzEgTzEgQTEgRzEgVzIgVzEgVzEnLCAnTzEgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzIgQTEgQjEgRzEgVzEgVzEgVzEgRzEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ08xIEExIEcxIFcxIEIxIFcxJywgJ0sxIE8xIEExIFcxIEcxIFcxIFcxJywgJ08xIEsxIEEyIEcxIFcxIEIxIFcxIFcxIEcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxIFcxIFcxIEcxIEcxJywgJ0sxIE8xIEEyIEcxIFcxIEIxIFcxIFcxIEcxIEcxIEIxJywgJ08xIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxJywgJ08yIEsxIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJywgJ08yIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJ10sXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFN0YWdlRGVmIHtcbiAgaWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBibHVyYjogc3RyaW5nO1xuICBsaXN0czogUmVjb3JkPERpZmYsIHN0cmluZ1tdPjsgICAgICAgICAgLy8gdGhlIDEwIGVuZW15IHdhdmVzIGZvciBlYWNoIHRpZXJcbiAgcG93ZXI6IFJlY29yZDxEaWZmLCBudW1iZXI+OyAgICAgICAgICAgIC8vIGhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIGVhY2ggdGllciAoMSA9IGFzIHdyaXR0ZW4pXG4gIHJlYzogUmVjb3JkPERpZmYsIG51bWJlcj47ICAgICAgICAgICAgICAvLyByZWNvbW1lbmRlZCBTb3VsIGxldmVsIGZvciBlYWNoIHRpZXIgKGEgaGludCBvbiBIb21lLCBuZXZlciBhIGxvY2spXG59XG5cbi8qKiBUaGUgY2FtcGFpZ24uIE5hbWVzIGFyZSBwbGFjZWhvbGRlcnMuIFBvd2VyIG51bWJlcnMgY29tZSBmcm9tIHNpbS9jYWxpYnJhdGVfcG93ZXIudHMuICovXG5leHBvcnQgY29uc3QgU1RBR0VTOiBTdGFnZURlZltdID0gW1xuICB7IGlkOiAnY3J5cHQnLCBuYW1lOiAnVGhlIFJlc3RsZXNzIENyeXB0JywgYmx1cmI6ICdSYWlzZSB5b3VyIGFybXkuIFRoZSBkZWFkIGhlcmUgYXJlIG9ubHkganVzdCBzdGlycmluZy4nLFxuICAgIGxpc3RzOiB7IGVhc3k6IERJRkZJQ1VMVFkuZWFzeSwgbm9ybWFsOiBESUZGSUNVTFRZLm5vcm1hbCwgaGFyZDogRElGRklDVUxUWS5oYXJkLCBuaWdodG1hcmU6IERJRkZJQ1VMVFkubmlnaHRtYXJlIH0sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLCBoYXJkOiAxLCBuaWdodG1hcmU6IDEgfSwgcmVjOiB7IGVhc3k6IDEsIG5vcm1hbDogMSwgaGFyZDogNCwgbmlnaHRtYXJlOiA2IH0gfSxcbiAgeyBpZDogJ2dyYXZleWFyZCcsIG5hbWU6ICdUaGUgU3Vua2VuIEdyYXZleWFyZCcsIGJsdXJiOiAnQmlnZ2VyIGNyb3dkcyBjcmF3bCBvdXQgb2YgdGhlIG11ZC4gTGV2ZWwgeW91ciBTb3VscyBiZWZvcmUgeW91IGNvbWUuJyxcbiAgICBsaXN0czogeyBlYXN5OiBESUZGSUNVTFRZLm5vcm1hbCwgbm9ybWFsOiBESUZGSUNVTFRZLmhhcmQsIGhhcmQ6IERJRkZJQ1VMVFkubmlnaHRtYXJlLCBuaWdodG1hcmU6IERJRkZJQ1VMVFkubmlnaHRtYXJlIH0sXG4gICAgcG93ZXI6IHsgZWFzeTogMS4wNSwgbm9ybWFsOiAxLCBoYXJkOiAxLjA1LCBuaWdodG1hcmU6IDEuMTUgfSwgcmVjOiB7IGVhc3k6IDIsIG5vcm1hbDogNCwgaGFyZDogNiwgbmlnaHRtYXJlOiA4IH0gfSxcbiAgeyBpZDogJ2Jhc3Rpb24nLCBuYW1lOiAnVGhlIEJvbmUgQmFzdGlvbicsIGJsdXJiOiAnQSBmb3J0cmVzcyBvZiB0aGUgZmFsbGVuLiBPbmx5IHdlbGwtbGV2ZWxsZWQgYXJtaWVzIGhvbGQgdGhlIGdhdGUuJyxcbiAgICBsaXN0czogeyBlYXN5OiBESUZGSUNVTFRZLmhhcmQsIG5vcm1hbDogRElGRklDVUxUWS5uaWdodG1hcmUsIGhhcmQ6IERJRkZJQ1VMVFkubmlnaHRtYXJlLCBuaWdodG1hcmU6IERJRkZJQ1VMVFkubmlnaHRtYXJlIH0sXG4gICAgcG93ZXI6IHsgZWFzeTogMC45LCBub3JtYWw6IDEuMDUsIGhhcmQ6IDEuMTUsIG5pZ2h0bWFyZTogMS4zIH0sIHJlYzogeyBlYXN5OiA0LCBub3JtYWw6IDYsIGhhcmQ6IDgsIG5pZ2h0bWFyZTogMTAgfSB9LFxuXTtcbmV4cG9ydCBjb25zdCBzdGFnZUluZGV4ID0gKGlkOiBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMCwgU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gaWQpKTtcbmV4cG9ydCBjb25zdCBzdGFnZUJ5SWQgPSAoaWQ6IHN0cmluZyk6IFN0YWdlRGVmID0+IFNUQUdFU1tzdGFnZUluZGV4KGlkKV07XG5cbi8qKiBOYW1lcyBhbmQgb25lLWxpbmUgcHJvbWlzZXMgZm9yIHRoZSBkaWZmaWN1bHR5IHBpY2tlci4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZX0lORk8gPSBbXG4gIHsgaWQ6ICdlYXN5JywgbGFiZWw6ICdFYXN5JywgYmx1cmI6ICdTbWFsbGVyIGVuZW15IGFybWllcy4gUmVsYXggYW5kIGxlYXJuIGhvdyBtZXJnaW5nIHdvcmtzLicgfSxcbiAgeyBpZDogJ25vcm1hbCcsIGxhYmVsOiAnTm9ybWFsJywgYmx1cmI6ICdUaGUgc3RhbmRhcmQgZmlnaHQuIENsZWFyaW5nIGl0IHVubG9ja3MgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2UuJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnQmlnZ2VyIGFybWllcyB3aXRoIG1vcmUgZm9kZGVyLiBCZXR0ZXIgZmlyc3QtY2xlYXIgcmV3YXJkcy4gQ2xlYXJpbmcgaXQgdW5sb2NrcyBOaWdodG1hcmUuJyB9LFxuICB7IGlkOiAnbmlnaHRtYXJlJywgbGFiZWw6ICdOaWdodG1hcmUnLCBibHVyYjogJ0EgcGFja2VkIGJhdHRsZWZpZWxkIG9mIHN0YXJzIGFuZCBza2lsbHMuIEJ1aWx0IGZvciB3ZWxsLWxldmVsbGVkIFNvdWxzLicgfSxcbl07XG5cbi8vIC0tLS0gd2hhdCB0aGUgbmV4dCBiYXR0bGUgdXNlcyAoc2V0IHdoZW4gYSBydW4gc3RhcnRzKVxuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZTogc3RyaW5nID0gJ25vcm1hbCc7XG5leHBvcnQgbGV0IGN1cnJlbnRTdGFnZUlkOiBzdHJpbmcgPSAnY3J5cHQnO1xubGV0IHBvd2VyID0gMSwgZW5kbGVzc01vZGUgPSBmYWxzZTtcbi8qKiBFbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyIChpbiBlbmRsZXNzIG1vZGUgaXQgZGVwZW5kcyBvbiB0aGUgd2F2ZSkuICovXG5leHBvcnQgY29uc3QgZW5lbXlQb3dlciA9ICh3YXZlID0gMSk6IG51bWJlciA9PiAoZW5kbGVzc01vZGUgPyBlbmRsZXNzUG93ZXIod2F2ZSkgOiBwb3dlcik7XG5leHBvcnQgY29uc3QgaXNFbmRsZXNzID0gKCk6IGJvb2xlYW4gPT4gZW5kbGVzc01vZGU7XG5cbi8qKiBIYW5kLWF1dGhvcmVkIHdhdmVzIGZvciB0aGUgY3VycmVudCBzdGFnZSBhbmQgdGllciAoMTAgd2F2ZXMpLiBFZGl0ZWQgaW4gcGxhY2UgYnkgc2V0U3RhZ2VEaWZmaWN1bHR5LiAqL1xuZXhwb3J0IGNvbnN0IEFVVEhPUkVEOiBFbmVteVNwZWNbXVtdID0gRElGRklDVUxUWS5ub3JtYWwubWFwKHBhcnNlV2F2ZSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRTdGFnZURpZmZpY3VsdHkoc3RhZ2U6IHN0cmluZywgbmFtZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHN0ID0gc3RhZ2VCeUlkKHN0YWdlKTsgaWYgKCFESUZGUy5pbmNsdWRlcyhuYW1lIGFzIERpZmYpKSByZXR1cm47XG4gIGVuZGxlc3NNb2RlID0gZmFsc2U7IGN1cnJlbnRTdGFnZUlkID0gc3QuaWQ7IGRpZmZpY3VsdHlOYW1lID0gbmFtZTsgcG93ZXIgPSBzdC5wb3dlcltuYW1lIGFzIERpZmZdO1xuICBBVVRIT1JFRC5sZW5ndGggPSAwOyBzdC5saXN0c1tuYW1lIGFzIERpZmZdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG4vKiogU3dpdGNoIHRvIEVuZGxlc3MgRGVwdGhzOiB3YXZlcyBjb21lIGZyb20gY29yZS9lbmRsZXNzLnRzIGluc3RlYWQgb2YgYSBzdGFnZSBsaXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldEVuZGxlc3MoKTogdm9pZCB7IGVuZGxlc3NNb2RlID0gdHJ1ZTsgY3VycmVudFN0YWdlSWQgPSBFTkRMRVNTX0lEOyBkaWZmaWN1bHR5TmFtZSA9ICdlbmRsZXNzJzsgcG93ZXIgPSAxOyBBVVRIT1JFRC5sZW5ndGggPSAwOyB9XG4vKiogQ2hhbmdlIHRoZSB0aWVyIHdpdGhpbiB0aGUgY3VycmVudCBzdGFnZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXREaWZmaWN1bHR5KG5hbWU6IHN0cmluZyk6IHZvaWQgeyBzZXRTdGFnZURpZmZpY3VsdHkoY3VycmVudFN0YWdlSWQsIG5hbWUpOyB9XG5cbmV4cG9ydCBjb25zdCB3YXZlQ29zdCA9ICh3OiBFbmVteVNwZWNbXSk6IG51bWJlciA9PiB3LnJlZHVjZSgobiwgZSkgPT4gbiArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXSwgMCk7XG5cbi8qKiBFbmVteSBhcm15IGZvciBhIHdhdmUgKDEtYmFzZWQpLiBXYXZlcyBwYXN0IHRoZSBhdXRob3JlZCBvbmVzIGFyZSBnZW5lcmF0ZWQgZnJvbSBhIGZpeGVkIHNlZWQgc28gcmV0cmllcyBmYWNlIHRoZSBzYW1lIGFybXkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlXYXZlKHdhdmU6IG51bWJlciwgc3RhZ2VTZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgaWYgKGVuZGxlc3NNb2RlKSByZXR1cm4gZW5kbGVzc1dhdmUod2F2ZSwgc3RhZ2VTZWVkKTtcbiAgaWYgKHdhdmUgPD0gQVVUSE9SRUQubGVuZ3RoKSByZXR1cm4gQVVUSE9SRURbd2F2ZSAtIDFdLm1hcCgoZSkgPT4gKHsgLi4uZSB9KSk7XG4gIGNvbnN0IGNhcCA9IENVUlZFUy5kb2NbTWF0aC5taW4od2F2ZSwgQ1VSVkVTLmRvYy5sZW5ndGgpIC0gMV07XG4gIGNvbnN0IGJ1ZGdldCA9IE1hdGgucm91bmQoY2FwICogMC45Mik7XG4gIGNvbnN0IHJuZyA9IG1ha2VSbmcoc3RhZ2VTZWVkICogMTAwOSArIHdhdmUgKiA3OTE5KTtcbiAgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA0MCAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2soU09VTFMpO1xuICAgIGxldCBzdGFyID0gMTtcbiAgICBpZiAocm5nLm5leHQoKSA8IDAuMzUgJiYgQ09TVFtzb3VsXVsxXSA8PSBsZWZ0KSBzdGFyID0gMjtcbiAgICBpZiAod2F2ZSA+PSA2ICYmIHJuZy5uZXh0KCkgPCAwLjI1ICYmIENPU1Rbc291bF1bMl0gPD0gbGVmdCkgc3RhciA9IDM7XG4gICAgY29uc3QgYyA9IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICAgIGlmIChjIDw9IGxlZnQgJiYgYXJteS5sZW5ndGggPCAxMikgeyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IGM7IH1cbiAgfVxuICByZXR1cm4gYXJteTtcbn1cblxuLyoqIFdoYXQgdGhlIGJ1aWxkIHNjcmVlbiBzaG93czogY291bnRzIHBlciBTb3VsIGFuZCBzdGFyLCBubyBwb3NpdGlvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcHJldmlld1RleHQodzogRW5lbXlTcGVjW10pOiB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH1bXSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXA8c3RyaW5nLCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyIH0+KCk7XG4gIGZvciAoY29uc3QgZSBvZiB3KSB7XG4gICAgY29uc3QgayA9IGUuc291bCArIGUuc3RhcjtcbiAgICBjb25zdCBjdXIgPSBtYXAuZ2V0KGspO1xuICAgIGlmIChjdXIpIGN1ci5jb3VudCsrOyBlbHNlIG1hcC5zZXQoaywgeyBzb3VsOiBlLnNvdWwsIHN0YXI6IGUuc3RhciwgY291bnQ6IDEgfSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldO1xufVxuIiwgImltcG9ydCB7IENVUlZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuLyoqXG4gKiBSdWxlcyBmb3IgdGhlIHBsYXlhYmxlIFN0YWdlIDEgKDEwIHdhdmVzKTogZG9jIERvbWluaW9uIGN1cnZlLCBib251cyBkcmF3IG9ubHkgb24gdGhlIGVhcmx5IHdhdmVzLlxuICogbWVyZ2UgJ2hhbmRJbnRvT25lU3Rhcic6IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gbWVyZ2Ugc3RyYWlnaHQgaW50byBhIG1hdGNoaW5nIGRlcGxveWVkIDEtc3RhciB1bml0IChwYXlpbmcgb25seSB0aGUgY29zdFxuICogZGlmZmVyZW5jZSkuIFdpdGhvdXQgaXQgdGhlIGNhcCBjYW4gYmxvY2sgYSBtZXJnZSB5b3UgY291bGQgYWZmb3JkICh5b3Ugd291bGQgbmVlZCByb29tIHRvIHN1bW1vbiBCT1RIIGNvcGllcyBmaXJzdCkuXG4gKiBUaGUgZGVidWcgcGFuZWwgY2FuIHN3aXRjaCB0aGlzIGJhY2sgdG8gdGhlIGRvYydzIGRlcGxveWVkLW9ubHkgcnVsZS5cbiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPVFlQRV9SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBDVVJWRVMuZG9jLCBtZXJnZTogJ2hhbmRJbnRvT25lU3RhcicsIHN0YWdlV2F2ZXM6IDEwLCBub3JtYWxEcmF3V2F2ZXM6IFsyLCAzLCA0LCA1XSB9O1xuXG4vKipcbiAqIEVuZGxlc3MgRGVwdGhzOiB0aGUgY2FtcGFpZ24ncyBEb21pbmlvbiBjdXJ2ZSBmb3Igd2F2ZXMgMS0xMCwgdGhlbiBoZWxkIGF0IDQwICh0aGUgcGxheWVyJ3MgYXJteSBpcyBjYXBwZWQgb24gcHVycG9zZTsgdGhlIGVuZW15IGtlZXBzIGdyb3dpbmcsIHNlZSBlbmRsZXNzLnRzKS5cbiAqIFRoZSBjdXJ2ZSBpcyBsb25nIGVub3VnaCB0aGF0IGEgcnVuIGVuZHMgYnkgbG9zaW5nIGhlYXJ0cywgbmV2ZXIgYnkgXCJjbGVhcmluZ1wiIHRoZSBzdGFnZSAoY29yZS9ydWxlcy50cyByZWFkcyBjdXJ2ZVt3YXZlLTFdKS5cbiAqL1xuY29uc3QgRU5ETEVTU19MRU4gPSAzMDA7XG5leHBvcnQgY29uc3QgRU5ETEVTU19SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBBcnJheS5mcm9tKHsgbGVuZ3RoOiBFTkRMRVNTX0xFTiB9LCAoXywgaSkgPT4gQ1VSVkVTLmRvY1tNYXRoLm1pbihpLCBDVVJWRVMuZG9jLmxlbmd0aCAtIDEpXSksIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogRU5ETEVTU19MRU4sIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG4iLCAiLy8gU291bCBQYWNrcyAocGxhbiBkb2Mgc2VjdGlvbiAxNykuIFB1cmUgcnVsZXMsIG5vIGdyYXBoaWNzLiBBTEwgTlVNQkVSUyBBUkUgUExBQ0VIT0xERVIgTEVWRVJTOiB3ZSBzZXR0bGVkIHRoZSBzdHJ1Y3R1cmUgZmlyc3QgYW5kIHdpbGwgdHVuZVxuLy8gcXVhbnRpdGllcyB3aXRoIHRoZSBwcm9ncmVzc2lvbiBzaW11bGF0aW9uIChzaW0vcHJvZ3Jlc3Npb24udHMpIG9uY2UgdGhlIGxvb3AgY2FuIGJlIHBsYXllZC5cbi8vXG4vLyAgIFNvdWwgcmFyaXR5ICAtPiBob3cgb2Z0ZW4gYSBTb3VsIHNob3dzIHVwIGFuZCBob3cgYmlnIGl0cyBzdGFjayBvZiBjb3BpZXMgdGVuZHMgdG8gYmUuXG4vLyAgIFBhY2sgdGllciAgICAtPiB0aGUgcGFjaydzIG92ZXJhbGwgdmFsdWUgKHNrdWxscywgMS0zIGZvciBub3cpOiBudW1iZXIgb2YgcmV2ZWFscyArIGhvdyBnb29kIHRoZSByYXJpdHkgb2RkcyBhcmUuXG4vLyAgIEEgcGFjayBoYXMgYSBTVEFSVElORyB0aWVyIGFuZCBtYXkgdXBncmFkZSB3aGlsZSBpdCBpcyBiZWluZyBvcGVuZWQ7IHRoZSByZXN1bHQgaXMgZGVjaWRlZCB1cCBmcm9udCwgdGhlIGFuaW1hdGlvbiBvbmx5IHNob3dzIGl0LlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IHR5cGUgUmFyaXR5ID0gJ2NvbW1vbicgfCAncmFyZScgfCAnZXBpYycgfCAnbGVnZW5kYXJ5JztcbmV4cG9ydCBjb25zdCBSQVJJVElFUzogUmFyaXR5W10gPSBbJ2NvbW1vbicsICdyYXJlJywgJ2VwaWMnLCAnbGVnZW5kYXJ5J107XG5leHBvcnQgY29uc3QgUkFSSVRZX05BTUU6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJ0NvbW1vbicsIHJhcmU6ICdSYXJlJywgZXBpYzogJ0VwaWMnLCBsZWdlbmRhcnk6ICdMZWdlbmRhcnknIH07XG5cbi8qKiBSYXJpdHkgcGVyIFNvdWwuIFBMQUNFSE9MREVSIGFzc2lnbm1lbnQgKG5vIExlZ2VuZGFyeSBTb3VsIGV4aXN0cyB5ZXQpLiAqL1xuZXhwb3J0IGNvbnN0IFJBUklUWV9PRjogUmVjb3JkPFNvdWxJZCwgUmFyaXR5PiA9IHsgd2FycmlvcjogJ2NvbW1vbicsIGdvYmxpbjogJ2NvbW1vbicsIGFyY2hlcjogJ3JhcmUnLCBrbmlnaHQ6ICdyYXJlJywgb2dyZTogJ2VwaWMnLCBiYXJiYXJpYW46ICdlcGljJyB9O1xuXG4vKiogUmFyZXIgU291bHMgdHVybiB1cCBpbiBzbWFsbGVyIHN0YWNrcywgc28gdGhleSBuZWVkIGZld2VyIGNvcGllcyBwZXIgbGV2ZWwgKG11bHRpcGxpZXIgb24gdGhlIGxldmVsIGNvc3RzKS4gUExBQ0VIT0xERVIuICovXG5leHBvcnQgY29uc3QgTEVWRUxfQ09TVF9NVUxUOiBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+ID0geyBjb21tb246IDEsIHJhcmU6IDAuNiwgZXBpYzogMC4zNSwgbGVnZW5kYXJ5OiAwLjIgfTtcblxuZXhwb3J0IGNvbnN0IFBBQ0tfVElFUlMgPSAzO1xuZXhwb3J0IGNvbnN0IFBBQ0sgPSB7XG4gIHJldmVhbHM6IFszLCA0LCA1XSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNlcGFyYXRlIHJldmVhbHMgcGVyIHRpZXIgKGluZGV4IDAgPSB0aWVyIDEpXG4gIHN0YWNrTXVsdDogWzEsIDEuNSwgMl0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvcHkgc3RhY2tzIGFyZSBiaWdnZXIgaW4gYmV0dGVyIHBhY2tzXG4gIC8qKiBSYXJpdHkgb2RkcyBwZXIgdGllciwgaW4gcGVyY2VudC4gKi9cbiAgb2RkczogW1xuICAgIHsgY29tbW9uOiA3MCwgcmFyZTogMjUsIGVwaWM6IDUsIGxlZ2VuZGFyeTogMCB9LFxuICAgIHsgY29tbW9uOiA1NSwgcmFyZTogMzMsIGVwaWM6IDExLCBsZWdlbmRhcnk6IDEgfSxcbiAgICB7IGNvbW1vbjogNDAsIHJhcmU6IDM4LCBlcGljOiAxOSwgbGVnZW5kYXJ5OiAzIH0sXG4gIF0gYXMgUmVjb3JkPFJhcml0eSwgbnVtYmVyPltdLFxuICAvKiogQ29waWVzIGluIG9uZSByZXZlYWwgYmVmb3JlIHRoZSB0aWVyIG11bHRpcGxpZXI6IFttaW4sIG1heF0uICovXG4gIHN0YWNrOiB7IGNvbW1vbjogWzYsIDEwXSwgcmFyZTogWzMsIDVdLCBlcGljOiBbMSwgM10sIGxlZ2VuZGFyeTogWzEsIDFdIH0gYXMgUmVjb3JkPFJhcml0eSwgW251bWJlciwgbnVtYmVyXT4sXG4gIC8qKiBDaGFuY2UgdG8ganVtcCB1cCBvbmUgdGllciBkdXJpbmcgdGhlIG9wZW5pbmcsIGZyb20gdGllciAxIGFuZCBmcm9tIHRpZXIgMiAoYSBsdWNreSBwYWNrIGNhbiBqdW1wIHR3aWNlKS4gKi9cbiAgdXBncmFkZUNoYW5jZTogWzAuMiwgMC4xMl0sXG59O1xuXG4vKiogQW4gdW5vcGVuZWQgcGFjayB0aGUgcGxheWVyIG93bnMuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhY2tJdGVtIHsgaWQ6IG51bWJlcjsgdGllcjogbnVtYmVyOyBzb3VyY2U6IHN0cmluZyB9XG5leHBvcnQgaW50ZXJmYWNlIFJldmVhbCB7IHNvdWw6IFNvdWxJZDsgcmFyaXR5OiBSYXJpdHk7IGNvcGllczogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgUGFja1Jlc3VsdCB7IHN0YXJ0VGllcjogbnVtYmVyOyBmaW5hbFRpZXI6IG51bWJlcjsgdXBncmFkZXM6IG51bWJlcltdOyByZXZlYWxzOiBSZXZlYWxbXSB9XG5cbmNvbnN0IHJhcml0eVJhbmsgPSAocjogUmFyaXR5KSA9PiBSQVJJVElFUy5pbmRleE9mKHIpO1xuXG5mdW5jdGlvbiByb2xsUmFyaXR5KHRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBSYXJpdHkge1xuICBjb25zdCBvZGRzID0gUEFDSy5vZGRzW3RpZXIgLSAxXTsgbGV0IHJvbGwgPSBybmcubmV4dCgpICogUkFSSVRJRVMucmVkdWNlKChuLCByKSA9PiBuICsgb2Rkc1tyXSwgMCk7XG4gIGZvciAoY29uc3QgciBvZiBSQVJJVElFUykgeyBpZiAocm9sbCA8IG9kZHNbcl0pIHJldHVybiByOyByb2xsIC09IG9kZHNbcl07IH1cbiAgcmV0dXJuICdjb21tb24nO1xufVxuXG4vKiogQSByYW5kb20gU291bCBvZiB0aGlzIHJhcml0eTsgaWYgdGhlIHJvc3RlciBoYXMgbm9uZSBvZiB0aGF0IHJhcml0eSB5ZXQsIHRoZSBuZXh0IGxvd2VyIG9uZSBpcyB1c2VkLiAqL1xuZnVuY3Rpb24gc291bE9mUmFyaXR5KHJhcml0eTogUmFyaXR5LCBybmc6IFJuZyk6IFNvdWxJZCB7XG4gIGZvciAobGV0IGkgPSByYXJpdHlSYW5rKHJhcml0eSk7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHBvb2wgPSBTT1VMUy5maWx0ZXIoKHMpID0+IFJBUklUWV9PRltzXSA9PT0gUkFSSVRJRVNbaV0pOyBpZiAocG9vbC5sZW5ndGgpIHJldHVybiBybmcucGljayhwb29sKTsgfVxuICByZXR1cm4gcm5nLnBpY2soU09VTFMpO1xufVxuXG4vKiogT3BlbiBhIHBhY2s6IHJvbGwgdXBncmFkZXMgZmlyc3QgKHNvIHRoZSBhbmltYXRpb24gY2FuIHBsYXkgdGhlbSBiZWZvcmUgdGhlIHBhY2sgdGVhcnMgb3BlbiksIHRoZW4gdGhlIHJldmVhbHMuIEJlc3QgcmV2ZWFsIGNvbWVzIGxhc3QuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblBhY2soc3RhcnRUaWVyOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB7XG4gIGNvbnN0IHQwID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcihzdGFydFRpZXIpKSksIHVwZ3JhZGVzOiBudW1iZXJbXSA9IFtdO1xuICBsZXQgdGllciA9IHQwO1xuICB3aGlsZSAodGllciA8IFBBQ0tfVElFUlMgJiYgcm5nLm5leHQoKSA8IFBBQ0sudXBncmFkZUNoYW5jZVt0aWVyIC0gMV0pIHsgdGllcisrOyB1cGdyYWRlcy5wdXNoKHRpZXIpOyB9XG4gIGNvbnN0IHJldmVhbHM6IFJldmVhbFtdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgUEFDSy5yZXZlYWxzW3RpZXIgLSAxXTsgaSsrKSB7XG4gICAgY29uc3QgcmFyaXR5ID0gcm9sbFJhcml0eSh0aWVyLCBybmcpLCBzb3VsID0gc291bE9mUmFyaXR5KHJhcml0eSwgcm5nKSwgW2xvLCBoaV0gPSBQQUNLLnN0YWNrW1JBUklUWV9PRltzb3VsXV07XG4gICAgcmV2ZWFscy5wdXNoKHsgc291bCwgcmFyaXR5OiBSQVJJVFlfT0Zbc291bF0sIGNvcGllczogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgobG8gKyBybmcuaW50KGhpIC0gbG8gKyAxKSkgKiBQQUNLLnN0YWNrTXVsdFt0aWVyIC0gMV0pKSB9KTtcbiAgfVxuICByZXZlYWxzLnNvcnQoKGEsIGIpID0+IHJhcml0eVJhbmsoYS5yYXJpdHkpIC0gcmFyaXR5UmFuayhiLnJhcml0eSkgfHwgYS5jb3BpZXMgLSBiLmNvcGllcyk7XG4gIHJldHVybiB7IHN0YXJ0VGllcjogdDAsIGZpbmFsVGllcjogdGllciwgdXBncmFkZXMsIHJldmVhbHMgfTtcbn1cblxuLyoqIFRvdGFsIGNvcGllcyBwZXIgU291bCBpbiBhIHJlc3VsdCAodGhlIHNhbWUgU291bCBjYW4gYmUgcmV2ZWFsZWQgbW9yZSB0aGFuIG9uY2UpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvcGllc0J5U291bChyZXN1bHQ6IFBhY2tSZXN1bHQpOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+IHtcbiAgY29uc3Qgb3V0OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+ID0ge307XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgb3V0W3Iuc291bF0gPSAob3V0W3Iuc291bF0gPz8gMCkgKyByLmNvcGllcztcbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3Mgc2F2ZWQgcHJvZ3Jlc3MuIEZyYW1ld29yay1mcmVlIHNvIHRoZSBnYW1lIGJ1bmRsZSBhbmQgdGhlIG5hdmlnYXRpb24gc2hlbGwgYm90aCB1c2UgaXQuXG4vLyBTdG9yZWQgaW4gbG9jYWxTdG9yYWdlIGFzIEpTT04uIEV2ZXJ5IHJlYWQvd3JpdGUgaXMgZ3VhcmRlZDogcHJpdmF0ZSB3aW5kb3dzIGFuZCBibG9ja2VkIHN0b3JhZ2UgbXVzdCBuZXZlciBicmVhayB0aGUgZ2FtZS5cblxuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUEFDS19USUVSUyB9IGZyb20gJy4vcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBQYWNrSXRlbSB9IGZyb20gJy4vcGFja3MudHMnO1xuXG5leHBvcnQgY29uc3QgREVDS19TSVpFID0gNjsgICAgICAgICAgICAgICAgICAgICAvLyBkb2M6IHNpeCBlcXVpcHBlZCBTb3VscyBwZXIgc3RhZ2VcbmNvbnN0IEtFWSA9ICduZWNyby1zYXZlJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgdHlwZSBEaWZmaWN1bHR5ID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGSUNVTFRJRVM6IERpZmZpY3VsdHlbXSA9IFsnZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXTtcbmV4cG9ydCBpbnRlcmZhY2UgU2V0dGluZ3MgeyBtdXNpYzogYm9vbGVhbjsgc2Z4OiBib29sZWFuIH1cbmV4cG9ydCBpbnRlcmZhY2UgU291bFByb2dyZXNzIHsgbGV2ZWw6IG51bWJlcjsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTYXZlIHtcbiAgdjogbnVtYmVyO1xuICBkZWNrOiBTb3VsSWRbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXF1aXBwZWQgU291bHMsIGF0IG1vc3QgREVDS19TSVpFLCBhdCBsZWFzdCAxXG4gIHNvdWxzOiBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+OyAgICAgICAgICAvLyBQTEFDRUhPTERFUiBwcm9ncmVzc2lvbiB1bnRpbCBwYWNrcyBleGlzdFxuICBzZXR0aW5nczogU2V0dGluZ3M7ICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc291bmQgc3dpdGNoZXM7IGJvdGggb24gYnkgZGVmYXVsdFxuICBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5OyAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hvc2VuIG9uIEhvbWU7IGFwcGxpZXMgdG8gdGhlIG5leHQgcnVuXG4gIHN0YWdlOiBzdHJpbmc7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgc3RhZ2UgcGlja2VkIG9uIEhvbWUgKGlkIGZyb20gd2F2ZXMudHMgU1RBR0VTKVxuICBzZWVuOiBzdHJpbmdbXSB8IG51bGw7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5sb2NrIGtleXMgd2hvc2UgY2VsZWJyYXRpb24gd2FzIGFscmVhZHkgc2hvd24gKG51bGw6IG9sZGVyIHNhdmUsIHNlZWRlZCBvbiBmaXJzdCBsb29rKVxuICBwYWNrczogUGFja0l0ZW1bXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5vcGVuZWQgU291bCBQYWNrc1xuICBuZXh0UGFja0lkOiBudW1iZXI7XG4gIGNsZWFyczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjsgICAgICAgICAgICAgICAvLyBzdGFnZSBjbGVhcnMsIGtleWVkICdzdGFnZTpkaWZmaWN1bHR5J1xuICByZXBsYXlNZXRlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwbGF5IGNsZWFycyB0b3dhcmQgdGhlIG5leHQgcmVwbGF5IHBhY2tcbiAgZW5kbGVzczogeyBiZXN0OiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgIC8vIEVuZGxlc3MgRGVwdGhzOiB0aGUgZGVlcGVzdCB3YXZlIGNsZWFyZWRcbn1cbmV4cG9ydCBpbnRlcmZhY2UgU3RvcmUgeyBnZXRJdGVtKGs6IHN0cmluZyk6IHN0cmluZyB8IG51bGw7IHNldEl0ZW0oazogc3RyaW5nLCB2OiBzdHJpbmcpOiB2b2lkIH1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRTYXZlKCk6IFNhdmUge1xuICBjb25zdCBzb3VscyA9IHt9IGFzIFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47XG4gIGZvciAoY29uc3QgaWQgb2YgU09VTFMpIHNvdWxzW2lkXSA9IHsgbGV2ZWw6IDEsIGNvcGllczogMCB9O1xuICByZXR1cm4geyB2OiBWRVJTSU9OLCBkZWNrOiBTT1VMUy5zbGljZSgwLCBERUNLX1NJWkUpLCBzb3Vscywgc2V0dGluZ3M6IHsgbXVzaWM6IHRydWUsIHNmeDogdHJ1ZSB9LCBkaWZmaWN1bHR5OiAnbm9ybWFsJywgc3RhZ2U6ICdjcnlwdCcsIHNlZW46IFtdLCBwYWNrczogW10sIG5leHRQYWNrSWQ6IDEsIGNsZWFyczoge30sIHJlcGxheU1ldGVyOiAwLCBlbmRsZXNzOiB7IGJlc3Q6IDAgfSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnJvd3NlclN0b3JlKCk6IFN0b3JlIHwgbnVsbCB7IHRyeSB7IHJldHVybiB0eXBlb2YgbG9jYWxTdG9yYWdlID09PSAndW5kZWZpbmVkJyA/IG51bGwgOiBsb2NhbFN0b3JhZ2U7IH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfSB9XG5cbi8qKiBSZXBhaXIgd2hhdGV2ZXIgd2FzIHN0b3JlZDogdW5rbm93biBTb3VscyBkcm9wcGVkLCBkdXBsaWNhdGVzIHJlbW92ZWQsIGRlY2sgY2FwcGVkLCBub3RoaW5nIGVtcHR5LiBPbGQgdmVyc2lvbnMga2VlcCB0aGVpciBwcm9ncmVzcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZShyYXc6IGFueSk6IFNhdmUge1xuICBjb25zdCBiYXNlID0gZGVmYXVsdFNhdmUoKTtcbiAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gJ29iamVjdCcpIHJldHVybiBiYXNlO1xuICBjb25zdCBkZWNrOiBTb3VsSWRbXSA9IFtdO1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcuZGVjaykpIGZvciAoY29uc3QgZCBvZiByYXcuZGVjaykgaWYgKFNPVUxTLmluY2x1ZGVzKGQpICYmICFkZWNrLmluY2x1ZGVzKGQpICYmIGRlY2subGVuZ3RoIDwgREVDS19TSVpFKSBkZWNrLnB1c2goZCk7XG4gIGlmIChkZWNrLmxlbmd0aCkgYmFzZS5kZWNrID0gZGVjaztcbiAgaWYgKHJhdy5zb3VscyAmJiB0eXBlb2YgcmF3LnNvdWxzID09PSAnb2JqZWN0Jykge1xuICAgIGZvciAoY29uc3QgaWQgb2YgU09VTFMpIHtcbiAgICAgIGNvbnN0IHAgPSByYXcuc291bHNbaWRdO1xuICAgICAgaWYgKHAgJiYgTnVtYmVyLmlzRmluaXRlKHAubGV2ZWwpICYmIE51bWJlci5pc0Zpbml0ZShwLmNvcGllcykpIGJhc2Uuc291bHNbaWRdID0geyBsZXZlbDogTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihwLmxldmVsKSksIGNvcGllczogTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihwLmNvcGllcykpIH07XG4gICAgfVxuICB9XG4gIGlmIChyYXcuc2V0dGluZ3MgJiYgdHlwZW9mIHJhdy5zZXR0aW5ncyA9PT0gJ29iamVjdCcpIHtcbiAgICBpZiAodHlwZW9mIHJhdy5zZXR0aW5ncy5tdXNpYyA9PT0gJ2Jvb2xlYW4nKSBiYXNlLnNldHRpbmdzLm11c2ljID0gcmF3LnNldHRpbmdzLm11c2ljO1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLnNmeCA9PT0gJ2Jvb2xlYW4nKSBiYXNlLnNldHRpbmdzLnNmeCA9IHJhdy5zZXR0aW5ncy5zZng7XG4gIH1cbiAgaWYgKERJRkZJQ1VMVElFUy5pbmNsdWRlcyhyYXcuZGlmZmljdWx0eSkpIGJhc2UuZGlmZmljdWx0eSA9IHJhdy5kaWZmaWN1bHR5O1xuICBpZiAodHlwZW9mIHJhdy5zdGFnZSA9PT0gJ3N0cmluZycgJiYgL15bYS16MC05Xy1dezEsMjR9JC8udGVzdChyYXcuc3RhZ2UpKSBiYXNlLnN0YWdlID0gcmF3LnN0YWdlO1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcuc2VlbikpIGJhc2Uuc2VlbiA9IHJhdy5zZWVuLmZpbHRlcigoazogYW55KSA9PiB0eXBlb2YgayA9PT0gJ3N0cmluZycgJiYgay5sZW5ndGggPCA0MCkuc2xpY2UoLTgwKTtcbiAgZWxzZSBpZiAocmF3LmNsZWFycyAmJiB0eXBlb2YgcmF3LmNsZWFycyA9PT0gJ29iamVjdCcgJiYgT2JqZWN0LmtleXMocmF3LmNsZWFycykubGVuZ3RoKSBiYXNlLnNlZW4gPSBudWxsOyAgICAvLyBhbiBleGlzdGluZyBwbGF5ZXI6IGRvIG5vdCByZXBsYXkgb2xkIHVubG9ja3NcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LnBhY2tzKSkge1xuICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICAgIGZvciAoY29uc3QgcCBvZiByYXcucGFja3MpIHtcbiAgICAgIGlmIChiYXNlLnBhY2tzLmxlbmd0aCA+PSA5OSB8fCAhcCB8fCAhTnVtYmVyLmlzSW50ZWdlcihwLmlkKSB8fCBwLmlkIDwgMSB8fCBpZHMuaGFzKHAuaWQpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHAudGllcikgfHwgcC50aWVyIDwgMSB8fCBwLnRpZXIgPiBQQUNLX1RJRVJTKSBjb250aW51ZTtcbiAgICAgIGlkcy5hZGQocC5pZCk7IGJhc2UucGFja3MucHVzaCh7IGlkOiBwLmlkLCB0aWVyOiBwLnRpZXIsIHNvdXJjZTogdHlwZW9mIHAuc291cmNlID09PSAnc3RyaW5nJyA/IHAuc291cmNlLnNsaWNlKDAsIDQwKSA6ICcnIH0pO1xuICAgIH1cbiAgfVxuICBjb25zdCBtYXhJZCA9IGJhc2UucGFja3MucmVkdWNlKChuLCBwKSA9PiBNYXRoLm1heChuLCBwLmlkKSwgMCk7XG4gIGJhc2UubmV4dFBhY2tJZCA9IE1hdGgubWF4KG1heElkICsgMSwgTnVtYmVyLmlzSW50ZWdlcihyYXcubmV4dFBhY2tJZCkgJiYgcmF3Lm5leHRQYWNrSWQgPiAwID8gcmF3Lm5leHRQYWNrSWQgOiAxKTtcbiAgaWYgKHJhdy5jbGVhcnMgJiYgdHlwZW9mIHJhdy5jbGVhcnMgPT09ICdvYmplY3QnKSBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhyYXcuY2xlYXJzKSkgaWYgKHR5cGVvZiBrID09PSAnc3RyaW5nJyAmJiBrLmxlbmd0aCA8IDQwICYmIE51bWJlci5pc0ludGVnZXIodikgJiYgKHYgYXMgbnVtYmVyKSA+IDApIGJhc2UuY2xlYXJzW2tdID0gdiBhcyBudW1iZXI7XG4gIGlmIChOdW1iZXIuaXNJbnRlZ2VyKHJhdy5yZXBsYXlNZXRlcikgJiYgcmF3LnJlcGxheU1ldGVyID49IDAgJiYgcmF3LnJlcGxheU1ldGVyIDwgNTApIGJhc2UucmVwbGF5TWV0ZXIgPSByYXcucmVwbGF5TWV0ZXI7XG4gIGlmIChyYXcuZW5kbGVzcyAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5lbmRsZXNzLmJlc3QpICYmIHJhdy5lbmRsZXNzLmJlc3QgPj0gMCAmJiByYXcuZW5kbGVzcy5iZXN0IDw9IDk5OTkpIGJhc2UuZW5kbGVzcy5iZXN0ID0gcmF3LmVuZGxlc3MuYmVzdDtcbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cblxuLyoqIENoYW5nZSBzb3VuZCBzZXR0aW5ncyB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzKHBhdGNoOiBQYXJ0aWFsPFNldHRpbmdzPiwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2V0dGluZ3Mge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLnNldHRpbmdzID0geyAuLi5zLnNldHRpbmdzLCAuLi5wYXRjaCB9OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5zZXR0aW5ncztcbn1cblxuLyoqIFJlbWVtYmVyIHRoZSBjaG9zZW4gZGlmZmljdWx0eSB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZURpZmZpY3VsdHkoZDogRGlmZmljdWx0eSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogRGlmZmljdWx0eSB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuZGlmZmljdWx0eSA9IERJRkZJQ1VMVElFUy5pbmNsdWRlcyhkKSA/IGQgOiBzLmRpZmZpY3VsdHk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLmRpZmZpY3VsdHk7XG59XG4iLCAiLy8gVGhlIHBsYXllcidzIGNoYXJhY3RlcjogdGhlIE5lY3JvbWFuY2VyIChhIHJpZ2dlZCBUcmlwbyBtb2RlbCwgUGlwZWxpbmUvdW5pdHMvbmVjcm9tYW5jZXIuanNvbikuXG4vLyBIZSBzdGFuZHMgYmVzaWRlIHRoZSBncmlkLCB0YWtlcyB0aGUgaGl0IHdoZW4gYW4gYXJteSBpcyB3aXBlZCAoaGVhcnRzIGFyZSBISVMgaGVhbHRoKSwgdW5sZWFzaGVzIHRoZSByZXB1bHNpb24gc2hvY2t3YXZlIGFuZCByYWlzZXNcbi8vIHRoZSBmYWxsZW4uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBhbmltYXRpb24gb25seTsgdGhlIHJ1bGVzIGxpdmUgaW4gY29yZS9ydWxlcy50cy5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuXG5leHBvcnQgY2xhc3MgTmVjcm9tYW5jZXIge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb247IGxvY2FsICtaIGlzIGhpcyBmYWNpbmcgKHRoZSBnYW1lIHJvdGF0ZXMgaGltIHRvIGZhY2UgdGhlIGJhdHRsZWZpZWxkKVxuICBwcml2YXRlIGVudDogYW55OyBwcml2YXRlIGFuaW1zOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307IHByaXZhdGUgY3VyOiBhbnkgPSBudWxsOyBwcml2YXRlIGhhbmQ6IGFueSA9IG51bGw7IHByaXZhdGUgcmluZzogYW55OyBwcml2YXRlIHBzOiBhbnk7XG4gIHByaXZhdGUgdCA9IDA7IHByaXZhdGUgaWRsZVQgPSAwOyBwcml2YXRlIG5leHRUYXAgPSA4OyBwcml2YXRlIGJ1c3kgPSBmYWxzZTsgcHJpdmF0ZSBkb3duZWQgPSBmYWxzZTsgcHJpdmF0ZSByZWFkb25seSBTID0gMS4zNTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHNjZW5lOiBhbnksIHByaXZhdGUgc29mdDogYW55LCBjb250YWluZXI6IGFueSkge1xuICAgIGNvbnN0IHMgPSBzY2VuZTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ25lY3JvJywgcyk7XG4gICAgdGhpcy5lbnQgPSBjb250YWluZXIuaW5zdGFudGlhdGVNb2RlbHNUb1NjZW5lKChuOiBzdHJpbmcpID0+IG4gKyAnX25lY3JvJywgZmFsc2UsIHsgZG9Ob3RJbnN0YW50aWF0ZTogdHJ1ZSB9KTtcbiAgICBjb25zdCByb290ID0gdGhpcy5lbnQucm9vdE5vZGVzWzBdOyByb290LnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLlMpO1xuICAgIHJvb3QuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgbS5pc1BpY2thYmxlID0gZmFsc2U7IG0uYWx3YXlzU2VsZWN0QXNBY3RpdmVNZXNoID0gdHJ1ZTsgfSk7XG4gICAgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4geyBnLnN0b3AoKTsgZy5lbmFibGVCbGVuZGluZyA9IHRydWU7IGcuYmxlbmRpbmdTcGVlZCA9IDAuMTI7IHRoaXMuYW5pbXNbZy5uYW1lLnNwbGl0KCdfJylbMF1dID0gZzsgfSk7XG4gICAgdGhpcy5oYW5kID0gcm9vdC5nZXRDaGlsZFRyYW5zZm9ybU5vZGVzKGZhbHNlKS5maW5kKChuOiBhbnkpID0+IG4ubmFtZS5pbmNsdWRlcygnU29ja2V0X1dlYXBvbicpKSB8fCBudWxsO1xuICAgIHRoaXMucGxheSgnSWRsZScsIHRydWUpO1xuICAgIGNvbnN0IHJpbmcgPSB0aGlzLnJpbmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZURpc2MoJ2Jhc2UnLCB7IHJhZGl1czogMC41LCB0ZXNzZWxsYXRpb246IDMwIH0sIHMpOyByaW5nLnBhcmVudCA9IHRoaXMuaG9sZGVyOyByaW5nLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgcmluZy5wb3NpdGlvbi55ID0gMC4wMjsgcmluZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3Qgcm0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCducicsIHMpOyBybS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBybS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuNCwgMC4xNSwgMC43NSk7IHJtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHJtLmFscGhhID0gMC41NTsgcmluZy5tYXRlcmlhbCA9IHJtO1xuICAgIGNvbnN0IHBzID0gdGhpcy5wcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCduZWNyb0F1cmEnLCA4MCwgcyk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHNvZnQ7IHBzLmVtaXR0ZXIgPSB0aGlzLmhvbGRlcjtcbiAgICBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yNSwgMCwgLTAuMjUpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjI1LCAwLjgsIDAuMjUpOyBwcy5taW5MaWZlVGltZSA9IDAuNjsgcHMubWF4TGlmZVRpbWUgPSAxLjM7XG4gICAgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMTUsIDAuOSwgLTAuMTUpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjE1LCAxLjYsIDAuMTUpOyBwcy5taW5FbWl0UG93ZXIgPSAwLjM7IHBzLm1heEVtaXRQb3dlciA9IDAuODsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4wNzsgcHMubWF4U2l6ZSA9IDAuMjsgcHMuZW1pdFJhdGUgPSAzMDsgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDAuOCwgMC4zNSwgMSwgMC43KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KDAuNDUsIDAuMTUsIDAuOSwgMC41KTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICBwcml2YXRlIHBsYXkobmFtZTogc3RyaW5nLCBsb29wID0gZmFsc2UsIGhvbGQgPSBmYWxzZSkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmFuaW1zW25hbWVdOyBpZiAoIWcpIHJldHVybjtcbiAgICBpZiAodGhpcy5jdXIgJiYgdGhpcy5jdXIgIT09IGcpIHRoaXMuY3VyLnN0b3AoKTtcbiAgICBnLnN0b3AoKTsgZy5zdGFydChsb29wLCAxLCBnLmZyb20sIGcudG8pOyB0aGlzLmN1ciA9IGc7IHRoaXMuYnVzeSA9ICFsb29wOyB0aGlzLmhvbGRFbmQgPSBob2xkO1xuICB9XG4gIHByaXZhdGUgaG9sZEVuZCA9IGZhbHNlO1xuICBzZXRFbmFibGVkKG9uOiBib29sZWFuKSB7IHRoaXMuaG9sZGVyLnNldEVuYWJsZWQob24pOyBpZiAob24pIHRoaXMucHMuc3RhcnQoKTsgZWxzZSB0aGlzLnBzLnN0b3AoKTsgfVxuICAvKiogV29ybGQgcG9zaXRpb24gb2YgdGhlIHN0YWZmIGNyeXN0YWwgKGZvciBzcGVsbCBlZmZlY3RzKTogYWJvdmUgdGhlIGhhbmQgdGhhdCBob2xkcyB0aGUgc3RhZmYuICovXG4gIGNyeXN0YWxQb3MoKTogYW55IHtcbiAgICB0aGlzLmhvbGRlci5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSk7XG4gICAgY29uc3QgYmFzZSA9IHRoaXMuaGFuZCA/ICh0aGlzLmhhbmQuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpLCB0aGlzLmhhbmQuZ2V0QWJzb2x1dGVQb3NpdGlvbigpLmNsb25lKCkpIDogdGhpcy5ob2xkZXIuZ2V0QWJzb2x1dGVQb3NpdGlvbigpLmFkZChuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNiAqIHRoaXMuUywgMCkpO1xuICAgIHJldHVybiBiYXNlLmFkZChuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNjIgKiB0aGlzLlMsIDApKTtcbiAgfVxuXG4gIGh1cnQoKSB7IGlmICghdGhpcy5kb3duZWQpIHRoaXMucGxheSgnSHVydCcpOyB9XG4gIGNhc3QoKSB7IGlmICghdGhpcy5kb3duZWQpIHRoaXMucGxheSgnQ2FzdCcpOyB9XG4gIC8qKiBUaGUgbGFzdCBoZWFydCBpcyBnb25lOiBoZSBzaW5rcyB0byBoaXMga25lZXMuICovXG4gIGRlZmVhdCgpIHsgdGhpcy5kb3duZWQgPSB0cnVlOyB0aGlzLnBsYXkoJ0Rvd24nLCBmYWxzZSwgdHJ1ZSk7IH1cbiAgcmV2aXZlKCkgeyBpZiAodGhpcy5kb3duZWQpIHsgdGhpcy5kb3duZWQgPSBmYWxzZTsgdGhpcy5wbGF5KCdSZXZpdmUnKTsgfSBlbHNlIGlmICh0aGlzLmJ1c3kgJiYgdGhpcy5jdXIgIT09IHRoaXMuYW5pbXNbJ0lkbGUnXSkgdGhpcy5wbGF5KCdJZGxlJywgdHJ1ZSk7IH1cblxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMudCArPSBkdDtcbiAgICBpZiAodGhpcy5jdXIgJiYgIXRoaXMuY3VyLmlzU3RhcnRlZCAmJiAhdGhpcy5kb3duZWQpIHRoaXMucGxheSgnSWRsZScsIHRydWUpOyAgICAgICAgICAgICAgLy8gYSBvbmUtc2hvdCBmaW5pc2hlZFxuICAgIGVsc2UgaWYgKHRoaXMuY3VyICYmICF0aGlzLmN1ci5pc1N0YXJ0ZWQgJiYgdGhpcy5kb3duZWQgJiYgIXRoaXMuaG9sZEVuZCkgdGhpcy5wbGF5KCdJZGxlJywgdHJ1ZSk7XG4gICAgaWYgKCF0aGlzLmJ1c3kgJiYgIXRoaXMuZG93bmVkKSB7IHRoaXMuaWRsZVQgKz0gZHQ7IGlmICh0aGlzLmlkbGVUID4gdGhpcy5uZXh0VGFwKSB7IHRoaXMuaWRsZVQgPSAwOyB0aGlzLm5leHRUYXAgPSA5ICsgTWF0aC5yYW5kb20oKSAqIDg7IHRoaXMucGxheSgnVGFwJyk7IH0gfVxuICAgIHRoaXMucHMuZW1pdFJhdGUgPSB0aGlzLmRvd25lZCA/IDYgOiAodGhpcy5idXN5ICYmIHRoaXMuY3VyID09PSB0aGlzLmFuaW1zWydDYXN0J10gPyAxMTAgOiAzMCk7XG4gIH1cblxuICBkaXNwb3NlKCkgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IGcuZGlzcG9zZSgpKTsgdGhpcy5lbnQuc2tlbGV0b25zLmZvckVhY2goKHM6IGFueSkgPT4gcy5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cbiIsICIvLyBBbGwgc291bmQgaXMgc3ludGhlc2l6ZWQgaW4gdGhlIGJyb3dzZXIgd2l0aCB0aGUgV2ViIEF1ZGlvIEFQSTogbm8gYXVkaW8gZmlsZXMgdG8gZG93bmxvYWQsIGxpY2Vuc2Ugb3Igc2hpcC5cbi8vIFR3byBpbmRlcGVuZGVudCBzd2l0Y2hlcyAobXVzaWMsIHNvdW5kIGVmZmVjdHMpLCBzYXZlZCBpbiB0aGUgcGxheWVyJ3Mgc2F2ZS4gUGhvbmVzIG9ubHkgYWxsb3cgc291bmQgYWZ0ZXIgYSB0YXAsIHNvIG5vdGhpbmcgc3RhcnRzXG4vLyB1bnRpbCB0aGUgZmlyc3QgdG91Y2gvY2xpY2sgKGB1bmxvY2tgKS5cbmltcG9ydCB7IGxvYWRTYXZlLCB1cGRhdGVTZXR0aW5ncyB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5cbmV4cG9ydCB0eXBlIFNmeCA9ICd0YXAnIHwgJ3N1bW1vbicgfCAnbWVyZ2UnIHwgJ2hpdCcgfCAnaGl0QXJyb3cnIHwgJ3NtYXNoJyB8ICdhcnJvdycgfCAnZGVhdGgnIHwgJ2Nhc3QnIHwgJ3RhdW50JyB8ICdzaG9ja3dhdmUnIHwgJ3Jlc3VycmVjdCcgfCAnaGVhcnRMb3N0JyB8ICd2aWN0b3J5JyB8ICdkZWZlYXQnIHwgJ3N0YXJ0J1xuICB8ICd1bmxvY2snIHwgJ3BhY2tDaGFyZ2UnIHwgJ3BhY2tUaWVyVXAnIHwgJ3BhY2tUZWFyJyB8ICdwYWNrRmFuJyB8ICdwYWNrRmxpcCcgfCAncGFja1JhcmUnIHwgJ3BhY2tFcGljJyB8ICdwYWNrTGVnZW5kJyB8ICdwYWNrQ29sbGVjdCc7XG5leHBvcnQgdHlwZSBNb2RlID0gJ2J1aWxkJyB8ICdiYXR0bGUnO1xuXG4vLyBNdXNpYzogQSBtaW5vciwgODAgYnBtLCBmb3VyIGJhcnMgbG9vcGluZyAoQW0sIEYsIEMsIEUpLiBSb290IG5vdGUgZmlyc3QsIHRoZW4gY2hvcmQgdG9uZXMgKEh6KS5cbmNvbnN0IENIT1JEUzogbnVtYmVyW11bXSA9IFtcbiAgWzExMCwgMTY0LjgxLCAyMjAsIDI2MS42MywgMzI5LjYzXSxcbiAgWzg3LjMxLCAxMzAuODEsIDE3NC42MSwgMjIwLCAyNjEuNjNdLFxuICBbMTMwLjgxLCAxOTYsIDI2MS42MywgMzI5LjYzLCAzOTJdLFxuICBbODIuNDEsIDEyMy40NywgMTY0LjgxLCAyMDcuNjUsIDI0Ni45NF0sXG5dO1xuY29uc3QgQkVBVCA9IDYwIC8gODA7XG5cbmNsYXNzIEF1ZGlvRW5naW5lIHtcbiAgcHJpdmF0ZSBjdHg6IEF1ZGlvQ29udGV4dCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG1hc3RlciE6IEdhaW5Ob2RlOyBwcml2YXRlIG11c2ljQnVzITogR2Fpbk5vZGU7IHByaXZhdGUgc2Z4QnVzITogR2Fpbk5vZGU7IHByaXZhdGUgbm9pc2VCdWYhOiBBdWRpb0J1ZmZlcjtcbiAgbXVzaWMgPSB0cnVlOyBzZnggPSB0cnVlOyBtb2RlOiBNb2RlID0gJ2J1aWxkJztcbiAgcHJpdmF0ZSB0aW1lciA9IDA7IHByaXZhdGUgbmV4dFQgPSAwOyBwcml2YXRlIGJlYXQgPSAwOyBwcml2YXRlIHN0YW1wczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuXG4gIGNvbnN0cnVjdG9yKCkgeyBjb25zdCBzID0gbG9hZFNhdmUoKS5zZXR0aW5nczsgdGhpcy5tdXNpYyA9IHMubXVzaWM7IHRoaXMuc2Z4ID0gcy5zZng7IH1cblxuICBwcml2YXRlIHNpbGVudDogSFRNTEF1ZGlvRWxlbWVudCB8IG51bGwgPSBudWxsOyBwcml2YXRlIHByaW1lZCA9IGZhbHNlO1xuICAvKiogaVBob25lcyBtdXRlIFdlYiBBdWRpbyB3aGVuIHRoZSByaW5nZXIgc3dpdGNoIGlzIG9uLCB1bmxlc3MgdGhlIHBhZ2UgaXMgcGxheWluZyBcInJlYWxcIiBtZWRpYS4gQSBzaWxlbnQgbG9vcGluZyA8YXVkaW8+IGVsZW1lbnQgKHBsdXMgdGhlXG4gICAqICBhdWRpb1Nlc3Npb24gaGludCBvbiBuZXdlciBpT1MpIG1vdmVzIHRoZSBwYWdlIHRvIHRoZSBwbGF5YmFjayBjaGFubmVsLCBzbyB0aGUgZ2FtZSBpcyBoZWFyZCBldmVuIHdpdGggdGhlIHN3aXRjaCBvbiBzaWxlbnQuICovXG4gIHByaXZhdGUgcGxheWJhY2tDaGFubmVsKCkge1xuICAgIHRyeSB7IGNvbnN0IGEgPSAobmF2aWdhdG9yIGFzIGFueSkuYXVkaW9TZXNzaW9uOyBpZiAoYSkgYS50eXBlID0gJ3BsYXliYWNrJzsgfSBjYXRjaCB7IC8qIG5vdCBzdXBwb3J0ZWQgKi8gfVxuICAgIGlmICh0aGlzLnNpbGVudCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBuID0gNDQxLCBidWYgPSBuZXcgQXJyYXlCdWZmZXIoNDQgKyBuICogMiksIHYgPSBuZXcgRGF0YVZpZXcoYnVmKSwgc3RyID0gKG86IG51bWJlciwgdDogc3RyaW5nKSA9PiB7IGZvciAobGV0IGkgPSAwOyBpIDwgdC5sZW5ndGg7IGkrKykgdi5zZXRVaW50OChvICsgaSwgdC5jaGFyQ29kZUF0KGkpKTsgfTtcbiAgICAgIHN0cigwLCAnUklGRicpOyB2LnNldFVpbnQzMig0LCAzNiArIG4gKiAyLCB0cnVlKTsgc3RyKDgsICdXQVZFJyk7IHN0cigxMiwgJ2ZtdCAnKTsgdi5zZXRVaW50MzIoMTYsIDE2LCB0cnVlKTsgdi5zZXRVaW50MTYoMjAsIDEsIHRydWUpOyB2LnNldFVpbnQxNigyMiwgMSwgdHJ1ZSk7XG4gICAgICB2LnNldFVpbnQzMigyNCwgNDQxMDAsIHRydWUpOyB2LnNldFVpbnQzMigyOCwgODgyMDAsIHRydWUpOyB2LnNldFVpbnQxNigzMiwgMiwgdHJ1ZSk7IHYuc2V0VWludDE2KDM0LCAxNiwgdHJ1ZSk7IHN0cigzNiwgJ2RhdGEnKTsgdi5zZXRVaW50MzIoNDAsIG4gKiAyLCB0cnVlKTtcbiAgICAgIGNvbnN0IGVsID0gbmV3IEF1ZGlvKFVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW2J1Zl0sIHsgdHlwZTogJ2F1ZGlvL3dhdicgfSkpKTsgZWwubG9vcCA9IHRydWU7IGVsLnZvbHVtZSA9IDAuMDE7IGVsLnNldEF0dHJpYnV0ZSgncGxheXNpbmxpbmUnLCAnJyk7IHRoaXMuc2lsZW50ID0gZWw7XG4gICAgICBlbC5wbGF5KCkuY2F0Y2goKCkgPT4geyB0aGlzLnNpbGVudCA9IG51bGw7IH0pO1xuICAgIH0gY2F0Y2ggeyAvKiBmaW5lOiBzb3VuZCBzdGlsbCB3b3JrcywganVzdCBmb2xsb3dzIHRoZSBzaWxlbnQgc3dpdGNoICovIH1cbiAgfVxuICAvKiogV2hhdCB0aGUgU2V0dGluZ3MgcGFnZSBzaG93cyBzbyBhIHNpbGVudCBwaG9uZSBjYW4gYmUgZGlhZ25vc2VkLiAqL1xuICBzdGF0dXMoKTogeyBzdGF0ZTogc3RyaW5nOyB1bmxvY2tlZDogYm9vbGVhbiB9IHsgcmV0dXJuIHsgc3RhdGU6IHRoaXMuY3R4ID8gdGhpcy5jdHguc3RhdGUgOiAnbm90IHN0YXJ0ZWQnLCB1bmxvY2tlZDogISF0aGlzLmN0eCAmJiB0aGlzLmN0eC5zdGF0ZSA9PT0gJ3J1bm5pbmcnIH07IH1cbiAgLyoqIFRoZSBTZXR0aW5ncyBwYWdlJ3MgVGVzdCBzb3VuZCBidXR0b246IHVubG9jayBhbmQgbWFrZSBhIGNsZWFybHkgYXVkaWJsZSBzb3VuZC4gKi9cbiAgdGVzdCgpIHsgdGhpcy51bmxvY2soKTsgY29uc3QgdCA9ICgpID0+IHsgdGhpcy5wbGF5KCd2aWN0b3J5Jyk7IH07IGlmICh0aGlzLmN0eCAmJiB0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSB0aGlzLmN0eC5yZXN1bWUoKS50aGVuKHQpLmNhdGNoKCgpID0+IHt9KTsgZWxzZSB0KCk7IH1cblxuICAvKiogQ2FsbCBmcm9tIGEgdXNlciBnZXN0dXJlICh0YXAvY2xpY2spLiBTYWZlIHRvIGNhbGwgcmVwZWF0ZWRseS4gKi9cbiAgdW5sb2NrKCkge1xuICAgIHRoaXMucGxheWJhY2tDaGFubmVsKCk7XG4gICAgaWYgKCF0aGlzLmN0eCkge1xuICAgICAgY29uc3QgQyA9ICh3aW5kb3cgYXMgYW55KS5BdWRpb0NvbnRleHQgfHwgKHdpbmRvdyBhcyBhbnkpLndlYmtpdEF1ZGlvQ29udGV4dDsgaWYgKCFDKSByZXR1cm47XG4gICAgICBjb25zdCBjdHg6IEF1ZGlvQ29udGV4dCA9IHRoaXMuY3R4ID0gbmV3IEMoKTtcbiAgICAgIGNvbnN0IGNvbXAgPSBjdHguY3JlYXRlRHluYW1pY3NDb21wcmVzc29yKCk7IGNvbXAuY29ubmVjdChjdHguZGVzdGluYXRpb24pO1xuICAgICAgdGhpcy5tYXN0ZXIgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm1hc3Rlci5nYWluLnZhbHVlID0gMC45OyB0aGlzLm1hc3Rlci5jb25uZWN0KGNvbXApO1xuICAgICAgdGhpcy5tdXNpY0J1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMubXVzaWNCdXMuY29ubmVjdCh0aGlzLm1hc3Rlcik7IHRoaXMuc2Z4QnVzID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5zZnhCdXMuY29ubmVjdCh0aGlzLm1hc3Rlcik7XG4gICAgICBjdHgub25zdGF0ZWNoYW5nZSA9ICgpID0+IHsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1hdWRpby1zdGF0ZScpKTsgfTtcbiAgICAgIGNvbnN0IGxlbiA9IGN0eC5zYW1wbGVSYXRlOyB0aGlzLm5vaXNlQnVmID0gY3R4LmNyZWF0ZUJ1ZmZlcigxLCBsZW4sIGN0eC5zYW1wbGVSYXRlKTsgY29uc3QgZCA9IHRoaXMubm9pc2VCdWYuZ2V0Q2hhbm5lbERhdGEoMCk7IGZvciAobGV0IGkgPSAwOyBpIDwgbGVuOyBpKyspIGRbaV0gPSBNYXRoLnJhbmRvbSgpICogMiAtIDE7XG4gICAgfVxuICAgIGlmICh0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSB0aGlzLmN0eC5yZXN1bWUoKS5jYXRjaCgoKSA9PiB7fSk7ICAgICAgICAgICAgIC8vICdzdXNwZW5kZWQnIG9yIChpT1MpICdpbnRlcnJ1cHRlZCdcbiAgICBpZiAoIXRoaXMucHJpbWVkKSB7IHRoaXMucHJpbWVkID0gdHJ1ZTsgdHJ5IHsgY29uc3QgYiA9IHRoaXMuY3R4LmNyZWF0ZUJ1ZmZlcigxLCAxLCAyMjA1MCksIHMgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKTsgcy5idWZmZXIgPSBiOyBzLmNvbm5lY3QodGhpcy5jdHguZGVzdGluYXRpb24pOyBzLnN0YXJ0KDApOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH0gfVxuICAgIHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpO1xuICB9XG5cbiAgc2V0TXVzaWMob246IGJvb2xlYW4pIHsgdGhpcy5tdXNpYyA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IG11c2ljOiBvbiB9KTsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2V0dGluZ3MnKSk7IH1cbiAgc2V0U2Z4KG9uOiBib29sZWFuKSB7IHRoaXMuc2Z4ID0gb247IHVwZGF0ZVNldHRpbmdzKHsgc2Z4OiBvbiB9KTsgdGhpcy5hcHBseUdhaW5zKCk7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2V0dGluZ3MnKSk7IGlmIChvbikgdGhpcy5wbGF5KCd0YXAnKTsgfVxuICAvKiogUmUtcmVhZCB0aGUgc2F2ZWQgc3dpdGNoZXMgKHRoZSBzaGVsbCdzIFNldHRpbmdzIHBhZ2UgY2hhbmdlcyB0aGVtIHRvbykuICovXG4gIHJlbG9hZCgpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTsgfVxuICBzZXRNb2RlKG06IE1vZGUpIHsgdGhpcy5tb2RlID0gbTsgfVxuXG4gIHByaXZhdGUgYXBwbHlHYWlucygpIHtcbiAgICBpZiAoIXRoaXMuY3R4KSByZXR1cm47IGNvbnN0IHQgPSB0aGlzLmN0eC5jdXJyZW50VGltZTtcbiAgICB0aGlzLm11c2ljQnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMubXVzaWMgPyAwLjUgOiAwLCB0LCAwLjE1KTsgdGhpcy5zZnhCdXMuZ2Fpbi5zZXRUYXJnZXRBdFRpbWUodGhpcy5zZnggPyAwLjggOiAwLCB0LCAwLjA1KTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBtdXNpY1xuICBwcml2YXRlIHN5bmNNdXNpYygpIHtcbiAgICBpZiAoIXRoaXMuY3R4KSByZXR1cm47XG4gICAgaWYgKHRoaXMubXVzaWMgJiYgIXRoaXMudGltZXIpIHsgdGhpcy5uZXh0VCA9IHRoaXMuY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgdGhpcy50aW1lciA9IHdpbmRvdy5zZXRJbnRlcnZhbCgoKSA9PiB0aGlzLnRpY2soKSwgMjAwKTsgfVxuICAgIGlmICghdGhpcy5tdXNpYyAmJiB0aGlzLnRpbWVyKSB7IGNsZWFySW50ZXJ2YWwodGhpcy50aW1lcik7IHRoaXMudGltZXIgPSAwOyB9XG4gIH1cbiAgcHJpdmF0ZSB0aWNrKCkge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ITsgaWYgKGN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnKSB7IHRoaXMubmV4dFQgPSBjdHguY3VycmVudFRpbWUgKyAwLjE1OyByZXR1cm47IH1cbiAgICB3aGlsZSAodGhpcy5uZXh0VCA8IGN0eC5jdXJyZW50VGltZSArIDAuNikgeyB0aGlzLnBsYXlCZWF0KHRoaXMuYmVhdCwgdGhpcy5uZXh0VCk7IHRoaXMubmV4dFQgKz0gQkVBVDsgdGhpcy5iZWF0ID0gKHRoaXMuYmVhdCArIDEpICUgMTY7IH1cbiAgfVxuICBwcml2YXRlIHBsYXlCZWF0KGJlYXQ6IG51bWJlciwgdDogbnVtYmVyKSB7XG4gICAgY29uc3QgY2hvcmQgPSBDSE9SRFNbTWF0aC5mbG9vcihiZWF0IC8gNCldLCBpbkJhciA9IGJlYXQgJSA0LCBiYXR0bGUgPSB0aGlzLm1vZGUgPT09ICdiYXR0bGUnO1xuICAgIGlmIChpbkJhciA9PT0gMCkgZm9yIChjb25zdCBmIG9mIGNob3JkKSB0aGlzLnZvaWNlKGYsICd0cmlhbmdsZScsIHQsIEJFQVQgKiA0ICsgMC44LCAwLjA0NSwgMC45LCA5MDApOyAgIC8vIHNsb3cgcGFkXG4gICAgaWYgKGluQmFyID09PSAwIHx8IGluQmFyID09PSAyKSB0aGlzLnZvaWNlKGNob3JkWzBdLCAnc2luZScsIHQsIEJFQVQgKiAxLjYsIDAuMTYsIDAuMDIsIDQwMCk7ICAgICAgICAgIC8vIGJhc3NcbiAgICBpZiAoYmF0dGxlKSB7XG4gICAgICB0aGlzLmtpY2sodCwgMC4zMik7IGlmIChpbkJhciA9PT0gMikgdGhpcy5raWNrKHQgKyBCRUFUICogMC41LCAwLjE4KTtcbiAgICAgIHRoaXMubm9pc2UodCArIEJFQVQgKiAwLjUsIDAuMDUsIDAuMDUsICdoaWdocGFzcycsIDcwMDApOyB0aGlzLm5vaXNlKHQgKyBCRUFUICogMS41ICUgQkVBVCwgMC4wNSwgMC4wMywgJ2hpZ2hwYXNzJywgNzAwMCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDI7IGkrKykgdGhpcy52b2ljZShjaG9yZFsxICsgKChiZWF0ICogMiArIGkpICUgNCldICogMiwgJ3RyaWFuZ2xlJywgdCArIGkgKiBCRUFUIC8gMiwgMC4yMiwgMC4wNSwgMC4wMDUsIDI1MDApOyAgIC8vIHBsdWNrIGFycGVnZ2lvXG4gICAgfVxuICB9XG4gIHByaXZhdGUgdm9pY2UoZnJlcTogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgdDogbnVtYmVyLCBkdXI6IG51bWJlciwgZ2FpbjogbnVtYmVyLCBhdHRhY2s6IG51bWJlciwgbHA6IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnZhbHVlID0gZnJlcTsgZi50eXBlID0gJ2xvd3Bhc3MnOyBmLmZyZXF1ZW5jeS52YWx1ZSA9IGxwO1xuICAgIGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIE1hdGgubWF4KDAuMDA1LCBhdHRhY2spKTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgZHVyKTtcbiAgICBvLmNvbm5lY3QoZik7IGYuY29ubmVjdChnKTsgZy5jb25uZWN0KHRoaXMubXVzaWNCdXMpOyBvLnN0YXJ0KHQpOyBvLnN0b3AodCArIGR1ciArIDAuMDUpO1xuICB9XG4gIHByaXZhdGUga2ljayh0OiBudW1iZXIsIGdhaW46IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpO1xuICAgIG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKDEzMCwgdCk7IG8uZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoNDIsIHQgKyAwLjE0KTsgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyAwLjIpO1xuICAgIG8uY29ubmVjdChnKTsgZy5jb25uZWN0KHRoaXMubXVzaWNCdXMpOyBvLnN0YXJ0KHQpOyBvLnN0b3AodCArIDAuMjUpO1xuICB9XG4gIHByaXZhdGUgbm9pc2UodDogbnVtYmVyLCBkdXI6IG51bWJlciwgZ2FpbjogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmcmVxOiBudW1iZXIsIGJ1czogR2Fpbk5vZGUgPSB0aGlzLm11c2ljQnVzLCBzd2VlcFRvPzogbnVtYmVyKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCBuID0gY3R4LmNyZWF0ZUJ1ZmZlclNvdXJjZSgpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBuLmJ1ZmZlciA9IHRoaXMubm9pc2VCdWY7IGYudHlwZSA9IHR5cGU7IGYuZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc3dlZXBUbykgZi5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzd2VlcFRvLCB0ICsgZHVyKTtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoZ2FpbiwgdCk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgbi5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdChidXMpOyBuLnN0YXJ0KHQsIE1hdGgucmFuZG9tKCkgKiAwLjUpOyBuLnN0b3AodCArIGR1ciArIDAuMDIpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNvdW5kIGVmZmVjdHNcbiAgcHJpdmF0ZSB0b25lKGZyZXE6IG51bWJlciwgZHVyOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCBnYWluOiBudW1iZXIsIGRlbGF5ID0gMCwgc2xpZGVUbz86IG51bWJlciwgYXR0YWNrID0gMC4wMDUsIGxwID0gODAwMCkge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgdCA9IGN0eC5jdXJyZW50VGltZSArIGRlbGF5LCBvID0gY3R4LmNyZWF0ZU9zY2lsbGF0b3IoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCksIGYgPSBjdHguY3JlYXRlQmlxdWFkRmlsdGVyKCk7XG4gICAgby50eXBlID0gdHlwZTsgby5mcmVxdWVuY3kuc2V0VmFsdWVBdFRpbWUoZnJlcSwgdCk7IGlmIChzbGlkZVRvKSBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKHNsaWRlVG8sIHQgKyBkdXIpO1xuICAgIGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDsgZy5nYWluLnNldFZhbHVlQXRUaW1lKDAuMDAwMSwgdCk7IGcuZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZShnYWluLCB0ICsgYXR0YWNrKTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgZHVyKTtcbiAgICBvLmNvbm5lY3QoZik7IGYuY29ubmVjdChnKTsgZy5jb25uZWN0KHRoaXMuc2Z4QnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGhpc3MoZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBkZWxheSA9IDAsIHN3ZWVwVG8/OiBudW1iZXIpIHsgdGhpcy5ub2lzZSh0aGlzLmN0eCEuY3VycmVudFRpbWUgKyBkZWxheSwgZHVyLCBnYWluLCB0eXBlLCBmcmVxLCB0aGlzLnNmeEJ1cywgc3dlZXBUbyk7IH1cbiAgcHJpdmF0ZSB0aHJvdHRsZShrZXk6IHN0cmluZywgbXM6IG51bWJlcikgeyBjb25zdCBuID0gcGVyZm9ybWFuY2Uubm93KCk7IGlmIChuIC0gKHRoaXMuc3RhbXBzW2tleV0gfHwgMCkgPCBtcykgcmV0dXJuIGZhbHNlOyB0aGlzLnN0YW1wc1trZXldID0gbjsgcmV0dXJuIHRydWU7IH1cblxuICBwbGF5KG5hbWU6IFNmeCkge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuc2Z4IHx8IHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHJldHVybjtcbiAgICBzd2l0Y2ggKG5hbWUpIHtcbiAgICAgIGNhc2UgJ3RhcCc6IGlmICghdGhpcy50aHJvdHRsZSgndGFwJywgNDApKSByZXR1cm47IHRoaXMudG9uZSg3NjAsIDAuMDYsICdzaW5lJywgMC4yMiwgMCwgMTEwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc3VtbW9uJzogdGhpcy5oaXNzKDAuNCwgMC4xNCwgJ2JhbmRwYXNzJywgNTAwLCAwLCAyNTAwKTsgdGhpcy50b25lKDIyMCwgMC40LCAnc2F3dG9vdGgnLCAwLjEsIDAsIDY2MCwgMC4wNSwgMTgwMCk7IHRoaXMudG9uZSgxMzIwLCAwLjIsICdzaW5lJywgMC4xLCAwLjE4KTsgYnJlYWs7XG4gICAgICBjYXNlICdtZXJnZSc6IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC4zNSwgJ3RyaWFuZ2xlJywgMC4yLCBpICogMC4wNykpOyB0aGlzLmhpc3MoMC41LCAwLjA4LCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMTEwLCAwLjMsICdzaW5lJywgMC4zNSwgMCwgNTApOyB0aGlzLnRvbmUoMTU2OCwgMC41LCAnc2luZScsIDAuMDgsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0JzogaWYgKCF0aGlzLnRocm90dGxlKCdoaXQnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDcsIDAuMjQsICdsb3dwYXNzJywgMTgwMCk7IHRoaXMudG9uZSgxNzAsIDAuMDksICdzaW5lJywgMC4yMiwgMCwgODApOyBicmVhaztcbiAgICAgIGNhc2UgJ2hpdEFycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdoaXRBJywgNDUpKSByZXR1cm47IHRoaXMuaGlzcygwLjA1LCAwLjE0LCAnYmFuZHBhc3MnLCAzMDAwKTsgdGhpcy50b25lKDcwMCwgMC4wNiwgJ3RyaWFuZ2xlJywgMC4wNiwgMCwgNDAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzbWFzaCc6IHRoaXMudG9uZSg5NSwgMC4zOCwgJ3NpbmUnLCAwLjUsIDAsIDM0KTsgdGhpcy5oaXNzKDAuMzIsIDAuMzUsICdsb3dwYXNzJywgMTAwMCwgMCwgMjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdhcnJvdyc6IGlmICghdGhpcy50aHJvdHRsZSgnYXJyb3cnLCA2MCkpIHJldHVybjsgdGhpcy5oaXNzKDAuMTQsIDAuMSwgJ2JhbmRwYXNzJywgMTgwMCwgMCwgNDIwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVhdGgnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2RlYXRoJywgNzApKSByZXR1cm47IHRoaXMudG9uZSgzMDAsIDAuNCwgJ3Nhd3Rvb3RoJywgMC4xNCwgMCwgNzAsIDAuMDEsIDkwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnY2FzdCc6IHRoaXMudG9uZSgzMDAsIDAuNDUsICdzaW5lJywgMC4xOCwgMCwgOTAwLCAwLjA1KTsgdGhpcy50b25lKDQ1MCwgMC40NSwgJ3NpbmUnLCAwLjEsIDAuMDUsIDEzNTAsIDAuMDUpOyB0aGlzLnRvbmUoMTgwMCwgMC4yNSwgJ3NpbmUnLCAwLjA1LCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3RhdW50JzogdGhpcy50b25lKDE5NiwgMC41LCAnc3F1YXJlJywgMC4wOCwgMCwgMTgwLCAwLjAzLCA3MDApOyB0aGlzLnRvbmUoMTQ3LCAwLjUsICdzYXd0b290aCcsIDAuMDgsIDAuMDIsIDE0MCwgMC4wMywgNjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzaG9ja3dhdmUnOiB0aGlzLnRvbmUoMjIwLCAxLjEsICdzaW5lJywgMC41LCAwLCAyOCwgMC4wMik7IHRoaXMuaGlzcygxLjAsIDAuMzUsICdsb3dwYXNzJywgMzAwMCwgMCwgMTUwKTsgdGhpcy50b25lKDg4MCwgMC44LCAnc2luZScsIDAuMDgsIDAsIDIyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncmVzdXJyZWN0JzogWzIyMCwgMjc3LCAzMzAsIDQ0MCwgNTU0XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMS4xLCAndHJpYW5nbGUnLCAwLjEsIGkgKiAwLjEyLCBmICogMS4xMiwgMC4zKSk7IHRoaXMuaGlzcygwLjksIDAuMDYsICdoaWdocGFzcycsIDQ1MDAsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnaGVhcnRMb3N0JzogdGhpcy50b25lKDExMCwgMC43LCAnc2F3dG9vdGgnLCAwLjI4LCAwLCA1MCwgMC4wMSwgNDUwKTsgdGhpcy5oaXNzKDAuMTgsIDAuMiwgJ2xvd3Bhc3MnLCA5MDApOyB0aGlzLnRvbmUoMjMzLCAwLjUsICdzcXVhcmUnLCAwLjA1LCAwLjAyLCAyMjAsIDAuMDEsIDUwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAndmljdG9yeSc6IFszOTIsIDQ5NCwgNTg3LCA3ODRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjUsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjExKSk7IHRoaXMudG9uZSgxOTYsIDAuOSwgJ3NpbmUnLCAwLjIpOyBicmVhaztcbiAgICAgIGNhc2UgJ2RlZmVhdCc6IFszMzAsIDI5NCwgMjQ3LCAxOTZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjcsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjI4LCBmICogMC45NykpOyB0aGlzLnRvbmUoODIsIDEuNiwgJ3NpbmUnLCAwLjMsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndW5sb2NrJzogWzAuMzUsIDAuNDcsIDAuNTksIDAuNzFdLmZvckVhY2goKGQsIGkpID0+IHsgdGhpcy5oaXNzKDAuMDUsIDAuMjIsICdiYW5kcGFzcycsIDkwMCArIGkgKiAxMjAsIGQpOyB0aGlzLnRvbmUoMTcwICsgaSAqIDEyLCAwLjA3LCAnc3F1YXJlJywgMC4wNiwgZCwgdW5kZWZpbmVkLCAwLjAwMiwgNjAwKTsgfSk7IFs3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjYsICd0cmlhbmdsZScsIDAuMTYsIDEuMTUgKyBpICogMC4wNykpOyB0aGlzLmhpc3MoMC41LCAwLjA5LCAnaGlnaHBhc3MnLCA1MDAwLCAxLjIpOyB0aGlzLnRvbmUoMTEwLCAwLjMsICdzaW5lJywgMC4yNSwgMS4xNSwgNjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tDaGFyZ2UnOiB0aGlzLnRvbmUoOTAsIDEuMDUsICdzaW5lJywgMC4yNSwgMCwgMjYwLCAwLjIpOyB0aGlzLmhpc3MoMC45NSwgMC4xMiwgJ2xvd3Bhc3MnLCAzMDAsIDAsIDIyMDApOyB0aGlzLnRvbmUoMTgwLCAxLjAsICd0cmlhbmdsZScsIDAuMDYsIDAuMSwgNTIwLCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUaWVyVXAnOiBbNDQwLCA1NTQsIDY1OSwgODgwXS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA2KSk7IHRoaXMudG9uZSgxNzYwLCAwLjYsICdzaW5lJywgMC4wOSwgMC4yKTsgdGhpcy5oaXNzKDAuNCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUZWFyJzogdGhpcy5oaXNzKDAuMzUsIDAuMywgJ2JhbmRwYXNzJywgMTUwMCwgMCwgNjAwMCk7IHRoaXMudG9uZSgxMjAsIDAuNDUsICdzaW5lJywgMC40LCAwLjA1LCA0MCk7IFsxMDQ2LCAxMzE4LCAxNTY4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC42LCAndHJpYW5nbGUnLCAwLjEsIDAuMTIgKyBpICogMC4wNSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tGYW4nOiB0aGlzLmhpc3MoMC41LCAwLjEsICdoaWdocGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNjYwLCAwLjQ1LCAnc2luZScsIDAuMSwgMCwgMTMyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0ZsaXAnOiB0aGlzLmhpc3MoMC4wOCwgMC4xNSwgJ2JhbmRwYXNzJywgMjUwMCk7IHRoaXMudG9uZSg1MDAsIDAuMTIsICdzaW5lJywgMC4xNCwgMCwgODAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrUmFyZSc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzc4NCwgOTg4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40NSwgJ3RyaWFuZ2xlJywgMC4xNCwgMC4wNSArIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0VwaWMnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC43LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wNykpOyB0aGlzLnRvbmUoMTEwLCAwLjUsICdzaW5lJywgMC4zLCAwLCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0xlZ2VuZCc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA4KSk7IHRoaXMudG9uZSg4MiwgMC45LCAnc2luZScsIDAuMzUsIDAsIDUwKTsgdGhpcy5oaXNzKDAuOCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMjA5MywgMC43LCAnc2luZScsIDAuMDcsIDAuNCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NvbGxlY3QnOiBbNjU5LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wOSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3N0YXJ0JzogdGhpcy50b25lKDE0NywgMC45LCAnc2F3dG9vdGgnLCAwLjEzLCAwLCAxNTAsIDAuMTUsIDY1MCk7IHRoaXMudG9uZSgyMjAsIDAuOSwgJ3Nhd3Rvb3RoJywgMC4wOSwgMC4wNSwgMjI0LCAwLjE1LCA2NTApOyB0aGlzLmhpc3MoMC42LCAwLjA2LCAnbG93cGFzcycsIDYwMCk7IGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYXVkaW8gPSBuZXcgQXVkaW9FbmdpbmUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2F1ZGlvID0gYXVkaW87XG5cbi8vIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdG91Y2g6IHRoZSBmaXJzdCB0YXAgYW55d2hlcmUgdW5sb2NrcyBpdC4gRXZlcnkgYnV0dG9uIGFsc28gZ2V0cyBhIHNtYWxsIGNsaWNrLlxuLy8gaU9TIG9ubHkgYWNjZXB0cyBhbiB1bmxvY2sgZnJvbSBhIEZJTklTSEVEIHRhcCAodG91Y2hlbmQgLyBjbGljayksIG5vdCBmcm9tIHRoZSBzdGFydCBvZiBvbmUsIHNvIGxpc3RlbiB0byBhbGwgb2YgdGhlbS5cbmNvbnN0IHVubG9ja09uY2UgPSAoKSA9PiBhdWRpby51bmxvY2soKTtcbmZvciAoY29uc3QgZXYgb2YgWydwb2ludGVyZG93bicsICdwb2ludGVydXAnLCAndG91Y2hlbmQnLCAnY2xpY2snLCAna2V5ZG93biddKSBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKGV2LCB1bmxvY2tPbmNlLCB7IGNhcHR1cmU6IHRydWUgfSk7XG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGNvbnN0IGVsID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsOyBpZiAoZWwgJiYgZWwuY2xvc2VzdCAmJiBlbC5jbG9zZXN0KCdidXR0b24sIGEuYnRuLCAucmFpbCBhJykpIGF1ZGlvLnBsYXkoJ3RhcCcpOyB9LCB0cnVlKTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Zpc2liaWxpdHljaGFuZ2UnLCAoKSA9PiB7IGNvbnN0IGMgPSAoYXVkaW8gYXMgYW55KS5jdHggYXMgQXVkaW9Db250ZXh0IHwgbnVsbDsgaWYgKCFjKSByZXR1cm47IGlmIChkb2N1bWVudC5oaWRkZW4pIGMuc3VzcGVuZCgpOyBlbHNlIGlmIChhdWRpby5tdXNpYyB8fCBhdWRpby5zZngpIGMucmVzdW1lKCk7IH0pO1xud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzLWNoYW5nZWQnLCAoKSA9PiBhdWRpby5yZWxvYWQoKSk7XG4iLCAiLy8gU2F2aW5nIGEgcnVuIGluIHByb2dyZXNzIHNvIGl0IHN1cnZpdmVzIGEgcGFnZSByZWxvYWQgKFNhZmFyaSBvbiBhIHBob25lIGNhbiBkcm9wIHRoZSBwYWdlIGF0IGFueSB0aW1lKS5cbi8vIE9ubHkgY2FsbSBtb21lbnRzIGFyZSBzYXZlZDogdGhlIGJ1aWxkIHBoYXNlIGFuZCB0aGUgdmljdG9yeSBkcmFmdC4gQSBiYXR0bGUgaW4gcHJvZ3Jlc3MgaXMgbm90IHNhdmVkOyByZWxvYWRpbmcgZHVyaW5nIG9uZSBwdXRzIHlvdSBiYWNrXG4vLyBhdCB0aGUgYnVpbGQgc2NyZWVuIHlvdSBwcmVzc2VkIEJhdHRsZSBmcm9tIChub3RoaW5nIGxvc3QsIG5vdGhpbmcgZ2FpbmVkKS4gRXZlcnl0aGluZyByZWFkIGJhY2sgaXMgdmFsaWRhdGVkOyBhbnl0aGluZyBvZGQgaXMgaWdub3JlZC5cblxuaW1wb3J0IHsgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlLCBVbml0IH0gZnJvbSAnLi9ydWxlcy50cyc7XG5pbXBvcnQgeyBicm93c2VyU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5cbmNvbnN0IEtFWSA9ICduZWNyby1ydW4nO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VyaWFsaXplZFN0YXRlIHtcbiAgcnVsZXM6IFJ1bGVzOyBybmc6IHsgc2VlZDogbnVtYmVyOyBwb3M6IG51bWJlciB9O1xuICB3YXZlOiBudW1iZXI7IGhlYXJ0czogbnVtYmVyOyBjYXA6IG51bWJlcjsgaGFuZDogU291bElkW107IHVuaXRzOiBVbml0W107IG5leHRJZDogbnVtYmVyOyBkaXNjYXJkVXNlZDogYm9vbGVhbjtcbiAgc3RhdHVzOiAnYnVpbGRpbmcnOyBsb2c6IHN0cmluZ1tdOyBzdGF0czogU3RhdGVbJ3N0YXRzJ107XG59XG5leHBvcnQgaW50ZXJmYWNlIFJ1blNuYXBzaG90IHsgdjogbnVtYmVyOyBzZWVkOiBudW1iZXI7IGF0dGVtcHQ6IG51bWJlcjsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogc3RyaW5nOyBwaGFzZTogJ2J1aWxkJyB8ICdkcmFmdCc7IGRyYWZ0OiBTb3VsSWRbXSB8IG51bGw7IHN0YXRlOiBTZXJpYWxpemVkU3RhdGU7IHN0YXJ0QmVzdD86IG51bWJlciB9XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXJpYWxpemVTdGF0ZShzOiBTdGF0ZSk6IFNlcmlhbGl6ZWRTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgcnVsZXM6IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocy5ydWxlcykpLCBybmc6IHsgc2VlZDogcy5ybmcuc2VlZCwgcG9zOiBzLnJuZy5zdGF0ZSgpIH0sXG4gICAgd2F2ZTogcy53YXZlLCBoZWFydHM6IHMuaGVhcnRzLCBjYXA6IHMuY2FwLCBoYW5kOiBzLmhhbmQuc2xpY2UoKSwgdW5pdHM6IHMudW5pdHMubWFwKCh1KSA9PiAoeyAuLi51IH0pKSwgbmV4dElkOiBzLm5leHRJZCwgZGlzY2FyZFVzZWQ6IHMuZGlzY2FyZFVzZWQsXG4gICAgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IHMubG9nLnNsaWNlKC00MCksIHN0YXRzOiB7IC4uLnMuc3RhdHMgfSxcbiAgfTtcbn1cblxuY29uc3QgaXNTb3VsID0gKHg6IGFueSk6IHggaXMgU291bElkID0+IFNPVUxTLmluY2x1ZGVzKHgpO1xuY29uc3QgaW50ID0gKHg6IGFueSwgbG86IG51bWJlciwgaGk6IG51bWJlcikgPT4gTnVtYmVyLmlzSW50ZWdlcih4KSAmJiB4ID49IGxvICYmIHggPD0gaGk7XG5cbi8qKiBSZWJ1aWxkIGEgU3RhdGUgZnJvbSBzYXZlZCBkYXRhLCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IGl0IGlzIG5vdCBiZWxpZXZhYmxlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplU3RhdGUoeDogYW55KTogU3RhdGUgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBpZiAoIXggfHwgdHlwZW9mIHggIT09ICdvYmplY3QnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCByID0geC5ydWxlcztcbiAgICBpZiAoIXIgfHwgIUFycmF5LmlzQXJyYXkoci5jdXJ2ZSkgfHwgIXIuY3VydmUubGVuZ3RoIHx8ICFyLmN1cnZlLmV2ZXJ5KChuOiBhbnkpID0+IE51bWJlci5pc0Zpbml0ZShuKSAmJiBuID4gMCkpIHJldHVybiBudWxsO1xuICAgIGlmIChyLm1lcmdlICE9PSAnZGVwbG95ZWRPbmx5JyAmJiByLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIucG9vbCAhPT0gdW5kZWZpbmVkICYmICEoQXJyYXkuaXNBcnJheShyLnBvb2wpICYmIHIucG9vbC5sZW5ndGggJiYgci5wb29sLmV2ZXJ5KGlzU291bCkpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGFnZVdhdmVzID0gci5zdGFnZVdhdmVzID8/IHIuY3VydmUubGVuZ3RoO1xuICAgIGlmICghaW50KHgud2F2ZSwgMSwgTWF0aC5taW4oc3RhZ2VXYXZlcywgci5jdXJ2ZS5sZW5ndGgpKSB8fCAhaW50KHguaGVhcnRzLCAxLCBIRUFSVFMpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5jYXApIHx8IHguY2FwIDw9IDApIHJldHVybiBudWxsO1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh4LmhhbmQpIHx8IHguaGFuZC5sZW5ndGggPiA0MCB8fCAheC5oYW5kLmV2ZXJ5KGlzU291bCkpIHJldHVybiBudWxsO1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh4LnVuaXRzKSB8fCB4LnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIHJldHVybiBudWxsO1xuICAgIGlmICghaW50KHgubmV4dElkLCAxLCAxZTYpIHx8IHR5cGVvZiB4LmRpc2NhcmRVc2VkICE9PSAnYm9vbGVhbicpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNlbGxzID0gbmV3IFNldDxudW1iZXI+KCksIGlkcyA9IG5ldyBTZXQ8bnVtYmVyPigpLCB1bml0czogVW5pdFtdID0gW107XG4gICAgZm9yIChjb25zdCB1IG9mIHgudW5pdHMpIHtcbiAgICAgIGlmICghdSB8fCAhaXNTb3VsKHUuc291bCkgfHwgIWludCh1LnN0YXIsIDEsIE1BWF9TVEFSKSB8fCAhaW50KHUuY2VsbCwgMCwgR1JJRF9DRUxMUyAtIDEpIHx8ICFpbnQodS5pZCwgMSwgeC5uZXh0SWQpIHx8IGNlbGxzLmhhcyh1LmNlbGwpIHx8IGlkcy5oYXModS5pZCkpIHJldHVybiBudWxsO1xuICAgICAgY2VsbHMuYWRkKHUuY2VsbCk7IGlkcy5hZGQodS5pZCk7IHVuaXRzLnB1c2goeyBpZDogdS5pZCwgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCwgZnJlc2g6ICEhdS5mcmVzaCB9KTtcbiAgICB9XG4gICAgY29uc3Qgc3QgPSB4LnN0YXRzO1xuICAgIGlmICghc3QgfHwgIVsnZHJhd24nLCAnZGlzY2FyZGVkJywgJ2Rpc21pc3NlZCcsICdtZXJnZXMnLCAnZmFpbHVyZXMnXS5ldmVyeSgoaykgPT4gTnVtYmVyLmlzRmluaXRlKHN0W2tdKSkpIHJldHVybiBudWxsO1xuICAgIGlmICgheC5ybmcgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnJuZy5zZWVkKSB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnBvcykpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICBydWxlczogciBhcyBSdWxlcywgcm5nOiBtYWtlUm5nKHgucm5nLnNlZWQsIHgucm5nLnBvcyksIHdhdmU6IHgud2F2ZSwgaGVhcnRzOiB4LmhlYXJ0cywgY2FwOiB4LmNhcCwgaGFuZDogeC5oYW5kLnNsaWNlKCksIHVuaXRzLCBuZXh0SWQ6IHgubmV4dElkLFxuICAgICAgZGlzY2FyZFVzZWQ6IHguZGlzY2FyZFVzZWQsIHN0YXR1czogJ2J1aWxkaW5nJywgbG9nOiBBcnJheS5pc0FycmF5KHgubG9nKSA/IHgubG9nLmZpbHRlcigobDogYW55KSA9PiB0eXBlb2YgbCA9PT0gJ3N0cmluZycpLnNsaWNlKC00MCkgOiBbXSxcbiAgICAgIHN0YXRzOiB7IGRyYXduOiBzdC5kcmF3biwgZGlzY2FyZGVkOiBzdC5kaXNjYXJkZWQsIGRpc21pc3NlZDogc3QuZGlzbWlzc2VkLCBtZXJnZXM6IHN0Lm1lcmdlcywgZmFpbHVyZXM6IHN0LmZhaWx1cmVzIH0sXG4gICAgfTtcbiAgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYXZlUnVuKHNuYXA6IFJ1blNuYXBzaG90LCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlKSBzdG9yZS5zZXRJdGVtKEtFWSwgSlNPTi5zdHJpbmdpZnkoc25hcCkpOyB9IGNhdGNoIHsgLyogc3RvcmFnZSBmdWxsIG9yIGJsb2NrZWQ6IHRoZSBydW4ganVzdCB3aWxsIG5vdCBzdXJ2aXZlIGEgcmVsb2FkICovIH1cbn1cbmV4cG9ydCBmdW5jdGlvbiBjbGVhclJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlICYmIChzdG9yZSBhcyBhbnkpLnJlbW92ZUl0ZW0pIChzdG9yZSBhcyBhbnkpLnJlbW92ZUl0ZW0oS0VZKTsgZWxzZSBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCAnJyk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRSdW4oc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogeyBzbmFwOiBSdW5TbmFwc2hvdDsgc3RhdGU6IFN0YXRlIH0gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB0ID0gc3RvcmUgJiYgc3RvcmUuZ2V0SXRlbShLRVkpOyBpZiAoIXQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHggPSBKU09OLnBhcnNlKHQpO1xuICAgIGlmICgheCB8fCB4LnYgIT09IFZFUlNJT04gfHwgKHgucGhhc2UgIT09ICdidWlsZCcgJiYgeC5waGFzZSAhPT0gJ2RyYWZ0JykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5hdHRlbXB0KSB8fCB0eXBlb2YgeC5kaWZmaWN1bHR5ICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgc3RhdGUgPSBkZXNlcmlhbGl6ZVN0YXRlKHguc3RhdGUpOyBpZiAoIXN0YXRlKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBkcmFmdCA9IHgucGhhc2UgPT09ICdkcmFmdCcgJiYgQXJyYXkuaXNBcnJheSh4LmRyYWZ0KSAmJiB4LmRyYWZ0Lmxlbmd0aCA9PT0gMyAmJiB4LmRyYWZ0LmV2ZXJ5KGlzU291bCkgPyB4LmRyYWZ0IDogbnVsbDtcbiAgICByZXR1cm4geyBzbmFwOiB7IHY6IFZFUlNJT04sIHNlZWQ6IHguc2VlZCwgYXR0ZW1wdDogeC5hdHRlbXB0LCBzdGFnZTogdHlwZW9mIHguc3RhZ2UgPT09ICdzdHJpbmcnID8geC5zdGFnZSA6ICdjcnlwdCcsIGRpZmZpY3VsdHk6IHguZGlmZmljdWx0eSwgcGhhc2U6IGRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCcsIGRyYWZ0LCBzdGF0ZTogeC5zdGF0ZSwgc3RhcnRCZXN0OiBOdW1iZXIuaXNJbnRlZ2VyKHguc3RhcnRCZXN0KSAmJiB4LnN0YXJ0QmVzdCA+PSAwICYmIHguc3RhcnRCZXN0IDw9IDk5OTkgPyB4LnN0YXJ0QmVzdCA6IHVuZGVmaW5lZCB9LCBzdGF0ZSB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cbmV4cG9ydCBjb25zdCBSVU5fVkVSU0lPTiA9IFZFUlNJT047XG4iLCAiLy8gUGVybWFuZW50IHByb2dyZXNzaW9uOiBzdGFnZSBjbGVhcnMgLT4gU291bCBQYWNrcyAtPiBjb3BpZXMgLT4gU291bCBsZXZlbHMuIFB1cmUgZnVuY3Rpb25zIHRoYXQgY2hhbmdlIGEgU2F2ZSAodGhlIGNhbGxlciBwZXJzaXN0cyBpdCkuXG4vLyBQbGFjZWhvbGRlciBudW1iZXJzLCBsaWtlIHBhY2tzLnRzLiBJbi1ydW4gc3RhciBtZXJnaW5nIGlzIGEgc2VwYXJhdGUsIHRlbXBvcmFyeSBzeXN0ZW0gYW5kIG5ldmVyIHRvdWNoZXMgYW55IG9mIHRoaXMuXG5cbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19QQUNLX0VWRVJZLCBlbmRsZXNzUGFja1RpZXIgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgTEVWRUxfQ09TVF9NVUxULCBQQUNLX1RJRVJTLCBSQVJJVFlfT0YsIG9wZW5QYWNrIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtLCBQYWNrUmVzdWx0IH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlLCB3cml0ZVNhdmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHsgU1RBR0VTLCBzdGFnZUJ5SWQsIHN0YWdlSW5kZXggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB0eXBlIHsgRGlmZmljdWx0eSwgU2F2ZSwgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5leHBvcnQgY29uc3QgTUFYX1BBQ0tTID0gOTk7XG5cbi8qKiBXaGVyZSBwYWNrcyBjb21lIGZyb20uIFBMQUNFSE9MREVSLiBGaXJzdCBjbGVhciBvZiBhIHN0YWdlIG9uIGVhY2ggZGlmZmljdWx0eSBnaXZlcyBvbmUgaW1wcm92ZWQgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgYSBtZXRlci4gKi9cbmV4cG9ydCBjb25zdCBSRVdBUkRTID0ge1xuICBmaXJzdENsZWFyVGllcjogeyBlYXN5OiAxLCBub3JtYWw6IDIsIGhhcmQ6IDIsIG5pZ2h0bWFyZTogMyB9IGFzIFJlY29yZDxEaWZmaWN1bHR5LCBudW1iZXI+LFxuICByZXBsYXlUaWVyOiAxLFxuICByZXBsYXlDbGVhcnNQZXJQYWNrOiAyLFxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGxldmVsc1xuZXhwb3J0IGNvbnN0IG1heExldmVsID0gKCk6IG51bWJlciA9PiBCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWwubGVuZ3RoICsgMTtcbmV4cG9ydCBjb25zdCBpc01heExldmVsID0gKGxldmVsOiBudW1iZXIpOiBib29sZWFuID0+IGxldmVsID49IG1heExldmVsKCk7XG4vKiogQ29waWVzIG5lZWRlZCB0byB0YWtlIGBzb3VsYCBmcm9tIGBsZXZlbGAgdG8gdGhlIG5leHQgb25lICgwIHdoZW4gYWxyZWFkeSBtYXgpLiBSYXJlciBTb3VscyBuZWVkIGZld2VyLiAqL1xuZXhwb3J0IGNvbnN0IGNvcGllc05lZWRlZCA9IChsZXZlbDogbnVtYmVyLCBzb3VsOiBTb3VsSWQpOiBudW1iZXIgPT4gKGlzTWF4TGV2ZWwobGV2ZWwpID8gMCA6IE1hdGgubWF4KDEsIE1hdGgucm91bmQoQkFMQU5DRS5sZXZlbC5jb3BpZXNUb0xldmVsW2xldmVsIC0gMV0gKiBMRVZFTF9DT1NUX01VTFRbUkFSSVRZX09GW3NvdWxdXSkpKTtcbi8qKlxuICogT25lIHJlcXVpcmVtZW50IG9mIGFuIHVwZ3JhZGUuIFRvZGF5IG9ubHkgY29waWVzOyB0aGUgY29uZmlybSBwb3B1cCBsaXN0cyBldmVyeSBlbnRyeSB3aXRoIGhhdmUgLyBuZWVkLCBhbmQgQ29uZmlybSBpcyBhbGxvd2VkIG9ubHkgd2hlbiBhbGwgYXJlIG1ldC5cbiAqIEdvbGQgd2lsbCBzaW1wbHkgYmVjb21lIGEgc2Vjb25kIGVudHJ5IGhlcmUgKHsgaWQ6ICdnb2xkJywgLi4uIH0pIGFuZCBiZSBzcGVudCBpbiBsZXZlbFVwKCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBncmFkZUNvc3QgeyBpZDogJ2NvcGllcyc7IGxhYmVsOiBzdHJpbmc7IGhhdmU6IG51bWJlcjsgbmVlZDogbnVtYmVyOyBvazogYm9vbGVhbiB9XG5leHBvcnQgZnVuY3Rpb24gdXBncmFkZUNvc3RzKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IFVwZ3JhZGVDb3N0W10ge1xuICBjb25zdCBwID0gc2F2ZS5zb3Vsc1tzb3VsXTsgaWYgKGlzTWF4TGV2ZWwocC5sZXZlbCkpIHJldHVybiBbXTtcbiAgY29uc3QgbmVlZCA9IGNvcGllc05lZWRlZChwLmxldmVsLCBzb3VsKTtcbiAgcmV0dXJuIFt7IGlkOiAnY29waWVzJywgbGFiZWw6ICdDb3BpZXMnLCBoYXZlOiBwLmNvcGllcywgbmVlZCwgb2s6IHAuY29waWVzID49IG5lZWQgfV07XG59XG5leHBvcnQgY29uc3QgY2FuQWZmb3JkID0gKGNvc3RzOiBVcGdyYWRlQ29zdFtdKTogYm9vbGVhbiA9PiBjb3N0cy5sZW5ndGggPiAwICYmIGNvc3RzLmV2ZXJ5KChjKSA9PiBjLm9rKTtcbmV4cG9ydCBjb25zdCBjYW5MZXZlbFVwID0gKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4gPT4gY2FuQWZmb3JkKHVwZ3JhZGVDb3N0cyhzYXZlLCBzb3VsKSk7XG4vKiogUGF5IGV2ZXJ5IGNvc3QgYW5kIGdhaW4gYSBsZXZlbC4gUmV0dXJucyBmYWxzZSAoYW5kIGNoYW5nZXMgbm90aGluZykgaWYgdGhlIFNvdWwgaXMgbm90IHJlYWR5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxldmVsVXAoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogYm9vbGVhbiB7XG4gIGNvbnN0IGNvc3RzID0gdXBncmFkZUNvc3RzKHNhdmUsIHNvdWwpOyBpZiAoIWNhbkFmZm9yZChjb3N0cykpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IGZvciAoY29uc3QgYyBvZiBjb3N0cykgaWYgKGMuaWQgPT09ICdjb3BpZXMnKSBwLmNvcGllcyAtPSBjLm5lZWQ7XG4gIHAubGV2ZWwrKzsgcmV0dXJuIHRydWU7XG59XG4vKiogRGVidWdnaW5nOiBwdXQgZXZlcnkgU291bCBiYWNrIHRvIGxldmVsIDEgKGNvcGllcyBhcmUga2VwdCkuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRMZXZlbHMoc2F2ZTogU2F2ZSk6IHZvaWQgeyBmb3IgKGNvbnN0IGsgb2YgU09VTFMpIHNhdmUuc291bHNba10ubGV2ZWwgPSAxOyB9XG4vKiogRGVidWdnaW5nOiBmb3JnZXQgYWxsIGNvbGxlY3RlZCBjb3BpZXMgKGxldmVscyBhcmUga2VwdCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJDb3BpZXMoc2F2ZTogU2F2ZSk6IHZvaWQgeyBmb3IgKGNvbnN0IGsgb2YgU09VTFMpIHNhdmUuc291bHNba10uY29waWVzID0gMDsgfVxuLyoqIE11bHRpcGxpZXIgYXBwbGllZCB0byBhIFNvdWwncyBoZWFsdGgvZGFtYWdlIGZyb20gaXRzIHBlcm1hbmVudCBsZXZlbCAobGV2ZWwgMSA9IDEuMCkuICovXG5leHBvcnQgY29uc3QgbGV2ZWxNdWx0ID0gKGxldmVsOiBudW1iZXIsIHN0YXQ6ICdocCcgfCAnZG1nJyk6IG51bWJlciA9PiAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQkFMQU5DRS5sZXZlbFtzdGF0XTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBhY2tzXG5leHBvcnQgZnVuY3Rpb24gZ3JhbnRQYWNrKHNhdmU6IFNhdmUsIHRpZXI6IG51bWJlciwgc291cmNlOiBzdHJpbmcpOiBQYWNrSXRlbSB8IG51bGwge1xuICBpZiAoc2F2ZS5wYWNrcy5sZW5ndGggPj0gTUFYX1BBQ0tTKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGFjazogUGFja0l0ZW0gPSB7IGlkOiBzYXZlLm5leHRQYWNrSWQrKywgdGllcjogTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcih0aWVyKSkpLCBzb3VyY2UgfTtcbiAgc2F2ZS5wYWNrcy5wdXNoKHBhY2spOyByZXR1cm4gcGFjaztcbn1cblxuLyoqIE9wZW4gYW4gb3duZWQgcGFjazogaXQgaXMgcmVtb3ZlZCBhbmQgaXRzIGNvcGllcyBhcmUgYWRkZWQgdG8gdGhlIFNvdWxzIGltbWVkaWF0ZWx5IChzbyBub3RoaW5nIGlzIGxvc3QgaWYgdGhlIHBhZ2UgY2xvc2VzIG1pZC1hbmltYXRpb24pLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5Pd25lZFBhY2soc2F2ZTogU2F2ZSwgcGFja0lkOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB8IG51bGwge1xuICBjb25zdCBpID0gc2F2ZS5wYWNrcy5maW5kSW5kZXgoKHApID0+IHAuaWQgPT09IHBhY2tJZCk7IGlmIChpIDwgMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhY2sgPSBzYXZlLnBhY2tzW2ldOyBzYXZlLnBhY2tzLnNwbGljZShpLCAxKTtcbiAgY29uc3QgcmVzdWx0ID0gb3BlblBhY2socGFjay50aWVyLCBybmcpO1xuICBmb3IgKGNvbnN0IHIgb2YgcmVzdWx0LnJldmVhbHMpIHNhdmUuc291bHNbci5zb3VsXS5jb3BpZXMgKz0gci5jb3BpZXM7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xlYXJSZXdhcmQgeyBmaXJzdDogYm9vbGVhbjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyByZXBsYXlNZXRlcjogbnVtYmVyOyByZXBsYXlOZWVkZWQ6IG51bWJlcjsgdW5sb2NrZWQ6IHN0cmluZ1tdIH1cbi8qKiBBIHN0YWdlIHdhcyBjbGVhcmVkIG9uIGBkaWZmaWN1bHR5YC4gVGhlIGZpcnN0IGNsZWFyIG9uIHRoYXQgZGlmZmljdWx0eSBncmFudHMgYSBiZXR0ZXIgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgdGhlIHJlcGxheSBtZXRlci4gKi9cbmZ1bmN0aW9uIHJlY29yZENsZWFyQmFzZShzYXZlOiBTYXZlLCBzdGFnZUlkOiBzdHJpbmcsIGRpZmZpY3VsdHk6IERpZmZpY3VsdHkpOiBPbWl0PENsZWFyUmV3YXJkLCAndW5sb2NrZWQnPiB7XG4gIGNvbnN0IGtleSA9IHN0YWdlSWQgKyAnOicgKyBkaWZmaWN1bHR5LCBiZWZvcmUgPSBzYXZlLmNsZWFyc1trZXldID8/IDA7XG4gIHNhdmUuY2xlYXJzW2tleV0gPSBiZWZvcmUgKyAxO1xuICBpZiAoYmVmb3JlID09PSAwKSByZXR1cm4geyBmaXJzdDogdHJ1ZSwgcGFjazogZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMuZmlyc3RDbGVhclRpZXJbZGlmZmljdWx0eV0sICdGaXJzdCBjbGVhciBcdTAwQjcgJyArIGRpZmZpY3VsdHkpLCByZXBsYXlNZXRlcjogc2F2ZS5yZXBsYXlNZXRlciwgcmVwbGF5TmVlZGVkOiBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2sgfTtcbiAgc2F2ZS5yZXBsYXlNZXRlcisrO1xuICBsZXQgcGFjazogUGFja0l0ZW0gfCBudWxsID0gbnVsbDtcbiAgaWYgKHNhdmUucmVwbGF5TWV0ZXIgPj0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrKSB7IHNhdmUucmVwbGF5TWV0ZXIgLT0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrOyBwYWNrID0gZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMucmVwbGF5VGllciwgJ1JlcGxheSByZXdhcmQnKTsgfVxuICByZXR1cm4geyBmaXJzdDogZmFsc2UsIHBhY2ssIHJlcGxheU1ldGVyOiBzYXZlLnJlcGxheU1ldGVyLCByZXBsYXlOZWVkZWQ6IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjayB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyc2lzdGVkIHdyYXBwZXJzICh1c2VkIGJ5IHRoZSBnYW1lIGJ1bmRsZSlcbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRDbGVhckFuZFNhdmUoc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5LCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZENsZWFyKHMsIHN0YWdlSWQsIGRpZmZpY3VsdHkpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEVuZGxlc3MgRGVwdGhzXG5leHBvcnQgaW50ZXJmYWNlIEVuZGxlc3NSZXdhcmQgeyB3YXZlOiBudW1iZXI7IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgbmV3QmVzdDogYm9vbGVhbiB9XG4vKiogV2F2ZSBgd2F2ZWAgb2YgYW4gZW5kbGVzcyBydW4gd2FzIGNsZWFyZWQ6IGEgcGFjayBvbiBldmVyeSAxMHRoIHdhdmUgKGJldHRlciB0aWVycyBkZWVwZXIpLCBhbmQgdGhlIGJlc3QgZGVwdGggaXMgcmVtZW1iZXJlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFbmRsZXNzV2F2ZShzYXZlOiBTYXZlLCB3YXZlOiBudW1iZXIpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgbmV3QmVzdCA9IHdhdmUgPiBzYXZlLmVuZGxlc3MuYmVzdDsgaWYgKG5ld0Jlc3QpIHNhdmUuZW5kbGVzcy5iZXN0ID0gd2F2ZTtcbiAgY29uc3QgcGFjayA9IHdhdmUgPiAwICYmIHdhdmUgJSBFTkRMRVNTX1BBQ0tfRVZFUlkgPT09IDAgPyBncmFudFBhY2soc2F2ZSwgZW5kbGVzc1BhY2tUaWVyKHdhdmUpLCAnRW5kbGVzcyBcdTAwQjcgd2F2ZSAnICsgd2F2ZSkgOiBudWxsO1xuICByZXR1cm4geyB3YXZlLCBwYWNrLCBuZXdCZXN0IH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlKHdhdmU6IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZEVuZGxlc3NXYXZlKHMsIHdhdmUpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cbi8qKiBFbmRsZXNzIERlcHRocyBvcGVucyBvbmNlIHRoZSBsYXN0IGNhbXBhaWduIHN0YWdlIGhhcyBiZWVuIGNsZWFyZWQgb24gTm9ybWFsLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NVbmxvY2tlZCA9IChzYXZlOiBTYXZlKTogYm9vbGVhbiA9PiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tTVEFHRVMubGVuZ3RoIC0gMV0uaWQsICdub3JtYWwnKSA+IDA7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB1bmxvY2sgcnVsZXNcbi8vIEVhc3kgYW5kIE5vcm1hbCBhcmUgb3BlbiBvbiBldmVyeSB1bmxvY2tlZCBzdGFnZS4gQ2xlYXJpbmcgTm9ybWFsIG9wZW5zIEhhcmQgb24gdGhhdCBzdGFnZSBBTkQgdW5sb2NrcyB0aGUgbmV4dCBzdGFnZS4gQ2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5leHBvcnQgY29uc3QgY2xlYXJDb3VudCA9IChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogbnVtYmVyID0+IHNhdmUuY2xlYXJzW3N0YWdlICsgJzonICsgZF0gPz8gMDtcbmV4cG9ydCBmdW5jdGlvbiBzdGFnZVVubG9ja2VkKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBib29sZWFuIHsgcmV0dXJuIGluZGV4IDw9IDAgfHwgKGluZGV4IDwgU1RBR0VTLmxlbmd0aCAmJiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tpbmRleCAtIDFdLmlkLCAnbm9ybWFsJykgPiAwKTsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogYm9vbGVhbiB7XG4gIGNvbnN0IGlkeCA9IFNUQUdFUy5maW5kSW5kZXgoKHMpID0+IHMuaWQgPT09IHN0YWdlKTsgaWYgKGlkeCA8IDAgfHwgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZCA9PT0gJ2Vhc3knIHx8IGQgPT09ICdub3JtYWwnKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIGQgPT09ICdoYXJkJyA/IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdub3JtYWwnKSA+IDAgOiBjbGVhckNvdW50KHNhdmUsIHN0YWdlLCAnaGFyZCcpID4gMDtcbn1cbi8qKiBXaHkgYSBzdGFnZSBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhZ2VMb2NrUmVhc29uKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBzdHJpbmcgeyByZXR1cm4gc3RhZ2VVbmxvY2tlZChzYXZlLCBpbmRleCkgPyAnJyA6ICdDbGVhciAnICsgU1RBR0VTW2luZGV4IC0gMV0ubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jay4nOyB9XG4vKiogV2h5IGEgdGllciBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgc3RhZ2U6IHN0cmluZywgZDogRGlmZmljdWx0eSk6IHN0cmluZyB7XG4gIGlmIChkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIGQpKSByZXR1cm4gJyc7XG4gIGNvbnN0IGlkeCA9IHN0YWdlSW5kZXgoc3RhZ2UpOyBpZiAoIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIHN0YWdlTG9ja1JlYXNvbihzYXZlLCBpZHgpO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIE5vcm1hbCB0byB1bmxvY2sgSGFyZC4nIDogJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIEhhcmQgdG8gdW5sb2NrIE5pZ2h0bWFyZS4nO1xufVxuLyoqIFdoYXRldmVyIHdhcyBzYXZlZCwgbWFrZSBpdCBhIHN0YWdlIGFuZCB0aWVyIHRoZSBwbGF5ZXIgbWF5IGFjdHVhbGx5IHBsYXkuICovXG5leHBvcnQgZnVuY3Rpb24gcGxheWFibGUoc2F2ZTogU2F2ZSk6IHsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogRGlmZmljdWx0eSB9IHtcbiAgbGV0IGlkeCA9IHN0YWdlSW5kZXgoc2F2ZS5zdGFnZSk7IHdoaWxlIChpZHggPiAwICYmICFzdGFnZVVubG9ja2VkKHNhdmUsIGlkeCkpIGlkeC0tO1xuICBjb25zdCBzdGFnZSA9IFNUQUdFU1tpZHhdLmlkO1xuICByZXR1cm4geyBzdGFnZSwgZGlmZmljdWx0eTogZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0YWdlLCBzYXZlLmRpZmZpY3VsdHkpID8gc2F2ZS5kaWZmaWN1bHR5IDogJ25vcm1hbCcgfTtcbn1cblxuLyoqIEV2ZXJ5IHVubG9jayB0aGUgcGxheWVyIG1heSBiZSBjZWxlYnJhdGVkIGZvcjogbGF0ZXIgc3RhZ2VzIGFuZCB0aGUgSGFyZCAvIE5pZ2h0bWFyZSB0aWVycyAoRWFzeSwgTm9ybWFsIGFuZCBTdGFnZSAxIGFyZSBvcGVuIGZyb20gdGhlIHN0YXJ0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmxvY2tlZEtleXMoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qga2V5czogc3RyaW5nW10gPSBbXTtcbiAgU1RBR0VTLmZvckVhY2goKHN0LCBpKSA9PiB7XG4gICAgaWYgKGkgPiAwICYmIHN0YWdlVW5sb2NrZWQoc2F2ZSwgaSkpIGtleXMucHVzaCgnc3RhZ2U6JyArIHN0LmlkKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgWydoYXJkJywgJ25pZ2h0bWFyZSddIGFzIERpZmZpY3VsdHlbXSkgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdC5pZCwgZCkpIGtleXMucHVzaCgndGllcjonICsgc3QuaWQgKyAnOicgKyBkKTtcbiAgfSk7XG4gIGlmIChlbmRsZXNzVW5sb2NrZWQoc2F2ZSkpIGtleXMucHVzaCgnZW5kbGVzcycpO1xuICByZXR1cm4ga2V5cztcbn1cbi8qKiBVbmxvY2tzIG5vdCB5ZXQgY2VsZWJyYXRlZC4gKi9cbmV4cG9ydCBjb25zdCBuZXdVbmxvY2tzID0gKHNhdmU6IFNhdmUpOiBzdHJpbmdbXSA9PiB1bmxvY2tlZEtleXMoc2F2ZSkuZmlsdGVyKChrKSA9PiAhKHNhdmUuc2VlbiA/PyBbXSkuaW5jbHVkZXMoaykpO1xuY29uc3QgVElFUl9OQU1FOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBoYXJkOiAnSGFyZCBtb2RlJywgbmlnaHRtYXJlOiAnTmlnaHRtYXJlIG1vZGUnIH07XG4vKiogV29yZHMgZm9yIGFuIHVubG9jayBrZXksIGZvciBiYW5uZXJzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlVW5sb2NrKGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGtleSA9PT0gJ2VuZGxlc3MnKSByZXR1cm4gJ0VuZGxlc3MgRGVwdGhzIChuZXcgbW9kZSknO1xuICBjb25zdCBba2luZCwgc3RhZ2UsIHRpZXJdID0ga2V5LnNwbGl0KCc6Jyk7XG4gIGlmIChraW5kID09PSAnc3RhZ2UnKSByZXR1cm4gc3RhZ2VCeUlkKHN0YWdlKS5uYW1lICsgJyAobmV3IHN0YWdlKSc7XG4gIHJldHVybiAoVElFUl9OQU1FW3RpZXJdID8/IHRpZXIpICsgJyBvbiAnICsgc3RhZ2VCeUlkKHN0YWdlKS5uYW1lO1xufVxuLyoqIENsZWFyaW5nIGEgc3RhZ2U6IHJld2FyZHMsIGFuZCB3aGljaCB1bmxvY2tzIHRoaXMgY2xlYXIgb3BlbmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgYmVmb3JlID0gdW5sb2NrZWRLZXlzKHNhdmUpLCByID0gcmVjb3JkQ2xlYXJCYXNlKHNhdmUsIHN0YWdlSWQsIGRpZmZpY3VsdHkpO1xuICByZXR1cm4geyAuLi5yLCB1bmxvY2tlZDogdW5sb2NrZWRLZXlzKHNhdmUpLmZpbHRlcigoaykgPT4gIWJlZm9yZS5pbmNsdWRlcyhrKSkgfTtcbn1cbiIsICIvLyBFdmVyeXRoaW5nIHlvdSBTRUUgZm9yIGEgdW5pdDogcmVhbCBUcmlwbyBtb2RlbHMgKFNrZWxldG9uIFdhcnJpb3IsIFNrZWxldG9uIEFyY2hlciksIHNpbXBsZSBzdGFuZC1pbnMgZm9yIHRoZSBmb3VyXG4vLyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBnZW5lcmF0ZWQgeWV0LCBhbmQgdGhlIFwic3RhciBsb29rXCIgbGF5ZXJlZCBvbiB0b3Agb2YgYm90aCAoc2l6ZSwgdGludCwgYXVyYSwgaGFsbywgYmFkZ2UpLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcblxuZXhwb3J0IHR5cGUgVlN0YXRlID0gJ2lkbGUnIHwgJ3J1bicgfCAnYXR0YWNrJyB8ICdkZWF0aCcgfCAnc3Bhd24nIHwgJ2NoZWVyJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uICsgeWF3IGhlcmVcbiAgdGVhbTogMCB8IDE7IHN0YXI6IG51bWJlcjsgc3RhdGU6IFZTdGF0ZTsgdG9wOiBudW1iZXI7XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQ/OiBudW1iZXIpOiB2b2lkO1xuICBzZXRTdGFyKHN0YXI6IG51bWJlcik6IHZvaWQ7XG4gIHNldFRlYW0odGVhbTogMCB8IDEpOiB2b2lkO1xuICBzZXRIcChmcmFjOiBudW1iZXIgfCBudWxsKTogdm9pZDsgIC8vIG51bGwgaGlkZXMgdGhlIGhlYWx0aCBiYXJcbiAgc2V0TWFuYShmcmFjOiBudW1iZXIgfCBudWxsKTogdm9pZDsgLy8gbnVsbCBoaWRlcyB0aGUgbWFuYSBiYXIgKHVuaXRzIHdpdGhvdXQgYSBza2lsbClcbiAgcHVsc2UoKTogdm9pZDsgICAgICAgICAgICAgICAgICAgICAvLyBicmllZiBoaXQgcmVhY3Rpb25cbiAgdXBkYXRlKGR0OiBudW1iZXIpOiB2b2lkO1xuICBkaXNwb3NlKCk6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhciBsb29rc1xuLy8gMSBzdGFyID0gdGhlIHBsYWluIG1vZGVsLiAyIHN0YXJzID0gYSBsaXR0bGUgYmlnZ2VyLCBjb29sIHNpbHZlci1ibHVlIHRpbnQsIGJyaWdodGVyIGF1cmEuIDMgc3RhcnMgPSBiaWdnZXN0LCB3YXJtIGdvbGQgdGludCxcbi8vIHN0cm9uZyBnb2xkLXZpb2xldCBhdXJhIGFuZCBhIGZsb2F0aW5nIGdvbGQgaGFsby4gRXZlcnl0aGluZyBoZXJlIGlzIGZyZWU6IG5vIGV4dHJhIFRyaXBvIGdlbmVyYXRpb25zLlxuY29uc3QgVElOVDogbnVtYmVyW11bXSA9IFtbMSwgMSwgMV0sIFswLjg2LCAwLjk1LCAxLjE4XSwgWzEuMjUsIDEuMSwgMC43XV07XG5jb25zdCBBVVJBID0gW1xuICB7IHJhdGU6IDE0LCBtaW46IDAuMDYsIG1heDogMC4xNiwgYzE6IFswLjc4LCAwLjM1LCAxLCAwLjddLCBjMjogWzAuNDUsIDAuMTUsIDAuOSwgMC41XSB9LFxuICB7IHJhdGU6IDI2LCBtaW46IDAuMDgsIG1heDogMC4yMCwgYzE6IFswLjg1LCAwLjY1LCAxLCAwLjhdLCBjMjogWzAuNTUsIDAuNCwgMSwgMC42XSB9LFxuICB7IHJhdGU6IDQ0LCBtaW46IDAuMTAsIG1heDogMC4yNiwgYzE6IFsxLCAwLjg1LCAwLjQsIDAuODVdLCBjMjogWzAuOCwgMC4zLCAxLCAwLjddIH0sXG5dO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFzc2V0cyB7XG4gIHNjZW5lOiBhbnk7IHNvZnQ6IGFueTsgc3RhclRleDogYW55W107IHRyaXBvOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIFRyaXBvQ2ZnPj47IGVtb3RlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICByaW5nTWF0OiBhbnlbXTsgaGFsb01hdDogYW55OyBiYXJCZzogYW55OyBiYXJGaWxsOiBhbnlbXTsgbWFuYUZpbGw6IGFueTsgYXJyb3c/OiBhbnk7IG5lY3JvPzogYW55O1xufVxuLyoqIEZsYXZvdXIgYSB1bml0IGNhbiBoYXZlOiBhIGNsaXAgaXQgcGxheXMgbm93IGFuZCB0aGVuIHdoZW4gaXQgaGFzIHN0b29kIGlkbGUgZm9yIGEgd2hpbGUsIGEgc21hbGwgZW1vdGUsIGFuZCBhbiBleWUtZ2xvdyBtYXNrIChleWVzIGRpbSB3aGVuIHNsZWVweSwgZmxhcmUgd2hlbiBpdCBmaWdodHMpLiAqL1xuaW50ZXJmYWNlIFBvc2UgeyBjbGlwOiBzdHJpbmc7IGVtb3RlPzogc3RyaW5nIH1cbmludGVyZmFjZSBGbGF2b3IgeyBjbGlwczogUG9zZVtdOyBtaW46IG51bWJlcjsgbWF4OiBudW1iZXIgfVxuaW50ZXJmYWNlIFRyaXBvQ2ZnIHsgY29udGFpbmVyOiBhbnk7IGVuZW15VGV4OiBhbnk7IGNsaXBzOiBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+OyBtYXRDYWNoZTogUmVjb3JkPHN0cmluZywgYW55PjsgYmFzZU1hdD86IGFueTsgdG9wOiBudW1iZXI7IHNjYWxlOiBudW1iZXI7IGZsYXZvcj86IEZsYXZvcjsgY2hlZXJzPzogUG9zZVtdOyBzcGF3bkVtb3RlPzogc3RyaW5nOyBleWVzPzogc3RyaW5nOyBleWVUZXg/OiBhbnk7IHN0YXJTY2FsZT86IG51bWJlcltdIH1cblxuZnVuY3Rpb24gZHluKHNjZW5lOiBhbnksIHc6IG51bWJlciwgaDogbnVtYmVyLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkLCBhbHBoYSA9IHRydWUpIHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdkdCcsIHsgd2lkdGg6IHcsIGhlaWdodDogaCB9LCBzY2VuZSwgdHJ1ZSk7IGRyYXcodC5nZXRDb250ZXh0KCkpOyB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gYWxwaGE7IHJldHVybiB0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFzc2V0cyhzY2VuZTogYW55KTogUHJvbWlzZTxBc3NldHM+IHtcbiAgY29uc3Qgc29mdCA9IGR5bihzY2VuZSwgNjQsIDY0LCAoYykgPT4geyBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCgzMiwgMzIsIDAsIDMyLCAzMiwgMzIpOyBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgyNTUsMjU1LDI1NSwxKScpOyBnLmFkZENvbG9yU3RvcCgwLjQsICdyZ2JhKDI1NSwyNTUsMjU1LC41NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTsgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IH0pO1xuICBjb25zdCBzdGFyVGV4ID0gWzEsIDIsIDNdLm1hcCgobikgPT4gZHluKHNjZW5lLCAxOTIsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCA0MHB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlU3R5bGUgPSAnIzFhMTAyMCc7IGMuZmlsbFN0eWxlID0gbiA9PT0gMyA/ICcjZmZkMjRhJyA6IG4gPT09IDIgPyAnI2Q3ZTZmZicgOiAnI2YwZDlhMCc7IGNvbnN0IHMgPSAnXHUyNjA1Jy5yZXBlYXQobik7IGMuc3Ryb2tlVGV4dChzLCA5NiwgMzgpOyBjLmZpbGxUZXh0KHMsIDk2LCAzOCk7IH0pKTtcbiAgY29uc3QgZW1pc3NpdmUgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYSA9IDEpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2VtJywgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gIGNvbnN0IEE6IEFzc2V0cyA9IHtcbiAgICBzY2VuZSwgc29mdCwgc3RhclRleCwgdHJpcG86IHt9LCBlbW90ZToge30sIHJpbmdNYXQ6IFtlbWlzc2l2ZSgwLjU1LCAwLjIsIDAuOTUsIDAuOSksIGVtaXNzaXZlKDAuOTUsIDAuMjUsIDAuMiwgMC45KV0sIGhhbG9NYXQ6IGVtaXNzaXZlKDEsIDAuODIsIDAuMywgMC45NSksXG4gICAgYmFyQmc6IGVtaXNzaXZlKDAuMDUsIDAuMDUsIDAuMDgsIDAuNyksIGJhckZpbGw6IFtlbWlzc2l2ZSgwLjU1LCAwLjM1LCAxKSwgZW1pc3NpdmUoMSwgMC40LCAwLjMpXSwgbWFuYUZpbGw6IGVtaXNzaXZlKDAuMjUsIDAuNzUsIDEpLFxuICB9O1xuICAvLyBcIlp6elwiIHRoYXQgZmxvYXRzIHVwIG92ZXIgYSBzbGVlcHkgdW5pdFxuICBjb25zdCB6enogPSBkeW4oc2NlbmUsIDEyOCwgMTI4LCAoYykgPT4geyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDk7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MGQyNic7IGMuZmlsbFN0eWxlID0gJyNlOGQ4ZmYnOyBjLmxpbmVKb2luID0gJ3JvdW5kJztcbiAgICBmb3IgKGNvbnN0IFtjaCwgc2l6ZSwgeCwgeV0gb2YgW1snWicsIDY0LCAzNCwgMTAwXSwgWyd6JywgNDgsIDc0LCA2Nl0sIFsneicsIDM0LCAxMDQsIDM4XV0gYXMgW3N0cmluZywgbnVtYmVyLCBudW1iZXIsIG51bWJlcl1bXSkgeyBjLmZvbnQgPSAnaXRhbGljIDkwMCAnICsgc2l6ZSArICdweCBzYW5zLXNlcmlmJzsgYy5zdHJva2VUZXh0KGNoLCB4LCB5KTsgYy5maWxsVGV4dChjaCwgeCwgeSk7IH0gfSk7XG4gIGNvbnN0IHptID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnenp6Jywgc2NlbmUpOyB6bS5kaWZmdXNlVGV4dHVyZSA9IHp6ejsgem0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB6bS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgem0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgem0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IEEuZW1vdGVbJ3p6eiddID0gem07XG4gIGNvbnN0IGljb24gPSAobmFtZTogc3RyaW5nLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKG5hbWUsIHNjZW5lKTsgbS5kaWZmdXNlVGV4dHVyZSA9IGR5bihzY2VuZSwgMTI4LCAxMjgsIGRyYXcpOyBtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmJhY2tGYWNlQ3VsbGluZyA9IGZhbHNlOyBBLmVtb3RlW25hbWVdID0gbTsgfTtcbiAgY29uc3QgZ2x5cGggPSAoY2g6IHN0cmluZywgZmlsbDogc3RyaW5nKSA9PiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gMTI7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MGQyNic7IGMubGluZUpvaW4gPSAncm91bmQnOyBjLmZpbGxTdHlsZSA9IGZpbGw7IGMuZm9udCA9ICc5MDAgMTA0cHggc2Fucy1zZXJpZic7IGMuc3Ryb2tlVGV4dChjaCwgNjQsIDEwMCk7IGMuZmlsbFRleHQoY2gsIDY0LCAxMDApOyB9O1xuICBpY29uKCc/JywgZ2x5cGgoJz8nLCAnI2ZmZTI3YScpKTsgaWNvbignIScsIGdseXBoKCchJywgJyNmZjlhN2EnKSk7XG4gIGljb24oJ3N3ZWF0JywgKGMpID0+IHsgYy5saW5lV2lkdGggPSA4OyBjLnN0cm9rZVN0eWxlID0gJyMxNTMwNGEnOyBjLmZpbGxTdHlsZSA9ICcjOWZlNGZmJzsgYy5iZWdpblBhdGgoKTsgYy5tb3ZlVG8oNjQsIDE0KTsgYy5iZXppZXJDdXJ2ZVRvKDEwNCwgNjIsIDEwNCwgMTA4LCA2NCwgMTEyKTsgYy5iZXppZXJDdXJ2ZVRvKDI0LCAxMDgsIDI0LCA2MiwgNjQsIDE0KTsgYy5jbG9zZVBhdGgoKTsgYy5zdHJva2UoKTsgYy5maWxsKCk7IH0pO1xuICBpY29uKCdzcGFya2xlJywgKGMpID0+IHsgYy5saW5lV2lkdGggPSA3OyBjLnN0cm9rZVN0eWxlID0gJyMzYTJhMDUnOyBjLmZpbGxTdHlsZSA9ICcjZmZmMmE4JzsgY29uc3Qgc3RhciA9ICh4OiBudW1iZXIsIHk6IG51bWJlciwgcjogbnVtYmVyKSA9PiB7IGMuYmVnaW5QYXRoKCk7IGZvciAobGV0IGkgPSAwOyBpIDwgODsgaSsrKSB7IGNvbnN0IGEgPSBpICogTWF0aC5QSSAvIDQsIHJyID0gaSAlIDIgPyByICogMC4yOCA6IHI7IGMubGluZVRvKHggKyBNYXRoLnNpbihhKSAqIHJyLCB5IC0gTWF0aC5jb3MoYSkgKiBycik7IH0gYy5jbG9zZVBhdGgoKTsgYy5zdHJva2UoKTsgYy5maWxsKCk7IH07IHN0YXIoNTYsIDcwLCA1MCk7IHN0YXIoMTAyLCAyOCwgMjApOyBzdGFyKDI2LCAyNCwgMTQpOyB9KTtcbiAgY29uc3QgZGVmczogW1NvdWxJZCwgc3RyaW5nLCBzdHJpbmcsIFJlY29yZDxWU3RhdGUsIHN0cmluZz4sIG51bWJlciwgbnVtYmVyLCBhbnk/XVtdID0gW1xuICAgIFsnd2FycmlvcicsICdTa2VsZXRvbldhcnJpb3IuZ2xiJywgJ1NrZWxldG9uV2Fycmlvcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0NoZWVyJyB9LCAxLjA1LCAxLjAsIHsgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnVHJpcCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnQm9uaycsIGVtb3RlOiAnPycgfSwgeyBjbGlwOiAnV29iYmxlJywgZW1vdGU6ICdzd2VhdCcgfSwgeyBjbGlwOiAnV2F2ZScsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogOCwgbWF4OiAxNSB9LCBjaGVlcnM6IFt7IGNsaXA6ICdDaGVlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnV2F2ZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnVHJpcCcsIGVtb3RlOiAnIScgfV0sIGV5ZXM6ICdTa2VsZXRvbldhcnJpb3JfZXllcy5wbmcnIH1dLFxuICAgIFsnYXJjaGVyJywgJ1NrZWxldG9uQXJjaGVyLmdsYicsICdTa2VsZXRvbkFyY2hlcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnU2hvb3QnLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnRmxleCcgfSwgMS4wNSwgMS4wLCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ0ZsZXgnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0RvdWJsZUJpY2VwcycsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnQm9uZUNyYWNrJyB9LCB7IGNsaXA6ICdCb3dUd2lybCcsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogOCwgbWF4OiAxNSB9LCBjaGVlcnM6IFt7IGNsaXA6ICdGbGV4JywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdEb3VibGVCaWNlcHMnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0Jvd1R3aXJsJywgZW1vdGU6ICdzcGFya2xlJyB9XSwgZXllczogJ1NrZWxldG9uQXJjaGVyX2V5ZXMucG5nJyB9XSxcbiAgICBbJ2dvYmxpbicsICdHb2JsaW4uZ2xiJywgJ0dvYmxpbl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0NoZWVyJyB9LCAxLjAsIDAuODUsIHsgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnU2NoZW1lJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdQZWVrJywgZW1vdGU6ICc/JyB9LCB7IGNsaXA6ICdTcGluJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdTbmlja2VyJywgZW1vdGU6ICdzcGFya2xlJyB9XSwgbWluOiA2LCBtYXg6IDEyIH0sIGNoZWVyczogW3sgY2xpcDogJ0NoZWVyJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdTbmlja2VyJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdTcGluJywgZW1vdGU6ICdzcGFya2xlJyB9XSwgZXllczogJ0dvYmxpbl9leWVzLnBuZycgfV0sXG4gICAgWydrbmlnaHQnLCAnS25pZ2h0LmdsYicsICdLbmlnaHRfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdQb3NlJyB9LCAxLjAsIDEuMDUsIHsgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnU2FsdXRlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb2FzdCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnQWRtaXJlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdQcmF5JywgZW1vdGU6ICdzcGFya2xlJyB9XSwgbWluOiA4LCBtYXg6IDE1IH0sIGNoZWVyczogW3sgY2xpcDogJ1Bvc2UnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1NhbHV0ZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnQm9hc3QnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1ByYXknLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBleWVzOiAnS25pZ2h0X2V5ZXMucG5nJyB9XSxcbiAgICBbJ2JhcmJhcmlhbicsICdCYXJiYXJpYW4uZ2xiJywgJ0JhcmJhcmlhbl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0NoZWVyJyB9LCAxLjAsIDEuMDUsIHsgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnUm9hcicsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnQ2hlc3RCZWF0JyB9LCB7IGNsaXA6ICdTdG9tcCcsIGVtb3RlOiAnIScgfV0sIG1pbjogNywgbWF4OiAxMyB9LCBjaGVlcnM6IFt7IGNsaXA6ICdDaGVlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnUm9hcicsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnQ2hlc3RCZWF0JyB9XSwgZXllczogJ0JhcmJhcmlhbl9leWVzLnBuZycgfV0sXG4gICAgWydvZ3JlJywgJ09ncmUuZ2xiJywgJ09ncmVfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wMiwgMS4xMiwgeyBzdGFyU2NhbGU6IFsxLCAxLjMsIDEuNjVdLCBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdZYXduJywgZW1vdGU6ICd6enonIH0sIHsgY2xpcDogJ1NjcmF0Y2gnIH0sIHsgY2xpcDogJ1N0b21wJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdUaHVtcCcgfV0sIG1pbjogOSwgbWF4OiAxNiB9LCBjaGVlcnM6IFt7IGNsaXA6ICdDaGVlcicgfSwgeyBjbGlwOiAnVGh1bXAnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1N0b21wJywgZW1vdGU6ICchJyB9XSwgc3Bhd25FbW90ZTogJ3p6eicsIGV5ZXM6ICdPZ3JlX2V5ZXMucG5nJyB9XSxcbiAgXTtcbiAgY29uc3QgbmVjcm9QID0gQkFCWUxPTi5TY2VuZUxvYWRlci5Mb2FkQXNzZXRDb250YWluZXJBc3luYygnYXNzZXRzLycsICdOZWNyb21hbmNlci5nbGInLCBzY2VuZSkudGhlbigoYzogYW55KSA9PiB7IEEubmVjcm8gPSBjOyB9KS5jYXRjaCgoKSA9PiB7IC8qIHRoZSBnYW1lIGNhbm5vdCBzaG93IGhpbSAqLyB9KTtcbiAgY29uc3QgYXJyb3dQID0gQkFCWUxPTi5TY2VuZUxvYWRlci5Mb2FkQXNzZXRDb250YWluZXJBc3luYygnYXNzZXRzLycsICdBcnJvdy5nbGInLCBzY2VuZSkudGhlbigoYzogYW55KSA9PiB7IEEuYXJyb3cgPSBjOyB9KS5jYXRjaCgoKSA9PiB7IC8qIGZhbGxzIGJhY2sgdG8gdGhlIHBsYWluIGxpbmUgKi8gfSk7XG4gIGF3YWl0IFByb21pc2UuYWxsKFthcnJvd1AsIG5lY3JvUCwgLi4uZGVmcy5tYXAoYXN5bmMgKFtzb3VsLCBnbGIsIGVuZW15LCBjbGlwcywgdG9wLCBzY2FsZSwgZXh0cmFdKSA9PiB7XG4gICAgY29uc3QgY29udGFpbmVyID0gYXdhaXQgQkFCWUxPTi5TY2VuZUxvYWRlci5Mb2FkQXNzZXRDb250YWluZXJBc3luYygnYXNzZXRzLycsIGdsYiwgc2NlbmUpO1xuICAgIEEudHJpcG9bc291bF0gPSB7IGNvbnRhaW5lciwgZW5lbXlUZXg6IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy8nICsgZW5lbXksIHNjZW5lLCBmYWxzZSwgZmFsc2UpLCBjbGlwcywgbWF0Q2FjaGU6IHt9LCB0b3AsIHNjYWxlLCAuLi4oZXh0cmEgfHwge30pLCBleWVUZXg6IGV4dHJhICYmIGV4dHJhLmV5ZXMgPyBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvJyArIGV4dHJhLmV5ZXMsIHNjZW5lLCBmYWxzZSwgZmFsc2UpIDogdW5kZWZpbmVkIH07XG4gIH0pXSk7XG4gIHJldHVybiBBO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNoYXJlZCBkZWNvcmF0aW9uXG5jbGFzcyBEZWNvIHtcbiAgcHJpdmF0ZSBwczogYW55ID0gbnVsbDsgcHJpdmF0ZSBoYWxvOiBhbnkgPSBudWxsOyBwcml2YXRlIGJhZGdlOiBhbnk7IHByaXZhdGUgc3RhcnM6IGFueTsgcHJpdmF0ZSBmaWxsOiBhbnk7IHByaXZhdGUgYmFyOiBhbnk7IHByaXZhdGUgbWJnOiBhbnk7IHByaXZhdGUgbWZpbGw6IGFueTsgcHJpdmF0ZSByaW5nOiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHBhcmVudDogYW55LCBwcml2YXRlIHRvcDogbnVtYmVyLCBwcml2YXRlIHJhZGl1czogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmU7XG4gICAgdGhpcy5yaW5nID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdyaW5nJywgeyByYWRpdXM6IE1hdGgubWF4KDAuMywgcmFkaXVzICogMS4xNSksIHRlc3NlbGxhdGlvbjogMjYgfSwgcyk7IHRoaXMucmluZy5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHRoaXMucmluZy5wb3NpdGlvbi55ID0gMC4wMjsgdGhpcy5yaW5nLnBhcmVudCA9IHBhcmVudDsgdGhpcy5yaW5nLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLmJhZGdlID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnYmFkZ2UnLCBzKTsgdGhpcy5iYWRnZS5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMuYmFkZ2UucG9zaXRpb24ueSA9IHRvcCArIDAuMzI7IHRoaXMuYmFkZ2UuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDtcbiAgICB0aGlzLnN0YXJzID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnc3RhcnMnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4xNSB9LCBzKTsgdGhpcy5zdGFycy5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLnN0YXJzLnBvc2l0aW9uLnkgPSAwLjExOyB0aGlzLnN0YXJzLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBzbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3NtJywgcyk7IHNtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBzbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBzbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHRoaXMuc3RhcnMubWF0ZXJpYWwgPSBzbTsgKHRoaXMuc3RhcnMgYXMgYW55KS5fc20gPSBzbTtcbiAgICBjb25zdCBiZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2JnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDg1IH0sIHMpOyBiZy5wYXJlbnQgPSB0aGlzLmJhZGdlOyBiZy5tYXRlcmlhbCA9IEEuYmFyQmc7IGJnLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5iYXIgPSBiZztcbiAgICB0aGlzLmZpbGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdmaWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjA1IH0sIHMpOyB0aGlzLmZpbGwucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5maWxsLnBvc2l0aW9uLnogPSAtMC4wMDI7IHRoaXMuZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdtYmcnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5tYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5tYmcucG9zaXRpb24ueSA9IC0wLjA3OyB0aGlzLm1iZy5tYXRlcmlhbCA9IEEuYmFyQmc7IHRoaXMubWJnLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLm1maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWZpbGwnLCB7IHdpZHRoOiAwLjU2LCBoZWlnaHQ6IDAuMDMgfSwgcyk7IHRoaXMubWZpbGwucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5tZmlsbC5wb3NpdGlvbi5zZXQoMCwgLTAuMDcsIC0wLjAwMik7IHRoaXMubWZpbGwubWF0ZXJpYWwgPSBBLm1hbmFGaWxsOyB0aGlzLm1maWxsLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLmJhci5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5maWxsLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1iZy5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICAvKiogVGhlIGJhcnMga2VlcCB0aGUgc2FtZSBzaXplIGFuZCB0aGUgc2FtZSBzbWFsbCBnYXAgYWJvdmUgdGhlIGhlYWQgaG93ZXZlciBiaWcgdGhlIHVuaXQgZ3Jvd3MuICovXG4gIGZpdChrOiBudW1iZXIpIHsgdGhpcy5iYWRnZS5zY2FsaW5nLnNldEFsbCgxIC8gayk7IHRoaXMuYmFkZ2UucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4zIC8gazsgaWYgKHRoaXMuaGFsbykgdGhpcy5oYWxvLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuMDg7IH1cbiAgc2V0KHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5BLnNjZW5lLCBjZmcgPSBBVVJBW3N0YXIgLSAxXTtcbiAgICAodGhpcy5zdGFycyBhcyBhbnkpLl9zbS5kaWZmdXNlVGV4dHVyZSA9IHRoaXMuQS5zdGFyVGV4W3N0YXIgLSAxXTtcbiAgICB0aGlzLnJpbmcubWF0ZXJpYWwgPSB0aGlzLkEucmluZ01hdFt0ZWFtXTsgdGhpcy5maWxsLm1hdGVyaWFsID0gdGhpcy5BLmJhckZpbGxbdGVhbV07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJhaXNlZCBieSB0aGUgTmVjcm9tYW5jZXI6IHB1cnBsZSBhdXJhIHRoYXQgZ3Jvd3Mgd2l0aCBzdGFyc1xuICAgICAgaWYgKCF0aGlzLnBzKSB7XG4gICAgICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2F1cmEnLCA3MCwgcyk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5wYXJlbnQ7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIHRoaXMudG9wICogMC41LCAwLjIpO1xuICAgICAgICBwcy5taW5MaWZlVGltZSA9IDAuNTsgcHMubWF4TGlmZVRpbWUgPSAxLjE7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjgsIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS41LCAwLjE1KTtcbiAgICAgICAgcHMubWluRW1pdFBvd2VyID0gMC4zNTsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHRoaXMucHMgPSBwcztcbiAgICAgIH1cbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBzOyBwLmVtaXRSYXRlID0gY2ZnLnJhdGU7IHAubWluU2l6ZSA9IGNmZy5taW47IHAubWF4U2l6ZSA9IGNmZy5tYXg7IHAuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMSk7IHAuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMik7IHAuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICAgIGlmICghcC5pc1N0YXJ0ZWQoKSkgcC5zdGFydCgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wcyAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTtcbiAgICBpZiAoc3RhciA+PSAzKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBoYWxvIGFib3ZlIHRoZSBoZWFkXG4gICAgICBpZiAoIXRoaXMuaGFsbykgeyB0aGlzLmhhbG8gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoYWxvJywgeyBkaWFtZXRlcjogMC41NSwgdGhpY2tuZXNzOiAwLjA0LCB0ZXNzZWxsYXRpb246IDI0IH0sIHMpOyB0aGlzLmhhbG8ucGFyZW50ID0gdGhpcy5wYXJlbnQ7IHRoaXMuaGFsby5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjA4OyB0aGlzLmhhbG8ubWF0ZXJpYWwgPSB0aGlzLkEuaGFsb01hdDsgdGhpcy5oYWxvLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgICAgdGhpcy5oYWxvLnNldEVuYWJsZWQodHJ1ZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmhhbG8pIHRoaXMuaGFsby5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLmJhci5zZXRFbmFibGVkKG9uKTsgdGhpcy5maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMuZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLm1iZy5zZXRFbmFibGVkKG9uKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMubWZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5tZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0QXVyYShvbjogYm9vbGVhbikgeyBpZiAodGhpcy5wcykgeyBpZiAob24gJiYgIXRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RhcnQoKTsgaWYgKCFvbiAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTsgfSB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7IGlmICh0aGlzLmhhbG8gJiYgdGhpcy5oYWxvLmlzRW5hYmxlZCgpKSB0aGlzLmhhbG8ucm90YXRpb24ueSArPSBkdCAqIDEuNjsgfVxuICBkaXNwb3NlKCkgeyBpZiAodGhpcy5wcykgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IH0gW3RoaXMuaGFsbywgdGhpcy5yaW5nLCB0aGlzLnN0YXJzLCB0aGlzLmJhciwgdGhpcy5maWxsLCB0aGlzLm1iZywgdGhpcy5tZmlsbF0uZm9yRWFjaCgobSkgPT4gbSAmJiBtLmRpc3Bvc2UoKSk7IHRoaXMuYmFkZ2UuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcmVhbCBtb2RlbHNcbmNsYXNzIFRyaXBvVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIGVudDogYW55OyBwcml2YXRlIGJvZHk6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIGJhc2U6IG51bWJlcjtcbiAgcHJpdmF0ZSBsYXN0Rmxhdm9yID0gJyc7IHByaXZhdGUgdWlkID0gJyc7IHByaXZhdGUgb3duOiBhbnkgPSBudWxsOyBwcml2YXRlIGlkbGVUID0gMDsgcHJpdmF0ZSBuZXh0Rmxhdm9yID0gMWU5OyBwcml2YXRlIGZsYXZvck9uID0gZmFsc2U7IHByaXZhdGUgcXVldWVkID0gZmFsc2U7IHByaXZhdGUgc3Bhd25UID0gMDsgcHJpdmF0ZSBleWVLID0gMC42NTsgcHJpdmF0ZSBlbW90ZXM6IHsgbTogYW55OyB0OiBudW1iZXI7IHkwOiBudW1iZXIgfVtdID0gW107XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIGNmZzogVHJpcG9DZmcsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCB1aWQgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA3KTsgdGhpcy51aWQgPSB1aWQ7XG4gICAgdGhpcy5lbnQgPSBjZmcuY29udGFpbmVyLmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ18nICsgdWlkLCBmYWxzZSwgeyBkb05vdEluc3RhbnRpYXRlOiB0cnVlIH0pO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgndW5pdF8nICsgdWlkLCBzKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIHRoaXMuYm9keSA9IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZpbmQoKG06IGFueSkgPT4gbS5uYW1lLmluY2x1ZGVzKCdfQm9keScpKTtcbiAgICBpZiAoIWNmZy5iYXNlTWF0KSBjZmcuYmFzZU1hdCA9IHRoaXMuYm9keS5tYXRlcmlhbDtcbiAgICB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiB7IGcuc3RvcCgpOyBnLmVuYWJsZUJsZW5kaW5nID0gdHJ1ZTsgZy5ibGVuZGluZ1NwZWVkID0gMC4xMjsgdGhpcy5hbmltc1tnLm5hbWUuc3BsaXQoJ18nKVswXV0gPSBnOyB9KTtcbiAgICB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfSk7XG4gICAgdGhpcy50b3AgPSBjZmcudG9wOyB0aGlzLmJhc2UgPSBjZmcuc2NhbGU7IHRoaXMudGVhbSA9IHRlYW07XG4gICAgaWYgKGNmZy5mbGF2b3IpIHRoaXMubmV4dEZsYXZvciA9IGNmZy5mbGF2b3IubWluICsgTWF0aC5yYW5kb20oKSAqIChjZmcuZmxhdm9yLm1heCAtIGNmZy5mbGF2b3IubWluKTtcbiAgICB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIDAuMyk7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiAxLjMsIGRpYW1ldGVyOiAwLjggfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSAwLjY7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5pc1BpY2thYmxlID0gdHJ1ZTtcbiAgICB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICB9XG4gIHByaXZhdGUgYXBwbHlNYXQoKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy50ZWFtICsgJ18nICsgdGhpcy5zdGFyLCBjID0gdGhpcy5jZmc7XG4gICAgaWYgKGMuZXllVGV4KSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIHVuaXQgaGFzIGdsb3dpbmcgZXllczogaXQgZ2V0cyBpdHMgb3duIG1hdGVyaWFsIHNvIGl0cyBnbG93IGNhbiBjaGFuZ2Ugb24gaXRzIG93blxuICAgICAgaWYgKCF0aGlzLm93bikgeyB0aGlzLm93biA9IGMuYmFzZU1hdC5jbG9uZSgnb3duXycgKyB0aGlzLnVpZCk7IHRoaXMub3duLmVtaXNzaXZlVGV4dHVyZSA9IGMuZXllVGV4OyB0aGlzLm93bi5lbWlzc2l2ZUludGVuc2l0eSA9IHRoaXMuZXllSzsgfVxuICAgICAgdGhpcy5vd24uYWxiZWRvVGV4dHVyZSA9IHRoaXMudGVhbSA9PT0gMSA/IGMuZW5lbXlUZXggOiBjLmJhc2VNYXQuYWxiZWRvVGV4dHVyZTsgY29uc3QgdCA9IFRJTlRbdGhpcy5zdGFyIC0gMV07IHRoaXMub3duLmFsYmVkb0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHRbMF0sIHRbMV0sIHRbMl0pO1xuICAgICAgdGhpcy5vd24uZW1pc3NpdmVDb2xvciA9IHRoaXMudGVhbSA9PT0gMSA/IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjcyLCAwLjIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNzgsIDAuMywgMSk7XG4gICAgICB0aGlzLmJvZHkubWF0ZXJpYWwgPSB0aGlzLm93bjsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIWMubWF0Q2FjaGVba2V5XSkgeyBjb25zdCBtID0gYy5iYXNlTWF0LmNsb25lKCdtXycgKyBrZXkpOyBpZiAodGhpcy50ZWFtID09PSAxKSBtLmFsYmVkb1RleHR1cmUgPSBjLmVuZW15VGV4OyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgbS5hbGJlZG9Db2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyh0WzBdLCB0WzFdLCB0WzJdKTsgYy5tYXRDYWNoZVtrZXldID0gbTsgfVxuICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IGMubWF0Q2FjaGVba2V5XTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLnNjKHN0KSAqIHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IHRoaXMuZGVjby5maXQodGhpcy5zYyhzdCkgKiB0aGlzLmJhc2UpOyB9XG4gIHByaXZhdGUgc2Moc3Q6IG51bWJlcikgeyByZXR1cm4gKHRoaXMuY2ZnLnN0YXJTY2FsZSB8fCBCQUxBTkNFLnN0YXIuc2NhbGUpW3N0IC0gMV07IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHtcbiAgICBsZXQgY2xpcCA9IHRoaXMuY2ZnLmNsaXBzW3N0YXRlXSwgcG9zZTogUG9zZSB8IHVuZGVmaW5lZDtcbiAgICBpZiAoc3RhdGUgPT09ICdjaGVlcicgJiYgdGhpcy5jZmcuY2hlZXJzKSB7IHBvc2UgPSB0aGlzLmNmZy5jaGVlcnNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogdGhpcy5jZmcuY2hlZXJzLmxlbmd0aCldOyBjbGlwID0gcG9zZS5jbGlwOyB9XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbY2xpcF07IGlmICghZykgcmV0dXJuOyBjb25zdCBsb29wID0gc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bic7XG4gICAgaWYgKHN0YXRlID09PSAnaWRsZScgJiYgdGhpcy5zdGF0ZSA9PT0gJ3NwYXduJyAmJiB0aGlzLmN1ciAmJiB0aGlzLmN1ci5pc1N0YXJ0ZWQgJiYgdGhpcy5jZmcuZmxhdm9yKSB7IHRoaXMucXVldWVkID0gdHJ1ZTsgcmV0dXJuOyB9ICAgLy8gbGV0IHRoZSB3YWtlLXVwIHBsYXkgdG8gdGhlIGVuZFxuICAgIGlmIChsb29wICYmIHRoaXMuc3RhdGUgPT09IHN0YXRlICYmIHRoaXMuY3VyID09PSBnKSByZXR1cm47XG4gICAgdGhpcy5xdWV1ZWQgPSBmYWxzZTsgdGhpcy5mbGF2b3JPbiA9IGZhbHNlOyB0aGlzLmlkbGVUID0gMDtcbiAgICBpZiAodGhpcy5jdXIpIHRoaXMuY3VyLnN0b3AoKTsgZy5zdG9wKCk7IGcuc3RhcnQobG9vcCwgc3BlZWQsIGcuZnJvbSwgZy50byk7XG4gICAgaWYgKGxvb3ApIGcuZ29Ub0ZyYW1lKGcuZnJvbSArIE1hdGgucmFuZG9tKCkgKiAoZy50byAtIGcuZnJvbSkpO1xuICAgIHRoaXMuY3VyID0gZzsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7XG4gICAgaWYgKHBvc2UgJiYgcG9zZS5lbW90ZSkgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAwLjM1KTtcbiAgICBpZiAoc3RhdGUgPT09ICdzcGF3bicpIHsgdGhpcy5zcGF3blQgPSAwOyBpZiAodGhpcy5jZmcuc3Bhd25FbW90ZSkgeyB0aGlzLmVtb3RlKHRoaXMuY2ZnLnNwYXduRW1vdGUsIDAuMSk7IHRoaXMuZW1vdGUodGhpcy5jZmcuc3Bhd25FbW90ZSwgMC43KTsgfSB9XG4gIH1cbiAgLyoqIEEgbGl0dGxlIHBpY3R1cmUgdGhhdCBmbG9hdHMgdXAgb3ZlciB0aGUgaGVhZCBhbmQgZmFkZXMgKGEgc2xlZXB5IFwiWnp6XCIpLiAqL1xuICBwcml2YXRlIGVtb3RlKGtpbmQ6IHN0cmluZywgZGVsYXkgPSAwKSB7XG4gICAgY29uc3QgbWF0ID0gdGhpcy5BLmVtb3RlW2tpbmRdOyBpZiAoIW1hdCkgcmV0dXJuO1xuICAgIGNvbnN0IHBsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZW1vJywgeyBzaXplOiAwLjQyIH0sIHRoaXMuQS5zY2VuZSk7IHBsLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBwbC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBwbC5tYXRlcmlhbCA9IG1hdDsgcGwuaXNQaWNrYWJsZSA9IGZhbHNlOyBwbC52aXNpYmlsaXR5ID0gMDtcbiAgICBjb25zdCB5MCA9IHRoaXMudG9wICsgMC4wMjsgcGwucG9zaXRpb24uc2V0KDAuMTYsIHkwLCAwKTsgdGhpcy5lbW90ZXMucHVzaCh7IG06IHBsLCB0OiAtZGVsYXksIHkwIH0pO1xuICB9XG4gIC8qKiBBZnRlciBzdGFuZGluZyBpZGxlIGZvciBhIHdoaWxlOiBwbGF5IHRoZSB1bml0J3MgZmxhdm91ciBjbGlwIG9uY2UgKHRoZSBPZ3JlIHlhd25zKSwgdGhlbiBnbyBiYWNrIHRvIGlkbGluZy4gKi9cbiAgcHJpdmF0ZSBzdGFydEZsYXZvcigpIHtcbiAgICBjb25zdCBmID0gdGhpcy5jZmcuZmxhdm9yITsgdGhpcy5pZGxlVCA9IDA7XG4gICAgbGV0IHBvb2wgPSBmLmNsaXBzLmZpbHRlcigoYykgPT4gYy5jbGlwICE9PSB0aGlzLmxhc3RGbGF2b3IgJiYgdGhpcy5hbmltc1tjLmNsaXBdKTsgaWYgKCFwb29sLmxlbmd0aCkgcG9vbCA9IGYuY2xpcHMuZmlsdGVyKChjKSA9PiB0aGlzLmFuaW1zW2MuY2xpcF0pOyBpZiAoIXBvb2wubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgcG9zZSA9IHBvb2xbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogcG9vbC5sZW5ndGgpXSwgZyA9IHRoaXMuYW5pbXNbcG9zZS5jbGlwXTsgdGhpcy5sYXN0Rmxhdm9yID0gcG9zZS5jbGlwO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChmYWxzZSwgMSwgZy5mcm9tLCBnLnRvKTsgdGhpcy5jdXIgPSBnOyB0aGlzLmZsYXZvck9uID0gdHJ1ZTsgdGhpcy5uZXh0Rmxhdm9yID0gZi5taW4gKyBNYXRoLnJhbmRvbSgpICogKGYubWF4IC0gZi5taW4pO1xuICAgIGlmIChwb3NlLmVtb3RlKSB7IHRoaXMuZW1vdGUocG9zZS5lbW90ZSwgMC40KTsgaWYgKHBvc2UuZW1vdGUgPT09ICd6enonKSB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDEuMik7IH1cbiAgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMuZGVjby51cGRhdGUoZHQpO1xuICAgIGlmICh0aGlzLmN1ciAmJiAhdGhpcy5jdXIuaXNTdGFydGVkKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgb25lLXNob3QgY2xpcCBmaW5pc2hlZFxuICAgICAgaWYgKHRoaXMucXVldWVkKSB7IHRoaXMucXVldWVkID0gZmFsc2U7IHRoaXMucGxheSgnaWRsZScpOyB9IGVsc2UgaWYgKHRoaXMuZmxhdm9yT24pIHsgdGhpcy5mbGF2b3JPbiA9IGZhbHNlOyB0aGlzLnBsYXkoJ2lkbGUnKTsgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnY2hlZXInKSB0aGlzLnBsYXkoJ2lkbGUnKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuY2ZnLmZsYXZvciAmJiB0aGlzLnN0YXRlID09PSAnaWRsZScgJiYgIXRoaXMuZmxhdm9yT24gJiYgdGhpcy5ob2xkZXIuaXNFbmFibGVkKCkpIHsgdGhpcy5pZGxlVCArPSBkdDsgaWYgKHRoaXMuaWRsZVQgPj0gdGhpcy5uZXh0Rmxhdm9yKSB0aGlzLnN0YXJ0Rmxhdm9yKCk7IH1cbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgdGhpcy5zcGF3blQgKz0gZHQ7XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuZW1vdGVzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBlID0gdGhpcy5lbW90ZXNbaV07IGUudCArPSBkdDsgaWYgKGUudCA8IDApIGNvbnRpbnVlOyBjb25zdCBrID0gZS50IC8gMS45O1xuICAgICAgaWYgKGsgPj0gMSkgeyBlLm0uZGlzcG9zZSgpOyB0aGlzLmVtb3Rlcy5zcGxpY2UoaSwgMSk7IGNvbnRpbnVlOyB9XG4gICAgICBlLm0udmlzaWJpbGl0eSA9IE1hdGgubWluKDEsIGUudCAvIDAuMikgKiAoMSAtIGsgKiBrKTsgZS5tLnBvc2l0aW9uLnNldCgwLjE2ICsgMC4wNSAqIE1hdGguc2luKGUudCAqIDMpLCBlLnkwICsgZS50ICogMC4yLCAwKTsgZS5tLnNjYWxpbmcuc2V0QWxsKDAuNyArIDAuNSAqIGspO1xuICAgIH1cbiAgICBpZiAodGhpcy5vd24pIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXllIGdsb3cgZm9sbG93cyB0aGUgbW9vZDogZGltIHdoZW4gc2xlZXB5LCBicmlnaHQgd2hlbiBhd2FrZSwgZmxhcmluZyBpbiBhIGZpZ2h0XG4gICAgICBsZXQgdGFyZ2V0ID0gMC42NTtcbiAgICAgIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB0YXJnZXQgPSAwLjA4ICsgMC45MiAqIE1hdGgubWF4KDAsIE1hdGgubWluKDEsICh0aGlzLnNwYXduVCAvIDEuNjcgLSAwLjQ1KSAvIDAuMykpO1xuICAgICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2lkbGUnKSB0YXJnZXQgPSB0aGlzLmZsYXZvck9uID8gMC4yNSA6IDAuNjU7XG4gICAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAncnVuJykgdGFyZ2V0ID0gMS4wOyBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnYXR0YWNrJykgdGFyZ2V0ID0gMS43OyBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnY2hlZXInKSB0YXJnZXQgPSAxLjQ7IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdkZWF0aCcpIHRhcmdldCA9IDAuMDU7XG4gICAgICB0aGlzLmV5ZUsgKz0gKHRhcmdldCAtIHRoaXMuZXllSykgKiBNYXRoLm1pbigxLCBkdCAqIDcpOyB0aGlzLm93bi5lbWlzc2l2ZUludGVuc2l0eSA9IHRoaXMuZXllSztcbiAgICB9XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLnNjKHRoaXMuc3RhcikgKiB0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZW1vdGVzLmZvckVhY2goKGUpID0+IGUubS5kaXNwb3NlKCkpOyBpZiAodGhpcy5vd24pIHRoaXMub3duLmRpc3Bvc2UoKTsgdGhpcy5kZWNvLmRpc3Bvc2UoKTsgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4gZy5kaXNwb3NlKCkpOyB0aGlzLmVudC5za2VsZXRvbnMuZm9yRWFjaCgoczogYW55KSA9PiBzLmRpc3Bvc2UoKSk7IHRoaXMucGljay5kaXNwb3NlKCk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5kaXNwb3NlKGZhbHNlLCBmYWxzZSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YW5kLWluc1xuY29uc3QgUEg6IFJlY29yZDxzdHJpbmcsIHsgY29sOiBzdHJpbmc7IHc6IG51bWJlcjsgaDogbnVtYmVyOyBoZWFkOiBudW1iZXI7IHdlYXBvbjogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0+ID0ge1xuICBnb2JsaW46IHsgY29sOiAnIzYzYjEzZicsIHc6IDAuMzYsIGg6IDAuNDIsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ2RhZ2dlcicsIGxhYmVsOiAnR09CTElOJyB9LFxuICBrbmlnaHQ6IHsgY29sOiAnIzhlYTlkYycsIHc6IDAuNSwgaDogMC42LCBoZWFkOiAwLjM2LCB3ZWFwb246ICdzaGllbGQnLCBsYWJlbDogJ0tOSUdIVCcgfSxcbiAgb2dyZTogeyBjb2w6ICcjYThhNjRhJywgdzogMC44NSwgaDogMC44NSwgaGVhZDogMC40Miwgd2VhcG9uOiAnbWFjZScsIGxhYmVsOiAnT0dSRScgfSxcbiAgYmFyYmFyaWFuOiB7IGNvbDogJyNkNjhhNTUnLCB3OiAwLjUyLCBoOiAwLjYyLCBoZWFkOiAwLjM4LCB3ZWFwb246ICdheGUnLCBsYWJlbDogJ0JBUkJBUklBTicgfSxcbn07XG5jbGFzcyBQbGFjZWhvbGRlclZpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSByaWc6IGFueTsgcHJpdmF0ZSBsZWdzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHdwOiBhbnk7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgdCA9IE1hdGgucmFuZG9tKCkgKiA2OyBwcml2YXRlIHN0MCA9IDA7IHByaXZhdGUgZHVyID0gMTsgcHJpdmF0ZSBiYXNlID0gMTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIG1hdHM6IGFueVtdID0gW107IHByaXZhdGUgYm9keTogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBzb3VsOiBzdHJpbmcsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZSwgZCA9IFBIW3NvdWxdOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncGhfJyArIHNvdWwsIHMpOyB0aGlzLnJpZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3JpZycsIHMpOyB0aGlzLnJpZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICBjb25zdCBtYXQgPSAoaGV4OiBzdHJpbmcsIGVtID0gMCkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgncG0nLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5Gcm9tSGV4U3RyaW5nKGhleCkuc2NhbGUoMC43Mik7IG0uc3BlY3VsYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjEsIDAuMSwgMC4xKTsgaWYgKGVtKSBtLmVtaXNzaXZlQ29sb3IgPSBtLmRpZmZ1c2VDb2xvci5zY2FsZShlbSk7IHJldHVybiBtOyB9O1xuICAgIGNvbnN0IGxlZ0ggPSAwLjIyLCBib2R5WSA9IGxlZ0ggKyBkLmggLyAyO1xuICAgIGZvciAoY29uc3Qgc3ggb2YgWy0xLCAxXSkgeyBjb25zdCBsZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2xlZycsIHMpOyBsZy5wYXJlbnQgPSB0aGlzLnJpZzsgbGcucG9zaXRpb24uc2V0KHN4ICogZC53ICogMC4yMiwgbGVnSCwgMCk7IGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdsJywgeyBoZWlnaHQ6IGxlZ0gsIGRpYW1ldGVyOiBkLncgKiAwLjI4IH0sIHMpOyBtLnBhcmVudCA9IGxnOyBtLnBvc2l0aW9uLnkgPSAtbGVnSCAvIDI7IG0ubWF0ZXJpYWwgPSBtYXQoJyM0YTM4MjYnKTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMubGVncy5wdXNoKGxnKTsgfVxuICAgIHRoaXMuYm9keSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ2Fwc3VsZSgnYm9keScsIHsgcmFkaXVzOiBkLncgLyAyLCBoZWlnaHQ6IGQuaCArIGQudyAqIDAuNCB9LCBzKTsgdGhpcy5ib2R5LnBhcmVudCA9IHRoaXMucmlnOyB0aGlzLmJvZHkucG9zaXRpb24ueSA9IGJvZHlZOyB0aGlzLmJvZHkubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyB0aGlzLmJvZHkuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IGhlYWQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnaGVhZCcsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDEuNSwgc2VnbWVudHM6IDEyIH0sIHMpOyBoZWFkLnBhcmVudCA9IHRoaXMucmlnOyBoZWFkLnBvc2l0aW9uLnkgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMC41NTsgaGVhZC5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IGhlYWQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IGV5ZU0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdleWUnLCBzKTsgZXllTS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBleWVNLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyAodGhpcyBhcyBhbnkpLmV5ZU0gPSBleWVNO1xuICAgIGZvciAoY29uc3Qgc3ggb2YgWy0xLCAxXSkgeyBjb25zdCBlID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2UnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAwLjMgfSwgcyk7IGUucGFyZW50ID0gdGhpcy5yaWc7IGUucG9zaXRpb24uc2V0KHN4ICogZC5oZWFkICogMC4zLCBoZWFkLnBvc2l0aW9uLnkgKyAwLjAyLCBkLmhlYWQgKiAwLjY2KTsgZS5tYXRlcmlhbCA9IGV5ZU07IGUuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgLy8gd2VhcG9uIHBpdm90IGF0IHRoZSBzaG91bGRlciwgb24gdGhlIGNoYXJhY3RlcidzIHJpZ2h0ICgteCBpcyBmaW5lIGZvciBhIHN0YW5kLWluKVxuICAgIHRoaXMud3AgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd3cCcsIHMpOyB0aGlzLndwLnBhcmVudCA9IHRoaXMucmlnOyB0aGlzLndwLnBvc2l0aW9uLnNldChkLncgKiAwLjYsIGxlZ0ggKyBkLmggKiAwLjg1LCAwLjA1KTtcbiAgICBjb25zdCB3bSA9IG1hdCgnIzdhNWEzMCcpLCBpcm9uID0gbWF0KCcjOWFhMWFkJyk7XG4gICAgY29uc3QgbWsgPSAobTogYW55LCBraW5kOiBzdHJpbmcsIGRpbXM6IGFueSwgcG9zOiBudW1iZXJbXSwgbXQ6IGFueSkgPT4geyBjb25zdCB4ID0ga2luZCA9PT0gJ2JveCcgPyBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUJveCgndycsIGRpbXMsIHMpIDoga2luZCA9PT0gJ2N5bCcgPyBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCd3JywgZGltcywgcykgOiBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgndycsIGRpbXMsIHMpOyB4LnBhcmVudCA9IHRoaXMud3A7IHgucG9zaXRpb24uc2V0KHBvc1swXSwgcG9zWzFdLCBwb3NbMl0pOyB4Lm1hdGVyaWFsID0gbXQ7IHguaXNQaWNrYWJsZSA9IGZhbHNlOyByZXR1cm4geDsgfTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdkYWdnZXInKSBtaygwLCAnYm94JywgeyB3aWR0aDogMC4wNSwgaGVpZ2h0OiAwLjMsIGRlcHRoOiAwLjAzIH0sIFswLCAtMC4yLCAwLjEyXSwgaXJvbik7XG4gICAgaWYgKGQud2VhcG9uID09PSAnc2hpZWxkJykgeyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4wNiwgaGVpZ2h0OiAwLjUsIGRlcHRoOiAwLjA0IH0sIFswLCAtMC4zLCAwLjE0XSwgaXJvbik7IGNvbnN0IHNoID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignc2gnLCB7IGhlaWdodDogMC4wNSwgZGlhbWV0ZXI6IDAuNTUgfSwgcyk7IHNoLnBhcmVudCA9IHRoaXMucmlnOyBzaC5yb3RhdGlvbi56ID0gTWF0aC5QSSAvIDI7IHNoLnBvc2l0aW9uLnNldCgtZC53ICogMC43LCBsZWdIICsgZC5oICogMC42LCAwLjA1KTsgc2gubWF0ZXJpYWwgPSBtYXQoJyNkOGI2NGEnKTsgc2guaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnbWFjZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjksIGRpYW1ldGVyOiAwLjA4IH0sIFswLCAtMC4zNSwgMC4zXSwgd20pOyBtaygwLCAnc3BoJywgeyBkaWFtZXRlcjogMC40IH0sIFswLCAtMC44NSwgMC40XSwgaXJvbik7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdheGUnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC42LCBkaWFtZXRlcjogMC4wNSB9LCBbMCwgLTAuMiwgMC4xNV0sIHdtKTsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMzIsIGhlaWdodDogMC4yMiwgZGVwdGg6IDAuMDUgfSwgWzAsIC0wLjUsIDAuMTVdLCBpcm9uKTsgY29uc3QgaGFpciA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2hhaXInLCB7IGhlaWdodDogMC4zLCBkaWFtZXRlclRvcDogMCwgZGlhbWV0ZXJCb3R0b206IGQuaGVhZCAqIDEuMiB9LCBzKTsgaGFpci5wYXJlbnQgPSB0aGlzLnJpZzsgaGFpci5wb3NpdGlvbi55ID0gaGVhZC5wb3NpdGlvbi55ICsgZC5oZWFkICogMC43NTsgaGFpci5tYXRlcmlhbCA9IG1hdCgnI2MyMmExYycpOyBoYWlyLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIHRoaXMudG9wID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDEuMzU7IHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgZC53ICogMC43KTtcbiAgICBjb25zdCBsYmwgPSBkeW4ocywgMjU2LCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgMjZweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5maWxsU3R5bGUgPSAnI2ZmZmZmZic7IGMuc3Ryb2tlU3R5bGUgPSAnIzExMSc7IGMubGluZVdpZHRoID0gNTsgYy5zdHJva2VUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgYy5maWxsVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IH0pO1xuICAgIGNvbnN0IGxwID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbGJsJywgeyB3aWR0aDogMS4xLCBoZWlnaHQ6IDAuMiB9LCBzKTsgbHAucGFyZW50ID0gdGhpcy5ob2xkZXI7IGxwLnBvc2l0aW9uLnkgPSAtMC4xOyBscC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDIgKiAwLjA7IGxwLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7IGNvbnN0IGxtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbG0nLCBzKTsgbG0uZGlmZnVzZVRleHR1cmUgPSBsYmw7IGxtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBsbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBsbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IGxwLm1hdGVyaWFsID0gbG07IGxwLmlzUGlja2FibGUgPSBmYWxzZTsgbHAucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC42MjtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IHRoaXMudG9wLCBkaWFtZXRlcjogTWF0aC5tYXgoMC43LCBkLncgKiAxLjMpIH0sIHMpOyB0aGlzLnBpY2sucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMucGljay5wb3NpdGlvbi55ID0gdGhpcy50b3AgLyAyOyB0aGlzLnBpY2sudmlzaWJpbGl0eSA9IDAuMDAxOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gICAgKHRoaXMgYXMgYW55KS5wYXJ0cyA9IFtscF07IHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBsYXkoJ2lkbGUnKTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7ICh0aGlzIGFzIGFueSkuZXllTS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5iYXNlID0gQkFMQU5DRS5zdGFyLnNjYWxlW3N0IC0gMV07IGNvbnN0IHQgPSBUSU5UW3N0IC0gMV07IHRoaXMuYm9keS5tYXRlcmlhbC5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5Gcm9tSGV4U3RyaW5nKFBIW3RoaXMuc291bF0uY29sKS5zY2FsZSgwLjcyKS5tdWx0aXBseShuZXcgQkFCWUxPTi5Db2xvcjMoTWF0aC5taW4oMSwgdFswXSksIE1hdGgubWluKDEsIHRbMV0pLCBNYXRoLm1pbigxLCB0WzJdKSkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0KHRoaXMudGVhbSwgc3QpOyB0aGlzLmRlY28uZml0KHRoaXMuYmFzZSk7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHsgaWYgKHN0YXRlID09PSB0aGlzLnN0YXRlICYmIChzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJykpIHJldHVybjsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLnN0MCA9IHRoaXMudDsgdGhpcy5kdXIgPSBzdGF0ZSA9PT0gJ2F0dGFjaycgPyAoQkFMQU5DRS5zdGF0c1t0aGlzLnNvdWwgYXMgU291bElkXS5hbmltTGVuIC8gc3BlZWQpIDogc3RhdGUgPT09ICdkZWF0aCcgPyAwLjYgOiBzdGF0ZSA9PT0gJ3NwYXduJyA/IDAuOSA6IDEuMDsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpOyB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0OyB0aGlzLmRlY28udXBkYXRlKGR0KTsgY29uc3QgcCA9IE1hdGgubWluKDEsICh0aGlzLnQgLSB0aGlzLnN0MCkgLyB0aGlzLmR1ciksIFIgPSB0aGlzLnJpZywgVyA9IHRoaXMud3A7XG4gICAgUi5wb3NpdGlvbi5zZXQoMCwgMCwgMCk7IFIucm90YXRpb24uc2V0KDAsIDAsIDApOyBSLnNjYWxpbmcuc2V0QWxsKDEpOyBXLnJvdGF0aW9uLnggPSAtMC40OyB0aGlzLmxlZ3MuZm9yRWFjaCgobCkgPT4gKGwucm90YXRpb24ueCA9IDApKTtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ2lkbGUnKSBSLnBvc2l0aW9uLnkgPSBNYXRoLnNpbih0aGlzLnQgKiAyLjIpICogMC4wMTI7XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHsgY29uc3QgdyA9IHRoaXMudCAqIDEwOyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih3KSkgKiAwLjA3OyBSLnJvdGF0aW9uLnggPSAwLjI7IHRoaXMubGVnc1swXS5yb3RhdGlvbi54ID0gTWF0aC5zaW4odykgKiAwLjk7IHRoaXMubGVnc1sxXS5yb3RhdGlvbi54ID0gLU1hdGguc2luKHcpICogMC45OyBXLnJvdGF0aW9uLnggPSAtMC40ICsgTWF0aC5zaW4odykgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnYXR0YWNrJykgeyBjb25zdCBrID0gcCA8IDAuNCA/IC0yLjQgKiAocCAvIDAuNCkgOiAtMi40ICsgMy40ICogTWF0aC5taW4oMSwgKHAgLSAwLjQpIC8gMC4yNSk7IFcucm90YXRpb24ueCA9IGs7IFIucG9zaXRpb24ueiA9IDAuMTQgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IFIucm90YXRpb24ueCA9IDAuMTUgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB7IGNvbnN0IGUgPSBwICogcCAqICgzIC0gMiAqIHApOyBSLnNjYWxpbmcuc2V0QWxsKDAuMDEgKyAwLjk5ICogZSk7IFIucG9zaXRpb24ueSA9IChlIC0gMSkgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB7IGNvbnN0IGUgPSBwICogcDsgUi5yb3RhdGlvbi54ID0gLU1hdGguUEkgLyAyICogZTsgUi5wb3NpdGlvbi55ID0gMC4yNSAqIGU7IFIucG9zaXRpb24ueiA9IC0wLjIgKiBlOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgeyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih0aGlzLnQgKiA3KSkgKiAwLjE1OyBXLnJvdGF0aW9uLnggPSAtMi42OyB9XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmlzdWFsKEE6IEFzc2V0cywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKTogVW5pdFZpc3VhbCB7XG4gIGNvbnN0IGNmZyA9IEEudHJpcG9bc291bF07XG4gIHJldHVybiBjZmcgPyBuZXcgVHJpcG9WaXN1YWwoQSwgY2ZnLCBzb3VsLCB0ZWFtLCBzdGFyKSA6IG5ldyBQbGFjZWhvbGRlclZpc3VhbChBLCBzb3VsLCB0ZWFtLCBzdGFyKTtcbn1cbmV4cG9ydCBjb25zdCBpc1RyaXBvID0gKEE6IEFzc2V0cywgc291bDogU291bElkKSA9PiAhIUEudHJpcG9bc291bF07XG4iLCAiLy8gVGhlIGdhbWUncyBpY29uIHNldCAoY3VzdG9tIGFydCwgc2xpY2VkIGZyb20gUGlwZWxpbmUvaWNvbnMvc2hlZXRfKi5wbmcgYnkgUGlwZWxpbmUvYmxlbmRlci9zbGljZV9pY29ucy5weSAtPiBkb2NzL2Fzc2V0cy9pY29ucy8qLnBuZykuXG4vLyBTaGFyZWQgYnkgdGhlIDNEIGdhbWUncyBET00gKHZhbmlsbGEpIGFuZCB0aGUgQW5ndWxhciBzaGVsbC4gTm8gZW1vamkgYW55d2hlcmU6IGV2ZXJ5IGdseXBoIGluIHRoZSBVSSBpcyBvbmUgb2YgdGhlc2UgaW1hZ2VzLlxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSYXJpdHkgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcblxuZXhwb3J0IHR5cGUgSWNvbk5hbWUgPVxuICB8ICdob21lJyB8ICdzb3VscycgfCAnc2hvcCcgfCAnc2V0dGluZ3MnIHwgJ2Nsb3NlJ1xuICB8ICdoZWFydCcgfCAnaGVhcnRfZW1wdHknIHwgJ2RvbWluaW9uJyB8ICdzdGFyJyB8ICdsb2NrJ1xuICB8ICd3YXJyaW9yJyB8ICdhcmNoZXInIHwgJ2dvYmxpbicgfCAna25pZ2h0JyB8ICdvZ3JlJyB8ICdiYXJiYXJpYW4nXG4gIHwgJ2dlbV9jb21tb24nIHwgJ2dlbV9yYXJlJyB8ICdnZW1fZXBpYycgfCAnZ2VtX2xlZ2VuZGFyeSdcbiAgfCAnbXVzaWMnIHwgJ3NvdW5kX29uJyB8ICdzb3VuZF9vZmYnIHwgJ3VwZ3JhZGUnIHwgJ3N3YXAnXG4gIHwgJ21lcmdlJyB8ICdyZW1vdmUnIHwgJ2NoZWNrJyB8ICdiYWNrJyB8ICdpbmZvJztcblxuLyoqIFJlbGF0aXZlIHRvIHRoZSBwYWdlLCBzbyBpdCB3b3JrcyBvbiBHaXRIdWIgUGFnZXMgdW5kZXIgL3JlcG8tbmFtZS8uICovXG5leHBvcnQgY29uc3QgaWNvblVybCA9IChuOiBJY29uTmFtZSk6IHN0cmluZyA9PiAnYXNzZXRzL2ljb25zLycgKyBuICsgJy5wbmcnO1xuLyoqIEFuIDxpbWc+IGFzIGFuIEhUTUwgc3RyaW5nLCBmb3IgdGhlIGdhbWUncyBoYW5kLWJ1aWx0IERPTS4gKi9cbmV4cG9ydCBjb25zdCBpY29uSW1nID0gKG46IEljb25OYW1lLCBjbHMgPSAnaWMnKTogc3RyaW5nID0+IGA8aW1nIGNsYXNzPVwiJHtjbHN9XCIgc3JjPVwiJHtpY29uVXJsKG4pfVwiIGFsdD1cIlwiIGRyYWdnYWJsZT1cImZhbHNlXCI+YDtcblxuLyoqIEVhY2ggU291bCBpcyBzaG93biBieSBpdHMgd2VhcG9uL3JvbGUgaWNvbiB1bnRpbCByZWFsIHBvcnRyYWl0cyBleGlzdC4gKi9cbmV4cG9ydCBjb25zdCBTT1VMX0lDT046IFJlY29yZDxTb3VsSWQsIEljb25OYW1lPiA9IHsgd2FycmlvcjogJ3dhcnJpb3InLCBhcmNoZXI6ICdhcmNoZXInLCBnb2JsaW46ICdnb2JsaW4nLCBrbmlnaHQ6ICdrbmlnaHQnLCBvZ3JlOiAnb2dyZScsIGJhcmJhcmlhbjogJ2JhcmJhcmlhbicgfTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfR0VNOiBSZWNvcmQ8UmFyaXR5LCBJY29uTmFtZT4gPSB7IGNvbW1vbjogJ2dlbV9jb21tb24nLCByYXJlOiAnZ2VtX3JhcmUnLCBlcGljOiAnZ2VtX2VwaWMnLCBsZWdlbmRhcnk6ICdnZW1fbGVnZW5kYXJ5JyB9O1xuXG4vKiogUGFjayB0aWVycyBhcmUgc2hvd24gYXMgc2t1bGxzIChuZXZlciBzdGFyczogc3RhcnMgbWVhbiBhbiBpbi1ydW4gbWVyZ2UgbGV2ZWwpLiAqL1xuZXhwb3J0IGNvbnN0IHNrdWxsSW1ncyA9IChuOiBudW1iZXIsIGNscyA9ICdzaycpOiBzdHJpbmcgPT4gaWNvbkltZygnc291bHMnLCBjbHMpLnJlcGVhdChNYXRoLm1heCgxLCBuKSk7XG5leHBvcnQgY29uc3QgaGVhcnRzSHRtbCA9IChoZWFydHM6IG51bWJlciwgbWF4ID0gMyk6IHN0cmluZyA9PiBpY29uSW1nKCdoZWFydCcsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBoZWFydHMpKSArIGljb25JbWcoJ2hlYXJ0X2VtcHR5JywgJ2ljIGhlYXJ0JykucmVwZWF0KE1hdGgubWF4KDAsIG1heCAtIGhlYXJ0cykpO1xuIiwgIi8vIFJlbmRlcmVkIFNvdWwgcG9ydHJhaXRzIChQaXBlbGluZS9ibGVuZGVyL3JlbmRlcl9wb3J0cmFpdC5weSwgaGVhZC1hbmQtc2hvdWxkZXJzIG1vZGUpLCBzaGFyZWQgYnkgdGhlIEFuZ3VsYXIgcGFnZXMgYW5kIHRoZSBiYXR0bGUgc2NyZWVuLlxuLy8gU291bHMgd2l0aG91dCBhIHBvcnRyYWl0IHlldCBmYWxsIGJhY2sgdG8gdGhlaXIgcm9sZSBpY29uIG9uIGEgY29sb3VyZWQgY2FyZC5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7IFJBUklUWV9PRiB9IGZyb20gJy4uL2NvcmUvcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSYXJpdHkgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcbmltcG9ydCB7IFNPVUxfSUNPTiwgaWNvblVybCB9IGZyb20gJy4vaWNvbnMudHMnO1xuXG5jb25zdCBQT1JUUkFJVDogUGFydGlhbDxSZWNvcmQ8U291bElkLCBzdHJpbmc+PiA9IHsgd2FycmlvcjogJ2Fzc2V0cy9wb3J0cmFpdHMvd2Fycmlvcl9oZWFkLnBuZycsIGFyY2hlcjogJ2Fzc2V0cy9wb3J0cmFpdHMvYXJjaGVyX2hlYWQucG5nJywgb2dyZTogJ2Fzc2V0cy9wb3J0cmFpdHMvb2dyZV9oZWFkLnBuZycsIGdvYmxpbjogJ2Fzc2V0cy9wb3J0cmFpdHMvZ29ibGluX2hlYWQucG5nJywga25pZ2h0OiAnYXNzZXRzL3BvcnRyYWl0cy9rbmlnaHRfaGVhZC5wbmcnLCBiYXJiYXJpYW46ICdhc3NldHMvcG9ydHJhaXRzL2JhcmJhcmlhbl9oZWFkLnBuZycgfTtcbmNvbnN0IFJBUklUWV9IRVg6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJyNiOGMwY2MnLCByYXJlOiAnIzRhYTNmZicsIGVwaWM6ICcjYjI2YmZmJywgbGVnZW5kYXJ5OiAnI2ZmY2MzMycgfTtcbmV4cG9ydCBjb25zdCBoYXNBcnQgPSAoczogU291bElkKTogYm9vbGVhbiA9PiAhIVBPUlRSQUlUW3NdO1xuZXhwb3J0IGNvbnN0IHNvdWxBcnQgPSAoczogU291bElkKTogc3RyaW5nID0+IFBPUlRSQUlUW3NdID8/IGljb25VcmwoU09VTF9JQ09OW3NdKTtcbmV4cG9ydCBjb25zdCByYXJpdHlDb2xvciA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4gUkFSSVRZX0hFWFtSQVJJVFlfT0Zbc11dO1xuLyoqIENhcmQgYmFja2Ryb3AgZm9yIGEgcG9ydHJhaXQ6IGEgZ2xvdyBpbiB0aGUgcmFyaXR5IGNvbG91ciBiZWhpbmQgdGhlIGZpZ3VyZSwgb24gYSBkYXJrIGNyeXB0IGdyYWRpZW50LiAqL1xuZXhwb3J0IGNvbnN0IGFydEJnID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiB7IGNvbnN0IGMgPSByYXJpdHlDb2xvcihzKTsgcmV0dXJuIGByYWRpYWwtZ3JhZGllbnQoZWxsaXBzZSBhdCA1MCUgODAlLCAke2N9NzcgMCUsICR7Y30yNiA0NiUsIHRyYW5zcGFyZW50IDc0JSksIGxpbmVhci1ncmFkaWVudCgjMmIyNDQ0LCMwZDA5MTkpYDsgfTtcbiIsICIvLyBET00gdXNlciBpbnRlcmZhY2U6IHRvcCBiYXIsIGVuZW15IHByZXZpZXcsIGhhbmQgb2YgY2FyZHMsIGJ1dHRvbnMsIGRyYWZ0IG92ZXJsYXksIHRvYXN0cyBhbmQgdGhlIGRlYnVnIHBhbmVsLlxuaW1wb3J0IHsgQkFMQU5DRSwgUk9MRV9URVhULCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgaXNFbmRsZXNzIH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNvc3QsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBzdGFnZVdhdmVzIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBlbmVteVdhdmUsIHByZXZpZXdUZXh0IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgYXJ0QmcsIGhhc0FydCwgcmFyaXR5Q29sb3IsIHNvdWxBcnQgfSBmcm9tICcuLi91aS9wb3J0cmFpdHMudHMnO1xuaW1wb3J0IHsgU09VTF9JQ09OLCBoZWFydHNIdG1sLCBpY29uSW1nLCBpY29uVXJsLCBza3VsbEltZ3MgfSBmcm9tICcuLi91aS9pY29ucy50cyc7XG5pbXBvcnQgeyBkZXNjcmliZVVubG9jayB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuXG5jb25zdCBwb3J0cmFpdEh0bWwgPSAoczogU291bElkKTogc3RyaW5nID0+IGA8ZGl2IGNsYXNzPVwicHRcIiBzdHlsZT1cImJhY2tncm91bmQ6JHthcnRCZyhzKX1cIj48aW1nIHNyYz1cIiR7c291bEFydChzKX1cIiBhbHQ9XCJcIiBkcmFnZ2FibGU9XCJmYWxzZVwiPjwvZGl2PmA7XG5jb25zdCBJQ09OID0gT2JqZWN0LmZyb21FbnRyaWVzKFNPVUxTLm1hcCgocykgPT4gW3MsIGljb25JbWcoU09VTF9JQ09OW3NdLCAnaWMnKV0pKSBhcyBSZWNvcmQ8U291bElkLCBzdHJpbmc+O1xuY29uc3QgJCA9IChpZDogc3RyaW5nKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkhO1xuY29uc3Qgc3RhcnMgPSAobjogbnVtYmVyKSA9PiAnXHUyNjA1Jy5yZXBlYXQobik7XG5cbmV4cG9ydCBjbGFzcyBVaSB7XG4gIHByaXZhdGUgdG9hc3RUID0gMDsgcHJpdmF0ZSBkYmc6IEhUTUxFbGVtZW50OyBwcml2YXRlIG9kZHMgPSAnJztcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBnOiBhbnkpIHtcbiAgICAkKCdidG5Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAkKCdidG5CYXR0bGUnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydEJhdHRsZSgpOyAkKCdidG5Td2FwJykub25jbGljayA9ICgpID0+IGcudG9nZ2xlU3dhcCgpO1xuICAgICQoJ2J0blJlbW92ZScpLm9uY2xpY2sgPSAoKSA9PiBnLnJlbW92ZVNlbGVjdGVkKCk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLXNwZWVkXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiBnLnNldFNwZWVkKCtiLmRhdGFzZXQuc3BlZWQhKSkpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0Q2FtTW9kZShiLmRhdGFzZXQuY2FtISkpKTtcbiAgICAkKCdnZWFyJykub25jbGljayA9ICgpID0+IHsgdGhpcy5kYmcuY2xhc3NMaXN0LnRvZ2dsZSgnb3BlbicpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgY29uc3Qgc25kID0gKCkgPT4geyAkKCdidG5NdXNpYycpLmNsYXNzTGlzdC50b2dnbGUoJ29mZicsICFhdWRpby5tdXNpYyk7ICQoJ2J0blNmeCcpLmNsYXNzTGlzdC50b2dnbGUoJ29mZicsICFhdWRpby5zZngpOyBjb25zdCBzaSA9ICQoJ2J0blNmeCcpLnF1ZXJ5U2VsZWN0b3IoJ2ltZycpOyBpZiAoc2kpIHNpLnNyYyA9IGljb25VcmwoYXVkaW8uc2Z4ID8gJ3NvdW5kX29uJyA6ICdzb3VuZF9vZmYnKTsgfTtcbiAgICAkKCdidG5NdXNpYycpLm9uY2xpY2sgPSAoKSA9PiB7IGF1ZGlvLnNldE11c2ljKCFhdWRpby5tdXNpYyk7IHNuZCgpOyB9OyAkKCdidG5TZngnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRTZngoIWF1ZGlvLnNmeCk7IHNuZCgpOyB9O1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCduZWNyby1zZXR0aW5ncycsIHNuZCk7IHNuZCgpO1xuICAgIHRoaXMuZGJnID0gJCgnZGVidWcnKTsgaWYgKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ2RlYnVnJykpIHRoaXMuZGJnLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgICB0aGlzLnJlbmRlckRlYnVnKCk7XG4gIH1cblxuICAvKiogVGhlIE5lY3JvbWFuY2VyIGp1c3QgbG9zdCBhIGhlYXJ0OiBtYWtlIHRoZSBoZWFydHMgYnVtcC4gKi9cbiAgcHVsc2VIZWFydHMoKSB7IGNvbnN0IGggPSAkKCdoZWFydHMnKTsgaC5jbGFzc0xpc3QucmVtb3ZlKCdodXJ0Jyk7IHZvaWQgaC5vZmZzZXRXaWR0aDsgaC5jbGFzc0xpc3QuYWRkKCdodXJ0Jyk7IH1cbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgY29uc3QgdCA9ICQoJ3RvYXN0Jyk7IHQudGV4dENvbnRlbnQgPSBtc2c7IHQuY2xhc3NMaXN0LmFkZCgnc2hvdycpOyBjbGVhclRpbWVvdXQodGhpcy50b2FzdFQpOyB0aGlzLnRvYXN0VCA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHQuY2xhc3NMaXN0LnJlbW92ZSgnc2hvdycpLCAzNjAwKTsgfVxuXG4gIHJlbmRlcigpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBzID0gZy5zLCBwaCA9IGcucGhhc2UsIGJ1aWxkID0gcGggPT09ICdidWlsZCc7XG4gICAgJCgnaGVhcnRzJykuaW5uZXJIVE1MID0gaGVhcnRzSHRtbChzLmhlYXJ0cyk7XG4gICAgJCgnd2F2ZScpLnRleHRDb250ZW50ID0gaXNFbmRsZXNzKCkgPyBgV2F2ZSAke3Mud2F2ZX1gIDogYFdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX1gO1xuICAgIGNvbnN0IHVzZWQgPSBkb21pbmlvblVzZWQocyk7ICQoJ2RvbScpLnRleHRDb250ZW50ID0gYCR7dXNlZH0vJHtzLmNhcH1gOyAoJCgnZG9tZmlsbCcpIGFzIEhUTUxFbGVtZW50KS5zdHlsZS53aWR0aCA9IE1hdGgubWluKDEwMCwgKHVzZWQgLyBzLmNhcCkgKiAxMDApICsgJyUnO1xuICAgIC8vIGVuZW15IHByZXZpZXc6IHdoYXQgaXMgY29taW5nLCBuZXZlciB3aGVyZVxuICAgIGNvbnN0IHB2ID0gcHJldmlld1RleHQoZW5lbXlXYXZlKHMud2F2ZSwgZy5zZWVkKSk7XG4gICAgJCgnZW5lbXknKS5pbm5lckhUTUwgPSBgPGI+TmV4dCBlbmVtaWVzPC9iPmAgKyBwdi5tYXAoKHApID0+IGA8ZGl2IGNsYXNzPVwiZXJvd1wiPjxzcGFuPiR7SUNPTltwLnNvdWwgYXMgU291bElkXX08L3NwYW4+PHNwYW4+JHtTT1VMX05BTUVbcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuIGNsYXNzPVwieFwiPlx1MDBENyR7cC5jb3VudH08L3NwYW4+PHNwYW4gY2xhc3M9XCJzdFwiPiR7c3RhcnMocC5zdGFyKX08L3NwYW4+PC9kaXY+YCkuam9pbignJykgKyBgPGRpdiBjbGFzcz1cImhpbnRcIj5Qb3NpdGlvbnMgc3RheSBoaWRkZW4gdW50aWwgdGhlIGJhdHRsZS48L2Rpdj5gO1xuICAgIC8vIGhhbmRcbiAgICBjb25zdCBoYW5kID0gJCgnaGFuZCcpOyBoYW5kLmlubmVySFRNTCA9ICcnO1xuICAgIHMuaGFuZC5mb3JFYWNoKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4ge1xuICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgY29uc3Qgc2VsID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIGcuc2VsLmlkeCA9PT0gaTsgY29uc3QgYWZmb3JkID0gY2FuU3VtbW9uKHMsIGkpLCBjYW5NZXJnZSA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKSwgdXNhYmxlID0gYWZmb3JkIHx8IGNhbk1lcmdlO1xuICAgICAgY29uc3QgYXJ0ID0gaGFzQXJ0KHNvdWwpOyBlbC5jbGFzc05hbWUgPSAnY2FyZCcgKyAoYXJ0ID8gJyBhcnQnIDogJycpICsgKHNlbCA/ICcgc2VsJyA6ICcnKSArICghdXNhYmxlICYmICFnLnN3YXBNb2RlID8gJyBkaXMnIDogJycpICsgKGcuc3dhcE1vZGUgPyAnIHN3YXAnIDogJycpO1xuICAgICAgY29uc3QgdGFnID0gYWZmb3JkID8gYDxzcGFuIGNsYXNzPVwib2tcIj5TdW1tb248L3NwYW4+YCA6IGNhbk1lcmdlID8gJzxzcGFuIGNsYXNzPVwib2sgbWdcIj5NZXJnZSBvbmx5PC9zcGFuPicgOiAnPHNwYW4gY2xhc3M9XCJub1wiPk5vIHJvb208L3NwYW4+JztcbiAgICAgIGlmIChhcnQpIGVsLnN0eWxlLmJvcmRlckNvbG9yID0gcmFyaXR5Q29sb3Ioc291bCk7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHthcnQgPyBwb3J0cmFpdEh0bWwoc291bCkgOiBJQ09OW3NvdWxdICsgYDxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PmB9PGRpdiBjbGFzcz1cImNzXCI+JHt0YWd9PC9kaXY+YDsgZWwudGl0bGUgPSBST0xFX1RFWFRbc291bF0gKyAoYWZmb3JkID8gJycgOiBjYW5NZXJnZSA/ICcgLSBEb21pbmlvbiBpcyBmdWxsLCBidXQgeW91IGNhbiBtZXJnZSBpdCBpbnRvIHlvdXIgbWF0Y2hpbmcgMS1zdGFyIHVuaXQuJyA6ICcgLSBOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJyk7XG4gICAgICBlbC5vbmNsaWNrID0gKCkgPT4gZy5vbkNhcmQoaSk7IGhhbmQuYXBwZW5kQ2hpbGQoZWwpO1xuICAgIH0pO1xuICAgIGlmICghcy5oYW5kLmxlbmd0aCkgaGFuZC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cImVtcHR5XCI+Tm8gY2FyZHMgaW4gaGFuZDwvZGl2Pic7XG4gICAgLy8gYnV0dG9uc1xuICAgICgkKCdidG5CYXR0bGUnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhYnVpbGQgfHwgIXMudW5pdHMubGVuZ3RoO1xuICAgIGNvbnN0IHN3ID0gJCgnYnRuU3dhcCcpIGFzIEhUTUxCdXR0b25FbGVtZW50OyBzdy5kaXNhYmxlZCA9ICFidWlsZCB8fCBzLmRpc2NhcmRVc2VkOyBzdy5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGcuc3dhcE1vZGUpOyBzdy50ZXh0Q29udGVudCA9IHMuZGlzY2FyZFVzZWQgPyAnU3dhcCB1c2VkJyA6IGcuc3dhcE1vZGUgPyAnU3dhcDogcGljayBhIGNhcmQgb3IgdW5pdCcgOiAnU3dhcCAoMS9yb3VuZCknO1xuICAgIGNvbnN0IHNlbFUgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAndW5pdCcgPyBzLnVuaXRzLmZpbmQoKHU6IGFueSkgPT4gdS5pZCA9PT0gZy5zZWwuaWQpIDogbnVsbDtcbiAgICBjb25zdCBwYXJ0bmVyID0gc2VsVSAmJiBzLnVuaXRzLnNvbWUoKG86IGFueSkgPT4gY2FuTWVyZ2VEZXBsb3llZChzZWxVLCBvKSk7XG4gICAgJCgndW5pdHBhbmVsJykuc3R5bGUuZGlzcGxheSA9IGJ1aWxkICYmIHNlbFUgPyAnZmxleCcgOiAnbm9uZSc7XG4gICAgJCgnYnRuUmVtb3ZlJykudGV4dENvbnRlbnQgPSBnLmNvbmZpcm1SZW1vdmUgPyAnQ29uZmlybSByZW1vdmUnIDogJ1JlbW92ZSc7XG4gICAgJCgnaW5mbycpLnRleHRDb250ZW50ID0gYnVpbGQgPyAoZy5zd2FwTW9kZSA/ICdTV0FQOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCBpdCwgb3IgdGFwIGEgdW5pdCB5b3UgZGlkIG5vdCBzdW1tb24gdGhpcyByb3VuZCB0byBzZWxsIGl0LiBZb3UgZHJhdyBhIGRpZmZlcmVudCBTb3VsLidcbiAgICAgIDogc2VsVSA/IGAke1NPVUxfTkFNRVtzZWxVLnNvdWwgYXMgU291bElkXX0gJHtzdGFycyhzZWxVLnN0YXIpfSAgXHUyMDIyICAke1JPTEVfVEVYVFtzZWxVLnNvdWwgYXMgU291bElkXX0gICR7cGFydG5lciA/ICdcdTIwMjIgVGFwIHRoZSBtYXRjaGluZyB1bml0IHRvIG1lcmdlIGludG8gYSBzdHJvbmdlciBzdGFyLicgOiAnJ31gXG4gICAgICA6IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyA/IGAke1NPVUxfTkFNRVtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfTogJHtST0xFX1RFWFRbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX0gIFx1MjAyMiAgYCArICgoKSA9PiB7IGNvbnN0IGkgPSBnLnNlbC5pZHgsIHNtID0gY2FuU3VtbW9uKHMsIGkpLCBtZyA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKTsgcmV0dXJuIHNtICYmIG1nID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLCBvciBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6IHNtID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLicgOiBtZyA/ICdEb21pbmlvbiBpcyBmdWxsOiB0YXAgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiAnTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLic7IH0pKCkgOiAnVGFwIGEgY2FyZCwgdGhlbiBhIHRpbGUuIFRhcCBhIHVuaXQgdG8gbWVyZ2UsIG1vdmUgb3IgcmVtb3ZlIGl0LicpXG4gICAgICA6IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ0JhdHRsZSEgVW5pdHMgZmlnaHQgb24gdGhlaXIgb3duLicgOiAnJztcbiAgICAkKCdzcGVlZCcpLnN0eWxlLmRpc3BsYXkgPSBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdmbGV4JyA6ICdub25lJztcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtc3BlZWRdJykuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsICtiLmRhdGFzZXQuc3BlZWQhID09PSBnLnRpbWVTY2FsZSkpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGIuZGF0YXNldC5jYW0gPT09IGcuY2FtTW9kZSkpO1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnRvZ2dsZSgnaW5iYXR0bGUnLCBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyk7IGF1ZGlvLnNldE1vZGUocGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnYmF0dGxlJyA6ICdidWlsZCcpO1xuICAgIC8vIG92ZXJsYXlcbiAgICBjb25zdCBvdiA9ICQoJ292ZXJsYXknKTsgb3YuY2xhc3NOYW1lID0gJyc7IG92LmlubmVySFRNTCA9ICcnO1xuICAgIGlmIChwaCA9PT0gJ2RyYWZ0JyAmJiBnLmRyYWZ0KSB7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPlZpY3RvcnkgRHJhZnQ8L2gyPjxkaXYgY2xhc3M9XCJzdWJcIj5XYXZlIGNsZWFyZWQuIERvbWluaW9uIGlzIG5vdyAke3MuY2FwfS4gS2VlcCBvbmU6PC9kaXY+PGRpdiBjbGFzcz1cInJvd1wiPiR7Zy5kcmFmdC5tYXAoKHNvdWw6IFNvdWxJZCwgaTogbnVtYmVyKSA9PiBgPGRpdiBjbGFzcz1cImNhcmQgYmlnJHtoYXNBcnQoc291bCkgPyAnIGFydCcgOiAnJ31cIiBkYXRhLWk9XCIke2l9XCIke2hhc0FydChzb3VsKSA/IGAgc3R5bGU9XCJib3JkZXItY29sb3I6JHtyYXJpdHlDb2xvcihzb3VsKX1cImAgOiAnJ30+PGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHtoYXNBcnQoc291bCkgPyBwb3J0cmFpdEh0bWwoc291bCkgOiBJQ09OW3NvdWxdfTxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJyb2xlXCI+JHtST0xFX1RFWFRbc291bF19PC9kaXY+PC9kaXY+YCkuam9pbignJyl9PC9kaXY+PC9kaXY+YDtcbiAgICAgIG92LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCcuY2FyZCcpLmZvckVhY2goKGMpID0+IChjLm9uY2xpY2sgPSAoKSA9PiBnLnBpY2tEcmFmdCgrYy5kYXRhc2V0LmkhKSkpO1xuICAgIH0gZWxzZSBpZiAocGggPT09ICd3b24nIHx8IHBoID09PSAnbG9zdCcpIHtcbiAgICAgIGNvbnN0IHJ3ID0gcGggPT09ICd3b24nID8gZy5yZXdhcmQgOiBudWxsLCBzayA9IChuOiBudW1iZXIpID0+IHNrdWxsSW1ncyhuKTtcbiAgICAgIGNvbnN0IHVubG9ja0h0bWwgPSBydyAmJiBydy51bmxvY2tlZCAmJiBydy51bmxvY2tlZC5sZW5ndGggPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6IzdlZjJjODtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ2NoZWNrJyl9IFVubG9ja2VkOiAke3J3LnVubG9ja2VkLm1hcCgoazogc3RyaW5nKSA9PiBkZXNjcmliZVVubG9jayhrKSkuam9pbignIFxcdTAwYjcgJyl9PC9kaXY+YCA6ICcnO1xuICAgICAgY29uc3QgcmV3YXJkSHRtbCA9IHVubG9ja0h0bWwgKyAocncgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke3J3LnBhY2sgPyAocncuZmlyc3QgPyBgJHtpY29uSW1nKCdzaG9wJyl9IEZpcnN0IGNsZWFyISBZb3UgZWFybmVkIGEgJHtzayhydy5wYWNrLnRpZXIpfSBTb3VsIFBhY2suYCA6IGAke2ljb25JbWcoJ3Nob3AnKX0gUmVwbGF5IHJld2FyZDogYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gKSA6IGBSZXBsYXkgcHJvZ3Jlc3MgJHtydy5yZXBsYXlNZXRlcn0vJHtydy5yZXBsYXlOZWVkZWR9IHRvd2FyZCBhIFNvdWwgUGFjay5gfTwvZGl2PmAgOiAnJyk7XG4gICAgICBpZiAocGggPT09ICdsb3N0JyAmJiBpc0VuZGxlc3MoKSAmJiBnLmVuZGxlc3MpIHsgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBlbmQgb2YgYW4gZW5kbGVzcyBydW46IGhvdyBkZWVwLCBhbnkgcmVjb3JkLCBwYWNrcyBlYXJuZWRcbiAgICAgICAgY29uc3QgZSA9IGcuZW5kbGVzcywgcmVjID0gZS5jbGVhcmVkID4gZS5zdGFydEJlc3Q7XG4gICAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+UnVuIG92ZXI8L2gyPjxkaXYgY2xhc3M9XCJzdWJcIj5Zb3UgY2xlYXJlZCAke2UuY2xlYXJlZH0gd2F2ZSR7ZS5jbGVhcmVkID09PSAxID8gJycgOiAncyd9LiAke3JlYyA/ICc8YiBzdHlsZT1cImNvbG9yOiNmZmQyNGFcIj5OZXcgYmVzdCBkZXB0aCE8L2I+JyA6ICdCZXN0OiB3YXZlICcgKyBNYXRoLm1heChlLnN0YXJ0QmVzdCwgZS5jbGVhcmVkKSArICcuJ308L2Rpdj4ke2UucGFja3MgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ3Nob3AnKX0gJHtlLnBhY2tzfSBTb3VsIFBhY2ske2UucGFja3MgPT09IDEgPyAnJyA6ICdzJ30gZWFybmVkIHRoaXMgcnVuLjwvZGl2PmAgOiAnPGRpdiBjbGFzcz1cInN1YlwiPkNsZWFyIHdhdmUgMTAgdG8gZWFybiBhIFNvdWwgUGFjay48L2Rpdj4nfTxkaXYgY2xhc3M9XCJyb3dcIj4ke2UucGFja3MgPyAnPGJ1dHRvbiBpZD1cInRvU2hvcFwiIGNsYXNzPVwiZ29cIj5PcGVuIHBhY2s8L2J1dHRvbj4nIDogJyd9PGJ1dHRvbiBpZD1cImFnYWluXCIgY2xhc3M9XCIke2UucGFja3MgPyAnYmx1ZScgOiAnZ28nfVwiPkdvIGFnYWluPC9idXR0b24+PGJ1dHRvbiBpZD1cInRvSG9tZVwiIGNsYXNzPVwiYmx1ZVwiPkhvbWU8L2J1dHRvbj48L2Rpdj48L2Rpdj5gO1xuICAgICAgICAkKCdhZ2FpbicpLm9uY2xpY2sgPSAoKSA9PiBnLm5ld0VuZGxlc3MoKTsgJCgndG9Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAgICAgY29uc3QgdHMyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvU2hvcCcpOyBpZiAodHMyKSB0czIub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc2hvcCcpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPiR7cGggPT09ICd3b24nID8gJ1N0YWdlIGNsZWFyZWQhJyA6ICdTdGFnZSBsb3N0J308L2gyPjxkaXYgY2xhc3M9XCJzdWJcIj4ke2cubGFzdEJhdHRsZX08L2Rpdj4ke3Jld2FyZEh0bWx9PGRpdiBjbGFzcz1cInJvd1wiPiR7cncgJiYgcncucGFjayA/ICc8YnV0dG9uIGlkPVwidG9TaG9wXCIgY2xhc3M9XCJnb1wiPk9wZW4gcGFjazwvYnV0dG9uPicgOiAnJ308YnV0dG9uIGlkPVwiYWdhaW5cIiBjbGFzcz1cIiR7cncgJiYgcncucGFjayA/ICdibHVlJyA6ICdnbyd9XCI+JHtwaCA9PT0gJ3dvbicgPyAnUGxheSBhZ2FpbicgOiAnVHJ5IGFnYWluJ308L2J1dHRvbj48YnV0dG9uIGlkPVwidG9Ib21lXCIgY2xhc3M9XCJibHVlXCI+SG9tZTwvYnV0dG9uPjwvZGl2PjwvZGl2PmA7XG4gICAgICAkKCdhZ2FpbicpLm9uY2xpY2sgPSAoKSA9PiBnLm5ld1J1bigpOyAkKCd0b0hvbWUnKS5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1ob21lJykpO1xuICAgICAgY29uc3QgdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG9TaG9wJyk7IGlmICh0cykgdHMub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc2hvcCcpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5yZW5kZXJEZWJ1Z0xpdmUoKTtcbiAgICBpZiAocGggPT09ICdidWlsZCcpIHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiBnLnJlZnJhbWVCdWlsZCgpKTsgICAgIC8vIGFmdGVyIGxheW91dDoga2VlcCB0aGUgZ3JpZCBjbGVhciBvZiB0aGUgaGFuZCBhbmQgYnV0dG9uc1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIHBhbmVsXG4gIHByaXZhdGUgcmVuZGVyRGVidWcoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgZCA9IHRoaXMuZGJnOyBpZiAoIWQuY2xhc3NMaXN0LmNvbnRhaW5zKCdvcGVuJykpIHsgZC5pbm5lckhUTUwgPSAnJzsgcmV0dXJuOyB9XG4gICAgY29uc3Qgcm93ID0gKGxhYmVsOiBzdHJpbmcsIG9iajogYW55LCBrZXk6IHN0cmluZyB8IG51bWJlciwgbWluOiBudW1iZXIsIG1heDogbnVtYmVyLCBzdGVwOiBudW1iZXIpID0+IGA8bGFiZWw+JHtsYWJlbH0gPGlucHV0IHR5cGU9XCJyYW5nZVwiIG1pbj1cIiR7bWlufVwiIG1heD1cIiR7bWF4fVwiIHN0ZXA9XCIke3N0ZXB9XCIgdmFsdWU9XCIke29ialtrZXldfVwiIGRhdGEtbz1cIiR7bGFiZWx9XCI+PHNwYW4+JHtvYmpba2V5XX08L3NwYW4+PC9sYWJlbD5gO1xuICAgIGQuaW5uZXJIVE1MID0gYDxiPkRlYnVnIChsaXZlKTwvYj4gPHNwYW4gaWQ9XCJkYmdmcHNcIj48L3NwYW4+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPlN0YXIgbXVsdGlwbGllcnMgKGJvZGllcyA9IGRhbWFnZSwgc3RhcnMgPSBkdXJhYmlsaXR5KVxuICAgICAgICAke3JvdygnSFAgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAxLCAxLCA0LCAwLjA1KX0ke3JvdygnSFAgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnRGFtYWdlIHggMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5kbWcsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMiwgMSwgNiwgMC4wNSl9JHtyb3coJ1NpemUgMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5zY2FsZSwgMSwgMSwgMS42LCAwLjAyKX0ke3JvdygnU2l6ZSAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAyLCAxLCAyLCAwLjAyKX08L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHRhYmxlPjx0cj48dGg+PC90aD48dGg+aHA8L3RoPjx0aD5kbWc8L3RoPjx0aD5yYXRlPC90aD48dGg+cmFuZ2U8L3RoPjx0aD5zcGQ8L3RoPjwvdHI+JHtTT1VMUy5tYXAoKGspID0+IGA8dHI+PHRkPiR7SUNPTltrXX08L3RkPiR7WydocCcsICdkbWcnLCAnaW50ZXJ2YWwnLCAncmFuZ2UnLCAnc3BlZWQnXS5tYXAoKGYpID0+IGA8dGQ+PGlucHV0IGNsYXNzPVwibnVtXCIgZGF0YS1zb3VsPVwiJHtrfVwiIGRhdGEtZj1cIiR7Zn1cIiB2YWx1ZT1cIiR7KEJBTEFOQ0Uuc3RhdHMgYXMgYW55KVtrXVtmXX1cIj48L3RkPmApLmpvaW4oJycpfTwvdHI+YCkuam9pbignJyl9PC90YWJsZT48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+RGlmZmljdWx0eSA8c2VsZWN0IGlkPVwiZERpZmZcIj4ke1snZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXS5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiICR7Zy5kaWZmaWN1bHR5ID09PSBrID8gJ3NlbGVjdGVkJyA6ICcnfT4ke2t9PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxzbWFsbD4oYXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUpPC9zbWFsbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRNZXJnZUhhbmRcIiAke2cucy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicgPyAnY2hlY2tlZCcgOiAnJ30+IE1lcmdlIGEgaGFuZCBjYXJkIHN0cmFpZ2h0IGludG8gYSBkZXBsb3llZCB1bml0IChvZmYgPSBkb2MgcnVsZTogYm90aCBjb3BpZXMgbXVzdCBiZSBvbiB0aGUgYm9hcmQpPC9sYWJlbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+UGVyZm9ybWFuY2U8YnI+PHNtYWxsIGlkPVwiZGJnUGVyZlwiPm1lYXN1cmluZ1x1MjAyNjwvc21hbGw+PGJyPjxsYWJlbD48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgaWQ9XCJkRnBzXCIgJHtnLnNob3dGcHMgPyAnY2hlY2tlZCcgOiAnJ30+IFNob3cgRlBTIG9uIHRoZSBiYXR0bGUgc2NyZWVuPC9sYWJlbD4gPGJ1dHRvbiBpZD1cImRQZXJmXCI+Q29weSBwZXJmIHJlcG9ydDwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZE9kZHNcIj5UZXN0IG9kZHMgKDIwMCBmaWdodHMpPC9idXR0b24+IDxzcGFuIGlkPVwiZE9kZHNPdXRcIj4ke3RoaXMub2Rkc308L3NwYW4+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkQ29weVwiPkNvcHkgcmVwb3J0PC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzZXRcIj5SZXNldCBiYWxhbmNlPC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzdGFydFwiPlJlc3RhcnQgc3RhZ2U8L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+QWRkIGNhcmQgPHNlbGVjdCBpZD1cImRDYXJkXCI+JHtTT1VMUy5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiPiR7U09VTF9OQU1FW2tdfTwvb3B0aW9uPmApLmpvaW4oJycpfTwvc2VsZWN0PiA8YnV0dG9uIGlkPVwiZEFkZFwiPis8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImREb21cIj4rMiBEb21pbmlvbjwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+TGFzdCB0YXA6IDxzcGFuIGlkPVwiZGJndGFwXCI+JHtnLmxhc3RUYXBJbmZvfTwvc3Bhbj48L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+U2VlZCAke2cuc2VlZH0uIEFkZCA8Y29kZT4/c2VlZD03PC9jb2RlPiB0byB0aGUgbGluayB0byByZXBsYXkgdGhlIHNhbWUgZHJhd3MuPC9zbWFsbD48L2Rpdj5gO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXRbdHlwZT1yYW5nZV0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25pbnB1dCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGxhYiA9IGlucC5kYXRhc2V0Lm8hOyBjb25zdCB2ID0gK2lucC52YWx1ZTsgKGlucC5uZXh0RWxlbWVudFNpYmxpbmcgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gU3RyaW5nKHYpO1xuICAgICAgY29uc3Qgc2V0OiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkPiA9IHsgJ0hQIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMV0gPSB2KSwgJ0hQIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMl0gPSB2KSwgJ0RhbWFnZSB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1sxXSA9IHYpLCAnRGFtYWdlIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzJdID0gdiksICdTaXplIDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzFdID0gdiksICdTaXplIDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzJdID0gdikgfTtcbiAgICAgIHNldFtsYWJdKCk7IGcuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7XG4gICAgfSkpO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXQubnVtJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uY2hhbmdlID0gKCkgPT4geyAoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2lucC5kYXRhc2V0LnNvdWwhXVtpbnAuZGF0YXNldC5mIV0gPSAraW5wLnZhbHVlOyB9KSk7XG4gICAgJCgnZERpZmYnKS5vbmNoYW5nZSA9IChlKSA9PiBnLmNoYW5nZURpZmZpY3VsdHkoKGUudGFyZ2V0IGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSk7XG4gICAgJCgnZE1lcmdlSGFuZCcpLm9uY2hhbmdlID0gKGUpID0+IHsgZy5zLnJ1bGVzLm1lcmdlID0gKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQgPyAnaGFuZEludG9PbmVTdGFyJyA6ICdkZXBsb3llZE9ubHknOyBnLnN5bmNCdWlsZCgpOyB0aGlzLnJlbmRlcigpOyB9O1xuICAgICQoJ2RPZGRzJykub25jbGljayA9ICgpID0+IHsgY29uc3QgciA9IGcudGVzdE9kZHMoMjAwKTsgdGhpcy5vZGRzID0gYCR7ci53aW59JSB3aW4gKCR7ci5ufSBmaWdodHMsIGF2ZyAke3IuYXZnVGltZX1zKSB2cyB3YXZlICR7Zy5zLndhdmV9YDsgJCgnZE9kZHNPdXQnKS50ZXh0Q29udGVudCA9IHRoaXMub2RkczsgfTtcbiAgICAkKCdkQ29weScpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdSZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkRnBzJykub25jaGFuZ2UgPSAoZSkgPT4gZy5zZXRTaG93RnBzKChlLnRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS5jaGVja2VkKTtcbiAgICAkKCdkUGVyZicpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnBlcmZSZXBvcnQoKTsgKG5hdmlnYXRvci5jbGlwYm9hcmQgPyBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KSA6IFByb21pc2UucmVqZWN0KCkpLnRoZW4oKCkgPT4gdGhpcy50b2FzdCgnUGVyZiByZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkUmVzZXQnKS5vbmNsaWNrID0gKCkgPT4geyBnLnJlc2V0QmFsYW5jZUFsbCgpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgJCgnZFJlc3RhcnQnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydFN0YWdlKGcuc2VlZCk7XG4gICAgJCgnZEFkZCcpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZENhcmQoKCQoJ2RDYXJkJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlIGFzIFNvdWxJZCk7ICQoJ2REb20nKS5vbmNsaWNrID0gKCkgPT4gZy5hZGREb21pbmlvbigyKTtcbiAgfVxuICByZW5kZXJEZWJ1Z0xpdmUoKSB7XG4gICAgY29uc3QgZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmdmcHMnKTsgaWYgKGYpIGYudGV4dENvbnRlbnQgPSBgJHt0aGlzLmcucGhhc2V9YDtcbiAgICBjb25zdCBwZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmdQZXJmJyk7IGlmIChwZikgeyBjb25zdCBwID0gdGhpcy5nLnBlcmZJbmZvKCk7IHBmLnRleHRDb250ZW50ID0gYCR7cC5mcHMudG9GaXhlZCgwKX0gZnBzIFx1MDBCNyBhdmcgJHtwLmF2Zy50b0ZpeGVkKDEpfW1zIFx1MDBCNyBzbG93NSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zIFx1MDBCNyB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyBcdTAwQjcgJHtwLm1lc2hlc30gbWVzaGVzIFx1MDBCNyAke3AucGFydGljbGVzfSBwYXJ0aWNsZSBzeXN0ZW1zIFx1MDBCNyAke3AuZHJhd3N9IGRyYXcgY2FsbHNgOyB9XG4gICAgY29uc3QgdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmd0YXAnKTsgaWYgKHQpIHQudGV4dENvbnRlbnQgPSB0aGlzLmcubGFzdFRhcEluZm87XG4gIH1cbn1cbiIsICIvLyBUaGUgcGxheWFibGUgcHJvdG90eXBlOiBidWlsZCBzY3JlZW4gLT4gYmF0dGxlIC0+IGRyYWZ0IC0+IG5leHQgd2F2ZSwgYnVpbHQgb24gdGhlIHRlc3RlZCBydWxlcyArIGJhdHRsZSBlbmdpbmUuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcbmltcG9ydCB7IEJBTEFOQ0UsIHJlc2V0QmFsYW5jZSwgU09VTF9OQU1FIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IEdSSURfQ0VMTFMsIEdSSURfQ09MUywgR1JJRF9ST1dTLCBTT1VMUyB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQge1xuICBhZHZhbmNlV2F2ZSwgY2FuTWVyZ2VEZXBsb3llZCwgY2FuTWVyZ2VGcm9tSGFuZCwgY2FuU3VtbW9uLCBjZWxsRnJlZSwgY29zdCwgZGlzY2FyZFJlZHJhdywgZGlzbWlzcywgZG9taW5pb25GcmVlLCBkb21pbmlvblVzZWQsIGRyYWZ0T3B0aW9ucywgZmFpbFdhdmUsXG4gIG1lcmdlRGVwbG95ZWQsIG1lcmdlRnJvbUhhbmQsIG1vdmVVbml0LCBuZXdTdGFnZSwgbm9ybWFsRHJhdywgc3RhZ2VXYXZlcywgc3VtbW9uLCBzd2FwU2VsbCwgdGFrZURyYWZ0LFxufSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGJ1aWxkQXJlbmEgfSBmcm9tICcuL2FyZW5hLnRzJztcbmltcG9ydCB7IEJhdHRsZSwgY2VsbFBvcywgRlJPTlRfWCwgR1JJRF9TUCwgc2ltdWxhdGUgfSBmcm9tICcuLi9jb3JlL2JhdHRsZS50cyc7XG5pbXBvcnQgdHlwZSB7IEJFdmVudCB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB7IGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5TmFtZSwgZW5lbXlQb3dlciwgZW5lbXlXYXZlLCBpc0VuZGxlc3MsIHNldERpZmZpY3VsdHksIHNldEVuZGxlc3MsIHNldFN0YWdlRGlmZmljdWx0eSB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19JRCwgRU5ETEVTU19QQUNLX0VWRVJZIH0gZnJvbSAnLi4vY29yZS9lbmRsZXNzLnRzJztcbmltcG9ydCB7IEVORExFU1NfUlVMRVMsIFBST1RPVFlQRV9SVUxFUyB9IGZyb20gJy4uL2NvcmUvcHJvdG90eXBlLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlIH0gZnJvbSAnLi4vY29yZS9zYXZlLnRzJztcbmltcG9ydCB7IE5lY3JvbWFuY2VyIH0gZnJvbSAnLi9uZWNyb21hbmNlci50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgY2xlYXJSdW4sIGxvYWRSdW4sIHNhdmVSdW4sIHNlcmlhbGl6ZVN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB7IHBsYXlhYmxlLCByZWNvcmRDbGVhckFuZFNhdmUsIHJlY29yZEVuZGxlc3NXYXZlQW5kU2F2ZSB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBDbGVhclJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSdW5TbmFwc2hvdCB9IGZyb20gJy4uL2NvcmUvcnVuc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBjcmVhdGVWaXN1YWwsIGlzVHJpcG8sIGxvYWRBc3NldHMgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHR5cGUgeyBBc3NldHMsIFVuaXRWaXN1YWwgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHsgVWkgfSBmcm9tICcuL3VpLnRzJztcblxuZXhwb3J0IHR5cGUgUGhhc2UgPSAnYnVpbGQnIHwgJ3RyYW5zaXRpb24nIHwgJ2JhdHRsZScgfCAnZHJhZnQnIHwgJ3dvbicgfCAnbG9zdCc7XG50eXBlIFNlbCA9IHsgdHlwZTogJ2NhcmQnOyBpZHg6IG51bWJlciB9IHwgeyB0eXBlOiAndW5pdCc7IGlkOiBudW1iZXIgfSB8IG51bGw7XG5cbmV4cG9ydCBjbGFzcyBHYW1lIHtcbiAgZW5naW5lOiBhbnk7IHNjZW5lOiBhbnk7IGNhbWVyYTogYW55OyBBITogQXNzZXRzOyB1aSE6IFVpO1xuICBzITogU3RhdGU7IHNlZWQgPSAxOyBhdHRlbXB0ID0gMDsgcGhhc2U6IFBoYXNlID0gJ2J1aWxkJzsgYmF0dGxlOiBCYXR0bGUgfCBudWxsID0gbnVsbDsgdGltZVNjYWxlID0gMTtcbiAgc2VsOiBTZWwgPSBudWxsOyBzd2FwTW9kZSA9IGZhbHNlOyBjb25maXJtUmVtb3ZlID0gZmFsc2U7IGRyYWZ0OiBTb3VsSWRbXSB8IG51bGwgPSBudWxsOyBsYXN0QmF0dGxlID0gJyc7XG4gIHByaXZhdGUgdW5pdFZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgLy8gdW5pdCBpZCAtPiB2aXN1YWwgKHlvdXIgYXJteSwgcGVyc2lzdHMgYmV0d2VlbiB3YXZlcylcbiAgcHJpdmF0ZSB2aXNUb1VuaXQgPSBuZXcgTWFwPFVuaXRWaXN1YWwsIG51bWJlcj4oKTtcbiAgcHJpdmF0ZSBmdmlzID0gbmV3IE1hcDxudW1iZXIsIFVuaXRWaXN1YWw+KCk7ICAgICAgICAgICAvLyBmaWdodGVyIGlkIC0+IHZpc3VhbCBkdXJpbmcgYSBiYXR0bGVcbiAgcHJpdmF0ZSBmVW5pdCA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCk7ICAgICAgICAgICAgICAvLyBmaWdodGVyIGlkIC0+IHVuaXQgaWQgKHBsYXllciBzaWRlKVxuICBwcml2YXRlIGxhc3RTdGF0ZSA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmc+KCk7XG4gIHByaXZhdGUgYXJlbmEhOiB7IHVwZGF0ZSh0OiBudW1iZXIpOiB2b2lkOyBzZXRUaGVtZShzdGFnZTogc3RyaW5nKTogdm9pZCB9O1xuICBwcml2YXRlIHRpbGVzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbGVNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHJpbmdGeDogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd3M6IGFueVtdID0gW107IHByaXZhdGUgdGltZXJzOiB7IHQ6IG51bWJlcjsgZm46ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgYWNjID0gMDsgcHJpdmF0ZSBjYW1Gcm9tOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVRvOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVQgPSAxOyBwcml2YXRlIGNhbUR1ciA9IDIuMDsgcHJpdmF0ZSByZXN1bHRBdCA9IC0xOyBwcml2YXRlIGhhbmRsZWQgPSBmYWxzZTsgcHJpdmF0ZSBzdGFydFN0ZXBBdCA9IDA7XG4gIHByaXZhdGUgYXJyb3dNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93TWVzaDogYW55W10gPSBbXTtcbiAgbmVjcm8hOiBOZWNyb21hbmNlcjtcbiAgLyoqIFdoYXQgdGhlIGxhc3Qgc3RhZ2UgY2xlYXIgZWFybmVkIChzaG93biBvbiB0aGUgc3RhZ2UtY2xlYXJlZCBzY3JlZW4pLiAqL1xuICByZXdhcmQ6IENsZWFyUmV3YXJkIHwgbnVsbCA9IG51bGw7XG4gIC8qKiBUaGUgZW5kbGVzcyBydW4gaW4gcHJvZ3Jlc3M6IHRoZSBiZXN0IGRlcHRoIHdoZW4gaXQgYmVnYW4gKHRvIHNwb3QgYSBuZXcgcmVjb3JkKSwgdGhlIHdhdmVzIGNsZWFyZWQgc28gZmFyLCBhbmQgdGhlIHBhY2tzIGVhcm5lZC4gKi9cbiAgZW5kbGVzczogeyBzdGFydEJlc3Q6IG51bWJlcjsgY2xlYXJlZDogbnVtYmVyOyBwYWNrczogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjaW5lID0gZmFsc2U7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHJlc3VsdCBjdXRzY2VuZSBpcyBwbGF5aW5nOiB0aGUgYmF0dGxlIGNhbWVyYSBhbmQgZmlnaHRlciBzeW5jIHN0YW5kIGRvd25cbiAgcHJpdmF0ZSB0d2VlbnM6IHsgdDogbnVtYmVyOyBkdXI6IG51bWJlcjsgZm46ICh1OiBudW1iZXIpID0+IHZvaWQ7IGRvbmU/OiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIHR3ZWVuKGR1cjogbnVtYmVyLCBmbjogKHU6IG51bWJlcikgPT4gdm9pZCwgZG9uZT86ICgpID0+IHZvaWQpIHsgdGhpcy50d2VlbnMucHVzaCh7IHQ6IDAsIGR1ciwgZm4sIGRvbmUgfSk7IH1cbiAgLyoqIEZpbmlzaCBldmVyeSBydW5uaW5nIGFuaW1hdGlvbiBhdCBvbmNlIChzbyBub3RoaW5nIGlzIGxlZnQgaGFsZi13YXkgb3IgdW5kaXNwb3NlZCB3aGVuIHRoZSBwaGFzZSBjaGFuZ2VzKS4gKi9cbiAgcHJpdmF0ZSBmbHVzaFR3ZWVucygpIHsgZm9yIChjb25zdCB3IG9mIHRoaXMudHdlZW5zLnNwbGljZSgwKSkgeyB3LmZuKDEpOyBpZiAody5kb25lKSB3LmRvbmUoKTsgfSB9XG4gIHByaXZhdGUgc2Vlbk1lcmdlcyA9IDA7XG5cbiAgYXN5bmMgaW5pdChjYW52YXM6IEhUTUxDYW52YXNFbGVtZW50KSB7XG4gICAgY29uc3QgcXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCk7XG4gICAgdGhpcy5lbmdpbmUgPSBuZXcgQkFCWUxPTi5FbmdpbmUoY2FudmFzLCB0cnVlLCB7IGFudGlhbGlhczogdHJ1ZSwgcG93ZXJQcmVmZXJlbmNlOiAnaGlnaC1wZXJmb3JtYW5jZScgfSk7XG4gICAgY29uc3QgZHByID0gd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTsgdGhpcy5lbmdpbmUuc2V0SGFyZHdhcmVTY2FsaW5nTGV2ZWwoMSAvIE1hdGgubWluKGRwciwgMS41KSk7XG4gICAgY29uc3Qgc2NlbmUgPSB0aGlzLnNjZW5lID0gbmV3IEJBQllMT04uU2NlbmUodGhpcy5lbmdpbmUpOyBzY2VuZS5jbGVhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMDksIDAuMDcsIDAuMTMsIDEpO1xuICAgIGNvbnN0IGhlbWkgPSBuZXcgQkFCWUxPTi5IZW1pc3BoZXJpY0xpZ2h0KCdoJywgbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIDEsIDAuMyksIHNjZW5lKTsgaGVtaS5pbnRlbnNpdHkgPSAxLjA1OyBoZW1pLmdyb3VuZENvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMzIsIDAuMjYsIDAuNDIpO1xuICAgIGNvbnN0IHN1biA9IG5ldyBCQUJZTE9OLkRpcmVjdGlvbmFsTGlnaHQoJ3MnLCBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjQsIC0xLCAwLjU1KSwgc2NlbmUpOyBzdW4uaW50ZW5zaXR5ID0gMC44NTtcbiAgICB0aGlzLmNhbWVyYSA9IG5ldyBCQUJZTE9OLkZyZWVDYW1lcmEoJ2NhbScsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgOCwgLTkpLCBzY2VuZSk7IHRoaXMuY2FtZXJhLm1pblogPSAwLjE7IHRoaXMuY2FtZXJhLm1heFogPSAyMDA7IHRoaXMuY2FtZXJhLmZvdiA9IDAuODsgdGhpcy5jYW1lcmEuaW5wdXRzLmNsZWFyKCk7XG5cbiAgICBjb25zdCBncm91bmQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgnZ3JvdW5kJywgeyB3aWR0aDogNjAsIGhlaWdodDogNDAgfSwgc2NlbmUpO1xuICAgIGdyb3VuZC5pc1BpY2thYmxlID0gZmFsc2U7IGNvbnN0IGFyZW5hID0gdGhpcy5hcmVuYSA9IGJ1aWxkQXJlbmEoc2NlbmUsIGdyb3VuZCk7IHNjZW5lLm9uQmVmb3JlUmVuZGVyT2JzZXJ2YWJsZS5hZGQoKCkgPT4gYXJlbmEudXBkYXRlKHBlcmZvcm1hbmNlLm5vdygpIC8gMTAwMCkpO1xuICAgIGZvciAoY29uc3QgdGVhbSBvZiBbMCwgMV0gYXMgY29uc3QpIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB7IGNvbnN0IHQgPSB0aGlzLm1ha2VUaWxlKHRlYW0sIGMpOyBpZiAodGVhbSA9PT0gMCkgdGhpcy50aWxlcy5wdXNoKHQpOyBlbHNlIHQuc2V0RW5hYmxlZChmYWxzZSk7IH1cblxuICAgIHRoaXMuQSA9IGF3YWl0IGxvYWRBc3NldHMoc2NlbmUpO1xuICAgIHRoaXMubmVjcm8gPSBuZXcgTmVjcm9tYW5jZXIoc2NlbmUsIHRoaXMuQS5zb2Z0LCB0aGlzLkEubmVjcm8pOyAgICAgICAvLyBzdGFuZHMganVzdCBiZWhpbmQgaGlzIGFybXkncyBiYWNrIGNvbHVtbiwgZmFjaW5nIHRoZSBiYXR0bGVmaWVsZFxuICAgIHRoaXMubmVjcm8uaG9sZGVyLnBvc2l0aW9uLnNldCgtKEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAtIDEuMDUsIDAsIDApOyB0aGlzLm5lY3JvLmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7XG4gICAgdGhpcy5hcnJvd01hdHMgPSBbMCwgMV0ubWFwKCh0KSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdhbScgKyB0LCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjMsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNywgMC4yNSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcmV0dXJuIG07IH0pO1xuICAgIHRoaXMudWkgPSBuZXcgVWkodGhpcyk7IHRoaXMuc2VlZCA9ICsocXMuZ2V0KCdzZWVkJykgfHwgMSk7IGlmIChxcy5nZXQoJ2ZwcycpKSB0aGlzLnNldFNob3dGcHModHJ1ZSk7XG5cbiAgICAvLyBUYXBzIGFyZSBkZXRlY3RlZCBoZXJlIChub3QgdGhyb3VnaCBCYWJ5bG9uKSBzbyB0aGV5IGJlaGF2ZSB0aGUgc2FtZSBpbiBTYWZhcmksIHRoZSBob21lLXNjcmVlbiBhcHAgYW5kIG9uIGRlc2t0b3AuXG4gICAgbGV0IGRvd246IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbG9jYWwgPSAoZTogUG9pbnRlckV2ZW50KSA9PiB7IGNvbnN0IHIgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7IHJldHVybiB7IHg6IGUuY2xpZW50WCAtIHIubGVmdCwgeTogZS5jbGllbnRZIC0gci50b3AgfTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmRvd24nLCAoZSkgPT4geyBkb3duID0geyAuLi5sb2NhbChlKSwgdDogcGVyZm9ybWFuY2Uubm93KCkgfTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJ1cCcsIChlKSA9PiB7IGlmICghZG93bikgcmV0dXJuOyBjb25zdCBwID0gbG9jYWwoZSk7IGNvbnN0IG1vdmVkID0gTWF0aC5oeXBvdChwLnggLSBkb3duLngsIHAueSAtIGRvd24ueSksIGR0ID0gcGVyZm9ybWFuY2Uubm93KCkgLSBkb3duLnQ7IGRvd24gPSBudWxsOyBpZiAobW92ZWQgPCAxNiAmJiBkdCA8IDkwMCkgdGhpcy50YXAocC54LCBwLnkpOyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmNhbmNlbCcsICgpID0+IHsgZG93biA9IG51bGw7IH0pO1xuICAgIHRoaXMuY2FudmFzID0gY2FudmFzOyBjb25zdCBvblJlc2l6ZSA9ICgpID0+IHRoaXMuaGFuZGxlUmVzaXplKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTsgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ29yaWVudGF0aW9uY2hhbmdlJywgKCkgPT4gc2V0VGltZW91dChvblJlc2l6ZSwgMjUwKSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydCkgKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKSBuZXcgKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKG9uUmVzaXplKS5vYnNlcnZlKGNhbnZhcyk7XG4gICAgaWYgKHFzLmdldCgnZ2FsbGVyeScpKSB7IHRoaXMuZ2FsbGVyeSgpOyByZXR1cm47IH1cbiAgICBjb25zdCBzYXZlZCA9IHFzLmdldCgnc2VlZCcpID8gbnVsbCA6IGxvYWRSdW4oKTsgICAgICAgICAgICAgICAgLy8gP3NlZWQ9TiBhbHdheXMgc3RhcnRzIGZyZXNoIChkZWJ1Z2dpbmcpOyBvdGhlcndpc2UgcGljayB1cCB3aGVyZSB0aGUgbGFzdCB2aXNpdCBsZWZ0IG9mZlxuICAgIGlmIChzYXZlZCkgdGhpcy5yZXN0b3JlKHNhdmVkKTsgZWxzZSB0aGlzLnN0YXJ0U3RhZ2UodGhpcy5zZWVkKTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKSwgcmF3ID0gbm93IC0gbGFzdDsgY29uc3QgZHQgPSBNYXRoLm1pbigwLjA1LCByYXcgLyAxMDAwKTsgbGFzdCA9IG5vdzsgaWYgKCF0aGlzLmFjdGl2ZSkgcmV0dXJuOyBpZiAoIXRoaXMuZnJvemVuKSB0aGlzLmZyYW1lKGR0KTsgc2NlbmUucmVuZGVyKCk7IHRoaXMucGVyZlRpY2socmF3KTsgfSk7XG4gIH1cbiAgLyoqIFRoZSBuYXZpZ2F0aW9uIHNoZWxsIGhpZGVzIHRoZSBiYXR0bGUgc2NyZWVuIHdoaWxlIGFub3RoZXIgdGFiIGlzIG9wZW46IHBhdXNlIHRoZSBnYW1lIHNvIGl0IGNvc3RzIG5vdGhpbmcuICovXG4gIHByaXZhdGUgYWN0aXZlID0gdHJ1ZTtcbiAgLyoqIERlYnVnOiBrZWVwIGRyYXdpbmcgYnV0IHN0b3AgYWR2YW5jaW5nIHRpbWUsIHNvIGEgbW9tZW50IGNhbiBiZSBzdGVwcGVkIHRocm91Z2ggd2l0aCBmcmFtZShkdCkgYW5kIHNjcmVlbnNob3R0ZWQuICovXG4gIGZyb3plbiA9IGZhbHNlO1xuICBzdGVwKGR0OiBudW1iZXIpIHsgdGhpcy5mcmFtZShkdCk7IH1cbiAgc2V0QWN0aXZlKG9uOiBib29sZWFuKSB7IHRoaXMuYWN0aXZlID0gb247IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzY2VuZSBoZWxwZXJzXG4gIC8qKiBUaGUgcGxhY2VtZW50IGdyaWQgaXMgYSBidWlsZC1zY3JlZW4gdG9vbDogaGlkZSBpdCBkdXJpbmcgdGhlIGZpZ2h0IHNvIHRoZSBiYXR0bGUgbG9va3MgbGlrZSBhIHNjZW5lLCBub3QgYSBib2FyZC4gKi9cbiAgcHJpdmF0ZSBzaG93R3JpZChvbjogYm9vbGVhbikgeyBmb3IgKGNvbnN0IHQgb2YgdGhpcy50aWxlcykgdC5zZXRFbmFibGVkKG9uKTsgfVxuICBwcml2YXRlIG1ha2VUaWxlKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKSwgdCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3RpbGUnICsgY2VsbCwgeyBzaXplOiBHUklEX1NQICogMC45MiB9LCB0aGlzLnNjZW5lKTtcbiAgICB0LnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdC5wb3NpdGlvbi5zZXQocC54LCAwLjAxNSwgcC56KTtcbiAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndG0nLCB0aGlzLnNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuMTgsIDAuMTIsIDAuNDIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNDIsIDAuMTIsIDAuMTIpOyBtLmFscGhhID0gMC41OyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHQubWF0ZXJpYWwgPSBtO1xuICAgIGlmICh0ZWFtID09PSAwKSB7IHQubWV0YWRhdGEgPSB7IGtpbmQ6ICd0aWxlJywgY2VsbCB9OyB0aGlzLnRpbGVNYXRzW2NlbGxdID0gbTsgfSBlbHNlIHQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHJldHVybiB0O1xuICB9XG4gIHByaXZhdGUgdGludChjZWxsOiBudW1iZXIsIG1vZGU6ICdub3JtYWwnIHwgJ2ZyZWUnIHwgJ3NlbCcgfCAncGFydG5lcicpIHtcbiAgICBjb25zdCBtID0gdGhpcy50aWxlTWF0c1tjZWxsXTsgY29uc3QgYyA9IHsgbm9ybWFsOiBbMC4xOCwgMC4xMiwgMC40MiwgMC41XSwgZnJlZTogWzAuMiwgMC43NSwgMC41NSwgMC43XSwgc2VsOiBbMSwgMC44MiwgMC4zLCAwLjg1XSwgcGFydG5lcjogWzAuODUsIDAuMzUsIDEsIDAuODVdIH1bbW9kZV07XG4gICAgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pOyBtLmFscGhhID0gY1szXTtcbiAgfVxuICBsYXRlcihzZWM6IG51bWJlciwgZm46ICgpID0+IHZvaWQpIHsgdGhpcy50aW1lcnMucHVzaCh7IHQ6IHNlYywgZm4gfSk7IH1cbiAgcHJpdmF0ZSBmeFJpbmcoeDogbnVtYmVyLCB6OiBudW1iZXIsIGNvbG9yOiBhbnksIHIwOiBudW1iZXIsIHIxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2Z4JywgeyBkaWFtZXRlcjogMSwgdGhpY2tuZXNzOiAwLjAzNSwgdGVzc2VsbGF0aW9uOiAyOCB9LCB0aGlzLnNjZW5lKTsgbS5wb3NpdGlvbi5zZXQoeCwgMC4wNSwgeik7IG0uaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG1tID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZnhtJywgdGhpcy5zY2VuZSk7IG1tLmVtaXNzaXZlQ29sb3IgPSBjb2xvcjsgbW0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbW0uYWxwaGEgPSAwLjk7IG0ubWF0ZXJpYWwgPSBtbTsgdGhpcy5yaW5nRngucHVzaCh7IG0sIG1tLCB0OiAwLCByMCwgcjEsIGR1ciB9KTtcbiAgfVxuICBwcml2YXRlIGJ1cnN0KHg6IG51bWJlciwgejogbnVtYmVyLCBjMTogbnVtYmVyW10sIGMyOiBudW1iZXJbXSwgY291bnQ6IG51bWJlcikge1xuICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2InLCA2MCwgdGhpcy5zY2VuZSk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCAwLjA1LCB6KTsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMC4wNSwgMC4yKTtcbiAgICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMxIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzIgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMSwgMCwgMC4yLCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4xMjsgcHMubWF4U2l6ZSA9IDAuMzQ7IHBzLm1pbkxpZmVUaW1lID0gMC40OyBwcy5tYXhMaWZlVGltZSA9IDAuOTsgcHMuZW1pdFJhdGUgPSAwOyBwcy5tYW51YWxFbWl0Q291bnQgPSBjb3VudDsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEsIDEuMywgLTEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygxLCAyLjQsIDEpO1xuICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuODsgcHMubWF4RW1pdFBvd2VyID0gMjsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgLTIsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnRhcmdldFN0b3BEdXJhdGlvbiA9IDEuMjsgcHMuZGlzcG9zZU9uU3RvcCA9IHRydWU7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBjYW1lcmFcbiAgcHJpdmF0ZSBwb3NlcygpIHtcbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCBoYWxmID0gRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1AgKyAxLjQ7XG4gICAgY29uc3QgZCA9IE1hdGgubWF4KGhhbGYgLyAodGFuViAqIGFzcCksICgoR1JJRF9ST1dTICogR1JJRF9TUCkgLyAyICsgMikgLyAodGFuViAqIDAuNTUpLCA4KTtcbiAgICBjb25zdCBiYXR0bGUgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMygtMC4xICogZCwgMC40MiAqIGQgKyAwLjUsIC0wLjg2ICogZCksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjM1LCAwKSB9O1xuICAgIC8vIEJ1aWxkIHZpZXc6IChhbG1vc3QpIHN0cmFpZ2h0IGRvd24sIHdpdGggdGhlIHdob2xlIGdyaWQgaW5zaWRlIHRoZSBiYW5kIGJldHdlZW4gdGhlIHRvcCBiYXIgYW5kIHRoZSBoYW5kIG9mIGNhcmRzLlxuICAgIGNvbnN0IGN4ID0gLShGUk9OVF9YICsgKChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC8gMiksIEggPSBNYXRoLm1heCgxLCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpO1xuICAgIGNvbnN0IGJveCA9IChpZDogc3RyaW5nKSA9PiB7IGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOyByZXR1cm4gZWwgJiYgZWwub2Zmc2V0UGFyZW50ICE9PSBudWxsID8gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkgOiBudWxsOyB9O1xuICAgIGNvbnN0IHRvcEJhciA9IGJveCgndG9wJyksIGhhbmQgPSBib3goJ2hhbmQnKSwgaW5mbyA9IGJveCgnaW5mbycpO1xuICAgIGNvbnN0IFRPUCA9IE1hdGgubWluKDAuMzIsIHRvcEJhciA/ICh0b3BCYXIuYm90dG9tICsgNikgLyBIIDogMC4xKTtcbiAgICBjb25zdCBCT1RUT00gPSBNYXRoLm1pbigwLjUsIChIIC0gTWF0aC5taW4oaGFuZCA/IGhhbmQudG9wIDogSCwgaW5mbyA/IGluZm8udG9wIDogSCkgKyA2KSAvIEgpO1xuICAgIGNvbnN0IGJhbmQgPSBNYXRoLm1heCgwLjMsIDEgLSBUT1AgLSBCT1RUT00pLCBjZW50ZXJGcmFjID0gVE9QICsgYmFuZCAvIDI7ICAgICAgICAgIC8vIHRoZSBncmlkJ3MgY2VudHJlIGFwcGVhcnMgYXQgdGhpcyBmcmFjdGlvbiBmcm9tIHRoZSB0b3BcbiAgICBjb25zdCBndyA9IEdSSURfQ09MUyAqIEdSSURfU1AgKyAzLjIsIGdoID0gR1JJRF9ST1dTICogR1JJRF9TUCArIDAuNTsgICAgICAgICAgICAgICAgLy8gdGhlIHdpZHRoIGFsc28gbGVhdmVzIHJvb20gZm9yIHRoZSBOZWNyb21hbmNlciBiZXNpZGUgdGhlIGdyaWRcbiAgICBjb25zdCBkMiA9IE1hdGgubWF4KGdoIC8gKDIgKiB0YW5WICogYmFuZCksIGd3IC8gKDIgKiB0YW5WICogYXNwICogMC44OCksIDQuNSk7XG4gICAgY29uc3Qgc2hpZnQgPSAoMC41IC0gY2VudGVyRnJhYykgKiAyICogZDIgKiB0YW5WLCBieCA9IGN4IC0gMC42O1xuICAgIGNvbnN0IGJ1aWxkID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIGQyLCAtc2hpZnQgLSAwLjEgKiBkMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMyhieCwgMCwgLXNoaWZ0KSB9O1xuICAgIGNvbnN0IG5lY3JvID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYmF0dGxlLnBvcy54IC0gMS40LCBiYXR0bGUucG9zLnkgKiAxLjEyLCBiYXR0bGUucG9zLnogKiAxLjEyKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLjQsIDAuMzUsIDApIH07ICAgLy8gcmVzdWx0IGN1dHNjZW5lczogaGltIGFuZCB0aGUgZmllbGRcbiAgICByZXR1cm4geyBiYXR0bGUsIGJ1aWxkLCBuZWNybyB9O1xuICB9XG4gIC8qKiBUaGUgaGFuZCAvIGluZm8gYmFyIGNhbiBjaGFuZ2Ugc2l6ZSBpbiB0aGUgYnVpbGQgcGhhc2UgKGxvbmcgYWJpbGl0eSB0ZXh0LCBtb3JlIGNhcmRzKTogcmUtZnJhbWUgc28gdGhlIGdyaWQgbmV2ZXIgaGlkZXMgYmVoaW5kIGl0LiAqL1xuICByZWZyYW1lQnVpbGQoKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgdGhpcy5jYW1UIDwgMSB8fCB0aGlzLmNpbmUgfHwgIXRoaXMuY2FudmFzKSByZXR1cm47XG4gICAgY29uc3QgcCA9IHRoaXMucG9zZXMoKS5idWlsZCwgYyA9IHRoaXMuY2FtZXJhLnBvc2l0aW9uO1xuICAgIGlmICghaXNGaW5pdGUocC5wb3MueCkgfHwgQkFCWUxPTi5WZWN0b3IzLkRpc3RhbmNlKGMsIHAucG9zKSA8IDAuMDYpIHJldHVybjtcbiAgICB0aGlzLnR3ZWVuQ2FtKHAsIDAuMzUpO1xuICB9XG4gIHByaXZhdGUgY2FudmFzITogSFRNTENhbnZhc0VsZW1lbnQ7IHByaXZhdGUgbGFzdFcgPSAwOyBwcml2YXRlIGxhc3RIID0gMDsgbGFzdFRhcEluZm8gPSAnKG5vIHRhcHMgeWV0KSc7XG4gIHByaXZhdGUgaGFuZGxlUmVzaXplKCkge1xuICAgIGlmICghdGhpcy5jYW52YXMuY2xpZW50V2lkdGggfHwgIXRoaXMuY2FudmFzLmNsaWVudEhlaWdodCkgcmV0dXJuOyAgIC8vIGhpZGRlbiBiZWhpbmQgYW5vdGhlciB0YWJcbiAgICB0aGlzLmVuZ2luZS5yZXNpemUoKTsgdGhpcy5sYXN0VyA9IHRoaXMuY2FudmFzLmNsaWVudFdpZHRoOyB0aGlzLmxhc3RIID0gdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnICYmIHRoaXMuY2FtVCA+PSAxKSB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpO1xuICB9XG4gIC8qKiBBIHRhcCBvbiB0aGUgM0QgdmlldzogcGljayBhIHRpbGUgb3IgYSB1bml0LiAqL1xuICBwcml2YXRlIHRhcCh4OiBudW1iZXIsIHk6IG51bWJlcikge1xuICAgIGNvbnN0IHAgPSB0aGlzLnNjZW5lLnBpY2soeCwgeSwgKG06IGFueSkgPT4gISEobS5tZXRhZGF0YSAmJiBtLm1ldGFkYXRhLmtpbmQpKTtcbiAgICBjb25zdCBtZCA9IHAgJiYgcC5oaXQgPyBwLnBpY2tlZE1lc2gubWV0YWRhdGEgOiBudWxsO1xuICAgIHRoaXMubGFzdFRhcEluZm8gPSBgdGFwICR7TWF0aC5yb3VuZCh4KX0sJHtNYXRoLnJvdW5kKHkpfSBvZiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gLT4gJHttZCA/IChtZC5raW5kID09PSAndGlsZScgPyAndGlsZSAnICsgbWQuY2VsbCA6ICd1bml0JykgOiAnbm90aGluZyd9IChwaGFzZSAke3RoaXMucGhhc2V9KWA7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgIW1kKSByZXR1cm47XG4gICAgaWYgKG1kLmtpbmQgPT09ICd0aWxlJykgdGhpcy5vblRpbGUobWQuY2VsbCk7IGVsc2UgaWYgKG1kLmtpbmQgPT09ICd1bml0JykgdGhpcy5vblVuaXRWaXN1YWwobWQudmlzdWFsKTtcbiAgfVxuICBwcml2YXRlIHNldENhbShwOiBhbnkpIHsgdGhpcy5jYW1lcmEucG9zaXRpb24uY29weUZyb20ocC5wb3MpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQocC50Z3QuY2xvbmUoKSk7IH1cbiAgcHJpdmF0ZSB0d2VlbkNhbSh0bzogYW55LCBkdXI6IG51bWJlcikgeyB0aGlzLmNhbUZyb20gPSB7IHBvczogdGhpcy5jYW1lcmEucG9zaXRpb24uY2xvbmUoKSwgdGd0OiB0aGlzLmNhbWVyYS5nZXRUYXJnZXQoKS5jbG9uZSgpIH07IHRoaXMuY2FtVG8gPSB0bzsgdGhpcy5jYW1UID0gMDsgdGhpcy5jYW1EdXIgPSBkdXI7IH1cblxuICAvLyAtLS0tIGJhdHRsZSBjYW1lcmE6IGZvbGxvd3MgdGhlIGZpZ2h0ZXJzIHRoYXQgYXJlIHN0aWxsIGFsaXZlLCBzbyB0aGUgYWN0aW9uIChhbmQgdGhlIHB1cnBsZSBleWVzKSBzdGF5cyBsYXJnZSBvbiBzY3JlZW5cbiAgY2FtTW9kZTogJ2Nsb3NlJyB8ICd3aWRlJyA9ICdjbG9zZSc7IHByaXZhdGUgY2FtVGd0OiBhbnkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgMCk7XG4gIHNldENhbU1vZGUobTogJ2Nsb3NlJyB8ICd3aWRlJykge1xuICAgIHRoaXMuY2FtTW9kZSA9IG07XG4gICAgaWYgKG0gPT09ICd3aWRlJyAmJiB0aGlzLmJhdHRsZSkgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAwLjkpO1xuICAgIHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcHJpdmF0ZSBmcmFtZUJhdHRsZShkdDogbnVtYmVyKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlOyBpZiAoIWIpIHJldHVybjsgY29uc3QgYWxpdmUgPSBiLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSk7IGlmICghYWxpdmUubGVuZ3RoKSByZXR1cm47XG4gICAgbGV0IHgwID0gMWU5LCB4MSA9IC0xZTksIHowID0gMWU5LCB6MSA9IC0xZTk7IGZvciAoY29uc3QgZiBvZiBhbGl2ZSkgeyB4MCA9IE1hdGgubWluKHgwLCBmLngpOyB4MSA9IE1hdGgubWF4KHgxLCBmLngpOyB6MCA9IE1hdGgubWluKHowLCBmLnopOyB6MSA9IE1hdGgubWF4KHoxLCBmLnopOyB9XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3Qgd2lkZSA9IHRoaXMucG9zZXMoKS5iYXR0bGUsIGN4ID0gKHgwICsgeDEpIC8gMiwgY3ogPSAoejAgKyB6MSkgLyAyO1xuICAgIGNvbnN0IGQgPSBNYXRoLm1pbihNYXRoLm1heCgoeDEgLSB4MCArIDMuNCkgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjkpLCAoejEgLSB6MCArIDMuMikgLyAoMiAqIHRhblYgKiAwLjYyKSwgNS40KSwgTWF0aC5oeXBvdCh3aWRlLnBvcy55LCB3aWRlLnBvcy56KSk7XG4gICAgY29uc3QgdGd0ID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCwgMC41NSwgY3opLCBwb3MgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4IC0gMC4wNiAqIGQsIDAuMzIgKiBkICsgMC41LCBjeiAtIDAuOSAqIGQpO1xuICAgIGNvbnN0IGsgPSAxIC0gTWF0aC5leHAoLWR0ICogMi4wKTtcbiAgICB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtZXJhLnBvc2l0aW9uLCBwb3MsIGspOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtVGd0LCB0Z3QsIGspOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFnZSBmbG93XG4gIC8qKiBXcml0ZSB0aGUgcnVuIHRvIGRpc2sgKGNhbG0gbW9tZW50cyBvbmx5OiBidWlsZCBwaGFzZSBhbmQgdGhlIHZpY3RvcnkgZHJhZnQpLiAqL1xuICBwcml2YXRlIHBlcnNpc3RSdW4oKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHMgPSB0aGlzLnM7IGlmICghcykgcmV0dXJuO1xuICAgICAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSB7IGNsZWFyUnVuKCk7IHJldHVybjsgfVxuICAgICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgJiYgdGhpcy5waGFzZSAhPT0gJ2RyYWZ0JykgcmV0dXJuO1xuICAgICAgY29uc3Qgc25hcDogUnVuU25hcHNob3QgPSB7IHY6IDEsIHNlZWQ6IHRoaXMuc2VlZCwgYXR0ZW1wdDogdGhpcy5hdHRlbXB0LCBzdGFnZTogY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHk6IGRpZmZpY3VsdHlOYW1lLCBwaGFzZTogdGhpcy5waGFzZSwgZHJhZnQ6IHRoaXMucGhhc2UgPT09ICdkcmFmdCcgPyB0aGlzLmRyYWZ0IDogbnVsbCwgc3RhdGU6IHNlcmlhbGl6ZVN0YXRlKHMpLCBzdGFydEJlc3Q6IHRoaXMuZW5kbGVzcz8uc3RhcnRCZXN0IH07XG4gICAgICBzYXZlUnVuKHNuYXApO1xuICAgIH0gY2F0Y2ggeyAvKiBuZXZlciBsZXQgc2F2aW5nIGJyZWFrIHRoZSBnYW1lICovIH1cbiAgfVxuICAvKiogUmVidWlsZCB0aGUgc2NyZWVuIGZyb20gYSBzYXZlZCBydW4gKGEgcmVsb2FkLCBvciBTYWZhcmkgZGlzY2FyZGluZyB0aGUgcGFnZSkuICovXG4gIHByaXZhdGUgcmVzdG9yZShyOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSkge1xuICAgIGNvbnN0IHsgc25hcCwgc3RhdGUgfSA9IHI7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMuZmx1c2hUd2VlbnMoKTsgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICBpZiAoc25hcC5zdGFnZSA9PT0gRU5ETEVTU19JRCkgeyBzZXRFbmRsZXNzKCk7IGNvbnN0IGRvbmUgPSBNYXRoLm1heCgwLCBzdGF0ZS53YXZlIC0gMSk7IHRoaXMuZW5kbGVzcyA9IHsgc3RhcnRCZXN0OiBzbmFwLnN0YXJ0QmVzdCA/PyBsb2FkU2F2ZSgpLmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogZG9uZSwgcGFja3M6IE1hdGguZmxvb3IoZG9uZSAvIEVORExFU1NfUEFDS19FVkVSWSkgfTsgfSBlbHNlIHsgc2V0U3RhZ2VEaWZmaWN1bHR5KHNuYXAuc3RhZ2UsIHNuYXAuZGlmZmljdWx0eSk7IHRoaXMuZW5kbGVzcyA9IG51bGw7IH1cbiAgICB0aGlzLmFyZW5hLnNldFRoZW1lKGN1cnJlbnRTdGFnZUlkKTtcbiAgICB0aGlzLnNlZWQgPSBzbmFwLnNlZWQ7IHRoaXMuYXR0ZW1wdCA9IHNuYXAuYXR0ZW1wdDsgdGhpcy5zID0gc3RhdGU7IHRoaXMuc2Vlbk1lcmdlcyA9IHN0YXRlLnN0YXRzLm1lcmdlcztcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBzbmFwLnBoYXNlID09PSAnZHJhZnQnID8gc25hcC5kcmFmdCA6IG51bGw7IHRoaXMucGhhc2UgPSB0aGlzLmRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCc7IHRoaXMuc2hvd0dyaWQodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdChgUnVuIHJlc3RvcmVkOiB3YXZlICR7aXNFbmRsZXNzKCkgPyBzdGF0ZS53YXZlIDogc3RhdGUud2F2ZSArICcvJyArIHN0YWdlV2F2ZXMoc3RhdGUpfSwgJHtzdGF0ZS5oZWFydHN9IGhlYXJ0JHtzdGF0ZS5oZWFydHMgPT09IDEgPyAnJyA6ICdzJ30uYCk7XG4gIH1cblxuICAvLyAtLS0tIHBlcmZvcm1hbmNlIHJlYWRvdXQ6IHJvbGxpbmcgZnJhbWUgc3RhdHMsIHBlci1iYXR0bGUgc3VtbWFyaWVzLCBvcHRpb25hbCBvbi1zY3JlZW4gRlBTLCBhbmQgYSBwYXN0ZS1mcmllbmRseSByZXBvcnRcbiAgc2hvd0ZwcyA9IGZhbHNlOyBwZXJmTm93ID0geyBmcHM6IDAsIGF2ZzogMCwgcDk1OiAwLCB3b3JzdDogMCB9OyBwZXJmTG9nOiBhbnlbXSA9IFtdO1xuICBwcml2YXRlIHBlcmZCdWYgPSBuZXcgRmxvYXQzMkFycmF5KDI0MCk7IHByaXZhdGUgcGVyZk4gPSAwOyBwcml2YXRlIHBlcmZJID0gMDsgcHJpdmF0ZSBwZXJmU2hvd25BdCA9IDA7IHByaXZhdGUgaW5zdHI6IGFueSA9IG51bGw7IHByaXZhdGUgZnBzSHVkOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGN1ckJhdHRsZTogeyBmcmFtZXM6IG51bWJlcjsgc3VtOiBudW1iZXI7IHdvcnN0OiBudW1iZXI7IHNsb3c6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHNldFNob3dGcHMob246IGJvb2xlYW4pIHtcbiAgICB0aGlzLnNob3dGcHMgPSBvbjtcbiAgICBpZiAob24gJiYgIXRoaXMuZnBzSHVkKSB7IGNvbnN0IGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgaC5pZCA9ICdmcHNIdWQnOyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JhdHRsZUhvc3QnKSB8fCBkb2N1bWVudC5ib2R5KS5hcHBlbmRDaGlsZChoKTsgdGhpcy5mcHNIdWQgPSBoOyB9XG4gICAgaWYgKHRoaXMuZnBzSHVkKSB0aGlzLmZwc0h1ZC5zdHlsZS5kaXNwbGF5ID0gb24gPyAnYmxvY2snIDogJ25vbmUnO1xuICB9XG4gIHByaXZhdGUgcGVyZlRpY2sobXM6IG51bWJlcikge1xuICAgIGlmIChtcyA+IDUwMCkgcmV0dXJuOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgdGFiIHdhcyBoaWRkZW4gb3IgdGhlIHBob25lIHBhdXNlZCB1czogbm90IGEgcmVhbCBmcmFtZVxuICAgIHRoaXMucGVyZkJ1Zlt0aGlzLnBlcmZJXSA9IG1zOyB0aGlzLnBlcmZJID0gKHRoaXMucGVyZkkgKyAxKSAlIHRoaXMucGVyZkJ1Zi5sZW5ndGg7IHRoaXMucGVyZk4gPSBNYXRoLm1pbih0aGlzLnBlcmZCdWYubGVuZ3RoLCB0aGlzLnBlcmZOICsgMSk7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlO1xuICAgIGlmIChjICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCB0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpKSB7IGMuZnJhbWVzKys7IGMuc3VtICs9IG1zOyBpZiAobXMgPiBjLndvcnN0KSBjLndvcnN0ID0gbXM7IGlmIChtcyA+IDMzLjQpIGMuc2xvdysrOyBjLnNjYWxlID0gTWF0aC5tYXgoYy5zY2FsZSwgdGhpcy50aW1lU2NhbGUpOyB9XG4gICAgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCk7IGlmIChub3cgLSB0aGlzLnBlcmZTaG93bkF0IDwgNTAwKSByZXR1cm47IHRoaXMucGVyZlNob3duQXQgPSBub3c7XG4gICAgY29uc3QgYSA9IEFycmF5LmZyb20odGhpcy5wZXJmQnVmLnN1YmFycmF5KDAsIHRoaXMucGVyZk4pKS5zb3J0KCh4LCB5KSA9PiB4IC0geSksIGF2ZyA9IGEucmVkdWNlKChuLCB4KSA9PiBuICsgeCwgMCkgLyBhLmxlbmd0aDtcbiAgICB0aGlzLnBlcmZOb3cgPSB7IGZwczogMTAwMCAvIGF2ZywgYXZnLCBwOTU6IGFbTWF0aC5mbG9vcihhLmxlbmd0aCAqIDAuOTUpXSA/PyAwLCB3b3JzdDogYVthLmxlbmd0aCAtIDFdID8/IDAgfTtcbiAgICBpZiAodGhpcy5mcHNIdWQgJiYgdGhpcy5zaG93RnBzKSB0aGlzLmZwc0h1ZC50ZXh0Q29udGVudCA9IGAke3RoaXMucGVyZk5vdy5mcHMudG9GaXhlZCgwKX0gZnBzICAke3RoaXMucGVyZk5vdy5hdmcudG9GaXhlZCgxKX1tcyAgc2xvdzUlICR7dGhpcy5wZXJmTm93LnA5NS50b0ZpeGVkKDApfW1zYDtcbiAgICB0aGlzLnVpLnJlbmRlckRlYnVnTGl2ZSgpO1xuICB9XG4gIHByaXZhdGUgYmVnaW5CYXR0bGVQZXJmKCkgeyB0aGlzLmN1ckJhdHRsZSA9IHsgZnJhbWVzOiAwLCBzdW06IDAsIHdvcnN0OiAwLCBzbG93OiAwLCBzY2FsZTogdGhpcy50aW1lU2NhbGUgfTsgfVxuICBwcml2YXRlIGVuZEJhdHRsZVBlcmYoKSB7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlOyB0aGlzLmN1ckJhdHRsZSA9IG51bGw7IGlmICghYyB8fCAhYy5mcmFtZXMpIHJldHVybjtcbiAgICB0aGlzLnBlcmZMb2cucHVzaCh7IHdhdmU6IHRoaXMucy53YXZlLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIHNwZWVkOiBjLnNjYWxlLCBmaWdodGVyczogdGhpcy5iYXR0bGUgPyB0aGlzLmJhdHRsZS5maWdodGVycy5sZW5ndGggOiAwLCBmcHM6ICsoMTAwMCAvIChjLnN1bSAvIGMuZnJhbWVzKSkudG9GaXhlZCgwKSwgd29yc3RNczogK2Mud29yc3QudG9GaXhlZCgwKSwgc2xvd1BjdDogKygoMTAwICogYy5zbG93KSAvIGMuZnJhbWVzKS50b0ZpeGVkKDEpIH0pO1xuICAgIGlmICh0aGlzLnBlcmZMb2cubGVuZ3RoID4gMTIpIHRoaXMucGVyZkxvZy5zaGlmdCgpO1xuICB9XG4gIHBlcmZJbmZvKCkge1xuICAgIGNvbnN0IHNjID0gdGhpcy5zY2VuZTsgaWYgKCF0aGlzLmluc3RyICYmIEJBQllMT04uU2NlbmVJbnN0cnVtZW50YXRpb24pIHRoaXMuaW5zdHIgPSBuZXcgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbihzYyk7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5wZXJmTm93LCBtZXNoZXM6IHNjLmdldEFjdGl2ZU1lc2hlcygpLmxlbmd0aCwgcGFydGljbGVzOiBzYy5wYXJ0aWNsZVN5c3RlbXMubGVuZ3RoLCBkcmF3czogdGhpcy5pbnN0ciA/IHRoaXMuaW5zdHIuZHJhd0NhbGxzQ291bnRlci5jdXJyZW50IDogLTEgfTtcbiAgfVxuICBwZXJmUmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcCA9IHRoaXMucGVyZkluZm8oKSwgZ2w6IGFueSA9IHRoaXMuZW5naW5lLmdldEdsSW5mbyA/IHRoaXMuZW5naW5lLmdldEdsSW5mbygpIDoge307XG4gICAgY29uc3Qgcm93cyA9IHRoaXMucGVyZkxvZy5tYXAoKHIpID0+IGAgIHdhdmUgJHtyLndhdmV9IHRyeSAke3IuYXR0ZW1wdH0gYXQgJHtyLnNwZWVkfXg6ICR7ci5mcHN9IGZwcyBhdmVyYWdlLCB3b3JzdCBmcmFtZSAke3Iud29yc3RNc31tcywgJHtyLnNsb3dQY3R9JSBzbG93IGZyYW1lcywgJHtyLmZpZ2h0ZXJzfSBmaWdodGVyc2ApO1xuICAgIHJldHVybiBbYFBFUkYgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9YCwgYGRldmljZTogJHtuYXZpZ2F0b3IudXNlckFnZW50fWAsIGBncHU6ICR7Z2wucmVuZGVyZXIgfHwgJz8nfSAoJHtnbC52ZW5kb3IgfHwgJz8nfSlgLFxuICAgICAgYHNjcmVlbiAke3NjcmVlbi53aWR0aH14JHtzY3JlZW4uaGVpZ2h0fSAgdmlld3BvcnQgJHtpbm5lcldpZHRofXgke2lubmVySGVpZ2h0fSAgZHByICR7ZGV2aWNlUGl4ZWxSYXRpb30gIHJlbmRlciAke3RoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCl9eCR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCl9ICBzY2FsaW5nIGxldmVsICR7dGhpcy5lbmdpbmUuZ2V0SGFyZHdhcmVTY2FsaW5nTGV2ZWwoKS50b0ZpeGVkKDIpfWAsXG4gICAgICBgbm93OiAke3AuZnBzLnRvRml4ZWQoMCl9IGZwcywgYXZlcmFnZSAke3AuYXZnLnRvRml4ZWQoMSl9bXMsIHNsb3dlc3QgNSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zLCB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyB8IGFjdGl2ZSBtZXNoZXMgJHtwLm1lc2hlc30sIHBhcnRpY2xlIHN5c3RlbXMgJHtwLnBhcnRpY2xlc30sIGRyYXcgY2FsbHMgJHtwLmRyYXdzfWAsXG4gICAgICBgc3RhdGU6IHBoYXNlICR7dGhpcy5waGFzZX0sIHNwZWVkICR7dGhpcy50aW1lU2NhbGV9eCwgY2FtZXJhICR7dGhpcy5jYW1Nb2RlfSwgZGlmZmljdWx0eSAke2RpZmZpY3VsdHlOYW1lfSwgd2F2ZSAke3RoaXMucy53YXZlfSwgdW5pdHMgJHt0aGlzLnMudW5pdHMubGVuZ3RofWAsXG4gICAgICBgYmF0dGxlcyAobmV3ZXN0IGxhc3QpOmAsIC4uLihyb3dzLmxlbmd0aCA/IHJvd3MgOiBbJyAgKG5vbmUgeWV0OiBwbGF5IGEgYmF0dGxlLCB0aGVuIGNvcHkgdGhpcyBhZ2FpbiknXSldLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgLyoqIEEgcnVuIHRoZSBwbGF5ZXIgaGFzIHJlYWxseSBzdGFydGVkIChzbyBIb21lIGNhbiBvZmZlciBDb250aW51ZSkuIE51bGwgYWZ0ZXIgYSBzdGFnZSB3YXMgd29uIG9yIGxvc3QsIG9yIGJlZm9yZSBhbnl0aGluZyB3YXMgZG9uZS4gKi9cbiAgcnVuSW5mbygpIHsgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzIHx8IHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gbnVsbDsgcmV0dXJuIChzLndhdmUgPiAxIHx8IHMudW5pdHMubGVuZ3RoID4gMCB8fCB0aGlzLmF0dGVtcHQgPiAwIHx8IHMuc3RhdHMuZmFpbHVyZXMgPiAwKSA/IHsgd2F2ZTogcy53YXZlLCB0b3RhbDogc3RhZ2VXYXZlcyhzKSwgaGVhcnRzOiBzLmhlYXJ0cywgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUsIHN0YWdlOiBjdXJyZW50U3RhZ2VJZCB9IDogbnVsbDsgfVxuICAvKiogRnJlc2ggcnVuIHdpdGggdGhlIGN1cnJlbnRseSBlcXVpcHBlZCBTb3VsIERlY2sgKEhvbWUgPiBTdGFydCBCYXR0bGUgY2FsbHMgdGhpcykuICovXG4gIG5ld1J1bigpIHsgdGhpcy5zdGFydFN0YWdlKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydFN0YWdlKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgdGhpcy5lbmRsZXNzID0gbnVsbDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpLCBwbCA9IHBsYXlhYmxlKHN2KTsgc2V0U3RhZ2VEaWZmaWN1bHR5KHBsLnN0YWdlLCBwbC5kaWZmaWN1bHR5KTsgdGhpcy5hcmVuYS5zZXRUaGVtZShjdXJyZW50U3RhZ2VJZCk7IHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uUFJPVE9UWVBFX1JVTEVTLCBwb29sOiBzdi5kZWNrIH0sIHNlZWQpOyB0aGlzLnNlZW5NZXJnZXMgPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgdGhpcy5zaG93R3JpZCh0cnVlKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTsgICAvLyAoYSBiYXR0bGUgbGVmdCBoYWxmLXdheSBoYWQgaGlkZGVuIHRoZSBncmlkKVxuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdCgnU3RhZ2Ugc3RhcnQ6IDQgY2FyZHMsICcgKyB0aGlzLnMuY2FwICsgJyBEb21pbmlvbi4gU3VtbW9uLCBtZXJnZSwgdGhlbiBwcmVzcyBCQVRUTEUuJyk7XG4gIH1cbiAgLyoqIEZyZXNoIEVuZGxlc3MgRGVwdGhzIHJ1biAoSG9tZSA+IEVuZGxlc3MgRGVwdGhzIGNhbGxzIHRoaXMpOiBzYW1lIHJ1bGVzIGFzIGEgc3RhZ2UsIGJ1dCB0aGUgd2F2ZXMgbmV2ZXIgc3RvcCBhbmQgdGhlIGVuZW15IGtlZXBzIGdyb3dpbmcuICovXG4gIG5ld0VuZGxlc3MoKSB7IHRoaXMuc3RhcnRFbmRsZXNzKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydEVuZGxlc3Moc2VlZDogbnVtYmVyKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucmV3YXJkID0gbnVsbDsgdGhpcy5mbHVzaFR3ZWVucygpOyBpZiAodGhpcy5uZWNybykgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICB0aGlzLnNlZWQgPSBzZWVkOyB0aGlzLmF0dGVtcHQgPSAwOyBjb25zdCBzdiA9IGxvYWRTYXZlKCk7IHNldEVuZGxlc3MoKTsgdGhpcy5hcmVuYS5zZXRUaGVtZShFTkRMRVNTX0lEKTtcbiAgICB0aGlzLmVuZGxlc3MgPSB7IHN0YXJ0QmVzdDogc3YuZW5kbGVzcy5iZXN0LCBjbGVhcmVkOiAwLCBwYWNrczogMCB9O1xuICAgIHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uRU5ETEVTU19SVUxFUywgcG9vbDogc3YuZGVjayB9LCBzZWVkKTsgdGhpcy5zZWVuTWVyZ2VzID0gMDtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7ICAgLy8gKGEgYmF0dGxlIGxlZnQgaGFsZi13YXkgaGFkIGhpZGRlbiB0aGUgZ3JpZClcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IG51bGw7IHRoaXMucGhhc2UgPSAnYnVpbGQnO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7IHRoaXMudG9hc3QoJ0VuZGxlc3MgRGVwdGhzOiBob3cgZGVlcCBjYW4geW91IGdvPyBBIFNvdWwgUGFjayBldmVyeSAxMCB3YXZlcy4nKTtcbiAgfVxuICBwcml2YXRlIGNsZWFyQmF0dGxlKCkge1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi5kaXNwb3NlKCk7IH0pOyB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpOyB0aGlzLmJhdHRsZSA9IG51bGw7XG4gICAgdGhpcy5hcnJvd3MuZm9yRWFjaCgoYSkgPT4gYS5tZXNoLmRpc3Bvc2UoKSk7IHRoaXMuYXJyb3dzID0gW107XG4gIH1cbiAgcHJpdmF0ZSBwb3MoY2VsbDogbnVtYmVyKSB7IHJldHVybiBjZWxsUG9zKDAsIGNlbGwpOyB9XG4gIC8qKiBGb3IgdGhlIHR1dG9yaWFsIHNwb3RsaWdodDogd2hlcmUgYW4gZW1wdHkgdGlsZSAodGhlIG9uZSBuZWFyZXN0IHRoZSBtaWRkbGUgb2YgdGhlIGdyaWQpIGlzIG9uIHRoZSBzY3JlZW4sIGluIENTUyBwaXhlbHMsIG9yIG51bGwuICovXG4gIGVtcHR5VGlsZVJlY3QoKTogeyB4OiBudW1iZXI7IHk6IG51bWJlcjsgdzogbnVtYmVyOyBoOiBudW1iZXIgfSB8IG51bGwge1xuICAgIGlmICghdGhpcy5zIHx8ICF0aGlzLmNhbnZhcyB8fCB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCB1c2VkID0gbmV3IFNldCh0aGlzLnMudW5pdHMubWFwKCh1OiBhbnkpID0+IHUuY2VsbCkpOyBsZXQgbXggPSAwLCBteiA9IDA7IGNvbnN0IGFsbCA9IEFycmF5LmZyb20oeyBsZW5ndGg6IEdSSURfQ0VMTFMgfSwgKF8sIGMpID0+IHRoaXMucG9zKGMpKTsgYWxsLmZvckVhY2goKHApID0+IHsgbXggKz0gcC54IC8gR1JJRF9DRUxMUzsgbXogKz0gcC56IC8gR1JJRF9DRUxMUzsgfSk7XG4gICAgbGV0IGJlc3QgPSAtMSwgYmQgPSAxZTk7IGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB7IGlmICh1c2VkLmhhcyhjKSkgY29udGludWU7IGNvbnN0IGQgPSBNYXRoLmh5cG90KGFsbFtjXS54IC0gbXgsIGFsbFtjXS56IC0gbXopOyBpZiAoZCA8IGJkKSB7IGJkID0gZDsgYmVzdCA9IGM7IH0gfVxuICAgIGlmIChiZXN0IDwgMCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcCA9IGFsbFtiZXN0XSwgaCA9IEdSSURfU1AgKiAwLjQ2LCBXID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSwgSCA9IHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB2cCA9IHRoaXMuY2FtZXJhLnZpZXdwb3J0LnRvR2xvYmFsKFcsIEgpLCBtID0gdGhpcy5zY2VuZS5nZXRUcmFuc2Zvcm1NYXRyaXgoKTtcbiAgICBjb25zdCBwdHMgPSBbWy1oLCAtaF0sIFtoLCAtaF0sIFtoLCBoXSwgWy1oLCBoXV0ubWFwKChbZHgsIGR6XSkgPT4gQkFCWUxPTi5WZWN0b3IzLlByb2plY3QobmV3IEJBQllMT04uVmVjdG9yMyhwLnggKyBkeCwgMC4wMiwgcC56ICsgZHopLCBCQUJZTE9OLk1hdHJpeC5JZGVudGl0eSgpLCBtLCB2cCkpO1xuICAgIGNvbnN0IHIgPSB0aGlzLmNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKSwga3ggPSByLndpZHRoIC8gVywga3kgPSByLmhlaWdodCAvIEgsIHhzID0gcHRzLm1hcCgocTogYW55KSA9PiBxLngpLCB5cyA9IHB0cy5tYXAoKHE6IGFueSkgPT4gcS55KTtcbiAgICBjb25zdCB4MCA9IE1hdGgubWluKC4uLnhzKSwgeDEgPSBNYXRoLm1heCguLi54cyksIHkwID0gTWF0aC5taW4oLi4ueXMpLCB5MSA9IE1hdGgubWF4KC4uLnlzKTtcbiAgICBpZiAoIWlzRmluaXRlKHgwICsgeDEgKyB5MCArIHkxKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHsgeDogci5sZWZ0ICsgeDAgKiBreCwgeTogci50b3AgKyB5MCAqIGt5LCB3OiAoeDEgLSB4MCkgKiBreCwgaDogKHkxIC0geTApICoga3kgfTtcbiAgfVxuICBzeW5jQnVpbGQoKSB7XG4gICAgdGhpcy5wZXJzaXN0UnVuKCk7XG4gICAgY29uc3QgbWVyZ2VkID0gdGhpcy5zLnN0YXRzLm1lcmdlcyA+IHRoaXMuc2Vlbk1lcmdlczsgdGhpcy5zZWVuTWVyZ2VzID0gdGhpcy5zLnN0YXRzLm1lcmdlcztcbiAgICBjb25zdCBncm93biA9IG1lcmdlZCA/IHRoaXMucy51bml0cy5maW5kKCh1KSA9PiB7IGNvbnN0IGd2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgcmV0dXJuICEhZ3YgJiYgZ3Yuc3RhciAhPT0gdS5zdGFyOyB9KSA6IHVuZGVmaW5lZDsgICAvLyB0aGUgdW5pdCB0aGF0IGp1c3QgZ2FpbmVkIGEgc3RhclxuICAgIGNvbnN0IGFsaXZlID0gbmV3IFNldCh0aGlzLnMudW5pdHMubWFwKCh1KSA9PiB1LmlkKSk7XG4gICAgZm9yIChjb25zdCBbaWQsIHZdIG9mIHRoaXMudW5pdFZpcykgaWYgKCFhbGl2ZS5oYXMoaWQpKSB7XG4gICAgICB0aGlzLnZpc1RvVW5pdC5kZWxldGUodik7IHRoaXMudW5pdFZpcy5kZWxldGUoaWQpOyBjb25zdCBwID0gdi5ob2xkZXIucG9zaXRpb247XG4gICAgICBpZiAoZ3Jvd24pIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBtZXJnZTogdGhlIGNvbnN1bWVkIHVuaXQgaXMgZHJhd24gaW50byB0aGUgc3Vydml2b3IgYW5kIHZhbmlzaGVzIGluIGEgZmxhc2hcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyhncm93bi5jZWxsKSwgeDAgPSBwLngsIHowID0gcC56LCBzYyA9IHYuaG9sZGVyLnNjYWxpbmcueDsgdi5wbGF5KCdpZGxlJyk7XG4gICAgICAgIHRoaXMudHdlZW4oMC4zMywgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjQsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwoc2MgKiAoMSAtIDAuNzUgKiB0KSk7IH0sXG4gICAgICAgICAgKCkgPT4geyB0aGlzLmJ1cnN0KHRvLngsIHRvLnosIFswLjg1LCAwLjYsIDEsIDAuOV0sIFswLjUsIDAuMywgMSwgMC43XSwgMTQpOyB2LmRpc3Bvc2UoKTsgfSk7XG4gICAgICB9IGVsc2UgeyB0aGlzLmJ1cnN0KHAueCwgcC56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDE2KTsgdi5kaXNwb3NlKCk7IH1cbiAgICB9XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykge1xuICAgICAgbGV0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTtcbiAgICAgIGlmICghdikgeyB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgdS5zb3VsLCAwLCB1LnN0YXIpOyB0aGlzLnVuaXRWaXMuc2V0KHUuaWQsIHYpOyB0aGlzLnZpc1RvVW5pdC5zZXQodiwgdS5pZCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTsgYXVkaW8ucGxheSgnc3VtbW9uJyk7IGNvbnN0IHZ2ID0gdjsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcpIHZ2LnBsYXkoJ2lkbGUnKTsgfSk7IH1cbiAgICAgIGVsc2UgeyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IGlmICh2LnN0YXIgIT09IHUuc3RhcikgeyBjb25zdCBmdiA9IHY7IHYuc2V0U3Rhcih1LnN0YXIpOyB0aGlzLmxhdGVyKGdyb3duICYmIGdyb3duLmlkID09PSB1LmlkID8gMC4zMyA6IDAsICgpID0+IHRoaXMubWVyZ2VGeChmdiwgcC54LCBwLnopKTsgfSB9XG4gICAgfVxuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsO1xuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB7XG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCBjYW5TdW1tb24odGhpcy5zLCBzZWwuaWR4KSA/ICdmcmVlJyA6ICdub3JtYWwnKTtcbiAgICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZUZyb21IYW5kKHRoaXMucywgc2VsLmlkeCwgdS5pZCkpIHRoaXMudGludCh1LmNlbGwsICdwYXJ0bmVyJyk7ICAgICAvLyB0aGUgY2FyZCBjYW4gbWVyZ2UgaW50byB0aGlzIHVuaXRcbiAgICB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7XG4gICAgICBjb25zdCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7XG4gICAgICBpZiAodSkgeyB0aGlzLnRpbnQodS5jZWxsLCAnc2VsJyk7IGZvciAoY29uc3QgbyBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZURlcGxveWVkKHUsIG8pKSB0aGlzLnRpbnQoby5jZWxsLCAncGFydG5lcicpOyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCAnZnJlZScpOyB9XG4gICAgfVxuICB9XG4gIC8qKiBUaGUgbWVyZ2UgbW9tZW50OiBhIGZsYXNoIG9mIHJpbmdzIGFuZCBzcGFya3MsIGEgcHVuY2ggaW4gc2l6ZSwgYSByaXNpbmcgY2hpbWUuICovXG4gIHByaXZhdGUgbWVyZ2VGeCh2OiBVbml0VmlzdWFsLCB4OiBudW1iZXIsIHo6IG51bWJlcikge1xuICAgIGF1ZGlvLnBsYXkoJ21lcmdlJyk7IHYucHVsc2UoKTsgY29uc3QgdGFyZ2V0ID0gdi5ob2xkZXIuc2NhbGluZy54O1xuICAgIHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjQpLCAwLjIsIDIuMCwgMC42NSk7IHRoaXMubGF0ZXIoMC4xMiwgKCkgPT4gdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDEsIDEpLCAwLjIsIDMuMCwgMC44KSk7XG4gICAgdGhpcy5idXJzdCh4LCB6LCBbMSwgMC44NSwgMC40LCAwLjldLCBbMC44LCAwLjQsIDEsIDAuOF0sIDQ2KTsgdGhpcy5idXJzdCh4LCB6LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDI0KTtcbiAgICB0aGlzLnR3ZWVuKDAuNTUsICh0KSA9PiB2LmhvbGRlci5zY2FsaW5nLnNldEFsbCh0YXJnZXQgKiAoMSArIDAuNDUgKiBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAoMSAtIHQgKiAwLjQpKSksICgpID0+IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRhcmdldCkpO1xuICB9XG4gIHByaXZhdGUgc3VtbW9uRngoeDogbnVtYmVyLCB6OiBudW1iZXIpIHsgdGhpcy5idXJzdCh4LCB6LCBbMC43LCAwLjMsIDEsIDAuOV0sIFswLjM1LCAwLjEsIDAuNywgMC44XSwgMzApOyB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjMsIDEpLCAwLjIsIDEuMiwgMC43KTsgfVxuXG4gIC8vIC0tLS0gcGxheWVyIGFjdGlvbnMgKGJ1aWxkIHBoYXNlKVxuICB0b2FzdChtc2c6IHN0cmluZykgeyB0aGlzLnVpLnRvYXN0KG1zZyk7IH1cbiAgb25DYXJkKGlkeDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoZGlzY2FyZFJlZHJhdyh0aGlzLnMsIGlkeCkpIHsgdGhpcy50b2FzdCgnU3dhcHBlZDogZHJldyBhIGRpZmZlcmVudCBTb3VsLicpOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnNlbC5pZHggPT09IGlkeCA/IG51bGwgOiB7IHR5cGU6ICdjYXJkJywgaWR4IH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25UaWxlKGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IGhlcmUgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7IGlmIChoZXJlKSB7IHRoaXMub25Vbml0VmlzdWFsKHRoaXMudW5pdFZpcy5nZXQoaGVyZS5pZCkhKTsgcmV0dXJuOyB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnKSB7XG4gICAgICBpZiAoY2FuU3VtbW9uKHMsIHNlbC5pZHgpKSB7IHN1bW1vbihzLCBzZWwuaWR4LCBjZWxsKTsgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgICBlbHNlIHsgY29uc3Qgc291bCA9IHMuaGFuZFtzZWwuaWR4XTsgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbjogJHtTT1VMX05BTUVbc291bF19IGNvc3RzICR7Y29zdChzb3VsLCAxKX0sIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApOyB9XG4gICAgfSBlbHNlIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0JykgeyBpZiAobW92ZVVuaXQocywgc2VsLmlkLCBjZWxsKSkgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25Vbml0VmlzdWFsKHY6IFVuaXRWaXN1YWwpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMudmlzVG9Vbml0LmdldCh2KTsgaWYgKGlkID09PSB1bmRlZmluZWQgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKSE7XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKHN3YXBTZWxsKHMsIGlkKSkgeyB0aGlzLnRvYXN0KGBTb2xkICR7U09VTF9OQU1FW3Uuc291bF19OiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuYCk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QodS5mcmVzaCA/IFwiWW91IGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kLlwiIDogJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgcy5oYW5kW3RoaXMuc2VsLmlkeF0gPT09IHUuc291bCAmJiB1LnN0YXIgPT09IDEgJiYgcy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicpIHtcbiAgICAgIGlmIChtZXJnZUZyb21IYW5kKHMsIHRoaXMuc2VsLmlkeCwgaWQpKSB7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCB0aGUgY2FyZCBpbnRvIGEgMi1zdGFyICR7U09VTF9OQU1FW3Uuc291bF19IWApOyB9XG4gICAgICBlbHNlIHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb24gdG8gbWVyZ2U6IGl0IG5lZWRzICR7Y29zdCh1LnNvdWwsIDIpIC0gY29zdCh1LnNvdWwsIDEpfSBtb3JlLCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkICE9PSBpZCkge1xuICAgICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gKHRoaXMuc2VsIGFzIGFueSkuaWQpITtcbiAgICAgIGlmIChjYW5NZXJnZURlcGxveWVkKGEsIHUpKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgdS5pZCk7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkOiBhLmlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIH0gZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCA9PT0gaWQgPyBudWxsIDogeyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgbWVyZ2VTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7IGNvbnN0IGIgPSBhICYmIHMudW5pdHMuZmluZCgobykgPT4gY2FuTWVyZ2VEZXBsb3llZChhLCBvKSk7XG4gICAgaWYgKGEgJiYgYikgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIGIuaWQpOyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy50b2FzdCgnTm8gbWF0Y2hpbmcgdW5pdCAoc2FtZSBTb3VsIGFuZCBzdGFycykgdG8gbWVyZ2Ugd2l0aC4nKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHJlbW92ZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmNvbmZpcm1SZW1vdmUpIHsgdGhpcy5jb25maXJtUmVtb3ZlID0gdHJ1ZTsgdGhpcy50b2FzdCgnVGFwIFJlbW92ZSBhZ2FpbiB0byBjb25maXJtLiBUaGUgY2FyZCBpcyBnb25lIGZvciB0aGlzIHN0YWdlLicpOyB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47IH1cbiAgICBkaXNtaXNzKHRoaXMucywgc2VsLmlkKTsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICB0b2dnbGVTd2FwKCkgeyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuOyBpZiAodGhpcy5zLmRpc2NhcmRVc2VkKSB7IHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IHJldHVybjsgfSB0aGlzLnN3YXBNb2RlID0gIXRoaXMuc3dhcE1vZGU7IHRoaXMuc2VsID0gbnVsbDsgaWYgKHRoaXMuc3dhcE1vZGUpIHRoaXMudG9hc3QoJ1N3YXA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkLCBvciBhIHVuaXQgKG5vdCBzdW1tb25lZCB0aGlzIHJvdW5kKSB0byBzZWxsLicpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gYmF0dGxlXG4gIHN0YXJ0QmF0dGxlKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICF0aGlzLnMudW5pdHMubGVuZ3RoKSB7IGlmICghdGhpcy5zLnVuaXRzLmxlbmd0aCkgdGhpcy50b2FzdCgnU3VtbW9uIGF0IGxlYXN0IG9uZSB1bml0IGZpcnN0LicpOyByZXR1cm47IH1cbiAgICB0aGlzLmZsdXNoVHdlZW5zKCk7IGF1ZGlvLnBsYXkoJ3N0YXJ0Jyk7IHRoaXMuYmVnaW5CYXR0bGVQZXJmKCk7IHRoaXMuc2hvd0dyaWQoZmFsc2UpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmF0dGVtcHQrKzsgdGhpcy5oYW5kbGVkID0gZmFsc2U7IHRoaXMucmVzdWx0QXQgPSAtMTtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1bml0cyA9IHMudW5pdHMuc2xpY2UoKTtcbiAgICBjb25zdCBzYXZlZCA9IGxvYWRTYXZlKCkuc291bHMsIGxldmVsczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9OyBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoc2F2ZWQpKSBsZXZlbHNba10gPSAoc2F2ZWQgYXMgYW55KVtrXS5sZXZlbDsgICAvLyBwZXJtYW5lbnQgU291bCBsZXZlbHNcbiAgICB0aGlzLmJhdHRsZSA9IG5ldyBCYXR0bGUodW5pdHMubWFwKCh1KSA9PiAoeyBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsIH0pKSwgZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKSwgdGhpcy5zZWVkICogMTMxICsgcy53YXZlICogMTcgKyB0aGlzLmF0dGVtcHQsIGxldmVscywgZW5lbXlQb3dlcihzLndhdmUpKTtcbiAgICB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpO1xuICAgIHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmZvckVhY2goKGYpID0+IHtcbiAgICAgIGlmIChmLnRlYW0gPT09IDApIHsgY29uc3QgdSA9IHVuaXRzW2YuaWQgLSAxXTsgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmZVbml0LnNldChmLmlkLCB1LmlkKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBmLnNvdWwsIDEsIGYuc3Rhcik7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChmLngsIDAsIGYueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSAtTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHYuc3RhdGUgPT09ICdzcGF3bicpIHYucGxheSgnaWRsZScpOyB9KTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNywgMC42LCAwLjUsIDAuN10sIFswLjQsIDAuMzUsIDAuMywgMC42XSwgMTQpOyB9XG4gICAgfSk7XG4gICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHRoaXMudGludChjLCAnbm9ybWFsJyk7XG4gICAgdGhpcy5waGFzZSA9ICd0cmFuc2l0aW9uJzsgdGhpcy5zdGFydFN0ZXBBdCA9IDEuMDsgdGhpcy5hY2MgPSAwOyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDIuMik7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcHJpdmF0ZSBhcHBseUV2ZW50cyhldnM6IEJFdmVudFtdKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlITtcbiAgICBmb3IgKGNvbnN0IGUgb2YgZXZzKSB7XG4gICAgICBpZiAoZS50ID09PSAnc3dpbmcnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgdi5wbGF5KCdhdHRhY2snLCBlLnNwZWVkKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnaGl0JykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLnRvKTsgaWYgKHYpIHYucHVsc2UoKTsgaWYgKGUua2luZCA9PT0gJ2Fycm93JykgYXVkaW8ucGxheSgnaGl0QXJyb3cnKTsgZWxzZSBpZiAoZS5raW5kID09PSAnbWVsZWUnKSBhdWRpby5wbGF5KCdoaXQnKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnYXJyb3cnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5mcm9tKSEsIHRvID0gYi5ieUlkKGUudG8pITsgdGhpcy5zcGF3bkFycm93KGYudGVhbSwgZi54LCBmLnosIHRvLngsIHRvLnosIGUuZHVyKTsgYXVkaW8ucGxheSgnYXJyb3cnKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnZGVhdGgnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgeyB2LnBsYXkoJ2RlYXRoJyk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ2RlYXRoJyk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTIpOyBpZiAoZi50ZWFtID09PSAxKSB0aGlzLmxhdGVyKDUsICgpID0+IHsgaWYgKHRoaXMuZnZpcy5nZXQoZS5pZCkgPT09IHYgJiYgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgeyB2LmhvbGRlci5zZXRFbmFibGVkKGZhbHNlKTsgfSB9KTsgfSB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdjYXN0JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnY2FzdCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNSwgMC44LCAxKSwgMC4xNSwgMS4xLCAwLjM1KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAndGF1bnQnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCd0YXVudCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuMyksIDAuMywgQkFMQU5DRS50YXVudC5yYWRpdXMsIDAuNik7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3NtYXNoJykgeyBhdWRpby5wbGF5KCdzbWFzaCcpOyB0aGlzLmZ4UmluZyhlLngsIGUueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNSwgMC4yKSwgMC4yLCBlLnIgKiAxLjYsIDAuNDUpOyB9XG4gICAgfVxuICB9XG4gIHByaXZhdGUgYXJyb3dCYXNlOiBhbnlbXSA9IFtdO1xuICAvKiogVGhlIGFycm93J3Mgb3duIG1hdGVyaWFsIHdpdGggYSBmYWludCBnbG93IGluIHRoZSB0ZWFtIGNvbG91ciAocHVycGxlIGZvciB5b3VycywgYW1iZXIgZm9yIHRoZSBlbmVteSdzKSwgc28geW91IGNhbiBzdGlsbCB0ZWxsIHdob3NlIGl0IGlzLiAqL1xuICBwcml2YXRlIGFycm93VGVhbU1hdCh0ZWFtOiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5hcnJvd0Jhc2VbdGVhbV0pIHJldHVybiB0aGlzLmFycm93QmFzZVt0ZWFtXTtcbiAgICBjb25zdCBzcmMgPSB0aGlzLkEuYXJyb3cubWF0ZXJpYWxzICYmIHRoaXMuQS5hcnJvdy5tYXRlcmlhbHNbMF07IGlmICghc3JjKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBtID0gc3JjLmNsb25lKCdhcnJvd1QnICsgdGVhbSk7IGNvbnN0IGMgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNTUsIDAuMiwgMC44NSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC45LCAwLjU1LCAwLjE1KTtcbiAgICBpZiAoJ2VtaXNzaXZlQ29sb3InIGluIG0pIG0uZW1pc3NpdmVDb2xvciA9IGMuc2NhbGUoMC4wMzUpOyB0aGlzLmFycm93QmFzZVt0ZWFtXSA9IG07IHJldHVybiBtO1xuICB9XG4gIHByaXZhdGUgc3Bhd25BcnJvdyh0ZWFtOiBudW1iZXIsIHgwOiBudW1iZXIsIHowOiBudW1iZXIsIHgxOiBudW1iZXIsIHoxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgbGV0IG1lc2ggPSB0aGlzLmFycm93TWVzaC5wb3AoKTtcbiAgICBpZiAoIW1lc2gpIHtcbiAgICAgIGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2FyJywgdGhpcy5zY2VuZSk7IGhvbGRlci5zY2FsaW5nLnNldEFsbCgwLjY1KTsgICAvLyA1NSBjbSB3YXMgbG9uZyBuZXh0IHRvIGEgY2hpYmkgR29ibGluXG4gICAgICBpZiAodGhpcy5BLmFycm93KSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHJlYWwgYXJyb3cgbW9kZWwgKG1ldGFsIGhlYWQsIGZsZXRjaGluZyk6IG9uZSBpbnN0YW5jZSBwZXIgZmx5aW5nIGFycm93XG4gICAgICAgIGNvbnN0IGVudCA9IHRoaXMuQS5hcnJvdy5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpLCBmYWxzZSk7XG4gICAgICAgIGVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gaG9sZGVyOyBlbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IH0pO1xuICAgICAgfSBlbHNlIHsgY29uc3QgY3lsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignYXJyb3cnLCB7IGhlaWdodDogMC41NSwgZGlhbWV0ZXI6IDAuMDM1IH0sIHRoaXMuc2NlbmUpOyBjeWwucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyBjeWwuaXNQaWNrYWJsZSA9IGZhbHNlOyBjeWwucGFyZW50ID0gaG9sZGVyOyBjeWwubWF0ZXJpYWwgPSB0aGlzLmFycm93TWF0c1t0ZWFtXTsgfVxuICAgICAgbWVzaCA9IGhvbGRlcjtcbiAgICB9XG4gICAgbWVzaC5zZXRFbmFibGVkKHRydWUpO1xuICAgIGlmICh0aGlzLkEuYXJyb3cpIHsgY29uc3QgdG0gPSB0aGlzLmFycm93VGVhbU1hdCh0ZWFtKTsgbWVzaC5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBpZiAodG0pIG0ubWF0ZXJpYWwgPSB0bTsgfSk7IH1cbiAgICB0aGlzLmFycm93cy5wdXNoKHsgbWVzaCwgeDAsIHowLCB4MSwgejEsIHQ6IDAsIGR1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZnJhbWUoZHQ6IG51bWJlcikge1xuICAgIGlmICh0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCAhPT0gdGhpcy5sYXN0VyB8fCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQgIT09IHRoaXMubGFzdEgpIHRoaXMuaGFuZGxlUmVzaXplKCk7ICAgLy8gZS5nLiB0aGUgaG9tZS1zY3JlZW4gYXBwIHJlc2l6aW5nIGFmdGVyIGxhdW5jaFxuICAgIGZvciAobGV0IGkgPSB0aGlzLnRpbWVycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyB0aGlzLnRpbWVyc1tpXS50IC09IGR0OyBpZiAodGhpcy50aW1lcnNbaV0udCA8PSAwKSB7IGNvbnN0IGYgPSB0aGlzLnRpbWVyc1tpXS5mbjsgdGhpcy50aW1lcnMuc3BsaWNlKGksIDEpOyBmKCk7IH0gfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLnJpbmdGeC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCByID0gdGhpcy5yaW5nRnhbaV07IHIudCArPSBkdDsgY29uc3QgdSA9IHIudCAvIHIuZHVyLCBzID0gci5yMCArIChyLnIxIC0gci5yMCkgKiB1OyByLm0uc2NhbGluZy5zZXQocywgcywgcyk7IHIubW0uYWxwaGEgPSAwLjkgKiAoMSAtIHUpOyBpZiAodSA+PSAxKSB7IHIubS5kaXNwb3NlKCk7IHIubW0uZGlzcG9zZSgpOyB0aGlzLnJpbmdGeC5zcGxpY2UoaSwgMSk7IH0gfVxuICAgIGlmICh0aGlzLmNhbVQgPCAxKSB7IHRoaXMuY2FtVCA9IE1hdGgubWluKDEsIHRoaXMuY2FtVCArIGR0IC8gdGhpcy5jYW1EdXIpOyBjb25zdCBlID0gdGhpcy5jYW1UICogdGhpcy5jYW1UICogKDMgLSAyICogdGhpcy5jYW1UKTsgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20ucG9zLCB0aGlzLmNhbVRvLnBvcywgZSk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnRndCwgdGhpcy5jYW1Uby50Z3QsIGUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyAmJiB0aGlzLmNhbU1vZGUgPT09ICdjbG9zZScgJiYgIXRoaXMuY2luZSkgdGhpcy5mcmFtZUJhdHRsZShkdCk7XG4gICAgdGhpcy5uZWNyby51cGRhdGUoZHQpO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnR3ZWVucy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCB3ID0gdGhpcy50d2VlbnNbaV07IHcudCArPSBkdDsgY29uc3QgdSA9IE1hdGgubWluKDEsIHcudCAvIHcuZHVyKTsgdy5mbih1KTsgaWYgKHUgPj0gMSkgeyB0aGlzLnR3ZWVucy5zcGxpY2UoaSwgMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgICBmb3IgKGNvbnN0IHYgb2YgdGhpcy51bml0VmlzLnZhbHVlcygpKSB2LnVwZGF0ZShkdCk7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LnVwZGF0ZShkdCk7IH0pO1xuXG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlO1xuICAgIGlmICgodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nIHx8IHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSAmJiBiKSB7XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nKSB7IHRoaXMuc3RhcnRTdGVwQXQgLT0gZHQ7IGlmICh0aGlzLnN0YXJ0U3RlcEF0IDw9IDApIHsgdGhpcy5waGFzZSA9ICdiYXR0bGUnOyB0aGlzLnVpLnJlbmRlcigpOyB9IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJykge1xuICAgICAgICB0aGlzLmFjYyArPSBkdCAqIHRoaXMudGltZVNjYWxlO1xuICAgICAgICB3aGlsZSAodGhpcy5hY2MgPj0gMSAvIDMwICYmIGIud2lubmVyIDwgMCkgeyBiLnN0ZXAoMSAvIDMwKTsgdGhpcy5hY2MgLT0gMSAvIDMwOyB0aGlzLmFwcGx5RXZlbnRzKGIuZHJhaW4oKSk7IH1cbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoIXRoaXMuY2luZSAmJiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgfHwgZi50ZWFtID09PSAxKSkgeyB2LmhvbGRlci5wb3NpdGlvbi54ID0gZi54OyB2LmhvbGRlci5wb3NpdGlvbi56ID0gZi56OyBpZiAoZi5hbGl2ZSB8fCB0cnVlKSB2LmhvbGRlci5yb3RhdGlvbi55ID0gZi55YXc7IH1cbiAgICAgICAgaWYgKGYuYWxpdmUpIHsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCk7IGlmIChmLm1heE1hbmEpIHYuc2V0TWFuYShmLm1hbmEgLyBmLm1heE1hbmEpOyB9XG4gICAgICAgIGVsc2Ugdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoZi5zdGF0ZSAhPT0gJ2F0dGFjaycgJiYgZi5hbGl2ZSAmJiB2LnN0YXRlICE9PSAnY2hlZXInKSB7IGNvbnN0IHdhbnQgPSBmLnN0YXRlID09PSAncnVuJyA/ICdydW4nIDogJ2lkbGUnOyBpZiAodGhpcy5sYXN0U3RhdGUuZ2V0KGYuaWQpICE9PSB3YW50IHx8ICh2LnN0YXRlICE9PSB3YW50ICYmIHYuc3RhdGUgIT09ICdzcGF3bicpKSB7IGlmICh2LnN0YXRlICE9PSAnc3Bhd24nKSB7IHYucGxheSh3YW50IGFzIGFueSk7IHRoaXMubGFzdFN0YXRlLnNldChmLmlkLCB3YW50KTsgfSB9IH1cbiAgICAgICAgaWYgKGYuc3RhdGUgPT09ICdhdHRhY2snKSB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgJ2F0dGFjaycpO1xuICAgICAgfVxuICAgICAgaWYgKGIud2lubmVyID49IDAgJiYgIXRoaXMuaGFuZGxlZCkgeyB0aGlzLmhhbmRsZWQgPSB0cnVlOyB0aGlzLnJlc3VsdEF0ID0gMS40OyB9XG4gICAgICBpZiAodGhpcy5yZXN1bHRBdCA+IDApIHsgdGhpcy5yZXN1bHRBdCAtPSBkdDsgaWYgKHRoaXMucmVzdWx0QXQgPD0gMCkgdGhpcy5oYW5kbGVSZXN1bHQoKTsgfVxuICAgIH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5hcnJvd3MubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGEgPSB0aGlzLmFycm93c1tpXTsgYS50ICs9IGR0ICogdGhpcy50aW1lU2NhbGU7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCBhLnQgLyBhLmR1cik7XG4gICAgICBjb25zdCBweCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdSwgcHogPSBhLnowICsgKGEuejEgLSBhLnowKSAqIHUsIHB5ID0gMC43NSArIE1hdGguc2luKHUgKiBNYXRoLlBJKSAqIDAuOSAtIHUgKiAwLjI1O1xuICAgICAgY29uc3QgdTIgPSBNYXRoLm1pbigxLCB1ICsgMC4wMyksIHF4ID0gYS54MCArIChhLngxIC0gYS54MCkgKiB1MiwgcXogPSBhLnowICsgKGEuejEgLSBhLnowKSAqIHUyLCBxeSA9IDAuNzUgKyBNYXRoLnNpbih1MiAqIE1hdGguUEkpICogMC45IC0gdTIgKiAwLjI1O1xuICAgICAgYS5tZXNoLnBvc2l0aW9uLnNldChweCwgcHksIHB6KTsgYS5tZXNoLmxvb2tBdChuZXcgQkFCWUxPTi5WZWN0b3IzKHF4LCBxeSwgcXopKTtcbiAgICAgIGlmICh1ID49IDEpIHsgYS5tZXNoLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLmFycm93TWVzaC5wdXNoKGEubWVzaCk7IHRoaXMuYXJyb3dzLnNwbGljZShpLCAxKTsgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlUmVzdWx0KCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIHMgPSB0aGlzLnM7XG4gICAgdGhpcy5lbmRCYXR0bGVQZXJmKCk7XG4gICAgdGhpcy5sYXN0QmF0dGxlID0gYHdhdmUgJHtzLndhdmV9IGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9OiAke2Iud2lubmVyID09PSAwID8gJ1dPTicgOiAnTE9TVCd9IGluICR7Yi50aW1lLnRvRml4ZWQoMSl9cywgJHtiLmNvdW50KDApfSBvZiB5b3VycyBhbmQgJHtiLmNvdW50KDEpfSBlbmVtaWVzIGxlZnRgO1xuICAgIGlmIChiLndpbm5lciA9PT0gMCkge1xuICAgICAgdGhpcy5wbGF5UmVzdWx0KCd3aW4nLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGFybXkgaXMgcmFpc2VkIGFnYWluLCB0aGVuIHRoZSBuZXh0IHdhdmUgLyB0aGUgZHJhZnRcbiAgICAgICAgdGhpcy5jaW5lID0gZmFsc2U7XG4gICAgICAgIGlmIChpc0VuZGxlc3MoKSAmJiB0aGlzLmVuZGxlc3MpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgciA9IHJlY29yZEVuZGxlc3NXYXZlQW5kU2F2ZShzLndhdmUpOyB0aGlzLmVuZGxlc3MuY2xlYXJlZCA9IHMud2F2ZTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7XG4gICAgICAgICAgICBpZiAoci5wYWNrKSB7IHRoaXMuZW5kbGVzcy5wYWNrcysrOyB0aGlzLnRvYXN0KCdXYXZlICcgKyBzLndhdmUgKyAnIGNsZWFyZWQhIFlvdSBlYXJuZWQgYSBTb3VsIFBhY2sgKHNlZSB0aGUgU2hvcCkuJyk7IH1cbiAgICAgICAgICB9IGNhdGNoIHsgLyogc2F2aW5nIG11c3QgbmV2ZXIgYnJlYWsgYSBydW4gKi8gfVxuICAgICAgICB9XG4gICAgICAgIGlmIChhZHZhbmNlV2F2ZShzKSkge1xuICAgICAgICAgIHRoaXMucGhhc2UgPSAnd29uJzsgY2xlYXJSdW4oKTtcbiAgICAgICAgICB0cnkgeyB0aGlzLnJld2FyZCA9IHJlY29yZENsZWFyQW5kU2F2ZShjdXJyZW50U3RhZ2VJZCwgZGlmZmljdWx0eU5hbWUgYXMgYW55KTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7IH0gY2F0Y2ggeyB0aGlzLnJld2FyZCA9IG51bGw7IH1cbiAgICAgICAgICB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5kcmFmdCA9IGRyYWZ0T3B0aW9ucyhzKTsgdGhpcy5waGFzZSA9ICdkcmFmdCc7IHRoaXMucGVyc2lzdFJ1bigpOyB0aGlzLnVpLnJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZhaWxXYXZlKHMpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnVpLnB1bHNlSGVhcnRzKCk7ICAgICAgICAgICAgICAgICAgIC8vIHRoZSBoZWFydCBpcyBsb3N0IHRoZSBtb21lbnQgaGUgaXMgaGl0XG4gICAgICBpZiAocy5zdGF0dXMgPT09ICdsb3N0JykgdGhpcy5wbGF5UmVzdWx0KCdmaW5hbCcsICgpID0+IHsgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucGhhc2UgPSAnbG9zdCc7IGNsZWFyUnVuKCk7IHRoaXMudWkucmVuZGVyKCk7IH0pO1xuICAgICAgZWxzZSB0aGlzLnBsYXlSZXN1bHQoJ2xvc3MnLCAoKSA9PiB7IHRoaXMudG9hc3QoJ1lvdXIgYXJteSBmZWxsLiAtMSBoZWFydCwgKzEgY2FyZCwgc2FtZSB3YXZlLiBSZWJ1aWxkIGEgZGlmZmVyZW50IHN0cmF0ZWd5LicpOyB0aGlzLnRvQnVpbGQoKTsgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLSByZXN1bHQgY3V0c2NlbmVzIChwbGFuIHNlY3Rpb25zIDE5LTIyKTogdGhlIE5lY3JvbWFuY2VyIHRha2VzIHRoZSBoaXQsIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSwgcmFpc2VzIHRoZSBmYWxsZW5cbiAgcHJpdmF0ZSBwbGF5UmVzdWx0KGtpbmQ6ICd3aW4nIHwgJ2xvc3MnIHwgJ2ZpbmFsJywgZG9uZTogKCkgPT4gdm9pZCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIG4gPSB0aGlzLm5lY3JvOyB0aGlzLmNpbmUgPSB0cnVlOyBpZiAoa2luZCAhPT0gJ3dpbicpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLm5lY3JvLCAxLjEpO1xuICAgIGNvbnN0IGhvbWUgPSAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXZlcnkgZmFsbGVuIGFsbHkgaXMgcHVsbGVkIGJhY2sgdG8gaXRzIGdyaWQgdGlsZSBhbmQgc3RhbmRzIHVwXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgncmVzdXJyZWN0Jyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy5idXJzdChjLngsIGMueiwgWzAuODUsIDAuNSwgMSwgMC45XSwgWzAuNSwgMC4yLCAxLCAwLjddLCAzMCk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBpZiAoZi50ZWFtICE9PSAwKSBjb250aW51ZTsgY29uc3QgdWlkID0gdGhpcy5mVW5pdC5nZXQoZi5pZCksIHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdWlkKSwgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdSB8fCAhdikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3ModS5jZWxsKSwgeDAgPSB2LmhvbGRlci5wb3NpdGlvbi54LCB6MCA9IHYuaG9sZGVyLnBvc2l0aW9uLno7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTtcbiAgICAgICAgaWYgKCFmLmFsaXZlKSB7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5idXJzdCh4MCwgejAsIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTgpOyB0aGlzLmZ4UmluZyh4MCwgejAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjcsIDAuMzUsIDEpLCAwLjMsIDEuNiwgMC43KTsgfVxuICAgICAgICB0aGlzLnR3ZWVuKDEuMCwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjUsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIucm90YXRpb24ueSArPSAoTWF0aC5QSSAvIDIgLSB2LmhvbGRlci5yb3RhdGlvbi55KSAqIE1hdGgubWluKDEsIHQgKiAwLjUgKyAwLjEpOyB9LFxuICAgICAgICAgICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHRoaXMuYnVyc3QodG8ueCwgdG8ueiwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxMCk7IH0pO1xuICAgICAgfVxuICAgIH07XG4gICAgaWYgKGtpbmQgPT09ICd3aW4nKSB7XG4gICAgICAvLyB0aGUgc3Vydml2b3JzIGNlbGVicmF0ZSByaWdodCB3aGVyZSB0aGV5IHN0YW5kIChwdXJlbHkgdmlzdWFsKSwgVEhFTiB0aGUgY2FtZXJhIHN3aW5ncyB0byB0aGUgTmVjcm9tYW5jZXIgYW5kIHRoZSBhcm15IGlzIHJhaXNlZFxuICAgICAgYXVkaW8ucGxheSgndmljdG9yeScpO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIGlmIChmLnRlYW0gPT09IDAgJiYgZi5hbGl2ZSkgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKHYpIHRoaXMubGF0ZXIoTWF0aC5yYW5kb20oKSAqIDAuMzUsICgpID0+IHYucGxheSgnY2hlZXInKSk7IH1cbiAgICAgIHRoaXMubGF0ZXIoMS42LCAoKSA9PiB7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLm5lY3JvLCAxLjEpOyBuLmNhc3QoKTsgfSk7XG4gICAgICB0aGlzLmxhdGVyKDEuODUsIGhvbWUpOyB0aGlzLmxhdGVyKDMuNiwgZG9uZSk7IHJldHVybjtcbiAgICB9XG4gICAgbi5odXJ0KCk7IGF1ZGlvLnBsYXkoJ2hlYXJ0TG9zdCcpOyB0aGlzLmxhdGVyKDAuMTUsICgpID0+IHsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpOyB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMSwgMC4zLCAwLjMsIDAuOV0sIFswLjgsIDAuMSwgMC4yLCAwLjZdLCAxNik7IH0pO1xuICAgIGlmIChraW5kID09PSAnZmluYWwnKSB7IHRoaXMubGF0ZXIoMC42LCAoKSA9PiB7IG4uZGVmZWF0KCk7IGF1ZGlvLnBsYXkoJ2RlZmVhdCcpOyB9KTsgdGhpcy5sYXRlcigyLjYsIGRvbmUpOyByZXR1cm47IH1cbiAgICB0aGlzLmxhdGVyKDEuMCwgKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlcHVsc2lvbiBzaG9ja3dhdmU6IHN1cnZpdm9ycyBhcmUgZmx1bmcgYmFjayB0byB3aGVyZSB0aGV5IHN0YXJ0ZWQgYW5kIGhlYWwgdG8gZnVsbFxuICAgICAgbi5jYXN0KCk7IGF1ZGlvLnBsYXkoJ3Nob2Nrd2F2ZScpOyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7XG4gICAgICB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjg1LCAwLjU1LCAxKSwgMC42LCAzMCwgMS4xKTsgdGhpcy5meFJpbmcoYy54LCAwLCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMSwgMSksIDAuNCwgMjIsIDAuOCk7XG4gICAgICB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMSwgMC44NSwgMSwgMC45XSwgWzAuNywgMC40LCAxLCAwLjddLCA0MCk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBpZiAoZi50ZWFtICE9PSAxIHx8ICFmLmFsaXZlKSBjb250aW51ZTsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRvID0gY2VsbFBvcygxLCBmLmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5wdWxzZSgpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuOSwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjksIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCArICgxIC0gZi5ocCAvIGYubWF4SHApICogdCk7IH0sICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHYuc2V0SHAoMSk7IH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHRoaXMubGF0ZXIoMi4zLCBob21lKTsgdGhpcy5sYXRlcigzLjcsIGRvbmUpO1xuICB9XG4gIHBpY2tEcmFmdChpZHg6IG51bWJlcikgeyBpZiAoIXRoaXMuZHJhZnQpIHJldHVybjsgdGFrZURyYWZ0KHRoaXMucywgdGhpcy5kcmFmdCwgaWR4KTsgdGhpcy5kcmFmdCA9IG51bGw7IG5vcm1hbERyYXcodGhpcy5zKTsgdGhpcy50b0J1aWxkKCk7IH1cbiAgcHJpdmF0ZSB0b0J1aWxkKCkge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLm5lY3JvLnJldml2ZSgpOyB0aGlzLmZsdXNoVHdlZW5zKCk7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpO1xuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHsgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlc3VycmVjdGlvbjogZXZlcnlvbmUgcmlzZXMgYWdhaW4gYXQgZnVsbCBoZWFsdGhcbiAgICAgIGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgdi5ob2xkZXIuc2V0RW5hYmxlZCh0cnVlKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopO1xuICAgICAgdGhpcy5sYXRlcigxLjEsICgpID0+IHYucGxheSgnaWRsZScpKTtcbiAgICB9XG4gICAgdGhpcy5waGFzZSA9ICdidWlsZCc7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgICAgICAgICAgLy8gVUkgZmlyc3Q6IHRoZSBjYW1lcmEgbXVzdCBtZWFzdXJlIHRoZSBoYW5kIGFuZCBidXR0b25zIHdoaWxlIHRoZXkgYXJlIHZpc2libGVcbiAgICB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5idWlsZCwgMS44KTtcbiAgfVxuICBzZXRTcGVlZChrOiBudW1iZXIpIHsgdGhpcy50aW1lU2NhbGUgPSBrOyB0aGlzLnVpLnJlbmRlcigpOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgaGVscGVyc1xuICBhcHBseUJhbGFuY2VDaGFuZ2UoKSB7IHRoaXMudW5pdFZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBjb25zdCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKTsgaWYgKHUpIHYuc2V0U3Rhcih1LnN0YXIpOyB9KTsgfVxuICB0ZXN0T2RkcyhuID0gMjAwKSB7XG4gICAgY29uc3Qgc2xvdHMgPSB0aGlzLnMudW5pdHMubWFwKCh1KSA9PiAoeyBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsIH0pKSwgZW5lbWllcyA9IGVuZW15V2F2ZSh0aGlzLnMud2F2ZSwgdGhpcy5zZWVkKTsgbGV0IHdpbiA9IDAsIHQgPSAwO1xuICAgIGNvbnN0IGx2OiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge30sIHN2ID0gbG9hZFNhdmUoKS5zb3VsczsgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHN2KSkgbHZba10gPSAoc3YgYXMgYW55KVtrXS5sZXZlbDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykgeyBjb25zdCByID0gc2ltdWxhdGUoc2xvdHMsIGVuZW1pZXMsIDUwMDAgKyBpLCAxMzAsIGx2LCBlbmVteVBvd2VyKCkpOyBpZiAoci53aW5uZXIgPT09IDApIHdpbisrOyB0ICs9IHIudGltZTsgfVxuICAgIHJldHVybiB7IHdpbjogTWF0aC5yb3VuZCgod2luIC8gbikgKiAxMDApLCBhdmdUaW1lOiArKHQgLyBuKS50b0ZpeGVkKDEpLCBuIH07XG4gIH1cbiAgYWRkQ2FyZChzb3VsOiBTb3VsSWQpIHsgdGhpcy5zLmhhbmQucHVzaChzb3VsKTsgdGhpcy5zLnN0YXRzLmRyYXduKys7IHRoaXMudWkucmVuZGVyKCk7IH1cbiAgYWRkRG9taW5pb24objogbnVtYmVyKSB7IHRoaXMucy5jYXAgKz0gbjsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICByZXBvcnQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBlbiA9IGVuZW15V2F2ZShzLndhdmUsIHRoaXMuc2VlZCk7XG4gICAgcmV0dXJuIFtgc3RhZ2UgJHtjdXJyZW50U3RhZ2VJZH0vJHtkaWZmaWN1bHR5TmFtZX0gIHNlZWQgJHt0aGlzLnNlZWR9ICB3YXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9ICBoZWFydHMgJHtzLmhlYXJ0c30gIGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSAgcGhhc2UgJHt0aGlzLnBoYXNlfSAgYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH1gLFxuICAgICAgYGhhbmQ6ICR7cy5oYW5kLmpvaW4oJywgJykgfHwgJyhlbXB0eSknfWAsIGBhcm15OiAke3MudW5pdHMubWFwKCh1KSA9PiBgJHt1LnNvdWx9JHt1LnN0YXJ9QCR7dS5jZWxsfWApLmpvaW4oJyAnKSB8fCAnKG5vbmUpJ31gLCBgZW5lbXk6ICR7ZW4ubWFwKChlKSA9PiBlLnNvdWwgKyBlLnN0YXIpLmpvaW4oJyAnKX1gLFxuICAgICAgYGRpZmZpY3VsdHk6ICR7ZGlmZmljdWx0eU5hbWV9ICBtZXJnZS1mcm9tLWhhbmQ6ICR7cy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3Rhcid9ICBzd2FwIHVzZWQ6ICR7cy5kaXNjYXJkVXNlZH1gLCBgbGFzdCB0YXA6ICR7dGhpcy5sYXN0VGFwSW5mb31gLCBgc2NyZWVuOiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gZHByICR7d2luZG93LmRldmljZVBpeGVsUmF0aW99YCwgYGxhc3QgYmF0dGxlOiAke3RoaXMubGFzdEJhdHRsZSB8fCAnLSd9YCwgYGxvZyB0YWlsOmAsIC4uLnMubG9nLnNsaWNlKC04KSwgYGJhbGFuY2U6ICR7SlNPTi5zdHJpbmdpZnkoeyBzdGFyOiBCQUxBTkNFLnN0YXIsIHN0YXRzOiBCQUxBTkNFLnN0YXRzIH0pfWBdLmpvaW4oJ1xcbicpO1xuICB9XG4gIHJlc2V0QmFsYW5jZUFsbCgpIHsgcmVzZXRCYWxhbmNlKCk7IHRoaXMuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7IH1cbiAgZ2V0IGRpZmZpY3VsdHkoKSB7IHJldHVybiBkaWZmaWN1bHR5TmFtZTsgfVxuICBjaGFuZ2VEaWZmaWN1bHR5KG5hbWU6IHN0cmluZykgeyBzZXREaWZmaWN1bHR5KG5hbWUpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnRvYXN0KGBEaWZmaWN1bHR5OiAke25hbWV9LiBBcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZS5gKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGdhbGxlcnkgKHN0YXIgbG9va3MpXG4gIGdhbGxlcnkoKSB7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QuYWRkKCdnYWxsZXJ5Jyk7IHRoaXMubmVjcm8uc2V0RW5hYmxlZChmYWxzZSk7IGNvbnN0IHZpczogVW5pdFZpc3VhbFtdID0gW107IGxldCB0ZWFtOiAwIHwgMSA9IDA7XG4gICAgY29uc3QgcmVidWlsZCA9ICgpID0+IHsgdmlzLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdmlzLmxlbmd0aCA9IDA7IFNPVUxTLmZvckVhY2goKHNvdWwsIGkpID0+IFsxLCAyLCAzXS5mb3JFYWNoKChzdCwgaikgPT4geyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgc291bCwgdGVhbSwgc3QpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoKGkgLSAyLjUpICogMi41LCAwLCAoaiAtIDEpICogLTIuNCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJICogMC44NTsgdi5wbGF5KCdpZGxlJyk7IHZpcy5wdXNoKHYpOyB9KSk7IH07XG4gICAgcmVidWlsZCgpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5zZXQoMCwgNS42LCAtMTQuNSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgLTAuNCkpOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg1O1xuICAgICh3aW5kb3cgYXMgYW55KS5fX2dhbGxlcnkgPSB7IHNldFRlYW06ICh0OiAwIHwgMSkgPT4geyB0ZWFtID0gdDsgcmVidWlsZCgpOyB9LCB2aXMgfTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpOyB0aGlzLmVuZ2luZS5ydW5SZW5kZXJMb29wKCgpID0+IHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpLCBkdCA9IE1hdGgubWluKDAuMDUsIChuIC0gbGFzdCkgLyAxMDAwKTsgbGFzdCA9IG47IHZpcy5mb3JFYWNoKCh2KSA9PiB2LnVwZGF0ZShkdCkpOyB0aGlzLnNjZW5lLnJlbmRlcigpOyB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEdhbWUgfSBmcm9tICcuL2dhbWUudHMnO1xuXG5jb25zdCBnID0gbmV3IEdhbWUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2dhbWUgPSBnOyAgICAgICAgICAgICAgICAgICAgICAgLy8gaGFuZHkgZm9yIGRlYnVnZ2luZyBmcm9tIHRoZSBicm93c2VyIGNvbnNvbGVcbmcuaW5pdChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYycpIGFzIEhUTUxDYW52YXNFbGVtZW50KVxuICAudGhlbigoKSA9PiB7IGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnOyAod2luZG93IGFzIGFueSkuX19nYW1lUmVhZHkgPSB0cnVlOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdhbWUtcmVhZHknKSk7IH0pXG4gIC5jYXRjaCgoZSkgPT4ge1xuICAgIGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgeyBsLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7IGwudGV4dENvbnRlbnQgPSAnRXJyb3I6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBlKTsgfVxuICAgIGNvbnNvbGUuZXJyb3IoZSk7XG4gIH0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBb0NPLE1BQU0sV0FBb0I7QUFBQSxJQUMvQixPQUFPO0FBQUEsTUFDTCxTQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxNQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFFBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEdBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEtBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0cs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LElBQ3JKLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEdBQUssS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxHQUFLLEtBQUssS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDcEwsRUFBRSxNQUFNLFNBQVMsR0FBRyxJQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxHQUFLLEdBQUcsS0FBSztBQUFBLElBQy9JLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLEVBQ3hOO0FBQ0EsTUFBTSxtQkFBZ0M7QUFBQTtBQUFBLElBQ3BDLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUNsRSxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFDeE0sRUFBRSxNQUFNLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssRUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLElBQUksR0FBRyxHQUFLLEtBQUssSUFBSTtBQUFBLElBQ3JNLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFDbkgsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQ3RJLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDckgsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDbk4sRUFBRSxNQUFNLFNBQVMsR0FBRyxHQUFHLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsRUFDdk47QUFDQSxNQUFNLGlCQUE4QjtBQUFBO0FBQUEsSUFDbEMsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsR0FBRyxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQzFILEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFDdkssRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsS0FBSyxLQUFLLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSztBQUFBLElBQ3pNLEVBQUUsTUFBTSxVQUFVLEdBQUcsT0FBTyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDNUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxPQUFPLEdBQUcsRUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxNQUFNLEdBQUcsRUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxNQUFNLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFDbFAsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxH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LEtBQUssR0FBSSxRQUFPO0FBQU8sV0FBSyxPQUFPLEdBQUcsSUFBSTtBQUFHLGFBQU87QUFBQSxJQUFNO0FBQUEsSUFFaEssS0FBSyxNQUFXO0FBQ2QsVUFBSSxDQUFDLEtBQUssT0FBTyxDQUFDLEtBQUssT0FBTyxLQUFLLElBQUksVUFBVSxVQUFXO0FBQzVELGNBQVEsTUFBTTtBQUFBLFFBQ1osS0FBSztBQUFPLGNBQUksQ0FBQyxLQUFLLFNBQVMsT0FBTyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ2hHLEtBQUs7QUFBVSxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBSyxHQUFHLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksS0FBSyxHQUFHLEtBQUssTUFBTSxJQUFJO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLEtBQUssSUFBSTtBQUFHO0FBQUEsUUFDbEssS0FBSztBQUFTLFdBQUMsS0FBSyxLQUFLLEtBQUssSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLEtBQUssSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDdE8sS0FBSztBQUFPLGNBQUksQ0FBQyxLQUFLLFNBQVMsT0FBTyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxNQUFNLFdBQVcsSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsRUFBRTtBQUFHO0FBQUEsUUFDdEksS0FBSztBQUFZLGNBQUksQ0FBQyxLQUFLLFNBQVMsUUFBUSxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxNQUFNLFlBQVksR0FB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SUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sTUFBTSxFQUFFO0FBQUc7QUFBQSxRQUNuWCxLQUFLO0FBQWMsZUFBSyxLQUFLLElBQUksTUFBTSxRQUFRLE1BQU0sR0FBRyxLQUFLLEdBQUc7QUFBRyxlQUFLLEtBQUssTUFBTSxNQUFNLFdBQVcsS0FBSyxHQUFHLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxHQUFLLFlBQVksTUFBTSxLQUFLLEtBQUssR0FBRztBQUFHO0FBQUEsUUFDekssS0FBSztBQUFjLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLEtBQUssSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEtBQU0sR0FBRztBQUFHO0FBQUEsUUFDOUwsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLEtBQUssWUFBWSxNQUFNLEdBQUcsR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLE1BQU0sRUFBRTtBQUFHLFdBQUMsTUFBTSxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQzFNLEtBQUs7QUFBVyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDbkcsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUN0RyxLQUFLO0FBQVksZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLE1BQU0sT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDN0gsS0FBSztBQUFZLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEtBQUssS0FBSyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxLQUFLLEdBQUcsRUFBRTtBQUFHO0FBQUEsUUFDekssS0FBSztBQUFjLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEtBQUssS0FBSyxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLElBQUksS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEtBQU0sR0FBRztBQUFHLGVBQUssS0FBSyxNQUFNLEtBQUssUUFBUSxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQ3RRLEtBQUs7QUFBZSxXQUFDLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQ2xHLEtBQUs7QUFBUyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxHQUFHLEtBQUssTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sTUFBTSxLQUFLLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sV0FBVyxHQUFHO0FBQUc7QUFBQSxNQUM3SztBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRU8sTUFBTSxRQUFR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TSxPQUFPO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEVBQUcsR0FBRSxNQUFNO0FBQUcsY0FBSSxFQUFFLFNBQVMsUUFBUyxPQUFNLEtBQUssVUFBVTtBQUFBLG1CQUFZLEVBQUUsU0FBUyxRQUFTLE9BQU0sS0FBSyxLQUFLO0FBQUEsUUFBRyxXQUNsSyxFQUFFLE1BQU0sU0FBUztBQUFFLGdCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxHQUFJLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGVBQUssV0FBVyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEVBQUUsR0FBRztBQUFHLGdCQUFNLEtBQUssT0FBTztBQUFBLFFBQUcsV0FDN0ksRUFBRSxNQUFNLFNBQVM7QUFBRSxnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksR0FBRztBQUFFLGNBQUUsS0FBSyxPQUFPO0FBQUcsY0FBRSxNQUFNLElBQUk7QUFBRyxjQUFFLFFBQVEsSUFBSTtBQUFHLGtCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGtCQUFNLEtBQUssT0FBTztBQUFHLGlCQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUcsZ0JBQUksRUFBRSxTQUFTLEVBQUcsTUFBSyxNQUFNLEdBQUcsTUFBTTtBQUFFLGtCQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRSxNQUFNLEtBQUssS0FBSyxVQUFVLFNBQVM7QUFBRSxrQkFBRSxPQUFPLFdBQVcsS0FBSztBQUFBLGNBQUc7QUFBQSxZQUFFLENBQUM7QUFBQSxVQUFHO0FBQUEsUUFBRSxXQUN2VyxFQUFFLE1BQU0sUUFBUTtBQUFFLGdCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGdCQUFNLEtBQUssTUFBTTtBQUFHLGVBQUssT0FBTyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUksUUFBUSxPQUFPLEtBQUssS0FBSyxDQUFDLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxRQUFHLFdBQ3hJLEVBQUUsTUFBTSxTQUFTO0FBQUUsZ0JBQU0sSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO0FBQUksZ0JBQU0sS0FBSyxPQUFPO0FBQUcsZUFBSyxPQUFPLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxNQUFNLEdBQUcsR0FBRyxLQUFLLFFBQVEsTUFBTSxRQUFRLEdBQUc7QUFBQSxRQUFHLFdBQzFKLEVBQUUsTUFBTSxTQUFTO0FBQUUsZ0JBQU0sS0FBSyxPQUFPO0FBQUcsZUFBSyxPQUFPLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxLQUFLLEdBQUcsR0FBRyxLQUFLLEVBQUUsSUFBSSxLQUFLLElBQUk7QUFBQSxRQUFHO0FBQUEsTUFDakk7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUdRLGFBQWEsTUFBYztBQUNqQyxVQUFJLEtBQUssVUFBVSxJQUFJLEVBQUcsUUFBTyxLQUFLLFVBQVUsSUFBSTtBQUNwRCxZQUFNLE1BQU0sS0FBSyxFQUFFLE1BQU0sYUFBYSxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFBRyxVQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2xGLFlBQU0sSUFBSSxJQUFJLE1BQU0sV0FBVyxJQUFJO0FBQUcsWUFBTSxJQUFJLFNBQVMsSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksUUFBUSxPQUFPLEtBQUssTUFBTSxJQUFJO0FBQ3JJLFVBQUksbUJBQW1CLEVBQUcsR0FBRSxnQkFBZ0IsRUFBRSxNQUFNLEtBQUs7QUFBRyxXQUFLLFVBQVUsSUFBSSxJQUFJO0FBQUcsYUFBTztBQUFBLElBQy9GO0FBQUEsSUFDUSxXQUFXLE1BQWMsSUFBWSxJQUFZLElBQVksSUFBWSxLQUFhO0FBQzVGLFVBQUksT0FBTyxLQUFLLFVBQVUsSUFBSTtBQUM5QixVQUFJLENBQUMsTUFBTTtBQUNULGNBQU0sU0FBUyxJQUFJLFFBQVEsY0FBYyxNQUFNLEtBQUssS0FBSztBQUFHLGVBQU8sUUFBUSxPQUFPLElBQUk7QUFDdEYsWUFBSSxLQUFLLEVBQUUsT0FBTztBQUNoQixnQkFBTSxNQUFNLEtBQUssRUFBRSxNQUFNLHlCQUF5QixDQUFDLE1BQWMsSUFBSSxNQUFNLEtBQUssT0FBTyxFQUFFLFNBQVMsRUFBRSxFQUFFLE1BQU0sR0FBRyxDQUFDLEdBQUcsS0FBSztBQUN4SCxjQUFJLFVBQVUsQ0FBQyxFQUFFLFNBQVM7QUFBUSxjQUFJLFVBQVUsQ0FBQyxFQUFFLGVBQWUsRUFBRSxRQUFRLENBQUMsTUFBVztBQUFFLGNBQUUsYUFBYTtBQUFPLGNBQUUsMkJBQTJCO0FBQUEsVUFBTSxDQUFDO0FBQUEsUUFDdEosT0FBTztBQUFFLGdCQUFNLE1BQU0sUUFBUSxZQUFZLGVBQWUsU0FBUyxFQUFFLFFBQVEsTUFBTSxVQUFVLE1BQU0sR0FBRyxLQUFLLEtBQUs7QUFBRyxjQUFJLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxjQUFJLGFBQWE7QUFBTyxjQUFJLFNBQVM7QUFBUSxjQUFJLFdBQVcsS0FBSyxVQUFVLElBQUk7QUFBQSxRQUFHO0FBQ2pPLGVBQU87QUFBQSxNQUNUO0FBQ0EsV0FBSyxXQUFXLElBQUk7QUFDcEIsVUFBSSxLQUFLLEVBQUUsT0FBTztBQUFFLGNBQU0sS0FBSyxLQUFLLGFBQWEsSUFBSTtBQUFHLGFBQUssZUFBZSxFQUFFLFFBQVEsQ0FBQyxNQUFXO0FBQUUsY0FBSSxHQUFJLEdBQUUsV0FBVztBQUFBLFFBQUksQ0FBQztBQUFBLE1BQUc7QUFDakksV0FBSyxPQUFPLEtBQUssRUFBRSxNQUFNLElBQUksSUFBSSxJQUFJLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQztBQUFBLElBQ3REO0FBQUEsSUFFUSxNQUFNLElBQVk7QUFDeEIsVUFBSSxLQUFLLE9BQU8sZ0JBQWdCLEtBQUssU0FBUyxLQUFLLE9BQU8saUJBQWlCLEtBQUssTUFBTyxNQUFLLGFBQWE7QUFDekcsZUFBUyxJQUFJLEtBQUssT0FBTyxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBRSxhQUFLLE9BQU8sQ0FBQyxFQUFFLEtBQUs7QUFBSSxZQUFJLEtBQUssT0FBTyxDQUFDLEVBQUUsS0FBSyxHQUFHO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLE9BQU8sQ0FBQyxFQUFFO0FBQUksZUFBSyxPQUFPLE9BQU8sR0FBRyxDQUFDO0FBQUcsWUFBRTtBQUFBLFFBQUc7QUFBQSxNQUFFO0FBQ3ZLLGVBQVMsSUFBSSxLQUFLLE9BQU8sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUUsY0FBTSxJQUFJLEtBQUssT0FBTyxDQUFDO0FBQUcsVUFBRSxLQUFLO0FBQUksY0FBTSxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTTtBQUFHLFVBQUUsRUFBRSxRQUFRLElBQUksR0FBRyxHQUFHLENBQUM7QUFBRyxVQUFFLEdBQUcsUUFBUSxPQUFPLElBQUk7QUFBSSxZQUFJLEtBQUssR0FBRztBQUFFLFlBQUUsRUFBRSxRQUFRO0FBQUcsWUFBRSxHQUFHLFFBQVE7QUFBRyxlQUFLLE9BQU8sT0FBTyxHQUFHLENBQUM7QUFBQSxRQUFHO0FBQUEsTUFBRTtBQUM3USxVQUFJLEtBQUssT0FBTyxHQUFHO0FBQUUsYUFBSyxPQUFPLEtBQUssSUFBSSxHQUFHLEtBQUssT0FBTyxLQUFLLEtBQUssTUFBTTtBQUFHLGNBQU0sSUFBSSxLQUFLLE9BQU8sS0FBSyxRQUFRLElBQUksSUFBSSxLQUFLO0FBQU8sYUFBSyxPQUFPLFdBQVcsUUFBUSxRQUFRLEtBQUssS0FBSyxRQUFRLEtBQUssS0FBSyxNQUFNLEtBQUssQ0FBQztBQUFHLGFBQUssU0FBUyxRQUFRLFFBQVEsS0FBSyxLQUFLLFFBQVEsS0FBSyxLQUFLLE1BQU0sS0FBSyxDQUFDO0FBQUcsYUFBSyxPQUFPLFVBQVUsS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUFBLE1B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
