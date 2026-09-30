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
      barbarian: { hp: 110, dmg: 12, interval: 0.9, range: 0.9, speed: 1.5, size: 0.3, animLen: 1, hitFrac: 0.5 }
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
    frenzy: { perSwing: 0.14, maxStacks: 8, resetAfter: 0.6 },
    level: { hp: 0.08, dmg: 0.08, copiesToLevel: [5, 10, 20, 40, 80, 90, 140, 200, 300], goldToLevel: [6e3, 12e3, 24e3, 48e3, 72e3, 11e4, 17e4, 26e4, 4e5] },
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
    if (s.hand.length >= 2 && new Set(s.hand).size === s.hand.length) {
      const k = Math.floor(s.rng.next() * (s.hand.length - 1));
      s.hand[s.hand.length - 1] = s.hand[k];
      log(s, `starting hand: last card became a copy of ${s.hand[k]} so a merge is possible`);
    }
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
      army.push({ soul, star, boss: true });
      left -= COST[soul][star - 1] + Math.round(bossExtraCost(COST[soul][star - 1]));
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
      power: { easy: 1, normal: 1.1, hard: 0.98, nightmare: 1.28 },
      rec: { easy: 2, normal: 4, hard: 6, nightmare: 8 }
    },
    {
      id: "bastion",
      name: "The Bone Bastion",
      blurb: "A fortress of the fallen. Only well-levelled armies hold the gate.",
      lists: BASTION,
      power: { easy: 1, normal: 0.97, hard: 1.25, nightmare: 1.45 },
      rec: { easy: 4, normal: 6, hard: 8, nightmare: 10 }
    }
  ];
  var stageIndex = (id) => Math.max(0, STAGES.findIndex((s) => s.id === id));
  var stageById = (id) => STAGES[stageIndex(id)];
  var difficultyName = "normal";
  var currentStageId = "crypt";
  var power = 1;
  var endlessMode = false;
  var bossStr = 1;
  var bossStrength = () => bossStr;
  var BOSS_BY_TIER = { easy: 0.2, normal: 0.5, hard: 0.8, nightmare: 1 };
  var dailyRewrite = null;
  var enemyPower = (wave = 1) => endlessMode ? endlessPower(wave) : power;
  var isEndless = () => endlessMode;
  var AUTHORED = DIFFICULTY.normal.map(parseWave);
  function setStageDifficulty(stage, name) {
    var _a;
    const st = stageById(stage);
    if (!DIFFS.includes(name)) return;
    endlessMode = false;
    dailyRewrite = null;
    bossStr = (_a = BOSS_BY_TIER[name]) != null ? _a : 0.5;
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
    bossStr = 1;
    currentStageId = ENDLESS_ID;
    difficultyName = "endless";
    power = 1;
    AUTHORED.length = 0;
  }
  function setDifficulty(name) {
    setStageDifficulty(currentStageId, name);
  }
  var waveCost = (w) => w.reduce((n, e) => n + COST[e.soul][e.star - 1], 0);
  function markBoss(w) {
    let best = -1, bs = -1;
    w.forEach((e, i) => {
      const brute = e.soul === "ogre" || e.soul === "knight" || e.soul === "barbarian" ? 100 : 0, sc = brute + COST[e.soul][e.star - 1];
      if (sc > bs) {
        bs = sc;
        best = i;
      }
    });
    if (best >= 0) {
      w[best] = { ...w[best], boss: true };
      const extra = Math.round(bossExtraCost(COST[w[best].soul][w[best].star - 1]));
      let removed = 0;
      const order = w.map((e, i) => i).filter((i) => i !== best).sort((a, b) => COST[w[a].soul][w[a].star - 1] - COST[w[b].soul][w[b].star - 1]);
      const drop = /* @__PURE__ */ new Set();
      for (const i of order) {
        const c = COST[w[i].soul][w[i].star - 1];
        if (removed + c <= extra + 1 && drop.size < order.length - 1) {
          drop.add(i);
          removed += c;
        }
      }
      return w.filter((_, i) => !drop.has(i));
    }
    return w;
  }
  var bossExtraCost = (cost2) => cost2 * ((1 + 0.6 * bossStr) * (1 + 0.2 * bossStr) - 1);
  function enemyWave(wave, stageSeed = 0) {
    if (endlessMode) return endlessWave(wave, stageSeed);
    if (wave <= AUTHORED.length) {
      let w = AUTHORED[wave - 1].map((e) => ({ ...e }));
      if (dailyRewrite) w = dailyRewrite(w, wave);
      return wave === AUTHORED.length ? markBoss(w) : w;
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
      const k = e.soul + e.star + (e.boss ? "B" : "");
      const cur = map.get(k);
      if (cur) cur.count++;
      else map.set(k, { soul: e.soul, star: e.star, count: 1, boss: e.boss });
    }
    return [...map.values()];
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
  var BOSS = { hp: 0.6, dmg: 0.2, size: 1.3 };
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
      enemies.forEach((e, i) => this.add(1, e.soul, e.star, cells[i], 1, !!e.boss));
    }
    add(team, soul, star, cell, level = 1, boss = false) {
      var _a, _b;
      const B = BALANCE, st = B.stats[soul], p = cellPos(team, cell);
      const lvHp = 1 + (Math.max(1, level) - 1) * B.level.hp, lvDmg = 1 + (Math.max(1, level) - 1) * B.level.dmg;
      const pw = team === 1 ? this.enemyPower : 1;
      const hp = st.hp * B.star.hp[star - 1] * lvHp * pw * (boss ? 1 + BOSS.hp * bossStrength() : 1);
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
        dmg: st.dmg * B.star.dmg[star - 1] * lvDmg * pw * (boss ? 1 + BOSS.dmg * bossStrength() : 1),
        interval: st.interval,
        range: st.range,
        speed: st.speed,
        radius: st.size * B.star.scale[star - 1],
        // (a boss only LOOKS bigger: a larger collision radius would keep melee units out of reach)
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
        deadAt: 0,
        boss
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
    return { v: VERSION, deck: SOULS.slice(0, DECK_SIZE), souls, settings: { music: true, sfx: true }, difficulty: "normal", stage: "crypt", seen: [], packs: [], nextPackId: 1, clears: {}, replayMeter: 0, endless: { best: 0 }, goldScale: 2, gold: 0, daily: null, dailyStreak: { count: 0, last: 0 }, dailyWins: 0, claimed: [] };
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
    if (raw.dailyStreak && Number.isInteger(raw.dailyStreak.count) && raw.dailyStreak.count >= 0 && raw.dailyStreak.count < 1e5 && Number.isInteger(raw.dailyStreak.last) && raw.dailyStreak.last >= 0 && raw.dailyStreak.last < 1e6) base.dailyStreak = { count: raw.dailyStreak.count, last: raw.dailyStreak.last };
    if (Number.isInteger(raw.dailyWins) && raw.dailyWins >= 0 && raw.dailyWins < 1e5) base.dailyWins = raw.dailyWins;
    if (Array.isArray(raw.claimed)) base.claimed = [...new Set(raw.claimed.filter((k) => typeof k === "string" && k.length < 40))].slice(0, 80);
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
    replayTier: { easy: 1, normal: 1, hard: 2, nightmare: 2 },
    // every clear pays a pack; harder tiers pay better
    replayClearsPerPack: 1
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
    if (before === 0) return { first: true, pack: grantPack(save, REWARDS.firstClearTier[difficulty] + (stageIndex(stageId) === STAGES.length - 1 ? 1 : 0), "First clear \xB7 " + difficulty), replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
    save.replayMeter++;
    let pack = null;
    if (save.replayMeter >= REWARDS.replayClearsPerPack) {
      save.replayMeter -= REWARDS.replayClearsPerPack;
      pack = grantPack(save, REWARDS.replayTier[difficulty], "Replay reward");
    }
    return { first: false, pack, replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
  }
  function recordClearAndSave(stageId, difficulty, store) {
    const s = loadSave(store);
    const r = recordClear(s, stageId, difficulty);
    writeSave(s, store);
    return r;
  }
  var dailyStreakNow = (save, day) => save.dailyStreak.last === day || save.dailyStreak.last === day - 1 ? save.dailyStreak.count : 0;
  var dailyPackTier = (streak) => streak >= 7 ? 3 : streak >= 3 ? 2 : 1;
  function recordDailyWin(save, day) {
    if (save.daily && save.daily.day === day && save.daily.won) return { first: false, pack: null, gold: 0, streak: dailyStreakNow(save, day) };
    const streak = save.dailyStreak.last === day - 1 ? save.dailyStreak.count + 1 : 1;
    save.daily = { day, won: true };
    save.dailyStreak = { count: streak, last: day };
    save.dailyWins++;
    return { first: true, pack: grantPack(save, dailyPackTier(streak), "Daily challenge"), gold: addGold(save, GOLD.dailyWin + 1e3 * (Math.min(streak, 7) - 1)), streak };
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
      lvTex: {},
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
      ["ogre", "Ogre.glb", "Ogre_enemy.jpg", { idle: "Idle", run: "Run", attack: "Attack", death: "Death", spawn: "Spawn", cheer: "Cheer" }, 1.02, 1.12, { starScale: [1, 1.3, 1.65], flavor: { clips: [{ clip: "Yawn", emote: "zzz" }, { clip: "Shrug" }, { clip: "Stomp", emote: "!" }, { clip: "Thump" }], min: 9, max: 16 }, cheers: [{ clip: "Cheer" }, { clip: "Thump", emote: "!" }, { clip: "Stomp", emote: "!" }], spawnEmote: "zzz", eyes: "Ogre_eyes.png" }]
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
      __publicField(this, "lv");
      __publicField(this, "lvN", 0);
      __publicField(this, "barOn", false);
      __publicField(this, "tag", null);
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
      this.lv = BABYLON.MeshBuilder.CreatePlane("lv", { width: 0.36, height: 0.135 }, s);
      this.lv.parent = this.badge;
      this.lv.position.set(-0.52, 0, 0);
      this.lv.isPickable = false;
      this.lv.setEnabled(false);
      const lm = new BABYLON.StandardMaterial("lvm", s);
      lm.emissiveColor = BABYLON.Color3.White();
      lm.disableLighting = true;
      lm.useAlphaFromDiffuseTexture = true;
      this.lv.material = lm;
      this.bar.setEnabled(false);
      this.fill.setEnabled(false);
      this.mbg.setEnabled(false);
      this.mfill.setEnabled(false);
    }
    /** A red BOSS tag above the stars. */
    setBoss(on) {
      if (!on) {
        if (this.tag) this.tag.setEnabled(false);
        return;
      }
      if (!this.tag) {
        const A = this.A, t = BABYLON.MeshBuilder.CreatePlane("bosstag", { width: 0.5, height: 0.17 }, A.scene);
        t.parent = this.badge;
        t.position.set(0, 0.29, 0);
        t.isPickable = false;
        const m = new BABYLON.StandardMaterial("bosstagm", A.scene);
        m.emissiveColor = BABYLON.Color3.White();
        m.disableLighting = true;
        m.useAlphaFromDiffuseTexture = true;
        m.diffuseTexture = dyn(A.scene, 192, 64, (c) => {
          c.font = "900 46px sans-serif";
          c.textAlign = "center";
          c.lineWidth = 8;
          c.strokeStyle = "#2a0508";
          c.fillStyle = "#ff5b4a";
          c.lineJoin = "round";
          c.strokeText("BOSS", 96, 48);
          c.fillText("BOSS", 96, 48);
        });
        t.material = m;
        this.tag = t;
      }
      this.tag.setEnabled(true);
    }
    /** "LV n" beside the health bar (permanent Soul level); 0 hides it. */
    setLevel(n) {
      this.lvN = n;
      if (!this.lv) return;
      if (n <= 0 || !this.barOn) {
        this.lv.setEnabled(false);
        if (n > 0) this.ensureLv(n);
        return;
      }
      this.ensureLv(n);
      this.lv.setEnabled(true);
    }
    ensureLv(n) {
      const A = this.A;
      if (!A.lvTex[n]) A.lvTex[n] = dyn(A.scene, 128, 48, (c) => {
        c.font = "bold 34px sans-serif";
        c.textAlign = "center";
        c.lineWidth = 6;
        c.strokeStyle = "#150d26";
        c.fillStyle = "#e8d8ff";
        c.lineJoin = "round";
        c.strokeText("LV " + n, 64, 36);
        c.fillText("LV " + n, 64, 36);
      });
      this.lv.material.diffuseTexture = A.lvTex[n];
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
      this.barOn = on;
      if (this.lv) this.lv.setEnabled(on && this.lvN > 0);
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
      __publicField(this, "bossK", 1);
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
    /** The inspect view: which animations this unit has, and a way to play any one of them. */
    clipNames() {
      return Object.keys(this.anims).filter((n) => n !== "Walk" && n !== "Hit");
    }
    previewClip(name) {
      var _a;
      const g2 = this.anims[name];
      if (!g2) return;
      if (name === "Idle") {
        this.play("idle");
        return;
      }
      this.queued = false;
      if (this.cur) this.cur.stop();
      g2.stop();
      g2.start(false, 1, g2.from, g2.to);
      this.cur = g2;
      this.flavorOn = true;
      this.state = "idle";
      this.idleT = 0;
      const pose = [...((_a = this.cfg.flavor) == null ? void 0 : _a.clips) || [], ...this.cfg.cheers || []].find((p) => p.clip === name);
      if (pose && pose.emote) {
        this.emote(pose.emote, 0.4);
        if (pose.emote === "zzz") this.emote(pose.emote, 1.2);
      }
      if (VOCAL.has(name) || name === "Cheer" || name === "Attack") audio.bark(this.soulId, 0.2);
    }
    sc(st) {
      return (this.cfg.starScale || BALANCE.star.scale)[st - 1] * this.bossK;
    }
    setBoss(on) {
      this.bossK = on ? 1.3 : 1;
      this.holder.scaling.setAll(this.sc(this.star) * this.base);
      this.deco.fit(this.sc(this.star) * this.base);
      this.deco.setBoss(on);
    }
    setHp(f) {
      this.deco.setHp(f);
    }
    setLevel(n) {
      this.deco.setLevel(n);
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
    setLevel(n) {
      this.deco.setLevel(n);
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
      $("enemy").innerHTML = `<b>Next enemies</b>` + pv.map((p) => `<div class="erow"><span>${ICON[p.soul]}</span><span>${SOUL_NAME[p.soul]}${p.boss ? ' <b style="color:#ff7b6a">BOSS</b>' : ""}</span><span class="x">\xD7${p.count}</span><span class="st">${stars(p.star)}</span></div>`).join("") + `<div class="hint">Positions stay hidden until the battle.</div>`;
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
        const dailyHtml = g2.daily ? dr ? `<div class="sub" style="color:#ffd24a;font-weight:700">${dr.pack ? `${iconImg("shop")} Daily complete! Day ${dr.streak} in a row: a ${sk(dr.pack.tier)} Soul Pack and ${fmt(dr.gold)} ${iconImg("gold")}.` : "Daily complete again. The reward comes once per day: see you tomorrow!"}</div>` : "" : "";
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
      // -------------------------------------------------------------------------------------------- inspect (the Souls page's 3D look at one Soul)
      __publicField(this, "inspecting", null);
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
        if (this.inspecting) this.frameInspect(dt);
        else if (!this.frozen) this.frame(dt);
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
    /** Show one Soul on its own on the arena floor: slow turntable, buttons for every animation it has, star sizes and the enemy colours. */
    inspect(soul) {
      if (!this.A || this.inspecting) return;
      const hidden = [];
      const hide = (n) => {
        if (n && n.isEnabled && n.isEnabled()) {
          n.setEnabled(false);
          hidden.push(n);
        }
      };
      for (const v2 of this.unitVis.values()) hide(v2.holder);
      this.fvis.forEach((v2) => hide(v2.holder));
      if (this.necro.holder.isEnabled()) {
        this.necro.setEnabled(false);
        hidden.push({ setEnabled: (on) => this.necro.setEnabled(on) });
      }
      this.ringFx.forEach((r) => hide(r.m));
      this.arrows.forEach((a) => hide(a.mesh));
      const grid = this.tiles.length > 0 && this.tiles[0].isEnabled();
      this.showGrid(false);
      const v = createVisual(this.A, soul, 0, 1);
      const P = { x: -6, z: 0 };
      v.holder.position.set(P.x, 0, P.z);
      v.holder.rotation.y = Math.PI * 0.85;
      v.play("idle");
      this.inspecting = { soul, v, star: 1, team: 0, spin: true, hidden, grid };
      document.body.classList.add("inspect");
      this.camera.fov = 0.62;
      this.camera.position.set(P.x, 1.15, P.z - 3.5);
      this.camera.setTarget(new BABYLON.Vector3(P.x, 0.56, P.z));
      this.renderInspectBar();
    }
    endInspect() {
      const i = this.inspecting;
      if (!i) return;
      i.v.dispose();
      i.hidden.forEach((n) => n.setEnabled(true));
      this.showGrid(i.grid && this.phase === "build");
      this.inspecting = null;
      document.body.classList.remove("inspect");
      const bar = document.getElementById("inspectbar");
      if (bar) bar.innerHTML = "";
      this.camera.fov = 0.8;
      this.setCam(this.poses().build);
    }
    frameInspect(dt) {
      const i = this.inspecting;
      i.v.update(dt);
      if (i.spin) i.v.holder.rotation.y += dt * 0.45;
      this.arena.update(performance.now() / 1e3);
    }
    renderInspectBar() {
      const i = this.inspecting;
      const bar = document.getElementById("inspectbar");
      if (!i || !bar) return;
      const nice = (n) => {
        var _a;
        return (_a = { Spawn: "Arrival", Attack: "Attack", Cheer: "Cheer", Death: "Fall" }[n]) != null ? _a : n.replace(/([a-z])([A-Z])/g, "$1 $2");
      };
      const clips = (i.v.clipNames ? i.v.clipNames() : []).map((n) => `<button data-clip="${n}">${nice(n)}</button>`).join("");
      bar.innerHTML = `<div class="ib"><button id="ibBack" class="go">Back</button><b class="ibt">${SOUL_NAME[i.soul]}</b>${[1, 2, 3].map((n) => `<button data-star="${n}" class="${i.star === n ? "on" : ""}">${n}\u2605</button>`).join("")}<button id="ibTeam" class="${i.team ? "on" : ""}">Enemy colours</button><button id="ibSpin" class="${i.spin ? "on" : ""}">Turn</button></div><div class="ib ibc">${clips}</div>`;
      bar.querySelectorAll("[data-clip]").forEach((b) => b.onclick = () => {
        audio.play("tap");
        i.v.previewClip && i.v.previewClip(b.dataset.clip);
      });
      bar.querySelectorAll("[data-star]").forEach((b) => b.onclick = () => {
        i.star = +b.dataset.star;
        i.v.setStar(i.star);
        this.renderInspectBar();
      });
      document.getElementById("ibTeam").onclick = () => {
        i.team = i.team ? 0 : 1;
        i.v.setTeam(i.team);
        this.renderInspectBar();
      };
      document.getElementById("ibSpin").onclick = () => {
        i.spin = !i.spin;
        this.renderInspectBar();
      };
      document.getElementById("ibBack").onclick = () => window.dispatchEvent(new Event("necro-go-souls"));
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
      var _a, _b;
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
      const lvls = loadSave().souls;
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
      for (const u of this.s.units) {
        const vv = this.unitVis.get(u.id);
        if (vv && vv.setLevel) vv.setLevel((_b = (_a = lvls[u.soul]) == null ? void 0 : _a.level) != null ? _b : 1);
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
          if (f.boss && v.setBoss) v.setBoss(true);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2dhbWUvYXJlbmEudHMiLCAiLi4vY29yZS9lbmRsZXNzLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9iYXR0bGUudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9kYWlseS50cyIsICIuLi9jb3JlL3BhY2tzLnRzIiwgIi4uL2NvcmUvc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvbmVjcm9tYW5jZXIudHMiLCAiLi4vZ2FtZS9hdWRpby50cyIsICIuLi9jb3JlL3J1bnNhdmUudHMiLCAiLi4vZ2FtZS92aXN1YWxzLnRzIiwgIi4uL3VpL2ljb25zLnRzIiwgIi4uL3VpL3BvcnRyYWl0cy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXTsgZ29sZFRvTGV2ZWw6IG51bWJlcltdIH07XG4gIHNpbTogeyBzZXBhcmF0aW9uOiBudW1iZXI7IGhpdEZyYWN0aW9uOiBudW1iZXI7IHRpbWVMaW1pdDogbnVtYmVyOyByZXRhcmdldEV2ZXJ5OiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRTOiBCYWxhbmNlID0ge1xuICBzdGF0czoge1xuICAgIHdhcnJpb3I6ICAgeyBocDogNjAsICBkbWc6IDgsICBpbnRlcnZhbDogMC45LCByYW5nZTogMC44NSwgc3BlZWQ6IDEuNCwgc2l6ZTogMC4yOCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjQ3IH0sXG4gICAgYXJjaGVyOiAgICB7IGhwOiA0MCwgIGRtZzogNywgIGludGVydmFsOiAxLjcsIHJhbmdlOiA1LjAsICBzcGVlZDogMS4xLCBzaXplOiAwLjI2LCBhbmltTGVuOiAxLjUsIGhpdEZyYWM6IDAuNzggfSxcbiAgICBnb2JsaW46ICAgIHsgaHA6IDQ1LCAgZG1nOiA5LCAgaW50ZXJ2YWw6IDAuOCwgcmFuZ2U6IDAuOCwgIHNwZWVkOiAxLjcsIHNpemU6IDAuMjQsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAga25pZ2h0OiAgICB7IGhwOiAxMzAsIGRtZzogOSwgIGludGVydmFsOiAxLjEsIHJhbmdlOiAwLjksICBzcGVlZDogMS4wLCBzaXplOiAwLjMyLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIG9ncmU6ICAgICAgeyBocDogMTcwLCBkbWc6IDE2LCBpbnRlcnZhbDogMS45LCByYW5nZTogMS4wNSwgc3BlZWQ6IDAuOCwgc2l6ZTogMC40MiwgYW5pbUxlbjogMS4yLCBoaXRGcmFjOiAwLjU1IH0sXG4gICAgYmFyYmFyaWFuOiB7IGhwOiAxMTAsIGRtZzogMTIsIGludGVydmFsOiAwLjksIHJhbmdlOiAwLjksIHNwZWVkOiAxLjUsIHNpemU6IDAuMzAsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gIH0sXG4gIC8vIFwiYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHlcIjogSFAgZ3Jvd3MgZmFzdGVyIHRoYW4gZGFtYWdlIHBlciBzdGFyXG4gIHN0YXI6IHsgaHA6IFsxLCAyLjAsIDMuMl0sIGRtZzogWzEsIDEuNSwgMi4wXSwgc2NhbGU6IFsxLCAxLjEyLCAxLjI1XSB9LFxuICBwaGFsYW54OiB7IHJhZGl1czogMi4wLCBwZXJBbGx5OiAwLjA4LCBtYXhTdGFja3M6IDMgfSxcbiAgLy8gbWFuYSBmaWxscyBmYXN0OiBhIGJhc2ljIGF0dGFjayBnaXZlcyBwZXJBdHRhY2ssIHRha2luZyBhIGhpdCBnaXZlcyBwZXJIaXQ7IGEgZnVsbCBiYXIgZmlyZXMgdGhlIHNraWxsIG9uIHRoZSBuZXh0IGF0dGFjaywgdGhlbiByZXNldHNcbiAgbWFuYToge1xuICAgIGFyY2hlcjogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTcGxpdCBBcnJvdyBhYm91dCBldmVyeSAzcmQgc2hvdFxuICAgIG9ncmU6ICAgeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTbWFzaCBhYm91dCBldmVyeSAzcmQgc3dpbmdcbiAgICBrbmlnaHQ6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMjUsIHBlckhpdDogMTIgfSwgICAgLy8gVGF1bnQgZXZlcnkgfjQgc3dpbmdzLCBzb29uZXIgd2hlbiBoZSBpcyBiZWluZyBoaXRcbiAgfSxcbiAgdm9sbGV5OiB7IHRhcmdldHM6IDMsIHByb2plY3RpbGVTcGVlZDogMTQgfSxcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IDAuNSwgc2Vla1JhZGl1czogNC4wLCB3b3VuZGVkV2VpZ2h0OiAxLjUgfSxcbiAgdGF1bnQ6IHsgZHVyYXRpb246IDMsIHJhZGl1czogNC41IH0sXG4gIHNtYXNoOiB7IG11bHQ6IDIuMCwgcmFkaXVzOiAxLjYgfSxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiAwLjE0LCBtYXhTdGFja3M6IDgsIHJlc2V0QWZ0ZXI6IDAuNiB9LFxuICBsZXZlbDogeyBocDogMC4wOCwgZG1nOiAwLjA4LCBjb3BpZXNUb0xldmVsOiBbNSwgMTAsIDIwLCA0MCwgODAsIDkwLCAxNDAsIDIwMCwgMzAwXSwgZ29sZFRvTGV2ZWw6IFs2MDAwLCAxMjAwMCwgMjQwMDAsIDQ4MDAwLCA3MjAwMCwgMTEwMDAwLCAxNzAwMDAsIDI2MDAwMCwgNDAwMDAwXSB9LFxuICBzaW06IHsgc2VwYXJhdGlvbjogMC42LCBoaXRGcmFjdGlvbjogMC40NywgdGltZUxpbWl0OiAxMjAsIHJldGFyZ2V0RXZlcnk6IDAuNSB9LFxufTtcblxuZXhwb3J0IGNvbnN0IEJBTEFOQ0U6IEJhbGFuY2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNldEJhbGFuY2UoKTogdm9pZCB7XG4gIGNvbnN0IGZyZXNoOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoZnJlc2gpIGFzIChrZXlvZiBCYWxhbmNlKVtdKSAoQkFMQU5DRSBhcyBhbnkpW2tdID0gKGZyZXNoIGFzIGFueSlba107XG59XG5cbmV4cG9ydCBjb25zdCBST0xFX1RFWFQ6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdDaGVhcCBhbmQgZmFzdC4gVG91Z2hlciBuZWFyIG90aGVyIFdhcnJpb3JzLicsXG4gIGFyY2hlcjogJ0ZyYWdpbGUuIFNraWxsOiBTcGxpdCBBcnJvdyBoaXRzIDMgZGlmZmVyZW50IGVuZW1pZXMuJyxcbiAgZ29ibGluOiAnRmFzdC4gSGl0cyBoYXJkZXIgb24gZW5lbWllcyBmaWdodGluZyBzb21lb25lIGVsc2UuJyxcbiAga25pZ2h0OiAnVGFuay4gU2tpbGw6IFRhdW50IHB1bGxzIGVuZW1pZXMgb250byBoaW0uJyxcbiAgb2dyZTogJ1Nsb3csIGh1Z2UgZGFtYWdlLiBTa2lsbDogU21hc2gsIGEgYmlnIGFyZWEgc2xhbS4nLFxuICBiYXJiYXJpYW46ICdTd2luZ3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBoaXQuJyxcbn07XG5cbmV4cG9ydCBjb25zdCBTT1VMX05BTUU6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdTa2VsZXRvbiBXYXJyaW9yJywgYXJjaGVyOiAnU2tlbGV0b24gQXJjaGVyJywgZ29ibGluOiAnR29ibGluJyxcbiAga25pZ2h0OiAnS25pZ2h0Jywgb2dyZTogJ09ncmUnLCBiYXJiYXJpYW46ICdCYXJiYXJpYW4nLFxufTtcblxuLyoqIEFiaWxpdHkgYmx1cmJzIGZvciB0aGUgU291bHMgcGFnZSwgd2l0aCB0aGUgbGl2ZSBudW1iZXJzIGZpbGxlZCBpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhYmlsaXR5SW5mbyhzb3VsOiBTb3VsSWQpOiB7IGtpbmQ6ICdza2lsbCcgfCAncGFzc2l2ZSc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nIH0ge1xuICBjb25zdCBCID0gQkFMQU5DRSwgcGN0ID0gKHg6IG51bWJlcikgPT4gTWF0aC5yb3VuZCh4ICogMTAwKSArICclJztcbiAgc3dpdGNoIChzb3VsKSB7XG4gICAgY2FzZSAnd2Fycmlvcic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ1BoYWxhbngnLCB0ZXh0OiBgVGFrZXMgJHtwY3QoQi5waGFsYW54LnBlckFsbHkpfSBsZXNzIGRhbWFnZSBmb3IgZWFjaCBvdGhlciBTa2VsZXRvbiBXYXJyaW9yIHdpdGhpbiAke0IucGhhbGFueC5yYWRpdXN9bSAodXAgdG8gJHtCLnBoYWxhbngubWF4U3RhY2tzfSkuYCB9O1xuICAgIGNhc2UgJ2dvYmxpbic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ09wcG9ydHVuaXN0JywgdGV4dDogYERlYWxzICR7cGN0KEIub3Bwb3J0dW5pc3QuYm9udXMpfSBtb3JlIGRhbWFnZSB0byBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZSwgYW5kIHByZWZlcnMgc3VjaCB0YXJnZXRzLmAgfTtcbiAgICBjYXNlICdiYXJiYXJpYW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdGcmVuenknLCB0ZXh0OiBgQXR0YWNrcyAke3BjdChCLmZyZW56eS5wZXJTd2luZyl9IGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmcgKHVwIHRvICR7Qi5mcmVuenkubWF4U3RhY2tzfSB0aW1lcykuYCB9O1xuICAgIGNhc2UgJ2FyY2hlcic6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTcGxpdCBBcnJvdycsIHRleHQ6IGBCYXNpYyBzaG90cyBmaXJlIG9uZSBhcnJvdy4gV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHNob3QgZmlyZXMgYXQgdXAgdG8gJHtCLnZvbGxleS50YXJnZXRzfSBkaWZmZXJlbnQgZW5lbWllcy5gIH07XG4gICAgY2FzZSAna25pZ2h0JzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1RhdW50JywgdGV4dDogYFdoZW4gbWFuYSBpcyBmdWxsLCBlbmVtaWVzIHdpdGhpbiAke0IudGF1bnQucmFkaXVzfW0gbXVzdCBhdHRhY2sgaGltIGZvciAke0IudGF1bnQuZHVyYXRpb259cy5gIH07XG4gICAgY2FzZSAnb2dyZSc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTbWFzaCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgdGhlIG5leHQgc3dpbmcgZGVhbHMgJHtCLnNtYXNoLm11bHR9eCBkYW1hZ2UgYW5kIGhpdHMgZW5lbWllcyBuZWFyIHRoZSB0YXJnZXQgZm9yIDYwJSBhcyBtdWNoLmAgfTtcbiAgfVxufVxuIiwgIi8vIERlc2lnbiBkYXRhIHN0cmFpZ2h0IGZyb20gdGhlIHBsYW4gZG9jLiBBbnl0aGluZyBtYXJrZWQgUExBQ0VIT0xERVIgaXMgbm90IGluIHRoZSBkb2MgeWV0LlxuXG5leHBvcnQgdHlwZSBTb3VsSWQgPSAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJztcblxuZXhwb3J0IGNvbnN0IFNPVUxTOiBTb3VsSWRbXSA9IFsnd2FycmlvcicsICdhcmNoZXInLCAnZ29ibGluJywgJ2tuaWdodCcsICdvZ3JlJywgJ2JhcmJhcmlhbiddO1xuXG4vKiogRG9taW5pb24gY29zdCBwZXIgc3RhciBsZXZlbDogaW5kZXggMCA9IDEgc3RhciwgMSA9IDIgc3RhcnMsIDIgPSAzIHN0YXJzICgzIHN0YXJzIGlzIHRoZSBtYXgpLiAqL1xuZXhwb3J0IGNvbnN0IENPU1Q6IFJlY29yZDxTb3VsSWQsIG51bWJlcltdPiA9IHtcbiAgd2FycmlvcjogWzIsIDMsIDRdLFxuICBhcmNoZXI6IFs0LCA2LCA5XSxcbiAgZ29ibGluOiBbMywgNCwgNl0sXG4gIGtuaWdodDogWzUsIDcsIDEwXSxcbiAgb2dyZTogWzcsIDEwLCAxNV0sXG4gIGJhcmJhcmlhbjogWzUsIDcsIDEwXSwgLy8gUExBQ0VIT0xERVI6IHRoZSBkb2MgaGFzIG5vIGNvc3QgZm9yIHRoZSBzaXh0aCBTb3VsIHlldFxufTtcblxuZXhwb3J0IGNvbnN0IE1BWF9TVEFSID0gMztcbmV4cG9ydCBjb25zdCBHUklEX0NFTExTID0gMTI7IC8vIDQgeCAzXG5cbi8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUgKGluZGV4IDAgPSB3YXZlIDEpLiAqL1xuZXhwb3J0IGNvbnN0IENVUlZFUzogUmVjb3JkPHN0cmluZywgbnVtYmVyW10+ID0ge1xuICAvLyBMT0NLRUQgKGNvbmZpcm1lZCk6ICs0IGZvciB3YXZlcyAyLTUsIHRoZW4gKzMgZm9yIHdhdmVzIDYtMTAgLT4gNDBcbiAgZG9jOiBbOSwgMTMsIDE3LCAyMSwgMjUsIDI4LCAzMSwgMzQsIDM3LCA0MF0sXG4gIC8vIE5PVCBVU0VEOiBtaXNyZW1lbWJlcmVkIHZhcmlhbnQgKCszIHRocm91Z2ggd2F2ZSA2LCB0aGVuICsyKSB0aGF0IG9ubHkgcmVhY2hlcyAzMi4gS2VwdCBmb3IgY29tcGFyaXNvbiBvbmx5LlxuICByZWNhbGxlZDogWzksIDEyLCAxNSwgMTgsIDIxLCAyNCwgMjYsIDI4LCAzMCwgMzJdLFxufTtcblxuZXhwb3J0IGNvbnN0IEhFQVJUUyA9IDM7XG5leHBvcnQgY29uc3QgU1RBUlRfSEFORCA9IDQ7XG5leHBvcnQgY29uc3QgV0FWRVMgPSAxMDtcblxuZXhwb3J0IGludGVyZmFjZSBSdWxlcyB7XG4gIC8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUuICovXG4gIGN1cnZlOiBudW1iZXJbXTtcbiAgLyoqXG4gICAqICdkZXBsb3llZE9ubHknOiBvbmx5IHR3byBkZXBsb3llZCB1bml0cyBvZiB0aGUgc2FtZSBzdGFyIGNhbiBtZXJnZSAoZG9jIGFzIHdyaXR0ZW4pLlxuICAgKiAnaGFuZEludG9PbmVTdGFyJzogYWRkaXRpb25hbGx5IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gYmUgcGxheWVkIG9udG8gYSBkZXBsb3llZFxuICAgKiAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsIHRvIG1lcmdlIGltbWVkaWF0ZWx5IChwYXlzIG9ubHkgdGhlIGNvc3QgZGlmZmVyZW5jZSkuXG4gICAqL1xuICBtZXJnZTogJ2RlcGxveWVkT25seScgfCAnaGFuZEludG9PbmVTdGFyJztcbiAgLyoqIENhcmQtaW5mbG93IGtub2JzIChhbGwgb3B0aW9uYWw7IGRlZmF1bHRzIHJlcHJvZHVjZSB0aGUgZG9jKS4gKi9cbiAgc3RhcnRIYW5kPzogbnVtYmVyOyAgICAgICAgICAgIC8vIGRlZmF1bHQgNFxuICBkcmFmdFBpY2tzPzogbnVtYmVyOyAgICAgICAgICAgLy8gY2FyZHMga2VwdCBmcm9tIHRoZSAzLWNhcmQgVmljdG9yeSBEcmFmdCwgZGVmYXVsdCAxXG4gIG5vcm1hbERyYXdXYXZlcz86IG51bWJlcltdOyAgICAvLyB3YXZlcyAoYmVpbmcgZW50ZXJlZCkgdGhhdCBhbHNvIGdpdmUgdGhlIG5vcm1hbCByYW5kb20gZHJhdzsgZGVmYXVsdCA9IGFsbFxuICAvKiogU291bHMgdGhpcyBydW4gbWF5IGRyYXcgZnJvbSAodGhlIGVxdWlwcGVkIFNvdWwgRGVjaywgbWF4IDYpLiBEZWZhdWx0OiBldmVyeSBTb3VsLiAqL1xuICBwb29sPzogU291bElkW107XG4gIHN0YWdlV2F2ZXM/OiBudW1iZXI7ICAgICAgICAgICAvLyB3YXZlcyBpbiB0aGlzIHN0YWdlOyBkZWZhdWx0IDEwICh0aGUgcGxheWFibGUgcHJvdG90eXBlIHVzZXMgMylcbn1cblxuZXhwb3J0IGNvbnN0IEdSSURfQ09MUyA9IDQsIEdSSURfUk9XUyA9IDM7ICAgLy8gNCB4IDMgPSBHUklEX0NFTExTOyBjb2x1bW4gR1JJRF9DT0xTLTEgaXMgdGhlIGZyb250IGxpbmVcbiIsICIvLyBTbWFsbCBzZWVkZWQgUk5HIChtdWxiZXJyeTMyKS4gU2FtZSBzZWVkIC0+IHNhbWUgcnVuLCBzbyBhbnkgYnVnIHJlcG9ydCBpcyByZXByb2R1Y2libGUuXG4vLyBgc3RhdGUoKWAgLyB0aGUgYHJlc3VtZWAgYXJndW1lbnQgbGV0IGEgc2F2ZWQgcnVuIGNvbnRpbnVlIGRyYXdpbmcgZXhhY3RseSB0aGUgY2FyZHMgaXQgd291bGQgaGF2ZSBkcmF3bi5cblxuZXhwb3J0IGludGVyZmFjZSBSbmcge1xuICBuZXh0KCk6IG51bWJlcjsgICAgICAgICAgICAgIC8vIFswLCAxKVxuICBpbnQobjogbnVtYmVyKTogbnVtYmVyOyAgICAgIC8vIFswLCBuKVxuICBwaWNrPFQ+KGl0ZW1zOiByZWFkb25seSBUW10pOiBUO1xuICBzZWVkOiBudW1iZXI7XG4gIHN0YXRlKCk6IG51bWJlcjsgICAgICAgICAgICAgLy8gdGhlIGdlbmVyYXRvcidzIGN1cnJlbnQgcG9zaXRpb24sIGZvciBzYXZpbmcgYSBydW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSbmcoc2VlZDogbnVtYmVyLCByZXN1bWU/OiBudW1iZXIpOiBSbmcge1xuICBsZXQgYSA9IChyZXN1bWUgPz8gc2VlZCkgPj4+IDA7XG4gIGNvbnN0IG5leHQgPSAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBhO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBzZWVkLFxuICAgIG5leHQsXG4gICAgaW50OiAobikgPT4gTWF0aC5mbG9vcihuZXh0KCkgKiBuKSxcbiAgICBwaWNrOiAoaXRlbXMpID0+IGl0ZW1zW01hdGguZmxvb3IobmV4dCgpICogaXRlbXMubGVuZ3RoKV0sXG4gICAgc3RhdGU6ICgpID0+IGEsXG4gIH07XG59XG4iLCAiLy8gUHVyZSBnYW1lIHJ1bGVzIGZvciBvbmUgc3RhZ2UuIE5vIGdyYXBoaWNzLCBubyBjb21iYXQ6IGp1c3QgY2FyZHMsIERvbWluaW9uLCBncmlkLCBtZXJnZSwgd2F2ZXMsIGhlYXJ0cy5cbi8vIEV2ZXJ5IG11dGF0aW9uIGdvZXMgdGhyb3VnaCBhIGZ1bmN0aW9uIGhlcmUgYW5kIGFwcGVuZHMgdG8gc3RhdGUubG9nLCBzbyBydW5zIGNhbiBiZSByZXBsYXllZCBhbmQgaW5zcGVjdGVkLlxuXG5pbXBvcnQgeyBDT1NULCBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUywgU1RBUlRfSEFORCwgV0FWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0IHsgaWQ6IG51bWJlcjsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjsgZnJlc2g/OiBib29sZWFuIH0gICAvLyBmcmVzaCA9IHN1bW1vbmVkIHRoaXMgYnVpbGQgcGhhc2VcblxuZXhwb3J0IGludGVyZmFjZSBTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlcztcbiAgcm5nOiBSbmc7XG4gIHdhdmU6IG51bWJlcjsgICAgICAgICAgICAgICAgIC8vIDEtYmFzZWRcbiAgaGVhcnRzOiBudW1iZXI7XG4gIGNhcDogbnVtYmVyO1xuICBoYW5kOiBTb3VsSWRbXTtcbiAgdW5pdHM6IFVuaXRbXTtcbiAgbmV4dElkOiBudW1iZXI7XG4gIGRpc2NhcmRVc2VkOiBib29sZWFuOyAgICAgICAgIC8vIG9uY2UtcGVyLWJ1aWxkLXBoYXNlIHJlZHJhd1xuICBzdGF0dXM6ICdidWlsZGluZycgfCAnd29uJyB8ICdsb3N0JztcbiAgbG9nOiBzdHJpbmdbXTtcbiAgc3RhdHM6IHsgZHJhd246IG51bWJlcjsgZGlzY2FyZGVkOiBudW1iZXI7IGRpc21pc3NlZDogbnVtYmVyOyBtZXJnZXM6IG51bWJlcjsgZmFpbHVyZXM6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgY29zdCA9IChzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlcik6IG51bWJlciA9PiBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbmV4cG9ydCBjb25zdCBjYXJkc0luID0gKHN0YXI6IG51bWJlcik6IG51bWJlciA9PiAyICoqIChzdGFyIC0gMSk7ICAgICAvLyBjYXJkcyBhIHVuaXQgaXMgXCJ3b3J0aFwiXG5leHBvcnQgY29uc3QgZG9taW5pb25Vc2VkID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY29zdCh1LnNvdWwsIHUuc3RhciksIDApO1xuZXhwb3J0IGNvbnN0IGRvbWluaW9uRnJlZSA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLmNhcCAtIGRvbWluaW9uVXNlZChzKTtcblxuZnVuY3Rpb24gbG9nKHM6IFN0YXRlLCBtc2c6IHN0cmluZykgeyBzLmxvZy5wdXNoKGBbdyR7cy53YXZlfV0gJHttc2d9YCk7IH1cbi8qKiBUaGUgU291bHMgdGhpcyBydW4gZHJhd3MgZnJvbTogdGhlIGVxdWlwcGVkIGRlY2ssIG9yIGV2ZXJ5dGhpbmcgaWYgbm8gZGVjayB3YXMgZ2l2ZW4uICovXG5leHBvcnQgY29uc3QgcG9vbE9mID0gKHM6IFN0YXRlKTogU291bElkW10gPT4gKHMucnVsZXMucG9vbCAmJiBzLnJ1bGVzLnBvb2wubGVuZ3RoID8gcy5ydWxlcy5wb29sIDogU09VTFMpO1xuZnVuY3Rpb24gZHJhdyhzOiBTdGF0ZSwgd2h5OiBzdHJpbmcsIG5vdD86IFNvdWxJZCk6IFNvdWxJZCB7XG4gIGNvbnN0IGFsbCA9IHBvb2xPZihzKSwgb3RoZXJzID0gbm90ID8gYWxsLmZpbHRlcigoeCkgPT4geCAhPT0gbm90KSA6IGFsbDtcbiAgY29uc3QgcG9vbCA9IG90aGVycy5sZW5ndGggPyBvdGhlcnMgOiBhbGw7ICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHN3YXAgbmV2ZXIgaGFuZHMgeW91IGJhY2sgdGhlIFNvdWwgeW91IGdhdmUgdXAgKHVubGVzcyBpdCBpcyB0aGUgb25seSBvbmUgZXF1aXBwZWQpXG4gIGNvbnN0IGMgPSBzLnJuZy5waWNrKHBvb2wpO1xuICBzLmhhbmQucHVzaChjKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYXcgJHtjfSAoJHt3aHl9KWApO1xuICByZXR1cm4gYztcbn1cblxuLyoqIEEgbmV3IGJ1aWxkIHBoYXNlIGJlZ2luczogdGhlIG9uY2UtcGVyLXBoYXNlIHN3YXAgY29tZXMgYmFjayBhbmQgbm90aGluZyBjb3VudHMgYXMgXCJzdW1tb25lZCB0aGlzIHJvdW5kXCIuICovXG5leHBvcnQgZnVuY3Rpb24gbmV3UGhhc2UoczogU3RhdGUpOiB2b2lkIHtcbiAgcy5kaXNjYXJkVXNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgdS5mcmVzaCA9IGZhbHNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3U3RhZ2UocnVsZXM6IFJ1bGVzLCBzZWVkOiBudW1iZXIpOiBTdGF0ZSB7XG4gIGNvbnN0IHM6IFN0YXRlID0ge1xuICAgIHJ1bGVzLCBybmc6IG1ha2VSbmcoc2VlZCksIHdhdmU6IDEsIGhlYXJ0czogSEVBUlRTLCBjYXA6IHJ1bGVzLmN1cnZlWzBdLCBoYW5kOiBbXSwgdW5pdHM6IFtdLCBuZXh0SWQ6IDEsXG4gICAgZGlzY2FyZFVzZWQ6IGZhbHNlLCBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogW10sXG4gICAgc3RhdHM6IHsgZHJhd246IDAsIGRpc2NhcmRlZDogMCwgZGlzbWlzc2VkOiAwLCBtZXJnZXM6IDAsIGZhaWx1cmVzOiAwIH0sXG4gIH07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgKHJ1bGVzLnN0YXJ0SGFuZCA/PyBTVEFSVF9IQU5EKTsgaSsrKSBkcmF3KHMsICdzdGFydGluZyBoYW5kJyk7XG4gIC8vIE9wZW5pbmctaGFuZCBzYWZlZ3VhcmQ6IG1lcmdpbmcgaXMgdGhlIGhlYXJ0IG9mIHRoZSBnYW1lLCBzbyB0aGUgZmlyc3QgaGFuZCBhbHdheXMgaG9sZHMgYXQgbGVhc3Qgb25lIG1hdGNoaW5nIHBhaXIgKHdpdGggc2l4IFNvdWxzLCBhYm91dCAyOCUgb2YgcmFuZG9tIGhhbmRzIHdvdWxkIG5vdCkuXG4gIGlmIChzLmhhbmQubGVuZ3RoID49IDIgJiYgbmV3IFNldChzLmhhbmQpLnNpemUgPT09IHMuaGFuZC5sZW5ndGgpIHsgY29uc3QgayA9IE1hdGguZmxvb3Iocy5ybmcubmV4dCgpICogKHMuaGFuZC5sZW5ndGggLSAxKSk7IHMuaGFuZFtzLmhhbmQubGVuZ3RoIC0gMV0gPSBzLmhhbmRba107IGxvZyhzLCBgc3RhcnRpbmcgaGFuZDogbGFzdCBjYXJkIGJlY2FtZSBhIGNvcHkgb2YgJHtzLmhhbmRba119IHNvIGEgbWVyZ2UgaXMgcG9zc2libGVgKTsgfVxuICByZXR1cm4gcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZWVDZWxsKHM6IFN0YXRlKTogbnVtYmVyIHtcbiAgY29uc3QgdGFrZW4gPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmICghdGFrZW4uaGFzKGMpKSByZXR1cm4gYztcbiAgcmV0dXJuIC0xO1xufVxuXG4vLyAtLS0tIGJ1aWxkLXBoYXNlIGFjdGlvbnMgKGVhY2ggcmV0dXJucyB0cnVlIHdoZW4gaXQgaGFwcGVuZWQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XTtcbiAgcmV0dXJuIHNvdWwgIT09IHVuZGVmaW5lZCAmJiBmcmVlQ2VsbChzKSA+PSAwICYmIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2VsbEZyZWUoczogU3RhdGUsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICByZXR1cm4gY2VsbCA+PSAwICYmIGNlbGwgPCBHUklEX0NFTExTICYmICFzLnVuaXRzLnNvbWUoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7XG59XG5cbi8qKiBTdW1tb24gYSBoYW5kIGNhcmQgb250byBhIHNwZWNpZmljIGZyZWUgY2VsbCAoZGVmYXVsdDogdGhlIGZpcnN0IGZyZWUgb25lKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgY2VsbD86IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN1bW1vbihzLCBoYW5kSWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoY2VsbCAhPT0gdW5kZWZpbmVkICYmICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdTogVW5pdCA9IHsgaWQ6IHMubmV4dElkKyssIHNvdWwsIHN0YXI6IDEsIGNlbGw6IGNlbGwgPz8gZnJlZUNlbGwocyksIGZyZXNoOiB0cnVlIH07XG4gIHMudW5pdHMucHVzaCh1KTtcbiAgbG9nKHMsIGBzdW1tb24gJHtzb3VsfSAxKiAtPiBjZWxsICR7dS5jZWxsfSAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZURlcGxveWVkKGE6IFVuaXQsIGI6IFVuaXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuaWQgIT09IGIuaWQgJiYgYS5zb3VsID09PSBiLnNvdWwgJiYgYS5zdGFyID09PSBiLnN0YXIgJiYgYS5zdGFyIDwgTUFYX1NUQVI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZURlcGxveWVkKHM6IFN0YXRlLCBhSWQ6IG51bWJlciwgYklkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYUlkKSwgYiA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYklkKTtcbiAgaWYgKCFhIHx8ICFiIHx8ICFjYW5NZXJnZURlcGxveWVkKGEsIGIpKSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigodSkgPT4gdS5pZCAhPT0gYi5pZCk7XG4gIGEuZnJlc2ggPSAhIShhLmZyZXNoIHx8IGIuZnJlc2gpO1xuICBhLnN0YXIrKztcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZSAke2Euc291bH0gJHthLnN0YXIgLSAxfSorJHthLnN0YXIgLSAxfSogLT4gJHthLnN0YXJ9KiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSwgY2VsbHMgJHtzLnVuaXRzLmxlbmd0aH0vJHtHUklEX0NFTExTfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiAnaGFuZEludG9PbmVTdGFyJyBydWxlOiBwbGF5IGEgMS1zdGFyIGNhcmQgb250byBhIGRlcGxveWVkIDEtc3RhciB1bml0IG9mIHRoZSBzYW1lIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5ydWxlcy5tZXJnZSAhPT0gJ2hhbmRJbnRvT25lU3RhcicpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XSwgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCFzb3VsIHx8ICF1IHx8IHUuc291bCAhPT0gc291bCB8fCB1LnN0YXIgIT09IDEpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIGNvc3Qoc291bCwgMikgLSBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5NZXJnZUZyb21IYW5kKHMsIGhhbmRJZHgsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICB1LnN0YXIgPSAyO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlLWZyb20taGFuZCAke3NvdWx9IC0+ICR7dS5zb3VsfSAyKiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkaXNtaXNzKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgZGlzbWlzcyAke3Uuc291bH0gJHt1LnN0YXJ9KiAocGVybWFuZW50bHkgcmVtb3ZlZClgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAxOiBkaXNjYXJkIGEgaGFuZCBjYXJkIGFuZCBkcmF3IGEgcmFuZG9tIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNjYXJkUmVkcmF3KHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMuZGlzY2FyZFVzZWQgfHwgaGFuZElkeCA8IDAgfHwgaGFuZElkeCA+PSBzLmhhbmQubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGMgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNjYXJkZWQrKztcbiAgbG9nKHMsIGBzd2FwOiBkaXNjYXJkICR7Y31gKTtcbiAgZHJhdyhzLCAnc3dhcCcsIGMpO1xuICByZXR1cm4gdHJ1ZTtcbn1cbmV4cG9ydCBjb25zdCBzd2FwRGlzY2FyZCA9IGRpc2NhcmRSZWRyYXc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5Td2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgcmV0dXJuICFzLmRpc2NhcmRVc2VkICYmICEhdSAmJiAhdS5mcmVzaDsgICAgICAgICAgLy8gY2FuJ3Qgc2VsbCBhIHVuaXQgeW91IHN1bW1vbmVkIHRoaXMgcm91bmRcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDI6IHNlbGwgYSBkZXBsb3llZCB1bml0IChub3Qgb25lIHN1bW1vbmVkIHRoaXMgcm91bmQpIGFuZCBkcmF3IGEgY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN3YXBTZWxsKHMsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBzd2FwOiBzZWxsICR7dS5zb3VsfSAke3Uuc3Rhcn0qYCk7XG4gIGRyYXcocywgJ3N3YXAnLCB1LnNvdWwpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1vdmVVbml0KHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlciwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSB8fCAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgbG9nKHMsIGBtb3ZlICR7dS5zb3VsfSBjZWxsICR7dS5jZWxsfSAtPiAke2NlbGx9YCk7IHUuY2VsbCA9IGNlbGw7IHJldHVybiB0cnVlO1xufVxuXG4vLyAtLS0tIHdhdmUgcmVzdWx0cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBEcmFmdCBjaG9pY2VzIGZvciBhZnRlciBhIGNsZWFyZWQgd2F2ZTogMyByYW5kb20gY2FyZHMsIGR1cGxpY2F0ZXMgYWxsb3dlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkcmFmdE9wdGlvbnMoczogU3RhdGUpOiBTb3VsSWRbXSB7XG4gIGNvbnN0IHAgPSBwb29sT2Yocyk7XG4gIHJldHVybiBbcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKV07XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQ6IHJhaXNlIHRoZSBjYXAsIHJlc29sdmUgdGhlIFZpY3RvcnkgRHJhZnQsIGRyYXcgMSBub3JtYWwgY2FyZC4gKi9cbmV4cG9ydCBjb25zdCBzdGFnZVdhdmVzID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMucnVsZXMuc3RhZ2VXYXZlcyA/PyBXQVZFUztcblxuLyoqIFN0ZXAgMSBvZiBhIGNsZWFyZWQgd2F2ZTogaXMgdGhlIHN0YWdlIG92ZXI/IElmIG5vdCwgcmFpc2UgdGhlIGNhcCBhbmQgc3RhcnQgdGhlIG5leHQgYnVpbGQgcGhhc2UuIFJldHVybnMgdHJ1ZSB3aGVuIHRoZSBzdGFnZSBpcyB3b24uICovXG5leHBvcnQgZnVuY3Rpb24gYWR2YW5jZVdhdmUoczogU3RhdGUpOiBib29sZWFuIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gcy5zdGF0dXMgPT09ICd3b24nO1xuICBpZiAocy53YXZlID49IHN0YWdlV2F2ZXMocykpIHsgcy5zdGF0dXMgPSAnd29uJzsgbG9nKHMsICdzdGFnZSBjbGVhcmVkJyk7IHJldHVybiB0cnVlOyB9XG4gIHMud2F2ZSsrO1xuICBzLmNhcCA9IHMucnVsZXMuY3VydmVbcy53YXZlIC0gMV07XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYHdhdmUgY2xlYXJlZCAtPiBjYXAgJHtzLmNhcH1gKTtcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU3RlcCAyOiB0aGUgcGxheWVyIGtlcHQgYGlkeGAgZnJvbSB0aGUgb2ZmZXJlZCBkcmFmdCBjYXJkcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0YWtlRHJhZnQoczogU3RhdGUsIG9wdHM6IFNvdWxJZFtdLCBpZHg6IG51bWJlcik6IHZvaWQge1xuICBjb25zdCBwaWNrID0gb3B0c1tNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGlkeCkpXTtcbiAgcy5oYW5kLnB1c2gocGljayk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmFmdCBbJHtvcHRzLmpvaW4oJywgJyl9XSAtPiB0b29rICR7cGlja31gKTtcbn1cblxuLyoqIFN0ZXAgMzogdGhlIGJvbnVzIG5vcm1hbCBkcmF3IChvbmx5IG9uIHRoZSB3YXZlcyB0aGUgcnVsZXMgYWxsb3cpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbERyYXcoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMucnVsZXMubm9ybWFsRHJhd1dhdmVzID8gcy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMuaW5jbHVkZXMocy53YXZlKSA6IHRydWUpIGRyYXcocywgJ3dhdmUgY2xlYXInKTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZCAoYWxsIHRocmVlIHN0ZXBzIGluIG9uZSBjYWxsLCBmb3Igc2ltdWxhdGlvbnMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyV2F2ZShzOiBTdGF0ZSwgY2hvb3NlOiAob3B0czogU291bElkW10pID0+IG51bWJlcik6IHZvaWQge1xuICBpZiAoYWR2YW5jZVdhdmUocykpIHJldHVybjtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIGxldCBvcHRzID0gZHJhZnRPcHRpb25zKHMpO1xuICBjb25zdCBvZmZlcmVkID0gb3B0cy5qb2luKCcsICcpO1xuICBjb25zdCB0b29rOiBTb3VsSWRbXSA9IFtdO1xuICBmb3IgKGxldCBwID0gMDsgcCA8IChzLnJ1bGVzLmRyYWZ0UGlja3MgPz8gMSk7IHArKykge1xuICAgIGNvbnN0IGlkeCA9IE1hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgY2hvb3NlKG9wdHMpKSk7XG4gICAgdG9vay5wdXNoKG9wdHNbaWR4XSk7IHMuaGFuZC5wdXNoKG9wdHNbaWR4XSk7IHMuc3RhdHMuZHJhd24rKztcbiAgICBvcHRzID0gb3B0cy5maWx0ZXIoKF8sIGkpID0+IGkgIT09IGlkeCk7XG4gIH1cbiAgbG9nKHMsIGBkcmFmdCBbJHtvZmZlcmVkfV0gLT4gdG9vayAke3Rvb2suam9pbignLCAnKX1gKTtcbiAgbm9ybWFsRHJhdyhzKTtcbn1cblxuLyoqIEFybXkgd2lwZWQ6IGxvc2UgYSBoZWFydCwgY2FwIGRvZXMgTk9UIHJpc2UsIGVuZW1pZXMgcmVzZXQsICsxIGNhcmQsIHJlZHJhdyBhbGxvd2VkIGFnYWluLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZhaWxXYXZlKHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBzLmhlYXJ0cy0tOyBzLnN0YXRzLmZhaWx1cmVzKys7XG4gIGlmIChzLmhlYXJ0cyA8PSAwKSB7IHMuc3RhdHVzID0gJ2xvc3QnOyBsb2cocywgJ25vIGhlYXJ0cyBsZWZ0OiBzdGFnZSBsb3N0Jyk7IHJldHVybjsgfVxuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGBhcm15IHdpcGVkOiBoZWFydHMgJHtzLmhlYXJ0c30sIGNhcCBzdGF5cyAke3MuY2FwfWApO1xuICBkcmF3KHMsICdmYWlsZWQgYXR0ZW1wdCcpO1xufVxuXG4vLyAtLS0tIGludmFyaWFudHMgKGNhbGxlZCBieSB0aGUgc2ltdWxhdG9yIGFmdGVyIGV2ZXJ5IHdhdmU7IHRocm93IHdpdGggYSByZWFkYWJsZSBtZXNzYWdlKSAtLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjaGVja0ludmFyaWFudHMoczogU3RhdGUpOiB2b2lkIHtcbiAgY29uc3QgZmFpbCA9IChtOiBzdHJpbmcpID0+IHsgdGhyb3cgbmV3IEVycm9yKGBJTlZBUklBTlQgJHttfVxcbmAgKyBzLmxvZy5zbGljZSgtMTIpLmpvaW4oJ1xcbicpKTsgfTtcbiAgaWYgKHMudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgZmFpbChgbW9yZSB1bml0cyAoJHtzLnVuaXRzLmxlbmd0aH0pIHRoYW4gY2VsbHNgKTtcbiAgY29uc3QgY2VsbHMgPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgaWYgKGNlbGxzLnNpemUgIT09IHMudW5pdHMubGVuZ3RoKSBmYWlsKCd0d28gdW5pdHMgc2hhcmUgYSBjZWxsJyk7XG4gIGlmIChkb21pbmlvblVzZWQocykgPiBzLmNhcCkgZmFpbChgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9IGV4Y2VlZHMgY2FwICR7cy5jYXB9YCk7XG4gIGZvciAoY29uc3QgdSBvZiBzLnVuaXRzKSBpZiAodS5zdGFyIDwgMSB8fCB1LnN0YXIgPiBNQVhfU1RBUikgZmFpbChgdW5pdCBzdGFyICR7dS5zdGFyfSBvdXQgb2YgcmFuZ2VgKTtcbiAgLy8gZXZlcnkgZHJhd24gY2FyZCBpcyBlaXRoZXIgaW4gaGFuZCwgd29ydGggY2FyZHMgb24gdGhlIGZpZWxkLCBkaXNjYXJkZWQsIG9yIGRpc21pc3NlZFxuICBjb25zdCBvbkZpZWxkID0gcy51bml0cy5yZWR1Y2UoKG4sIHUpID0+IG4gKyBjYXJkc0luKHUuc3RhciksIDApO1xuICBjb25zdCBhY2NvdW50ZWQgPSBzLmhhbmQubGVuZ3RoICsgb25GaWVsZCArIHMuc3RhdHMuZGlzY2FyZGVkICsgcy5zdGF0cy5kaXNtaXNzZWQ7XG4gIGlmIChhY2NvdW50ZWQgIT09IHMuc3RhdHMuZHJhd24pIGZhaWwoYGNhcmQgY29uc2VydmF0aW9uOiBkcmF3biAke3Muc3RhdHMuZHJhd259ICE9IGFjY291bnRlZCAke2FjY291bnRlZH1gKTtcbn1cbiIsICIvLyBUaGUgYmF0dGxlZmllbGQncyBsb29rOiBhIHRpbGVkIGNyeXB0IGZsb29yLCBhIGdsb3dpbmcgcnVuZSBjaXJjbGUgaW4gdGhlIG1pZGRsZSwgYW5kIGEgZGFyayBtaXN0eSBzdXJyb3VuZC4gUHVyZSBkZWNvcmF0aW9uIChubyBnYW1lIHJ1bGVzKS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuXG5jb25zdCBUSUxFX01FVFJFUyA9IDU7ICAgIC8vIG9uZSByZXBlYXQgb2YgdGhlIGZsb29yIHBpY3R1cmUgY292ZXJzIHRoaXMgbWFueSBtZXRyZXMsIHNvIHNsYWJzIGNvbWUgb3V0IGFib3V0IGEgbWV0cmUgd2lkZVxuXG4vKiogRHJhdyB0aGUgcnVuZSBjaXJjbGUgb25jZSBvbnRvIGEgY2FudmFzOyBpdCBiZWNvbWVzIGEgc2VlLXRocm91Z2ggZGVjYWwgb24gdGhlIGZsb29yLiAqL1xuZnVuY3Rpb24gcnVuZVRleHR1cmUoc2NlbmU6IGFueSk6IGFueSB7XG4gIGNvbnN0IFMgPSA1MTIsIHRleCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdydW5lcycsIHsgd2lkdGg6IFMsIGhlaWdodDogUyB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0ZXguZ2V0Q29udGV4dCgpO1xuICBjLmNsZWFyUmVjdCgwLCAwLCBTLCBTKTsgYy50cmFuc2xhdGUoUyAvIDIsIFMgLyAyKTsgYy5saW5lQ2FwID0gJ3JvdW5kJzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7XG4gIGNvbnN0IHJpbmcgPSAocjogbnVtYmVyLCB3OiBudW1iZXIsIGE6IG51bWJlcikgPT4geyBjLmJlZ2luUGF0aCgpOyBjLmFyYygwLCAwLCByLCAwLCBNYXRoLlBJICogMik7IGMubGluZVdpZHRoID0gdzsgYy5zdHJva2VTdHlsZSA9IGByZ2JhKDQ3LDIxNywxNjYsJHthfSlgOyBjLnN0cm9rZSgpOyB9O1xuICBjLnNoYWRvd0NvbG9yID0gJ3JnYmEoNDcsMjE3LDE2NiwwLjkpJzsgYy5zaGFkb3dCbHVyID0gMTA7XG4gIHJpbmcoMjM2LCA0LCAwLjc1KTsgcmluZygyMTQsIDIsIDAuNSk7IHJpbmcoMTIwLCAzLCAwLjcpO1xuICBjLnN0cm9rZVN0eWxlID0gJ3JnYmEoNDcsMjE3LDE2NiwwLjcpJzsgYy5saW5lV2lkdGggPSAzO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ7IGkrKykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZm91ciBsb25nIHNwaWtlcywgbGlrZSBhIGNvbXBhc3NcbiAgICBjLnNhdmUoKTsgYy5yb3RhdGUoKGkgKiBNYXRoLlBJKSAvIDIgKyBNYXRoLlBJIC8gNCk7IGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKDAsIC0zMCk7IGMubGluZVRvKDAsIC0yMzApOyBjLnN0cm9rZSgpO1xuICAgIGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKC0xNCwgLTEyMCk7IGMubGluZVRvKDAsIC0xNjApOyBjLmxpbmVUbygxNCwgLTEyMCk7IGMuc3Ryb2tlKCk7IGMucmVzdG9yZSgpO1xuICB9XG4gIGMubGluZVdpZHRoID0gMjsgYy5zdHJva2VTdHlsZSA9ICdyZ2JhKDQ3LDIxNywxNjYsMC41NSknO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDEyOyBpKyspIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc21hbGwgdGljayBtYXJrcyBiZXR3ZWVuIHRoZSB0d28gb3V0ZXIgcmluZ3NcbiAgICBjLnNhdmUoKTsgYy5yb3RhdGUoKGkgKiBNYXRoLlBJKSAvIDYpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMjE0KTsgYy5saW5lVG8oMCwgLTIzNik7IGMuc3Ryb2tlKCk7IGMucmVzdG9yZSgpO1xuICB9XG4gIHRleC51cGRhdGUoKTsgdGV4Lmhhc0FscGhhID0gdHJ1ZTsgcmV0dXJuIHRleDtcbn1cblxuaW50ZXJmYWNlIFBsYWNlbWVudCB7IHByb3A6IHN0cmluZzsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHlhdz86IG51bWJlcjsgcz86IG51bWJlciB9XG4vKiogV2hlcmUgdGhlIHByb3BzIHN0YW5kLiBUYWxsIHRoaW5ncyBnbyBiZWhpbmQgYW5kIGJlc2lkZSB0aGUgZmllbGQ7IG9ubHkgbG93IHRoaW5ncyAoZmVuY2UsIGJvbmVzLCB3YWxsKSBzdGFuZCBiZXR3ZWVuIHRoZSBjYW1lcmEgYW5kIHRoZSB1bml0cy4gKi9cbmNvbnN0IENSWVBUX0xBWU9VVDogUGxhY2VtZW50W10gPSBbXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtNi41LCB6OiA2LjQgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDAsIHo6IDYuOSwgczogMS4xNSB9LCB7IHByb3A6ICdhcmNoJywgeDogNi41LCB6OiA2LjQgfSxcbiAgeyBwcm9wOiAncGlsbGFyJywgeDogLTEwLjIsIHo6IDUuNiwgeWF3OiAwLjQgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogLTMuMiwgejogNS45LCB5YXc6IDIuMSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAzLjMsIHo6IDUuOCwgeWF3OiA0LjAgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTAuMiwgejogNS42LCB5YXc6IDEuMiB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTQuNiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiA0LjYsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogLTEwLjUsIHo6IDAuOCB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogMTAuNSwgejogMC44IH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtOC42LCB6OiA2LjAsIHlhdzogMC4xIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiA4LjYsIHo6IDYuMCwgeWF3OiAtMC4xIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTEuNCwgejogLTIuNiwgeWF3OiAxLjQgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDExLjQsIHo6IC0yLjYsIHlhdzogMS43IH0sXG4gIHsgcHJvcDogJ2ZlbmNlJywgeDogLTguMCwgejogLTQuNiB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC02LjcsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA2LjcsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA4LjAsIHo6IC00LjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiAtMy41LCB6OiAtNC40LCB5YXc6IDAuNywgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogNC4yLCB6OiAtNC42LCB5YXc6IDIuNSwgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogOS40LCB6OiAzLjIsIHlhdzogMS4wLCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAtOS42LCB6OiAtMy40LCB5YXc6IDMuNiwgczogMC42IH0sXG5dO1xuY29uc3QgR1JBVkVZQVJEX0xBWU9VVDogUGxhY2VtZW50W10gPSBbICAgICAgLy8gZmV3ZXIgYXJjaGVzLCBhIGJyb2tlbiByb3cgb2YgZ3JhdmVzdG9uZSBwaWxsYXJzLCBib25lcyBldmVyeXdoZXJlXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtOS41LCB6OiA2LjQgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDkuNSwgejogNi40IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMSwgejogNS4yLCB5YXc6IDAuNCwgczogMC45IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC03LjYsIHo6IDYuMywgeWF3OiAyLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogLTQuNCwgejogNS42LCB5YXc6IDQuMCwgczogMC44IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xLjIsIHo6IDYuNSwgeWF3OiAxLjIgfSxcbiAgeyBwcm9wOiAncGlsbGFyJywgeDogMi4yLCB6OiA1LjcsIHlhdzogMy4xLCBzOiAwLjkgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogNS41LCB6OiA2LjQsIHlhdzogNS4wIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDguMiwgejogNS41LCB5YXc6IDAuOSwgczogMC44NSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAxMSwgejogNS4wLCB5YXc6IDIuNiB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTExLCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDExLCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDAuNiwgejogNS4wLCBzOiAwLjkgfSxcbiAgeyBwcm9wOiAnd2FsbCcsIHg6IC01LjYsIHo6IDYuNiwgeWF3OiAwLjIgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDMuOCwgejogNi43LCB5YXc6IC0wLjIgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0xMS42LCB6OiAtMi40LCB5YXc6IDEuNSB9LFxuICB7IHByb3A6ICdmZW5jZScsIHg6IC00LjIsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA0LjQsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAxMS4yLCB6OiAtMi4yLCB5YXc6IDEuNiB9LFxuICB7IHByb3A6ICdib25lcycsIHg6IC01LjUsIHo6IDQuNiwgeWF3OiAwLjcsIHM6IDAuNiB9LCB7IHByb3A6ICdib25lcycsIHg6IDMuMiwgejogNC40LCB5YXc6IDIuNSwgczogMC43IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogOC4yLCB6OiAzLjIsIHlhdzogMS4wLCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAtOS4yLCB6OiAzLjQsIHlhdzogMy42LCBzOiAwLjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiA3LCB6OiAtNC41LCB5YXc6IDAuMywgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTcuNCwgejogLTQuMywgeWF3OiA0LjEsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDAuMiwgejogLTQuOCwgeWF3OiA1LjIsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDEwLjIsIHo6IC0wLjYsIHlhdzogMi4wLCBzOiAwLjYgfSxcbl07XG5jb25zdCBCQVNUSU9OX0xBWU9VVDogUGxhY2VtZW50W10gPSBbICAgICAgICAvLyBhIGZvcnRyZXNzOiBnYXRlcyBiZXR3ZWVuIGxvbmcgd2FsbHMsIGJyYXppZXJzIGFsb25nIHRoZSBiYXR0bGVtZW50cywgZmVuY2VzIG9uIHRoZSBmbGFua3NcbiAgeyBwcm9wOiAnYXJjaCcsIHg6IC01LjgsIHo6IDYuNSwgczogMS4xIH0sIHsgcHJvcDogJ2FyY2gnLCB4OiAwLCB6OiA3LjAsIHM6IDEuMyB9LCB7IHByb3A6ICdhcmNoJywgeDogNS44LCB6OiA2LjUsIHM6IDEuMSB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTkuNCwgejogNi4wLCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0yLjksIHo6IDYuNCwgczogMS4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAyLjksIHo6IDYuNCwgczogMS4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiA5LjQsIHo6IDYuMCwgczogMS4zIH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTIuMiwgejogMi42LCB5YXc6IDEuNTcsIHM6IDEuMyB9LCB7IHByb3A6ICd3YWxsJywgeDogMTIuMiwgejogMi42LCB5YXc6IDEuNTcsIHM6IDEuMyB9LCB7IHByb3A6ICd3YWxsJywgeDogLTEyLjIsIHo6IC0xLjYsIHlhdzogMS41NyB9LCB7IHByb3A6ICd3YWxsJywgeDogMTIuMiwgejogLTEuNiwgeWF3OiAxLjU3IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMS4yLCB6OiA1LjYsIHlhdzogMC40LCBzOiAxLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTEuMiwgejogNS42LCB5YXc6IDEuMiwgczogMS4xIH0sXG4gIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtMy4yLCB6OiA1LjIgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDMuMiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtMTAuNiwgejogMS4wIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAxMC42LCB6OiAxLjAgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IC03LjIsIHo6IC00LjYsIHM6IDAuOSB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogNy4yLCB6OiAtNC42LCBzOiAwLjkgfSxcbiAgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNC42LCB6OiAtNC44IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogLTMuMywgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDMuMywgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDQuNiwgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC0xMS42LCB6OiAtMy40LCB5YXc6IDEuNSB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDExLjYsIHo6IC0zLjQsIHlhdzogMS41IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogLTEuNSwgejogLTQuNSwgeWF3OiAwLjcsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDkuNCwgejogMy4yLCB5YXc6IDEuMCwgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuNiwgejogLTMuMCwgeWF3OiAzLjYsIHM6IDAuNSB9LFxuXTtcblxudHlwZSBDMyA9IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcbmludGVyZmFjZSBUaGVtZSB7IGxheW91dDogUGxhY2VtZW50W107IGZsb29yOiBDMzsgZm9nOiBDMzsgbWlzdDogQzM7IHdhbGw6IEMzOyBmbGFtZUE6IEMzOyBmbGFtZUI6IEMzOyBydW5lOiBDMyB9XG4vKiogT25lIGxvb2sgcGVyIGNhbXBhaWduIHN0YWdlIChpZHMgbWF0Y2ggU1RBR0VTIGluIGNvcmUvd2F2ZXMudHMpLiBVbmtub3duIGlkcyB1c2UgdGhlIGNyeXB0IGxvb2suICovXG5jb25zdCBUSEVNRVM6IFJlY29yZDxzdHJpbmcsIFRoZW1lPiA9IHtcbiAgY3J5cHQ6IHsgbGF5b3V0OiBDUllQVF9MQVlPVVQsIGZsb29yOiBbMC42MiwgMC43LCAwLjddLCBmb2c6IFswLjAyLCAwLjA1LCAwLjA2XSwgbWlzdDogWzAuMiwgMC42LCAwLjU1XSwgd2FsbDogWzAuNzUsIDAuODUsIDAuOV0sIGZsYW1lQTogWzAuMzUsIDEsIDAuOF0sIGZsYW1lQjogWzAuMSwgMC44LCAwLjZdLCBydW5lOiBbMC4xOCwgMC44NSwgMC42NV0gfSxcbiAgZ3JhdmV5YXJkOiB7IGxheW91dDogR1JBVkVZQVJEX0xBWU9VVCwgZmxvb3I6IFswLjYyLCAwLjc0LCAwLjUyXSwgZm9nOiBbMC4wMywgMC4wNSwgMC4wMjVdLCBtaXN0OiBbMC40MiwgMC42LCAwLjIyXSwgd2FsbDogWzAuNywgMC44NSwgMC42Ml0sIGZsYW1lQTogWzAuNzUsIDEsIDAuNF0sIGZsYW1lQjogWzAuNCwgMC44LCAwLjJdLCBydW5lOiBbMC41LCAwLjgsIDAuMjVdIH0sXG4gIGVuZGxlc3M6IHsgbGF5b3V0OiBDUllQVF9MQVlPVVQsIGZsb29yOiBbMC43OCwgMC42MiwgMC42OF0sIGZvZzogWzAuMDYsIDAuMDIsIDAuMDM1XSwgbWlzdDogWzAuNzUsIDAuMywgMC40XSwgd2FsbDogWzAuOTIsIDAuNjgsIDAuNzhdLCBmbGFtZUE6IFsxLCAwLjYyLCAwLjNdLCBmbGFtZUI6IFswLjksIDAuMjUsIDAuMTVdLCBydW5lOiBbMC45LCAwLjM1LCAwLjNdIH0sXG4gIGJhc3Rpb246IHsgbGF5b3V0OiBCQVNUSU9OX0xBWU9VVCwgZmxvb3I6IFswLjYsIDAuNjIsIDAuOV0sIGZvZzogWzAuMDMsIDAuMDMsIDAuMDhdLCBtaXN0OiBbMC40LCAwLjQsIDAuODVdLCB3YWxsOiBbMC43MiwgMC43MiwgMV0sIGZsYW1lQTogWzAuNiwgMC42NSwgMV0sIGZsYW1lQjogWzAuNCwgMC4zLCAwLjk1XSwgcnVuZTogWzAuNDUsIDAuNCwgMC45NV0gfSxcbn07XG5cblxuLyoqIEJ1aWxkIHRoZSB0ZWFsIHNvdWxmaXJlIG92ZXIgYSBicmF6aWVyOiBhIHNtYWxsIHNvZnQgZmxhbWUgdGhhdCBmbGlja2Vycy4gKi9cbmZ1bmN0aW9uIGZsYW1lKHNjZW5lOiBhbnksIHRleDogYW55LCB4OiBudW1iZXIsIHk6IG51bWJlciwgejogbnVtYmVyLCBrOiBudW1iZXIsIGE6IEMzLCBiOiBDMyk6IGFueSB7XG4gIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2ZpcmUnLCAxOCwgc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0ZXg7IHBzLmVtaXR0ZXIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKHgsIHksIHopO1xuICBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yMiAqIGssIDAsIC0wLjIyICogayk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMjIgKiBrLCAwLCAwLjIyICogayk7XG4gIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjEsIDEsIC0wLjEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjEsIDEuNCwgMC4xKTtcbiAgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMS4wOyBwcy5lbWl0UmF0ZSA9IDIwOyBwcy5taW5TaXplID0gMC4zNSAqIGs7IHBzLm1heFNpemUgPSAwLjcgKiBrOyBwcy5taW5FbWl0UG93ZXIgPSAwLjUgKiBrOyBwcy5tYXhFbWl0UG93ZXIgPSAxLjAgKiBrO1xuICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoYVswXSwgYVsxXSwgYVsyXSwgMC45KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KGJbMF0sIGJbMV0sIGJbMl0sIDAuOCk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNChiWzBdICogMC4xLCBiWzFdICogMC4zLCBiWzJdICogMC4zLCAwKTtcbiAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5zdGFydCgpOyByZXR1cm4gcHM7XG59XG5cbi8qKiBTb2Z0IHJvdW5kIGJsb2IgdXNlZCBmb3IgdGhlIGZsYW1lcy4gKi9cbmZ1bmN0aW9uIGdsb3dUZXh0dXJlKHNjZW5lOiBhbnkpOiBhbnkge1xuICBjb25zdCB0ID0gbmV3IEJBQllMT04uRHluYW1pY1RleHR1cmUoJ2dsb3cnLCB7IHdpZHRoOiA2NCwgaGVpZ2h0OiA2NCB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0LmdldENvbnRleHQoKSwgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTtcbiAgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwwLjQ1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICBjLmZpbGxTdHlsZSA9IGc7IGMuZmlsbFJlY3QoMCwgMCwgNjQsIDY0KTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IHRydWU7IHJldHVybiB0O1xufVxuXG4vKiogTG9hZCB0aGUgcHJvcCBraXQgb25jZTsgYXBwbHkodGhlbWUpIHRoZW4gc3RhbmRzIGNvcGllcyBvZiBlYWNoIHBpZWNlIGFyb3VuZCB0aGUgZmllbGQgKHRoZXkgc2hhcmUgb25lIG1lc2ggYW5kIG9uZSB0ZXh0dXJlLCBzbyB0aGV5IGNvc3QgYWxtb3N0IG5vdGhpbmcpLiAqL1xuYXN5bmMgZnVuY3Rpb24gbG9hZEtpdChzY2VuZTogYW55KTogUHJvbWlzZTx7IGFwcGx5KHQ6IFRoZW1lKTogdm9pZCB9PiB7XG4gIGNvbnN0IGJveCA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy9hcmVuYS8nLCAncHJvcHMuZ2xiJywgc2NlbmUpO1xuICBib3guYWRkQWxsVG9TY2VuZSgpO1xuICBjb25zdCByb290ID0gYm94Lm1lc2hlcy5maW5kKChtOiBhbnkpID0+IG0ubmFtZSA9PT0gJ19fcm9vdF9fJyksIHNyYzogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICBmb3IgKGNvbnN0IG0gb2YgYm94Lm1lc2hlcykgaWYgKG0ubmFtZSAhPT0gJ19fcm9vdF9fJyAmJiBtLmdldFRvdGFsVmVydGljZXMoKSA+IDApIHsgc3JjW20ubmFtZV0gPSBtOyBtLnNldEVuYWJsZWQoZmFsc2UpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICBjb25zdCBnbG93ID0gZ2xvd1RleHR1cmUoc2NlbmUpOyBsZXQgbWFkZTogeyBob2xkZXJzOiBhbnlbXTsgZmlyZXM6IGFueVtdIH0gPSB7IGhvbGRlcnM6IFtdLCBmaXJlczogW10gfSwgbiA9IDA7XG4gIHJldHVybiB7XG4gICAgYXBwbHkodDogVGhlbWUpIHtcbiAgICAgIGZvciAoY29uc3QgaCBvZiBtYWRlLmhvbGRlcnMpIGguZGlzcG9zZSgpOyBmb3IgKGNvbnN0IGYgb2YgbWFkZS5maXJlcykgZi5kaXNwb3NlKGZhbHNlKTsgICAvLyBmYWxzZToga2VlcCB0aGUgc2hhcmVkIGdsb3cgdGV4dHVyZSBtYWRlID0geyBob2xkZXJzOiBbXSwgZmlyZXM6IFtdIH07XG4gICAgICBmb3IgKGNvbnN0IHAgb2YgdC5sYXlvdXQpIHtcbiAgICAgICAgY29uc3QgYmFzZSA9IHNyY1twLnByb3BdOyBpZiAoIWJhc2UpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBpbnN0ID0gYmFzZS5jcmVhdGVJbnN0YW5jZShwLnByb3AgKyBuKyspOyBpbnN0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICAgICAgaW5zdC5yb3RhdGlvblF1YXRlcm5pb24gPSByb290LnJvdGF0aW9uUXVhdGVybmlvbj8uY2xvbmUoKSA/PyBudWxsOyBpZiAoIWluc3Qucm90YXRpb25RdWF0ZXJuaW9uKSBpbnN0LnJvdGF0aW9uID0gcm9vdC5yb3RhdGlvbi5jbG9uZSgpOyBpbnN0LnNjYWxpbmcgPSByb290LnNjYWxpbmcuY2xvbmUoKTtcbiAgICAgICAgY29uc3QgaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnaG9sZGVyJyArIG4sIHNjZW5lKTsgaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IGhvbGRlci5yb3RhdGlvbi55ID0gcC55YXcgPz8gMDsgaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHAucyA/PyAxKTtcbiAgICAgICAgaW5zdC5wYXJlbnQgPSBob2xkZXI7IG1hZGUuaG9sZGVycy5wdXNoKGhvbGRlcik7XG4gICAgICAgIGlmIChwLnByb3AgPT09ICdicmF6aWVyJykgbWFkZS5maXJlcy5wdXNoKGZsYW1lKHNjZW5lLCBnbG93LCBwLngsIDEuMjUgKiAocC5zID8/IDEpLCBwLnosIHAucyA/PyAxLCB0LmZsYW1lQSwgdC5mbGFtZUIpKTtcbiAgICAgIH1cbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRBcmVuYShzY2VuZTogYW55LCBncm91bmQ6IGFueSk6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHNldFRoZW1lKHN0YWdlOiBzdHJpbmcpOiB2b2lkIH0ge1xuICAvLyAtLS0tIGZsb29yXG4gIGNvbnN0IHRleCA9IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy9hcmVuYS9mbG9vci53ZWJwJywgc2NlbmUsIGZhbHNlLCB0cnVlLCBCQUJZTE9OLlRleHR1cmUuVFJJTElORUFSX1NBTVBMSU5HTU9ERSk7XG4gIHRleC51U2NhbGUgPSA2MCAvIFRJTEVfTUVUUkVTOyB0ZXgudlNjYWxlID0gNDAgLyBUSUxFX01FVFJFUzsgdGV4LmFuaXNvdHJvcGljRmlsdGVyaW5nTGV2ZWwgPSA0O1xuICBjb25zdCBnbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2dtJywgc2NlbmUpOyBnbS5kaWZmdXNlVGV4dHVyZSA9IHRleDsgZ20uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7XG4gIGdtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjYyLCAwLjcsIDAuNyk7IGdyb3VuZC5tYXRlcmlhbCA9IGdtO1xuXG4gIC8vIC0tLS0gcnVuZSBjaXJjbGUgaW4gdGhlIG1pZGRsZSBvZiB0aGUgZmllbGRcbiAgY29uc3QgZGVjYWwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgncnVuZXMnLCB7IHdpZHRoOiA1LjIsIGhlaWdodDogNS4yIH0sIHNjZW5lKTtcbiAgZGVjYWwucG9zaXRpb24ueSA9IDAuMDEyOyBkZWNhbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGNvbnN0IHJtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgncm0nLCBzY2VuZSk7IHJtLmRpZmZ1c2VUZXh0dXJlID0gcnVuZVRleHR1cmUoc2NlbmUpOyBybS5kaWZmdXNlVGV4dHVyZS5oYXNBbHBoYSA9IHRydWU7IHJtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTtcbiAgcm0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjg1LCAwLjY1KTsgcm0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcm0uYWxwaGEgPSAwLjU1OyBybS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgZGVjYWwubWF0ZXJpYWwgPSBybTtcblxuICAvLyAtLS0tIGRhcmsgdGVhbCBzdXJyb3VuZCB0aGF0IHN3YWxsb3dzIHRoZSBmYXIgZWRnZSBvZiB0aGUgZmxvb3JcbiAgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjAyLCAwLjA1LCAwLjA2LCAxKTtcbiAgc2NlbmUuZm9nTW9kZSA9IEJBQllMT04uU2NlbmUuRk9HTU9ERV9MSU5FQVI7IHNjZW5lLmZvZ0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMDIsIDAuMDUsIDAuMDYpOyBzY2VuZS5mb2dTdGFydCA9IDI0OyBzY2VuZS5mb2dFbmQgPSA1NjtcblxuICBjb25zdCBjYXZlID0gYnVpbGRDYXZlKHNjZW5lLCB0ZXgpO1xuICBsZXQga2l0OiB7IGFwcGx5KHQ6IFRoZW1lKTogdm9pZCB9IHwgbnVsbCA9IG51bGwsIHdhbnQgPSAnY3J5cHQnLCBzaG93biA9ICcnO1xuICBjb25zdCBzaG93ID0gKCkgPT4ge1xuICAgIGNvbnN0IHQgPSBUSEVNRVNbd2FudF0gPz8gVEhFTUVTLmNyeXB0OyBpZiAod2FudCA9PT0gc2hvd24gJiYga2l0KSByZXR1cm47XG4gICAgY29uc3QgY29sID0gKGM6IEMzKSA9PiBuZXcgQkFCWUxPTi5Db2xvcjMoY1swXSwgY1sxXSwgY1syXSk7XG4gICAgZ20uZGlmZnVzZUNvbG9yID0gY29sKHQuZmxvb3IpOyBjYXZlLndhbGxNYXQuZGlmZnVzZUNvbG9yID0gY29sKHQud2FsbCk7IHJtLmVtaXNzaXZlQ29sb3IgPSBjb2wodC5ydW5lKTtcbiAgICBmb3IgKGNvbnN0IG0gb2YgY2F2ZS5taXN0TWF0cykgbS5lbWlzc2l2ZUNvbG9yID0gY29sKHQubWlzdCk7XG4gICAgc2NlbmUuZm9nQ29sb3IgPSBjb2wodC5mb2cpOyBzY2VuZS5jbGVhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3I0KHQuZm9nWzBdLCB0LmZvZ1sxXSwgdC5mb2dbMl0sIDEpO1xuICAgIGlmIChraXQpIHsga2l0LmFwcGx5KHQpOyBzaG93biA9IHdhbnQ7IH1cbiAgfTtcbiAgbG9hZEtpdChzY2VuZSkudGhlbigoaykgPT4geyBraXQgPSBrOyBzaG93biA9ICcnOyBzaG93KCk7IH0pLmNhdGNoKChlKSA9PiBjb25zb2xlLndhcm4oJ2FyZW5hIHByb3BzIGZhaWxlZCcsIGUpKTtcblxuICByZXR1cm4geyB1cGRhdGU6ICh0OiBudW1iZXIpID0+IHsgcm0uYWxwaGEgPSAwLjQ1ICsgMC4xNSAqIE1hdGguc2luKHQgKiAxLjQpOyBjYXZlLnVwZGF0ZSh0KTsgfSwgc2V0VGhlbWU6IChzdGFnZTogc3RyaW5nKSA9PiB7IHdhbnQgPSBzdGFnZTsgc2hvdygpOyB9IH07XG59XG5cbi8vIC0tLS0gdGhlIGNhdmU6IGEgcm91Z2ggc3RvbmUgd2FsbCBhbGwgdGhlIHdheSByb3VuZCwgcm9jayBzcGlyZXMgYWxvbmcgaXRzIGZvb3QsIGRyaWZ0aW5nIG1pc3QsIGFuZCBhIGRhcmsgdmlnbmV0dGUgb24gdGhlIGZsb29yXG5jb25zdCBSWCA9IDIwLCBSWiA9IDE1LCBDWiA9IC00LCBXQUxMX0ggPSAxNjsgICAvLyBvdmFsIHJpbmcgY2VudHJlZCBhIGxpdHRsZSBiZWhpbmQgdGhlIGZpZWxkOiB0aGUgZmFyIHdhbGwgc3RhbmRzIGFib3V0IDExIG0gcGFzdCB0aGUgY2VudHJlXG5jb25zdCB3b2JibGUgPSAoYTogbnVtYmVyLCB5OiBudW1iZXIpOiBudW1iZXIgPT4gTWF0aC5zaW4oMyAqIGEgKyAxLjMpICogMC41ICsgTWF0aC5zaW4oNyAqIGEgKyB5ICogMC41KSAqIDAuMyArIE1hdGguc2luKDEzICogYSAtIHkgKiAwLjM1KSAqIDAuMiArIE1hdGguc2luKDIzICogYSArIHkpICogMC4wODtcblxuZnVuY3Rpb24gbWlzdFRleHR1cmUoc2NlbmU6IGFueSwgc2VlZDogbnVtYmVyKTogYW55IHtcbiAgY29uc3QgUyA9IDI1NiwgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdtaXN0JyArIHNlZWQsIHsgd2lkdGg6IFMsIGhlaWdodDogUyB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0LmdldENvbnRleHQoKTtcbiAgYy5jbGVhclJlY3QoMCwgMCwgUywgUyk7XG4gIGxldCByID0gc2VlZCAqIDkzMDEgKyA0OTI5NzsgY29uc3Qgcm5kID0gKCkgPT4gKHIgPSAociAqIDkzMDEgKyA0OTI5NykgJSAyMzMyODApIC8gMjMzMjgwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ2OyBpKyspIHtcbiAgICBjb25zdCB4ID0gcm5kKCkgKiBTLCB5ID0gcm5kKCkgKiBTLCByYWQgPSAyNiArIHJuZCgpICogNDY7XG4gICAgZm9yIChjb25zdCBkeCBvZiBbLVMsIDAsIFNdKSBmb3IgKGNvbnN0IGR5IG9mIFstUywgMCwgU10pIHsgICAgICAgICAgLy8gZHJhdyB3cmFwcGVkIGNvcGllcyBzbyB0aGUgcGljdHVyZSB0aWxlcyB3aXRoIG5vIHNlYW1cbiAgICAgIGNvbnN0IGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KHggKyBkeCwgeSArIGR5LCAwLCB4ICsgZHgsIHkgKyBkeSwgcmFkKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMC41KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICAgICAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIFMsIFMpO1xuICAgIH1cbiAgfVxuICB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gdHJ1ZTsgdC53cmFwVSA9IHQud3JhcFYgPSBCQUJZTE9OLlRleHR1cmUuV1JBUF9BRERSRVNTTU9ERTsgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkQ2F2ZShzY2VuZTogYW55LCBmbG9vclRleDogYW55KTogeyB1cGRhdGUodDogbnVtYmVyKTogdm9pZDsgd2FsbE1hdDogYW55OyBtaXN0TWF0czogYW55W10gfSB7XG4gIC8vIHJvdWdoIHdhbGw6IGFuIG92YWwgcmluZyB3aG9zZSByYWRpdXMgd29iYmxlcyB3aXRoIGFuZ2xlIGFuZCBoZWlnaHQsIGRhcmtlciB0aGUgaGlnaGVyIGl0IGdvZXNcbiAgY29uc3QgTiA9IDEyMCwgTSA9IDEyLCBwb3M6IG51bWJlcltdID0gW10sIHV2OiBudW1iZXJbXSA9IFtdLCBjb2w6IG51bWJlcltdID0gW10sIGlkeDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaiA9IDA7IGogPD0gTTsgaisrKSBmb3IgKGxldCBpID0gMDsgaSA8PSBOOyBpKyspIHtcbiAgICBjb25zdCBhID0gKGkgLyBOKSAqIE1hdGguUEkgKiAyLCBoID0gKGogLyBNKSAqIFdBTExfSCwgayA9IDEgKyAwLjA2ICogd29iYmxlKGEsIGgpICsgKGogPT09IDAgPyAwIDogMC4wNSAqIE1hdGguc2luKGEgKiA1ICsgaikpO1xuICAgIGNvbnN0IG92ZXJoYW5nID0gMSAtIDAuMSAqIE1hdGguc2luKChqIC8gTSkgKiBNYXRoLlBJKTsgICAgICAgICAgICAgICAgICAgICAgICAvLyBsZWFucyBpbiBhIGxpdHRsZSBzbyBpdCBmZWVscyBsaWtlIGEgY2F2ZXJuXG4gICAgcG9zLnB1c2goTWF0aC5jb3MoYSkgKiBSWCAqIGsgKiBvdmVyaGFuZywgaCwgQ1ogKyBNYXRoLnNpbihhKSAqIFJaICogayAqIG92ZXJoYW5nKTsgdXYucHVzaCgoaSAvIE4pICogMTQsIChqIC8gTSkgKiAzLjIpO1xuICAgIGNvbnN0IGIgPSBNYXRoLm1heCgwLjA2LCAxLjAgLSAoaiAvIE0pICogMC45KTsgY29sLnB1c2goYiAqIDAuOCwgYiwgYiwgMSk7XG4gIH1cbiAgZm9yIChsZXQgaiA9IDA7IGogPCBNOyBqKyspIGZvciAobGV0IGkgPSAwOyBpIDwgTjsgaSsrKSB7IGNvbnN0IGEgPSBqICogKE4gKyAxKSArIGksIGIgPSBhICsgMSwgYyA9IGEgKyBOICsgMSwgZCA9IGMgKyAxOyBpZHgucHVzaChhLCBjLCBiLCBiLCBjLCBkKTsgfVxuICBjb25zdCB3YWxsID0gbmV3IEJBQllMT04uTWVzaCgnY2F2ZScsIHNjZW5lKSwgdmQgPSBuZXcgQkFCWUxPTi5WZXJ0ZXhEYXRhKCk7IHZkLnBvc2l0aW9ucyA9IHBvczsgdmQuaW5kaWNlcyA9IGlkeDsgdmQudXZzID0gdXY7IHZkLmNvbG9ycyA9IGNvbDtcbiAgY29uc3QgbnJtOiBudW1iZXJbXSA9IFtdOyBCQUJZTE9OLlZlcnRleERhdGEuQ29tcHV0ZU5vcm1hbHMocG9zLCBpZHgsIG5ybSk7IHZkLm5vcm1hbHMgPSBucm07IHZkLmFwcGx5VG9NZXNoKHdhbGwpO1xuICBjb25zdCB3bSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2NhdmVtJywgc2NlbmUpOyB3bS5kaWZmdXNlVGV4dHVyZSA9IGZsb29yVGV4LmNsb25lKCk7IHdtLmRpZmZ1c2VUZXh0dXJlLnVTY2FsZSA9IDE7IHdtLmRpZmZ1c2VUZXh0dXJlLnZTY2FsZSA9IDE7XG4gIHdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyB3bS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgd20uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuODUsIDAuOSk7IHdhbGwubWF0ZXJpYWwgPSB3bTsgd2FsbC5pc1BpY2thYmxlID0gZmFsc2U7IHdhbGwudXNlVmVydGV4Q29sb3JzID0gdHJ1ZTsgd20udXNlVmVydGV4Q29sb3IgPSB0cnVlO1xuICAvLyByb2NrIHNwaXJlcyBzdGFuZGluZyBhbG9uZyB0aGUgZm9vdCBvZiB0aGUgd2FsbCAob25lIHNoYXJlZCBtZXNoLCBtYW55IGNvcGllcylcbiAgY29uc3Qgc3BpcmUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzcGlyZScsIHsgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiAxLjYsIGhlaWdodDogMSwgdGVzc2VsbGF0aW9uOiA1IH0sIHNjZW5lKTtcbiAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzcGlyZW0nLCBzY2VuZSk7IHNtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAzLCAwLjA0NSwgMC4wNTUpOyBzbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgc20uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAwNCwgMC4wMTIsIDAuMDE0KTsgc3BpcmUubWF0ZXJpYWwgPSBzbTtcbiAgc3BpcmUuY29udmVydFRvRmxhdFNoYWRlZE1lc2goKTsgc3BpcmUuc2V0RW5hYmxlZChmYWxzZSk7IHNwaXJlLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgbGV0IHIgPSAxMjM0NTsgY29uc3Qgcm5kID0gKCkgPT4gKHIgPSAociAqIDkzMDEgKyA0OTI5NykgJSAyMzMyODApIC8gMjMzMjgwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ2OyBpKyspIHtcbiAgICBjb25zdCBhID0gKGkgLyA0NikgKiBNYXRoLlBJICogMiArIChybmQoKSAtIDAuNSkgKiAwLjEyLCBkID0gMC44NiArIHJuZCgpICogMC4xLCBoZ3QgPSAxLjQgKyBybmQoKSAqIDMuMiwgdyA9IDAuNyArIHJuZCgpICogMS4wO1xuICAgIGNvbnN0IHMgPSBzcGlyZS5jcmVhdGVJbnN0YW5jZSgnc3AnICsgaSk7IHMuaXNQaWNrYWJsZSA9IGZhbHNlOyBzLnBvc2l0aW9uLnNldChNYXRoLmNvcyhhKSAqIFJYICogZCwgaGd0IC8gMiAtIDAuMiwgQ1ogKyBNYXRoLnNpbihhKSAqIFJaICogZCk7XG4gICAgcy5zY2FsaW5nLnNldCh3LCBoZ3QsIHcpOyBzLnJvdGF0aW9uLnkgPSBybmQoKSAqIDY7IHMucm90YXRpb24ueiA9IChybmQoKSAtIDAuNSkgKiAwLjE4O1xuICB9XG4gIC8vIG1pc3Q6IHR3byBzbG93IGxheWVycyBqdXN0IGFib3ZlIHRoZSBmbG9vclxuICBjb25zdCBsYXllcnMgPSBbMC4yOCwgMC43NV0ubWFwKCh5LCBuKSA9PiB7XG4gICAgY29uc3QgcCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdtaXN0JyArIG4sIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQ0IH0sIHNjZW5lKTsgcC5wb3NpdGlvbi55ID0geTsgcC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ21pc3RtJyArIG4sIHNjZW5lKSwgdCA9IG1pc3RUZXh0dXJlKHNjZW5lLCBuICsgMyk7IHQudVNjYWxlID0gNSAtIG47IHQudlNjYWxlID0gMy40IC0gbiAqIDAuNjtcbiAgICBtLmRpZmZ1c2VUZXh0dXJlID0gdDsgbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjIsIDAuNiwgMC41NSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IDAuMTUgLSBuICogMC4wNjsgbS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTtcbiAgICBtLmRpc2FibGVEZXB0aFdyaXRlID0gdHJ1ZTsgcC5tYXRlcmlhbCA9IG07IHAuYWxwaGFJbmRleCA9IDUgKyBuOyByZXR1cm4geyB0LCBuLCBtIH07XG4gIH0pO1xuICAvLyB2aWduZXR0ZTogZGFya2VucyB0aGUgZmxvb3IgdG93YXJkIHRoZSBlZGdlcyBzbyB0aGUgZmllbGQgbG9va3MgbGlrZSBhIGxpdCBwb29sIGluc2lkZSB0aGUgY2F2ZVxuICBjb25zdCB2dCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCd2aWcnLCB7IHdpZHRoOiAyNTYsIGhlaWdodDogMjU2IH0sIHNjZW5lLCB0cnVlKSwgdmMgPSB2dC5nZXRDb250ZXh0KCksIGcgPSB2Yy5jcmVhdGVSYWRpYWxHcmFkaWVudCgxMjgsIDEyOCwgMCwgMTI4LCAxMjgsIDEyOCk7XG4gIGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDAsMCwwLDApJyk7IGcuYWRkQ29sb3JTdG9wKDAuNDIsICdyZ2JhKDAsMCwwLDApJyk7IGcuYWRkQ29sb3JTdG9wKDAuOCwgJ3JnYmEoMCw0LDYsMC43KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgwLDQsNiwwLjk1KScpO1xuICB2Yy5maWxsU3R5bGUgPSBnOyB2Yy5maWxsUmVjdCgwLCAwLCAyNTYsIDI1Nik7IHZ0LnVwZGF0ZSgpOyB2dC5oYXNBbHBoYSA9IHRydWU7XG4gIGNvbnN0IHZpZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCd2aWcnLCB7IHdpZHRoOiA0NiwgaGVpZ2h0OiAzMCB9LCBzY2VuZSk7IHZpZy5wb3NpdGlvbi55ID0gMC4wMzsgdmlnLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgY29uc3Qgdm0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd2aWdtJywgc2NlbmUpOyB2bS5kaWZmdXNlVGV4dHVyZSA9IHZ0OyB2bS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHZtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHZtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMCwgMC4wMSwgMC4wMTUpOyB2bS5kaXNhYmxlRGVwdGhXcml0ZSA9IHRydWU7IHZpZy5tYXRlcmlhbCA9IHZtOyB2aWcuYWxwaGFJbmRleCA9IDE7XG4gIHJldHVybiB7IHdhbGxNYXQ6IHdtLCBtaXN0TWF0czogbGF5ZXJzLm1hcCgobCkgPT4gbC5tKSwgdXBkYXRlOiAodDogbnVtYmVyKSA9PiB7IGZvciAoY29uc3QgbCBvZiBsYXllcnMpIHsgbC50LnVPZmZzZXQgPSB0ICogKDAuMDA2ICsgbC5uICogMC4wMDQpOyBsLnQudk9mZnNldCA9IHQgKiAwLjAwMyAqIChsLm4gPyAtMSA6IDEpOyB9IH0gfTtcbn1cbiIsICIvLyBFbmRsZXNzIERlcHRoczogZW5lbXkgd2F2ZXMgYnVpbHQgZnJvbSBhIEJVREdFVCBpbnN0ZWFkIG9mIGEgaGFuZC13cml0dGVuIGxpc3QsIHNvIHRoZSBtb2RlIG5ldmVyIHJ1bnMgb3V0IG9mIHdhdmVzLlxuLy8gVGhlIGJ1ZGdldCBpcyB0aGUgZW5lbXkgdGVhbSdzIHRvdGFsIERvbWluaW9uIGNvc3QgKHRoZSBzYW1lIENPU1QgdGFibGUgdGhlIHBsYXllciBwYXlzIGZyb20pLiBXYXZlcyBhcmUgYnVpbHQgZnJvbSByb2xlIFRFTVBMQVRFUyBzbyB0aGV5XG4vLyBsb29rIGRlc2lnbmVkIChhIGZyb250IGxpbmUgd2l0aCBhcmNoZXJzIGJlaGluZCwgYSBzd2FybSwgYSBicnV0ZSBzcXVhZCkgaW5zdGVhZCBvZiBhIHJhbmRvbSBwaWxlLiBFdmVyeXRoaW5nIGlzIHNlZWRlZDogdGhlIHNhbWUgc2VlZCBnaXZlc1xuLy8gdGhlIHNhbWUgd2F2ZXMsIHNvIGEgcmV0cnkgKG9yIGEgZGFpbHkgc2VlZCkgZmFjZXMgZXhhY3RseSB0aGUgc2FtZSBhcm15LlxuLy9cbi8vIFRoZSBwbGF5ZXIncyBhcm15IGlzIGNhcHBlZCBvbiBwdXJwb3NlIChEb21pbmlvbiBzdG9wcyBhdCA0MCwgdGhlIGdyaWQgaG9sZHMgMTIpLCBzbyBhdCBzb21lIHBvaW50IHRoZSBlbmVteSBzaW1wbHkgb3V0LXNjYWxlcyBpdDogdGhhdCBpcyB0aGVcbi8vIFwiaGFyZCB3YWxsXCIuIE9uY2UgdGhlIGJ1ZGdldCBmaWxscyB0aGUgMTIgc2xvdHMgd2l0aCB1cGdyYWRlZCB1bml0cywgYGVuZGxlc3NQb3dlcmAgKHRoZSBoaWRkZW4gaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyKSBrZWVwcyBjbGltYmluZy5cbi8vIE51bWJlcnMgaGVyZSBhcmUgdHVuZWQgd2l0aCBzaW0vZW5kbGVzc19jdXJ2ZS50cy5cblxuaW1wb3J0IHsgQ09TVCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBFbmVteVNwZWMgfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB7IGJvc3NFeHRyYUNvc3QgfSBmcm9tICcuL3dhdmVzLnRzJztcblxuZXhwb3J0IGNvbnN0IEVORExFU1NfSUQgPSAnZW5kbGVzcyc7XG4vKiogQSBwYWNrIGlzIGdyYW50ZWQgZXZlcnkgdGhpcy1tYW55IHdhdmVzIGNsZWFyZWQgaW4gYW4gZW5kbGVzcyBydW4uICovXG5leHBvcnQgY29uc3QgRU5ETEVTU19QQUNLX0VWRVJZID0gMTA7XG5jb25zdCBNQVhfVU5JVFMgPSAxMjtcblxuLyoqIFRoZSB0dW5pbmcga25vYnMgKHNpbS9lbmRsZXNzX2N1cnZlLnRzIHN3ZWVwcyB0aGVtKS4gKi9cbmV4cG9ydCBjb25zdCBUVU5FID0geyBzdGFydDogNSwgc2xvcGU6IDMuMCwgbGF0ZVNsb3BlOiAwLjgsIG1heEJ1ZGdldDogMTUwLCBwb3dlclNsb3BlOiAwLjAxMiwgY2hhbXBpb246IDEuMCB9O1xuLyoqIFRvdGFsIERvbWluaW9uIGNvc3Qgb2YgdGhlIGVuZW15IHRlYW0gYXQgd2F2ZSBgbmAgKDEtYmFzZWQpOiBhIGdlbnRsZSBzdGFydCAoYWJvdXQgdGhlIE5vcm1hbCBjYW1wYWlnbiBieSB3YXZlIDEwKSwgdGhlbiBpdCBrZWVwcyByaXNpbmcuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc0J1ZGdldChuOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgbiksIGVhcmx5ID0gVFVORS5zdGFydCArIFRVTkUuc2xvcGUgKiAoTWF0aC5taW4odywgMTApIC0gMSk7XG4gIHJldHVybiBNYXRoLnJvdW5kKE1hdGgubWluKFRVTkUubWF4QnVkZ2V0LCBlYXJseSArICh3ID4gMTAgPyBUVU5FLmxhdGVTbG9wZSAqICh3IC0gMTApIDogMCkpKTtcbn1cbi8qKiBIaWRkZW4gZW5lbXkgaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyOiAxLjAgdGhyb3VnaCB3YXZlIDEwLCB0aGVuIHJpc2luZzsgZXZlcnkgMTB0aCAoY2hhbXBpb24pIHdhdmUgZ2V0cyBhIGxpdHRsZSBleHRyYS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzUG93ZXIobjogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDEsIG4pLCBiYXNlID0gdyA8PSAxMCA/IDEgOiAxICsgVFVORS5wb3dlclNsb3BlICogKHcgLSAxMCk7XG4gIHJldHVybiArKHcgJSAxMCA9PT0gMCA/IGJhc2UgKiBUVU5FLmNoYW1waW9uIDogYmFzZSkudG9GaXhlZCgzKTtcbn1cbi8qKiBQYWNrIHRpZXIgZm9yIGNsZWFyaW5nIHdhdmUgYG5gIChvbmx5IG1lYW5pbmdmdWwgd2hlbiBuIGlzIGEgbXVsdGlwbGUgb2YgRU5ETEVTU19QQUNLX0VWRVJZKS4gKi9cbmV4cG9ydCBjb25zdCBlbmRsZXNzUGFja1RpZXIgPSAobjogbnVtYmVyKTogbnVtYmVyID0+IChuID49IDMwID8gMyA6IG4gPj0gMjAgPyAyIDogMSk7XG5cbnR5cGUgUm9sZSA9ICd0YW5rJyB8ICdicnV0ZScgfCAncmFuZ2VkJyB8ICdmb2RkZXInO1xuY29uc3QgUk9MRTogUmVjb3JkPFJvbGUsIFNvdWxJZFtdPiA9IHsgdGFuazogWydrbmlnaHQnLCAnb2dyZSddLCBicnV0ZTogWydiYXJiYXJpYW4nLCAnb2dyZSddLCByYW5nZWQ6IFsnYXJjaGVyJ10sIGZvZGRlcjogWyd3YXJyaW9yJywgJ2dvYmxpbiddIH07XG5leHBvcnQgaW50ZXJmYWNlIFRlbXBsYXRlIHsgaWQ6IHN0cmluZzsgbWl4OiBbUm9sZSwgbnVtYmVyXVtdIH1cbmV4cG9ydCBjb25zdCBURU1QTEFURVM6IFRlbXBsYXRlW10gPSBbXG4gIHsgaWQ6ICd3YWxsJywgbWl4OiBbWyd0YW5rJywgM10sIFsncmFuZ2VkJywgMl0sIFsnZm9kZGVyJywgMV1dIH0sXG4gIHsgaWQ6ICdzd2FybScsIG1peDogW1snZm9kZGVyJywgNV0sIFsncmFuZ2VkJywgMV0sIFsndGFuaycsIDFdXSB9LFxuICB7IGlkOiAnYnJ1dGVzJywgbWl4OiBbWydicnV0ZScsIDRdLCBbJ2ZvZGRlcicsIDFdLCBbJ3JhbmdlZCcsIDFdXSB9LFxuICB7IGlkOiAnbWl4ZWQnLCBtaXg6IFtbJ3RhbmsnLCAxXSwgWydicnV0ZScsIDFdLCBbJ3JhbmdlZCcsIDFdLCBbJ2ZvZGRlcicsIDJdXSB9LFxuXTtcblxuLyoqIFdhdmVzIDEtMiBhcmUgYSBnZW50bGUgd2FybS11cDogY2hlYXAgZm9kZGVyIChhbmQgYW4gYXJjaGVyKSwgbm8gdGFua3Mgb3IgYnJ1dGVzLCBzbyBub2JvZHkgbG9zZXMgYSBoZWFydCB0byB0aGUgZmlyc3QgZmlnaHQuICovXG5jb25zdCBXQVJNVVA6IFRlbXBsYXRlID0geyBpZDogJ3dhcm11cCcsIG1peDogW1snZm9kZGVyJywgM10sIFsncmFuZ2VkJywgMV1dIH07XG4vKiogV2hpY2ggdGVtcGxhdGUgYSB3YXZlIHVzZXMgKHNlZWRlZCBwZXIgd2F2ZSwgc28gaXQgZG9lcyBub3QgZGVwZW5kIG9uIHdoYXQgY2FtZSBiZWZvcmUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NUZW1wbGF0ZShuOiBudW1iZXIsIHNlZWQ6IG51bWJlcik6IFRlbXBsYXRlIHtcbiAgaWYgKG4gPD0gMikgcmV0dXJuIFdBUk1VUDtcbiAgcmV0dXJuIFRFTVBMQVRFU1tNYXRoLmZsb29yKG1ha2VSbmcoc2VlZCAqIDQwOTkgKyBuICogMzEgKyA1KS5uZXh0KCkgKiBURU1QTEFURVMubGVuZ3RoKV07XG59XG5cbi8qKiBUaGUgZW5lbXkgYXJteSBmb3IgZW5kbGVzcyB3YXZlIGBuYCAoMS1iYXNlZCkuIEF0IG1vc3QgMTIgdW5pdHM7IHRoZSB3aG9sZSBidWRnZXQgaXMgc3BlbnQgdW5sZXNzIG5vIHVuaXQgZml0cyB3aGF0IGlzIGxlZnQuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc1dhdmUobjogbnVtYmVyLCBzZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgY29uc3Qgd2F2ZSA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IobikpLCBybmcgPSBtYWtlUm5nKHNlZWQgKiAxMDA5ICsgd2F2ZSAqIDc5MTkgKyAxNyksIHRwbCA9IGVuZGxlc3NUZW1wbGF0ZSh3YXZlLCBzZWVkKTtcbiAgbGV0IGxlZnQgPSBlbmRsZXNzQnVkZ2V0KHdhdmUpOyBjb25zdCBhcm15OiBFbmVteVNwZWNbXSA9IFtdO1xuICBpZiAod2F2ZSAlIDEwID09PSAwICYmIGxlZnQgPj0gMjApIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNoYW1waW9uIHdhdmU6IG9uZSBzdGFycmVkIGJydXRlIHVwIGZyb250ICgyIHN0YXJzLCAzIGZyb20gd2F2ZSA0MCksIHRoZW4gdGhlIHVzdWFsIGVzY29ydFxuICAgIGNvbnN0IHNvdWw6IFNvdWxJZCA9IHJuZy5uZXh0KCkgPCAwLjUgPyAnb2dyZScgOiAna25pZ2h0Jywgc3RhciA9IHdhdmUgPj0gNDAgPyAzIDogMjsgYXJteS5wdXNoKHsgc291bCwgc3RhciwgYm9zczogdHJ1ZSB9KTsgbGVmdCAtPSBDT1NUW3NvdWxdW3N0YXIgLSAxXSArIE1hdGgucm91bmQoYm9zc0V4dHJhQ29zdChDT1NUW3NvdWxdW3N0YXIgLSAxXSkpOyAgIC8vIHRoZSBib3NzIHBheXMgZm9yIGl0cyBleHRyYSBzdHJlbmd0aCBvdXQgb2YgdGhlIGVzY29ydCBidWRnZXRcbiAgfVxuICBjb25zdCB0b3RhbCA9IHRwbC5taXgucmVkdWNlKChhLCBbLCB3XSkgPT4gYSArIHcsIDApO1xuICBmb3IgKGxldCBndWFyZCA9IDA7IGd1YXJkIDwgODAgJiYgYXJteS5sZW5ndGggPCBNQVhfVU5JVFMgJiYgbGVmdCA+PSAyOyBndWFyZCsrKSB7XG4gICAgbGV0IHIgPSBybmcubmV4dCgpICogdG90YWwsIHJvbGU6IFJvbGUgPSB0cGwubWl4WzBdWzBdO1xuICAgIGZvciAoY29uc3QgW3JvLCB3XSBvZiB0cGwubWl4KSB7IHIgLT0gdzsgaWYgKHIgPD0gMCkgeyByb2xlID0gcm87IGJyZWFrOyB9IH1cbiAgICBsZXQgb3B0aW9ucyA9IFJPTEVbcm9sZV0uZmlsdGVyKChzKSA9PiBDT1NUW3NdWzBdIDw9IGxlZnQpO1xuICAgIGlmICghb3B0aW9ucy5sZW5ndGgpIG9wdGlvbnMgPSBST0xFLmZvZGRlci5maWx0ZXIoKHMpID0+IENPU1Rbc11bMF0gPD0gbGVmdCk7XG4gICAgaWYgKCFvcHRpb25zLmxlbmd0aCkgYnJlYWs7XG4gICAgY29uc3Qgc291bCA9IHJuZy5waWNrKG9wdGlvbnMpLCBwZXIgPSBsZWZ0IC8gTWF0aC5tYXgoMSwgTUFYX1VOSVRTIC0gYXJteS5sZW5ndGgpO1xuICAgIGxldCBzdGFyID0gMTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc3BhcmUgYnVkZ2V0IHBlciBmcmVlIHNsb3QgYnV5cyBzdGFyc1xuICAgIGZvciAobGV0IHMgPSAzOyBzID49IDI7IHMtLSkgaWYgKENPU1Rbc291bF1bcyAtIDFdIDw9IGxlZnQgJiYgQ09TVFtzb3VsXVtzIC0gMV0gPD0gTWF0aC5tYXgoQ09TVFtzb3VsXVswXSwgcGVyICogMS4yKSkgeyBzdGFyID0gczsgYnJlYWs7IH1cbiAgICBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICB9XG4gIHJldHVybiBhcm15O1xufVxuIiwgIi8vIEVuZW15IHdhdmVzIGFuZCB0aGUgY2FtcGFpZ24ncyBzdGFnZXMuIFNhbWUgdW5pdCBwb29sIGFzIHRoZSBwbGF5ZXIuIFRoZSBidWlsZCBzY3JlZW4gcHJldmlld3MgdGhlIENPTVBPU0lUSU9OIG9ubHksIG5ldmVyIHBvc2l0aW9ucy5cbi8vXG4vLyBFYWNoIFNUQUdFIGhhcyBmb3VyIGRpZmZpY3VsdHkgdGllcnMgKGVhc3kgLyBub3JtYWwgLyBoYXJkIC8gbmlnaHRtYXJlKS4gTGF0ZXIgc3RhZ2VzIGFyZSBoYXJkZXI6IHRoZXkgcmV1c2UgdG91Z2hlciB3YXZlIGxpc3RzIGFuZCBhIGhpZGRlblxuLy8gRU5FTVkgUE9XRVIgbXVsdGlwbGllciAoaGVhbHRoIGFuZCBkYW1hZ2Ugb2YgZW5lbXkgdW5pdHMpIHR1bmVkIHBlciBzdGFnZSBhbmQgdGllciB3aXRoIHNpbS9jYWxpYnJhdGVfcG93ZXIudHMsIHNvIHRoYXQgdGhlIGNvbXBldGVudFxuLy8gc3RhbmQtaW4gcGxheWVyIGNsZWFycyBlYWNoIHRpZXIgYWJvdXQgNjAlIG9mIHRoZSB0aW1lIGF0IHRoYXQgdGllcidzIFJFQ09NTUVOREVEIFNPVUwgTEVWRUwgKGV2ZXJ5IFNvdWwgYXQgdGhhdCBsZXZlbCkuXG4vLyBVbmxvY2sgcnVsZXMgbGl2ZSBpbiBwcm9ncmVzcy50czogRWFzeSBhbmQgTm9ybWFsIGFyZSBhbHdheXMgb3BlbjsgY2xlYXJpbmcgTm9ybWFsIG9wZW5zIEhhcmQgYW5kIHRoZSBuZXh0IHN0YWdlOyBjbGVhcmluZyBIYXJkIG9wZW5zIE5pZ2h0bWFyZS5cblxuaW1wb3J0IHsgQ09TVCwgQ1VSVkVTLCBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBFTkRMRVNTX0lELCBlbmRsZXNzUG93ZXIsIGVuZGxlc3NXYXZlIH0gZnJvbSAnLi9lbmRsZXNzLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRW5lbXlTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGJvc3M/OiBib29sZWFuIH1cbmV4cG9ydCB0eXBlIERpZmYgPSAnZWFzeScgfCAnbm9ybWFsJyB8ICdoYXJkJyB8ICduaWdodG1hcmUnO1xuZXhwb3J0IGNvbnN0IERJRkZTOiBEaWZmW10gPSBbJ2Vhc3knLCAnbm9ybWFsJywgJ2hhcmQnLCAnbmlnaHRtYXJlJ107XG5cbmNvbnN0IExFVFRFUjogUmVjb3JkPHN0cmluZywgU291bElkPiA9IHsgVzogJ3dhcnJpb3InLCBBOiAnYXJjaGVyJywgRzogJ2dvYmxpbicsIEs6ICdrbmlnaHQnLCBPOiAnb2dyZScsIEI6ICdiYXJiYXJpYW4nIH07XG5jb25zdCBwYXJzZVdhdmUgPSAoczogc3RyaW5nKTogRW5lbXlTcGVjW10gPT4gcy5zcGxpdCgnICcpLm1hcCgodCkgPT4gKHsgc291bDogTEVUVEVSW3RbMF1dLCBzdGFyOiArdFsxXSB9KSk7XG5cbi8qKlxuICogV2F2ZSBsaXN0cyAoVyB3YXJyaW9yLCBBIGFyY2hlciwgRyBnb2JsaW4sIEsga25pZ2h0LCBPIG9ncmUsIEIgYmFyYmFyaWFuOyBkaWdpdCA9IHN0YXJzKS4gVGhlc2UgZm91ciB3ZXJlIHR1bmVkIGZvciBTdGFnZSAxOyBsYXRlciBzdGFnZXNcbiAqIHJldXNlIHRoZW0gb25lIHRpZXIgdXAgYW5kIGFkZCBlbmVteSBwb3dlci4gSGFyZCBhbmQgTmlnaHRtYXJlIGFyZSB2b2x1bWUtZHJpdmVuICh1cCB0byAxMiBlbmVtaWVzKS5cbiAqIENvbXBldGVudCBzdGFuZC1pbiBjbGVhciByYXRlIHdpdGggRVZFUlkgU291bCBhdCBsZXZlbCAxIC8gNCAvIDY6IGVhc3kgOTgvMTAwLzEwMCwgbm9ybWFsIDgyLzk4LzEwMCwgaGFyZCA3LzYwLzg3LCBuaWdodG1hcmUgMC8zMy83NC5cbiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFk6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMScsICdLMSBXMScsICdPMSBXMSBHMScsICdLMSBBMSBXMScsICdPMSBBMSBHMScsICdLMSBPMSBBMScsICdLMSBPMSBBMSBHMScsICdPMSBLMSBBMSBHMScsICdPMSBLMSBBMSBCMScsICdPMiBLMSBBMSBHMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEnLCAnTzEgQTEgRzEgVzEnLCAnSzEgTzEgQTEgVzEnLCAnTzEgSzEgQTEgRzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEnLCAnSzEgTzEgQTEgRzEgVzEnLCAnTzEgSzEgQTEgQjEgRzEnLCAnTzEgSzEgQTIgQjEgRzEnLCAnTzIgSzEgQTEgQjEgRzEgVzEnXSxcbiAgaGFyZDogWydXMSBBMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBBMSBHMSBXMSBXMScsICdLMSBPMSBBMSBXMSBHMSBXMScsICdPMSBLMSBBMiBHMSBXMSBXMSBXMScsICdBMiBLMSBPMSBHMSBXMSBCMSBXMSBXMScsICdLMSBPMSBBMSBHMSBXMiBXMSBXMScsICdPMSBLMSBBMiBCMSBHMSBXMSBXMSBHMScsICdPMiBLMSBBMiBCMSBHMSBXMSBXMSBHMScsICdPMiBLMiBBMSBCMSBHMSBXMSBXMSBXMSBHMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgQTEgRzEgVzEgQjEgVzEnLCAnSzEgTzEgQTEgVzEgRzEgVzEgVzEnLCAnTzEgSzEgQTIgRzEgVzEgQjEgVzEgVzEgRzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEgVzEgVzEgRzEgRzEnLCAnSzEgTzEgQTIgRzEgVzEgQjEgVzEgVzEgRzEgRzEgQjEnLCAnTzEgSzIgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEnLCAnTzIgSzEgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEgSzEnLCAnTzIgSzIgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEgSzEnXSxcbn07XG5cbi8qKiBTdGFnZSAyLCB0aGUgU3Vua2VuIEdyYXZleWFyZDogY3Jvd2RzLiBTYW1lIERvbWluaW9uIGNvc3QgcGVyIHdhdmUgYXMgdGhlIGxpc3RzIG9uZSB0aWVyIHVwLCBidXQgYnVpbHQgZnJvbSBtYW55IFdhcnJpb3JzLCBHb2JsaW5zIGFuZCBBcmNoZXJzIHdpdGggYSBLbmlnaHQgb3IgT2dyZSBob2xkaW5nIHRoZSBmcm9udCAoc2ltL2F1dGhvcl9zdGFnZXMudHMpLiAqL1xuY29uc3QgR1JBVkVZQVJEOiBSZWNvcmQ8RGlmZiwgc3RyaW5nW10+ID0ge1xuICBlYXN5OiBbJ1cxIEExJywgJ0sxIEcxIFcxJywgJ08xIFcxIFcxIFcxIEcxJywgJ08xIEcyIEcxIEExJywgJ08xIFcxIFcxIFcxIEExIEExJywgJ0sxIFcxIFcxIFcxIEExIEExIEExJywgJ08xIFcxIFcxIFcxIFcxIFcxIEExJywgJ08xIFcxIFcxIFcxIFcxIEcxIEcxIEcxJywgJ0sxIFcxIFcxIFcxIFcxIFcxIEcyIEcxIEExJywgJ0sxIFcxIFcxIFcxIFcxIEcxIEcxIEcxIEcxIEExJ10sXG4gIG5vcm1hbDogWydXMSBBMScsICdLMSBHMSBXMSBBMSBXMScsICdLMSBXMSBXMSBXMSBHMSBBMScsICdPMSBXMSBXMSBHMSBHMSBHMSBHMScsICdPMSBXMiBXMSBXMSBXMSBXMSBXMSBHMSBBMScsICdLMSBXMSBXMSBXMSBXMSBXMSBHMSBHMSBHMSBBMSBBMScsICdLMSBXMSBXMSBXMSBHMSBBMSBBMSBBMScsICdPMSBXMSBXMSBHMSBHMSBBMSBBMSBBMSBBMScsICdLMiBXMSBXMSBXMSBXMSBXMSBXMSBHMSBHMSBHMSBBMSBBMScsICdPMSBXMiBXMSBXMSBXMSBXMSBXMSBHMSBHMSBBMSBBMSBBMSddLFxuICBoYXJkOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ08xIFcxIFcxIFcxIFcxIEcyIEExJywgJ08xIFcxIFcxIEcxIEcxIEExIEExJywgJ08xIFcxIFcxIFcxIFcxIFcxIEcxIEcxIEExIEExIEExJywgJ0sxIFczIFcyIFcyIFcyIFcxIFcxIFcxIFcxIEExIEExIEExJywgJ08xIFczIFcyIFcyIFcyIFcyIFcxIFcxIFcxIEczIEcyIEExJywgJ08yIFcyIFcyIFcxIFcxIFcxIEcyIEcxIEcxIEcxIEEyIEExJywgJ0szIFczIFczIFczIFcyIFcyIFcxIFcxIEcyIEcxIEcxIEEzJywgJ0szIFczIFczIFcyIFcyIFcxIEczIEcyIEcyIEcxIEEyIEExJ10sXG4gIG5pZ2h0bWFyZTogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBXMSBXMSBXMSBHMSBHMSBBMScsICdPMSBXMSBXMSBXMSBXMSBHMSBHMSBBMScsICdLMSBXMSBXMSBXMSBXMSBXMSBXMSBXMSBXMSBBMiBBMSBBMScsICdPMSBXMyBXMiBXMSBXMSBXMSBXMSBXMSBHMiBHMSBHMSBBMScsICdPMSBXMiBXMSBXMSBXMSBHMiBHMSBHMSBHMSBBMiBBMSBBMScsICdPMiBXMiBXMSBXMSBXMSBXMSBHMiBHMSBHMSBBMiBBMSBBMScsICdLMiBXMyBXMSBXMSBXMSBHMiBHMiBHMSBBMyBBMiBBMSBBMScsICdPMiBXMSBXMSBXMSBHMiBHMiBHMiBHMSBHMSBBMyBBMiBBMSddLFxufTtcbi8qKiBTdGFnZSAzLCB0aGUgQm9uZSBCYXN0aW9uOiBmZXdlciwgaGVhdmllciBhcm1pZXMgb2YgS25pZ2h0cywgT2dyZXMgYW5kIEJhcmJhcmlhbnMgd2l0aCBBcmNoZXJzIGJlaGluZCAoc2ltL2F1dGhvcl9zdGFnZXMudHMpLiAqL1xuY29uc3QgQkFTVElPTjogUmVjb3JkPERpZmYsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMSBBMScsICdLMSBHMSBXMSBBMSBXMScsICdLMSBLMSBBMSBBMScsICdLMSBLMSBLMSBBMSBBMScsICdLMSBPMSBCMSBCMSBBMScsICdLMSBLMSBPMSBPMSBBMSBBMScsICdLMSBLMSBPMSBCMSBBMScsICdLMSBLMSBLMSBPMSBCMSBCMScsICdLMiBLMSBPMSBPMSBCMSBCMScsICdLMSBLMSBPMSBPMSBCMSBCMSBBMSddLFxuICBub3JtYWw6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgSzEgQTEgQTEnLCAnTzEgTzEgQjEgQjEnLCAnSzIgSzEgSzEgTzEgQjEgQjEnLCAnSzEgTzEgTzEgQjEgQjEgQTEgQTEnLCAnSzIgSzEgSzEgSzEgQjIgQjEgQjEgQTEnLCAnSzIgSzEgSzEgTzEgQjEgQjEgQTIgQTEnLCAnSzIgSzIgTzIgQjEgQjEgQTIgQTIgQTEnLCAnSzIgSzIgSzIgSzEgQjIgQjIgQTMgQTEnXSxcbiAgaGFyZDogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdLMSBLMSBCMSBBMSBBMScsICdLMSBLMSBPMSBBMSBBMScsICdLMSBPMSBCMSBCMSBCMSBBMSBBMScsICdLMSBLMSBLMSBPMSBPMSBCMSBBMScsICdLMSBLMSBLMSBLMSBPMSBCMSBCMSBCMScsICdLMiBLMSBLMSBPMSBPMSBCMSBCMSBBMScsICdLMiBLMSBPMSBPMSBCMSBCMSBCMSBBMycsICdLMiBLMiBLMSBLMSBPMSBPMSBCMyBCMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgTzEgQjEnLCAnSzIgSzEgSzEgTzEnLCAnSzIgSzEgSzEgSzEgSzEgTzEnLCAnSzEgSzEgSzEgTzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgQjIgQjEgQjEgQTIgQTEnLCAnSzEgTzEgTzEgTzEgQjIgQTEgQTEgQTEnLCAnSzEgTzIgTzEgTzEgTzEgQjEgQjEgQTEnLCAnSzMgSzIgSzEgSzEgSzEgTzIgQjEgQjEnXSxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhZ2VEZWYge1xuICBpZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IGJsdXJiOiBzdHJpbmc7XG4gIGxpc3RzOiBSZWNvcmQ8RGlmZiwgc3RyaW5nW10+OyAgICAgICAgICAvLyB0aGUgMTAgZW5lbXkgd2F2ZXMgZm9yIGVhY2ggdGllclxuICBwb3dlcjogUmVjb3JkPERpZmYsIG51bWJlcj47ICAgICAgICAgICAgLy8gaGlkZGVuIGVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgZWFjaCB0aWVyICgxID0gYXMgd3JpdHRlbilcbiAgcmVjOiBSZWNvcmQ8RGlmZiwgbnVtYmVyPjsgICAgICAgICAgICAgIC8vIHJlY29tbWVuZGVkIFNvdWwgbGV2ZWwgZm9yIGVhY2ggdGllciAoYSBoaW50IG9uIEhvbWUsIG5ldmVyIGEgbG9jaylcbn1cblxuLyoqIFRoZSBjYW1wYWlnbi4gTmFtZXMgYXJlIHBsYWNlaG9sZGVycy4gUG93ZXIgbnVtYmVycyBjb21lIGZyb20gc2ltL2NhbGlicmF0ZV9wb3dlci50cy4gKi9cbmV4cG9ydCBjb25zdCBTVEFHRVM6IFN0YWdlRGVmW10gPSBbXG4gIHsgaWQ6ICdjcnlwdCcsIG5hbWU6ICdUaGUgUmVzdGxlc3MgQ3J5cHQnLCBibHVyYjogJ1JhaXNlIHlvdXIgYXJteS4gVGhlIGRlYWQgaGVyZSBhcmUgb25seSBqdXN0IHN0aXJyaW5nLicsXG4gICAgbGlzdHM6IHsgZWFzeTogRElGRklDVUxUWS5lYXN5LCBub3JtYWw6IERJRkZJQ1VMVFkubm9ybWFsLCBoYXJkOiBESUZGSUNVTFRZLmhhcmQsIG5pZ2h0bWFyZTogRElGRklDVUxUWS5uaWdodG1hcmUgfSxcbiAgICBwb3dlcjogeyBlYXN5OiAxLCBub3JtYWw6IDEsIGhhcmQ6IDEsIG5pZ2h0bWFyZTogMSB9LCByZWM6IHsgZWFzeTogMSwgbm9ybWFsOiAxLCBoYXJkOiA0LCBuaWdodG1hcmU6IDYgfSB9LFxuICB7IGlkOiAnZ3JhdmV5YXJkJywgbmFtZTogJ1RoZSBTdW5rZW4gR3JhdmV5YXJkJywgYmx1cmI6ICdCaWdnZXIgY3Jvd2RzIGNyYXdsIG91dCBvZiB0aGUgbXVkLiBMZXZlbCB5b3VyIFNvdWxzIGJlZm9yZSB5b3UgY29tZS4nLFxuICAgIGxpc3RzOiBHUkFWRVlBUkQsXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLjEsIGhhcmQ6IDAuOTgsIG5pZ2h0bWFyZTogMS4yOCB9LCByZWM6IHsgZWFzeTogMiwgbm9ybWFsOiA0LCBoYXJkOiA2LCBuaWdodG1hcmU6IDggfSB9LFxuICB7IGlkOiAnYmFzdGlvbicsIG5hbWU6ICdUaGUgQm9uZSBCYXN0aW9uJywgYmx1cmI6ICdBIGZvcnRyZXNzIG9mIHRoZSBmYWxsZW4uIE9ubHkgd2VsbC1sZXZlbGxlZCBhcm1pZXMgaG9sZCB0aGUgZ2F0ZS4nLFxuICAgIGxpc3RzOiBCQVNUSU9OLFxuICAgIHBvd2VyOiB7IGVhc3k6IDEsIG5vcm1hbDogMC45NywgaGFyZDogMS4yNSwgbmlnaHRtYXJlOiAxLjQ1IH0sIHJlYzogeyBlYXN5OiA0LCBub3JtYWw6IDYsIGhhcmQ6IDgsIG5pZ2h0bWFyZTogMTAgfSB9LFxuXTtcbmV4cG9ydCBjb25zdCBzdGFnZUluZGV4ID0gKGlkOiBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMCwgU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gaWQpKTtcbmV4cG9ydCBjb25zdCBzdGFnZUJ5SWQgPSAoaWQ6IHN0cmluZyk6IFN0YWdlRGVmID0+IFNUQUdFU1tzdGFnZUluZGV4KGlkKV07XG5cbi8qKiBOYW1lcyBhbmQgb25lLWxpbmUgcHJvbWlzZXMgZm9yIHRoZSBkaWZmaWN1bHR5IHBpY2tlci4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZX0lORk8gPSBbXG4gIHsgaWQ6ICdlYXN5JywgbGFiZWw6ICdFYXN5JywgYmx1cmI6ICdTbWFsbGVyIGVuZW15IGFybWllcy4gUmVsYXggYW5kIGxlYXJuIGhvdyBtZXJnaW5nIHdvcmtzLicgfSxcbiAgeyBpZDogJ25vcm1hbCcsIGxhYmVsOiAnTm9ybWFsJywgYmx1cmI6ICdUaGUgc3RhbmRhcmQgZmlnaHQuIENsZWFyaW5nIGl0IHVubG9ja3MgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2UuJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnQmlnZ2VyIGFybWllcyB3aXRoIG1vcmUgZm9kZGVyLiBCZXR0ZXIgZmlyc3QtY2xlYXIgcmV3YXJkcy4gQ2xlYXJpbmcgaXQgdW5sb2NrcyBOaWdodG1hcmUuJyB9LFxuICB7IGlkOiAnbmlnaHRtYXJlJywgbGFiZWw6ICdOaWdodG1hcmUnLCBibHVyYjogJ0EgcGFja2VkIGJhdHRsZWZpZWxkIG9mIHN0YXJzIGFuZCBza2lsbHMuIEJ1aWx0IGZvciB3ZWxsLWxldmVsbGVkIFNvdWxzLicgfSxcbl07XG5cbi8vIC0tLS0gd2hhdCB0aGUgbmV4dCBiYXR0bGUgdXNlcyAoc2V0IHdoZW4gYSBydW4gc3RhcnRzKVxuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZTogc3RyaW5nID0gJ25vcm1hbCc7XG5leHBvcnQgbGV0IGN1cnJlbnRTdGFnZUlkOiBzdHJpbmcgPSAnY3J5cHQnO1xubGV0IHBvd2VyID0gMSwgZW5kbGVzc01vZGUgPSBmYWxzZSwgYm9zc1N0ciA9IDE7XG4vKiogSG93IGhhcmQgdGhlIGJvc3MgaGl0cyBmb3IgdGhlIGN1cnJlbnQgbW9kZSAoMCA9IGFuIG9yZGluYXJ5IHVuaXQsIDEgPSB0aGUgZnVsbCBib3NzKTogZ2VudGxlIG9uIEVhc3ksIGZ1bGwgb24gTmlnaHRtYXJlIGFuZCBpbiBFbmRsZXNzLiAqL1xuZXhwb3J0IGNvbnN0IGJvc3NTdHJlbmd0aCA9ICgpOiBudW1iZXIgPT4gYm9zc1N0cjtcbmNvbnN0IEJPU1NfQllfVElFUjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHsgZWFzeTogMC4yLCBub3JtYWw6IDAuNSwgaGFyZDogMC44LCBuaWdodG1hcmU6IDEgfTtcbmxldCBkYWlseVJld3JpdGU6ICgodzogRW5lbXlTcGVjW10sIHdhdmU6IG51bWJlcikgPT4gRW5lbXlTcGVjW10pIHwgbnVsbCA9IG51bGw7ICAgLy8gc2V0IG9ubHkgZHVyaW5nIGEgRGFpbHkgQ2hhbGxlbmdlIHJ1blxuLyoqIEVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGN1cnJlbnQgc3RhZ2UgYW5kIHRpZXIgKGluIGVuZGxlc3MgbW9kZSBpdCBkZXBlbmRzIG9uIHRoZSB3YXZlKS4gKi9cbmV4cG9ydCBjb25zdCBlbmVteVBvd2VyID0gKHdhdmUgPSAxKTogbnVtYmVyID0+IChlbmRsZXNzTW9kZSA/IGVuZGxlc3NQb3dlcih3YXZlKSA6IHBvd2VyKTtcbmV4cG9ydCBjb25zdCBpc0VuZGxlc3MgPSAoKTogYm9vbGVhbiA9PiBlbmRsZXNzTW9kZTtcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyICgxMCB3YXZlcykuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXRTdGFnZURpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFN0YWdlRGlmZmljdWx0eShzdGFnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBzdGFnZUJ5SWQoc3RhZ2UpOyBpZiAoIURJRkZTLmluY2x1ZGVzKG5hbWUgYXMgRGlmZikpIHJldHVybjtcbiAgZW5kbGVzc01vZGUgPSBmYWxzZTsgZGFpbHlSZXdyaXRlID0gbnVsbDsgYm9zc1N0ciA9IEJPU1NfQllfVElFUltuYW1lXSA/PyAwLjU7IGN1cnJlbnRTdGFnZUlkID0gc3QuaWQ7IGRpZmZpY3VsdHlOYW1lID0gbmFtZTsgcG93ZXIgPSBzdC5wb3dlcltuYW1lIGFzIERpZmZdO1xuICBBVVRIT1JFRC5sZW5ndGggPSAwOyBzdC5saXN0c1tuYW1lIGFzIERpZmZdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG4vKiogU3dpdGNoIHRvIHRoZSBEYWlseSBDaGFsbGVuZ2U6IFN0YWdlIDEgTm9ybWFsIHdpdGggdGhlIGRheSdzIHR3aXN0IChzZWUgY29yZS9kYWlseS50cykuIGBkYXlgIGlzIGtlcHQgYXMgdGhlICdkaWZmaWN1bHR5JyBzbyBhIHNhdmVkIHJ1biBjYW4gcmVidWlsZCB0aGUgc2FtZSBkYXkuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0RGFpbHkobW9kOiB7IHBvd2VyOiBudW1iZXI7IGVuZW15PzogKHc6IEVuZW15U3BlY1tdLCB3YXZlOiBudW1iZXIpID0+IEVuZW15U3BlY1tdIH0sIGRheTogbnVtYmVyKTogdm9pZCB7XG4gIHNldFN0YWdlRGlmZmljdWx0eSgnY3J5cHQnLCAnbm9ybWFsJyk7IGRhaWx5UmV3cml0ZSA9IG1vZC5lbmVteSA/PyBudWxsOyBjdXJyZW50U3RhZ2VJZCA9ICdkYWlseSc7IGRpZmZpY3VsdHlOYW1lID0gU3RyaW5nKGRheSk7IHBvd2VyID0gbW9kLnBvd2VyO1xufVxuLyoqIFN3aXRjaCB0byBFbmRsZXNzIERlcHRoczogd2F2ZXMgY29tZSBmcm9tIGNvcmUvZW5kbGVzcy50cyBpbnN0ZWFkIG9mIGEgc3RhZ2UgbGlzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRFbmRsZXNzKCk6IHZvaWQgeyBlbmRsZXNzTW9kZSA9IHRydWU7IGRhaWx5UmV3cml0ZSA9IG51bGw7IGJvc3NTdHIgPSAxOyBjdXJyZW50U3RhZ2VJZCA9IEVORExFU1NfSUQ7IGRpZmZpY3VsdHlOYW1lID0gJ2VuZGxlc3MnOyBwb3dlciA9IDE7IEFVVEhPUkVELmxlbmd0aCA9IDA7IH1cbi8qKiBDaGFuZ2UgdGhlIHRpZXIgd2l0aGluIHRoZSBjdXJyZW50IHN0YWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldERpZmZpY3VsdHkobmFtZTogc3RyaW5nKTogdm9pZCB7IHNldFN0YWdlRGlmZmljdWx0eShjdXJyZW50U3RhZ2VJZCwgbmFtZSk7IH1cblxuZXhwb3J0IGNvbnN0IHdhdmVDb3N0ID0gKHc6IEVuZW15U3BlY1tdKTogbnVtYmVyID0+IHcucmVkdWNlKChuLCBlKSA9PiBuICsgQ09TVFtlLnNvdWxdW2Uuc3RhciAtIDFdLCAwKTtcblxuLyoqIFRoZSBsYXN0IHdhdmUgb2YgYSBzdGFnZSBoYXMgYSBCT1NTOiBpdHMgYmlnZ2VzdCB1bml0IChhIGJydXRlIGlmIHRoZXJlIGlzIG9uZSkgZ2V0cyBleHRyYSBoZWFsdGgsIGRhbWFnZSBhbmQgc2l6ZSAoc2VlIEJPU1MgaW4gYmF0dGxlLnRzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXJrQm9zcyh3OiBFbmVteVNwZWNbXSk6IEVuZW15U3BlY1tdIHtcbiAgbGV0IGJlc3QgPSAtMSwgYnMgPSAtMTtcbiAgdy5mb3JFYWNoKChlLCBpKSA9PiB7IGNvbnN0IGJydXRlID0gZS5zb3VsID09PSAnb2dyZScgfHwgZS5zb3VsID09PSAna25pZ2h0JyB8fCBlLnNvdWwgPT09ICdiYXJiYXJpYW4nID8gMTAwIDogMCwgc2MgPSBicnV0ZSArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXTsgaWYgKHNjID4gYnMpIHsgYnMgPSBzYzsgYmVzdCA9IGk7IH0gfSk7XG4gIGlmIChiZXN0ID49IDApIHtcbiAgICB3W2Jlc3RdID0geyAuLi53W2Jlc3RdLCBib3NzOiB0cnVlIH07XG4gICAgLy8gVGhlIGJvc3MgcGF5cyBmb3IgaXRzZWxmOiBpdHMgZXh0cmEgaGVhbHRoIGFuZCBkYW1hZ2UgYXJlIHRha2VuIG91dCBvZiB0aGUgZXNjb3J0LCBzbyB0aGUgd2hvbGUgd2F2ZSBpcyBhYm91dCBhcyBzdHJvbmcgYXMgdGhlIHBsYWluIHdhdmUgaXQgcmVwbGFjZXMuXG4gICAgY29uc3QgZXh0cmEgPSBNYXRoLnJvdW5kKGJvc3NFeHRyYUNvc3QoQ09TVFt3W2Jlc3RdLnNvdWxdW3dbYmVzdF0uc3RhciAtIDFdKSk7IGxldCByZW1vdmVkID0gMDtcbiAgICBjb25zdCBvcmRlciA9IHcubWFwKChlLCBpKSA9PiBpKS5maWx0ZXIoKGkpID0+IGkgIT09IGJlc3QpLnNvcnQoKGEsIGIpID0+IENPU1Rbd1thXS5zb3VsXVt3W2FdLnN0YXIgLSAxXSAtIENPU1Rbd1tiXS5zb3VsXVt3W2JdLnN0YXIgLSAxXSk7XG4gICAgY29uc3QgZHJvcCA9IG5ldyBTZXQ8bnVtYmVyPigpOyBmb3IgKGNvbnN0IGkgb2Ygb3JkZXIpIHsgY29uc3QgYyA9IENPU1Rbd1tpXS5zb3VsXVt3W2ldLnN0YXIgLSAxXTsgaWYgKHJlbW92ZWQgKyBjIDw9IGV4dHJhICsgMSAmJiBkcm9wLnNpemUgPCBvcmRlci5sZW5ndGggLSAxKSB7IGRyb3AuYWRkKGkpOyByZW1vdmVkICs9IGM7IH0gfVxuICAgIHJldHVybiB3LmZpbHRlcigoXywgaSkgPT4gIWRyb3AuaGFzKGkpKTtcbiAgfVxuICByZXR1cm4gdztcbn1cbi8qKiBIb3cgbXVjaCBEb21pbmlvbi13b3J0aCBvZiBleHRyYSBzdHJlbmd0aCBhIGJvc3Mgb2YgdGhpcyBjb3N0IGhhcyAoaXRzIGhlYWx0aCBhbmQgZGFtYWdlIGJvbnVzZXMgYXQgdGhlIGN1cnJlbnQgYm9zcyBzdHJlbmd0aCkuICovXG5leHBvcnQgY29uc3QgYm9zc0V4dHJhQ29zdCA9IChjb3N0OiBudW1iZXIpOiBudW1iZXIgPT4gY29zdCAqICgoMSArIDAuNiAqIGJvc3NTdHIpICogKDEgKyAwLjIgKiBib3NzU3RyKSAtIDEpO1xuLyoqIEVuZW15IGFybXkgZm9yIGEgd2F2ZSAoMS1iYXNlZCkuIFdhdmVzIHBhc3QgdGhlIGF1dGhvcmVkIG9uZXMgYXJlIGdlbmVyYXRlZCBmcm9tIGEgZml4ZWQgc2VlZCBzbyByZXRyaWVzIGZhY2UgdGhlIHNhbWUgYXJteS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteVdhdmUod2F2ZTogbnVtYmVyLCBzdGFnZVNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBpZiAoZW5kbGVzc01vZGUpIHJldHVybiBlbmRsZXNzV2F2ZSh3YXZlLCBzdGFnZVNlZWQpO1xuICBpZiAod2F2ZSA8PSBBVVRIT1JFRC5sZW5ndGgpIHsgbGV0IHcgPSBBVVRIT1JFRFt3YXZlIC0gMV0ubWFwKChlKSA9PiAoeyAuLi5lIH0pKTsgaWYgKGRhaWx5UmV3cml0ZSkgdyA9IGRhaWx5UmV3cml0ZSh3LCB3YXZlKTsgcmV0dXJuIHdhdmUgPT09IEFVVEhPUkVELmxlbmd0aCA/IG1hcmtCb3NzKHcpIDogdzsgfVxuICBjb25zdCBjYXAgPSBDVVJWRVMuZG9jW01hdGgubWluKHdhdmUsIENVUlZFUy5kb2MubGVuZ3RoKSAtIDFdO1xuICBjb25zdCBidWRnZXQgPSBNYXRoLnJvdW5kKGNhcCAqIDAuOTIpO1xuICBjb25zdCBybmcgPSBtYWtlUm5nKHN0YWdlU2VlZCAqIDEwMDkgKyB3YXZlICogNzkxOSk7XG4gIGNvbnN0IGFybXk6IEVuZW15U3BlY1tdID0gW107XG4gIGxldCBsZWZ0ID0gYnVkZ2V0O1xuICBmb3IgKGxldCBndWFyZCA9IDA7IGd1YXJkIDwgNDAgJiYgbGVmdCA+PSAyOyBndWFyZCsrKSB7XG4gICAgY29uc3Qgc291bCA9IHJuZy5waWNrKFNPVUxTKTtcbiAgICBsZXQgc3RhciA9IDE7XG4gICAgaWYgKHJuZy5uZXh0KCkgPCAwLjM1ICYmIENPU1Rbc291bF1bMV0gPD0gbGVmdCkgc3RhciA9IDI7XG4gICAgaWYgKHdhdmUgPj0gNiAmJiBybmcubmV4dCgpIDwgMC4yNSAmJiBDT1NUW3NvdWxdWzJdIDw9IGxlZnQpIHN0YXIgPSAzO1xuICAgIGNvbnN0IGMgPSBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbiAgICBpZiAoYyA8PSBsZWZ0ICYmIGFybXkubGVuZ3RoIDwgMTIpIHsgYXJteS5wdXNoKHsgc291bCwgc3RhciB9KTsgbGVmdCAtPSBjOyB9XG4gIH1cbiAgcmV0dXJuIGFybXk7XG59XG5cbi8qKiBXaGF0IHRoZSBidWlsZCBzY3JlZW4gc2hvd3M6IGNvdW50cyBwZXIgU291bCBhbmQgc3Rhciwgbm8gcG9zaXRpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByZXZpZXdUZXh0KHc6IEVuZW15U3BlY1tdKTogeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY291bnQ6IG51bWJlcjsgYm9zcz86IGJvb2xlYW4gfVtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXI7IGJvc3M/OiBib29sZWFuIH0+KCk7XG4gIGZvciAoY29uc3QgZSBvZiB3KSB7XG4gICAgY29uc3QgayA9IGUuc291bCArIGUuc3RhciArIChlLmJvc3MgPyAnQicgOiAnJyk7XG4gICAgY29uc3QgY3VyID0gbWFwLmdldChrKTtcbiAgICBpZiAoY3VyKSBjdXIuY291bnQrKzsgZWxzZSBtYXAuc2V0KGssIHsgc291bDogZS5zb3VsLCBzdGFyOiBlLnN0YXIsIGNvdW50OiAxLCBib3NzOiBlLmJvc3MgfSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldO1xufVxuIiwgIi8vIEF1dG8tYmF0dGxlIHNpbXVsYXRpb246IHB1cmUgbG9naWMsIG5vIGdyYXBoaWNzLiBEZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHNlZWQuXG4vLyBUaGUgcmVuZGVyZXIgb25seSByZWFkcyBmaWdodGVycyArIGV2ZW50czsgaXQgbmV2ZXIgZGVjaWRlcyBhbnl0aGluZy5cbi8vXG4vLyBBYmlsaXRpZXMgKG51bWJlcnMgbGl2ZSBpbiBiYWxhbmNlLnRzKTpcbi8vICAgU2tlbGV0b24gV2FycmlvciAgUGhhbGFueCAgICAgdGFrZXMgbGVzcyBkYW1hZ2UgZm9yIGVhY2ggbmVhcmJ5IGFsbGllZCBXYXJyaW9yIChjYXBwZWQpXG4vLyAgIFNrZWxldG9uIEFyY2hlciAgIFNwbGl0IEFycm93IChza2lsbCkgb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllczsgYmFzaWMgc2hvdHMgYXJlIGEgc2luZ2xlIGFycm93XG4vLyAgIEdvYmxpbiAgICAgICAgICAgIE9wcG9ydHVuaXN0ICtkYW1hZ2Ugb24gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2U7IHByZWZlcnMgc3VjaCB0YXJnZXRzXG4vLyAgIEtuaWdodCAgICAgICAgICAgIFRhdW50IChza2lsbCkgIGZvcmNlcyBuZWFyYnkgZW5lbWllcyB0byBhdHRhY2sgaGltXG4vLyAgIE9ncmUgICAgICAgICAgICAgIFNtYXNoIChza2lsbCkgIGhlYXZ5IHNsYW0gdGhhdCBhbHNvIGhpdHMgZW5lbWllcyBuZWFyIHRoZSBpbXBhY3Rcbi8vIFNraWxscyBydW4gb24gbWFuYTogYmFzaWMgYXR0YWNrcyBhbmQgZGFtYWdlIHRha2VuIGZpbGwgYSBiYXI7IHdoZW4gZnVsbCwgdGhlIG5leHQgYXR0YWNrIGlzIHRoZSBza2lsbCBhbmQgdGhlIGJhciByZXNldHMuXG4vLyBXYXJyaW9yLCBHb2JsaW4gYW5kIEJhcmJhcmlhbiBoYXZlIHBhc3NpdmVzIG9ubHkgKG5vIG1hbmEpLlxuLy8gICBCYXJiYXJpYW4gICAgICAgICBGcmVuenkgICAgICBhdHRhY2tzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmdcblxuaW1wb3J0IHsgR1JJRF9DT0xTLCBHUklEX1JPV1MgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBib3NzU3RyZW5ndGggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGNvbnN0IEdSSURfU1AgPSAxLjM7ICAgICAvLyBtZXRyZXMgYmV0d2VlbiBncmlkIGNlbGxzXG5leHBvcnQgY29uc3QgRlJPTlRfWCA9IDEuNzsgICAgIC8vIGZyb250IGxpbmUncyBkaXN0YW5jZSBmcm9tIHRoZSBjZW50cmUgbGluZVxuXG5leHBvcnQgaW50ZXJmYWNlIFNsb3QgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgU3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyIH1cblxuLyoqIFdvcmxkIHBvc2l0aW9uIG9mIGEgZ3JpZCBjZWxsIGZvciBhIHRlYW0gKHRlYW0gMCA9IGxlZnQsIGZhY2VzICtYOyB0ZWFtIDEgPSByaWdodCwgZmFjZXMgLVgpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNlbGxQb3ModGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcik6IHsgeDogbnVtYmVyOyB6OiBudW1iZXIgfSB7XG4gIGNvbnN0IHJvdyA9IE1hdGguZmxvb3IoY2VsbCAvIEdSSURfQ09MUyksIGNvbCA9IGNlbGwgJSBHUklEX0NPTFM7XG4gIGNvbnN0IGRlcHRoID0gR1JJRF9DT0xTIC0gMSAtIGNvbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIDAgPSBmcm9udCBsaW5lXG4gIHJldHVybiB7IHg6IChGUk9OVF9YICsgZGVwdGggKiBHUklEX1NQKSAqICh0ZWFtID09PSAwID8gLTEgOiAxKSwgejogKHJvdyAtIChHUklEX1JPV1MgLSAxKSAvIDIpICogR1JJRF9TUCB9O1xufVxuXG5jb25zdCBGUk9OVE5FU1M6IFJlY29yZDxTb3VsSWQsIG51bWJlcj4gPSB7IGtuaWdodDogNSwgb2dyZTogNCwgd2FycmlvcjogMywgYmFyYmFyaWFuOiAzLCBnb2JsaW46IDIsIGFyY2hlcjogMCB9O1xuLyoqIFRoZSBlbmVteSBhcm15IGlzIHBsYWNlZCBhdXRvbWF0aWNhbGx5ICh0YW5rcyB1cCBmcm9udCwgYXJjaGVycyBiZWhpbmQpOyB0aGUgcGxheWVyIG9ubHkgZXZlciBzZWVzIGl0cyBjb21wb3NpdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteUNlbGxzKHNwZWNzOiBTcGVjW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IGNlbGxzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ09MUyAqIEdSSURfUk9XUzsgYysrKSBjZWxscy5wdXNoKGMpO1xuICBjZWxscy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgZGEgPSBHUklEX0NPTFMgLSAxIC0gKGEgJSBHUklEX0NPTFMpLCBkYiA9IEdSSURfQ09MUyAtIDEgLSAoYiAlIEdSSURfQ09MUyk7XG4gICAgaWYgKGRhICE9PSBkYikgcmV0dXJuIGRhIC0gZGI7XG4gICAgcmV0dXJuIE1hdGguYWJzKE1hdGguZmxvb3IoYSAvIEdSSURfQ09MUykgLSAxKSAtIE1hdGguYWJzKE1hdGguZmxvb3IoYiAvIEdSSURfQ09MUykgLSAxKTtcbiAgfSk7XG4gIGNvbnN0IG9yZGVyID0gc3BlY3MubWFwKChzLCBpKSA9PiBpKS5zb3J0KChpLCBqKSA9PiBGUk9OVE5FU1Nbc3BlY3Nbal0uc291bF0gLSBGUk9OVE5FU1Nbc3BlY3NbaV0uc291bF0pO1xuICBjb25zdCBvdXQgPSBuZXcgQXJyYXk8bnVtYmVyPihzcGVjcy5sZW5ndGgpO1xuICBvcmRlci5mb3JFYWNoKChpZHgsIGspID0+IHsgb3V0W2lkeF0gPSBjZWxsc1trXTsgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCB0eXBlIEZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhZCc7XG4vKiogQSBib3NzIGlzIG9uZSBlbmVteSB3aXRoIGV4dHJhIGhlYWx0aCBhbmQgZGFtYWdlLCBhbmQgbW9yZSBzaXplLiAqL1xuZXhwb3J0IGNvbnN0IEJPU1MgPSB7IGhwOiAwLjYsIGRtZzogMC4yLCBzaXplOiAxLjMgfTsgICAvLyBzaXplIGlzIHRoZSBsb29rIG9ubHkgKGdhbWUvdmlzdWFscy50cykgICAgIC8vIGV4dHJhcyBhdCBmdWxsIHN0cmVuZ3RoIChzZWUgYm9zc1N0cmVuZ3RoIGluIHdhdmVzLnRzKVxuZXhwb3J0IGludGVyZmFjZSBGaWdodGVyIHtcbiAgYm9zcz86IGJvb2xlYW47XG4gIGlkOiBudW1iZXI7IHRlYW06IDAgfCAxOyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyO1xuICB4OiBudW1iZXI7IHo6IG51bWJlcjsgeWF3OiBudW1iZXI7XG4gIGhwOiBudW1iZXI7IG1heEhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBpbnRlcnZhbDogbnVtYmVyOyByYW5nZTogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyByYWRpdXM6IG51bWJlcjtcbiAgYWxpdmU6IGJvb2xlYW47IHN0YXRlOiBGU3RhdGU7XG4gIHRhcmdldDogbnVtYmVyOyByZXRhcmdldEF0OiBudW1iZXI7IGZvcmNlZFRhcmdldDogbnVtYmVyOyBmb3JjZWRVbnRpbDogbnVtYmVyO1xuICBuZXh0QXR0YWNrOiBudW1iZXI7IGF0dGFja1N0YXJ0OiBudW1iZXI7IGF0dGFja0R1cjogbnVtYmVyOyBhbmltU3BlZWQ6IG51bWJlcjsgaGl0RG9uZTogYm9vbGVhbjtcbiAgbWFuYTogbnVtYmVyOyBtYXhNYW5hOiBudW1iZXI7IGNhc3Rpbmc6IGJvb2xlYW47IGZyZW56eTogbnVtYmVyOyBkZWFkQXQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgQkV2ZW50ID1cbiAgfCB7IHQ6ICdzd2luZyc7IGlkOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdoaXQnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyOyBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ2Fycm93JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnZGVhdGgnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdjYXN0JzsgaWQ6IG51bWJlcjsgc2tpbGw6ICdzcGxpdCcgfCAndGF1bnQnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAndGF1bnQnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdzbWFzaCc7IGlkOiBudW1iZXI7IHg6IG51bWJlcjsgejogbnVtYmVyOyByOiBudW1iZXIgfVxuICB8IHsgdDogJ2ZyZW56eSc7IGlkOiBudW1iZXI7IHN0YWNrczogbnVtYmVyIH07XG5cbmV4cG9ydCBjbGFzcyBCYXR0bGUge1xuICB0aW1lID0gMDtcbiAgZmlnaHRlcnM6IEZpZ2h0ZXJbXSA9IFtdO1xuICBldmVudHM6IEJFdmVudFtdID0gW107XG4gIHdpbm5lcjogLTEgfCAwIHwgMSA9IC0xO1xuICBybmc6IFJuZztcbiAgcHJpdmF0ZSBwZW5kaW5nOiB7IGF0OiBudW1iZXI7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXIgfVtdID0gW107XG4gIHByaXZhdGUgbmV4dElkID0gMTtcbiAgcHJpdmF0ZSBlbmVteVBvd2VyID0gMTtcbiAgcHJpdmF0ZSBmbGlwID0gZmFsc2U7XG5cbiAgLyoqIGBsZXZlbHNgOiB0aGUgcGxheWVyJ3MgcGVybWFuZW50IFNvdWwgbGV2ZWxzIChoZWFsdGggYW5kIGRhbWFnZSBncm93IGEgbGl0dGxlIHBlciBsZXZlbCkuIEVuZW1pZXMgbmV2ZXIgdXNlIHRoZW0uICovXG4gIC8qKiBgZW5lbXlQb3dlcmA6IGhlYWx0aCBhbmQgZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBlbmVteSB0ZWFtIG9ubHkgKHN0YWdlIHN0cmVuZ3RoOyAxID0gYXMgd3JpdHRlbikuICovXG4gIGNvbnN0cnVjdG9yKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSwgbGV2ZWxzPzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiwgZW5lbXlQb3dlciA9IDEpIHtcbiAgICB0aGlzLnJuZyA9IG1ha2VSbmcoc2VlZCk7IHRoaXMuZW5lbXlQb3dlciA9IGVuZW15UG93ZXI7XG4gICAgZm9yIChjb25zdCBwIG9mIHBsYXllcnMpIHRoaXMuYWRkKDAsIHAuc291bCwgcC5zdGFyLCBwLmNlbGwsIGxldmVscz8uW3Auc291bF0gPz8gMSk7XG4gICAgY29uc3QgY2VsbHMgPSBlbmVteUNlbGxzKGVuZW1pZXMpO1xuICAgIGVuZW1pZXMuZm9yRWFjaCgoZSwgaSkgPT4gdGhpcy5hZGQoMSwgZS5zb3VsLCBlLnN0YXIsIGNlbGxzW2ldLCAxLCAhIWUuYm9zcykpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIsIGxldmVsID0gMSwgYm9zcyA9IGZhbHNlKTogRmlnaHRlciB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tzb3VsXSwgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCk7XG4gICAgY29uc3QgbHZIcCA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmhwLCBsdkRtZyA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmRtZztcbiAgICBjb25zdCBwdyA9IHRlYW0gPT09IDEgPyB0aGlzLmVuZW15UG93ZXIgOiAxO1xuICAgIGNvbnN0IGhwID0gc3QuaHAgKiBCLnN0YXIuaHBbc3RhciAtIDFdICogbHZIcCAqIHB3ICogKGJvc3MgPyAxICsgQk9TUy5ocCAqIGJvc3NTdHJlbmd0aCgpIDogMSk7XG4gICAgY29uc3QgZjogRmlnaHRlciA9IHtcbiAgICAgIGlkOiB0aGlzLm5leHRJZCsrLCB0ZWFtLCBzb3VsLCBzdGFyLCBjZWxsLCB4OiBwLngsIHo6IHAueiwgeWF3OiB0ZWFtID09PSAwID8gMCA6IE1hdGguUEksXG4gICAgICBocCwgbWF4SHA6IGhwLCBkbWc6IHN0LmRtZyAqIEIuc3Rhci5kbWdbc3RhciAtIDFdICogbHZEbWcgKiBwdyAqIChib3NzID8gMSArIEJPU1MuZG1nICogYm9zc1N0cmVuZ3RoKCkgOiAxKSwgaW50ZXJ2YWw6IHN0LmludGVydmFsLCByYW5nZTogc3QucmFuZ2UsIHNwZWVkOiBzdC5zcGVlZCwgcmFkaXVzOiBzdC5zaXplICogQi5zdGFyLnNjYWxlW3N0YXIgLSAxXSwgICAvLyAoYSBib3NzIG9ubHkgTE9PS1MgYmlnZ2VyOiBhIGxhcmdlciBjb2xsaXNpb24gcmFkaXVzIHdvdWxkIGtlZXAgbWVsZWUgdW5pdHMgb3V0IG9mIHJlYWNoKVxuICAgICAgYWxpdmU6IHRydWUsIHN0YXRlOiAnaWRsZScsIHRhcmdldDogLTEsIHJldGFyZ2V0QXQ6IDAsIGZvcmNlZFRhcmdldDogLTEsIGZvcmNlZFVudGlsOiAwLFxuICAgICAgbmV4dEF0dGFjazogdGhpcy5ybmcubmV4dCgpICogMC4zLCBhdHRhY2tTdGFydDogLTksIGF0dGFja0R1cjogMSwgYW5pbVNwZWVkOiAxLCBoaXRGcmFjOiAwLCBoaXREb25lOiB0cnVlLFxuICAgICAgbWFuYTogMCwgbWF4TWFuYTogQi5tYW5hW3NvdWxdPy5tYXggPz8gMCwgY2FzdGluZzogZmFsc2UsIGZyZW56eTogMCwgZGVhZEF0OiAwLCBib3NzLFxuICAgIH0gYXMgRmlnaHRlcjtcbiAgICB0aGlzLmZpZ2h0ZXJzLnB1c2goZik7IHJldHVybiBmO1xuICB9XG5cbiAgYnlJZChpZDogbnVtYmVyKTogRmlnaHRlciB8IHVuZGVmaW5lZCB7IHJldHVybiBpZCA8IDAgPyB1bmRlZmluZWQgOiB0aGlzLmZpZ2h0ZXJzW2lkIC0gMV07IH1cbiAgZm9lcyhmOiBGaWdodGVyKTogRmlnaHRlcltdIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8udGVhbSAhPT0gZi50ZWFtKTsgfVxuICBjb3VudCh0ZWFtOiAwIHwgMSk6IG51bWJlciB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLnJlZHVjZSgobiwgZikgPT4gbiArIChmLmFsaXZlICYmIGYudGVhbSA9PT0gdGVhbSA/IDEgOiAwKSwgMCk7IH1cbiAgZHJhaW4oKTogQkV2ZW50W10geyBjb25zdCBlID0gdGhpcy5ldmVudHM7IHRoaXMuZXZlbnRzID0gW107IHJldHVybiBlOyB9XG5cbiAgc3RlcChkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMud2lubmVyID49IDApIHJldHVybjtcbiAgICB0aGlzLnRpbWUgKz0gZHQ7IHRoaXMuZmxpcCA9ICF0aGlzLmZsaXA7XG4gICAgLy8gYXJyb3dzIHRoYXQgaGF2ZSBmaW5pc2hlZCBmbHlpbmdcbiAgICBmb3IgKGxldCBpID0gdGhpcy5wZW5kaW5nLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wZW5kaW5nW2ldO1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBwLmF0KSB7XG4gICAgICAgIHRoaXMucGVuZGluZy5zcGxpY2UoaSwgMSk7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5ieUlkKHAudG8pLCBmcm9tID0gdGhpcy5ieUlkKHAuZnJvbSk7XG4gICAgICAgIGlmICh0byAmJiB0by5hbGl2ZSAmJiBmcm9tKSB0aGlzLmRhbWFnZSh0bywgcC5kbWcsIGZyb20sICdhcnJvdycpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvcmRlciA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKHRoaXMuZmxpcCkgb3JkZXIucmV2ZXJzZSgpO1xuICAgIGZvciAoY29uc3QgZiBvZiBvcmRlcikgaWYgKGYuYWxpdmUpIHRoaXMudXBkYXRlKGYsIGR0KTtcbiAgICBjb25zdCBhID0gdGhpcy5jb3VudCgwKSwgYiA9IHRoaXMuY291bnQoMSk7XG4gICAgaWYgKCFhIHx8ICFiKSB0aGlzLndpbm5lciA9IGEgPyAwIDogMTtcbiAgICBlbHNlIGlmICh0aGlzLnRpbWUgPj0gQkFMQU5DRS5zaW0udGltZUxpbWl0KSB7XG4gICAgICBjb25zdCBocCA9ICh0OiAwIHwgMSkgPT4gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB0KS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCk7XG4gICAgICB0aGlzLndpbm5lciA9IGhwKDApID4gaHAoMSkgPyAwIDogMTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyLWZpZ2h0ZXIgdXBkYXRlXG4gIHByaXZhdGUgdXBkYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07XG4gICAgdGhpcy5zZXBhcmF0ZShmLCBkdCk7XG5cbiAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHtcbiAgICAgIGNvbnN0IHQgPSB0aGlzLnRpbWUgLSBmLmF0dGFja1N0YXJ0O1xuICAgICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAodGcgJiYgdGcuYWxpdmUpIHRoaXMuZmFjZShmLCB0Zy54IC0gZi54LCB0Zy56IC0gZi56LCBkdCk7XG4gICAgICBpZiAoIWYuaGl0RG9uZSAmJiB0ID49IGYuYXR0YWNrRHVyICogc3QuaGl0RnJhYykgeyBmLmhpdERvbmUgPSB0cnVlOyB0aGlzLnJlc29sdmVIaXQoZik7IH1cbiAgICAgIGlmICh0ID49IGYuYXR0YWNrRHVyKSBmLnN0YXRlID0gJ2lkbGUnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFjcXVpcmUoZik7XG4gICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmICghdGcgfHwgIXRnLmFsaXZlKSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IHJldHVybjsgfVxuICAgIGNvbnN0IGR4ID0gdGcueCAtIGYueCwgZHogPSB0Zy56IC0gZi56LCBkaXN0ID0gTWF0aC5oeXBvdChkeCwgZHopO1xuICAgIHRoaXMuZmFjZShmLCBkeCwgZHosIGR0KTtcbiAgICBpZiAoZGlzdCA8PSBmLnJhbmdlKSB7XG4gICAgICBpZiAodGhpcy50aW1lID49IGYubmV4dEF0dGFjaykgdGhpcy5zdGFydEF0dGFjayhmKTsgZWxzZSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IH1cbiAgICB9IGVsc2Uge1xuICAgICAgZi5zdGF0ZSA9ICdydW4nOyBsZXQgbXggPSBkeCAvIE1hdGgubWF4KGRpc3QsIDFlLTQpLCBteiA9IGR6IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCk7XG4gICAgICAvLyB3YWxrIEFST1VORCBhbnlvbmUgc3RhbmRpbmcgaW4gdGhlIHdheSAoYWxsaWVzIGFuZCBlbmVtaWVzIGFsaWtlLCBleGNlcHQgdGhlIHRhcmdldCk6IGVhY2ggYmxvY2tlciBhaGVhZCBiZW5kcyB0aGUgaGVhZGluZyBhd2F5IGZyb20gaXRcbiAgICAgIGxldCBzeCA9IDAsIHN6ID0gMDtcbiAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChvID09PSBmIHx8ICFvLmFsaXZlIHx8IG8uaWQgPT09IHRnLmlkKSBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgb3ggPSBvLnggLSBmLngsIG96ID0gby56IC0gZi56LCBhbG9uZyA9IG94ICogbXggKyBveiAqIG16LCByZWFjaCA9IGYucmFkaXVzICsgby5yYWRpdXMgKyAwLjM1O1xuICAgICAgICBpZiAoYWxvbmcgPD0gMCB8fCBhbG9uZyA+IHJlYWNoICsgMC45KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgbGF0ID0gb3ggKiAtbXogKyBveiAqIG14LCBuZWVkID0gZi5yYWRpdXMgKyBvLnJhZGl1cyArIDAuMTI7IGlmIChNYXRoLmFicyhsYXQpID49IG5lZWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBzaWRlID0gbGF0ID09PSAwID8gKGYuaWQgJSAyID8gMSA6IC0xKSA6IChsYXQgPiAwID8gLTEgOiAxKSwgdyA9ICgxIC0gTWF0aC5hYnMobGF0KSAvIG5lZWQpICogKDEgLSBNYXRoLm1heCgwLCBhbG9uZyAtIHJlYWNoKSAvIDAuOSk7XG4gICAgICAgIHN4ICs9IC1teiAqIHNpZGUgKiB3ICogMS42OyBzeiArPSBteCAqIHNpZGUgKiB3ICogMS42O1xuICAgICAgfVxuICAgICAgaWYgKHN4IHx8IHN6KSB7IG14ICs9IHN4OyBteiArPSBzejsgY29uc3QgbCA9IE1hdGguaHlwb3QobXgsIG16KSB8fCAxOyBteCAvPSBsOyBteiAvPSBsOyB9XG4gICAgICBmLnggKz0gbXggKiBmLnNwZWVkICogZHQ7IGYueiArPSBteiAqIGYuc3BlZWQgKiBkdDsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICAvKipcbiAgICogS2VlcCBmaWdodGVycyBmcm9tIHN0YWNraW5nIHdpdGhvdXQgc2hvdmluZyBhbnlvbmUgYWNyb3NzIHRoZSBtYXAuXG4gICAqIC0gQSBmaWdodGVyIHRoYXQgaXMgc3RhbmRpbmcgYW5kIGZpZ2h0aW5nIGlzIFwicGxhbnRlZFwiOiBpdCBiYXJlbHkgbW92ZXM7IHRoZSBvbmVzIHN0aWxsIFdBTEtJTkcgeWllbGQgdG8gaXQuXG4gICAqIC0gSGVhdmllciB1bml0cyAoT2dyZSwgS25pZ2h0KSBwdXNoIGxpZ2h0ZXIgb25lcyBtb3JlIHRoYW4gdGhlIG90aGVyIHdheSByb3VuZC5cbiAgICogLSBUaGUgdG90YWwgcHVzaCBvbiBvbmUgZmlnaHRlciBpcyBjYXBwZWQgcGVyIHNlY29uZCwgc28gYSBjcm93ZCBjYW4gbmV2ZXIgc2xpZGUgYSB1bml0IGZhci5cbiAgICovXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IHBsYW50ZWQgPSAodTogRmlnaHRlcikgPT4gdS5zdGF0ZSA9PT0gJ2F0dGFjaycgfHwgdS5zdGF0ZSA9PT0gJ2lkbGUnLCBtYXNzID0gKHU6IEZpZ2h0ZXIpID0+IHUucmFkaXVzICogdS5yYWRpdXM7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgbGV0IHNoYXJlID0gbWFzcyhvKSAvIChtYXNzKGYpICsgbWFzcyhvKSk7ICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgbGlnaHRlciBvbmUgb2YgdGhlIHBhaXIgbW92ZXMgbW9yZVxuICAgICAgY29uc3QgcGYgPSBwbGFudGVkKGYpLCBwbyA9IHBsYW50ZWQobyk7XG4gICAgICBpZiAocGYgJiYgIXBvKSBzaGFyZSAqPSAwLjEyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZiBpcyBzdGFuZGluZyBpdHMgZ3JvdW5kOiB0aGUgd2Fsa2VyIG8gZ29lcyBhcm91bmRcbiAgICAgIGVsc2UgaWYgKCFwZiAmJiBwbykgc2hhcmUgPSBNYXRoLm1pbigxLCBzaGFyZSAqIDEuNSArIDAuMzUpOyAgICAvLyBmIGlzIHdhbGtpbmcgaW50byBhIHBsYW50ZWQgdW5pdDogZiB5aWVsZHNcbiAgICAgIGVsc2UgaWYgKHBmICYmIHBvKSBzaGFyZSAqPSAwLjM1OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0d28gc3RhbmRpbmcgdW5pdHMgb3ZlcmxhcCBhIGxpdHRsZTogZWFzZSBhcGFydCB2ZXJ5IHNsb3dseVxuICAgICAgY29uc3QgayA9ICgod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMykpICogc2hhcmUgKiAyO1xuICAgICAgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBsZXQgbXggPSBweCAqIHMsIG16ID0gcHogKiBzO1xuICAgIGNvbnN0IGNhcCA9IChwbGFudGVkKGYpID8gMC41IDogMS42KSAqIGR0LCBsZW4gPSBNYXRoLmh5cG90KG14LCBteik7ICAgLy8gbWV0cmVzIHBlciBzZWNvbmQsIHN0YW5kaW5nIHZzIHdhbGtpbmdcbiAgICBpZiAobGVuID4gY2FwKSB7IG14ICo9IGNhcCAvIGxlbjsgbXogKj0gY2FwIC8gbGVuOyB9XG4gICAgZi54ICs9IG14OyBmLnogKz0gbXo7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicgJiYgY3VyICYmIGN1ci5hbGl2ZSAmJiBNYXRoLmh5cG90KGN1ci54IC0gZi54LCBjdXIueiAtIGYueikgPD0gZi5yYW5nZSAqIDEuMykgcmV0dXJuOyAgIC8vIGFscmVhZHkgaW4gcmVhY2ggb2Ygc29tZW9uZTogaGl0IHRoZW0sIGRvbid0IHdhbmRlciBvZmYgYWZ0ZXIgYSBqdWljaWVyIHRhcmdldFxuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJyAmJiBvLmlkID09PSBmLnRhcmdldCkgc2NvcmUgLT0gMS41OyAgIC8vIHN0aWNrIHdpdGggYSB0YXJnZXQgdW5sZXNzIGFub3RoZXIgaXMgY2xlYXJseSBiZXR0ZXJcbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzAsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQsIGxldmVscywgZW5lbXlQb3dlcik7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgImltcG9ydCB7IENVUlZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuLyoqXG4gKiBSdWxlcyBmb3IgdGhlIHBsYXlhYmxlIFN0YWdlIDEgKDEwIHdhdmVzKTogZG9jIERvbWluaW9uIGN1cnZlLCBib251cyBkcmF3IG9ubHkgb24gdGhlIGVhcmx5IHdhdmVzLlxuICogbWVyZ2UgJ2hhbmRJbnRvT25lU3Rhcic6IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gbWVyZ2Ugc3RyYWlnaHQgaW50byBhIG1hdGNoaW5nIGRlcGxveWVkIDEtc3RhciB1bml0IChwYXlpbmcgb25seSB0aGUgY29zdFxuICogZGlmZmVyZW5jZSkuIFdpdGhvdXQgaXQgdGhlIGNhcCBjYW4gYmxvY2sgYSBtZXJnZSB5b3UgY291bGQgYWZmb3JkICh5b3Ugd291bGQgbmVlZCByb29tIHRvIHN1bW1vbiBCT1RIIGNvcGllcyBmaXJzdCkuXG4gKiBUaGUgZGVidWcgcGFuZWwgY2FuIHN3aXRjaCB0aGlzIGJhY2sgdG8gdGhlIGRvYydzIGRlcGxveWVkLW9ubHkgcnVsZS5cbiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPVFlQRV9SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBDVVJWRVMuZG9jLCBtZXJnZTogJ2hhbmRJbnRvT25lU3RhcicsIHN0YWdlV2F2ZXM6IDEwLCBub3JtYWxEcmF3V2F2ZXM6IFsyLCAzLCA0LCA1XSB9O1xuXG4vKipcbiAqIEVuZGxlc3MgRGVwdGhzOiB0aGUgY2FtcGFpZ24ncyBEb21pbmlvbiBjdXJ2ZSBmb3Igd2F2ZXMgMS0xMCwgdGhlbiBoZWxkIGF0IDQwICh0aGUgcGxheWVyJ3MgYXJteSBpcyBjYXBwZWQgb24gcHVycG9zZTsgdGhlIGVuZW15IGtlZXBzIGdyb3dpbmcsIHNlZSBlbmRsZXNzLnRzKS5cbiAqIFRoZSBjdXJ2ZSBpcyBsb25nIGVub3VnaCB0aGF0IGEgcnVuIGVuZHMgYnkgbG9zaW5nIGhlYXJ0cywgbmV2ZXIgYnkgXCJjbGVhcmluZ1wiIHRoZSBzdGFnZSAoY29yZS9ydWxlcy50cyByZWFkcyBjdXJ2ZVt3YXZlLTFdKS5cbiAqL1xuY29uc3QgRU5ETEVTU19MRU4gPSAzMDA7XG5leHBvcnQgY29uc3QgRU5ETEVTU19SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBBcnJheS5mcm9tKHsgbGVuZ3RoOiBFTkRMRVNTX0xFTiB9LCAoXywgaSkgPT4gQ1VSVkVTLmRvY1tNYXRoLm1pbihpLCBDVVJWRVMuZG9jLmxlbmd0aCAtIDEpXSksIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogRU5ETEVTU19MRU4sIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG4iLCAiLy8gVGhlIERhaWx5IENoYWxsZW5nZTogU3RhZ2UgMSAoTm9ybWFsKSB3aXRoIE9ORSB0d2lzdCB0aGF0IGNoYW5nZXMgZXZlcnkgZGF5LiBFdmVyeW9uZSBnZXRzIHRoZSBzYW1lIHR3aXN0IGFuZCB0aGUgc2FtZSBzZWVkIG9uIHRoZSBzYW1lIGRheVxuLy8gKGJvdGggY29tZSBmcm9tIHRoZSBjYWxlbmRhciBkYXRlLCBzbyBubyBzZXJ2ZXIgaXMgbmVlZGVkKS4gUmV0cnkgYXMgb2Z0ZW4gYXMgeW91IGxpa2U7IHRoZSByZXdhcmQgKGEgcGFjayBhbmQgc29tZSBnb2xkKSBpcyBwYWlkIG9uY2UgcGVyIGRheS5cblxuaW1wb3J0IHsgQ09TVCwgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUFJPVE9UWVBFX1JVTEVTIH0gZnJvbSAnLi9wcm90b3R5cGUudHMnO1xuaW1wb3J0IHR5cGUgeyBFbmVteVNwZWMgfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB7IHdhdmVDb3N0IH0gZnJvbSAnLi93YXZlcy50cyc7XG5cbmV4cG9ydCBjb25zdCBEQUlMWV9JRCA9ICdkYWlseSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGFpbHlNb2Qge1xuICBpZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZztcbiAgcG93ZXI6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAvLyBoaWRkZW4gZW5lbXkgaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyIGZvciB0aGUgZGF5XG4gIGNhcERlbHRhOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgLy8gY2hhbmdlIHRvIHRoZSBwbGF5ZXIncyBEb21pbmlvbiBldmVyeSB3YXZlIChuZXZlciBiZWxvdyBEQUlMWV9NSU5fQ0FQKVxuICBlbmVteT86ICh3OiBFbmVteVNwZWNbXSwgd2F2ZTogbnVtYmVyKSA9PiBFbmVteVNwZWNbXTsgICAvLyByZXdyaXRlcyBlYWNoIGVuZW15IHdhdmVcbn1cbmV4cG9ydCBjb25zdCBEQUlMWV9NSU5fQ0FQID0gNDtcbmNvbnN0IE1BWF9VTklUUyA9IDEyO1xuXG4vKiogQSBjcm93ZCBvZiBXYXJyaW9ycyBhbmQgR29ibGlucyB0aGF0IGNvc3RzIGFib3V0IGBidWRnZXRgIERvbWluaW9uLiAqL1xuZnVuY3Rpb24gY3Jvd2QoYnVkZ2V0OiBudW1iZXIpOiBFbmVteVNwZWNbXSB7XG4gIGNvbnN0IG91dDogRW5lbXlTcGVjW10gPSBbXTsgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGkgPSAwOyBvdXQubGVuZ3RoIDwgTUFYX1VOSVRTOyBpKyspIHtcbiAgICBjb25zdCBzb3VsID0gaSAlIDMgPT09IDIgPyAnZ29ibGluJyA6ICd3YXJyaW9yJzsgaWYgKENPU1Rbc291bF1bMF0gPiBsZWZ0KSBicmVhaztcbiAgICBvdXQucHVzaCh7IHNvdWwsIHN0YXI6IDEgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVswXTtcbiAgfVxuICByZXR1cm4gb3V0Lmxlbmd0aCA/IG91dCA6IFt7IHNvdWw6ICd3YXJyaW9yJywgc3RhcjogMSB9XTtcbn1cblxuZXhwb3J0IGNvbnN0IE1PRElGSUVSUzogRGFpbHlNb2RbXSA9IFtcbiAgeyBpZDogJ2VtcG93ZXJlZCcsIG5hbWU6ICdFbXBvd2VyZWQnLCB0ZXh0OiAnRW5lbWllcyBhcmUgMjUlIHN0cm9uZ2VyLicsIHBvd2VyOiAxLjI1LCBjYXBEZWx0YTogMCB9LFxuICB7IGlkOiAnbWVsZWUnLCBuYW1lOiAnTm8gQXJjaGVycycsIHRleHQ6ICdFbmVteSBBcmNoZXJzIGFyZSByZXBsYWNlZCBieSBXYXJyaW9ycywgYnV0IGV2ZXJ5b25lIGhpdHMgaGFyZGVyLicsIHBvd2VyOiAxLjE1LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IHcubWFwKChlKSA9PiAoZS5zb3VsID09PSAnYXJjaGVyJyA/IHsgc291bDogJ3dhcnJpb3InIGFzIGNvbnN0LCBzdGFyOiBlLnN0YXIgfSA6IGUpKSB9LFxuICB7IGlkOiAnc3dhcm0nLCBuYW1lOiAnU3dhcm0nLCB0ZXh0OiAnV2F2ZXMgYXJlIGNyb3dkcyBvZiBXYXJyaW9ycyBhbmQgR29ibGlucy4nLCBwb3dlcjogMC44NSwgY2FwRGVsdGE6IDAsXG4gICAgZW5lbXk6ICh3KSA9PiBjcm93ZChNYXRoLnJvdW5kKHdhdmVDb3N0KHcpICogMS4xNSkpIH0sXG4gIHsgaWQ6ICdjcmFtcGVkJywgbmFtZTogJ0NyYW1wZWQnLCB0ZXh0OiAnWW91ciBEb21pbmlvbiBpcyA0IGxvd2VyIGV2ZXJ5IHdhdmUuJywgcG93ZXI6IDEsIGNhcERlbHRhOiAtNCB9LFxuICB7IGlkOiAndmV0ZXJhbnMnLCBuYW1lOiAnVmV0ZXJhbnMnLCB0ZXh0OiAnRW5lbXkgT2dyZXMgYW5kIEtuaWdodHMgYXJlIGEgc3RhciBoaWdoZXIuJywgcG93ZXI6IDAuOSwgY2FwRGVsdGE6IDAsXG4gICAgZW5lbXk6ICh3KSA9PiB3Lm1hcCgoZSkgPT4gKGUuc291bCA9PT0gJ29ncmUnIHx8IGUuc291bCA9PT0gJ2tuaWdodCcgPyB7IHNvdWw6IGUuc291bCwgc3RhcjogTWF0aC5taW4oMywgZS5zdGFyICsgMSkgfSA6IGUpKSB9LFxuXTtcblxuLyoqIFdob2xlIGRheXMgc2luY2UgMSBKYW51YXJ5IDE5NzAgaW4gdGhlIHBsYXllcidzIG93biBjYWxlbmRhciAodGhlIGRheSBjaGFuZ2VzIGF0IHRoZWlyIG1pZG5pZ2h0KS4gKi9cbmV4cG9ydCBjb25zdCBkYXlOdW1iZXIgPSAoZDogRGF0ZSA9IG5ldyBEYXRlKCkpOiBudW1iZXIgPT4gTWF0aC5mbG9vcihEYXRlLlVUQyhkLmdldEZ1bGxZZWFyKCksIGQuZ2V0TW9udGgoKSwgZC5nZXREYXRlKCkpIC8gODY0MDAwMDApO1xuZXhwb3J0IGNvbnN0IGlzVmFsaWREYXkgPSAobjogbnVtYmVyKTogYm9vbGVhbiA9PiBOdW1iZXIuaXNJbnRlZ2VyKG4pICYmIG4gPiAwICYmIG4gPCAxZTY7XG5leHBvcnQgY29uc3QgbW9kaWZpZXJGb3IgPSAoZGF5OiBudW1iZXIpOiBEYWlseU1vZCA9PiBNT0RJRklFUlNbKChkYXkgJSBNT0RJRklFUlMubGVuZ3RoKSArIE1PRElGSUVSUy5sZW5ndGgpICUgTU9ESUZJRVJTLmxlbmd0aF07XG4vKiogVGhlIHBsYXllcidzIHJ1bGVzIGZvciB0aGUgZGF5OiB0aGUgY2FtcGFpZ24ncyBEb21pbmlvbiBjdXJ2ZSwgc2hpZnRlZCBieSB0aGUgbW9kaWZpZXIuICovXG5leHBvcnQgZnVuY3Rpb24gZGFpbHlSdWxlcyhtb2Q6IERhaWx5TW9kLCBwb29sOiBSdWxlc1sncG9vbCddKTogUnVsZXMge1xuICByZXR1cm4geyAuLi5QUk9UT1RZUEVfUlVMRVMsIGN1cnZlOiBDVVJWRVMuZG9jLm1hcCgoYykgPT4gTWF0aC5tYXgoREFJTFlfTUlOX0NBUCwgYyArIG1vZC5jYXBEZWx0YSkpLCBwb29sIH07XG59XG4iLCAiLy8gU291bCBQYWNrcyAocGxhbiBkb2Mgc2VjdGlvbiAxNykuIFB1cmUgcnVsZXMsIG5vIGdyYXBoaWNzLiBBTEwgTlVNQkVSUyBBUkUgUExBQ0VIT0xERVIgTEVWRVJTOiB3ZSBzZXR0bGVkIHRoZSBzdHJ1Y3R1cmUgZmlyc3QgYW5kIHdpbGwgdHVuZVxuLy8gcXVhbnRpdGllcyB3aXRoIHRoZSBwcm9ncmVzc2lvbiBzaW11bGF0aW9uIChzaW0vcHJvZ3Jlc3Npb24udHMpIG9uY2UgdGhlIGxvb3AgY2FuIGJlIHBsYXllZC5cbi8vXG4vLyAgIFNvdWwgcmFyaXR5ICAtPiBob3cgb2Z0ZW4gYSBTb3VsIHNob3dzIHVwIGFuZCBob3cgYmlnIGl0cyBzdGFjayBvZiBjb3BpZXMgdGVuZHMgdG8gYmUuXG4vLyAgIFBhY2sgdGllciAgICAtPiB0aGUgcGFjaydzIG92ZXJhbGwgdmFsdWUgKHNrdWxscywgMS0zIGZvciBub3cpOiBudW1iZXIgb2YgcmV2ZWFscyArIGhvdyBnb29kIHRoZSByYXJpdHkgb2RkcyBhcmUuXG4vLyAgIEEgcGFjayBoYXMgYSBTVEFSVElORyB0aWVyIGFuZCBtYXkgdXBncmFkZSB3aGlsZSBpdCBpcyBiZWluZyBvcGVuZWQ7IHRoZSByZXN1bHQgaXMgZGVjaWRlZCB1cCBmcm9udCwgdGhlIGFuaW1hdGlvbiBvbmx5IHNob3dzIGl0LlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IHR5cGUgUmFyaXR5ID0gJ2NvbW1vbicgfCAncmFyZScgfCAnZXBpYycgfCAnbGVnZW5kYXJ5JztcbmV4cG9ydCBjb25zdCBSQVJJVElFUzogUmFyaXR5W10gPSBbJ2NvbW1vbicsICdyYXJlJywgJ2VwaWMnLCAnbGVnZW5kYXJ5J107XG5leHBvcnQgY29uc3QgUkFSSVRZX05BTUU6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJ0NvbW1vbicsIHJhcmU6ICdSYXJlJywgZXBpYzogJ0VwaWMnLCBsZWdlbmRhcnk6ICdMZWdlbmRhcnknIH07XG5cbi8qKiBSYXJpdHkgcGVyIFNvdWwuIFBMQUNFSE9MREVSIGFzc2lnbm1lbnQgKG5vIExlZ2VuZGFyeSBTb3VsIGV4aXN0cyB5ZXQpLiAqL1xuZXhwb3J0IGNvbnN0IFJBUklUWV9PRjogUmVjb3JkPFNvdWxJZCwgUmFyaXR5PiA9IHsgd2FycmlvcjogJ2NvbW1vbicsIGdvYmxpbjogJ2NvbW1vbicsIGFyY2hlcjogJ3JhcmUnLCBrbmlnaHQ6ICdyYXJlJywgb2dyZTogJ2VwaWMnLCBiYXJiYXJpYW46ICdlcGljJyB9O1xuXG4vKiogUmFyZXIgU291bHMgdHVybiB1cCBpbiBzbWFsbGVyIHN0YWNrcywgc28gdGhleSBuZWVkIGZld2VyIGNvcGllcyBwZXIgbGV2ZWwgKG11bHRpcGxpZXIgb24gdGhlIGxldmVsIGNvc3RzKS4gUExBQ0VIT0xERVIuICovXG5leHBvcnQgY29uc3QgTEVWRUxfQ09TVF9NVUxUOiBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+ID0geyBjb21tb246IDEsIHJhcmU6IDAuNiwgZXBpYzogMC4zNSwgbGVnZW5kYXJ5OiAwLjIgfTtcblxuZXhwb3J0IGNvbnN0IFBBQ0tfVElFUlMgPSAzO1xuZXhwb3J0IGNvbnN0IFBBQ0sgPSB7XG4gIHJldmVhbHM6IFszLCA0LCA1XSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNlcGFyYXRlIHJldmVhbHMgcGVyIHRpZXIgKGluZGV4IDAgPSB0aWVyIDEpXG4gIHN0YWNrTXVsdDogWzEsIDEuNSwgMl0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvcHkgc3RhY2tzIGFyZSBiaWdnZXIgaW4gYmV0dGVyIHBhY2tzXG4gIC8qKiBSYXJpdHkgb2RkcyBwZXIgdGllciwgaW4gcGVyY2VudC4gKi9cbiAgb2RkczogW1xuICAgIHsgY29tbW9uOiA3MCwgcmFyZTogMjUsIGVwaWM6IDUsIGxlZ2VuZGFyeTogMCB9LFxuICAgIHsgY29tbW9uOiA1NSwgcmFyZTogMzMsIGVwaWM6IDExLCBsZWdlbmRhcnk6IDEgfSxcbiAgICB7IGNvbW1vbjogNDAsIHJhcmU6IDM4LCBlcGljOiAxOSwgbGVnZW5kYXJ5OiAzIH0sXG4gIF0gYXMgUmVjb3JkPFJhcml0eSwgbnVtYmVyPltdLFxuICAvKiogQ29waWVzIGluIG9uZSByZXZlYWwgYmVmb3JlIHRoZSB0aWVyIG11bHRpcGxpZXI6IFttaW4sIG1heF0uICovXG4gIHN0YWNrOiB7IGNvbW1vbjogWzYsIDEwXSwgcmFyZTogWzMsIDVdLCBlcGljOiBbMSwgM10sIGxlZ2VuZGFyeTogWzEsIDFdIH0gYXMgUmVjb3JkPFJhcml0eSwgW251bWJlciwgbnVtYmVyXT4sXG4gIC8qKiBDaGFuY2UgdG8ganVtcCB1cCBvbmUgdGllciBkdXJpbmcgdGhlIG9wZW5pbmcsIGZyb20gdGllciAxIGFuZCBmcm9tIHRpZXIgMiAoYSBsdWNreSBwYWNrIGNhbiBqdW1wIHR3aWNlKS4gKi9cbiAgdXBncmFkZUNoYW5jZTogWzAuMiwgMC4xMl0sXG59O1xuXG4vKiogQW4gdW5vcGVuZWQgcGFjayB0aGUgcGxheWVyIG93bnMuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhY2tJdGVtIHsgaWQ6IG51bWJlcjsgdGllcjogbnVtYmVyOyBzb3VyY2U6IHN0cmluZyB9XG5leHBvcnQgaW50ZXJmYWNlIFJldmVhbCB7IHNvdWw6IFNvdWxJZDsgcmFyaXR5OiBSYXJpdHk7IGNvcGllczogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgUGFja1Jlc3VsdCB7IHN0YXJ0VGllcjogbnVtYmVyOyBmaW5hbFRpZXI6IG51bWJlcjsgdXBncmFkZXM6IG51bWJlcltdOyByZXZlYWxzOiBSZXZlYWxbXSB9XG5cbmNvbnN0IHJhcml0eVJhbmsgPSAocjogUmFyaXR5KSA9PiBSQVJJVElFUy5pbmRleE9mKHIpO1xuXG5mdW5jdGlvbiByb2xsUmFyaXR5KHRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBSYXJpdHkge1xuICBjb25zdCBvZGRzID0gUEFDSy5vZGRzW3RpZXIgLSAxXTsgbGV0IHJvbGwgPSBybmcubmV4dCgpICogUkFSSVRJRVMucmVkdWNlKChuLCByKSA9PiBuICsgb2Rkc1tyXSwgMCk7XG4gIGZvciAoY29uc3QgciBvZiBSQVJJVElFUykgeyBpZiAocm9sbCA8IG9kZHNbcl0pIHJldHVybiByOyByb2xsIC09IG9kZHNbcl07IH1cbiAgcmV0dXJuICdjb21tb24nO1xufVxuXG4vKiogQSByYW5kb20gU291bCBvZiB0aGlzIHJhcml0eTsgaWYgdGhlIHJvc3RlciBoYXMgbm9uZSBvZiB0aGF0IHJhcml0eSB5ZXQsIHRoZSBuZXh0IGxvd2VyIG9uZSBpcyB1c2VkLiAqL1xuZnVuY3Rpb24gc291bE9mUmFyaXR5KHJhcml0eTogUmFyaXR5LCBybmc6IFJuZyk6IFNvdWxJZCB7XG4gIGZvciAobGV0IGkgPSByYXJpdHlSYW5rKHJhcml0eSk7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHBvb2wgPSBTT1VMUy5maWx0ZXIoKHMpID0+IFJBUklUWV9PRltzXSA9PT0gUkFSSVRJRVNbaV0pOyBpZiAocG9vbC5sZW5ndGgpIHJldHVybiBybmcucGljayhwb29sKTsgfVxuICByZXR1cm4gcm5nLnBpY2soU09VTFMpO1xufVxuXG4vKiogT3BlbiBhIHBhY2s6IHJvbGwgdXBncmFkZXMgZmlyc3QgKHNvIHRoZSBhbmltYXRpb24gY2FuIHBsYXkgdGhlbSBiZWZvcmUgdGhlIHBhY2sgdGVhcnMgb3BlbiksIHRoZW4gdGhlIHJldmVhbHMuIEJlc3QgcmV2ZWFsIGNvbWVzIGxhc3QuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblBhY2soc3RhcnRUaWVyOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB7XG4gIGNvbnN0IHQwID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcihzdGFydFRpZXIpKSksIHVwZ3JhZGVzOiBudW1iZXJbXSA9IFtdO1xuICBsZXQgdGllciA9IHQwO1xuICB3aGlsZSAodGllciA8IFBBQ0tfVElFUlMgJiYgcm5nLm5leHQoKSA8IFBBQ0sudXBncmFkZUNoYW5jZVt0aWVyIC0gMV0pIHsgdGllcisrOyB1cGdyYWRlcy5wdXNoKHRpZXIpOyB9XG4gIGNvbnN0IHJldmVhbHM6IFJldmVhbFtdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgUEFDSy5yZXZlYWxzW3RpZXIgLSAxXTsgaSsrKSB7XG4gICAgY29uc3QgcmFyaXR5ID0gcm9sbFJhcml0eSh0aWVyLCBybmcpLCBzb3VsID0gc291bE9mUmFyaXR5KHJhcml0eSwgcm5nKSwgW2xvLCBoaV0gPSBQQUNLLnN0YWNrW1JBUklUWV9PRltzb3VsXV07XG4gICAgcmV2ZWFscy5wdXNoKHsgc291bCwgcmFyaXR5OiBSQVJJVFlfT0Zbc291bF0sIGNvcGllczogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgobG8gKyBybmcuaW50KGhpIC0gbG8gKyAxKSkgKiBQQUNLLnN0YWNrTXVsdFt0aWVyIC0gMV0pKSB9KTtcbiAgfVxuICByZXZlYWxzLnNvcnQoKGEsIGIpID0+IHJhcml0eVJhbmsoYS5yYXJpdHkpIC0gcmFyaXR5UmFuayhiLnJhcml0eSkgfHwgYS5jb3BpZXMgLSBiLmNvcGllcyk7XG4gIHJldHVybiB7IHN0YXJ0VGllcjogdDAsIGZpbmFsVGllcjogdGllciwgdXBncmFkZXMsIHJldmVhbHMgfTtcbn1cblxuLyoqIFRvdGFsIGNvcGllcyBwZXIgU291bCBpbiBhIHJlc3VsdCAodGhlIHNhbWUgU291bCBjYW4gYmUgcmV2ZWFsZWQgbW9yZSB0aGFuIG9uY2UpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvcGllc0J5U291bChyZXN1bHQ6IFBhY2tSZXN1bHQpOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+IHtcbiAgY29uc3Qgb3V0OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+ID0ge307XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgb3V0W3Iuc291bF0gPSAob3V0W3Iuc291bF0gPz8gMCkgKyByLmNvcGllcztcbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3Mgc2F2ZWQgcHJvZ3Jlc3MuIEZyYW1ld29yay1mcmVlIHNvIHRoZSBnYW1lIGJ1bmRsZSBhbmQgdGhlIG5hdmlnYXRpb24gc2hlbGwgYm90aCB1c2UgaXQuXG4vLyBTdG9yZWQgaW4gbG9jYWxTdG9yYWdlIGFzIEpTT04uIEV2ZXJ5IHJlYWQvd3JpdGUgaXMgZ3VhcmRlZDogcHJpdmF0ZSB3aW5kb3dzIGFuZCBibG9ja2VkIHN0b3JhZ2UgbXVzdCBuZXZlciBicmVhayB0aGUgZ2FtZS5cblxuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUEFDS19USUVSUyB9IGZyb20gJy4vcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBQYWNrSXRlbSB9IGZyb20gJy4vcGFja3MudHMnO1xuXG5leHBvcnQgY29uc3QgREVDS19TSVpFID0gNjsgICAgICAgICAgICAgICAgICAgICAvLyBkb2M6IHNpeCBlcXVpcHBlZCBTb3VscyBwZXIgc3RhZ2VcbmNvbnN0IEtFWSA9ICduZWNyby1zYXZlJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgdHlwZSBEaWZmaWN1bHR5ID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGSUNVTFRJRVM6IERpZmZpY3VsdHlbXSA9IFsnZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXTtcbmV4cG9ydCBpbnRlcmZhY2UgU2V0dGluZ3MgeyBtdXNpYzogYm9vbGVhbjsgc2Z4OiBib29sZWFuIH1cbmV4cG9ydCBpbnRlcmZhY2UgU291bFByb2dyZXNzIHsgbGV2ZWw6IG51bWJlcjsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTYXZlIHtcbiAgdjogbnVtYmVyO1xuICBkZWNrOiBTb3VsSWRbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXF1aXBwZWQgU291bHMsIGF0IG1vc3QgREVDS19TSVpFLCBhdCBsZWFzdCAxXG4gIHNvdWxzOiBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+OyAgICAgICAgICAvLyBQTEFDRUhPTERFUiBwcm9ncmVzc2lvbiB1bnRpbCBwYWNrcyBleGlzdFxuICBzZXR0aW5nczogU2V0dGluZ3M7ICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc291bmQgc3dpdGNoZXM7IGJvdGggb24gYnkgZGVmYXVsdFxuICBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5OyAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hvc2VuIG9uIEhvbWU7IGFwcGxpZXMgdG8gdGhlIG5leHQgcnVuXG4gIHN0YWdlOiBzdHJpbmc7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgc3RhZ2UgcGlja2VkIG9uIEhvbWUgKGlkIGZyb20gd2F2ZXMudHMgU1RBR0VTKVxuICBzZWVuOiBzdHJpbmdbXSB8IG51bGw7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5sb2NrIGtleXMgd2hvc2UgY2VsZWJyYXRpb24gd2FzIGFscmVhZHkgc2hvd24gKG51bGw6IG9sZGVyIHNhdmUsIHNlZWRlZCBvbiBmaXJzdCBsb29rKVxuICBwYWNrczogUGFja0l0ZW1bXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5vcGVuZWQgU291bCBQYWNrc1xuICBuZXh0UGFja0lkOiBudW1iZXI7XG4gIGNsZWFyczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjsgICAgICAgICAgICAgICAvLyBzdGFnZSBjbGVhcnMsIGtleWVkICdzdGFnZTpkaWZmaWN1bHR5J1xuICByZXBsYXlNZXRlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwbGF5IGNsZWFycyB0b3dhcmQgdGhlIG5leHQgcmVwbGF5IHBhY2tcbiAgZW5kbGVzczogeyBiZXN0OiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgIC8vIEVuZGxlc3MgRGVwdGhzOiB0aGUgZGVlcGVzdCB3YXZlIGNsZWFyZWRcbiAgZ29sZFNjYWxlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIDIgPSBnb2xkIGluIHRoZSBjdXJyZW50ICh4MTAwKSB1bml0czsgYSBzYXZlIHdpdGhvdXQgaXQgaG9sZHMgZ29sZCBpbiB0aGUgb2xkIHNtYWxsIHVuaXRzIGFuZCBpcyBjb252ZXJ0ZWQgb24gbG9hZFxuICBnb2xkOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc3BlbnQgb24gU291bCBsZXZlbC11cHMgKGFsb25nc2lkZSBjb3BpZXMpOyBlYXJuZWQgcGVyIHdhdmUgY2xlYXJlZCBhbmQgZnJvbSBvcGVuaW5nIHBhY2tzXG4gIGRhaWx5U3RyZWFrOiB7IGNvdW50OiBudW1iZXI7IGxhc3Q6IG51bWJlciB9OyAvLyBjb25zZWN1dGl2ZSBkYXlzIHdpdGggYSBEYWlseSB3aW4sIGFuZCB0aGUgbGFzdCBkYXkgd29uXG4gIGRhaWx5V2luczogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBEYWlseSBDaGFsbGVuZ2VzIHdvbiAob25lIHBlciBkYXkgY291bnRzKVxuICBjbGFpbWVkOiBzdHJpbmdbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbWlsZXN0b25lcyB3aG9zZSByZXdhcmQgd2FzIHRha2VuXG4gIGRhaWx5OiB7IGRheTogbnVtYmVyOyB3b246IGJvb2xlYW4gfSB8IG51bGw7ICAvLyB0aGUgbGFzdCBEYWlseSBDaGFsbGVuZ2UgZGF5IHBsYXllZCBhbmQgd2hldGhlciBpdHMgb25lLXRpbWUgcmV3YXJkIHdhcyB0YWtlblxufVxuLyoqIEdvbGQgZ2l2ZW4gb25jZSB0byBhIHNhdmUgdGhhdCBwcmVkYXRlcyBnb2xkIGFuZCBoYXMgcHJvZ3Jlc3MuICovXG5leHBvcnQgY29uc3QgQ0FUQ0hfVVBfR09MRCA9IDQwMDAwO1xuZXhwb3J0IGludGVyZmFjZSBTdG9yZSB7IGdldEl0ZW0oazogc3RyaW5nKTogc3RyaW5nIHwgbnVsbDsgc2V0SXRlbShrOiBzdHJpbmcsIHY6IHN0cmluZyk6IHZvaWQgfVxuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFNhdmUoKTogU2F2ZSB7XG4gIGNvbnN0IHNvdWxzID0ge30gYXMgUmVjb3JkPFNvdWxJZCwgU291bFByb2dyZXNzPjtcbiAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykgc291bHNbaWRdID0geyBsZXZlbDogMSwgY29waWVzOiAwIH07XG4gIHJldHVybiB7IHY6IFZFUlNJT04sIGRlY2s6IFNPVUxTLnNsaWNlKDAsIERFQ0tfU0laRSksIHNvdWxzLCBzZXR0aW5nczogeyBtdXNpYzogdHJ1ZSwgc2Z4OiB0cnVlIH0sIGRpZmZpY3VsdHk6ICdub3JtYWwnLCBzdGFnZTogJ2NyeXB0Jywgc2VlbjogW10sIHBhY2tzOiBbXSwgbmV4dFBhY2tJZDogMSwgY2xlYXJzOiB7fSwgcmVwbGF5TWV0ZXI6IDAsIGVuZGxlc3M6IHsgYmVzdDogMCB9LCBnb2xkU2NhbGU6IDIsIGdvbGQ6IDAsIGRhaWx5OiBudWxsLCBkYWlseVN0cmVhazogeyBjb3VudDogMCwgbGFzdDogMCB9LCBkYWlseVdpbnM6IDAsIGNsYWltZWQ6IFtdIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicm93c2VyU3RvcmUoKTogU3RvcmUgfCBudWxsIHsgdHJ5IHsgcmV0dXJuIHR5cGVvZiBsb2NhbFN0b3JhZ2UgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGxvY2FsU3RvcmFnZTsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9IH1cblxuLyoqIFJlcGFpciB3aGF0ZXZlciB3YXMgc3RvcmVkOiB1bmtub3duIFNvdWxzIGRyb3BwZWQsIGR1cGxpY2F0ZXMgcmVtb3ZlZCwgZGVjayBjYXBwZWQsIG5vdGhpbmcgZW1wdHkuIE9sZCB2ZXJzaW9ucyBrZWVwIHRoZWlyIHByb2dyZXNzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplKHJhdzogYW55KTogU2F2ZSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0U2F2ZSgpO1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IGRlY2s6IFNvdWxJZFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5kZWNrKSkgZm9yIChjb25zdCBkIG9mIHJhdy5kZWNrKSBpZiAoU09VTFMuaW5jbHVkZXMoZCkgJiYgIWRlY2suaW5jbHVkZXMoZCkgJiYgZGVjay5sZW5ndGggPCBERUNLX1NJWkUpIGRlY2sucHVzaChkKTtcbiAgaWYgKGRlY2subGVuZ3RoKSBiYXNlLmRlY2sgPSBkZWNrO1xuICBpZiAocmF3LnNvdWxzICYmIHR5cGVvZiByYXcuc291bHMgPT09ICdvYmplY3QnKSB7XG4gICAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykge1xuICAgICAgY29uc3QgcCA9IHJhdy5zb3Vsc1tpZF07XG4gICAgICBpZiAocCAmJiBOdW1iZXIuaXNGaW5pdGUocC5sZXZlbCkgJiYgTnVtYmVyLmlzRmluaXRlKHAuY29waWVzKSkgYmFzZS5zb3Vsc1tpZF0gPSB7IGxldmVsOiBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHAubGV2ZWwpKSwgY29waWVzOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHAuY29waWVzKSkgfTtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5zZXR0aW5ncyAmJiB0eXBlb2YgcmF3LnNldHRpbmdzID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLm11c2ljID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3MubXVzaWMgPSByYXcuc2V0dGluZ3MubXVzaWM7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3Muc2Z4ID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3Muc2Z4ID0gcmF3LnNldHRpbmdzLnNmeDtcbiAgfVxuICBpZiAoRElGRklDVUxUSUVTLmluY2x1ZGVzKHJhdy5kaWZmaWN1bHR5KSkgYmFzZS5kaWZmaWN1bHR5ID0gcmF3LmRpZmZpY3VsdHk7XG4gIGlmICh0eXBlb2YgcmF3LnN0YWdlID09PSAnc3RyaW5nJyAmJiAvXlthLXowLTlfLV17MSwyNH0kLy50ZXN0KHJhdy5zdGFnZSkpIGJhc2Uuc3RhZ2UgPSByYXcuc3RhZ2U7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5zZWVuKSkgYmFzZS5zZWVuID0gcmF3LnNlZW4uZmlsdGVyKChrOiBhbnkpID0+IHR5cGVvZiBrID09PSAnc3RyaW5nJyAmJiBrLmxlbmd0aCA8IDQwKS5zbGljZSgtODApO1xuICBlbHNlIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyhyYXcuY2xlYXJzKS5sZW5ndGgpIGJhc2Uuc2VlbiA9IG51bGw7ICAgIC8vIGFuIGV4aXN0aW5nIHBsYXllcjogZG8gbm90IHJlcGxheSBvbGQgdW5sb2Nrc1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcucGFja3MpKSB7XG4gICAgY29uc3QgaWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHJhdy5wYWNrcykge1xuICAgICAgaWYgKGJhc2UucGFja3MubGVuZ3RoID49IDk5IHx8ICFwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHAuaWQpIHx8IHAuaWQgPCAxIHx8IGlkcy5oYXMocC5pZCkgfHwgIU51bWJlci5pc0ludGVnZXIocC50aWVyKSB8fCBwLnRpZXIgPCAxIHx8IHAudGllciA+IFBBQ0tfVElFUlMpIGNvbnRpbnVlO1xuICAgICAgaWRzLmFkZChwLmlkKTsgYmFzZS5wYWNrcy5wdXNoKHsgaWQ6IHAuaWQsIHRpZXI6IHAudGllciwgc291cmNlOiB0eXBlb2YgcC5zb3VyY2UgPT09ICdzdHJpbmcnID8gcC5zb3VyY2Uuc2xpY2UoMCwgNDApIDogJycgfSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IG1heElkID0gYmFzZS5wYWNrcy5yZWR1Y2UoKG4sIHApID0+IE1hdGgubWF4KG4sIHAuaWQpLCAwKTtcbiAgYmFzZS5uZXh0UGFja0lkID0gTWF0aC5tYXgobWF4SWQgKyAxLCBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5uZXh0UGFja0lkKSAmJiByYXcubmV4dFBhY2tJZCA+IDAgPyByYXcubmV4dFBhY2tJZCA6IDEpO1xuICBpZiAocmF3LmNsZWFycyAmJiB0eXBlb2YgcmF3LmNsZWFycyA9PT0gJ29iamVjdCcpIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHJhdy5jbGVhcnMpKSBpZiAodHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDAgJiYgTnVtYmVyLmlzSW50ZWdlcih2KSAmJiAodiBhcyBudW1iZXIpID4gMCkgYmFzZS5jbGVhcnNba10gPSB2IGFzIG51bWJlcjtcbiAgaWYgKE51bWJlci5pc0ludGVnZXIocmF3LnJlcGxheU1ldGVyKSAmJiByYXcucmVwbGF5TWV0ZXIgPj0gMCAmJiByYXcucmVwbGF5TWV0ZXIgPCA1MCkgYmFzZS5yZXBsYXlNZXRlciA9IHJhdy5yZXBsYXlNZXRlcjtcbiAgaWYgKHJhdy5lbmRsZXNzICYmIE51bWJlci5pc0ludGVnZXIocmF3LmVuZGxlc3MuYmVzdCkgJiYgcmF3LmVuZGxlc3MuYmVzdCA+PSAwICYmIHJhdy5lbmRsZXNzLmJlc3QgPD0gOTk5OSkgYmFzZS5lbmRsZXNzLmJlc3QgPSByYXcuZW5kbGVzcy5iZXN0O1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcuZ29sZCkgJiYgcmF3LmdvbGQgPj0gMCAmJiByYXcuZ29sZCA8PSAxZTkpIGJhc2UuZ29sZCA9IHJhdy5nb2xkU2NhbGUgPT09IDIgPyByYXcuZ29sZCA6IE1hdGgubWluKDFlOSwgcmF3LmdvbGQgKiAxMDApOyAgIC8vIGVhcmx5IHNhdmVzIGNvdW50ZWQgZ29sZCBpbiB1bml0cyAxMDAgdGltZXMgc21hbGxlclxuICBlbHNlIGlmIChyYXcuZ29sZCA9PT0gdW5kZWZpbmVkICYmIE9iamVjdC5rZXlzKGJhc2UuY2xlYXJzKS5sZW5ndGgpIGJhc2UuZ29sZCA9IENBVENIX1VQX0dPTEQ7ICAgICAgICAvLyBhIHBsYXllciBmcm9tIGJlZm9yZSBnb2xkIGV4aXN0ZWQ6IG9uZS10aW1lIGdyYW50IHNvIHRoZSBuZXcgY29zdCBkb2VzIG5vdCBsb2NrIHRoZWlyIHN0b2NrcGlsZWQgY29waWVzXG4gIGlmIChyYXcuZGFpbHlTdHJlYWsgJiYgTnVtYmVyLmlzSW50ZWdlcihyYXcuZGFpbHlTdHJlYWsuY291bnQpICYmIHJhdy5kYWlseVN0cmVhay5jb3VudCA+PSAwICYmIHJhdy5kYWlseVN0cmVhay5jb3VudCA8IDFlNSAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5kYWlseVN0cmVhay5sYXN0KSAmJiByYXcuZGFpbHlTdHJlYWsubGFzdCA+PSAwICYmIHJhdy5kYWlseVN0cmVhay5sYXN0IDwgMWU2KSBiYXNlLmRhaWx5U3RyZWFrID0geyBjb3VudDogcmF3LmRhaWx5U3RyZWFrLmNvdW50LCBsYXN0OiByYXcuZGFpbHlTdHJlYWsubGFzdCB9O1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcuZGFpbHlXaW5zKSAmJiByYXcuZGFpbHlXaW5zID49IDAgJiYgcmF3LmRhaWx5V2lucyA8IDFlNSkgYmFzZS5kYWlseVdpbnMgPSByYXcuZGFpbHlXaW5zO1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcuY2xhaW1lZCkpIGJhc2UuY2xhaW1lZCA9IFsuLi5uZXcgU2V0PHN0cmluZz4ocmF3LmNsYWltZWQuZmlsdGVyKChrOiBhbnkpID0+IHR5cGVvZiBrID09PSAnc3RyaW5nJyAmJiBrLmxlbmd0aCA8IDQwKSldLnNsaWNlKDAsIDgwKTtcbiAgaWYgKHJhdy5kYWlseSAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5kYWlseS5kYXkpICYmIHJhdy5kYWlseS5kYXkgPiAwICYmIHJhdy5kYWlseS5kYXkgPCAxZTYpIGJhc2UuZGFpbHkgPSB7IGRheTogcmF3LmRhaWx5LmRheSwgd29uOiAhIXJhdy5kYWlseS53b24gfTtcbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cblxuLyoqIENoYW5nZSBzb3VuZCBzZXR0aW5ncyB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzKHBhdGNoOiBQYXJ0aWFsPFNldHRpbmdzPiwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2V0dGluZ3Mge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLnNldHRpbmdzID0geyAuLi5zLnNldHRpbmdzLCAuLi5wYXRjaCB9OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5zZXR0aW5ncztcbn1cblxuLyoqIFJlbWVtYmVyIHRoZSBjaG9zZW4gZGlmZmljdWx0eSB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZURpZmZpY3VsdHkoZDogRGlmZmljdWx0eSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogRGlmZmljdWx0eSB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuZGlmZmljdWx0eSA9IERJRkZJQ1VMVElFUy5pbmNsdWRlcyhkKSA/IGQgOiBzLmRpZmZpY3VsdHk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLmRpZmZpY3VsdHk7XG59XG4iLCAiLy8gUGVybWFuZW50IHByb2dyZXNzaW9uOiBzdGFnZSBjbGVhcnMgLT4gU291bCBQYWNrcyAtPiBjb3BpZXMgLT4gU291bCBsZXZlbHMuIFB1cmUgZnVuY3Rpb25zIHRoYXQgY2hhbmdlIGEgU2F2ZSAodGhlIGNhbGxlciBwZXJzaXN0cyBpdCkuXG4vLyBQbGFjZWhvbGRlciBudW1iZXJzLCBsaWtlIHBhY2tzLnRzLiBJbi1ydW4gc3RhciBtZXJnaW5nIGlzIGEgc2VwYXJhdGUsIHRlbXBvcmFyeSBzeXN0ZW0gYW5kIG5ldmVyIHRvdWNoZXMgYW55IG9mIHRoaXMuXG5cbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19QQUNLX0VWRVJZLCBlbmRsZXNzUGFja1RpZXIgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgTEVWRUxfQ09TVF9NVUxULCBQQUNLX1RJRVJTLCBSQVJJVFlfT0YsIG9wZW5QYWNrIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtLCBQYWNrUmVzdWx0IH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlLCB3cml0ZVNhdmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHsgU1RBR0VTLCBzdGFnZUJ5SWQsIHN0YWdlSW5kZXggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB0eXBlIHsgRGlmZmljdWx0eSwgU2F2ZSwgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5leHBvcnQgY29uc3QgTUFYX1BBQ0tTID0gOTk7XG5cbi8qKiBXaGVyZSBwYWNrcyBjb21lIGZyb20uIFBMQUNFSE9MREVSLiBGaXJzdCBjbGVhciBvZiBhIHN0YWdlIG9uIGVhY2ggZGlmZmljdWx0eSBnaXZlcyBvbmUgaW1wcm92ZWQgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgYSBtZXRlci4gKi9cbmV4cG9ydCBjb25zdCBSRVdBUkRTID0ge1xuICBmaXJzdENsZWFyVGllcjogeyBlYXN5OiAxLCBub3JtYWw6IDIsIGhhcmQ6IDIsIG5pZ2h0bWFyZTogMyB9IGFzIFJlY29yZDxEaWZmaWN1bHR5LCBudW1iZXI+LFxuICByZXBsYXlUaWVyOiB7IGVhc3k6IDEsIG5vcm1hbDogMSwgaGFyZDogMiwgbmlnaHRtYXJlOiAyIH0gYXMgUmVjb3JkPERpZmZpY3VsdHksIG51bWJlcj4sICAgLy8gZXZlcnkgY2xlYXIgcGF5cyBhIHBhY2s7IGhhcmRlciB0aWVycyBwYXkgYmV0dGVyXG4gIHJlcGxheUNsZWFyc1BlclBhY2s6IDEsXG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbGV2ZWxzXG5leHBvcnQgY29uc3QgbWF4TGV2ZWwgPSAoKTogbnVtYmVyID0+IEJBTEFOQ0UubGV2ZWwuY29waWVzVG9MZXZlbC5sZW5ndGggKyAxO1xuZXhwb3J0IGNvbnN0IGlzTWF4TGV2ZWwgPSAobGV2ZWw6IG51bWJlcik6IGJvb2xlYW4gPT4gbGV2ZWwgPj0gbWF4TGV2ZWwoKTtcbi8qKiBDb3BpZXMgbmVlZGVkIHRvIHRha2UgYHNvdWxgIGZyb20gYGxldmVsYCB0byB0aGUgbmV4dCBvbmUgKDAgd2hlbiBhbHJlYWR5IG1heCkuIFJhcmVyIFNvdWxzIG5lZWQgZmV3ZXIuICovXG5leHBvcnQgY29uc3QgY29waWVzTmVlZGVkID0gKGxldmVsOiBudW1iZXIsIHNvdWw6IFNvdWxJZCk6IG51bWJlciA9PiAoaXNNYXhMZXZlbChsZXZlbCkgPyAwIDogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZChCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWxbbGV2ZWwgLSAxXSAqIExFVkVMX0NPU1RfTVVMVFtSQVJJVFlfT0Zbc291bF1dKSkpO1xuLyoqXG4gKiBPbmUgcmVxdWlyZW1lbnQgb2YgYW4gdXBncmFkZS4gVG9kYXkgb25seSBjb3BpZXM7IHRoZSBjb25maXJtIHBvcHVwIGxpc3RzIGV2ZXJ5IGVudHJ5IHdpdGggaGF2ZSAvIG5lZWQsIGFuZCBDb25maXJtIGlzIGFsbG93ZWQgb25seSB3aGVuIGFsbCBhcmUgbWV0LlxuICogR29sZCB3aWxsIHNpbXBseSBiZWNvbWUgYSBzZWNvbmQgZW50cnkgaGVyZSAoeyBpZDogJ2dvbGQnLCAuLi4gfSkgYW5kIGJlIHNwZW50IGluIGxldmVsVXAoKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBVcGdyYWRlQ29zdCB7IGlkOiAnY29waWVzJyB8ICdnb2xkJzsgbGFiZWw6IHN0cmluZzsgaGF2ZTogbnVtYmVyOyBuZWVkOiBudW1iZXI7IG9rOiBib29sZWFuIH1cbi8qKiBHb2xkIHRvIHRha2UgYSBTb3VsIGZyb20gYGxldmVsYCB0byB0aGUgbmV4dCBvbmUgKDAgYXQgbWF4KS4gKi9cbmV4cG9ydCBjb25zdCBnb2xkTmVlZGVkID0gKGxldmVsOiBudW1iZXIpOiBudW1iZXIgPT4gKGlzTWF4TGV2ZWwobGV2ZWwpID8gMCA6IEJBTEFOQ0UubGV2ZWwuZ29sZFRvTGV2ZWxbbGV2ZWwgLSAxXSk7XG5leHBvcnQgZnVuY3Rpb24gdXBncmFkZUNvc3RzKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IFVwZ3JhZGVDb3N0W10ge1xuICBjb25zdCBwID0gc2F2ZS5zb3Vsc1tzb3VsXTsgaWYgKGlzTWF4TGV2ZWwocC5sZXZlbCkpIHJldHVybiBbXTtcbiAgY29uc3QgbmVlZCA9IGNvcGllc05lZWRlZChwLmxldmVsLCBzb3VsKTtcbiAgY29uc3QgZ29sZCA9IGdvbGROZWVkZWQocC5sZXZlbCk7XG4gIHJldHVybiBbeyBpZDogJ2NvcGllcycsIGxhYmVsOiAnQ29waWVzJywgaGF2ZTogcC5jb3BpZXMsIG5lZWQsIG9rOiBwLmNvcGllcyA+PSBuZWVkIH0sIHsgaWQ6ICdnb2xkJywgbGFiZWw6ICdHb2xkJywgaGF2ZTogc2F2ZS5nb2xkLCBuZWVkOiBnb2xkLCBvazogc2F2ZS5nb2xkID49IGdvbGQgfV07XG59XG5leHBvcnQgY29uc3QgY2FuQWZmb3JkID0gKGNvc3RzOiBVcGdyYWRlQ29zdFtdKTogYm9vbGVhbiA9PiBjb3N0cy5sZW5ndGggPiAwICYmIGNvc3RzLmV2ZXJ5KChjKSA9PiBjLm9rKTtcbmV4cG9ydCBjb25zdCBjYW5MZXZlbFVwID0gKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4gPT4gY2FuQWZmb3JkKHVwZ3JhZGVDb3N0cyhzYXZlLCBzb3VsKSk7XG4vKiogUGF5IGV2ZXJ5IGNvc3QgYW5kIGdhaW4gYSBsZXZlbC4gUmV0dXJucyBmYWxzZSAoYW5kIGNoYW5nZXMgbm90aGluZykgaWYgdGhlIFNvdWwgaXMgbm90IHJlYWR5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxldmVsVXAoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogYm9vbGVhbiB7XG4gIGNvbnN0IGNvc3RzID0gdXBncmFkZUNvc3RzKHNhdmUsIHNvdWwpOyBpZiAoIWNhbkFmZm9yZChjb3N0cykpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IGZvciAoY29uc3QgYyBvZiBjb3N0cykgeyBpZiAoYy5pZCA9PT0gJ2NvcGllcycpIHAuY29waWVzIC09IGMubmVlZDsgZWxzZSBzYXZlLmdvbGQgLT0gYy5uZWVkOyB9XG4gIHAubGV2ZWwrKzsgcmV0dXJuIHRydWU7XG59XG4vKiogRGVidWdnaW5nOiBwdXQgZXZlcnkgU291bCBiYWNrIHRvIGxldmVsIDEgKGNvcGllcyBhcmUga2VwdCkuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRMZXZlbHMoc2F2ZTogU2F2ZSk6IHZvaWQgeyBmb3IgKGNvbnN0IGsgb2YgU09VTFMpIHNhdmUuc291bHNba10ubGV2ZWwgPSAxOyB9XG4vKiogRGVidWdnaW5nOiBmb3JnZXQgYWxsIGNvbGxlY3RlZCBjb3BpZXMgKGxldmVscyBhcmUga2VwdCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJDb3BpZXMoc2F2ZTogU2F2ZSk6IHZvaWQgeyBmb3IgKGNvbnN0IGsgb2YgU09VTFMpIHNhdmUuc291bHNba10uY29waWVzID0gMDsgfVxuLyoqIE11bHRpcGxpZXIgYXBwbGllZCB0byBhIFNvdWwncyBoZWFsdGgvZGFtYWdlIGZyb20gaXRzIHBlcm1hbmVudCBsZXZlbCAobGV2ZWwgMSA9IDEuMCkuICovXG5leHBvcnQgY29uc3QgbGV2ZWxNdWx0ID0gKGxldmVsOiBudW1iZXIsIHN0YXQ6ICdocCcgfCAnZG1nJyk6IG51bWJlciA9PiAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQkFMQU5DRS5sZXZlbFtzdGF0XTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGdvbGRcbmV4cG9ydCBjb25zdCBHT0xEID0geyB0aWVyTXVsdDogeyBlYXN5OiAwLjYsIG5vcm1hbDogMSwgaGFyZDogMS40LCBuaWdodG1hcmU6IDIgfSBhcyBSZWNvcmQ8RGlmZmljdWx0eSwgbnVtYmVyPiwgcGFja1BlclRpZXI6IDE1MDAsIGRhaWx5V2luOiA1MDAwIH07XG4vKiogR29sZCBmb3IgY2xlYXJpbmcgb25lIGNhbXBhaWduIHdhdmU6IG1vcmUgaW4gbGF0ZXIgc3RhZ2VzIGFuZCBvbiBoYXJkZXIgdGllcnMuICovXG5leHBvcnQgY29uc3Qgd2F2ZUdvbGQgPSAoc3RhZ2U6IHN0cmluZywgdGllcjogRGlmZmljdWx0eSB8IHN0cmluZyk6IG51bWJlciA9PiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKDEwMCAqICg2ICsgMiAqIHN0YWdlSW5kZXgoc3RhZ2UpKSAqIChHT0xELnRpZXJNdWx0W3RpZXIgYXMgRGlmZmljdWx0eV0gPz8gMSkpKTtcbi8qKiBHb2xkIGZvciBjbGVhcmluZyBvbmUgRW5kbGVzcyB3YXZlLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NXYXZlR29sZCA9ICh3YXZlOiBudW1iZXIpOiBudW1iZXIgPT4gMTAwICogKDggKyBNYXRoLmZsb29yKDAuNiAqIE1hdGgubWF4KDEsIHdhdmUpKSk7XG4vKiogR29sZCBmb3Igb3BlbmluZyBhIHBhY2sgdGhhdCBmaW5pc2hlZCBhdCBgdGllcmAuICovXG5leHBvcnQgY29uc3QgcGFja0dvbGQgPSAodGllcjogbnVtYmVyKTogbnVtYmVyID0+IEdPTEQucGFja1BlclRpZXIgKiBNYXRoLm1heCgxLCB0aWVyKTtcbmV4cG9ydCBmdW5jdGlvbiBhZGRHb2xkKHNhdmU6IFNhdmUsIG46IG51bWJlcik6IG51bWJlciB7IGNvbnN0IGcgPSBNYXRoLm1heCgwLCBNYXRoLmZsb29yKG4pKTsgc2F2ZS5nb2xkID0gTWF0aC5taW4oMWU5LCBzYXZlLmdvbGQgKyBnKTsgcmV0dXJuIGc7IH1cbmV4cG9ydCBmdW5jdGlvbiBhZGRHb2xkQW5kU2F2ZShuOiBudW1iZXIsIHN0b3JlPzogU3RvcmUgfCBudWxsKTogbnVtYmVyIHsgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgZyA9IGFkZEdvbGQocywgbik7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBnOyB9XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwYWNrc1xuZXhwb3J0IGZ1bmN0aW9uIGdyYW50UGFjayhzYXZlOiBTYXZlLCB0aWVyOiBudW1iZXIsIHNvdXJjZTogc3RyaW5nKTogUGFja0l0ZW0gfCBudWxsIHtcbiAgaWYgKHNhdmUucGFja3MubGVuZ3RoID49IE1BWF9QQUNLUykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhY2s6IFBhY2tJdGVtID0geyBpZDogc2F2ZS5uZXh0UGFja0lkKyssIHRpZXI6IE1hdGgubWF4KDEsIE1hdGgubWluKFBBQ0tfVElFUlMsIE1hdGguZmxvb3IodGllcikpKSwgc291cmNlIH07XG4gIHNhdmUucGFja3MucHVzaChwYWNrKTsgcmV0dXJuIHBhY2s7XG59XG5cbi8qKiBPcGVuIGFuIG93bmVkIHBhY2s6IGl0IGlzIHJlbW92ZWQgYW5kIGl0cyBjb3BpZXMgYXJlIGFkZGVkIHRvIHRoZSBTb3VscyBpbW1lZGlhdGVseSAoc28gbm90aGluZyBpcyBsb3N0IGlmIHRoZSBwYWdlIGNsb3NlcyBtaWQtYW5pbWF0aW9uKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuT3duZWRQYWNrKHNhdmU6IFNhdmUsIHBhY2tJZDogbnVtYmVyLCBybmc6IFJuZyk6IFBhY2tSZXN1bHQgfCBudWxsIHtcbiAgY29uc3QgaSA9IHNhdmUucGFja3MuZmluZEluZGV4KChwKSA9PiBwLmlkID09PSBwYWNrSWQpOyBpZiAoaSA8IDApIHJldHVybiBudWxsO1xuICBjb25zdCBwYWNrID0gc2F2ZS5wYWNrc1tpXTsgc2F2ZS5wYWNrcy5zcGxpY2UoaSwgMSk7XG4gIGNvbnN0IHJlc3VsdCA9IG9wZW5QYWNrKHBhY2sudGllciwgcm5nKTtcbiAgZm9yIChjb25zdCByIG9mIHJlc3VsdC5yZXZlYWxzKSBzYXZlLnNvdWxzW3Iuc291bF0uY29waWVzICs9IHIuY29waWVzO1xuICBhZGRHb2xkKHNhdmUsIHBhY2tHb2xkKHJlc3VsdC5maW5hbFRpZXIpKTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDbGVhclJld2FyZCB7IGZpcnN0OiBib29sZWFuOyBwYWNrOiBQYWNrSXRlbSB8IG51bGw7IHJlcGxheU1ldGVyOiBudW1iZXI7IHJlcGxheU5lZWRlZDogbnVtYmVyOyB1bmxvY2tlZDogc3RyaW5nW10gfVxuLyoqIEEgc3RhZ2Ugd2FzIGNsZWFyZWQgb24gYGRpZmZpY3VsdHlgLiBUaGUgZmlyc3QgY2xlYXIgb24gdGhhdCBkaWZmaWN1bHR5IGdyYW50cyBhIGJldHRlciBwYWNrOyBsYXRlciBjbGVhcnMgZmlsbCB0aGUgcmVwbGF5IG1ldGVyLiAqL1xuZnVuY3Rpb24gcmVjb3JkQ2xlYXJCYXNlKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IE9taXQ8Q2xlYXJSZXdhcmQsICd1bmxvY2tlZCc+IHtcbiAgY29uc3Qga2V5ID0gc3RhZ2VJZCArICc6JyArIGRpZmZpY3VsdHksIGJlZm9yZSA9IHNhdmUuY2xlYXJzW2tleV0gPz8gMDtcbiAgc2F2ZS5jbGVhcnNba2V5XSA9IGJlZm9yZSArIDE7XG4gIGlmIChiZWZvcmUgPT09IDApIHJldHVybiB7IGZpcnN0OiB0cnVlLCBwYWNrOiBncmFudFBhY2soc2F2ZSwgUkVXQVJEUy5maXJzdENsZWFyVGllcltkaWZmaWN1bHR5XSArIChzdGFnZUluZGV4KHN0YWdlSWQpID09PSBTVEFHRVMubGVuZ3RoIC0gMSA/IDEgOiAwKSwgJ0ZpcnN0IGNsZWFyIFx1MDBCNyAnICsgZGlmZmljdWx0eSksIHJlcGxheU1ldGVyOiBzYXZlLnJlcGxheU1ldGVyLCByZXBsYXlOZWVkZWQ6IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjayB9O1xuICBzYXZlLnJlcGxheU1ldGVyKys7XG4gIGxldCBwYWNrOiBQYWNrSXRlbSB8IG51bGwgPSBudWxsO1xuICBpZiAoc2F2ZS5yZXBsYXlNZXRlciA+PSBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2spIHsgc2F2ZS5yZXBsYXlNZXRlciAtPSBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2s7IHBhY2sgPSBncmFudFBhY2soc2F2ZSwgUkVXQVJEUy5yZXBsYXlUaWVyW2RpZmZpY3VsdHldLCAnUmVwbGF5IHJld2FyZCcpOyB9XG4gIHJldHVybiB7IGZpcnN0OiBmYWxzZSwgcGFjaywgcmVwbGF5TWV0ZXI6IHNhdmUucmVwbGF5TWV0ZXIsIHJlcGxheU5lZWRlZDogUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwZXJzaXN0ZWQgd3JhcHBlcnMgKHVzZWQgYnkgdGhlIGdhbWUgYnVuZGxlKVxuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyQW5kU2F2ZShzdGFnZUlkOiBzdHJpbmcsIGRpZmZpY3VsdHk6IERpZmZpY3VsdHksIHN0b3JlPzogU3RvcmUgfCBudWxsKTogQ2xlYXJSZXdhcmQge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBjb25zdCByID0gcmVjb3JkQ2xlYXIocywgc3RhZ2VJZCwgZGlmZmljdWx0eSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gRGFpbHkgQ2hhbGxlbmdlXG5leHBvcnQgaW50ZXJmYWNlIERhaWx5UmV3YXJkIHsgZmlyc3Q6IGJvb2xlYW47IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgZ29sZDogbnVtYmVyOyBzdHJlYWs6IG51bWJlciB9XG4vKiogVGhlIHN0cmVhayB0aGF0IGNvdW50cyB0b2RheTogc3RpbGwgYWxpdmUgaWYgdGhlIGxhc3Qgd2luIHdhcyB0b2RheSBvciB5ZXN0ZXJkYXksIG90aGVyd2lzZSAwLiAqL1xuZXhwb3J0IGNvbnN0IGRhaWx5U3RyZWFrTm93ID0gKHNhdmU6IFNhdmUsIGRheTogbnVtYmVyKTogbnVtYmVyID0+IChzYXZlLmRhaWx5U3RyZWFrLmxhc3QgPT09IGRheSB8fCBzYXZlLmRhaWx5U3RyZWFrLmxhc3QgPT09IGRheSAtIDEgPyBzYXZlLmRhaWx5U3RyZWFrLmNvdW50IDogMCk7XG4vKiogRGFpbHkgcGFjayB0aWVyIGJ5IHN0cmVhazogMSBhdCBmaXJzdCwgMiBmcm9tIHRocmVlIGRheXMgaW4gYSByb3csIDMgZnJvbSBzZXZlbi4gKi9cbmV4cG9ydCBjb25zdCBkYWlseVBhY2tUaWVyID0gKHN0cmVhazogbnVtYmVyKTogbnVtYmVyID0+IChzdHJlYWsgPj0gNyA/IDMgOiBzdHJlYWsgPj0gMyA/IDIgOiAxKTtcbi8qKiBUaGUgZGF5J3MgY2hhbGxlbmdlIHdhcyB3b24uIE9ubHkgdGhlIGZpcnN0IHdpbiBvZiBhIGdpdmVuIGRheSBwYXlzIChhIFRpZXIgMSBwYWNrIGFuZCBzb21lIGdvbGQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZERhaWx5V2luKHNhdmU6IFNhdmUsIGRheTogbnVtYmVyKTogRGFpbHlSZXdhcmQge1xuICBpZiAoc2F2ZS5kYWlseSAmJiBzYXZlLmRhaWx5LmRheSA9PT0gZGF5ICYmIHNhdmUuZGFpbHkud29uKSByZXR1cm4geyBmaXJzdDogZmFsc2UsIHBhY2s6IG51bGwsIGdvbGQ6IDAsIHN0cmVhazogZGFpbHlTdHJlYWtOb3coc2F2ZSwgZGF5KSB9O1xuICBjb25zdCBzdHJlYWsgPSBzYXZlLmRhaWx5U3RyZWFrLmxhc3QgPT09IGRheSAtIDEgPyBzYXZlLmRhaWx5U3RyZWFrLmNvdW50ICsgMSA6IDE7XG4gIHNhdmUuZGFpbHkgPSB7IGRheSwgd29uOiB0cnVlIH07IHNhdmUuZGFpbHlTdHJlYWsgPSB7IGNvdW50OiBzdHJlYWssIGxhc3Q6IGRheSB9OyBzYXZlLmRhaWx5V2lucysrO1xuICByZXR1cm4geyBmaXJzdDogdHJ1ZSwgcGFjazogZ3JhbnRQYWNrKHNhdmUsIGRhaWx5UGFja1RpZXIoc3RyZWFrKSwgJ0RhaWx5IGNoYWxsZW5nZScpLCBnb2xkOiBhZGRHb2xkKHNhdmUsIEdPTEQuZGFpbHlXaW4gKyAxMDAwICogKE1hdGgubWluKHN0cmVhaywgNykgLSAxKSksIHN0cmVhayB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZERhaWx5V2luQW5kU2F2ZShkYXk6IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBEYWlseVJld2FyZCB7IGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IHIgPSByZWNvcmREYWlseVdpbihzLCBkYXkpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjsgfVxuLyoqIEhhcyB0b2RheSdzIHJld2FyZCBhbHJlYWR5IGJlZW4gdGFrZW4/ICovXG5leHBvcnQgY29uc3QgZGFpbHlEb25lID0gKHNhdmU6IFNhdmUsIGRheTogbnVtYmVyKTogYm9vbGVhbiA9PiAhIXNhdmUuZGFpbHkgJiYgc2F2ZS5kYWlseS5kYXkgPT09IGRheSAmJiBzYXZlLmRhaWx5LndvbjtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEVuZGxlc3MgRGVwdGhzXG5leHBvcnQgaW50ZXJmYWNlIEVuZGxlc3NSZXdhcmQgeyB3YXZlOiBudW1iZXI7IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgbmV3QmVzdDogYm9vbGVhbiB9XG4vKiogV2F2ZSBgd2F2ZWAgb2YgYW4gZW5kbGVzcyBydW4gd2FzIGNsZWFyZWQ6IGEgcGFjayBvbiBldmVyeSAxMHRoIHdhdmUgKGJldHRlciB0aWVycyBkZWVwZXIpLCBhbmQgdGhlIGJlc3QgZGVwdGggaXMgcmVtZW1iZXJlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFbmRsZXNzV2F2ZShzYXZlOiBTYXZlLCB3YXZlOiBudW1iZXIpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgbmV3QmVzdCA9IHdhdmUgPiBzYXZlLmVuZGxlc3MuYmVzdDsgaWYgKG5ld0Jlc3QpIHNhdmUuZW5kbGVzcy5iZXN0ID0gd2F2ZTtcbiAgY29uc3QgcGFjayA9IHdhdmUgPiAwICYmIHdhdmUgJSBFTkRMRVNTX1BBQ0tfRVZFUlkgPT09IDAgPyBncmFudFBhY2soc2F2ZSwgZW5kbGVzc1BhY2tUaWVyKHdhdmUpLCAnRW5kbGVzcyBcdTAwQjcgd2F2ZSAnICsgd2F2ZSkgOiBudWxsO1xuICByZXR1cm4geyB3YXZlLCBwYWNrLCBuZXdCZXN0IH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlKHdhdmU6IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZEVuZGxlc3NXYXZlKHMsIHdhdmUpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cbi8qKiBFbmRsZXNzIERlcHRocyBvcGVucyBvbmNlIHRoZSBsYXN0IGNhbXBhaWduIHN0YWdlIGhhcyBiZWVuIGNsZWFyZWQgb24gTm9ybWFsLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NVbmxvY2tlZCA9IChzYXZlOiBTYXZlKTogYm9vbGVhbiA9PiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tTVEFHRVMubGVuZ3RoIC0gMV0uaWQsICdub3JtYWwnKSA+IDA7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB1bmxvY2sgcnVsZXNcbi8vIEVhc3kgYW5kIE5vcm1hbCBhcmUgb3BlbiBvbiBldmVyeSB1bmxvY2tlZCBzdGFnZS4gQ2xlYXJpbmcgTm9ybWFsIG9wZW5zIEhhcmQgb24gdGhhdCBzdGFnZSBBTkQgdW5sb2NrcyB0aGUgbmV4dCBzdGFnZS4gQ2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5leHBvcnQgY29uc3QgY2xlYXJDb3VudCA9IChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogbnVtYmVyID0+IHNhdmUuY2xlYXJzW3N0YWdlICsgJzonICsgZF0gPz8gMDtcbmV4cG9ydCBmdW5jdGlvbiBzdGFnZVVubG9ja2VkKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBib29sZWFuIHsgcmV0dXJuIGluZGV4IDw9IDAgfHwgKGluZGV4IDwgU1RBR0VTLmxlbmd0aCAmJiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tpbmRleCAtIDFdLmlkLCAnbm9ybWFsJykgPiAwKTsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogYm9vbGVhbiB7XG4gIGNvbnN0IGlkeCA9IFNUQUdFUy5maW5kSW5kZXgoKHMpID0+IHMuaWQgPT09IHN0YWdlKTsgaWYgKGlkeCA8IDAgfHwgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZCA9PT0gJ2Vhc3knIHx8IGQgPT09ICdub3JtYWwnKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIGQgPT09ICdoYXJkJyA/IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdub3JtYWwnKSA+IDAgOiBjbGVhckNvdW50KHNhdmUsIHN0YWdlLCAnaGFyZCcpID4gMDtcbn1cbi8qKiBXaHkgYSBzdGFnZSBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhZ2VMb2NrUmVhc29uKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBzdHJpbmcgeyByZXR1cm4gc3RhZ2VVbmxvY2tlZChzYXZlLCBpbmRleCkgPyAnJyA6ICdDbGVhciAnICsgU1RBR0VTW2luZGV4IC0gMV0ubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jay4nOyB9XG4vKiogV2h5IGEgdGllciBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgc3RhZ2U6IHN0cmluZywgZDogRGlmZmljdWx0eSk6IHN0cmluZyB7XG4gIGlmIChkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIGQpKSByZXR1cm4gJyc7XG4gIGNvbnN0IGlkeCA9IHN0YWdlSW5kZXgoc3RhZ2UpOyBpZiAoIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIHN0YWdlTG9ja1JlYXNvbihzYXZlLCBpZHgpO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIE5vcm1hbCB0byB1bmxvY2sgSGFyZC4nIDogJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIEhhcmQgdG8gdW5sb2NrIE5pZ2h0bWFyZS4nO1xufVxuLyoqIFdoYXRldmVyIHdhcyBzYXZlZCwgbWFrZSBpdCBhIHN0YWdlIGFuZCB0aWVyIHRoZSBwbGF5ZXIgbWF5IGFjdHVhbGx5IHBsYXkuICovXG5leHBvcnQgZnVuY3Rpb24gcGxheWFibGUoc2F2ZTogU2F2ZSk6IHsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogRGlmZmljdWx0eSB9IHtcbiAgbGV0IGlkeCA9IHN0YWdlSW5kZXgoc2F2ZS5zdGFnZSk7IHdoaWxlIChpZHggPiAwICYmICFzdGFnZVVubG9ja2VkKHNhdmUsIGlkeCkpIGlkeC0tO1xuICBjb25zdCBzdGFnZSA9IFNUQUdFU1tpZHhdLmlkO1xuICByZXR1cm4geyBzdGFnZSwgZGlmZmljdWx0eTogZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0YWdlLCBzYXZlLmRpZmZpY3VsdHkpID8gc2F2ZS5kaWZmaWN1bHR5IDogJ25vcm1hbCcgfTtcbn1cblxuLyoqIEV2ZXJ5IHVubG9jayB0aGUgcGxheWVyIG1heSBiZSBjZWxlYnJhdGVkIGZvcjogbGF0ZXIgc3RhZ2VzIGFuZCB0aGUgSGFyZCAvIE5pZ2h0bWFyZSB0aWVycyAoRWFzeSwgTm9ybWFsIGFuZCBTdGFnZSAxIGFyZSBvcGVuIGZyb20gdGhlIHN0YXJ0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmxvY2tlZEtleXMoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qga2V5czogc3RyaW5nW10gPSBbXTtcbiAgU1RBR0VTLmZvckVhY2goKHN0LCBpKSA9PiB7XG4gICAgaWYgKGkgPiAwICYmIHN0YWdlVW5sb2NrZWQoc2F2ZSwgaSkpIGtleXMucHVzaCgnc3RhZ2U6JyArIHN0LmlkKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgWydoYXJkJywgJ25pZ2h0bWFyZSddIGFzIERpZmZpY3VsdHlbXSkgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdC5pZCwgZCkpIGtleXMucHVzaCgndGllcjonICsgc3QuaWQgKyAnOicgKyBkKTtcbiAgfSk7XG4gIGlmIChlbmRsZXNzVW5sb2NrZWQoc2F2ZSkpIGtleXMucHVzaCgnZW5kbGVzcycpO1xuICByZXR1cm4ga2V5cztcbn1cbi8qKiBVbmxvY2tzIG5vdCB5ZXQgY2VsZWJyYXRlZC4gKi9cbmV4cG9ydCBjb25zdCBuZXdVbmxvY2tzID0gKHNhdmU6IFNhdmUpOiBzdHJpbmdbXSA9PiB1bmxvY2tlZEtleXMoc2F2ZSkuZmlsdGVyKChrKSA9PiAhKHNhdmUuc2VlbiA/PyBbXSkuaW5jbHVkZXMoaykpO1xuY29uc3QgVElFUl9OQU1FOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBoYXJkOiAnSGFyZCBtb2RlJywgbmlnaHRtYXJlOiAnTmlnaHRtYXJlIG1vZGUnIH07XG4vKiogV29yZHMgZm9yIGFuIHVubG9jayBrZXksIGZvciBiYW5uZXJzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlVW5sb2NrKGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGtleSA9PT0gJ2VuZGxlc3MnKSByZXR1cm4gJ0VuZGxlc3MgRGVwdGhzIChuZXcgbW9kZSknO1xuICBjb25zdCBba2luZCwgc3RhZ2UsIHRpZXJdID0ga2V5LnNwbGl0KCc6Jyk7XG4gIGlmIChraW5kID09PSAnc3RhZ2UnKSByZXR1cm4gc3RhZ2VCeUlkKHN0YWdlKS5uYW1lICsgJyAobmV3IHN0YWdlKSc7XG4gIHJldHVybiAoVElFUl9OQU1FW3RpZXJdID8/IHRpZXIpICsgJyBvbiAnICsgc3RhZ2VCeUlkKHN0YWdlKS5uYW1lO1xufVxuLyoqIENsZWFyaW5nIGEgc3RhZ2U6IHJld2FyZHMsIGFuZCB3aGljaCB1bmxvY2tzIHRoaXMgY2xlYXIgb3BlbmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgYmVmb3JlID0gdW5sb2NrZWRLZXlzKHNhdmUpLCByID0gcmVjb3JkQ2xlYXJCYXNlKHNhdmUsIHN0YWdlSWQsIGRpZmZpY3VsdHkpO1xuICByZXR1cm4geyAuLi5yLCB1bmxvY2tlZDogdW5sb2NrZWRLZXlzKHNhdmUpLmZpbHRlcigoaykgPT4gIWJlZm9yZS5pbmNsdWRlcyhrKSkgfTtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3MgY2hhcmFjdGVyOiB0aGUgTmVjcm9tYW5jZXIgKGEgcmlnZ2VkIFRyaXBvIG1vZGVsLCBQaXBlbGluZS91bml0cy9uZWNyb21hbmNlci5qc29uKS5cbi8vIEhlIHN0YW5kcyBiZXNpZGUgdGhlIGdyaWQsIHRha2VzIHRoZSBoaXQgd2hlbiBhbiBhcm15IGlzIHdpcGVkIChoZWFydHMgYXJlIEhJUyBoZWFsdGgpLCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUgYW5kIHJhaXNlc1xuLy8gdGhlIGZhbGxlbi4gRXZlcnl0aGluZyBoZXJlIGlzIGFuaW1hdGlvbiBvbmx5OyB0aGUgcnVsZXMgbGl2ZSBpbiBjb3JlL3J1bGVzLnRzLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5cbmV4cG9ydCBjbGFzcyBOZWNyb21hbmNlciB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbjsgbG9jYWwgK1ogaXMgaGlzIGZhY2luZyAodGhlIGdhbWUgcm90YXRlcyBoaW0gdG8gZmFjZSB0aGUgYmF0dGxlZmllbGQpXG4gIHByaXZhdGUgZW50OiBhbnk7IHByaXZhdGUgYW5pbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTsgcHJpdmF0ZSBjdXI6IGFueSA9IG51bGw7IHByaXZhdGUgaGFuZDogYW55ID0gbnVsbDsgcHJpdmF0ZSByaW5nOiBhbnk7IHByaXZhdGUgcHM6IGFueTtcbiAgcHJpdmF0ZSB0ID0gMDsgcHJpdmF0ZSBpZGxlVCA9IDA7IHByaXZhdGUgbmV4dFRhcCA9IDg7IHByaXZhdGUgYnVzeSA9IGZhbHNlOyBwcml2YXRlIGRvd25lZCA9IGZhbHNlOyBwcml2YXRlIHJlYWRvbmx5IFMgPSAxLjM1O1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgc2NlbmU6IGFueSwgcHJpdmF0ZSBzb2Z0OiBhbnksIGNvbnRhaW5lcjogYW55KSB7XG4gICAgY29uc3QgcyA9IHNjZW5lO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbmVjcm8nLCBzKTtcbiAgICB0aGlzLmVudCA9IGNvbnRhaW5lci5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfbmVjcm8nLCBmYWxzZSwgeyBkb05vdEluc3RhbnRpYXRlOiB0cnVlIH0pO1xuICAgIGNvbnN0IHJvb3QgPSB0aGlzLmVudC5yb290Tm9kZXNbMF07IHJvb3QucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuUyk7XG4gICAgcm9vdC5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmlzUGlja2FibGUgPSBmYWxzZTsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyB9KTtcbiAgICB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiB7IGcuc3RvcCgpOyBnLmVuYWJsZUJsZW5kaW5nID0gdHJ1ZTsgZy5ibGVuZGluZ1NwZWVkID0gMC4xMjsgdGhpcy5hbmltc1tnLm5hbWUuc3BsaXQoJ18nKVswXV0gPSBnOyB9KTtcbiAgICB0aGlzLmhhbmQgPSByb290LmdldENoaWxkVHJhbnNmb3JtTm9kZXMoZmFsc2UpLmZpbmQoKG46IGFueSkgPT4gbi5uYW1lLmluY2x1ZGVzKCdTb2NrZXRfV2VhcG9uJykpIHx8IG51bGw7XG4gICAgdGhpcy5wbGF5KCdJZGxlJywgdHJ1ZSk7XG4gICAgY29uc3QgcmluZyA9IHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygnYmFzZScsIHsgcmFkaXVzOiAwLjUsIHRlc3NlbGxhdGlvbjogMzAgfSwgcyk7IHJpbmcucGFyZW50ID0gdGhpcy5ob2xkZXI7IHJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyByaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyByaW5nLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBybSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ25yJywgcyk7IHJtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHJtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC40LCAwLjE1LCAwLjc1KTsgcm0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcm0uYWxwaGEgPSAwLjU1OyByaW5nLm1hdGVyaWFsID0gcm07XG4gICAgY29uc3QgcHMgPSB0aGlzLnBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ25lY3JvQXVyYScsIDgwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gc29mdDsgcHMuZW1pdHRlciA9IHRoaXMuaG9sZGVyO1xuICAgIHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjI1LCAwLCAtMC4yNSk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMjUsIDAuOCwgMC4yNSk7IHBzLm1pbkxpZmVUaW1lID0gMC42OyBwcy5tYXhMaWZlVGltZSA9IDEuMztcbiAgICBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xNSwgMC45LCAtMC4xNSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMTUsIDEuNiwgMC4xNSk7IHBzLm1pbkVtaXRQb3dlciA9IDAuMzsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApO1xuICAgIHBzLm1pblNpemUgPSAwLjA3OyBwcy5tYXhTaXplID0gMC4yOyBwcy5lbWl0UmF0ZSA9IDMwOyBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC44LCAwLjM1LCAxLCAwLjcpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC40NSwgMC4xNSwgMC45LCAwLjUpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4yLCAwLCAwLjQsIDApO1xuICAgIHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMuc3RhcnQoKTtcbiAgfVxuXG4gIHByaXZhdGUgcGxheShuYW1lOiBzdHJpbmcsIGxvb3AgPSBmYWxzZSwgaG9sZCA9IGZhbHNlKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbbmFtZV07IGlmICghZykgcmV0dXJuO1xuICAgIGlmICh0aGlzLmN1ciAmJiB0aGlzLmN1ciAhPT0gZykgdGhpcy5jdXIuc3RvcCgpO1xuICAgIGcuc3RvcCgpOyBnLnN0YXJ0KGxvb3AsIDEsIGcuZnJvbSwgZy50byk7IHRoaXMuY3VyID0gZzsgdGhpcy5idXN5ID0gIWxvb3A7IHRoaXMuaG9sZEVuZCA9IGhvbGQ7XG4gIH1cbiAgcHJpdmF0ZSBob2xkRW5kID0gZmFsc2U7XG4gIHNldEVuYWJsZWQob246IGJvb2xlYW4pIHsgdGhpcy5ob2xkZXIuc2V0RW5hYmxlZChvbik7IGlmIChvbikgdGhpcy5wcy5zdGFydCgpOyBlbHNlIHRoaXMucHMuc3RvcCgpOyB9XG4gIC8qKiBXb3JsZCBwb3NpdGlvbiBvZiB0aGUgc3RhZmYgY3J5c3RhbCAoZm9yIHNwZWxsIGVmZmVjdHMpOiBhYm92ZSB0aGUgaGFuZCB0aGF0IGhvbGRzIHRoZSBzdGFmZi4gKi9cbiAgY3J5c3RhbFBvcygpOiBhbnkge1xuICAgIHRoaXMuaG9sZGVyLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTtcbiAgICBjb25zdCBiYXNlID0gdGhpcy5oYW5kID8gKHRoaXMuaGFuZC5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSksIHRoaXMuaGFuZC5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuY2xvbmUoKSkgOiB0aGlzLmhvbGRlci5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuYWRkKG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC42ICogdGhpcy5TLCAwKSk7XG4gICAgcmV0dXJuIGJhc2UuYWRkKG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC42MiAqIHRoaXMuUywgMCkpO1xuICB9XG5cbiAgaHVydCgpIHsgaWYgKCF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdIdXJ0Jyk7IH1cbiAgY2FzdCgpIHsgaWYgKCF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdDYXN0Jyk7IH1cbiAgLyoqIFRoZSBsYXN0IGhlYXJ0IGlzIGdvbmU6IGhlIHNpbmtzIHRvIGhpcyBrbmVlcy4gKi9cbiAgZGVmZWF0KCkgeyB0aGlzLmRvd25lZCA9IHRydWU7IHRoaXMucGxheSgnRG93bicsIGZhbHNlLCB0cnVlKTsgfVxuICByZXZpdmUoKSB7IGlmICh0aGlzLmRvd25lZCkgeyB0aGlzLmRvd25lZCA9IGZhbHNlOyB0aGlzLnBsYXkoJ1Jldml2ZScpOyB9IGVsc2UgaWYgKHRoaXMuYnVzeSAmJiB0aGlzLmN1ciAhPT0gdGhpcy5hbmltc1snSWRsZSddKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTsgfVxuXG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0O1xuICAgIGlmICh0aGlzLmN1ciAmJiAhdGhpcy5jdXIuaXNTdGFydGVkICYmICF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdJZGxlJywgdHJ1ZSk7ICAgICAgICAgICAgICAvLyBhIG9uZS1zaG90IGZpbmlzaGVkXG4gICAgZWxzZSBpZiAodGhpcy5jdXIgJiYgIXRoaXMuY3VyLmlzU3RhcnRlZCAmJiB0aGlzLmRvd25lZCAmJiAhdGhpcy5ob2xkRW5kKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTtcbiAgICBpZiAoIXRoaXMuYnVzeSAmJiAhdGhpcy5kb3duZWQpIHsgdGhpcy5pZGxlVCArPSBkdDsgaWYgKHRoaXMuaWRsZVQgPiB0aGlzLm5leHRUYXApIHsgdGhpcy5pZGxlVCA9IDA7IHRoaXMubmV4dFRhcCA9IDkgKyBNYXRoLnJhbmRvbSgpICogODsgdGhpcy5wbGF5KCdUYXAnKTsgfSB9XG4gICAgdGhpcy5wcy5lbWl0UmF0ZSA9IHRoaXMuZG93bmVkID8gNiA6ICh0aGlzLmJ1c3kgJiYgdGhpcy5jdXIgPT09IHRoaXMuYW5pbXNbJ0Nhc3QnXSA/IDExMCA6IDMwKTtcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7IHRoaXMucHMuc3RvcCgpOyB0aGlzLnBzLmRpc3Bvc2UoKTsgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4gZy5kaXNwb3NlKCkpOyB0aGlzLmVudC5za2VsZXRvbnMuZm9yRWFjaCgoczogYW55KSA9PiBzLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuIiwgIi8vIEFsbCBzb3VuZCBpcyBzeW50aGVzaXplZCBpbiB0aGUgYnJvd3NlciB3aXRoIHRoZSBXZWIgQXVkaW8gQVBJOiBubyBhdWRpbyBmaWxlcyB0byBkb3dubG9hZCwgbGljZW5zZSBvciBzaGlwLlxuLy8gVHdvIGluZGVwZW5kZW50IHN3aXRjaGVzIChtdXNpYywgc291bmQgZWZmZWN0cyksIHNhdmVkIGluIHRoZSBwbGF5ZXIncyBzYXZlLiBQaG9uZXMgb25seSBhbGxvdyBzb3VuZCBhZnRlciBhIHRhcCwgc28gbm90aGluZyBzdGFydHNcbi8vIHVudGlsIHRoZSBmaXJzdCB0b3VjaC9jbGljayAoYHVubG9ja2ApLlxuaW1wb3J0IHsgbG9hZFNhdmUsIHVwZGF0ZVNldHRpbmdzIH0gZnJvbSAnLi4vY29yZS9zYXZlLnRzJztcblxuZXhwb3J0IHR5cGUgU2Z4ID0gJ3RhcCcgfCAnc3VtbW9uJyB8ICdtZXJnZScgfCAnaGl0JyB8ICdoaXRBcnJvdycgfCAnc21hc2gnIHwgJ2Fycm93JyB8ICdkZWF0aCcgfCAnY2FzdCcgfCAndGF1bnQnIHwgJ3Nob2Nrd2F2ZScgfCAncmVzdXJyZWN0JyB8ICdoZWFydExvc3QnIHwgJ3ZpY3RvcnknIHwgJ2RlZmVhdCcgfCAnc3RhcnQnXG4gIHwgJ3VubG9jaycgfCAncGFja0NoYXJnZScgfCAncGFja1RpZXJVcCcgfCAncGFja1RlYXInIHwgJ3BhY2tGYW4nIHwgJ3BhY2tGbGlwJyB8ICdwYWNrUmFyZScgfCAncGFja0VwaWMnIHwgJ3BhY2tMZWdlbmQnIHwgJ3BhY2tDb2xsZWN0JztcbmV4cG9ydCB0eXBlIE1vZGUgPSAnYnVpbGQnIHwgJ2JhdHRsZSc7XG5cbi8vIE11c2ljOiBBIG1pbm9yLCA4MCBicG0sIGZvdXIgYmFycyBsb29waW5nIChBbSwgRiwgQywgRSkuIFJvb3Qgbm90ZSBmaXJzdCwgdGhlbiBjaG9yZCB0b25lcyAoSHopLlxuY29uc3QgQ0hPUkRTOiBudW1iZXJbXVtdID0gW1xuICBbMTEwLCAxNjQuODEsIDIyMCwgMjYxLjYzLCAzMjkuNjNdLFxuICBbODcuMzEsIDEzMC44MSwgMTc0LjYxLCAyMjAsIDI2MS42M10sXG4gIFsxMzAuODEsIDE5NiwgMjYxLjYzLCAzMjkuNjMsIDM5Ml0sXG4gIFs4Mi40MSwgMTIzLjQ3LCAxNjQuODEsIDIwNy42NSwgMjQ2Ljk0XSxcbl07XG5jb25zdCBCRUFUID0gNjAgLyA4MDtcblxuY2xhc3MgQXVkaW9FbmdpbmUge1xuICBwcml2YXRlIGN0eDogQXVkaW9Db250ZXh0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbWFzdGVyITogR2Fpbk5vZGU7IHByaXZhdGUgbXVzaWNCdXMhOiBHYWluTm9kZTsgcHJpdmF0ZSBzZnhCdXMhOiBHYWluTm9kZTsgcHJpdmF0ZSBub2lzZUJ1ZiE6IEF1ZGlvQnVmZmVyO1xuICBtdXNpYyA9IHRydWU7IHNmeCA9IHRydWU7IG1vZGU6IE1vZGUgPSAnYnVpbGQnO1xuICBwcml2YXRlIHRpbWVyID0gMDsgcHJpdmF0ZSBuZXh0VCA9IDA7IHByaXZhdGUgYmVhdCA9IDA7IHByaXZhdGUgc3RhbXBzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG5cbiAgY29uc3RydWN0b3IoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgfVxuXG4gIHByaXZhdGUgc2lsZW50OiBIVE1MQXVkaW9FbGVtZW50IHwgbnVsbCA9IG51bGw7IHByaXZhdGUgcHJpbWVkID0gZmFsc2U7XG4gIC8qKiBpUGhvbmVzIG11dGUgV2ViIEF1ZGlvIHdoZW4gdGhlIHJpbmdlciBzd2l0Y2ggaXMgb24sIHVubGVzcyB0aGUgcGFnZSBpcyBwbGF5aW5nIFwicmVhbFwiIG1lZGlhLiBBIHNpbGVudCBsb29waW5nIDxhdWRpbz4gZWxlbWVudCAocGx1cyB0aGVcbiAgICogIGF1ZGlvU2Vzc2lvbiBoaW50IG9uIG5ld2VyIGlPUykgbW92ZXMgdGhlIHBhZ2UgdG8gdGhlIHBsYXliYWNrIGNoYW5uZWwsIHNvIHRoZSBnYW1lIGlzIGhlYXJkIGV2ZW4gd2l0aCB0aGUgc3dpdGNoIG9uIHNpbGVudC4gKi9cbiAgcHJpdmF0ZSBwbGF5YmFja0NoYW5uZWwoKSB7XG4gICAgdHJ5IHsgY29uc3QgYSA9IChuYXZpZ2F0b3IgYXMgYW55KS5hdWRpb1Nlc3Npb247IGlmIChhKSBhLnR5cGUgPSAncGxheWJhY2snOyB9IGNhdGNoIHsgLyogbm90IHN1cHBvcnRlZCAqLyB9XG4gICAgaWYgKHRoaXMuc2lsZW50KSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG4gPSA0NDEsIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcig0NCArIG4gKiAyKSwgdiA9IG5ldyBEYXRhVmlldyhidWYpLCBzdHIgPSAobzogbnVtYmVyLCB0OiBzdHJpbmcpID0+IHsgZm9yIChsZXQgaSA9IDA7IGkgPCB0Lmxlbmd0aDsgaSsrKSB2LnNldFVpbnQ4KG8gKyBpLCB0LmNoYXJDb2RlQXQoaSkpOyB9O1xuICAgICAgc3RyKDAsICdSSUZGJyk7IHYuc2V0VWludDMyKDQsIDM2ICsgbiAqIDIsIHRydWUpOyBzdHIoOCwgJ1dBVkUnKTsgc3RyKDEyLCAnZm10ICcpOyB2LnNldFVpbnQzMigxNiwgMTYsIHRydWUpOyB2LnNldFVpbnQxNigyMCwgMSwgdHJ1ZSk7IHYuc2V0VWludDE2KDIyLCAxLCB0cnVlKTtcbiAgICAgIHYuc2V0VWludDMyKDI0LCA0NDEwMCwgdHJ1ZSk7IHYuc2V0VWludDMyKDI4LCA4ODIwMCwgdHJ1ZSk7IHYuc2V0VWludDE2KDMyLCAyLCB0cnVlKTsgdi5zZXRVaW50MTYoMzQsIDE2LCB0cnVlKTsgc3RyKDM2LCAnZGF0YScpOyB2LnNldFVpbnQzMig0MCwgbiAqIDIsIHRydWUpO1xuICAgICAgY29uc3QgZWwgPSBuZXcgQXVkaW8oVVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbYnVmXSwgeyB0eXBlOiAnYXVkaW8vd2F2JyB9KSkpOyBlbC5sb29wID0gdHJ1ZTsgZWwudm9sdW1lID0gMC4wMTsgZWwuc2V0QXR0cmlidXRlKCdwbGF5c2lubGluZScsICcnKTsgdGhpcy5zaWxlbnQgPSBlbDtcbiAgICAgIGVsLnBsYXkoKS5jYXRjaCgoKSA9PiB7IHRoaXMuc2lsZW50ID0gbnVsbDsgfSk7XG4gICAgfSBjYXRjaCB7IC8qIGZpbmU6IHNvdW5kIHN0aWxsIHdvcmtzLCBqdXN0IGZvbGxvd3MgdGhlIHNpbGVudCBzd2l0Y2ggKi8gfVxuICB9XG4gIC8qKiBXaGF0IHRoZSBTZXR0aW5ncyBwYWdlIHNob3dzIHNvIGEgc2lsZW50IHBob25lIGNhbiBiZSBkaWFnbm9zZWQuICovXG4gIHN0YXR1cygpOiB7IHN0YXRlOiBzdHJpbmc7IHVubG9ja2VkOiBib29sZWFuIH0geyByZXR1cm4geyBzdGF0ZTogdGhpcy5jdHggPyB0aGlzLmN0eC5zdGF0ZSA6ICdub3Qgc3RhcnRlZCcsIHVubG9ja2VkOiAhIXRoaXMuY3R4ICYmIHRoaXMuY3R4LnN0YXRlID09PSAncnVubmluZycgfTsgfVxuICAvKiogVGhlIFNldHRpbmdzIHBhZ2UncyBUZXN0IHNvdW5kIGJ1dHRvbjogdW5sb2NrIGFuZCBtYWtlIGEgY2xlYXJseSBhdWRpYmxlIHNvdW5kLiAqL1xuICB0ZXN0KCkgeyB0aGlzLnVubG9jaygpOyBjb25zdCB0ID0gKCkgPT4geyB0aGlzLnBsYXkoJ3ZpY3RvcnknKTsgfTsgaWYgKHRoaXMuY3R4ICYmIHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHRoaXMuY3R4LnJlc3VtZSgpLnRoZW4odCkuY2F0Y2goKCkgPT4ge30pOyBlbHNlIHQoKTsgfVxuXG4gIC8qKiBDYWxsIGZyb20gYSB1c2VyIGdlc3R1cmUgKHRhcC9jbGljaykuIFNhZmUgdG8gY2FsbCByZXBlYXRlZGx5LiAqL1xuICB1bmxvY2soKSB7XG4gICAgdGhpcy5wbGF5YmFja0NoYW5uZWwoKTtcbiAgICBpZiAoIXRoaXMuY3R4KSB7XG4gICAgICBjb25zdCBDID0gKHdpbmRvdyBhcyBhbnkpLkF1ZGlvQ29udGV4dCB8fCAod2luZG93IGFzIGFueSkud2Via2l0QXVkaW9Db250ZXh0OyBpZiAoIUMpIHJldHVybjtcbiAgICAgIGNvbnN0IGN0eDogQXVkaW9Db250ZXh0ID0gdGhpcy5jdHggPSBuZXcgQygpO1xuICAgICAgY29uc3QgY29tcCA9IGN0eC5jcmVhdGVEeW5hbWljc0NvbXByZXNzb3IoKTsgY29tcC5jb25uZWN0KGN0eC5kZXN0aW5hdGlvbik7XG4gICAgICB0aGlzLm1hc3RlciA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMubWFzdGVyLmdhaW4udmFsdWUgPSAwLjk7IHRoaXMubWFzdGVyLmNvbm5lY3QoY29tcCk7XG4gICAgICB0aGlzLm11c2ljQnVzID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tdXNpY0J1cy5jb25uZWN0KHRoaXMubWFzdGVyKTsgdGhpcy5zZnhCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLnNmeEJ1cy5jb25uZWN0KHRoaXMubWFzdGVyKTtcbiAgICAgIGN0eC5vbnN0YXRlY2hhbmdlID0gKCkgPT4geyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWF1ZGlvLXN0YXRlJykpOyB9O1xuICAgICAgY29uc3QgbGVuID0gY3R4LnNhbXBsZVJhdGU7IHRoaXMubm9pc2VCdWYgPSBjdHguY3JlYXRlQnVmZmVyKDEsIGxlbiwgY3R4LnNhbXBsZVJhdGUpOyBjb25zdCBkID0gdGhpcy5ub2lzZUJ1Zi5nZXRDaGFubmVsRGF0YSgwKTsgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW47IGkrKykgZFtpXSA9IE1hdGgucmFuZG9tKCkgKiAyIC0gMTtcbiAgICB9XG4gICAgaWYgKHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHRoaXMuY3R4LnJlc3VtZSgpLmNhdGNoKCgpID0+IHt9KTsgICAgICAgICAgICAgLy8gJ3N1c3BlbmRlZCcgb3IgKGlPUykgJ2ludGVycnVwdGVkJ1xuICAgIGlmICghdGhpcy5wcmltZWQpIHsgdGhpcy5wcmltZWQgPSB0cnVlOyB0cnkgeyBjb25zdCBiID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyKDEsIDEsIDIyMDUwKSwgcyA9IHRoaXMuY3R4LmNyZWF0ZUJ1ZmZlclNvdXJjZSgpOyBzLmJ1ZmZlciA9IGI7IHMuY29ubmVjdCh0aGlzLmN0eC5kZXN0aW5hdGlvbik7IHMuc3RhcnQoMCk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfSB9XG4gICAgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7XG4gIH1cblxuICBzZXRNdXNpYyhvbjogYm9vbGVhbikgeyB0aGlzLm11c2ljID0gb247IHVwZGF0ZVNldHRpbmdzKHsgbXVzaWM6IG9uIH0pOyB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zZXR0aW5ncycpKTsgfVxuICBzZXRTZngob246IGJvb2xlYW4pIHsgdGhpcy5zZnggPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBzZng6IG9uIH0pOyB0aGlzLmFwcGx5R2FpbnMoKTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zZXR0aW5ncycpKTsgaWYgKG9uKSB0aGlzLnBsYXkoJ3RhcCcpOyB9XG4gIC8qKiBSZS1yZWFkIHRoZSBzYXZlZCBzd2l0Y2hlcyAodGhlIHNoZWxsJ3MgU2V0dGluZ3MgcGFnZSBjaGFuZ2VzIHRoZW0gdG9vKS4gKi9cbiAgcmVsb2FkKCkgeyBjb25zdCBzID0gbG9hZFNhdmUoKS5zZXR0aW5nczsgdGhpcy5tdXNpYyA9IHMubXVzaWM7IHRoaXMuc2Z4ID0gcy5zZng7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB9XG4gIHNldE1vZGUobTogTW9kZSkgeyB0aGlzLm1vZGUgPSBtOyB9XG5cbiAgcHJpdmF0ZSBhcHBseUdhaW5zKCkge1xuICAgIGlmICghdGhpcy5jdHgpIHJldHVybjsgY29uc3QgdCA9IHRoaXMuY3R4LmN1cnJlbnRUaW1lO1xuICAgIHRoaXMubXVzaWNCdXMuZ2Fpbi5zZXRUYXJnZXRBdFRpbWUodGhpcy5tdXNpYyA/IDAuNSA6IDAsIHQsIDAuMTUpOyB0aGlzLnNmeEJ1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLnNmeCA/IDAuOCA6IDAsIHQsIDAuMDUpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIG11c2ljXG4gIHByaXZhdGUgc3luY011c2ljKCkge1xuICAgIGlmICghdGhpcy5jdHgpIHJldHVybjtcbiAgICBpZiAodGhpcy5tdXNpYyAmJiAhdGhpcy50aW1lcikgeyB0aGlzLm5leHRUID0gdGhpcy5jdHguY3VycmVudFRpbWUgKyAwLjE1OyB0aGlzLnRpbWVyID0gd2luZG93LnNldEludGVydmFsKCgpID0+IHRoaXMudGljaygpLCAyMDApOyB9XG4gICAgaWYgKCF0aGlzLm11c2ljICYmIHRoaXMudGltZXIpIHsgY2xlYXJJbnRlcnZhbCh0aGlzLnRpbWVyKTsgdGhpcy50aW1lciA9IDA7IH1cbiAgfVxuICBwcml2YXRlIHRpY2soKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghOyBpZiAoY3R4LnN0YXRlICE9PSAncnVubmluZycpIHsgdGhpcy5uZXh0VCA9IGN0eC5jdXJyZW50VGltZSArIDAuMTU7IHJldHVybjsgfVxuICAgIHdoaWxlICh0aGlzLm5leHRUIDwgY3R4LmN1cnJlbnRUaW1lICsgMC42KSB7IHRoaXMucGxheUJlYXQodGhpcy5iZWF0LCB0aGlzLm5leHRUKTsgdGhpcy5uZXh0VCArPSBCRUFUOyB0aGlzLmJlYXQgPSAodGhpcy5iZWF0ICsgMSkgJSAxNjsgfVxuICB9XG4gIHByaXZhdGUgcGxheUJlYXQoYmVhdDogbnVtYmVyLCB0OiBudW1iZXIpIHtcbiAgICBjb25zdCBjaG9yZCA9IENIT1JEU1tNYXRoLmZsb29yKGJlYXQgLyA0KV0sIGluQmFyID0gYmVhdCAlIDQsIGJhdHRsZSA9IHRoaXMubW9kZSA9PT0gJ2JhdHRsZSc7XG4gICAgaWYgKGluQmFyID09PSAwKSBmb3IgKGNvbnN0IGYgb2YgY2hvcmQpIHRoaXMudm9pY2UoZiwgJ3RyaWFuZ2xlJywgdCwgQkVBVCAqIDQgKyAwLjgsIDAuMDQ1LCAwLjksIDkwMCk7ICAgLy8gc2xvdyBwYWRcbiAgICBpZiAoaW5CYXIgPT09IDAgfHwgaW5CYXIgPT09IDIpIHRoaXMudm9pY2UoY2hvcmRbMF0sICdzaW5lJywgdCwgQkVBVCAqIDEuNiwgMC4xNiwgMC4wMiwgNDAwKTsgICAgICAgICAgLy8gYmFzc1xuICAgIGlmIChiYXR0bGUpIHtcbiAgICAgIHRoaXMua2ljayh0LCAwLjMyKTsgaWYgKGluQmFyID09PSAyKSB0aGlzLmtpY2sodCArIEJFQVQgKiAwLjUsIDAuMTgpO1xuICAgICAgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDAuNSwgMC4wNSwgMC4wNSwgJ2hpZ2hwYXNzJywgNzAwMCk7IHRoaXMubm9pc2UodCArIEJFQVQgKiAxLjUgJSBCRUFULCAwLjA1LCAwLjAzLCAnaGlnaHBhc3MnLCA3MDAwKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMjsgaSsrKSB0aGlzLnZvaWNlKGNob3JkWzEgKyAoKGJlYXQgKiAyICsgaSkgJSA0KV0gKiAyLCAndHJpYW5nbGUnLCB0ICsgaSAqIEJFQVQgLyAyLCAwLjIyLCAwLjA1LCAwLjAwNSwgMjUwMCk7ICAgLy8gcGx1Y2sgYXJwZWdnaW9cbiAgICB9XG4gIH1cbiAgcHJpdmF0ZSB2b2ljZShmcmVxOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCB0OiBudW1iZXIsIGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIGF0dGFjazogbnVtYmVyLCBscDogbnVtYmVyKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCBvID0gY3R4LmNyZWF0ZU9zY2lsbGF0b3IoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCksIGYgPSBjdHguY3JlYXRlQmlxdWFkRmlsdGVyKCk7XG4gICAgby50eXBlID0gdHlwZTsgby5mcmVxdWVuY3kudmFsdWUgPSBmcmVxOyBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKDAuMDAwMSwgdCk7IGcuZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZShnYWluLCB0ICsgTWF0aC5tYXgoMC4wMDUsIGF0dGFjaykpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG8uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5tdXNpY0J1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBraWNrKHQ6IG51bWJlciwgZ2FpbjogbnVtYmVyKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCBvID0gY3R4LmNyZWF0ZU9zY2lsbGF0b3IoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgby5mcmVxdWVuY3kuc2V0VmFsdWVBdFRpbWUoMTMwLCB0KTsgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSg0MiwgdCArIDAuMTQpOyBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoZ2FpbiwgdCk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIDAuMik7XG4gICAgby5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5tdXNpY0J1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgMC4yNSk7XG4gIH1cbiAgcHJpdmF0ZSBub2lzZSh0OiBudW1iZXIsIGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgYnVzOiBHYWluTm9kZSA9IHRoaXMubXVzaWNCdXMsIHN3ZWVwVG8/OiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG4gPSBjdHguY3JlYXRlQnVmZmVyU291cmNlKCksIGYgPSBjdHguY3JlYXRlQmlxdWFkRmlsdGVyKCksIGcgPSBjdHguY3JlYXRlR2FpbigpO1xuICAgIG4uYnVmZmVyID0gdGhpcy5ub2lzZUJ1ZjsgZi50eXBlID0gdHlwZTsgZi5mcmVxdWVuY3kuc2V0VmFsdWVBdFRpbWUoZnJlcSwgdCk7IGlmIChzd2VlcFRvKSBmLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKHN3ZWVwVG8sIHQgKyBkdXIpO1xuICAgIGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgZHVyKTtcbiAgICBuLmNvbm5lY3QoZik7IGYuY29ubmVjdChnKTsgZy5jb25uZWN0KGJ1cyk7IG4uc3RhcnQodCwgTWF0aC5yYW5kb20oKSAqIDAuNSk7IG4uc3RvcCh0ICsgZHVyICsgMC4wMik7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc291bmQgZWZmZWN0c1xuICBwcml2YXRlIHRvbmUoZnJlcTogbnVtYmVyLCBkdXI6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIGdhaW46IG51bWJlciwgZGVsYXkgPSAwLCBzbGlkZVRvPzogbnVtYmVyLCBhdHRhY2sgPSAwLjAwNSwgbHAgPSA4MDAwKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCB0ID0gY3R4LmN1cnJlbnRUaW1lICsgZGVsYXksIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHNsaWRlVG8pIG8uZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc2xpZGVUbywgdCArIGR1cik7XG4gICAgZi50eXBlID0gJ2xvd3Bhc3MnOyBmLmZyZXF1ZW5jeS52YWx1ZSA9IGxwOyBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBhdHRhY2spOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG8uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5zZnhCdXMpOyBvLnN0YXJ0KHQpOyBvLnN0b3AodCArIGR1ciArIDAuMDUpO1xuICB9XG4gIHByaXZhdGUgaGlzcyhkdXI6IG51bWJlciwgZ2FpbjogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmcmVxOiBudW1iZXIsIGRlbGF5ID0gMCwgc3dlZXBUbz86IG51bWJlcikgeyB0aGlzLm5vaXNlKHRoaXMuY3R4IS5jdXJyZW50VGltZSArIGRlbGF5LCBkdXIsIGdhaW4sIHR5cGUsIGZyZXEsIHRoaXMuc2Z4QnVzLCBzd2VlcFRvKTsgfVxuICBwcml2YXRlIHRocm90dGxlKGtleTogc3RyaW5nLCBtczogbnVtYmVyKSB7IGNvbnN0IG4gPSBwZXJmb3JtYW5jZS5ub3coKTsgaWYgKG4gLSAodGhpcy5zdGFtcHNba2V5XSB8fCAwKSA8IG1zKSByZXR1cm4gZmFsc2U7IHRoaXMuc3RhbXBzW2tleV0gPSBuOyByZXR1cm4gdHJ1ZTsgfVxuXG4gIC8qKiBBIFNvdWwncyB2b2ljZSwgc3ludGhlc2l6ZWQ6IHNrZWxldG9uIHJhdHRsZSwgYXJjaGVyIHdoaXN0bGUsIGdvYmxpbiBjYWNrbGUsIGtuaWdodCBncnVudCwgb2dyZSBncm93bCwgYmFyYmFyaWFuIHJvYXIuIGBrYCBzaGlmdHMgdGhlIHBpdGNoIChlbmVtaWVzIGEgbGl0dGxlIGxvd2VyKSwgYGRlbGF5YCBzdGFnZ2VycyBhIGNob3J1cy4gKi9cbiAgYmFyayhzb3VsOiBzdHJpbmcsIGRlbGF5ID0gMCwgayA9IDEpIHtcbiAgICBpZiAoIXRoaXMuY3R4IHx8ICF0aGlzLnNmeCB8fCB0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnIHx8ICF0aGlzLnRocm90dGxlKCdiYXJrJyArIHNvdWwsIDM1MCkpIHJldHVybjtcbiAgICBjb25zdCBUID0gKGY6IG51bWJlciwgZDogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZzogbnVtYmVyLCBkbDogbnVtYmVyLCBzbGlkZT86IG51bWJlciwgYXR0PzogbnVtYmVyLCBscD86IG51bWJlcikgPT4gdGhpcy50b25lKGYgKiBrLCBkLCB0eXBlLCBnLCBkZWxheSArIGRsLCBzbGlkZSA/IHNsaWRlICogayA6IHVuZGVmaW5lZCwgYXR0LCBscCk7XG4gICAgY29uc3QgSCA9IChkOiBudW1iZXIsIGc6IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZjogbnVtYmVyLCBkbDogbnVtYmVyLCBzdz86IG51bWJlcikgPT4gdGhpcy5oaXNzKGQsIGcsIHR5cGUsIGYsIGRlbGF5ICsgZGwsIHN3KTtcbiAgICBzd2l0Y2ggKHNvdWwpIHtcbiAgICAgIGNhc2UgJ3dhcnJpb3InOiBbMCwgMC4wNiwgMC4xMiwgMC4xOV0uZm9yRWFjaCgoZGwpID0+IEgoMC4wMywgMC4xNiwgJ2hpZ2hwYXNzJywgMzUwMCwgZGwpKTsgVCg1MjAsIDAuMjIsICdzcXVhcmUnLCAwLjA3LCAwLCAyODAsIDAuMDA1LCAxODAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdhcmNoZXInOiBUKDkwMCwgMC4xNiwgJ3NpbmUnLCAwLjEzLCAwLCAxMzUwLCAwLjAxKTsgVCgxMzUwLCAwLjIyLCAnc2luZScsIDAuMTEsIDAuMTYsIDc2MCwgMC4wMSk7IGJyZWFrO1xuICAgICAgY2FzZSAnZ29ibGluJzogWzAsIDAuMTEsIDAuMjJdLmZvckVhY2goKGRsLCBpKSA9PiBUKDUwMCArIGkgKiA3MCwgMC4xLCAnc2F3dG9vdGgnLCAwLjA5LCBkbCwgNjIwICsgaSAqIDcwLCAwLjAwNSwgMjYwMCkpOyBIKDAuMywgMC4wNSwgJ2JhbmRwYXNzJywgMjIwMCwgMCk7IGJyZWFrO1xuICAgICAgY2FzZSAna25pZ2h0JzogVCgxNTAsIDAuMzIsICdzYXd0b290aCcsIDAuMTIsIDAsIDEwNSwgMC4wMiwgOTAwKTsgVCgyMjUsIDAuMywgJ3NxdWFyZScsIDAuMDUsIDAuMDIsIDE2MCwgMC4wMiwgOTAwKTsgSCgwLjA4LCAwLjEyLCAnaGlnaHBhc3MnLCA0NTAwLCAwLjEpOyBicmVhaztcbiAgICAgIGNhc2UgJ29ncmUnOiBUKDc1LCAwLjc1LCAnc2F3dG9vdGgnLCAwLjIsIDAsIDUyLCAwLjA1LCAzMjApOyBUKDExMiwgMC43LCAnc2F3dG9vdGgnLCAwLjA4LCAwLjAzLCA4MCwgMC4wNSwgNDIwKTsgSCgwLjYsIDAuMTIsICdsb3dwYXNzJywgNDIwLCAwLjAyLCAxNDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2JhcmJhcmlhbic6IFQoMTcwLCAwLjUsICdzYXd0b290aCcsIDAuMTQsIDAsIDM0MCwgMC4wMywgMTQwMCk7IFQoMzQwLCAwLjQ1LCAnc2F3dG9vdGgnLCAwLjA4LCAwLjEsIDIxMCwgMC4wMywgMTYwMCk7IEgoMC40NSwgMC4xLCAnYmFuZHBhc3MnLCA5MDAsIDAsIDUwMCk7IGJyZWFrO1xuICAgIH1cbiAgfVxuICBwbGF5KG5hbWU6IFNmeCkge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuc2Z4IHx8IHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHJldHVybjtcbiAgICBzd2l0Y2ggKG5hbWUpIHtcbiAgICAgIGNhc2UgJ3RhcCc6IGlmICghdGhpcy50aHJvdHRsZSgndGFwJywgNDApKSByZXR1cm47IHRoaXMudG9uZSg3NjAsIDAuMDYsICdzaW5lJywgMC4yMiwgMCwgMTEwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc3VtbW9uJzogdGhpcy5oaXNzKDAuNCwgMC4xNCwgJ2JhbmRwYXNzJywgNTAwLCAwLCAyNTAwKTsgdGhpcy50b25lKDIyMCwgMC40LCAnc2F3dG9vdGgnLCAwLjEsIDAsIDY2MCwgMC4wNSwgMTgwMCk7IHRoaXMudG9uZSgxMzIwLCAwLjIsICdzaW5lJywgMC4xLCAwLjE4KTsgYnJlYWs7XG4gICAgICBjYXNlICdtZXJnZSc6IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC4zNSwgJ3RyaWFuZ2xlJywgMC4yLCBpICogMC4wNykpOyB0aGlzLmhpc3MoMC41LCAwLjA4LCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMTEwLCAwLjMsICdzaW5lJywgMC4zNSwgMCwgNTApOyB0aGlzLnRvbmUoMTU2OCwgMC41LCAnc2luZScsIDAuMDgsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0JzogaWYgKCF0aGlzLnRocm90dGxlKCdoaXQnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDcsIDAuMjQsICdsb3dwYXNzJywgMTgwMCk7IHRoaXMudG9uZSgxNzAsIDAuMDksICdzaW5lJywgMC4yMiwgMCwgODApOyBicmVhaztcbiAgICAgIGNhc2UgJ2hpdEFycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdoaXRBJywgNDUpKSByZXR1cm47IHRoaXMuaGlzcygwLjA1LCAwLjE0LCAnYmFuZHBhc3MnLCAzMDAwKTsgdGhpcy50b25lKDcwMCwgMC4wNiwgJ3RyaWFuZ2xlJywgMC4wNiwgMCwgNDAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzbWFzaCc6IHRoaXMudG9uZSg5NSwgMC4zOCwgJ3NpbmUnLCAwLjUsIDAsIDM0KTsgdGhpcy5oaXNzKDAuMzIsIDAuMzUsICdsb3dwYXNzJywgMTAwMCwgMCwgMjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdhcnJvdyc6IGlmICghdGhpcy50aHJvdHRsZSgnYXJyb3cnLCA2MCkpIHJldHVybjsgdGhpcy5oaXNzKDAuMTQsIDAuMSwgJ2JhbmRwYXNzJywgMTgwMCwgMCwgNDIwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVhdGgnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2RlYXRoJywgNzApKSByZXR1cm47IHRoaXMudG9uZSgzMDAsIDAuNCwgJ3Nhd3Rvb3RoJywgMC4xNCwgMCwgNzAsIDAuMDEsIDkwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnY2FzdCc6IHRoaXMudG9uZSgzMDAsIDAuNDUsICdzaW5lJywgMC4xOCwgMCwgOTAwLCAwLjA1KTsgdGhpcy50b25lKDQ1MCwgMC40NSwgJ3NpbmUnLCAwLjEsIDAuMDUsIDEzNTAsIDAuMDUpOyB0aGlzLnRvbmUoMTgwMCwgMC4yNSwgJ3NpbmUnLCAwLjA1LCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3RhdW50JzogdGhpcy50b25lKDE5NiwgMC41LCAnc3F1YXJlJywgMC4wOCwgMCwgMTgwLCAwLjAzLCA3MDApOyB0aGlzLnRvbmUoMTQ3LCAwLjUsICdzYXd0b290aCcsIDAuMDgsIDAuMDIsIDE0MCwgMC4wMywgNjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzaG9ja3dhdmUnOiB0aGlzLnRvbmUoMjIwLCAxLjEsICdzaW5lJywgMC41LCAwLCAyOCwgMC4wMik7IHRoaXMuaGlzcygxLjAsIDAuMzUsICdsb3dwYXNzJywgMzAwMCwgMCwgMTUwKTsgdGhpcy50b25lKDg4MCwgMC44LCAnc2luZScsIDAuMDgsIDAsIDIyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncmVzdXJyZWN0JzogWzIyMCwgMjc3LCAzMzAsIDQ0MCwgNTU0XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMS4xLCAndHJpYW5nbGUnLCAwLjEsIGkgKiAwLjEyLCBmICogMS4xMiwgMC4zKSk7IHRoaXMuaGlzcygwLjksIDAuMDYsICdoaWdocGFzcycsIDQ1MDAsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnaGVhcnRMb3N0JzogdGhpcy50b25lKDExMCwgMC43LCAnc2F3dG9vdGgnLCAwLjI4LCAwLCA1MCwgMC4wMSwgNDUwKTsgdGhpcy5oaXNzKDAuMTgsIDAuMiwgJ2xvd3Bhc3MnLCA5MDApOyB0aGlzLnRvbmUoMjMzLCAwLjUsICdzcXVhcmUnLCAwLjA1LCAwLjAyLCAyMjAsIDAuMDEsIDUwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAndmljdG9yeSc6IFszOTIsIDQ5NCwgNTg3LCA3ODRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjUsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjExKSk7IHRoaXMudG9uZSgxOTYsIDAuOSwgJ3NpbmUnLCAwLjIpOyBicmVhaztcbiAgICAgIGNhc2UgJ2RlZmVhdCc6IFszMzAsIDI5NCwgMjQ3LCAxOTZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjcsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjI4LCBmICogMC45NykpOyB0aGlzLnRvbmUoODIsIDEuNiwgJ3NpbmUnLCAwLjMsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndW5sb2NrJzogWzAuMzUsIDAuNDcsIDAuNTksIDAuNzFdLmZvckVhY2goKGQsIGkpID0+IHsgdGhpcy5oaXNzKDAuMDUsIDAuMjIsICdiYW5kcGFzcycsIDkwMCArIGkgKiAxMjAsIGQpOyB0aGlzLnRvbmUoMTcwICsgaSAqIDEyLCAwLjA3LCAnc3F1YXJlJywgMC4wNiwgZCwgdW5kZWZpbmVkLCAwLjAwMiwgNjAwKTsgfSk7IFs3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjYsICd0cmlhbmdsZScsIDAuMTYsIDEuMTUgKyBpICogMC4wNykpOyB0aGlzLmhpc3MoMC41LCAwLjA5LCAnaGlnaHBhc3MnLCA1MDAwLCAxLjIpOyB0aGlzLnRvbmUoMTEwLCAwLjMsICdzaW5lJywgMC4yNSwgMS4xNSwgNjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tDaGFyZ2UnOiB0aGlzLnRvbmUoOTAsIDEuMDUsICdzaW5lJywgMC4yNSwgMCwgMjYwLCAwLjIpOyB0aGlzLmhpc3MoMC45NSwgMC4xMiwgJ2xvd3Bhc3MnLCAzMDAsIDAsIDIyMDApOyB0aGlzLnRvbmUoMTgwLCAxLjAsICd0cmlhbmdsZScsIDAuMDYsIDAuMSwgNTIwLCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUaWVyVXAnOiBbNDQwLCA1NTQsIDY1OSwgODgwXS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA2KSk7IHRoaXMudG9uZSgxNzYwLCAwLjYsICdzaW5lJywgMC4wOSwgMC4yKTsgdGhpcy5oaXNzKDAuNCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUZWFyJzogdGhpcy5oaXNzKDAuMzUsIDAuMywgJ2JhbmRwYXNzJywgMTUwMCwgMCwgNjAwMCk7IHRoaXMudG9uZSgxMjAsIDAuNDUsICdzaW5lJywgMC40LCAwLjA1LCA0MCk7IFsxMDQ2LCAxMzE4LCAxNTY4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC42LCAndHJpYW5nbGUnLCAwLjEsIDAuMTIgKyBpICogMC4wNSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tGYW4nOiB0aGlzLmhpc3MoMC41LCAwLjEsICdoaWdocGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNjYwLCAwLjQ1LCAnc2luZScsIDAuMSwgMCwgMTMyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0ZsaXAnOiB0aGlzLmhpc3MoMC4wOCwgMC4xNSwgJ2JhbmRwYXNzJywgMjUwMCk7IHRoaXMudG9uZSg1MDAsIDAuMTIsICdzaW5lJywgMC4xNCwgMCwgODAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrUmFyZSc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzc4NCwgOTg4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40NSwgJ3RyaWFuZ2xlJywgMC4xNCwgMC4wNSArIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0VwaWMnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC43LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wNykpOyB0aGlzLnRvbmUoMTEwLCAwLjUsICdzaW5lJywgMC4zLCAwLCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0xlZ2VuZCc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA4KSk7IHRoaXMudG9uZSg4MiwgMC45LCAnc2luZScsIDAuMzUsIDAsIDUwKTsgdGhpcy5oaXNzKDAuOCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMjA5MywgMC43LCAnc2luZScsIDAuMDcsIDAuNCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NvbGxlY3QnOiBbNjU5LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wOSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3N0YXJ0JzogdGhpcy50b25lKDE0NywgMC45LCAnc2F3dG9vdGgnLCAwLjEzLCAwLCAxNTAsIDAuMTUsIDY1MCk7IHRoaXMudG9uZSgyMjAsIDAuOSwgJ3Nhd3Rvb3RoJywgMC4wOSwgMC4wNSwgMjI0LCAwLjE1LCA2NTApOyB0aGlzLmhpc3MoMC42LCAwLjA2LCAnbG93cGFzcycsIDYwMCk7IGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYXVkaW8gPSBuZXcgQXVkaW9FbmdpbmUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2F1ZGlvID0gYXVkaW87XG5cbi8vIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdG91Y2g6IHRoZSBmaXJzdCB0YXAgYW55d2hlcmUgdW5sb2NrcyBpdC4gRXZlcnkgYnV0dG9uIGFsc28gZ2V0cyBhIHNtYWxsIGNsaWNrLlxuLy8gaU9TIG9ubHkgYWNjZXB0cyBhbiB1bmxvY2sgZnJvbSBhIEZJTklTSEVEIHRhcCAodG91Y2hlbmQgLyBjbGljayksIG5vdCBmcm9tIHRoZSBzdGFydCBvZiBvbmUsIHNvIGxpc3RlbiB0byBhbGwgb2YgdGhlbS5cbmNvbnN0IHVubG9ja09uY2UgPSAoKSA9PiBhdWRpby51bmxvY2soKTtcbmZvciAoY29uc3QgZXYgb2YgWydwb2ludGVyZG93bicsICdwb2ludGVydXAnLCAndG91Y2hlbmQnLCAnY2xpY2snLCAna2V5ZG93biddKSBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKGV2LCB1bmxvY2tPbmNlLCB7IGNhcHR1cmU6IHRydWUgfSk7XG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGNvbnN0IGVsID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsOyBpZiAoZWwgJiYgZWwuY2xvc2VzdCAmJiBlbC5jbG9zZXN0KCdidXR0b24sIGEuYnRuLCAucmFpbCBhJykpIGF1ZGlvLnBsYXkoJ3RhcCcpOyB9LCB0cnVlKTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Zpc2liaWxpdHljaGFuZ2UnLCAoKSA9PiB7IGNvbnN0IGMgPSAoYXVkaW8gYXMgYW55KS5jdHggYXMgQXVkaW9Db250ZXh0IHwgbnVsbDsgaWYgKCFjKSByZXR1cm47IGlmIChkb2N1bWVudC5oaWRkZW4pIGMuc3VzcGVuZCgpOyBlbHNlIGlmIChhdWRpby5tdXNpYyB8fCBhdWRpby5zZngpIGMucmVzdW1lKCk7IH0pO1xud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzLWNoYW5nZWQnLCAoKSA9PiBhdWRpby5yZWxvYWQoKSk7XG4iLCAiLy8gU2F2aW5nIGEgcnVuIGluIHByb2dyZXNzIHNvIGl0IHN1cnZpdmVzIGEgcGFnZSByZWxvYWQgKFNhZmFyaSBvbiBhIHBob25lIGNhbiBkcm9wIHRoZSBwYWdlIGF0IGFueSB0aW1lKS5cbi8vIE9ubHkgY2FsbSBtb21lbnRzIGFyZSBzYXZlZDogdGhlIGJ1aWxkIHBoYXNlIGFuZCB0aGUgdmljdG9yeSBkcmFmdC4gQSBiYXR0bGUgaW4gcHJvZ3Jlc3MgaXMgbm90IHNhdmVkOyByZWxvYWRpbmcgZHVyaW5nIG9uZSBwdXRzIHlvdSBiYWNrXG4vLyBhdCB0aGUgYnVpbGQgc2NyZWVuIHlvdSBwcmVzc2VkIEJhdHRsZSBmcm9tIChub3RoaW5nIGxvc3QsIG5vdGhpbmcgZ2FpbmVkKS4gRXZlcnl0aGluZyByZWFkIGJhY2sgaXMgdmFsaWRhdGVkOyBhbnl0aGluZyBvZGQgaXMgaWdub3JlZC5cblxuaW1wb3J0IHsgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlLCBVbml0IH0gZnJvbSAnLi9ydWxlcy50cyc7XG5pbXBvcnQgeyBicm93c2VyU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5cbmNvbnN0IEtFWSA9ICduZWNyby1ydW4nO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VyaWFsaXplZFN0YXRlIHtcbiAgcnVsZXM6IFJ1bGVzOyBybmc6IHsgc2VlZDogbnVtYmVyOyBwb3M6IG51bWJlciB9O1xuICB3YXZlOiBudW1iZXI7IGhlYXJ0czogbnVtYmVyOyBjYXA6IG51bWJlcjsgaGFuZDogU291bElkW107IHVuaXRzOiBVbml0W107IG5leHRJZDogbnVtYmVyOyBkaXNjYXJkVXNlZDogYm9vbGVhbjtcbiAgc3RhdHVzOiAnYnVpbGRpbmcnOyBsb2c6IHN0cmluZ1tdOyBzdGF0czogU3RhdGVbJ3N0YXRzJ107XG59XG5leHBvcnQgaW50ZXJmYWNlIFJ1blNuYXBzaG90IHsgdjogbnVtYmVyOyBzZWVkOiBudW1iZXI7IGF0dGVtcHQ6IG51bWJlcjsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogc3RyaW5nOyBwaGFzZTogJ2J1aWxkJyB8ICdkcmFmdCc7IGRyYWZ0OiBTb3VsSWRbXSB8IG51bGw7IHN0YXRlOiBTZXJpYWxpemVkU3RhdGU7IHN0YXJ0QmVzdD86IG51bWJlciB9XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXJpYWxpemVTdGF0ZShzOiBTdGF0ZSk6IFNlcmlhbGl6ZWRTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgcnVsZXM6IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocy5ydWxlcykpLCBybmc6IHsgc2VlZDogcy5ybmcuc2VlZCwgcG9zOiBzLnJuZy5zdGF0ZSgpIH0sXG4gICAgd2F2ZTogcy53YXZlLCBoZWFydHM6IHMuaGVhcnRzLCBjYXA6IHMuY2FwLCBoYW5kOiBzLmhhbmQuc2xpY2UoKSwgdW5pdHM6IHMudW5pdHMubWFwKCh1KSA9PiAoeyAuLi51IH0pKSwgbmV4dElkOiBzLm5leHRJZCwgZGlzY2FyZFVzZWQ6IHMuZGlzY2FyZFVzZWQsXG4gICAgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IHMubG9nLnNsaWNlKC00MCksIHN0YXRzOiB7IC4uLnMuc3RhdHMgfSxcbiAgfTtcbn1cblxuY29uc3QgaXNTb3VsID0gKHg6IGFueSk6IHggaXMgU291bElkID0+IFNPVUxTLmluY2x1ZGVzKHgpO1xuY29uc3QgaW50ID0gKHg6IGFueSwgbG86IG51bWJlciwgaGk6IG51bWJlcikgPT4gTnVtYmVyLmlzSW50ZWdlcih4KSAmJiB4ID49IGxvICYmIHggPD0gaGk7XG5cbi8qKiBSZWJ1aWxkIGEgU3RhdGUgZnJvbSBzYXZlZCBkYXRhLCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IGl0IGlzIG5vdCBiZWxpZXZhYmxlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplU3RhdGUoeDogYW55KTogU3RhdGUgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBpZiAoIXggfHwgdHlwZW9mIHggIT09ICdvYmplY3QnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCByID0geC5ydWxlcztcbiAgICBpZiAoIXIgfHwgIUFycmF5LmlzQXJyYXkoci5jdXJ2ZSkgfHwgIXIuY3VydmUubGVuZ3RoIHx8ICFyLmN1cnZlLmV2ZXJ5KChuOiBhbnkpID0+IE51bWJlci5pc0Zpbml0ZShuKSAmJiBuID4gMCkpIHJldHVybiBudWxsO1xuICAgIGlmIChyLm1lcmdlICE9PSAnZGVwbG95ZWRPbmx5JyAmJiByLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIucG9vbCAhPT0gdW5kZWZpbmVkICYmICEoQXJyYXkuaXNBcnJheShyLnBvb2wpICYmIHIucG9vbC5sZW5ndGggJiYgci5wb29sLmV2ZXJ5KGlzU291bCkpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGFnZVdhdmVzID0gci5zdGFnZVdhdmVzID8/IHIuY3VydmUubGVuZ3RoO1xuICAgIGlmICghaW50KHgud2F2ZSwgMSwgTWF0aC5taW4oc3RhZ2VXYXZlcywgci5jdXJ2ZS5sZW5ndGgpKSB8fCAhaW50KHguaGVhcnRzLCAxLCBIRUFSVFMpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5jYXApIHx8IHguY2FwIDw9IDApIHJldHVybiBudWxsO1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh4LmhhbmQpIHx8IHguaGFuZC5sZW5ndGggPiA0MCB8fCAheC5oYW5kLmV2ZXJ5KGlzU291bCkpIHJldHVybiBudWxsO1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh4LnVuaXRzKSB8fCB4LnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIHJldHVybiBudWxsO1xuICAgIGlmICghaW50KHgubmV4dElkLCAxLCAxZTYpIHx8IHR5cGVvZiB4LmRpc2NhcmRVc2VkICE9PSAnYm9vbGVhbicpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNlbGxzID0gbmV3IFNldDxudW1iZXI+KCksIGlkcyA9IG5ldyBTZXQ8bnVtYmVyPigpLCB1bml0czogVW5pdFtdID0gW107XG4gICAgZm9yIChjb25zdCB1IG9mIHgudW5pdHMpIHtcbiAgICAgIGlmICghdSB8fCAhaXNTb3VsKHUuc291bCkgfHwgIWludCh1LnN0YXIsIDEsIE1BWF9TVEFSKSB8fCAhaW50KHUuY2VsbCwgMCwgR1JJRF9DRUxMUyAtIDEpIHx8ICFpbnQodS5pZCwgMSwgeC5uZXh0SWQpIHx8IGNlbGxzLmhhcyh1LmNlbGwpIHx8IGlkcy5oYXModS5pZCkpIHJldHVybiBudWxsO1xuICAgICAgY2VsbHMuYWRkKHUuY2VsbCk7IGlkcy5hZGQodS5pZCk7IHVuaXRzLnB1c2goeyBpZDogdS5pZCwgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCwgZnJlc2g6ICEhdS5mcmVzaCB9KTtcbiAgICB9XG4gICAgY29uc3Qgc3QgPSB4LnN0YXRzO1xuICAgIGlmICghc3QgfHwgIVsnZHJhd24nLCAnZGlzY2FyZGVkJywgJ2Rpc21pc3NlZCcsICdtZXJnZXMnLCAnZmFpbHVyZXMnXS5ldmVyeSgoaykgPT4gTnVtYmVyLmlzRmluaXRlKHN0W2tdKSkpIHJldHVybiBudWxsO1xuICAgIGlmICgheC5ybmcgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnJuZy5zZWVkKSB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnBvcykpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICBydWxlczogciBhcyBSdWxlcywgcm5nOiBtYWtlUm5nKHgucm5nLnNlZWQsIHgucm5nLnBvcyksIHdhdmU6IHgud2F2ZSwgaGVhcnRzOiB4LmhlYXJ0cywgY2FwOiB4LmNhcCwgaGFuZDogeC5oYW5kLnNsaWNlKCksIHVuaXRzLCBuZXh0SWQ6IHgubmV4dElkLFxuICAgICAgZGlzY2FyZFVzZWQ6IHguZGlzY2FyZFVzZWQsIHN0YXR1czogJ2J1aWxkaW5nJywgbG9nOiBBcnJheS5pc0FycmF5KHgubG9nKSA/IHgubG9nLmZpbHRlcigobDogYW55KSA9PiB0eXBlb2YgbCA9PT0gJ3N0cmluZycpLnNsaWNlKC00MCkgOiBbXSxcbiAgICAgIHN0YXRzOiB7IGRyYXduOiBzdC5kcmF3biwgZGlzY2FyZGVkOiBzdC5kaXNjYXJkZWQsIGRpc21pc3NlZDogc3QuZGlzbWlzc2VkLCBtZXJnZXM6IHN0Lm1lcmdlcywgZmFpbHVyZXM6IHN0LmZhaWx1cmVzIH0sXG4gICAgfTtcbiAgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYXZlUnVuKHNuYXA6IFJ1blNuYXBzaG90LCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlKSBzdG9yZS5zZXRJdGVtKEtFWSwgSlNPTi5zdHJpbmdpZnkoc25hcCkpOyB9IGNhdGNoIHsgLyogc3RvcmFnZSBmdWxsIG9yIGJsb2NrZWQ6IHRoZSBydW4ganVzdCB3aWxsIG5vdCBzdXJ2aXZlIGEgcmVsb2FkICovIH1cbn1cbmV4cG9ydCBmdW5jdGlvbiBjbGVhclJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlICYmIChzdG9yZSBhcyBhbnkpLnJlbW92ZUl0ZW0pIChzdG9yZSBhcyBhbnkpLnJlbW92ZUl0ZW0oS0VZKTsgZWxzZSBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCAnJyk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRSdW4oc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogeyBzbmFwOiBSdW5TbmFwc2hvdDsgc3RhdGU6IFN0YXRlIH0gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB0ID0gc3RvcmUgJiYgc3RvcmUuZ2V0SXRlbShLRVkpOyBpZiAoIXQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHggPSBKU09OLnBhcnNlKHQpO1xuICAgIGlmICgheCB8fCB4LnYgIT09IFZFUlNJT04gfHwgKHgucGhhc2UgIT09ICdidWlsZCcgJiYgeC5waGFzZSAhPT0gJ2RyYWZ0JykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5hdHRlbXB0KSB8fCB0eXBlb2YgeC5kaWZmaWN1bHR5ICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgc3RhdGUgPSBkZXNlcmlhbGl6ZVN0YXRlKHguc3RhdGUpOyBpZiAoIXN0YXRlKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBkcmFmdCA9IHgucGhhc2UgPT09ICdkcmFmdCcgJiYgQXJyYXkuaXNBcnJheSh4LmRyYWZ0KSAmJiB4LmRyYWZ0Lmxlbmd0aCA9PT0gMyAmJiB4LmRyYWZ0LmV2ZXJ5KGlzU291bCkgPyB4LmRyYWZ0IDogbnVsbDtcbiAgICByZXR1cm4geyBzbmFwOiB7IHY6IFZFUlNJT04sIHNlZWQ6IHguc2VlZCwgYXR0ZW1wdDogeC5hdHRlbXB0LCBzdGFnZTogdHlwZW9mIHguc3RhZ2UgPT09ICdzdHJpbmcnID8geC5zdGFnZSA6ICdjcnlwdCcsIGRpZmZpY3VsdHk6IHguZGlmZmljdWx0eSwgcGhhc2U6IGRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCcsIGRyYWZ0LCBzdGF0ZTogeC5zdGF0ZSwgc3RhcnRCZXN0OiBOdW1iZXIuaXNJbnRlZ2VyKHguc3RhcnRCZXN0KSAmJiB4LnN0YXJ0QmVzdCA+PSAwICYmIHguc3RhcnRCZXN0IDw9IDk5OTkgPyB4LnN0YXJ0QmVzdCA6IHVuZGVmaW5lZCB9LCBzdGF0ZSB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cbmV4cG9ydCBjb25zdCBSVU5fVkVSU0lPTiA9IFZFUlNJT047XG4iLCAiLy8gRXZlcnl0aGluZyB5b3UgU0VFIGZvciBhIHVuaXQ6IHJlYWwgVHJpcG8gbW9kZWxzIChTa2VsZXRvbiBXYXJyaW9yLCBTa2VsZXRvbiBBcmNoZXIpLCBzaW1wbGUgc3RhbmQtaW5zIGZvciB0aGUgZm91clxuLy8gY2hhcmFjdGVycyB0aGF0IGFyZSBub3QgZ2VuZXJhdGVkIHlldCwgYW5kIHRoZSBcInN0YXIgbG9va1wiIGxheWVyZWQgb24gdG9wIG9mIGJvdGggKHNpemUsIHRpbnQsIGF1cmEsIGhhbG8sIGJhZGdlKS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuXG5leHBvcnQgdHlwZSBWU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYXRoJyB8ICdzcGF3bicgfCAnY2hlZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb24gKyB5YXcgaGVyZVxuICB0ZWFtOiAwIHwgMTsgc3RhcjogbnVtYmVyOyBzdGF0ZTogVlN0YXRlOyB0b3A6IG51bWJlcjtcbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZD86IG51bWJlcik6IHZvaWQ7XG4gIHNldFN0YXIoc3RhcjogbnVtYmVyKTogdm9pZDtcbiAgY2xpcE5hbWVzPygpOiBzdHJpbmdbXTsgICAgICAgICAgICAvLyB0aGUgYW5pbWF0aW9ucyB0aGlzIHVuaXQgaGFzIChmb3IgdGhlIGluc3BlY3QgdmlldylcbiAgcHJldmlld0NsaXA/KG5hbWU6IHN0cmluZyk6IHZvaWQ7ICAvLyBwbGF5IG9uZSBvZiB0aGVtIG9uY2UsIHRoZW4gZ28gYmFjayB0byBpZGxlXG4gIHNldEJvc3M/KG9uOiBib29sZWFuKTogdm9pZDsgICAgICAgLy8gYW4gZW5lbXkgYm9zczogYmlnZ2VyLCB3aXRoIGEgQk9TUyB0YWdcbiAgc2V0TGV2ZWw/KGxldmVsOiBudW1iZXIpOiB2b2lkOyAgICAvLyB0aGUgcGVybWFuZW50IFNvdWwgbGV2ZWwgc2hvd24gYmVzaWRlIHRoZSBoZWFsdGggYmFyIChwbGF5ZXIgdW5pdHMgb25seSlcbiAgc2V0VGVhbSh0ZWFtOiAwIHwgMSk6IHZvaWQ7XG4gIHNldEhwKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAgLy8gbnVsbCBoaWRlcyB0aGUgaGVhbHRoIGJhclxuICBzZXRNYW5hKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAvLyBudWxsIGhpZGVzIHRoZSBtYW5hIGJhciAodW5pdHMgd2l0aG91dCBhIHNraWxsKVxuICBwdWxzZSgpOiB2b2lkOyAgICAgICAgICAgICAgICAgICAgIC8vIGJyaWVmIGhpdCByZWFjdGlvblxuICB1cGRhdGUoZHQ6IG51bWJlcik6IHZvaWQ7XG4gIGRpc3Bvc2UoKTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFyIGxvb2tzXG4vLyAxIHN0YXIgPSB0aGUgcGxhaW4gbW9kZWwuIDIgc3RhcnMgPSBhIGxpdHRsZSBiaWdnZXIsIGNvb2wgc2lsdmVyLWJsdWUgdGludCwgYnJpZ2h0ZXIgYXVyYS4gMyBzdGFycyA9IGJpZ2dlc3QsIHdhcm0gZ29sZCB0aW50LFxuLy8gc3Ryb25nIGdvbGQtdmlvbGV0IGF1cmEgYW5kIGEgZmxvYXRpbmcgZ29sZCBoYWxvLiBFdmVyeXRoaW5nIGhlcmUgaXMgZnJlZTogbm8gZXh0cmEgVHJpcG8gZ2VuZXJhdGlvbnMuXG5jb25zdCBUSU5UOiBudW1iZXJbXVtdID0gW1sxLCAxLCAxXSwgWzAuODYsIDAuOTUsIDEuMThdLCBbMS4yNSwgMS4xLCAwLjddXTtcbmNvbnN0IEFVUkEgPSBbXG4gIHsgcmF0ZTogMTQsIG1pbjogMC4wNiwgbWF4OiAwLjE2LCBjMTogWzAuNzgsIDAuMzUsIDEsIDAuN10sIGMyOiBbMC40NSwgMC4xNSwgMC45LCAwLjVdIH0sXG4gIHsgcmF0ZTogMjYsIG1pbjogMC4wOCwgbWF4OiAwLjIwLCBjMTogWzAuODUsIDAuNjUsIDEsIDAuOF0sIGMyOiBbMC41NSwgMC40LCAxLCAwLjZdIH0sXG4gIHsgcmF0ZTogNDQsIG1pbjogMC4xMCwgbWF4OiAwLjI2LCBjMTogWzEsIDAuODUsIDAuNCwgMC44NV0sIGMyOiBbMC44LCAwLjMsIDEsIDAuN10gfSxcbl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRzIHtcbiAgc2NlbmU6IGFueTsgc29mdDogYW55OyBsdlRleDogUmVjb3JkPG51bWJlciwgYW55Pjsgc3RhclRleDogYW55W107IHRyaXBvOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIFRyaXBvQ2ZnPj47IGVtb3RlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICByaW5nTWF0OiBhbnlbXTsgaGFsb01hdDogYW55OyBiYXJCZzogYW55OyBiYXJGaWxsOiBhbnlbXTsgbWFuYUZpbGw6IGFueTsgYXJyb3c/OiBhbnk7IG5lY3JvPzogYW55O1xufVxuLyoqIEZsYXZvdXIgYSB1bml0IGNhbiBoYXZlOiBhIGNsaXAgaXQgcGxheXMgbm93IGFuZCB0aGVuIHdoZW4gaXQgaGFzIHN0b29kIGlkbGUgZm9yIGEgd2hpbGUsIGEgc21hbGwgZW1vdGUsIGFuZCBhbiBleWUtZ2xvdyBtYXNrIChleWVzIGRpbSB3aGVuIHNsZWVweSwgZmxhcmUgd2hlbiBpdCBmaWdodHMpLiAqL1xuLyoqIElkbGUgY2xpcHMgd2hlcmUgdGhlIHVuaXQgbWFrZXMgYSBub2lzZS4gKi9cbmNvbnN0IFZPQ0FMID0gbmV3IFNldChbJ1JvYXInLCAnVGh1bXAnLCAnU3RvbXAnLCAnU25pY2tlcicsICdTY2hlbWUnLCAnQm9hc3QnLCAnRmxleCcsICdEb3VibGVCaWNlcHMnLCAnRnVtYmxlJywgJ1NoaWVsZEJvbmsnLCAnQm9uayddKTtcbmludGVyZmFjZSBQb3NlIHsgY2xpcDogc3RyaW5nOyBlbW90ZT86IHN0cmluZyB9XG5pbnRlcmZhY2UgRmxhdm9yIHsgY2xpcHM6IFBvc2VbXTsgbWluOiBudW1iZXI7IG1heDogbnVtYmVyIH1cbmludGVyZmFjZSBUcmlwb0NmZyB7IGNvbnRhaW5lcjogYW55OyBlbmVteVRleDogYW55OyBjbGlwczogUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPjsgbWF0Q2FjaGU6IFJlY29yZDxzdHJpbmcsIGFueT47IGJhc2VNYXQ/OiBhbnk7IHRvcDogbnVtYmVyOyBzY2FsZTogbnVtYmVyOyBmbGF2b3I/OiBGbGF2b3I7IGNoZWVycz86IFBvc2VbXTsgc3Bhd25FbW90ZT86IHN0cmluZzsgZXllcz86IHN0cmluZzsgZXllVGV4PzogYW55OyBzdGFyU2NhbGU/OiBudW1iZXJbXSB9XG5cbmZ1bmN0aW9uIGR5bihzY2VuZTogYW55LCB3OiBudW1iZXIsIGg6IG51bWJlciwgZHJhdzogKGM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCkgPT4gdm9pZCwgYWxwaGEgPSB0cnVlKSB7XG4gIGNvbnN0IHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnZHQnLCB7IHdpZHRoOiB3LCBoZWlnaHQ6IGggfSwgc2NlbmUsIHRydWUpOyBkcmF3KHQuZ2V0Q29udGV4dCgpKTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IGFscGhhOyByZXR1cm4gdDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRBc3NldHMoc2NlbmU6IGFueSk6IFByb21pc2U8QXNzZXRzPiB7XG4gIGNvbnN0IHNvZnQgPSBkeW4oc2NlbmUsIDY0LCA2NCwgKGMpID0+IHsgY29uc3QgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwuNTUpJyk7IGcuYWRkQ29sb3JTdG9wKDEsICdyZ2JhKDI1NSwyNTUsMjU1LDApJyk7IGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCA2NCwgNjQpOyB9KTtcbiAgY29uc3Qgc3RhclRleCA9IFsxLCAyLCAzXS5tYXAoKG4pID0+IGR5bihzY2VuZSwgMTkyLCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgNDBweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVN0eWxlID0gJyMxYTEwMjAnOyBjLmZpbGxTdHlsZSA9IG4gPT09IDMgPyAnI2ZmZDI0YScgOiBuID09PSAyID8gJyNkN2U2ZmYnIDogJyNmMGQ5YTAnOyBjb25zdCBzID0gJ1x1MjYwNScucmVwZWF0KG4pOyBjLnN0cm9rZVRleHQocywgOTYsIDM4KTsgYy5maWxsVGV4dChzLCA5NiwgMzgpOyB9KSk7XG4gIGNvbnN0IGVtaXNzaXZlID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdlbScsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IGE7IHJldHVybiBtOyB9O1xuICBjb25zdCBBOiBBc3NldHMgPSB7XG4gICAgc2NlbmUsIHNvZnQsIGx2VGV4OiB7fSwgc3RhclRleCwgdHJpcG86IHt9LCBlbW90ZToge30sIHJpbmdNYXQ6IFtlbWlzc2l2ZSgwLjU1LCAwLjIsIDAuOTUsIDAuOSksIGVtaXNzaXZlKDAuOTUsIDAuMjUsIDAuMiwgMC45KV0sIGhhbG9NYXQ6IGVtaXNzaXZlKDEsIDAuODIsIDAuMywgMC45NSksXG4gICAgYmFyQmc6IGVtaXNzaXZlKDAuMDUsIDAuMDUsIDAuMDgsIDAuNyksIGJhckZpbGw6IFtlbWlzc2l2ZSgwLjU1LCAwLjM1LCAxKSwgZW1pc3NpdmUoMSwgMC40LCAwLjMpXSwgbWFuYUZpbGw6IGVtaXNzaXZlKDAuMjUsIDAuNzUsIDEpLFxuICB9O1xuICAvLyBcIlp6elwiIHRoYXQgZmxvYXRzIHVwIG92ZXIgYSBzbGVlcHkgdW5pdFxuICBjb25zdCB6enogPSBkeW4oc2NlbmUsIDEyOCwgMTI4LCAoYykgPT4geyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDk7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MGQyNic7IGMuZmlsbFN0eWxlID0gJyNlOGQ4ZmYnOyBjLmxpbmVKb2luID0gJ3JvdW5kJztcbiAgICBmb3IgKGNvbnN0IFtjaCwgc2l6ZSwgeCwgeV0gb2YgW1snWicsIDY0LCAzNCwgMTAwXSwgWyd6JywgNDgsIDc0LCA2Nl0sIFsneicsIDM0LCAxMDQsIDM4XV0gYXMgW3N0cmluZywgbnVtYmVyLCBudW1iZXIsIG51bWJlcl1bXSkgeyBjLmZvbnQgPSAnaXRhbGljIDkwMCAnICsgc2l6ZSArICdweCBzYW5zLXNlcmlmJzsgYy5zdHJva2VUZXh0KGNoLCB4LCB5KTsgYy5maWxsVGV4dChjaCwgeCwgeSk7IH0gfSk7XG4gIGNvbnN0IHptID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnenp6Jywgc2NlbmUpOyB6bS5kaWZmdXNlVGV4dHVyZSA9IHp6ejsgem0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB6bS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgem0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgem0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IEEuZW1vdGVbJ3p6eiddID0gem07XG4gIGNvbnN0IGljb24gPSAobmFtZTogc3RyaW5nLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKG5hbWUsIHNjZW5lKTsgbS5kaWZmdXNlVGV4dHVyZSA9IGR5bihzY2VuZSwgMTI4LCAxMjgsIGRyYXcpOyBtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmJhY2tGYWNlQ3VsbGluZyA9IGZhbHNlOyBBLmVtb3RlW25hbWVdID0gbTsgfTtcbiAgY29uc3QgZ2x5cGggPSAoY2g6IHN0cmluZywgZmlsbDogc3RyaW5nKSA9PiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gMTI7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MGQyNic7IGMubGluZUpvaW4gPSAncm91bmQnOyBjLmZpbGxTdHlsZSA9IGZpbGw7IGMuZm9udCA9ICc5MDAgMTA0cHggc2Fucy1zZXJpZic7IGMuc3Ryb2tlVGV4dChjaCwgNjQsIDEwMCk7IGMuZmlsbFRleHQoY2gsIDY0LCAxMDApOyB9O1xuICBpY29uKCc/JywgZ2x5cGgoJz8nLCAnI2ZmZTI3YScpKTsgaWNvbignIScsIGdseXBoKCchJywgJyNmZjlhN2EnKSk7XG4gIGljb24oJ3N3ZWF0JywgKGMpID0+IHsgYy5saW5lV2lkdGggPSA4OyBjLnN0cm9rZVN0eWxlID0gJyMxNTMwNGEnOyBjLmZpbGxTdHlsZSA9ICcjOWZlNGZmJzsgYy5iZWdpblBhdGgoKTsgYy5tb3ZlVG8oNjQsIDE0KTsgYy5iZXppZXJDdXJ2ZVRvKDEwNCwgNjIsIDEwNCwgMTA4LCA2NCwgMTEyKTsgYy5iZXppZXJDdXJ2ZVRvKDI0LCAxMDgsIDI0LCA2MiwgNjQsIDE0KTsgYy5jbG9zZVBhdGgoKTsgYy5zdHJva2UoKTsgYy5maWxsKCk7IH0pO1xuICBpY29uKCdzcGFya2xlJywgKGMpID0+IHsgYy5saW5lV2lkdGggPSA3OyBjLnN0cm9rZVN0eWxlID0gJyMzYTJhMDUnOyBjLmZpbGxTdHlsZSA9ICcjZmZmMmE4JzsgY29uc3Qgc3RhciA9ICh4OiBudW1iZXIsIHk6IG51bWJlciwgcjogbnVtYmVyKSA9PiB7IGMuYmVnaW5QYXRoKCk7IGZvciAobGV0IGkgPSAwOyBpIDwgODsgaSsrKSB7IGNvbnN0IGEgPSBpICogTWF0aC5QSSAvIDQsIHJyID0gaSAlIDIgPyByICogMC4yOCA6IHI7IGMubGluZVRvKHggKyBNYXRoLnNpbihhKSAqIHJyLCB5IC0gTWF0aC5jb3MoYSkgKiBycik7IH0gYy5jbG9zZVBhdGgoKTsgYy5zdHJva2UoKTsgYy5maWxsKCk7IH07IHN0YXIoNTYsIDcwLCA1MCk7IHN0YXIoMTAyLCAyOCwgMjApOyBzdGFyKDI2LCAyNCwgMTQpOyB9KTtcbiAgY29uc3QgZGVmczogW1NvdWxJZCwgc3RyaW5nLCBzdHJpbmcsIFJlY29yZDxWU3RhdGUsIHN0cmluZz4sIG51bWJlciwgbnVtYmVyLCBhbnk/XVtdID0gW1xuICAgIFsnd2FycmlvcicsICdTa2VsZXRvbldhcnJpb3IuZ2xiJywgJ1NrZWxldG9uV2Fycmlvcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0NoZWVyJyB9LCAxLjA1LCAxLjAsIHsgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnVHJpcCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnQm9uaycsIGVtb3RlOiAnPycgfSwgeyBjbGlwOiAnV29iYmxlJywgZW1vdGU6ICdzd2VhdCcgfSwgeyBjbGlwOiAnV2F2ZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRnVtYmxlJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdTaGllbGRCb25rJywgZW1vdGU6ICc/JyB9XSwgbWluOiA4LCBtYXg6IDE1IH0sIGNoZWVyczogW3sgY2xpcDogJ0NoZWVyJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdXYXZlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdUcmlwJywgZW1vdGU6ICchJyB9XSwgZXllczogJ1NrZWxldG9uV2Fycmlvcl9leWVzLnBuZycgfV0sXG4gICAgWydhcmNoZXInLCAnU2tlbGV0b25BcmNoZXIuZ2xiJywgJ1NrZWxldG9uQXJjaGVyX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdTaG9vdCcsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdGbGV4JyB9LCAxLjA1LCAxLjAsIHsgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnRmxleCcsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRG91YmxlQmljZXBzJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb25lQ3JhY2snIH0sIHsgY2xpcDogJ0Jvd1R3aXJsJywgZW1vdGU6ICdzcGFya2xlJyB9XSwgbWluOiA4LCBtYXg6IDE1IH0sIGNoZWVyczogW3sgY2xpcDogJ0ZsZXgnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0RvdWJsZUJpY2VwcycsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnQm93VHdpcmwnLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBleWVzOiAnU2tlbGV0b25BcmNoZXJfZXllcy5wbmcnIH1dLFxuICAgIFsnZ29ibGluJywgJ0dvYmxpbi5nbGInLCAnR29ibGluX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMCwgMC44NSwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdTY2hlbWUnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1BlZWsnLCBlbW90ZTogJz8nIH0sIHsgY2xpcDogJ1NwaW4nLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1NuaWNrZXInLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDYsIG1heDogMTIgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1NuaWNrZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1NwaW4nLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBleWVzOiAnR29ibGluX2V5ZXMucG5nJyB9XSxcbiAgICBbJ2tuaWdodCcsICdLbmlnaHQuZ2xiJywgJ0tuaWdodF9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ1Bvc2UnIH0sIDEuMCwgMS4wNSwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdTYWx1dGUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvYXN0JywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdBZG1pcmUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1ByYXknLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnUG9zZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU2FsdXRlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb2FzdCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnUHJheScsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdLbmlnaHRfZXllcy5wbmcnIH1dLFxuICAgIFsnYmFyYmFyaWFuJywgJ0JhcmJhcmlhbi5nbGInLCAnQmFyYmFyaWFuX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMCwgMS4wNSwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdSb2FyJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdDaGVzdEJlYXQnIH0sIHsgY2xpcDogJ1N0b21wJywgZW1vdGU6ICchJyB9XSwgbWluOiA3LCBtYXg6IDEzIH0sIGNoZWVyczogW3sgY2xpcDogJ0NoZWVyJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdSb2FyJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdDaGVzdEJlYXQnIH1dLCBleWVzOiAnQmFyYmFyaWFuX2V5ZXMucG5nJyB9XSxcbiAgICBbJ29ncmUnLCAnT2dyZS5nbGInLCAnT2dyZV9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0NoZWVyJyB9LCAxLjAyLCAxLjEyLCB7IHN0YXJTY2FsZTogWzEsIDEuMywgMS42NV0sIGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1lhd24nLCBlbW90ZTogJ3p6eicgfSwgeyBjbGlwOiAnU2hydWcnIH0sIHsgY2xpcDogJ1N0b21wJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdUaHVtcCcgfV0sIG1pbjogOSwgbWF4OiAxNiB9LCBjaGVlcnM6IFt7IGNsaXA6ICdDaGVlcicgfSwgeyBjbGlwOiAnVGh1bXAnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1N0b21wJywgZW1vdGU6ICchJyB9XSwgc3Bhd25FbW90ZTogJ3p6eicsIGV5ZXM6ICdPZ3JlX2V5ZXMucG5nJyB9XSxcbiAgXTtcbiAgY29uc3QgbmVjcm9QID0gQkFCWUxPTi5TY2VuZUxvYWRlci5Mb2FkQXNzZXRDb250YWluZXJBc3luYygnYXNzZXRzLycsICdOZWNyb21hbmNlci5nbGInLCBzY2VuZSkudGhlbigoYzogYW55KSA9PiB7IEEubmVjcm8gPSBjOyB9KS5jYXRjaCgoKSA9PiB7IC8qIHRoZSBnYW1lIGNhbm5vdCBzaG93IGhpbSAqLyB9KTtcbiAgY29uc3QgYXJyb3dQID0gQkFCWUxPTi5TY2VuZUxvYWRlci5Mb2FkQXNzZXRDb250YWluZXJBc3luYygnYXNzZXRzLycsICdBcnJvdy5nbGInLCBzY2VuZSkudGhlbigoYzogYW55KSA9PiB7IEEuYXJyb3cgPSBjOyB9KS5jYXRjaCgoKSA9PiB7IC8qIGZhbGxzIGJhY2sgdG8gdGhlIHBsYWluIGxpbmUgKi8gfSk7XG4gIGF3YWl0IFByb21pc2UuYWxsKFthcnJvd1AsIG5lY3JvUCwgLi4uZGVmcy5tYXAoYXN5bmMgKFtzb3VsLCBnbGIsIGVuZW15LCBjbGlwcywgdG9wLCBzY2FsZSwgZXh0cmFdKSA9PiB7XG4gICAgY29uc3QgY29udGFpbmVyID0gYXdhaXQgQkFCWUxPTi5TY2VuZUxvYWRlci5Mb2FkQXNzZXRDb250YWluZXJBc3luYygnYXNzZXRzLycsIGdsYiwgc2NlbmUpO1xuICAgIEEudHJpcG9bc291bF0gPSB7IGNvbnRhaW5lciwgZW5lbXlUZXg6IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy8nICsgZW5lbXksIHNjZW5lLCBmYWxzZSwgZmFsc2UpLCBjbGlwcywgbWF0Q2FjaGU6IHt9LCB0b3AsIHNjYWxlLCAuLi4oZXh0cmEgfHwge30pLCBleWVUZXg6IGV4dHJhICYmIGV4dHJhLmV5ZXMgPyBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvJyArIGV4dHJhLmV5ZXMsIHNjZW5lLCBmYWxzZSwgZmFsc2UpIDogdW5kZWZpbmVkIH07XG4gIH0pXSk7XG4gIHJldHVybiBBO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNoYXJlZCBkZWNvcmF0aW9uXG5jbGFzcyBEZWNvIHtcbiAgcHJpdmF0ZSBwczogYW55ID0gbnVsbDsgcHJpdmF0ZSBoYWxvOiBhbnkgPSBudWxsOyBwcml2YXRlIGJhZGdlOiBhbnk7IHByaXZhdGUgc3RhcnM6IGFueTsgcHJpdmF0ZSBmaWxsOiBhbnk7IHByaXZhdGUgYmFyOiBhbnk7IHByaXZhdGUgbWJnOiBhbnk7IHByaXZhdGUgbWZpbGw6IGFueTsgcHJpdmF0ZSByaW5nOiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHBhcmVudDogYW55LCBwcml2YXRlIHRvcDogbnVtYmVyLCBwcml2YXRlIHJhZGl1czogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmU7XG4gICAgdGhpcy5yaW5nID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdyaW5nJywgeyByYWRpdXM6IE1hdGgubWF4KDAuMywgcmFkaXVzICogMS4xNSksIHRlc3NlbGxhdGlvbjogMjYgfSwgcyk7IHRoaXMucmluZy5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHRoaXMucmluZy5wb3NpdGlvbi55ID0gMC4wMjsgdGhpcy5yaW5nLnBhcmVudCA9IHBhcmVudDsgdGhpcy5yaW5nLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLmJhZGdlID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnYmFkZ2UnLCBzKTsgdGhpcy5iYWRnZS5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMuYmFkZ2UucG9zaXRpb24ueSA9IHRvcCArIDAuMzI7IHRoaXMuYmFkZ2UuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDtcbiAgICB0aGlzLnN0YXJzID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnc3RhcnMnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4xNSB9LCBzKTsgdGhpcy5zdGFycy5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLnN0YXJzLnBvc2l0aW9uLnkgPSAwLjExOyB0aGlzLnN0YXJzLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBzbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3NtJywgcyk7IHNtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBzbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBzbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHRoaXMuc3RhcnMubWF0ZXJpYWwgPSBzbTsgKHRoaXMuc3RhcnMgYXMgYW55KS5fc20gPSBzbTtcbiAgICBjb25zdCBiZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2JnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDg1IH0sIHMpOyBiZy5wYXJlbnQgPSB0aGlzLmJhZGdlOyBiZy5tYXRlcmlhbCA9IEEuYmFyQmc7IGJnLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5iYXIgPSBiZztcbiAgICB0aGlzLmZpbGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdmaWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjA1IH0sIHMpOyB0aGlzLmZpbGwucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5maWxsLnBvc2l0aW9uLnogPSAtMC4wMDI7IHRoaXMuZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdtYmcnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5tYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5tYmcucG9zaXRpb24ueSA9IC0wLjA3OyB0aGlzLm1iZy5tYXRlcmlhbCA9IEEuYmFyQmc7IHRoaXMubWJnLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLm1maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWZpbGwnLCB7IHdpZHRoOiAwLjU2LCBoZWlnaHQ6IDAuMDMgfSwgcyk7IHRoaXMubWZpbGwucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5tZmlsbC5wb3NpdGlvbi5zZXQoMCwgLTAuMDcsIC0wLjAwMik7IHRoaXMubWZpbGwubWF0ZXJpYWwgPSBBLm1hbmFGaWxsOyB0aGlzLm1maWxsLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLmx2ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbHYnLCB7IHdpZHRoOiAwLjM2LCBoZWlnaHQ6IDAuMTM1IH0sIHMpOyB0aGlzLmx2LnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubHYucG9zaXRpb24uc2V0KC0wLjUyLCAwLjAsIDApOyB0aGlzLmx2LmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5sdi5zZXRFbmFibGVkKGZhbHNlKTtcbiAgICBjb25zdCBsbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2x2bScsIHMpOyBsbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB0aGlzLmx2Lm1hdGVyaWFsID0gbG07XG4gICAgdGhpcy5iYXIuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuZmlsbC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tYmcuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgcHJpdmF0ZSBsdjogYW55OyBwcml2YXRlIGx2TiA9IDA7IHByaXZhdGUgYmFyT24gPSBmYWxzZTsgcHJpdmF0ZSB0YWc6IGFueSA9IG51bGw7XG4gIC8qKiBBIHJlZCBCT1NTIHRhZyBhYm92ZSB0aGUgc3RhcnMuICovXG4gIHNldEJvc3Mob246IGJvb2xlYW4pIHtcbiAgICBpZiAoIW9uKSB7IGlmICh0aGlzLnRhZykgdGhpcy50YWcuc2V0RW5hYmxlZChmYWxzZSk7IHJldHVybjsgfVxuICAgIGlmICghdGhpcy50YWcpIHtcbiAgICAgIGNvbnN0IEEgPSB0aGlzLkEsIHQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdib3NzdGFnJywgeyB3aWR0aDogMC41LCBoZWlnaHQ6IDAuMTcgfSwgQS5zY2VuZSk7IHQucGFyZW50ID0gdGhpcy5iYWRnZTsgdC5wb3NpdGlvbi5zZXQoMCwgMC4yOSwgMCk7IHQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2Jvc3N0YWdtJywgQS5zY2VuZSk7IG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7XG4gICAgICBtLmRpZmZ1c2VUZXh0dXJlID0gZHluKEEuc2NlbmUsIDE5MiwgNjQsIChjKSA9PiB7IGMuZm9udCA9ICc5MDAgNDZweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA4OyBjLnN0cm9rZVN0eWxlID0gJyMyYTA1MDgnOyBjLmZpbGxTdHlsZSA9ICcjZmY1YjRhJzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7IGMuc3Ryb2tlVGV4dCgnQk9TUycsIDk2LCA0OCk7IGMuZmlsbFRleHQoJ0JPU1MnLCA5NiwgNDgpOyB9KTtcbiAgICAgIHQubWF0ZXJpYWwgPSBtOyB0aGlzLnRhZyA9IHQ7XG4gICAgfVxuICAgIHRoaXMudGFnLnNldEVuYWJsZWQodHJ1ZSk7XG4gIH1cbiAgLyoqIFwiTFYgblwiIGJlc2lkZSB0aGUgaGVhbHRoIGJhciAocGVybWFuZW50IFNvdWwgbGV2ZWwpOyAwIGhpZGVzIGl0LiAqL1xuICBzZXRMZXZlbChuOiBudW1iZXIpIHtcbiAgICB0aGlzLmx2TiA9IG47IGlmICghdGhpcy5sdikgcmV0dXJuOyBpZiAobiA8PSAwIHx8ICF0aGlzLmJhck9uKSB7IHRoaXMubHYuc2V0RW5hYmxlZChmYWxzZSk7IGlmIChuID4gMCkgdGhpcy5lbnN1cmVMdihuKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5lbnN1cmVMdihuKTsgdGhpcy5sdi5zZXRFbmFibGVkKHRydWUpO1xuICB9XG4gIHByaXZhdGUgZW5zdXJlTHYobjogbnVtYmVyKSB7XG4gICAgY29uc3QgQSA9IHRoaXMuQTsgaWYgKCFBLmx2VGV4W25dKSBBLmx2VGV4W25dID0gZHluKEEuc2NlbmUsIDEyOCwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDM0cHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gNjsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5maWxsU3R5bGUgPSAnI2U4ZDhmZic7IGMubGluZUpvaW4gPSAncm91bmQnOyBjLnN0cm9rZVRleHQoJ0xWICcgKyBuLCA2NCwgMzYpOyBjLmZpbGxUZXh0KCdMViAnICsgbiwgNjQsIDM2KTsgfSk7XG4gICAgKHRoaXMubHYubWF0ZXJpYWwgYXMgYW55KS5kaWZmdXNlVGV4dHVyZSA9IEEubHZUZXhbbl07XG4gIH1cbiAgLyoqIFRoZSBiYXJzIGtlZXAgdGhlIHNhbWUgc2l6ZSBhbmQgdGhlIHNhbWUgc21hbGwgZ2FwIGFib3ZlIHRoZSBoZWFkIGhvd2V2ZXIgYmlnIHRoZSB1bml0IGdyb3dzLiAqL1xuICBmaXQoazogbnVtYmVyKSB7IHRoaXMuYmFkZ2Uuc2NhbGluZy5zZXRBbGwoMSAvIGspOyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuMyAvIGs7IGlmICh0aGlzLmhhbG8pIHRoaXMuaGFsby5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjA4OyB9XG4gIHNldCh0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IHRoaXMuQS5zY2VuZSwgY2ZnID0gQVVSQVtzdGFyIC0gMV07XG4gICAgKHRoaXMuc3RhcnMgYXMgYW55KS5fc20uZGlmZnVzZVRleHR1cmUgPSB0aGlzLkEuc3RhclRleFtzdGFyIC0gMV07XG4gICAgdGhpcy5yaW5nLm1hdGVyaWFsID0gdGhpcy5BLnJpbmdNYXRbdGVhbV07IHRoaXMuZmlsbC5tYXRlcmlhbCA9IHRoaXMuQS5iYXJGaWxsW3RlYW1dO1xuICAgIGlmICh0ZWFtID09PSAwKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByYWlzZWQgYnkgdGhlIE5lY3JvbWFuY2VyOiBwdXJwbGUgYXVyYSB0aGF0IGdyb3dzIHdpdGggc3RhcnNcbiAgICAgIGlmICghdGhpcy5wcykge1xuICAgICAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdhdXJhJywgNzAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IHRoaXMucGFyZW50OyBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yLCAwLCAtMC4yKTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCB0aGlzLnRvcCAqIDAuNSwgMC4yKTtcbiAgICAgICAgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMS4xOyBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xNSwgMC44LCAtMC4xNSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMTUsIDEuNSwgMC4xNSk7XG4gICAgICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuMzU7IHBzLm1heEVtaXRQb3dlciA9IDAuODsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyB0aGlzLnBzID0gcHM7XG4gICAgICB9XG4gICAgICBjb25zdCBwID0gdGhpcy5wczsgcC5lbWl0UmF0ZSA9IGNmZy5yYXRlOyBwLm1pblNpemUgPSBjZmcubWluOyBwLm1heFNpemUgPSBjZmcubWF4OyBwLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi5jZmcuYzEpOyBwLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi5jZmcuYzIpOyBwLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgICBpZiAoIXAuaXNTdGFydGVkKCkpIHAuc3RhcnQoKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMucHMgJiYgdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdG9wKCk7XG4gICAgaWYgKHN0YXIgPj0gMykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGdvbGQgaGFsbyBhYm92ZSB0aGUgaGVhZFxuICAgICAgaWYgKCF0aGlzLmhhbG8pIHsgdGhpcy5oYWxvID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnaGFsbycsIHsgZGlhbWV0ZXI6IDAuNTUsIHRoaWNrbmVzczogMC4wNCwgdGVzc2VsbGF0aW9uOiAyNCB9LCBzKTsgdGhpcy5oYWxvLnBhcmVudCA9IHRoaXMucGFyZW50OyB0aGlzLmhhbG8ucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4wODsgdGhpcy5oYWxvLm1hdGVyaWFsID0gdGhpcy5BLmhhbG9NYXQ7IHRoaXMuaGFsby5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAgIHRoaXMuaGFsby5zZXRFbmFibGVkKHRydWUpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5oYWxvKSB0aGlzLmhhbG8uc2V0RW5hYmxlZChmYWxzZSk7XG4gIH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5iYXIuc2V0RW5hYmxlZChvbik7IHRoaXMuZmlsbC5zZXRFbmFibGVkKG9uKTsgdGhpcy5iYXJPbiA9IG9uOyBpZiAodGhpcy5sdikgdGhpcy5sdi5zZXRFbmFibGVkKG9uICYmIHRoaXMubHZOID4gMCk7XG4gICAgaWYgKG9uKSB7IGNvbnN0IGsgPSBNYXRoLm1heCgwLjAwMSwgZiBhcyBudW1iZXIpOyB0aGlzLmZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5maWxsLnBvc2l0aW9uLnggPSAtKDAuNTYgKiAoMSAtIGspKSAvIDI7IH1cbiAgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHtcbiAgICBjb25zdCBvbiA9IGYgIT09IG51bGw7IHRoaXMubWJnLnNldEVuYWJsZWQob24pOyB0aGlzLm1maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5tZmlsbC5zY2FsaW5nLnggPSBrOyB0aGlzLm1maWxsLnBvc2l0aW9uLnggPSAtKDAuNTYgKiAoMSAtIGspKSAvIDI7IH1cbiAgfVxuICBzZXRBdXJhKG9uOiBib29sZWFuKSB7IGlmICh0aGlzLnBzKSB7IGlmIChvbiAmJiAhdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdGFydCgpOyBpZiAoIW9uICYmIHRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RvcCgpOyB9IH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHsgaWYgKHRoaXMuaGFsbyAmJiB0aGlzLmhhbG8uaXNFbmFibGVkKCkpIHRoaXMuaGFsby5yb3RhdGlvbi55ICs9IGR0ICogMS42OyB9XG4gIGRpc3Bvc2UoKSB7IGlmICh0aGlzLnBzKSB7IHRoaXMucHMuc3RvcCgpOyB0aGlzLnBzLmRpc3Bvc2UoKTsgfSBbdGhpcy5oYWxvLCB0aGlzLnJpbmcsIHRoaXMuc3RhcnMsIHRoaXMuYmFyLCB0aGlzLmZpbGwsIHRoaXMubWJnLCB0aGlzLm1maWxsXS5mb3JFYWNoKChtKSA9PiBtICYmIG0uZGlzcG9zZSgpKTsgdGhpcy5iYWRnZS5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSByZWFsIG1vZGVsc1xuY2xhc3MgVHJpcG9WaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgZW50OiBhbnk7IHByaXZhdGUgYm9keTogYW55OyBwcml2YXRlIGFuaW1zOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307IHByaXZhdGUgY3VyOiBhbnkgPSBudWxsOyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHB1bHNlVCA9IDA7IHByaXZhdGUgYmFzZTogbnVtYmVyO1xuICBwcml2YXRlIGxhc3RGbGF2b3IgPSAnJzsgcHJpdmF0ZSB1aWQgPSAnJzsgcHJpdmF0ZSBvd246IGFueSA9IG51bGw7IHByaXZhdGUgaWRsZVQgPSAwOyBwcml2YXRlIG5leHRGbGF2b3IgPSAxZTk7IHByaXZhdGUgZmxhdm9yT24gPSBmYWxzZTsgcHJpdmF0ZSBxdWV1ZWQgPSBmYWxzZTsgcHJpdmF0ZSBzcGF3blQgPSAwOyBwcml2YXRlIGV5ZUsgPSAwLjY1OyBwcml2YXRlIGVtb3RlczogeyBtOiBhbnk7IHQ6IG51bWJlcjsgeTA6IG51bWJlciB9W10gPSBbXTtcbiAgcHJpdmF0ZSBzb3VsSWQ6IFNvdWxJZDtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgY2ZnOiBUcmlwb0NmZywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgdGhpcy5zb3VsSWQgPSBzb3VsO1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCB1aWQgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA3KTsgdGhpcy51aWQgPSB1aWQ7XG4gICAgdGhpcy5lbnQgPSBjZmcuY29udGFpbmVyLmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ18nICsgdWlkLCBmYWxzZSwgeyBkb05vdEluc3RhbnRpYXRlOiB0cnVlIH0pO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgndW5pdF8nICsgdWlkLCBzKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIHRoaXMuYm9keSA9IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZpbmQoKG06IGFueSkgPT4gbS5uYW1lLmluY2x1ZGVzKCdfQm9keScpKTtcbiAgICBpZiAoIWNmZy5iYXNlTWF0KSBjZmcuYmFzZU1hdCA9IHRoaXMuYm9keS5tYXRlcmlhbDtcbiAgICB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiB7IGcuc3RvcCgpOyBnLmVuYWJsZUJsZW5kaW5nID0gdHJ1ZTsgZy5ibGVuZGluZ1NwZWVkID0gMC4xMjsgdGhpcy5hbmltc1tnLm5hbWUuc3BsaXQoJ18nKVswXV0gPSBnOyB9KTtcbiAgICB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfSk7XG4gICAgdGhpcy50b3AgPSBjZmcudG9wOyB0aGlzLmJhc2UgPSBjZmcuc2NhbGU7IHRoaXMudGVhbSA9IHRlYW07XG4gICAgaWYgKGNmZy5mbGF2b3IpIHRoaXMubmV4dEZsYXZvciA9IGNmZy5mbGF2b3IubWluICsgTWF0aC5yYW5kb20oKSAqIChjZmcuZmxhdm9yLm1heCAtIGNmZy5mbGF2b3IubWluKTtcbiAgICB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIDAuMyk7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiAxLjMsIGRpYW1ldGVyOiAwLjggfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSAwLjY7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5pc1BpY2thYmxlID0gdHJ1ZTtcbiAgICB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICB9XG4gIHByaXZhdGUgYXBwbHlNYXQoKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy50ZWFtICsgJ18nICsgdGhpcy5zdGFyLCBjID0gdGhpcy5jZmc7XG4gICAgaWYgKGMuZXllVGV4KSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIHVuaXQgaGFzIGdsb3dpbmcgZXllczogaXQgZ2V0cyBpdHMgb3duIG1hdGVyaWFsIHNvIGl0cyBnbG93IGNhbiBjaGFuZ2Ugb24gaXRzIG93blxuICAgICAgaWYgKCF0aGlzLm93bikgeyB0aGlzLm93biA9IGMuYmFzZU1hdC5jbG9uZSgnb3duXycgKyB0aGlzLnVpZCk7IHRoaXMub3duLmVtaXNzaXZlVGV4dHVyZSA9IGMuZXllVGV4OyB0aGlzLm93bi5lbWlzc2l2ZUludGVuc2l0eSA9IHRoaXMuZXllSzsgfVxuICAgICAgdGhpcy5vd24uYWxiZWRvVGV4dHVyZSA9IHRoaXMudGVhbSA9PT0gMSA/IGMuZW5lbXlUZXggOiBjLmJhc2VNYXQuYWxiZWRvVGV4dHVyZTsgY29uc3QgdCA9IFRJTlRbdGhpcy5zdGFyIC0gMV07IHRoaXMub3duLmFsYmVkb0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHRbMF0sIHRbMV0sIHRbMl0pO1xuICAgICAgdGhpcy5vd24uZW1pc3NpdmVDb2xvciA9IHRoaXMudGVhbSA9PT0gMSA/IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjcyLCAwLjIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNzgsIDAuMywgMSk7XG4gICAgICB0aGlzLmJvZHkubWF0ZXJpYWwgPSB0aGlzLm93bjsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIWMubWF0Q2FjaGVba2V5XSkgeyBjb25zdCBtID0gYy5iYXNlTWF0LmNsb25lKCdtXycgKyBrZXkpOyBpZiAodGhpcy50ZWFtID09PSAxKSBtLmFsYmVkb1RleHR1cmUgPSBjLmVuZW15VGV4OyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgbS5hbGJlZG9Db2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyh0WzBdLCB0WzFdLCB0WzJdKTsgYy5tYXRDYWNoZVtrZXldID0gbTsgfVxuICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IGMubWF0Q2FjaGVba2V5XTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLnNjKHN0KSAqIHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IHRoaXMuZGVjby5maXQodGhpcy5zYyhzdCkgKiB0aGlzLmJhc2UpOyB9XG4gIHByaXZhdGUgYm9zc0sgPSAxO1xuICAvKiogVGhlIGluc3BlY3Qgdmlldzogd2hpY2ggYW5pbWF0aW9ucyB0aGlzIHVuaXQgaGFzLCBhbmQgYSB3YXkgdG8gcGxheSBhbnkgb25lIG9mIHRoZW0uICovXG4gIGNsaXBOYW1lcygpOiBzdHJpbmdbXSB7IHJldHVybiBPYmplY3Qua2V5cyh0aGlzLmFuaW1zKS5maWx0ZXIoKG4pID0+IG4gIT09ICdXYWxrJyAmJiBuICE9PSAnSGl0Jyk7IH1cbiAgcHJldmlld0NsaXAobmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbbmFtZV07IGlmICghZykgcmV0dXJuO1xuICAgIGlmIChuYW1lID09PSAnSWRsZScpIHsgdGhpcy5wbGF5KCdpZGxlJyk7IHJldHVybjsgfVxuICAgIHRoaXMucXVldWVkID0gZmFsc2U7IGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChmYWxzZSwgMSwgZy5mcm9tLCBnLnRvKTsgdGhpcy5jdXIgPSBnOyB0aGlzLmZsYXZvck9uID0gdHJ1ZTsgdGhpcy5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5pZGxlVCA9IDA7XG4gICAgY29uc3QgcG9zZSA9IFsuLi4odGhpcy5jZmcuZmxhdm9yPy5jbGlwcyB8fCBbXSksIC4uLih0aGlzLmNmZy5jaGVlcnMgfHwgW10pXS5maW5kKChwKSA9PiBwLmNsaXAgPT09IG5hbWUpO1xuICAgIGlmIChwb3NlICYmIHBvc2UuZW1vdGUpIHsgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAwLjQpOyBpZiAocG9zZS5lbW90ZSA9PT0gJ3p6eicpIHRoaXMuZW1vdGUocG9zZS5lbW90ZSwgMS4yKTsgfVxuICAgIGlmIChWT0NBTC5oYXMobmFtZSkgfHwgbmFtZSA9PT0gJ0NoZWVyJyB8fCBuYW1lID09PSAnQXR0YWNrJykgYXVkaW8uYmFyayh0aGlzLnNvdWxJZCwgMC4yKTtcbiAgfVxuICBwcml2YXRlIHNjKHN0OiBudW1iZXIpIHsgcmV0dXJuICh0aGlzLmNmZy5zdGFyU2NhbGUgfHwgQkFMQU5DRS5zdGFyLnNjYWxlKVtzdCAtIDFdICogdGhpcy5ib3NzSzsgfVxuICBzZXRCb3NzKG9uOiBib29sZWFuKSB7IHRoaXMuYm9zc0sgPSBvbiA/IDEuMyA6IDE7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuc2ModGhpcy5zdGFyKSAqIHRoaXMuYmFzZSk7IHRoaXMuZGVjby5maXQodGhpcy5zYyh0aGlzLnN0YXIpICogdGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldEJvc3Mob24pOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldExldmVsKG46IG51bWJlcikgeyB0aGlzLmRlY28uc2V0TGV2ZWwobik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHtcbiAgICBsZXQgY2xpcCA9IHRoaXMuY2ZnLmNsaXBzW3N0YXRlXSwgcG9zZTogUG9zZSB8IHVuZGVmaW5lZDtcbiAgICBpZiAoc3RhdGUgPT09ICdjaGVlcicgJiYgdGhpcy5jZmcuY2hlZXJzKSB7IHBvc2UgPSB0aGlzLmNmZy5jaGVlcnNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogdGhpcy5jZmcuY2hlZXJzLmxlbmd0aCldOyBjbGlwID0gcG9zZS5jbGlwOyB9XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbY2xpcF07IGlmICghZykgcmV0dXJuOyBjb25zdCBsb29wID0gc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bic7XG4gICAgaWYgKHN0YXRlID09PSAnaWRsZScgJiYgdGhpcy5zdGF0ZSA9PT0gJ3NwYXduJyAmJiB0aGlzLmN1ciAmJiB0aGlzLmN1ci5pc1N0YXJ0ZWQgJiYgdGhpcy5jZmcuZmxhdm9yKSB7IHRoaXMucXVldWVkID0gdHJ1ZTsgcmV0dXJuOyB9ICAgLy8gbGV0IHRoZSB3YWtlLXVwIHBsYXkgdG8gdGhlIGVuZFxuICAgIGlmIChsb29wICYmIHRoaXMuc3RhdGUgPT09IHN0YXRlICYmIHRoaXMuY3VyID09PSBnKSByZXR1cm47XG4gICAgdGhpcy5xdWV1ZWQgPSBmYWxzZTsgdGhpcy5mbGF2b3JPbiA9IGZhbHNlOyB0aGlzLmlkbGVUID0gMDtcbiAgICBpZiAodGhpcy5jdXIpIHRoaXMuY3VyLnN0b3AoKTsgZy5zdG9wKCk7IGcuc3RhcnQobG9vcCwgc3BlZWQsIGcuZnJvbSwgZy50byk7XG4gICAgaWYgKGxvb3ApIGcuZ29Ub0ZyYW1lKGcuZnJvbSArIE1hdGgucmFuZG9tKCkgKiAoZy50byAtIGcuZnJvbSkpO1xuICAgIHRoaXMuY3VyID0gZzsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7XG4gICAgaWYgKHBvc2UgJiYgcG9zZS5lbW90ZSkgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAwLjM1KTtcbiAgICBpZiAoc3RhdGUgPT09ICdzcGF3bicpIHsgdGhpcy5zcGF3blQgPSAwOyBpZiAodGhpcy5jZmcuc3Bhd25FbW90ZSkgeyB0aGlzLmVtb3RlKHRoaXMuY2ZnLnNwYXduRW1vdGUsIDAuMSk7IHRoaXMuZW1vdGUodGhpcy5jZmcuc3Bhd25FbW90ZSwgMC43KTsgfSB9XG4gIH1cbiAgLyoqIEEgbGl0dGxlIHBpY3R1cmUgdGhhdCBmbG9hdHMgdXAgb3ZlciB0aGUgaGVhZCBhbmQgZmFkZXMgKGEgc2xlZXB5IFwiWnp6XCIpLiAqL1xuICBwcml2YXRlIGVtb3RlKGtpbmQ6IHN0cmluZywgZGVsYXkgPSAwKSB7XG4gICAgY29uc3QgbWF0ID0gdGhpcy5BLmVtb3RlW2tpbmRdOyBpZiAoIW1hdCkgcmV0dXJuO1xuICAgIGNvbnN0IHBsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZW1vJywgeyBzaXplOiAwLjQyIH0sIHRoaXMuQS5zY2VuZSk7IHBsLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBwbC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBwbC5tYXRlcmlhbCA9IG1hdDsgcGwuaXNQaWNrYWJsZSA9IGZhbHNlOyBwbC52aXNpYmlsaXR5ID0gMDtcbiAgICBjb25zdCB5MCA9IHRoaXMudG9wICsgMC4wMjsgcGwucG9zaXRpb24uc2V0KDAuMTYsIHkwLCAwKTsgdGhpcy5lbW90ZXMucHVzaCh7IG06IHBsLCB0OiAtZGVsYXksIHkwIH0pO1xuICB9XG4gIC8qKiBBZnRlciBzdGFuZGluZyBpZGxlIGZvciBhIHdoaWxlOiBwbGF5IHRoZSB1bml0J3MgZmxhdm91ciBjbGlwIG9uY2UgKHRoZSBPZ3JlIHlhd25zKSwgdGhlbiBnbyBiYWNrIHRvIGlkbGluZy4gKi9cbiAgcHJpdmF0ZSBzdGFydEZsYXZvcigpIHtcbiAgICBjb25zdCBmID0gdGhpcy5jZmcuZmxhdm9yITsgdGhpcy5pZGxlVCA9IDA7XG4gICAgbGV0IHBvb2wgPSBmLmNsaXBzLmZpbHRlcigoYykgPT4gYy5jbGlwICE9PSB0aGlzLmxhc3RGbGF2b3IgJiYgdGhpcy5hbmltc1tjLmNsaXBdKTsgaWYgKCFwb29sLmxlbmd0aCkgcG9vbCA9IGYuY2xpcHMuZmlsdGVyKChjKSA9PiB0aGlzLmFuaW1zW2MuY2xpcF0pOyBpZiAoIXBvb2wubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgcG9zZSA9IHBvb2xbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogcG9vbC5sZW5ndGgpXSwgZyA9IHRoaXMuYW5pbXNbcG9zZS5jbGlwXTsgdGhpcy5sYXN0Rmxhdm9yID0gcG9zZS5jbGlwO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChmYWxzZSwgMSwgZy5mcm9tLCBnLnRvKTsgdGhpcy5jdXIgPSBnOyB0aGlzLmZsYXZvck9uID0gdHJ1ZTsgdGhpcy5uZXh0Rmxhdm9yID0gZi5taW4gKyBNYXRoLnJhbmRvbSgpICogKGYubWF4IC0gZi5taW4pO1xuICAgIGlmIChWT0NBTC5oYXMocG9zZS5jbGlwKSkgYXVkaW8uYmFyayh0aGlzLnNvdWxJZCwgMC4yNSk7XG4gICAgaWYgKHBvc2UuZW1vdGUpIHsgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAwLjQpOyBpZiAocG9zZS5lbW90ZSA9PT0gJ3p6eicpIHRoaXMuZW1vdGUocG9zZS5lbW90ZSwgMS4yKTsgfVxuICB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy5kZWNvLnVwZGF0ZShkdCk7XG4gICAgaWYgKHRoaXMuY3VyICYmICF0aGlzLmN1ci5pc1N0YXJ0ZWQpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBvbmUtc2hvdCBjbGlwIGZpbmlzaGVkXG4gICAgICBpZiAodGhpcy5xdWV1ZWQpIHsgdGhpcy5xdWV1ZWQgPSBmYWxzZTsgdGhpcy5wbGF5KCdpZGxlJyk7IH0gZWxzZSBpZiAodGhpcy5mbGF2b3JPbikgeyB0aGlzLmZsYXZvck9uID0gZmFsc2U7IHRoaXMucGxheSgnaWRsZScpOyB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHRoaXMucGxheSgnaWRsZScpO1xuICAgIH1cbiAgICBpZiAodGhpcy5jZmcuZmxhdm9yICYmIHRoaXMuc3RhdGUgPT09ICdpZGxlJyAmJiAhdGhpcy5mbGF2b3JPbiAmJiB0aGlzLmhvbGRlci5pc0VuYWJsZWQoKSkgeyB0aGlzLmlkbGVUICs9IGR0OyBpZiAodGhpcy5pZGxlVCA+PSB0aGlzLm5leHRGbGF2b3IpIHRoaXMuc3RhcnRGbGF2b3IoKTsgfVxuICAgIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB0aGlzLnNwYXduVCArPSBkdDtcbiAgICBmb3IgKGxldCBpID0gdGhpcy5lbW90ZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGUgPSB0aGlzLmVtb3Rlc1tpXTsgZS50ICs9IGR0OyBpZiAoZS50IDwgMCkgY29udGludWU7IGNvbnN0IGsgPSBlLnQgLyAxLjk7XG4gICAgICBpZiAoayA+PSAxKSB7IGUubS5kaXNwb3NlKCk7IHRoaXMuZW1vdGVzLnNwbGljZShpLCAxKTsgY29udGludWU7IH1cbiAgICAgIGUubS52aXNpYmlsaXR5ID0gTWF0aC5taW4oMSwgZS50IC8gMC4yKSAqICgxIC0gayAqIGspOyBlLm0ucG9zaXRpb24uc2V0KDAuMTYgKyAwLjA1ICogTWF0aC5zaW4oZS50ICogMyksIGUueTAgKyBlLnQgKiAwLjIsIDApOyBlLm0uc2NhbGluZy5zZXRBbGwoMC43ICsgMC41ICogayk7XG4gICAgfVxuICAgIGlmICh0aGlzLm93bikgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBleWUgZ2xvdyBmb2xsb3dzIHRoZSBtb29kOiBkaW0gd2hlbiBzbGVlcHksIGJyaWdodCB3aGVuIGF3YWtlLCBmbGFyaW5nIGluIGEgZmlnaHRcbiAgICAgIGxldCB0YXJnZXQgPSAwLjY1O1xuICAgICAgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHRhcmdldCA9IDAuMDggKyAwLjkyICogTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgKHRoaXMuc3Bhd25UIC8gMS42NyAtIDAuNDUpIC8gMC4zKSk7XG4gICAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnaWRsZScpIHRhcmdldCA9IHRoaXMuZmxhdm9yT24gPyAwLjI1IDogMC42NTtcbiAgICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdydW4nKSB0YXJnZXQgPSAxLjA7IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdhdHRhY2snKSB0YXJnZXQgPSAxLjc7IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHRhcmdldCA9IDEuNDsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2RlYXRoJykgdGFyZ2V0ID0gMC4wNTtcbiAgICAgIHRoaXMuZXllSyArPSAodGFyZ2V0IC0gdGhpcy5leWVLKSAqIE1hdGgubWluKDEsIGR0ICogNyk7IHRoaXMub3duLmVtaXNzaXZlSW50ZW5zaXR5ID0gdGhpcy5leWVLO1xuICAgIH1cbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuc2ModGhpcy5zdGFyKSAqIHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5lbW90ZXMuZm9yRWFjaCgoZSkgPT4gZS5tLmRpc3Bvc2UoKSk7IGlmICh0aGlzLm93bikgdGhpcy5vd24uZGlzcG9zZSgpOyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5waWNrLmRpc3Bvc2UoKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmRpc3Bvc2UoZmFsc2UsIGZhbHNlKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhbmQtaW5zXG5jb25zdCBQSDogUmVjb3JkPHN0cmluZywgeyBjb2w6IHN0cmluZzsgdzogbnVtYmVyOyBoOiBudW1iZXI7IGhlYWQ6IG51bWJlcjsgd2VhcG9uOiBzdHJpbmc7IGxhYmVsOiBzdHJpbmcgfT4gPSB7XG4gIGdvYmxpbjogeyBjb2w6ICcjNjNiMTNmJywgdzogMC4zNiwgaDogMC40MiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnZGFnZ2VyJywgbGFiZWw6ICdHT0JMSU4nIH0sXG4gIGtuaWdodDogeyBjb2w6ICcjOGVhOWRjJywgdzogMC41LCBoOiAwLjYsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ3NoaWVsZCcsIGxhYmVsOiAnS05JR0hUJyB9LFxuICBvZ3JlOiB7IGNvbDogJyNhOGE2NGEnLCB3OiAwLjg1LCBoOiAwLjg1LCBoZWFkOiAwLjQyLCB3ZWFwb246ICdtYWNlJywgbGFiZWw6ICdPR1JFJyB9LFxuICBiYXJiYXJpYW46IHsgY29sOiAnI2Q2OGE1NScsIHc6IDAuNTIsIGg6IDAuNjIsIGhlYWQ6IDAuMzgsIHdlYXBvbjogJ2F4ZScsIGxhYmVsOiAnQkFSQkFSSUFOJyB9LFxufTtcbmNsYXNzIFBsYWNlaG9sZGVyVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIHJpZzogYW55OyBwcml2YXRlIGxlZ3M6IGFueVtdID0gW107IHByaXZhdGUgd3A6IGFueTsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSB0ID0gTWF0aC5yYW5kb20oKSAqIDY7IHByaXZhdGUgc3QwID0gMDsgcHJpdmF0ZSBkdXIgPSAxOyBwcml2YXRlIGJhc2UgPSAxOyBwcml2YXRlIHB1bHNlVCA9IDA7IHByaXZhdGUgbWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBib2R5OiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHNvdWw6IHN0cmluZywgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCBkID0gUEhbc291bF07IHRoaXMudGVhbSA9IHRlYW07XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdwaF8nICsgc291bCwgcyk7IHRoaXMucmlnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncmlnJywgcyk7IHRoaXMucmlnLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIGNvbnN0IG1hdCA9IChoZXg6IHN0cmluZywgZW0gPSAwKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdwbScsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoaGV4KS5zY2FsZSgwLjcyKTsgbS5zcGVjdWxhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMSwgMC4xLCAwLjEpOyBpZiAoZW0pIG0uZW1pc3NpdmVDb2xvciA9IG0uZGlmZnVzZUNvbG9yLnNjYWxlKGVtKTsgcmV0dXJuIG07IH07XG4gICAgY29uc3QgbGVnSCA9IDAuMjIsIGJvZHlZID0gbGVnSCArIGQuaCAvIDI7XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGxnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbGVnJywgcyk7IGxnLnBhcmVudCA9IHRoaXMucmlnOyBsZy5wb3NpdGlvbi5zZXQoc3ggKiBkLncgKiAwLjIyLCBsZWdILCAwKTsgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2wnLCB7IGhlaWdodDogbGVnSCwgZGlhbWV0ZXI6IGQudyAqIDAuMjggfSwgcyk7IG0ucGFyZW50ID0gbGc7IG0ucG9zaXRpb24ueSA9IC1sZWdIIC8gMjsgbS5tYXRlcmlhbCA9IG1hdCgnIzRhMzgyNicpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5sZWdzLnB1c2gobGcpOyB9XG4gICAgdGhpcy5ib2R5ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDYXBzdWxlKCdib2R5JywgeyByYWRpdXM6IGQudyAvIDIsIGhlaWdodDogZC5oICsgZC53ICogMC40IH0sIHMpOyB0aGlzLmJvZHkucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMuYm9keS5wb3NpdGlvbi55ID0gYm9keVk7IHRoaXMuYm9keS5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IHRoaXMuYm9keS5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgaGVhZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdoZWFkJywgeyBkaWFtZXRlcjogZC5oZWFkICogMS41LCBzZWdtZW50czogMTIgfSwgcyk7IGhlYWQucGFyZW50ID0gdGhpcy5yaWc7IGhlYWQucG9zaXRpb24ueSA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAwLjU1OyBoZWFkLm1hdGVyaWFsID0gbWF0KGQuY29sKTsgaGVhZC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgZXllTSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2V5ZScsIHMpOyBleWVNLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IGV5ZU0uZW1pc3NpdmVDb2xvciA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7ICh0aGlzIGFzIGFueSkuZXllTSA9IGV5ZU07XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZScsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDAuMyB9LCBzKTsgZS5wYXJlbnQgPSB0aGlzLnJpZzsgZS5wb3NpdGlvbi5zZXQoc3ggKiBkLmhlYWQgKiAwLjMsIGhlYWQucG9zaXRpb24ueSArIDAuMDIsIGQuaGVhZCAqIDAuNjYpOyBlLm1hdGVyaWFsID0gZXllTTsgZS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAvLyB3ZWFwb24gcGl2b3QgYXQgdGhlIHNob3VsZGVyLCBvbiB0aGUgY2hhcmFjdGVyJ3MgcmlnaHQgKC14IGlzIGZpbmUgZm9yIGEgc3RhbmQtaW4pXG4gICAgdGhpcy53cCA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3dwJywgcyk7IHRoaXMud3AucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMud3AucG9zaXRpb24uc2V0KGQudyAqIDAuNiwgbGVnSCArIGQuaCAqIDAuODUsIDAuMDUpO1xuICAgIGNvbnN0IHdtID0gbWF0KCcjN2E1YTMwJyksIGlyb24gPSBtYXQoJyM5YWExYWQnKTtcbiAgICBjb25zdCBtayA9IChtOiBhbnksIGtpbmQ6IHN0cmluZywgZGltczogYW55LCBwb3M6IG51bWJlcltdLCBtdDogYW55KSA9PiB7IGNvbnN0IHggPSBraW5kID09PSAnYm94JyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQm94KCd3JywgZGltcywgcykgOiBraW5kID09PSAnY3lsJyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3cnLCBkaW1zLCBzKSA6IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCd3JywgZGltcywgcyk7IHgucGFyZW50ID0gdGhpcy53cDsgeC5wb3NpdGlvbi5zZXQocG9zWzBdLCBwb3NbMV0sIHBvc1syXSk7IHgubWF0ZXJpYWwgPSBtdDsgeC5pc1BpY2thYmxlID0gZmFsc2U7IHJldHVybiB4OyB9O1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ2RhZ2dlcicpIG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA1LCBoZWlnaHQ6IDAuMywgZGVwdGg6IDAuMDMgfSwgWzAsIC0wLjIsIDAuMTJdLCBpcm9uKTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdzaGllbGQnKSB7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA2LCBoZWlnaHQ6IDAuNSwgZGVwdGg6IDAuMDQgfSwgWzAsIC0wLjMsIDAuMTRdLCBpcm9uKTsgY29uc3Qgc2ggPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzaCcsIHsgaGVpZ2h0OiAwLjA1LCBkaWFtZXRlcjogMC41NSB9LCBzKTsgc2gucGFyZW50ID0gdGhpcy5yaWc7IHNoLnJvdGF0aW9uLnogPSBNYXRoLlBJIC8gMjsgc2gucG9zaXRpb24uc2V0KC1kLncgKiAwLjcsIGxlZ0ggKyBkLmggKiAwLjYsIDAuMDUpOyBzaC5tYXRlcmlhbCA9IG1hdCgnI2Q4YjY0YScpOyBzaC5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdtYWNlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuOSwgZGlhbWV0ZXI6IDAuMDggfSwgWzAsIC0wLjM1LCAwLjNdLCB3bSk7IG1rKDAsICdzcGgnLCB7IGRpYW1ldGVyOiAwLjQgfSwgWzAsIC0wLjg1LCAwLjRdLCBpcm9uKTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ2F4ZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjYsIGRpYW1ldGVyOiAwLjA1IH0sIFswLCAtMC4yLCAwLjE1XSwgd20pOyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4zMiwgaGVpZ2h0OiAwLjIyLCBkZXB0aDogMC4wNSB9LCBbMCwgLTAuNSwgMC4xNV0sIGlyb24pOyBjb25zdCBoYWlyID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignaGFpcicsIHsgaGVpZ2h0OiAwLjMsIGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogZC5oZWFkICogMS4yIH0sIHMpOyBoYWlyLnBhcmVudCA9IHRoaXMucmlnOyBoYWlyLnBvc2l0aW9uLnkgPSBoZWFkLnBvc2l0aW9uLnkgKyBkLmhlYWQgKiAwLjc1OyBoYWlyLm1hdGVyaWFsID0gbWF0KCcjYzIyYTFjJyk7IGhhaXIuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgdGhpcy50b3AgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMS4zNTsgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCBkLncgKiAwLjcpO1xuICAgIGNvbnN0IGxibCA9IGR5bihzLCAyNTYsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCAyNnB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmZpbGxTdHlsZSA9ICcjZmZmZmZmJzsgYy5zdHJva2VTdHlsZSA9ICcjMTExJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyBjLmZpbGxUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgfSk7XG4gICAgY29uc3QgbHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdsYmwnLCB7IHdpZHRoOiAxLjEsIGhlaWdodDogMC4yIH0sIHMpOyBscC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgbHAucG9zaXRpb24ueSA9IC0wLjE7IGxwLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMiAqIDAuMDsgbHAuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDsgY29uc3QgbG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdsbScsIHMpOyBsbS5kaWZmdXNlVGV4dHVyZSA9IGxibDsgbG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IGxtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IGxtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbHAubWF0ZXJpYWwgPSBsbTsgbHAuaXNQaWNrYWJsZSA9IGZhbHNlOyBscC5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjYyO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogdGhpcy50b3AsIGRpYW1ldGVyOiBNYXRoLm1heCgwLjcsIGQudyAqIDEuMykgfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCAvIDI7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgICAodGhpcyBhcyBhbnkpLnBhcnRzID0gW2xwXTsgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGxheSgnaWRsZScpO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgKHRoaXMgYXMgYW55KS5leWVNLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmJhc2UgPSBCQUxBTkNFLnN0YXIuc2NhbGVbc3QgLSAxXTsgY29uc3QgdCA9IFRJTlRbc3QgLSAxXTsgdGhpcy5ib2R5Lm1hdGVyaWFsLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoUEhbdGhpcy5zb3VsXS5jb2wpLnNjYWxlKDAuNzIpLm11bHRpcGx5KG5ldyBCQUJZTE9OLkNvbG9yMyhNYXRoLm1pbigxLCB0WzBdKSwgTWF0aC5taW4oMSwgdFsxXSksIE1hdGgubWluKDEsIHRbMl0pKSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IHRoaXMuZGVjby5maXQodGhpcy5iYXNlKTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRMZXZlbChuOiBudW1iZXIpIHsgdGhpcy5kZWNvLnNldExldmVsKG4pOyB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0TWFuYShmKTsgfVxuICBwdWxzZSgpIHsgdGhpcy5wdWxzZVQgPSAwLjE2OyB9XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQgPSAxKSB7IGlmIChzdGF0ZSA9PT0gdGhpcy5zdGF0ZSAmJiAoc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bicpKSByZXR1cm47IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5zdDAgPSB0aGlzLnQ7IHRoaXMuZHVyID0gc3RhdGUgPT09ICdhdHRhY2snID8gKEJBTEFOQ0Uuc3RhdHNbdGhpcy5zb3VsIGFzIFNvdWxJZF0uYW5pbUxlbiAvIHNwZWVkKSA6IHN0YXRlID09PSAnZGVhdGgnID8gMC42IDogc3RhdGUgPT09ICdzcGF3bicgPyAwLjkgOiAxLjA7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTsgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMudCArPSBkdDsgdGhpcy5kZWNvLnVwZGF0ZShkdCk7IGNvbnN0IHAgPSBNYXRoLm1pbigxLCAodGhpcy50IC0gdGhpcy5zdDApIC8gdGhpcy5kdXIpLCBSID0gdGhpcy5yaWcsIFcgPSB0aGlzLndwO1xuICAgIFIucG9zaXRpb24uc2V0KDAsIDAsIDApOyBSLnJvdGF0aW9uLnNldCgwLCAwLCAwKTsgUi5zY2FsaW5nLnNldEFsbCgxKTsgVy5yb3RhdGlvbi54ID0gLTAuNDsgdGhpcy5sZWdzLmZvckVhY2goKGwpID0+IChsLnJvdGF0aW9uLnggPSAwKSk7XG4gICAgaWYgKHRoaXMuc3RhdGUgPT09ICdpZGxlJykgUi5wb3NpdGlvbi55ID0gTWF0aC5zaW4odGhpcy50ICogMi4yKSAqIDAuMDEyO1xuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdydW4nKSB7IGNvbnN0IHcgPSB0aGlzLnQgKiAxMDsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odykpICogMC4wNzsgUi5yb3RhdGlvbi54ID0gMC4yOyB0aGlzLmxlZ3NbMF0ucm90YXRpb24ueCA9IE1hdGguc2luKHcpICogMC45OyB0aGlzLmxlZ3NbMV0ucm90YXRpb24ueCA9IC1NYXRoLnNpbih3KSAqIDAuOTsgVy5yb3RhdGlvbi54ID0gLTAuNCArIE1hdGguc2luKHcpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2F0dGFjaycpIHsgY29uc3QgayA9IHAgPCAwLjQgPyAtMi40ICogKHAgLyAwLjQpIDogLTIuNCArIDMuNCAqIE1hdGgubWluKDEsIChwIC0gMC40KSAvIDAuMjUpOyBXLnJvdGF0aW9uLnggPSBrOyBSLnBvc2l0aW9uLnogPSAwLjE0ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyBSLnJvdGF0aW9uLnggPSAwLjE1ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgeyBjb25zdCBlID0gcCAqIHAgKiAoMyAtIDIgKiBwKTsgUi5zY2FsaW5nLnNldEFsbCgwLjAxICsgMC45OSAqIGUpOyBSLnBvc2l0aW9uLnkgPSAoZSAtIDEpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2RlYXRoJykgeyBjb25zdCBlID0gcCAqIHA7IFIucm90YXRpb24ueCA9IC1NYXRoLlBJIC8gMiAqIGU7IFIucG9zaXRpb24ueSA9IDAuMjUgKiBlOyBSLnBvc2l0aW9uLnogPSAtMC4yICogZTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odGhpcy50ICogNykpICogMC4xNTsgVy5yb3RhdGlvbi54ID0gLTIuNjsgfVxuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVZpc3VhbChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcik6IFVuaXRWaXN1YWwge1xuICBjb25zdCBjZmcgPSBBLnRyaXBvW3NvdWxdO1xuICByZXR1cm4gY2ZnID8gbmV3IFRyaXBvVmlzdWFsKEEsIGNmZywgc291bCwgdGVhbSwgc3RhcikgOiBuZXcgUGxhY2Vob2xkZXJWaXN1YWwoQSwgc291bCwgdGVhbSwgc3Rhcik7XG59XG5leHBvcnQgY29uc3QgaXNUcmlwbyA9IChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCkgPT4gISFBLnRyaXBvW3NvdWxdO1xuIiwgIi8vIFRoZSBnYW1lJ3MgaWNvbiBzZXQgKGN1c3RvbSBhcnQsIHNsaWNlZCBmcm9tIFBpcGVsaW5lL2ljb25zL3NoZWV0XyoucG5nIGJ5IFBpcGVsaW5lL2JsZW5kZXIvc2xpY2VfaWNvbnMucHkgLT4gZG9jcy9hc3NldHMvaWNvbnMvKi5wbmcpLlxuLy8gU2hhcmVkIGJ5IHRoZSAzRCBnYW1lJ3MgRE9NICh2YW5pbGxhKSBhbmQgdGhlIEFuZ3VsYXIgc2hlbGwuIE5vIGVtb2ppIGFueXdoZXJlOiBldmVyeSBnbHlwaCBpbiB0aGUgVUkgaXMgb25lIG9mIHRoZXNlIGltYWdlcy5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUmFyaXR5IH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5cbmV4cG9ydCB0eXBlIEljb25OYW1lID1cbiAgfCAnaG9tZScgfCAnc291bHMnIHwgJ3Nob3AnIHwgJ3NldHRpbmdzJyB8ICdjbG9zZSdcbiAgfCAnaGVhcnQnIHwgJ2hlYXJ0X2VtcHR5JyB8ICdkb21pbmlvbicgfCAnc3RhcicgfCAnbG9jaydcbiAgfCAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJ1xuICB8ICdnZW1fY29tbW9uJyB8ICdnZW1fcmFyZScgfCAnZ2VtX2VwaWMnIHwgJ2dlbV9sZWdlbmRhcnknXG4gIHwgJ211c2ljJyB8ICdzb3VuZF9vbicgfCAnc291bmRfb2ZmJyB8ICd1cGdyYWRlJyB8ICdzd2FwJ1xuICB8ICdtZXJnZScgfCAncmVtb3ZlJyB8ICdjaGVjaycgfCAnYmFjaycgfCAnaW5mbycgfCAnZ29sZCc7XG5cbi8qKiBSZWxhdGl2ZSB0byB0aGUgcGFnZSwgc28gaXQgd29ya3Mgb24gR2l0SHViIFBhZ2VzIHVuZGVyIC9yZXBvLW5hbWUvLiAqL1xuZXhwb3J0IGNvbnN0IGljb25VcmwgPSAobjogSWNvbk5hbWUpOiBzdHJpbmcgPT4gJ2Fzc2V0cy9pY29ucy8nICsgbiArICcucG5nJztcbi8qKiBBbiA8aW1nPiBhcyBhbiBIVE1MIHN0cmluZywgZm9yIHRoZSBnYW1lJ3MgaGFuZC1idWlsdCBET00uICovXG5leHBvcnQgY29uc3QgaWNvbkltZyA9IChuOiBJY29uTmFtZSwgY2xzID0gJ2ljJyk6IHN0cmluZyA9PiBgPGltZyBjbGFzcz1cIiR7Y2xzfVwiIHNyYz1cIiR7aWNvblVybChuKX1cIiBhbHQ9XCJcIiBkcmFnZ2FibGU9XCJmYWxzZVwiPmA7XG5cbi8qKiBFYWNoIFNvdWwgaXMgc2hvd24gYnkgaXRzIHdlYXBvbi9yb2xlIGljb24gdW50aWwgcmVhbCBwb3J0cmFpdHMgZXhpc3QuICovXG5leHBvcnQgY29uc3QgU09VTF9JQ09OOiBSZWNvcmQ8U291bElkLCBJY29uTmFtZT4gPSB7IHdhcnJpb3I6ICd3YXJyaW9yJywgYXJjaGVyOiAnYXJjaGVyJywgZ29ibGluOiAnZ29ibGluJywga25pZ2h0OiAna25pZ2h0Jywgb2dyZTogJ29ncmUnLCBiYXJiYXJpYW46ICdiYXJiYXJpYW4nIH07XG5leHBvcnQgY29uc3QgUkFSSVRZX0dFTTogUmVjb3JkPFJhcml0eSwgSWNvbk5hbWU+ID0geyBjb21tb246ICdnZW1fY29tbW9uJywgcmFyZTogJ2dlbV9yYXJlJywgZXBpYzogJ2dlbV9lcGljJywgbGVnZW5kYXJ5OiAnZ2VtX2xlZ2VuZGFyeScgfTtcblxuLyoqIFBhY2sgdGllcnMgYXJlIHNob3duIGFzIHNrdWxscyAobmV2ZXIgc3RhcnM6IHN0YXJzIG1lYW4gYW4gaW4tcnVuIG1lcmdlIGxldmVsKS4gKi9cbmV4cG9ydCBjb25zdCBza3VsbEltZ3MgPSAobjogbnVtYmVyLCBjbHMgPSAnc2snKTogc3RyaW5nID0+IGljb25JbWcoJ3NvdWxzJywgY2xzKS5yZXBlYXQoTWF0aC5tYXgoMSwgbikpO1xuZXhwb3J0IGNvbnN0IGhlYXJ0c0h0bWwgPSAoaGVhcnRzOiBudW1iZXIsIG1heCA9IDMpOiBzdHJpbmcgPT4gaWNvbkltZygnaGVhcnQnLCAnaWMgaGVhcnQnKS5yZXBlYXQoTWF0aC5tYXgoMCwgaGVhcnRzKSkgKyBpY29uSW1nKCdoZWFydF9lbXB0eScsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBtYXggLSBoZWFydHMpKTtcbi8qKiBBIG51bWJlciB3aXRoIHRob3VzYW5kcyBzZXBhcmF0b3JzIChnb2xkIGdldHMgYmlnKTogMTI1MDAgLT4gXCIxMiw1MDBcIi4gKi9cbmV4cG9ydCBjb25zdCBmbXQgPSAobjogbnVtYmVyKTogc3RyaW5nID0+IE1hdGgucm91bmQobikudG9Mb2NhbGVTdHJpbmcoJ2VuLVVTJyk7XG4iLCAiLy8gUmVuZGVyZWQgU291bCBwb3J0cmFpdHMgKFBpcGVsaW5lL2JsZW5kZXIvcmVuZGVyX3BvcnRyYWl0LnB5LCBoZWFkLWFuZC1zaG91bGRlcnMgbW9kZSksIHNoYXJlZCBieSB0aGUgQW5ndWxhciBwYWdlcyBhbmQgdGhlIGJhdHRsZSBzY3JlZW4uXG4vLyBTb3VscyB3aXRob3V0IGEgcG9ydHJhaXQgeWV0IGZhbGwgYmFjayB0byB0aGVpciByb2xlIGljb24gb24gYSBjb2xvdXJlZCBjYXJkLlxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgUkFSSVRZX09GIH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJhcml0eSB9IGZyb20gJy4uL2NvcmUvcGFja3MudHMnO1xuaW1wb3J0IHsgU09VTF9JQ09OLCBpY29uVXJsIH0gZnJvbSAnLi9pY29ucy50cyc7XG5cbmNvbnN0IFBPUlRSQUlUOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHN0cmluZz4+ID0geyB3YXJyaW9yOiAnYXNzZXRzL3BvcnRyYWl0cy93YXJyaW9yX2hlYWQucG5nJywgYXJjaGVyOiAnYXNzZXRzL3BvcnRyYWl0cy9hcmNoZXJfaGVhZC5wbmcnLCBvZ3JlOiAnYXNzZXRzL3BvcnRyYWl0cy9vZ3JlX2hlYWQucG5nJywgZ29ibGluOiAnYXNzZXRzL3BvcnRyYWl0cy9nb2JsaW5faGVhZC5wbmcnLCBrbmlnaHQ6ICdhc3NldHMvcG9ydHJhaXRzL2tuaWdodF9oZWFkLnBuZycsIGJhcmJhcmlhbjogJ2Fzc2V0cy9wb3J0cmFpdHMvYmFyYmFyaWFuX2hlYWQucG5nJyB9O1xuY29uc3QgUkFSSVRZX0hFWDogUmVjb3JkPFJhcml0eSwgc3RyaW5nPiA9IHsgY29tbW9uOiAnI2I4YzBjYycsIHJhcmU6ICcjNGFhM2ZmJywgZXBpYzogJyNiMjZiZmYnLCBsZWdlbmRhcnk6ICcjZmZjYzMzJyB9O1xuZXhwb3J0IGNvbnN0IGhhc0FydCA9IChzOiBTb3VsSWQpOiBib29sZWFuID0+ICEhUE9SVFJBSVRbc107XG5leHBvcnQgY29uc3Qgc291bEFydCA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4gUE9SVFJBSVRbc10gPz8gaWNvblVybChTT1VMX0lDT05bc10pO1xuZXhwb3J0IGNvbnN0IHJhcml0eUNvbG9yID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiBSQVJJVFlfSEVYW1JBUklUWV9PRltzXV07XG4vKiogQ2FyZCBiYWNrZHJvcCBmb3IgYSBwb3J0cmFpdDogYSBnbG93IGluIHRoZSByYXJpdHkgY29sb3VyIGJlaGluZCB0aGUgZmlndXJlLCBvbiBhIGRhcmsgY3J5cHQgZ3JhZGllbnQuICovXG5leHBvcnQgY29uc3QgYXJ0QmcgPSAoczogU291bElkKTogc3RyaW5nID0+IHsgY29uc3QgYyA9IHJhcml0eUNvbG9yKHMpOyByZXR1cm4gYHJhZGlhbC1ncmFkaWVudChlbGxpcHNlIGF0IDUwJSA4MCUsICR7Y303NyAwJSwgJHtjfTI2IDQ2JSwgdHJhbnNwYXJlbnQgNzQlKSwgbGluZWFyLWdyYWRpZW50KCMyYjI0NDQsIzBkMDkxOSlgOyB9O1xuIiwgIi8vIERPTSB1c2VyIGludGVyZmFjZTogdG9wIGJhciwgZW5lbXkgcHJldmlldywgaGFuZCBvZiBjYXJkcywgYnV0dG9ucywgZHJhZnQgb3ZlcmxheSwgdG9hc3RzIGFuZCB0aGUgZGVidWcgcGFuZWwuXG5pbXBvcnQgeyBCQUxBTkNFLCBST0xFX1RFWFQsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgeyBpc0VuZGxlc3MgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY29zdCwgZG9taW5pb25GcmVlLCBkb21pbmlvblVzZWQsIHN0YWdlV2F2ZXMgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGVuZW15V2F2ZSwgcHJldmlld1RleHQgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgeyBhcnRCZywgaGFzQXJ0LCByYXJpdHlDb2xvciwgc291bEFydCB9IGZyb20gJy4uL3VpL3BvcnRyYWl0cy50cyc7XG5pbXBvcnQgeyBTT1VMX0lDT04sIGhlYXJ0c0h0bWwsIGZtdCwgaWNvbkltZywgaWNvblVybCwgc2t1bGxJbWdzIH0gZnJvbSAnLi4vdWkvaWNvbnMudHMnO1xuaW1wb3J0IHsgZGVzY3JpYmVVbmxvY2sgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcblxuY29uc3QgcG9ydHJhaXRIdG1sID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiBgPGRpdiBjbGFzcz1cInB0XCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiR7YXJ0Qmcocyl9XCI+PGltZyBzcmM9XCIke3NvdWxBcnQocyl9XCIgYWx0PVwiXCIgZHJhZ2dhYmxlPVwiZmFsc2VcIj48L2Rpdj5gO1xuY29uc3QgSUNPTiA9IE9iamVjdC5mcm9tRW50cmllcyhTT1VMUy5tYXAoKHMpID0+IFtzLCBpY29uSW1nKFNPVUxfSUNPTltzXSwgJ2ljJyldKSkgYXMgUmVjb3JkPFNvdWxJZCwgc3RyaW5nPjtcbmNvbnN0ICQgPSAoaWQ6IHN0cmluZykgPT4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpITtcbmNvbnN0IHN0YXJzID0gKG46IG51bWJlcikgPT4gJ1x1MjYwNScucmVwZWF0KG4pO1xuXG5leHBvcnQgY2xhc3MgVWkge1xuICBwcml2YXRlIHRvYXN0VCA9IDA7IHByaXZhdGUgZGJnOiBIVE1MRWxlbWVudDsgcHJpdmF0ZSBvZGRzID0gJyc7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgZzogYW55KSB7XG4gICAgJCgnYnRuSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgJCgnYnRuQmF0dGxlJykub25jbGljayA9ICgpID0+IGcuc3RhcnRCYXR0bGUoKTsgJCgnYnRuU3dhcCcpLm9uY2xpY2sgPSAoKSA9PiBnLnRvZ2dsZVN3YXAoKTtcbiAgICAkKCdidG5SZW1vdmUnKS5vbmNsaWNrID0gKCkgPT4gZy5yZW1vdmVTZWxlY3RlZCgpO1xuICAgICQoJ2J0blNwZWVkJykub25jbGljayA9ICgpID0+IGcuc2V0U3BlZWQoZy50aW1lU2NhbGUgPiAxID8gMSA6IDIpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0Q2FtTW9kZShiLmRhdGFzZXQuY2FtISkpKTtcbiAgICAkKCdnZWFyJykub25jbGljayA9ICgpID0+IHsgdGhpcy5kYmcuY2xhc3NMaXN0LnRvZ2dsZSgnb3BlbicpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgY29uc3Qgc25kID0gKCkgPT4geyAkKCdidG5NdXNpYycpLmNsYXNzTGlzdC50b2dnbGUoJ29mZicsICFhdWRpby5tdXNpYyk7ICQoJ2J0blNmeCcpLmNsYXNzTGlzdC50b2dnbGUoJ29mZicsICFhdWRpby5zZngpOyBjb25zdCBzaSA9ICQoJ2J0blNmeCcpLnF1ZXJ5U2VsZWN0b3IoJ2ltZycpOyBpZiAoc2kpIHNpLnNyYyA9IGljb25VcmwoYXVkaW8uc2Z4ID8gJ3NvdW5kX29uJyA6ICdzb3VuZF9vZmYnKTsgfTtcbiAgICAkKCdidG5NdXNpYycpLm9uY2xpY2sgPSAoKSA9PiB7IGF1ZGlvLnNldE11c2ljKCFhdWRpby5tdXNpYyk7IHNuZCgpOyB9OyAkKCdidG5TZngnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRTZngoIWF1ZGlvLnNmeCk7IHNuZCgpOyB9O1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCduZWNyby1zZXR0aW5ncycsIHNuZCk7IHNuZCgpO1xuICAgIHRoaXMuZGJnID0gJCgnZGVidWcnKTsgaWYgKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ2RlYnVnJykpIHRoaXMuZGJnLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgICB0aGlzLnJlbmRlckRlYnVnKCk7XG4gIH1cblxuICAvKiogVGhlIE5lY3JvbWFuY2VyIGp1c3QgbG9zdCBhIGhlYXJ0OiBtYWtlIHRoZSBoZWFydHMgYnVtcC4gKi9cbiAgcHVsc2VIZWFydHMoKSB7IGNvbnN0IGggPSAkKCdoZWFydHMnKTsgaC5jbGFzc0xpc3QucmVtb3ZlKCdodXJ0Jyk7IHZvaWQgaC5vZmZzZXRXaWR0aDsgaC5jbGFzc0xpc3QuYWRkKCdodXJ0Jyk7IH1cbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgY29uc3QgdCA9ICQoJ3RvYXN0Jyk7IHQudGV4dENvbnRlbnQgPSBtc2c7IHQuY2xhc3NMaXN0LmFkZCgnc2hvdycpOyBjbGVhclRpbWVvdXQodGhpcy50b2FzdFQpOyB0aGlzLnRvYXN0VCA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHQuY2xhc3NMaXN0LnJlbW92ZSgnc2hvdycpLCAzNjAwKTsgfVxuXG4gIHJlbmRlcigpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBzID0gZy5zLCBwaCA9IGcucGhhc2UsIGJ1aWxkID0gcGggPT09ICdidWlsZCc7XG4gICAgJCgnaGVhcnRzJykuaW5uZXJIVE1MID0gaGVhcnRzSHRtbChzLmhlYXJ0cyk7XG4gICAgJCgnd2F2ZScpLnRleHRDb250ZW50ID0gaXNFbmRsZXNzKCkgPyBgV2F2ZSAke3Mud2F2ZX1gIDogYFdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX1gO1xuICAgIGNvbnN0IHVzZWQgPSBkb21pbmlvblVzZWQocyk7ICQoJ2RvbScpLnRleHRDb250ZW50ID0gYCR7dXNlZH0vJHtzLmNhcH1gOyAoJCgnZG9tZmlsbCcpIGFzIEhUTUxFbGVtZW50KS5zdHlsZS53aWR0aCA9IE1hdGgubWluKDEwMCwgKHVzZWQgLyBzLmNhcCkgKiAxMDApICsgJyUnO1xuICAgIC8vIGVuZW15IHByZXZpZXc6IHdoYXQgaXMgY29taW5nLCBuZXZlciB3aGVyZVxuICAgIGNvbnN0IHB2ID0gcHJldmlld1RleHQoZW5lbXlXYXZlKHMud2F2ZSwgZy5zZWVkKSk7XG4gICAgJCgnZW5lbXknKS5pbm5lckhUTUwgPSBgPGI+TmV4dCBlbmVtaWVzPC9iPmAgKyBwdi5tYXAoKHApID0+IGA8ZGl2IGNsYXNzPVwiZXJvd1wiPjxzcGFuPiR7SUNPTltwLnNvdWwgYXMgU291bElkXX08L3NwYW4+PHNwYW4+JHtTT1VMX05BTUVbcC5zb3VsIGFzIFNvdWxJZF19JHsocCBhcyBhbnkpLmJvc3MgPyAnIDxiIHN0eWxlPVwiY29sb3I6I2ZmN2I2YVwiPkJPU1M8L2I+JyA6ICcnfTwvc3Bhbj48c3BhbiBjbGFzcz1cInhcIj5cdTAwRDcke3AuY291bnR9PC9zcGFuPjxzcGFuIGNsYXNzPVwic3RcIj4ke3N0YXJzKHAuc3Rhcil9PC9zcGFuPjwvZGl2PmApLmpvaW4oJycpICsgYDxkaXYgY2xhc3M9XCJoaW50XCI+UG9zaXRpb25zIHN0YXkgaGlkZGVuIHVudGlsIHRoZSBiYXR0bGUuPC9kaXY+YDtcbiAgICAvLyBoYW5kXG4gICAgY29uc3QgaGFuZCA9ICQoJ2hhbmQnKTsgaGFuZC5pbm5lckhUTUwgPSAnJztcbiAgICBzLmhhbmQuZm9yRWFjaCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IHtcbiAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGNvbnN0IHNlbCA9IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiBnLnNlbC5pZHggPT09IGk7IGNvbnN0IGFmZm9yZCA9IGNhblN1bW1vbihzLCBpKSwgY2FuTWVyZ2UgPSBzLnVuaXRzLnNvbWUoKHU6IGFueSkgPT4gY2FuTWVyZ2VGcm9tSGFuZChzLCBpLCB1LmlkKSksIHVzYWJsZSA9IGFmZm9yZCB8fCBjYW5NZXJnZTtcbiAgICAgIGNvbnN0IGFydCA9IGhhc0FydChzb3VsKTsgZWwuY2xhc3NOYW1lID0gJ2NhcmQnICsgKGFydCA/ICcgYXJ0JyA6ICcnKSArIChzZWwgPyAnIHNlbCcgOiAnJykgKyAoIXVzYWJsZSAmJiAhZy5zd2FwTW9kZSA/ICcgZGlzJyA6ICcnKSArIChnLnN3YXBNb2RlID8gJyBzd2FwJyA6ICcnKTtcbiAgICAgIGNvbnN0IHRhZyA9IGFmZm9yZCA/IGA8c3BhbiBjbGFzcz1cIm9rXCI+U3VtbW9uPC9zcGFuPmAgOiBjYW5NZXJnZSA/ICc8c3BhbiBjbGFzcz1cIm9rIG1nXCI+TWVyZ2Ugb25seTwvc3Bhbj4nIDogJzxzcGFuIGNsYXNzPVwibm9cIj5ObyByb29tPC9zcGFuPic7XG4gICAgICBpZiAoYXJ0KSBlbC5zdHlsZS5ib3JkZXJDb2xvciA9IHJhcml0eUNvbG9yKHNvdWwpO1xuICAgICAgZWwuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PiR7YXJ0ID8gcG9ydHJhaXRIdG1sKHNvdWwpIDogSUNPTltzb3VsXSArIGA8ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj5gfTxkaXYgY2xhc3M9XCJjc1wiPiR7dGFnfTwvZGl2PmA7IGVsLnRpdGxlID0gUk9MRV9URVhUW3NvdWxdICsgKGFmZm9yZCA/ICcnIDogY2FuTWVyZ2UgPyAnIC0gRG9taW5pb24gaXMgZnVsbCwgYnV0IHlvdSBjYW4gbWVyZ2UgaXQgaW50byB5b3VyIG1hdGNoaW5nIDEtc3RhciB1bml0LicgOiAnIC0gTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLicpO1xuICAgICAgZWwub25jbGljayA9ICgpID0+IGcub25DYXJkKGkpOyBoYW5kLmFwcGVuZENoaWxkKGVsKTtcbiAgICB9KTtcbiAgICBpZiAoIXMuaGFuZC5sZW5ndGgpIGhhbmQuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9XCJlbXB0eVwiPk5vIGNhcmRzIGluIGhhbmQ8L2Rpdj4nO1xuICAgIC8vIGJ1dHRvbnNcbiAgICAoJCgnYnRuQmF0dGxlJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQpLmRpc2FibGVkID0gIWJ1aWxkIHx8ICFzLnVuaXRzLmxlbmd0aDtcbiAgICBjb25zdCBzdyA9ICQoJ2J0blN3YXAnKSBhcyBIVE1MQnV0dG9uRWxlbWVudDsgc3cuZGlzYWJsZWQgPSAhYnVpbGQgfHwgcy5kaXNjYXJkVXNlZDsgc3cuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBnLnN3YXBNb2RlKTsgc3cudGV4dENvbnRlbnQgPSBzLmRpc2NhcmRVc2VkID8gJ1N3YXAgdXNlZCcgOiBnLnN3YXBNb2RlID8gJ1N3YXA6IHBpY2sgYSBjYXJkIG9yIHVuaXQnIDogJ1N3YXAgKDEvcm91bmQpJztcbiAgICBjb25zdCBzZWxVID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ3VuaXQnID8gcy51bml0cy5maW5kKCh1OiBhbnkpID0+IHUuaWQgPT09IGcuc2VsLmlkKSA6IG51bGw7XG4gICAgY29uc3QgcGFydG5lciA9IHNlbFUgJiYgcy51bml0cy5zb21lKChvOiBhbnkpID0+IGNhbk1lcmdlRGVwbG95ZWQoc2VsVSwgbykpO1xuICAgICQoJ3VuaXRwYW5lbCcpLnN0eWxlLmRpc3BsYXkgPSBidWlsZCAmJiBzZWxVID8gJ2ZsZXgnIDogJ25vbmUnO1xuICAgICQoJ2J0blJlbW92ZScpLnRleHRDb250ZW50ID0gZy5jb25maXJtUmVtb3ZlID8gJ0NvbmZpcm0gcmVtb3ZlJyA6ICdSZW1vdmUnO1xuICAgICQoJ2luZm8nKS50ZXh0Q29udGVudCA9IGJ1aWxkID8gKGcuc3dhcE1vZGUgPyAnU1dBUDogdGFwIGEgaGFuZCBjYXJkIHRvIGRpc2NhcmQgaXQsIG9yIHRhcCBhIHVuaXQgeW91IGRpZCBub3Qgc3VtbW9uIHRoaXMgcm91bmQgdG8gc2VsbCBpdC4gWW91IGRyYXcgYSBkaWZmZXJlbnQgU291bC4nXG4gICAgICA6IHNlbFUgPyBgJHtTT1VMX05BTUVbc2VsVS5zb3VsIGFzIFNvdWxJZF19ICR7c3RhcnMoc2VsVS5zdGFyKX0gIFx1MjAyMiAgJHtST0xFX1RFWFRbc2VsVS5zb3VsIGFzIFNvdWxJZF19ICAke3BhcnRuZXIgPyAnXHUyMDIyIFRhcCB0aGUgbWF0Y2hpbmcgdW5pdCB0byBtZXJnZSBpbnRvIGEgc3Ryb25nZXIgc3Rhci4nIDogJyd9YFxuICAgICAgOiBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAnY2FyZCcgPyBgJHtTT1VMX05BTUVbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX06ICR7Uk9MRV9URVhUW3MuaGFuZFtnLnNlbC5pZHhdIGFzIFNvdWxJZF19ICBcdTIwMjIgIGAgKyAoKCkgPT4geyBjb25zdCBpID0gZy5zZWwuaWR4LCBzbSA9IGNhblN1bW1vbihzLCBpKSwgbWcgPSBzLnVuaXRzLnNvbWUoKHU6IGFueSkgPT4gY2FuTWVyZ2VGcm9tSGFuZChzLCBpLCB1LmlkKSk7IHJldHVybiBzbSAmJiBtZyA/ICdUYXAgYSBncmVlbiB0aWxlIHRvIHN1bW1vbiwgb3IgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiBzbSA/ICdUYXAgYSBncmVlbiB0aWxlIHRvIHN1bW1vbi4nIDogbWcgPyAnRG9taW5pb24gaXMgZnVsbDogdGFwIGEgZ2xvd2luZyBwdXJwbGUgdW5pdCB0byBtZXJnZSBpdCBpbi4nIDogJ05vdCBlbm91Z2ggZnJlZSBEb21pbmlvbiB0byBzdW1tb24gdGhpcy4nOyB9KSgpIDogJ1RhcCBhIGNhcmQsIHRoZW4gYSB0aWxlLiBUYXAgYSB1bml0IHRvIG1lcmdlLCBtb3ZlIG9yIHJlbW92ZSBpdC4nKVxuICAgICAgOiBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdCYXR0bGUhIFVuaXRzIGZpZ2h0IG9uIHRoZWlyIG93bi4nIDogJyc7XG4gICAgJCgnc3BlZWQnKS5zdHlsZS5kaXNwbGF5ID0gcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnZmxleCcgOiAnbm9uZSc7XG4gICAgY29uc3QgZmFzdCA9IGcuc3BlZWRVbmxvY2tlZCgpOyBpZiAoIWZhc3QgJiYgZy50aW1lU2NhbGUgPiAxKSBnLnRpbWVTY2FsZSA9IDE7XG4gICAgY29uc3Qgc2IgPSAkKCdidG5TcGVlZCcpOyBzYi5zdHlsZS5kaXNwbGF5ID0gZmFzdCA/ICcnIDogJ25vbmUnOyBzYi50ZXh0Q29udGVudCA9IGcudGltZVNjYWxlICsgJ3gnOyBzYi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGcudGltZVNjYWxlID4gMSk7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgYi5kYXRhc2V0LmNhbSA9PT0gZy5jYW1Nb2RlKSk7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QudG9nZ2xlKCdpbmJhdHRsZScsIHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nKTsgYXVkaW8uc2V0TW9kZShwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdiYXR0bGUnIDogJ2J1aWxkJyk7XG4gICAgLy8gb3ZlcmxheVxuICAgIGNvbnN0IG92ID0gJCgnb3ZlcmxheScpOyBvdi5jbGFzc05hbWUgPSAnJzsgb3YuaW5uZXJIVE1MID0gJyc7XG4gICAgaWYgKHBoID09PSAnZHJhZnQnICYmIGcuZHJhZnQpIHtcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+VmljdG9yeSBEcmFmdDwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPldhdmUgY2xlYXJlZC4gRG9taW5pb24gaXMgbm93ICR7cy5jYXB9LiR7Zy5sYXN0R29sZCA/IGAgPGIgc3R5bGU9XCJjb2xvcjojZmZkMjRhXCI+KyR7Zm10KGcubGFzdEdvbGQpfTwvYj4gJHtpY29uSW1nKCdnb2xkJyl9YCA6ICcnfSBLZWVwIG9uZTo8L2Rpdj48ZGl2IGNsYXNzPVwicm93XCI+JHtnLmRyYWZ0Lm1hcCgoc291bDogU291bElkLCBpOiBudW1iZXIpID0+IGA8ZGl2IGNsYXNzPVwiY2FyZCBiaWcke2hhc0FydChzb3VsKSA/ICcgYXJ0JyA6ICcnfVwiIGRhdGEtaT1cIiR7aX1cIiR7aGFzQXJ0KHNvdWwpID8gYCBzdHlsZT1cImJvcmRlci1jb2xvcjoke3Jhcml0eUNvbG9yKHNvdWwpfVwiYCA6ICcnfT48ZGl2IGNsYXNzPVwiY29zdFwiPiR7Y29zdChzb3VsLCAxKX08L2Rpdj4ke2hhc0FydChzb3VsKSA/IHBvcnRyYWl0SHRtbChzb3VsKSA6IElDT05bc291bF19PGRpdiBjbGFzcz1cIm5tXCI+JHtTT1VMX05BTUVbc291bF19PC9kaXY+PGRpdiBjbGFzcz1cInJvbGVcIj4ke1JPTEVfVEVYVFtzb3VsXX08L2Rpdj48L2Rpdj5gKS5qb2luKCcnKX08L2Rpdj48L2Rpdj5gO1xuICAgICAgb3YucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJy5jYXJkJykuZm9yRWFjaCgoYykgPT4gKGMub25jbGljayA9ICgpID0+IGcucGlja0RyYWZ0KCtjLmRhdGFzZXQuaSEpKSk7XG4gICAgfSBlbHNlIGlmIChwaCA9PT0gJ3dvbicgfHwgcGggPT09ICdsb3N0Jykge1xuICAgICAgY29uc3QgcncgPSBwaCA9PT0gJ3dvbicgPyBnLnJld2FyZCA6IG51bGwsIHNrID0gKG46IG51bWJlcikgPT4gc2t1bGxJbWdzKG4pO1xuICAgICAgY29uc3QgdW5sb2NrSHRtbCA9IHJ3ICYmIHJ3LnVubG9ja2VkICYmIHJ3LnVubG9ja2VkLmxlbmd0aCA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojN2VmMmM4O2ZvbnQtd2VpZ2h0OjcwMFwiPiR7aWNvbkltZygnY2hlY2snKX0gVW5sb2NrZWQ6ICR7cncudW5sb2NrZWQubWFwKChrOiBzdHJpbmcpID0+IGRlc2NyaWJlVW5sb2NrKGspKS5qb2luKCcgXFx1MDBiNyAnKX08L2Rpdj5gIDogJyc7XG4gICAgICBjb25zdCBnb2xkSHRtbCA9IGcucnVuR29sZCA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7aWNvbkltZygnZ29sZCcpfSBHb2xkIGVhcm5lZCB0aGlzIHJ1bjogJHtmbXQoZy5ydW5Hb2xkKX08L2Rpdj5gIDogJyc7XG4gICAgICBjb25zdCBkciA9IHBoID09PSAnd29uJyAmJiBnLmRhaWx5ID8gZy5kYWlseVJld2FyZCA6IG51bGw7XG4gICAgICBjb25zdCBkYWlseUh0bWwgPSBnLmRhaWx5ID8gKGRyID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtkci5wYWNrID8gYCR7aWNvbkltZygnc2hvcCcpfSBEYWlseSBjb21wbGV0ZSEgRGF5ICR7ZHIuc3RyZWFrfSBpbiBhIHJvdzogYSAke3NrKGRyLnBhY2sudGllcil9IFNvdWwgUGFjayBhbmQgJHtmbXQoZHIuZ29sZCl9ICR7aWNvbkltZygnZ29sZCcpfS5gIDogJ0RhaWx5IGNvbXBsZXRlIGFnYWluLiBUaGUgcmV3YXJkIGNvbWVzIG9uY2UgcGVyIGRheTogc2VlIHlvdSB0b21vcnJvdyEnfTwvZGl2PmAgOiAnJykgOiAnJztcbiAgICAgIGNvbnN0IHJld2FyZEh0bWwgPSBnb2xkSHRtbCArIGRhaWx5SHRtbCArIHVubG9ja0h0bWwgKyAocncgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke3J3LnBhY2sgPyAocncuZmlyc3QgPyBgJHtpY29uSW1nKCdzaG9wJyl9IEZpcnN0IGNsZWFyISBZb3UgZWFybmVkIGEgJHtzayhydy5wYWNrLnRpZXIpfSBTb3VsIFBhY2suYCA6IGAke2ljb25JbWcoJ3Nob3AnKX0gUmVwbGF5IHJld2FyZDogYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gKSA6IGBSZXBsYXkgcHJvZ3Jlc3MgJHtydy5yZXBsYXlNZXRlcn0vJHtydy5yZXBsYXlOZWVkZWR9IHRvd2FyZCBhIFNvdWwgUGFjay5gfTwvZGl2PmAgOiAnJyk7XG4gICAgICBpZiAocGggPT09ICdsb3N0JyAmJiBpc0VuZGxlc3MoKSAmJiBnLmVuZGxlc3MpIHsgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBlbmQgb2YgYW4gZW5kbGVzcyBydW46IGhvdyBkZWVwLCBhbnkgcmVjb3JkLCBwYWNrcyBlYXJuZWRcbiAgICAgICAgY29uc3QgZSA9IGcuZW5kbGVzcywgcmVjID0gZS5jbGVhcmVkID4gZS5zdGFydEJlc3Q7XG4gICAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+UnVuIG92ZXI8L2gyPjxkaXYgY2xhc3M9XCJzdWJcIj5Zb3UgY2xlYXJlZCAke2UuY2xlYXJlZH0gd2F2ZSR7ZS5jbGVhcmVkID09PSAxID8gJycgOiAncyd9LiAke3JlYyA/ICc8YiBzdHlsZT1cImNvbG9yOiNmZmQyNGFcIj5OZXcgYmVzdCBkZXB0aCE8L2I+JyA6ICdCZXN0OiB3YXZlICcgKyBNYXRoLm1heChlLnN0YXJ0QmVzdCwgZS5jbGVhcmVkKSArICcuJ308L2Rpdj4ke2cucnVuR29sZCA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7aWNvbkltZygnZ29sZCcpfSBHb2xkIGVhcm5lZCB0aGlzIHJ1bjogJHtmbXQoZy5ydW5Hb2xkKX08L2Rpdj5gIDogJyd9JHtlLnBhY2tzID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdzaG9wJyl9ICR7ZS5wYWNrc30gU291bCBQYWNrJHtlLnBhY2tzID09PSAxID8gJycgOiAncyd9IGVhcm5lZCB0aGlzIHJ1bi48L2Rpdj5gIDogJzxkaXYgY2xhc3M9XCJzdWJcIj5DbGVhciB3YXZlIDEwIHRvIGVhcm4gYSBTb3VsIFBhY2suPC9kaXY+J308ZGl2IGNsYXNzPVwicm93XCI+JHtlLnBhY2tzID8gJzxidXR0b24gaWQ9XCJ0b1Nob3BcIiBjbGFzcz1cImdvXCI+T3BlbiBwYWNrPC9idXR0b24+JyA6ICcnfTxidXR0b24gaWQ9XCJhZ2FpblwiIGNsYXNzPVwiJHtlLnBhY2tzID8gJ2JsdWUnIDogJ2dvJ31cIj5HbyBhZ2FpbjwvYnV0dG9uPjxidXR0b24gaWQ9XCJ0b0hvbWVcIiBjbGFzcz1cImJsdWVcIj5Ib21lPC9idXR0b24+PC9kaXY+PC9kaXY+YDtcbiAgICAgICAgJCgnYWdhaW4nKS5vbmNsaWNrID0gKCkgPT4gZy5uZXdFbmRsZXNzKCk7ICQoJ3RvSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgICAgIGNvbnN0IHRzMiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b1Nob3AnKTsgaWYgKHRzMikgdHMyLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLXNob3AnKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj4ke2cuZGFpbHkgPyAocGggPT09ICd3b24nID8gJ0RhaWx5IGNvbXBsZXRlIScgOiAnQ2hhbGxlbmdlIGZhaWxlZCcpIDogcGggPT09ICd3b24nID8gJ1N0YWdlIGNsZWFyZWQhJyA6ICdTdGFnZSBsb3N0J308L2gyPjxkaXYgY2xhc3M9XCJzdWJcIj4ke2cubGFzdEJhdHRsZX08L2Rpdj4ke3Jld2FyZEh0bWx9PGRpdiBjbGFzcz1cInJvd1wiPiR7KHJ3ICYmIHJ3LnBhY2spIHx8IChkciAmJiBkci5wYWNrKSA/ICc8YnV0dG9uIGlkPVwidG9TaG9wXCIgY2xhc3M9XCJnb1wiPk9wZW4gcGFjazwvYnV0dG9uPicgOiAnJ308YnV0dG9uIGlkPVwiYWdhaW5cIiBjbGFzcz1cIiR7KHJ3ICYmIHJ3LnBhY2spIHx8IChkciAmJiBkci5wYWNrKSA/ICdibHVlJyA6ICdnbyd9XCI+JHtwaCA9PT0gJ3dvbicgPyAnUGxheSBhZ2FpbicgOiAnVHJ5IGFnYWluJ308L2J1dHRvbj48YnV0dG9uIGlkPVwidG9Ib21lXCIgY2xhc3M9XCJibHVlXCI+SG9tZTwvYnV0dG9uPjwvZGl2PjwvZGl2PmA7XG4gICAgICAkKCdhZ2FpbicpLm9uY2xpY2sgPSAoKSA9PiAoZy5kYWlseSA/IGcubmV3RGFpbHkoKSA6IGcubmV3UnVuKCkpOyAkKCd0b0hvbWUnKS5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1ob21lJykpO1xuICAgICAgY29uc3QgdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG9TaG9wJyk7IGlmICh0cykgdHMub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc2hvcCcpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5yZW5kZXJEZWJ1Z0xpdmUoKTtcbiAgICBpZiAocGggPT09ICdidWlsZCcpIHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiBnLnJlZnJhbWVCdWlsZCgpKTsgICAgIC8vIGFmdGVyIGxheW91dDoga2VlcCB0aGUgZ3JpZCBjbGVhciBvZiB0aGUgaGFuZCBhbmQgYnV0dG9uc1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIHBhbmVsXG4gIHByaXZhdGUgcmVuZGVyRGVidWcoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgZCA9IHRoaXMuZGJnOyBpZiAoIWQuY2xhc3NMaXN0LmNvbnRhaW5zKCdvcGVuJykpIHsgZC5pbm5lckhUTUwgPSAnJzsgcmV0dXJuOyB9XG4gICAgY29uc3Qgcm93ID0gKGxhYmVsOiBzdHJpbmcsIG9iajogYW55LCBrZXk6IHN0cmluZyB8IG51bWJlciwgbWluOiBudW1iZXIsIG1heDogbnVtYmVyLCBzdGVwOiBudW1iZXIpID0+IGA8bGFiZWw+JHtsYWJlbH0gPGlucHV0IHR5cGU9XCJyYW5nZVwiIG1pbj1cIiR7bWlufVwiIG1heD1cIiR7bWF4fVwiIHN0ZXA9XCIke3N0ZXB9XCIgdmFsdWU9XCIke29ialtrZXldfVwiIGRhdGEtbz1cIiR7bGFiZWx9XCI+PHNwYW4+JHtvYmpba2V5XX08L3NwYW4+PC9sYWJlbD5gO1xuICAgIGQuaW5uZXJIVE1MID0gYDxiPkRlYnVnIChsaXZlKTwvYj4gPHNwYW4gaWQ9XCJkYmdmcHNcIj48L3NwYW4+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPlN0YXIgbXVsdGlwbGllcnMgKGJvZGllcyA9IGRhbWFnZSwgc3RhcnMgPSBkdXJhYmlsaXR5KVxuICAgICAgICAke3JvdygnSFAgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAxLCAxLCA0LCAwLjA1KX0ke3JvdygnSFAgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmhwLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnRGFtYWdlIHggMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5kbWcsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMiwgMSwgNiwgMC4wNSl9JHtyb3coJ1NpemUgMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5zY2FsZSwgMSwgMSwgMS42LCAwLjAyKX0ke3JvdygnU2l6ZSAzXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAyLCAxLCAyLCAwLjAyKX08L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHRhYmxlPjx0cj48dGg+PC90aD48dGg+aHA8L3RoPjx0aD5kbWc8L3RoPjx0aD5yYXRlPC90aD48dGg+cmFuZ2U8L3RoPjx0aD5zcGQ8L3RoPjwvdHI+JHtTT1VMUy5tYXAoKGspID0+IGA8dHI+PHRkPiR7SUNPTltrXX08L3RkPiR7WydocCcsICdkbWcnLCAnaW50ZXJ2YWwnLCAncmFuZ2UnLCAnc3BlZWQnXS5tYXAoKGYpID0+IGA8dGQ+PGlucHV0IGNsYXNzPVwibnVtXCIgZGF0YS1zb3VsPVwiJHtrfVwiIGRhdGEtZj1cIiR7Zn1cIiB2YWx1ZT1cIiR7KEJBTEFOQ0Uuc3RhdHMgYXMgYW55KVtrXVtmXX1cIj48L3RkPmApLmpvaW4oJycpfTwvdHI+YCkuam9pbignJyl9PC90YWJsZT48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+RGlmZmljdWx0eSA8c2VsZWN0IGlkPVwiZERpZmZcIj4ke1snZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXS5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiICR7Zy5kaWZmaWN1bHR5ID09PSBrID8gJ3NlbGVjdGVkJyA6ICcnfT4ke2t9PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxzbWFsbD4oYXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUpPC9zbWFsbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRNZXJnZUhhbmRcIiAke2cucy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicgPyAnY2hlY2tlZCcgOiAnJ30+IE1lcmdlIGEgaGFuZCBjYXJkIHN0cmFpZ2h0IGludG8gYSBkZXBsb3llZCB1bml0IChvZmYgPSBkb2MgcnVsZTogYm90aCBjb3BpZXMgbXVzdCBiZSBvbiB0aGUgYm9hcmQpPC9sYWJlbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+UGVyZm9ybWFuY2U8YnI+PHNtYWxsIGlkPVwiZGJnUGVyZlwiPm1lYXN1cmluZ1x1MjAyNjwvc21hbGw+PGJyPjxsYWJlbD48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgaWQ9XCJkRnBzXCIgJHtnLnNob3dGcHMgPyAnY2hlY2tlZCcgOiAnJ30+IFNob3cgRlBTIG9uIHRoZSBiYXR0bGUgc2NyZWVuPC9sYWJlbD4gPGJ1dHRvbiBpZD1cImRQZXJmXCI+Q29weSBwZXJmIHJlcG9ydDwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZE9kZHNcIj5UZXN0IG9kZHMgKDIwMCBmaWdodHMpPC9idXR0b24+IDxzcGFuIGlkPVwiZE9kZHNPdXRcIj4ke3RoaXMub2Rkc308L3NwYW4+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkQ29weVwiPkNvcHkgcmVwb3J0PC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzZXRcIj5SZXNldCBiYWxhbmNlPC9idXR0b24+IDxidXR0b24gaWQ9XCJkUmVzdGFydFwiPlJlc3RhcnQgc3RhZ2U8L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+QWRkIGNhcmQgPHNlbGVjdCBpZD1cImRDYXJkXCI+JHtTT1VMUy5tYXAoKGspID0+IGA8b3B0aW9uIHZhbHVlPVwiJHtrfVwiPiR7U09VTF9OQU1FW2tdfTwvb3B0aW9uPmApLmpvaW4oJycpfTwvc2VsZWN0PiA8YnV0dG9uIGlkPVwiZEFkZFwiPis8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImREb21cIj4rMiBEb21pbmlvbjwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+TGFzdCB0YXA6IDxzcGFuIGlkPVwiZGJndGFwXCI+JHtnLmxhc3RUYXBJbmZvfTwvc3Bhbj48L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48c21hbGw+U2VlZCAke2cuc2VlZH0uIEFkZCA8Y29kZT4/c2VlZD03PC9jb2RlPiB0byB0aGUgbGluayB0byByZXBsYXkgdGhlIHNhbWUgZHJhd3MuPC9zbWFsbD48L2Rpdj5gO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXRbdHlwZT1yYW5nZV0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25pbnB1dCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGxhYiA9IGlucC5kYXRhc2V0Lm8hOyBjb25zdCB2ID0gK2lucC52YWx1ZTsgKGlucC5uZXh0RWxlbWVudFNpYmxpbmcgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gU3RyaW5nKHYpO1xuICAgICAgY29uc3Qgc2V0OiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkPiA9IHsgJ0hQIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMV0gPSB2KSwgJ0hQIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuaHBbMl0gPSB2KSwgJ0RhbWFnZSB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1sxXSA9IHYpLCAnRGFtYWdlIHggM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzJdID0gdiksICdTaXplIDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzFdID0gdiksICdTaXplIDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLnNjYWxlWzJdID0gdikgfTtcbiAgICAgIHNldFtsYWJdKCk7IGcuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7XG4gICAgfSkpO1xuICAgIGQucXVlcnlTZWxlY3RvckFsbDxIVE1MSW5wdXRFbGVtZW50PignaW5wdXQubnVtJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uY2hhbmdlID0gKCkgPT4geyAoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2lucC5kYXRhc2V0LnNvdWwhXVtpbnAuZGF0YXNldC5mIV0gPSAraW5wLnZhbHVlOyB9KSk7XG4gICAgJCgnZERpZmYnKS5vbmNoYW5nZSA9IChlKSA9PiBnLmNoYW5nZURpZmZpY3VsdHkoKGUudGFyZ2V0IGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSk7XG4gICAgJCgnZE1lcmdlSGFuZCcpLm9uY2hhbmdlID0gKGUpID0+IHsgZy5zLnJ1bGVzLm1lcmdlID0gKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQgPyAnaGFuZEludG9PbmVTdGFyJyA6ICdkZXBsb3llZE9ubHknOyBnLnN5bmNCdWlsZCgpOyB0aGlzLnJlbmRlcigpOyB9O1xuICAgICQoJ2RPZGRzJykub25jbGljayA9ICgpID0+IHsgY29uc3QgciA9IGcudGVzdE9kZHMoMjAwKTsgdGhpcy5vZGRzID0gYCR7ci53aW59JSB3aW4gKCR7ci5ufSBmaWdodHMsIGF2ZyAke3IuYXZnVGltZX1zKSB2cyB3YXZlICR7Zy5zLndhdmV9YDsgJCgnZE9kZHNPdXQnKS50ZXh0Q29udGVudCA9IHRoaXMub2RkczsgfTtcbiAgICAkKCdkQ29weScpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdSZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkRnBzJykub25jaGFuZ2UgPSAoZSkgPT4gZy5zZXRTaG93RnBzKChlLnRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS5jaGVja2VkKTtcbiAgICAkKCdkUGVyZicpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHQgPSBnLnBlcmZSZXBvcnQoKTsgKG5hdmlnYXRvci5jbGlwYm9hcmQgPyBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KSA6IFByb21pc2UucmVqZWN0KCkpLnRoZW4oKCkgPT4gdGhpcy50b2FzdCgnUGVyZiByZXBvcnQgY29waWVkLiBQYXN0ZSBpdCBpbnRvIGNoYXQuJykpLmNhdGNoKCgpID0+IHsgcHJvbXB0KCdDb3B5IHRoaXMgcmVwb3J0OicsIHQpOyB9KTsgfTtcbiAgICAkKCdkUmVzZXQnKS5vbmNsaWNrID0gKCkgPT4geyBnLnJlc2V0QmFsYW5jZUFsbCgpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgJCgnZFJlc3RhcnQnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydFN0YWdlKGcuc2VlZCk7XG4gICAgJCgnZEFkZCcpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZENhcmQoKCQoJ2RDYXJkJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlIGFzIFNvdWxJZCk7ICQoJ2REb20nKS5vbmNsaWNrID0gKCkgPT4gZy5hZGREb21pbmlvbigyKTtcbiAgfVxuICByZW5kZXJEZWJ1Z0xpdmUoKSB7XG4gICAgY29uc3QgZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmdmcHMnKTsgaWYgKGYpIGYudGV4dENvbnRlbnQgPSBgJHt0aGlzLmcucGhhc2V9YDtcbiAgICBjb25zdCBwZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmdQZXJmJyk7IGlmIChwZikgeyBjb25zdCBwID0gdGhpcy5nLnBlcmZJbmZvKCk7IHBmLnRleHRDb250ZW50ID0gYCR7cC5mcHMudG9GaXhlZCgwKX0gZnBzIFx1MDBCNyBhdmcgJHtwLmF2Zy50b0ZpeGVkKDEpfW1zIFx1MDBCNyBzbG93NSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zIFx1MDBCNyB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyBcdTAwQjcgJHtwLm1lc2hlc30gbWVzaGVzIFx1MDBCNyAke3AucGFydGljbGVzfSBwYXJ0aWNsZSBzeXN0ZW1zIFx1MDBCNyAke3AuZHJhd3N9IGRyYXcgY2FsbHNgOyB9XG4gICAgY29uc3QgdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYmd0YXAnKTsgaWYgKHQpIHQudGV4dENvbnRlbnQgPSB0aGlzLmcubGFzdFRhcEluZm87XG4gIH1cbn1cbiIsICIvLyBUaGUgcGxheWFibGUgcHJvdG90eXBlOiBidWlsZCBzY3JlZW4gLT4gYmF0dGxlIC0+IGRyYWZ0IC0+IG5leHQgd2F2ZSwgYnVpbHQgb24gdGhlIHRlc3RlZCBydWxlcyArIGJhdHRsZSBlbmdpbmUuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcbmltcG9ydCB7IEJBTEFOQ0UsIHJlc2V0QmFsYW5jZSwgU09VTF9OQU1FIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IEdSSURfQ0VMTFMsIEdSSURfQ09MUywgR1JJRF9ST1dTLCBTT1VMUyB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQge1xuICBhZHZhbmNlV2F2ZSwgY2FuTWVyZ2VEZXBsb3llZCwgY2FuTWVyZ2VGcm9tSGFuZCwgY2FuU3VtbW9uLCBjZWxsRnJlZSwgY29zdCwgZGlzY2FyZFJlZHJhdywgZGlzbWlzcywgZG9taW5pb25GcmVlLCBkb21pbmlvblVzZWQsIGRyYWZ0T3B0aW9ucywgZmFpbFdhdmUsXG4gIG1lcmdlRGVwbG95ZWQsIG1lcmdlRnJvbUhhbmQsIG1vdmVVbml0LCBuZXdTdGFnZSwgbm9ybWFsRHJhdywgc3RhZ2VXYXZlcywgc3VtbW9uLCBzd2FwU2VsbCwgdGFrZURyYWZ0LFxufSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGJ1aWxkQXJlbmEgfSBmcm9tICcuL2FyZW5hLnRzJztcbmltcG9ydCB7IEJhdHRsZSwgY2VsbFBvcywgRlJPTlRfWCwgR1JJRF9TUCwgc2ltdWxhdGUgfSBmcm9tICcuLi9jb3JlL2JhdHRsZS50cyc7XG5pbXBvcnQgdHlwZSB7IEJFdmVudCB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB7IGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5TmFtZSwgZW5lbXlQb3dlciwgZW5lbXlXYXZlLCBpc0VuZGxlc3MsIHNldERpZmZpY3VsdHksIHNldEVuZGxlc3MsIHNldFN0YWdlRGlmZmljdWx0eSwgc2V0RGFpbHkgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IEVORExFU1NfSUQsIEVORExFU1NfUEFDS19FVkVSWSB9IGZyb20gJy4uL2NvcmUvZW5kbGVzcy50cyc7XG5pbXBvcnQgeyBEQUlMWV9JRCwgZGFpbHlSdWxlcywgZGF5TnVtYmVyLCBpc1ZhbGlkRGF5LCBtb2RpZmllckZvciB9IGZyb20gJy4uL2NvcmUvZGFpbHkudHMnO1xuaW1wb3J0IHR5cGUgeyBEYWlseU1vZCB9IGZyb20gJy4uL2NvcmUvZGFpbHkudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19SVUxFUywgUFJPVE9UWVBFX1JVTEVTIH0gZnJvbSAnLi4vY29yZS9wcm90b3R5cGUudHMnO1xuaW1wb3J0IHsgbG9hZFNhdmUgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuaW1wb3J0IHsgZW5kbGVzc1VubG9ja2VkIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5pbXBvcnQgeyBOZWNyb21hbmNlciB9IGZyb20gJy4vbmVjcm9tYW5jZXIudHMnO1xuaW1wb3J0IHsgYXVkaW8gfSBmcm9tICcuL2F1ZGlvLnRzJztcbmltcG9ydCB7IGNsZWFyUnVuLCBsb2FkUnVuLCBzYXZlUnVuLCBzZXJpYWxpemVTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVuc2F2ZS50cyc7XG5pbXBvcnQgeyBhZGRHb2xkQW5kU2F2ZSwgZW5kbGVzc1dhdmVHb2xkLCBwbGF5YWJsZSwgcmVjb3JkQ2xlYXJBbmRTYXZlLCByZWNvcmREYWlseVdpbkFuZFNhdmUsIHJlY29yZEVuZGxlc3NXYXZlQW5kU2F2ZSwgd2F2ZUdvbGQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB0eXBlIHsgRGFpbHlSZXdhcmQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB0eXBlIHsgQ2xlYXJSZXdhcmQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB0eXBlIHsgUnVuU25hcHNob3QgfSBmcm9tICcuLi9jb3JlL3J1bnNhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgY3JlYXRlVmlzdWFsLCBpc1RyaXBvLCBsb2FkQXNzZXRzIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB0eXBlIHsgQXNzZXRzLCBVbml0VmlzdWFsIH0gZnJvbSAnLi92aXN1YWxzLnRzJztcbmltcG9ydCB7IFVpIH0gZnJvbSAnLi91aS50cyc7XG5cbmV4cG9ydCB0eXBlIFBoYXNlID0gJ2J1aWxkJyB8ICd0cmFuc2l0aW9uJyB8ICdiYXR0bGUnIHwgJ2RyYWZ0JyB8ICd3b24nIHwgJ2xvc3QnO1xudHlwZSBTZWwgPSB7IHR5cGU6ICdjYXJkJzsgaWR4OiBudW1iZXIgfSB8IHsgdHlwZTogJ3VuaXQnOyBpZDogbnVtYmVyIH0gfCBudWxsO1xuXG5leHBvcnQgY2xhc3MgR2FtZSB7XG4gIGVuZ2luZTogYW55OyBzY2VuZTogYW55OyBjYW1lcmE6IGFueTsgQSE6IEFzc2V0czsgdWkhOiBVaTtcbiAgZGFpbHk6IHsgZGF5OiBudW1iZXI7IG1vZDogRGFpbHlNb2QgfSB8IG51bGwgPSBudWxsOyBkYWlseVJld2FyZDogRGFpbHlSZXdhcmQgfCBudWxsID0gbnVsbDsgICAvLyB0aGUgRGFpbHkgQ2hhbGxlbmdlIHJ1biBpbiBwcm9ncmVzcywgYW5kIHdoYXQgaXRzIHdpbiBwYWlkXG4gIGxhc3RHb2xkID0gMDsgcnVuR29sZCA9IDA7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGdvbGQgZnJvbSB0aGUgd2F2ZSBqdXN0IGNsZWFyZWQsIGFuZCBmcm9tIHRoaXMgd2hvbGUgcnVuXG4gIHMhOiBTdGF0ZTsgc2VlZCA9IDE7IGF0dGVtcHQgPSAwOyBwaGFzZTogUGhhc2UgPSAnYnVpbGQnOyBiYXR0bGU6IEJhdHRsZSB8IG51bGwgPSBudWxsOyB0aW1lU2NhbGUgPSAxO1xuICBzZWw6IFNlbCA9IG51bGw7IHN3YXBNb2RlID0gZmFsc2U7IGNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgZHJhZnQ6IFNvdWxJZFtdIHwgbnVsbCA9IG51bGw7IGxhc3RCYXR0bGUgPSAnJztcbiAgcHJpdmF0ZSB1bml0VmlzID0gbmV3IE1hcDxudW1iZXIsIFVuaXRWaXN1YWw+KCk7ICAgICAgICAvLyB1bml0IGlkIC0+IHZpc3VhbCAoeW91ciBhcm15LCBwZXJzaXN0cyBiZXR3ZWVuIHdhdmVzKVxuICBwcml2YXRlIHZpc1RvVW5pdCA9IG5ldyBNYXA8VW5pdFZpc3VhbCwgbnVtYmVyPigpO1xuICBwcml2YXRlIGZ2aXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgICAgIC8vIGZpZ2h0ZXIgaWQgLT4gdmlzdWFsIGR1cmluZyBhIGJhdHRsZVxuICBwcml2YXRlIGZVbml0ID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKTsgICAgICAgICAgICAgIC8vIGZpZ2h0ZXIgaWQgLT4gdW5pdCBpZCAocGxheWVyIHNpZGUpXG4gIHByaXZhdGUgbGFzdFN0YXRlID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZz4oKTtcbiAgcHJpdmF0ZSBhcmVuYSE6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHNldFRoZW1lKHN0YWdlOiBzdHJpbmcpOiB2b2lkIH07XG4gIHByaXZhdGUgdGlsZXM6IGFueVtdID0gW107IHByaXZhdGUgdGlsZU1hdHM6IGFueVtdID0gW107IHByaXZhdGUgcmluZ0Z4OiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93czogYW55W10gPSBbXTsgcHJpdmF0ZSB0aW1lcnM6IHsgdDogbnVtYmVyOyBmbjogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSBhY2MgPSAwOyBwcml2YXRlIGNhbUZyb206IGFueSA9IG51bGw7IHByaXZhdGUgY2FtVG86IGFueSA9IG51bGw7IHByaXZhdGUgY2FtVCA9IDE7IHByaXZhdGUgY2FtRHVyID0gMi4wOyBwcml2YXRlIHJlc3VsdEF0ID0gLTE7IHByaXZhdGUgaGFuZGxlZCA9IGZhbHNlOyBwcml2YXRlIHN0YXJ0U3RlcEF0ID0gMDtcbiAgcHJpdmF0ZSBhcnJvd01hdHM6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dNZXNoOiBhbnlbXSA9IFtdO1xuICBuZWNybyE6IE5lY3JvbWFuY2VyO1xuICAvKiogV2hhdCB0aGUgbGFzdCBzdGFnZSBjbGVhciBlYXJuZWQgKHNob3duIG9uIHRoZSBzdGFnZS1jbGVhcmVkIHNjcmVlbikuICovXG4gIHJld2FyZDogQ2xlYXJSZXdhcmQgfCBudWxsID0gbnVsbDtcbiAgLyoqIFRoZSBlbmRsZXNzIHJ1biBpbiBwcm9ncmVzczogdGhlIGJlc3QgZGVwdGggd2hlbiBpdCBiZWdhbiAodG8gc3BvdCBhIG5ldyByZWNvcmQpLCB0aGUgd2F2ZXMgY2xlYXJlZCBzbyBmYXIsIGFuZCB0aGUgcGFja3MgZWFybmVkLiAqL1xuICBlbmRsZXNzOiB7IHN0YXJ0QmVzdDogbnVtYmVyOyBjbGVhcmVkOiBudW1iZXI7IHBhY2tzOiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNpbmUgPSBmYWxzZTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgcmVzdWx0IGN1dHNjZW5lIGlzIHBsYXlpbmc6IHRoZSBiYXR0bGUgY2FtZXJhIGFuZCBmaWdodGVyIHN5bmMgc3RhbmQgZG93blxuICBwcml2YXRlIHR3ZWVuczogeyB0OiBudW1iZXI7IGR1cjogbnVtYmVyOyBmbjogKHU6IG51bWJlcikgPT4gdm9pZDsgZG9uZT86ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgdHdlZW4oZHVyOiBudW1iZXIsIGZuOiAodTogbnVtYmVyKSA9PiB2b2lkLCBkb25lPzogKCkgPT4gdm9pZCkgeyB0aGlzLnR3ZWVucy5wdXNoKHsgdDogMCwgZHVyLCBmbiwgZG9uZSB9KTsgfVxuICAvKiogRmluaXNoIGV2ZXJ5IHJ1bm5pbmcgYW5pbWF0aW9uIGF0IG9uY2UgKHNvIG5vdGhpbmcgaXMgbGVmdCBoYWxmLXdheSBvciB1bmRpc3Bvc2VkIHdoZW4gdGhlIHBoYXNlIGNoYW5nZXMpLiAqL1xuICBwcml2YXRlIGZsdXNoVHdlZW5zKCkgeyBmb3IgKGNvbnN0IHcgb2YgdGhpcy50d2VlbnMuc3BsaWNlKDApKSB7IHcuZm4oMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgcHJpdmF0ZSBzZWVuTWVyZ2VzID0gMDtcblxuICBhc3luYyBpbml0KGNhbnZhczogSFRNTENhbnZhc0VsZW1lbnQpIHtcbiAgICBjb25zdCBxcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKTtcbiAgICB0aGlzLmVuZ2luZSA9IG5ldyBCQUJZTE9OLkVuZ2luZShjYW52YXMsIHRydWUsIHsgYW50aWFsaWFzOiB0cnVlLCBwb3dlclByZWZlcmVuY2U6ICdoaWdoLXBlcmZvcm1hbmNlJyB9KTtcbiAgICBjb25zdCBkcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxOyB0aGlzLmVuZ2luZS5zZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgxIC8gTWF0aC5taW4oZHByLCAxLjUpKTtcbiAgICBjb25zdCBzY2VuZSA9IHRoaXMuc2NlbmUgPSBuZXcgQkFCWUxPTi5TY2VuZSh0aGlzLmVuZ2luZSk7IHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wOSwgMC4wNywgMC4xMywgMSk7XG4gICAgY29uc3QgaGVtaSA9IG5ldyBCQUJZTE9OLkhlbWlzcGhlcmljTGlnaHQoJ2gnLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMSwgMC4zKSwgc2NlbmUpOyBoZW1pLmludGVuc2l0eSA9IDEuMDU7IGhlbWkuZ3JvdW5kQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4zMiwgMC4yNiwgMC40Mik7XG4gICAgY29uc3Qgc3VuID0gbmV3IEJBQllMT04uRGlyZWN0aW9uYWxMaWdodCgncycsIG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuNCwgLTEsIDAuNTUpLCBzY2VuZSk7IHN1bi5pbnRlbnNpdHkgPSAwLjg1O1xuICAgIHRoaXMuY2FtZXJhID0gbmV3IEJBQllMT04uRnJlZUNhbWVyYSgnY2FtJywgbmV3IEJBQllMT04uVmVjdG9yMygwLCA4LCAtOSksIHNjZW5lKTsgdGhpcy5jYW1lcmEubWluWiA9IDAuMTsgdGhpcy5jYW1lcmEubWF4WiA9IDIwMDsgdGhpcy5jYW1lcmEuZm92ID0gMC44OyB0aGlzLmNhbWVyYS5pbnB1dHMuY2xlYXIoKTtcblxuICAgIGNvbnN0IGdyb3VuZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdncm91bmQnLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0MCB9LCBzY2VuZSk7XG4gICAgZ3JvdW5kLmlzUGlja2FibGUgPSBmYWxzZTsgY29uc3QgYXJlbmEgPSB0aGlzLmFyZW5hID0gYnVpbGRBcmVuYShzY2VuZSwgZ3JvdW5kKTsgc2NlbmUub25CZWZvcmVSZW5kZXJPYnNlcnZhYmxlLmFkZCgoKSA9PiBhcmVuYS51cGRhdGUocGVyZm9ybWFuY2Uubm93KCkgLyAxMDAwKSk7XG4gICAgZm9yIChjb25zdCB0ZWFtIG9mIFswLCAxXSBhcyBjb25zdCkgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHsgY29uc3QgdCA9IHRoaXMubWFrZVRpbGUodGVhbSwgYyk7IGlmICh0ZWFtID09PSAwKSB0aGlzLnRpbGVzLnB1c2godCk7IGVsc2UgdC5zZXRFbmFibGVkKGZhbHNlKTsgfVxuXG4gICAgdGhpcy5BID0gYXdhaXQgbG9hZEFzc2V0cyhzY2VuZSk7XG4gICAgdGhpcy5uZWNybyA9IG5ldyBOZWNyb21hbmNlcihzY2VuZSwgdGhpcy5BLnNvZnQsIHRoaXMuQS5uZWNybyk7ICAgICAgIC8vIHN0YW5kcyBqdXN0IGJlaGluZCBoaXMgYXJteSdzIGJhY2sgY29sdW1uLCBmYWNpbmcgdGhlIGJhdHRsZWZpZWxkXG4gICAgdGhpcy5uZWNyby5ob2xkZXIucG9zaXRpb24uc2V0KC0oRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC0gMS4wNSwgMCwgMCk7IHRoaXMubmVjcm8uaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjtcbiAgICB0aGlzLmFycm93TWF0cyA9IFswLCAxXS5tYXAoKHQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2FtJyArIHQsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMywgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC43LCAwLjI1KTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyByZXR1cm4gbTsgfSk7XG4gICAgdGhpcy51aSA9IG5ldyBVaSh0aGlzKTsgdGhpcy5zZWVkID0gKyhxcy5nZXQoJ3NlZWQnKSB8fCAxKTsgaWYgKHFzLmdldCgnZnBzJykpIHRoaXMuc2V0U2hvd0Zwcyh0cnVlKTtcblxuICAgIC8vIFRhcHMgYXJlIGRldGVjdGVkIGhlcmUgKG5vdCB0aHJvdWdoIEJhYnlsb24pIHNvIHRoZXkgYmVoYXZlIHRoZSBzYW1lIGluIFNhZmFyaSwgdGhlIGhvbWUtc2NyZWVuIGFwcCBhbmQgb24gZGVza3RvcC5cbiAgICBsZXQgZG93bjogeyB4OiBudW1iZXI7IHk6IG51bWJlcjsgdDogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBsb2NhbCA9IChlOiBQb2ludGVyRXZlbnQpID0+IHsgY29uc3QgciA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsgcmV0dXJuIHsgeDogZS5jbGllbnRYIC0gci5sZWZ0LCB5OiBlLmNsaWVudFkgLSByLnRvcCB9OyB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyZG93bicsIChlKSA9PiB7IGRvd24gPSB7IC4uLmxvY2FsKGUpLCB0OiBwZXJmb3JtYW5jZS5ub3coKSB9OyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcnVwJywgKGUpID0+IHsgaWYgKCFkb3duKSByZXR1cm47IGNvbnN0IHAgPSBsb2NhbChlKTsgY29uc3QgbW92ZWQgPSBNYXRoLmh5cG90KHAueCAtIGRvd24ueCwgcC55IC0gZG93bi55KSwgZHQgPSBwZXJmb3JtYW5jZS5ub3coKSAtIGRvd24udDsgZG93biA9IG51bGw7IGlmIChtb3ZlZCA8IDE2ICYmIGR0IDwgOTAwKSB0aGlzLnRhcChwLngsIHAueSk7IH0pO1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVyY2FuY2VsJywgKCkgPT4geyBkb3duID0gbnVsbDsgfSk7XG4gICAgdGhpcy5jYW52YXMgPSBjYW52YXM7IGNvbnN0IG9uUmVzaXplID0gKCkgPT4gdGhpcy5oYW5kbGVSZXNpemUoKTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpOyB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignb3JpZW50YXRpb25jaGFuZ2UnLCAoKSA9PiBzZXRUaW1lb3V0KG9uUmVzaXplLCAyNTApKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0KSAod2luZG93IGFzIGFueSkudmlzdWFsVmlld3BvcnQuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgb25SZXNpemUpO1xuICAgIGlmICgod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIpIG5ldyAod2luZG93IGFzIGFueSkuUmVzaXplT2JzZXJ2ZXIob25SZXNpemUpLm9ic2VydmUoY2FudmFzKTtcbiAgICBpZiAocXMuZ2V0KCdnYWxsZXJ5JykpIHsgdGhpcy5nYWxsZXJ5KCk7IHJldHVybjsgfVxuICAgIGNvbnN0IHNhdmVkID0gcXMuZ2V0KCdzZWVkJykgPyBudWxsIDogbG9hZFJ1bigpOyAgICAgICAgICAgICAgICAvLyA/c2VlZD1OIGFsd2F5cyBzdGFydHMgZnJlc2ggKGRlYnVnZ2luZyk7IG90aGVyd2lzZSBwaWNrIHVwIHdoZXJlIHRoZSBsYXN0IHZpc2l0IGxlZnQgb2ZmXG4gICAgaWYgKHNhdmVkKSB0aGlzLnJlc3RvcmUoc2F2ZWQpOyBlbHNlIHRoaXMuc3RhcnRTdGFnZSh0aGlzLnNlZWQpO1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG5vdyA9IHBlcmZvcm1hbmNlLm5vdygpLCByYXcgPSBub3cgLSBsYXN0OyBjb25zdCBkdCA9IE1hdGgubWluKDAuMDUsIHJhdyAvIDEwMDApOyBsYXN0ID0gbm93OyBpZiAoIXRoaXMuYWN0aXZlKSByZXR1cm47IGlmICh0aGlzLmluc3BlY3RpbmcpIHRoaXMuZnJhbWVJbnNwZWN0KGR0KTsgZWxzZSBpZiAoIXRoaXMuZnJvemVuKSB0aGlzLmZyYW1lKGR0KTsgc2NlbmUucmVuZGVyKCk7IHRoaXMucGVyZlRpY2socmF3KTsgfSk7XG4gIH1cbiAgLyoqIFRoZSBuYXZpZ2F0aW9uIHNoZWxsIGhpZGVzIHRoZSBiYXR0bGUgc2NyZWVuIHdoaWxlIGFub3RoZXIgdGFiIGlzIG9wZW46IHBhdXNlIHRoZSBnYW1lIHNvIGl0IGNvc3RzIG5vdGhpbmcuICovXG4gIHByaXZhdGUgYWN0aXZlID0gdHJ1ZTtcbiAgLyoqIERlYnVnOiBrZWVwIGRyYXdpbmcgYnV0IHN0b3AgYWR2YW5jaW5nIHRpbWUsIHNvIGEgbW9tZW50IGNhbiBiZSBzdGVwcGVkIHRocm91Z2ggd2l0aCBmcmFtZShkdCkgYW5kIHNjcmVlbnNob3R0ZWQuICovXG4gIGZyb3plbiA9IGZhbHNlO1xuICBzdGVwKGR0OiBudW1iZXIpIHsgdGhpcy5mcmFtZShkdCk7IH1cbiAgc2V0QWN0aXZlKG9uOiBib29sZWFuKSB7IHRoaXMuYWN0aXZlID0gb247IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBpbnNwZWN0ICh0aGUgU291bHMgcGFnZSdzIDNEIGxvb2sgYXQgb25lIFNvdWwpXG4gIHByaXZhdGUgaW5zcGVjdGluZzogeyBzb3VsOiBTb3VsSWQ7IHY6IFVuaXRWaXN1YWw7IHN0YXI6IG51bWJlcjsgdGVhbTogMCB8IDE7IHNwaW46IGJvb2xlYW47IGhpZGRlbjogYW55W107IGdyaWQ6IGJvb2xlYW4gfSB8IG51bGwgPSBudWxsO1xuICAvKiogU2hvdyBvbmUgU291bCBvbiBpdHMgb3duIG9uIHRoZSBhcmVuYSBmbG9vcjogc2xvdyB0dXJudGFibGUsIGJ1dHRvbnMgZm9yIGV2ZXJ5IGFuaW1hdGlvbiBpdCBoYXMsIHN0YXIgc2l6ZXMgYW5kIHRoZSBlbmVteSBjb2xvdXJzLiAqL1xuICBpbnNwZWN0KHNvdWw6IFNvdWxJZCkge1xuICAgIGlmICghdGhpcy5BIHx8IHRoaXMuaW5zcGVjdGluZykgcmV0dXJuO1xuICAgIGNvbnN0IGhpZGRlbjogYW55W10gPSBbXTsgY29uc3QgaGlkZSA9IChuOiBhbnkpID0+IHsgaWYgKG4gJiYgbi5pc0VuYWJsZWQgJiYgbi5pc0VuYWJsZWQoKSkgeyBuLnNldEVuYWJsZWQoZmFsc2UpOyBoaWRkZW4ucHVzaChuKTsgfSB9O1xuICAgIGZvciAoY29uc3QgdiBvZiB0aGlzLnVuaXRWaXMudmFsdWVzKCkpIGhpZGUodi5ob2xkZXIpOyB0aGlzLmZ2aXMuZm9yRWFjaCgodikgPT4gaGlkZSh2LmhvbGRlcikpOyBpZiAodGhpcy5uZWNyby5ob2xkZXIuaXNFbmFibGVkKCkpIHsgdGhpcy5uZWNyby5zZXRFbmFibGVkKGZhbHNlKTsgaGlkZGVuLnB1c2goeyBzZXRFbmFibGVkOiAob246IGJvb2xlYW4pID0+IHRoaXMubmVjcm8uc2V0RW5hYmxlZChvbikgfSk7IH0gdGhpcy5yaW5nRnguZm9yRWFjaCgocikgPT4gaGlkZShyLm0pKTsgdGhpcy5hcnJvd3MuZm9yRWFjaCgoYSkgPT4gaGlkZShhLm1lc2gpKTtcbiAgICBjb25zdCBncmlkID0gdGhpcy50aWxlcy5sZW5ndGggPiAwICYmIHRoaXMudGlsZXNbMF0uaXNFbmFibGVkKCk7IHRoaXMuc2hvd0dyaWQoZmFsc2UpO1xuICAgIGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBzb3VsLCAwLCAxKTsgY29uc3QgUCA9IHsgeDogLTYsIHo6IDAgfTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KFAueCwgMCwgUC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgKiAwLjg1OyB2LnBsYXkoJ2lkbGUnKTtcbiAgICB0aGlzLmluc3BlY3RpbmcgPSB7IHNvdWwsIHYsIHN0YXI6IDEsIHRlYW06IDAsIHNwaW46IHRydWUsIGhpZGRlbiwgZ3JpZCB9O1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmFkZCgnaW5zcGVjdCcpO1xuICAgIHRoaXMuY2FtZXJhLmZvdiA9IDAuNjI7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLnNldChQLngsIDEuMTUsIFAueiAtIDMuNSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChuZXcgQkFCWUxPTi5WZWN0b3IzKFAueCwgMC41NiwgUC56KSk7XG4gICAgdGhpcy5yZW5kZXJJbnNwZWN0QmFyKCk7XG4gIH1cbiAgZW5kSW5zcGVjdCgpIHtcbiAgICBjb25zdCBpID0gdGhpcy5pbnNwZWN0aW5nOyBpZiAoIWkpIHJldHVybjtcbiAgICBpLnYuZGlzcG9zZSgpOyBpLmhpZGRlbi5mb3JFYWNoKChuKSA9PiBuLnNldEVuYWJsZWQodHJ1ZSkpOyB0aGlzLnNob3dHcmlkKGkuZ3JpZCAmJiB0aGlzLnBoYXNlID09PSAnYnVpbGQnKTtcbiAgICB0aGlzLmluc3BlY3RpbmcgPSBudWxsOyBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5yZW1vdmUoJ2luc3BlY3QnKTsgY29uc3QgYmFyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2luc3BlY3RiYXInKTsgaWYgKGJhcikgYmFyLmlubmVySFRNTCA9ICcnO1xuICAgIHRoaXMuY2FtZXJhLmZvdiA9IDAuODsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgfVxuICBwcml2YXRlIGZyYW1lSW5zcGVjdChkdDogbnVtYmVyKSB7XG4gICAgY29uc3QgaSA9IHRoaXMuaW5zcGVjdGluZyE7IGkudi51cGRhdGUoZHQpOyBpZiAoaS5zcGluKSBpLnYuaG9sZGVyLnJvdGF0aW9uLnkgKz0gZHQgKiAwLjQ1O1xuICAgIHRoaXMuYXJlbmEudXBkYXRlKHBlcmZvcm1hbmNlLm5vdygpIC8gMTAwMCk7XG4gIH1cbiAgcHJpdmF0ZSByZW5kZXJJbnNwZWN0QmFyKCkge1xuICAgIGNvbnN0IGkgPSB0aGlzLmluc3BlY3Rpbmc7IGNvbnN0IGJhciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbnNwZWN0YmFyJyk7IGlmICghaSB8fCAhYmFyKSByZXR1cm47XG4gICAgY29uc3QgbmljZSA9IChuOiBzdHJpbmcpID0+ICh7IFNwYXduOiAnQXJyaXZhbCcsIEF0dGFjazogJ0F0dGFjaycsIENoZWVyOiAnQ2hlZXInLCBEZWF0aDogJ0ZhbGwnIH0gYXMgYW55KVtuXSA/PyBuLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csICckMSAkMicpO1xuICAgIGNvbnN0IGNsaXBzID0gKGkudi5jbGlwTmFtZXMgPyBpLnYuY2xpcE5hbWVzKCkgOiBbXSkubWFwKChuKSA9PiBgPGJ1dHRvbiBkYXRhLWNsaXA9XCIke259XCI+JHtuaWNlKG4pfTwvYnV0dG9uPmApLmpvaW4oJycpO1xuICAgIGJhci5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImliXCI+PGJ1dHRvbiBpZD1cImliQmFja1wiIGNsYXNzPVwiZ29cIj5CYWNrPC9idXR0b24+PGIgY2xhc3M9XCJpYnRcIj4ke1NPVUxfTkFNRVtpLnNvdWxdfTwvYj4ke1sxLCAyLCAzXS5tYXAoKG4pID0+IGA8YnV0dG9uIGRhdGEtc3Rhcj1cIiR7bn1cIiBjbGFzcz1cIiR7aS5zdGFyID09PSBuID8gJ29uJyA6ICcnfVwiPiR7bn1cXHUyNjA1PC9idXR0b24+YCkuam9pbignJyl9PGJ1dHRvbiBpZD1cImliVGVhbVwiIGNsYXNzPVwiJHtpLnRlYW0gPyAnb24nIDogJyd9XCI+RW5lbXkgY29sb3VyczwvYnV0dG9uPjxidXR0b24gaWQ9XCJpYlNwaW5cIiBjbGFzcz1cIiR7aS5zcGluID8gJ29uJyA6ICcnfVwiPlR1cm48L2J1dHRvbj48L2Rpdj48ZGl2IGNsYXNzPVwiaWIgaWJjXCI+JHtjbGlwc308L2Rpdj5gO1xuICAgIGJhci5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2xpcF0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5wbGF5KCd0YXAnKTsgaS52LnByZXZpZXdDbGlwICYmIGkudi5wcmV2aWV3Q2xpcChiLmRhdGFzZXQuY2xpcCEpOyB9KSk7XG4gICAgYmFyLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zdGFyXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiB7IGkuc3RhciA9ICtiLmRhdGFzZXQuc3RhciE7IGkudi5zZXRTdGFyKGkuc3Rhcik7IHRoaXMucmVuZGVySW5zcGVjdEJhcigpOyB9KSk7XG4gICAgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpYlRlYW0nKSBhcyBIVE1MRWxlbWVudCkub25jbGljayA9ICgpID0+IHsgaS50ZWFtID0gaS50ZWFtID8gMCA6IDE7IGkudi5zZXRUZWFtKGkudGVhbSk7IHRoaXMucmVuZGVySW5zcGVjdEJhcigpOyB9O1xuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaWJTcGluJykgYXMgSFRNTEVsZW1lbnQpLm9uY2xpY2sgPSAoKSA9PiB7IGkuc3BpbiA9ICFpLnNwaW47IHRoaXMucmVuZGVySW5zcGVjdEJhcigpOyB9O1xuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaWJCYWNrJykgYXMgSFRNTEVsZW1lbnQpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLXNvdWxzJykpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2NlbmUgaGVscGVyc1xuICAvKiogVGhlIHBsYWNlbWVudCBncmlkIGlzIGEgYnVpbGQtc2NyZWVuIHRvb2w6IGhpZGUgaXQgZHVyaW5nIHRoZSBmaWdodCBzbyB0aGUgYmF0dGxlIGxvb2tzIGxpa2UgYSBzY2VuZSwgbm90IGEgYm9hcmQuICovXG4gIHByaXZhdGUgc2hvd0dyaWQob246IGJvb2xlYW4pIHsgZm9yIChjb25zdCB0IG9mIHRoaXMudGlsZXMpIHQuc2V0RW5hYmxlZChvbik7IH1cbiAgcHJpdmF0ZSBtYWtlVGlsZSh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCksIHQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCd0aWxlJyArIGNlbGwsIHsgc2l6ZTogR1JJRF9TUCAqIDAuOTIgfSwgdGhpcy5zY2VuZSk7XG4gICAgdC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHQucG9zaXRpb24uc2V0KHAueCwgMC4wMTUsIHAueik7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3RtJywgdGhpcy5zY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjEyLCAwLjQyKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQyLCAwLjEyLCAwLjEyKTsgbS5hbHBoYSA9IDAuNTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB0Lm1hdGVyaWFsID0gbTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyB0Lm1ldGFkYXRhID0geyBraW5kOiAndGlsZScsIGNlbGwgfTsgdGhpcy50aWxlTWF0c1tjZWxsXSA9IG07IH0gZWxzZSB0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICByZXR1cm4gdDtcbiAgfVxuICBwcml2YXRlIHRpbnQoY2VsbDogbnVtYmVyLCBtb2RlOiAnbm9ybWFsJyB8ICdmcmVlJyB8ICdzZWwnIHwgJ3BhcnRuZXInKSB7XG4gICAgY29uc3QgbSA9IHRoaXMudGlsZU1hdHNbY2VsbF07IGNvbnN0IGMgPSB7IG5vcm1hbDogWzAuMTgsIDAuMTIsIDAuNDIsIDAuNV0sIGZyZWU6IFswLjIsIDAuNzUsIDAuNTUsIDAuN10sIHNlbDogWzEsIDAuODIsIDAuMywgMC44NV0sIHBhcnRuZXI6IFswLjg1LCAwLjM1LCAxLCAwLjg1XSB9W21vZGVdO1xuICAgIG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhjWzBdLCBjWzFdLCBjWzJdKTsgbS5hbHBoYSA9IGNbM107XG4gIH1cbiAgbGF0ZXIoc2VjOiBudW1iZXIsIGZuOiAoKSA9PiB2b2lkKSB7IHRoaXMudGltZXJzLnB1c2goeyB0OiBzZWMsIGZuIH0pOyB9XG4gIHByaXZhdGUgZnhSaW5nKHg6IG51bWJlciwgejogbnVtYmVyLCBjb2xvcjogYW55LCByMDogbnVtYmVyLCByMTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdmeCcsIHsgZGlhbWV0ZXI6IDEsIHRoaWNrbmVzczogMC4wMzUsIHRlc3NlbGxhdGlvbjogMjggfSwgdGhpcy5zY2VuZSk7IG0ucG9zaXRpb24uc2V0KHgsIDAuMDUsIHopOyBtLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBtbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2Z4bScsIHRoaXMuc2NlbmUpOyBtbS5lbWlzc2l2ZUNvbG9yID0gY29sb3I7IG1tLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG1tLmFscGhhID0gMC45OyBtLm1hdGVyaWFsID0gbW07IHRoaXMucmluZ0Z4LnB1c2goeyBtLCBtbSwgdDogMCwgcjAsIHIxLCBkdXIgfSk7XG4gIH1cbiAgcHJpdmF0ZSBidXJzdCh4OiBudW1iZXIsIHo6IG51bWJlciwgYzE6IG51bWJlcltdLCBjMjogbnVtYmVyW10sIGNvdW50OiBudW1iZXIpIHtcbiAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdiJywgNjAsIHRoaXMuc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoeCwgMC4wNSwgeik7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIDAuMDUsIDAuMik7XG4gICAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMSBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMyIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjEsIDAsIDAuMiwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMTI7IHBzLm1heFNpemUgPSAwLjM0OyBwcy5taW5MaWZlVGltZSA9IDAuNDsgcHMubWF4TGlmZVRpbWUgPSAwLjk7IHBzLmVtaXRSYXRlID0gMDsgcHMubWFudWFsRW1pdENvdW50ID0gY291bnQ7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLCAxLjMsIC0xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMSwgMi40LCAxKTtcbiAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjg7IHBzLm1heEVtaXRQb3dlciA9IDI7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIC0yLCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy50YXJnZXRTdG9wRHVyYXRpb24gPSAxLjI7IHBzLmRpc3Bvc2VPblN0b3AgPSB0cnVlOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gY2FtZXJhXG4gIHByaXZhdGUgcG9zZXMoKSB7XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3QgaGFsZiA9IEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQICsgMS40O1xuICAgIGNvbnN0IGQgPSBNYXRoLm1heChoYWxmIC8gKHRhblYgKiBhc3ApLCAoKEdSSURfUk9XUyAqIEdSSURfU1ApIC8gMiArIDIpIC8gKHRhblYgKiAwLjU1KSwgOCk7XG4gICAgY29uc3QgYmF0dGxlID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMSAqIGQsIDAuNDIgKiBkICsgMC41LCAtMC44NiAqIGQpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC4zNSwgMCkgfTtcbiAgICAvLyBCdWlsZCB2aWV3OiAoYWxtb3N0KSBzdHJhaWdodCBkb3duLCB3aXRoIHRoZSB3aG9sZSBncmlkIGluc2lkZSB0aGUgYmFuZCBiZXR3ZWVuIHRoZSB0b3AgYmFyIGFuZCB0aGUgaGFuZCBvZiBjYXJkcy5cbiAgICBjb25zdCBjeCA9IC0oRlJPTlRfWCArICgoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAvIDIpLCBIID0gTWF0aC5tYXgoMSwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KTtcbiAgICBjb25zdCBib3ggPSAoaWQ6IHN0cmluZykgPT4geyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsgcmV0dXJuIGVsICYmIGVsLm9mZnNldFBhcmVudCAhPT0gbnVsbCA/IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpIDogbnVsbDsgfTtcbiAgICBjb25zdCB0b3BCYXIgPSBib3goJ3RvcCcpLCBoYW5kID0gYm94KCdoYW5kJyksIGluZm8gPSBib3goJ2luZm8nKTtcbiAgICBjb25zdCBUT1AgPSBNYXRoLm1pbigwLjMyLCB0b3BCYXIgPyAodG9wQmFyLmJvdHRvbSArIDYpIC8gSCA6IDAuMSk7XG4gICAgY29uc3QgQk9UVE9NID0gTWF0aC5taW4oMC41LCAoSCAtIE1hdGgubWluKGhhbmQgPyBoYW5kLnRvcCA6IEgsIGluZm8gPyBpbmZvLnRvcCA6IEgpICsgNikgLyBIKTtcbiAgICBjb25zdCBiYW5kID0gTWF0aC5tYXgoMC4zLCAxIC0gVE9QIC0gQk9UVE9NKSwgY2VudGVyRnJhYyA9IFRPUCArIGJhbmQgLyAyOyAgICAgICAgICAvLyB0aGUgZ3JpZCdzIGNlbnRyZSBhcHBlYXJzIGF0IHRoaXMgZnJhY3Rpb24gZnJvbSB0aGUgdG9wXG4gICAgY29uc3QgZ3cgPSBHUklEX0NPTFMgKiBHUklEX1NQICsgMy4yLCBnaCA9IEdSSURfUk9XUyAqIEdSSURfU1AgKyAwLjU7ICAgICAgICAgICAgICAgIC8vIHRoZSB3aWR0aCBhbHNvIGxlYXZlcyByb29tIGZvciB0aGUgTmVjcm9tYW5jZXIgYmVzaWRlIHRoZSBncmlkXG4gICAgY29uc3QgZDIgPSBNYXRoLm1heChnaCAvICgyICogdGFuViAqIGJhbmQpLCBndyAvICgyICogdGFuViAqIGFzcCAqIDAuODgpLCA0LjUpO1xuICAgIGNvbnN0IHNoaWZ0ID0gKDAuNSAtIGNlbnRlckZyYWMpICogMiAqIGQyICogdGFuViwgYnggPSBjeCAtIDAuNjtcbiAgICBjb25zdCBidWlsZCA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCBkMiwgLXNoaWZ0IC0gMC4xICogZDIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIDAsIC1zaGlmdCkgfTtcbiAgICBjb25zdCBuZWNybyA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJhdHRsZS5wb3MueCAtIDEuNCwgYmF0dGxlLnBvcy55ICogMS4xMiwgYmF0dGxlLnBvcy56ICogMS4xMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygtMS40LCAwLjM1LCAwKSB9OyAgIC8vIHJlc3VsdCBjdXRzY2VuZXM6IGhpbSBhbmQgdGhlIGZpZWxkXG4gICAgcmV0dXJuIHsgYmF0dGxlLCBidWlsZCwgbmVjcm8gfTtcbiAgfVxuICAvKiogVGhlIGhhbmQgLyBpbmZvIGJhciBjYW4gY2hhbmdlIHNpemUgaW4gdGhlIGJ1aWxkIHBoYXNlIChsb25nIGFiaWxpdHkgdGV4dCwgbW9yZSBjYXJkcyk6IHJlLWZyYW1lIHNvIHRoZSBncmlkIG5ldmVyIGhpZGVzIGJlaGluZCBpdC4gKi9cbiAgcmVmcmFtZUJ1aWxkKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8IHRoaXMuY2FtVCA8IDEgfHwgdGhpcy5jaW5lIHx8ICF0aGlzLmNhbnZhcykgcmV0dXJuO1xuICAgIGNvbnN0IHAgPSB0aGlzLnBvc2VzKCkuYnVpbGQsIGMgPSB0aGlzLmNhbWVyYS5wb3NpdGlvbjtcbiAgICBpZiAoIWlzRmluaXRlKHAucG9zLngpIHx8IEJBQllMT04uVmVjdG9yMy5EaXN0YW5jZShjLCBwLnBvcykgPCAwLjA2KSByZXR1cm47XG4gICAgdGhpcy50d2VlbkNhbShwLCAwLjM1KTtcbiAgfVxuICBwcml2YXRlIGNhbnZhcyE6IEhUTUxDYW52YXNFbGVtZW50OyBwcml2YXRlIGxhc3RXID0gMDsgcHJpdmF0ZSBsYXN0SCA9IDA7IGxhc3RUYXBJbmZvID0gJyhubyB0YXBzIHlldCknO1xuICBwcml2YXRlIGhhbmRsZVJlc2l6ZSgpIHtcbiAgICBpZiAoIXRoaXMuY2FudmFzLmNsaWVudFdpZHRoIHx8ICF0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpIHJldHVybjsgICAvLyBoaWRkZW4gYmVoaW5kIGFub3RoZXIgdGFiXG4gICAgdGhpcy5lbmdpbmUucmVzaXplKCk7IHRoaXMubGFzdFcgPSB0aGlzLmNhbnZhcy5jbGllbnRXaWR0aDsgdGhpcy5sYXN0SCA9IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyAmJiB0aGlzLmNhbVQgPj0gMSkgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgfVxuICAvKiogQSB0YXAgb24gdGhlIDNEIHZpZXc6IHBpY2sgYSB0aWxlIG9yIGEgdW5pdC4gKi9cbiAgcHJpdmF0ZSB0YXAoeDogbnVtYmVyLCB5OiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gdGhpcy5zY2VuZS5waWNrKHgsIHksIChtOiBhbnkpID0+ICEhKG0ubWV0YWRhdGEgJiYgbS5tZXRhZGF0YS5raW5kKSk7XG4gICAgY29uc3QgbWQgPSBwICYmIHAuaGl0ID8gcC5waWNrZWRNZXNoLm1ldGFkYXRhIDogbnVsbDtcbiAgICB0aGlzLmxhc3RUYXBJbmZvID0gYHRhcCAke01hdGgucm91bmQoeCl9LCR7TWF0aC5yb3VuZCh5KX0gb2YgJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IC0+ICR7bWQgPyAobWQua2luZCA9PT0gJ3RpbGUnID8gJ3RpbGUgJyArIG1kLmNlbGwgOiAndW5pdCcpIDogJ25vdGhpbmcnfSAocGhhc2UgJHt0aGlzLnBoYXNlfSlgO1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICFtZCkgcmV0dXJuO1xuICAgIGlmIChtZC5raW5kID09PSAndGlsZScpIHRoaXMub25UaWxlKG1kLmNlbGwpOyBlbHNlIGlmIChtZC5raW5kID09PSAndW5pdCcpIHRoaXMub25Vbml0VmlzdWFsKG1kLnZpc3VhbCk7XG4gIH1cbiAgcHJpdmF0ZSBzZXRDYW0ocDogYW55KSB7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNvcHlGcm9tKHAucG9zKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHAudGd0LmNsb25lKCkpOyB9XG4gIHByaXZhdGUgdHdlZW5DYW0odG86IGFueSwgZHVyOiBudW1iZXIpIHsgdGhpcy5jYW1Gcm9tID0geyBwb3M6IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNsb25lKCksIHRndDogdGhpcy5jYW1lcmEuZ2V0VGFyZ2V0KCkuY2xvbmUoKSB9OyB0aGlzLmNhbVRvID0gdG87IHRoaXMuY2FtVCA9IDA7IHRoaXMuY2FtRHVyID0gZHVyOyB9XG5cbiAgLy8gLS0tLSBiYXR0bGUgY2FtZXJhOiBmb2xsb3dzIHRoZSBmaWdodGVycyB0aGF0IGFyZSBzdGlsbCBhbGl2ZSwgc28gdGhlIGFjdGlvbiAoYW5kIHRoZSBwdXJwbGUgZXllcykgc3RheXMgbGFyZ2Ugb24gc2NyZWVuXG4gIGNhbU1vZGU6ICdjbG9zZScgfCAnd2lkZScgPSAnY2xvc2UnOyBwcml2YXRlIGNhbVRndDogYW55ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIDApO1xuICBzZXRDYW1Nb2RlKG06ICdjbG9zZScgfCAnd2lkZScpIHtcbiAgICB0aGlzLmNhbU1vZGUgPSBtO1xuICAgIGlmIChtID09PSAnd2lkZScgJiYgdGhpcy5iYXR0bGUpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMC45KTtcbiAgICB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgZnJhbWVCYXR0bGUoZHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTsgaWYgKCFiKSByZXR1cm47IGNvbnN0IGFsaXZlID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAoIWFsaXZlLmxlbmd0aCkgcmV0dXJuO1xuICAgIGxldCB4MCA9IDFlOSwgeDEgPSAtMWU5LCB6MCA9IDFlOSwgejEgPSAtMWU5OyBmb3IgKGNvbnN0IGYgb2YgYWxpdmUpIHsgeDAgPSBNYXRoLm1pbih4MCwgZi54KTsgeDEgPSBNYXRoLm1heCh4MSwgZi54KTsgejAgPSBNYXRoLm1pbih6MCwgZi56KTsgejEgPSBNYXRoLm1heCh6MSwgZi56KTsgfVxuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IHdpZGUgPSB0aGlzLnBvc2VzKCkuYmF0dGxlLCBjeCA9ICh4MCArIHgxKSAvIDIsIGN6ID0gKHowICsgejEpIC8gMjtcbiAgICBjb25zdCBkID0gTWF0aC5taW4oTWF0aC5tYXgoKHgxIC0geDAgKyAzLjQpIC8gKDIgKiB0YW5WICogYXNwICogMC45KSwgKHoxIC0gejAgKyAzLjIpIC8gKDIgKiB0YW5WICogMC42MiksIDUuNCksIE1hdGguaHlwb3Qod2lkZS5wb3MueSwgd2lkZS5wb3MueikpO1xuICAgIGNvbnN0IHRndCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3gsIDAuNTUsIGN6KSwgcG9zID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCAtIDAuMDYgKiBkLCAwLjMyICogZCArIDAuNSwgY3ogLSAwLjkgKiBkKTtcbiAgICBjb25zdCBrID0gMSAtIE1hdGguZXhwKC1kdCAqIDIuMCk7XG4gICAgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbWVyYS5wb3NpdGlvbiwgcG9zLCBrKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbVRndCwgdGd0LCBrKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhZ2UgZmxvd1xuICAvKiogV3JpdGUgdGhlIHJ1biB0byBkaXNrIChjYWxtIG1vbWVudHMgb25seTogYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0KS4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0UnVuKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMpIHJldHVybjtcbiAgICAgIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgeyBjbGVhclJ1bigpOyByZXR1cm47IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnICYmIHRoaXMucGhhc2UgIT09ICdkcmFmdCcpIHJldHVybjtcbiAgICAgIGNvbnN0IHNuYXA6IFJ1blNuYXBzaG90ID0geyB2OiAxLCBzZWVkOiB0aGlzLnNlZWQsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgc3RhZ2U6IGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5TmFtZSwgcGhhc2U6IHRoaXMucGhhc2UsIGRyYWZ0OiB0aGlzLnBoYXNlID09PSAnZHJhZnQnID8gdGhpcy5kcmFmdCA6IG51bGwsIHN0YXRlOiBzZXJpYWxpemVTdGF0ZShzKSwgc3RhcnRCZXN0OiB0aGlzLmVuZGxlc3M/LnN0YXJ0QmVzdCB9O1xuICAgICAgc2F2ZVJ1bihzbmFwKTtcbiAgICB9IGNhdGNoIHsgLyogbmV2ZXIgbGV0IHNhdmluZyBicmVhayB0aGUgZ2FtZSAqLyB9XG4gIH1cbiAgLyoqIFJlYnVpbGQgdGhlIHNjcmVlbiBmcm9tIGEgc2F2ZWQgcnVuIChhIHJlbG9hZCwgb3IgU2FmYXJpIGRpc2NhcmRpbmcgdGhlIHBhZ2UpLiAqL1xuICBwcml2YXRlIHJlc3RvcmUocjogeyBzbmFwOiBSdW5TbmFwc2hvdDsgc3RhdGU6IFN0YXRlIH0pIHtcbiAgICBjb25zdCB7IHNuYXAsIHN0YXRlIH0gPSByO1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLmZsdXNoVHdlZW5zKCk7IHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5kYWlseSA9IG51bGw7XG4gICAgaWYgKHNuYXAuc3RhZ2UgPT09IERBSUxZX0lEICYmIGlzVmFsaWREYXkoK3NuYXAuZGlmZmljdWx0eSkpIHsgY29uc3QgZGF5ID0gK3NuYXAuZGlmZmljdWx0eSwgbW9kID0gbW9kaWZpZXJGb3IoZGF5KTsgc2V0RGFpbHkobW9kLCBkYXkpOyB0aGlzLmRhaWx5ID0geyBkYXksIG1vZCB9OyB0aGlzLmVuZGxlc3MgPSBudWxsOyB0aGlzLmFyZW5hLnNldFRoZW1lKCdjcnlwdCcpOyB9XG4gICAgZWxzZSBpZiAoc25hcC5zdGFnZSA9PT0gRU5ETEVTU19JRCkgeyBzZXRFbmRsZXNzKCk7IGNvbnN0IGRvbmUgPSBNYXRoLm1heCgwLCBzdGF0ZS53YXZlIC0gMSk7IHRoaXMuZW5kbGVzcyA9IHsgc3RhcnRCZXN0OiBzbmFwLnN0YXJ0QmVzdCA/PyBsb2FkU2F2ZSgpLmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogZG9uZSwgcGFja3M6IE1hdGguZmxvb3IoZG9uZSAvIEVORExFU1NfUEFDS19FVkVSWSkgfTsgfSBlbHNlIHsgc2V0U3RhZ2VEaWZmaWN1bHR5KHNuYXAuc3RhZ2UsIHNuYXAuZGlmZmljdWx0eSk7IHRoaXMuZW5kbGVzcyA9IG51bGw7IH1cbiAgICBpZiAoIXRoaXMuZGFpbHkpIHRoaXMuYXJlbmEuc2V0VGhlbWUoY3VycmVudFN0YWdlSWQpO1xuICAgIHRoaXMuc2VlZCA9IHNuYXAuc2VlZDsgdGhpcy5hdHRlbXB0ID0gc25hcC5hdHRlbXB0OyB0aGlzLnMgPSBzdGF0ZTsgdGhpcy5zZWVuTWVyZ2VzID0gc3RhdGUuc3RhdHMubWVyZ2VzO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IHNuYXAucGhhc2UgPT09ICdkcmFmdCcgPyBzbmFwLmRyYWZ0IDogbnVsbDsgdGhpcy5waGFzZSA9IHRoaXMuZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJzsgdGhpcy5zaG93R3JpZCh0aGlzLnBoYXNlID09PSAnYnVpbGQnKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KGBSdW4gcmVzdG9yZWQ6IHdhdmUgJHtpc0VuZGxlc3MoKSA/IHN0YXRlLndhdmUgOiBzdGF0ZS53YXZlICsgJy8nICsgc3RhZ2VXYXZlcyhzdGF0ZSl9LCAke3N0YXRlLmhlYXJ0c30gaGVhcnQke3N0YXRlLmhlYXJ0cyA9PT0gMSA/ICcnIDogJ3MnfS5gKTtcbiAgfVxuXG4gIC8vIC0tLS0gcGVyZm9ybWFuY2UgcmVhZG91dDogcm9sbGluZyBmcmFtZSBzdGF0cywgcGVyLWJhdHRsZSBzdW1tYXJpZXMsIG9wdGlvbmFsIG9uLXNjcmVlbiBGUFMsIGFuZCBhIHBhc3RlLWZyaWVuZGx5IHJlcG9ydFxuICBzaG93RnBzID0gZmFsc2U7IHBlcmZOb3cgPSB7IGZwczogMCwgYXZnOiAwLCBwOTU6IDAsIHdvcnN0OiAwIH07IHBlcmZMb2c6IGFueVtdID0gW107XG4gIHByaXZhdGUgcGVyZkJ1ZiA9IG5ldyBGbG9hdDMyQXJyYXkoMjQwKTsgcHJpdmF0ZSBwZXJmTiA9IDA7IHByaXZhdGUgcGVyZkkgPSAwOyBwcml2YXRlIHBlcmZTaG93bkF0ID0gMDsgcHJpdmF0ZSBpbnN0cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBmcHNIdWQ6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY3VyQmF0dGxlOiB7IGZyYW1lczogbnVtYmVyOyBzdW06IG51bWJlcjsgd29yc3Q6IG51bWJlcjsgc2xvdzogbnVtYmVyOyBzY2FsZTogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgc2V0U2hvd0ZwcyhvbjogYm9vbGVhbikge1xuICAgIHRoaXMuc2hvd0ZwcyA9IG9uO1xuICAgIGlmIChvbiAmJiAhdGhpcy5mcHNIdWQpIHsgY29uc3QgaCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBoLmlkID0gJ2Zwc0h1ZCc7IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYmF0dGxlSG9zdCcpIHx8IGRvY3VtZW50LmJvZHkpLmFwcGVuZENoaWxkKGgpOyB0aGlzLmZwc0h1ZCA9IGg7IH1cbiAgICBpZiAodGhpcy5mcHNIdWQpIHRoaXMuZnBzSHVkLnN0eWxlLmRpc3BsYXkgPSBvbiA/ICdibG9jaycgOiAnbm9uZSc7XG4gIH1cbiAgcHJpdmF0ZSBwZXJmVGljayhtczogbnVtYmVyKSB7XG4gICAgaWYgKG1zID4gNTAwKSByZXR1cm47ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSB0YWIgd2FzIGhpZGRlbiBvciB0aGUgcGhvbmUgcGF1c2VkIHVzOiBub3QgYSByZWFsIGZyYW1lXG4gICAgdGhpcy5wZXJmQnVmW3RoaXMucGVyZkldID0gbXM7IHRoaXMucGVyZkkgPSAodGhpcy5wZXJmSSArIDEpICUgdGhpcy5wZXJmQnVmLmxlbmd0aDsgdGhpcy5wZXJmTiA9IE1hdGgubWluKHRoaXMucGVyZkJ1Zi5sZW5ndGgsIHRoaXMucGVyZk4gKyAxKTtcbiAgICBjb25zdCBjID0gdGhpcy5jdXJCYXR0bGU7XG4gICAgaWYgKGMgJiYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykpIHsgYy5mcmFtZXMrKzsgYy5zdW0gKz0gbXM7IGlmIChtcyA+IGMud29yc3QpIGMud29yc3QgPSBtczsgaWYgKG1zID4gMzMuNCkgYy5zbG93Kys7IGMuc2NhbGUgPSBNYXRoLm1heChjLnNjYWxlLCB0aGlzLnRpbWVTY2FsZSk7IH1cbiAgICBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKTsgaWYgKG5vdyAtIHRoaXMucGVyZlNob3duQXQgPCA1MDApIHJldHVybjsgdGhpcy5wZXJmU2hvd25BdCA9IG5vdztcbiAgICBjb25zdCBhID0gQXJyYXkuZnJvbSh0aGlzLnBlcmZCdWYuc3ViYXJyYXkoMCwgdGhpcy5wZXJmTikpLnNvcnQoKHgsIHkpID0+IHggLSB5KSwgYXZnID0gYS5yZWR1Y2UoKG4sIHgpID0+IG4gKyB4LCAwKSAvIGEubGVuZ3RoO1xuICAgIHRoaXMucGVyZk5vdyA9IHsgZnBzOiAxMDAwIC8gYXZnLCBhdmcsIHA5NTogYVtNYXRoLmZsb29yKGEubGVuZ3RoICogMC45NSldID8/IDAsIHdvcnN0OiBhW2EubGVuZ3RoIC0gMV0gPz8gMCB9O1xuICAgIGlmICh0aGlzLmZwc0h1ZCAmJiB0aGlzLnNob3dGcHMpIHRoaXMuZnBzSHVkLnRleHRDb250ZW50ID0gYCR7dGhpcy5wZXJmTm93LmZwcy50b0ZpeGVkKDApfSBmcHMgICR7dGhpcy5wZXJmTm93LmF2Zy50b0ZpeGVkKDEpfW1zICBzbG93NSUgJHt0aGlzLnBlcmZOb3cucDk1LnRvRml4ZWQoMCl9bXNgO1xuICAgIHRoaXMudWkucmVuZGVyRGVidWdMaXZlKCk7XG4gIH1cbiAgcHJpdmF0ZSBiZWdpbkJhdHRsZVBlcmYoKSB7IHRoaXMuY3VyQmF0dGxlID0geyBmcmFtZXM6IDAsIHN1bTogMCwgd29yc3Q6IDAsIHNsb3c6IDAsIHNjYWxlOiB0aGlzLnRpbWVTY2FsZSB9OyB9XG4gIHByaXZhdGUgZW5kQmF0dGxlUGVyZigpIHtcbiAgICBjb25zdCBjID0gdGhpcy5jdXJCYXR0bGU7IHRoaXMuY3VyQmF0dGxlID0gbnVsbDsgaWYgKCFjIHx8ICFjLmZyYW1lcykgcmV0dXJuO1xuICAgIHRoaXMucGVyZkxvZy5wdXNoKHsgd2F2ZTogdGhpcy5zLndhdmUsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgc3BlZWQ6IGMuc2NhbGUsIGZpZ2h0ZXJzOiB0aGlzLmJhdHRsZSA/IHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmxlbmd0aCA6IDAsIGZwczogKygxMDAwIC8gKGMuc3VtIC8gYy5mcmFtZXMpKS50b0ZpeGVkKDApLCB3b3JzdE1zOiArYy53b3JzdC50b0ZpeGVkKDApLCBzbG93UGN0OiArKCgxMDAgKiBjLnNsb3cpIC8gYy5mcmFtZXMpLnRvRml4ZWQoMSkgfSk7XG4gICAgaWYgKHRoaXMucGVyZkxvZy5sZW5ndGggPiAxMikgdGhpcy5wZXJmTG9nLnNoaWZ0KCk7XG4gIH1cbiAgcGVyZkluZm8oKSB7XG4gICAgY29uc3Qgc2MgPSB0aGlzLnNjZW5lOyBpZiAoIXRoaXMuaW5zdHIgJiYgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbikgdGhpcy5pbnN0ciA9IG5ldyBCQUJZTE9OLlNjZW5lSW5zdHJ1bWVudGF0aW9uKHNjKTtcbiAgICByZXR1cm4geyAuLi50aGlzLnBlcmZOb3csIG1lc2hlczogc2MuZ2V0QWN0aXZlTWVzaGVzKCkubGVuZ3RoLCBwYXJ0aWNsZXM6IHNjLnBhcnRpY2xlU3lzdGVtcy5sZW5ndGgsIGRyYXdzOiB0aGlzLmluc3RyID8gdGhpcy5pbnN0ci5kcmF3Q2FsbHNDb3VudGVyLmN1cnJlbnQgOiAtMSB9O1xuICB9XG4gIHBlcmZSZXBvcnQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBwID0gdGhpcy5wZXJmSW5mbygpLCBnbDogYW55ID0gdGhpcy5lbmdpbmUuZ2V0R2xJbmZvID8gdGhpcy5lbmdpbmUuZ2V0R2xJbmZvKCkgOiB7fTtcbiAgICBjb25zdCByb3dzID0gdGhpcy5wZXJmTG9nLm1hcCgocikgPT4gYCAgd2F2ZSAke3Iud2F2ZX0gdHJ5ICR7ci5hdHRlbXB0fSBhdCAke3Iuc3BlZWR9eDogJHtyLmZwc30gZnBzIGF2ZXJhZ2UsIHdvcnN0IGZyYW1lICR7ci53b3JzdE1zfW1zLCAke3Iuc2xvd1BjdH0lIHNsb3cgZnJhbWVzLCAke3IuZmlnaHRlcnN9IGZpZ2h0ZXJzYCk7XG4gICAgcmV0dXJuIFtgUEVSRiAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1gLCBgZGV2aWNlOiAke25hdmlnYXRvci51c2VyQWdlbnR9YCwgYGdwdTogJHtnbC5yZW5kZXJlciB8fCAnPyd9ICgke2dsLnZlbmRvciB8fCAnPyd9KWAsXG4gICAgICBgc2NyZWVuICR7c2NyZWVuLndpZHRofXgke3NjcmVlbi5oZWlnaHR9ICB2aWV3cG9ydCAke2lubmVyV2lkdGh9eCR7aW5uZXJIZWlnaHR9ICBkcHIgJHtkZXZpY2VQaXhlbFJhdGlvfSAgcmVuZGVyICR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKX14JHt0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKX0gIHNjYWxpbmcgbGV2ZWwgJHt0aGlzLmVuZ2luZS5nZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgpLnRvRml4ZWQoMil9YCxcbiAgICAgIGBub3c6ICR7cC5mcHMudG9GaXhlZCgwKX0gZnBzLCBhdmVyYWdlICR7cC5hdmcudG9GaXhlZCgxKX1tcywgc2xvd2VzdCA1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMsIHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIHwgYWN0aXZlIG1lc2hlcyAke3AubWVzaGVzfSwgcGFydGljbGUgc3lzdGVtcyAke3AucGFydGljbGVzfSwgZHJhdyBjYWxscyAke3AuZHJhd3N9YCxcbiAgICAgIGBzdGF0ZTogcGhhc2UgJHt0aGlzLnBoYXNlfSwgc3BlZWQgJHt0aGlzLnRpbWVTY2FsZX14LCBjYW1lcmEgJHt0aGlzLmNhbU1vZGV9LCBkaWZmaWN1bHR5ICR7ZGlmZmljdWx0eU5hbWV9LCB3YXZlICR7dGhpcy5zLndhdmV9LCB1bml0cyAke3RoaXMucy51bml0cy5sZW5ndGh9YCxcbiAgICAgIGBiYXR0bGVzIChuZXdlc3QgbGFzdCk6YCwgLi4uKHJvd3MubGVuZ3RoID8gcm93cyA6IFsnICAobm9uZSB5ZXQ6IHBsYXkgYSBiYXR0bGUsIHRoZW4gY29weSB0aGlzIGFnYWluKSddKV0uam9pbignXFxuJyk7XG4gIH1cblxuICAvKiogQSBydW4gdGhlIHBsYXllciBoYXMgcmVhbGx5IHN0YXJ0ZWQgKHNvIEhvbWUgY2FuIG9mZmVyIENvbnRpbnVlKS4gTnVsbCBhZnRlciBhIHN0YWdlIHdhcyB3b24gb3IgbG9zdCwgb3IgYmVmb3JlIGFueXRoaW5nIHdhcyBkb25lLiAqL1xuICBydW5JbmZvKCkgeyBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMgfHwgcy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBudWxsOyByZXR1cm4gKHMud2F2ZSA+IDEgfHwgcy51bml0cy5sZW5ndGggPiAwIHx8IHRoaXMuYXR0ZW1wdCA+IDAgfHwgcy5zdGF0cy5mYWlsdXJlcyA+IDApID8geyB3YXZlOiBzLndhdmUsIHRvdGFsOiBzdGFnZVdhdmVzKHMpLCBoZWFydHM6IHMuaGVhcnRzLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5TmFtZSwgc3RhZ2U6IGN1cnJlbnRTdGFnZUlkIH0gOiBudWxsOyB9XG4gIC8qKiBGcmVzaCBydW4gd2l0aCB0aGUgY3VycmVudGx5IGVxdWlwcGVkIFNvdWwgRGVjayAoSG9tZSA+IFN0YXJ0IEJhdHRsZSBjYWxscyB0aGlzKS4gKi9cbiAgLyoqIEdpdmUgdXAgdGhlIHJ1biBpbiBwcm9ncmVzcyAoSG9tZSA+IE5ldyBiYXR0bGUsIGFmdGVyIHRoZSBwbGF5ZXIgY29uZmlybXMpOiB0aGUgc2F2ZWQgcnVuIGlzIGRyb3BwZWQgYW5kIEhvbWUgbGV0cyB0aGVtIHBpY2sgYW55IHN0YWdlIG9yIG1vZGUuIEdvbGQgYW5kIHBhY2tzIGFscmVhZHkgZWFybmVkIHN0YXkuICovXG4gIGFiYW5kb25SdW4oKSB7IHRoaXMuc3RhcnRTdGFnZShNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IGNsZWFyUnVuKCk7IH1cbiAgbmV3UnVuKCkgeyB0aGlzLnN0YXJ0U3RhZ2UobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnc2VlZCcpID8gdGhpcy5zZWVkIDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMWU2KSArIDEpOyB9XG4gIHN0YXJ0U3RhZ2Uoc2VlZDogbnVtYmVyKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucmV3YXJkID0gbnVsbDsgdGhpcy5mbHVzaFR3ZWVucygpOyBpZiAodGhpcy5uZWNybykgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICB0aGlzLnJ1bkdvbGQgPSAwOyB0aGlzLmxhc3RHb2xkID0gMDsgdGhpcy5kYWlseSA9IG51bGw7IHRoaXMuZGFpbHlSZXdhcmQgPSBudWxsOyB0aGlzLnNlZWQgPSBzZWVkOyB0aGlzLmF0dGVtcHQgPSAwOyB0aGlzLmVuZGxlc3MgPSBudWxsOyBjb25zdCBzdiA9IGxvYWRTYXZlKCksIHBsID0gcGxheWFibGUoc3YpOyBzZXRTdGFnZURpZmZpY3VsdHkocGwuc3RhZ2UsIHBsLmRpZmZpY3VsdHkpOyB0aGlzLmFyZW5hLnNldFRoZW1lKGN1cnJlbnRTdGFnZUlkKTsgdGhpcy5zID0gbmV3U3RhZ2UoeyAuLi5QUk9UT1RZUEVfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpOyAgIC8vIChhIGJhdHRsZSBsZWZ0IGhhbGYtd2F5IGhhZCBoaWRkZW4gdGhlIGdyaWQpXG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KCdTdGFnZSBzdGFydDogNCBjYXJkcywgJyArIHRoaXMucy5jYXAgKyAnIERvbWluaW9uLiBTdW1tb24sIG1lcmdlLCB0aGVuIHByZXNzIEJBVFRMRS4nKTtcbiAgfVxuICAvKiogVG9kYXkncyBEYWlseSBDaGFsbGVuZ2UgKEhvbWUgPiBEYWlseSBDaGFsbGVuZ2UpOiB0aGUgc2FtZSBzZWVkIGFuZCB0d2lzdCBmb3IgZXZlcnlvbmUgb24gdGhlIHNhbWUgZGF5LiBSZXRyeSBhcyBvZnRlbiBhcyB5b3UgbGlrZTsgdGhlIHJld2FyZCBpcyBwYWlkIG9uY2UuICovXG4gIG5ld0RhaWx5KCkgeyB0aGlzLnN0YXJ0RGFpbHkoZGF5TnVtYmVyKCkpOyB9XG4gIHN0YXJ0RGFpbHkoZGF5OiBudW1iZXIpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5yZXdhcmQgPSBudWxsOyB0aGlzLmZsdXNoVHdlZW5zKCk7IGlmICh0aGlzLm5lY3JvKSB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIGNvbnN0IG1vZCA9IG1vZGlmaWVyRm9yKGRheSksIHN2ID0gbG9hZFNhdmUoKTsgc2V0RGFpbHkobW9kLCBkYXkpOyB0aGlzLmFyZW5hLnNldFRoZW1lKCdjcnlwdCcpO1xuICAgIHRoaXMucnVuR29sZCA9IDA7IHRoaXMubGFzdEdvbGQgPSAwOyB0aGlzLmRhaWx5UmV3YXJkID0gbnVsbDsgdGhpcy5lbmRsZXNzID0gbnVsbDsgdGhpcy5kYWlseSA9IHsgZGF5LCBtb2QgfTsgdGhpcy5zZWVkID0gZGF5OyB0aGlzLmF0dGVtcHQgPSAwO1xuICAgIHRoaXMucyA9IG5ld1N0YWdlKGRhaWx5UnVsZXMobW9kLCBzdi5kZWNrKSwgdGhpcy5zZWVkKTsgdGhpcy5zZWVuTWVyZ2VzID0gMDtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KGBEYWlseSBDaGFsbGVuZ2U6ICR7bW9kLm5hbWV9LiAke21vZC50ZXh0fWApO1xuICB9XG4gIC8qKiBGcmVzaCBFbmRsZXNzIERlcHRocyBydW4gKEhvbWUgPiBFbmRsZXNzIERlcHRocyBjYWxscyB0aGlzKTogc2FtZSBydWxlcyBhcyBhIHN0YWdlLCBidXQgdGhlIHdhdmVzIG5ldmVyIHN0b3AgYW5kIHRoZSBlbmVteSBrZWVwcyBncm93aW5nLiAqL1xuICBuZXdFbmRsZXNzKCkgeyB0aGlzLnN0YXJ0RW5kbGVzcyhuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdzZWVkJykgPyB0aGlzLnNlZWQgOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IH1cbiAgc3RhcnRFbmRsZXNzKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5ydW5Hb2xkID0gMDsgdGhpcy5sYXN0R29sZCA9IDA7IHRoaXMuZGFpbHkgPSBudWxsOyB0aGlzLmRhaWx5UmV3YXJkID0gbnVsbDsgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpOyBzZXRFbmRsZXNzKCk7IHRoaXMuYXJlbmEuc2V0VGhlbWUoRU5ETEVTU19JRCk7XG4gICAgdGhpcy5lbmRsZXNzID0geyBzdGFydEJlc3Q6IHN2LmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogMCwgcGFja3M6IDAgfTtcbiAgICB0aGlzLnMgPSBuZXdTdGFnZSh7IC4uLkVORExFU1NfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpOyAgIC8vIChhIGJhdHRsZSBsZWZ0IGhhbGYtd2F5IGhhZCBoaWRkZW4gdGhlIGdyaWQpXG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KCdFbmRsZXNzIERlcHRoczogaG93IGRlZXAgY2FuIHlvdSBnbz8gQSBTb3VsIFBhY2sgZXZlcnkgMTAgd2F2ZXMuJyk7XG4gIH1cbiAgcHJpdmF0ZSBjbGVhckJhdHRsZSgpIHtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYuZGlzcG9zZSgpOyB9KTsgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTsgdGhpcy5iYXR0bGUgPSBudWxsO1xuICAgIHRoaXMuYXJyb3dzLmZvckVhY2goKGEpID0+IGEubWVzaC5kaXNwb3NlKCkpOyB0aGlzLmFycm93cyA9IFtdO1xuICB9XG4gIHByaXZhdGUgcG9zKGNlbGw6IG51bWJlcikgeyByZXR1cm4gY2VsbFBvcygwLCBjZWxsKTsgfVxuICAvKiogRm9yIHRoZSB0dXRvcmlhbCBzcG90bGlnaHQ6IHdoZXJlIGFuIGVtcHR5IHRpbGUgKHRoZSBvbmUgbmVhcmVzdCB0aGUgbWlkZGxlIG9mIHRoZSBncmlkKSBpcyBvbiB0aGUgc2NyZWVuLCBpbiBDU1MgcGl4ZWxzLCBvciBudWxsLiAqL1xuICBlbXB0eVRpbGVSZWN0KCk6IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHc6IG51bWJlcjsgaDogbnVtYmVyIH0gfCBudWxsIHtcbiAgICBpZiAoIXRoaXMucyB8fCAhdGhpcy5jYW52YXMgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgdXNlZCA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodTogYW55KSA9PiB1LmNlbGwpKTsgbGV0IG14ID0gMCwgbXogPSAwOyBjb25zdCBhbGwgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBHUklEX0NFTExTIH0sIChfLCBjKSA9PiB0aGlzLnBvcyhjKSk7IGFsbC5mb3JFYWNoKChwKSA9PiB7IG14ICs9IHAueCAvIEdSSURfQ0VMTFM7IG16ICs9IHAueiAvIEdSSURfQ0VMTFM7IH0pO1xuICAgIGxldCBiZXN0ID0gLTEsIGJkID0gMWU5OyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBpZiAodXNlZC5oYXMoYykpIGNvbnRpbnVlOyBjb25zdCBkID0gTWF0aC5oeXBvdChhbGxbY10ueCAtIG14LCBhbGxbY10ueiAtIG16KTsgaWYgKGQgPCBiZCkgeyBiZCA9IGQ7IGJlc3QgPSBjOyB9IH1cbiAgICBpZiAoYmVzdCA8IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHAgPSBhbGxbYmVzdF0sIGggPSBHUklEX1NQICogMC40NiwgVyA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCksIEggPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdnAgPSB0aGlzLmNhbWVyYS52aWV3cG9ydC50b0dsb2JhbChXLCBIKSwgbSA9IHRoaXMuc2NlbmUuZ2V0VHJhbnNmb3JtTWF0cml4KCk7XG4gICAgY29uc3QgcHRzID0gW1staCwgLWhdLCBbaCwgLWhdLCBbaCwgaF0sIFstaCwgaF1dLm1hcCgoW2R4LCBkel0pID0+IEJBQllMT04uVmVjdG9yMy5Qcm9qZWN0KG5ldyBCQUJZTE9OLlZlY3RvcjMocC54ICsgZHgsIDAuMDIsIHAueiArIGR6KSwgQkFCWUxPTi5NYXRyaXguSWRlbnRpdHkoKSwgbSwgdnApKTtcbiAgICBjb25zdCByID0gdGhpcy5jYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCksIGt4ID0gci53aWR0aCAvIFcsIGt5ID0gci5oZWlnaHQgLyBILCB4cyA9IHB0cy5tYXAoKHE6IGFueSkgPT4gcS54KSwgeXMgPSBwdHMubWFwKChxOiBhbnkpID0+IHEueSk7XG4gICAgY29uc3QgeDAgPSBNYXRoLm1pbiguLi54cyksIHgxID0gTWF0aC5tYXgoLi4ueHMpLCB5MCA9IE1hdGgubWluKC4uLnlzKSwgeTEgPSBNYXRoLm1heCguLi55cyk7XG4gICAgaWYgKCFpc0Zpbml0ZSh4MCArIHgxICsgeTAgKyB5MSkpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IHg6IHIubGVmdCArIHgwICoga3gsIHk6IHIudG9wICsgeTAgKiBreSwgdzogKHgxIC0geDApICoga3gsIGg6ICh5MSAtIHkwKSAqIGt5IH07XG4gIH1cbiAgc3luY0J1aWxkKCkge1xuICAgIHRoaXMucGVyc2lzdFJ1bigpO1xuICAgIGNvbnN0IG1lcmdlZCA9IHRoaXMucy5zdGF0cy5tZXJnZXMgPiB0aGlzLnNlZW5NZXJnZXM7IHRoaXMuc2Vlbk1lcmdlcyA9IHRoaXMucy5zdGF0cy5tZXJnZXM7XG4gICAgY29uc3QgZ3Jvd24gPSBtZXJnZWQgPyB0aGlzLnMudW5pdHMuZmluZCgodSkgPT4geyBjb25zdCBndiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IHJldHVybiAhIWd2ICYmIGd2LnN0YXIgIT09IHUuc3RhcjsgfSkgOiB1bmRlZmluZWQ7ICAgLy8gdGhlIHVuaXQgdGhhdCBqdXN0IGdhaW5lZCBhIHN0YXJcbiAgICBjb25zdCBhbGl2ZSA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gdS5pZCkpO1xuICAgIGZvciAoY29uc3QgW2lkLCB2XSBvZiB0aGlzLnVuaXRWaXMpIGlmICghYWxpdmUuaGFzKGlkKSkge1xuICAgICAgdGhpcy52aXNUb1VuaXQuZGVsZXRlKHYpOyB0aGlzLnVuaXRWaXMuZGVsZXRlKGlkKTsgY29uc3QgcCA9IHYuaG9sZGVyLnBvc2l0aW9uO1xuICAgICAgaWYgKGdyb3duKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbWVyZ2U6IHRoZSBjb25zdW1lZCB1bml0IGlzIGRyYXduIGludG8gdGhlIHN1cnZpdm9yIGFuZCB2YW5pc2hlcyBpbiBhIGZsYXNoXG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3MoZ3Jvd24uY2VsbCksIHgwID0gcC54LCB6MCA9IHAueiwgc2MgPSB2LmhvbGRlci5zY2FsaW5nLng7IHYucGxheSgnaWRsZScpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuMzMsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC40LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHNjICogKDEgLSAwLjc1ICogdCkpOyB9LFxuICAgICAgICAgICgpID0+IHsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDE0KTsgdi5kaXNwb3NlKCk7IH0pO1xuICAgICAgfSBlbHNlIHsgdGhpcy5idXJzdChwLngsIHAueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxNik7IHYuZGlzcG9zZSgpOyB9XG4gICAgfVxuICAgIGNvbnN0IGx2bHMgPSBsb2FkU2F2ZSgpLnNvdWxzO1xuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHtcbiAgICAgIGxldCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7XG4gICAgICBpZiAoIXYpIHsgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHUuc291bCwgMCwgdS5zdGFyKTsgdGhpcy51bml0VmlzLnNldCh1LmlkLCB2KTsgdGhpcy52aXNUb1VuaXQuc2V0KHYsIHUuaWQpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7IGF1ZGlvLnBsYXkoJ3N1bW1vbicpOyBjb25zdCB2diA9IHY7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB2di5wbGF5KCdpZGxlJyk7IH0pOyB9XG4gICAgICBlbHNlIHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyBpZiAodi5zdGFyICE9PSB1LnN0YXIpIHsgY29uc3QgZnYgPSB2OyB2LnNldFN0YXIodS5zdGFyKTsgdGhpcy5sYXRlcihncm93biAmJiBncm93bi5pZCA9PT0gdS5pZCA/IDAuMzMgOiAwLCAoKSA9PiB0aGlzLm1lcmdlRngoZnYsIHAueCwgcC56KSk7IH0gfVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7IGNvbnN0IHZ2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgaWYgKHZ2ICYmIHZ2LnNldExldmVsKSB2di5zZXRMZXZlbCgobHZscyBhcyBhbnkpW3Uuc291bF0/LmxldmVsID8/IDEpOyB9XG4gICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHRoaXMudGludChjLCAnbm9ybWFsJyk7XG4gICAgY29uc3Qgc2VsID0gdGhpcy5zZWw7XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnICYmIHRoaXMucGhhc2UgPT09ICdidWlsZCcpIHtcbiAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoY2VsbEZyZWUodGhpcy5zLCBjKSkgdGhpcy50aW50KGMsIGNhblN1bW1vbih0aGlzLnMsIHNlbC5pZHgpID8gJ2ZyZWUnIDogJ25vcm1hbCcpO1xuICAgICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgaWYgKGNhbk1lcmdlRnJvbUhhbmQodGhpcy5zLCBzZWwuaWR4LCB1LmlkKSkgdGhpcy50aW50KHUuY2VsbCwgJ3BhcnRuZXInKTsgICAgIC8vIHRoZSBjYXJkIGNhbiBtZXJnZSBpbnRvIHRoaXMgdW5pdFxuICAgIH1cbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHtcbiAgICAgIGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gc2VsLmlkKTtcbiAgICAgIGlmICh1KSB7IHRoaXMudGludCh1LmNlbGwsICdzZWwnKTsgZm9yIChjb25zdCBvIG9mIHRoaXMucy51bml0cykgaWYgKGNhbk1lcmdlRGVwbG95ZWQodSwgbykpIHRoaXMudGludChvLmNlbGwsICdwYXJ0bmVyJyk7IGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoY2VsbEZyZWUodGhpcy5zLCBjKSkgdGhpcy50aW50KGMsICdmcmVlJyk7IH1cbiAgICB9XG4gIH1cbiAgLyoqIFRoZSBtZXJnZSBtb21lbnQ6IGEgZmxhc2ggb2YgcmluZ3MgYW5kIHNwYXJrcywgYSBwdW5jaCBpbiBzaXplLCBhIHJpc2luZyBjaGltZS4gKi9cbiAgcHJpdmF0ZSBtZXJnZUZ4KHY6IFVuaXRWaXN1YWwsIHg6IG51bWJlciwgejogbnVtYmVyKSB7XG4gICAgYXVkaW8ucGxheSgnbWVyZ2UnKTsgdi5wdWxzZSgpOyBjb25zdCB0YXJnZXQgPSB2LmhvbGRlci5zY2FsaW5nLng7XG4gICAgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuNCksIDAuMiwgMi4wLCAwLjY1KTsgdGhpcy5sYXRlcigwLjEyLCAoKSA9PiB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMSwgMSksIDAuMiwgMy4wLCAwLjgpKTtcbiAgICB0aGlzLmJ1cnN0KHgsIHosIFsxLCAwLjg1LCAwLjQsIDAuOV0sIFswLjgsIDAuNCwgMSwgMC44XSwgNDYpOyB0aGlzLmJ1cnN0KHgsIHosIFswLjg1LCAwLjYsIDEsIDAuOV0sIFswLjUsIDAuMywgMSwgMC43XSwgMjQpO1xuICAgIHRoaXMudHdlZW4oMC41NSwgKHQpID0+IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRhcmdldCAqICgxICsgMC40NSAqIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqICgxIC0gdCAqIDAuNCkpKSwgKCkgPT4gdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGFyZ2V0KSk7XG4gIH1cbiAgcHJpdmF0ZSBzdW1tb25GeCh4OiBudW1iZXIsIHo6IG51bWJlcikgeyB0aGlzLmJ1cnN0KHgsIHosIFswLjcsIDAuMywgMSwgMC45XSwgWzAuMzUsIDAuMSwgMC43LCAwLjhdLCAzMCk7IHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygwLjcsIDAuMywgMSksIDAuMiwgMS4yLCAwLjcpOyB9XG5cbiAgLy8gLS0tLSBwbGF5ZXIgYWN0aW9ucyAoYnVpbGQgcGhhc2UpXG4gIHRvYXN0KG1zZzogc3RyaW5nKSB7IHRoaXMudWkudG9hc3QobXNnKTsgfVxuICBvbkNhcmQoaWR4OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChkaXNjYXJkUmVkcmF3KHRoaXMucywgaWR4KSkgeyB0aGlzLnRvYXN0KCdTd2FwcGVkOiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuJyk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIHRoaXMuc2VsID0gdGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHRoaXMuc2VsLmlkeCA9PT0gaWR4ID8gbnVsbCA6IHsgdHlwZTogJ2NhcmQnLCBpZHggfTtcbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBvblRpbGUoY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgY29uc3QgaGVyZSA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5jZWxsID09PSBjZWxsKTsgaWYgKGhlcmUpIHsgdGhpcy5vblVuaXRWaXN1YWwodGhpcy51bml0VmlzLmdldChoZXJlLmlkKSEpOyByZXR1cm47IH1cbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcpIHtcbiAgICAgIGlmIChjYW5TdW1tb24ocywgc2VsLmlkeCkpIHsgc3VtbW9uKHMsIHNlbC5pZHgsIGNlbGwpOyB0aGlzLnNlbCA9IG51bGw7IH1cbiAgICAgIGVsc2UgeyBjb25zdCBzb3VsID0gcy5oYW5kW3NlbC5pZHhdOyB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uOiAke1NPVUxfTkFNRVtzb3VsXX0gY29zdHMgJHtjb3N0KHNvdWwsIDEpfSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7IH1cbiAgICB9IGVsc2UgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7IGlmIChtb3ZlVW5pdChzLCBzZWwuaWQsIGNlbGwpKSB0aGlzLnNlbCA9IG51bGw7IH1cbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBvblVuaXRWaXN1YWwodjogVW5pdFZpc3VhbCkge1xuICAgIGNvbnN0IGlkID0gdGhpcy52aXNUb1VuaXQuZ2V0KHYpOyBpZiAoaWQgPT09IHVuZGVmaW5lZCB8fCB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgY29uc3QgcyA9IHRoaXMucywgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpITtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoc3dhcFNlbGwocywgaWQpKSB7IHRoaXMudG9hc3QoYFNvbGQgJHtTT1VMX05BTUVbdS5zb3VsXX06IGRyZXcgYSBkaWZmZXJlbnQgU291bC5gKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCh1LmZyZXNoID8gXCJZb3UgY2FuJ3Qgc2VsbCBhIHVuaXQgeW91IHN1bW1vbmVkIHRoaXMgcm91bmQuXCIgOiAnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiBzLmhhbmRbdGhpcy5zZWwuaWR4XSA9PT0gdS5zb3VsICYmIHUuc3RhciA9PT0gMSAmJiBzLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJykge1xuICAgICAgaWYgKG1lcmdlRnJvbUhhbmQocywgdGhpcy5zZWwuaWR4LCBpZCkpIHsgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTsgdGhpcy50b2FzdChgTWVyZ2VkIHRoZSBjYXJkIGludG8gYSAyLXN0YXIgJHtTT1VMX05BTUVbdS5zb3VsXX0hYCk7IH1cbiAgICAgIGVsc2UgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbiB0byBtZXJnZTogaXQgbmVlZHMgJHtjb3N0KHUuc291bCwgMikgLSBjb3N0KHUuc291bCwgMSl9IG1vcmUsIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApO1xuICAgIH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgIT09IGlkKSB7XG4gICAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSAodGhpcy5zZWwgYXMgYW55KS5pZCkhO1xuICAgICAgaWYgKGNhbk1lcmdlRGVwbG95ZWQoYSwgdSkpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCB1LmlkKTsgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQ6IGEuaWQgfTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgfSBlbHNlIHRoaXMuc2VsID0gdGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkID09PSBpZCA/IG51bGwgOiB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBtZXJnZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gc2VsLmlkKTsgY29uc3QgYiA9IGEgJiYgcy51bml0cy5maW5kKChvKSA9PiBjYW5NZXJnZURlcGxveWVkKGEsIG8pKTtcbiAgICBpZiAoYSAmJiBiKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgYi5pZCk7IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnRvYXN0KCdObyBtYXRjaGluZyB1bml0IChzYW1lIFNvdWwgYW5kIHN0YXJzKSB0byBtZXJnZSB3aXRoLicpO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcmVtb3ZlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3Qgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBpZiAoIXRoaXMuY29uZmlybVJlbW92ZSkgeyB0aGlzLmNvbmZpcm1SZW1vdmUgPSB0cnVlOyB0aGlzLnRvYXN0KCdUYXAgUmVtb3ZlIGFnYWluIHRvIGNvbmZpcm0uIFRoZSBjYXJkIGlzIGdvbmUgZm9yIHRoaXMgc3RhZ2UuJyk7IHRoaXMudWkucmVuZGVyKCk7IHJldHVybjsgfVxuICAgIGRpc21pc3ModGhpcy5zLCBzZWwuaWQpOyB0aGlzLnNlbCA9IG51bGw7IHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHRvZ2dsZVN3YXAoKSB7IGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47IGlmICh0aGlzLnMuZGlzY2FyZFVzZWQpIHsgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgcmV0dXJuOyB9IHRoaXMuc3dhcE1vZGUgPSAhdGhpcy5zd2FwTW9kZTsgdGhpcy5zZWwgPSBudWxsOyBpZiAodGhpcy5zd2FwTW9kZSkgdGhpcy50b2FzdCgnU3dhcDogdGFwIGEgaGFuZCBjYXJkIHRvIGRpc2NhcmQsIG9yIGEgdW5pdCAobm90IHN1bW1vbmVkIHRoaXMgcm91bmQpIHRvIHNlbGwuJyk7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBiYXR0bGVcbiAgc3RhcnRCYXR0bGUoKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgIXRoaXMucy51bml0cy5sZW5ndGgpIHsgaWYgKCF0aGlzLnMudW5pdHMubGVuZ3RoKSB0aGlzLnRvYXN0KCdTdW1tb24gYXQgbGVhc3Qgb25lIHVuaXQgZmlyc3QuJyk7IHJldHVybjsgfVxuICAgIHRoaXMuZmx1c2hUd2VlbnMoKTsgYXVkaW8ucGxheSgnc3RhcnQnKTsgdGhpcy5iZWdpbkJhdHRsZVBlcmYoKTsgdGhpcy5zaG93R3JpZChmYWxzZSk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuYXR0ZW1wdCsrOyB0aGlzLmhhbmRsZWQgPSBmYWxzZTsgdGhpcy5yZXN1bHRBdCA9IC0xO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHVuaXRzID0gcy51bml0cy5zbGljZSgpO1xuICAgIGNvbnN0IHNhdmVkID0gbG9hZFNhdmUoKS5zb3VscywgbGV2ZWxzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307IGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhzYXZlZCkpIGxldmVsc1trXSA9IChzYXZlZCBhcyBhbnkpW2tdLmxldmVsOyAgIC8vIHBlcm1hbmVudCBTb3VsIGxldmVsc1xuICAgIHRoaXMuYmF0dGxlID0gbmV3IEJhdHRsZSh1bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpLCB0aGlzLnNlZWQgKiAxMzEgKyBzLndhdmUgKiAxNyArIHRoaXMuYXR0ZW1wdCwgbGV2ZWxzLCBlbmVteVBvd2VyKHMud2F2ZSkpO1xuICAgIHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7XG4gICAgdGhpcy5iYXR0bGUuZmlnaHRlcnMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgaWYgKGYudGVhbSA9PT0gMCkgeyBjb25zdCB1ID0gdW5pdHNbZi5pZCAtIDFdOyBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMuZlVuaXQuc2V0KGYuaWQsIHUuaWQpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB9XG4gICAgICBlbHNlIHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIGYuc291bCwgMSwgZi5zdGFyKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KGYueCwgMCwgZi56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IC1NYXRoLlBJIC8gMjsgaWYgKGYuYm9zcyAmJiB2LnNldEJvc3MpIHYuc2V0Qm9zcyh0cnVlKTsgdi5wbGF5KCdzcGF3bicpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmxhdGVyKDEuMSwgKCkgPT4geyBpZiAodi5zdGF0ZSA9PT0gJ3NwYXduJykgdi5wbGF5KCdpZGxlJyk7IH0pOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC43LCAwLjYsIDAuNSwgMC43XSwgWzAuNCwgMC4zNSwgMC4zLCAwLjZdLCAxNCk7IH1cbiAgICB9KTtcbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICB0aGlzLnBoYXNlID0gJ3RyYW5zaXRpb24nOyB0aGlzLnN0YXJ0U3RlcEF0ID0gMS4wOyB0aGlzLmFjYyA9IDA7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMi4yKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5iYXR0bGVSb2FyKCk7XG4gIH1cbiAgcHJpdmF0ZSBhcHBseUV2ZW50cyhldnM6IEJFdmVudFtdKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlITtcbiAgICBmb3IgKGNvbnN0IGUgb2YgZXZzKSB7XG4gICAgICBpZiAoZS50ID09PSAnc3dpbmcnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgdi5wbGF5KCdhdHRhY2snLCBlLnNwZWVkKTsgaWYgKE1hdGgucmFuZG9tKCkgPCAwLjA4KSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCk7IGlmIChmKSBhdWRpby5iYXJrKGYuc291bCwgMCwgZi50ZWFtID09PSAwID8gMSA6IDAuODUpOyB9IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2hpdCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS50byk7IGlmICh2KSB2LnB1bHNlKCk7IGlmIChlLmtpbmQgPT09ICdhcnJvdycpIGF1ZGlvLnBsYXkoJ2hpdEFycm93Jyk7IGVsc2UgaWYgKGUua2luZCA9PT0gJ21lbGVlJykgYXVkaW8ucGxheSgnaGl0Jyk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Fycm93JykgeyBjb25zdCBmID0gYi5ieUlkKGUuZnJvbSkhLCB0byA9IGIuYnlJZChlLnRvKSE7IHRoaXMuc3Bhd25BcnJvdyhmLnRlYW0sIGYueCwgZi56LCB0by54LCB0by56LCBlLmR1cik7IGF1ZGlvLnBsYXkoJ2Fycm93Jyk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2RlYXRoJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHsgdi5wbGF5KCdkZWF0aCcpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCdkZWF0aCcpOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDEyKTsgaWYgKGYudGVhbSA9PT0gMSkgdGhpcy5sYXRlcig1LCAoKSA9PiB7IGlmICh0aGlzLmZ2aXMuZ2V0KGUuaWQpID09PSB2ICYmIHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHsgdi5ob2xkZXIuc2V0RW5hYmxlZChmYWxzZSk7IH0gfSk7IH0gfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnY2FzdCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ2Nhc3QnKTsgdGhpcy5meFJpbmcoZi54LCBmLnosIG5ldyBCQUJZTE9OLkNvbG9yMygwLjUsIDAuOCwgMSksIDAuMTUsIDEuMSwgMC4zNSk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3RhdW50JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgndGF1bnQnKTsgdGhpcy5meFJpbmcoZi54LCBmLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjMpLCAwLjMsIEJBTEFOQ0UudGF1bnQucmFkaXVzLCAwLjYpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdzbWFzaCcpIHsgYXVkaW8ucGxheSgnc21hc2gnKTsgdGhpcy5meFJpbmcoZS54LCBlLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjUsIDAuMiksIDAuMiwgZS5yICogMS42LCAwLjQ1KTsgfVxuICAgIH1cbiAgfVxuICBwcml2YXRlIGFycm93QmFzZTogYW55W10gPSBbXTtcbiAgLyoqIFRoZSBhcnJvdydzIG93biBtYXRlcmlhbCB3aXRoIGEgZmFpbnQgZ2xvdyBpbiB0aGUgdGVhbSBjb2xvdXIgKHB1cnBsZSBmb3IgeW91cnMsIGFtYmVyIGZvciB0aGUgZW5lbXkncyksIHNvIHlvdSBjYW4gc3RpbGwgdGVsbCB3aG9zZSBpdCBpcy4gKi9cbiAgcHJpdmF0ZSBhcnJvd1RlYW1NYXQodGVhbTogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMuYXJyb3dCYXNlW3RlYW1dKSByZXR1cm4gdGhpcy5hcnJvd0Jhc2VbdGVhbV07XG4gICAgY29uc3Qgc3JjID0gdGhpcy5BLmFycm93Lm1hdGVyaWFscyAmJiB0aGlzLkEuYXJyb3cubWF0ZXJpYWxzWzBdOyBpZiAoIXNyYykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgbSA9IHNyYy5jbG9uZSgnYXJyb3dUJyArIHRlYW0pOyBjb25zdCBjID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjU1LCAwLjIsIDAuODUpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuOSwgMC41NSwgMC4xNSk7XG4gICAgaWYgKCdlbWlzc2l2ZUNvbG9yJyBpbiBtKSBtLmVtaXNzaXZlQ29sb3IgPSBjLnNjYWxlKDAuMDM1KTsgdGhpcy5hcnJvd0Jhc2VbdGVhbV0gPSBtOyByZXR1cm4gbTtcbiAgfVxuICBwcml2YXRlIHNwYXduQXJyb3codGVhbTogbnVtYmVyLCB4MDogbnVtYmVyLCB6MDogbnVtYmVyLCB4MTogbnVtYmVyLCB6MTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGxldCBtZXNoID0gdGhpcy5hcnJvd01lc2gucG9wKCk7XG4gICAgaWYgKCFtZXNoKSB7XG4gICAgICBjb25zdCBob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdhcicsIHRoaXMuc2NlbmUpOyBob2xkZXIuc2NhbGluZy5zZXRBbGwoMC42NSk7ICAgLy8gNTUgY20gd2FzIGxvbmcgbmV4dCB0byBhIGNoaWJpIEdvYmxpblxuICAgICAgaWYgKHRoaXMuQS5hcnJvdykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSByZWFsIGFycm93IG1vZGVsIChtZXRhbCBoZWFkLCBmbGV0Y2hpbmcpOiBvbmUgaW5zdGFuY2UgcGVyIGZseWluZyBhcnJvd1xuICAgICAgICBjb25zdCBlbnQgPSB0aGlzLkEuYXJyb3cuaW5zdGFudGlhdGVNb2RlbHNUb1NjZW5lKChuOiBzdHJpbmcpID0+IG4gKyAnXycgKyBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA2KSwgZmFsc2UpO1xuICAgICAgICBlbnQucm9vdE5vZGVzWzBdLnBhcmVudCA9IGhvbGRlcjsgZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmlzUGlja2FibGUgPSBmYWxzZTsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyB9KTtcbiAgICAgIH0gZWxzZSB7IGNvbnN0IGN5bCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2Fycm93JywgeyBoZWlnaHQ6IDAuNTUsIGRpYW1ldGVyOiAwLjAzNSB9LCB0aGlzLnNjZW5lKTsgY3lsLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgY3lsLmlzUGlja2FibGUgPSBmYWxzZTsgY3lsLnBhcmVudCA9IGhvbGRlcjsgY3lsLm1hdGVyaWFsID0gdGhpcy5hcnJvd01hdHNbdGVhbV07IH1cbiAgICAgIG1lc2ggPSBob2xkZXI7XG4gICAgfVxuICAgIG1lc2guc2V0RW5hYmxlZCh0cnVlKTtcbiAgICBpZiAodGhpcy5BLmFycm93KSB7IGNvbnN0IHRtID0gdGhpcy5hcnJvd1RlYW1NYXQodGVhbSk7IG1lc2guZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgaWYgKHRtKSBtLm1hdGVyaWFsID0gdG07IH0pOyB9XG4gICAgdGhpcy5hcnJvd3MucHVzaCh7IG1lc2gsIHgwLCB6MCwgeDEsIHoxLCB0OiAwLCBkdXIgfSk7XG4gIH1cblxuICAvKiogQmF0dGxlIGNyeTogdXAgdG8gdGhyZWUgZGlmZmVyZW50IFNvdWxzIGZyb20geW91ciBhcm15IGJlbGxvdyBpbiB0dXJuLCBhbmQgb25lIGZyb20gdGhlIGVuZW15IGFuc3dlcnMsIGEgbGl0dGxlIGxvd2VyLiAqL1xuICBwcml2YXRlIGJhdHRsZVJvYXIoKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlOyBpZiAoIWIpIHJldHVybjsgY29uc3QgbWluZSA9IG5ldyBTZXQ8c3RyaW5nPigpLCB0aGVpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykgKGYudGVhbSA9PT0gMCA/IG1pbmUgOiB0aGVpcnMpLmFkZChmLnNvdWwpO1xuICAgIFsuLi5taW5lXS5zbGljZSgwLCAzKS5mb3JFYWNoKChzb3VsLCBpKSA9PiBhdWRpby5iYXJrKHNvdWwsIDAuMTUgKyAwLjE2ICogaSwgMSkpOyBjb25zdCBlID0gWy4uLnRoZWlyc11bMF07IGlmIChlKSBhdWRpby5iYXJrKGUsIDAuNTUsIDAuODIpO1xuICB9XG5cbiAgcHJpdmF0ZSBmcmFtZShkdDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMuY2FudmFzLmNsaWVudFdpZHRoICE9PSB0aGlzLmxhc3RXIHx8IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCAhPT0gdGhpcy5sYXN0SCkgdGhpcy5oYW5kbGVSZXNpemUoKTsgICAvLyBlLmcuIHRoZSBob21lLXNjcmVlbiBhcHAgcmVzaXppbmcgYWZ0ZXIgbGF1bmNoXG4gICAgZm9yIChsZXQgaSA9IHRoaXMudGltZXJzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IHRoaXMudGltZXJzW2ldLnQgLT0gZHQ7IGlmICh0aGlzLnRpbWVyc1tpXS50IDw9IDApIHsgY29uc3QgZiA9IHRoaXMudGltZXJzW2ldLmZuOyB0aGlzLnRpbWVycy5zcGxpY2UoaSwgMSk7IGYoKTsgfSB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMucmluZ0Z4Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHIgPSB0aGlzLnJpbmdGeFtpXTsgci50ICs9IGR0OyBjb25zdCB1ID0gci50IC8gci5kdXIsIHMgPSByLnIwICsgKHIucjEgLSByLnIwKSAqIHU7IHIubS5zY2FsaW5nLnNldChzLCBzLCBzKTsgci5tbS5hbHBoYSA9IDAuOSAqICgxIC0gdSk7IGlmICh1ID49IDEpIHsgci5tLmRpc3Bvc2UoKTsgci5tbS5kaXNwb3NlKCk7IHRoaXMucmluZ0Z4LnNwbGljZShpLCAxKTsgfSB9XG4gICAgaWYgKHRoaXMuY2FtVCA8IDEpIHsgdGhpcy5jYW1UID0gTWF0aC5taW4oMSwgdGhpcy5jYW1UICsgZHQgLyB0aGlzLmNhbUR1cik7IGNvbnN0IGUgPSB0aGlzLmNhbVQgKiB0aGlzLmNhbVQgKiAoMyAtIDIgKiB0aGlzLmNhbVQpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS5wb3MsIHRoaXMuY2FtVG8ucG9zLCBlKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20udGd0LCB0aGlzLmNhbVRvLnRndCwgZSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnICYmIHRoaXMuY2FtTW9kZSA9PT0gJ2Nsb3NlJyAmJiAhdGhpcy5jaW5lKSB0aGlzLmZyYW1lQmF0dGxlKGR0KTtcbiAgICB0aGlzLm5lY3JvLnVwZGF0ZShkdCk7XG4gICAgZm9yIChsZXQgaSA9IHRoaXMudHdlZW5zLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHcgPSB0aGlzLnR3ZWVuc1tpXTsgdy50ICs9IGR0OyBjb25zdCB1ID0gTWF0aC5taW4oMSwgdy50IC8gdy5kdXIpOyB3LmZuKHUpOyBpZiAodSA+PSAxKSB7IHRoaXMudHdlZW5zLnNwbGljZShpLCAxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICAgIGZvciAoY29uc3QgdiBvZiB0aGlzLnVuaXRWaXMudmFsdWVzKCkpIHYudXBkYXRlKGR0KTtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYudXBkYXRlKGR0KTsgfSk7XG5cbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7XG4gICAgaWYgKCh0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicgfHwgdGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpICYmIGIpIHtcbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpIHsgdGhpcy5zdGFydFN0ZXBBdCAtPSBkdDsgaWYgKHRoaXMuc3RhcnRTdGVwQXQgPD0gMCkgeyB0aGlzLnBoYXNlID0gJ2JhdHRsZSc7IHRoaXMudWkucmVuZGVyKCk7IH0gfVxuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSB7XG4gICAgICAgIHRoaXMuYWNjICs9IGR0ICogdGhpcy50aW1lU2NhbGU7XG4gICAgICAgIHdoaWxlICh0aGlzLmFjYyA+PSAxIC8gMzAgJiYgYi53aW5uZXIgPCAwKSB7IGIuc3RlcCgxIC8gMzApOyB0aGlzLmFjYyAtPSAxIC8gMzA7IHRoaXMuYXBwbHlFdmVudHMoYi5kcmFpbigpKTsgfVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdikgY29udGludWU7XG4gICAgICAgIGlmICghdGhpcy5jaW5lICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCBmLnRlYW0gPT09IDEpKSB7IHYuaG9sZGVyLnBvc2l0aW9uLnggPSBmLng7IHYuaG9sZGVyLnBvc2l0aW9uLnogPSBmLno7IGlmIChmLmFsaXZlIHx8IHRydWUpIHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBmLnlhdzsgfVxuICAgICAgICBpZiAoZi5hbGl2ZSkgeyB2LnNldEhwKGYuaHAgLyBmLm1heEhwKTsgaWYgKGYubWF4TWFuYSkgdi5zZXRNYW5hKGYubWFuYSAvIGYubWF4TWFuYSk7IH1cbiAgICAgICAgZWxzZSB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmIChmLnN0YXRlICE9PSAnYXR0YWNrJyAmJiBmLmFsaXZlICYmIHYuc3RhdGUgIT09ICdjaGVlcicpIHsgY29uc3Qgd2FudCA9IGYuc3RhdGUgPT09ICdydW4nID8gJ3J1bicgOiAnaWRsZSc7IGlmICh0aGlzLmxhc3RTdGF0ZS5nZXQoZi5pZCkgIT09IHdhbnQgfHwgKHYuc3RhdGUgIT09IHdhbnQgJiYgdi5zdGF0ZSAhPT0gJ3NwYXduJykpIHsgaWYgKHYuc3RhdGUgIT09ICdzcGF3bicpIHsgdi5wbGF5KHdhbnQgYXMgYW55KTsgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsIHdhbnQpOyB9IH0gfVxuICAgICAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHRoaXMubGFzdFN0YXRlLnNldChmLmlkLCAnYXR0YWNrJyk7XG4gICAgICB9XG4gICAgICBpZiAoYi53aW5uZXIgPj0gMCAmJiAhdGhpcy5oYW5kbGVkKSB7IHRoaXMuaGFuZGxlZCA9IHRydWU7IHRoaXMucmVzdWx0QXQgPSAxLjQ7IH1cbiAgICAgIGlmICh0aGlzLnJlc3VsdEF0ID4gMCkgeyB0aGlzLnJlc3VsdEF0IC09IGR0OyBpZiAodGhpcy5yZXN1bHRBdCA8PSAwKSB0aGlzLmhhbmRsZVJlc3VsdCgpOyB9XG4gICAgfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLmFycm93cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgYSA9IHRoaXMuYXJyb3dzW2ldOyBhLnQgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTsgY29uc3QgdSA9IE1hdGgubWluKDEsIGEudCAvIGEuZHVyKTtcbiAgICAgIGNvbnN0IHB4ID0gYS54MCArIChhLngxIC0gYS54MCkgKiB1LCBweiA9IGEuejAgKyAoYS56MSAtIGEuejApICogdSwgcHkgPSAwLjc1ICsgTWF0aC5zaW4odSAqIE1hdGguUEkpICogMC45IC0gdSAqIDAuMjU7XG4gICAgICBjb25zdCB1MiA9IE1hdGgubWluKDEsIHUgKyAwLjAzKSwgcXggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUyLCBxeiA9IGEuejAgKyAoYS56MSAtIGEuejApICogdTIsIHF5ID0gMC43NSArIE1hdGguc2luKHUyICogTWF0aC5QSSkgKiAwLjkgLSB1MiAqIDAuMjU7XG4gICAgICBhLm1lc2gucG9zaXRpb24uc2V0KHB4LCBweSwgcHopOyBhLm1lc2gubG9va0F0KG5ldyBCQUJZTE9OLlZlY3RvcjMocXgsIHF5LCBxeikpO1xuICAgICAgaWYgKHUgPj0gMSkgeyBhLm1lc2guc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuYXJyb3dNZXNoLnB1c2goYS5tZXNoKTsgdGhpcy5hcnJvd3Muc3BsaWNlKGksIDEpOyB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVSZXN1bHQoKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlISwgcyA9IHRoaXMucztcbiAgICB0aGlzLmVuZEJhdHRsZVBlcmYoKTtcbiAgICB0aGlzLmxhc3RCYXR0bGUgPSBgd2F2ZSAke3Mud2F2ZX0gYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH06ICR7Yi53aW5uZXIgPT09IDAgPyAnV09OJyA6ICdMT1NUJ30gaW4gJHtiLnRpbWUudG9GaXhlZCgxKX1zLCAke2IuY291bnQoMCl9IG9mIHlvdXJzIGFuZCAke2IuY291bnQoMSl9IGVuZW1pZXMgbGVmdGA7XG4gICAgaWYgKGIud2lubmVyID09PSAwKSB7XG4gICAgICB0aGlzLnBsYXlSZXN1bHQoJ3dpbicsICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgYXJteSBpcyByYWlzZWQgYWdhaW4sIHRoZW4gdGhlIG5leHQgd2F2ZSAvIHRoZSBkcmFmdFxuICAgICAgICB0aGlzLmNpbmUgPSBmYWxzZTtcbiAgICAgICAgdHJ5IHsgdGhpcy5sYXN0R29sZCA9IHRoaXMuZGFpbHkgPyAwIDogYWRkR29sZEFuZFNhdmUoaXNFbmRsZXNzKCkgPyBlbmRsZXNzV2F2ZUdvbGQocy53YXZlKSA6IHdhdmVHb2xkKGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5TmFtZSBhcyBhbnkpKTsgdGhpcy5ydW5Hb2xkICs9IHRoaXMubGFzdEdvbGQ7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2F2ZS1jaGFuZ2VkJykpOyB9IGNhdGNoIHsgdGhpcy5sYXN0R29sZCA9IDA7IH1cbiAgICAgICAgaWYgKGlzRW5kbGVzcygpICYmIHRoaXMuZW5kbGVzcykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByID0gcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlKHMud2F2ZSk7IHRoaXMuZW5kbGVzcy5jbGVhcmVkID0gcy53YXZlOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNhdmUtY2hhbmdlZCcpKTtcbiAgICAgICAgICAgIGlmIChyLnBhY2spIHsgdGhpcy5lbmRsZXNzLnBhY2tzKys7IHRoaXMudG9hc3QoJ1dhdmUgJyArIHMud2F2ZSArICcgY2xlYXJlZCEgWW91IGVhcm5lZCBhIFNvdWwgUGFjayAoc2VlIHRoZSBTaG9wKS4nKTsgfVxuICAgICAgICAgIH0gY2F0Y2ggeyAvKiBzYXZpbmcgbXVzdCBuZXZlciBicmVhayBhIHJ1biAqLyB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGFkdmFuY2VXYXZlKHMpKSB7XG4gICAgICAgICAgdGhpcy5waGFzZSA9ICd3b24nOyBjbGVhclJ1bigpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAodGhpcy5kYWlseSkgeyB0aGlzLmRhaWx5UmV3YXJkID0gcmVjb3JkRGFpbHlXaW5BbmRTYXZlKHRoaXMuZGFpbHkuZGF5KTsgdGhpcy5yZXdhcmQgPSBudWxsOyB9IGVsc2UgdGhpcy5yZXdhcmQgPSByZWNvcmRDbGVhckFuZFNhdmUoY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lIGFzIGFueSk7XG4gICAgICAgICAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNhdmUtY2hhbmdlZCcpKTtcbiAgICAgICAgICB9IGNhdGNoIHsgdGhpcy5yZXdhcmQgPSBudWxsOyB9XG4gICAgICAgICAgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZHJhZnQgPSBkcmFmdE9wdGlvbnMocyk7IHRoaXMucGhhc2UgPSAnZHJhZnQnOyB0aGlzLnBlcnNpc3RSdW4oKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmYWlsV2F2ZShzKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy51aS5wdWxzZUhlYXJ0cygpOyAgICAgICAgICAgICAgICAgICAvLyB0aGUgaGVhcnQgaXMgbG9zdCB0aGUgbW9tZW50IGhlIGlzIGhpdFxuICAgICAgaWYgKHMuc3RhdHVzID09PSAnbG9zdCcpIHRoaXMucGxheVJlc3VsdCgnZmluYWwnLCAoKSA9PiB7IHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnBoYXNlID0gJ2xvc3QnOyBjbGVhclJ1bigpOyB0aGlzLnVpLnJlbmRlcigpOyB9KTtcbiAgICAgIGVsc2UgdGhpcy5wbGF5UmVzdWx0KCdsb3NzJywgKCkgPT4geyB0aGlzLnRvYXN0KCdZb3VyIGFybXkgZmVsbC4gLTEgaGVhcnQsICsxIGNhcmQsIHNhbWUgd2F2ZS4gUmVidWlsZCBhIGRpZmZlcmVudCBzdHJhdGVneS4nKTsgdGhpcy50b0J1aWxkKCk7IH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gcmVzdWx0IGN1dHNjZW5lcyAocGxhbiBzZWN0aW9ucyAxOS0yMik6IHRoZSBOZWNyb21hbmNlciB0YWtlcyB0aGUgaGl0LCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUsIHJhaXNlcyB0aGUgZmFsbGVuXG4gIHByaXZhdGUgcGxheVJlc3VsdChraW5kOiAnd2luJyB8ICdsb3NzJyB8ICdmaW5hbCcsIGRvbmU6ICgpID0+IHZvaWQpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBuID0gdGhpcy5uZWNybzsgdGhpcy5jaW5lID0gdHJ1ZTsgaWYgKGtpbmQgIT09ICd3aW4nKSB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5uZWNybywgMS4xKTtcbiAgICBjb25zdCBob21lID0gKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGV2ZXJ5IGZhbGxlbiBhbGx5IGlzIHB1bGxlZCBiYWNrIHRvIGl0cyBncmlkIHRpbGUgYW5kIHN0YW5kcyB1cFxuICAgICAgbi5jYXN0KCk7IGF1ZGlvLnBsYXkoJ3Jlc3VycmVjdCcpOyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFswLjg1LCAwLjUsIDEsIDAuOV0sIFswLjUsIDAuMiwgMSwgMC43XSwgMzApO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgaWYgKGYudGVhbSAhPT0gMCkgY29udGludWU7IGNvbnN0IHVpZCA9IHRoaXMuZlVuaXQuZ2V0KGYuaWQpLCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVpZCksIHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXUgfHwgIXYpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0byA9IHRoaXMucG9zKHUuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmICghZi5hbGl2ZSkgeyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuYnVyc3QoeDAsIHowLCBbMC43NSwgMC40LCAxLCAwLjldLCBbMC40LCAwLjE1LCAwLjksIDAuN10sIDE4KTsgdGhpcy5meFJpbmcoeDAsIHowLCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjM1LCAxKSwgMC4zLCAxLjYsIDAuNyk7IH1cbiAgICAgICAgdGhpcy50d2VlbigxLjAsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC41LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgKz0gKE1hdGguUEkgLyAyIC0gdi5ob2xkZXIucm90YXRpb24ueSkgKiBNYXRoLm1pbigxLCB0ICogMC41ICsgMC4xKTsgfSxcbiAgICAgICAgICAoKSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnkgPSAwOyB0aGlzLmJ1cnN0KHRvLngsIHRvLnosIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTApOyB9KTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGlmIChraW5kID09PSAnd2luJykge1xuICAgICAgLy8gdGhlIHN1cnZpdm9ycyBjZWxlYnJhdGUgcmlnaHQgd2hlcmUgdGhleSBzdGFuZCAocHVyZWx5IHZpc3VhbCksIFRIRU4gdGhlIGNhbWVyYSBzd2luZ3MgdG8gdGhlIE5lY3JvbWFuY2VyIGFuZCB0aGUgYXJteSBpcyByYWlzZWRcbiAgICAgIGF1ZGlvLnBsYXkoJ3ZpY3RvcnknKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSBpZiAoZi50ZWFtID09PSAwICYmIGYuYWxpdmUpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICh2KSB0aGlzLmxhdGVyKE1hdGgucmFuZG9tKCkgKiAwLjM1LCAoKSA9PiB7IHYucGxheSgnY2hlZXInKTsgYXVkaW8uYmFyayhmLnNvdWwpOyB9KTsgfVxuICAgICAgdGhpcy5sYXRlcigxLjYsICgpID0+IHsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7IG4uY2FzdCgpOyB9KTtcbiAgICAgIHRoaXMubGF0ZXIoMS44NSwgaG9tZSk7IHRoaXMubGF0ZXIoMy42LCBkb25lKTsgcmV0dXJuO1xuICAgIH1cbiAgICBuLmh1cnQoKTsgYXVkaW8ucGxheSgnaGVhcnRMb3N0Jyk7IHRoaXMubGF0ZXIoMC4xNSwgKCkgPT4geyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjMsIDAuMywgMC45XSwgWzAuOCwgMC4xLCAwLjIsIDAuNl0sIDE2KTsgfSk7XG4gICAgaWYgKGtpbmQgPT09ICdmaW5hbCcpIHsgdGhpcy5sYXRlcigwLjYsICgpID0+IHsgbi5kZWZlYXQoKTsgYXVkaW8ucGxheSgnZGVmZWF0Jyk7IH0pOyB0aGlzLmxhdGVyKDIuNiwgZG9uZSk7IHJldHVybjsgfVxuICAgIHRoaXMubGF0ZXIoMS4wLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwdWxzaW9uIHNob2Nrd2F2ZTogc3Vydml2b3JzIGFyZSBmbHVuZyBiYWNrIHRvIHdoZXJlIHRoZXkgc3RhcnRlZCBhbmQgaGVhbCB0byBmdWxsXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgnc2hvY2t3YXZlJyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTtcbiAgICAgIHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDAuODUsIDAuNTUsIDEpLCAwLjYsIDMwLCAxLjEpOyB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC40LCAyMiwgMC44KTtcbiAgICAgIHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjg1LCAxLCAwLjldLCBbMC43LCAwLjQsIDEsIDAuN10sIDQwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDEgfHwgIWYuYWxpdmUpIGNvbnRpbnVlOyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSBjZWxsUG9zKDEsIGYuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnB1bHNlKCk7XG4gICAgICAgIHRoaXMudHdlZW4oMC45LCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuOSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LnNldEhwKGYuaHAgLyBmLm1heEhwICsgKDEgLSBmLmhwIC8gZi5tYXhIcCkgKiB0KTsgfSwgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdi5zZXRIcCgxKTsgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5sYXRlcigyLjMsIGhvbWUpOyB0aGlzLmxhdGVyKDMuNywgZG9uZSk7XG4gIH1cbiAgcGlja0RyYWZ0KGlkeDogbnVtYmVyKSB7IGlmICghdGhpcy5kcmFmdCkgcmV0dXJuOyB0YWtlRHJhZnQodGhpcy5zLCB0aGlzLmRyYWZ0LCBpZHgpOyB0aGlzLmRyYWZ0ID0gbnVsbDsgbm9ybWFsRHJhdyh0aGlzLnMpOyB0aGlzLnRvQnVpbGQoKTsgfVxuICBwcml2YXRlIHRvQnVpbGQoKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMubmVjcm8ucmV2aXZlKCk7IHRoaXMuZmx1c2hUd2VlbnMoKTtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgeyAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVzdXJyZWN0aW9uOiBldmVyeW9uZSByaXNlcyBhZ2FpbiBhdCBmdWxsIGhlYWx0aFxuICAgICAgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LmhvbGRlci5zZXRFbmFibGVkKHRydWUpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7XG4gICAgICB0aGlzLmxhdGVyKDEuMSwgKCkgPT4gdi5wbGF5KCdpZGxlJykpO1xuICAgIH1cbiAgICB0aGlzLnBoYXNlID0gJ2J1aWxkJzsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyAgICAgICAgICAvLyBVSSBmaXJzdDogdGhlIGNhbWVyYSBtdXN0IG1lYXN1cmUgdGhlIGhhbmQgYW5kIGJ1dHRvbnMgd2hpbGUgdGhleSBhcmUgdmlzaWJsZVxuICAgIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJ1aWxkLCAxLjgpO1xuICB9XG4gIC8qKiAyeCBhbmQgNHggYmF0dGxlIHNwZWVkIG9wZW4gb25jZSB0aGUgY2FtcGFpZ24gaXMgZmluaXNoZWQgKHRoZSBsYXN0IHN0YWdlIGNsZWFyZWQgb24gTm9ybWFsKS4gP2RlYnVnIG9yID9zcGVlZD0xIG9wZW5zIHRoZW0gZm9yIHRlc3RpbmcuICovXG4gIHNwZWVkVW5sb2NrZWQoKTogYm9vbGVhbiB7IGNvbnN0IHEgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCk7IHJldHVybiAhIShxLmdldCgnZGVidWcnKSB8fCBxLmdldCgnc3BlZWQnKSkgfHwgZW5kbGVzc1VubG9ja2VkKGxvYWRTYXZlKCkpOyB9XG4gIHNldFNwZWVkKGs6IG51bWJlcikge1xuICAgIGlmIChrID4gMSAmJiAhdGhpcy5zcGVlZFVubG9ja2VkKCkpIHJldHVybjtcbiAgICB0aGlzLnRpbWVTY2FsZSA9IGs7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBoZWxwZXJzXG4gIGFwcGx5QmFsYW5jZUNoYW5nZSgpIHsgdGhpcy51bml0VmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOyBpZiAodSkgdi5zZXRTdGFyKHUuc3Rhcik7IH0pOyB9XG4gIHRlc3RPZGRzKG4gPSAyMDApIHtcbiAgICBjb25zdCBzbG90cyA9IHRoaXMucy51bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVtaWVzID0gZW5lbXlXYXZlKHRoaXMucy53YXZlLCB0aGlzLnNlZWQpOyBsZXQgd2luID0gMCwgdCA9IDA7XG4gICAgY29uc3QgbHY6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fSwgc3YgPSBsb2FkU2F2ZSgpLnNvdWxzOyBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoc3YpKSBsdltrXSA9IChzdiBhcyBhbnkpW2tdLmxldmVsO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7IGNvbnN0IHIgPSBzaW11bGF0ZShzbG90cywgZW5lbWllcywgNTAwMCArIGksIDEzMCwgbHYsIGVuZW15UG93ZXIoKSk7IGlmIChyLndpbm5lciA9PT0gMCkgd2luKys7IHQgKz0gci50aW1lOyB9XG4gICAgcmV0dXJuIHsgd2luOiBNYXRoLnJvdW5kKCh3aW4gLyBuKSAqIDEwMCksIGF2Z1RpbWU6ICsodCAvIG4pLnRvRml4ZWQoMSksIG4gfTtcbiAgfVxuICBhZGRDYXJkKHNvdWw6IFNvdWxJZCkgeyB0aGlzLnMuaGFuZC5wdXNoKHNvdWwpOyB0aGlzLnMuc3RhdHMuZHJhd24rKzsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICBhZGREb21pbmlvbihuOiBudW1iZXIpIHsgdGhpcy5zLmNhcCArPSBuOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIHJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIGVuID0gZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKTtcbiAgICByZXR1cm4gW2BzdGFnZSAke2N1cnJlbnRTdGFnZUlkfS8ke2RpZmZpY3VsdHlOYW1lfSAgc2VlZCAke3RoaXMuc2VlZH0gIHdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX0gIGhlYXJ0cyAke3MuaGVhcnRzfSAgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9ICBwaGFzZSAke3RoaXMucGhhc2V9ICBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fWAsXG4gICAgICBgaGFuZDogJHtzLmhhbmQuam9pbignLCAnKSB8fCAnKGVtcHR5KSd9YCwgYGFybXk6ICR7cy51bml0cy5tYXAoKHUpID0+IGAke3Uuc291bH0ke3Uuc3Rhcn1AJHt1LmNlbGx9YCkuam9pbignICcpIHx8ICcobm9uZSknfWAsIGBlbmVteTogJHtlbi5tYXAoKGUpID0+IGUuc291bCArIGUuc3Rhcikuam9pbignICcpfWAsXG4gICAgICBgZGlmZmljdWx0eTogJHtkaWZmaWN1bHR5TmFtZX0gIG1lcmdlLWZyb20taGFuZDogJHtzLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJ30gIHN3YXAgdXNlZDogJHtzLmRpc2NhcmRVc2VkfWAsIGBsYXN0IHRhcDogJHt0aGlzLmxhc3RUYXBJbmZvfWAsIGBzY3JlZW46ICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSBkcHIgJHt3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpb31gLCBgbGFzdCBiYXR0bGU6ICR7dGhpcy5sYXN0QmF0dGxlIHx8ICctJ31gLCBgbG9nIHRhaWw6YCwgLi4ucy5sb2cuc2xpY2UoLTgpLCBgYmFsYW5jZTogJHtKU09OLnN0cmluZ2lmeSh7IHN0YXI6IEJBTEFOQ0Uuc3Rhciwgc3RhdHM6IEJBTEFOQ0Uuc3RhdHMgfSl9YF0uam9pbignXFxuJyk7XG4gIH1cbiAgcmVzZXRCYWxhbmNlQWxsKCkgeyByZXNldEJhbGFuY2UoKTsgdGhpcy5hcHBseUJhbGFuY2VDaGFuZ2UoKTsgfVxuICBnZXQgZGlmZmljdWx0eSgpIHsgcmV0dXJuIGRpZmZpY3VsdHlOYW1lOyB9XG4gIGNoYW5nZURpZmZpY3VsdHkobmFtZTogc3RyaW5nKSB7IHNldERpZmZpY3VsdHkobmFtZSk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudG9hc3QoYERpZmZpY3VsdHk6ICR7bmFtZX0uIEFwcGxpZXMgdG8gdGhlIG5leHQgYmF0dGxlLmApOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZ2FsbGVyeSAoc3RhciBsb29rcylcbiAgZ2FsbGVyeSgpIHtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5hZGQoJ2dhbGxlcnknKTsgdGhpcy5uZWNyby5zZXRFbmFibGVkKGZhbHNlKTsgY29uc3QgdmlzOiBVbml0VmlzdWFsW10gPSBbXTsgbGV0IHRlYW06IDAgfCAxID0gMDtcbiAgICBjb25zdCByZWJ1aWxkID0gKCkgPT4geyB2aXMuZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB2aXMubGVuZ3RoID0gMDsgU09VTFMuZm9yRWFjaCgoc291bCwgaSkgPT4gWzEsIDIsIDNdLmZvckVhY2goKHN0LCBqKSA9PiB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBzb3VsLCB0ZWFtLCBzdCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCgoaSAtIDIuNSkgKiAyLjUsIDAsIChqIC0gMSkgKiAtMi40KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgKiAwLjg1OyB2LnBsYXkoJ2lkbGUnKTsgdmlzLnB1c2godik7IH0pKTsgfTtcbiAgICByZWJ1aWxkKCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLnNldCgwLCA1LjYsIC0xNC41KTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAtMC40KSk7IHRoaXMuY2FtZXJhLmZvdiA9IDAuODU7XG4gICAgKHdpbmRvdyBhcyBhbnkpLl9fZ2FsbGVyeSA9IHsgc2V0VGVhbTogKHQ6IDAgfCAxKSA9PiB7IHRlYW0gPSB0OyByZWJ1aWxkKCk7IH0sIHZpcyB9O1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7IHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBuID0gcGVyZm9ybWFuY2Uubm93KCksIGR0ID0gTWF0aC5taW4oMC4wNSwgKG4gLSBsYXN0KSAvIDEwMDApOyBsYXN0ID0gbjsgdmlzLmZvckVhY2goKHYpID0+IHYudXBkYXRlKGR0KSk7IHRoaXMuc2NlbmUucmVuZGVyKCk7IH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgR2FtZSB9IGZyb20gJy4vZ2FtZS50cyc7XG5cbmNvbnN0IGcgPSBuZXcgR2FtZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fZ2FtZSA9IGc7ICAgICAgICAgICAgICAgICAgICAgICAvLyBoYW5keSBmb3IgZGVidWdnaW5nIGZyb20gdGhlIGJyb3dzZXIgY29uc29sZVxuZy5pbml0KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjJykgYXMgSFRNTENhbnZhc0VsZW1lbnQpXG4gIC50aGVuKCgpID0+IHsgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSBsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7ICh3aW5kb3cgYXMgYW55KS5fX2dhbWVSZWFkeSA9IHRydWU7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ2FtZS1yZWFkeScpKTsgfSlcbiAgLmNhdGNoKChlKSA9PiB7XG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSB7IGwuc3R5bGUuZGlzcGxheSA9ICdmbGV4JzsgbC50ZXh0Q29udGVudCA9ICdFcnJvcjogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IGUpOyB9XG4gICAgY29uc29sZS5lcnJvcihlKTtcbiAgfSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFvQ08sTUFBTSxXQUFvQjtBQUFBLElBQy9CLE9BQU87QUFBQSxNQUNMLFNBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sR0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLE1BQzlHLFFBQVcsRUFBRSxJQUFJLEtBQUssS0FBSyxHQUFJLFVBQVUsS0FB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TCxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE9BQU8sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFDckosRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsR0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEdBQUssS0FBSyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNwTCxFQUFFLE1BQU0sU0FBUyxHQUFHLElBQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEdBQUssR0FBRyxLQUFLO0FBQUEsSUFDL0ksRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsRUFDeE47QUFDQSxNQUFNLG1CQUFnQztBQUFBO0FBQUEsSUFDcEMsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQ2xFLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUN4TSxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLEdBQUssS0FBSyxJQUFJO0FBQUEsSUFDck0sRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUNuSCxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDdEksRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNySCxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUNuTixFQUFFLE1BQU0sU0FBUyxHQUFHLEdBQUcsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxFQUN2TjtBQUNBLE1BQU0saUJBQThCO0FBQUE7QUFBQSxJQUNsQyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxHQUFHLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDMUgsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUN2SyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxLQUFLLEtBQUssTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLO0FBQUEsSUFDek0sRUFBRSxNQUFNLFVBQVUsR0FBRyxPQUFPLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUM1RyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE9BQU8sR0FBRyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUNsUCxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUM5TyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsSUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsRUFDbEs7QUFLQSxNQUFNLFNBQWdDO0FBQUEsSUFDcEMsT0FBTyxFQUFFLFFBQVEsY0FBYyxPQUFPLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxLQUFLLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLENBQUMsTUFBTSxNQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxNQUFNLENBQUMsTUFBTSxNQUFNLElBQUksRUFBRTtBQUFBLElBQzVNLFdBQVcsRUFBRSxRQUFRLGtCQUFrQixPQUFPLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsTUFBTSxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxLQUFLLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxNQUFNLENBQUMsS0FBSyxLQUFLLElBQUksRUFB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QUk7QUFBRztBQUFBLFFBQ3hHLEtBQUs7QUFBVSxXQUFDLEdBQUcsTUFBTSxJQUFJLEVBQUUsUUFBUSxDQUFDLElBQUksTUFBTSxFQUFFLE1BQU0sSUFBSSxJQUFJLEtBQUssWUFBWSxNQUFNLElBQUksTUFBTSxJQUFJLElBQUksTUFBTyxJQUFJLENBQUM7QUFBRyxZQUFFLEtBQUssTUFBTSxZQUFZLE1BQU0sQ0FBQztBQUFHO0FBQUEsUUFDN0osS0FBSztBQUFVLFlBQUUsS0FBSyxNQUFNLFlBQVksTUFBTSxHQUFHLEtBQUssTUFBTSxHQUFHO0FBQUcsWUFBRSxLQUFLLEtBQUssVUFBVSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRyxZQUFFLE1BQU0sTUFBTSxZQUFZLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDM0osS0FBSztBQUFRLFlBQUUsSUFBSSxNQUFNLFlBQVksS0FBSyxHQUFHLElBQUksTUFBTSxHQUFHO0FBQUcsWUFBRSxLQUFLLEtBQUssWUFBWSxNQUFNLE1BQU0sSUFBSSxNQUFNLEdBQUc7QUFBRyxZQUFFLEtBQUssTUFBTSxXQUFXLEtBQUssTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUMxSixLQUFLO0FBQWEsWUFBRSxLQUFLLEtBQUssWUFBWSxNQUFNLEdBQUcsS0FBSyxNQUFNLElBQUk7QUFBRyxZQUFFLEtBQUssTUFBTSxZQUFZLE1BQU0sS0FBSyxLQUFLLE1BQU0sSUFBSTtBQUFHLFlBQUUsTUFBTSxLQUFLLFlBQVksS0FBSyxHQUFHLEdBQUc7QUFBRztBQUFBLE1BQ3BLO0FBQUEsSUFDRjtBQUFBLElBQ0EsS0FBSyxNQUFXO0FBQ2QsVUFBSSxDQUFDLEtBQUssT0FBTyxDQUFDLEtBQUssT0FBTyxLQUFLLElBQUksVUFBVSxVQUFXO0FBQzVELGNBQVEsTUFBTTtBQUFBLFFBQ1osS0FBSztBQUFPLGNBQUksQ0FBQyxLQUFLLFNBQVMsT0FBTyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ2hHLEtBQUs7QUFBVSxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBSyxHQUFHLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksS0FBSyxHQUFHLEtBQUssTUFBTSxJQUFJO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLEtBQUssSUFBSTtBQUFHO0FBQUEsUUFDbEssS0FBSztBQUFTLFdBQUMsS0FBSyxLQUFLLEtBQUssSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLEtBQUssSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDdE8sS0FBSztBQUFPLGNBQUksQ0FBQyxLQUFLLFNBQVMsT0FBTyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxNQUFNLFdBQVcsSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsRUFBRTtBQUFHO0FBQUEsUUFDdEksS0FBSztBQUFZLGNBQUksQ0FBQyxLQUFLLFNBQVMsUUFBUSxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxNQUFNLFlBQVksR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxNQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDbEosS0FBSztBQUFTLGVBQUssS0FBSyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUcsRUFBRTtBQUFHLGVBQUssS0FBSyxNQUFNLE1BQU0sV0FBVyxLQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDdkcsS0FBSztBQUFTLGNBQUksQ0FBQyxLQUFLLFNBQVMsU0FBUyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxLQUFLLFlBQVksTUFBTSxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ3hHLEtBQUs7QUFBUyxjQUFJLENBQUMsS0FBSyxTQUFTLFNBQVMsRUFBRSxFQUFHO0FBQVEsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDaEgsS0FBSztBQUFRLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsS0FBSyxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLEtBQUssTUFBTSxNQUFNLElBQUk7QUFBRyxlQUFLLEtBQUssTUFBTSxNQUFNLFFBQVEsTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUM5SixLQUFLO0FBQVMsZUFBSyxLQUFLLEtBQUssS0FBSyxVQUFVLE1BQU0sR0FBRyxLQUFLLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQ25JLEtBQUs7QUFBYSxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsS0FBSyxHQUFHLElBQUksSUFBSTtBQUFHLGVBQUssS0FBSyxHQUFLLE1BQU0sV0FBVyxLQUFNLEdBQUcsR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxNQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDM0osS0FBSztBQUFhLFdBQUMsS0FBSyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksS0FBSyxJQUFJLE1BQU0sSUFBSSxNQUFNLEdBQUcsQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQ3pLLEtBQUs7QUFBYSxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxXQUFXLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFVBQVUsTUFBTSxNQUFNLEtBQUssTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUM1SyxLQUFLO0FBQVcsV0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxHQUFHO0FBQUc7QUFBQSxRQUN6SSxLQUFLO0FBQVUsV0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssSUFBSSxLQUFLLFFBQVEsS0FBSyxHQUFHO0FBQUc7QUFBQSxRQUN0SixLQUFLO0FBQVUsV0FBQyxNQUFNLE1BQU0sTUFBTSxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTTtBQUFFLGlCQUFLLEtBQUssTUFBTSxNQUFNLFlBQVksTUFBTSxJQUFJLEtBQUssQ0FBQztBQUFHLGlCQUFLLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxVQUFVLE1BQU0sR0FBRyxRQUFXLE1BQU8sR0FBRztBQUFBLFVBQUcsQ0FBQztBQUFHLFdBQUMsS0FBSyxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sTUFBTSxFQUFFO0FBQUc7QUFBQSxRQUNuWCxLQUFLO0FBQWMsZUFBSyxLQUFLLElBQUksTUFBTSxRQUFRLE1BQU0sR0FBRyxLQUFLLEdBQUc7QUFBRyxlQUFLLEtBQUssTUFBTSxNQUFNLFdBQVcsS0FBSyxHQUFHLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxHQUFLLFlBQVksTUFBTSxLQUFLLEtBQUssR0FBRztBQUFHO0FBQUEsUUFDekssS0FBSztBQUFjLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLEtBQUssSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEtBQU0sR0FBRztBQUFHO0FBQUEsUUFDOUwsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLEtBQUssWUFBWSxNQUFNLEdBQUcsR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLE1BQU0sRUFBRTtBQUFHLFdBQUMsTUFBTSxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQzFNLEtBQUs7QUFBVyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDbkcsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUN0RyxLQUFLO0FBQVksZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLE1BQU0sT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDN0gsS0FBSztBQUFZLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEtBQUssS0FBSyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLEtB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T0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLE9BQU8sR0FBRyxHQUFLLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxVQUFVLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxTQUFTLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxVQUFVLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxHQUFHLFFBQVEsQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sVUFBVSxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sU0FBUyxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsQ0FBQyxHQUFHLE1BQU0sa0JBQWtCLENBQUM7QUFBQSxNQUM5ZixDQUFDLGFBQWEsaUJBQWlCLHVCQUF1QixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsR0FBSyxNQUFNLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sWUFBWSxHQUFHLEVBQUUsTUFBTSxTQUFTLE9BQU8sSUFBSSxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxHQUFHLFFBQVEsQ0FBQyxFQUFFLE1BQU0sU0FBUyxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sWUFBWSxDQUFDLEdBQUcsTUFBTSxxQkFBcUIsQ0FBQztBQUFBLE1BQzdaLENBQUMsUUFBUSxZQUFZLGtCQUFrQixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsTUFBTSxNQUFNLEVBQUUsV0FBVyxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUcsUUFBUSxFQUFFLE9BQU8sQ0FB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ZSxPQUFZO0FBQUUsY0FBTSxJQUFJLFNBQVMsUUFBUSxRQUFRLFlBQVksVUFBVSxLQUFLLE1BQU0sQ0FBQyxJQUFJLFNBQVMsUUFBUSxRQUFRLFlBQVksZUFBZSxLQUFLLE1BQU0sQ0FBQyxJQUFJLFFBQVEsWUFBWSxhQUFhLEtBQUssTUFBTSxDQUFDO0FBQUcsVUFBRSxTQUFTLEtBQUs7QUFBSSxVQUFFLFNBQVMsSUFBSSxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztBQUFHLFVBQUUsV0FBVztBQUFJLFVBQUUsYUFBYTtBQUFPLGVBQU87QUFBQSxNQUFHO0FBQ3BYLFVBQUksRUFBRSxXQUFXLFNBQVUsSUFBRyxHQUFHLE9BQU8sRUFBRSxPQUFPLE1BQU0sUUFBUSxLQUFLLE9BQU8sS0FBSyxHQUFHLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxJQUFJO0FBQ3hHLFVBQUksRUFBRSxXQUFXLFVBQVU7QUFBRSxXQUFHLEdBQUcsT0FBTyxFQUFFLE9BQU8sTUFBTSxRQUFRLEtBQUssT0FBTyxLQUFLLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLElBQUk7QUFBRyxjQUFNLEtBQUssUUFBUSxZQUFZLGVBQWUsTUFBTSxFQUFFLFFBQVEsTUFBTSxVQUFVLEtBQUssR0FBRyxDQUFDO0FBQUcsV0FBRyxTQUFTLEtBQUs7QUFBSyxXQUFHLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxXQUFHLFNBQVMsSUFBSSxDQUFDLEVBQUUsSUFBSSxLQUFLLE9BQU8sRUFBRSxJQUFJLEtBQUssSUFBSTtBQUFHLFdBQUcsV0FBVyxJQUFJLFNBQVM7QUFBRyxXQUFHLGFBQWE7QUFBQSxNQUFPO0FBQ3BXLFVBQUksRUFBRSxXQUFXLFFBQVE7QUFBRSxXQUFHLEdBQUcsT0FBTyxFQUFFLFFBQVEsS0FBSyxVQUFVLEtBQUssR0FBRyxDQUFDLEdBQUcsT0FBTyxHQUFHLEdBQUcsRUFBRTtBQUFHLFdBQUcsR0FBRyxPQUFPLEVBQUUsVUFBVSxJQUFJLEdBQUcsQ0FBQyxHQUFHLE9BQU8s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LFFBQUUsU0FBUyxJQUFJLEdBQUcsR0FBRyxDQUFDO0FBQUcsUUFBRSxRQUFRLE9BQU8sQ0FBQztBQUFHLFFBQUUsU0FBUyxJQUFJO0FBQU0sV0FBSyxLQUFLLFFBQVEsQ0FBQyxNQUFPLEVBQUUsU0FBUyxJQUFJLENBQUU7QUFDdkksVUFBSSxLQUFLLFVBQVUsT0FBUSxHQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsSUFBSTtBQUFBLGVBQzFELEtBQUssVUFBVSxPQUFPO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSTtBQUFJLFVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDLElBQUk7QUFBTSxVQUFFLFNBQVMsSUFBSTtBQUFLLGFBQUssS0FBSyxDQUFDLEVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxhQUFLLEtBQUssQ0FBQyxFQUFFLFNBQVMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBQSxNQUFLLFdBQ3BQLEtBQUssVUFBVSxVQUFVO0FBQUUsY0FBTSxJQUFJLElBQUksTUFBTSxRQUFRLElBQUksT0FBTyxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksSUFBSSxPQUFPLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxLQUFLLENBQUM7QUFBQSxNQUFHLFdBQzFOLEtBQUssVUFBVSxTQUFTO0FBQUUsY0FBTSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUk7QUFBSSxVQUFFLFFBQVEsT0FBTyxPQUFPLE9BQU8sQ0FBQztBQUFHLFVBQUUsU0FBUyxLQUFLLElBQUksS0FBSztBQUFBLE1BQUssV0FDMUgsS0FBSyxVQUFVLFNBQVM7QUFBRSxjQUFNLElBQUksSUFBSTtBQUFH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STtBQUNuRixVQUFJLE9BQU8sWUFBWSxJQUFJO0FBQUcsV0FBSyxPQUFPLGNBQWMsTUFBTTtBQUFFLGNBQU0sSUFBSSxZQUFZLElBQUksR0FBRyxLQUFLLEtBQUssSUFBSSxPQUFPLElBQUksUUFBUSxHQUFJO0FBQUcsZUFBTztBQUFHLFlBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUFHLGFBQUssTUFBTSxPQUFPO0FBQUEsTUFBRyxDQUFDO0FBQUEsSUFDek07QUFBQSxFQUNGOzs7QUMzbkJBLE1BQU0sSUFBSSxJQUFJLEtBQUs7QUFDbkIsRUFBQyxPQUFlLFNBQVM7QUFDekIsSUFBRSxLQUFLLFNBQVMsZUFBZSxHQUFHLENBQXNCLEVBQ3JELEtBQUssTUFBTTtBQUFFLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksRUFBRyxHQUFFLE1BQU0sVUFBVTtBQUFRLElBQUMsT0FBZSxjQUFjO0FBQU0sV0FBTyxjQUFjLElBQUksTUFBTSxrQkFBa0IsQ0FBQztBQUFBLEVBQUcsQ0FBQyxFQUN0TCxNQUFNLENBQUMsTUFBTTtBQUNaLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksR0FBRztBQUFFLFFBQUUsTUFBTSxVQUFVO0FBQVEsUUFBRSxjQUFjLGFBQWEsS0FBSyxFQUFFLFVBQVUsRUFBRSxVQUFVO0FBQUEsSUFBSTtBQUMvSSxZQUFRLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLENBQUM7IiwKICAibmFtZXMiOiBbImciLCAiY29zdCIsICJlbmVteVBvd2VyIiwgInRnIiwgIk1BWF9VTklUUyIsICJnIiwgImciLCAiZyIsICJLRVkiLCAiVkVSU0lPTiIsICJzdGFnZVdhdmVzIiwgImRyYXciLCAiZyIsICJnIiwgInYiLCAicCJdCn0K
