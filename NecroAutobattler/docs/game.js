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
      this.ps.dispose(false);
      this.ent.animationGroups.forEach((g2) => g2.dispose());
      this.ent.skeletons.forEach((s) => s.dispose());
      this.holder.getChildMeshes().forEach((m) => m.dispose());
      this.holder.dispose();
    }
  };

  // game/vfx.ts
  var dyn = (scene, w, h, draw2) => {
    const t = new BABYLON.DynamicTexture("vfx", { width: w, height: h }, scene, true);
    draw2(t.getContext());
    t.update();
    t.hasAlpha = true;
    return t;
  };
  var Vfx = class {
    constructor(scene, engine, camera, host, soft) {
      __publicField(this, "scene", scene);
      __publicField(this, "engine", engine);
      __publicField(this, "camera", camera);
      __publicField(this, "soft", soft);
      __publicField(this, "pools", {});
      __publicField(this, "next", {});
      __publicField(this, "timed", []);
      __publicField(this, "layer");
      __publicField(this, "pending", /* @__PURE__ */ new Map());
      __publicField(this, "shakeMag", 0);
      __publicField(this, "shakeT", 0);
      __publicField(this, "shakeDur", 0);
      __publicField(this, "off", new BABYLON.Vector3(0, 0, 0));
      __publicField(this, "numbersOn", true);
      __publicField(this, "spark");
      __publicField(this, "runeTex");
      __publicField(this, "beamTex");
      __publicField(this, "flashEl");
      this.spark = dyn(scene, 64, 64, (c) => {
        const g2 = c.createRadialGradient(32, 32, 0, 32, 32, 30);
        g2.addColorStop(0, "rgba(255,255,255,1)");
        g2.addColorStop(0.25, "rgba(255,255,255,.55)");
        g2.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g2;
        c.fillRect(0, 0, 64, 64);
        c.fillStyle = "rgba(255,255,255,.95)";
        c.fillRect(30, 2, 4, 60);
        c.fillRect(2, 30, 60, 4);
      });
      this.beamTex = dyn(scene, 8, 256, (c) => {
        const g2 = c.createLinearGradient(0, 0, 0, 256);
        g2.addColorStop(0, "rgba(255,255,255,0)");
        g2.addColorStop(0.7, "rgba(255,255,255,.55)");
        g2.addColorStop(1, "rgba(255,255,255,1)");
        c.fillStyle = g2;
        c.fillRect(0, 0, 8, 256);
      });
      this.runeTex = dyn(scene, 512, 512, (c) => {
        c.translate(256, 256);
        c.strokeStyle = "#fff";
        c.lineCap = "round";
        for (const [r, w] of [[236, 6], [214, 3], [150, 3]]) {
          c.lineWidth = w;
          c.beginPath();
          c.arc(0, 0, r, 0, Math.PI * 2);
          c.stroke();
        }
        c.lineWidth = 5;
        for (let i = 0; i < 36; i++) {
          const a = i / 36 * Math.PI * 2;
          c.save();
          c.rotate(a);
          c.beginPath();
          c.moveTo(0, -172);
          c.lineTo(0, -i % 3 === 0 ? 208 : 190);
          c.stroke();
          c.restore();
        }
        c.lineWidth = 4;
        c.beginPath();
        for (let i = 0; i <= 10; i++) {
          const a = i * 2 / 5 * Math.PI + 0;
          const x = Math.sin(a) * 146, y = -Math.cos(a) * 146;
          if (i) c.lineTo(x, y);
          else c.moveTo(x, y);
        }
        c.stroke();
        c.lineWidth = 3;
        for (let i = 0; i < 8; i++) {
          c.save();
          c.rotate(i / 8 * Math.PI * 2);
          c.beginPath();
          c.moveTo(-10, -100);
          c.lineTo(0, -116);
          c.lineTo(10, -100);
          c.moveTo(0, -116);
          c.lineTo(0, -84);
          c.stroke();
          c.restore();
        }
      });
      this.makePool("spark", 12, 24, this.spark, true);
      this.makePool("trail", 10, 10, this.soft, true);
      this.makePool("wisp", 6, 30, this.soft, true);
      this.makePool("bone", 6, 24, this.soft, false);
      this.makePool("dust", 4, 40, this.soft, false);
      this.makePool("wave", 2, 260, this.soft, true);
      if (!document.getElementById("vfx-css")) {
        const s = document.createElement("style");
        s.id = "vfx-css";
        s.textContent = `#fxlayer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6}
.dmgn{position:absolute;font:900 clamp(12px,2.7vmin,20px) system-ui,sans-serif;color:#ffe27a;text-shadow:0 2px 0 #150d26,0 0 6px #150d26,0 0 2px #150d26;transform:translate(-50%,-50%);animation:dmgup .8s ease-out forwards;will-change:transform,opacity;white-space:nowrap}
.dmgn.theirs{color:#ff7a7a}.dmgn.big{font-size:clamp(17px,3.8vmin,28px);color:#fff3b0}.dmgn.theirs.big{color:#ffb0b0}
@keyframes dmgup{0%{opacity:0;transform:translate(-50%,-10%) scale(.5)}14%{opacity:1;transform:translate(-50%,-60%) scale(1.2)}100%{opacity:0;transform:translate(-50%,-230%) scale(.9)}}
#fxflash{position:absolute;inset:0;pointer-events:none;z-index:7;opacity:0}
@keyframes fxflash{0%{opacity:var(--fa)}100%{opacity:0}}`;
        document.head.appendChild(s);
      }
      this.layer = document.getElementById("fxlayer") || Object.assign(document.createElement("div"), { id: "fxlayer" });
      if (!this.layer.parentElement) host.appendChild(this.layer);
      this.flashEl = document.getElementById("fxflash") || Object.assign(document.createElement("div"), { id: "fxflash" });
      if (!this.flashEl.parentElement) host.appendChild(this.flashEl);
    }
    // ---------------------------------------------------------------- pools
    makePool(kind, n, cap, tex, add) {
      const list = [];
      for (let i = 0; i < n; i++) {
        const at = new BABYLON.Vector3(0, -50, 0), ps = new BABYLON.ParticleSystem(kind + i, cap, this.scene);
        ps.particleTexture = tex;
        ps.emitter = at;
        ps.emitRate = 0;
        ps.manualEmitCount = 0;
        ps.minEmitBox = ps.maxEmitBox = new BABYLON.Vector3(0, 0, 0);
        ps.blendMode = add ? BABYLON.ParticleSystem.BLENDMODE_ONEONE : BABYLON.ParticleSystem.BLENDMODE_STANDARD;
        ps.isLocal = false;
        ps.updateSpeed = 0.02;
        this.config(kind, ps);
        ps.start();
        list.push({ ps, at });
      }
      this.pools[kind] = list;
      this.next[kind] = 0;
    }
    config(kind, ps) {
      const C4 = (r, g2, b, a) => new BABYLON.Color4(r, g2, b, a), V = (x, y, z) => new BABYLON.Vector3(x, y, z);
      if (kind === "spark") {
        ps.minSize = 0.07;
        ps.maxSize = 0.17;
        ps.minLifeTime = 0.14;
        ps.maxLifeTime = 0.34;
        ps.direction1 = V(-1, 0.2, -1);
        ps.direction2 = V(1, 1.3, 1);
        ps.minEmitPower = 1.2;
        ps.maxEmitPower = 3.2;
        ps.gravity = V(0, -7, 0);
        ps.color1 = C4(1, 0.95, 0.7, 1);
        ps.color2 = C4(1, 0.7, 0.35, 1);
        ps.colorDead = C4(0.4, 0.1, 0.1, 0);
      } else if (kind === "trail") {
        ps.minSize = 0.05;
        ps.maxSize = 0.11;
        ps.minLifeTime = 0.18;
        ps.maxLifeTime = 0.3;
        ps.direction1 = V(-0.1, -0.05, -0.1);
        ps.direction2 = V(0.1, 0.1, 0.1);
        ps.minEmitPower = 0.1;
        ps.maxEmitPower = 0.3;
        ps.color1 = C4(1, 0.9, 0.6, 0.8);
        ps.color2 = C4(0.8, 0.6, 1, 0.6);
        ps.colorDead = C4(0.2, 0.1, 0.3, 0);
      } else if (kind === "wisp") {
        ps.minSize = 0.14;
        ps.maxSize = 0.3;
        ps.minLifeTime = 0.9;
        ps.maxLifeTime = 1.5;
        ps.direction1 = V(-0.25, 1, -0.25);
        ps.direction2 = V(0.25, 2, 0.25);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 1.1;
        ps.gravity = V(0, 0.4, 0);
        ps.color1 = C4(0.35, 1, 0.9, 0.9);
        ps.color2 = C4(0.2, 0.65, 1, 0.7);
        ps.colorDead = C4(0.05, 0.25, 0.4, 0);
        ps.minAngularSpeed = -2;
        ps.maxAngularSpeed = 2;
      } else if (kind === "bone") {
        ps.minSize = 0.12;
        ps.maxSize = 0.26;
        ps.minLifeTime = 0.5;
        ps.maxLifeTime = 0.9;
        ps.direction1 = V(-1, 0.4, -1);
        ps.direction2 = V(1, 1.4, 1);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 1.4;
        ps.gravity = V(0, -3, 0);
        ps.color1 = C4(0.92, 0.86, 0.74, 0.85);
        ps.color2 = C4(0.6, 0.5, 0.45, 0.7);
        ps.colorDead = C4(0.4, 0.35, 0.3, 0);
      } else if (kind === "dust") {
        ps.minSize = 0.32;
        ps.maxSize = 0.7;
        ps.minLifeTime = 0.5;
        ps.maxLifeTime = 0.95;
        ps.minEmitPower = 2.2;
        ps.maxEmitPower = 3.6;
        ps.gravity = V(0, -0.4, 0);
        ps.color1 = C4(0.62, 0.55, 0.5, 0.55);
        ps.color2 = C4(0.45, 0.4, 0.4, 0.45);
        ps.colorDead = C4(0.3, 0.27, 0.27, 0);
        ps.startDirectionFunction = (_m, d) => {
          const a = Math.random() * Math.PI * 2;
          d.set(Math.cos(a), 0.06 + Math.random() * 0.2, Math.sin(a));
        };
      } else if (kind === "wave") {
        ps.minSize = 0.35;
        ps.maxSize = 0.8;
        ps.minLifeTime = 0.9;
        ps.maxLifeTime = 1.3;
        ps.minEmitPower = 16;
        ps.maxEmitPower = 24;
        ps.color1 = C4(0.95, 0.6, 1, 0.9);
        ps.color2 = C4(0.5, 0.25, 1, 0.8);
        ps.colorDead = C4(0.15, 0.05, 0.3, 0);
        ps.startDirectionFunction = (_m, d) => {
          const a = Math.random() * Math.PI * 2;
          d.set(Math.cos(a), 0.05 + Math.random() * 0.12, Math.sin(a));
        };
      }
    }
    emit(kind, x, y, z, n, tweak) {
      const list = this.pools[kind], i = this.next[kind];
      this.next[kind] = (i + 1) % list.length;
      const p = list[i];
      p.at.set(x, y, z);
      if (tweak) tweak(p.ps);
      p.ps.manualEmitCount = n;
    }
    add(dur, fn, done) {
      this.timed.push({ t: 0, dur, fn, done });
    }
    // ---------------------------------------------------------------- combat feedback
    /** A blow landed. `mine`: dealt by your army. `big`: a heavy hit (smash, boss, big share of health). */
    hit(id, x, z, top, dmg, mine, big, kind) {
      this.emit("spark", x, top * 0.55, z, big ? 10 : 5, (ps) => {
        if (mine) {
          ps.color1 = new BABYLON.Color4(0.85, 0.7, 1, 1);
          ps.color2 = new BABYLON.Color4(1, 0.9, 0.7, 1);
        } else {
          ps.color1 = new BABYLON.Color4(1, 0.55, 0.4, 1);
          ps.color2 = new BABYLON.Color4(1, 0.85, 0.5, 1);
        }
      });
      let p = this.pending.get(id);
      if (!p) {
        p = { dmg: 0, t: 0, x, y: top, z, mine, big: false };
        this.pending.set(id, p);
      }
      p.dmg += dmg;
      p.big = p.big || big;
      p.x = x;
      p.z = z;
      p.y = top;
    }
    flushNumbers(dt) {
      if (this.pending.size === 0) return;
      const e = this.engine, canvas = e.getRenderingCanvas(), k = canvas.clientWidth / Math.max(1, e.getRenderWidth());
      let shown = 0;
      for (const [id, p] of this.pending) {
        p.t += dt;
        if (p.t < 0.28) continue;
        this.pending.delete(id);
        if (!this.numbersOn || shown >= 6 || this.layer.childElementCount > 26) continue;
        const v = BABYLON.Vector3.Project(new BABYLON.Vector3(p.x, p.y + 0.35, p.z), BABYLON.Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(e.getRenderWidth(), e.getRenderHeight()));
        if (v.z < 0 || v.z > 1) continue;
        shown++;
        const d = document.createElement("div");
        d.className = "dmgn" + (p.mine ? "" : " theirs") + (p.big ? " big" : "");
        d.textContent = String(Math.max(1, Math.round(p.dmg)));
        d.style.left = v.x * k + (Math.random() * 14 - 7) + "px";
        d.style.top = v.y * k + "px";
        this.layer.appendChild(d);
        setTimeout(() => d.remove(), 850);
      }
    }
    /** A fighter fell: your own units crumble into bone dust, enemy souls rise as teal wisps toward the Necromancer. */
    death(x, z, enemy, top) {
      if (enemy) {
        this.emit("wisp", x, top * 0.5, z, 12);
        this.emit("spark", x, top * 0.4, z, 6, (ps) => {
          ps.color1 = new BABYLON.Color4(0.4, 1, 0.9, 1);
          ps.color2 = new BABYLON.Color4(0.6, 0.8, 1, 1);
        });
      } else {
        this.emit("bone", x, top * 0.45, z, 12);
        this.emit("dust", x, 0.08, z, 6, (ps) => {
          ps.minEmitPower = 0.8;
          ps.maxEmitPower = 1.6;
        });
      }
    }
    /** A heavy blow hits the ground: a ring of dust, a few stones and a small shake. */
    slam(x, z, r) {
      this.emit("dust", x, 0.1, z, 16, (ps) => {
        ps.minEmitPower = 2.2 * Math.min(1.6, r / 1.5 + 0.4);
        ps.maxEmitPower = 3.6 * Math.min(1.6, r / 1.5 + 0.4);
      });
      this.emit("spark", x, 0.15, z, 8, (ps) => {
        ps.color1 = new BABYLON.Color4(0.9, 0.7, 0.45, 1);
        ps.color2 = new BABYLON.Color4(0.7, 0.55, 0.4, 1);
      });
      this.shake(0.05, 0.22);
    }
    /** An arrow in flight leaves a short glint. */
    trail(x, y, z, mine) {
      this.emit("trail", x, y, z, 2, (ps) => {
        if (mine) {
          ps.color1 = new BABYLON.Color4(0.85, 0.65, 1, 0.8);
          ps.color2 = new BABYLON.Color4(0.6, 0.4, 1, 0.6);
        } else {
          ps.color1 = new BABYLON.Color4(1, 0.75, 0.4, 0.8);
          ps.color2 = new BABYLON.Color4(1, 0.5, 0.25, 0.6);
        }
      });
    }
    // ---------------------------------------------------------------- big moments
    /** A column of light: the moment something powerful arrives. */
    pillar(x, z, col, height = 7, width = 0.9, dur = 0.9) {
      const s = this.scene, m = BABYLON.MeshBuilder.CreateCylinder("pillar", { height, diameterTop: width * 0.45, diameterBottom: width, tessellation: 22, cap: 0 }, s);
      m.position.set(x, height / 2, z);
      m.isPickable = false;
      const mat = new BABYLON.StandardMaterial("pillarm", s);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(col[0] * 0.7, col[1] * 0.7, col[2] * 0.7);
      mat.diffuseTexture = this.beamTex;
      mat.useAlphaFromDiffuseTexture = true;
      mat.backFaceCulling = false;
      mat.alphaMode = BABYLON.Engine.ALPHA_ADD;
      m.material = mat;
      this.add(dur, (u) => {
        const grow = Math.min(1, u * 6), fade = 1 - u;
        m.scaling.set(grow * (1.1 - 0.7 * u), 1, grow * (1.1 - 0.7 * u));
        mat.alpha = fade;
      }, () => {
        m.dispose();
        mat.dispose();
      });
    }
    /** A glowing rune circle on the floor that spins and fades. */
    rune(x, z, radius, col, dur = 1.6, spin = 1.2) {
      const s = this.scene, m = BABYLON.MeshBuilder.CreateDisc("rune", { radius: 1, tessellation: 48 }, s);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, 0.045, z);
      m.isPickable = false;
      const mat = new BABYLON.StandardMaterial("runem", s);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(...col);
      mat.diffuseTexture = this.runeTex;
      mat.useAlphaFromDiffuseTexture = true;
      mat.backFaceCulling = false;
      mat.alphaMode = BABYLON.Engine.ALPHA_ADD;
      m.material = mat;
      this.add(dur, (u) => {
        const inn = Math.min(1, u * 5), out = 1 - Math.max(0, (u - 0.6) / 0.4);
        m.scaling.setAll(radius * (0.4 + 0.6 * inn));
        mat.alpha = inn * out;
        m.rotation.y = u * spin * 3;
      }, () => {
        m.dispose();
        mat.dispose();
      });
    }
    /** The Necromancer's repulsion shockwave: a dark dome, a wall of rolling energy along the ground, a flash and a heavy shake. */
    shock(x, z, maxR) {
      const s = this.scene, dome = BABYLON.MeshBuilder.CreateSphere("dome", { diameter: 2, segments: 20 }, s);
      dome.position.set(x, 0, z);
      dome.isPickable = false;
      const mat = new BABYLON.StandardMaterial("domem", s);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(0.55, 0.2, 0.95);
      mat.backFaceCulling = false;
      mat.alpha = 0.3;
      mat.alphaMode = BABYLON.Engine.ALPHA_ADD;
      dome.material = mat;
      this.add(1, (u) => {
        const r = 0.6 + (maxR - 0.6) * (1 - Math.pow(1 - u, 2.2));
        dome.scaling.set(r, r * 0.22, r);
        mat.alpha = 0.34 * Math.pow(1 - u, 1.5);
      }, () => {
        dome.dispose();
        mat.dispose();
      });
      this.emit("wave", x, 0.25, z, 240, (ps) => {
        ps.minEmitPower = 16;
        ps.maxEmitPower = 24;
      });
      this.emit("dust", x, 0.1, z, 22, (ps) => {
        ps.minEmitPower = 7;
        ps.maxEmitPower = 12;
        ps.color1 = new BABYLON.Color4(0.45, 0.35, 0.6, 0.55);
        ps.color2 = new BABYLON.Color4(0.3, 0.2, 0.45, 0.45);
      });
      this.rune(x, z, 3.2, [0.7, 0.35, 1], 1.3, 2.2);
      this.pillar(x, z, [0.75, 0.4, 1], 9, 1.3, 0.8);
      this.flash([0.75, 0.45, 1], 0.55, 0.45);
      this.shake(0.28, 0.6);
    }
    /** A fresh Soul or merged Soul lands: a pillar of light and a rune circle (bigger for higher stars). */
    arrive(x, z, star) {
      const col = star >= 3 ? [0.8, 0.4, 1] : star === 2 ? [0.6, 0.75, 1] : [0.65, 0.4, 1];
      this.pillar(x, z, col, star >= 3 ? 8 : star === 2 ? 4.4 : 3, 0.5 + star * 0.3, 0.5 + star * 0.25);
      if (star >= 2) this.rune(x, z, 1.2 + star * 0.35, col, 1 + star * 0.3, 2);
      if (star >= 3) {
        this.flash([0.75, 0.45, 1], 0.4, 0.4);
        this.shake(0.12, 0.35);
        this.emit("wave", x, 0.2, z, 90, (ps) => {
          ps.minEmitPower = 5;
          ps.maxEmitPower = 9;
        });
      }
    }
    /** The enemy boss steps out: dark pulse, slam, shake. */
    bossIntro(x, z) {
      this.pillar(x, z, [1, 0.3, 0.25], 8, 1.4, 1.1);
      this.rune(x, z, 2.6, [1, 0.35, 0.3], 1.6, -1.4);
      this.flash([1, 0.25, 0.2], 0.35, 0.5);
      this.shake(0.22, 0.6);
      this.slam(x, z, 3);
    }
    // ---------------------------------------------------------------- screen
    shake(mag, dur) {
      if (mag >= this.shakeMag * (this.shakeT / Math.max(1e-3, this.shakeDur))) {
        this.shakeMag = mag;
        this.shakeDur = dur;
        this.shakeT = dur;
      }
    }
    flash(col, alpha, dur) {
      const e = this.flashEl;
      e.style.background = `radial-gradient(ellipse at center, rgba(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)},.0) 35%, rgba(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)},1) 120%)`;
      e.style.setProperty("--fa", String(alpha));
      e.style.animation = "none";
      void e.offsetWidth;
      e.style.animation = `fxflash ${dur}s ease-out forwards`;
    }
    setNumbers(on) {
      this.numbersOn = on;
      if (!on) this.layer.textContent = "";
    }
    update(dt) {
      for (let i = this.timed.length - 1; i >= 0; i--) {
        const w = this.timed[i];
        w.t += dt;
        const u = Math.min(1, w.t / w.dur);
        w.fn(u);
        if (u >= 1) {
          this.timed.splice(i, 1);
          if (w.done) w.done();
        }
      }
      this.flushNumbers(dt);
      if (this.shakeT > 0) {
        this.shakeT = Math.max(0, this.shakeT - dt);
        const k = (this.shakeT / this.shakeDur) ** 1.5 * this.shakeMag;
        this.off.set((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k * 0.7, (Math.random() - 0.5) * 2 * k);
      } else this.off.set(0, 0, 0);
    }
    clear() {
      this.pending.clear();
      this.layer.textContent = "";
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
    { rate: 14, min: 0.07, max: 0.13, sy: 2, life: [0.6, 0.9], power: [0.35, 0.7], w: 1.15, h: 0.8, c1: [0.78, 0.38, 1, 0.6], c2: [0.42, 0.14, 0.92, 0.45], embers: 0 },
    { rate: 26, min: 0.09, max: 0.17, sy: 2.3, life: [0.65, 1], power: [0.45, 0.9], w: 1.22, h: 0.9, c1: [0.92, 0.5, 1, 0.8], c2: [0.55, 0.2, 1, 0.65], embers: 0 },
    { rate: 40, min: 0.11, max: 0.2, sy: 2.6, life: [0.7, 1.1], power: [0.55, 1.1], w: 1.3, h: 1, c1: [1, 0.68, 1, 0.95], c2: [0.62, 0.22, 1, 0.8], embers: 12 }
  ];
  var VOCAL = /* @__PURE__ */ new Set(["Roar", "Thump", "Stomp", "Snicker", "Scheme", "Boast", "Flex", "DoubleBiceps", "Fumble", "ShieldBonk", "Bonk"]);
  function dyn2(scene, w, h, draw2, alpha = true) {
    const t = new BABYLON.DynamicTexture("dt", { width: w, height: h }, scene, true);
    draw2(t.getContext());
    t.update();
    t.hasAlpha = alpha;
    return t;
  }
  async function loadAssets(scene) {
    const soft = dyn2(scene, 64, 64, (c) => {
      const g2 = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g2.addColorStop(0, "rgba(255,255,255,1)");
      g2.addColorStop(0.4, "rgba(255,255,255,.55)");
      g2.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g2;
      c.fillRect(0, 0, 64, 64);
    });
    const starTex = [1, 2, 3].map((n) => dyn2(scene, 192, 48, (c) => {
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
    const ringTex = dyn2(scene, 128, 128, (c) => {
      const g2 = c.createRadialGradient(64, 64, 0, 64, 64, 62);
      g2.addColorStop(0, "rgba(255,255,255,0.03)");
      g2.addColorStop(0.78, "rgba(255,255,255,0.08)");
      g2.addColorStop(0.86, "rgba(255,255,255,0.95)");
      g2.addColorStop(0.93, "rgba(255,255,255,0.55)");
      g2.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g2;
      c.fillRect(0, 0, 128, 128);
    });
    const ringM = (r, g2, b) => {
      const m = new BABYLON.StandardMaterial("ringm", scene);
      m.disableLighting = true;
      m.emissiveColor = new BABYLON.Color3(r, g2, b);
      m.diffuseTexture = ringTex;
      m.useAlphaFromDiffuseTexture = true;
      m.backFaceCulling = false;
      return m;
    };
    const A = {
      scene,
      soft,
      lvTex: {},
      starTex,
      tripo: {},
      emote: {},
      ringMat: [ringM(0.62, 0.28, 1), ringM(1, 0.3, 0.25)],
      haloMat: emissive(1, 0.82, 0.3, 0.95),
      barBg: emissive(0.05, 0.05, 0.08, 0.7),
      barFill: [emissive(0.55, 0.35, 1), emissive(1, 0.4, 0.3)],
      manaFill: emissive(0.25, 0.75, 1)
    };
    const zzz = dyn2(scene, 128, 128, (c) => {
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
      m.diffuseTexture = dyn2(scene, 128, 128, draw2);
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
      __publicField(this, "ps2", null);
      __publicField(this, "anchor", null);
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
      __publicField(this, "team0", false);
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
        m.diffuseTexture = dyn2(A.scene, 192, 64, (c) => {
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
      if (!A.lvTex[n]) A.lvTex[n] = dyn2(A.scene, 128, 48, (c) => {
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
    }
    set(team, star) {
      const s = this.A.scene, cfg = AURA[star - 1];
      this.stars._sm.diffuseTexture = this.A.starTex[star - 1];
      this.ring.material = this.A.ringMat[team];
      this.fill.material = this.A.barFill[team];
      this.team0 = team === 0;
      if (team === 0) this.aura(star);
      else {
        if (this.ps && this.ps.isStarted()) this.ps.stop();
        if (this.ps2 && this.ps2.isStarted()) this.ps2.stop();
      }
    }
    /** Flames hugging the body (tall soft wisps), plus embers at 3 stars. */
    aura(star) {
      const s = this.A.scene, cfg = AURA[star - 1], R = Math.max(0.26, this.radius) * 0.95, H = this.top;
      const C4 = (c) => new BABYLON.Color4(c[0], c[1], c[2], c[3]);
      if (!this.anchor) {
        this.anchor = new BABYLON.TransformNode("auraAnchor", s);
        this.anchor.parent = this.parent;
      }
      this.anchor.position.y = H * 0.5;
      if (!this.ps) {
        const ps = new BABYLON.ParticleSystem("aura", 80, s);
        ps.particleTexture = this.A.soft;
        ps.emitter = this.anchor;
        ps.isLocal = true;
        ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
        this.ps = ps;
      }
      const p = this.ps, sp = { r: R * cfg.w, h: H * cfg.h };
      p.particleEmitterType = new BABYLON.CylinderParticleEmitter(sp.r, sp.h, 0, 0.25);
      p.gravity = new BABYLON.Vector3(0, 0.55, 0);
      p.emitRate = cfg.rate;
      p.minSize = cfg.min;
      p.maxSize = cfg.max;
      p.minScaleX = 0.7;
      p.maxScaleX = 1;
      p.minScaleY = cfg.sy * 0.85;
      p.maxScaleY = cfg.sy * 1.15;
      p.minLifeTime = cfg.life[0];
      p.maxLifeTime = cfg.life[1];
      p.minEmitPower = cfg.power[0];
      p.maxEmitPower = cfg.power[1];
      p.color1 = C4(cfg.c1);
      p.color2 = C4(cfg.c2);
      p.colorDead = new BABYLON.Color4(0.25, 0.04, 0.5, 0);
      if (!p.isStarted()) p.start();
      if (cfg.embers) {
        if (!this.ps2) {
          const e = new BABYLON.ParticleSystem("embers", 24, s);
          e.particleTexture = this.A.soft;
          e.emitter = this.anchor;
          e.isLocal = true;
          e.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
          e.minSize = 0.04;
          e.maxSize = 0.09;
          e.minLifeTime = 1.2;
          e.maxLifeTime = 2;
          e.minEmitPower = 0.25;
          e.maxEmitPower = 0.6;
          e.direction1 = new BABYLON.Vector3(-0.3, 1, -0.3);
          e.direction2 = new BABYLON.Vector3(0.3, 1.4, 0.3);
          e.gravity = new BABYLON.Vector3(0, 0.15, 0);
          e.color1 = new BABYLON.Color4(1, 0.85, 1, 1);
          e.color2 = new BABYLON.Color4(0.85, 0.5, 1, 0.9);
          e.colorDead = new BABYLON.Color4(0.4, 0.1, 0.8, 0);
          this.ps2 = e;
        }
        this.ps2.emitRate = cfg.embers;
        this.ps2.minEmitBox = new BABYLON.Vector3(-sp.r * 1.1, -sp.h * 0.5, -sp.r * 1.1);
        this.ps2.maxEmitBox = new BABYLON.Vector3(sp.r * 1.1, sp.h * 0.4, sp.r * 1.1);
        if (!this.ps2.isStarted()) this.ps2.start();
      } else if (this.ps2 && this.ps2.isStarted()) this.ps2.stop();
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
      for (const q of [this.ps, this.ps2]) if (q && (this.team0 || q === this.ps)) {
        if (on && !q.isStarted() && this.team0) q.start();
        if (!on && q.isStarted()) q.stop();
      }
    }
    update(_dt) {
    }
    dispose() {
      if (this.ps) {
        this.ps.stop();
        this.ps.dispose(false);
      }
      if (this.ps2) {
        this.ps2.stop();
        this.ps2.dispose(false);
      }
      if (this.anchor) this.anchor.dispose();
      [this.ring, this.stars, this.bar, this.fill, this.mbg, this.mfill].forEach((m) => m && m.dispose());
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
      const lbl = dyn2(s, 256, 48, (c) => {
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
      __publicField(this, "vfx");
      __publicField(this, "tweens", []);
      __publicField(this, "seenMerges", 0);
      /** The navigation shell hides the battle screen while another tab is open: pause the game so it costs nothing. */
      __publicField(this, "active", true);
      /** Debug: keep drawing but stop advancing time, so a moment can be stepped through with frame(dt) and screenshotted. */
      __publicField(this, "frozen", false);
      // bursts made while the game was asleep (a restored run) would hang frozen on screen
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
      this.vfx = new Vfx(scene, this.engine, this.camera, document.getElementById("battleHost") || document.body, this.A.soft);
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
        if (this.inspecting) {
          this.frameInspect(dt);
          this.vfx.update(dt);
        } else if (!this.frozen) this.frame(dt);
        scene.render();
        this.perfTick(raw);
      });
    }
    step(dt) {
      this.frame(dt);
    }
    setActive(on) {
      this.active = on;
      if (on && this.scene) this.scene.particleSystems.filter((p) => p.name === "b").forEach((p) => {
        p.stop();
        p.dispose(false);
      });
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
      ps.disposeOnStop = false;
      ps.onStoppedObservable.addOnce(() => ps.dispose(false));
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
      if (!this.inspecting) this.vfx.arrive(x, z, v.star);
      const target = v.holder.scaling.x;
      this.fxRing(x, z, new BABYLON.Color3(1, 0.85, 0.4), 0.2, 2, 0.65);
      this.later(0.12, () => this.fxRing(x, z, new BABYLON.Color3(1, 1, 1), 0.2, 3, 0.8));
      this.burst(x, z, [1, 0.85, 0.4, 0.9], [0.8, 0.4, 1, 0.8], 46);
      this.burst(x, z, [0.85, 0.6, 1, 0.9], [0.5, 0.3, 1, 0.7], 24);
      this.tween(0.55, (t) => v.holder.scaling.setAll(target * (1 + 0.45 * Math.sin(t * Math.PI) * (1 - t * 0.4))), () => v.holder.scaling.setAll(target));
    }
    summonFx(x, z) {
      if (!this.active) return;
      this.vfx.arrive(x, z, 1);
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
      for (const f of this.battle.fighters) if (f.boss) this.later(1.15, () => this.vfx.bossIntro(f.x, f.z));
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
          if (v) {
            v.pulse();
            const tf = b.byId(e.to), ff = b.byId(e.from);
            if (tf && ff) this.vfx.hit(e.to, tf.x, tf.z, v.top * v.holder.scaling.x, e.dmg, ff.team === 0, e.kind === "smash" || !!tf.boss || e.dmg >= tf.maxHp * 0.12, e.kind);
          }
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
            this.vfx.death(f.x, f.z, f.team === 1, v.top * v.holder.scaling.x);
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
          this.vfx.slam(e.x, e.z, e.r);
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
      this.arrows.push({ mesh, x0, z0, x1, z1, t: 0, dur, team });
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
      this.camera.position.subtractInPlace(this.vfx.off);
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
        this.vfx.trail(px, py, pz, a.team === 0);
        if (u >= 1) {
          a.mesh.setEnabled(false);
          this.arrowMesh.push(a.mesh);
          this.arrows.splice(i, 1);
        }
      }
      this.vfx.update(dt);
      this.camera.position.addInPlace(this.vfx.off);
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
            this.vfx.arrive(x0, z0, 1);
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
          const c = n.crystalPos();
          this.vfx.rune(c.x, c.z, 3.4, [0.7, 0.4, 1], 2.6, 1);
          this.vfx.pillar(c.x, c.z, [0.75, 0.45, 1], 7, 0.9, 1.4);
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
        this.vfx.shock(c.x, c.z, 28);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2dhbWUvYXJlbmEudHMiLCAiLi4vY29yZS9lbmRsZXNzLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9iYXR0bGUudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9kYWlseS50cyIsICIuLi9jb3JlL3BhY2tzLnRzIiwgIi4uL2NvcmUvc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvbmVjcm9tYW5jZXIudHMiLCAiLi4vZ2FtZS92ZngudHMiLCAiLi4vZ2FtZS9hdWRpby50cyIsICIuLi9jb3JlL3J1bnNhdmUudHMiLCAiLi4vZ2FtZS92aXN1YWxzLnRzIiwgIi4uL3VpL2ljb25zLnRzIiwgIi4uL3VpL3BvcnRyYWl0cy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXTsgZ29sZFRvTGV2ZWw6IG51bWJlcltdIH07XG4gIHNpbTogeyBzZXBhcmF0aW9uOiBudW1iZXI7IGhpdEZyYWN0aW9uOiBudW1iZXI7IHRpbWVMaW1pdDogbnVtYmVyOyByZXRhcmdldEV2ZXJ5OiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRTOiBCYWxhbmNlID0ge1xuICBzdGF0czoge1xuICAgIHdhcnJpb3I6ICAgeyBocDogNjAsICBkbWc6IDgsICBpbnRlcnZhbDogMC45LCByYW5nZTogMC44NSwgc3BlZWQ6IDEuNCwgc2l6ZTogMC4yOCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjQ3IH0sXG4gICAgYXJjaGVyOiAgICB7IGhwOiA0MCwgIGRtZzogNywgIGludGVydmFsOiAxLjcsIHJhbmdlOiA1LjAsICBzcGVlZDogMS4xLCBzaXplOiAwLjI2LCBhbmltTGVuOiAxLjUsIGhpdEZyYWM6IDAuNzggfSxcbiAgICBnb2JsaW46ICAgIHsgaHA6IDQ1LCAgZG1nOiA5LCAgaW50ZXJ2YWw6IDAuOCwgcmFuZ2U6IDAuOCwgIHNwZWVkOiAxLjcsIHNpemU6IDAuMjQsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAga25pZ2h0OiAgICB7IGhwOiAxMzAsIGRtZzogOSwgIGludGVydmFsOiAxLjEsIHJhbmdlOiAwLjksICBzcGVlZDogMS4wLCBzaXplOiAwLjMyLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIG9ncmU6ICAgICAgeyBocDogMTcwLCBkbWc6IDE2LCBpbnRlcnZhbDogMS45LCByYW5nZTogMS4wNSwgc3BlZWQ6IDAuOCwgc2l6ZTogMC40MiwgYW5pbUxlbjogMS4yLCBoaXRGcmFjOiAwLjU1IH0sXG4gICAgYmFyYmFyaWFuOiB7IGhwOiAxMTAsIGRtZzogMTIsIGludGVydmFsOiAwLjksIHJhbmdlOiAwLjksIHNwZWVkOiAxLjUsIHNpemU6IDAuMzAsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gIH0sXG4gIC8vIFwiYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHlcIjogSFAgZ3Jvd3MgZmFzdGVyIHRoYW4gZGFtYWdlIHBlciBzdGFyXG4gIHN0YXI6IHsgaHA6IFsxLCAyLjAsIDMuMl0sIGRtZzogWzEsIDEuNSwgMi4wXSwgc2NhbGU6IFsxLCAxLjEyLCAxLjI1XSB9LFxuICBwaGFsYW54OiB7IHJhZGl1czogMi4wLCBwZXJBbGx5OiAwLjA4LCBtYXhTdGFja3M6IDMgfSxcbiAgLy8gbWFuYSBmaWxscyBmYXN0OiBhIGJhc2ljIGF0dGFjayBnaXZlcyBwZXJBdHRhY2ssIHRha2luZyBhIGhpdCBnaXZlcyBwZXJIaXQ7IGEgZnVsbCBiYXIgZmlyZXMgdGhlIHNraWxsIG9uIHRoZSBuZXh0IGF0dGFjaywgdGhlbiByZXNldHNcbiAgbWFuYToge1xuICAgIGFyY2hlcjogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTcGxpdCBBcnJvdyBhYm91dCBldmVyeSAzcmQgc2hvdFxuICAgIG9ncmU6ICAgeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTbWFzaCBhYm91dCBldmVyeSAzcmQgc3dpbmdcbiAgICBrbmlnaHQ6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMjUsIHBlckhpdDogMTIgfSwgICAgLy8gVGF1bnQgZXZlcnkgfjQgc3dpbmdzLCBzb29uZXIgd2hlbiBoZSBpcyBiZWluZyBoaXRcbiAgfSxcbiAgdm9sbGV5OiB7IHRhcmdldHM6IDMsIHByb2plY3RpbGVTcGVlZDogMTQgfSxcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IDAuNSwgc2Vla1JhZGl1czogNC4wLCB3b3VuZGVkV2VpZ2h0OiAxLjUgfSxcbiAgdGF1bnQ6IHsgZHVyYXRpb246IDMsIHJhZGl1czogNC41IH0sXG4gIHNtYXNoOiB7IG11bHQ6IDIuMCwgcmFkaXVzOiAxLjYgfSxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiAwLjE0LCBtYXhTdGFja3M6IDgsIHJlc2V0QWZ0ZXI6IDAuNiB9LFxuICBsZXZlbDogeyBocDogMC4wOCwgZG1nOiAwLjA4LCBjb3BpZXNUb0xldmVsOiBbNSwgMTAsIDIwLCA0MCwgODAsIDkwLCAxNDAsIDIwMCwgMzAwXSwgZ29sZFRvTGV2ZWw6IFs2MDAwLCAxMjAwMCwgMjQwMDAsIDQ4MDAwLCA3MjAwMCwgMTEwMDAwLCAxNzAwMDAsIDI2MDAwMCwgNDAwMDAwXSB9LFxuICBzaW06IHsgc2VwYXJhdGlvbjogMC42LCBoaXRGcmFjdGlvbjogMC40NywgdGltZUxpbWl0OiAxMjAsIHJldGFyZ2V0RXZlcnk6IDAuNSB9LFxufTtcblxuZXhwb3J0IGNvbnN0IEJBTEFOQ0U6IEJhbGFuY2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSk7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNldEJhbGFuY2UoKTogdm9pZCB7XG4gIGNvbnN0IGZyZXNoOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoZnJlc2gpIGFzIChrZXlvZiBCYWxhbmNlKVtdKSAoQkFMQU5DRSBhcyBhbnkpW2tdID0gKGZyZXNoIGFzIGFueSlba107XG59XG5cbmV4cG9ydCBjb25zdCBST0xFX1RFWFQ6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdDaGVhcCBhbmQgZmFzdC4gVG91Z2hlciBuZWFyIG90aGVyIFdhcnJpb3JzLicsXG4gIGFyY2hlcjogJ0ZyYWdpbGUuIFNraWxsOiBTcGxpdCBBcnJvdyBoaXRzIDMgZGlmZmVyZW50IGVuZW1pZXMuJyxcbiAgZ29ibGluOiAnRmFzdC4gSGl0cyBoYXJkZXIgb24gZW5lbWllcyBmaWdodGluZyBzb21lb25lIGVsc2UuJyxcbiAga25pZ2h0OiAnVGFuay4gU2tpbGw6IFRhdW50IHB1bGxzIGVuZW1pZXMgb250byBoaW0uJyxcbiAgb2dyZTogJ1Nsb3csIGh1Z2UgZGFtYWdlLiBTa2lsbDogU21hc2gsIGEgYmlnIGFyZWEgc2xhbS4nLFxuICBiYXJiYXJpYW46ICdTd2luZ3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBoaXQuJyxcbn07XG5cbmV4cG9ydCBjb25zdCBTT1VMX05BTUU6IFJlY29yZDxTb3VsSWQsIHN0cmluZz4gPSB7XG4gIHdhcnJpb3I6ICdTa2VsZXRvbiBXYXJyaW9yJywgYXJjaGVyOiAnU2tlbGV0b24gQXJjaGVyJywgZ29ibGluOiAnR29ibGluJyxcbiAga25pZ2h0OiAnS25pZ2h0Jywgb2dyZTogJ09ncmUnLCBiYXJiYXJpYW46ICdCYXJiYXJpYW4nLFxufTtcblxuLyoqIEFiaWxpdHkgYmx1cmJzIGZvciB0aGUgU291bHMgcGFnZSwgd2l0aCB0aGUgbGl2ZSBudW1iZXJzIGZpbGxlZCBpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhYmlsaXR5SW5mbyhzb3VsOiBTb3VsSWQpOiB7IGtpbmQ6ICdza2lsbCcgfCAncGFzc2l2ZSc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nIH0ge1xuICBjb25zdCBCID0gQkFMQU5DRSwgcGN0ID0gKHg6IG51bWJlcikgPT4gTWF0aC5yb3VuZCh4ICogMTAwKSArICclJztcbiAgc3dpdGNoIChzb3VsKSB7XG4gICAgY2FzZSAnd2Fycmlvcic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ1BoYWxhbngnLCB0ZXh0OiBgVGFrZXMgJHtwY3QoQi5waGFsYW54LnBlckFsbHkpfSBsZXNzIGRhbWFnZSBmb3IgZWFjaCBvdGhlciBTa2VsZXRvbiBXYXJyaW9yIHdpdGhpbiAke0IucGhhbGFueC5yYWRpdXN9bSAodXAgdG8gJHtCLnBoYWxhbngubWF4U3RhY2tzfSkuYCB9O1xuICAgIGNhc2UgJ2dvYmxpbic6IHJldHVybiB7IGtpbmQ6ICdwYXNzaXZlJywgbmFtZTogJ09wcG9ydHVuaXN0JywgdGV4dDogYERlYWxzICR7cGN0KEIub3Bwb3J0dW5pc3QuYm9udXMpfSBtb3JlIGRhbWFnZSB0byBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZSwgYW5kIHByZWZlcnMgc3VjaCB0YXJnZXRzLmAgfTtcbiAgICBjYXNlICdiYXJiYXJpYW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdGcmVuenknLCB0ZXh0OiBgQXR0YWNrcyAke3BjdChCLmZyZW56eS5wZXJTd2luZyl9IGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmcgKHVwIHRvICR7Qi5mcmVuenkubWF4U3RhY2tzfSB0aW1lcykuYCB9O1xuICAgIGNhc2UgJ2FyY2hlcic6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTcGxpdCBBcnJvdycsIHRleHQ6IGBCYXNpYyBzaG90cyBmaXJlIG9uZSBhcnJvdy4gV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHNob3QgZmlyZXMgYXQgdXAgdG8gJHtCLnZvbGxleS50YXJnZXRzfSBkaWZmZXJlbnQgZW5lbWllcy5gIH07XG4gICAgY2FzZSAna25pZ2h0JzogcmV0dXJuIHsga2luZDogJ3NraWxsJywgbmFtZTogJ1RhdW50JywgdGV4dDogYFdoZW4gbWFuYSBpcyBmdWxsLCBlbmVtaWVzIHdpdGhpbiAke0IudGF1bnQucmFkaXVzfW0gbXVzdCBhdHRhY2sgaGltIGZvciAke0IudGF1bnQuZHVyYXRpb259cy5gIH07XG4gICAgY2FzZSAnb2dyZSc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdTbWFzaCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgdGhlIG5leHQgc3dpbmcgZGVhbHMgJHtCLnNtYXNoLm11bHR9eCBkYW1hZ2UgYW5kIGhpdHMgZW5lbWllcyBuZWFyIHRoZSB0YXJnZXQgZm9yIDYwJSBhcyBtdWNoLmAgfTtcbiAgfVxufVxuIiwgIi8vIERlc2lnbiBkYXRhIHN0cmFpZ2h0IGZyb20gdGhlIHBsYW4gZG9jLiBBbnl0aGluZyBtYXJrZWQgUExBQ0VIT0xERVIgaXMgbm90IGluIHRoZSBkb2MgeWV0LlxuXG5leHBvcnQgdHlwZSBTb3VsSWQgPSAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJztcblxuZXhwb3J0IGNvbnN0IFNPVUxTOiBTb3VsSWRbXSA9IFsnd2FycmlvcicsICdhcmNoZXInLCAnZ29ibGluJywgJ2tuaWdodCcsICdvZ3JlJywgJ2JhcmJhcmlhbiddO1xuXG4vKiogRG9taW5pb24gY29zdCBwZXIgc3RhciBsZXZlbDogaW5kZXggMCA9IDEgc3RhciwgMSA9IDIgc3RhcnMsIDIgPSAzIHN0YXJzICgzIHN0YXJzIGlzIHRoZSBtYXgpLiAqL1xuZXhwb3J0IGNvbnN0IENPU1Q6IFJlY29yZDxTb3VsSWQsIG51bWJlcltdPiA9IHtcbiAgd2FycmlvcjogWzIsIDMsIDRdLFxuICBhcmNoZXI6IFs0LCA2LCA5XSxcbiAgZ29ibGluOiBbMywgNCwgNl0sXG4gIGtuaWdodDogWzUsIDcsIDEwXSxcbiAgb2dyZTogWzcsIDEwLCAxNV0sXG4gIGJhcmJhcmlhbjogWzUsIDcsIDEwXSwgLy8gUExBQ0VIT0xERVI6IHRoZSBkb2MgaGFzIG5vIGNvc3QgZm9yIHRoZSBzaXh0aCBTb3VsIHlldFxufTtcblxuZXhwb3J0IGNvbnN0IE1BWF9TVEFSID0gMztcbmV4cG9ydCBjb25zdCBHUklEX0NFTExTID0gMTI7IC8vIDQgeCAzXG5cbi8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUgKGluZGV4IDAgPSB3YXZlIDEpLiAqL1xuZXhwb3J0IGNvbnN0IENVUlZFUzogUmVjb3JkPHN0cmluZywgbnVtYmVyW10+ID0ge1xuICAvLyBMT0NLRUQgKGNvbmZpcm1lZCk6ICs0IGZvciB3YXZlcyAyLTUsIHRoZW4gKzMgZm9yIHdhdmVzIDYtMTAgLT4gNDBcbiAgZG9jOiBbOSwgMTMsIDE3LCAyMSwgMjUsIDI4LCAzMSwgMzQsIDM3LCA0MF0sXG4gIC8vIE5PVCBVU0VEOiBtaXNyZW1lbWJlcmVkIHZhcmlhbnQgKCszIHRocm91Z2ggd2F2ZSA2LCB0aGVuICsyKSB0aGF0IG9ubHkgcmVhY2hlcyAzMi4gS2VwdCBmb3IgY29tcGFyaXNvbiBvbmx5LlxuICByZWNhbGxlZDogWzksIDEyLCAxNSwgMTgsIDIxLCAyNCwgMjYsIDI4LCAzMCwgMzJdLFxufTtcblxuZXhwb3J0IGNvbnN0IEhFQVJUUyA9IDM7XG5leHBvcnQgY29uc3QgU1RBUlRfSEFORCA9IDQ7XG5leHBvcnQgY29uc3QgV0FWRVMgPSAxMDtcblxuZXhwb3J0IGludGVyZmFjZSBSdWxlcyB7XG4gIC8qKiBEb21pbmlvbiBjYXAgcGVyIHdhdmUuICovXG4gIGN1cnZlOiBudW1iZXJbXTtcbiAgLyoqXG4gICAqICdkZXBsb3llZE9ubHknOiBvbmx5IHR3byBkZXBsb3llZCB1bml0cyBvZiB0aGUgc2FtZSBzdGFyIGNhbiBtZXJnZSAoZG9jIGFzIHdyaXR0ZW4pLlxuICAgKiAnaGFuZEludG9PbmVTdGFyJzogYWRkaXRpb25hbGx5IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gYmUgcGxheWVkIG9udG8gYSBkZXBsb3llZFxuICAgKiAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsIHRvIG1lcmdlIGltbWVkaWF0ZWx5IChwYXlzIG9ubHkgdGhlIGNvc3QgZGlmZmVyZW5jZSkuXG4gICAqL1xuICBtZXJnZTogJ2RlcGxveWVkT25seScgfCAnaGFuZEludG9PbmVTdGFyJztcbiAgLyoqIENhcmQtaW5mbG93IGtub2JzIChhbGwgb3B0aW9uYWw7IGRlZmF1bHRzIHJlcHJvZHVjZSB0aGUgZG9jKS4gKi9cbiAgc3RhcnRIYW5kPzogbnVtYmVyOyAgICAgICAgICAgIC8vIGRlZmF1bHQgNFxuICBkcmFmdFBpY2tzPzogbnVtYmVyOyAgICAgICAgICAgLy8gY2FyZHMga2VwdCBmcm9tIHRoZSAzLWNhcmQgVmljdG9yeSBEcmFmdCwgZGVmYXVsdCAxXG4gIG5vcm1hbERyYXdXYXZlcz86IG51bWJlcltdOyAgICAvLyB3YXZlcyAoYmVpbmcgZW50ZXJlZCkgdGhhdCBhbHNvIGdpdmUgdGhlIG5vcm1hbCByYW5kb20gZHJhdzsgZGVmYXVsdCA9IGFsbFxuICAvKiogU291bHMgdGhpcyBydW4gbWF5IGRyYXcgZnJvbSAodGhlIGVxdWlwcGVkIFNvdWwgRGVjaywgbWF4IDYpLiBEZWZhdWx0OiBldmVyeSBTb3VsLiAqL1xuICBwb29sPzogU291bElkW107XG4gIHN0YWdlV2F2ZXM/OiBudW1iZXI7ICAgICAgICAgICAvLyB3YXZlcyBpbiB0aGlzIHN0YWdlOyBkZWZhdWx0IDEwICh0aGUgcGxheWFibGUgcHJvdG90eXBlIHVzZXMgMylcbn1cblxuZXhwb3J0IGNvbnN0IEdSSURfQ09MUyA9IDQsIEdSSURfUk9XUyA9IDM7ICAgLy8gNCB4IDMgPSBHUklEX0NFTExTOyBjb2x1bW4gR1JJRF9DT0xTLTEgaXMgdGhlIGZyb250IGxpbmVcbiIsICIvLyBTbWFsbCBzZWVkZWQgUk5HIChtdWxiZXJyeTMyKS4gU2FtZSBzZWVkIC0+IHNhbWUgcnVuLCBzbyBhbnkgYnVnIHJlcG9ydCBpcyByZXByb2R1Y2libGUuXG4vLyBgc3RhdGUoKWAgLyB0aGUgYHJlc3VtZWAgYXJndW1lbnQgbGV0IGEgc2F2ZWQgcnVuIGNvbnRpbnVlIGRyYXdpbmcgZXhhY3RseSB0aGUgY2FyZHMgaXQgd291bGQgaGF2ZSBkcmF3bi5cblxuZXhwb3J0IGludGVyZmFjZSBSbmcge1xuICBuZXh0KCk6IG51bWJlcjsgICAgICAgICAgICAgIC8vIFswLCAxKVxuICBpbnQobjogbnVtYmVyKTogbnVtYmVyOyAgICAgIC8vIFswLCBuKVxuICBwaWNrPFQ+KGl0ZW1zOiByZWFkb25seSBUW10pOiBUO1xuICBzZWVkOiBudW1iZXI7XG4gIHN0YXRlKCk6IG51bWJlcjsgICAgICAgICAgICAgLy8gdGhlIGdlbmVyYXRvcidzIGN1cnJlbnQgcG9zaXRpb24sIGZvciBzYXZpbmcgYSBydW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSbmcoc2VlZDogbnVtYmVyLCByZXN1bWU/OiBudW1iZXIpOiBSbmcge1xuICBsZXQgYSA9IChyZXN1bWUgPz8gc2VlZCkgPj4+IDA7XG4gIGNvbnN0IG5leHQgPSAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBhO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBzZWVkLFxuICAgIG5leHQsXG4gICAgaW50OiAobikgPT4gTWF0aC5mbG9vcihuZXh0KCkgKiBuKSxcbiAgICBwaWNrOiAoaXRlbXMpID0+IGl0ZW1zW01hdGguZmxvb3IobmV4dCgpICogaXRlbXMubGVuZ3RoKV0sXG4gICAgc3RhdGU6ICgpID0+IGEsXG4gIH07XG59XG4iLCAiLy8gUHVyZSBnYW1lIHJ1bGVzIGZvciBvbmUgc3RhZ2UuIE5vIGdyYXBoaWNzLCBubyBjb21iYXQ6IGp1c3QgY2FyZHMsIERvbWluaW9uLCBncmlkLCBtZXJnZSwgd2F2ZXMsIGhlYXJ0cy5cbi8vIEV2ZXJ5IG11dGF0aW9uIGdvZXMgdGhyb3VnaCBhIGZ1bmN0aW9uIGhlcmUgYW5kIGFwcGVuZHMgdG8gc3RhdGUubG9nLCBzbyBydW5zIGNhbiBiZSByZXBsYXllZCBhbmQgaW5zcGVjdGVkLlxuXG5pbXBvcnQgeyBDT1NULCBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUywgU1RBUlRfSEFORCwgV0FWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBVbml0IHsgaWQ6IG51bWJlcjsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjsgZnJlc2g/OiBib29sZWFuIH0gICAvLyBmcmVzaCA9IHN1bW1vbmVkIHRoaXMgYnVpbGQgcGhhc2VcblxuZXhwb3J0IGludGVyZmFjZSBTdGF0ZSB7XG4gIHJ1bGVzOiBSdWxlcztcbiAgcm5nOiBSbmc7XG4gIHdhdmU6IG51bWJlcjsgICAgICAgICAgICAgICAgIC8vIDEtYmFzZWRcbiAgaGVhcnRzOiBudW1iZXI7XG4gIGNhcDogbnVtYmVyO1xuICBoYW5kOiBTb3VsSWRbXTtcbiAgdW5pdHM6IFVuaXRbXTtcbiAgbmV4dElkOiBudW1iZXI7XG4gIGRpc2NhcmRVc2VkOiBib29sZWFuOyAgICAgICAgIC8vIG9uY2UtcGVyLWJ1aWxkLXBoYXNlIHJlZHJhd1xuICBzdGF0dXM6ICdidWlsZGluZycgfCAnd29uJyB8ICdsb3N0JztcbiAgbG9nOiBzdHJpbmdbXTtcbiAgc3RhdHM6IHsgZHJhd246IG51bWJlcjsgZGlzY2FyZGVkOiBudW1iZXI7IGRpc21pc3NlZDogbnVtYmVyOyBtZXJnZXM6IG51bWJlcjsgZmFpbHVyZXM6IG51bWJlciB9O1xufVxuXG5leHBvcnQgY29uc3QgY29zdCA9IChzb3VsOiBTb3VsSWQsIHN0YXI6IG51bWJlcik6IG51bWJlciA9PiBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbmV4cG9ydCBjb25zdCBjYXJkc0luID0gKHN0YXI6IG51bWJlcik6IG51bWJlciA9PiAyICoqIChzdGFyIC0gMSk7ICAgICAvLyBjYXJkcyBhIHVuaXQgaXMgXCJ3b3J0aFwiXG5leHBvcnQgY29uc3QgZG9taW5pb25Vc2VkID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY29zdCh1LnNvdWwsIHUuc3RhciksIDApO1xuZXhwb3J0IGNvbnN0IGRvbWluaW9uRnJlZSA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLmNhcCAtIGRvbWluaW9uVXNlZChzKTtcblxuZnVuY3Rpb24gbG9nKHM6IFN0YXRlLCBtc2c6IHN0cmluZykgeyBzLmxvZy5wdXNoKGBbdyR7cy53YXZlfV0gJHttc2d9YCk7IH1cbi8qKiBUaGUgU291bHMgdGhpcyBydW4gZHJhd3MgZnJvbTogdGhlIGVxdWlwcGVkIGRlY2ssIG9yIGV2ZXJ5dGhpbmcgaWYgbm8gZGVjayB3YXMgZ2l2ZW4uICovXG5leHBvcnQgY29uc3QgcG9vbE9mID0gKHM6IFN0YXRlKTogU291bElkW10gPT4gKHMucnVsZXMucG9vbCAmJiBzLnJ1bGVzLnBvb2wubGVuZ3RoID8gcy5ydWxlcy5wb29sIDogU09VTFMpO1xuZnVuY3Rpb24gZHJhdyhzOiBTdGF0ZSwgd2h5OiBzdHJpbmcsIG5vdD86IFNvdWxJZCk6IFNvdWxJZCB7XG4gIGNvbnN0IGFsbCA9IHBvb2xPZihzKSwgb3RoZXJzID0gbm90ID8gYWxsLmZpbHRlcigoeCkgPT4geCAhPT0gbm90KSA6IGFsbDtcbiAgY29uc3QgcG9vbCA9IG90aGVycy5sZW5ndGggPyBvdGhlcnMgOiBhbGw7ICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHN3YXAgbmV2ZXIgaGFuZHMgeW91IGJhY2sgdGhlIFNvdWwgeW91IGdhdmUgdXAgKHVubGVzcyBpdCBpcyB0aGUgb25seSBvbmUgZXF1aXBwZWQpXG4gIGNvbnN0IGMgPSBzLnJuZy5waWNrKHBvb2wpO1xuICBzLmhhbmQucHVzaChjKTsgcy5zdGF0cy5kcmF3bisrO1xuICBsb2cocywgYGRyYXcgJHtjfSAoJHt3aHl9KWApO1xuICByZXR1cm4gYztcbn1cblxuLyoqIEEgbmV3IGJ1aWxkIHBoYXNlIGJlZ2luczogdGhlIG9uY2UtcGVyLXBoYXNlIHN3YXAgY29tZXMgYmFjayBhbmQgbm90aGluZyBjb3VudHMgYXMgXCJzdW1tb25lZCB0aGlzIHJvdW5kXCIuICovXG5leHBvcnQgZnVuY3Rpb24gbmV3UGhhc2UoczogU3RhdGUpOiB2b2lkIHtcbiAgcy5kaXNjYXJkVXNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgdS5mcmVzaCA9IGZhbHNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3U3RhZ2UocnVsZXM6IFJ1bGVzLCBzZWVkOiBudW1iZXIpOiBTdGF0ZSB7XG4gIGNvbnN0IHM6IFN0YXRlID0ge1xuICAgIHJ1bGVzLCBybmc6IG1ha2VSbmcoc2VlZCksIHdhdmU6IDEsIGhlYXJ0czogSEVBUlRTLCBjYXA6IHJ1bGVzLmN1cnZlWzBdLCBoYW5kOiBbXSwgdW5pdHM6IFtdLCBuZXh0SWQ6IDEsXG4gICAgZGlzY2FyZFVzZWQ6IGZhbHNlLCBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogW10sXG4gICAgc3RhdHM6IHsgZHJhd246IDAsIGRpc2NhcmRlZDogMCwgZGlzbWlzc2VkOiAwLCBtZXJnZXM6IDAsIGZhaWx1cmVzOiAwIH0sXG4gIH07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgKHJ1bGVzLnN0YXJ0SGFuZCA/PyBTVEFSVF9IQU5EKTsgaSsrKSBkcmF3KHMsICdzdGFydGluZyBoYW5kJyk7XG4gIC8vIE9wZW5pbmctaGFuZCBzYWZlZ3VhcmQ6IG1lcmdpbmcgaXMgdGhlIGhlYXJ0IG9mIHRoZSBnYW1lLCBzbyB0aGUgZmlyc3QgaGFuZCBhbHdheXMgaG9sZHMgYXQgbGVhc3Qgb25lIG1hdGNoaW5nIHBhaXIgKHdpdGggc2l4IFNvdWxzLCBhYm91dCAyOCUgb2YgcmFuZG9tIGhhbmRzIHdvdWxkIG5vdCkuXG4gIGlmIChzLmhhbmQubGVuZ3RoID49IDIgJiYgbmV3IFNldChzLmhhbmQpLnNpemUgPT09IHMuaGFuZC5sZW5ndGgpIHsgY29uc3QgayA9IE1hdGguZmxvb3Iocy5ybmcubmV4dCgpICogKHMuaGFuZC5sZW5ndGggLSAxKSk7IHMuaGFuZFtzLmhhbmQubGVuZ3RoIC0gMV0gPSBzLmhhbmRba107IGxvZyhzLCBgc3RhcnRpbmcgaGFuZDogbGFzdCBjYXJkIGJlY2FtZSBhIGNvcHkgb2YgJHtzLmhhbmRba119IHNvIGEgbWVyZ2UgaXMgcG9zc2libGVgKTsgfVxuICByZXR1cm4gcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZWVDZWxsKHM6IFN0YXRlKTogbnVtYmVyIHtcbiAgY29uc3QgdGFrZW4gPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmICghdGFrZW4uaGFzKGMpKSByZXR1cm4gYztcbiAgcmV0dXJuIC0xO1xufVxuXG4vLyAtLS0tIGJ1aWxkLXBoYXNlIGFjdGlvbnMgKGVhY2ggcmV0dXJucyB0cnVlIHdoZW4gaXQgaGFwcGVuZWQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XTtcbiAgcmV0dXJuIHNvdWwgIT09IHVuZGVmaW5lZCAmJiBmcmVlQ2VsbChzKSA+PSAwICYmIGNvc3Qoc291bCwgMSkgPD0gZG9taW5pb25GcmVlKHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2VsbEZyZWUoczogU3RhdGUsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICByZXR1cm4gY2VsbCA+PSAwICYmIGNlbGwgPCBHUklEX0NFTExTICYmICFzLnVuaXRzLnNvbWUoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7XG59XG5cbi8qKiBTdW1tb24gYSBoYW5kIGNhcmQgb250byBhIHNwZWNpZmljIGZyZWUgY2VsbCAoZGVmYXVsdDogdGhlIGZpcnN0IGZyZWUgb25lKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdW1tb24oczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgY2VsbD86IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN1bW1vbihzLCBoYW5kSWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoY2VsbCAhPT0gdW5kZWZpbmVkICYmICFjZWxsRnJlZShzLCBjZWxsKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzb3VsID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgY29uc3QgdTogVW5pdCA9IHsgaWQ6IHMubmV4dElkKyssIHNvdWwsIHN0YXI6IDEsIGNlbGw6IGNlbGwgPz8gZnJlZUNlbGwocyksIGZyZXNoOiB0cnVlIH07XG4gIHMudW5pdHMucHVzaCh1KTtcbiAgbG9nKHMsIGBzdW1tb24gJHtzb3VsfSAxKiAtPiBjZWxsICR7dS5jZWxsfSAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5NZXJnZURlcGxveWVkKGE6IFVuaXQsIGI6IFVuaXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuaWQgIT09IGIuaWQgJiYgYS5zb3VsID09PSBiLnNvdWwgJiYgYS5zdGFyID09PSBiLnN0YXIgJiYgYS5zdGFyIDwgTUFYX1NUQVI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZURlcGxveWVkKHM6IFN0YXRlLCBhSWQ6IG51bWJlciwgYklkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYUlkKSwgYiA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5pZCA9PT0gYklkKTtcbiAgaWYgKCFhIHx8ICFiIHx8ICFjYW5NZXJnZURlcGxveWVkKGEsIGIpKSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigodSkgPT4gdS5pZCAhPT0gYi5pZCk7XG4gIGEuZnJlc2ggPSAhIShhLmZyZXNoIHx8IGIuZnJlc2gpO1xuICBhLnN0YXIrKztcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZSAke2Euc291bH0gJHthLnN0YXIgLSAxfSorJHthLnN0YXIgLSAxfSogLT4gJHthLnN0YXJ9KiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSwgY2VsbHMgJHtzLnVuaXRzLmxlbmd0aH0vJHtHUklEX0NFTExTfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiAnaGFuZEludG9PbmVTdGFyJyBydWxlOiBwbGF5IGEgMS1zdGFyIGNhcmQgb250byBhIGRlcGxveWVkIDEtc3RhciB1bml0IG9mIHRoZSBzYW1lIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VGcm9tSGFuZChzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAocy5ydWxlcy5tZXJnZSAhPT0gJ2hhbmRJbnRvT25lU3RhcicpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZFtoYW5kSWR4XSwgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCFzb3VsIHx8ICF1IHx8IHUuc291bCAhPT0gc291bCB8fCB1LnN0YXIgIT09IDEpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIGNvc3Qoc291bCwgMikgLSBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5NZXJnZUZyb21IYW5kKHMsIGhhbmRJZHgsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICB1LnN0YXIgPSAyO1xuICBzLnN0YXRzLm1lcmdlcysrO1xuICBsb2cocywgYG1lcmdlLWZyb20taGFuZCAke3NvdWx9IC0+ICR7dS5zb3VsfSAyKiAgKGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSlgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkaXNtaXNzKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUpIHJldHVybiBmYWxzZTtcbiAgcy51bml0cyA9IHMudW5pdHMuZmlsdGVyKCh4KSA9PiB4LmlkICE9PSB1bml0SWQpO1xuICBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgZGlzbWlzcyAke3Uuc291bH0gJHt1LnN0YXJ9KiAocGVybWFuZW50bHkgcmVtb3ZlZClgKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAxOiBkaXNjYXJkIGEgaGFuZCBjYXJkIGFuZCBkcmF3IGEgcmFuZG9tIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNjYXJkUmVkcmF3KHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMuZGlzY2FyZFVzZWQgfHwgaGFuZElkeCA8IDAgfHwgaGFuZElkeCA+PSBzLmhhbmQubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGMgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBzLmRpc2NhcmRVc2VkID0gdHJ1ZTsgcy5zdGF0cy5kaXNjYXJkZWQrKztcbiAgbG9nKHMsIGBzd2FwOiBkaXNjYXJkICR7Y31gKTtcbiAgZHJhdyhzLCAnc3dhcCcsIGMpO1xuICByZXR1cm4gdHJ1ZTtcbn1cbmV4cG9ydCBjb25zdCBzd2FwRGlzY2FyZCA9IGRpc2NhcmRSZWRyYXc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5Td2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgcmV0dXJuICFzLmRpc2NhcmRVc2VkICYmICEhdSAmJiAhdS5mcmVzaDsgICAgICAgICAgLy8gY2FuJ3Qgc2VsbCBhIHVuaXQgeW91IHN1bW1vbmVkIHRoaXMgcm91bmRcbn1cblxuLyoqIFN3YXAgKG9uY2UgcGVyIGJ1aWxkIHBoYXNlKSwgb3B0aW9uIDI6IHNlbGwgYSBkZXBsb3llZCB1bml0IChub3Qgb25lIHN1bW1vbmVkIHRoaXMgcm91bmQpIGFuZCBkcmF3IGEgY2FyZCBvZiBhIERJRkZFUkVOVCBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN3YXBTZWxsKHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWNhblN3YXBTZWxsKHMsIHVuaXRJZCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKSE7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzbWlzc2VkICs9IGNhcmRzSW4odS5zdGFyKTtcbiAgbG9nKHMsIGBzd2FwOiBzZWxsICR7dS5zb3VsfSAke3Uuc3Rhcn0qYCk7XG4gIGRyYXcocywgJ3N3YXAnLCB1LnNvdWwpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1vdmVVbml0KHM6IFN0YXRlLCB1bml0SWQ6IG51bWJlciwgY2VsbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghdSB8fCAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgbG9nKHMsIGBtb3ZlICR7dS5zb3VsfSBjZWxsICR7dS5jZWxsfSAtPiAke2NlbGx9YCk7IHUuY2VsbCA9IGNlbGw7IHJldHVybiB0cnVlO1xufVxuXG4vLyAtLS0tIHdhdmUgcmVzdWx0cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBEcmFmdCBjaG9pY2VzIGZvciBhZnRlciBhIGNsZWFyZWQgd2F2ZTogMyByYW5kb20gY2FyZHMsIGR1cGxpY2F0ZXMgYWxsb3dlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkcmFmdE9wdGlvbnMoczogU3RhdGUpOiBTb3VsSWRbXSB7XG4gIGNvbnN0IHAgPSBwb29sT2Yocyk7XG4gIHJldHVybiBbcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKSwgcy5ybmcucGljayhwKV07XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQ6IHJhaXNlIHRoZSBjYXAsIHJlc29sdmUgdGhlIFZpY3RvcnkgRHJhZnQsIGRyYXcgMSBub3JtYWwgY2FyZC4gKi9cbmV4cG9ydCBjb25zdCBzdGFnZVdhdmVzID0gKHM6IFN0YXRlKTogbnVtYmVyID0+IHMucnVsZXMuc3RhZ2VXYXZlcyA/PyBXQVZFUztcblxuLyoqIFN0ZXAgMSBvZiBhIGNsZWFyZWQgd2F2ZTogaXMgdGhlIHN0YWdlIG92ZXI/IElmIG5vdCwgcmFpc2UgdGhlIGNhcCBhbmQgc3RhcnQgdGhlIG5leHQgYnVpbGQgcGhhc2UuIFJldHVybnMgdHJ1ZSB3aGVuIHRoZSBzdGFnZSBpcyB3b24uICovXG5leHBvcnQgZnVuY3Rpb24gYWR2YW5jZVdhdmUoczogU3RhdGUpOiBib29sZWFuIHtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gcy5zdGF0dXMgPT09ICd3b24nO1xuICBpZiAocy53YXZlID49IHN0YWdlV2F2ZXMocykpIHsgcy5zdGF0dXMgPSAnd29uJzsgbG9nKHMsICdzdGFnZSBjbGVhcmVkJyk7IHJldHVybiB0cnVlOyB9XG4gIHMud2F2ZSsrO1xuICBzLmNhcCA9IHMucnVsZXMuY3VydmVbcy53YXZlIC0gMV07XG4gIG5ld1BoYXNlKHMpO1xuICBsb2cocywgYHdhdmUgY2xlYXJlZCAtPiBjYXAgJHtzLmNhcH1gKTtcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU3RlcCAyOiB0aGUgcGxheWVyIGtlcHQgYGlkeGAgZnJvbSB0aGUgb2ZmZXJlZCBkcmFmdCBjYXJkcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0YWtlRHJhZnQoczogU3RhdGUsIG9wdHM6IFNvdWxJZFtdLCBpZHg6IG51bWJlcik6IHZvaWQge1xuICBjb25zdCBwaWNrID0gb3B0c1tNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGlkeCkpXTtcbiAgcy5oYW5kLnB1c2gocGljayk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmFmdCBbJHtvcHRzLmpvaW4oJywgJyl9XSAtPiB0b29rICR7cGlja31gKTtcbn1cblxuLyoqIFN0ZXAgMzogdGhlIGJvbnVzIG5vcm1hbCBkcmF3IChvbmx5IG9uIHRoZSB3YXZlcyB0aGUgcnVsZXMgYWxsb3cpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbERyYXcoczogU3RhdGUpOiB2b2lkIHtcbiAgaWYgKHMucnVsZXMubm9ybWFsRHJhd1dhdmVzID8gcy5ydWxlcy5ub3JtYWxEcmF3V2F2ZXMuaW5jbHVkZXMocy53YXZlKSA6IHRydWUpIGRyYXcocywgJ3dhdmUgY2xlYXInKTtcbn1cblxuLyoqIFdhdmUgY2xlYXJlZCAoYWxsIHRocmVlIHN0ZXBzIGluIG9uZSBjYWxsLCBmb3Igc2ltdWxhdGlvbnMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyV2F2ZShzOiBTdGF0ZSwgY2hvb3NlOiAob3B0czogU291bElkW10pID0+IG51bWJlcik6IHZvaWQge1xuICBpZiAoYWR2YW5jZVdhdmUocykpIHJldHVybjtcbiAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm47XG4gIGxldCBvcHRzID0gZHJhZnRPcHRpb25zKHMpO1xuICBjb25zdCBvZmZlcmVkID0gb3B0cy5qb2luKCcsICcpO1xuICBjb25zdCB0b29rOiBTb3VsSWRbXSA9IFtdO1xuICBmb3IgKGxldCBwID0gMDsgcCA8IChzLnJ1bGVzLmRyYWZ0UGlja3MgPz8gMSk7IHArKykge1xuICAgIGNvbnN0IGlkeCA9IE1hdGgubWF4KDAsIE1hdGgubWluKG9wdHMubGVuZ3RoIC0gMSwgY2hvb3NlKG9wdHMpKSk7XG4gICAgdG9vay5wdXNoKG9wdHNbaWR4XSk7IHMuaGFuZC5wdXNoKG9wdHNbaWR4XSk7IHMuc3RhdHMuZHJhd24rKztcbiAgICBvcHRzID0gb3B0cy5maWx0ZXIoKF8sIGkpID0+IGkgIT09IGlkeCk7XG4gIH1cbiAgbG9nKHMsIGBkcmFmdCBbJHtvZmZlcmVkfV0gLT4gdG9vayAke3Rvb2suam9pbignLCAnKX1gKTtcbiAgbm9ybWFsRHJhdyhzKTtcbn1cblxuLyoqIEFybXkgd2lwZWQ6IGxvc2UgYSBoZWFydCwgY2FwIGRvZXMgTk9UIHJpc2UsIGVuZW1pZXMgcmVzZXQsICsxIGNhcmQsIHJlZHJhdyBhbGxvd2VkIGFnYWluLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZhaWxXYXZlKHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBzLmhlYXJ0cy0tOyBzLnN0YXRzLmZhaWx1cmVzKys7XG4gIGlmIChzLmhlYXJ0cyA8PSAwKSB7IHMuc3RhdHVzID0gJ2xvc3QnOyBsb2cocywgJ25vIGhlYXJ0cyBsZWZ0OiBzdGFnZSBsb3N0Jyk7IHJldHVybjsgfVxuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGBhcm15IHdpcGVkOiBoZWFydHMgJHtzLmhlYXJ0c30sIGNhcCBzdGF5cyAke3MuY2FwfWApO1xuICBkcmF3KHMsICdmYWlsZWQgYXR0ZW1wdCcpO1xufVxuXG4vLyAtLS0tIGludmFyaWFudHMgKGNhbGxlZCBieSB0aGUgc2ltdWxhdG9yIGFmdGVyIGV2ZXJ5IHdhdmU7IHRocm93IHdpdGggYSByZWFkYWJsZSBtZXNzYWdlKSAtLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBjaGVja0ludmFyaWFudHMoczogU3RhdGUpOiB2b2lkIHtcbiAgY29uc3QgZmFpbCA9IChtOiBzdHJpbmcpID0+IHsgdGhyb3cgbmV3IEVycm9yKGBJTlZBUklBTlQgJHttfVxcbmAgKyBzLmxvZy5zbGljZSgtMTIpLmpvaW4oJ1xcbicpKTsgfTtcbiAgaWYgKHMudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgZmFpbChgbW9yZSB1bml0cyAoJHtzLnVuaXRzLmxlbmd0aH0pIHRoYW4gY2VsbHNgKTtcbiAgY29uc3QgY2VsbHMgPSBuZXcgU2V0KHMudW5pdHMubWFwKCh1KSA9PiB1LmNlbGwpKTtcbiAgaWYgKGNlbGxzLnNpemUgIT09IHMudW5pdHMubGVuZ3RoKSBmYWlsKCd0d28gdW5pdHMgc2hhcmUgYSBjZWxsJyk7XG4gIGlmIChkb21pbmlvblVzZWQocykgPiBzLmNhcCkgZmFpbChgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9IGV4Y2VlZHMgY2FwICR7cy5jYXB9YCk7XG4gIGZvciAoY29uc3QgdSBvZiBzLnVuaXRzKSBpZiAodS5zdGFyIDwgMSB8fCB1LnN0YXIgPiBNQVhfU1RBUikgZmFpbChgdW5pdCBzdGFyICR7dS5zdGFyfSBvdXQgb2YgcmFuZ2VgKTtcbiAgLy8gZXZlcnkgZHJhd24gY2FyZCBpcyBlaXRoZXIgaW4gaGFuZCwgd29ydGggY2FyZHMgb24gdGhlIGZpZWxkLCBkaXNjYXJkZWQsIG9yIGRpc21pc3NlZFxuICBjb25zdCBvbkZpZWxkID0gcy51bml0cy5yZWR1Y2UoKG4sIHUpID0+IG4gKyBjYXJkc0luKHUuc3RhciksIDApO1xuICBjb25zdCBhY2NvdW50ZWQgPSBzLmhhbmQubGVuZ3RoICsgb25GaWVsZCArIHMuc3RhdHMuZGlzY2FyZGVkICsgcy5zdGF0cy5kaXNtaXNzZWQ7XG4gIGlmIChhY2NvdW50ZWQgIT09IHMuc3RhdHMuZHJhd24pIGZhaWwoYGNhcmQgY29uc2VydmF0aW9uOiBkcmF3biAke3Muc3RhdHMuZHJhd259ICE9IGFjY291bnRlZCAke2FjY291bnRlZH1gKTtcbn1cbiIsICIvLyBUaGUgYmF0dGxlZmllbGQncyBsb29rOiBhIHRpbGVkIGNyeXB0IGZsb29yLCBhIGdsb3dpbmcgcnVuZSBjaXJjbGUgaW4gdGhlIG1pZGRsZSwgYW5kIGEgZGFyayBtaXN0eSBzdXJyb3VuZC4gUHVyZSBkZWNvcmF0aW9uIChubyBnYW1lIHJ1bGVzKS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuXG5jb25zdCBUSUxFX01FVFJFUyA9IDU7ICAgIC8vIG9uZSByZXBlYXQgb2YgdGhlIGZsb29yIHBpY3R1cmUgY292ZXJzIHRoaXMgbWFueSBtZXRyZXMsIHNvIHNsYWJzIGNvbWUgb3V0IGFib3V0IGEgbWV0cmUgd2lkZVxuXG4vKiogRHJhdyB0aGUgcnVuZSBjaXJjbGUgb25jZSBvbnRvIGEgY2FudmFzOyBpdCBiZWNvbWVzIGEgc2VlLXRocm91Z2ggZGVjYWwgb24gdGhlIGZsb29yLiAqL1xuZnVuY3Rpb24gcnVuZVRleHR1cmUoc2NlbmU6IGFueSk6IGFueSB7XG4gIGNvbnN0IFMgPSA1MTIsIHRleCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdydW5lcycsIHsgd2lkdGg6IFMsIGhlaWdodDogUyB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0ZXguZ2V0Q29udGV4dCgpO1xuICBjLmNsZWFyUmVjdCgwLCAwLCBTLCBTKTsgYy50cmFuc2xhdGUoUyAvIDIsIFMgLyAyKTsgYy5saW5lQ2FwID0gJ3JvdW5kJzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7XG4gIGNvbnN0IHJpbmcgPSAocjogbnVtYmVyLCB3OiBudW1iZXIsIGE6IG51bWJlcikgPT4geyBjLmJlZ2luUGF0aCgpOyBjLmFyYygwLCAwLCByLCAwLCBNYXRoLlBJICogMik7IGMubGluZVdpZHRoID0gdzsgYy5zdHJva2VTdHlsZSA9IGByZ2JhKDQ3LDIxNywxNjYsJHthfSlgOyBjLnN0cm9rZSgpOyB9O1xuICBjLnNoYWRvd0NvbG9yID0gJ3JnYmEoNDcsMjE3LDE2NiwwLjkpJzsgYy5zaGFkb3dCbHVyID0gMTA7XG4gIHJpbmcoMjM2LCA0LCAwLjc1KTsgcmluZygyMTQsIDIsIDAuNSk7IHJpbmcoMTIwLCAzLCAwLjcpO1xuICBjLnN0cm9rZVN0eWxlID0gJ3JnYmEoNDcsMjE3LDE2NiwwLjcpJzsgYy5saW5lV2lkdGggPSAzO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ7IGkrKykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZm91ciBsb25nIHNwaWtlcywgbGlrZSBhIGNvbXBhc3NcbiAgICBjLnNhdmUoKTsgYy5yb3RhdGUoKGkgKiBNYXRoLlBJKSAvIDIgKyBNYXRoLlBJIC8gNCk7IGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKDAsIC0zMCk7IGMubGluZVRvKDAsIC0yMzApOyBjLnN0cm9rZSgpO1xuICAgIGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKC0xNCwgLTEyMCk7IGMubGluZVRvKDAsIC0xNjApOyBjLmxpbmVUbygxNCwgLTEyMCk7IGMuc3Ryb2tlKCk7IGMucmVzdG9yZSgpO1xuICB9XG4gIGMubGluZVdpZHRoID0gMjsgYy5zdHJva2VTdHlsZSA9ICdyZ2JhKDQ3LDIxNywxNjYsMC41NSknO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDEyOyBpKyspIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc21hbGwgdGljayBtYXJrcyBiZXR3ZWVuIHRoZSB0d28gb3V0ZXIgcmluZ3NcbiAgICBjLnNhdmUoKTsgYy5yb3RhdGUoKGkgKiBNYXRoLlBJKSAvIDYpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMjE0KTsgYy5saW5lVG8oMCwgLTIzNik7IGMuc3Ryb2tlKCk7IGMucmVzdG9yZSgpO1xuICB9XG4gIHRleC51cGRhdGUoKTsgdGV4Lmhhc0FscGhhID0gdHJ1ZTsgcmV0dXJuIHRleDtcbn1cblxuaW50ZXJmYWNlIFBsYWNlbWVudCB7IHByb3A6IHN0cmluZzsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHlhdz86IG51bWJlcjsgcz86IG51bWJlciB9XG4vKiogV2hlcmUgdGhlIHByb3BzIHN0YW5kLiBUYWxsIHRoaW5ncyBnbyBiZWhpbmQgYW5kIGJlc2lkZSB0aGUgZmllbGQ7IG9ubHkgbG93IHRoaW5ncyAoZmVuY2UsIGJvbmVzLCB3YWxsKSBzdGFuZCBiZXR3ZWVuIHRoZSBjYW1lcmEgYW5kIHRoZSB1bml0cy4gKi9cbmNvbnN0IENSWVBUX0xBWU9VVDogUGxhY2VtZW50W10gPSBbXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtNi41LCB6OiA2LjQgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDAsIHo6IDYuOSwgczogMS4xNSB9LCB7IHByb3A6ICdhcmNoJywgeDogNi41LCB6OiA2LjQgfSxcbiAgeyBwcm9wOiAncGlsbGFyJywgeDogLTEwLjIsIHo6IDUuNiwgeWF3OiAwLjQgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogLTMuMiwgejogNS45LCB5YXc6IDIuMSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAzLjMsIHo6IDUuOCwgeWF3OiA0LjAgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTAuMiwgejogNS42LCB5YXc6IDEuMiB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTQuNiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiA0LjYsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogLTEwLjUsIHo6IDAuOCB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogMTAuNSwgejogMC44IH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtOC42LCB6OiA2LjAsIHlhdzogMC4xIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiA4LjYsIHo6IDYuMCwgeWF3OiAtMC4xIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTEuNCwgejogLTIuNiwgeWF3OiAxLjQgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDExLjQsIHo6IC0yLjYsIHlhdzogMS43IH0sXG4gIHsgcHJvcDogJ2ZlbmNlJywgeDogLTguMCwgejogLTQuNiB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC02LjcsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA2LjcsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA4LjAsIHo6IC00LjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiAtMy41LCB6OiAtNC40LCB5YXc6IDAuNywgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogNC4yLCB6OiAtNC42LCB5YXc6IDIuNSwgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogOS40LCB6OiAzLjIsIHlhdzogMS4wLCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAtOS42LCB6OiAtMy40LCB5YXc6IDMuNiwgczogMC42IH0sXG5dO1xuY29uc3QgR1JBVkVZQVJEX0xBWU9VVDogUGxhY2VtZW50W10gPSBbICAgICAgLy8gZmV3ZXIgYXJjaGVzLCBhIGJyb2tlbiByb3cgb2YgZ3JhdmVzdG9uZSBwaWxsYXJzLCBib25lcyBldmVyeXdoZXJlXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtOS41LCB6OiA2LjQgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDkuNSwgejogNi40IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMSwgejogNS4yLCB5YXc6IDAuNCwgczogMC45IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC03LjYsIHo6IDYuMywgeWF3OiAyLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogLTQuNCwgejogNS42LCB5YXc6IDQuMCwgczogMC44IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xLjIsIHo6IDYuNSwgeWF3OiAxLjIgfSxcbiAgeyBwcm9wOiAncGlsbGFyJywgeDogMi4yLCB6OiA1LjcsIHlhdzogMy4xLCBzOiAwLjkgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogNS41LCB6OiA2LjQsIHlhdzogNS4wIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDguMiwgejogNS41LCB5YXc6IDAuOSwgczogMC44NSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAxMSwgejogNS4wLCB5YXc6IDIuNiB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTExLCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDExLCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDAuNiwgejogNS4wLCBzOiAwLjkgfSxcbiAgeyBwcm9wOiAnd2FsbCcsIHg6IC01LjYsIHo6IDYuNiwgeWF3OiAwLjIgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDMuOCwgejogNi43LCB5YXc6IC0wLjIgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0xMS42LCB6OiAtMi40LCB5YXc6IDEuNSB9LFxuICB7IHByb3A6ICdmZW5jZScsIHg6IC00LjIsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA0LjQsIHo6IC00LjcgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAxMS4yLCB6OiAtMi4yLCB5YXc6IDEuNiB9LFxuICB7IHByb3A6ICdib25lcycsIHg6IC01LjUsIHo6IDQuNiwgeWF3OiAwLjcsIHM6IDAuNiB9LCB7IHByb3A6ICdib25lcycsIHg6IDMuMiwgejogNC40LCB5YXc6IDIuNSwgczogMC43IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogOC4yLCB6OiAzLjIsIHlhdzogMS4wLCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAtOS4yLCB6OiAzLjQsIHlhdzogMy42LCBzOiAwLjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiA3LCB6OiAtNC41LCB5YXc6IDAuMywgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTcuNCwgejogLTQuMywgeWF3OiA0LjEsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDAuMiwgejogLTQuOCwgeWF3OiA1LjIsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDEwLjIsIHo6IC0wLjYsIHlhdzogMi4wLCBzOiAwLjYgfSxcbl07XG5jb25zdCBCQVNUSU9OX0xBWU9VVDogUGxhY2VtZW50W10gPSBbICAgICAgICAvLyBhIGZvcnRyZXNzOiBnYXRlcyBiZXR3ZWVuIGxvbmcgd2FsbHMsIGJyYXppZXJzIGFsb25nIHRoZSBiYXR0bGVtZW50cywgZmVuY2VzIG9uIHRoZSBmbGFua3NcbiAgeyBwcm9wOiAnYXJjaCcsIHg6IC01LjgsIHo6IDYuNSwgczogMS4xIH0sIHsgcHJvcDogJ2FyY2gnLCB4OiAwLCB6OiA3LjAsIHM6IDEuMyB9LCB7IHByb3A6ICdhcmNoJywgeDogNS44LCB6OiA2LjUsIHM6IDEuMSB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTkuNCwgejogNi4wLCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0yLjksIHo6IDYuNCwgczogMS4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAyLjksIHo6IDYuNCwgczogMS4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiA5LjQsIHo6IDYuMCwgczogMS4zIH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTIuMiwgejogMi42LCB5YXc6IDEuNTcsIHM6IDEuMyB9LCB7IHByb3A6ICd3YWxsJywgeDogMTIuMiwgejogMi42LCB5YXc6IDEuNTcsIHM6IDEuMyB9LCB7IHByb3A6ICd3YWxsJywgeDogLTEyLjIsIHo6IC0xLjYsIHlhdzogMS41NyB9LCB7IHByb3A6ICd3YWxsJywgeDogMTIuMiwgejogLTEuNiwgeWF3OiAxLjU3IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMS4yLCB6OiA1LjYsIHlhdzogMC40LCBzOiAxLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTEuMiwgejogNS42LCB5YXc6IDEuMiwgczogMS4xIH0sXG4gIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtMy4yLCB6OiA1LjIgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDMuMiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtMTAuNiwgejogMS4wIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAxMC42LCB6OiAxLjAgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IC03LjIsIHo6IC00LjYsIHM6IDAuOSB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogNy4yLCB6OiAtNC42LCBzOiAwLjkgfSxcbiAgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNC42LCB6OiAtNC44IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogLTMuMywgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDMuMywgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDQuNiwgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC0xMS42LCB6OiAtMy40LCB5YXc6IDEuNSB9LCB7IHByb3A6ICdmZW5jZScsIHg6IDExLjYsIHo6IC0zLjQsIHlhdzogMS41IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogLTEuNSwgejogLTQuNSwgeWF3OiAwLjcsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDkuNCwgejogMy4yLCB5YXc6IDEuMCwgczogMC41IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuNiwgejogLTMuMCwgeWF3OiAzLjYsIHM6IDAuNSB9LFxuXTtcblxudHlwZSBDMyA9IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcbmludGVyZmFjZSBUaGVtZSB7IGxheW91dDogUGxhY2VtZW50W107IGZsb29yOiBDMzsgZm9nOiBDMzsgbWlzdDogQzM7IHdhbGw6IEMzOyBmbGFtZUE6IEMzOyBmbGFtZUI6IEMzOyBydW5lOiBDMyB9XG4vKiogT25lIGxvb2sgcGVyIGNhbXBhaWduIHN0YWdlIChpZHMgbWF0Y2ggU1RBR0VTIGluIGNvcmUvd2F2ZXMudHMpLiBVbmtub3duIGlkcyB1c2UgdGhlIGNyeXB0IGxvb2suICovXG5jb25zdCBUSEVNRVM6IFJlY29yZDxzdHJpbmcsIFRoZW1lPiA9IHtcbiAgY3J5cHQ6IHsgbGF5b3V0OiBDUllQVF9MQVlPVVQsIGZsb29yOiBbMC42MiwgMC43LCAwLjddLCBmb2c6IFswLjAyLCAwLjA1LCAwLjA2XSwgbWlzdDogWzAuMiwgMC42LCAwLjU1XSwgd2FsbDogWzAuNzUsIDAuODUsIDAuOV0sIGZsYW1lQTogWzAuMzUsIDEsIDAuOF0sIGZsYW1lQjogWzAuMSwgMC44LCAwLjZdLCBydW5lOiBbMC4xOCwgMC44NSwgMC42NV0gfSxcbiAgZ3JhdmV5YXJkOiB7IGxheW91dDogR1JBVkVZQVJEX0xBWU9VVCwgZmxvb3I6IFswLjYyLCAwLjc0LCAwLjUyXSwgZm9nOiBbMC4wMywgMC4wNSwgMC4wMjVdLCBtaXN0OiBbMC40MiwgMC42LCAwLjIyXSwgd2FsbDogWzAuNywgMC44NSwgMC42Ml0sIGZsYW1lQTogWzAuNzUsIDEsIDAuNF0sIGZsYW1lQjogWzAuNCwgMC44LCAwLjJdLCBydW5lOiBbMC41LCAwLjgsIDAuMjVdIH0sXG4gIGVuZGxlc3M6IHsgbGF5b3V0OiBDUllQVF9MQVlPVVQsIGZsb29yOiBbMC43OCwgMC42MiwgMC42OF0sIGZvZzogWzAuMDYsIDAuMDIsIDAuMDM1XSwgbWlzdDogWzAuNzUsIDAuMywgMC40XSwgd2FsbDogWzAuOTIsIDAuNjgsIDAuNzhdLCBmbGFtZUE6IFsxLCAwLjYyLCAwLjNdLCBmbGFtZUI6IFswLjksIDAuMjUsIDAuMTVdLCBydW5lOiBbMC45LCAwLjM1LCAwLjNdIH0sXG4gIGJhc3Rpb246IHsgbGF5b3V0OiBCQVNUSU9OX0xBWU9VVCwgZmxvb3I6IFswLjYsIDAuNjIsIDAuOV0sIGZvZzogWzAuMDMsIDAuMDMsIDAuMDhdLCBtaXN0OiBbMC40LCAwLjQsIDAuODVdLCB3YWxsOiBbMC43MiwgMC43MiwgMV0sIGZsYW1lQTogWzAuNiwgMC42NSwgMV0sIGZsYW1lQjogWzAuNCwgMC4zLCAwLjk1XSwgcnVuZTogWzAuNDUsIDAuNCwgMC45NV0gfSxcbn07XG5cblxuLyoqIEJ1aWxkIHRoZSB0ZWFsIHNvdWxmaXJlIG92ZXIgYSBicmF6aWVyOiBhIHNtYWxsIHNvZnQgZmxhbWUgdGhhdCBmbGlja2Vycy4gKi9cbmZ1bmN0aW9uIGZsYW1lKHNjZW5lOiBhbnksIHRleDogYW55LCB4OiBudW1iZXIsIHk6IG51bWJlciwgejogbnVtYmVyLCBrOiBudW1iZXIsIGE6IEMzLCBiOiBDMyk6IGFueSB7XG4gIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2ZpcmUnLCAxOCwgc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0ZXg7IHBzLmVtaXR0ZXIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKHgsIHksIHopO1xuICBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yMiAqIGssIDAsIC0wLjIyICogayk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMjIgKiBrLCAwLCAwLjIyICogayk7XG4gIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjEsIDEsIC0wLjEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjEsIDEuNCwgMC4xKTtcbiAgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMS4wOyBwcy5lbWl0UmF0ZSA9IDIwOyBwcy5taW5TaXplID0gMC4zNSAqIGs7IHBzLm1heFNpemUgPSAwLjcgKiBrOyBwcy5taW5FbWl0UG93ZXIgPSAwLjUgKiBrOyBwcy5tYXhFbWl0UG93ZXIgPSAxLjAgKiBrO1xuICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoYVswXSwgYVsxXSwgYVsyXSwgMC45KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KGJbMF0sIGJbMV0sIGJbMl0sIDAuOCk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNChiWzBdICogMC4xLCBiWzFdICogMC4zLCBiWzJdICogMC4zLCAwKTtcbiAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5zdGFydCgpOyByZXR1cm4gcHM7XG59XG5cbi8qKiBTb2Z0IHJvdW5kIGJsb2IgdXNlZCBmb3IgdGhlIGZsYW1lcy4gKi9cbmZ1bmN0aW9uIGdsb3dUZXh0dXJlKHNjZW5lOiBhbnkpOiBhbnkge1xuICBjb25zdCB0ID0gbmV3IEJBQllMT04uRHluYW1pY1RleHR1cmUoJ2dsb3cnLCB7IHdpZHRoOiA2NCwgaGVpZ2h0OiA2NCB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0LmdldENvbnRleHQoKSwgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTtcbiAgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwwLjQ1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICBjLmZpbGxTdHlsZSA9IGc7IGMuZmlsbFJlY3QoMCwgMCwgNjQsIDY0KTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IHRydWU7IHJldHVybiB0O1xufVxuXG4vKiogTG9hZCB0aGUgcHJvcCBraXQgb25jZTsgYXBwbHkodGhlbWUpIHRoZW4gc3RhbmRzIGNvcGllcyBvZiBlYWNoIHBpZWNlIGFyb3VuZCB0aGUgZmllbGQgKHRoZXkgc2hhcmUgb25lIG1lc2ggYW5kIG9uZSB0ZXh0dXJlLCBzbyB0aGV5IGNvc3QgYWxtb3N0IG5vdGhpbmcpLiAqL1xuYXN5bmMgZnVuY3Rpb24gbG9hZEtpdChzY2VuZTogYW55KTogUHJvbWlzZTx7IGFwcGx5KHQ6IFRoZW1lKTogdm9pZCB9PiB7XG4gIGNvbnN0IGJveCA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy9hcmVuYS8nLCAncHJvcHMuZ2xiJywgc2NlbmUpO1xuICBib3guYWRkQWxsVG9TY2VuZSgpO1xuICBjb25zdCByb290ID0gYm94Lm1lc2hlcy5maW5kKChtOiBhbnkpID0+IG0ubmFtZSA9PT0gJ19fcm9vdF9fJyksIHNyYzogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICBmb3IgKGNvbnN0IG0gb2YgYm94Lm1lc2hlcykgaWYgKG0ubmFtZSAhPT0gJ19fcm9vdF9fJyAmJiBtLmdldFRvdGFsVmVydGljZXMoKSA+IDApIHsgc3JjW20ubmFtZV0gPSBtOyBtLnNldEVuYWJsZWQoZmFsc2UpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICBjb25zdCBnbG93ID0gZ2xvd1RleHR1cmUoc2NlbmUpOyBsZXQgbWFkZTogeyBob2xkZXJzOiBhbnlbXTsgZmlyZXM6IGFueVtdIH0gPSB7IGhvbGRlcnM6IFtdLCBmaXJlczogW10gfSwgbiA9IDA7XG4gIHJldHVybiB7XG4gICAgYXBwbHkodDogVGhlbWUpIHtcbiAgICAgIGZvciAoY29uc3QgaCBvZiBtYWRlLmhvbGRlcnMpIGguZGlzcG9zZSgpOyBmb3IgKGNvbnN0IGYgb2YgbWFkZS5maXJlcykgZi5kaXNwb3NlKGZhbHNlKTsgICAvLyBmYWxzZToga2VlcCB0aGUgc2hhcmVkIGdsb3cgdGV4dHVyZSBtYWRlID0geyBob2xkZXJzOiBbXSwgZmlyZXM6IFtdIH07XG4gICAgICBmb3IgKGNvbnN0IHAgb2YgdC5sYXlvdXQpIHtcbiAgICAgICAgY29uc3QgYmFzZSA9IHNyY1twLnByb3BdOyBpZiAoIWJhc2UpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBpbnN0ID0gYmFzZS5jcmVhdGVJbnN0YW5jZShwLnByb3AgKyBuKyspOyBpbnN0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICAgICAgaW5zdC5yb3RhdGlvblF1YXRlcm5pb24gPSByb290LnJvdGF0aW9uUXVhdGVybmlvbj8uY2xvbmUoKSA/PyBudWxsOyBpZiAoIWluc3Qucm90YXRpb25RdWF0ZXJuaW9uKSBpbnN0LnJvdGF0aW9uID0gcm9vdC5yb3RhdGlvbi5jbG9uZSgpOyBpbnN0LnNjYWxpbmcgPSByb290LnNjYWxpbmcuY2xvbmUoKTtcbiAgICAgICAgY29uc3QgaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnaG9sZGVyJyArIG4sIHNjZW5lKTsgaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IGhvbGRlci5yb3RhdGlvbi55ID0gcC55YXcgPz8gMDsgaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHAucyA/PyAxKTtcbiAgICAgICAgaW5zdC5wYXJlbnQgPSBob2xkZXI7IG1hZGUuaG9sZGVycy5wdXNoKGhvbGRlcik7XG4gICAgICAgIGlmIChwLnByb3AgPT09ICdicmF6aWVyJykgbWFkZS5maXJlcy5wdXNoKGZsYW1lKHNjZW5lLCBnbG93LCBwLngsIDEuMjUgKiAocC5zID8/IDEpLCBwLnosIHAucyA/PyAxLCB0LmZsYW1lQSwgdC5mbGFtZUIpKTtcbiAgICAgIH1cbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRBcmVuYShzY2VuZTogYW55LCBncm91bmQ6IGFueSk6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHNldFRoZW1lKHN0YWdlOiBzdHJpbmcpOiB2b2lkIH0ge1xuICAvLyAtLS0tIGZsb29yXG4gIGNvbnN0IHRleCA9IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy9hcmVuYS9mbG9vci53ZWJwJywgc2NlbmUsIGZhbHNlLCB0cnVlLCBCQUJZTE9OLlRleHR1cmUuVFJJTElORUFSX1NBTVBMSU5HTU9ERSk7XG4gIHRleC51U2NhbGUgPSA2MCAvIFRJTEVfTUVUUkVTOyB0ZXgudlNjYWxlID0gNDAgLyBUSUxFX01FVFJFUzsgdGV4LmFuaXNvdHJvcGljRmlsdGVyaW5nTGV2ZWwgPSA0O1xuICBjb25zdCBnbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2dtJywgc2NlbmUpOyBnbS5kaWZmdXNlVGV4dHVyZSA9IHRleDsgZ20uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7XG4gIGdtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjYyLCAwLjcsIDAuNyk7IGdyb3VuZC5tYXRlcmlhbCA9IGdtO1xuXG4gIC8vIC0tLS0gcnVuZSBjaXJjbGUgaW4gdGhlIG1pZGRsZSBvZiB0aGUgZmllbGRcbiAgY29uc3QgZGVjYWwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgncnVuZXMnLCB7IHdpZHRoOiA1LjIsIGhlaWdodDogNS4yIH0sIHNjZW5lKTtcbiAgZGVjYWwucG9zaXRpb24ueSA9IDAuMDEyOyBkZWNhbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGNvbnN0IHJtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgncm0nLCBzY2VuZSk7IHJtLmRpZmZ1c2VUZXh0dXJlID0gcnVuZVRleHR1cmUoc2NlbmUpOyBybS5kaWZmdXNlVGV4dHVyZS5oYXNBbHBoYSA9IHRydWU7IHJtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTtcbiAgcm0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjg1LCAwLjY1KTsgcm0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcm0uYWxwaGEgPSAwLjU1OyBybS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgZGVjYWwubWF0ZXJpYWwgPSBybTtcblxuICAvLyAtLS0tIGRhcmsgdGVhbCBzdXJyb3VuZCB0aGF0IHN3YWxsb3dzIHRoZSBmYXIgZWRnZSBvZiB0aGUgZmxvb3JcbiAgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjAyLCAwLjA1LCAwLjA2LCAxKTtcbiAgc2NlbmUuZm9nTW9kZSA9IEJBQllMT04uU2NlbmUuRk9HTU9ERV9MSU5FQVI7IHNjZW5lLmZvZ0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMDIsIDAuMDUsIDAuMDYpOyBzY2VuZS5mb2dTdGFydCA9IDI0OyBzY2VuZS5mb2dFbmQgPSA1NjtcblxuICBjb25zdCBjYXZlID0gYnVpbGRDYXZlKHNjZW5lLCB0ZXgpO1xuICBsZXQga2l0OiB7IGFwcGx5KHQ6IFRoZW1lKTogdm9pZCB9IHwgbnVsbCA9IG51bGwsIHdhbnQgPSAnY3J5cHQnLCBzaG93biA9ICcnO1xuICBjb25zdCBzaG93ID0gKCkgPT4ge1xuICAgIGNvbnN0IHQgPSBUSEVNRVNbd2FudF0gPz8gVEhFTUVTLmNyeXB0OyBpZiAod2FudCA9PT0gc2hvd24gJiYga2l0KSByZXR1cm47XG4gICAgY29uc3QgY29sID0gKGM6IEMzKSA9PiBuZXcgQkFCWUxPTi5Db2xvcjMoY1swXSwgY1sxXSwgY1syXSk7XG4gICAgZ20uZGlmZnVzZUNvbG9yID0gY29sKHQuZmxvb3IpOyBjYXZlLndhbGxNYXQuZGlmZnVzZUNvbG9yID0gY29sKHQud2FsbCk7IHJtLmVtaXNzaXZlQ29sb3IgPSBjb2wodC5ydW5lKTtcbiAgICBmb3IgKGNvbnN0IG0gb2YgY2F2ZS5taXN0TWF0cykgbS5lbWlzc2l2ZUNvbG9yID0gY29sKHQubWlzdCk7XG4gICAgc2NlbmUuZm9nQ29sb3IgPSBjb2wodC5mb2cpOyBzY2VuZS5jbGVhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3I0KHQuZm9nWzBdLCB0LmZvZ1sxXSwgdC5mb2dbMl0sIDEpO1xuICAgIGlmIChraXQpIHsga2l0LmFwcGx5KHQpOyBzaG93biA9IHdhbnQ7IH1cbiAgfTtcbiAgbG9hZEtpdChzY2VuZSkudGhlbigoaykgPT4geyBraXQgPSBrOyBzaG93biA9ICcnOyBzaG93KCk7IH0pLmNhdGNoKChlKSA9PiBjb25zb2xlLndhcm4oJ2FyZW5hIHByb3BzIGZhaWxlZCcsIGUpKTtcblxuICByZXR1cm4geyB1cGRhdGU6ICh0OiBudW1iZXIpID0+IHsgcm0uYWxwaGEgPSAwLjQ1ICsgMC4xNSAqIE1hdGguc2luKHQgKiAxLjQpOyBjYXZlLnVwZGF0ZSh0KTsgfSwgc2V0VGhlbWU6IChzdGFnZTogc3RyaW5nKSA9PiB7IHdhbnQgPSBzdGFnZTsgc2hvdygpOyB9IH07XG59XG5cbi8vIC0tLS0gdGhlIGNhdmU6IGEgcm91Z2ggc3RvbmUgd2FsbCBhbGwgdGhlIHdheSByb3VuZCwgcm9jayBzcGlyZXMgYWxvbmcgaXRzIGZvb3QsIGRyaWZ0aW5nIG1pc3QsIGFuZCBhIGRhcmsgdmlnbmV0dGUgb24gdGhlIGZsb29yXG5jb25zdCBSWCA9IDIwLCBSWiA9IDE1LCBDWiA9IC00LCBXQUxMX0ggPSAxNjsgICAvLyBvdmFsIHJpbmcgY2VudHJlZCBhIGxpdHRsZSBiZWhpbmQgdGhlIGZpZWxkOiB0aGUgZmFyIHdhbGwgc3RhbmRzIGFib3V0IDExIG0gcGFzdCB0aGUgY2VudHJlXG5jb25zdCB3b2JibGUgPSAoYTogbnVtYmVyLCB5OiBudW1iZXIpOiBudW1iZXIgPT4gTWF0aC5zaW4oMyAqIGEgKyAxLjMpICogMC41ICsgTWF0aC5zaW4oNyAqIGEgKyB5ICogMC41KSAqIDAuMyArIE1hdGguc2luKDEzICogYSAtIHkgKiAwLjM1KSAqIDAuMiArIE1hdGguc2luKDIzICogYSArIHkpICogMC4wODtcblxuZnVuY3Rpb24gbWlzdFRleHR1cmUoc2NlbmU6IGFueSwgc2VlZDogbnVtYmVyKTogYW55IHtcbiAgY29uc3QgUyA9IDI1NiwgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdtaXN0JyArIHNlZWQsIHsgd2lkdGg6IFMsIGhlaWdodDogUyB9LCBzY2VuZSwgdHJ1ZSksIGMgPSB0LmdldENvbnRleHQoKTtcbiAgYy5jbGVhclJlY3QoMCwgMCwgUywgUyk7XG4gIGxldCByID0gc2VlZCAqIDkzMDEgKyA0OTI5NzsgY29uc3Qgcm5kID0gKCkgPT4gKHIgPSAociAqIDkzMDEgKyA0OTI5NykgJSAyMzMyODApIC8gMjMzMjgwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ2OyBpKyspIHtcbiAgICBjb25zdCB4ID0gcm5kKCkgKiBTLCB5ID0gcm5kKCkgKiBTLCByYWQgPSAyNiArIHJuZCgpICogNDY7XG4gICAgZm9yIChjb25zdCBkeCBvZiBbLVMsIDAsIFNdKSBmb3IgKGNvbnN0IGR5IG9mIFstUywgMCwgU10pIHsgICAgICAgICAgLy8gZHJhdyB3cmFwcGVkIGNvcGllcyBzbyB0aGUgcGljdHVyZSB0aWxlcyB3aXRoIG5vIHNlYW1cbiAgICAgIGNvbnN0IGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KHggKyBkeCwgeSArIGR5LCAwLCB4ICsgZHgsIHkgKyBkeSwgcmFkKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMC41KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICAgICAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIFMsIFMpO1xuICAgIH1cbiAgfVxuICB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gdHJ1ZTsgdC53cmFwVSA9IHQud3JhcFYgPSBCQUJZTE9OLlRleHR1cmUuV1JBUF9BRERSRVNTTU9ERTsgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkQ2F2ZShzY2VuZTogYW55LCBmbG9vclRleDogYW55KTogeyB1cGRhdGUodDogbnVtYmVyKTogdm9pZDsgd2FsbE1hdDogYW55OyBtaXN0TWF0czogYW55W10gfSB7XG4gIC8vIHJvdWdoIHdhbGw6IGFuIG92YWwgcmluZyB3aG9zZSByYWRpdXMgd29iYmxlcyB3aXRoIGFuZ2xlIGFuZCBoZWlnaHQsIGRhcmtlciB0aGUgaGlnaGVyIGl0IGdvZXNcbiAgY29uc3QgTiA9IDEyMCwgTSA9IDEyLCBwb3M6IG51bWJlcltdID0gW10sIHV2OiBudW1iZXJbXSA9IFtdLCBjb2w6IG51bWJlcltdID0gW10sIGlkeDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaiA9IDA7IGogPD0gTTsgaisrKSBmb3IgKGxldCBpID0gMDsgaSA8PSBOOyBpKyspIHtcbiAgICBjb25zdCBhID0gKGkgLyBOKSAqIE1hdGguUEkgKiAyLCBoID0gKGogLyBNKSAqIFdBTExfSCwgayA9IDEgKyAwLjA2ICogd29iYmxlKGEsIGgpICsgKGogPT09IDAgPyAwIDogMC4wNSAqIE1hdGguc2luKGEgKiA1ICsgaikpO1xuICAgIGNvbnN0IG92ZXJoYW5nID0gMSAtIDAuMSAqIE1hdGguc2luKChqIC8gTSkgKiBNYXRoLlBJKTsgICAgICAgICAgICAgICAgICAgICAgICAvLyBsZWFucyBpbiBhIGxpdHRsZSBzbyBpdCBmZWVscyBsaWtlIGEgY2F2ZXJuXG4gICAgcG9zLnB1c2goTWF0aC5jb3MoYSkgKiBSWCAqIGsgKiBvdmVyaGFuZywgaCwgQ1ogKyBNYXRoLnNpbihhKSAqIFJaICogayAqIG92ZXJoYW5nKTsgdXYucHVzaCgoaSAvIE4pICogMTQsIChqIC8gTSkgKiAzLjIpO1xuICAgIGNvbnN0IGIgPSBNYXRoLm1heCgwLjA2LCAxLjAgLSAoaiAvIE0pICogMC45KTsgY29sLnB1c2goYiAqIDAuOCwgYiwgYiwgMSk7XG4gIH1cbiAgZm9yIChsZXQgaiA9IDA7IGogPCBNOyBqKyspIGZvciAobGV0IGkgPSAwOyBpIDwgTjsgaSsrKSB7IGNvbnN0IGEgPSBqICogKE4gKyAxKSArIGksIGIgPSBhICsgMSwgYyA9IGEgKyBOICsgMSwgZCA9IGMgKyAxOyBpZHgucHVzaChhLCBjLCBiLCBiLCBjLCBkKTsgfVxuICBjb25zdCB3YWxsID0gbmV3IEJBQllMT04uTWVzaCgnY2F2ZScsIHNjZW5lKSwgdmQgPSBuZXcgQkFCWUxPTi5WZXJ0ZXhEYXRhKCk7IHZkLnBvc2l0aW9ucyA9IHBvczsgdmQuaW5kaWNlcyA9IGlkeDsgdmQudXZzID0gdXY7IHZkLmNvbG9ycyA9IGNvbDtcbiAgY29uc3QgbnJtOiBudW1iZXJbXSA9IFtdOyBCQUJZTE9OLlZlcnRleERhdGEuQ29tcHV0ZU5vcm1hbHMocG9zLCBpZHgsIG5ybSk7IHZkLm5vcm1hbHMgPSBucm07IHZkLmFwcGx5VG9NZXNoKHdhbGwpO1xuICBjb25zdCB3bSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2NhdmVtJywgc2NlbmUpOyB3bS5kaWZmdXNlVGV4dHVyZSA9IGZsb29yVGV4LmNsb25lKCk7IHdtLmRpZmZ1c2VUZXh0dXJlLnVTY2FsZSA9IDE7IHdtLmRpZmZ1c2VUZXh0dXJlLnZTY2FsZSA9IDE7XG4gIHdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyB3bS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgd20uZGlmZnVzZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuODUsIDAuOSk7IHdhbGwubWF0ZXJpYWwgPSB3bTsgd2FsbC5pc1BpY2thYmxlID0gZmFsc2U7IHdhbGwudXNlVmVydGV4Q29sb3JzID0gdHJ1ZTsgd20udXNlVmVydGV4Q29sb3IgPSB0cnVlO1xuICAvLyByb2NrIHNwaXJlcyBzdGFuZGluZyBhbG9uZyB0aGUgZm9vdCBvZiB0aGUgd2FsbCAob25lIHNoYXJlZCBtZXNoLCBtYW55IGNvcGllcylcbiAgY29uc3Qgc3BpcmUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzcGlyZScsIHsgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiAxLjYsIGhlaWdodDogMSwgdGVzc2VsbGF0aW9uOiA1IH0sIHNjZW5lKTtcbiAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzcGlyZW0nLCBzY2VuZSk7IHNtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAzLCAwLjA0NSwgMC4wNTUpOyBzbS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgc20uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAwNCwgMC4wMTIsIDAuMDE0KTsgc3BpcmUubWF0ZXJpYWwgPSBzbTtcbiAgc3BpcmUuY29udmVydFRvRmxhdFNoYWRlZE1lc2goKTsgc3BpcmUuc2V0RW5hYmxlZChmYWxzZSk7IHNwaXJlLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgbGV0IHIgPSAxMjM0NTsgY29uc3Qgcm5kID0gKCkgPT4gKHIgPSAociAqIDkzMDEgKyA0OTI5NykgJSAyMzMyODApIC8gMjMzMjgwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQ2OyBpKyspIHtcbiAgICBjb25zdCBhID0gKGkgLyA0NikgKiBNYXRoLlBJICogMiArIChybmQoKSAtIDAuNSkgKiAwLjEyLCBkID0gMC44NiArIHJuZCgpICogMC4xLCBoZ3QgPSAxLjQgKyBybmQoKSAqIDMuMiwgdyA9IDAuNyArIHJuZCgpICogMS4wO1xuICAgIGNvbnN0IHMgPSBzcGlyZS5jcmVhdGVJbnN0YW5jZSgnc3AnICsgaSk7IHMuaXNQaWNrYWJsZSA9IGZhbHNlOyBzLnBvc2l0aW9uLnNldChNYXRoLmNvcyhhKSAqIFJYICogZCwgaGd0IC8gMiAtIDAuMiwgQ1ogKyBNYXRoLnNpbihhKSAqIFJaICogZCk7XG4gICAgcy5zY2FsaW5nLnNldCh3LCBoZ3QsIHcpOyBzLnJvdGF0aW9uLnkgPSBybmQoKSAqIDY7IHMucm90YXRpb24ueiA9IChybmQoKSAtIDAuNSkgKiAwLjE4O1xuICB9XG4gIC8vIG1pc3Q6IHR3byBzbG93IGxheWVycyBqdXN0IGFib3ZlIHRoZSBmbG9vclxuICBjb25zdCBsYXllcnMgPSBbMC4yOCwgMC43NV0ubWFwKCh5LCBuKSA9PiB7XG4gICAgY29uc3QgcCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdtaXN0JyArIG4sIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQ0IH0sIHNjZW5lKTsgcC5wb3NpdGlvbi55ID0geTsgcC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ21pc3RtJyArIG4sIHNjZW5lKSwgdCA9IG1pc3RUZXh0dXJlKHNjZW5lLCBuICsgMyk7IHQudVNjYWxlID0gNSAtIG47IHQudlNjYWxlID0gMy40IC0gbiAqIDAuNjtcbiAgICBtLmRpZmZ1c2VUZXh0dXJlID0gdDsgbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjIsIDAuNiwgMC41NSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IDAuMTUgLSBuICogMC4wNjsgbS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTtcbiAgICBtLmRpc2FibGVEZXB0aFdyaXRlID0gdHJ1ZTsgcC5tYXRlcmlhbCA9IG07IHAuYWxwaGFJbmRleCA9IDUgKyBuOyByZXR1cm4geyB0LCBuLCBtIH07XG4gIH0pO1xuICAvLyB2aWduZXR0ZTogZGFya2VucyB0aGUgZmxvb3IgdG93YXJkIHRoZSBlZGdlcyBzbyB0aGUgZmllbGQgbG9va3MgbGlrZSBhIGxpdCBwb29sIGluc2lkZSB0aGUgY2F2ZVxuICBjb25zdCB2dCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCd2aWcnLCB7IHdpZHRoOiAyNTYsIGhlaWdodDogMjU2IH0sIHNjZW5lLCB0cnVlKSwgdmMgPSB2dC5nZXRDb250ZXh0KCksIGcgPSB2Yy5jcmVhdGVSYWRpYWxHcmFkaWVudCgxMjgsIDEyOCwgMCwgMTI4LCAxMjgsIDEyOCk7XG4gIGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDAsMCwwLDApJyk7IGcuYWRkQ29sb3JTdG9wKDAuNDIsICdyZ2JhKDAsMCwwLDApJyk7IGcuYWRkQ29sb3JTdG9wKDAuOCwgJ3JnYmEoMCw0LDYsMC43KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgwLDQsNiwwLjk1KScpO1xuICB2Yy5maWxsU3R5bGUgPSBnOyB2Yy5maWxsUmVjdCgwLCAwLCAyNTYsIDI1Nik7IHZ0LnVwZGF0ZSgpOyB2dC5oYXNBbHBoYSA9IHRydWU7XG4gIGNvbnN0IHZpZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCd2aWcnLCB7IHdpZHRoOiA0NiwgaGVpZ2h0OiAzMCB9LCBzY2VuZSk7IHZpZy5wb3NpdGlvbi55ID0gMC4wMzsgdmlnLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgY29uc3Qgdm0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd2aWdtJywgc2NlbmUpOyB2bS5kaWZmdXNlVGV4dHVyZSA9IHZ0OyB2bS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHZtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHZtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMCwgMC4wMSwgMC4wMTUpOyB2bS5kaXNhYmxlRGVwdGhXcml0ZSA9IHRydWU7IHZpZy5tYXRlcmlhbCA9IHZtOyB2aWcuYWxwaGFJbmRleCA9IDE7XG4gIHJldHVybiB7IHdhbGxNYXQ6IHdtLCBtaXN0TWF0czogbGF5ZXJzLm1hcCgobCkgPT4gbC5tKSwgdXBkYXRlOiAodDogbnVtYmVyKSA9PiB7IGZvciAoY29uc3QgbCBvZiBsYXllcnMpIHsgbC50LnVPZmZzZXQgPSB0ICogKDAuMDA2ICsgbC5uICogMC4wMDQpOyBsLnQudk9mZnNldCA9IHQgKiAwLjAwMyAqIChsLm4gPyAtMSA6IDEpOyB9IH0gfTtcbn1cbiIsICIvLyBFbmRsZXNzIERlcHRoczogZW5lbXkgd2F2ZXMgYnVpbHQgZnJvbSBhIEJVREdFVCBpbnN0ZWFkIG9mIGEgaGFuZC13cml0dGVuIGxpc3QsIHNvIHRoZSBtb2RlIG5ldmVyIHJ1bnMgb3V0IG9mIHdhdmVzLlxuLy8gVGhlIGJ1ZGdldCBpcyB0aGUgZW5lbXkgdGVhbSdzIHRvdGFsIERvbWluaW9uIGNvc3QgKHRoZSBzYW1lIENPU1QgdGFibGUgdGhlIHBsYXllciBwYXlzIGZyb20pLiBXYXZlcyBhcmUgYnVpbHQgZnJvbSByb2xlIFRFTVBMQVRFUyBzbyB0aGV5XG4vLyBsb29rIGRlc2lnbmVkIChhIGZyb250IGxpbmUgd2l0aCBhcmNoZXJzIGJlaGluZCwgYSBzd2FybSwgYSBicnV0ZSBzcXVhZCkgaW5zdGVhZCBvZiBhIHJhbmRvbSBwaWxlLiBFdmVyeXRoaW5nIGlzIHNlZWRlZDogdGhlIHNhbWUgc2VlZCBnaXZlc1xuLy8gdGhlIHNhbWUgd2F2ZXMsIHNvIGEgcmV0cnkgKG9yIGEgZGFpbHkgc2VlZCkgZmFjZXMgZXhhY3RseSB0aGUgc2FtZSBhcm15LlxuLy9cbi8vIFRoZSBwbGF5ZXIncyBhcm15IGlzIGNhcHBlZCBvbiBwdXJwb3NlIChEb21pbmlvbiBzdG9wcyBhdCA0MCwgdGhlIGdyaWQgaG9sZHMgMTIpLCBzbyBhdCBzb21lIHBvaW50IHRoZSBlbmVteSBzaW1wbHkgb3V0LXNjYWxlcyBpdDogdGhhdCBpcyB0aGVcbi8vIFwiaGFyZCB3YWxsXCIuIE9uY2UgdGhlIGJ1ZGdldCBmaWxscyB0aGUgMTIgc2xvdHMgd2l0aCB1cGdyYWRlZCB1bml0cywgYGVuZGxlc3NQb3dlcmAgKHRoZSBoaWRkZW4gaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyKSBrZWVwcyBjbGltYmluZy5cbi8vIE51bWJlcnMgaGVyZSBhcmUgdHVuZWQgd2l0aCBzaW0vZW5kbGVzc19jdXJ2ZS50cy5cblxuaW1wb3J0IHsgQ09TVCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBFbmVteVNwZWMgfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB7IGJvc3NFeHRyYUNvc3QgfSBmcm9tICcuL3dhdmVzLnRzJztcblxuZXhwb3J0IGNvbnN0IEVORExFU1NfSUQgPSAnZW5kbGVzcyc7XG4vKiogQSBwYWNrIGlzIGdyYW50ZWQgZXZlcnkgdGhpcy1tYW55IHdhdmVzIGNsZWFyZWQgaW4gYW4gZW5kbGVzcyBydW4uICovXG5leHBvcnQgY29uc3QgRU5ETEVTU19QQUNLX0VWRVJZID0gMTA7XG5jb25zdCBNQVhfVU5JVFMgPSAxMjtcblxuLyoqIFRoZSB0dW5pbmcga25vYnMgKHNpbS9lbmRsZXNzX2N1cnZlLnRzIHN3ZWVwcyB0aGVtKS4gKi9cbmV4cG9ydCBjb25zdCBUVU5FID0geyBzdGFydDogNSwgc2xvcGU6IDMuMCwgbGF0ZVNsb3BlOiAwLjgsIG1heEJ1ZGdldDogMTUwLCBwb3dlclNsb3BlOiAwLjAxMiwgY2hhbXBpb246IDEuMCB9O1xuLyoqIFRvdGFsIERvbWluaW9uIGNvc3Qgb2YgdGhlIGVuZW15IHRlYW0gYXQgd2F2ZSBgbmAgKDEtYmFzZWQpOiBhIGdlbnRsZSBzdGFydCAoYWJvdXQgdGhlIE5vcm1hbCBjYW1wYWlnbiBieSB3YXZlIDEwKSwgdGhlbiBpdCBrZWVwcyByaXNpbmcuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc0J1ZGdldChuOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgbiksIGVhcmx5ID0gVFVORS5zdGFydCArIFRVTkUuc2xvcGUgKiAoTWF0aC5taW4odywgMTApIC0gMSk7XG4gIHJldHVybiBNYXRoLnJvdW5kKE1hdGgubWluKFRVTkUubWF4QnVkZ2V0LCBlYXJseSArICh3ID4gMTAgPyBUVU5FLmxhdGVTbG9wZSAqICh3IC0gMTApIDogMCkpKTtcbn1cbi8qKiBIaWRkZW4gZW5lbXkgaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyOiAxLjAgdGhyb3VnaCB3YXZlIDEwLCB0aGVuIHJpc2luZzsgZXZlcnkgMTB0aCAoY2hhbXBpb24pIHdhdmUgZ2V0cyBhIGxpdHRsZSBleHRyYS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzUG93ZXIobjogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDEsIG4pLCBiYXNlID0gdyA8PSAxMCA/IDEgOiAxICsgVFVORS5wb3dlclNsb3BlICogKHcgLSAxMCk7XG4gIHJldHVybiArKHcgJSAxMCA9PT0gMCA/IGJhc2UgKiBUVU5FLmNoYW1waW9uIDogYmFzZSkudG9GaXhlZCgzKTtcbn1cbi8qKiBQYWNrIHRpZXIgZm9yIGNsZWFyaW5nIHdhdmUgYG5gIChvbmx5IG1lYW5pbmdmdWwgd2hlbiBuIGlzIGEgbXVsdGlwbGUgb2YgRU5ETEVTU19QQUNLX0VWRVJZKS4gKi9cbmV4cG9ydCBjb25zdCBlbmRsZXNzUGFja1RpZXIgPSAobjogbnVtYmVyKTogbnVtYmVyID0+IChuID49IDMwID8gMyA6IG4gPj0gMjAgPyAyIDogMSk7XG5cbnR5cGUgUm9sZSA9ICd0YW5rJyB8ICdicnV0ZScgfCAncmFuZ2VkJyB8ICdmb2RkZXInO1xuY29uc3QgUk9MRTogUmVjb3JkPFJvbGUsIFNvdWxJZFtdPiA9IHsgdGFuazogWydrbmlnaHQnLCAnb2dyZSddLCBicnV0ZTogWydiYXJiYXJpYW4nLCAnb2dyZSddLCByYW5nZWQ6IFsnYXJjaGVyJ10sIGZvZGRlcjogWyd3YXJyaW9yJywgJ2dvYmxpbiddIH07XG5leHBvcnQgaW50ZXJmYWNlIFRlbXBsYXRlIHsgaWQ6IHN0cmluZzsgbWl4OiBbUm9sZSwgbnVtYmVyXVtdIH1cbmV4cG9ydCBjb25zdCBURU1QTEFURVM6IFRlbXBsYXRlW10gPSBbXG4gIHsgaWQ6ICd3YWxsJywgbWl4OiBbWyd0YW5rJywgM10sIFsncmFuZ2VkJywgMl0sIFsnZm9kZGVyJywgMV1dIH0sXG4gIHsgaWQ6ICdzd2FybScsIG1peDogW1snZm9kZGVyJywgNV0sIFsncmFuZ2VkJywgMV0sIFsndGFuaycsIDFdXSB9LFxuICB7IGlkOiAnYnJ1dGVzJywgbWl4OiBbWydicnV0ZScsIDRdLCBbJ2ZvZGRlcicsIDFdLCBbJ3JhbmdlZCcsIDFdXSB9LFxuICB7IGlkOiAnbWl4ZWQnLCBtaXg6IFtbJ3RhbmsnLCAxXSwgWydicnV0ZScsIDFdLCBbJ3JhbmdlZCcsIDFdLCBbJ2ZvZGRlcicsIDJdXSB9LFxuXTtcblxuLyoqIFdhdmVzIDEtMiBhcmUgYSBnZW50bGUgd2FybS11cDogY2hlYXAgZm9kZGVyIChhbmQgYW4gYXJjaGVyKSwgbm8gdGFua3Mgb3IgYnJ1dGVzLCBzbyBub2JvZHkgbG9zZXMgYSBoZWFydCB0byB0aGUgZmlyc3QgZmlnaHQuICovXG5jb25zdCBXQVJNVVA6IFRlbXBsYXRlID0geyBpZDogJ3dhcm11cCcsIG1peDogW1snZm9kZGVyJywgM10sIFsncmFuZ2VkJywgMV1dIH07XG4vKiogV2hpY2ggdGVtcGxhdGUgYSB3YXZlIHVzZXMgKHNlZWRlZCBwZXIgd2F2ZSwgc28gaXQgZG9lcyBub3QgZGVwZW5kIG9uIHdoYXQgY2FtZSBiZWZvcmUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NUZW1wbGF0ZShuOiBudW1iZXIsIHNlZWQ6IG51bWJlcik6IFRlbXBsYXRlIHtcbiAgaWYgKG4gPD0gMikgcmV0dXJuIFdBUk1VUDtcbiAgcmV0dXJuIFRFTVBMQVRFU1tNYXRoLmZsb29yKG1ha2VSbmcoc2VlZCAqIDQwOTkgKyBuICogMzEgKyA1KS5uZXh0KCkgKiBURU1QTEFURVMubGVuZ3RoKV07XG59XG5cbi8qKiBUaGUgZW5lbXkgYXJteSBmb3IgZW5kbGVzcyB3YXZlIGBuYCAoMS1iYXNlZCkuIEF0IG1vc3QgMTIgdW5pdHM7IHRoZSB3aG9sZSBidWRnZXQgaXMgc3BlbnQgdW5sZXNzIG5vIHVuaXQgZml0cyB3aGF0IGlzIGxlZnQuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc1dhdmUobjogbnVtYmVyLCBzZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgY29uc3Qgd2F2ZSA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IobikpLCBybmcgPSBtYWtlUm5nKHNlZWQgKiAxMDA5ICsgd2F2ZSAqIDc5MTkgKyAxNyksIHRwbCA9IGVuZGxlc3NUZW1wbGF0ZSh3YXZlLCBzZWVkKTtcbiAgbGV0IGxlZnQgPSBlbmRsZXNzQnVkZ2V0KHdhdmUpOyBjb25zdCBhcm15OiBFbmVteVNwZWNbXSA9IFtdO1xuICBpZiAod2F2ZSAlIDEwID09PSAwICYmIGxlZnQgPj0gMjApIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNoYW1waW9uIHdhdmU6IG9uZSBzdGFycmVkIGJydXRlIHVwIGZyb250ICgyIHN0YXJzLCAzIGZyb20gd2F2ZSA0MCksIHRoZW4gdGhlIHVzdWFsIGVzY29ydFxuICAgIGNvbnN0IHNvdWw6IFNvdWxJZCA9IHJuZy5uZXh0KCkgPCAwLjUgPyAnb2dyZScgOiAna25pZ2h0Jywgc3RhciA9IHdhdmUgPj0gNDAgPyAzIDogMjsgYXJteS5wdXNoKHsgc291bCwgc3RhciwgYm9zczogdHJ1ZSB9KTsgbGVmdCAtPSBDT1NUW3NvdWxdW3N0YXIgLSAxXSArIE1hdGgucm91bmQoYm9zc0V4dHJhQ29zdChDT1NUW3NvdWxdW3N0YXIgLSAxXSkpOyAgIC8vIHRoZSBib3NzIHBheXMgZm9yIGl0cyBleHRyYSBzdHJlbmd0aCBvdXQgb2YgdGhlIGVzY29ydCBidWRnZXRcbiAgfVxuICBjb25zdCB0b3RhbCA9IHRwbC5taXgucmVkdWNlKChhLCBbLCB3XSkgPT4gYSArIHcsIDApO1xuICBmb3IgKGxldCBndWFyZCA9IDA7IGd1YXJkIDwgODAgJiYgYXJteS5sZW5ndGggPCBNQVhfVU5JVFMgJiYgbGVmdCA+PSAyOyBndWFyZCsrKSB7XG4gICAgbGV0IHIgPSBybmcubmV4dCgpICogdG90YWwsIHJvbGU6IFJvbGUgPSB0cGwubWl4WzBdWzBdO1xuICAgIGZvciAoY29uc3QgW3JvLCB3XSBvZiB0cGwubWl4KSB7IHIgLT0gdzsgaWYgKHIgPD0gMCkgeyByb2xlID0gcm87IGJyZWFrOyB9IH1cbiAgICBsZXQgb3B0aW9ucyA9IFJPTEVbcm9sZV0uZmlsdGVyKChzKSA9PiBDT1NUW3NdWzBdIDw9IGxlZnQpO1xuICAgIGlmICghb3B0aW9ucy5sZW5ndGgpIG9wdGlvbnMgPSBST0xFLmZvZGRlci5maWx0ZXIoKHMpID0+IENPU1Rbc11bMF0gPD0gbGVmdCk7XG4gICAgaWYgKCFvcHRpb25zLmxlbmd0aCkgYnJlYWs7XG4gICAgY29uc3Qgc291bCA9IHJuZy5waWNrKG9wdGlvbnMpLCBwZXIgPSBsZWZ0IC8gTWF0aC5tYXgoMSwgTUFYX1VOSVRTIC0gYXJteS5sZW5ndGgpO1xuICAgIGxldCBzdGFyID0gMTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc3BhcmUgYnVkZ2V0IHBlciBmcmVlIHNsb3QgYnV5cyBzdGFyc1xuICAgIGZvciAobGV0IHMgPSAzOyBzID49IDI7IHMtLSkgaWYgKENPU1Rbc291bF1bcyAtIDFdIDw9IGxlZnQgJiYgQ09TVFtzb3VsXVtzIC0gMV0gPD0gTWF0aC5tYXgoQ09TVFtzb3VsXVswXSwgcGVyICogMS4yKSkgeyBzdGFyID0gczsgYnJlYWs7IH1cbiAgICBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICB9XG4gIHJldHVybiBhcm15O1xufVxuIiwgIi8vIEVuZW15IHdhdmVzIGFuZCB0aGUgY2FtcGFpZ24ncyBzdGFnZXMuIFNhbWUgdW5pdCBwb29sIGFzIHRoZSBwbGF5ZXIuIFRoZSBidWlsZCBzY3JlZW4gcHJldmlld3MgdGhlIENPTVBPU0lUSU9OIG9ubHksIG5ldmVyIHBvc2l0aW9ucy5cbi8vXG4vLyBFYWNoIFNUQUdFIGhhcyBmb3VyIGRpZmZpY3VsdHkgdGllcnMgKGVhc3kgLyBub3JtYWwgLyBoYXJkIC8gbmlnaHRtYXJlKS4gTGF0ZXIgc3RhZ2VzIGFyZSBoYXJkZXI6IHRoZXkgcmV1c2UgdG91Z2hlciB3YXZlIGxpc3RzIGFuZCBhIGhpZGRlblxuLy8gRU5FTVkgUE9XRVIgbXVsdGlwbGllciAoaGVhbHRoIGFuZCBkYW1hZ2Ugb2YgZW5lbXkgdW5pdHMpIHR1bmVkIHBlciBzdGFnZSBhbmQgdGllciB3aXRoIHNpbS9jYWxpYnJhdGVfcG93ZXIudHMsIHNvIHRoYXQgdGhlIGNvbXBldGVudFxuLy8gc3RhbmQtaW4gcGxheWVyIGNsZWFycyBlYWNoIHRpZXIgYWJvdXQgNjAlIG9mIHRoZSB0aW1lIGF0IHRoYXQgdGllcidzIFJFQ09NTUVOREVEIFNPVUwgTEVWRUwgKGV2ZXJ5IFNvdWwgYXQgdGhhdCBsZXZlbCkuXG4vLyBVbmxvY2sgcnVsZXMgbGl2ZSBpbiBwcm9ncmVzcy50czogRWFzeSBhbmQgTm9ybWFsIGFyZSBhbHdheXMgb3BlbjsgY2xlYXJpbmcgTm9ybWFsIG9wZW5zIEhhcmQgYW5kIHRoZSBuZXh0IHN0YWdlOyBjbGVhcmluZyBIYXJkIG9wZW5zIE5pZ2h0bWFyZS5cblxuaW1wb3J0IHsgQ09TVCwgQ1VSVkVTLCBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBFTkRMRVNTX0lELCBlbmRsZXNzUG93ZXIsIGVuZGxlc3NXYXZlIH0gZnJvbSAnLi9lbmRsZXNzLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRW5lbXlTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGJvc3M/OiBib29sZWFuIH1cbmV4cG9ydCB0eXBlIERpZmYgPSAnZWFzeScgfCAnbm9ybWFsJyB8ICdoYXJkJyB8ICduaWdodG1hcmUnO1xuZXhwb3J0IGNvbnN0IERJRkZTOiBEaWZmW10gPSBbJ2Vhc3knLCAnbm9ybWFsJywgJ2hhcmQnLCAnbmlnaHRtYXJlJ107XG5cbmNvbnN0IExFVFRFUjogUmVjb3JkPHN0cmluZywgU291bElkPiA9IHsgVzogJ3dhcnJpb3InLCBBOiAnYXJjaGVyJywgRzogJ2dvYmxpbicsIEs6ICdrbmlnaHQnLCBPOiAnb2dyZScsIEI6ICdiYXJiYXJpYW4nIH07XG5jb25zdCBwYXJzZVdhdmUgPSAoczogc3RyaW5nKTogRW5lbXlTcGVjW10gPT4gcy5zcGxpdCgnICcpLm1hcCgodCkgPT4gKHsgc291bDogTEVUVEVSW3RbMF1dLCBzdGFyOiArdFsxXSB9KSk7XG5cbi8qKlxuICogV2F2ZSBsaXN0cyAoVyB3YXJyaW9yLCBBIGFyY2hlciwgRyBnb2JsaW4sIEsga25pZ2h0LCBPIG9ncmUsIEIgYmFyYmFyaWFuOyBkaWdpdCA9IHN0YXJzKS4gVGhlc2UgZm91ciB3ZXJlIHR1bmVkIGZvciBTdGFnZSAxOyBsYXRlciBzdGFnZXNcbiAqIHJldXNlIHRoZW0gb25lIHRpZXIgdXAgYW5kIGFkZCBlbmVteSBwb3dlci4gSGFyZCBhbmQgTmlnaHRtYXJlIGFyZSB2b2x1bWUtZHJpdmVuICh1cCB0byAxMiBlbmVtaWVzKS5cbiAqIENvbXBldGVudCBzdGFuZC1pbiBjbGVhciByYXRlIHdpdGggRVZFUlkgU291bCBhdCBsZXZlbCAxIC8gNCAvIDY6IGVhc3kgOTgvMTAwLzEwMCwgbm9ybWFsIDgyLzk4LzEwMCwgaGFyZCA3LzYwLzg3LCBuaWdodG1hcmUgMC8zMy83NC5cbiAqL1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVFk6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMScsICdLMSBXMScsICdPMSBXMSBHMScsICdLMSBBMSBXMScsICdPMSBBMSBHMScsICdLMSBPMSBBMScsICdLMSBPMSBBMSBHMScsICdPMSBLMSBBMSBHMScsICdPMSBLMSBBMSBCMScsICdPMiBLMSBBMSBHMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEnLCAnTzEgQTEgRzEgVzEnLCAnSzEgTzEgQTEgVzEnLCAnTzEgSzEgQTEgRzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEnLCAnSzEgTzEgQTEgRzEgVzEnLCAnTzEgSzEgQTEgQjEgRzEnLCAnTzEgSzEgQTIgQjEgRzEnLCAnTzIgSzEgQTEgQjEgRzEgVzEnXSxcbiAgaGFyZDogWydXMSBBMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBBMSBHMSBXMSBXMScsICdLMSBPMSBBMSBXMSBHMSBXMScsICdPMSBLMSBBMiBHMSBXMSBXMSBXMScsICdBMiBLMSBPMSBHMSBXMSBCMSBXMSBXMScsICdLMSBPMSBBMSBHMSBXMiBXMSBXMScsICdPMSBLMSBBMiBCMSBHMSBXMSBXMSBHMScsICdPMiBLMSBBMiBCMSBHMSBXMSBXMSBHMScsICdPMiBLMiBBMSBCMSBHMSBXMSBXMSBXMSBHMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgQTEgRzEgVzEgQjEgVzEnLCAnSzEgTzEgQTEgVzEgRzEgVzEgVzEnLCAnTzEgSzEgQTIgRzEgVzEgQjEgVzEgVzEgRzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEgVzEgVzEgRzEgRzEnLCAnSzEgTzEgQTIgRzEgVzEgQjEgVzEgVzEgRzEgRzEgQjEnLCAnTzEgSzIgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEnLCAnTzIgSzEgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEgSzEnLCAnTzIgSzIgQTIgQjEgRzEgVzEgVzEgVzEgRzEgRzEgQjEgSzEnXSxcbn07XG5cbi8qKiBTdGFnZSAyLCB0aGUgU3Vua2VuIEdyYXZleWFyZDogY3Jvd2RzLiBTYW1lIERvbWluaW9uIGNvc3QgcGVyIHdhdmUgYXMgdGhlIGxpc3RzIG9uZSB0aWVyIHVwLCBidXQgYnVpbHQgZnJvbSBtYW55IFdhcnJpb3JzLCBHb2JsaW5zIGFuZCBBcmNoZXJzIHdpdGggYSBLbmlnaHQgb3IgT2dyZSBob2xkaW5nIHRoZSBmcm9udCAoc2ltL2F1dGhvcl9zdGFnZXMudHMpLiAqL1xuY29uc3QgR1JBVkVZQVJEOiBSZWNvcmQ8RGlmZiwgc3RyaW5nW10+ID0ge1xuICBlYXN5OiBbJ1cxIEExJywgJ0sxIEcxIFcxJywgJ08xIFcxIFcxIFcxIEcxJywgJ08xIEcyIEcxIEExJywgJ08xIFcxIFcxIFcxIEExIEExJywgJ0sxIFcxIFcxIFcxIEExIEExIEExJywgJ08xIFcxIFcxIFcxIFcxIFcxIEExJywgJ08xIFcxIFcxIFcxIFcxIEcxIEcxIEcxJywgJ0sxIFcxIFcxIFcxIFcxIFcxIEcyIEcxIEExJywgJ0sxIFcxIFcxIFcxIFcxIEcxIEcxIEcxIEcxIEExJ10sXG4gIG5vcm1hbDogWydXMSBBMScsICdLMSBHMSBXMSBBMSBXMScsICdLMSBXMSBXMSBXMSBHMSBBMScsICdPMSBXMSBXMSBHMSBHMSBHMSBHMScsICdPMSBXMiBXMSBXMSBXMSBXMSBXMSBHMSBBMScsICdLMSBXMSBXMSBXMSBXMSBXMSBHMSBHMSBHMSBBMSBBMScsICdLMSBXMSBXMSBXMSBHMSBBMSBBMSBBMScsICdPMSBXMSBXMSBHMSBHMSBBMSBBMSBBMSBBMScsICdLMiBXMSBXMSBXMSBXMSBXMSBXMSBHMSBHMSBHMSBBMSBBMScsICdPMSBXMiBXMSBXMSBXMSBXMSBXMSBHMSBHMSBBMSBBMSBBMSddLFxuICBoYXJkOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ08xIFcxIFcxIFcxIFcxIEcyIEExJywgJ08xIFcxIFcxIEcxIEcxIEExIEExJywgJ08xIFcxIFcxIFcxIFcxIFcxIEcxIEcxIEExIEExIEExJywgJ0sxIFczIFcyIFcyIFcyIFcxIFcxIFcxIFcxIEExIEExIEExJywgJ08xIFczIFcyIFcyIFcyIFcyIFcxIFcxIFcxIEczIEcyIEExJywgJ08yIFcyIFcyIFcxIFcxIFcxIEcyIEcxIEcxIEcxIEEyIEExJywgJ0szIFczIFczIFczIFcyIFcyIFcxIFcxIEcyIEcxIEcxIEEzJywgJ0szIFczIFczIFcyIFcyIFcxIEczIEcyIEcyIEcxIEEyIEExJ10sXG4gIG5pZ2h0bWFyZTogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBXMSBXMSBXMSBHMSBHMSBBMScsICdPMSBXMSBXMSBXMSBXMSBHMSBHMSBBMScsICdLMSBXMSBXMSBXMSBXMSBXMSBXMSBXMSBXMSBBMiBBMSBBMScsICdPMSBXMyBXMiBXMSBXMSBXMSBXMSBXMSBHMiBHMSBHMSBBMScsICdPMSBXMiBXMSBXMSBXMSBHMiBHMSBHMSBHMSBBMiBBMSBBMScsICdPMiBXMiBXMSBXMSBXMSBXMSBHMiBHMSBHMSBBMiBBMSBBMScsICdLMiBXMyBXMSBXMSBXMSBHMiBHMiBHMSBBMyBBMiBBMSBBMScsICdPMiBXMSBXMSBXMSBHMiBHMiBHMiBHMSBHMSBBMyBBMiBBMSddLFxufTtcbi8qKiBTdGFnZSAzLCB0aGUgQm9uZSBCYXN0aW9uOiBmZXdlciwgaGVhdmllciBhcm1pZXMgb2YgS25pZ2h0cywgT2dyZXMgYW5kIEJhcmJhcmlhbnMgd2l0aCBBcmNoZXJzIGJlaGluZCAoc2ltL2F1dGhvcl9zdGFnZXMudHMpLiAqL1xuY29uc3QgQkFTVElPTjogUmVjb3JkPERpZmYsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMSBBMScsICdLMSBHMSBXMSBBMSBXMScsICdLMSBLMSBBMSBBMScsICdLMSBLMSBLMSBBMSBBMScsICdLMSBPMSBCMSBCMSBBMScsICdLMSBLMSBPMSBPMSBBMSBBMScsICdLMSBLMSBPMSBCMSBBMScsICdLMSBLMSBLMSBPMSBCMSBCMScsICdLMiBLMSBPMSBPMSBCMSBCMScsICdLMSBLMSBPMSBPMSBCMSBCMSBBMSddLFxuICBub3JtYWw6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgSzEgQTEgQTEnLCAnTzEgTzEgQjEgQjEnLCAnSzIgSzEgSzEgTzEgQjEgQjEnLCAnSzEgTzEgTzEgQjEgQjEgQTEgQTEnLCAnSzIgSzEgSzEgSzEgQjIgQjEgQjEgQTEnLCAnSzIgSzEgSzEgTzEgQjEgQjEgQTIgQTEnLCAnSzIgSzIgTzIgQjEgQjEgQTIgQTIgQTEnLCAnSzIgSzIgSzIgSzEgQjIgQjIgQTMgQTEnXSxcbiAgaGFyZDogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdLMSBLMSBCMSBBMSBBMScsICdLMSBLMSBPMSBBMSBBMScsICdLMSBPMSBCMSBCMSBCMSBBMSBBMScsICdLMSBLMSBLMSBPMSBPMSBCMSBBMScsICdLMSBLMSBLMSBLMSBPMSBCMSBCMSBCMScsICdLMiBLMSBLMSBPMSBPMSBCMSBCMSBBMScsICdLMiBLMSBPMSBPMSBCMSBCMSBCMSBBMycsICdLMiBLMiBLMSBLMSBPMSBPMSBCMyBCMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgTzEgQjEnLCAnSzIgSzEgSzEgTzEnLCAnSzIgSzEgSzEgSzEgSzEgTzEnLCAnSzEgSzEgSzEgTzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgQjIgQjEgQjEgQTIgQTEnLCAnSzEgTzEgTzEgTzEgQjIgQTEgQTEgQTEnLCAnSzEgTzIgTzEgTzEgTzEgQjEgQjEgQTEnLCAnSzMgSzIgSzEgSzEgSzEgTzIgQjEgQjEnXSxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhZ2VEZWYge1xuICBpZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IGJsdXJiOiBzdHJpbmc7XG4gIGxpc3RzOiBSZWNvcmQ8RGlmZiwgc3RyaW5nW10+OyAgICAgICAgICAvLyB0aGUgMTAgZW5lbXkgd2F2ZXMgZm9yIGVhY2ggdGllclxuICBwb3dlcjogUmVjb3JkPERpZmYsIG51bWJlcj47ICAgICAgICAgICAgLy8gaGlkZGVuIGVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgZWFjaCB0aWVyICgxID0gYXMgd3JpdHRlbilcbiAgcmVjOiBSZWNvcmQ8RGlmZiwgbnVtYmVyPjsgICAgICAgICAgICAgIC8vIHJlY29tbWVuZGVkIFNvdWwgbGV2ZWwgZm9yIGVhY2ggdGllciAoYSBoaW50IG9uIEhvbWUsIG5ldmVyIGEgbG9jaylcbn1cblxuLyoqIFRoZSBjYW1wYWlnbi4gTmFtZXMgYXJlIHBsYWNlaG9sZGVycy4gUG93ZXIgbnVtYmVycyBjb21lIGZyb20gc2ltL2NhbGlicmF0ZV9wb3dlci50cy4gKi9cbmV4cG9ydCBjb25zdCBTVEFHRVM6IFN0YWdlRGVmW10gPSBbXG4gIHsgaWQ6ICdjcnlwdCcsIG5hbWU6ICdUaGUgUmVzdGxlc3MgQ3J5cHQnLCBibHVyYjogJ1JhaXNlIHlvdXIgYXJteS4gVGhlIGRlYWQgaGVyZSBhcmUgb25seSBqdXN0IHN0aXJyaW5nLicsXG4gICAgbGlzdHM6IHsgZWFzeTogRElGRklDVUxUWS5lYXN5LCBub3JtYWw6IERJRkZJQ1VMVFkubm9ybWFsLCBoYXJkOiBESUZGSUNVTFRZLmhhcmQsIG5pZ2h0bWFyZTogRElGRklDVUxUWS5uaWdodG1hcmUgfSxcbiAgICBwb3dlcjogeyBlYXN5OiAxLCBub3JtYWw6IDEsIGhhcmQ6IDEsIG5pZ2h0bWFyZTogMSB9LCByZWM6IHsgZWFzeTogMSwgbm9ybWFsOiAxLCBoYXJkOiA0LCBuaWdodG1hcmU6IDYgfSB9LFxuICB7IGlkOiAnZ3JhdmV5YXJkJywgbmFtZTogJ1RoZSBTdW5rZW4gR3JhdmV5YXJkJywgYmx1cmI6ICdCaWdnZXIgY3Jvd2RzIGNyYXdsIG91dCBvZiB0aGUgbXVkLiBMZXZlbCB5b3VyIFNvdWxzIGJlZm9yZSB5b3UgY29tZS4nLFxuICAgIGxpc3RzOiBHUkFWRVlBUkQsXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLjEsIGhhcmQ6IDAuOTgsIG5pZ2h0bWFyZTogMS4yOCB9LCByZWM6IHsgZWFzeTogMiwgbm9ybWFsOiA0LCBoYXJkOiA2LCBuaWdodG1hcmU6IDggfSB9LFxuICB7IGlkOiAnYmFzdGlvbicsIG5hbWU6ICdUaGUgQm9uZSBCYXN0aW9uJywgYmx1cmI6ICdBIGZvcnRyZXNzIG9mIHRoZSBmYWxsZW4uIE9ubHkgd2VsbC1sZXZlbGxlZCBhcm1pZXMgaG9sZCB0aGUgZ2F0ZS4nLFxuICAgIGxpc3RzOiBCQVNUSU9OLFxuICAgIHBvd2VyOiB7IGVhc3k6IDEsIG5vcm1hbDogMC45NywgaGFyZDogMS4yNSwgbmlnaHRtYXJlOiAxLjQ1IH0sIHJlYzogeyBlYXN5OiA0LCBub3JtYWw6IDYsIGhhcmQ6IDgsIG5pZ2h0bWFyZTogMTAgfSB9LFxuXTtcbmV4cG9ydCBjb25zdCBzdGFnZUluZGV4ID0gKGlkOiBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMCwgU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gaWQpKTtcbmV4cG9ydCBjb25zdCBzdGFnZUJ5SWQgPSAoaWQ6IHN0cmluZyk6IFN0YWdlRGVmID0+IFNUQUdFU1tzdGFnZUluZGV4KGlkKV07XG5cbi8qKiBOYW1lcyBhbmQgb25lLWxpbmUgcHJvbWlzZXMgZm9yIHRoZSBkaWZmaWN1bHR5IHBpY2tlci4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZX0lORk8gPSBbXG4gIHsgaWQ6ICdlYXN5JywgbGFiZWw6ICdFYXN5JywgYmx1cmI6ICdTbWFsbGVyIGVuZW15IGFybWllcy4gUmVsYXggYW5kIGxlYXJuIGhvdyBtZXJnaW5nIHdvcmtzLicgfSxcbiAgeyBpZDogJ25vcm1hbCcsIGxhYmVsOiAnTm9ybWFsJywgYmx1cmI6ICdUaGUgc3RhbmRhcmQgZmlnaHQuIENsZWFyaW5nIGl0IHVubG9ja3MgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2UuJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnQmlnZ2VyIGFybWllcyB3aXRoIG1vcmUgZm9kZGVyLiBCZXR0ZXIgZmlyc3QtY2xlYXIgcmV3YXJkcy4gQ2xlYXJpbmcgaXQgdW5sb2NrcyBOaWdodG1hcmUuJyB9LFxuICB7IGlkOiAnbmlnaHRtYXJlJywgbGFiZWw6ICdOaWdodG1hcmUnLCBibHVyYjogJ0EgcGFja2VkIGJhdHRsZWZpZWxkIG9mIHN0YXJzIGFuZCBza2lsbHMuIEJ1aWx0IGZvciB3ZWxsLWxldmVsbGVkIFNvdWxzLicgfSxcbl07XG5cbi8vIC0tLS0gd2hhdCB0aGUgbmV4dCBiYXR0bGUgdXNlcyAoc2V0IHdoZW4gYSBydW4gc3RhcnRzKVxuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZTogc3RyaW5nID0gJ25vcm1hbCc7XG5leHBvcnQgbGV0IGN1cnJlbnRTdGFnZUlkOiBzdHJpbmcgPSAnY3J5cHQnO1xubGV0IHBvd2VyID0gMSwgZW5kbGVzc01vZGUgPSBmYWxzZSwgYm9zc1N0ciA9IDE7XG4vKiogSG93IGhhcmQgdGhlIGJvc3MgaGl0cyBmb3IgdGhlIGN1cnJlbnQgbW9kZSAoMCA9IGFuIG9yZGluYXJ5IHVuaXQsIDEgPSB0aGUgZnVsbCBib3NzKTogZ2VudGxlIG9uIEVhc3ksIGZ1bGwgb24gTmlnaHRtYXJlIGFuZCBpbiBFbmRsZXNzLiAqL1xuZXhwb3J0IGNvbnN0IGJvc3NTdHJlbmd0aCA9ICgpOiBudW1iZXIgPT4gYm9zc1N0cjtcbmNvbnN0IEJPU1NfQllfVElFUjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHsgZWFzeTogMC4yLCBub3JtYWw6IDAuNSwgaGFyZDogMC44LCBuaWdodG1hcmU6IDEgfTtcbmxldCBkYWlseVJld3JpdGU6ICgodzogRW5lbXlTcGVjW10sIHdhdmU6IG51bWJlcikgPT4gRW5lbXlTcGVjW10pIHwgbnVsbCA9IG51bGw7ICAgLy8gc2V0IG9ubHkgZHVyaW5nIGEgRGFpbHkgQ2hhbGxlbmdlIHJ1blxuLyoqIEVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGN1cnJlbnQgc3RhZ2UgYW5kIHRpZXIgKGluIGVuZGxlc3MgbW9kZSBpdCBkZXBlbmRzIG9uIHRoZSB3YXZlKS4gKi9cbmV4cG9ydCBjb25zdCBlbmVteVBvd2VyID0gKHdhdmUgPSAxKTogbnVtYmVyID0+IChlbmRsZXNzTW9kZSA/IGVuZGxlc3NQb3dlcih3YXZlKSA6IHBvd2VyKTtcbmV4cG9ydCBjb25zdCBpc0VuZGxlc3MgPSAoKTogYm9vbGVhbiA9PiBlbmRsZXNzTW9kZTtcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyICgxMCB3YXZlcykuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXRTdGFnZURpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFN0YWdlRGlmZmljdWx0eShzdGFnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBzdGFnZUJ5SWQoc3RhZ2UpOyBpZiAoIURJRkZTLmluY2x1ZGVzKG5hbWUgYXMgRGlmZikpIHJldHVybjtcbiAgZW5kbGVzc01vZGUgPSBmYWxzZTsgZGFpbHlSZXdyaXRlID0gbnVsbDsgYm9zc1N0ciA9IEJPU1NfQllfVElFUltuYW1lXSA/PyAwLjU7IGN1cnJlbnRTdGFnZUlkID0gc3QuaWQ7IGRpZmZpY3VsdHlOYW1lID0gbmFtZTsgcG93ZXIgPSBzdC5wb3dlcltuYW1lIGFzIERpZmZdO1xuICBBVVRIT1JFRC5sZW5ndGggPSAwOyBzdC5saXN0c1tuYW1lIGFzIERpZmZdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG4vKiogU3dpdGNoIHRvIHRoZSBEYWlseSBDaGFsbGVuZ2U6IFN0YWdlIDEgTm9ybWFsIHdpdGggdGhlIGRheSdzIHR3aXN0IChzZWUgY29yZS9kYWlseS50cykuIGBkYXlgIGlzIGtlcHQgYXMgdGhlICdkaWZmaWN1bHR5JyBzbyBhIHNhdmVkIHJ1biBjYW4gcmVidWlsZCB0aGUgc2FtZSBkYXkuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0RGFpbHkobW9kOiB7IHBvd2VyOiBudW1iZXI7IGVuZW15PzogKHc6IEVuZW15U3BlY1tdLCB3YXZlOiBudW1iZXIpID0+IEVuZW15U3BlY1tdIH0sIGRheTogbnVtYmVyKTogdm9pZCB7XG4gIHNldFN0YWdlRGlmZmljdWx0eSgnY3J5cHQnLCAnbm9ybWFsJyk7IGRhaWx5UmV3cml0ZSA9IG1vZC5lbmVteSA/PyBudWxsOyBjdXJyZW50U3RhZ2VJZCA9ICdkYWlseSc7IGRpZmZpY3VsdHlOYW1lID0gU3RyaW5nKGRheSk7IHBvd2VyID0gbW9kLnBvd2VyO1xufVxuLyoqIFN3aXRjaCB0byBFbmRsZXNzIERlcHRoczogd2F2ZXMgY29tZSBmcm9tIGNvcmUvZW5kbGVzcy50cyBpbnN0ZWFkIG9mIGEgc3RhZ2UgbGlzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRFbmRsZXNzKCk6IHZvaWQgeyBlbmRsZXNzTW9kZSA9IHRydWU7IGRhaWx5UmV3cml0ZSA9IG51bGw7IGJvc3NTdHIgPSAxOyBjdXJyZW50U3RhZ2VJZCA9IEVORExFU1NfSUQ7IGRpZmZpY3VsdHlOYW1lID0gJ2VuZGxlc3MnOyBwb3dlciA9IDE7IEFVVEhPUkVELmxlbmd0aCA9IDA7IH1cbi8qKiBDaGFuZ2UgdGhlIHRpZXIgd2l0aGluIHRoZSBjdXJyZW50IHN0YWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldERpZmZpY3VsdHkobmFtZTogc3RyaW5nKTogdm9pZCB7IHNldFN0YWdlRGlmZmljdWx0eShjdXJyZW50U3RhZ2VJZCwgbmFtZSk7IH1cblxuZXhwb3J0IGNvbnN0IHdhdmVDb3N0ID0gKHc6IEVuZW15U3BlY1tdKTogbnVtYmVyID0+IHcucmVkdWNlKChuLCBlKSA9PiBuICsgQ09TVFtlLnNvdWxdW2Uuc3RhciAtIDFdLCAwKTtcblxuLyoqIFRoZSBsYXN0IHdhdmUgb2YgYSBzdGFnZSBoYXMgYSBCT1NTOiBpdHMgYmlnZ2VzdCB1bml0IChhIGJydXRlIGlmIHRoZXJlIGlzIG9uZSkgZ2V0cyBleHRyYSBoZWFsdGgsIGRhbWFnZSBhbmQgc2l6ZSAoc2VlIEJPU1MgaW4gYmF0dGxlLnRzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXJrQm9zcyh3OiBFbmVteVNwZWNbXSk6IEVuZW15U3BlY1tdIHtcbiAgbGV0IGJlc3QgPSAtMSwgYnMgPSAtMTtcbiAgdy5mb3JFYWNoKChlLCBpKSA9PiB7IGNvbnN0IGJydXRlID0gZS5zb3VsID09PSAnb2dyZScgfHwgZS5zb3VsID09PSAna25pZ2h0JyB8fCBlLnNvdWwgPT09ICdiYXJiYXJpYW4nID8gMTAwIDogMCwgc2MgPSBicnV0ZSArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXTsgaWYgKHNjID4gYnMpIHsgYnMgPSBzYzsgYmVzdCA9IGk7IH0gfSk7XG4gIGlmIChiZXN0ID49IDApIHtcbiAgICB3W2Jlc3RdID0geyAuLi53W2Jlc3RdLCBib3NzOiB0cnVlIH07XG4gICAgLy8gVGhlIGJvc3MgcGF5cyBmb3IgaXRzZWxmOiBpdHMgZXh0cmEgaGVhbHRoIGFuZCBkYW1hZ2UgYXJlIHRha2VuIG91dCBvZiB0aGUgZXNjb3J0LCBzbyB0aGUgd2hvbGUgd2F2ZSBpcyBhYm91dCBhcyBzdHJvbmcgYXMgdGhlIHBsYWluIHdhdmUgaXQgcmVwbGFjZXMuXG4gICAgY29uc3QgZXh0cmEgPSBNYXRoLnJvdW5kKGJvc3NFeHRyYUNvc3QoQ09TVFt3W2Jlc3RdLnNvdWxdW3dbYmVzdF0uc3RhciAtIDFdKSk7IGxldCByZW1vdmVkID0gMDtcbiAgICBjb25zdCBvcmRlciA9IHcubWFwKChlLCBpKSA9PiBpKS5maWx0ZXIoKGkpID0+IGkgIT09IGJlc3QpLnNvcnQoKGEsIGIpID0+IENPU1Rbd1thXS5zb3VsXVt3W2FdLnN0YXIgLSAxXSAtIENPU1Rbd1tiXS5zb3VsXVt3W2JdLnN0YXIgLSAxXSk7XG4gICAgY29uc3QgZHJvcCA9IG5ldyBTZXQ8bnVtYmVyPigpOyBmb3IgKGNvbnN0IGkgb2Ygb3JkZXIpIHsgY29uc3QgYyA9IENPU1Rbd1tpXS5zb3VsXVt3W2ldLnN0YXIgLSAxXTsgaWYgKHJlbW92ZWQgKyBjIDw9IGV4dHJhICsgMSAmJiBkcm9wLnNpemUgPCBvcmRlci5sZW5ndGggLSAxKSB7IGRyb3AuYWRkKGkpOyByZW1vdmVkICs9IGM7IH0gfVxuICAgIHJldHVybiB3LmZpbHRlcigoXywgaSkgPT4gIWRyb3AuaGFzKGkpKTtcbiAgfVxuICByZXR1cm4gdztcbn1cbi8qKiBIb3cgbXVjaCBEb21pbmlvbi13b3J0aCBvZiBleHRyYSBzdHJlbmd0aCBhIGJvc3Mgb2YgdGhpcyBjb3N0IGhhcyAoaXRzIGhlYWx0aCBhbmQgZGFtYWdlIGJvbnVzZXMgYXQgdGhlIGN1cnJlbnQgYm9zcyBzdHJlbmd0aCkuICovXG5leHBvcnQgY29uc3QgYm9zc0V4dHJhQ29zdCA9IChjb3N0OiBudW1iZXIpOiBudW1iZXIgPT4gY29zdCAqICgoMSArIDAuNiAqIGJvc3NTdHIpICogKDEgKyAwLjIgKiBib3NzU3RyKSAtIDEpO1xuLyoqIEVuZW15IGFybXkgZm9yIGEgd2F2ZSAoMS1iYXNlZCkuIFdhdmVzIHBhc3QgdGhlIGF1dGhvcmVkIG9uZXMgYXJlIGdlbmVyYXRlZCBmcm9tIGEgZml4ZWQgc2VlZCBzbyByZXRyaWVzIGZhY2UgdGhlIHNhbWUgYXJteS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteVdhdmUod2F2ZTogbnVtYmVyLCBzdGFnZVNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBpZiAoZW5kbGVzc01vZGUpIHJldHVybiBlbmRsZXNzV2F2ZSh3YXZlLCBzdGFnZVNlZWQpO1xuICBpZiAod2F2ZSA8PSBBVVRIT1JFRC5sZW5ndGgpIHsgbGV0IHcgPSBBVVRIT1JFRFt3YXZlIC0gMV0ubWFwKChlKSA9PiAoeyAuLi5lIH0pKTsgaWYgKGRhaWx5UmV3cml0ZSkgdyA9IGRhaWx5UmV3cml0ZSh3LCB3YXZlKTsgcmV0dXJuIHdhdmUgPT09IEFVVEhPUkVELmxlbmd0aCA/IG1hcmtCb3NzKHcpIDogdzsgfVxuICBjb25zdCBjYXAgPSBDVVJWRVMuZG9jW01hdGgubWluKHdhdmUsIENVUlZFUy5kb2MubGVuZ3RoKSAtIDFdO1xuICBjb25zdCBidWRnZXQgPSBNYXRoLnJvdW5kKGNhcCAqIDAuOTIpO1xuICBjb25zdCBybmcgPSBtYWtlUm5nKHN0YWdlU2VlZCAqIDEwMDkgKyB3YXZlICogNzkxOSk7XG4gIGNvbnN0IGFybXk6IEVuZW15U3BlY1tdID0gW107XG4gIGxldCBsZWZ0ID0gYnVkZ2V0O1xuICBmb3IgKGxldCBndWFyZCA9IDA7IGd1YXJkIDwgNDAgJiYgbGVmdCA+PSAyOyBndWFyZCsrKSB7XG4gICAgY29uc3Qgc291bCA9IHJuZy5waWNrKFNPVUxTKTtcbiAgICBsZXQgc3RhciA9IDE7XG4gICAgaWYgKHJuZy5uZXh0KCkgPCAwLjM1ICYmIENPU1Rbc291bF1bMV0gPD0gbGVmdCkgc3RhciA9IDI7XG4gICAgaWYgKHdhdmUgPj0gNiAmJiBybmcubmV4dCgpIDwgMC4yNSAmJiBDT1NUW3NvdWxdWzJdIDw9IGxlZnQpIHN0YXIgPSAzO1xuICAgIGNvbnN0IGMgPSBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbiAgICBpZiAoYyA8PSBsZWZ0ICYmIGFybXkubGVuZ3RoIDwgMTIpIHsgYXJteS5wdXNoKHsgc291bCwgc3RhciB9KTsgbGVmdCAtPSBjOyB9XG4gIH1cbiAgcmV0dXJuIGFybXk7XG59XG5cbi8qKiBXaGF0IHRoZSBidWlsZCBzY3JlZW4gc2hvd3M6IGNvdW50cyBwZXIgU291bCBhbmQgc3Rhciwgbm8gcG9zaXRpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByZXZpZXdUZXh0KHc6IEVuZW15U3BlY1tdKTogeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY291bnQ6IG51bWJlcjsgYm9zcz86IGJvb2xlYW4gfVtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXI7IGJvc3M/OiBib29sZWFuIH0+KCk7XG4gIGZvciAoY29uc3QgZSBvZiB3KSB7XG4gICAgY29uc3QgayA9IGUuc291bCArIGUuc3RhciArIChlLmJvc3MgPyAnQicgOiAnJyk7XG4gICAgY29uc3QgY3VyID0gbWFwLmdldChrKTtcbiAgICBpZiAoY3VyKSBjdXIuY291bnQrKzsgZWxzZSBtYXAuc2V0KGssIHsgc291bDogZS5zb3VsLCBzdGFyOiBlLnN0YXIsIGNvdW50OiAxLCBib3NzOiBlLmJvc3MgfSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldO1xufVxuIiwgIi8vIEF1dG8tYmF0dGxlIHNpbXVsYXRpb246IHB1cmUgbG9naWMsIG5vIGdyYXBoaWNzLiBEZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHNlZWQuXG4vLyBUaGUgcmVuZGVyZXIgb25seSByZWFkcyBmaWdodGVycyArIGV2ZW50czsgaXQgbmV2ZXIgZGVjaWRlcyBhbnl0aGluZy5cbi8vXG4vLyBBYmlsaXRpZXMgKG51bWJlcnMgbGl2ZSBpbiBiYWxhbmNlLnRzKTpcbi8vICAgU2tlbGV0b24gV2FycmlvciAgUGhhbGFueCAgICAgdGFrZXMgbGVzcyBkYW1hZ2UgZm9yIGVhY2ggbmVhcmJ5IGFsbGllZCBXYXJyaW9yIChjYXBwZWQpXG4vLyAgIFNrZWxldG9uIEFyY2hlciAgIFNwbGl0IEFycm93IChza2lsbCkgb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllczsgYmFzaWMgc2hvdHMgYXJlIGEgc2luZ2xlIGFycm93XG4vLyAgIEdvYmxpbiAgICAgICAgICAgIE9wcG9ydHVuaXN0ICtkYW1hZ2Ugb24gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2U7IHByZWZlcnMgc3VjaCB0YXJnZXRzXG4vLyAgIEtuaWdodCAgICAgICAgICAgIFRhdW50IChza2lsbCkgIGZvcmNlcyBuZWFyYnkgZW5lbWllcyB0byBhdHRhY2sgaGltXG4vLyAgIE9ncmUgICAgICAgICAgICAgIFNtYXNoIChza2lsbCkgIGhlYXZ5IHNsYW0gdGhhdCBhbHNvIGhpdHMgZW5lbWllcyBuZWFyIHRoZSBpbXBhY3Rcbi8vIFNraWxscyBydW4gb24gbWFuYTogYmFzaWMgYXR0YWNrcyBhbmQgZGFtYWdlIHRha2VuIGZpbGwgYSBiYXI7IHdoZW4gZnVsbCwgdGhlIG5leHQgYXR0YWNrIGlzIHRoZSBza2lsbCBhbmQgdGhlIGJhciByZXNldHMuXG4vLyBXYXJyaW9yLCBHb2JsaW4gYW5kIEJhcmJhcmlhbiBoYXZlIHBhc3NpdmVzIG9ubHkgKG5vIG1hbmEpLlxuLy8gICBCYXJiYXJpYW4gICAgICAgICBGcmVuenkgICAgICBhdHRhY2tzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmdcblxuaW1wb3J0IHsgR1JJRF9DT0xTLCBHUklEX1JPV1MgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBib3NzU3RyZW5ndGggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGNvbnN0IEdSSURfU1AgPSAxLjM7ICAgICAvLyBtZXRyZXMgYmV0d2VlbiBncmlkIGNlbGxzXG5leHBvcnQgY29uc3QgRlJPTlRfWCA9IDEuNzsgICAgIC8vIGZyb250IGxpbmUncyBkaXN0YW5jZSBmcm9tIHRoZSBjZW50cmUgbGluZVxuXG5leHBvcnQgaW50ZXJmYWNlIFNsb3QgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgU3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyIH1cblxuLyoqIFdvcmxkIHBvc2l0aW9uIG9mIGEgZ3JpZCBjZWxsIGZvciBhIHRlYW0gKHRlYW0gMCA9IGxlZnQsIGZhY2VzICtYOyB0ZWFtIDEgPSByaWdodCwgZmFjZXMgLVgpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNlbGxQb3ModGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcik6IHsgeDogbnVtYmVyOyB6OiBudW1iZXIgfSB7XG4gIGNvbnN0IHJvdyA9IE1hdGguZmxvb3IoY2VsbCAvIEdSSURfQ09MUyksIGNvbCA9IGNlbGwgJSBHUklEX0NPTFM7XG4gIGNvbnN0IGRlcHRoID0gR1JJRF9DT0xTIC0gMSAtIGNvbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIDAgPSBmcm9udCBsaW5lXG4gIHJldHVybiB7IHg6IChGUk9OVF9YICsgZGVwdGggKiBHUklEX1NQKSAqICh0ZWFtID09PSAwID8gLTEgOiAxKSwgejogKHJvdyAtIChHUklEX1JPV1MgLSAxKSAvIDIpICogR1JJRF9TUCB9O1xufVxuXG5jb25zdCBGUk9OVE5FU1M6IFJlY29yZDxTb3VsSWQsIG51bWJlcj4gPSB7IGtuaWdodDogNSwgb2dyZTogNCwgd2FycmlvcjogMywgYmFyYmFyaWFuOiAzLCBnb2JsaW46IDIsIGFyY2hlcjogMCB9O1xuLyoqIFRoZSBlbmVteSBhcm15IGlzIHBsYWNlZCBhdXRvbWF0aWNhbGx5ICh0YW5rcyB1cCBmcm9udCwgYXJjaGVycyBiZWhpbmQpOyB0aGUgcGxheWVyIG9ubHkgZXZlciBzZWVzIGl0cyBjb21wb3NpdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteUNlbGxzKHNwZWNzOiBTcGVjW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IGNlbGxzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ09MUyAqIEdSSURfUk9XUzsgYysrKSBjZWxscy5wdXNoKGMpO1xuICBjZWxscy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgZGEgPSBHUklEX0NPTFMgLSAxIC0gKGEgJSBHUklEX0NPTFMpLCBkYiA9IEdSSURfQ09MUyAtIDEgLSAoYiAlIEdSSURfQ09MUyk7XG4gICAgaWYgKGRhICE9PSBkYikgcmV0dXJuIGRhIC0gZGI7XG4gICAgcmV0dXJuIE1hdGguYWJzKE1hdGguZmxvb3IoYSAvIEdSSURfQ09MUykgLSAxKSAtIE1hdGguYWJzKE1hdGguZmxvb3IoYiAvIEdSSURfQ09MUykgLSAxKTtcbiAgfSk7XG4gIGNvbnN0IG9yZGVyID0gc3BlY3MubWFwKChzLCBpKSA9PiBpKS5zb3J0KChpLCBqKSA9PiBGUk9OVE5FU1Nbc3BlY3Nbal0uc291bF0gLSBGUk9OVE5FU1Nbc3BlY3NbaV0uc291bF0pO1xuICBjb25zdCBvdXQgPSBuZXcgQXJyYXk8bnVtYmVyPihzcGVjcy5sZW5ndGgpO1xuICBvcmRlci5mb3JFYWNoKChpZHgsIGspID0+IHsgb3V0W2lkeF0gPSBjZWxsc1trXTsgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCB0eXBlIEZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhZCc7XG4vKiogQSBib3NzIGlzIG9uZSBlbmVteSB3aXRoIGV4dHJhIGhlYWx0aCBhbmQgZGFtYWdlLCBhbmQgbW9yZSBzaXplLiAqL1xuZXhwb3J0IGNvbnN0IEJPU1MgPSB7IGhwOiAwLjYsIGRtZzogMC4yLCBzaXplOiAxLjMgfTsgICAvLyBzaXplIGlzIHRoZSBsb29rIG9ubHkgKGdhbWUvdmlzdWFscy50cykgICAgIC8vIGV4dHJhcyBhdCBmdWxsIHN0cmVuZ3RoIChzZWUgYm9zc1N0cmVuZ3RoIGluIHdhdmVzLnRzKVxuZXhwb3J0IGludGVyZmFjZSBGaWdodGVyIHtcbiAgYm9zcz86IGJvb2xlYW47XG4gIGlkOiBudW1iZXI7IHRlYW06IDAgfCAxOyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyO1xuICB4OiBudW1iZXI7IHo6IG51bWJlcjsgeWF3OiBudW1iZXI7XG4gIGhwOiBudW1iZXI7IG1heEhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBpbnRlcnZhbDogbnVtYmVyOyByYW5nZTogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyByYWRpdXM6IG51bWJlcjtcbiAgYWxpdmU6IGJvb2xlYW47IHN0YXRlOiBGU3RhdGU7XG4gIHRhcmdldDogbnVtYmVyOyByZXRhcmdldEF0OiBudW1iZXI7IGZvcmNlZFRhcmdldDogbnVtYmVyOyBmb3JjZWRVbnRpbDogbnVtYmVyO1xuICBuZXh0QXR0YWNrOiBudW1iZXI7IGF0dGFja1N0YXJ0OiBudW1iZXI7IGF0dGFja0R1cjogbnVtYmVyOyBhbmltU3BlZWQ6IG51bWJlcjsgaGl0RG9uZTogYm9vbGVhbjtcbiAgbWFuYTogbnVtYmVyOyBtYXhNYW5hOiBudW1iZXI7IGNhc3Rpbmc6IGJvb2xlYW47IGZyZW56eTogbnVtYmVyOyBkZWFkQXQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgQkV2ZW50ID1cbiAgfCB7IHQ6ICdzd2luZyc7IGlkOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdoaXQnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyOyBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ2Fycm93JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnZGVhdGgnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdjYXN0JzsgaWQ6IG51bWJlcjsgc2tpbGw6ICdzcGxpdCcgfCAndGF1bnQnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAndGF1bnQnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdzbWFzaCc7IGlkOiBudW1iZXI7IHg6IG51bWJlcjsgejogbnVtYmVyOyByOiBudW1iZXIgfVxuICB8IHsgdDogJ2ZyZW56eSc7IGlkOiBudW1iZXI7IHN0YWNrczogbnVtYmVyIH07XG5cbmV4cG9ydCBjbGFzcyBCYXR0bGUge1xuICB0aW1lID0gMDtcbiAgZmlnaHRlcnM6IEZpZ2h0ZXJbXSA9IFtdO1xuICBldmVudHM6IEJFdmVudFtdID0gW107XG4gIHdpbm5lcjogLTEgfCAwIHwgMSA9IC0xO1xuICBybmc6IFJuZztcbiAgcHJpdmF0ZSBwZW5kaW5nOiB7IGF0OiBudW1iZXI7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXIgfVtdID0gW107XG4gIHByaXZhdGUgbmV4dElkID0gMTtcbiAgcHJpdmF0ZSBlbmVteVBvd2VyID0gMTtcbiAgcHJpdmF0ZSBmbGlwID0gZmFsc2U7XG5cbiAgLyoqIGBsZXZlbHNgOiB0aGUgcGxheWVyJ3MgcGVybWFuZW50IFNvdWwgbGV2ZWxzIChoZWFsdGggYW5kIGRhbWFnZSBncm93IGEgbGl0dGxlIHBlciBsZXZlbCkuIEVuZW1pZXMgbmV2ZXIgdXNlIHRoZW0uICovXG4gIC8qKiBgZW5lbXlQb3dlcmA6IGhlYWx0aCBhbmQgZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBlbmVteSB0ZWFtIG9ubHkgKHN0YWdlIHN0cmVuZ3RoOyAxID0gYXMgd3JpdHRlbikuICovXG4gIGNvbnN0cnVjdG9yKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSwgbGV2ZWxzPzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiwgZW5lbXlQb3dlciA9IDEpIHtcbiAgICB0aGlzLnJuZyA9IG1ha2VSbmcoc2VlZCk7IHRoaXMuZW5lbXlQb3dlciA9IGVuZW15UG93ZXI7XG4gICAgZm9yIChjb25zdCBwIG9mIHBsYXllcnMpIHRoaXMuYWRkKDAsIHAuc291bCwgcC5zdGFyLCBwLmNlbGwsIGxldmVscz8uW3Auc291bF0gPz8gMSk7XG4gICAgY29uc3QgY2VsbHMgPSBlbmVteUNlbGxzKGVuZW1pZXMpO1xuICAgIGVuZW1pZXMuZm9yRWFjaCgoZSwgaSkgPT4gdGhpcy5hZGQoMSwgZS5zb3VsLCBlLnN0YXIsIGNlbGxzW2ldLCAxLCAhIWUuYm9zcykpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIsIGxldmVsID0gMSwgYm9zcyA9IGZhbHNlKTogRmlnaHRlciB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tzb3VsXSwgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCk7XG4gICAgY29uc3QgbHZIcCA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmhwLCBsdkRtZyA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmRtZztcbiAgICBjb25zdCBwdyA9IHRlYW0gPT09IDEgPyB0aGlzLmVuZW15UG93ZXIgOiAxO1xuICAgIGNvbnN0IGhwID0gc3QuaHAgKiBCLnN0YXIuaHBbc3RhciAtIDFdICogbHZIcCAqIHB3ICogKGJvc3MgPyAxICsgQk9TUy5ocCAqIGJvc3NTdHJlbmd0aCgpIDogMSk7XG4gICAgY29uc3QgZjogRmlnaHRlciA9IHtcbiAgICAgIGlkOiB0aGlzLm5leHRJZCsrLCB0ZWFtLCBzb3VsLCBzdGFyLCBjZWxsLCB4OiBwLngsIHo6IHAueiwgeWF3OiB0ZWFtID09PSAwID8gMCA6IE1hdGguUEksXG4gICAgICBocCwgbWF4SHA6IGhwLCBkbWc6IHN0LmRtZyAqIEIuc3Rhci5kbWdbc3RhciAtIDFdICogbHZEbWcgKiBwdyAqIChib3NzID8gMSArIEJPU1MuZG1nICogYm9zc1N0cmVuZ3RoKCkgOiAxKSwgaW50ZXJ2YWw6IHN0LmludGVydmFsLCByYW5nZTogc3QucmFuZ2UsIHNwZWVkOiBzdC5zcGVlZCwgcmFkaXVzOiBzdC5zaXplICogQi5zdGFyLnNjYWxlW3N0YXIgLSAxXSwgICAvLyAoYSBib3NzIG9ubHkgTE9PS1MgYmlnZ2VyOiBhIGxhcmdlciBjb2xsaXNpb24gcmFkaXVzIHdvdWxkIGtlZXAgbWVsZWUgdW5pdHMgb3V0IG9mIHJlYWNoKVxuICAgICAgYWxpdmU6IHRydWUsIHN0YXRlOiAnaWRsZScsIHRhcmdldDogLTEsIHJldGFyZ2V0QXQ6IDAsIGZvcmNlZFRhcmdldDogLTEsIGZvcmNlZFVudGlsOiAwLFxuICAgICAgbmV4dEF0dGFjazogdGhpcy5ybmcubmV4dCgpICogMC4zLCBhdHRhY2tTdGFydDogLTksIGF0dGFja0R1cjogMSwgYW5pbVNwZWVkOiAxLCBoaXRGcmFjOiAwLCBoaXREb25lOiB0cnVlLFxuICAgICAgbWFuYTogMCwgbWF4TWFuYTogQi5tYW5hW3NvdWxdPy5tYXggPz8gMCwgY2FzdGluZzogZmFsc2UsIGZyZW56eTogMCwgZGVhZEF0OiAwLCBib3NzLFxuICAgIH0gYXMgRmlnaHRlcjtcbiAgICB0aGlzLmZpZ2h0ZXJzLnB1c2goZik7IHJldHVybiBmO1xuICB9XG5cbiAgYnlJZChpZDogbnVtYmVyKTogRmlnaHRlciB8IHVuZGVmaW5lZCB7IHJldHVybiBpZCA8IDAgPyB1bmRlZmluZWQgOiB0aGlzLmZpZ2h0ZXJzW2lkIC0gMV07IH1cbiAgZm9lcyhmOiBGaWdodGVyKTogRmlnaHRlcltdIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8udGVhbSAhPT0gZi50ZWFtKTsgfVxuICBjb3VudCh0ZWFtOiAwIHwgMSk6IG51bWJlciB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLnJlZHVjZSgobiwgZikgPT4gbiArIChmLmFsaXZlICYmIGYudGVhbSA9PT0gdGVhbSA/IDEgOiAwKSwgMCk7IH1cbiAgZHJhaW4oKTogQkV2ZW50W10geyBjb25zdCBlID0gdGhpcy5ldmVudHM7IHRoaXMuZXZlbnRzID0gW107IHJldHVybiBlOyB9XG5cbiAgc3RlcChkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMud2lubmVyID49IDApIHJldHVybjtcbiAgICB0aGlzLnRpbWUgKz0gZHQ7IHRoaXMuZmxpcCA9ICF0aGlzLmZsaXA7XG4gICAgLy8gYXJyb3dzIHRoYXQgaGF2ZSBmaW5pc2hlZCBmbHlpbmdcbiAgICBmb3IgKGxldCBpID0gdGhpcy5wZW5kaW5nLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wZW5kaW5nW2ldO1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBwLmF0KSB7XG4gICAgICAgIHRoaXMucGVuZGluZy5zcGxpY2UoaSwgMSk7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5ieUlkKHAudG8pLCBmcm9tID0gdGhpcy5ieUlkKHAuZnJvbSk7XG4gICAgICAgIGlmICh0byAmJiB0by5hbGl2ZSAmJiBmcm9tKSB0aGlzLmRhbWFnZSh0bywgcC5kbWcsIGZyb20sICdhcnJvdycpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvcmRlciA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKHRoaXMuZmxpcCkgb3JkZXIucmV2ZXJzZSgpO1xuICAgIGZvciAoY29uc3QgZiBvZiBvcmRlcikgaWYgKGYuYWxpdmUpIHRoaXMudXBkYXRlKGYsIGR0KTtcbiAgICBjb25zdCBhID0gdGhpcy5jb3VudCgwKSwgYiA9IHRoaXMuY291bnQoMSk7XG4gICAgaWYgKCFhIHx8ICFiKSB0aGlzLndpbm5lciA9IGEgPyAwIDogMTtcbiAgICBlbHNlIGlmICh0aGlzLnRpbWUgPj0gQkFMQU5DRS5zaW0udGltZUxpbWl0KSB7XG4gICAgICBjb25zdCBocCA9ICh0OiAwIHwgMSkgPT4gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB0KS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCk7XG4gICAgICB0aGlzLndpbm5lciA9IGhwKDApID4gaHAoMSkgPyAwIDogMTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyLWZpZ2h0ZXIgdXBkYXRlXG4gIHByaXZhdGUgdXBkYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07XG4gICAgdGhpcy5zZXBhcmF0ZShmLCBkdCk7XG5cbiAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHtcbiAgICAgIGNvbnN0IHQgPSB0aGlzLnRpbWUgLSBmLmF0dGFja1N0YXJ0O1xuICAgICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAodGcgJiYgdGcuYWxpdmUpIHRoaXMuZmFjZShmLCB0Zy54IC0gZi54LCB0Zy56IC0gZi56LCBkdCk7XG4gICAgICBpZiAoIWYuaGl0RG9uZSAmJiB0ID49IGYuYXR0YWNrRHVyICogc3QuaGl0RnJhYykgeyBmLmhpdERvbmUgPSB0cnVlOyB0aGlzLnJlc29sdmVIaXQoZik7IH1cbiAgICAgIGlmICh0ID49IGYuYXR0YWNrRHVyKSBmLnN0YXRlID0gJ2lkbGUnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFjcXVpcmUoZik7XG4gICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmICghdGcgfHwgIXRnLmFsaXZlKSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IHJldHVybjsgfVxuICAgIGNvbnN0IGR4ID0gdGcueCAtIGYueCwgZHogPSB0Zy56IC0gZi56LCBkaXN0ID0gTWF0aC5oeXBvdChkeCwgZHopO1xuICAgIHRoaXMuZmFjZShmLCBkeCwgZHosIGR0KTtcbiAgICBpZiAoZGlzdCA8PSBmLnJhbmdlKSB7XG4gICAgICBpZiAodGhpcy50aW1lID49IGYubmV4dEF0dGFjaykgdGhpcy5zdGFydEF0dGFjayhmKTsgZWxzZSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IH1cbiAgICB9IGVsc2Uge1xuICAgICAgZi5zdGF0ZSA9ICdydW4nOyBsZXQgbXggPSBkeCAvIE1hdGgubWF4KGRpc3QsIDFlLTQpLCBteiA9IGR6IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCk7XG4gICAgICAvLyB3YWxrIEFST1VORCBhbnlvbmUgc3RhbmRpbmcgaW4gdGhlIHdheSAoYWxsaWVzIGFuZCBlbmVtaWVzIGFsaWtlLCBleGNlcHQgdGhlIHRhcmdldCk6IGVhY2ggYmxvY2tlciBhaGVhZCBiZW5kcyB0aGUgaGVhZGluZyBhd2F5IGZyb20gaXRcbiAgICAgIGxldCBzeCA9IDAsIHN6ID0gMDtcbiAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChvID09PSBmIHx8ICFvLmFsaXZlIHx8IG8uaWQgPT09IHRnLmlkKSBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgb3ggPSBvLnggLSBmLngsIG96ID0gby56IC0gZi56LCBhbG9uZyA9IG94ICogbXggKyBveiAqIG16LCByZWFjaCA9IGYucmFkaXVzICsgby5yYWRpdXMgKyAwLjM1O1xuICAgICAgICBpZiAoYWxvbmcgPD0gMCB8fCBhbG9uZyA+IHJlYWNoICsgMC45KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgbGF0ID0gb3ggKiAtbXogKyBveiAqIG14LCBuZWVkID0gZi5yYWRpdXMgKyBvLnJhZGl1cyArIDAuMTI7IGlmIChNYXRoLmFicyhsYXQpID49IG5lZWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBzaWRlID0gbGF0ID09PSAwID8gKGYuaWQgJSAyID8gMSA6IC0xKSA6IChsYXQgPiAwID8gLTEgOiAxKSwgdyA9ICgxIC0gTWF0aC5hYnMobGF0KSAvIG5lZWQpICogKDEgLSBNYXRoLm1heCgwLCBhbG9uZyAtIHJlYWNoKSAvIDAuOSk7XG4gICAgICAgIHN4ICs9IC1teiAqIHNpZGUgKiB3ICogMS42OyBzeiArPSBteCAqIHNpZGUgKiB3ICogMS42O1xuICAgICAgfVxuICAgICAgaWYgKHN4IHx8IHN6KSB7IG14ICs9IHN4OyBteiArPSBzejsgY29uc3QgbCA9IE1hdGguaHlwb3QobXgsIG16KSB8fCAxOyBteCAvPSBsOyBteiAvPSBsOyB9XG4gICAgICBmLnggKz0gbXggKiBmLnNwZWVkICogZHQ7IGYueiArPSBteiAqIGYuc3BlZWQgKiBkdDsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICAvKipcbiAgICogS2VlcCBmaWdodGVycyBmcm9tIHN0YWNraW5nIHdpdGhvdXQgc2hvdmluZyBhbnlvbmUgYWNyb3NzIHRoZSBtYXAuXG4gICAqIC0gQSBmaWdodGVyIHRoYXQgaXMgc3RhbmRpbmcgYW5kIGZpZ2h0aW5nIGlzIFwicGxhbnRlZFwiOiBpdCBiYXJlbHkgbW92ZXM7IHRoZSBvbmVzIHN0aWxsIFdBTEtJTkcgeWllbGQgdG8gaXQuXG4gICAqIC0gSGVhdmllciB1bml0cyAoT2dyZSwgS25pZ2h0KSBwdXNoIGxpZ2h0ZXIgb25lcyBtb3JlIHRoYW4gdGhlIG90aGVyIHdheSByb3VuZC5cbiAgICogLSBUaGUgdG90YWwgcHVzaCBvbiBvbmUgZmlnaHRlciBpcyBjYXBwZWQgcGVyIHNlY29uZCwgc28gYSBjcm93ZCBjYW4gbmV2ZXIgc2xpZGUgYSB1bml0IGZhci5cbiAgICovXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IHBsYW50ZWQgPSAodTogRmlnaHRlcikgPT4gdS5zdGF0ZSA9PT0gJ2F0dGFjaycgfHwgdS5zdGF0ZSA9PT0gJ2lkbGUnLCBtYXNzID0gKHU6IEZpZ2h0ZXIpID0+IHUucmFkaXVzICogdS5yYWRpdXM7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgbGV0IHNoYXJlID0gbWFzcyhvKSAvIChtYXNzKGYpICsgbWFzcyhvKSk7ICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgbGlnaHRlciBvbmUgb2YgdGhlIHBhaXIgbW92ZXMgbW9yZVxuICAgICAgY29uc3QgcGYgPSBwbGFudGVkKGYpLCBwbyA9IHBsYW50ZWQobyk7XG4gICAgICBpZiAocGYgJiYgIXBvKSBzaGFyZSAqPSAwLjEyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZiBpcyBzdGFuZGluZyBpdHMgZ3JvdW5kOiB0aGUgd2Fsa2VyIG8gZ29lcyBhcm91bmRcbiAgICAgIGVsc2UgaWYgKCFwZiAmJiBwbykgc2hhcmUgPSBNYXRoLm1pbigxLCBzaGFyZSAqIDEuNSArIDAuMzUpOyAgICAvLyBmIGlzIHdhbGtpbmcgaW50byBhIHBsYW50ZWQgdW5pdDogZiB5aWVsZHNcbiAgICAgIGVsc2UgaWYgKHBmICYmIHBvKSBzaGFyZSAqPSAwLjM1OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0d28gc3RhbmRpbmcgdW5pdHMgb3ZlcmxhcCBhIGxpdHRsZTogZWFzZSBhcGFydCB2ZXJ5IHNsb3dseVxuICAgICAgY29uc3QgayA9ICgod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMykpICogc2hhcmUgKiAyO1xuICAgICAgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBsZXQgbXggPSBweCAqIHMsIG16ID0gcHogKiBzO1xuICAgIGNvbnN0IGNhcCA9IChwbGFudGVkKGYpID8gMC41IDogMS42KSAqIGR0LCBsZW4gPSBNYXRoLmh5cG90KG14LCBteik7ICAgLy8gbWV0cmVzIHBlciBzZWNvbmQsIHN0YW5kaW5nIHZzIHdhbGtpbmdcbiAgICBpZiAobGVuID4gY2FwKSB7IG14ICo9IGNhcCAvIGxlbjsgbXogKj0gY2FwIC8gbGVuOyB9XG4gICAgZi54ICs9IG14OyBmLnogKz0gbXo7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicgJiYgY3VyICYmIGN1ci5hbGl2ZSAmJiBNYXRoLmh5cG90KGN1ci54IC0gZi54LCBjdXIueiAtIGYueikgPD0gZi5yYW5nZSAqIDEuMykgcmV0dXJuOyAgIC8vIGFscmVhZHkgaW4gcmVhY2ggb2Ygc29tZW9uZTogaGl0IHRoZW0sIGRvbid0IHdhbmRlciBvZmYgYWZ0ZXIgYSBqdWljaWVyIHRhcmdldFxuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJyAmJiBvLmlkID09PSBmLnRhcmdldCkgc2NvcmUgLT0gMS41OyAgIC8vIHN0aWNrIHdpdGggYSB0YXJnZXQgdW5sZXNzIGFub3RoZXIgaXMgY2xlYXJseSBiZXR0ZXJcbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzAsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQsIGxldmVscywgZW5lbXlQb3dlcik7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgImltcG9ydCB7IENVUlZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuLyoqXG4gKiBSdWxlcyBmb3IgdGhlIHBsYXlhYmxlIFN0YWdlIDEgKDEwIHdhdmVzKTogZG9jIERvbWluaW9uIGN1cnZlLCBib251cyBkcmF3IG9ubHkgb24gdGhlIGVhcmx5IHdhdmVzLlxuICogbWVyZ2UgJ2hhbmRJbnRvT25lU3Rhcic6IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gbWVyZ2Ugc3RyYWlnaHQgaW50byBhIG1hdGNoaW5nIGRlcGxveWVkIDEtc3RhciB1bml0IChwYXlpbmcgb25seSB0aGUgY29zdFxuICogZGlmZmVyZW5jZSkuIFdpdGhvdXQgaXQgdGhlIGNhcCBjYW4gYmxvY2sgYSBtZXJnZSB5b3UgY291bGQgYWZmb3JkICh5b3Ugd291bGQgbmVlZCByb29tIHRvIHN1bW1vbiBCT1RIIGNvcGllcyBmaXJzdCkuXG4gKiBUaGUgZGVidWcgcGFuZWwgY2FuIHN3aXRjaCB0aGlzIGJhY2sgdG8gdGhlIGRvYydzIGRlcGxveWVkLW9ubHkgcnVsZS5cbiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPVFlQRV9SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBDVVJWRVMuZG9jLCBtZXJnZTogJ2hhbmRJbnRvT25lU3RhcicsIHN0YWdlV2F2ZXM6IDEwLCBub3JtYWxEcmF3V2F2ZXM6IFsyLCAzLCA0LCA1XSB9O1xuXG4vKipcbiAqIEVuZGxlc3MgRGVwdGhzOiB0aGUgY2FtcGFpZ24ncyBEb21pbmlvbiBjdXJ2ZSBmb3Igd2F2ZXMgMS0xMCwgdGhlbiBoZWxkIGF0IDQwICh0aGUgcGxheWVyJ3MgYXJteSBpcyBjYXBwZWQgb24gcHVycG9zZTsgdGhlIGVuZW15IGtlZXBzIGdyb3dpbmcsIHNlZSBlbmRsZXNzLnRzKS5cbiAqIFRoZSBjdXJ2ZSBpcyBsb25nIGVub3VnaCB0aGF0IGEgcnVuIGVuZHMgYnkgbG9zaW5nIGhlYXJ0cywgbmV2ZXIgYnkgXCJjbGVhcmluZ1wiIHRoZSBzdGFnZSAoY29yZS9ydWxlcy50cyByZWFkcyBjdXJ2ZVt3YXZlLTFdKS5cbiAqL1xuY29uc3QgRU5ETEVTU19MRU4gPSAzMDA7XG5leHBvcnQgY29uc3QgRU5ETEVTU19SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBBcnJheS5mcm9tKHsgbGVuZ3RoOiBFTkRMRVNTX0xFTiB9LCAoXywgaSkgPT4gQ1VSVkVTLmRvY1tNYXRoLm1pbihpLCBDVVJWRVMuZG9jLmxlbmd0aCAtIDEpXSksIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogRU5ETEVTU19MRU4sIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG4iLCAiLy8gVGhlIERhaWx5IENoYWxsZW5nZTogU3RhZ2UgMSAoTm9ybWFsKSB3aXRoIE9ORSB0d2lzdCB0aGF0IGNoYW5nZXMgZXZlcnkgZGF5LiBFdmVyeW9uZSBnZXRzIHRoZSBzYW1lIHR3aXN0IGFuZCB0aGUgc2FtZSBzZWVkIG9uIHRoZSBzYW1lIGRheVxuLy8gKGJvdGggY29tZSBmcm9tIHRoZSBjYWxlbmRhciBkYXRlLCBzbyBubyBzZXJ2ZXIgaXMgbmVlZGVkKS4gUmV0cnkgYXMgb2Z0ZW4gYXMgeW91IGxpa2U7IHRoZSByZXdhcmQgKGEgcGFjayBhbmQgc29tZSBnb2xkKSBpcyBwYWlkIG9uY2UgcGVyIGRheS5cblxuaW1wb3J0IHsgQ09TVCwgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUFJPVE9UWVBFX1JVTEVTIH0gZnJvbSAnLi9wcm90b3R5cGUudHMnO1xuaW1wb3J0IHR5cGUgeyBFbmVteVNwZWMgfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB7IHdhdmVDb3N0IH0gZnJvbSAnLi93YXZlcy50cyc7XG5cbmV4cG9ydCBjb25zdCBEQUlMWV9JRCA9ICdkYWlseSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGFpbHlNb2Qge1xuICBpZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZztcbiAgcG93ZXI6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAvLyBoaWRkZW4gZW5lbXkgaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyIGZvciB0aGUgZGF5XG4gIGNhcERlbHRhOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgLy8gY2hhbmdlIHRvIHRoZSBwbGF5ZXIncyBEb21pbmlvbiBldmVyeSB3YXZlIChuZXZlciBiZWxvdyBEQUlMWV9NSU5fQ0FQKVxuICBlbmVteT86ICh3OiBFbmVteVNwZWNbXSwgd2F2ZTogbnVtYmVyKSA9PiBFbmVteVNwZWNbXTsgICAvLyByZXdyaXRlcyBlYWNoIGVuZW15IHdhdmVcbn1cbmV4cG9ydCBjb25zdCBEQUlMWV9NSU5fQ0FQID0gNDtcbmNvbnN0IE1BWF9VTklUUyA9IDEyO1xuXG4vKiogQSBjcm93ZCBvZiBXYXJyaW9ycyBhbmQgR29ibGlucyB0aGF0IGNvc3RzIGFib3V0IGBidWRnZXRgIERvbWluaW9uLiAqL1xuZnVuY3Rpb24gY3Jvd2QoYnVkZ2V0OiBudW1iZXIpOiBFbmVteVNwZWNbXSB7XG4gIGNvbnN0IG91dDogRW5lbXlTcGVjW10gPSBbXTsgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGkgPSAwOyBvdXQubGVuZ3RoIDwgTUFYX1VOSVRTOyBpKyspIHtcbiAgICBjb25zdCBzb3VsID0gaSAlIDMgPT09IDIgPyAnZ29ibGluJyA6ICd3YXJyaW9yJzsgaWYgKENPU1Rbc291bF1bMF0gPiBsZWZ0KSBicmVhaztcbiAgICBvdXQucHVzaCh7IHNvdWwsIHN0YXI6IDEgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVswXTtcbiAgfVxuICByZXR1cm4gb3V0Lmxlbmd0aCA/IG91dCA6IFt7IHNvdWw6ICd3YXJyaW9yJywgc3RhcjogMSB9XTtcbn1cblxuZXhwb3J0IGNvbnN0IE1PRElGSUVSUzogRGFpbHlNb2RbXSA9IFtcbiAgeyBpZDogJ2VtcG93ZXJlZCcsIG5hbWU6ICdFbXBvd2VyZWQnLCB0ZXh0OiAnRW5lbWllcyBhcmUgMjUlIHN0cm9uZ2VyLicsIHBvd2VyOiAxLjI1LCBjYXBEZWx0YTogMCB9LFxuICB7IGlkOiAnbWVsZWUnLCBuYW1lOiAnTm8gQXJjaGVycycsIHRleHQ6ICdFbmVteSBBcmNoZXJzIGFyZSByZXBsYWNlZCBieSBXYXJyaW9ycywgYnV0IGV2ZXJ5b25lIGhpdHMgaGFyZGVyLicsIHBvd2VyOiAxLjE1LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IHcubWFwKChlKSA9PiAoZS5zb3VsID09PSAnYXJjaGVyJyA/IHsgc291bDogJ3dhcnJpb3InIGFzIGNvbnN0LCBzdGFyOiBlLnN0YXIgfSA6IGUpKSB9LFxuICB7IGlkOiAnc3dhcm0nLCBuYW1lOiAnU3dhcm0nLCB0ZXh0OiAnV2F2ZXMgYXJlIGNyb3dkcyBvZiBXYXJyaW9ycyBhbmQgR29ibGlucy4nLCBwb3dlcjogMC44NSwgY2FwRGVsdGE6IDAsXG4gICAgZW5lbXk6ICh3KSA9PiBjcm93ZChNYXRoLnJvdW5kKHdhdmVDb3N0KHcpICogMS4xNSkpIH0sXG4gIHsgaWQ6ICdjcmFtcGVkJywgbmFtZTogJ0NyYW1wZWQnLCB0ZXh0OiAnWW91ciBEb21pbmlvbiBpcyA0IGxvd2VyIGV2ZXJ5IHdhdmUuJywgcG93ZXI6IDEsIGNhcERlbHRhOiAtNCB9LFxuICB7IGlkOiAndmV0ZXJhbnMnLCBuYW1lOiAnVmV0ZXJhbnMnLCB0ZXh0OiAnRW5lbXkgT2dyZXMgYW5kIEtuaWdodHMgYXJlIGEgc3RhciBoaWdoZXIuJywgcG93ZXI6IDAuOSwgY2FwRGVsdGE6IDAsXG4gICAgZW5lbXk6ICh3KSA9PiB3Lm1hcCgoZSkgPT4gKGUuc291bCA9PT0gJ29ncmUnIHx8IGUuc291bCA9PT0gJ2tuaWdodCcgPyB7IHNvdWw6IGUuc291bCwgc3RhcjogTWF0aC5taW4oMywgZS5zdGFyICsgMSkgfSA6IGUpKSB9LFxuXTtcblxuLyoqIFdob2xlIGRheXMgc2luY2UgMSBKYW51YXJ5IDE5NzAgaW4gdGhlIHBsYXllcidzIG93biBjYWxlbmRhciAodGhlIGRheSBjaGFuZ2VzIGF0IHRoZWlyIG1pZG5pZ2h0KS4gKi9cbmV4cG9ydCBjb25zdCBkYXlOdW1iZXIgPSAoZDogRGF0ZSA9IG5ldyBEYXRlKCkpOiBudW1iZXIgPT4gTWF0aC5mbG9vcihEYXRlLlVUQyhkLmdldEZ1bGxZZWFyKCksIGQuZ2V0TW9udGgoKSwgZC5nZXREYXRlKCkpIC8gODY0MDAwMDApO1xuZXhwb3J0IGNvbnN0IGlzVmFsaWREYXkgPSAobjogbnVtYmVyKTogYm9vbGVhbiA9PiBOdW1iZXIuaXNJbnRlZ2VyKG4pICYmIG4gPiAwICYmIG4gPCAxZTY7XG5leHBvcnQgY29uc3QgbW9kaWZpZXJGb3IgPSAoZGF5OiBudW1iZXIpOiBEYWlseU1vZCA9PiBNT0RJRklFUlNbKChkYXkgJSBNT0RJRklFUlMubGVuZ3RoKSArIE1PRElGSUVSUy5sZW5ndGgpICUgTU9ESUZJRVJTLmxlbmd0aF07XG4vKiogVGhlIHBsYXllcidzIHJ1bGVzIGZvciB0aGUgZGF5OiB0aGUgY2FtcGFpZ24ncyBEb21pbmlvbiBjdXJ2ZSwgc2hpZnRlZCBieSB0aGUgbW9kaWZpZXIuICovXG5leHBvcnQgZnVuY3Rpb24gZGFpbHlSdWxlcyhtb2Q6IERhaWx5TW9kLCBwb29sOiBSdWxlc1sncG9vbCddKTogUnVsZXMge1xuICByZXR1cm4geyAuLi5QUk9UT1RZUEVfUlVMRVMsIGN1cnZlOiBDVVJWRVMuZG9jLm1hcCgoYykgPT4gTWF0aC5tYXgoREFJTFlfTUlOX0NBUCwgYyArIG1vZC5jYXBEZWx0YSkpLCBwb29sIH07XG59XG4iLCAiLy8gU291bCBQYWNrcyAocGxhbiBkb2Mgc2VjdGlvbiAxNykuIFB1cmUgcnVsZXMsIG5vIGdyYXBoaWNzLiBBTEwgTlVNQkVSUyBBUkUgUExBQ0VIT0xERVIgTEVWRVJTOiB3ZSBzZXR0bGVkIHRoZSBzdHJ1Y3R1cmUgZmlyc3QgYW5kIHdpbGwgdHVuZVxuLy8gcXVhbnRpdGllcyB3aXRoIHRoZSBwcm9ncmVzc2lvbiBzaW11bGF0aW9uIChzaW0vcHJvZ3Jlc3Npb24udHMpIG9uY2UgdGhlIGxvb3AgY2FuIGJlIHBsYXllZC5cbi8vXG4vLyAgIFNvdWwgcmFyaXR5ICAtPiBob3cgb2Z0ZW4gYSBTb3VsIHNob3dzIHVwIGFuZCBob3cgYmlnIGl0cyBzdGFjayBvZiBjb3BpZXMgdGVuZHMgdG8gYmUuXG4vLyAgIFBhY2sgdGllciAgICAtPiB0aGUgcGFjaydzIG92ZXJhbGwgdmFsdWUgKHNrdWxscywgMS0zIGZvciBub3cpOiBudW1iZXIgb2YgcmV2ZWFscyArIGhvdyBnb29kIHRoZSByYXJpdHkgb2RkcyBhcmUuXG4vLyAgIEEgcGFjayBoYXMgYSBTVEFSVElORyB0aWVyIGFuZCBtYXkgdXBncmFkZSB3aGlsZSBpdCBpcyBiZWluZyBvcGVuZWQ7IHRoZSByZXN1bHQgaXMgZGVjaWRlZCB1cCBmcm9udCwgdGhlIGFuaW1hdGlvbiBvbmx5IHNob3dzIGl0LlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IHR5cGUgUmFyaXR5ID0gJ2NvbW1vbicgfCAncmFyZScgfCAnZXBpYycgfCAnbGVnZW5kYXJ5JztcbmV4cG9ydCBjb25zdCBSQVJJVElFUzogUmFyaXR5W10gPSBbJ2NvbW1vbicsICdyYXJlJywgJ2VwaWMnLCAnbGVnZW5kYXJ5J107XG5leHBvcnQgY29uc3QgUkFSSVRZX05BTUU6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJ0NvbW1vbicsIHJhcmU6ICdSYXJlJywgZXBpYzogJ0VwaWMnLCBsZWdlbmRhcnk6ICdMZWdlbmRhcnknIH07XG5cbi8qKiBSYXJpdHkgcGVyIFNvdWwuIFBMQUNFSE9MREVSIGFzc2lnbm1lbnQgKG5vIExlZ2VuZGFyeSBTb3VsIGV4aXN0cyB5ZXQpLiAqL1xuZXhwb3J0IGNvbnN0IFJBUklUWV9PRjogUmVjb3JkPFNvdWxJZCwgUmFyaXR5PiA9IHsgd2FycmlvcjogJ2NvbW1vbicsIGdvYmxpbjogJ2NvbW1vbicsIGFyY2hlcjogJ3JhcmUnLCBrbmlnaHQ6ICdyYXJlJywgb2dyZTogJ2VwaWMnLCBiYXJiYXJpYW46ICdlcGljJyB9O1xuXG4vKiogUmFyZXIgU291bHMgdHVybiB1cCBpbiBzbWFsbGVyIHN0YWNrcywgc28gdGhleSBuZWVkIGZld2VyIGNvcGllcyBwZXIgbGV2ZWwgKG11bHRpcGxpZXIgb24gdGhlIGxldmVsIGNvc3RzKS4gUExBQ0VIT0xERVIuICovXG5leHBvcnQgY29uc3QgTEVWRUxfQ09TVF9NVUxUOiBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+ID0geyBjb21tb246IDEsIHJhcmU6IDAuNiwgZXBpYzogMC4zNSwgbGVnZW5kYXJ5OiAwLjIgfTtcblxuZXhwb3J0IGNvbnN0IFBBQ0tfVElFUlMgPSAzO1xuZXhwb3J0IGNvbnN0IFBBQ0sgPSB7XG4gIHJldmVhbHM6IFszLCA0LCA1XSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNlcGFyYXRlIHJldmVhbHMgcGVyIHRpZXIgKGluZGV4IDAgPSB0aWVyIDEpXG4gIHN0YWNrTXVsdDogWzEsIDEuNSwgMl0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvcHkgc3RhY2tzIGFyZSBiaWdnZXIgaW4gYmV0dGVyIHBhY2tzXG4gIC8qKiBSYXJpdHkgb2RkcyBwZXIgdGllciwgaW4gcGVyY2VudC4gKi9cbiAgb2RkczogW1xuICAgIHsgY29tbW9uOiA3MCwgcmFyZTogMjUsIGVwaWM6IDUsIGxlZ2VuZGFyeTogMCB9LFxuICAgIHsgY29tbW9uOiA1NSwgcmFyZTogMzMsIGVwaWM6IDExLCBsZWdlbmRhcnk6IDEgfSxcbiAgICB7IGNvbW1vbjogNDAsIHJhcmU6IDM4LCBlcGljOiAxOSwgbGVnZW5kYXJ5OiAzIH0sXG4gIF0gYXMgUmVjb3JkPFJhcml0eSwgbnVtYmVyPltdLFxuICAvKiogQ29waWVzIGluIG9uZSByZXZlYWwgYmVmb3JlIHRoZSB0aWVyIG11bHRpcGxpZXI6IFttaW4sIG1heF0uICovXG4gIHN0YWNrOiB7IGNvbW1vbjogWzYsIDEwXSwgcmFyZTogWzMsIDVdLCBlcGljOiBbMSwgM10sIGxlZ2VuZGFyeTogWzEsIDFdIH0gYXMgUmVjb3JkPFJhcml0eSwgW251bWJlciwgbnVtYmVyXT4sXG4gIC8qKiBDaGFuY2UgdG8ganVtcCB1cCBvbmUgdGllciBkdXJpbmcgdGhlIG9wZW5pbmcsIGZyb20gdGllciAxIGFuZCBmcm9tIHRpZXIgMiAoYSBsdWNreSBwYWNrIGNhbiBqdW1wIHR3aWNlKS4gKi9cbiAgdXBncmFkZUNoYW5jZTogWzAuMiwgMC4xMl0sXG59O1xuXG4vKiogQW4gdW5vcGVuZWQgcGFjayB0aGUgcGxheWVyIG93bnMuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhY2tJdGVtIHsgaWQ6IG51bWJlcjsgdGllcjogbnVtYmVyOyBzb3VyY2U6IHN0cmluZyB9XG5leHBvcnQgaW50ZXJmYWNlIFJldmVhbCB7IHNvdWw6IFNvdWxJZDsgcmFyaXR5OiBSYXJpdHk7IGNvcGllczogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgUGFja1Jlc3VsdCB7IHN0YXJ0VGllcjogbnVtYmVyOyBmaW5hbFRpZXI6IG51bWJlcjsgdXBncmFkZXM6IG51bWJlcltdOyByZXZlYWxzOiBSZXZlYWxbXSB9XG5cbmNvbnN0IHJhcml0eVJhbmsgPSAocjogUmFyaXR5KSA9PiBSQVJJVElFUy5pbmRleE9mKHIpO1xuXG5mdW5jdGlvbiByb2xsUmFyaXR5KHRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBSYXJpdHkge1xuICBjb25zdCBvZGRzID0gUEFDSy5vZGRzW3RpZXIgLSAxXTsgbGV0IHJvbGwgPSBybmcubmV4dCgpICogUkFSSVRJRVMucmVkdWNlKChuLCByKSA9PiBuICsgb2Rkc1tyXSwgMCk7XG4gIGZvciAoY29uc3QgciBvZiBSQVJJVElFUykgeyBpZiAocm9sbCA8IG9kZHNbcl0pIHJldHVybiByOyByb2xsIC09IG9kZHNbcl07IH1cbiAgcmV0dXJuICdjb21tb24nO1xufVxuXG4vKiogQSByYW5kb20gU291bCBvZiB0aGlzIHJhcml0eTsgaWYgdGhlIHJvc3RlciBoYXMgbm9uZSBvZiB0aGF0IHJhcml0eSB5ZXQsIHRoZSBuZXh0IGxvd2VyIG9uZSBpcyB1c2VkLiAqL1xuZnVuY3Rpb24gc291bE9mUmFyaXR5KHJhcml0eTogUmFyaXR5LCBybmc6IFJuZyk6IFNvdWxJZCB7XG4gIGZvciAobGV0IGkgPSByYXJpdHlSYW5rKHJhcml0eSk7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHBvb2wgPSBTT1VMUy5maWx0ZXIoKHMpID0+IFJBUklUWV9PRltzXSA9PT0gUkFSSVRJRVNbaV0pOyBpZiAocG9vbC5sZW5ndGgpIHJldHVybiBybmcucGljayhwb29sKTsgfVxuICByZXR1cm4gcm5nLnBpY2soU09VTFMpO1xufVxuXG4vKiogT3BlbiBhIHBhY2s6IHJvbGwgdXBncmFkZXMgZmlyc3QgKHNvIHRoZSBhbmltYXRpb24gY2FuIHBsYXkgdGhlbSBiZWZvcmUgdGhlIHBhY2sgdGVhcnMgb3BlbiksIHRoZW4gdGhlIHJldmVhbHMuIEJlc3QgcmV2ZWFsIGNvbWVzIGxhc3QuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblBhY2soc3RhcnRUaWVyOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB7XG4gIGNvbnN0IHQwID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcihzdGFydFRpZXIpKSksIHVwZ3JhZGVzOiBudW1iZXJbXSA9IFtdO1xuICBsZXQgdGllciA9IHQwO1xuICB3aGlsZSAodGllciA8IFBBQ0tfVElFUlMgJiYgcm5nLm5leHQoKSA8IFBBQ0sudXBncmFkZUNoYW5jZVt0aWVyIC0gMV0pIHsgdGllcisrOyB1cGdyYWRlcy5wdXNoKHRpZXIpOyB9XG4gIGNvbnN0IHJldmVhbHM6IFJldmVhbFtdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgUEFDSy5yZXZlYWxzW3RpZXIgLSAxXTsgaSsrKSB7XG4gICAgY29uc3QgcmFyaXR5ID0gcm9sbFJhcml0eSh0aWVyLCBybmcpLCBzb3VsID0gc291bE9mUmFyaXR5KHJhcml0eSwgcm5nKSwgW2xvLCBoaV0gPSBQQUNLLnN0YWNrW1JBUklUWV9PRltzb3VsXV07XG4gICAgcmV2ZWFscy5wdXNoKHsgc291bCwgcmFyaXR5OiBSQVJJVFlfT0Zbc291bF0sIGNvcGllczogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgobG8gKyBybmcuaW50KGhpIC0gbG8gKyAxKSkgKiBQQUNLLnN0YWNrTXVsdFt0aWVyIC0gMV0pKSB9KTtcbiAgfVxuICByZXZlYWxzLnNvcnQoKGEsIGIpID0+IHJhcml0eVJhbmsoYS5yYXJpdHkpIC0gcmFyaXR5UmFuayhiLnJhcml0eSkgfHwgYS5jb3BpZXMgLSBiLmNvcGllcyk7XG4gIHJldHVybiB7IHN0YXJ0VGllcjogdDAsIGZpbmFsVGllcjogdGllciwgdXBncmFkZXMsIHJldmVhbHMgfTtcbn1cblxuLyoqIFRvdGFsIGNvcGllcyBwZXIgU291bCBpbiBhIHJlc3VsdCAodGhlIHNhbWUgU291bCBjYW4gYmUgcmV2ZWFsZWQgbW9yZSB0aGFuIG9uY2UpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvcGllc0J5U291bChyZXN1bHQ6IFBhY2tSZXN1bHQpOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+IHtcbiAgY29uc3Qgb3V0OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+ID0ge307XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgb3V0W3Iuc291bF0gPSAob3V0W3Iuc291bF0gPz8gMCkgKyByLmNvcGllcztcbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3Mgc2F2ZWQgcHJvZ3Jlc3MuIEZyYW1ld29yay1mcmVlIHNvIHRoZSBnYW1lIGJ1bmRsZSBhbmQgdGhlIG5hdmlnYXRpb24gc2hlbGwgYm90aCB1c2UgaXQuXG4vLyBTdG9yZWQgaW4gbG9jYWxTdG9yYWdlIGFzIEpTT04uIEV2ZXJ5IHJlYWQvd3JpdGUgaXMgZ3VhcmRlZDogcHJpdmF0ZSB3aW5kb3dzIGFuZCBibG9ja2VkIHN0b3JhZ2UgbXVzdCBuZXZlciBicmVhayB0aGUgZ2FtZS5cblxuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUEFDS19USUVSUyB9IGZyb20gJy4vcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBQYWNrSXRlbSB9IGZyb20gJy4vcGFja3MudHMnO1xuXG5leHBvcnQgY29uc3QgREVDS19TSVpFID0gNjsgICAgICAgICAgICAgICAgICAgICAvLyBkb2M6IHNpeCBlcXVpcHBlZCBTb3VscyBwZXIgc3RhZ2VcbmNvbnN0IEtFWSA9ICduZWNyby1zYXZlJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgdHlwZSBEaWZmaWN1bHR5ID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGSUNVTFRJRVM6IERpZmZpY3VsdHlbXSA9IFsnZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXTtcbmV4cG9ydCBpbnRlcmZhY2UgU2V0dGluZ3MgeyBtdXNpYzogYm9vbGVhbjsgc2Z4OiBib29sZWFuIH1cbmV4cG9ydCBpbnRlcmZhY2UgU291bFByb2dyZXNzIHsgbGV2ZWw6IG51bWJlcjsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTYXZlIHtcbiAgdjogbnVtYmVyO1xuICBkZWNrOiBTb3VsSWRbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXF1aXBwZWQgU291bHMsIGF0IG1vc3QgREVDS19TSVpFLCBhdCBsZWFzdCAxXG4gIHNvdWxzOiBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+OyAgICAgICAgICAvLyBQTEFDRUhPTERFUiBwcm9ncmVzc2lvbiB1bnRpbCBwYWNrcyBleGlzdFxuICBzZXR0aW5nczogU2V0dGluZ3M7ICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc291bmQgc3dpdGNoZXM7IGJvdGggb24gYnkgZGVmYXVsdFxuICBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5OyAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hvc2VuIG9uIEhvbWU7IGFwcGxpZXMgdG8gdGhlIG5leHQgcnVuXG4gIHN0YWdlOiBzdHJpbmc7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgc3RhZ2UgcGlja2VkIG9uIEhvbWUgKGlkIGZyb20gd2F2ZXMudHMgU1RBR0VTKVxuICBzZWVuOiBzdHJpbmdbXSB8IG51bGw7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5sb2NrIGtleXMgd2hvc2UgY2VsZWJyYXRpb24gd2FzIGFscmVhZHkgc2hvd24gKG51bGw6IG9sZGVyIHNhdmUsIHNlZWRlZCBvbiBmaXJzdCBsb29rKVxuICBwYWNrczogUGFja0l0ZW1bXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5vcGVuZWQgU291bCBQYWNrc1xuICBuZXh0UGFja0lkOiBudW1iZXI7XG4gIGNsZWFyczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjsgICAgICAgICAgICAgICAvLyBzdGFnZSBjbGVhcnMsIGtleWVkICdzdGFnZTpkaWZmaWN1bHR5J1xuICByZXBsYXlNZXRlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwbGF5IGNsZWFycyB0b3dhcmQgdGhlIG5leHQgcmVwbGF5IHBhY2tcbiAgZW5kbGVzczogeyBiZXN0OiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgIC8vIEVuZGxlc3MgRGVwdGhzOiB0aGUgZGVlcGVzdCB3YXZlIGNsZWFyZWRcbiAgZ29sZFNjYWxlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIDIgPSBnb2xkIGluIHRoZSBjdXJyZW50ICh4MTAwKSB1bml0czsgYSBzYXZlIHdpdGhvdXQgaXQgaG9sZHMgZ29sZCBpbiB0aGUgb2xkIHNtYWxsIHVuaXRzIGFuZCBpcyBjb252ZXJ0ZWQgb24gbG9hZFxuICBnb2xkOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc3BlbnQgb24gU291bCBsZXZlbC11cHMgKGFsb25nc2lkZSBjb3BpZXMpOyBlYXJuZWQgcGVyIHdhdmUgY2xlYXJlZCBhbmQgZnJvbSBvcGVuaW5nIHBhY2tzXG4gIGRhaWx5U3RyZWFrOiB7IGNvdW50OiBudW1iZXI7IGxhc3Q6IG51bWJlciB9OyAvLyBjb25zZWN1dGl2ZSBkYXlzIHdpdGggYSBEYWlseSB3aW4sIGFuZCB0aGUgbGFzdCBkYXkgd29uXG4gIGRhaWx5V2luczogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBEYWlseSBDaGFsbGVuZ2VzIHdvbiAob25lIHBlciBkYXkgY291bnRzKVxuICBjbGFpbWVkOiBzdHJpbmdbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbWlsZXN0b25lcyB3aG9zZSByZXdhcmQgd2FzIHRha2VuXG4gIGRhaWx5OiB7IGRheTogbnVtYmVyOyB3b246IGJvb2xlYW4gfSB8IG51bGw7ICAvLyB0aGUgbGFzdCBEYWlseSBDaGFsbGVuZ2UgZGF5IHBsYXllZCBhbmQgd2hldGhlciBpdHMgb25lLXRpbWUgcmV3YXJkIHdhcyB0YWtlblxufVxuLyoqIEdvbGQgZ2l2ZW4gb25jZSB0byBhIHNhdmUgdGhhdCBwcmVkYXRlcyBnb2xkIGFuZCBoYXMgcHJvZ3Jlc3MuICovXG5leHBvcnQgY29uc3QgQ0FUQ0hfVVBfR09MRCA9IDQwMDAwO1xuZXhwb3J0IGludGVyZmFjZSBTdG9yZSB7IGdldEl0ZW0oazogc3RyaW5nKTogc3RyaW5nIHwgbnVsbDsgc2V0SXRlbShrOiBzdHJpbmcsIHY6IHN0cmluZyk6IHZvaWQgfVxuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFNhdmUoKTogU2F2ZSB7XG4gIGNvbnN0IHNvdWxzID0ge30gYXMgUmVjb3JkPFNvdWxJZCwgU291bFByb2dyZXNzPjtcbiAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykgc291bHNbaWRdID0geyBsZXZlbDogMSwgY29waWVzOiAwIH07XG4gIHJldHVybiB7IHY6IFZFUlNJT04sIGRlY2s6IFNPVUxTLnNsaWNlKDAsIERFQ0tfU0laRSksIHNvdWxzLCBzZXR0aW5nczogeyBtdXNpYzogdHJ1ZSwgc2Z4OiB0cnVlIH0sIGRpZmZpY3VsdHk6ICdub3JtYWwnLCBzdGFnZTogJ2NyeXB0Jywgc2VlbjogW10sIHBhY2tzOiBbXSwgbmV4dFBhY2tJZDogMSwgY2xlYXJzOiB7fSwgcmVwbGF5TWV0ZXI6IDAsIGVuZGxlc3M6IHsgYmVzdDogMCB9LCBnb2xkU2NhbGU6IDIsIGdvbGQ6IDAsIGRhaWx5OiBudWxsLCBkYWlseVN0cmVhazogeyBjb3VudDogMCwgbGFzdDogMCB9LCBkYWlseVdpbnM6IDAsIGNsYWltZWQ6IFtdIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicm93c2VyU3RvcmUoKTogU3RvcmUgfCBudWxsIHsgdHJ5IHsgcmV0dXJuIHR5cGVvZiBsb2NhbFN0b3JhZ2UgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGxvY2FsU3RvcmFnZTsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9IH1cblxuLyoqIFJlcGFpciB3aGF0ZXZlciB3YXMgc3RvcmVkOiB1bmtub3duIFNvdWxzIGRyb3BwZWQsIGR1cGxpY2F0ZXMgcmVtb3ZlZCwgZGVjayBjYXBwZWQsIG5vdGhpbmcgZW1wdHkuIE9sZCB2ZXJzaW9ucyBrZWVwIHRoZWlyIHByb2dyZXNzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplKHJhdzogYW55KTogU2F2ZSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0U2F2ZSgpO1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IGRlY2s6IFNvdWxJZFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5kZWNrKSkgZm9yIChjb25zdCBkIG9mIHJhdy5kZWNrKSBpZiAoU09VTFMuaW5jbHVkZXMoZCkgJiYgIWRlY2suaW5jbHVkZXMoZCkgJiYgZGVjay5sZW5ndGggPCBERUNLX1NJWkUpIGRlY2sucHVzaChkKTtcbiAgaWYgKGRlY2subGVuZ3RoKSBiYXNlLmRlY2sgPSBkZWNrO1xuICBpZiAocmF3LnNvdWxzICYmIHR5cGVvZiByYXcuc291bHMgPT09ICdvYmplY3QnKSB7XG4gICAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykge1xuICAgICAgY29uc3QgcCA9IHJhdy5zb3Vsc1tpZF07XG4gICAgICBpZiAocCAmJiBOdW1iZXIuaXNGaW5pdGUocC5sZXZlbCkgJiYgTnVtYmVyLmlzRmluaXRlKHAuY29waWVzKSkgYmFzZS5zb3Vsc1tpZF0gPSB7IGxldmVsOiBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHAubGV2ZWwpKSwgY29waWVzOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHAuY29waWVzKSkgfTtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5zZXR0aW5ncyAmJiB0eXBlb2YgcmF3LnNldHRpbmdzID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLm11c2ljID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3MubXVzaWMgPSByYXcuc2V0dGluZ3MubXVzaWM7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3Muc2Z4ID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3Muc2Z4ID0gcmF3LnNldHRpbmdzLnNmeDtcbiAgfVxuICBpZiAoRElGRklDVUxUSUVTLmluY2x1ZGVzKHJhdy5kaWZmaWN1bHR5KSkgYmFzZS5kaWZmaWN1bHR5ID0gcmF3LmRpZmZpY3VsdHk7XG4gIGlmICh0eXBlb2YgcmF3LnN0YWdlID09PSAnc3RyaW5nJyAmJiAvXlthLXowLTlfLV17MSwyNH0kLy50ZXN0KHJhdy5zdGFnZSkpIGJhc2Uuc3RhZ2UgPSByYXcuc3RhZ2U7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5zZWVuKSkgYmFzZS5zZWVuID0gcmF3LnNlZW4uZmlsdGVyKChrOiBhbnkpID0+IHR5cGVvZiBrID09PSAnc3RyaW5nJyAmJiBrLmxlbmd0aCA8IDQwKS5zbGljZSgtODApO1xuICBlbHNlIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyhyYXcuY2xlYXJzKS5sZW5ndGgpIGJhc2Uuc2VlbiA9IG51bGw7ICAgIC8vIGFuIGV4aXN0aW5nIHBsYXllcjogZG8gbm90IHJlcGxheSBvbGQgdW5sb2Nrc1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcucGFja3MpKSB7XG4gICAgY29uc3QgaWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHJhdy5wYWNrcykge1xuICAgICAgaWYgKGJhc2UucGFja3MubGVuZ3RoID49IDk5IHx8ICFwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHAuaWQpIHx8IHAuaWQgPCAxIHx8IGlkcy5oYXMocC5pZCkgfHwgIU51bWJlci5pc0ludGVnZXIocC50aWVyKSB8fCBwLnRpZXIgPCAxIHx8IHAudGllciA+IFBBQ0tfVElFUlMpIGNvbnRpbnVlO1xuICAgICAgaWRzLmFkZChwLmlkKTsgYmFzZS5wYWNrcy5wdXNoKHsgaWQ6IHAuaWQsIHRpZXI6IHAudGllciwgc291cmNlOiB0eXBlb2YgcC5zb3VyY2UgPT09ICdzdHJpbmcnID8gcC5zb3VyY2Uuc2xpY2UoMCwgNDApIDogJycgfSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IG1heElkID0gYmFzZS5wYWNrcy5yZWR1Y2UoKG4sIHApID0+IE1hdGgubWF4KG4sIHAuaWQpLCAwKTtcbiAgYmFzZS5uZXh0UGFja0lkID0gTWF0aC5tYXgobWF4SWQgKyAxLCBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5uZXh0UGFja0lkKSAmJiByYXcubmV4dFBhY2tJZCA+IDAgPyByYXcubmV4dFBhY2tJZCA6IDEpO1xuICBpZiAocmF3LmNsZWFycyAmJiB0eXBlb2YgcmF3LmNsZWFycyA9PT0gJ29iamVjdCcpIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHJhdy5jbGVhcnMpKSBpZiAodHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDAgJiYgTnVtYmVyLmlzSW50ZWdlcih2KSAmJiAodiBhcyBudW1iZXIpID4gMCkgYmFzZS5jbGVhcnNba10gPSB2IGFzIG51bWJlcjtcbiAgaWYgKE51bWJlci5pc0ludGVnZXIocmF3LnJlcGxheU1ldGVyKSAmJiByYXcucmVwbGF5TWV0ZXIgPj0gMCAmJiByYXcucmVwbGF5TWV0ZXIgPCA1MCkgYmFzZS5yZXBsYXlNZXRlciA9IHJhdy5yZXBsYXlNZXRlcjtcbiAgaWYgKHJhdy5lbmRsZXNzICYmIE51bWJlci5pc0ludGVnZXIocmF3LmVuZGxlc3MuYmVzdCkgJiYgcmF3LmVuZGxlc3MuYmVzdCA+PSAwICYmIHJhdy5lbmRsZXNzLmJlc3QgPD0gOTk5OSkgYmFzZS5lbmRsZXNzLmJlc3QgPSByYXcuZW5kbGVzcy5iZXN0O1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcuZ29sZCkgJiYgcmF3LmdvbGQgPj0gMCAmJiByYXcuZ29sZCA8PSAxZTkpIGJhc2UuZ29sZCA9IHJhdy5nb2xkU2NhbGUgPT09IDIgPyByYXcuZ29sZCA6IE1hdGgubWluKDFlOSwgcmF3LmdvbGQgKiAxMDApOyAgIC8vIGVhcmx5IHNhdmVzIGNvdW50ZWQgZ29sZCBpbiB1bml0cyAxMDAgdGltZXMgc21hbGxlclxuICBlbHNlIGlmIChyYXcuZ29sZCA9PT0gdW5kZWZpbmVkICYmIE9iamVjdC5rZXlzKGJhc2UuY2xlYXJzKS5sZW5ndGgpIGJhc2UuZ29sZCA9IENBVENIX1VQX0dPTEQ7ICAgICAgICAvLyBhIHBsYXllciBmcm9tIGJlZm9yZSBnb2xkIGV4aXN0ZWQ6IG9uZS10aW1lIGdyYW50IHNvIHRoZSBuZXcgY29zdCBkb2VzIG5vdCBsb2NrIHRoZWlyIHN0b2NrcGlsZWQgY29waWVzXG4gIGlmIChyYXcuZGFpbHlTdHJlYWsgJiYgTnVtYmVyLmlzSW50ZWdlcihyYXcuZGFpbHlTdHJlYWsuY291bnQpICYmIHJhdy5kYWlseVN0cmVhay5jb3VudCA+PSAwICYmIHJhdy5kYWlseVN0cmVhay5jb3VudCA8IDFlNSAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5kYWlseVN0cmVhay5sYXN0KSAmJiByYXcuZGFpbHlTdHJlYWsubGFzdCA+PSAwICYmIHJhdy5kYWlseVN0cmVhay5sYXN0IDwgMWU2KSBiYXNlLmRhaWx5U3RyZWFrID0geyBjb3VudDogcmF3LmRhaWx5U3RyZWFrLmNvdW50LCBsYXN0OiByYXcuZGFpbHlTdHJlYWsubGFzdCB9O1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcuZGFpbHlXaW5zKSAmJiByYXcuZGFpbHlXaW5zID49IDAgJiYgcmF3LmRhaWx5V2lucyA8IDFlNSkgYmFzZS5kYWlseVdpbnMgPSByYXcuZGFpbHlXaW5zO1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcuY2xhaW1lZCkpIGJhc2UuY2xhaW1lZCA9IFsuLi5uZXcgU2V0PHN0cmluZz4ocmF3LmNsYWltZWQuZmlsdGVyKChrOiBhbnkpID0+IHR5cGVvZiBrID09PSAnc3RyaW5nJyAmJiBrLmxlbmd0aCA8IDQwKSldLnNsaWNlKDAsIDgwKTtcbiAgaWYgKHJhdy5kYWlseSAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5kYWlseS5kYXkpICYmIHJhdy5kYWlseS5kYXkgPiAwICYmIHJhdy5kYWlseS5kYXkgPCAxZTYpIGJhc2UuZGFpbHkgPSB7IGRheTogcmF3LmRhaWx5LmRheSwgd29uOiAhIXJhdy5kYWlseS53b24gfTtcbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cblxuLyoqIENoYW5nZSBzb3VuZCBzZXR0aW5ncyB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzKHBhdGNoOiBQYXJ0aWFsPFNldHRpbmdzPiwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2V0dGluZ3Mge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLnNldHRpbmdzID0geyAuLi5zLnNldHRpbmdzLCAuLi5wYXRjaCB9OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5zZXR0aW5ncztcbn1cblxuLyoqIFJlbWVtYmVyIHRoZSBjaG9zZW4gZGlmZmljdWx0eSB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZURpZmZpY3VsdHkoZDogRGlmZmljdWx0eSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogRGlmZmljdWx0eSB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuZGlmZmljdWx0eSA9IERJRkZJQ1VMVElFUy5pbmNsdWRlcyhkKSA/IGQgOiBzLmRpZmZpY3VsdHk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLmRpZmZpY3VsdHk7XG59XG4iLCAiLy8gUGVybWFuZW50IHByb2dyZXNzaW9uOiBzdGFnZSBjbGVhcnMgLT4gU291bCBQYWNrcyAtPiBjb3BpZXMgLT4gU291bCBsZXZlbHMuIFB1cmUgZnVuY3Rpb25zIHRoYXQgY2hhbmdlIGEgU2F2ZSAodGhlIGNhbGxlciBwZXJzaXN0cyBpdCkuXG4vLyBQbGFjZWhvbGRlciBudW1iZXJzLCBsaWtlIHBhY2tzLnRzLiBJbi1ydW4gc3RhciBtZXJnaW5nIGlzIGEgc2VwYXJhdGUsIHRlbXBvcmFyeSBzeXN0ZW0gYW5kIG5ldmVyIHRvdWNoZXMgYW55IG9mIHRoaXMuXG5cbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19QQUNLX0VWRVJZLCBlbmRsZXNzUGFja1RpZXIgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgTEVWRUxfQ09TVF9NVUxULCBQQUNLX1RJRVJTLCBSQVJJVFlfT0YsIG9wZW5QYWNrIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtLCBQYWNrUmVzdWx0IH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlLCB3cml0ZVNhdmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHsgU1RBR0VTLCBzdGFnZUJ5SWQsIHN0YWdlSW5kZXggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB0eXBlIHsgRGlmZmljdWx0eSwgU2F2ZSwgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5leHBvcnQgY29uc3QgTUFYX1BBQ0tTID0gOTk7XG5cbi8qKiBXaGVyZSBwYWNrcyBjb21lIGZyb20uIFBMQUNFSE9MREVSLiBGaXJzdCBjbGVhciBvZiBhIHN0YWdlIG9uIGVhY2ggZGlmZmljdWx0eSBnaXZlcyBvbmUgaW1wcm92ZWQgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgYSBtZXRlci4gKi9cbmV4cG9ydCBjb25zdCBSRVdBUkRTID0ge1xuICBmaXJzdENsZWFyVGllcjogeyBlYXN5OiAxLCBub3JtYWw6IDIsIGhhcmQ6IDIsIG5pZ2h0bWFyZTogMyB9IGFzIFJlY29yZDxEaWZmaWN1bHR5LCBudW1iZXI+LFxuICByZXBsYXlUaWVyOiB7IGVhc3k6IDEsIG5vcm1hbDogMSwgaGFyZDogMiwgbmlnaHRtYXJlOiAyIH0gYXMgUmVjb3JkPERpZmZpY3VsdHksIG51bWJlcj4sICAgLy8gZXZlcnkgY2xlYXIgcGF5cyBhIHBhY2s7IGhhcmRlciB0aWVycyBwYXkgYmV0dGVyXG4gIHJlcGxheUNsZWFyc1BlclBhY2s6IDEsXG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbGV2ZWxzXG5leHBvcnQgY29uc3QgbWF4TGV2ZWwgPSAoKTogbnVtYmVyID0+IEJBTEFOQ0UubGV2ZWwuY29waWVzVG9MZXZlbC5sZW5ndGggKyAxO1xuZXhwb3J0IGNvbnN0IGlzTWF4TGV2ZWwgPSAobGV2ZWw6IG51bWJlcik6IGJvb2xlYW4gPT4gbGV2ZWwgPj0gbWF4TGV2ZWwoKTtcbi8qKiBDb3BpZXMgbmVlZGVkIHRvIHRha2UgYHNvdWxgIGZyb20gYGxldmVsYCB0byB0aGUgbmV4dCBvbmUgKDAgd2hlbiBhbHJlYWR5IG1heCkuIFJhcmVyIFNvdWxzIG5lZWQgZmV3ZXIuICovXG5leHBvcnQgY29uc3QgY29waWVzTmVlZGVkID0gKGxldmVsOiBudW1iZXIsIHNvdWw6IFNvdWxJZCk6IG51bWJlciA9PiAoaXNNYXhMZXZlbChsZXZlbCkgPyAwIDogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZChCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWxbbGV2ZWwgLSAxXSAqIExFVkVMX0NPU1RfTVVMVFtSQVJJVFlfT0Zbc291bF1dKSkpO1xuLyoqXG4gKiBPbmUgcmVxdWlyZW1lbnQgb2YgYW4gdXBncmFkZS4gVG9kYXkgb25seSBjb3BpZXM7IHRoZSBjb25maXJtIHBvcHVwIGxpc3RzIGV2ZXJ5IGVudHJ5IHdpdGggaGF2ZSAvIG5lZWQsIGFuZCBDb25maXJtIGlzIGFsbG93ZWQgb25seSB3aGVuIGFsbCBhcmUgbWV0LlxuICogR29sZCB3aWxsIHNpbXBseSBiZWNvbWUgYSBzZWNvbmQgZW50cnkgaGVyZSAoeyBpZDogJ2dvbGQnLCAuLi4gfSkgYW5kIGJlIHNwZW50IGluIGxldmVsVXAoKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBVcGdyYWRlQ29zdCB7IGlkOiAnY29waWVzJyB8ICdnb2xkJzsgbGFiZWw6IHN0cmluZzsgaGF2ZTogbnVtYmVyOyBuZWVkOiBudW1iZXI7IG9rOiBib29sZWFuIH1cbi8qKiBHb2xkIHRvIHRha2UgYSBTb3VsIGZyb20gYGxldmVsYCB0byB0aGUgbmV4dCBvbmUgKDAgYXQgbWF4KS4gKi9cbmV4cG9ydCBjb25zdCBnb2xkTmVlZGVkID0gKGxldmVsOiBudW1iZXIpOiBudW1iZXIgPT4gKGlzTWF4TGV2ZWwobGV2ZWwpID8gMCA6IEJBTEFOQ0UubGV2ZWwuZ29sZFRvTGV2ZWxbbGV2ZWwgLSAxXSk7XG5leHBvcnQgZnVuY3Rpb24gdXBncmFkZUNvc3RzKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IFVwZ3JhZGVDb3N0W10ge1xuICBjb25zdCBwID0gc2F2ZS5zb3Vsc1tzb3VsXTsgaWYgKGlzTWF4TGV2ZWwocC5sZXZlbCkpIHJldHVybiBbXTtcbiAgY29uc3QgbmVlZCA9IGNvcGllc05lZWRlZChwLmxldmVsLCBzb3VsKTtcbiAgY29uc3QgZ29sZCA9IGdvbGROZWVkZWQocC5sZXZlbCk7XG4gIHJldHVybiBbeyBpZDogJ2NvcGllcycsIGxhYmVsOiAnQ29waWVzJywgaGF2ZTogcC5jb3BpZXMsIG5lZWQsIG9rOiBwLmNvcGllcyA+PSBuZWVkIH0sIHsgaWQ6ICdnb2xkJywgbGFiZWw6ICdHb2xkJywgaGF2ZTogc2F2ZS5nb2xkLCBuZWVkOiBnb2xkLCBvazogc2F2ZS5nb2xkID49IGdvbGQgfV07XG59XG5leHBvcnQgY29uc3QgY2FuQWZmb3JkID0gKGNvc3RzOiBVcGdyYWRlQ29zdFtdKTogYm9vbGVhbiA9PiBjb3N0cy5sZW5ndGggPiAwICYmIGNvc3RzLmV2ZXJ5KChjKSA9PiBjLm9rKTtcbmV4cG9ydCBjb25zdCBjYW5MZXZlbFVwID0gKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4gPT4gY2FuQWZmb3JkKHVwZ3JhZGVDb3N0cyhzYXZlLCBzb3VsKSk7XG4vKiogUGF5IGV2ZXJ5IGNvc3QgYW5kIGdhaW4gYSBsZXZlbC4gUmV0dXJucyBmYWxzZSAoYW5kIGNoYW5nZXMgbm90aGluZykgaWYgdGhlIFNvdWwgaXMgbm90IHJlYWR5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxldmVsVXAoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogYm9vbGVhbiB7XG4gIGNvbnN0IGNvc3RzID0gdXBncmFkZUNvc3RzKHNhdmUsIHNvdWwpOyBpZiAoIWNhbkFmZm9yZChjb3N0cykpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IGZvciAoY29uc3QgYyBvZiBjb3N0cykgeyBpZiAoYy5pZCA9PT0gJ2NvcGllcycpIHAuY29waWVzIC09IGMubmVlZDsgZWxzZSBzYXZlLmdvbGQgLT0gYy5uZWVkOyB9XG4gIHAubGV2ZWwrKzsgcmV0dXJuIHRydWU7XG59XG4vKiogRGVidWdnaW5nOiBwdXQgZXZlcnkgU291bCBiYWNrIHRvIGxldmVsIDEgKGNvcGllcyBhcmUga2VwdCkuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRMZXZlbHMoc2F2ZTogU2F2ZSk6IHZvaWQgeyBmb3IgKGNvbnN0IGsgb2YgU09VTFMpIHNhdmUuc291bHNba10ubGV2ZWwgPSAxOyB9XG4vKiogRGVidWdnaW5nOiBmb3JnZXQgYWxsIGNvbGxlY3RlZCBjb3BpZXMgKGxldmVscyBhcmUga2VwdCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJDb3BpZXMoc2F2ZTogU2F2ZSk6IHZvaWQgeyBmb3IgKGNvbnN0IGsgb2YgU09VTFMpIHNhdmUuc291bHNba10uY29waWVzID0gMDsgfVxuLyoqIE11bHRpcGxpZXIgYXBwbGllZCB0byBhIFNvdWwncyBoZWFsdGgvZGFtYWdlIGZyb20gaXRzIHBlcm1hbmVudCBsZXZlbCAobGV2ZWwgMSA9IDEuMCkuICovXG5leHBvcnQgY29uc3QgbGV2ZWxNdWx0ID0gKGxldmVsOiBudW1iZXIsIHN0YXQ6ICdocCcgfCAnZG1nJyk6IG51bWJlciA9PiAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQkFMQU5DRS5sZXZlbFtzdGF0XTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGdvbGRcbmV4cG9ydCBjb25zdCBHT0xEID0geyB0aWVyTXVsdDogeyBlYXN5OiAwLjYsIG5vcm1hbDogMSwgaGFyZDogMS40LCBuaWdodG1hcmU6IDIgfSBhcyBSZWNvcmQ8RGlmZmljdWx0eSwgbnVtYmVyPiwgcGFja1BlclRpZXI6IDE1MDAsIGRhaWx5V2luOiA1MDAwIH07XG4vKiogR29sZCBmb3IgY2xlYXJpbmcgb25lIGNhbXBhaWduIHdhdmU6IG1vcmUgaW4gbGF0ZXIgc3RhZ2VzIGFuZCBvbiBoYXJkZXIgdGllcnMuICovXG5leHBvcnQgY29uc3Qgd2F2ZUdvbGQgPSAoc3RhZ2U6IHN0cmluZywgdGllcjogRGlmZmljdWx0eSB8IHN0cmluZyk6IG51bWJlciA9PiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKDEwMCAqICg2ICsgMiAqIHN0YWdlSW5kZXgoc3RhZ2UpKSAqIChHT0xELnRpZXJNdWx0W3RpZXIgYXMgRGlmZmljdWx0eV0gPz8gMSkpKTtcbi8qKiBHb2xkIGZvciBjbGVhcmluZyBvbmUgRW5kbGVzcyB3YXZlLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NXYXZlR29sZCA9ICh3YXZlOiBudW1iZXIpOiBudW1iZXIgPT4gMTAwICogKDggKyBNYXRoLmZsb29yKDAuNiAqIE1hdGgubWF4KDEsIHdhdmUpKSk7XG4vKiogR29sZCBmb3Igb3BlbmluZyBhIHBhY2sgdGhhdCBmaW5pc2hlZCBhdCBgdGllcmAuICovXG5leHBvcnQgY29uc3QgcGFja0dvbGQgPSAodGllcjogbnVtYmVyKTogbnVtYmVyID0+IEdPTEQucGFja1BlclRpZXIgKiBNYXRoLm1heCgxLCB0aWVyKTtcbmV4cG9ydCBmdW5jdGlvbiBhZGRHb2xkKHNhdmU6IFNhdmUsIG46IG51bWJlcik6IG51bWJlciB7IGNvbnN0IGcgPSBNYXRoLm1heCgwLCBNYXRoLmZsb29yKG4pKTsgc2F2ZS5nb2xkID0gTWF0aC5taW4oMWU5LCBzYXZlLmdvbGQgKyBnKTsgcmV0dXJuIGc7IH1cbmV4cG9ydCBmdW5jdGlvbiBhZGRHb2xkQW5kU2F2ZShuOiBudW1iZXIsIHN0b3JlPzogU3RvcmUgfCBudWxsKTogbnVtYmVyIHsgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgZyA9IGFkZEdvbGQocywgbik7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBnOyB9XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwYWNrc1xuZXhwb3J0IGZ1bmN0aW9uIGdyYW50UGFjayhzYXZlOiBTYXZlLCB0aWVyOiBudW1iZXIsIHNvdXJjZTogc3RyaW5nKTogUGFja0l0ZW0gfCBudWxsIHtcbiAgaWYgKHNhdmUucGFja3MubGVuZ3RoID49IE1BWF9QQUNLUykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhY2s6IFBhY2tJdGVtID0geyBpZDogc2F2ZS5uZXh0UGFja0lkKyssIHRpZXI6IE1hdGgubWF4KDEsIE1hdGgubWluKFBBQ0tfVElFUlMsIE1hdGguZmxvb3IodGllcikpKSwgc291cmNlIH07XG4gIHNhdmUucGFja3MucHVzaChwYWNrKTsgcmV0dXJuIHBhY2s7XG59XG5cbi8qKiBPcGVuIGFuIG93bmVkIHBhY2s6IGl0IGlzIHJlbW92ZWQgYW5kIGl0cyBjb3BpZXMgYXJlIGFkZGVkIHRvIHRoZSBTb3VscyBpbW1lZGlhdGVseSAoc28gbm90aGluZyBpcyBsb3N0IGlmIHRoZSBwYWdlIGNsb3NlcyBtaWQtYW5pbWF0aW9uKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuT3duZWRQYWNrKHNhdmU6IFNhdmUsIHBhY2tJZDogbnVtYmVyLCBybmc6IFJuZyk6IFBhY2tSZXN1bHQgfCBudWxsIHtcbiAgY29uc3QgaSA9IHNhdmUucGFja3MuZmluZEluZGV4KChwKSA9PiBwLmlkID09PSBwYWNrSWQpOyBpZiAoaSA8IDApIHJldHVybiBudWxsO1xuICBjb25zdCBwYWNrID0gc2F2ZS5wYWNrc1tpXTsgc2F2ZS5wYWNrcy5zcGxpY2UoaSwgMSk7XG4gIGNvbnN0IHJlc3VsdCA9IG9wZW5QYWNrKHBhY2sudGllciwgcm5nKTtcbiAgZm9yIChjb25zdCByIG9mIHJlc3VsdC5yZXZlYWxzKSBzYXZlLnNvdWxzW3Iuc291bF0uY29waWVzICs9IHIuY29waWVzO1xuICBhZGRHb2xkKHNhdmUsIHBhY2tHb2xkKHJlc3VsdC5maW5hbFRpZXIpKTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDbGVhclJld2FyZCB7IGZpcnN0OiBib29sZWFuOyBwYWNrOiBQYWNrSXRlbSB8IG51bGw7IHJlcGxheU1ldGVyOiBudW1iZXI7IHJlcGxheU5lZWRlZDogbnVtYmVyOyB1bmxvY2tlZDogc3RyaW5nW10gfVxuLyoqIEEgc3RhZ2Ugd2FzIGNsZWFyZWQgb24gYGRpZmZpY3VsdHlgLiBUaGUgZmlyc3QgY2xlYXIgb24gdGhhdCBkaWZmaWN1bHR5IGdyYW50cyBhIGJldHRlciBwYWNrOyBsYXRlciBjbGVhcnMgZmlsbCB0aGUgcmVwbGF5IG1ldGVyLiAqL1xuZnVuY3Rpb24gcmVjb3JkQ2xlYXJCYXNlKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IE9taXQ8Q2xlYXJSZXdhcmQsICd1bmxvY2tlZCc+IHtcbiAgY29uc3Qga2V5ID0gc3RhZ2VJZCArICc6JyArIGRpZmZpY3VsdHksIGJlZm9yZSA9IHNhdmUuY2xlYXJzW2tleV0gPz8gMDtcbiAgc2F2ZS5jbGVhcnNba2V5XSA9IGJlZm9yZSArIDE7XG4gIGlmIChiZWZvcmUgPT09IDApIHJldHVybiB7IGZpcnN0OiB0cnVlLCBwYWNrOiBncmFudFBhY2soc2F2ZSwgUkVXQVJEUy5maXJzdENsZWFyVGllcltkaWZmaWN1bHR5XSArIChzdGFnZUluZGV4KHN0YWdlSWQpID09PSBTVEFHRVMubGVuZ3RoIC0gMSA/IDEgOiAwKSwgJ0ZpcnN0IGNsZWFyIFx1MDBCNyAnICsgZGlmZmljdWx0eSksIHJlcGxheU1ldGVyOiBzYXZlLnJlcGxheU1ldGVyLCByZXBsYXlOZWVkZWQ6IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjayB9O1xuICBzYXZlLnJlcGxheU1ldGVyKys7XG4gIGxldCBwYWNrOiBQYWNrSXRlbSB8IG51bGwgPSBudWxsO1xuICBpZiAoc2F2ZS5yZXBsYXlNZXRlciA+PSBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2spIHsgc2F2ZS5yZXBsYXlNZXRlciAtPSBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2s7IHBhY2sgPSBncmFudFBhY2soc2F2ZSwgUkVXQVJEUy5yZXBsYXlUaWVyW2RpZmZpY3VsdHldLCAnUmVwbGF5IHJld2FyZCcpOyB9XG4gIHJldHVybiB7IGZpcnN0OiBmYWxzZSwgcGFjaywgcmVwbGF5TWV0ZXI6IHNhdmUucmVwbGF5TWV0ZXIsIHJlcGxheU5lZWRlZDogUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwZXJzaXN0ZWQgd3JhcHBlcnMgKHVzZWQgYnkgdGhlIGdhbWUgYnVuZGxlKVxuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyQW5kU2F2ZShzdGFnZUlkOiBzdHJpbmcsIGRpZmZpY3VsdHk6IERpZmZpY3VsdHksIHN0b3JlPzogU3RvcmUgfCBudWxsKTogQ2xlYXJSZXdhcmQge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBjb25zdCByID0gcmVjb3JkQ2xlYXIocywgc3RhZ2VJZCwgZGlmZmljdWx0eSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gRGFpbHkgQ2hhbGxlbmdlXG5leHBvcnQgaW50ZXJmYWNlIERhaWx5UmV3YXJkIHsgZmlyc3Q6IGJvb2xlYW47IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgZ29sZDogbnVtYmVyOyBzdHJlYWs6IG51bWJlciB9XG4vKiogVGhlIHN0cmVhayB0aGF0IGNvdW50cyB0b2RheTogc3RpbGwgYWxpdmUgaWYgdGhlIGxhc3Qgd2luIHdhcyB0b2RheSBvciB5ZXN0ZXJkYXksIG90aGVyd2lzZSAwLiAqL1xuZXhwb3J0IGNvbnN0IGRhaWx5U3RyZWFrTm93ID0gKHNhdmU6IFNhdmUsIGRheTogbnVtYmVyKTogbnVtYmVyID0+IChzYXZlLmRhaWx5U3RyZWFrLmxhc3QgPT09IGRheSB8fCBzYXZlLmRhaWx5U3RyZWFrLmxhc3QgPT09IGRheSAtIDEgPyBzYXZlLmRhaWx5U3RyZWFrLmNvdW50IDogMCk7XG4vKiogRGFpbHkgcGFjayB0aWVyIGJ5IHN0cmVhazogMSBhdCBmaXJzdCwgMiBmcm9tIHRocmVlIGRheXMgaW4gYSByb3csIDMgZnJvbSBzZXZlbi4gKi9cbmV4cG9ydCBjb25zdCBkYWlseVBhY2tUaWVyID0gKHN0cmVhazogbnVtYmVyKTogbnVtYmVyID0+IChzdHJlYWsgPj0gNyA/IDMgOiBzdHJlYWsgPj0gMyA/IDIgOiAxKTtcbi8qKiBUaGUgZGF5J3MgY2hhbGxlbmdlIHdhcyB3b24uIE9ubHkgdGhlIGZpcnN0IHdpbiBvZiBhIGdpdmVuIGRheSBwYXlzIChhIFRpZXIgMSBwYWNrIGFuZCBzb21lIGdvbGQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZERhaWx5V2luKHNhdmU6IFNhdmUsIGRheTogbnVtYmVyKTogRGFpbHlSZXdhcmQge1xuICBpZiAoc2F2ZS5kYWlseSAmJiBzYXZlLmRhaWx5LmRheSA9PT0gZGF5ICYmIHNhdmUuZGFpbHkud29uKSByZXR1cm4geyBmaXJzdDogZmFsc2UsIHBhY2s6IG51bGwsIGdvbGQ6IDAsIHN0cmVhazogZGFpbHlTdHJlYWtOb3coc2F2ZSwgZGF5KSB9O1xuICBjb25zdCBzdHJlYWsgPSBzYXZlLmRhaWx5U3RyZWFrLmxhc3QgPT09IGRheSAtIDEgPyBzYXZlLmRhaWx5U3RyZWFrLmNvdW50ICsgMSA6IDE7XG4gIHNhdmUuZGFpbHkgPSB7IGRheSwgd29uOiB0cnVlIH07IHNhdmUuZGFpbHlTdHJlYWsgPSB7IGNvdW50OiBzdHJlYWssIGxhc3Q6IGRheSB9OyBzYXZlLmRhaWx5V2lucysrO1xuICByZXR1cm4geyBmaXJzdDogdHJ1ZSwgcGFjazogZ3JhbnRQYWNrKHNhdmUsIGRhaWx5UGFja1RpZXIoc3RyZWFrKSwgJ0RhaWx5IGNoYWxsZW5nZScpLCBnb2xkOiBhZGRHb2xkKHNhdmUsIEdPTEQuZGFpbHlXaW4gKyAxMDAwICogKE1hdGgubWluKHN0cmVhaywgNykgLSAxKSksIHN0cmVhayB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZERhaWx5V2luQW5kU2F2ZShkYXk6IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBEYWlseVJld2FyZCB7IGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IHIgPSByZWNvcmREYWlseVdpbihzLCBkYXkpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjsgfVxuLyoqIEhhcyB0b2RheSdzIHJld2FyZCBhbHJlYWR5IGJlZW4gdGFrZW4/ICovXG5leHBvcnQgY29uc3QgZGFpbHlEb25lID0gKHNhdmU6IFNhdmUsIGRheTogbnVtYmVyKTogYm9vbGVhbiA9PiAhIXNhdmUuZGFpbHkgJiYgc2F2ZS5kYWlseS5kYXkgPT09IGRheSAmJiBzYXZlLmRhaWx5LndvbjtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEVuZGxlc3MgRGVwdGhzXG5leHBvcnQgaW50ZXJmYWNlIEVuZGxlc3NSZXdhcmQgeyB3YXZlOiBudW1iZXI7IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgbmV3QmVzdDogYm9vbGVhbiB9XG4vKiogV2F2ZSBgd2F2ZWAgb2YgYW4gZW5kbGVzcyBydW4gd2FzIGNsZWFyZWQ6IGEgcGFjayBvbiBldmVyeSAxMHRoIHdhdmUgKGJldHRlciB0aWVycyBkZWVwZXIpLCBhbmQgdGhlIGJlc3QgZGVwdGggaXMgcmVtZW1iZXJlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFbmRsZXNzV2F2ZShzYXZlOiBTYXZlLCB3YXZlOiBudW1iZXIpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgbmV3QmVzdCA9IHdhdmUgPiBzYXZlLmVuZGxlc3MuYmVzdDsgaWYgKG5ld0Jlc3QpIHNhdmUuZW5kbGVzcy5iZXN0ID0gd2F2ZTtcbiAgY29uc3QgcGFjayA9IHdhdmUgPiAwICYmIHdhdmUgJSBFTkRMRVNTX1BBQ0tfRVZFUlkgPT09IDAgPyBncmFudFBhY2soc2F2ZSwgZW5kbGVzc1BhY2tUaWVyKHdhdmUpLCAnRW5kbGVzcyBcdTAwQjcgd2F2ZSAnICsgd2F2ZSkgOiBudWxsO1xuICByZXR1cm4geyB3YXZlLCBwYWNrLCBuZXdCZXN0IH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlKHdhdmU6IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZEVuZGxlc3NXYXZlKHMsIHdhdmUpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cbi8qKiBFbmRsZXNzIERlcHRocyBvcGVucyBvbmNlIHRoZSBsYXN0IGNhbXBhaWduIHN0YWdlIGhhcyBiZWVuIGNsZWFyZWQgb24gTm9ybWFsLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NVbmxvY2tlZCA9IChzYXZlOiBTYXZlKTogYm9vbGVhbiA9PiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tTVEFHRVMubGVuZ3RoIC0gMV0uaWQsICdub3JtYWwnKSA+IDA7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB1bmxvY2sgcnVsZXNcbi8vIEVhc3kgYW5kIE5vcm1hbCBhcmUgb3BlbiBvbiBldmVyeSB1bmxvY2tlZCBzdGFnZS4gQ2xlYXJpbmcgTm9ybWFsIG9wZW5zIEhhcmQgb24gdGhhdCBzdGFnZSBBTkQgdW5sb2NrcyB0aGUgbmV4dCBzdGFnZS4gQ2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5leHBvcnQgY29uc3QgY2xlYXJDb3VudCA9IChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogbnVtYmVyID0+IHNhdmUuY2xlYXJzW3N0YWdlICsgJzonICsgZF0gPz8gMDtcbmV4cG9ydCBmdW5jdGlvbiBzdGFnZVVubG9ja2VkKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBib29sZWFuIHsgcmV0dXJuIGluZGV4IDw9IDAgfHwgKGluZGV4IDwgU1RBR0VTLmxlbmd0aCAmJiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tpbmRleCAtIDFdLmlkLCAnbm9ybWFsJykgPiAwKTsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogYm9vbGVhbiB7XG4gIGNvbnN0IGlkeCA9IFNUQUdFUy5maW5kSW5kZXgoKHMpID0+IHMuaWQgPT09IHN0YWdlKTsgaWYgKGlkeCA8IDAgfHwgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZCA9PT0gJ2Vhc3knIHx8IGQgPT09ICdub3JtYWwnKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIGQgPT09ICdoYXJkJyA/IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdub3JtYWwnKSA+IDAgOiBjbGVhckNvdW50KHNhdmUsIHN0YWdlLCAnaGFyZCcpID4gMDtcbn1cbi8qKiBXaHkgYSBzdGFnZSBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhZ2VMb2NrUmVhc29uKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBzdHJpbmcgeyByZXR1cm4gc3RhZ2VVbmxvY2tlZChzYXZlLCBpbmRleCkgPyAnJyA6ICdDbGVhciAnICsgU1RBR0VTW2luZGV4IC0gMV0ubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jay4nOyB9XG4vKiogV2h5IGEgdGllciBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgc3RhZ2U6IHN0cmluZywgZDogRGlmZmljdWx0eSk6IHN0cmluZyB7XG4gIGlmIChkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIGQpKSByZXR1cm4gJyc7XG4gIGNvbnN0IGlkeCA9IHN0YWdlSW5kZXgoc3RhZ2UpOyBpZiAoIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIHN0YWdlTG9ja1JlYXNvbihzYXZlLCBpZHgpO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIE5vcm1hbCB0byB1bmxvY2sgSGFyZC4nIDogJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIEhhcmQgdG8gdW5sb2NrIE5pZ2h0bWFyZS4nO1xufVxuLyoqIFdoYXRldmVyIHdhcyBzYXZlZCwgbWFrZSBpdCBhIHN0YWdlIGFuZCB0aWVyIHRoZSBwbGF5ZXIgbWF5IGFjdHVhbGx5IHBsYXkuICovXG5leHBvcnQgZnVuY3Rpb24gcGxheWFibGUoc2F2ZTogU2F2ZSk6IHsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogRGlmZmljdWx0eSB9IHtcbiAgbGV0IGlkeCA9IHN0YWdlSW5kZXgoc2F2ZS5zdGFnZSk7IHdoaWxlIChpZHggPiAwICYmICFzdGFnZVVubG9ja2VkKHNhdmUsIGlkeCkpIGlkeC0tO1xuICBjb25zdCBzdGFnZSA9IFNUQUdFU1tpZHhdLmlkO1xuICByZXR1cm4geyBzdGFnZSwgZGlmZmljdWx0eTogZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0YWdlLCBzYXZlLmRpZmZpY3VsdHkpID8gc2F2ZS5kaWZmaWN1bHR5IDogJ25vcm1hbCcgfTtcbn1cblxuLyoqIEV2ZXJ5IHVubG9jayB0aGUgcGxheWVyIG1heSBiZSBjZWxlYnJhdGVkIGZvcjogbGF0ZXIgc3RhZ2VzIGFuZCB0aGUgSGFyZCAvIE5pZ2h0bWFyZSB0aWVycyAoRWFzeSwgTm9ybWFsIGFuZCBTdGFnZSAxIGFyZSBvcGVuIGZyb20gdGhlIHN0YXJ0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmxvY2tlZEtleXMoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qga2V5czogc3RyaW5nW10gPSBbXTtcbiAgU1RBR0VTLmZvckVhY2goKHN0LCBpKSA9PiB7XG4gICAgaWYgKGkgPiAwICYmIHN0YWdlVW5sb2NrZWQoc2F2ZSwgaSkpIGtleXMucHVzaCgnc3RhZ2U6JyArIHN0LmlkKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgWydoYXJkJywgJ25pZ2h0bWFyZSddIGFzIERpZmZpY3VsdHlbXSkgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdC5pZCwgZCkpIGtleXMucHVzaCgndGllcjonICsgc3QuaWQgKyAnOicgKyBkKTtcbiAgfSk7XG4gIGlmIChlbmRsZXNzVW5sb2NrZWQoc2F2ZSkpIGtleXMucHVzaCgnZW5kbGVzcycpO1xuICByZXR1cm4ga2V5cztcbn1cbi8qKiBVbmxvY2tzIG5vdCB5ZXQgY2VsZWJyYXRlZC4gKi9cbmV4cG9ydCBjb25zdCBuZXdVbmxvY2tzID0gKHNhdmU6IFNhdmUpOiBzdHJpbmdbXSA9PiB1bmxvY2tlZEtleXMoc2F2ZSkuZmlsdGVyKChrKSA9PiAhKHNhdmUuc2VlbiA/PyBbXSkuaW5jbHVkZXMoaykpO1xuY29uc3QgVElFUl9OQU1FOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBoYXJkOiAnSGFyZCBtb2RlJywgbmlnaHRtYXJlOiAnTmlnaHRtYXJlIG1vZGUnIH07XG4vKiogV29yZHMgZm9yIGFuIHVubG9jayBrZXksIGZvciBiYW5uZXJzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlVW5sb2NrKGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGtleSA9PT0gJ2VuZGxlc3MnKSByZXR1cm4gJ0VuZGxlc3MgRGVwdGhzIChuZXcgbW9kZSknO1xuICBjb25zdCBba2luZCwgc3RhZ2UsIHRpZXJdID0ga2V5LnNwbGl0KCc6Jyk7XG4gIGlmIChraW5kID09PSAnc3RhZ2UnKSByZXR1cm4gc3RhZ2VCeUlkKHN0YWdlKS5uYW1lICsgJyAobmV3IHN0YWdlKSc7XG4gIHJldHVybiAoVElFUl9OQU1FW3RpZXJdID8/IHRpZXIpICsgJyBvbiAnICsgc3RhZ2VCeUlkKHN0YWdlKS5uYW1lO1xufVxuLyoqIENsZWFyaW5nIGEgc3RhZ2U6IHJld2FyZHMsIGFuZCB3aGljaCB1bmxvY2tzIHRoaXMgY2xlYXIgb3BlbmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgYmVmb3JlID0gdW5sb2NrZWRLZXlzKHNhdmUpLCByID0gcmVjb3JkQ2xlYXJCYXNlKHNhdmUsIHN0YWdlSWQsIGRpZmZpY3VsdHkpO1xuICByZXR1cm4geyAuLi5yLCB1bmxvY2tlZDogdW5sb2NrZWRLZXlzKHNhdmUpLmZpbHRlcigoaykgPT4gIWJlZm9yZS5pbmNsdWRlcyhrKSkgfTtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3MgY2hhcmFjdGVyOiB0aGUgTmVjcm9tYW5jZXIgKGEgcmlnZ2VkIFRyaXBvIG1vZGVsLCBQaXBlbGluZS91bml0cy9uZWNyb21hbmNlci5qc29uKS5cbi8vIEhlIHN0YW5kcyBiZXNpZGUgdGhlIGdyaWQsIHRha2VzIHRoZSBoaXQgd2hlbiBhbiBhcm15IGlzIHdpcGVkIChoZWFydHMgYXJlIEhJUyBoZWFsdGgpLCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUgYW5kIHJhaXNlc1xuLy8gdGhlIGZhbGxlbi4gRXZlcnl0aGluZyBoZXJlIGlzIGFuaW1hdGlvbiBvbmx5OyB0aGUgcnVsZXMgbGl2ZSBpbiBjb3JlL3J1bGVzLnRzLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5cbmV4cG9ydCBjbGFzcyBOZWNyb21hbmNlciB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbjsgbG9jYWwgK1ogaXMgaGlzIGZhY2luZyAodGhlIGdhbWUgcm90YXRlcyBoaW0gdG8gZmFjZSB0aGUgYmF0dGxlZmllbGQpXG4gIHByaXZhdGUgZW50OiBhbnk7IHByaXZhdGUgYW5pbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTsgcHJpdmF0ZSBjdXI6IGFueSA9IG51bGw7IHByaXZhdGUgaGFuZDogYW55ID0gbnVsbDsgcHJpdmF0ZSByaW5nOiBhbnk7IHByaXZhdGUgcHM6IGFueTtcbiAgcHJpdmF0ZSB0ID0gMDsgcHJpdmF0ZSBpZGxlVCA9IDA7IHByaXZhdGUgbmV4dFRhcCA9IDg7IHByaXZhdGUgYnVzeSA9IGZhbHNlOyBwcml2YXRlIGRvd25lZCA9IGZhbHNlOyBwcml2YXRlIHJlYWRvbmx5IFMgPSAxLjM1O1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgc2NlbmU6IGFueSwgcHJpdmF0ZSBzb2Z0OiBhbnksIGNvbnRhaW5lcjogYW55KSB7XG4gICAgY29uc3QgcyA9IHNjZW5lO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbmVjcm8nLCBzKTtcbiAgICB0aGlzLmVudCA9IGNvbnRhaW5lci5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfbmVjcm8nLCBmYWxzZSwgeyBkb05vdEluc3RhbnRpYXRlOiB0cnVlIH0pO1xuICAgIGNvbnN0IHJvb3QgPSB0aGlzLmVudC5yb290Tm9kZXNbMF07IHJvb3QucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuUyk7XG4gICAgcm9vdC5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmlzUGlja2FibGUgPSBmYWxzZTsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyB9KTtcbiAgICB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiB7IGcuc3RvcCgpOyBnLmVuYWJsZUJsZW5kaW5nID0gdHJ1ZTsgZy5ibGVuZGluZ1NwZWVkID0gMC4xMjsgdGhpcy5hbmltc1tnLm5hbWUuc3BsaXQoJ18nKVswXV0gPSBnOyB9KTtcbiAgICB0aGlzLmhhbmQgPSByb290LmdldENoaWxkVHJhbnNmb3JtTm9kZXMoZmFsc2UpLmZpbmQoKG46IGFueSkgPT4gbi5uYW1lLmluY2x1ZGVzKCdTb2NrZXRfV2VhcG9uJykpIHx8IG51bGw7XG4gICAgdGhpcy5wbGF5KCdJZGxlJywgdHJ1ZSk7XG4gICAgY29uc3QgcmluZyA9IHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygnYmFzZScsIHsgcmFkaXVzOiAwLjUsIHRlc3NlbGxhdGlvbjogMzAgfSwgcyk7IHJpbmcucGFyZW50ID0gdGhpcy5ob2xkZXI7IHJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyByaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyByaW5nLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBybSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ25yJywgcyk7IHJtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHJtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC40LCAwLjE1LCAwLjc1KTsgcm0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcm0uYWxwaGEgPSAwLjU1OyByaW5nLm1hdGVyaWFsID0gcm07XG4gICAgY29uc3QgcHMgPSB0aGlzLnBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ25lY3JvQXVyYScsIDgwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gc29mdDsgcHMuZW1pdHRlciA9IHRoaXMuaG9sZGVyO1xuICAgIHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjI1LCAwLCAtMC4yNSk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMjUsIDAuOCwgMC4yNSk7IHBzLm1pbkxpZmVUaW1lID0gMC42OyBwcy5tYXhMaWZlVGltZSA9IDEuMztcbiAgICBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xNSwgMC45LCAtMC4xNSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMTUsIDEuNiwgMC4xNSk7IHBzLm1pbkVtaXRQb3dlciA9IDAuMzsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApO1xuICAgIHBzLm1pblNpemUgPSAwLjA3OyBwcy5tYXhTaXplID0gMC4yOyBwcy5lbWl0UmF0ZSA9IDMwOyBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC44LCAwLjM1LCAxLCAwLjcpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC40NSwgMC4xNSwgMC45LCAwLjUpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4yLCAwLCAwLjQsIDApO1xuICAgIHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMuc3RhcnQoKTtcbiAgfVxuXG4gIHByaXZhdGUgcGxheShuYW1lOiBzdHJpbmcsIGxvb3AgPSBmYWxzZSwgaG9sZCA9IGZhbHNlKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbbmFtZV07IGlmICghZykgcmV0dXJuO1xuICAgIGlmICh0aGlzLmN1ciAmJiB0aGlzLmN1ciAhPT0gZykgdGhpcy5jdXIuc3RvcCgpO1xuICAgIGcuc3RvcCgpOyBnLnN0YXJ0KGxvb3AsIDEsIGcuZnJvbSwgZy50byk7IHRoaXMuY3VyID0gZzsgdGhpcy5idXN5ID0gIWxvb3A7IHRoaXMuaG9sZEVuZCA9IGhvbGQ7XG4gIH1cbiAgcHJpdmF0ZSBob2xkRW5kID0gZmFsc2U7XG4gIHNldEVuYWJsZWQob246IGJvb2xlYW4pIHsgdGhpcy5ob2xkZXIuc2V0RW5hYmxlZChvbik7IGlmIChvbikgdGhpcy5wcy5zdGFydCgpOyBlbHNlIHRoaXMucHMuc3RvcCgpOyB9XG4gIC8qKiBXb3JsZCBwb3NpdGlvbiBvZiB0aGUgc3RhZmYgY3J5c3RhbCAoZm9yIHNwZWxsIGVmZmVjdHMpOiBhYm92ZSB0aGUgaGFuZCB0aGF0IGhvbGRzIHRoZSBzdGFmZi4gKi9cbiAgY3J5c3RhbFBvcygpOiBhbnkge1xuICAgIHRoaXMuaG9sZGVyLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTtcbiAgICBjb25zdCBiYXNlID0gdGhpcy5oYW5kID8gKHRoaXMuaGFuZC5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSksIHRoaXMuaGFuZC5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuY2xvbmUoKSkgOiB0aGlzLmhvbGRlci5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuYWRkKG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC42ICogdGhpcy5TLCAwKSk7XG4gICAgcmV0dXJuIGJhc2UuYWRkKG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC42MiAqIHRoaXMuUywgMCkpO1xuICB9XG5cbiAgaHVydCgpIHsgaWYgKCF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdIdXJ0Jyk7IH1cbiAgY2FzdCgpIHsgaWYgKCF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdDYXN0Jyk7IH1cbiAgLyoqIFRoZSBsYXN0IGhlYXJ0IGlzIGdvbmU6IGhlIHNpbmtzIHRvIGhpcyBrbmVlcy4gKi9cbiAgZGVmZWF0KCkgeyB0aGlzLmRvd25lZCA9IHRydWU7IHRoaXMucGxheSgnRG93bicsIGZhbHNlLCB0cnVlKTsgfVxuICByZXZpdmUoKSB7IGlmICh0aGlzLmRvd25lZCkgeyB0aGlzLmRvd25lZCA9IGZhbHNlOyB0aGlzLnBsYXkoJ1Jldml2ZScpOyB9IGVsc2UgaWYgKHRoaXMuYnVzeSAmJiB0aGlzLmN1ciAhPT0gdGhpcy5hbmltc1snSWRsZSddKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTsgfVxuXG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0O1xuICAgIGlmICh0aGlzLmN1ciAmJiAhdGhpcy5jdXIuaXNTdGFydGVkICYmICF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdJZGxlJywgdHJ1ZSk7ICAgICAgICAgICAgICAvLyBhIG9uZS1zaG90IGZpbmlzaGVkXG4gICAgZWxzZSBpZiAodGhpcy5jdXIgJiYgIXRoaXMuY3VyLmlzU3RhcnRlZCAmJiB0aGlzLmRvd25lZCAmJiAhdGhpcy5ob2xkRW5kKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTtcbiAgICBpZiAoIXRoaXMuYnVzeSAmJiAhdGhpcy5kb3duZWQpIHsgdGhpcy5pZGxlVCArPSBkdDsgaWYgKHRoaXMuaWRsZVQgPiB0aGlzLm5leHRUYXApIHsgdGhpcy5pZGxlVCA9IDA7IHRoaXMubmV4dFRhcCA9IDkgKyBNYXRoLnJhbmRvbSgpICogODsgdGhpcy5wbGF5KCdUYXAnKTsgfSB9XG4gICAgdGhpcy5wcy5lbWl0UmF0ZSA9IHRoaXMuZG93bmVkID8gNiA6ICh0aGlzLmJ1c3kgJiYgdGhpcy5jdXIgPT09IHRoaXMuYW5pbXNbJ0Nhc3QnXSA/IDExMCA6IDMwKTtcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7IHRoaXMucHMuc3RvcCgpOyB0aGlzLnBzLmRpc3Bvc2UoZmFsc2UpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG4iLCAiLy8gQmF0dGxlIFZGWDogaGl0IHNwYXJrcywgZmxvYXRpbmcgZGFtYWdlIG51bWJlcnMsIGRlYXRoIHdpc3BzLCBncm91bmQtc2xhbSBkdXN0LCBsaWdodCBwaWxsYXJzLCBydW5lIGNpcmNsZXMsIHRoZSBOZWNyb21hbmNlcidzIHNob2Nrd2F2ZSxcbi8vIGNhbWVyYSBzaGFrZSBhbmQgc2NyZWVuIGZsYXNoLiBQdXJlbHkgdmlzdWFsIChub3RoaW5nIGhlcmUgdG91Y2hlcyB0aGUgYmF0dGxlKSwgYW5kIGNoZWFwOiBwYXJ0aWNsZSBzeXN0ZW1zIGFyZSBwb29sZWQgYW5kIHJldXNlZCwgbnVtYmVycyBhcmUgYSBmZXcgRE9NIG5vZGVzLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5cbnR5cGUgQ29sID0gW251bWJlciwgbnVtYmVyLCBudW1iZXJdO1xuY29uc3QgZHluID0gKHNjZW5lOiBhbnksIHc6IG51bWJlciwgaDogbnVtYmVyLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkKSA9PiB7XG4gIGNvbnN0IHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgndmZ4JywgeyB3aWR0aDogdywgaGVpZ2h0OiBoIH0sIHNjZW5lLCB0cnVlKTsgZHJhdyh0LmdldENvbnRleHQoKSk7IHQudXBkYXRlKCk7IHQuaGFzQWxwaGEgPSB0cnVlOyByZXR1cm4gdDtcbn07XG5pbnRlcmZhY2UgUG9vbGVkIHsgcHM6IGFueTsgYXQ6IGFueSB9XG5pbnRlcmZhY2UgVGltZWQgeyB0OiBudW1iZXI7IGR1cjogbnVtYmVyOyBmbjogKHU6IG51bWJlcikgPT4gdm9pZDsgZG9uZT86ICgpID0+IHZvaWQgfVxuXG5leHBvcnQgY2xhc3MgVmZ4IHtcbiAgcHJpdmF0ZSBwb29sczogUmVjb3JkPHN0cmluZywgUG9vbGVkW10+ID0ge307IHByaXZhdGUgbmV4dDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICBwcml2YXRlIHRpbWVkOiBUaW1lZFtdID0gW107IHByaXZhdGUgbGF5ZXI6IEhUTUxFbGVtZW50OyBwcml2YXRlIHBlbmRpbmcgPSBuZXcgTWFwPG51bWJlciwgeyBkbWc6IG51bWJlcjsgdDogbnVtYmVyOyB4OiBudW1iZXI7IHk6IG51bWJlcjsgejogbnVtYmVyOyBtaW5lOiBib29sZWFuOyBiaWc6IGJvb2xlYW4gfT4oKTtcbiAgcHJpdmF0ZSBzaGFrZU1hZyA9IDA7IHByaXZhdGUgc2hha2VUID0gMDsgcHJpdmF0ZSBzaGFrZUR1ciA9IDA7IG9mZjogYW55ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLCAwKTtcbiAgcHJpdmF0ZSBudW1iZXJzT24gPSB0cnVlOyBwcml2YXRlIHNwYXJrOiBhbnk7IHByaXZhdGUgcnVuZVRleDogYW55OyBwcml2YXRlIGJlYW1UZXg6IGFueTsgcHJpdmF0ZSBmbGFzaEVsOiBIVE1MRWxlbWVudDtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHNjZW5lOiBhbnksIHByaXZhdGUgZW5naW5lOiBhbnksIHByaXZhdGUgY2FtZXJhOiBhbnksIGhvc3Q6IEhUTUxFbGVtZW50LCBwcml2YXRlIHNvZnQ6IGFueSkge1xuICAgIHRoaXMuc3BhcmsgPSBkeW4oc2NlbmUsIDY0LCA2NCwgKGMpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgZm91ci1wb2ludCBnbGludFxuICAgICAgY29uc3QgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMwKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC4yNSwgJ3JnYmEoMjU1LDI1NSwyNTUsLjU1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICAgICAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IGMuZmlsbFN0eWxlID0gJ3JnYmEoMjU1LDI1NSwyNTUsLjk1KSc7IGMuZmlsbFJlY3QoMzAsIDIsIDQsIDYwKTsgYy5maWxsUmVjdCgyLCAzMCwgNjAsIDQpO1xuICAgIH0pO1xuICAgIHRoaXMuYmVhbVRleCA9IGR5bihzY2VuZSwgOCwgMjU2LCAoYykgPT4geyBjb25zdCBnID0gYy5jcmVhdGVMaW5lYXJHcmFkaWVudCgwLCAwLCAwLCAyNTYpOyBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjcsICdyZ2JhKDI1NSwyNTUsMjU1LC41NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDgsIDI1Nik7IH0pO1xuICAgIHRoaXMucnVuZVRleCA9IGR5bihzY2VuZSwgNTEyLCA1MTIsIChjKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgcmluZyBvZiBtYXJrcyBhcm91bmQgYSBzdGFyOiB0aGUgTmVjcm9tYW5jZXIncyBjaXJjbGVcbiAgICAgIGMudHJhbnNsYXRlKDI1NiwgMjU2KTsgYy5zdHJva2VTdHlsZSA9ICcjZmZmJzsgYy5saW5lQ2FwID0gJ3JvdW5kJztcbiAgICAgIGZvciAoY29uc3QgW3IsIHddIG9mIFtbMjM2LCA2XSwgWzIxNCwgM10sIFsxNTAsIDNdXSBhcyBudW1iZXJbXVtdKSB7IGMubGluZVdpZHRoID0gdzsgYy5iZWdpblBhdGgoKTsgYy5hcmMoMCwgMCwgciwgMCwgTWF0aC5QSSAqIDIpOyBjLnN0cm9rZSgpOyB9XG4gICAgICBjLmxpbmVXaWR0aCA9IDU7IGZvciAobGV0IGkgPSAwOyBpIDwgMzY7IGkrKykgeyBjb25zdCBhID0gKGkgLyAzNikgKiBNYXRoLlBJICogMjsgYy5zYXZlKCk7IGMucm90YXRlKGEpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMTcyKTsgYy5saW5lVG8oMCwgLWkgJSAzID09PSAwID8gMjA4IDogMTkwKTsgYy5zdHJva2UoKTsgYy5yZXN0b3JlKCk7IH1cbiAgICAgIGMubGluZVdpZHRoID0gNDsgYy5iZWdpblBhdGgoKTsgZm9yIChsZXQgaSA9IDA7IGkgPD0gMTA7IGkrKykgeyBjb25zdCBhID0gKGkgKiAyIC8gNSkgKiBNYXRoLlBJICsgMDsgY29uc3QgeCA9IE1hdGguc2luKGEpICogMTQ2LCB5ID0gLU1hdGguY29zKGEpICogMTQ2OyBpZiAoaSkgYy5saW5lVG8oeCwgeSk7IGVsc2UgYy5tb3ZlVG8oeCwgeSk7IH0gYy5zdHJva2UoKTtcbiAgICAgIGMubGluZVdpZHRoID0gMzsgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspIHsgYy5zYXZlKCk7IGMucm90YXRlKChpIC8gOCkgKiBNYXRoLlBJICogMik7IGMuYmVnaW5QYXRoKCk7IGMubW92ZVRvKC0xMCwgLTEwMCk7IGMubGluZVRvKDAsIC0xMTYpOyBjLmxpbmVUbygxMCwgLTEwMCk7IGMubW92ZVRvKDAsIC0xMTYpOyBjLmxpbmVUbygwLCAtODQpOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTsgfVxuICAgIH0pO1xuICAgIHRoaXMubWFrZVBvb2woJ3NwYXJrJywgMTIsIDI0LCB0aGlzLnNwYXJrLCB0cnVlKTsgdGhpcy5tYWtlUG9vbCgndHJhaWwnLCAxMCwgMTAsIHRoaXMuc29mdCwgdHJ1ZSk7IHRoaXMubWFrZVBvb2woJ3dpc3AnLCA2LCAzMCwgdGhpcy5zb2Z0LCB0cnVlKTtcbiAgICB0aGlzLm1ha2VQb29sKCdib25lJywgNiwgMjQsIHRoaXMuc29mdCwgZmFsc2UpOyB0aGlzLm1ha2VQb29sKCdkdXN0JywgNCwgNDAsIHRoaXMuc29mdCwgZmFsc2UpOyB0aGlzLm1ha2VQb29sKCd3YXZlJywgMiwgMjYwLCB0aGlzLnNvZnQsIHRydWUpO1xuICAgIGlmICghZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3ZmeC1jc3MnKSkge1xuICAgICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7IHMuaWQgPSAndmZ4LWNzcyc7XG4gICAgICBzLnRleHRDb250ZW50ID0gYCNmeGxheWVye3Bvc2l0aW9uOmFic29sdXRlO2luc2V0OjA7cG9pbnRlci1ldmVudHM6bm9uZTtvdmVyZmxvdzpoaWRkZW47ei1pbmRleDo2fVxuLmRtZ257cG9zaXRpb246YWJzb2x1dGU7Zm9udDo5MDAgY2xhbXAoMTJweCwyLjd2bWluLDIwcHgpIHN5c3RlbS11aSxzYW5zLXNlcmlmO2NvbG9yOiNmZmUyN2E7dGV4dC1zaGFkb3c6MCAycHggMCAjMTUwZDI2LDAgMCA2cHggIzE1MGQyNiwwIDAgMnB4ICMxNTBkMjY7dHJhbnNmb3JtOnRyYW5zbGF0ZSgtNTAlLC01MCUpO2FuaW1hdGlvbjpkbWd1cCAuOHMgZWFzZS1vdXQgZm9yd2FyZHM7d2lsbC1jaGFuZ2U6dHJhbnNmb3JtLG9wYWNpdHk7d2hpdGUtc3BhY2U6bm93cmFwfVxuLmRtZ24udGhlaXJze2NvbG9yOiNmZjdhN2F9LmRtZ24uYmlne2ZvbnQtc2l6ZTpjbGFtcCgxN3B4LDMuOHZtaW4sMjhweCk7Y29sb3I6I2ZmZjNiMH0uZG1nbi50aGVpcnMuYmlne2NvbG9yOiNmZmIwYjB9XG5Aa2V5ZnJhbWVzIGRtZ3VwezAle29wYWNpdHk6MDt0cmFuc2Zvcm06dHJhbnNsYXRlKC01MCUsLTEwJSkgc2NhbGUoLjUpfTE0JXtvcGFjaXR5OjE7dHJhbnNmb3JtOnRyYW5zbGF0ZSgtNTAlLC02MCUpIHNjYWxlKDEuMil9MTAwJXtvcGFjaXR5OjA7dHJhbnNmb3JtOnRyYW5zbGF0ZSgtNTAlLC0yMzAlKSBzY2FsZSguOSl9fVxuI2Z4Zmxhc2h7cG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDtwb2ludGVyLWV2ZW50czpub25lO3otaW5kZXg6NztvcGFjaXR5OjB9XG5Aa2V5ZnJhbWVzIGZ4Zmxhc2h7MCV7b3BhY2l0eTp2YXIoLS1mYSl9MTAwJXtvcGFjaXR5OjB9fWA7XG4gICAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xuICAgIH1cbiAgICB0aGlzLmxheWVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Z4bGF5ZXInKSB8fCBPYmplY3QuYXNzaWduKGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLCB7IGlkOiAnZnhsYXllcicgfSk7IGlmICghdGhpcy5sYXllci5wYXJlbnRFbGVtZW50KSBob3N0LmFwcGVuZENoaWxkKHRoaXMubGF5ZXIpO1xuICAgIHRoaXMuZmxhc2hFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmeGZsYXNoJykgfHwgT2JqZWN0LmFzc2lnbihkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSwgeyBpZDogJ2Z4Zmxhc2gnIH0pOyBpZiAoIXRoaXMuZmxhc2hFbC5wYXJlbnRFbGVtZW50KSBob3N0LmFwcGVuZENoaWxkKHRoaXMuZmxhc2hFbCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBvb2xzXG4gIHByaXZhdGUgbWFrZVBvb2woa2luZDogc3RyaW5nLCBuOiBudW1iZXIsIGNhcDogbnVtYmVyLCB0ZXg6IGFueSwgYWRkOiBib29sZWFuKSB7XG4gICAgY29uc3QgbGlzdDogUG9vbGVkW10gPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykge1xuICAgICAgY29uc3QgYXQgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIC01MCwgMCksIHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oa2luZCArIGksIGNhcCwgdGhpcy5zY2VuZSk7XG4gICAgICBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0ZXg7IHBzLmVtaXR0ZXIgPSBhdDsgcHMuZW1pdFJhdGUgPSAwOyBwcy5tYW51YWxFbWl0Q291bnQgPSAwOyBwcy5taW5FbWl0Qm94ID0gcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMCwgMCk7XG4gICAgICBwcy5ibGVuZE1vZGUgPSBhZGQgPyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9PTkVPTkUgOiBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9TVEFOREFSRDsgcHMuaXNMb2NhbCA9IGZhbHNlOyBwcy51cGRhdGVTcGVlZCA9IDAuMDI7XG4gICAgICB0aGlzLmNvbmZpZyhraW5kLCBwcyk7IHBzLnN0YXJ0KCk7IGxpc3QucHVzaCh7IHBzLCBhdCB9KTtcbiAgICB9XG4gICAgdGhpcy5wb29sc1traW5kXSA9IGxpc3Q7IHRoaXMubmV4dFtraW5kXSA9IDA7XG4gIH1cbiAgcHJpdmF0ZSBjb25maWcoa2luZDogc3RyaW5nLCBwczogYW55KSB7XG4gICAgY29uc3QgQzQgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYTogbnVtYmVyKSA9PiBuZXcgQkFCWUxPTi5Db2xvcjQociwgZywgYiwgYSksIFYgPSAoeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlcikgPT4gbmV3IEJBQllMT04uVmVjdG9yMyh4LCB5LCB6KTtcbiAgICBpZiAoa2luZCA9PT0gJ3NwYXJrJykgeyBwcy5taW5TaXplID0gMC4wNzsgcHMubWF4U2l6ZSA9IDAuMTc7IHBzLm1pbkxpZmVUaW1lID0gMC4xNDsgcHMubWF4TGlmZVRpbWUgPSAwLjM0OyBwcy5kaXJlY3Rpb24xID0gVigtMSwgMC4yLCAtMSk7IHBzLmRpcmVjdGlvbjIgPSBWKDEsIDEuMywgMSk7IHBzLm1pbkVtaXRQb3dlciA9IDEuMjsgcHMubWF4RW1pdFBvd2VyID0gMy4yOyBwcy5ncmF2aXR5ID0gVigwLCAtNywgMCk7IHBzLmNvbG9yMSA9IEM0KDEsIDAuOTUsIDAuNywgMSk7IHBzLmNvbG9yMiA9IEM0KDEsIDAuNywgMC4zNSwgMSk7IHBzLmNvbG9yRGVhZCA9IEM0KDAuNCwgMC4xLCAwLjEsIDApOyB9XG4gICAgZWxzZSBpZiAoa2luZCA9PT0gJ3RyYWlsJykgeyBwcy5taW5TaXplID0gMC4wNTsgcHMubWF4U2l6ZSA9IDAuMTE7IHBzLm1pbkxpZmVUaW1lID0gMC4xODsgcHMubWF4TGlmZVRpbWUgPSAwLjM7IHBzLmRpcmVjdGlvbjEgPSBWKC0wLjEsIC0wLjA1LCAtMC4xKTsgcHMuZGlyZWN0aW9uMiA9IFYoMC4xLCAwLjEsIDAuMSk7IHBzLm1pbkVtaXRQb3dlciA9IDAuMTsgcHMubWF4RW1pdFBvd2VyID0gMC4zOyBwcy5jb2xvcjEgPSBDNCgxLCAwLjksIDAuNiwgMC44KTsgcHMuY29sb3IyID0gQzQoMC44LCAwLjYsIDEsIDAuNik7IHBzLmNvbG9yRGVhZCA9IEM0KDAuMiwgMC4xLCAwLjMsIDApOyB9XG4gICAgZWxzZSBpZiAoa2luZCA9PT0gJ3dpc3AnKSB7IHBzLm1pblNpemUgPSAwLjE0OyBwcy5tYXhTaXplID0gMC4zOyBwcy5taW5MaWZlVGltZSA9IDAuOTsgcHMubWF4TGlmZVRpbWUgPSAxLjU7IHBzLmRpcmVjdGlvbjEgPSBWKC0wLjI1LCAxLCAtMC4yNSk7IHBzLmRpcmVjdGlvbjIgPSBWKDAuMjUsIDIsIDAuMjUpOyBwcy5taW5FbWl0UG93ZXIgPSAwLjU7IHBzLm1heEVtaXRQb3dlciA9IDEuMTsgcHMuZ3Jhdml0eSA9IFYoMCwgMC40LCAwKTsgcHMuY29sb3IxID0gQzQoMC4zNSwgMSwgMC45LCAwLjkpOyBwcy5jb2xvcjIgPSBDNCgwLjIsIDAuNjUsIDEsIDAuNyk7IHBzLmNvbG9yRGVhZCA9IEM0KDAuMDUsIDAuMjUsIDAuNCwgMCk7IHBzLm1pbkFuZ3VsYXJTcGVlZCA9IC0yOyBwcy5tYXhBbmd1bGFyU3BlZWQgPSAyOyB9XG4gICAgZWxzZSBpZiAoa2luZCA9PT0gJ2JvbmUnKSB7IHBzLm1pblNpemUgPSAwLjEyOyBwcy5tYXhTaXplID0gMC4yNjsgcHMubWluTGlmZVRpbWUgPSAwLjU7IHBzLm1heExpZmVUaW1lID0gMC45OyBwcy5kaXJlY3Rpb24xID0gVigtMSwgMC40LCAtMSk7IHBzLmRpcmVjdGlvbjIgPSBWKDEsIDEuNCwgMSk7IHBzLm1pbkVtaXRQb3dlciA9IDAuNTsgcHMubWF4RW1pdFBvd2VyID0gMS40OyBwcy5ncmF2aXR5ID0gVigwLCAtMywgMCk7IHBzLmNvbG9yMSA9IEM0KDAuOTIsIDAuODYsIDAuNzQsIDAuODUpOyBwcy5jb2xvcjIgPSBDNCgwLjYsIDAuNSwgMC40NSwgMC43KTsgcHMuY29sb3JEZWFkID0gQzQoMC40LCAwLjM1LCAwLjMsIDApOyB9XG4gICAgZWxzZSBpZiAoa2luZCA9PT0gJ2R1c3QnKSB7IHBzLm1pblNpemUgPSAwLjMyOyBwcy5tYXhTaXplID0gMC43OyBwcy5taW5MaWZlVGltZSA9IDAuNTsgcHMubWF4TGlmZVRpbWUgPSAwLjk1OyBwcy5taW5FbWl0UG93ZXIgPSAyLjI7IHBzLm1heEVtaXRQb3dlciA9IDMuNjsgcHMuZ3Jhdml0eSA9IFYoMCwgLTAuNCwgMCk7IHBzLmNvbG9yMSA9IEM0KDAuNjIsIDAuNTUsIDAuNSwgMC41NSk7IHBzLmNvbG9yMiA9IEM0KDAuNDUsIDAuNCwgMC40LCAwLjQ1KTsgcHMuY29sb3JEZWFkID0gQzQoMC4zLCAwLjI3LCAwLjI3LCAwKTtcbiAgICAgIHBzLnN0YXJ0RGlyZWN0aW9uRnVuY3Rpb24gPSAoX206IGFueSwgZDogYW55KSA9PiB7IGNvbnN0IGEgPSBNYXRoLnJhbmRvbSgpICogTWF0aC5QSSAqIDI7IGQuc2V0KE1hdGguY29zKGEpLCAwLjA2ICsgTWF0aC5yYW5kb20oKSAqIDAuMiwgTWF0aC5zaW4oYSkpOyB9OyB9XG4gICAgZWxzZSBpZiAoa2luZCA9PT0gJ3dhdmUnKSB7IHBzLm1pblNpemUgPSAwLjM1OyBwcy5tYXhTaXplID0gMC44OyBwcy5taW5MaWZlVGltZSA9IDAuOTsgcHMubWF4TGlmZVRpbWUgPSAxLjM7IHBzLm1pbkVtaXRQb3dlciA9IDE2OyBwcy5tYXhFbWl0UG93ZXIgPSAyNDsgcHMuY29sb3IxID0gQzQoMC45NSwgMC42LCAxLCAwLjkpOyBwcy5jb2xvcjIgPSBDNCgwLjUsIDAuMjUsIDEsIDAuOCk7IHBzLmNvbG9yRGVhZCA9IEM0KDAuMTUsIDAuMDUsIDAuMywgMCk7XG4gICAgICBwcy5zdGFydERpcmVjdGlvbkZ1bmN0aW9uID0gKF9tOiBhbnksIGQ6IGFueSkgPT4geyBjb25zdCBhID0gTWF0aC5yYW5kb20oKSAqIE1hdGguUEkgKiAyOyBkLnNldChNYXRoLmNvcyhhKSwgMC4wNSArIE1hdGgucmFuZG9tKCkgKiAwLjEyLCBNYXRoLnNpbihhKSk7IH07IH1cbiAgfVxuICBwcml2YXRlIGVtaXQoa2luZDogc3RyaW5nLCB4OiBudW1iZXIsIHk6IG51bWJlciwgejogbnVtYmVyLCBuOiBudW1iZXIsIHR3ZWFrPzogKHBzOiBhbnkpID0+IHZvaWQpIHtcbiAgICBjb25zdCBsaXN0ID0gdGhpcy5wb29sc1traW5kXSwgaSA9IHRoaXMubmV4dFtraW5kXTsgdGhpcy5uZXh0W2tpbmRdID0gKGkgKyAxKSAlIGxpc3QubGVuZ3RoOyBjb25zdCBwID0gbGlzdFtpXTsgcC5hdC5zZXQoeCwgeSwgeik7XG4gICAgaWYgKHR3ZWFrKSB0d2VhayhwLnBzKTsgcC5wcy5tYW51YWxFbWl0Q291bnQgPSBuO1xuICB9XG4gIHByaXZhdGUgYWRkKGR1cjogbnVtYmVyLCBmbjogKHU6IG51bWJlcikgPT4gdm9pZCwgZG9uZT86ICgpID0+IHZvaWQpIHsgdGhpcy50aW1lZC5wdXNoKHsgdDogMCwgZHVyLCBmbiwgZG9uZSB9KTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gY29tYmF0IGZlZWRiYWNrXG4gIC8qKiBBIGJsb3cgbGFuZGVkLiBgbWluZWA6IGRlYWx0IGJ5IHlvdXIgYXJteS4gYGJpZ2A6IGEgaGVhdnkgaGl0IChzbWFzaCwgYm9zcywgYmlnIHNoYXJlIG9mIGhlYWx0aCkuICovXG4gIGhpdChpZDogbnVtYmVyLCB4OiBudW1iZXIsIHo6IG51bWJlciwgdG9wOiBudW1iZXIsIGRtZzogbnVtYmVyLCBtaW5lOiBib29sZWFuLCBiaWc6IGJvb2xlYW4sIGtpbmQ6IHN0cmluZykge1xuICAgIHRoaXMuZW1pdCgnc3BhcmsnLCB4LCB0b3AgKiAwLjU1LCB6LCBiaWcgPyAxMCA6IDUsIChwczogYW55KSA9PiB7IGlmIChtaW5lKSB7IHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjg1LCAwLjcsIDEsIDEpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMSwgMC45LCAwLjcsIDEpOyB9IGVsc2UgeyBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMSwgMC41NSwgMC40LCAxKTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KDEsIDAuODUsIDAuNSwgMSk7IH0gfSk7XG4gICAgbGV0IHAgPSB0aGlzLnBlbmRpbmcuZ2V0KGlkKTsgaWYgKCFwKSB7IHAgPSB7IGRtZzogMCwgdDogMCwgeCwgeTogdG9wLCB6LCBtaW5lLCBiaWc6IGZhbHNlIH07IHRoaXMucGVuZGluZy5zZXQoaWQsIHApOyB9XG4gICAgcC5kbWcgKz0gZG1nOyBwLmJpZyA9IHAuYmlnIHx8IGJpZzsgcC54ID0geDsgcC56ID0gejsgcC55ID0gdG9wO1xuICB9XG4gIHByaXZhdGUgZmx1c2hOdW1iZXJzKGR0OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5wZW5kaW5nLnNpemUgPT09IDApIHJldHVybjtcbiAgICBjb25zdCBlID0gdGhpcy5lbmdpbmUsIGNhbnZhcyA9IGUuZ2V0UmVuZGVyaW5nQ2FudmFzKCksIGsgPSBjYW52YXMuY2xpZW50V2lkdGggLyBNYXRoLm1heCgxLCBlLmdldFJlbmRlcldpZHRoKCkpOyBsZXQgc2hvd24gPSAwO1xuICAgIGZvciAoY29uc3QgW2lkLCBwXSBvZiB0aGlzLnBlbmRpbmcpIHtcbiAgICAgIHAudCArPSBkdDsgaWYgKHAudCA8IDAuMjgpIGNvbnRpbnVlOyB0aGlzLnBlbmRpbmcuZGVsZXRlKGlkKTsgaWYgKCF0aGlzLm51bWJlcnNPbiB8fCBzaG93biA+PSA2IHx8IHRoaXMubGF5ZXIuY2hpbGRFbGVtZW50Q291bnQgPiAyNikgY29udGludWU7XG4gICAgICBjb25zdCB2ID0gQkFCWUxPTi5WZWN0b3IzLlByb2plY3QobmV3IEJBQllMT04uVmVjdG9yMyhwLngsIHAueSArIDAuMzUsIHAueiksIEJBQllMT04uTWF0cml4LklkZW50aXR5KCksIHRoaXMuc2NlbmUuZ2V0VHJhbnNmb3JtTWF0cml4KCksIHRoaXMuY2FtZXJhLnZpZXdwb3J0LnRvR2xvYmFsKGUuZ2V0UmVuZGVyV2lkdGgoKSwgZS5nZXRSZW5kZXJIZWlnaHQoKSkpO1xuICAgICAgaWYgKHYueiA8IDAgfHwgdi56ID4gMSkgY29udGludWU7IHNob3duKys7XG4gICAgICBjb25zdCBkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGQuY2xhc3NOYW1lID0gJ2RtZ24nICsgKHAubWluZSA/ICcnIDogJyB0aGVpcnMnKSArIChwLmJpZyA/ICcgYmlnJyA6ICcnKTsgZC50ZXh0Q29udGVudCA9IFN0cmluZyhNYXRoLm1heCgxLCBNYXRoLnJvdW5kKHAuZG1nKSkpO1xuICAgICAgZC5zdHlsZS5sZWZ0ID0gdi54ICogayArIChNYXRoLnJhbmRvbSgpICogMTQgLSA3KSArICdweCc7IGQuc3R5bGUudG9wID0gdi55ICogayArICdweCc7IHRoaXMubGF5ZXIuYXBwZW5kQ2hpbGQoZCk7IHNldFRpbWVvdXQoKCkgPT4gZC5yZW1vdmUoKSwgODUwKTtcbiAgICB9XG4gIH1cbiAgLyoqIEEgZmlnaHRlciBmZWxsOiB5b3VyIG93biB1bml0cyBjcnVtYmxlIGludG8gYm9uZSBkdXN0LCBlbmVteSBzb3VscyByaXNlIGFzIHRlYWwgd2lzcHMgdG93YXJkIHRoZSBOZWNyb21hbmNlci4gKi9cbiAgZGVhdGgoeDogbnVtYmVyLCB6OiBudW1iZXIsIGVuZW15OiBib29sZWFuLCB0b3A6IG51bWJlcikge1xuICAgIGlmIChlbmVteSkgeyB0aGlzLmVtaXQoJ3dpc3AnLCB4LCB0b3AgKiAwLjUsIHosIDEyKTsgdGhpcy5lbWl0KCdzcGFyaycsIHgsIHRvcCAqIDAuNCwgeiwgNiwgKHBzOiBhbnkpID0+IHsgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDAuNCwgMSwgMC45LCAxKTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KDAuNiwgMC44LCAxLCAxKTsgfSk7IH1cbiAgICBlbHNlIHsgdGhpcy5lbWl0KCdib25lJywgeCwgdG9wICogMC40NSwgeiwgMTIpOyB0aGlzLmVtaXQoJ2R1c3QnLCB4LCAwLjA4LCB6LCA2LCAocHM6IGFueSkgPT4geyBwcy5taW5FbWl0UG93ZXIgPSAwLjg7IHBzLm1heEVtaXRQb3dlciA9IDEuNjsgfSk7IH1cbiAgfVxuICAvKiogQSBoZWF2eSBibG93IGhpdHMgdGhlIGdyb3VuZDogYSByaW5nIG9mIGR1c3QsIGEgZmV3IHN0b25lcyBhbmQgYSBzbWFsbCBzaGFrZS4gKi9cbiAgc2xhbSh4OiBudW1iZXIsIHo6IG51bWJlciwgcjogbnVtYmVyKSB7IHRoaXMuZW1pdCgnZHVzdCcsIHgsIDAuMSwgeiwgMTYsIChwczogYW55KSA9PiB7IHBzLm1pbkVtaXRQb3dlciA9IDIuMiAqIE1hdGgubWluKDEuNiwgciAvIDEuNSArIDAuNCk7IHBzLm1heEVtaXRQb3dlciA9IDMuNiAqIE1hdGgubWluKDEuNiwgciAvIDEuNSArIDAuNCk7IH0pOyB0aGlzLmVtaXQoJ3NwYXJrJywgeCwgMC4xNSwgeiwgOCwgKHBzOiBhbnkpID0+IHsgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDAuOSwgMC43LCAwLjQ1LCAxKTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KDAuNywgMC41NSwgMC40LCAxKTsgfSk7IHRoaXMuc2hha2UoMC4wNSwgMC4yMik7IH1cbiAgLyoqIEFuIGFycm93IGluIGZsaWdodCBsZWF2ZXMgYSBzaG9ydCBnbGludC4gKi9cbiAgdHJhaWwoeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlciwgbWluZTogYm9vbGVhbikgeyB0aGlzLmVtaXQoJ3RyYWlsJywgeCwgeSwgeiwgMiwgKHBzOiBhbnkpID0+IHsgaWYgKG1pbmUpIHsgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDAuODUsIDAuNjUsIDEsIDAuOCk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjYsIDAuNCwgMSwgMC42KTsgfSBlbHNlIHsgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDEsIDAuNzUsIDAuNCwgMC44KTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KDEsIDAuNSwgMC4yNSwgMC42KTsgfSB9KTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gYmlnIG1vbWVudHNcbiAgLyoqIEEgY29sdW1uIG9mIGxpZ2h0OiB0aGUgbW9tZW50IHNvbWV0aGluZyBwb3dlcmZ1bCBhcnJpdmVzLiAqL1xuICBwaWxsYXIoeDogbnVtYmVyLCB6OiBudW1iZXIsIGNvbDogQ29sLCBoZWlnaHQgPSA3LCB3aWR0aCA9IDAuOSwgZHVyID0gMC45KSB7XG4gICAgY29uc3QgcyA9IHRoaXMuc2NlbmUsIG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWxsYXInLCB7IGhlaWdodCwgZGlhbWV0ZXJUb3A6IHdpZHRoICogMC40NSwgZGlhbWV0ZXJCb3R0b206IHdpZHRoLCB0ZXNzZWxsYXRpb246IDIyLCBjYXA6IDAgfSwgcyk7XG4gICAgbS5wb3NpdGlvbi5zZXQoeCwgaGVpZ2h0IC8gMiwgeik7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyBjb25zdCBtYXQgPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdwaWxsYXJtJywgcyk7IG1hdC5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtYXQuZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhjb2xbMF0gKiAwLjcsIGNvbFsxXSAqIDAuNywgY29sWzJdICogMC43KTsgbWF0LmRpZmZ1c2VUZXh0dXJlID0gdGhpcy5iZWFtVGV4OyBtYXQudXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtYXQuYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IG1hdC5hbHBoYU1vZGUgPSBCQUJZTE9OLkVuZ2luZS5BTFBIQV9BREQ7IG0ubWF0ZXJpYWwgPSBtYXQ7XG4gICAgdGhpcy5hZGQoZHVyLCAodSkgPT4geyBjb25zdCBncm93ID0gTWF0aC5taW4oMSwgdSAqIDYpLCBmYWRlID0gMSAtIHU7IG0uc2NhbGluZy5zZXQoZ3JvdyAqICgxLjEgLSAwLjcgKiB1KSwgMSwgZ3JvdyAqICgxLjEgLSAwLjcgKiB1KSk7IG1hdC5hbHBoYSA9IGZhZGU7IH0sICgpID0+IHsgbS5kaXNwb3NlKCk7IG1hdC5kaXNwb3NlKCk7IH0pO1xuICB9XG4gIC8qKiBBIGdsb3dpbmcgcnVuZSBjaXJjbGUgb24gdGhlIGZsb29yIHRoYXQgc3BpbnMgYW5kIGZhZGVzLiAqL1xuICBydW5lKHg6IG51bWJlciwgejogbnVtYmVyLCByYWRpdXM6IG51bWJlciwgY29sOiBDb2wsIGR1ciA9IDEuNiwgc3BpbiA9IDEuMikge1xuICAgIGNvbnN0IHMgPSB0aGlzLnNjZW5lLCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdydW5lJywgeyByYWRpdXM6IDEsIHRlc3NlbGxhdGlvbjogNDggfSwgcyk7IG0ucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyBtLnBvc2l0aW9uLnNldCh4LCAwLjA0NSwgeik7IG0uaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG1hdCA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3J1bmVtJywgcyk7IG1hdC5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtYXQuZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyguLi5jb2wpOyBtYXQuZGlmZnVzZVRleHR1cmUgPSB0aGlzLnJ1bmVUZXg7IG1hdC51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IG1hdC5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgbWF0LmFscGhhTW9kZSA9IEJBQllMT04uRW5naW5lLkFMUEhBX0FERDsgbS5tYXRlcmlhbCA9IG1hdDtcbiAgICB0aGlzLmFkZChkdXIsICh1KSA9PiB7IGNvbnN0IGlubiA9IE1hdGgubWluKDEsIHUgKiA1KSwgb3V0ID0gMSAtIE1hdGgubWF4KDAsICh1IC0gMC42KSAvIDAuNCk7IG0uc2NhbGluZy5zZXRBbGwocmFkaXVzICogKDAuNCArIDAuNiAqIGlubikpOyBtYXQuYWxwaGEgPSBpbm4gKiBvdXQ7IG0ucm90YXRpb24ueSA9IHUgKiBzcGluICogMzsgfSwgKCkgPT4geyBtLmRpc3Bvc2UoKTsgbWF0LmRpc3Bvc2UoKTsgfSk7XG4gIH1cbiAgLyoqIFRoZSBOZWNyb21hbmNlcidzIHJlcHVsc2lvbiBzaG9ja3dhdmU6IGEgZGFyayBkb21lLCBhIHdhbGwgb2Ygcm9sbGluZyBlbmVyZ3kgYWxvbmcgdGhlIGdyb3VuZCwgYSBmbGFzaCBhbmQgYSBoZWF2eSBzaGFrZS4gKi9cbiAgc2hvY2soeDogbnVtYmVyLCB6OiBudW1iZXIsIG1heFI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLnNjZW5lLCBkb21lID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2RvbWUnLCB7IGRpYW1ldGVyOiAyLCBzZWdtZW50czogMjAgfSwgcyk7IGRvbWUucG9zaXRpb24uc2V0KHgsIDAsIHopOyBkb21lLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBtYXQgPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdkb21lbScsIHMpOyBtYXQuZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbWF0LmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC41NSwgMC4yLCAwLjk1KTsgbWF0LmJhY2tGYWNlQ3VsbGluZyA9IGZhbHNlOyBtYXQuYWxwaGEgPSAwLjM7IG1hdC5hbHBoYU1vZGUgPSBCQUJZTE9OLkVuZ2luZS5BTFBIQV9BREQ7IGRvbWUubWF0ZXJpYWwgPSBtYXQ7XG4gICAgdGhpcy5hZGQoMS4wLCAodSkgPT4geyBjb25zdCByID0gMC42ICsgKG1heFIgLSAwLjYpICogKDEgLSBNYXRoLnBvdygxIC0gdSwgMi4yKSk7IGRvbWUuc2NhbGluZy5zZXQociwgciAqIDAuMjIsIHIpOyBtYXQuYWxwaGEgPSAwLjM0ICogTWF0aC5wb3coMSAtIHUsIDEuNSk7IH0sICgpID0+IHsgZG9tZS5kaXNwb3NlKCk7IG1hdC5kaXNwb3NlKCk7IH0pO1xuICAgIHRoaXMuZW1pdCgnd2F2ZScsIHgsIDAuMjUsIHosIDI0MCwgKHBzOiBhbnkpID0+IHsgcHMubWluRW1pdFBvd2VyID0gMTY7IHBzLm1heEVtaXRQb3dlciA9IDI0OyB9KTsgdGhpcy5lbWl0KCdkdXN0JywgeCwgMC4xLCB6LCAyMiwgKHBzOiBhbnkpID0+IHsgcHMubWluRW1pdFBvd2VyID0gNzsgcHMubWF4RW1pdFBvd2VyID0gMTI7IHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjQ1LCAwLjM1LCAwLjYsIDAuNTUpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4zLCAwLjIsIDAuNDUsIDAuNDUpOyB9KTtcbiAgICB0aGlzLnJ1bmUoeCwgeiwgMy4yLCBbMC43LCAwLjM1LCAxXSwgMS4zLCAyLjIpOyB0aGlzLnBpbGxhcih4LCB6LCBbMC43NSwgMC40LCAxXSwgOSwgMS4zLCAwLjgpOyB0aGlzLmZsYXNoKFswLjc1LCAwLjQ1LCAxXSwgMC41NSwgMC40NSk7IHRoaXMuc2hha2UoMC4yOCwgMC42KTtcbiAgfVxuICAvKiogQSBmcmVzaCBTb3VsIG9yIG1lcmdlZCBTb3VsIGxhbmRzOiBhIHBpbGxhciBvZiBsaWdodCBhbmQgYSBydW5lIGNpcmNsZSAoYmlnZ2VyIGZvciBoaWdoZXIgc3RhcnMpLiAqL1xuICBhcnJpdmUoeDogbnVtYmVyLCB6OiBudW1iZXIsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IGNvbDogQ29sID0gc3RhciA+PSAzID8gWzAuOCwgMC40LCAxXSA6IHN0YXIgPT09IDIgPyBbMC42LCAwLjc1LCAxXSA6IFswLjY1LCAwLjQsIDFdO1xuICAgIHRoaXMucGlsbGFyKHgsIHosIGNvbCwgc3RhciA+PSAzID8gOCA6IHN0YXIgPT09IDIgPyA0LjQgOiAzLCAwLjUgKyBzdGFyICogMC4zLCAwLjUgKyBzdGFyICogMC4yNSk7XG4gICAgaWYgKHN0YXIgPj0gMikgdGhpcy5ydW5lKHgsIHosIDEuMiArIHN0YXIgKiAwLjM1LCBjb2wsIDEuMCArIHN0YXIgKiAwLjMsIDIpO1xuICAgIGlmIChzdGFyID49IDMpIHsgdGhpcy5mbGFzaChbMC43NSwgMC40NSwgMV0sIDAuNCwgMC40KTsgdGhpcy5zaGFrZSgwLjEyLCAwLjM1KTsgdGhpcy5lbWl0KCd3YXZlJywgeCwgMC4yLCB6LCA5MCwgKHBzOiBhbnkpID0+IHsgcHMubWluRW1pdFBvd2VyID0gNTsgcHMubWF4RW1pdFBvd2VyID0gOTsgfSk7IH1cbiAgfVxuICAvKiogVGhlIGVuZW15IGJvc3Mgc3RlcHMgb3V0OiBkYXJrIHB1bHNlLCBzbGFtLCBzaGFrZS4gKi9cbiAgYm9zc0ludHJvKHg6IG51bWJlciwgejogbnVtYmVyKSB7IHRoaXMucGlsbGFyKHgsIHosIFsxLCAwLjMsIDAuMjVdLCA4LCAxLjQsIDEuMSk7IHRoaXMucnVuZSh4LCB6LCAyLjYsIFsxLCAwLjM1LCAwLjNdLCAxLjYsIC0xLjQpOyB0aGlzLmZsYXNoKFsxLCAwLjI1LCAwLjJdLCAwLjM1LCAwLjUpOyB0aGlzLnNoYWtlKDAuMjIsIDAuNik7IHRoaXMuc2xhbSh4LCB6LCAzKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2NyZWVuXG4gIHNoYWtlKG1hZzogbnVtYmVyLCBkdXI6IG51bWJlcikgeyBpZiAobWFnID49IHRoaXMuc2hha2VNYWcgKiAodGhpcy5zaGFrZVQgLyBNYXRoLm1heCgwLjAwMSwgdGhpcy5zaGFrZUR1cikpKSB7IHRoaXMuc2hha2VNYWcgPSBtYWc7IHRoaXMuc2hha2VEdXIgPSBkdXI7IHRoaXMuc2hha2VUID0gZHVyOyB9IH1cbiAgZmxhc2goY29sOiBDb2wsIGFscGhhOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgY29uc3QgZSA9IHRoaXMuZmxhc2hFbDsgZS5zdHlsZS5iYWNrZ3JvdW5kID0gYHJhZGlhbC1ncmFkaWVudChlbGxpcHNlIGF0IGNlbnRlciwgcmdiYSgke01hdGgucm91bmQoY29sWzBdICogMjU1KX0sJHtNYXRoLnJvdW5kKGNvbFsxXSAqIDI1NSl9LCR7TWF0aC5yb3VuZChjb2xbMl0gKiAyNTUpfSwuMCkgMzUlLCByZ2JhKCR7TWF0aC5yb3VuZChjb2xbMF0gKiAyNTUpfSwke01hdGgucm91bmQoY29sWzFdICogMjU1KX0sJHtNYXRoLnJvdW5kKGNvbFsyXSAqIDI1NSl9LDEpIDEyMCUpYDtcbiAgICBlLnN0eWxlLnNldFByb3BlcnR5KCctLWZhJywgU3RyaW5nKGFscGhhKSk7IGUuc3R5bGUuYW5pbWF0aW9uID0gJ25vbmUnOyB2b2lkIGUub2Zmc2V0V2lkdGg7IGUuc3R5bGUuYW5pbWF0aW9uID0gYGZ4Zmxhc2ggJHtkdXJ9cyBlYXNlLW91dCBmb3J3YXJkc2A7XG4gIH1cbiAgc2V0TnVtYmVycyhvbjogYm9vbGVhbikgeyB0aGlzLm51bWJlcnNPbiA9IG9uOyBpZiAoIW9uKSB0aGlzLmxheWVyLnRleHRDb250ZW50ID0gJyc7IH1cblxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnRpbWVkLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHcgPSB0aGlzLnRpbWVkW2ldOyB3LnQgKz0gZHQ7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCB3LnQgLyB3LmR1cik7IHcuZm4odSk7IGlmICh1ID49IDEpIHsgdGhpcy50aW1lZC5zcGxpY2UoaSwgMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgICB0aGlzLmZsdXNoTnVtYmVycyhkdCk7XG4gICAgaWYgKHRoaXMuc2hha2VUID4gMCkgeyB0aGlzLnNoYWtlVCA9IE1hdGgubWF4KDAsIHRoaXMuc2hha2VUIC0gZHQpOyBjb25zdCBrID0gKHRoaXMuc2hha2VUIC8gdGhpcy5zaGFrZUR1cikgKiogMS41ICogdGhpcy5zaGFrZU1hZzsgdGhpcy5vZmYuc2V0KChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIDIgKiBrLCAoTWF0aC5yYW5kb20oKSAtIDAuNSkgKiAyICogayAqIDAuNywgKE1hdGgucmFuZG9tKCkgLSAwLjUpICogMiAqIGspOyB9IGVsc2UgdGhpcy5vZmYuc2V0KDAsIDAsIDApO1xuICB9XG4gIGNsZWFyKCkgeyB0aGlzLnBlbmRpbmcuY2xlYXIoKTsgdGhpcy5sYXllci50ZXh0Q29udGVudCA9ICcnOyB9XG59XG4iLCAiLy8gQWxsIHNvdW5kIGlzIHN5bnRoZXNpemVkIGluIHRoZSBicm93c2VyIHdpdGggdGhlIFdlYiBBdWRpbyBBUEk6IG5vIGF1ZGlvIGZpbGVzIHRvIGRvd25sb2FkLCBsaWNlbnNlIG9yIHNoaXAuXG4vLyBUd28gaW5kZXBlbmRlbnQgc3dpdGNoZXMgKG11c2ljLCBzb3VuZCBlZmZlY3RzKSwgc2F2ZWQgaW4gdGhlIHBsYXllcidzIHNhdmUuIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdGFwLCBzbyBub3RoaW5nIHN0YXJ0c1xuLy8gdW50aWwgdGhlIGZpcnN0IHRvdWNoL2NsaWNrIChgdW5sb2NrYCkuXG5pbXBvcnQgeyBsb2FkU2F2ZSwgdXBkYXRlU2V0dGluZ3MgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuXG5leHBvcnQgdHlwZSBTZnggPSAndGFwJyB8ICdzdW1tb24nIHwgJ21lcmdlJyB8ICdoaXQnIHwgJ2hpdEFycm93JyB8ICdzbWFzaCcgfCAnYXJyb3cnIHwgJ2RlYXRoJyB8ICdjYXN0JyB8ICd0YXVudCcgfCAnc2hvY2t3YXZlJyB8ICdyZXN1cnJlY3QnIHwgJ2hlYXJ0TG9zdCcgfCAndmljdG9yeScgfCAnZGVmZWF0JyB8ICdzdGFydCdcbiAgfCAndW5sb2NrJyB8ICdwYWNrQ2hhcmdlJyB8ICdwYWNrVGllclVwJyB8ICdwYWNrVGVhcicgfCAncGFja0ZhbicgfCAncGFja0ZsaXAnIHwgJ3BhY2tSYXJlJyB8ICdwYWNrRXBpYycgfCAncGFja0xlZ2VuZCcgfCAncGFja0NvbGxlY3QnO1xuZXhwb3J0IHR5cGUgTW9kZSA9ICdidWlsZCcgfCAnYmF0dGxlJztcblxuLy8gTXVzaWM6IEEgbWlub3IsIDgwIGJwbSwgZm91ciBiYXJzIGxvb3BpbmcgKEFtLCBGLCBDLCBFKS4gUm9vdCBub3RlIGZpcnN0LCB0aGVuIGNob3JkIHRvbmVzIChIeikuXG5jb25zdCBDSE9SRFM6IG51bWJlcltdW10gPSBbXG4gIFsxMTAsIDE2NC44MSwgMjIwLCAyNjEuNjMsIDMyOS42M10sXG4gIFs4Ny4zMSwgMTMwLjgxLCAxNzQuNjEsIDIyMCwgMjYxLjYzXSxcbiAgWzEzMC44MSwgMTk2LCAyNjEuNjMsIDMyOS42MywgMzkyXSxcbiAgWzgyLjQxLCAxMjMuNDcsIDE2NC44MSwgMjA3LjY1LCAyNDYuOTRdLFxuXTtcbmNvbnN0IEJFQVQgPSA2MCAvIDgwO1xuXG5jbGFzcyBBdWRpb0VuZ2luZSB7XG4gIHByaXZhdGUgY3R4OiBBdWRpb0NvbnRleHQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBtYXN0ZXIhOiBHYWluTm9kZTsgcHJpdmF0ZSBtdXNpY0J1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIHNmeEJ1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIG5vaXNlQnVmITogQXVkaW9CdWZmZXI7XG4gIG11c2ljID0gdHJ1ZTsgc2Z4ID0gdHJ1ZTsgbW9kZTogTW9kZSA9ICdidWlsZCc7XG4gIHByaXZhdGUgdGltZXIgPSAwOyBwcml2YXRlIG5leHRUID0gMDsgcHJpdmF0ZSBiZWF0ID0gMDsgcHJpdmF0ZSBzdGFtcHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcigpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB9XG5cbiAgcHJpdmF0ZSBzaWxlbnQ6IEhUTUxBdWRpb0VsZW1lbnQgfCBudWxsID0gbnVsbDsgcHJpdmF0ZSBwcmltZWQgPSBmYWxzZTtcbiAgLyoqIGlQaG9uZXMgbXV0ZSBXZWIgQXVkaW8gd2hlbiB0aGUgcmluZ2VyIHN3aXRjaCBpcyBvbiwgdW5sZXNzIHRoZSBwYWdlIGlzIHBsYXlpbmcgXCJyZWFsXCIgbWVkaWEuIEEgc2lsZW50IGxvb3BpbmcgPGF1ZGlvPiBlbGVtZW50IChwbHVzIHRoZVxuICAgKiAgYXVkaW9TZXNzaW9uIGhpbnQgb24gbmV3ZXIgaU9TKSBtb3ZlcyB0aGUgcGFnZSB0byB0aGUgcGxheWJhY2sgY2hhbm5lbCwgc28gdGhlIGdhbWUgaXMgaGVhcmQgZXZlbiB3aXRoIHRoZSBzd2l0Y2ggb24gc2lsZW50LiAqL1xuICBwcml2YXRlIHBsYXliYWNrQ2hhbm5lbCgpIHtcbiAgICB0cnkgeyBjb25zdCBhID0gKG5hdmlnYXRvciBhcyBhbnkpLmF1ZGlvU2Vzc2lvbjsgaWYgKGEpIGEudHlwZSA9ICdwbGF5YmFjayc7IH0gY2F0Y2ggeyAvKiBub3Qgc3VwcG9ydGVkICovIH1cbiAgICBpZiAodGhpcy5zaWxlbnQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbiA9IDQ0MSwgYnVmID0gbmV3IEFycmF5QnVmZmVyKDQ0ICsgbiAqIDIpLCB2ID0gbmV3IERhdGFWaWV3KGJ1ZiksIHN0ciA9IChvOiBudW1iZXIsIHQ6IHN0cmluZykgPT4geyBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspIHYuc2V0VWludDgobyArIGksIHQuY2hhckNvZGVBdChpKSk7IH07XG4gICAgICBzdHIoMCwgJ1JJRkYnKTsgdi5zZXRVaW50MzIoNCwgMzYgKyBuICogMiwgdHJ1ZSk7IHN0cig4LCAnV0FWRScpOyBzdHIoMTIsICdmbXQgJyk7IHYuc2V0VWludDMyKDE2LCAxNiwgdHJ1ZSk7IHYuc2V0VWludDE2KDIwLCAxLCB0cnVlKTsgdi5zZXRVaW50MTYoMjIsIDEsIHRydWUpO1xuICAgICAgdi5zZXRVaW50MzIoMjQsIDQ0MTAwLCB0cnVlKTsgdi5zZXRVaW50MzIoMjgsIDg4MjAwLCB0cnVlKTsgdi5zZXRVaW50MTYoMzIsIDIsIHRydWUpOyB2LnNldFVpbnQxNigzNCwgMTYsIHRydWUpOyBzdHIoMzYsICdkYXRhJyk7IHYuc2V0VWludDMyKDQwLCBuICogMiwgdHJ1ZSk7XG4gICAgICBjb25zdCBlbCA9IG5ldyBBdWRpbyhVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtidWZdLCB7IHR5cGU6ICdhdWRpby93YXYnIH0pKSk7IGVsLmxvb3AgPSB0cnVlOyBlbC52b2x1bWUgPSAwLjAxOyBlbC5zZXRBdHRyaWJ1dGUoJ3BsYXlzaW5saW5lJywgJycpOyB0aGlzLnNpbGVudCA9IGVsO1xuICAgICAgZWwucGxheSgpLmNhdGNoKCgpID0+IHsgdGhpcy5zaWxlbnQgPSBudWxsOyB9KTtcbiAgICB9IGNhdGNoIHsgLyogZmluZTogc291bmQgc3RpbGwgd29ya3MsIGp1c3QgZm9sbG93cyB0aGUgc2lsZW50IHN3aXRjaCAqLyB9XG4gIH1cbiAgLyoqIFdoYXQgdGhlIFNldHRpbmdzIHBhZ2Ugc2hvd3Mgc28gYSBzaWxlbnQgcGhvbmUgY2FuIGJlIGRpYWdub3NlZC4gKi9cbiAgc3RhdHVzKCk6IHsgc3RhdGU6IHN0cmluZzsgdW5sb2NrZWQ6IGJvb2xlYW4gfSB7IHJldHVybiB7IHN0YXRlOiB0aGlzLmN0eCA/IHRoaXMuY3R4LnN0YXRlIDogJ25vdCBzdGFydGVkJywgdW5sb2NrZWQ6ICEhdGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgPT09ICdydW5uaW5nJyB9OyB9XG4gIC8qKiBUaGUgU2V0dGluZ3MgcGFnZSdzIFRlc3Qgc291bmQgYnV0dG9uOiB1bmxvY2sgYW5kIG1ha2UgYSBjbGVhcmx5IGF1ZGlibGUgc291bmQuICovXG4gIHRlc3QoKSB7IHRoaXMudW5sb2NrKCk7IGNvbnN0IHQgPSAoKSA9PiB7IHRoaXMucGxheSgndmljdG9yeScpOyB9OyBpZiAodGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkudGhlbih0KS5jYXRjaCgoKSA9PiB7fSk7IGVsc2UgdCgpOyB9XG5cbiAgLyoqIENhbGwgZnJvbSBhIHVzZXIgZ2VzdHVyZSAodGFwL2NsaWNrKS4gU2FmZSB0byBjYWxsIHJlcGVhdGVkbHkuICovXG4gIHVubG9jaygpIHtcbiAgICB0aGlzLnBsYXliYWNrQ2hhbm5lbCgpO1xuICAgIGlmICghdGhpcy5jdHgpIHtcbiAgICAgIGNvbnN0IEMgPSAod2luZG93IGFzIGFueSkuQXVkaW9Db250ZXh0IHx8ICh3aW5kb3cgYXMgYW55KS53ZWJraXRBdWRpb0NvbnRleHQ7IGlmICghQykgcmV0dXJuO1xuICAgICAgY29uc3QgY3R4OiBBdWRpb0NvbnRleHQgPSB0aGlzLmN0eCA9IG5ldyBDKCk7XG4gICAgICBjb25zdCBjb21wID0gY3R4LmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvcigpOyBjb21wLmNvbm5lY3QoY3R4LmRlc3RpbmF0aW9uKTtcbiAgICAgIHRoaXMubWFzdGVyID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tYXN0ZXIuZ2Fpbi52YWx1ZSA9IDAuOTsgdGhpcy5tYXN0ZXIuY29ubmVjdChjb21wKTtcbiAgICAgIHRoaXMubXVzaWNCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm11c2ljQnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpOyB0aGlzLnNmeEJ1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMuc2Z4QnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpO1xuICAgICAgY3R4Lm9uc3RhdGVjaGFuZ2UgPSAoKSA9PiB7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tYXVkaW8tc3RhdGUnKSk7IH07XG4gICAgICBjb25zdCBsZW4gPSBjdHguc2FtcGxlUmF0ZTsgdGhpcy5ub2lzZUJ1ZiA9IGN0eC5jcmVhdGVCdWZmZXIoMSwgbGVuLCBjdHguc2FtcGxlUmF0ZSk7IGNvbnN0IGQgPSB0aGlzLm5vaXNlQnVmLmdldENoYW5uZWxEYXRhKDApOyBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKSBkW2ldID0gTWF0aC5yYW5kb20oKSAqIDIgLSAxO1xuICAgIH1cbiAgICBpZiAodGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkuY2F0Y2goKCkgPT4ge30pOyAgICAgICAgICAgICAvLyAnc3VzcGVuZGVkJyBvciAoaU9TKSAnaW50ZXJydXB0ZWQnXG4gICAgaWYgKCF0aGlzLnByaW1lZCkgeyB0aGlzLnByaW1lZCA9IHRydWU7IHRyeSB7IGNvbnN0IGIgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXIoMSwgMSwgMjIwNTApLCBzID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyU291cmNlKCk7IHMuYnVmZmVyID0gYjsgcy5jb25uZWN0KHRoaXMuY3R4LmRlc3RpbmF0aW9uKTsgcy5zdGFydCgwKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9IH1cbiAgICB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTtcbiAgfVxuXG4gIHNldE11c2ljKG9uOiBib29sZWFuKSB7IHRoaXMubXVzaWMgPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBtdXNpYzogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyB9XG4gIHNldFNmeChvbjogYm9vbGVhbikgeyB0aGlzLnNmeCA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IHNmeDogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyBpZiAob24pIHRoaXMucGxheSgndGFwJyk7IH1cbiAgLyoqIFJlLXJlYWQgdGhlIHNhdmVkIHN3aXRjaGVzICh0aGUgc2hlbGwncyBTZXR0aW5ncyBwYWdlIGNoYW5nZXMgdGhlbSB0b28pLiAqL1xuICByZWxvYWQoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IH1cbiAgc2V0TW9kZShtOiBNb2RlKSB7IHRoaXMubW9kZSA9IG07IH1cblxuICBwcml2YXRlIGFwcGx5R2FpbnMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuOyBjb25zdCB0ID0gdGhpcy5jdHguY3VycmVudFRpbWU7XG4gICAgdGhpcy5tdXNpY0J1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLm11c2ljID8gMC41IDogMCwgdCwgMC4xNSk7IHRoaXMuc2Z4QnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMuc2Z4ID8gMC44IDogMCwgdCwgMC4wNSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbXVzaWNcbiAgcHJpdmF0ZSBzeW5jTXVzaWMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLm11c2ljICYmICF0aGlzLnRpbWVyKSB7IHRoaXMubmV4dFQgPSB0aGlzLmN0eC5jdXJyZW50VGltZSArIDAuMTU7IHRoaXMudGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy50aWNrKCksIDIwMCk7IH1cbiAgICBpZiAoIXRoaXMubXVzaWMgJiYgdGhpcy50aW1lcikgeyBjbGVhckludGVydmFsKHRoaXMudGltZXIpOyB0aGlzLnRpbWVyID0gMDsgfVxuICB9XG4gIHByaXZhdGUgdGljaygpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7IGlmIChjdHguc3RhdGUgIT09ICdydW5uaW5nJykgeyB0aGlzLm5leHRUID0gY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgcmV0dXJuOyB9XG4gICAgd2hpbGUgKHRoaXMubmV4dFQgPCBjdHguY3VycmVudFRpbWUgKyAwLjYpIHsgdGhpcy5wbGF5QmVhdCh0aGlzLmJlYXQsIHRoaXMubmV4dFQpOyB0aGlzLm5leHRUICs9IEJFQVQ7IHRoaXMuYmVhdCA9ICh0aGlzLmJlYXQgKyAxKSAlIDE2OyB9XG4gIH1cbiAgcHJpdmF0ZSBwbGF5QmVhdChiZWF0OiBudW1iZXIsIHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGNob3JkID0gQ0hPUkRTW01hdGguZmxvb3IoYmVhdCAvIDQpXSwgaW5CYXIgPSBiZWF0ICUgNCwgYmF0dGxlID0gdGhpcy5tb2RlID09PSAnYmF0dGxlJztcbiAgICBpZiAoaW5CYXIgPT09IDApIGZvciAoY29uc3QgZiBvZiBjaG9yZCkgdGhpcy52b2ljZShmLCAndHJpYW5nbGUnLCB0LCBCRUFUICogNCArIDAuOCwgMC4wNDUsIDAuOSwgOTAwKTsgICAvLyBzbG93IHBhZFxuICAgIGlmIChpbkJhciA9PT0gMCB8fCBpbkJhciA9PT0gMikgdGhpcy52b2ljZShjaG9yZFswXSwgJ3NpbmUnLCB0LCBCRUFUICogMS42LCAwLjE2LCAwLjAyLCA0MDApOyAgICAgICAgICAvLyBiYXNzXG4gICAgaWYgKGJhdHRsZSkge1xuICAgICAgdGhpcy5raWNrKHQsIDAuMzIpOyBpZiAoaW5CYXIgPT09IDIpIHRoaXMua2ljayh0ICsgQkVBVCAqIDAuNSwgMC4xOCk7XG4gICAgICB0aGlzLm5vaXNlKHQgKyBCRUFUICogMC41LCAwLjA1LCAwLjA1LCAnaGlnaHBhc3MnLCA3MDAwKTsgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDEuNSAlIEJFQVQsIDAuMDUsIDAuMDMsICdoaWdocGFzcycsIDcwMDApO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAyOyBpKyspIHRoaXMudm9pY2UoY2hvcmRbMSArICgoYmVhdCAqIDIgKyBpKSAlIDQpXSAqIDIsICd0cmlhbmdsZScsIHQgKyBpICogQkVBVCAvIDIsIDAuMjIsIDAuMDUsIDAuMDA1LCAyNTAwKTsgICAvLyBwbHVjayBhcnBlZ2dpb1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHZvaWNlKGZyZXE6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgYXR0YWNrOiBudW1iZXIsIGxwOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS52YWx1ZSA9IGZyZXE7IGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBNYXRoLm1heCgwLjAwNSwgYXR0YWNrKSk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGtpY2sodDogbnVtYmVyLCBnYWluOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZSgxMzAsIHQpOyBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDQyLCB0ICsgMC4xNCk7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgMC4yKTtcbiAgICBvLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyAwLjI1KTtcbiAgfVxuICBwcml2YXRlIG5vaXNlKHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBidXM6IEdhaW5Ob2RlID0gdGhpcy5tdXNpY0J1cywgc3dlZXBUbz86IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbiA9IGN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgbi5idWZmZXIgPSB0aGlzLm5vaXNlQnVmOyBmLnR5cGUgPSB0eXBlOyBmLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHN3ZWVwVG8pIGYuZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc3dlZXBUbywgdCArIGR1cik7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG4uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QoYnVzKTsgbi5zdGFydCh0LCBNYXRoLnJhbmRvbSgpICogMC41KTsgbi5zdG9wKHQgKyBkdXIgKyAwLjAyKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzb3VuZCBlZmZlY3RzXG4gIHByaXZhdGUgdG9uZShmcmVxOiBudW1iZXIsIGR1cjogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZ2FpbjogbnVtYmVyLCBkZWxheSA9IDAsIHNsaWRlVG8/OiBudW1iZXIsIGF0dGFjayA9IDAuMDA1LCBscCA9IDgwMDApIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIHQgPSBjdHguY3VycmVudFRpbWUgKyBkZWxheSwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc2xpZGVUbykgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzbGlkZVRvLCB0ICsgZHVyKTtcbiAgICBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIGF0dGFjayk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLnNmeEJ1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBoaXNzKGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgZGVsYXkgPSAwLCBzd2VlcFRvPzogbnVtYmVyKSB7IHRoaXMubm9pc2UodGhpcy5jdHghLmN1cnJlbnRUaW1lICsgZGVsYXksIGR1ciwgZ2FpbiwgdHlwZSwgZnJlcSwgdGhpcy5zZnhCdXMsIHN3ZWVwVG8pOyB9XG4gIHByaXZhdGUgdGhyb3R0bGUoa2V5OiBzdHJpbmcsIG1zOiBudW1iZXIpIHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpOyBpZiAobiAtICh0aGlzLnN0YW1wc1trZXldIHx8IDApIDwgbXMpIHJldHVybiBmYWxzZTsgdGhpcy5zdGFtcHNba2V5XSA9IG47IHJldHVybiB0cnVlOyB9XG5cbiAgLyoqIEEgU291bCdzIHZvaWNlLCBzeW50aGVzaXplZDogc2tlbGV0b24gcmF0dGxlLCBhcmNoZXIgd2hpc3RsZSwgZ29ibGluIGNhY2tsZSwga25pZ2h0IGdydW50LCBvZ3JlIGdyb3dsLCBiYXJiYXJpYW4gcm9hci4gYGtgIHNoaWZ0cyB0aGUgcGl0Y2ggKGVuZW1pZXMgYSBsaXR0bGUgbG93ZXIpLCBgZGVsYXlgIHN0YWdnZXJzIGEgY2hvcnVzLiAqL1xuICBiYXJrKHNvdWw6IHN0cmluZywgZGVsYXkgPSAwLCBrID0gMSkge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuc2Z4IHx8IHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycgfHwgIXRoaXMudGhyb3R0bGUoJ2JhcmsnICsgc291bCwgMzUwKSkgcmV0dXJuO1xuICAgIGNvbnN0IFQgPSAoZjogbnVtYmVyLCBkOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCBnOiBudW1iZXIsIGRsOiBudW1iZXIsIHNsaWRlPzogbnVtYmVyLCBhdHQ/OiBudW1iZXIsIGxwPzogbnVtYmVyKSA9PiB0aGlzLnRvbmUoZiAqIGssIGQsIHR5cGUsIGcsIGRlbGF5ICsgZGwsIHNsaWRlID8gc2xpZGUgKiBrIDogdW5kZWZpbmVkLCBhdHQsIGxwKTtcbiAgICBjb25zdCBIID0gKGQ6IG51bWJlciwgZzogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmOiBudW1iZXIsIGRsOiBudW1iZXIsIHN3PzogbnVtYmVyKSA9PiB0aGlzLmhpc3MoZCwgZywgdHlwZSwgZiwgZGVsYXkgKyBkbCwgc3cpO1xuICAgIHN3aXRjaCAoc291bCkge1xuICAgICAgY2FzZSAnd2Fycmlvcic6IFswLCAwLjA2LCAwLjEyLCAwLjE5XS5mb3JFYWNoKChkbCkgPT4gSCgwLjAzLCAwLjE2LCAnaGlnaHBhc3MnLCAzNTAwLCBkbCkpOyBUKDUyMCwgMC4yMiwgJ3NxdWFyZScsIDAuMDcsIDAsIDI4MCwgMC4wMDUsIDE4MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2FyY2hlcic6IFQoOTAwLCAwLjE2LCAnc2luZScsIDAuMTMsIDAsIDEzNTAsIDAuMDEpOyBUKDEzNTAsIDAuMjIsICdzaW5lJywgMC4xMSwgMC4xNiwgNzYwLCAwLjAxKTsgYnJlYWs7XG4gICAgICBjYXNlICdnb2JsaW4nOiBbMCwgMC4xMSwgMC4yMl0uZm9yRWFjaCgoZGwsIGkpID0+IFQoNTAwICsgaSAqIDcwLCAwLjEsICdzYXd0b290aCcsIDAuMDksIGRsLCA2MjAgKyBpICogNzAsIDAuMDA1LCAyNjAwKSk7IEgoMC4zLCAwLjA1LCAnYmFuZHBhc3MnLCAyMjAwLCAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdrbmlnaHQnOiBUKDE1MCwgMC4zMiwgJ3Nhd3Rvb3RoJywgMC4xMiwgMCwgMTA1LCAwLjAyLCA5MDApOyBUKDIyNSwgMC4zLCAnc3F1YXJlJywgMC4wNSwgMC4wMiwgMTYwLCAwLjAyLCA5MDApOyBIKDAuMDgsIDAuMTIsICdoaWdocGFzcycsIDQ1MDAsIDAuMSk7IGJyZWFrO1xuICAgICAgY2FzZSAnb2dyZSc6IFQoNzUsIDAuNzUsICdzYXd0b290aCcsIDAuMiwgMCwgNTIsIDAuMDUsIDMyMCk7IFQoMTEyLCAwLjcsICdzYXd0b290aCcsIDAuMDgsIDAuMDMsIDgwLCAwLjA1LCA0MjApOyBIKDAuNiwgMC4xMiwgJ2xvd3Bhc3MnLCA0MjAsIDAuMDIsIDE0MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnYmFyYmFyaWFuJzogVCgxNzAsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4xNCwgMCwgMzQwLCAwLjAzLCAxNDAwKTsgVCgzNDAsIDAuNDUsICdzYXd0b290aCcsIDAuMDgsIDAuMSwgMjEwLCAwLjAzLCAxNjAwKTsgSCgwLjQ1LCAwLjEsICdiYW5kcGFzcycsIDkwMCwgMCwgNTAwKTsgYnJlYWs7XG4gICAgfVxuICB9XG4gIHBsYXkobmFtZTogU2Z4KSB7XG4gICAgaWYgKCF0aGlzLmN0eCB8fCAhdGhpcy5zZnggfHwgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgcmV0dXJuO1xuICAgIHN3aXRjaCAobmFtZSkge1xuICAgICAgY2FzZSAndGFwJzogaWYgKCF0aGlzLnRocm90dGxlKCd0YXAnLCA0MCkpIHJldHVybjsgdGhpcy50b25lKDc2MCwgMC4wNiwgJ3NpbmUnLCAwLjIyLCAwLCAxMTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzdW1tb24nOiB0aGlzLmhpc3MoMC40LCAwLjE0LCAnYmFuZHBhc3MnLCA1MDAsIDAsIDI1MDApOyB0aGlzLnRvbmUoMjIwLCAwLjQsICdzYXd0b290aCcsIDAuMSwgMCwgNjYwLCAwLjA1LCAxODAwKTsgdGhpcy50b25lKDEzMjAsIDAuMiwgJ3NpbmUnLCAwLjEsIDAuMTgpOyBicmVhaztcbiAgICAgIGNhc2UgJ21lcmdlJzogWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDgsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjM1LCAwLCA1MCk7IHRoaXMudG9uZSgxNTY4LCAwLjUsICdzaW5lJywgMC4wOCwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICdoaXQnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdCcsIDQ1KSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4wNywgMC4yNCwgJ2xvd3Bhc3MnLCAxODAwKTsgdGhpcy50b25lKDE3MCwgMC4wOSwgJ3NpbmUnLCAwLjIyLCAwLCA4MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0QXJyb3cnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdEEnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDUsIDAuMTQsICdiYW5kcGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNzAwLCAwLjA2LCAndHJpYW5nbGUnLCAwLjA2LCAwLCA0MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3NtYXNoJzogdGhpcy50b25lKDk1LCAwLjM4LCAnc2luZScsIDAuNSwgMCwgMzQpOyB0aGlzLmhpc3MoMC4zMiwgMC4zNSwgJ2xvd3Bhc3MnLCAxMDAwLCAwLCAyMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2Fycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdhcnJvdycsIDYwKSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4xNCwgMC4xLCAnYmFuZHBhc3MnLCAxODAwLCAwLCA0MjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdkZWF0aCc6IGlmICghdGhpcy50aHJvdHRsZSgnZGVhdGgnLCA3MCkpIHJldHVybjsgdGhpcy50b25lKDMwMCwgMC40LCAnc2F3dG9vdGgnLCAwLjE0LCAwLCA3MCwgMC4wMSwgOTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdjYXN0JzogdGhpcy50b25lKDMwMCwgMC40NSwgJ3NpbmUnLCAwLjE4LCAwLCA5MDAsIDAuMDUpOyB0aGlzLnRvbmUoNDUwLCAwLjQ1LCAnc2luZScsIDAuMSwgMC4wNSwgMTM1MCwgMC4wNSk7IHRoaXMudG9uZSgxODAwLCAwLjI1LCAnc2luZScsIDAuMDUsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndGF1bnQnOiB0aGlzLnRvbmUoMTk2LCAwLjUsICdzcXVhcmUnLCAwLjA4LCAwLCAxODAsIDAuMDMsIDcwMCk7IHRoaXMudG9uZSgxNDcsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4wOCwgMC4wMiwgMTQwLCAwLjAzLCA2MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3Nob2Nrd2F2ZSc6IHRoaXMudG9uZSgyMjAsIDEuMSwgJ3NpbmUnLCAwLjUsIDAsIDI4LCAwLjAyKTsgdGhpcy5oaXNzKDEuMCwgMC4zNSwgJ2xvd3Bhc3MnLCAzMDAwLCAwLCAxNTApOyB0aGlzLnRvbmUoODgwLCAwLjgsICdzaW5lJywgMC4wOCwgMCwgMjIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdyZXN1cnJlY3QnOiBbMjIwLCAyNzcsIDMzMCwgNDQwLCA1NTRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMSwgaSAqIDAuMTIsIGYgKiAxLjEyLCAwLjMpKTsgdGhpcy5oaXNzKDAuOSwgMC4wNiwgJ2hpZ2hwYXNzJywgNDUwMCwgMC4yKTsgYnJlYWs7XG4gICAgICBjYXNlICdoZWFydExvc3QnOiB0aGlzLnRvbmUoMTEwLCAwLjcsICdzYXd0b290aCcsIDAuMjgsIDAsIDUwLCAwLjAxLCA0NTApOyB0aGlzLmhpc3MoMC4xOCwgMC4yLCAnbG93cGFzcycsIDkwMCk7IHRoaXMudG9uZSgyMzMsIDAuNSwgJ3NxdWFyZScsIDAuMDUsIDAuMDIsIDIyMCwgMC4wMSwgNTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICd2aWN0b3J5JzogWzM5MiwgNDk0LCA1ODcsIDc4NF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMTEpKTsgdGhpcy50b25lKDE5NiwgMC45LCAnc2luZScsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVmZWF0JzogWzMzMCwgMjk0LCAyNDcsIDE5Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNywgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMjgsIGYgKiAwLjk3KSk7IHRoaXMudG9uZSg4MiwgMS42LCAnc2luZScsIDAuMywgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICd1bmxvY2snOiBbMC4zNSwgMC40NywgMC41OSwgMC43MV0uZm9yRWFjaCgoZCwgaSkgPT4geyB0aGlzLmhpc3MoMC4wNSwgMC4yMiwgJ2JhbmRwYXNzJywgOTAwICsgaSAqIDEyMCwgZCk7IHRoaXMudG9uZSgxNzAgKyBpICogMTIsIDAuMDcsICdzcXVhcmUnLCAwLjA2LCBkLCB1bmRlZmluZWQsIDAuMDAyLCA2MDApOyB9KTsgWzc4NCwgMTA0NiwgMTMxOF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNiwgJ3RyaWFuZ2xlJywgMC4xNiwgMS4xNSArIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDksICdoaWdocGFzcycsIDUwMDAsIDEuMik7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjI1LCAxLjE1LCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NoYXJnZSc6IHRoaXMudG9uZSg5MCwgMS4wNSwgJ3NpbmUnLCAwLjI1LCAwLCAyNjAsIDAuMik7IHRoaXMuaGlzcygwLjk1LCAwLjEyLCAnbG93cGFzcycsIDMwMCwgMCwgMjIwMCk7IHRoaXMudG9uZSgxODAsIDEuMCwgJ3RyaWFuZ2xlJywgMC4wNiwgMC4xLCA1MjAsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1RpZXJVcCc6IFs0NDAsIDU1NCwgNjU5LCA4ODBdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjQsICd0cmlhbmdsZScsIDAuMiwgaSAqIDAuMDYpKTsgdGhpcy50b25lKDE3NjAsIDAuNiwgJ3NpbmUnLCAwLjA5LCAwLjIpOyB0aGlzLmhpc3MoMC40LCAwLjEsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1RlYXInOiB0aGlzLmhpc3MoMC4zNSwgMC4zLCAnYmFuZHBhc3MnLCAxNTAwLCAwLCA2MDAwKTsgdGhpcy50b25lKDEyMCwgMC40NSwgJ3NpbmUnLCAwLjQsIDAuMDUsIDQwKTsgWzEwNDYsIDEzMTgsIDE1NjhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjYsICd0cmlhbmdsZScsIDAuMSwgMC4xMiArIGkgKiAwLjA1KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0Zhbic6IHRoaXMuaGlzcygwLjUsIDAuMSwgJ2hpZ2hwYXNzJywgMzAwMCk7IHRoaXMudG9uZSg2NjAsIDAuNDUsICdzaW5lJywgMC4xLCAwLCAxMzIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRmxpcCc6IHRoaXMuaGlzcygwLjA4LCAwLjE1LCAnYmFuZHBhc3MnLCAyNTAwKTsgdGhpcy50b25lKDUwMCwgMC4xMiwgJ3NpbmUnLCAwLjE0LCAwLCA4MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tSYXJlJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNzg0LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjQ1LCAndHJpYW5nbGUnLCAwLjE0LCAwLjA1ICsgaSAqIDAuMDkpKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRXBpYyc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjcsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA3KSk7IHRoaXMudG9uZSgxMTAsIDAuNSwgJ3NpbmUnLCAwLjMsIDAsIDYwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrTGVnZW5kJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNTIzLCA2NTksIDc4NCwgMTA0NiwgMTMxOF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDEuMSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMDgpKTsgdGhpcy50b25lKDgyLCAwLjksICdzaW5lJywgMC4zNSwgMCwgNTApOyB0aGlzLmhpc3MoMC44LCAwLjEsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgyMDkzLCAwLjcsICdzaW5lJywgMC4wNywgMC40KTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrQ29sbGVjdCc6IFs2NTksIDk4OF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuMzUsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAnc3RhcnQnOiB0aGlzLnRvbmUoMTQ3LCAwLjksICdzYXd0b290aCcsIDAuMTMsIDAsIDE1MCwgMC4xNSwgNjUwKTsgdGhpcy50b25lKDIyMCwgMC45LCAnc2F3dG9vdGgnLCAwLjA5LCAwLjA1LCAyMjQsIDAuMTUsIDY1MCk7IHRoaXMuaGlzcygwLjYsIDAuMDYsICdsb3dwYXNzJywgNjAwKTsgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBhdWRpbyA9IG5ldyBBdWRpb0VuZ2luZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fYXVkaW8gPSBhdWRpbztcblxuLy8gUGhvbmVzIG9ubHkgYWxsb3cgc291bmQgYWZ0ZXIgYSB0b3VjaDogdGhlIGZpcnN0IHRhcCBhbnl3aGVyZSB1bmxvY2tzIGl0LiBFdmVyeSBidXR0b24gYWxzbyBnZXRzIGEgc21hbGwgY2xpY2suXG4vLyBpT1Mgb25seSBhY2NlcHRzIGFuIHVubG9jayBmcm9tIGEgRklOSVNIRUQgdGFwICh0b3VjaGVuZCAvIGNsaWNrKSwgbm90IGZyb20gdGhlIHN0YXJ0IG9mIG9uZSwgc28gbGlzdGVuIHRvIGFsbCBvZiB0aGVtLlxuY29uc3QgdW5sb2NrT25jZSA9ICgpID0+IGF1ZGlvLnVubG9jaygpO1xuZm9yIChjb25zdCBldiBvZiBbJ3BvaW50ZXJkb3duJywgJ3BvaW50ZXJ1cCcsICd0b3VjaGVuZCcsICdjbGljaycsICdrZXlkb3duJ10pIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXYsIHVubG9ja09uY2UsIHsgY2FwdHVyZTogdHJ1ZSB9KTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgY29uc3QgZWwgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7IGlmIChlbCAmJiBlbC5jbG9zZXN0ICYmIGVsLmNsb3Nlc3QoJ2J1dHRvbiwgYS5idG4sIC5yYWlsIGEnKSkgYXVkaW8ucGxheSgndGFwJyk7IH0sIHRydWUpO1xuZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigndmlzaWJpbGl0eWNoYW5nZScsICgpID0+IHsgY29uc3QgYyA9IChhdWRpbyBhcyBhbnkpLmN0eCBhcyBBdWRpb0NvbnRleHQgfCBudWxsOyBpZiAoIWMpIHJldHVybjsgaWYgKGRvY3VtZW50LmhpZGRlbikgYy5zdXNwZW5kKCk7IGVsc2UgaWYgKGF1ZGlvLm11c2ljIHx8IGF1ZGlvLnNmeCkgYy5yZXN1bWUoKTsgfSk7XG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MtY2hhbmdlZCcsICgpID0+IGF1ZGlvLnJlbG9hZCgpKTtcbiIsICIvLyBTYXZpbmcgYSBydW4gaW4gcHJvZ3Jlc3Mgc28gaXQgc3Vydml2ZXMgYSBwYWdlIHJlbG9hZCAoU2FmYXJpIG9uIGEgcGhvbmUgY2FuIGRyb3AgdGhlIHBhZ2UgYXQgYW55IHRpbWUpLlxuLy8gT25seSBjYWxtIG1vbWVudHMgYXJlIHNhdmVkOiB0aGUgYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0LiBBIGJhdHRsZSBpbiBwcm9ncmVzcyBpcyBub3Qgc2F2ZWQ7IHJlbG9hZGluZyBkdXJpbmcgb25lIHB1dHMgeW91IGJhY2tcbi8vIGF0IHRoZSBidWlsZCBzY3JlZW4geW91IHByZXNzZWQgQmF0dGxlIGZyb20gKG5vdGhpbmcgbG9zdCwgbm90aGluZyBnYWluZWQpLiBFdmVyeXRoaW5nIHJlYWQgYmFjayBpcyB2YWxpZGF0ZWQ7IGFueXRoaW5nIG9kZCBpcyBpZ25vcmVkLlxuXG5pbXBvcnQgeyBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzLCBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUsIFVuaXQgfSBmcm9tICcuL3J1bGVzLnRzJztcbmltcG9ydCB7IGJyb3dzZXJTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0b3JlIH0gZnJvbSAnLi9zYXZlLnRzJztcblxuY29uc3QgS0VZID0gJ25lY3JvLXJ1bic7XG5jb25zdCBWRVJTSU9OID0gMTtcblxuZXhwb3J0IGludGVyZmFjZSBTZXJpYWxpemVkU3RhdGUge1xuICBydWxlczogUnVsZXM7IHJuZzogeyBzZWVkOiBudW1iZXI7IHBvczogbnVtYmVyIH07XG4gIHdhdmU6IG51bWJlcjsgaGVhcnRzOiBudW1iZXI7IGNhcDogbnVtYmVyOyBoYW5kOiBTb3VsSWRbXTsgdW5pdHM6IFVuaXRbXTsgbmV4dElkOiBudW1iZXI7IGRpc2NhcmRVc2VkOiBib29sZWFuO1xuICBzdGF0dXM6ICdidWlsZGluZyc7IGxvZzogc3RyaW5nW107IHN0YXRzOiBTdGF0ZVsnc3RhdHMnXTtcbn1cbmV4cG9ydCBpbnRlcmZhY2UgUnVuU25hcHNob3QgeyB2OiBudW1iZXI7IHNlZWQ6IG51bWJlcjsgYXR0ZW1wdDogbnVtYmVyOyBzdGFnZTogc3RyaW5nOyBkaWZmaWN1bHR5OiBzdHJpbmc7IHBoYXNlOiAnYnVpbGQnIHwgJ2RyYWZ0JzsgZHJhZnQ6IFNvdWxJZFtdIHwgbnVsbDsgc3RhdGU6IFNlcmlhbGl6ZWRTdGF0ZTsgc3RhcnRCZXN0PzogbnVtYmVyIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZVN0YXRlKHM6IFN0YXRlKTogU2VyaWFsaXplZFN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBydWxlczogSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzLnJ1bGVzKSksIHJuZzogeyBzZWVkOiBzLnJuZy5zZWVkLCBwb3M6IHMucm5nLnN0YXRlKCkgfSxcbiAgICB3YXZlOiBzLndhdmUsIGhlYXJ0czogcy5oZWFydHMsIGNhcDogcy5jYXAsIGhhbmQ6IHMuaGFuZC5zbGljZSgpLCB1bml0czogcy51bml0cy5tYXAoKHUpID0+ICh7IC4uLnUgfSkpLCBuZXh0SWQ6IHMubmV4dElkLCBkaXNjYXJkVXNlZDogcy5kaXNjYXJkVXNlZCxcbiAgICBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogcy5sb2cuc2xpY2UoLTQwKSwgc3RhdHM6IHsgLi4ucy5zdGF0cyB9LFxuICB9O1xufVxuXG5jb25zdCBpc1NvdWwgPSAoeDogYW55KTogeCBpcyBTb3VsSWQgPT4gU09VTFMuaW5jbHVkZXMoeCk7XG5jb25zdCBpbnQgPSAoeDogYW55LCBsbzogbnVtYmVyLCBoaTogbnVtYmVyKSA9PiBOdW1iZXIuaXNJbnRlZ2VyKHgpICYmIHggPj0gbG8gJiYgeCA8PSBoaTtcblxuLyoqIFJlYnVpbGQgYSBTdGF0ZSBmcm9tIHNhdmVkIGRhdGEsIG9yIG51bGwgaWYgYW55dGhpbmcgYWJvdXQgaXQgaXMgbm90IGJlbGlldmFibGUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVTdGF0ZSh4OiBhbnkpOiBTdGF0ZSB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHIgPSB4LnJ1bGVzO1xuICAgIGlmICghciB8fCAhQXJyYXkuaXNBcnJheShyLmN1cnZlKSB8fCAhci5jdXJ2ZS5sZW5ndGggfHwgIXIuY3VydmUuZXZlcnkoKG46IGFueSkgPT4gTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIubWVyZ2UgIT09ICdkZXBsb3llZE9ubHknICYmIHIubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoci5wb29sICE9PSB1bmRlZmluZWQgJiYgIShBcnJheS5pc0FycmF5KHIucG9vbCkgJiYgci5wb29sLmxlbmd0aCAmJiByLnBvb2wuZXZlcnkoaXNTb3VsKSkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHN0YWdlV2F2ZXMgPSByLnN0YWdlV2F2ZXMgPz8gci5jdXJ2ZS5sZW5ndGg7XG4gICAgaWYgKCFpbnQoeC53YXZlLCAxLCBNYXRoLm1pbihzdGFnZVdhdmVzLCByLmN1cnZlLmxlbmd0aCkpIHx8ICFpbnQoeC5oZWFydHMsIDEsIEhFQVJUUykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmNhcCkgfHwgeC5jYXAgPD0gMCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHguaGFuZCkgfHwgeC5oYW5kLmxlbmd0aCA+IDQwIHx8ICF4LmhhbmQuZXZlcnkoaXNTb3VsKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHgudW5pdHMpIHx8IHgudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFpbnQoeC5uZXh0SWQsIDEsIDFlNikgfHwgdHlwZW9mIHguZGlzY2FyZFVzZWQgIT09ICdib29sZWFuJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY2VsbHMgPSBuZXcgU2V0PG51bWJlcj4oKSwgaWRzID0gbmV3IFNldDxudW1iZXI+KCksIHVuaXRzOiBVbml0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgeC51bml0cykge1xuICAgICAgaWYgKCF1IHx8ICFpc1NvdWwodS5zb3VsKSB8fCAhaW50KHUuc3RhciwgMSwgTUFYX1NUQVIpIHx8ICFpbnQodS5jZWxsLCAwLCBHUklEX0NFTExTIC0gMSkgfHwgIWludCh1LmlkLCAxLCB4Lm5leHRJZCkgfHwgY2VsbHMuaGFzKHUuY2VsbCkgfHwgaWRzLmhhcyh1LmlkKSkgcmV0dXJuIG51bGw7XG4gICAgICBjZWxscy5hZGQodS5jZWxsKTsgaWRzLmFkZCh1LmlkKTsgdW5pdHMucHVzaCh7IGlkOiB1LmlkLCBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsLCBmcmVzaDogISF1LmZyZXNoIH0pO1xuICAgIH1cbiAgICBjb25zdCBzdCA9IHguc3RhdHM7XG4gICAgaWYgKCFzdCB8fCAhWydkcmF3bicsICdkaXNjYXJkZWQnLCAnZGlzbWlzc2VkJywgJ21lcmdlcycsICdmYWlsdXJlcyddLmV2ZXJ5KChrKSA9PiBOdW1iZXIuaXNGaW5pdGUoc3Rba10pKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF4LnJuZyB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5ybmcucG9zKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bGVzOiByIGFzIFJ1bGVzLCBybmc6IG1ha2VSbmcoeC5ybmcuc2VlZCwgeC5ybmcucG9zKSwgd2F2ZTogeC53YXZlLCBoZWFydHM6IHguaGVhcnRzLCBjYXA6IHguY2FwLCBoYW5kOiB4LmhhbmQuc2xpY2UoKSwgdW5pdHMsIG5leHRJZDogeC5uZXh0SWQsXG4gICAgICBkaXNjYXJkVXNlZDogeC5kaXNjYXJkVXNlZCwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IEFycmF5LmlzQXJyYXkoeC5sb2cpID8geC5sb2cuZmlsdGVyKChsOiBhbnkpID0+IHR5cGVvZiBsID09PSAnc3RyaW5nJykuc2xpY2UoLTQwKSA6IFtdLFxuICAgICAgc3RhdHM6IHsgZHJhd246IHN0LmRyYXduLCBkaXNjYXJkZWQ6IHN0LmRpc2NhcmRlZCwgZGlzbWlzc2VkOiBzdC5kaXNtaXNzZWQsIG1lcmdlczogc3QubWVyZ2VzLCBmYWlsdXJlczogc3QuZmFpbHVyZXMgfSxcbiAgICB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhdmVSdW4oc25hcDogUnVuU25hcHNob3QsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzbmFwKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDogdGhlIHJ1biBqdXN0IHdpbGwgbm90IHN1cnZpdmUgYSByZWxvYWQgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyUnVuKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUgJiYgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbSkgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbShLRVkpOyBlbHNlIGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksICcnKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG59XG5leHBvcnQgZnVuY3Rpb24gbG9hZFJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IHQgPSBzdG9yZSAmJiBzdG9yZS5nZXRJdGVtKEtFWSk7IGlmICghdCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgeCA9IEpTT04ucGFyc2UodCk7XG4gICAgaWYgKCF4IHx8IHgudiAhPT0gVkVSU0lPTiB8fCAoeC5waGFzZSAhPT0gJ2J1aWxkJyAmJiB4LnBoYXNlICE9PSAnZHJhZnQnKSB8fCAhTnVtYmVyLmlzRmluaXRlKHguc2VlZCkgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmF0dGVtcHQpIHx8IHR5cGVvZiB4LmRpZmZpY3VsdHkgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGF0ZSA9IGRlc2VyaWFsaXplU3RhdGUoeC5zdGF0ZSk7IGlmICghc3RhdGUpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGRyYWZ0ID0geC5waGFzZSA9PT0gJ2RyYWZ0JyAmJiBBcnJheS5pc0FycmF5KHguZHJhZnQpICYmIHguZHJhZnQubGVuZ3RoID09PSAzICYmIHguZHJhZnQuZXZlcnkoaXNTb3VsKSA/IHguZHJhZnQgOiBudWxsO1xuICAgIHJldHVybiB7IHNuYXA6IHsgdjogVkVSU0lPTiwgc2VlZDogeC5zZWVkLCBhdHRlbXB0OiB4LmF0dGVtcHQsIHN0YWdlOiB0eXBlb2YgeC5zdGFnZSA9PT0gJ3N0cmluZycgPyB4LnN0YWdlIDogJ2NyeXB0JywgZGlmZmljdWx0eTogeC5kaWZmaWN1bHR5LCBwaGFzZTogZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJywgZHJhZnQsIHN0YXRlOiB4LnN0YXRlLCBzdGFydEJlc3Q6IE51bWJlci5pc0ludGVnZXIoeC5zdGFydEJlc3QpICYmIHguc3RhcnRCZXN0ID49IDAgJiYgeC5zdGFydEJlc3QgPD0gOTk5OSA/IHguc3RhcnRCZXN0IDogdW5kZWZpbmVkIH0sIHN0YXRlIH07XG4gIH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxufVxuZXhwb3J0IGNvbnN0IFJVTl9WRVJTSU9OID0gVkVSU0lPTjtcbiIsICIvLyBFdmVyeXRoaW5nIHlvdSBTRUUgZm9yIGEgdW5pdDogcmVhbCBUcmlwbyBtb2RlbHMgKFNrZWxldG9uIFdhcnJpb3IsIFNrZWxldG9uIEFyY2hlciksIHNpbXBsZSBzdGFuZC1pbnMgZm9yIHRoZSBmb3VyXG4vLyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBnZW5lcmF0ZWQgeWV0LCBhbmQgdGhlIFwic3RhciBsb29rXCIgbGF5ZXJlZCBvbiB0b3Agb2YgYm90aCAoc2l6ZSwgdGludCwgYXVyYSwgaGFsbywgYmFkZ2UpLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5cbmV4cG9ydCB0eXBlIFZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhdGgnIHwgJ3NwYXduJyB8ICdjaGVlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbiArIHlhdyBoZXJlXG4gIHRlYW06IDAgfCAxOyBzdGFyOiBudW1iZXI7IHN0YXRlOiBWU3RhdGU7IHRvcDogbnVtYmVyO1xuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkPzogbnVtYmVyKTogdm9pZDtcbiAgc2V0U3RhcihzdGFyOiBudW1iZXIpOiB2b2lkO1xuICBjbGlwTmFtZXM/KCk6IHN0cmluZ1tdOyAgICAgICAgICAgIC8vIHRoZSBhbmltYXRpb25zIHRoaXMgdW5pdCBoYXMgKGZvciB0aGUgaW5zcGVjdCB2aWV3KVxuICBwcmV2aWV3Q2xpcD8obmFtZTogc3RyaW5nKTogdm9pZDsgIC8vIHBsYXkgb25lIG9mIHRoZW0gb25jZSwgdGhlbiBnbyBiYWNrIHRvIGlkbGVcbiAgc2V0Qm9zcz8ob246IGJvb2xlYW4pOiB2b2lkOyAgICAgICAvLyBhbiBlbmVteSBib3NzOiBiaWdnZXIsIHdpdGggYSBCT1NTIHRhZ1xuICBzZXRMZXZlbD8obGV2ZWw6IG51bWJlcik6IHZvaWQ7ICAgIC8vIHRoZSBwZXJtYW5lbnQgU291bCBsZXZlbCBzaG93biBiZXNpZGUgdGhlIGhlYWx0aCBiYXIgKHBsYXllciB1bml0cyBvbmx5KVxuICBzZXRUZWFtKHRlYW06IDAgfCAxKTogdm9pZDtcbiAgc2V0SHAoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7ICAvLyBudWxsIGhpZGVzIHRoZSBoZWFsdGggYmFyXG4gIHNldE1hbmEoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7IC8vIG51bGwgaGlkZXMgdGhlIG1hbmEgYmFyICh1bml0cyB3aXRob3V0IGEgc2tpbGwpXG4gIHB1bHNlKCk6IHZvaWQ7ICAgICAgICAgICAgICAgICAgICAgLy8gYnJpZWYgaGl0IHJlYWN0aW9uXG4gIHVwZGF0ZShkdDogbnVtYmVyKTogdm9pZDtcbiAgZGlzcG9zZSgpOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YXIgbG9va3Ncbi8vIDEgc3RhciA9IHRoZSBwbGFpbiBtb2RlbC4gMiBzdGFycyA9IGEgbGl0dGxlIGJpZ2dlciwgY29vbCBzaWx2ZXItYmx1ZSB0aW50LCBicmlnaHRlciBhdXJhLiAzIHN0YXJzID0gYmlnZ2VzdCwgd2FybSBnb2xkIHRpbnQsXG4vLyBhIHRhbGwgdmlvbGV0IGZsYW1lIGF1cmEgc3RyZWFtaW5nIG9mZiB0aGUgYm9keSwgcGx1cyBlbWJlcnMuIEV2ZXJ5dGhpbmcgaGVyZSBpcyBmcmVlOiBubyBleHRyYSBUcmlwbyBnZW5lcmF0aW9ucy5cbmNvbnN0IFRJTlQ6IG51bWJlcltdW10gPSBbWzEsIDEsIDFdLCBbMC44NiwgMC45NSwgMS4xOF0sIFsxLjI1LCAxLjEsIDAuN11dO1xuLy8gVGhlIE5lY3JvbWFuY2VyJ3MgaW5mbHVlbmNlLCBkcmF3biBhcyBlbmVyZ3kgc3RyZWFtaW5nIHVwIG9mZiB0aGUgYm9keTogd2lzcHMgb2YgdmlvbGV0IGZsYW1lIGh1Z2dpbmcgdGhlIHNpbGhvdWV0dGUuIEV2ZXJ5IHN0YXIgYWRkcyBtb3JlIG9mIGl0LFxuLy8gYnJpZ2h0ZXIgYW5kIHRhbGxlcjsgdGhyZWUgc3RhcnMgYWxzbyB0aHJvdyBlbWJlcnMuIHJhdGUgeCBsaWZlIG11c3Qgc3RheSB1bmRlciB0aGUgc3lzdGVtJ3MgY2FwYWNpdHkgKDgwKS5cbmNvbnN0IEFVUkEgPSBbXG4gIHsgcmF0ZTogMTQsIG1pbjogMC4wNywgbWF4OiAwLjEzLCBzeTogMi4wLCBsaWZlOiBbMC42LCAwLjldLCBwb3dlcjogWzAuMzUsIDAuN10sIHc6IDEuMTUsIGg6IDAuOCwgYzE6IFswLjc4LCAwLjM4LCAxLCAwLjZdLCBjMjogWzAuNDIsIDAuMTQsIDAuOTIsIDAuNDVdLCBlbWJlcnM6IDAgfSxcbiAgeyByYXRlOiAyNiwgbWluOiAwLjA5LCBtYXg6IDAuMTcsIHN5OiAyLjMsIGxpZmU6IFswLjY1LCAxLjBdLCBwb3dlcjogWzAuNDUsIDAuOV0sIHc6IDEuMjIsIGg6IDAuOSwgYzE6IFswLjkyLCAwLjUsIDEsIDAuOF0sIGMyOiBbMC41NSwgMC4yLCAxLCAwLjY1XSwgZW1iZXJzOiAwIH0sXG4gIHsgcmF0ZTogNDAsIG1pbjogMC4xMSwgbWF4OiAwLjIsIHN5OiAyLjYsIGxpZmU6IFswLjcsIDEuMV0sIHBvd2VyOiBbMC41NSwgMS4xXSwgdzogMS4zLCBoOiAxLjAsIGMxOiBbMSwgMC42OCwgMSwgMC45NV0sIGMyOiBbMC42MiwgMC4yMiwgMSwgMC44XSwgZW1iZXJzOiAxMiB9LFxuXTtcblxuZXhwb3J0IGludGVyZmFjZSBBc3NldHMge1xuICBzY2VuZTogYW55OyBzb2Z0OiBhbnk7IGx2VGV4OiBSZWNvcmQ8bnVtYmVyLCBhbnk+OyBzdGFyVGV4OiBhbnlbXTsgdHJpcG86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgVHJpcG9DZmc+PjsgZW1vdGU6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gIHJpbmdNYXQ6IGFueVtdOyBoYWxvTWF0OiBhbnk7IGJhckJnOiBhbnk7IGJhckZpbGw6IGFueVtdOyBtYW5hRmlsbDogYW55OyBhcnJvdz86IGFueTsgbmVjcm8/OiBhbnk7XG59XG4vKiogRmxhdm91ciBhIHVuaXQgY2FuIGhhdmU6IGEgY2xpcCBpdCBwbGF5cyBub3cgYW5kIHRoZW4gd2hlbiBpdCBoYXMgc3Rvb2QgaWRsZSBmb3IgYSB3aGlsZSwgYSBzbWFsbCBlbW90ZSwgYW5kIGFuIGV5ZS1nbG93IG1hc2sgKGV5ZXMgZGltIHdoZW4gc2xlZXB5LCBmbGFyZSB3aGVuIGl0IGZpZ2h0cykuICovXG4vKiogSWRsZSBjbGlwcyB3aGVyZSB0aGUgdW5pdCBtYWtlcyBhIG5vaXNlLiAqL1xuY29uc3QgVk9DQUwgPSBuZXcgU2V0KFsnUm9hcicsICdUaHVtcCcsICdTdG9tcCcsICdTbmlja2VyJywgJ1NjaGVtZScsICdCb2FzdCcsICdGbGV4JywgJ0RvdWJsZUJpY2VwcycsICdGdW1ibGUnLCAnU2hpZWxkQm9uaycsICdCb25rJ10pO1xuaW50ZXJmYWNlIFBvc2UgeyBjbGlwOiBzdHJpbmc7IGVtb3RlPzogc3RyaW5nIH1cbmludGVyZmFjZSBGbGF2b3IgeyBjbGlwczogUG9zZVtdOyBtaW46IG51bWJlcjsgbWF4OiBudW1iZXIgfVxuaW50ZXJmYWNlIFRyaXBvQ2ZnIHsgY29udGFpbmVyOiBhbnk7IGVuZW15VGV4OiBhbnk7IGNsaXBzOiBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+OyBtYXRDYWNoZTogUmVjb3JkPHN0cmluZywgYW55PjsgYmFzZU1hdD86IGFueTsgdG9wOiBudW1iZXI7IHNjYWxlOiBudW1iZXI7IGZsYXZvcj86IEZsYXZvcjsgY2hlZXJzPzogUG9zZVtdOyBzcGF3bkVtb3RlPzogc3RyaW5nOyBleWVzPzogc3RyaW5nOyBleWVUZXg/OiBhbnk7IHN0YXJTY2FsZT86IG51bWJlcltdIH1cblxuZnVuY3Rpb24gZHluKHNjZW5lOiBhbnksIHc6IG51bWJlciwgaDogbnVtYmVyLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkLCBhbHBoYSA9IHRydWUpIHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdkdCcsIHsgd2lkdGg6IHcsIGhlaWdodDogaCB9LCBzY2VuZSwgdHJ1ZSk7IGRyYXcodC5nZXRDb250ZXh0KCkpOyB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gYWxwaGE7IHJldHVybiB0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFzc2V0cyhzY2VuZTogYW55KTogUHJvbWlzZTxBc3NldHM+IHtcbiAgY29uc3Qgc29mdCA9IGR5bihzY2VuZSwgNjQsIDY0LCAoYykgPT4geyBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCgzMiwgMzIsIDAsIDMyLCAzMiwgMzIpOyBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgyNTUsMjU1LDI1NSwxKScpOyBnLmFkZENvbG9yU3RvcCgwLjQsICdyZ2JhKDI1NSwyNTUsMjU1LC41NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTsgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IH0pO1xuICBjb25zdCBzdGFyVGV4ID0gWzEsIDIsIDNdLm1hcCgobikgPT4gZHluKHNjZW5lLCAxOTIsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCA0MHB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlU3R5bGUgPSAnIzFhMTAyMCc7IGMuZmlsbFN0eWxlID0gbiA9PT0gMyA/ICcjZmZkMjRhJyA6IG4gPT09IDIgPyAnI2Q3ZTZmZicgOiAnI2YwZDlhMCc7IGNvbnN0IHMgPSAnXHUyNjA1Jy5yZXBlYXQobik7IGMuc3Ryb2tlVGV4dChzLCA5NiwgMzgpOyBjLmZpbGxUZXh0KHMsIDk2LCAzOCk7IH0pKTtcbiAgY29uc3QgZW1pc3NpdmUgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYSA9IDEpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2VtJywgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gIGNvbnN0IHJpbmdUZXggPSBkeW4oc2NlbmUsIDEyOCwgMTI4LCAoYykgPT4geyAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpbiBicmlnaHQgcmltLCBmYWludCBjZW50cmU6IGEgbWFnaWMgY2lyY2xlLCBub3QgYSBzcG90bGlnaHRcbiAgICBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCg2NCwgNjQsIDAsIDY0LCA2NCwgNjIpOyBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgyNTUsMjU1LDI1NSwwLjAzKScpOyBnLmFkZENvbG9yU3RvcCgwLjc4LCAncmdiYSgyNTUsMjU1LDI1NSwwLjA4KScpOyBnLmFkZENvbG9yU3RvcCgwLjg2LCAncmdiYSgyNTUsMjU1LDI1NSwwLjk1KScpOyBnLmFkZENvbG9yU3RvcCgwLjkzLCAncmdiYSgyNTUsMjU1LDI1NSwwLjU1KScpOyBnLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwwKScpO1xuICAgIGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCAxMjgsIDEyOCk7XG4gIH0pO1xuICBjb25zdCByaW5nTSA9IChyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdyaW5nbScsIHNjZW5lKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlmZnVzZVRleHR1cmUgPSByaW5nVGV4OyBtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgcmV0dXJuIG07IH07XG4gIGNvbnN0IEE6IEFzc2V0cyA9IHtcbiAgICBzY2VuZSwgc29mdCwgbHZUZXg6IHt9LCBzdGFyVGV4LCB0cmlwbzoge30sIGVtb3RlOiB7fSwgcmluZ01hdDogW3JpbmdNKDAuNjIsIDAuMjgsIDEpLCByaW5nTSgxLCAwLjMsIDAuMjUpXSwgaGFsb01hdDogZW1pc3NpdmUoMSwgMC44MiwgMC4zLCAwLjk1KSxcbiAgICBiYXJCZzogZW1pc3NpdmUoMC4wNSwgMC4wNSwgMC4wOCwgMC43KSwgYmFyRmlsbDogW2VtaXNzaXZlKDAuNTUsIDAuMzUsIDEpLCBlbWlzc2l2ZSgxLCAwLjQsIDAuMyldLCBtYW5hRmlsbDogZW1pc3NpdmUoMC4yNSwgMC43NSwgMSksXG4gIH07XG4gIC8vIFwiWnp6XCIgdGhhdCBmbG9hdHMgdXAgb3ZlciBhIHNsZWVweSB1bml0XG4gIGNvbnN0IHp6eiA9IGR5bihzY2VuZSwgMTI4LCAxMjgsIChjKSA9PiB7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gOTsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5maWxsU3R5bGUgPSAnI2U4ZDhmZic7IGMubGluZUpvaW4gPSAncm91bmQnO1xuICAgIGZvciAoY29uc3QgW2NoLCBzaXplLCB4LCB5XSBvZiBbWydaJywgNjQsIDM0LCAxMDBdLCBbJ3onLCA0OCwgNzQsIDY2XSwgWyd6JywgMzQsIDEwNCwgMzhdXSBhcyBbc3RyaW5nLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXVtdKSB7IGMuZm9udCA9ICdpdGFsaWMgOTAwICcgKyBzaXplICsgJ3B4IHNhbnMtc2VyaWYnOyBjLnN0cm9rZVRleHQoY2gsIHgsIHkpOyBjLmZpbGxUZXh0KGNoLCB4LCB5KTsgfSB9KTtcbiAgY29uc3Qgem0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd6enonLCBzY2VuZSk7IHptLmRpZmZ1c2VUZXh0dXJlID0genp6OyB6bS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHptLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyB6bS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB6bS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgQS5lbW90ZVsnenp6J10gPSB6bTtcbiAgY29uc3QgaWNvbiA9IChuYW1lOiBzdHJpbmcsIGRyYXc6IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHZvaWQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwobmFtZSwgc2NlbmUpOyBtLmRpZmZ1c2VUZXh0dXJlID0gZHluKHNjZW5lLCAxMjgsIDEyOCwgZHJhdyk7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IEEuZW1vdGVbbmFtZV0gPSBtOyB9O1xuICBjb25zdCBnbHlwaCA9IChjaDogc3RyaW5nLCBmaWxsOiBzdHJpbmcpID0+IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSAxMjsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7IGMuZmlsbFN0eWxlID0gZmlsbDsgYy5mb250ID0gJzkwMCAxMDRweCBzYW5zLXNlcmlmJzsgYy5zdHJva2VUZXh0KGNoLCA2NCwgMTAwKTsgYy5maWxsVGV4dChjaCwgNjQsIDEwMCk7IH07XG4gIGljb24oJz8nLCBnbHlwaCgnPycsICcjZmZlMjdhJykpOyBpY29uKCchJywgZ2x5cGgoJyEnLCAnI2ZmOWE3YScpKTtcbiAgaWNvbignc3dlYXQnLCAoYykgPT4geyBjLmxpbmVXaWR0aCA9IDg7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MzA0YSc7IGMuZmlsbFN0eWxlID0gJyM5ZmU0ZmYnOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbyg2NCwgMTQpOyBjLmJlemllckN1cnZlVG8oMTA0LCA2MiwgMTA0LCAxMDgsIDY0LCAxMTIpOyBjLmJlemllckN1cnZlVG8oMjQsIDEwOCwgMjQsIDYyLCA2NCwgMTQpOyBjLmNsb3NlUGF0aCgpOyBjLnN0cm9rZSgpOyBjLmZpbGwoKTsgfSk7XG4gIGljb24oJ3NwYXJrbGUnLCAoYykgPT4geyBjLmxpbmVXaWR0aCA9IDc7IGMuc3Ryb2tlU3R5bGUgPSAnIzNhMmEwNSc7IGMuZmlsbFN0eWxlID0gJyNmZmYyYTgnOyBjb25zdCBzdGFyID0gKHg6IG51bWJlciwgeTogbnVtYmVyLCByOiBudW1iZXIpID0+IHsgYy5iZWdpblBhdGgoKTsgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspIHsgY29uc3QgYSA9IGkgKiBNYXRoLlBJIC8gNCwgcnIgPSBpICUgMiA/IHIgKiAwLjI4IDogcjsgYy5saW5lVG8oeCArIE1hdGguc2luKGEpICogcnIsIHkgLSBNYXRoLmNvcyhhKSAqIHJyKTsgfSBjLmNsb3NlUGF0aCgpOyBjLnN0cm9rZSgpOyBjLmZpbGwoKTsgfTsgc3Rhcig1NiwgNzAsIDUwKTsgc3RhcigxMDIsIDI4LCAyMCk7IHN0YXIoMjYsIDI0LCAxNCk7IH0pO1xuICBjb25zdCBkZWZzOiBbU291bElkLCBzdHJpbmcsIHN0cmluZywgUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPiwgbnVtYmVyLCBudW1iZXIsIGFueT9dW10gPSBbXG4gICAgWyd3YXJyaW9yJywgJ1NrZWxldG9uV2Fycmlvci5nbGInLCAnU2tlbGV0b25XYXJyaW9yX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdUcmlwJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdCb25rJywgZW1vdGU6ICc/JyB9LCB7IGNsaXA6ICdXb2JibGUnLCBlbW90ZTogJ3N3ZWF0JyB9LCB7IGNsaXA6ICdXYXZlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdGdW1ibGUnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1NoaWVsZEJvbmsnLCBlbW90ZTogJz8nIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1dhdmUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1RyaXAnLCBlbW90ZTogJyEnIH1dLCBleWVzOiAnU2tlbGV0b25XYXJyaW9yX2V5ZXMucG5nJyB9XSxcbiAgICBbJ2FyY2hlcicsICdTa2VsZXRvbkFyY2hlci5nbGInLCAnU2tlbGV0b25BcmNoZXJfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ1Nob290JywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0ZsZXgnIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdGbGV4JywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdEb3VibGVCaWNlcHMnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvbmVDcmFjaycgfSwgeyBjbGlwOiAnQm93VHdpcmwnLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnRmxleCcsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRG91YmxlQmljZXBzJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb3dUd2lybCcsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdTa2VsZXRvbkFyY2hlcl9leWVzLnBuZycgfV0sXG4gICAgWydnb2JsaW4nLCAnR29ibGluLmdsYicsICdHb2JsaW5fZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wLCAwLjg1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1NjaGVtZScsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnUGVlaycsIGVtb3RlOiAnPycgfSwgeyBjbGlwOiAnU3BpbicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU25pY2tlcicsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogNiwgbWF4OiAxMiB9LCBjaGVlcnM6IFt7IGNsaXA6ICdDaGVlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU25pY2tlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU3BpbicsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdHb2JsaW5fZXllcy5wbmcnIH1dLFxuICAgIFsna25pZ2h0JywgJ0tuaWdodC5nbGInLCAnS25pZ2h0X2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnUG9zZScgfSwgMS4wLCAxLjA1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1NhbHV0ZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnQm9hc3QnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0FkbWlyZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnUHJheScsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogOCwgbWF4OiAxNSB9LCBjaGVlcnM6IFt7IGNsaXA6ICdQb3NlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdTYWx1dGUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvYXN0JywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdQcmF5JywgZW1vdGU6ICdzcGFya2xlJyB9XSwgZXllczogJ0tuaWdodF9leWVzLnBuZycgfV0sXG4gICAgWydiYXJiYXJpYW4nLCAnQmFyYmFyaWFuLmdsYicsICdCYXJiYXJpYW5fZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wLCAxLjA1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1JvYXInLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0NoZXN0QmVhdCcgfSwgeyBjbGlwOiAnU3RvbXAnLCBlbW90ZTogJyEnIH1dLCBtaW46IDcsIG1heDogMTMgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1JvYXInLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0NoZXN0QmVhdCcgfV0sIGV5ZXM6ICdCYXJiYXJpYW5fZXllcy5wbmcnIH1dLFxuICAgIFsnb2dyZScsICdPZ3JlLmdsYicsICdPZ3JlX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMDIsIDEuMTIsIHsgc3RhclNjYWxlOiBbMSwgMS4zLCAxLjY1XSwgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnWWF3bicsIGVtb3RlOiAnenp6JyB9LCB7IGNsaXA6ICdTaHJ1ZycgfSwgeyBjbGlwOiAnU3RvbXAnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1RodW1wJyB9XSwgbWluOiA5LCBtYXg6IDE2IH0sIGNoZWVyczogW3sgY2xpcDogJ0NoZWVyJyB9LCB7IGNsaXA6ICdUaHVtcCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnU3RvbXAnLCBlbW90ZTogJyEnIH1dLCBzcGF3bkVtb3RlOiAnenp6JywgZXllczogJ09ncmVfZXllcy5wbmcnIH1dLFxuICBdO1xuICBjb25zdCBuZWNyb1AgPSBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgJ05lY3JvbWFuY2VyLmdsYicsIHNjZW5lKS50aGVuKChjOiBhbnkpID0+IHsgQS5uZWNybyA9IGM7IH0pLmNhdGNoKCgpID0+IHsgLyogdGhlIGdhbWUgY2Fubm90IHNob3cgaGltICovIH0pO1xuICBjb25zdCBhcnJvd1AgPSBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgJ0Fycm93LmdsYicsIHNjZW5lKS50aGVuKChjOiBhbnkpID0+IHsgQS5hcnJvdyA9IGM7IH0pLmNhdGNoKCgpID0+IHsgLyogZmFsbHMgYmFjayB0byB0aGUgcGxhaW4gbGluZSAqLyB9KTtcbiAgYXdhaXQgUHJvbWlzZS5hbGwoW2Fycm93UCwgbmVjcm9QLCAuLi5kZWZzLm1hcChhc3luYyAoW3NvdWwsIGdsYiwgZW5lbXksIGNsaXBzLCB0b3AsIHNjYWxlLCBleHRyYV0pID0+IHtcbiAgICBjb25zdCBjb250YWluZXIgPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgZ2xiLCBzY2VuZSk7XG4gICAgQS50cmlwb1tzb3VsXSA9IHsgY29udGFpbmVyLCBlbmVteVRleDogbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBlbmVteSwgc2NlbmUsIGZhbHNlLCBmYWxzZSksIGNsaXBzLCBtYXRDYWNoZToge30sIHRvcCwgc2NhbGUsIC4uLihleHRyYSB8fCB7fSksIGV5ZVRleDogZXh0cmEgJiYgZXh0cmEuZXllcyA/IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy8nICsgZXh0cmEuZXllcywgc2NlbmUsIGZhbHNlLCBmYWxzZSkgOiB1bmRlZmluZWQgfTtcbiAgfSldKTtcbiAgcmV0dXJuIEE7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2hhcmVkIGRlY29yYXRpb25cbmNsYXNzIERlY28ge1xuICBwcml2YXRlIHBzOiBhbnkgPSBudWxsOyBwcml2YXRlIHBzMjogYW55ID0gbnVsbDsgcHJpdmF0ZSBhbmNob3I6IGFueSA9IG51bGw7IHByaXZhdGUgYmFkZ2U6IGFueTsgcHJpdmF0ZSBzdGFyczogYW55OyBwcml2YXRlIGZpbGw6IGFueTsgcHJpdmF0ZSBiYXI6IGFueTsgcHJpdmF0ZSBtYmc6IGFueTsgcHJpdmF0ZSBtZmlsbDogYW55OyBwcml2YXRlIHJpbmc6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgcGFyZW50OiBhbnksIHByaXZhdGUgdG9wOiBudW1iZXIsIHByaXZhdGUgcmFkaXVzOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZTtcbiAgICB0aGlzLnJpbmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZURpc2MoJ3JpbmcnLCB7IHJhZGl1czogTWF0aC5tYXgoMC4zLCByYWRpdXMgKiAxLjE1KSwgdGVzc2VsbGF0aW9uOiAyNiB9LCBzKTsgdGhpcy5yaW5nLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdGhpcy5yaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyB0aGlzLnJpbmcucGFyZW50ID0gcGFyZW50OyB0aGlzLnJpbmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMuYmFkZ2UgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdiYWRnZScsIHMpOyB0aGlzLmJhZGdlLnBhcmVudCA9IHBhcmVudDsgdGhpcy5iYWRnZS5wb3NpdGlvbi55ID0gdG9wICsgMC4zMjsgdGhpcy5iYWRnZS5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMO1xuICAgIHRoaXMuc3RhcnMgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdzdGFycycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjE1IH0sIHMpOyB0aGlzLnN0YXJzLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuc3RhcnMucG9zaXRpb24ueSA9IDAuMTE7IHRoaXMuc3RhcnMuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IHNtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnc20nLCBzKTsgc20uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IHNtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHNtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgdGhpcy5zdGFycy5tYXRlcmlhbCA9IHNtOyAodGhpcy5zdGFycyBhcyBhbnkpLl9zbSA9IHNtO1xuICAgIGNvbnN0IGJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnYmcnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4wODUgfSwgcyk7IGJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IGJnLm1hdGVyaWFsID0gQS5iYXJCZzsgYmcuaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmJhciA9IGJnO1xuICAgIHRoaXMuZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2ZpbGwnLCB7IHdpZHRoOiAwLjU2LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMuZmlsbC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLmZpbGwucG9zaXRpb24ueiA9IC0wLjAwMjsgdGhpcy5maWxsLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLm1iZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21iZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA1IH0sIHMpOyB0aGlzLm1iZy5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLm1iZy5wb3NpdGlvbi55ID0gLTAuMDc7IHRoaXMubWJnLm1hdGVyaWFsID0gQS5iYXJCZzsgdGhpcy5tYmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWZpbGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdtZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wMyB9LCBzKTsgdGhpcy5tZmlsbC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLm1maWxsLnBvc2l0aW9uLnNldCgwLCAtMC4wNywgLTAuMDAyKTsgdGhpcy5tZmlsbC5tYXRlcmlhbCA9IEEubWFuYUZpbGw7IHRoaXMubWZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubHYgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdsdicsIHsgd2lkdGg6IDAuMzYsIGhlaWdodDogMC4xMzUgfSwgcyk7IHRoaXMubHYucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5sdi5wb3NpdGlvbi5zZXQoLTAuNTIsIDAuMCwgMCk7IHRoaXMubHYuaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmx2LnNldEVuYWJsZWQoZmFsc2UpO1xuICAgIGNvbnN0IGxtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbHZtJywgcyk7IGxtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBsbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBsbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHRoaXMubHYubWF0ZXJpYWwgPSBsbTtcbiAgICB0aGlzLmJhci5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5maWxsLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1iZy5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBwcml2YXRlIGx2OiBhbnk7IHByaXZhdGUgbHZOID0gMDsgcHJpdmF0ZSBiYXJPbiA9IGZhbHNlOyBwcml2YXRlIHRhZzogYW55ID0gbnVsbDtcbiAgLyoqIEEgcmVkIEJPU1MgdGFnIGFib3ZlIHRoZSBzdGFycy4gKi9cbiAgc2V0Qm9zcyhvbjogYm9vbGVhbikge1xuICAgIGlmICghb24pIHsgaWYgKHRoaXMudGFnKSB0aGlzLnRhZy5zZXRFbmFibGVkKGZhbHNlKTsgcmV0dXJuOyB9XG4gICAgaWYgKCF0aGlzLnRhZykge1xuICAgICAgY29uc3QgQSA9IHRoaXMuQSwgdCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2Jvc3N0YWcnLCB7IHdpZHRoOiAwLjUsIGhlaWdodDogMC4xNyB9LCBBLnNjZW5lKTsgdC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0LnBvc2l0aW9uLnNldCgwLCAwLjI5LCAwKTsgdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnYm9zc3RhZ20nLCBBLnNjZW5lKTsgbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTtcbiAgICAgIG0uZGlmZnVzZVRleHR1cmUgPSBkeW4oQS5zY2VuZSwgMTkyLCA2NCwgKGMpID0+IHsgYy5mb250ID0gJzkwMCA0NnB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDg7IGMuc3Ryb2tlU3R5bGUgPSAnIzJhMDUwOCc7IGMuZmlsbFN0eWxlID0gJyNmZjViNGEnOyBjLmxpbmVKb2luID0gJ3JvdW5kJzsgYy5zdHJva2VUZXh0KCdCT1NTJywgOTYsIDQ4KTsgYy5maWxsVGV4dCgnQk9TUycsIDk2LCA0OCk7IH0pO1xuICAgICAgdC5tYXRlcmlhbCA9IG07IHRoaXMudGFnID0gdDtcbiAgICB9XG4gICAgdGhpcy50YWcuc2V0RW5hYmxlZCh0cnVlKTtcbiAgfVxuICAvKiogXCJMViBuXCIgYmVzaWRlIHRoZSBoZWFsdGggYmFyIChwZXJtYW5lbnQgU291bCBsZXZlbCk7IDAgaGlkZXMgaXQuICovXG4gIHNldExldmVsKG46IG51bWJlcikge1xuICAgIHRoaXMubHZOID0gbjsgaWYgKCF0aGlzLmx2KSByZXR1cm47IGlmIChuIDw9IDAgfHwgIXRoaXMuYmFyT24pIHsgdGhpcy5sdi5zZXRFbmFibGVkKGZhbHNlKTsgaWYgKG4gPiAwKSB0aGlzLmVuc3VyZUx2KG4pOyByZXR1cm47IH1cbiAgICB0aGlzLmVuc3VyZUx2KG4pOyB0aGlzLmx2LnNldEVuYWJsZWQodHJ1ZSk7XG4gIH1cbiAgcHJpdmF0ZSBlbnN1cmVMdihuOiBudW1iZXIpIHtcbiAgICBjb25zdCBBID0gdGhpcy5BOyBpZiAoIUEubHZUZXhbbl0pIEEubHZUZXhbbl0gPSBkeW4oQS5zY2VuZSwgMTI4LCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgMzRweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA2OyBjLnN0cm9rZVN0eWxlID0gJyMxNTBkMjYnOyBjLmZpbGxTdHlsZSA9ICcjZThkOGZmJzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7IGMuc3Ryb2tlVGV4dCgnTFYgJyArIG4sIDY0LCAzNik7IGMuZmlsbFRleHQoJ0xWICcgKyBuLCA2NCwgMzYpOyB9KTtcbiAgICAodGhpcy5sdi5tYXRlcmlhbCBhcyBhbnkpLmRpZmZ1c2VUZXh0dXJlID0gQS5sdlRleFtuXTtcbiAgfVxuICAvKiogVGhlIGJhcnMga2VlcCB0aGUgc2FtZSBzaXplIGFuZCB0aGUgc2FtZSBzbWFsbCBnYXAgYWJvdmUgdGhlIGhlYWQgaG93ZXZlciBiaWcgdGhlIHVuaXQgZ3Jvd3MuICovXG4gIGZpdChrOiBudW1iZXIpIHsgdGhpcy5iYWRnZS5zY2FsaW5nLnNldEFsbCgxIC8gayk7IHRoaXMuYmFkZ2UucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4zIC8gazsgfVxuICBzZXQodGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLkEuc2NlbmUsIGNmZyA9IEFVUkFbc3RhciAtIDFdO1xuICAgICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtLmRpZmZ1c2VUZXh0dXJlID0gdGhpcy5BLnN0YXJUZXhbc3RhciAtIDFdO1xuICAgIHRoaXMucmluZy5tYXRlcmlhbCA9IHRoaXMuQS5yaW5nTWF0W3RlYW1dOyB0aGlzLmZpbGwubWF0ZXJpYWwgPSB0aGlzLkEuYmFyRmlsbFt0ZWFtXTsgdGhpcy50ZWFtMCA9IHRlYW0gPT09IDA7XG4gICAgaWYgKHRlYW0gPT09IDApIHRoaXMuYXVyYShzdGFyKTsgZWxzZSB7IGlmICh0aGlzLnBzICYmIHRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RvcCgpOyBpZiAodGhpcy5wczIgJiYgdGhpcy5wczIuaXNTdGFydGVkKCkpIHRoaXMucHMyLnN0b3AoKTsgfVxuICB9XG4gIC8qKiBGbGFtZXMgaHVnZ2luZyB0aGUgYm9keSAodGFsbCBzb2Z0IHdpc3BzKSwgcGx1cyBlbWJlcnMgYXQgMyBzdGFycy4gKi9cbiAgcHJpdmF0ZSBhdXJhKHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLkEuc2NlbmUsIGNmZyA9IEFVUkFbc3RhciAtIDFdLCBSID0gTWF0aC5tYXgoMC4yNiwgdGhpcy5yYWRpdXMpICogMC45NSwgSCA9IHRoaXMudG9wOyBjb25zdCBDNCA9IChjOiBudW1iZXJbXSkgPT4gbmV3IEJBQllMT04uQ29sb3I0KGNbMF0sIGNbMV0sIGNbMl0sIGNbM10pO1xuICAgIGlmICghdGhpcy5hbmNob3IpIHsgdGhpcy5hbmNob3IgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdhdXJhQW5jaG9yJywgcyk7IHRoaXMuYW5jaG9yLnBhcmVudCA9IHRoaXMucGFyZW50OyB9XG4gICAgdGhpcy5hbmNob3IucG9zaXRpb24ueSA9IEggKiAwLjU7XG4gICAgaWYgKCF0aGlzLnBzKSB7XG4gICAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdhdXJhJywgODAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IHRoaXMuYW5jaG9yOyBwcy5pc0xvY2FsID0gdHJ1ZTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREO1xuICAgICAgdGhpcy5wcyA9IHBzOyAgICAgIC8vIChub3JtYWwgY2FtZXJhLWZhY2luZyBzcHJpdGVzIHN0cmV0Y2hlZCB0YWxsZXIgdGhhbiB3aWRlOiB0aGUgdmVsb2NpdHktc3RyZXRjaGVkIG1vZGUgZHJldyBvbmUgc2NyZWVuLXNpemVkIHNoZWV0IG9uIHNvbWUgR1BVcylcbiAgICB9XG4gICAgY29uc3QgcCA9IHRoaXMucHMsIHNwID0geyByOiBSICogY2ZnLncsIGg6IEggKiBjZmcuaCB9O1xuICAgIC8vIHN0YXJ0IG9uIHRoZSBib2R5J3Mgc2hlbGwgKGEgY3lsaW5kZXIgc3VyZmFjZSwgZmVldCB0byBoZWFkKSBhbmQgcmFkaWF0ZSBPVVQgZnJvbSBpdCwgY3VybGluZyB1cHdhcmQ6IGVuZXJneSBwb3VyaW5nIG9mZiB0aGUgYm9keSwgd2hpY2ggYWxzbyByZWFkcyBmcm9tIHRoZSB0b3AtZG93biBidWlsZCBjYW1lcmFcbiAgICBwLnBhcnRpY2xlRW1pdHRlclR5cGUgPSBuZXcgQkFCWUxPTi5DeWxpbmRlclBhcnRpY2xlRW1pdHRlcihzcC5yLCBzcC5oLCAwLCAwLjI1KTsgcC5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjU1LCAwKTtcbiAgICBwLmVtaXRSYXRlID0gY2ZnLnJhdGU7IHAubWluU2l6ZSA9IGNmZy5taW47IHAubWF4U2l6ZSA9IGNmZy5tYXg7IHAubWluU2NhbGVYID0gMC43OyBwLm1heFNjYWxlWCA9IDE7IHAubWluU2NhbGVZID0gY2ZnLnN5ICogMC44NTsgcC5tYXhTY2FsZVkgPSBjZmcuc3kgKiAxLjE1OyBwLm1pbkxpZmVUaW1lID0gY2ZnLmxpZmVbMF07IHAubWF4TGlmZVRpbWUgPSBjZmcubGlmZVsxXTtcbiAgICBwLm1pbkVtaXRQb3dlciA9IGNmZy5wb3dlclswXTsgcC5tYXhFbWl0UG93ZXIgPSBjZmcucG93ZXJbMV07IHAuY29sb3IxID0gQzQoY2ZnLmMxKTsgcC5jb2xvcjIgPSBDNChjZmcuYzIpOyBwLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjI1LCAwLjA0LCAwLjUsIDApO1xuICAgIGlmICghcC5pc1N0YXJ0ZWQoKSkgcC5zdGFydCgpO1xuICAgIGlmIChjZmcuZW1iZXJzKSB7XG4gICAgICBpZiAoIXRoaXMucHMyKSB7XG4gICAgICAgIGNvbnN0IGUgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnZW1iZXJzJywgMjQsIHMpOyBlLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBlLmVtaXR0ZXIgPSB0aGlzLmFuY2hvcjsgZS5pc0xvY2FsID0gdHJ1ZTsgZS5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7XG4gICAgICAgIGUubWluU2l6ZSA9IDAuMDQ7IGUubWF4U2l6ZSA9IDAuMDk7IGUubWluTGlmZVRpbWUgPSAxLjI7IGUubWF4TGlmZVRpbWUgPSAyLjA7IGUubWluRW1pdFBvd2VyID0gMC4yNTsgZS5tYXhFbWl0UG93ZXIgPSAwLjY7IGUuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMywgMSwgLTAuMyk7IGUuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4zLCAxLjQsIDAuMyk7XG4gICAgICAgIGUuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC4xNSwgMCk7IGUuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KDEsIDAuODUsIDEsIDEpOyBlLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjg1LCAwLjUsIDEsIDAuOSk7IGUuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuNCwgMC4xLCAwLjgsIDApOyB0aGlzLnBzMiA9IGU7XG4gICAgICB9XG4gICAgICB0aGlzLnBzMi5lbWl0UmF0ZSA9IGNmZy5lbWJlcnM7IHRoaXMucHMyLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC1zcC5yICogMS4xLCAtc3AuaCAqIDAuNSwgLXNwLnIgKiAxLjEpOyB0aGlzLnBzMi5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMyhzcC5yICogMS4xLCBzcC5oICogMC40LCBzcC5yICogMS4xKTsgaWYgKCF0aGlzLnBzMi5pc1N0YXJ0ZWQoKSkgdGhpcy5wczIuc3RhcnQoKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMucHMyICYmIHRoaXMucHMyLmlzU3RhcnRlZCgpKSB0aGlzLnBzMi5zdG9wKCk7XG4gIH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5iYXIuc2V0RW5hYmxlZChvbik7IHRoaXMuZmlsbC5zZXRFbmFibGVkKG9uKTsgdGhpcy5iYXJPbiA9IG9uOyBpZiAodGhpcy5sdikgdGhpcy5sdi5zZXRFbmFibGVkKG9uICYmIHRoaXMubHZOID4gMCk7XG4gICAgaWYgKG9uKSB7IGNvbnN0IGsgPSBNYXRoLm1heCgwLjAwMSwgZiBhcyBudW1iZXIpOyB0aGlzLmZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5maWxsLnBvc2l0aW9uLnggPSAtKDAuNTYgKiAoMSAtIGspKSAvIDI7IH1cbiAgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHtcbiAgICBjb25zdCBvbiA9IGYgIT09IG51bGw7IHRoaXMubWJnLnNldEVuYWJsZWQob24pOyB0aGlzLm1maWxsLnNldEVuYWJsZWQob24pO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5tZmlsbC5zY2FsaW5nLnggPSBrOyB0aGlzLm1maWxsLnBvc2l0aW9uLnggPSAtKDAuNTYgKiAoMSAtIGspKSAvIDI7IH1cbiAgfVxuICBzZXRBdXJhKG9uOiBib29sZWFuKSB7IGZvciAoY29uc3QgcSBvZiBbdGhpcy5wcywgdGhpcy5wczJdKSBpZiAocSAmJiAodGhpcy50ZWFtMCB8fCBxID09PSB0aGlzLnBzKSkgeyBpZiAob24gJiYgIXEuaXNTdGFydGVkKCkgJiYgdGhpcy50ZWFtMCkgcS5zdGFydCgpOyBpZiAoIW9uICYmIHEuaXNTdGFydGVkKCkpIHEuc3RvcCgpOyB9IH1cbiAgcHJpdmF0ZSB0ZWFtMCA9IGZhbHNlO1xuICB1cGRhdGUoX2R0OiBudW1iZXIpIHsgLyogdGhlIGZsYW1lcyBhbmltYXRlIHRoZW1zZWx2ZXMgKi8gfVxuICBkaXNwb3NlKCkgeyBpZiAodGhpcy5wcykgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKGZhbHNlKTsgfSBpZiAodGhpcy5wczIpIHsgdGhpcy5wczIuc3RvcCgpOyB0aGlzLnBzMi5kaXNwb3NlKGZhbHNlKTsgfSBpZiAodGhpcy5hbmNob3IpIHRoaXMuYW5jaG9yLmRpc3Bvc2UoKTsgW3RoaXMucmluZywgdGhpcy5zdGFycywgdGhpcy5iYXIsIHRoaXMuZmlsbCwgdGhpcy5tYmcsIHRoaXMubWZpbGxdLmZvckVhY2goKG0pID0+IG0gJiYgbS5kaXNwb3NlKCkpOyB0aGlzLmJhZGdlLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHJlYWwgbW9kZWxzXG5jbGFzcyBUcmlwb1Zpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSBlbnQ6IGFueTsgcHJpdmF0ZSBib2R5OiBhbnk7IHByaXZhdGUgYW5pbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTsgcHJpdmF0ZSBjdXI6IGFueSA9IG51bGw7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBiYXNlOiBudW1iZXI7XG4gIHByaXZhdGUgbGFzdEZsYXZvciA9ICcnOyBwcml2YXRlIHVpZCA9ICcnOyBwcml2YXRlIG93bjogYW55ID0gbnVsbDsgcHJpdmF0ZSBpZGxlVCA9IDA7IHByaXZhdGUgbmV4dEZsYXZvciA9IDFlOTsgcHJpdmF0ZSBmbGF2b3JPbiA9IGZhbHNlOyBwcml2YXRlIHF1ZXVlZCA9IGZhbHNlOyBwcml2YXRlIHNwYXduVCA9IDA7IHByaXZhdGUgZXllSyA9IDAuNjU7IHByaXZhdGUgZW1vdGVzOiB7IG06IGFueTsgdDogbnVtYmVyOyB5MDogbnVtYmVyIH1bXSA9IFtdO1xuICBwcml2YXRlIHNvdWxJZDogU291bElkO1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBjZmc6IFRyaXBvQ2ZnLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICB0aGlzLnNvdWxJZCA9IHNvdWw7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIHVpZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDcpOyB0aGlzLnVpZCA9IHVpZDtcbiAgICB0aGlzLmVudCA9IGNmZy5jb250YWluZXIuaW5zdGFudGlhdGVNb2RlbHNUb1NjZW5lKChuOiBzdHJpbmcpID0+IG4gKyAnXycgKyB1aWQsIGZhbHNlLCB7IGRvTm90SW5zdGFudGlhdGU6IHRydWUgfSk7XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd1bml0XycgKyB1aWQsIHMpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgdGhpcy5ib2R5ID0gdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZmluZCgobTogYW55KSA9PiBtLm5hbWUuaW5jbHVkZXMoJ19Cb2R5JykpO1xuICAgIGlmICghY2ZnLmJhc2VNYXQpIGNmZy5iYXNlTWF0ID0gdGhpcy5ib2R5Lm1hdGVyaWFsO1xuICAgIHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IHsgZy5zdG9wKCk7IGcuZW5hYmxlQmxlbmRpbmcgPSB0cnVlOyBnLmJsZW5kaW5nU3BlZWQgPSAwLjEyOyB0aGlzLmFuaW1zW2cubmFtZS5zcGxpdCgnXycpWzBdXSA9IGc7IH0pO1xuICAgIHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB9KTtcbiAgICB0aGlzLnRvcCA9IGNmZy50b3A7IHRoaXMuYmFzZSA9IGNmZy5zY2FsZTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICBpZiAoY2ZnLmZsYXZvcikgdGhpcy5uZXh0Rmxhdm9yID0gY2ZnLmZsYXZvci5taW4gKyBNYXRoLnJhbmRvbSgpICogKGNmZy5mbGF2b3IubWF4IC0gY2ZnLmZsYXZvci5taW4pO1xuICAgIHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgMC4zKTtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IDEuMywgZGlhbWV0ZXI6IDAuOCB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IDAuNjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLmlzUGlja2FibGUgPSB0cnVlO1xuICAgIHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gIH1cbiAgcHJpdmF0ZSBhcHBseU1hdCgpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLnRlYW0gKyAnXycgKyB0aGlzLnN0YXIsIGMgPSB0aGlzLmNmZztcbiAgICBpZiAoYy5leWVUZXgpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgdW5pdCBoYXMgZ2xvd2luZyBleWVzOiBpdCBnZXRzIGl0cyBvd24gbWF0ZXJpYWwgc28gaXRzIGdsb3cgY2FuIGNoYW5nZSBvbiBpdHMgb3duXG4gICAgICBpZiAoIXRoaXMub3duKSB7IHRoaXMub3duID0gYy5iYXNlTWF0LmNsb25lKCdvd25fJyArIHRoaXMudWlkKTsgdGhpcy5vd24uZW1pc3NpdmVUZXh0dXJlID0gYy5leWVUZXg7IHRoaXMub3duLmVtaXNzaXZlSW50ZW5zaXR5ID0gdGhpcy5leWVLOyB9XG4gICAgICB0aGlzLm93bi5hbGJlZG9UZXh0dXJlID0gdGhpcy50ZWFtID09PSAxID8gYy5lbmVteVRleCA6IGMuYmFzZU1hdC5hbGJlZG9UZXh0dXJlOyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgdGhpcy5vd24uYWxiZWRvQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjModFswXSwgdFsxXSwgdFsyXSk7XG4gICAgICB0aGlzLm93bi5lbWlzc2l2ZUNvbG9yID0gdGhpcy50ZWFtID09PSAxID8gbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNzIsIDAuMikgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC43OCwgMC4zLCAxKTtcbiAgICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IHRoaXMub3duOyByZXR1cm47XG4gICAgfVxuICAgIGlmICghYy5tYXRDYWNoZVtrZXldKSB7IGNvbnN0IG0gPSBjLmJhc2VNYXQuY2xvbmUoJ21fJyArIGtleSk7IGlmICh0aGlzLnRlYW0gPT09IDEpIG0uYWxiZWRvVGV4dHVyZSA9IGMuZW5lbXlUZXg7IGNvbnN0IHQgPSBUSU5UW3RoaXMuc3RhciAtIDFdOyBtLmFsYmVkb0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHRbMF0sIHRbMV0sIHRbMl0pOyBjLm1hdENhY2hlW2tleV0gPSBtOyB9XG4gICAgdGhpcy5ib2R5Lm1hdGVyaWFsID0gYy5tYXRDYWNoZVtrZXldO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuc2Moc3QpICogdGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgdGhpcy5kZWNvLmZpdCh0aGlzLnNjKHN0KSAqIHRoaXMuYmFzZSk7IH1cbiAgcHJpdmF0ZSBib3NzSyA9IDE7XG4gIC8qKiBUaGUgaW5zcGVjdCB2aWV3OiB3aGljaCBhbmltYXRpb25zIHRoaXMgdW5pdCBoYXMsIGFuZCBhIHdheSB0byBwbGF5IGFueSBvbmUgb2YgdGhlbS4gKi9cbiAgY2xpcE5hbWVzKCk6IHN0cmluZ1tdIHsgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuYW5pbXMpLmZpbHRlcigobikgPT4gbiAhPT0gJ1dhbGsnICYmIG4gIT09ICdIaXQnKTsgfVxuICBwcmV2aWV3Q2xpcChuYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tuYW1lXTsgaWYgKCFnKSByZXR1cm47XG4gICAgaWYgKG5hbWUgPT09ICdJZGxlJykgeyB0aGlzLnBsYXkoJ2lkbGUnKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5xdWV1ZWQgPSBmYWxzZTsgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGZhbHNlLCAxLCBnLmZyb20sIGcudG8pOyB0aGlzLmN1ciA9IGc7IHRoaXMuZmxhdm9yT24gPSB0cnVlOyB0aGlzLnN0YXRlID0gJ2lkbGUnOyB0aGlzLmlkbGVUID0gMDtcbiAgICBjb25zdCBwb3NlID0gWy4uLih0aGlzLmNmZy5mbGF2b3I/LmNsaXBzIHx8IFtdKSwgLi4uKHRoaXMuY2ZnLmNoZWVycyB8fCBbXSldLmZpbmQoKHApID0+IHAuY2xpcCA9PT0gbmFtZSk7XG4gICAgaWYgKHBvc2UgJiYgcG9zZS5lbW90ZSkgeyB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuNCk7IGlmIChwb3NlLmVtb3RlID09PSAnenp6JykgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAxLjIpOyB9XG4gICAgaWYgKFZPQ0FMLmhhcyhuYW1lKSB8fCBuYW1lID09PSAnQ2hlZXInIHx8IG5hbWUgPT09ICdBdHRhY2snKSBhdWRpby5iYXJrKHRoaXMuc291bElkLCAwLjIpO1xuICB9XG4gIHByaXZhdGUgc2Moc3Q6IG51bWJlcikgeyByZXR1cm4gKHRoaXMuY2ZnLnN0YXJTY2FsZSB8fCBCQUxBTkNFLnN0YXIuc2NhbGUpW3N0IC0gMV0gKiB0aGlzLmJvc3NLOyB9XG4gIHNldEJvc3Mob246IGJvb2xlYW4pIHsgdGhpcy5ib3NzSyA9IG9uID8gMS4zIDogMTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5zYyh0aGlzLnN0YXIpICogdGhpcy5iYXNlKTsgdGhpcy5kZWNvLmZpdCh0aGlzLnNjKHRoaXMuc3RhcikgKiB0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0Qm9zcyhvbik7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TGV2ZWwobjogbnVtYmVyKSB7IHRoaXMuZGVjby5zZXRMZXZlbChuKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkge1xuICAgIGxldCBjbGlwID0gdGhpcy5jZmcuY2xpcHNbc3RhdGVdLCBwb3NlOiBQb3NlIHwgdW5kZWZpbmVkO1xuICAgIGlmIChzdGF0ZSA9PT0gJ2NoZWVyJyAmJiB0aGlzLmNmZy5jaGVlcnMpIHsgcG9zZSA9IHRoaXMuY2ZnLmNoZWVyc1tNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0aGlzLmNmZy5jaGVlcnMubGVuZ3RoKV07IGNsaXAgPSBwb3NlLmNsaXA7IH1cbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tjbGlwXTsgaWYgKCFnKSByZXR1cm47IGNvbnN0IGxvb3AgPSBzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJztcbiAgICBpZiAoc3RhdGUgPT09ICdpZGxlJyAmJiB0aGlzLnN0YXRlID09PSAnc3Bhd24nICYmIHRoaXMuY3VyICYmIHRoaXMuY3VyLmlzU3RhcnRlZCAmJiB0aGlzLmNmZy5mbGF2b3IpIHsgdGhpcy5xdWV1ZWQgPSB0cnVlOyByZXR1cm47IH0gICAvLyBsZXQgdGhlIHdha2UtdXAgcGxheSB0byB0aGUgZW5kXG4gICAgaWYgKGxvb3AgJiYgdGhpcy5zdGF0ZSA9PT0gc3RhdGUgJiYgdGhpcy5jdXIgPT09IGcpIHJldHVybjtcbiAgICB0aGlzLnF1ZXVlZCA9IGZhbHNlOyB0aGlzLmZsYXZvck9uID0gZmFsc2U7IHRoaXMuaWRsZVQgPSAwO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChsb29wLCBzcGVlZCwgZy5mcm9tLCBnLnRvKTtcbiAgICBpZiAobG9vcCkgZy5nb1RvRnJhbWUoZy5mcm9tICsgTWF0aC5yYW5kb20oKSAqIChnLnRvIC0gZy5mcm9tKSk7XG4gICAgdGhpcy5jdXIgPSBnOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTtcbiAgICBpZiAocG9zZSAmJiBwb3NlLmVtb3RlKSB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuMzUpO1xuICAgIGlmIChzdGF0ZSA9PT0gJ3NwYXduJykgeyB0aGlzLnNwYXduVCA9IDA7IGlmICh0aGlzLmNmZy5zcGF3bkVtb3RlKSB7IHRoaXMuZW1vdGUodGhpcy5jZmcuc3Bhd25FbW90ZSwgMC4xKTsgdGhpcy5lbW90ZSh0aGlzLmNmZy5zcGF3bkVtb3RlLCAwLjcpOyB9IH1cbiAgfVxuICAvKiogQSBsaXR0bGUgcGljdHVyZSB0aGF0IGZsb2F0cyB1cCBvdmVyIHRoZSBoZWFkIGFuZCBmYWRlcyAoYSBzbGVlcHkgXCJaenpcIikuICovXG4gIHByaXZhdGUgZW1vdGUoa2luZDogc3RyaW5nLCBkZWxheSA9IDApIHtcbiAgICBjb25zdCBtYXQgPSB0aGlzLkEuZW1vdGVba2luZF07IGlmICghbWF0KSByZXR1cm47XG4gICAgY29uc3QgcGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdlbW8nLCB7IHNpemU6IDAuNDIgfSwgdGhpcy5BLnNjZW5lKTsgcGwucGFyZW50ID0gdGhpcy5ob2xkZXI7IHBsLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7IHBsLm1hdGVyaWFsID0gbWF0OyBwbC5pc1BpY2thYmxlID0gZmFsc2U7IHBsLnZpc2liaWxpdHkgPSAwO1xuICAgIGNvbnN0IHkwID0gdGhpcy50b3AgKyAwLjAyOyBwbC5wb3NpdGlvbi5zZXQoMC4xNiwgeTAsIDApOyB0aGlzLmVtb3Rlcy5wdXNoKHsgbTogcGwsIHQ6IC1kZWxheSwgeTAgfSk7XG4gIH1cbiAgLyoqIEFmdGVyIHN0YW5kaW5nIGlkbGUgZm9yIGEgd2hpbGU6IHBsYXkgdGhlIHVuaXQncyBmbGF2b3VyIGNsaXAgb25jZSAodGhlIE9ncmUgeWF3bnMpLCB0aGVuIGdvIGJhY2sgdG8gaWRsaW5nLiAqL1xuICBwcml2YXRlIHN0YXJ0Rmxhdm9yKCkge1xuICAgIGNvbnN0IGYgPSB0aGlzLmNmZy5mbGF2b3IhOyB0aGlzLmlkbGVUID0gMDtcbiAgICBsZXQgcG9vbCA9IGYuY2xpcHMuZmlsdGVyKChjKSA9PiBjLmNsaXAgIT09IHRoaXMubGFzdEZsYXZvciAmJiB0aGlzLmFuaW1zW2MuY2xpcF0pOyBpZiAoIXBvb2wubGVuZ3RoKSBwb29sID0gZi5jbGlwcy5maWx0ZXIoKGMpID0+IHRoaXMuYW5pbXNbYy5jbGlwXSk7IGlmICghcG9vbC5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCBwb3NlID0gcG9vbFtNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBwb29sLmxlbmd0aCldLCBnID0gdGhpcy5hbmltc1twb3NlLmNsaXBdOyB0aGlzLmxhc3RGbGF2b3IgPSBwb3NlLmNsaXA7XG4gICAgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGZhbHNlLCAxLCBnLmZyb20sIGcudG8pOyB0aGlzLmN1ciA9IGc7IHRoaXMuZmxhdm9yT24gPSB0cnVlOyB0aGlzLm5leHRGbGF2b3IgPSBmLm1pbiArIE1hdGgucmFuZG9tKCkgKiAoZi5tYXggLSBmLm1pbik7XG4gICAgaWYgKFZPQ0FMLmhhcyhwb3NlLmNsaXApKSBhdWRpby5iYXJrKHRoaXMuc291bElkLCAwLjI1KTtcbiAgICBpZiAocG9zZS5lbW90ZSkgeyB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuNCk7IGlmIChwb3NlLmVtb3RlID09PSAnenp6JykgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAxLjIpOyB9XG4gIH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLmRlY28udXBkYXRlKGR0KTtcbiAgICBpZiAodGhpcy5jdXIgJiYgIXRoaXMuY3VyLmlzU3RhcnRlZCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhIG9uZS1zaG90IGNsaXAgZmluaXNoZWRcbiAgICAgIGlmICh0aGlzLnF1ZXVlZCkgeyB0aGlzLnF1ZXVlZCA9IGZhbHNlOyB0aGlzLnBsYXkoJ2lkbGUnKTsgfSBlbHNlIGlmICh0aGlzLmZsYXZvck9uKSB7IHRoaXMuZmxhdm9yT24gPSBmYWxzZTsgdGhpcy5wbGF5KCdpZGxlJyk7IH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgdGhpcy5wbGF5KCdpZGxlJyk7XG4gICAgfVxuICAgIGlmICh0aGlzLmNmZy5mbGF2b3IgJiYgdGhpcy5zdGF0ZSA9PT0gJ2lkbGUnICYmICF0aGlzLmZsYXZvck9uICYmIHRoaXMuaG9sZGVyLmlzRW5hYmxlZCgpKSB7IHRoaXMuaWRsZVQgKz0gZHQ7IGlmICh0aGlzLmlkbGVUID49IHRoaXMubmV4dEZsYXZvcikgdGhpcy5zdGFydEZsYXZvcigpOyB9XG4gICAgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHRoaXMuc3Bhd25UICs9IGR0O1xuICAgIGZvciAobGV0IGkgPSB0aGlzLmVtb3Rlcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgZSA9IHRoaXMuZW1vdGVzW2ldOyBlLnQgKz0gZHQ7IGlmIChlLnQgPCAwKSBjb250aW51ZTsgY29uc3QgayA9IGUudCAvIDEuOTtcbiAgICAgIGlmIChrID49IDEpIHsgZS5tLmRpc3Bvc2UoKTsgdGhpcy5lbW90ZXMuc3BsaWNlKGksIDEpOyBjb250aW51ZTsgfVxuICAgICAgZS5tLnZpc2liaWxpdHkgPSBNYXRoLm1pbigxLCBlLnQgLyAwLjIpICogKDEgLSBrICogayk7IGUubS5wb3NpdGlvbi5zZXQoMC4xNiArIDAuMDUgKiBNYXRoLnNpbihlLnQgKiAzKSwgZS55MCArIGUudCAqIDAuMiwgMCk7IGUubS5zY2FsaW5nLnNldEFsbCgwLjcgKyAwLjUgKiBrKTtcbiAgICB9XG4gICAgaWYgKHRoaXMub3duKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGV5ZSBnbG93IGZvbGxvd3MgdGhlIG1vb2Q6IGRpbSB3aGVuIHNsZWVweSwgYnJpZ2h0IHdoZW4gYXdha2UsIGZsYXJpbmcgaW4gYSBmaWdodFxuICAgICAgbGV0IHRhcmdldCA9IDAuNjU7XG4gICAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgdGFyZ2V0ID0gMC4wOCArIDAuOTIgKiBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCAodGhpcy5zcGF3blQgLyAxLjY3IC0gMC40NSkgLyAwLjMpKTtcbiAgICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdpZGxlJykgdGFyZ2V0ID0gdGhpcy5mbGF2b3JPbiA/IDAuMjUgOiAwLjY1O1xuICAgICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHRhcmdldCA9IDEuMDsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2F0dGFjaycpIHRhcmdldCA9IDEuNzsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgdGFyZ2V0ID0gMS40OyBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB0YXJnZXQgPSAwLjA1O1xuICAgICAgdGhpcy5leWVLICs9ICh0YXJnZXQgLSB0aGlzLmV5ZUspICogTWF0aC5taW4oMSwgZHQgKiA3KTsgdGhpcy5vd24uZW1pc3NpdmVJbnRlbnNpdHkgPSB0aGlzLmV5ZUs7XG4gICAgfVxuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5zYyh0aGlzLnN0YXIpICogdGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmVtb3Rlcy5mb3JFYWNoKChlKSA9PiBlLm0uZGlzcG9zZSgpKTsgaWYgKHRoaXMub3duKSB0aGlzLm93bi5kaXNwb3NlKCk7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IGcuZGlzcG9zZSgpKTsgdGhpcy5lbnQuc2tlbGV0b25zLmZvckVhY2goKHM6IGFueSkgPT4gcy5kaXNwb3NlKCkpOyB0aGlzLnBpY2suZGlzcG9zZSgpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0uZGlzcG9zZShmYWxzZSwgZmFsc2UpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFuZC1pbnNcbmNvbnN0IFBIOiBSZWNvcmQ8c3RyaW5nLCB7IGNvbDogc3RyaW5nOyB3OiBudW1iZXI7IGg6IG51bWJlcjsgaGVhZDogbnVtYmVyOyB3ZWFwb246IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9PiA9IHtcbiAgZ29ibGluOiB7IGNvbDogJyM2M2IxM2YnLCB3OiAwLjM2LCBoOiAwLjQyLCBoZWFkOiAwLjM2LCB3ZWFwb246ICdkYWdnZXInLCBsYWJlbDogJ0dPQkxJTicgfSxcbiAga25pZ2h0OiB7IGNvbDogJyM4ZWE5ZGMnLCB3OiAwLjUsIGg6IDAuNiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnc2hpZWxkJywgbGFiZWw6ICdLTklHSFQnIH0sXG4gIG9ncmU6IHsgY29sOiAnI2E4YTY0YScsIHc6IDAuODUsIGg6IDAuODUsIGhlYWQ6IDAuNDIsIHdlYXBvbjogJ21hY2UnLCBsYWJlbDogJ09HUkUnIH0sXG4gIGJhcmJhcmlhbjogeyBjb2w6ICcjZDY4YTU1JywgdzogMC41MiwgaDogMC42MiwgaGVhZDogMC4zOCwgd2VhcG9uOiAnYXhlJywgbGFiZWw6ICdCQVJCQVJJQU4nIH0sXG59O1xuY2xhc3MgUGxhY2Vob2xkZXJWaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgcmlnOiBhbnk7IHByaXZhdGUgbGVnczogYW55W10gPSBbXTsgcHJpdmF0ZSB3cDogYW55OyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHQgPSBNYXRoLnJhbmRvbSgpICogNjsgcHJpdmF0ZSBzdDAgPSAwOyBwcml2YXRlIGR1ciA9IDE7IHByaXZhdGUgYmFzZSA9IDE7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBtYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGJvZHk6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgc291bDogc3RyaW5nLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIGQgPSBQSFtzb3VsXTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3BoXycgKyBzb3VsLCBzKTsgdGhpcy5yaWcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdyaWcnLCBzKTsgdGhpcy5yaWcucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgY29uc3QgbWF0ID0gKGhleDogc3RyaW5nLCBlbSA9IDApID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3BtJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhoZXgpLnNjYWxlKDAuNzIpOyBtLnNwZWN1bGFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xLCAwLjEsIDAuMSk7IGlmIChlbSkgbS5lbWlzc2l2ZUNvbG9yID0gbS5kaWZmdXNlQ29sb3Iuc2NhbGUoZW0pOyByZXR1cm4gbTsgfTtcbiAgICBjb25zdCBsZWdIID0gMC4yMiwgYm9keVkgPSBsZWdIICsgZC5oIC8gMjtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgbGcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdsZWcnLCBzKTsgbGcucGFyZW50ID0gdGhpcy5yaWc7IGxnLnBvc2l0aW9uLnNldChzeCAqIGQudyAqIDAuMjIsIGxlZ0gsIDApOyBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignbCcsIHsgaGVpZ2h0OiBsZWdILCBkaWFtZXRlcjogZC53ICogMC4yOCB9LCBzKTsgbS5wYXJlbnQgPSBsZzsgbS5wb3NpdGlvbi55ID0gLWxlZ0ggLyAyOyBtLm1hdGVyaWFsID0gbWF0KCcjNGEzODI2Jyk7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmxlZ3MucHVzaChsZyk7IH1cbiAgICB0aGlzLmJvZHkgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUNhcHN1bGUoJ2JvZHknLCB7IHJhZGl1czogZC53IC8gMiwgaGVpZ2h0OiBkLmggKyBkLncgKiAwLjQgfSwgcyk7IHRoaXMuYm9keS5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy5ib2R5LnBvc2l0aW9uLnkgPSBib2R5WTsgdGhpcy5ib2R5Lm1hdGVyaWFsID0gbWF0KGQuY29sKTsgdGhpcy5ib2R5LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBoZWFkID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2hlYWQnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAxLjUsIHNlZ21lbnRzOiAxMiB9LCBzKTsgaGVhZC5wYXJlbnQgPSB0aGlzLnJpZzsgaGVhZC5wb3NpdGlvbi55ID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDAuNTU7IGhlYWQubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyBoZWFkLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBleWVNID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZXllJywgcyk7IGV5ZU0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZXllTS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgKHRoaXMgYXMgYW55KS5leWVNID0gZXllTTtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgZSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdlJywgeyBkaWFtZXRlcjogZC5oZWFkICogMC4zIH0sIHMpOyBlLnBhcmVudCA9IHRoaXMucmlnOyBlLnBvc2l0aW9uLnNldChzeCAqIGQuaGVhZCAqIDAuMywgaGVhZC5wb3NpdGlvbi55ICsgMC4wMiwgZC5oZWFkICogMC42Nik7IGUubWF0ZXJpYWwgPSBleWVNOyBlLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIC8vIHdlYXBvbiBwaXZvdCBhdCB0aGUgc2hvdWxkZXIsIG9uIHRoZSBjaGFyYWN0ZXIncyByaWdodCAoLXggaXMgZmluZSBmb3IgYSBzdGFuZC1pbilcbiAgICB0aGlzLndwID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnd3AnLCBzKTsgdGhpcy53cC5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy53cC5wb3NpdGlvbi5zZXQoZC53ICogMC42LCBsZWdIICsgZC5oICogMC44NSwgMC4wNSk7XG4gICAgY29uc3Qgd20gPSBtYXQoJyM3YTVhMzAnKSwgaXJvbiA9IG1hdCgnIzlhYTFhZCcpO1xuICAgIGNvbnN0IG1rID0gKG06IGFueSwga2luZDogc3RyaW5nLCBkaW1zOiBhbnksIHBvczogbnVtYmVyW10sIG10OiBhbnkpID0+IHsgY29uc3QgeCA9IGtpbmQgPT09ICdib3gnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVCb3goJ3cnLCBkaW1zLCBzKSA6IGtpbmQgPT09ICdjeWwnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigndycsIGRpbXMsIHMpIDogQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ3cnLCBkaW1zLCBzKTsgeC5wYXJlbnQgPSB0aGlzLndwOyB4LnBvc2l0aW9uLnNldChwb3NbMF0sIHBvc1sxXSwgcG9zWzJdKTsgeC5tYXRlcmlhbCA9IG10OyB4LmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIHg7IH07XG4gICAgaWYgKGQud2VhcG9uID09PSAnZGFnZ2VyJykgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDUsIGhlaWdodDogMC4zLCBkZXB0aDogMC4wMyB9LCBbMCwgLTAuMiwgMC4xMl0sIGlyb24pO1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ3NoaWVsZCcpIHsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDYsIGhlaWdodDogMC41LCBkZXB0aDogMC4wNCB9LCBbMCwgLTAuMywgMC4xNF0sIGlyb24pOyBjb25zdCBzaCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3NoJywgeyBoZWlnaHQ6IDAuMDUsIGRpYW1ldGVyOiAwLjU1IH0sIHMpOyBzaC5wYXJlbnQgPSB0aGlzLnJpZzsgc2gucm90YXRpb24ueiA9IE1hdGguUEkgLyAyOyBzaC5wb3NpdGlvbi5zZXQoLWQudyAqIDAuNywgbGVnSCArIGQuaCAqIDAuNiwgMC4wNSk7IHNoLm1hdGVyaWFsID0gbWF0KCcjZDhiNjRhJyk7IHNoLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ21hY2UnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC45LCBkaWFtZXRlcjogMC4wOCB9LCBbMCwgLTAuMzUsIDAuM10sIHdtKTsgbWsoMCwgJ3NwaCcsIHsgZGlhbWV0ZXI6IDAuNCB9LCBbMCwgLTAuODUsIDAuNF0sIGlyb24pOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnYXhlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuNiwgZGlhbWV0ZXI6IDAuMDUgfSwgWzAsIC0wLjIsIDAuMTVdLCB3bSk7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjMyLCBoZWlnaHQ6IDAuMjIsIGRlcHRoOiAwLjA1IH0sIFswLCAtMC41LCAwLjE1XSwgaXJvbik7IGNvbnN0IGhhaXIgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdoYWlyJywgeyBoZWlnaHQ6IDAuMywgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiBkLmhlYWQgKiAxLjIgfSwgcyk7IGhhaXIucGFyZW50ID0gdGhpcy5yaWc7IGhhaXIucG9zaXRpb24ueSA9IGhlYWQucG9zaXRpb24ueSArIGQuaGVhZCAqIDAuNzU7IGhhaXIubWF0ZXJpYWwgPSBtYXQoJyNjMjJhMWMnKTsgaGFpci5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICB0aGlzLnRvcCA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAxLjM1OyB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIGQudyAqIDAuNyk7XG4gICAgY29uc3QgbGJsID0gZHluKHMsIDI1NiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDI2cHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMuZmlsbFN0eWxlID0gJyNmZmZmZmYnOyBjLnN0cm9rZVN0eWxlID0gJyMxMTEnOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IGMuZmlsbFRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyB9KTtcbiAgICBjb25zdCBscCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2xibCcsIHsgd2lkdGg6IDEuMSwgaGVpZ2h0OiAwLjIgfSwgcyk7IGxwLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBscC5wb3NpdGlvbi55ID0gLTAuMTsgbHAucm90YXRpb24ueCA9IE1hdGguUEkgLyAyICogMC4wOyBscC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBjb25zdCBsbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2xtJywgcyk7IGxtLmRpZmZ1c2VUZXh0dXJlID0gbGJsOyBsbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBscC5tYXRlcmlhbCA9IGxtOyBscC5pc1BpY2thYmxlID0gZmFsc2U7IGxwLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuNjI7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiB0aGlzLnRvcCwgZGlhbWV0ZXI6IE1hdGgubWF4KDAuNywgZC53ICogMS4zKSB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IHRoaXMudG9wIC8gMjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICAgICh0aGlzIGFzIGFueSkucGFydHMgPSBbbHBdOyB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5wbGF5KCdpZGxlJyk7XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyAodGhpcyBhcyBhbnkpLmV5ZU0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYmFzZSA9IEJBTEFOQ0Uuc3Rhci5zY2FsZVtzdCAtIDFdOyBjb25zdCB0ID0gVElOVFtzdCAtIDFdOyB0aGlzLmJvZHkubWF0ZXJpYWwuZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhQSFt0aGlzLnNvdWxdLmNvbCkuc2NhbGUoMC43MikubXVsdGlwbHkobmV3IEJBQllMT04uQ29sb3IzKE1hdGgubWluKDEsIHRbMF0pLCBNYXRoLm1pbigxLCB0WzFdKSwgTWF0aC5taW4oMSwgdFsyXSkpKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgdGhpcy5kZWNvLmZpdCh0aGlzLmJhc2UpOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldExldmVsKG46IG51bWJlcikgeyB0aGlzLmRlY28uc2V0TGV2ZWwobik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHsgaWYgKHN0YXRlID09PSB0aGlzLnN0YXRlICYmIChzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJykpIHJldHVybjsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLnN0MCA9IHRoaXMudDsgdGhpcy5kdXIgPSBzdGF0ZSA9PT0gJ2F0dGFjaycgPyAoQkFMQU5DRS5zdGF0c1t0aGlzLnNvdWwgYXMgU291bElkXS5hbmltTGVuIC8gc3BlZWQpIDogc3RhdGUgPT09ICdkZWF0aCcgPyAwLjYgOiBzdGF0ZSA9PT0gJ3NwYXduJyA/IDAuOSA6IDEuMDsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpOyB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0OyB0aGlzLmRlY28udXBkYXRlKGR0KTsgY29uc3QgcCA9IE1hdGgubWluKDEsICh0aGlzLnQgLSB0aGlzLnN0MCkgLyB0aGlzLmR1ciksIFIgPSB0aGlzLnJpZywgVyA9IHRoaXMud3A7XG4gICAgUi5wb3NpdGlvbi5zZXQoMCwgMCwgMCk7IFIucm90YXRpb24uc2V0KDAsIDAsIDApOyBSLnNjYWxpbmcuc2V0QWxsKDEpOyBXLnJvdGF0aW9uLnggPSAtMC40OyB0aGlzLmxlZ3MuZm9yRWFjaCgobCkgPT4gKGwucm90YXRpb24ueCA9IDApKTtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ2lkbGUnKSBSLnBvc2l0aW9uLnkgPSBNYXRoLnNpbih0aGlzLnQgKiAyLjIpICogMC4wMTI7XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHsgY29uc3QgdyA9IHRoaXMudCAqIDEwOyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih3KSkgKiAwLjA3OyBSLnJvdGF0aW9uLnggPSAwLjI7IHRoaXMubGVnc1swXS5yb3RhdGlvbi54ID0gTWF0aC5zaW4odykgKiAwLjk7IHRoaXMubGVnc1sxXS5yb3RhdGlvbi54ID0gLU1hdGguc2luKHcpICogMC45OyBXLnJvdGF0aW9uLnggPSAtMC40ICsgTWF0aC5zaW4odykgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnYXR0YWNrJykgeyBjb25zdCBrID0gcCA8IDAuNCA/IC0yLjQgKiAocCAvIDAuNCkgOiAtMi40ICsgMy40ICogTWF0aC5taW4oMSwgKHAgLSAwLjQpIC8gMC4yNSk7IFcucm90YXRpb24ueCA9IGs7IFIucG9zaXRpb24ueiA9IDAuMTQgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IFIucm90YXRpb24ueCA9IDAuMTUgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB7IGNvbnN0IGUgPSBwICogcCAqICgzIC0gMiAqIHApOyBSLnNjYWxpbmcuc2V0QWxsKDAuMDEgKyAwLjk5ICogZSk7IFIucG9zaXRpb24ueSA9IChlIC0gMSkgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB7IGNvbnN0IGUgPSBwICogcDsgUi5yb3RhdGlvbi54ID0gLU1hdGguUEkgLyAyICogZTsgUi5wb3NpdGlvbi55ID0gMC4yNSAqIGU7IFIucG9zaXRpb24ueiA9IC0wLjIgKiBlOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgeyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih0aGlzLnQgKiA3KSkgKiAwLjE1OyBXLnJvdGF0aW9uLnggPSAtMi42OyB9XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmlzdWFsKEE6IEFzc2V0cywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKTogVW5pdFZpc3VhbCB7XG4gIGNvbnN0IGNmZyA9IEEudHJpcG9bc291bF07XG4gIHJldHVybiBjZmcgPyBuZXcgVHJpcG9WaXN1YWwoQSwgY2ZnLCBzb3VsLCB0ZWFtLCBzdGFyKSA6IG5ldyBQbGFjZWhvbGRlclZpc3VhbChBLCBzb3VsLCB0ZWFtLCBzdGFyKTtcbn1cbmV4cG9ydCBjb25zdCBpc1RyaXBvID0gKEE6IEFzc2V0cywgc291bDogU291bElkKSA9PiAhIUEudHJpcG9bc291bF07XG4iLCAiLy8gVGhlIGdhbWUncyBpY29uIHNldCAoY3VzdG9tIGFydCwgc2xpY2VkIGZyb20gUGlwZWxpbmUvaWNvbnMvc2hlZXRfKi5wbmcgYnkgUGlwZWxpbmUvYmxlbmRlci9zbGljZV9pY29ucy5weSAtPiBkb2NzL2Fzc2V0cy9pY29ucy8qLnBuZykuXG4vLyBTaGFyZWQgYnkgdGhlIDNEIGdhbWUncyBET00gKHZhbmlsbGEpIGFuZCB0aGUgQW5ndWxhciBzaGVsbC4gTm8gZW1vamkgYW55d2hlcmU6IGV2ZXJ5IGdseXBoIGluIHRoZSBVSSBpcyBvbmUgb2YgdGhlc2UgaW1hZ2VzLlxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSYXJpdHkgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcblxuZXhwb3J0IHR5cGUgSWNvbk5hbWUgPVxuICB8ICdob21lJyB8ICdzb3VscycgfCAnc2hvcCcgfCAnc2V0dGluZ3MnIHwgJ2Nsb3NlJ1xuICB8ICdoZWFydCcgfCAnaGVhcnRfZW1wdHknIHwgJ2RvbWluaW9uJyB8ICdzdGFyJyB8ICdsb2NrJ1xuICB8ICd3YXJyaW9yJyB8ICdhcmNoZXInIHwgJ2dvYmxpbicgfCAna25pZ2h0JyB8ICdvZ3JlJyB8ICdiYXJiYXJpYW4nXG4gIHwgJ2dlbV9jb21tb24nIHwgJ2dlbV9yYXJlJyB8ICdnZW1fZXBpYycgfCAnZ2VtX2xlZ2VuZGFyeSdcbiAgfCAnbXVzaWMnIHwgJ3NvdW5kX29uJyB8ICdzb3VuZF9vZmYnIHwgJ3VwZ3JhZGUnIHwgJ3N3YXAnXG4gIHwgJ21lcmdlJyB8ICdyZW1vdmUnIHwgJ2NoZWNrJyB8ICdiYWNrJyB8ICdpbmZvJyB8ICdnb2xkJztcblxuLyoqIFJlbGF0aXZlIHRvIHRoZSBwYWdlLCBzbyBpdCB3b3JrcyBvbiBHaXRIdWIgUGFnZXMgdW5kZXIgL3JlcG8tbmFtZS8uICovXG5leHBvcnQgY29uc3QgaWNvblVybCA9IChuOiBJY29uTmFtZSk6IHN0cmluZyA9PiAnYXNzZXRzL2ljb25zLycgKyBuICsgJy5wbmcnO1xuLyoqIEFuIDxpbWc+IGFzIGFuIEhUTUwgc3RyaW5nLCBmb3IgdGhlIGdhbWUncyBoYW5kLWJ1aWx0IERPTS4gKi9cbmV4cG9ydCBjb25zdCBpY29uSW1nID0gKG46IEljb25OYW1lLCBjbHMgPSAnaWMnKTogc3RyaW5nID0+IGA8aW1nIGNsYXNzPVwiJHtjbHN9XCIgc3JjPVwiJHtpY29uVXJsKG4pfVwiIGFsdD1cIlwiIGRyYWdnYWJsZT1cImZhbHNlXCI+YDtcblxuLyoqIEVhY2ggU291bCBpcyBzaG93biBieSBpdHMgd2VhcG9uL3JvbGUgaWNvbiB1bnRpbCByZWFsIHBvcnRyYWl0cyBleGlzdC4gKi9cbmV4cG9ydCBjb25zdCBTT1VMX0lDT046IFJlY29yZDxTb3VsSWQsIEljb25OYW1lPiA9IHsgd2FycmlvcjogJ3dhcnJpb3InLCBhcmNoZXI6ICdhcmNoZXInLCBnb2JsaW46ICdnb2JsaW4nLCBrbmlnaHQ6ICdrbmlnaHQnLCBvZ3JlOiAnb2dyZScsIGJhcmJhcmlhbjogJ2JhcmJhcmlhbicgfTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfR0VNOiBSZWNvcmQ8UmFyaXR5LCBJY29uTmFtZT4gPSB7IGNvbW1vbjogJ2dlbV9jb21tb24nLCByYXJlOiAnZ2VtX3JhcmUnLCBlcGljOiAnZ2VtX2VwaWMnLCBsZWdlbmRhcnk6ICdnZW1fbGVnZW5kYXJ5JyB9O1xuXG4vKiogUGFjayB0aWVycyBhcmUgc2hvd24gYXMgc2t1bGxzIChuZXZlciBzdGFyczogc3RhcnMgbWVhbiBhbiBpbi1ydW4gbWVyZ2UgbGV2ZWwpLiAqL1xuZXhwb3J0IGNvbnN0IHNrdWxsSW1ncyA9IChuOiBudW1iZXIsIGNscyA9ICdzaycpOiBzdHJpbmcgPT4gaWNvbkltZygnc291bHMnLCBjbHMpLnJlcGVhdChNYXRoLm1heCgxLCBuKSk7XG5leHBvcnQgY29uc3QgaGVhcnRzSHRtbCA9IChoZWFydHM6IG51bWJlciwgbWF4ID0gMyk6IHN0cmluZyA9PiBpY29uSW1nKCdoZWFydCcsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBoZWFydHMpKSArIGljb25JbWcoJ2hlYXJ0X2VtcHR5JywgJ2ljIGhlYXJ0JykucmVwZWF0KE1hdGgubWF4KDAsIG1heCAtIGhlYXJ0cykpO1xuLyoqIEEgbnVtYmVyIHdpdGggdGhvdXNhbmRzIHNlcGFyYXRvcnMgKGdvbGQgZ2V0cyBiaWcpOiAxMjUwMCAtPiBcIjEyLDUwMFwiLiAqL1xuZXhwb3J0IGNvbnN0IGZtdCA9IChuOiBudW1iZXIpOiBzdHJpbmcgPT4gTWF0aC5yb3VuZChuKS50b0xvY2FsZVN0cmluZygnZW4tVVMnKTtcbiIsICIvLyBSZW5kZXJlZCBTb3VsIHBvcnRyYWl0cyAoUGlwZWxpbmUvYmxlbmRlci9yZW5kZXJfcG9ydHJhaXQucHksIGhlYWQtYW5kLXNob3VsZGVycyBtb2RlKSwgc2hhcmVkIGJ5IHRoZSBBbmd1bGFyIHBhZ2VzIGFuZCB0aGUgYmF0dGxlIHNjcmVlbi5cbi8vIFNvdWxzIHdpdGhvdXQgYSBwb3J0cmFpdCB5ZXQgZmFsbCBiYWNrIHRvIHRoZWlyIHJvbGUgaWNvbiBvbiBhIGNvbG91cmVkIGNhcmQuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgeyBSQVJJVFlfT0YgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcbmltcG9ydCB0eXBlIHsgUmFyaXR5IH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5pbXBvcnQgeyBTT1VMX0lDT04sIGljb25VcmwgfSBmcm9tICcuL2ljb25zLnRzJztcblxuY29uc3QgUE9SVFJBSVQ6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgc3RyaW5nPj4gPSB7IHdhcnJpb3I6ICdhc3NldHMvcG9ydHJhaXRzL3dhcnJpb3JfaGVhZC5wbmcnLCBhcmNoZXI6ICdhc3NldHMvcG9ydHJhaXRzL2FyY2hlcl9oZWFkLnBuZycsIG9ncmU6ICdhc3NldHMvcG9ydHJhaXRzL29ncmVfaGVhZC5wbmcnLCBnb2JsaW46ICdhc3NldHMvcG9ydHJhaXRzL2dvYmxpbl9oZWFkLnBuZycsIGtuaWdodDogJ2Fzc2V0cy9wb3J0cmFpdHMva25pZ2h0X2hlYWQucG5nJywgYmFyYmFyaWFuOiAnYXNzZXRzL3BvcnRyYWl0cy9iYXJiYXJpYW5faGVhZC5wbmcnIH07XG5jb25zdCBSQVJJVFlfSEVYOiBSZWNvcmQ8UmFyaXR5LCBzdHJpbmc+ID0geyBjb21tb246ICcjYjhjMGNjJywgcmFyZTogJyM0YWEzZmYnLCBlcGljOiAnI2IyNmJmZicsIGxlZ2VuZGFyeTogJyNmZmNjMzMnIH07XG5leHBvcnQgY29uc3QgaGFzQXJ0ID0gKHM6IFNvdWxJZCk6IGJvb2xlYW4gPT4gISFQT1JUUkFJVFtzXTtcbmV4cG9ydCBjb25zdCBzb3VsQXJ0ID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiBQT1JUUkFJVFtzXSA/PyBpY29uVXJsKFNPVUxfSUNPTltzXSk7XG5leHBvcnQgY29uc3QgcmFyaXR5Q29sb3IgPSAoczogU291bElkKTogc3RyaW5nID0+IFJBUklUWV9IRVhbUkFSSVRZX09GW3NdXTtcbi8qKiBDYXJkIGJhY2tkcm9wIGZvciBhIHBvcnRyYWl0OiBhIGdsb3cgaW4gdGhlIHJhcml0eSBjb2xvdXIgYmVoaW5kIHRoZSBmaWd1cmUsIG9uIGEgZGFyayBjcnlwdCBncmFkaWVudC4gKi9cbmV4cG9ydCBjb25zdCBhcnRCZyA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4geyBjb25zdCBjID0gcmFyaXR5Q29sb3Iocyk7IHJldHVybiBgcmFkaWFsLWdyYWRpZW50KGVsbGlwc2UgYXQgNTAlIDgwJSwgJHtjfTc3IDAlLCAke2N9MjYgNDYlLCB0cmFuc3BhcmVudCA3NCUpLCBsaW5lYXItZ3JhZGllbnQoIzJiMjQ0NCwjMGQwOTE5KWA7IH07XG4iLCAiLy8gRE9NIHVzZXIgaW50ZXJmYWNlOiB0b3AgYmFyLCBlbmVteSBwcmV2aWV3LCBoYW5kIG9mIGNhcmRzLCBidXR0b25zLCBkcmFmdCBvdmVybGF5LCB0b2FzdHMgYW5kIHRoZSBkZWJ1ZyBwYW5lbC5cbmltcG9ydCB7IEJBTEFOQ0UsIFJPTEVfVEVYVCwgU09VTF9OQU1FIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7IGlzRW5kbGVzcyB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgY2FuTWVyZ2VEZXBsb3llZCwgY2FuTWVyZ2VGcm9tSGFuZCwgY2FuU3VtbW9uLCBjb3N0LCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgc3RhZ2VXYXZlcyB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgZW5lbXlXYXZlLCBwcmV2aWV3VGV4dCB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgYXVkaW8gfSBmcm9tICcuL2F1ZGlvLnRzJztcbmltcG9ydCB7IGFydEJnLCBoYXNBcnQsIHJhcml0eUNvbG9yLCBzb3VsQXJ0IH0gZnJvbSAnLi4vdWkvcG9ydHJhaXRzLnRzJztcbmltcG9ydCB7IFNPVUxfSUNPTiwgaGVhcnRzSHRtbCwgZm10LCBpY29uSW1nLCBpY29uVXJsLCBza3VsbEltZ3MgfSBmcm9tICcuLi91aS9pY29ucy50cyc7XG5pbXBvcnQgeyBkZXNjcmliZVVubG9jayB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuXG5jb25zdCBwb3J0cmFpdEh0bWwgPSAoczogU291bElkKTogc3RyaW5nID0+IGA8ZGl2IGNsYXNzPVwicHRcIiBzdHlsZT1cImJhY2tncm91bmQ6JHthcnRCZyhzKX1cIj48aW1nIHNyYz1cIiR7c291bEFydChzKX1cIiBhbHQ9XCJcIiBkcmFnZ2FibGU9XCJmYWxzZVwiPjwvZGl2PmA7XG5jb25zdCBJQ09OID0gT2JqZWN0LmZyb21FbnRyaWVzKFNPVUxTLm1hcCgocykgPT4gW3MsIGljb25JbWcoU09VTF9JQ09OW3NdLCAnaWMnKV0pKSBhcyBSZWNvcmQ8U291bElkLCBzdHJpbmc+O1xuY29uc3QgJCA9IChpZDogc3RyaW5nKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkhO1xuY29uc3Qgc3RhcnMgPSAobjogbnVtYmVyKSA9PiAnXHUyNjA1Jy5yZXBlYXQobik7XG5cbmV4cG9ydCBjbGFzcyBVaSB7XG4gIHByaXZhdGUgdG9hc3RUID0gMDsgcHJpdmF0ZSBkYmc6IEhUTUxFbGVtZW50OyBwcml2YXRlIG9kZHMgPSAnJztcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBnOiBhbnkpIHtcbiAgICAkKCdidG5Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAkKCdidG5CYXR0bGUnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydEJhdHRsZSgpOyAkKCdidG5Td2FwJykub25jbGljayA9ICgpID0+IGcudG9nZ2xlU3dhcCgpO1xuICAgICQoJ2J0blJlbW92ZScpLm9uY2xpY2sgPSAoKSA9PiBnLnJlbW92ZVNlbGVjdGVkKCk7XG4gICAgJCgnYnRuU3BlZWQnKS5vbmNsaWNrID0gKCkgPT4gZy5zZXRTcGVlZChnLnRpbWVTY2FsZSA+IDEgPyAxIDogMik7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRDYW1Nb2RlKGIuZGF0YXNldC5jYW0hKSkpO1xuICAgICQoJ2dlYXInKS5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmRiZy5jbGFzc0xpc3QudG9nZ2xlKCdvcGVuJyk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICBjb25zdCBzbmQgPSAoKSA9PiB7ICQoJ2J0bk11c2ljJykuY2xhc3NMaXN0LnRvZ2dsZSgnb2ZmJywgIWF1ZGlvLm11c2ljKTsgJCgnYnRuU2Z4JykuY2xhc3NMaXN0LnRvZ2dsZSgnb2ZmJywgIWF1ZGlvLnNmeCk7IGNvbnN0IHNpID0gJCgnYnRuU2Z4JykucXVlcnlTZWxlY3RvcignaW1nJyk7IGlmIChzaSkgc2kuc3JjID0gaWNvblVybChhdWRpby5zZnggPyAnc291bmRfb24nIDogJ3NvdW5kX29mZicpOyB9O1xuICAgICQoJ2J0bk11c2ljJykub25jbGljayA9ICgpID0+IHsgYXVkaW8uc2V0TXVzaWMoIWF1ZGlvLm11c2ljKTsgc25kKCk7IH07ICQoJ2J0blNmeCcpLm9uY2xpY2sgPSAoKSA9PiB7IGF1ZGlvLnNldFNmeCghYXVkaW8uc2Z4KTsgc25kKCk7IH07XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzJywgc25kKTsgc25kKCk7XG4gICAgdGhpcy5kYmcgPSAkKCdkZWJ1ZycpOyBpZiAobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnZGVidWcnKSkgdGhpcy5kYmcuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICAgIHRoaXMucmVuZGVyRGVidWcoKTtcbiAgfVxuXG4gIC8qKiBUaGUgTmVjcm9tYW5jZXIganVzdCBsb3N0IGEgaGVhcnQ6IG1ha2UgdGhlIGhlYXJ0cyBidW1wLiAqL1xuICBwdWxzZUhlYXJ0cygpIHsgY29uc3QgaCA9ICQoJ2hlYXJ0cycpOyBoLmNsYXNzTGlzdC5yZW1vdmUoJ2h1cnQnKTsgdm9pZCBoLm9mZnNldFdpZHRoOyBoLmNsYXNzTGlzdC5hZGQoJ2h1cnQnKTsgfVxuICB0b2FzdChtc2c6IHN0cmluZykgeyBjb25zdCB0ID0gJCgndG9hc3QnKTsgdC50ZXh0Q29udGVudCA9IG1zZzsgdC5jbGFzc0xpc3QuYWRkKCdzaG93Jyk7IGNsZWFyVGltZW91dCh0aGlzLnRvYXN0VCk7IHRoaXMudG9hc3RUID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4gdC5jbGFzc0xpc3QucmVtb3ZlKCdzaG93JyksIDM2MDApOyB9XG5cbiAgcmVuZGVyKCkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmcsIHMgPSBnLnMsIHBoID0gZy5waGFzZSwgYnVpbGQgPSBwaCA9PT0gJ2J1aWxkJztcbiAgICAkKCdoZWFydHMnKS5pbm5lckhUTUwgPSBoZWFydHNIdG1sKHMuaGVhcnRzKTtcbiAgICAkKCd3YXZlJykudGV4dENvbnRlbnQgPSBpc0VuZGxlc3MoKSA/IGBXYXZlICR7cy53YXZlfWAgOiBgV2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfWA7XG4gICAgY29uc3QgdXNlZCA9IGRvbWluaW9uVXNlZChzKTsgJCgnZG9tJykudGV4dENvbnRlbnQgPSBgJHt1c2VkfS8ke3MuY2FwfWA7ICgkKCdkb21maWxsJykgYXMgSFRNTEVsZW1lbnQpLnN0eWxlLndpZHRoID0gTWF0aC5taW4oMTAwLCAodXNlZCAvIHMuY2FwKSAqIDEwMCkgKyAnJSc7XG4gICAgLy8gZW5lbXkgcHJldmlldzogd2hhdCBpcyBjb21pbmcsIG5ldmVyIHdoZXJlXG4gICAgY29uc3QgcHYgPSBwcmV2aWV3VGV4dChlbmVteVdhdmUocy53YXZlLCBnLnNlZWQpKTtcbiAgICAkKCdlbmVteScpLmlubmVySFRNTCA9IGA8Yj5OZXh0IGVuZW1pZXM8L2I+YCArIHB2Lm1hcCgocCkgPT4gYDxkaXYgY2xhc3M9XCJlcm93XCI+PHNwYW4+JHtJQ09OW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3Bhbj4ke1NPVUxfTkFNRVtwLnNvdWwgYXMgU291bElkXX0keyhwIGFzIGFueSkuYm9zcyA/ICcgPGIgc3R5bGU9XCJjb2xvcjojZmY3YjZhXCI+Qk9TUzwvYj4nIDogJyd9PC9zcGFuPjxzcGFuIGNsYXNzPVwieFwiPlx1MDBENyR7cC5jb3VudH08L3NwYW4+PHNwYW4gY2xhc3M9XCJzdFwiPiR7c3RhcnMocC5zdGFyKX08L3NwYW4+PC9kaXY+YCkuam9pbignJykgKyBgPGRpdiBjbGFzcz1cImhpbnRcIj5Qb3NpdGlvbnMgc3RheSBoaWRkZW4gdW50aWwgdGhlIGJhdHRsZS48L2Rpdj5gO1xuICAgIC8vIGhhbmRcbiAgICBjb25zdCBoYW5kID0gJCgnaGFuZCcpOyBoYW5kLmlubmVySFRNTCA9ICcnO1xuICAgIHMuaGFuZC5mb3JFYWNoKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4ge1xuICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgY29uc3Qgc2VsID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIGcuc2VsLmlkeCA9PT0gaTsgY29uc3QgYWZmb3JkID0gY2FuU3VtbW9uKHMsIGkpLCBjYW5NZXJnZSA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKSwgdXNhYmxlID0gYWZmb3JkIHx8IGNhbk1lcmdlO1xuICAgICAgY29uc3QgYXJ0ID0gaGFzQXJ0KHNvdWwpOyBlbC5jbGFzc05hbWUgPSAnY2FyZCcgKyAoYXJ0ID8gJyBhcnQnIDogJycpICsgKHNlbCA/ICcgc2VsJyA6ICcnKSArICghdXNhYmxlICYmICFnLnN3YXBNb2RlID8gJyBkaXMnIDogJycpICsgKGcuc3dhcE1vZGUgPyAnIHN3YXAnIDogJycpO1xuICAgICAgY29uc3QgdGFnID0gYWZmb3JkID8gYDxzcGFuIGNsYXNzPVwib2tcIj5TdW1tb248L3NwYW4+YCA6IGNhbk1lcmdlID8gJzxzcGFuIGNsYXNzPVwib2sgbWdcIj5NZXJnZSBvbmx5PC9zcGFuPicgOiAnPHNwYW4gY2xhc3M9XCJub1wiPk5vIHJvb208L3NwYW4+JztcbiAgICAgIGlmIChhcnQpIGVsLnN0eWxlLmJvcmRlckNvbG9yID0gcmFyaXR5Q29sb3Ioc291bCk7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHthcnQgPyBwb3J0cmFpdEh0bWwoc291bCkgOiBJQ09OW3NvdWxdICsgYDxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PmB9PGRpdiBjbGFzcz1cImNzXCI+JHt0YWd9PC9kaXY+YDsgZWwudGl0bGUgPSBST0xFX1RFWFRbc291bF0gKyAoYWZmb3JkID8gJycgOiBjYW5NZXJnZSA/ICcgLSBEb21pbmlvbiBpcyBmdWxsLCBidXQgeW91IGNhbiBtZXJnZSBpdCBpbnRvIHlvdXIgbWF0Y2hpbmcgMS1zdGFyIHVuaXQuJyA6ICcgLSBOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJyk7XG4gICAgICBlbC5vbmNsaWNrID0gKCkgPT4gZy5vbkNhcmQoaSk7IGhhbmQuYXBwZW5kQ2hpbGQoZWwpO1xuICAgIH0pO1xuICAgIGlmICghcy5oYW5kLmxlbmd0aCkgaGFuZC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cImVtcHR5XCI+Tm8gY2FyZHMgaW4gaGFuZDwvZGl2Pic7XG4gICAgLy8gYnV0dG9uc1xuICAgICgkKCdidG5CYXR0bGUnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhYnVpbGQgfHwgIXMudW5pdHMubGVuZ3RoO1xuICAgIGNvbnN0IHN3ID0gJCgnYnRuU3dhcCcpIGFzIEhUTUxCdXR0b25FbGVtZW50OyBzdy5kaXNhYmxlZCA9ICFidWlsZCB8fCBzLmRpc2NhcmRVc2VkOyBzdy5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGcuc3dhcE1vZGUpOyBzdy50ZXh0Q29udGVudCA9IHMuZGlzY2FyZFVzZWQgPyAnU3dhcCB1c2VkJyA6IGcuc3dhcE1vZGUgPyAnU3dhcDogcGljayBhIGNhcmQgb3IgdW5pdCcgOiAnU3dhcCAoMS9yb3VuZCknO1xuICAgIGNvbnN0IHNlbFUgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAndW5pdCcgPyBzLnVuaXRzLmZpbmQoKHU6IGFueSkgPT4gdS5pZCA9PT0gZy5zZWwuaWQpIDogbnVsbDtcbiAgICBjb25zdCBwYXJ0bmVyID0gc2VsVSAmJiBzLnVuaXRzLnNvbWUoKG86IGFueSkgPT4gY2FuTWVyZ2VEZXBsb3llZChzZWxVLCBvKSk7XG4gICAgJCgndW5pdHBhbmVsJykuc3R5bGUuZGlzcGxheSA9IGJ1aWxkICYmIHNlbFUgPyAnZmxleCcgOiAnbm9uZSc7XG4gICAgJCgnYnRuUmVtb3ZlJykudGV4dENvbnRlbnQgPSBnLmNvbmZpcm1SZW1vdmUgPyAnQ29uZmlybSByZW1vdmUnIDogJ1JlbW92ZSc7XG4gICAgJCgnaW5mbycpLnRleHRDb250ZW50ID0gYnVpbGQgPyAoZy5zd2FwTW9kZSA/ICdTV0FQOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCBpdCwgb3IgdGFwIGEgdW5pdCB5b3UgZGlkIG5vdCBzdW1tb24gdGhpcyByb3VuZCB0byBzZWxsIGl0LiBZb3UgZHJhdyBhIGRpZmZlcmVudCBTb3VsLidcbiAgICAgIDogc2VsVSA/IGAke1NPVUxfTkFNRVtzZWxVLnNvdWwgYXMgU291bElkXX0gJHtzdGFycyhzZWxVLnN0YXIpfSAgXHUyMDIyICAke1JPTEVfVEVYVFtzZWxVLnNvdWwgYXMgU291bElkXX0gICR7cGFydG5lciA/ICdcdTIwMjIgVGFwIHRoZSBtYXRjaGluZyB1bml0IHRvIG1lcmdlIGludG8gYSBzdHJvbmdlciBzdGFyLicgOiAnJ31gXG4gICAgICA6IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyA/IGAke1NPVUxfTkFNRVtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfTogJHtST0xFX1RFWFRbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX0gIFx1MjAyMiAgYCArICgoKSA9PiB7IGNvbnN0IGkgPSBnLnNlbC5pZHgsIHNtID0gY2FuU3VtbW9uKHMsIGkpLCBtZyA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKTsgcmV0dXJuIHNtICYmIG1nID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLCBvciBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6IHNtID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLicgOiBtZyA/ICdEb21pbmlvbiBpcyBmdWxsOiB0YXAgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiAnTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLic7IH0pKCkgOiAnVGFwIGEgY2FyZCwgdGhlbiBhIHRpbGUuIFRhcCBhIHVuaXQgdG8gbWVyZ2UsIG1vdmUgb3IgcmVtb3ZlIGl0LicpXG4gICAgICA6IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ0JhdHRsZSEgVW5pdHMgZmlnaHQgb24gdGhlaXIgb3duLicgOiAnJztcbiAgICAkKCdzcGVlZCcpLnN0eWxlLmRpc3BsYXkgPSBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdmbGV4JyA6ICdub25lJztcbiAgICBjb25zdCBmYXN0ID0gZy5zcGVlZFVubG9ja2VkKCk7IGlmICghZmFzdCAmJiBnLnRpbWVTY2FsZSA+IDEpIGcudGltZVNjYWxlID0gMTtcbiAgICBjb25zdCBzYiA9ICQoJ2J0blNwZWVkJyk7IHNiLnN0eWxlLmRpc3BsYXkgPSBmYXN0ID8gJycgOiAnbm9uZSc7IHNiLnRleHRDb250ZW50ID0gZy50aW1lU2NhbGUgKyAneCc7IHNiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgZy50aW1lU2NhbGUgPiAxKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IGIuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBiLmRhdGFzZXQuY2FtID09PSBnLmNhbU1vZGUpKTtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC50b2dnbGUoJ2luYmF0dGxlJywgcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicpOyBhdWRpby5zZXRNb2RlKHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2JhdHRsZScgOiAnYnVpbGQnKTtcbiAgICAvLyBvdmVybGF5XG4gICAgY29uc3Qgb3YgPSAkKCdvdmVybGF5Jyk7IG92LmNsYXNzTmFtZSA9ICcnOyBvdi5pbm5lckhUTUwgPSAnJztcbiAgICBpZiAocGggPT09ICdkcmFmdCcgJiYgZy5kcmFmdCkge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5WaWN0b3J5IERyYWZ0PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+V2F2ZSBjbGVhcmVkLiBEb21pbmlvbiBpcyBub3cgJHtzLmNhcH0uJHtnLmxhc3RHb2xkID8gYCA8YiBzdHlsZT1cImNvbG9yOiNmZmQyNGFcIj4rJHtmbXQoZy5sYXN0R29sZCl9PC9iPiAke2ljb25JbWcoJ2dvbGQnKX1gIDogJyd9IEtlZXAgb25lOjwvZGl2PjxkaXYgY2xhc3M9XCJyb3dcIj4ke2cuZHJhZnQubWFwKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4gYDxkaXYgY2xhc3M9XCJjYXJkIGJpZyR7aGFzQXJ0KHNvdWwpID8gJyBhcnQnIDogJyd9XCIgZGF0YS1pPVwiJHtpfVwiJHtoYXNBcnQoc291bCkgPyBgIHN0eWxlPVwiYm9yZGVyLWNvbG9yOiR7cmFyaXR5Q29sb3Ioc291bCl9XCJgIDogJyd9PjxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PiR7aGFzQXJ0KHNvdWwpID8gcG9ydHJhaXRIdG1sKHNvdWwpIDogSUNPTltzb3VsXX08ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj48ZGl2IGNsYXNzPVwicm9sZVwiPiR7Uk9MRV9URVhUW3NvdWxdfTwvZGl2PjwvZGl2PmApLmpvaW4oJycpfTwvZGl2PjwvZGl2PmA7XG4gICAgICBvdi5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignLmNhcmQnKS5mb3JFYWNoKChjKSA9PiAoYy5vbmNsaWNrID0gKCkgPT4gZy5waWNrRHJhZnQoK2MuZGF0YXNldC5pISkpKTtcbiAgICB9IGVsc2UgaWYgKHBoID09PSAnd29uJyB8fCBwaCA9PT0gJ2xvc3QnKSB7XG4gICAgICBjb25zdCBydyA9IHBoID09PSAnd29uJyA/IGcucmV3YXJkIDogbnVsbCwgc2sgPSAobjogbnVtYmVyKSA9PiBza3VsbEltZ3Mobik7XG4gICAgICBjb25zdCB1bmxvY2tIdG1sID0gcncgJiYgcncudW5sb2NrZWQgJiYgcncudW5sb2NrZWQubGVuZ3RoID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiM3ZWYyYzg7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdjaGVjaycpfSBVbmxvY2tlZDogJHtydy51bmxvY2tlZC5tYXAoKGs6IHN0cmluZykgPT4gZGVzY3JpYmVVbmxvY2soaykpLmpvaW4oJyBcXHUwMGI3ICcpfTwvZGl2PmAgOiAnJztcbiAgICAgIGNvbnN0IGdvbGRIdG1sID0gZy5ydW5Hb2xkID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdnb2xkJyl9IEdvbGQgZWFybmVkIHRoaXMgcnVuOiAke2ZtdChnLnJ1bkdvbGQpfTwvZGl2PmAgOiAnJztcbiAgICAgIGNvbnN0IGRyID0gcGggPT09ICd3b24nICYmIGcuZGFpbHkgPyBnLmRhaWx5UmV3YXJkIDogbnVsbDtcbiAgICAgIGNvbnN0IGRhaWx5SHRtbCA9IGcuZGFpbHkgPyAoZHIgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2RyLnBhY2sgPyBgJHtpY29uSW1nKCdzaG9wJyl9IERhaWx5IGNvbXBsZXRlISBEYXkgJHtkci5zdHJlYWt9IGluIGEgcm93OiBhICR7c2soZHIucGFjay50aWVyKX0gU291bCBQYWNrIGFuZCAke2ZtdChkci5nb2xkKX0gJHtpY29uSW1nKCdnb2xkJyl9LmAgOiAnRGFpbHkgY29tcGxldGUgYWdhaW4uIFRoZSByZXdhcmQgY29tZXMgb25jZSBwZXIgZGF5OiBzZWUgeW91IHRvbW9ycm93ISd9PC9kaXY+YCA6ICcnKSA6ICcnO1xuICAgICAgY29uc3QgcmV3YXJkSHRtbCA9IGdvbGRIdG1sICsgZGFpbHlIdG1sICsgdW5sb2NrSHRtbCArIChydyA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7cncucGFjayA/IChydy5maXJzdCA/IGAke2ljb25JbWcoJ3Nob3AnKX0gRmlyc3QgY2xlYXIhIFlvdSBlYXJuZWQgYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gIDogYCR7aWNvbkltZygnc2hvcCcpfSBSZXBsYXkgcmV3YXJkOiBhICR7c2socncucGFjay50aWVyKX0gU291bCBQYWNrLmApIDogYFJlcGxheSBwcm9ncmVzcyAke3J3LnJlcGxheU1ldGVyfS8ke3J3LnJlcGxheU5lZWRlZH0gdG93YXJkIGEgU291bCBQYWNrLmB9PC9kaXY+YCA6ICcnKTtcbiAgICAgIGlmIChwaCA9PT0gJ2xvc3QnICYmIGlzRW5kbGVzcygpICYmIGcuZW5kbGVzcykgeyAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGVuZCBvZiBhbiBlbmRsZXNzIHJ1bjogaG93IGRlZXAsIGFueSByZWNvcmQsIHBhY2tzIGVhcm5lZFxuICAgICAgICBjb25zdCBlID0gZy5lbmRsZXNzLCByZWMgPSBlLmNsZWFyZWQgPiBlLnN0YXJ0QmVzdDtcbiAgICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5SdW4gb3ZlcjwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPllvdSBjbGVhcmVkICR7ZS5jbGVhcmVkfSB3YXZlJHtlLmNsZWFyZWQgPT09IDEgPyAnJyA6ICdzJ30uICR7cmVjID8gJzxiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YVwiPk5ldyBiZXN0IGRlcHRoITwvYj4nIDogJ0Jlc3Q6IHdhdmUgJyArIE1hdGgubWF4KGUuc3RhcnRCZXN0LCBlLmNsZWFyZWQpICsgJy4nfTwvZGl2PiR7Zy5ydW5Hb2xkID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdnb2xkJyl9IEdvbGQgZWFybmVkIHRoaXMgcnVuOiAke2ZtdChnLnJ1bkdvbGQpfTwvZGl2PmAgOiAnJ30ke2UucGFja3MgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ3Nob3AnKX0gJHtlLnBhY2tzfSBTb3VsIFBhY2ske2UucGFja3MgPT09IDEgPyAnJyA6ICdzJ30gZWFybmVkIHRoaXMgcnVuLjwvZGl2PmAgOiAnPGRpdiBjbGFzcz1cInN1YlwiPkNsZWFyIHdhdmUgMTAgdG8gZWFybiBhIFNvdWwgUGFjay48L2Rpdj4nfTxkaXYgY2xhc3M9XCJyb3dcIj4ke2UucGFja3MgPyAnPGJ1dHRvbiBpZD1cInRvU2hvcFwiIGNsYXNzPVwiZ29cIj5PcGVuIHBhY2s8L2J1dHRvbj4nIDogJyd9PGJ1dHRvbiBpZD1cImFnYWluXCIgY2xhc3M9XCIke2UucGFja3MgPyAnYmx1ZScgOiAnZ28nfVwiPkdvIGFnYWluPC9idXR0b24+PGJ1dHRvbiBpZD1cInRvSG9tZVwiIGNsYXNzPVwiYmx1ZVwiPkhvbWU8L2J1dHRvbj48L2Rpdj48L2Rpdj5gO1xuICAgICAgICAkKCdhZ2FpbicpLm9uY2xpY2sgPSAoKSA9PiBnLm5ld0VuZGxlc3MoKTsgJCgndG9Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAgICAgY29uc3QgdHMyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvU2hvcCcpOyBpZiAodHMyKSB0czIub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc2hvcCcpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPiR7Zy5kYWlseSA/IChwaCA9PT0gJ3dvbicgPyAnRGFpbHkgY29tcGxldGUhJyA6ICdDaGFsbGVuZ2UgZmFpbGVkJykgOiBwaCA9PT0gJ3dvbicgPyAnU3RhZ2UgY2xlYXJlZCEnIDogJ1N0YWdlIGxvc3QnfTwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPiR7Zy5sYXN0QmF0dGxlfTwvZGl2PiR7cmV3YXJkSHRtbH08ZGl2IGNsYXNzPVwicm93XCI+JHsocncgJiYgcncucGFjaykgfHwgKGRyICYmIGRyLnBhY2spID8gJzxidXR0b24gaWQ9XCJ0b1Nob3BcIiBjbGFzcz1cImdvXCI+T3BlbiBwYWNrPC9idXR0b24+JyA6ICcnfTxidXR0b24gaWQ9XCJhZ2FpblwiIGNsYXNzPVwiJHsocncgJiYgcncucGFjaykgfHwgKGRyICYmIGRyLnBhY2spID8gJ2JsdWUnIDogJ2dvJ31cIj4ke3BoID09PSAnd29uJyA/ICdQbGF5IGFnYWluJyA6ICdUcnkgYWdhaW4nfTwvYnV0dG9uPjxidXR0b24gaWQ9XCJ0b0hvbWVcIiBjbGFzcz1cImJsdWVcIj5Ib21lPC9idXR0b24+PC9kaXY+PC9kaXY+YDtcbiAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IChnLmRhaWx5ID8gZy5uZXdEYWlseSgpIDogZy5uZXdSdW4oKSk7ICQoJ3RvSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgICBjb25zdCB0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b1Nob3AnKTsgaWYgKHRzKSB0cy5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zaG9wJykpO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnJlbmRlckRlYnVnTGl2ZSgpO1xuICAgIGlmIChwaCA9PT0gJ2J1aWxkJykgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IGcucmVmcmFtZUJ1aWxkKCkpOyAgICAgLy8gYWZ0ZXIgbGF5b3V0OiBrZWVwIHRoZSBncmlkIGNsZWFyIG9mIHRoZSBoYW5kIGFuZCBidXR0b25zXG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgcGFuZWxcbiAgcHJpdmF0ZSByZW5kZXJEZWJ1ZygpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBkID0gdGhpcy5kYmc7IGlmICghZC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSkgeyBkLmlubmVySFRNTCA9ICcnOyByZXR1cm47IH1cbiAgICBjb25zdCByb3cgPSAobGFiZWw6IHN0cmluZywgb2JqOiBhbnksIGtleTogc3RyaW5nIHwgbnVtYmVyLCBtaW46IG51bWJlciwgbWF4OiBudW1iZXIsIHN0ZXA6IG51bWJlcikgPT4gYDxsYWJlbD4ke2xhYmVsfSA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiJHttaW59XCIgbWF4PVwiJHttYXh9XCIgc3RlcD1cIiR7c3RlcH1cIiB2YWx1ZT1cIiR7b2JqW2tleV19XCIgZGF0YS1vPVwiJHtsYWJlbH1cIj48c3Bhbj4ke29ialtrZXldfTwvc3Bhbj48L2xhYmVsPmA7XG4gICAgZC5pbm5lckhUTUwgPSBgPGI+RGVidWcgKGxpdmUpPC9iPiA8c3BhbiBpZD1cImRiZ2Zwc1wiPjwvc3Bhbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+U3RhciBtdWx0aXBsaWVycyAoYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHkpXG4gICAgICAgICR7cm93KCdIUCB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdIUCB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnU2l6ZSAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAxLCAxLCAxLjYsIDAuMDIpfSR7cm93KCdTaXplIDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDIsIDEsIDIsIDAuMDIpfTwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48dGFibGU+PHRyPjx0aD48L3RoPjx0aD5ocDwvdGg+PHRoPmRtZzwvdGg+PHRoPnJhdGU8L3RoPjx0aD5yYW5nZTwvdGg+PHRoPnNwZDwvdGg+PC90cj4ke1NPVUxTLm1hcCgoaykgPT4gYDx0cj48dGQ+JHtJQ09OW2tdfTwvdGQ+JHtbJ2hwJywgJ2RtZycsICdpbnRlcnZhbCcsICdyYW5nZScsICdzcGVlZCddLm1hcCgoZikgPT4gYDx0ZD48aW5wdXQgY2xhc3M9XCJudW1cIiBkYXRhLXNvdWw9XCIke2t9XCIgZGF0YS1mPVwiJHtmfVwiIHZhbHVlPVwiJHsoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2tdW2ZdfVwiPjwvdGQ+YCkuam9pbignJyl9PC90cj5gKS5qb2luKCcnKX08L3RhYmxlPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5EaWZmaWN1bHR5IDxzZWxlY3QgaWQ9XCJkRGlmZlwiPiR7WydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5QZXJmb3JtYW5jZTxicj48c21hbGwgaWQ9XCJkYmdQZXJmXCI+bWVhc3VyaW5nXHUyMDI2PC9zbWFsbD48YnI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRGcHNcIiAke2cuc2hvd0ZwcyA/ICdjaGVja2VkJyA6ICcnfT4gU2hvdyBGUFMgb24gdGhlIGJhdHRsZSBzY3JlZW48L2xhYmVsPiA8YnV0dG9uIGlkPVwiZFBlcmZcIj5Db3B5IHBlcmYgcmVwb3J0PC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkT2Rkc1wiPlRlc3Qgb2RkcyAoMjAwIGZpZ2h0cyk8L2J1dHRvbj4gPHNwYW4gaWQ9XCJkT2Rkc091dFwiPiR7dGhpcy5vZGRzfTwvc3Bhbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRDb3B5XCI+Q29weSByZXBvcnQ8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXNldFwiPlJlc2V0IGJhbGFuY2U8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXN0YXJ0XCI+UmVzdGFydCBzdGFnZTwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5BZGQgY2FyZCA8c2VsZWN0IGlkPVwiZENhcmRcIj4ke1NPVUxTLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCI+JHtTT1VMX05BTUVba119PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxidXR0b24gaWQ9XCJkQWRkXCI+KzwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZERvbVwiPisyIERvbWluaW9uPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5MYXN0IHRhcDogPHNwYW4gaWQ9XCJkYmd0YXBcIj4ke2cubGFzdFRhcEluZm99PC9zcGFuPjwvc21hbGw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5TZWVkICR7Zy5zZWVkfS4gQWRkIDxjb2RlPj9zZWVkPTc8L2NvZGU+IHRvIHRoZSBsaW5rIHRvIHJlcGxheSB0aGUgc2FtZSBkcmF3cy48L3NtYWxsPjwvZGl2PmA7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dFt0eXBlPXJhbmdlXScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmlucHV0ID0gKCkgPT4ge1xuICAgICAgY29uc3QgbGFiID0gaW5wLmRhdGFzZXQubyE7IGNvbnN0IHYgPSAraW5wLnZhbHVlOyAoaW5wLm5leHRFbGVtZW50U2libGluZyBhcyBIVE1MRWxlbWVudCkudGV4dENvbnRlbnQgPSBTdHJpbmcodik7XG4gICAgICBjb25zdCBzZXQ6IFJlY29yZDxzdHJpbmcsICgpID0+IHZvaWQ+ID0geyAnSFAgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsxXSA9IHYpLCAnSFAgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsyXSA9IHYpLCAnRGFtYWdlIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzFdID0gdiksICdEYW1hZ2UgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMl0gPSB2KSwgJ1NpemUgMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMV0gPSB2KSwgJ1NpemUgM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMl0gPSB2KSB9O1xuICAgICAgc2V0W2xhYl0oKTsgZy5hcHBseUJhbGFuY2VDaGFuZ2UoKTtcbiAgICB9KSk7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dC5udW0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25jaGFuZ2UgPSAoKSA9PiB7IChCQUxBTkNFLnN0YXRzIGFzIGFueSlbaW5wLmRhdGFzZXQuc291bCFdW2lucC5kYXRhc2V0LmYhXSA9ICtpbnAudmFsdWU7IH0pKTtcbiAgICAkKCdkRGlmZicpLm9uY2hhbmdlID0gKGUpID0+IGcuY2hhbmdlRGlmZmljdWx0eSgoZS50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlKTtcbiAgICAkKCdkTWVyZ2VIYW5kJykub25jaGFuZ2UgPSAoZSkgPT4geyBnLnMucnVsZXMubWVyZ2UgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZCA/ICdoYW5kSW50b09uZVN0YXInIDogJ2RlcGxveWVkT25seSc7IGcuc3luY0J1aWxkKCk7IHRoaXMucmVuZGVyKCk7IH07XG4gICAgJCgnZE9kZHMnKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCByID0gZy50ZXN0T2RkcygyMDApOyB0aGlzLm9kZHMgPSBgJHtyLndpbn0lIHdpbiAoJHtyLm59IGZpZ2h0cywgYXZnICR7ci5hdmdUaW1lfXMpIHZzIHdhdmUgJHtnLnMud2F2ZX1gOyAkKCdkT2Rkc091dCcpLnRleHRDb250ZW50ID0gdGhpcy5vZGRzOyB9O1xuICAgICQoJ2RDb3B5Jykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucmVwb3J0KCk7IChuYXZpZ2F0b3IuY2xpcGJvYXJkID8gbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCkgOiBQcm9taXNlLnJlamVjdCgpKS50aGVuKCgpID0+IHRoaXMudG9hc3QoJ1JlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RGcHMnKS5vbmNoYW5nZSA9IChlKSA9PiBnLnNldFNob3dGcHMoKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQpO1xuICAgICQoJ2RQZXJmJykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucGVyZlJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdQZXJmIHJlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RSZXNldCcpLm9uY2xpY2sgPSAoKSA9PiB7IGcucmVzZXRCYWxhbmNlQWxsKCk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICAkKCdkUmVzdGFydCcpLm9uY2xpY2sgPSAoKSA9PiBnLnN0YXJ0U3RhZ2UoZy5zZWVkKTtcbiAgICAkKCdkQWRkJykub25jbGljayA9ICgpID0+IGcuYWRkQ2FyZCgoJCgnZENhcmQnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUgYXMgU291bElkKTsgJCgnZERvbScpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZERvbWluaW9uKDIpO1xuICB9XG4gIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ1BlcmYnKTsgaWYgKHBmKSB7IGNvbnN0IHAgPSB0aGlzLmcucGVyZkluZm8oKTsgcGYudGV4dENvbnRlbnQgPSBgJHtwLmZwcy50b0ZpeGVkKDApfSBmcHMgXHUwMEI3IGF2ZyAke3AuYXZnLnRvRml4ZWQoMSl9bXMgXHUwMEI3IHNsb3c1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMgXHUwMEI3IHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIFx1MDBCNyAke3AubWVzaGVzfSBtZXNoZXMgXHUwMEI3ICR7cC5wYXJ0aWNsZXN9IHBhcnRpY2xlIHN5c3RlbXMgXHUwMEI3ICR7cC5kcmF3c30gZHJhdyBjYWxsc2A7IH1cbiAgICBjb25zdCB0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ3RhcCcpOyBpZiAodCkgdC50ZXh0Q29udGVudCA9IHRoaXMuZy5sYXN0VGFwSW5mbztcbiAgfVxufVxuIiwgIi8vIFRoZSBwbGF5YWJsZSBwcm90b3R5cGU6IGJ1aWxkIHNjcmVlbiAtPiBiYXR0bGUgLT4gZHJhZnQgLT4gbmV4dCB3YXZlLCBidWlsdCBvbiB0aGUgdGVzdGVkIHJ1bGVzICsgYmF0dGxlIGVuZ2luZS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSwgcmVzZXRCYWxhbmNlLCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgR1JJRF9DRUxMUywgR1JJRF9DT0xTLCBHUklEX1JPV1MsIFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7XG4gIGFkdmFuY2VXYXZlLCBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNlbGxGcmVlLCBjb3N0LCBkaXNjYXJkUmVkcmF3LCBkaXNtaXNzLCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgZHJhZnRPcHRpb25zLCBmYWlsV2F2ZSxcbiAgbWVyZ2VEZXBsb3llZCwgbWVyZ2VGcm9tSGFuZCwgbW92ZVVuaXQsIG5ld1N0YWdlLCBub3JtYWxEcmF3LCBzdGFnZVdhdmVzLCBzdW1tb24sIHN3YXBTZWxsLCB0YWtlRHJhZnQsXG59IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgYnVpbGRBcmVuYSB9IGZyb20gJy4vYXJlbmEudHMnO1xuaW1wb3J0IHsgQmF0dGxlLCBjZWxsUG9zLCBGUk9OVF9YLCBHUklEX1NQLCBzaW11bGF0ZSB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB0eXBlIHsgQkV2ZW50IH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHsgY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lLCBlbmVteVBvd2VyLCBlbmVteVdhdmUsIGlzRW5kbGVzcywgc2V0RGlmZmljdWx0eSwgc2V0RW5kbGVzcywgc2V0U3RhZ2VEaWZmaWN1bHR5LCBzZXREYWlseSB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19JRCwgRU5ETEVTU19QQUNLX0VWRVJZIH0gZnJvbSAnLi4vY29yZS9lbmRsZXNzLnRzJztcbmltcG9ydCB7IERBSUxZX0lELCBkYWlseVJ1bGVzLCBkYXlOdW1iZXIsIGlzVmFsaWREYXksIG1vZGlmaWVyRm9yIH0gZnJvbSAnLi4vY29yZS9kYWlseS50cyc7XG5pbXBvcnQgdHlwZSB7IERhaWx5TW9kIH0gZnJvbSAnLi4vY29yZS9kYWlseS50cyc7XG5pbXBvcnQgeyBFTkRMRVNTX1JVTEVTLCBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuLi9jb3JlL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgeyBsb2FkU2F2ZSB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5pbXBvcnQgeyBlbmRsZXNzVW5sb2NrZWQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB7IE5lY3JvbWFuY2VyIH0gZnJvbSAnLi9uZWNyb21hbmNlci50cyc7XG5pbXBvcnQgeyBWZnggfSBmcm9tICcuL3ZmeC50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgY2xlYXJSdW4sIGxvYWRSdW4sIHNhdmVSdW4sIHNlcmlhbGl6ZVN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB7IGFkZEdvbGRBbmRTYXZlLCBlbmRsZXNzV2F2ZUdvbGQsIHBsYXlhYmxlLCByZWNvcmRDbGVhckFuZFNhdmUsIHJlY29yZERhaWx5V2luQW5kU2F2ZSwgcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlLCB3YXZlR29sZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBEYWlseVJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBDbGVhclJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSdW5TbmFwc2hvdCB9IGZyb20gJy4uL2NvcmUvcnVuc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBjcmVhdGVWaXN1YWwsIGlzVHJpcG8sIGxvYWRBc3NldHMgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHR5cGUgeyBBc3NldHMsIFVuaXRWaXN1YWwgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHsgVWkgfSBmcm9tICcuL3VpLnRzJztcblxuZXhwb3J0IHR5cGUgUGhhc2UgPSAnYnVpbGQnIHwgJ3RyYW5zaXRpb24nIHwgJ2JhdHRsZScgfCAnZHJhZnQnIHwgJ3dvbicgfCAnbG9zdCc7XG50eXBlIFNlbCA9IHsgdHlwZTogJ2NhcmQnOyBpZHg6IG51bWJlciB9IHwgeyB0eXBlOiAndW5pdCc7IGlkOiBudW1iZXIgfSB8IG51bGw7XG5cbmV4cG9ydCBjbGFzcyBHYW1lIHtcbiAgZW5naW5lOiBhbnk7IHNjZW5lOiBhbnk7IGNhbWVyYTogYW55OyBBITogQXNzZXRzOyB1aSE6IFVpO1xuICBkYWlseTogeyBkYXk6IG51bWJlcjsgbW9kOiBEYWlseU1vZCB9IHwgbnVsbCA9IG51bGw7IGRhaWx5UmV3YXJkOiBEYWlseVJld2FyZCB8IG51bGwgPSBudWxsOyAgIC8vIHRoZSBEYWlseSBDaGFsbGVuZ2UgcnVuIGluIHByb2dyZXNzLCBhbmQgd2hhdCBpdHMgd2luIHBhaWRcbiAgbGFzdEdvbGQgPSAwOyBydW5Hb2xkID0gMDsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBmcm9tIHRoZSB3YXZlIGp1c3QgY2xlYXJlZCwgYW5kIGZyb20gdGhpcyB3aG9sZSBydW5cbiAgcyE6IFN0YXRlOyBzZWVkID0gMTsgYXR0ZW1wdCA9IDA7IHBoYXNlOiBQaGFzZSA9ICdidWlsZCc7IGJhdHRsZTogQmF0dGxlIHwgbnVsbCA9IG51bGw7IHRpbWVTY2FsZSA9IDE7XG4gIHNlbDogU2VsID0gbnVsbDsgc3dhcE1vZGUgPSBmYWxzZTsgY29uZmlybVJlbW92ZSA9IGZhbHNlOyBkcmFmdDogU291bElkW10gfCBudWxsID0gbnVsbDsgbGFzdEJhdHRsZSA9ICcnO1xuICBwcml2YXRlIHVuaXRWaXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgIC8vIHVuaXQgaWQgLT4gdmlzdWFsICh5b3VyIGFybXksIHBlcnNpc3RzIGJldHdlZW4gd2F2ZXMpXG4gIHByaXZhdGUgdmlzVG9Vbml0ID0gbmV3IE1hcDxVbml0VmlzdWFsLCBudW1iZXI+KCk7XG4gIHByaXZhdGUgZnZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB2aXN1YWwgZHVyaW5nIGEgYmF0dGxlXG4gIHByaXZhdGUgZlVuaXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpOyAgICAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB1bml0IGlkIChwbGF5ZXIgc2lkZSlcbiAgcHJpdmF0ZSBsYXN0U3RhdGUgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpO1xuICBwcml2YXRlIGFyZW5hITogeyB1cGRhdGUodDogbnVtYmVyKTogdm9pZDsgc2V0VGhlbWUoc3RhZ2U6IHN0cmluZyk6IHZvaWQgfTtcbiAgcHJpdmF0ZSB0aWxlczogYW55W10gPSBbXTsgcHJpdmF0ZSB0aWxlTWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSByaW5nRng6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbWVyczogeyB0OiBudW1iZXI7IGZuOiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIGFjYyA9IDA7IHByaXZhdGUgY2FtRnJvbTogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UID0gMTsgcHJpdmF0ZSBjYW1EdXIgPSAyLjA7IHByaXZhdGUgcmVzdWx0QXQgPSAtMTsgcHJpdmF0ZSBoYW5kbGVkID0gZmFsc2U7IHByaXZhdGUgc3RhcnRTdGVwQXQgPSAwO1xuICBwcml2YXRlIGFycm93TWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd01lc2g6IGFueVtdID0gW107XG4gIG5lY3JvITogTmVjcm9tYW5jZXI7XG4gIC8qKiBXaGF0IHRoZSBsYXN0IHN0YWdlIGNsZWFyIGVhcm5lZCAoc2hvd24gb24gdGhlIHN0YWdlLWNsZWFyZWQgc2NyZWVuKS4gKi9cbiAgcmV3YXJkOiBDbGVhclJld2FyZCB8IG51bGwgPSBudWxsO1xuICAvKiogVGhlIGVuZGxlc3MgcnVuIGluIHByb2dyZXNzOiB0aGUgYmVzdCBkZXB0aCB3aGVuIGl0IGJlZ2FuICh0byBzcG90IGEgbmV3IHJlY29yZCksIHRoZSB3YXZlcyBjbGVhcmVkIHNvIGZhciwgYW5kIHRoZSBwYWNrcyBlYXJuZWQuICovXG4gIGVuZGxlc3M6IHsgc3RhcnRCZXN0OiBudW1iZXI7IGNsZWFyZWQ6IG51bWJlcjsgcGFja3M6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2luZSA9IGZhbHNlOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSByZXN1bHQgY3V0c2NlbmUgaXMgcGxheWluZzogdGhlIGJhdHRsZSBjYW1lcmEgYW5kIGZpZ2h0ZXIgc3luYyBzdGFuZCBkb3duXG4gIHByaXZhdGUgdmZ4ITogVmZ4O1xuICBwcml2YXRlIHR3ZWVuczogeyB0OiBudW1iZXI7IGR1cjogbnVtYmVyOyBmbjogKHU6IG51bWJlcikgPT4gdm9pZDsgZG9uZT86ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgdHdlZW4oZHVyOiBudW1iZXIsIGZuOiAodTogbnVtYmVyKSA9PiB2b2lkLCBkb25lPzogKCkgPT4gdm9pZCkgeyB0aGlzLnR3ZWVucy5wdXNoKHsgdDogMCwgZHVyLCBmbiwgZG9uZSB9KTsgfVxuICAvKiogRmluaXNoIGV2ZXJ5IHJ1bm5pbmcgYW5pbWF0aW9uIGF0IG9uY2UgKHNvIG5vdGhpbmcgaXMgbGVmdCBoYWxmLXdheSBvciB1bmRpc3Bvc2VkIHdoZW4gdGhlIHBoYXNlIGNoYW5nZXMpLiAqL1xuICBwcml2YXRlIGZsdXNoVHdlZW5zKCkgeyBmb3IgKGNvbnN0IHcgb2YgdGhpcy50d2VlbnMuc3BsaWNlKDApKSB7IHcuZm4oMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgcHJpdmF0ZSBzZWVuTWVyZ2VzID0gMDtcblxuICBhc3luYyBpbml0KGNhbnZhczogSFRNTENhbnZhc0VsZW1lbnQpIHtcbiAgICBjb25zdCBxcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKTtcbiAgICB0aGlzLmVuZ2luZSA9IG5ldyBCQUJZTE9OLkVuZ2luZShjYW52YXMsIHRydWUsIHsgYW50aWFsaWFzOiB0cnVlLCBwb3dlclByZWZlcmVuY2U6ICdoaWdoLXBlcmZvcm1hbmNlJyB9KTtcbiAgICBjb25zdCBkcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxOyB0aGlzLmVuZ2luZS5zZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgxIC8gTWF0aC5taW4oZHByLCAxLjUpKTtcbiAgICBjb25zdCBzY2VuZSA9IHRoaXMuc2NlbmUgPSBuZXcgQkFCWUxPTi5TY2VuZSh0aGlzLmVuZ2luZSk7IHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wOSwgMC4wNywgMC4xMywgMSk7XG4gICAgY29uc3QgaGVtaSA9IG5ldyBCQUJZTE9OLkhlbWlzcGhlcmljTGlnaHQoJ2gnLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMSwgMC4zKSwgc2NlbmUpOyBoZW1pLmludGVuc2l0eSA9IDEuMDU7IGhlbWkuZ3JvdW5kQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4zMiwgMC4yNiwgMC40Mik7XG4gICAgY29uc3Qgc3VuID0gbmV3IEJBQllMT04uRGlyZWN0aW9uYWxMaWdodCgncycsIG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuNCwgLTEsIDAuNTUpLCBzY2VuZSk7IHN1bi5pbnRlbnNpdHkgPSAwLjg1O1xuICAgIHRoaXMuY2FtZXJhID0gbmV3IEJBQllMT04uRnJlZUNhbWVyYSgnY2FtJywgbmV3IEJBQllMT04uVmVjdG9yMygwLCA4LCAtOSksIHNjZW5lKTsgdGhpcy5jYW1lcmEubWluWiA9IDAuMTsgdGhpcy5jYW1lcmEubWF4WiA9IDIwMDsgdGhpcy5jYW1lcmEuZm92ID0gMC44OyB0aGlzLmNhbWVyYS5pbnB1dHMuY2xlYXIoKTtcblxuICAgIGNvbnN0IGdyb3VuZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlR3JvdW5kKCdncm91bmQnLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0MCB9LCBzY2VuZSk7XG4gICAgZ3JvdW5kLmlzUGlja2FibGUgPSBmYWxzZTsgY29uc3QgYXJlbmEgPSB0aGlzLmFyZW5hID0gYnVpbGRBcmVuYShzY2VuZSwgZ3JvdW5kKTsgc2NlbmUub25CZWZvcmVSZW5kZXJPYnNlcnZhYmxlLmFkZCgoKSA9PiBhcmVuYS51cGRhdGUocGVyZm9ybWFuY2Uubm93KCkgLyAxMDAwKSk7XG4gICAgZm9yIChjb25zdCB0ZWFtIG9mIFswLCAxXSBhcyBjb25zdCkgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHsgY29uc3QgdCA9IHRoaXMubWFrZVRpbGUodGVhbSwgYyk7IGlmICh0ZWFtID09PSAwKSB0aGlzLnRpbGVzLnB1c2godCk7IGVsc2UgdC5zZXRFbmFibGVkKGZhbHNlKTsgfVxuXG4gICAgdGhpcy5BID0gYXdhaXQgbG9hZEFzc2V0cyhzY2VuZSk7XG4gICAgdGhpcy52ZnggPSBuZXcgVmZ4KHNjZW5lLCB0aGlzLmVuZ2luZSwgdGhpcy5jYW1lcmEsIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdiYXR0bGVIb3N0JykgfHwgZG9jdW1lbnQuYm9keSwgdGhpcy5BLnNvZnQpO1xuICAgIHRoaXMubmVjcm8gPSBuZXcgTmVjcm9tYW5jZXIoc2NlbmUsIHRoaXMuQS5zb2Z0LCB0aGlzLkEubmVjcm8pOyAgICAgICAvLyBzdGFuZHMganVzdCBiZWhpbmQgaGlzIGFybXkncyBiYWNrIGNvbHVtbiwgZmFjaW5nIHRoZSBiYXR0bGVmaWVsZFxuICAgIHRoaXMubmVjcm8uaG9sZGVyLnBvc2l0aW9uLnNldCgtKEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAtIDEuMDUsIDAsIDApOyB0aGlzLm5lY3JvLmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7XG4gICAgdGhpcy5hcnJvd01hdHMgPSBbMCwgMV0ubWFwKCh0KSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdhbScgKyB0LCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjMsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNywgMC4yNSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcmV0dXJuIG07IH0pO1xuICAgIHRoaXMudWkgPSBuZXcgVWkodGhpcyk7IHRoaXMuc2VlZCA9ICsocXMuZ2V0KCdzZWVkJykgfHwgMSk7IGlmIChxcy5nZXQoJ2ZwcycpKSB0aGlzLnNldFNob3dGcHModHJ1ZSk7XG5cbiAgICAvLyBUYXBzIGFyZSBkZXRlY3RlZCBoZXJlIChub3QgdGhyb3VnaCBCYWJ5bG9uKSBzbyB0aGV5IGJlaGF2ZSB0aGUgc2FtZSBpbiBTYWZhcmksIHRoZSBob21lLXNjcmVlbiBhcHAgYW5kIG9uIGRlc2t0b3AuXG4gICAgbGV0IGRvd246IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbG9jYWwgPSAoZTogUG9pbnRlckV2ZW50KSA9PiB7IGNvbnN0IHIgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7IHJldHVybiB7IHg6IGUuY2xpZW50WCAtIHIubGVmdCwgeTogZS5jbGllbnRZIC0gci50b3AgfTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmRvd24nLCAoZSkgPT4geyBkb3duID0geyAuLi5sb2NhbChlKSwgdDogcGVyZm9ybWFuY2Uubm93KCkgfTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJ1cCcsIChlKSA9PiB7IGlmICghZG93bikgcmV0dXJuOyBjb25zdCBwID0gbG9jYWwoZSk7IGNvbnN0IG1vdmVkID0gTWF0aC5oeXBvdChwLnggLSBkb3duLngsIHAueSAtIGRvd24ueSksIGR0ID0gcGVyZm9ybWFuY2Uubm93KCkgLSBkb3duLnQ7IGRvd24gPSBudWxsOyBpZiAobW92ZWQgPCAxNiAmJiBkdCA8IDkwMCkgdGhpcy50YXAocC54LCBwLnkpOyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmNhbmNlbCcsICgpID0+IHsgZG93biA9IG51bGw7IH0pO1xuICAgIHRoaXMuY2FudmFzID0gY2FudmFzOyBjb25zdCBvblJlc2l6ZSA9ICgpID0+IHRoaXMuaGFuZGxlUmVzaXplKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTsgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ29yaWVudGF0aW9uY2hhbmdlJywgKCkgPT4gc2V0VGltZW91dChvblJlc2l6ZSwgMjUwKSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydCkgKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKSBuZXcgKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKG9uUmVzaXplKS5vYnNlcnZlKGNhbnZhcyk7XG4gICAgaWYgKHFzLmdldCgnZ2FsbGVyeScpKSB7IHRoaXMuZ2FsbGVyeSgpOyByZXR1cm47IH1cbiAgICBjb25zdCBzYXZlZCA9IHFzLmdldCgnc2VlZCcpID8gbnVsbCA6IGxvYWRSdW4oKTsgICAgICAgICAgICAgICAgLy8gP3NlZWQ9TiBhbHdheXMgc3RhcnRzIGZyZXNoIChkZWJ1Z2dpbmcpOyBvdGhlcndpc2UgcGljayB1cCB3aGVyZSB0aGUgbGFzdCB2aXNpdCBsZWZ0IG9mZlxuICAgIGlmIChzYXZlZCkgdGhpcy5yZXN0b3JlKHNhdmVkKTsgZWxzZSB0aGlzLnN0YXJ0U3RhZ2UodGhpcy5zZWVkKTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKSwgcmF3ID0gbm93IC0gbGFzdDsgY29uc3QgZHQgPSBNYXRoLm1pbigwLjA1LCByYXcgLyAxMDAwKTsgbGFzdCA9IG5vdzsgaWYgKCF0aGlzLmFjdGl2ZSkgcmV0dXJuOyBpZiAodGhpcy5pbnNwZWN0aW5nKSB7IHRoaXMuZnJhbWVJbnNwZWN0KGR0KTsgdGhpcy52ZngudXBkYXRlKGR0KTsgfSBlbHNlIGlmICghdGhpcy5mcm96ZW4pIHRoaXMuZnJhbWUoZHQpOyBzY2VuZS5yZW5kZXIoKTsgdGhpcy5wZXJmVGljayhyYXcpOyB9KTtcbiAgfVxuICAvKiogVGhlIG5hdmlnYXRpb24gc2hlbGwgaGlkZXMgdGhlIGJhdHRsZSBzY3JlZW4gd2hpbGUgYW5vdGhlciB0YWIgaXMgb3BlbjogcGF1c2UgdGhlIGdhbWUgc28gaXQgY29zdHMgbm90aGluZy4gKi9cbiAgcHJpdmF0ZSBhY3RpdmUgPSB0cnVlO1xuICAvKiogRGVidWc6IGtlZXAgZHJhd2luZyBidXQgc3RvcCBhZHZhbmNpbmcgdGltZSwgc28gYSBtb21lbnQgY2FuIGJlIHN0ZXBwZWQgdGhyb3VnaCB3aXRoIGZyYW1lKGR0KSBhbmQgc2NyZWVuc2hvdHRlZC4gKi9cbiAgZnJvemVuID0gZmFsc2U7XG4gIHN0ZXAoZHQ6IG51bWJlcikgeyB0aGlzLmZyYW1lKGR0KTsgfVxuICBzZXRBY3RpdmUob246IGJvb2xlYW4pIHsgdGhpcy5hY3RpdmUgPSBvbjsgaWYgKG9uICYmIHRoaXMuc2NlbmUpIHRoaXMuc2NlbmUucGFydGljbGVTeXN0ZW1zLmZpbHRlcigocDogYW55KSA9PiBwLm5hbWUgPT09ICdiJykuZm9yRWFjaCgocDogYW55KSA9PiB7IHAuc3RvcCgpOyBwLmRpc3Bvc2UoZmFsc2UpOyB9KTsgfSAgIC8vIGJ1cnN0cyBtYWRlIHdoaWxlIHRoZSBnYW1lIHdhcyBhc2xlZXAgKGEgcmVzdG9yZWQgcnVuKSB3b3VsZCBoYW5nIGZyb3plbiBvbiBzY3JlZW5cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBpbnNwZWN0ICh0aGUgU291bHMgcGFnZSdzIDNEIGxvb2sgYXQgb25lIFNvdWwpXG4gIHByaXZhdGUgaW5zcGVjdGluZzogeyBzb3VsOiBTb3VsSWQ7IHY6IFVuaXRWaXN1YWw7IHN0YXI6IG51bWJlcjsgdGVhbTogMCB8IDE7IHNwaW46IGJvb2xlYW47IGhpZGRlbjogYW55W107IGdyaWQ6IGJvb2xlYW4gfSB8IG51bGwgPSBudWxsO1xuICAvKiogU2hvdyBvbmUgU291bCBvbiBpdHMgb3duIG9uIHRoZSBhcmVuYSBmbG9vcjogc2xvdyB0dXJudGFibGUsIGJ1dHRvbnMgZm9yIGV2ZXJ5IGFuaW1hdGlvbiBpdCBoYXMsIHN0YXIgc2l6ZXMgYW5kIHRoZSBlbmVteSBjb2xvdXJzLiAqL1xuICBpbnNwZWN0KHNvdWw6IFNvdWxJZCkge1xuICAgIGlmICghdGhpcy5BIHx8IHRoaXMuaW5zcGVjdGluZykgcmV0dXJuO1xuICAgIGNvbnN0IGhpZGRlbjogYW55W10gPSBbXTsgY29uc3QgaGlkZSA9IChuOiBhbnkpID0+IHsgaWYgKG4gJiYgbi5pc0VuYWJsZWQgJiYgbi5pc0VuYWJsZWQoKSkgeyBuLnNldEVuYWJsZWQoZmFsc2UpOyBoaWRkZW4ucHVzaChuKTsgfSB9O1xuICAgIGZvciAoY29uc3QgdiBvZiB0aGlzLnVuaXRWaXMudmFsdWVzKCkpIGhpZGUodi5ob2xkZXIpOyB0aGlzLmZ2aXMuZm9yRWFjaCgodikgPT4gaGlkZSh2LmhvbGRlcikpOyBpZiAodGhpcy5uZWNyby5ob2xkZXIuaXNFbmFibGVkKCkpIHsgdGhpcy5uZWNyby5zZXRFbmFibGVkKGZhbHNlKTsgaGlkZGVuLnB1c2goeyBzZXRFbmFibGVkOiAob246IGJvb2xlYW4pID0+IHRoaXMubmVjcm8uc2V0RW5hYmxlZChvbikgfSk7IH0gdGhpcy5yaW5nRnguZm9yRWFjaCgocikgPT4gaGlkZShyLm0pKTsgdGhpcy5hcnJvd3MuZm9yRWFjaCgoYSkgPT4gaGlkZShhLm1lc2gpKTtcbiAgICBjb25zdCBncmlkID0gdGhpcy50aWxlcy5sZW5ndGggPiAwICYmIHRoaXMudGlsZXNbMF0uaXNFbmFibGVkKCk7IHRoaXMuc2hvd0dyaWQoZmFsc2UpO1xuICAgIGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBzb3VsLCAwLCAxKTsgY29uc3QgUCA9IHsgeDogLTYsIHo6IDAgfTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KFAueCwgMCwgUC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgKiAwLjg1OyB2LnBsYXkoJ2lkbGUnKTtcbiAgICB0aGlzLmluc3BlY3RpbmcgPSB7IHNvdWwsIHYsIHN0YXI6IDEsIHRlYW06IDAsIHNwaW46IHRydWUsIGhpZGRlbiwgZ3JpZCB9O1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmFkZCgnaW5zcGVjdCcpO1xuICAgIHRoaXMuY2FtZXJhLmZvdiA9IDAuNjI7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLnNldChQLngsIDEuMTUsIFAueiAtIDMuNSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChuZXcgQkFCWUxPTi5WZWN0b3IzKFAueCwgMC41NiwgUC56KSk7XG4gICAgdGhpcy5yZW5kZXJJbnNwZWN0QmFyKCk7XG4gIH1cbiAgZW5kSW5zcGVjdCgpIHtcbiAgICBjb25zdCBpID0gdGhpcy5pbnNwZWN0aW5nOyBpZiAoIWkpIHJldHVybjtcbiAgICBpLnYuZGlzcG9zZSgpOyBpLmhpZGRlbi5mb3JFYWNoKChuKSA9PiBuLnNldEVuYWJsZWQodHJ1ZSkpOyB0aGlzLnNob3dHcmlkKGkuZ3JpZCAmJiB0aGlzLnBoYXNlID09PSAnYnVpbGQnKTtcbiAgICB0aGlzLmluc3BlY3RpbmcgPSBudWxsOyBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5yZW1vdmUoJ2luc3BlY3QnKTsgY29uc3QgYmFyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2luc3BlY3RiYXInKTsgaWYgKGJhcikgYmFyLmlubmVySFRNTCA9ICcnO1xuICAgIHRoaXMuY2FtZXJhLmZvdiA9IDAuODsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgfVxuICBwcml2YXRlIGZyYW1lSW5zcGVjdChkdDogbnVtYmVyKSB7XG4gICAgY29uc3QgaSA9IHRoaXMuaW5zcGVjdGluZyE7IGkudi51cGRhdGUoZHQpOyBpZiAoaS5zcGluKSBpLnYuaG9sZGVyLnJvdGF0aW9uLnkgKz0gZHQgKiAwLjQ1O1xuICAgIHRoaXMuYXJlbmEudXBkYXRlKHBlcmZvcm1hbmNlLm5vdygpIC8gMTAwMCk7XG4gIH1cbiAgcHJpdmF0ZSByZW5kZXJJbnNwZWN0QmFyKCkge1xuICAgIGNvbnN0IGkgPSB0aGlzLmluc3BlY3Rpbmc7IGNvbnN0IGJhciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbnNwZWN0YmFyJyk7IGlmICghaSB8fCAhYmFyKSByZXR1cm47XG4gICAgY29uc3QgbmljZSA9IChuOiBzdHJpbmcpID0+ICh7IFNwYXduOiAnQXJyaXZhbCcsIEF0dGFjazogJ0F0dGFjaycsIENoZWVyOiAnQ2hlZXInLCBEZWF0aDogJ0ZhbGwnIH0gYXMgYW55KVtuXSA/PyBuLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csICckMSAkMicpO1xuICAgIGNvbnN0IGNsaXBzID0gKGkudi5jbGlwTmFtZXMgPyBpLnYuY2xpcE5hbWVzKCkgOiBbXSkubWFwKChuKSA9PiBgPGJ1dHRvbiBkYXRhLWNsaXA9XCIke259XCI+JHtuaWNlKG4pfTwvYnV0dG9uPmApLmpvaW4oJycpO1xuICAgIGJhci5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImliXCI+PGJ1dHRvbiBpZD1cImliQmFja1wiIGNsYXNzPVwiZ29cIj5CYWNrPC9idXR0b24+PGIgY2xhc3M9XCJpYnRcIj4ke1NPVUxfTkFNRVtpLnNvdWxdfTwvYj4ke1sxLCAyLCAzXS5tYXAoKG4pID0+IGA8YnV0dG9uIGRhdGEtc3Rhcj1cIiR7bn1cIiBjbGFzcz1cIiR7aS5zdGFyID09PSBuID8gJ29uJyA6ICcnfVwiPiR7bn1cXHUyNjA1PC9idXR0b24+YCkuam9pbignJyl9PGJ1dHRvbiBpZD1cImliVGVhbVwiIGNsYXNzPVwiJHtpLnRlYW0gPyAnb24nIDogJyd9XCI+RW5lbXkgY29sb3VyczwvYnV0dG9uPjxidXR0b24gaWQ9XCJpYlNwaW5cIiBjbGFzcz1cIiR7aS5zcGluID8gJ29uJyA6ICcnfVwiPlR1cm48L2J1dHRvbj48L2Rpdj48ZGl2IGNsYXNzPVwiaWIgaWJjXCI+JHtjbGlwc308L2Rpdj5gO1xuICAgIGJhci5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2xpcF0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5wbGF5KCd0YXAnKTsgaS52LnByZXZpZXdDbGlwICYmIGkudi5wcmV2aWV3Q2xpcChiLmRhdGFzZXQuY2xpcCEpOyB9KSk7XG4gICAgYmFyLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1zdGFyXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiB7IGkuc3RhciA9ICtiLmRhdGFzZXQuc3RhciE7IGkudi5zZXRTdGFyKGkuc3Rhcik7IHRoaXMucmVuZGVySW5zcGVjdEJhcigpOyB9KSk7XG4gICAgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpYlRlYW0nKSBhcyBIVE1MRWxlbWVudCkub25jbGljayA9ICgpID0+IHsgaS50ZWFtID0gaS50ZWFtID8gMCA6IDE7IGkudi5zZXRUZWFtKGkudGVhbSk7IHRoaXMucmVuZGVySW5zcGVjdEJhcigpOyB9O1xuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaWJTcGluJykgYXMgSFRNTEVsZW1lbnQpLm9uY2xpY2sgPSAoKSA9PiB7IGkuc3BpbiA9ICFpLnNwaW47IHRoaXMucmVuZGVySW5zcGVjdEJhcigpOyB9O1xuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaWJCYWNrJykgYXMgSFRNTEVsZW1lbnQpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLXNvdWxzJykpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2NlbmUgaGVscGVyc1xuICAvKiogVGhlIHBsYWNlbWVudCBncmlkIGlzIGEgYnVpbGQtc2NyZWVuIHRvb2w6IGhpZGUgaXQgZHVyaW5nIHRoZSBmaWdodCBzbyB0aGUgYmF0dGxlIGxvb2tzIGxpa2UgYSBzY2VuZSwgbm90IGEgYm9hcmQuICovXG4gIHByaXZhdGUgc2hvd0dyaWQob246IGJvb2xlYW4pIHsgZm9yIChjb25zdCB0IG9mIHRoaXMudGlsZXMpIHQuc2V0RW5hYmxlZChvbik7IH1cbiAgcHJpdmF0ZSBtYWtlVGlsZSh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCksIHQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCd0aWxlJyArIGNlbGwsIHsgc2l6ZTogR1JJRF9TUCAqIDAuOTIgfSwgdGhpcy5zY2VuZSk7XG4gICAgdC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHQucG9zaXRpb24uc2V0KHAueCwgMC4wMTUsIHAueik7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3RtJywgdGhpcy5zY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjEyLCAwLjQyKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQyLCAwLjEyLCAwLjEyKTsgbS5hbHBoYSA9IDAuNTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB0Lm1hdGVyaWFsID0gbTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyB0Lm1ldGFkYXRhID0geyBraW5kOiAndGlsZScsIGNlbGwgfTsgdGhpcy50aWxlTWF0c1tjZWxsXSA9IG07IH0gZWxzZSB0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICByZXR1cm4gdDtcbiAgfVxuICBwcml2YXRlIHRpbnQoY2VsbDogbnVtYmVyLCBtb2RlOiAnbm9ybWFsJyB8ICdmcmVlJyB8ICdzZWwnIHwgJ3BhcnRuZXInKSB7XG4gICAgY29uc3QgbSA9IHRoaXMudGlsZU1hdHNbY2VsbF07IGNvbnN0IGMgPSB7IG5vcm1hbDogWzAuMTgsIDAuMTIsIDAuNDIsIDAuNV0sIGZyZWU6IFswLjIsIDAuNzUsIDAuNTUsIDAuN10sIHNlbDogWzEsIDAuODIsIDAuMywgMC44NV0sIHBhcnRuZXI6IFswLjg1LCAwLjM1LCAxLCAwLjg1XSB9W21vZGVdO1xuICAgIG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhjWzBdLCBjWzFdLCBjWzJdKTsgbS5hbHBoYSA9IGNbM107XG4gIH1cbiAgbGF0ZXIoc2VjOiBudW1iZXIsIGZuOiAoKSA9PiB2b2lkKSB7IHRoaXMudGltZXJzLnB1c2goeyB0OiBzZWMsIGZuIH0pOyB9XG4gIHByaXZhdGUgZnhSaW5nKHg6IG51bWJlciwgejogbnVtYmVyLCBjb2xvcjogYW55LCByMDogbnVtYmVyLCByMTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdmeCcsIHsgZGlhbWV0ZXI6IDEsIHRoaWNrbmVzczogMC4wMzUsIHRlc3NlbGxhdGlvbjogMjggfSwgdGhpcy5zY2VuZSk7IG0ucG9zaXRpb24uc2V0KHgsIDAuMDUsIHopOyBtLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBtbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2Z4bScsIHRoaXMuc2NlbmUpOyBtbS5lbWlzc2l2ZUNvbG9yID0gY29sb3I7IG1tLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG1tLmFscGhhID0gMC45OyBtLm1hdGVyaWFsID0gbW07IHRoaXMucmluZ0Z4LnB1c2goeyBtLCBtbSwgdDogMCwgcjAsIHIxLCBkdXIgfSk7XG4gIH1cbiAgcHJpdmF0ZSBidXJzdCh4OiBudW1iZXIsIHo6IG51bWJlciwgYzE6IG51bWJlcltdLCBjMjogbnVtYmVyW10sIGNvdW50OiBudW1iZXIpIHtcbiAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdiJywgNjAsIHRoaXMuc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoeCwgMC4wNSwgeik7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIDAuMDUsIDAuMik7XG4gICAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMSBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMyIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjEsIDAsIDAuMiwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMTI7IHBzLm1heFNpemUgPSAwLjM0OyBwcy5taW5MaWZlVGltZSA9IDAuNDsgcHMubWF4TGlmZVRpbWUgPSAwLjk7IHBzLmVtaXRSYXRlID0gMDsgcHMubWFudWFsRW1pdENvdW50ID0gY291bnQ7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLCAxLjMsIC0xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMSwgMi40LCAxKTtcbiAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjg7IHBzLm1heEVtaXRQb3dlciA9IDI7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIC0yLCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy50YXJnZXRTdG9wRHVyYXRpb24gPSAxLjI7IHBzLmRpc3Bvc2VPblN0b3AgPSBmYWxzZTsgcHMub25TdG9wcGVkT2JzZXJ2YWJsZS5hZGRPbmNlKCgpID0+IHBzLmRpc3Bvc2UoZmFsc2UpKTsgcHMuc3RhcnQoKTsgICAvLyAoZGlzcG9zZShmYWxzZSk6IHRoZSBzb2Z0IHRleHR1cmUgaXMgc2hhcmVkIGJ5IGV2ZXJ5IGVmZmVjdClcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGNhbWVyYVxuICBwcml2YXRlIHBvc2VzKCkge1xuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IGhhbGYgPSBGUk9OVF9YICsgKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCArIDEuNDtcbiAgICBjb25zdCBkID0gTWF0aC5tYXgoaGFsZiAvICh0YW5WICogYXNwKSwgKChHUklEX1JPV1MgKiBHUklEX1NQKSAvIDIgKyAyKSAvICh0YW5WICogMC41NSksIDgpO1xuICAgIGNvbnN0IGJhdHRsZSA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjEgKiBkLCAwLjQyICogZCArIDAuNSwgLTAuODYgKiBkKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuMzUsIDApIH07XG4gICAgLy8gQnVpbGQgdmlldzogKGFsbW9zdCkgc3RyYWlnaHQgZG93biwgd2l0aCB0aGUgd2hvbGUgZ3JpZCBpbnNpZGUgdGhlIGJhbmQgYmV0d2VlbiB0aGUgdG9wIGJhciBhbmQgdGhlIGhhbmQgb2YgY2FyZHMuXG4gICAgY29uc3QgY3ggPSAtKEZST05UX1ggKyAoKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCkgLyAyKSwgSCA9IE1hdGgubWF4KDEsIHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCk7XG4gICAgY29uc3QgYm94ID0gKGlkOiBzdHJpbmcpID0+IHsgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7IHJldHVybiBlbCAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGwgPyBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKSA6IG51bGw7IH07XG4gICAgY29uc3QgdG9wQmFyID0gYm94KCd0b3AnKSwgaGFuZCA9IGJveCgnaGFuZCcpLCBpbmZvID0gYm94KCdpbmZvJyk7XG4gICAgY29uc3QgVE9QID0gTWF0aC5taW4oMC4zMiwgdG9wQmFyID8gKHRvcEJhci5ib3R0b20gKyA2KSAvIEggOiAwLjEpO1xuICAgIGNvbnN0IEJPVFRPTSA9IE1hdGgubWluKDAuNSwgKEggLSBNYXRoLm1pbihoYW5kID8gaGFuZC50b3AgOiBILCBpbmZvID8gaW5mby50b3AgOiBIKSArIDYpIC8gSCk7XG4gICAgY29uc3QgYmFuZCA9IE1hdGgubWF4KDAuMywgMSAtIFRPUCAtIEJPVFRPTSksIGNlbnRlckZyYWMgPSBUT1AgKyBiYW5kIC8gMjsgICAgICAgICAgLy8gdGhlIGdyaWQncyBjZW50cmUgYXBwZWFycyBhdCB0aGlzIGZyYWN0aW9uIGZyb20gdGhlIHRvcFxuICAgIGNvbnN0IGd3ID0gR1JJRF9DT0xTICogR1JJRF9TUCArIDMuMiwgZ2ggPSBHUklEX1JPV1MgKiBHUklEX1NQICsgMC41OyAgICAgICAgICAgICAgICAvLyB0aGUgd2lkdGggYWxzbyBsZWF2ZXMgcm9vbSBmb3IgdGhlIE5lY3JvbWFuY2VyIGJlc2lkZSB0aGUgZ3JpZFxuICAgIGNvbnN0IGQyID0gTWF0aC5tYXgoZ2ggLyAoMiAqIHRhblYgKiBiYW5kKSwgZ3cgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjg4KSwgNC41KTtcbiAgICBjb25zdCBzaGlmdCA9ICgwLjUgLSBjZW50ZXJGcmFjKSAqIDIgKiBkMiAqIHRhblYsIGJ4ID0gY3ggLSAwLjY7XG4gICAgY29uc3QgYnVpbGQgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMyhieCwgZDIsIC1zaGlmdCAtIDAuMSAqIGQyKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCAwLCAtc2hpZnQpIH07XG4gICAgY29uc3QgbmVjcm8gPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMyhiYXR0bGUucG9zLnggLSAxLjQsIGJhdHRsZS5wb3MueSAqIDEuMTIsIGJhdHRsZS5wb3MueiAqIDEuMTIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEuNCwgMC4zNSwgMCkgfTsgICAvLyByZXN1bHQgY3V0c2NlbmVzOiBoaW0gYW5kIHRoZSBmaWVsZFxuICAgIHJldHVybiB7IGJhdHRsZSwgYnVpbGQsIG5lY3JvIH07XG4gIH1cbiAgLyoqIFRoZSBoYW5kIC8gaW5mbyBiYXIgY2FuIGNoYW5nZSBzaXplIGluIHRoZSBidWlsZCBwaGFzZSAobG9uZyBhYmlsaXR5IHRleHQsIG1vcmUgY2FyZHMpOiByZS1mcmFtZSBzbyB0aGUgZ3JpZCBuZXZlciBoaWRlcyBiZWhpbmQgaXQuICovXG4gIHJlZnJhbWVCdWlsZCgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCB0aGlzLmNhbVQgPCAxIHx8IHRoaXMuY2luZSB8fCAhdGhpcy5jYW52YXMpIHJldHVybjtcbiAgICBjb25zdCBwID0gdGhpcy5wb3NlcygpLmJ1aWxkLCBjID0gdGhpcy5jYW1lcmEucG9zaXRpb247XG4gICAgaWYgKCFpc0Zpbml0ZShwLnBvcy54KSB8fCBCQUJZTE9OLlZlY3RvcjMuRGlzdGFuY2UoYywgcC5wb3MpIDwgMC4wNikgcmV0dXJuO1xuICAgIHRoaXMudHdlZW5DYW0ocCwgMC4zNSk7XG4gIH1cbiAgcHJpdmF0ZSBjYW52YXMhOiBIVE1MQ2FudmFzRWxlbWVudDsgcHJpdmF0ZSBsYXN0VyA9IDA7IHByaXZhdGUgbGFzdEggPSAwOyBsYXN0VGFwSW5mbyA9ICcobm8gdGFwcyB5ZXQpJztcbiAgcHJpdmF0ZSBoYW5kbGVSZXNpemUoKSB7XG4gICAgaWYgKCF0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCB8fCAhdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KSByZXR1cm47ICAgLy8gaGlkZGVuIGJlaGluZCBhbm90aGVyIHRhYlxuICAgIHRoaXMuZW5naW5lLnJlc2l6ZSgpOyB0aGlzLmxhc3RXID0gdGhpcy5jYW52YXMuY2xpZW50V2lkdGg7IHRoaXMubGFzdEggPSB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcgJiYgdGhpcy5jYW1UID49IDEpIHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7XG4gIH1cbiAgLyoqIEEgdGFwIG9uIHRoZSAzRCB2aWV3OiBwaWNrIGEgdGlsZSBvciBhIHVuaXQuICovXG4gIHByaXZhdGUgdGFwKHg6IG51bWJlciwgeTogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IHRoaXMuc2NlbmUucGljayh4LCB5LCAobTogYW55KSA9PiAhIShtLm1ldGFkYXRhICYmIG0ubWV0YWRhdGEua2luZCkpO1xuICAgIGNvbnN0IG1kID0gcCAmJiBwLmhpdCA/IHAucGlja2VkTWVzaC5tZXRhZGF0YSA6IG51bGw7XG4gICAgdGhpcy5sYXN0VGFwSW5mbyA9IGB0YXAgJHtNYXRoLnJvdW5kKHgpfSwke01hdGgucm91bmQoeSl9IG9mICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSAtPiAke21kID8gKG1kLmtpbmQgPT09ICd0aWxlJyA/ICd0aWxlICcgKyBtZC5jZWxsIDogJ3VuaXQnKSA6ICdub3RoaW5nJ30gKHBoYXNlICR7dGhpcy5waGFzZX0pYDtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhbWQpIHJldHVybjtcbiAgICBpZiAobWQua2luZCA9PT0gJ3RpbGUnKSB0aGlzLm9uVGlsZShtZC5jZWxsKTsgZWxzZSBpZiAobWQua2luZCA9PT0gJ3VuaXQnKSB0aGlzLm9uVW5pdFZpc3VhbChtZC52aXN1YWwpO1xuICB9XG4gIHByaXZhdGUgc2V0Q2FtKHA6IGFueSkgeyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5jb3B5RnJvbShwLnBvcyk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChwLnRndC5jbG9uZSgpKTsgfVxuICBwcml2YXRlIHR3ZWVuQ2FtKHRvOiBhbnksIGR1cjogbnVtYmVyKSB7IHRoaXMuY2FtRnJvbSA9IHsgcG9zOiB0aGlzLmNhbWVyYS5wb3NpdGlvbi5jbG9uZSgpLCB0Z3Q6IHRoaXMuY2FtZXJhLmdldFRhcmdldCgpLmNsb25lKCkgfTsgdGhpcy5jYW1UbyA9IHRvOyB0aGlzLmNhbVQgPSAwOyB0aGlzLmNhbUR1ciA9IGR1cjsgfVxuXG4gIC8vIC0tLS0gYmF0dGxlIGNhbWVyYTogZm9sbG93cyB0aGUgZmlnaHRlcnMgdGhhdCBhcmUgc3RpbGwgYWxpdmUsIHNvIHRoZSBhY3Rpb24gKGFuZCB0aGUgcHVycGxlIGV5ZXMpIHN0YXlzIGxhcmdlIG9uIHNjcmVlblxuICBjYW1Nb2RlOiAnY2xvc2UnIHwgJ3dpZGUnID0gJ2Nsb3NlJzsgcHJpdmF0ZSBjYW1UZ3Q6IGFueSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAwKTtcbiAgc2V0Q2FtTW9kZShtOiAnY2xvc2UnIHwgJ3dpZGUnKSB7XG4gICAgdGhpcy5jYW1Nb2RlID0gbTtcbiAgICBpZiAobSA9PT0gJ3dpZGUnICYmIHRoaXMuYmF0dGxlKSB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDAuOSk7XG4gICAgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBwcml2YXRlIGZyYW1lQmF0dGxlKGR0OiBudW1iZXIpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7IGlmICghYikgcmV0dXJuOyBjb25zdCBhbGl2ZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKCFhbGl2ZS5sZW5ndGgpIHJldHVybjtcbiAgICBsZXQgeDAgPSAxZTksIHgxID0gLTFlOSwgejAgPSAxZTksIHoxID0gLTFlOTsgZm9yIChjb25zdCBmIG9mIGFsaXZlKSB7IHgwID0gTWF0aC5taW4oeDAsIGYueCk7IHgxID0gTWF0aC5tYXgoeDEsIGYueCk7IHowID0gTWF0aC5taW4oejAsIGYueik7IHoxID0gTWF0aC5tYXgoejEsIGYueik7IH1cbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCB3aWRlID0gdGhpcy5wb3NlcygpLmJhdHRsZSwgY3ggPSAoeDAgKyB4MSkgLyAyLCBjeiA9ICh6MCArIHoxKSAvIDI7XG4gICAgY29uc3QgZCA9IE1hdGgubWluKE1hdGgubWF4KCh4MSAtIHgwICsgMy40KSAvICgyICogdGFuViAqIGFzcCAqIDAuOSksICh6MSAtIHowICsgMy4yKSAvICgyICogdGFuViAqIDAuNjIpLCA1LjQpLCBNYXRoLmh5cG90KHdpZGUucG9zLnksIHdpZGUucG9zLnopKTtcbiAgICBjb25zdCB0Z3QgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4LCAwLjU1LCBjeiksIHBvcyA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3ggLSAwLjA2ICogZCwgMC4zMiAqIGQgKyAwLjUsIGN6IC0gMC45ICogZCk7XG4gICAgY29uc3QgayA9IDEgLSBNYXRoLmV4cCgtZHQgKiAyLjApO1xuICAgIHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1lcmEucG9zaXRpb24sIHBvcywgayk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1UZ3QsIHRndCwgayk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YWdlIGZsb3dcbiAgLyoqIFdyaXRlIHRoZSBydW4gdG8gZGlzayAoY2FsbSBtb21lbnRzIG9ubHk6IGJ1aWxkIHBoYXNlIGFuZCB0aGUgdmljdG9yeSBkcmFmdCkuICovXG4gIHByaXZhdGUgcGVyc2lzdFJ1bigpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzKSByZXR1cm47XG4gICAgICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHsgY2xlYXJSdW4oKTsgcmV0dXJuOyB9XG4gICAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyAmJiB0aGlzLnBoYXNlICE9PSAnZHJhZnQnKSByZXR1cm47XG4gICAgICBjb25zdCBzbmFwOiBSdW5TbmFwc2hvdCA9IHsgdjogMSwgc2VlZDogdGhpcy5zZWVkLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIHN0YWdlOiBjdXJyZW50U3RhZ2VJZCwgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUsIHBoYXNlOiB0aGlzLnBoYXNlLCBkcmFmdDogdGhpcy5waGFzZSA9PT0gJ2RyYWZ0JyA/IHRoaXMuZHJhZnQgOiBudWxsLCBzdGF0ZTogc2VyaWFsaXplU3RhdGUocyksIHN0YXJ0QmVzdDogdGhpcy5lbmRsZXNzPy5zdGFydEJlc3QgfTtcbiAgICAgIHNhdmVSdW4oc25hcCk7XG4gICAgfSBjYXRjaCB7IC8qIG5ldmVyIGxldCBzYXZpbmcgYnJlYWsgdGhlIGdhbWUgKi8gfVxuICB9XG4gIC8qKiBSZWJ1aWxkIHRoZSBzY3JlZW4gZnJvbSBhIHNhdmVkIHJ1biAoYSByZWxvYWQsIG9yIFNhZmFyaSBkaXNjYXJkaW5nIHRoZSBwYWdlKS4gKi9cbiAgcHJpdmF0ZSByZXN0b3JlKHI6IHsgc25hcDogUnVuU25hcHNob3Q7IHN0YXRlOiBTdGF0ZSB9KSB7XG4gICAgY29uc3QgeyBzbmFwLCBzdGF0ZSB9ID0gcjtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5mbHVzaFR3ZWVucygpOyB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIHRoaXMuZGFpbHkgPSBudWxsO1xuICAgIGlmIChzbmFwLnN0YWdlID09PSBEQUlMWV9JRCAmJiBpc1ZhbGlkRGF5KCtzbmFwLmRpZmZpY3VsdHkpKSB7IGNvbnN0IGRheSA9ICtzbmFwLmRpZmZpY3VsdHksIG1vZCA9IG1vZGlmaWVyRm9yKGRheSk7IHNldERhaWx5KG1vZCwgZGF5KTsgdGhpcy5kYWlseSA9IHsgZGF5LCBtb2QgfTsgdGhpcy5lbmRsZXNzID0gbnVsbDsgdGhpcy5hcmVuYS5zZXRUaGVtZSgnY3J5cHQnKTsgfVxuICAgIGVsc2UgaWYgKHNuYXAuc3RhZ2UgPT09IEVORExFU1NfSUQpIHsgc2V0RW5kbGVzcygpOyBjb25zdCBkb25lID0gTWF0aC5tYXgoMCwgc3RhdGUud2F2ZSAtIDEpOyB0aGlzLmVuZGxlc3MgPSB7IHN0YXJ0QmVzdDogc25hcC5zdGFydEJlc3QgPz8gbG9hZFNhdmUoKS5lbmRsZXNzLmJlc3QsIGNsZWFyZWQ6IGRvbmUsIHBhY2tzOiBNYXRoLmZsb29yKGRvbmUgLyBFTkRMRVNTX1BBQ0tfRVZFUlkpIH07IH0gZWxzZSB7IHNldFN0YWdlRGlmZmljdWx0eShzbmFwLnN0YWdlLCBzbmFwLmRpZmZpY3VsdHkpOyB0aGlzLmVuZGxlc3MgPSBudWxsOyB9XG4gICAgaWYgKCF0aGlzLmRhaWx5KSB0aGlzLmFyZW5hLnNldFRoZW1lKGN1cnJlbnRTdGFnZUlkKTtcbiAgICB0aGlzLnNlZWQgPSBzbmFwLnNlZWQ7IHRoaXMuYXR0ZW1wdCA9IHNuYXAuYXR0ZW1wdDsgdGhpcy5zID0gc3RhdGU7IHRoaXMuc2Vlbk1lcmdlcyA9IHN0YXRlLnN0YXRzLm1lcmdlcztcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBzbmFwLnBoYXNlID09PSAnZHJhZnQnID8gc25hcC5kcmFmdCA6IG51bGw7IHRoaXMucGhhc2UgPSB0aGlzLmRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCc7IHRoaXMuc2hvd0dyaWQodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdChgUnVuIHJlc3RvcmVkOiB3YXZlICR7aXNFbmRsZXNzKCkgPyBzdGF0ZS53YXZlIDogc3RhdGUud2F2ZSArICcvJyArIHN0YWdlV2F2ZXMoc3RhdGUpfSwgJHtzdGF0ZS5oZWFydHN9IGhlYXJ0JHtzdGF0ZS5oZWFydHMgPT09IDEgPyAnJyA6ICdzJ30uYCk7XG4gIH1cblxuICAvLyAtLS0tIHBlcmZvcm1hbmNlIHJlYWRvdXQ6IHJvbGxpbmcgZnJhbWUgc3RhdHMsIHBlci1iYXR0bGUgc3VtbWFyaWVzLCBvcHRpb25hbCBvbi1zY3JlZW4gRlBTLCBhbmQgYSBwYXN0ZS1mcmllbmRseSByZXBvcnRcbiAgc2hvd0ZwcyA9IGZhbHNlOyBwZXJmTm93ID0geyBmcHM6IDAsIGF2ZzogMCwgcDk1OiAwLCB3b3JzdDogMCB9OyBwZXJmTG9nOiBhbnlbXSA9IFtdO1xuICBwcml2YXRlIHBlcmZCdWYgPSBuZXcgRmxvYXQzMkFycmF5KDI0MCk7IHByaXZhdGUgcGVyZk4gPSAwOyBwcml2YXRlIHBlcmZJID0gMDsgcHJpdmF0ZSBwZXJmU2hvd25BdCA9IDA7IHByaXZhdGUgaW5zdHI6IGFueSA9IG51bGw7IHByaXZhdGUgZnBzSHVkOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGN1ckJhdHRsZTogeyBmcmFtZXM6IG51bWJlcjsgc3VtOiBudW1iZXI7IHdvcnN0OiBudW1iZXI7IHNsb3c6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHNldFNob3dGcHMob246IGJvb2xlYW4pIHtcbiAgICB0aGlzLnNob3dGcHMgPSBvbjtcbiAgICBpZiAob24gJiYgIXRoaXMuZnBzSHVkKSB7IGNvbnN0IGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgaC5pZCA9ICdmcHNIdWQnOyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JhdHRsZUhvc3QnKSB8fCBkb2N1bWVudC5ib2R5KS5hcHBlbmRDaGlsZChoKTsgdGhpcy5mcHNIdWQgPSBoOyB9XG4gICAgaWYgKHRoaXMuZnBzSHVkKSB0aGlzLmZwc0h1ZC5zdHlsZS5kaXNwbGF5ID0gb24gPyAnYmxvY2snIDogJ25vbmUnO1xuICB9XG4gIHByaXZhdGUgcGVyZlRpY2sobXM6IG51bWJlcikge1xuICAgIGlmIChtcyA+IDUwMCkgcmV0dXJuOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgdGFiIHdhcyBoaWRkZW4gb3IgdGhlIHBob25lIHBhdXNlZCB1czogbm90IGEgcmVhbCBmcmFtZVxuICAgIHRoaXMucGVyZkJ1Zlt0aGlzLnBlcmZJXSA9IG1zOyB0aGlzLnBlcmZJID0gKHRoaXMucGVyZkkgKyAxKSAlIHRoaXMucGVyZkJ1Zi5sZW5ndGg7IHRoaXMucGVyZk4gPSBNYXRoLm1pbih0aGlzLnBlcmZCdWYubGVuZ3RoLCB0aGlzLnBlcmZOICsgMSk7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlO1xuICAgIGlmIChjICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCB0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpKSB7IGMuZnJhbWVzKys7IGMuc3VtICs9IG1zOyBpZiAobXMgPiBjLndvcnN0KSBjLndvcnN0ID0gbXM7IGlmIChtcyA+IDMzLjQpIGMuc2xvdysrOyBjLnNjYWxlID0gTWF0aC5tYXgoYy5zY2FsZSwgdGhpcy50aW1lU2NhbGUpOyB9XG4gICAgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCk7IGlmIChub3cgLSB0aGlzLnBlcmZTaG93bkF0IDwgNTAwKSByZXR1cm47IHRoaXMucGVyZlNob3duQXQgPSBub3c7XG4gICAgY29uc3QgYSA9IEFycmF5LmZyb20odGhpcy5wZXJmQnVmLnN1YmFycmF5KDAsIHRoaXMucGVyZk4pKS5zb3J0KCh4LCB5KSA9PiB4IC0geSksIGF2ZyA9IGEucmVkdWNlKChuLCB4KSA9PiBuICsgeCwgMCkgLyBhLmxlbmd0aDtcbiAgICB0aGlzLnBlcmZOb3cgPSB7IGZwczogMTAwMCAvIGF2ZywgYXZnLCBwOTU6IGFbTWF0aC5mbG9vcihhLmxlbmd0aCAqIDAuOTUpXSA/PyAwLCB3b3JzdDogYVthLmxlbmd0aCAtIDFdID8/IDAgfTtcbiAgICBpZiAodGhpcy5mcHNIdWQgJiYgdGhpcy5zaG93RnBzKSB0aGlzLmZwc0h1ZC50ZXh0Q29udGVudCA9IGAke3RoaXMucGVyZk5vdy5mcHMudG9GaXhlZCgwKX0gZnBzICAke3RoaXMucGVyZk5vdy5hdmcudG9GaXhlZCgxKX1tcyAgc2xvdzUlICR7dGhpcy5wZXJmTm93LnA5NS50b0ZpeGVkKDApfW1zYDtcbiAgICB0aGlzLnVpLnJlbmRlckRlYnVnTGl2ZSgpO1xuICB9XG4gIHByaXZhdGUgYmVnaW5CYXR0bGVQZXJmKCkgeyB0aGlzLmN1ckJhdHRsZSA9IHsgZnJhbWVzOiAwLCBzdW06IDAsIHdvcnN0OiAwLCBzbG93OiAwLCBzY2FsZTogdGhpcy50aW1lU2NhbGUgfTsgfVxuICBwcml2YXRlIGVuZEJhdHRsZVBlcmYoKSB7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlOyB0aGlzLmN1ckJhdHRsZSA9IG51bGw7IGlmICghYyB8fCAhYy5mcmFtZXMpIHJldHVybjtcbiAgICB0aGlzLnBlcmZMb2cucHVzaCh7IHdhdmU6IHRoaXMucy53YXZlLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIHNwZWVkOiBjLnNjYWxlLCBmaWdodGVyczogdGhpcy5iYXR0bGUgPyB0aGlzLmJhdHRsZS5maWdodGVycy5sZW5ndGggOiAwLCBmcHM6ICsoMTAwMCAvIChjLnN1bSAvIGMuZnJhbWVzKSkudG9GaXhlZCgwKSwgd29yc3RNczogK2Mud29yc3QudG9GaXhlZCgwKSwgc2xvd1BjdDogKygoMTAwICogYy5zbG93KSAvIGMuZnJhbWVzKS50b0ZpeGVkKDEpIH0pO1xuICAgIGlmICh0aGlzLnBlcmZMb2cubGVuZ3RoID4gMTIpIHRoaXMucGVyZkxvZy5zaGlmdCgpO1xuICB9XG4gIHBlcmZJbmZvKCkge1xuICAgIGNvbnN0IHNjID0gdGhpcy5zY2VuZTsgaWYgKCF0aGlzLmluc3RyICYmIEJBQllMT04uU2NlbmVJbnN0cnVtZW50YXRpb24pIHRoaXMuaW5zdHIgPSBuZXcgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbihzYyk7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5wZXJmTm93LCBtZXNoZXM6IHNjLmdldEFjdGl2ZU1lc2hlcygpLmxlbmd0aCwgcGFydGljbGVzOiBzYy5wYXJ0aWNsZVN5c3RlbXMubGVuZ3RoLCBkcmF3czogdGhpcy5pbnN0ciA/IHRoaXMuaW5zdHIuZHJhd0NhbGxzQ291bnRlci5jdXJyZW50IDogLTEgfTtcbiAgfVxuICBwZXJmUmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcCA9IHRoaXMucGVyZkluZm8oKSwgZ2w6IGFueSA9IHRoaXMuZW5naW5lLmdldEdsSW5mbyA/IHRoaXMuZW5naW5lLmdldEdsSW5mbygpIDoge307XG4gICAgY29uc3Qgcm93cyA9IHRoaXMucGVyZkxvZy5tYXAoKHIpID0+IGAgIHdhdmUgJHtyLndhdmV9IHRyeSAke3IuYXR0ZW1wdH0gYXQgJHtyLnNwZWVkfXg6ICR7ci5mcHN9IGZwcyBhdmVyYWdlLCB3b3JzdCBmcmFtZSAke3Iud29yc3RNc31tcywgJHtyLnNsb3dQY3R9JSBzbG93IGZyYW1lcywgJHtyLmZpZ2h0ZXJzfSBmaWdodGVyc2ApO1xuICAgIHJldHVybiBbYFBFUkYgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9YCwgYGRldmljZTogJHtuYXZpZ2F0b3IudXNlckFnZW50fWAsIGBncHU6ICR7Z2wucmVuZGVyZXIgfHwgJz8nfSAoJHtnbC52ZW5kb3IgfHwgJz8nfSlgLFxuICAgICAgYHNjcmVlbiAke3NjcmVlbi53aWR0aH14JHtzY3JlZW4uaGVpZ2h0fSAgdmlld3BvcnQgJHtpbm5lcldpZHRofXgke2lubmVySGVpZ2h0fSAgZHByICR7ZGV2aWNlUGl4ZWxSYXRpb30gIHJlbmRlciAke3RoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCl9eCR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCl9ICBzY2FsaW5nIGxldmVsICR7dGhpcy5lbmdpbmUuZ2V0SGFyZHdhcmVTY2FsaW5nTGV2ZWwoKS50b0ZpeGVkKDIpfWAsXG4gICAgICBgbm93OiAke3AuZnBzLnRvRml4ZWQoMCl9IGZwcywgYXZlcmFnZSAke3AuYXZnLnRvRml4ZWQoMSl9bXMsIHNsb3dlc3QgNSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zLCB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyB8IGFjdGl2ZSBtZXNoZXMgJHtwLm1lc2hlc30sIHBhcnRpY2xlIHN5c3RlbXMgJHtwLnBhcnRpY2xlc30sIGRyYXcgY2FsbHMgJHtwLmRyYXdzfWAsXG4gICAgICBgc3RhdGU6IHBoYXNlICR7dGhpcy5waGFzZX0sIHNwZWVkICR7dGhpcy50aW1lU2NhbGV9eCwgY2FtZXJhICR7dGhpcy5jYW1Nb2RlfSwgZGlmZmljdWx0eSAke2RpZmZpY3VsdHlOYW1lfSwgd2F2ZSAke3RoaXMucy53YXZlfSwgdW5pdHMgJHt0aGlzLnMudW5pdHMubGVuZ3RofWAsXG4gICAgICBgYmF0dGxlcyAobmV3ZXN0IGxhc3QpOmAsIC4uLihyb3dzLmxlbmd0aCA/IHJvd3MgOiBbJyAgKG5vbmUgeWV0OiBwbGF5IGEgYmF0dGxlLCB0aGVuIGNvcHkgdGhpcyBhZ2FpbiknXSldLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgLyoqIEEgcnVuIHRoZSBwbGF5ZXIgaGFzIHJlYWxseSBzdGFydGVkIChzbyBIb21lIGNhbiBvZmZlciBDb250aW51ZSkuIE51bGwgYWZ0ZXIgYSBzdGFnZSB3YXMgd29uIG9yIGxvc3QsIG9yIGJlZm9yZSBhbnl0aGluZyB3YXMgZG9uZS4gKi9cbiAgcnVuSW5mbygpIHsgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzIHx8IHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gbnVsbDsgcmV0dXJuIChzLndhdmUgPiAxIHx8IHMudW5pdHMubGVuZ3RoID4gMCB8fCB0aGlzLmF0dGVtcHQgPiAwIHx8IHMuc3RhdHMuZmFpbHVyZXMgPiAwKSA/IHsgd2F2ZTogcy53YXZlLCB0b3RhbDogc3RhZ2VXYXZlcyhzKSwgaGVhcnRzOiBzLmhlYXJ0cywgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUsIHN0YWdlOiBjdXJyZW50U3RhZ2VJZCB9IDogbnVsbDsgfVxuICAvKiogRnJlc2ggcnVuIHdpdGggdGhlIGN1cnJlbnRseSBlcXVpcHBlZCBTb3VsIERlY2sgKEhvbWUgPiBTdGFydCBCYXR0bGUgY2FsbHMgdGhpcykuICovXG4gIC8qKiBHaXZlIHVwIHRoZSBydW4gaW4gcHJvZ3Jlc3MgKEhvbWUgPiBOZXcgYmF0dGxlLCBhZnRlciB0aGUgcGxheWVyIGNvbmZpcm1zKTogdGhlIHNhdmVkIHJ1biBpcyBkcm9wcGVkIGFuZCBIb21lIGxldHMgdGhlbSBwaWNrIGFueSBzdGFnZSBvciBtb2RlLiBHb2xkIGFuZCBwYWNrcyBhbHJlYWR5IGVhcm5lZCBzdGF5LiAqL1xuICBhYmFuZG9uUnVuKCkgeyB0aGlzLnN0YXJ0U3RhZ2UoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMWU2KSArIDEpOyBjbGVhclJ1bigpOyB9XG4gIG5ld1J1bigpIHsgdGhpcy5zdGFydFN0YWdlKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydFN0YWdlKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5ydW5Hb2xkID0gMDsgdGhpcy5sYXN0R29sZCA9IDA7IHRoaXMuZGFpbHkgPSBudWxsOyB0aGlzLmRhaWx5UmV3YXJkID0gbnVsbDsgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgdGhpcy5lbmRsZXNzID0gbnVsbDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpLCBwbCA9IHBsYXlhYmxlKHN2KTsgc2V0U3RhZ2VEaWZmaWN1bHR5KHBsLnN0YWdlLCBwbC5kaWZmaWN1bHR5KTsgdGhpcy5hcmVuYS5zZXRUaGVtZShjdXJyZW50U3RhZ2VJZCk7IHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uUFJPVE9UWVBFX1JVTEVTLCBwb29sOiBzdi5kZWNrIH0sIHNlZWQpOyB0aGlzLnNlZW5NZXJnZXMgPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgdGhpcy5zaG93R3JpZCh0cnVlKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTsgICAvLyAoYSBiYXR0bGUgbGVmdCBoYWxmLXdheSBoYWQgaGlkZGVuIHRoZSBncmlkKVxuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdCgnU3RhZ2Ugc3RhcnQ6IDQgY2FyZHMsICcgKyB0aGlzLnMuY2FwICsgJyBEb21pbmlvbi4gU3VtbW9uLCBtZXJnZSwgdGhlbiBwcmVzcyBCQVRUTEUuJyk7XG4gIH1cbiAgLyoqIFRvZGF5J3MgRGFpbHkgQ2hhbGxlbmdlIChIb21lID4gRGFpbHkgQ2hhbGxlbmdlKTogdGhlIHNhbWUgc2VlZCBhbmQgdHdpc3QgZm9yIGV2ZXJ5b25lIG9uIHRoZSBzYW1lIGRheS4gUmV0cnkgYXMgb2Z0ZW4gYXMgeW91IGxpa2U7IHRoZSByZXdhcmQgaXMgcGFpZCBvbmNlLiAqL1xuICBuZXdEYWlseSgpIHsgdGhpcy5zdGFydERhaWx5KGRheU51bWJlcigpKTsgfVxuICBzdGFydERhaWx5KGRheTogbnVtYmVyKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucmV3YXJkID0gbnVsbDsgdGhpcy5mbHVzaFR3ZWVucygpOyBpZiAodGhpcy5uZWNybykgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICBjb25zdCBtb2QgPSBtb2RpZmllckZvcihkYXkpLCBzdiA9IGxvYWRTYXZlKCk7IHNldERhaWx5KG1vZCwgZGF5KTsgdGhpcy5hcmVuYS5zZXRUaGVtZSgnY3J5cHQnKTtcbiAgICB0aGlzLnJ1bkdvbGQgPSAwOyB0aGlzLmxhc3RHb2xkID0gMDsgdGhpcy5kYWlseVJld2FyZCA9IG51bGw7IHRoaXMuZW5kbGVzcyA9IG51bGw7IHRoaXMuZGFpbHkgPSB7IGRheSwgbW9kIH07IHRoaXMuc2VlZCA9IGRheTsgdGhpcy5hdHRlbXB0ID0gMDtcbiAgICB0aGlzLnMgPSBuZXdTdGFnZShkYWlseVJ1bGVzKG1vZCwgc3YuZGVjayksIHRoaXMuc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdChgRGFpbHkgQ2hhbGxlbmdlOiAke21vZC5uYW1lfS4gJHttb2QudGV4dH1gKTtcbiAgfVxuICAvKiogRnJlc2ggRW5kbGVzcyBEZXB0aHMgcnVuIChIb21lID4gRW5kbGVzcyBEZXB0aHMgY2FsbHMgdGhpcyk6IHNhbWUgcnVsZXMgYXMgYSBzdGFnZSwgYnV0IHRoZSB3YXZlcyBuZXZlciBzdG9wIGFuZCB0aGUgZW5lbXkga2VlcHMgZ3Jvd2luZy4gKi9cbiAgbmV3RW5kbGVzcygpIHsgdGhpcy5zdGFydEVuZGxlc3MobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnc2VlZCcpID8gdGhpcy5zZWVkIDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMWU2KSArIDEpOyB9XG4gIHN0YXJ0RW5kbGVzcyhzZWVkOiBudW1iZXIpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5yZXdhcmQgPSBudWxsOyB0aGlzLmZsdXNoVHdlZW5zKCk7IGlmICh0aGlzLm5lY3JvKSB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIHRoaXMucnVuR29sZCA9IDA7IHRoaXMubGFzdEdvbGQgPSAwOyB0aGlzLmRhaWx5ID0gbnVsbDsgdGhpcy5kYWlseVJld2FyZCA9IG51bGw7IHRoaXMuc2VlZCA9IHNlZWQ7IHRoaXMuYXR0ZW1wdCA9IDA7IGNvbnN0IHN2ID0gbG9hZFNhdmUoKTsgc2V0RW5kbGVzcygpOyB0aGlzLmFyZW5hLnNldFRoZW1lKEVORExFU1NfSUQpO1xuICAgIHRoaXMuZW5kbGVzcyA9IHsgc3RhcnRCZXN0OiBzdi5lbmRsZXNzLmJlc3QsIGNsZWFyZWQ6IDAsIHBhY2tzOiAwIH07XG4gICAgdGhpcy5zID0gbmV3U3RhZ2UoeyAuLi5FTkRMRVNTX1JVTEVTLCBwb29sOiBzdi5kZWNrIH0sIHNlZWQpOyB0aGlzLnNlZW5NZXJnZXMgPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgdGhpcy5zaG93R3JpZCh0cnVlKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTsgICAvLyAoYSBiYXR0bGUgbGVmdCBoYWxmLXdheSBoYWQgaGlkZGVuIHRoZSBncmlkKVxuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdCgnRW5kbGVzcyBEZXB0aHM6IGhvdyBkZWVwIGNhbiB5b3UgZ28/IEEgU291bCBQYWNrIGV2ZXJ5IDEwIHdhdmVzLicpO1xuICB9XG4gIHByaXZhdGUgY2xlYXJCYXR0bGUoKSB7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LmRpc3Bvc2UoKTsgfSk7IHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7IHRoaXMuYmF0dGxlID0gbnVsbDtcbiAgICB0aGlzLmFycm93cy5mb3JFYWNoKChhKSA9PiBhLm1lc2guZGlzcG9zZSgpKTsgdGhpcy5hcnJvd3MgPSBbXTtcbiAgfVxuICBwcml2YXRlIHBvcyhjZWxsOiBudW1iZXIpIHsgcmV0dXJuIGNlbGxQb3MoMCwgY2VsbCk7IH1cbiAgLyoqIEZvciB0aGUgdHV0b3JpYWwgc3BvdGxpZ2h0OiB3aGVyZSBhbiBlbXB0eSB0aWxlICh0aGUgb25lIG5lYXJlc3QgdGhlIG1pZGRsZSBvZiB0aGUgZ3JpZCkgaXMgb24gdGhlIHNjcmVlbiwgaW4gQ1NTIHBpeGVscywgb3IgbnVsbC4gKi9cbiAgZW1wdHlUaWxlUmVjdCgpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB3OiBudW1iZXI7IGg6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgaWYgKCF0aGlzLnMgfHwgIXRoaXMuY2FudmFzIHx8IHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHVzZWQgPSBuZXcgU2V0KHRoaXMucy51bml0cy5tYXAoKHU6IGFueSkgPT4gdS5jZWxsKSk7IGxldCBteCA9IDAsIG16ID0gMDsgY29uc3QgYWxsID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogR1JJRF9DRUxMUyB9LCAoXywgYykgPT4gdGhpcy5wb3MoYykpOyBhbGwuZm9yRWFjaCgocCkgPT4geyBteCArPSBwLnggLyBHUklEX0NFTExTOyBteiArPSBwLnogLyBHUklEX0NFTExTOyB9KTtcbiAgICBsZXQgYmVzdCA9IC0xLCBiZCA9IDFlOTsgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHsgaWYgKHVzZWQuaGFzKGMpKSBjb250aW51ZTsgY29uc3QgZCA9IE1hdGguaHlwb3QoYWxsW2NdLnggLSBteCwgYWxsW2NdLnogLSBteik7IGlmIChkIDwgYmQpIHsgYmQgPSBkOyBiZXN0ID0gYzsgfSB9XG4gICAgaWYgKGJlc3QgPCAwKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwID0gYWxsW2Jlc3RdLCBoID0gR1JJRF9TUCAqIDAuNDYsIFcgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpLCBIID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHZwID0gdGhpcy5jYW1lcmEudmlld3BvcnQudG9HbG9iYWwoVywgSCksIG0gPSB0aGlzLnNjZW5lLmdldFRyYW5zZm9ybU1hdHJpeCgpO1xuICAgIGNvbnN0IHB0cyA9IFtbLWgsIC1oXSwgW2gsIC1oXSwgW2gsIGhdLCBbLWgsIGhdXS5tYXAoKFtkeCwgZHpdKSA9PiBCQUJZTE9OLlZlY3RvcjMuUHJvamVjdChuZXcgQkFCWUxPTi5WZWN0b3IzKHAueCArIGR4LCAwLjAyLCBwLnogKyBkeiksIEJBQllMT04uTWF0cml4LklkZW50aXR5KCksIG0sIHZwKSk7XG4gICAgY29uc3QgciA9IHRoaXMuY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLCBreCA9IHIud2lkdGggLyBXLCBreSA9IHIuaGVpZ2h0IC8gSCwgeHMgPSBwdHMubWFwKChxOiBhbnkpID0+IHEueCksIHlzID0gcHRzLm1hcCgocTogYW55KSA9PiBxLnkpO1xuICAgIGNvbnN0IHgwID0gTWF0aC5taW4oLi4ueHMpLCB4MSA9IE1hdGgubWF4KC4uLnhzKSwgeTAgPSBNYXRoLm1pbiguLi55cyksIHkxID0gTWF0aC5tYXgoLi4ueXMpO1xuICAgIGlmICghaXNGaW5pdGUoeDAgKyB4MSArIHkwICsgeTEpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyB4OiByLmxlZnQgKyB4MCAqIGt4LCB5OiByLnRvcCArIHkwICoga3ksIHc6ICh4MSAtIHgwKSAqIGt4LCBoOiAoeTEgLSB5MCkgKiBreSB9O1xuICB9XG4gIHN5bmNCdWlsZCgpIHtcbiAgICB0aGlzLnBlcnNpc3RSdW4oKTtcbiAgICBjb25zdCBtZXJnZWQgPSB0aGlzLnMuc3RhdHMubWVyZ2VzID4gdGhpcy5zZWVuTWVyZ2VzOyB0aGlzLnNlZW5NZXJnZXMgPSB0aGlzLnMuc3RhdHMubWVyZ2VzO1xuICAgIGNvbnN0IGdyb3duID0gbWVyZ2VkID8gdGhpcy5zLnVuaXRzLmZpbmQoKHUpID0+IHsgY29uc3QgZ3YgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpOyByZXR1cm4gISFndiAmJiBndi5zdGFyICE9PSB1LnN0YXI7IH0pIDogdW5kZWZpbmVkOyAgIC8vIHRoZSB1bml0IHRoYXQganVzdCBnYWluZWQgYSBzdGFyXG4gICAgY29uc3QgYWxpdmUgPSBuZXcgU2V0KHRoaXMucy51bml0cy5tYXAoKHUpID0+IHUuaWQpKTtcbiAgICBmb3IgKGNvbnN0IFtpZCwgdl0gb2YgdGhpcy51bml0VmlzKSBpZiAoIWFsaXZlLmhhcyhpZCkpIHtcbiAgICAgIHRoaXMudmlzVG9Vbml0LmRlbGV0ZSh2KTsgdGhpcy51bml0VmlzLmRlbGV0ZShpZCk7IGNvbnN0IHAgPSB2LmhvbGRlci5wb3NpdGlvbjtcbiAgICAgIGlmIChncm93bikgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG1lcmdlOiB0aGUgY29uc3VtZWQgdW5pdCBpcyBkcmF3biBpbnRvIHRoZSBzdXJ2aXZvciBhbmQgdmFuaXNoZXMgaW4gYSBmbGFzaFxuICAgICAgICBjb25zdCB0byA9IHRoaXMucG9zKGdyb3duLmNlbGwpLCB4MCA9IHAueCwgejAgPSBwLnosIHNjID0gdi5ob2xkZXIuc2NhbGluZy54OyB2LnBsYXkoJ2lkbGUnKTtcbiAgICAgICAgdGhpcy50d2VlbigwLjMzLCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuNCwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LmhvbGRlci5zY2FsaW5nLnNldEFsbChzYyAqICgxIC0gMC43NSAqIHQpKTsgfSxcbiAgICAgICAgICAoKSA9PiB7IHRoaXMuYnVyc3QodG8ueCwgdG8ueiwgWzAuODUsIDAuNiwgMSwgMC45XSwgWzAuNSwgMC4zLCAxLCAwLjddLCAxNCk7IHYuZGlzcG9zZSgpOyB9KTtcbiAgICAgIH0gZWxzZSB7IHRoaXMuYnVyc3QocC54LCBwLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTYpOyB2LmRpc3Bvc2UoKTsgfVxuICAgIH1cbiAgICBjb25zdCBsdmxzID0gbG9hZFNhdmUoKS5zb3VscztcbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7XG4gICAgICBsZXQgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpO1xuICAgICAgaWYgKCF2KSB7IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCB1LnNvdWwsIDAsIHUuc3Rhcik7IHRoaXMudW5pdFZpcy5zZXQodS5pZCwgdik7IHRoaXMudmlzVG9Vbml0LnNldCh2LCB1LmlkKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopOyBhdWRpby5wbGF5KCdzdW1tb24nKTsgY29uc3QgdnYgPSB2OyB0aGlzLmxhdGVyKDEuMSwgKCkgPT4geyBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJykgdnYucGxheSgnaWRsZScpOyB9KTsgfVxuICAgICAgZWxzZSB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgaWYgKHYuc3RhciAhPT0gdS5zdGFyKSB7IGNvbnN0IGZ2ID0gdjsgdi5zZXRTdGFyKHUuc3Rhcik7IHRoaXMubGF0ZXIoZ3Jvd24gJiYgZ3Jvd24uaWQgPT09IHUuaWQgPyAwLjMzIDogMCwgKCkgPT4gdGhpcy5tZXJnZUZ4KGZ2LCBwLngsIHAueikpOyB9IH1cbiAgICB9XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgeyBjb25zdCB2diA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IGlmICh2diAmJiB2di5zZXRMZXZlbCkgdnYuc2V0TGV2ZWwoKGx2bHMgYXMgYW55KVt1LnNvdWxdPy5sZXZlbCA/PyAxKTsgfVxuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsO1xuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB7XG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCBjYW5TdW1tb24odGhpcy5zLCBzZWwuaWR4KSA/ICdmcmVlJyA6ICdub3JtYWwnKTtcbiAgICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZUZyb21IYW5kKHRoaXMucywgc2VsLmlkeCwgdS5pZCkpIHRoaXMudGludCh1LmNlbGwsICdwYXJ0bmVyJyk7ICAgICAvLyB0aGUgY2FyZCBjYW4gbWVyZ2UgaW50byB0aGlzIHVuaXRcbiAgICB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7XG4gICAgICBjb25zdCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7XG4gICAgICBpZiAodSkgeyB0aGlzLnRpbnQodS5jZWxsLCAnc2VsJyk7IGZvciAoY29uc3QgbyBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZURlcGxveWVkKHUsIG8pKSB0aGlzLnRpbnQoby5jZWxsLCAncGFydG5lcicpOyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCAnZnJlZScpOyB9XG4gICAgfVxuICB9XG4gIC8qKiBUaGUgbWVyZ2UgbW9tZW50OiBhIGZsYXNoIG9mIHJpbmdzIGFuZCBzcGFya3MsIGEgcHVuY2ggaW4gc2l6ZSwgYSByaXNpbmcgY2hpbWUuICovXG4gIHByaXZhdGUgbWVyZ2VGeCh2OiBVbml0VmlzdWFsLCB4OiBudW1iZXIsIHo6IG51bWJlcikge1xuICAgIGF1ZGlvLnBsYXkoJ21lcmdlJyk7IHYucHVsc2UoKTsgaWYgKCF0aGlzLmluc3BlY3RpbmcpIHRoaXMudmZ4LmFycml2ZSh4LCB6LCB2LnN0YXIpOyBjb25zdCB0YXJnZXQgPSB2LmhvbGRlci5zY2FsaW5nLng7XG4gICAgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuNCksIDAuMiwgMi4wLCAwLjY1KTsgdGhpcy5sYXRlcigwLjEyLCAoKSA9PiB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMSwgMSksIDAuMiwgMy4wLCAwLjgpKTtcbiAgICB0aGlzLmJ1cnN0KHgsIHosIFsxLCAwLjg1LCAwLjQsIDAuOV0sIFswLjgsIDAuNCwgMSwgMC44XSwgNDYpOyB0aGlzLmJ1cnN0KHgsIHosIFswLjg1LCAwLjYsIDEsIDAuOV0sIFswLjUsIDAuMywgMSwgMC43XSwgMjQpO1xuICAgIHRoaXMudHdlZW4oMC41NSwgKHQpID0+IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRhcmdldCAqICgxICsgMC40NSAqIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqICgxIC0gdCAqIDAuNCkpKSwgKCkgPT4gdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGFyZ2V0KSk7XG4gIH1cbiAgcHJpdmF0ZSBzdW1tb25GeCh4OiBudW1iZXIsIHo6IG51bWJlcikgeyBpZiAoIXRoaXMuYWN0aXZlKSByZXR1cm47IHRoaXMudmZ4LmFycml2ZSh4LCB6LCAxKTsgdGhpcy5idXJzdCh4LCB6LCBbMC43LCAwLjMsIDEsIDAuOV0sIFswLjM1LCAwLjEsIDAuNywgMC44XSwgMzApOyB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjMsIDEpLCAwLjIsIDEuMiwgMC43KTsgfVxuXG4gIC8vIC0tLS0gcGxheWVyIGFjdGlvbnMgKGJ1aWxkIHBoYXNlKVxuICB0b2FzdChtc2c6IHN0cmluZykgeyB0aGlzLnVpLnRvYXN0KG1zZyk7IH1cbiAgb25DYXJkKGlkeDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoZGlzY2FyZFJlZHJhdyh0aGlzLnMsIGlkeCkpIHsgdGhpcy50b2FzdCgnU3dhcHBlZDogZHJldyBhIGRpZmZlcmVudCBTb3VsLicpOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnNlbC5pZHggPT09IGlkeCA/IG51bGwgOiB7IHR5cGU6ICdjYXJkJywgaWR4IH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25UaWxlKGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IGhlcmUgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7IGlmIChoZXJlKSB7IHRoaXMub25Vbml0VmlzdWFsKHRoaXMudW5pdFZpcy5nZXQoaGVyZS5pZCkhKTsgcmV0dXJuOyB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnKSB7XG4gICAgICBpZiAoY2FuU3VtbW9uKHMsIHNlbC5pZHgpKSB7IHN1bW1vbihzLCBzZWwuaWR4LCBjZWxsKTsgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgICBlbHNlIHsgY29uc3Qgc291bCA9IHMuaGFuZFtzZWwuaWR4XTsgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbjogJHtTT1VMX05BTUVbc291bF19IGNvc3RzICR7Y29zdChzb3VsLCAxKX0sIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApOyB9XG4gICAgfSBlbHNlIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0JykgeyBpZiAobW92ZVVuaXQocywgc2VsLmlkLCBjZWxsKSkgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25Vbml0VmlzdWFsKHY6IFVuaXRWaXN1YWwpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMudmlzVG9Vbml0LmdldCh2KTsgaWYgKGlkID09PSB1bmRlZmluZWQgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKSE7XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKHN3YXBTZWxsKHMsIGlkKSkgeyB0aGlzLnRvYXN0KGBTb2xkICR7U09VTF9OQU1FW3Uuc291bF19OiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuYCk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QodS5mcmVzaCA/IFwiWW91IGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kLlwiIDogJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgcy5oYW5kW3RoaXMuc2VsLmlkeF0gPT09IHUuc291bCAmJiB1LnN0YXIgPT09IDEgJiYgcy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicpIHtcbiAgICAgIGlmIChtZXJnZUZyb21IYW5kKHMsIHRoaXMuc2VsLmlkeCwgaWQpKSB7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCB0aGUgY2FyZCBpbnRvIGEgMi1zdGFyICR7U09VTF9OQU1FW3Uuc291bF19IWApOyB9XG4gICAgICBlbHNlIHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb24gdG8gbWVyZ2U6IGl0IG5lZWRzICR7Y29zdCh1LnNvdWwsIDIpIC0gY29zdCh1LnNvdWwsIDEpfSBtb3JlLCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkICE9PSBpZCkge1xuICAgICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gKHRoaXMuc2VsIGFzIGFueSkuaWQpITtcbiAgICAgIGlmIChjYW5NZXJnZURlcGxveWVkKGEsIHUpKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgdS5pZCk7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkOiBhLmlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIH0gZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCA9PT0gaWQgPyBudWxsIDogeyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgbWVyZ2VTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7IGNvbnN0IGIgPSBhICYmIHMudW5pdHMuZmluZCgobykgPT4gY2FuTWVyZ2VEZXBsb3llZChhLCBvKSk7XG4gICAgaWYgKGEgJiYgYikgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIGIuaWQpOyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy50b2FzdCgnTm8gbWF0Y2hpbmcgdW5pdCAoc2FtZSBTb3VsIGFuZCBzdGFycykgdG8gbWVyZ2Ugd2l0aC4nKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHJlbW92ZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmNvbmZpcm1SZW1vdmUpIHsgdGhpcy5jb25maXJtUmVtb3ZlID0gdHJ1ZTsgdGhpcy50b2FzdCgnVGFwIFJlbW92ZSBhZ2FpbiB0byBjb25maXJtLiBUaGUgY2FyZCBpcyBnb25lIGZvciB0aGlzIHN0YWdlLicpOyB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47IH1cbiAgICBkaXNtaXNzKHRoaXMucywgc2VsLmlkKTsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICB0b2dnbGVTd2FwKCkgeyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuOyBpZiAodGhpcy5zLmRpc2NhcmRVc2VkKSB7IHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IHJldHVybjsgfSB0aGlzLnN3YXBNb2RlID0gIXRoaXMuc3dhcE1vZGU7IHRoaXMuc2VsID0gbnVsbDsgaWYgKHRoaXMuc3dhcE1vZGUpIHRoaXMudG9hc3QoJ1N3YXA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkLCBvciBhIHVuaXQgKG5vdCBzdW1tb25lZCB0aGlzIHJvdW5kKSB0byBzZWxsLicpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gYmF0dGxlXG4gIHN0YXJ0QmF0dGxlKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICF0aGlzLnMudW5pdHMubGVuZ3RoKSB7IGlmICghdGhpcy5zLnVuaXRzLmxlbmd0aCkgdGhpcy50b2FzdCgnU3VtbW9uIGF0IGxlYXN0IG9uZSB1bml0IGZpcnN0LicpOyByZXR1cm47IH1cbiAgICB0aGlzLmZsdXNoVHdlZW5zKCk7IGF1ZGlvLnBsYXkoJ3N0YXJ0Jyk7IHRoaXMuYmVnaW5CYXR0bGVQZXJmKCk7IHRoaXMuc2hvd0dyaWQoZmFsc2UpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmF0dGVtcHQrKzsgdGhpcy5oYW5kbGVkID0gZmFsc2U7IHRoaXMucmVzdWx0QXQgPSAtMTtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1bml0cyA9IHMudW5pdHMuc2xpY2UoKTtcbiAgICBjb25zdCBzYXZlZCA9IGxvYWRTYXZlKCkuc291bHMsIGxldmVsczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9OyBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoc2F2ZWQpKSBsZXZlbHNba10gPSAoc2F2ZWQgYXMgYW55KVtrXS5sZXZlbDsgICAvLyBwZXJtYW5lbnQgU291bCBsZXZlbHNcbiAgICB0aGlzLmJhdHRsZSA9IG5ldyBCYXR0bGUodW5pdHMubWFwKCh1KSA9PiAoeyBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsIH0pKSwgZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKSwgdGhpcy5zZWVkICogMTMxICsgcy53YXZlICogMTcgKyB0aGlzLmF0dGVtcHQsIGxldmVscywgZW5lbXlQb3dlcihzLndhdmUpKTtcbiAgICB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpO1xuICAgIHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmZvckVhY2goKGYpID0+IHtcbiAgICAgIGlmIChmLnRlYW0gPT09IDApIHsgY29uc3QgdSA9IHVuaXRzW2YuaWQgLSAxXTsgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmZVbml0LnNldChmLmlkLCB1LmlkKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBmLnNvdWwsIDEsIGYuc3Rhcik7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChmLngsIDAsIGYueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSAtTWF0aC5QSSAvIDI7IGlmIChmLmJvc3MgJiYgdi5zZXRCb3NzKSB2LnNldEJvc3ModHJ1ZSk7IHYucGxheSgnc3Bhd24nKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHYuc3RhdGUgPT09ICdzcGF3bicpIHYucGxheSgnaWRsZScpOyB9KTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNywgMC42LCAwLjUsIDAuN10sIFswLjQsIDAuMzUsIDAuMywgMC42XSwgMTQpOyB9XG4gICAgfSk7XG4gICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHRoaXMudGludChjLCAnbm9ybWFsJyk7XG4gICAgdGhpcy5waGFzZSA9ICd0cmFuc2l0aW9uJzsgdGhpcy5zdGFydFN0ZXBBdCA9IDEuMDsgdGhpcy5hY2MgPSAwOyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDIuMik7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuYmF0dGxlUm9hcigpO1xuICAgIGZvciAoY29uc3QgZiBvZiB0aGlzLmJhdHRsZS5maWdodGVycykgaWYgKGYuYm9zcykgdGhpcy5sYXRlcigxLjE1LCAoKSA9PiB0aGlzLnZmeC5ib3NzSW50cm8oZi54LCBmLnopKTtcbiAgfVxuICBwcml2YXRlIGFwcGx5RXZlbnRzKGV2czogQkV2ZW50W10pIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhO1xuICAgIGZvciAoY29uc3QgZSBvZiBldnMpIHtcbiAgICAgIGlmIChlLnQgPT09ICdzd2luZycpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB2LnBsYXkoJ2F0dGFjaycsIGUuc3BlZWQpOyBpZiAoTWF0aC5yYW5kb20oKSA8IDAuMDgpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKTsgaWYgKGYpIGF1ZGlvLmJhcmsoZi5zb3VsLCAwLCBmLnRlYW0gPT09IDAgPyAxIDogMC44NSk7IH0gfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnaGl0JykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLnRvKTsgaWYgKHYpIHsgdi5wdWxzZSgpOyBjb25zdCB0ZiA9IGIuYnlJZChlLnRvKSwgZmYgPSBiLmJ5SWQoZS5mcm9tKTsgaWYgKHRmICYmIGZmKSB0aGlzLnZmeC5oaXQoZS50bywgdGYueCwgdGYueiwgdi50b3AgKiB2LmhvbGRlci5zY2FsaW5nLngsIGUuZG1nLCBmZi50ZWFtID09PSAwLCBlLmtpbmQgPT09ICdzbWFzaCcgfHwgISF0Zi5ib3NzIHx8IGUuZG1nID49IHRmLm1heEhwICogMC4xMiwgZS5raW5kKTsgfSBpZiAoZS5raW5kID09PSAnYXJyb3cnKSBhdWRpby5wbGF5KCdoaXRBcnJvdycpOyBlbHNlIGlmIChlLmtpbmQgPT09ICdtZWxlZScpIGF1ZGlvLnBsYXkoJ2hpdCcpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdhcnJvdycpIHsgY29uc3QgZiA9IGIuYnlJZChlLmZyb20pISwgdG8gPSBiLmJ5SWQoZS50bykhOyB0aGlzLnNwYXduQXJyb3coZi50ZWFtLCBmLngsIGYueiwgdG8ueCwgdG8ueiwgZS5kdXIpOyBhdWRpby5wbGF5KCdhcnJvdycpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdkZWF0aCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB7IHYucGxheSgnZGVhdGgnKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnZGVhdGgnKTsgdGhpcy52ZnguZGVhdGgoZi54LCBmLnosIGYudGVhbSA9PT0gMSwgdi50b3AgKiB2LmhvbGRlci5zY2FsaW5nLngpOyBpZiAoZi50ZWFtID09PSAxKSB0aGlzLmxhdGVyKDUsICgpID0+IHsgaWYgKHRoaXMuZnZpcy5nZXQoZS5pZCkgPT09IHYgJiYgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgeyB2LmhvbGRlci5zZXRFbmFibGVkKGZhbHNlKTsgfSB9KTsgfSB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdjYXN0JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnY2FzdCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNSwgMC44LCAxKSwgMC4xNSwgMS4xLCAwLjM1KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAndGF1bnQnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCd0YXVudCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuMyksIDAuMywgQkFMQU5DRS50YXVudC5yYWRpdXMsIDAuNik7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3NtYXNoJykgeyBhdWRpby5wbGF5KCdzbWFzaCcpOyB0aGlzLnZmeC5zbGFtKGUueCwgZS56LCBlLnIpOyB0aGlzLmZ4UmluZyhlLngsIGUueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNSwgMC4yKSwgMC4yLCBlLnIgKiAxLjYsIDAuNDUpOyB9XG4gICAgfVxuICB9XG4gIHByaXZhdGUgYXJyb3dCYXNlOiBhbnlbXSA9IFtdO1xuICAvKiogVGhlIGFycm93J3Mgb3duIG1hdGVyaWFsIHdpdGggYSBmYWludCBnbG93IGluIHRoZSB0ZWFtIGNvbG91ciAocHVycGxlIGZvciB5b3VycywgYW1iZXIgZm9yIHRoZSBlbmVteSdzKSwgc28geW91IGNhbiBzdGlsbCB0ZWxsIHdob3NlIGl0IGlzLiAqL1xuICBwcml2YXRlIGFycm93VGVhbU1hdCh0ZWFtOiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5hcnJvd0Jhc2VbdGVhbV0pIHJldHVybiB0aGlzLmFycm93QmFzZVt0ZWFtXTtcbiAgICBjb25zdCBzcmMgPSB0aGlzLkEuYXJyb3cubWF0ZXJpYWxzICYmIHRoaXMuQS5hcnJvdy5tYXRlcmlhbHNbMF07IGlmICghc3JjKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBtID0gc3JjLmNsb25lKCdhcnJvd1QnICsgdGVhbSk7IGNvbnN0IGMgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNTUsIDAuMiwgMC44NSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC45LCAwLjU1LCAwLjE1KTtcbiAgICBpZiAoJ2VtaXNzaXZlQ29sb3InIGluIG0pIG0uZW1pc3NpdmVDb2xvciA9IGMuc2NhbGUoMC4wMzUpOyB0aGlzLmFycm93QmFzZVt0ZWFtXSA9IG07IHJldHVybiBtO1xuICB9XG4gIHByaXZhdGUgc3Bhd25BcnJvdyh0ZWFtOiBudW1iZXIsIHgwOiBudW1iZXIsIHowOiBudW1iZXIsIHgxOiBudW1iZXIsIHoxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgbGV0IG1lc2ggPSB0aGlzLmFycm93TWVzaC5wb3AoKTtcbiAgICBpZiAoIW1lc2gpIHtcbiAgICAgIGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2FyJywgdGhpcy5zY2VuZSk7IGhvbGRlci5zY2FsaW5nLnNldEFsbCgwLjY1KTsgICAvLyA1NSBjbSB3YXMgbG9uZyBuZXh0IHRvIGEgY2hpYmkgR29ibGluXG4gICAgICBpZiAodGhpcy5BLmFycm93KSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHJlYWwgYXJyb3cgbW9kZWwgKG1ldGFsIGhlYWQsIGZsZXRjaGluZyk6IG9uZSBpbnN0YW5jZSBwZXIgZmx5aW5nIGFycm93XG4gICAgICAgIGNvbnN0IGVudCA9IHRoaXMuQS5hcnJvdy5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpLCBmYWxzZSk7XG4gICAgICAgIGVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gaG9sZGVyOyBlbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IH0pO1xuICAgICAgfSBlbHNlIHsgY29uc3QgY3lsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignYXJyb3cnLCB7IGhlaWdodDogMC41NSwgZGlhbWV0ZXI6IDAuMDM1IH0sIHRoaXMuc2NlbmUpOyBjeWwucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyBjeWwuaXNQaWNrYWJsZSA9IGZhbHNlOyBjeWwucGFyZW50ID0gaG9sZGVyOyBjeWwubWF0ZXJpYWwgPSB0aGlzLmFycm93TWF0c1t0ZWFtXTsgfVxuICAgICAgbWVzaCA9IGhvbGRlcjtcbiAgICB9XG4gICAgbWVzaC5zZXRFbmFibGVkKHRydWUpO1xuICAgIGlmICh0aGlzLkEuYXJyb3cpIHsgY29uc3QgdG0gPSB0aGlzLmFycm93VGVhbU1hdCh0ZWFtKTsgbWVzaC5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBpZiAodG0pIG0ubWF0ZXJpYWwgPSB0bTsgfSk7IH1cbiAgICB0aGlzLmFycm93cy5wdXNoKHsgbWVzaCwgeDAsIHowLCB4MSwgejEsIHQ6IDAsIGR1ciwgdGVhbSB9KTtcbiAgfVxuXG4gIC8qKiBCYXR0bGUgY3J5OiB1cCB0byB0aHJlZSBkaWZmZXJlbnQgU291bHMgZnJvbSB5b3VyIGFybXkgYmVsbG93IGluIHR1cm4sIGFuZCBvbmUgZnJvbSB0aGUgZW5lbXkgYW5zd2VycywgYSBsaXR0bGUgbG93ZXIuICovXG4gIHByaXZhdGUgYmF0dGxlUm9hcigpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7IGlmICghYikgcmV0dXJuOyBjb25zdCBtaW5lID0gbmV3IFNldDxzdHJpbmc+KCksIHRoZWlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSAoZi50ZWFtID09PSAwID8gbWluZSA6IHRoZWlycykuYWRkKGYuc291bCk7XG4gICAgWy4uLm1pbmVdLnNsaWNlKDAsIDMpLmZvckVhY2goKHNvdWwsIGkpID0+IGF1ZGlvLmJhcmsoc291bCwgMC4xNSArIDAuMTYgKiBpLCAxKSk7IGNvbnN0IGUgPSBbLi4udGhlaXJzXVswXTsgaWYgKGUpIGF1ZGlvLmJhcmsoZSwgMC41NSwgMC44Mik7XG4gIH1cblxuICBwcml2YXRlIGZyYW1lKGR0OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5jYW52YXMuY2xpZW50V2lkdGggIT09IHRoaXMubGFzdFcgfHwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0ICE9PSB0aGlzLmxhc3RIKSB0aGlzLmhhbmRsZVJlc2l6ZSgpOyAgIC8vIGUuZy4gdGhlIGhvbWUtc2NyZWVuIGFwcCByZXNpemluZyBhZnRlciBsYXVuY2hcbiAgICB0aGlzLmNhbWVyYS5wb3NpdGlvbi5zdWJ0cmFjdEluUGxhY2UodGhpcy52Zngub2ZmKTtcbiAgICBmb3IgKGxldCBpID0gdGhpcy50aW1lcnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgdGhpcy50aW1lcnNbaV0udCAtPSBkdDsgaWYgKHRoaXMudGltZXJzW2ldLnQgPD0gMCkgeyBjb25zdCBmID0gdGhpcy50aW1lcnNbaV0uZm47IHRoaXMudGltZXJzLnNwbGljZShpLCAxKTsgZigpOyB9IH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5yaW5nRngubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgciA9IHRoaXMucmluZ0Z4W2ldOyByLnQgKz0gZHQ7IGNvbnN0IHUgPSByLnQgLyByLmR1ciwgcyA9IHIucjAgKyAoci5yMSAtIHIucjApICogdTsgci5tLnNjYWxpbmcuc2V0KHMsIHMsIHMpOyByLm1tLmFscGhhID0gMC45ICogKDEgLSB1KTsgaWYgKHUgPj0gMSkgeyByLm0uZGlzcG9zZSgpOyByLm1tLmRpc3Bvc2UoKTsgdGhpcy5yaW5nRnguc3BsaWNlKGksIDEpOyB9IH1cbiAgICBpZiAodGhpcy5jYW1UIDwgMSkgeyB0aGlzLmNhbVQgPSBNYXRoLm1pbigxLCB0aGlzLmNhbVQgKyBkdCAvIHRoaXMuY2FtRHVyKTsgY29uc3QgZSA9IHRoaXMuY2FtVCAqIHRoaXMuY2FtVCAqICgzIC0gMiAqIHRoaXMuY2FtVCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnBvcywgdGhpcy5jYW1Uby5wb3MsIGUpOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS50Z3QsIHRoaXMuY2FtVG8udGd0LCBlKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgJiYgdGhpcy5jYW1Nb2RlID09PSAnY2xvc2UnICYmICF0aGlzLmNpbmUpIHRoaXMuZnJhbWVCYXR0bGUoZHQpO1xuICAgIHRoaXMubmVjcm8udXBkYXRlKGR0KTtcbiAgICBmb3IgKGxldCBpID0gdGhpcy50d2VlbnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgdyA9IHRoaXMudHdlZW5zW2ldOyB3LnQgKz0gZHQ7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCB3LnQgLyB3LmR1cik7IHcuZm4odSk7IGlmICh1ID49IDEpIHsgdGhpcy50d2VlbnMuc3BsaWNlKGksIDEpOyBpZiAody5kb25lKSB3LmRvbmUoKTsgfSB9XG4gICAgZm9yIChjb25zdCB2IG9mIHRoaXMudW5pdFZpcy52YWx1ZXMoKSkgdi51cGRhdGUoZHQpO1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi51cGRhdGUoZHQpOyB9KTtcblxuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTtcbiAgICBpZiAoKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJyB8fCB0aGlzLnBoYXNlID09PSAnYmF0dGxlJykgJiYgYikge1xuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykgeyB0aGlzLnN0YXJ0U3RlcEF0IC09IGR0OyBpZiAodGhpcy5zdGFydFN0ZXBBdCA8PSAwKSB7IHRoaXMucGhhc2UgPSAnYmF0dGxlJzsgdGhpcy51aS5yZW5kZXIoKTsgfSB9XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpIHtcbiAgICAgICAgdGhpcy5hY2MgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTtcbiAgICAgICAgd2hpbGUgKHRoaXMuYWNjID49IDEgLyAzMCAmJiBiLndpbm5lciA8IDApIHsgYi5zdGVwKDEgLyAzMCk7IHRoaXMuYWNjIC09IDEgLyAzMDsgdGhpcy5hcHBseUV2ZW50cyhiLmRyYWluKCkpOyB9XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgaWYgKCF0aGlzLmNpbmUgJiYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IGYudGVhbSA9PT0gMSkpIHsgdi5ob2xkZXIucG9zaXRpb24ueCA9IGYueDsgdi5ob2xkZXIucG9zaXRpb24ueiA9IGYuejsgaWYgKGYuYWxpdmUgfHwgdHJ1ZSkgdi5ob2xkZXIucm90YXRpb24ueSA9IGYueWF3OyB9XG4gICAgICAgIGlmIChmLmFsaXZlKSB7IHYuc2V0SHAoZi5ocCAvIGYubWF4SHApOyBpZiAoZi5tYXhNYW5hKSB2LnNldE1hbmEoZi5tYW5hIC8gZi5tYXhNYW5hKTsgfVxuICAgICAgICBlbHNlIHYuc2V0TWFuYShudWxsKTtcbiAgICAgICAgaWYgKGYuc3RhdGUgIT09ICdhdHRhY2snICYmIGYuYWxpdmUgJiYgdi5zdGF0ZSAhPT0gJ2NoZWVyJykgeyBjb25zdCB3YW50ID0gZi5zdGF0ZSA9PT0gJ3J1bicgPyAncnVuJyA6ICdpZGxlJzsgaWYgKHRoaXMubGFzdFN0YXRlLmdldChmLmlkKSAhPT0gd2FudCB8fCAodi5zdGF0ZSAhPT0gd2FudCAmJiB2LnN0YXRlICE9PSAnc3Bhd24nKSkgeyBpZiAodi5zdGF0ZSAhPT0gJ3NwYXduJykgeyB2LnBsYXkod2FudCBhcyBhbnkpOyB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgd2FudCk7IH0gfSB9XG4gICAgICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsICdhdHRhY2snKTtcbiAgICAgIH1cbiAgICAgIGlmIChiLndpbm5lciA+PSAwICYmICF0aGlzLmhhbmRsZWQpIHsgdGhpcy5oYW5kbGVkID0gdHJ1ZTsgdGhpcy5yZXN1bHRBdCA9IDEuNDsgfVxuICAgICAgaWYgKHRoaXMucmVzdWx0QXQgPiAwKSB7IHRoaXMucmVzdWx0QXQgLT0gZHQ7IGlmICh0aGlzLnJlc3VsdEF0IDw9IDApIHRoaXMuaGFuZGxlUmVzdWx0KCk7IH1cbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuYXJyb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBhID0gdGhpcy5hcnJvd3NbaV07IGEudCArPSBkdCAqIHRoaXMudGltZVNjYWxlOyBjb25zdCB1ID0gTWF0aC5taW4oMSwgYS50IC8gYS5kdXIpO1xuICAgICAgY29uc3QgcHggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUsIHB6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1LCBweSA9IDAuNzUgKyBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjkgLSB1ICogMC4yNTtcbiAgICAgIGNvbnN0IHUyID0gTWF0aC5taW4oMSwgdSArIDAuMDMpLCBxeCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdTIsIHF6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1MiwgcXkgPSAwLjc1ICsgTWF0aC5zaW4odTIgKiBNYXRoLlBJKSAqIDAuOSAtIHUyICogMC4yNTtcbiAgICAgIGEubWVzaC5wb3NpdGlvbi5zZXQocHgsIHB5LCBweik7IGEubWVzaC5sb29rQXQobmV3IEJBQllMT04uVmVjdG9yMyhxeCwgcXksIHF6KSk7XG4gICAgICB0aGlzLnZmeC50cmFpbChweCwgcHksIHB6LCBhLnRlYW0gPT09IDApO1xuICAgICAgaWYgKHUgPj0gMSkgeyBhLm1lc2guc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuYXJyb3dNZXNoLnB1c2goYS5tZXNoKTsgdGhpcy5hcnJvd3Muc3BsaWNlKGksIDEpOyB9XG4gICAgfVxuICAgIHRoaXMudmZ4LnVwZGF0ZShkdCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmFkZEluUGxhY2UodGhpcy52Zngub2ZmKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlUmVzdWx0KCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIHMgPSB0aGlzLnM7XG4gICAgdGhpcy5lbmRCYXR0bGVQZXJmKCk7XG4gICAgdGhpcy5sYXN0QmF0dGxlID0gYHdhdmUgJHtzLndhdmV9IGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9OiAke2Iud2lubmVyID09PSAwID8gJ1dPTicgOiAnTE9TVCd9IGluICR7Yi50aW1lLnRvRml4ZWQoMSl9cywgJHtiLmNvdW50KDApfSBvZiB5b3VycyBhbmQgJHtiLmNvdW50KDEpfSBlbmVtaWVzIGxlZnRgO1xuICAgIGlmIChiLndpbm5lciA9PT0gMCkge1xuICAgICAgdGhpcy5wbGF5UmVzdWx0KCd3aW4nLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGFybXkgaXMgcmFpc2VkIGFnYWluLCB0aGVuIHRoZSBuZXh0IHdhdmUgLyB0aGUgZHJhZnRcbiAgICAgICAgdGhpcy5jaW5lID0gZmFsc2U7XG4gICAgICAgIHRyeSB7IHRoaXMubGFzdEdvbGQgPSB0aGlzLmRhaWx5ID8gMCA6IGFkZEdvbGRBbmRTYXZlKGlzRW5kbGVzcygpID8gZW5kbGVzc1dhdmVHb2xkKHMud2F2ZSkgOiB3YXZlR29sZChjdXJyZW50U3RhZ2VJZCwgZGlmZmljdWx0eU5hbWUgYXMgYW55KSk7IHRoaXMucnVuR29sZCArPSB0aGlzLmxhc3RHb2xkOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNhdmUtY2hhbmdlZCcpKTsgfSBjYXRjaCB7IHRoaXMubGFzdEdvbGQgPSAwOyB9XG4gICAgICAgIGlmIChpc0VuZGxlc3MoKSAmJiB0aGlzLmVuZGxlc3MpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgciA9IHJlY29yZEVuZGxlc3NXYXZlQW5kU2F2ZShzLndhdmUpOyB0aGlzLmVuZGxlc3MuY2xlYXJlZCA9IHMud2F2ZTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7XG4gICAgICAgICAgICBpZiAoci5wYWNrKSB7IHRoaXMuZW5kbGVzcy5wYWNrcysrOyB0aGlzLnRvYXN0KCdXYXZlICcgKyBzLndhdmUgKyAnIGNsZWFyZWQhIFlvdSBlYXJuZWQgYSBTb3VsIFBhY2sgKHNlZSB0aGUgU2hvcCkuJyk7IH1cbiAgICAgICAgICB9IGNhdGNoIHsgLyogc2F2aW5nIG11c3QgbmV2ZXIgYnJlYWsgYSBydW4gKi8gfVxuICAgICAgICB9XG4gICAgICAgIGlmIChhZHZhbmNlV2F2ZShzKSkge1xuICAgICAgICAgIHRoaXMucGhhc2UgPSAnd29uJzsgY2xlYXJSdW4oKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHRoaXMuZGFpbHkpIHsgdGhpcy5kYWlseVJld2FyZCA9IHJlY29yZERhaWx5V2luQW5kU2F2ZSh0aGlzLmRhaWx5LmRheSk7IHRoaXMucmV3YXJkID0gbnVsbDsgfSBlbHNlIHRoaXMucmV3YXJkID0gcmVjb3JkQ2xlYXJBbmRTYXZlKGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5TmFtZSBhcyBhbnkpO1xuICAgICAgICAgICAgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7XG4gICAgICAgICAgfSBjYXRjaCB7IHRoaXMucmV3YXJkID0gbnVsbDsgfVxuICAgICAgICAgIHRoaXMudWkucmVuZGVyKCk7IHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmRyYWZ0ID0gZHJhZnRPcHRpb25zKHMpOyB0aGlzLnBoYXNlID0gJ2RyYWZ0JzsgdGhpcy5wZXJzaXN0UnVuKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmFpbFdhdmUocyk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudWkucHVsc2VIZWFydHMoKTsgICAgICAgICAgICAgICAgICAgLy8gdGhlIGhlYXJ0IGlzIGxvc3QgdGhlIG1vbWVudCBoZSBpcyBoaXRcbiAgICAgIGlmIChzLnN0YXR1cyA9PT0gJ2xvc3QnKSB0aGlzLnBsYXlSZXN1bHQoJ2ZpbmFsJywgKCkgPT4geyB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5waGFzZSA9ICdsb3N0JzsgY2xlYXJSdW4oKTsgdGhpcy51aS5yZW5kZXIoKTsgfSk7XG4gICAgICBlbHNlIHRoaXMucGxheVJlc3VsdCgnbG9zcycsICgpID0+IHsgdGhpcy50b2FzdCgnWW91ciBhcm15IGZlbGwuIC0xIGhlYXJ0LCArMSBjYXJkLCBzYW1lIHdhdmUuIFJlYnVpbGQgYSBkaWZmZXJlbnQgc3RyYXRlZ3kuJyk7IHRoaXMudG9CdWlsZCgpOyB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIHJlc3VsdCBjdXRzY2VuZXMgKHBsYW4gc2VjdGlvbnMgMTktMjIpOiB0aGUgTmVjcm9tYW5jZXIgdGFrZXMgdGhlIGhpdCwgdW5sZWFzaGVzIHRoZSByZXB1bHNpb24gc2hvY2t3YXZlLCByYWlzZXMgdGhlIGZhbGxlblxuICBwcml2YXRlIHBsYXlSZXN1bHQoa2luZDogJ3dpbicgfCAnbG9zcycgfCAnZmluYWwnLCBkb25lOiAoKSA9PiB2b2lkKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlISwgbiA9IHRoaXMubmVjcm87IHRoaXMuY2luZSA9IHRydWU7IGlmIChraW5kICE9PSAnd2luJykgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7XG4gICAgY29uc3QgaG9tZSA9ICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBldmVyeSBmYWxsZW4gYWxseSBpcyBwdWxsZWQgYmFjayB0byBpdHMgZ3JpZCB0aWxlIGFuZCBzdGFuZHMgdXBcbiAgICAgIG4uY2FzdCgpOyBhdWRpby5wbGF5KCdyZXN1cnJlY3QnKTsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpOyB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMC44NSwgMC41LCAxLCAwLjldLCBbMC41LCAwLjIsIDEsIDAuN10sIDMwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDApIGNvbnRpbnVlOyBjb25zdCB1aWQgPSB0aGlzLmZVbml0LmdldChmLmlkKSwgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1aWQpLCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF1IHx8ICF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyh1LmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoIWYuYWxpdmUpIHsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnZmeC5hcnJpdmUoeDAsIHowLCAxKTsgdGhpcy5idXJzdCh4MCwgejAsIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTgpOyB0aGlzLmZ4UmluZyh4MCwgejAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjcsIDAuMzUsIDEpLCAwLjMsIDEuNiwgMC43KTsgfVxuICAgICAgICB0aGlzLnR3ZWVuKDEuMCwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjUsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIucm90YXRpb24ueSArPSAoTWF0aC5QSSAvIDIgLSB2LmhvbGRlci5yb3RhdGlvbi55KSAqIE1hdGgubWluKDEsIHQgKiAwLjUgKyAwLjEpOyB9LFxuICAgICAgICAgICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHRoaXMuYnVyc3QodG8ueCwgdG8ueiwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxMCk7IH0pO1xuICAgICAgfVxuICAgIH07XG4gICAgaWYgKGtpbmQgPT09ICd3aW4nKSB7XG4gICAgICAvLyB0aGUgc3Vydml2b3JzIGNlbGVicmF0ZSByaWdodCB3aGVyZSB0aGV5IHN0YW5kIChwdXJlbHkgdmlzdWFsKSwgVEhFTiB0aGUgY2FtZXJhIHN3aW5ncyB0byB0aGUgTmVjcm9tYW5jZXIgYW5kIHRoZSBhcm15IGlzIHJhaXNlZFxuICAgICAgYXVkaW8ucGxheSgndmljdG9yeScpO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIGlmIChmLnRlYW0gPT09IDAgJiYgZi5hbGl2ZSkgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKHYpIHRoaXMubGF0ZXIoTWF0aC5yYW5kb20oKSAqIDAuMzUsICgpID0+IHsgdi5wbGF5KCdjaGVlcicpOyBhdWRpby5iYXJrKGYuc291bCk7IH0pOyB9XG4gICAgICB0aGlzLmxhdGVyKDEuNiwgKCkgPT4geyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5uZWNybywgMS4xKTsgbi5jYXN0KCk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy52ZngucnVuZShjLngsIGMueiwgMy40LCBbMC43LCAwLjQsIDFdLCAyLjYsIDEpOyB0aGlzLnZmeC5waWxsYXIoYy54LCBjLnosIFswLjc1LCAwLjQ1LCAxXSwgNywgMC45LCAxLjQpOyB9KTtcbiAgICAgIHRoaXMubGF0ZXIoMS44NSwgaG9tZSk7IHRoaXMubGF0ZXIoMy42LCBkb25lKTsgcmV0dXJuO1xuICAgIH1cbiAgICBuLmh1cnQoKTsgYXVkaW8ucGxheSgnaGVhcnRMb3N0Jyk7IHRoaXMubGF0ZXIoMC4xNSwgKCkgPT4geyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjMsIDAuMywgMC45XSwgWzAuOCwgMC4xLCAwLjIsIDAuNl0sIDE2KTsgfSk7XG4gICAgaWYgKGtpbmQgPT09ICdmaW5hbCcpIHsgdGhpcy5sYXRlcigwLjYsICgpID0+IHsgbi5kZWZlYXQoKTsgYXVkaW8ucGxheSgnZGVmZWF0Jyk7IH0pOyB0aGlzLmxhdGVyKDIuNiwgZG9uZSk7IHJldHVybjsgfVxuICAgIHRoaXMubGF0ZXIoMS4wLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwdWxzaW9uIHNob2Nrd2F2ZTogc3Vydml2b3JzIGFyZSBmbHVuZyBiYWNrIHRvIHdoZXJlIHRoZXkgc3RhcnRlZCBhbmQgaGVhbCB0byBmdWxsXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgnc2hvY2t3YXZlJyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTtcbiAgICAgIHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDAuODUsIDAuNTUsIDEpLCAwLjYsIDMwLCAxLjEpOyB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC40LCAyMiwgMC44KTsgdGhpcy52Znguc2hvY2soYy54LCBjLnosIDI4KTtcbiAgICAgIHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjg1LCAxLCAwLjldLCBbMC43LCAwLjQsIDEsIDAuN10sIDQwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDEgfHwgIWYuYWxpdmUpIGNvbnRpbnVlOyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSBjZWxsUG9zKDEsIGYuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnB1bHNlKCk7XG4gICAgICAgIHRoaXMudHdlZW4oMC45LCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuOSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LnNldEhwKGYuaHAgLyBmLm1heEhwICsgKDEgLSBmLmhwIC8gZi5tYXhIcCkgKiB0KTsgfSwgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdi5zZXRIcCgxKTsgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5sYXRlcigyLjMsIGhvbWUpOyB0aGlzLmxhdGVyKDMuNywgZG9uZSk7XG4gIH1cbiAgcGlja0RyYWZ0KGlkeDogbnVtYmVyKSB7IGlmICghdGhpcy5kcmFmdCkgcmV0dXJuOyB0YWtlRHJhZnQodGhpcy5zLCB0aGlzLmRyYWZ0LCBpZHgpOyB0aGlzLmRyYWZ0ID0gbnVsbDsgbm9ybWFsRHJhdyh0aGlzLnMpOyB0aGlzLnRvQnVpbGQoKTsgfVxuICBwcml2YXRlIHRvQnVpbGQoKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMubmVjcm8ucmV2aXZlKCk7IHRoaXMuZmx1c2hUd2VlbnMoKTtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgeyAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVzdXJyZWN0aW9uOiBldmVyeW9uZSByaXNlcyBhZ2FpbiBhdCBmdWxsIGhlYWx0aFxuICAgICAgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LmhvbGRlci5zZXRFbmFibGVkKHRydWUpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7XG4gICAgICB0aGlzLmxhdGVyKDEuMSwgKCkgPT4gdi5wbGF5KCdpZGxlJykpO1xuICAgIH1cbiAgICB0aGlzLnBoYXNlID0gJ2J1aWxkJzsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyAgICAgICAgICAvLyBVSSBmaXJzdDogdGhlIGNhbWVyYSBtdXN0IG1lYXN1cmUgdGhlIGhhbmQgYW5kIGJ1dHRvbnMgd2hpbGUgdGhleSBhcmUgdmlzaWJsZVxuICAgIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJ1aWxkLCAxLjgpO1xuICB9XG4gIC8qKiAyeCBhbmQgNHggYmF0dGxlIHNwZWVkIG9wZW4gb25jZSB0aGUgY2FtcGFpZ24gaXMgZmluaXNoZWQgKHRoZSBsYXN0IHN0YWdlIGNsZWFyZWQgb24gTm9ybWFsKS4gP2RlYnVnIG9yID9zcGVlZD0xIG9wZW5zIHRoZW0gZm9yIHRlc3RpbmcuICovXG4gIHNwZWVkVW5sb2NrZWQoKTogYm9vbGVhbiB7IGNvbnN0IHEgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCk7IHJldHVybiAhIShxLmdldCgnZGVidWcnKSB8fCBxLmdldCgnc3BlZWQnKSkgfHwgZW5kbGVzc1VubG9ja2VkKGxvYWRTYXZlKCkpOyB9XG4gIHNldFNwZWVkKGs6IG51bWJlcikge1xuICAgIGlmIChrID4gMSAmJiAhdGhpcy5zcGVlZFVubG9ja2VkKCkpIHJldHVybjtcbiAgICB0aGlzLnRpbWVTY2FsZSA9IGs7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBoZWxwZXJzXG4gIGFwcGx5QmFsYW5jZUNoYW5nZSgpIHsgdGhpcy51bml0VmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOyBpZiAodSkgdi5zZXRTdGFyKHUuc3Rhcik7IH0pOyB9XG4gIHRlc3RPZGRzKG4gPSAyMDApIHtcbiAgICBjb25zdCBzbG90cyA9IHRoaXMucy51bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVtaWVzID0gZW5lbXlXYXZlKHRoaXMucy53YXZlLCB0aGlzLnNlZWQpOyBsZXQgd2luID0gMCwgdCA9IDA7XG4gICAgY29uc3QgbHY6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fSwgc3YgPSBsb2FkU2F2ZSgpLnNvdWxzOyBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoc3YpKSBsdltrXSA9IChzdiBhcyBhbnkpW2tdLmxldmVsO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7IGNvbnN0IHIgPSBzaW11bGF0ZShzbG90cywgZW5lbWllcywgNTAwMCArIGksIDEzMCwgbHYsIGVuZW15UG93ZXIoKSk7IGlmIChyLndpbm5lciA9PT0gMCkgd2luKys7IHQgKz0gci50aW1lOyB9XG4gICAgcmV0dXJuIHsgd2luOiBNYXRoLnJvdW5kKCh3aW4gLyBuKSAqIDEwMCksIGF2Z1RpbWU6ICsodCAvIG4pLnRvRml4ZWQoMSksIG4gfTtcbiAgfVxuICBhZGRDYXJkKHNvdWw6IFNvdWxJZCkgeyB0aGlzLnMuaGFuZC5wdXNoKHNvdWwpOyB0aGlzLnMuc3RhdHMuZHJhd24rKzsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICBhZGREb21pbmlvbihuOiBudW1iZXIpIHsgdGhpcy5zLmNhcCArPSBuOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIHJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIGVuID0gZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKTtcbiAgICByZXR1cm4gW2BzdGFnZSAke2N1cnJlbnRTdGFnZUlkfS8ke2RpZmZpY3VsdHlOYW1lfSAgc2VlZCAke3RoaXMuc2VlZH0gIHdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX0gIGhlYXJ0cyAke3MuaGVhcnRzfSAgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9ICBwaGFzZSAke3RoaXMucGhhc2V9ICBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fWAsXG4gICAgICBgaGFuZDogJHtzLmhhbmQuam9pbignLCAnKSB8fCAnKGVtcHR5KSd9YCwgYGFybXk6ICR7cy51bml0cy5tYXAoKHUpID0+IGAke3Uuc291bH0ke3Uuc3Rhcn1AJHt1LmNlbGx9YCkuam9pbignICcpIHx8ICcobm9uZSknfWAsIGBlbmVteTogJHtlbi5tYXAoKGUpID0+IGUuc291bCArIGUuc3Rhcikuam9pbignICcpfWAsXG4gICAgICBgZGlmZmljdWx0eTogJHtkaWZmaWN1bHR5TmFtZX0gIG1lcmdlLWZyb20taGFuZDogJHtzLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJ30gIHN3YXAgdXNlZDogJHtzLmRpc2NhcmRVc2VkfWAsIGBsYXN0IHRhcDogJHt0aGlzLmxhc3RUYXBJbmZvfWAsIGBzY3JlZW46ICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSBkcHIgJHt3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpb31gLCBgbGFzdCBiYXR0bGU6ICR7dGhpcy5sYXN0QmF0dGxlIHx8ICctJ31gLCBgbG9nIHRhaWw6YCwgLi4ucy5sb2cuc2xpY2UoLTgpLCBgYmFsYW5jZTogJHtKU09OLnN0cmluZ2lmeSh7IHN0YXI6IEJBTEFOQ0Uuc3Rhciwgc3RhdHM6IEJBTEFOQ0Uuc3RhdHMgfSl9YF0uam9pbignXFxuJyk7XG4gIH1cbiAgcmVzZXRCYWxhbmNlQWxsKCkgeyByZXNldEJhbGFuY2UoKTsgdGhpcy5hcHBseUJhbGFuY2VDaGFuZ2UoKTsgfVxuICBnZXQgZGlmZmljdWx0eSgpIHsgcmV0dXJuIGRpZmZpY3VsdHlOYW1lOyB9XG4gIGNoYW5nZURpZmZpY3VsdHkobmFtZTogc3RyaW5nKSB7IHNldERpZmZpY3VsdHkobmFtZSk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudG9hc3QoYERpZmZpY3VsdHk6ICR7bmFtZX0uIEFwcGxpZXMgdG8gdGhlIG5leHQgYmF0dGxlLmApOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZ2FsbGVyeSAoc3RhciBsb29rcylcbiAgZ2FsbGVyeSgpIHtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5hZGQoJ2dhbGxlcnknKTsgdGhpcy5uZWNyby5zZXRFbmFibGVkKGZhbHNlKTsgY29uc3QgdmlzOiBVbml0VmlzdWFsW10gPSBbXTsgbGV0IHRlYW06IDAgfCAxID0gMDtcbiAgICBjb25zdCByZWJ1aWxkID0gKCkgPT4geyB2aXMuZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB2aXMubGVuZ3RoID0gMDsgU09VTFMuZm9yRWFjaCgoc291bCwgaSkgPT4gWzEsIDIsIDNdLmZvckVhY2goKHN0LCBqKSA9PiB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBzb3VsLCB0ZWFtLCBzdCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCgoaSAtIDIuNSkgKiAyLjUsIDAsIChqIC0gMSkgKiAtMi40KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgKiAwLjg1OyB2LnBsYXkoJ2lkbGUnKTsgdmlzLnB1c2godik7IH0pKTsgfTtcbiAgICByZWJ1aWxkKCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLnNldCgwLCA1LjYsIC0xNC41KTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAtMC40KSk7IHRoaXMuY2FtZXJhLmZvdiA9IDAuODU7XG4gICAgKHdpbmRvdyBhcyBhbnkpLl9fZ2FsbGVyeSA9IHsgc2V0VGVhbTogKHQ6IDAgfCAxKSA9PiB7IHRlYW0gPSB0OyByZWJ1aWxkKCk7IH0sIHZpcyB9O1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7IHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBuID0gcGVyZm9ybWFuY2Uubm93KCksIGR0ID0gTWF0aC5taW4oMC4wNSwgKG4gLSBsYXN0KSAvIDEwMDApOyBsYXN0ID0gbjsgdmlzLmZvckVhY2goKHYpID0+IHYudXBkYXRlKGR0KSk7IHRoaXMuc2NlbmUucmVuZGVyKCk7IH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgR2FtZSB9IGZyb20gJy4vZ2FtZS50cyc7XG5cbmNvbnN0IGcgPSBuZXcgR2FtZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fZ2FtZSA9IGc7ICAgICAgICAgICAgICAgICAgICAgICAvLyBoYW5keSBmb3IgZGVidWdnaW5nIGZyb20gdGhlIGJyb3dzZXIgY29uc29sZVxuZy5pbml0KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjJykgYXMgSFRNTENhbnZhc0VsZW1lbnQpXG4gIC50aGVuKCgpID0+IHsgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSBsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7ICh3aW5kb3cgYXMgYW55KS5fX2dhbWVSZWFkeSA9IHRydWU7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ2FtZS1yZWFkeScpKTsgfSlcbiAgLmNhdGNoKChlKSA9PiB7XG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSB7IGwuc3R5bGUuZGlzcGxheSA9ICdmbGV4JzsgbC50ZXh0Q29udGVudCA9ICdFcnJvcjogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IGUpOyB9XG4gICAgY29uc29sZS5lcnJvcihlKTtcbiAgfSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFvQ08sTUFBTSxXQUFvQjtBQUFBLElBQy9CLE9BQU87QUFBQSxNQUNMLFNBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sR0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLE1BQzlHLFFBQVcsRUFBRSxJQUFJLEtBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEtBQU0sT0FBTyxHQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsTUFDOUcsTUFBVyxFQUFFLElBQUksS0FBSyxLQUFLLElBQUksVUFBVSxLQUFLLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNB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RyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFDckosRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsR0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEdBQUssS0FBSyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNwTCxFQUFFLE1BQU0sU0FBUyxHQUFHLElBQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEdBQUssR0FBRyxLQUFLO0FBQUEsSUFDL0ksRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsRUFDeE47QUFDQSxNQUFNLG1CQUFnQztBQUFBO0FBQUEsSUFDcEMsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQ2xFLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUN4TSxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLEdBQUssS0FBSyxJQUFJO0FBQUEsSUFDck0sRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUNuSCxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDdEksRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNySCxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUNuTixFQUFFLE1BQU0sU0FBUyxHQUFHLEdBQUcsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxFQUN2TjtBQUNBLE1BQU0saUJBQThCO0FBQUE7QUFBQSxJQUNsQyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxHQUFHLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDMUgsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUN2SyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxLQUFLLEtBQUssTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLO0FBQUEsSUFDek0sRUFBRSxNQUFNLFVBQVUsR0FBRyxPQUFPLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUM1RyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE9BQU8sR0FBRyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUNsUCxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUM5TyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsSUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsRUFDbEs7QUFLQSxNQUFNLFNBQWdDO0FBQUEsSUFDcEMsT0FBTyxFQUFFLFFBQVEsY0FBYyxPQUFPLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxLQUFLLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLENBQUMsTUFBTSxNQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxNQUFNLENBQUMsTUFBTSxNQUFNLElBQUksRUFBRTtBQUFBLElBQzVNLFdBQVcsRUFBRSxRQUFRLGtCQUFrQixPQUFPLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsTUFBTSxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxLQUFLLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxNQUFNLENBQUMsS0FBSyxLQUFLLElBQUksRUFBRTtBQUFBLElBQ3ROLFNBQVMsRUFBRSxRQUFRLGNBQWMsT0FBTyxDQUFDLE1BQU0sTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLE1BQU0sTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsTUFBTSxDQUFDLE1B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LE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxNQUFNLEtBQUssV0FBVyxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxVQUFVLE1BQU0sTUFBTSxLQUFLLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDNUssS0FBSztBQUFXLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsR0FBRztBQUFHO0FBQUEsUUFDekksS0FBSztBQUFVLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLElBQUksS0FBSyxRQUFRLEtBQUssR0FBRztBQUFHO0FBQUEsUUFDdEosS0FBSztBQUFVLFdBQUMsTUFBTSxNQUFNLE1BQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU07QUFBRSxpQkFBSyxLQUFLLE1BQU0sTUFBTSxZQUFZLE1BQU0sSUFBSSxLQUFLLENBQUM7QUFBRyxpQkFBSyxLQUFLLE1BQU0sSUFBSSxJQUFJLE1BQU0sVUFBVSxNQUFNLEdBQUcsUUFBVyxNQUFPLEdBQUc7QUFBQSxVQUFHLENBQUM7QUFBRyxXQUFDLEtBQUssTUFBTSxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxZQUFZLEtBQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxNQUFNLE1BQU0sRUFBRTtBQUFHO0FBQUEsUUFDblgsS0FBSztBQUFjLGVBQUssS0FBSyxJQUFJLE1BQU0sUUFBUSxNQUFNLEdBQUcsS0FBSyxHQUFHO0FBQUcsZUFB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QUssT0FBTyxRQUFRLFVBQVUsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLE9BQU8sR0FBRyxHQUFLLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxVQUFVLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxTQUFTLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxVQUFVLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxHQUFHLFFBQVEsQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sVUFBVSxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sU0FBUyxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsQ0FBQyxHQUFHLE1BQU0sa0JBQWtCLENBQUM7QUFBQSxNQUM5ZixDQUFDLGFBQWEsaUJBQWlCLHVCQUF1QixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsR0FBSyxNQUFNLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sWUFBWSxHQUFHLEVBQUUsTUFBTSxTQUFTLE9BQU8sSUFBSSxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxHQUFHLFFBQVEsQ0FBQyxFQUFFLE1BQU0sU0FBUyxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sWUFBWSxDQUFDLEdBQUcsTUFBTSxxQkFBcUIsQ0FBQztBQUFBLE1BQzdaLENBQUMsUUFBUSxZQUFZLGtCQUFrQixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsTUFBTSxNQUFNLEVBQUUsV0FBVyxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUcs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QUFVLFdBQVksUUFBUSxNQUFNLEtBQUssSUFBYyxFQUFFLFVBQVUsUUFBUyxVQUFVLFVBQVUsTUFBTSxVQUFVLFVBQVUsTUFBTTtBQUFLLFdBQUssS0FBSyxRQUFRLFVBQVUsT0FBTztBQUFBLElBQUc7QUFBQSxJQUN6VSxPQUFPLElBQVk7QUFDakIsV0FBSyxLQUFLO0FBQUksV0FBSyxLQUFLLE9BQU8sRUFBRTtBQUFHLFlBQU0sSUFBSSxLQUFLLElBQUksSUFBSSxLQUFLLElBQUksS0FBSyxPQUFPLEtBQUssR0FBRyxHQUFHLElBQUksS0FBSyxLQUFLLElBQUksS0FBSztBQUNsSCxRQUFFLFNBQVMsSUFBSSxHQUFHLEdBQUcsQ0FBQztBQUFHLFFBQUUsU0FBUyxJQUFJLEdBQUcsR0FBRyxDQUFDO0FBQUcsUUFBRSxRQUFRLE9BQU8sQ0FBQztBQUFHLFFBQUUsU0FBUyxJQUFJO0FBQU0sV0FBSyxLQUFLLFFBQVEsQ0FBQyxNQUFPLEVBQUUsU0FBUyxJQUFJLENBQUU7QUFDdkksVUFBSSxLQUFLLFVBQVUsT0FBUSxHQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsSUFBSTtBQUFBLGVBQzFELEtBQUssVUFBVSxPQUFPO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSTtBQUFJLFVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDLElBQUk7QUFBTSxVQUFFLFNBQVMsSUFBSTtBQUFLLGFBQUssS0FBSyxDQUFDLEVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxhQUFLLEtBQUssQ0FBQyxFQUFFLFNBQVMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBQSxNQUFLLFdBQ3BQLEtBQUssVUFBVSxVQUFVO0FBQUUsY0FBTSxJQUFJLElBQUksTUFBTSxRQUFRLElBQUksT0FBTyxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksSUFBSSxPQUFPLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxLQUFLLENBQUM7QUFBQSxNQUFHLFdBQzFOLEtBQUssVUFBVSxTQUFTO0FBQUUsY0FBTSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUk7QUFBSSxVQUFFLFFBQVEsT0FBTyxPQUFPLE9BQU8sQ0FBQztBQUFHLFVBQUUsU0FBUyxLQUFLLElBQUksS0FBSztBQUFBLE1BQUssV0FDMUgsS0FBSyxVQUFVLFNBQVM7QUFBRSxjQUFNLElBQUksSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLENBQUMsS0FBSyxLQUFLLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSSxPQUFPO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTztBQUFBLE1BQUcsV0FDOUgsS0FBSyxVQUFVLFNBQVM7QUFBRSxVQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxDQUFDLENBQUMsSUFBSTtBQUFNLFVBQUUsU0FBUyxJQUFJO0FBQUEsTUFBTTtBQUM5RyxVQUFJLEtBQUssU0FBUyxHQUFHO0FBQUUsYUFBSyxVQUFVO0FBQUksY0FBTSxJQUFJLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLElBQUksT0FBTyxLQUFLLEVBQUU7QUFBRyxhQUFLLE9BQU8sUUFBUSxPQUFPLEtBQUssT0FBTyxDQUFDO0FBQUEsTUFBRztBQUFBLElBQ2pLO0FBQUEsSUFDQSxVQUFVO0FBQUUsV0FBSyxLQUFLLFFBQVE7QUFBRyxXQUFLLE9BQU8sZUFBZSxFQUFFLFFBQVEsQ0FBQyxNQUFXLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxPQUFPLFFBQVE7QUFBQSxJQUFHO0FBQUEsRUFDekg7QUFFTyxXQUFTLGFBQWEsR0FBVyxNQUFjLE1BQWEsTUFBMEI7QUFDM0YsVUFBTSxNQUFNLEVBQUUsTUFBTSxJQUFJO0FBQ3hCLFdBQU8sTUFBTSxJQUFJLFlBQVksR0FBRyxLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksSUFBSSxrQkFBa0IsR0FBRyxNQUFNLE1BQU0sSUFBSTtBQUFBLEVBQ3BHOzs7QUNuVU8sTUFBTSxVQUFVLENBQUMsTUFBd0Isa0JBQWtCLElBQUk7QUFFL0QsTUFBTSxVQUFVLENBQUMsR0FBYSxNQUFNLFNBQWlCLGVBQWUsR0FBRyxVQUFVLFFBQVEsQ0FBQyxDQUFDO0FBRzNGLE1BQU0sWUFBc0MsRUFBRSxTQUFTLFdBQVcsUUFBUSxVQUFVLFFBQVEsVUFBVSxRQUFRLFVBQVUsTUFBTSxRQUFRLFdBQVcsWUFBWTtBQUk3SixNQUFNLFlBQVksQ0FBQyxHQUFXLE1BQU0sU0FBaUIsUUFBUSxTQUFTLEdBQUcsRUFBRSxPQUFPLEtBQUssSUFBSSxHQUFHLENBQUMsQ0FBQztBQUNoRyxNQUFNLGFBQWEsQ0FBQyxRQUFnQixNQUFNLE1BQWMsUUFBUSxTQUFTLFVBQVUsRUFBRSxPQUFPLEtBQUssSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLFFBQVEsZUFBZSxVQUFVLEVBQUUsT0FBTyxLQUFLLElBQUksR0FBRyxNQUFNLE1BQU0sQ0FBQztBQUV0TCxNQUFNLE1BQU0sQ0FBQyxNQUFzQixLQUFLLE1BQU0sQ0FBQyxFQUFFLGVBQWUsT0FBTzs7O0FDbkI5RSxNQUFNLFdBQTRDLEVBQUUsU0FBUyxxQ0FBcUMsUUFBUSxvQ0FBb0MsTUFBTSxrQ0FBa0MsUUFBUSxvQ0FBb0MsUUFBUSxvQ0FBb0MsV0FBVyxzQ0FBc0M7QUFDL1QsTUFBTSxhQUFxQyxFQUFFLFFBQVEsV0FBVyxNQUFNLFdBQVcsTUFBTSxXQUFXLFdBQVcsVUFBVTtBQUNoSCxNQUFNLFNBQVMsQ0FBQyxNQUF1QixDQUFDLENBQUMsU0FBUyxDQUFDO0FBQ25ELE1BQU0sVUFBVSxDQUFDLE1BQW1CO0FBVjNDO0FBVThDLDBCQUFTLENBQUMsTUFBVixZQUFlLFFBQVEsVUFBVSxDQUFDLENBQUM7QUFBQTtBQUMxRSxNQUFNLGNBQWMsQ0FBQyxNQUFzQixXQUFXLFVBQVUsQ0FBQyxDQUFDO0FBRWxFLE1BQU0sUUFBUSxDQUFDLE1BQXNCO0FBQUUsVUFBTSxJQUFJLFlBQVksQ0FBQztBQUFHLFdBQU8sdUNBQXVDLENBQUMsVUFBVSxDQUFDO0FBQUEsRUFBOEQ7OztBQ0RoTSxNQUFNLGVBQWUsQ0FBQyxNQUFzQixxQ0FBcUMsTUFBTSxDQUFDLENBQUMsZUFBZSxRQUFRLENBQUMsQ0FBQztBQUNsSCxNQUFNLE9BQU8sT0FBTyxZQUFZLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLFFBQVEsVUFBVSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNsRixNQUFNLElBQUksQ0FBQyxPQUFlLFNBQVMsZUFBZSxFQUFFO0FBQ3BELE1BQU0sUUFBUSxDQUFDLE1BQWMsU0FBSSxPQUFPLENBQUM7QUFFbEMsTUFBTSxLQUFOLE1BQVM7QUFBQSxJQUVkLFlBQW9CRyxJQUFRO0FBQVIsK0JBQUFBO0FBRHBCLDBCQUFRLFVBQVM7QUFBRywwQkFBUTtBQUFrQiwwQkFBUSxRQUFPO0FBRTNELFFBQUUsU0FBUyxFQUFFLFVBQVUsTUFBTSxPQUFPLGNBQWMsSUFBSSxNQUFNLGVBQWUsQ0FBQztBQUM1RSxRQUFFLFdBQVcsRUFBRSxVQUFVLE1BQU1BLEdBQUUsWUFBWTtBQUFHLFFBQUUsU0FBUyxFQUFFLFVBQVUsTUFBTUEsR0FBRSxXQUFXO0FBQzFGLFFBQUUsV0FBVyxFQUFFLFVBQVUsTUFBTUEsR0FBRSxlQUFlO0FBQ2hELFFBQUUsVUFBVSxFQUFFLFVBQVUsTUFBTUEsR0FBRSxTQUFTQSxHQUFFLFlBQVksSUFBSSxJQUFJLENBQUM7QUFDaEUsZUFBUyxpQkFBOEIsWUFBWSxFQUFFLFFBQVEsQ0FBQyxNQUFPLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFdBQVcsRUFBRSxRQUFRLEdBQUksQ0FBRTtBQUNwSCxRQUFFLE1BQU0sRUFBRSxVQUFVLE1BQU07QUFBRSxhQUFLLElBQUksVUFBVSxPQUFPLE1BQU07QUFBRyxhQUFLLFlBQVk7QUFBQSxNQUFHO0FBQ25GLFlBQU0sTUFBTSxNQUFNO0FBQUUsVUFBRSxVQUFVLEVBQUUsVUFBVSxPQUFPLE9BQU8sQ0FBQyxNQUFNLEtBQUs7QUFBRyxVQUFFLFFBQVEsRUFBRSxVQUFVLE9BQU8sT0FBTyxDQUFDLE1BQU0sR0FBRztBQUFHLGNBQU0sS0FBSyxFQUFFLFFBQVEsRUFBRSxjQUFjLEtBQUs7QUFBRyxZQUFJLEdBQUksSUFBRyxNQUFNLFFBQVEsTUFBTSxNQUFNLGFBQWEsV0FBVztBQUFBLE1BQUc7QUFDdk8sUUFBRSxVQUFVLEVBQUUsVUFBVSxNQUFNO0FBQUUsY0FBTSxTQUFTLENBQUMsTUFBTSxLQUFLO0FBQUcsWUFBSTtBQUFBLE1BQUc7QUFBRyxRQUFFLFFBQVEsRUFBRSxVQUFVLE1BQU07QUFBRSxjQUFNLE9BQU8sQ0FBQyxNQUFNLEdBQUc7QUFBRyxZQUFJO0FBQUEsTUFBRztBQUN2SSxhQUFPLGlCQUFpQixrQkFBa0IsR0FBRztBQUFHLFVBQUk7QUFDcEQsV0FBSyxNQUFNLEVBQUUsT0FBTztBQUFHLFVBQUksSUFBSSxnQkFBZ0IsU0FBUyxNQUFNLEVBQUUsSUFBSSxPQUFPLEVBQUcsTUFBSyxJQUFJLFVBQVUsSUFBSSxNQUFNO0FBQzNHLFdBQUssWUFBWTtBQUFBLElBQ25CO0FBQUE7QUFBQSxJQUdBLGNBQWM7QUFBRSxZQUFNLElBQUksRUFBRSxRQUFRO0FBQUcsUUFBRSxVQUFVLE9BQU8sTUFBTTtBQUFHLFdBQUssRUFBRTtBQUFhLFFBQUUsVUFBVSxJQUFJLE1BQU07QUFBQSxJQUFHO0FBQUEsSUFDaEgsTUFBTSxLQUFhO0FBQUUsWUFBTSxJQUFJLEVBQUUsT0FBTztBQUFHLFFBQUUsY0FBYztBQUFLLFFBQUUsVUFBVSxJQUFJLE1BQU07QUFBRyxtQkFBYSxLQUFLLE1BQU07QUFBRyxXQUFLLFNBQVMsT0FBTyxXQUFXLE1BQU0sRUFBRSxVQUFVLE9BQU8sTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFFN0wsU0FBUztBQUNQLFlBQU1BLEtBQUksS0FBSyxHQUFHLElBQUlBLEdBQUUsR0FBRyxLQUFLQSxHQUFFLE9BQU8sUUFBUSxPQUFPO0FBQ3hELFFBQUUsUUFBUSxFQUFFLFlBQVksV0FBVyxFQUFFLE1BQU07QUFDM0MsUUFBRSxNQUFNLEVBQUUsY0FBYyxVQUFVLElBQUksUUFBUSxFQUFFLElBQUksS0FBSyxRQUFRLEVBQUUsSUFBSSxJQUFJLFdBQVcsQ0FBQyxDQUFDO0FBQ3hGLFlBQU0sT0FBTyxhQUFhLENBQUM7QUFBRyxRQUFFLEtBQUssRUFBRSxjQUFjLEdBQUcsSUFBSSxJQUFJLEVBQUUsR0FBRztBQUFJLE1BQUMsRUFBRSxTQUFTLEVBQWtCLE1BQU0sUUFBUSxLQUFLLElBQUksS0FBTSxPQUFPLEVBQUUsTUFBTyxHQUFHLElBQUk7QUFFM0osWUFBTSxLQUFLLFlBQVksVUFBVSxFQUFFLE1BQU1BLEdBQUUsSUFBSSxDQUFDO0FBQ2hELFFBQUUsT0FBTyxFQUFFLFlBQVksd0JBQXdCLEdBQUcsSUFBSSxDQUFDLE1BQU0sMkJBQTJCLEtBQUssRUFBRSxJQUFjLENBQUMsZ0JBQWdCLFVBQVUsRUFBRSxJQUFjLENBQUMsR0FBSSxFQUFVLE9BQU8sdUNBQXVDLEVBQUUsOEJBQTJCLEVBQUUsS0FBSywyQkFBMkIsTUFBTSxFQUFFLElBQUksQ0FBQyxlQUFlLEVBQUUsS0FBSyxFQUFFLElBQUk7QUFFN1QsWUFBTSxPQUFPLEVBQUUsTUFBTTtBQUFHLFdBQUssWUFBWTtBQUN6QyxRQUFFLEtBQUssUUFBUSxDQUFDLE1BQWMsTUFBYztBQUMxQyxjQUFNLEtBQUssU0FBUyxjQUFjLEtBQUs7QUFBRyxjQUFNLE1BQU1BLEdBQUUsT0FBT0EsR0FBRSxJQUFJLFNBQVMsVUFBVUEsR0FBRSxJQUFJLFFBQVE7QUFBRyxjQUFNLFNBQVMsVUFBVSxHQUFHLENBQUMsR0FBRyxXQUFXLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBVyxpQkFBaUIsR0FBRyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsU0FBUyxVQUFVO0FBQy9OLGNBQU0sTUFBTSxPQUFPLElBQUk7QUFBRyxXQUFHLFlBQVksVUFBVSxNQUFNLFNBQVMsT0FBTyxNQUFNLFNBQVMsT0FBTyxDQUFDLFVBQVUsQ0FBQ0EsR0FBRSxXQUFXLFNBQVMsT0FBT0EsR0FBRSxXQUFXLFVBQVU7QUFDL0osY0FBTSxNQUFNLFNBQVMsbUNBQW1DLFdBQVcsMENBQTBDO0FBQzdHLFlBQUksSUFBSyxJQUFHLE1BQU0sY0FBYyxZQUFZLElBQUk7QUFDaEQsV0FBRyxZQUFZLHFCQUFxQixLQUFLLE1BQU0sQ0FBQyxDQUFDLFNBQVMsTUFBTSxhQUFhLElBQUksSUFBSSxLQUFLLElBQUksSUFBSSxtQkFBbUIsVUFBVSxJQUFJLENBQUMsUUFBUSxtQkFBbUIsR0FBRztBQUFVLFdBQUcsUUFBUSxVQUFVLElBQUksS0FBSyxTQUFTLEtBQUssV0FBVyw4RUFBOEU7QUFDalQsV0FBRyxVQUFVLE1BQU1BLEdBQUUsT0FBTyxDQUFDO0FBQUcsYUFBSyxZQUFZLEVBQUU7QUFBQSxNQUNyRCxDQUFDO0FBQ0QsVUFBSSxDQUFDLEVBQUUsS0FBSyxPQUFRLE1BQUssWUFBWTtBQUVyQyxNQUFDLEVBQUUsV0FBVyxFQUF3QixXQUFXLENBQUMsU0FBUyxDQUFDLEVBQUUsTUFBTTtBQUNwRSxZQUFNLEtBQUssRUFBRSxTQUFTO0FBQXdCLFNBQUcsV0FBVyxDQUFDLFNBQVMsRUFBRTtBQUFhLFNBQUcsVUFBVSxPQUFPLE1BQU1BLEdBQUUsUUFBUTtBQUFHLFNBQUcsY0FBYyxFQUFFLGNBQWMsY0FBY0EsR0FBRSxXQUFXLDhCQUE4QjtBQUN0TixZQUFNLE9BQU9BLEdBQUUsT0FBT0EsR0FBRSxJQUFJLFNBQVMsU0FBUyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQVcsRUFBRSxPQUFPQSxHQUFFLElBQUksRUFBRSxJQUFJO0FBQzVGLFlBQU0sVUFBVSxRQUFRLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBVyxpQkFBaUIsTUFBTSxDQUFDLENBQUM7QUFDMUUsUUFBRSxXQUFXLEVBQUUsTUFBTSxVQUFVLFNBQVMsT0FBTyxTQUFTO0FBQ3hELFFBQUUsV0FBVyxFQUFFLGNBQWNBLEdBQUUsZ0JBQWdCLG1CQUFtQjtBQUNsRSxRQUFFLE1BQU0sRUFBRSxjQUFjLFFBQVNBLEdBQUUsV0FBVyw0SEFDMUMsT0FBTyxHQUFHLFVBQVUsS0FBSyxJQUFjLENBQUMsSUFBSSxNQUFNLEtBQUssSUFBSSxDQUFDLGFBQVEsVUFBVSxLQUFLLElBQWMsQ0FBQyxLQUFLLFVBQVUsZ0VBQTJELEVBQUUsS0FDOUtBLEdBQUUsT0FBT0EsR0FBRSxJQUFJLFNBQVMsU0FBUyxHQUFHLFVBQVUsRUFBRSxLQUFLQSxHQUFFLElBQUksR0FBRyxDQUFXLENBQUMsS0FBSyxVQUFVLEVBQUUsS0FBS0EsR0FBRSxJQUFJLEdBQUcsQ0FBVyxDQUFDLGdCQUFXLE1BQU07QUFBRSxjQUFNLElBQUlBLEdBQUUsSUFBSSxLQUFLLEtBQUssVUFBVSxHQUFHLENBQUMsR0FBRyxLQUFLLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBVyxpQkFBaUIsR0FBRyxHQUFHLEVBQUUsRUFBRSxDQUFDO0FBQUcsZUFBTyxNQUFNLEtBQUsseUVBQXlFLEtBQUssZ0NBQWdDLEtBQUssZ0VBQWdFO0FBQUEsTUFBNEMsR0FBRyxJQUFJLHFFQUN4ZSxPQUFPLFlBQVksT0FBTyxlQUFlLHNDQUFzQztBQUNuRixRQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsT0FBTyxZQUFZLE9BQU8sZUFBZSxTQUFTO0FBQzdFLFlBQU0sT0FBT0EsR0FBRSxjQUFjO0FBQUcsVUFBSSxDQUFDLFFBQVFBLEdBQUUsWUFBWSxFQUFHLENBQUFBLEdBQUUsWUFBWTtBQUM1RSxZQUFNLEtBQUssRUFBRSxVQUFVO0FBQUcsU0FBRyxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQVEsU0FBRyxjQUFjQSxHQUFFLFlBQVk7QUFBSyxTQUFHLFVBQVUsT0FBTyxNQUFNQSxHQUFFLFlBQVksQ0FBQztBQUM5SSxlQUFTLGlCQUE4QixZQUFZLEVBQUUsUUFBUSxDQUFDLE1BQU0sRUFBRSxVQUFVLE9BQU8sTUFBTSxFQUFFLFFBQVEsUUFBUUEsR0FBRSxPQUFPLENBQUM7QUFDekgsZUFBUyxLQUFLLFVBQVUsT0FBTyxZQUFZLE9BQU8sWUFBWSxPQUFPLFlBQVk7QUFBRyxZQUFNLFFBQVEsT0FBTyxZQUFZLE9BQU8sZUFBZSxXQUFXLE9BQU87QUFFN0osWUFBTSxLQUFLLEVBQUUsU0FBUztBQUFHLFNBQUcsWUFBWTtBQUFJLFNBQUcsWUFBWTtBQUMzRCxVQUFJLE9BQU8sV0FBV0EsR0FBRSxPQUFPO0FBQzdCLFdBQUcsWUFBWTtBQUFRLFdBQUcsWUFBWSx5RkFBeUYsRUFBRSxHQUFHLElBQUlBLEdBQUUsV0FBVyw4QkFBOEIsSUFBSUEsR0FBRSxRQUFRLENBQUMsUUFBUSxRQUFRLE1BQU0sQ0FBQyxLQUFLLEVBQUUsb0NBQW9DQSxHQUFFLE1BQU0sSUFBSSxDQUFDLE1BQWMsTUFBYyx1QkFBdUIsT0FBTyxJQUFJLElBQUksU0FBUyxFQUFFLGFBQWEsQ0FBQyxJQUFJLE9BQU8sSUFBSSxJQUFJLHdCQUF3QixZQUFZLElBQUksQ0FBQyxNQUFNLEVBQUUsc0JBQXNCLEtBQUssTUFBTSxDQUFDLENBQUMsU0FBUyxPQUFPLElBQUksSUFBSSxhQUFhLElBQUksSUFBSSxLQUFLLElBQUksQ0FBQyxtQkFBbUIsVUFBVSxJQUFJLENBQUMsMkJBQTJCLFVBQVUsSUFBSSxDQUFDLGNBQWMsRUFBRSxLQUFLLEVBQUUsQ0FBQztBQUM5bUIsV0FBRyxpQkFBOEIsT0FBTyxFQUFFLFFBQVEsQ0FBQyxNQUFPLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFVBQVUsQ0FBQyxFQUFFLFFBQVEsQ0FBRSxDQUFFO0FBQUEsTUFDekcsV0FBVyxPQUFPLFNBQVMsT0FBTyxRQUFRO0FBQ3hDLGNBQU0sS0FBSyxPQUFPLFFBQVFBLEdBQUUsU0FBUyxNQUFNLEtBQUssQ0FBQyxNQUFjLFVBQVUsQ0FBQztBQUMxRSxjQUFNLGFBQWEsTUFBTSxHQUFHLFlBQVksR0FBRyxTQUFTLFNBQVMsMERBQTBELFFBQVEsT0FBTyxDQUFDLGNBQWMsR0FBRyxTQUFTLElBQUksQ0FBQyxNQUFjLGVBQWUsQ0FBQyxDQUFDLEVBQUUsS0FBSyxRQUFVLENBQUMsV0FBVztBQUNsTyxjQUFNLFdBQVdBLEdBQUUsVUFBVSwwREFBMEQsUUFBUSxNQUFNLENBQUMsMEJBQTBCLElBQUlBLEdBQUUsT0FBTyxDQUFDLFdBQVc7QUFDekosY0FBTSxLQUFLLE9BQU8sU0FBU0EsR0FBRSxRQUFRQSxHQUFFLGNBQWM7QUFDckQsY0FBTSxZQUFZQSxHQUFFLFFBQVMsS0FBSywwREFBMEQsR0FBRyxPQUFPLEdBQUcsUUFBUSxNQUFNLENBQUMsd0JBQXdCLEdBQUcsTUFBTSxnQkFBZ0IsR0FBRyxHQUFHLEtBQUssSUFBSSxDQUFDLGtCQUFrQixJQUFJLEdBQUcsSUFBSSxDQUFDLElBQUksUUFBUSxNQUFNLENBQUMsTUFBTSx3RUFBd0UsV0FBVyxLQUFNO0FBQ3pVLGNBQU0sYUFBYSxXQUFXLFlBQVksY0FBYyxLQUFLLDBEQUEwRCxHQUFHLE9BQVEsR0FBRyxRQUFRLEdBQUcsUUFBUSxNQUFNLENBQUMsOEJBQThCLEdBQUcsR0FBRyxLQUFLLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxRQUFRLE1BQU0sQ0FBQyxxQkFBcUIsR0FBRyxHQUFHLEtBQUssSUFBSSxDQUFDLGdCQUFpQixtQkFBbUIsR0FBRyxXQUFXLElBQUksR0FBRyxZQUFZLHNCQUFzQixXQUFXO0FBQzFYLFlBQUksT0FBTyxVQUFVLFVBQVUsS0FBS0EsR0FBRSxTQUFTO0FBQzdDLGdCQUFNLElBQUlBLEdBQUUsU0FBUyxNQUFNLEVBQUUsVUFBVSxFQUFFO0FBQ3pDLGFBQUcsWUFBWTtBQUFRLGFBQUcsWUFBWSxrRUFBa0UsRUFBRSxPQUFPLFFBQVEsRUFBRSxZQUFZLElBQUksS0FBSyxHQUFHLEtBQUssTUFBTSxpREFBaUQsZ0JBQWdCLEtBQUssSUFBSSxFQUFFLFdBQVcsRUFBRSxPQUFPLElBQUksR0FBRyxTQUFTQSxHQUFFLFVBQVUsMERBQTBELFFBQVEsTUFBTSxDQUFDLDBCQUEwQixJQUFJQSxHQUFFLE9BQU8sQ0FBQyxXQUFXLEVBQUUsR0FBRyxFQUFFLFFBQVEsMERBQTBELFFBQVEsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFLLGFBQWEsRUFBRSxVQUFVLElBQUksS0FBSyxHQUFHLDRCQUE0QiwyREFBMkQsb0JBQW9CLEVBQUUsUUFBUSxzREFBc0QsRUFBRSw2QkFBNkIsRUFBRSxRQUFRLFNBQVMsSUFBSTtBQUMvdkIsWUFBRSxPQUFPLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFdBQVc7QUFBRyxZQUFFLFFBQVEsRUFBRSxVQUFVLE1BQU0sT0FBTyxjQUFjLElBQUksTUFBTSxlQUFlLENBQUM7QUFDdEgsZ0JBQU0sTUFBTSxTQUFTLGVBQWUsUUFBUTtBQUFHLGNBQUksSUFBSyxLQUFJLFVBQVUsTUFBTSxPQUFPLGNBQWMsSUFBSSxNQUFNLGVBQWUsQ0FBQztBQUFBLFFBQzdILE9BQU87QUFDUCxhQUFHLFlBQVk7QUFBUSxhQUFHLFlBQVksd0JBQXdCQSxHQUFFLFFBQVMsT0FBTyxRQUFRLG9CQUFvQixxQkFBc0IsT0FBTyxRQUFRLG1CQUFtQixZQUFZLHlCQUF5QkEsR0FBRSxVQUFVLFNBQVMsVUFBVSxvQkFBcUIsTUFBTSxHQUFHLFFBQVUsTUFBTSxHQUFHLE9BQVEsc0RBQXNELEVBQUUsNkJBQThCLE1BQU0sR0FBRyxRQUFVLE1BQU0sR0FBRyxPQUFRLFNBQVMsSUFBSSxLQUFLLE9BQU8sUUFBUSxlQUFlLFdBQVc7QUFDdGQsWUFBRSxPQUFPLEVBQUUsVUFBVSxNQUFPQSxHQUFFLFFBQVFBLEdBQUUsU0FBUyxJQUFJQSxHQUFFLE9BQU87QUFBSSxZQUFFLFFBQVEsRUFBRSxVQUFVLE1BQU0sT0FBTyxjQUFjLElBQUksTUFBTSxlQUFlLENBQUM7QUFDN0ksZ0JBQU0sS0FBSyxTQUFTLGVBQWUsUUFBUTtBQUFHLGNBQUksR0FBSSxJQUFHLFVBQVUsTUFBTSxPQUFPLGNBQWMsSUFBSSxNQUFNLGVBQWUsQ0FBQztBQUFBLFFBQ3hIO0FBQUEsTUFDRjtBQUNBLFdBQUssZ0JBQWdCO0FBQ3JCLFVBQUksT0FBTyxRQUFTLHVCQUFzQixNQUFNQSxHQUFFLGFBQWEsQ0FBQztBQUFBLElBQ2xFO0FBQUE7QUFBQSxJQUdRLGNBQWM7QUFDcEIsWUFBTUEsS0FBSSxLQUFLLEdBQUcsSUFBSSxLQUFLO0FBQUssVUFBSSxDQUFDLEVBQUUsVUFBVSxTQUFTLE1BQU0sR0FBRztBQUFFLFVBQUUsWUFBWTtBQUFJO0FBQUEsTUFBUTtBQUMvRixZQUFNLE1BQU0sQ0FBQyxPQUFlLEtBQVUsS0FBc0IsS0FBYSxLQUFhLFNBQWlCLFVBQVUsS0FBSyw2QkFBNkIsR0FBRyxVQUFVLEdBQUcsV0FBVyxJQUFJLFlBQVksSUFBSSxHQUFHLENBQUMsYUFBYSxLQUFLLFdBQVcsSUFBSSxHQUFHLENBQUM7QUFDM08sUUFBRSxZQUFZO0FBQUE7QUFBQSxVQUVSLElBQUksZ0JBQVcsUUFBUSxLQUFLLElBQUksR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxnQkFBVyxRQUFRLEtBQUssSUFBSSxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLG9CQUFlLFFBQVEsS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLElBQUksb0JBQWUsUUFBUSxLQUFLLEtBQUssR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxnQkFBVyxRQUFRLEtBQUssT0FBTyxHQUFHLEdBQUcsS0FBSyxJQUFJLENBQUMsR0FBRyxJQUFJLGdCQUFXLFFBQVEsS0FBSyxPQUFPLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQztBQUFBLGlIQUM5TSxNQUFNLElBQUksQ0FBQyxNQUFNLFdBQVcsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sT0FBTyxZQUFZLFNBQVMsT0FBTyxFQUFFLElBQUksQ0FBQyxNQUFNLHFDQUFxQyxDQUFDLGFBQWEsQ0FBQyxZQUFhLFFBQVEsTUFBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFBQSx3REFDM1IsQ0FBQyxRQUFRLFVBQVUsUUFBUSxXQUFXLEVBQUUsSUFBSSxDQUFDLE1BQU0sa0JBQWtCLENBQUMsS0FBS0EsR0FBRSxlQUFlLElBQUksYUFBYSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFBQSx3RUFDekhBLEdBQUUsRUFBRSxNQUFNLFVBQVUsb0JBQW9CLFlBQVksRUFBRTtBQUFBLGdJQUNIQSxHQUFFLFVBQVUsWUFBWSxFQUFFO0FBQUEsaUdBQ3BELEtBQUssSUFBSTtBQUFBO0FBQUEsc0RBRXBELE1BQU0sSUFBSSxDQUFDLE1BQU0sa0JBQWtCLENBQUMsS0FBSyxVQUFVLENBQUMsQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFBQSw2REFDbkVBLEdBQUUsV0FBVztBQUFBLHNDQUNwQ0EsR0FBRSxJQUFJO0FBQ3hDLFFBQUUsaUJBQW1DLG1CQUFtQixFQUFFLFFBQVEsQ0FBQyxRQUFTLElBQUksVUFBVSxNQUFNO0FBQzlGLGNBQU0sTUFBTSxJQUFJLFFBQVE7QUFBSSxjQUFNLElBQUksQ0FBQyxJQUFJO0FBQU8sUUFBQyxJQUFJLG1CQUFtQyxjQUFjLE9BQU8sQ0FBQztBQUNoSCxjQUFNLE1BQWtDLEVBQUUsZ0JBQVcsTUFBTyxRQUFRLEtBQUssR0FBRyxDQUFDLElBQUksR0FBSSxnQkFBVyxNQUFPLFFBQVEsS0FBSyxHQUFHLENBQUMsSUFBSSxHQUFJLG9CQUFlLE1BQU8sUUFBUSxLQUFLLElBQUksQ0FBQyxJQUFJLEdBQUksb0JBQWUsTUFBTyxRQUFRLEtBQUssSUFBSSxDQUFDLElBQUksR0FBSSxnQkFBVyxNQUFPLFFBQVEsS0FBSyxNQUFNLENBQUMsSUFBSSxHQUFJLGdCQUFXLE1BQU8sUUFBUSxLQUFLLE1BQU0sQ0FBQyxJQUFJLEVBQUc7QUFDM1QsWUFBSSxHQUFHLEVBQUU7QUFBRyxRQUFBQSxHQUFFLG1CQUFtQjtBQUFBLE1BQ25DLENBQUU7QUFDRixRQUFFLGlCQUFtQyxXQUFXLEVBQUUsUUFBUSxDQUFDLFFBQVMsSUFBSSxXQUFXLE1BQU07QUFBRSxRQUFDLFFBQVEsTUFBYyxJQUFJLFFBQVEsSUFBSyxFQUFFLElBQUksUUFBUSxDQUFFLElBQUksQ0FBQyxJQUFJO0FBQUEsTUFBTyxDQUFFO0FBQ3JLLFFBQUUsT0FBTyxFQUFFLFdBQVcsQ0FBQyxNQUFNQSxHQUFFLGlCQUFrQixFQUFFLE9BQTZCLEtBQUs7QUFDckYsUUFBRSxZQUFZLEVBQUUsV0FBVyxDQUFDLE1BQU07QUFBRSxRQUFBQSxHQUFFLEVBQUUsTUFBTSxRQUFTLEVBQUUsT0FBNEIsVUFBVSxvQkFBb0I7QUFBZ0IsUUFBQUEsR0FBRSxVQUFVO0FBQUcsYUFBSyxPQUFPO0FBQUEsTUFBRztBQUNqSyxRQUFFLE9BQU8sRUFBRSxVQUFVLE1BQU07QUFBRSxjQUFNLElBQUlBLEdBQUUsU0FBUyxHQUFHO0FBQUcsYUFBSyxPQUFPLEdBQUcsRUFBRSxHQUFHLFVBQVUsRUFBRSxDQUFDLGdCQUFnQixFQUFFLE9BQU8sY0FBY0EsR0FBRSxFQUFFLElBQUk7QUFBSSxVQUFFLFVBQVUsRUFBRSxjQUFjLEtBQUs7QUFBQSxNQUFNO0FBQ25MLFFBQUUsT0FBTyxFQUFFLFVBQVUsTUFBTTtBQUFFLGNBQU0sSUFBSUEsR0FBRSxPQUFPO0FBQUcsU0FBQyxVQUFVLFlBQVksVUFBVSxVQUFVLFVBQVUsQ0FBQyxJQUFJLFFBQVEsT0FBTyxHQUFHLEtBQUssTUFBTSxLQUFLLE1BQU0sb0NBQW9DLENBQUMsRUFBRSxNQUFNLE1BQU07QUFBRSxpQkFBTyxxQkFBcUIsQ0FBQztBQUFBLFFBQUcsQ0FBQztBQUFBLE1BQUc7QUFDOU8sUUFBRSxNQUFNLEVBQUUsV0FBVyxDQUFDLE1BQU1BLEdBQUUsV0FBWSxFQUFFLE9BQTRCLE9BQU87QUFDL0UsUUFBRSxPQUFPLEVBQUUsVUFBVSxNQUFNO0FBQUUsY0FBTSxJQUFJQSxHQUFFLFdBQVc7QUFBRyxTQUFDLFVBQVUsWUFBWSxVQUFVLFVBQVUsVUFBVSxDQUFDLElBQUksUUFBUSxPQUFPLEdBQUcsS0FBSyxNQUFNLEtBQUssTUFBTSx5Q0FBeUMsQ0FBQyxFQUFFLE1BQU0sTUFBTTtBQUFFLGlCQUFPLHFCQUFxQixDQUFDO0FBQUEsUUFBRyxDQUFDO0FBQUEsTUFBRztBQUN2UCxRQUFFLFFBQVEsRUFBRSxVQUFVLE1BQU07QUFBRSxRQUFBQSxHQUFFLGdCQUFnQjtBQUFHLGFBQUssWUFBWTtBQUFBLE1BQUc7QUFDdkUsUUFBRSxVQUFVLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFdBQVdBLEdBQUUsSUFBSTtBQUNqRCxRQUFFLE1BQU0sRUFBRSxVQUFVLE1BQU1BLEdBQUUsUUFBUyxFQUFFLE9BQU8sRUFBd0IsS0FBZTtBQUFHLFFBQUUsTUFBTSxFQUFFLFVBQVUsTUFBTUEsR0FBRSxZQUFZLENBQUM7QUFBQSxJQUNuSTtBQUFBLElBQ0Esa0JBQWtCO0FBQ2hCLFlBQU0sSUFBSSxTQUFTLGVBQWUsUUFBUTtBQUFHLFVBQUksRUFBRyxHQUFFLGNBQWMsR0FBRyxLQUFLLEVBQUUsS0FBSztBQUNuRixZQUFNLEtBQUssU0FBUyxlQUFlLFNBQVM7QUFBRyxVQUFJLElBQUk7QUFBRSxjQUFNLElBQUksS0FBSyxFQUFFLFNBQVM7QUFBRyxXQUFHLGNBQWMsR0FBRyxFQUFFLElBQUksUUFBUSxDQUFDLENBQUMsaUJBQWMsRUFBRSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGtCQUFlLEVBQUUsSUFBSSxRQUFRLENBQUMsQ0FBQyxpQkFBYyxFQUFFLE1BQU0sUUFBUSxDQUFDLENBQUMsV0FBUSxFQUFFLE1BQU0sZ0JBQWEsRUFBRSxTQUFTLDBCQUF1QixFQUFFLEtBQUs7QUFBQSxNQUFlO0FBQzVTLFlBQU0sSUFBSSxTQUFTLGVBQWUsUUFBUTtBQUFHLFVBQUksRUFBRyxHQUFFLGNBQWMsS0FBSyxFQUFFO0FBQUEsSUFDN0U7QUFBQSxFQUNGOzs7QUNwR08sTUFBTSxPQUFOLE1BQVc7QUFBQSxJQUFYO0FBQ0w7QUFBYTtBQUFZO0FBQWE7QUFBWTtBQUNsRCxtQ0FBK0M7QUFBTSx5Q0FBa0M7QUFDdkY7QUFBQSxzQ0FBVztBQUFHLHFDQUFVO0FBQ3hCO0FBQUE7QUFBVyxrQ0FBTztBQUFHLHFDQUFVO0FBQUcsbUNBQWU7QUFBUyxvQ0FBd0I7QUFBTSx1Q0FBWTtBQUNwRyxpQ0FBVztBQUFNLHNDQUFXO0FBQU8sMkNBQWdCO0FBQU8sbUNBQXlCO0FBQU0sd0NBQWE7QUFDdEcsMEJBQVEsV0FBVSxvQkFBSSxJQUF3QjtBQUM5QztBQUFBLDBCQUFRLGFBQVksb0JBQUksSUFBd0I7QUFDaEQsMEJBQVEsUUFBTyxvQkFBSSxJQUF3QjtBQUMzQztBQUFBLDBCQUFRLFNBQVEsb0JBQUksSUFBb0I7QUFDeEM7QUFBQSwwQkFBUSxhQUFZLG9CQUFJLElBQW9CO0FBQzVDLDBCQUFRO0FBQ1IsMEJBQVEsU0FBZSxDQUFDO0FBQUcsMEJBQVEsWUFBa0IsQ0FBQztBQUFHLDBCQUFRLFVBQWdCLENBQUM7QUFBRywwQkFBUSxVQUFnQixDQUFDO0FBQUcsMEJBQVEsVUFBMEMsQ0FBQztBQUNwSywwQkFBUSxPQUFNO0FBQUcsMEJBQVEsV0FBZTtBQUFNLDBCQUFRLFNBQWE7QUFBTSwwQkFBUSxRQUFPO0FBQUcsMEJBQVEsVUFBUztBQUFLLDBCQUFRLFlBQVc7QUFBSSwwQkFBUSxXQUFVO0FBQU8sMEJBQVEsZUFBYztBQUN2TCwwQkFBUSxhQUFtQixDQUFDO0FBQUcsMEJBQVEsYUFBbUIsQ0FBQztBQUMzRDtBQUVBO0FBQUEsb0NBQTZCO0FBRTdCO0FBQUEscUNBQXdFO0FBQ3hFLDBCQUFRLFFBQU87QUFDZjtBQUFBLDBCQUFRO0FBQ1IsMEJBQVEsVUFBbUYsQ0FBQztBQUk1RiwwQkFBUSxjQUFhO0FBdUNyQjtBQUFBLDBCQUFRLFVBQVM7QUFFakI7QUFBQSxvQ0FBUztBQUtUO0FBQUE7QUFBQSwwQkFBUSxjQUE2SDtBQXdGckksMEJBQVE7QUFBNEIsMEJBQVEsU0FBUTtBQUFHLDBCQUFRLFNBQVE7QUFBRyx5Q0FBYztBQWtCeEY7QUFBQSxxQ0FBNEI7QUFBUywwQkFBUSxVQUFjLElBQUksUUFBUSxRQUFRLEdBQUcsS0FBSyxDQUFDO0FBMkN4RjtBQUFBLHFDQUFVO0FBQU8scUNBQVUsRUFBRSxLQUFLLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxPQUFPLEVBQUU7QUFBRyxxQ0FBaUIsQ0FBQztBQUNuRiwwQkFBUSxXQUFVLElBQUksYUFBYSxHQUFHO0FBQUcsMEJBQVEsU0FBUTtBQUFHLDBCQUFRLFNBQVE7QUFBRywwQkFBUSxlQUFjO0FBQUcsMEJBQVEsU0FBYTtBQUFNLDBCQUFRLFVBQTZCO0FBQ3hLLDBCQUFRLGFBQWdHO0FBMk14RywwQkFBUSxhQUFtQixDQUFDO0FBQUE7QUFBQSxJQW5acEIsTUFBTSxLQUFhLElBQXlCLE1BQW1CO0FBQUUsV0FBSyxPQUFPLEtBQUssRUFBRSxHQUFHLEdBQUcsS0FBSyxJQUFJLEtBQUssQ0FBQztBQUFBLElBQUc7QUFBQTtBQUFBLElBRTVHLGNBQWM7QUFBRSxpQkFBVyxLQUFLLEtBQUssT0FBTyxPQUFPLENBQUMsR0FBRztBQUFFLFVBQUUsR0FBRyxDQUFDO0FBQUcsWUFBSSxFQUFFLEtBQU0sR0FBRSxLQUFLO0FBQUEsTUFBRztBQUFBLElBQUU7QUFBQSxJQUdsRyxNQUFNLEtBQUssUUFBMkI7QUFDcEMsWUFBTSxLQUFLLElBQUksZ0JBQWdCLFNBQVMsTUFBTTtBQUM5QyxXQUFLLFNBQVMsSUFBSSxRQUFRLE9BQU8sUUFBUSxNQUFNLEVBQUUsV0FBVyxNQUFNLGlCQUFpQixtQkFBbUIsQ0FBQztBQUN2RyxZQUFNLE1BQU0sT0FBTyxvQkFBb0I7QUFBRyxXQUFLLE9BQU8sd0JBQXdCLElBQUksS0FBSyxJQUFJLEtBQUssR0FBRyxDQUFDO0FBQ3BHLFlBQU0sUUFBUSxLQUFLLFFBQVEsSUFBSSxRQUFRLE1BQU0sS0FBSyxNQUFNO0FBQUcsWUFBTSxhQUFhLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxNQUFNLENBQUM7QUFDcEgsWUFBTSxPQUFPLElBQUksUUFBUSxpQkFBaUIsS0FBSyxJQUFJLFFBQVEsUUFBUSxLQUFLLEdBQUcsR0FBRyxHQUFHLEtBQUs7QUFBRyxXQUFLLFlBQVk7QUFBTSxXQUFLLGNBQWMsSUFBSSxRQUFRLE9BQU8sTUFBTSxNQUFNLElBQUk7QUFDdEssWUFBTSxNQUFNLElBQUksUUFBUSxpQkFBaUIsS0FBSyxJQUFJLFFBQVEsUUFBUSxNQUFNLElBQUksSUFBSSxHQUFHLEtBQUs7QUFBRyxVQUFJLFlBQVk7QUFDM0csV0FBSyxTQUFTLElBQUksUUFBUSxXQUFXLE9BQU8sSUFBSSxRQUFRLFFBQVEsR0FBRyxHQUFHLEVBQUUsR0FBRyxLQUFLO0FBQUcsV0FBSyxPQUFPLE9BQU87QUFBSyxXQUFLLE9BQU8sT0FBTztBQUFLLFdBQUssT0FBTyxNQUFNO0FBQUssV0FBSyxPQUFPLE9BQU8sTUFBTTtBQUVuTCxZQUFNLFNBQVMsUUFBUSxZQUFZLGFBQWEsVUFBVSxFQUFFLE9BQU8sSUFBSSxRQUFRLEdBQUcsR0FBRyxLQUFLO0FBQzFGLGFBQU8sYUFBYTtBQUFPLFlBQU0sUUFBUSxLQUFLLFFBQVEsV0FBVyxPQUFPLE1BQU07QUFBRyxZQUFNLHlCQUF5QixJQUFJLE1BQU0sTUFBTSxPQUFPLFlBQVksSUFBSSxJQUFJLEdBQUksQ0FBQztBQUNoSyxpQkFBVyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQVksVUFBUyxJQUFJLEdBQUcsSUFBSSxZQUFZLEtBQUs7QUFBRSxjQUFNLElBQUksS0FBSyxTQUFTLE1BQU0sQ0FBQztBQUFHLFlBQUksU0FBUyxFQUFHLE1BQUssTUFBTSxLQUFLLENBQUM7QUFBQSxZQUFRLEdBQUUsV0FBVyxLQUFLO0FBQUEsTUFBRztBQUUzSyxXQUFLLElBQUksTUFBTSxXQUFXLEtBQUs7QUFDL0IsV0FBSyxNQUFNLElBQUksSUFBSSxPQUFPLEtBQUssUUFBUSxLQUFLLFFBQVEsU0FBUyxlQUFlLFlBQVksS0FBSyxTQUFTLE1BQU0sS0FBSyxFQUFFLElBQUk7QUFDdkgsV0FBSyxRQUFRLElBQUksWUFBWSxPQUFPLEtBQUssRUFBRSxNQUFNLEtBQUssRUFBRSxLQUFLO0FBQzdELFdBQUssTUFBTSxPQUFPLFNBQVMsSUFBSSxFQUFFLFdBQVcsWUFBWSxLQUFLLFdBQVcsTUFBTSxHQUFHLENBQUM7QUFBRyxXQUFLLE1BQU0sT0FBTyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQzlILFdBQUssWUFBWSxDQUFDLEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNO0FBQUUsY0FBTSxJQUFJLElBQUksUUFBUSxpQkFBaUIsT0FBTyxHQUFHLEtBQUs7QUFBRyxVQUFFLGVBQWUsUUFBUSxPQUFPLE1BQU07QUFBRyxVQUFFLGdCQUFnQixNQUFNLElBQUksSUFBSSxRQUFRLE9BQU8sTUFBTSxLQUFLLENBQUMsSUFBSSxJQUFJLFFBQVEsT0FBTyxHQUFHLEtBQUssSUFBSTtBQUFHLFVBQUUsa0JBQWtCO0FBQU0sZUFBTztBQUFBLE1BQUcsQ0FBQztBQUM3USxXQUFLLEtBQUssSUFBSSxHQUFHLElBQUk7QUFBRyxXQUFLLE9BQU8sRUFBRSxHQUFHLElBQUksTUFBTSxLQUFLO0FBQUksVUFBSSxHQUFHLElBQUksS0FBSyxFQUFHLE1BQUssV0FBVyxJQUFJO0FBR25HLFVBQUksT0FBbUQ7QUFDdkQsWUFBTSxRQUFRLENBQUMsTUFBb0I7QUFBRSxjQUFNLElBQUksT0FBTyxzQkFBc0I7QUFBRyxlQUFPLEVBQUUsR0FBRyxFQUFFLFVBQVUsRUFBRSxNQUFNLEdBQUcsRUFBRSxVQUFVLEVBQUUsSUFBSTtBQUFBLE1BQUc7QUFDdkksYUFBTyxpQkFBaUIsZUFBZSxDQUFDLE1BQU07QUFBRSxlQUFPLEVBQUUsR0FBRyxNQUFNLENBQUMsR0FBRyxHQUFHLFlBQVksSUFBSSxFQUFFO0FBQUEsTUFBRyxDQUFDO0FBQy9GLGFBQU8saUJBQWlCLGFBQWEsQ0FBQyxNQUFNO0FBQUUsWUFBSSxDQUFDLEtBQU07QUFBUSxjQUFNLElBQUksTUFBTSxDQUFDO0FBQUcsY0FBTSxRQUFRLEtBQUssTUFBTSxFQUFFLElBQUksS0FBSyxHQUFHLEVBQUUsSUFBSSxLQUFLLENBQUMsR0FBRyxLQUFLLFlBQVksSUFBSSxJQUFJLEtBQUs7QUFBRyxlQUFPO0FBQU0sWUFBSSxRQUFRLE1BQU0sS0FBSyxJQUFLLE1BQUssSUFBSSxFQUFFLEdBQUcsRUFBRSxDQUFDO0FBQUEsTUFBRyxDQUFDO0FBQzFPLGFBQU8saUJBQWlCLGlCQUFpQixNQUFNO0FBQUUsZUFBTztBQUFBLE1BQU0sQ0FBQztBQUMvRCxXQUFLLFNBQVM7QUFBUSxZQUFNLFdBQVcsTUFBTSxLQUFLLGFBQWE7QUFDL0QsYUFBTyxpQkFBaUIsVUFBVSxRQUFRO0FBQUcsYUFBTyxpQkFBaUIscUJBQXFCLE1BQU0sV0FBVyxVQUFVLEdBQUcsQ0FBQztBQUN6SCxVQUFLLE9BQWUsZUFBZ0IsQ0FBQyxPQUFlLGVBQWUsaUJBQWlCLFVBQVUsUUFBUTtBQUN0RyxVQUFLLE9BQWUsZUFBZ0IsS0FBSyxPQUFlLGVBQWUsUUFBUSxFQUFFLFFBQVEsTUFBTTtBQUMvRixVQUFJLEdBQUcsSUFBSSxTQUFTLEdBQUc7QUFBRSxhQUFLLFFBQVE7QUFBRztBQUFBLE1BQVE7QUFDakQsWUFBTSxRQUFRLEdBQUcsSUFBSSxNQUFNLElBQUksT0FBTyxRQUFRO0FBQzlDLFVBQUksTUFBTyxNQUFLLFFBQVEsS0FBSztBQUFBLFVBQVEsTUFBSyxXQUFXLEtBQUssSUFBSTtBQUM5RCxVQUFJLE9BQU8sWUFBWSxJQUFJO0FBQzNCLFdBQUssT0FBTyxjQUFjLE1BQU07QUFBRSxjQUFNLE1BQU0sWUFBWSxJQUFJLEdBQUcsTUFBTSxNQUFNO0FBQU0sY0FBTSxLQUFLLEtBQUssSUFBSSxNQUFNLE1BQU0sR0FBSTtBQUFHLGVBQU87QUFBSyxZQUFJLENBQUMsS0FBSyxPQUFRO0FBQVEsWUFBSSxLQUFLLFlBQVk7QUFBRSxlQUFLLGFBQWEsRUFBRTtBQUFHLGVBQUssSUFBSSxPQUFPLEVBQUU7QUFBQSxRQUFHLFdBQVcsQ0FBQyxLQUFLLE9BQVEsTUFBSyxNQUFNLEVBQUU7QUFBRyxjQUFNLE9BQU87QUFBRyxhQUFLLFNBQVMsR0FBRztBQUFBLE1BQUcsQ0FBQztBQUFBLElBQ25UO0FBQUEsSUFLQSxLQUFLLElBQVk7QUFBRSxXQUFLLE1BQU0sRUFBRTtBQUFBLElBQUc7QUFBQSxJQUNuQyxVQUFVLElBQWE7QUFBRSxXQUFLLFNBQVM7QUFBSSxVQUFJLE1BQU0sS0FBSyxNQUFPLE1BQUssTUFBTSxnQkFBZ0IsT0FBTyxDQUFDLE1BQVcsRUFBRSxTQUFTLEdBQUcsRUFBRSxRQUFRLENBQUMsTUFBVztBQUFFLFVBQUUsS0FBSztBQUFHLFVBQUUsUUFBUSxLQUFLO0FBQUEsTUFBRyxDQUFDO0FBQUEsSUFBRztBQUFBO0FBQUEsSUFLckwsUUFBUSxNQUFjO0FBQ3BCLFVBQUksQ0FBQyxLQUFLLEtBQUssS0FBSyxXQUFZO0FBQ2hDLFlBQU0sU0FBZ0IsQ0FBQztBQUFHLFlBQU0sT0FBTyxDQUFDLE1BQVc7QUFBRSxZQUFJLEtBQUssRUFBRSxhQUFhLEVBQUUsVUFBVSxHQUFHO0FBQUUsWUFBRSxXQUFXLEtBQUs7QUFBRyxpQkFBTyxLQUFLLENBQUM7QUFBQSxRQUFHO0FBQUEsTUFBRTtBQUNySSxpQkFBV0MsTUFBSyxLQUFLLFFBQVEsT0FBTyxFQUFHLE1BQUtBLEdBQUUsTUFBTTtBQUFHLFdBQUssS0FBSyxRQUFRLENBQUNBLE9BQU0sS0FBS0EsR0FBRSxNQUFNLENBQUM7QUFBRyxVQUFJLEtBQUssTUFBTSxPQUFPLFVBQVUsR0FBRztBQUFFLGFBQUssTUFBTSxXQUFXLEtBQUs7QUFBRyxlQUFPLEtBQUssRUFBRSxZQUFZLENBQUMsT0FBZ0IsS0FBSyxNQUFNLFdBQVcsRUFBRSxFQUFFLENBQUM7QUFBQSxNQUFHO0FBQUUsV0FBSyxPQUFPLFFBQVEsQ0FBQyxNQUFNLEtBQUssRUFBRSxDQUFDLENBQUM7QUFBRyxXQUFLLE9BQU8sUUFBUSxDQUFDLE1BQU0sS0FBSyxFQUFFLElBQUksQ0FBQztBQUM3VCxZQUFNLE9BQU8sS0FBSyxNQUFNLFNBQVMsS0FBSyxLQUFLLE1BQU0sQ0FBQyxFQUFFLFVBQVU7QUFBRyxXQUFLLFNBQVMsS0FBSztBQUNwRixZQUFNLElBQUksYUFBYSxLQUFLLEdBQUcsTUFBTSxHQUFHLENBQUM7QUFBRyxZQUFNLElBQUksRUFBRSxHQUFHLElBQUksR0FBRyxFQUFFO0FBQUcsUUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxRQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFNLFFBQUUsS0FBSyxNQUFNO0FBQzlKLFdBQUssYUFBYSxFQUFFLE1BQU0sR0FBRyxNQUFNLEdBQUcsTUFBTSxHQUFHLE1BQU0sTUFBTSxRQUFRLEtBQUs7QUFDeEUsZUFBUyxLQUFLLFVBQVUsSUFBSSxTQUFTO0FBQ3JDLFdBQUssT0FBTyxNQUFNO0FBQU0sV0FBSyxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsTUFBTSxFQUFFLElBQUksR0FBRztBQUFHLFdBQUssT0FBTyxVQUFVLElBQUksUUFBUSxRQUFRLEVBQUUsR0FBRyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0FBQ2pJLFdBQUssaUJBQWlCO0FBQUEsSUFDeEI7QUFBQSxJQUNBLGFBQWE7QUFDWCxZQUFNLElBQUksS0FBSztBQUFZLFVBQUksQ0FBQyxFQUFHO0FBQ25DLFFBQUUsRUFBRSxRQUFRO0FBQUcsUUFBRSxPQUFPLFFBQVEsQ0FBQyxNQUFNLEVBQUUsV0FBVyxJQUFJLENBQUM7QUFBRyxXQUFLLFNBQVMsRUFBRSxRQUFRLEtBQUssVUFBVSxPQUFPO0FBQzFHLFdBQUssYUFBYTtBQUFNLGVBQVMsS0FBSyxVQUFVLE9BQU8sU0FBUztBQUFHLFlBQU0sTUFBTSxTQUFTLGVBQWUsWUFBWTtBQUFHLFVBQUksSUFBSyxLQUFJLFlBQVk7QUFDL0ksV0FBSyxPQUFPLE1BQU07QUFBSyxXQUFLLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSztBQUFBLElBQ3ZEO0FBQUEsSUFDUSxhQUFhLElBQVk7QUFDL0IsWUFBTSxJQUFJLEtBQUs7QUFBYSxRQUFFLEVBQUUsT0FBTyxFQUFFO0FBQUcsVUFBSSxFQUFFLEtBQU0sR0FBRSxFQUFFLE9BQU8sU0FBUyxLQUFLLEtBQUs7QUFDdEYsV0FBSyxNQUFNLE9BQU8sWUFBWSxJQUFJLElBQUksR0FBSTtBQUFBLElBQzVDO0FBQUEsSUFDUSxtQkFBbUI7QUFDekIsWUFBTSxJQUFJLEtBQUs7QUFBWSxZQUFNLE1BQU0sU0FBUyxlQUFlLFlBQVk7QUFBRyxVQUFJLENBQUMsS0FBSyxDQUFDLElBQUs7QUFDOUYsWUFBTSxPQUFPLENBQUMsTUFBVztBQXJJN0I7QUFxSWlDLHVCQUFFLE9BQU8sV0FBVyxRQUFRLFVBQVUsT0FBTyxTQUFTLE9BQU8sT0FBTyxFQUFVLENBQUMsTUFBL0UsWUFBb0YsRUFBRSxRQUFRLG1CQUFtQixPQUFPO0FBQUE7QUFDckosWUFBTSxTQUFTLEVBQUUsRUFBRSxZQUFZLEVBQUUsRUFBRSxVQUFVLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLHNCQUFzQixDQUFDLEtBQUssS0FBSyxDQUFDLENBQUMsV0FBVyxFQUFFLEtBQUssRUFBRTtBQUN2SCxVQUFJLFlBQVksOEVBQThFLFVBQVUsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sc0JBQXNCLENBQUMsWUFBWSxFQUFFLFNBQVMsSUFBSSxPQUFPLEVBQUUsS0FBSyxDQUFDLGlCQUFpQixFQUFFLEtBQUssRUFBRSxDQUFDLDhCQUE4QixFQUFFLE9BQU8sT0FBTyxFQUFFLHNEQUFzRCxFQUFFLE9BQU8sT0FBTyxFQUFFLDRDQUE0QyxLQUFLO0FBQ2haLFVBQUksaUJBQThCLGFBQWEsRUFBRSxRQUFRLENBQUMsTUFBTyxFQUFFLFVBQVUsTUFBTTtBQUFFLGNBQU0sS0FBSyxLQUFLO0FBQUcsVUFBRSxFQUFFLGVBQWUsRUFBRSxFQUFFLFlBQVksRUFBRSxRQUFRLElBQUs7QUFBQSxNQUFHLENBQUU7QUFDL0osVUFBSSxpQkFBOEIsYUFBYSxFQUFFLFFBQVEsQ0FBQyxNQUFPLEVBQUUsVUFBVSxNQUFNO0FBQUUsVUFBRSxPQUFPLENBQUMsRUFBRSxRQUFRO0FBQU8sVUFBRSxFQUFFLFFBQVEsRUFBRSxJQUFJO0FBQUcsYUFBSyxpQkFBaUI7QUFBQSxNQUFHLENBQUU7QUFDaEssTUFBQyxTQUFTLGVBQWUsUUFBUSxFQUFrQixVQUFVLE1BQU07QUFBRSxVQUFFLE9BQU8sRUFBRSxPQUFPLElBQUk7QUFBRyxVQUFFLEVBQUUsUUFBUSxFQUFFLElBQUk7QUFBRyxhQUFLLGlCQUFpQjtBQUFBLE1BQUc7QUFDNUksTUFBQyxTQUFTLGVBQWUsUUFBUSxFQUFrQixVQUFVLE1BQU07QUFBRSxVQUFFLE9BQU8sQ0FBQyxFQUFFO0FBQU0sYUFBSyxpQkFBaUI7QUFBQSxNQUFHO0FBQ2hILE1BQUMsU0FBUyxlQUFlLFFBQVEsRUFBa0IsVUFBVSxNQUFNLE9BQU8sY0FBYyxJQUFJLE1BQU0sZ0JBQWdCLENBQUM7QUFBQSxJQUNySDtBQUFBO0FBQUE7QUFBQSxJQUlRLFNBQVMsSUFBYTtBQUFFLGlCQUFXLEtBQUssS0FBSyxNQUFPLEdBQUUsV0FBVyxFQUFFO0FBQUEsSUFBRztBQUFBLElBQ3RFLFNBQVMsTUFBYSxNQUFjO0FBQzFDLFlBQU0sSUFBSSxRQUFRLE1BQU0sSUFBSSxHQUFHLElBQUksUUFBUSxZQUFZLFlBQVksU0FBUyxNQUFNLEVBQUUsTUFBTSxVQUFVLEtBQUssR0FBRyxLQUFLLEtBQUs7QUFDdEgsUUFBRSxTQUFTLElBQUksS0FBSyxLQUFLO0FBQUcsUUFBRSxTQUFTLElBQUksRUFBRSxHQUFHLE9BQU8sRUFBRSxDQUFDO0FBQzFELFlBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sS0FBSyxLQUFLO0FBQUcsUUFBRSxlQUFlLFFBQVEsT0FBTyxNQUFNO0FBQUcsUUFBRSxnQkFBZ0IsU0FBUyxJQUFJLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxJQUFJLElBQUksSUFBSSxRQUFRLE9BQU8sTUFBTSxNQUFNLElBQUk7QUFBRyxRQUFFLFFBQVE7QUFBSyxRQUFFLGtCQUFrQjtBQUFNLFFBQUUsV0FBVztBQUNyUSxVQUFJLFNBQVMsR0FBRztBQUFFLFVBQUUsV0FBVyxFQUFFLE1BQU0sUUFBUSxLQUFLO0FBQUcsYUFBSyxTQUFTLElBQUksSUFBSTtBQUFBLE1BQUcsTUFBTyxHQUFFLGFBQWE7QUFDdEcsYUFBTztBQUFBLElBQ1Q7QUFBQSxJQUNRLEtBQUssTUFBYyxNQUE2QztBQUN0RSxZQUFNLElBQUksS0FBSyxTQUFTLElBQUk7QUFBRyxZQUFNLElBQUksRUFBRSxRQUFRLENBQUMsTUFBTSxNQUFNLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxLQUFLLE1BQU0sTUFBTSxHQUFHLEdBQUcsS0FBSyxDQUFDLEdBQUcsTUFBTSxLQUFLLElBQUksR0FBRyxTQUFTLENBQUMsTUFBTSxNQUFNLEdBQUcsSUFBSSxFQUFFLEVBQUUsSUFBSTtBQUMxSyxRQUFFLGdCQUFnQixJQUFJLFFBQVEsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztBQUFHLFFBQUUsUUFBUSxFQUFFLENBQUM7QUFBQSxJQUN2RTtBQUFBLElBQ0EsTUFBTSxLQUFhLElBQWdCO0FBQUUsV0FBSyxPQUFPLEtBQUssRUFBRSxHQUFHLEtBQUssR0FBRyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQy9ELE9BQU8sR0FBVyxHQUFXLE9BQVksSUFBWSxJQUFZLEtBQWE7QUFDcEYsWUFBTSxJQUFJLFFBQVEsWUFBWSxZQUFZLE1BQU0sRUFBRSxVQUFVLEdBQUcsV0FBVyxPQUFPLGNBQWMsR0FBRyxHQUFHLEtBQUssS0FBSztBQUFHLFFBQUUsU0FBUyxJQUFJLEdBQUcsTUFBTSxDQUFDO0FBQUcsUUFBRSxhQUFhO0FBQzdKLFlBQU0sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLE9BQU8sS0FBSyxLQUFLO0FBQUcsU0FBRyxnQkFBZ0I7QUFBTyxTQUFHLGtCQUFrQjtBQUFNLFNBQUcsUUFBUTtBQUFLLFFBQUUsV0FBVztBQUFJLFdBQUssT0FBTyxLQUFLLEVBQUUsR0FBRyxJQUFJLEdBQUcsR0FBRyxJQUFJLElBQUksSUFBSSxDQUFDO0FBQUEsSUFDak07QUFBQSxJQUNRLE1BQU0sR0FBVyxHQUFXLElBQWMsSUFBYyxPQUFlO0FBQzdFLFlBQU0sS0FBSyxJQUFJLFFBQVEsZUFBZSxLQUFLLElBQUksS0FBSyxLQUFLO0FBQUcsU0FBRyxrQkFBa0IsS0FBSyxFQUFFO0FBQU0sU0FBRyxVQUFVLElBQUksUUFBUSxRQUFRLEdBQUcsTUFBTSxDQUFDO0FBQUcsU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLE1BQU0sR0FBRyxJQUFJO0FBQUcsU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLEtBQUssTUFBTSxHQUFHO0FBQ2xQLFNBQUcsU0FBUyxJQUFJLFFBQVEsT0FBTyxHQUFJLEVBQXVDO0FBQUcsU0FBRyxTQUFTLElBQUksUUFBUSxPQUFPLEdBQUksRUFBdUM7QUFBRyxTQUFHLFlBQVksSUFBSSxRQUFRLE9BQU8sS0FBSyxHQUFHLEtBQUssQ0FBQztBQUMxTSxTQUFHLFVBQVU7QUFBTSxTQUFHLFVBQVU7QUFBTSxTQUFHLGNBQWM7QUFBSyxTQUFHLGNBQWM7QUFBSyxTQUFHLFdBQVc7QUFBRyxTQUFHLGtCQUFrQjtBQUFPLFNBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxJQUFJLEtBQUssRUFBRTtBQUFHLFNBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssQ0FBQztBQUM5TixTQUFHLGVBQWU7QUFBSyxTQUFHLGVBQWU7QUFBRyxTQUFHLFVBQVUsSUFBSSxRQUFRLFFBQVEsR0FBRyxJQUFJLENBQUM7QUFBRyxTQUFHLFlBQVksUUFBUSxlQUFlO0FBQWUsU0FBRyxxQkFBcUI7QUFBSyxTQUFHLGdCQUFnQjtBQUFPLFNBQUcsb0JBQW9CLFFBQVEsTUFBTSxHQUFHLFFBQVEsS0FBSyxDQUFDO0FBQUcsU0FBRyxNQUFNO0FBQUEsSUFDeFE7QUFBQTtBQUFBLElBR1EsUUFBUTtBQUNkLFlBQU0sTUFBTSxLQUFLLE9BQU8sZUFBZSxJQUFJLEtBQUssT0FBTyxnQkFBZ0IsR0FBRyxPQUFPLEtBQUssSUFBSSxLQUFLLE9BQU8sTUFBTSxDQUFDO0FBQzdHLFlBQU0sT0FBTyxXQUFXLFlBQVksS0FBSyxVQUFVO0FBQ25ELFlBQU0sSUFBSSxLQUFLLElBQUksUUFBUSxPQUFPLE9BQVEsWUFBWSxVQUFXLElBQUksTUFBTSxPQUFPLE9BQU8sQ0FBQztBQUMxRixZQUFNLFNBQVMsRUFBRSxLQUFLLElBQUksUUFBUSxRQUFRLE9BQU8sR0FBRyxPQUFPLElBQUksS0FBSyxRQUFRLENBQUMsR0FBRyxLQUFLLElBQUksUUFBUSxRQUFRLEdBQUcsTUFBTSxDQUFDLEVBQUU7QUFFckgsWUFBTSxLQUFLLEVBQUUsV0FBWSxZQUFZLEtBQUssVUFBVyxJQUFJLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLFlBQVk7QUFDakcsWUFBTSxNQUFNLENBQUMsT0FBZTtBQUFFLGNBQU0sS0FBSyxTQUFTLGVBQWUsRUFBRTtBQUFHLGVBQU8sTUFBTSxHQUFHLGlCQUFpQixPQUFPLEdBQUcsc0JBQXNCLElBQUk7QUFBQSxNQUFNO0FBQ2pKLFlBQU0sU0FBUyxJQUFJLEtBQUssR0FBRyxPQUFPLElBQUksTUFBTSxHQUFHLE9BQU8sSUFBSSxNQUFNO0FBQ2hFLFlBQU0sTUFBTSxLQUFLLElBQUksTUFBTSxVQUFVLE9BQU8sU0FBUyxLQUFLLElBQUksR0FBRztBQUNqRSxZQUFNLFNBQVMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLElBQUksT0FBTyxLQUFLLE1BQU0sR0FBRyxPQUFPLEtBQUssTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDO0FBQzdGLFlBQU0sT0FBTyxLQUFLLElBQUksS0FBSyxJQUFJLE1BQU0sTUFBTSxHQUFHLGFBQWEsTUFBTSxPQUFPO0FBQ3hFLFlBQU0sS0FBSyxZQUFZLFVBQVUsS0FBSyxLQUFLLFlBQVksVUFBVTtBQUNqRSxZQUFNLEtBQUssS0FBSyxJQUFJLE1BQU0sSUFBSSxPQUFPLE9BQU8sTUFBTSxJQUFJLE9BQU8sTUFBTSxPQUFPLEdBQUc7QUFDN0UsWUFBTSxTQUFTLE1BQU0sY0FBYyxJQUFJLEtBQUssTUFBTSxLQUFLLEtBQUs7QUFDNUQsWUFBTSxRQUFRLEVBQUUsS0FBSyxJQUFJLFFBQVEsUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLE1BQU0sRUFBRSxHQUFHLEtBQUssSUFBSSxRQUFRLFFBQVEsSUFBSSxHQUFHLENBQUMsS0FBSyxFQUFFO0FBQzdHLFlBQU0sUUFBUSxFQUFFLEtBQUssSUFBSSxRQUFRLFFBQVEsT0FBTyxJQUFJLElBQUksS0FBSyxPQUFPLElBQUksSUFBSSxNQUFNLE9BQU8sSUFBSSxJQUFJLElBQUksR0FBRyxLQUFLLElBQUksUUFBUSxRQUFRLE1BQU0sTUFBTSxDQUFDLEVBQUU7QUFDaEosYUFBTyxFQUFFLFFBQVEsT0FBTyxNQUFNO0FBQUEsSUFDaEM7QUFBQTtBQUFBLElBRUEsZUFBZTtBQUNiLFVBQUksS0FBSyxVQUFVLFdBQVcsS0FBSyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsS0FBSyxPQUFRO0FBQzFFLFlBQU0sSUFBSSxLQUFLLE1BQU0sRUFBRSxPQUFPLElBQUksS0FBSyxPQUFPO0FBQzlDLFVBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEtBQUssUUFBUSxRQUFRLFNBQVMsR0FBRyxFQUFFLEdBQUcsSUFBSSxLQUFNO0FBQ3JFLFdBQUssU0FBUyxHQUFHLElBQUk7QUFBQSxJQUN2QjtBQUFBLElBRVEsZUFBZTtBQUNyQixVQUFJLENBQUMsS0FBSyxPQUFPLGVBQWUsQ0FBQyxLQUFLLE9BQU8sYUFBYztBQUMzRCxXQUFLLE9BQU8sT0FBTztBQUFHLFdBQUssUUFBUSxLQUFLLE9BQU87QUFBYSxXQUFLLFFBQVEsS0FBSyxPQUFPO0FBQ3JGLFVBQUksS0FBSyxVQUFVLFdBQVcsS0FBSyxRQUFRLEVBQUcsTUFBSyxPQUFPLEtBQUssTUFBTSxFQUFFLEtBQUs7QUFBQSxJQUM5RTtBQUFBO0FBQUEsSUFFUSxJQUFJLEdBQVcsR0FBVztBQUNoQyxZQUFNLElBQUksS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsTUFBVyxDQUFDLEVBQUUsRUFBRSxZQUFZLEVBQUUsU0FBUyxLQUFLO0FBQzdFLFlBQU0sS0FBSyxLQUFLLEVBQUUsTUFBTSxFQUFFLFdBQVcsV0FBVztBQUNoRCxXQUFLLGNBQWMsT0FBTyxLQUFLLE1BQU0sQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLENBQUMsQ0FBQyxPQUFPLEtBQUssT0FBTyxXQUFXLElBQUksS0FBSyxPQUFPLFlBQVksT0FBTyxLQUFNLEdBQUcsU0FBUyxTQUFTLFVBQVUsR0FBRyxPQUFPLFNBQVUsU0FBUyxXQUFXLEtBQUssS0FBSztBQUNoTixVQUFJLEtBQUssVUFBVSxXQUFXLENBQUMsR0FBSTtBQUNuQyxVQUFJLEdBQUcsU0FBUyxPQUFRLE1BQUssT0FBTyxHQUFHLElBQUk7QUFBQSxlQUFZLEdBQUcsU0FBUyxPQUFRLE1BQUssYUFBYSxHQUFHLE1BQU07QUFBQSxJQUN4RztBQUFBLElBQ1EsT0FBTyxHQUFRO0FBQUUsV0FBSyxPQUFPLFNBQVMsU0FBUyxFQUFFLEdBQUc7QUFBRyxXQUFLLE9BQU8sVUFBVSxFQUFFLElBQUksTUFBTSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQzdGLFNBQVMsSUFBUyxLQUFhO0FBQUUsV0FBSyxVQUFVLEVBQUUsS0FBSyxLQUFLLE9BQU8sU0FBUyxNQUFNLEdBQUcsS0FBSyxLQUFLLE9BQU8sVUFBVSxFQUFFLE1BQU0sRUFBRTtBQUFHLFdBQUssUUFBUTtBQUFJLFdBQUssT0FBTztBQUFHLFdBQUssU0FBUztBQUFBLElBQUs7QUFBQSxJQUl4TCxXQUFXLEdBQXFCO0FBQzlCLFdBQUssVUFBVTtBQUNmLFVBQUksTUFBTSxVQUFVLEtBQUssT0FBUSxNQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsUUFBUSxHQUFHO0FBQ3ZFLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDakI7QUFBQSxJQUNRLFlBQVksSUFBWTtBQUM5QixZQUFNLElBQUksS0FBSztBQUFRLFVBQUksQ0FBQyxFQUFHO0FBQVEsWUFBTSxRQUFRLEVBQUUsU0FBUyxPQUFPLENBQUMsTUFBTSxFQUFFLEtBQUs7QUFBRyxVQUFJLENBQUMsTUFBTSxPQUFRO0FBQzNHLFVBQUksS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLEtBQUssS0FBSztBQUFNLGlCQUFXLEtBQUssT0FBTztBQUFFLGFBQUssS0FBSyxJQUFJLElBQUksRUFBRSxDQUFDO0FBQUcsYUFBSyxLQUFLLElBQUksSUFBSSxFQUFFLENBQUM7QUFBRyxhQUFLLEtBQUssSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUFHLGFBQUssS0FBSyxJQUFJLElBQUksRUFBRSxDQUFDO0FBQUEsTUFBRztBQUN2SyxZQUFNLE1BQU0sS0FBSyxPQUFPLGVBQWUsSUFBSSxLQUFLLE9BQU8sZ0JBQWdCLEdBQUcsT0FBTyxLQUFLLElBQUksS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUM3RyxZQUFNLE9BQU8sS0FBSyxNQUFNLEVBQUUsUUFBUSxNQUFNLEtBQUssTUFBTSxHQUFHLE1BQU0sS0FBSyxNQUFNO0FBQ3ZFLFlBQU0sSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxNQUFNLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLE9BQU8sR0FBRyxHQUFHLEtBQUssTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksQ0FBQyxDQUFDO0FBQ25KLFlBQU0sTUFBTSxJQUFJLFFBQVEsUUFBUSxJQUFJLE1BQU0sRUFBRSxHQUFHLE1BQU0sSUFBSSxRQUFRLFFBQVEsS0FBSyxPQUFPLEdBQUcsT0FBTyxJQUFJLEtBQUssS0FBSyxNQUFNLENBQUM7QUFDcEgsWUFBTSxJQUFJLElBQUksS0FBSyxJQUFJLENBQUMsS0FBSyxDQUFHO0FBQ2hDLFdBQUssT0FBTyxXQUFXLFFBQVEsUUFBUSxLQUFLLEtBQUssT0FBTyxVQUFVLEtBQUssQ0FBQztBQUFHLFdBQUssU0FBUyxRQUFRLFFBQVEsS0FBSyxLQUFLLFFBQVEsS0FBSyxDQUFDO0FBQUcsV0FBSyxPQUFPLFVBQVUsS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUFBLElBQy9LO0FBQUE7QUFBQTtBQUFBLElBSVEsYUFBYTtBQXpPdkI7QUEwT0ksVUFBSTtBQUNGLGNBQU0sSUFBSSxLQUFLO0FBQUcsWUFBSSxDQUFDLEVBQUc7QUFDMUIsWUFBSSxFQUFFLFdBQVcsWUFBWTtBQUFFLG1CQUFTO0FBQUc7QUFBQSxRQUFRO0FBQ25ELFlBQUksS0FBSyxVQUFVLFdBQVcsS0FBSyxVQUFVLFFBQVM7QUFDdEQsY0FBTSxPQUFvQixFQUFFLEdBQUcsR0FBRyxNQUFNLEtBQUssTUFBTSxTQUFTLEtBQUssU0FBUyxPQUFPLGdCQUFnQixZQUFZLGdCQUFnQixPQUFPLEtBQUssT0FBTyxPQUFPLEtBQUssVUFBVSxVQUFVLEtBQUssUUFBUSxNQUFNLE9BQU8sZUFBZSxDQUFDLEdBQUcsWUFBVyxVQUFLLFlBQUwsbUJBQWMsVUFBVTtBQUNoUSxnQkFBUSxJQUFJO0FBQUEsTUFDZCxRQUFRO0FBQUEsTUFBd0M7QUFBQSxJQUNsRDtBQUFBO0FBQUEsSUFFUSxRQUFRLEdBQXdDO0FBblAxRDtBQW9QSSxZQUFNLEVBQUUsTUFBTSxNQUFNLElBQUk7QUFDeEIsV0FBSyxPQUFPO0FBQU8sV0FBSyxZQUFZO0FBQUcsV0FBSyxNQUFNLE9BQU87QUFDekQsV0FBSyxRQUFRO0FBQ2IsVUFBSSxLQUFLLFVBQVUsWUFBWSxXQUFXLENBQUMsS0FBSyxVQUFVLEdBQUc7QUFBRSxjQUFNLE1BQU0sQ0FBQyxLQUFLLFlBQVksTUFBTSxZQUFZLEdBQUc7QUFBRyxpQkFBUyxLQUFLLEdBQUc7QUFBRyxhQUFLLFFBQVEsRUFBRSxLQUFLLElBQUk7QUFBRyxhQUFLLFVBQVU7QUFBTSxhQUFLLE1BQU0sU0FBUyxPQUFPO0FBQUEsTUFBRyxXQUM5TSxLQUFLLFVBQVUsWUFBWTtBQUFFLG1CQUFXO0FBQUcsY0FBTSxPQUFPLEtBQUssSUFBSSxHQUFHLE1BQU0sT0FBTyxDQUFDO0FBQUcsYUFBSyxVQUFVLEVBQUUsWUFBVyxVQUFLLGNBQUwsWUFBa0IsU0FBUyxFQUFFLFFBQVEsTUFBTSxTQUFTLE1BQU0sT0FBTyxLQUFLLE1BQU0sT0FBTyxrQkFBa0IsRUFBRTtBQUFBLE1BQUcsT0FBTztBQUFFLDJCQUFtQixLQUFLLE9BQU8sS0FBSyxVQUFVO0FBQUcsYUFBSyxVQUFVO0FBQUEsTUFBTTtBQUNuVCxVQUFJLENBQUMsS0FBSyxNQUFPLE1BQUssTUFBTSxTQUFTLGNBQWM7QUFDbkQsV0FBSyxPQUFPLEtBQUs7QUFBTSxXQUFLLFVBQVUsS0FBSztBQUFTLFdBQUssSUFBSTtBQUFPLFdBQUssYUFBYSxNQUFNLE1BQU07QUFDbEcsV0FBSyxZQUFZO0FBQUcsT0FBQyxHQUFHLEtBQUssUUFBUSxPQUFPLENBQUMsRUFBRSxRQUFRLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssUUFBUSxNQUFNO0FBQUcsV0FBSyxVQUFVLE1BQU07QUFDdkgsV0FBSyxNQUFNO0FBQU0sV0FBSyxXQUFXO0FBQU8sV0FBSyxRQUFRLEtBQUssVUFBVSxVQUFVLEtBQUssUUFBUTtBQUFNLFdBQUssUUFBUSxLQUFLLFFBQVEsVUFBVTtBQUFTLFdBQUssU0FBUyxLQUFLLFVBQVUsT0FBTztBQUNsTCxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFHLFdBQUssT0FBTyxLQUFLLE1BQU0sRUFBRSxLQUFLO0FBQUcsV0FBSyxNQUFNLHNCQUFzQixVQUFVLElBQUksTUFBTSxPQUFPLE1BQU0sT0FBTyxNQUFNLFdBQVcsS0FBSyxDQUFDLEtBQUssTUFBTSxNQUFNLFNBQVMsTUFBTSxXQUFXLElBQUksS0FBSyxHQUFHLEdBQUc7QUFBQSxJQUNqTztBQUFBLElBTUEsV0FBVyxJQUFhO0FBQ3RCLFdBQUssVUFBVTtBQUNmLFVBQUksTUFBTSxDQUFDLEtBQUssUUFBUTtBQUFFLGNBQU0sSUFBSSxTQUFTLGNBQWMsS0FBSztBQUFHLFVBQUUsS0FBSztBQUFVLFNBQUMsU0FBUyxlQUFlLFlBQVksS0FBSyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBQUcsYUFBSyxTQUFTO0FBQUEsTUFBRztBQUM5SyxVQUFJLEtBQUssT0FBUSxNQUFLLE9BQU8sTUFBTSxVQUFVLEtBQUssVUFBVTtBQUFBLElBQzlEO0FBQUEsSUFDUSxTQUFTLElBQVk7QUF6US9CO0FBMFFJLFVBQUksS0FBSyxJQUFLO0FBQ2QsV0FBSyxRQUFRLEtBQUssS0FBSyxJQUFJO0FBQUksV0FBSyxTQUFTLEtBQUssUUFBUSxLQUFLLEtBQUssUUFBUTtBQUFRLFdBQUssUUFBUSxLQUFLLElBQUksS0FBSyxRQUFRLFFBQVEsS0FBSyxRQUFRLENBQUM7QUFDN0ksWUFBTSxJQUFJLEtBQUs7QUFDZixVQUFJLE1BQU0sS0FBSyxVQUFVLFlBQVksS0FBSyxVQUFVLGVBQWU7QUFBRSxVQUFFO0FBQVUsVUFBRSxPQUFPO0FBQUksWUFBSSxLQUFLLEVBQUUsTUFBTyxHQUFFLFFBQVE7QUFBSSxZQUFJLEtBQUssS0FBTSxHQUFFO0FBQVEsVUFBRSxRQUFRLEtBQUssSUFBSSxFQUFFLE9BQU8sS0FBSyxTQUFTO0FBQUEsTUFBRztBQUNwTSxZQUFNLE1BQU0sWUFBWSxJQUFJO0FBQUcsVUFBSSxNQUFNLEtBQUssY0FBYyxJQUFLO0FBQVEsV0FBSyxjQUFjO0FBQzVGLFlBQU0sSUFBSSxNQUFNLEtBQUssS0FBSyxRQUFRLFNBQVMsR0FBRyxLQUFLLEtBQUssQ0FBQyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLENBQUMsSUFBSSxFQUFFO0FBQ3pILFdBQUssVUFBVSxFQUFFLEtBQUssTUFBTyxLQUFLLEtBQUssTUFBSyxPQUFFLEtBQUssTUFBTSxFQUFFLFNBQVMsSUFBSSxDQUFDLE1BQTdCLFlBQWtDLEdBQUcsUUFBTyxPQUFFLEVBQUUsU0FBUyxDQUFDLE1BQWQsWUFBbUIsRUFBRTtBQUM3RyxVQUFJLEtBQUssVUFBVSxLQUFLLFFBQVMsTUFBSyxPQUFPLGNBQWMsR0FBRyxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsQ0FBQyxTQUFTLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLENBQUM7QUFDdEssV0FBSyxHQUFHLGdCQUFnQjtBQUFBLElBQzFCO0FBQUEsSUFDUSxrQkFBa0I7QUFBRSxXQUFLLFlBQVksRUFBRSxRQUFRLEdBQUcsS0FBSyxHQUFHLE9BQU8sR0FBRyxNQUFNLEdBQUcsT0FBTyxLQUFLLFVBQVU7QUFBQSxJQUFHO0FBQUEsSUFDdEcsZ0JBQWdCO0FBQ3RCLFlBQU0sSUFBSSxLQUFLO0FBQVcsV0FBSyxZQUFZO0FBQU0sVUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLE9BQVE7QUFDdEUsV0FBSyxRQUFRLEtBQUssRUFBRSxNQUFNLEtBQUssRUFBRSxNQUFNLFNBQVMsS0FBSyxTQUFTLE9BQU8sRUFBRSxPQUFPLFVBQVUsS0FBSyxTQUFTLEtBQUssT0FBTyxTQUFTLFNBQVMsR0FBRyxLQUFLLEVBQUUsT0FBUSxFQUFFLE1BQU0sRUFBRSxTQUFTLFFBQVEsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxFQUFFLE1BQU0sUUFBUSxDQUFDLEdBQUcsU0FBUyxFQUFHLE1BQU0sRUFBRSxPQUFRLEVBQUUsUUFBUSxRQUFRLENBQUMsRUFBRSxDQUFDO0FBQ3JRLFVBQUksS0FBSyxRQUFRLFNBQVMsR0FBSSxNQUFLLFFBQVEsTUFBTTtBQUFBLElBQ25EO0FBQUEsSUFDQSxXQUFXO0FBQ1QsWUFBTSxLQUFLLEtBQUs7QUFBTyxVQUFJLENBQUMsS0FBSyxTQUFTLFFBQVEscUJBQXNCLE1BQUssUUFBUSxJQUFJLFFBQVEscUJBQXFCLEVBQUU7QUFDeEgsYUFBTyxFQUFFLEdBQUcsS0FBSyxTQUFTLFFBQVEsR0FBRyxnQkFBZ0IsRUFBRSxRQUFRLFdBQVcsR0FBRyxnQkFBZ0IsUUFBUSxPQUFPLEtBQUssUUFBUSxLQUFLLE1BQU0saUJBQWlCLFVBQVUsR0FBRztBQUFBLElBQ3BLO0FBQUEsSUFDQSxhQUFxQjtBQUNuQixZQUFNLElBQUksS0FBSyxTQUFTLEdBQUcsS0FBVSxLQUFLLE9BQU8sWUFBWSxLQUFLLE9BQU8sVUFBVSxJQUFJLENBQUM7QUFDeEYsWUFBTSxPQUFPLEtBQUssUUFBUSxJQUFJLENBQUMsTUFBTSxVQUFVLEVBQUUsSUFBSSxRQUFRLEVBQUUsT0FBTyxPQUFPLEVBQUUsS0FBSyxNQUFNLEVBQUUsR0FBRyw2QkFBNkIsRUFBRSxPQUFPLE9BQU8sRUFBRSxPQUFPLGtCQUFrQixFQUFFLFFBQVEsV0FBVztBQUM1TCxhQUFPO0FBQUEsUUFBQyxTQUFRLG9CQUFJLEtBQUssR0FBRSxZQUFZLENBQUM7QUFBQSxRQUFJLFdBQVcsVUFBVSxTQUFTO0FBQUEsUUFBSSxRQUFRLEdBQUcsWUFBWSxHQUFHLEtBQUssR0FBRyxVQUFVLEdBQUc7QUFBQSxRQUMzSCxVQUFVLE9BQU8sS0FBSyxJQUFJLE9BQU8sTUFBTSxjQUFjLFVBQVUsSUFBSSxXQUFXLFNBQVMsZ0JBQWdCLFlBQVksS0FBSyxPQUFPLGVBQWUsQ0FBQyxJQUFJLEtBQUssT0FBTyxnQkFBZ0IsQ0FBQyxtQkFBbUIsS0FBSyxPQUFPLHdCQUF3QixFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBQUEsUUFDblAsUUFBUSxFQUFFLElBQUksUUFBUSxDQUFDLENBQUMsaUJBQWlCLEVBQUUsSUFBSSxRQUFRLENBQUMsQ0FBQyxrQkFBa0IsRUFBRSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGFBQWEsRUFBRSxNQUFNLFFBQVEsQ0FBQyxDQUFDLHNCQUFzQixFQUFFLE1BQU0sc0JBQXNCLEVBQUUsU0FBUyxnQkFBZ0IsRUFBRSxLQUFLO0FBQUEsUUFDaE4sZ0JBQWdCLEtBQUssS0FBSyxXQUFXLEtBQUssU0FBUyxhQUFhLEtBQUssT0FBTyxnQkFBZ0IsY0FBYyxVQUFVLEtBQUssRUFBRSxJQUFJLFdBQVcsS0FBSyxFQUFFLE1BQU0sTUFBTTtBQUFBLFFBQzdKO0FBQUEsUUFBMEIsR0FBSSxLQUFLLFNBQVMsT0FBTyxDQUFDLG1EQUFtRDtBQUFBLE1BQUUsRUFBRSxLQUFLLElBQUk7QUFBQSxJQUN4SDtBQUFBO0FBQUEsSUFHQSxVQUFVO0FBQUUsWUFBTSxJQUFJLEtBQUs7QUFBRyxVQUFJLENBQUMsS0FBSyxFQUFFLFdBQVcsV0FBWSxRQUFPO0FBQU0sYUFBUSxFQUFFLE9BQU8sS0FBSyxFQUFFLE1BQU0sU0FBUyxLQUFLLEtBQUssVUFBVSxLQUFLLEVBQUUsTUFBTSxXQUFXLElBQUssRUFBRSxNQUFNLEVBQUUsTUFBTSxPQUFPLFdBQVcsQ0FBQyxHQUFHLFFBQVEsRUFBRSxRQUFRLFlBQVksZ0JBQWdCLE9BQU8sZUFBZSxJQUFJO0FBQUEsSUFBTTtBQUFBO0FBQUE7QUFBQSxJQUcxUixhQUFhO0FBQUUsV0FBSyxXQUFXLEtBQUssTUFBTSxLQUFLLE9BQU8sSUFBSSxHQUFHLElBQUksQ0FBQztBQUFHLGVBQVM7QUFBQSxJQUFHO0FBQUEsSUFDakYsU0FBUztBQUFFLFdBQUssV0FBVyxJQUFJLGdCQUFnQixTQUFTLE1BQU0sRUFBRSxJQUFJLE1BQU0sSUFBSSxLQUFLLE9BQU8sS0FBSyxNQUFNLEtBQUssT0FBTyxJQUFJLEdBQUcsSUFBSSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQ2hJLFdBQVcsTUFBYztBQUN2QixXQUFLLE9BQU87QUFBTyxXQUFLLFNBQVM7QUFBTSxXQUFLLFlBQVk7QUFBRyxVQUFJLEtBQUssTUFBTyxNQUFLLE1BQU0sT0FBTztBQUM3RixXQUFLLFVBQVU7QUFBRyxXQUFLLFdBQVc7QUFBRyxXQUFLLFFBQVE7QUFBTSxXQUFLLGNBQWM7QUFBTSxXQUFLLE9BQU87QUFBTSxXQUFLLFVBQVU7QUFBRyxXQUFLLFVBQVU7QUFBTSxZQUFNLEtBQUssU0FBUyxHQUFHLEtBQUssU0FBUyxFQUFFO0FBQUcseUJBQW1CLEdBQUcsT0FBTyxHQUFHLFVBQVU7QUFBRyxXQUFLLE1BQU0sU0FBUyxjQUFjO0FBQUcsV0FBSyxJQUFJLFNBQVMsRUFBRSxHQUFHLGlCQUFpQixNQUFNLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBRyxXQUFLLGFBQWE7QUFDeFYsV0FBSyxZQUFZO0FBQUcsV0FBSyxTQUFTLElBQUk7QUFBRyxPQUFDLEdBQUcsS0FBSyxRQUFRLE9BQU8sQ0FBQyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxRQUFRLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1SSxXQUFLLE1BQU07QUFBTSxXQUFLLFdBQVc7QUFBTyxXQUFLLFFBQVE7QUFBTSxXQUFLLFFBQVE7QUFDeEUsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBRyxXQUFLLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSztBQUFHLFdBQUssTUFBTSwyQkFBMkIsS0FBSyxFQUFFLE1BQU0sOENBQThDO0FBQUEsSUFDeEs7QUFBQTtBQUFBLElBRUEsV0FBVztBQUFFLFdBQUssV0FBVyxVQUFVLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDM0MsV0FBVyxLQUFhO0FBQ3RCLFdBQUssT0FBTztBQUFPLFdBQUssU0FBUztBQUFNLFdBQUssWUFBWTtBQUFHLFVBQUksS0FBSyxNQUFPLE1BQUssTUFBTSxPQUFPO0FBQzdGLFlBQU0sTUFBTSxZQUFZLEdBQUcsR0FBRyxLQUFLLFNBQVM7QUFBRyxlQUFTLEtBQUssR0FBRztBQUFHLFdBQUssTUFBTSxTQUFTLE9BQU87QUFDOUYsV0FBSyxVQUFVO0FBQUcsV0FBSyxXQUFXO0FBQUcsV0FBSyxjQUFjO0FBQU0sV0FBSyxVQUFVO0FBQU0sV0FBSyxRQUFRLEVBQUUsS0FBSyxJQUFJO0FBQUcsV0FBSyxPQUFPO0FBQUssV0FBSyxVQUFVO0FBQzlJLFdBQUssSUFBSSxTQUFTLFdBQVcsS0FBSyxHQUFHLElBQUksR0FBRyxLQUFLLElBQUk7QUFBRyxXQUFLLGFBQWE7QUFDMUUsV0FBSyxZQUFZO0FBQUcsV0FBSyxTQUFTLElBQUk7QUFBRyxPQUFDLEdBQUcsS0FBSyxRQUFRLE9BQU8sQ0FBQyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxRQUFRLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1SSxXQUFLLE1BQU07QUFBTSxXQUFLLFdBQVc7QUFBTyxXQUFLLFFBQVE7QUFBTSxXQUFLLFFBQVE7QUFDeEUsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBRyxXQUFLLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSztBQUFHLFdBQUssTUFBTSxvQkFBb0IsSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJLEVBQUU7QUFBQSxJQUM3SDtBQUFBO0FBQUEsSUFFQSxhQUFhO0FBQUUsV0FBSyxhQUFhLElBQUksZ0JBQWdCLFNBQVMsTUFBTSxFQUFFLElBQUksTUFBTSxJQUFJLEtBQUssT0FBTyxLQUFLLE1BQU0sS0FBSyxPQUFPLElBQUksR0FBRyxJQUFJLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDdEksYUFBYSxNQUFjO0FBQ3pCLFdBQUssT0FBTztBQUFPLFdBQUssU0FBUztBQUFNLFdBQUssWUFBWTtBQUFHLFVBQUksS0FBSyxNQUFPLE1BQUssTUFBTSxPQUFPO0FBQzdGLFdBQUssVUFBVTtBQUFHLFdBQUssV0FBVztBQUFHLFdBQUssUUFBUTtBQUFNLFdBQUssY0FBYztBQUFNLFdBQUssT0FBTztBQUFNLFdBQUssVUFBVTtBQUFHLFlBQU0sS0FBSyxTQUFTO0FBQUcsaUJBQVc7QUFBRyxXQUFLLE1BQU0sU0FBUyxVQUFVO0FBQ3hMLFdBQUssVUFBVSxFQUFFLFdBQVcsR0FBRyxRQUFRLE1BQU0sU0FBUyxHQUFHLE9BQU8sRUFBRTtBQUNsRSxXQUFLLElBQUksU0FBUyxFQUFFLEdBQUcsZUFBZSxNQUFNLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBRyxXQUFLLGFBQWE7QUFDaEYsV0FBSyxZQUFZO0FBQUcsV0FBSyxTQUFTLElBQUk7QUFBRyxPQUFDLEdBQUcsS0FBSyxRQUFRLE9BQU8sQ0FBQyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxRQUFRLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1SSxXQUFLLE1BQU07QUFBTSxXQUFLLFdBQVc7QUFBTyxXQUFLLFFBQVE7QUFBTSxXQUFLLFFBQVE7QUFDeEUsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBRyxXQUFLLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSztBQUFHLFdBQUssTUFBTSxrRUFBa0U7QUFBQSxJQUNwSjtBQUFBLElBQ1EsY0FBYztBQUNwQixXQUFLLEtBQUssUUFBUSxDQUFDLEdBQUcsT0FBTztBQUFFLFlBQUksQ0FBQyxLQUFLLE1BQU0sSUFBSSxFQUFFLEVBQUcsR0FBRSxRQUFRO0FBQUEsTUFBRyxDQUFDO0FBQUcsV0FBSyxLQUFLLE1BQU07QUFBRyxXQUFLLE1BQU0sTUFBTTtBQUFHLFdBQUssVUFBVSxNQUFNO0FBQUcsV0FBSyxTQUFTO0FBQ3RKLFdBQUssT0FBTyxRQUFRLENBQUMsTUFBTSxFQUFFLEtBQUssUUFBUSxDQUFDO0FBQUcsV0FBSyxTQUFTLENBQUM7QUFBQSxJQUMvRDtBQUFBLElBQ1EsSUFBSSxNQUFjO0FBQUUsYUFBTyxRQUFRLEdBQUcsSUFBSTtBQUFBLElBQUc7QUFBQTtBQUFBLElBRXJELGdCQUF1RTtBQUNyRSxVQUFJLENBQUMsS0FBSyxLQUFLLENBQUMsS0FBSyxVQUFVLEtBQUssVUFBVSxRQUFTLFFBQU87QUFDOUQsWUFBTSxPQUFPLElBQUksSUFBSSxLQUFLLEVBQUUsTUFBTSxJQUFJLENBQUMsTUFBVyxFQUFFLElBQUksQ0FBQztBQUFHLFVBQUksS0FBSyxHQUFHLEtBQUs7QUFBRyxZQUFNLE1BQU0sTUFBTSxLQUFLLEVBQUUsUUFBUSxXQUFXLEdBQUcsQ0FBQyxHQUFHLE1BQU0sS0FBSyxJQUFJLENBQUMsQ0FBQztBQUFHLFVBQUksUUFBUSxDQUFDQyxPQUFNO0FBQUUsY0FBTUEsR0FBRSxJQUFJO0FBQVksY0FBTUEsR0FBRSxJQUFJO0FBQUEsTUFBWSxDQUFDO0FBQzdOLFVBQUksT0FBTyxJQUFJLEtBQUs7QUFBSyxlQUFTLElBQUksR0FBRyxJQUFJLFlBQVksS0FBSztBQUFFLFlBQUksS0FBSyxJQUFJLENBQUMsRUFBRztBQUFVLGNBQU0sSUFBSSxLQUFLLE1BQU0sSUFBSSxDQUFDLEVBQUUsSUFBSSxJQUFJLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRTtBQUFHLFlBQUksSUFBSSxJQUFJO0FBQUUsZUFBSztBQUFHLGlCQUFPO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDakwsVUFBSSxPQUFPLEVBQUcsUUFBTztBQUNyQixZQUFNLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxVQUFVLE1BQU0sSUFBSSxLQUFLLE9BQU8sZUFBZSxHQUFHLElBQUksS0FBSyxPQUFPLGdCQUFnQixHQUFHLEtBQUssS0FBSyxPQUFPLFNBQVMsU0FBUyxHQUFHLENBQUMsR0FBRyxJQUFJLEtBQUssTUFBTSxtQkFBbUI7QUFDMUwsWUFBTSxNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLE1BQU0sUUFBUSxRQUFRLFFBQVEsSUFBSSxRQUFRLFFBQVEsRUFBRSxJQUFJLElBQUksTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLFFBQVEsT0FBTyxTQUFTLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFDM0ssWUFBTSxJQUFJLEtBQUssT0FBTyxzQkFBc0IsR0FBRyxLQUFLLEVBQUUsUUFBUSxHQUFHLEtBQUssRUFBRSxTQUFTLEdBQUcsS0FBSyxJQUFJLElBQUksQ0FBQyxNQUFXLEVBQUUsQ0FBQyxHQUFHLEtBQUssSUFBSSxJQUFJLENBQUMsTUFBVyxFQUFFLENBQUM7QUFDL0ksWUFBTSxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUUsR0FBRyxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUUsR0FBRyxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUUsR0FBRyxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUU7QUFDM0YsVUFBSSxDQUFDLFNBQVMsS0FBSyxLQUFLLEtBQUssRUFBRSxFQUFHLFFBQU87QUFDekMsYUFBTyxFQUFFLEdBQUcsRUFBRSxPQUFPLEtBQUssSUFBSSxHQUFHLEVBQUUsTUFBTSxLQUFLLElBQUksSUFBSSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssTUFBTSxHQUFHO0FBQUEsSUFDekY7QUFBQSxJQUNBLFlBQVk7QUE3VmQ7QUE4VkksV0FBSyxXQUFXO0FBQ2hCLFlBQU0sU0FBUyxLQUFLLEVBQUUsTUFBTSxTQUFTLEtBQUs7QUFBWSxXQUFLLGFBQWEsS0FBSyxFQUFFLE1BQU07QUFDckYsWUFBTSxRQUFRLFNBQVMsS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU07QUFBRSxjQUFNLEtBQUssS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUcsZUFBTyxDQUFDLENBQUMsTUFBTSxHQUFHLFNBQVMsRUFBRTtBQUFBLE1BQU0sQ0FBQyxJQUFJO0FBQzdILFlBQU0sUUFBUSxJQUFJLElBQUksS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7QUFDbkQsaUJBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxLQUFLLFFBQVMsS0FBSSxDQUFDLE1BQU0sSUFBSSxFQUFFLEdBQUc7QUFDdEQsYUFBSyxVQUFVLE9BQU8sQ0FBQztBQUFHLGFBQUssUUFBUSxPQUFPLEVBQUU7QUFBRyxjQUFNLElBQUksRUFBRSxPQUFPO0FBQ3RFLFlBQUksT0FBTztBQUNULGdCQUFNLEtBQUssS0FBSyxJQUFJLE1BQU0sSUFBSSxHQUFHLEtBQUssRUFBRSxHQUFHLEtBQUssRUFBRSxHQUFHLEtBQUssRUFBRSxPQUFPLFFBQVE7QUFBRyxZQUFFLEtBQUssTUFBTTtBQUMzRixlQUFLO0FBQUEsWUFBTTtBQUFBLFlBQU0sQ0FBQyxNQUFNO0FBQUUsZ0JBQUUsT0FBTyxTQUFTLElBQUksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDO0FBQUcsZ0JBQUUsT0FBTyxRQUFRLE9BQU8sTUFBTSxJQUFJLE9BQU8sRUFBRTtBQUFBLFlBQUc7QUFBQSxZQUN0SyxNQUFNO0FBQUUsbUJBQUssTUFBTSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLEVBQUU7QUFBRyxnQkFBRSxRQUFRO0FBQUEsWUFBRztBQUFBLFVBQUM7QUFBQSxRQUMvRixPQUFPO0FBQUUsZUFBSyxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFHLFlBQUUsUUFBUTtBQUFBLFFBQUc7QUFBQSxNQUM5RjtBQUNBLFlBQU0sT0FBTyxTQUFTLEVBQUU7QUFDeEIsaUJBQVcsS0FBSyxLQUFLLEVBQUUsT0FBTztBQUM1QixZQUFJLElBQUksS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUcsY0FBTSxJQUFJLEtBQUssSUFBSSxFQUFFLElBQUk7QUFDekQsWUFBSSxDQUFDLEdBQUc7QUFBRSxjQUFJLGFBQWEsS0FBSyxHQUFHLEVBQUUsTUFBTSxHQUFHLEVBQUUsSUFBSTtBQUFHLGVBQUssUUFBUSxJQUFJLEVBQUUsSUFBSSxDQUFDO0FBQUcsZUFBSyxVQUFVLElBQUksR0FBRyxFQUFFLEVBQUU7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUFHLFlBQUUsT0FBTyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQUcsWUFBRSxLQUFLLE9BQU87QUFBRyxlQUFLLFNBQVMsRUFBRSxHQUFHLEVBQUUsQ0FBQztBQUFHLGdCQUFNLEtBQUssUUFBUTtBQUFHLGdCQUFNLEtBQUs7QUFBRyxlQUFLLE1BQU0sS0FBSyxNQUFNO0FBQUUsZ0JBQUksS0FBSyxVQUFVLFFBQVMsSUFBRyxLQUFLLE1BQU07QUFBQSxVQUFHLENBQUM7QUFBQSxRQUFHLE9BQ3hVO0FBQUUsWUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFHLGNBQUksRUFBRSxTQUFTLEVBQUUsTUFBTTtBQUFFLGtCQUFNLEtBQUs7QUFBRyxjQUFFLFFBQVEsRUFBRSxJQUFJO0FBQUcsaUJBQUssTUFBTSxTQUFTLE1BQU0sT0FBTyxFQUFFLEtBQUssT0FBTyxHQUFHLE1BQU0sS0FBSyxRQUFRLElBQUksRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQUEsVUFBRztBQUFBLFFBQUU7QUFBQSxNQUNqTztBQUNBLGlCQUFXLEtBQUssS0FBSyxFQUFFLE9BQU87QUFBRSxjQUFNLEtBQUssS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUcsWUFBSSxNQUFNLEdBQUcsU0FBVSxJQUFHLFVBQVUsZ0JBQWEsRUFBRSxJQUFJLE1BQW5CLG1CQUFzQixVQUF0QixZQUErQixDQUFDO0FBQUEsTUFBRztBQUMxSSxlQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxNQUFLLEtBQUssR0FBRyxRQUFRO0FBQzFELFlBQU0sTUFBTSxLQUFLO0FBQ2pCLFVBQUksT0FBTyxJQUFJLFNBQVMsVUFBVSxLQUFLLFVBQVUsU0FBUztBQUN4RCxpQkFBUyxJQUFJLEdBQUcsSUFBSSxZQUFZLElBQUssS0FBSSxTQUFTLEtBQUssR0FBRyxDQUFDLEVBQUcsTUFBSyxLQUFLLEdBQUcsVUFBVSxLQUFLLEdBQUcsSUFBSSxHQUFHLElBQUksU0FBUyxRQUFRO0FBQ3pILG1CQUFXLEtBQUssS0FBSyxFQUFFLE1BQU8sS0FBSSxpQkFBaUIsS0FBSyxHQUFHLElBQUksS0FBSyxFQUFFLEVBQUUsRUFBRyxNQUFLLEtBQUssRUFBRSxNQUFNLFNBQVM7QUFBQSxNQUN4RztBQUNBLFVBQUksT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUM5QixjQUFNLElBQUksS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLElBQUksRUFBRTtBQUNsRCxZQUFJLEdBQUc7QUFBRSxlQUFLLEtBQUssRUFBRSxNQUFNLEtBQUs7QUFBRyxxQkFBVyxLQUFLLEtBQUssRUFBRSxNQUFPLEtBQUksaUJBQWlCLEdBQUcsQ0FBQyxFQUFHLE1BQUssS0FBSyxFQUFFLE1BQU0sU0FBUztBQUFHLG1CQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxLQUFJLFNBQVMsS0FBSyxHQUFHLENBQUMsRUFBRyxNQUFLLEtBQUssR0FBRyxNQUFNO0FBQUEsUUFBRztBQUFBLE1BQ2pOO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFUSxRQUFRLEdBQWUsR0FBVyxHQUFXO0FBQ25ELFlBQU0sS0FBSyxPQUFPO0FBQUcsUUFBRSxNQUFNO0FBQUcsVUFBSSxDQUFDLEtBQUssV0FBWSxNQUFLLElBQUksT0FBTyxHQUFHLEdBQUcsRUFBRSxJQUFJO0FBQUcsWUFBTSxTQUFTLEVBQUUsT0FBTyxRQUFRO0FBQ3JILFdBQUssT0FBTyxHQUFHLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxNQUFNLEdBQUcsR0FBRyxLQUFLLEdBQUssSUFBSTtBQUFHLFdBQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxPQUFPLEdBQUcsR0FBRyxJQUFJLFFBQVEsT0FBTyxHQUFHLEdBQUcsQ0FBQyxHQUFHLEtBQUssR0FBSyxHQUFHLENBQUM7QUFDekosV0FBSyxNQUFNLEdBQUcsR0FBRyxDQUFDLEdBQUcsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQUcsV0FBSyxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQzNILFdBQUssTUFBTSxNQUFNLENBQUMsTUFBTSxFQUFFLE9BQU8sUUFBUSxPQUFPLFVBQVUsSUFBSSxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxLQUFLLElBQUksSUFBSSxLQUFLLEdBQUcsTUFBTSxFQUFFLE9BQU8sUUFBUSxPQUFPLE1BQU0sQ0FBQztBQUFBLElBQ3JKO0FBQUEsSUFDUSxTQUFTLEdBQVcsR0FBVztBQUFFLFVBQUksQ0FBQyxLQUFLLE9BQVE7QUFBUSxXQUFLLElBQUksT0FBTyxHQUFHLEdBQUcsQ0FBQztBQUFHLFdBQUssTUFBTSxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLEdBQUcsQ0FBQyxNQUFNLEtBQUssS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFHLFdBQUssT0FBTyxHQUFHLEdBQUcsSUFBSSxRQUFRLE9BQU8sS0FBSyxLQUFLLENBQUMsR0FBRyxLQUFLLEtBQUssR0FBRztBQUFBLElBQUc7QUFBQTtBQUFBLElBR2pPLE1BQU0sS0FBYTtBQUFFLFdBQUssR0FBRyxNQUFNLEdBQUc7QUFBQSxJQUFHO0FBQUEsSUFDekMsT0FBTyxLQUFhO0FBQ2xCLFVBQUksS0FBSyxVQUFVLFFBQVM7QUFDNUIsVUFBSSxLQUFLLFVBQVU7QUFBRSxZQUFJLGNBQWMsS0FBSyxHQUFHLEdBQUcsR0FBRztBQUFFLGVBQUssTUFBTSxpQ0FBaUM7QUFBRyxlQUFLLFdBQVc7QUFBQSxRQUFPLE1BQU8sTUFBSyxNQUFNLCtCQUErQjtBQUFBLE1BQUcsTUFDNUssTUFBSyxNQUFNLEtBQUssT0FBTyxLQUFLLElBQUksU0FBUyxVQUFVLEtBQUssSUFBSSxRQUFRLE1BQU0sT0FBTyxFQUFFLE1BQU0sUUFBUSxJQUFJO0FBQzFHLFdBQUssZ0JBQWdCO0FBQU8sV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUMvRDtBQUFBLElBQ0EsT0FBTyxNQUFjO0FBQ25CLFlBQU0sSUFBSSxLQUFLLEdBQUcsTUFBTSxLQUFLO0FBQUssVUFBSSxLQUFLLFVBQVUsUUFBUztBQUM5RCxZQUFNLE9BQU8sRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxJQUFJO0FBQUcsVUFBSSxNQUFNO0FBQUUsYUFBSyxhQUFhLEtBQUssUUFBUSxJQUFJLEtBQUssRUFBRSxDQUFFO0FBQUc7QUFBQSxNQUFRO0FBQ3RILFVBQUksT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUM5QixZQUFJLFVBQVUsR0FBRyxJQUFJLEdBQUcsR0FBRztBQUFFLGlCQUFPLEdBQUcsSUFBSSxLQUFLLElBQUk7QUFBRyxlQUFLLE1BQU07QUFBQSxRQUFNLE9BQ25FO0FBQUUsZ0JBQU0sT0FBTyxFQUFFLEtBQUssSUFBSSxHQUFHO0FBQUcsZUFBSyxNQUFNLHdCQUF3QixVQUFVLElBQUksQ0FBQyxVQUFVLEtBQUssTUFBTSxDQUFDLENBQUMsY0FBYyxhQUFhLENBQUMsQ0FBQyxRQUFRO0FBQUEsUUFBRztBQUFBLE1BQ3hKLFdBQVcsT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUFFLFlBQUksU0FBUyxHQUFHLElBQUksSUFBSSxJQUFJLEVBQUcsTUFBSyxNQUFNO0FBQUEsTUFBTTtBQUN6RixXQUFLLGdCQUFnQjtBQUFPLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDL0Q7QUFBQSxJQUNBLGFBQWEsR0FBZTtBQUMxQixZQUFNLEtBQUssS0FBSyxVQUFVLElBQUksQ0FBQztBQUFHLFVBQUksT0FBTyxVQUFhLEtBQUssVUFBVSxRQUFTO0FBQ2xGLFlBQU0sSUFBSSxLQUFLLEdBQUcsSUFBSSxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUU7QUFDckQsVUFBSSxLQUFLLFVBQVU7QUFBRSxZQUFJLFNBQVMsR0FBRyxFQUFFLEdBQUc7QUFBRSxlQUFLLE1BQU0sUUFBUSxVQUFVLEVBQUUsSUFBSSxDQUFDLDBCQUEwQjtBQUFHLGVBQUssV0FBVztBQUFBLFFBQU8sTUFBTyxNQUFLLE1BQU0sRUFBRSxRQUFRLG1EQUFtRCwrQkFBK0I7QUFBQSxNQUFHLFdBQzVPLEtBQUssT0FBTyxLQUFLLElBQUksU0FBUyxVQUFVLEVBQUUsS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsS0FBSyxFQUFFLE1BQU0sVUFBVSxtQkFBbUI7QUFDdkksWUFBSSxjQUFjLEdBQUcsS0FBSyxJQUFJLEtBQUssRUFBRSxHQUFHO0FBQUUsZUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLEdBQUc7QUFBRyxlQUFLLE1BQU0saUNBQWlDLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRztBQUFBLFFBQUcsTUFDekksTUFBSyxNQUFNLDBDQUEwQyxLQUFLLEVBQUUsTUFBTSxDQUFDLElBQUksS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDLG1CQUFtQixhQUFhLENBQUMsQ0FBQyxRQUFRO0FBQUEsTUFDdkksV0FDUyxLQUFLLE9BQU8sS0FBSyxJQUFJLFNBQVMsVUFBVSxLQUFLLElBQUksT0FBTyxJQUFJO0FBQ25FLGNBQU0sSUFBSSxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFRLEtBQUssSUFBWSxFQUFFO0FBQzNELFlBQUksaUJBQWlCLEdBQUcsQ0FBQyxHQUFHO0FBQUUsd0JBQWMsR0FBRyxFQUFFLElBQUksRUFBRSxFQUFFO0FBQUcsZUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLElBQUksRUFBRSxHQUFHO0FBQUcsZUFBSyxNQUFNLGlCQUFpQixFQUFFLElBQUksU0FBUyxVQUFVLEVBQUUsSUFBSSxDQUFDLEdBQUc7QUFBQSxRQUFHLE1BQU8sTUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLEdBQUc7QUFBQSxNQUM1TSxNQUFPLE1BQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxJQUFJLFNBQVMsVUFBVSxLQUFLLElBQUksT0FBTyxLQUFLLE9BQU8sRUFBRSxNQUFNLFFBQVEsR0FBRztBQUN6RyxXQUFLLGdCQUFnQjtBQUFPLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDL0Q7QUFBQSxJQUNBLGdCQUFnQjtBQUNkLFlBQU0sSUFBSSxLQUFLLEdBQUcsTUFBTSxLQUFLO0FBQUssVUFBSSxDQUFDLE9BQU8sSUFBSSxTQUFTLE9BQVE7QUFDbkUsWUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sSUFBSSxFQUFFO0FBQUcsWUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLGlCQUFpQixHQUFHLENBQUMsQ0FBQztBQUN6RyxVQUFJLEtBQUssR0FBRztBQUFFLHNCQUFjLEdBQUcsRUFBRSxJQUFJLEVBQUUsRUFBRTtBQUFHLGFBQUssTUFBTSxpQkFBaUIsRUFBRSxJQUFJLFNBQVMsVUFBVSxFQUFFLElBQUksQ0FBQyxHQUFHO0FBQUEsTUFBRyxNQUFPLE1BQUssTUFBTSx1REFBdUQ7QUFDdkwsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUNuQztBQUFBLElBQ0EsaUJBQWlCO0FBQ2YsWUFBTSxNQUFNLEtBQUs7QUFBSyxVQUFJLENBQUMsT0FBTyxJQUFJLFNBQVMsT0FBUTtBQUN2RCxVQUFJLENBQUMsS0FBSyxlQUFlO0FBQUUsYUFBSyxnQkFBZ0I7QUFBTSxhQUFLLE1BQU0sK0RBQStEO0FBQUcsYUFBSyxHQUFHLE9BQU87QUFBRztBQUFBLE1BQVE7QUFDN0osY0FBUSxLQUFLLEdBQUcsSUFBSSxFQUFFO0FBQUcsV0FBSyxNQUFNO0FBQU0sV0FBSyxnQkFBZ0I7QUFBTyxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFBLElBQ3pHO0FBQUEsSUFDQSxhQUFhO0FBQUUsVUFBSSxLQUFLLFVBQVUsUUFBUztBQUFRLFVBQUksS0FBSyxFQUFFLGFBQWE7QUFBRSxhQUFLLE1BQU0sK0JBQStCO0FBQUc7QUFBQSxNQUFRO0FBQUUsV0FBSyxXQUFXLENBQUMsS0FBSztBQUFVLFdBQUssTUFBTTtBQUFNLFVBQUksS0FBSyxTQUFVLE1BQUssTUFBTSxnRkFBZ0Y7QUFBRyxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFBLElBQUc7QUFBQTtBQUFBLElBRzFVLGNBQWM7QUFDWixVQUFJLEtBQUssVUFBVSxXQUFXLENBQUMsS0FBSyxFQUFFLE1BQU0sUUFBUTtBQUFFLFlBQUksQ0FBQyxLQUFLLEVBQUUsTUFBTSxPQUFRLE1BQUssTUFBTSxpQ0FBaUM7QUFBRztBQUFBLE1BQVE7QUFDdkksV0FBSyxZQUFZO0FBQUcsWUFBTSxLQUFLLE9BQU87QUFBRyxXQUFLLGdCQUFnQjtBQUFHLFdBQUssU0FBUyxLQUFLO0FBQ3BGLFdBQUssTUFBTTtBQUFNLFdBQUssV0FBVztBQUFPLFdBQUs7QUFBVyxXQUFLLFVBQVU7QUFBTyxXQUFLLFdBQVc7QUFDOUYsWUFBTSxJQUFJLEtBQUssR0FBRyxRQUFRLEVBQUUsTUFBTSxNQUFNO0FBQ3hDLFlBQU0sUUFBUSxTQUFTLEVBQUUsT0FBTyxTQUFpQyxDQUFDO0FBQUcsaUJBQVcsS0FBSyxPQUFPLEtBQUssS0FBSyxFQUFHLFFBQU8sQ0FBQyxJQUFLLE1BQWMsQ0FBQyxFQUFFO0FBQ3ZJLFdBQUssU0FBUyxJQUFJLE9BQU8sTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxVQUFVLEVBQUUsTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLE9BQU8sTUFBTSxFQUFFLE9BQU8sS0FBSyxLQUFLLFNBQVMsUUFBUSxXQUFXLEVBQUUsSUFBSSxDQUFDO0FBQ2pNLFdBQUssS0FBSyxNQUFNO0FBQUcsV0FBSyxNQUFNLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1RCxXQUFLLE9BQU8sU0FBUyxRQUFRLENBQUMsTUFBTTtBQUNsQyxZQUFJLEVBQUUsU0FBUyxHQUFHO0FBQUUsZ0JBQU0sSUFBSSxNQUFNLEVBQUUsS0FBSyxDQUFDO0FBQUcsZ0JBQU0sSUFBSSxLQUFLLFFBQVEsSUFBSSxFQUFFLEVBQUU7QUFBSSxlQUFLLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQztBQUFHLGVBQUssTUFBTSxJQUFJLEVBQUUsSUFBSSxFQUFFLEVBQUU7QUFBRyxZQUFFLE1BQU0sQ0FBQztBQUFHLFlBQUUsUUFBUSxFQUFFLFVBQVUsSUFBSSxJQUFJO0FBQUEsUUFBRyxPQUM5SztBQUFFLGdCQUFNLElBQUksYUFBYSxLQUFLLEdBQUcsRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLENBQUMsS0FBSyxLQUFLO0FBQUcsY0FBSSxFQUFFLFFBQVEsRUFBRSxRQUFTLEdBQUUsUUFBUSxJQUFJO0FBQUcsWUFBRSxLQUFLLE9BQU87QUFBRyxZQUFFLE1BQU0sQ0FBQztBQUFHLFlBQUUsUUFBUSxFQUFFLFVBQVUsSUFBSSxJQUFJO0FBQUcsZUFBSyxLQUFLLElBQUksRUFBRSxJQUFJLENBQUM7QUFBRyxlQUFLLE1BQU0sS0FBSyxNQUFNO0FBQUUsZ0JBQUksRUFBRSxVQUFVLFFBQVMsR0FBRSxLQUFLLE1BQU07QUFBQSxVQUFHLENBQUM7QUFBRyxlQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsUUFBRztBQUFBLE1BQ2haLENBQUM7QUFDRCxlQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxNQUFLLEtBQUssR0FBRyxRQUFRO0FBQzFELFdBQUssUUFBUTtBQUFjLFdBQUssY0FBYztBQUFLLFdBQUssTUFBTTtBQUFHLFdBQUssU0FBUyxLQUFLLE1BQU0sRUFBRSxRQUFRLEdBQUc7QUFBRyxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFHLFdBQUssV0FBVztBQUM5SixpQkFBVyxLQUFLLEtBQUssT0FBTyxTQUFVLEtBQUksRUFBRSxLQUFNLE1BQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxJQUFJLFVBQVUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQUEsSUFDdkc7QUFBQSxJQUNRLFlBQVksS0FBZTtBQUNqQyxZQUFNLElBQUksS0FBSztBQUNmLGlCQUFXLEtBQUssS0FBSztBQUNuQixZQUFJLEVBQUUsTUFBTSxTQUFTO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEVBQUcsR0FBRSxLQUFLLFVBQVUsRUFBRSxLQUFLO0FBQUcsY0FBSSxLQUFLLE9BQU8sSUFBSSxNQUFNO0FBQUUsa0JBQU0sSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO0FBQUcsZ0JBQUksRUFBRyxPQUFNLEtBQUssRUFBRSxNQUFNLEdBQUcsRUFBRSxTQUFTLElBQUksSUFBSSxJQUFJO0FBQUEsVUFBRztBQUFBLFFBQUUsV0FDNUwsRUFBRSxNQUFNLE9BQU87QUFBRSxnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksR0FBRztBQUFFLGNBQUUsTUFBTTtBQUFHLGtCQUFNLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRSxHQUFHLEtBQUssRUFBRSxLQUFLLEVBQUUsSUFBSTtBQUFHLGdCQUFJLE1BQU0sR0FBSSxNQUFLLElBQUksSUFBSSxFQUFFLElBQUksR0FBRyxHQUFHLEdBQUcsR0FBRyxFQUFFLE1BQU0sRUFBRSxPQUFPLFFBQVEsR0FBRyxFQUFFLEtBQUssR0FBRyxTQUFTLEdBQUcsRUFBRSxTQUFTLFdBQVcsQ0FBQyxDQUFDLEdBQUcsUUFBUSxFQUFFLE9BQU8sR0FBRyxRQUFRLE1BQU0sRUFBRSxJQUFJO0FBQUEsVUFBRztBQUFFLGNBQUksRUFBRSxTQUFTLFFBQVMsT0FBTSxLQUFLLFVBQVU7QUFBQSxtQkFBWSxFQUFFLFNBQVMsUUFBUyxPQUFNLEtBQUssS0FBSztBQUFBLFFBQUcsV0FDelgsRUFBRSxNQUFNLFNBQVM7QUFBRSxnQkFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksR0FBSSxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7QUFBSSxlQUFLLFdBQVcsRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxFQUFFLEdBQUc7QUFBRyxnQkFBTSxLQUFLLE9BQU87QUFBQSxRQUFHLFdBQzdJLEVBQUUsTUFBTSxTQUFTO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEdBQUc7QUFBRSxjQUFFLEtBQUssT0FBTztBQUFHLGNBQUUsTUFBTSxJQUFJO0FBQUcsY0FBRSxRQUFRLElBQUk7QUFBRyxrQkFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUU7QUFBSSxrQkFBTSxLQUFLLE9BQU87QUFBRyxpQkFBSyxJQUFJLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLFNBQVMsR0FBRyxFQUFFLE1BQU0sRUFBRSxPQUFPLFFBQVEsQ0FBQztBQUFHLGdCQUFJLEVBQUUsU0FBUyxFQUFHLE1BQUssTUFBTSxHQUFHLE1BQU07QUFBRSxrQkFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUUsTUFBTSxLQUFLLEtBQUssVUFBVSxTQUFTO0FBQUUsa0JBQUUsT0FBTyxXQUFXLEtBQUs7QUFBQSxjQUFHO0FBQUEsWUFBRSxDQUFDO0FBQUEsVUFBRztBQUFBLFFBQUUsV0FDclcsRUFBRSxNQUFNLFFBQVE7QUFBRSxnQkFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUU7QUFBSSxnQkFBTSxLQUFLLE1BQU07QUFBRyxlQUFLLE9BQU8sRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLFFBQVEsT0FBTyxLQUFLLEtBQUssQ0FBQyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsUUFBRyxXQUN4SSxFQUFFLE1BQU0sU0FBUztBQUFFLGdCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGdCQUFNLEtBQUssT0FBTztBQUFHLGVBQUssT0FBTyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxHQUFHLEdBQUcsS0FBSyxRQUFRLE1BQU0sUUFBUSxHQUFHO0FBQUEsUUFBRyxXQUMxSixFQUFFLE1BQU0sU0FBUztBQUFFLGdCQUFNLEtBQUssT0FBTztBQUFHLGVBQUssSUFBSSxLQUFLLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDO0FBQUcsZUFBSyxPQUFPLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxLQUFLLEdBQUcsR0FBRyxLQUFLLEVBQUUsSUFBSSxLQUFLLElBQUk7QUFBQSxRQUFHO0FBQUEsTUFDL0o7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUdRLGFBQWEsTUFBYztBQUNqQyxVQUFJLEtBQUssVUFBVSxJQUFJLEVBQUcsUUFBTyxLQUFLLFVBQVUsSUFBSTtBQUNwRCxZQUFNLE1BQU0sS0FBSyxFQUFFLE1BQU0sYUFBYSxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFBRyxVQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2xGLFlBQU0sSUFBSSxJQUFJLE1BQU0sV0FBVyxJQUFJO0FBQUcsWUFBTSxJQUFJLFNBQVMsSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksUUFBUSxPQUFPLEtBQUssTUFBTSxJQUFJO0FBQ3JJLFVBQUksbUJBQW1CLEVBQUcsR0FBRSxnQkFBZ0IsRUFBRSxNQUFNLEtBQUs7QUFBRyxXQUFLLFVBQVUsSUFBSSxJQUFJO0FBQUcsYUFBTztBQUFBLElBQy9GO0FBQUEsSUFDUSxXQUFXLE1BQWMsSUFBWSxJQUFZLElBQVksSUFBWSxLQUFhO0FBQzVGLFVBQUksT0FBTyxLQUFLLFVBQVUsSUFBSTtBQUM5QixVQUFJLENBQUMsTUFBTTtBQUNULGNBQU0sU0FBUyxJQUFJLFFBQVEsY0FBYyxNQUFNLEtBQUssS0FBSztBQUFHLGVBQU8sUUFBUSxPQUFPLElBQUk7QUFDdEYsWUFBSSxLQUFLLEVBQUUsT0FBTztBQUNoQixnQkFBTSxNQUFNLEtBQUssRUFBRSxNQUFNLHlCQUF5QixDQUFDLE1BQWMsSUFBSSxNQUFNLEtBQUssT0FBTyxFQUFFLFNBQVMsRUFBRSxFQUFFLE1BQU0sR0FBRyxDQUFDLEdBQUcsS0FBSztBQUN4SCxjQUFJLFVBQVUsQ0FBQyxFQUFFLFNBQVM7QUFBUSxjQUFJLFVBQVUsQ0FBQyxFQUFFLGVBQWUsRUFBRSxRQUFRLENBQUMsTUFBVztBQUFFLGNBQUUsYUFBYTtBQUFPLGNBQUUsMkJBQTJCO0FBQUEsVUFBTSxDQUFDO0FBQUEsUUFDdEosT0FBTztBQUFFLGdCQUFNLE1BQU0sUUFBUSxZQUFZLGVBQWUsU0FBUyxFQUFFLFFBQVEsTUFBTSxVQUFVLE1BQU0sR0FBRyxLQUFLLEtBQUs7QUFBRyxjQUFJLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxjQUFJLGFBQWE7QUFBTyxjQUFJLFNBQVM7QUFBUSxjQUFJLFdBQVcsS0FBSyxVQUFVLElBQUk7QUFBQSxRQUFHO0FBQ2pPLGVBQU87QUFBQSxNQUNUO0FBQ0EsV0FBSyxXQUFXLElBQUk7QUFDcEIsVUFBSSxLQUFLLEVBQUUsT0FBTztBQUFFLGNBQU0sS0FBSyxLQUFLLGFBQWEsSUFBSTtBQUFHLGFBQUssZUFBZSxFQUFFLFFBQVEsQ0FBQyxNQUFXO0FBQUUsY0FBSSxHQUFJLEdBQUUsV0FBVztBQUFBLFFBQUksQ0FBQztBQUFBLE1BQUc7QUFDakksV0FBSyxPQUFPLEtBQUssRUFBRSxNQUFNLElBQUksSUFBSSxJQUFJLElBQUksR0FBRyxHQUFHLEtBQUssS0FBSyxDQUFDO0FBQUEsSUFDNUQ7QUFBQTtBQUFBLElBR1EsYUFBYTtBQUNuQixZQUFNLElBQUksS0FBSztBQUFRLFVBQUksQ0FBQyxFQUFHO0FBQVEsWUFBTSxPQUFPLG9CQUFJLElBQVksR0FBRyxTQUFTLG9CQUFJLElBQVk7QUFDaEcsaUJBQVcsS0FBSyxFQUFFLFNBQVUsRUFBQyxFQUFFLFNBQVMsSUFBSSxPQUFPLFFBQVEsSUFBSSxFQUFFLElBQUk7QUFDckUsT0FBQyxHQUFHLElBQUksRUFBRSxNQUFNLEdBQUcsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxNQUFNLE1BQU0sTUFBTSxLQUFLLE1BQU0sT0FBTyxPQUFPLEdBQUcsQ0FBQyxDQUFDO0FBQUcsWUFBTSxJQUFJLENBQUMsR0FBRyxNQUFNLEVBQUUsQ0FBQztBQUFHLFVBQUksRUFBRyxPQUFNLEtBQUssR0FBRyxNQUFNLElBQUk7QUFBQSxJQUM3STtBQUFBLElBRVEsTUFBTSxJQUFZO0FBQ3hCLFVBQUksS0FBSyxPQUFPLGdCQUFnQixLQUFLLFNBQVMsS0FBSyxPQUFPLGlCQUFpQixLQUFLLE1BQU8sTUFBSyxhQUFhO0FBQ3pHLFdBQUssT0FBTyxTQUFTLGdCQUFnQixLQUFLLElBQUksR0FBRztBQUNqRCxlQUFTLElBQUksS0FBSyxPQUFPLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFFLGFBQUssT0FBTyxDQUFDLEVBQUUsS0FBSztBQUFJLFlBQUksS0FBSyxPQUFPLENBQUMsRUFBRSxLQUFLLEdBQUc7QUFBRSxnQkFBTSxJQUFJLEtBQUssT0FBTyxDQUFDLEVBQUU7QUFBSSxlQUFLLE9BQU8sT0FBTyxHQUFHLENBQUM7QUFBRyxZQUFFO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDdkssZUFBUyxJQUFJLEtBQUssT0FBTyxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBRSxjQUFNLElBQUksS0FBSyxPQUFPLENBQUM7QUFBRyxVQUFFLEtBQUs7QUFBSSxjQUFNLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNO0FBQUcsVUFBRSxFQUFFLFFBQVEsSUFBSSxHQUFHLEdBQUcsQ0FBQztBQUFHLFVBQUUsR0FBRyxRQUFRLE9BQU8sSUFBSTtBQUFJLFlBQUksS0FBSyxHQUFHO0FBQUUsWUFBRSxFQUFFLFFBQVE7QUFBRyxZQUFFLEdBQUcsUUFBUTtBQUFHLGVBQUssT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFBLFFBQUc7QUFBQSxNQUFFO0FBQzdRLFVBQUksS0FBSyxPQUFPLEdBQUc7QUFBRSxhQUFLLE9BQU8sS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLEtBQUssS0FBSyxNQUFNO0FBQUcsY0FBTSxJQUFJLEtBQUssT0FBTyxLQUFLLFFBQVEsSUFBSSxJQUFJLEtBQUs7QUFBTyxhQUFLLE9BQU8sV0FBVyxRQUFRLFFBQVEsS0FBSyxLQUFLLFFBQVEsS0FBSyxLQUFLLE1BQU0sS0FBSyxDQUFDO0FBQUcsYUFBSyxTQUFTLFFBQVEsUUFBUSxLQUFLLEtBQUssUUFBUSxLQUFLLEtBQUssTUFBTSxLQUFLLENBQUM7QUFBRyxhQUFLLE9BQU8sVUFBVSxLQUFLLE9BQU8sTUFBTSxDQUFDO0FBQUEsTUFBRyxXQUNqVSxLQUFLLFVBQVUsWUFBWSxLQUFLLFlBQVksV0FBVyxDQUFDLEtBQUssS0FBTSxNQUFLLFlBQVksRUFBRTtBQUMvRixXQUFLLE1BQU0sT0FBTyxFQUFFO0FBQ3BCLGVBQVMsSUFBSSxLQUFLLE9BQU8sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUUsY0FBTSxJQUFJLEtBQUssT0FBTyxDQUFDO0FBQUcsVUFBRSxLQUFLO0FBQUksY0FBTSxJQUFJLEtBQUssSUFBSSxHQUFHLEVBQUUsSUFBSSxFQUFFLEdBQUc7QUFBRyxVQUFFLEdBQUcsQ0FBQztBQUFHLFlBQUksS0FBSyxHQUFHO0FBQUUsZUFBSyxPQUFPLE9BQU8sR0FBRyxDQUFDO0FBQUcsY0FBSSxFQUFFLEtBQU0sR0FBRSxLQUFLO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDdE0saUJBQVcsS0FBSyxLQUFLLFFBQVEsT0FBTyxFQUFHLEdBQUUsT0FBTyxFQUFFO0FBQ2xELFdBQUssS0FBSyxRQUFRLENBQUMsR0FBRyxPQUFPO0FBQUUsWUFBSSxDQUFDLEtBQUssTUFBTSxJQUFJLEVBQUUsRUFBRyxHQUFFLE9BQU8sRUFBRTtBQUFBLE1BQUcsQ0FBQztBQUV2RSxZQUFNLElBQUksS0FBSztBQUNmLFdBQUssS0FBSyxVQUFVLGdCQUFnQixLQUFLLFVBQVUsYUFBYSxHQUFHO0FBQ2pFLFlBQUksS0FBSyxVQUFVLGNBQWM7QUFBRSxlQUFLLGVBQWU7QUFBSSxjQUFJLEtBQUssZUFBZSxHQUFHO0FBQUUsaUJBQUssUUFBUTtBQUFVLGlCQUFLLEdBQUcsT0FBTztBQUFBLFVBQUc7QUFBQSxRQUFFO0FBQ25JLFlBQUksS0FBSyxVQUFVLFVBQVU7QUFDM0IsZUFBSyxPQUFPLEtBQUssS0FBSztBQUN0QixpQkFBTyxLQUFLLE9BQU8sSUFBSSxNQUFNLEVBQUUsU0FBUyxHQUFHO0FBQUUsY0FBRSxLQUFLLElBQUksRUFBRTtBQUFHLGlCQUFLLE9BQU8sSUFBSTtBQUFJLGlCQUFLLFlBQVksRUFBRSxNQUFNLENBQUM7QUFBQSxVQUFHO0FBQUEsUUFDaEg7QUFDQSxtQkFBVyxLQUFLLEVBQUUsVUFBVTtBQUMxQixnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksQ0FBQyxFQUFHO0FBQ3ZDLGNBQUksQ0FBQyxLQUFLLFNBQVMsS0FBSyxVQUFVLFlBQVksRUFBRSxTQUFTLElBQUk7QUFBRSxjQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBRyxjQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBRyxnQkFBSSxFQUFFLFNBQVMsS0FBTSxHQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBQSxVQUFLO0FBQ3ZLLGNBQUksRUFBRSxPQUFPO0FBQUUsY0FBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUs7QUFBRyxnQkFBSSxFQUFFLFFBQVMsR0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU87QUFBQSxVQUFHLE1BQ2pGLEdBQUUsUUFBUSxJQUFJO0FBQ25CLGNBQUksRUFBRSxVQUFVLFlBQVksRUFBRSxTQUFTLEVBQUUsVUFBVSxTQUFTO0FBQUUsa0JBQU0sT0FBTyxFQUFFLFVBQVUsUUFBUSxRQUFRO0FBQVEsZ0JBQUksS0FBSyxVQUFVLElBQUksRUFBRSxFQUFFLE1BQU0sUUFBUyxFQUFFLFVBQVUsUUFBUSxFQUFFLFVBQVUsU0FBVTtBQUFFLGtCQUFJLEVBQUUsVUFBVSxTQUFTO0FBQUUsa0JBQUUsS0FBSyxJQUFXO0FBQUcscUJBQUssVUFBVSxJQUFJLEVBQUUsSUFBSSxJQUFJO0FBQUEsY0FBRztBQUFBLFlBQUU7QUFBQSxVQUFFO0FBQ3pSLGNBQUksRUFBRSxVQUFVLFNBQVUsTUFBSyxVQUFVLElBQUksRUFBRSxJQUFJLFFBQVE7QUFBQSxRQUM3RDtBQUNBLFlBQUksRUFBRSxVQUFVLEtBQUssQ0FBQyxLQUFLLFNBQVM7QUFBRSxlQUFLLFVBQVU7QUFBTSxlQUFLLFdBQVc7QUFBQSxRQUFLO0FBQ2hGLFlBQUksS0FBSyxXQUFXLEdBQUc7QUFBRSxlQUFLLFlBQVk7QUFBSSxjQUFJLEtBQUssWUFBWSxFQUFHLE1BQUssYUFBYTtBQUFBLFFBQUc7QUFBQSxNQUM3RjtBQUNBLGVBQVMsSUFBSSxLQUFLLE9BQU8sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQ2hELGNBQU0sSUFBSSxLQUFLLE9BQU8sQ0FBQztBQUFHLFVBQUUsS0FBSyxLQUFLLEtBQUs7QUFBVyxjQUFNLElBQUksS0FBSyxJQUFJLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRztBQUN2RixjQUFNLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sR0FBRyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEdBQUcsS0FBSyxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLE1BQU0sSUFBSTtBQUNsSCxjQUFNLEtBQUssS0FBSyxJQUFJLEdBQUcsSUFBSSxJQUFJLEdBQUcsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sSUFBSSxLQUFLLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxFQUFFLElBQUksTUFBTSxLQUFLO0FBQ2xKLFVBQUUsS0FBSyxTQUFTLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBRyxVQUFFLEtBQUssT0FBTyxJQUFJLFFBQVEsUUFBUSxJQUFJLElBQUksRUFBRSxDQUFDO0FBQzlFLGFBQUssSUFBSSxNQUFNLElBQUksSUFBSSxJQUFJLEVBQUUsU0FBUyxDQUFDO0FBQ3ZDLFlBQUksS0FBSyxHQUFHO0FBQUUsWUFBRSxLQUFLLFdBQVcsS0FBSztBQUFHLGVBQUssVUFBVSxLQUFLLEVBQUUsSUFBSTtBQUFHLGVBQUssT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFBLFFBQUc7QUFBQSxNQUNqRztBQUNBLFdBQUssSUFBSSxPQUFPLEVBQUU7QUFBRyxXQUFLLE9BQU8sU0FBUyxXQUFXLEtBQUssSUFBSSxHQUFHO0FBQUEsSUFDbkU7QUFBQSxJQUVRLGVBQWU7QUFDckIsWUFBTSxJQUFJLEtBQUssUUFBUyxJQUFJLEtBQUs7QUFDakMsV0FBSyxjQUFjO0FBQ25CLFdBQUssYUFBYSxRQUFRLEVBQUUsSUFBSSxZQUFZLEtBQUssT0FBTyxLQUFLLEVBQUUsV0FBVyxJQUFJLFFBQVEsTUFBTSxPQUFPLEVBQUUsS0FBSyxRQUFRLENBQUMsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUMsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDL0osVUFBSSxFQUFFLFdBQVcsR0FBRztBQUNsQixhQUFLLFdBQVcsT0FBTyxNQUFNO0FBQzNCLGVBQUssT0FBTztBQUNaLGNBQUk7QUFBRSxpQkFBSyxXQUFXLEtBQUssUUFBUSxJQUFJLGVBQWUsVUFBVSxJQUFJLGdCQUFnQixFQUFFLElBQUksSUFBSSxTQUFTLGdCQUFnQixjQUFxQixDQUFDO0FBQUcsaUJBQUssV0FBVyxLQUFLO0FBQVUsbUJBQU8sY0FBYyxJQUFJLE1BQU0sb0JBQW9CLENBQUM7QUFBQSxVQUFHLFFBQVE7QUFBRSxpQkFBSyxXQUFXO0FBQUEsVUFBRztBQUNuUSxjQUFJLFVBQVUsS0FBSyxLQUFLLFNBQVM7QUFDL0IsZ0JBQUk7QUFDRixvQkFBTSxJQUFJLHlCQUF5QixFQUFFLElBQUk7QUFBRyxtQkFBSyxRQUFRLFVBQVUsRUFBRTtBQUFNLHFCQUFPLGNBQWMsSUFBSSxNQUFNLG9CQUFvQixDQUFDO0FBQy9ILGtCQUFJLEVBQUUsTUFBTTtBQUFFLHFCQUFLLFFBQVE7QUFBUyxxQkFBSyxNQUFNLFVBQVUsRUFBRSxPQUFPLGtEQUFrRDtBQUFBLGNBQUc7QUFBQSxZQUN6SCxRQUFRO0FBQUEsWUFBc0M7QUFBQSxVQUNoRDtBQUNBLGNBQUksWUFBWSxDQUFDLEdBQUc7QUFDbEIsaUJBQUssUUFBUTtBQUFPLHFCQUFTO0FBQzdCLGdCQUFJO0FBQ0Ysa0JBQUksS0FBSyxPQUFPO0FBQUUscUJBQUssY0FBYyxzQkFBc0IsS0FBSyxNQUFNLEdBQUc7QUFBRyxxQkFBSyxTQUFTO0FBQUEsY0FBTSxNQUFPLE1BQUssU0FBUyxtQkFBbUIsZ0JBQWdCLGNBQXFCO0FBQzdLLHFCQUFPLGNBQWMsSUFBSSxNQUFNLG9CQUFvQixDQUFDO0FBQUEsWUFDdEQsUUFBUTtBQUFFLG1CQUFLLFNBQVM7QUFBQSxZQUFNO0FBQzlCLGlCQUFLLEdBQUcsT0FBTztBQUFHO0FBQUEsVUFDcEI7QUFDQSxlQUFLLFFBQVEsYUFBYSxDQUFDO0FBQUcsZUFBSyxRQUFRO0FBQVMsZUFBSyxXQUFXO0FBQUcsZUFBSyxHQUFHLE9BQU87QUFBQSxRQUN4RixDQUFDO0FBQUEsTUFDSCxPQUFPO0FBQ0wsaUJBQVMsQ0FBQztBQUFHLGFBQUssR0FBRyxPQUFPO0FBQUcsYUFBSyxHQUFHLFlBQVk7QUFDbkQsWUFBSSxFQUFFLFdBQVcsT0FBUSxNQUFLLFdBQVcsU0FBUyxNQUFNO0FBQUUsZUFBSyxPQUFPO0FBQU8sZUFBSyxRQUFRO0FBQVEsbUJBQVM7QUFBRyxlQUFLLEdBQUcsT0FBTztBQUFBLFFBQUcsQ0FBQztBQUFBLFlBQzVILE1BQUssV0FBVyxRQUFRLE1BQU07QUFBRSxlQUFLLE1BQU0sNkVBQTZFO0FBQUcsZUFBSyxRQUFRO0FBQUEsUUFBRyxDQUFDO0FBQUEsTUFDbko7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUdRLFdBQVcsTUFBZ0MsTUFBa0I7QUFDbkUsWUFBTSxJQUFJLEtBQUssUUFBUyxJQUFJLEtBQUs7QUFBTyxXQUFLLE9BQU87QUFBTSxVQUFJLFNBQVMsTUFBTyxNQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsT0FBTyxHQUFHO0FBQ25ILFlBQU0sT0FBTyxNQUFNO0FBQ2pCLFVBQUUsS0FBSztBQUFHLGNBQU0sS0FBSyxXQUFXO0FBQUcsY0FBTSxJQUFJLEVBQUUsV0FBVztBQUFHLGFBQUssTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLEVBQUU7QUFDN0gsbUJBQVcsS0FBSyxFQUFFLFVBQVU7QUFDMUIsY0FBSSxFQUFFLFNBQVMsRUFBRztBQUFVLGdCQUFNLE1BQU0sS0FBSyxNQUFNLElBQUksRUFBRSxFQUFFLEdBQUcsSUFBSSxLQUFLLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sR0FBRyxHQUFHLElBQUksS0FBSyxLQUFLLElBQUksRUFBRSxFQUFFO0FBQUcsY0FBSSxDQUFDLEtBQUssQ0FBQyxFQUFHO0FBQ2pKLGdCQUFNLEtBQUssS0FBSyxJQUFJLEVBQUUsSUFBSSxHQUFHLEtBQUssRUFBRSxPQUFPLFNBQVMsR0FBRyxLQUFLLEVBQUUsT0FBTyxTQUFTO0FBQUcsWUFBRSxNQUFNLElBQUk7QUFBRyxZQUFFLFFBQVEsSUFBSTtBQUM5RyxjQUFJLENBQUMsRUFBRSxPQUFPO0FBQUUsY0FBRSxLQUFLLE9BQU87QUFBRyxpQkFBSyxJQUFJLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRyxpQkFBSyxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUcsaUJBQUssT0FBTyxJQUFJLElBQUksSUFBSSxRQUFRLE9BQU8sS0FBSyxNQUFNLENBQUMsR0FBRyxLQUFLLEtBQUssR0FBRztBQUFBLFVBQUc7QUFDdk0sZUFBSztBQUFBLFlBQU07QUFBQSxZQUFLLENBQUMsTUFBTTtBQUFFLGdCQUFFLE9BQU8sU0FBUyxJQUFJLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRyxLQUFLLElBQUksSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQztBQUFHLGdCQUFFLE9BQU8sU0FBUyxNQUFNLEtBQUssS0FBSyxJQUFJLEVBQUUsT0FBTyxTQUFTLEtBQUssS0FBSyxJQUFJLEdBQUcsSUFBSSxNQUFNLEdBQUc7QUFBQSxZQUFHO0FBQUEsWUFDaE4sTUFBTTtBQUFFLGdCQUFFLE9BQU8sU0FBUyxJQUFJO0FBQUcsbUJBQUssTUFBTSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxZQUFHO0FBQUEsVUFBQztBQUFBLFFBQzlHO0FBQUEsTUFDRjtBQUNBLFVBQUksU0FBUyxPQUFPO0FBRWxCLGNBQU0sS0FBSyxTQUFTO0FBQ3BCLG1CQUFXLEtBQUssRUFBRSxTQUFVLEtBQUksRUFBRSxTQUFTLEtBQUssRUFBRSxPQUFPO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEVBQUcsTUFBSyxNQUFNLEtBQUssT0FBTyxJQUFJLE1BQU0sTUFBTTtBQUFFLGNBQUUsS0FBSyxPQUFPO0FBQUcsa0JBQU0sS0FBSyxFQUFFLElBQUk7QUFBQSxVQUFHLENBQUM7QUFBQSxRQUFHO0FBQ25MLGFBQUssTUFBTSxLQUFLLE1BQU07QUFBRSxlQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsT0FBTyxHQUFHO0FBQUcsWUFBRSxLQUFLO0FBQUcsZ0JBQU0sSUFBSSxFQUFFLFdBQVc7QUFBRyxlQUFLLElBQUksS0FBSyxFQUFFLEdBQUcsRUFBRSxHQUFHLEtBQUssQ0FBQyxLQUFLLEtBQUssQ0FBQyxHQUFHLEtBQUssQ0FBQztBQUFHLGVBQUssSUFBSSxPQUFPLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxNQUFNLE1BQU0sQ0FBQyxHQUFHLEdBQUcsS0FBSyxHQUFHO0FBQUEsUUFBRyxDQUFDO0FBQ25OLGFBQUssTUFBTSxNQUFNLElBQUk7QUFBRyxhQUFLLE1BQU0sS0FBSyxJQUFJO0FBQUc7QUFBQSxNQUNqRDtBQUNBLFFBQUUsS0FBSztBQUFHLFlBQU0sS0FBSyxXQUFXO0FBQUcsV0FBSyxNQUFNLE1BQU0sTUFBTTtBQUFFLGNBQU0sSUFBSSxFQUFFLFdBQVc7QUFBRyxhQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEdBQUcsS0FBSyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsTUFBRyxDQUFDO0FBQzNKLFVBQUksU0FBUyxTQUFTO0FBQUUsYUFBSyxNQUFNLEtBQUssTUFBTTtBQUFFLFlBQUUsT0FBTztBQUFHLGdCQUFNLEtBQUssUUFBUTtBQUFBLFFBQUcsQ0FBQztBQUFHLGFBQUssTUFBTSxLQUFLLElBQUk7QUFBRztBQUFBLE1BQVE7QUFDckgsV0FBSyxNQUFNLEdBQUssTUFBTTtBQUNwQixVQUFFLEtBQUs7QUFBRyxjQUFNLEtBQUssV0FBVztBQUFHLGNBQU0sSUFBSSxFQUFFLFdBQVc7QUFDMUQsYUFBSyxPQUFPLEVBQUUsR0FBRyxHQUFHLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUc7QUFBRyxhQUFLLE9BQU8sRUFBRSxHQUFHLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxHQUFHLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRztBQUFHLGFBQUssSUFBSSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtBQUNqSyxhQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEdBQUcsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQzlELG1CQUFXLEtBQUssRUFBRSxVQUFVO0FBQzFCLGNBQUksRUFBRSxTQUFTLEtBQUssQ0FBQyxFQUFFLE1BQU87QUFBVSxnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksQ0FBQyxFQUFHO0FBQy9FLGdCQUFNLEtBQUssUUFBUSxHQUFHLEVBQUUsSUFBSSxHQUFHLEtBQUssRUFBRSxPQUFPLFNBQVMsR0FBRyxLQUFLLEVBQUUsT0FBTyxTQUFTO0FBQUcsWUFBRSxNQUFNO0FBQzNGLGVBQUssTUFBTSxLQUFLLENBQUMsTUFBTTtBQUFFLGNBQUUsT0FBTyxTQUFTLElBQUksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDO0FBQUcsY0FBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLFNBQVMsSUFBSSxFQUFFLEtBQUssRUFBRSxTQUFTLENBQUM7QUFBQSxVQUFHLEdBQUcsTUFBTTtBQUFFLGNBQUUsT0FBTyxTQUFTLElBQUk7QUFBRyxjQUFFLE1BQU0sQ0FBQztBQUFBLFVBQUcsQ0FBQztBQUFBLFFBQ2hPO0FBQUEsTUFDRixDQUFDO0FBQ0QsV0FBSyxNQUFNLEtBQUssSUFBSTtBQUFHLFdBQUssTUFBTSxLQUFLLElBQUk7QUFBQSxJQUM3QztBQUFBLElBQ0EsVUFBVSxLQUFhO0FBQUUsVUFBSSxDQUFDLEtBQUssTUFBTztBQUFRLGdCQUFVLEtBQUssR0FBRyxLQUFLLE9BQU8sR0FBRztBQUFHLFdBQUssUUFBUTtBQUFNLGlCQUFXLEtBQUssQ0FBQztBQUFHLFdBQUssUUFBUTtBQUFBLElBQUc7QUFBQSxJQUNySSxVQUFVO0FBQ2hCLFdBQUssT0FBTztBQUFPLFdBQUssTUFBTSxPQUFPO0FBQUcsV0FBSyxZQUFZO0FBQ3pELFdBQUssWUFBWTtBQUFHLFdBQUssU0FBUyxJQUFJO0FBQ3RDLGlCQUFXLEtBQUssS0FBSyxFQUFFLE9BQU87QUFDNUIsY0FBTSxJQUFJLEtBQUssUUFBUSxJQUFJLEVBQUUsRUFBRTtBQUFJLGNBQU0sSUFBSSxLQUFLLElBQUksRUFBRSxJQUFJO0FBQUcsVUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxVQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFHLFVBQUUsT0FBTyxXQUFXLElBQUk7QUFBRyxVQUFFLE1BQU0sSUFBSTtBQUFHLFVBQUUsUUFBUSxJQUFJO0FBQUcsVUFBRSxLQUFLLE9BQU87QUFBRyxhQUFLLFNBQVMsRUFBRSxHQUFHLEVBQUUsQ0FBQztBQUN4TyxhQUFLLE1BQU0sS0FBSyxNQUFNLEVBQUUsS0FBSyxNQUFNLENBQUM7QUFBQSxNQUN0QztBQUNBLFdBQUssUUFBUTtBQUFTLFdBQUssTUFBTTtBQUFNLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQ3hFLFdBQUssU0FBUyxLQUFLLE1BQU0sRUFBRSxPQUFPLEdBQUc7QUFBQSxJQUN2QztBQUFBO0FBQUEsSUFFQSxnQkFBeUI7QUFBRSxZQUFNLElBQUksSUFBSSxnQkFBZ0IsU0FBUyxNQUFNO0FBQUcsYUFBTyxDQUFDLEVBQUUsRUFBRSxJQUFJLE9BQU8sS0FBSyxFQUFFLElBQUksT0FBTyxNQUFNLGdCQUFnQixTQUFTLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDdkosU0FBUyxHQUFXO0FBQ2xCLFVBQUksSUFBSSxLQUFLLENBQUMsS0FBSyxjQUFjLEVBQUc7QUFDcEMsV0FBSyxZQUFZO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUNyQztBQUFBO0FBQUEsSUFHQSxxQkFBcUI7QUFBRSxXQUFLLFFBQVEsUUFBUSxDQUFDLEdBQUcsT0FBTztBQUFFLGNBQU0sSUFBSSxLQUFLLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRTtBQUFHLFlBQUksRUFBRyxHQUFFLFFBQVEsRUFBRSxJQUFJO0FBQUEsTUFBRyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQ3hJLFNBQVMsSUFBSSxLQUFLO0FBQ2hCLFlBQU0sUUFBUSxLQUFLLEVBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxVQUFVLFVBQVUsS0FBSyxFQUFFLE1BQU0sS0FBSyxJQUFJO0FBQUcsVUFBSSxNQUFNLEdBQUcsSUFBSTtBQUNySixZQUFNLEtBQTZCLENBQUMsR0FBRyxLQUFLLFNBQVMsRUFBRTtBQUFPLGlCQUFXLEtBQUssT0FBTyxLQUFLLEVBQUUsRUFBRyxJQUFHLENBQUMsSUFBSyxHQUFXLENBQUMsRUFBRTtBQUN0SCxlQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsS0FBSztBQUFFLGNBQU0sSUFBSSxTQUFTLE9BQU8sU0FBUyxNQUFPLEdBQUcsS0FBSyxJQUFJLFdBQVcsQ0FBQztBQUFHLFlBQUksRUFBRSxXQUFXLEVBQUc7QUFBTyxhQUFLLEVBQUU7QUFBQSxNQUFNO0FBQzNJLGFBQU8sRUFBRSxLQUFLLEtBQUssTUFBTyxNQUFNLElBQUssR0FBRyxHQUFHLFNBQVMsRUFBRSxJQUFJLEdBQUcsUUFBUSxDQUFDLEdBQUcsRUFBRTtBQUFBLElBQzdFO0FBQUEsSUFDQSxRQUFRLE1BQWM7QUFBRSxXQUFLLEVBQUUsS0FBSyxLQUFLLElBQUk7QUFBRyxXQUFLLEVBQUUsTUFBTTtBQUFTLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFBRztBQUFBLElBQ3hGLFlBQVksR0FBVztBQUFFLFdBQUssRUFBRSxPQUFPO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUFHO0FBQUEsSUFDNUQsU0FBaUI7QUFDZixZQUFNLElBQUksS0FBSyxHQUFHLEtBQUssVUFBVSxFQUFFLE1BQU0sS0FBSyxJQUFJO0FBQ2xELGFBQU87QUFBQSxRQUFDLFNBQVMsY0FBYyxJQUFJLGNBQWMsVUFBVSxLQUFLLElBQUksVUFBVSxFQUFFLElBQUksSUFBSSxXQUFXLENBQUMsQ0FBQyxZQUFZLEVBQUUsTUFBTSxjQUFjLGFBQWEsQ0FBQyxDQUFDLElBQUksRUFBRSxHQUFHLFdBQVcsS0FBSyxLQUFLLGFBQWEsS0FBSyxPQUFPO0FBQUEsUUFDM00sU0FBUyxFQUFFLEtBQUssS0FBSyxJQUFJLEtBQUssU0FBUztBQUFBLFFBQUksU0FBUyxFQUFFLE1BQU0sSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLElBQUksR0FBRyxFQUFFLElBQUksSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFLEtBQUssR0FBRyxLQUFLLFFBQVE7QUFBQSxRQUFJLFVBQVUsR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFBQSxRQUNsTCxlQUFlLGNBQWMsc0JBQXNCLEVBQUUsTUFBTSxVQUFVLGlCQUFpQixnQkFBZ0IsRUFBRSxXQUFXO0FBQUEsUUFBSSxhQUFhLEtBQUssV0FBVztBQUFBLFFBQUksV0FBVyxLQUFLLE9BQU8sV0FBVyxJQUFJLEtBQUssT0FBTyxZQUFZLFFBQVEsT0FBTyxnQkFBZ0I7QUFBQSxRQUFJLGdCQUFnQixLQUFLLGNBQWMsR0FBRztBQUFBLFFBQUk7QUFBQSxRQUFhLEdBQUcsRUFBRSxJQUFJLE1BQU0sRUFBRTtBQUFBLFFBQUcsWUFBWSxLQUFLLFVBQVUsRUFBRSxNQUFNLFFBQVEsTUFBTSxPQUFPLFFBQVEsTUFBTSxDQUFDLENBQUM7QUFBQSxNQUFFLEVBQUUsS0FBSyxJQUFJO0FBQUEsSUFDN1o7QUFBQSxJQUNBLGtCQUFrQjtBQUFFLG1CQUFhO0FBQUcsV0FBSyxtQkFBbUI7QUFBQSxJQUFHO0FBQUEsSUFDL0QsSUFBSSxhQUFhO0FBQUUsYUFBTztBQUFBLElBQWdCO0FBQUEsSUFDMUMsaUJBQWlCLE1BQWM7QUFBRSxvQkFBYyxJQUFJO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBRyxXQUFLLE1BQU0sZUFBZSxJQUFJLCtCQUErQjtBQUFBLElBQUc7QUFBQTtBQUFBLElBR3hJLFVBQVU7QUFDUixlQUFTLEtBQUssVUFBVSxJQUFJLFNBQVM7QUFBRyxXQUFLLE1BQU0sV0FBVyxLQUFLO0FBQUcsWUFBTSxNQUFvQixDQUFDO0FBQUcsVUFBSSxPQUFjO0FBQ3RILFlBQU0sVUFBVSxNQUFNO0FBQUUsWUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUFHLFlBQUksU0FBUztBQUFHLGNBQU0sUUFBUSxDQUFDLE1BQU0sTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLElBQUksTUFBTTtBQUFFLGdCQUFNLElBQUksYUFBYSxLQUFLLEdBQUcsTUFBTSxNQUFNLEVBQUU7QUFBRyxZQUFFLE9BQU8sU0FBUyxLQUFLLElBQUksT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLElBQUk7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFNLFlBQUUsS0FBSyxNQUFNO0FBQUcsY0FBSSxLQUFLLENBQUM7QUFBQSxRQUFHLENBQUMsQ0FBQztBQUFBLE1BQUc7QUFDdFQsY0FBUTtBQUFHLFdBQUssT0FBTyxTQUFTLElBQUksR0FBRyxLQUFLLEtBQUs7QUFBRyxXQUFLLE9BQU8sVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssSUFBSSxDQUFDO0FBQUcsV0FBSyxPQUFPLE1BQU07QUFDaEksTUFBQyxPQUFlLFlBQVksRUFBRSxTQUFTLENBQUMsTUFBYTtBQUFFLGVBQU87QUFBRyxnQkFBUTtBQUFBLE1BQUcsR0FBRyxJQUFJO0FBQ25GLFVBQUksT0FBTyxZQUFZLElBQUk7QUFBRyxXQUFLLE9BQU8sY0FBYyxNQUFNO0FBQUUsY0FBTSxJQUFJLFlBQVksSUFBSSxHQUFHLEtBQUssS0FBSyxJQUFJLE9BQU8sSUFBSSxRQUFRLEdBQUk7QUFBRyxlQUFPO0FBQUcsWUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxDQUFDO0FBQUcsYUFBSyxNQUFNLE9BQU87QUFBQSxNQUFHLENBQUM7QUFBQSxJQUN6TTtBQUFBLEVBQ0Y7OztBQ2xvQkEsTUFBTSxJQUFJLElBQUksS0FBSztBQUNuQixFQUFDLE9BQWUsU0FBUztBQUN6QixJQUFFLEtBQUssU0FBUyxlQUFlLEdBQUcsQ0FBc0IsRUFDckQsS0FBSyxNQUFNO0FBQUUsVUFBTSxJQUFJLFNBQVMsZUFBZSxTQUFTO0FBQUcsUUFBSSxFQUFHLEdBQUUsTUFBTSxVQUFVO0FBQVEsSUFBQyxPQUFlLGNBQWM7QUFBTSxXQUFPLGNBQWMsSUFBSSxNQUFNLGtCQUFrQixDQUFDO0FBQUEsRUFBRyxDQUFDLEVBQ3RMLE1BQU0sQ0FBQyxNQUFNO0FBQ1osVUFBTSxJQUFJLFNBQVMsZUFBZSxTQUFTO0FBQUcsUUFBSSxHQUFHO0FBQUUsUUFBRSxNQUFNLFVBQVU7QUFBUSxRQUFFLGNBQWMsYUFBYSxLQUFLLEVBQUUsVUFBVSxFQUFFLFVBQVU7QUFBQSxJQUFJO0FBQy9JLFlBQVEsTUFBTSxDQUFDO0FBQUEsRUFDakIsQ0FBQzsiLAogICJuYW1lcyI6IFsiZyIsICJjb3N0IiwgImVuZW15UG93ZXIiLCAidGciLCAiTUFYX1VOSVRTIiwgImciLCAiZyIsICJkcmF3IiwgImciLCAiZyIsICJLRVkiLCAiVkVSU0lPTiIsICJzdGFnZVdhdmVzIiwgImR5biIsICJkcmF3IiwgImciLCAiZyIsICJ2IiwgInAiXQp9Cg==
