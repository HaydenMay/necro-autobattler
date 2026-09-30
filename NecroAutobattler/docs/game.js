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
      power: { easy: 1, normal: 1.15, hard: 0.95, nightmare: 1.15 },
      rec: { easy: 2, normal: 4, hard: 6, nightmare: 8 }
    },
    {
      id: "bastion",
      name: "The Bone Bastion",
      blurb: "A fortress of the fallen. Only well-levelled armies hold the gate.",
      lists: BASTION,
      power: { easy: 1, normal: 1, hard: 1.25, nightmare: 1.4 },
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
    if (before === 0) return { first: true, pack: grantPack(save, REWARDS.firstClearTier[difficulty] + (stageIndex(stageId) === STAGES.length - 1 ? 1 : 0), "First clear \xB7 " + difficulty), replayMeter: save.replayMeter, replayNeeded: REWARDS.replayClearsPerPack };
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2dhbWUvYXJlbmEudHMiLCAiLi4vY29yZS9lbmRsZXNzLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9iYXR0bGUudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9kYWlseS50cyIsICIuLi9jb3JlL3BhY2tzLnRzIiwgIi4uL2NvcmUvc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvbmVjcm9tYW5jZXIudHMiLCAiLi4vZ2FtZS9hdWRpby50cyIsICIuLi9jb3JlL3J1bnNhdmUudHMiLCAiLi4vZ2FtZS92aXN1YWxzLnRzIiwgIi4uL3VpL2ljb25zLnRzIiwgIi4uL3VpL3BvcnRyYWl0cy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXTsgZ29sZFRvTGV2ZWw6IG51bWJlcltdIH07XG4gIHNpbTogeyBzZXBhcmF0aW9uOiBudW1iZXI7IGhpdEZyYWN0aW9uOiBudW1iZXI7IHRpbWVMaW1pdDogbnVtYmVyOyByZXRhcmdldEV2ZXJ5OiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRTOiBCYWxhbmNlID0ge1xuICBzdGF0czoge1xuICAgIHdhcnJpb3I6ICAgeyBocDogNjAsICBkbWc6IDgsICBpbnRlcnZhbDogMC45LCByYW5nZTogMC44NSwgc3BlZWQ6IDEuNCwgc2l6ZTogMC4yOCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjQ3IH0sXG4gICAgYXJjaGVyOiAgICB7IGhwOiA0MCwgIGRtZzogNywgIGludGVydmFsOiAxLjcsIHJhbmdlOiA1LjAsICBzcGVlZDogMS4xLCBzaXplOiAwLjI2LCBhbmltTGVuOiAxLjUsIGhpdEZyYWM6IDAuNzggfSxcbiAgICBnb2JsaW46ICAgIHsgaHA6IDQ1LCAgZG1nOiA5LCAgaW50ZXJ2YWw6IDAuOCwgcmFuZ2U6IDAuOCwgIHNwZWVkOiAxLjcsIHNpemU6IDAuMjQsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAga25pZ2h0OiAgICB7IGhwOiAxMzAsIGRtZzogOSwgIGludGVydmFsOiAxLjEsIHJhbmdlOiAwLjksICBzcGVlZDogMS4wLCBzaXplOiAwLjMyLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIG9ncmU6ICAgICAgeyBocDogMTcwLCBkbWc6IDE2LCBpbnRlcnZhbDogMS45LCByYW5nZTogMS4wNSwgc3BlZWQ6IDAuOCwgc2l6ZTogMC40MiwgYW5pbUxlbjogMS4yLCBoaXRGcmFjOiAwLjU1IH0sXG4gICAgYmFyYmFyaWFuOiB7IGhwOiAxMTAsIGRtZzogMTIsIGludGVydmFsOiAwLjksIHJhbmdlOiAwLjksIHNwZWVkOiAxLjUsIHNpemU6IDAuMzAsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gIH0sXG4gIC8vIFwiYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHlcIjogSFAgZ3Jvd3MgZmFzdGVyIHRoYW4gZGFtYWdlIHBlciBzdGFyXG4gIHN0YXI6IHsgaHA6IFsxLCAyLjAsIDMuMl0sIGRtZzogWzEsIDEuNSwgMi4wXSwgc2NhbGU6IFsxLCAxLjEyLCAxLjI1XSB9LFxuICBwaGFsYW54OiB7IHJhZGl1czogMi4wLCBwZXJBbGx5OiAwLjA4LCBtYXhTdGFja3M6IDMgfSxcbiAgLy8gbWFuYSBmaWxscyBmYXN0OiBhIGJhc2ljIGF0dGFjayBnaXZlcyBwZXJBdHRhY2ssIHRha2luZyBhIGhpdCBnaXZlcyBwZXJIaXQ7IGEgZnVsbCBiYXIgZmlyZXMgdGhlIHNraWxsIG9uIHRoZSBuZXh0IGF0dGFjaywgdGhlbiByZXNldHNcbiAgbWFuYToge1xuICAgIGFyY2hlcjogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTcGxpdCBBcnJvdyBhYm91dCBldmVyeSAzcmQgc2hvdFxuICAgIG9ncmU6ICAgeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTbWFzaCBhYm91dCBldmVyeSAzcmQgc3dpbmdcbiAgICBrbmlnaHQ6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMjUsIHBlckhpdDogMTIgfSwgICAgLy8gVGF1bnQgZXZlcnkgfjQgc3dpbmdzLCBzb29uZXIgd2hlbiBoZSBpcyBiZWluZyBoaXRcbiAgfSxcbiAgdm9sbGV5OiB7IHRhcmdldHM6IDMsIHByb2plY3RpbGVTcGVlZDogMTQgfSxcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IDAuNSwgc2Vla1JhZGl1czogNC4wLCB3b3VuZGVkV2VpZ2h0OiAxLjUgfSxcbiAgdGF1bnQ6IHsgZHVyYXRpb246IDMsIHJhZGl1czogNC41IH0sXG4gIHNtYXNoOiB7IG11bHQ6IDIuMCwgcmFkaXVzOiAxLjYgfSxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiAwLjE0LCBtYXhTdGFja3M6IDgsIHJlc2V0QWZ0ZXI6IDAuNiB9LFxuICBsZXZlbDogeyBocDogMC4wOCwgZG1nOiAwLjA4LCBjb3BpZXNUb0xldmVsOiBbNSwgMTAsIDIwLCA0MCwgODAsIDEyMCwgMjAwLCAzMDAsIDUwMF0sIGdvbGRUb0xldmVsOiBbNjAwMCwgMTIwMDAsIDI0MDAwLCA0ODAwMCwgOTYwMDAsIDE2ODAwMCwgMjcwMDAwLCA0MjAwMDAsIDY2MDAwMF0gfSxcbiAgc2ltOiB7IHNlcGFyYXRpb246IDAuNiwgaGl0RnJhY3Rpb246IDAuNDcsIHRpbWVMaW1pdDogMTIwLCByZXRhcmdldEV2ZXJ5OiAwLjUgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBCQUxBTkNFOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRCYWxhbmNlKCk6IHZvaWQge1xuICBjb25zdCBmcmVzaDogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGZyZXNoKSBhcyAoa2V5b2YgQmFsYW5jZSlbXSkgKEJBTEFOQ0UgYXMgYW55KVtrXSA9IChmcmVzaCBhcyBhbnkpW2tdO1xufVxuXG5leHBvcnQgY29uc3QgUk9MRV9URVhUOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnQ2hlYXAgYW5kIGZhc3QuIFRvdWdoZXIgbmVhciBvdGhlciBXYXJyaW9ycy4nLFxuICBhcmNoZXI6ICdGcmFnaWxlLiBTa2lsbDogU3BsaXQgQXJyb3cgaGl0cyAzIGRpZmZlcmVudCBlbmVtaWVzLicsXG4gIGdvYmxpbjogJ0Zhc3QuIEhpdHMgaGFyZGVyIG9uIGVuZW1pZXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLicsXG4gIGtuaWdodDogJ1RhbmsuIFNraWxsOiBUYXVudCBwdWxscyBlbmVtaWVzIG9udG8gaGltLicsXG4gIG9ncmU6ICdTbG93LCBodWdlIGRhbWFnZS4gU2tpbGw6IFNtYXNoLCBhIGJpZyBhcmVhIHNsYW0uJyxcbiAgYmFyYmFyaWFuOiAnU3dpbmdzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgaGl0LicsXG59O1xuXG5leHBvcnQgY29uc3QgU09VTF9OQU1FOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnU2tlbGV0b24gV2FycmlvcicsIGFyY2hlcjogJ1NrZWxldG9uIEFyY2hlcicsIGdvYmxpbjogJ0dvYmxpbicsXG4gIGtuaWdodDogJ0tuaWdodCcsIG9ncmU6ICdPZ3JlJywgYmFyYmFyaWFuOiAnQmFyYmFyaWFuJyxcbn07XG5cbi8qKiBBYmlsaXR5IGJsdXJicyBmb3IgdGhlIFNvdWxzIHBhZ2UsIHdpdGggdGhlIGxpdmUgbnVtYmVycyBmaWxsZWQgaW4uICovXG5leHBvcnQgZnVuY3Rpb24gYWJpbGl0eUluZm8oc291bDogU291bElkKTogeyBraW5kOiAnc2tpbGwnIHwgJ3Bhc3NpdmUnOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZyB9IHtcbiAgY29uc3QgQiA9IEJBTEFOQ0UsIHBjdCA9ICh4OiBudW1iZXIpID0+IE1hdGgucm91bmQoeCAqIDEwMCkgKyAnJSc7XG4gIHN3aXRjaCAoc291bCkge1xuICAgIGNhc2UgJ3dhcnJpb3InOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdQaGFsYW54JywgdGV4dDogYFRha2VzICR7cGN0KEIucGhhbGFueC5wZXJBbGx5KX0gbGVzcyBkYW1hZ2UgZm9yIGVhY2ggb3RoZXIgU2tlbGV0b24gV2FycmlvciB3aXRoaW4gJHtCLnBoYWxhbngucmFkaXVzfW0gKHVwIHRvICR7Qi5waGFsYW54Lm1heFN0YWNrc30pLmAgfTtcbiAgICBjYXNlICdnb2JsaW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdPcHBvcnR1bmlzdCcsIHRleHQ6IGBEZWFscyAke3BjdChCLm9wcG9ydHVuaXN0LmJvbnVzKX0gbW9yZSBkYW1hZ2UgdG8gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2UsIGFuZCBwcmVmZXJzIHN1Y2ggdGFyZ2V0cy5gIH07XG4gICAgY2FzZSAnYmFyYmFyaWFuJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnRnJlbnp5JywgdGV4dDogYEF0dGFja3MgJHtwY3QoQi5mcmVuenkucGVyU3dpbmcpfSBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nICh1cCB0byAke0IuZnJlbnp5Lm1heFN0YWNrc30gdGltZXMpLmAgfTtcbiAgICBjYXNlICdhcmNoZXInOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU3BsaXQgQXJyb3cnLCB0ZXh0OiBgQmFzaWMgc2hvdHMgZmlyZSBvbmUgYXJyb3cuIFdoZW4gbWFuYSBpcyBmdWxsLCB0aGUgbmV4dCBzaG90IGZpcmVzIGF0IHVwIHRvICR7Qi52b2xsZXkudGFyZ2V0c30gZGlmZmVyZW50IGVuZW1pZXMuYCB9O1xuICAgIGNhc2UgJ2tuaWdodCc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdUYXVudCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgZW5lbWllcyB3aXRoaW4gJHtCLnRhdW50LnJhZGl1c31tIG11c3QgYXR0YWNrIGhpbSBmb3IgJHtCLnRhdW50LmR1cmF0aW9ufXMuYCB9O1xuICAgIGNhc2UgJ29ncmUnOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU21hc2gnLCB0ZXh0OiBgV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHN3aW5nIGRlYWxzICR7Qi5zbWFzaC5tdWx0fXggZGFtYWdlIGFuZCBoaXRzIGVuZW1pZXMgbmVhciB0aGUgdGFyZ2V0IGZvciA2MCUgYXMgbXVjaC5gIH07XG4gIH1cbn1cbiIsICIvLyBEZXNpZ24gZGF0YSBzdHJhaWdodCBmcm9tIHRoZSBwbGFuIGRvYy4gQW55dGhpbmcgbWFya2VkIFBMQUNFSE9MREVSIGlzIG5vdCBpbiB0aGUgZG9jIHlldC5cblxuZXhwb3J0IHR5cGUgU291bElkID0gJ3dhcnJpb3InIHwgJ2FyY2hlcicgfCAnZ29ibGluJyB8ICdrbmlnaHQnIHwgJ29ncmUnIHwgJ2JhcmJhcmlhbic7XG5cbmV4cG9ydCBjb25zdCBTT1VMUzogU291bElkW10gPSBbJ3dhcnJpb3InLCAnYXJjaGVyJywgJ2dvYmxpbicsICdrbmlnaHQnLCAnb2dyZScsICdiYXJiYXJpYW4nXTtcblxuLyoqIERvbWluaW9uIGNvc3QgcGVyIHN0YXIgbGV2ZWw6IGluZGV4IDAgPSAxIHN0YXIsIDEgPSAyIHN0YXJzLCAyID0gMyBzdGFycyAoMyBzdGFycyBpcyB0aGUgbWF4KS4gKi9cbmV4cG9ydCBjb25zdCBDT1NUOiBSZWNvcmQ8U291bElkLCBudW1iZXJbXT4gPSB7XG4gIHdhcnJpb3I6IFsyLCAzLCA0XSxcbiAgYXJjaGVyOiBbNCwgNiwgOV0sXG4gIGdvYmxpbjogWzMsIDQsIDZdLFxuICBrbmlnaHQ6IFs1LCA3LCAxMF0sXG4gIG9ncmU6IFs3LCAxMCwgMTVdLFxuICBiYXJiYXJpYW46IFs1LCA3LCAxMF0sIC8vIFBMQUNFSE9MREVSOiB0aGUgZG9jIGhhcyBubyBjb3N0IGZvciB0aGUgc2l4dGggU291bCB5ZXRcbn07XG5cbmV4cG9ydCBjb25zdCBNQVhfU1RBUiA9IDM7XG5leHBvcnQgY29uc3QgR1JJRF9DRUxMUyA9IDEyOyAvLyA0IHggM1xuXG4vKiogRG9taW5pb24gY2FwIHBlciB3YXZlIChpbmRleCAwID0gd2F2ZSAxKS4gKi9cbmV4cG9ydCBjb25zdCBDVVJWRVM6IFJlY29yZDxzdHJpbmcsIG51bWJlcltdPiA9IHtcbiAgLy8gTE9DS0VEIChjb25maXJtZWQpOiArNCBmb3Igd2F2ZXMgMi01LCB0aGVuICszIGZvciB3YXZlcyA2LTEwIC0+IDQwXG4gIGRvYzogWzksIDEzLCAxNywgMjEsIDI1LCAyOCwgMzEsIDM0LCAzNywgNDBdLFxuICAvLyBOT1QgVVNFRDogbWlzcmVtZW1iZXJlZCB2YXJpYW50ICgrMyB0aHJvdWdoIHdhdmUgNiwgdGhlbiArMikgdGhhdCBvbmx5IHJlYWNoZXMgMzIuIEtlcHQgZm9yIGNvbXBhcmlzb24gb25seS5cbiAgcmVjYWxsZWQ6IFs5LCAxMiwgMTUsIDE4LCAyMSwgMjQsIDI2LCAyOCwgMzAsIDMyXSxcbn07XG5cbmV4cG9ydCBjb25zdCBIRUFSVFMgPSAzO1xuZXhwb3J0IGNvbnN0IFNUQVJUX0hBTkQgPSA0O1xuZXhwb3J0IGNvbnN0IFdBVkVTID0gMTA7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnVsZXMge1xuICAvKiogRG9taW5pb24gY2FwIHBlciB3YXZlLiAqL1xuICBjdXJ2ZTogbnVtYmVyW107XG4gIC8qKlxuICAgKiAnZGVwbG95ZWRPbmx5Jzogb25seSB0d28gZGVwbG95ZWQgdW5pdHMgb2YgdGhlIHNhbWUgc3RhciBjYW4gbWVyZ2UgKGRvYyBhcyB3cml0dGVuKS5cbiAgICogJ2hhbmRJbnRvT25lU3Rhcic6IGFkZGl0aW9uYWxseSBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIGJlIHBsYXllZCBvbnRvIGEgZGVwbG95ZWRcbiAgICogMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bCB0byBtZXJnZSBpbW1lZGlhdGVseSAocGF5cyBvbmx5IHRoZSBjb3N0IGRpZmZlcmVuY2UpLlxuICAgKi9cbiAgbWVyZ2U6ICdkZXBsb3llZE9ubHknIHwgJ2hhbmRJbnRvT25lU3Rhcic7XG4gIC8qKiBDYXJkLWluZmxvdyBrbm9icyAoYWxsIG9wdGlvbmFsOyBkZWZhdWx0cyByZXByb2R1Y2UgdGhlIGRvYykuICovXG4gIHN0YXJ0SGFuZD86IG51bWJlcjsgICAgICAgICAgICAvLyBkZWZhdWx0IDRcbiAgZHJhZnRQaWNrcz86IG51bWJlcjsgICAgICAgICAgIC8vIGNhcmRzIGtlcHQgZnJvbSB0aGUgMy1jYXJkIFZpY3RvcnkgRHJhZnQsIGRlZmF1bHQgMVxuICBub3JtYWxEcmF3V2F2ZXM/OiBudW1iZXJbXTsgICAgLy8gd2F2ZXMgKGJlaW5nIGVudGVyZWQpIHRoYXQgYWxzbyBnaXZlIHRoZSBub3JtYWwgcmFuZG9tIGRyYXc7IGRlZmF1bHQgPSBhbGxcbiAgLyoqIFNvdWxzIHRoaXMgcnVuIG1heSBkcmF3IGZyb20gKHRoZSBlcXVpcHBlZCBTb3VsIERlY2ssIG1heCA2KS4gRGVmYXVsdDogZXZlcnkgU291bC4gKi9cbiAgcG9vbD86IFNvdWxJZFtdO1xuICBzdGFnZVdhdmVzPzogbnVtYmVyOyAgICAgICAgICAgLy8gd2F2ZXMgaW4gdGhpcyBzdGFnZTsgZGVmYXVsdCAxMCAodGhlIHBsYXlhYmxlIHByb3RvdHlwZSB1c2VzIDMpXG59XG5cbmV4cG9ydCBjb25zdCBHUklEX0NPTFMgPSA0LCBHUklEX1JPV1MgPSAzOyAgIC8vIDQgeCAzID0gR1JJRF9DRUxMUzsgY29sdW1uIEdSSURfQ09MUy0xIGlzIHRoZSBmcm9udCBsaW5lXG4iLCAiLy8gU21hbGwgc2VlZGVkIFJORyAobXVsYmVycnkzMikuIFNhbWUgc2VlZCAtPiBzYW1lIHJ1biwgc28gYW55IGJ1ZyByZXBvcnQgaXMgcmVwcm9kdWNpYmxlLlxuLy8gYHN0YXRlKClgIC8gdGhlIGByZXN1bWVgIGFyZ3VtZW50IGxldCBhIHNhdmVkIHJ1biBjb250aW51ZSBkcmF3aW5nIGV4YWN0bHkgdGhlIGNhcmRzIGl0IHdvdWxkIGhhdmUgZHJhd24uXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgbmV4dCgpOiBudW1iZXI7ICAgICAgICAgICAgICAvLyBbMCwgMSlcbiAgaW50KG46IG51bWJlcik6IG51bWJlcjsgICAgICAvLyBbMCwgbilcbiAgcGljazxUPihpdGVtczogcmVhZG9ubHkgVFtdKTogVDtcbiAgc2VlZDogbnVtYmVyO1xuICBzdGF0ZSgpOiBudW1iZXI7ICAgICAgICAgICAgIC8vIHRoZSBnZW5lcmF0b3IncyBjdXJyZW50IHBvc2l0aW9uLCBmb3Igc2F2aW5nIGEgcnVuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYWtlUm5nKHNlZWQ6IG51bWJlciwgcmVzdW1lPzogbnVtYmVyKTogUm5nIHtcbiAgbGV0IGEgPSAocmVzdW1lID8/IHNlZWQpID4+PiAwO1xuICBjb25zdCBuZXh0ID0gKCkgPT4ge1xuICAgIGEgPSAoYSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gYTtcbiAgICB0ID0gTWF0aC5pbXVsKHQgXiAodCA+Pj4gMTUpLCB0IHwgMSk7XG4gICAgdCBePSB0ICsgTWF0aC5pbXVsKHQgXiAodCA+Pj4gNyksIHQgfCA2MSk7XG4gICAgcmV0dXJuICgodCBeICh0ID4+PiAxNCkpID4+PiAwKSAvIDQyOTQ5NjcyOTY7XG4gIH07XG4gIHJldHVybiB7XG4gICAgc2VlZCxcbiAgICBuZXh0LFxuICAgIGludDogKG4pID0+IE1hdGguZmxvb3IobmV4dCgpICogbiksXG4gICAgcGljazogKGl0ZW1zKSA9PiBpdGVtc1tNYXRoLmZsb29yKG5leHQoKSAqIGl0ZW1zLmxlbmd0aCldLFxuICAgIHN0YXRlOiAoKSA9PiBhLFxuICB9O1xufVxuIiwgIi8vIFB1cmUgZ2FtZSBydWxlcyBmb3Igb25lIHN0YWdlLiBObyBncmFwaGljcywgbm8gY29tYmF0OiBqdXN0IGNhcmRzLCBEb21pbmlvbiwgZ3JpZCwgbWVyZ2UsIHdhdmVzLCBoZWFydHMuXG4vLyBFdmVyeSBtdXRhdGlvbiBnb2VzIHRocm91Z2ggYSBmdW5jdGlvbiBoZXJlIGFuZCBhcHBlbmRzIHRvIHN0YXRlLmxvZywgc28gcnVucyBjYW4gYmUgcmVwbGF5ZWQgYW5kIGluc3BlY3RlZC5cblxuaW1wb3J0IHsgQ09TVCwgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMsIFNUQVJUX0hBTkQsIFdBVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMsIFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdCB7IGlkOiBudW1iZXI7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7IGZyZXNoPzogYm9vbGVhbiB9ICAgLy8gZnJlc2ggPSBzdW1tb25lZCB0aGlzIGJ1aWxkIHBoYXNlXG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdGUge1xuICBydWxlczogUnVsZXM7XG4gIHJuZzogUm5nO1xuICB3YXZlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAvLyAxLWJhc2VkXG4gIGhlYXJ0czogbnVtYmVyO1xuICBjYXA6IG51bWJlcjtcbiAgaGFuZDogU291bElkW107XG4gIHVuaXRzOiBVbml0W107XG4gIG5leHRJZDogbnVtYmVyO1xuICBkaXNjYXJkVXNlZDogYm9vbGVhbjsgICAgICAgICAvLyBvbmNlLXBlci1idWlsZC1waGFzZSByZWRyYXdcbiAgc3RhdHVzOiAnYnVpbGRpbmcnIHwgJ3dvbicgfCAnbG9zdCc7XG4gIGxvZzogc3RyaW5nW107XG4gIHN0YXRzOiB7IGRyYXduOiBudW1iZXI7IGRpc2NhcmRlZDogbnVtYmVyOyBkaXNtaXNzZWQ6IG51bWJlcjsgbWVyZ2VzOiBudW1iZXI7IGZhaWx1cmVzOiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGNvc3QgPSAoc291bDogU291bElkLCBzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG5leHBvcnQgY29uc3QgY2FyZHNJbiA9IChzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gMiAqKiAoc3RhciAtIDEpOyAgICAgLy8gY2FyZHMgYSB1bml0IGlzIFwid29ydGhcIlxuZXhwb3J0IGNvbnN0IGRvbWluaW9uVXNlZCA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNvc3QodS5zb3VsLCB1LnN0YXIpLCAwKTtcbmV4cG9ydCBjb25zdCBkb21pbmlvbkZyZWUgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5jYXAgLSBkb21pbmlvblVzZWQocyk7XG5cbmZ1bmN0aW9uIGxvZyhzOiBTdGF0ZSwgbXNnOiBzdHJpbmcpIHsgcy5sb2cucHVzaChgW3cke3Mud2F2ZX1dICR7bXNnfWApOyB9XG4vKiogVGhlIFNvdWxzIHRoaXMgcnVuIGRyYXdzIGZyb206IHRoZSBlcXVpcHBlZCBkZWNrLCBvciBldmVyeXRoaW5nIGlmIG5vIGRlY2sgd2FzIGdpdmVuLiAqL1xuZXhwb3J0IGNvbnN0IHBvb2xPZiA9IChzOiBTdGF0ZSk6IFNvdWxJZFtdID0+IChzLnJ1bGVzLnBvb2wgJiYgcy5ydWxlcy5wb29sLmxlbmd0aCA/IHMucnVsZXMucG9vbCA6IFNPVUxTKTtcbmZ1bmN0aW9uIGRyYXcoczogU3RhdGUsIHdoeTogc3RyaW5nLCBub3Q/OiBTb3VsSWQpOiBTb3VsSWQge1xuICBjb25zdCBhbGwgPSBwb29sT2YocyksIG90aGVycyA9IG5vdCA/IGFsbC5maWx0ZXIoKHgpID0+IHggIT09IG5vdCkgOiBhbGw7XG4gIGNvbnN0IHBvb2wgPSBvdGhlcnMubGVuZ3RoID8gb3RoZXJzIDogYWxsOyAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBzd2FwIG5ldmVyIGhhbmRzIHlvdSBiYWNrIHRoZSBTb3VsIHlvdSBnYXZlIHVwICh1bmxlc3MgaXQgaXMgdGhlIG9ubHkgb25lIGVxdWlwcGVkKVxuICBjb25zdCBjID0gcy5ybmcucGljayhwb29sKTtcbiAgcy5oYW5kLnB1c2goYyk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmF3ICR7Y30gKCR7d2h5fSlgKTtcbiAgcmV0dXJuIGM7XG59XG5cbi8qKiBBIG5ldyBidWlsZCBwaGFzZSBiZWdpbnM6IHRoZSBvbmNlLXBlci1waGFzZSBzd2FwIGNvbWVzIGJhY2sgYW5kIG5vdGhpbmcgY291bnRzIGFzIFwic3VtbW9uZWQgdGhpcyByb3VuZFwiLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5ld1BoYXNlKHM6IFN0YXRlKTogdm9pZCB7XG4gIHMuZGlzY2FyZFVzZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIHUuZnJlc2ggPSBmYWxzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld1N0YWdlKHJ1bGVzOiBSdWxlcywgc2VlZDogbnVtYmVyKTogU3RhdGUge1xuICBjb25zdCBzOiBTdGF0ZSA9IHtcbiAgICBydWxlcywgcm5nOiBtYWtlUm5nKHNlZWQpLCB3YXZlOiAxLCBoZWFydHM6IEhFQVJUUywgY2FwOiBydWxlcy5jdXJ2ZVswXSwgaGFuZDogW10sIHVuaXRzOiBbXSwgbmV4dElkOiAxLFxuICAgIGRpc2NhcmRVc2VkOiBmYWxzZSwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IFtdLFxuICAgIHN0YXRzOiB7IGRyYXduOiAwLCBkaXNjYXJkZWQ6IDAsIGRpc21pc3NlZDogMCwgbWVyZ2VzOiAwLCBmYWlsdXJlczogMCB9LFxuICB9O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IChydWxlcy5zdGFydEhhbmQgPz8gU1RBUlRfSEFORCk7IGkrKykgZHJhdyhzLCAnc3RhcnRpbmcgaGFuZCcpO1xuICAvLyBPcGVuaW5nLWhhbmQgc2FmZWd1YXJkOiBtZXJnaW5nIGlzIHRoZSBoZWFydCBvZiB0aGUgZ2FtZSwgc28gdGhlIGZpcnN0IGhhbmQgYWx3YXlzIGhvbGRzIGF0IGxlYXN0IG9uZSBtYXRjaGluZyBwYWlyICh3aXRoIHNpeCBTb3VscywgYWJvdXQgMjglIG9mIHJhbmRvbSBoYW5kcyB3b3VsZCBub3QpLlxuICBpZiAocy5oYW5kLmxlbmd0aCA+PSAyICYmIG5ldyBTZXQocy5oYW5kKS5zaXplID09PSBzLmhhbmQubGVuZ3RoKSB7IGNvbnN0IGsgPSBNYXRoLmZsb29yKHMucm5nLm5leHQoKSAqIChzLmhhbmQubGVuZ3RoIC0gMSkpOyBzLmhhbmRbcy5oYW5kLmxlbmd0aCAtIDFdID0gcy5oYW5kW2tdOyBsb2cocywgYHN0YXJ0aW5nIGhhbmQ6IGxhc3QgY2FyZCBiZWNhbWUgYSBjb3B5IG9mICR7cy5oYW5kW2tdfSBzbyBhIG1lcmdlIGlzIHBvc3NpYmxlYCk7IH1cbiAgcmV0dXJuIHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmcmVlQ2VsbChzOiBTdGF0ZSk6IG51bWJlciB7XG4gIGNvbnN0IHRha2VuID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoIXRha2VuLmhhcyhjKSkgcmV0dXJuIGM7XG4gIHJldHVybiAtMTtcbn1cblxuLy8gLS0tLSBidWlsZC1waGFzZSBhY3Rpb25zIChlYWNoIHJldHVybnMgdHJ1ZSB3aGVuIGl0IGhhcHBlbmVkKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF07XG4gIHJldHVybiBzb3VsICE9PSB1bmRlZmluZWQgJiYgZnJlZUNlbGwocykgPj0gMCAmJiBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNlbGxGcmVlKHM6IFN0YXRlLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgcmV0dXJuIGNlbGwgPj0gMCAmJiBjZWxsIDwgR1JJRF9DRUxMUyAmJiAhcy51bml0cy5zb21lKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpO1xufVxuXG4vKiogU3VtbW9uIGEgaGFuZCBjYXJkIG9udG8gYSBzcGVjaWZpYyBmcmVlIGNlbGwgKGRlZmF1bHQ6IHRoZSBmaXJzdCBmcmVlIG9uZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIGNlbGw/OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5TdW1tb24ocywgaGFuZElkeCkpIHJldHVybiBmYWxzZTtcbiAgaWYgKGNlbGwgIT09IHVuZGVmaW5lZCAmJiAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHU6IFVuaXQgPSB7IGlkOiBzLm5leHRJZCsrLCBzb3VsLCBzdGFyOiAxLCBjZWxsOiBjZWxsID8/IGZyZWVDZWxsKHMpLCBmcmVzaDogdHJ1ZSB9O1xuICBzLnVuaXRzLnB1c2godSk7XG4gIGxvZyhzLCBgc3VtbW9uICR7c291bH0gMSogLT4gY2VsbCAke3UuY2VsbH0gIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VEZXBsb3llZChhOiBVbml0LCBiOiBVbml0KTogYm9vbGVhbiB7XG4gIHJldHVybiBhLmlkICE9PSBiLmlkICYmIGEuc291bCA9PT0gYi5zb3VsICYmIGEuc3RhciA9PT0gYi5zdGFyICYmIGEuc3RhciA8IE1BWF9TVEFSO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VEZXBsb3llZChzOiBTdGF0ZSwgYUlkOiBudW1iZXIsIGJJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGFJZCksIGIgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGJJZCk7XG4gIGlmICghYSB8fCAhYiB8fCAhY2FuTWVyZ2VEZXBsb3llZChhLCBiKSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHUpID0+IHUuaWQgIT09IGIuaWQpO1xuICBhLmZyZXNoID0gISEoYS5mcmVzaCB8fCBiLmZyZXNoKTtcbiAgYS5zdGFyKys7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UgJHthLnNvdWx9ICR7YS5zdGFyIC0gMX0qKyR7YS5zdGFyIC0gMX0qIC0+ICR7YS5zdGFyfSogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0sIGNlbGxzICR7cy51bml0cy5sZW5ndGh9LyR7R1JJRF9DRUxMU30pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogJ2hhbmRJbnRvT25lU3RhcicgcnVsZTogcGxheSBhIDEtc3RhciBjYXJkIG9udG8gYSBkZXBsb3llZCAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMucnVsZXMubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF0sIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghc291bCB8fCAhdSB8fCB1LnNvdWwgIT09IHNvdWwgfHwgdS5zdGFyICE9PSAxKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBjb3N0KHNvdWwsIDIpIC0gY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuTWVyZ2VGcm9tSGFuZChzLCBoYW5kSWR4LCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgdS5zdGFyID0gMjtcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZS1mcm9tLWhhbmQgJHtzb3VsfSAtPiAke3Uuc291bH0gMiogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGlzbWlzcyhzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1KSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYGRpc21pc3MgJHt1LnNvdWx9ICR7dS5zdGFyfSogKHBlcm1hbmVudGx5IHJlbW92ZWQpYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMTogZGlzY2FyZCBhIGhhbmQgY2FyZCBhbmQgZHJhdyBhIHJhbmRvbSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzY2FyZFJlZHJhdyhzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLmRpc2NhcmRVc2VkIHx8IGhhbmRJZHggPCAwIHx8IGhhbmRJZHggPj0gcy5oYW5kLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzY2FyZGVkKys7XG4gIGxvZyhzLCBgc3dhcDogZGlzY2FyZCAke2N9YCk7XG4gIGRyYXcocywgJ3N3YXAnLCBjKTtcbiAgcmV0dXJuIHRydWU7XG59XG5leHBvcnQgY29uc3Qgc3dhcERpc2NhcmQgPSBkaXNjYXJkUmVkcmF3O1xuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIHJldHVybiAhcy5kaXNjYXJkVXNlZCAmJiAhIXUgJiYgIXUuZnJlc2g7ICAgICAgICAgIC8vIGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kXG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAyOiBzZWxsIGEgZGVwbG95ZWQgdW5pdCAobm90IG9uZSBzdW1tb25lZCB0aGlzIHJvdW5kKSBhbmQgZHJhdyBhIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzd2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5Td2FwU2VsbChzLCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgc3dhcDogc2VsbCAke3Uuc291bH0gJHt1LnN0YXJ9KmApO1xuICBkcmF3KHMsICdzd2FwJywgdS5zb3VsKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtb3ZlVW5pdChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUgfHwgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGxvZyhzLCBgbW92ZSAke3Uuc291bH0gY2VsbCAke3UuY2VsbH0gLT4gJHtjZWxsfWApOyB1LmNlbGwgPSBjZWxsOyByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gLS0tLSB3YXZlIHJlc3VsdHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRHJhZnQgY2hvaWNlcyBmb3IgYWZ0ZXIgYSBjbGVhcmVkIHdhdmU6IDMgcmFuZG9tIGNhcmRzLCBkdXBsaWNhdGVzIGFsbG93ZWQuICovXG5leHBvcnQgZnVuY3Rpb24gZHJhZnRPcHRpb25zKHM6IFN0YXRlKTogU291bElkW10ge1xuICBjb25zdCBwID0gcG9vbE9mKHMpO1xuICByZXR1cm4gW3Mucm5nLnBpY2socCksIHMucm5nLnBpY2socCksIHMucm5nLnBpY2socCldO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkOiByYWlzZSB0aGUgY2FwLCByZXNvbHZlIHRoZSBWaWN0b3J5IERyYWZ0LCBkcmF3IDEgbm9ybWFsIGNhcmQuICovXG5leHBvcnQgY29uc3Qgc3RhZ2VXYXZlcyA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnJ1bGVzLnN0YWdlV2F2ZXMgPz8gV0FWRVM7XG5cbi8qKiBTdGVwIDEgb2YgYSBjbGVhcmVkIHdhdmU6IGlzIHRoZSBzdGFnZSBvdmVyPyBJZiBub3QsIHJhaXNlIHRoZSBjYXAgYW5kIHN0YXJ0IHRoZSBuZXh0IGJ1aWxkIHBoYXNlLiBSZXR1cm5zIHRydWUgd2hlbiB0aGUgc3RhZ2UgaXMgd29uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2VXYXZlKHM6IFN0YXRlKTogYm9vbGVhbiB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuIHMuc3RhdHVzID09PSAnd29uJztcbiAgaWYgKHMud2F2ZSA+PSBzdGFnZVdhdmVzKHMpKSB7IHMuc3RhdHVzID0gJ3dvbic7IGxvZyhzLCAnc3RhZ2UgY2xlYXJlZCcpOyByZXR1cm4gdHJ1ZTsgfVxuICBzLndhdmUrKztcbiAgcy5jYXAgPSBzLnJ1bGVzLmN1cnZlW3Mud2F2ZSAtIDFdO1xuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGB3YXZlIGNsZWFyZWQgLT4gY2FwICR7cy5jYXB9YCk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFN0ZXAgMjogdGhlIHBsYXllciBrZXB0IGBpZHhgIGZyb20gdGhlIG9mZmVyZWQgZHJhZnQgY2FyZHMuICovXG5leHBvcnQgZnVuY3Rpb24gdGFrZURyYWZ0KHM6IFN0YXRlLCBvcHRzOiBTb3VsSWRbXSwgaWR4OiBudW1iZXIpOiB2b2lkIHtcbiAgY29uc3QgcGljayA9IG9wdHNbTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBpZHgpKV07XG4gIHMuaGFuZC5wdXNoKHBpY2spOyBzLnN0YXRzLmRyYXduKys7XG4gIGxvZyhzLCBgZHJhZnQgWyR7b3B0cy5qb2luKCcsICcpfV0gLT4gdG9vayAke3BpY2t9YCk7XG59XG5cbi8qKiBTdGVwIDM6IHRoZSBib251cyBub3JtYWwgZHJhdyAob25seSBvbiB0aGUgd2F2ZXMgdGhlIHJ1bGVzIGFsbG93KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxEcmF3KHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcyA/IHMucnVsZXMubm9ybWFsRHJhd1dhdmVzLmluY2x1ZGVzKHMud2F2ZSkgOiB0cnVlKSBkcmF3KHMsICd3YXZlIGNsZWFyJyk7XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQgKGFsbCB0aHJlZSBzdGVwcyBpbiBvbmUgY2FsbCwgZm9yIHNpbXVsYXRpb25zKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhcldhdmUoczogU3RhdGUsIGNob29zZTogKG9wdHM6IFNvdWxJZFtdKSA9PiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKGFkdmFuY2VXYXZlKHMpKSByZXR1cm47XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBsZXQgb3B0cyA9IGRyYWZ0T3B0aW9ucyhzKTtcbiAgY29uc3Qgb2ZmZXJlZCA9IG9wdHMuam9pbignLCAnKTtcbiAgY29uc3QgdG9vazogU291bElkW10gPSBbXTtcbiAgZm9yIChsZXQgcCA9IDA7IHAgPCAocy5ydWxlcy5kcmFmdFBpY2tzID8/IDEpOyBwKyspIHtcbiAgICBjb25zdCBpZHggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGNob29zZShvcHRzKSkpO1xuICAgIHRvb2sucHVzaChvcHRzW2lkeF0pOyBzLmhhbmQucHVzaChvcHRzW2lkeF0pOyBzLnN0YXRzLmRyYXduKys7XG4gICAgb3B0cyA9IG9wdHMuZmlsdGVyKChfLCBpKSA9PiBpICE9PSBpZHgpO1xuICB9XG4gIGxvZyhzLCBgZHJhZnQgWyR7b2ZmZXJlZH1dIC0+IHRvb2sgJHt0b29rLmpvaW4oJywgJyl9YCk7XG4gIG5vcm1hbERyYXcocyk7XG59XG5cbi8qKiBBcm15IHdpcGVkOiBsb3NlIGEgaGVhcnQsIGNhcCBkb2VzIE5PVCByaXNlLCBlbmVtaWVzIHJlc2V0LCArMSBjYXJkLCByZWRyYXcgYWxsb3dlZCBhZ2Fpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmYWlsV2F2ZShzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgcy5oZWFydHMtLTsgcy5zdGF0cy5mYWlsdXJlcysrO1xuICBpZiAocy5oZWFydHMgPD0gMCkgeyBzLnN0YXR1cyA9ICdsb3N0JzsgbG9nKHMsICdubyBoZWFydHMgbGVmdDogc3RhZ2UgbG9zdCcpOyByZXR1cm47IH1cbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgYXJteSB3aXBlZDogaGVhcnRzICR7cy5oZWFydHN9LCBjYXAgc3RheXMgJHtzLmNhcH1gKTtcbiAgZHJhdyhzLCAnZmFpbGVkIGF0dGVtcHQnKTtcbn1cblxuLy8gLS0tLSBpbnZhcmlhbnRzIChjYWxsZWQgYnkgdGhlIHNpbXVsYXRvciBhZnRlciBldmVyeSB3YXZlOyB0aHJvdyB3aXRoIGEgcmVhZGFibGUgbWVzc2FnZSkgLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2hlY2tJbnZhcmlhbnRzKHM6IFN0YXRlKTogdm9pZCB7XG4gIGNvbnN0IGZhaWwgPSAobTogc3RyaW5nKSA9PiB7IHRocm93IG5ldyBFcnJvcihgSU5WQVJJQU5UICR7bX1cXG5gICsgcy5sb2cuc2xpY2UoLTEyKS5qb2luKCdcXG4nKSk7IH07XG4gIGlmIChzLnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIGZhaWwoYG1vcmUgdW5pdHMgKCR7cy51bml0cy5sZW5ndGh9KSB0aGFuIGNlbGxzYCk7XG4gIGNvbnN0IGNlbGxzID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGlmIChjZWxscy5zaXplICE9PSBzLnVuaXRzLmxlbmd0aCkgZmFpbCgndHdvIHVuaXRzIHNoYXJlIGEgY2VsbCcpO1xuICBpZiAoZG9taW5pb25Vc2VkKHMpID4gcy5jYXApIGZhaWwoYGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfSBleGNlZWRzIGNhcCAke3MuY2FwfWApO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgaWYgKHUuc3RhciA8IDEgfHwgdS5zdGFyID4gTUFYX1NUQVIpIGZhaWwoYHVuaXQgc3RhciAke3Uuc3Rhcn0gb3V0IG9mIHJhbmdlYCk7XG4gIC8vIGV2ZXJ5IGRyYXduIGNhcmQgaXMgZWl0aGVyIGluIGhhbmQsIHdvcnRoIGNhcmRzIG9uIHRoZSBmaWVsZCwgZGlzY2FyZGVkLCBvciBkaXNtaXNzZWRcbiAgY29uc3Qgb25GaWVsZCA9IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY2FyZHNJbih1LnN0YXIpLCAwKTtcbiAgY29uc3QgYWNjb3VudGVkID0gcy5oYW5kLmxlbmd0aCArIG9uRmllbGQgKyBzLnN0YXRzLmRpc2NhcmRlZCArIHMuc3RhdHMuZGlzbWlzc2VkO1xuICBpZiAoYWNjb3VudGVkICE9PSBzLnN0YXRzLmRyYXduKSBmYWlsKGBjYXJkIGNvbnNlcnZhdGlvbjogZHJhd24gJHtzLnN0YXRzLmRyYXdufSAhPSBhY2NvdW50ZWQgJHthY2NvdW50ZWR9YCk7XG59XG4iLCAiLy8gVGhlIGJhdHRsZWZpZWxkJ3MgbG9vazogYSB0aWxlZCBjcnlwdCBmbG9vciwgYSBnbG93aW5nIHJ1bmUgY2lyY2xlIGluIHRoZSBtaWRkbGUsIGFuZCBhIGRhcmsgbWlzdHkgc3Vycm91bmQuIFB1cmUgZGVjb3JhdGlvbiAobm8gZ2FtZSBydWxlcykuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuY29uc3QgVElMRV9NRVRSRVMgPSA1OyAgICAvLyBvbmUgcmVwZWF0IG9mIHRoZSBmbG9vciBwaWN0dXJlIGNvdmVycyB0aGlzIG1hbnkgbWV0cmVzLCBzbyBzbGFicyBjb21lIG91dCBhYm91dCBhIG1ldHJlIHdpZGVcblxuLyoqIERyYXcgdGhlIHJ1bmUgY2lyY2xlIG9uY2Ugb250byBhIGNhbnZhczsgaXQgYmVjb21lcyBhIHNlZS10aHJvdWdoIGRlY2FsIG9uIHRoZSBmbG9vci4gKi9cbmZ1bmN0aW9uIHJ1bmVUZXh0dXJlKHNjZW5lOiBhbnkpOiBhbnkge1xuICBjb25zdCBTID0gNTEyLCB0ZXggPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgncnVuZXMnLCB7IHdpZHRoOiBTLCBoZWlnaHQ6IFMgfSwgc2NlbmUsIHRydWUpLCBjID0gdGV4LmdldENvbnRleHQoKTtcbiAgYy5jbGVhclJlY3QoMCwgMCwgUywgUyk7IGMudHJhbnNsYXRlKFMgLyAyLCBTIC8gMik7IGMubGluZUNhcCA9ICdyb3VuZCc7IGMubGluZUpvaW4gPSAncm91bmQnO1xuICBjb25zdCByaW5nID0gKHI6IG51bWJlciwgdzogbnVtYmVyLCBhOiBudW1iZXIpID0+IHsgYy5iZWdpblBhdGgoKTsgYy5hcmMoMCwgMCwgciwgMCwgTWF0aC5QSSAqIDIpOyBjLmxpbmVXaWR0aCA9IHc7IGMuc3Ryb2tlU3R5bGUgPSBgcmdiYSg0NywyMTcsMTY2LCR7YX0pYDsgYy5zdHJva2UoKTsgfTtcbiAgYy5zaGFkb3dDb2xvciA9ICdyZ2JhKDQ3LDIxNywxNjYsMC45KSc7IGMuc2hhZG93Qmx1ciA9IDEwO1xuICByaW5nKDIzNiwgNCwgMC43NSk7IHJpbmcoMjE0LCAyLCAwLjUpOyByaW5nKDEyMCwgMywgMC43KTtcbiAgYy5zdHJva2VTdHlsZSA9ICdyZ2JhKDQ3LDIxNywxNjYsMC43KSc7IGMubGluZVdpZHRoID0gMztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0OyBpKyspIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZvdXIgbG9uZyBzcGlrZXMsIGxpa2UgYSBjb21wYXNzXG4gICAgYy5zYXZlKCk7IGMucm90YXRlKChpICogTWF0aC5QSSkgLyAyICsgTWF0aC5QSSAvIDQpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMzApOyBjLmxpbmVUbygwLCAtMjMwKTsgYy5zdHJva2UoKTtcbiAgICBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygtMTQsIC0xMjApOyBjLmxpbmVUbygwLCAtMTYwKTsgYy5saW5lVG8oMTQsIC0xMjApOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTtcbiAgfVxuICBjLmxpbmVXaWR0aCA9IDI7IGMuc3Ryb2tlU3R5bGUgPSAncmdiYSg0NywyMTcsMTY2LDAuNTUpJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMjsgaSsrKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNtYWxsIHRpY2sgbWFya3MgYmV0d2VlbiB0aGUgdHdvIG91dGVyIHJpbmdzXG4gICAgYy5zYXZlKCk7IGMucm90YXRlKChpICogTWF0aC5QSSkgLyA2KTsgYy5iZWdpblBhdGgoKTsgYy5tb3ZlVG8oMCwgLTIxNCk7IGMubGluZVRvKDAsIC0yMzYpOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTtcbiAgfVxuICB0ZXgudXBkYXRlKCk7IHRleC5oYXNBbHBoYSA9IHRydWU7IHJldHVybiB0ZXg7XG59XG5cbmludGVyZmFjZSBQbGFjZW1lbnQgeyBwcm9wOiBzdHJpbmc7IHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc/OiBudW1iZXI7IHM/OiBudW1iZXIgfVxuLyoqIFdoZXJlIHRoZSBwcm9wcyBzdGFuZC4gVGFsbCB0aGluZ3MgZ28gYmVoaW5kIGFuZCBiZXNpZGUgdGhlIGZpZWxkOyBvbmx5IGxvdyB0aGluZ3MgKGZlbmNlLCBib25lcywgd2FsbCkgc3RhbmQgYmV0d2VlbiB0aGUgY2FtZXJhIGFuZCB0aGUgdW5pdHMuICovXG5jb25zdCBDUllQVF9MQVlPVVQ6IFBsYWNlbWVudFtdID0gW1xuICB7IHByb3A6ICdhcmNoJywgeDogLTYuNSwgejogNi40IH0sIHsgcHJvcDogJ2FyY2gnLCB4OiAwLCB6OiA2LjksIHM6IDEuMTUgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDYuNSwgejogNi40IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMC4yLCB6OiA1LjYsIHlhdzogMC40IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0zLjIsIHo6IDUuOSwgeWF3OiAyLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMy4zLCB6OiA1LjgsIHlhdzogNC4wIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDEwLjIsIHo6IDUuNiwgeWF3OiAxLjIgfSxcbiAgeyBwcm9wOiAnYnJhemllcicsIHg6IC00LjYsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogNC42LCB6OiA1LjIgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IC0xMC41LCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDEwLjUsIHo6IDAuOCB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTguNiwgejogNi4wLCB5YXc6IDAuMSB9LCB7IHByb3A6ICd3YWxsJywgeDogOC42LCB6OiA2LjAsIHlhdzogLTAuMSB9LCB7IHByb3A6ICd3YWxsJywgeDogLTExLjQsIHo6IC0yLjYsIHlhdzogMS40IH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAxMS40LCB6OiAtMi42LCB5YXc6IDEuNyB9LFxuICB7IHByb3A6ICdmZW5jZScsIHg6IC04LjAsIHo6IC00LjYgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNi43LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogNi43LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogOC4wLCB6OiAtNC42IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogLTMuNSwgejogLTQuNCwgeWF3OiAwLjcsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDQuMiwgejogLTQuNiwgeWF3OiAyLjUsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDkuNCwgejogMy4yLCB5YXc6IDEuMCwgczogMC42IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuNiwgejogLTMuNCwgeWF3OiAzLjYsIHM6IDAuNiB9LFxuXTtcbmNvbnN0IEdSQVZFWUFSRF9MQVlPVVQ6IFBsYWNlbWVudFtdID0gWyAgICAgIC8vIGZld2VyIGFyY2hlcywgYSBicm9rZW4gcm93IG9mIGdyYXZlc3RvbmUgcGlsbGFycywgYm9uZXMgZXZlcnl3aGVyZVxuICB7IHByb3A6ICdhcmNoJywgeDogLTkuNSwgejogNi40IH0sIHsgcHJvcDogJ2FyY2gnLCB4OiA5LjUsIHo6IDYuNCB9LFxuICB7IHByb3A6ICdwaWxsYXInLCB4OiAtMTEsIHo6IDUuMiwgeWF3OiAwLjQsIHM6IDAuOSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAtNy42LCB6OiA2LjMsIHlhdzogMi4xIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC00LjQsIHo6IDUuNiwgeWF3OiA0LjAsIHM6IDAuOCB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAtMS4yLCB6OiA2LjUsIHlhdzogMS4yIH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IDIuMiwgejogNS43LCB5YXc6IDMuMSwgczogMC45IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDUuNSwgejogNi40LCB5YXc6IDUuMCB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiA4LjIsIHo6IDUuNSwgeWF3OiAwLjksIHM6IDAuODUgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTEsIHo6IDUuMCwgeWF3OiAyLjYgfSxcbiAgeyBwcm9wOiAnYnJhemllcicsIHg6IC0xMSwgejogMC44IH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAxMSwgejogMC44IH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAwLjYsIHo6IDUuMCwgczogMC45IH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtNS42LCB6OiA2LjYsIHlhdzogMC4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAzLjgsIHo6IDYuNywgeWF3OiAtMC4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTEuNiwgejogLTIuNCwgeWF3OiAxLjUgfSxcbiAgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNC4yLCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogNC40LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogMTEuMiwgejogLTIuMiwgeWF3OiAxLjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiAtNS41LCB6OiA0LjYsIHlhdzogMC43LCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAzLjIsIHo6IDQuNCwgeWF3OiAyLjUsIHM6IDAuNyB9LCB7IHByb3A6ICdib25lcycsIHg6IDguMiwgejogMy4yLCB5YXc6IDEuMCwgczogMC42IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuMiwgejogMy40LCB5YXc6IDMuNiwgczogMC42IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogNywgejogLTQuNSwgeWF3OiAwLjMsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IC03LjQsIHo6IC00LjMsIHlhdzogNC4xLCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAwLjIsIHo6IC00LjgsIHlhdzogNS4yLCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAxMC4yLCB6OiAtMC42LCB5YXc6IDIuMCwgczogMC42IH0sXG5dO1xuY29uc3QgQkFTVElPTl9MQVlPVVQ6IFBsYWNlbWVudFtdID0gWyAgICAgICAgLy8gYSBmb3J0cmVzczogZ2F0ZXMgYmV0d2VlbiBsb25nIHdhbGxzLCBicmF6aWVycyBhbG9uZyB0aGUgYmF0dGxlbWVudHMsIGZlbmNlcyBvbiB0aGUgZmxhbmtzXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtNS44LCB6OiA2LjUsIHM6IDEuMSB9LCB7IHByb3A6ICdhcmNoJywgeDogMCwgejogNy4wLCBzOiAxLjMgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDUuOCwgejogNi41LCBzOiAxLjEgfSxcbiAgeyBwcm9wOiAnd2FsbCcsIHg6IC05LjQsIHo6IDYuMCwgczogMS4zIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMi45LCB6OiA2LjQsIHM6IDEuMiB9LCB7IHByb3A6ICd3YWxsJywgeDogMi45LCB6OiA2LjQsIHM6IDEuMiB9LCB7IHByb3A6ICd3YWxsJywgeDogOS40LCB6OiA2LjAsIHM6IDEuMyB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTEyLjIsIHo6IDIuNiwgeWF3OiAxLjU3LCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDEyLjIsIHo6IDIuNiwgeWF3OiAxLjU3LCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0xMi4yLCB6OiAtMS42LCB5YXc6IDEuNTcgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDEyLjIsIHo6IC0xLjYsIHlhdzogMS41NyB9LFxuICB7IHByb3A6ICdwaWxsYXInLCB4OiAtMTEuMiwgejogNS42LCB5YXc6IDAuNCwgczogMS4xIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDExLjIsIHo6IDUuNiwgeWF3OiAxLjIsIHM6IDEuMSB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTMuMiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAzLjIsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogLTEwLjYsIHo6IDEuMCB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogMTAuNiwgejogMS4wIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtNy4yLCB6OiAtNC42LCBzOiAwLjkgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDcuMiwgejogLTQuNiwgczogMC45IH0sXG4gIHsgcHJvcDogJ2ZlbmNlJywgeDogLTQuNiwgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC0zLjMsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAzLjMsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA0LjYsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAtMTEuNiwgejogLTMuNCwgeWF3OiAxLjUgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAxMS42LCB6OiAtMy40LCB5YXc6IDEuNSB9LFxuICB7IHByb3A6ICdib25lcycsIHg6IC0xLjUsIHo6IC00LjUsIHlhdzogMC43LCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiA5LjQsIHo6IDMuMiwgeWF3OiAxLjAsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IC05LjYsIHo6IC0zLjAsIHlhdzogMy42LCBzOiAwLjUgfSxcbl07XG5cbnR5cGUgQzMgPSBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5pbnRlcmZhY2UgVGhlbWUgeyBsYXlvdXQ6IFBsYWNlbWVudFtdOyBmbG9vcjogQzM7IGZvZzogQzM7IG1pc3Q6IEMzOyB3YWxsOiBDMzsgZmxhbWVBOiBDMzsgZmxhbWVCOiBDMzsgcnVuZTogQzMgfVxuLyoqIE9uZSBsb29rIHBlciBjYW1wYWlnbiBzdGFnZSAoaWRzIG1hdGNoIFNUQUdFUyBpbiBjb3JlL3dhdmVzLnRzKS4gVW5rbm93biBpZHMgdXNlIHRoZSBjcnlwdCBsb29rLiAqL1xuY29uc3QgVEhFTUVTOiBSZWNvcmQ8c3RyaW5nLCBUaGVtZT4gPSB7XG4gIGNyeXB0OiB7IGxheW91dDogQ1JZUFRfTEFZT1VULCBmbG9vcjogWzAuNjIsIDAuNywgMC43XSwgZm9nOiBbMC4wMiwgMC4wNSwgMC4wNl0sIG1pc3Q6IFswLjIsIDAuNiwgMC41NV0sIHdhbGw6IFswLjc1LCAwLjg1LCAwLjldLCBmbGFtZUE6IFswLjM1LCAxLCAwLjhdLCBmbGFtZUI6IFswLjEsIDAuOCwgMC42XSwgcnVuZTogWzAuMTgsIDAuODUsIDAuNjVdIH0sXG4gIGdyYXZleWFyZDogeyBsYXlvdXQ6IEdSQVZFWUFSRF9MQVlPVVQsIGZsb29yOiBbMC42MiwgMC43NCwgMC41Ml0sIGZvZzogWzAuMDMsIDAuMDUsIDAuMDI1XSwgbWlzdDogWzAuNDIsIDAuNiwgMC4yMl0sIHdhbGw6IFswLjcsIDAuODUsIDAuNjJdLCBmbGFtZUE6IFswLjc1LCAxLCAwLjRdLCBmbGFtZUI6IFswLjQsIDAuOCwgMC4yXSwgcnVuZTogWzAuNSwgMC44LCAwLjI1XSB9LFxuICBlbmRsZXNzOiB7IGxheW91dDogQ1JZUFRfTEFZT1VULCBmbG9vcjogWzAuNzgsIDAuNjIsIDAuNjhdLCBmb2c6IFswLjA2LCAwLjAyLCAwLjAzNV0sIG1pc3Q6IFswLjc1LCAwLjMsIDAuNF0sIHdhbGw6IFswLjkyLCAwLjY4LCAwLjc4XSwgZmxhbWVBOiBbMSwgMC42MiwgMC4zXSwgZmxhbWVCOiBbMC45LCAwLjI1LCAwLjE1XSwgcnVuZTogWzAuOSwgMC4zNSwgMC4zXSB9LFxuICBiYXN0aW9uOiB7IGxheW91dDogQkFTVElPTl9MQVlPVVQsIGZsb29yOiBbMC42LCAwLjYyLCAwLjldLCBmb2c6IFswLjAzLCAwLjAzLCAwLjA4XSwgbWlzdDogWzAuNCwgMC40LCAwLjg1XSwgd2FsbDogWzAuNzIsIDAuNzIsIDFdLCBmbGFtZUE6IFswLjYsIDAuNjUsIDFdLCBmbGFtZUI6IFswLjQsIDAuMywgMC45NV0sIHJ1bmU6IFswLjQ1LCAwLjQsIDAuOTVdIH0sXG59O1xuXG5cbi8qKiBCdWlsZCB0aGUgdGVhbCBzb3VsZmlyZSBvdmVyIGEgYnJhemllcjogYSBzbWFsbCBzb2Z0IGZsYW1lIHRoYXQgZmxpY2tlcnMuICovXG5mdW5jdGlvbiBmbGFtZShzY2VuZTogYW55LCB0ZXg6IGFueSwgeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlciwgazogbnVtYmVyLCBhOiBDMywgYjogQzMpOiBhbnkge1xuICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdmaXJlJywgMTgsIHNjZW5lKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGV4OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCB5LCB6KTtcbiAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMjIgKiBrLCAwLCAtMC4yMiAqIGspOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIyICogaywgMCwgMC4yMiAqIGspO1xuICBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xLCAxLCAtMC4xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xLCAxLjQsIDAuMSk7XG4gIHBzLm1pbkxpZmVUaW1lID0gMC41OyBwcy5tYXhMaWZlVGltZSA9IDEuMDsgcHMuZW1pdFJhdGUgPSAyMDsgcHMubWluU2l6ZSA9IDAuMzUgKiBrOyBwcy5tYXhTaXplID0gMC43ICogazsgcHMubWluRW1pdFBvd2VyID0gMC41ICogazsgcHMubWF4RW1pdFBvd2VyID0gMS4wICogaztcbiAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KGFbMF0sIGFbMV0sIGFbMl0sIDAuOSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNChiWzBdLCBiWzFdLCBiWzJdLCAwLjgpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoYlswXSAqIDAuMSwgYlsxXSAqIDAuMywgYlsyXSAqIDAuMywgMCk7XG4gIHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTsgcHMuc3RhcnQoKTsgcmV0dXJuIHBzO1xufVxuXG4vKiogU29mdCByb3VuZCBibG9iIHVzZWQgZm9yIHRoZSBmbGFtZXMuICovXG5mdW5jdGlvbiBnbG93VGV4dHVyZShzY2VuZTogYW55KTogYW55IHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdnbG93JywgeyB3aWR0aDogNjQsIGhlaWdodDogNjQgfSwgc2NlbmUsIHRydWUpLCBjID0gdC5nZXRDb250ZXh0KCksIGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KDMyLCAzMiwgMCwgMzIsIDMyLCAzMik7XG4gIGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDEpJyk7IGcuYWRkQ29sb3JTdG9wKDAuNCwgJ3JnYmEoMjU1LDI1NSwyNTUsMC40NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcbiAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IHQudXBkYXRlKCk7IHQuaGFzQWxwaGEgPSB0cnVlOyByZXR1cm4gdDtcbn1cblxuLyoqIExvYWQgdGhlIHByb3Aga2l0IG9uY2U7IGFwcGx5KHRoZW1lKSB0aGVuIHN0YW5kcyBjb3BpZXMgb2YgZWFjaCBwaWVjZSBhcm91bmQgdGhlIGZpZWxkICh0aGV5IHNoYXJlIG9uZSBtZXNoIGFuZCBvbmUgdGV4dHVyZSwgc28gdGhleSBjb3N0IGFsbW9zdCBub3RoaW5nKS4gKi9cbmFzeW5jIGZ1bmN0aW9uIGxvYWRLaXQoc2NlbmU6IGFueSk6IFByb21pc2U8eyBhcHBseSh0OiBUaGVtZSk6IHZvaWQgfT4ge1xuICBjb25zdCBib3ggPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvYXJlbmEvJywgJ3Byb3BzLmdsYicsIHNjZW5lKTtcbiAgYm94LmFkZEFsbFRvU2NlbmUoKTtcbiAgY29uc3Qgcm9vdCA9IGJveC5tZXNoZXMuZmluZCgobTogYW55KSA9PiBtLm5hbWUgPT09ICdfX3Jvb3RfXycpLCBzcmM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgZm9yIChjb25zdCBtIG9mIGJveC5tZXNoZXMpIGlmIChtLm5hbWUgIT09ICdfX3Jvb3RfXycgJiYgbS5nZXRUb3RhbFZlcnRpY2VzKCkgPiAwKSB7IHNyY1ttLm5hbWVdID0gbTsgbS5zZXRFbmFibGVkKGZhbHNlKTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgY29uc3QgZ2xvdyA9IGdsb3dUZXh0dXJlKHNjZW5lKTsgbGV0IG1hZGU6IHsgaG9sZGVyczogYW55W107IGZpcmVzOiBhbnlbXSB9ID0geyBob2xkZXJzOiBbXSwgZmlyZXM6IFtdIH0sIG4gPSAwO1xuICByZXR1cm4ge1xuICAgIGFwcGx5KHQ6IFRoZW1lKSB7XG4gICAgICBmb3IgKGNvbnN0IGggb2YgbWFkZS5ob2xkZXJzKSBoLmRpc3Bvc2UoKTsgZm9yIChjb25zdCBmIG9mIG1hZGUuZmlyZXMpIGYuZGlzcG9zZShmYWxzZSk7ICAgLy8gZmFsc2U6IGtlZXAgdGhlIHNoYXJlZCBnbG93IHRleHR1cmUgbWFkZSA9IHsgaG9sZGVyczogW10sIGZpcmVzOiBbXSB9O1xuICAgICAgZm9yIChjb25zdCBwIG9mIHQubGF5b3V0KSB7XG4gICAgICAgIGNvbnN0IGJhc2UgPSBzcmNbcC5wcm9wXTsgaWYgKCFiYXNlKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgaW5zdCA9IGJhc2UuY3JlYXRlSW5zdGFuY2UocC5wcm9wICsgbisrKTsgaW5zdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgICAgIGluc3Qucm90YXRpb25RdWF0ZXJuaW9uID0gcm9vdC5yb3RhdGlvblF1YXRlcm5pb24/LmNsb25lKCkgPz8gbnVsbDsgaWYgKCFpbnN0LnJvdGF0aW9uUXVhdGVybmlvbikgaW5zdC5yb3RhdGlvbiA9IHJvb3Qucm90YXRpb24uY2xvbmUoKTsgaW5zdC5zY2FsaW5nID0gcm9vdC5zY2FsaW5nLmNsb25lKCk7XG4gICAgICAgIGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2hvbGRlcicgKyBuLCBzY2VuZSk7IGhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyBob2xkZXIucm90YXRpb24ueSA9IHAueWF3ID8/IDA7IGhvbGRlci5zY2FsaW5nLnNldEFsbChwLnMgPz8gMSk7XG4gICAgICAgIGluc3QucGFyZW50ID0gaG9sZGVyOyBtYWRlLmhvbGRlcnMucHVzaChob2xkZXIpO1xuICAgICAgICBpZiAocC5wcm9wID09PSAnYnJhemllcicpIG1hZGUuZmlyZXMucHVzaChmbGFtZShzY2VuZSwgZ2xvdywgcC54LCAxLjI1ICogKHAucyA/PyAxKSwgcC56LCBwLnMgPz8gMSwgdC5mbGFtZUEsIHQuZmxhbWVCKSk7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQXJlbmEoc2NlbmU6IGFueSwgZ3JvdW5kOiBhbnkpOiB7IHVwZGF0ZSh0OiBudW1iZXIpOiB2b2lkOyBzZXRUaGVtZShzdGFnZTogc3RyaW5nKTogdm9pZCB9IHtcbiAgLy8gLS0tLSBmbG9vclxuICBjb25zdCB0ZXggPSBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvYXJlbmEvZmxvb3Iud2VicCcsIHNjZW5lLCBmYWxzZSwgdHJ1ZSwgQkFCWUxPTi5UZXh0dXJlLlRSSUxJTkVBUl9TQU1QTElOR01PREUpO1xuICB0ZXgudVNjYWxlID0gNjAgLyBUSUxFX01FVFJFUzsgdGV4LnZTY2FsZSA9IDQwIC8gVElMRV9NRVRSRVM7IHRleC5hbmlzb3Ryb3BpY0ZpbHRlcmluZ0xldmVsID0gNDtcbiAgY29uc3QgZ20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdnbScsIHNjZW5lKTsgZ20uZGlmZnVzZVRleHR1cmUgPSB0ZXg7IGdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpO1xuICBnbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC42MiwgMC43LCAwLjcpOyBncm91bmQubWF0ZXJpYWwgPSBnbTtcblxuICAvLyAtLS0tIHJ1bmUgY2lyY2xlIGluIHRoZSBtaWRkbGUgb2YgdGhlIGZpZWxkXG4gIGNvbnN0IGRlY2FsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ3J1bmVzJywgeyB3aWR0aDogNS4yLCBoZWlnaHQ6IDUuMiB9LCBzY2VuZSk7XG4gIGRlY2FsLnBvc2l0aW9uLnkgPSAwLjAxMjsgZGVjYWwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICBjb25zdCBybSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3JtJywgc2NlbmUpOyBybS5kaWZmdXNlVGV4dHVyZSA9IHJ1bmVUZXh0dXJlKHNjZW5lKTsgcm0uZGlmZnVzZVRleHR1cmUuaGFzQWxwaGEgPSB0cnVlOyBybS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7XG4gIHJtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xOCwgMC44NSwgMC42NSk7IHJtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHJtLmFscGhhID0gMC41NTsgcm0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IGRlY2FsLm1hdGVyaWFsID0gcm07XG5cbiAgLy8gLS0tLSBkYXJrIHRlYWwgc3Vycm91bmQgdGhhdCBzd2FsbG93cyB0aGUgZmFyIGVkZ2Ugb2YgdGhlIGZsb29yXG4gIHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wMiwgMC4wNSwgMC4wNiwgMSk7XG4gIHNjZW5lLmZvZ01vZGUgPSBCQUJZTE9OLlNjZW5lLkZPR01PREVfTElORUFSOyBzY2VuZS5mb2dDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAyLCAwLjA1LCAwLjA2KTsgc2NlbmUuZm9nU3RhcnQgPSAyNDsgc2NlbmUuZm9nRW5kID0gNTY7XG5cbiAgY29uc3QgY2F2ZSA9IGJ1aWxkQ2F2ZShzY2VuZSwgdGV4KTtcbiAgbGV0IGtpdDogeyBhcHBseSh0OiBUaGVtZSk6IHZvaWQgfSB8IG51bGwgPSBudWxsLCB3YW50ID0gJ2NyeXB0Jywgc2hvd24gPSAnJztcbiAgY29uc3Qgc2hvdyA9ICgpID0+IHtcbiAgICBjb25zdCB0ID0gVEhFTUVTW3dhbnRdID8/IFRIRU1FUy5jcnlwdDsgaWYgKHdhbnQgPT09IHNob3duICYmIGtpdCkgcmV0dXJuO1xuICAgIGNvbnN0IGNvbCA9IChjOiBDMykgPT4gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pO1xuICAgIGdtLmRpZmZ1c2VDb2xvciA9IGNvbCh0LmZsb29yKTsgY2F2ZS53YWxsTWF0LmRpZmZ1c2VDb2xvciA9IGNvbCh0LndhbGwpOyBybS5lbWlzc2l2ZUNvbG9yID0gY29sKHQucnVuZSk7XG4gICAgZm9yIChjb25zdCBtIG9mIGNhdmUubWlzdE1hdHMpIG0uZW1pc3NpdmVDb2xvciA9IGNvbCh0Lm1pc3QpO1xuICAgIHNjZW5lLmZvZ0NvbG9yID0gY29sKHQuZm9nKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCh0LmZvZ1swXSwgdC5mb2dbMV0sIHQuZm9nWzJdLCAxKTtcbiAgICBpZiAoa2l0KSB7IGtpdC5hcHBseSh0KTsgc2hvd24gPSB3YW50OyB9XG4gIH07XG4gIGxvYWRLaXQoc2NlbmUpLnRoZW4oKGspID0+IHsga2l0ID0gazsgc2hvd24gPSAnJzsgc2hvdygpOyB9KS5jYXRjaCgoZSkgPT4gY29uc29sZS53YXJuKCdhcmVuYSBwcm9wcyBmYWlsZWQnLCBlKSk7XG5cbiAgcmV0dXJuIHsgdXBkYXRlOiAodDogbnVtYmVyKSA9PiB7IHJtLmFscGhhID0gMC40NSArIDAuMTUgKiBNYXRoLnNpbih0ICogMS40KTsgY2F2ZS51cGRhdGUodCk7IH0sIHNldFRoZW1lOiAoc3RhZ2U6IHN0cmluZykgPT4geyB3YW50ID0gc3RhZ2U7IHNob3coKTsgfSB9O1xufVxuXG4vLyAtLS0tIHRoZSBjYXZlOiBhIHJvdWdoIHN0b25lIHdhbGwgYWxsIHRoZSB3YXkgcm91bmQsIHJvY2sgc3BpcmVzIGFsb25nIGl0cyBmb290LCBkcmlmdGluZyBtaXN0LCBhbmQgYSBkYXJrIHZpZ25ldHRlIG9uIHRoZSBmbG9vclxuY29uc3QgUlggPSAyMCwgUlogPSAxNSwgQ1ogPSAtNCwgV0FMTF9IID0gMTY7ICAgLy8gb3ZhbCByaW5nIGNlbnRyZWQgYSBsaXR0bGUgYmVoaW5kIHRoZSBmaWVsZDogdGhlIGZhciB3YWxsIHN0YW5kcyBhYm91dCAxMSBtIHBhc3QgdGhlIGNlbnRyZVxuY29uc3Qgd29iYmxlID0gKGE6IG51bWJlciwgeTogbnVtYmVyKTogbnVtYmVyID0+IE1hdGguc2luKDMgKiBhICsgMS4zKSAqIDAuNSArIE1hdGguc2luKDcgKiBhICsgeSAqIDAuNSkgKiAwLjMgKyBNYXRoLnNpbigxMyAqIGEgLSB5ICogMC4zNSkgKiAwLjIgKyBNYXRoLnNpbigyMyAqIGEgKyB5KSAqIDAuMDg7XG5cbmZ1bmN0aW9uIG1pc3RUZXh0dXJlKHNjZW5lOiBhbnksIHNlZWQ6IG51bWJlcik6IGFueSB7XG4gIGNvbnN0IFMgPSAyNTYsIHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnbWlzdCcgKyBzZWVkLCB7IHdpZHRoOiBTLCBoZWlnaHQ6IFMgfSwgc2NlbmUsIHRydWUpLCBjID0gdC5nZXRDb250ZXh0KCk7XG4gIGMuY2xlYXJSZWN0KDAsIDAsIFMsIFMpO1xuICBsZXQgciA9IHNlZWQgKiA5MzAxICsgNDkyOTc7IGNvbnN0IHJuZCA9ICgpID0+IChyID0gKHIgKiA5MzAxICsgNDkyOTcpICUgMjMzMjgwKSAvIDIzMzI4MDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0NjsgaSsrKSB7XG4gICAgY29uc3QgeCA9IHJuZCgpICogUywgeSA9IHJuZCgpICogUywgcmFkID0gMjYgKyBybmQoKSAqIDQ2O1xuICAgIGZvciAoY29uc3QgZHggb2YgWy1TLCAwLCBTXSkgZm9yIChjb25zdCBkeSBvZiBbLVMsIDAsIFNdKSB7ICAgICAgICAgIC8vIGRyYXcgd3JhcHBlZCBjb3BpZXMgc28gdGhlIHBpY3R1cmUgdGlsZXMgd2l0aCBubyBzZWFtXG4gICAgICBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCh4ICsgZHgsIHkgKyBkeSwgMCwgeCArIGR4LCB5ICsgZHksIHJhZCk7IGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDAuNSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcbiAgICAgIGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCBTLCBTKTtcbiAgICB9XG4gIH1cbiAgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IHRydWU7IHQud3JhcFUgPSB0LndyYXBWID0gQkFCWUxPTi5UZXh0dXJlLldSQVBfQUREUkVTU01PREU7IHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBidWlsZENhdmUoc2NlbmU6IGFueSwgZmxvb3JUZXg6IGFueSk6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHdhbGxNYXQ6IGFueTsgbWlzdE1hdHM6IGFueVtdIH0ge1xuICAvLyByb3VnaCB3YWxsOiBhbiBvdmFsIHJpbmcgd2hvc2UgcmFkaXVzIHdvYmJsZXMgd2l0aCBhbmdsZSBhbmQgaGVpZ2h0LCBkYXJrZXIgdGhlIGhpZ2hlciBpdCBnb2VzXG4gIGNvbnN0IE4gPSAxMjAsIE0gPSAxMiwgcG9zOiBudW1iZXJbXSA9IFtdLCB1djogbnVtYmVyW10gPSBbXSwgY29sOiBudW1iZXJbXSA9IFtdLCBpZHg6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGogPSAwOyBqIDw9IE07IGorKykgZm9yIChsZXQgaSA9IDA7IGkgPD0gTjsgaSsrKSB7XG4gICAgY29uc3QgYSA9IChpIC8gTikgKiBNYXRoLlBJICogMiwgaCA9IChqIC8gTSkgKiBXQUxMX0gsIGsgPSAxICsgMC4wNiAqIHdvYmJsZShhLCBoKSArIChqID09PSAwID8gMCA6IDAuMDUgKiBNYXRoLnNpbihhICogNSArIGopKTtcbiAgICBjb25zdCBvdmVyaGFuZyA9IDEgLSAwLjEgKiBNYXRoLnNpbigoaiAvIE0pICogTWF0aC5QSSk7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gbGVhbnMgaW4gYSBsaXR0bGUgc28gaXQgZmVlbHMgbGlrZSBhIGNhdmVyblxuICAgIHBvcy5wdXNoKE1hdGguY29zKGEpICogUlggKiBrICogb3ZlcmhhbmcsIGgsIENaICsgTWF0aC5zaW4oYSkgKiBSWiAqIGsgKiBvdmVyaGFuZyk7IHV2LnB1c2goKGkgLyBOKSAqIDE0LCAoaiAvIE0pICogMy4yKTtcbiAgICBjb25zdCBiID0gTWF0aC5tYXgoMC4wNiwgMS4wIC0gKGogLyBNKSAqIDAuOSk7IGNvbC5wdXNoKGIgKiAwLjgsIGIsIGIsIDEpO1xuICB9XG4gIGZvciAobGV0IGogPSAwOyBqIDwgTTsgaisrKSBmb3IgKGxldCBpID0gMDsgaSA8IE47IGkrKykgeyBjb25zdCBhID0gaiAqIChOICsgMSkgKyBpLCBiID0gYSArIDEsIGMgPSBhICsgTiArIDEsIGQgPSBjICsgMTsgaWR4LnB1c2goYSwgYywgYiwgYiwgYywgZCk7IH1cbiAgY29uc3Qgd2FsbCA9IG5ldyBCQUJZTE9OLk1lc2goJ2NhdmUnLCBzY2VuZSksIHZkID0gbmV3IEJBQllMT04uVmVydGV4RGF0YSgpOyB2ZC5wb3NpdGlvbnMgPSBwb3M7IHZkLmluZGljZXMgPSBpZHg7IHZkLnV2cyA9IHV2OyB2ZC5jb2xvcnMgPSBjb2w7XG4gIGNvbnN0IG5ybTogbnVtYmVyW10gPSBbXTsgQkFCWUxPTi5WZXJ0ZXhEYXRhLkNvbXB1dGVOb3JtYWxzKHBvcywgaWR4LCBucm0pOyB2ZC5ub3JtYWxzID0gbnJtOyB2ZC5hcHBseVRvTWVzaCh3YWxsKTtcbiAgY29uc3Qgd20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdjYXZlbScsIHNjZW5lKTsgd20uZGlmZnVzZVRleHR1cmUgPSBmbG9vclRleC5jbG9uZSgpOyB3bS5kaWZmdXNlVGV4dHVyZS51U2NhbGUgPSAxOyB3bS5kaWZmdXNlVGV4dHVyZS52U2NhbGUgPSAxO1xuICB3bS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgd20uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IHdtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjg1LCAwLjkpOyB3YWxsLm1hdGVyaWFsID0gd207IHdhbGwuaXNQaWNrYWJsZSA9IGZhbHNlOyB3YWxsLnVzZVZlcnRleENvbG9ycyA9IHRydWU7IHdtLnVzZVZlcnRleENvbG9yID0gdHJ1ZTtcbiAgLy8gcm9jayBzcGlyZXMgc3RhbmRpbmcgYWxvbmcgdGhlIGZvb3Qgb2YgdGhlIHdhbGwgKG9uZSBzaGFyZWQgbWVzaCwgbWFueSBjb3BpZXMpXG4gIGNvbnN0IHNwaXJlID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignc3BpcmUnLCB7IGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogMS42LCBoZWlnaHQ6IDEsIHRlc3NlbGxhdGlvbjogNSB9LCBzY2VuZSk7XG4gIGNvbnN0IHNtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnc3BpcmVtJywgc2NlbmUpOyBzbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4wMywgMC4wNDUsIDAuMDU1KTsgc20uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHNtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4wMDQsIDAuMDEyLCAwLjAxNCk7IHNwaXJlLm1hdGVyaWFsID0gc207XG4gIHNwaXJlLmNvbnZlcnRUb0ZsYXRTaGFkZWRNZXNoKCk7IHNwaXJlLnNldEVuYWJsZWQoZmFsc2UpOyBzcGlyZS5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGxldCByID0gMTIzNDU7IGNvbnN0IHJuZCA9ICgpID0+IChyID0gKHIgKiA5MzAxICsgNDkyOTcpICUgMjMzMjgwKSAvIDIzMzI4MDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0NjsgaSsrKSB7XG4gICAgY29uc3QgYSA9IChpIC8gNDYpICogTWF0aC5QSSAqIDIgKyAocm5kKCkgLSAwLjUpICogMC4xMiwgZCA9IDAuODYgKyBybmQoKSAqIDAuMSwgaGd0ID0gMS40ICsgcm5kKCkgKiAzLjIsIHcgPSAwLjcgKyBybmQoKSAqIDEuMDtcbiAgICBjb25zdCBzID0gc3BpcmUuY3JlYXRlSW5zdGFuY2UoJ3NwJyArIGkpOyBzLmlzUGlja2FibGUgPSBmYWxzZTsgcy5wb3NpdGlvbi5zZXQoTWF0aC5jb3MoYSkgKiBSWCAqIGQsIGhndCAvIDIgLSAwLjIsIENaICsgTWF0aC5zaW4oYSkgKiBSWiAqIGQpO1xuICAgIHMuc2NhbGluZy5zZXQodywgaGd0LCB3KTsgcy5yb3RhdGlvbi55ID0gcm5kKCkgKiA2OyBzLnJvdGF0aW9uLnogPSAocm5kKCkgLSAwLjUpICogMC4xODtcbiAgfVxuICAvLyBtaXN0OiB0d28gc2xvdyBsYXllcnMganVzdCBhYm92ZSB0aGUgZmxvb3JcbiAgY29uc3QgbGF5ZXJzID0gWzAuMjgsIDAuNzVdLm1hcCgoeSwgbikgPT4ge1xuICAgIGNvbnN0IHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgnbWlzdCcgKyBuLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0NCB9LCBzY2VuZSk7IHAucG9zaXRpb24ueSA9IHk7IHAuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdtaXN0bScgKyBuLCBzY2VuZSksIHQgPSBtaXN0VGV4dHVyZShzY2VuZSwgbiArIDMpOyB0LnVTY2FsZSA9IDUgLSBuOyB0LnZTY2FsZSA9IDMuNCAtIG4gKiAwLjY7XG4gICAgbS5kaWZmdXNlVGV4dHVyZSA9IHQ7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4yLCAwLjYsIDAuNTUpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYWxwaGEgPSAwLjE1IC0gbiAqIDAuMDY7IG0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7XG4gICAgbS5kaXNhYmxlRGVwdGhXcml0ZSA9IHRydWU7IHAubWF0ZXJpYWwgPSBtOyBwLmFscGhhSW5kZXggPSA1ICsgbjsgcmV0dXJuIHsgdCwgbiwgbSB9O1xuICB9KTtcbiAgLy8gdmlnbmV0dGU6IGRhcmtlbnMgdGhlIGZsb29yIHRvd2FyZCB0aGUgZWRnZXMgc28gdGhlIGZpZWxkIGxvb2tzIGxpa2UgYSBsaXQgcG9vbCBpbnNpZGUgdGhlIGNhdmVcbiAgY29uc3QgdnQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgndmlnJywgeyB3aWR0aDogMjU2LCBoZWlnaHQ6IDI1NiB9LCBzY2VuZSwgdHJ1ZSksIHZjID0gdnQuZ2V0Q29udGV4dCgpLCBnID0gdmMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMTI4LCAxMjgsIDAsIDEyOCwgMTI4LCAxMjgpO1xuICBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgwLDAsMCwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjQyLCAncmdiYSgwLDAsMCwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjgsICdyZ2JhKDAsNCw2LDAuNyknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMCw0LDYsMC45NSknKTtcbiAgdmMuZmlsbFN0eWxlID0gZzsgdmMuZmlsbFJlY3QoMCwgMCwgMjU2LCAyNTYpOyB2dC51cGRhdGUoKTsgdnQuaGFzQWxwaGEgPSB0cnVlO1xuICBjb25zdCB2aWcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgndmlnJywgeyB3aWR0aDogNDYsIGhlaWdodDogMzAgfSwgc2NlbmUpOyB2aWcucG9zaXRpb24ueSA9IDAuMDM7IHZpZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGNvbnN0IHZtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndmlnbScsIHNjZW5lKTsgdm0uZGlmZnVzZVRleHR1cmUgPSB2dDsgdm0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB2bS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB2bS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAsIDAuMDEsIDAuMDE1KTsgdm0uZGlzYWJsZURlcHRoV3JpdGUgPSB0cnVlOyB2aWcubWF0ZXJpYWwgPSB2bTsgdmlnLmFscGhhSW5kZXggPSAxO1xuICByZXR1cm4geyB3YWxsTWF0OiB3bSwgbWlzdE1hdHM6IGxheWVycy5tYXAoKGwpID0+IGwubSksIHVwZGF0ZTogKHQ6IG51bWJlcikgPT4geyBmb3IgKGNvbnN0IGwgb2YgbGF5ZXJzKSB7IGwudC51T2Zmc2V0ID0gdCAqICgwLjAwNiArIGwubiAqIDAuMDA0KTsgbC50LnZPZmZzZXQgPSB0ICogMC4wMDMgKiAobC5uID8gLTEgOiAxKTsgfSB9IH07XG59XG4iLCAiLy8gRW5kbGVzcyBEZXB0aHM6IGVuZW15IHdhdmVzIGJ1aWx0IGZyb20gYSBCVURHRVQgaW5zdGVhZCBvZiBhIGhhbmQtd3JpdHRlbiBsaXN0LCBzbyB0aGUgbW9kZSBuZXZlciBydW5zIG91dCBvZiB3YXZlcy5cbi8vIFRoZSBidWRnZXQgaXMgdGhlIGVuZW15IHRlYW0ncyB0b3RhbCBEb21pbmlvbiBjb3N0ICh0aGUgc2FtZSBDT1NUIHRhYmxlIHRoZSBwbGF5ZXIgcGF5cyBmcm9tKS4gV2F2ZXMgYXJlIGJ1aWx0IGZyb20gcm9sZSBURU1QTEFURVMgc28gdGhleVxuLy8gbG9vayBkZXNpZ25lZCAoYSBmcm9udCBsaW5lIHdpdGggYXJjaGVycyBiZWhpbmQsIGEgc3dhcm0sIGEgYnJ1dGUgc3F1YWQpIGluc3RlYWQgb2YgYSByYW5kb20gcGlsZS4gRXZlcnl0aGluZyBpcyBzZWVkZWQ6IHRoZSBzYW1lIHNlZWQgZ2l2ZXNcbi8vIHRoZSBzYW1lIHdhdmVzLCBzbyBhIHJldHJ5IChvciBhIGRhaWx5IHNlZWQpIGZhY2VzIGV4YWN0bHkgdGhlIHNhbWUgYXJteS5cbi8vXG4vLyBUaGUgcGxheWVyJ3MgYXJteSBpcyBjYXBwZWQgb24gcHVycG9zZSAoRG9taW5pb24gc3RvcHMgYXQgNDAsIHRoZSBncmlkIGhvbGRzIDEyKSwgc28gYXQgc29tZSBwb2ludCB0aGUgZW5lbXkgc2ltcGx5IG91dC1zY2FsZXMgaXQ6IHRoYXQgaXMgdGhlXG4vLyBcImhhcmQgd2FsbFwiLiBPbmNlIHRoZSBidWRnZXQgZmlsbHMgdGhlIDEyIHNsb3RzIHdpdGggdXBncmFkZWQgdW5pdHMsIGBlbmRsZXNzUG93ZXJgICh0aGUgaGlkZGVuIGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllcikga2VlcHMgY2xpbWJpbmcuXG4vLyBOdW1iZXJzIGhlcmUgYXJlIHR1bmVkIHdpdGggc2ltL2VuZGxlc3NfY3VydmUudHMuXG5cbmltcG9ydCB7IENPU1QgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgRW5lbXlTcGVjIH0gZnJvbSAnLi93YXZlcy50cyc7XG5pbXBvcnQgeyBib3NzRXh0cmFDb3N0IH0gZnJvbSAnLi93YXZlcy50cyc7XG5cbmV4cG9ydCBjb25zdCBFTkRMRVNTX0lEID0gJ2VuZGxlc3MnO1xuLyoqIEEgcGFjayBpcyBncmFudGVkIGV2ZXJ5IHRoaXMtbWFueSB3YXZlcyBjbGVhcmVkIGluIGFuIGVuZGxlc3MgcnVuLiAqL1xuZXhwb3J0IGNvbnN0IEVORExFU1NfUEFDS19FVkVSWSA9IDEwO1xuY29uc3QgTUFYX1VOSVRTID0gMTI7XG5cbi8qKiBUaGUgdHVuaW5nIGtub2JzIChzaW0vZW5kbGVzc19jdXJ2ZS50cyBzd2VlcHMgdGhlbSkuICovXG5leHBvcnQgY29uc3QgVFVORSA9IHsgc3RhcnQ6IDUsIHNsb3BlOiAzLjAsIGxhdGVTbG9wZTogMC44LCBtYXhCdWRnZXQ6IDE1MCwgcG93ZXJTbG9wZTogMC4wMTIsIGNoYW1waW9uOiAxLjAgfTtcbi8qKiBUb3RhbCBEb21pbmlvbiBjb3N0IG9mIHRoZSBlbmVteSB0ZWFtIGF0IHdhdmUgYG5gICgxLWJhc2VkKTogYSBnZW50bGUgc3RhcnQgKGFib3V0IHRoZSBOb3JtYWwgY2FtcGFpZ24gYnkgd2F2ZSAxMCksIHRoZW4gaXQga2VlcHMgcmlzaW5nLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NCdWRnZXQobjogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDEsIG4pLCBlYXJseSA9IFRVTkUuc3RhcnQgKyBUVU5FLnNsb3BlICogKE1hdGgubWluKHcsIDEwKSAtIDEpO1xuICByZXR1cm4gTWF0aC5yb3VuZChNYXRoLm1pbihUVU5FLm1heEJ1ZGdldCwgZWFybHkgKyAodyA+IDEwID8gVFVORS5sYXRlU2xvcGUgKiAodyAtIDEwKSA6IDApKSk7XG59XG4vKiogSGlkZGVuIGVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllcjogMS4wIHRocm91Z2ggd2F2ZSAxMCwgdGhlbiByaXNpbmc7IGV2ZXJ5IDEwdGggKGNoYW1waW9uKSB3YXZlIGdldHMgYSBsaXR0bGUgZXh0cmEuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc1Bvd2VyKG46IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHcgPSBNYXRoLm1heCgxLCBuKSwgYmFzZSA9IHcgPD0gMTAgPyAxIDogMSArIFRVTkUucG93ZXJTbG9wZSAqICh3IC0gMTApO1xuICByZXR1cm4gKyh3ICUgMTAgPT09IDAgPyBiYXNlICogVFVORS5jaGFtcGlvbiA6IGJhc2UpLnRvRml4ZWQoMyk7XG59XG4vKiogUGFjayB0aWVyIGZvciBjbGVhcmluZyB3YXZlIGBuYCAob25seSBtZWFuaW5nZnVsIHdoZW4gbiBpcyBhIG11bHRpcGxlIG9mIEVORExFU1NfUEFDS19FVkVSWSkuICovXG5leHBvcnQgY29uc3QgZW5kbGVzc1BhY2tUaWVyID0gKG46IG51bWJlcik6IG51bWJlciA9PiAobiA+PSAzMCA/IDMgOiBuID49IDIwID8gMiA6IDEpO1xuXG50eXBlIFJvbGUgPSAndGFuaycgfCAnYnJ1dGUnIHwgJ3JhbmdlZCcgfCAnZm9kZGVyJztcbmNvbnN0IFJPTEU6IFJlY29yZDxSb2xlLCBTb3VsSWRbXT4gPSB7IHRhbms6IFsna25pZ2h0JywgJ29ncmUnXSwgYnJ1dGU6IFsnYmFyYmFyaWFuJywgJ29ncmUnXSwgcmFuZ2VkOiBbJ2FyY2hlciddLCBmb2RkZXI6IFsnd2FycmlvcicsICdnb2JsaW4nXSB9O1xuZXhwb3J0IGludGVyZmFjZSBUZW1wbGF0ZSB7IGlkOiBzdHJpbmc7IG1peDogW1JvbGUsIG51bWJlcl1bXSB9XG5leHBvcnQgY29uc3QgVEVNUExBVEVTOiBUZW1wbGF0ZVtdID0gW1xuICB7IGlkOiAnd2FsbCcsIG1peDogW1sndGFuaycsIDNdLCBbJ3JhbmdlZCcsIDJdLCBbJ2ZvZGRlcicsIDFdXSB9LFxuICB7IGlkOiAnc3dhcm0nLCBtaXg6IFtbJ2ZvZGRlcicsIDVdLCBbJ3JhbmdlZCcsIDFdLCBbJ3RhbmsnLCAxXV0gfSxcbiAgeyBpZDogJ2JydXRlcycsIG1peDogW1snYnJ1dGUnLCA0XSwgWydmb2RkZXInLCAxXSwgWydyYW5nZWQnLCAxXV0gfSxcbiAgeyBpZDogJ21peGVkJywgbWl4OiBbWyd0YW5rJywgMV0sIFsnYnJ1dGUnLCAxXSwgWydyYW5nZWQnLCAxXSwgWydmb2RkZXInLCAyXV0gfSxcbl07XG5cbi8qKiBXYXZlcyAxLTIgYXJlIGEgZ2VudGxlIHdhcm0tdXA6IGNoZWFwIGZvZGRlciAoYW5kIGFuIGFyY2hlciksIG5vIHRhbmtzIG9yIGJydXRlcywgc28gbm9ib2R5IGxvc2VzIGEgaGVhcnQgdG8gdGhlIGZpcnN0IGZpZ2h0LiAqL1xuY29uc3QgV0FSTVVQOiBUZW1wbGF0ZSA9IHsgaWQ6ICd3YXJtdXAnLCBtaXg6IFtbJ2ZvZGRlcicsIDNdLCBbJ3JhbmdlZCcsIDFdXSB9O1xuLyoqIFdoaWNoIHRlbXBsYXRlIGEgd2F2ZSB1c2VzIChzZWVkZWQgcGVyIHdhdmUsIHNvIGl0IGRvZXMgbm90IGRlcGVuZCBvbiB3aGF0IGNhbWUgYmVmb3JlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzVGVtcGxhdGUobjogbnVtYmVyLCBzZWVkOiBudW1iZXIpOiBUZW1wbGF0ZSB7XG4gIGlmIChuIDw9IDIpIHJldHVybiBXQVJNVVA7XG4gIHJldHVybiBURU1QTEFURVNbTWF0aC5mbG9vcihtYWtlUm5nKHNlZWQgKiA0MDk5ICsgbiAqIDMxICsgNSkubmV4dCgpICogVEVNUExBVEVTLmxlbmd0aCldO1xufVxuXG4vKiogVGhlIGVuZW15IGFybXkgZm9yIGVuZGxlc3Mgd2F2ZSBgbmAgKDEtYmFzZWQpLiBBdCBtb3N0IDEyIHVuaXRzOyB0aGUgd2hvbGUgYnVkZ2V0IGlzIHNwZW50IHVubGVzcyBubyB1bml0IGZpdHMgd2hhdCBpcyBsZWZ0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NXYXZlKG46IG51bWJlciwgc2VlZCA9IDApOiBFbmVteVNwZWNbXSB7XG4gIGNvbnN0IHdhdmUgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKG4pKSwgcm5nID0gbWFrZVJuZyhzZWVkICogMTAwOSArIHdhdmUgKiA3OTE5ICsgMTcpLCB0cGwgPSBlbmRsZXNzVGVtcGxhdGUod2F2ZSwgc2VlZCk7XG4gIGxldCBsZWZ0ID0gZW5kbGVzc0J1ZGdldCh3YXZlKTsgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgaWYgKHdhdmUgJSAxMCA9PT0gMCAmJiBsZWZ0ID49IDIwKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjaGFtcGlvbiB3YXZlOiBvbmUgc3RhcnJlZCBicnV0ZSB1cCBmcm9udCAoMiBzdGFycywgMyBmcm9tIHdhdmUgNDApLCB0aGVuIHRoZSB1c3VhbCBlc2NvcnRcbiAgICBjb25zdCBzb3VsOiBTb3VsSWQgPSBybmcubmV4dCgpIDwgMC41ID8gJ29ncmUnIDogJ2tuaWdodCcsIHN0YXIgPSB3YXZlID49IDQwID8gMyA6IDI7IGFybXkucHVzaCh7IHNvdWwsIHN0YXIsIGJvc3M6IHRydWUgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVtzdGFyIC0gMV0gKyBNYXRoLnJvdW5kKGJvc3NFeHRyYUNvc3QoQ09TVFtzb3VsXVtzdGFyIC0gMV0pKTsgICAvLyB0aGUgYm9zcyBwYXlzIGZvciBpdHMgZXh0cmEgc3RyZW5ndGggb3V0IG9mIHRoZSBlc2NvcnQgYnVkZ2V0XG4gIH1cbiAgY29uc3QgdG90YWwgPSB0cGwubWl4LnJlZHVjZSgoYSwgWywgd10pID0+IGEgKyB3LCAwKTtcbiAgZm9yIChsZXQgZ3VhcmQgPSAwOyBndWFyZCA8IDgwICYmIGFybXkubGVuZ3RoIDwgTUFYX1VOSVRTICYmIGxlZnQgPj0gMjsgZ3VhcmQrKykge1xuICAgIGxldCByID0gcm5nLm5leHQoKSAqIHRvdGFsLCByb2xlOiBSb2xlID0gdHBsLm1peFswXVswXTtcbiAgICBmb3IgKGNvbnN0IFtybywgd10gb2YgdHBsLm1peCkgeyByIC09IHc7IGlmIChyIDw9IDApIHsgcm9sZSA9IHJvOyBicmVhazsgfSB9XG4gICAgbGV0IG9wdGlvbnMgPSBST0xFW3JvbGVdLmZpbHRlcigocykgPT4gQ09TVFtzXVswXSA8PSBsZWZ0KTtcbiAgICBpZiAoIW9wdGlvbnMubGVuZ3RoKSBvcHRpb25zID0gUk9MRS5mb2RkZXIuZmlsdGVyKChzKSA9PiBDT1NUW3NdWzBdIDw9IGxlZnQpO1xuICAgIGlmICghb3B0aW9ucy5sZW5ndGgpIGJyZWFrO1xuICAgIGNvbnN0IHNvdWwgPSBybmcucGljayhvcHRpb25zKSwgcGVyID0gbGVmdCAvIE1hdGgubWF4KDEsIE1BWF9VTklUUyAtIGFybXkubGVuZ3RoKTtcbiAgICBsZXQgc3RhciA9IDE7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNwYXJlIGJ1ZGdldCBwZXIgZnJlZSBzbG90IGJ1eXMgc3RhcnNcbiAgICBmb3IgKGxldCBzID0gMzsgcyA+PSAyOyBzLS0pIGlmIChDT1NUW3NvdWxdW3MgLSAxXSA8PSBsZWZ0ICYmIENPU1Rbc291bF1bcyAtIDFdIDw9IE1hdGgubWF4KENPU1Rbc291bF1bMF0sIHBlciAqIDEuMikpIHsgc3RhciA9IHM7IGJyZWFrOyB9XG4gICAgYXJteS5wdXNoKHsgc291bCwgc3RhciB9KTsgbGVmdCAtPSBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbiAgfVxuICByZXR1cm4gYXJteTtcbn1cbiIsICIvLyBFbmVteSB3YXZlcyBhbmQgdGhlIGNhbXBhaWduJ3Mgc3RhZ2VzLiBTYW1lIHVuaXQgcG9vbCBhcyB0aGUgcGxheWVyLiBUaGUgYnVpbGQgc2NyZWVuIHByZXZpZXdzIHRoZSBDT01QT1NJVElPTiBvbmx5LCBuZXZlciBwb3NpdGlvbnMuXG4vL1xuLy8gRWFjaCBTVEFHRSBoYXMgZm91ciBkaWZmaWN1bHR5IHRpZXJzIChlYXN5IC8gbm9ybWFsIC8gaGFyZCAvIG5pZ2h0bWFyZSkuIExhdGVyIHN0YWdlcyBhcmUgaGFyZGVyOiB0aGV5IHJldXNlIHRvdWdoZXIgd2F2ZSBsaXN0cyBhbmQgYSBoaWRkZW5cbi8vIEVORU1ZIFBPV0VSIG11bHRpcGxpZXIgKGhlYWx0aCBhbmQgZGFtYWdlIG9mIGVuZW15IHVuaXRzKSB0dW5lZCBwZXIgc3RhZ2UgYW5kIHRpZXIgd2l0aCBzaW0vY2FsaWJyYXRlX3Bvd2VyLnRzLCBzbyB0aGF0IHRoZSBjb21wZXRlbnRcbi8vIHN0YW5kLWluIHBsYXllciBjbGVhcnMgZWFjaCB0aWVyIGFib3V0IDYwJSBvZiB0aGUgdGltZSBhdCB0aGF0IHRpZXIncyBSRUNPTU1FTkRFRCBTT1VMIExFVkVMIChldmVyeSBTb3VsIGF0IHRoYXQgbGV2ZWwpLlxuLy8gVW5sb2NrIHJ1bGVzIGxpdmUgaW4gcHJvZ3Jlc3MudHM6IEVhc3kgYW5kIE5vcm1hbCBhcmUgYWx3YXlzIG9wZW47IGNsZWFyaW5nIE5vcm1hbCBvcGVucyBIYXJkIGFuZCB0aGUgbmV4dCBzdGFnZTsgY2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5cbmltcG9ydCB7IENPU1QsIENVUlZFUywgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19JRCwgZW5kbGVzc1Bvd2VyLCBlbmRsZXNzV2F2ZSB9IGZyb20gJy4vZW5kbGVzcy50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVuZW15U3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBib3NzPzogYm9vbGVhbiB9XG5leHBvcnQgdHlwZSBEaWZmID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGUzogRGlmZltdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuXG5jb25zdCBMRVRURVI6IFJlY29yZDxzdHJpbmcsIFNvdWxJZD4gPSB7IFc6ICd3YXJyaW9yJywgQTogJ2FyY2hlcicsIEc6ICdnb2JsaW4nLCBLOiAna25pZ2h0JywgTzogJ29ncmUnLCBCOiAnYmFyYmFyaWFuJyB9O1xuY29uc3QgcGFyc2VXYXZlID0gKHM6IHN0cmluZyk6IEVuZW15U3BlY1tdID0+IHMuc3BsaXQoJyAnKS5tYXAoKHQpID0+ICh7IHNvdWw6IExFVFRFUlt0WzBdXSwgc3RhcjogK3RbMV0gfSkpO1xuXG4vKipcbiAqIFdhdmUgbGlzdHMgKFcgd2FycmlvciwgQSBhcmNoZXIsIEcgZ29ibGluLCBLIGtuaWdodCwgTyBvZ3JlLCBCIGJhcmJhcmlhbjsgZGlnaXQgPSBzdGFycykuIFRoZXNlIGZvdXIgd2VyZSB0dW5lZCBmb3IgU3RhZ2UgMTsgbGF0ZXIgc3RhZ2VzXG4gKiByZXVzZSB0aGVtIG9uZSB0aWVyIHVwIGFuZCBhZGQgZW5lbXkgcG93ZXIuIEhhcmQgYW5kIE5pZ2h0bWFyZSBhcmUgdm9sdW1lLWRyaXZlbiAodXAgdG8gMTIgZW5lbWllcykuXG4gKiBDb21wZXRlbnQgc3RhbmQtaW4gY2xlYXIgcmF0ZSB3aXRoIEVWRVJZIFNvdWwgYXQgbGV2ZWwgMSAvIDQgLyA2OiBlYXN5IDk4LzEwMC8xMDAsIG5vcm1hbCA4Mi85OC8xMDAsIGhhcmQgNy82MC84NywgbmlnaHRtYXJlIDAvMzMvNzQuXG4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEnLCAnSzEgVzEnLCAnTzEgVzEgRzEnLCAnSzEgQTEgVzEnLCAnTzEgQTEgRzEnLCAnSzEgTzEgQTEnLCAnSzEgTzEgQTEgRzEnLCAnTzEgSzEgQTEgRzEnLCAnTzEgSzEgQTEgQjEnLCAnTzIgSzEgQTEgRzEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExJywgJ0sxIEcxIFcxJywgJ08xIEExIEcxIFcxJywgJ0sxIE8xIEExIFcxJywgJ08xIEsxIEExIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxJywgJ0sxIE8xIEExIEcxIFcxJywgJ08xIEsxIEExIEIxIEcxJywgJ08xIEsxIEEyIEIxIEcxJywgJ08yIEsxIEExIEIxIEcxIFcxJ10sXG4gIGhhcmQ6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgQTEgRzEgVzEgVzEnLCAnSzEgTzEgQTEgVzEgRzEgVzEnLCAnTzEgSzEgQTIgRzEgVzEgVzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEgVzEgVzEnLCAnSzEgTzEgQTEgRzEgVzIgVzEgVzEnLCAnTzEgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzIgQTEgQjEgRzEgVzEgVzEgVzEgRzEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ08xIEExIEcxIFcxIEIxIFcxJywgJ0sxIE8xIEExIFcxIEcxIFcxIFcxJywgJ08xIEsxIEEyIEcxIFcxIEIxIFcxIFcxIEcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxIFcxIFcxIEcxIEcxJywgJ0sxIE8xIEEyIEcxIFcxIEIxIFcxIFcxIEcxIEcxIEIxJywgJ08xIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxJywgJ08yIEsxIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJywgJ08yIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJ10sXG59O1xuXG4vKiogU3RhZ2UgMiwgdGhlIFN1bmtlbiBHcmF2ZXlhcmQ6IGNyb3dkcy4gU2FtZSBEb21pbmlvbiBjb3N0IHBlciB3YXZlIGFzIHRoZSBsaXN0cyBvbmUgdGllciB1cCwgYnV0IGJ1aWx0IGZyb20gbWFueSBXYXJyaW9ycywgR29ibGlucyBhbmQgQXJjaGVycyB3aXRoIGEgS25pZ2h0IG9yIE9ncmUgaG9sZGluZyB0aGUgZnJvbnQgKHNpbS9hdXRob3Jfc3RhZ2VzLnRzKS4gKi9cbmNvbnN0IEdSQVZFWUFSRDogUmVjb3JkPERpZmYsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMSBBMScsICdLMSBHMSBXMScsICdPMSBXMSBXMSBXMSBHMScsICdPMSBHMiBHMSBBMScsICdPMSBXMSBXMSBXMSBBMSBBMScsICdLMSBXMSBXMSBXMSBBMSBBMSBBMScsICdPMSBXMSBXMSBXMSBXMSBXMSBBMScsICdPMSBXMSBXMSBXMSBXMSBHMSBHMSBHMScsICdLMSBXMSBXMSBXMSBXMSBXMSBHMiBHMSBBMScsICdLMSBXMSBXMSBXMSBXMSBHMSBHMSBHMSBHMSBBMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgVzEgVzEgVzEgRzEgQTEnLCAnTzEgVzEgVzEgRzEgRzEgRzEgRzEnLCAnTzEgVzIgVzEgVzEgVzEgVzEgVzEgRzEgQTEnLCAnSzEgVzEgVzEgVzEgVzEgVzEgRzEgRzEgRzEgQTEgQTEnLCAnSzEgVzEgVzEgVzEgRzEgQTEgQTEgQTEnLCAnTzEgVzEgVzEgRzEgRzEgQTEgQTEgQTEgQTEnLCAnSzIgVzEgVzEgVzEgVzEgVzEgVzEgRzEgRzEgRzEgQTEgQTEnLCAnTzEgVzIgVzEgVzEgVzEgVzEgVzEgRzEgRzEgQTEgQTEgQTEnXSxcbiAgaGFyZDogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBXMSBXMSBXMSBXMSBHMiBBMScsICdPMSBXMSBXMSBHMSBHMSBBMSBBMScsICdPMSBXMSBXMSBXMSBXMSBXMSBHMSBHMSBBMSBBMSBBMScsICdLMSBXMyBXMiBXMiBXMiBXMSBXMSBXMSBXMSBBMSBBMSBBMScsICdPMSBXMyBXMiBXMiBXMiBXMiBXMSBXMSBXMSBHMyBHMiBBMScsICdPMiBXMiBXMiBXMSBXMSBXMSBHMiBHMSBHMSBHMSBBMiBBMScsICdLMyBXMyBXMyBXMyBXMiBXMiBXMSBXMSBHMiBHMSBHMSBBMycsICdLMyBXMyBXMyBXMiBXMiBXMSBHMyBHMiBHMiBHMSBBMiBBMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgVzEgVzEgVzEgRzEgRzEgQTEnLCAnTzEgVzEgVzEgVzEgVzEgRzEgRzEgQTEnLCAnSzEgVzEgVzEgVzEgVzEgVzEgVzEgVzEgVzEgQTIgQTEgQTEnLCAnTzEgVzMgVzIgVzEgVzEgVzEgVzEgVzEgRzIgRzEgRzEgQTEnLCAnTzEgVzIgVzEgVzEgVzEgRzIgRzEgRzEgRzEgQTIgQTEgQTEnLCAnTzIgVzIgVzEgVzEgVzEgVzEgRzIgRzEgRzEgQTIgQTEgQTEnLCAnSzIgVzMgVzEgVzEgVzEgRzIgRzIgRzEgQTMgQTIgQTEgQTEnLCAnTzIgVzEgVzEgVzEgRzIgRzIgRzIgRzEgRzEgQTMgQTIgQTEnXSxcbn07XG4vKiogU3RhZ2UgMywgdGhlIEJvbmUgQmFzdGlvbjogZmV3ZXIsIGhlYXZpZXIgYXJtaWVzIG9mIEtuaWdodHMsIE9ncmVzIGFuZCBCYXJiYXJpYW5zIHdpdGggQXJjaGVycyBiZWhpbmQgKHNpbS9hdXRob3Jfc3RhZ2VzLnRzKS4gKi9cbmNvbnN0IEJBU1RJT046IFJlY29yZDxEaWZmLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgQTEgQTEnLCAnSzEgSzEgSzEgQTEgQTEnLCAnSzEgTzEgQjEgQjEgQTEnLCAnSzEgSzEgTzEgTzEgQTEgQTEnLCAnSzEgSzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgTzEgQjEgQjEnLCAnSzIgSzEgTzEgTzEgQjEgQjEnLCAnSzEgSzEgTzEgTzEgQjEgQjEgQTEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ0sxIEsxIEsxIEExIEExJywgJ08xIE8xIEIxIEIxJywgJ0syIEsxIEsxIE8xIEIxIEIxJywgJ0sxIE8xIE8xIEIxIEIxIEExIEExJywgJ0syIEsxIEsxIEsxIEIyIEIxIEIxIEExJywgJ0syIEsxIEsxIE8xIEIxIEIxIEEyIEExJywgJ0syIEsyIE8yIEIxIEIxIEEyIEEyIEExJywgJ0syIEsyIEsyIEsxIEIyIEIyIEEzIEExJ10sXG4gIGhhcmQ6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgQjEgQTEgQTEnLCAnSzEgSzEgTzEgQTEgQTEnLCAnSzEgTzEgQjEgQjEgQjEgQTEgQTEnLCAnSzEgSzEgSzEgTzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgSzEgTzEgQjEgQjEgQjEnLCAnSzIgSzEgSzEgTzEgTzEgQjEgQjEgQTEnLCAnSzIgSzEgTzEgTzEgQjEgQjEgQjEgQTMnLCAnSzIgSzIgSzEgSzEgTzEgTzEgQjMgQjEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ0sxIEsxIE8xIEIxJywgJ0syIEsxIEsxIE8xJywgJ0syIEsxIEsxIEsxIEsxIE8xJywgJ0sxIEsxIEsxIE8xIE8xIEIxIEExJywgJ0sxIEsxIEsxIEIyIEIxIEIxIEEyIEExJywgJ0sxIE8xIE8xIE8xIEIyIEExIEExIEExJywgJ0sxIE8yIE8xIE8xIE8xIEIxIEIxIEExJywgJ0szIEsyIEsxIEsxIEsxIE8yIEIxIEIxJ10sXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFN0YWdlRGVmIHtcbiAgaWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBibHVyYjogc3RyaW5nO1xuICBsaXN0czogUmVjb3JkPERpZmYsIHN0cmluZ1tdPjsgICAgICAgICAgLy8gdGhlIDEwIGVuZW15IHdhdmVzIGZvciBlYWNoIHRpZXJcbiAgcG93ZXI6IFJlY29yZDxEaWZmLCBudW1iZXI+OyAgICAgICAgICAgIC8vIGhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIGVhY2ggdGllciAoMSA9IGFzIHdyaXR0ZW4pXG4gIHJlYzogUmVjb3JkPERpZmYsIG51bWJlcj47ICAgICAgICAgICAgICAvLyByZWNvbW1lbmRlZCBTb3VsIGxldmVsIGZvciBlYWNoIHRpZXIgKGEgaGludCBvbiBIb21lLCBuZXZlciBhIGxvY2spXG59XG5cbi8qKiBUaGUgY2FtcGFpZ24uIE5hbWVzIGFyZSBwbGFjZWhvbGRlcnMuIFBvd2VyIG51bWJlcnMgY29tZSBmcm9tIHNpbS9jYWxpYnJhdGVfcG93ZXIudHMuICovXG5leHBvcnQgY29uc3QgU1RBR0VTOiBTdGFnZURlZltdID0gW1xuICB7IGlkOiAnY3J5cHQnLCBuYW1lOiAnVGhlIFJlc3RsZXNzIENyeXB0JywgYmx1cmI6ICdSYWlzZSB5b3VyIGFybXkuIFRoZSBkZWFkIGhlcmUgYXJlIG9ubHkganVzdCBzdGlycmluZy4nLFxuICAgIGxpc3RzOiB7IGVhc3k6IERJRkZJQ1VMVFkuZWFzeSwgbm9ybWFsOiBESUZGSUNVTFRZLm5vcm1hbCwgaGFyZDogRElGRklDVUxUWS5oYXJkLCBuaWdodG1hcmU6IERJRkZJQ1VMVFkubmlnaHRtYXJlIH0sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLCBoYXJkOiAxLCBuaWdodG1hcmU6IDEgfSwgcmVjOiB7IGVhc3k6IDEsIG5vcm1hbDogMSwgaGFyZDogNCwgbmlnaHRtYXJlOiA2IH0gfSxcbiAgeyBpZDogJ2dyYXZleWFyZCcsIG5hbWU6ICdUaGUgU3Vua2VuIEdyYXZleWFyZCcsIGJsdXJiOiAnQmlnZ2VyIGNyb3dkcyBjcmF3bCBvdXQgb2YgdGhlIG11ZC4gTGV2ZWwgeW91ciBTb3VscyBiZWZvcmUgeW91IGNvbWUuJyxcbiAgICBsaXN0czogR1JBVkVZQVJELFxuICAgIHBvd2VyOiB7IGVhc3k6IDEsIG5vcm1hbDogMS4xNSwgaGFyZDogMC45NSwgbmlnaHRtYXJlOiAxLjE1IH0sIHJlYzogeyBlYXN5OiAyLCBub3JtYWw6IDQsIGhhcmQ6IDYsIG5pZ2h0bWFyZTogOCB9IH0sXG4gIHsgaWQ6ICdiYXN0aW9uJywgbmFtZTogJ1RoZSBCb25lIEJhc3Rpb24nLCBibHVyYjogJ0EgZm9ydHJlc3Mgb2YgdGhlIGZhbGxlbi4gT25seSB3ZWxsLWxldmVsbGVkIGFybWllcyBob2xkIHRoZSBnYXRlLicsXG4gICAgbGlzdHM6IEJBU1RJT04sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLjAsIGhhcmQ6IDEuMjUsIG5pZ2h0bWFyZTogMS40IH0sIHJlYzogeyBlYXN5OiA0LCBub3JtYWw6IDYsIGhhcmQ6IDgsIG5pZ2h0bWFyZTogMTAgfSB9LFxuXTtcbmV4cG9ydCBjb25zdCBzdGFnZUluZGV4ID0gKGlkOiBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMCwgU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gaWQpKTtcbmV4cG9ydCBjb25zdCBzdGFnZUJ5SWQgPSAoaWQ6IHN0cmluZyk6IFN0YWdlRGVmID0+IFNUQUdFU1tzdGFnZUluZGV4KGlkKV07XG5cbi8qKiBOYW1lcyBhbmQgb25lLWxpbmUgcHJvbWlzZXMgZm9yIHRoZSBkaWZmaWN1bHR5IHBpY2tlci4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZX0lORk8gPSBbXG4gIHsgaWQ6ICdlYXN5JywgbGFiZWw6ICdFYXN5JywgYmx1cmI6ICdTbWFsbGVyIGVuZW15IGFybWllcy4gUmVsYXggYW5kIGxlYXJuIGhvdyBtZXJnaW5nIHdvcmtzLicgfSxcbiAgeyBpZDogJ25vcm1hbCcsIGxhYmVsOiAnTm9ybWFsJywgYmx1cmI6ICdUaGUgc3RhbmRhcmQgZmlnaHQuIENsZWFyaW5nIGl0IHVubG9ja3MgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2UuJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnQmlnZ2VyIGFybWllcyB3aXRoIG1vcmUgZm9kZGVyLiBCZXR0ZXIgZmlyc3QtY2xlYXIgcmV3YXJkcy4gQ2xlYXJpbmcgaXQgdW5sb2NrcyBOaWdodG1hcmUuJyB9LFxuICB7IGlkOiAnbmlnaHRtYXJlJywgbGFiZWw6ICdOaWdodG1hcmUnLCBibHVyYjogJ0EgcGFja2VkIGJhdHRsZWZpZWxkIG9mIHN0YXJzIGFuZCBza2lsbHMuIEJ1aWx0IGZvciB3ZWxsLWxldmVsbGVkIFNvdWxzLicgfSxcbl07XG5cbi8vIC0tLS0gd2hhdCB0aGUgbmV4dCBiYXR0bGUgdXNlcyAoc2V0IHdoZW4gYSBydW4gc3RhcnRzKVxuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZTogc3RyaW5nID0gJ25vcm1hbCc7XG5leHBvcnQgbGV0IGN1cnJlbnRTdGFnZUlkOiBzdHJpbmcgPSAnY3J5cHQnO1xubGV0IHBvd2VyID0gMSwgZW5kbGVzc01vZGUgPSBmYWxzZSwgYm9zc1N0ciA9IDE7XG4vKiogSG93IGhhcmQgdGhlIGJvc3MgaGl0cyBmb3IgdGhlIGN1cnJlbnQgbW9kZSAoMCA9IGFuIG9yZGluYXJ5IHVuaXQsIDEgPSB0aGUgZnVsbCBib3NzKTogZ2VudGxlIG9uIEVhc3ksIGZ1bGwgb24gTmlnaHRtYXJlIGFuZCBpbiBFbmRsZXNzLiAqL1xuZXhwb3J0IGNvbnN0IGJvc3NTdHJlbmd0aCA9ICgpOiBudW1iZXIgPT4gYm9zc1N0cjtcbmNvbnN0IEJPU1NfQllfVElFUjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHsgZWFzeTogMC4yLCBub3JtYWw6IDAuNSwgaGFyZDogMC44LCBuaWdodG1hcmU6IDEgfTtcbmxldCBkYWlseVJld3JpdGU6ICgodzogRW5lbXlTcGVjW10sIHdhdmU6IG51bWJlcikgPT4gRW5lbXlTcGVjW10pIHwgbnVsbCA9IG51bGw7ICAgLy8gc2V0IG9ubHkgZHVyaW5nIGEgRGFpbHkgQ2hhbGxlbmdlIHJ1blxuLyoqIEVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGN1cnJlbnQgc3RhZ2UgYW5kIHRpZXIgKGluIGVuZGxlc3MgbW9kZSBpdCBkZXBlbmRzIG9uIHRoZSB3YXZlKS4gKi9cbmV4cG9ydCBjb25zdCBlbmVteVBvd2VyID0gKHdhdmUgPSAxKTogbnVtYmVyID0+IChlbmRsZXNzTW9kZSA/IGVuZGxlc3NQb3dlcih3YXZlKSA6IHBvd2VyKTtcbmV4cG9ydCBjb25zdCBpc0VuZGxlc3MgPSAoKTogYm9vbGVhbiA9PiBlbmRsZXNzTW9kZTtcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyICgxMCB3YXZlcykuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXRTdGFnZURpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFN0YWdlRGlmZmljdWx0eShzdGFnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBzdGFnZUJ5SWQoc3RhZ2UpOyBpZiAoIURJRkZTLmluY2x1ZGVzKG5hbWUgYXMgRGlmZikpIHJldHVybjtcbiAgZW5kbGVzc01vZGUgPSBmYWxzZTsgZGFpbHlSZXdyaXRlID0gbnVsbDsgYm9zc1N0ciA9IEJPU1NfQllfVElFUltuYW1lXSA/PyAwLjU7IGN1cnJlbnRTdGFnZUlkID0gc3QuaWQ7IGRpZmZpY3VsdHlOYW1lID0gbmFtZTsgcG93ZXIgPSBzdC5wb3dlcltuYW1lIGFzIERpZmZdO1xuICBBVVRIT1JFRC5sZW5ndGggPSAwOyBzdC5saXN0c1tuYW1lIGFzIERpZmZdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG4vKiogU3dpdGNoIHRvIHRoZSBEYWlseSBDaGFsbGVuZ2U6IFN0YWdlIDEgTm9ybWFsIHdpdGggdGhlIGRheSdzIHR3aXN0IChzZWUgY29yZS9kYWlseS50cykuIGBkYXlgIGlzIGtlcHQgYXMgdGhlICdkaWZmaWN1bHR5JyBzbyBhIHNhdmVkIHJ1biBjYW4gcmVidWlsZCB0aGUgc2FtZSBkYXkuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0RGFpbHkobW9kOiB7IHBvd2VyOiBudW1iZXI7IGVuZW15PzogKHc6IEVuZW15U3BlY1tdLCB3YXZlOiBudW1iZXIpID0+IEVuZW15U3BlY1tdIH0sIGRheTogbnVtYmVyKTogdm9pZCB7XG4gIHNldFN0YWdlRGlmZmljdWx0eSgnY3J5cHQnLCAnbm9ybWFsJyk7IGRhaWx5UmV3cml0ZSA9IG1vZC5lbmVteSA/PyBudWxsOyBjdXJyZW50U3RhZ2VJZCA9ICdkYWlseSc7IGRpZmZpY3VsdHlOYW1lID0gU3RyaW5nKGRheSk7IHBvd2VyID0gbW9kLnBvd2VyO1xufVxuLyoqIFN3aXRjaCB0byBFbmRsZXNzIERlcHRoczogd2F2ZXMgY29tZSBmcm9tIGNvcmUvZW5kbGVzcy50cyBpbnN0ZWFkIG9mIGEgc3RhZ2UgbGlzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRFbmRsZXNzKCk6IHZvaWQgeyBlbmRsZXNzTW9kZSA9IHRydWU7IGRhaWx5UmV3cml0ZSA9IG51bGw7IGJvc3NTdHIgPSAxOyBjdXJyZW50U3RhZ2VJZCA9IEVORExFU1NfSUQ7IGRpZmZpY3VsdHlOYW1lID0gJ2VuZGxlc3MnOyBwb3dlciA9IDE7IEFVVEhPUkVELmxlbmd0aCA9IDA7IH1cbi8qKiBDaGFuZ2UgdGhlIHRpZXIgd2l0aGluIHRoZSBjdXJyZW50IHN0YWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldERpZmZpY3VsdHkobmFtZTogc3RyaW5nKTogdm9pZCB7IHNldFN0YWdlRGlmZmljdWx0eShjdXJyZW50U3RhZ2VJZCwgbmFtZSk7IH1cblxuZXhwb3J0IGNvbnN0IHdhdmVDb3N0ID0gKHc6IEVuZW15U3BlY1tdKTogbnVtYmVyID0+IHcucmVkdWNlKChuLCBlKSA9PiBuICsgQ09TVFtlLnNvdWxdW2Uuc3RhciAtIDFdLCAwKTtcblxuLyoqIFRoZSBsYXN0IHdhdmUgb2YgYSBzdGFnZSBoYXMgYSBCT1NTOiBpdHMgYmlnZ2VzdCB1bml0IChhIGJydXRlIGlmIHRoZXJlIGlzIG9uZSkgZ2V0cyBleHRyYSBoZWFsdGgsIGRhbWFnZSBhbmQgc2l6ZSAoc2VlIEJPU1MgaW4gYmF0dGxlLnRzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXJrQm9zcyh3OiBFbmVteVNwZWNbXSk6IEVuZW15U3BlY1tdIHtcbiAgbGV0IGJlc3QgPSAtMSwgYnMgPSAtMTtcbiAgdy5mb3JFYWNoKChlLCBpKSA9PiB7IGNvbnN0IGJydXRlID0gZS5zb3VsID09PSAnb2dyZScgfHwgZS5zb3VsID09PSAna25pZ2h0JyB8fCBlLnNvdWwgPT09ICdiYXJiYXJpYW4nID8gMTAwIDogMCwgc2MgPSBicnV0ZSArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXTsgaWYgKHNjID4gYnMpIHsgYnMgPSBzYzsgYmVzdCA9IGk7IH0gfSk7XG4gIGlmIChiZXN0ID49IDApIHtcbiAgICB3W2Jlc3RdID0geyAuLi53W2Jlc3RdLCBib3NzOiB0cnVlIH07XG4gICAgLy8gVGhlIGJvc3MgcGF5cyBmb3IgaXRzZWxmOiBpdHMgZXh0cmEgaGVhbHRoIGFuZCBkYW1hZ2UgYXJlIHRha2VuIG91dCBvZiB0aGUgZXNjb3J0LCBzbyB0aGUgd2hvbGUgd2F2ZSBpcyBhYm91dCBhcyBzdHJvbmcgYXMgdGhlIHBsYWluIHdhdmUgaXQgcmVwbGFjZXMuXG4gICAgY29uc3QgZXh0cmEgPSBNYXRoLnJvdW5kKGJvc3NFeHRyYUNvc3QoQ09TVFt3W2Jlc3RdLnNvdWxdW3dbYmVzdF0uc3RhciAtIDFdKSk7IGxldCByZW1vdmVkID0gMDtcbiAgICBjb25zdCBvcmRlciA9IHcubWFwKChlLCBpKSA9PiBpKS5maWx0ZXIoKGkpID0+IGkgIT09IGJlc3QpLnNvcnQoKGEsIGIpID0+IENPU1Rbd1thXS5zb3VsXVt3W2FdLnN0YXIgLSAxXSAtIENPU1Rbd1tiXS5zb3VsXVt3W2JdLnN0YXIgLSAxXSk7XG4gICAgY29uc3QgZHJvcCA9IG5ldyBTZXQ8bnVtYmVyPigpOyBmb3IgKGNvbnN0IGkgb2Ygb3JkZXIpIHsgY29uc3QgYyA9IENPU1Rbd1tpXS5zb3VsXVt3W2ldLnN0YXIgLSAxXTsgaWYgKHJlbW92ZWQgKyBjIDw9IGV4dHJhICsgMSAmJiBkcm9wLnNpemUgPCBvcmRlci5sZW5ndGggLSAxKSB7IGRyb3AuYWRkKGkpOyByZW1vdmVkICs9IGM7IH0gfVxuICAgIHJldHVybiB3LmZpbHRlcigoXywgaSkgPT4gIWRyb3AuaGFzKGkpKTtcbiAgfVxuICByZXR1cm4gdztcbn1cbi8qKiBIb3cgbXVjaCBEb21pbmlvbi13b3J0aCBvZiBleHRyYSBzdHJlbmd0aCBhIGJvc3Mgb2YgdGhpcyBjb3N0IGhhcyAoaXRzIGhlYWx0aCBhbmQgZGFtYWdlIGJvbnVzZXMgYXQgdGhlIGN1cnJlbnQgYm9zcyBzdHJlbmd0aCkuICovXG5leHBvcnQgY29uc3QgYm9zc0V4dHJhQ29zdCA9IChjb3N0OiBudW1iZXIpOiBudW1iZXIgPT4gY29zdCAqICgoMSArIDAuNiAqIGJvc3NTdHIpICogKDEgKyAwLjIgKiBib3NzU3RyKSAtIDEpO1xuLyoqIEVuZW15IGFybXkgZm9yIGEgd2F2ZSAoMS1iYXNlZCkuIFdhdmVzIHBhc3QgdGhlIGF1dGhvcmVkIG9uZXMgYXJlIGdlbmVyYXRlZCBmcm9tIGEgZml4ZWQgc2VlZCBzbyByZXRyaWVzIGZhY2UgdGhlIHNhbWUgYXJteS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteVdhdmUod2F2ZTogbnVtYmVyLCBzdGFnZVNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBpZiAoZW5kbGVzc01vZGUpIHJldHVybiBlbmRsZXNzV2F2ZSh3YXZlLCBzdGFnZVNlZWQpO1xuICBpZiAod2F2ZSA8PSBBVVRIT1JFRC5sZW5ndGgpIHsgbGV0IHcgPSBBVVRIT1JFRFt3YXZlIC0gMV0ubWFwKChlKSA9PiAoeyAuLi5lIH0pKTsgaWYgKGRhaWx5UmV3cml0ZSkgdyA9IGRhaWx5UmV3cml0ZSh3LCB3YXZlKTsgcmV0dXJuIHdhdmUgPT09IEFVVEhPUkVELmxlbmd0aCA/IG1hcmtCb3NzKHcpIDogdzsgfVxuICBjb25zdCBjYXAgPSBDVVJWRVMuZG9jW01hdGgubWluKHdhdmUsIENVUlZFUy5kb2MubGVuZ3RoKSAtIDFdO1xuICBjb25zdCBidWRnZXQgPSBNYXRoLnJvdW5kKGNhcCAqIDAuOTIpO1xuICBjb25zdCBybmcgPSBtYWtlUm5nKHN0YWdlU2VlZCAqIDEwMDkgKyB3YXZlICogNzkxOSk7XG4gIGNvbnN0IGFybXk6IEVuZW15U3BlY1tdID0gW107XG4gIGxldCBsZWZ0ID0gYnVkZ2V0O1xuICBmb3IgKGxldCBndWFyZCA9IDA7IGd1YXJkIDwgNDAgJiYgbGVmdCA+PSAyOyBndWFyZCsrKSB7XG4gICAgY29uc3Qgc291bCA9IHJuZy5waWNrKFNPVUxTKTtcbiAgICBsZXQgc3RhciA9IDE7XG4gICAgaWYgKHJuZy5uZXh0KCkgPCAwLjM1ICYmIENPU1Rbc291bF1bMV0gPD0gbGVmdCkgc3RhciA9IDI7XG4gICAgaWYgKHdhdmUgPj0gNiAmJiBybmcubmV4dCgpIDwgMC4yNSAmJiBDT1NUW3NvdWxdWzJdIDw9IGxlZnQpIHN0YXIgPSAzO1xuICAgIGNvbnN0IGMgPSBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbiAgICBpZiAoYyA8PSBsZWZ0ICYmIGFybXkubGVuZ3RoIDwgMTIpIHsgYXJteS5wdXNoKHsgc291bCwgc3RhciB9KTsgbGVmdCAtPSBjOyB9XG4gIH1cbiAgcmV0dXJuIGFybXk7XG59XG5cbi8qKiBXaGF0IHRoZSBidWlsZCBzY3JlZW4gc2hvd3M6IGNvdW50cyBwZXIgU291bCBhbmQgc3Rhciwgbm8gcG9zaXRpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByZXZpZXdUZXh0KHc6IEVuZW15U3BlY1tdKTogeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY291bnQ6IG51bWJlcjsgYm9zcz86IGJvb2xlYW4gfVtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXI7IGJvc3M/OiBib29sZWFuIH0+KCk7XG4gIGZvciAoY29uc3QgZSBvZiB3KSB7XG4gICAgY29uc3QgayA9IGUuc291bCArIGUuc3RhciArIChlLmJvc3MgPyAnQicgOiAnJyk7XG4gICAgY29uc3QgY3VyID0gbWFwLmdldChrKTtcbiAgICBpZiAoY3VyKSBjdXIuY291bnQrKzsgZWxzZSBtYXAuc2V0KGssIHsgc291bDogZS5zb3VsLCBzdGFyOiBlLnN0YXIsIGNvdW50OiAxLCBib3NzOiBlLmJvc3MgfSk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldO1xufVxuIiwgIi8vIEF1dG8tYmF0dGxlIHNpbXVsYXRpb246IHB1cmUgbG9naWMsIG5vIGdyYXBoaWNzLiBEZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHNlZWQuXG4vLyBUaGUgcmVuZGVyZXIgb25seSByZWFkcyBmaWdodGVycyArIGV2ZW50czsgaXQgbmV2ZXIgZGVjaWRlcyBhbnl0aGluZy5cbi8vXG4vLyBBYmlsaXRpZXMgKG51bWJlcnMgbGl2ZSBpbiBiYWxhbmNlLnRzKTpcbi8vICAgU2tlbGV0b24gV2FycmlvciAgUGhhbGFueCAgICAgdGFrZXMgbGVzcyBkYW1hZ2UgZm9yIGVhY2ggbmVhcmJ5IGFsbGllZCBXYXJyaW9yIChjYXBwZWQpXG4vLyAgIFNrZWxldG9uIEFyY2hlciAgIFNwbGl0IEFycm93IChza2lsbCkgb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllczsgYmFzaWMgc2hvdHMgYXJlIGEgc2luZ2xlIGFycm93XG4vLyAgIEdvYmxpbiAgICAgICAgICAgIE9wcG9ydHVuaXN0ICtkYW1hZ2Ugb24gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2U7IHByZWZlcnMgc3VjaCB0YXJnZXRzXG4vLyAgIEtuaWdodCAgICAgICAgICAgIFRhdW50IChza2lsbCkgIGZvcmNlcyBuZWFyYnkgZW5lbWllcyB0byBhdHRhY2sgaGltXG4vLyAgIE9ncmUgICAgICAgICAgICAgIFNtYXNoIChza2lsbCkgIGhlYXZ5IHNsYW0gdGhhdCBhbHNvIGhpdHMgZW5lbWllcyBuZWFyIHRoZSBpbXBhY3Rcbi8vIFNraWxscyBydW4gb24gbWFuYTogYmFzaWMgYXR0YWNrcyBhbmQgZGFtYWdlIHRha2VuIGZpbGwgYSBiYXI7IHdoZW4gZnVsbCwgdGhlIG5leHQgYXR0YWNrIGlzIHRoZSBza2lsbCBhbmQgdGhlIGJhciByZXNldHMuXG4vLyBXYXJyaW9yLCBHb2JsaW4gYW5kIEJhcmJhcmlhbiBoYXZlIHBhc3NpdmVzIG9ubHkgKG5vIG1hbmEpLlxuLy8gICBCYXJiYXJpYW4gICAgICAgICBGcmVuenkgICAgICBhdHRhY2tzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgc3dpbmdcblxuaW1wb3J0IHsgR1JJRF9DT0xTLCBHUklEX1JPV1MgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4vYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBib3NzU3RyZW5ndGggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGNvbnN0IEdSSURfU1AgPSAxLjM7ICAgICAvLyBtZXRyZXMgYmV0d2VlbiBncmlkIGNlbGxzXG5leHBvcnQgY29uc3QgRlJPTlRfWCA9IDEuNzsgICAgIC8vIGZyb250IGxpbmUncyBkaXN0YW5jZSBmcm9tIHRoZSBjZW50cmUgbGluZVxuXG5leHBvcnQgaW50ZXJmYWNlIFNsb3QgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgU3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyIH1cblxuLyoqIFdvcmxkIHBvc2l0aW9uIG9mIGEgZ3JpZCBjZWxsIGZvciBhIHRlYW0gKHRlYW0gMCA9IGxlZnQsIGZhY2VzICtYOyB0ZWFtIDEgPSByaWdodCwgZmFjZXMgLVgpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNlbGxQb3ModGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcik6IHsgeDogbnVtYmVyOyB6OiBudW1iZXIgfSB7XG4gIGNvbnN0IHJvdyA9IE1hdGguZmxvb3IoY2VsbCAvIEdSSURfQ09MUyksIGNvbCA9IGNlbGwgJSBHUklEX0NPTFM7XG4gIGNvbnN0IGRlcHRoID0gR1JJRF9DT0xTIC0gMSAtIGNvbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIDAgPSBmcm9udCBsaW5lXG4gIHJldHVybiB7IHg6IChGUk9OVF9YICsgZGVwdGggKiBHUklEX1NQKSAqICh0ZWFtID09PSAwID8gLTEgOiAxKSwgejogKHJvdyAtIChHUklEX1JPV1MgLSAxKSAvIDIpICogR1JJRF9TUCB9O1xufVxuXG5jb25zdCBGUk9OVE5FU1M6IFJlY29yZDxTb3VsSWQsIG51bWJlcj4gPSB7IGtuaWdodDogNSwgb2dyZTogNCwgd2FycmlvcjogMywgYmFyYmFyaWFuOiAzLCBnb2JsaW46IDIsIGFyY2hlcjogMCB9O1xuLyoqIFRoZSBlbmVteSBhcm15IGlzIHBsYWNlZCBhdXRvbWF0aWNhbGx5ICh0YW5rcyB1cCBmcm9udCwgYXJjaGVycyBiZWhpbmQpOyB0aGUgcGxheWVyIG9ubHkgZXZlciBzZWVzIGl0cyBjb21wb3NpdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteUNlbGxzKHNwZWNzOiBTcGVjW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IGNlbGxzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ09MUyAqIEdSSURfUk9XUzsgYysrKSBjZWxscy5wdXNoKGMpO1xuICBjZWxscy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgZGEgPSBHUklEX0NPTFMgLSAxIC0gKGEgJSBHUklEX0NPTFMpLCBkYiA9IEdSSURfQ09MUyAtIDEgLSAoYiAlIEdSSURfQ09MUyk7XG4gICAgaWYgKGRhICE9PSBkYikgcmV0dXJuIGRhIC0gZGI7XG4gICAgcmV0dXJuIE1hdGguYWJzKE1hdGguZmxvb3IoYSAvIEdSSURfQ09MUykgLSAxKSAtIE1hdGguYWJzKE1hdGguZmxvb3IoYiAvIEdSSURfQ09MUykgLSAxKTtcbiAgfSk7XG4gIGNvbnN0IG9yZGVyID0gc3BlY3MubWFwKChzLCBpKSA9PiBpKS5zb3J0KChpLCBqKSA9PiBGUk9OVE5FU1Nbc3BlY3Nbal0uc291bF0gLSBGUk9OVE5FU1Nbc3BlY3NbaV0uc291bF0pO1xuICBjb25zdCBvdXQgPSBuZXcgQXJyYXk8bnVtYmVyPihzcGVjcy5sZW5ndGgpO1xuICBvcmRlci5mb3JFYWNoKChpZHgsIGspID0+IHsgb3V0W2lkeF0gPSBjZWxsc1trXTsgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCB0eXBlIEZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhZCc7XG4vKiogQSBib3NzIGlzIG9uZSBlbmVteSB3aXRoIGV4dHJhIGhlYWx0aCBhbmQgZGFtYWdlLCBhbmQgbW9yZSBzaXplLiAqL1xuZXhwb3J0IGNvbnN0IEJPU1MgPSB7IGhwOiAwLjYsIGRtZzogMC4yLCBzaXplOiAxLjMgfTsgICAvLyBzaXplIGlzIHRoZSBsb29rIG9ubHkgKGdhbWUvdmlzdWFscy50cykgICAgIC8vIGV4dHJhcyBhdCBmdWxsIHN0cmVuZ3RoIChzZWUgYm9zc1N0cmVuZ3RoIGluIHdhdmVzLnRzKVxuZXhwb3J0IGludGVyZmFjZSBGaWdodGVyIHtcbiAgYm9zcz86IGJvb2xlYW47XG4gIGlkOiBudW1iZXI7IHRlYW06IDAgfCAxOyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyO1xuICB4OiBudW1iZXI7IHo6IG51bWJlcjsgeWF3OiBudW1iZXI7XG4gIGhwOiBudW1iZXI7IG1heEhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBpbnRlcnZhbDogbnVtYmVyOyByYW5nZTogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyByYWRpdXM6IG51bWJlcjtcbiAgYWxpdmU6IGJvb2xlYW47IHN0YXRlOiBGU3RhdGU7XG4gIHRhcmdldDogbnVtYmVyOyByZXRhcmdldEF0OiBudW1iZXI7IGZvcmNlZFRhcmdldDogbnVtYmVyOyBmb3JjZWRVbnRpbDogbnVtYmVyO1xuICBuZXh0QXR0YWNrOiBudW1iZXI7IGF0dGFja1N0YXJ0OiBudW1iZXI7IGF0dGFja0R1cjogbnVtYmVyOyBhbmltU3BlZWQ6IG51bWJlcjsgaGl0RG9uZTogYm9vbGVhbjtcbiAgbWFuYTogbnVtYmVyOyBtYXhNYW5hOiBudW1iZXI7IGNhc3Rpbmc6IGJvb2xlYW47IGZyZW56eTogbnVtYmVyOyBkZWFkQXQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgQkV2ZW50ID1cbiAgfCB7IHQ6ICdzd2luZyc7IGlkOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdoaXQnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyOyBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ2Fycm93JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnZGVhdGgnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdjYXN0JzsgaWQ6IG51bWJlcjsgc2tpbGw6ICdzcGxpdCcgfCAndGF1bnQnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAndGF1bnQnOyBpZDogbnVtYmVyIH1cbiAgfCB7IHQ6ICdzbWFzaCc7IGlkOiBudW1iZXI7IHg6IG51bWJlcjsgejogbnVtYmVyOyByOiBudW1iZXIgfVxuICB8IHsgdDogJ2ZyZW56eSc7IGlkOiBudW1iZXI7IHN0YWNrczogbnVtYmVyIH07XG5cbmV4cG9ydCBjbGFzcyBCYXR0bGUge1xuICB0aW1lID0gMDtcbiAgZmlnaHRlcnM6IEZpZ2h0ZXJbXSA9IFtdO1xuICBldmVudHM6IEJFdmVudFtdID0gW107XG4gIHdpbm5lcjogLTEgfCAwIHwgMSA9IC0xO1xuICBybmc6IFJuZztcbiAgcHJpdmF0ZSBwZW5kaW5nOiB7IGF0OiBudW1iZXI7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXIgfVtdID0gW107XG4gIHByaXZhdGUgbmV4dElkID0gMTtcbiAgcHJpdmF0ZSBlbmVteVBvd2VyID0gMTtcbiAgcHJpdmF0ZSBmbGlwID0gZmFsc2U7XG5cbiAgLyoqIGBsZXZlbHNgOiB0aGUgcGxheWVyJ3MgcGVybWFuZW50IFNvdWwgbGV2ZWxzIChoZWFsdGggYW5kIGRhbWFnZSBncm93IGEgbGl0dGxlIHBlciBsZXZlbCkuIEVuZW1pZXMgbmV2ZXIgdXNlIHRoZW0uICovXG4gIC8qKiBgZW5lbXlQb3dlcmA6IGhlYWx0aCBhbmQgZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBlbmVteSB0ZWFtIG9ubHkgKHN0YWdlIHN0cmVuZ3RoOyAxID0gYXMgd3JpdHRlbikuICovXG4gIGNvbnN0cnVjdG9yKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSwgbGV2ZWxzPzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiwgZW5lbXlQb3dlciA9IDEpIHtcbiAgICB0aGlzLnJuZyA9IG1ha2VSbmcoc2VlZCk7IHRoaXMuZW5lbXlQb3dlciA9IGVuZW15UG93ZXI7XG4gICAgZm9yIChjb25zdCBwIG9mIHBsYXllcnMpIHRoaXMuYWRkKDAsIHAuc291bCwgcC5zdGFyLCBwLmNlbGwsIGxldmVscz8uW3Auc291bF0gPz8gMSk7XG4gICAgY29uc3QgY2VsbHMgPSBlbmVteUNlbGxzKGVuZW1pZXMpO1xuICAgIGVuZW1pZXMuZm9yRWFjaCgoZSwgaSkgPT4gdGhpcy5hZGQoMSwgZS5zb3VsLCBlLnN0YXIsIGNlbGxzW2ldLCAxLCAhIWUuYm9zcykpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIsIGxldmVsID0gMSwgYm9zcyA9IGZhbHNlKTogRmlnaHRlciB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tzb3VsXSwgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCk7XG4gICAgY29uc3QgbHZIcCA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmhwLCBsdkRtZyA9IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCLmxldmVsLmRtZztcbiAgICBjb25zdCBwdyA9IHRlYW0gPT09IDEgPyB0aGlzLmVuZW15UG93ZXIgOiAxO1xuICAgIGNvbnN0IGhwID0gc3QuaHAgKiBCLnN0YXIuaHBbc3RhciAtIDFdICogbHZIcCAqIHB3ICogKGJvc3MgPyAxICsgQk9TUy5ocCAqIGJvc3NTdHJlbmd0aCgpIDogMSk7XG4gICAgY29uc3QgZjogRmlnaHRlciA9IHtcbiAgICAgIGlkOiB0aGlzLm5leHRJZCsrLCB0ZWFtLCBzb3VsLCBzdGFyLCBjZWxsLCB4OiBwLngsIHo6IHAueiwgeWF3OiB0ZWFtID09PSAwID8gMCA6IE1hdGguUEksXG4gICAgICBocCwgbWF4SHA6IGhwLCBkbWc6IHN0LmRtZyAqIEIuc3Rhci5kbWdbc3RhciAtIDFdICogbHZEbWcgKiBwdyAqIChib3NzID8gMSArIEJPU1MuZG1nICogYm9zc1N0cmVuZ3RoKCkgOiAxKSwgaW50ZXJ2YWw6IHN0LmludGVydmFsLCByYW5nZTogc3QucmFuZ2UsIHNwZWVkOiBzdC5zcGVlZCwgcmFkaXVzOiBzdC5zaXplICogQi5zdGFyLnNjYWxlW3N0YXIgLSAxXSwgICAvLyAoYSBib3NzIG9ubHkgTE9PS1MgYmlnZ2VyOiBhIGxhcmdlciBjb2xsaXNpb24gcmFkaXVzIHdvdWxkIGtlZXAgbWVsZWUgdW5pdHMgb3V0IG9mIHJlYWNoKVxuICAgICAgYWxpdmU6IHRydWUsIHN0YXRlOiAnaWRsZScsIHRhcmdldDogLTEsIHJldGFyZ2V0QXQ6IDAsIGZvcmNlZFRhcmdldDogLTEsIGZvcmNlZFVudGlsOiAwLFxuICAgICAgbmV4dEF0dGFjazogdGhpcy5ybmcubmV4dCgpICogMC4zLCBhdHRhY2tTdGFydDogLTksIGF0dGFja0R1cjogMSwgYW5pbVNwZWVkOiAxLCBoaXRGcmFjOiAwLCBoaXREb25lOiB0cnVlLFxuICAgICAgbWFuYTogMCwgbWF4TWFuYTogQi5tYW5hW3NvdWxdPy5tYXggPz8gMCwgY2FzdGluZzogZmFsc2UsIGZyZW56eTogMCwgZGVhZEF0OiAwLCBib3NzLFxuICAgIH0gYXMgRmlnaHRlcjtcbiAgICB0aGlzLmZpZ2h0ZXJzLnB1c2goZik7IHJldHVybiBmO1xuICB9XG5cbiAgYnlJZChpZDogbnVtYmVyKTogRmlnaHRlciB8IHVuZGVmaW5lZCB7IHJldHVybiBpZCA8IDAgPyB1bmRlZmluZWQgOiB0aGlzLmZpZ2h0ZXJzW2lkIC0gMV07IH1cbiAgZm9lcyhmOiBGaWdodGVyKTogRmlnaHRlcltdIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8udGVhbSAhPT0gZi50ZWFtKTsgfVxuICBjb3VudCh0ZWFtOiAwIHwgMSk6IG51bWJlciB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLnJlZHVjZSgobiwgZikgPT4gbiArIChmLmFsaXZlICYmIGYudGVhbSA9PT0gdGVhbSA/IDEgOiAwKSwgMCk7IH1cbiAgZHJhaW4oKTogQkV2ZW50W10geyBjb25zdCBlID0gdGhpcy5ldmVudHM7IHRoaXMuZXZlbnRzID0gW107IHJldHVybiBlOyB9XG5cbiAgc3RlcChkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMud2lubmVyID49IDApIHJldHVybjtcbiAgICB0aGlzLnRpbWUgKz0gZHQ7IHRoaXMuZmxpcCA9ICF0aGlzLmZsaXA7XG4gICAgLy8gYXJyb3dzIHRoYXQgaGF2ZSBmaW5pc2hlZCBmbHlpbmdcbiAgICBmb3IgKGxldCBpID0gdGhpcy5wZW5kaW5nLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wZW5kaW5nW2ldO1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBwLmF0KSB7XG4gICAgICAgIHRoaXMucGVuZGluZy5zcGxpY2UoaSwgMSk7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5ieUlkKHAudG8pLCBmcm9tID0gdGhpcy5ieUlkKHAuZnJvbSk7XG4gICAgICAgIGlmICh0byAmJiB0by5hbGl2ZSAmJiBmcm9tKSB0aGlzLmRhbWFnZSh0bywgcC5kbWcsIGZyb20sICdhcnJvdycpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvcmRlciA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKHRoaXMuZmxpcCkgb3JkZXIucmV2ZXJzZSgpO1xuICAgIGZvciAoY29uc3QgZiBvZiBvcmRlcikgaWYgKGYuYWxpdmUpIHRoaXMudXBkYXRlKGYsIGR0KTtcbiAgICBjb25zdCBhID0gdGhpcy5jb3VudCgwKSwgYiA9IHRoaXMuY291bnQoMSk7XG4gICAgaWYgKCFhIHx8ICFiKSB0aGlzLndpbm5lciA9IGEgPyAwIDogMTtcbiAgICBlbHNlIGlmICh0aGlzLnRpbWUgPj0gQkFMQU5DRS5zaW0udGltZUxpbWl0KSB7XG4gICAgICBjb25zdCBocCA9ICh0OiAwIHwgMSkgPT4gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB0KS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCk7XG4gICAgICB0aGlzLndpbm5lciA9IGhwKDApID4gaHAoMSkgPyAwIDogMTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyLWZpZ2h0ZXIgdXBkYXRlXG4gIHByaXZhdGUgdXBkYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07XG4gICAgdGhpcy5zZXBhcmF0ZShmLCBkdCk7XG5cbiAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHtcbiAgICAgIGNvbnN0IHQgPSB0aGlzLnRpbWUgLSBmLmF0dGFja1N0YXJ0O1xuICAgICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAodGcgJiYgdGcuYWxpdmUpIHRoaXMuZmFjZShmLCB0Zy54IC0gZi54LCB0Zy56IC0gZi56LCBkdCk7XG4gICAgICBpZiAoIWYuaGl0RG9uZSAmJiB0ID49IGYuYXR0YWNrRHVyICogc3QuaGl0RnJhYykgeyBmLmhpdERvbmUgPSB0cnVlOyB0aGlzLnJlc29sdmVIaXQoZik7IH1cbiAgICAgIGlmICh0ID49IGYuYXR0YWNrRHVyKSBmLnN0YXRlID0gJ2lkbGUnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFjcXVpcmUoZik7XG4gICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmICghdGcgfHwgIXRnLmFsaXZlKSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IHJldHVybjsgfVxuICAgIGNvbnN0IGR4ID0gdGcueCAtIGYueCwgZHogPSB0Zy56IC0gZi56LCBkaXN0ID0gTWF0aC5oeXBvdChkeCwgZHopO1xuICAgIHRoaXMuZmFjZShmLCBkeCwgZHosIGR0KTtcbiAgICBpZiAoZGlzdCA8PSBmLnJhbmdlKSB7XG4gICAgICBpZiAodGhpcy50aW1lID49IGYubmV4dEF0dGFjaykgdGhpcy5zdGFydEF0dGFjayhmKTsgZWxzZSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IH1cbiAgICB9IGVsc2Uge1xuICAgICAgZi5zdGF0ZSA9ICdydW4nOyBsZXQgbXggPSBkeCAvIE1hdGgubWF4KGRpc3QsIDFlLTQpLCBteiA9IGR6IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCk7XG4gICAgICAvLyB3YWxrIEFST1VORCBhbnlvbmUgc3RhbmRpbmcgaW4gdGhlIHdheSAoYWxsaWVzIGFuZCBlbmVtaWVzIGFsaWtlLCBleGNlcHQgdGhlIHRhcmdldCk6IGVhY2ggYmxvY2tlciBhaGVhZCBiZW5kcyB0aGUgaGVhZGluZyBhd2F5IGZyb20gaXRcbiAgICAgIGxldCBzeCA9IDAsIHN6ID0gMDtcbiAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChvID09PSBmIHx8ICFvLmFsaXZlIHx8IG8uaWQgPT09IHRnLmlkKSBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgb3ggPSBvLnggLSBmLngsIG96ID0gby56IC0gZi56LCBhbG9uZyA9IG94ICogbXggKyBveiAqIG16LCByZWFjaCA9IGYucmFkaXVzICsgby5yYWRpdXMgKyAwLjM1O1xuICAgICAgICBpZiAoYWxvbmcgPD0gMCB8fCBhbG9uZyA+IHJlYWNoICsgMC45KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgbGF0ID0gb3ggKiAtbXogKyBveiAqIG14LCBuZWVkID0gZi5yYWRpdXMgKyBvLnJhZGl1cyArIDAuMTI7IGlmIChNYXRoLmFicyhsYXQpID49IG5lZWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBzaWRlID0gbGF0ID09PSAwID8gKGYuaWQgJSAyID8gMSA6IC0xKSA6IChsYXQgPiAwID8gLTEgOiAxKSwgdyA9ICgxIC0gTWF0aC5hYnMobGF0KSAvIG5lZWQpICogKDEgLSBNYXRoLm1heCgwLCBhbG9uZyAtIHJlYWNoKSAvIDAuOSk7XG4gICAgICAgIHN4ICs9IC1teiAqIHNpZGUgKiB3ICogMS42OyBzeiArPSBteCAqIHNpZGUgKiB3ICogMS42O1xuICAgICAgfVxuICAgICAgaWYgKHN4IHx8IHN6KSB7IG14ICs9IHN4OyBteiArPSBzejsgY29uc3QgbCA9IE1hdGguaHlwb3QobXgsIG16KSB8fCAxOyBteCAvPSBsOyBteiAvPSBsOyB9XG4gICAgICBmLnggKz0gbXggKiBmLnNwZWVkICogZHQ7IGYueiArPSBteiAqIGYuc3BlZWQgKiBkdDsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICAvKipcbiAgICogS2VlcCBmaWdodGVycyBmcm9tIHN0YWNraW5nIHdpdGhvdXQgc2hvdmluZyBhbnlvbmUgYWNyb3NzIHRoZSBtYXAuXG4gICAqIC0gQSBmaWdodGVyIHRoYXQgaXMgc3RhbmRpbmcgYW5kIGZpZ2h0aW5nIGlzIFwicGxhbnRlZFwiOiBpdCBiYXJlbHkgbW92ZXM7IHRoZSBvbmVzIHN0aWxsIFdBTEtJTkcgeWllbGQgdG8gaXQuXG4gICAqIC0gSGVhdmllciB1bml0cyAoT2dyZSwgS25pZ2h0KSBwdXNoIGxpZ2h0ZXIgb25lcyBtb3JlIHRoYW4gdGhlIG90aGVyIHdheSByb3VuZC5cbiAgICogLSBUaGUgdG90YWwgcHVzaCBvbiBvbmUgZmlnaHRlciBpcyBjYXBwZWQgcGVyIHNlY29uZCwgc28gYSBjcm93ZCBjYW4gbmV2ZXIgc2xpZGUgYSB1bml0IGZhci5cbiAgICovXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IHBsYW50ZWQgPSAodTogRmlnaHRlcikgPT4gdS5zdGF0ZSA9PT0gJ2F0dGFjaycgfHwgdS5zdGF0ZSA9PT0gJ2lkbGUnLCBtYXNzID0gKHU6IEZpZ2h0ZXIpID0+IHUucmFkaXVzICogdS5yYWRpdXM7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgbGV0IHNoYXJlID0gbWFzcyhvKSAvIChtYXNzKGYpICsgbWFzcyhvKSk7ICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgbGlnaHRlciBvbmUgb2YgdGhlIHBhaXIgbW92ZXMgbW9yZVxuICAgICAgY29uc3QgcGYgPSBwbGFudGVkKGYpLCBwbyA9IHBsYW50ZWQobyk7XG4gICAgICBpZiAocGYgJiYgIXBvKSBzaGFyZSAqPSAwLjEyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZiBpcyBzdGFuZGluZyBpdHMgZ3JvdW5kOiB0aGUgd2Fsa2VyIG8gZ29lcyBhcm91bmRcbiAgICAgIGVsc2UgaWYgKCFwZiAmJiBwbykgc2hhcmUgPSBNYXRoLm1pbigxLCBzaGFyZSAqIDEuNSArIDAuMzUpOyAgICAvLyBmIGlzIHdhbGtpbmcgaW50byBhIHBsYW50ZWQgdW5pdDogZiB5aWVsZHNcbiAgICAgIGVsc2UgaWYgKHBmICYmIHBvKSBzaGFyZSAqPSAwLjM1OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0d28gc3RhbmRpbmcgdW5pdHMgb3ZlcmxhcCBhIGxpdHRsZTogZWFzZSBhcGFydCB2ZXJ5IHNsb3dseVxuICAgICAgY29uc3QgayA9ICgod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMykpICogc2hhcmUgKiAyO1xuICAgICAgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBsZXQgbXggPSBweCAqIHMsIG16ID0gcHogKiBzO1xuICAgIGNvbnN0IGNhcCA9IChwbGFudGVkKGYpID8gMC41IDogMS42KSAqIGR0LCBsZW4gPSBNYXRoLmh5cG90KG14LCBteik7ICAgLy8gbWV0cmVzIHBlciBzZWNvbmQsIHN0YW5kaW5nIHZzIHdhbGtpbmdcbiAgICBpZiAobGVuID4gY2FwKSB7IG14ICo9IGNhcCAvIGxlbjsgbXogKj0gY2FwIC8gbGVuOyB9XG4gICAgZi54ICs9IG14OyBmLnogKz0gbXo7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicgJiYgY3VyICYmIGN1ci5hbGl2ZSAmJiBNYXRoLmh5cG90KGN1ci54IC0gZi54LCBjdXIueiAtIGYueikgPD0gZi5yYW5nZSAqIDEuMykgcmV0dXJuOyAgIC8vIGFscmVhZHkgaW4gcmVhY2ggb2Ygc29tZW9uZTogaGl0IHRoZW0sIGRvbid0IHdhbmRlciBvZmYgYWZ0ZXIgYSBqdWljaWVyIHRhcmdldFxuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJyAmJiBvLmlkID09PSBmLnRhcmdldCkgc2NvcmUgLT0gMS41OyAgIC8vIHN0aWNrIHdpdGggYSB0YXJnZXQgdW5sZXNzIGFub3RoZXIgaXMgY2xlYXJseSBiZXR0ZXJcbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzAsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQsIGxldmVscywgZW5lbXlQb3dlcik7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgImltcG9ydCB7IENVUlZFUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzIH0gZnJvbSAnLi9kYXRhLnRzJztcblxuLyoqXG4gKiBSdWxlcyBmb3IgdGhlIHBsYXlhYmxlIFN0YWdlIDEgKDEwIHdhdmVzKTogZG9jIERvbWluaW9uIGN1cnZlLCBib251cyBkcmF3IG9ubHkgb24gdGhlIGVhcmx5IHdhdmVzLlxuICogbWVyZ2UgJ2hhbmRJbnRvT25lU3Rhcic6IGEgMS1zdGFyIGNhcmQgaW4gaGFuZCBjYW4gbWVyZ2Ugc3RyYWlnaHQgaW50byBhIG1hdGNoaW5nIGRlcGxveWVkIDEtc3RhciB1bml0IChwYXlpbmcgb25seSB0aGUgY29zdFxuICogZGlmZmVyZW5jZSkuIFdpdGhvdXQgaXQgdGhlIGNhcCBjYW4gYmxvY2sgYSBtZXJnZSB5b3UgY291bGQgYWZmb3JkICh5b3Ugd291bGQgbmVlZCByb29tIHRvIHN1bW1vbiBCT1RIIGNvcGllcyBmaXJzdCkuXG4gKiBUaGUgZGVidWcgcGFuZWwgY2FuIHN3aXRjaCB0aGlzIGJhY2sgdG8gdGhlIGRvYydzIGRlcGxveWVkLW9ubHkgcnVsZS5cbiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPVFlQRV9SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBDVVJWRVMuZG9jLCBtZXJnZTogJ2hhbmRJbnRvT25lU3RhcicsIHN0YWdlV2F2ZXM6IDEwLCBub3JtYWxEcmF3V2F2ZXM6IFsyLCAzLCA0LCA1XSB9O1xuXG4vKipcbiAqIEVuZGxlc3MgRGVwdGhzOiB0aGUgY2FtcGFpZ24ncyBEb21pbmlvbiBjdXJ2ZSBmb3Igd2F2ZXMgMS0xMCwgdGhlbiBoZWxkIGF0IDQwICh0aGUgcGxheWVyJ3MgYXJteSBpcyBjYXBwZWQgb24gcHVycG9zZTsgdGhlIGVuZW15IGtlZXBzIGdyb3dpbmcsIHNlZSBlbmRsZXNzLnRzKS5cbiAqIFRoZSBjdXJ2ZSBpcyBsb25nIGVub3VnaCB0aGF0IGEgcnVuIGVuZHMgYnkgbG9zaW5nIGhlYXJ0cywgbmV2ZXIgYnkgXCJjbGVhcmluZ1wiIHRoZSBzdGFnZSAoY29yZS9ydWxlcy50cyByZWFkcyBjdXJ2ZVt3YXZlLTFdKS5cbiAqL1xuY29uc3QgRU5ETEVTU19MRU4gPSAzMDA7XG5leHBvcnQgY29uc3QgRU5ETEVTU19SVUxFUzogUnVsZXMgPSB7IGN1cnZlOiBBcnJheS5mcm9tKHsgbGVuZ3RoOiBFTkRMRVNTX0xFTiB9LCAoXywgaSkgPT4gQ1VSVkVTLmRvY1tNYXRoLm1pbihpLCBDVVJWRVMuZG9jLmxlbmd0aCAtIDEpXSksIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogRU5ETEVTU19MRU4sIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG4iLCAiLy8gVGhlIERhaWx5IENoYWxsZW5nZTogU3RhZ2UgMSAoTm9ybWFsKSB3aXRoIE9ORSB0d2lzdCB0aGF0IGNoYW5nZXMgZXZlcnkgZGF5LiBFdmVyeW9uZSBnZXRzIHRoZSBzYW1lIHR3aXN0IGFuZCB0aGUgc2FtZSBzZWVkIG9uIHRoZSBzYW1lIGRheVxuLy8gKGJvdGggY29tZSBmcm9tIHRoZSBjYWxlbmRhciBkYXRlLCBzbyBubyBzZXJ2ZXIgaXMgbmVlZGVkKS4gUmV0cnkgYXMgb2Z0ZW4gYXMgeW91IGxpa2U7IHRoZSByZXdhcmQgKGEgcGFjayBhbmQgc29tZSBnb2xkKSBpcyBwYWlkIG9uY2UgcGVyIGRheS5cblxuaW1wb3J0IHsgQ09TVCwgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUFJPVE9UWVBFX1JVTEVTIH0gZnJvbSAnLi9wcm90b3R5cGUudHMnO1xuaW1wb3J0IHR5cGUgeyBFbmVteVNwZWMgfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB7IHdhdmVDb3N0IH0gZnJvbSAnLi93YXZlcy50cyc7XG5cbmV4cG9ydCBjb25zdCBEQUlMWV9JRCA9ICdkYWlseSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGFpbHlNb2Qge1xuICBpZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZztcbiAgcG93ZXI6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAvLyBoaWRkZW4gZW5lbXkgaGVhbHRoL2RhbWFnZSBtdWx0aXBsaWVyIGZvciB0aGUgZGF5XG4gIGNhcERlbHRhOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgLy8gY2hhbmdlIHRvIHRoZSBwbGF5ZXIncyBEb21pbmlvbiBldmVyeSB3YXZlIChuZXZlciBiZWxvdyBEQUlMWV9NSU5fQ0FQKVxuICBlbmVteT86ICh3OiBFbmVteVNwZWNbXSwgd2F2ZTogbnVtYmVyKSA9PiBFbmVteVNwZWNbXTsgICAvLyByZXdyaXRlcyBlYWNoIGVuZW15IHdhdmVcbn1cbmV4cG9ydCBjb25zdCBEQUlMWV9NSU5fQ0FQID0gNDtcbmNvbnN0IE1BWF9VTklUUyA9IDEyO1xuXG4vKiogQSBjcm93ZCBvZiBXYXJyaW9ycyBhbmQgR29ibGlucyB0aGF0IGNvc3RzIGFib3V0IGBidWRnZXRgIERvbWluaW9uLiAqL1xuZnVuY3Rpb24gY3Jvd2QoYnVkZ2V0OiBudW1iZXIpOiBFbmVteVNwZWNbXSB7XG4gIGNvbnN0IG91dDogRW5lbXlTcGVjW10gPSBbXTsgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGkgPSAwOyBvdXQubGVuZ3RoIDwgTUFYX1VOSVRTOyBpKyspIHtcbiAgICBjb25zdCBzb3VsID0gaSAlIDMgPT09IDIgPyAnZ29ibGluJyA6ICd3YXJyaW9yJzsgaWYgKENPU1Rbc291bF1bMF0gPiBsZWZ0KSBicmVhaztcbiAgICBvdXQucHVzaCh7IHNvdWwsIHN0YXI6IDEgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVswXTtcbiAgfVxuICByZXR1cm4gb3V0Lmxlbmd0aCA/IG91dCA6IFt7IHNvdWw6ICd3YXJyaW9yJywgc3RhcjogMSB9XTtcbn1cblxuZXhwb3J0IGNvbnN0IE1PRElGSUVSUzogRGFpbHlNb2RbXSA9IFtcbiAgeyBpZDogJ2VtcG93ZXJlZCcsIG5hbWU6ICdFbXBvd2VyZWQnLCB0ZXh0OiAnRW5lbWllcyBhcmUgMjUlIHN0cm9uZ2VyLicsIHBvd2VyOiAxLjI1LCBjYXBEZWx0YTogMCB9LFxuICB7IGlkOiAnbWVsZWUnLCBuYW1lOiAnTm8gQXJjaGVycycsIHRleHQ6ICdFbmVteSBBcmNoZXJzIGFyZSByZXBsYWNlZCBieSBXYXJyaW9ycywgYnV0IGV2ZXJ5b25lIGhpdHMgaGFyZGVyLicsIHBvd2VyOiAxLjE1LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IHcubWFwKChlKSA9PiAoZS5zb3VsID09PSAnYXJjaGVyJyA/IHsgc291bDogJ3dhcnJpb3InIGFzIGNvbnN0LCBzdGFyOiBlLnN0YXIgfSA6IGUpKSB9LFxuICB7IGlkOiAnc3dhcm0nLCBuYW1lOiAnU3dhcm0nLCB0ZXh0OiAnV2F2ZXMgYXJlIGNyb3dkcyBvZiBXYXJyaW9ycyBhbmQgR29ibGlucy4nLCBwb3dlcjogMC44NSwgY2FwRGVsdGE6IDAsXG4gICAgZW5lbXk6ICh3KSA9PiBjcm93ZChNYXRoLnJvdW5kKHdhdmVDb3N0KHcpICogMS4xNSkpIH0sXG4gIHsgaWQ6ICdjcmFtcGVkJywgbmFtZTogJ0NyYW1wZWQnLCB0ZXh0OiAnWW91ciBEb21pbmlvbiBpcyA0IGxvd2VyIGV2ZXJ5IHdhdmUuJywgcG93ZXI6IDEsIGNhcERlbHRhOiAtNCB9LFxuICB7IGlkOiAndmV0ZXJhbnMnLCBuYW1lOiAnVmV0ZXJhbnMnLCB0ZXh0OiAnRW5lbXkgT2dyZXMgYW5kIEtuaWdodHMgYXJlIGEgc3RhciBoaWdoZXIuJywgcG93ZXI6IDAuOSwgY2FwRGVsdGE6IDAsXG4gICAgZW5lbXk6ICh3KSA9PiB3Lm1hcCgoZSkgPT4gKGUuc291bCA9PT0gJ29ncmUnIHx8IGUuc291bCA9PT0gJ2tuaWdodCcgPyB7IHNvdWw6IGUuc291bCwgc3RhcjogTWF0aC5taW4oMywgZS5zdGFyICsgMSkgfSA6IGUpKSB9LFxuXTtcblxuLyoqIFdob2xlIGRheXMgc2luY2UgMSBKYW51YXJ5IDE5NzAgaW4gdGhlIHBsYXllcidzIG93biBjYWxlbmRhciAodGhlIGRheSBjaGFuZ2VzIGF0IHRoZWlyIG1pZG5pZ2h0KS4gKi9cbmV4cG9ydCBjb25zdCBkYXlOdW1iZXIgPSAoZDogRGF0ZSA9IG5ldyBEYXRlKCkpOiBudW1iZXIgPT4gTWF0aC5mbG9vcihEYXRlLlVUQyhkLmdldEZ1bGxZZWFyKCksIGQuZ2V0TW9udGgoKSwgZC5nZXREYXRlKCkpIC8gODY0MDAwMDApO1xuZXhwb3J0IGNvbnN0IGlzVmFsaWREYXkgPSAobjogbnVtYmVyKTogYm9vbGVhbiA9PiBOdW1iZXIuaXNJbnRlZ2VyKG4pICYmIG4gPiAwICYmIG4gPCAxZTY7XG5leHBvcnQgY29uc3QgbW9kaWZpZXJGb3IgPSAoZGF5OiBudW1iZXIpOiBEYWlseU1vZCA9PiBNT0RJRklFUlNbKChkYXkgJSBNT0RJRklFUlMubGVuZ3RoKSArIE1PRElGSUVSUy5sZW5ndGgpICUgTU9ESUZJRVJTLmxlbmd0aF07XG4vKiogVGhlIHBsYXllcidzIHJ1bGVzIGZvciB0aGUgZGF5OiB0aGUgY2FtcGFpZ24ncyBEb21pbmlvbiBjdXJ2ZSwgc2hpZnRlZCBieSB0aGUgbW9kaWZpZXIuICovXG5leHBvcnQgZnVuY3Rpb24gZGFpbHlSdWxlcyhtb2Q6IERhaWx5TW9kLCBwb29sOiBSdWxlc1sncG9vbCddKTogUnVsZXMge1xuICByZXR1cm4geyAuLi5QUk9UT1RZUEVfUlVMRVMsIGN1cnZlOiBDVVJWRVMuZG9jLm1hcCgoYykgPT4gTWF0aC5tYXgoREFJTFlfTUlOX0NBUCwgYyArIG1vZC5jYXBEZWx0YSkpLCBwb29sIH07XG59XG4iLCAiLy8gU291bCBQYWNrcyAocGxhbiBkb2Mgc2VjdGlvbiAxNykuIFB1cmUgcnVsZXMsIG5vIGdyYXBoaWNzLiBBTEwgTlVNQkVSUyBBUkUgUExBQ0VIT0xERVIgTEVWRVJTOiB3ZSBzZXR0bGVkIHRoZSBzdHJ1Y3R1cmUgZmlyc3QgYW5kIHdpbGwgdHVuZVxuLy8gcXVhbnRpdGllcyB3aXRoIHRoZSBwcm9ncmVzc2lvbiBzaW11bGF0aW9uIChzaW0vcHJvZ3Jlc3Npb24udHMpIG9uY2UgdGhlIGxvb3AgY2FuIGJlIHBsYXllZC5cbi8vXG4vLyAgIFNvdWwgcmFyaXR5ICAtPiBob3cgb2Z0ZW4gYSBTb3VsIHNob3dzIHVwIGFuZCBob3cgYmlnIGl0cyBzdGFjayBvZiBjb3BpZXMgdGVuZHMgdG8gYmUuXG4vLyAgIFBhY2sgdGllciAgICAtPiB0aGUgcGFjaydzIG92ZXJhbGwgdmFsdWUgKHNrdWxscywgMS0zIGZvciBub3cpOiBudW1iZXIgb2YgcmV2ZWFscyArIGhvdyBnb29kIHRoZSByYXJpdHkgb2RkcyBhcmUuXG4vLyAgIEEgcGFjayBoYXMgYSBTVEFSVElORyB0aWVyIGFuZCBtYXkgdXBncmFkZSB3aGlsZSBpdCBpcyBiZWluZyBvcGVuZWQ7IHRoZSByZXN1bHQgaXMgZGVjaWRlZCB1cCBmcm9udCwgdGhlIGFuaW1hdGlvbiBvbmx5IHNob3dzIGl0LlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IHR5cGUgUmFyaXR5ID0gJ2NvbW1vbicgfCAncmFyZScgfCAnZXBpYycgfCAnbGVnZW5kYXJ5JztcbmV4cG9ydCBjb25zdCBSQVJJVElFUzogUmFyaXR5W10gPSBbJ2NvbW1vbicsICdyYXJlJywgJ2VwaWMnLCAnbGVnZW5kYXJ5J107XG5leHBvcnQgY29uc3QgUkFSSVRZX05BTUU6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJ0NvbW1vbicsIHJhcmU6ICdSYXJlJywgZXBpYzogJ0VwaWMnLCBsZWdlbmRhcnk6ICdMZWdlbmRhcnknIH07XG5cbi8qKiBSYXJpdHkgcGVyIFNvdWwuIFBMQUNFSE9MREVSIGFzc2lnbm1lbnQgKG5vIExlZ2VuZGFyeSBTb3VsIGV4aXN0cyB5ZXQpLiAqL1xuZXhwb3J0IGNvbnN0IFJBUklUWV9PRjogUmVjb3JkPFNvdWxJZCwgUmFyaXR5PiA9IHsgd2FycmlvcjogJ2NvbW1vbicsIGdvYmxpbjogJ2NvbW1vbicsIGFyY2hlcjogJ3JhcmUnLCBrbmlnaHQ6ICdyYXJlJywgb2dyZTogJ2VwaWMnLCBiYXJiYXJpYW46ICdlcGljJyB9O1xuXG4vKiogUmFyZXIgU291bHMgdHVybiB1cCBpbiBzbWFsbGVyIHN0YWNrcywgc28gdGhleSBuZWVkIGZld2VyIGNvcGllcyBwZXIgbGV2ZWwgKG11bHRpcGxpZXIgb24gdGhlIGxldmVsIGNvc3RzKS4gUExBQ0VIT0xERVIuICovXG5leHBvcnQgY29uc3QgTEVWRUxfQ09TVF9NVUxUOiBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+ID0geyBjb21tb246IDEsIHJhcmU6IDAuNiwgZXBpYzogMC4zNSwgbGVnZW5kYXJ5OiAwLjIgfTtcblxuZXhwb3J0IGNvbnN0IFBBQ0tfVElFUlMgPSAzO1xuZXhwb3J0IGNvbnN0IFBBQ0sgPSB7XG4gIHJldmVhbHM6IFszLCA0LCA1XSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNlcGFyYXRlIHJldmVhbHMgcGVyIHRpZXIgKGluZGV4IDAgPSB0aWVyIDEpXG4gIHN0YWNrTXVsdDogWzEsIDEuNSwgMl0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvcHkgc3RhY2tzIGFyZSBiaWdnZXIgaW4gYmV0dGVyIHBhY2tzXG4gIC8qKiBSYXJpdHkgb2RkcyBwZXIgdGllciwgaW4gcGVyY2VudC4gKi9cbiAgb2RkczogW1xuICAgIHsgY29tbW9uOiA3MCwgcmFyZTogMjUsIGVwaWM6IDUsIGxlZ2VuZGFyeTogMCB9LFxuICAgIHsgY29tbW9uOiA1NSwgcmFyZTogMzMsIGVwaWM6IDExLCBsZWdlbmRhcnk6IDEgfSxcbiAgICB7IGNvbW1vbjogNDAsIHJhcmU6IDM4LCBlcGljOiAxOSwgbGVnZW5kYXJ5OiAzIH0sXG4gIF0gYXMgUmVjb3JkPFJhcml0eSwgbnVtYmVyPltdLFxuICAvKiogQ29waWVzIGluIG9uZSByZXZlYWwgYmVmb3JlIHRoZSB0aWVyIG11bHRpcGxpZXI6IFttaW4sIG1heF0uICovXG4gIHN0YWNrOiB7IGNvbW1vbjogWzYsIDEwXSwgcmFyZTogWzMsIDVdLCBlcGljOiBbMSwgM10sIGxlZ2VuZGFyeTogWzEsIDFdIH0gYXMgUmVjb3JkPFJhcml0eSwgW251bWJlciwgbnVtYmVyXT4sXG4gIC8qKiBDaGFuY2UgdG8ganVtcCB1cCBvbmUgdGllciBkdXJpbmcgdGhlIG9wZW5pbmcsIGZyb20gdGllciAxIGFuZCBmcm9tIHRpZXIgMiAoYSBsdWNreSBwYWNrIGNhbiBqdW1wIHR3aWNlKS4gKi9cbiAgdXBncmFkZUNoYW5jZTogWzAuMiwgMC4xMl0sXG59O1xuXG4vKiogQW4gdW5vcGVuZWQgcGFjayB0aGUgcGxheWVyIG93bnMuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhY2tJdGVtIHsgaWQ6IG51bWJlcjsgdGllcjogbnVtYmVyOyBzb3VyY2U6IHN0cmluZyB9XG5leHBvcnQgaW50ZXJmYWNlIFJldmVhbCB7IHNvdWw6IFNvdWxJZDsgcmFyaXR5OiBSYXJpdHk7IGNvcGllczogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgUGFja1Jlc3VsdCB7IHN0YXJ0VGllcjogbnVtYmVyOyBmaW5hbFRpZXI6IG51bWJlcjsgdXBncmFkZXM6IG51bWJlcltdOyByZXZlYWxzOiBSZXZlYWxbXSB9XG5cbmNvbnN0IHJhcml0eVJhbmsgPSAocjogUmFyaXR5KSA9PiBSQVJJVElFUy5pbmRleE9mKHIpO1xuXG5mdW5jdGlvbiByb2xsUmFyaXR5KHRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBSYXJpdHkge1xuICBjb25zdCBvZGRzID0gUEFDSy5vZGRzW3RpZXIgLSAxXTsgbGV0IHJvbGwgPSBybmcubmV4dCgpICogUkFSSVRJRVMucmVkdWNlKChuLCByKSA9PiBuICsgb2Rkc1tyXSwgMCk7XG4gIGZvciAoY29uc3QgciBvZiBSQVJJVElFUykgeyBpZiAocm9sbCA8IG9kZHNbcl0pIHJldHVybiByOyByb2xsIC09IG9kZHNbcl07IH1cbiAgcmV0dXJuICdjb21tb24nO1xufVxuXG4vKiogQSByYW5kb20gU291bCBvZiB0aGlzIHJhcml0eTsgaWYgdGhlIHJvc3RlciBoYXMgbm9uZSBvZiB0aGF0IHJhcml0eSB5ZXQsIHRoZSBuZXh0IGxvd2VyIG9uZSBpcyB1c2VkLiAqL1xuZnVuY3Rpb24gc291bE9mUmFyaXR5KHJhcml0eTogUmFyaXR5LCBybmc6IFJuZyk6IFNvdWxJZCB7XG4gIGZvciAobGV0IGkgPSByYXJpdHlSYW5rKHJhcml0eSk7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHBvb2wgPSBTT1VMUy5maWx0ZXIoKHMpID0+IFJBUklUWV9PRltzXSA9PT0gUkFSSVRJRVNbaV0pOyBpZiAocG9vbC5sZW5ndGgpIHJldHVybiBybmcucGljayhwb29sKTsgfVxuICByZXR1cm4gcm5nLnBpY2soU09VTFMpO1xufVxuXG4vKiogT3BlbiBhIHBhY2s6IHJvbGwgdXBncmFkZXMgZmlyc3QgKHNvIHRoZSBhbmltYXRpb24gY2FuIHBsYXkgdGhlbSBiZWZvcmUgdGhlIHBhY2sgdGVhcnMgb3BlbiksIHRoZW4gdGhlIHJldmVhbHMuIEJlc3QgcmV2ZWFsIGNvbWVzIGxhc3QuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblBhY2soc3RhcnRUaWVyOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB7XG4gIGNvbnN0IHQwID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcihzdGFydFRpZXIpKSksIHVwZ3JhZGVzOiBudW1iZXJbXSA9IFtdO1xuICBsZXQgdGllciA9IHQwO1xuICB3aGlsZSAodGllciA8IFBBQ0tfVElFUlMgJiYgcm5nLm5leHQoKSA8IFBBQ0sudXBncmFkZUNoYW5jZVt0aWVyIC0gMV0pIHsgdGllcisrOyB1cGdyYWRlcy5wdXNoKHRpZXIpOyB9XG4gIGNvbnN0IHJldmVhbHM6IFJldmVhbFtdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgUEFDSy5yZXZlYWxzW3RpZXIgLSAxXTsgaSsrKSB7XG4gICAgY29uc3QgcmFyaXR5ID0gcm9sbFJhcml0eSh0aWVyLCBybmcpLCBzb3VsID0gc291bE9mUmFyaXR5KHJhcml0eSwgcm5nKSwgW2xvLCBoaV0gPSBQQUNLLnN0YWNrW1JBUklUWV9PRltzb3VsXV07XG4gICAgcmV2ZWFscy5wdXNoKHsgc291bCwgcmFyaXR5OiBSQVJJVFlfT0Zbc291bF0sIGNvcGllczogTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgobG8gKyBybmcuaW50KGhpIC0gbG8gKyAxKSkgKiBQQUNLLnN0YWNrTXVsdFt0aWVyIC0gMV0pKSB9KTtcbiAgfVxuICByZXZlYWxzLnNvcnQoKGEsIGIpID0+IHJhcml0eVJhbmsoYS5yYXJpdHkpIC0gcmFyaXR5UmFuayhiLnJhcml0eSkgfHwgYS5jb3BpZXMgLSBiLmNvcGllcyk7XG4gIHJldHVybiB7IHN0YXJ0VGllcjogdDAsIGZpbmFsVGllcjogdGllciwgdXBncmFkZXMsIHJldmVhbHMgfTtcbn1cblxuLyoqIFRvdGFsIGNvcGllcyBwZXIgU291bCBpbiBhIHJlc3VsdCAodGhlIHNhbWUgU291bCBjYW4gYmUgcmV2ZWFsZWQgbW9yZSB0aGFuIG9uY2UpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvcGllc0J5U291bChyZXN1bHQ6IFBhY2tSZXN1bHQpOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+IHtcbiAgY29uc3Qgb3V0OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+ID0ge307XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgb3V0W3Iuc291bF0gPSAob3V0W3Iuc291bF0gPz8gMCkgKyByLmNvcGllcztcbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3Mgc2F2ZWQgcHJvZ3Jlc3MuIEZyYW1ld29yay1mcmVlIHNvIHRoZSBnYW1lIGJ1bmRsZSBhbmQgdGhlIG5hdmlnYXRpb24gc2hlbGwgYm90aCB1c2UgaXQuXG4vLyBTdG9yZWQgaW4gbG9jYWxTdG9yYWdlIGFzIEpTT04uIEV2ZXJ5IHJlYWQvd3JpdGUgaXMgZ3VhcmRlZDogcHJpdmF0ZSB3aW5kb3dzIGFuZCBibG9ja2VkIHN0b3JhZ2UgbXVzdCBuZXZlciBicmVhayB0aGUgZ2FtZS5cblxuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgUEFDS19USUVSUyB9IGZyb20gJy4vcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBQYWNrSXRlbSB9IGZyb20gJy4vcGFja3MudHMnO1xuXG5leHBvcnQgY29uc3QgREVDS19TSVpFID0gNjsgICAgICAgICAgICAgICAgICAgICAvLyBkb2M6IHNpeCBlcXVpcHBlZCBTb3VscyBwZXIgc3RhZ2VcbmNvbnN0IEtFWSA9ICduZWNyby1zYXZlJztcbmNvbnN0IFZFUlNJT04gPSAxO1xuXG5leHBvcnQgdHlwZSBEaWZmaWN1bHR5ID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGSUNVTFRJRVM6IERpZmZpY3VsdHlbXSA9IFsnZWFzeScsICdub3JtYWwnLCAnaGFyZCcsICduaWdodG1hcmUnXTtcbmV4cG9ydCBpbnRlcmZhY2UgU2V0dGluZ3MgeyBtdXNpYzogYm9vbGVhbjsgc2Z4OiBib29sZWFuIH1cbmV4cG9ydCBpbnRlcmZhY2UgU291bFByb2dyZXNzIHsgbGV2ZWw6IG51bWJlcjsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTYXZlIHtcbiAgdjogbnVtYmVyO1xuICBkZWNrOiBTb3VsSWRbXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXF1aXBwZWQgU291bHMsIGF0IG1vc3QgREVDS19TSVpFLCBhdCBsZWFzdCAxXG4gIHNvdWxzOiBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+OyAgICAgICAgICAvLyBQTEFDRUhPTERFUiBwcm9ncmVzc2lvbiB1bnRpbCBwYWNrcyBleGlzdFxuICBzZXR0aW5nczogU2V0dGluZ3M7ICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc291bmQgc3dpdGNoZXM7IGJvdGggb24gYnkgZGVmYXVsdFxuICBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5OyAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hvc2VuIG9uIEhvbWU7IGFwcGxpZXMgdG8gdGhlIG5leHQgcnVuXG4gIHN0YWdlOiBzdHJpbmc7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgc3RhZ2UgcGlja2VkIG9uIEhvbWUgKGlkIGZyb20gd2F2ZXMudHMgU1RBR0VTKVxuICBzZWVuOiBzdHJpbmdbXSB8IG51bGw7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5sb2NrIGtleXMgd2hvc2UgY2VsZWJyYXRpb24gd2FzIGFscmVhZHkgc2hvd24gKG51bGw6IG9sZGVyIHNhdmUsIHNlZWRlZCBvbiBmaXJzdCBsb29rKVxuICBwYWNrczogUGFja0l0ZW1bXTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW5vcGVuZWQgU291bCBQYWNrc1xuICBuZXh0UGFja0lkOiBudW1iZXI7XG4gIGNsZWFyczogUmVjb3JkPHN0cmluZywgbnVtYmVyPjsgICAgICAgICAgICAgICAvLyBzdGFnZSBjbGVhcnMsIGtleWVkICdzdGFnZTpkaWZmaWN1bHR5J1xuICByZXBsYXlNZXRlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwbGF5IGNsZWFycyB0b3dhcmQgdGhlIG5leHQgcmVwbGF5IHBhY2tcbiAgZW5kbGVzczogeyBiZXN0OiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgIC8vIEVuZGxlc3MgRGVwdGhzOiB0aGUgZGVlcGVzdCB3YXZlIGNsZWFyZWRcbiAgZ29sZFNjYWxlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIDIgPSBnb2xkIGluIHRoZSBjdXJyZW50ICh4MTAwKSB1bml0czsgYSBzYXZlIHdpdGhvdXQgaXQgaG9sZHMgZ29sZCBpbiB0aGUgb2xkIHNtYWxsIHVuaXRzIGFuZCBpcyBjb252ZXJ0ZWQgb24gbG9hZFxuICBnb2xkOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc3BlbnQgb24gU291bCBsZXZlbC11cHMgKGFsb25nc2lkZSBjb3BpZXMpOyBlYXJuZWQgcGVyIHdhdmUgY2xlYXJlZCBhbmQgZnJvbSBvcGVuaW5nIHBhY2tzXG4gIGRhaWx5OiB7IGRheTogbnVtYmVyOyB3b246IGJvb2xlYW4gfSB8IG51bGw7ICAvLyB0aGUgbGFzdCBEYWlseSBDaGFsbGVuZ2UgZGF5IHBsYXllZCBhbmQgd2hldGhlciBpdHMgb25lLXRpbWUgcmV3YXJkIHdhcyB0YWtlblxufVxuLyoqIEdvbGQgZ2l2ZW4gb25jZSB0byBhIHNhdmUgdGhhdCBwcmVkYXRlcyBnb2xkIGFuZCBoYXMgcHJvZ3Jlc3MuICovXG5leHBvcnQgY29uc3QgQ0FUQ0hfVVBfR09MRCA9IDQwMDAwO1xuZXhwb3J0IGludGVyZmFjZSBTdG9yZSB7IGdldEl0ZW0oazogc3RyaW5nKTogc3RyaW5nIHwgbnVsbDsgc2V0SXRlbShrOiBzdHJpbmcsIHY6IHN0cmluZyk6IHZvaWQgfVxuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFNhdmUoKTogU2F2ZSB7XG4gIGNvbnN0IHNvdWxzID0ge30gYXMgUmVjb3JkPFNvdWxJZCwgU291bFByb2dyZXNzPjtcbiAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykgc291bHNbaWRdID0geyBsZXZlbDogMSwgY29waWVzOiAwIH07XG4gIHJldHVybiB7IHY6IFZFUlNJT04sIGRlY2s6IFNPVUxTLnNsaWNlKDAsIERFQ0tfU0laRSksIHNvdWxzLCBzZXR0aW5nczogeyBtdXNpYzogdHJ1ZSwgc2Z4OiB0cnVlIH0sIGRpZmZpY3VsdHk6ICdub3JtYWwnLCBzdGFnZTogJ2NyeXB0Jywgc2VlbjogW10sIHBhY2tzOiBbXSwgbmV4dFBhY2tJZDogMSwgY2xlYXJzOiB7fSwgcmVwbGF5TWV0ZXI6IDAsIGVuZGxlc3M6IHsgYmVzdDogMCB9LCBnb2xkU2NhbGU6IDIsIGdvbGQ6IDAsIGRhaWx5OiBudWxsIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicm93c2VyU3RvcmUoKTogU3RvcmUgfCBudWxsIHsgdHJ5IHsgcmV0dXJuIHR5cGVvZiBsb2NhbFN0b3JhZ2UgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IGxvY2FsU3RvcmFnZTsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9IH1cblxuLyoqIFJlcGFpciB3aGF0ZXZlciB3YXMgc3RvcmVkOiB1bmtub3duIFNvdWxzIGRyb3BwZWQsIGR1cGxpY2F0ZXMgcmVtb3ZlZCwgZGVjayBjYXBwZWQsIG5vdGhpbmcgZW1wdHkuIE9sZCB2ZXJzaW9ucyBrZWVwIHRoZWlyIHByb2dyZXNzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplKHJhdzogYW55KTogU2F2ZSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0U2F2ZSgpO1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IGRlY2s6IFNvdWxJZFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5kZWNrKSkgZm9yIChjb25zdCBkIG9mIHJhdy5kZWNrKSBpZiAoU09VTFMuaW5jbHVkZXMoZCkgJiYgIWRlY2suaW5jbHVkZXMoZCkgJiYgZGVjay5sZW5ndGggPCBERUNLX1NJWkUpIGRlY2sucHVzaChkKTtcbiAgaWYgKGRlY2subGVuZ3RoKSBiYXNlLmRlY2sgPSBkZWNrO1xuICBpZiAocmF3LnNvdWxzICYmIHR5cGVvZiByYXcuc291bHMgPT09ICdvYmplY3QnKSB7XG4gICAgZm9yIChjb25zdCBpZCBvZiBTT1VMUykge1xuICAgICAgY29uc3QgcCA9IHJhdy5zb3Vsc1tpZF07XG4gICAgICBpZiAocCAmJiBOdW1iZXIuaXNGaW5pdGUocC5sZXZlbCkgJiYgTnVtYmVyLmlzRmluaXRlKHAuY29waWVzKSkgYmFzZS5zb3Vsc1tpZF0gPSB7IGxldmVsOiBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHAubGV2ZWwpKSwgY29waWVzOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHAuY29waWVzKSkgfTtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5zZXR0aW5ncyAmJiB0eXBlb2YgcmF3LnNldHRpbmdzID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh0eXBlb2YgcmF3LnNldHRpbmdzLm11c2ljID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3MubXVzaWMgPSByYXcuc2V0dGluZ3MubXVzaWM7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3Muc2Z4ID09PSAnYm9vbGVhbicpIGJhc2Uuc2V0dGluZ3Muc2Z4ID0gcmF3LnNldHRpbmdzLnNmeDtcbiAgfVxuICBpZiAoRElGRklDVUxUSUVTLmluY2x1ZGVzKHJhdy5kaWZmaWN1bHR5KSkgYmFzZS5kaWZmaWN1bHR5ID0gcmF3LmRpZmZpY3VsdHk7XG4gIGlmICh0eXBlb2YgcmF3LnN0YWdlID09PSAnc3RyaW5nJyAmJiAvXlthLXowLTlfLV17MSwyNH0kLy50ZXN0KHJhdy5zdGFnZSkpIGJhc2Uuc3RhZ2UgPSByYXcuc3RhZ2U7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5zZWVuKSkgYmFzZS5zZWVuID0gcmF3LnNlZW4uZmlsdGVyKChrOiBhbnkpID0+IHR5cGVvZiBrID09PSAnc3RyaW5nJyAmJiBrLmxlbmd0aCA8IDQwKS5zbGljZSgtODApO1xuICBlbHNlIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyhyYXcuY2xlYXJzKS5sZW5ndGgpIGJhc2Uuc2VlbiA9IG51bGw7ICAgIC8vIGFuIGV4aXN0aW5nIHBsYXllcjogZG8gbm90IHJlcGxheSBvbGQgdW5sb2Nrc1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcucGFja3MpKSB7XG4gICAgY29uc3QgaWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHJhdy5wYWNrcykge1xuICAgICAgaWYgKGJhc2UucGFja3MubGVuZ3RoID49IDk5IHx8ICFwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHAuaWQpIHx8IHAuaWQgPCAxIHx8IGlkcy5oYXMocC5pZCkgfHwgIU51bWJlci5pc0ludGVnZXIocC50aWVyKSB8fCBwLnRpZXIgPCAxIHx8IHAudGllciA+IFBBQ0tfVElFUlMpIGNvbnRpbnVlO1xuICAgICAgaWRzLmFkZChwLmlkKTsgYmFzZS5wYWNrcy5wdXNoKHsgaWQ6IHAuaWQsIHRpZXI6IHAudGllciwgc291cmNlOiB0eXBlb2YgcC5zb3VyY2UgPT09ICdzdHJpbmcnID8gcC5zb3VyY2Uuc2xpY2UoMCwgNDApIDogJycgfSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IG1heElkID0gYmFzZS5wYWNrcy5yZWR1Y2UoKG4sIHApID0+IE1hdGgubWF4KG4sIHAuaWQpLCAwKTtcbiAgYmFzZS5uZXh0UGFja0lkID0gTWF0aC5tYXgobWF4SWQgKyAxLCBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5uZXh0UGFja0lkKSAmJiByYXcubmV4dFBhY2tJZCA+IDAgPyByYXcubmV4dFBhY2tJZCA6IDEpO1xuICBpZiAocmF3LmNsZWFycyAmJiB0eXBlb2YgcmF3LmNsZWFycyA9PT0gJ29iamVjdCcpIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHJhdy5jbGVhcnMpKSBpZiAodHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDAgJiYgTnVtYmVyLmlzSW50ZWdlcih2KSAmJiAodiBhcyBudW1iZXIpID4gMCkgYmFzZS5jbGVhcnNba10gPSB2IGFzIG51bWJlcjtcbiAgaWYgKE51bWJlci5pc0ludGVnZXIocmF3LnJlcGxheU1ldGVyKSAmJiByYXcucmVwbGF5TWV0ZXIgPj0gMCAmJiByYXcucmVwbGF5TWV0ZXIgPCA1MCkgYmFzZS5yZXBsYXlNZXRlciA9IHJhdy5yZXBsYXlNZXRlcjtcbiAgaWYgKHJhdy5lbmRsZXNzICYmIE51bWJlci5pc0ludGVnZXIocmF3LmVuZGxlc3MuYmVzdCkgJiYgcmF3LmVuZGxlc3MuYmVzdCA+PSAwICYmIHJhdy5lbmRsZXNzLmJlc3QgPD0gOTk5OSkgYmFzZS5lbmRsZXNzLmJlc3QgPSByYXcuZW5kbGVzcy5iZXN0O1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcuZ29sZCkgJiYgcmF3LmdvbGQgPj0gMCAmJiByYXcuZ29sZCA8PSAxZTkpIGJhc2UuZ29sZCA9IHJhdy5nb2xkU2NhbGUgPT09IDIgPyByYXcuZ29sZCA6IE1hdGgubWluKDFlOSwgcmF3LmdvbGQgKiAxMDApOyAgIC8vIGVhcmx5IHNhdmVzIGNvdW50ZWQgZ29sZCBpbiB1bml0cyAxMDAgdGltZXMgc21hbGxlclxuICBlbHNlIGlmIChyYXcuZ29sZCA9PT0gdW5kZWZpbmVkICYmIE9iamVjdC5rZXlzKGJhc2UuY2xlYXJzKS5sZW5ndGgpIGJhc2UuZ29sZCA9IENBVENIX1VQX0dPTEQ7ICAgICAgICAvLyBhIHBsYXllciBmcm9tIGJlZm9yZSBnb2xkIGV4aXN0ZWQ6IG9uZS10aW1lIGdyYW50IHNvIHRoZSBuZXcgY29zdCBkb2VzIG5vdCBsb2NrIHRoZWlyIHN0b2NrcGlsZWQgY29waWVzXG4gIGlmIChyYXcuZGFpbHkgJiYgTnVtYmVyLmlzSW50ZWdlcihyYXcuZGFpbHkuZGF5KSAmJiByYXcuZGFpbHkuZGF5ID4gMCAmJiByYXcuZGFpbHkuZGF5IDwgMWU2KSBiYXNlLmRhaWx5ID0geyBkYXk6IHJhdy5kYWlseS5kYXksIHdvbjogISFyYXcuZGFpbHkud29uIH07XG4gIHJldHVybiBiYXNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbG9hZFNhdmUoc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2F2ZSB7XG4gIHRyeSB7IGNvbnN0IHQgPSBzdG9yZSAmJiBzdG9yZS5nZXRJdGVtKEtFWSk7IHJldHVybiBzYW5pdGl6ZSh0ID8gSlNPTi5wYXJzZSh0KSA6IG51bGwpOyB9IGNhdGNoIHsgcmV0dXJuIGRlZmF1bHRTYXZlKCk7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHdyaXRlU2F2ZShzYXZlOiBTYXZlLCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlKSBzdG9yZS5zZXRJdGVtKEtFWSwgSlNPTi5zdHJpbmdpZnkoc2F2ZSkpOyB9IGNhdGNoIHsgLyogc3RvcmFnZSBmdWxsIG9yIGJsb2NrZWQ6IGtlZXAgcGxheWluZyAqLyB9XG59XG5cbi8qKiBDaGFuZ2Ugc291bmQgc2V0dGluZ3Mgd2l0aG91dCB0b3VjaGluZyB0aGUgcmVzdCBvZiB0aGUgc2F2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1cGRhdGVTZXR0aW5ncyhwYXRjaDogUGFydGlhbDxTZXR0aW5ncz4sIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IFNldHRpbmdzIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgcy5zZXR0aW5ncyA9IHsgLi4ucy5zZXR0aW5ncywgLi4ucGF0Y2ggfTsgd3JpdGVTYXZlKHMsIHN0b3JlKTsgcmV0dXJuIHMuc2V0dGluZ3M7XG59XG5cbi8qKiBSZW1lbWJlciB0aGUgY2hvc2VuIGRpZmZpY3VsdHkgd2l0aG91dCB0b3VjaGluZyB0aGUgcmVzdCBvZiB0aGUgc2F2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1cGRhdGVEaWZmaWN1bHR5KGQ6IERpZmZpY3VsdHksIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IERpZmZpY3VsdHkge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLmRpZmZpY3VsdHkgPSBESUZGSUNVTFRJRVMuaW5jbHVkZXMoZCkgPyBkIDogcy5kaWZmaWN1bHR5OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5kaWZmaWN1bHR5O1xufVxuIiwgIi8vIFBlcm1hbmVudCBwcm9ncmVzc2lvbjogc3RhZ2UgY2xlYXJzIC0+IFNvdWwgUGFja3MgLT4gY29waWVzIC0+IFNvdWwgbGV2ZWxzLiBQdXJlIGZ1bmN0aW9ucyB0aGF0IGNoYW5nZSBhIFNhdmUgKHRoZSBjYWxsZXIgcGVyc2lzdHMgaXQpLlxuLy8gUGxhY2Vob2xkZXIgbnVtYmVycywgbGlrZSBwYWNrcy50cy4gSW4tcnVuIHN0YXIgbWVyZ2luZyBpcyBhIHNlcGFyYXRlLCB0ZW1wb3Jhcnkgc3lzdGVtIGFuZCBuZXZlciB0b3VjaGVzIGFueSBvZiB0aGlzLlxuXG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi9iYWxhbmNlLnRzJztcbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IEVORExFU1NfUEFDS19FVkVSWSwgZW5kbGVzc1BhY2tUaWVyIH0gZnJvbSAnLi9lbmRsZXNzLnRzJztcbmltcG9ydCB7IExFVkVMX0NPU1RfTVVMVCwgUEFDS19USUVSUywgUkFSSVRZX09GLCBvcGVuUGFjayB9IGZyb20gJy4vcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBQYWNrSXRlbSwgUGFja1Jlc3VsdCB9IGZyb20gJy4vcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgeyBsb2FkU2F2ZSwgd3JpdGVTYXZlIH0gZnJvbSAnLi9zYXZlLnRzJztcbmltcG9ydCB7IFNUQUdFUywgc3RhZ2VCeUlkLCBzdGFnZUluZGV4IH0gZnJvbSAnLi93YXZlcy50cyc7XG5pbXBvcnQgdHlwZSB7IERpZmZpY3VsdHksIFNhdmUsIFN0b3JlIH0gZnJvbSAnLi9zYXZlLnRzJztcblxuZXhwb3J0IGNvbnN0IE1BWF9QQUNLUyA9IDk5O1xuXG4vKiogV2hlcmUgcGFja3MgY29tZSBmcm9tLiBQTEFDRUhPTERFUi4gRmlyc3QgY2xlYXIgb2YgYSBzdGFnZSBvbiBlYWNoIGRpZmZpY3VsdHkgZ2l2ZXMgb25lIGltcHJvdmVkIHBhY2s7IGxhdGVyIGNsZWFycyBmaWxsIGEgbWV0ZXIuICovXG5leHBvcnQgY29uc3QgUkVXQVJEUyA9IHtcbiAgZmlyc3RDbGVhclRpZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAyLCBoYXJkOiAyLCBuaWdodG1hcmU6IDMgfSBhcyBSZWNvcmQ8RGlmZmljdWx0eSwgbnVtYmVyPixcbiAgcmVwbGF5VGllcjogMSxcbiAgcmVwbGF5Q2xlYXJzUGVyUGFjazogMixcbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBsZXZlbHNcbmV4cG9ydCBjb25zdCBtYXhMZXZlbCA9ICgpOiBudW1iZXIgPT4gQkFMQU5DRS5sZXZlbC5jb3BpZXNUb0xldmVsLmxlbmd0aCArIDE7XG5leHBvcnQgY29uc3QgaXNNYXhMZXZlbCA9IChsZXZlbDogbnVtYmVyKTogYm9vbGVhbiA9PiBsZXZlbCA+PSBtYXhMZXZlbCgpO1xuLyoqIENvcGllcyBuZWVkZWQgdG8gdGFrZSBgc291bGAgZnJvbSBgbGV2ZWxgIHRvIHRoZSBuZXh0IG9uZSAoMCB3aGVuIGFscmVhZHkgbWF4KS4gUmFyZXIgU291bHMgbmVlZCBmZXdlci4gKi9cbmV4cG9ydCBjb25zdCBjb3BpZXNOZWVkZWQgPSAobGV2ZWw6IG51bWJlciwgc291bDogU291bElkKTogbnVtYmVyID0+IChpc01heExldmVsKGxldmVsKSA/IDAgOiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKEJBTEFOQ0UubGV2ZWwuY29waWVzVG9MZXZlbFtsZXZlbCAtIDFdICogTEVWRUxfQ09TVF9NVUxUW1JBUklUWV9PRltzb3VsXV0pKSk7XG4vKipcbiAqIE9uZSByZXF1aXJlbWVudCBvZiBhbiB1cGdyYWRlLiBUb2RheSBvbmx5IGNvcGllczsgdGhlIGNvbmZpcm0gcG9wdXAgbGlzdHMgZXZlcnkgZW50cnkgd2l0aCBoYXZlIC8gbmVlZCwgYW5kIENvbmZpcm0gaXMgYWxsb3dlZCBvbmx5IHdoZW4gYWxsIGFyZSBtZXQuXG4gKiBHb2xkIHdpbGwgc2ltcGx5IGJlY29tZSBhIHNlY29uZCBlbnRyeSBoZXJlICh7IGlkOiAnZ29sZCcsIC4uLiB9KSBhbmQgYmUgc3BlbnQgaW4gbGV2ZWxVcCgpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwZ3JhZGVDb3N0IHsgaWQ6ICdjb3BpZXMnIHwgJ2dvbGQnOyBsYWJlbDogc3RyaW5nOyBoYXZlOiBudW1iZXI7IG5lZWQ6IG51bWJlcjsgb2s6IGJvb2xlYW4gfVxuLyoqIEdvbGQgdG8gdGFrZSBhIFNvdWwgZnJvbSBgbGV2ZWxgIHRvIHRoZSBuZXh0IG9uZSAoMCBhdCBtYXgpLiAqL1xuZXhwb3J0IGNvbnN0IGdvbGROZWVkZWQgPSAobGV2ZWw6IG51bWJlcik6IG51bWJlciA9PiAoaXNNYXhMZXZlbChsZXZlbCkgPyAwIDogQkFMQU5DRS5sZXZlbC5nb2xkVG9MZXZlbFtsZXZlbCAtIDFdKTtcbmV4cG9ydCBmdW5jdGlvbiB1cGdyYWRlQ29zdHMoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogVXBncmFkZUNvc3RbXSB7XG4gIGNvbnN0IHAgPSBzYXZlLnNvdWxzW3NvdWxdOyBpZiAoaXNNYXhMZXZlbChwLmxldmVsKSkgcmV0dXJuIFtdO1xuICBjb25zdCBuZWVkID0gY29waWVzTmVlZGVkKHAubGV2ZWwsIHNvdWwpO1xuICBjb25zdCBnb2xkID0gZ29sZE5lZWRlZChwLmxldmVsKTtcbiAgcmV0dXJuIFt7IGlkOiAnY29waWVzJywgbGFiZWw6ICdDb3BpZXMnLCBoYXZlOiBwLmNvcGllcywgbmVlZCwgb2s6IHAuY29waWVzID49IG5lZWQgfSwgeyBpZDogJ2dvbGQnLCBsYWJlbDogJ0dvbGQnLCBoYXZlOiBzYXZlLmdvbGQsIG5lZWQ6IGdvbGQsIG9rOiBzYXZlLmdvbGQgPj0gZ29sZCB9XTtcbn1cbmV4cG9ydCBjb25zdCBjYW5BZmZvcmQgPSAoY29zdHM6IFVwZ3JhZGVDb3N0W10pOiBib29sZWFuID0+IGNvc3RzLmxlbmd0aCA+IDAgJiYgY29zdHMuZXZlcnkoKGMpID0+IGMub2spO1xuZXhwb3J0IGNvbnN0IGNhbkxldmVsVXAgPSAoc2F2ZTogU2F2ZSwgc291bDogU291bElkKTogYm9vbGVhbiA9PiBjYW5BZmZvcmQodXBncmFkZUNvc3RzKHNhdmUsIHNvdWwpKTtcbi8qKiBQYXkgZXZlcnkgY29zdCBhbmQgZ2FpbiBhIGxldmVsLiBSZXR1cm5zIGZhbHNlIChhbmQgY2hhbmdlcyBub3RoaW5nKSBpZiB0aGUgU291bCBpcyBub3QgcmVhZHkuICovXG5leHBvcnQgZnVuY3Rpb24gbGV2ZWxVcChzYXZlOiBTYXZlLCBzb3VsOiBTb3VsSWQpOiBib29sZWFuIHtcbiAgY29uc3QgY29zdHMgPSB1cGdyYWRlQ29zdHMoc2F2ZSwgc291bCk7IGlmICghY2FuQWZmb3JkKGNvc3RzKSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBwID0gc2F2ZS5zb3Vsc1tzb3VsXTsgZm9yIChjb25zdCBjIG9mIGNvc3RzKSB7IGlmIChjLmlkID09PSAnY29waWVzJykgcC5jb3BpZXMgLT0gYy5uZWVkOyBlbHNlIHNhdmUuZ29sZCAtPSBjLm5lZWQ7IH1cbiAgcC5sZXZlbCsrOyByZXR1cm4gdHJ1ZTtcbn1cbi8qKiBEZWJ1Z2dpbmc6IHB1dCBldmVyeSBTb3VsIGJhY2sgdG8gbGV2ZWwgMSAoY29waWVzIGFyZSBrZXB0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNldExldmVscyhzYXZlOiBTYXZlKTogdm9pZCB7IGZvciAoY29uc3QgayBvZiBTT1VMUykgc2F2ZS5zb3Vsc1trXS5sZXZlbCA9IDE7IH1cbi8qKiBEZWJ1Z2dpbmc6IGZvcmdldCBhbGwgY29sbGVjdGVkIGNvcGllcyAobGV2ZWxzIGFyZSBrZXB0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhckNvcGllcyhzYXZlOiBTYXZlKTogdm9pZCB7IGZvciAoY29uc3QgayBvZiBTT1VMUykgc2F2ZS5zb3Vsc1trXS5jb3BpZXMgPSAwOyB9XG4vKiogTXVsdGlwbGllciBhcHBsaWVkIHRvIGEgU291bCdzIGhlYWx0aC9kYW1hZ2UgZnJvbSBpdHMgcGVybWFuZW50IGxldmVsIChsZXZlbCAxID0gMS4wKS4gKi9cbmV4cG9ydCBjb25zdCBsZXZlbE11bHQgPSAobGV2ZWw6IG51bWJlciwgc3RhdDogJ2hwJyB8ICdkbWcnKTogbnVtYmVyID0+IDEgKyAoTWF0aC5tYXgoMSwgbGV2ZWwpIC0gMSkgKiBCQUxBTkNFLmxldmVsW3N0YXRdO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZ29sZFxuZXhwb3J0IGNvbnN0IEdPTEQgPSB7IHRpZXJNdWx0OiB7IGVhc3k6IDAuNiwgbm9ybWFsOiAxLCBoYXJkOiAxLjQsIG5pZ2h0bWFyZTogMiB9IGFzIFJlY29yZDxEaWZmaWN1bHR5LCBudW1iZXI+LCBwYWNrUGVyVGllcjogMTUwMCwgZGFpbHlXaW46IDUwMDAgfTtcbi8qKiBHb2xkIGZvciBjbGVhcmluZyBvbmUgY2FtcGFpZ24gd2F2ZTogbW9yZSBpbiBsYXRlciBzdGFnZXMgYW5kIG9uIGhhcmRlciB0aWVycy4gKi9cbmV4cG9ydCBjb25zdCB3YXZlR29sZCA9IChzdGFnZTogc3RyaW5nLCB0aWVyOiBEaWZmaWN1bHR5IHwgc3RyaW5nKTogbnVtYmVyID0+IE1hdGgubWF4KDEsIE1hdGgucm91bmQoMTAwICogKDYgKyAyICogc3RhZ2VJbmRleChzdGFnZSkpICogKEdPTEQudGllck11bHRbdGllciBhcyBEaWZmaWN1bHR5XSA/PyAxKSkpO1xuLyoqIEdvbGQgZm9yIGNsZWFyaW5nIG9uZSBFbmRsZXNzIHdhdmUuICovXG5leHBvcnQgY29uc3QgZW5kbGVzc1dhdmVHb2xkID0gKHdhdmU6IG51bWJlcik6IG51bWJlciA9PiAxMDAgKiAoOCArIE1hdGguZmxvb3IoMC42ICogTWF0aC5tYXgoMSwgd2F2ZSkpKTtcbi8qKiBHb2xkIGZvciBvcGVuaW5nIGEgcGFjayB0aGF0IGZpbmlzaGVkIGF0IGB0aWVyYC4gKi9cbmV4cG9ydCBjb25zdCBwYWNrR29sZCA9ICh0aWVyOiBudW1iZXIpOiBudW1iZXIgPT4gR09MRC5wYWNrUGVyVGllciAqIE1hdGgubWF4KDEsIHRpZXIpO1xuZXhwb3J0IGZ1bmN0aW9uIGFkZEdvbGQoc2F2ZTogU2F2ZSwgbjogbnVtYmVyKTogbnVtYmVyIHsgY29uc3QgZyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IobikpOyBzYXZlLmdvbGQgPSBNYXRoLm1pbigxZTksIHNhdmUuZ29sZCArIGcpOyByZXR1cm4gZzsgfVxuZXhwb3J0IGZ1bmN0aW9uIGFkZEdvbGRBbmRTYXZlKG46IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBudW1iZXIgeyBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBjb25zdCBnID0gYWRkR29sZChzLCBuKTsgd3JpdGVTYXZlKHMsIHN0b3JlKTsgcmV0dXJuIGc7IH1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBhY2tzXG5leHBvcnQgZnVuY3Rpb24gZ3JhbnRQYWNrKHNhdmU6IFNhdmUsIHRpZXI6IG51bWJlciwgc291cmNlOiBzdHJpbmcpOiBQYWNrSXRlbSB8IG51bGwge1xuICBpZiAoc2F2ZS5wYWNrcy5sZW5ndGggPj0gTUFYX1BBQ0tTKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGFjazogUGFja0l0ZW0gPSB7IGlkOiBzYXZlLm5leHRQYWNrSWQrKywgdGllcjogTWF0aC5tYXgoMSwgTWF0aC5taW4oUEFDS19USUVSUywgTWF0aC5mbG9vcih0aWVyKSkpLCBzb3VyY2UgfTtcbiAgc2F2ZS5wYWNrcy5wdXNoKHBhY2spOyByZXR1cm4gcGFjaztcbn1cblxuLyoqIE9wZW4gYW4gb3duZWQgcGFjazogaXQgaXMgcmVtb3ZlZCBhbmQgaXRzIGNvcGllcyBhcmUgYWRkZWQgdG8gdGhlIFNvdWxzIGltbWVkaWF0ZWx5IChzbyBub3RoaW5nIGlzIGxvc3QgaWYgdGhlIHBhZ2UgY2xvc2VzIG1pZC1hbmltYXRpb24pLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5Pd25lZFBhY2soc2F2ZTogU2F2ZSwgcGFja0lkOiBudW1iZXIsIHJuZzogUm5nKTogUGFja1Jlc3VsdCB8IG51bGwge1xuICBjb25zdCBpID0gc2F2ZS5wYWNrcy5maW5kSW5kZXgoKHApID0+IHAuaWQgPT09IHBhY2tJZCk7IGlmIChpIDwgMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhY2sgPSBzYXZlLnBhY2tzW2ldOyBzYXZlLnBhY2tzLnNwbGljZShpLCAxKTtcbiAgY29uc3QgcmVzdWx0ID0gb3BlblBhY2socGFjay50aWVyLCBybmcpO1xuICBmb3IgKGNvbnN0IHIgb2YgcmVzdWx0LnJldmVhbHMpIHNhdmUuc291bHNbci5zb3VsXS5jb3BpZXMgKz0gci5jb3BpZXM7XG4gIGFkZEdvbGQoc2F2ZSwgcGFja0dvbGQocmVzdWx0LmZpbmFsVGllcikpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENsZWFyUmV3YXJkIHsgZmlyc3Q6IGJvb2xlYW47IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgcmVwbGF5TWV0ZXI6IG51bWJlcjsgcmVwbGF5TmVlZGVkOiBudW1iZXI7IHVubG9ja2VkOiBzdHJpbmdbXSB9XG4vKiogQSBzdGFnZSB3YXMgY2xlYXJlZCBvbiBgZGlmZmljdWx0eWAuIFRoZSBmaXJzdCBjbGVhciBvbiB0aGF0IGRpZmZpY3VsdHkgZ3JhbnRzIGEgYmV0dGVyIHBhY2s7IGxhdGVyIGNsZWFycyBmaWxsIHRoZSByZXBsYXkgbWV0ZXIuICovXG5mdW5jdGlvbiByZWNvcmRDbGVhckJhc2Uoc2F2ZTogU2F2ZSwgc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5KTogT21pdDxDbGVhclJld2FyZCwgJ3VubG9ja2VkJz4ge1xuICBjb25zdCBrZXkgPSBzdGFnZUlkICsgJzonICsgZGlmZmljdWx0eSwgYmVmb3JlID0gc2F2ZS5jbGVhcnNba2V5XSA/PyAwO1xuICBzYXZlLmNsZWFyc1trZXldID0gYmVmb3JlICsgMTtcbiAgaWYgKGJlZm9yZSA9PT0gMCkgcmV0dXJuIHsgZmlyc3Q6IHRydWUsIHBhY2s6IGdyYW50UGFjayhzYXZlLCBSRVdBUkRTLmZpcnN0Q2xlYXJUaWVyW2RpZmZpY3VsdHldICsgKHN0YWdlSW5kZXgoc3RhZ2VJZCkgPT09IFNUQUdFUy5sZW5ndGggLSAxID8gMSA6IDApLCAnRmlyc3QgY2xlYXIgXHUwMEI3ICcgKyBkaWZmaWN1bHR5KSwgcmVwbGF5TWV0ZXI6IHNhdmUucmVwbGF5TWV0ZXIsIHJlcGxheU5lZWRlZDogUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrIH07XG4gIHNhdmUucmVwbGF5TWV0ZXIrKztcbiAgbGV0IHBhY2s6IFBhY2tJdGVtIHwgbnVsbCA9IG51bGw7XG4gIGlmIChzYXZlLnJlcGxheU1ldGVyID49IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjaykgeyBzYXZlLnJlcGxheU1ldGVyIC09IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjazsgcGFjayA9IGdyYW50UGFjayhzYXZlLCBSRVdBUkRTLnJlcGxheVRpZXIsICdSZXBsYXkgcmV3YXJkJyk7IH1cbiAgcmV0dXJuIHsgZmlyc3Q6IGZhbHNlLCBwYWNrLCByZXBsYXlNZXRlcjogc2F2ZS5yZXBsYXlNZXRlciwgcmVwbGF5TmVlZGVkOiBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2sgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHBlcnNpc3RlZCB3cmFwcGVycyAodXNlZCBieSB0aGUgZ2FtZSBidW5kbGUpXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQ2xlYXJBbmRTYXZlKHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBDbGVhclJld2FyZCB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IHIgPSByZWNvcmRDbGVhcihzLCBzdGFnZUlkLCBkaWZmaWN1bHR5KTsgd3JpdGVTYXZlKHMsIHN0b3JlKTsgcmV0dXJuIHI7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBEYWlseSBDaGFsbGVuZ2VcbmV4cG9ydCBpbnRlcmZhY2UgRGFpbHlSZXdhcmQgeyBmaXJzdDogYm9vbGVhbjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyBnb2xkOiBudW1iZXIgfVxuLyoqIFRoZSBkYXkncyBjaGFsbGVuZ2Ugd2FzIHdvbi4gT25seSB0aGUgZmlyc3Qgd2luIG9mIGEgZ2l2ZW4gZGF5IHBheXMgKGEgVGllciAxIHBhY2sgYW5kIHNvbWUgZ29sZCkuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRGFpbHlXaW4oc2F2ZTogU2F2ZSwgZGF5OiBudW1iZXIpOiBEYWlseVJld2FyZCB7XG4gIGlmIChzYXZlLmRhaWx5ICYmIHNhdmUuZGFpbHkuZGF5ID09PSBkYXkgJiYgc2F2ZS5kYWlseS53b24pIHJldHVybiB7IGZpcnN0OiBmYWxzZSwgcGFjazogbnVsbCwgZ29sZDogMCB9O1xuICBzYXZlLmRhaWx5ID0geyBkYXksIHdvbjogdHJ1ZSB9O1xuICByZXR1cm4geyBmaXJzdDogdHJ1ZSwgcGFjazogZ3JhbnRQYWNrKHNhdmUsIDEsICdEYWlseSBjaGFsbGVuZ2UnKSwgZ29sZDogYWRkR29sZChzYXZlLCBHT0xELmRhaWx5V2luKSB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZERhaWx5V2luQW5kU2F2ZShkYXk6IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBEYWlseVJld2FyZCB7IGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IHIgPSByZWNvcmREYWlseVdpbihzLCBkYXkpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjsgfVxuLyoqIEhhcyB0b2RheSdzIHJld2FyZCBhbHJlYWR5IGJlZW4gdGFrZW4/ICovXG5leHBvcnQgY29uc3QgZGFpbHlEb25lID0gKHNhdmU6IFNhdmUsIGRheTogbnVtYmVyKTogYm9vbGVhbiA9PiAhIXNhdmUuZGFpbHkgJiYgc2F2ZS5kYWlseS5kYXkgPT09IGRheSAmJiBzYXZlLmRhaWx5LndvbjtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEVuZGxlc3MgRGVwdGhzXG5leHBvcnQgaW50ZXJmYWNlIEVuZGxlc3NSZXdhcmQgeyB3YXZlOiBudW1iZXI7IHBhY2s6IFBhY2tJdGVtIHwgbnVsbDsgbmV3QmVzdDogYm9vbGVhbiB9XG4vKiogV2F2ZSBgd2F2ZWAgb2YgYW4gZW5kbGVzcyBydW4gd2FzIGNsZWFyZWQ6IGEgcGFjayBvbiBldmVyeSAxMHRoIHdhdmUgKGJldHRlciB0aWVycyBkZWVwZXIpLCBhbmQgdGhlIGJlc3QgZGVwdGggaXMgcmVtZW1iZXJlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFbmRsZXNzV2F2ZShzYXZlOiBTYXZlLCB3YXZlOiBudW1iZXIpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgbmV3QmVzdCA9IHdhdmUgPiBzYXZlLmVuZGxlc3MuYmVzdDsgaWYgKG5ld0Jlc3QpIHNhdmUuZW5kbGVzcy5iZXN0ID0gd2F2ZTtcbiAgY29uc3QgcGFjayA9IHdhdmUgPiAwICYmIHdhdmUgJSBFTkRMRVNTX1BBQ0tfRVZFUlkgPT09IDAgPyBncmFudFBhY2soc2F2ZSwgZW5kbGVzc1BhY2tUaWVyKHdhdmUpLCAnRW5kbGVzcyBcdTAwQjcgd2F2ZSAnICsgd2F2ZSkgOiBudWxsO1xuICByZXR1cm4geyB3YXZlLCBwYWNrLCBuZXdCZXN0IH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlKHdhdmU6IG51bWJlciwgc3RvcmU/OiBTdG9yZSB8IG51bGwpOiBFbmRsZXNzUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZEVuZGxlc3NXYXZlKHMsIHdhdmUpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cbi8qKiBFbmRsZXNzIERlcHRocyBvcGVucyBvbmNlIHRoZSBsYXN0IGNhbXBhaWduIHN0YWdlIGhhcyBiZWVuIGNsZWFyZWQgb24gTm9ybWFsLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NVbmxvY2tlZCA9IChzYXZlOiBTYXZlKTogYm9vbGVhbiA9PiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tTVEFHRVMubGVuZ3RoIC0gMV0uaWQsICdub3JtYWwnKSA+IDA7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB1bmxvY2sgcnVsZXNcbi8vIEVhc3kgYW5kIE5vcm1hbCBhcmUgb3BlbiBvbiBldmVyeSB1bmxvY2tlZCBzdGFnZS4gQ2xlYXJpbmcgTm9ybWFsIG9wZW5zIEhhcmQgb24gdGhhdCBzdGFnZSBBTkQgdW5sb2NrcyB0aGUgbmV4dCBzdGFnZS4gQ2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5leHBvcnQgY29uc3QgY2xlYXJDb3VudCA9IChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogbnVtYmVyID0+IHNhdmUuY2xlYXJzW3N0YWdlICsgJzonICsgZF0gPz8gMDtcbmV4cG9ydCBmdW5jdGlvbiBzdGFnZVVubG9ja2VkKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBib29sZWFuIHsgcmV0dXJuIGluZGV4IDw9IDAgfHwgKGluZGV4IDwgU1RBR0VTLmxlbmd0aCAmJiBjbGVhckNvdW50KHNhdmUsIFNUQUdFU1tpbmRleCAtIDFdLmlkLCAnbm9ybWFsJykgPiAwKTsgfVxuZXhwb3J0IGZ1bmN0aW9uIGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogYm9vbGVhbiB7XG4gIGNvbnN0IGlkeCA9IFNUQUdFUy5maW5kSW5kZXgoKHMpID0+IHMuaWQgPT09IHN0YWdlKTsgaWYgKGlkeCA8IDAgfHwgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZCA9PT0gJ2Vhc3knIHx8IGQgPT09ICdub3JtYWwnKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIGQgPT09ICdoYXJkJyA/IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdub3JtYWwnKSA+IDAgOiBjbGVhckNvdW50KHNhdmUsIHN0YWdlLCAnaGFyZCcpID4gMDtcbn1cbi8qKiBXaHkgYSBzdGFnZSBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhZ2VMb2NrUmVhc29uKHNhdmU6IFNhdmUsIGluZGV4OiBudW1iZXIpOiBzdHJpbmcgeyByZXR1cm4gc3RhZ2VVbmxvY2tlZChzYXZlLCBpbmRleCkgPyAnJyA6ICdDbGVhciAnICsgU1RBR0VTW2luZGV4IC0gMV0ubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jay4nOyB9XG4vKiogV2h5IGEgdGllciBpcyBsb2NrZWQgKGVtcHR5IHdoZW4gaXQgaXMgb3BlbikuICovXG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgc3RhZ2U6IHN0cmluZywgZDogRGlmZmljdWx0eSk6IHN0cmluZyB7XG4gIGlmIChkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIGQpKSByZXR1cm4gJyc7XG4gIGNvbnN0IGlkeCA9IHN0YWdlSW5kZXgoc3RhZ2UpOyBpZiAoIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgcmV0dXJuIHN0YWdlTG9ja1JlYXNvbihzYXZlLCBpZHgpO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIE5vcm1hbCB0byB1bmxvY2sgSGFyZC4nIDogJ0NsZWFyICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIG9uIEhhcmQgdG8gdW5sb2NrIE5pZ2h0bWFyZS4nO1xufVxuLyoqIFdoYXRldmVyIHdhcyBzYXZlZCwgbWFrZSBpdCBhIHN0YWdlIGFuZCB0aWVyIHRoZSBwbGF5ZXIgbWF5IGFjdHVhbGx5IHBsYXkuICovXG5leHBvcnQgZnVuY3Rpb24gcGxheWFibGUoc2F2ZTogU2F2ZSk6IHsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogRGlmZmljdWx0eSB9IHtcbiAgbGV0IGlkeCA9IHN0YWdlSW5kZXgoc2F2ZS5zdGFnZSk7IHdoaWxlIChpZHggPiAwICYmICFzdGFnZVVubG9ja2VkKHNhdmUsIGlkeCkpIGlkeC0tO1xuICBjb25zdCBzdGFnZSA9IFNUQUdFU1tpZHhdLmlkO1xuICByZXR1cm4geyBzdGFnZSwgZGlmZmljdWx0eTogZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0YWdlLCBzYXZlLmRpZmZpY3VsdHkpID8gc2F2ZS5kaWZmaWN1bHR5IDogJ25vcm1hbCcgfTtcbn1cblxuLyoqIEV2ZXJ5IHVubG9jayB0aGUgcGxheWVyIG1heSBiZSBjZWxlYnJhdGVkIGZvcjogbGF0ZXIgc3RhZ2VzIGFuZCB0aGUgSGFyZCAvIE5pZ2h0bWFyZSB0aWVycyAoRWFzeSwgTm9ybWFsIGFuZCBTdGFnZSAxIGFyZSBvcGVuIGZyb20gdGhlIHN0YXJ0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmxvY2tlZEtleXMoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qga2V5czogc3RyaW5nW10gPSBbXTtcbiAgU1RBR0VTLmZvckVhY2goKHN0LCBpKSA9PiB7XG4gICAgaWYgKGkgPiAwICYmIHN0YWdlVW5sb2NrZWQoc2F2ZSwgaSkpIGtleXMucHVzaCgnc3RhZ2U6JyArIHN0LmlkKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgWydoYXJkJywgJ25pZ2h0bWFyZSddIGFzIERpZmZpY3VsdHlbXSkgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdC5pZCwgZCkpIGtleXMucHVzaCgndGllcjonICsgc3QuaWQgKyAnOicgKyBkKTtcbiAgfSk7XG4gIGlmIChlbmRsZXNzVW5sb2NrZWQoc2F2ZSkpIGtleXMucHVzaCgnZW5kbGVzcycpO1xuICByZXR1cm4ga2V5cztcbn1cbi8qKiBVbmxvY2tzIG5vdCB5ZXQgY2VsZWJyYXRlZC4gKi9cbmV4cG9ydCBjb25zdCBuZXdVbmxvY2tzID0gKHNhdmU6IFNhdmUpOiBzdHJpbmdbXSA9PiB1bmxvY2tlZEtleXMoc2F2ZSkuZmlsdGVyKChrKSA9PiAhKHNhdmUuc2VlbiA/PyBbXSkuaW5jbHVkZXMoaykpO1xuY29uc3QgVElFUl9OQU1FOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBoYXJkOiAnSGFyZCBtb2RlJywgbmlnaHRtYXJlOiAnTmlnaHRtYXJlIG1vZGUnIH07XG4vKiogV29yZHMgZm9yIGFuIHVubG9jayBrZXksIGZvciBiYW5uZXJzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlVW5sb2NrKGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGtleSA9PT0gJ2VuZGxlc3MnKSByZXR1cm4gJ0VuZGxlc3MgRGVwdGhzIChuZXcgbW9kZSknO1xuICBjb25zdCBba2luZCwgc3RhZ2UsIHRpZXJdID0ga2V5LnNwbGl0KCc6Jyk7XG4gIGlmIChraW5kID09PSAnc3RhZ2UnKSByZXR1cm4gc3RhZ2VCeUlkKHN0YWdlKS5uYW1lICsgJyAobmV3IHN0YWdlKSc7XG4gIHJldHVybiAoVElFUl9OQU1FW3RpZXJdID8/IHRpZXIpICsgJyBvbiAnICsgc3RhZ2VCeUlkKHN0YWdlKS5uYW1lO1xufVxuLyoqIENsZWFyaW5nIGEgc3RhZ2U6IHJld2FyZHMsIGFuZCB3aGljaCB1bmxvY2tzIHRoaXMgY2xlYXIgb3BlbmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZENsZWFyKHNhdmU6IFNhdmUsIHN0YWdlSWQ6IHN0cmluZywgZGlmZmljdWx0eTogRGlmZmljdWx0eSk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgYmVmb3JlID0gdW5sb2NrZWRLZXlzKHNhdmUpLCByID0gcmVjb3JkQ2xlYXJCYXNlKHNhdmUsIHN0YWdlSWQsIGRpZmZpY3VsdHkpO1xuICByZXR1cm4geyAuLi5yLCB1bmxvY2tlZDogdW5sb2NrZWRLZXlzKHNhdmUpLmZpbHRlcigoaykgPT4gIWJlZm9yZS5pbmNsdWRlcyhrKSkgfTtcbn1cbiIsICIvLyBUaGUgcGxheWVyJ3MgY2hhcmFjdGVyOiB0aGUgTmVjcm9tYW5jZXIgKGEgcmlnZ2VkIFRyaXBvIG1vZGVsLCBQaXBlbGluZS91bml0cy9uZWNyb21hbmNlci5qc29uKS5cbi8vIEhlIHN0YW5kcyBiZXNpZGUgdGhlIGdyaWQsIHRha2VzIHRoZSBoaXQgd2hlbiBhbiBhcm15IGlzIHdpcGVkIChoZWFydHMgYXJlIEhJUyBoZWFsdGgpLCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUgYW5kIHJhaXNlc1xuLy8gdGhlIGZhbGxlbi4gRXZlcnl0aGluZyBoZXJlIGlzIGFuaW1hdGlvbiBvbmx5OyB0aGUgcnVsZXMgbGl2ZSBpbiBjb3JlL3J1bGVzLnRzLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5cbmV4cG9ydCBjbGFzcyBOZWNyb21hbmNlciB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbjsgbG9jYWwgK1ogaXMgaGlzIGZhY2luZyAodGhlIGdhbWUgcm90YXRlcyBoaW0gdG8gZmFjZSB0aGUgYmF0dGxlZmllbGQpXG4gIHByaXZhdGUgZW50OiBhbnk7IHByaXZhdGUgYW5pbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTsgcHJpdmF0ZSBjdXI6IGFueSA9IG51bGw7IHByaXZhdGUgaGFuZDogYW55ID0gbnVsbDsgcHJpdmF0ZSByaW5nOiBhbnk7IHByaXZhdGUgcHM6IGFueTtcbiAgcHJpdmF0ZSB0ID0gMDsgcHJpdmF0ZSBpZGxlVCA9IDA7IHByaXZhdGUgbmV4dFRhcCA9IDg7IHByaXZhdGUgYnVzeSA9IGZhbHNlOyBwcml2YXRlIGRvd25lZCA9IGZhbHNlOyBwcml2YXRlIHJlYWRvbmx5IFMgPSAxLjM1O1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgc2NlbmU6IGFueSwgcHJpdmF0ZSBzb2Z0OiBhbnksIGNvbnRhaW5lcjogYW55KSB7XG4gICAgY29uc3QgcyA9IHNjZW5lO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbmVjcm8nLCBzKTtcbiAgICB0aGlzLmVudCA9IGNvbnRhaW5lci5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfbmVjcm8nLCBmYWxzZSwgeyBkb05vdEluc3RhbnRpYXRlOiB0cnVlIH0pO1xuICAgIGNvbnN0IHJvb3QgPSB0aGlzLmVudC5yb290Tm9kZXNbMF07IHJvb3QucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuUyk7XG4gICAgcm9vdC5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmlzUGlja2FibGUgPSBmYWxzZTsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyB9KTtcbiAgICB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiB7IGcuc3RvcCgpOyBnLmVuYWJsZUJsZW5kaW5nID0gdHJ1ZTsgZy5ibGVuZGluZ1NwZWVkID0gMC4xMjsgdGhpcy5hbmltc1tnLm5hbWUuc3BsaXQoJ18nKVswXV0gPSBnOyB9KTtcbiAgICB0aGlzLmhhbmQgPSByb290LmdldENoaWxkVHJhbnNmb3JtTm9kZXMoZmFsc2UpLmZpbmQoKG46IGFueSkgPT4gbi5uYW1lLmluY2x1ZGVzKCdTb2NrZXRfV2VhcG9uJykpIHx8IG51bGw7XG4gICAgdGhpcy5wbGF5KCdJZGxlJywgdHJ1ZSk7XG4gICAgY29uc3QgcmluZyA9IHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygnYmFzZScsIHsgcmFkaXVzOiAwLjUsIHRlc3NlbGxhdGlvbjogMzAgfSwgcyk7IHJpbmcucGFyZW50ID0gdGhpcy5ob2xkZXI7IHJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyByaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyByaW5nLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBybSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ25yJywgcyk7IHJtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHJtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC40LCAwLjE1LCAwLjc1KTsgcm0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcm0uYWxwaGEgPSAwLjU1OyByaW5nLm1hdGVyaWFsID0gcm07XG4gICAgY29uc3QgcHMgPSB0aGlzLnBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ25lY3JvQXVyYScsIDgwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gc29mdDsgcHMuZW1pdHRlciA9IHRoaXMuaG9sZGVyO1xuICAgIHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjI1LCAwLCAtMC4yNSk7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMjUsIDAuOCwgMC4yNSk7IHBzLm1pbkxpZmVUaW1lID0gMC42OyBwcy5tYXhMaWZlVGltZSA9IDEuMztcbiAgICBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xNSwgMC45LCAtMC4xNSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMTUsIDEuNiwgMC4xNSk7IHBzLm1pbkVtaXRQb3dlciA9IDAuMzsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApO1xuICAgIHBzLm1pblNpemUgPSAwLjA3OyBwcy5tYXhTaXplID0gMC4yOyBwcy5lbWl0UmF0ZSA9IDMwOyBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC44LCAwLjM1LCAxLCAwLjcpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC40NSwgMC4xNSwgMC45LCAwLjUpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4yLCAwLCAwLjQsIDApO1xuICAgIHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMuc3RhcnQoKTtcbiAgfVxuXG4gIHByaXZhdGUgcGxheShuYW1lOiBzdHJpbmcsIGxvb3AgPSBmYWxzZSwgaG9sZCA9IGZhbHNlKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbbmFtZV07IGlmICghZykgcmV0dXJuO1xuICAgIGlmICh0aGlzLmN1ciAmJiB0aGlzLmN1ciAhPT0gZykgdGhpcy5jdXIuc3RvcCgpO1xuICAgIGcuc3RvcCgpOyBnLnN0YXJ0KGxvb3AsIDEsIGcuZnJvbSwgZy50byk7IHRoaXMuY3VyID0gZzsgdGhpcy5idXN5ID0gIWxvb3A7IHRoaXMuaG9sZEVuZCA9IGhvbGQ7XG4gIH1cbiAgcHJpdmF0ZSBob2xkRW5kID0gZmFsc2U7XG4gIHNldEVuYWJsZWQob246IGJvb2xlYW4pIHsgdGhpcy5ob2xkZXIuc2V0RW5hYmxlZChvbik7IGlmIChvbikgdGhpcy5wcy5zdGFydCgpOyBlbHNlIHRoaXMucHMuc3RvcCgpOyB9XG4gIC8qKiBXb3JsZCBwb3NpdGlvbiBvZiB0aGUgc3RhZmYgY3J5c3RhbCAoZm9yIHNwZWxsIGVmZmVjdHMpOiBhYm92ZSB0aGUgaGFuZCB0aGF0IGhvbGRzIHRoZSBzdGFmZi4gKi9cbiAgY3J5c3RhbFBvcygpOiBhbnkge1xuICAgIHRoaXMuaG9sZGVyLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKTtcbiAgICBjb25zdCBiYXNlID0gdGhpcy5oYW5kID8gKHRoaXMuaGFuZC5jb21wdXRlV29ybGRNYXRyaXgodHJ1ZSksIHRoaXMuaGFuZC5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuY2xvbmUoKSkgOiB0aGlzLmhvbGRlci5nZXRBYnNvbHV0ZVBvc2l0aW9uKCkuYWRkKG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC42ICogdGhpcy5TLCAwKSk7XG4gICAgcmV0dXJuIGJhc2UuYWRkKG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC42MiAqIHRoaXMuUywgMCkpO1xuICB9XG5cbiAgaHVydCgpIHsgaWYgKCF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdIdXJ0Jyk7IH1cbiAgY2FzdCgpIHsgaWYgKCF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdDYXN0Jyk7IH1cbiAgLyoqIFRoZSBsYXN0IGhlYXJ0IGlzIGdvbmU6IGhlIHNpbmtzIHRvIGhpcyBrbmVlcy4gKi9cbiAgZGVmZWF0KCkgeyB0aGlzLmRvd25lZCA9IHRydWU7IHRoaXMucGxheSgnRG93bicsIGZhbHNlLCB0cnVlKTsgfVxuICByZXZpdmUoKSB7IGlmICh0aGlzLmRvd25lZCkgeyB0aGlzLmRvd25lZCA9IGZhbHNlOyB0aGlzLnBsYXkoJ1Jldml2ZScpOyB9IGVsc2UgaWYgKHRoaXMuYnVzeSAmJiB0aGlzLmN1ciAhPT0gdGhpcy5hbmltc1snSWRsZSddKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTsgfVxuXG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0O1xuICAgIGlmICh0aGlzLmN1ciAmJiAhdGhpcy5jdXIuaXNTdGFydGVkICYmICF0aGlzLmRvd25lZCkgdGhpcy5wbGF5KCdJZGxlJywgdHJ1ZSk7ICAgICAgICAgICAgICAvLyBhIG9uZS1zaG90IGZpbmlzaGVkXG4gICAgZWxzZSBpZiAodGhpcy5jdXIgJiYgIXRoaXMuY3VyLmlzU3RhcnRlZCAmJiB0aGlzLmRvd25lZCAmJiAhdGhpcy5ob2xkRW5kKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTtcbiAgICBpZiAoIXRoaXMuYnVzeSAmJiAhdGhpcy5kb3duZWQpIHsgdGhpcy5pZGxlVCArPSBkdDsgaWYgKHRoaXMuaWRsZVQgPiB0aGlzLm5leHRUYXApIHsgdGhpcy5pZGxlVCA9IDA7IHRoaXMubmV4dFRhcCA9IDkgKyBNYXRoLnJhbmRvbSgpICogODsgdGhpcy5wbGF5KCdUYXAnKTsgfSB9XG4gICAgdGhpcy5wcy5lbWl0UmF0ZSA9IHRoaXMuZG93bmVkID8gNiA6ICh0aGlzLmJ1c3kgJiYgdGhpcy5jdXIgPT09IHRoaXMuYW5pbXNbJ0Nhc3QnXSA/IDExMCA6IDMwKTtcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7IHRoaXMucHMuc3RvcCgpOyB0aGlzLnBzLmRpc3Bvc2UoKTsgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4gZy5kaXNwb3NlKCkpOyB0aGlzLmVudC5za2VsZXRvbnMuZm9yRWFjaCgoczogYW55KSA9PiBzLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuIiwgIi8vIEFsbCBzb3VuZCBpcyBzeW50aGVzaXplZCBpbiB0aGUgYnJvd3NlciB3aXRoIHRoZSBXZWIgQXVkaW8gQVBJOiBubyBhdWRpbyBmaWxlcyB0byBkb3dubG9hZCwgbGljZW5zZSBvciBzaGlwLlxuLy8gVHdvIGluZGVwZW5kZW50IHN3aXRjaGVzIChtdXNpYywgc291bmQgZWZmZWN0cyksIHNhdmVkIGluIHRoZSBwbGF5ZXIncyBzYXZlLiBQaG9uZXMgb25seSBhbGxvdyBzb3VuZCBhZnRlciBhIHRhcCwgc28gbm90aGluZyBzdGFydHNcbi8vIHVudGlsIHRoZSBmaXJzdCB0b3VjaC9jbGljayAoYHVubG9ja2ApLlxuaW1wb3J0IHsgbG9hZFNhdmUsIHVwZGF0ZVNldHRpbmdzIH0gZnJvbSAnLi4vY29yZS9zYXZlLnRzJztcblxuZXhwb3J0IHR5cGUgU2Z4ID0gJ3RhcCcgfCAnc3VtbW9uJyB8ICdtZXJnZScgfCAnaGl0JyB8ICdoaXRBcnJvdycgfCAnc21hc2gnIHwgJ2Fycm93JyB8ICdkZWF0aCcgfCAnY2FzdCcgfCAndGF1bnQnIHwgJ3Nob2Nrd2F2ZScgfCAncmVzdXJyZWN0JyB8ICdoZWFydExvc3QnIHwgJ3ZpY3RvcnknIHwgJ2RlZmVhdCcgfCAnc3RhcnQnXG4gIHwgJ3VubG9jaycgfCAncGFja0NoYXJnZScgfCAncGFja1RpZXJVcCcgfCAncGFja1RlYXInIHwgJ3BhY2tGYW4nIHwgJ3BhY2tGbGlwJyB8ICdwYWNrUmFyZScgfCAncGFja0VwaWMnIHwgJ3BhY2tMZWdlbmQnIHwgJ3BhY2tDb2xsZWN0JztcbmV4cG9ydCB0eXBlIE1vZGUgPSAnYnVpbGQnIHwgJ2JhdHRsZSc7XG5cbi8vIE11c2ljOiBBIG1pbm9yLCA4MCBicG0sIGZvdXIgYmFycyBsb29waW5nIChBbSwgRiwgQywgRSkuIFJvb3Qgbm90ZSBmaXJzdCwgdGhlbiBjaG9yZCB0b25lcyAoSHopLlxuY29uc3QgQ0hPUkRTOiBudW1iZXJbXVtdID0gW1xuICBbMTEwLCAxNjQuODEsIDIyMCwgMjYxLjYzLCAzMjkuNjNdLFxuICBbODcuMzEsIDEzMC44MSwgMTc0LjYxLCAyMjAsIDI2MS42M10sXG4gIFsxMzAuODEsIDE5NiwgMjYxLjYzLCAzMjkuNjMsIDM5Ml0sXG4gIFs4Mi40MSwgMTIzLjQ3LCAxNjQuODEsIDIwNy42NSwgMjQ2Ljk0XSxcbl07XG5jb25zdCBCRUFUID0gNjAgLyA4MDtcblxuY2xhc3MgQXVkaW9FbmdpbmUge1xuICBwcml2YXRlIGN0eDogQXVkaW9Db250ZXh0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbWFzdGVyITogR2Fpbk5vZGU7IHByaXZhdGUgbXVzaWNCdXMhOiBHYWluTm9kZTsgcHJpdmF0ZSBzZnhCdXMhOiBHYWluTm9kZTsgcHJpdmF0ZSBub2lzZUJ1ZiE6IEF1ZGlvQnVmZmVyO1xuICBtdXNpYyA9IHRydWU7IHNmeCA9IHRydWU7IG1vZGU6IE1vZGUgPSAnYnVpbGQnO1xuICBwcml2YXRlIHRpbWVyID0gMDsgcHJpdmF0ZSBuZXh0VCA9IDA7IHByaXZhdGUgYmVhdCA9IDA7IHByaXZhdGUgc3RhbXBzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG5cbiAgY29uc3RydWN0b3IoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgfVxuXG4gIHByaXZhdGUgc2lsZW50OiBIVE1MQXVkaW9FbGVtZW50IHwgbnVsbCA9IG51bGw7IHByaXZhdGUgcHJpbWVkID0gZmFsc2U7XG4gIC8qKiBpUGhvbmVzIG11dGUgV2ViIEF1ZGlvIHdoZW4gdGhlIHJpbmdlciBzd2l0Y2ggaXMgb24sIHVubGVzcyB0aGUgcGFnZSBpcyBwbGF5aW5nIFwicmVhbFwiIG1lZGlhLiBBIHNpbGVudCBsb29waW5nIDxhdWRpbz4gZWxlbWVudCAocGx1cyB0aGVcbiAgICogIGF1ZGlvU2Vzc2lvbiBoaW50IG9uIG5ld2VyIGlPUykgbW92ZXMgdGhlIHBhZ2UgdG8gdGhlIHBsYXliYWNrIGNoYW5uZWwsIHNvIHRoZSBnYW1lIGlzIGhlYXJkIGV2ZW4gd2l0aCB0aGUgc3dpdGNoIG9uIHNpbGVudC4gKi9cbiAgcHJpdmF0ZSBwbGF5YmFja0NoYW5uZWwoKSB7XG4gICAgdHJ5IHsgY29uc3QgYSA9IChuYXZpZ2F0b3IgYXMgYW55KS5hdWRpb1Nlc3Npb247IGlmIChhKSBhLnR5cGUgPSAncGxheWJhY2snOyB9IGNhdGNoIHsgLyogbm90IHN1cHBvcnRlZCAqLyB9XG4gICAgaWYgKHRoaXMuc2lsZW50KSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG4gPSA0NDEsIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcig0NCArIG4gKiAyKSwgdiA9IG5ldyBEYXRhVmlldyhidWYpLCBzdHIgPSAobzogbnVtYmVyLCB0OiBzdHJpbmcpID0+IHsgZm9yIChsZXQgaSA9IDA7IGkgPCB0Lmxlbmd0aDsgaSsrKSB2LnNldFVpbnQ4KG8gKyBpLCB0LmNoYXJDb2RlQXQoaSkpOyB9O1xuICAgICAgc3RyKDAsICdSSUZGJyk7IHYuc2V0VWludDMyKDQsIDM2ICsgbiAqIDIsIHRydWUpOyBzdHIoOCwgJ1dBVkUnKTsgc3RyKDEyLCAnZm10ICcpOyB2LnNldFVpbnQzMigxNiwgMTYsIHRydWUpOyB2LnNldFVpbnQxNigyMCwgMSwgdHJ1ZSk7IHYuc2V0VWludDE2KDIyLCAxLCB0cnVlKTtcbiAgICAgIHYuc2V0VWludDMyKDI0LCA0NDEwMCwgdHJ1ZSk7IHYuc2V0VWludDMyKDI4LCA4ODIwMCwgdHJ1ZSk7IHYuc2V0VWludDE2KDMyLCAyLCB0cnVlKTsgdi5zZXRVaW50MTYoMzQsIDE2LCB0cnVlKTsgc3RyKDM2LCAnZGF0YScpOyB2LnNldFVpbnQzMig0MCwgbiAqIDIsIHRydWUpO1xuICAgICAgY29uc3QgZWwgPSBuZXcgQXVkaW8oVVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbYnVmXSwgeyB0eXBlOiAnYXVkaW8vd2F2JyB9KSkpOyBlbC5sb29wID0gdHJ1ZTsgZWwudm9sdW1lID0gMC4wMTsgZWwuc2V0QXR0cmlidXRlKCdwbGF5c2lubGluZScsICcnKTsgdGhpcy5zaWxlbnQgPSBlbDtcbiAgICAgIGVsLnBsYXkoKS5jYXRjaCgoKSA9PiB7IHRoaXMuc2lsZW50ID0gbnVsbDsgfSk7XG4gICAgfSBjYXRjaCB7IC8qIGZpbmU6IHNvdW5kIHN0aWxsIHdvcmtzLCBqdXN0IGZvbGxvd3MgdGhlIHNpbGVudCBzd2l0Y2ggKi8gfVxuICB9XG4gIC8qKiBXaGF0IHRoZSBTZXR0aW5ncyBwYWdlIHNob3dzIHNvIGEgc2lsZW50IHBob25lIGNhbiBiZSBkaWFnbm9zZWQuICovXG4gIHN0YXR1cygpOiB7IHN0YXRlOiBzdHJpbmc7IHVubG9ja2VkOiBib29sZWFuIH0geyByZXR1cm4geyBzdGF0ZTogdGhpcy5jdHggPyB0aGlzLmN0eC5zdGF0ZSA6ICdub3Qgc3RhcnRlZCcsIHVubG9ja2VkOiAhIXRoaXMuY3R4ICYmIHRoaXMuY3R4LnN0YXRlID09PSAncnVubmluZycgfTsgfVxuICAvKiogVGhlIFNldHRpbmdzIHBhZ2UncyBUZXN0IHNvdW5kIGJ1dHRvbjogdW5sb2NrIGFuZCBtYWtlIGEgY2xlYXJseSBhdWRpYmxlIHNvdW5kLiAqL1xuICB0ZXN0KCkgeyB0aGlzLnVubG9jaygpOyBjb25zdCB0ID0gKCkgPT4geyB0aGlzLnBsYXkoJ3ZpY3RvcnknKTsgfTsgaWYgKHRoaXMuY3R4ICYmIHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHRoaXMuY3R4LnJlc3VtZSgpLnRoZW4odCkuY2F0Y2goKCkgPT4ge30pOyBlbHNlIHQoKTsgfVxuXG4gIC8qKiBDYWxsIGZyb20gYSB1c2VyIGdlc3R1cmUgKHRhcC9jbGljaykuIFNhZmUgdG8gY2FsbCByZXBlYXRlZGx5LiAqL1xuICB1bmxvY2soKSB7XG4gICAgdGhpcy5wbGF5YmFja0NoYW5uZWwoKTtcbiAgICBpZiAoIXRoaXMuY3R4KSB7XG4gICAgICBjb25zdCBDID0gKHdpbmRvdyBhcyBhbnkpLkF1ZGlvQ29udGV4dCB8fCAod2luZG93IGFzIGFueSkud2Via2l0QXVkaW9Db250ZXh0OyBpZiAoIUMpIHJldHVybjtcbiAgICAgIGNvbnN0IGN0eDogQXVkaW9Db250ZXh0ID0gdGhpcy5jdHggPSBuZXcgQygpO1xuICAgICAgY29uc3QgY29tcCA9IGN0eC5jcmVhdGVEeW5hbWljc0NvbXByZXNzb3IoKTsgY29tcC5jb25uZWN0KGN0eC5kZXN0aW5hdGlvbik7XG4gICAgICB0aGlzLm1hc3RlciA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMubWFzdGVyLmdhaW4udmFsdWUgPSAwLjk7IHRoaXMubWFzdGVyLmNvbm5lY3QoY29tcCk7XG4gICAgICB0aGlzLm11c2ljQnVzID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tdXNpY0J1cy5jb25uZWN0KHRoaXMubWFzdGVyKTsgdGhpcy5zZnhCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLnNmeEJ1cy5jb25uZWN0KHRoaXMubWFzdGVyKTtcbiAgICAgIGN0eC5vbnN0YXRlY2hhbmdlID0gKCkgPT4geyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWF1ZGlvLXN0YXRlJykpOyB9O1xuICAgICAgY29uc3QgbGVuID0gY3R4LnNhbXBsZVJhdGU7IHRoaXMubm9pc2VCdWYgPSBjdHguY3JlYXRlQnVmZmVyKDEsIGxlbiwgY3R4LnNhbXBsZVJhdGUpOyBjb25zdCBkID0gdGhpcy5ub2lzZUJ1Zi5nZXRDaGFubmVsRGF0YSgwKTsgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW47IGkrKykgZFtpXSA9IE1hdGgucmFuZG9tKCkgKiAyIC0gMTtcbiAgICB9XG4gICAgaWYgKHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHRoaXMuY3R4LnJlc3VtZSgpLmNhdGNoKCgpID0+IHt9KTsgICAgICAgICAgICAgLy8gJ3N1c3BlbmRlZCcgb3IgKGlPUykgJ2ludGVycnVwdGVkJ1xuICAgIGlmICghdGhpcy5wcmltZWQpIHsgdGhpcy5wcmltZWQgPSB0cnVlOyB0cnkgeyBjb25zdCBiID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyKDEsIDEsIDIyMDUwKSwgcyA9IHRoaXMuY3R4LmNyZWF0ZUJ1ZmZlclNvdXJjZSgpOyBzLmJ1ZmZlciA9IGI7IHMuY29ubmVjdCh0aGlzLmN0eC5kZXN0aW5hdGlvbik7IHMuc3RhcnQoMCk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfSB9XG4gICAgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7XG4gIH1cblxuICBzZXRNdXNpYyhvbjogYm9vbGVhbikgeyB0aGlzLm11c2ljID0gb247IHVwZGF0ZVNldHRpbmdzKHsgbXVzaWM6IG9uIH0pOyB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zZXR0aW5ncycpKTsgfVxuICBzZXRTZngob246IGJvb2xlYW4pIHsgdGhpcy5zZnggPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBzZng6IG9uIH0pOyB0aGlzLmFwcGx5R2FpbnMoKTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zZXR0aW5ncycpKTsgaWYgKG9uKSB0aGlzLnBsYXkoJ3RhcCcpOyB9XG4gIC8qKiBSZS1yZWFkIHRoZSBzYXZlZCBzd2l0Y2hlcyAodGhlIHNoZWxsJ3MgU2V0dGluZ3MgcGFnZSBjaGFuZ2VzIHRoZW0gdG9vKS4gKi9cbiAgcmVsb2FkKCkgeyBjb25zdCBzID0gbG9hZFNhdmUoKS5zZXR0aW5nczsgdGhpcy5tdXNpYyA9IHMubXVzaWM7IHRoaXMuc2Z4ID0gcy5zZng7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB9XG4gIHNldE1vZGUobTogTW9kZSkgeyB0aGlzLm1vZGUgPSBtOyB9XG5cbiAgcHJpdmF0ZSBhcHBseUdhaW5zKCkge1xuICAgIGlmICghdGhpcy5jdHgpIHJldHVybjsgY29uc3QgdCA9IHRoaXMuY3R4LmN1cnJlbnRUaW1lO1xuICAgIHRoaXMubXVzaWNCdXMuZ2Fpbi5zZXRUYXJnZXRBdFRpbWUodGhpcy5tdXNpYyA/IDAuNSA6IDAsIHQsIDAuMTUpOyB0aGlzLnNmeEJ1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLnNmeCA/IDAuOCA6IDAsIHQsIDAuMDUpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIG11c2ljXG4gIHByaXZhdGUgc3luY011c2ljKCkge1xuICAgIGlmICghdGhpcy5jdHgpIHJldHVybjtcbiAgICBpZiAodGhpcy5tdXNpYyAmJiAhdGhpcy50aW1lcikgeyB0aGlzLm5leHRUID0gdGhpcy5jdHguY3VycmVudFRpbWUgKyAwLjE1OyB0aGlzLnRpbWVyID0gd2luZG93LnNldEludGVydmFsKCgpID0+IHRoaXMudGljaygpLCAyMDApOyB9XG4gICAgaWYgKCF0aGlzLm11c2ljICYmIHRoaXMudGltZXIpIHsgY2xlYXJJbnRlcnZhbCh0aGlzLnRpbWVyKTsgdGhpcy50aW1lciA9IDA7IH1cbiAgfVxuICBwcml2YXRlIHRpY2soKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghOyBpZiAoY3R4LnN0YXRlICE9PSAncnVubmluZycpIHsgdGhpcy5uZXh0VCA9IGN0eC5jdXJyZW50VGltZSArIDAuMTU7IHJldHVybjsgfVxuICAgIHdoaWxlICh0aGlzLm5leHRUIDwgY3R4LmN1cnJlbnRUaW1lICsgMC42KSB7IHRoaXMucGxheUJlYXQodGhpcy5iZWF0LCB0aGlzLm5leHRUKTsgdGhpcy5uZXh0VCArPSBCRUFUOyB0aGlzLmJlYXQgPSAodGhpcy5iZWF0ICsgMSkgJSAxNjsgfVxuICB9XG4gIHByaXZhdGUgcGxheUJlYXQoYmVhdDogbnVtYmVyLCB0OiBudW1iZXIpIHtcbiAgICBjb25zdCBjaG9yZCA9IENIT1JEU1tNYXRoLmZsb29yKGJlYXQgLyA0KV0sIGluQmFyID0gYmVhdCAlIDQsIGJhdHRsZSA9IHRoaXMubW9kZSA9PT0gJ2JhdHRsZSc7XG4gICAgaWYgKGluQmFyID09PSAwKSBmb3IgKGNvbnN0IGYgb2YgY2hvcmQpIHRoaXMudm9pY2UoZiwgJ3RyaWFuZ2xlJywgdCwgQkVBVCAqIDQgKyAwLjgsIDAuMDQ1LCAwLjksIDkwMCk7ICAgLy8gc2xvdyBwYWRcbiAgICBpZiAoaW5CYXIgPT09IDAgfHwgaW5CYXIgPT09IDIpIHRoaXMudm9pY2UoY2hvcmRbMF0sICdzaW5lJywgdCwgQkVBVCAqIDEuNiwgMC4xNiwgMC4wMiwgNDAwKTsgICAgICAgICAgLy8gYmFzc1xuICAgIGlmIChiYXR0bGUpIHtcbiAgICAgIHRoaXMua2ljayh0LCAwLjMyKTsgaWYgKGluQmFyID09PSAyKSB0aGlzLmtpY2sodCArIEJFQVQgKiAwLjUsIDAuMTgpO1xuICAgICAgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDAuNSwgMC4wNSwgMC4wNSwgJ2hpZ2hwYXNzJywgNzAwMCk7IHRoaXMubm9pc2UodCArIEJFQVQgKiAxLjUgJSBCRUFULCAwLjA1LCAwLjAzLCAnaGlnaHBhc3MnLCA3MDAwKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMjsgaSsrKSB0aGlzLnZvaWNlKGNob3JkWzEgKyAoKGJlYXQgKiAyICsgaSkgJSA0KV0gKiAyLCAndHJpYW5nbGUnLCB0ICsgaSAqIEJFQVQgLyAyLCAwLjIyLCAwLjA1LCAwLjAwNSwgMjUwMCk7ICAgLy8gcGx1Y2sgYXJwZWdnaW9cbiAgICB9XG4gIH1cbiAgcHJpdmF0ZSB2b2ljZShmcmVxOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCB0OiBudW1iZXIsIGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIGF0dGFjazogbnVtYmVyLCBscDogbnVtYmVyKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCBvID0gY3R4LmNyZWF0ZU9zY2lsbGF0b3IoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCksIGYgPSBjdHguY3JlYXRlQmlxdWFkRmlsdGVyKCk7XG4gICAgby50eXBlID0gdHlwZTsgby5mcmVxdWVuY3kudmFsdWUgPSBmcmVxOyBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKDAuMDAwMSwgdCk7IGcuZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZShnYWluLCB0ICsgTWF0aC5tYXgoMC4wMDUsIGF0dGFjaykpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG8uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5tdXNpY0J1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBraWNrKHQ6IG51bWJlciwgZ2FpbjogbnVtYmVyKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCBvID0gY3R4LmNyZWF0ZU9zY2lsbGF0b3IoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgby5mcmVxdWVuY3kuc2V0VmFsdWVBdFRpbWUoMTMwLCB0KTsgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSg0MiwgdCArIDAuMTQpOyBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoZ2FpbiwgdCk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIDAuMik7XG4gICAgby5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5tdXNpY0J1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgMC4yNSk7XG4gIH1cbiAgcHJpdmF0ZSBub2lzZSh0OiBudW1iZXIsIGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgYnVzOiBHYWluTm9kZSA9IHRoaXMubXVzaWNCdXMsIHN3ZWVwVG8/OiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG4gPSBjdHguY3JlYXRlQnVmZmVyU291cmNlKCksIGYgPSBjdHguY3JlYXRlQmlxdWFkRmlsdGVyKCksIGcgPSBjdHguY3JlYXRlR2FpbigpO1xuICAgIG4uYnVmZmVyID0gdGhpcy5ub2lzZUJ1ZjsgZi50eXBlID0gdHlwZTsgZi5mcmVxdWVuY3kuc2V0VmFsdWVBdFRpbWUoZnJlcSwgdCk7IGlmIChzd2VlcFRvKSBmLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKHN3ZWVwVG8sIHQgKyBkdXIpO1xuICAgIGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgZHVyKTtcbiAgICBuLmNvbm5lY3QoZik7IGYuY29ubmVjdChnKTsgZy5jb25uZWN0KGJ1cyk7IG4uc3RhcnQodCwgTWF0aC5yYW5kb20oKSAqIDAuNSk7IG4uc3RvcCh0ICsgZHVyICsgMC4wMik7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc291bmQgZWZmZWN0c1xuICBwcml2YXRlIHRvbmUoZnJlcTogbnVtYmVyLCBkdXI6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIGdhaW46IG51bWJlciwgZGVsYXkgPSAwLCBzbGlkZVRvPzogbnVtYmVyLCBhdHRhY2sgPSAwLjAwNSwgbHAgPSA4MDAwKSB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghLCB0ID0gY3R4LmN1cnJlbnRUaW1lICsgZGVsYXksIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHNsaWRlVG8pIG8uZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc2xpZGVUbywgdCArIGR1cik7XG4gICAgZi50eXBlID0gJ2xvd3Bhc3MnOyBmLmZyZXF1ZW5jeS52YWx1ZSA9IGxwOyBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBhdHRhY2spOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG8uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QodGhpcy5zZnhCdXMpOyBvLnN0YXJ0KHQpOyBvLnN0b3AodCArIGR1ciArIDAuMDUpO1xuICB9XG4gIHByaXZhdGUgaGlzcyhkdXI6IG51bWJlciwgZ2FpbjogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmcmVxOiBudW1iZXIsIGRlbGF5ID0gMCwgc3dlZXBUbz86IG51bWJlcikgeyB0aGlzLm5vaXNlKHRoaXMuY3R4IS5jdXJyZW50VGltZSArIGRlbGF5LCBkdXIsIGdhaW4sIHR5cGUsIGZyZXEsIHRoaXMuc2Z4QnVzLCBzd2VlcFRvKTsgfVxuICBwcml2YXRlIHRocm90dGxlKGtleTogc3RyaW5nLCBtczogbnVtYmVyKSB7IGNvbnN0IG4gPSBwZXJmb3JtYW5jZS5ub3coKTsgaWYgKG4gLSAodGhpcy5zdGFtcHNba2V5XSB8fCAwKSA8IG1zKSByZXR1cm4gZmFsc2U7IHRoaXMuc3RhbXBzW2tleV0gPSBuOyByZXR1cm4gdHJ1ZTsgfVxuXG4gIC8qKiBBIFNvdWwncyB2b2ljZSwgc3ludGhlc2l6ZWQ6IHNrZWxldG9uIHJhdHRsZSwgYXJjaGVyIHdoaXN0bGUsIGdvYmxpbiBjYWNrbGUsIGtuaWdodCBncnVudCwgb2dyZSBncm93bCwgYmFyYmFyaWFuIHJvYXIuIGBrYCBzaGlmdHMgdGhlIHBpdGNoIChlbmVtaWVzIGEgbGl0dGxlIGxvd2VyKSwgYGRlbGF5YCBzdGFnZ2VycyBhIGNob3J1cy4gKi9cbiAgYmFyayhzb3VsOiBzdHJpbmcsIGRlbGF5ID0gMCwgayA9IDEpIHtcbiAgICBpZiAoIXRoaXMuY3R4IHx8ICF0aGlzLnNmeCB8fCB0aGlzLmN0eC5zdGF0ZSAhPT0gJ3J1bm5pbmcnIHx8ICF0aGlzLnRocm90dGxlKCdiYXJrJyArIHNvdWwsIDM1MCkpIHJldHVybjtcbiAgICBjb25zdCBUID0gKGY6IG51bWJlciwgZDogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZzogbnVtYmVyLCBkbDogbnVtYmVyLCBzbGlkZT86IG51bWJlciwgYXR0PzogbnVtYmVyLCBscD86IG51bWJlcikgPT4gdGhpcy50b25lKGYgKiBrLCBkLCB0eXBlLCBnLCBkZWxheSArIGRsLCBzbGlkZSA/IHNsaWRlICogayA6IHVuZGVmaW5lZCwgYXR0LCBscCk7XG4gICAgY29uc3QgSCA9IChkOiBudW1iZXIsIGc6IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZjogbnVtYmVyLCBkbDogbnVtYmVyLCBzdz86IG51bWJlcikgPT4gdGhpcy5oaXNzKGQsIGcsIHR5cGUsIGYsIGRlbGF5ICsgZGwsIHN3KTtcbiAgICBzd2l0Y2ggKHNvdWwpIHtcbiAgICAgIGNhc2UgJ3dhcnJpb3InOiBbMCwgMC4wNiwgMC4xMiwgMC4xOV0uZm9yRWFjaCgoZGwpID0+IEgoMC4wMywgMC4xNiwgJ2hpZ2hwYXNzJywgMzUwMCwgZGwpKTsgVCg1MjAsIDAuMjIsICdzcXVhcmUnLCAwLjA3LCAwLCAyODAsIDAuMDA1LCAxODAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdhcmNoZXInOiBUKDkwMCwgMC4xNiwgJ3NpbmUnLCAwLjEzLCAwLCAxMzUwLCAwLjAxKTsgVCgxMzUwLCAwLjIyLCAnc2luZScsIDAuMTEsIDAuMTYsIDc2MCwgMC4wMSk7IGJyZWFrO1xuICAgICAgY2FzZSAnZ29ibGluJzogWzAsIDAuMTEsIDAuMjJdLmZvckVhY2goKGRsLCBpKSA9PiBUKDUwMCArIGkgKiA3MCwgMC4xLCAnc2F3dG9vdGgnLCAwLjA5LCBkbCwgNjIwICsgaSAqIDcwLCAwLjAwNSwgMjYwMCkpOyBIKDAuMywgMC4wNSwgJ2JhbmRwYXNzJywgMjIwMCwgMCk7IGJyZWFrO1xuICAgICAgY2FzZSAna25pZ2h0JzogVCgxNTAsIDAuMzIsICdzYXd0b290aCcsIDAuMTIsIDAsIDEwNSwgMC4wMiwgOTAwKTsgVCgyMjUsIDAuMywgJ3NxdWFyZScsIDAuMDUsIDAuMDIsIDE2MCwgMC4wMiwgOTAwKTsgSCgwLjA4LCAwLjEyLCAnaGlnaHBhc3MnLCA0NTAwLCAwLjEpOyBicmVhaztcbiAgICAgIGNhc2UgJ29ncmUnOiBUKDc1LCAwLjc1LCAnc2F3dG9vdGgnLCAwLjIsIDAsIDUyLCAwLjA1LCAzMjApOyBUKDExMiwgMC43LCAnc2F3dG9vdGgnLCAwLjA4LCAwLjAzLCA4MCwgMC4wNSwgNDIwKTsgSCgwLjYsIDAuMTIsICdsb3dwYXNzJywgNDIwLCAwLjAyLCAxNDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2JhcmJhcmlhbic6IFQoMTcwLCAwLjUsICdzYXd0b290aCcsIDAuMTQsIDAsIDM0MCwgMC4wMywgMTQwMCk7IFQoMzQwLCAwLjQ1LCAnc2F3dG9vdGgnLCAwLjA4LCAwLjEsIDIxMCwgMC4wMywgMTYwMCk7IEgoMC40NSwgMC4xLCAnYmFuZHBhc3MnLCA5MDAsIDAsIDUwMCk7IGJyZWFrO1xuICAgIH1cbiAgfVxuICBwbGF5KG5hbWU6IFNmeCkge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuc2Z4IHx8IHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycpIHJldHVybjtcbiAgICBzd2l0Y2ggKG5hbWUpIHtcbiAgICAgIGNhc2UgJ3RhcCc6IGlmICghdGhpcy50aHJvdHRsZSgndGFwJywgNDApKSByZXR1cm47IHRoaXMudG9uZSg3NjAsIDAuMDYsICdzaW5lJywgMC4yMiwgMCwgMTEwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnc3VtbW9uJzogdGhpcy5oaXNzKDAuNCwgMC4xNCwgJ2JhbmRwYXNzJywgNTAwLCAwLCAyNTAwKTsgdGhpcy50b25lKDIyMCwgMC40LCAnc2F3dG9vdGgnLCAwLjEsIDAsIDY2MCwgMC4wNSwgMTgwMCk7IHRoaXMudG9uZSgxMzIwLCAwLjIsICdzaW5lJywgMC4xLCAwLjE4KTsgYnJlYWs7XG4gICAgICBjYXNlICdtZXJnZSc6IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC4zNSwgJ3RyaWFuZ2xlJywgMC4yLCBpICogMC4wNykpOyB0aGlzLmhpc3MoMC41LCAwLjA4LCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMTEwLCAwLjMsICdzaW5lJywgMC4zNSwgMCwgNTApOyB0aGlzLnRvbmUoMTU2OCwgMC41LCAnc2luZScsIDAuMDgsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0JzogaWYgKCF0aGlzLnRocm90dGxlKCdoaXQnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDcsIDAuMjQsICdsb3dwYXNzJywgMTgwMCk7IHRoaXMudG9uZSgxNzAsIDAuMDksICdzaW5lJywgMC4yMiwgMCwgODApOyBicmVhaztcbiAgICAgIGNhc2UgJ2hpdEFycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdoaXRBJywgNDUpKSByZXR1cm47IHRoaXMuaGlzcygwLjA1LCAwLjE0LCAnYmFuZHBhc3MnLCAzMDAwKTsgdGhpcy50b25lKDcwMCwgMC4wNiwgJ3RyaWFuZ2xlJywgMC4wNiwgMCwgNDAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzbWFzaCc6IHRoaXMudG9uZSg5NSwgMC4zOCwgJ3NpbmUnLCAwLjUsIDAsIDM0KTsgdGhpcy5oaXNzKDAuMzIsIDAuMzUsICdsb3dwYXNzJywgMTAwMCwgMCwgMjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdhcnJvdyc6IGlmICghdGhpcy50aHJvdHRsZSgnYXJyb3cnLCA2MCkpIHJldHVybjsgdGhpcy5oaXNzKDAuMTQsIDAuMSwgJ2JhbmRwYXNzJywgMTgwMCwgMCwgNDIwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVhdGgnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2RlYXRoJywgNzApKSByZXR1cm47IHRoaXMudG9uZSgzMDAsIDAuNCwgJ3Nhd3Rvb3RoJywgMC4xNCwgMCwgNzAsIDAuMDEsIDkwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAnY2FzdCc6IHRoaXMudG9uZSgzMDAsIDAuNDUsICdzaW5lJywgMC4xOCwgMCwgOTAwLCAwLjA1KTsgdGhpcy50b25lKDQ1MCwgMC40NSwgJ3NpbmUnLCAwLjEsIDAuMDUsIDEzNTAsIDAuMDUpOyB0aGlzLnRvbmUoMTgwMCwgMC4yNSwgJ3NpbmUnLCAwLjA1LCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3RhdW50JzogdGhpcy50b25lKDE5NiwgMC41LCAnc3F1YXJlJywgMC4wOCwgMCwgMTgwLCAwLjAzLCA3MDApOyB0aGlzLnRvbmUoMTQ3LCAwLjUsICdzYXd0b290aCcsIDAuMDgsIDAuMDIsIDE0MCwgMC4wMywgNjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzaG9ja3dhdmUnOiB0aGlzLnRvbmUoMjIwLCAxLjEsICdzaW5lJywgMC41LCAwLCAyOCwgMC4wMik7IHRoaXMuaGlzcygxLjAsIDAuMzUsICdsb3dwYXNzJywgMzAwMCwgMCwgMTUwKTsgdGhpcy50b25lKDg4MCwgMC44LCAnc2luZScsIDAuMDgsIDAsIDIyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncmVzdXJyZWN0JzogWzIyMCwgMjc3LCAzMzAsIDQ0MCwgNTU0XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMS4xLCAndHJpYW5nbGUnLCAwLjEsIGkgKiAwLjEyLCBmICogMS4xMiwgMC4zKSk7IHRoaXMuaGlzcygwLjksIDAuMDYsICdoaWdocGFzcycsIDQ1MDAsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnaGVhcnRMb3N0JzogdGhpcy50b25lKDExMCwgMC43LCAnc2F3dG9vdGgnLCAwLjI4LCAwLCA1MCwgMC4wMSwgNDUwKTsgdGhpcy5oaXNzKDAuMTgsIDAuMiwgJ2xvd3Bhc3MnLCA5MDApOyB0aGlzLnRvbmUoMjMzLCAwLjUsICdzcXVhcmUnLCAwLjA1LCAwLjAyLCAyMjAsIDAuMDEsIDUwMCk7IGJyZWFrO1xuICAgICAgY2FzZSAndmljdG9yeSc6IFszOTIsIDQ5NCwgNTg3LCA3ODRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjUsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjExKSk7IHRoaXMudG9uZSgxOTYsIDAuOSwgJ3NpbmUnLCAwLjIpOyBicmVhaztcbiAgICAgIGNhc2UgJ2RlZmVhdCc6IFszMzAsIDI5NCwgMjQ3LCAxOTZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjcsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjI4LCBmICogMC45NykpOyB0aGlzLnRvbmUoODIsIDEuNiwgJ3NpbmUnLCAwLjMsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndW5sb2NrJzogWzAuMzUsIDAuNDcsIDAuNTksIDAuNzFdLmZvckVhY2goKGQsIGkpID0+IHsgdGhpcy5oaXNzKDAuMDUsIDAuMjIsICdiYW5kcGFzcycsIDkwMCArIGkgKiAxMjAsIGQpOyB0aGlzLnRvbmUoMTcwICsgaSAqIDEyLCAwLjA3LCAnc3F1YXJlJywgMC4wNiwgZCwgdW5kZWZpbmVkLCAwLjAwMiwgNjAwKTsgfSk7IFs3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjYsICd0cmlhbmdsZScsIDAuMTYsIDEuMTUgKyBpICogMC4wNykpOyB0aGlzLmhpc3MoMC41LCAwLjA5LCAnaGlnaHBhc3MnLCA1MDAwLCAxLjIpOyB0aGlzLnRvbmUoMTEwLCAwLjMsICdzaW5lJywgMC4yNSwgMS4xNSwgNjApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tDaGFyZ2UnOiB0aGlzLnRvbmUoOTAsIDEuMDUsICdzaW5lJywgMC4yNSwgMCwgMjYwLCAwLjIpOyB0aGlzLmhpc3MoMC45NSwgMC4xMiwgJ2xvd3Bhc3MnLCAzMDAsIDAsIDIyMDApOyB0aGlzLnRvbmUoMTgwLCAxLjAsICd0cmlhbmdsZScsIDAuMDYsIDAuMSwgNTIwLCAwLjMpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUaWVyVXAnOiBbNDQwLCA1NTQsIDY1OSwgODgwXS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA2KSk7IHRoaXMudG9uZSgxNzYwLCAwLjYsICdzaW5lJywgMC4wOSwgMC4yKTsgdGhpcy5oaXNzKDAuNCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tUZWFyJzogdGhpcy5oaXNzKDAuMzUsIDAuMywgJ2JhbmRwYXNzJywgMTUwMCwgMCwgNjAwMCk7IHRoaXMudG9uZSgxMjAsIDAuNDUsICdzaW5lJywgMC40LCAwLjA1LCA0MCk7IFsxMDQ2LCAxMzE4LCAxNTY4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC42LCAndHJpYW5nbGUnLCAwLjEsIDAuMTIgKyBpICogMC4wNSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tGYW4nOiB0aGlzLmhpc3MoMC41LCAwLjEsICdoaWdocGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNjYwLCAwLjQ1LCAnc2luZScsIDAuMSwgMCwgMTMyMCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0ZsaXAnOiB0aGlzLmhpc3MoMC4wOCwgMC4xNSwgJ2JhbmRwYXNzJywgMjUwMCk7IHRoaXMudG9uZSg1MDAsIDAuMTIsICdzaW5lJywgMC4xNCwgMCwgODAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrUmFyZSc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzc4NCwgOTg4XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC40NSwgJ3RyaWFuZ2xlJywgMC4xNCwgMC4wNSArIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0VwaWMnOiB0aGlzLnBsYXkoJ3BhY2tGbGlwJyk7IFs1MjMsIDY1OSwgNzg0LCAxMDQ2XS5mb3JFYWNoKChmLCBpKSA9PiB0aGlzLnRvbmUoZiwgMC43LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wNykpOyB0aGlzLnRvbmUoMTEwLCAwLjUsICdzaW5lJywgMC4zLCAwLCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0xlZ2VuZCc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDYsIDEzMThdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA4KSk7IHRoaXMudG9uZSg4MiwgMC45LCAnc2luZScsIDAuMzUsIDAsIDUwKTsgdGhpcy5oaXNzKDAuOCwgMC4xLCAnaGlnaHBhc3MnLCA1MDAwLCAwLjEpOyB0aGlzLnRvbmUoMjA5MywgMC43LCAnc2luZScsIDAuMDcsIDAuNCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NvbGxlY3QnOiBbNjU5LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjE2LCBpICogMC4wOSkpOyBicmVhaztcbiAgICAgIGNhc2UgJ3N0YXJ0JzogdGhpcy50b25lKDE0NywgMC45LCAnc2F3dG9vdGgnLCAwLjEzLCAwLCAxNTAsIDAuMTUsIDY1MCk7IHRoaXMudG9uZSgyMjAsIDAuOSwgJ3Nhd3Rvb3RoJywgMC4wOSwgMC4wNSwgMjI0LCAwLjE1LCA2NTApOyB0aGlzLmhpc3MoMC42LCAwLjA2LCAnbG93cGFzcycsIDYwMCk7IGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYXVkaW8gPSBuZXcgQXVkaW9FbmdpbmUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2F1ZGlvID0gYXVkaW87XG5cbi8vIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdG91Y2g6IHRoZSBmaXJzdCB0YXAgYW55d2hlcmUgdW5sb2NrcyBpdC4gRXZlcnkgYnV0dG9uIGFsc28gZ2V0cyBhIHNtYWxsIGNsaWNrLlxuLy8gaU9TIG9ubHkgYWNjZXB0cyBhbiB1bmxvY2sgZnJvbSBhIEZJTklTSEVEIHRhcCAodG91Y2hlbmQgLyBjbGljayksIG5vdCBmcm9tIHRoZSBzdGFydCBvZiBvbmUsIHNvIGxpc3RlbiB0byBhbGwgb2YgdGhlbS5cbmNvbnN0IHVubG9ja09uY2UgPSAoKSA9PiBhdWRpby51bmxvY2soKTtcbmZvciAoY29uc3QgZXYgb2YgWydwb2ludGVyZG93bicsICdwb2ludGVydXAnLCAndG91Y2hlbmQnLCAnY2xpY2snLCAna2V5ZG93biddKSBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKGV2LCB1bmxvY2tPbmNlLCB7IGNhcHR1cmU6IHRydWUgfSk7XG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGNvbnN0IGVsID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsOyBpZiAoZWwgJiYgZWwuY2xvc2VzdCAmJiBlbC5jbG9zZXN0KCdidXR0b24sIGEuYnRuLCAucmFpbCBhJykpIGF1ZGlvLnBsYXkoJ3RhcCcpOyB9LCB0cnVlKTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Zpc2liaWxpdHljaGFuZ2UnLCAoKSA9PiB7IGNvbnN0IGMgPSAoYXVkaW8gYXMgYW55KS5jdHggYXMgQXVkaW9Db250ZXh0IHwgbnVsbDsgaWYgKCFjKSByZXR1cm47IGlmIChkb2N1bWVudC5oaWRkZW4pIGMuc3VzcGVuZCgpOyBlbHNlIGlmIChhdWRpby5tdXNpYyB8fCBhdWRpby5zZngpIGMucmVzdW1lKCk7IH0pO1xud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzLWNoYW5nZWQnLCAoKSA9PiBhdWRpby5yZWxvYWQoKSk7XG4iLCAiLy8gU2F2aW5nIGEgcnVuIGluIHByb2dyZXNzIHNvIGl0IHN1cnZpdmVzIGEgcGFnZSByZWxvYWQgKFNhZmFyaSBvbiBhIHBob25lIGNhbiBkcm9wIHRoZSBwYWdlIGF0IGFueSB0aW1lKS5cbi8vIE9ubHkgY2FsbSBtb21lbnRzIGFyZSBzYXZlZDogdGhlIGJ1aWxkIHBoYXNlIGFuZCB0aGUgdmljdG9yeSBkcmFmdC4gQSBiYXR0bGUgaW4gcHJvZ3Jlc3MgaXMgbm90IHNhdmVkOyByZWxvYWRpbmcgZHVyaW5nIG9uZSBwdXRzIHlvdSBiYWNrXG4vLyBhdCB0aGUgYnVpbGQgc2NyZWVuIHlvdSBwcmVzc2VkIEJhdHRsZSBmcm9tIChub3RoaW5nIGxvc3QsIG5vdGhpbmcgZ2FpbmVkKS4gRXZlcnl0aGluZyByZWFkIGJhY2sgaXMgdmFsaWRhdGVkOyBhbnl0aGluZyBvZGQgaXMgaWdub3JlZC5cblxuaW1wb3J0IHsgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcywgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlLCBVbml0IH0gZnJvbSAnLi9ydWxlcy50cyc7XG5pbXBvcnQgeyBicm93c2VyU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHR5cGUgeyBTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5cbmNvbnN0IEtFWSA9ICduZWNyby1ydW4nO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VyaWFsaXplZFN0YXRlIHtcbiAgcnVsZXM6IFJ1bGVzOyBybmc6IHsgc2VlZDogbnVtYmVyOyBwb3M6IG51bWJlciB9O1xuICB3YXZlOiBudW1iZXI7IGhlYXJ0czogbnVtYmVyOyBjYXA6IG51bWJlcjsgaGFuZDogU291bElkW107IHVuaXRzOiBVbml0W107IG5leHRJZDogbnVtYmVyOyBkaXNjYXJkVXNlZDogYm9vbGVhbjtcbiAgc3RhdHVzOiAnYnVpbGRpbmcnOyBsb2c6IHN0cmluZ1tdOyBzdGF0czogU3RhdGVbJ3N0YXRzJ107XG59XG5leHBvcnQgaW50ZXJmYWNlIFJ1blNuYXBzaG90IHsgdjogbnVtYmVyOyBzZWVkOiBudW1iZXI7IGF0dGVtcHQ6IG51bWJlcjsgc3RhZ2U6IHN0cmluZzsgZGlmZmljdWx0eTogc3RyaW5nOyBwaGFzZTogJ2J1aWxkJyB8ICdkcmFmdCc7IGRyYWZ0OiBTb3VsSWRbXSB8IG51bGw7IHN0YXRlOiBTZXJpYWxpemVkU3RhdGU7IHN0YXJ0QmVzdD86IG51bWJlciB9XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXJpYWxpemVTdGF0ZShzOiBTdGF0ZSk6IFNlcmlhbGl6ZWRTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgcnVsZXM6IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocy5ydWxlcykpLCBybmc6IHsgc2VlZDogcy5ybmcuc2VlZCwgcG9zOiBzLnJuZy5zdGF0ZSgpIH0sXG4gICAgd2F2ZTogcy53YXZlLCBoZWFydHM6IHMuaGVhcnRzLCBjYXA6IHMuY2FwLCBoYW5kOiBzLmhhbmQuc2xpY2UoKSwgdW5pdHM6IHMudW5pdHMubWFwKCh1KSA9PiAoeyAuLi51IH0pKSwgbmV4dElkOiBzLm5leHRJZCwgZGlzY2FyZFVzZWQ6IHMuZGlzY2FyZFVzZWQsXG4gICAgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IHMubG9nLnNsaWNlKC00MCksIHN0YXRzOiB7IC4uLnMuc3RhdHMgfSxcbiAgfTtcbn1cblxuY29uc3QgaXNTb3VsID0gKHg6IGFueSk6IHggaXMgU291bElkID0+IFNPVUxTLmluY2x1ZGVzKHgpO1xuY29uc3QgaW50ID0gKHg6IGFueSwgbG86IG51bWJlciwgaGk6IG51bWJlcikgPT4gTnVtYmVyLmlzSW50ZWdlcih4KSAmJiB4ID49IGxvICYmIHggPD0gaGk7XG5cbi8qKiBSZWJ1aWxkIGEgU3RhdGUgZnJvbSBzYXZlZCBkYXRhLCBvciBudWxsIGlmIGFueXRoaW5nIGFib3V0IGl0IGlzIG5vdCBiZWxpZXZhYmxlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplU3RhdGUoeDogYW55KTogU3RhdGUgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBpZiAoIXggfHwgdHlwZW9mIHggIT09ICdvYmplY3QnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCByID0geC5ydWxlcztcbiAgICBpZiAoIXIgfHwgIUFycmF5LmlzQXJyYXkoci5jdXJ2ZSkgfHwgIXIuY3VydmUubGVuZ3RoIHx8ICFyLmN1cnZlLmV2ZXJ5KChuOiBhbnkpID0+IE51bWJlci5pc0Zpbml0ZShuKSAmJiBuID4gMCkpIHJldHVybiBudWxsO1xuICAgIGlmIChyLm1lcmdlICE9PSAnZGVwbG95ZWRPbmx5JyAmJiByLm1lcmdlICE9PSAnaGFuZEludG9PbmVTdGFyJykgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIucG9vbCAhPT0gdW5kZWZpbmVkICYmICEoQXJyYXkuaXNBcnJheShyLnBvb2wpICYmIHIucG9vbC5sZW5ndGggJiYgci5wb29sLmV2ZXJ5KGlzU291bCkpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGFnZVdhdmVzID0gci5zdGFnZVdhdmVzID8/IHIuY3VydmUubGVuZ3RoO1xuICAgIGlmICghaW50KHgud2F2ZSwgMSwgTWF0aC5taW4oc3RhZ2VXYXZlcywgci5jdXJ2ZS5sZW5ndGgpKSB8fCAhaW50KHguaGVhcnRzLCAxLCBIRUFSVFMpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5jYXApIHx8IHguY2FwIDw9IDApIHJldHVybiBudWxsO1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh4LmhhbmQpIHx8IHguaGFuZC5sZW5ndGggPiA0MCB8fCAheC5oYW5kLmV2ZXJ5KGlzU291bCkpIHJldHVybiBudWxsO1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh4LnVuaXRzKSB8fCB4LnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIHJldHVybiBudWxsO1xuICAgIGlmICghaW50KHgubmV4dElkLCAxLCAxZTYpIHx8IHR5cGVvZiB4LmRpc2NhcmRVc2VkICE9PSAnYm9vbGVhbicpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNlbGxzID0gbmV3IFNldDxudW1iZXI+KCksIGlkcyA9IG5ldyBTZXQ8bnVtYmVyPigpLCB1bml0czogVW5pdFtdID0gW107XG4gICAgZm9yIChjb25zdCB1IG9mIHgudW5pdHMpIHtcbiAgICAgIGlmICghdSB8fCAhaXNTb3VsKHUuc291bCkgfHwgIWludCh1LnN0YXIsIDEsIE1BWF9TVEFSKSB8fCAhaW50KHUuY2VsbCwgMCwgR1JJRF9DRUxMUyAtIDEpIHx8ICFpbnQodS5pZCwgMSwgeC5uZXh0SWQpIHx8IGNlbGxzLmhhcyh1LmNlbGwpIHx8IGlkcy5oYXModS5pZCkpIHJldHVybiBudWxsO1xuICAgICAgY2VsbHMuYWRkKHUuY2VsbCk7IGlkcy5hZGQodS5pZCk7IHVuaXRzLnB1c2goeyBpZDogdS5pZCwgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCwgZnJlc2g6ICEhdS5mcmVzaCB9KTtcbiAgICB9XG4gICAgY29uc3Qgc3QgPSB4LnN0YXRzO1xuICAgIGlmICghc3QgfHwgIVsnZHJhd24nLCAnZGlzY2FyZGVkJywgJ2Rpc21pc3NlZCcsICdtZXJnZXMnLCAnZmFpbHVyZXMnXS5ldmVyeSgoaykgPT4gTnVtYmVyLmlzRmluaXRlKHN0W2tdKSkpIHJldHVybiBudWxsO1xuICAgIGlmICgheC5ybmcgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnJuZy5zZWVkKSB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnBvcykpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICBydWxlczogciBhcyBSdWxlcywgcm5nOiBtYWtlUm5nKHgucm5nLnNlZWQsIHgucm5nLnBvcyksIHdhdmU6IHgud2F2ZSwgaGVhcnRzOiB4LmhlYXJ0cywgY2FwOiB4LmNhcCwgaGFuZDogeC5oYW5kLnNsaWNlKCksIHVuaXRzLCBuZXh0SWQ6IHgubmV4dElkLFxuICAgICAgZGlzY2FyZFVzZWQ6IHguZGlzY2FyZFVzZWQsIHN0YXR1czogJ2J1aWxkaW5nJywgbG9nOiBBcnJheS5pc0FycmF5KHgubG9nKSA/IHgubG9nLmZpbHRlcigobDogYW55KSA9PiB0eXBlb2YgbCA9PT0gJ3N0cmluZycpLnNsaWNlKC00MCkgOiBbXSxcbiAgICAgIHN0YXRzOiB7IGRyYXduOiBzdC5kcmF3biwgZGlzY2FyZGVkOiBzdC5kaXNjYXJkZWQsIGRpc21pc3NlZDogc3QuZGlzbWlzc2VkLCBtZXJnZXM6IHN0Lm1lcmdlcywgZmFpbHVyZXM6IHN0LmZhaWx1cmVzIH0sXG4gICAgfTtcbiAgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYXZlUnVuKHNuYXA6IFJ1blNuYXBzaG90LCBzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlKSBzdG9yZS5zZXRJdGVtKEtFWSwgSlNPTi5zdHJpbmdpZnkoc25hcCkpOyB9IGNhdGNoIHsgLyogc3RvcmFnZSBmdWxsIG9yIGJsb2NrZWQ6IHRoZSBydW4ganVzdCB3aWxsIG5vdCBzdXJ2aXZlIGEgcmVsb2FkICovIH1cbn1cbmV4cG9ydCBmdW5jdGlvbiBjbGVhclJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB2b2lkIHtcbiAgdHJ5IHsgaWYgKHN0b3JlICYmIChzdG9yZSBhcyBhbnkpLnJlbW92ZUl0ZW0pIChzdG9yZSBhcyBhbnkpLnJlbW92ZUl0ZW0oS0VZKTsgZWxzZSBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCAnJyk7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRSdW4oc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogeyBzbmFwOiBSdW5TbmFwc2hvdDsgc3RhdGU6IFN0YXRlIH0gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB0ID0gc3RvcmUgJiYgc3RvcmUuZ2V0SXRlbShLRVkpOyBpZiAoIXQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHggPSBKU09OLnBhcnNlKHQpO1xuICAgIGlmICgheCB8fCB4LnYgIT09IFZFUlNJT04gfHwgKHgucGhhc2UgIT09ICdidWlsZCcgJiYgeC5waGFzZSAhPT0gJ2RyYWZ0JykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5hdHRlbXB0KSB8fCB0eXBlb2YgeC5kaWZmaWN1bHR5ICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgc3RhdGUgPSBkZXNlcmlhbGl6ZVN0YXRlKHguc3RhdGUpOyBpZiAoIXN0YXRlKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBkcmFmdCA9IHgucGhhc2UgPT09ICdkcmFmdCcgJiYgQXJyYXkuaXNBcnJheSh4LmRyYWZ0KSAmJiB4LmRyYWZ0Lmxlbmd0aCA9PT0gMyAmJiB4LmRyYWZ0LmV2ZXJ5KGlzU291bCkgPyB4LmRyYWZ0IDogbnVsbDtcbiAgICByZXR1cm4geyBzbmFwOiB7IHY6IFZFUlNJT04sIHNlZWQ6IHguc2VlZCwgYXR0ZW1wdDogeC5hdHRlbXB0LCBzdGFnZTogdHlwZW9mIHguc3RhZ2UgPT09ICdzdHJpbmcnID8geC5zdGFnZSA6ICdjcnlwdCcsIGRpZmZpY3VsdHk6IHguZGlmZmljdWx0eSwgcGhhc2U6IGRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCcsIGRyYWZ0LCBzdGF0ZTogeC5zdGF0ZSwgc3RhcnRCZXN0OiBOdW1iZXIuaXNJbnRlZ2VyKHguc3RhcnRCZXN0KSAmJiB4LnN0YXJ0QmVzdCA+PSAwICYmIHguc3RhcnRCZXN0IDw9IDk5OTkgPyB4LnN0YXJ0QmVzdCA6IHVuZGVmaW5lZCB9LCBzdGF0ZSB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cbmV4cG9ydCBjb25zdCBSVU5fVkVSU0lPTiA9IFZFUlNJT047XG4iLCAiLy8gRXZlcnl0aGluZyB5b3UgU0VFIGZvciBhIHVuaXQ6IHJlYWwgVHJpcG8gbW9kZWxzIChTa2VsZXRvbiBXYXJyaW9yLCBTa2VsZXRvbiBBcmNoZXIpLCBzaW1wbGUgc3RhbmQtaW5zIGZvciB0aGUgZm91clxuLy8gY2hhcmFjdGVycyB0aGF0IGFyZSBub3QgZ2VuZXJhdGVkIHlldCwgYW5kIHRoZSBcInN0YXIgbG9va1wiIGxheWVyZWQgb24gdG9wIG9mIGJvdGggKHNpemUsIHRpbnQsIGF1cmEsIGhhbG8sIGJhZGdlKS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuXG5leHBvcnQgdHlwZSBWU3RhdGUgPSAnaWRsZScgfCAncnVuJyB8ICdhdHRhY2snIHwgJ2RlYXRoJyB8ICdzcGF3bicgfCAnY2hlZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybU5vZGU6IHRoZSBnYW1lIHNldHMgcG9zaXRpb24gKyB5YXcgaGVyZVxuICB0ZWFtOiAwIHwgMTsgc3RhcjogbnVtYmVyOyBzdGF0ZTogVlN0YXRlOyB0b3A6IG51bWJlcjtcbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZD86IG51bWJlcik6IHZvaWQ7XG4gIHNldFN0YXIoc3RhcjogbnVtYmVyKTogdm9pZDtcbiAgY2xpcE5hbWVzPygpOiBzdHJpbmdbXTsgICAgICAgICAgICAvLyB0aGUgYW5pbWF0aW9ucyB0aGlzIHVuaXQgaGFzIChmb3IgdGhlIGluc3BlY3QgdmlldylcbiAgcHJldmlld0NsaXA/KG5hbWU6IHN0cmluZyk6IHZvaWQ7ICAvLyBwbGF5IG9uZSBvZiB0aGVtIG9uY2UsIHRoZW4gZ28gYmFjayB0byBpZGxlXG4gIHNldEJvc3M/KG9uOiBib29sZWFuKTogdm9pZDsgICAgICAgLy8gYW4gZW5lbXkgYm9zczogYmlnZ2VyLCB3aXRoIGEgQk9TUyB0YWdcbiAgc2V0TGV2ZWw/KGxldmVsOiBudW1iZXIpOiB2b2lkOyAgICAvLyB0aGUgcGVybWFuZW50IFNvdWwgbGV2ZWwgc2hvd24gYmVzaWRlIHRoZSBoZWFsdGggYmFyIChwbGF5ZXIgdW5pdHMgb25seSlcbiAgc2V0VGVhbSh0ZWFtOiAwIHwgMSk6IHZvaWQ7XG4gIHNldEhwKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAgLy8gbnVsbCBoaWRlcyB0aGUgaGVhbHRoIGJhclxuICBzZXRNYW5hKGZyYWM6IG51bWJlciB8IG51bGwpOiB2b2lkOyAvLyBudWxsIGhpZGVzIHRoZSBtYW5hIGJhciAodW5pdHMgd2l0aG91dCBhIHNraWxsKVxuICBwdWxzZSgpOiB2b2lkOyAgICAgICAgICAgICAgICAgICAgIC8vIGJyaWVmIGhpdCByZWFjdGlvblxuICB1cGRhdGUoZHQ6IG51bWJlcik6IHZvaWQ7XG4gIGRpc3Bvc2UoKTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFyIGxvb2tzXG4vLyAxIHN0YXIgPSB0aGUgcGxhaW4gbW9kZWwuIDIgc3RhcnMgPSBhIGxpdHRsZSBiaWdnZXIsIGNvb2wgc2lsdmVyLWJsdWUgdGludCwgYnJpZ2h0ZXIgYXVyYS4gMyBzdGFycyA9IGJpZ2dlc3QsIHdhcm0gZ29sZCB0aW50LFxuLy8gc3Ryb25nIGdvbGQtdmlvbGV0IGF1cmEgYW5kIGEgZmxvYXRpbmcgZ29sZCBoYWxvLiBFdmVyeXRoaW5nIGhlcmUgaXMgZnJlZTogbm8gZXh0cmEgVHJpcG8gZ2VuZXJhdGlvbnMuXG5jb25zdCBUSU5UOiBudW1iZXJbXVtdID0gW1sxLCAxLCAxXSwgWzAuODYsIDAuOTUsIDEuMThdLCBbMS4yNSwgMS4xLCAwLjddXTtcbmNvbnN0IEFVUkEgPSBbXG4gIHsgcmF0ZTogMTQsIG1pbjogMC4wNiwgbWF4OiAwLjE2LCBjMTogWzAuNzgsIDAuMzUsIDEsIDAuN10sIGMyOiBbMC40NSwgMC4xNSwgMC45LCAwLjVdIH0sXG4gIHsgcmF0ZTogMjYsIG1pbjogMC4wOCwgbWF4OiAwLjIwLCBjMTogWzAuODUsIDAuNjUsIDEsIDAuOF0sIGMyOiBbMC41NSwgMC40LCAxLCAwLjZdIH0sXG4gIHsgcmF0ZTogNDQsIG1pbjogMC4xMCwgbWF4OiAwLjI2LCBjMTogWzEsIDAuODUsIDAuNCwgMC44NV0sIGMyOiBbMC44LCAwLjMsIDEsIDAuN10gfSxcbl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRzIHtcbiAgc2NlbmU6IGFueTsgc29mdDogYW55OyBsdlRleDogUmVjb3JkPG51bWJlciwgYW55Pjsgc3RhclRleDogYW55W107IHRyaXBvOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIFRyaXBvQ2ZnPj47IGVtb3RlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICByaW5nTWF0OiBhbnlbXTsgaGFsb01hdDogYW55OyBiYXJCZzogYW55OyBiYXJGaWxsOiBhbnlbXTsgbWFuYUZpbGw6IGFueTsgYXJyb3c/OiBhbnk7IG5lY3JvPzogYW55O1xufVxuLyoqIEZsYXZvdXIgYSB1bml0IGNhbiBoYXZlOiBhIGNsaXAgaXQgcGxheXMgbm93IGFuZCB0aGVuIHdoZW4gaXQgaGFzIHN0b29kIGlkbGUgZm9yIGEgd2hpbGUsIGEgc21hbGwgZW1vdGUsIGFuZCBhbiBleWUtZ2xvdyBtYXNrIChleWVzIGRpbSB3aGVuIHNsZWVweSwgZmxhcmUgd2hlbiBpdCBmaWdodHMpLiAqL1xuLyoqIElkbGUgY2xpcHMgd2hlcmUgdGhlIHVuaXQgbWFrZXMgYSBub2lzZS4gKi9cbmNvbnN0IFZPQ0FMID0gbmV3IFNldChbJ1JvYXInLCAnVGh1bXAnLCAnU3RvbXAnLCAnU25pY2tlcicsICdTY2hlbWUnLCAnQm9hc3QnLCAnRmxleCcsICdEb3VibGVCaWNlcHMnLCAnRnVtYmxlJywgJ1NoaWVsZEJvbmsnLCAnQm9uayddKTtcbmludGVyZmFjZSBQb3NlIHsgY2xpcDogc3RyaW5nOyBlbW90ZT86IHN0cmluZyB9XG5pbnRlcmZhY2UgRmxhdm9yIHsgY2xpcHM6IFBvc2VbXTsgbWluOiBudW1iZXI7IG1heDogbnVtYmVyIH1cbmludGVyZmFjZSBUcmlwb0NmZyB7IGNvbnRhaW5lcjogYW55OyBlbmVteVRleDogYW55OyBjbGlwczogUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPjsgbWF0Q2FjaGU6IFJlY29yZDxzdHJpbmcsIGFueT47IGJhc2VNYXQ/OiBhbnk7IHRvcDogbnVtYmVyOyBzY2FsZTogbnVtYmVyOyBmbGF2b3I/OiBGbGF2b3I7IGNoZWVycz86IFBvc2VbXTsgc3Bhd25FbW90ZT86IHN0cmluZzsgZXllcz86IHN0cmluZzsgZXllVGV4PzogYW55OyBzdGFyU2NhbGU/OiBudW1iZXJbXSB9XG5cbmZ1bmN0aW9uIGR5bihzY2VuZTogYW55LCB3OiBudW1iZXIsIGg6IG51bWJlciwgZHJhdzogKGM6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCkgPT4gdm9pZCwgYWxwaGEgPSB0cnVlKSB7XG4gIGNvbnN0IHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnZHQnLCB7IHdpZHRoOiB3LCBoZWlnaHQ6IGggfSwgc2NlbmUsIHRydWUpOyBkcmF3KHQuZ2V0Q29udGV4dCgpKTsgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IGFscGhhOyByZXR1cm4gdDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRBc3NldHMoc2NlbmU6IGFueSk6IFByb21pc2U8QXNzZXRzPiB7XG4gIGNvbnN0IHNvZnQgPSBkeW4oc2NlbmUsIDY0LCA2NCwgKGMpID0+IHsgY29uc3QgZyA9IGMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMzIsIDMyLCAwLCAzMiwgMzIsIDMyKTsgZy5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMSknKTsgZy5hZGRDb2xvclN0b3AoMC40LCAncmdiYSgyNTUsMjU1LDI1NSwuNTUpJyk7IGcuYWRkQ29sb3JTdG9wKDEsICdyZ2JhKDI1NSwyNTUsMjU1LDApJyk7IGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCA2NCwgNjQpOyB9KTtcbiAgY29uc3Qgc3RhclRleCA9IFsxLCAyLCAzXS5tYXAoKG4pID0+IGR5bihzY2VuZSwgMTkyLCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgNDBweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVN0eWxlID0gJyMxYTEwMjAnOyBjLmZpbGxTdHlsZSA9IG4gPT09IDMgPyAnI2ZmZDI0YScgOiBuID09PSAyID8gJyNkN2U2ZmYnIDogJyNmMGQ5YTAnOyBjb25zdCBzID0gJ1x1MjYwNScucmVwZWF0KG4pOyBjLnN0cm9rZVRleHQocywgOTYsIDM4KTsgYy5maWxsVGV4dChzLCA5NiwgMzgpOyB9KSk7XG4gIGNvbnN0IGVtaXNzaXZlID0gKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIsIGEgPSAxKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdlbScsIHNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMociwgZywgYik7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbS5hbHBoYSA9IGE7IHJldHVybiBtOyB9O1xuICBjb25zdCBBOiBBc3NldHMgPSB7XG4gICAgc2NlbmUsIHNvZnQsIGx2VGV4OiB7fSwgc3RhclRleCwgdHJpcG86IHt9LCBlbW90ZToge30sIHJpbmdNYXQ6IFtlbWlzc2l2ZSgwLjU1LCAwLjIsIDAuOTUsIDAuOSksIGVtaXNzaXZlKDAuOTUsIDAuMjUsIDAuMiwgMC45KV0sIGhhbG9NYXQ6IGVtaXNzaXZlKDEsIDAuODIsIDAuMywgMC45NSksXG4gICAgYmFyQmc6IGVtaXNzaXZlKDAuMDUsIDAuMDUsIDAuMDgsIDAuNyksIGJhckZpbGw6IFtlbWlzc2l2ZSgwLjU1LCAwLjM1LCAxKSwgZW1pc3NpdmUoMSwgMC40LCAwLjMpXSwgbWFuYUZpbGw6IGVtaXNzaXZlKDAuMjUsIDAuNzUsIDEpLFxuICB9O1xuICAvLyBcIlp6elwiIHRoYXQgZmxvYXRzIHVwIG92ZXIgYSBzbGVlcHkgdW5pdFxuICBjb25zdCB6enogPSBkeW4oc2NlbmUsIDEyOCwgMTI4LCAoYykgPT4geyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDk7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MGQyNic7IGMuZmlsbFN0eWxlID0gJyNlOGQ4ZmYnOyBjLmxpbmVKb2luID0gJ3JvdW5kJztcbiAgICBmb3IgKGNvbnN0IFtjaCwgc2l6ZSwgeCwgeV0gb2YgW1snWicsIDY0LCAzNCwgMTAwXSwgWyd6JywgNDgsIDc0LCA2Nl0sIFsneicsIDM0LCAxMDQsIDM4XV0gYXMgW3N0cmluZywgbnVtYmVyLCBudW1iZXIsIG51bWJlcl1bXSkgeyBjLmZvbnQgPSAnaXRhbGljIDkwMCAnICsgc2l6ZSArICdweCBzYW5zLXNlcmlmJzsgYy5zdHJva2VUZXh0KGNoLCB4LCB5KTsgYy5maWxsVGV4dChjaCwgeCwgeSk7IH0gfSk7XG4gIGNvbnN0IHptID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnenp6Jywgc2NlbmUpOyB6bS5kaWZmdXNlVGV4dHVyZSA9IHp6ejsgem0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB6bS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgem0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgem0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IEEuZW1vdGVbJ3p6eiddID0gem07XG4gIGNvbnN0IGljb24gPSAobmFtZTogc3RyaW5nLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKG5hbWUsIHNjZW5lKTsgbS5kaWZmdXNlVGV4dHVyZSA9IGR5bihzY2VuZSwgMTI4LCAxMjgsIGRyYXcpOyBtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmJhY2tGYWNlQ3VsbGluZyA9IGZhbHNlOyBBLmVtb3RlW25hbWVdID0gbTsgfTtcbiAgY29uc3QgZ2x5cGggPSAoY2g6IHN0cmluZywgZmlsbDogc3RyaW5nKSA9PiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gMTI7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MGQyNic7IGMubGluZUpvaW4gPSAncm91bmQnOyBjLmZpbGxTdHlsZSA9IGZpbGw7IGMuZm9udCA9ICc5MDAgMTA0cHggc2Fucy1zZXJpZic7IGMuc3Ryb2tlVGV4dChjaCwgNjQsIDEwMCk7IGMuZmlsbFRleHQoY2gsIDY0LCAxMDApOyB9O1xuICBpY29uKCc/JywgZ2x5cGgoJz8nLCAnI2ZmZTI3YScpKTsgaWNvbignIScsIGdseXBoKCchJywgJyNmZjlhN2EnKSk7XG4gIGljb24oJ3N3ZWF0JywgKGMpID0+IHsgYy5saW5lV2lkdGggPSA4OyBjLnN0cm9rZVN0eWxlID0gJyMxNTMwNGEnOyBjLmZpbGxTdHlsZSA9ICcjOWZlNGZmJzsgYy5iZWdpblBhdGgoKTsgYy5tb3ZlVG8oNjQsIDE0KTsgYy5iZXppZXJDdXJ2ZVRvKDEwNCwgNjIsIDEwNCwgMTA4LCA2NCwgMTEyKTsgYy5iZXppZXJDdXJ2ZVRvKDI0LCAxMDgsIDI0LCA2MiwgNjQsIDE0KTsgYy5jbG9zZVBhdGgoKTsgYy5zdHJva2UoKTsgYy5maWxsKCk7IH0pO1xuICBpY29uKCdzcGFya2xlJywgKGMpID0+IHsgYy5saW5lV2lkdGggPSA3OyBjLnN0cm9rZVN0eWxlID0gJyMzYTJhMDUnOyBjLmZpbGxTdHlsZSA9ICcjZmZmMmE4JzsgY29uc3Qgc3RhciA9ICh4OiBudW1iZXIsIHk6IG51bWJlciwgcjogbnVtYmVyKSA9PiB7IGMuYmVnaW5QYXRoKCk7IGZvciAobGV0IGkgPSAwOyBpIDwgODsgaSsrKSB7IGNvbnN0IGEgPSBpICogTWF0aC5QSSAvIDQsIHJyID0gaSAlIDIgPyByICogMC4yOCA6IHI7IGMubGluZVRvKHggKyBNYXRoLnNpbihhKSAqIHJyLCB5IC0gTWF0aC5jb3MoYSkgKiBycik7IH0gYy5jbG9zZVBhdGgoKTsgYy5zdHJva2UoKTsgYy5maWxsKCk7IH07IHN0YXIoNTYsIDcwLCA1MCk7IHN0YXIoMTAyLCAyOCwgMjApOyBzdGFyKDI2LCAyNCwgMTQpOyB9KTtcbiAgY29uc3QgZGVmczogW1NvdWxJZCwgc3RyaW5nLCBzdHJpbmcsIFJlY29yZDxWU3RhdGUsIHN0cmluZz4sIG51bWJlciwgbnVtYmVyLCBhbnk/XVtdID0gW1xuICAgIFsnd2FycmlvcicsICdTa2VsZXRvbldhcnJpb3IuZ2xiJywgJ1NrZWxldG9uV2Fycmlvcl9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0NoZWVyJyB9LCAxLjA1LCAxLjAsIHsgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnVHJpcCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnQm9uaycsIGVtb3RlOiAnPycgfSwgeyBjbGlwOiAnV29iYmxlJywgZW1vdGU6ICdzd2VhdCcgfSwgeyBjbGlwOiAnV2F2ZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRnVtYmxlJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdTaGllbGRCb25rJywgZW1vdGU6ICc/JyB9XSwgbWluOiA4LCBtYXg6IDE1IH0sIGNoZWVyczogW3sgY2xpcDogJ0NoZWVyJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdXYXZlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdUcmlwJywgZW1vdGU6ICchJyB9XSwgZXllczogJ1NrZWxldG9uV2Fycmlvcl9leWVzLnBuZycgfV0sXG4gICAgWydhcmNoZXInLCAnU2tlbGV0b25BcmNoZXIuZ2xiJywgJ1NrZWxldG9uQXJjaGVyX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdTaG9vdCcsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdGbGV4JyB9LCAxLjA1LCAxLjAsIHsgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnRmxleCcsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRG91YmxlQmljZXBzJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb25lQ3JhY2snIH0sIHsgY2xpcDogJ0Jvd1R3aXJsJywgZW1vdGU6ICdzcGFya2xlJyB9XSwgbWluOiA4LCBtYXg6IDE1IH0sIGNoZWVyczogW3sgY2xpcDogJ0ZsZXgnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0RvdWJsZUJpY2VwcycsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnQm93VHdpcmwnLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBleWVzOiAnU2tlbGV0b25BcmNoZXJfZXllcy5wbmcnIH1dLFxuICAgIFsnZ29ibGluJywgJ0dvYmxpbi5nbGInLCAnR29ibGluX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMCwgMC44NSwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdTY2hlbWUnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1BlZWsnLCBlbW90ZTogJz8nIH0sIHsgY2xpcDogJ1NwaW4nLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1NuaWNrZXInLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDYsIG1heDogMTIgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1NuaWNrZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1NwaW4nLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBleWVzOiAnR29ibGluX2V5ZXMucG5nJyB9XSxcbiAgICBbJ2tuaWdodCcsICdLbmlnaHQuZ2xiJywgJ0tuaWdodF9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ1Bvc2UnIH0sIDEuMCwgMS4wNSwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdTYWx1dGUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvYXN0JywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdBZG1pcmUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1ByYXknLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnUG9zZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU2FsdXRlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb2FzdCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnUHJheScsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdLbmlnaHRfZXllcy5wbmcnIH1dLFxuICAgIFsnYmFyYmFyaWFuJywgJ0JhcmJhcmlhbi5nbGInLCAnQmFyYmFyaWFuX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMCwgMS4wNSwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdSb2FyJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdDaGVzdEJlYXQnIH0sIHsgY2xpcDogJ1N0b21wJywgZW1vdGU6ICchJyB9XSwgbWluOiA3LCBtYXg6IDEzIH0sIGNoZWVyczogW3sgY2xpcDogJ0NoZWVyJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdSb2FyJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdDaGVzdEJlYXQnIH1dLCBleWVzOiAnQmFyYmFyaWFuX2V5ZXMucG5nJyB9XSxcbiAgICBbJ29ncmUnLCAnT2dyZS5nbGInLCAnT2dyZV9lbmVteS5qcGcnLCB7IGlkbGU6ICdJZGxlJywgcnVuOiAnUnVuJywgYXR0YWNrOiAnQXR0YWNrJywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0NoZWVyJyB9LCAxLjAyLCAxLjEyLCB7IHN0YXJTY2FsZTogWzEsIDEuMywgMS42NV0sIGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1lhd24nLCBlbW90ZTogJ3p6eicgfSwgeyBjbGlwOiAnU2NyYXRjaCcgfSwgeyBjbGlwOiAnU3RvbXAnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1RodW1wJyB9XSwgbWluOiA5LCBtYXg6IDE2IH0sIGNoZWVyczogW3sgY2xpcDogJ0NoZWVyJyB9LCB7IGNsaXA6ICdUaHVtcCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnU3RvbXAnLCBlbW90ZTogJyEnIH1dLCBzcGF3bkVtb3RlOiAnenp6JywgZXllczogJ09ncmVfZXllcy5wbmcnIH1dLFxuICBdO1xuICBjb25zdCBuZWNyb1AgPSBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgJ05lY3JvbWFuY2VyLmdsYicsIHNjZW5lKS50aGVuKChjOiBhbnkpID0+IHsgQS5uZWNybyA9IGM7IH0pLmNhdGNoKCgpID0+IHsgLyogdGhlIGdhbWUgY2Fubm90IHNob3cgaGltICovIH0pO1xuICBjb25zdCBhcnJvd1AgPSBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgJ0Fycm93LmdsYicsIHNjZW5lKS50aGVuKChjOiBhbnkpID0+IHsgQS5hcnJvdyA9IGM7IH0pLmNhdGNoKCgpID0+IHsgLyogZmFsbHMgYmFjayB0byB0aGUgcGxhaW4gbGluZSAqLyB9KTtcbiAgYXdhaXQgUHJvbWlzZS5hbGwoW2Fycm93UCwgbmVjcm9QLCAuLi5kZWZzLm1hcChhc3luYyAoW3NvdWwsIGdsYiwgZW5lbXksIGNsaXBzLCB0b3AsIHNjYWxlLCBleHRyYV0pID0+IHtcbiAgICBjb25zdCBjb250YWluZXIgPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvJywgZ2xiLCBzY2VuZSk7XG4gICAgQS50cmlwb1tzb3VsXSA9IHsgY29udGFpbmVyLCBlbmVteVRleDogbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBlbmVteSwgc2NlbmUsIGZhbHNlLCBmYWxzZSksIGNsaXBzLCBtYXRDYWNoZToge30sIHRvcCwgc2NhbGUsIC4uLihleHRyYSB8fCB7fSksIGV5ZVRleDogZXh0cmEgJiYgZXh0cmEuZXllcyA/IG5ldyBCQUJZTE9OLlRleHR1cmUoJ2Fzc2V0cy8nICsgZXh0cmEuZXllcywgc2NlbmUsIGZhbHNlLCBmYWxzZSkgOiB1bmRlZmluZWQgfTtcbiAgfSldKTtcbiAgcmV0dXJuIEE7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2hhcmVkIGRlY29yYXRpb25cbmNsYXNzIERlY28ge1xuICBwcml2YXRlIHBzOiBhbnkgPSBudWxsOyBwcml2YXRlIGhhbG86IGFueSA9IG51bGw7IHByaXZhdGUgYmFkZ2U6IGFueTsgcHJpdmF0ZSBzdGFyczogYW55OyBwcml2YXRlIGZpbGw6IGFueTsgcHJpdmF0ZSBiYXI6IGFueTsgcHJpdmF0ZSBtYmc6IGFueTsgcHJpdmF0ZSBtZmlsbDogYW55OyBwcml2YXRlIHJpbmc6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgcGFyZW50OiBhbnksIHByaXZhdGUgdG9wOiBudW1iZXIsIHByaXZhdGUgcmFkaXVzOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZTtcbiAgICB0aGlzLnJpbmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZURpc2MoJ3JpbmcnLCB7IHJhZGl1czogTWF0aC5tYXgoMC4zLCByYWRpdXMgKiAxLjE1KSwgdGVzc2VsbGF0aW9uOiAyNiB9LCBzKTsgdGhpcy5yaW5nLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdGhpcy5yaW5nLnBvc2l0aW9uLnkgPSAwLjAyOyB0aGlzLnJpbmcucGFyZW50ID0gcGFyZW50OyB0aGlzLnJpbmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMuYmFkZ2UgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdiYWRnZScsIHMpOyB0aGlzLmJhZGdlLnBhcmVudCA9IHBhcmVudDsgdGhpcy5iYWRnZS5wb3NpdGlvbi55ID0gdG9wICsgMC4zMjsgdGhpcy5iYWRnZS5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMO1xuICAgIHRoaXMuc3RhcnMgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdzdGFycycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjE1IH0sIHMpOyB0aGlzLnN0YXJzLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuc3RhcnMucG9zaXRpb24ueSA9IDAuMTE7IHRoaXMuc3RhcnMuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IHNtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnc20nLCBzKTsgc20uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IHNtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHNtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgdGhpcy5zdGFycy5tYXRlcmlhbCA9IHNtOyAodGhpcy5zdGFycyBhcyBhbnkpLl9zbSA9IHNtO1xuICAgIGNvbnN0IGJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnYmcnLCB7IHdpZHRoOiAwLjYsIGhlaWdodDogMC4wODUgfSwgcyk7IGJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IGJnLm1hdGVyaWFsID0gQS5iYXJCZzsgYmcuaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmJhciA9IGJnO1xuICAgIHRoaXMuZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2ZpbGwnLCB7IHdpZHRoOiAwLjU2LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMuZmlsbC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLmZpbGwucG9zaXRpb24ueiA9IC0wLjAwMjsgdGhpcy5maWxsLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLm1iZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21iZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA1IH0sIHMpOyB0aGlzLm1iZy5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLm1iZy5wb3NpdGlvbi55ID0gLTAuMDc7IHRoaXMubWJnLm1hdGVyaWFsID0gQS5iYXJCZzsgdGhpcy5tYmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWZpbGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdtZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wMyB9LCBzKTsgdGhpcy5tZmlsbC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLm1maWxsLnBvc2l0aW9uLnNldCgwLCAtMC4wNywgLTAuMDAyKTsgdGhpcy5tZmlsbC5tYXRlcmlhbCA9IEEubWFuYUZpbGw7IHRoaXMubWZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubHYgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdsdicsIHsgd2lkdGg6IDAuMzYsIGhlaWdodDogMC4xMzUgfSwgcyk7IHRoaXMubHYucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5sdi5wb3NpdGlvbi5zZXQoLTAuNTIsIDAuMCwgMCk7IHRoaXMubHYuaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmx2LnNldEVuYWJsZWQoZmFsc2UpO1xuICAgIGNvbnN0IGxtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbHZtJywgcyk7IGxtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBsbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBsbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHRoaXMubHYubWF0ZXJpYWwgPSBsbTtcbiAgICB0aGlzLmJhci5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5maWxsLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1iZy5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBwcml2YXRlIGx2OiBhbnk7IHByaXZhdGUgbHZOID0gMDsgcHJpdmF0ZSBiYXJPbiA9IGZhbHNlOyBwcml2YXRlIHRhZzogYW55ID0gbnVsbDtcbiAgLyoqIEEgcmVkIEJPU1MgdGFnIGFib3ZlIHRoZSBzdGFycy4gKi9cbiAgc2V0Qm9zcyhvbjogYm9vbGVhbikge1xuICAgIGlmICghb24pIHsgaWYgKHRoaXMudGFnKSB0aGlzLnRhZy5zZXRFbmFibGVkKGZhbHNlKTsgcmV0dXJuOyB9XG4gICAgaWYgKCF0aGlzLnRhZykge1xuICAgICAgY29uc3QgQSA9IHRoaXMuQSwgdCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2Jvc3N0YWcnLCB7IHdpZHRoOiAwLjUsIGhlaWdodDogMC4xNyB9LCBBLnNjZW5lKTsgdC5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0LnBvc2l0aW9uLnNldCgwLCAwLjI5LCAwKTsgdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnYm9zc3RhZ20nLCBBLnNjZW5lKTsgbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTtcbiAgICAgIG0uZGlmZnVzZVRleHR1cmUgPSBkeW4oQS5zY2VuZSwgMTkyLCA2NCwgKGMpID0+IHsgYy5mb250ID0gJzkwMCA0NnB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDg7IGMuc3Ryb2tlU3R5bGUgPSAnIzJhMDUwOCc7IGMuZmlsbFN0eWxlID0gJyNmZjViNGEnOyBjLmxpbmVKb2luID0gJ3JvdW5kJzsgYy5zdHJva2VUZXh0KCdCT1NTJywgOTYsIDQ4KTsgYy5maWxsVGV4dCgnQk9TUycsIDk2LCA0OCk7IH0pO1xuICAgICAgdC5tYXRlcmlhbCA9IG07IHRoaXMudGFnID0gdDtcbiAgICB9XG4gICAgdGhpcy50YWcuc2V0RW5hYmxlZCh0cnVlKTtcbiAgfVxuICAvKiogXCJMViBuXCIgYmVzaWRlIHRoZSBoZWFsdGggYmFyIChwZXJtYW5lbnQgU291bCBsZXZlbCk7IDAgaGlkZXMgaXQuICovXG4gIHNldExldmVsKG46IG51bWJlcikge1xuICAgIHRoaXMubHZOID0gbjsgaWYgKCF0aGlzLmx2KSByZXR1cm47IGlmIChuIDw9IDAgfHwgIXRoaXMuYmFyT24pIHsgdGhpcy5sdi5zZXRFbmFibGVkKGZhbHNlKTsgaWYgKG4gPiAwKSB0aGlzLmVuc3VyZUx2KG4pOyByZXR1cm47IH1cbiAgICB0aGlzLmVuc3VyZUx2KG4pOyB0aGlzLmx2LnNldEVuYWJsZWQodHJ1ZSk7XG4gIH1cbiAgcHJpdmF0ZSBlbnN1cmVMdihuOiBudW1iZXIpIHtcbiAgICBjb25zdCBBID0gdGhpcy5BOyBpZiAoIUEubHZUZXhbbl0pIEEubHZUZXhbbl0gPSBkeW4oQS5zY2VuZSwgMTI4LCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgMzRweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSA2OyBjLnN0cm9rZVN0eWxlID0gJyMxNTBkMjYnOyBjLmZpbGxTdHlsZSA9ICcjZThkOGZmJzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7IGMuc3Ryb2tlVGV4dCgnTFYgJyArIG4sIDY0LCAzNik7IGMuZmlsbFRleHQoJ0xWICcgKyBuLCA2NCwgMzYpOyB9KTtcbiAgICAodGhpcy5sdi5tYXRlcmlhbCBhcyBhbnkpLmRpZmZ1c2VUZXh0dXJlID0gQS5sdlRleFtuXTtcbiAgfVxuICAvKiogVGhlIGJhcnMga2VlcCB0aGUgc2FtZSBzaXplIGFuZCB0aGUgc2FtZSBzbWFsbCBnYXAgYWJvdmUgdGhlIGhlYWQgaG93ZXZlciBiaWcgdGhlIHVuaXQgZ3Jvd3MuICovXG4gIGZpdChrOiBudW1iZXIpIHsgdGhpcy5iYWRnZS5zY2FsaW5nLnNldEFsbCgxIC8gayk7IHRoaXMuYmFkZ2UucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4zIC8gazsgaWYgKHRoaXMuaGFsbykgdGhpcy5oYWxvLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuMDg7IH1cbiAgc2V0KHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5BLnNjZW5lLCBjZmcgPSBBVVJBW3N0YXIgLSAxXTtcbiAgICAodGhpcy5zdGFycyBhcyBhbnkpLl9zbS5kaWZmdXNlVGV4dHVyZSA9IHRoaXMuQS5zdGFyVGV4W3N0YXIgLSAxXTtcbiAgICB0aGlzLnJpbmcubWF0ZXJpYWwgPSB0aGlzLkEucmluZ01hdFt0ZWFtXTsgdGhpcy5maWxsLm1hdGVyaWFsID0gdGhpcy5BLmJhckZpbGxbdGVhbV07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJhaXNlZCBieSB0aGUgTmVjcm9tYW5jZXI6IHB1cnBsZSBhdXJhIHRoYXQgZ3Jvd3Mgd2l0aCBzdGFyc1xuICAgICAgaWYgKCF0aGlzLnBzKSB7XG4gICAgICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2F1cmEnLCA3MCwgcyk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5wYXJlbnQ7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIHRoaXMudG9wICogMC41LCAwLjIpO1xuICAgICAgICBwcy5taW5MaWZlVGltZSA9IDAuNTsgcHMubWF4TGlmZVRpbWUgPSAxLjE7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjgsIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS41LCAwLjE1KTtcbiAgICAgICAgcHMubWluRW1pdFBvd2VyID0gMC4zNTsgcHMubWF4RW1pdFBvd2VyID0gMC44OyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjQsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHRoaXMucHMgPSBwcztcbiAgICAgIH1cbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBzOyBwLmVtaXRSYXRlID0gY2ZnLnJhdGU7IHAubWluU2l6ZSA9IGNmZy5taW47IHAubWF4U2l6ZSA9IGNmZy5tYXg7IHAuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMSk7IHAuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLmNmZy5jMik7IHAuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMiwgMCwgMC40LCAwKTtcbiAgICAgIGlmICghcC5pc1N0YXJ0ZWQoKSkgcC5zdGFydCgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wcyAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTtcbiAgICBpZiAoc3RhciA+PSAzKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBoYWxvIGFib3ZlIHRoZSBoZWFkXG4gICAgICBpZiAoIXRoaXMuaGFsbykgeyB0aGlzLmhhbG8gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdoYWxvJywgeyBkaWFtZXRlcjogMC41NSwgdGhpY2tuZXNzOiAwLjA0LCB0ZXNzZWxsYXRpb246IDI0IH0sIHMpOyB0aGlzLmhhbG8ucGFyZW50ID0gdGhpcy5wYXJlbnQ7IHRoaXMuaGFsby5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjA4OyB0aGlzLmhhbG8ubWF0ZXJpYWwgPSB0aGlzLkEuaGFsb01hdDsgdGhpcy5oYWxvLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgICAgdGhpcy5oYWxvLnNldEVuYWJsZWQodHJ1ZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmhhbG8pIHRoaXMuaGFsby5zZXRFbmFibGVkKGZhbHNlKTtcbiAgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLmJhci5zZXRFbmFibGVkKG9uKTsgdGhpcy5maWxsLnNldEVuYWJsZWQob24pOyB0aGlzLmJhck9uID0gb247IGlmICh0aGlzLmx2KSB0aGlzLmx2LnNldEVuYWJsZWQob24gJiYgdGhpcy5sdk4gPiAwKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMuZmlsbC5zY2FsaW5nLnggPSBrOyB0aGlzLmZpbGwucG9zaXRpb24ueCA9IC0oMC41NiAqICgxIC0gaykpIC8gMjsgfVxuICB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkge1xuICAgIGNvbnN0IG9uID0gZiAhPT0gbnVsbDsgdGhpcy5tYmcuc2V0RW5hYmxlZChvbik7IHRoaXMubWZpbGwuc2V0RW5hYmxlZChvbik7XG4gICAgaWYgKG9uKSB7IGNvbnN0IGsgPSBNYXRoLm1heCgwLjAwMSwgZiBhcyBudW1iZXIpOyB0aGlzLm1maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMubWZpbGwucG9zaXRpb24ueCA9IC0oMC41NiAqICgxIC0gaykpIC8gMjsgfVxuICB9XG4gIHNldEF1cmEob246IGJvb2xlYW4pIHsgaWYgKHRoaXMucHMpIHsgaWYgKG9uICYmICF0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0YXJ0KCk7IGlmICghb24gJiYgdGhpcy5wcy5pc1N0YXJ0ZWQoKSkgdGhpcy5wcy5zdG9wKCk7IH0gfVxuICB1cGRhdGUoZHQ6IG51bWJlcikgeyBpZiAodGhpcy5oYWxvICYmIHRoaXMuaGFsby5pc0VuYWJsZWQoKSkgdGhpcy5oYWxvLnJvdGF0aW9uLnkgKz0gZHQgKiAxLjY7IH1cbiAgZGlzcG9zZSgpIHsgaWYgKHRoaXMucHMpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB9IFt0aGlzLmhhbG8sIHRoaXMucmluZywgdGhpcy5zdGFycywgdGhpcy5iYXIsIHRoaXMuZmlsbCwgdGhpcy5tYmcsIHRoaXMubWZpbGxdLmZvckVhY2goKG0pID0+IG0gJiYgbS5kaXNwb3NlKCkpOyB0aGlzLmJhZGdlLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHJlYWwgbW9kZWxzXG5jbGFzcyBUcmlwb1Zpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSBlbnQ6IGFueTsgcHJpdmF0ZSBib2R5OiBhbnk7IHByaXZhdGUgYW5pbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTsgcHJpdmF0ZSBjdXI6IGFueSA9IG51bGw7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBiYXNlOiBudW1iZXI7XG4gIHByaXZhdGUgbGFzdEZsYXZvciA9ICcnOyBwcml2YXRlIHVpZCA9ICcnOyBwcml2YXRlIG93bjogYW55ID0gbnVsbDsgcHJpdmF0ZSBpZGxlVCA9IDA7IHByaXZhdGUgbmV4dEZsYXZvciA9IDFlOTsgcHJpdmF0ZSBmbGF2b3JPbiA9IGZhbHNlOyBwcml2YXRlIHF1ZXVlZCA9IGZhbHNlOyBwcml2YXRlIHNwYXduVCA9IDA7IHByaXZhdGUgZXllSyA9IDAuNjU7IHByaXZhdGUgZW1vdGVzOiB7IG06IGFueTsgdDogbnVtYmVyOyB5MDogbnVtYmVyIH1bXSA9IFtdO1xuICBwcml2YXRlIHNvdWxJZDogU291bElkO1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBjZmc6IFRyaXBvQ2ZnLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICB0aGlzLnNvdWxJZCA9IHNvdWw7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIHVpZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDcpOyB0aGlzLnVpZCA9IHVpZDtcbiAgICB0aGlzLmVudCA9IGNmZy5jb250YWluZXIuaW5zdGFudGlhdGVNb2RlbHNUb1NjZW5lKChuOiBzdHJpbmcpID0+IG4gKyAnXycgKyB1aWQsIGZhbHNlLCB7IGRvTm90SW5zdGFudGlhdGU6IHRydWUgfSk7XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd1bml0XycgKyB1aWQsIHMpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgdGhpcy5ib2R5ID0gdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZmluZCgobTogYW55KSA9PiBtLm5hbWUuaW5jbHVkZXMoJ19Cb2R5JykpO1xuICAgIGlmICghY2ZnLmJhc2VNYXQpIGNmZy5iYXNlTWF0ID0gdGhpcy5ib2R5Lm1hdGVyaWFsO1xuICAgIHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IHsgZy5zdG9wKCk7IGcuZW5hYmxlQmxlbmRpbmcgPSB0cnVlOyBnLmJsZW5kaW5nU3BlZWQgPSAwLjEyOyB0aGlzLmFuaW1zW2cubmFtZS5zcGxpdCgnXycpWzBdXSA9IGc7IH0pO1xuICAgIHRoaXMuZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB9KTtcbiAgICB0aGlzLnRvcCA9IGNmZy50b3A7IHRoaXMuYmFzZSA9IGNmZy5zY2FsZTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICBpZiAoY2ZnLmZsYXZvcikgdGhpcy5uZXh0Rmxhdm9yID0gY2ZnLmZsYXZvci5taW4gKyBNYXRoLnJhbmRvbSgpICogKGNmZy5mbGF2b3IubWF4IC0gY2ZnLmZsYXZvci5taW4pO1xuICAgIHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgMC4zKTtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IDEuMywgZGlhbWV0ZXI6IDAuOCB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IDAuNjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLmlzUGlja2FibGUgPSB0cnVlO1xuICAgIHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gIH1cbiAgcHJpdmF0ZSBhcHBseU1hdCgpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLnRlYW0gKyAnXycgKyB0aGlzLnN0YXIsIGMgPSB0aGlzLmNmZztcbiAgICBpZiAoYy5leWVUZXgpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgdW5pdCBoYXMgZ2xvd2luZyBleWVzOiBpdCBnZXRzIGl0cyBvd24gbWF0ZXJpYWwgc28gaXRzIGdsb3cgY2FuIGNoYW5nZSBvbiBpdHMgb3duXG4gICAgICBpZiAoIXRoaXMub3duKSB7IHRoaXMub3duID0gYy5iYXNlTWF0LmNsb25lKCdvd25fJyArIHRoaXMudWlkKTsgdGhpcy5vd24uZW1pc3NpdmVUZXh0dXJlID0gYy5leWVUZXg7IHRoaXMub3duLmVtaXNzaXZlSW50ZW5zaXR5ID0gdGhpcy5leWVLOyB9XG4gICAgICB0aGlzLm93bi5hbGJlZG9UZXh0dXJlID0gdGhpcy50ZWFtID09PSAxID8gYy5lbmVteVRleCA6IGMuYmFzZU1hdC5hbGJlZG9UZXh0dXJlOyBjb25zdCB0ID0gVElOVFt0aGlzLnN0YXIgLSAxXTsgdGhpcy5vd24uYWxiZWRvQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjModFswXSwgdFsxXSwgdFsyXSk7XG4gICAgICB0aGlzLm93bi5lbWlzc2l2ZUNvbG9yID0gdGhpcy50ZWFtID09PSAxID8gbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNzIsIDAuMikgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC43OCwgMC4zLCAxKTtcbiAgICAgIHRoaXMuYm9keS5tYXRlcmlhbCA9IHRoaXMub3duOyByZXR1cm47XG4gICAgfVxuICAgIGlmICghYy5tYXRDYWNoZVtrZXldKSB7IGNvbnN0IG0gPSBjLmJhc2VNYXQuY2xvbmUoJ21fJyArIGtleSk7IGlmICh0aGlzLnRlYW0gPT09IDEpIG0uYWxiZWRvVGV4dHVyZSA9IGMuZW5lbXlUZXg7IGNvbnN0IHQgPSBUSU5UW3RoaXMuc3RhciAtIDFdOyBtLmFsYmVkb0NvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKHRbMF0sIHRbMV0sIHRbMl0pOyBjLm1hdENhY2hlW2tleV0gPSBtOyB9XG4gICAgdGhpcy5ib2R5Lm1hdGVyaWFsID0gYy5tYXRDYWNoZVtrZXldO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgdGhpcy5hcHBseU1hdCgpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuc2Moc3QpICogdGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgdGhpcy5kZWNvLmZpdCh0aGlzLnNjKHN0KSAqIHRoaXMuYmFzZSk7IH1cbiAgcHJpdmF0ZSBib3NzSyA9IDE7XG4gIC8qKiBUaGUgaW5zcGVjdCB2aWV3OiB3aGljaCBhbmltYXRpb25zIHRoaXMgdW5pdCBoYXMsIGFuZCBhIHdheSB0byBwbGF5IGFueSBvbmUgb2YgdGhlbS4gKi9cbiAgY2xpcE5hbWVzKCk6IHN0cmluZ1tdIHsgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuYW5pbXMpLmZpbHRlcigobikgPT4gbiAhPT0gJ1dhbGsnICYmIG4gIT09ICdIaXQnKTsgfVxuICBwcmV2aWV3Q2xpcChuYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tuYW1lXTsgaWYgKCFnKSByZXR1cm47XG4gICAgaWYgKG5hbWUgPT09ICdJZGxlJykgeyB0aGlzLnBsYXkoJ2lkbGUnKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5xdWV1ZWQgPSBmYWxzZTsgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGZhbHNlLCAxLCBnLmZyb20sIGcudG8pOyB0aGlzLmN1ciA9IGc7IHRoaXMuZmxhdm9yT24gPSB0cnVlOyB0aGlzLnN0YXRlID0gJ2lkbGUnOyB0aGlzLmlkbGVUID0gMDtcbiAgICBjb25zdCBwb3NlID0gWy4uLih0aGlzLmNmZy5mbGF2b3I/LmNsaXBzIHx8IFtdKSwgLi4uKHRoaXMuY2ZnLmNoZWVycyB8fCBbXSldLmZpbmQoKHApID0+IHAuY2xpcCA9PT0gbmFtZSk7XG4gICAgaWYgKHBvc2UgJiYgcG9zZS5lbW90ZSkgeyB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuNCk7IGlmIChwb3NlLmVtb3RlID09PSAnenp6JykgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAxLjIpOyB9XG4gICAgaWYgKFZPQ0FMLmhhcyhuYW1lKSB8fCBuYW1lID09PSAnQ2hlZXInIHx8IG5hbWUgPT09ICdBdHRhY2snKSBhdWRpby5iYXJrKHRoaXMuc291bElkLCAwLjIpO1xuICB9XG4gIHByaXZhdGUgc2Moc3Q6IG51bWJlcikgeyByZXR1cm4gKHRoaXMuY2ZnLnN0YXJTY2FsZSB8fCBCQUxBTkNFLnN0YXIuc2NhbGUpW3N0IC0gMV0gKiB0aGlzLmJvc3NLOyB9XG4gIHNldEJvc3Mob246IGJvb2xlYW4pIHsgdGhpcy5ib3NzSyA9IG9uID8gMS4zIDogMTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5zYyh0aGlzLnN0YXIpICogdGhpcy5iYXNlKTsgdGhpcy5kZWNvLmZpdCh0aGlzLnNjKHRoaXMuc3RhcikgKiB0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0Qm9zcyhvbik7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TGV2ZWwobjogbnVtYmVyKSB7IHRoaXMuZGVjby5zZXRMZXZlbChuKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkge1xuICAgIGxldCBjbGlwID0gdGhpcy5jZmcuY2xpcHNbc3RhdGVdLCBwb3NlOiBQb3NlIHwgdW5kZWZpbmVkO1xuICAgIGlmIChzdGF0ZSA9PT0gJ2NoZWVyJyAmJiB0aGlzLmNmZy5jaGVlcnMpIHsgcG9zZSA9IHRoaXMuY2ZnLmNoZWVyc1tNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0aGlzLmNmZy5jaGVlcnMubGVuZ3RoKV07IGNsaXAgPSBwb3NlLmNsaXA7IH1cbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tjbGlwXTsgaWYgKCFnKSByZXR1cm47IGNvbnN0IGxvb3AgPSBzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJztcbiAgICBpZiAoc3RhdGUgPT09ICdpZGxlJyAmJiB0aGlzLnN0YXRlID09PSAnc3Bhd24nICYmIHRoaXMuY3VyICYmIHRoaXMuY3VyLmlzU3RhcnRlZCAmJiB0aGlzLmNmZy5mbGF2b3IpIHsgdGhpcy5xdWV1ZWQgPSB0cnVlOyByZXR1cm47IH0gICAvLyBsZXQgdGhlIHdha2UtdXAgcGxheSB0byB0aGUgZW5kXG4gICAgaWYgKGxvb3AgJiYgdGhpcy5zdGF0ZSA9PT0gc3RhdGUgJiYgdGhpcy5jdXIgPT09IGcpIHJldHVybjtcbiAgICB0aGlzLnF1ZXVlZCA9IGZhbHNlOyB0aGlzLmZsYXZvck9uID0gZmFsc2U7IHRoaXMuaWRsZVQgPSAwO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChsb29wLCBzcGVlZCwgZy5mcm9tLCBnLnRvKTtcbiAgICBpZiAobG9vcCkgZy5nb1RvRnJhbWUoZy5mcm9tICsgTWF0aC5yYW5kb20oKSAqIChnLnRvIC0gZy5mcm9tKSk7XG4gICAgdGhpcy5jdXIgPSBnOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTtcbiAgICBpZiAocG9zZSAmJiBwb3NlLmVtb3RlKSB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuMzUpO1xuICAgIGlmIChzdGF0ZSA9PT0gJ3NwYXduJykgeyB0aGlzLnNwYXduVCA9IDA7IGlmICh0aGlzLmNmZy5zcGF3bkVtb3RlKSB7IHRoaXMuZW1vdGUodGhpcy5jZmcuc3Bhd25FbW90ZSwgMC4xKTsgdGhpcy5lbW90ZSh0aGlzLmNmZy5zcGF3bkVtb3RlLCAwLjcpOyB9IH1cbiAgfVxuICAvKiogQSBsaXR0bGUgcGljdHVyZSB0aGF0IGZsb2F0cyB1cCBvdmVyIHRoZSBoZWFkIGFuZCBmYWRlcyAoYSBzbGVlcHkgXCJaenpcIikuICovXG4gIHByaXZhdGUgZW1vdGUoa2luZDogc3RyaW5nLCBkZWxheSA9IDApIHtcbiAgICBjb25zdCBtYXQgPSB0aGlzLkEuZW1vdGVba2luZF07IGlmICghbWF0KSByZXR1cm47XG4gICAgY29uc3QgcGwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdlbW8nLCB7IHNpemU6IDAuNDIgfSwgdGhpcy5BLnNjZW5lKTsgcGwucGFyZW50ID0gdGhpcy5ob2xkZXI7IHBsLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7IHBsLm1hdGVyaWFsID0gbWF0OyBwbC5pc1BpY2thYmxlID0gZmFsc2U7IHBsLnZpc2liaWxpdHkgPSAwO1xuICAgIGNvbnN0IHkwID0gdGhpcy50b3AgKyAwLjAyOyBwbC5wb3NpdGlvbi5zZXQoMC4xNiwgeTAsIDApOyB0aGlzLmVtb3Rlcy5wdXNoKHsgbTogcGwsIHQ6IC1kZWxheSwgeTAgfSk7XG4gIH1cbiAgLyoqIEFmdGVyIHN0YW5kaW5nIGlkbGUgZm9yIGEgd2hpbGU6IHBsYXkgdGhlIHVuaXQncyBmbGF2b3VyIGNsaXAgb25jZSAodGhlIE9ncmUgeWF3bnMpLCB0aGVuIGdvIGJhY2sgdG8gaWRsaW5nLiAqL1xuICBwcml2YXRlIHN0YXJ0Rmxhdm9yKCkge1xuICAgIGNvbnN0IGYgPSB0aGlzLmNmZy5mbGF2b3IhOyB0aGlzLmlkbGVUID0gMDtcbiAgICBsZXQgcG9vbCA9IGYuY2xpcHMuZmlsdGVyKChjKSA9PiBjLmNsaXAgIT09IHRoaXMubGFzdEZsYXZvciAmJiB0aGlzLmFuaW1zW2MuY2xpcF0pOyBpZiAoIXBvb2wubGVuZ3RoKSBwb29sID0gZi5jbGlwcy5maWx0ZXIoKGMpID0+IHRoaXMuYW5pbXNbYy5jbGlwXSk7IGlmICghcG9vbC5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCBwb3NlID0gcG9vbFtNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBwb29sLmxlbmd0aCldLCBnID0gdGhpcy5hbmltc1twb3NlLmNsaXBdOyB0aGlzLmxhc3RGbGF2b3IgPSBwb3NlLmNsaXA7XG4gICAgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGZhbHNlLCAxLCBnLmZyb20sIGcudG8pOyB0aGlzLmN1ciA9IGc7IHRoaXMuZmxhdm9yT24gPSB0cnVlOyB0aGlzLm5leHRGbGF2b3IgPSBmLm1pbiArIE1hdGgucmFuZG9tKCkgKiAoZi5tYXggLSBmLm1pbik7XG4gICAgaWYgKFZPQ0FMLmhhcyhwb3NlLmNsaXApKSBhdWRpby5iYXJrKHRoaXMuc291bElkLCAwLjI1KTtcbiAgICBpZiAocG9zZS5lbW90ZSkgeyB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDAuNCk7IGlmIChwb3NlLmVtb3RlID09PSAnenp6JykgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAxLjIpOyB9XG4gIH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLmRlY28udXBkYXRlKGR0KTtcbiAgICBpZiAodGhpcy5jdXIgJiYgIXRoaXMuY3VyLmlzU3RhcnRlZCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhIG9uZS1zaG90IGNsaXAgZmluaXNoZWRcbiAgICAgIGlmICh0aGlzLnF1ZXVlZCkgeyB0aGlzLnF1ZXVlZCA9IGZhbHNlOyB0aGlzLnBsYXkoJ2lkbGUnKTsgfSBlbHNlIGlmICh0aGlzLmZsYXZvck9uKSB7IHRoaXMuZmxhdm9yT24gPSBmYWxzZTsgdGhpcy5wbGF5KCdpZGxlJyk7IH0gZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgdGhpcy5wbGF5KCdpZGxlJyk7XG4gICAgfVxuICAgIGlmICh0aGlzLmNmZy5mbGF2b3IgJiYgdGhpcy5zdGF0ZSA9PT0gJ2lkbGUnICYmICF0aGlzLmZsYXZvck9uICYmIHRoaXMuaG9sZGVyLmlzRW5hYmxlZCgpKSB7IHRoaXMuaWRsZVQgKz0gZHQ7IGlmICh0aGlzLmlkbGVUID49IHRoaXMubmV4dEZsYXZvcikgdGhpcy5zdGFydEZsYXZvcigpOyB9XG4gICAgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHRoaXMuc3Bhd25UICs9IGR0O1xuICAgIGZvciAobGV0IGkgPSB0aGlzLmVtb3Rlcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgZSA9IHRoaXMuZW1vdGVzW2ldOyBlLnQgKz0gZHQ7IGlmIChlLnQgPCAwKSBjb250aW51ZTsgY29uc3QgayA9IGUudCAvIDEuOTtcbiAgICAgIGlmIChrID49IDEpIHsgZS5tLmRpc3Bvc2UoKTsgdGhpcy5lbW90ZXMuc3BsaWNlKGksIDEpOyBjb250aW51ZTsgfVxuICAgICAgZS5tLnZpc2liaWxpdHkgPSBNYXRoLm1pbigxLCBlLnQgLyAwLjIpICogKDEgLSBrICogayk7IGUubS5wb3NpdGlvbi5zZXQoMC4xNiArIDAuMDUgKiBNYXRoLnNpbihlLnQgKiAzKSwgZS55MCArIGUudCAqIDAuMiwgMCk7IGUubS5zY2FsaW5nLnNldEFsbCgwLjcgKyAwLjUgKiBrKTtcbiAgICB9XG4gICAgaWYgKHRoaXMub3duKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGV5ZSBnbG93IGZvbGxvd3MgdGhlIG1vb2Q6IGRpbSB3aGVuIHNsZWVweSwgYnJpZ2h0IHdoZW4gYXdha2UsIGZsYXJpbmcgaW4gYSBmaWdodFxuICAgICAgbGV0IHRhcmdldCA9IDAuNjU7XG4gICAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgdGFyZ2V0ID0gMC4wOCArIDAuOTIgKiBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCAodGhpcy5zcGF3blQgLyAxLjY3IC0gMC40NSkgLyAwLjMpKTtcbiAgICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdpZGxlJykgdGFyZ2V0ID0gdGhpcy5mbGF2b3JPbiA/IDAuMjUgOiAwLjY1O1xuICAgICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHRhcmdldCA9IDEuMDsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2F0dGFjaycpIHRhcmdldCA9IDEuNzsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgdGFyZ2V0ID0gMS40OyBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB0YXJnZXQgPSAwLjA1O1xuICAgICAgdGhpcy5leWVLICs9ICh0YXJnZXQgLSB0aGlzLmV5ZUspICogTWF0aC5taW4oMSwgZHQgKiA3KTsgdGhpcy5vd24uZW1pc3NpdmVJbnRlbnNpdHkgPSB0aGlzLmV5ZUs7XG4gICAgfVxuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5zYyh0aGlzLnN0YXIpICogdGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmVtb3Rlcy5mb3JFYWNoKChlKSA9PiBlLm0uZGlzcG9zZSgpKTsgaWYgKHRoaXMub3duKSB0aGlzLm93bi5kaXNwb3NlKCk7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IGcuZGlzcG9zZSgpKTsgdGhpcy5lbnQuc2tlbGV0b25zLmZvckVhY2goKHM6IGFueSkgPT4gcy5kaXNwb3NlKCkpOyB0aGlzLnBpY2suZGlzcG9zZSgpOyB0aGlzLmVudC5yb290Tm9kZXNbMF0uZGlzcG9zZShmYWxzZSwgZmFsc2UpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFuZC1pbnNcbmNvbnN0IFBIOiBSZWNvcmQ8c3RyaW5nLCB7IGNvbDogc3RyaW5nOyB3OiBudW1iZXI7IGg6IG51bWJlcjsgaGVhZDogbnVtYmVyOyB3ZWFwb246IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9PiA9IHtcbiAgZ29ibGluOiB7IGNvbDogJyM2M2IxM2YnLCB3OiAwLjM2LCBoOiAwLjQyLCBoZWFkOiAwLjM2LCB3ZWFwb246ICdkYWdnZXInLCBsYWJlbDogJ0dPQkxJTicgfSxcbiAga25pZ2h0OiB7IGNvbDogJyM4ZWE5ZGMnLCB3OiAwLjUsIGg6IDAuNiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnc2hpZWxkJywgbGFiZWw6ICdLTklHSFQnIH0sXG4gIG9ncmU6IHsgY29sOiAnI2E4YTY0YScsIHc6IDAuODUsIGg6IDAuODUsIGhlYWQ6IDAuNDIsIHdlYXBvbjogJ21hY2UnLCBsYWJlbDogJ09HUkUnIH0sXG4gIGJhcmJhcmlhbjogeyBjb2w6ICcjZDY4YTU1JywgdzogMC41MiwgaDogMC42MiwgaGVhZDogMC4zOCwgd2VhcG9uOiAnYXhlJywgbGFiZWw6ICdCQVJCQVJJQU4nIH0sXG59O1xuY2xhc3MgUGxhY2Vob2xkZXJWaXN1YWwgaW1wbGVtZW50cyBVbml0VmlzdWFsIHtcbiAgaG9sZGVyOiBhbnk7IHRlYW06IDAgfCAxOyBzdGFyID0gMTsgc3RhdGU6IFZTdGF0ZSA9ICdpZGxlJzsgdG9wOiBudW1iZXI7XG4gIHByaXZhdGUgcmlnOiBhbnk7IHByaXZhdGUgbGVnczogYW55W10gPSBbXTsgcHJpdmF0ZSB3cDogYW55OyBwcml2YXRlIGRlY286IERlY287IHByaXZhdGUgcGljazogYW55OyBwcml2YXRlIHQgPSBNYXRoLnJhbmRvbSgpICogNjsgcHJpdmF0ZSBzdDAgPSAwOyBwcml2YXRlIGR1ciA9IDE7IHByaXZhdGUgYmFzZSA9IDE7IHByaXZhdGUgcHVsc2VUID0gMDsgcHJpdmF0ZSBtYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGJvZHk6IGFueTtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBBOiBBc3NldHMsIHByaXZhdGUgc291bDogc3RyaW5nLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IEEuc2NlbmUsIGQgPSBQSFtzb3VsXTsgdGhpcy50ZWFtID0gdGVhbTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3BoXycgKyBzb3VsLCBzKTsgdGhpcy5yaWcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdyaWcnLCBzKTsgdGhpcy5yaWcucGFyZW50ID0gdGhpcy5ob2xkZXI7XG4gICAgY29uc3QgbWF0ID0gKGhleDogc3RyaW5nLCBlbSA9IDApID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3BtJywgcyk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhoZXgpLnNjYWxlKDAuNzIpOyBtLnNwZWN1bGFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xLCAwLjEsIDAuMSk7IGlmIChlbSkgbS5lbWlzc2l2ZUNvbG9yID0gbS5kaWZmdXNlQ29sb3Iuc2NhbGUoZW0pOyByZXR1cm4gbTsgfTtcbiAgICBjb25zdCBsZWdIID0gMC4yMiwgYm9keVkgPSBsZWdIICsgZC5oIC8gMjtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgbGcgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdsZWcnLCBzKTsgbGcucGFyZW50ID0gdGhpcy5yaWc7IGxnLnBvc2l0aW9uLnNldChzeCAqIGQudyAqIDAuMjIsIGxlZ0gsIDApOyBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignbCcsIHsgaGVpZ2h0OiBsZWdILCBkaWFtZXRlcjogZC53ICogMC4yOCB9LCBzKTsgbS5wYXJlbnQgPSBsZzsgbS5wb3NpdGlvbi55ID0gLWxlZ0ggLyAyOyBtLm1hdGVyaWFsID0gbWF0KCcjNGEzODI2Jyk7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyB0aGlzLmxlZ3MucHVzaChsZyk7IH1cbiAgICB0aGlzLmJvZHkgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUNhcHN1bGUoJ2JvZHknLCB7IHJhZGl1czogZC53IC8gMiwgaGVpZ2h0OiBkLmggKyBkLncgKiAwLjQgfSwgcyk7IHRoaXMuYm9keS5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy5ib2R5LnBvc2l0aW9uLnkgPSBib2R5WTsgdGhpcy5ib2R5Lm1hdGVyaWFsID0gbWF0KGQuY29sKTsgdGhpcy5ib2R5LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBoZWFkID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2hlYWQnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAxLjUsIHNlZ21lbnRzOiAxMiB9LCBzKTsgaGVhZC5wYXJlbnQgPSB0aGlzLnJpZzsgaGVhZC5wb3NpdGlvbi55ID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDAuNTU7IGhlYWQubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyBoZWFkLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBleWVNID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZXllJywgcyk7IGV5ZU0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgZXllTS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgKHRoaXMgYXMgYW55KS5leWVNID0gZXllTTtcbiAgICBmb3IgKGNvbnN0IHN4IG9mIFstMSwgMV0pIHsgY29uc3QgZSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdlJywgeyBkaWFtZXRlcjogZC5oZWFkICogMC4zIH0sIHMpOyBlLnBhcmVudCA9IHRoaXMucmlnOyBlLnBvc2l0aW9uLnNldChzeCAqIGQuaGVhZCAqIDAuMywgaGVhZC5wb3NpdGlvbi55ICsgMC4wMiwgZC5oZWFkICogMC42Nik7IGUubWF0ZXJpYWwgPSBleWVNOyBlLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIC8vIHdlYXBvbiBwaXZvdCBhdCB0aGUgc2hvdWxkZXIsIG9uIHRoZSBjaGFyYWN0ZXIncyByaWdodCAoLXggaXMgZmluZSBmb3IgYSBzdGFuZC1pbilcbiAgICB0aGlzLndwID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnd3AnLCBzKTsgdGhpcy53cC5wYXJlbnQgPSB0aGlzLnJpZzsgdGhpcy53cC5wb3NpdGlvbi5zZXQoZC53ICogMC42LCBsZWdIICsgZC5oICogMC44NSwgMC4wNSk7XG4gICAgY29uc3Qgd20gPSBtYXQoJyM3YTVhMzAnKSwgaXJvbiA9IG1hdCgnIzlhYTFhZCcpO1xuICAgIGNvbnN0IG1rID0gKG06IGFueSwga2luZDogc3RyaW5nLCBkaW1zOiBhbnksIHBvczogbnVtYmVyW10sIG10OiBhbnkpID0+IHsgY29uc3QgeCA9IGtpbmQgPT09ICdib3gnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVCb3goJ3cnLCBkaW1zLCBzKSA6IGtpbmQgPT09ICdjeWwnID8gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigndycsIGRpbXMsIHMpIDogQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ3cnLCBkaW1zLCBzKTsgeC5wYXJlbnQgPSB0aGlzLndwOyB4LnBvc2l0aW9uLnNldChwb3NbMF0sIHBvc1sxXSwgcG9zWzJdKTsgeC5tYXRlcmlhbCA9IG10OyB4LmlzUGlja2FibGUgPSBmYWxzZTsgcmV0dXJuIHg7IH07XG4gICAgaWYgKGQud2VhcG9uID09PSAnZGFnZ2VyJykgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDUsIGhlaWdodDogMC4zLCBkZXB0aDogMC4wMyB9LCBbMCwgLTAuMiwgMC4xMl0sIGlyb24pO1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ3NoaWVsZCcpIHsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMDYsIGhlaWdodDogMC41LCBkZXB0aDogMC4wNCB9LCBbMCwgLTAuMywgMC4xNF0sIGlyb24pOyBjb25zdCBzaCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3NoJywgeyBoZWlnaHQ6IDAuMDUsIGRpYW1ldGVyOiAwLjU1IH0sIHMpOyBzaC5wYXJlbnQgPSB0aGlzLnJpZzsgc2gucm90YXRpb24ueiA9IE1hdGguUEkgLyAyOyBzaC5wb3NpdGlvbi5zZXQoLWQudyAqIDAuNywgbGVnSCArIGQuaCAqIDAuNiwgMC4wNSk7IHNoLm1hdGVyaWFsID0gbWF0KCcjZDhiNjRhJyk7IHNoLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ21hY2UnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC45LCBkaWFtZXRlcjogMC4wOCB9LCBbMCwgLTAuMzUsIDAuM10sIHdtKTsgbWsoMCwgJ3NwaCcsIHsgZGlhbWV0ZXI6IDAuNCB9LCBbMCwgLTAuODUsIDAuNF0sIGlyb24pOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnYXhlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuNiwgZGlhbWV0ZXI6IDAuMDUgfSwgWzAsIC0wLjIsIDAuMTVdLCB3bSk7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjMyLCBoZWlnaHQ6IDAuMjIsIGRlcHRoOiAwLjA1IH0sIFswLCAtMC41LCAwLjE1XSwgaXJvbik7IGNvbnN0IGhhaXIgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdoYWlyJywgeyBoZWlnaHQ6IDAuMywgZGlhbWV0ZXJUb3A6IDAsIGRpYW1ldGVyQm90dG9tOiBkLmhlYWQgKiAxLjIgfSwgcyk7IGhhaXIucGFyZW50ID0gdGhpcy5yaWc7IGhhaXIucG9zaXRpb24ueSA9IGhlYWQucG9zaXRpb24ueSArIGQuaGVhZCAqIDAuNzU7IGhhaXIubWF0ZXJpYWwgPSBtYXQoJyNjMjJhMWMnKTsgaGFpci5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICB0aGlzLnRvcCA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAxLjM1OyB0aGlzLmRlY28gPSBuZXcgRGVjbyhBLCB0aGlzLmhvbGRlciwgdGhpcy50b3AsIGQudyAqIDAuNyk7XG4gICAgY29uc3QgbGJsID0gZHluKHMsIDI1NiwgNDgsIChjKSA9PiB7IGMuZm9udCA9ICdib2xkIDI2cHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMuZmlsbFN0eWxlID0gJyNmZmZmZmYnOyBjLnN0cm9rZVN0eWxlID0gJyMxMTEnOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IGMuZmlsbFRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyB9KTtcbiAgICBjb25zdCBscCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2xibCcsIHsgd2lkdGg6IDEuMSwgaGVpZ2h0OiAwLjIgfSwgcyk7IGxwLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBscC5wb3NpdGlvbi55ID0gLTAuMTsgbHAucm90YXRpb24ueCA9IE1hdGguUEkgLyAyICogMC4wOyBscC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBjb25zdCBsbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2xtJywgcyk7IGxtLmRpZmZ1c2VUZXh0dXJlID0gbGJsOyBsbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgbG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBscC5tYXRlcmlhbCA9IGxtOyBscC5pc1BpY2thYmxlID0gZmFsc2U7IGxwLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuNjI7XG4gICAgdGhpcy5waWNrID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcigncGljaycsIHsgaGVpZ2h0OiB0aGlzLnRvcCwgZGlhbWV0ZXI6IE1hdGgubWF4KDAuNywgZC53ICogMS4zKSB9LCBzKTsgdGhpcy5waWNrLnBhcmVudCA9IHRoaXMuaG9sZGVyOyB0aGlzLnBpY2sucG9zaXRpb24ueSA9IHRoaXMudG9wIC8gMjsgdGhpcy5waWNrLnZpc2liaWxpdHkgPSAwLjAwMTsgdGhpcy5waWNrLm1ldGFkYXRhID0geyBraW5kOiAndW5pdCcsIHZpc3VhbDogdGhpcyB9O1xuICAgICh0aGlzIGFzIGFueSkucGFydHMgPSBbbHBdOyB0aGlzLnNldFRlYW0odGVhbSk7IHRoaXMuc2V0U3RhcihzdGFyKTsgdGhpcy5wbGF5KCdpZGxlJyk7XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyAodGhpcyBhcyBhbnkpLmV5ZU0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYmFzZSA9IEJBTEFOQ0Uuc3Rhci5zY2FsZVtzdCAtIDFdOyBjb25zdCB0ID0gVElOVFtzdCAtIDFdOyB0aGlzLmJvZHkubWF0ZXJpYWwuZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuRnJvbUhleFN0cmluZyhQSFt0aGlzLnNvdWxdLmNvbCkuc2NhbGUoMC43MikubXVsdGlwbHkobmV3IEJBQllMT04uQ29sb3IzKE1hdGgubWluKDEsIHRbMF0pLCBNYXRoLm1pbigxLCB0WzFdKSwgTWF0aC5taW4oMSwgdFsyXSkpKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlKTsgdGhpcy5kZWNvLnNldCh0aGlzLnRlYW0sIHN0KTsgdGhpcy5kZWNvLmZpdCh0aGlzLmJhc2UpOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldExldmVsKG46IG51bWJlcikgeyB0aGlzLmRlY28uc2V0TGV2ZWwobik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHsgaWYgKHN0YXRlID09PSB0aGlzLnN0YXRlICYmIChzdGF0ZSA9PT0gJ2lkbGUnIHx8IHN0YXRlID09PSAncnVuJykpIHJldHVybjsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLnN0MCA9IHRoaXMudDsgdGhpcy5kdXIgPSBzdGF0ZSA9PT0gJ2F0dGFjaycgPyAoQkFMQU5DRS5zdGF0c1t0aGlzLnNvdWwgYXMgU291bElkXS5hbmltTGVuIC8gc3BlZWQpIDogc3RhdGUgPT09ICdkZWF0aCcgPyAwLjYgOiBzdGF0ZSA9PT0gJ3NwYXduJyA/IDAuOSA6IDEuMDsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpOyB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy50ICs9IGR0OyB0aGlzLmRlY28udXBkYXRlKGR0KTsgY29uc3QgcCA9IE1hdGgubWluKDEsICh0aGlzLnQgLSB0aGlzLnN0MCkgLyB0aGlzLmR1ciksIFIgPSB0aGlzLnJpZywgVyA9IHRoaXMud3A7XG4gICAgUi5wb3NpdGlvbi5zZXQoMCwgMCwgMCk7IFIucm90YXRpb24uc2V0KDAsIDAsIDApOyBSLnNjYWxpbmcuc2V0QWxsKDEpOyBXLnJvdGF0aW9uLnggPSAtMC40OyB0aGlzLmxlZ3MuZm9yRWFjaCgobCkgPT4gKGwucm90YXRpb24ueCA9IDApKTtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ2lkbGUnKSBSLnBvc2l0aW9uLnkgPSBNYXRoLnNpbih0aGlzLnQgKiAyLjIpICogMC4wMTI7XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3J1bicpIHsgY29uc3QgdyA9IHRoaXMudCAqIDEwOyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih3KSkgKiAwLjA3OyBSLnJvdGF0aW9uLnggPSAwLjI7IHRoaXMubGVnc1swXS5yb3RhdGlvbi54ID0gTWF0aC5zaW4odykgKiAwLjk7IHRoaXMubGVnc1sxXS5yb3RhdGlvbi54ID0gLU1hdGguc2luKHcpICogMC45OyBXLnJvdGF0aW9uLnggPSAtMC40ICsgTWF0aC5zaW4odykgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnYXR0YWNrJykgeyBjb25zdCBrID0gcCA8IDAuNCA/IC0yLjQgKiAocCAvIDAuNCkgOiAtMi40ICsgMy40ICogTWF0aC5taW4oMSwgKHAgLSAwLjQpIC8gMC4yNSk7IFcucm90YXRpb24ueCA9IGs7IFIucG9zaXRpb24ueiA9IDAuMTQgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IFIucm90YXRpb24ueCA9IDAuMTUgKiBNYXRoLnNpbihNYXRoLlBJICogcCk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB7IGNvbnN0IGUgPSBwICogcCAqICgzIC0gMiAqIHApOyBSLnNjYWxpbmcuc2V0QWxsKDAuMDEgKyAwLjk5ICogZSk7IFIucG9zaXRpb24ueSA9IChlIC0gMSkgKiAwLjQ7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnZGVhdGgnKSB7IGNvbnN0IGUgPSBwICogcDsgUi5yb3RhdGlvbi54ID0gLU1hdGguUEkgLyAyICogZTsgUi5wb3NpdGlvbi55ID0gMC4yNSAqIGU7IFIucG9zaXRpb24ueiA9IC0wLjIgKiBlOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2NoZWVyJykgeyBSLnBvc2l0aW9uLnkgPSBNYXRoLmFicyhNYXRoLnNpbih0aGlzLnQgKiA3KSkgKiAwLjE1OyBXLnJvdGF0aW9uLnggPSAtMi42OyB9XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZGVjby5kaXNwb3NlKCk7IHRoaXMuaG9sZGVyLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiBtLmRpc3Bvc2UoKSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmlzdWFsKEE6IEFzc2V0cywgc291bDogU291bElkLCB0ZWFtOiAwIHwgMSwgc3RhcjogbnVtYmVyKTogVW5pdFZpc3VhbCB7XG4gIGNvbnN0IGNmZyA9IEEudHJpcG9bc291bF07XG4gIHJldHVybiBjZmcgPyBuZXcgVHJpcG9WaXN1YWwoQSwgY2ZnLCBzb3VsLCB0ZWFtLCBzdGFyKSA6IG5ldyBQbGFjZWhvbGRlclZpc3VhbChBLCBzb3VsLCB0ZWFtLCBzdGFyKTtcbn1cbmV4cG9ydCBjb25zdCBpc1RyaXBvID0gKEE6IEFzc2V0cywgc291bDogU291bElkKSA9PiAhIUEudHJpcG9bc291bF07XG4iLCAiLy8gVGhlIGdhbWUncyBpY29uIHNldCAoY3VzdG9tIGFydCwgc2xpY2VkIGZyb20gUGlwZWxpbmUvaWNvbnMvc2hlZXRfKi5wbmcgYnkgUGlwZWxpbmUvYmxlbmRlci9zbGljZV9pY29ucy5weSAtPiBkb2NzL2Fzc2V0cy9pY29ucy8qLnBuZykuXG4vLyBTaGFyZWQgYnkgdGhlIDNEIGdhbWUncyBET00gKHZhbmlsbGEpIGFuZCB0aGUgQW5ndWxhciBzaGVsbC4gTm8gZW1vamkgYW55d2hlcmU6IGV2ZXJ5IGdseXBoIGluIHRoZSBVSSBpcyBvbmUgb2YgdGhlc2UgaW1hZ2VzLlxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSYXJpdHkgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcblxuZXhwb3J0IHR5cGUgSWNvbk5hbWUgPVxuICB8ICdob21lJyB8ICdzb3VscycgfCAnc2hvcCcgfCAnc2V0dGluZ3MnIHwgJ2Nsb3NlJ1xuICB8ICdoZWFydCcgfCAnaGVhcnRfZW1wdHknIHwgJ2RvbWluaW9uJyB8ICdzdGFyJyB8ICdsb2NrJ1xuICB8ICd3YXJyaW9yJyB8ICdhcmNoZXInIHwgJ2dvYmxpbicgfCAna25pZ2h0JyB8ICdvZ3JlJyB8ICdiYXJiYXJpYW4nXG4gIHwgJ2dlbV9jb21tb24nIHwgJ2dlbV9yYXJlJyB8ICdnZW1fZXBpYycgfCAnZ2VtX2xlZ2VuZGFyeSdcbiAgfCAnbXVzaWMnIHwgJ3NvdW5kX29uJyB8ICdzb3VuZF9vZmYnIHwgJ3VwZ3JhZGUnIHwgJ3N3YXAnXG4gIHwgJ21lcmdlJyB8ICdyZW1vdmUnIHwgJ2NoZWNrJyB8ICdiYWNrJyB8ICdpbmZvJyB8ICdnb2xkJztcblxuLyoqIFJlbGF0aXZlIHRvIHRoZSBwYWdlLCBzbyBpdCB3b3JrcyBvbiBHaXRIdWIgUGFnZXMgdW5kZXIgL3JlcG8tbmFtZS8uICovXG5leHBvcnQgY29uc3QgaWNvblVybCA9IChuOiBJY29uTmFtZSk6IHN0cmluZyA9PiAnYXNzZXRzL2ljb25zLycgKyBuICsgJy5wbmcnO1xuLyoqIEFuIDxpbWc+IGFzIGFuIEhUTUwgc3RyaW5nLCBmb3IgdGhlIGdhbWUncyBoYW5kLWJ1aWx0IERPTS4gKi9cbmV4cG9ydCBjb25zdCBpY29uSW1nID0gKG46IEljb25OYW1lLCBjbHMgPSAnaWMnKTogc3RyaW5nID0+IGA8aW1nIGNsYXNzPVwiJHtjbHN9XCIgc3JjPVwiJHtpY29uVXJsKG4pfVwiIGFsdD1cIlwiIGRyYWdnYWJsZT1cImZhbHNlXCI+YDtcblxuLyoqIEVhY2ggU291bCBpcyBzaG93biBieSBpdHMgd2VhcG9uL3JvbGUgaWNvbiB1bnRpbCByZWFsIHBvcnRyYWl0cyBleGlzdC4gKi9cbmV4cG9ydCBjb25zdCBTT1VMX0lDT046IFJlY29yZDxTb3VsSWQsIEljb25OYW1lPiA9IHsgd2FycmlvcjogJ3dhcnJpb3InLCBhcmNoZXI6ICdhcmNoZXInLCBnb2JsaW46ICdnb2JsaW4nLCBrbmlnaHQ6ICdrbmlnaHQnLCBvZ3JlOiAnb2dyZScsIGJhcmJhcmlhbjogJ2JhcmJhcmlhbicgfTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfR0VNOiBSZWNvcmQ8UmFyaXR5LCBJY29uTmFtZT4gPSB7IGNvbW1vbjogJ2dlbV9jb21tb24nLCByYXJlOiAnZ2VtX3JhcmUnLCBlcGljOiAnZ2VtX2VwaWMnLCBsZWdlbmRhcnk6ICdnZW1fbGVnZW5kYXJ5JyB9O1xuXG4vKiogUGFjayB0aWVycyBhcmUgc2hvd24gYXMgc2t1bGxzIChuZXZlciBzdGFyczogc3RhcnMgbWVhbiBhbiBpbi1ydW4gbWVyZ2UgbGV2ZWwpLiAqL1xuZXhwb3J0IGNvbnN0IHNrdWxsSW1ncyA9IChuOiBudW1iZXIsIGNscyA9ICdzaycpOiBzdHJpbmcgPT4gaWNvbkltZygnc291bHMnLCBjbHMpLnJlcGVhdChNYXRoLm1heCgxLCBuKSk7XG5leHBvcnQgY29uc3QgaGVhcnRzSHRtbCA9IChoZWFydHM6IG51bWJlciwgbWF4ID0gMyk6IHN0cmluZyA9PiBpY29uSW1nKCdoZWFydCcsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBoZWFydHMpKSArIGljb25JbWcoJ2hlYXJ0X2VtcHR5JywgJ2ljIGhlYXJ0JykucmVwZWF0KE1hdGgubWF4KDAsIG1heCAtIGhlYXJ0cykpO1xuLyoqIEEgbnVtYmVyIHdpdGggdGhvdXNhbmRzIHNlcGFyYXRvcnMgKGdvbGQgZ2V0cyBiaWcpOiAxMjUwMCAtPiBcIjEyLDUwMFwiLiAqL1xuZXhwb3J0IGNvbnN0IGZtdCA9IChuOiBudW1iZXIpOiBzdHJpbmcgPT4gTWF0aC5yb3VuZChuKS50b0xvY2FsZVN0cmluZygnZW4tVVMnKTtcbiIsICIvLyBSZW5kZXJlZCBTb3VsIHBvcnRyYWl0cyAoUGlwZWxpbmUvYmxlbmRlci9yZW5kZXJfcG9ydHJhaXQucHksIGhlYWQtYW5kLXNob3VsZGVycyBtb2RlKSwgc2hhcmVkIGJ5IHRoZSBBbmd1bGFyIHBhZ2VzIGFuZCB0aGUgYmF0dGxlIHNjcmVlbi5cbi8vIFNvdWxzIHdpdGhvdXQgYSBwb3J0cmFpdCB5ZXQgZmFsbCBiYWNrIHRvIHRoZWlyIHJvbGUgaWNvbiBvbiBhIGNvbG91cmVkIGNhcmQuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgeyBSQVJJVFlfT0YgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcbmltcG9ydCB0eXBlIHsgUmFyaXR5IH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5pbXBvcnQgeyBTT1VMX0lDT04sIGljb25VcmwgfSBmcm9tICcuL2ljb25zLnRzJztcblxuY29uc3QgUE9SVFJBSVQ6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgc3RyaW5nPj4gPSB7IHdhcnJpb3I6ICdhc3NldHMvcG9ydHJhaXRzL3dhcnJpb3JfaGVhZC5wbmcnLCBhcmNoZXI6ICdhc3NldHMvcG9ydHJhaXRzL2FyY2hlcl9oZWFkLnBuZycsIG9ncmU6ICdhc3NldHMvcG9ydHJhaXRzL29ncmVfaGVhZC5wbmcnLCBnb2JsaW46ICdhc3NldHMvcG9ydHJhaXRzL2dvYmxpbl9oZWFkLnBuZycsIGtuaWdodDogJ2Fzc2V0cy9wb3J0cmFpdHMva25pZ2h0X2hlYWQucG5nJywgYmFyYmFyaWFuOiAnYXNzZXRzL3BvcnRyYWl0cy9iYXJiYXJpYW5faGVhZC5wbmcnIH07XG5jb25zdCBSQVJJVFlfSEVYOiBSZWNvcmQ8UmFyaXR5LCBzdHJpbmc+ID0geyBjb21tb246ICcjYjhjMGNjJywgcmFyZTogJyM0YWEzZmYnLCBlcGljOiAnI2IyNmJmZicsIGxlZ2VuZGFyeTogJyNmZmNjMzMnIH07XG5leHBvcnQgY29uc3QgaGFzQXJ0ID0gKHM6IFNvdWxJZCk6IGJvb2xlYW4gPT4gISFQT1JUUkFJVFtzXTtcbmV4cG9ydCBjb25zdCBzb3VsQXJ0ID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiBQT1JUUkFJVFtzXSA/PyBpY29uVXJsKFNPVUxfSUNPTltzXSk7XG5leHBvcnQgY29uc3QgcmFyaXR5Q29sb3IgPSAoczogU291bElkKTogc3RyaW5nID0+IFJBUklUWV9IRVhbUkFSSVRZX09GW3NdXTtcbi8qKiBDYXJkIGJhY2tkcm9wIGZvciBhIHBvcnRyYWl0OiBhIGdsb3cgaW4gdGhlIHJhcml0eSBjb2xvdXIgYmVoaW5kIHRoZSBmaWd1cmUsIG9uIGEgZGFyayBjcnlwdCBncmFkaWVudC4gKi9cbmV4cG9ydCBjb25zdCBhcnRCZyA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4geyBjb25zdCBjID0gcmFyaXR5Q29sb3Iocyk7IHJldHVybiBgcmFkaWFsLWdyYWRpZW50KGVsbGlwc2UgYXQgNTAlIDgwJSwgJHtjfTc3IDAlLCAke2N9MjYgNDYlLCB0cmFuc3BhcmVudCA3NCUpLCBsaW5lYXItZ3JhZGllbnQoIzJiMjQ0NCwjMGQwOTE5KWA7IH07XG4iLCAiLy8gRE9NIHVzZXIgaW50ZXJmYWNlOiB0b3AgYmFyLCBlbmVteSBwcmV2aWV3LCBoYW5kIG9mIGNhcmRzLCBidXR0b25zLCBkcmFmdCBvdmVybGF5LCB0b2FzdHMgYW5kIHRoZSBkZWJ1ZyBwYW5lbC5cbmltcG9ydCB7IEJBTEFOQ0UsIFJPTEVfVEVYVCwgU09VTF9OQU1FIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7IGlzRW5kbGVzcyB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgY2FuTWVyZ2VEZXBsb3llZCwgY2FuTWVyZ2VGcm9tSGFuZCwgY2FuU3VtbW9uLCBjb3N0LCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgc3RhZ2VXYXZlcyB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgZW5lbXlXYXZlLCBwcmV2aWV3VGV4dCB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgYXVkaW8gfSBmcm9tICcuL2F1ZGlvLnRzJztcbmltcG9ydCB7IGFydEJnLCBoYXNBcnQsIHJhcml0eUNvbG9yLCBzb3VsQXJ0IH0gZnJvbSAnLi4vdWkvcG9ydHJhaXRzLnRzJztcbmltcG9ydCB7IFNPVUxfSUNPTiwgaGVhcnRzSHRtbCwgZm10LCBpY29uSW1nLCBpY29uVXJsLCBza3VsbEltZ3MgfSBmcm9tICcuLi91aS9pY29ucy50cyc7XG5pbXBvcnQgeyBkZXNjcmliZVVubG9jayB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuXG5jb25zdCBwb3J0cmFpdEh0bWwgPSAoczogU291bElkKTogc3RyaW5nID0+IGA8ZGl2IGNsYXNzPVwicHRcIiBzdHlsZT1cImJhY2tncm91bmQ6JHthcnRCZyhzKX1cIj48aW1nIHNyYz1cIiR7c291bEFydChzKX1cIiBhbHQ9XCJcIiBkcmFnZ2FibGU9XCJmYWxzZVwiPjwvZGl2PmA7XG5jb25zdCBJQ09OID0gT2JqZWN0LmZyb21FbnRyaWVzKFNPVUxTLm1hcCgocykgPT4gW3MsIGljb25JbWcoU09VTF9JQ09OW3NdLCAnaWMnKV0pKSBhcyBSZWNvcmQ8U291bElkLCBzdHJpbmc+O1xuY29uc3QgJCA9IChpZDogc3RyaW5nKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkhO1xuY29uc3Qgc3RhcnMgPSAobjogbnVtYmVyKSA9PiAnXHUyNjA1Jy5yZXBlYXQobik7XG5cbmV4cG9ydCBjbGFzcyBVaSB7XG4gIHByaXZhdGUgdG9hc3RUID0gMDsgcHJpdmF0ZSBkYmc6IEhUTUxFbGVtZW50OyBwcml2YXRlIG9kZHMgPSAnJztcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBnOiBhbnkpIHtcbiAgICAkKCdidG5Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAkKCdidG5CYXR0bGUnKS5vbmNsaWNrID0gKCkgPT4gZy5zdGFydEJhdHRsZSgpOyAkKCdidG5Td2FwJykub25jbGljayA9ICgpID0+IGcudG9nZ2xlU3dhcCgpO1xuICAgICQoJ2J0blJlbW92ZScpLm9uY2xpY2sgPSAoKSA9PiBnLnJlbW92ZVNlbGVjdGVkKCk7XG4gICAgJCgnYnRuU3BlZWQnKS5vbmNsaWNrID0gKCkgPT4gZy5zZXRTcGVlZChnLnRpbWVTY2FsZSA+IDEgPyAxIDogMik7XG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNhbV0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4gZy5zZXRDYW1Nb2RlKGIuZGF0YXNldC5jYW0hKSkpO1xuICAgICQoJ2dlYXInKS5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmRiZy5jbGFzc0xpc3QudG9nZ2xlKCdvcGVuJyk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICBjb25zdCBzbmQgPSAoKSA9PiB7ICQoJ2J0bk11c2ljJykuY2xhc3NMaXN0LnRvZ2dsZSgnb2ZmJywgIWF1ZGlvLm11c2ljKTsgJCgnYnRuU2Z4JykuY2xhc3NMaXN0LnRvZ2dsZSgnb2ZmJywgIWF1ZGlvLnNmeCk7IGNvbnN0IHNpID0gJCgnYnRuU2Z4JykucXVlcnlTZWxlY3RvcignaW1nJyk7IGlmIChzaSkgc2kuc3JjID0gaWNvblVybChhdWRpby5zZnggPyAnc291bmRfb24nIDogJ3NvdW5kX29mZicpOyB9O1xuICAgICQoJ2J0bk11c2ljJykub25jbGljayA9ICgpID0+IHsgYXVkaW8uc2V0TXVzaWMoIWF1ZGlvLm11c2ljKTsgc25kKCk7IH07ICQoJ2J0blNmeCcpLm9uY2xpY2sgPSAoKSA9PiB7IGF1ZGlvLnNldFNmeCghYXVkaW8uc2Z4KTsgc25kKCk7IH07XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ25lY3JvLXNldHRpbmdzJywgc25kKTsgc25kKCk7XG4gICAgdGhpcy5kYmcgPSAkKCdkZWJ1ZycpOyBpZiAobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnZGVidWcnKSkgdGhpcy5kYmcuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICAgIHRoaXMucmVuZGVyRGVidWcoKTtcbiAgfVxuXG4gIC8qKiBUaGUgTmVjcm9tYW5jZXIganVzdCBsb3N0IGEgaGVhcnQ6IG1ha2UgdGhlIGhlYXJ0cyBidW1wLiAqL1xuICBwdWxzZUhlYXJ0cygpIHsgY29uc3QgaCA9ICQoJ2hlYXJ0cycpOyBoLmNsYXNzTGlzdC5yZW1vdmUoJ2h1cnQnKTsgdm9pZCBoLm9mZnNldFdpZHRoOyBoLmNsYXNzTGlzdC5hZGQoJ2h1cnQnKTsgfVxuICB0b2FzdChtc2c6IHN0cmluZykgeyBjb25zdCB0ID0gJCgndG9hc3QnKTsgdC50ZXh0Q29udGVudCA9IG1zZzsgdC5jbGFzc0xpc3QuYWRkKCdzaG93Jyk7IGNsZWFyVGltZW91dCh0aGlzLnRvYXN0VCk7IHRoaXMudG9hc3RUID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4gdC5jbGFzc0xpc3QucmVtb3ZlKCdzaG93JyksIDM2MDApOyB9XG5cbiAgcmVuZGVyKCkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmcsIHMgPSBnLnMsIHBoID0gZy5waGFzZSwgYnVpbGQgPSBwaCA9PT0gJ2J1aWxkJztcbiAgICAkKCdoZWFydHMnKS5pbm5lckhUTUwgPSBoZWFydHNIdG1sKHMuaGVhcnRzKTtcbiAgICAkKCd3YXZlJykudGV4dENvbnRlbnQgPSBpc0VuZGxlc3MoKSA/IGBXYXZlICR7cy53YXZlfWAgOiBgV2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfWA7XG4gICAgY29uc3QgdXNlZCA9IGRvbWluaW9uVXNlZChzKTsgJCgnZG9tJykudGV4dENvbnRlbnQgPSBgJHt1c2VkfS8ke3MuY2FwfWA7ICgkKCdkb21maWxsJykgYXMgSFRNTEVsZW1lbnQpLnN0eWxlLndpZHRoID0gTWF0aC5taW4oMTAwLCAodXNlZCAvIHMuY2FwKSAqIDEwMCkgKyAnJSc7XG4gICAgLy8gZW5lbXkgcHJldmlldzogd2hhdCBpcyBjb21pbmcsIG5ldmVyIHdoZXJlXG4gICAgY29uc3QgcHYgPSBwcmV2aWV3VGV4dChlbmVteVdhdmUocy53YXZlLCBnLnNlZWQpKTtcbiAgICAkKCdlbmVteScpLmlubmVySFRNTCA9IGA8Yj5OZXh0IGVuZW1pZXM8L2I+YCArIHB2Lm1hcCgocCkgPT4gYDxkaXYgY2xhc3M9XCJlcm93XCI+PHNwYW4+JHtJQ09OW3Auc291bCBhcyBTb3VsSWRdfTwvc3Bhbj48c3Bhbj4ke1NPVUxfTkFNRVtwLnNvdWwgYXMgU291bElkXX0keyhwIGFzIGFueSkuYm9zcyA/ICcgPGIgc3R5bGU9XCJjb2xvcjojZmY3YjZhXCI+Qk9TUzwvYj4nIDogJyd9PC9zcGFuPjxzcGFuIGNsYXNzPVwieFwiPlx1MDBENyR7cC5jb3VudH08L3NwYW4+PHNwYW4gY2xhc3M9XCJzdFwiPiR7c3RhcnMocC5zdGFyKX08L3NwYW4+PC9kaXY+YCkuam9pbignJykgKyBgPGRpdiBjbGFzcz1cImhpbnRcIj5Qb3NpdGlvbnMgc3RheSBoaWRkZW4gdW50aWwgdGhlIGJhdHRsZS48L2Rpdj5gO1xuICAgIC8vIGhhbmRcbiAgICBjb25zdCBoYW5kID0gJCgnaGFuZCcpOyBoYW5kLmlubmVySFRNTCA9ICcnO1xuICAgIHMuaGFuZC5mb3JFYWNoKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4ge1xuICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgY29uc3Qgc2VsID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIGcuc2VsLmlkeCA9PT0gaTsgY29uc3QgYWZmb3JkID0gY2FuU3VtbW9uKHMsIGkpLCBjYW5NZXJnZSA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKSwgdXNhYmxlID0gYWZmb3JkIHx8IGNhbk1lcmdlO1xuICAgICAgY29uc3QgYXJ0ID0gaGFzQXJ0KHNvdWwpOyBlbC5jbGFzc05hbWUgPSAnY2FyZCcgKyAoYXJ0ID8gJyBhcnQnIDogJycpICsgKHNlbCA/ICcgc2VsJyA6ICcnKSArICghdXNhYmxlICYmICFnLnN3YXBNb2RlID8gJyBkaXMnIDogJycpICsgKGcuc3dhcE1vZGUgPyAnIHN3YXAnIDogJycpO1xuICAgICAgY29uc3QgdGFnID0gYWZmb3JkID8gYDxzcGFuIGNsYXNzPVwib2tcIj5TdW1tb248L3NwYW4+YCA6IGNhbk1lcmdlID8gJzxzcGFuIGNsYXNzPVwib2sgbWdcIj5NZXJnZSBvbmx5PC9zcGFuPicgOiAnPHNwYW4gY2xhc3M9XCJub1wiPk5vIHJvb208L3NwYW4+JztcbiAgICAgIGlmIChhcnQpIGVsLnN0eWxlLmJvcmRlckNvbG9yID0gcmFyaXR5Q29sb3Ioc291bCk7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHthcnQgPyBwb3J0cmFpdEh0bWwoc291bCkgOiBJQ09OW3NvdWxdICsgYDxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PmB9PGRpdiBjbGFzcz1cImNzXCI+JHt0YWd9PC9kaXY+YDsgZWwudGl0bGUgPSBST0xFX1RFWFRbc291bF0gKyAoYWZmb3JkID8gJycgOiBjYW5NZXJnZSA/ICcgLSBEb21pbmlvbiBpcyBmdWxsLCBidXQgeW91IGNhbiBtZXJnZSBpdCBpbnRvIHlvdXIgbWF0Y2hpbmcgMS1zdGFyIHVuaXQuJyA6ICcgLSBOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJyk7XG4gICAgICBlbC5vbmNsaWNrID0gKCkgPT4gZy5vbkNhcmQoaSk7IGhhbmQuYXBwZW5kQ2hpbGQoZWwpO1xuICAgIH0pO1xuICAgIGlmICghcy5oYW5kLmxlbmd0aCkgaGFuZC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cImVtcHR5XCI+Tm8gY2FyZHMgaW4gaGFuZDwvZGl2Pic7XG4gICAgLy8gYnV0dG9uc1xuICAgICgkKCdidG5CYXR0bGUnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhYnVpbGQgfHwgIXMudW5pdHMubGVuZ3RoO1xuICAgIGNvbnN0IHN3ID0gJCgnYnRuU3dhcCcpIGFzIEhUTUxCdXR0b25FbGVtZW50OyBzdy5kaXNhYmxlZCA9ICFidWlsZCB8fCBzLmRpc2NhcmRVc2VkOyBzdy5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGcuc3dhcE1vZGUpOyBzdy50ZXh0Q29udGVudCA9IHMuZGlzY2FyZFVzZWQgPyAnU3dhcCB1c2VkJyA6IGcuc3dhcE1vZGUgPyAnU3dhcDogcGljayBhIGNhcmQgb3IgdW5pdCcgOiAnU3dhcCAoMS9yb3VuZCknO1xuICAgIGNvbnN0IHNlbFUgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAndW5pdCcgPyBzLnVuaXRzLmZpbmQoKHU6IGFueSkgPT4gdS5pZCA9PT0gZy5zZWwuaWQpIDogbnVsbDtcbiAgICBjb25zdCBwYXJ0bmVyID0gc2VsVSAmJiBzLnVuaXRzLnNvbWUoKG86IGFueSkgPT4gY2FuTWVyZ2VEZXBsb3llZChzZWxVLCBvKSk7XG4gICAgJCgndW5pdHBhbmVsJykuc3R5bGUuZGlzcGxheSA9IGJ1aWxkICYmIHNlbFUgPyAnZmxleCcgOiAnbm9uZSc7XG4gICAgJCgnYnRuUmVtb3ZlJykudGV4dENvbnRlbnQgPSBnLmNvbmZpcm1SZW1vdmUgPyAnQ29uZmlybSByZW1vdmUnIDogJ1JlbW92ZSc7XG4gICAgJCgnaW5mbycpLnRleHRDb250ZW50ID0gYnVpbGQgPyAoZy5zd2FwTW9kZSA/ICdTV0FQOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCBpdCwgb3IgdGFwIGEgdW5pdCB5b3UgZGlkIG5vdCBzdW1tb24gdGhpcyByb3VuZCB0byBzZWxsIGl0LiBZb3UgZHJhdyBhIGRpZmZlcmVudCBTb3VsLidcbiAgICAgIDogc2VsVSA/IGAke1NPVUxfTkFNRVtzZWxVLnNvdWwgYXMgU291bElkXX0gJHtzdGFycyhzZWxVLnN0YXIpfSAgXHUyMDIyICAke1JPTEVfVEVYVFtzZWxVLnNvdWwgYXMgU291bElkXX0gICR7cGFydG5lciA/ICdcdTIwMjIgVGFwIHRoZSBtYXRjaGluZyB1bml0IHRvIG1lcmdlIGludG8gYSBzdHJvbmdlciBzdGFyLicgOiAnJ31gXG4gICAgICA6IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyA/IGAke1NPVUxfTkFNRVtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfTogJHtST0xFX1RFWFRbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX0gIFx1MjAyMiAgYCArICgoKSA9PiB7IGNvbnN0IGkgPSBnLnNlbC5pZHgsIHNtID0gY2FuU3VtbW9uKHMsIGkpLCBtZyA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKTsgcmV0dXJuIHNtICYmIG1nID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLCBvciBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6IHNtID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLicgOiBtZyA/ICdEb21pbmlvbiBpcyBmdWxsOiB0YXAgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiAnTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLic7IH0pKCkgOiAnVGFwIGEgY2FyZCwgdGhlbiBhIHRpbGUuIFRhcCBhIHVuaXQgdG8gbWVyZ2UsIG1vdmUgb3IgcmVtb3ZlIGl0LicpXG4gICAgICA6IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ0JhdHRsZSEgVW5pdHMgZmlnaHQgb24gdGhlaXIgb3duLicgOiAnJztcbiAgICAkKCdzcGVlZCcpLnN0eWxlLmRpc3BsYXkgPSBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdmbGV4JyA6ICdub25lJztcbiAgICBjb25zdCBmYXN0ID0gZy5zcGVlZFVubG9ja2VkKCk7IGlmICghZmFzdCAmJiBnLnRpbWVTY2FsZSA+IDEpIGcudGltZVNjYWxlID0gMTtcbiAgICBjb25zdCBzYiA9ICQoJ2J0blNwZWVkJyk7IHNiLnN0eWxlLmRpc3BsYXkgPSBmYXN0ID8gJycgOiAnbm9uZSc7IHNiLnRleHRDb250ZW50ID0gZy50aW1lU2NhbGUgKyAneCc7IHNiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgZy50aW1lU2NhbGUgPiAxKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IGIuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBiLmRhdGFzZXQuY2FtID09PSBnLmNhbU1vZGUpKTtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC50b2dnbGUoJ2luYmF0dGxlJywgcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicpOyBhdWRpby5zZXRNb2RlKHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2JhdHRsZScgOiAnYnVpbGQnKTtcbiAgICAvLyBvdmVybGF5XG4gICAgY29uc3Qgb3YgPSAkKCdvdmVybGF5Jyk7IG92LmNsYXNzTmFtZSA9ICcnOyBvdi5pbm5lckhUTUwgPSAnJztcbiAgICBpZiAocGggPT09ICdkcmFmdCcgJiYgZy5kcmFmdCkge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5WaWN0b3J5IERyYWZ0PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+V2F2ZSBjbGVhcmVkLiBEb21pbmlvbiBpcyBub3cgJHtzLmNhcH0uJHtnLmxhc3RHb2xkID8gYCA8YiBzdHlsZT1cImNvbG9yOiNmZmQyNGFcIj4rJHtmbXQoZy5sYXN0R29sZCl9PC9iPiAke2ljb25JbWcoJ2dvbGQnKX1gIDogJyd9IEtlZXAgb25lOjwvZGl2PjxkaXYgY2xhc3M9XCJyb3dcIj4ke2cuZHJhZnQubWFwKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4gYDxkaXYgY2xhc3M9XCJjYXJkIGJpZyR7aGFzQXJ0KHNvdWwpID8gJyBhcnQnIDogJyd9XCIgZGF0YS1pPVwiJHtpfVwiJHtoYXNBcnQoc291bCkgPyBgIHN0eWxlPVwiYm9yZGVyLWNvbG9yOiR7cmFyaXR5Q29sb3Ioc291bCl9XCJgIDogJyd9PjxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PiR7aGFzQXJ0KHNvdWwpID8gcG9ydHJhaXRIdG1sKHNvdWwpIDogSUNPTltzb3VsXX08ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj48ZGl2IGNsYXNzPVwicm9sZVwiPiR7Uk9MRV9URVhUW3NvdWxdfTwvZGl2PjwvZGl2PmApLmpvaW4oJycpfTwvZGl2PjwvZGl2PmA7XG4gICAgICBvdi5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignLmNhcmQnKS5mb3JFYWNoKChjKSA9PiAoYy5vbmNsaWNrID0gKCkgPT4gZy5waWNrRHJhZnQoK2MuZGF0YXNldC5pISkpKTtcbiAgICB9IGVsc2UgaWYgKHBoID09PSAnd29uJyB8fCBwaCA9PT0gJ2xvc3QnKSB7XG4gICAgICBjb25zdCBydyA9IHBoID09PSAnd29uJyA/IGcucmV3YXJkIDogbnVsbCwgc2sgPSAobjogbnVtYmVyKSA9PiBza3VsbEltZ3Mobik7XG4gICAgICBjb25zdCB1bmxvY2tIdG1sID0gcncgJiYgcncudW5sb2NrZWQgJiYgcncudW5sb2NrZWQubGVuZ3RoID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiM3ZWYyYzg7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdjaGVjaycpfSBVbmxvY2tlZDogJHtydy51bmxvY2tlZC5tYXAoKGs6IHN0cmluZykgPT4gZGVzY3JpYmVVbmxvY2soaykpLmpvaW4oJyBcXHUwMGI3ICcpfTwvZGl2PmAgOiAnJztcbiAgICAgIGNvbnN0IGdvbGRIdG1sID0gZy5ydW5Hb2xkID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdnb2xkJyl9IEdvbGQgZWFybmVkIHRoaXMgcnVuOiAke2ZtdChnLnJ1bkdvbGQpfTwvZGl2PmAgOiAnJztcbiAgICAgIGNvbnN0IGRyID0gcGggPT09ICd3b24nICYmIGcuZGFpbHkgPyBnLmRhaWx5UmV3YXJkIDogbnVsbDtcbiAgICAgIGNvbnN0IGRhaWx5SHRtbCA9IGcuZGFpbHkgPyAoZHIgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2RyLnBhY2sgPyBgJHtpY29uSW1nKCdzaG9wJyl9IERhaWx5IGNvbXBsZXRlISBZb3UgZWFybmVkIGEgJHtzaygxKX0gU291bCBQYWNrIGFuZCAke2ZtdChkci5nb2xkKX0gJHtpY29uSW1nKCdnb2xkJyl9LmAgOiAnRGFpbHkgY29tcGxldGUgYWdhaW4uIFRoZSByZXdhcmQgY29tZXMgb25jZSBwZXIgZGF5OiBzZWUgeW91IHRvbW9ycm93ISd9PC9kaXY+YCA6ICcnKSA6ICcnO1xuICAgICAgY29uc3QgcmV3YXJkSHRtbCA9IGdvbGRIdG1sICsgZGFpbHlIdG1sICsgdW5sb2NrSHRtbCArIChydyA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7cncucGFjayA/IChydy5maXJzdCA/IGAke2ljb25JbWcoJ3Nob3AnKX0gRmlyc3QgY2xlYXIhIFlvdSBlYXJuZWQgYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gIDogYCR7aWNvbkltZygnc2hvcCcpfSBSZXBsYXkgcmV3YXJkOiBhICR7c2socncucGFjay50aWVyKX0gU291bCBQYWNrLmApIDogYFJlcGxheSBwcm9ncmVzcyAke3J3LnJlcGxheU1ldGVyfS8ke3J3LnJlcGxheU5lZWRlZH0gdG93YXJkIGEgU291bCBQYWNrLmB9PC9kaXY+YCA6ICcnKTtcbiAgICAgIGlmIChwaCA9PT0gJ2xvc3QnICYmIGlzRW5kbGVzcygpICYmIGcuZW5kbGVzcykgeyAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGVuZCBvZiBhbiBlbmRsZXNzIHJ1bjogaG93IGRlZXAsIGFueSByZWNvcmQsIHBhY2tzIGVhcm5lZFxuICAgICAgICBjb25zdCBlID0gZy5lbmRsZXNzLCByZWMgPSBlLmNsZWFyZWQgPiBlLnN0YXJ0QmVzdDtcbiAgICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5SdW4gb3ZlcjwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPllvdSBjbGVhcmVkICR7ZS5jbGVhcmVkfSB3YXZlJHtlLmNsZWFyZWQgPT09IDEgPyAnJyA6ICdzJ30uICR7cmVjID8gJzxiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YVwiPk5ldyBiZXN0IGRlcHRoITwvYj4nIDogJ0Jlc3Q6IHdhdmUgJyArIE1hdGgubWF4KGUuc3RhcnRCZXN0LCBlLmNsZWFyZWQpICsgJy4nfTwvZGl2PiR7Zy5ydW5Hb2xkID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdnb2xkJyl9IEdvbGQgZWFybmVkIHRoaXMgcnVuOiAke2ZtdChnLnJ1bkdvbGQpfTwvZGl2PmAgOiAnJ30ke2UucGFja3MgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ3Nob3AnKX0gJHtlLnBhY2tzfSBTb3VsIFBhY2ske2UucGFja3MgPT09IDEgPyAnJyA6ICdzJ30gZWFybmVkIHRoaXMgcnVuLjwvZGl2PmAgOiAnPGRpdiBjbGFzcz1cInN1YlwiPkNsZWFyIHdhdmUgMTAgdG8gZWFybiBhIFNvdWwgUGFjay48L2Rpdj4nfTxkaXYgY2xhc3M9XCJyb3dcIj4ke2UucGFja3MgPyAnPGJ1dHRvbiBpZD1cInRvU2hvcFwiIGNsYXNzPVwiZ29cIj5PcGVuIHBhY2s8L2J1dHRvbj4nIDogJyd9PGJ1dHRvbiBpZD1cImFnYWluXCIgY2xhc3M9XCIke2UucGFja3MgPyAnYmx1ZScgOiAnZ28nfVwiPkdvIGFnYWluPC9idXR0b24+PGJ1dHRvbiBpZD1cInRvSG9tZVwiIGNsYXNzPVwiYmx1ZVwiPkhvbWU8L2J1dHRvbj48L2Rpdj48L2Rpdj5gO1xuICAgICAgICAkKCdhZ2FpbicpLm9uY2xpY2sgPSAoKSA9PiBnLm5ld0VuZGxlc3MoKTsgJCgndG9Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAgICAgY29uc3QgdHMyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvU2hvcCcpOyBpZiAodHMyKSB0czIub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc2hvcCcpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPiR7Zy5kYWlseSA/IChwaCA9PT0gJ3dvbicgPyAnRGFpbHkgY29tcGxldGUhJyA6ICdDaGFsbGVuZ2UgZmFpbGVkJykgOiBwaCA9PT0gJ3dvbicgPyAnU3RhZ2UgY2xlYXJlZCEnIDogJ1N0YWdlIGxvc3QnfTwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPiR7Zy5sYXN0QmF0dGxlfTwvZGl2PiR7cmV3YXJkSHRtbH08ZGl2IGNsYXNzPVwicm93XCI+JHsocncgJiYgcncucGFjaykgfHwgKGRyICYmIGRyLnBhY2spID8gJzxidXR0b24gaWQ9XCJ0b1Nob3BcIiBjbGFzcz1cImdvXCI+T3BlbiBwYWNrPC9idXR0b24+JyA6ICcnfTxidXR0b24gaWQ9XCJhZ2FpblwiIGNsYXNzPVwiJHsocncgJiYgcncucGFjaykgfHwgKGRyICYmIGRyLnBhY2spID8gJ2JsdWUnIDogJ2dvJ31cIj4ke3BoID09PSAnd29uJyA/ICdQbGF5IGFnYWluJyA6ICdUcnkgYWdhaW4nfTwvYnV0dG9uPjxidXR0b24gaWQ9XCJ0b0hvbWVcIiBjbGFzcz1cImJsdWVcIj5Ib21lPC9idXR0b24+PC9kaXY+PC9kaXY+YDtcbiAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IChnLmRhaWx5ID8gZy5uZXdEYWlseSgpIDogZy5uZXdSdW4oKSk7ICQoJ3RvSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgICBjb25zdCB0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b1Nob3AnKTsgaWYgKHRzKSB0cy5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zaG9wJykpO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnJlbmRlckRlYnVnTGl2ZSgpO1xuICAgIGlmIChwaCA9PT0gJ2J1aWxkJykgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IGcucmVmcmFtZUJ1aWxkKCkpOyAgICAgLy8gYWZ0ZXIgbGF5b3V0OiBrZWVwIHRoZSBncmlkIGNsZWFyIG9mIHRoZSBoYW5kIGFuZCBidXR0b25zXG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgcGFuZWxcbiAgcHJpdmF0ZSByZW5kZXJEZWJ1ZygpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBkID0gdGhpcy5kYmc7IGlmICghZC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSkgeyBkLmlubmVySFRNTCA9ICcnOyByZXR1cm47IH1cbiAgICBjb25zdCByb3cgPSAobGFiZWw6IHN0cmluZywgb2JqOiBhbnksIGtleTogc3RyaW5nIHwgbnVtYmVyLCBtaW46IG51bWJlciwgbWF4OiBudW1iZXIsIHN0ZXA6IG51bWJlcikgPT4gYDxsYWJlbD4ke2xhYmVsfSA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiJHttaW59XCIgbWF4PVwiJHttYXh9XCIgc3RlcD1cIiR7c3RlcH1cIiB2YWx1ZT1cIiR7b2JqW2tleV19XCIgZGF0YS1vPVwiJHtsYWJlbH1cIj48c3Bhbj4ke29ialtrZXldfTwvc3Bhbj48L2xhYmVsPmA7XG4gICAgZC5pbm5lckhUTUwgPSBgPGI+RGVidWcgKGxpdmUpPC9iPiA8c3BhbiBpZD1cImRiZ2Zwc1wiPjwvc3Bhbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+U3RhciBtdWx0aXBsaWVycyAoYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHkpXG4gICAgICAgICR7cm93KCdIUCB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdIUCB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnU2l6ZSAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAxLCAxLCAxLjYsIDAuMDIpfSR7cm93KCdTaXplIDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDIsIDEsIDIsIDAuMDIpfTwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48dGFibGU+PHRyPjx0aD48L3RoPjx0aD5ocDwvdGg+PHRoPmRtZzwvdGg+PHRoPnJhdGU8L3RoPjx0aD5yYW5nZTwvdGg+PHRoPnNwZDwvdGg+PC90cj4ke1NPVUxTLm1hcCgoaykgPT4gYDx0cj48dGQ+JHtJQ09OW2tdfTwvdGQ+JHtbJ2hwJywgJ2RtZycsICdpbnRlcnZhbCcsICdyYW5nZScsICdzcGVlZCddLm1hcCgoZikgPT4gYDx0ZD48aW5wdXQgY2xhc3M9XCJudW1cIiBkYXRhLXNvdWw9XCIke2t9XCIgZGF0YS1mPVwiJHtmfVwiIHZhbHVlPVwiJHsoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2tdW2ZdfVwiPjwvdGQ+YCkuam9pbignJyl9PC90cj5gKS5qb2luKCcnKX08L3RhYmxlPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5EaWZmaWN1bHR5IDxzZWxlY3QgaWQ9XCJkRGlmZlwiPiR7WydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5QZXJmb3JtYW5jZTxicj48c21hbGwgaWQ9XCJkYmdQZXJmXCI+bWVhc3VyaW5nXHUyMDI2PC9zbWFsbD48YnI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRGcHNcIiAke2cuc2hvd0ZwcyA/ICdjaGVja2VkJyA6ICcnfT4gU2hvdyBGUFMgb24gdGhlIGJhdHRsZSBzY3JlZW48L2xhYmVsPiA8YnV0dG9uIGlkPVwiZFBlcmZcIj5Db3B5IHBlcmYgcmVwb3J0PC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkT2Rkc1wiPlRlc3Qgb2RkcyAoMjAwIGZpZ2h0cyk8L2J1dHRvbj4gPHNwYW4gaWQ9XCJkT2Rkc091dFwiPiR7dGhpcy5vZGRzfTwvc3Bhbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRDb3B5XCI+Q29weSByZXBvcnQ8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXNldFwiPlJlc2V0IGJhbGFuY2U8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXN0YXJ0XCI+UmVzdGFydCBzdGFnZTwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5BZGQgY2FyZCA8c2VsZWN0IGlkPVwiZENhcmRcIj4ke1NPVUxTLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCI+JHtTT1VMX05BTUVba119PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxidXR0b24gaWQ9XCJkQWRkXCI+KzwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZERvbVwiPisyIERvbWluaW9uPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5MYXN0IHRhcDogPHNwYW4gaWQ9XCJkYmd0YXBcIj4ke2cubGFzdFRhcEluZm99PC9zcGFuPjwvc21hbGw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5TZWVkICR7Zy5zZWVkfS4gQWRkIDxjb2RlPj9zZWVkPTc8L2NvZGU+IHRvIHRoZSBsaW5rIHRvIHJlcGxheSB0aGUgc2FtZSBkcmF3cy48L3NtYWxsPjwvZGl2PmA7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dFt0eXBlPXJhbmdlXScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmlucHV0ID0gKCkgPT4ge1xuICAgICAgY29uc3QgbGFiID0gaW5wLmRhdGFzZXQubyE7IGNvbnN0IHYgPSAraW5wLnZhbHVlOyAoaW5wLm5leHRFbGVtZW50U2libGluZyBhcyBIVE1MRWxlbWVudCkudGV4dENvbnRlbnQgPSBTdHJpbmcodik7XG4gICAgICBjb25zdCBzZXQ6IFJlY29yZDxzdHJpbmcsICgpID0+IHZvaWQ+ID0geyAnSFAgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsxXSA9IHYpLCAnSFAgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsyXSA9IHYpLCAnRGFtYWdlIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzFdID0gdiksICdEYW1hZ2UgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMl0gPSB2KSwgJ1NpemUgMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMV0gPSB2KSwgJ1NpemUgM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMl0gPSB2KSB9O1xuICAgICAgc2V0W2xhYl0oKTsgZy5hcHBseUJhbGFuY2VDaGFuZ2UoKTtcbiAgICB9KSk7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dC5udW0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25jaGFuZ2UgPSAoKSA9PiB7IChCQUxBTkNFLnN0YXRzIGFzIGFueSlbaW5wLmRhdGFzZXQuc291bCFdW2lucC5kYXRhc2V0LmYhXSA9ICtpbnAudmFsdWU7IH0pKTtcbiAgICAkKCdkRGlmZicpLm9uY2hhbmdlID0gKGUpID0+IGcuY2hhbmdlRGlmZmljdWx0eSgoZS50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlKTtcbiAgICAkKCdkTWVyZ2VIYW5kJykub25jaGFuZ2UgPSAoZSkgPT4geyBnLnMucnVsZXMubWVyZ2UgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZCA/ICdoYW5kSW50b09uZVN0YXInIDogJ2RlcGxveWVkT25seSc7IGcuc3luY0J1aWxkKCk7IHRoaXMucmVuZGVyKCk7IH07XG4gICAgJCgnZE9kZHMnKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCByID0gZy50ZXN0T2RkcygyMDApOyB0aGlzLm9kZHMgPSBgJHtyLndpbn0lIHdpbiAoJHtyLm59IGZpZ2h0cywgYXZnICR7ci5hdmdUaW1lfXMpIHZzIHdhdmUgJHtnLnMud2F2ZX1gOyAkKCdkT2Rkc091dCcpLnRleHRDb250ZW50ID0gdGhpcy5vZGRzOyB9O1xuICAgICQoJ2RDb3B5Jykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucmVwb3J0KCk7IChuYXZpZ2F0b3IuY2xpcGJvYXJkID8gbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCkgOiBQcm9taXNlLnJlamVjdCgpKS50aGVuKCgpID0+IHRoaXMudG9hc3QoJ1JlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RGcHMnKS5vbmNoYW5nZSA9IChlKSA9PiBnLnNldFNob3dGcHMoKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQpO1xuICAgICQoJ2RQZXJmJykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucGVyZlJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdQZXJmIHJlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RSZXNldCcpLm9uY2xpY2sgPSAoKSA9PiB7IGcucmVzZXRCYWxhbmNlQWxsKCk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICAkKCdkUmVzdGFydCcpLm9uY2xpY2sgPSAoKSA9PiBnLnN0YXJ0U3RhZ2UoZy5zZWVkKTtcbiAgICAkKCdkQWRkJykub25jbGljayA9ICgpID0+IGcuYWRkQ2FyZCgoJCgnZENhcmQnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUgYXMgU291bElkKTsgJCgnZERvbScpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZERvbWluaW9uKDIpO1xuICB9XG4gIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ1BlcmYnKTsgaWYgKHBmKSB7IGNvbnN0IHAgPSB0aGlzLmcucGVyZkluZm8oKTsgcGYudGV4dENvbnRlbnQgPSBgJHtwLmZwcy50b0ZpeGVkKDApfSBmcHMgXHUwMEI3IGF2ZyAke3AuYXZnLnRvRml4ZWQoMSl9bXMgXHUwMEI3IHNsb3c1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMgXHUwMEI3IHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIFx1MDBCNyAke3AubWVzaGVzfSBtZXNoZXMgXHUwMEI3ICR7cC5wYXJ0aWNsZXN9IHBhcnRpY2xlIHN5c3RlbXMgXHUwMEI3ICR7cC5kcmF3c30gZHJhdyBjYWxsc2A7IH1cbiAgICBjb25zdCB0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ3RhcCcpOyBpZiAodCkgdC50ZXh0Q29udGVudCA9IHRoaXMuZy5sYXN0VGFwSW5mbztcbiAgfVxufVxuIiwgIi8vIFRoZSBwbGF5YWJsZSBwcm90b3R5cGU6IGJ1aWxkIHNjcmVlbiAtPiBiYXR0bGUgLT4gZHJhZnQgLT4gbmV4dCB3YXZlLCBidWlsdCBvbiB0aGUgdGVzdGVkIHJ1bGVzICsgYmF0dGxlIGVuZ2luZS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSwgcmVzZXRCYWxhbmNlLCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgR1JJRF9DRUxMUywgR1JJRF9DT0xTLCBHUklEX1JPV1MsIFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7XG4gIGFkdmFuY2VXYXZlLCBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNlbGxGcmVlLCBjb3N0LCBkaXNjYXJkUmVkcmF3LCBkaXNtaXNzLCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgZHJhZnRPcHRpb25zLCBmYWlsV2F2ZSxcbiAgbWVyZ2VEZXBsb3llZCwgbWVyZ2VGcm9tSGFuZCwgbW92ZVVuaXQsIG5ld1N0YWdlLCBub3JtYWxEcmF3LCBzdGFnZVdhdmVzLCBzdW1tb24sIHN3YXBTZWxsLCB0YWtlRHJhZnQsXG59IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgYnVpbGRBcmVuYSB9IGZyb20gJy4vYXJlbmEudHMnO1xuaW1wb3J0IHsgQmF0dGxlLCBjZWxsUG9zLCBGUk9OVF9YLCBHUklEX1NQLCBzaW11bGF0ZSB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB0eXBlIHsgQkV2ZW50IH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHsgY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lLCBlbmVteVBvd2VyLCBlbmVteVdhdmUsIGlzRW5kbGVzcywgc2V0RGlmZmljdWx0eSwgc2V0RW5kbGVzcywgc2V0U3RhZ2VEaWZmaWN1bHR5LCBzZXREYWlseSB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19JRCwgRU5ETEVTU19QQUNLX0VWRVJZIH0gZnJvbSAnLi4vY29yZS9lbmRsZXNzLnRzJztcbmltcG9ydCB7IERBSUxZX0lELCBkYWlseVJ1bGVzLCBkYXlOdW1iZXIsIGlzVmFsaWREYXksIG1vZGlmaWVyRm9yIH0gZnJvbSAnLi4vY29yZS9kYWlseS50cyc7XG5pbXBvcnQgdHlwZSB7IERhaWx5TW9kIH0gZnJvbSAnLi4vY29yZS9kYWlseS50cyc7XG5pbXBvcnQgeyBFTkRMRVNTX1JVTEVTLCBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuLi9jb3JlL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgeyBsb2FkU2F2ZSB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5pbXBvcnQgeyBlbmRsZXNzVW5sb2NrZWQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB7IE5lY3JvbWFuY2VyIH0gZnJvbSAnLi9uZWNyb21hbmNlci50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgY2xlYXJSdW4sIGxvYWRSdW4sIHNhdmVSdW4sIHNlcmlhbGl6ZVN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB7IGFkZEdvbGRBbmRTYXZlLCBlbmRsZXNzV2F2ZUdvbGQsIHBsYXlhYmxlLCByZWNvcmRDbGVhckFuZFNhdmUsIHJlY29yZERhaWx5V2luQW5kU2F2ZSwgcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlLCB3YXZlR29sZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBEYWlseVJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBDbGVhclJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSdW5TbmFwc2hvdCB9IGZyb20gJy4uL2NvcmUvcnVuc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBjcmVhdGVWaXN1YWwsIGlzVHJpcG8sIGxvYWRBc3NldHMgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHR5cGUgeyBBc3NldHMsIFVuaXRWaXN1YWwgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHsgVWkgfSBmcm9tICcuL3VpLnRzJztcblxuZXhwb3J0IHR5cGUgUGhhc2UgPSAnYnVpbGQnIHwgJ3RyYW5zaXRpb24nIHwgJ2JhdHRsZScgfCAnZHJhZnQnIHwgJ3dvbicgfCAnbG9zdCc7XG50eXBlIFNlbCA9IHsgdHlwZTogJ2NhcmQnOyBpZHg6IG51bWJlciB9IHwgeyB0eXBlOiAndW5pdCc7IGlkOiBudW1iZXIgfSB8IG51bGw7XG5cbmV4cG9ydCBjbGFzcyBHYW1lIHtcbiAgZW5naW5lOiBhbnk7IHNjZW5lOiBhbnk7IGNhbWVyYTogYW55OyBBITogQXNzZXRzOyB1aSE6IFVpO1xuICBkYWlseTogeyBkYXk6IG51bWJlcjsgbW9kOiBEYWlseU1vZCB9IHwgbnVsbCA9IG51bGw7IGRhaWx5UmV3YXJkOiBEYWlseVJld2FyZCB8IG51bGwgPSBudWxsOyAgIC8vIHRoZSBEYWlseSBDaGFsbGVuZ2UgcnVuIGluIHByb2dyZXNzLCBhbmQgd2hhdCBpdHMgd2luIHBhaWRcbiAgbGFzdEdvbGQgPSAwOyBydW5Hb2xkID0gMDsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBmcm9tIHRoZSB3YXZlIGp1c3QgY2xlYXJlZCwgYW5kIGZyb20gdGhpcyB3aG9sZSBydW5cbiAgcyE6IFN0YXRlOyBzZWVkID0gMTsgYXR0ZW1wdCA9IDA7IHBoYXNlOiBQaGFzZSA9ICdidWlsZCc7IGJhdHRsZTogQmF0dGxlIHwgbnVsbCA9IG51bGw7IHRpbWVTY2FsZSA9IDE7XG4gIHNlbDogU2VsID0gbnVsbDsgc3dhcE1vZGUgPSBmYWxzZTsgY29uZmlybVJlbW92ZSA9IGZhbHNlOyBkcmFmdDogU291bElkW10gfCBudWxsID0gbnVsbDsgbGFzdEJhdHRsZSA9ICcnO1xuICBwcml2YXRlIHVuaXRWaXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgIC8vIHVuaXQgaWQgLT4gdmlzdWFsICh5b3VyIGFybXksIHBlcnNpc3RzIGJldHdlZW4gd2F2ZXMpXG4gIHByaXZhdGUgdmlzVG9Vbml0ID0gbmV3IE1hcDxVbml0VmlzdWFsLCBudW1iZXI+KCk7XG4gIHByaXZhdGUgZnZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB2aXN1YWwgZHVyaW5nIGEgYmF0dGxlXG4gIHByaXZhdGUgZlVuaXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpOyAgICAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB1bml0IGlkIChwbGF5ZXIgc2lkZSlcbiAgcHJpdmF0ZSBsYXN0U3RhdGUgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpO1xuICBwcml2YXRlIGFyZW5hITogeyB1cGRhdGUodDogbnVtYmVyKTogdm9pZDsgc2V0VGhlbWUoc3RhZ2U6IHN0cmluZyk6IHZvaWQgfTtcbiAgcHJpdmF0ZSB0aWxlczogYW55W10gPSBbXTsgcHJpdmF0ZSB0aWxlTWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSByaW5nRng6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbWVyczogeyB0OiBudW1iZXI7IGZuOiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIGFjYyA9IDA7IHByaXZhdGUgY2FtRnJvbTogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UID0gMTsgcHJpdmF0ZSBjYW1EdXIgPSAyLjA7IHByaXZhdGUgcmVzdWx0QXQgPSAtMTsgcHJpdmF0ZSBoYW5kbGVkID0gZmFsc2U7IHByaXZhdGUgc3RhcnRTdGVwQXQgPSAwO1xuICBwcml2YXRlIGFycm93TWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd01lc2g6IGFueVtdID0gW107XG4gIG5lY3JvITogTmVjcm9tYW5jZXI7XG4gIC8qKiBXaGF0IHRoZSBsYXN0IHN0YWdlIGNsZWFyIGVhcm5lZCAoc2hvd24gb24gdGhlIHN0YWdlLWNsZWFyZWQgc2NyZWVuKS4gKi9cbiAgcmV3YXJkOiBDbGVhclJld2FyZCB8IG51bGwgPSBudWxsO1xuICAvKiogVGhlIGVuZGxlc3MgcnVuIGluIHByb2dyZXNzOiB0aGUgYmVzdCBkZXB0aCB3aGVuIGl0IGJlZ2FuICh0byBzcG90IGEgbmV3IHJlY29yZCksIHRoZSB3YXZlcyBjbGVhcmVkIHNvIGZhciwgYW5kIHRoZSBwYWNrcyBlYXJuZWQuICovXG4gIGVuZGxlc3M6IHsgc3RhcnRCZXN0OiBudW1iZXI7IGNsZWFyZWQ6IG51bWJlcjsgcGFja3M6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2luZSA9IGZhbHNlOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSByZXN1bHQgY3V0c2NlbmUgaXMgcGxheWluZzogdGhlIGJhdHRsZSBjYW1lcmEgYW5kIGZpZ2h0ZXIgc3luYyBzdGFuZCBkb3duXG4gIHByaXZhdGUgdHdlZW5zOiB7IHQ6IG51bWJlcjsgZHVyOiBudW1iZXI7IGZuOiAodTogbnVtYmVyKSA9PiB2b2lkOyBkb25lPzogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSB0d2VlbihkdXI6IG51bWJlciwgZm46ICh1OiBudW1iZXIpID0+IHZvaWQsIGRvbmU/OiAoKSA9PiB2b2lkKSB7IHRoaXMudHdlZW5zLnB1c2goeyB0OiAwLCBkdXIsIGZuLCBkb25lIH0pOyB9XG4gIC8qKiBGaW5pc2ggZXZlcnkgcnVubmluZyBhbmltYXRpb24gYXQgb25jZSAoc28gbm90aGluZyBpcyBsZWZ0IGhhbGYtd2F5IG9yIHVuZGlzcG9zZWQgd2hlbiB0aGUgcGhhc2UgY2hhbmdlcykuICovXG4gIHByaXZhdGUgZmx1c2hUd2VlbnMoKSB7IGZvciAoY29uc3QgdyBvZiB0aGlzLnR3ZWVucy5zcGxpY2UoMCkpIHsgdy5mbigxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICBwcml2YXRlIHNlZW5NZXJnZXMgPSAwO1xuXG4gIGFzeW5jIGluaXQoY2FudmFzOiBIVE1MQ2FudmFzRWxlbWVudCkge1xuICAgIGNvbnN0IHFzID0gbmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpO1xuICAgIHRoaXMuZW5naW5lID0gbmV3IEJBQllMT04uRW5naW5lKGNhbnZhcywgdHJ1ZSwgeyBhbnRpYWxpYXM6IHRydWUsIHBvd2VyUHJlZmVyZW5jZTogJ2hpZ2gtcGVyZm9ybWFuY2UnIH0pO1xuICAgIGNvbnN0IGRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7IHRoaXMuZW5naW5lLnNldEhhcmR3YXJlU2NhbGluZ0xldmVsKDEgLyBNYXRoLm1pbihkcHIsIDEuNSkpO1xuICAgIGNvbnN0IHNjZW5lID0gdGhpcy5zY2VuZSA9IG5ldyBCQUJZTE9OLlNjZW5lKHRoaXMuZW5naW5lKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjA5LCAwLjA3LCAwLjEzLCAxKTtcbiAgICBjb25zdCBoZW1pID0gbmV3IEJBQllMT04uSGVtaXNwaGVyaWNMaWdodCgnaCcsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAxLCAwLjMpLCBzY2VuZSk7IGhlbWkuaW50ZW5zaXR5ID0gMS4wNTsgaGVtaS5ncm91bmRDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjMyLCAwLjI2LCAwLjQyKTtcbiAgICBjb25zdCBzdW4gPSBuZXcgQkFCWUxPTi5EaXJlY3Rpb25hbExpZ2h0KCdzJywgbmV3IEJBQllMT04uVmVjdG9yMygtMC40LCAtMSwgMC41NSksIHNjZW5lKTsgc3VuLmludGVuc2l0eSA9IDAuODU7XG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgQkFCWUxPTi5GcmVlQ2FtZXJhKCdjYW0nLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDgsIC05KSwgc2NlbmUpOyB0aGlzLmNhbWVyYS5taW5aID0gMC4xOyB0aGlzLmNhbWVyYS5tYXhaID0gMjAwOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg7IHRoaXMuY2FtZXJhLmlucHV0cy5jbGVhcigpO1xuXG4gICAgY29uc3QgZ3JvdW5kID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ2dyb3VuZCcsIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQwIH0sIHNjZW5lKTtcbiAgICBncm91bmQuaXNQaWNrYWJsZSA9IGZhbHNlOyBjb25zdCBhcmVuYSA9IHRoaXMuYXJlbmEgPSBidWlsZEFyZW5hKHNjZW5lLCBncm91bmQpOyBzY2VuZS5vbkJlZm9yZVJlbmRlck9ic2VydmFibGUuYWRkKCgpID0+IGFyZW5hLnVwZGF0ZShwZXJmb3JtYW5jZS5ub3coKSAvIDEwMDApKTtcbiAgICBmb3IgKGNvbnN0IHRlYW0gb2YgWzAsIDFdIGFzIGNvbnN0KSBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBjb25zdCB0ID0gdGhpcy5tYWtlVGlsZSh0ZWFtLCBjKTsgaWYgKHRlYW0gPT09IDApIHRoaXMudGlsZXMucHVzaCh0KTsgZWxzZSB0LnNldEVuYWJsZWQoZmFsc2UpOyB9XG5cbiAgICB0aGlzLkEgPSBhd2FpdCBsb2FkQXNzZXRzKHNjZW5lKTtcbiAgICB0aGlzLm5lY3JvID0gbmV3IE5lY3JvbWFuY2VyKHNjZW5lLCB0aGlzLkEuc29mdCwgdGhpcy5BLm5lY3JvKTsgICAgICAgLy8gc3RhbmRzIGp1c3QgYmVoaW5kIGhpcyBhcm15J3MgYmFjayBjb2x1bW4sIGZhY2luZyB0aGUgYmF0dGxlZmllbGRcbiAgICB0aGlzLm5lY3JvLmhvbGRlci5wb3NpdGlvbi5zZXQoLShGUk9OVF9YICsgKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCkgLSAxLjA1LCAwLCAwKTsgdGhpcy5uZWNyby5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyO1xuICAgIHRoaXMuYXJyb3dNYXRzID0gWzAsIDFdLm1hcCgodCkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnYW0nICsgdCwgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4zLCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjcsIDAuMjUpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHJldHVybiBtOyB9KTtcbiAgICB0aGlzLnVpID0gbmV3IFVpKHRoaXMpOyB0aGlzLnNlZWQgPSArKHFzLmdldCgnc2VlZCcpIHx8IDEpOyBpZiAocXMuZ2V0KCdmcHMnKSkgdGhpcy5zZXRTaG93RnBzKHRydWUpO1xuXG4gICAgLy8gVGFwcyBhcmUgZGV0ZWN0ZWQgaGVyZSAobm90IHRocm91Z2ggQmFieWxvbikgc28gdGhleSBiZWhhdmUgdGhlIHNhbWUgaW4gU2FmYXJpLCB0aGUgaG9tZS1zY3JlZW4gYXBwIGFuZCBvbiBkZXNrdG9wLlxuICAgIGxldCBkb3duOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB0OiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xuICAgIGNvbnN0IGxvY2FsID0gKGU6IFBvaW50ZXJFdmVudCkgPT4geyBjb25zdCByID0gY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpOyByZXR1cm4geyB4OiBlLmNsaWVudFggLSByLmxlZnQsIHk6IGUuY2xpZW50WSAtIHIudG9wIH07IH07XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJkb3duJywgKGUpID0+IHsgZG93biA9IHsgLi4ubG9jYWwoZSksIHQ6IHBlcmZvcm1hbmNlLm5vdygpIH07IH0pO1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVydXAnLCAoZSkgPT4geyBpZiAoIWRvd24pIHJldHVybjsgY29uc3QgcCA9IGxvY2FsKGUpOyBjb25zdCBtb3ZlZCA9IE1hdGguaHlwb3QocC54IC0gZG93bi54LCBwLnkgLSBkb3duLnkpLCBkdCA9IHBlcmZvcm1hbmNlLm5vdygpIC0gZG93bi50OyBkb3duID0gbnVsbDsgaWYgKG1vdmVkIDwgMTYgJiYgZHQgPCA5MDApIHRoaXMudGFwKHAueCwgcC55KTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJjYW5jZWwnLCAoKSA9PiB7IGRvd24gPSBudWxsOyB9KTtcbiAgICB0aGlzLmNhbnZhcyA9IGNhbnZhczsgY29uc3Qgb25SZXNpemUgPSAoKSA9PiB0aGlzLmhhbmRsZVJlc2l6ZSgpO1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBvblJlc2l6ZSk7IHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdvcmllbnRhdGlvbmNoYW5nZScsICgpID0+IHNldFRpbWVvdXQob25SZXNpemUsIDI1MCkpO1xuICAgIGlmICgod2luZG93IGFzIGFueSkudmlzdWFsVmlld3BvcnQpICh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydC5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBvblJlc2l6ZSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS5SZXNpemVPYnNlcnZlcikgbmV3ICh3aW5kb3cgYXMgYW55KS5SZXNpemVPYnNlcnZlcihvblJlc2l6ZSkub2JzZXJ2ZShjYW52YXMpO1xuICAgIGlmIChxcy5nZXQoJ2dhbGxlcnknKSkgeyB0aGlzLmdhbGxlcnkoKTsgcmV0dXJuOyB9XG4gICAgY29uc3Qgc2F2ZWQgPSBxcy5nZXQoJ3NlZWQnKSA/IG51bGwgOiBsb2FkUnVuKCk7ICAgICAgICAgICAgICAgIC8vID9zZWVkPU4gYWx3YXlzIHN0YXJ0cyBmcmVzaCAoZGVidWdnaW5nKTsgb3RoZXJ3aXNlIHBpY2sgdXAgd2hlcmUgdGhlIGxhc3QgdmlzaXQgbGVmdCBvZmZcbiAgICBpZiAoc2F2ZWQpIHRoaXMucmVzdG9yZShzYXZlZCk7IGVsc2UgdGhpcy5zdGFydFN0YWdlKHRoaXMuc2VlZCk7XG4gICAgbGV0IGxhc3QgPSBwZXJmb3JtYW5jZS5ub3coKTtcbiAgICB0aGlzLmVuZ2luZS5ydW5SZW5kZXJMb29wKCgpID0+IHsgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCksIHJhdyA9IG5vdyAtIGxhc3Q7IGNvbnN0IGR0ID0gTWF0aC5taW4oMC4wNSwgcmF3IC8gMTAwMCk7IGxhc3QgPSBub3c7IGlmICghdGhpcy5hY3RpdmUpIHJldHVybjsgaWYgKHRoaXMuaW5zcGVjdGluZykgdGhpcy5mcmFtZUluc3BlY3QoZHQpOyBlbHNlIGlmICghdGhpcy5mcm96ZW4pIHRoaXMuZnJhbWUoZHQpOyBzY2VuZS5yZW5kZXIoKTsgdGhpcy5wZXJmVGljayhyYXcpOyB9KTtcbiAgfVxuICAvKiogVGhlIG5hdmlnYXRpb24gc2hlbGwgaGlkZXMgdGhlIGJhdHRsZSBzY3JlZW4gd2hpbGUgYW5vdGhlciB0YWIgaXMgb3BlbjogcGF1c2UgdGhlIGdhbWUgc28gaXQgY29zdHMgbm90aGluZy4gKi9cbiAgcHJpdmF0ZSBhY3RpdmUgPSB0cnVlO1xuICAvKiogRGVidWc6IGtlZXAgZHJhd2luZyBidXQgc3RvcCBhZHZhbmNpbmcgdGltZSwgc28gYSBtb21lbnQgY2FuIGJlIHN0ZXBwZWQgdGhyb3VnaCB3aXRoIGZyYW1lKGR0KSBhbmQgc2NyZWVuc2hvdHRlZC4gKi9cbiAgZnJvemVuID0gZmFsc2U7XG4gIHN0ZXAoZHQ6IG51bWJlcikgeyB0aGlzLmZyYW1lKGR0KTsgfVxuICBzZXRBY3RpdmUob246IGJvb2xlYW4pIHsgdGhpcy5hY3RpdmUgPSBvbjsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGluc3BlY3QgKHRoZSBTb3VscyBwYWdlJ3MgM0QgbG9vayBhdCBvbmUgU291bClcbiAgcHJpdmF0ZSBpbnNwZWN0aW5nOiB7IHNvdWw6IFNvdWxJZDsgdjogVW5pdFZpc3VhbDsgc3RhcjogbnVtYmVyOyB0ZWFtOiAwIHwgMTsgc3BpbjogYm9vbGVhbjsgaGlkZGVuOiBhbnlbXTsgZ3JpZDogYm9vbGVhbiB9IHwgbnVsbCA9IG51bGw7XG4gIC8qKiBTaG93IG9uZSBTb3VsIG9uIGl0cyBvd24gb24gdGhlIGFyZW5hIGZsb29yOiBzbG93IHR1cm50YWJsZSwgYnV0dG9ucyBmb3IgZXZlcnkgYW5pbWF0aW9uIGl0IGhhcywgc3RhciBzaXplcyBhbmQgdGhlIGVuZW15IGNvbG91cnMuICovXG4gIGluc3BlY3Qoc291bDogU291bElkKSB7XG4gICAgaWYgKCF0aGlzLkEgfHwgdGhpcy5pbnNwZWN0aW5nKSByZXR1cm47XG4gICAgY29uc3QgaGlkZGVuOiBhbnlbXSA9IFtdOyBjb25zdCBoaWRlID0gKG46IGFueSkgPT4geyBpZiAobiAmJiBuLmlzRW5hYmxlZCAmJiBuLmlzRW5hYmxlZCgpKSB7IG4uc2V0RW5hYmxlZChmYWxzZSk7IGhpZGRlbi5wdXNoKG4pOyB9IH07XG4gICAgZm9yIChjb25zdCB2IG9mIHRoaXMudW5pdFZpcy52YWx1ZXMoKSkgaGlkZSh2LmhvbGRlcik7IHRoaXMuZnZpcy5mb3JFYWNoKCh2KSA9PiBoaWRlKHYuaG9sZGVyKSk7IGlmICh0aGlzLm5lY3JvLmhvbGRlci5pc0VuYWJsZWQoKSkgeyB0aGlzLm5lY3JvLnNldEVuYWJsZWQoZmFsc2UpOyBoaWRkZW4ucHVzaCh7IHNldEVuYWJsZWQ6IChvbjogYm9vbGVhbikgPT4gdGhpcy5uZWNyby5zZXRFbmFibGVkKG9uKSB9KTsgfSB0aGlzLnJpbmdGeC5mb3JFYWNoKChyKSA9PiBoaWRlKHIubSkpOyB0aGlzLmFycm93cy5mb3JFYWNoKChhKSA9PiBoaWRlKGEubWVzaCkpO1xuICAgIGNvbnN0IGdyaWQgPSB0aGlzLnRpbGVzLmxlbmd0aCA+IDAgJiYgdGhpcy50aWxlc1swXS5pc0VuYWJsZWQoKTsgdGhpcy5zaG93R3JpZChmYWxzZSk7XG4gICAgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHNvdWwsIDAsIDEpOyBjb25zdCBQID0geyB4OiAtNiwgejogMCB9OyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoUC54LCAwLCBQLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAqIDAuODU7IHYucGxheSgnaWRsZScpO1xuICAgIHRoaXMuaW5zcGVjdGluZyA9IHsgc291bCwgdiwgc3RhcjogMSwgdGVhbTogMCwgc3BpbjogdHJ1ZSwgaGlkZGVuLCBncmlkIH07XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QuYWRkKCdpbnNwZWN0Jyk7XG4gICAgdGhpcy5jYW1lcmEuZm92ID0gMC42MjsgdGhpcy5jYW1lcmEucG9zaXRpb24uc2V0KFAueCwgMS4xNSwgUC56IC0gMy41KTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KG5ldyBCQUJZTE9OLlZlY3RvcjMoUC54LCAwLjU2LCBQLnopKTtcbiAgICB0aGlzLnJlbmRlckluc3BlY3RCYXIoKTtcbiAgfVxuICBlbmRJbnNwZWN0KCkge1xuICAgIGNvbnN0IGkgPSB0aGlzLmluc3BlY3Rpbmc7IGlmICghaSkgcmV0dXJuO1xuICAgIGkudi5kaXNwb3NlKCk7IGkuaGlkZGVuLmZvckVhY2goKG4pID0+IG4uc2V0RW5hYmxlZCh0cnVlKSk7IHRoaXMuc2hvd0dyaWQoaS5ncmlkICYmIHRoaXMucGhhc2UgPT09ICdidWlsZCcpO1xuICAgIHRoaXMuaW5zcGVjdGluZyA9IG51bGw7IGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnJlbW92ZSgnaW5zcGVjdCcpOyBjb25zdCBiYXIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaW5zcGVjdGJhcicpOyBpZiAoYmFyKSBiYXIuaW5uZXJIVE1MID0gJyc7XG4gICAgdGhpcy5jYW1lcmEuZm92ID0gMC44OyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpO1xuICB9XG4gIHByaXZhdGUgZnJhbWVJbnNwZWN0KGR0OiBudW1iZXIpIHtcbiAgICBjb25zdCBpID0gdGhpcy5pbnNwZWN0aW5nITsgaS52LnVwZGF0ZShkdCk7IGlmIChpLnNwaW4pIGkudi5ob2xkZXIucm90YXRpb24ueSArPSBkdCAqIDAuNDU7XG4gICAgdGhpcy5hcmVuYS51cGRhdGUocGVyZm9ybWFuY2Uubm93KCkgLyAxMDAwKTtcbiAgfVxuICBwcml2YXRlIHJlbmRlckluc3BlY3RCYXIoKSB7XG4gICAgY29uc3QgaSA9IHRoaXMuaW5zcGVjdGluZzsgY29uc3QgYmFyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2luc3BlY3RiYXInKTsgaWYgKCFpIHx8ICFiYXIpIHJldHVybjtcbiAgICBjb25zdCBuaWNlID0gKG46IHN0cmluZykgPT4gKHsgU3Bhd246ICdBcnJpdmFsJywgQXR0YWNrOiAnQXR0YWNrJywgQ2hlZXI6ICdDaGVlcicsIERlYXRoOiAnRmFsbCcgfSBhcyBhbnkpW25dID8/IG4ucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgJyQxICQyJyk7XG4gICAgY29uc3QgY2xpcHMgPSAoaS52LmNsaXBOYW1lcyA/IGkudi5jbGlwTmFtZXMoKSA6IFtdKS5tYXAoKG4pID0+IGA8YnV0dG9uIGRhdGEtY2xpcD1cIiR7bn1cIj4ke25pY2Uobil9PC9idXR0b24+YCkuam9pbignJyk7XG4gICAgYmFyLmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiaWJcIj48YnV0dG9uIGlkPVwiaWJCYWNrXCIgY2xhc3M9XCJnb1wiPkJhY2s8L2J1dHRvbj48YiBjbGFzcz1cImlidFwiPiR7U09VTF9OQU1FW2kuc291bF19PC9iPiR7WzEsIDIsIDNdLm1hcCgobikgPT4gYDxidXR0b24gZGF0YS1zdGFyPVwiJHtufVwiIGNsYXNzPVwiJHtpLnN0YXIgPT09IG4gPyAnb24nIDogJyd9XCI+JHtufVxcdTI2MDU8L2J1dHRvbj5gKS5qb2luKCcnKX08YnV0dG9uIGlkPVwiaWJUZWFtXCIgY2xhc3M9XCIke2kudGVhbSA/ICdvbicgOiAnJ31cIj5FbmVteSBjb2xvdXJzPC9idXR0b24+PGJ1dHRvbiBpZD1cImliU3BpblwiIGNsYXNzPVwiJHtpLnNwaW4gPyAnb24nIDogJyd9XCI+VHVybjwvYnV0dG9uPjwvZGl2PjxkaXYgY2xhc3M9XCJpYiBpYmNcIj4ke2NsaXBzfTwvZGl2PmA7XG4gICAgYmFyLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jbGlwXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiB7IGF1ZGlvLnBsYXkoJ3RhcCcpOyBpLnYucHJldmlld0NsaXAgJiYgaS52LnByZXZpZXdDbGlwKGIuZGF0YXNldC5jbGlwISk7IH0pKTtcbiAgICBiYXIucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLXN0YXJdJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IHsgaS5zdGFyID0gK2IuZGF0YXNldC5zdGFyITsgaS52LnNldFN0YXIoaS5zdGFyKTsgdGhpcy5yZW5kZXJJbnNwZWN0QmFyKCk7IH0pKTtcbiAgICAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2liVGVhbScpIGFzIEhUTUxFbGVtZW50KS5vbmNsaWNrID0gKCkgPT4geyBpLnRlYW0gPSBpLnRlYW0gPyAwIDogMTsgaS52LnNldFRlYW0oaS50ZWFtKTsgdGhpcy5yZW5kZXJJbnNwZWN0QmFyKCk7IH07XG4gICAgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpYlNwaW4nKSBhcyBIVE1MRWxlbWVudCkub25jbGljayA9ICgpID0+IHsgaS5zcGluID0gIWkuc3BpbjsgdGhpcy5yZW5kZXJJbnNwZWN0QmFyKCk7IH07XG4gICAgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpYkJhY2snKSBhcyBIVE1MRWxlbWVudCkub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc291bHMnKSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzY2VuZSBoZWxwZXJzXG4gIC8qKiBUaGUgcGxhY2VtZW50IGdyaWQgaXMgYSBidWlsZC1zY3JlZW4gdG9vbDogaGlkZSBpdCBkdXJpbmcgdGhlIGZpZ2h0IHNvIHRoZSBiYXR0bGUgbG9va3MgbGlrZSBhIHNjZW5lLCBub3QgYSBib2FyZC4gKi9cbiAgcHJpdmF0ZSBzaG93R3JpZChvbjogYm9vbGVhbikgeyBmb3IgKGNvbnN0IHQgb2YgdGhpcy50aWxlcykgdC5zZXRFbmFibGVkKG9uKTsgfVxuICBwcml2YXRlIG1ha2VUaWxlKHRlYW06IDAgfCAxLCBjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKSwgdCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3RpbGUnICsgY2VsbCwgeyBzaXplOiBHUklEX1NQICogMC45MiB9LCB0aGlzLnNjZW5lKTtcbiAgICB0LnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgdC5wb3NpdGlvbi5zZXQocC54LCAwLjAxNSwgcC56KTtcbiAgICBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndG0nLCB0aGlzLnNjZW5lKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBtLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuMTgsIDAuMTIsIDAuNDIpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuNDIsIDAuMTIsIDAuMTIpOyBtLmFscGhhID0gMC41OyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHQubWF0ZXJpYWwgPSBtO1xuICAgIGlmICh0ZWFtID09PSAwKSB7IHQubWV0YWRhdGEgPSB7IGtpbmQ6ICd0aWxlJywgY2VsbCB9OyB0aGlzLnRpbGVNYXRzW2NlbGxdID0gbTsgfSBlbHNlIHQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHJldHVybiB0O1xuICB9XG4gIHByaXZhdGUgdGludChjZWxsOiBudW1iZXIsIG1vZGU6ICdub3JtYWwnIHwgJ2ZyZWUnIHwgJ3NlbCcgfCAncGFydG5lcicpIHtcbiAgICBjb25zdCBtID0gdGhpcy50aWxlTWF0c1tjZWxsXTsgY29uc3QgYyA9IHsgbm9ybWFsOiBbMC4xOCwgMC4xMiwgMC40MiwgMC41XSwgZnJlZTogWzAuMiwgMC43NSwgMC41NSwgMC43XSwgc2VsOiBbMSwgMC44MiwgMC4zLCAwLjg1XSwgcGFydG5lcjogWzAuODUsIDAuMzUsIDEsIDAuODVdIH1bbW9kZV07XG4gICAgbS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pOyBtLmFscGhhID0gY1szXTtcbiAgfVxuICBsYXRlcihzZWM6IG51bWJlciwgZm46ICgpID0+IHZvaWQpIHsgdGhpcy50aW1lcnMucHVzaCh7IHQ6IHNlYywgZm4gfSk7IH1cbiAgcHJpdmF0ZSBmeFJpbmcoeDogbnVtYmVyLCB6OiBudW1iZXIsIGNvbG9yOiBhbnksIHIwOiBudW1iZXIsIHIxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2Z4JywgeyBkaWFtZXRlcjogMSwgdGhpY2tuZXNzOiAwLjAzNSwgdGVzc2VsbGF0aW9uOiAyOCB9LCB0aGlzLnNjZW5lKTsgbS5wb3NpdGlvbi5zZXQoeCwgMC4wNSwgeik7IG0uaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG1tID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnZnhtJywgdGhpcy5zY2VuZSk7IG1tLmVtaXNzaXZlQ29sb3IgPSBjb2xvcjsgbW0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgbW0uYWxwaGEgPSAwLjk7IG0ubWF0ZXJpYWwgPSBtbTsgdGhpcy5yaW5nRngucHVzaCh7IG0sIG1tLCB0OiAwLCByMCwgcjEsIGR1ciB9KTtcbiAgfVxuICBwcml2YXRlIGJ1cnN0KHg6IG51bWJlciwgejogbnVtYmVyLCBjMTogbnVtYmVyW10sIGMyOiBudW1iZXJbXSwgY291bnQ6IG51bWJlcikge1xuICAgIGNvbnN0IHBzID0gbmV3IEJBQllMT04uUGFydGljbGVTeXN0ZW0oJ2InLCA2MCwgdGhpcy5zY2VuZSk7IHBzLnBhcnRpY2xlVGV4dHVyZSA9IHRoaXMuQS5zb2Z0OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCAwLjA1LCB6KTsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgMC4wNSwgMC4yKTtcbiAgICBwcy5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMxIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzIgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3JEZWFkID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMSwgMCwgMC4yLCAwKTtcbiAgICBwcy5taW5TaXplID0gMC4xMjsgcHMubWF4U2l6ZSA9IDAuMzQ7IHBzLm1pbkxpZmVUaW1lID0gMC40OyBwcy5tYXhMaWZlVGltZSA9IDAuOTsgcHMuZW1pdFJhdGUgPSAwOyBwcy5tYW51YWxFbWl0Q291bnQgPSBjb3VudDsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEsIDEuMywgLTEpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygxLCAyLjQsIDEpO1xuICAgIHBzLm1pbkVtaXRQb3dlciA9IDAuODsgcHMubWF4RW1pdFBvd2VyID0gMjsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgLTIsIDApOyBwcy5ibGVuZE1vZGUgPSBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtLkJMRU5ETU9ERV9BREQ7IHBzLnRhcmdldFN0b3BEdXJhdGlvbiA9IDEuMjsgcHMuZGlzcG9zZU9uU3RvcCA9IHRydWU7IHBzLnN0YXJ0KCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBjYW1lcmFcbiAgcHJpdmF0ZSBwb3NlcygpIHtcbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCBoYWxmID0gRlJPTlRfWCArIChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1AgKyAxLjQ7XG4gICAgY29uc3QgZCA9IE1hdGgubWF4KGhhbGYgLyAodGFuViAqIGFzcCksICgoR1JJRF9ST1dTICogR1JJRF9TUCkgLyAyICsgMikgLyAodGFuViAqIDAuNTUpLCA4KTtcbiAgICBjb25zdCBiYXR0bGUgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMygtMC4xICogZCwgMC40MiAqIGQgKyAwLjUsIC0wLjg2ICogZCksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjM1LCAwKSB9O1xuICAgIC8vIEJ1aWxkIHZpZXc6IChhbG1vc3QpIHN0cmFpZ2h0IGRvd24sIHdpdGggdGhlIHdob2xlIGdyaWQgaW5zaWRlIHRoZSBiYW5kIGJldHdlZW4gdGhlIHRvcCBiYXIgYW5kIHRoZSBoYW5kIG9mIGNhcmRzLlxuICAgIGNvbnN0IGN4ID0gLShGUk9OVF9YICsgKChHUklEX0NPTFMgLSAxKSAqIEdSSURfU1ApIC8gMiksIEggPSBNYXRoLm1heCgxLCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpO1xuICAgIGNvbnN0IGJveCA9IChpZDogc3RyaW5nKSA9PiB7IGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOyByZXR1cm4gZWwgJiYgZWwub2Zmc2V0UGFyZW50ICE9PSBudWxsID8gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkgOiBudWxsOyB9O1xuICAgIGNvbnN0IHRvcEJhciA9IGJveCgndG9wJyksIGhhbmQgPSBib3goJ2hhbmQnKSwgaW5mbyA9IGJveCgnaW5mbycpO1xuICAgIGNvbnN0IFRPUCA9IE1hdGgubWluKDAuMzIsIHRvcEJhciA/ICh0b3BCYXIuYm90dG9tICsgNikgLyBIIDogMC4xKTtcbiAgICBjb25zdCBCT1RUT00gPSBNYXRoLm1pbigwLjUsIChIIC0gTWF0aC5taW4oaGFuZCA/IGhhbmQudG9wIDogSCwgaW5mbyA/IGluZm8udG9wIDogSCkgKyA2KSAvIEgpO1xuICAgIGNvbnN0IGJhbmQgPSBNYXRoLm1heCgwLjMsIDEgLSBUT1AgLSBCT1RUT00pLCBjZW50ZXJGcmFjID0gVE9QICsgYmFuZCAvIDI7ICAgICAgICAgIC8vIHRoZSBncmlkJ3MgY2VudHJlIGFwcGVhcnMgYXQgdGhpcyBmcmFjdGlvbiBmcm9tIHRoZSB0b3BcbiAgICBjb25zdCBndyA9IEdSSURfQ09MUyAqIEdSSURfU1AgKyAzLjIsIGdoID0gR1JJRF9ST1dTICogR1JJRF9TUCArIDAuNTsgICAgICAgICAgICAgICAgLy8gdGhlIHdpZHRoIGFsc28gbGVhdmVzIHJvb20gZm9yIHRoZSBOZWNyb21hbmNlciBiZXNpZGUgdGhlIGdyaWRcbiAgICBjb25zdCBkMiA9IE1hdGgubWF4KGdoIC8gKDIgKiB0YW5WICogYmFuZCksIGd3IC8gKDIgKiB0YW5WICogYXNwICogMC44OCksIDQuNSk7XG4gICAgY29uc3Qgc2hpZnQgPSAoMC41IC0gY2VudGVyRnJhYykgKiAyICogZDIgKiB0YW5WLCBieCA9IGN4IC0gMC42O1xuICAgIGNvbnN0IGJ1aWxkID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIGQyLCAtc2hpZnQgLSAwLjEgKiBkMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMyhieCwgMCwgLXNoaWZ0KSB9O1xuICAgIGNvbnN0IG5lY3JvID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYmF0dGxlLnBvcy54IC0gMS40LCBiYXR0bGUucG9zLnkgKiAxLjEyLCBiYXR0bGUucG9zLnogKiAxLjEyKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLjQsIDAuMzUsIDApIH07ICAgLy8gcmVzdWx0IGN1dHNjZW5lczogaGltIGFuZCB0aGUgZmllbGRcbiAgICByZXR1cm4geyBiYXR0bGUsIGJ1aWxkLCBuZWNybyB9O1xuICB9XG4gIC8qKiBUaGUgaGFuZCAvIGluZm8gYmFyIGNhbiBjaGFuZ2Ugc2l6ZSBpbiB0aGUgYnVpbGQgcGhhc2UgKGxvbmcgYWJpbGl0eSB0ZXh0LCBtb3JlIGNhcmRzKTogcmUtZnJhbWUgc28gdGhlIGdyaWQgbmV2ZXIgaGlkZXMgYmVoaW5kIGl0LiAqL1xuICByZWZyYW1lQnVpbGQoKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgdGhpcy5jYW1UIDwgMSB8fCB0aGlzLmNpbmUgfHwgIXRoaXMuY2FudmFzKSByZXR1cm47XG4gICAgY29uc3QgcCA9IHRoaXMucG9zZXMoKS5idWlsZCwgYyA9IHRoaXMuY2FtZXJhLnBvc2l0aW9uO1xuICAgIGlmICghaXNGaW5pdGUocC5wb3MueCkgfHwgQkFCWUxPTi5WZWN0b3IzLkRpc3RhbmNlKGMsIHAucG9zKSA8IDAuMDYpIHJldHVybjtcbiAgICB0aGlzLnR3ZWVuQ2FtKHAsIDAuMzUpO1xuICB9XG4gIHByaXZhdGUgY2FudmFzITogSFRNTENhbnZhc0VsZW1lbnQ7IHByaXZhdGUgbGFzdFcgPSAwOyBwcml2YXRlIGxhc3RIID0gMDsgbGFzdFRhcEluZm8gPSAnKG5vIHRhcHMgeWV0KSc7XG4gIHByaXZhdGUgaGFuZGxlUmVzaXplKCkge1xuICAgIGlmICghdGhpcy5jYW52YXMuY2xpZW50V2lkdGggfHwgIXRoaXMuY2FudmFzLmNsaWVudEhlaWdodCkgcmV0dXJuOyAgIC8vIGhpZGRlbiBiZWhpbmQgYW5vdGhlciB0YWJcbiAgICB0aGlzLmVuZ2luZS5yZXNpemUoKTsgdGhpcy5sYXN0VyA9IHRoaXMuY2FudmFzLmNsaWVudFdpZHRoOyB0aGlzLmxhc3RIID0gdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnICYmIHRoaXMuY2FtVCA+PSAxKSB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpO1xuICB9XG4gIC8qKiBBIHRhcCBvbiB0aGUgM0QgdmlldzogcGljayBhIHRpbGUgb3IgYSB1bml0LiAqL1xuICBwcml2YXRlIHRhcCh4OiBudW1iZXIsIHk6IG51bWJlcikge1xuICAgIGNvbnN0IHAgPSB0aGlzLnNjZW5lLnBpY2soeCwgeSwgKG06IGFueSkgPT4gISEobS5tZXRhZGF0YSAmJiBtLm1ldGFkYXRhLmtpbmQpKTtcbiAgICBjb25zdCBtZCA9IHAgJiYgcC5oaXQgPyBwLnBpY2tlZE1lc2gubWV0YWRhdGEgOiBudWxsO1xuICAgIHRoaXMubGFzdFRhcEluZm8gPSBgdGFwICR7TWF0aC5yb3VuZCh4KX0sJHtNYXRoLnJvdW5kKHkpfSBvZiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gLT4gJHttZCA/IChtZC5raW5kID09PSAndGlsZScgPyAndGlsZSAnICsgbWQuY2VsbCA6ICd1bml0JykgOiAnbm90aGluZyd9IChwaGFzZSAke3RoaXMucGhhc2V9KWA7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgIW1kKSByZXR1cm47XG4gICAgaWYgKG1kLmtpbmQgPT09ICd0aWxlJykgdGhpcy5vblRpbGUobWQuY2VsbCk7IGVsc2UgaWYgKG1kLmtpbmQgPT09ICd1bml0JykgdGhpcy5vblVuaXRWaXN1YWwobWQudmlzdWFsKTtcbiAgfVxuICBwcml2YXRlIHNldENhbShwOiBhbnkpIHsgdGhpcy5jYW1lcmEucG9zaXRpb24uY29weUZyb20ocC5wb3MpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQocC50Z3QuY2xvbmUoKSk7IH1cbiAgcHJpdmF0ZSB0d2VlbkNhbSh0bzogYW55LCBkdXI6IG51bWJlcikgeyB0aGlzLmNhbUZyb20gPSB7IHBvczogdGhpcy5jYW1lcmEucG9zaXRpb24uY2xvbmUoKSwgdGd0OiB0aGlzLmNhbWVyYS5nZXRUYXJnZXQoKS5jbG9uZSgpIH07IHRoaXMuY2FtVG8gPSB0bzsgdGhpcy5jYW1UID0gMDsgdGhpcy5jYW1EdXIgPSBkdXI7IH1cblxuICAvLyAtLS0tIGJhdHRsZSBjYW1lcmE6IGZvbGxvd3MgdGhlIGZpZ2h0ZXJzIHRoYXQgYXJlIHN0aWxsIGFsaXZlLCBzbyB0aGUgYWN0aW9uIChhbmQgdGhlIHB1cnBsZSBleWVzKSBzdGF5cyBsYXJnZSBvbiBzY3JlZW5cbiAgY2FtTW9kZTogJ2Nsb3NlJyB8ICd3aWRlJyA9ICdjbG9zZSc7IHByaXZhdGUgY2FtVGd0OiBhbnkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgMCk7XG4gIHNldENhbU1vZGUobTogJ2Nsb3NlJyB8ICd3aWRlJykge1xuICAgIHRoaXMuY2FtTW9kZSA9IG07XG4gICAgaWYgKG0gPT09ICd3aWRlJyAmJiB0aGlzLmJhdHRsZSkgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAwLjkpO1xuICAgIHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcHJpdmF0ZSBmcmFtZUJhdHRsZShkdDogbnVtYmVyKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlOyBpZiAoIWIpIHJldHVybjsgY29uc3QgYWxpdmUgPSBiLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSk7IGlmICghYWxpdmUubGVuZ3RoKSByZXR1cm47XG4gICAgbGV0IHgwID0gMWU5LCB4MSA9IC0xZTksIHowID0gMWU5LCB6MSA9IC0xZTk7IGZvciAoY29uc3QgZiBvZiBhbGl2ZSkgeyB4MCA9IE1hdGgubWluKHgwLCBmLngpOyB4MSA9IE1hdGgubWF4KHgxLCBmLngpOyB6MCA9IE1hdGgubWluKHowLCBmLnopOyB6MSA9IE1hdGgubWF4KHoxLCBmLnopOyB9XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3Qgd2lkZSA9IHRoaXMucG9zZXMoKS5iYXR0bGUsIGN4ID0gKHgwICsgeDEpIC8gMiwgY3ogPSAoejAgKyB6MSkgLyAyO1xuICAgIGNvbnN0IGQgPSBNYXRoLm1pbihNYXRoLm1heCgoeDEgLSB4MCArIDMuNCkgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjkpLCAoejEgLSB6MCArIDMuMikgLyAoMiAqIHRhblYgKiAwLjYyKSwgNS40KSwgTWF0aC5oeXBvdCh3aWRlLnBvcy55LCB3aWRlLnBvcy56KSk7XG4gICAgY29uc3QgdGd0ID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCwgMC41NSwgY3opLCBwb3MgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4IC0gMC4wNiAqIGQsIDAuMzIgKiBkICsgMC41LCBjeiAtIDAuOSAqIGQpO1xuICAgIGNvbnN0IGsgPSAxIC0gTWF0aC5leHAoLWR0ICogMi4wKTtcbiAgICB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtZXJhLnBvc2l0aW9uLCBwb3MsIGspOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtVGd0LCB0Z3QsIGspOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzdGFnZSBmbG93XG4gIC8qKiBXcml0ZSB0aGUgcnVuIHRvIGRpc2sgKGNhbG0gbW9tZW50cyBvbmx5OiBidWlsZCBwaGFzZSBhbmQgdGhlIHZpY3RvcnkgZHJhZnQpLiAqL1xuICBwcml2YXRlIHBlcnNpc3RSdW4oKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHMgPSB0aGlzLnM7IGlmICghcykgcmV0dXJuO1xuICAgICAgaWYgKHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSB7IGNsZWFyUnVuKCk7IHJldHVybjsgfVxuICAgICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgJiYgdGhpcy5waGFzZSAhPT0gJ2RyYWZ0JykgcmV0dXJuO1xuICAgICAgY29uc3Qgc25hcDogUnVuU25hcHNob3QgPSB7IHY6IDEsIHNlZWQ6IHRoaXMuc2VlZCwgYXR0ZW1wdDogdGhpcy5hdHRlbXB0LCBzdGFnZTogY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHk6IGRpZmZpY3VsdHlOYW1lLCBwaGFzZTogdGhpcy5waGFzZSwgZHJhZnQ6IHRoaXMucGhhc2UgPT09ICdkcmFmdCcgPyB0aGlzLmRyYWZ0IDogbnVsbCwgc3RhdGU6IHNlcmlhbGl6ZVN0YXRlKHMpLCBzdGFydEJlc3Q6IHRoaXMuZW5kbGVzcz8uc3RhcnRCZXN0IH07XG4gICAgICBzYXZlUnVuKHNuYXApO1xuICAgIH0gY2F0Y2ggeyAvKiBuZXZlciBsZXQgc2F2aW5nIGJyZWFrIHRoZSBnYW1lICovIH1cbiAgfVxuICAvKiogUmVidWlsZCB0aGUgc2NyZWVuIGZyb20gYSBzYXZlZCBydW4gKGEgcmVsb2FkLCBvciBTYWZhcmkgZGlzY2FyZGluZyB0aGUgcGFnZSkuICovXG4gIHByaXZhdGUgcmVzdG9yZShyOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSkge1xuICAgIGNvbnN0IHsgc25hcCwgc3RhdGUgfSA9IHI7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMuZmx1c2hUd2VlbnMoKTsgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICB0aGlzLmRhaWx5ID0gbnVsbDtcbiAgICBpZiAoc25hcC5zdGFnZSA9PT0gREFJTFlfSUQgJiYgaXNWYWxpZERheSgrc25hcC5kaWZmaWN1bHR5KSkgeyBjb25zdCBkYXkgPSArc25hcC5kaWZmaWN1bHR5LCBtb2QgPSBtb2RpZmllckZvcihkYXkpOyBzZXREYWlseShtb2QsIGRheSk7IHRoaXMuZGFpbHkgPSB7IGRheSwgbW9kIH07IHRoaXMuZW5kbGVzcyA9IG51bGw7IHRoaXMuYXJlbmEuc2V0VGhlbWUoJ2NyeXB0Jyk7IH1cbiAgICBlbHNlIGlmIChzbmFwLnN0YWdlID09PSBFTkRMRVNTX0lEKSB7IHNldEVuZGxlc3MoKTsgY29uc3QgZG9uZSA9IE1hdGgubWF4KDAsIHN0YXRlLndhdmUgLSAxKTsgdGhpcy5lbmRsZXNzID0geyBzdGFydEJlc3Q6IHNuYXAuc3RhcnRCZXN0ID8/IGxvYWRTYXZlKCkuZW5kbGVzcy5iZXN0LCBjbGVhcmVkOiBkb25lLCBwYWNrczogTWF0aC5mbG9vcihkb25lIC8gRU5ETEVTU19QQUNLX0VWRVJZKSB9OyB9IGVsc2UgeyBzZXRTdGFnZURpZmZpY3VsdHkoc25hcC5zdGFnZSwgc25hcC5kaWZmaWN1bHR5KTsgdGhpcy5lbmRsZXNzID0gbnVsbDsgfVxuICAgIGlmICghdGhpcy5kYWlseSkgdGhpcy5hcmVuYS5zZXRUaGVtZShjdXJyZW50U3RhZ2VJZCk7XG4gICAgdGhpcy5zZWVkID0gc25hcC5zZWVkOyB0aGlzLmF0dGVtcHQgPSBzbmFwLmF0dGVtcHQ7IHRoaXMucyA9IHN0YXRlOyB0aGlzLnNlZW5NZXJnZXMgPSBzdGF0ZS5zdGF0cy5tZXJnZXM7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gc25hcC5waGFzZSA9PT0gJ2RyYWZ0JyA/IHNuYXAuZHJhZnQgOiBudWxsOyB0aGlzLnBoYXNlID0gdGhpcy5kcmFmdCA/ICdkcmFmdCcgOiAnYnVpbGQnOyB0aGlzLnNob3dHcmlkKHRoaXMucGhhc2UgPT09ICdidWlsZCcpO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7IHRoaXMudG9hc3QoYFJ1biByZXN0b3JlZDogd2F2ZSAke2lzRW5kbGVzcygpID8gc3RhdGUud2F2ZSA6IHN0YXRlLndhdmUgKyAnLycgKyBzdGFnZVdhdmVzKHN0YXRlKX0sICR7c3RhdGUuaGVhcnRzfSBoZWFydCR7c3RhdGUuaGVhcnRzID09PSAxID8gJycgOiAncyd9LmApO1xuICB9XG5cbiAgLy8gLS0tLSBwZXJmb3JtYW5jZSByZWFkb3V0OiByb2xsaW5nIGZyYW1lIHN0YXRzLCBwZXItYmF0dGxlIHN1bW1hcmllcywgb3B0aW9uYWwgb24tc2NyZWVuIEZQUywgYW5kIGEgcGFzdGUtZnJpZW5kbHkgcmVwb3J0XG4gIHNob3dGcHMgPSBmYWxzZTsgcGVyZk5vdyA9IHsgZnBzOiAwLCBhdmc6IDAsIHA5NTogMCwgd29yc3Q6IDAgfTsgcGVyZkxvZzogYW55W10gPSBbXTtcbiAgcHJpdmF0ZSBwZXJmQnVmID0gbmV3IEZsb2F0MzJBcnJheSgyNDApOyBwcml2YXRlIHBlcmZOID0gMDsgcHJpdmF0ZSBwZXJmSSA9IDA7IHByaXZhdGUgcGVyZlNob3duQXQgPSAwOyBwcml2YXRlIGluc3RyOiBhbnkgPSBudWxsOyBwcml2YXRlIGZwc0h1ZDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjdXJCYXR0bGU6IHsgZnJhbWVzOiBudW1iZXI7IHN1bTogbnVtYmVyOyB3b3JzdDogbnVtYmVyOyBzbG93OiBudW1iZXI7IHNjYWxlOiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xuICBzZXRTaG93RnBzKG9uOiBib29sZWFuKSB7XG4gICAgdGhpcy5zaG93RnBzID0gb247XG4gICAgaWYgKG9uICYmICF0aGlzLmZwc0h1ZCkgeyBjb25zdCBoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGguaWQgPSAnZnBzSHVkJzsgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdiYXR0bGVIb3N0JykgfHwgZG9jdW1lbnQuYm9keSkuYXBwZW5kQ2hpbGQoaCk7IHRoaXMuZnBzSHVkID0gaDsgfVxuICAgIGlmICh0aGlzLmZwc0h1ZCkgdGhpcy5mcHNIdWQuc3R5bGUuZGlzcGxheSA9IG9uID8gJ2Jsb2NrJyA6ICdub25lJztcbiAgfVxuICBwcml2YXRlIHBlcmZUaWNrKG1zOiBudW1iZXIpIHtcbiAgICBpZiAobXMgPiA1MDApIHJldHVybjsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHRhYiB3YXMgaGlkZGVuIG9yIHRoZSBwaG9uZSBwYXVzZWQgdXM6IG5vdCBhIHJlYWwgZnJhbWVcbiAgICB0aGlzLnBlcmZCdWZbdGhpcy5wZXJmSV0gPSBtczsgdGhpcy5wZXJmSSA9ICh0aGlzLnBlcmZJICsgMSkgJSB0aGlzLnBlcmZCdWYubGVuZ3RoOyB0aGlzLnBlcmZOID0gTWF0aC5taW4odGhpcy5wZXJmQnVmLmxlbmd0aCwgdGhpcy5wZXJmTiArIDEpO1xuICAgIGNvbnN0IGMgPSB0aGlzLmN1ckJhdHRsZTtcbiAgICBpZiAoYyAmJiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgfHwgdGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nKSkgeyBjLmZyYW1lcysrOyBjLnN1bSArPSBtczsgaWYgKG1zID4gYy53b3JzdCkgYy53b3JzdCA9IG1zOyBpZiAobXMgPiAzMy40KSBjLnNsb3crKzsgYy5zY2FsZSA9IE1hdGgubWF4KGMuc2NhbGUsIHRoaXMudGltZVNjYWxlKTsgfVxuICAgIGNvbnN0IG5vdyA9IHBlcmZvcm1hbmNlLm5vdygpOyBpZiAobm93IC0gdGhpcy5wZXJmU2hvd25BdCA8IDUwMCkgcmV0dXJuOyB0aGlzLnBlcmZTaG93bkF0ID0gbm93O1xuICAgIGNvbnN0IGEgPSBBcnJheS5mcm9tKHRoaXMucGVyZkJ1Zi5zdWJhcnJheSgwLCB0aGlzLnBlcmZOKSkuc29ydCgoeCwgeSkgPT4geCAtIHkpLCBhdmcgPSBhLnJlZHVjZSgobiwgeCkgPT4gbiArIHgsIDApIC8gYS5sZW5ndGg7XG4gICAgdGhpcy5wZXJmTm93ID0geyBmcHM6IDEwMDAgLyBhdmcsIGF2ZywgcDk1OiBhW01hdGguZmxvb3IoYS5sZW5ndGggKiAwLjk1KV0gPz8gMCwgd29yc3Q6IGFbYS5sZW5ndGggLSAxXSA/PyAwIH07XG4gICAgaWYgKHRoaXMuZnBzSHVkICYmIHRoaXMuc2hvd0ZwcykgdGhpcy5mcHNIdWQudGV4dENvbnRlbnQgPSBgJHt0aGlzLnBlcmZOb3cuZnBzLnRvRml4ZWQoMCl9IGZwcyAgJHt0aGlzLnBlcmZOb3cuYXZnLnRvRml4ZWQoMSl9bXMgIHNsb3c1JSAke3RoaXMucGVyZk5vdy5wOTUudG9GaXhlZCgwKX1tc2A7XG4gICAgdGhpcy51aS5yZW5kZXJEZWJ1Z0xpdmUoKTtcbiAgfVxuICBwcml2YXRlIGJlZ2luQmF0dGxlUGVyZigpIHsgdGhpcy5jdXJCYXR0bGUgPSB7IGZyYW1lczogMCwgc3VtOiAwLCB3b3JzdDogMCwgc2xvdzogMCwgc2NhbGU6IHRoaXMudGltZVNjYWxlIH07IH1cbiAgcHJpdmF0ZSBlbmRCYXR0bGVQZXJmKCkge1xuICAgIGNvbnN0IGMgPSB0aGlzLmN1ckJhdHRsZTsgdGhpcy5jdXJCYXR0bGUgPSBudWxsOyBpZiAoIWMgfHwgIWMuZnJhbWVzKSByZXR1cm47XG4gICAgdGhpcy5wZXJmTG9nLnB1c2goeyB3YXZlOiB0aGlzLnMud2F2ZSwgYXR0ZW1wdDogdGhpcy5hdHRlbXB0LCBzcGVlZDogYy5zY2FsZSwgZmlnaHRlcnM6IHRoaXMuYmF0dGxlID8gdGhpcy5iYXR0bGUuZmlnaHRlcnMubGVuZ3RoIDogMCwgZnBzOiArKDEwMDAgLyAoYy5zdW0gLyBjLmZyYW1lcykpLnRvRml4ZWQoMCksIHdvcnN0TXM6ICtjLndvcnN0LnRvRml4ZWQoMCksIHNsb3dQY3Q6ICsoKDEwMCAqIGMuc2xvdykgLyBjLmZyYW1lcykudG9GaXhlZCgxKSB9KTtcbiAgICBpZiAodGhpcy5wZXJmTG9nLmxlbmd0aCA+IDEyKSB0aGlzLnBlcmZMb2cuc2hpZnQoKTtcbiAgfVxuICBwZXJmSW5mbygpIHtcbiAgICBjb25zdCBzYyA9IHRoaXMuc2NlbmU7IGlmICghdGhpcy5pbnN0ciAmJiBCQUJZTE9OLlNjZW5lSW5zdHJ1bWVudGF0aW9uKSB0aGlzLmluc3RyID0gbmV3IEJBQllMT04uU2NlbmVJbnN0cnVtZW50YXRpb24oc2MpO1xuICAgIHJldHVybiB7IC4uLnRoaXMucGVyZk5vdywgbWVzaGVzOiBzYy5nZXRBY3RpdmVNZXNoZXMoKS5sZW5ndGgsIHBhcnRpY2xlczogc2MucGFydGljbGVTeXN0ZW1zLmxlbmd0aCwgZHJhd3M6IHRoaXMuaW5zdHIgPyB0aGlzLmluc3RyLmRyYXdDYWxsc0NvdW50ZXIuY3VycmVudCA6IC0xIH07XG4gIH1cbiAgcGVyZlJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHAgPSB0aGlzLnBlcmZJbmZvKCksIGdsOiBhbnkgPSB0aGlzLmVuZ2luZS5nZXRHbEluZm8gPyB0aGlzLmVuZ2luZS5nZXRHbEluZm8oKSA6IHt9O1xuICAgIGNvbnN0IHJvd3MgPSB0aGlzLnBlcmZMb2cubWFwKChyKSA9PiBgICB3YXZlICR7ci53YXZlfSB0cnkgJHtyLmF0dGVtcHR9IGF0ICR7ci5zcGVlZH14OiAke3IuZnBzfSBmcHMgYXZlcmFnZSwgd29yc3QgZnJhbWUgJHtyLndvcnN0TXN9bXMsICR7ci5zbG93UGN0fSUgc2xvdyBmcmFtZXMsICR7ci5maWdodGVyc30gZmlnaHRlcnNgKTtcbiAgICByZXR1cm4gW2BQRVJGICR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpfWAsIGBkZXZpY2U6ICR7bmF2aWdhdG9yLnVzZXJBZ2VudH1gLCBgZ3B1OiAke2dsLnJlbmRlcmVyIHx8ICc/J30gKCR7Z2wudmVuZG9yIHx8ICc/J30pYCxcbiAgICAgIGBzY3JlZW4gJHtzY3JlZW4ud2lkdGh9eCR7c2NyZWVuLmhlaWdodH0gIHZpZXdwb3J0ICR7aW5uZXJXaWR0aH14JHtpbm5lckhlaWdodH0gIGRwciAke2RldmljZVBpeGVsUmF0aW99ICByZW5kZXIgJHt0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpfXgke3RoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpfSAgc2NhbGluZyBsZXZlbCAke3RoaXMuZW5naW5lLmdldEhhcmR3YXJlU2NhbGluZ0xldmVsKCkudG9GaXhlZCgyKX1gLFxuICAgICAgYG5vdzogJHtwLmZwcy50b0ZpeGVkKDApfSBmcHMsIGF2ZXJhZ2UgJHtwLmF2Zy50b0ZpeGVkKDEpfW1zLCBzbG93ZXN0IDUlICR7cC5wOTUudG9GaXhlZCgwKX1tcywgd29yc3QgJHtwLndvcnN0LnRvRml4ZWQoMCl9bXMgfCBhY3RpdmUgbWVzaGVzICR7cC5tZXNoZXN9LCBwYXJ0aWNsZSBzeXN0ZW1zICR7cC5wYXJ0aWNsZXN9LCBkcmF3IGNhbGxzICR7cC5kcmF3c31gLFxuICAgICAgYHN0YXRlOiBwaGFzZSAke3RoaXMucGhhc2V9LCBzcGVlZCAke3RoaXMudGltZVNjYWxlfXgsIGNhbWVyYSAke3RoaXMuY2FtTW9kZX0sIGRpZmZpY3VsdHkgJHtkaWZmaWN1bHR5TmFtZX0sIHdhdmUgJHt0aGlzLnMud2F2ZX0sIHVuaXRzICR7dGhpcy5zLnVuaXRzLmxlbmd0aH1gLFxuICAgICAgYGJhdHRsZXMgKG5ld2VzdCBsYXN0KTpgLCAuLi4ocm93cy5sZW5ndGggPyByb3dzIDogWycgIChub25lIHlldDogcGxheSBhIGJhdHRsZSwgdGhlbiBjb3B5IHRoaXMgYWdhaW4pJ10pXS5qb2luKCdcXG4nKTtcbiAgfVxuXG4gIC8qKiBBIHJ1biB0aGUgcGxheWVyIGhhcyByZWFsbHkgc3RhcnRlZCAoc28gSG9tZSBjYW4gb2ZmZXIgQ29udGludWUpLiBOdWxsIGFmdGVyIGEgc3RhZ2Ugd2FzIHdvbiBvciBsb3N0LCBvciBiZWZvcmUgYW55dGhpbmcgd2FzIGRvbmUuICovXG4gIHJ1bkluZm8oKSB7IGNvbnN0IHMgPSB0aGlzLnM7IGlmICghcyB8fCBzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuIG51bGw7IHJldHVybiAocy53YXZlID4gMSB8fCBzLnVuaXRzLmxlbmd0aCA+IDAgfHwgdGhpcy5hdHRlbXB0ID4gMCB8fCBzLnN0YXRzLmZhaWx1cmVzID4gMCkgPyB7IHdhdmU6IHMud2F2ZSwgdG90YWw6IHN0YWdlV2F2ZXMocyksIGhlYXJ0czogcy5oZWFydHMsIGRpZmZpY3VsdHk6IGRpZmZpY3VsdHlOYW1lLCBzdGFnZTogY3VycmVudFN0YWdlSWQgfSA6IG51bGw7IH1cbiAgLyoqIEZyZXNoIHJ1biB3aXRoIHRoZSBjdXJyZW50bHkgZXF1aXBwZWQgU291bCBEZWNrIChIb21lID4gU3RhcnQgQmF0dGxlIGNhbGxzIHRoaXMpLiAqL1xuICAvKiogR2l2ZSB1cCB0aGUgcnVuIGluIHByb2dyZXNzIChIb21lID4gTmV3IGJhdHRsZSwgYWZ0ZXIgdGhlIHBsYXllciBjb25maXJtcyk6IHRoZSBzYXZlZCBydW4gaXMgZHJvcHBlZCBhbmQgSG9tZSBsZXRzIHRoZW0gcGljayBhbnkgc3RhZ2Ugb3IgbW9kZS4gR29sZCBhbmQgcGFja3MgYWxyZWFkeSBlYXJuZWQgc3RheS4gKi9cbiAgYWJhbmRvblJ1bigpIHsgdGhpcy5zdGFydFN0YWdlKE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgY2xlYXJSdW4oKTsgfVxuICBuZXdSdW4oKSB7IHRoaXMuc3RhcnRTdGFnZShuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdzZWVkJykgPyB0aGlzLnNlZWQgOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IH1cbiAgc3RhcnRTdGFnZShzZWVkOiBudW1iZXIpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5yZXdhcmQgPSBudWxsOyB0aGlzLmZsdXNoVHdlZW5zKCk7IGlmICh0aGlzLm5lY3JvKSB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIHRoaXMucnVuR29sZCA9IDA7IHRoaXMubGFzdEdvbGQgPSAwOyB0aGlzLmRhaWx5ID0gbnVsbDsgdGhpcy5kYWlseVJld2FyZCA9IG51bGw7IHRoaXMuc2VlZCA9IHNlZWQ7IHRoaXMuYXR0ZW1wdCA9IDA7IHRoaXMuZW5kbGVzcyA9IG51bGw7IGNvbnN0IHN2ID0gbG9hZFNhdmUoKSwgcGwgPSBwbGF5YWJsZShzdik7IHNldFN0YWdlRGlmZmljdWx0eShwbC5zdGFnZSwgcGwuZGlmZmljdWx0eSk7IHRoaXMuYXJlbmEuc2V0VGhlbWUoY3VycmVudFN0YWdlSWQpOyB0aGlzLnMgPSBuZXdTdGFnZSh7IC4uLlBST1RPVFlQRV9SVUxFUywgcG9vbDogc3YuZGVjayB9LCBzZWVkKTsgdGhpcy5zZWVuTWVyZ2VzID0gMDtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7ICAgLy8gKGEgYmF0dGxlIGxlZnQgaGFsZi13YXkgaGFkIGhpZGRlbiB0aGUgZ3JpZClcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IG51bGw7IHRoaXMucGhhc2UgPSAnYnVpbGQnO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7IHRoaXMudG9hc3QoJ1N0YWdlIHN0YXJ0OiA0IGNhcmRzLCAnICsgdGhpcy5zLmNhcCArICcgRG9taW5pb24uIFN1bW1vbiwgbWVyZ2UsIHRoZW4gcHJlc3MgQkFUVExFLicpO1xuICB9XG4gIC8qKiBUb2RheSdzIERhaWx5IENoYWxsZW5nZSAoSG9tZSA+IERhaWx5IENoYWxsZW5nZSk6IHRoZSBzYW1lIHNlZWQgYW5kIHR3aXN0IGZvciBldmVyeW9uZSBvbiB0aGUgc2FtZSBkYXkuIFJldHJ5IGFzIG9mdGVuIGFzIHlvdSBsaWtlOyB0aGUgcmV3YXJkIGlzIHBhaWQgb25jZS4gKi9cbiAgbmV3RGFpbHkoKSB7IHRoaXMuc3RhcnREYWlseShkYXlOdW1iZXIoKSk7IH1cbiAgc3RhcnREYWlseShkYXk6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgY29uc3QgbW9kID0gbW9kaWZpZXJGb3IoZGF5KSwgc3YgPSBsb2FkU2F2ZSgpOyBzZXREYWlseShtb2QsIGRheSk7IHRoaXMuYXJlbmEuc2V0VGhlbWUoJ2NyeXB0Jyk7XG4gICAgdGhpcy5ydW5Hb2xkID0gMDsgdGhpcy5sYXN0R29sZCA9IDA7IHRoaXMuZGFpbHlSZXdhcmQgPSBudWxsOyB0aGlzLmVuZGxlc3MgPSBudWxsOyB0aGlzLmRhaWx5ID0geyBkYXksIG1vZCB9OyB0aGlzLnNlZWQgPSBkYXk7IHRoaXMuYXR0ZW1wdCA9IDA7XG4gICAgdGhpcy5zID0gbmV3U3RhZ2UoZGFpbHlSdWxlcyhtb2QsIHN2LmRlY2spLCB0aGlzLnNlZWQpOyB0aGlzLnNlZW5NZXJnZXMgPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgdGhpcy5zaG93R3JpZCh0cnVlKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IG51bGw7IHRoaXMucGhhc2UgPSAnYnVpbGQnO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7IHRoaXMudG9hc3QoYERhaWx5IENoYWxsZW5nZTogJHttb2QubmFtZX0uICR7bW9kLnRleHR9YCk7XG4gIH1cbiAgLyoqIEZyZXNoIEVuZGxlc3MgRGVwdGhzIHJ1biAoSG9tZSA+IEVuZGxlc3MgRGVwdGhzIGNhbGxzIHRoaXMpOiBzYW1lIHJ1bGVzIGFzIGEgc3RhZ2UsIGJ1dCB0aGUgd2F2ZXMgbmV2ZXIgc3RvcCBhbmQgdGhlIGVuZW15IGtlZXBzIGdyb3dpbmcuICovXG4gIG5ld0VuZGxlc3MoKSB7IHRoaXMuc3RhcnRFbmRsZXNzKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydEVuZGxlc3Moc2VlZDogbnVtYmVyKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucmV3YXJkID0gbnVsbDsgdGhpcy5mbHVzaFR3ZWVucygpOyBpZiAodGhpcy5uZWNybykgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICB0aGlzLnJ1bkdvbGQgPSAwOyB0aGlzLmxhc3RHb2xkID0gMDsgdGhpcy5kYWlseSA9IG51bGw7IHRoaXMuZGFpbHlSZXdhcmQgPSBudWxsOyB0aGlzLnNlZWQgPSBzZWVkOyB0aGlzLmF0dGVtcHQgPSAwOyBjb25zdCBzdiA9IGxvYWRTYXZlKCk7IHNldEVuZGxlc3MoKTsgdGhpcy5hcmVuYS5zZXRUaGVtZShFTkRMRVNTX0lEKTtcbiAgICB0aGlzLmVuZGxlc3MgPSB7IHN0YXJ0QmVzdDogc3YuZW5kbGVzcy5iZXN0LCBjbGVhcmVkOiAwLCBwYWNrczogMCB9O1xuICAgIHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uRU5ETEVTU19SVUxFUywgcG9vbDogc3YuZGVjayB9LCBzZWVkKTsgdGhpcy5zZWVuTWVyZ2VzID0gMDtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7ICAgLy8gKGEgYmF0dGxlIGxlZnQgaGFsZi13YXkgaGFkIGhpZGRlbiB0aGUgZ3JpZClcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IG51bGw7IHRoaXMucGhhc2UgPSAnYnVpbGQnO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7IHRoaXMudG9hc3QoJ0VuZGxlc3MgRGVwdGhzOiBob3cgZGVlcCBjYW4geW91IGdvPyBBIFNvdWwgUGFjayBldmVyeSAxMCB3YXZlcy4nKTtcbiAgfVxuICBwcml2YXRlIGNsZWFyQmF0dGxlKCkge1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi5kaXNwb3NlKCk7IH0pOyB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpOyB0aGlzLmJhdHRsZSA9IG51bGw7XG4gICAgdGhpcy5hcnJvd3MuZm9yRWFjaCgoYSkgPT4gYS5tZXNoLmRpc3Bvc2UoKSk7IHRoaXMuYXJyb3dzID0gW107XG4gIH1cbiAgcHJpdmF0ZSBwb3MoY2VsbDogbnVtYmVyKSB7IHJldHVybiBjZWxsUG9zKDAsIGNlbGwpOyB9XG4gIC8qKiBGb3IgdGhlIHR1dG9yaWFsIHNwb3RsaWdodDogd2hlcmUgYW4gZW1wdHkgdGlsZSAodGhlIG9uZSBuZWFyZXN0IHRoZSBtaWRkbGUgb2YgdGhlIGdyaWQpIGlzIG9uIHRoZSBzY3JlZW4sIGluIENTUyBwaXhlbHMsIG9yIG51bGwuICovXG4gIGVtcHR5VGlsZVJlY3QoKTogeyB4OiBudW1iZXI7IHk6IG51bWJlcjsgdzogbnVtYmVyOyBoOiBudW1iZXIgfSB8IG51bGwge1xuICAgIGlmICghdGhpcy5zIHx8ICF0aGlzLmNhbnZhcyB8fCB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCB1c2VkID0gbmV3IFNldCh0aGlzLnMudW5pdHMubWFwKCh1OiBhbnkpID0+IHUuY2VsbCkpOyBsZXQgbXggPSAwLCBteiA9IDA7IGNvbnN0IGFsbCA9IEFycmF5LmZyb20oeyBsZW5ndGg6IEdSSURfQ0VMTFMgfSwgKF8sIGMpID0+IHRoaXMucG9zKGMpKTsgYWxsLmZvckVhY2goKHApID0+IHsgbXggKz0gcC54IC8gR1JJRF9DRUxMUzsgbXogKz0gcC56IC8gR1JJRF9DRUxMUzsgfSk7XG4gICAgbGV0IGJlc3QgPSAtMSwgYmQgPSAxZTk7IGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB7IGlmICh1c2VkLmhhcyhjKSkgY29udGludWU7IGNvbnN0IGQgPSBNYXRoLmh5cG90KGFsbFtjXS54IC0gbXgsIGFsbFtjXS56IC0gbXopOyBpZiAoZCA8IGJkKSB7IGJkID0gZDsgYmVzdCA9IGM7IH0gfVxuICAgIGlmIChiZXN0IDwgMCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcCA9IGFsbFtiZXN0XSwgaCA9IEdSSURfU1AgKiAwLjQ2LCBXID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSwgSCA9IHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB2cCA9IHRoaXMuY2FtZXJhLnZpZXdwb3J0LnRvR2xvYmFsKFcsIEgpLCBtID0gdGhpcy5zY2VuZS5nZXRUcmFuc2Zvcm1NYXRyaXgoKTtcbiAgICBjb25zdCBwdHMgPSBbWy1oLCAtaF0sIFtoLCAtaF0sIFtoLCBoXSwgWy1oLCBoXV0ubWFwKChbZHgsIGR6XSkgPT4gQkFCWUxPTi5WZWN0b3IzLlByb2plY3QobmV3IEJBQllMT04uVmVjdG9yMyhwLnggKyBkeCwgMC4wMiwgcC56ICsgZHopLCBCQUJZTE9OLk1hdHJpeC5JZGVudGl0eSgpLCBtLCB2cCkpO1xuICAgIGNvbnN0IHIgPSB0aGlzLmNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKSwga3ggPSByLndpZHRoIC8gVywga3kgPSByLmhlaWdodCAvIEgsIHhzID0gcHRzLm1hcCgocTogYW55KSA9PiBxLngpLCB5cyA9IHB0cy5tYXAoKHE6IGFueSkgPT4gcS55KTtcbiAgICBjb25zdCB4MCA9IE1hdGgubWluKC4uLnhzKSwgeDEgPSBNYXRoLm1heCguLi54cyksIHkwID0gTWF0aC5taW4oLi4ueXMpLCB5MSA9IE1hdGgubWF4KC4uLnlzKTtcbiAgICBpZiAoIWlzRmluaXRlKHgwICsgeDEgKyB5MCArIHkxKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHsgeDogci5sZWZ0ICsgeDAgKiBreCwgeTogci50b3AgKyB5MCAqIGt5LCB3OiAoeDEgLSB4MCkgKiBreCwgaDogKHkxIC0geTApICoga3kgfTtcbiAgfVxuICBzeW5jQnVpbGQoKSB7XG4gICAgdGhpcy5wZXJzaXN0UnVuKCk7XG4gICAgY29uc3QgbWVyZ2VkID0gdGhpcy5zLnN0YXRzLm1lcmdlcyA+IHRoaXMuc2Vlbk1lcmdlczsgdGhpcy5zZWVuTWVyZ2VzID0gdGhpcy5zLnN0YXRzLm1lcmdlcztcbiAgICBjb25zdCBncm93biA9IG1lcmdlZCA/IHRoaXMucy51bml0cy5maW5kKCh1KSA9PiB7IGNvbnN0IGd2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgcmV0dXJuICEhZ3YgJiYgZ3Yuc3RhciAhPT0gdS5zdGFyOyB9KSA6IHVuZGVmaW5lZDsgICAvLyB0aGUgdW5pdCB0aGF0IGp1c3QgZ2FpbmVkIGEgc3RhclxuICAgIGNvbnN0IGFsaXZlID0gbmV3IFNldCh0aGlzLnMudW5pdHMubWFwKCh1KSA9PiB1LmlkKSk7XG4gICAgZm9yIChjb25zdCBbaWQsIHZdIG9mIHRoaXMudW5pdFZpcykgaWYgKCFhbGl2ZS5oYXMoaWQpKSB7XG4gICAgICB0aGlzLnZpc1RvVW5pdC5kZWxldGUodik7IHRoaXMudW5pdFZpcy5kZWxldGUoaWQpOyBjb25zdCBwID0gdi5ob2xkZXIucG9zaXRpb247XG4gICAgICBpZiAoZ3Jvd24pIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBtZXJnZTogdGhlIGNvbnN1bWVkIHVuaXQgaXMgZHJhd24gaW50byB0aGUgc3Vydml2b3IgYW5kIHZhbmlzaGVzIGluIGEgZmxhc2hcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyhncm93bi5jZWxsKSwgeDAgPSBwLngsIHowID0gcC56LCBzYyA9IHYuaG9sZGVyLnNjYWxpbmcueDsgdi5wbGF5KCdpZGxlJyk7XG4gICAgICAgIHRoaXMudHdlZW4oMC4zMywgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjQsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwoc2MgKiAoMSAtIDAuNzUgKiB0KSk7IH0sXG4gICAgICAgICAgKCkgPT4geyB0aGlzLmJ1cnN0KHRvLngsIHRvLnosIFswLjg1LCAwLjYsIDEsIDAuOV0sIFswLjUsIDAuMywgMSwgMC43XSwgMTQpOyB2LmRpc3Bvc2UoKTsgfSk7XG4gICAgICB9IGVsc2UgeyB0aGlzLmJ1cnN0KHAueCwgcC56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDE2KTsgdi5kaXNwb3NlKCk7IH1cbiAgICB9XG4gICAgY29uc3QgbHZscyA9IGxvYWRTYXZlKCkuc291bHM7XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykge1xuICAgICAgbGV0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTtcbiAgICAgIGlmICghdikgeyB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgdS5zb3VsLCAwLCB1LnN0YXIpOyB0aGlzLnVuaXRWaXMuc2V0KHUuaWQsIHYpOyB0aGlzLnZpc1RvVW5pdC5zZXQodiwgdS5pZCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTsgYXVkaW8ucGxheSgnc3VtbW9uJyk7IGNvbnN0IHZ2ID0gdjsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcpIHZ2LnBsYXkoJ2lkbGUnKTsgfSk7IH1cbiAgICAgIGVsc2UgeyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IGlmICh2LnN0YXIgIT09IHUuc3RhcikgeyBjb25zdCBmdiA9IHY7IHYuc2V0U3Rhcih1LnN0YXIpOyB0aGlzLmxhdGVyKGdyb3duICYmIGdyb3duLmlkID09PSB1LmlkID8gMC4zMyA6IDAsICgpID0+IHRoaXMubWVyZ2VGeChmdiwgcC54LCBwLnopKTsgfSB9XG4gICAgfVxuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHsgY29uc3QgdnYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpOyBpZiAodnYgJiYgdnYuc2V0TGV2ZWwpIHZ2LnNldExldmVsKChsdmxzIGFzIGFueSlbdS5zb3VsXT8ubGV2ZWwgPz8gMSk7IH1cbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDtcbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5waGFzZSA9PT0gJ2J1aWxkJykge1xuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgY2FuU3VtbW9uKHRoaXMucywgc2VsLmlkeCkgPyAnZnJlZScgOiAnbm9ybWFsJyk7XG4gICAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VGcm9tSGFuZCh0aGlzLnMsIHNlbC5pZHgsIHUuaWQpKSB0aGlzLnRpbnQodS5jZWxsLCAncGFydG5lcicpOyAgICAgLy8gdGhlIGNhcmQgY2FuIG1lcmdlIGludG8gdGhpcyB1bml0XG4gICAgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0Jykge1xuICAgICAgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpO1xuICAgICAgaWYgKHUpIHsgdGhpcy50aW50KHUuY2VsbCwgJ3NlbCcpOyBmb3IgKGNvbnN0IG8gb2YgdGhpcy5zLnVuaXRzKSBpZiAoY2FuTWVyZ2VEZXBsb3llZCh1LCBvKSkgdGhpcy50aW50KG8uY2VsbCwgJ3BhcnRuZXInKTsgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIGlmIChjZWxsRnJlZSh0aGlzLnMsIGMpKSB0aGlzLnRpbnQoYywgJ2ZyZWUnKTsgfVxuICAgIH1cbiAgfVxuICAvKiogVGhlIG1lcmdlIG1vbWVudDogYSBmbGFzaCBvZiByaW5ncyBhbmQgc3BhcmtzLCBhIHB1bmNoIGluIHNpemUsIGEgcmlzaW5nIGNoaW1lLiAqL1xuICBwcml2YXRlIG1lcmdlRngodjogVW5pdFZpc3VhbCwgeDogbnVtYmVyLCB6OiBudW1iZXIpIHtcbiAgICBhdWRpby5wbGF5KCdtZXJnZScpOyB2LnB1bHNlKCk7IGNvbnN0IHRhcmdldCA9IHYuaG9sZGVyLnNjYWxpbmcueDtcbiAgICB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC40KSwgMC4yLCAyLjAsIDAuNjUpOyB0aGlzLmxhdGVyKDAuMTIsICgpID0+IHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC4yLCAzLjAsIDAuOCkpO1xuICAgIHRoaXMuYnVyc3QoeCwgeiwgWzEsIDAuODUsIDAuNCwgMC45XSwgWzAuOCwgMC40LCAxLCAwLjhdLCA0Nik7IHRoaXMuYnVyc3QoeCwgeiwgWzAuODUsIDAuNiwgMSwgMC45XSwgWzAuNSwgMC4zLCAxLCAwLjddLCAyNCk7XG4gICAgdGhpcy50d2VlbigwLjU1LCAodCkgPT4gdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGFyZ2V0ICogKDEgKyAwLjQ1ICogTWF0aC5zaW4odCAqIE1hdGguUEkpICogKDEgLSB0ICogMC40KSkpLCAoKSA9PiB2LmhvbGRlci5zY2FsaW5nLnNldEFsbCh0YXJnZXQpKTtcbiAgfVxuICBwcml2YXRlIHN1bW1vbkZ4KHg6IG51bWJlciwgejogbnVtYmVyKSB7IHRoaXMuYnVyc3QoeCwgeiwgWzAuNywgMC4zLCAxLCAwLjldLCBbMC4zNSwgMC4xLCAwLjcsIDAuOF0sIDMwKTsgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zLCAxKSwgMC4yLCAxLjIsIDAuNyk7IH1cblxuICAvLyAtLS0tIHBsYXllciBhY3Rpb25zIChidWlsZCBwaGFzZSlcbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgdGhpcy51aS50b2FzdChtc2cpOyB9XG4gIG9uQ2FyZChpZHg6IG51bWJlcikge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKGRpc2NhcmRSZWRyYXcodGhpcy5zLCBpZHgpKSB7IHRoaXMudG9hc3QoJ1N3YXBwZWQ6IGRyZXcgYSBkaWZmZXJlbnQgU291bC4nKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgdGhpcy5zZWwuaWR4ID09PSBpZHggPyBudWxsIDogeyB0eXBlOiAnY2FyZCcsIGlkeCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVGlsZShjZWxsOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBoZXJlID0gcy51bml0cy5maW5kKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpOyBpZiAoaGVyZSkgeyB0aGlzLm9uVW5pdFZpc3VhbCh0aGlzLnVuaXRWaXMuZ2V0KGhlcmUuaWQpISk7IHJldHVybjsgfVxuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJykge1xuICAgICAgaWYgKGNhblN1bW1vbihzLCBzZWwuaWR4KSkgeyBzdW1tb24ocywgc2VsLmlkeCwgY2VsbCk7IHRoaXMuc2VsID0gbnVsbDsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHNvdWwgPSBzLmhhbmRbc2VsLmlkeF07IHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb246ICR7U09VTF9OQU1FW3NvdWxdfSBjb3N0cyAke2Nvc3Qoc291bCwgMSl9LCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTsgfVxuICAgIH0gZWxzZSBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHsgaWYgKG1vdmVVbml0KHMsIHNlbC5pZCwgY2VsbCkpIHRoaXMuc2VsID0gbnVsbDsgfVxuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG9uVW5pdFZpc3VhbCh2OiBVbml0VmlzdWFsKSB7XG4gICAgY29uc3QgaWQgPSB0aGlzLnZpc1RvVW5pdC5nZXQodik7IGlmIChpZCA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCkhO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChzd2FwU2VsbChzLCBpZCkpIHsgdGhpcy50b2FzdChgU29sZCAke1NPVUxfTkFNRVt1LnNvdWxdfTogZHJldyBhIGRpZmZlcmVudCBTb3VsLmApOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KHUuZnJlc2ggPyBcIllvdSBjYW4ndCBzZWxsIGEgdW5pdCB5b3Ugc3VtbW9uZWQgdGhpcyByb3VuZC5cIiA6ICdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHMuaGFuZFt0aGlzLnNlbC5pZHhdID09PSB1LnNvdWwgJiYgdS5zdGFyID09PSAxICYmIHMucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInKSB7XG4gICAgICBpZiAobWVyZ2VGcm9tSGFuZChzLCB0aGlzLnNlbC5pZHgsIGlkKSkgeyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgdGhlIGNhcmQgaW50byBhIDItc3RhciAke1NPVUxfTkFNRVt1LnNvdWxdfSFgKTsgfVxuICAgICAgZWxzZSB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uIHRvIG1lcmdlOiBpdCBuZWVkcyAke2Nvc3QodS5zb3VsLCAyKSAtIGNvc3QodS5zb3VsLCAxKX0gbW9yZSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCAhPT0gaWQpIHtcbiAgICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09ICh0aGlzLnNlbCBhcyBhbnkpLmlkKSE7XG4gICAgICBpZiAoY2FuTWVyZ2VEZXBsb3llZChhLCB1KSkgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIHUuaWQpOyB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZDogYS5pZCB9OyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB9IGVsc2UgdGhpcy5zZWwgPSB0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgPT09IGlkID8gbnVsbCA6IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIG1lcmdlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBzZWwuaWQpOyBjb25zdCBiID0gYSAmJiBzLnVuaXRzLmZpbmQoKG8pID0+IGNhbk1lcmdlRGVwbG95ZWQoYSwgbykpO1xuICAgIGlmIChhICYmIGIpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCBiLmlkKTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMudG9hc3QoJ05vIG1hdGNoaW5nIHVuaXQgKHNhbWUgU291bCBhbmQgc3RhcnMpIHRvIG1lcmdlIHdpdGguJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICByZW1vdmVTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGlmICghdGhpcy5jb25maXJtUmVtb3ZlKSB7IHRoaXMuY29uZmlybVJlbW92ZSA9IHRydWU7IHRoaXMudG9hc3QoJ1RhcCBSZW1vdmUgYWdhaW4gdG8gY29uZmlybS4gVGhlIGNhcmQgaXMgZ29uZSBmb3IgdGhpcyBzdGFnZS4nKTsgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuOyB9XG4gICAgZGlzbWlzcyh0aGlzLnMsIHNlbC5pZCk7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgdG9nZ2xlU3dhcCgpIHsgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjsgaWYgKHRoaXMucy5kaXNjYXJkVXNlZCkgeyB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyByZXR1cm47IH0gdGhpcy5zd2FwTW9kZSA9ICF0aGlzLnN3YXBNb2RlOyB0aGlzLnNlbCA9IG51bGw7IGlmICh0aGlzLnN3YXBNb2RlKSB0aGlzLnRvYXN0KCdTd2FwOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCwgb3IgYSB1bml0IChub3Qgc3VtbW9uZWQgdGhpcyByb3VuZCkgdG8gc2VsbC4nKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGJhdHRsZVxuICBzdGFydEJhdHRsZSgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhdGhpcy5zLnVuaXRzLmxlbmd0aCkgeyBpZiAoIXRoaXMucy51bml0cy5sZW5ndGgpIHRoaXMudG9hc3QoJ1N1bW1vbiBhdCBsZWFzdCBvbmUgdW5pdCBmaXJzdC4nKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5mbHVzaFR3ZWVucygpOyBhdWRpby5wbGF5KCdzdGFydCcpOyB0aGlzLmJlZ2luQmF0dGxlUGVyZigpOyB0aGlzLnNob3dHcmlkKGZhbHNlKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5hdHRlbXB0Kys7IHRoaXMuaGFuZGxlZCA9IGZhbHNlOyB0aGlzLnJlc3VsdEF0ID0gLTE7XG4gICAgY29uc3QgcyA9IHRoaXMucywgdW5pdHMgPSBzLnVuaXRzLnNsaWNlKCk7XG4gICAgY29uc3Qgc2F2ZWQgPSBsb2FkU2F2ZSgpLnNvdWxzLCBsZXZlbHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTsgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHNhdmVkKSkgbGV2ZWxzW2tdID0gKHNhdmVkIGFzIGFueSlba10ubGV2ZWw7ICAgLy8gcGVybWFuZW50IFNvdWwgbGV2ZWxzXG4gICAgdGhpcy5iYXR0bGUgPSBuZXcgQmF0dGxlKHVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW15V2F2ZShzLndhdmUsIHRoaXMuc2VlZCksIHRoaXMuc2VlZCAqIDEzMSArIHMud2F2ZSAqIDE3ICsgdGhpcy5hdHRlbXB0LCBsZXZlbHMsIGVuZW15UG93ZXIocy53YXZlKSk7XG4gICAgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTtcbiAgICB0aGlzLmJhdHRsZS5maWdodGVycy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICBpZiAoZi50ZWFtID09PSAwKSB7IGNvbnN0IHUgPSB1bml0c1tmLmlkIC0gMV07IGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5mVW5pdC5zZXQoZi5pZCwgdS5pZCk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IH1cbiAgICAgIGVsc2UgeyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgZi5zb3VsLCAxLCBmLnN0YXIpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoZi54LCAwLCBmLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gLU1hdGguUEkgLyAyOyBpZiAoZi5ib3NzICYmIHYuc2V0Qm9zcykgdi5zZXRCb3NzKHRydWUpOyB2LnBsYXkoJ3NwYXduJyk7IHYuc2V0SHAoMSk7IHYuc2V0TWFuYShmLm1heE1hbmEgPyAwIDogbnVsbCk7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh2LnN0YXRlID09PSAnc3Bhd24nKSB2LnBsYXkoJ2lkbGUnKTsgfSk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjcsIDAuNiwgMC41LCAwLjddLCBbMC40LCAwLjM1LCAwLjMsIDAuNl0sIDE0KTsgfVxuICAgIH0pO1xuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIHRoaXMucGhhc2UgPSAndHJhbnNpdGlvbic7IHRoaXMuc3RhcnRTdGVwQXQgPSAxLjA7IHRoaXMuYWNjID0gMDsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYmF0dGxlLCAyLjIpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLmJhdHRsZVJvYXIoKTtcbiAgfVxuICBwcml2YXRlIGFwcGx5RXZlbnRzKGV2czogQkV2ZW50W10pIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhO1xuICAgIGZvciAoY29uc3QgZSBvZiBldnMpIHtcbiAgICAgIGlmIChlLnQgPT09ICdzd2luZycpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB2LnBsYXkoJ2F0dGFjaycsIGUuc3BlZWQpOyBpZiAoTWF0aC5yYW5kb20oKSA8IDAuMDgpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKTsgaWYgKGYpIGF1ZGlvLmJhcmsoZi5zb3VsLCAwLCBmLnRlYW0gPT09IDAgPyAxIDogMC44NSk7IH0gfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnaGl0JykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLnRvKTsgaWYgKHYpIHYucHVsc2UoKTsgaWYgKGUua2luZCA9PT0gJ2Fycm93JykgYXVkaW8ucGxheSgnaGl0QXJyb3cnKTsgZWxzZSBpZiAoZS5raW5kID09PSAnbWVsZWUnKSBhdWRpby5wbGF5KCdoaXQnKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnYXJyb3cnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5mcm9tKSEsIHRvID0gYi5ieUlkKGUudG8pITsgdGhpcy5zcGF3bkFycm93KGYudGVhbSwgZi54LCBmLnosIHRvLngsIHRvLnosIGUuZHVyKTsgYXVkaW8ucGxheSgnYXJyb3cnKTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnZGVhdGgnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgeyB2LnBsYXkoJ2RlYXRoJyk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ2RlYXRoJyk7IHRoaXMuYnVyc3QoZi54LCBmLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTIpOyBpZiAoZi50ZWFtID09PSAxKSB0aGlzLmxhdGVyKDUsICgpID0+IHsgaWYgKHRoaXMuZnZpcy5nZXQoZS5pZCkgPT09IHYgJiYgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgeyB2LmhvbGRlci5zZXRFbmFibGVkKGZhbHNlKTsgfSB9KTsgfSB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdjYXN0JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnY2FzdCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDAuNSwgMC44LCAxKSwgMC4xNSwgMS4xLCAwLjM1KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAndGF1bnQnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCd0YXVudCcpOyB0aGlzLmZ4UmluZyhmLngsIGYueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuMyksIDAuMywgQkFMQU5DRS50YXVudC5yYWRpdXMsIDAuNik7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3NtYXNoJykgeyBhdWRpby5wbGF5KCdzbWFzaCcpOyB0aGlzLmZ4UmluZyhlLngsIGUueiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNSwgMC4yKSwgMC4yLCBlLnIgKiAxLjYsIDAuNDUpOyB9XG4gICAgfVxuICB9XG4gIHByaXZhdGUgYXJyb3dCYXNlOiBhbnlbXSA9IFtdO1xuICAvKiogVGhlIGFycm93J3Mgb3duIG1hdGVyaWFsIHdpdGggYSBmYWludCBnbG93IGluIHRoZSB0ZWFtIGNvbG91ciAocHVycGxlIGZvciB5b3VycywgYW1iZXIgZm9yIHRoZSBlbmVteSdzKSwgc28geW91IGNhbiBzdGlsbCB0ZWxsIHdob3NlIGl0IGlzLiAqL1xuICBwcml2YXRlIGFycm93VGVhbU1hdCh0ZWFtOiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5hcnJvd0Jhc2VbdGVhbV0pIHJldHVybiB0aGlzLmFycm93QmFzZVt0ZWFtXTtcbiAgICBjb25zdCBzcmMgPSB0aGlzLkEuYXJyb3cubWF0ZXJpYWxzICYmIHRoaXMuQS5hcnJvdy5tYXRlcmlhbHNbMF07IGlmICghc3JjKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBtID0gc3JjLmNsb25lKCdhcnJvd1QnICsgdGVhbSk7IGNvbnN0IGMgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNTUsIDAuMiwgMC44NSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC45LCAwLjU1LCAwLjE1KTtcbiAgICBpZiAoJ2VtaXNzaXZlQ29sb3InIGluIG0pIG0uZW1pc3NpdmVDb2xvciA9IGMuc2NhbGUoMC4wMzUpOyB0aGlzLmFycm93QmFzZVt0ZWFtXSA9IG07IHJldHVybiBtO1xuICB9XG4gIHByaXZhdGUgc3Bhd25BcnJvdyh0ZWFtOiBudW1iZXIsIHgwOiBudW1iZXIsIHowOiBudW1iZXIsIHgxOiBudW1iZXIsIHoxOiBudW1iZXIsIGR1cjogbnVtYmVyKSB7XG4gICAgbGV0IG1lc2ggPSB0aGlzLmFycm93TWVzaC5wb3AoKTtcbiAgICBpZiAoIW1lc2gpIHtcbiAgICAgIGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2FyJywgdGhpcy5zY2VuZSk7IGhvbGRlci5zY2FsaW5nLnNldEFsbCgwLjY1KTsgICAvLyA1NSBjbSB3YXMgbG9uZyBuZXh0IHRvIGEgY2hpYmkgR29ibGluXG4gICAgICBpZiAodGhpcy5BLmFycm93KSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHJlYWwgYXJyb3cgbW9kZWwgKG1ldGFsIGhlYWQsIGZsZXRjaGluZyk6IG9uZSBpbnN0YW5jZSBwZXIgZmx5aW5nIGFycm93XG4gICAgICAgIGNvbnN0IGVudCA9IHRoaXMuQS5hcnJvdy5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDYpLCBmYWxzZSk7XG4gICAgICAgIGVudC5yb290Tm9kZXNbMF0ucGFyZW50ID0gaG9sZGVyOyBlbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IH0pO1xuICAgICAgfSBlbHNlIHsgY29uc3QgY3lsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignYXJyb3cnLCB7IGhlaWdodDogMC41NSwgZGlhbWV0ZXI6IDAuMDM1IH0sIHRoaXMuc2NlbmUpOyBjeWwucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyBjeWwuaXNQaWNrYWJsZSA9IGZhbHNlOyBjeWwucGFyZW50ID0gaG9sZGVyOyBjeWwubWF0ZXJpYWwgPSB0aGlzLmFycm93TWF0c1t0ZWFtXTsgfVxuICAgICAgbWVzaCA9IGhvbGRlcjtcbiAgICB9XG4gICAgbWVzaC5zZXRFbmFibGVkKHRydWUpO1xuICAgIGlmICh0aGlzLkEuYXJyb3cpIHsgY29uc3QgdG0gPSB0aGlzLmFycm93VGVhbU1hdCh0ZWFtKTsgbWVzaC5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBpZiAodG0pIG0ubWF0ZXJpYWwgPSB0bTsgfSk7IH1cbiAgICB0aGlzLmFycm93cy5wdXNoKHsgbWVzaCwgeDAsIHowLCB4MSwgejEsIHQ6IDAsIGR1ciB9KTtcbiAgfVxuXG4gIC8qKiBCYXR0bGUgY3J5OiB1cCB0byB0aHJlZSBkaWZmZXJlbnQgU291bHMgZnJvbSB5b3VyIGFybXkgYmVsbG93IGluIHR1cm4sIGFuZCBvbmUgZnJvbSB0aGUgZW5lbXkgYW5zd2VycywgYSBsaXR0bGUgbG93ZXIuICovXG4gIHByaXZhdGUgYmF0dGxlUm9hcigpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7IGlmICghYikgcmV0dXJuOyBjb25zdCBtaW5lID0gbmV3IFNldDxzdHJpbmc+KCksIHRoZWlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSAoZi50ZWFtID09PSAwID8gbWluZSA6IHRoZWlycykuYWRkKGYuc291bCk7XG4gICAgWy4uLm1pbmVdLnNsaWNlKDAsIDMpLmZvckVhY2goKHNvdWwsIGkpID0+IGF1ZGlvLmJhcmsoc291bCwgMC4xNSArIDAuMTYgKiBpLCAxKSk7IGNvbnN0IGUgPSBbLi4udGhlaXJzXVswXTsgaWYgKGUpIGF1ZGlvLmJhcmsoZSwgMC41NSwgMC44Mik7XG4gIH1cblxuICBwcml2YXRlIGZyYW1lKGR0OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5jYW52YXMuY2xpZW50V2lkdGggIT09IHRoaXMubGFzdFcgfHwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0ICE9PSB0aGlzLmxhc3RIKSB0aGlzLmhhbmRsZVJlc2l6ZSgpOyAgIC8vIGUuZy4gdGhlIGhvbWUtc2NyZWVuIGFwcCByZXNpemluZyBhZnRlciBsYXVuY2hcbiAgICBmb3IgKGxldCBpID0gdGhpcy50aW1lcnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgdGhpcy50aW1lcnNbaV0udCAtPSBkdDsgaWYgKHRoaXMudGltZXJzW2ldLnQgPD0gMCkgeyBjb25zdCBmID0gdGhpcy50aW1lcnNbaV0uZm47IHRoaXMudGltZXJzLnNwbGljZShpLCAxKTsgZigpOyB9IH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5yaW5nRngubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgciA9IHRoaXMucmluZ0Z4W2ldOyByLnQgKz0gZHQ7IGNvbnN0IHUgPSByLnQgLyByLmR1ciwgcyA9IHIucjAgKyAoci5yMSAtIHIucjApICogdTsgci5tLnNjYWxpbmcuc2V0KHMsIHMsIHMpOyByLm1tLmFscGhhID0gMC45ICogKDEgLSB1KTsgaWYgKHUgPj0gMSkgeyByLm0uZGlzcG9zZSgpOyByLm1tLmRpc3Bvc2UoKTsgdGhpcy5yaW5nRnguc3BsaWNlKGksIDEpOyB9IH1cbiAgICBpZiAodGhpcy5jYW1UIDwgMSkgeyB0aGlzLmNhbVQgPSBNYXRoLm1pbigxLCB0aGlzLmNhbVQgKyBkdCAvIHRoaXMuY2FtRHVyKTsgY29uc3QgZSA9IHRoaXMuY2FtVCAqIHRoaXMuY2FtVCAqICgzIC0gMiAqIHRoaXMuY2FtVCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnBvcywgdGhpcy5jYW1Uby5wb3MsIGUpOyB0aGlzLmNhbVRndCA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS50Z3QsIHRoaXMuY2FtVG8udGd0LCBlKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpOyB9XG4gICAgZWxzZSBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgJiYgdGhpcy5jYW1Nb2RlID09PSAnY2xvc2UnICYmICF0aGlzLmNpbmUpIHRoaXMuZnJhbWVCYXR0bGUoZHQpO1xuICAgIHRoaXMubmVjcm8udXBkYXRlKGR0KTtcbiAgICBmb3IgKGxldCBpID0gdGhpcy50d2VlbnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgdyA9IHRoaXMudHdlZW5zW2ldOyB3LnQgKz0gZHQ7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCB3LnQgLyB3LmR1cik7IHcuZm4odSk7IGlmICh1ID49IDEpIHsgdGhpcy50d2VlbnMuc3BsaWNlKGksIDEpOyBpZiAody5kb25lKSB3LmRvbmUoKTsgfSB9XG4gICAgZm9yIChjb25zdCB2IG9mIHRoaXMudW5pdFZpcy52YWx1ZXMoKSkgdi51cGRhdGUoZHQpO1xuICAgIHRoaXMuZnZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBpZiAoIXRoaXMuZlVuaXQuaGFzKGlkKSkgdi51cGRhdGUoZHQpOyB9KTtcblxuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTtcbiAgICBpZiAoKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJyB8fCB0aGlzLnBoYXNlID09PSAnYmF0dGxlJykgJiYgYikge1xuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykgeyB0aGlzLnN0YXJ0U3RlcEF0IC09IGR0OyBpZiAodGhpcy5zdGFydFN0ZXBBdCA8PSAwKSB7IHRoaXMucGhhc2UgPSAnYmF0dGxlJzsgdGhpcy51aS5yZW5kZXIoKTsgfSB9XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpIHtcbiAgICAgICAgdGhpcy5hY2MgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTtcbiAgICAgICAgd2hpbGUgKHRoaXMuYWNjID49IDEgLyAzMCAmJiBiLndpbm5lciA8IDApIHsgYi5zdGVwKDEgLyAzMCk7IHRoaXMuYWNjIC09IDEgLyAzMDsgdGhpcy5hcHBseUV2ZW50cyhiLmRyYWluKCkpOyB9XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgaWYgKCF0aGlzLmNpbmUgJiYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IGYudGVhbSA9PT0gMSkpIHsgdi5ob2xkZXIucG9zaXRpb24ueCA9IGYueDsgdi5ob2xkZXIucG9zaXRpb24ueiA9IGYuejsgaWYgKGYuYWxpdmUgfHwgdHJ1ZSkgdi5ob2xkZXIucm90YXRpb24ueSA9IGYueWF3OyB9XG4gICAgICAgIGlmIChmLmFsaXZlKSB7IHYuc2V0SHAoZi5ocCAvIGYubWF4SHApOyBpZiAoZi5tYXhNYW5hKSB2LnNldE1hbmEoZi5tYW5hIC8gZi5tYXhNYW5hKTsgfVxuICAgICAgICBlbHNlIHYuc2V0TWFuYShudWxsKTtcbiAgICAgICAgaWYgKGYuc3RhdGUgIT09ICdhdHRhY2snICYmIGYuYWxpdmUgJiYgdi5zdGF0ZSAhPT0gJ2NoZWVyJykgeyBjb25zdCB3YW50ID0gZi5zdGF0ZSA9PT0gJ3J1bicgPyAncnVuJyA6ICdpZGxlJzsgaWYgKHRoaXMubGFzdFN0YXRlLmdldChmLmlkKSAhPT0gd2FudCB8fCAodi5zdGF0ZSAhPT0gd2FudCAmJiB2LnN0YXRlICE9PSAnc3Bhd24nKSkgeyBpZiAodi5zdGF0ZSAhPT0gJ3NwYXduJykgeyB2LnBsYXkod2FudCBhcyBhbnkpOyB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgd2FudCk7IH0gfSB9XG4gICAgICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsICdhdHRhY2snKTtcbiAgICAgIH1cbiAgICAgIGlmIChiLndpbm5lciA+PSAwICYmICF0aGlzLmhhbmRsZWQpIHsgdGhpcy5oYW5kbGVkID0gdHJ1ZTsgdGhpcy5yZXN1bHRBdCA9IDEuNDsgfVxuICAgICAgaWYgKHRoaXMucmVzdWx0QXQgPiAwKSB7IHRoaXMucmVzdWx0QXQgLT0gZHQ7IGlmICh0aGlzLnJlc3VsdEF0IDw9IDApIHRoaXMuaGFuZGxlUmVzdWx0KCk7IH1cbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuYXJyb3dzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBhID0gdGhpcy5hcnJvd3NbaV07IGEudCArPSBkdCAqIHRoaXMudGltZVNjYWxlOyBjb25zdCB1ID0gTWF0aC5taW4oMSwgYS50IC8gYS5kdXIpO1xuICAgICAgY29uc3QgcHggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUsIHB6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1LCBweSA9IDAuNzUgKyBNYXRoLnNpbih1ICogTWF0aC5QSSkgKiAwLjkgLSB1ICogMC4yNTtcbiAgICAgIGNvbnN0IHUyID0gTWF0aC5taW4oMSwgdSArIDAuMDMpLCBxeCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdTIsIHF6ID0gYS56MCArIChhLnoxIC0gYS56MCkgKiB1MiwgcXkgPSAwLjc1ICsgTWF0aC5zaW4odTIgKiBNYXRoLlBJKSAqIDAuOSAtIHUyICogMC4yNTtcbiAgICAgIGEubWVzaC5wb3NpdGlvbi5zZXQocHgsIHB5LCBweik7IGEubWVzaC5sb29rQXQobmV3IEJBQllMT04uVmVjdG9yMyhxeCwgcXksIHF6KSk7XG4gICAgICBpZiAodSA+PSAxKSB7IGEubWVzaC5zZXRFbmFibGVkKGZhbHNlKTsgdGhpcy5hcnJvd01lc2gucHVzaChhLm1lc2gpOyB0aGlzLmFycm93cy5zcGxpY2UoaSwgMSk7IH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVJlc3VsdCgpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBzID0gdGhpcy5zO1xuICAgIHRoaXMuZW5kQmF0dGxlUGVyZigpO1xuICAgIHRoaXMubGFzdEJhdHRsZSA9IGB3YXZlICR7cy53YXZlfSBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fTogJHtiLndpbm5lciA9PT0gMCA/ICdXT04nIDogJ0xPU1QnfSBpbiAke2IudGltZS50b0ZpeGVkKDEpfXMsICR7Yi5jb3VudCgwKX0gb2YgeW91cnMgYW5kICR7Yi5jb3VudCgxKX0gZW5lbWllcyBsZWZ0YDtcbiAgICBpZiAoYi53aW5uZXIgPT09IDApIHtcbiAgICAgIHRoaXMucGxheVJlc3VsdCgnd2luJywgKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBhcm15IGlzIHJhaXNlZCBhZ2FpbiwgdGhlbiB0aGUgbmV4dCB3YXZlIC8gdGhlIGRyYWZ0XG4gICAgICAgIHRoaXMuY2luZSA9IGZhbHNlO1xuICAgICAgICB0cnkgeyB0aGlzLmxhc3RHb2xkID0gdGhpcy5kYWlseSA/IDAgOiBhZGRHb2xkQW5kU2F2ZShpc0VuZGxlc3MoKSA/IGVuZGxlc3NXYXZlR29sZChzLndhdmUpIDogd2F2ZUdvbGQoY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lIGFzIGFueSkpOyB0aGlzLnJ1bkdvbGQgKz0gdGhpcy5sYXN0R29sZDsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7IH0gY2F0Y2ggeyB0aGlzLmxhc3RHb2xkID0gMDsgfVxuICAgICAgICBpZiAoaXNFbmRsZXNzKCkgJiYgdGhpcy5lbmRsZXNzKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHIgPSByZWNvcmRFbmRsZXNzV2F2ZUFuZFNhdmUocy53YXZlKTsgdGhpcy5lbmRsZXNzLmNsZWFyZWQgPSBzLndhdmU7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2F2ZS1jaGFuZ2VkJykpO1xuICAgICAgICAgICAgaWYgKHIucGFjaykgeyB0aGlzLmVuZGxlc3MucGFja3MrKzsgdGhpcy50b2FzdCgnV2F2ZSAnICsgcy53YXZlICsgJyBjbGVhcmVkISBZb3UgZWFybmVkIGEgU291bCBQYWNrIChzZWUgdGhlIFNob3ApLicpOyB9XG4gICAgICAgICAgfSBjYXRjaCB7IC8qIHNhdmluZyBtdXN0IG5ldmVyIGJyZWFrIGEgcnVuICovIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoYWR2YW5jZVdhdmUocykpIHtcbiAgICAgICAgICB0aGlzLnBoYXNlID0gJ3dvbic7IGNsZWFyUnVuKCk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRhaWx5KSB7IHRoaXMuZGFpbHlSZXdhcmQgPSByZWNvcmREYWlseVdpbkFuZFNhdmUodGhpcy5kYWlseS5kYXkpOyB0aGlzLnJld2FyZCA9IG51bGw7IH0gZWxzZSB0aGlzLnJld2FyZCA9IHJlY29yZENsZWFyQW5kU2F2ZShjdXJyZW50U3RhZ2VJZCwgZGlmZmljdWx0eU5hbWUgYXMgYW55KTtcbiAgICAgICAgICAgIHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2F2ZS1jaGFuZ2VkJykpO1xuICAgICAgICAgIH0gY2F0Y2ggeyB0aGlzLnJld2FyZCA9IG51bGw7IH1cbiAgICAgICAgICB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5kcmFmdCA9IGRyYWZ0T3B0aW9ucyhzKTsgdGhpcy5waGFzZSA9ICdkcmFmdCc7IHRoaXMucGVyc2lzdFJ1bigpOyB0aGlzLnVpLnJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZhaWxXYXZlKHMpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnVpLnB1bHNlSGVhcnRzKCk7ICAgICAgICAgICAgICAgICAgIC8vIHRoZSBoZWFydCBpcyBsb3N0IHRoZSBtb21lbnQgaGUgaXMgaGl0XG4gICAgICBpZiAocy5zdGF0dXMgPT09ICdsb3N0JykgdGhpcy5wbGF5UmVzdWx0KCdmaW5hbCcsICgpID0+IHsgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucGhhc2UgPSAnbG9zdCc7IGNsZWFyUnVuKCk7IHRoaXMudWkucmVuZGVyKCk7IH0pO1xuICAgICAgZWxzZSB0aGlzLnBsYXlSZXN1bHQoJ2xvc3MnLCAoKSA9PiB7IHRoaXMudG9hc3QoJ1lvdXIgYXJteSBmZWxsLiAtMSBoZWFydCwgKzEgY2FyZCwgc2FtZSB3YXZlLiBSZWJ1aWxkIGEgZGlmZmVyZW50IHN0cmF0ZWd5LicpOyB0aGlzLnRvQnVpbGQoKTsgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLSByZXN1bHQgY3V0c2NlbmVzIChwbGFuIHNlY3Rpb25zIDE5LTIyKTogdGhlIE5lY3JvbWFuY2VyIHRha2VzIHRoZSBoaXQsIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSwgcmFpc2VzIHRoZSBmYWxsZW5cbiAgcHJpdmF0ZSBwbGF5UmVzdWx0KGtpbmQ6ICd3aW4nIHwgJ2xvc3MnIHwgJ2ZpbmFsJywgZG9uZTogKCkgPT4gdm9pZCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIG4gPSB0aGlzLm5lY3JvOyB0aGlzLmNpbmUgPSB0cnVlOyBpZiAoa2luZCAhPT0gJ3dpbicpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLm5lY3JvLCAxLjEpO1xuICAgIGNvbnN0IGhvbWUgPSAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXZlcnkgZmFsbGVuIGFsbHkgaXMgcHVsbGVkIGJhY2sgdG8gaXRzIGdyaWQgdGlsZSBhbmQgc3RhbmRzIHVwXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgncmVzdXJyZWN0Jyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy5idXJzdChjLngsIGMueiwgWzAuODUsIDAuNSwgMSwgMC45XSwgWzAuNSwgMC4yLCAxLCAwLjddLCAzMCk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBpZiAoZi50ZWFtICE9PSAwKSBjb250aW51ZTsgY29uc3QgdWlkID0gdGhpcy5mVW5pdC5nZXQoZi5pZCksIHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdWlkKSwgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdSB8fCAhdikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3ModS5jZWxsKSwgeDAgPSB2LmhvbGRlci5wb3NpdGlvbi54LCB6MCA9IHYuaG9sZGVyLnBvc2l0aW9uLno7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTtcbiAgICAgICAgaWYgKCFmLmFsaXZlKSB7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5idXJzdCh4MCwgejAsIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTgpOyB0aGlzLmZ4UmluZyh4MCwgejAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjcsIDAuMzUsIDEpLCAwLjMsIDEuNiwgMC43KTsgfVxuICAgICAgICB0aGlzLnR3ZWVuKDEuMCwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjUsIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5ob2xkZXIucm90YXRpb24ueSArPSAoTWF0aC5QSSAvIDIgLSB2LmhvbGRlci5yb3RhdGlvbi55KSAqIE1hdGgubWluKDEsIHQgKiAwLjUgKyAwLjEpOyB9LFxuICAgICAgICAgICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHRoaXMuYnVyc3QodG8ueCwgdG8ueiwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxMCk7IH0pO1xuICAgICAgfVxuICAgIH07XG4gICAgaWYgKGtpbmQgPT09ICd3aW4nKSB7XG4gICAgICAvLyB0aGUgc3Vydml2b3JzIGNlbGVicmF0ZSByaWdodCB3aGVyZSB0aGV5IHN0YW5kIChwdXJlbHkgdmlzdWFsKSwgVEhFTiB0aGUgY2FtZXJhIHN3aW5ncyB0byB0aGUgTmVjcm9tYW5jZXIgYW5kIHRoZSBhcm15IGlzIHJhaXNlZFxuICAgICAgYXVkaW8ucGxheSgndmljdG9yeScpO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIGlmIChmLnRlYW0gPT09IDAgJiYgZi5hbGl2ZSkgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKHYpIHRoaXMubGF0ZXIoTWF0aC5yYW5kb20oKSAqIDAuMzUsICgpID0+IHsgdi5wbGF5KCdjaGVlcicpOyBhdWRpby5iYXJrKGYuc291bCk7IH0pOyB9XG4gICAgICB0aGlzLmxhdGVyKDEuNiwgKCkgPT4geyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5uZWNybywgMS4xKTsgbi5jYXN0KCk7IH0pO1xuICAgICAgdGhpcy5sYXRlcigxLjg1LCBob21lKTsgdGhpcy5sYXRlcigzLjYsIGRvbmUpOyByZXR1cm47XG4gICAgfVxuICAgIG4uaHVydCgpOyBhdWRpby5wbGF5KCdoZWFydExvc3QnKTsgdGhpcy5sYXRlcigwLjE1LCAoKSA9PiB7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTsgdGhpcy5idXJzdChjLngsIGMueiwgWzEsIDAuMywgMC4zLCAwLjldLCBbMC44LCAwLjEsIDAuMiwgMC42XSwgMTYpOyB9KTtcbiAgICBpZiAoa2luZCA9PT0gJ2ZpbmFsJykgeyB0aGlzLmxhdGVyKDAuNiwgKCkgPT4geyBuLmRlZmVhdCgpOyBhdWRpby5wbGF5KCdkZWZlYXQnKTsgfSk7IHRoaXMubGF0ZXIoMi42LCBkb25lKTsgcmV0dXJuOyB9XG4gICAgdGhpcy5sYXRlcigxLjAsICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXB1bHNpb24gc2hvY2t3YXZlOiBzdXJ2aXZvcnMgYXJlIGZsdW5nIGJhY2sgdG8gd2hlcmUgdGhleSBzdGFydGVkIGFuZCBoZWFsIHRvIGZ1bGxcbiAgICAgIG4uY2FzdCgpOyBhdWRpby5wbGF5KCdzaG9ja3dhdmUnKTsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpO1xuICAgICAgdGhpcy5meFJpbmcoYy54LCAwLCBuZXcgQkFCWUxPTi5Db2xvcjMoMC44NSwgMC41NSwgMSksIDAuNiwgMzAsIDEuMSk7IHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDEsIDEpLCAwLjQsIDIyLCAwLjgpO1xuICAgICAgdGhpcy5idXJzdChjLngsIGMueiwgWzEsIDAuODUsIDEsIDAuOV0sIFswLjcsIDAuNCwgMSwgMC43XSwgNDApO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgaWYgKGYudGVhbSAhPT0gMSB8fCAhZi5hbGl2ZSkgY29udGludWU7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0byA9IGNlbGxQb3MoMSwgZi5jZWxsKSwgeDAgPSB2LmhvbGRlci5wb3NpdGlvbi54LCB6MCA9IHYuaG9sZGVyLnBvc2l0aW9uLno7IHYucHVsc2UoKTtcbiAgICAgICAgdGhpcy50d2VlbigwLjksICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC45LCB6MCArICh0by56IC0gejApICogdCk7IHYuc2V0SHAoZi5ocCAvIGYubWF4SHAgKyAoMSAtIGYuaHAgLyBmLm1heEhwKSAqIHQpOyB9LCAoKSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnkgPSAwOyB2LnNldEhwKDEpOyB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICB0aGlzLmxhdGVyKDIuMywgaG9tZSk7IHRoaXMubGF0ZXIoMy43LCBkb25lKTtcbiAgfVxuICBwaWNrRHJhZnQoaWR4OiBudW1iZXIpIHsgaWYgKCF0aGlzLmRyYWZ0KSByZXR1cm47IHRha2VEcmFmdCh0aGlzLnMsIHRoaXMuZHJhZnQsIGlkeCk7IHRoaXMuZHJhZnQgPSBudWxsOyBub3JtYWxEcmF3KHRoaXMucyk7IHRoaXMudG9CdWlsZCgpOyB9XG4gIHByaXZhdGUgdG9CdWlsZCgpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5uZWNyby5yZXZpdmUoKTsgdGhpcy5mbHVzaFR3ZWVucygpO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgdGhpcy5zaG93R3JpZCh0cnVlKTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7ICAgICAgICAgICAgICAgICAgICAgICAvLyByZXN1cnJlY3Rpb246IGV2ZXJ5b25lIHJpc2VzIGFnYWluIGF0IGZ1bGwgaGVhbHRoXG4gICAgICBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYuaG9sZGVyLnNldEVuYWJsZWQodHJ1ZSk7IHYuc2V0SHAobnVsbCk7IHYuc2V0TWFuYShudWxsKTsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLnN1bW1vbkZ4KHAueCwgcC56KTtcbiAgICAgIHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB2LnBsYXkoJ2lkbGUnKSk7XG4gICAgfVxuICAgIHRoaXMucGhhc2UgPSAnYnVpbGQnOyB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7ICAgICAgICAgIC8vIFVJIGZpcnN0OiB0aGUgY2FtZXJhIG11c3QgbWVhc3VyZSB0aGUgaGFuZCBhbmQgYnV0dG9ucyB3aGlsZSB0aGV5IGFyZSB2aXNpYmxlXG4gICAgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkuYnVpbGQsIDEuOCk7XG4gIH1cbiAgLyoqIDJ4IGFuZCA0eCBiYXR0bGUgc3BlZWQgb3BlbiBvbmNlIHRoZSBjYW1wYWlnbiBpcyBmaW5pc2hlZCAodGhlIGxhc3Qgc3RhZ2UgY2xlYXJlZCBvbiBOb3JtYWwpLiA/ZGVidWcgb3IgP3NwZWVkPTEgb3BlbnMgdGhlbSBmb3IgdGVzdGluZy4gKi9cbiAgc3BlZWRVbmxvY2tlZCgpOiBib29sZWFuIHsgY29uc3QgcSA9IG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKTsgcmV0dXJuICEhKHEuZ2V0KCdkZWJ1ZycpIHx8IHEuZ2V0KCdzcGVlZCcpKSB8fCBlbmRsZXNzVW5sb2NrZWQobG9hZFNhdmUoKSk7IH1cbiAgc2V0U3BlZWQoazogbnVtYmVyKSB7XG4gICAgaWYgKGsgPiAxICYmICF0aGlzLnNwZWVkVW5sb2NrZWQoKSkgcmV0dXJuO1xuICAgIHRoaXMudGltZVNjYWxlID0gazsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGRlYnVnIGhlbHBlcnNcbiAgYXBwbHlCYWxhbmNlQ2hhbmdlKCkgeyB0aGlzLnVuaXRWaXMuZm9yRWFjaCgodiwgaWQpID0+IHsgY29uc3QgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7IGlmICh1KSB2LnNldFN0YXIodS5zdGFyKTsgfSk7IH1cbiAgdGVzdE9kZHMobiA9IDIwMCkge1xuICAgIGNvbnN0IHNsb3RzID0gdGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gKHsgc291bDogdS5zb3VsLCBzdGFyOiB1LnN0YXIsIGNlbGw6IHUuY2VsbCB9KSksIGVuZW1pZXMgPSBlbmVteVdhdmUodGhpcy5zLndhdmUsIHRoaXMuc2VlZCk7IGxldCB3aW4gPSAwLCB0ID0gMDtcbiAgICBjb25zdCBsdjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9LCBzdiA9IGxvYWRTYXZlKCkuc291bHM7IGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhzdikpIGx2W2tdID0gKHN2IGFzIGFueSlba10ubGV2ZWw7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsgY29uc3QgciA9IHNpbXVsYXRlKHNsb3RzLCBlbmVtaWVzLCA1MDAwICsgaSwgMTMwLCBsdiwgZW5lbXlQb3dlcigpKTsgaWYgKHIud2lubmVyID09PSAwKSB3aW4rKzsgdCArPSByLnRpbWU7IH1cbiAgICByZXR1cm4geyB3aW46IE1hdGgucm91bmQoKHdpbiAvIG4pICogMTAwKSwgYXZnVGltZTogKyh0IC8gbikudG9GaXhlZCgxKSwgbiB9O1xuICB9XG4gIGFkZENhcmQoc291bDogU291bElkKSB7IHRoaXMucy5oYW5kLnB1c2goc291bCk7IHRoaXMucy5zdGF0cy5kcmF3bisrOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIGFkZERvbWluaW9uKG46IG51bWJlcikgeyB0aGlzLnMuY2FwICs9IG47IHRoaXMudWkucmVuZGVyKCk7IH1cbiAgcmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgZW4gPSBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpO1xuICAgIHJldHVybiBbYHN0YWdlICR7Y3VycmVudFN0YWdlSWR9LyR7ZGlmZmljdWx0eU5hbWV9ICBzZWVkICR7dGhpcy5zZWVkfSAgd2F2ZSAke3Mud2F2ZX0vJHtzdGFnZVdhdmVzKHMpfSAgaGVhcnRzICR7cy5oZWFydHN9ICBkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0gIHBoYXNlICR7dGhpcy5waGFzZX0gIGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9YCxcbiAgICAgIGBoYW5kOiAke3MuaGFuZC5qb2luKCcsICcpIHx8ICcoZW1wdHkpJ31gLCBgYXJteTogJHtzLnVuaXRzLm1hcCgodSkgPT4gYCR7dS5zb3VsfSR7dS5zdGFyfUAke3UuY2VsbH1gKS5qb2luKCcgJykgfHwgJyhub25lKSd9YCwgYGVuZW15OiAke2VuLm1hcCgoZSkgPT4gZS5zb3VsICsgZS5zdGFyKS5qb2luKCcgJyl9YCxcbiAgICAgIGBkaWZmaWN1bHR5OiAke2RpZmZpY3VsdHlOYW1lfSAgbWVyZ2UtZnJvbS1oYW5kOiAke3MucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInfSAgc3dhcCB1c2VkOiAke3MuZGlzY2FyZFVzZWR9YCwgYGxhc3QgdGFwOiAke3RoaXMubGFzdFRhcEluZm99YCwgYHNjcmVlbjogJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IGRwciAke3dpbmRvdy5kZXZpY2VQaXhlbFJhdGlvfWAsIGBsYXN0IGJhdHRsZTogJHt0aGlzLmxhc3RCYXR0bGUgfHwgJy0nfWAsIGBsb2cgdGFpbDpgLCAuLi5zLmxvZy5zbGljZSgtOCksIGBiYWxhbmNlOiAke0pTT04uc3RyaW5naWZ5KHsgc3RhcjogQkFMQU5DRS5zdGFyLCBzdGF0czogQkFMQU5DRS5zdGF0cyB9KX1gXS5qb2luKCdcXG4nKTtcbiAgfVxuICByZXNldEJhbGFuY2VBbGwoKSB7IHJlc2V0QmFsYW5jZSgpOyB0aGlzLmFwcGx5QmFsYW5jZUNoYW5nZSgpOyB9XG4gIGdldCBkaWZmaWN1bHR5KCkgeyByZXR1cm4gZGlmZmljdWx0eU5hbWU7IH1cbiAgY2hhbmdlRGlmZmljdWx0eShuYW1lOiBzdHJpbmcpIHsgc2V0RGlmZmljdWx0eShuYW1lKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy50b2FzdChgRGlmZmljdWx0eTogJHtuYW1lfS4gQXBwbGllcyB0byB0aGUgbmV4dCBiYXR0bGUuYCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBnYWxsZXJ5IChzdGFyIGxvb2tzKVxuICBnYWxsZXJ5KCkge1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmFkZCgnZ2FsbGVyeScpOyB0aGlzLm5lY3JvLnNldEVuYWJsZWQoZmFsc2UpOyBjb25zdCB2aXM6IFVuaXRWaXN1YWxbXSA9IFtdOyBsZXQgdGVhbTogMCB8IDEgPSAwO1xuICAgIGNvbnN0IHJlYnVpbGQgPSAoKSA9PiB7IHZpcy5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHZpcy5sZW5ndGggPSAwOyBTT1VMUy5mb3JFYWNoKChzb3VsLCBpKSA9PiBbMSwgMiwgM10uZm9yRWFjaCgoc3QsIGopID0+IHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHNvdWwsIHRlYW0sIHN0KTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KChpIC0gMi41KSAqIDIuNSwgMCwgKGogLSAxKSAqIC0yLjQpOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAqIDAuODU7IHYucGxheSgnaWRsZScpOyB2aXMucHVzaCh2KTsgfSkpOyB9O1xuICAgIHJlYnVpbGQoKTsgdGhpcy5jYW1lcmEucG9zaXRpb24uc2V0KDAsIDUuNiwgLTE0LjUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIC0wLjQpKTsgdGhpcy5jYW1lcmEuZm92ID0gMC44NTtcbiAgICAod2luZG93IGFzIGFueSkuX19nYWxsZXJ5ID0geyBzZXRUZWFtOiAodDogMCB8IDEpID0+IHsgdGVhbSA9IHQ7IHJlYnVpbGQoKTsgfSwgdmlzIH07XG4gICAgbGV0IGxhc3QgPSBwZXJmb3JtYW5jZS5ub3coKTsgdGhpcy5lbmdpbmUucnVuUmVuZGVyTG9vcCgoKSA9PiB7IGNvbnN0IG4gPSBwZXJmb3JtYW5jZS5ub3coKSwgZHQgPSBNYXRoLm1pbigwLjA1LCAobiAtIGxhc3QpIC8gMTAwMCk7IGxhc3QgPSBuOyB2aXMuZm9yRWFjaCgodikgPT4gdi51cGRhdGUoZHQpKTsgdGhpcy5zY2VuZS5yZW5kZXIoKTsgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBHYW1lIH0gZnJvbSAnLi9nYW1lLnRzJztcblxuY29uc3QgZyA9IG5ldyBHYW1lKCk7XG4od2luZG93IGFzIGFueSkuX19nYW1lID0gZzsgICAgICAgICAgICAgICAgICAgICAgIC8vIGhhbmR5IGZvciBkZWJ1Z2dpbmcgZnJvbSB0aGUgYnJvd3NlciBjb25zb2xlXG5nLmluaXQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2MnKSBhcyBIVE1MQ2FudmFzRWxlbWVudClcbiAgLnRoZW4oKCkgPT4geyBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIGwuc3R5bGUuZGlzcGxheSA9ICdub25lJzsgKHdpbmRvdyBhcyBhbnkpLl9fZ2FtZVJlYWR5ID0gdHJ1ZTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nYW1lLXJlYWR5JykpOyB9KVxuICAuY2F0Y2goKGUpID0+IHtcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvYWRpbmcnKTsgaWYgKGwpIHsgbC5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnOyBsLnRleHRDb250ZW50ID0gJ0Vycm9yOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogZSk7IH1cbiAgICBjb25zb2xlLmVycm9yKGUpO1xuICB9KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7OztBQW9DTyxNQUFNLFdBQW9CO0FBQUEsSUFDL0IsT0FBTztBQUFBLE1BQ0wsU0FBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxHQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxLQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFFBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEtBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsTUFDOUcsUUFBVyxFQUFFLElBQUksS0FBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sS0FBTSxPQUFPLEdBQUssTUFB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TSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsT0FBTyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUNySixFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxHQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsR0FBSyxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQ3BMLEVBQUUsTUFBTSxTQUFTLEdBQUcsSUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsR0FBSyxHQUFHLEtBQUs7QUFBQSxJQUMvSSxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxFQUN4TjtBQUNBLE1BQU0sbUJBQWdDO0FBQUE7QUFBQSxJQUNwQyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDbEUsRUFBRSxNQUFNLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQ3hNLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEVBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsR0FBSyxLQUFLLElBQUk7QUFBQSxJQUNyTSxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQ25ILEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUN0SSxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQ3JILEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQ25OLEVBQUUsTUFBTSxTQUFTLEdBQUcsR0FBRyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLEVBQ3ZOO0FBQ0EsTUFBTSxpQkFBOEI7QUFBQTtBQUFBLElBQ2xDLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEdBQUcsR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUMxSCxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQ3ZLLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLEtBQUssS0FBSyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUs7QUFBQSxJQUN6TSxFQUFFLE1BQU0sVUFBVSxHQUFHLE9BQU8sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQzVHLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsT0FBTyxHQUFHLEVBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLEVBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQ2xQLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQzlPLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxJQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxFQUNsSztBQUtBLE1BQU0sU0FBZ0M7QUFBQSxJQUNwQyxPQUFPLEVBQUUsUUFBUSxjQUFjLE9BQU8sQ0FBQyxNQUFNLEtBQUssR0FBRyxHQUFHLEtBQUssQ0FBQyxNQUFNLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxLQUFLLEtBQUssSUFBSSxHQUFHLE1BQU0sQ0FBQyxNQUFNLE1BQU0sR0FBRyxHQUFHLFFBQVEsQ0FBQyxNQUFNLEdBQUcsR0FBRyxHQUFHLFFBQVEsQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLE1BQU0sQ0FBQyxNQUFNLE1BQU0sSUFBSSxFQUFFO0FBQUEsSUFDNU0sV0FBVyxFQUFFLFFBQVEsa0JBQWtCLE9BQU8sQ0FBQyxNQUFNLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxNQUFNLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxNQUFNLEtBQUssSUFBSSxHQUFHLE1BQU0sQ0FBQyxLQUFLLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxNQUFNLEdBQUcsR0FBRyxHQUFHLFFBQVEsQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLE1BQU0sQ0FBQyxLQUFLLEtBQUssSUFBSSxFQUFFO0FBQUEsSUFDdE4sU0FBUyxFQUFFLFFB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LEdBQUcsTUFBTSxJQUFJLEVBQUUsUUFBUSxDQUFDLElBQUksTUFBTSxFQUFFLE1BQU0sSUFBSSxJQUFJLEtBQUssWUFBWSxNQUFNLElBQUksTUFBTSxJQUFJLElBQUksTUFBTyxJQUFJLENBQUM7QUFBRyxZQUFFLEtBQUssTUFBTSxZQUFZLE1BQU0sQ0FBQztBQUFHO0FBQUEsUUFDN0osS0FBSztBQUFVLFlBQUUsS0FBSyxNQUFNLFlBQVksTUFBTSxHQUFHLEtBQUssTUFBTSxHQUFHO0FBQUcsWUFBRSxLQUFLLEtBQUssVUFBVSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRyxZQUFFLE1BQU0sTUFBTSxZQUFZLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDM0osS0FBSztBQUFRLFlBQUUsSUFBSSxNQUFNLFlBQVksS0FBSyxHQUFHLElBQUksTUFBTSxHQUFHO0FBQUcsWUFBRSxLQUFLLEtBQUssWUFBWSxNQUFNLE1BQU0sSUFBSSxNQUFNLEdBQUc7QUFBRyxZQUFFLEtBQUssTUFBTSxXQUFXLEtBQUssTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUMxSixLQUFLO0FBQWEsWUFBRSxLQUFLLEtBQUssWUFBWSxNQUFNLEdBQUcsS0FBSyxNQUFNLElBQUk7QUFBRyxZQUFFLEtBQUssTUFBTSxZQUFZLE1BQU0sS0FBSyxLQUFLLE1BQU0sSUFBSTtBQUFHLFlBQUUsTUFBTSxLQUFLLFlBQVksS0FBSyxHQUFHLEdBQUc7QUFBRztBQUFBLE1BQ3BLO0FBQUEsSUFDRjtBQUFBLElBQ0EsS0FBSyxNQUFXO0FBQ2QsVUFBSSxDQUFDLEtBQUssT0FBTyxDQUFDLEtBQUssT0FBTyxLQUFLLElBQUksVUFBVSxVQUFXO0FBQzVELGNBQVEsTUFBTTtBQUFBLFFBQ1osS0FBSztBQUFPLGNBQUksQ0FBQyxLQUFLLFNBQVMsT0FBTyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ2hHLEtBQUs7QUFBVSxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBSyxHQUFHLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksS0FBSyxHQUFHLEtBQUssTUFBTSxJQUFJO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLEtBQUssSUFBSTtBQUFHO0FBQUEsUUFDbEssS0FBSztBQUFTLFdBQUMsS0FBSyxLQUFLLEtBQUssSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLEtBQUssSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDdE8sS0FBSztBQUFPLGNBQUksQ0FBQyxLQUFLLFNBQVMsT0FBTyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxNQUFNLFdBQVcsSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsRUFBRTtBQUFHO0FBQUEsUUFDdEksS0FBSztBQUFZLGNBQUksQ0FBQyxLQUFLLFNBQVMsUUFBUSxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxNQUFNLFlBQVksR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxNQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDbEosS0FBSztBQUFTLGVBQUssS0FBSyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUcsRUFBRTtBQUFHLGVBQUssS0FBSyxNQUFNLE1BQU0sV0FBVyxLQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDdkcsS0FBSztBQUFTLGNBQUksQ0FBQyxLQUFLLFNBQVMsU0FBUyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssTUFBTSxLQUFLLFlBQVksTUFBTSxHQUFHLElBQUk7QUFBRztBQUFBLFFBQ3hHLEtBQUs7QUFBUyxjQUFJLENBQUMsS0FBSyxTQUFTLFNBQVMsRUFBRSxFQUFHO0FBQVEsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDaEgsS0FBSztBQUFRLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsS0FBSyxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLEtBQUssTUFBTSxNQUFNLElBQUk7QUFBRyxlQUFLLEtBQUssTUFBTSxNQUFNLFFBQVEsTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUM5SixLQUFLO0FBQVMsZUFBSyxLQUFLLEtBQUssS0FBSyxVQUFVLE1BQU0sR0FBRyxLQUFLLE1BQU0sR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQ25JLEtBQUs7QUFBYSxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsS0FBSyxHQUFHLElBQUksSUFBSTtBQUFHLGVBQUssS0FBSyxHQUFLLE1BQU0sV0FBVyxLQUFNLEdBQUcsR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxNQUFNLEdBQUcsR0FBRztBQUFHO0FBQUEsUUFDM0osS0FBSztBQUFhLFdBQUMsS0FBSyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksS0FBSyxJQUFJLE1BQU0sSUFBSSxNQUFNLEdBQUcsQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQ3pLLEtBQUs7QUFBYSxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxXQUFXLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFVBQVUsTUFBTSxNQUFNLEtBQUssTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUM1SyxLQUFLO0FBQVcsV0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxHQUFHO0FBQUc7QUFBQSxRQUN6SSxLQUFLO0FBQVUsV0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssSUFBSSxLQUFLLFFBQVEsS0FBSyxHQUFHO0FBQUc7QUFBQSxRQUN0SixLQUFLO0FBQVUsV0FBQyxNQUFNLE1BQU0sTUFBTSxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTTtBQUFFLGlCQUFLLEtBQUssTUFBTSxNQUFNLFlBQVksTUFBTSxJQUFJLEtBQUssQ0FBQztBQUFHLGlCQUFLLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxVQUFVLE1BQU0sR0FBRyxRQUFXLE1BQU8sR0FBRztBQUFBLFVBQUcsQ0FBQztBQUFHLFdBQUMsS0FBSyxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sTUFBTSxFQUFFO0FBQUc7QUFBQSxRQUNuWCxLQUFLO0FBQWMsZUFBSyxLQUFLLElBQUksTUFBTSxRQUFRLE1BQU0sR0FBRyxLQUFLLEdBQUc7QUFBRyxlQUFLLEtBQUssTUFBTSxNQUFNLFdBQVcsS0FBSyxHQUFHLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxHQUFLLFlBQVksTUFBTSxLQUFLLEtBQUssR0FBRztBQUFHO0FBQUEsUUFDekssS0FBSztBQUFjLFdBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLEtBQUssSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEtBQU0sR0FBRztBQUFHO0FBQUEsUUFDOUwsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLEtBQUssWUFBWSxNQUFNLEdBQUcsR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLE1BQU0sRUFBRTtBQUFHLFdBQUMsTUFBTSxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBRztBQUFBLFFBQzFNLEtBQUs7QUFBVyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksR0FBSTtBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDbkcsS0FBSztBQUFZLGVBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUN0RyxLQUFLO0FBQVksZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTSxZQUFZLE1BQU0sT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDN0gsS0FBSztBQUFZLGVBQUssS0FBSyxVQUFVO0FBQUcsV0FBQyxLQUFLLEtBQUssS0FBSyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxLQUFLLEdBQUcsRUFBRTtBQUFHO0FBQUEs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RyxHQUFLLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxVQUFVLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxTQUFTLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxVQUFVLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxHQUFHLFFBQVEsQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sVUFBVSxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sU0FBUyxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsQ0FBQyxHQUFHLE1BQU0sa0JBQWtCLENBQUM7QUFBQSxNQUM5ZixDQUFDLGFBQWEsaUJBQWlCLHVCQUF1QixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsR0FBSyxNQUFNLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sWUFBWSxHQUFHLEVBQUUsTUFBTSxTQUFTLE9BQU8sSUFBSSxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxHQUFHLFFBQVEsQ0FBQyxFQUFFLE1BQU0sU0FBUyxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sWUFBWSxDQUFDLEdBQUcsTUFBTSxxQkFBcUIsQ0FBQztBQUFBLE1BQzdaLENBQUMsUUFBUSxZQUFZLGtCQUFrQixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsTUFBTSxNQUFNLEVBQUUsV0FBVyxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUcsUUFBUSxFQUFFLE9BQU8sQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLE1BQU0sR0FBRyxF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QUcsUUFBRSxRQUFRLE9BQU8sQ0FBQztBQUFHLFFBQUUsU0FBUyxJQUFJO0FBQU0sV0FBSyxLQUFLLFFBQVEsQ0FBQyxNQUFPLEVBQUUsU0FBUyxJQUFJLENBQUU7QUFDdkksVUFBSSxLQUFLLFVBQVUsT0FBUSxHQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsSUFBSTtBQUFBLGVBQzFELEtBQUssVUFBVSxPQUFPO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSTtBQUFJLFVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDLElBQUk7QUFBTSxVQUFFLFNBQVMsSUFBSTtBQUFLLGFBQUssS0FBSyxDQUFDLEVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxhQUFLLEtBQUssQ0FBQyxFQUFFLFNBQVMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBSyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBQSxNQUFLLFdBQ3BQLEtBQUssVUFBVSxVQUFVO0FBQUUsY0FBTSxJQUFJLElBQUksTUFBTSxRQUFRLElBQUksT0FBTyxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksSUFBSSxPQUFPLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxLQUFLLENBQUM7QUFBQSxNQUFHLFdBQzFOLEtBQUssVUFBVSxTQUFTO0FBQUUsY0FBTSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUk7QUFBSSxVQUFFLFFBQVEsT0FBTyxPQUFPLE9BQU8sQ0FBQztBQUFHLFVBQUUsU0FBUyxLQUFLLElBQUksS0FBSztBQUFBLE1BQUssV0FDMUgsS0FBSyxVQUFVLFNBQVM7QUFBRSxjQUFNLElBQUksSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLENBQUMsS0FBSyxLQUFLLElB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SUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsVUFBVSxFQUFFLE1BQU0sS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLE1BQU0sRUFBRSxPQUFPLEtBQUssS0FBSyxTQUFTLFFBQVEsV0FBVyxFQUFFLElBQUksQ0FBQztBQUNqTSxXQUFLLEtBQUssTUFBTTtBQUFHLFdBQUssTUFBTSxNQUFNO0FBQUcsV0FBSyxVQUFVLE1BQU07QUFDNUQsV0FBSyxPQUFPLFNBQVMsUUFBUSxDQUFDLE1BQU07QUFDbEMsWUFBSSxFQUFFLFNBQVMsR0FBRztBQUFFLGdCQUFNLElBQUksTUFBTSxFQUFFLEtBQUssQ0FBQztBQUFHLGdCQUFNLElBQUksS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUksZUFBSyxLQUFLLElBQUksRUFBRSxJQUFJLENBQUM7QUFBRyxlQUFLLE1BQU0sSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFO0FBQUcsWUFBRSxNQUFNLENBQUM7QUFBRyxZQUFFLFFBQVEsRUFBRSxVQUFVLElBQUksSUFBSTtBQUFBLFFBQUcsT0FDOUs7QUFBRSxnQkFBTSxJQUFJLGFBQWEsS0FBSyxHQUFHLEVBQUUsTUFBTSxHQUFHLEVBQUUsSUFBSTtBQUFHLFlBQUUsT0FBTyxTQUFTLElBQUksRUFBRSxHQUFHLEdBQUcsRUFBRSxDQUFDO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxDQUFDLEtBQUssS0FBSztBQUFHLGNBQUksRUFBRSxRQUFRLEVBQUUsUUFBUyxHQUFFLFFBQVEsSUFBSTtBQUFHLFlBQUUsS0FBSyxPQUFPO0FBQUcsWUFBRSxNQUFNLENBQUM7QUFBRyxZQUFFLFFBQVEsRUFBRSxVQUFVLElBQUksSUFBSTtBQUFHLGVBQUssS0FBSyxJQUFJLEVBQUUsSUFBSSxDQUFDO0FBQUcsZUFBSyxNQUFNLEtBQUssTUFBTTtBQUFFLGdCQUFJLEVBQUUsVUFBVSxRQUFTLEdBQUUsS0FBSyxNQUFNO0FBQUEsVUFBRyxDQUFDO0FB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QU0sSUFBSSxZQUFZLElBQUksR0FBRyxLQUFLLEtBQUssSUFBSSxPQUFPLElBQUksUUFBUSxHQUFJO0FBQUcsZUFBTztBQUFHLFlBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUFHLGFBQUssTUFBTSxPQUFPO0FBQUEsTUFBRyxDQUFDO0FBQUEsSUFDek07QUFBQSxFQUNGOzs7QUMzbkJBLE1BQU0sSUFBSSxJQUFJLEtBQUs7QUFDbkIsRUFBQyxPQUFlLFNBQVM7QUFDekIsSUFBRSxLQUFLLFNBQVMsZUFBZSxHQUFHLENBQXNCLEVBQ3JELEtBQUssTUFBTTtBQUFFLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksRUFBRyxHQUFFLE1BQU0sVUFBVTtBQUFRLElBQUMsT0FBZSxjQUFjO0FBQU0sV0FBTyxjQUFjLElBQUksTUFBTSxrQkFBa0IsQ0FBQztBQUFBLEVBQUcsQ0FBQyxFQUN0TCxNQUFNLENBQUMsTUFBTTtBQUNaLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksR0FBRztBQUFFLFFBQUUsTUFBTSxVQUFVO0FBQVEsUUFBRSxjQUFjLGFBQWEsS0FBSyxFQUFFLFVBQVUsRUFBRSxVQUFVO0FBQUEsSUFBSTtBQUMvSSxZQUFRLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLENBQUM7IiwKICAibmFtZXMiOiBbImciLCAiY29zdCIsICJlbmVteVBvd2VyIiwgInRnIiwgIk1BWF9VTklUUyIsICJnIiwgImciLCAiZyIsICJLRVkiLCAiVkVSU0lPTiIsICJzdGFnZVdhdmVzIiwgImRyYXciLCAiZyIsICJnIiwgInYiLCAicCJdCn0K
