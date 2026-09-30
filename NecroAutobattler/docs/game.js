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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2dhbWUvYXJlbmEudHMiLCAiLi4vY29yZS9iYXR0bGUudHMiLCAiLi4vY29yZS9lbmRsZXNzLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9kYWlseS50cyIsICIuLi9jb3JlL3BhY2tzLnRzIiwgIi4uL2NvcmUvc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvbmVjcm9tYW5jZXIudHMiLCAiLi4vZ2FtZS9hdWRpby50cyIsICIuLi9jb3JlL3J1bnNhdmUudHMiLCAiLi4vZ2FtZS92aXN1YWxzLnRzIiwgIi4uL3VpL2ljb25zLnRzIiwgIi4uL3VpL3BvcnRyYWl0cy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXTsgZ29sZFRvTGV2ZWw6IG51bWJlcltdIH07XG4gIHNpbTogeyBzZXBhcmF0aW9uOiBudW1iZXI7IGhpdEZyYWN0aW9uOiBudW1iZXI7IHRpbWVMaW1pdDogbnVtYmVyOyByZXRhcmdldEV2ZXJ5OiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRTOiBCYWxhbmNlID0ge1xuICBzdGF0czoge1xuICAgIHdhcnJpb3I6ICAgeyBocDogNjAsICBkbWc6IDgsICBpbnRlcnZhbDogMC45LCByYW5nZTogMC44NSwgc3BlZWQ6IDEuNCwgc2l6ZTogMC4yOCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjQ3IH0sXG4gICAgYXJjaGVyOiAgICB7IGhwOiA0MCwgIGRtZzogNywgIGludGVydmFsOiAxLjcsIHJhbmdlOiA1LjAsICBzcGVlZDogMS4xLCBzaXplOiAwLjI2LCBhbmltTGVuOiAxLjUsIGhpdEZyYWM6IDAuNzggfSxcbiAgICBnb2JsaW46ICAgIHsgaHA6IDQ1LCAgZG1nOiA5LCAgaW50ZXJ2YWw6IDAuOCwgcmFuZ2U6IDAuOCwgIHNwZWVkOiAxLjcsIHNpemU6IDAuMjQsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAga25pZ2h0OiAgICB7IGhwOiAxMzAsIGRtZzogOSwgIGludGVydmFsOiAxLjEsIHJhbmdlOiAwLjksICBzcGVlZDogMS4wLCBzaXplOiAwLjMyLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIG9ncmU6ICAgICAgeyBocDogMTcwLCBkbWc6IDE2LCBpbnRlcnZhbDogMS45LCByYW5nZTogMS4wNSwgc3BlZWQ6IDAuOCwgc2l6ZTogMC40MiwgYW5pbUxlbjogMS4yLCBoaXRGcmFjOiAwLjU1IH0sXG4gICAgYmFyYmFyaWFuOiB7IGhwOiAxMTAsIGRtZzogMTIsIGludGVydmFsOiAwLjksIHJhbmdlOiAwLjksIHNwZWVkOiAxLjUsIHNpemU6IDAuMzAsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gIH0sXG4gIC8vIFwiYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHlcIjogSFAgZ3Jvd3MgZmFzdGVyIHRoYW4gZGFtYWdlIHBlciBzdGFyXG4gIHN0YXI6IHsgaHA6IFsxLCAyLjAsIDMuMl0sIGRtZzogWzEsIDEuNSwgMi4wXSwgc2NhbGU6IFsxLCAxLjEyLCAxLjI1XSB9LFxuICBwaGFsYW54OiB7IHJhZGl1czogMi4wLCBwZXJBbGx5OiAwLjA4LCBtYXhTdGFja3M6IDMgfSxcbiAgLy8gbWFuYSBmaWxscyBmYXN0OiBhIGJhc2ljIGF0dGFjayBnaXZlcyBwZXJBdHRhY2ssIHRha2luZyBhIGhpdCBnaXZlcyBwZXJIaXQ7IGEgZnVsbCBiYXIgZmlyZXMgdGhlIHNraWxsIG9uIHRoZSBuZXh0IGF0dGFjaywgdGhlbiByZXNldHNcbiAgbWFuYToge1xuICAgIGFyY2hlcjogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTcGxpdCBBcnJvdyBhYm91dCBldmVyeSAzcmQgc2hvdFxuICAgIG9ncmU6ICAgeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTbWFzaCBhYm91dCBldmVyeSAzcmQgc3dpbmdcbiAgICBrbmlnaHQ6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMjUsIHBlckhpdDogMTIgfSwgICAgLy8gVGF1bnQgZXZlcnkgfjQgc3dpbmdzLCBzb29uZXIgd2hlbiBoZSBpcyBiZWluZyBoaXRcbiAgfSxcbiAgdm9sbGV5OiB7IHRhcmdldHM6IDMsIHByb2plY3RpbGVTcGVlZDogMTQgfSxcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IDAuNSwgc2Vla1JhZGl1czogNC4wLCB3b3VuZGVkV2VpZ2h0OiAxLjUgfSxcbiAgdGF1bnQ6IHsgZHVyYXRpb246IDMsIHJhZGl1czogNC41IH0sXG4gIHNtYXNoOiB7IG11bHQ6IDIuMCwgcmFkaXVzOiAxLjYgfSxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiAwLjE0LCBtYXhTdGFja3M6IDgsIHJlc2V0QWZ0ZXI6IDAuNiB9LFxuICBsZXZlbDogeyBocDogMC4wOCwgZG1nOiAwLjA4LCBjb3BpZXNUb0xldmVsOiBbNSwgMTAsIDIwLCA0MCwgODAsIDEyMCwgMjAwLCAzMDAsIDUwMF0sIGdvbGRUb0xldmVsOiBbNjAwMCwgMTIwMDAsIDI0MDAwLCA0ODAwMCwgOTYwMDAsIDE2ODAwMCwgMjcwMDAwLCA0MjAwMDAsIDY2MDAwMF0gfSxcbiAgc2ltOiB7IHNlcGFyYXRpb246IDAuNiwgaGl0RnJhY3Rpb246IDAuNDcsIHRpbWVMaW1pdDogMTIwLCByZXRhcmdldEV2ZXJ5OiAwLjUgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBCQUxBTkNFOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRCYWxhbmNlKCk6IHZvaWQge1xuICBjb25zdCBmcmVzaDogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGZyZXNoKSBhcyAoa2V5b2YgQmFsYW5jZSlbXSkgKEJBTEFOQ0UgYXMgYW55KVtrXSA9IChmcmVzaCBhcyBhbnkpW2tdO1xufVxuXG5leHBvcnQgY29uc3QgUk9MRV9URVhUOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnQ2hlYXAgYW5kIGZhc3QuIFRvdWdoZXIgbmVhciBvdGhlciBXYXJyaW9ycy4nLFxuICBhcmNoZXI6ICdGcmFnaWxlLiBTa2lsbDogU3BsaXQgQXJyb3cgaGl0cyAzIGRpZmZlcmVudCBlbmVtaWVzLicsXG4gIGdvYmxpbjogJ0Zhc3QuIEhpdHMgaGFyZGVyIG9uIGVuZW1pZXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLicsXG4gIGtuaWdodDogJ1RhbmsuIFNraWxsOiBUYXVudCBwdWxscyBlbmVtaWVzIG9udG8gaGltLicsXG4gIG9ncmU6ICdTbG93LCBodWdlIGRhbWFnZS4gU2tpbGw6IFNtYXNoLCBhIGJpZyBhcmVhIHNsYW0uJyxcbiAgYmFyYmFyaWFuOiAnU3dpbmdzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgaGl0LicsXG59O1xuXG5leHBvcnQgY29uc3QgU09VTF9OQU1FOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnU2tlbGV0b24gV2FycmlvcicsIGFyY2hlcjogJ1NrZWxldG9uIEFyY2hlcicsIGdvYmxpbjogJ0dvYmxpbicsXG4gIGtuaWdodDogJ0tuaWdodCcsIG9ncmU6ICdPZ3JlJywgYmFyYmFyaWFuOiAnQmFyYmFyaWFuJyxcbn07XG5cbi8qKiBBYmlsaXR5IGJsdXJicyBmb3IgdGhlIFNvdWxzIHBhZ2UsIHdpdGggdGhlIGxpdmUgbnVtYmVycyBmaWxsZWQgaW4uICovXG5leHBvcnQgZnVuY3Rpb24gYWJpbGl0eUluZm8oc291bDogU291bElkKTogeyBraW5kOiAnc2tpbGwnIHwgJ3Bhc3NpdmUnOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZyB9IHtcbiAgY29uc3QgQiA9IEJBTEFOQ0UsIHBjdCA9ICh4OiBudW1iZXIpID0+IE1hdGgucm91bmQoeCAqIDEwMCkgKyAnJSc7XG4gIHN3aXRjaCAoc291bCkge1xuICAgIGNhc2UgJ3dhcnJpb3InOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdQaGFsYW54JywgdGV4dDogYFRha2VzICR7cGN0KEIucGhhbGFueC5wZXJBbGx5KX0gbGVzcyBkYW1hZ2UgZm9yIGVhY2ggb3RoZXIgU2tlbGV0b24gV2FycmlvciB3aXRoaW4gJHtCLnBoYWxhbngucmFkaXVzfW0gKHVwIHRvICR7Qi5waGFsYW54Lm1heFN0YWNrc30pLmAgfTtcbiAgICBjYXNlICdnb2JsaW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdPcHBvcnR1bmlzdCcsIHRleHQ6IGBEZWFscyAke3BjdChCLm9wcG9ydHVuaXN0LmJvbnVzKX0gbW9yZSBkYW1hZ2UgdG8gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2UsIGFuZCBwcmVmZXJzIHN1Y2ggdGFyZ2V0cy5gIH07XG4gICAgY2FzZSAnYmFyYmFyaWFuJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnRnJlbnp5JywgdGV4dDogYEF0dGFja3MgJHtwY3QoQi5mcmVuenkucGVyU3dpbmcpfSBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nICh1cCB0byAke0IuZnJlbnp5Lm1heFN0YWNrc30gdGltZXMpLmAgfTtcbiAgICBjYXNlICdhcmNoZXInOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU3BsaXQgQXJyb3cnLCB0ZXh0OiBgQmFzaWMgc2hvdHMgZmlyZSBvbmUgYXJyb3cuIFdoZW4gbWFuYSBpcyBmdWxsLCB0aGUgbmV4dCBzaG90IGZpcmVzIGF0IHVwIHRvICR7Qi52b2xsZXkudGFyZ2V0c30gZGlmZmVyZW50IGVuZW1pZXMuYCB9O1xuICAgIGNhc2UgJ2tuaWdodCc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdUYXVudCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgZW5lbWllcyB3aXRoaW4gJHtCLnRhdW50LnJhZGl1c31tIG11c3QgYXR0YWNrIGhpbSBmb3IgJHtCLnRhdW50LmR1cmF0aW9ufXMuYCB9O1xuICAgIGNhc2UgJ29ncmUnOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU21hc2gnLCB0ZXh0OiBgV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHN3aW5nIGRlYWxzICR7Qi5zbWFzaC5tdWx0fXggZGFtYWdlIGFuZCBoaXRzIGVuZW1pZXMgbmVhciB0aGUgdGFyZ2V0IGZvciA2MCUgYXMgbXVjaC5gIH07XG4gIH1cbn1cbiIsICIvLyBEZXNpZ24gZGF0YSBzdHJhaWdodCBmcm9tIHRoZSBwbGFuIGRvYy4gQW55dGhpbmcgbWFya2VkIFBMQUNFSE9MREVSIGlzIG5vdCBpbiB0aGUgZG9jIHlldC5cblxuZXhwb3J0IHR5cGUgU291bElkID0gJ3dhcnJpb3InIHwgJ2FyY2hlcicgfCAnZ29ibGluJyB8ICdrbmlnaHQnIHwgJ29ncmUnIHwgJ2JhcmJhcmlhbic7XG5cbmV4cG9ydCBjb25zdCBTT1VMUzogU291bElkW10gPSBbJ3dhcnJpb3InLCAnYXJjaGVyJywgJ2dvYmxpbicsICdrbmlnaHQnLCAnb2dyZScsICdiYXJiYXJpYW4nXTtcblxuLyoqIERvbWluaW9uIGNvc3QgcGVyIHN0YXIgbGV2ZWw6IGluZGV4IDAgPSAxIHN0YXIsIDEgPSAyIHN0YXJzLCAyID0gMyBzdGFycyAoMyBzdGFycyBpcyB0aGUgbWF4KS4gKi9cbmV4cG9ydCBjb25zdCBDT1NUOiBSZWNvcmQ8U291bElkLCBudW1iZXJbXT4gPSB7XG4gIHdhcnJpb3I6IFsyLCAzLCA0XSxcbiAgYXJjaGVyOiBbNCwgNiwgOV0sXG4gIGdvYmxpbjogWzMsIDQsIDZdLFxuICBrbmlnaHQ6IFs1LCA3LCAxMF0sXG4gIG9ncmU6IFs3LCAxMCwgMTVdLFxuICBiYXJiYXJpYW46IFs1LCA3LCAxMF0sIC8vIFBMQUNFSE9MREVSOiB0aGUgZG9jIGhhcyBubyBjb3N0IGZvciB0aGUgc2l4dGggU291bCB5ZXRcbn07XG5cbmV4cG9ydCBjb25zdCBNQVhfU1RBUiA9IDM7XG5leHBvcnQgY29uc3QgR1JJRF9DRUxMUyA9IDEyOyAvLyA0IHggM1xuXG4vKiogRG9taW5pb24gY2FwIHBlciB3YXZlIChpbmRleCAwID0gd2F2ZSAxKS4gKi9cbmV4cG9ydCBjb25zdCBDVVJWRVM6IFJlY29yZDxzdHJpbmcsIG51bWJlcltdPiA9IHtcbiAgLy8gTE9DS0VEIChjb25maXJtZWQpOiArNCBmb3Igd2F2ZXMgMi01LCB0aGVuICszIGZvciB3YXZlcyA2LTEwIC0+IDQwXG4gIGRvYzogWzksIDEzLCAxNywgMjEsIDI1LCAyOCwgMzEsIDM0LCAzNywgNDBdLFxuICAvLyBOT1QgVVNFRDogbWlzcmVtZW1iZXJlZCB2YXJpYW50ICgrMyB0aHJvdWdoIHdhdmUgNiwgdGhlbiArMikgdGhhdCBvbmx5IHJlYWNoZXMgMzIuIEtlcHQgZm9yIGNvbXBhcmlzb24gb25seS5cbiAgcmVjYWxsZWQ6IFs5LCAxMiwgMTUsIDE4LCAyMSwgMjQsIDI2LCAyOCwgMzAsIDMyXSxcbn07XG5cbmV4cG9ydCBjb25zdCBIRUFSVFMgPSAzO1xuZXhwb3J0IGNvbnN0IFNUQVJUX0hBTkQgPSA0O1xuZXhwb3J0IGNvbnN0IFdBVkVTID0gMTA7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnVsZXMge1xuICAvKiogRG9taW5pb24gY2FwIHBlciB3YXZlLiAqL1xuICBjdXJ2ZTogbnVtYmVyW107XG4gIC8qKlxuICAgKiAnZGVwbG95ZWRPbmx5Jzogb25seSB0d28gZGVwbG95ZWQgdW5pdHMgb2YgdGhlIHNhbWUgc3RhciBjYW4gbWVyZ2UgKGRvYyBhcyB3cml0dGVuKS5cbiAgICogJ2hhbmRJbnRvT25lU3Rhcic6IGFkZGl0aW9uYWxseSBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIGJlIHBsYXllZCBvbnRvIGEgZGVwbG95ZWRcbiAgICogMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bCB0byBtZXJnZSBpbW1lZGlhdGVseSAocGF5cyBvbmx5IHRoZSBjb3N0IGRpZmZlcmVuY2UpLlxuICAgKi9cbiAgbWVyZ2U6ICdkZXBsb3llZE9ubHknIHwgJ2hhbmRJbnRvT25lU3Rhcic7XG4gIC8qKiBDYXJkLWluZmxvdyBrbm9icyAoYWxsIG9wdGlvbmFsOyBkZWZhdWx0cyByZXByb2R1Y2UgdGhlIGRvYykuICovXG4gIHN0YXJ0SGFuZD86IG51bWJlcjsgICAgICAgICAgICAvLyBkZWZhdWx0IDRcbiAgZHJhZnRQaWNrcz86IG51bWJlcjsgICAgICAgICAgIC8vIGNhcmRzIGtlcHQgZnJvbSB0aGUgMy1jYXJkIFZpY3RvcnkgRHJhZnQsIGRlZmF1bHQgMVxuICBub3JtYWxEcmF3V2F2ZXM/OiBudW1iZXJbXTsgICAgLy8gd2F2ZXMgKGJlaW5nIGVudGVyZWQpIHRoYXQgYWxzbyBnaXZlIHRoZSBub3JtYWwgcmFuZG9tIGRyYXc7IGRlZmF1bHQgPSBhbGxcbiAgLyoqIFNvdWxzIHRoaXMgcnVuIG1heSBkcmF3IGZyb20gKHRoZSBlcXVpcHBlZCBTb3VsIERlY2ssIG1heCA2KS4gRGVmYXVsdDogZXZlcnkgU291bC4gKi9cbiAgcG9vbD86IFNvdWxJZFtdO1xuICBzdGFnZVdhdmVzPzogbnVtYmVyOyAgICAgICAgICAgLy8gd2F2ZXMgaW4gdGhpcyBzdGFnZTsgZGVmYXVsdCAxMCAodGhlIHBsYXlhYmxlIHByb3RvdHlwZSB1c2VzIDMpXG59XG5cbmV4cG9ydCBjb25zdCBHUklEX0NPTFMgPSA0LCBHUklEX1JPV1MgPSAzOyAgIC8vIDQgeCAzID0gR1JJRF9DRUxMUzsgY29sdW1uIEdSSURfQ09MUy0xIGlzIHRoZSBmcm9udCBsaW5lXG4iLCAiLy8gU21hbGwgc2VlZGVkIFJORyAobXVsYmVycnkzMikuIFNhbWUgc2VlZCAtPiBzYW1lIHJ1biwgc28gYW55IGJ1ZyByZXBvcnQgaXMgcmVwcm9kdWNpYmxlLlxuLy8gYHN0YXRlKClgIC8gdGhlIGByZXN1bWVgIGFyZ3VtZW50IGxldCBhIHNhdmVkIHJ1biBjb250aW51ZSBkcmF3aW5nIGV4YWN0bHkgdGhlIGNhcmRzIGl0IHdvdWxkIGhhdmUgZHJhd24uXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgbmV4dCgpOiBudW1iZXI7ICAgICAgICAgICAgICAvLyBbMCwgMSlcbiAgaW50KG46IG51bWJlcik6IG51bWJlcjsgICAgICAvLyBbMCwgbilcbiAgcGljazxUPihpdGVtczogcmVhZG9ubHkgVFtdKTogVDtcbiAgc2VlZDogbnVtYmVyO1xuICBzdGF0ZSgpOiBudW1iZXI7ICAgICAgICAgICAgIC8vIHRoZSBnZW5lcmF0b3IncyBjdXJyZW50IHBvc2l0aW9uLCBmb3Igc2F2aW5nIGEgcnVuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYWtlUm5nKHNlZWQ6IG51bWJlciwgcmVzdW1lPzogbnVtYmVyKTogUm5nIHtcbiAgbGV0IGEgPSAocmVzdW1lID8/IHNlZWQpID4+PiAwO1xuICBjb25zdCBuZXh0ID0gKCkgPT4ge1xuICAgIGEgPSAoYSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gYTtcbiAgICB0ID0gTWF0aC5pbXVsKHQgXiAodCA+Pj4gMTUpLCB0IHwgMSk7XG4gICAgdCBePSB0ICsgTWF0aC5pbXVsKHQgXiAodCA+Pj4gNyksIHQgfCA2MSk7XG4gICAgcmV0dXJuICgodCBeICh0ID4+PiAxNCkpID4+PiAwKSAvIDQyOTQ5NjcyOTY7XG4gIH07XG4gIHJldHVybiB7XG4gICAgc2VlZCxcbiAgICBuZXh0LFxuICAgIGludDogKG4pID0+IE1hdGguZmxvb3IobmV4dCgpICogbiksXG4gICAgcGljazogKGl0ZW1zKSA9PiBpdGVtc1tNYXRoLmZsb29yKG5leHQoKSAqIGl0ZW1zLmxlbmd0aCldLFxuICAgIHN0YXRlOiAoKSA9PiBhLFxuICB9O1xufVxuIiwgIi8vIFB1cmUgZ2FtZSBydWxlcyBmb3Igb25lIHN0YWdlLiBObyBncmFwaGljcywgbm8gY29tYmF0OiBqdXN0IGNhcmRzLCBEb21pbmlvbiwgZ3JpZCwgbWVyZ2UsIHdhdmVzLCBoZWFydHMuXG4vLyBFdmVyeSBtdXRhdGlvbiBnb2VzIHRocm91Z2ggYSBmdW5jdGlvbiBoZXJlIGFuZCBhcHBlbmRzIHRvIHN0YXRlLmxvZywgc28gcnVucyBjYW4gYmUgcmVwbGF5ZWQgYW5kIGluc3BlY3RlZC5cblxuaW1wb3J0IHsgQ09TVCwgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMsIFNUQVJUX0hBTkQsIFdBVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMsIFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdCB7IGlkOiBudW1iZXI7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7IGZyZXNoPzogYm9vbGVhbiB9ICAgLy8gZnJlc2ggPSBzdW1tb25lZCB0aGlzIGJ1aWxkIHBoYXNlXG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdGUge1xuICBydWxlczogUnVsZXM7XG4gIHJuZzogUm5nO1xuICB3YXZlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAvLyAxLWJhc2VkXG4gIGhlYXJ0czogbnVtYmVyO1xuICBjYXA6IG51bWJlcjtcbiAgaGFuZDogU291bElkW107XG4gIHVuaXRzOiBVbml0W107XG4gIG5leHRJZDogbnVtYmVyO1xuICBkaXNjYXJkVXNlZDogYm9vbGVhbjsgICAgICAgICAvLyBvbmNlLXBlci1idWlsZC1waGFzZSByZWRyYXdcbiAgc3RhdHVzOiAnYnVpbGRpbmcnIHwgJ3dvbicgfCAnbG9zdCc7XG4gIGxvZzogc3RyaW5nW107XG4gIHN0YXRzOiB7IGRyYXduOiBudW1iZXI7IGRpc2NhcmRlZDogbnVtYmVyOyBkaXNtaXNzZWQ6IG51bWJlcjsgbWVyZ2VzOiBudW1iZXI7IGZhaWx1cmVzOiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGNvc3QgPSAoc291bDogU291bElkLCBzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG5leHBvcnQgY29uc3QgY2FyZHNJbiA9IChzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gMiAqKiAoc3RhciAtIDEpOyAgICAgLy8gY2FyZHMgYSB1bml0IGlzIFwid29ydGhcIlxuZXhwb3J0IGNvbnN0IGRvbWluaW9uVXNlZCA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNvc3QodS5zb3VsLCB1LnN0YXIpLCAwKTtcbmV4cG9ydCBjb25zdCBkb21pbmlvbkZyZWUgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5jYXAgLSBkb21pbmlvblVzZWQocyk7XG5cbmZ1bmN0aW9uIGxvZyhzOiBTdGF0ZSwgbXNnOiBzdHJpbmcpIHsgcy5sb2cucHVzaChgW3cke3Mud2F2ZX1dICR7bXNnfWApOyB9XG4vKiogVGhlIFNvdWxzIHRoaXMgcnVuIGRyYXdzIGZyb206IHRoZSBlcXVpcHBlZCBkZWNrLCBvciBldmVyeXRoaW5nIGlmIG5vIGRlY2sgd2FzIGdpdmVuLiAqL1xuZXhwb3J0IGNvbnN0IHBvb2xPZiA9IChzOiBTdGF0ZSk6IFNvdWxJZFtdID0+IChzLnJ1bGVzLnBvb2wgJiYgcy5ydWxlcy5wb29sLmxlbmd0aCA/IHMucnVsZXMucG9vbCA6IFNPVUxTKTtcbmZ1bmN0aW9uIGRyYXcoczogU3RhdGUsIHdoeTogc3RyaW5nLCBub3Q/OiBTb3VsSWQpOiBTb3VsSWQge1xuICBjb25zdCBhbGwgPSBwb29sT2YocyksIG90aGVycyA9IG5vdCA/IGFsbC5maWx0ZXIoKHgpID0+IHggIT09IG5vdCkgOiBhbGw7XG4gIGNvbnN0IHBvb2wgPSBvdGhlcnMubGVuZ3RoID8gb3RoZXJzIDogYWxsOyAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBzd2FwIG5ldmVyIGhhbmRzIHlvdSBiYWNrIHRoZSBTb3VsIHlvdSBnYXZlIHVwICh1bmxlc3MgaXQgaXMgdGhlIG9ubHkgb25lIGVxdWlwcGVkKVxuICBjb25zdCBjID0gcy5ybmcucGljayhwb29sKTtcbiAgcy5oYW5kLnB1c2goYyk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmF3ICR7Y30gKCR7d2h5fSlgKTtcbiAgcmV0dXJuIGM7XG59XG5cbi8qKiBBIG5ldyBidWlsZCBwaGFzZSBiZWdpbnM6IHRoZSBvbmNlLXBlci1waGFzZSBzd2FwIGNvbWVzIGJhY2sgYW5kIG5vdGhpbmcgY291bnRzIGFzIFwic3VtbW9uZWQgdGhpcyByb3VuZFwiLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5ld1BoYXNlKHM6IFN0YXRlKTogdm9pZCB7XG4gIHMuZGlzY2FyZFVzZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIHUuZnJlc2ggPSBmYWxzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld1N0YWdlKHJ1bGVzOiBSdWxlcywgc2VlZDogbnVtYmVyKTogU3RhdGUge1xuICBjb25zdCBzOiBTdGF0ZSA9IHtcbiAgICBydWxlcywgcm5nOiBtYWtlUm5nKHNlZWQpLCB3YXZlOiAxLCBoZWFydHM6IEhFQVJUUywgY2FwOiBydWxlcy5jdXJ2ZVswXSwgaGFuZDogW10sIHVuaXRzOiBbXSwgbmV4dElkOiAxLFxuICAgIGRpc2NhcmRVc2VkOiBmYWxzZSwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IFtdLFxuICAgIHN0YXRzOiB7IGRyYXduOiAwLCBkaXNjYXJkZWQ6IDAsIGRpc21pc3NlZDogMCwgbWVyZ2VzOiAwLCBmYWlsdXJlczogMCB9LFxuICB9O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IChydWxlcy5zdGFydEhhbmQgPz8gU1RBUlRfSEFORCk7IGkrKykgZHJhdyhzLCAnc3RhcnRpbmcgaGFuZCcpO1xuICAvLyBPcGVuaW5nLWhhbmQgc2FmZWd1YXJkOiBtZXJnaW5nIGlzIHRoZSBoZWFydCBvZiB0aGUgZ2FtZSwgc28gdGhlIGZpcnN0IGhhbmQgYWx3YXlzIGhvbGRzIGF0IGxlYXN0IG9uZSBtYXRjaGluZyBwYWlyICh3aXRoIHNpeCBTb3VscywgYWJvdXQgMjglIG9mIHJhbmRvbSBoYW5kcyB3b3VsZCBub3QpLlxuICBpZiAocy5oYW5kLmxlbmd0aCA+PSAyICYmIG5ldyBTZXQocy5oYW5kKS5zaXplID09PSBzLmhhbmQubGVuZ3RoKSB7IGNvbnN0IGsgPSBNYXRoLmZsb29yKHMucm5nLm5leHQoKSAqIChzLmhhbmQubGVuZ3RoIC0gMSkpOyBzLmhhbmRbcy5oYW5kLmxlbmd0aCAtIDFdID0gcy5oYW5kW2tdOyBsb2cocywgYHN0YXJ0aW5nIGhhbmQ6IGxhc3QgY2FyZCBiZWNhbWUgYSBjb3B5IG9mICR7cy5oYW5kW2tdfSBzbyBhIG1lcmdlIGlzIHBvc3NpYmxlYCk7IH1cbiAgcmV0dXJuIHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmcmVlQ2VsbChzOiBTdGF0ZSk6IG51bWJlciB7XG4gIGNvbnN0IHRha2VuID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoIXRha2VuLmhhcyhjKSkgcmV0dXJuIGM7XG4gIHJldHVybiAtMTtcbn1cblxuLy8gLS0tLSBidWlsZC1waGFzZSBhY3Rpb25zIChlYWNoIHJldHVybnMgdHJ1ZSB3aGVuIGl0IGhhcHBlbmVkKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF07XG4gIHJldHVybiBzb3VsICE9PSB1bmRlZmluZWQgJiYgZnJlZUNlbGwocykgPj0gMCAmJiBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNlbGxGcmVlKHM6IFN0YXRlLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgcmV0dXJuIGNlbGwgPj0gMCAmJiBjZWxsIDwgR1JJRF9DRUxMUyAmJiAhcy51bml0cy5zb21lKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpO1xufVxuXG4vKiogU3VtbW9uIGEgaGFuZCBjYXJkIG9udG8gYSBzcGVjaWZpYyBmcmVlIGNlbGwgKGRlZmF1bHQ6IHRoZSBmaXJzdCBmcmVlIG9uZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIGNlbGw/OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5TdW1tb24ocywgaGFuZElkeCkpIHJldHVybiBmYWxzZTtcbiAgaWYgKGNlbGwgIT09IHVuZGVmaW5lZCAmJiAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHU6IFVuaXQgPSB7IGlkOiBzLm5leHRJZCsrLCBzb3VsLCBzdGFyOiAxLCBjZWxsOiBjZWxsID8/IGZyZWVDZWxsKHMpLCBmcmVzaDogdHJ1ZSB9O1xuICBzLnVuaXRzLnB1c2godSk7XG4gIGxvZyhzLCBgc3VtbW9uICR7c291bH0gMSogLT4gY2VsbCAke3UuY2VsbH0gIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VEZXBsb3llZChhOiBVbml0LCBiOiBVbml0KTogYm9vbGVhbiB7XG4gIHJldHVybiBhLmlkICE9PSBiLmlkICYmIGEuc291bCA9PT0gYi5zb3VsICYmIGEuc3RhciA9PT0gYi5zdGFyICYmIGEuc3RhciA8IE1BWF9TVEFSO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VEZXBsb3llZChzOiBTdGF0ZSwgYUlkOiBudW1iZXIsIGJJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGFJZCksIGIgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGJJZCk7XG4gIGlmICghYSB8fCAhYiB8fCAhY2FuTWVyZ2VEZXBsb3llZChhLCBiKSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHUpID0+IHUuaWQgIT09IGIuaWQpO1xuICBhLmZyZXNoID0gISEoYS5mcmVzaCB8fCBiLmZyZXNoKTtcbiAgYS5zdGFyKys7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UgJHthLnNvdWx9ICR7YS5zdGFyIC0gMX0qKyR7YS5zdGFyIC0gMX0qIC0+ICR7YS5zdGFyfSogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0sIGNlbGxzICR7cy51bml0cy5sZW5ndGh9LyR7R1JJRF9DRUxMU30pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogJ2hhbmRJbnRvT25lU3RhcicgcnVsZTogcGxheSBhIDEtc3RhciBjYXJkIG9udG8gYSBkZXBsb3llZCAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMucnVsZXMubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF0sIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghc291bCB8fCAhdSB8fCB1LnNvdWwgIT09IHNvdWwgfHwgdS5zdGFyICE9PSAxKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBjb3N0KHNvdWwsIDIpIC0gY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuTWVyZ2VGcm9tSGFuZChzLCBoYW5kSWR4LCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgdS5zdGFyID0gMjtcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZS1mcm9tLWhhbmQgJHtzb3VsfSAtPiAke3Uuc291bH0gMiogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGlzbWlzcyhzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1KSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYGRpc21pc3MgJHt1LnNvdWx9ICR7dS5zdGFyfSogKHBlcm1hbmVudGx5IHJlbW92ZWQpYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMTogZGlzY2FyZCBhIGhhbmQgY2FyZCBhbmQgZHJhdyBhIHJhbmRvbSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzY2FyZFJlZHJhdyhzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLmRpc2NhcmRVc2VkIHx8IGhhbmRJZHggPCAwIHx8IGhhbmRJZHggPj0gcy5oYW5kLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzY2FyZGVkKys7XG4gIGxvZyhzLCBgc3dhcDogZGlzY2FyZCAke2N9YCk7XG4gIGRyYXcocywgJ3N3YXAnLCBjKTtcbiAgcmV0dXJuIHRydWU7XG59XG5leHBvcnQgY29uc3Qgc3dhcERpc2NhcmQgPSBkaXNjYXJkUmVkcmF3O1xuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIHJldHVybiAhcy5kaXNjYXJkVXNlZCAmJiAhIXUgJiYgIXUuZnJlc2g7ICAgICAgICAgIC8vIGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kXG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAyOiBzZWxsIGEgZGVwbG95ZWQgdW5pdCAobm90IG9uZSBzdW1tb25lZCB0aGlzIHJvdW5kKSBhbmQgZHJhdyBhIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzd2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5Td2FwU2VsbChzLCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgc3dhcDogc2VsbCAke3Uuc291bH0gJHt1LnN0YXJ9KmApO1xuICBkcmF3KHMsICdzd2FwJywgdS5zb3VsKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtb3ZlVW5pdChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUgfHwgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGxvZyhzLCBgbW92ZSAke3Uuc291bH0gY2VsbCAke3UuY2VsbH0gLT4gJHtjZWxsfWApOyB1LmNlbGwgPSBjZWxsOyByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gLS0tLSB3YXZlIHJlc3VsdHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRHJhZnQgY2hvaWNlcyBmb3IgYWZ0ZXIgYSBjbGVhcmVkIHdhdmU6IDMgcmFuZG9tIGNhcmRzLCBkdXBsaWNhdGVzIGFsbG93ZWQuICovXG5leHBvcnQgZnVuY3Rpb24gZHJhZnRPcHRpb25zKHM6IFN0YXRlKTogU291bElkW10ge1xuICBjb25zdCBwID0gcG9vbE9mKHMpO1xuICByZXR1cm4gW3Mucm5nLnBpY2socCksIHMucm5nLnBpY2socCksIHMucm5nLnBpY2socCldO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkOiByYWlzZSB0aGUgY2FwLCByZXNvbHZlIHRoZSBWaWN0b3J5IERyYWZ0LCBkcmF3IDEgbm9ybWFsIGNhcmQuICovXG5leHBvcnQgY29uc3Qgc3RhZ2VXYXZlcyA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnJ1bGVzLnN0YWdlV2F2ZXMgPz8gV0FWRVM7XG5cbi8qKiBTdGVwIDEgb2YgYSBjbGVhcmVkIHdhdmU6IGlzIHRoZSBzdGFnZSBvdmVyPyBJZiBub3QsIHJhaXNlIHRoZSBjYXAgYW5kIHN0YXJ0IHRoZSBuZXh0IGJ1aWxkIHBoYXNlLiBSZXR1cm5zIHRydWUgd2hlbiB0aGUgc3RhZ2UgaXMgd29uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2VXYXZlKHM6IFN0YXRlKTogYm9vbGVhbiB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuIHMuc3RhdHVzID09PSAnd29uJztcbiAgaWYgKHMud2F2ZSA+PSBzdGFnZVdhdmVzKHMpKSB7IHMuc3RhdHVzID0gJ3dvbic7IGxvZyhzLCAnc3RhZ2UgY2xlYXJlZCcpOyByZXR1cm4gdHJ1ZTsgfVxuICBzLndhdmUrKztcbiAgcy5jYXAgPSBzLnJ1bGVzLmN1cnZlW3Mud2F2ZSAtIDFdO1xuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGB3YXZlIGNsZWFyZWQgLT4gY2FwICR7cy5jYXB9YCk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFN0ZXAgMjogdGhlIHBsYXllciBrZXB0IGBpZHhgIGZyb20gdGhlIG9mZmVyZWQgZHJhZnQgY2FyZHMuICovXG5leHBvcnQgZnVuY3Rpb24gdGFrZURyYWZ0KHM6IFN0YXRlLCBvcHRzOiBTb3VsSWRbXSwgaWR4OiBudW1iZXIpOiB2b2lkIHtcbiAgY29uc3QgcGljayA9IG9wdHNbTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBpZHgpKV07XG4gIHMuaGFuZC5wdXNoKHBpY2spOyBzLnN0YXRzLmRyYXduKys7XG4gIGxvZyhzLCBgZHJhZnQgWyR7b3B0cy5qb2luKCcsICcpfV0gLT4gdG9vayAke3BpY2t9YCk7XG59XG5cbi8qKiBTdGVwIDM6IHRoZSBib251cyBub3JtYWwgZHJhdyAob25seSBvbiB0aGUgd2F2ZXMgdGhlIHJ1bGVzIGFsbG93KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxEcmF3KHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcyA/IHMucnVsZXMubm9ybWFsRHJhd1dhdmVzLmluY2x1ZGVzKHMud2F2ZSkgOiB0cnVlKSBkcmF3KHMsICd3YXZlIGNsZWFyJyk7XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQgKGFsbCB0aHJlZSBzdGVwcyBpbiBvbmUgY2FsbCwgZm9yIHNpbXVsYXRpb25zKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhcldhdmUoczogU3RhdGUsIGNob29zZTogKG9wdHM6IFNvdWxJZFtdKSA9PiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKGFkdmFuY2VXYXZlKHMpKSByZXR1cm47XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBsZXQgb3B0cyA9IGRyYWZ0T3B0aW9ucyhzKTtcbiAgY29uc3Qgb2ZmZXJlZCA9IG9wdHMuam9pbignLCAnKTtcbiAgY29uc3QgdG9vazogU291bElkW10gPSBbXTtcbiAgZm9yIChsZXQgcCA9IDA7IHAgPCAocy5ydWxlcy5kcmFmdFBpY2tzID8/IDEpOyBwKyspIHtcbiAgICBjb25zdCBpZHggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGNob29zZShvcHRzKSkpO1xuICAgIHRvb2sucHVzaChvcHRzW2lkeF0pOyBzLmhhbmQucHVzaChvcHRzW2lkeF0pOyBzLnN0YXRzLmRyYXduKys7XG4gICAgb3B0cyA9IG9wdHMuZmlsdGVyKChfLCBpKSA9PiBpICE9PSBpZHgpO1xuICB9XG4gIGxvZyhzLCBgZHJhZnQgWyR7b2ZmZXJlZH1dIC0+IHRvb2sgJHt0b29rLmpvaW4oJywgJyl9YCk7XG4gIG5vcm1hbERyYXcocyk7XG59XG5cbi8qKiBBcm15IHdpcGVkOiBsb3NlIGEgaGVhcnQsIGNhcCBkb2VzIE5PVCByaXNlLCBlbmVtaWVzIHJlc2V0LCArMSBjYXJkLCByZWRyYXcgYWxsb3dlZCBhZ2Fpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmYWlsV2F2ZShzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgcy5oZWFydHMtLTsgcy5zdGF0cy5mYWlsdXJlcysrO1xuICBpZiAocy5oZWFydHMgPD0gMCkgeyBzLnN0YXR1cyA9ICdsb3N0JzsgbG9nKHMsICdubyBoZWFydHMgbGVmdDogc3RhZ2UgbG9zdCcpOyByZXR1cm47IH1cbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgYXJteSB3aXBlZDogaGVhcnRzICR7cy5oZWFydHN9LCBjYXAgc3RheXMgJHtzLmNhcH1gKTtcbiAgZHJhdyhzLCAnZmFpbGVkIGF0dGVtcHQnKTtcbn1cblxuLy8gLS0tLSBpbnZhcmlhbnRzIChjYWxsZWQgYnkgdGhlIHNpbXVsYXRvciBhZnRlciBldmVyeSB3YXZlOyB0aHJvdyB3aXRoIGEgcmVhZGFibGUgbWVzc2FnZSkgLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2hlY2tJbnZhcmlhbnRzKHM6IFN0YXRlKTogdm9pZCB7XG4gIGNvbnN0IGZhaWwgPSAobTogc3RyaW5nKSA9PiB7IHRocm93IG5ldyBFcnJvcihgSU5WQVJJQU5UICR7bX1cXG5gICsgcy5sb2cuc2xpY2UoLTEyKS5qb2luKCdcXG4nKSk7IH07XG4gIGlmIChzLnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIGZhaWwoYG1vcmUgdW5pdHMgKCR7cy51bml0cy5sZW5ndGh9KSB0aGFuIGNlbGxzYCk7XG4gIGNvbnN0IGNlbGxzID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGlmIChjZWxscy5zaXplICE9PSBzLnVuaXRzLmxlbmd0aCkgZmFpbCgndHdvIHVuaXRzIHNoYXJlIGEgY2VsbCcpO1xuICBpZiAoZG9taW5pb25Vc2VkKHMpID4gcy5jYXApIGZhaWwoYGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfSBleGNlZWRzIGNhcCAke3MuY2FwfWApO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgaWYgKHUuc3RhciA8IDEgfHwgdS5zdGFyID4gTUFYX1NUQVIpIGZhaWwoYHVuaXQgc3RhciAke3Uuc3Rhcn0gb3V0IG9mIHJhbmdlYCk7XG4gIC8vIGV2ZXJ5IGRyYXduIGNhcmQgaXMgZWl0aGVyIGluIGhhbmQsIHdvcnRoIGNhcmRzIG9uIHRoZSBmaWVsZCwgZGlzY2FyZGVkLCBvciBkaXNtaXNzZWRcbiAgY29uc3Qgb25GaWVsZCA9IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY2FyZHNJbih1LnN0YXIpLCAwKTtcbiAgY29uc3QgYWNjb3VudGVkID0gcy5oYW5kLmxlbmd0aCArIG9uRmllbGQgKyBzLnN0YXRzLmRpc2NhcmRlZCArIHMuc3RhdHMuZGlzbWlzc2VkO1xuICBpZiAoYWNjb3VudGVkICE9PSBzLnN0YXRzLmRyYXduKSBmYWlsKGBjYXJkIGNvbnNlcnZhdGlvbjogZHJhd24gJHtzLnN0YXRzLmRyYXdufSAhPSBhY2NvdW50ZWQgJHthY2NvdW50ZWR9YCk7XG59XG4iLCAiLy8gVGhlIGJhdHRsZWZpZWxkJ3MgbG9vazogYSB0aWxlZCBjcnlwdCBmbG9vciwgYSBnbG93aW5nIHJ1bmUgY2lyY2xlIGluIHRoZSBtaWRkbGUsIGFuZCBhIGRhcmsgbWlzdHkgc3Vycm91bmQuIFB1cmUgZGVjb3JhdGlvbiAobm8gZ2FtZSBydWxlcykuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuY29uc3QgVElMRV9NRVRSRVMgPSA1OyAgICAvLyBvbmUgcmVwZWF0IG9mIHRoZSBmbG9vciBwaWN0dXJlIGNvdmVycyB0aGlzIG1hbnkgbWV0cmVzLCBzbyBzbGFicyBjb21lIG91dCBhYm91dCBhIG1ldHJlIHdpZGVcblxuLyoqIERyYXcgdGhlIHJ1bmUgY2lyY2xlIG9uY2Ugb250byBhIGNhbnZhczsgaXQgYmVjb21lcyBhIHNlZS10aHJvdWdoIGRlY2FsIG9uIHRoZSBmbG9vci4gKi9cbmZ1bmN0aW9uIHJ1bmVUZXh0dXJlKHNjZW5lOiBhbnkpOiBhbnkge1xuICBjb25zdCBTID0gNTEyLCB0ZXggPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgncnVuZXMnLCB7IHdpZHRoOiBTLCBoZWlnaHQ6IFMgfSwgc2NlbmUsIHRydWUpLCBjID0gdGV4LmdldENvbnRleHQoKTtcbiAgYy5jbGVhclJlY3QoMCwgMCwgUywgUyk7IGMudHJhbnNsYXRlKFMgLyAyLCBTIC8gMik7IGMubGluZUNhcCA9ICdyb3VuZCc7IGMubGluZUpvaW4gPSAncm91bmQnO1xuICBjb25zdCByaW5nID0gKHI6IG51bWJlciwgdzogbnVtYmVyLCBhOiBudW1iZXIpID0+IHsgYy5iZWdpblBhdGgoKTsgYy5hcmMoMCwgMCwgciwgMCwgTWF0aC5QSSAqIDIpOyBjLmxpbmVXaWR0aCA9IHc7IGMuc3Ryb2tlU3R5bGUgPSBgcmdiYSg0NywyMTcsMTY2LCR7YX0pYDsgYy5zdHJva2UoKTsgfTtcbiAgYy5zaGFkb3dDb2xvciA9ICdyZ2JhKDQ3LDIxNywxNjYsMC45KSc7IGMuc2hhZG93Qmx1ciA9IDEwO1xuICByaW5nKDIzNiwgNCwgMC43NSk7IHJpbmcoMjE0LCAyLCAwLjUpOyByaW5nKDEyMCwgMywgMC43KTtcbiAgYy5zdHJva2VTdHlsZSA9ICdyZ2JhKDQ3LDIxNywxNjYsMC43KSc7IGMubGluZVdpZHRoID0gMztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0OyBpKyspIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZvdXIgbG9uZyBzcGlrZXMsIGxpa2UgYSBjb21wYXNzXG4gICAgYy5zYXZlKCk7IGMucm90YXRlKChpICogTWF0aC5QSSkgLyAyICsgTWF0aC5QSSAvIDQpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMzApOyBjLmxpbmVUbygwLCAtMjMwKTsgYy5zdHJva2UoKTtcbiAgICBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygtMTQsIC0xMjApOyBjLmxpbmVUbygwLCAtMTYwKTsgYy5saW5lVG8oMTQsIC0xMjApOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTtcbiAgfVxuICBjLmxpbmVXaWR0aCA9IDI7IGMuc3Ryb2tlU3R5bGUgPSAncmdiYSg0NywyMTcsMTY2LDAuNTUpJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMjsgaSsrKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNtYWxsIHRpY2sgbWFya3MgYmV0d2VlbiB0aGUgdHdvIG91dGVyIHJpbmdzXG4gICAgYy5zYXZlKCk7IGMucm90YXRlKChpICogTWF0aC5QSSkgLyA2KTsgYy5iZWdpblBhdGgoKTsgYy5tb3ZlVG8oMCwgLTIxNCk7IGMubGluZVRvKDAsIC0yMzYpOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTtcbiAgfVxuICB0ZXgudXBkYXRlKCk7IHRleC5oYXNBbHBoYSA9IHRydWU7IHJldHVybiB0ZXg7XG59XG5cbmludGVyZmFjZSBQbGFjZW1lbnQgeyBwcm9wOiBzdHJpbmc7IHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc/OiBudW1iZXI7IHM/OiBudW1iZXIgfVxuLyoqIFdoZXJlIHRoZSBwcm9wcyBzdGFuZC4gVGFsbCB0aGluZ3MgZ28gYmVoaW5kIGFuZCBiZXNpZGUgdGhlIGZpZWxkOyBvbmx5IGxvdyB0aGluZ3MgKGZlbmNlLCBib25lcywgd2FsbCkgc3RhbmQgYmV0d2VlbiB0aGUgY2FtZXJhIGFuZCB0aGUgdW5pdHMuICovXG5jb25zdCBDUllQVF9MQVlPVVQ6IFBsYWNlbWVudFtdID0gW1xuICB7IHByb3A6ICdhcmNoJywgeDogLTYuNSwgejogNi40IH0sIHsgcHJvcDogJ2FyY2gnLCB4OiAwLCB6OiA2LjksIHM6IDEuMTUgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDYuNSwgejogNi40IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMC4yLCB6OiA1LjYsIHlhdzogMC40IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0zLjIsIHo6IDUuOSwgeWF3OiAyLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMy4zLCB6OiA1LjgsIHlhdzogNC4wIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDEwLjIsIHo6IDUuNiwgeWF3OiAxLjIgfSxcbiAgeyBwcm9wOiAnYnJhemllcicsIHg6IC00LjYsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogNC42LCB6OiA1LjIgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IC0xMC41LCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDEwLjUsIHo6IDAuOCB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTguNiwgejogNi4wLCB5YXc6IDAuMSB9LCB7IHByb3A6ICd3YWxsJywgeDogOC42LCB6OiA2LjAsIHlhdzogLTAuMSB9LCB7IHByb3A6ICd3YWxsJywgeDogLTExLjQsIHo6IC0yLjYsIHlhdzogMS40IH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAxMS40LCB6OiAtMi42LCB5YXc6IDEuNyB9LFxuICB7IHByb3A6ICdmZW5jZScsIHg6IC04LjAsIHo6IC00LjYgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNi43LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogNi43LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogOC4wLCB6OiAtNC42IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogLTMuNSwgejogLTQuNCwgeWF3OiAwLjcsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDQuMiwgejogLTQuNiwgeWF3OiAyLjUsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDkuNCwgejogMy4yLCB5YXc6IDEuMCwgczogMC42IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuNiwgejogLTMuNCwgeWF3OiAzLjYsIHM6IDAuNiB9LFxuXTtcbmNvbnN0IEdSQVZFWUFSRF9MQVlPVVQ6IFBsYWNlbWVudFtdID0gWyAgICAgIC8vIGZld2VyIGFyY2hlcywgYSBicm9rZW4gcm93IG9mIGdyYXZlc3RvbmUgcGlsbGFycywgYm9uZXMgZXZlcnl3aGVyZVxuICB7IHByb3A6ICdhcmNoJywgeDogLTkuNSwgejogNi40IH0sIHsgcHJvcDogJ2FyY2gnLCB4OiA5LjUsIHo6IDYuNCB9LFxuICB7IHByb3A6ICdwaWxsYXInLCB4OiAtMTEsIHo6IDUuMiwgeWF3OiAwLjQsIHM6IDAuOSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAtNy42LCB6OiA2LjMsIHlhdzogMi4xIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC00LjQsIHo6IDUuNiwgeWF3OiA0LjAsIHM6IDAuOCB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAtMS4yLCB6OiA2LjUsIHlhdzogMS4yIH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IDIuMiwgejogNS43LCB5YXc6IDMuMSwgczogMC45IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDUuNSwgejogNi40LCB5YXc6IDUuMCB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiA4LjIsIHo6IDUuNSwgeWF3OiAwLjksIHM6IDAuODUgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTEsIHo6IDUuMCwgeWF3OiAyLjYgfSxcbiAgeyBwcm9wOiAnYnJhemllcicsIHg6IC0xMSwgejogMC44IH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAxMSwgejogMC44IH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAwLjYsIHo6IDUuMCwgczogMC45IH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtNS42LCB6OiA2LjYsIHlhdzogMC4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAzLjgsIHo6IDYuNywgeWF3OiAtMC4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTEuNiwgejogLTIuNCwgeWF3OiAxLjUgfSxcbiAgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNC4yLCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogNC40LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogMTEuMiwgejogLTIuMiwgeWF3OiAxLjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiAtNS41LCB6OiA0LjYsIHlhdzogMC43LCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAzLjIsIHo6IDQuNCwgeWF3OiAyLjUsIHM6IDAuNyB9LCB7IHByb3A6ICdib25lcycsIHg6IDguMiwgejogMy4yLCB5YXc6IDEuMCwgczogMC42IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuMiwgejogMy40LCB5YXc6IDMuNiwgczogMC42IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogNywgejogLTQuNSwgeWF3OiAwLjMsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IC03LjQsIHo6IC00LjMsIHlhdzogNC4xLCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAwLjIsIHo6IC00LjgsIHlhdzogNS4yLCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAxMC4yLCB6OiAtMC42LCB5YXc6IDIuMCwgczogMC42IH0sXG5dO1xuY29uc3QgQkFTVElPTl9MQVlPVVQ6IFBsYWNlbWVudFtdID0gWyAgICAgICAgLy8gYSBmb3J0cmVzczogZ2F0ZXMgYmV0d2VlbiBsb25nIHdhbGxzLCBicmF6aWVycyBhbG9uZyB0aGUgYmF0dGxlbWVudHMsIGZlbmNlcyBvbiB0aGUgZmxhbmtzXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtNS44LCB6OiA2LjUsIHM6IDEuMSB9LCB7IHByb3A6ICdhcmNoJywgeDogMCwgejogNy4wLCBzOiAxLjMgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDUuOCwgejogNi41LCBzOiAxLjEgfSxcbiAgeyBwcm9wOiAnd2FsbCcsIHg6IC05LjQsIHo6IDYuMCwgczogMS4zIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMi45LCB6OiA2LjQsIHM6IDEuMiB9LCB7IHByb3A6ICd3YWxsJywgeDogMi45LCB6OiA2LjQsIHM6IDEuMiB9LCB7IHByb3A6ICd3YWxsJywgeDogOS40LCB6OiA2LjAsIHM6IDEuMyB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTEyLjIsIHo6IDIuNiwgeWF3OiAxLjU3LCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDEyLjIsIHo6IDIuNiwgeWF3OiAxLjU3LCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0xMi4yLCB6OiAtMS42LCB5YXc6IDEuNTcgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDEyLjIsIHo6IC0xLjYsIHlhdzogMS41NyB9LFxuICB7IHByb3A6ICdwaWxsYXInLCB4OiAtMTEuMiwgejogNS42LCB5YXc6IDAuNCwgczogMS4xIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDExLjIsIHo6IDUuNiwgeWF3OiAxLjIsIHM6IDEuMSB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTMuMiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAzLjIsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogLTEwLjYsIHo6IDEuMCB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogMTAuNiwgejogMS4wIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtNy4yLCB6OiAtNC42LCBzOiAwLjkgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDcuMiwgejogLTQuNiwgczogMC45IH0sXG4gIHsgcHJvcDogJ2ZlbmNlJywgeDogLTQuNiwgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC0zLjMsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAzLjMsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA0LjYsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAtMTEuNiwgejogLTMuNCwgeWF3OiAxLjUgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAxMS42LCB6OiAtMy40LCB5YXc6IDEuNSB9LFxuICB7IHByb3A6ICdib25lcycsIHg6IC0xLjUsIHo6IC00LjUsIHlhdzogMC43LCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiA5LjQsIHo6IDMuMiwgeWF3OiAxLjAsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IC05LjYsIHo6IC0zLjAsIHlhdzogMy42LCBzOiAwLjUgfSxcbl07XG5cbnR5cGUgQzMgPSBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5pbnRlcmZhY2UgVGhlbWUgeyBsYXlvdXQ6IFBsYWNlbWVudFtdOyBmbG9vcjogQzM7IGZvZzogQzM7IG1pc3Q6IEMzOyB3YWxsOiBDMzsgZmxhbWVBOiBDMzsgZmxhbWVCOiBDMzsgcnVuZTogQzMgfVxuLyoqIE9uZSBsb29rIHBlciBjYW1wYWlnbiBzdGFnZSAoaWRzIG1hdGNoIFNUQUdFUyBpbiBjb3JlL3dhdmVzLnRzKS4gVW5rbm93biBpZHMgdXNlIHRoZSBjcnlwdCBsb29rLiAqL1xuY29uc3QgVEhFTUVTOiBSZWNvcmQ8c3RyaW5nLCBUaGVtZT4gPSB7XG4gIGNyeXB0OiB7IGxheW91dDogQ1JZUFRfTEFZT1VULCBmbG9vcjogWzAuNjIsIDAuNywgMC43XSwgZm9nOiBbMC4wMiwgMC4wNSwgMC4wNl0sIG1pc3Q6IFswLjIsIDAuNiwgMC41NV0sIHdhbGw6IFswLjc1LCAwLjg1LCAwLjldLCBmbGFtZUE6IFswLjM1LCAxLCAwLjhdLCBmbGFtZUI6IFswLjEsIDAuOCwgMC42XSwgcnVuZTogWzAuMTgsIDAuODUsIDAuNjVdIH0sXG4gIGdyYXZleWFyZDogeyBsYXlvdXQ6IEdSQVZFWUFSRF9MQVlPVVQsIGZsb29yOiBbMC42MiwgMC43NCwgMC41Ml0sIGZvZzogWzAuMDMsIDAuMDUsIDAuMDI1XSwgbWlzdDogWzAuNDIsIDAuNiwgMC4yMl0sIHdhbGw6IFswLjcsIDAuODUsIDAuNjJdLCBmbGFtZUE6IFswLjc1LCAxLCAwLjRdLCBmbGFtZUI6IFswLjQsIDAuOCwgMC4yXSwgcnVuZTogWzAuNSwgMC44LCAwLjI1XSB9LFxuICBlbmRsZXNzOiB7IGxheW91dDogQ1JZUFRfTEFZT1VULCBmbG9vcjogWzAuNzgsIDAuNjIsIDAuNjhdLCBmb2c6IFswLjA2LCAwLjAyLCAwLjAzNV0sIG1pc3Q6IFswLjc1LCAwLjMsIDAuNF0sIHdhbGw6IFswLjkyLCAwLjY4LCAwLjc4XSwgZmxhbWVBOiBbMSwgMC42MiwgMC4zXSwgZmxhbWVCOiBbMC45LCAwLjI1LCAwLjE1XSwgcnVuZTogWzAuOSwgMC4zNSwgMC4zXSB9LFxuICBiYXN0aW9uOiB7IGxheW91dDogQkFTVElPTl9MQVlPVVQsIGZsb29yOiBbMC42LCAwLjYyLCAwLjldLCBmb2c6IFswLjAzLCAwLjAzLCAwLjA4XSwgbWlzdDogWzAuNCwgMC40LCAwLjg1XSwgd2FsbDogWzAuNzIsIDAuNzIsIDFdLCBmbGFtZUE6IFswLjYsIDAuNjUsIDFdLCBmbGFtZUI6IFswLjQsIDAuMywgMC45NV0sIHJ1bmU6IFswLjQ1LCAwLjQsIDAuOTVdIH0sXG59O1xuXG5cbi8qKiBCdWlsZCB0aGUgdGVhbCBzb3VsZmlyZSBvdmVyIGEgYnJhemllcjogYSBzbWFsbCBzb2Z0IGZsYW1lIHRoYXQgZmxpY2tlcnMuICovXG5mdW5jdGlvbiBmbGFtZShzY2VuZTogYW55LCB0ZXg6IGFueSwgeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlciwgazogbnVtYmVyLCBhOiBDMywgYjogQzMpOiBhbnkge1xuICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdmaXJlJywgMTgsIHNjZW5lKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGV4OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCB5LCB6KTtcbiAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMjIgKiBrLCAwLCAtMC4yMiAqIGspOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIyICogaywgMCwgMC4yMiAqIGspO1xuICBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xLCAxLCAtMC4xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xLCAxLjQsIDAuMSk7XG4gIHBzLm1pbkxpZmVUaW1lID0gMC41OyBwcy5tYXhMaWZlVGltZSA9IDEuMDsgcHMuZW1pdFJhdGUgPSAyMDsgcHMubWluU2l6ZSA9IDAuMzUgKiBrOyBwcy5tYXhTaXplID0gMC43ICogazsgcHMubWluRW1pdFBvd2VyID0gMC41ICogazsgcHMubWF4RW1pdFBvd2VyID0gMS4wICogaztcbiAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KGFbMF0sIGFbMV0sIGFbMl0sIDAuOSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNChiWzBdLCBiWzFdLCBiWzJdLCAwLjgpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoYlswXSAqIDAuMSwgYlsxXSAqIDAuMywgYlsyXSAqIDAuMywgMCk7XG4gIHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTsgcHMuc3RhcnQoKTsgcmV0dXJuIHBzO1xufVxuXG4vKiogU29mdCByb3VuZCBibG9iIHVzZWQgZm9yIHRoZSBmbGFtZXMuICovXG5mdW5jdGlvbiBnbG93VGV4dHVyZShzY2VuZTogYW55KTogYW55IHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdnbG93JywgeyB3aWR0aDogNjQsIGhlaWdodDogNjQgfSwgc2NlbmUsIHRydWUpLCBjID0gdC5nZXRDb250ZXh0KCksIGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KDMyLCAzMiwgMCwgMzIsIDMyLCAzMik7XG4gIGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDEpJyk7IGcuYWRkQ29sb3JTdG9wKDAuNCwgJ3JnYmEoMjU1LDI1NSwyNTUsMC40NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcbiAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IHQudXBkYXRlKCk7IHQuaGFzQWxwaGEgPSB0cnVlOyByZXR1cm4gdDtcbn1cblxuLyoqIExvYWQgdGhlIHByb3Aga2l0IG9uY2U7IGFwcGx5KHRoZW1lKSB0aGVuIHN0YW5kcyBjb3BpZXMgb2YgZWFjaCBwaWVjZSBhcm91bmQgdGhlIGZpZWxkICh0aGV5IHNoYXJlIG9uZSBtZXNoIGFuZCBvbmUgdGV4dHVyZSwgc28gdGhleSBjb3N0IGFsbW9zdCBub3RoaW5nKS4gKi9cbmFzeW5jIGZ1bmN0aW9uIGxvYWRLaXQoc2NlbmU6IGFueSk6IFByb21pc2U8eyBhcHBseSh0OiBUaGVtZSk6IHZvaWQgfT4ge1xuICBjb25zdCBib3ggPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvYXJlbmEvJywgJ3Byb3BzLmdsYicsIHNjZW5lKTtcbiAgYm94LmFkZEFsbFRvU2NlbmUoKTtcbiAgY29uc3Qgcm9vdCA9IGJveC5tZXNoZXMuZmluZCgobTogYW55KSA9PiBtLm5hbWUgPT09ICdfX3Jvb3RfXycpLCBzcmM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgZm9yIChjb25zdCBtIG9mIGJveC5tZXNoZXMpIGlmIChtLm5hbWUgIT09ICdfX3Jvb3RfXycgJiYgbS5nZXRUb3RhbFZlcnRpY2VzKCkgPiAwKSB7IHNyY1ttLm5hbWVdID0gbTsgbS5zZXRFbmFibGVkKGZhbHNlKTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgY29uc3QgZ2xvdyA9IGdsb3dUZXh0dXJlKHNjZW5lKTsgbGV0IG1hZGU6IHsgaG9sZGVyczogYW55W107IGZpcmVzOiBhbnlbXSB9ID0geyBob2xkZXJzOiBbXSwgZmlyZXM6IFtdIH0sIG4gPSAwO1xuICByZXR1cm4ge1xuICAgIGFwcGx5KHQ6IFRoZW1lKSB7XG4gICAgICBmb3IgKGNvbnN0IGggb2YgbWFkZS5ob2xkZXJzKSBoLmRpc3Bvc2UoKTsgZm9yIChjb25zdCBmIG9mIG1hZGUuZmlyZXMpIGYuZGlzcG9zZShmYWxzZSk7ICAgLy8gZmFsc2U6IGtlZXAgdGhlIHNoYXJlZCBnbG93IHRleHR1cmUgbWFkZSA9IHsgaG9sZGVyczogW10sIGZpcmVzOiBbXSB9O1xuICAgICAgZm9yIChjb25zdCBwIG9mIHQubGF5b3V0KSB7XG4gICAgICAgIGNvbnN0IGJhc2UgPSBzcmNbcC5wcm9wXTsgaWYgKCFiYXNlKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgaW5zdCA9IGJhc2UuY3JlYXRlSW5zdGFuY2UocC5wcm9wICsgbisrKTsgaW5zdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgICAgIGluc3Qucm90YXRpb25RdWF0ZXJuaW9uID0gcm9vdC5yb3RhdGlvblF1YXRlcm5pb24/LmNsb25lKCkgPz8gbnVsbDsgaWYgKCFpbnN0LnJvdGF0aW9uUXVhdGVybmlvbikgaW5zdC5yb3RhdGlvbiA9IHJvb3Qucm90YXRpb24uY2xvbmUoKTsgaW5zdC5zY2FsaW5nID0gcm9vdC5zY2FsaW5nLmNsb25lKCk7XG4gICAgICAgIGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2hvbGRlcicgKyBuLCBzY2VuZSk7IGhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyBob2xkZXIucm90YXRpb24ueSA9IHAueWF3ID8/IDA7IGhvbGRlci5zY2FsaW5nLnNldEFsbChwLnMgPz8gMSk7XG4gICAgICAgIGluc3QucGFyZW50ID0gaG9sZGVyOyBtYWRlLmhvbGRlcnMucHVzaChob2xkZXIpO1xuICAgICAgICBpZiAocC5wcm9wID09PSAnYnJhemllcicpIG1hZGUuZmlyZXMucHVzaChmbGFtZShzY2VuZSwgZ2xvdywgcC54LCAxLjI1ICogKHAucyA/PyAxKSwgcC56LCBwLnMgPz8gMSwgdC5mbGFtZUEsIHQuZmxhbWVCKSk7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQXJlbmEoc2NlbmU6IGFueSwgZ3JvdW5kOiBhbnkpOiB7IHVwZGF0ZSh0OiBudW1iZXIpOiB2b2lkOyBzZXRUaGVtZShzdGFnZTogc3RyaW5nKTogdm9pZCB9IHtcbiAgLy8gLS0tLSBmbG9vclxuICBjb25zdCB0ZXggPSBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvYXJlbmEvZmxvb3Iud2VicCcsIHNjZW5lLCBmYWxzZSwgdHJ1ZSwgQkFCWUxPTi5UZXh0dXJlLlRSSUxJTkVBUl9TQU1QTElOR01PREUpO1xuICB0ZXgudVNjYWxlID0gNjAgLyBUSUxFX01FVFJFUzsgdGV4LnZTY2FsZSA9IDQwIC8gVElMRV9NRVRSRVM7IHRleC5hbmlzb3Ryb3BpY0ZpbHRlcmluZ0xldmVsID0gNDtcbiAgY29uc3QgZ20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdnbScsIHNjZW5lKTsgZ20uZGlmZnVzZVRleHR1cmUgPSB0ZXg7IGdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpO1xuICBnbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC42MiwgMC43LCAwLjcpOyBncm91bmQubWF0ZXJpYWwgPSBnbTtcblxuICAvLyAtLS0tIHJ1bmUgY2lyY2xlIGluIHRoZSBtaWRkbGUgb2YgdGhlIGZpZWxkXG4gIGNvbnN0IGRlY2FsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ3J1bmVzJywgeyB3aWR0aDogNS4yLCBoZWlnaHQ6IDUuMiB9LCBzY2VuZSk7XG4gIGRlY2FsLnBvc2l0aW9uLnkgPSAwLjAxMjsgZGVjYWwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICBjb25zdCBybSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3JtJywgc2NlbmUpOyBybS5kaWZmdXNlVGV4dHVyZSA9IHJ1bmVUZXh0dXJlKHNjZW5lKTsgcm0uZGlmZnVzZVRleHR1cmUuaGFzQWxwaGEgPSB0cnVlOyBybS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7XG4gIHJtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xOCwgMC44NSwgMC42NSk7IHJtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHJtLmFscGhhID0gMC41NTsgcm0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IGRlY2FsLm1hdGVyaWFsID0gcm07XG5cbiAgLy8gLS0tLSBkYXJrIHRlYWwgc3Vycm91bmQgdGhhdCBzd2FsbG93cyB0aGUgZmFyIGVkZ2Ugb2YgdGhlIGZsb29yXG4gIHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wMiwgMC4wNSwgMC4wNiwgMSk7XG4gIHNjZW5lLmZvZ01vZGUgPSBCQUJZTE9OLlNjZW5lLkZPR01PREVfTElORUFSOyBzY2VuZS5mb2dDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAyLCAwLjA1LCAwLjA2KTsgc2NlbmUuZm9nU3RhcnQgPSAyNDsgc2NlbmUuZm9nRW5kID0gNTY7XG5cbiAgY29uc3QgY2F2ZSA9IGJ1aWxkQ2F2ZShzY2VuZSwgdGV4KTtcbiAgbGV0IGtpdDogeyBhcHBseSh0OiBUaGVtZSk6IHZvaWQgfSB8IG51bGwgPSBudWxsLCB3YW50ID0gJ2NyeXB0Jywgc2hvd24gPSAnJztcbiAgY29uc3Qgc2hvdyA9ICgpID0+IHtcbiAgICBjb25zdCB0ID0gVEhFTUVTW3dhbnRdID8/IFRIRU1FUy5jcnlwdDsgaWYgKHdhbnQgPT09IHNob3duICYmIGtpdCkgcmV0dXJuO1xuICAgIGNvbnN0IGNvbCA9IChjOiBDMykgPT4gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pO1xuICAgIGdtLmRpZmZ1c2VDb2xvciA9IGNvbCh0LmZsb29yKTsgY2F2ZS53YWxsTWF0LmRpZmZ1c2VDb2xvciA9IGNvbCh0LndhbGwpOyBybS5lbWlzc2l2ZUNvbG9yID0gY29sKHQucnVuZSk7XG4gICAgZm9yIChjb25zdCBtIG9mIGNhdmUubWlzdE1hdHMpIG0uZW1pc3NpdmVDb2xvciA9IGNvbCh0Lm1pc3QpO1xuICAgIHNjZW5lLmZvZ0NvbG9yID0gY29sKHQuZm9nKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCh0LmZvZ1swXSwgdC5mb2dbMV0sIHQuZm9nWzJdLCAxKTtcbiAgICBpZiAoa2l0KSB7IGtpdC5hcHBseSh0KTsgc2hvd24gPSB3YW50OyB9XG4gIH07XG4gIGxvYWRLaXQoc2NlbmUpLnRoZW4oKGspID0+IHsga2l0ID0gazsgc2hvd24gPSAnJzsgc2hvdygpOyB9KS5jYXRjaCgoZSkgPT4gY29uc29sZS53YXJuKCdhcmVuYSBwcm9wcyBmYWlsZWQnLCBlKSk7XG5cbiAgcmV0dXJuIHsgdXBkYXRlOiAodDogbnVtYmVyKSA9PiB7IHJtLmFscGhhID0gMC40NSArIDAuMTUgKiBNYXRoLnNpbih0ICogMS40KTsgY2F2ZS51cGRhdGUodCk7IH0sIHNldFRoZW1lOiAoc3RhZ2U6IHN0cmluZykgPT4geyB3YW50ID0gc3RhZ2U7IHNob3coKTsgfSB9O1xufVxuXG4vLyAtLS0tIHRoZSBjYXZlOiBhIHJvdWdoIHN0b25lIHdhbGwgYWxsIHRoZSB3YXkgcm91bmQsIHJvY2sgc3BpcmVzIGFsb25nIGl0cyBmb290LCBkcmlmdGluZyBtaXN0LCBhbmQgYSBkYXJrIHZpZ25ldHRlIG9uIHRoZSBmbG9vclxuY29uc3QgUlggPSAyMCwgUlogPSAxNSwgQ1ogPSAtNCwgV0FMTF9IID0gMTY7ICAgLy8gb3ZhbCByaW5nIGNlbnRyZWQgYSBsaXR0bGUgYmVoaW5kIHRoZSBmaWVsZDogdGhlIGZhciB3YWxsIHN0YW5kcyBhYm91dCAxMSBtIHBhc3QgdGhlIGNlbnRyZVxuY29uc3Qgd29iYmxlID0gKGE6IG51bWJlciwgeTogbnVtYmVyKTogbnVtYmVyID0+IE1hdGguc2luKDMgKiBhICsgMS4zKSAqIDAuNSArIE1hdGguc2luKDcgKiBhICsgeSAqIDAuNSkgKiAwLjMgKyBNYXRoLnNpbigxMyAqIGEgLSB5ICogMC4zNSkgKiAwLjIgKyBNYXRoLnNpbigyMyAqIGEgKyB5KSAqIDAuMDg7XG5cbmZ1bmN0aW9uIG1pc3RUZXh0dXJlKHNjZW5lOiBhbnksIHNlZWQ6IG51bWJlcik6IGFueSB7XG4gIGNvbnN0IFMgPSAyNTYsIHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnbWlzdCcgKyBzZWVkLCB7IHdpZHRoOiBTLCBoZWlnaHQ6IFMgfSwgc2NlbmUsIHRydWUpLCBjID0gdC5nZXRDb250ZXh0KCk7XG4gIGMuY2xlYXJSZWN0KDAsIDAsIFMsIFMpO1xuICBsZXQgciA9IHNlZWQgKiA5MzAxICsgNDkyOTc7IGNvbnN0IHJuZCA9ICgpID0+IChyID0gKHIgKiA5MzAxICsgNDkyOTcpICUgMjMzMjgwKSAvIDIzMzI4MDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0NjsgaSsrKSB7XG4gICAgY29uc3QgeCA9IHJuZCgpICogUywgeSA9IHJuZCgpICogUywgcmFkID0gMjYgKyBybmQoKSAqIDQ2O1xuICAgIGZvciAoY29uc3QgZHggb2YgWy1TLCAwLCBTXSkgZm9yIChjb25zdCBkeSBvZiBbLVMsIDAsIFNdKSB7ICAgICAgICAgIC8vIGRyYXcgd3JhcHBlZCBjb3BpZXMgc28gdGhlIHBpY3R1cmUgdGlsZXMgd2l0aCBubyBzZWFtXG4gICAgICBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCh4ICsgZHgsIHkgKyBkeSwgMCwgeCArIGR4LCB5ICsgZHksIHJhZCk7IGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDAuNSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcbiAgICAgIGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCBTLCBTKTtcbiAgICB9XG4gIH1cbiAgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IHRydWU7IHQud3JhcFUgPSB0LndyYXBWID0gQkFCWUxPTi5UZXh0dXJlLldSQVBfQUREUkVTU01PREU7IHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBidWlsZENhdmUoc2NlbmU6IGFueSwgZmxvb3JUZXg6IGFueSk6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHdhbGxNYXQ6IGFueTsgbWlzdE1hdHM6IGFueVtdIH0ge1xuICAvLyByb3VnaCB3YWxsOiBhbiBvdmFsIHJpbmcgd2hvc2UgcmFkaXVzIHdvYmJsZXMgd2l0aCBhbmdsZSBhbmQgaGVpZ2h0LCBkYXJrZXIgdGhlIGhpZ2hlciBpdCBnb2VzXG4gIGNvbnN0IE4gPSAxMjAsIE0gPSAxMiwgcG9zOiBudW1iZXJbXSA9IFtdLCB1djogbnVtYmVyW10gPSBbXSwgY29sOiBudW1iZXJbXSA9IFtdLCBpZHg6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGogPSAwOyBqIDw9IE07IGorKykgZm9yIChsZXQgaSA9IDA7IGkgPD0gTjsgaSsrKSB7XG4gICAgY29uc3QgYSA9IChpIC8gTikgKiBNYXRoLlBJICogMiwgaCA9IChqIC8gTSkgKiBXQUxMX0gsIGsgPSAxICsgMC4wNiAqIHdvYmJsZShhLCBoKSArIChqID09PSAwID8gMCA6IDAuMDUgKiBNYXRoLnNpbihhICogNSArIGopKTtcbiAgICBjb25zdCBvdmVyaGFuZyA9IDEgLSAwLjEgKiBNYXRoLnNpbigoaiAvIE0pICogTWF0aC5QSSk7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gbGVhbnMgaW4gYSBsaXR0bGUgc28gaXQgZmVlbHMgbGlrZSBhIGNhdmVyblxuICAgIHBvcy5wdXNoKE1hdGguY29zKGEpICogUlggKiBrICogb3ZlcmhhbmcsIGgsIENaICsgTWF0aC5zaW4oYSkgKiBSWiAqIGsgKiBvdmVyaGFuZyk7IHV2LnB1c2goKGkgLyBOKSAqIDE0LCAoaiAvIE0pICogMy4yKTtcbiAgICBjb25zdCBiID0gTWF0aC5tYXgoMC4wNiwgMS4wIC0gKGogLyBNKSAqIDAuOSk7IGNvbC5wdXNoKGIgKiAwLjgsIGIsIGIsIDEpO1xuICB9XG4gIGZvciAobGV0IGogPSAwOyBqIDwgTTsgaisrKSBmb3IgKGxldCBpID0gMDsgaSA8IE47IGkrKykgeyBjb25zdCBhID0gaiAqIChOICsgMSkgKyBpLCBiID0gYSArIDEsIGMgPSBhICsgTiArIDEsIGQgPSBjICsgMTsgaWR4LnB1c2goYSwgYywgYiwgYiwgYywgZCk7IH1cbiAgY29uc3Qgd2FsbCA9IG5ldyBCQUJZTE9OLk1lc2goJ2NhdmUnLCBzY2VuZSksIHZkID0gbmV3IEJBQllMT04uVmVydGV4RGF0YSgpOyB2ZC5wb3NpdGlvbnMgPSBwb3M7IHZkLmluZGljZXMgPSBpZHg7IHZkLnV2cyA9IHV2OyB2ZC5jb2xvcnMgPSBjb2w7XG4gIGNvbnN0IG5ybTogbnVtYmVyW10gPSBbXTsgQkFCWUxPTi5WZXJ0ZXhEYXRhLkNvbXB1dGVOb3JtYWxzKHBvcywgaWR4LCBucm0pOyB2ZC5ub3JtYWxzID0gbnJtOyB2ZC5hcHBseVRvTWVzaCh3YWxsKTtcbiAgY29uc3Qgd20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdjYXZlbScsIHNjZW5lKTsgd20uZGlmZnVzZVRleHR1cmUgPSBmbG9vclRleC5jbG9uZSgpOyB3bS5kaWZmdXNlVGV4dHVyZS51U2NhbGUgPSAxOyB3bS5kaWZmdXNlVGV4dHVyZS52U2NhbGUgPSAxO1xuICB3bS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgd20uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IHdtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjg1LCAwLjkpOyB3YWxsLm1hdGVyaWFsID0gd207IHdhbGwuaXNQaWNrYWJsZSA9IGZhbHNlOyB3YWxsLnVzZVZlcnRleENvbG9ycyA9IHRydWU7IHdtLnVzZVZlcnRleENvbG9yID0gdHJ1ZTtcbiAgLy8gcm9jayBzcGlyZXMgc3RhbmRpbmcgYWxvbmcgdGhlIGZvb3Qgb2YgdGhlIHdhbGwgKG9uZSBzaGFyZWQgbWVzaCwgbWFueSBjb3BpZXMpXG4gIGNvbnN0IHNwaXJlID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignc3BpcmUnLCB7IGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogMS42LCBoZWlnaHQ6IDEsIHRlc3NlbGxhdGlvbjogNSB9LCBzY2VuZSk7XG4gIGNvbnN0IHNtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnc3BpcmVtJywgc2NlbmUpOyBzbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4wMywgMC4wNDUsIDAuMDU1KTsgc20uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHNtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4wMDQsIDAuMDEyLCAwLjAxNCk7IHNwaXJlLm1hdGVyaWFsID0gc207XG4gIHNwaXJlLmNvbnZlcnRUb0ZsYXRTaGFkZWRNZXNoKCk7IHNwaXJlLnNldEVuYWJsZWQoZmFsc2UpOyBzcGlyZS5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGxldCByID0gMTIzNDU7IGNvbnN0IHJuZCA9ICgpID0+IChyID0gKHIgKiA5MzAxICsgNDkyOTcpICUgMjMzMjgwKSAvIDIzMzI4MDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0NjsgaSsrKSB7XG4gICAgY29uc3QgYSA9IChpIC8gNDYpICogTWF0aC5QSSAqIDIgKyAocm5kKCkgLSAwLjUpICogMC4xMiwgZCA9IDAuODYgKyBybmQoKSAqIDAuMSwgaGd0ID0gMS40ICsgcm5kKCkgKiAzLjIsIHcgPSAwLjcgKyBybmQoKSAqIDEuMDtcbiAgICBjb25zdCBzID0gc3BpcmUuY3JlYXRlSW5zdGFuY2UoJ3NwJyArIGkpOyBzLmlzUGlja2FibGUgPSBmYWxzZTsgcy5wb3NpdGlvbi5zZXQoTWF0aC5jb3MoYSkgKiBSWCAqIGQsIGhndCAvIDIgLSAwLjIsIENaICsgTWF0aC5zaW4oYSkgKiBSWiAqIGQpO1xuICAgIHMuc2NhbGluZy5zZXQodywgaGd0LCB3KTsgcy5yb3RhdGlvbi55ID0gcm5kKCkgKiA2OyBzLnJvdGF0aW9uLnogPSAocm5kKCkgLSAwLjUpICogMC4xODtcbiAgfVxuICAvLyBtaXN0OiB0d28gc2xvdyBsYXllcnMganVzdCBhYm92ZSB0aGUgZmxvb3JcbiAgY29uc3QgbGF5ZXJzID0gWzAuMjgsIDAuNzVdLm1hcCgoeSwgbikgPT4ge1xuICAgIGNvbnN0IHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgnbWlzdCcgKyBuLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0NCB9LCBzY2VuZSk7IHAucG9zaXRpb24ueSA9IHk7IHAuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdtaXN0bScgKyBuLCBzY2VuZSksIHQgPSBtaXN0VGV4dHVyZShzY2VuZSwgbiArIDMpOyB0LnVTY2FsZSA9IDUgLSBuOyB0LnZTY2FsZSA9IDMuNCAtIG4gKiAwLjY7XG4gICAgbS5kaWZmdXNlVGV4dHVyZSA9IHQ7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4yLCAwLjYsIDAuNTUpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYWxwaGEgPSAwLjE1IC0gbiAqIDAuMDY7IG0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7XG4gICAgbS5kaXNhYmxlRGVwdGhXcml0ZSA9IHRydWU7IHAubWF0ZXJpYWwgPSBtOyBwLmFscGhhSW5kZXggPSA1ICsgbjsgcmV0dXJuIHsgdCwgbiwgbSB9O1xuICB9KTtcbiAgLy8gdmlnbmV0dGU6IGRhcmtlbnMgdGhlIGZsb29yIHRvd2FyZCB0aGUgZWRnZXMgc28gdGhlIGZpZWxkIGxvb2tzIGxpa2UgYSBsaXQgcG9vbCBpbnNpZGUgdGhlIGNhdmVcbiAgY29uc3QgdnQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgndmlnJywgeyB3aWR0aDogMjU2LCBoZWlnaHQ6IDI1NiB9LCBzY2VuZSwgdHJ1ZSksIHZjID0gdnQuZ2V0Q29udGV4dCgpLCBnID0gdmMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMTI4LCAxMjgsIDAsIDEyOCwgMTI4LCAxMjgpO1xuICBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgwLDAsMCwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjQyLCAncmdiYSgwLDAsMCwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjgsICdyZ2JhKDAsNCw2LDAuNyknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMCw0LDYsMC45NSknKTtcbiAgdmMuZmlsbFN0eWxlID0gZzsgdmMuZmlsbFJlY3QoMCwgMCwgMjU2LCAyNTYpOyB2dC51cGRhdGUoKTsgdnQuaGFzQWxwaGEgPSB0cnVlO1xuICBjb25zdCB2aWcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgndmlnJywgeyB3aWR0aDogNDYsIGhlaWdodDogMzAgfSwgc2NlbmUpOyB2aWcucG9zaXRpb24ueSA9IDAuMDM7IHZpZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGNvbnN0IHZtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndmlnbScsIHNjZW5lKTsgdm0uZGlmZnVzZVRleHR1cmUgPSB2dDsgdm0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB2bS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB2bS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAsIDAuMDEsIDAuMDE1KTsgdm0uZGlzYWJsZURlcHRoV3JpdGUgPSB0cnVlOyB2aWcubWF0ZXJpYWwgPSB2bTsgdmlnLmFscGhhSW5kZXggPSAxO1xuICByZXR1cm4geyB3YWxsTWF0OiB3bSwgbWlzdE1hdHM6IGxheWVycy5tYXAoKGwpID0+IGwubSksIHVwZGF0ZTogKHQ6IG51bWJlcikgPT4geyBmb3IgKGNvbnN0IGwgb2YgbGF5ZXJzKSB7IGwudC51T2Zmc2V0ID0gdCAqICgwLjAwNiArIGwubiAqIDAuMDA0KTsgbC50LnZPZmZzZXQgPSB0ICogMC4wMDMgKiAobC5uID8gLTEgOiAxKTsgfSB9IH07XG59XG4iLCAiLy8gQXV0by1iYXR0bGUgc2ltdWxhdGlvbjogcHVyZSBsb2dpYywgbm8gZ3JhcGhpY3MuIERldGVybWluaXN0aWMgZm9yIGEgZ2l2ZW4gc2VlZC5cbi8vIFRoZSByZW5kZXJlciBvbmx5IHJlYWRzIGZpZ2h0ZXJzICsgZXZlbnRzOyBpdCBuZXZlciBkZWNpZGVzIGFueXRoaW5nLlxuLy9cbi8vIEFiaWxpdGllcyAobnVtYmVycyBsaXZlIGluIGJhbGFuY2UudHMpOlxuLy8gICBTa2VsZXRvbiBXYXJyaW9yICBQaGFsYW54ICAgICB0YWtlcyBsZXNzIGRhbWFnZSBmb3IgZWFjaCBuZWFyYnkgYWxsaWVkIFdhcnJpb3IgKGNhcHBlZClcbi8vICAgU2tlbGV0b24gQXJjaGVyICAgU3BsaXQgQXJyb3cgKHNraWxsKSBvbmUgYXJyb3cgYXQgZWFjaCBvZiB1cCB0byAzIGRpZmZlcmVudCBlbmVtaWVzOyBiYXNpYyBzaG90cyBhcmUgYSBzaW5nbGUgYXJyb3dcbi8vICAgR29ibGluICAgICAgICAgICAgT3Bwb3J0dW5pc3QgK2RhbWFnZSBvbiBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZTsgcHJlZmVycyBzdWNoIHRhcmdldHNcbi8vICAgS25pZ2h0ICAgICAgICAgICAgVGF1bnQgKHNraWxsKSAgZm9yY2VzIG5lYXJieSBlbmVtaWVzIHRvIGF0dGFjayBoaW1cbi8vICAgT2dyZSAgICAgICAgICAgICAgU21hc2ggKHNraWxsKSAgaGVhdnkgc2xhbSB0aGF0IGFsc28gaGl0cyBlbmVtaWVzIG5lYXIgdGhlIGltcGFjdFxuLy8gU2tpbGxzIHJ1biBvbiBtYW5hOiBiYXNpYyBhdHRhY2tzIGFuZCBkYW1hZ2UgdGFrZW4gZmlsbCBhIGJhcjsgd2hlbiBmdWxsLCB0aGUgbmV4dCBhdHRhY2sgaXMgdGhlIHNraWxsIGFuZCB0aGUgYmFyIHJlc2V0cy5cbi8vIFdhcnJpb3IsIEdvYmxpbiBhbmQgQmFyYmFyaWFuIGhhdmUgcGFzc2l2ZXMgb25seSAobm8gbWFuYSkuXG4vLyAgIEJhcmJhcmlhbiAgICAgICAgIEZyZW56eSAgICAgIGF0dGFja3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBzd2luZ1xuXG5pbXBvcnQgeyBHUklEX0NPTFMsIEdSSURfUk9XUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi9iYWxhbmNlLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGNvbnN0IEdSSURfU1AgPSAxLjM7ICAgICAvLyBtZXRyZXMgYmV0d2VlbiBncmlkIGNlbGxzXG5leHBvcnQgY29uc3QgRlJPTlRfWCA9IDEuNzsgICAgIC8vIGZyb250IGxpbmUncyBkaXN0YW5jZSBmcm9tIHRoZSBjZW50cmUgbGluZVxuXG5leHBvcnQgaW50ZXJmYWNlIFNsb3QgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY2VsbDogbnVtYmVyIH1cbmV4cG9ydCBpbnRlcmZhY2UgU3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyIH1cblxuLyoqIFdvcmxkIHBvc2l0aW9uIG9mIGEgZ3JpZCBjZWxsIGZvciBhIHRlYW0gKHRlYW0gMCA9IGxlZnQsIGZhY2VzICtYOyB0ZWFtIDEgPSByaWdodCwgZmFjZXMgLVgpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNlbGxQb3ModGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcik6IHsgeDogbnVtYmVyOyB6OiBudW1iZXIgfSB7XG4gIGNvbnN0IHJvdyA9IE1hdGguZmxvb3IoY2VsbCAvIEdSSURfQ09MUyksIGNvbCA9IGNlbGwgJSBHUklEX0NPTFM7XG4gIGNvbnN0IGRlcHRoID0gR1JJRF9DT0xTIC0gMSAtIGNvbDsgICAgICAgICAgICAgICAgICAgICAgIC8vIDAgPSBmcm9udCBsaW5lXG4gIHJldHVybiB7IHg6IChGUk9OVF9YICsgZGVwdGggKiBHUklEX1NQKSAqICh0ZWFtID09PSAwID8gLTEgOiAxKSwgejogKHJvdyAtIChHUklEX1JPV1MgLSAxKSAvIDIpICogR1JJRF9TUCB9O1xufVxuXG5jb25zdCBGUk9OVE5FU1M6IFJlY29yZDxTb3VsSWQsIG51bWJlcj4gPSB7IGtuaWdodDogNSwgb2dyZTogNCwgd2FycmlvcjogMywgYmFyYmFyaWFuOiAzLCBnb2JsaW46IDIsIGFyY2hlcjogMCB9O1xuLyoqIFRoZSBlbmVteSBhcm15IGlzIHBsYWNlZCBhdXRvbWF0aWNhbGx5ICh0YW5rcyB1cCBmcm9udCwgYXJjaGVycyBiZWhpbmQpOyB0aGUgcGxheWVyIG9ubHkgZXZlciBzZWVzIGl0cyBjb21wb3NpdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmVteUNlbGxzKHNwZWNzOiBTcGVjW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IGNlbGxzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ09MUyAqIEdSSURfUk9XUzsgYysrKSBjZWxscy5wdXNoKGMpO1xuICBjZWxscy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgZGEgPSBHUklEX0NPTFMgLSAxIC0gKGEgJSBHUklEX0NPTFMpLCBkYiA9IEdSSURfQ09MUyAtIDEgLSAoYiAlIEdSSURfQ09MUyk7XG4gICAgaWYgKGRhICE9PSBkYikgcmV0dXJuIGRhIC0gZGI7XG4gICAgcmV0dXJuIE1hdGguYWJzKE1hdGguZmxvb3IoYSAvIEdSSURfQ09MUykgLSAxKSAtIE1hdGguYWJzKE1hdGguZmxvb3IoYiAvIEdSSURfQ09MUykgLSAxKTtcbiAgfSk7XG4gIGNvbnN0IG9yZGVyID0gc3BlY3MubWFwKChzLCBpKSA9PiBpKS5zb3J0KChpLCBqKSA9PiBGUk9OVE5FU1Nbc3BlY3Nbal0uc291bF0gLSBGUk9OVE5FU1Nbc3BlY3NbaV0uc291bF0pO1xuICBjb25zdCBvdXQgPSBuZXcgQXJyYXk8bnVtYmVyPihzcGVjcy5sZW5ndGgpO1xuICBvcmRlci5mb3JFYWNoKChpZHgsIGspID0+IHsgb3V0W2lkeF0gPSBjZWxsc1trXTsgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCB0eXBlIEZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhZCc7XG5leHBvcnQgaW50ZXJmYWNlIEZpZ2h0ZXIge1xuICBpZDogbnVtYmVyOyB0ZWFtOiAwIHwgMTsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNlbGw6IG51bWJlcjtcbiAgeDogbnVtYmVyOyB6OiBudW1iZXI7IHlhdzogbnVtYmVyO1xuICBocDogbnVtYmVyOyBtYXhIcDogbnVtYmVyOyBkbWc6IG51bWJlcjsgaW50ZXJ2YWw6IG51bWJlcjsgcmFuZ2U6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXI7XG4gIGFsaXZlOiBib29sZWFuOyBzdGF0ZTogRlN0YXRlO1xuICB0YXJnZXQ6IG51bWJlcjsgcmV0YXJnZXRBdDogbnVtYmVyOyBmb3JjZWRUYXJnZXQ6IG51bWJlcjsgZm9yY2VkVW50aWw6IG51bWJlcjtcbiAgbmV4dEF0dGFjazogbnVtYmVyOyBhdHRhY2tTdGFydDogbnVtYmVyOyBhdHRhY2tEdXI6IG51bWJlcjsgYW5pbVNwZWVkOiBudW1iZXI7IGhpdERvbmU6IGJvb2xlYW47XG4gIG1hbmE6IG51bWJlcjsgbWF4TWFuYTogbnVtYmVyOyBjYXN0aW5nOiBib29sZWFuOyBmcmVuenk6IG51bWJlcjsgZGVhZEF0OiBudW1iZXI7XG59XG5cbmV4cG9ydCB0eXBlIEJFdmVudCA9XG4gIHwgeyB0OiAnc3dpbmcnOyBpZDogbnVtYmVyOyBzcGVlZDogbnVtYmVyOyBkdXI6IG51bWJlciB9XG4gIHwgeyB0OiAnaGl0JzsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlcjsga2luZDogJ21lbGVlJyB8ICdhcnJvdycgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICdhcnJvdyc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2RlYXRoJzsgaWQ6IG51bWJlciB9XG4gIHwgeyB0OiAnY2FzdCc7IGlkOiBudW1iZXI7IHNraWxsOiAnc3BsaXQnIHwgJ3RhdW50JyB8ICdzbWFzaCcgfVxuICB8IHsgdDogJ3RhdW50JzsgaWQ6IG51bWJlciB9XG4gIHwgeyB0OiAnc21hc2gnOyBpZDogbnVtYmVyOyB4OiBudW1iZXI7IHo6IG51bWJlcjsgcjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdmcmVuenknOyBpZDogbnVtYmVyOyBzdGFja3M6IG51bWJlciB9O1xuXG5leHBvcnQgY2xhc3MgQmF0dGxlIHtcbiAgdGltZSA9IDA7XG4gIGZpZ2h0ZXJzOiBGaWdodGVyW10gPSBbXTtcbiAgZXZlbnRzOiBCRXZlbnRbXSA9IFtdO1xuICB3aW5uZXI6IC0xIHwgMCB8IDEgPSAtMTtcbiAgcm5nOiBSbmc7XG4gIHByaXZhdGUgcGVuZGluZzogeyBhdDogbnVtYmVyOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGRtZzogbnVtYmVyIH1bXSA9IFtdO1xuICBwcml2YXRlIG5leHRJZCA9IDE7XG4gIHByaXZhdGUgZW5lbXlQb3dlciA9IDE7XG4gIHByaXZhdGUgZmxpcCA9IGZhbHNlO1xuXG4gIC8qKiBgbGV2ZWxzYDogdGhlIHBsYXllcidzIHBlcm1hbmVudCBTb3VsIGxldmVscyAoaGVhbHRoIGFuZCBkYW1hZ2UgZ3JvdyBhIGxpdHRsZSBwZXIgbGV2ZWwpLiBFbmVtaWVzIG5ldmVyIHVzZSB0aGVtLiAqL1xuICAvKiogYGVuZW15UG93ZXJgOiBoZWFsdGggYW5kIGRhbWFnZSBtdWx0aXBsaWVyIGZvciB0aGUgZW5lbXkgdGVhbSBvbmx5IChzdGFnZSBzdHJlbmd0aDsgMSA9IGFzIHdyaXR0ZW4pLiAqL1xuICBjb25zdHJ1Y3RvcihwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKSB7XG4gICAgdGhpcy5ybmcgPSBtYWtlUm5nKHNlZWQpOyB0aGlzLmVuZW15UG93ZXIgPSBlbmVteVBvd2VyO1xuICAgIGZvciAoY29uc3QgcCBvZiBwbGF5ZXJzKSB0aGlzLmFkZCgwLCBwLnNvdWwsIHAuc3RhciwgcC5jZWxsLCBsZXZlbHM/LltwLnNvdWxdID8/IDEpO1xuICAgIGNvbnN0IGNlbGxzID0gZW5lbXlDZWxscyhlbmVtaWVzKTtcbiAgICBlbmVtaWVzLmZvckVhY2goKGUsIGkpID0+IHRoaXMuYWRkKDEsIGUuc291bCwgZS5zdGFyLCBjZWxsc1tpXSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGQodGVhbTogMCB8IDEsIHNvdWw6IFNvdWxJZCwgc3RhcjogbnVtYmVyLCBjZWxsOiBudW1iZXIsIGxldmVsID0gMSk6IEZpZ2h0ZXIge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbc291bF0sIHAgPSBjZWxsUG9zKHRlYW0sIGNlbGwpO1xuICAgIGNvbnN0IGx2SHAgPSAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQi5sZXZlbC5ocCwgbHZEbWcgPSAxICsgKE1hdGgubWF4KDEsIGxldmVsKSAtIDEpICogQi5sZXZlbC5kbWc7XG4gICAgY29uc3QgcHcgPSB0ZWFtID09PSAxID8gdGhpcy5lbmVteVBvd2VyIDogMTtcbiAgICBjb25zdCBocCA9IHN0LmhwICogQi5zdGFyLmhwW3N0YXIgLSAxXSAqIGx2SHAgKiBwdztcbiAgICBjb25zdCBmOiBGaWdodGVyID0ge1xuICAgICAgaWQ6IHRoaXMubmV4dElkKyssIHRlYW0sIHNvdWwsIHN0YXIsIGNlbGwsIHg6IHAueCwgejogcC56LCB5YXc6IHRlYW0gPT09IDAgPyAwIDogTWF0aC5QSSxcbiAgICAgIGhwLCBtYXhIcDogaHAsIGRtZzogc3QuZG1nICogQi5zdGFyLmRtZ1tzdGFyIC0gMV0gKiBsdkRtZyAqIHB3LCBpbnRlcnZhbDogc3QuaW50ZXJ2YWwsIHJhbmdlOiBzdC5yYW5nZSwgc3BlZWQ6IHN0LnNwZWVkLCByYWRpdXM6IHN0LnNpemUgKiBCLnN0YXIuc2NhbGVbc3RhciAtIDFdLFxuICAgICAgYWxpdmU6IHRydWUsIHN0YXRlOiAnaWRsZScsIHRhcmdldDogLTEsIHJldGFyZ2V0QXQ6IDAsIGZvcmNlZFRhcmdldDogLTEsIGZvcmNlZFVudGlsOiAwLFxuICAgICAgbmV4dEF0dGFjazogdGhpcy5ybmcubmV4dCgpICogMC4zLCBhdHRhY2tTdGFydDogLTksIGF0dGFja0R1cjogMSwgYW5pbVNwZWVkOiAxLCBoaXRGcmFjOiAwLCBoaXREb25lOiB0cnVlLFxuICAgICAgbWFuYTogMCwgbWF4TWFuYTogQi5tYW5hW3NvdWxdPy5tYXggPz8gMCwgY2FzdGluZzogZmFsc2UsIGZyZW56eTogMCwgZGVhZEF0OiAwLFxuICAgIH0gYXMgRmlnaHRlcjtcbiAgICB0aGlzLmZpZ2h0ZXJzLnB1c2goZik7IHJldHVybiBmO1xuICB9XG5cbiAgYnlJZChpZDogbnVtYmVyKTogRmlnaHRlciB8IHVuZGVmaW5lZCB7IHJldHVybiBpZCA8IDAgPyB1bmRlZmluZWQgOiB0aGlzLmZpZ2h0ZXJzW2lkIC0gMV07IH1cbiAgZm9lcyhmOiBGaWdodGVyKTogRmlnaHRlcltdIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMuZmlsdGVyKChvKSA9PiBvLmFsaXZlICYmIG8udGVhbSAhPT0gZi50ZWFtKTsgfVxuICBjb3VudCh0ZWFtOiAwIHwgMSk6IG51bWJlciB7IHJldHVybiB0aGlzLmZpZ2h0ZXJzLnJlZHVjZSgobiwgZikgPT4gbiArIChmLmFsaXZlICYmIGYudGVhbSA9PT0gdGVhbSA/IDEgOiAwKSwgMCk7IH1cbiAgZHJhaW4oKTogQkV2ZW50W10geyBjb25zdCBlID0gdGhpcy5ldmVudHM7IHRoaXMuZXZlbnRzID0gW107IHJldHVybiBlOyB9XG5cbiAgc3RlcChkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMud2lubmVyID49IDApIHJldHVybjtcbiAgICB0aGlzLnRpbWUgKz0gZHQ7IHRoaXMuZmxpcCA9ICF0aGlzLmZsaXA7XG4gICAgLy8gYXJyb3dzIHRoYXQgaGF2ZSBmaW5pc2hlZCBmbHlpbmdcbiAgICBmb3IgKGxldCBpID0gdGhpcy5wZW5kaW5nLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wZW5kaW5nW2ldO1xuICAgICAgaWYgKHRoaXMudGltZSA+PSBwLmF0KSB7XG4gICAgICAgIHRoaXMucGVuZGluZy5zcGxpY2UoaSwgMSk7XG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5ieUlkKHAudG8pLCBmcm9tID0gdGhpcy5ieUlkKHAuZnJvbSk7XG4gICAgICAgIGlmICh0byAmJiB0by5hbGl2ZSAmJiBmcm9tKSB0aGlzLmRhbWFnZSh0bywgcC5kbWcsIGZyb20sICdhcnJvdycpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvcmRlciA9IHRoaXMuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKHRoaXMuZmxpcCkgb3JkZXIucmV2ZXJzZSgpO1xuICAgIGZvciAoY29uc3QgZiBvZiBvcmRlcikgaWYgKGYuYWxpdmUpIHRoaXMudXBkYXRlKGYsIGR0KTtcbiAgICBjb25zdCBhID0gdGhpcy5jb3VudCgwKSwgYiA9IHRoaXMuY291bnQoMSk7XG4gICAgaWYgKCFhIHx8ICFiKSB0aGlzLndpbm5lciA9IGEgPyAwIDogMTtcbiAgICBlbHNlIGlmICh0aGlzLnRpbWUgPj0gQkFMQU5DRS5zaW0udGltZUxpbWl0KSB7XG4gICAgICBjb25zdCBocCA9ICh0OiAwIHwgMSkgPT4gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB0KS5yZWR1Y2UoKG4sIGYpID0+IG4gKyBmLmhwIC8gZi5tYXhIcCwgMCk7XG4gICAgICB0aGlzLndpbm5lciA9IGhwKDApID4gaHAoMSkgPyAwIDogMTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyLWZpZ2h0ZXIgdXBkYXRlXG4gIHByaXZhdGUgdXBkYXRlKGY6IEZpZ2h0ZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW2Yuc291bF07XG4gICAgdGhpcy5zZXBhcmF0ZShmLCBkdCk7XG5cbiAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHtcbiAgICAgIGNvbnN0IHQgPSB0aGlzLnRpbWUgLSBmLmF0dGFja1N0YXJ0O1xuICAgICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAodGcgJiYgdGcuYWxpdmUpIHRoaXMuZmFjZShmLCB0Zy54IC0gZi54LCB0Zy56IC0gZi56LCBkdCk7XG4gICAgICBpZiAoIWYuaGl0RG9uZSAmJiB0ID49IGYuYXR0YWNrRHVyICogc3QuaGl0RnJhYykgeyBmLmhpdERvbmUgPSB0cnVlOyB0aGlzLnJlc29sdmVIaXQoZik7IH1cbiAgICAgIGlmICh0ID49IGYuYXR0YWNrRHVyKSBmLnN0YXRlID0gJ2lkbGUnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFjcXVpcmUoZik7XG4gICAgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpO1xuICAgIGlmICghdGcgfHwgIXRnLmFsaXZlKSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IHJldHVybjsgfVxuICAgIGNvbnN0IGR4ID0gdGcueCAtIGYueCwgZHogPSB0Zy56IC0gZi56LCBkaXN0ID0gTWF0aC5oeXBvdChkeCwgZHopO1xuICAgIHRoaXMuZmFjZShmLCBkeCwgZHosIGR0KTtcbiAgICBpZiAoZGlzdCA8PSBmLnJhbmdlKSB7XG4gICAgICBpZiAodGhpcy50aW1lID49IGYubmV4dEF0dGFjaykgdGhpcy5zdGFydEF0dGFjayhmKTsgZWxzZSB7IGYuc3RhdGUgPSAnaWRsZSc7IHRoaXMuZnJlbnp5RGVjYXkoZik7IH1cbiAgICB9IGVsc2Uge1xuICAgICAgZi5zdGF0ZSA9ICdydW4nOyBsZXQgbXggPSBkeCAvIE1hdGgubWF4KGRpc3QsIDFlLTQpLCBteiA9IGR6IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCk7XG4gICAgICAvLyB3YWxrIEFST1VORCBhbnlvbmUgc3RhbmRpbmcgaW4gdGhlIHdheSAoYWxsaWVzIGFuZCBlbmVtaWVzIGFsaWtlLCBleGNlcHQgdGhlIHRhcmdldCk6IGVhY2ggYmxvY2tlciBhaGVhZCBiZW5kcyB0aGUgaGVhZGluZyBhd2F5IGZyb20gaXRcbiAgICAgIGxldCBzeCA9IDAsIHN6ID0gMDtcbiAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChvID09PSBmIHx8ICFvLmFsaXZlIHx8IG8uaWQgPT09IHRnLmlkKSBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgb3ggPSBvLnggLSBmLngsIG96ID0gby56IC0gZi56LCBhbG9uZyA9IG94ICogbXggKyBveiAqIG16LCByZWFjaCA9IGYucmFkaXVzICsgby5yYWRpdXMgKyAwLjM1O1xuICAgICAgICBpZiAoYWxvbmcgPD0gMCB8fCBhbG9uZyA+IHJlYWNoICsgMC45KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgbGF0ID0gb3ggKiAtbXogKyBveiAqIG14LCBuZWVkID0gZi5yYWRpdXMgKyBvLnJhZGl1cyArIDAuMTI7IGlmIChNYXRoLmFicyhsYXQpID49IG5lZWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBzaWRlID0gbGF0ID09PSAwID8gKGYuaWQgJSAyID8gMSA6IC0xKSA6IChsYXQgPiAwID8gLTEgOiAxKSwgdyA9ICgxIC0gTWF0aC5hYnMobGF0KSAvIG5lZWQpICogKDEgLSBNYXRoLm1heCgwLCBhbG9uZyAtIHJlYWNoKSAvIDAuOSk7XG4gICAgICAgIHN4ICs9IC1teiAqIHNpZGUgKiB3ICogMS42OyBzeiArPSBteCAqIHNpZGUgKiB3ICogMS42O1xuICAgICAgfVxuICAgICAgaWYgKHN4IHx8IHN6KSB7IG14ICs9IHN4OyBteiArPSBzejsgY29uc3QgbCA9IE1hdGguaHlwb3QobXgsIG16KSB8fCAxOyBteCAvPSBsOyBteiAvPSBsOyB9XG4gICAgICBmLnggKz0gbXggKiBmLnNwZWVkICogZHQ7IGYueiArPSBteiAqIGYuc3BlZWQgKiBkdDsgdGhpcy5mcmVuenlEZWNheShmKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZyZW56eURlY2F5KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJyAmJiBmLmZyZW56eSA+IDAgJiYgdGhpcy50aW1lIC0gKGYuYXR0YWNrU3RhcnQgKyBmLmF0dGFja0R1cikgPiBCQUxBTkNFLmZyZW56eS5yZXNldEFmdGVyKSBmLmZyZW56eSA9IDA7XG4gIH1cblxuICBwcml2YXRlIGZhY2UoZjogRmlnaHRlciwgZHg6IG51bWJlciwgZHo6IG51bWJlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChkeCAqIGR4ICsgZHogKiBkeiA8IDFlLTYpIHJldHVybjtcbiAgICBjb25zdCB3YW50ID0gTWF0aC5hdGFuMihkeCwgZHopOyBsZXQgZCA9ICgod2FudCAtIGYueWF3ICsgTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpICsgMiAqIE1hdGguUEkpICUgKDIgKiBNYXRoLlBJKSAtIE1hdGguUEk7XG4gICAgZi55YXcgKz0gTWF0aC5tYXgoLTkgKiBkdCwgTWF0aC5taW4oOSAqIGR0LCBkKSk7XG4gIH1cblxuICAvKipcbiAgICogS2VlcCBmaWdodGVycyBmcm9tIHN0YWNraW5nIHdpdGhvdXQgc2hvdmluZyBhbnlvbmUgYWNyb3NzIHRoZSBtYXAuXG4gICAqIC0gQSBmaWdodGVyIHRoYXQgaXMgc3RhbmRpbmcgYW5kIGZpZ2h0aW5nIGlzIFwicGxhbnRlZFwiOiBpdCBiYXJlbHkgbW92ZXM7IHRoZSBvbmVzIHN0aWxsIFdBTEtJTkcgeWllbGQgdG8gaXQuXG4gICAqIC0gSGVhdmllciB1bml0cyAoT2dyZSwgS25pZ2h0KSBwdXNoIGxpZ2h0ZXIgb25lcyBtb3JlIHRoYW4gdGhlIG90aGVyIHdheSByb3VuZC5cbiAgICogLSBUaGUgdG90YWwgcHVzaCBvbiBvbmUgZmlnaHRlciBpcyBjYXBwZWQgcGVyIHNlY29uZCwgc28gYSBjcm93ZCBjYW4gbmV2ZXIgc2xpZGUgYSB1bml0IGZhci5cbiAgICovXG4gIHByaXZhdGUgc2VwYXJhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IHBsYW50ZWQgPSAodTogRmlnaHRlcikgPT4gdS5zdGF0ZSA9PT0gJ2F0dGFjaycgfHwgdS5zdGF0ZSA9PT0gJ2lkbGUnLCBtYXNzID0gKHU6IEZpZ2h0ZXIpID0+IHUucmFkaXVzICogdS5yYWRpdXM7XG4gICAgbGV0IHB4ID0gMCwgcHogPSAwO1xuICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZpZ2h0ZXJzKSB7XG4gICAgICBpZiAobyA9PT0gZiB8fCAhby5hbGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCBkeCA9IGYueCAtIG8ueCwgZHogPSBmLnogLSBvLnosIG0gPSBNYXRoLmh5cG90KGR4LCBkeiksIHdhbnQgPSAoZi5yYWRpdXMgKyBvLnJhZGl1cykgKiAxLjA1ICsgMC4wODtcbiAgICAgIGlmIChtID49IHdhbnQpIGNvbnRpbnVlO1xuICAgICAgbGV0IHNoYXJlID0gbWFzcyhvKSAvIChtYXNzKGYpICsgbWFzcyhvKSk7ICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgbGlnaHRlciBvbmUgb2YgdGhlIHBhaXIgbW92ZXMgbW9yZVxuICAgICAgY29uc3QgcGYgPSBwbGFudGVkKGYpLCBwbyA9IHBsYW50ZWQobyk7XG4gICAgICBpZiAocGYgJiYgIXBvKSBzaGFyZSAqPSAwLjEyOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZiBpcyBzdGFuZGluZyBpdHMgZ3JvdW5kOiB0aGUgd2Fsa2VyIG8gZ29lcyBhcm91bmRcbiAgICAgIGVsc2UgaWYgKCFwZiAmJiBwbykgc2hhcmUgPSBNYXRoLm1pbigxLCBzaGFyZSAqIDEuNSArIDAuMzUpOyAgICAvLyBmIGlzIHdhbGtpbmcgaW50byBhIHBsYW50ZWQgdW5pdDogZiB5aWVsZHNcbiAgICAgIGVsc2UgaWYgKHBmICYmIHBvKSBzaGFyZSAqPSAwLjM1OyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0d28gc3RhbmRpbmcgdW5pdHMgb3ZlcmxhcCBhIGxpdHRsZTogZWFzZSBhcGFydCB2ZXJ5IHNsb3dseVxuICAgICAgY29uc3QgayA9ICgod2FudCAtIG0pIC8gTWF0aC5tYXgobSwgMWUtMykpICogc2hhcmUgKiAyO1xuICAgICAgcHggKz0gKG0gPCAxZS0zID8gKHRoaXMucm5nLm5leHQoKSAtIDAuNSkgOiBkeCkgKiBrOyBweiArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR6KSAqIGs7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBNYXRoLm1pbigxLCBkdCAqIDYpOyBsZXQgbXggPSBweCAqIHMsIG16ID0gcHogKiBzO1xuICAgIGNvbnN0IGNhcCA9IChwbGFudGVkKGYpID8gMC41IDogMS42KSAqIGR0LCBsZW4gPSBNYXRoLmh5cG90KG14LCBteik7ICAgLy8gbWV0cmVzIHBlciBzZWNvbmQsIHN0YW5kaW5nIHZzIHdhbGtpbmdcbiAgICBpZiAobGVuID4gY2FwKSB7IG14ICo9IGNhcCAvIGxlbjsgbXogKj0gY2FwIC8gbGVuOyB9XG4gICAgZi54ICs9IG14OyBmLnogKz0gbXo7XG4gIH1cblxuICBwcml2YXRlIGFjcXVpcmUoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLmZvcmNlZFRhcmdldCA+PSAwKSB7XG4gICAgICBjb25zdCBmdCA9IHRoaXMuYnlJZChmLmZvcmNlZFRhcmdldCk7XG4gICAgICBpZiAoZnQgJiYgZnQuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5mb3JjZWRVbnRpbCkgeyBmLnRhcmdldCA9IGZ0LmlkOyByZXR1cm47IH1cbiAgICAgIGYuZm9yY2VkVGFyZ2V0ID0gLTE7XG4gICAgfVxuICAgIGNvbnN0IGN1ciA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKGN1ciAmJiBjdXIuYWxpdmUgJiYgdGhpcy50aW1lIDwgZi5yZXRhcmdldEF0KSByZXR1cm47XG4gICAgaWYgKGYuc291bCA9PT0gJ2dvYmxpbicgJiYgY3VyICYmIGN1ci5hbGl2ZSAmJiBNYXRoLmh5cG90KGN1ci54IC0gZi54LCBjdXIueiAtIGYueikgPD0gZi5yYW5nZSAqIDEuMykgcmV0dXJuOyAgIC8vIGFscmVhZHkgaW4gcmVhY2ggb2Ygc29tZW9uZTogaGl0IHRoZW0sIGRvbid0IHdhbmRlciBvZmYgYWZ0ZXIgYSBqdWljaWVyIHRhcmdldFxuICAgIGYucmV0YXJnZXRBdCA9IHRoaXMudGltZSArIEJBTEFOQ0Uuc2ltLnJldGFyZ2V0RXZlcnkgKiAoMC44ICsgMC40ICogdGhpcy5ybmcubmV4dCgpKTtcbiAgICBjb25zdCBmb2VzID0gdGhpcy5mb2VzKGYpOyBpZiAoIWZvZXMubGVuZ3RoKSB7IGYudGFyZ2V0ID0gLTE7IHJldHVybjsgfVxuICAgIGxldCBiZXN0ID0gZm9lc1swXSwgYnMgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG8gb2YgZm9lcykge1xuICAgICAgbGV0IHNjb3JlID0gTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueik7XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykge1xuICAgICAgICAvLyBraWxsLXN0ZWFsOiBwcmVmZXIgbmVhcmJ5IGVuZW1pZXMgYWxyZWFkeSBmaWdodGluZyBvbmUgb2Ygb3VyIGFsbGllcywgYW5kIHdvdW5kZWQgb25lc1xuICAgICAgICBjb25zdCBlbmdhZ2VkID0gdGhpcy5ieUlkKG8udGFyZ2V0KTsgY29uc3QgYnVzeSA9ICEhZW5nYWdlZCAmJiBlbmdhZ2VkLmFsaXZlICYmIGVuZ2FnZWQudGVhbSA9PT0gZi50ZWFtICYmIGVuZ2FnZWQuaWQgIT09IGYuaWQ7XG4gICAgICAgIGlmIChidXN5ICYmIHNjb3JlIDwgQkFMQU5DRS5vcHBvcnR1bmlzdC5zZWVrUmFkaXVzICsgMikgc2NvcmUgLT0gMztcbiAgICAgICAgc2NvcmUgLT0gQkFMQU5DRS5vcHBvcnR1bmlzdC53b3VuZGVkV2VpZ2h0ICogKDEgLSBvLmhwIC8gby5tYXhIcCk7XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJyAmJiBvLmlkID09PSBmLnRhcmdldCkgc2NvcmUgLT0gMS41OyAgIC8vIHN0aWNrIHdpdGggYSB0YXJnZXQgdW5sZXNzIGFub3RoZXIgaXMgY2xlYXJseSBiZXR0ZXJcbiAgICAgIGlmIChzY29yZSA8IGJzKSB7IGJzID0gc2NvcmU7IGJlc3QgPSBvOyB9XG4gICAgfVxuICAgIGYudGFyZ2V0ID0gYmVzdC5pZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRBdHRhY2soZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTsgbGV0IGVmZiA9IGYuaW50ZXJ2YWw7XG4gICAgaWYgKGYuc291bCA9PT0gJ2JhcmJhcmlhbicpIHsgZi5mcmVuenkgPSBNYXRoLm1pbihCLmZyZW56eS5tYXhTdGFja3MsIGYuZnJlbnp5ICsgMSk7IGVmZiA9IGYuaW50ZXJ2YWwgLyAoMSArIGYuZnJlbnp5ICogQi5mcmVuenkucGVyU3dpbmcpOyB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2ZyZW56eScsIGlkOiBmLmlkLCBzdGFja3M6IGYuZnJlbnp5IH0pOyB9XG4gICAgZi5hdHRhY2tEdXIgPSBNYXRoLm1pbihzdC5hbmltTGVuLCBlZmYgKiAwLjk1KTsgZi5hbmltU3BlZWQgPSBzdC5hbmltTGVuIC8gZi5hdHRhY2tEdXI7XG4gICAgZi5hdHRhY2tTdGFydCA9IHRoaXMudGltZTsgZi5uZXh0QXR0YWNrID0gdGhpcy50aW1lICsgTWF0aC5tYXgoZWZmLCBmLmF0dGFja0R1cik7IGYuaGl0RG9uZSA9IGZhbHNlOyBmLnN0YXRlID0gJ2F0dGFjayc7XG4gICAgZi5jYXN0aW5nID0gZi5tYXhNYW5hID4gMCAmJiBmLm1hbmEgPj0gZi5tYXhNYW5hOyBpZiAoZi5jYXN0aW5nKSB7IGYubWFuYSA9IDA7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnY2FzdCcsIGlkOiBmLmlkLCBza2lsbDogZi5zb3VsID09PSAnYXJjaGVyJyA/ICdzcGxpdCcgOiBmLnNvdWwgPT09ICdrbmlnaHQnID8gJ3RhdW50JyA6ICdzbWFzaCcgfSk7IH1cbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3N3aW5nJywgaWQ6IGYuaWQsIHNwZWVkOiBmLmFuaW1TcGVlZCwgZHVyOiBmLmF0dGFja0R1ciB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUhpdChmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0U7IGNvbnN0IHRnID0gdGhpcy5ieUlkKGYudGFyZ2V0KTsgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBNID0gQi5tYW5hW2Yuc291bF07IGlmIChNICYmICFmLmNhc3RpbmcpIGYubWFuYSA9IE1hdGgubWluKE0ubWF4LCBmLm1hbmEgKyBNLnBlckF0dGFjayk7XG4gICAgaWYgKGYuc291bCA9PT0gJ2FyY2hlcicpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmFzaWM6IG9uZSBhcnJvdy4gU2tpbGwgKFNwbGl0IEFycm93KTogb25lIGFycm93IGF0IGVhY2ggb2YgdXAgdG8gMyBkaWZmZXJlbnQgZW5lbWllc1xuICAgICAgY29uc3QgcmVhY2ggPSBmLnJhbmdlICogMS4yNTtcbiAgICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZikubWFwKChvKSA9PiAoeyBvLCBkOiBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KSB9KSkuZmlsdGVyKChlKSA9PiBlLmQgPD0gcmVhY2gpLnNvcnQoKGEsIGIpID0+IGEuZCAtIGIuZCk7XG4gICAgICBjb25zdCBwaWNrZWQgPSBmLmNhc3RpbmcgPyBbdGcsIC4uLmZvZXMubWFwKChlKSA9PiBlLm8pLmZpbHRlcigobykgPT4gby5pZCAhPT0gdGcuaWQpXS5zbGljZSgwLCBCLnZvbGxleS50YXJnZXRzKSA6IFt0Z107XG4gICAgICBmb3IgKGNvbnN0IG8gb2YgcGlja2VkKSB7XG4gICAgICAgIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAuMTUsIE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIC8gQi52b2xsZXkucHJvamVjdGlsZVNwZWVkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnB1c2goeyBhdDogdGhpcy50aW1lICsgZHVyLCBmcm9tOiBmLmlkLCB0bzogby5pZCwgZG1nOiBmLmRtZyB9KTtcbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdhcnJvdycsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkdXIgfSk7XG4gICAgICB9XG4gICAgICBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5oeXBvdCh0Zy54IC0gZi54LCB0Zy56IC0gZi56KSA+IGYucmFuZ2UgKiAxLjUpIHsgZi5jYXN0aW5nID0gZmFsc2U7IHJldHVybjsgfSAgIC8vIHRhcmdldCBzbGlwcGVkIGF3YXk6IHRoZSBibG93IG1pc3Nlc1xuICAgIGxldCBkbWcgPSBmLmRtZztcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJykgeyBjb25zdCBlbmcgPSB0aGlzLmJ5SWQodGcudGFyZ2V0KTsgaWYgKGVuZyAmJiBlbmcuYWxpdmUgJiYgZW5nLnRlYW0gPT09IGYudGVhbSAmJiBlbmcuaWQgIT09IGYuaWQpIGRtZyAqPSAxICsgQi5vcHBvcnR1bmlzdC5ib251czsgfVxuICAgIGlmIChmLmNhc3RpbmcpIHtcbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGYuc291bCA9PT0gJ29ncmUnKSB7XG4gICAgICAgIGRtZyAqPSBCLnNtYXNoLm11bHQ7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc21hc2gnLCBpZDogZi5pZCwgeDogdGcueCwgejogdGcueiwgcjogQi5zbWFzaC5yYWRpdXMgfSk7XG4gICAgICAgIGZvciAoY29uc3QgbyBvZiB0aGlzLmZvZXMoZikpIGlmIChvLmlkICE9PSB0Zy5pZCAmJiBNYXRoLmh5cG90KG8ueCAtIHRnLngsIG8ueiAtIHRnLnopIDw9IEIuc21hc2gucmFkaXVzKSB0aGlzLmRhbWFnZShvLCBkbWcgKiAwLjYsIGYsICdzbWFzaCcpO1xuICAgICAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnc21hc2gnKTsgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGYuc291bCA9PT0gJ2tuaWdodCcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIDw9IEIudGF1bnQucmFkaXVzKSB7IG8uZm9yY2VkVGFyZ2V0ID0gZi5pZDsgby5mb3JjZWRVbnRpbCA9IHRoaXMudGltZSArIEIudGF1bnQuZHVyYXRpb247IG8ucmV0YXJnZXRBdCA9IDA7IH1cbiAgICAgICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICd0YXVudCcsIGlkOiBmLmlkIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmRhbWFnZSh0ZywgZG1nLCBmLCAnbWVsZWUnKTtcbiAgfVxuXG4gIHByaXZhdGUgZGFtYWdlKHQ6IEZpZ2h0ZXIsIGFtb3VudDogbnVtYmVyLCBmcm9tOiBGaWdodGVyLCBraW5kOiAnbWVsZWUnIHwgJ2Fycm93JyB8ICdzbWFzaCcpOiB2b2lkIHtcbiAgICBpZiAoIXQuYWxpdmUpIHJldHVybjtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgbGV0IHJlZCA9IDA7XG4gICAgaWYgKHQuc291bCA9PT0gJ3dhcnJpb3InKSB7XG4gICAgICBjb25zdCBuID0gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgbyAhPT0gdCAmJiBvLnRlYW0gPT09IHQudGVhbSAmJiBvLnNvdWwgPT09ICd3YXJyaW9yJyAmJiBNYXRoLmh5cG90KG8ueCAtIHQueCwgby56IC0gdC56KSA8PSBCLnBoYWxhbngucmFkaXVzKS5sZW5ndGg7XG4gICAgICByZWQgPSBNYXRoLm1pbihCLnBoYWxhbngubWF4U3RhY2tzLCBuKSAqIEIucGhhbGFueC5wZXJBbGx5O1xuICAgIH1cbiAgICBjb25zdCBkbWcgPSBhbW91bnQgKiAoMSAtIHJlZCk7IHQuaHAgLT0gZG1nO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbdC5zb3VsXTsgaWYgKE0gJiYgdC5ocCA+IDApIHQubWFuYSA9IE1hdGgubWluKE0ubWF4LCB0Lm1hbmEgKyBNLnBlckhpdCk7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdoaXQnLCBmcm9tOiBmcm9tLmlkLCB0bzogdC5pZCwgZG1nLCBraW5kIH0pO1xuICAgIGlmICh0LmhwIDw9IDApIHsgdC5ocCA9IDA7IHQuYWxpdmUgPSBmYWxzZTsgdC5zdGF0ZSA9ICdkZWFkJzsgdC5kZWFkQXQgPSB0aGlzLnRpbWU7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZGVhdGgnLCBpZDogdC5pZCB9KTsgfVxuICB9XG59XG5cbi8qKiBSdW4gYSB3aG9sZSBmaWdodCB3aXRob3V0IGFueSBncmFwaGljcy4gUmV0dXJucyB3aG8gd29uIGFuZCBob3cgaXQgd2VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW11bGF0ZShwbGF5ZXJzOiBTbG90W10sIGVuZW1pZXM6IFNwZWNbXSwgc2VlZCA9IDEsIG1heFNlY29uZHMgPSAxMzAsIGxldmVscz86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4sIGVuZW15UG93ZXIgPSAxKTogeyB3aW5uZXI6IDAgfCAxOyB0aW1lOiBudW1iZXI7IGxlZnQ6IG51bWJlcjsgaHBMZWZ0OiBudW1iZXIgfSB7XG4gIGNvbnN0IGIgPSBuZXcgQmF0dGxlKHBsYXllcnMsIGVuZW1pZXMsIHNlZWQsIGxldmVscywgZW5lbXlQb3dlcik7XG4gIHdoaWxlIChiLndpbm5lciA8IDAgJiYgYi50aW1lIDwgbWF4U2Vjb25kcykgYi5zdGVwKDEgLyAzMCk7XG4gIGNvbnN0IHcgPSAoYi53aW5uZXIgPCAwID8gMSA6IGIud2lubmVyKSBhcyAwIHwgMTtcbiAgY29uc3QgbWluZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlICYmIGYudGVhbSA9PT0gdyk7XG4gIHJldHVybiB7IHdpbm5lcjogdywgdGltZTogYi50aW1lLCBsZWZ0OiBtaW5lLmxlbmd0aCwgaHBMZWZ0OiBtaW5lLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKSB9O1xufVxuIiwgIi8vIEVuZGxlc3MgRGVwdGhzOiBlbmVteSB3YXZlcyBidWlsdCBmcm9tIGEgQlVER0VUIGluc3RlYWQgb2YgYSBoYW5kLXdyaXR0ZW4gbGlzdCwgc28gdGhlIG1vZGUgbmV2ZXIgcnVucyBvdXQgb2Ygd2F2ZXMuXG4vLyBUaGUgYnVkZ2V0IGlzIHRoZSBlbmVteSB0ZWFtJ3MgdG90YWwgRG9taW5pb24gY29zdCAodGhlIHNhbWUgQ09TVCB0YWJsZSB0aGUgcGxheWVyIHBheXMgZnJvbSkuIFdhdmVzIGFyZSBidWlsdCBmcm9tIHJvbGUgVEVNUExBVEVTIHNvIHRoZXlcbi8vIGxvb2sgZGVzaWduZWQgKGEgZnJvbnQgbGluZSB3aXRoIGFyY2hlcnMgYmVoaW5kLCBhIHN3YXJtLCBhIGJydXRlIHNxdWFkKSBpbnN0ZWFkIG9mIGEgcmFuZG9tIHBpbGUuIEV2ZXJ5dGhpbmcgaXMgc2VlZGVkOiB0aGUgc2FtZSBzZWVkIGdpdmVzXG4vLyB0aGUgc2FtZSB3YXZlcywgc28gYSByZXRyeSAob3IgYSBkYWlseSBzZWVkKSBmYWNlcyBleGFjdGx5IHRoZSBzYW1lIGFybXkuXG4vL1xuLy8gVGhlIHBsYXllcidzIGFybXkgaXMgY2FwcGVkIG9uIHB1cnBvc2UgKERvbWluaW9uIHN0b3BzIGF0IDQwLCB0aGUgZ3JpZCBob2xkcyAxMiksIHNvIGF0IHNvbWUgcG9pbnQgdGhlIGVuZW15IHNpbXBseSBvdXQtc2NhbGVzIGl0OiB0aGF0IGlzIHRoZVxuLy8gXCJoYXJkIHdhbGxcIi4gT25jZSB0aGUgYnVkZ2V0IGZpbGxzIHRoZSAxMiBzbG90cyB3aXRoIHVwZ3JhZGVkIHVuaXRzLCBgZW5kbGVzc1Bvd2VyYCAodGhlIGhpZGRlbiBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIpIGtlZXBzIGNsaW1iaW5nLlxuLy8gTnVtYmVycyBoZXJlIGFyZSB0dW5lZCB3aXRoIHNpbS9lbmRsZXNzX2N1cnZlLnRzLlxuXG5pbXBvcnQgeyBDT1NUIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IG1ha2VSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5pbXBvcnQgdHlwZSB7IEVuZW15U3BlYyB9IGZyb20gJy4vd2F2ZXMudHMnO1xuXG5leHBvcnQgY29uc3QgRU5ETEVTU19JRCA9ICdlbmRsZXNzJztcbi8qKiBBIHBhY2sgaXMgZ3JhbnRlZCBldmVyeSB0aGlzLW1hbnkgd2F2ZXMgY2xlYXJlZCBpbiBhbiBlbmRsZXNzIHJ1bi4gKi9cbmV4cG9ydCBjb25zdCBFTkRMRVNTX1BBQ0tfRVZFUlkgPSAxMDtcbmNvbnN0IE1BWF9VTklUUyA9IDEyO1xuXG4vKiogVGhlIHR1bmluZyBrbm9icyAoc2ltL2VuZGxlc3NfY3VydmUudHMgc3dlZXBzIHRoZW0pLiAqL1xuZXhwb3J0IGNvbnN0IFRVTkUgPSB7IHN0YXJ0OiA1LCBzbG9wZTogMy4wLCBsYXRlU2xvcGU6IDAuOCwgbWF4QnVkZ2V0OiAxNTAsIHBvd2VyU2xvcGU6IDAuMDEyLCBjaGFtcGlvbjogMS4wIH07XG4vKiogVG90YWwgRG9taW5pb24gY29zdCBvZiB0aGUgZW5lbXkgdGVhbSBhdCB3YXZlIGBuYCAoMS1iYXNlZCk6IGEgZ2VudGxlIHN0YXJ0IChhYm91dCB0aGUgTm9ybWFsIGNhbXBhaWduIGJ5IHdhdmUgMTApLCB0aGVuIGl0IGtlZXBzIHJpc2luZy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzQnVkZ2V0KG46IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHcgPSBNYXRoLm1heCgxLCBuKSwgZWFybHkgPSBUVU5FLnN0YXJ0ICsgVFVORS5zbG9wZSAqIChNYXRoLm1pbih3LCAxMCkgLSAxKTtcbiAgcmV0dXJuIE1hdGgucm91bmQoTWF0aC5taW4oVFVORS5tYXhCdWRnZXQsIGVhcmx5ICsgKHcgPiAxMCA/IFRVTkUubGF0ZVNsb3BlICogKHcgLSAxMCkgOiAwKSkpO1xufVxuLyoqIEhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXI6IDEuMCB0aHJvdWdoIHdhdmUgMTAsIHRoZW4gcmlzaW5nOyBldmVyeSAxMHRoIChjaGFtcGlvbikgd2F2ZSBnZXRzIGEgbGl0dGxlIGV4dHJhLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NQb3dlcihuOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgbiksIGJhc2UgPSB3IDw9IDEwID8gMSA6IDEgKyBUVU5FLnBvd2VyU2xvcGUgKiAodyAtIDEwKTtcbiAgcmV0dXJuICsodyAlIDEwID09PSAwID8gYmFzZSAqIFRVTkUuY2hhbXBpb24gOiBiYXNlKS50b0ZpeGVkKDMpO1xufVxuLyoqIFBhY2sgdGllciBmb3IgY2xlYXJpbmcgd2F2ZSBgbmAgKG9ubHkgbWVhbmluZ2Z1bCB3aGVuIG4gaXMgYSBtdWx0aXBsZSBvZiBFTkRMRVNTX1BBQ0tfRVZFUlkpLiAqL1xuZXhwb3J0IGNvbnN0IGVuZGxlc3NQYWNrVGllciA9IChuOiBudW1iZXIpOiBudW1iZXIgPT4gKG4gPj0gMzAgPyAzIDogbiA+PSAyMCA/IDIgOiAxKTtcblxudHlwZSBSb2xlID0gJ3RhbmsnIHwgJ2JydXRlJyB8ICdyYW5nZWQnIHwgJ2ZvZGRlcic7XG5jb25zdCBST0xFOiBSZWNvcmQ8Um9sZSwgU291bElkW10+ID0geyB0YW5rOiBbJ2tuaWdodCcsICdvZ3JlJ10sIGJydXRlOiBbJ2JhcmJhcmlhbicsICdvZ3JlJ10sIHJhbmdlZDogWydhcmNoZXInXSwgZm9kZGVyOiBbJ3dhcnJpb3InLCAnZ29ibGluJ10gfTtcbmV4cG9ydCBpbnRlcmZhY2UgVGVtcGxhdGUgeyBpZDogc3RyaW5nOyBtaXg6IFtSb2xlLCBudW1iZXJdW10gfVxuZXhwb3J0IGNvbnN0IFRFTVBMQVRFUzogVGVtcGxhdGVbXSA9IFtcbiAgeyBpZDogJ3dhbGwnLCBtaXg6IFtbJ3RhbmsnLCAzXSwgWydyYW5nZWQnLCAyXSwgWydmb2RkZXInLCAxXV0gfSxcbiAgeyBpZDogJ3N3YXJtJywgbWl4OiBbWydmb2RkZXInLCA1XSwgWydyYW5nZWQnLCAxXSwgWyd0YW5rJywgMV1dIH0sXG4gIHsgaWQ6ICdicnV0ZXMnLCBtaXg6IFtbJ2JydXRlJywgNF0sIFsnZm9kZGVyJywgMV0sIFsncmFuZ2VkJywgMV1dIH0sXG4gIHsgaWQ6ICdtaXhlZCcsIG1peDogW1sndGFuaycsIDFdLCBbJ2JydXRlJywgMV0sIFsncmFuZ2VkJywgMV0sIFsnZm9kZGVyJywgMl1dIH0sXG5dO1xuXG4vKiogV2F2ZXMgMS0yIGFyZSBhIGdlbnRsZSB3YXJtLXVwOiBjaGVhcCBmb2RkZXIgKGFuZCBhbiBhcmNoZXIpLCBubyB0YW5rcyBvciBicnV0ZXMsIHNvIG5vYm9keSBsb3NlcyBhIGhlYXJ0IHRvIHRoZSBmaXJzdCBmaWdodC4gKi9cbmNvbnN0IFdBUk1VUDogVGVtcGxhdGUgPSB7IGlkOiAnd2FybXVwJywgbWl4OiBbWydmb2RkZXInLCAzXSwgWydyYW5nZWQnLCAxXV0gfTtcbi8qKiBXaGljaCB0ZW1wbGF0ZSBhIHdhdmUgdXNlcyAoc2VlZGVkIHBlciB3YXZlLCBzbyBpdCBkb2VzIG5vdCBkZXBlbmQgb24gd2hhdCBjYW1lIGJlZm9yZSkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc1RlbXBsYXRlKG46IG51bWJlciwgc2VlZDogbnVtYmVyKTogVGVtcGxhdGUge1xuICBpZiAobiA8PSAyKSByZXR1cm4gV0FSTVVQO1xuICByZXR1cm4gVEVNUExBVEVTW01hdGguZmxvb3IobWFrZVJuZyhzZWVkICogNDA5OSArIG4gKiAzMSArIDUpLm5leHQoKSAqIFRFTVBMQVRFUy5sZW5ndGgpXTtcbn1cblxuLyoqIFRoZSBlbmVteSBhcm15IGZvciBlbmRsZXNzIHdhdmUgYG5gICgxLWJhc2VkKS4gQXQgbW9zdCAxMiB1bml0czsgdGhlIHdob2xlIGJ1ZGdldCBpcyBzcGVudCB1bmxlc3Mgbm8gdW5pdCBmaXRzIHdoYXQgaXMgbGVmdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzV2F2ZShuOiBudW1iZXIsIHNlZWQgPSAwKTogRW5lbXlTcGVjW10ge1xuICBjb25zdCB3YXZlID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihuKSksIHJuZyA9IG1ha2VSbmcoc2VlZCAqIDEwMDkgKyB3YXZlICogNzkxOSArIDE3KSwgdHBsID0gZW5kbGVzc1RlbXBsYXRlKHdhdmUsIHNlZWQpO1xuICBsZXQgbGVmdCA9IGVuZGxlc3NCdWRnZXQod2F2ZSk7IGNvbnN0IGFybXk6IEVuZW15U3BlY1tdID0gW107XG4gIGlmICh3YXZlICUgMTAgPT09IDAgJiYgbGVmdCA+PSAyMCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hhbXBpb24gd2F2ZTogb25lIHN0YXJyZWQgYnJ1dGUgdXAgZnJvbnQgKDIgc3RhcnMsIDMgZnJvbSB3YXZlIDQwKSwgdGhlbiB0aGUgdXN1YWwgZXNjb3J0XG4gICAgY29uc3Qgc291bDogU291bElkID0gcm5nLm5leHQoKSA8IDAuNSA/ICdvZ3JlJyA6ICdrbmlnaHQnLCBzdGFyID0gd2F2ZSA+PSA0MCA/IDMgOiAyOyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICB9XG4gIGNvbnN0IHRvdGFsID0gdHBsLm1peC5yZWR1Y2UoKGEsIFssIHddKSA9PiBhICsgdywgMCk7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA4MCAmJiBhcm15Lmxlbmd0aCA8IE1BWF9VTklUUyAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBsZXQgciA9IHJuZy5uZXh0KCkgKiB0b3RhbCwgcm9sZTogUm9sZSA9IHRwbC5taXhbMF1bMF07XG4gICAgZm9yIChjb25zdCBbcm8sIHddIG9mIHRwbC5taXgpIHsgciAtPSB3OyBpZiAociA8PSAwKSB7IHJvbGUgPSBybzsgYnJlYWs7IH0gfVxuICAgIGxldCBvcHRpb25zID0gUk9MRVtyb2xlXS5maWx0ZXIoKHMpID0+IENPU1Rbc11bMF0gPD0gbGVmdCk7XG4gICAgaWYgKCFvcHRpb25zLmxlbmd0aCkgb3B0aW9ucyA9IFJPTEUuZm9kZGVyLmZpbHRlcigocykgPT4gQ09TVFtzXVswXSA8PSBsZWZ0KTtcbiAgICBpZiAoIW9wdGlvbnMubGVuZ3RoKSBicmVhaztcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2sob3B0aW9ucyksIHBlciA9IGxlZnQgLyBNYXRoLm1heCgxLCBNQVhfVU5JVFMgLSBhcm15Lmxlbmd0aCk7XG4gICAgbGV0IHN0YXIgPSAxOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzcGFyZSBidWRnZXQgcGVyIGZyZWUgc2xvdCBidXlzIHN0YXJzXG4gICAgZm9yIChsZXQgcyA9IDM7IHMgPj0gMjsgcy0tKSBpZiAoQ09TVFtzb3VsXVtzIC0gMV0gPD0gbGVmdCAmJiBDT1NUW3NvdWxdW3MgLSAxXSA8PSBNYXRoLm1heChDT1NUW3NvdWxdWzBdLCBwZXIgKiAxLjIpKSB7IHN0YXIgPSBzOyBicmVhazsgfVxuICAgIGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gIH1cbiAgcmV0dXJuIGFybXk7XG59XG4iLCAiLy8gRW5lbXkgd2F2ZXMgYW5kIHRoZSBjYW1wYWlnbidzIHN0YWdlcy4gU2FtZSB1bml0IHBvb2wgYXMgdGhlIHBsYXllci4gVGhlIGJ1aWxkIHNjcmVlbiBwcmV2aWV3cyB0aGUgQ09NUE9TSVRJT04gb25seSwgbmV2ZXIgcG9zaXRpb25zLlxuLy9cbi8vIEVhY2ggU1RBR0UgaGFzIGZvdXIgZGlmZmljdWx0eSB0aWVycyAoZWFzeSAvIG5vcm1hbCAvIGhhcmQgLyBuaWdodG1hcmUpLiBMYXRlciBzdGFnZXMgYXJlIGhhcmRlcjogdGhleSByZXVzZSB0b3VnaGVyIHdhdmUgbGlzdHMgYW5kIGEgaGlkZGVuXG4vLyBFTkVNWSBQT1dFUiBtdWx0aXBsaWVyIChoZWFsdGggYW5kIGRhbWFnZSBvZiBlbmVteSB1bml0cykgdHVuZWQgcGVyIHN0YWdlIGFuZCB0aWVyIHdpdGggc2ltL2NhbGlicmF0ZV9wb3dlci50cywgc28gdGhhdCB0aGUgY29tcGV0ZW50XG4vLyBzdGFuZC1pbiBwbGF5ZXIgY2xlYXJzIGVhY2ggdGllciBhYm91dCA2MCUgb2YgdGhlIHRpbWUgYXQgdGhhdCB0aWVyJ3MgUkVDT01NRU5ERUQgU09VTCBMRVZFTCAoZXZlcnkgU291bCBhdCB0aGF0IGxldmVsKS5cbi8vIFVubG9jayBydWxlcyBsaXZlIGluIHByb2dyZXNzLnRzOiBFYXN5IGFuZCBOb3JtYWwgYXJlIGFsd2F5cyBvcGVuOyBjbGVhcmluZyBOb3JtYWwgb3BlbnMgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2U7IGNsZWFyaW5nIEhhcmQgb3BlbnMgTmlnaHRtYXJlLlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMsIFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB7IEVORExFU1NfSUQsIGVuZGxlc3NQb3dlciwgZW5kbGVzc1dhdmUgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBFbmVteVNwZWMgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlciB9XG5leHBvcnQgdHlwZSBEaWZmID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGUzogRGlmZltdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuXG5jb25zdCBMRVRURVI6IFJlY29yZDxzdHJpbmcsIFNvdWxJZD4gPSB7IFc6ICd3YXJyaW9yJywgQTogJ2FyY2hlcicsIEc6ICdnb2JsaW4nLCBLOiAna25pZ2h0JywgTzogJ29ncmUnLCBCOiAnYmFyYmFyaWFuJyB9O1xuY29uc3QgcGFyc2VXYXZlID0gKHM6IHN0cmluZyk6IEVuZW15U3BlY1tdID0+IHMuc3BsaXQoJyAnKS5tYXAoKHQpID0+ICh7IHNvdWw6IExFVFRFUlt0WzBdXSwgc3RhcjogK3RbMV0gfSkpO1xuXG4vKipcbiAqIFdhdmUgbGlzdHMgKFcgd2FycmlvciwgQSBhcmNoZXIsIEcgZ29ibGluLCBLIGtuaWdodCwgTyBvZ3JlLCBCIGJhcmJhcmlhbjsgZGlnaXQgPSBzdGFycykuIFRoZXNlIGZvdXIgd2VyZSB0dW5lZCBmb3IgU3RhZ2UgMTsgbGF0ZXIgc3RhZ2VzXG4gKiByZXVzZSB0aGVtIG9uZSB0aWVyIHVwIGFuZCBhZGQgZW5lbXkgcG93ZXIuIEhhcmQgYW5kIE5pZ2h0bWFyZSBhcmUgdm9sdW1lLWRyaXZlbiAodXAgdG8gMTIgZW5lbWllcykuXG4gKiBDb21wZXRlbnQgc3RhbmQtaW4gY2xlYXIgcmF0ZSB3aXRoIEVWRVJZIFNvdWwgYXQgbGV2ZWwgMSAvIDQgLyA2OiBlYXN5IDk4LzEwMC8xMDAsIG5vcm1hbCA4Mi85OC8xMDAsIGhhcmQgNy82MC84NywgbmlnaHRtYXJlIDAvMzMvNzQuXG4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEnLCAnSzEgVzEnLCAnTzEgVzEgRzEnLCAnSzEgQTEgVzEnLCAnTzEgQTEgRzEnLCAnSzEgTzEgQTEnLCAnSzEgTzEgQTEgRzEnLCAnTzEgSzEgQTEgRzEnLCAnTzEgSzEgQTEgQjEnLCAnTzIgSzEgQTEgRzEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExJywgJ0sxIEcxIFcxJywgJ08xIEExIEcxIFcxJywgJ0sxIE8xIEExIFcxJywgJ08xIEsxIEExIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxJywgJ0sxIE8xIEExIEcxIFcxJywgJ08xIEsxIEExIEIxIEcxJywgJ08xIEsxIEEyIEIxIEcxJywgJ08yIEsxIEExIEIxIEcxIFcxJ10sXG4gIGhhcmQ6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgQTEgRzEgVzEgVzEnLCAnSzEgTzEgQTEgVzEgRzEgVzEnLCAnTzEgSzEgQTIgRzEgVzEgVzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEgVzEgVzEnLCAnSzEgTzEgQTEgRzEgVzIgVzEgVzEnLCAnTzEgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzIgQTEgQjEgRzEgVzEgVzEgVzEgRzEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ08xIEExIEcxIFcxIEIxIFcxJywgJ0sxIE8xIEExIFcxIEcxIFcxIFcxJywgJ08xIEsxIEEyIEcxIFcxIEIxIFcxIFcxIEcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxIFcxIFcxIEcxIEcxJywgJ0sxIE8xIEEyIEcxIFcxIEIxIFcxIFcxIEcxIEcxIEIxJywgJ08xIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxJywgJ08yIEsxIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJywgJ08yIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJ10sXG59O1xuXG4vKiogU3RhZ2UgMiwgdGhlIFN1bmtlbiBHcmF2ZXlhcmQ6IGNyb3dkcy4gU2FtZSBEb21pbmlvbiBjb3N0IHBlciB3YXZlIGFzIHRoZSBsaXN0cyBvbmUgdGllciB1cCwgYnV0IGJ1aWx0IGZyb20gbWFueSBXYXJyaW9ycywgR29ibGlucyBhbmQgQXJjaGVycyB3aXRoIGEgS25pZ2h0IG9yIE9ncmUgaG9sZGluZyB0aGUgZnJvbnQgKHNpbS9hdXRob3Jfc3RhZ2VzLnRzKS4gKi9cbmNvbnN0IEdSQVZFWUFSRDogUmVjb3JkPERpZmYsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMSBBMScsICdLMSBHMSBXMScsICdPMSBXMSBXMSBXMSBHMScsICdPMSBHMiBHMSBBMScsICdPMSBXMSBXMSBXMSBBMSBBMScsICdLMSBXMSBXMSBXMSBBMSBBMSBBMScsICdPMSBXMSBXMSBXMSBXMSBXMSBBMScsICdPMSBXMSBXMSBXMSBXMSBHMSBHMSBHMScsICdLMSBXMSBXMSBXMSBXMSBXMSBHMiBHMSBBMScsICdLMSBXMSBXMSBXMSBXMSBHMSBHMSBHMSBHMSBBMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgVzEgVzEgVzEgRzEgQTEnLCAnTzEgVzEgVzEgRzEgRzEgRzEgRzEnLCAnTzEgVzIgVzEgVzEgVzEgVzEgVzEgRzEgQTEnLCAnSzEgVzEgVzEgVzEgVzEgVzEgRzEgRzEgRzEgQTEgQTEnLCAnSzEgVzEgVzEgVzEgRzEgQTEgQTEgQTEnLCAnTzEgVzEgVzEgRzEgRzEgQTEgQTEgQTEgQTEnLCAnSzIgVzEgVzEgVzEgVzEgVzEgVzEgRzEgRzEgRzEgQTEgQTEnLCAnTzEgVzIgVzEgVzEgVzEgVzEgVzEgRzEgRzEgQTEgQTEgQTEnXSxcbiAgaGFyZDogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBXMSBXMSBXMSBXMSBHMiBBMScsICdPMSBXMSBXMSBHMSBHMSBBMSBBMScsICdPMSBXMSBXMSBXMSBXMSBXMSBHMSBHMSBBMSBBMSBBMScsICdLMSBXMyBXMiBXMiBXMiBXMSBXMSBXMSBXMSBBMSBBMSBBMScsICdPMSBXMyBXMiBXMiBXMiBXMiBXMSBXMSBXMSBHMyBHMiBBMScsICdPMiBXMiBXMiBXMSBXMSBXMSBHMiBHMSBHMSBHMSBBMiBBMScsICdLMyBXMyBXMyBXMyBXMiBXMiBXMSBXMSBHMiBHMSBHMSBBMycsICdLMyBXMyBXMyBXMiBXMiBXMSBHMyBHMiBHMiBHMSBBMiBBMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgVzEgVzEgVzEgRzEgRzEgQTEnLCAnTzEgVzEgVzEgVzEgVzEgRzEgRzEgQTEnLCAnSzEgVzEgVzEgVzEgVzEgVzEgVzEgVzEgVzEgQTIgQTEgQTEnLCAnTzEgVzMgVzIgVzEgVzEgVzEgVzEgVzEgRzIgRzEgRzEgQTEnLCAnTzEgVzIgVzEgVzEgVzEgRzIgRzEgRzEgRzEgQTIgQTEgQTEnLCAnTzIgVzIgVzEgVzEgVzEgVzEgRzIgRzEgRzEgQTIgQTEgQTEnLCAnSzIgVzMgVzEgVzEgVzEgRzIgRzIgRzEgQTMgQTIgQTEgQTEnLCAnTzIgVzEgVzEgVzEgRzIgRzIgRzIgRzEgRzEgQTMgQTIgQTEnXSxcbn07XG4vKiogU3RhZ2UgMywgdGhlIEJvbmUgQmFzdGlvbjogZmV3ZXIsIGhlYXZpZXIgYXJtaWVzIG9mIEtuaWdodHMsIE9ncmVzIGFuZCBCYXJiYXJpYW5zIHdpdGggQXJjaGVycyBiZWhpbmQgKHNpbS9hdXRob3Jfc3RhZ2VzLnRzKS4gKi9cbmNvbnN0IEJBU1RJT046IFJlY29yZDxEaWZmLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgQTEgQTEnLCAnSzEgSzEgSzEgQTEgQTEnLCAnSzEgTzEgQjEgQjEgQTEnLCAnSzEgSzEgTzEgTzEgQTEgQTEnLCAnSzEgSzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgTzEgQjEgQjEnLCAnSzIgSzEgTzEgTzEgQjEgQjEnLCAnSzEgSzEgTzEgTzEgQjEgQjEgQTEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ0sxIEsxIEsxIEExIEExJywgJ08xIE8xIEIxIEIxJywgJ0syIEsxIEsxIE8xIEIxIEIxJywgJ0sxIE8xIE8xIEIxIEIxIEExIEExJywgJ0syIEsxIEsxIEsxIEIyIEIxIEIxIEExJywgJ0syIEsxIEsxIE8xIEIxIEIxIEEyIEExJywgJ0syIEsyIE8yIEIxIEIxIEEyIEEyIEExJywgJ0syIEsyIEsyIEsxIEIyIEIyIEEzIEExJ10sXG4gIGhhcmQ6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgQjEgQTEgQTEnLCAnSzEgSzEgTzEgQTEgQTEnLCAnSzEgTzEgQjEgQjEgQjEgQTEgQTEnLCAnSzEgSzEgSzEgTzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgSzEgTzEgQjEgQjEgQjEnLCAnSzIgSzEgSzEgTzEgTzEgQjEgQjEgQTEnLCAnSzIgSzEgTzEgTzEgQjEgQjEgQjEgQTMnLCAnSzIgSzIgSzEgSzEgTzEgTzEgQjMgQjEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ0sxIEsxIE8xIEIxJywgJ0syIEsxIEsxIE8xJywgJ0syIEsxIEsxIEsxIEsxIE8xJywgJ0sxIEsxIEsxIE8xIE8xIEIxIEExJywgJ0sxIEsxIEsxIEIyIEIxIEIxIEEyIEExJywgJ0sxIE8xIE8xIE8xIEIyIEExIEExIEExJywgJ0sxIE8yIE8xIE8xIE8xIEIxIEIxIEExJywgJ0szIEsyIEsxIEsxIEsxIE8yIEIxIEIxJ10sXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFN0YWdlRGVmIHtcbiAgaWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBibHVyYjogc3RyaW5nO1xuICBsaXN0czogUmVjb3JkPERpZmYsIHN0cmluZ1tdPjsgICAgICAgICAgLy8gdGhlIDEwIGVuZW15IHdhdmVzIGZvciBlYWNoIHRpZXJcbiAgcG93ZXI6IFJlY29yZDxEaWZmLCBudW1iZXI+OyAgICAgICAgICAgIC8vIGhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIGVhY2ggdGllciAoMSA9IGFzIHdyaXR0ZW4pXG4gIHJlYzogUmVjb3JkPERpZmYsIG51bWJlcj47ICAgICAgICAgICAgICAvLyByZWNvbW1lbmRlZCBTb3VsIGxldmVsIGZvciBlYWNoIHRpZXIgKGEgaGludCBvbiBIb21lLCBuZXZlciBhIGxvY2spXG59XG5cbi8qKiBUaGUgY2FtcGFpZ24uIE5hbWVzIGFyZSBwbGFjZWhvbGRlcnMuIFBvd2VyIG51bWJlcnMgY29tZSBmcm9tIHNpbS9jYWxpYnJhdGVfcG93ZXIudHMuICovXG5leHBvcnQgY29uc3QgU1RBR0VTOiBTdGFnZURlZltdID0gW1xuICB7IGlkOiAnY3J5cHQnLCBuYW1lOiAnVGhlIFJlc3RsZXNzIENyeXB0JywgYmx1cmI6ICdSYWlzZSB5b3VyIGFybXkuIFRoZSBkZWFkIGhlcmUgYXJlIG9ubHkganVzdCBzdGlycmluZy4nLFxuICAgIGxpc3RzOiB7IGVhc3k6IERJRkZJQ1VMVFkuZWFzeSwgbm9ybWFsOiBESUZGSUNVTFRZLm5vcm1hbCwgaGFyZDogRElGRklDVUxUWS5oYXJkLCBuaWdodG1hcmU6IERJRkZJQ1VMVFkubmlnaHRtYXJlIH0sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLCBoYXJkOiAxLCBuaWdodG1hcmU6IDEgfSwgcmVjOiB7IGVhc3k6IDEsIG5vcm1hbDogMSwgaGFyZDogNCwgbmlnaHRtYXJlOiA2IH0gfSxcbiAgeyBpZDogJ2dyYXZleWFyZCcsIG5hbWU6ICdUaGUgU3Vua2VuIEdyYXZleWFyZCcsIGJsdXJiOiAnQmlnZ2VyIGNyb3dkcyBjcmF3bCBvdXQgb2YgdGhlIG11ZC4gTGV2ZWwgeW91ciBTb3VscyBiZWZvcmUgeW91IGNvbWUuJyxcbiAgICBsaXN0czogR1JBVkVZQVJELFxuICAgIHBvd2VyOiB7IGVhc3k6IDEsIG5vcm1hbDogMS4xNSwgaGFyZDogMC45NSwgbmlnaHRtYXJlOiAxLjE1IH0sIHJlYzogeyBlYXN5OiAyLCBub3JtYWw6IDQsIGhhcmQ6IDYsIG5pZ2h0bWFyZTogOCB9IH0sXG4gIHsgaWQ6ICdiYXN0aW9uJywgbmFtZTogJ1RoZSBCb25lIEJhc3Rpb24nLCBibHVyYjogJ0EgZm9ydHJlc3Mgb2YgdGhlIGZhbGxlbi4gT25seSB3ZWxsLWxldmVsbGVkIGFybWllcyBob2xkIHRoZSBnYXRlLicsXG4gICAgbGlzdHM6IEJBU1RJT04sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLjAsIGhhcmQ6IDEuMjUsIG5pZ2h0bWFyZTogMS40IH0sIHJlYzogeyBlYXN5OiA0LCBub3JtYWw6IDYsIGhhcmQ6IDgsIG5pZ2h0bWFyZTogMTAgfSB9LFxuXTtcbmV4cG9ydCBjb25zdCBzdGFnZUluZGV4ID0gKGlkOiBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMCwgU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gaWQpKTtcbmV4cG9ydCBjb25zdCBzdGFnZUJ5SWQgPSAoaWQ6IHN0cmluZyk6IFN0YWdlRGVmID0+IFNUQUdFU1tzdGFnZUluZGV4KGlkKV07XG5cbi8qKiBOYW1lcyBhbmQgb25lLWxpbmUgcHJvbWlzZXMgZm9yIHRoZSBkaWZmaWN1bHR5IHBpY2tlci4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZX0lORk8gPSBbXG4gIHsgaWQ6ICdlYXN5JywgbGFiZWw6ICdFYXN5JywgYmx1cmI6ICdTbWFsbGVyIGVuZW15IGFybWllcy4gUmVsYXggYW5kIGxlYXJuIGhvdyBtZXJnaW5nIHdvcmtzLicgfSxcbiAgeyBpZDogJ25vcm1hbCcsIGxhYmVsOiAnTm9ybWFsJywgYmx1cmI6ICdUaGUgc3RhbmRhcmQgZmlnaHQuIENsZWFyaW5nIGl0IHVubG9ja3MgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2UuJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnQmlnZ2VyIGFybWllcyB3aXRoIG1vcmUgZm9kZGVyLiBCZXR0ZXIgZmlyc3QtY2xlYXIgcmV3YXJkcy4gQ2xlYXJpbmcgaXQgdW5sb2NrcyBOaWdodG1hcmUuJyB9LFxuICB7IGlkOiAnbmlnaHRtYXJlJywgbGFiZWw6ICdOaWdodG1hcmUnLCBibHVyYjogJ0EgcGFja2VkIGJhdHRsZWZpZWxkIG9mIHN0YXJzIGFuZCBza2lsbHMuIEJ1aWx0IGZvciB3ZWxsLWxldmVsbGVkIFNvdWxzLicgfSxcbl07XG5cbi8vIC0tLS0gd2hhdCB0aGUgbmV4dCBiYXR0bGUgdXNlcyAoc2V0IHdoZW4gYSBydW4gc3RhcnRzKVxuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZTogc3RyaW5nID0gJ25vcm1hbCc7XG5leHBvcnQgbGV0IGN1cnJlbnRTdGFnZUlkOiBzdHJpbmcgPSAnY3J5cHQnO1xubGV0IHBvd2VyID0gMSwgZW5kbGVzc01vZGUgPSBmYWxzZTtcbmxldCBkYWlseVJld3JpdGU6ICgodzogRW5lbXlTcGVjW10sIHdhdmU6IG51bWJlcikgPT4gRW5lbXlTcGVjW10pIHwgbnVsbCA9IG51bGw7ICAgLy8gc2V0IG9ubHkgZHVyaW5nIGEgRGFpbHkgQ2hhbGxlbmdlIHJ1blxuLyoqIEVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGN1cnJlbnQgc3RhZ2UgYW5kIHRpZXIgKGluIGVuZGxlc3MgbW9kZSBpdCBkZXBlbmRzIG9uIHRoZSB3YXZlKS4gKi9cbmV4cG9ydCBjb25zdCBlbmVteVBvd2VyID0gKHdhdmUgPSAxKTogbnVtYmVyID0+IChlbmRsZXNzTW9kZSA/IGVuZGxlc3NQb3dlcih3YXZlKSA6IHBvd2VyKTtcbmV4cG9ydCBjb25zdCBpc0VuZGxlc3MgPSAoKTogYm9vbGVhbiA9PiBlbmRsZXNzTW9kZTtcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyICgxMCB3YXZlcykuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXRTdGFnZURpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFN0YWdlRGlmZmljdWx0eShzdGFnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBzdGFnZUJ5SWQoc3RhZ2UpOyBpZiAoIURJRkZTLmluY2x1ZGVzKG5hbWUgYXMgRGlmZikpIHJldHVybjtcbiAgZW5kbGVzc01vZGUgPSBmYWxzZTsgZGFpbHlSZXdyaXRlID0gbnVsbDsgY3VycmVudFN0YWdlSWQgPSBzdC5pZDsgZGlmZmljdWx0eU5hbWUgPSBuYW1lOyBwb3dlciA9IHN0LnBvd2VyW25hbWUgYXMgRGlmZl07XG4gIEFVVEhPUkVELmxlbmd0aCA9IDA7IHN0Lmxpc3RzW25hbWUgYXMgRGlmZl0uZm9yRWFjaCgodykgPT4gQVVUSE9SRUQucHVzaChwYXJzZVdhdmUodykpKTtcbn1cbi8qKiBTd2l0Y2ggdG8gdGhlIERhaWx5IENoYWxsZW5nZTogU3RhZ2UgMSBOb3JtYWwgd2l0aCB0aGUgZGF5J3MgdHdpc3QgKHNlZSBjb3JlL2RhaWx5LnRzKS4gYGRheWAgaXMga2VwdCBhcyB0aGUgJ2RpZmZpY3VsdHknIHNvIGEgc2F2ZWQgcnVuIGNhbiByZWJ1aWxkIHRoZSBzYW1lIGRheS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXREYWlseShtb2Q6IHsgcG93ZXI6IG51bWJlcjsgZW5lbXk/OiAodzogRW5lbXlTcGVjW10sIHdhdmU6IG51bWJlcikgPT4gRW5lbXlTcGVjW10gfSwgZGF5OiBudW1iZXIpOiB2b2lkIHtcbiAgc2V0U3RhZ2VEaWZmaWN1bHR5KCdjcnlwdCcsICdub3JtYWwnKTsgZGFpbHlSZXdyaXRlID0gbW9kLmVuZW15ID8/IG51bGw7IGN1cnJlbnRTdGFnZUlkID0gJ2RhaWx5JzsgZGlmZmljdWx0eU5hbWUgPSBTdHJpbmcoZGF5KTsgcG93ZXIgPSBtb2QucG93ZXI7XG59XG4vKiogU3dpdGNoIHRvIEVuZGxlc3MgRGVwdGhzOiB3YXZlcyBjb21lIGZyb20gY29yZS9lbmRsZXNzLnRzIGluc3RlYWQgb2YgYSBzdGFnZSBsaXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldEVuZGxlc3MoKTogdm9pZCB7IGVuZGxlc3NNb2RlID0gdHJ1ZTsgZGFpbHlSZXdyaXRlID0gbnVsbDsgY3VycmVudFN0YWdlSWQgPSBFTkRMRVNTX0lEOyBkaWZmaWN1bHR5TmFtZSA9ICdlbmRsZXNzJzsgcG93ZXIgPSAxOyBBVVRIT1JFRC5sZW5ndGggPSAwOyB9XG4vKiogQ2hhbmdlIHRoZSB0aWVyIHdpdGhpbiB0aGUgY3VycmVudCBzdGFnZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXREaWZmaWN1bHR5KG5hbWU6IHN0cmluZyk6IHZvaWQgeyBzZXRTdGFnZURpZmZpY3VsdHkoY3VycmVudFN0YWdlSWQsIG5hbWUpOyB9XG5cbmV4cG9ydCBjb25zdCB3YXZlQ29zdCA9ICh3OiBFbmVteVNwZWNbXSk6IG51bWJlciA9PiB3LnJlZHVjZSgobiwgZSkgPT4gbiArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXSwgMCk7XG5cbi8qKiBFbmVteSBhcm15IGZvciBhIHdhdmUgKDEtYmFzZWQpLiBXYXZlcyBwYXN0IHRoZSBhdXRob3JlZCBvbmVzIGFyZSBnZW5lcmF0ZWQgZnJvbSBhIGZpeGVkIHNlZWQgc28gcmV0cmllcyBmYWNlIHRoZSBzYW1lIGFybXkuICovXG5leHBvcnQgZnVuY3Rpb24gZW5lbXlXYXZlKHdhdmU6IG51bWJlciwgc3RhZ2VTZWVkID0gMCk6IEVuZW15U3BlY1tdIHtcbiAgaWYgKGVuZGxlc3NNb2RlKSByZXR1cm4gZW5kbGVzc1dhdmUod2F2ZSwgc3RhZ2VTZWVkKTtcbiAgaWYgKHdhdmUgPD0gQVVUSE9SRUQubGVuZ3RoKSB7IGNvbnN0IHcgPSBBVVRIT1JFRFt3YXZlIC0gMV0ubWFwKChlKSA9PiAoeyAuLi5lIH0pKTsgcmV0dXJuIGRhaWx5UmV3cml0ZSA/IGRhaWx5UmV3cml0ZSh3LCB3YXZlKSA6IHc7IH1cbiAgY29uc3QgY2FwID0gQ1VSVkVTLmRvY1tNYXRoLm1pbih3YXZlLCBDVVJWRVMuZG9jLmxlbmd0aCkgLSAxXTtcbiAgY29uc3QgYnVkZ2V0ID0gTWF0aC5yb3VuZChjYXAgKiAwLjkyKTtcbiAgY29uc3Qgcm5nID0gbWFrZVJuZyhzdGFnZVNlZWQgKiAxMDA5ICsgd2F2ZSAqIDc5MTkpO1xuICBjb25zdCBhcm15OiBFbmVteVNwZWNbXSA9IFtdO1xuICBsZXQgbGVmdCA9IGJ1ZGdldDtcbiAgZm9yIChsZXQgZ3VhcmQgPSAwOyBndWFyZCA8IDQwICYmIGxlZnQgPj0gMjsgZ3VhcmQrKykge1xuICAgIGNvbnN0IHNvdWwgPSBybmcucGljayhTT1VMUyk7XG4gICAgbGV0IHN0YXIgPSAxO1xuICAgIGlmIChybmcubmV4dCgpIDwgMC4zNSAmJiBDT1NUW3NvdWxdWzFdIDw9IGxlZnQpIHN0YXIgPSAyO1xuICAgIGlmICh3YXZlID49IDYgJiYgcm5nLm5leHQoKSA8IDAuMjUgJiYgQ09TVFtzb3VsXVsyXSA8PSBsZWZ0KSBzdGFyID0gMztcbiAgICBjb25zdCBjID0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gICAgaWYgKGMgPD0gbGVmdCAmJiBhcm15Lmxlbmd0aCA8IDEyKSB7IGFybXkucHVzaCh7IHNvdWwsIHN0YXIgfSk7IGxlZnQgLT0gYzsgfVxuICB9XG4gIHJldHVybiBhcm15O1xufVxuXG4vKiogV2hhdCB0aGUgYnVpbGQgc2NyZWVuIHNob3dzOiBjb3VudHMgcGVyIFNvdWwgYW5kIHN0YXIsIG5vIHBvc2l0aW9ucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmV2aWV3VGV4dCh3OiBFbmVteVNwZWNbXSk6IHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfVtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXI7IGNvdW50OiBudW1iZXIgfT4oKTtcbiAgZm9yIChjb25zdCBlIG9mIHcpIHtcbiAgICBjb25zdCBrID0gZS5zb3VsICsgZS5zdGFyO1xuICAgIGNvbnN0IGN1ciA9IG1hcC5nZXQoayk7XG4gICAgaWYgKGN1cikgY3VyLmNvdW50Kys7IGVsc2UgbWFwLnNldChrLCB7IHNvdWw6IGUuc291bCwgc3RhcjogZS5zdGFyLCBjb3VudDogMSB9KTtcbiAgfVxuICByZXR1cm4gWy4uLm1hcC52YWx1ZXMoKV07XG59XG4iLCAiaW1wb3J0IHsgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuXG4vKipcbiAqIFJ1bGVzIGZvciB0aGUgcGxheWFibGUgU3RhZ2UgMSAoMTAgd2F2ZXMpOiBkb2MgRG9taW5pb24gY3VydmUsIGJvbnVzIGRyYXcgb25seSBvbiB0aGUgZWFybHkgd2F2ZXMuXG4gKiBtZXJnZSAnaGFuZEludG9PbmVTdGFyJzogYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBtZXJnZSBzdHJhaWdodCBpbnRvIGEgbWF0Y2hpbmcgZGVwbG95ZWQgMS1zdGFyIHVuaXQgKHBheWluZyBvbmx5IHRoZSBjb3N0XG4gKiBkaWZmZXJlbmNlKS4gV2l0aG91dCBpdCB0aGUgY2FwIGNhbiBibG9jayBhIG1lcmdlIHlvdSBjb3VsZCBhZmZvcmQgKHlvdSB3b3VsZCBuZWVkIHJvb20gdG8gc3VtbW9uIEJPVEggY29waWVzIGZpcnN0KS5cbiAqIFRoZSBkZWJ1ZyBwYW5lbCBjYW4gc3dpdGNoIHRoaXMgYmFjayB0byB0aGUgZG9jJ3MgZGVwbG95ZWQtb25seSBydWxlLlxuICovXG5leHBvcnQgY29uc3QgUFJPVE9UWVBFX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IENVUlZFUy5kb2MsIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogMTAsIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG5cbi8qKlxuICogRW5kbGVzcyBEZXB0aHM6IHRoZSBjYW1wYWlnbidzIERvbWluaW9uIGN1cnZlIGZvciB3YXZlcyAxLTEwLCB0aGVuIGhlbGQgYXQgNDAgKHRoZSBwbGF5ZXIncyBhcm15IGlzIGNhcHBlZCBvbiBwdXJwb3NlOyB0aGUgZW5lbXkga2VlcHMgZ3Jvd2luZywgc2VlIGVuZGxlc3MudHMpLlxuICogVGhlIGN1cnZlIGlzIGxvbmcgZW5vdWdoIHRoYXQgYSBydW4gZW5kcyBieSBsb3NpbmcgaGVhcnRzLCBuZXZlciBieSBcImNsZWFyaW5nXCIgdGhlIHN0YWdlIChjb3JlL3J1bGVzLnRzIHJlYWRzIGN1cnZlW3dhdmUtMV0pLlxuICovXG5jb25zdCBFTkRMRVNTX0xFTiA9IDMwMDtcbmV4cG9ydCBjb25zdCBFTkRMRVNTX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IEFycmF5LmZyb20oeyBsZW5ndGg6IEVORExFU1NfTEVOIH0sIChfLCBpKSA9PiBDVVJWRVMuZG9jW01hdGgubWluKGksIENVUlZFUy5kb2MubGVuZ3RoIC0gMSldKSwgbWVyZ2U6ICdoYW5kSW50b09uZVN0YXInLCBzdGFnZVdhdmVzOiBFTkRMRVNTX0xFTiwgbm9ybWFsRHJhd1dhdmVzOiBbMiwgMywgNCwgNV0gfTtcbiIsICIvLyBUaGUgRGFpbHkgQ2hhbGxlbmdlOiBTdGFnZSAxIChOb3JtYWwpIHdpdGggT05FIHR3aXN0IHRoYXQgY2hhbmdlcyBldmVyeSBkYXkuIEV2ZXJ5b25lIGdldHMgdGhlIHNhbWUgdHdpc3QgYW5kIHRoZSBzYW1lIHNlZWQgb24gdGhlIHNhbWUgZGF5XG4vLyAoYm90aCBjb21lIGZyb20gdGhlIGNhbGVuZGFyIGRhdGUsIHNvIG5vIHNlcnZlciBpcyBuZWVkZWQpLiBSZXRyeSBhcyBvZnRlbiBhcyB5b3UgbGlrZTsgdGhlIHJld2FyZCAoYSBwYWNrIGFuZCBzb21lIGdvbGQpIGlzIHBhaWQgb25jZSBwZXIgZGF5LlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgdHlwZSB7IEVuZW15U3BlYyB9IGZyb20gJy4vd2F2ZXMudHMnO1xuaW1wb3J0IHsgd2F2ZUNvc3QgfSBmcm9tICcuL3dhdmVzLnRzJztcblxuZXhwb3J0IGNvbnN0IERBSUxZX0lEID0gJ2RhaWx5JztcblxuZXhwb3J0IGludGVyZmFjZSBEYWlseU1vZCB7XG4gIGlkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nO1xuICBwb3dlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgIC8vIGhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBkYXlcbiAgY2FwRGVsdGE6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAvLyBjaGFuZ2UgdG8gdGhlIHBsYXllcidzIERvbWluaW9uIGV2ZXJ5IHdhdmUgKG5ldmVyIGJlbG93IERBSUxZX01JTl9DQVApXG4gIGVuZW15PzogKHc6IEVuZW15U3BlY1tdLCB3YXZlOiBudW1iZXIpID0+IEVuZW15U3BlY1tdOyAgIC8vIHJld3JpdGVzIGVhY2ggZW5lbXkgd2F2ZVxufVxuZXhwb3J0IGNvbnN0IERBSUxZX01JTl9DQVAgPSA0O1xuY29uc3QgTUFYX1VOSVRTID0gMTI7XG5cbi8qKiBBIGNyb3dkIG9mIFdhcnJpb3JzIGFuZCBHb2JsaW5zIHRoYXQgY29zdHMgYWJvdXQgYGJ1ZGdldGAgRG9taW5pb24uICovXG5mdW5jdGlvbiBjcm93ZChidWRnZXQ6IG51bWJlcik6IEVuZW15U3BlY1tdIHtcbiAgY29uc3Qgb3V0OiBFbmVteVNwZWNbXSA9IFtdOyBsZXQgbGVmdCA9IGJ1ZGdldDtcbiAgZm9yIChsZXQgaSA9IDA7IG91dC5sZW5ndGggPCBNQVhfVU5JVFM7IGkrKykge1xuICAgIGNvbnN0IHNvdWwgPSBpICUgMyA9PT0gMiA/ICdnb2JsaW4nIDogJ3dhcnJpb3InOyBpZiAoQ09TVFtzb3VsXVswXSA+IGxlZnQpIGJyZWFrO1xuICAgIG91dC5wdXNoKHsgc291bCwgc3RhcjogMSB9KTsgbGVmdCAtPSBDT1NUW3NvdWxdWzBdO1xuICB9XG4gIHJldHVybiBvdXQubGVuZ3RoID8gb3V0IDogW3sgc291bDogJ3dhcnJpb3InLCBzdGFyOiAxIH1dO1xufVxuXG5leHBvcnQgY29uc3QgTU9ESUZJRVJTOiBEYWlseU1vZFtdID0gW1xuICB7IGlkOiAnZW1wb3dlcmVkJywgbmFtZTogJ0VtcG93ZXJlZCcsIHRleHQ6ICdFbmVtaWVzIGFyZSAyNSUgc3Ryb25nZXIuJywgcG93ZXI6IDEuMjUsIGNhcERlbHRhOiAwIH0sXG4gIHsgaWQ6ICdtZWxlZScsIG5hbWU6ICdObyBBcmNoZXJzJywgdGV4dDogJ0VuZW15IEFyY2hlcnMgYXJlIHJlcGxhY2VkIGJ5IFdhcnJpb3JzLCBidXQgZXZlcnlvbmUgaGl0cyBoYXJkZXIuJywgcG93ZXI6IDEuMTUsIGNhcERlbHRhOiAwLFxuICAgIGVuZW15OiAodykgPT4gdy5tYXAoKGUpID0+IChlLnNvdWwgPT09ICdhcmNoZXInID8geyBzb3VsOiAnd2FycmlvcicgYXMgY29uc3QsIHN0YXI6IGUuc3RhciB9IDogZSkpIH0sXG4gIHsgaWQ6ICdzd2FybScsIG5hbWU6ICdTd2FybScsIHRleHQ6ICdXYXZlcyBhcmUgY3Jvd2RzIG9mIFdhcnJpb3JzIGFuZCBHb2JsaW5zLicsIHBvd2VyOiAwLjg1LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IGNyb3dkKE1hdGgucm91bmQod2F2ZUNvc3QodykgKiAxLjE1KSkgfSxcbiAgeyBpZDogJ2NyYW1wZWQnLCBuYW1lOiAnQ3JhbXBlZCcsIHRleHQ6ICdZb3VyIERvbWluaW9uIGlzIDQgbG93ZXIgZXZlcnkgd2F2ZS4nLCBwb3dlcjogMSwgY2FwRGVsdGE6IC00IH0sXG4gIHsgaWQ6ICd2ZXRlcmFucycsIG5hbWU6ICdWZXRlcmFucycsIHRleHQ6ICdFbmVteSBPZ3JlcyBhbmQgS25pZ2h0cyBhcmUgYSBzdGFyIGhpZ2hlci4nLCBwb3dlcjogMC45LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IHcubWFwKChlKSA9PiAoZS5zb3VsID09PSAnb2dyZScgfHwgZS5zb3VsID09PSAna25pZ2h0JyA/IHsgc291bDogZS5zb3VsLCBzdGFyOiBNYXRoLm1pbigzLCBlLnN0YXIgKyAxKSB9IDogZSkpIH0sXG5dO1xuXG4vKiogV2hvbGUgZGF5cyBzaW5jZSAxIEphbnVhcnkgMTk3MCBpbiB0aGUgcGxheWVyJ3Mgb3duIGNhbGVuZGFyICh0aGUgZGF5IGNoYW5nZXMgYXQgdGhlaXIgbWlkbmlnaHQpLiAqL1xuZXhwb3J0IGNvbnN0IGRheU51bWJlciA9IChkOiBEYXRlID0gbmV3IERhdGUoKSk6IG51bWJlciA9PiBNYXRoLmZsb29yKERhdGUuVVRDKGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSkgLyA4NjQwMDAwMCk7XG5leHBvcnQgY29uc3QgaXNWYWxpZERheSA9IChuOiBudW1iZXIpOiBib29sZWFuID0+IE51bWJlci5pc0ludGVnZXIobikgJiYgbiA+IDAgJiYgbiA8IDFlNjtcbmV4cG9ydCBjb25zdCBtb2RpZmllckZvciA9IChkYXk6IG51bWJlcik6IERhaWx5TW9kID0+IE1PRElGSUVSU1soKGRheSAlIE1PRElGSUVSUy5sZW5ndGgpICsgTU9ESUZJRVJTLmxlbmd0aCkgJSBNT0RJRklFUlMubGVuZ3RoXTtcbi8qKiBUaGUgcGxheWVyJ3MgcnVsZXMgZm9yIHRoZSBkYXk6IHRoZSBjYW1wYWlnbidzIERvbWluaW9uIGN1cnZlLCBzaGlmdGVkIGJ5IHRoZSBtb2RpZmllci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkYWlseVJ1bGVzKG1vZDogRGFpbHlNb2QsIHBvb2w6IFJ1bGVzWydwb29sJ10pOiBSdWxlcyB7XG4gIHJldHVybiB7IC4uLlBST1RPVFlQRV9SVUxFUywgY3VydmU6IENVUlZFUy5kb2MubWFwKChjKSA9PiBNYXRoLm1heChEQUlMWV9NSU5fQ0FQLCBjICsgbW9kLmNhcERlbHRhKSksIHBvb2wgfTtcbn1cbiIsICIvLyBTb3VsIFBhY2tzIChwbGFuIGRvYyBzZWN0aW9uIDE3KS4gUHVyZSBydWxlcywgbm8gZ3JhcGhpY3MuIEFMTCBOVU1CRVJTIEFSRSBQTEFDRUhPTERFUiBMRVZFUlM6IHdlIHNldHRsZWQgdGhlIHN0cnVjdHVyZSBmaXJzdCBhbmQgd2lsbCB0dW5lXG4vLyBxdWFudGl0aWVzIHdpdGggdGhlIHByb2dyZXNzaW9uIHNpbXVsYXRpb24gKHNpbS9wcm9ncmVzc2lvbi50cykgb25jZSB0aGUgbG9vcCBjYW4gYmUgcGxheWVkLlxuLy9cbi8vICAgU291bCByYXJpdHkgIC0+IGhvdyBvZnRlbiBhIFNvdWwgc2hvd3MgdXAgYW5kIGhvdyBiaWcgaXRzIHN0YWNrIG9mIGNvcGllcyB0ZW5kcyB0byBiZS5cbi8vICAgUGFjayB0aWVyICAgIC0+IHRoZSBwYWNrJ3Mgb3ZlcmFsbCB2YWx1ZSAoc2t1bGxzLCAxLTMgZm9yIG5vdyk6IG51bWJlciBvZiByZXZlYWxzICsgaG93IGdvb2QgdGhlIHJhcml0eSBvZGRzIGFyZS5cbi8vICAgQSBwYWNrIGhhcyBhIFNUQVJUSU5HIHRpZXIgYW5kIG1heSB1cGdyYWRlIHdoaWxlIGl0IGlzIGJlaW5nIG9wZW5lZDsgdGhlIHJlc3VsdCBpcyBkZWNpZGVkIHVwIGZyb250LCB0aGUgYW5pbWF0aW9uIG9ubHkgc2hvd3MgaXQuXG5cbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgdHlwZSBSYXJpdHkgPSAnY29tbW9uJyB8ICdyYXJlJyB8ICdlcGljJyB8ICdsZWdlbmRhcnknO1xuZXhwb3J0IGNvbnN0IFJBUklUSUVTOiBSYXJpdHlbXSA9IFsnY29tbW9uJywgJ3JhcmUnLCAnZXBpYycsICdsZWdlbmRhcnknXTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfTkFNRTogUmVjb3JkPFJhcml0eSwgc3RyaW5nPiA9IHsgY29tbW9uOiAnQ29tbW9uJywgcmFyZTogJ1JhcmUnLCBlcGljOiAnRXBpYycsIGxlZ2VuZGFyeTogJ0xlZ2VuZGFyeScgfTtcblxuLyoqIFJhcml0eSBwZXIgU291bC4gUExBQ0VIT0xERVIgYXNzaWdubWVudCAobm8gTGVnZW5kYXJ5IFNvdWwgZXhpc3RzIHlldCkuICovXG5leHBvcnQgY29uc3QgUkFSSVRZX09GOiBSZWNvcmQ8U291bElkLCBSYXJpdHk+ID0geyB3YXJyaW9yOiAnY29tbW9uJywgZ29ibGluOiAnY29tbW9uJywgYXJjaGVyOiAncmFyZScsIGtuaWdodDogJ3JhcmUnLCBvZ3JlOiAnZXBpYycsIGJhcmJhcmlhbjogJ2VwaWMnIH07XG5cbi8qKiBSYXJlciBTb3VscyB0dXJuIHVwIGluIHNtYWxsZXIgc3RhY2tzLCBzbyB0aGV5IG5lZWQgZmV3ZXIgY29waWVzIHBlciBsZXZlbCAobXVsdGlwbGllciBvbiB0aGUgbGV2ZWwgY29zdHMpLiBQTEFDRUhPTERFUi4gKi9cbmV4cG9ydCBjb25zdCBMRVZFTF9DT1NUX01VTFQ6IFJlY29yZDxSYXJpdHksIG51bWJlcj4gPSB7IGNvbW1vbjogMSwgcmFyZTogMC42LCBlcGljOiAwLjM1LCBsZWdlbmRhcnk6IDAuMiB9O1xuXG5leHBvcnQgY29uc3QgUEFDS19USUVSUyA9IDM7XG5leHBvcnQgY29uc3QgUEFDSyA9IHtcbiAgcmV2ZWFsczogWzMsIDQsIDVdLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2VwYXJhdGUgcmV2ZWFscyBwZXIgdGllciAoaW5kZXggMCA9IHRpZXIgMSlcbiAgc3RhY2tNdWx0OiBbMSwgMS41LCAyXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29weSBzdGFja3MgYXJlIGJpZ2dlciBpbiBiZXR0ZXIgcGFja3NcbiAgLyoqIFJhcml0eSBvZGRzIHBlciB0aWVyLCBpbiBwZXJjZW50LiAqL1xuICBvZGRzOiBbXG4gICAgeyBjb21tb246IDcwLCByYXJlOiAyNSwgZXBpYzogNSwgbGVnZW5kYXJ5OiAwIH0sXG4gICAgeyBjb21tb246IDU1LCByYXJlOiAzMywgZXBpYzogMTEsIGxlZ2VuZGFyeTogMSB9LFxuICAgIHsgY29tbW9uOiA0MCwgcmFyZTogMzgsIGVwaWM6IDE5LCBsZWdlbmRhcnk6IDMgfSxcbiAgXSBhcyBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+W10sXG4gIC8qKiBDb3BpZXMgaW4gb25lIHJldmVhbCBiZWZvcmUgdGhlIHRpZXIgbXVsdGlwbGllcjogW21pbiwgbWF4XS4gKi9cbiAgc3RhY2s6IHsgY29tbW9uOiBbNiwgMTBdLCByYXJlOiBbMywgNV0sIGVwaWM6IFsxLCAzXSwgbGVnZW5kYXJ5OiBbMSwgMV0gfSBhcyBSZWNvcmQ8UmFyaXR5LCBbbnVtYmVyLCBudW1iZXJdPixcbiAgLyoqIENoYW5jZSB0byBqdW1wIHVwIG9uZSB0aWVyIGR1cmluZyB0aGUgb3BlbmluZywgZnJvbSB0aWVyIDEgYW5kIGZyb20gdGllciAyIChhIGx1Y2t5IHBhY2sgY2FuIGp1bXAgdHdpY2UpLiAqL1xuICB1cGdyYWRlQ2hhbmNlOiBbMC4yLCAwLjEyXSxcbn07XG5cbi8qKiBBbiB1bm9wZW5lZCBwYWNrIHRoZSBwbGF5ZXIgb3ducy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFja0l0ZW0geyBpZDogbnVtYmVyOyB0aWVyOiBudW1iZXI7IHNvdXJjZTogc3RyaW5nIH1cbmV4cG9ydCBpbnRlcmZhY2UgUmV2ZWFsIHsgc291bDogU291bElkOyByYXJpdHk6IFJhcml0eTsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBQYWNrUmVzdWx0IHsgc3RhcnRUaWVyOiBudW1iZXI7IGZpbmFsVGllcjogbnVtYmVyOyB1cGdyYWRlczogbnVtYmVyW107IHJldmVhbHM6IFJldmVhbFtdIH1cblxuY29uc3QgcmFyaXR5UmFuayA9IChyOiBSYXJpdHkpID0+IFJBUklUSUVTLmluZGV4T2Yocik7XG5cbmZ1bmN0aW9uIHJvbGxSYXJpdHkodGllcjogbnVtYmVyLCBybmc6IFJuZyk6IFJhcml0eSB7XG4gIGNvbnN0IG9kZHMgPSBQQUNLLm9kZHNbdGllciAtIDFdOyBsZXQgcm9sbCA9IHJuZy5uZXh0KCkgKiBSQVJJVElFUy5yZWR1Y2UoKG4sIHIpID0+IG4gKyBvZGRzW3JdLCAwKTtcbiAgZm9yIChjb25zdCByIG9mIFJBUklUSUVTKSB7IGlmIChyb2xsIDwgb2Rkc1tyXSkgcmV0dXJuIHI7IHJvbGwgLT0gb2Rkc1tyXTsgfVxuICByZXR1cm4gJ2NvbW1vbic7XG59XG5cbi8qKiBBIHJhbmRvbSBTb3VsIG9mIHRoaXMgcmFyaXR5OyBpZiB0aGUgcm9zdGVyIGhhcyBub25lIG9mIHRoYXQgcmFyaXR5IHlldCwgdGhlIG5leHQgbG93ZXIgb25lIGlzIHVzZWQuICovXG5mdW5jdGlvbiBzb3VsT2ZSYXJpdHkocmFyaXR5OiBSYXJpdHksIHJuZzogUm5nKTogU291bElkIHtcbiAgZm9yIChsZXQgaSA9IHJhcml0eVJhbmsocmFyaXR5KTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgcG9vbCA9IFNPVUxTLmZpbHRlcigocykgPT4gUkFSSVRZX09GW3NdID09PSBSQVJJVElFU1tpXSk7IGlmIChwb29sLmxlbmd0aCkgcmV0dXJuIHJuZy5waWNrKHBvb2wpOyB9XG4gIHJldHVybiBybmcucGljayhTT1VMUyk7XG59XG5cbi8qKiBPcGVuIGEgcGFjazogcm9sbCB1cGdyYWRlcyBmaXJzdCAoc28gdGhlIGFuaW1hdGlvbiBjYW4gcGxheSB0aGVtIGJlZm9yZSB0aGUgcGFjayB0ZWFycyBvcGVuKSwgdGhlbiB0aGUgcmV2ZWFscy4gQmVzdCByZXZlYWwgY29tZXMgbGFzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuUGFjayhzdGFydFRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBQYWNrUmVzdWx0IHtcbiAgY29uc3QgdDAgPSBNYXRoLm1heCgxLCBNYXRoLm1pbihQQUNLX1RJRVJTLCBNYXRoLmZsb29yKHN0YXJ0VGllcikpKSwgdXBncmFkZXM6IG51bWJlcltdID0gW107XG4gIGxldCB0aWVyID0gdDA7XG4gIHdoaWxlICh0aWVyIDwgUEFDS19USUVSUyAmJiBybmcubmV4dCgpIDwgUEFDSy51cGdyYWRlQ2hhbmNlW3RpZXIgLSAxXSkgeyB0aWVyKys7IHVwZ3JhZGVzLnB1c2godGllcik7IH1cbiAgY29uc3QgcmV2ZWFsczogUmV2ZWFsW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBQQUNLLnJldmVhbHNbdGllciAtIDFdOyBpKyspIHtcbiAgICBjb25zdCByYXJpdHkgPSByb2xsUmFyaXR5KHRpZXIsIHJuZyksIHNvdWwgPSBzb3VsT2ZSYXJpdHkocmFyaXR5LCBybmcpLCBbbG8sIGhpXSA9IFBBQ0suc3RhY2tbUkFSSVRZX09GW3NvdWxdXTtcbiAgICByZXZlYWxzLnB1c2goeyBzb3VsLCByYXJpdHk6IFJBUklUWV9PRltzb3VsXSwgY29waWVzOiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKChsbyArIHJuZy5pbnQoaGkgLSBsbyArIDEpKSAqIFBBQ0suc3RhY2tNdWx0W3RpZXIgLSAxXSkpIH0pO1xuICB9XG4gIHJldmVhbHMuc29ydCgoYSwgYikgPT4gcmFyaXR5UmFuayhhLnJhcml0eSkgLSByYXJpdHlSYW5rKGIucmFyaXR5KSB8fCBhLmNvcGllcyAtIGIuY29waWVzKTtcbiAgcmV0dXJuIHsgc3RhcnRUaWVyOiB0MCwgZmluYWxUaWVyOiB0aWVyLCB1cGdyYWRlcywgcmV2ZWFscyB9O1xufVxuXG4vKiogVG90YWwgY29waWVzIHBlciBTb3VsIGluIGEgcmVzdWx0ICh0aGUgc2FtZSBTb3VsIGNhbiBiZSByZXZlYWxlZCBtb3JlIHRoYW4gb25jZSkuICovXG5leHBvcnQgZnVuY3Rpb24gY29waWVzQnlTb3VsKHJlc3VsdDogUGFja1Jlc3VsdCk6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4ge1xuICBjb25zdCBvdXQ6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4gPSB7fTtcbiAgZm9yIChjb25zdCByIG9mIHJlc3VsdC5yZXZlYWxzKSBvdXRbci5zb3VsXSA9IChvdXRbci5zb3VsXSA/PyAwKSArIHIuY29waWVzO1xuICByZXR1cm4gb3V0O1xufVxuIiwgIi8vIFRoZSBwbGF5ZXIncyBzYXZlZCBwcm9ncmVzcy4gRnJhbWV3b3JrLWZyZWUgc28gdGhlIGdhbWUgYnVuZGxlIGFuZCB0aGUgbmF2aWdhdGlvbiBzaGVsbCBib3RoIHVzZSBpdC5cbi8vIFN0b3JlZCBpbiBsb2NhbFN0b3JhZ2UgYXMgSlNPTi4gRXZlcnkgcmVhZC93cml0ZSBpcyBndWFyZGVkOiBwcml2YXRlIHdpbmRvd3MgYW5kIGJsb2NrZWQgc3RvcmFnZSBtdXN0IG5ldmVyIGJyZWFrIHRoZSBnYW1lLlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBQQUNLX1RJRVJTIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5cbmV4cG9ydCBjb25zdCBERUNLX1NJWkUgPSA2OyAgICAgICAgICAgICAgICAgICAgIC8vIGRvYzogc2l4IGVxdWlwcGVkIFNvdWxzIHBlciBzdGFnZVxuY29uc3QgS0VZID0gJ25lY3JvLXNhdmUnO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCB0eXBlIERpZmZpY3VsdHkgPSAnZWFzeScgfCAnbm9ybWFsJyB8ICdoYXJkJyB8ICduaWdodG1hcmUnO1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVElFUzogRGlmZmljdWx0eVtdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuZXhwb3J0IGludGVyZmFjZSBTZXR0aW5ncyB7IG11c2ljOiBib29sZWFuOyBzZng6IGJvb2xlYW4gfVxuZXhwb3J0IGludGVyZmFjZSBTb3VsUHJvZ3Jlc3MgeyBsZXZlbDogbnVtYmVyOyBjb3BpZXM6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNhdmUge1xuICB2OiBudW1iZXI7XG4gIGRlY2s6IFNvdWxJZFtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBlcXVpcHBlZCBTb3VscywgYXQgbW9zdCBERUNLX1NJWkUsIGF0IGxlYXN0IDFcbiAgc291bHM6IFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47ICAgICAgICAgIC8vIFBMQUNFSE9MREVSIHByb2dyZXNzaW9uIHVudGlsIHBhY2tzIGV4aXN0XG4gIHNldHRpbmdzOiBTZXR0aW5nczsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzb3VuZCBzd2l0Y2hlczsgYm90aCBvbiBieSBkZWZhdWx0XG4gIGRpZmZpY3VsdHk6IERpZmZpY3VsdHk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBjaG9zZW4gb24gSG9tZTsgYXBwbGllcyB0byB0aGUgbmV4dCBydW5cbiAgc3RhZ2U6IHN0cmluZzsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBzdGFnZSBwaWNrZWQgb24gSG9tZSAoaWQgZnJvbSB3YXZlcy50cyBTVEFHRVMpXG4gIHNlZW46IHN0cmluZ1tdIHwgbnVsbDsgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bmxvY2sga2V5cyB3aG9zZSBjZWxlYnJhdGlvbiB3YXMgYWxyZWFkeSBzaG93biAobnVsbDogb2xkZXIgc2F2ZSwgc2VlZGVkIG9uIGZpcnN0IGxvb2spXG4gIHBhY2tzOiBQYWNrSXRlbVtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bm9wZW5lZCBTb3VsIFBhY2tzXG4gIG5leHRQYWNrSWQ6IG51bWJlcjtcbiAgY2xlYXJzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+OyAgICAgICAgICAgICAgIC8vIHN0YWdlIGNsZWFycywga2V5ZWQgJ3N0YWdlOmRpZmZpY3VsdHknXG4gIHJlcGxheU1ldGVyOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXBsYXkgY2xlYXJzIHRvd2FyZCB0aGUgbmV4dCByZXBsYXkgcGFja1xuICBlbmRsZXNzOiB7IGJlc3Q6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgLy8gRW5kbGVzcyBEZXB0aHM6IHRoZSBkZWVwZXN0IHdhdmUgY2xlYXJlZFxuICBnb2xkU2NhbGU6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gMiA9IGdvbGQgaW4gdGhlIGN1cnJlbnQgKHgxMDApIHVuaXRzOyBhIHNhdmUgd2l0aG91dCBpdCBob2xkcyBnb2xkIGluIHRoZSBvbGQgc21hbGwgdW5pdHMgYW5kIGlzIGNvbnZlcnRlZCBvbiBsb2FkXG4gIGdvbGQ6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzcGVudCBvbiBTb3VsIGxldmVsLXVwcyAoYWxvbmdzaWRlIGNvcGllcyk7IGVhcm5lZCBwZXIgd2F2ZSBjbGVhcmVkIGFuZCBmcm9tIG9wZW5pbmcgcGFja3NcbiAgZGFpbHk6IHsgZGF5OiBudW1iZXI7IHdvbjogYm9vbGVhbiB9IHwgbnVsbDsgIC8vIHRoZSBsYXN0IERhaWx5IENoYWxsZW5nZSBkYXkgcGxheWVkIGFuZCB3aGV0aGVyIGl0cyBvbmUtdGltZSByZXdhcmQgd2FzIHRha2VuXG59XG4vKiogR29sZCBnaXZlbiBvbmNlIHRvIGEgc2F2ZSB0aGF0IHByZWRhdGVzIGdvbGQgYW5kIGhhcyBwcm9ncmVzcy4gKi9cbmV4cG9ydCBjb25zdCBDQVRDSF9VUF9HT0xEID0gNDAwMDA7XG5leHBvcnQgaW50ZXJmYWNlIFN0b3JlIHsgZ2V0SXRlbShrOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsOyBzZXRJdGVtKGs6IHN0cmluZywgdjogc3RyaW5nKTogdm9pZCB9XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0U2F2ZSgpOiBTYXZlIHtcbiAgY29uc3Qgc291bHMgPSB7fSBhcyBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+O1xuICBmb3IgKGNvbnN0IGlkIG9mIFNPVUxTKSBzb3Vsc1tpZF0gPSB7IGxldmVsOiAxLCBjb3BpZXM6IDAgfTtcbiAgcmV0dXJuIHsgdjogVkVSU0lPTiwgZGVjazogU09VTFMuc2xpY2UoMCwgREVDS19TSVpFKSwgc291bHMsIHNldHRpbmdzOiB7IG11c2ljOiB0cnVlLCBzZng6IHRydWUgfSwgZGlmZmljdWx0eTogJ25vcm1hbCcsIHN0YWdlOiAnY3J5cHQnLCBzZWVuOiBbXSwgcGFja3M6IFtdLCBuZXh0UGFja0lkOiAxLCBjbGVhcnM6IHt9LCByZXBsYXlNZXRlcjogMCwgZW5kbGVzczogeyBiZXN0OiAwIH0sIGdvbGRTY2FsZTogMiwgZ29sZDogMCwgZGFpbHk6IG51bGwgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJyb3dzZXJTdG9yZSgpOiBTdG9yZSB8IG51bGwgeyB0cnkgeyByZXR1cm4gdHlwZW9mIGxvY2FsU3RvcmFnZSA9PT0gJ3VuZGVmaW5lZCcgPyBudWxsIDogbG9jYWxTdG9yYWdlOyB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH0gfVxuXG4vKiogUmVwYWlyIHdoYXRldmVyIHdhcyBzdG9yZWQ6IHVua25vd24gU291bHMgZHJvcHBlZCwgZHVwbGljYXRlcyByZW1vdmVkLCBkZWNrIGNhcHBlZCwgbm90aGluZyBlbXB0eS4gT2xkIHZlcnNpb25zIGtlZXAgdGhlaXIgcHJvZ3Jlc3MuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemUocmF3OiBhbnkpOiBTYXZlIHtcbiAgY29uc3QgYmFzZSA9IGRlZmF1bHRTYXZlKCk7XG4gIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09ICdvYmplY3QnKSByZXR1cm4gYmFzZTtcbiAgY29uc3QgZGVjazogU291bElkW10gPSBbXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LmRlY2spKSBmb3IgKGNvbnN0IGQgb2YgcmF3LmRlY2spIGlmIChTT1VMUy5pbmNsdWRlcyhkKSAmJiAhZGVjay5pbmNsdWRlcyhkKSAmJiBkZWNrLmxlbmd0aCA8IERFQ0tfU0laRSkgZGVjay5wdXNoKGQpO1xuICBpZiAoZGVjay5sZW5ndGgpIGJhc2UuZGVjayA9IGRlY2s7XG4gIGlmIChyYXcuc291bHMgJiYgdHlwZW9mIHJhdy5zb3VscyA9PT0gJ29iamVjdCcpIHtcbiAgICBmb3IgKGNvbnN0IGlkIG9mIFNPVUxTKSB7XG4gICAgICBjb25zdCBwID0gcmF3LnNvdWxzW2lkXTtcbiAgICAgIGlmIChwICYmIE51bWJlci5pc0Zpbml0ZShwLmxldmVsKSAmJiBOdW1iZXIuaXNGaW5pdGUocC5jb3BpZXMpKSBiYXNlLnNvdWxzW2lkXSA9IHsgbGV2ZWw6IE1hdGgubWF4KDEsIE1hdGguZmxvb3IocC5sZXZlbCkpLCBjb3BpZXM6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IocC5jb3BpZXMpKSB9O1xuICAgIH1cbiAgfVxuICBpZiAocmF3LnNldHRpbmdzICYmIHR5cGVvZiByYXcuc2V0dGluZ3MgPT09ICdvYmplY3QnKSB7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3MubXVzaWMgPT09ICdib29sZWFuJykgYmFzZS5zZXR0aW5ncy5tdXNpYyA9IHJhdy5zZXR0aW5ncy5tdXNpYztcbiAgICBpZiAodHlwZW9mIHJhdy5zZXR0aW5ncy5zZnggPT09ICdib29sZWFuJykgYmFzZS5zZXR0aW5ncy5zZnggPSByYXcuc2V0dGluZ3Muc2Z4O1xuICB9XG4gIGlmIChESUZGSUNVTFRJRVMuaW5jbHVkZXMocmF3LmRpZmZpY3VsdHkpKSBiYXNlLmRpZmZpY3VsdHkgPSByYXcuZGlmZmljdWx0eTtcbiAgaWYgKHR5cGVvZiByYXcuc3RhZ2UgPT09ICdzdHJpbmcnICYmIC9eW2EtejAtOV8tXXsxLDI0fSQvLnRlc3QocmF3LnN0YWdlKSkgYmFzZS5zdGFnZSA9IHJhdy5zdGFnZTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LnNlZW4pKSBiYXNlLnNlZW4gPSByYXcuc2Vlbi5maWx0ZXIoKGs6IGFueSkgPT4gdHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDApLnNsaWNlKC04MCk7XG4gIGVsc2UgaWYgKHJhdy5jbGVhcnMgJiYgdHlwZW9mIHJhdy5jbGVhcnMgPT09ICdvYmplY3QnICYmIE9iamVjdC5rZXlzKHJhdy5jbGVhcnMpLmxlbmd0aCkgYmFzZS5zZWVuID0gbnVsbDsgICAgLy8gYW4gZXhpc3RpbmcgcGxheWVyOiBkbyBub3QgcmVwbGF5IG9sZCB1bmxvY2tzXG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5wYWNrcykpIHtcbiAgICBjb25zdCBpZHMgPSBuZXcgU2V0PG51bWJlcj4oKTtcbiAgICBmb3IgKGNvbnN0IHAgb2YgcmF3LnBhY2tzKSB7XG4gICAgICBpZiAoYmFzZS5wYWNrcy5sZW5ndGggPj0gOTkgfHwgIXAgfHwgIU51bWJlci5pc0ludGVnZXIocC5pZCkgfHwgcC5pZCA8IDEgfHwgaWRzLmhhcyhwLmlkKSB8fCAhTnVtYmVyLmlzSW50ZWdlcihwLnRpZXIpIHx8IHAudGllciA8IDEgfHwgcC50aWVyID4gUEFDS19USUVSUykgY29udGludWU7XG4gICAgICBpZHMuYWRkKHAuaWQpOyBiYXNlLnBhY2tzLnB1c2goeyBpZDogcC5pZCwgdGllcjogcC50aWVyLCBzb3VyY2U6IHR5cGVvZiBwLnNvdXJjZSA9PT0gJ3N0cmluZycgPyBwLnNvdXJjZS5zbGljZSgwLCA0MCkgOiAnJyB9KTtcbiAgICB9XG4gIH1cbiAgY29uc3QgbWF4SWQgPSBiYXNlLnBhY2tzLnJlZHVjZSgobiwgcCkgPT4gTWF0aC5tYXgobiwgcC5pZCksIDApO1xuICBiYXNlLm5leHRQYWNrSWQgPSBNYXRoLm1heChtYXhJZCArIDEsIE51bWJlci5pc0ludGVnZXIocmF3Lm5leHRQYWNrSWQpICYmIHJhdy5uZXh0UGFja0lkID4gMCA/IHJhdy5uZXh0UGFja0lkIDogMSk7XG4gIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JykgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMocmF3LmNsZWFycykpIGlmICh0eXBlb2YgayA9PT0gJ3N0cmluZycgJiYgay5sZW5ndGggPCA0MCAmJiBOdW1iZXIuaXNJbnRlZ2VyKHYpICYmICh2IGFzIG51bWJlcikgPiAwKSBiYXNlLmNsZWFyc1trXSA9IHYgYXMgbnVtYmVyO1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcucmVwbGF5TWV0ZXIpICYmIHJhdy5yZXBsYXlNZXRlciA+PSAwICYmIHJhdy5yZXBsYXlNZXRlciA8IDUwKSBiYXNlLnJlcGxheU1ldGVyID0gcmF3LnJlcGxheU1ldGVyO1xuICBpZiAocmF3LmVuZGxlc3MgJiYgTnVtYmVyLmlzSW50ZWdlcihyYXcuZW5kbGVzcy5iZXN0KSAmJiByYXcuZW5kbGVzcy5iZXN0ID49IDAgJiYgcmF3LmVuZGxlc3MuYmVzdCA8PSA5OTk5KSBiYXNlLmVuZGxlc3MuYmVzdCA9IHJhdy5lbmRsZXNzLmJlc3Q7XG4gIGlmIChOdW1iZXIuaXNJbnRlZ2VyKHJhdy5nb2xkKSAmJiByYXcuZ29sZCA+PSAwICYmIHJhdy5nb2xkIDw9IDFlOSkgYmFzZS5nb2xkID0gcmF3LmdvbGRTY2FsZSA9PT0gMiA/IHJhdy5nb2xkIDogTWF0aC5taW4oMWU5LCByYXcuZ29sZCAqIDEwMCk7ICAgLy8gZWFybHkgc2F2ZXMgY291bnRlZCBnb2xkIGluIHVuaXRzIDEwMCB0aW1lcyBzbWFsbGVyXG4gIGVsc2UgaWYgKHJhdy5nb2xkID09PSB1bmRlZmluZWQgJiYgT2JqZWN0LmtleXMoYmFzZS5jbGVhcnMpLmxlbmd0aCkgYmFzZS5nb2xkID0gQ0FUQ0hfVVBfR09MRDsgICAgICAgIC8vIGEgcGxheWVyIGZyb20gYmVmb3JlIGdvbGQgZXhpc3RlZDogb25lLXRpbWUgZ3JhbnQgc28gdGhlIG5ldyBjb3N0IGRvZXMgbm90IGxvY2sgdGhlaXIgc3RvY2twaWxlZCBjb3BpZXNcbiAgaWYgKHJhdy5kYWlseSAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5kYWlseS5kYXkpICYmIHJhdy5kYWlseS5kYXkgPiAwICYmIHJhdy5kYWlseS5kYXkgPCAxZTYpIGJhc2UuZGFpbHkgPSB7IGRheTogcmF3LmRhaWx5LmRheSwgd29uOiAhIXJhdy5kYWlseS53b24gfTtcbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cblxuLyoqIENoYW5nZSBzb3VuZCBzZXR0aW5ncyB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzKHBhdGNoOiBQYXJ0aWFsPFNldHRpbmdzPiwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2V0dGluZ3Mge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLnNldHRpbmdzID0geyAuLi5zLnNldHRpbmdzLCAuLi5wYXRjaCB9OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5zZXR0aW5ncztcbn1cblxuLyoqIFJlbWVtYmVyIHRoZSBjaG9zZW4gZGlmZmljdWx0eSB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZURpZmZpY3VsdHkoZDogRGlmZmljdWx0eSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogRGlmZmljdWx0eSB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuZGlmZmljdWx0eSA9IERJRkZJQ1VMVElFUy5pbmNsdWRlcyhkKSA/IGQgOiBzLmRpZmZpY3VsdHk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLmRpZmZpY3VsdHk7XG59XG4iLCAiLy8gUGVybWFuZW50IHByb2dyZXNzaW9uOiBzdGFnZSBjbGVhcnMgLT4gU291bCBQYWNrcyAtPiBjb3BpZXMgLT4gU291bCBsZXZlbHMuIFB1cmUgZnVuY3Rpb25zIHRoYXQgY2hhbmdlIGEgU2F2ZSAodGhlIGNhbGxlciBwZXJzaXN0cyBpdCkuXG4vLyBQbGFjZWhvbGRlciBudW1iZXJzLCBsaWtlIHBhY2tzLnRzLiBJbi1ydW4gc3RhciBtZXJnaW5nIGlzIGEgc2VwYXJhdGUsIHRlbXBvcmFyeSBzeXN0ZW0gYW5kIG5ldmVyIHRvdWNoZXMgYW55IG9mIHRoaXMuXG5cbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19QQUNLX0VWRVJZLCBlbmRsZXNzUGFja1RpZXIgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgTEVWRUxfQ09TVF9NVUxULCBQQUNLX1RJRVJTLCBSQVJJVFlfT0YsIG9wZW5QYWNrIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtLCBQYWNrUmVzdWx0IH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlLCB3cml0ZVNhdmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHsgU1RBR0VTLCBzdGFnZUJ5SWQsIHN0YWdlSW5kZXggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB0eXBlIHsgRGlmZmljdWx0eSwgU2F2ZSwgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5leHBvcnQgY29uc3QgTUFYX1BBQ0tTID0gOTk7XG5cbi8qKiBXaGVyZSBwYWNrcyBjb21lIGZyb20uIFBMQUNFSE9MREVSLiBGaXJzdCBjbGVhciBvZiBhIHN0YWdlIG9uIGVhY2ggZGlmZmljdWx0eSBnaXZlcyBvbmUgaW1wcm92ZWQgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgYSBtZXRlci4gKi9cbmV4cG9ydCBjb25zdCBSRVdBUkRTID0ge1xuICBmaXJzdENsZWFyVGllcjogeyBlYXN5OiAxLCBub3JtYWw6IDIsIGhhcmQ6IDIsIG5pZ2h0bWFyZTogMyB9IGFzIFJlY29yZDxEaWZmaWN1bHR5LCBudW1iZXI+LFxuICByZXBsYXlUaWVyOiAxLFxuICByZXBsYXlDbGVhcnNQZXJQYWNrOiAyLFxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGxldmVsc1xuZXhwb3J0IGNvbnN0IG1heExldmVsID0gKCk6IG51bWJlciA9PiBCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWwubGVuZ3RoICsgMTtcbmV4cG9ydCBjb25zdCBpc01heExldmVsID0gKGxldmVsOiBudW1iZXIpOiBib29sZWFuID0+IGxldmVsID49IG1heExldmVsKCk7XG4vKiogQ29waWVzIG5lZWRlZCB0byB0YWtlIGBzb3VsYCBmcm9tIGBsZXZlbGAgdG8gdGhlIG5leHQgb25lICgwIHdoZW4gYWxyZWFkeSBtYXgpLiBSYXJlciBTb3VscyBuZWVkIGZld2VyLiAqL1xuZXhwb3J0IGNvbnN0IGNvcGllc05lZWRlZCA9IChsZXZlbDogbnVtYmVyLCBzb3VsOiBTb3VsSWQpOiBudW1iZXIgPT4gKGlzTWF4TGV2ZWwobGV2ZWwpID8gMCA6IE1hdGgubWF4KDEsIE1hdGgucm91bmQoQkFMQU5DRS5sZXZlbC5jb3BpZXNUb0xldmVsW2xldmVsIC0gMV0gKiBMRVZFTF9DT1NUX01VTFRbUkFSSVRZX09GW3NvdWxdXSkpKTtcbi8qKlxuICogT25lIHJlcXVpcmVtZW50IG9mIGFuIHVwZ3JhZGUuIFRvZGF5IG9ubHkgY29waWVzOyB0aGUgY29uZmlybSBwb3B1cCBsaXN0cyBldmVyeSBlbnRyeSB3aXRoIGhhdmUgLyBuZWVkLCBhbmQgQ29uZmlybSBpcyBhbGxvd2VkIG9ubHkgd2hlbiBhbGwgYXJlIG1ldC5cbiAqIEdvbGQgd2lsbCBzaW1wbHkgYmVjb21lIGEgc2Vjb25kIGVudHJ5IGhlcmUgKHsgaWQ6ICdnb2xkJywgLi4uIH0pIGFuZCBiZSBzcGVudCBpbiBsZXZlbFVwKCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBncmFkZUNvc3QgeyBpZDogJ2NvcGllcycgfCAnZ29sZCc7IGxhYmVsOiBzdHJpbmc7IGhhdmU6IG51bWJlcjsgbmVlZDogbnVtYmVyOyBvazogYm9vbGVhbiB9XG4vKiogR29sZCB0byB0YWtlIGEgU291bCBmcm9tIGBsZXZlbGAgdG8gdGhlIG5leHQgb25lICgwIGF0IG1heCkuICovXG5leHBvcnQgY29uc3QgZ29sZE5lZWRlZCA9IChsZXZlbDogbnVtYmVyKTogbnVtYmVyID0+IChpc01heExldmVsKGxldmVsKSA/IDAgOiBCQUxBTkNFLmxldmVsLmdvbGRUb0xldmVsW2xldmVsIC0gMV0pO1xuZXhwb3J0IGZ1bmN0aW9uIHVwZ3JhZGVDb3N0cyhzYXZlOiBTYXZlLCBzb3VsOiBTb3VsSWQpOiBVcGdyYWRlQ29zdFtdIHtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IGlmIChpc01heExldmVsKHAubGV2ZWwpKSByZXR1cm4gW107XG4gIGNvbnN0IG5lZWQgPSBjb3BpZXNOZWVkZWQocC5sZXZlbCwgc291bCk7XG4gIGNvbnN0IGdvbGQgPSBnb2xkTmVlZGVkKHAubGV2ZWwpO1xuICByZXR1cm4gW3sgaWQ6ICdjb3BpZXMnLCBsYWJlbDogJ0NvcGllcycsIGhhdmU6IHAuY29waWVzLCBuZWVkLCBvazogcC5jb3BpZXMgPj0gbmVlZCB9LCB7IGlkOiAnZ29sZCcsIGxhYmVsOiAnR29sZCcsIGhhdmU6IHNhdmUuZ29sZCwgbmVlZDogZ29sZCwgb2s6IHNhdmUuZ29sZCA+PSBnb2xkIH1dO1xufVxuZXhwb3J0IGNvbnN0IGNhbkFmZm9yZCA9IChjb3N0czogVXBncmFkZUNvc3RbXSk6IGJvb2xlYW4gPT4gY29zdHMubGVuZ3RoID4gMCAmJiBjb3N0cy5ldmVyeSgoYykgPT4gYy5vayk7XG5leHBvcnQgY29uc3QgY2FuTGV2ZWxVcCA9IChzYXZlOiBTYXZlLCBzb3VsOiBTb3VsSWQpOiBib29sZWFuID0+IGNhbkFmZm9yZCh1cGdyYWRlQ29zdHMoc2F2ZSwgc291bCkpO1xuLyoqIFBheSBldmVyeSBjb3N0IGFuZCBnYWluIGEgbGV2ZWwuIFJldHVybnMgZmFsc2UgKGFuZCBjaGFuZ2VzIG5vdGhpbmcpIGlmIHRoZSBTb3VsIGlzIG5vdCByZWFkeS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsZXZlbFVwKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4ge1xuICBjb25zdCBjb3N0cyA9IHVwZ3JhZGVDb3N0cyhzYXZlLCBzb3VsKTsgaWYgKCFjYW5BZmZvcmQoY29zdHMpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHAgPSBzYXZlLnNvdWxzW3NvdWxdOyBmb3IgKGNvbnN0IGMgb2YgY29zdHMpIHsgaWYgKGMuaWQgPT09ICdjb3BpZXMnKSBwLmNvcGllcyAtPSBjLm5lZWQ7IGVsc2Ugc2F2ZS5nb2xkIC09IGMubmVlZDsgfVxuICBwLmxldmVsKys7IHJldHVybiB0cnVlO1xufVxuLyoqIERlYnVnZ2luZzogcHV0IGV2ZXJ5IFNvdWwgYmFjayB0byBsZXZlbCAxIChjb3BpZXMgYXJlIGtlcHQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0TGV2ZWxzKHNhdmU6IFNhdmUpOiB2b2lkIHsgZm9yIChjb25zdCBrIG9mIFNPVUxTKSBzYXZlLnNvdWxzW2tdLmxldmVsID0gMTsgfVxuLyoqIERlYnVnZ2luZzogZm9yZ2V0IGFsbCBjb2xsZWN0ZWQgY29waWVzIChsZXZlbHMgYXJlIGtlcHQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyQ29waWVzKHNhdmU6IFNhdmUpOiB2b2lkIHsgZm9yIChjb25zdCBrIG9mIFNPVUxTKSBzYXZlLnNvdWxzW2tdLmNvcGllcyA9IDA7IH1cbi8qKiBNdWx0aXBsaWVyIGFwcGxpZWQgdG8gYSBTb3VsJ3MgaGVhbHRoL2RhbWFnZSBmcm9tIGl0cyBwZXJtYW5lbnQgbGV2ZWwgKGxldmVsIDEgPSAxLjApLiAqL1xuZXhwb3J0IGNvbnN0IGxldmVsTXVsdCA9IChsZXZlbDogbnVtYmVyLCBzdGF0OiAnaHAnIHwgJ2RtZycpOiBudW1iZXIgPT4gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEJBTEFOQ0UubGV2ZWxbc3RhdF07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBnb2xkXG5leHBvcnQgY29uc3QgR09MRCA9IHsgdGllck11bHQ6IHsgZWFzeTogMC42LCBub3JtYWw6IDEsIGhhcmQ6IDEuNCwgbmlnaHRtYXJlOiAyIH0gYXMgUmVjb3JkPERpZmZpY3VsdHksIG51bWJlcj4sIHBhY2tQZXJUaWVyOiAxNTAwLCBkYWlseVdpbjogNTAwMCB9O1xuLyoqIEdvbGQgZm9yIGNsZWFyaW5nIG9uZSBjYW1wYWlnbiB3YXZlOiBtb3JlIGluIGxhdGVyIHN0YWdlcyBhbmQgb24gaGFyZGVyIHRpZXJzLiAqL1xuZXhwb3J0IGNvbnN0IHdhdmVHb2xkID0gKHN0YWdlOiBzdHJpbmcsIHRpZXI6IERpZmZpY3VsdHkgfCBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgxMDAgKiAoNiArIDIgKiBzdGFnZUluZGV4KHN0YWdlKSkgKiAoR09MRC50aWVyTXVsdFt0aWVyIGFzIERpZmZpY3VsdHldID8/IDEpKSk7XG4vKiogR29sZCBmb3IgY2xlYXJpbmcgb25lIEVuZGxlc3Mgd2F2ZS4gKi9cbmV4cG9ydCBjb25zdCBlbmRsZXNzV2F2ZUdvbGQgPSAod2F2ZTogbnVtYmVyKTogbnVtYmVyID0+IDEwMCAqICg4ICsgTWF0aC5mbG9vcigwLjYgKiBNYXRoLm1heCgxLCB3YXZlKSkpO1xuLyoqIEdvbGQgZm9yIG9wZW5pbmcgYSBwYWNrIHRoYXQgZmluaXNoZWQgYXQgYHRpZXJgLiAqL1xuZXhwb3J0IGNvbnN0IHBhY2tHb2xkID0gKHRpZXI6IG51bWJlcik6IG51bWJlciA9PiBHT0xELnBhY2tQZXJUaWVyICogTWF0aC5tYXgoMSwgdGllcik7XG5leHBvcnQgZnVuY3Rpb24gYWRkR29sZChzYXZlOiBTYXZlLCBuOiBudW1iZXIpOiBudW1iZXIgeyBjb25zdCBnID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihuKSk7IHNhdmUuZ29sZCA9IE1hdGgubWluKDFlOSwgc2F2ZS5nb2xkICsgZyk7IHJldHVybiBnOyB9XG5leHBvcnQgZnVuY3Rpb24gYWRkR29sZEFuZFNhdmUobjogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IG51bWJlciB7IGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IGcgPSBhZGRHb2xkKHMsIG4pOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gZzsgfVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGFja3NcbmV4cG9ydCBmdW5jdGlvbiBncmFudFBhY2soc2F2ZTogU2F2ZSwgdGllcjogbnVtYmVyLCBzb3VyY2U6IHN0cmluZyk6IFBhY2tJdGVtIHwgbnVsbCB7XG4gIGlmIChzYXZlLnBhY2tzLmxlbmd0aCA+PSBNQVhfUEFDS1MpIHJldHVybiBudWxsO1xuICBjb25zdCBwYWNrOiBQYWNrSXRlbSA9IHsgaWQ6IHNhdmUubmV4dFBhY2tJZCsrLCB0aWVyOiBNYXRoLm1heCgxLCBNYXRoLm1pbihQQUNLX1RJRVJTLCBNYXRoLmZsb29yKHRpZXIpKSksIHNvdXJjZSB9O1xuICBzYXZlLnBhY2tzLnB1c2gocGFjayk7IHJldHVybiBwYWNrO1xufVxuXG4vKiogT3BlbiBhbiBvd25lZCBwYWNrOiBpdCBpcyByZW1vdmVkIGFuZCBpdHMgY29waWVzIGFyZSBhZGRlZCB0byB0aGUgU291bHMgaW1tZWRpYXRlbHkgKHNvIG5vdGhpbmcgaXMgbG9zdCBpZiB0aGUgcGFnZSBjbG9zZXMgbWlkLWFuaW1hdGlvbikuICovXG5leHBvcnQgZnVuY3Rpb24gb3Blbk93bmVkUGFjayhzYXZlOiBTYXZlLCBwYWNrSWQ6IG51bWJlciwgcm5nOiBSbmcpOiBQYWNrUmVzdWx0IHwgbnVsbCB7XG4gIGNvbnN0IGkgPSBzYXZlLnBhY2tzLmZpbmRJbmRleCgocCkgPT4gcC5pZCA9PT0gcGFja0lkKTsgaWYgKGkgPCAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGFjayA9IHNhdmUucGFja3NbaV07IHNhdmUucGFja3Muc3BsaWNlKGksIDEpO1xuICBjb25zdCByZXN1bHQgPSBvcGVuUGFjayhwYWNrLnRpZXIsIHJuZyk7XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgc2F2ZS5zb3Vsc1tyLnNvdWxdLmNvcGllcyArPSByLmNvcGllcztcbiAgYWRkR29sZChzYXZlLCBwYWNrR29sZChyZXN1bHQuZmluYWxUaWVyKSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xlYXJSZXdhcmQgeyBmaXJzdDogYm9vbGVhbjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyByZXBsYXlNZXRlcjogbnVtYmVyOyByZXBsYXlOZWVkZWQ6IG51bWJlcjsgdW5sb2NrZWQ6IHN0cmluZ1tdIH1cbi8qKiBBIHN0YWdlIHdhcyBjbGVhcmVkIG9uIGBkaWZmaWN1bHR5YC4gVGhlIGZpcnN0IGNsZWFyIG9uIHRoYXQgZGlmZmljdWx0eSBncmFudHMgYSBiZXR0ZXIgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgdGhlIHJlcGxheSBtZXRlci4gKi9cbmZ1bmN0aW9uIHJlY29yZENsZWFyQmFzZShzYXZlOiBTYXZlLCBzdGFnZUlkOiBzdHJpbmcsIGRpZmZpY3VsdHk6IERpZmZpY3VsdHkpOiBPbWl0PENsZWFyUmV3YXJkLCAndW5sb2NrZWQnPiB7XG4gIGNvbnN0IGtleSA9IHN0YWdlSWQgKyAnOicgKyBkaWZmaWN1bHR5LCBiZWZvcmUgPSBzYXZlLmNsZWFyc1trZXldID8/IDA7XG4gIHNhdmUuY2xlYXJzW2tleV0gPSBiZWZvcmUgKyAxO1xuICBpZiAoYmVmb3JlID09PSAwKSByZXR1cm4geyBmaXJzdDogdHJ1ZSwgcGFjazogZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMuZmlyc3RDbGVhclRpZXJbZGlmZmljdWx0eV0sICdGaXJzdCBjbGVhciBcdTAwQjcgJyArIGRpZmZpY3VsdHkpLCByZXBsYXlNZXRlcjogc2F2ZS5yZXBsYXlNZXRlciwgcmVwbGF5TmVlZGVkOiBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2sgfTtcbiAgc2F2ZS5yZXBsYXlNZXRlcisrO1xuICBsZXQgcGFjazogUGFja0l0ZW0gfCBudWxsID0gbnVsbDtcbiAgaWYgKHNhdmUucmVwbGF5TWV0ZXIgPj0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrKSB7IHNhdmUucmVwbGF5TWV0ZXIgLT0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrOyBwYWNrID0gZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMucmVwbGF5VGllciwgJ1JlcGxheSByZXdhcmQnKTsgfVxuICByZXR1cm4geyBmaXJzdDogZmFsc2UsIHBhY2ssIHJlcGxheU1ldGVyOiBzYXZlLnJlcGxheU1ldGVyLCByZXBsYXlOZWVkZWQ6IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjayB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyc2lzdGVkIHdyYXBwZXJzICh1c2VkIGJ5IHRoZSBnYW1lIGJ1bmRsZSlcbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRDbGVhckFuZFNhdmUoc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5LCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZENsZWFyKHMsIHN0YWdlSWQsIGRpZmZpY3VsdHkpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIERhaWx5IENoYWxsZW5nZVxuZXhwb3J0IGludGVyZmFjZSBEYWlseVJld2FyZCB7IGZpcnN0OiBib29sZWFuOyBwYWNrOiBQYWNrSXRlbSB8IG51bGw7IGdvbGQ6IG51bWJlciB9XG4vKiogVGhlIGRheSdzIGNoYWxsZW5nZSB3YXMgd29uLiBPbmx5IHRoZSBmaXJzdCB3aW4gb2YgYSBnaXZlbiBkYXkgcGF5cyAoYSBUaWVyIDEgcGFjayBhbmQgc29tZSBnb2xkKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmREYWlseVdpbihzYXZlOiBTYXZlLCBkYXk6IG51bWJlcik6IERhaWx5UmV3YXJkIHtcbiAgaWYgKHNhdmUuZGFpbHkgJiYgc2F2ZS5kYWlseS5kYXkgPT09IGRheSAmJiBzYXZlLmRhaWx5LndvbikgcmV0dXJuIHsgZmlyc3Q6IGZhbHNlLCBwYWNrOiBudWxsLCBnb2xkOiAwIH07XG4gIHNhdmUuZGFpbHkgPSB7IGRheSwgd29uOiB0cnVlIH07XG4gIHJldHVybiB7IGZpcnN0OiB0cnVlLCBwYWNrOiBncmFudFBhY2soc2F2ZSwgMSwgJ0RhaWx5IGNoYWxsZW5nZScpLCBnb2xkOiBhZGRHb2xkKHNhdmUsIEdPTEQuZGFpbHlXaW4pIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRGFpbHlXaW5BbmRTYXZlKGRheTogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IERhaWx5UmV3YXJkIHsgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZERhaWx5V2luKHMsIGRheSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByOyB9XG4vKiogSGFzIHRvZGF5J3MgcmV3YXJkIGFscmVhZHkgYmVlbiB0YWtlbj8gKi9cbmV4cG9ydCBjb25zdCBkYWlseURvbmUgPSAoc2F2ZTogU2F2ZSwgZGF5OiBudW1iZXIpOiBib29sZWFuID0+ICEhc2F2ZS5kYWlseSAmJiBzYXZlLmRhaWx5LmRheSA9PT0gZGF5ICYmIHNhdmUuZGFpbHkud29uO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gRW5kbGVzcyBEZXB0aHNcbmV4cG9ydCBpbnRlcmZhY2UgRW5kbGVzc1Jld2FyZCB7IHdhdmU6IG51bWJlcjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyBuZXdCZXN0OiBib29sZWFuIH1cbi8qKiBXYXZlIGB3YXZlYCBvZiBhbiBlbmRsZXNzIHJ1biB3YXMgY2xlYXJlZDogYSBwYWNrIG9uIGV2ZXJ5IDEwdGggd2F2ZSAoYmV0dGVyIHRpZXJzIGRlZXBlciksIGFuZCB0aGUgYmVzdCBkZXB0aCBpcyByZW1lbWJlcmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZEVuZGxlc3NXYXZlKHNhdmU6IFNhdmUsIHdhdmU6IG51bWJlcik6IEVuZGxlc3NSZXdhcmQge1xuICBjb25zdCBuZXdCZXN0ID0gd2F2ZSA+IHNhdmUuZW5kbGVzcy5iZXN0OyBpZiAobmV3QmVzdCkgc2F2ZS5lbmRsZXNzLmJlc3QgPSB3YXZlO1xuICBjb25zdCBwYWNrID0gd2F2ZSA+IDAgJiYgd2F2ZSAlIEVORExFU1NfUEFDS19FVkVSWSA9PT0gMCA/IGdyYW50UGFjayhzYXZlLCBlbmRsZXNzUGFja1RpZXIod2F2ZSksICdFbmRsZXNzIFx1MDBCNyB3YXZlICcgKyB3YXZlKSA6IG51bGw7XG4gIHJldHVybiB7IHdhdmUsIHBhY2ssIG5ld0Jlc3QgfTtcbn1cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFbmRsZXNzV2F2ZUFuZFNhdmUod2F2ZTogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IEVuZGxlc3NSZXdhcmQge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBjb25zdCByID0gcmVjb3JkRW5kbGVzc1dhdmUocywgd2F2ZSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByO1xufVxuLyoqIEVuZGxlc3MgRGVwdGhzIG9wZW5zIG9uY2UgdGhlIGxhc3QgY2FtcGFpZ24gc3RhZ2UgaGFzIGJlZW4gY2xlYXJlZCBvbiBOb3JtYWwuICovXG5leHBvcnQgY29uc3QgZW5kbGVzc1VubG9ja2VkID0gKHNhdmU6IFNhdmUpOiBib29sZWFuID0+IGNsZWFyQ291bnQoc2F2ZSwgU1RBR0VTW1NUQUdFUy5sZW5ndGggLSAxXS5pZCwgJ25vcm1hbCcpID4gMDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHVubG9jayBydWxlc1xuLy8gRWFzeSBhbmQgTm9ybWFsIGFyZSBvcGVuIG9uIGV2ZXJ5IHVubG9ja2VkIHN0YWdlLiBDbGVhcmluZyBOb3JtYWwgb3BlbnMgSGFyZCBvbiB0aGF0IHN0YWdlIEFORCB1bmxvY2tzIHRoZSBuZXh0IHN0YWdlLiBDbGVhcmluZyBIYXJkIG9wZW5zIE5pZ2h0bWFyZS5cbmV4cG9ydCBjb25zdCBjbGVhckNvdW50ID0gKHNhdmU6IFNhdmUsIHN0YWdlOiBzdHJpbmcsIGQ6IERpZmZpY3VsdHkpOiBudW1iZXIgPT4gc2F2ZS5jbGVhcnNbc3RhZ2UgKyAnOicgKyBkXSA/PyAwO1xuZXhwb3J0IGZ1bmN0aW9uIHN0YWdlVW5sb2NrZWQoc2F2ZTogU2F2ZSwgaW5kZXg6IG51bWJlcik6IGJvb2xlYW4geyByZXR1cm4gaW5kZXggPD0gMCB8fCAoaW5kZXggPCBTVEFHRVMubGVuZ3RoICYmIGNsZWFyQ291bnQoc2F2ZSwgU1RBR0VTW2luZGV4IC0gMV0uaWQsICdub3JtYWwnKSA+IDApOyB9XG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eVVubG9ja2VkKHNhdmU6IFNhdmUsIHN0YWdlOiBzdHJpbmcsIGQ6IERpZmZpY3VsdHkpOiBib29sZWFuIHtcbiAgY29uc3QgaWR4ID0gU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gc3RhZ2UpOyBpZiAoaWR4IDwgMCB8fCAhc3RhZ2VVbmxvY2tlZChzYXZlLCBpZHgpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChkID09PSAnZWFzeScgfHwgZCA9PT0gJ25vcm1hbCcpIHJldHVybiB0cnVlO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gY2xlYXJDb3VudChzYXZlLCBzdGFnZSwgJ25vcm1hbCcpID4gMCA6IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdoYXJkJykgPiAwO1xufVxuLyoqIFdoeSBhIHN0YWdlIGlzIGxvY2tlZCAoZW1wdHkgd2hlbiBpdCBpcyBvcGVuKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFnZUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgaW5kZXg6IG51bWJlcik6IHN0cmluZyB7IHJldHVybiBzdGFnZVVubG9ja2VkKHNhdmUsIGluZGV4KSA/ICcnIDogJ0NsZWFyICcgKyBTVEFHRVNbaW5kZXggLSAxXS5uYW1lICsgJyBvbiBOb3JtYWwgdG8gdW5sb2NrLic7IH1cbi8qKiBXaHkgYSB0aWVyIGlzIGxvY2tlZCAoZW1wdHkgd2hlbiBpdCBpcyBvcGVuKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaWZmaWN1bHR5TG9ja1JlYXNvbihzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogc3RyaW5nIHtcbiAgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdGFnZSwgZCkpIHJldHVybiAnJztcbiAgY29uc3QgaWR4ID0gc3RhZ2VJbmRleChzdGFnZSk7IGlmICghc3RhZ2VVbmxvY2tlZChzYXZlLCBpZHgpKSByZXR1cm4gc3RhZ2VMb2NrUmVhc29uKHNhdmUsIGlkeCk7XG4gIHJldHVybiBkID09PSAnaGFyZCcgPyAnQ2xlYXIgJyArIHN0YWdlQnlJZChzdGFnZSkubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jayBIYXJkLicgOiAnQ2xlYXIgJyArIHN0YWdlQnlJZChzdGFnZSkubmFtZSArICcgb24gSGFyZCB0byB1bmxvY2sgTmlnaHRtYXJlLic7XG59XG4vKiogV2hhdGV2ZXIgd2FzIHNhdmVkLCBtYWtlIGl0IGEgc3RhZ2UgYW5kIHRpZXIgdGhlIHBsYXllciBtYXkgYWN0dWFsbHkgcGxheS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwbGF5YWJsZShzYXZlOiBTYXZlKTogeyBzdGFnZTogc3RyaW5nOyBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5IH0ge1xuICBsZXQgaWR4ID0gc3RhZ2VJbmRleChzYXZlLnN0YWdlKTsgd2hpbGUgKGlkeCA+IDAgJiYgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgaWR4LS07XG4gIGNvbnN0IHN0YWdlID0gU1RBR0VTW2lkeF0uaWQ7XG4gIHJldHVybiB7IHN0YWdlLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIHNhdmUuZGlmZmljdWx0eSkgPyBzYXZlLmRpZmZpY3VsdHkgOiAnbm9ybWFsJyB9O1xufVxuXG4vKiogRXZlcnkgdW5sb2NrIHRoZSBwbGF5ZXIgbWF5IGJlIGNlbGVicmF0ZWQgZm9yOiBsYXRlciBzdGFnZXMgYW5kIHRoZSBIYXJkIC8gTmlnaHRtYXJlIHRpZXJzIChFYXN5LCBOb3JtYWwgYW5kIFN0YWdlIDEgYXJlIG9wZW4gZnJvbSB0aGUgc3RhcnQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVubG9ja2VkS2V5cyhzYXZlOiBTYXZlKTogc3RyaW5nW10ge1xuICBjb25zdCBrZXlzOiBzdHJpbmdbXSA9IFtdO1xuICBTVEFHRVMuZm9yRWFjaCgoc3QsIGkpID0+IHtcbiAgICBpZiAoaSA+IDAgJiYgc3RhZ2VVbmxvY2tlZChzYXZlLCBpKSkga2V5cy5wdXNoKCdzdGFnZTonICsgc3QuaWQpO1xuICAgIGZvciAoY29uc3QgZCBvZiBbJ2hhcmQnLCAnbmlnaHRtYXJlJ10gYXMgRGlmZmljdWx0eVtdKSBpZiAoZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0LmlkLCBkKSkga2V5cy5wdXNoKCd0aWVyOicgKyBzdC5pZCArICc6JyArIGQpO1xuICB9KTtcbiAgaWYgKGVuZGxlc3NVbmxvY2tlZChzYXZlKSkga2V5cy5wdXNoKCdlbmRsZXNzJyk7XG4gIHJldHVybiBrZXlzO1xufVxuLyoqIFVubG9ja3Mgbm90IHlldCBjZWxlYnJhdGVkLiAqL1xuZXhwb3J0IGNvbnN0IG5ld1VubG9ja3MgPSAoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdID0+IHVubG9ja2VkS2V5cyhzYXZlKS5maWx0ZXIoKGspID0+ICEoc2F2ZS5zZWVuID8/IFtdKS5pbmNsdWRlcyhrKSk7XG5jb25zdCBUSUVSX05BTUU6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IGhhcmQ6ICdIYXJkIG1vZGUnLCBuaWdodG1hcmU6ICdOaWdodG1hcmUgbW9kZScgfTtcbi8qKiBXb3JkcyBmb3IgYW4gdW5sb2NrIGtleSwgZm9yIGJhbm5lcnMuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVVbmxvY2soa2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoa2V5ID09PSAnZW5kbGVzcycpIHJldHVybiAnRW5kbGVzcyBEZXB0aHMgKG5ldyBtb2RlKSc7XG4gIGNvbnN0IFtraW5kLCBzdGFnZSwgdGllcl0gPSBrZXkuc3BsaXQoJzonKTtcbiAgaWYgKGtpbmQgPT09ICdzdGFnZScpIHJldHVybiBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIChuZXcgc3RhZ2UpJztcbiAgcmV0dXJuIChUSUVSX05BTUVbdGllcl0gPz8gdGllcikgKyAnIG9uICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWU7XG59XG4vKiogQ2xlYXJpbmcgYSBzdGFnZTogcmV3YXJkcywgYW5kIHdoaWNoIHVubG9ja3MgdGhpcyBjbGVhciBvcGVuZWQuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQ2xlYXIoc2F2ZTogU2F2ZSwgc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5KTogQ2xlYXJSZXdhcmQge1xuICBjb25zdCBiZWZvcmUgPSB1bmxvY2tlZEtleXMoc2F2ZSksIHIgPSByZWNvcmRDbGVhckJhc2Uoc2F2ZSwgc3RhZ2VJZCwgZGlmZmljdWx0eSk7XG4gIHJldHVybiB7IC4uLnIsIHVubG9ja2VkOiB1bmxvY2tlZEtleXMoc2F2ZSkuZmlsdGVyKChrKSA9PiAhYmVmb3JlLmluY2x1ZGVzKGspKSB9O1xufVxuIiwgIi8vIFRoZSBwbGF5ZXIncyBjaGFyYWN0ZXI6IHRoZSBOZWNyb21hbmNlciAoYSByaWdnZWQgVHJpcG8gbW9kZWwsIFBpcGVsaW5lL3VuaXRzL25lY3JvbWFuY2VyLmpzb24pLlxuLy8gSGUgc3RhbmRzIGJlc2lkZSB0aGUgZ3JpZCwgdGFrZXMgdGhlIGhpdCB3aGVuIGFuIGFybXkgaXMgd2lwZWQgKGhlYXJ0cyBhcmUgSElTIGhlYWx0aCksIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSBhbmQgcmFpc2VzXG4vLyB0aGUgZmFsbGVuLiBFdmVyeXRoaW5nIGhlcmUgaXMgYW5pbWF0aW9uIG9ubHk7IHRoZSBydWxlcyBsaXZlIGluIGNvcmUvcnVsZXMudHMuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuZXhwb3J0IGNsYXNzIE5lY3JvbWFuY2VyIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uOyBsb2NhbCArWiBpcyBoaXMgZmFjaW5nICh0aGUgZ2FtZSByb3RhdGVzIGhpbSB0byBmYWNlIHRoZSBiYXR0bGVmaWVsZClcbiAgcHJpdmF0ZSBlbnQ6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBoYW5kOiBhbnkgPSBudWxsOyBwcml2YXRlIHJpbmc6IGFueTsgcHJpdmF0ZSBwczogYW55O1xuICBwcml2YXRlIHQgPSAwOyBwcml2YXRlIGlkbGVUID0gMDsgcHJpdmF0ZSBuZXh0VGFwID0gODsgcHJpdmF0ZSBidXN5ID0gZmFsc2U7IHByaXZhdGUgZG93bmVkID0gZmFsc2U7IHByaXZhdGUgcmVhZG9ubHkgUyA9IDEuMzU7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSBzY2VuZTogYW55LCBwcml2YXRlIHNvZnQ6IGFueSwgY29udGFpbmVyOiBhbnkpIHtcbiAgICBjb25zdCBzID0gc2NlbmU7XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCduZWNybycsIHMpO1xuICAgIHRoaXMuZW50ID0gY29udGFpbmVyLmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ19uZWNybycsIGZhbHNlLCB7IGRvTm90SW5zdGFudGlhdGU6IHRydWUgfSk7XG4gICAgY29uc3Qgcm9vdCA9IHRoaXMuZW50LnJvb3ROb2Rlc1swXTsgcm9vdC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5TKTtcbiAgICByb290LmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IH0pO1xuICAgIHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IHsgZy5zdG9wKCk7IGcuZW5hYmxlQmxlbmRpbmcgPSB0cnVlOyBnLmJsZW5kaW5nU3BlZWQgPSAwLjEyOyB0aGlzLmFuaW1zW2cubmFtZS5zcGxpdCgnXycpWzBdXSA9IGc7IH0pO1xuICAgIHRoaXMuaGFuZCA9IHJvb3QuZ2V0Q2hpbGRUcmFuc2Zvcm1Ob2RlcyhmYWxzZSkuZmluZCgobjogYW55KSA9PiBuLm5hbWUuaW5jbHVkZXMoJ1NvY2tldF9XZWFwb24nKSkgfHwgbnVsbDtcbiAgICB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTtcbiAgICBjb25zdCByaW5nID0gdGhpcy5yaW5nID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdiYXNlJywgeyByYWRpdXM6IDAuNSwgdGVzc2VsbGF0aW9uOiAzMCB9LCBzKTsgcmluZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgcmluZy5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHJpbmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IHJtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbnInLCBzKTsgcm0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgcm0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQsIDAuMTUsIDAuNzUpOyBybS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBybS5hbHBoYSA9IDAuNTU7IHJpbmcubWF0ZXJpYWwgPSBybTtcbiAgICBjb25zdCBwcyA9IHRoaXMucHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnbmVjcm9BdXJhJywgODAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSBzb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5ob2xkZXI7XG4gICAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMjUsIDAsIC0wLjI1KTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yNSwgMC44LCAwLjI1KTsgcHMubWluTGlmZVRpbWUgPSAwLjY7IHBzLm1heExpZmVUaW1lID0gMS4zO1xuICAgIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjksIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS42LCAwLjE1KTsgcHMubWluRW1pdFBvd2VyID0gMC4zOyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMDc7IHBzLm1heFNpemUgPSAwLjI7IHBzLmVtaXRSYXRlID0gMzA7IHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjgsIDAuMzUsIDEsIDAuNyk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjQ1LCAwLjE1LCAwLjksIDAuNSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBwbGF5KG5hbWU6IHN0cmluZywgbG9vcCA9IGZhbHNlLCBob2xkID0gZmFsc2UpIHtcbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tuYW1lXTsgaWYgKCFnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuY3VyICYmIHRoaXMuY3VyICE9PSBnKSB0aGlzLmN1ci5zdG9wKCk7XG4gICAgZy5zdG9wKCk7IGcuc3RhcnQobG9vcCwgMSwgZy5mcm9tLCBnLnRvKTsgdGhpcy5jdXIgPSBnOyB0aGlzLmJ1c3kgPSAhbG9vcDsgdGhpcy5ob2xkRW5kID0gaG9sZDtcbiAgfVxuICBwcml2YXRlIGhvbGRFbmQgPSBmYWxzZTtcbiAgc2V0RW5hYmxlZChvbjogYm9vbGVhbikgeyB0aGlzLmhvbGRlci5zZXRFbmFibGVkKG9uKTsgaWYgKG9uKSB0aGlzLnBzLnN0YXJ0KCk7IGVsc2UgdGhpcy5wcy5zdG9wKCk7IH1cbiAgLyoqIFdvcmxkIHBvc2l0aW9uIG9mIHRoZSBzdGFmZiBjcnlzdGFsIChmb3Igc3BlbGwgZWZmZWN0cyk6IGFib3ZlIHRoZSBoYW5kIHRoYXQgaG9sZHMgdGhlIHN0YWZmLiAqL1xuICBjcnlzdGFsUG9zKCk6IGFueSB7XG4gICAgdGhpcy5ob2xkZXIuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpO1xuICAgIGNvbnN0IGJhc2UgPSB0aGlzLmhhbmQgPyAodGhpcy5oYW5kLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKSwgdGhpcy5oYW5kLmdldEFic29sdXRlUG9zaXRpb24oKS5jbG9uZSgpKSA6IHRoaXMuaG9sZGVyLmdldEFic29sdXRlUG9zaXRpb24oKS5hZGQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjYgKiB0aGlzLlMsIDApKTtcbiAgICByZXR1cm4gYmFzZS5hZGQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjYyICogdGhpcy5TLCAwKSk7XG4gIH1cblxuICBodXJ0KCkgeyBpZiAoIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0h1cnQnKTsgfVxuICBjYXN0KCkgeyBpZiAoIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0Nhc3QnKTsgfVxuICAvKiogVGhlIGxhc3QgaGVhcnQgaXMgZ29uZTogaGUgc2lua3MgdG8gaGlzIGtuZWVzLiAqL1xuICBkZWZlYXQoKSB7IHRoaXMuZG93bmVkID0gdHJ1ZTsgdGhpcy5wbGF5KCdEb3duJywgZmFsc2UsIHRydWUpOyB9XG4gIHJldml2ZSgpIHsgaWYgKHRoaXMuZG93bmVkKSB7IHRoaXMuZG93bmVkID0gZmFsc2U7IHRoaXMucGxheSgnUmV2aXZlJyk7IH0gZWxzZSBpZiAodGhpcy5idXN5ICYmIHRoaXMuY3VyICE9PSB0aGlzLmFuaW1zWydJZGxlJ10pIHRoaXMucGxheSgnSWRsZScsIHRydWUpOyB9XG5cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLnQgKz0gZHQ7XG4gICAgaWYgKHRoaXMuY3VyICYmICF0aGlzLmN1ci5pc1N0YXJ0ZWQgJiYgIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTsgICAgICAgICAgICAgIC8vIGEgb25lLXNob3QgZmluaXNoZWRcbiAgICBlbHNlIGlmICh0aGlzLmN1ciAmJiAhdGhpcy5jdXIuaXNTdGFydGVkICYmIHRoaXMuZG93bmVkICYmICF0aGlzLmhvbGRFbmQpIHRoaXMucGxheSgnSWRsZScsIHRydWUpO1xuICAgIGlmICghdGhpcy5idXN5ICYmICF0aGlzLmRvd25lZCkgeyB0aGlzLmlkbGVUICs9IGR0OyBpZiAodGhpcy5pZGxlVCA+IHRoaXMubmV4dFRhcCkgeyB0aGlzLmlkbGVUID0gMDsgdGhpcy5uZXh0VGFwID0gOSArIE1hdGgucmFuZG9tKCkgKiA4OyB0aGlzLnBsYXkoJ1RhcCcpOyB9IH1cbiAgICB0aGlzLnBzLmVtaXRSYXRlID0gdGhpcy5kb3duZWQgPyA2IDogKHRoaXMuYnVzeSAmJiB0aGlzLmN1ciA9PT0gdGhpcy5hbmltc1snQ2FzdCddID8gMTEwIDogMzApO1xuICB9XG5cbiAgZGlzcG9zZSgpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG4iLCAiLy8gQWxsIHNvdW5kIGlzIHN5bnRoZXNpemVkIGluIHRoZSBicm93c2VyIHdpdGggdGhlIFdlYiBBdWRpbyBBUEk6IG5vIGF1ZGlvIGZpbGVzIHRvIGRvd25sb2FkLCBsaWNlbnNlIG9yIHNoaXAuXG4vLyBUd28gaW5kZXBlbmRlbnQgc3dpdGNoZXMgKG11c2ljLCBzb3VuZCBlZmZlY3RzKSwgc2F2ZWQgaW4gdGhlIHBsYXllcidzIHNhdmUuIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdGFwLCBzbyBub3RoaW5nIHN0YXJ0c1xuLy8gdW50aWwgdGhlIGZpcnN0IHRvdWNoL2NsaWNrIChgdW5sb2NrYCkuXG5pbXBvcnQgeyBsb2FkU2F2ZSwgdXBkYXRlU2V0dGluZ3MgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuXG5leHBvcnQgdHlwZSBTZnggPSAndGFwJyB8ICdzdW1tb24nIHwgJ21lcmdlJyB8ICdoaXQnIHwgJ2hpdEFycm93JyB8ICdzbWFzaCcgfCAnYXJyb3cnIHwgJ2RlYXRoJyB8ICdjYXN0JyB8ICd0YXVudCcgfCAnc2hvY2t3YXZlJyB8ICdyZXN1cnJlY3QnIHwgJ2hlYXJ0TG9zdCcgfCAndmljdG9yeScgfCAnZGVmZWF0JyB8ICdzdGFydCdcbiAgfCAndW5sb2NrJyB8ICdwYWNrQ2hhcmdlJyB8ICdwYWNrVGllclVwJyB8ICdwYWNrVGVhcicgfCAncGFja0ZhbicgfCAncGFja0ZsaXAnIHwgJ3BhY2tSYXJlJyB8ICdwYWNrRXBpYycgfCAncGFja0xlZ2VuZCcgfCAncGFja0NvbGxlY3QnO1xuZXhwb3J0IHR5cGUgTW9kZSA9ICdidWlsZCcgfCAnYmF0dGxlJztcblxuLy8gTXVzaWM6IEEgbWlub3IsIDgwIGJwbSwgZm91ciBiYXJzIGxvb3BpbmcgKEFtLCBGLCBDLCBFKS4gUm9vdCBub3RlIGZpcnN0LCB0aGVuIGNob3JkIHRvbmVzIChIeikuXG5jb25zdCBDSE9SRFM6IG51bWJlcltdW10gPSBbXG4gIFsxMTAsIDE2NC44MSwgMjIwLCAyNjEuNjMsIDMyOS42M10sXG4gIFs4Ny4zMSwgMTMwLjgxLCAxNzQuNjEsIDIyMCwgMjYxLjYzXSxcbiAgWzEzMC44MSwgMTk2LCAyNjEuNjMsIDMyOS42MywgMzkyXSxcbiAgWzgyLjQxLCAxMjMuNDcsIDE2NC44MSwgMjA3LjY1LCAyNDYuOTRdLFxuXTtcbmNvbnN0IEJFQVQgPSA2MCAvIDgwO1xuXG5jbGFzcyBBdWRpb0VuZ2luZSB7XG4gIHByaXZhdGUgY3R4OiBBdWRpb0NvbnRleHQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBtYXN0ZXIhOiBHYWluTm9kZTsgcHJpdmF0ZSBtdXNpY0J1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIHNmeEJ1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIG5vaXNlQnVmITogQXVkaW9CdWZmZXI7XG4gIG11c2ljID0gdHJ1ZTsgc2Z4ID0gdHJ1ZTsgbW9kZTogTW9kZSA9ICdidWlsZCc7XG4gIHByaXZhdGUgdGltZXIgPSAwOyBwcml2YXRlIG5leHRUID0gMDsgcHJpdmF0ZSBiZWF0ID0gMDsgcHJpdmF0ZSBzdGFtcHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcigpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB9XG5cbiAgcHJpdmF0ZSBzaWxlbnQ6IEhUTUxBdWRpb0VsZW1lbnQgfCBudWxsID0gbnVsbDsgcHJpdmF0ZSBwcmltZWQgPSBmYWxzZTtcbiAgLyoqIGlQaG9uZXMgbXV0ZSBXZWIgQXVkaW8gd2hlbiB0aGUgcmluZ2VyIHN3aXRjaCBpcyBvbiwgdW5sZXNzIHRoZSBwYWdlIGlzIHBsYXlpbmcgXCJyZWFsXCIgbWVkaWEuIEEgc2lsZW50IGxvb3BpbmcgPGF1ZGlvPiBlbGVtZW50IChwbHVzIHRoZVxuICAgKiAgYXVkaW9TZXNzaW9uIGhpbnQgb24gbmV3ZXIgaU9TKSBtb3ZlcyB0aGUgcGFnZSB0byB0aGUgcGxheWJhY2sgY2hhbm5lbCwgc28gdGhlIGdhbWUgaXMgaGVhcmQgZXZlbiB3aXRoIHRoZSBzd2l0Y2ggb24gc2lsZW50LiAqL1xuICBwcml2YXRlIHBsYXliYWNrQ2hhbm5lbCgpIHtcbiAgICB0cnkgeyBjb25zdCBhID0gKG5hdmlnYXRvciBhcyBhbnkpLmF1ZGlvU2Vzc2lvbjsgaWYgKGEpIGEudHlwZSA9ICdwbGF5YmFjayc7IH0gY2F0Y2ggeyAvKiBub3Qgc3VwcG9ydGVkICovIH1cbiAgICBpZiAodGhpcy5zaWxlbnQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbiA9IDQ0MSwgYnVmID0gbmV3IEFycmF5QnVmZmVyKDQ0ICsgbiAqIDIpLCB2ID0gbmV3IERhdGFWaWV3KGJ1ZiksIHN0ciA9IChvOiBudW1iZXIsIHQ6IHN0cmluZykgPT4geyBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspIHYuc2V0VWludDgobyArIGksIHQuY2hhckNvZGVBdChpKSk7IH07XG4gICAgICBzdHIoMCwgJ1JJRkYnKTsgdi5zZXRVaW50MzIoNCwgMzYgKyBuICogMiwgdHJ1ZSk7IHN0cig4LCAnV0FWRScpOyBzdHIoMTIsICdmbXQgJyk7IHYuc2V0VWludDMyKDE2LCAxNiwgdHJ1ZSk7IHYuc2V0VWludDE2KDIwLCAxLCB0cnVlKTsgdi5zZXRVaW50MTYoMjIsIDEsIHRydWUpO1xuICAgICAgdi5zZXRVaW50MzIoMjQsIDQ0MTAwLCB0cnVlKTsgdi5zZXRVaW50MzIoMjgsIDg4MjAwLCB0cnVlKTsgdi5zZXRVaW50MTYoMzIsIDIsIHRydWUpOyB2LnNldFVpbnQxNigzNCwgMTYsIHRydWUpOyBzdHIoMzYsICdkYXRhJyk7IHYuc2V0VWludDMyKDQwLCBuICogMiwgdHJ1ZSk7XG4gICAgICBjb25zdCBlbCA9IG5ldyBBdWRpbyhVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtidWZdLCB7IHR5cGU6ICdhdWRpby93YXYnIH0pKSk7IGVsLmxvb3AgPSB0cnVlOyBlbC52b2x1bWUgPSAwLjAxOyBlbC5zZXRBdHRyaWJ1dGUoJ3BsYXlzaW5saW5lJywgJycpOyB0aGlzLnNpbGVudCA9IGVsO1xuICAgICAgZWwucGxheSgpLmNhdGNoKCgpID0+IHsgdGhpcy5zaWxlbnQgPSBudWxsOyB9KTtcbiAgICB9IGNhdGNoIHsgLyogZmluZTogc291bmQgc3RpbGwgd29ya3MsIGp1c3QgZm9sbG93cyB0aGUgc2lsZW50IHN3aXRjaCAqLyB9XG4gIH1cbiAgLyoqIFdoYXQgdGhlIFNldHRpbmdzIHBhZ2Ugc2hvd3Mgc28gYSBzaWxlbnQgcGhvbmUgY2FuIGJlIGRpYWdub3NlZC4gKi9cbiAgc3RhdHVzKCk6IHsgc3RhdGU6IHN0cmluZzsgdW5sb2NrZWQ6IGJvb2xlYW4gfSB7IHJldHVybiB7IHN0YXRlOiB0aGlzLmN0eCA/IHRoaXMuY3R4LnN0YXRlIDogJ25vdCBzdGFydGVkJywgdW5sb2NrZWQ6ICEhdGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgPT09ICdydW5uaW5nJyB9OyB9XG4gIC8qKiBUaGUgU2V0dGluZ3MgcGFnZSdzIFRlc3Qgc291bmQgYnV0dG9uOiB1bmxvY2sgYW5kIG1ha2UgYSBjbGVhcmx5IGF1ZGlibGUgc291bmQuICovXG4gIHRlc3QoKSB7IHRoaXMudW5sb2NrKCk7IGNvbnN0IHQgPSAoKSA9PiB7IHRoaXMucGxheSgndmljdG9yeScpOyB9OyBpZiAodGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkudGhlbih0KS5jYXRjaCgoKSA9PiB7fSk7IGVsc2UgdCgpOyB9XG5cbiAgLyoqIENhbGwgZnJvbSBhIHVzZXIgZ2VzdHVyZSAodGFwL2NsaWNrKS4gU2FmZSB0byBjYWxsIHJlcGVhdGVkbHkuICovXG4gIHVubG9jaygpIHtcbiAgICB0aGlzLnBsYXliYWNrQ2hhbm5lbCgpO1xuICAgIGlmICghdGhpcy5jdHgpIHtcbiAgICAgIGNvbnN0IEMgPSAod2luZG93IGFzIGFueSkuQXVkaW9Db250ZXh0IHx8ICh3aW5kb3cgYXMgYW55KS53ZWJraXRBdWRpb0NvbnRleHQ7IGlmICghQykgcmV0dXJuO1xuICAgICAgY29uc3QgY3R4OiBBdWRpb0NvbnRleHQgPSB0aGlzLmN0eCA9IG5ldyBDKCk7XG4gICAgICBjb25zdCBjb21wID0gY3R4LmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvcigpOyBjb21wLmNvbm5lY3QoY3R4LmRlc3RpbmF0aW9uKTtcbiAgICAgIHRoaXMubWFzdGVyID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tYXN0ZXIuZ2Fpbi52YWx1ZSA9IDAuOTsgdGhpcy5tYXN0ZXIuY29ubmVjdChjb21wKTtcbiAgICAgIHRoaXMubXVzaWNCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm11c2ljQnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpOyB0aGlzLnNmeEJ1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMuc2Z4QnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpO1xuICAgICAgY3R4Lm9uc3RhdGVjaGFuZ2UgPSAoKSA9PiB7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tYXVkaW8tc3RhdGUnKSk7IH07XG4gICAgICBjb25zdCBsZW4gPSBjdHguc2FtcGxlUmF0ZTsgdGhpcy5ub2lzZUJ1ZiA9IGN0eC5jcmVhdGVCdWZmZXIoMSwgbGVuLCBjdHguc2FtcGxlUmF0ZSk7IGNvbnN0IGQgPSB0aGlzLm5vaXNlQnVmLmdldENoYW5uZWxEYXRhKDApOyBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKSBkW2ldID0gTWF0aC5yYW5kb20oKSAqIDIgLSAxO1xuICAgIH1cbiAgICBpZiAodGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkuY2F0Y2goKCkgPT4ge30pOyAgICAgICAgICAgICAvLyAnc3VzcGVuZGVkJyBvciAoaU9TKSAnaW50ZXJydXB0ZWQnXG4gICAgaWYgKCF0aGlzLnByaW1lZCkgeyB0aGlzLnByaW1lZCA9IHRydWU7IHRyeSB7IGNvbnN0IGIgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXIoMSwgMSwgMjIwNTApLCBzID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyU291cmNlKCk7IHMuYnVmZmVyID0gYjsgcy5jb25uZWN0KHRoaXMuY3R4LmRlc3RpbmF0aW9uKTsgcy5zdGFydCgwKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9IH1cbiAgICB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTtcbiAgfVxuXG4gIHNldE11c2ljKG9uOiBib29sZWFuKSB7IHRoaXMubXVzaWMgPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBtdXNpYzogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyB9XG4gIHNldFNmeChvbjogYm9vbGVhbikgeyB0aGlzLnNmeCA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IHNmeDogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyBpZiAob24pIHRoaXMucGxheSgndGFwJyk7IH1cbiAgLyoqIFJlLXJlYWQgdGhlIHNhdmVkIHN3aXRjaGVzICh0aGUgc2hlbGwncyBTZXR0aW5ncyBwYWdlIGNoYW5nZXMgdGhlbSB0b28pLiAqL1xuICByZWxvYWQoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IH1cbiAgc2V0TW9kZShtOiBNb2RlKSB7IHRoaXMubW9kZSA9IG07IH1cblxuICBwcml2YXRlIGFwcGx5R2FpbnMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuOyBjb25zdCB0ID0gdGhpcy5jdHguY3VycmVudFRpbWU7XG4gICAgdGhpcy5tdXNpY0J1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLm11c2ljID8gMC41IDogMCwgdCwgMC4xNSk7IHRoaXMuc2Z4QnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMuc2Z4ID8gMC44IDogMCwgdCwgMC4wNSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbXVzaWNcbiAgcHJpdmF0ZSBzeW5jTXVzaWMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLm11c2ljICYmICF0aGlzLnRpbWVyKSB7IHRoaXMubmV4dFQgPSB0aGlzLmN0eC5jdXJyZW50VGltZSArIDAuMTU7IHRoaXMudGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy50aWNrKCksIDIwMCk7IH1cbiAgICBpZiAoIXRoaXMubXVzaWMgJiYgdGhpcy50aW1lcikgeyBjbGVhckludGVydmFsKHRoaXMudGltZXIpOyB0aGlzLnRpbWVyID0gMDsgfVxuICB9XG4gIHByaXZhdGUgdGljaygpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7IGlmIChjdHguc3RhdGUgIT09ICdydW5uaW5nJykgeyB0aGlzLm5leHRUID0gY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgcmV0dXJuOyB9XG4gICAgd2hpbGUgKHRoaXMubmV4dFQgPCBjdHguY3VycmVudFRpbWUgKyAwLjYpIHsgdGhpcy5wbGF5QmVhdCh0aGlzLmJlYXQsIHRoaXMubmV4dFQpOyB0aGlzLm5leHRUICs9IEJFQVQ7IHRoaXMuYmVhdCA9ICh0aGlzLmJlYXQgKyAxKSAlIDE2OyB9XG4gIH1cbiAgcHJpdmF0ZSBwbGF5QmVhdChiZWF0OiBudW1iZXIsIHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGNob3JkID0gQ0hPUkRTW01hdGguZmxvb3IoYmVhdCAvIDQpXSwgaW5CYXIgPSBiZWF0ICUgNCwgYmF0dGxlID0gdGhpcy5tb2RlID09PSAnYmF0dGxlJztcbiAgICBpZiAoaW5CYXIgPT09IDApIGZvciAoY29uc3QgZiBvZiBjaG9yZCkgdGhpcy52b2ljZShmLCAndHJpYW5nbGUnLCB0LCBCRUFUICogNCArIDAuOCwgMC4wNDUsIDAuOSwgOTAwKTsgICAvLyBzbG93IHBhZFxuICAgIGlmIChpbkJhciA9PT0gMCB8fCBpbkJhciA9PT0gMikgdGhpcy52b2ljZShjaG9yZFswXSwgJ3NpbmUnLCB0LCBCRUFUICogMS42LCAwLjE2LCAwLjAyLCA0MDApOyAgICAgICAgICAvLyBiYXNzXG4gICAgaWYgKGJhdHRsZSkge1xuICAgICAgdGhpcy5raWNrKHQsIDAuMzIpOyBpZiAoaW5CYXIgPT09IDIpIHRoaXMua2ljayh0ICsgQkVBVCAqIDAuNSwgMC4xOCk7XG4gICAgICB0aGlzLm5vaXNlKHQgKyBCRUFUICogMC41LCAwLjA1LCAwLjA1LCAnaGlnaHBhc3MnLCA3MDAwKTsgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDEuNSAlIEJFQVQsIDAuMDUsIDAuMDMsICdoaWdocGFzcycsIDcwMDApO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAyOyBpKyspIHRoaXMudm9pY2UoY2hvcmRbMSArICgoYmVhdCAqIDIgKyBpKSAlIDQpXSAqIDIsICd0cmlhbmdsZScsIHQgKyBpICogQkVBVCAvIDIsIDAuMjIsIDAuMDUsIDAuMDA1LCAyNTAwKTsgICAvLyBwbHVjayBhcnBlZ2dpb1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHZvaWNlKGZyZXE6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgYXR0YWNrOiBudW1iZXIsIGxwOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS52YWx1ZSA9IGZyZXE7IGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBNYXRoLm1heCgwLjAwNSwgYXR0YWNrKSk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGtpY2sodDogbnVtYmVyLCBnYWluOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZSgxMzAsIHQpOyBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDQyLCB0ICsgMC4xNCk7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgMC4yKTtcbiAgICBvLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyAwLjI1KTtcbiAgfVxuICBwcml2YXRlIG5vaXNlKHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBidXM6IEdhaW5Ob2RlID0gdGhpcy5tdXNpY0J1cywgc3dlZXBUbz86IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbiA9IGN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgbi5idWZmZXIgPSB0aGlzLm5vaXNlQnVmOyBmLnR5cGUgPSB0eXBlOyBmLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHN3ZWVwVG8pIGYuZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc3dlZXBUbywgdCArIGR1cik7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG4uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QoYnVzKTsgbi5zdGFydCh0LCBNYXRoLnJhbmRvbSgpICogMC41KTsgbi5zdG9wKHQgKyBkdXIgKyAwLjAyKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzb3VuZCBlZmZlY3RzXG4gIHByaXZhdGUgdG9uZShmcmVxOiBudW1iZXIsIGR1cjogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZ2FpbjogbnVtYmVyLCBkZWxheSA9IDAsIHNsaWRlVG8/OiBudW1iZXIsIGF0dGFjayA9IDAuMDA1LCBscCA9IDgwMDApIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIHQgPSBjdHguY3VycmVudFRpbWUgKyBkZWxheSwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc2xpZGVUbykgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzbGlkZVRvLCB0ICsgZHVyKTtcbiAgICBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIGF0dGFjayk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLnNmeEJ1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBoaXNzKGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgZGVsYXkgPSAwLCBzd2VlcFRvPzogbnVtYmVyKSB7IHRoaXMubm9pc2UodGhpcy5jdHghLmN1cnJlbnRUaW1lICsgZGVsYXksIGR1ciwgZ2FpbiwgdHlwZSwgZnJlcSwgdGhpcy5zZnhCdXMsIHN3ZWVwVG8pOyB9XG4gIHByaXZhdGUgdGhyb3R0bGUoa2V5OiBzdHJpbmcsIG1zOiBudW1iZXIpIHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpOyBpZiAobiAtICh0aGlzLnN0YW1wc1trZXldIHx8IDApIDwgbXMpIHJldHVybiBmYWxzZTsgdGhpcy5zdGFtcHNba2V5XSA9IG47IHJldHVybiB0cnVlOyB9XG5cbiAgLyoqIEEgU291bCdzIHZvaWNlLCBzeW50aGVzaXplZDogc2tlbGV0b24gcmF0dGxlLCBhcmNoZXIgd2hpc3RsZSwgZ29ibGluIGNhY2tsZSwga25pZ2h0IGdydW50LCBvZ3JlIGdyb3dsLCBiYXJiYXJpYW4gcm9hci4gYGtgIHNoaWZ0cyB0aGUgcGl0Y2ggKGVuZW1pZXMgYSBsaXR0bGUgbG93ZXIpLCBgZGVsYXlgIHN0YWdnZXJzIGEgY2hvcnVzLiAqL1xuICBiYXJrKHNvdWw6IHN0cmluZywgZGVsYXkgPSAwLCBrID0gMSkge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuc2Z4IHx8IHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycgfHwgIXRoaXMudGhyb3R0bGUoJ2JhcmsnICsgc291bCwgMzUwKSkgcmV0dXJuO1xuICAgIGNvbnN0IFQgPSAoZjogbnVtYmVyLCBkOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCBnOiBudW1iZXIsIGRsOiBudW1iZXIsIHNsaWRlPzogbnVtYmVyLCBhdHQ/OiBudW1iZXIsIGxwPzogbnVtYmVyKSA9PiB0aGlzLnRvbmUoZiAqIGssIGQsIHR5cGUsIGcsIGRlbGF5ICsgZGwsIHNsaWRlID8gc2xpZGUgKiBrIDogdW5kZWZpbmVkLCBhdHQsIGxwKTtcbiAgICBjb25zdCBIID0gKGQ6IG51bWJlciwgZzogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmOiBudW1iZXIsIGRsOiBudW1iZXIsIHN3PzogbnVtYmVyKSA9PiB0aGlzLmhpc3MoZCwgZywgdHlwZSwgZiwgZGVsYXkgKyBkbCwgc3cpO1xuICAgIHN3aXRjaCAoc291bCkge1xuICAgICAgY2FzZSAnd2Fycmlvcic6IFswLCAwLjA2LCAwLjEyLCAwLjE5XS5mb3JFYWNoKChkbCkgPT4gSCgwLjAzLCAwLjE2LCAnaGlnaHBhc3MnLCAzNTAwLCBkbCkpOyBUKDUyMCwgMC4yMiwgJ3NxdWFyZScsIDAuMDcsIDAsIDI4MCwgMC4wMDUsIDE4MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2FyY2hlcic6IFQoOTAwLCAwLjE2LCAnc2luZScsIDAuMTMsIDAsIDEzNTAsIDAuMDEpOyBUKDEzNTAsIDAuMjIsICdzaW5lJywgMC4xMSwgMC4xNiwgNzYwLCAwLjAxKTsgYnJlYWs7XG4gICAgICBjYXNlICdnb2JsaW4nOiBbMCwgMC4xMSwgMC4yMl0uZm9yRWFjaCgoZGwsIGkpID0+IFQoNTAwICsgaSAqIDcwLCAwLjEsICdzYXd0b290aCcsIDAuMDksIGRsLCA2MjAgKyBpICogNzAsIDAuMDA1LCAyNjAwKSk7IEgoMC4zLCAwLjA1LCAnYmFuZHBhc3MnLCAyMjAwLCAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdrbmlnaHQnOiBUKDE1MCwgMC4zMiwgJ3Nhd3Rvb3RoJywgMC4xMiwgMCwgMTA1LCAwLjAyLCA5MDApOyBUKDIyNSwgMC4zLCAnc3F1YXJlJywgMC4wNSwgMC4wMiwgMTYwLCAwLjAyLCA5MDApOyBIKDAuMDgsIDAuMTIsICdoaWdocGFzcycsIDQ1MDAsIDAuMSk7IGJyZWFrO1xuICAgICAgY2FzZSAnb2dyZSc6IFQoNzUsIDAuNzUsICdzYXd0b290aCcsIDAuMiwgMCwgNTIsIDAuMDUsIDMyMCk7IFQoMTEyLCAwLjcsICdzYXd0b290aCcsIDAuMDgsIDAuMDMsIDgwLCAwLjA1LCA0MjApOyBIKDAuNiwgMC4xMiwgJ2xvd3Bhc3MnLCA0MjAsIDAuMDIsIDE0MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnYmFyYmFyaWFuJzogVCgxNzAsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4xNCwgMCwgMzQwLCAwLjAzLCAxNDAwKTsgVCgzNDAsIDAuNDUsICdzYXd0b290aCcsIDAuMDgsIDAuMSwgMjEwLCAwLjAzLCAxNjAwKTsgSCgwLjQ1LCAwLjEsICdiYW5kcGFzcycsIDkwMCwgMCwgNTAwKTsgYnJlYWs7XG4gICAgfVxuICB9XG4gIHBsYXkobmFtZTogU2Z4KSB7XG4gICAgaWYgKCF0aGlzLmN0eCB8fCAhdGhpcy5zZnggfHwgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgcmV0dXJuO1xuICAgIHN3aXRjaCAobmFtZSkge1xuICAgICAgY2FzZSAndGFwJzogaWYgKCF0aGlzLnRocm90dGxlKCd0YXAnLCA0MCkpIHJldHVybjsgdGhpcy50b25lKDc2MCwgMC4wNiwgJ3NpbmUnLCAwLjIyLCAwLCAxMTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzdW1tb24nOiB0aGlzLmhpc3MoMC40LCAwLjE0LCAnYmFuZHBhc3MnLCA1MDAsIDAsIDI1MDApOyB0aGlzLnRvbmUoMjIwLCAwLjQsICdzYXd0b290aCcsIDAuMSwgMCwgNjYwLCAwLjA1LCAxODAwKTsgdGhpcy50b25lKDEzMjAsIDAuMiwgJ3NpbmUnLCAwLjEsIDAuMTgpOyBicmVhaztcbiAgICAgIGNhc2UgJ21lcmdlJzogWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDgsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjM1LCAwLCA1MCk7IHRoaXMudG9uZSgxNTY4LCAwLjUsICdzaW5lJywgMC4wOCwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICdoaXQnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdCcsIDQ1KSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4wNywgMC4yNCwgJ2xvd3Bhc3MnLCAxODAwKTsgdGhpcy50b25lKDE3MCwgMC4wOSwgJ3NpbmUnLCAwLjIyLCAwLCA4MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0QXJyb3cnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdEEnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDUsIDAuMTQsICdiYW5kcGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNzAwLCAwLjA2LCAndHJpYW5nbGUnLCAwLjA2LCAwLCA0MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3NtYXNoJzogdGhpcy50b25lKDk1LCAwLjM4LCAnc2luZScsIDAuNSwgMCwgMzQpOyB0aGlzLmhpc3MoMC4zMiwgMC4zNSwgJ2xvd3Bhc3MnLCAxMDAwLCAwLCAyMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2Fycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdhcnJvdycsIDYwKSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4xNCwgMC4xLCAnYmFuZHBhc3MnLCAxODAwLCAwLCA0MjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdkZWF0aCc6IGlmICghdGhpcy50aHJvdHRsZSgnZGVhdGgnLCA3MCkpIHJldHVybjsgdGhpcy50b25lKDMwMCwgMC40LCAnc2F3dG9vdGgnLCAwLjE0LCAwLCA3MCwgMC4wMSwgOTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdjYXN0JzogdGhpcy50b25lKDMwMCwgMC40NSwgJ3NpbmUnLCAwLjE4LCAwLCA5MDAsIDAuMDUpOyB0aGlzLnRvbmUoNDUwLCAwLjQ1LCAnc2luZScsIDAuMSwgMC4wNSwgMTM1MCwgMC4wNSk7IHRoaXMudG9uZSgxODAwLCAwLjI1LCAnc2luZScsIDAuMDUsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndGF1bnQnOiB0aGlzLnRvbmUoMTk2LCAwLjUsICdzcXVhcmUnLCAwLjA4LCAwLCAxODAsIDAuMDMsIDcwMCk7IHRoaXMudG9uZSgxNDcsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4wOCwgMC4wMiwgMTQwLCAwLjAzLCA2MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3Nob2Nrd2F2ZSc6IHRoaXMudG9uZSgyMjAsIDEuMSwgJ3NpbmUnLCAwLjUsIDAsIDI4LCAwLjAyKTsgdGhpcy5oaXNzKDEuMCwgMC4zNSwgJ2xvd3Bhc3MnLCAzMDAwLCAwLCAxNTApOyB0aGlzLnRvbmUoODgwLCAwLjgsICdzaW5lJywgMC4wOCwgMCwgMjIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdyZXN1cnJlY3QnOiBbMjIwLCAyNzcsIDMzMCwgNDQwLCA1NTRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMSwgaSAqIDAuMTIsIGYgKiAxLjEyLCAwLjMpKTsgdGhpcy5oaXNzKDAuOSwgMC4wNiwgJ2hpZ2hwYXNzJywgNDUwMCwgMC4yKTsgYnJlYWs7XG4gICAgICBjYXNlICdoZWFydExvc3QnOiB0aGlzLnRvbmUoMTEwLCAwLjcsICdzYXd0b290aCcsIDAuMjgsIDAsIDUwLCAwLjAxLCA0NTApOyB0aGlzLmhpc3MoMC4xOCwgMC4yLCAnbG93cGFzcycsIDkwMCk7IHRoaXMudG9uZSgyMzMsIDAuNSwgJ3NxdWFyZScsIDAuMDUsIDAuMDIsIDIyMCwgMC4wMSwgNTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICd2aWN0b3J5JzogWzM5MiwgNDk0LCA1ODcsIDc4NF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMTEpKTsgdGhpcy50b25lKDE5NiwgMC45LCAnc2luZScsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVmZWF0JzogWzMzMCwgMjk0LCAyNDcsIDE5Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNywgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMjgsIGYgKiAwLjk3KSk7IHRoaXMudG9uZSg4MiwgMS42LCAnc2luZScsIDAuMywgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICd1bmxvY2snOiBbMC4zNSwgMC40NywgMC41OSwgMC43MV0uZm9yRWFjaCgoZCwgaSkgPT4geyB0aGlzLmhpc3MoMC4wNSwgMC4yMiwgJ2JhbmRwYXNzJywgOTAwICsgaSAqIDEyMCwgZCk7IHRoaXMudG9uZSgxNzAgKyBpICogMTIsIDAuMDcsICdzcXVhcmUnLCAwLjA2LCBkLCB1bmRlZmluZWQsIDAuMDAyLCA2MDApOyB9KTsgWzc4NCwgMTA0NiwgMTMxOF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNiwgJ3RyaWFuZ2xlJywgMC4xNiwgMS4xNSArIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDksICdoaWdocGFzcycsIDUwMDAsIDEuMik7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjI1LCAxLjE1LCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NoYXJnZSc6IHRoaXMudG9uZSg5MCwgMS4wNSwgJ3NpbmUnLCAwLjI1LCAwLCAyNjAsIDAuMik7IHRoaXMuaGlzcygwLjk1LCAwLjEyLCAnbG93cGFzcycsIDMwMCwgMCwgMjIwMCk7IHRoaXMudG9uZSgxODAsIDEuMCwgJ3RyaWFuZ2xlJywgMC4wNiwgMC4xLCA1MjAsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1RpZXJVcCc6IFs0NDAsIDU1NCwgNjU5LCA4ODBdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjQsICd0cmlhbmdsZScsIDAuMiwgaSAqIDAuMDYpKTsgdGhpcy50b25lKDE3NjAsIDAuNiwgJ3NpbmUnLCAwLjA5LCAwLjIpOyB0aGlzLmhpc3MoMC40LCAwLjEsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1RlYXInOiB0aGlzLmhpc3MoMC4zNSwgMC4zLCAnYmFuZHBhc3MnLCAxNTAwLCAwLCA2MDAwKTsgdGhpcy50b25lKDEyMCwgMC40NSwgJ3NpbmUnLCAwLjQsIDAuMDUsIDQwKTsgWzEwNDYsIDEzMTgsIDE1NjhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjYsICd0cmlhbmdsZScsIDAuMSwgMC4xMiArIGkgKiAwLjA1KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0Zhbic6IHRoaXMuaGlzcygwLjUsIDAuMSwgJ2hpZ2hwYXNzJywgMzAwMCk7IHRoaXMudG9uZSg2NjAsIDAuNDUsICdzaW5lJywgMC4xLCAwLCAxMzIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRmxpcCc6IHRoaXMuaGlzcygwLjA4LCAwLjE1LCAnYmFuZHBhc3MnLCAyNTAwKTsgdGhpcy50b25lKDUwMCwgMC4xMiwgJ3NpbmUnLCAwLjE0LCAwLCA4MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tSYXJlJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNzg0LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjQ1LCAndHJpYW5nbGUnLCAwLjE0LCAwLjA1ICsgaSAqIDAuMDkpKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRXBpYyc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjcsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA3KSk7IHRoaXMudG9uZSgxMTAsIDAuNSwgJ3NpbmUnLCAwLjMsIDAsIDYwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrTGVnZW5kJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNTIzLCA2NTksIDc4NCwgMTA0NiwgMTMxOF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDEuMSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMDgpKTsgdGhpcy50b25lKDgyLCAwLjksICdzaW5lJywgMC4zNSwgMCwgNTApOyB0aGlzLmhpc3MoMC44LCAwLjEsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgyMDkzLCAwLjcsICdzaW5lJywgMC4wNywgMC40KTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrQ29sbGVjdCc6IFs2NTksIDk4OF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuMzUsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAnc3RhcnQnOiB0aGlzLnRvbmUoMTQ3LCAwLjksICdzYXd0b290aCcsIDAuMTMsIDAsIDE1MCwgMC4xNSwgNjUwKTsgdGhpcy50b25lKDIyMCwgMC45LCAnc2F3dG9vdGgnLCAwLjA5LCAwLjA1LCAyMjQsIDAuMTUsIDY1MCk7IHRoaXMuaGlzcygwLjYsIDAuMDYsICdsb3dwYXNzJywgNjAwKTsgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBhdWRpbyA9IG5ldyBBdWRpb0VuZ2luZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fYXVkaW8gPSBhdWRpbztcblxuLy8gUGhvbmVzIG9ubHkgYWxsb3cgc291bmQgYWZ0ZXIgYSB0b3VjaDogdGhlIGZpcnN0IHRhcCBhbnl3aGVyZSB1bmxvY2tzIGl0LiBFdmVyeSBidXR0b24gYWxzbyBnZXRzIGEgc21hbGwgY2xpY2suXG4vLyBpT1Mgb25seSBhY2NlcHRzIGFuIHVubG9jayBmcm9tIGEgRklOSVNIRUQgdGFwICh0b3VjaGVuZCAvIGNsaWNrKSwgbm90IGZyb20gdGhlIHN0YXJ0IG9mIG9uZSwgc28gbGlzdGVuIHRvIGFsbCBvZiB0aGVtLlxuY29uc3QgdW5sb2NrT25jZSA9ICgpID0+IGF1ZGlvLnVubG9jaygpO1xuZm9yIChjb25zdCBldiBvZiBbJ3BvaW50ZXJkb3duJywgJ3BvaW50ZXJ1cCcsICd0b3VjaGVuZCcsICdjbGljaycsICdrZXlkb3duJ10pIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXYsIHVubG9ja09uY2UsIHsgY2FwdHVyZTogdHJ1ZSB9KTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgY29uc3QgZWwgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7IGlmIChlbCAmJiBlbC5jbG9zZXN0ICYmIGVsLmNsb3Nlc3QoJ2J1dHRvbiwgYS5idG4sIC5yYWlsIGEnKSkgYXVkaW8ucGxheSgndGFwJyk7IH0sIHRydWUpO1xuZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigndmlzaWJpbGl0eWNoYW5nZScsICgpID0+IHsgY29uc3QgYyA9IChhdWRpbyBhcyBhbnkpLmN0eCBhcyBBdWRpb0NvbnRleHQgfCBudWxsOyBpZiAoIWMpIHJldHVybjsgaWYgKGRvY3VtZW50LmhpZGRlbikgYy5zdXNwZW5kKCk7IGVsc2UgaWYgKGF1ZGlvLm11c2ljIHx8IGF1ZGlvLnNmeCkgYy5yZXN1bWUoKTsgfSk7XG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MtY2hhbmdlZCcsICgpID0+IGF1ZGlvLnJlbG9hZCgpKTtcbiIsICIvLyBTYXZpbmcgYSBydW4gaW4gcHJvZ3Jlc3Mgc28gaXQgc3Vydml2ZXMgYSBwYWdlIHJlbG9hZCAoU2FmYXJpIG9uIGEgcGhvbmUgY2FuIGRyb3AgdGhlIHBhZ2UgYXQgYW55IHRpbWUpLlxuLy8gT25seSBjYWxtIG1vbWVudHMgYXJlIHNhdmVkOiB0aGUgYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0LiBBIGJhdHRsZSBpbiBwcm9ncmVzcyBpcyBub3Qgc2F2ZWQ7IHJlbG9hZGluZyBkdXJpbmcgb25lIHB1dHMgeW91IGJhY2tcbi8vIGF0IHRoZSBidWlsZCBzY3JlZW4geW91IHByZXNzZWQgQmF0dGxlIGZyb20gKG5vdGhpbmcgbG9zdCwgbm90aGluZyBnYWluZWQpLiBFdmVyeXRoaW5nIHJlYWQgYmFjayBpcyB2YWxpZGF0ZWQ7IGFueXRoaW5nIG9kZCBpcyBpZ25vcmVkLlxuXG5pbXBvcnQgeyBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzLCBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUsIFVuaXQgfSBmcm9tICcuL3J1bGVzLnRzJztcbmltcG9ydCB7IGJyb3dzZXJTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0b3JlIH0gZnJvbSAnLi9zYXZlLnRzJztcblxuY29uc3QgS0VZID0gJ25lY3JvLXJ1bic7XG5jb25zdCBWRVJTSU9OID0gMTtcblxuZXhwb3J0IGludGVyZmFjZSBTZXJpYWxpemVkU3RhdGUge1xuICBydWxlczogUnVsZXM7IHJuZzogeyBzZWVkOiBudW1iZXI7IHBvczogbnVtYmVyIH07XG4gIHdhdmU6IG51bWJlcjsgaGVhcnRzOiBudW1iZXI7IGNhcDogbnVtYmVyOyBoYW5kOiBTb3VsSWRbXTsgdW5pdHM6IFVuaXRbXTsgbmV4dElkOiBudW1iZXI7IGRpc2NhcmRVc2VkOiBib29sZWFuO1xuICBzdGF0dXM6ICdidWlsZGluZyc7IGxvZzogc3RyaW5nW107IHN0YXRzOiBTdGF0ZVsnc3RhdHMnXTtcbn1cbmV4cG9ydCBpbnRlcmZhY2UgUnVuU25hcHNob3QgeyB2OiBudW1iZXI7IHNlZWQ6IG51bWJlcjsgYXR0ZW1wdDogbnVtYmVyOyBzdGFnZTogc3RyaW5nOyBkaWZmaWN1bHR5OiBzdHJpbmc7IHBoYXNlOiAnYnVpbGQnIHwgJ2RyYWZ0JzsgZHJhZnQ6IFNvdWxJZFtdIHwgbnVsbDsgc3RhdGU6IFNlcmlhbGl6ZWRTdGF0ZTsgc3RhcnRCZXN0PzogbnVtYmVyIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZVN0YXRlKHM6IFN0YXRlKTogU2VyaWFsaXplZFN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBydWxlczogSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzLnJ1bGVzKSksIHJuZzogeyBzZWVkOiBzLnJuZy5zZWVkLCBwb3M6IHMucm5nLnN0YXRlKCkgfSxcbiAgICB3YXZlOiBzLndhdmUsIGhlYXJ0czogcy5oZWFydHMsIGNhcDogcy5jYXAsIGhhbmQ6IHMuaGFuZC5zbGljZSgpLCB1bml0czogcy51bml0cy5tYXAoKHUpID0+ICh7IC4uLnUgfSkpLCBuZXh0SWQ6IHMubmV4dElkLCBkaXNjYXJkVXNlZDogcy5kaXNjYXJkVXNlZCxcbiAgICBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogcy5sb2cuc2xpY2UoLTQwKSwgc3RhdHM6IHsgLi4ucy5zdGF0cyB9LFxuICB9O1xufVxuXG5jb25zdCBpc1NvdWwgPSAoeDogYW55KTogeCBpcyBTb3VsSWQgPT4gU09VTFMuaW5jbHVkZXMoeCk7XG5jb25zdCBpbnQgPSAoeDogYW55LCBsbzogbnVtYmVyLCBoaTogbnVtYmVyKSA9PiBOdW1iZXIuaXNJbnRlZ2VyKHgpICYmIHggPj0gbG8gJiYgeCA8PSBoaTtcblxuLyoqIFJlYnVpbGQgYSBTdGF0ZSBmcm9tIHNhdmVkIGRhdGEsIG9yIG51bGwgaWYgYW55dGhpbmcgYWJvdXQgaXQgaXMgbm90IGJlbGlldmFibGUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVTdGF0ZSh4OiBhbnkpOiBTdGF0ZSB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHIgPSB4LnJ1bGVzO1xuICAgIGlmICghciB8fCAhQXJyYXkuaXNBcnJheShyLmN1cnZlKSB8fCAhci5jdXJ2ZS5sZW5ndGggfHwgIXIuY3VydmUuZXZlcnkoKG46IGFueSkgPT4gTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIubWVyZ2UgIT09ICdkZXBsb3llZE9ubHknICYmIHIubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoci5wb29sICE9PSB1bmRlZmluZWQgJiYgIShBcnJheS5pc0FycmF5KHIucG9vbCkgJiYgci5wb29sLmxlbmd0aCAmJiByLnBvb2wuZXZlcnkoaXNTb3VsKSkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHN0YWdlV2F2ZXMgPSByLnN0YWdlV2F2ZXMgPz8gci5jdXJ2ZS5sZW5ndGg7XG4gICAgaWYgKCFpbnQoeC53YXZlLCAxLCBNYXRoLm1pbihzdGFnZVdhdmVzLCByLmN1cnZlLmxlbmd0aCkpIHx8ICFpbnQoeC5oZWFydHMsIDEsIEhFQVJUUykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmNhcCkgfHwgeC5jYXAgPD0gMCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHguaGFuZCkgfHwgeC5oYW5kLmxlbmd0aCA+IDQwIHx8ICF4LmhhbmQuZXZlcnkoaXNTb3VsKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHgudW5pdHMpIHx8IHgudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFpbnQoeC5uZXh0SWQsIDEsIDFlNikgfHwgdHlwZW9mIHguZGlzY2FyZFVzZWQgIT09ICdib29sZWFuJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY2VsbHMgPSBuZXcgU2V0PG51bWJlcj4oKSwgaWRzID0gbmV3IFNldDxudW1iZXI+KCksIHVuaXRzOiBVbml0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgeC51bml0cykge1xuICAgICAgaWYgKCF1IHx8ICFpc1NvdWwodS5zb3VsKSB8fCAhaW50KHUuc3RhciwgMSwgTUFYX1NUQVIpIHx8ICFpbnQodS5jZWxsLCAwLCBHUklEX0NFTExTIC0gMSkgfHwgIWludCh1LmlkLCAxLCB4Lm5leHRJZCkgfHwgY2VsbHMuaGFzKHUuY2VsbCkgfHwgaWRzLmhhcyh1LmlkKSkgcmV0dXJuIG51bGw7XG4gICAgICBjZWxscy5hZGQodS5jZWxsKTsgaWRzLmFkZCh1LmlkKTsgdW5pdHMucHVzaCh7IGlkOiB1LmlkLCBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsLCBmcmVzaDogISF1LmZyZXNoIH0pO1xuICAgIH1cbiAgICBjb25zdCBzdCA9IHguc3RhdHM7XG4gICAgaWYgKCFzdCB8fCAhWydkcmF3bicsICdkaXNjYXJkZWQnLCAnZGlzbWlzc2VkJywgJ21lcmdlcycsICdmYWlsdXJlcyddLmV2ZXJ5KChrKSA9PiBOdW1iZXIuaXNGaW5pdGUoc3Rba10pKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF4LnJuZyB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5ybmcucG9zKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bGVzOiByIGFzIFJ1bGVzLCBybmc6IG1ha2VSbmcoeC5ybmcuc2VlZCwgeC5ybmcucG9zKSwgd2F2ZTogeC53YXZlLCBoZWFydHM6IHguaGVhcnRzLCBjYXA6IHguY2FwLCBoYW5kOiB4LmhhbmQuc2xpY2UoKSwgdW5pdHMsIG5leHRJZDogeC5uZXh0SWQsXG4gICAgICBkaXNjYXJkVXNlZDogeC5kaXNjYXJkVXNlZCwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IEFycmF5LmlzQXJyYXkoeC5sb2cpID8geC5sb2cuZmlsdGVyKChsOiBhbnkpID0+IHR5cGVvZiBsID09PSAnc3RyaW5nJykuc2xpY2UoLTQwKSA6IFtdLFxuICAgICAgc3RhdHM6IHsgZHJhd246IHN0LmRyYXduLCBkaXNjYXJkZWQ6IHN0LmRpc2NhcmRlZCwgZGlzbWlzc2VkOiBzdC5kaXNtaXNzZWQsIG1lcmdlczogc3QubWVyZ2VzLCBmYWlsdXJlczogc3QuZmFpbHVyZXMgfSxcbiAgICB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhdmVSdW4oc25hcDogUnVuU25hcHNob3QsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzbmFwKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDogdGhlIHJ1biBqdXN0IHdpbGwgbm90IHN1cnZpdmUgYSByZWxvYWQgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyUnVuKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUgJiYgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbSkgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbShLRVkpOyBlbHNlIGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksICcnKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG59XG5leHBvcnQgZnVuY3Rpb24gbG9hZFJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IHQgPSBzdG9yZSAmJiBzdG9yZS5nZXRJdGVtKEtFWSk7IGlmICghdCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgeCA9IEpTT04ucGFyc2UodCk7XG4gICAgaWYgKCF4IHx8IHgudiAhPT0gVkVSU0lPTiB8fCAoeC5waGFzZSAhPT0gJ2J1aWxkJyAmJiB4LnBoYXNlICE9PSAnZHJhZnQnKSB8fCAhTnVtYmVyLmlzRmluaXRlKHguc2VlZCkgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmF0dGVtcHQpIHx8IHR5cGVvZiB4LmRpZmZpY3VsdHkgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGF0ZSA9IGRlc2VyaWFsaXplU3RhdGUoeC5zdGF0ZSk7IGlmICghc3RhdGUpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGRyYWZ0ID0geC5waGFzZSA9PT0gJ2RyYWZ0JyAmJiBBcnJheS5pc0FycmF5KHguZHJhZnQpICYmIHguZHJhZnQubGVuZ3RoID09PSAzICYmIHguZHJhZnQuZXZlcnkoaXNTb3VsKSA/IHguZHJhZnQgOiBudWxsO1xuICAgIHJldHVybiB7IHNuYXA6IHsgdjogVkVSU0lPTiwgc2VlZDogeC5zZWVkLCBhdHRlbXB0OiB4LmF0dGVtcHQsIHN0YWdlOiB0eXBlb2YgeC5zdGFnZSA9PT0gJ3N0cmluZycgPyB4LnN0YWdlIDogJ2NyeXB0JywgZGlmZmljdWx0eTogeC5kaWZmaWN1bHR5LCBwaGFzZTogZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJywgZHJhZnQsIHN0YXRlOiB4LnN0YXRlLCBzdGFydEJlc3Q6IE51bWJlci5pc0ludGVnZXIoeC5zdGFydEJlc3QpICYmIHguc3RhcnRCZXN0ID49IDAgJiYgeC5zdGFydEJlc3QgPD0gOTk5OSA/IHguc3RhcnRCZXN0IDogdW5kZWZpbmVkIH0sIHN0YXRlIH07XG4gIH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxufVxuZXhwb3J0IGNvbnN0IFJVTl9WRVJTSU9OID0gVkVSU0lPTjtcbiIsICIvLyBFdmVyeXRoaW5nIHlvdSBTRUUgZm9yIGEgdW5pdDogcmVhbCBUcmlwbyBtb2RlbHMgKFNrZWxldG9uIFdhcnJpb3IsIFNrZWxldG9uIEFyY2hlciksIHNpbXBsZSBzdGFuZC1pbnMgZm9yIHRoZSBmb3VyXG4vLyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBnZW5lcmF0ZWQgeWV0LCBhbmQgdGhlIFwic3RhciBsb29rXCIgbGF5ZXJlZCBvbiB0b3Agb2YgYm90aCAoc2l6ZSwgdGludCwgYXVyYSwgaGFsbywgYmFkZ2UpLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5cbmV4cG9ydCB0eXBlIFZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhdGgnIHwgJ3NwYXduJyB8ICdjaGVlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbiArIHlhdyBoZXJlXG4gIHRlYW06IDAgfCAxOyBzdGFyOiBudW1iZXI7IHN0YXRlOiBWU3RhdGU7IHRvcDogbnVtYmVyO1xuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkPzogbnVtYmVyKTogdm9pZDtcbiAgc2V0U3RhcihzdGFyOiBudW1iZXIpOiB2b2lkO1xuICBzZXRMZXZlbD8obGV2ZWw6IG51bWJlcik6IHZvaWQ7ICAgIC8vIHRoZSBwZXJtYW5lbnQgU291bCBsZXZlbCBzaG93biBiZXNpZGUgdGhlIGhlYWx0aCBiYXIgKHBsYXllciB1bml0cyBvbmx5KVxuICBzZXRUZWFtKHRlYW06IDAgfCAxKTogdm9pZDtcbiAgc2V0SHAoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7ICAvLyBudWxsIGhpZGVzIHRoZSBoZWFsdGggYmFyXG4gIHNldE1hbmEoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7IC8vIG51bGwgaGlkZXMgdGhlIG1hbmEgYmFyICh1bml0cyB3aXRob3V0IGEgc2tpbGwpXG4gIHB1bHNlKCk6IHZvaWQ7ICAgICAgICAgICAgICAgICAgICAgLy8gYnJpZWYgaGl0IHJlYWN0aW9uXG4gIHVwZGF0ZShkdDogbnVtYmVyKTogdm9pZDtcbiAgZGlzcG9zZSgpOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YXIgbG9va3Ncbi8vIDEgc3RhciA9IHRoZSBwbGFpbiBtb2RlbC4gMiBzdGFycyA9IGEgbGl0dGxlIGJpZ2dlciwgY29vbCBzaWx2ZXItYmx1ZSB0aW50LCBicmlnaHRlciBhdXJhLiAzIHN0YXJzID0gYmlnZ2VzdCwgd2FybSBnb2xkIHRpbnQsXG4vLyBzdHJvbmcgZ29sZC12aW9sZXQgYXVyYSBhbmQgYSBmbG9hdGluZyBnb2xkIGhhbG8uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBmcmVlOiBubyBleHRyYSBUcmlwbyBnZW5lcmF0aW9ucy5cbmNvbnN0IFRJTlQ6IG51bWJlcltdW10gPSBbWzEsIDEsIDFdLCBbMC44NiwgMC45NSwgMS4xOF0sIFsxLjI1LCAxLjEsIDAuN11dO1xuY29uc3QgQVVSQSA9IFtcbiAgeyByYXRlOiAxNCwgbWluOiAwLjA2LCBtYXg6IDAuMTYsIGMxOiBbMC43OCwgMC4zNSwgMSwgMC43XSwgYzI6IFswLjQ1LCAwLjE1LCAwLjksIDAuNV0gfSxcbiAgeyByYXRlOiAyNiwgbWluOiAwLjA4LCBtYXg6IDAuMjAsIGMxOiBbMC44NSwgMC42NSwgMSwgMC44XSwgYzI6IFswLjU1LCAwLjQsIDEsIDAuNl0gfSxcbiAgeyByYXRlOiA0NCwgbWluOiAwLjEwLCBtYXg6IDAuMjYsIGMxOiBbMSwgMC44NSwgMC40LCAwLjg1XSwgYzI6IFswLjgsIDAuMywgMSwgMC43XSB9LFxuXTtcblxuZXhwb3J0IGludGVyZmFjZSBBc3NldHMge1xuICBzY2VuZTogYW55OyBzb2Z0OiBhbnk7IGx2VGV4OiBSZWNvcmQ8bnVtYmVyLCBhbnk+OyBzdGFyVGV4OiBhbnlbXTsgdHJpcG86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgVHJpcG9DZmc+PjsgZW1vdGU6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gIHJpbmdNYXQ6IGFueVtdOyBoYWxvTWF0OiBhbnk7IGJhckJnOiBhbnk7IGJhckZpbGw6IGFueVtdOyBtYW5hRmlsbDogYW55OyBhcnJvdz86IGFueTsgbmVjcm8/OiBhbnk7XG59XG4vKiogRmxhdm91ciBhIHVuaXQgY2FuIGhhdmU6IGEgY2xpcCBpdCBwbGF5cyBub3cgYW5kIHRoZW4gd2hlbiBpdCBoYXMgc3Rvb2QgaWRsZSBmb3IgYSB3aGlsZSwgYSBzbWFsbCBlbW90ZSwgYW5kIGFuIGV5ZS1nbG93IG1hc2sgKGV5ZXMgZGltIHdoZW4gc2xlZXB5LCBmbGFyZSB3aGVuIGl0IGZpZ2h0cykuICovXG4vKiogSWRsZSBjbGlwcyB3aGVyZSB0aGUgdW5pdCBtYWtlcyBhIG5vaXNlLiAqL1xuY29uc3QgVk9DQUwgPSBuZXcgU2V0KFsnUm9hcicsICdUaHVtcCcsICdTdG9tcCcsICdTbmlja2VyJywgJ1NjaGVtZScsICdCb2FzdCcsICdGbGV4JywgJ0RvdWJsZUJpY2VwcycsICdGdW1ibGUnLCAnU2hpZWxkQm9uaycsICdCb25rJ10pO1xuaW50ZXJmYWNlIFBvc2UgeyBjbGlwOiBzdHJpbmc7IGVtb3RlPzogc3RyaW5nIH1cbmludGVyZmFjZSBGbGF2b3IgeyBjbGlwczogUG9zZVtdOyBtaW46IG51bWJlcjsgbWF4OiBudW1iZXIgfVxuaW50ZXJmYWNlIFRyaXBvQ2ZnIHsgY29udGFpbmVyOiBhbnk7IGVuZW15VGV4OiBhbnk7IGNsaXBzOiBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+OyBtYXRDYWNoZTogUmVjb3JkPHN0cmluZywgYW55PjsgYmFzZU1hdD86IGFueTsgdG9wOiBudW1iZXI7IHNjYWxlOiBudW1iZXI7IGZsYXZvcj86IEZsYXZvcjsgY2hlZXJzPzogUG9zZVtdOyBzcGF3bkVtb3RlPzogc3RyaW5nOyBleWVzPzogc3RyaW5nOyBleWVUZXg/OiBhbnk7IHN0YXJTY2FsZT86IG51bWJlcltdIH1cblxuZnVuY3Rpb24gZHluKHNjZW5lOiBhbnksIHc6IG51bWJlciwgaDogbnVtYmVyLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkLCBhbHBoYSA9IHRydWUpIHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdkdCcsIHsgd2lkdGg6IHcsIGhlaWdodDogaCB9LCBzY2VuZSwgdHJ1ZSk7IGRyYXcodC5nZXRDb250ZXh0KCkpOyB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gYWxwaGE7IHJldHVybiB0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFzc2V0cyhzY2VuZTogYW55KTogUHJvbWlzZTxBc3NldHM+IHtcbiAgY29uc3Qgc29mdCA9IGR5bihzY2VuZSwgNjQsIDY0LCAoYykgPT4geyBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCgzMiwgMzIsIDAsIDMyLCAzMiwgMzIpOyBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgyNTUsMjU1LDI1NSwxKScpOyBnLmFkZENvbG9yU3RvcCgwLjQsICdyZ2JhKDI1NSwyNTUsMjU1LC41NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTsgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IH0pO1xuICBjb25zdCBzdGFyVGV4ID0gWzEsIDIsIDNdLm1hcCgobikgPT4gZHluKHNjZW5lLCAxOTIsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCA0MHB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlU3R5bGUgPSAnIzFhMTAyMCc7IGMuZmlsbFN0eWxlID0gbiA9PT0gMyA/ICcjZmZkMjRhJyA6IG4gPT09IDIgPyAnI2Q3ZTZmZicgOiAnI2YwZDlhMCc7IGNvbnN0IHMgPSAnXHUyNjA1Jy5yZXBlYXQobik7IGMuc3Ryb2tlVGV4dChzLCA5NiwgMzgpOyBjLmZpbGxUZXh0KHMsIDk2LCAzOCk7IH0pKTtcbiAgY29uc3QgZW1pc3NpdmUgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYSA9IDEpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2VtJywgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gIGNvbnN0IEE6IEFzc2V0cyA9IHtcbiAgICBzY2VuZSwgc29mdCwgbHZUZXg6IHt9LCBzdGFyVGV4LCB0cmlwbzoge30sIGVtb3RlOiB7fSwgcmluZ01hdDogW2VtaXNzaXZlKDAuNTUsIDAuMiwgMC45NSwgMC45KSwgZW1pc3NpdmUoMC45NSwgMC4yNSwgMC4yLCAwLjkpXSwgaGFsb01hdDogZW1pc3NpdmUoMSwgMC44MiwgMC4zLCAwLjk1KSxcbiAgICBiYXJCZzogZW1pc3NpdmUoMC4wNSwgMC4wNSwgMC4wOCwgMC43KSwgYmFyRmlsbDogW2VtaXNzaXZlKDAuNTUsIDAuMzUsIDEpLCBlbWlzc2l2ZSgxLCAwLjQsIDAuMyldLCBtYW5hRmlsbDogZW1pc3NpdmUoMC4yNSwgMC43NSwgMSksXG4gIH07XG4gIC8vIFwiWnp6XCIgdGhhdCBmbG9hdHMgdXAgb3ZlciBhIHNsZWVweSB1bml0XG4gIGNvbnN0IHp6eiA9IGR5bihzY2VuZSwgMTI4LCAxMjgsIChjKSA9PiB7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gOTsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5maWxsU3R5bGUgPSAnI2U4ZDhmZic7IGMubGluZUpvaW4gPSAncm91bmQnO1xuICAgIGZvciAoY29uc3QgW2NoLCBzaXplLCB4LCB5XSBvZiBbWydaJywgNjQsIDM0LCAxMDBdLCBbJ3onLCA0OCwgNzQsIDY2XSwgWyd6JywgMzQsIDEwNCwgMzhdXSBhcyBbc3RyaW5nLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXVtdKSB7IGMuZm9udCA9ICdpdGFsaWMgOTAwICcgKyBzaXplICsgJ3B4IHNhbnMtc2VyaWYnOyBjLnN0cm9rZVRleHQoY2gsIHgsIHkpOyBjLmZpbGxUZXh0KGNoLCB4LCB5KTsgfSB9KTtcbiAgY29uc3Qgem0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd6enonLCBzY2VuZSk7IHptLmRpZmZ1c2VUZXh0dXJlID0genp6OyB6bS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHptLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyB6bS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB6bS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgQS5lbW90ZVsnenp6J10gPSB6bTtcbiAgY29uc3QgaWNvbiA9IChuYW1lOiBzdHJpbmcsIGRyYXc6IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHZvaWQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwobmFtZSwgc2NlbmUpOyBtLmRpZmZ1c2VUZXh0dXJlID0gZHluKHNjZW5lLCAxMjgsIDEyOCwgZHJhdyk7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IEEuZW1vdGVbbmFtZV0gPSBtOyB9O1xuICBjb25zdCBnbHlwaCA9IChjaDogc3RyaW5nLCBmaWxsOiBzdHJpbmcpID0+IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSAxMjsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7IGMuZmlsbFN0eWxlID0gZmlsbDsgYy5mb250ID0gJzkwMCAxMDRweCBzYW5zLXNlcmlmJzsgYy5zdHJva2VUZXh0KGNoLCA2NCwgMTAwKTsgYy5maWxsVGV4dChjaCwgNjQsIDEwMCk7IH07XG4gIGljb24oJz8nLCBnbHlwaCgnPycsICcjZmZlMjdhJykpOyBpY29uKCchJywgZ2x5cGgoJyEnLCAnI2ZmOWE3YScpKTtcbiAgaWNvbignc3dlYXQnLCAoYykgPT4geyBjLmxpbmVXaWR0aCA9IDg7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MzA0YSc7IGMuZmlsbFN0eWxlID0gJyM5ZmU0ZmYnOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbyg2NCwgMTQpOyBjLmJlemllckN1cnZlVG8oMTA0LCA2MiwgMTA0LCAxMDgsIDY0LCAxMTIpOyBjLmJlemllckN1cnZlVG8oMjQsIDEwOCwgMjQsIDYyLCA2NCwgMTQpOyBjLmNsb3NlUGF0aCgpOyBjLnN0cm9rZSgpOyBjLmZpbGwoKTsgfSk7XG4gIGljb24oJ3NwYXJrbGUnLCAoYykgPT4geyBjLmxpbmVXaWR0aCA9IDc7IGMuc3Ryb2tlU3R5bGUgPSAnIzNhMmEwNSc7IGMuZmlsbFN0eWxlID0gJyNmZmYyYTgnOyBjb25zdCBzdGFyID0gKHg6IG51bWJlciwgeTogbnVtYmVyLCByOiBudW1iZXIpID0+IHsgYy5iZWdpblBhdGgoKTsgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspIHsgY29uc3QgYSA9IGkgKiBNYXRoLlBJIC8gNCwgcnIgPSBpICUgMiA/IHIgKiAwLjI4IDogcjsgYy5saW5lVG8oeCArIE1hdGguc2luKGEpICogcnIsIHkgLSBNYXRoLmNvcyhhKSAqIHJyKTsgfSBjLmNsb3NlUGF0aCgpOyBjLnN0cm9rZSgpOyBjLmZpbGwoKTsgfTsgc3Rhcig1NiwgNzAsIDUwKTsgc3RhcigxMDIsIDI4LCAyMCk7IHN0YXIoMjYsIDI0LCAxNCk7IH0pO1xuICBjb25zdCBkZWZzOiBbU291bElkLCBzdHJpbmcsIHN0cmluZywgUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPiwgbnVtYmVyLCBudW1iZXIsIGFueT9dW10gPSBbXG4gICAgWyd3YXJyaW9yJywgJ1NrZWxldG9uV2Fycmlvci5nbGInLCAnU2tlbGV0b25XYXJyaW9yX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdUcmlwJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdCb25rJywgZW1vdGU6ICc/JyB9LCB7IGNsaXA6ICdXb2JibGUnLCBlbW90ZTogJ3N3ZWF0JyB9LCB7IGNsaXA6ICdXYXZlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdGdW1ibGUnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1NoaWVsZEJvbmsnLCBlbW90ZTogJz8nIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1dhdmUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1RyaXAnLCBlbW90ZTogJyEnIH1dLCBleWVzOiAnU2tlbGV0b25XYXJyaW9yX2V5ZXMucG5nJyB9XSxcbiAgICBbJ2FyY2hlcicsICdTa2VsZXRvbkFyY2hlci5nbGInLCAnU2tlbGV0b25BcmNoZXJfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ1Nob290JywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0ZsZXgnIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdGbGV4JywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdEb3VibGVCaWNlcHMnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvbmVDcmFjaycgfSwgeyBjbGlwOiAnQm93VHdpcmwnLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnRmxleCcsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRG91YmxlQmljZXBzJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb3dUd2lybCcsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdTa2VsZXRvbkFyY2hlcl9leWVzLnBuZycgfV0sXG4gICAgWydnb2JsaW4nLCAnR29ibGluLmdsYicsICdHb2JsaW5fZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wLCAwLjg1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1NjaGVtZScsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnUGVlaycsIGVtb3RlOiAnPycgfSwgeyBjbGlwOiAnU3BpbicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU25pY2tlcicsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogNiwgbWF4OiAxMiB9LCBjaGVlcnM6IFt7IGNsaXA6ICdDaGVlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU25pY2tlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU3BpbicsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdHb2JsaW5fZXllcy5wbmcnIH1dLFxuICAgIFsna25pZ2h0JywgJ0tuaWdodC5nbGInLCAnS25pZ2h0X2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnUG9zZScgfSwgMS4wLCAxLjA1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1NhbHV0ZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnQm9hc3QnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0FkbWlyZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnUHJheScsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogOCwgbWF4OiAxNSB9LCBjaGVlcnM6IFt7IGNsaXA6ICdQb3NlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdTYWx1dGUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvYXN0JywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdQcmF5JywgZW1vdGU6ICdzcGFya2xlJyB9XSwgZXllczogJ0tuaWdodF9leWVzLnBuZycgfV0sXG4gICAgWydiYXJiYXJpYW4nLCAnQmFyYmFyaWFuLmdsYicsICdCYXJiYXJpYW5fZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wLCAxLjA1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1JvYXInLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0NoZXN0QmVhdCcgfSwgeyBjbGlwOiAnU3RvbXAnLCBlbW90ZTogJyEnIH1dLCBtaW46IDcsIG1heDogMTMgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1JvYXInLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0NoZXN0QmVhdCcgfV0sIGV5ZXM6ICdCYXJiYXJpYW5fZXllcy5wbmcnIH1dLFxuICAgIFsnb2dyZScsICdPZ3JlLmdsYicsICdPZ3JlX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMDIsIDEuMTIsIHsgc3RhclNjYWxlOiBbMSwgMS4zLCAxLjY1XSwgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnWWF3bicsIGVtb3RlOiAnenp6JyB9LCB7IGNsaXA6ICdTY3JhdGNoJyB9LCB7IGNsaXA6ICdTdG9tcCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnVGh1bXAnIH1dLCBtaW46IDksIG1heDogMTYgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInIH0sIHsgY2xpcDogJ1RodW1wJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdTdG9tcCcsIGVtb3RlOiAnIScgfV0sIHNwYXduRW1vdGU6ICd6enonLCBleWVzOiAnT2dyZV9leWVzLnBuZycgfV0sXG4gIF07XG4gIGNvbnN0IG5lY3JvUCA9IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCAnTmVjcm9tYW5jZXIuZ2xiJywgc2NlbmUpLnRoZW4oKGM6IGFueSkgPT4geyBBLm5lY3JvID0gYzsgfSkuY2F0Y2goKCkgPT4geyAvKiB0aGUgZ2FtZSBjYW5ub3Qgc2hvdyBoaW0gKi8gfSk7XG4gIGNvbnN0IGFycm93UCA9IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCAnQXJyb3cuZ2xiJywgc2NlbmUpLnRoZW4oKGM6IGFueSkgPT4geyBBLmFycm93ID0gYzsgfSkuY2F0Y2goKCkgPT4geyAvKiBmYWxscyBiYWNrIHRvIHRoZSBwbGFpbiBsaW5lICovIH0pO1xuICBhd2FpdCBQcm9taXNlLmFsbChbYXJyb3dQLCBuZWNyb1AsIC4uLmRlZnMubWFwKGFzeW5jIChbc291bCwgZ2xiLCBlbmVteSwgY2xpcHMsIHRvcCwgc2NhbGUsIGV4dHJhXSkgPT4ge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCBnbGIsIHNjZW5lKTtcbiAgICBBLnRyaXBvW3NvdWxdID0geyBjb250YWluZXIsIGVuZW15VGV4OiBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvJyArIGVuZW15LCBzY2VuZSwgZmFsc2UsIGZhbHNlKSwgY2xpcHMsIG1hdENhY2hlOiB7fSwgdG9wLCBzY2FsZSwgLi4uKGV4dHJhIHx8IHt9KSwgZXllVGV4OiBleHRyYSAmJiBleHRyYS5leWVzID8gbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBleHRyYS5leWVzLCBzY2VuZSwgZmFsc2UsIGZhbHNlKSA6IHVuZGVmaW5lZCB9O1xuICB9KV0pO1xuICByZXR1cm4gQTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzaGFyZWQgZGVjb3JhdGlvblxuY2xhc3MgRGVjbyB7XG4gIHByaXZhdGUgcHM6IGFueSA9IG51bGw7IHByaXZhdGUgaGFsbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBiYWRnZTogYW55OyBwcml2YXRlIHN0YXJzOiBhbnk7IHByaXZhdGUgZmlsbDogYW55OyBwcml2YXRlIGJhcjogYW55OyBwcml2YXRlIG1iZzogYW55OyBwcml2YXRlIG1maWxsOiBhbnk7IHByaXZhdGUgcmluZzogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBwYXJlbnQ6IGFueSwgcHJpdmF0ZSB0b3A6IG51bWJlciwgcHJpdmF0ZSByYWRpdXM6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lO1xuICAgIHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygncmluZycsIHsgcmFkaXVzOiBNYXRoLm1heCgwLjMsIHJhZGl1cyAqIDEuMTUpLCB0ZXNzZWxsYXRpb246IDI2IH0sIHMpOyB0aGlzLnJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0aGlzLnJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHRoaXMucmluZy5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMucmluZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYWRnZSA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2JhZGdlJywgcyk7IHRoaXMuYmFkZ2UucGFyZW50ID0gcGFyZW50OyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0b3AgKyAwLjMyOyB0aGlzLmJhZGdlLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgdGhpcy5zdGFycyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3N0YXJzJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMTUgfSwgcyk7IHRoaXMuc3RhcnMucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5zdGFycy5wb3NpdGlvbi55ID0gMC4xMTsgdGhpcy5zdGFycy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzbScsIHMpOyBzbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgc20uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgc20udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB0aGlzLnN0YXJzLm1hdGVyaWFsID0gc207ICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtID0gc207XG4gICAgY29uc3QgYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdiZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA4NSB9LCBzKTsgYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgYmcubWF0ZXJpYWwgPSBBLmJhckJnOyBiZy5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMuYmFyID0gYmc7XG4gICAgdGhpcy5maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuZmlsbC5wb3NpdGlvbi56ID0gLTAuMDAyOyB0aGlzLmZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWJnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMubWJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWJnLnBvc2l0aW9uLnkgPSAtMC4wNzsgdGhpcy5tYmcubWF0ZXJpYWwgPSBBLmJhckJnOyB0aGlzLm1iZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21maWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjAzIH0sIHMpOyB0aGlzLm1maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWZpbGwucG9zaXRpb24uc2V0KDAsIC0wLjA3LCAtMC4wMDIpOyB0aGlzLm1maWxsLm1hdGVyaWFsID0gQS5tYW5hRmlsbDsgdGhpcy5tZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5sdiA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2x2JywgeyB3aWR0aDogMC4zNiwgaGVpZ2h0OiAwLjEzNSB9LCBzKTsgdGhpcy5sdi5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLmx2LnBvc2l0aW9uLnNldCgtMC41MiwgMC4wLCAwKTsgdGhpcy5sdi5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMubHYuc2V0RW5hYmxlZChmYWxzZSk7XG4gICAgY29uc3QgbG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdsdm0nLCBzKTsgbG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IGxtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IGxtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgdGhpcy5sdi5tYXRlcmlhbCA9IGxtO1xuICAgIHRoaXMuYmFyLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLmZpbGwuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWJnLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1maWxsLnNldEVuYWJsZWQoZmFsc2UpO1xuICB9XG4gIHByaXZhdGUgbHY6IGFueTsgcHJpdmF0ZSBsdk4gPSAwOyBwcml2YXRlIGJhck9uID0gZmFsc2U7XG4gIC8qKiBcIkxWIG5cIiBiZXNpZGUgdGhlIGhlYWx0aCBiYXIgKHBlcm1hbmVudCBTb3VsIGxldmVsKTsgMCBoaWRlcyBpdC4gKi9cbiAgc2V0TGV2ZWwobjogbnVtYmVyKSB7XG4gICAgdGhpcy5sdk4gPSBuOyBpZiAoIXRoaXMubHYpIHJldHVybjsgaWYgKG4gPD0gMCB8fCAhdGhpcy5iYXJPbikgeyB0aGlzLmx2LnNldEVuYWJsZWQoZmFsc2UpOyBpZiAobiA+IDApIHRoaXMuZW5zdXJlTHYobik7IHJldHVybjsgfVxuICAgIHRoaXMuZW5zdXJlTHYobik7IHRoaXMubHYuc2V0RW5hYmxlZCh0cnVlKTtcbiAgfVxuICBwcml2YXRlIGVuc3VyZUx2KG46IG51bWJlcikge1xuICAgIGNvbnN0IEEgPSB0aGlzLkE7IGlmICghQS5sdlRleFtuXSkgQS5sdlRleFtuXSA9IGR5bihBLnNjZW5lLCAxMjgsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCAzNHB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDY7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MGQyNic7IGMuZmlsbFN0eWxlID0gJyNlOGQ4ZmYnOyBjLmxpbmVKb2luID0gJ3JvdW5kJzsgYy5zdHJva2VUZXh0KCdMViAnICsgbiwgNjQsIDM2KTsgYy5maWxsVGV4dCgnTFYgJyArIG4sIDY0LCAzNik7IH0pO1xuICAgICh0aGlzLmx2Lm1hdGVyaWFsIGFzIGFueSkuZGlmZnVzZVRleHR1cmUgPSBBLmx2VGV4W25dO1xuICB9XG4gIC8qKiBUaGUgYmFycyBrZWVwIHRoZSBzYW1lIHNpemUgYW5kIHRoZSBzYW1lIHNtYWxsIGdhcCBhYm92ZSB0aGUgaGVhZCBob3dldmVyIGJpZyB0aGUgdW5pdCBncm93cy4gKi9cbiAgZml0KGs6IG51bWJlcikgeyB0aGlzLmJhZGdlLnNjYWxpbmcuc2V0QWxsKDEgLyBrKTsgdGhpcy5iYWRnZS5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjMgLyBrOyBpZiAodGhpcy5oYWxvKSB0aGlzLmhhbG8ucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4wODsgfVxuICBzZXQodGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLkEuc2NlbmUsIGNmZyA9IEFVUkFbc3RhciAtIDFdO1xuICAgICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtLmRpZmZ1c2VUZXh0dXJlID0gdGhpcy5BLnN0YXJUZXhbc3RhciAtIDFdO1xuICAgIHRoaXMucmluZy5tYXRlcmlhbCA9IHRoaXMuQS5yaW5nTWF0W3RlYW1dOyB0aGlzLmZpbGwubWF0ZXJpYWwgPSB0aGlzLkEuYmFyRmlsbFt0ZWFtXTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmFpc2VkIGJ5IHRoZSBOZWNyb21hbmNlcjogcHVycGxlIGF1cmEgdGhhdCBncm93cyB3aXRoIHN0YXJzXG4gICAgICBpZiAoIXRoaXMucHMpIHtcbiAgICAgICAgY29uc3QgcHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnYXVyYScsIDcwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGhpcy5BLnNvZnQ7IHBzLmVtaXR0ZXIgPSB0aGlzLnBhcmVudDsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgdGhpcy50b3AgKiAwLjUsIDAuMik7XG4gICAgICAgIHBzLm1pbkxpZmVUaW1lID0gMC41OyBwcy5tYXhMaWZlVGltZSA9IDEuMTsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMTUsIDAuOCwgLTAuMTUpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjE1LCAxLjUsIDAuMTUpO1xuICAgICAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjM1OyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7IHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgdGhpcy5wcyA9IHBzO1xuICAgICAgfVxuICAgICAgY29uc3QgcCA9IHRoaXMucHM7IHAuZW1pdFJhdGUgPSBjZmcucmF0ZTsgcC5taW5TaXplID0gY2ZnLm1pbjsgcC5tYXhTaXplID0gY2ZnLm1heDsgcC5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uY2ZnLmMxKTsgcC5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uY2ZnLmMyKTsgcC5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4yLCAwLCAwLjQsIDApO1xuICAgICAgaWYgKCFwLmlzU3RhcnRlZCgpKSBwLnN0YXJ0KCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLnBzICYmIHRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RvcCgpO1xuICAgIGlmIChzdGFyID49IDMpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBnb2xkIGhhbG8gYWJvdmUgdGhlIGhlYWRcbiAgICAgIGlmICghdGhpcy5oYWxvKSB7IHRoaXMuaGFsbyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2hhbG8nLCB7IGRpYW1ldGVyOiAwLjU1LCB0aGlja25lc3M6IDAuMDQsIHRlc3NlbGxhdGlvbjogMjQgfSwgcyk7IHRoaXMuaGFsby5wYXJlbnQgPSB0aGlzLnBhcmVudDsgdGhpcy5oYWxvLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuMDg7IHRoaXMuaGFsby5tYXRlcmlhbCA9IHRoaXMuQS5oYWxvTWF0OyB0aGlzLmhhbG8uaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgICB0aGlzLmhhbG8uc2V0RW5hYmxlZCh0cnVlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuaGFsbykgdGhpcy5oYWxvLnNldEVuYWJsZWQoZmFsc2UpO1xuICB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHtcbiAgICBjb25zdCBvbiA9IGYgIT09IG51bGw7IHRoaXMuYmFyLnNldEVuYWJsZWQob24pOyB0aGlzLmZpbGwuc2V0RW5hYmxlZChvbik7IHRoaXMuYmFyT24gPSBvbjsgaWYgKHRoaXMubHYpIHRoaXMubHYuc2V0RW5hYmxlZChvbiAmJiB0aGlzLmx2TiA+IDApO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMuZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLm1iZy5zZXRFbmFibGVkKG9uKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMubWZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5tZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0QXVyYShvbjogYm9vbGVhbikgeyBpZiAodGhpcy5wcykgeyBpZiAob24gJiYgIXRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RhcnQoKTsgaWYgKCFvbiAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTsgfSB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7IGlmICh0aGlzLmhhbG8gJiYgdGhpcy5oYWxvLmlzRW5hYmxlZCgpKSB0aGlzLmhhbG8ucm90YXRpb24ueSArPSBkdCAqIDEuNjsgfVxuICBkaXNwb3NlKCkgeyBpZiAodGhpcy5wcykgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IH0gW3RoaXMuaGFsbywgdGhpcy5yaW5nLCB0aGlzLnN0YXJzLCB0aGlzLmJhciwgdGhpcy5maWxsLCB0aGlzLm1iZywgdGhpcy5tZmlsbF0uZm9yRWFjaCgobSkgPT4gbSAmJiBtLmRpc3Bvc2UoKSk7IHRoaXMuYmFkZ2UuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcmVhbCBtb2RlbHNcbmNsYXNzIFRyaXBvVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIGVudDogYW55OyBwcml2YXRlIGJvZHk6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIGJhc2U6IG51bWJlcjtcbiAgcHJpdmF0ZSBsYXN0Rmxhdm9yID0gJyc7IHByaXZhdGUgdWlkID0gJyc7IHByaXZhdGUgb3duOiBhbnkgPSBudWxsOyBwcml2YXRlIGlkbGVUID0gMDsgcHJpdmF0ZSBuZXh0Rmxhdm9yID0gMWU5OyBwcml2YXRlIGZsYXZvck9uID0gZmFsc2U7IHByaXZhdGUgcXVldWVkID0gZmFsc2U7IHByaXZhdGUgc3Bhd25UID0gMDsgcHJpdmF0ZSBleWVLID0gMC42NTsgcHJpdmF0ZSBlbW90ZXM6IHsgbTogYW55OyB0OiBudW1iZXI7IHkwOiBudW1iZXIgfVtdID0gW107XG4gIHByaXZhdGUgc291bElkOiBTb3VsSWQ7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIGNmZzogVHJpcG9DZmcsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIHRoaXMuc291bElkID0gc291bDtcbiAgICBjb25zdCBzID0gQS5zY2VuZSwgdWlkID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNyk7IHRoaXMudWlkID0gdWlkO1xuICAgIHRoaXMuZW50ID0gY2ZnLmNvbnRhaW5lci5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIHVpZCwgZmFsc2UsIHsgZG9Ob3RJbnN0YW50aWF0ZTogdHJ1ZSB9KTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3VuaXRfJyArIHVpZCwgcyk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICB0aGlzLmJvZHkgPSB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5maW5kKChtOiBhbnkpID0+IG0ubmFtZS5pbmNsdWRlcygnX0JvZHknKSk7XG4gICAgaWYgKCFjZmcuYmFzZU1hdCkgY2ZnLmJhc2VNYXQgPSB0aGlzLmJvZHkubWF0ZXJpYWw7XG4gICAgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4geyBnLnN0b3AoKTsgZy5lbmFibGVCbGVuZGluZyA9IHRydWU7IGcuYmxlbmRpbmdTcGVlZCA9IDAuMTI7IHRoaXMuYW5pbXNbZy5uYW1lLnNwbGl0KCdfJylbMF1dID0gZzsgfSk7XG4gICAgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uYWx3YXlzU2VsZWN0QXNBY3RpdmVNZXNoID0gdHJ1ZTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH0pO1xuICAgIHRoaXMudG9wID0gY2ZnLnRvcDsgdGhpcy5iYXNlID0gY2ZnLnNjYWxlOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIGlmIChjZmcuZmxhdm9yKSB0aGlzLm5leHRGbGF2b3IgPSBjZmcuZmxhdm9yLm1pbiArIE1hdGgucmFuZG9tKCkgKiAoY2ZnLmZsYXZvci5tYXggLSBjZmcuZmxhdm9yLm1pbik7XG4gICAgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCAwLjMpO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogMS4zLCBkaWFtZXRlcjogMC44IH0sIHMpOyB0aGlzLnBpY2sucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMucGljay5wb3NpdGlvbi55ID0gMC42OyB0aGlzLnBpY2sudmlzaWJpbGl0eSA9IDAuMDAxOyB0aGlzLnBpY2suaXNQaWNrYWJsZSA9IHRydWU7XG4gICAgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgfVxuICBwcml2YXRlIGFwcGx5TWF0KCkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMudGVhbSArICdfJyArIHRoaXMuc3RhciwgYyA9IHRoaXMuY2ZnO1xuICAgIGlmIChjLmV5ZVRleCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyB1bml0IGhhcyBnbG93aW5nIGV5ZXM6IGl0IGdldHMgaXRzIG93biBtYXRlcmlhbCBzbyBpdHMgZ2xvdyBjYW4gY2hhbmdlIG9uIGl0cyBvd25cbiAgICAgIGlmICghdGhpcy5vd24pIHsgdGhpcy5vd24gPSBjLmJhc2VNYXQuY2xvbmUoJ293bl8nICsgdGhpcy51aWQpOyB0aGlzLm93bi5lbWlzc2l2ZVRleHR1cmUgPSBjLmV5ZVRleDsgdGhpcy5vd24uZW1pc3NpdmVJbnRlbnNpdHkgPSB0aGlzLmV5ZUs7IH1cbiAgICAgIHRoaXMub3duLmFsYmVkb1RleHR1cmUgPSB0aGlzLnRlYW0gPT09IDEgPyBjLmVuZW15VGV4IDogYy5iYXNlTWF0LmFsYmVkb1RleHR1cmU7IGNvbnN0IHQgPSBUSU5UW3RoaXMuc3RhciAtIDFdOyB0aGlzLm93bi5hbGJlZG9Db2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyh0WzBdLCB0WzFdLCB0WzJdKTtcbiAgICAgIHRoaXMub3duLmVtaXNzaXZlQ29sb3IgPSB0aGlzLnRlYW0gPT09IDEgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC43MiwgMC4yKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc4LCAwLjMsIDEpO1xuICAgICAgdGhpcy5ib2R5Lm1hdGVyaWFsID0gdGhpcy5vd247IHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFjLm1hdENhY2hlW2tleV0pIHsgY29uc3QgbSA9IGMuYmFzZU1hdC5jbG9uZSgnbV8nICsga2V5KTsgaWYgKHRoaXMudGVhbSA9PT0gMSkgbS5hbGJlZG9UZXh0dXJlID0gYy5lbmVteVRleDsgY29uc3QgdCA9IFRJTlRbdGhpcy5zdGFyIC0gMV07IG0uYWxiZWRvQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjModFswXSwgdFsxXSwgdFsyXSk7IGMubWF0Q2FjaGVba2V5XSA9IG07IH1cbiAgICB0aGlzLmJvZHkubWF0ZXJpYWwgPSBjLm1hdENhY2hlW2tleV07XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5zYyhzdCkgKiB0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0KHRoaXMudGVhbSwgc3QpOyB0aGlzLmRlY28uZml0KHRoaXMuc2Moc3QpICogdGhpcy5iYXNlKTsgfVxuICBwcml2YXRlIHNjKHN0OiBudW1iZXIpIHsgcmV0dXJuICh0aGlzLmNmZy5zdGFyU2NhbGUgfHwgQkFMQU5DRS5zdGFyLnNjYWxlKVtzdCAtIDFdOyB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldEhwKGYpOyB9XG4gIHNldExldmVsKG46IG51bWJlcikgeyB0aGlzLmRlY28uc2V0TGV2ZWwobik7IH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRNYW5hKGYpOyB9XG4gIHB1bHNlKCkgeyB0aGlzLnB1bHNlVCA9IDAuMTY7IH1cbiAgcGxheShzdGF0ZTogVlN0YXRlLCBzcGVlZCA9IDEpIHtcbiAgICBsZXQgY2xpcCA9IHRoaXMuY2ZnLmNsaXBzW3N0YXRlXSwgcG9zZTogUG9zZSB8IHVuZGVmaW5lZDtcbiAgICBpZiAoc3RhdGUgPT09ICdjaGVlcicgJiYgdGhpcy5jZmcuY2hlZXJzKSB7IHBvc2UgPSB0aGlzLmNmZy5jaGVlcnNbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogdGhpcy5jZmcuY2hlZXJzLmxlbmd0aCldOyBjbGlwID0gcG9zZS5jbGlwOyB9XG4gICAgY29uc3QgZyA9IHRoaXMuYW5pbXNbY2xpcF07IGlmICghZykgcmV0dXJuOyBjb25zdCBsb29wID0gc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bic7XG4gICAgaWYgKHN0YXRlID09PSAnaWRsZScgJiYgdGhpcy5zdGF0ZSA9PT0gJ3NwYXduJyAmJiB0aGlzLmN1ciAmJiB0aGlzLmN1ci5pc1N0YXJ0ZWQgJiYgdGhpcy5jZmcuZmxhdm9yKSB7IHRoaXMucXVldWVkID0gdHJ1ZTsgcmV0dXJuOyB9ICAgLy8gbGV0IHRoZSB3YWtlLXVwIHBsYXkgdG8gdGhlIGVuZFxuICAgIGlmIChsb29wICYmIHRoaXMuc3RhdGUgPT09IHN0YXRlICYmIHRoaXMuY3VyID09PSBnKSByZXR1cm47XG4gICAgdGhpcy5xdWV1ZWQgPSBmYWxzZTsgdGhpcy5mbGF2b3JPbiA9IGZhbHNlOyB0aGlzLmlkbGVUID0gMDtcbiAgICBpZiAodGhpcy5jdXIpIHRoaXMuY3VyLnN0b3AoKTsgZy5zdG9wKCk7IGcuc3RhcnQobG9vcCwgc3BlZWQsIGcuZnJvbSwgZy50byk7XG4gICAgaWYgKGxvb3ApIGcuZ29Ub0ZyYW1lKGcuZnJvbSArIE1hdGgucmFuZG9tKCkgKiAoZy50byAtIGcuZnJvbSkpO1xuICAgIHRoaXMuY3VyID0gZzsgdGhpcy5zdGF0ZSA9IHN0YXRlOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7XG4gICAgaWYgKHBvc2UgJiYgcG9zZS5lbW90ZSkgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAwLjM1KTtcbiAgICBpZiAoc3RhdGUgPT09ICdzcGF3bicpIHsgdGhpcy5zcGF3blQgPSAwOyBpZiAodGhpcy5jZmcuc3Bhd25FbW90ZSkgeyB0aGlzLmVtb3RlKHRoaXMuY2ZnLnNwYXduRW1vdGUsIDAuMSk7IHRoaXMuZW1vdGUodGhpcy5jZmcuc3Bhd25FbW90ZSwgMC43KTsgfSB9XG4gIH1cbiAgLyoqIEEgbGl0dGxlIHBpY3R1cmUgdGhhdCBmbG9hdHMgdXAgb3ZlciB0aGUgaGVhZCBhbmQgZmFkZXMgKGEgc2xlZXB5IFwiWnp6XCIpLiAqL1xuICBwcml2YXRlIGVtb3RlKGtpbmQ6IHN0cmluZywgZGVsYXkgPSAwKSB7XG4gICAgY29uc3QgbWF0ID0gdGhpcy5BLmVtb3RlW2tpbmRdOyBpZiAoIW1hdCkgcmV0dXJuO1xuICAgIGNvbnN0IHBsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZW1vJywgeyBzaXplOiAwLjQyIH0sIHRoaXMuQS5zY2VuZSk7IHBsLnBhcmVudCA9IHRoaXMuaG9sZGVyOyBwbC5iaWxsYm9hcmRNb2RlID0gQkFCWUxPTi5NZXNoLkJJTExCT0FSRE1PREVfQUxMOyBwbC5tYXRlcmlhbCA9IG1hdDsgcGwuaXNQaWNrYWJsZSA9IGZhbHNlOyBwbC52aXNpYmlsaXR5ID0gMDtcbiAgICBjb25zdCB5MCA9IHRoaXMudG9wICsgMC4wMjsgcGwucG9zaXRpb24uc2V0KDAuMTYsIHkwLCAwKTsgdGhpcy5lbW90ZXMucHVzaCh7IG06IHBsLCB0OiAtZGVsYXksIHkwIH0pO1xuICB9XG4gIC8qKiBBZnRlciBzdGFuZGluZyBpZGxlIGZvciBhIHdoaWxlOiBwbGF5IHRoZSB1bml0J3MgZmxhdm91ciBjbGlwIG9uY2UgKHRoZSBPZ3JlIHlhd25zKSwgdGhlbiBnbyBiYWNrIHRvIGlkbGluZy4gKi9cbiAgcHJpdmF0ZSBzdGFydEZsYXZvcigpIHtcbiAgICBjb25zdCBmID0gdGhpcy5jZmcuZmxhdm9yITsgdGhpcy5pZGxlVCA9IDA7XG4gICAgbGV0IHBvb2wgPSBmLmNsaXBzLmZpbHRlcigoYykgPT4gYy5jbGlwICE9PSB0aGlzLmxhc3RGbGF2b3IgJiYgdGhpcy5hbmltc1tjLmNsaXBdKTsgaWYgKCFwb29sLmxlbmd0aCkgcG9vbCA9IGYuY2xpcHMuZmlsdGVyKChjKSA9PiB0aGlzLmFuaW1zW2MuY2xpcF0pOyBpZiAoIXBvb2wubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgcG9zZSA9IHBvb2xbTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogcG9vbC5sZW5ndGgpXSwgZyA9IHRoaXMuYW5pbXNbcG9zZS5jbGlwXTsgdGhpcy5sYXN0Rmxhdm9yID0gcG9zZS5jbGlwO1xuICAgIGlmICh0aGlzLmN1cikgdGhpcy5jdXIuc3RvcCgpOyBnLnN0b3AoKTsgZy5zdGFydChmYWxzZSwgMSwgZy5mcm9tLCBnLnRvKTsgdGhpcy5jdXIgPSBnOyB0aGlzLmZsYXZvck9uID0gdHJ1ZTsgdGhpcy5uZXh0Rmxhdm9yID0gZi5taW4gKyBNYXRoLnJhbmRvbSgpICogKGYubWF4IC0gZi5taW4pO1xuICAgIGlmIChWT0NBTC5oYXMocG9zZS5jbGlwKSkgYXVkaW8uYmFyayh0aGlzLnNvdWxJZCwgMC4yNSk7XG4gICAgaWYgKHBvc2UuZW1vdGUpIHsgdGhpcy5lbW90ZShwb3NlLmVtb3RlLCAwLjQpOyBpZiAocG9zZS5lbW90ZSA9PT0gJ3p6eicpIHRoaXMuZW1vdGUocG9zZS5lbW90ZSwgMS4yKTsgfVxuICB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7XG4gICAgdGhpcy5kZWNvLnVwZGF0ZShkdCk7XG4gICAgaWYgKHRoaXMuY3VyICYmICF0aGlzLmN1ci5pc1N0YXJ0ZWQpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBvbmUtc2hvdCBjbGlwIGZpbmlzaGVkXG4gICAgICBpZiAodGhpcy5xdWV1ZWQpIHsgdGhpcy5xdWV1ZWQgPSBmYWxzZTsgdGhpcy5wbGF5KCdpZGxlJyk7IH0gZWxzZSBpZiAodGhpcy5mbGF2b3JPbikgeyB0aGlzLmZsYXZvck9uID0gZmFsc2U7IHRoaXMucGxheSgnaWRsZScpOyB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHRoaXMucGxheSgnaWRsZScpO1xuICAgIH1cbiAgICBpZiAodGhpcy5jZmcuZmxhdm9yICYmIHRoaXMuc3RhdGUgPT09ICdpZGxlJyAmJiAhdGhpcy5mbGF2b3JPbiAmJiB0aGlzLmhvbGRlci5pc0VuYWJsZWQoKSkgeyB0aGlzLmlkbGVUICs9IGR0OyBpZiAodGhpcy5pZGxlVCA+PSB0aGlzLm5leHRGbGF2b3IpIHRoaXMuc3RhcnRGbGF2b3IoKTsgfVxuICAgIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB0aGlzLnNwYXduVCArPSBkdDtcbiAgICBmb3IgKGxldCBpID0gdGhpcy5lbW90ZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGUgPSB0aGlzLmVtb3Rlc1tpXTsgZS50ICs9IGR0OyBpZiAoZS50IDwgMCkgY29udGludWU7IGNvbnN0IGsgPSBlLnQgLyAxLjk7XG4gICAgICBpZiAoayA+PSAxKSB7IGUubS5kaXNwb3NlKCk7IHRoaXMuZW1vdGVzLnNwbGljZShpLCAxKTsgY29udGludWU7IH1cbiAgICAgIGUubS52aXNpYmlsaXR5ID0gTWF0aC5taW4oMSwgZS50IC8gMC4yKSAqICgxIC0gayAqIGspOyBlLm0ucG9zaXRpb24uc2V0KDAuMTYgKyAwLjA1ICogTWF0aC5zaW4oZS50ICogMyksIGUueTAgKyBlLnQgKiAwLjIsIDApOyBlLm0uc2NhbGluZy5zZXRBbGwoMC43ICsgMC41ICogayk7XG4gICAgfVxuICAgIGlmICh0aGlzLm93bikgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBleWUgZ2xvdyBmb2xsb3dzIHRoZSBtb29kOiBkaW0gd2hlbiBzbGVlcHksIGJyaWdodCB3aGVuIGF3YWtlLCBmbGFyaW5nIGluIGEgZmlnaHRcbiAgICAgIGxldCB0YXJnZXQgPSAwLjY1O1xuICAgICAgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHRhcmdldCA9IDAuMDggKyAwLjkyICogTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgKHRoaXMuc3Bhd25UIC8gMS42NyAtIDAuNDUpIC8gMC4zKSk7XG4gICAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnaWRsZScpIHRhcmdldCA9IHRoaXMuZmxhdm9yT24gPyAwLjI1IDogMC42NTtcbiAgICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdydW4nKSB0YXJnZXQgPSAxLjA7IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdhdHRhY2snKSB0YXJnZXQgPSAxLjc7IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHRhcmdldCA9IDEuNDsgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2RlYXRoJykgdGFyZ2V0ID0gMC4wNTtcbiAgICAgIHRoaXMuZXllSyArPSAodGFyZ2V0IC0gdGhpcy5leWVLKSAqIE1hdGgubWluKDEsIGR0ICogNyk7IHRoaXMub3duLmVtaXNzaXZlSW50ZW5zaXR5ID0gdGhpcy5leWVLO1xuICAgIH1cbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuc2ModGhpcy5zdGFyKSAqIHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5lbW90ZXMuZm9yRWFjaCgoZSkgPT4gZS5tLmRpc3Bvc2UoKSk7IGlmICh0aGlzLm93bikgdGhpcy5vd24uZGlzcG9zZSgpOyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5waWNrLmRpc3Bvc2UoKTsgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmRpc3Bvc2UoZmFsc2UsIGZhbHNlKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhbmQtaW5zXG5jb25zdCBQSDogUmVjb3JkPHN0cmluZywgeyBjb2w6IHN0cmluZzsgdzogbnVtYmVyOyBoOiBudW1iZXI7IGhlYWQ6IG51bWJlcjsgd2VhcG9uOiBzdHJpbmc7IGxhYmVsOiBzdHJpbmcgfT4gPSB7XG4gIGdvYmxpbjogeyBjb2w6ICcjNjNiMTNmJywgdzogMC4zNiwgaDogMC40MiwgaGVhZDogMC4zNiwgd2VhcG9uOiAnZGFnZ2VyJywgbGFiZWw6ICdHT0JMSU4nIH0sXG4gIGtuaWdodDogeyBjb2w6ICcjOGVhOWRjJywgdzogMC41LCBoOiAwLjYsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ3NoaWVsZCcsIGxhYmVsOiAnS05JR0hUJyB9LFxuICBvZ3JlOiB7IGNvbDogJyNhOGE2NGEnLCB3OiAwLjg1LCBoOiAwLjg1LCBoZWFkOiAwLjQyLCB3ZWFwb246ICdtYWNlJywgbGFiZWw6ICdPR1JFJyB9LFxuICBiYXJiYXJpYW46IHsgY29sOiAnI2Q2OGE1NScsIHc6IDAuNTIsIGg6IDAuNjIsIGhlYWQ6IDAuMzgsIHdlYXBvbjogJ2F4ZScsIGxhYmVsOiAnQkFSQkFSSUFOJyB9LFxufTtcbmNsYXNzIFBsYWNlaG9sZGVyVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIHJpZzogYW55OyBwcml2YXRlIGxlZ3M6IGFueVtdID0gW107IHByaXZhdGUgd3A6IGFueTsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSB0ID0gTWF0aC5yYW5kb20oKSAqIDY7IHByaXZhdGUgc3QwID0gMDsgcHJpdmF0ZSBkdXIgPSAxOyBwcml2YXRlIGJhc2UgPSAxOyBwcml2YXRlIHB1bHNlVCA9IDA7IHByaXZhdGUgbWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBib2R5OiBhbnk7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIHNvdWw6IHN0cmluZywgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lLCBkID0gUEhbc291bF07IHRoaXMudGVhbSA9IHRlYW07XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdwaF8nICsgc291bCwgcyk7IHRoaXMucmlnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncmlnJywgcyk7IHRoaXMucmlnLnBhcmVudCA9IHRoaXMuaG9sZGVyO1xuICAgIGNvbnN0IG1hdCA9IChoZXg6IHN0cmluZywgZW0gPSAwKSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdwbScsIHMpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoaGV4KS5zY2FsZSgwLjcyKTsgbS5zcGVjdWxhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMSwgMC4xLCAwLjEpOyBpZiAoZW0pIG0uZW1pc3NpdmVDb2xvciA9IG0uZGlmZnVzZUNvbG9yLnNjYWxlKGVtKTsgcmV0dXJuIG07IH07XG4gICAgY29uc3QgbGVnSCA9IDAuMjIsIGJvZHlZID0gbGVnSCArIGQuaCAvIDI7XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGxnID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnbGVnJywgcyk7IGxnLnBhcmVudCA9IHRoaXMucmlnOyBsZy5wb3NpdGlvbi5zZXQoc3ggKiBkLncgKiAwLjIyLCBsZWdILCAwKTsgY29uc3QgbSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2wnLCB7IGhlaWdodDogbGVnSCwgZGlhbWV0ZXI6IGQudyAqIDAuMjggfSwgcyk7IG0ucGFyZW50ID0gbGc7IG0ucG9zaXRpb24ueSA9IC1sZWdIIC8gMjsgbS5tYXRlcmlhbCA9IG1hdCgnIzRhMzgyNicpOyBtLmlzUGlja2FibGUgPSBmYWxzZTsgdGhpcy5sZWdzLnB1c2gobGcpOyB9XG4gICAgdGhpcy5ib2R5ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDYXBzdWxlKCdib2R5JywgeyByYWRpdXM6IGQudyAvIDIsIGhlaWdodDogZC5oICsgZC53ICogMC40IH0sIHMpOyB0aGlzLmJvZHkucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMuYm9keS5wb3NpdGlvbi55ID0gYm9keVk7IHRoaXMuYm9keS5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IHRoaXMuYm9keS5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgaGVhZCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCdoZWFkJywgeyBkaWFtZXRlcjogZC5oZWFkICogMS41LCBzZWdtZW50czogMTIgfSwgcyk7IGhlYWQucGFyZW50ID0gdGhpcy5yaWc7IGhlYWQucG9zaXRpb24ueSA9IGxlZ0ggKyBkLmggKyBkLmhlYWQgKiAwLjU1OyBoZWFkLm1hdGVyaWFsID0gbWF0KGQuY29sKTsgaGVhZC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgZXllTSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2V5ZScsIHMpOyBleWVNLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IGV5ZU0uZW1pc3NpdmVDb2xvciA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4yNSwgMSkgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC42NiwgMC4xOSk7ICh0aGlzIGFzIGFueSkuZXllTSA9IGV5ZU07XG4gICAgZm9yIChjb25zdCBzeCBvZiBbLTEsIDFdKSB7IGNvbnN0IGUgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnZScsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDAuMyB9LCBzKTsgZS5wYXJlbnQgPSB0aGlzLnJpZzsgZS5wb3NpdGlvbi5zZXQoc3ggKiBkLmhlYWQgKiAwLjMsIGhlYWQucG9zaXRpb24ueSArIDAuMDIsIGQuaGVhZCAqIDAuNjYpOyBlLm1hdGVyaWFsID0gZXllTTsgZS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICAvLyB3ZWFwb24gcGl2b3QgYXQgdGhlIHNob3VsZGVyLCBvbiB0aGUgY2hhcmFjdGVyJ3MgcmlnaHQgKC14IGlzIGZpbmUgZm9yIGEgc3RhbmQtaW4pXG4gICAgdGhpcy53cCA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3dwJywgcyk7IHRoaXMud3AucGFyZW50ID0gdGhpcy5yaWc7IHRoaXMud3AucG9zaXRpb24uc2V0KGQudyAqIDAuNiwgbGVnSCArIGQuaCAqIDAuODUsIDAuMDUpO1xuICAgIGNvbnN0IHdtID0gbWF0KCcjN2E1YTMwJyksIGlyb24gPSBtYXQoJyM5YWExYWQnKTtcbiAgICBjb25zdCBtayA9IChtOiBhbnksIGtpbmQ6IHN0cmluZywgZGltczogYW55LCBwb3M6IG51bWJlcltdLCBtdDogYW55KSA9PiB7IGNvbnN0IHggPSBraW5kID09PSAnYm94JyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQm94KCd3JywgZGltcywgcykgOiBraW5kID09PSAnY3lsJyA/IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3cnLCBkaW1zLCBzKSA6IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlU3BoZXJlKCd3JywgZGltcywgcyk7IHgucGFyZW50ID0gdGhpcy53cDsgeC5wb3NpdGlvbi5zZXQocG9zWzBdLCBwb3NbMV0sIHBvc1syXSk7IHgubWF0ZXJpYWwgPSBtdDsgeC5pc1BpY2thYmxlID0gZmFsc2U7IHJldHVybiB4OyB9O1xuICAgIGlmIChkLndlYXBvbiA9PT0gJ2RhZ2dlcicpIG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA1LCBoZWlnaHQ6IDAuMywgZGVwdGg6IDAuMDMgfSwgWzAsIC0wLjIsIDAuMTJdLCBpcm9uKTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdzaGllbGQnKSB7IG1rKDAsICdib3gnLCB7IHdpZHRoOiAwLjA2LCBoZWlnaHQ6IDAuNSwgZGVwdGg6IDAuMDQgfSwgWzAsIC0wLjMsIDAuMTRdLCBpcm9uKTsgY29uc3Qgc2ggPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdzaCcsIHsgaGVpZ2h0OiAwLjA1LCBkaWFtZXRlcjogMC41NSB9LCBzKTsgc2gucGFyZW50ID0gdGhpcy5yaWc7IHNoLnJvdGF0aW9uLnogPSBNYXRoLlBJIC8gMjsgc2gucG9zaXRpb24uc2V0KC1kLncgKiAwLjcsIGxlZ0ggKyBkLmggKiAwLjYsIDAuMDUpOyBzaC5tYXRlcmlhbCA9IG1hdCgnI2Q4YjY0YScpOyBzaC5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdtYWNlJykgeyBtaygwLCAnY3lsJywgeyBoZWlnaHQ6IDAuOSwgZGlhbWV0ZXI6IDAuMDggfSwgWzAsIC0wLjM1LCAwLjNdLCB3bSk7IG1rKDAsICdzcGgnLCB7IGRpYW1ldGVyOiAwLjQgfSwgWzAsIC0wLjg1LCAwLjRdLCBpcm9uKTsgfVxuICAgIGlmIChkLndlYXBvbiA9PT0gJ2F4ZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjYsIGRpYW1ldGVyOiAwLjA1IH0sIFswLCAtMC4yLCAwLjE1XSwgd20pOyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4zMiwgaGVpZ2h0OiAwLjIyLCBkZXB0aDogMC4wNSB9LCBbMCwgLTAuNSwgMC4xNV0sIGlyb24pOyBjb25zdCBoYWlyID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignaGFpcicsIHsgaGVpZ2h0OiAwLjMsIGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogZC5oZWFkICogMS4yIH0sIHMpOyBoYWlyLnBhcmVudCA9IHRoaXMucmlnOyBoYWlyLnBvc2l0aW9uLnkgPSBoZWFkLnBvc2l0aW9uLnkgKyBkLmhlYWQgKiAwLjc1OyBoYWlyLm1hdGVyaWFsID0gbWF0KCcjYzIyYTFjJyk7IGhhaXIuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgdGhpcy50b3AgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMS4zNTsgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCBkLncgKiAwLjcpO1xuICAgIGNvbnN0IGxibCA9IGR5bihzLCAyNTYsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCAyNnB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmZpbGxTdHlsZSA9ICcjZmZmZmZmJzsgYy5zdHJva2VTdHlsZSA9ICcjMTExJzsgYy5saW5lV2lkdGggPSA1OyBjLnN0cm9rZVRleHQoZC5sYWJlbCArICcgKHN0YW5kLWluKScsIDEyOCwgMzQpOyBjLmZpbGxUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgfSk7XG4gICAgY29uc3QgbHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdsYmwnLCB7IHdpZHRoOiAxLjEsIGhlaWdodDogMC4yIH0sIHMpOyBscC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgbHAucG9zaXRpb24ueSA9IC0wLjE7IGxwLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMiAqIDAuMDsgbHAuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDsgY29uc3QgbG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdsbScsIHMpOyBsbS5kaWZmdXNlVGV4dHVyZSA9IGxibDsgbG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IGxtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IGxtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgbHAubWF0ZXJpYWwgPSBsbTsgbHAuaXNQaWNrYWJsZSA9IGZhbHNlOyBscC5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjYyO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogdGhpcy50b3AsIGRpYW1ldGVyOiBNYXRoLm1heCgwLjcsIGQudyAqIDEuMykgfSwgcyk7IHRoaXMucGljay5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5waWNrLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCAvIDI7IHRoaXMucGljay52aXNpYmlsaXR5ID0gMC4wMDE7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgICAodGhpcyBhcyBhbnkpLnBhcnRzID0gW2xwXTsgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGxheSgnaWRsZScpO1xuICB9XG4gIHNldFRlYW0odDogMCB8IDEpIHsgdGhpcy50ZWFtID0gdDsgKHRoaXMgYXMgYW55KS5leWVNLmVtaXNzaXZlQ29sb3IgPSB0ID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyB0aGlzLmRlY28uc2V0KHQsIHRoaXMuc3Rhcik7IH1cbiAgc2V0U3RhcihzdDogbnVtYmVyKSB7IHRoaXMuc3RhciA9IHN0OyB0aGlzLmJhc2UgPSBCQUxBTkNFLnN0YXIuc2NhbGVbc3QgLSAxXTsgY29uc3QgdCA9IFRJTlRbc3QgLSAxXTsgdGhpcy5ib2R5Lm1hdGVyaWFsLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkZyb21IZXhTdHJpbmcoUEhbdGhpcy5zb3VsXS5jb2wpLnNjYWxlKDAuNzIpLm11bHRpcGx5KG5ldyBCQUJZTE9OLkNvbG9yMyhNYXRoLm1pbigxLCB0WzBdKSwgTWF0aC5taW4oMSwgdFsxXSksIE1hdGgubWluKDEsIHRbMl0pKSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXQodGhpcy50ZWFtLCBzdCk7IHRoaXMuZGVjby5maXQodGhpcy5iYXNlKTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRMZXZlbChuOiBudW1iZXIpIHsgdGhpcy5kZWNvLnNldExldmVsKG4pOyB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0TWFuYShmKTsgfVxuICBwdWxzZSgpIHsgdGhpcy5wdWxzZVQgPSAwLjE2OyB9XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQgPSAxKSB7IGlmIChzdGF0ZSA9PT0gdGhpcy5zdGF0ZSAmJiAoc3RhdGUgPT09ICdpZGxlJyB8fCBzdGF0ZSA9PT0gJ3J1bicpKSByZXR1cm47IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5zdDAgPSB0aGlzLnQ7IHRoaXMuZHVyID0gc3RhdGUgPT09ICdhdHRhY2snID8gKEJBTEFOQ0Uuc3RhdHNbdGhpcy5zb3VsIGFzIFNvdWxJZF0uYW5pbUxlbiAvIHNwZWVkKSA6IHN0YXRlID09PSAnZGVhdGgnID8gMC42IDogc3RhdGUgPT09ICdzcGF3bicgPyAwLjkgOiAxLjA7IHRoaXMuZGVjby5zZXRBdXJhKHN0YXRlICE9PSAnZGVhdGgnKTsgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMudCArPSBkdDsgdGhpcy5kZWNvLnVwZGF0ZShkdCk7IGNvbnN0IHAgPSBNYXRoLm1pbigxLCAodGhpcy50IC0gdGhpcy5zdDApIC8gdGhpcy5kdXIpLCBSID0gdGhpcy5yaWcsIFcgPSB0aGlzLndwO1xuICAgIFIucG9zaXRpb24uc2V0KDAsIDAsIDApOyBSLnJvdGF0aW9uLnNldCgwLCAwLCAwKTsgUi5zY2FsaW5nLnNldEFsbCgxKTsgVy5yb3RhdGlvbi54ID0gLTAuNDsgdGhpcy5sZWdzLmZvckVhY2goKGwpID0+IChsLnJvdGF0aW9uLnggPSAwKSk7XG4gICAgaWYgKHRoaXMuc3RhdGUgPT09ICdpZGxlJykgUi5wb3NpdGlvbi55ID0gTWF0aC5zaW4odGhpcy50ICogMi4yKSAqIDAuMDEyO1xuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdydW4nKSB7IGNvbnN0IHcgPSB0aGlzLnQgKiAxMDsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odykpICogMC4wNzsgUi5yb3RhdGlvbi54ID0gMC4yOyB0aGlzLmxlZ3NbMF0ucm90YXRpb24ueCA9IE1hdGguc2luKHcpICogMC45OyB0aGlzLmxlZ3NbMV0ucm90YXRpb24ueCA9IC1NYXRoLnNpbih3KSAqIDAuOTsgVy5yb3RhdGlvbi54ID0gLTAuNCArIE1hdGguc2luKHcpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2F0dGFjaycpIHsgY29uc3QgayA9IHAgPCAwLjQgPyAtMi40ICogKHAgLyAwLjQpIDogLTIuNCArIDMuNCAqIE1hdGgubWluKDEsIChwIC0gMC40KSAvIDAuMjUpOyBXLnJvdGF0aW9uLnggPSBrOyBSLnBvc2l0aW9uLnogPSAwLjE0ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyBSLnJvdGF0aW9uLnggPSAwLjE1ICogTWF0aC5zaW4oTWF0aC5QSSAqIHApOyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgeyBjb25zdCBlID0gcCAqIHAgKiAoMyAtIDIgKiBwKTsgUi5zY2FsaW5nLnNldEFsbCgwLjAxICsgMC45OSAqIGUpOyBSLnBvc2l0aW9uLnkgPSAoZSAtIDEpICogMC40OyB9XG4gICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2RlYXRoJykgeyBjb25zdCBlID0gcCAqIHA7IFIucm90YXRpb24ueCA9IC1NYXRoLlBJIC8gMiAqIGU7IFIucG9zaXRpb24ueSA9IDAuMjUgKiBlOyBSLnBvc2l0aW9uLnogPSAtMC4yICogZTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdjaGVlcicpIHsgUi5wb3NpdGlvbi55ID0gTWF0aC5hYnMoTWF0aC5zaW4odGhpcy50ICogNykpICogMC4xNTsgVy5yb3RhdGlvbi54ID0gLTIuNjsgfVxuICAgIGlmICh0aGlzLnB1bHNlVCA+IDApIHsgdGhpcy5wdWxzZVQgLT0gZHQ7IGNvbnN0IGsgPSAxICsgMC4wOSAqIE1hdGguc2luKE1hdGgubWF4KDAsIHRoaXMucHVsc2VUKSAvIDAuMTYgKiBNYXRoLlBJKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5iYXNlICogayk7IH1cbiAgfVxuICBkaXNwb3NlKCkgeyB0aGlzLmRlY28uZGlzcG9zZSgpOyB0aGlzLmhvbGRlci5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4gbS5kaXNwb3NlKCkpOyB0aGlzLmhvbGRlci5kaXNwb3NlKCk7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVZpc3VhbChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcik6IFVuaXRWaXN1YWwge1xuICBjb25zdCBjZmcgPSBBLnRyaXBvW3NvdWxdO1xuICByZXR1cm4gY2ZnID8gbmV3IFRyaXBvVmlzdWFsKEEsIGNmZywgc291bCwgdGVhbSwgc3RhcikgOiBuZXcgUGxhY2Vob2xkZXJWaXN1YWwoQSwgc291bCwgdGVhbSwgc3Rhcik7XG59XG5leHBvcnQgY29uc3QgaXNUcmlwbyA9IChBOiBBc3NldHMsIHNvdWw6IFNvdWxJZCkgPT4gISFBLnRyaXBvW3NvdWxdO1xuIiwgIi8vIFRoZSBnYW1lJ3MgaWNvbiBzZXQgKGN1c3RvbSBhcnQsIHNsaWNlZCBmcm9tIFBpcGVsaW5lL2ljb25zL3NoZWV0XyoucG5nIGJ5IFBpcGVsaW5lL2JsZW5kZXIvc2xpY2VfaWNvbnMucHkgLT4gZG9jcy9hc3NldHMvaWNvbnMvKi5wbmcpLlxuLy8gU2hhcmVkIGJ5IHRoZSAzRCBnYW1lJ3MgRE9NICh2YW5pbGxhKSBhbmQgdGhlIEFuZ3VsYXIgc2hlbGwuIE5vIGVtb2ppIGFueXdoZXJlOiBldmVyeSBnbHlwaCBpbiB0aGUgVUkgaXMgb25lIG9mIHRoZXNlIGltYWdlcy5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUmFyaXR5IH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5cbmV4cG9ydCB0eXBlIEljb25OYW1lID1cbiAgfCAnaG9tZScgfCAnc291bHMnIHwgJ3Nob3AnIHwgJ3NldHRpbmdzJyB8ICdjbG9zZSdcbiAgfCAnaGVhcnQnIHwgJ2hlYXJ0X2VtcHR5JyB8ICdkb21pbmlvbicgfCAnc3RhcicgfCAnbG9jaydcbiAgfCAnd2FycmlvcicgfCAnYXJjaGVyJyB8ICdnb2JsaW4nIHwgJ2tuaWdodCcgfCAnb2dyZScgfCAnYmFyYmFyaWFuJ1xuICB8ICdnZW1fY29tbW9uJyB8ICdnZW1fcmFyZScgfCAnZ2VtX2VwaWMnIHwgJ2dlbV9sZWdlbmRhcnknXG4gIHwgJ211c2ljJyB8ICdzb3VuZF9vbicgfCAnc291bmRfb2ZmJyB8ICd1cGdyYWRlJyB8ICdzd2FwJ1xuICB8ICdtZXJnZScgfCAncmVtb3ZlJyB8ICdjaGVjaycgfCAnYmFjaycgfCAnaW5mbycgfCAnZ29sZCc7XG5cbi8qKiBSZWxhdGl2ZSB0byB0aGUgcGFnZSwgc28gaXQgd29ya3Mgb24gR2l0SHViIFBhZ2VzIHVuZGVyIC9yZXBvLW5hbWUvLiAqL1xuZXhwb3J0IGNvbnN0IGljb25VcmwgPSAobjogSWNvbk5hbWUpOiBzdHJpbmcgPT4gJ2Fzc2V0cy9pY29ucy8nICsgbiArICcucG5nJztcbi8qKiBBbiA8aW1nPiBhcyBhbiBIVE1MIHN0cmluZywgZm9yIHRoZSBnYW1lJ3MgaGFuZC1idWlsdCBET00uICovXG5leHBvcnQgY29uc3QgaWNvbkltZyA9IChuOiBJY29uTmFtZSwgY2xzID0gJ2ljJyk6IHN0cmluZyA9PiBgPGltZyBjbGFzcz1cIiR7Y2xzfVwiIHNyYz1cIiR7aWNvblVybChuKX1cIiBhbHQ9XCJcIiBkcmFnZ2FibGU9XCJmYWxzZVwiPmA7XG5cbi8qKiBFYWNoIFNvdWwgaXMgc2hvd24gYnkgaXRzIHdlYXBvbi9yb2xlIGljb24gdW50aWwgcmVhbCBwb3J0cmFpdHMgZXhpc3QuICovXG5leHBvcnQgY29uc3QgU09VTF9JQ09OOiBSZWNvcmQ8U291bElkLCBJY29uTmFtZT4gPSB7IHdhcnJpb3I6ICd3YXJyaW9yJywgYXJjaGVyOiAnYXJjaGVyJywgZ29ibGluOiAnZ29ibGluJywga25pZ2h0OiAna25pZ2h0Jywgb2dyZTogJ29ncmUnLCBiYXJiYXJpYW46ICdiYXJiYXJpYW4nIH07XG5leHBvcnQgY29uc3QgUkFSSVRZX0dFTTogUmVjb3JkPFJhcml0eSwgSWNvbk5hbWU+ID0geyBjb21tb246ICdnZW1fY29tbW9uJywgcmFyZTogJ2dlbV9yYXJlJywgZXBpYzogJ2dlbV9lcGljJywgbGVnZW5kYXJ5OiAnZ2VtX2xlZ2VuZGFyeScgfTtcblxuLyoqIFBhY2sgdGllcnMgYXJlIHNob3duIGFzIHNrdWxscyAobmV2ZXIgc3RhcnM6IHN0YXJzIG1lYW4gYW4gaW4tcnVuIG1lcmdlIGxldmVsKS4gKi9cbmV4cG9ydCBjb25zdCBza3VsbEltZ3MgPSAobjogbnVtYmVyLCBjbHMgPSAnc2snKTogc3RyaW5nID0+IGljb25JbWcoJ3NvdWxzJywgY2xzKS5yZXBlYXQoTWF0aC5tYXgoMSwgbikpO1xuZXhwb3J0IGNvbnN0IGhlYXJ0c0h0bWwgPSAoaGVhcnRzOiBudW1iZXIsIG1heCA9IDMpOiBzdHJpbmcgPT4gaWNvbkltZygnaGVhcnQnLCAnaWMgaGVhcnQnKS5yZXBlYXQoTWF0aC5tYXgoMCwgaGVhcnRzKSkgKyBpY29uSW1nKCdoZWFydF9lbXB0eScsICdpYyBoZWFydCcpLnJlcGVhdChNYXRoLm1heCgwLCBtYXggLSBoZWFydHMpKTtcbi8qKiBBIG51bWJlciB3aXRoIHRob3VzYW5kcyBzZXBhcmF0b3JzIChnb2xkIGdldHMgYmlnKTogMTI1MDAgLT4gXCIxMiw1MDBcIi4gKi9cbmV4cG9ydCBjb25zdCBmbXQgPSAobjogbnVtYmVyKTogc3RyaW5nID0+IE1hdGgucm91bmQobikudG9Mb2NhbGVTdHJpbmcoJ2VuLVVTJyk7XG4iLCAiLy8gUmVuZGVyZWQgU291bCBwb3J0cmFpdHMgKFBpcGVsaW5lL2JsZW5kZXIvcmVuZGVyX3BvcnRyYWl0LnB5LCBoZWFkLWFuZC1zaG91bGRlcnMgbW9kZSksIHNoYXJlZCBieSB0aGUgQW5ndWxhciBwYWdlcyBhbmQgdGhlIGJhdHRsZSBzY3JlZW4uXG4vLyBTb3VscyB3aXRob3V0IGEgcG9ydHJhaXQgeWV0IGZhbGwgYmFjayB0byB0aGVpciByb2xlIGljb24gb24gYSBjb2xvdXJlZCBjYXJkLlxuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgUkFSSVRZX09GIH0gZnJvbSAnLi4vY29yZS9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJhcml0eSB9IGZyb20gJy4uL2NvcmUvcGFja3MudHMnO1xuaW1wb3J0IHsgU09VTF9JQ09OLCBpY29uVXJsIH0gZnJvbSAnLi9pY29ucy50cyc7XG5cbmNvbnN0IFBPUlRSQUlUOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHN0cmluZz4+ID0geyB3YXJyaW9yOiAnYXNzZXRzL3BvcnRyYWl0cy93YXJyaW9yX2hlYWQucG5nJywgYXJjaGVyOiAnYXNzZXRzL3BvcnRyYWl0cy9hcmNoZXJfaGVhZC5wbmcnLCBvZ3JlOiAnYXNzZXRzL3BvcnRyYWl0cy9vZ3JlX2hlYWQucG5nJywgZ29ibGluOiAnYXNzZXRzL3BvcnRyYWl0cy9nb2JsaW5faGVhZC5wbmcnLCBrbmlnaHQ6ICdhc3NldHMvcG9ydHJhaXRzL2tuaWdodF9oZWFkLnBuZycsIGJhcmJhcmlhbjogJ2Fzc2V0cy9wb3J0cmFpdHMvYmFyYmFyaWFuX2hlYWQucG5nJyB9O1xuY29uc3QgUkFSSVRZX0hFWDogUmVjb3JkPFJhcml0eSwgc3RyaW5nPiA9IHsgY29tbW9uOiAnI2I4YzBjYycsIHJhcmU6ICcjNGFhM2ZmJywgZXBpYzogJyNiMjZiZmYnLCBsZWdlbmRhcnk6ICcjZmZjYzMzJyB9O1xuZXhwb3J0IGNvbnN0IGhhc0FydCA9IChzOiBTb3VsSWQpOiBib29sZWFuID0+ICEhUE9SVFJBSVRbc107XG5leHBvcnQgY29uc3Qgc291bEFydCA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4gUE9SVFJBSVRbc10gPz8gaWNvblVybChTT1VMX0lDT05bc10pO1xuZXhwb3J0IGNvbnN0IHJhcml0eUNvbG9yID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiBSQVJJVFlfSEVYW1JBUklUWV9PRltzXV07XG4vKiogQ2FyZCBiYWNrZHJvcCBmb3IgYSBwb3J0cmFpdDogYSBnbG93IGluIHRoZSByYXJpdHkgY29sb3VyIGJlaGluZCB0aGUgZmlndXJlLCBvbiBhIGRhcmsgY3J5cHQgZ3JhZGllbnQuICovXG5leHBvcnQgY29uc3QgYXJ0QmcgPSAoczogU291bElkKTogc3RyaW5nID0+IHsgY29uc3QgYyA9IHJhcml0eUNvbG9yKHMpOyByZXR1cm4gYHJhZGlhbC1ncmFkaWVudChlbGxpcHNlIGF0IDUwJSA4MCUsICR7Y303NyAwJSwgJHtjfTI2IDQ2JSwgdHJhbnNwYXJlbnQgNzQlKSwgbGluZWFyLWdyYWRpZW50KCMyYjI0NDQsIzBkMDkxOSlgOyB9O1xuIiwgIi8vIERPTSB1c2VyIGludGVyZmFjZTogdG9wIGJhciwgZW5lbXkgcHJldmlldywgaGFuZCBvZiBjYXJkcywgYnV0dG9ucywgZHJhZnQgb3ZlcmxheSwgdG9hc3RzIGFuZCB0aGUgZGVidWcgcGFuZWwuXG5pbXBvcnQgeyBCQUxBTkNFLCBST0xFX1RFWFQsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgeyBpc0VuZGxlc3MgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY29zdCwgZG9taW5pb25GcmVlLCBkb21pbmlvblVzZWQsIHN0YWdlV2F2ZXMgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGVuZW15V2F2ZSwgcHJldmlld1RleHQgfSBmcm9tICcuLi9jb3JlL3dhdmVzLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgeyBhcnRCZywgaGFzQXJ0LCByYXJpdHlDb2xvciwgc291bEFydCB9IGZyb20gJy4uL3VpL3BvcnRyYWl0cy50cyc7XG5pbXBvcnQgeyBTT1VMX0lDT04sIGhlYXJ0c0h0bWwsIGZtdCwgaWNvbkltZywgaWNvblVybCwgc2t1bGxJbWdzIH0gZnJvbSAnLi4vdWkvaWNvbnMudHMnO1xuaW1wb3J0IHsgZGVzY3JpYmVVbmxvY2sgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcblxuY29uc3QgcG9ydHJhaXRIdG1sID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiBgPGRpdiBjbGFzcz1cInB0XCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiR7YXJ0Qmcocyl9XCI+PGltZyBzcmM9XCIke3NvdWxBcnQocyl9XCIgYWx0PVwiXCIgZHJhZ2dhYmxlPVwiZmFsc2VcIj48L2Rpdj5gO1xuY29uc3QgSUNPTiA9IE9iamVjdC5mcm9tRW50cmllcyhTT1VMUy5tYXAoKHMpID0+IFtzLCBpY29uSW1nKFNPVUxfSUNPTltzXSwgJ2ljJyldKSkgYXMgUmVjb3JkPFNvdWxJZCwgc3RyaW5nPjtcbmNvbnN0ICQgPSAoaWQ6IHN0cmluZykgPT4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpITtcbmNvbnN0IHN0YXJzID0gKG46IG51bWJlcikgPT4gJ1x1MjYwNScucmVwZWF0KG4pO1xuXG5leHBvcnQgY2xhc3MgVWkge1xuICBwcml2YXRlIHRvYXN0VCA9IDA7IHByaXZhdGUgZGJnOiBIVE1MRWxlbWVudDsgcHJpdmF0ZSBvZGRzID0gJyc7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgZzogYW55KSB7XG4gICAgJCgnYnRuSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgJCgnYnRuQmF0dGxlJykub25jbGljayA9ICgpID0+IGcuc3RhcnRCYXR0bGUoKTsgJCgnYnRuU3dhcCcpLm9uY2xpY2sgPSAoKSA9PiBnLnRvZ2dsZVN3YXAoKTtcbiAgICAkKCdidG5SZW1vdmUnKS5vbmNsaWNrID0gKCkgPT4gZy5yZW1vdmVTZWxlY3RlZCgpO1xuICAgICQoJ2J0blNwZWVkJykub25jbGljayA9ICgpID0+IGcuc2V0U3BlZWQoZy50aW1lU2NhbGUgPiAxID8gMSA6IDIpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IGcuc2V0Q2FtTW9kZShiLmRhdGFzZXQuY2FtISkpKTtcbiAgICAkKCdnZWFyJykub25jbGljayA9ICgpID0+IHsgdGhpcy5kYmcuY2xhc3NMaXN0LnRvZ2dsZSgnb3BlbicpOyB0aGlzLnJlbmRlckRlYnVnKCk7IH07XG4gICAgY29uc3Qgc25kID0gKCkgPT4geyAkKCdidG5NdXNpYycpLmNsYXNzTGlzdC50b2dnbGUoJ29mZicsICFhdWRpby5tdXNpYyk7ICQoJ2J0blNmeCcpLmNsYXNzTGlzdC50b2dnbGUoJ29mZicsICFhdWRpby5zZngpOyBjb25zdCBzaSA9ICQoJ2J0blNmeCcpLnF1ZXJ5U2VsZWN0b3IoJ2ltZycpOyBpZiAoc2kpIHNpLnNyYyA9IGljb25VcmwoYXVkaW8uc2Z4ID8gJ3NvdW5kX29uJyA6ICdzb3VuZF9vZmYnKTsgfTtcbiAgICAkKCdidG5NdXNpYycpLm9uY2xpY2sgPSAoKSA9PiB7IGF1ZGlvLnNldE11c2ljKCFhdWRpby5tdXNpYyk7IHNuZCgpOyB9OyAkKCdidG5TZngnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRTZngoIWF1ZGlvLnNmeCk7IHNuZCgpOyB9O1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCduZWNyby1zZXR0aW5ncycsIHNuZCk7IHNuZCgpO1xuICAgIHRoaXMuZGJnID0gJCgnZGVidWcnKTsgaWYgKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ2RlYnVnJykpIHRoaXMuZGJnLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgICB0aGlzLnJlbmRlckRlYnVnKCk7XG4gIH1cblxuICAvKiogVGhlIE5lY3JvbWFuY2VyIGp1c3QgbG9zdCBhIGhlYXJ0OiBtYWtlIHRoZSBoZWFydHMgYnVtcC4gKi9cbiAgcHVsc2VIZWFydHMoKSB7IGNvbnN0IGggPSAkKCdoZWFydHMnKTsgaC5jbGFzc0xpc3QucmVtb3ZlKCdodXJ0Jyk7IHZvaWQgaC5vZmZzZXRXaWR0aDsgaC5jbGFzc0xpc3QuYWRkKCdodXJ0Jyk7IH1cbiAgdG9hc3QobXNnOiBzdHJpbmcpIHsgY29uc3QgdCA9ICQoJ3RvYXN0Jyk7IHQudGV4dENvbnRlbnQgPSBtc2c7IHQuY2xhc3NMaXN0LmFkZCgnc2hvdycpOyBjbGVhclRpbWVvdXQodGhpcy50b2FzdFQpOyB0aGlzLnRvYXN0VCA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHQuY2xhc3NMaXN0LnJlbW92ZSgnc2hvdycpLCAzNjAwKTsgfVxuXG4gIHJlbmRlcigpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBzID0gZy5zLCBwaCA9IGcucGhhc2UsIGJ1aWxkID0gcGggPT09ICdidWlsZCc7XG4gICAgJCgnaGVhcnRzJykuaW5uZXJIVE1MID0gaGVhcnRzSHRtbChzLmhlYXJ0cyk7XG4gICAgJCgnd2F2ZScpLnRleHRDb250ZW50ID0gaXNFbmRsZXNzKCkgPyBgV2F2ZSAke3Mud2F2ZX1gIDogYFdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX1gO1xuICAgIGNvbnN0IHVzZWQgPSBkb21pbmlvblVzZWQocyk7ICQoJ2RvbScpLnRleHRDb250ZW50ID0gYCR7dXNlZH0vJHtzLmNhcH1gOyAoJCgnZG9tZmlsbCcpIGFzIEhUTUxFbGVtZW50KS5zdHlsZS53aWR0aCA9IE1hdGgubWluKDEwMCwgKHVzZWQgLyBzLmNhcCkgKiAxMDApICsgJyUnO1xuICAgIC8vIGVuZW15IHByZXZpZXc6IHdoYXQgaXMgY29taW5nLCBuZXZlciB3aGVyZVxuICAgIGNvbnN0IHB2ID0gcHJldmlld1RleHQoZW5lbXlXYXZlKHMud2F2ZSwgZy5zZWVkKSk7XG4gICAgJCgnZW5lbXknKS5pbm5lckhUTUwgPSBgPGI+TmV4dCBlbmVtaWVzPC9iPmAgKyBwdi5tYXAoKHApID0+IGA8ZGl2IGNsYXNzPVwiZXJvd1wiPjxzcGFuPiR7SUNPTltwLnNvdWwgYXMgU291bElkXX08L3NwYW4+PHNwYW4+JHtTT1VMX05BTUVbcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuIGNsYXNzPVwieFwiPlx1MDBENyR7cC5jb3VudH08L3NwYW4+PHNwYW4gY2xhc3M9XCJzdFwiPiR7c3RhcnMocC5zdGFyKX08L3NwYW4+PC9kaXY+YCkuam9pbignJykgKyBgPGRpdiBjbGFzcz1cImhpbnRcIj5Qb3NpdGlvbnMgc3RheSBoaWRkZW4gdW50aWwgdGhlIGJhdHRsZS48L2Rpdj5gO1xuICAgIC8vIGhhbmRcbiAgICBjb25zdCBoYW5kID0gJCgnaGFuZCcpOyBoYW5kLmlubmVySFRNTCA9ICcnO1xuICAgIHMuaGFuZC5mb3JFYWNoKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4ge1xuICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgY29uc3Qgc2VsID0gZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIGcuc2VsLmlkeCA9PT0gaTsgY29uc3QgYWZmb3JkID0gY2FuU3VtbW9uKHMsIGkpLCBjYW5NZXJnZSA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKSwgdXNhYmxlID0gYWZmb3JkIHx8IGNhbk1lcmdlO1xuICAgICAgY29uc3QgYXJ0ID0gaGFzQXJ0KHNvdWwpOyBlbC5jbGFzc05hbWUgPSAnY2FyZCcgKyAoYXJ0ID8gJyBhcnQnIDogJycpICsgKHNlbCA/ICcgc2VsJyA6ICcnKSArICghdXNhYmxlICYmICFnLnN3YXBNb2RlID8gJyBkaXMnIDogJycpICsgKGcuc3dhcE1vZGUgPyAnIHN3YXAnIDogJycpO1xuICAgICAgY29uc3QgdGFnID0gYWZmb3JkID8gYDxzcGFuIGNsYXNzPVwib2tcIj5TdW1tb248L3NwYW4+YCA6IGNhbk1lcmdlID8gJzxzcGFuIGNsYXNzPVwib2sgbWdcIj5NZXJnZSBvbmx5PC9zcGFuPicgOiAnPHNwYW4gY2xhc3M9XCJub1wiPk5vIHJvb208L3NwYW4+JztcbiAgICAgIGlmIChhcnQpIGVsLnN0eWxlLmJvcmRlckNvbG9yID0gcmFyaXR5Q29sb3Ioc291bCk7XG4gICAgICBlbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHthcnQgPyBwb3J0cmFpdEh0bWwoc291bCkgOiBJQ09OW3NvdWxdICsgYDxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PmB9PGRpdiBjbGFzcz1cImNzXCI+JHt0YWd9PC9kaXY+YDsgZWwudGl0bGUgPSBST0xFX1RFWFRbc291bF0gKyAoYWZmb3JkID8gJycgOiBjYW5NZXJnZSA/ICcgLSBEb21pbmlvbiBpcyBmdWxsLCBidXQgeW91IGNhbiBtZXJnZSBpdCBpbnRvIHlvdXIgbWF0Y2hpbmcgMS1zdGFyIHVuaXQuJyA6ICcgLSBOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJyk7XG4gICAgICBlbC5vbmNsaWNrID0gKCkgPT4gZy5vbkNhcmQoaSk7IGhhbmQuYXBwZW5kQ2hpbGQoZWwpO1xuICAgIH0pO1xuICAgIGlmICghcy5oYW5kLmxlbmd0aCkgaGFuZC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cImVtcHR5XCI+Tm8gY2FyZHMgaW4gaGFuZDwvZGl2Pic7XG4gICAgLy8gYnV0dG9uc1xuICAgICgkKCdidG5CYXR0bGUnKSBhcyBIVE1MQnV0dG9uRWxlbWVudCkuZGlzYWJsZWQgPSAhYnVpbGQgfHwgIXMudW5pdHMubGVuZ3RoO1xuICAgIGNvbnN0IHN3ID0gJCgnYnRuU3dhcCcpIGFzIEhUTUxCdXR0b25FbGVtZW50OyBzdy5kaXNhYmxlZCA9ICFidWlsZCB8fCBzLmRpc2NhcmRVc2VkOyBzdy5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGcuc3dhcE1vZGUpOyBzdy50ZXh0Q29udGVudCA9IHMuZGlzY2FyZFVzZWQgPyAnU3dhcCB1c2VkJyA6IGcuc3dhcE1vZGUgPyAnU3dhcDogcGljayBhIGNhcmQgb3IgdW5pdCcgOiAnU3dhcCAoMS9yb3VuZCknO1xuICAgIGNvbnN0IHNlbFUgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAndW5pdCcgPyBzLnVuaXRzLmZpbmQoKHU6IGFueSkgPT4gdS5pZCA9PT0gZy5zZWwuaWQpIDogbnVsbDtcbiAgICBjb25zdCBwYXJ0bmVyID0gc2VsVSAmJiBzLnVuaXRzLnNvbWUoKG86IGFueSkgPT4gY2FuTWVyZ2VEZXBsb3llZChzZWxVLCBvKSk7XG4gICAgJCgndW5pdHBhbmVsJykuc3R5bGUuZGlzcGxheSA9IGJ1aWxkICYmIHNlbFUgPyAnZmxleCcgOiAnbm9uZSc7XG4gICAgJCgnYnRuUmVtb3ZlJykudGV4dENvbnRlbnQgPSBnLmNvbmZpcm1SZW1vdmUgPyAnQ29uZmlybSByZW1vdmUnIDogJ1JlbW92ZSc7XG4gICAgJCgnaW5mbycpLnRleHRDb250ZW50ID0gYnVpbGQgPyAoZy5zd2FwTW9kZSA/ICdTV0FQOiB0YXAgYSBoYW5kIGNhcmQgdG8gZGlzY2FyZCBpdCwgb3IgdGFwIGEgdW5pdCB5b3UgZGlkIG5vdCBzdW1tb24gdGhpcyByb3VuZCB0byBzZWxsIGl0LiBZb3UgZHJhdyBhIGRpZmZlcmVudCBTb3VsLidcbiAgICAgIDogc2VsVSA/IGAke1NPVUxfTkFNRVtzZWxVLnNvdWwgYXMgU291bElkXX0gJHtzdGFycyhzZWxVLnN0YXIpfSAgXHUyMDIyICAke1JPTEVfVEVYVFtzZWxVLnNvdWwgYXMgU291bElkXX0gICR7cGFydG5lciA/ICdcdTIwMjIgVGFwIHRoZSBtYXRjaGluZyB1bml0IHRvIG1lcmdlIGludG8gYSBzdHJvbmdlciBzdGFyLicgOiAnJ31gXG4gICAgICA6IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICdjYXJkJyA/IGAke1NPVUxfTkFNRVtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfTogJHtST0xFX1RFWFRbcy5oYW5kW2cuc2VsLmlkeF0gYXMgU291bElkXX0gIFx1MjAyMiAgYCArICgoKSA9PiB7IGNvbnN0IGkgPSBnLnNlbC5pZHgsIHNtID0gY2FuU3VtbW9uKHMsIGkpLCBtZyA9IHMudW5pdHMuc29tZSgodTogYW55KSA9PiBjYW5NZXJnZUZyb21IYW5kKHMsIGksIHUuaWQpKTsgcmV0dXJuIHNtICYmIG1nID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLCBvciBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6IHNtID8gJ1RhcCBhIGdyZWVuIHRpbGUgdG8gc3VtbW9uLicgOiBtZyA/ICdEb21pbmlvbiBpcyBmdWxsOiB0YXAgYSBnbG93aW5nIHB1cnBsZSB1bml0IHRvIG1lcmdlIGl0IGluLicgOiAnTm90IGVub3VnaCBmcmVlIERvbWluaW9uIHRvIHN1bW1vbiB0aGlzLic7IH0pKCkgOiAnVGFwIGEgY2FyZCwgdGhlbiBhIHRpbGUuIFRhcCBhIHVuaXQgdG8gbWVyZ2UsIG1vdmUgb3IgcmVtb3ZlIGl0LicpXG4gICAgICA6IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ0JhdHRsZSEgVW5pdHMgZmlnaHQgb24gdGhlaXIgb3duLicgOiAnJztcbiAgICAkKCdzcGVlZCcpLnN0eWxlLmRpc3BsYXkgPSBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyA/ICdmbGV4JyA6ICdub25lJztcbiAgICBjb25zdCBmYXN0ID0gZy5zcGVlZFVubG9ja2VkKCk7IGlmICghZmFzdCAmJiBnLnRpbWVTY2FsZSA+IDEpIGcudGltZVNjYWxlID0gMTtcbiAgICBjb25zdCBzYiA9ICQoJ2J0blNwZWVkJyk7IHNiLnN0eWxlLmRpc3BsYXkgPSBmYXN0ID8gJycgOiAnbm9uZSc7IHNiLnRleHRDb250ZW50ID0gZy50aW1lU2NhbGUgKyAneCc7IHNiLmNsYXNzTGlzdC50b2dnbGUoJ29uJywgZy50aW1lU2NhbGUgPiAxKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IGIuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBiLmRhdGFzZXQuY2FtID09PSBnLmNhbU1vZGUpKTtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC50b2dnbGUoJ2luYmF0dGxlJywgcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicpOyBhdWRpby5zZXRNb2RlKHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2JhdHRsZScgOiAnYnVpbGQnKTtcbiAgICAvLyBvdmVybGF5XG4gICAgY29uc3Qgb3YgPSAkKCdvdmVybGF5Jyk7IG92LmNsYXNzTmFtZSA9ICcnOyBvdi5pbm5lckhUTUwgPSAnJztcbiAgICBpZiAocGggPT09ICdkcmFmdCcgJiYgZy5kcmFmdCkge1xuICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5WaWN0b3J5IERyYWZ0PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+V2F2ZSBjbGVhcmVkLiBEb21pbmlvbiBpcyBub3cgJHtzLmNhcH0uJHtnLmxhc3RHb2xkID8gYCA8YiBzdHlsZT1cImNvbG9yOiNmZmQyNGFcIj4rJHtmbXQoZy5sYXN0R29sZCl9PC9iPiAke2ljb25JbWcoJ2dvbGQnKX1gIDogJyd9IEtlZXAgb25lOjwvZGl2PjxkaXYgY2xhc3M9XCJyb3dcIj4ke2cuZHJhZnQubWFwKChzb3VsOiBTb3VsSWQsIGk6IG51bWJlcikgPT4gYDxkaXYgY2xhc3M9XCJjYXJkIGJpZyR7aGFzQXJ0KHNvdWwpID8gJyBhcnQnIDogJyd9XCIgZGF0YS1pPVwiJHtpfVwiJHtoYXNBcnQoc291bCkgPyBgIHN0eWxlPVwiYm9yZGVyLWNvbG9yOiR7cmFyaXR5Q29sb3Ioc291bCl9XCJgIDogJyd9PjxkaXYgY2xhc3M9XCJjb3N0XCI+JHtjb3N0KHNvdWwsIDEpfTwvZGl2PiR7aGFzQXJ0KHNvdWwpID8gcG9ydHJhaXRIdG1sKHNvdWwpIDogSUNPTltzb3VsXX08ZGl2IGNsYXNzPVwibm1cIj4ke1NPVUxfTkFNRVtzb3VsXX08L2Rpdj48ZGl2IGNsYXNzPVwicm9sZVwiPiR7Uk9MRV9URVhUW3NvdWxdfTwvZGl2PjwvZGl2PmApLmpvaW4oJycpfTwvZGl2PjwvZGl2PmA7XG4gICAgICBvdi5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignLmNhcmQnKS5mb3JFYWNoKChjKSA9PiAoYy5vbmNsaWNrID0gKCkgPT4gZy5waWNrRHJhZnQoK2MuZGF0YXNldC5pISkpKTtcbiAgICB9IGVsc2UgaWYgKHBoID09PSAnd29uJyB8fCBwaCA9PT0gJ2xvc3QnKSB7XG4gICAgICBjb25zdCBydyA9IHBoID09PSAnd29uJyA/IGcucmV3YXJkIDogbnVsbCwgc2sgPSAobjogbnVtYmVyKSA9PiBza3VsbEltZ3Mobik7XG4gICAgICBjb25zdCB1bmxvY2tIdG1sID0gcncgJiYgcncudW5sb2NrZWQgJiYgcncudW5sb2NrZWQubGVuZ3RoID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiM3ZWYyYzg7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdjaGVjaycpfSBVbmxvY2tlZDogJHtydy51bmxvY2tlZC5tYXAoKGs6IHN0cmluZykgPT4gZGVzY3JpYmVVbmxvY2soaykpLmpvaW4oJyBcXHUwMGI3ICcpfTwvZGl2PmAgOiAnJztcbiAgICAgIGNvbnN0IGdvbGRIdG1sID0gZy5ydW5Hb2xkID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdnb2xkJyl9IEdvbGQgZWFybmVkIHRoaXMgcnVuOiAke2ZtdChnLnJ1bkdvbGQpfTwvZGl2PmAgOiAnJztcbiAgICAgIGNvbnN0IGRyID0gcGggPT09ICd3b24nICYmIGcuZGFpbHkgPyBnLmRhaWx5UmV3YXJkIDogbnVsbDtcbiAgICAgIGNvbnN0IGRhaWx5SHRtbCA9IGcuZGFpbHkgPyAoZHIgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2RyLnBhY2sgPyBgJHtpY29uSW1nKCdzaG9wJyl9IERhaWx5IGNvbXBsZXRlISBZb3UgZWFybmVkIGEgJHtzaygxKX0gU291bCBQYWNrIGFuZCAke2ZtdChkci5nb2xkKX0gJHtpY29uSW1nKCdnb2xkJyl9LmAgOiAnRGFpbHkgY29tcGxldGUgYWdhaW4uIFRoZSByZXdhcmQgY29tZXMgb25jZSBwZXIgZGF5OiBzZWUgeW91IHRvbW9ycm93ISd9PC9kaXY+YCA6ICcnKSA6ICcnO1xuICAgICAgY29uc3QgcmV3YXJkSHRtbCA9IGdvbGRIdG1sICsgZGFpbHlIdG1sICsgdW5sb2NrSHRtbCArIChydyA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7cncucGFjayA/IChydy5maXJzdCA/IGAke2ljb25JbWcoJ3Nob3AnKX0gRmlyc3QgY2xlYXIhIFlvdSBlYXJuZWQgYSAke3NrKHJ3LnBhY2sudGllcil9IFNvdWwgUGFjay5gIDogYCR7aWNvbkltZygnc2hvcCcpfSBSZXBsYXkgcmV3YXJkOiBhICR7c2socncucGFjay50aWVyKX0gU291bCBQYWNrLmApIDogYFJlcGxheSBwcm9ncmVzcyAke3J3LnJlcGxheU1ldGVyfS8ke3J3LnJlcGxheU5lZWRlZH0gdG93YXJkIGEgU291bCBQYWNrLmB9PC9kaXY+YCA6ICcnKTtcbiAgICAgIGlmIChwaCA9PT0gJ2xvc3QnICYmIGlzRW5kbGVzcygpICYmIGcuZW5kbGVzcykgeyAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGVuZCBvZiBhbiBlbmRsZXNzIHJ1bjogaG93IGRlZXAsIGFueSByZWNvcmQsIHBhY2tzIGVhcm5lZFxuICAgICAgICBjb25zdCBlID0gZy5lbmRsZXNzLCByZWMgPSBlLmNsZWFyZWQgPiBlLnN0YXJ0QmVzdDtcbiAgICAgICAgb3YuY2xhc3NOYW1lID0gJ3Nob3cnOyBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImJveFwiPjxoMj5SdW4gb3ZlcjwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPllvdSBjbGVhcmVkICR7ZS5jbGVhcmVkfSB3YXZlJHtlLmNsZWFyZWQgPT09IDEgPyAnJyA6ICdzJ30uICR7cmVjID8gJzxiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YVwiPk5ldyBiZXN0IGRlcHRoITwvYj4nIDogJ0Jlc3Q6IHdhdmUgJyArIE1hdGgubWF4KGUuc3RhcnRCZXN0LCBlLmNsZWFyZWQpICsgJy4nfTwvZGl2PiR7Zy5ydW5Hb2xkID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtpY29uSW1nKCdnb2xkJyl9IEdvbGQgZWFybmVkIHRoaXMgcnVuOiAke2ZtdChnLnJ1bkdvbGQpfTwvZGl2PmAgOiAnJ30ke2UucGFja3MgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ3Nob3AnKX0gJHtlLnBhY2tzfSBTb3VsIFBhY2ske2UucGFja3MgPT09IDEgPyAnJyA6ICdzJ30gZWFybmVkIHRoaXMgcnVuLjwvZGl2PmAgOiAnPGRpdiBjbGFzcz1cInN1YlwiPkNsZWFyIHdhdmUgMTAgdG8gZWFybiBhIFNvdWwgUGFjay48L2Rpdj4nfTxkaXYgY2xhc3M9XCJyb3dcIj4ke2UucGFja3MgPyAnPGJ1dHRvbiBpZD1cInRvU2hvcFwiIGNsYXNzPVwiZ29cIj5PcGVuIHBhY2s8L2J1dHRvbj4nIDogJyd9PGJ1dHRvbiBpZD1cImFnYWluXCIgY2xhc3M9XCIke2UucGFja3MgPyAnYmx1ZScgOiAnZ28nfVwiPkdvIGFnYWluPC9idXR0b24+PGJ1dHRvbiBpZD1cInRvSG9tZVwiIGNsYXNzPVwiYmx1ZVwiPkhvbWU8L2J1dHRvbj48L2Rpdj48L2Rpdj5gO1xuICAgICAgICAkKCdhZ2FpbicpLm9uY2xpY2sgPSAoKSA9PiBnLm5ld0VuZGxlc3MoKTsgJCgndG9Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAgICAgY29uc3QgdHMyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvU2hvcCcpOyBpZiAodHMyKSB0czIub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28tc2hvcCcpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPiR7Zy5kYWlseSA/IChwaCA9PT0gJ3dvbicgPyAnRGFpbHkgY29tcGxldGUhJyA6ICdDaGFsbGVuZ2UgZmFpbGVkJykgOiBwaCA9PT0gJ3dvbicgPyAnU3RhZ2UgY2xlYXJlZCEnIDogJ1N0YWdlIGxvc3QnfTwvaDI+PGRpdiBjbGFzcz1cInN1YlwiPiR7Zy5sYXN0QmF0dGxlfTwvZGl2PiR7cmV3YXJkSHRtbH08ZGl2IGNsYXNzPVwicm93XCI+JHsocncgJiYgcncucGFjaykgfHwgKGRyICYmIGRyLnBhY2spID8gJzxidXR0b24gaWQ9XCJ0b1Nob3BcIiBjbGFzcz1cImdvXCI+T3BlbiBwYWNrPC9idXR0b24+JyA6ICcnfTxidXR0b24gaWQ9XCJhZ2FpblwiIGNsYXNzPVwiJHsocncgJiYgcncucGFjaykgfHwgKGRyICYmIGRyLnBhY2spID8gJ2JsdWUnIDogJ2dvJ31cIj4ke3BoID09PSAnd29uJyA/ICdQbGF5IGFnYWluJyA6ICdUcnkgYWdhaW4nfTwvYnV0dG9uPjxidXR0b24gaWQ9XCJ0b0hvbWVcIiBjbGFzcz1cImJsdWVcIj5Ib21lPC9idXR0b24+PC9kaXY+PC9kaXY+YDtcbiAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IChnLmRhaWx5ID8gZy5uZXdEYWlseSgpIDogZy5uZXdSdW4oKSk7ICQoJ3RvSG9tZScpLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLWhvbWUnKSk7XG4gICAgICBjb25zdCB0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b1Nob3AnKTsgaWYgKHRzKSB0cy5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zaG9wJykpO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnJlbmRlckRlYnVnTGl2ZSgpO1xuICAgIGlmIChwaCA9PT0gJ2J1aWxkJykgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IGcucmVmcmFtZUJ1aWxkKCkpOyAgICAgLy8gYWZ0ZXIgbGF5b3V0OiBrZWVwIHRoZSBncmlkIGNsZWFyIG9mIHRoZSBoYW5kIGFuZCBidXR0b25zXG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgcGFuZWxcbiAgcHJpdmF0ZSByZW5kZXJEZWJ1ZygpIHtcbiAgICBjb25zdCBnID0gdGhpcy5nLCBkID0gdGhpcy5kYmc7IGlmICghZC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSkgeyBkLmlubmVySFRNTCA9ICcnOyByZXR1cm47IH1cbiAgICBjb25zdCByb3cgPSAobGFiZWw6IHN0cmluZywgb2JqOiBhbnksIGtleTogc3RyaW5nIHwgbnVtYmVyLCBtaW46IG51bWJlciwgbWF4OiBudW1iZXIsIHN0ZXA6IG51bWJlcikgPT4gYDxsYWJlbD4ke2xhYmVsfSA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiJHttaW59XCIgbWF4PVwiJHttYXh9XCIgc3RlcD1cIiR7c3RlcH1cIiB2YWx1ZT1cIiR7b2JqW2tleV19XCIgZGF0YS1vPVwiJHtsYWJlbH1cIj48c3Bhbj4ke29ialtrZXldfTwvc3Bhbj48L2xhYmVsPmA7XG4gICAgZC5pbm5lckhUTUwgPSBgPGI+RGVidWcgKGxpdmUpPC9iPiA8c3BhbiBpZD1cImRiZ2Zwc1wiPjwvc3Bhbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+U3RhciBtdWx0aXBsaWVycyAoYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHkpXG4gICAgICAgICR7cm93KCdIUCB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDEsIDEsIDQsIDAuMDUpfSR7cm93KCdIUCB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuaHAsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdEYW1hZ2UgeCAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLmRtZywgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAyLCAxLCA2LCAwLjA1KX0ke3JvdygnU2l6ZSAyXHUyNjA1JywgQkFMQU5DRS5zdGFyLnNjYWxlLCAxLCAxLCAxLjYsIDAuMDIpfSR7cm93KCdTaXplIDNcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDIsIDEsIDIsIDAuMDIpfTwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48dGFibGU+PHRyPjx0aD48L3RoPjx0aD5ocDwvdGg+PHRoPmRtZzwvdGg+PHRoPnJhdGU8L3RoPjx0aD5yYW5nZTwvdGg+PHRoPnNwZDwvdGg+PC90cj4ke1NPVUxTLm1hcCgoaykgPT4gYDx0cj48dGQ+JHtJQ09OW2tdfTwvdGQ+JHtbJ2hwJywgJ2RtZycsICdpbnRlcnZhbCcsICdyYW5nZScsICdzcGVlZCddLm1hcCgoZikgPT4gYDx0ZD48aW5wdXQgY2xhc3M9XCJudW1cIiBkYXRhLXNvdWw9XCIke2t9XCIgZGF0YS1mPVwiJHtmfVwiIHZhbHVlPVwiJHsoQkFMQU5DRS5zdGF0cyBhcyBhbnkpW2tdW2ZdfVwiPjwvdGQ+YCkuam9pbignJyl9PC90cj5gKS5qb2luKCcnKX08L3RhYmxlPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5EaWZmaWN1bHR5IDxzZWxlY3QgaWQ9XCJkRGlmZlwiPiR7WydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCIgJHtnLmRpZmZpY3VsdHkgPT09IGsgPyAnc2VsZWN0ZWQnIDogJyd9PiR7a308L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPHNtYWxsPihhcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZSk8L3NtYWxsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZE1lcmdlSGFuZFwiICR7Zy5zLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJyA/ICdjaGVja2VkJyA6ICcnfT4gTWVyZ2UgYSBoYW5kIGNhcmQgc3RyYWlnaHQgaW50byBhIGRlcGxveWVkIHVuaXQgKG9mZiA9IGRvYyBydWxlOiBib3RoIGNvcGllcyBtdXN0IGJlIG9uIHRoZSBib2FyZCk8L2xhYmVsPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5QZXJmb3JtYW5jZTxicj48c21hbGwgaWQ9XCJkYmdQZXJmXCI+bWVhc3VyaW5nXHUyMDI2PC9zbWFsbD48YnI+PGxhYmVsPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImRGcHNcIiAke2cuc2hvd0ZwcyA/ICdjaGVja2VkJyA6ICcnfT4gU2hvdyBGUFMgb24gdGhlIGJhdHRsZSBzY3JlZW48L2xhYmVsPiA8YnV0dG9uIGlkPVwiZFBlcmZcIj5Db3B5IHBlcmYgcmVwb3J0PC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxidXR0b24gaWQ9XCJkT2Rkc1wiPlRlc3Qgb2RkcyAoMjAwIGZpZ2h0cyk8L2J1dHRvbj4gPHNwYW4gaWQ9XCJkT2Rkc091dFwiPiR7dGhpcy5vZGRzfTwvc3Bhbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRDb3B5XCI+Q29weSByZXBvcnQ8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXNldFwiPlJlc2V0IGJhbGFuY2U8L2J1dHRvbj4gPGJ1dHRvbiBpZD1cImRSZXN0YXJ0XCI+UmVzdGFydCBzdGFnZTwvYnV0dG9uPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5BZGQgY2FyZCA8c2VsZWN0IGlkPVwiZENhcmRcIj4ke1NPVUxTLm1hcCgoaykgPT4gYDxvcHRpb24gdmFsdWU9XCIke2t9XCI+JHtTT1VMX05BTUVba119PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+IDxidXR0b24gaWQ9XCJkQWRkXCI+KzwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZERvbVwiPisyIERvbWluaW9uPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5MYXN0IHRhcDogPHNwYW4gaWQ9XCJkYmd0YXBcIj4ke2cubGFzdFRhcEluZm99PC9zcGFuPjwvc21hbGw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxzbWFsbD5TZWVkICR7Zy5zZWVkfS4gQWRkIDxjb2RlPj9zZWVkPTc8L2NvZGU+IHRvIHRoZSBsaW5rIHRvIHJlcGxheSB0aGUgc2FtZSBkcmF3cy48L3NtYWxsPjwvZGl2PmA7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dFt0eXBlPXJhbmdlXScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmlucHV0ID0gKCkgPT4ge1xuICAgICAgY29uc3QgbGFiID0gaW5wLmRhdGFzZXQubyE7IGNvbnN0IHYgPSAraW5wLnZhbHVlOyAoaW5wLm5leHRFbGVtZW50U2libGluZyBhcyBIVE1MRWxlbWVudCkudGV4dENvbnRlbnQgPSBTdHJpbmcodik7XG4gICAgICBjb25zdCBzZXQ6IFJlY29yZDxzdHJpbmcsICgpID0+IHZvaWQ+ID0geyAnSFAgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsxXSA9IHYpLCAnSFAgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5ocFsyXSA9IHYpLCAnRGFtYWdlIHggMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuZG1nWzFdID0gdiksICdEYW1hZ2UgeCAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMl0gPSB2KSwgJ1NpemUgMlx1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMV0gPSB2KSwgJ1NpemUgM1x1MjYwNSc6ICgpID0+IChCQUxBTkNFLnN0YXIuc2NhbGVbMl0gPSB2KSB9O1xuICAgICAgc2V0W2xhYl0oKTsgZy5hcHBseUJhbGFuY2VDaGFuZ2UoKTtcbiAgICB9KSk7XG4gICAgZC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dC5udW0nKS5mb3JFYWNoKChpbnApID0+IChpbnAub25jaGFuZ2UgPSAoKSA9PiB7IChCQUxBTkNFLnN0YXRzIGFzIGFueSlbaW5wLmRhdGFzZXQuc291bCFdW2lucC5kYXRhc2V0LmYhXSA9ICtpbnAudmFsdWU7IH0pKTtcbiAgICAkKCdkRGlmZicpLm9uY2hhbmdlID0gKGUpID0+IGcuY2hhbmdlRGlmZmljdWx0eSgoZS50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlKTtcbiAgICAkKCdkTWVyZ2VIYW5kJykub25jaGFuZ2UgPSAoZSkgPT4geyBnLnMucnVsZXMubWVyZ2UgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZCA/ICdoYW5kSW50b09uZVN0YXInIDogJ2RlcGxveWVkT25seSc7IGcuc3luY0J1aWxkKCk7IHRoaXMucmVuZGVyKCk7IH07XG4gICAgJCgnZE9kZHMnKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCByID0gZy50ZXN0T2RkcygyMDApOyB0aGlzLm9kZHMgPSBgJHtyLndpbn0lIHdpbiAoJHtyLm59IGZpZ2h0cywgYXZnICR7ci5hdmdUaW1lfXMpIHZzIHdhdmUgJHtnLnMud2F2ZX1gOyAkKCdkT2Rkc091dCcpLnRleHRDb250ZW50ID0gdGhpcy5vZGRzOyB9O1xuICAgICQoJ2RDb3B5Jykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucmVwb3J0KCk7IChuYXZpZ2F0b3IuY2xpcGJvYXJkID8gbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCkgOiBQcm9taXNlLnJlamVjdCgpKS50aGVuKCgpID0+IHRoaXMudG9hc3QoJ1JlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RGcHMnKS5vbmNoYW5nZSA9IChlKSA9PiBnLnNldFNob3dGcHMoKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmNoZWNrZWQpO1xuICAgICQoJ2RQZXJmJykub25jbGljayA9ICgpID0+IHsgY29uc3QgdCA9IGcucGVyZlJlcG9ydCgpOyAobmF2aWdhdG9yLmNsaXBib2FyZCA/IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpIDogUHJvbWlzZS5yZWplY3QoKSkudGhlbigoKSA9PiB0aGlzLnRvYXN0KCdQZXJmIHJlcG9ydCBjb3BpZWQuIFBhc3RlIGl0IGludG8gY2hhdC4nKSkuY2F0Y2goKCkgPT4geyBwcm9tcHQoJ0NvcHkgdGhpcyByZXBvcnQ6JywgdCk7IH0pOyB9O1xuICAgICQoJ2RSZXNldCcpLm9uY2xpY2sgPSAoKSA9PiB7IGcucmVzZXRCYWxhbmNlQWxsKCk7IHRoaXMucmVuZGVyRGVidWcoKTsgfTtcbiAgICAkKCdkUmVzdGFydCcpLm9uY2xpY2sgPSAoKSA9PiBnLnN0YXJ0U3RhZ2UoZy5zZWVkKTtcbiAgICAkKCdkQWRkJykub25jbGljayA9ICgpID0+IGcuYWRkQ2FyZCgoJCgnZENhcmQnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUgYXMgU291bElkKTsgJCgnZERvbScpLm9uY2xpY2sgPSAoKSA9PiBnLmFkZERvbWluaW9uKDIpO1xuICB9XG4gIHJlbmRlckRlYnVnTGl2ZSgpIHtcbiAgICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ2ZwcycpOyBpZiAoZikgZi50ZXh0Q29udGVudCA9IGAke3RoaXMuZy5waGFzZX1gO1xuICAgIGNvbnN0IHBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ1BlcmYnKTsgaWYgKHBmKSB7IGNvbnN0IHAgPSB0aGlzLmcucGVyZkluZm8oKTsgcGYudGV4dENvbnRlbnQgPSBgJHtwLmZwcy50b0ZpeGVkKDApfSBmcHMgXHUwMEI3IGF2ZyAke3AuYXZnLnRvRml4ZWQoMSl9bXMgXHUwMEI3IHNsb3c1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMgXHUwMEI3IHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIFx1MDBCNyAke3AubWVzaGVzfSBtZXNoZXMgXHUwMEI3ICR7cC5wYXJ0aWNsZXN9IHBhcnRpY2xlIHN5c3RlbXMgXHUwMEI3ICR7cC5kcmF3c30gZHJhdyBjYWxsc2A7IH1cbiAgICBjb25zdCB0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RiZ3RhcCcpOyBpZiAodCkgdC50ZXh0Q29udGVudCA9IHRoaXMuZy5sYXN0VGFwSW5mbztcbiAgfVxufVxuIiwgIi8vIFRoZSBwbGF5YWJsZSBwcm90b3R5cGU6IGJ1aWxkIHNjcmVlbiAtPiBiYXR0bGUgLT4gZHJhZnQgLT4gbmV4dCB3YXZlLCBidWlsdCBvbiB0aGUgdGVzdGVkIHJ1bGVzICsgYmF0dGxlIGVuZ2luZS5cbmRlY2xhcmUgY29uc3QgQkFCWUxPTjogYW55O1xuaW1wb3J0IHsgQkFMQU5DRSwgcmVzZXRCYWxhbmNlLCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgR1JJRF9DRUxMUywgR1JJRF9DT0xTLCBHUklEX1JPV1MsIFNPVUxTIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7XG4gIGFkdmFuY2VXYXZlLCBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNlbGxGcmVlLCBjb3N0LCBkaXNjYXJkUmVkcmF3LCBkaXNtaXNzLCBkb21pbmlvbkZyZWUsIGRvbWluaW9uVXNlZCwgZHJhZnRPcHRpb25zLCBmYWlsV2F2ZSxcbiAgbWVyZ2VEZXBsb3llZCwgbWVyZ2VGcm9tSGFuZCwgbW92ZVVuaXQsIG5ld1N0YWdlLCBub3JtYWxEcmF3LCBzdGFnZVdhdmVzLCBzdW1tb24sIHN3YXBTZWxsLCB0YWtlRHJhZnQsXG59IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdGF0ZSB9IGZyb20gJy4uL2NvcmUvcnVsZXMudHMnO1xuaW1wb3J0IHsgYnVpbGRBcmVuYSB9IGZyb20gJy4vYXJlbmEudHMnO1xuaW1wb3J0IHsgQmF0dGxlLCBjZWxsUG9zLCBGUk9OVF9YLCBHUklEX1NQLCBzaW11bGF0ZSB9IGZyb20gJy4uL2NvcmUvYmF0dGxlLnRzJztcbmltcG9ydCB0eXBlIHsgQkV2ZW50IH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHsgY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lLCBlbmVteVBvd2VyLCBlbmVteVdhdmUsIGlzRW5kbGVzcywgc2V0RGlmZmljdWx0eSwgc2V0RW5kbGVzcywgc2V0U3RhZ2VEaWZmaWN1bHR5LCBzZXREYWlseSB9IGZyb20gJy4uL2NvcmUvd2F2ZXMudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19JRCwgRU5ETEVTU19QQUNLX0VWRVJZIH0gZnJvbSAnLi4vY29yZS9lbmRsZXNzLnRzJztcbmltcG9ydCB7IERBSUxZX0lELCBkYWlseVJ1bGVzLCBkYXlOdW1iZXIsIGlzVmFsaWREYXksIG1vZGlmaWVyRm9yIH0gZnJvbSAnLi4vY29yZS9kYWlseS50cyc7XG5pbXBvcnQgdHlwZSB7IERhaWx5TW9kIH0gZnJvbSAnLi4vY29yZS9kYWlseS50cyc7XG5pbXBvcnQgeyBFTkRMRVNTX1JVTEVTLCBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuLi9jb3JlL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgeyBsb2FkU2F2ZSB9IGZyb20gJy4uL2NvcmUvc2F2ZS50cyc7XG5pbXBvcnQgeyBlbmRsZXNzVW5sb2NrZWQgfSBmcm9tICcuLi9jb3JlL3Byb2dyZXNzLnRzJztcbmltcG9ydCB7IE5lY3JvbWFuY2VyIH0gZnJvbSAnLi9uZWNyb21hbmNlci50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgY2xlYXJSdW4sIGxvYWRSdW4sIHNhdmVSdW4sIHNlcmlhbGl6ZVN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB7IGFkZEdvbGRBbmRTYXZlLCBlbmRsZXNzV2F2ZUdvbGQsIHBsYXlhYmxlLCByZWNvcmRDbGVhckFuZFNhdmUsIHJlY29yZERhaWx5V2luQW5kU2F2ZSwgcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlLCB3YXZlR29sZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBEYWlseVJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBDbGVhclJld2FyZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSdW5TbmFwc2hvdCB9IGZyb20gJy4uL2NvcmUvcnVuc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBjcmVhdGVWaXN1YWwsIGlzVHJpcG8sIGxvYWRBc3NldHMgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHR5cGUgeyBBc3NldHMsIFVuaXRWaXN1YWwgfSBmcm9tICcuL3Zpc3VhbHMudHMnO1xuaW1wb3J0IHsgVWkgfSBmcm9tICcuL3VpLnRzJztcblxuZXhwb3J0IHR5cGUgUGhhc2UgPSAnYnVpbGQnIHwgJ3RyYW5zaXRpb24nIHwgJ2JhdHRsZScgfCAnZHJhZnQnIHwgJ3dvbicgfCAnbG9zdCc7XG50eXBlIFNlbCA9IHsgdHlwZTogJ2NhcmQnOyBpZHg6IG51bWJlciB9IHwgeyB0eXBlOiAndW5pdCc7IGlkOiBudW1iZXIgfSB8IG51bGw7XG5cbmV4cG9ydCBjbGFzcyBHYW1lIHtcbiAgZW5naW5lOiBhbnk7IHNjZW5lOiBhbnk7IGNhbWVyYTogYW55OyBBITogQXNzZXRzOyB1aSE6IFVpO1xuICBkYWlseTogeyBkYXk6IG51bWJlcjsgbW9kOiBEYWlseU1vZCB9IHwgbnVsbCA9IG51bGw7IGRhaWx5UmV3YXJkOiBEYWlseVJld2FyZCB8IG51bGwgPSBudWxsOyAgIC8vIHRoZSBEYWlseSBDaGFsbGVuZ2UgcnVuIGluIHByb2dyZXNzLCBhbmQgd2hhdCBpdHMgd2luIHBhaWRcbiAgbGFzdEdvbGQgPSAwOyBydW5Hb2xkID0gMDsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZ29sZCBmcm9tIHRoZSB3YXZlIGp1c3QgY2xlYXJlZCwgYW5kIGZyb20gdGhpcyB3aG9sZSBydW5cbiAgcyE6IFN0YXRlOyBzZWVkID0gMTsgYXR0ZW1wdCA9IDA7IHBoYXNlOiBQaGFzZSA9ICdidWlsZCc7IGJhdHRsZTogQmF0dGxlIHwgbnVsbCA9IG51bGw7IHRpbWVTY2FsZSA9IDE7XG4gIHNlbDogU2VsID0gbnVsbDsgc3dhcE1vZGUgPSBmYWxzZTsgY29uZmlybVJlbW92ZSA9IGZhbHNlOyBkcmFmdDogU291bElkW10gfCBudWxsID0gbnVsbDsgbGFzdEJhdHRsZSA9ICcnO1xuICBwcml2YXRlIHVuaXRWaXMgPSBuZXcgTWFwPG51bWJlciwgVW5pdFZpc3VhbD4oKTsgICAgICAgIC8vIHVuaXQgaWQgLT4gdmlzdWFsICh5b3VyIGFybXksIHBlcnNpc3RzIGJldHdlZW4gd2F2ZXMpXG4gIHByaXZhdGUgdmlzVG9Vbml0ID0gbmV3IE1hcDxVbml0VmlzdWFsLCBudW1iZXI+KCk7XG4gIHByaXZhdGUgZnZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB2aXN1YWwgZHVyaW5nIGEgYmF0dGxlXG4gIHByaXZhdGUgZlVuaXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpOyAgICAgICAgICAgICAgLy8gZmlnaHRlciBpZCAtPiB1bml0IGlkIChwbGF5ZXIgc2lkZSlcbiAgcHJpdmF0ZSBsYXN0U3RhdGUgPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpO1xuICBwcml2YXRlIGFyZW5hITogeyB1cGRhdGUodDogbnVtYmVyKTogdm9pZDsgc2V0VGhlbWUoc3RhZ2U6IHN0cmluZyk6IHZvaWQgfTtcbiAgcHJpdmF0ZSB0aWxlczogYW55W10gPSBbXTsgcHJpdmF0ZSB0aWxlTWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSByaW5nRng6IGFueVtdID0gW107IHByaXZhdGUgYXJyb3dzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbWVyczogeyB0OiBudW1iZXI7IGZuOiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIGFjYyA9IDA7IHByaXZhdGUgY2FtRnJvbTogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBjYW1UID0gMTsgcHJpdmF0ZSBjYW1EdXIgPSAyLjA7IHByaXZhdGUgcmVzdWx0QXQgPSAtMTsgcHJpdmF0ZSBoYW5kbGVkID0gZmFsc2U7IHByaXZhdGUgc3RhcnRTdGVwQXQgPSAwO1xuICBwcml2YXRlIGFycm93TWF0czogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd01lc2g6IGFueVtdID0gW107XG4gIG5lY3JvITogTmVjcm9tYW5jZXI7XG4gIC8qKiBXaGF0IHRoZSBsYXN0IHN0YWdlIGNsZWFyIGVhcm5lZCAoc2hvd24gb24gdGhlIHN0YWdlLWNsZWFyZWQgc2NyZWVuKS4gKi9cbiAgcmV3YXJkOiBDbGVhclJld2FyZCB8IG51bGwgPSBudWxsO1xuICAvKiogVGhlIGVuZGxlc3MgcnVuIGluIHByb2dyZXNzOiB0aGUgYmVzdCBkZXB0aCB3aGVuIGl0IGJlZ2FuICh0byBzcG90IGEgbmV3IHJlY29yZCksIHRoZSB3YXZlcyBjbGVhcmVkIHNvIGZhciwgYW5kIHRoZSBwYWNrcyBlYXJuZWQuICovXG4gIGVuZGxlc3M6IHsgc3RhcnRCZXN0OiBudW1iZXI7IGNsZWFyZWQ6IG51bWJlcjsgcGFja3M6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2luZSA9IGZhbHNlOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYSByZXN1bHQgY3V0c2NlbmUgaXMgcGxheWluZzogdGhlIGJhdHRsZSBjYW1lcmEgYW5kIGZpZ2h0ZXIgc3luYyBzdGFuZCBkb3duXG4gIHByaXZhdGUgdHdlZW5zOiB7IHQ6IG51bWJlcjsgZHVyOiBudW1iZXI7IGZuOiAodTogbnVtYmVyKSA9PiB2b2lkOyBkb25lPzogKCkgPT4gdm9pZCB9W10gPSBbXTtcbiAgcHJpdmF0ZSB0d2VlbihkdXI6IG51bWJlciwgZm46ICh1OiBudW1iZXIpID0+IHZvaWQsIGRvbmU/OiAoKSA9PiB2b2lkKSB7IHRoaXMudHdlZW5zLnB1c2goeyB0OiAwLCBkdXIsIGZuLCBkb25lIH0pOyB9XG4gIC8qKiBGaW5pc2ggZXZlcnkgcnVubmluZyBhbmltYXRpb24gYXQgb25jZSAoc28gbm90aGluZyBpcyBsZWZ0IGhhbGYtd2F5IG9yIHVuZGlzcG9zZWQgd2hlbiB0aGUgcGhhc2UgY2hhbmdlcykuICovXG4gIHByaXZhdGUgZmx1c2hUd2VlbnMoKSB7IGZvciAoY29uc3QgdyBvZiB0aGlzLnR3ZWVucy5zcGxpY2UoMCkpIHsgdy5mbigxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICBwcml2YXRlIHNlZW5NZXJnZXMgPSAwO1xuXG4gIGFzeW5jIGluaXQoY2FudmFzOiBIVE1MQ2FudmFzRWxlbWVudCkge1xuICAgIGNvbnN0IHFzID0gbmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpO1xuICAgIHRoaXMuZW5naW5lID0gbmV3IEJBQllMT04uRW5naW5lKGNhbnZhcywgdHJ1ZSwgeyBhbnRpYWxpYXM6IHRydWUsIHBvd2VyUHJlZmVyZW5jZTogJ2hpZ2gtcGVyZm9ybWFuY2UnIH0pO1xuICAgIGNvbnN0IGRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7IHRoaXMuZW5naW5lLnNldEhhcmR3YXJlU2NhbGluZ0xldmVsKDEgLyBNYXRoLm1pbihkcHIsIDEuNSkpO1xuICAgIGNvbnN0IHNjZW5lID0gdGhpcy5zY2VuZSA9IG5ldyBCQUJZTE9OLlNjZW5lKHRoaXMuZW5naW5lKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjA5LCAwLjA3LCAwLjEzLCAxKTtcbiAgICBjb25zdCBoZW1pID0gbmV3IEJBQllMT04uSGVtaXNwaGVyaWNMaWdodCgnaCcsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAxLCAwLjMpLCBzY2VuZSk7IGhlbWkuaW50ZW5zaXR5ID0gMS4wNTsgaGVtaS5ncm91bmRDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjMyLCAwLjI2LCAwLjQyKTtcbiAgICBjb25zdCBzdW4gPSBuZXcgQkFCWUxPTi5EaXJlY3Rpb25hbExpZ2h0KCdzJywgbmV3IEJBQllMT04uVmVjdG9yMygtMC40LCAtMSwgMC41NSksIHNjZW5lKTsgc3VuLmludGVuc2l0eSA9IDAuODU7XG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgQkFCWUxPTi5GcmVlQ2FtZXJhKCdjYW0nLCBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDgsIC05KSwgc2NlbmUpOyB0aGlzLmNhbWVyYS5taW5aID0gMC4xOyB0aGlzLmNhbWVyYS5tYXhaID0gMjAwOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg7IHRoaXMuY2FtZXJhLmlucHV0cy5jbGVhcigpO1xuXG4gICAgY29uc3QgZ3JvdW5kID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ2dyb3VuZCcsIHsgd2lkdGg6IDYwLCBoZWlnaHQ6IDQwIH0sIHNjZW5lKTtcbiAgICBncm91bmQuaXNQaWNrYWJsZSA9IGZhbHNlOyBjb25zdCBhcmVuYSA9IHRoaXMuYXJlbmEgPSBidWlsZEFyZW5hKHNjZW5lLCBncm91bmQpOyBzY2VuZS5vbkJlZm9yZVJlbmRlck9ic2VydmFibGUuYWRkKCgpID0+IGFyZW5hLnVwZGF0ZShwZXJmb3JtYW5jZS5ub3coKSAvIDEwMDApKTtcbiAgICBmb3IgKGNvbnN0IHRlYW0gb2YgWzAsIDFdIGFzIGNvbnN0KSBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBjb25zdCB0ID0gdGhpcy5tYWtlVGlsZSh0ZWFtLCBjKTsgaWYgKHRlYW0gPT09IDApIHRoaXMudGlsZXMucHVzaCh0KTsgZWxzZSB0LnNldEVuYWJsZWQoZmFsc2UpOyB9XG5cbiAgICB0aGlzLkEgPSBhd2FpdCBsb2FkQXNzZXRzKHNjZW5lKTtcbiAgICB0aGlzLm5lY3JvID0gbmV3IE5lY3JvbWFuY2VyKHNjZW5lLCB0aGlzLkEuc29mdCwgdGhpcy5BLm5lY3JvKTsgICAgICAgLy8gc3RhbmRzIGp1c3QgYmVoaW5kIGhpcyBhcm15J3MgYmFjayBjb2x1bW4sIGZhY2luZyB0aGUgYmF0dGxlZmllbGRcbiAgICB0aGlzLm5lY3JvLmhvbGRlci5wb3NpdGlvbi5zZXQoLShGUk9OVF9YICsgKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCkgLSAxLjA1LCAwLCAwKTsgdGhpcy5uZWNyby5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyO1xuICAgIHRoaXMuYXJyb3dNYXRzID0gWzAsIDFdLm1hcCgodCkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnYW0nICsgdCwgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IHQgPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC43NSwgMC4zLCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjcsIDAuMjUpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHJldHVybiBtOyB9KTtcbiAgICB0aGlzLnVpID0gbmV3IFVpKHRoaXMpOyB0aGlzLnNlZWQgPSArKHFzLmdldCgnc2VlZCcpIHx8IDEpOyBpZiAocXMuZ2V0KCdmcHMnKSkgdGhpcy5zZXRTaG93RnBzKHRydWUpO1xuXG4gICAgLy8gVGFwcyBhcmUgZGV0ZWN0ZWQgaGVyZSAobm90IHRocm91Z2ggQmFieWxvbikgc28gdGhleSBiZWhhdmUgdGhlIHNhbWUgaW4gU2FmYXJpLCB0aGUgaG9tZS1zY3JlZW4gYXBwIGFuZCBvbiBkZXNrdG9wLlxuICAgIGxldCBkb3duOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB0OiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xuICAgIGNvbnN0IGxvY2FsID0gKGU6IFBvaW50ZXJFdmVudCkgPT4geyBjb25zdCByID0gY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpOyByZXR1cm4geyB4OiBlLmNsaWVudFggLSByLmxlZnQsIHk6IGUuY2xpZW50WSAtIHIudG9wIH07IH07XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJkb3duJywgKGUpID0+IHsgZG93biA9IHsgLi4ubG9jYWwoZSksIHQ6IHBlcmZvcm1hbmNlLm5vdygpIH07IH0pO1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCdwb2ludGVydXAnLCAoZSkgPT4geyBpZiAoIWRvd24pIHJldHVybjsgY29uc3QgcCA9IGxvY2FsKGUpOyBjb25zdCBtb3ZlZCA9IE1hdGguaHlwb3QocC54IC0gZG93bi54LCBwLnkgLSBkb3duLnkpLCBkdCA9IHBlcmZvcm1hbmNlLm5vdygpIC0gZG93bi50OyBkb3duID0gbnVsbDsgaWYgKG1vdmVkIDwgMTYgJiYgZHQgPCA5MDApIHRoaXMudGFwKHAueCwgcC55KTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJjYW5jZWwnLCAoKSA9PiB7IGRvd24gPSBudWxsOyB9KTtcbiAgICB0aGlzLmNhbnZhcyA9IGNhbnZhczsgY29uc3Qgb25SZXNpemUgPSAoKSA9PiB0aGlzLmhhbmRsZVJlc2l6ZSgpO1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBvblJlc2l6ZSk7IHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdvcmllbnRhdGlvbmNoYW5nZScsICgpID0+IHNldFRpbWVvdXQob25SZXNpemUsIDI1MCkpO1xuICAgIGlmICgod2luZG93IGFzIGFueSkudmlzdWFsVmlld3BvcnQpICh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydC5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBvblJlc2l6ZSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS5SZXNpemVPYnNlcnZlcikgbmV3ICh3aW5kb3cgYXMgYW55KS5SZXNpemVPYnNlcnZlcihvblJlc2l6ZSkub2JzZXJ2ZShjYW52YXMpO1xuICAgIGlmIChxcy5nZXQoJ2dhbGxlcnknKSkgeyB0aGlzLmdhbGxlcnkoKTsgcmV0dXJuOyB9XG4gICAgY29uc3Qgc2F2ZWQgPSBxcy5nZXQoJ3NlZWQnKSA/IG51bGwgOiBsb2FkUnVuKCk7ICAgICAgICAgICAgICAgIC8vID9zZWVkPU4gYWx3YXlzIHN0YXJ0cyBmcmVzaCAoZGVidWdnaW5nKTsgb3RoZXJ3aXNlIHBpY2sgdXAgd2hlcmUgdGhlIGxhc3QgdmlzaXQgbGVmdCBvZmZcbiAgICBpZiAoc2F2ZWQpIHRoaXMucmVzdG9yZShzYXZlZCk7IGVsc2UgdGhpcy5zdGFydFN0YWdlKHRoaXMuc2VlZCk7XG4gICAgbGV0IGxhc3QgPSBwZXJmb3JtYW5jZS5ub3coKTtcbiAgICB0aGlzLmVuZ2luZS5ydW5SZW5kZXJMb29wKCgpID0+IHsgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCksIHJhdyA9IG5vdyAtIGxhc3Q7IGNvbnN0IGR0ID0gTWF0aC5taW4oMC4wNSwgcmF3IC8gMTAwMCk7IGxhc3QgPSBub3c7IGlmICghdGhpcy5hY3RpdmUpIHJldHVybjsgaWYgKCF0aGlzLmZyb3plbikgdGhpcy5mcmFtZShkdCk7IHNjZW5lLnJlbmRlcigpOyB0aGlzLnBlcmZUaWNrKHJhdyk7IH0pO1xuICB9XG4gIC8qKiBUaGUgbmF2aWdhdGlvbiBzaGVsbCBoaWRlcyB0aGUgYmF0dGxlIHNjcmVlbiB3aGlsZSBhbm90aGVyIHRhYiBpcyBvcGVuOiBwYXVzZSB0aGUgZ2FtZSBzbyBpdCBjb3N0cyBub3RoaW5nLiAqL1xuICBwcml2YXRlIGFjdGl2ZSA9IHRydWU7XG4gIC8qKiBEZWJ1Zzoga2VlcCBkcmF3aW5nIGJ1dCBzdG9wIGFkdmFuY2luZyB0aW1lLCBzbyBhIG1vbWVudCBjYW4gYmUgc3RlcHBlZCB0aHJvdWdoIHdpdGggZnJhbWUoZHQpIGFuZCBzY3JlZW5zaG90dGVkLiAqL1xuICBmcm96ZW4gPSBmYWxzZTtcbiAgc3RlcChkdDogbnVtYmVyKSB7IHRoaXMuZnJhbWUoZHQpOyB9XG4gIHNldEFjdGl2ZShvbjogYm9vbGVhbikgeyB0aGlzLmFjdGl2ZSA9IG9uOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2NlbmUgaGVscGVyc1xuICAvKiogVGhlIHBsYWNlbWVudCBncmlkIGlzIGEgYnVpbGQtc2NyZWVuIHRvb2w6IGhpZGUgaXQgZHVyaW5nIHRoZSBmaWdodCBzbyB0aGUgYmF0dGxlIGxvb2tzIGxpa2UgYSBzY2VuZSwgbm90IGEgYm9hcmQuICovXG4gIHByaXZhdGUgc2hvd0dyaWQob246IGJvb2xlYW4pIHsgZm9yIChjb25zdCB0IG9mIHRoaXMudGlsZXMpIHQuc2V0RW5hYmxlZChvbik7IH1cbiAgcHJpdmF0ZSBtYWtlVGlsZSh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IGNlbGxQb3ModGVhbSwgY2VsbCksIHQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCd0aWxlJyArIGNlbGwsIHsgc2l6ZTogR1JJRF9TUCAqIDAuOTIgfSwgdGhpcy5zY2VuZSk7XG4gICAgdC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHQucG9zaXRpb24uc2V0KHAueCwgMC4wMTUsIHAueik7XG4gICAgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3RtJywgdGhpcy5zY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjE4LCAwLjEyLCAwLjQyKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQyLCAwLjEyLCAwLjEyKTsgbS5hbHBoYSA9IDAuNTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB0Lm1hdGVyaWFsID0gbTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyB0Lm1ldGFkYXRhID0geyBraW5kOiAndGlsZScsIGNlbGwgfTsgdGhpcy50aWxlTWF0c1tjZWxsXSA9IG07IH0gZWxzZSB0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICByZXR1cm4gdDtcbiAgfVxuICBwcml2YXRlIHRpbnQoY2VsbDogbnVtYmVyLCBtb2RlOiAnbm9ybWFsJyB8ICdmcmVlJyB8ICdzZWwnIHwgJ3BhcnRuZXInKSB7XG4gICAgY29uc3QgbSA9IHRoaXMudGlsZU1hdHNbY2VsbF07IGNvbnN0IGMgPSB7IG5vcm1hbDogWzAuMTgsIDAuMTIsIDAuNDIsIDAuNV0sIGZyZWU6IFswLjIsIDAuNzUsIDAuNTUsIDAuN10sIHNlbDogWzEsIDAuODIsIDAuMywgMC44NV0sIHBhcnRuZXI6IFswLjg1LCAwLjM1LCAxLCAwLjg1XSB9W21vZGVdO1xuICAgIG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhjWzBdLCBjWzFdLCBjWzJdKTsgbS5hbHBoYSA9IGNbM107XG4gIH1cbiAgbGF0ZXIoc2VjOiBudW1iZXIsIGZuOiAoKSA9PiB2b2lkKSB7IHRoaXMudGltZXJzLnB1c2goeyB0OiBzZWMsIGZuIH0pOyB9XG4gIHByaXZhdGUgZnhSaW5nKHg6IG51bWJlciwgejogbnVtYmVyLCBjb2xvcjogYW55LCByMDogbnVtYmVyLCByMTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVRvcnVzKCdmeCcsIHsgZGlhbWV0ZXI6IDEsIHRoaWNrbmVzczogMC4wMzUsIHRlc3NlbGxhdGlvbjogMjggfSwgdGhpcy5zY2VuZSk7IG0ucG9zaXRpb24uc2V0KHgsIDAuMDUsIHopOyBtLmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICBjb25zdCBtbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2Z4bScsIHRoaXMuc2NlbmUpOyBtbS5lbWlzc2l2ZUNvbG9yID0gY29sb3I7IG1tLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG1tLmFscGhhID0gMC45OyBtLm1hdGVyaWFsID0gbW07IHRoaXMucmluZ0Z4LnB1c2goeyBtLCBtbSwgdDogMCwgcjAsIHIxLCBkdXIgfSk7XG4gIH1cbiAgcHJpdmF0ZSBidXJzdCh4OiBudW1iZXIsIHo6IG51bWJlciwgYzE6IG51bWJlcltdLCBjMjogbnVtYmVyW10sIGNvdW50OiBudW1iZXIpIHtcbiAgICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdiJywgNjAsIHRoaXMuc2NlbmUpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSB0aGlzLkEuc29mdDsgcHMuZW1pdHRlciA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoeCwgMC4wNSwgeik7IHBzLm1pbkVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjIsIDAsIC0wLjIpOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIDAuMDUsIDAuMik7XG4gICAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMSBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uKGMyIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdKSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjEsIDAsIDAuMiwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMTI7IHBzLm1heFNpemUgPSAwLjM0OyBwcy5taW5MaWZlVGltZSA9IDAuNDsgcHMubWF4TGlmZVRpbWUgPSAwLjk7IHBzLmVtaXRSYXRlID0gMDsgcHMubWFudWFsRW1pdENvdW50ID0gY291bnQ7IHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0xLCAxLjMsIC0xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMSwgMi40LCAxKTtcbiAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjg7IHBzLm1heEVtaXRQb3dlciA9IDI7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIC0yLCAwKTsgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy50YXJnZXRTdG9wRHVyYXRpb24gPSAxLjI7IHBzLmRpc3Bvc2VPblN0b3AgPSB0cnVlOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gY2FtZXJhXG4gIHByaXZhdGUgcG9zZXMoKSB7XG4gICAgY29uc3QgYXNwID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKSAvIHRoaXMuZW5naW5lLmdldFJlbmRlckhlaWdodCgpLCB0YW5WID0gTWF0aC50YW4odGhpcy5jYW1lcmEuZm92IC8gMik7XG4gICAgY29uc3QgaGFsZiA9IEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQICsgMS40O1xuICAgIGNvbnN0IGQgPSBNYXRoLm1heChoYWxmIC8gKHRhblYgKiBhc3ApLCAoKEdSSURfUk9XUyAqIEdSSURfU1ApIC8gMiArIDIpIC8gKHRhblYgKiAwLjU1KSwgOCk7XG4gICAgY29uc3QgYmF0dGxlID0geyBwb3M6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMSAqIGQsIDAuNDIgKiBkICsgMC41LCAtMC44NiAqIGQpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC4zNSwgMCkgfTtcbiAgICAvLyBCdWlsZCB2aWV3OiAoYWxtb3N0KSBzdHJhaWdodCBkb3duLCB3aXRoIHRoZSB3aG9sZSBncmlkIGluc2lkZSB0aGUgYmFuZCBiZXR3ZWVuIHRoZSB0b3AgYmFyIGFuZCB0aGUgaGFuZCBvZiBjYXJkcy5cbiAgICBjb25zdCBjeCA9IC0oRlJPTlRfWCArICgoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAvIDIpLCBIID0gTWF0aC5tYXgoMSwgdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KTtcbiAgICBjb25zdCBib3ggPSAoaWQ6IHN0cmluZykgPT4geyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsgcmV0dXJuIGVsICYmIGVsLm9mZnNldFBhcmVudCAhPT0gbnVsbCA/IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpIDogbnVsbDsgfTtcbiAgICBjb25zdCB0b3BCYXIgPSBib3goJ3RvcCcpLCBoYW5kID0gYm94KCdoYW5kJyksIGluZm8gPSBib3goJ2luZm8nKTtcbiAgICBjb25zdCBUT1AgPSBNYXRoLm1pbigwLjMyLCB0b3BCYXIgPyAodG9wQmFyLmJvdHRvbSArIDYpIC8gSCA6IDAuMSk7XG4gICAgY29uc3QgQk9UVE9NID0gTWF0aC5taW4oMC41LCAoSCAtIE1hdGgubWluKGhhbmQgPyBoYW5kLnRvcCA6IEgsIGluZm8gPyBpbmZvLnRvcCA6IEgpICsgNikgLyBIKTtcbiAgICBjb25zdCBiYW5kID0gTWF0aC5tYXgoMC4zLCAxIC0gVE9QIC0gQk9UVE9NKSwgY2VudGVyRnJhYyA9IFRPUCArIGJhbmQgLyAyOyAgICAgICAgICAvLyB0aGUgZ3JpZCdzIGNlbnRyZSBhcHBlYXJzIGF0IHRoaXMgZnJhY3Rpb24gZnJvbSB0aGUgdG9wXG4gICAgY29uc3QgZ3cgPSBHUklEX0NPTFMgKiBHUklEX1NQICsgMy4yLCBnaCA9IEdSSURfUk9XUyAqIEdSSURfU1AgKyAwLjU7ICAgICAgICAgICAgICAgIC8vIHRoZSB3aWR0aCBhbHNvIGxlYXZlcyByb29tIGZvciB0aGUgTmVjcm9tYW5jZXIgYmVzaWRlIHRoZSBncmlkXG4gICAgY29uc3QgZDIgPSBNYXRoLm1heChnaCAvICgyICogdGFuViAqIGJhbmQpLCBndyAvICgyICogdGFuViAqIGFzcCAqIDAuODgpLCA0LjUpO1xuICAgIGNvbnN0IHNoaWZ0ID0gKDAuNSAtIGNlbnRlckZyYWMpICogMiAqIGQyICogdGFuViwgYnggPSBjeCAtIDAuNjtcbiAgICBjb25zdCBidWlsZCA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCBkMiwgLXNoaWZ0IC0gMC4xICogZDIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoYngsIDAsIC1zaGlmdCkgfTtcbiAgICBjb25zdCBuZWNybyA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJhdHRsZS5wb3MueCAtIDEuNCwgYmF0dGxlLnBvcy55ICogMS4xMiwgYmF0dGxlLnBvcy56ICogMS4xMiksIHRndDogbmV3IEJBQllMT04uVmVjdG9yMygtMS40LCAwLjM1LCAwKSB9OyAgIC8vIHJlc3VsdCBjdXRzY2VuZXM6IGhpbSBhbmQgdGhlIGZpZWxkXG4gICAgcmV0dXJuIHsgYmF0dGxlLCBidWlsZCwgbmVjcm8gfTtcbiAgfVxuICAvKiogVGhlIGhhbmQgLyBpbmZvIGJhciBjYW4gY2hhbmdlIHNpemUgaW4gdGhlIGJ1aWxkIHBoYXNlIChsb25nIGFiaWxpdHkgdGV4dCwgbW9yZSBjYXJkcyk6IHJlLWZyYW1lIHNvIHRoZSBncmlkIG5ldmVyIGhpZGVzIGJlaGluZCBpdC4gKi9cbiAgcmVmcmFtZUJ1aWxkKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8IHRoaXMuY2FtVCA8IDEgfHwgdGhpcy5jaW5lIHx8ICF0aGlzLmNhbnZhcykgcmV0dXJuO1xuICAgIGNvbnN0IHAgPSB0aGlzLnBvc2VzKCkuYnVpbGQsIGMgPSB0aGlzLmNhbWVyYS5wb3NpdGlvbjtcbiAgICBpZiAoIWlzRmluaXRlKHAucG9zLngpIHx8IEJBQllMT04uVmVjdG9yMy5EaXN0YW5jZShjLCBwLnBvcykgPCAwLjA2KSByZXR1cm47XG4gICAgdGhpcy50d2VlbkNhbShwLCAwLjM1KTtcbiAgfVxuICBwcml2YXRlIGNhbnZhcyE6IEhUTUxDYW52YXNFbGVtZW50OyBwcml2YXRlIGxhc3RXID0gMDsgcHJpdmF0ZSBsYXN0SCA9IDA7IGxhc3RUYXBJbmZvID0gJyhubyB0YXBzIHlldCknO1xuICBwcml2YXRlIGhhbmRsZVJlc2l6ZSgpIHtcbiAgICBpZiAoIXRoaXMuY2FudmFzLmNsaWVudFdpZHRoIHx8ICF0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQpIHJldHVybjsgICAvLyBoaWRkZW4gYmVoaW5kIGFub3RoZXIgdGFiXG4gICAgdGhpcy5lbmdpbmUucmVzaXplKCk7IHRoaXMubGFzdFcgPSB0aGlzLmNhbnZhcy5jbGllbnRXaWR0aDsgdGhpcy5sYXN0SCA9IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyAmJiB0aGlzLmNhbVQgPj0gMSkgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTtcbiAgfVxuICAvKiogQSB0YXAgb24gdGhlIDNEIHZpZXc6IHBpY2sgYSB0aWxlIG9yIGEgdW5pdC4gKi9cbiAgcHJpdmF0ZSB0YXAoeDogbnVtYmVyLCB5OiBudW1iZXIpIHtcbiAgICBjb25zdCBwID0gdGhpcy5zY2VuZS5waWNrKHgsIHksIChtOiBhbnkpID0+ICEhKG0ubWV0YWRhdGEgJiYgbS5tZXRhZGF0YS5raW5kKSk7XG4gICAgY29uc3QgbWQgPSBwICYmIHAuaGl0ID8gcC5waWNrZWRNZXNoLm1ldGFkYXRhIDogbnVsbDtcbiAgICB0aGlzLmxhc3RUYXBJbmZvID0gYHRhcCAke01hdGgucm91bmQoeCl9LCR7TWF0aC5yb3VuZCh5KX0gb2YgJHt0aGlzLmNhbnZhcy5jbGllbnRXaWR0aH14JHt0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHR9IC0+ICR7bWQgPyAobWQua2luZCA9PT0gJ3RpbGUnID8gJ3RpbGUgJyArIG1kLmNlbGwgOiAndW5pdCcpIDogJ25vdGhpbmcnfSAocGhhc2UgJHt0aGlzLnBoYXNlfSlgO1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICFtZCkgcmV0dXJuO1xuICAgIGlmIChtZC5raW5kID09PSAndGlsZScpIHRoaXMub25UaWxlKG1kLmNlbGwpOyBlbHNlIGlmIChtZC5raW5kID09PSAndW5pdCcpIHRoaXMub25Vbml0VmlzdWFsKG1kLnZpc3VhbCk7XG4gIH1cbiAgcHJpdmF0ZSBzZXRDYW0ocDogYW55KSB7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNvcHlGcm9tKHAucG9zKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHAudGd0LmNsb25lKCkpOyB9XG4gIHByaXZhdGUgdHdlZW5DYW0odG86IGFueSwgZHVyOiBudW1iZXIpIHsgdGhpcy5jYW1Gcm9tID0geyBwb3M6IHRoaXMuY2FtZXJhLnBvc2l0aW9uLmNsb25lKCksIHRndDogdGhpcy5jYW1lcmEuZ2V0VGFyZ2V0KCkuY2xvbmUoKSB9OyB0aGlzLmNhbVRvID0gdG87IHRoaXMuY2FtVCA9IDA7IHRoaXMuY2FtRHVyID0gZHVyOyB9XG5cbiAgLy8gLS0tLSBiYXR0bGUgY2FtZXJhOiBmb2xsb3dzIHRoZSBmaWdodGVycyB0aGF0IGFyZSBzdGlsbCBhbGl2ZSwgc28gdGhlIGFjdGlvbiAoYW5kIHRoZSBwdXJwbGUgZXllcykgc3RheXMgbGFyZ2Ugb24gc2NyZWVuXG4gIGNhbU1vZGU6ICdjbG9zZScgfCAnd2lkZScgPSAnY2xvc2UnOyBwcml2YXRlIGNhbVRndDogYW55ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjUsIDApO1xuICBzZXRDYW1Nb2RlKG06ICdjbG9zZScgfCAnd2lkZScpIHtcbiAgICB0aGlzLmNhbU1vZGUgPSBtO1xuICAgIGlmIChtID09PSAnd2lkZScgJiYgdGhpcy5iYXR0bGUpIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMC45KTtcbiAgICB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHByaXZhdGUgZnJhbWVCYXR0bGUoZHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTsgaWYgKCFiKSByZXR1cm47IGNvbnN0IGFsaXZlID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAoIWFsaXZlLmxlbmd0aCkgcmV0dXJuO1xuICAgIGxldCB4MCA9IDFlOSwgeDEgPSAtMWU5LCB6MCA9IDFlOSwgejEgPSAtMWU5OyBmb3IgKGNvbnN0IGYgb2YgYWxpdmUpIHsgeDAgPSBNYXRoLm1pbih4MCwgZi54KTsgeDEgPSBNYXRoLm1heCh4MSwgZi54KTsgejAgPSBNYXRoLm1pbih6MCwgZi56KTsgejEgPSBNYXRoLm1heCh6MSwgZi56KTsgfVxuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IHdpZGUgPSB0aGlzLnBvc2VzKCkuYmF0dGxlLCBjeCA9ICh4MCArIHgxKSAvIDIsIGN6ID0gKHowICsgejEpIC8gMjtcbiAgICBjb25zdCBkID0gTWF0aC5taW4oTWF0aC5tYXgoKHgxIC0geDAgKyAzLjQpIC8gKDIgKiB0YW5WICogYXNwICogMC45KSwgKHoxIC0gejAgKyAzLjIpIC8gKDIgKiB0YW5WICogMC42MiksIDUuNCksIE1hdGguaHlwb3Qod2lkZS5wb3MueSwgd2lkZS5wb3MueikpO1xuICAgIGNvbnN0IHRndCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3gsIDAuNTUsIGN6KSwgcG9zID0gbmV3IEJBQllMT04uVmVjdG9yMyhjeCAtIDAuMDYgKiBkLCAwLjMyICogZCArIDAuNSwgY3ogLSAwLjkgKiBkKTtcbiAgICBjb25zdCBrID0gMSAtIE1hdGguZXhwKC1kdCAqIDIuMCk7XG4gICAgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbWVyYS5wb3NpdGlvbiwgcG9zLCBrKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbVRndCwgdGd0LCBrKTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KHRoaXMuY2FtVGd0LmNsb25lKCkpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc3RhZ2UgZmxvd1xuICAvKiogV3JpdGUgdGhlIHJ1biB0byBkaXNrIChjYWxtIG1vbWVudHMgb25seTogYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0KS4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0UnVuKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMpIHJldHVybjtcbiAgICAgIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgeyBjbGVhclJ1bigpOyByZXR1cm47IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnICYmIHRoaXMucGhhc2UgIT09ICdkcmFmdCcpIHJldHVybjtcbiAgICAgIGNvbnN0IHNuYXA6IFJ1blNuYXBzaG90ID0geyB2OiAxLCBzZWVkOiB0aGlzLnNlZWQsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgc3RhZ2U6IGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5TmFtZSwgcGhhc2U6IHRoaXMucGhhc2UsIGRyYWZ0OiB0aGlzLnBoYXNlID09PSAnZHJhZnQnID8gdGhpcy5kcmFmdCA6IG51bGwsIHN0YXRlOiBzZXJpYWxpemVTdGF0ZShzKSwgc3RhcnRCZXN0OiB0aGlzLmVuZGxlc3M/LnN0YXJ0QmVzdCB9O1xuICAgICAgc2F2ZVJ1bihzbmFwKTtcbiAgICB9IGNhdGNoIHsgLyogbmV2ZXIgbGV0IHNhdmluZyBicmVhayB0aGUgZ2FtZSAqLyB9XG4gIH1cbiAgLyoqIFJlYnVpbGQgdGhlIHNjcmVlbiBmcm9tIGEgc2F2ZWQgcnVuIChhIHJlbG9hZCwgb3IgU2FmYXJpIGRpc2NhcmRpbmcgdGhlIHBhZ2UpLiAqL1xuICBwcml2YXRlIHJlc3RvcmUocjogeyBzbmFwOiBSdW5TbmFwc2hvdDsgc3RhdGU6IFN0YXRlIH0pIHtcbiAgICBjb25zdCB7IHNuYXAsIHN0YXRlIH0gPSByO1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLmZsdXNoVHdlZW5zKCk7IHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5kYWlseSA9IG51bGw7XG4gICAgaWYgKHNuYXAuc3RhZ2UgPT09IERBSUxZX0lEICYmIGlzVmFsaWREYXkoK3NuYXAuZGlmZmljdWx0eSkpIHsgY29uc3QgZGF5ID0gK3NuYXAuZGlmZmljdWx0eSwgbW9kID0gbW9kaWZpZXJGb3IoZGF5KTsgc2V0RGFpbHkobW9kLCBkYXkpOyB0aGlzLmRhaWx5ID0geyBkYXksIG1vZCB9OyB0aGlzLmVuZGxlc3MgPSBudWxsOyB0aGlzLmFyZW5hLnNldFRoZW1lKCdjcnlwdCcpOyB9XG4gICAgZWxzZSBpZiAoc25hcC5zdGFnZSA9PT0gRU5ETEVTU19JRCkgeyBzZXRFbmRsZXNzKCk7IGNvbnN0IGRvbmUgPSBNYXRoLm1heCgwLCBzdGF0ZS53YXZlIC0gMSk7IHRoaXMuZW5kbGVzcyA9IHsgc3RhcnRCZXN0OiBzbmFwLnN0YXJ0QmVzdCA/PyBsb2FkU2F2ZSgpLmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogZG9uZSwgcGFja3M6IE1hdGguZmxvb3IoZG9uZSAvIEVORExFU1NfUEFDS19FVkVSWSkgfTsgfSBlbHNlIHsgc2V0U3RhZ2VEaWZmaWN1bHR5KHNuYXAuc3RhZ2UsIHNuYXAuZGlmZmljdWx0eSk7IHRoaXMuZW5kbGVzcyA9IG51bGw7IH1cbiAgICBpZiAoIXRoaXMuZGFpbHkpIHRoaXMuYXJlbmEuc2V0VGhlbWUoY3VycmVudFN0YWdlSWQpO1xuICAgIHRoaXMuc2VlZCA9IHNuYXAuc2VlZDsgdGhpcy5hdHRlbXB0ID0gc25hcC5hdHRlbXB0OyB0aGlzLnMgPSBzdGF0ZTsgdGhpcy5zZWVuTWVyZ2VzID0gc3RhdGUuc3RhdHMubWVyZ2VzO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTtcbiAgICB0aGlzLnNlbCA9IG51bGw7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgdGhpcy5kcmFmdCA9IHNuYXAucGhhc2UgPT09ICdkcmFmdCcgPyBzbmFwLmRyYWZ0IDogbnVsbDsgdGhpcy5waGFzZSA9IHRoaXMuZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJzsgdGhpcy5zaG93R3JpZCh0aGlzLnBoYXNlID09PSAnYnVpbGQnKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KGBSdW4gcmVzdG9yZWQ6IHdhdmUgJHtpc0VuZGxlc3MoKSA/IHN0YXRlLndhdmUgOiBzdGF0ZS53YXZlICsgJy8nICsgc3RhZ2VXYXZlcyhzdGF0ZSl9LCAke3N0YXRlLmhlYXJ0c30gaGVhcnQke3N0YXRlLmhlYXJ0cyA9PT0gMSA/ICcnIDogJ3MnfS5gKTtcbiAgfVxuXG4gIC8vIC0tLS0gcGVyZm9ybWFuY2UgcmVhZG91dDogcm9sbGluZyBmcmFtZSBzdGF0cywgcGVyLWJhdHRsZSBzdW1tYXJpZXMsIG9wdGlvbmFsIG9uLXNjcmVlbiBGUFMsIGFuZCBhIHBhc3RlLWZyaWVuZGx5IHJlcG9ydFxuICBzaG93RnBzID0gZmFsc2U7IHBlcmZOb3cgPSB7IGZwczogMCwgYXZnOiAwLCBwOTU6IDAsIHdvcnN0OiAwIH07IHBlcmZMb2c6IGFueVtdID0gW107XG4gIHByaXZhdGUgcGVyZkJ1ZiA9IG5ldyBGbG9hdDMyQXJyYXkoMjQwKTsgcHJpdmF0ZSBwZXJmTiA9IDA7IHByaXZhdGUgcGVyZkkgPSAwOyBwcml2YXRlIHBlcmZTaG93bkF0ID0gMDsgcHJpdmF0ZSBpbnN0cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBmcHNIdWQ6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY3VyQmF0dGxlOiB7IGZyYW1lczogbnVtYmVyOyBzdW06IG51bWJlcjsgd29yc3Q6IG51bWJlcjsgc2xvdzogbnVtYmVyOyBzY2FsZTogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgc2V0U2hvd0ZwcyhvbjogYm9vbGVhbikge1xuICAgIHRoaXMuc2hvd0ZwcyA9IG9uO1xuICAgIGlmIChvbiAmJiAhdGhpcy5mcHNIdWQpIHsgY29uc3QgaCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBoLmlkID0gJ2Zwc0h1ZCc7IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYmF0dGxlSG9zdCcpIHx8IGRvY3VtZW50LmJvZHkpLmFwcGVuZENoaWxkKGgpOyB0aGlzLmZwc0h1ZCA9IGg7IH1cbiAgICBpZiAodGhpcy5mcHNIdWQpIHRoaXMuZnBzSHVkLnN0eWxlLmRpc3BsYXkgPSBvbiA/ICdibG9jaycgOiAnbm9uZSc7XG4gIH1cbiAgcHJpdmF0ZSBwZXJmVGljayhtczogbnVtYmVyKSB7XG4gICAgaWYgKG1zID4gNTAwKSByZXR1cm47ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSB0YWIgd2FzIGhpZGRlbiBvciB0aGUgcGhvbmUgcGF1c2VkIHVzOiBub3QgYSByZWFsIGZyYW1lXG4gICAgdGhpcy5wZXJmQnVmW3RoaXMucGVyZkldID0gbXM7IHRoaXMucGVyZkkgPSAodGhpcy5wZXJmSSArIDEpICUgdGhpcy5wZXJmQnVmLmxlbmd0aDsgdGhpcy5wZXJmTiA9IE1hdGgubWluKHRoaXMucGVyZkJ1Zi5sZW5ndGgsIHRoaXMucGVyZk4gKyAxKTtcbiAgICBjb25zdCBjID0gdGhpcy5jdXJCYXR0bGU7XG4gICAgaWYgKGMgJiYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnIHx8IHRoaXMucGhhc2UgPT09ICd0cmFuc2l0aW9uJykpIHsgYy5mcmFtZXMrKzsgYy5zdW0gKz0gbXM7IGlmIChtcyA+IGMud29yc3QpIGMud29yc3QgPSBtczsgaWYgKG1zID4gMzMuNCkgYy5zbG93Kys7IGMuc2NhbGUgPSBNYXRoLm1heChjLnNjYWxlLCB0aGlzLnRpbWVTY2FsZSk7IH1cbiAgICBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKTsgaWYgKG5vdyAtIHRoaXMucGVyZlNob3duQXQgPCA1MDApIHJldHVybjsgdGhpcy5wZXJmU2hvd25BdCA9IG5vdztcbiAgICBjb25zdCBhID0gQXJyYXkuZnJvbSh0aGlzLnBlcmZCdWYuc3ViYXJyYXkoMCwgdGhpcy5wZXJmTikpLnNvcnQoKHgsIHkpID0+IHggLSB5KSwgYXZnID0gYS5yZWR1Y2UoKG4sIHgpID0+IG4gKyB4LCAwKSAvIGEubGVuZ3RoO1xuICAgIHRoaXMucGVyZk5vdyA9IHsgZnBzOiAxMDAwIC8gYXZnLCBhdmcsIHA5NTogYVtNYXRoLmZsb29yKGEubGVuZ3RoICogMC45NSldID8/IDAsIHdvcnN0OiBhW2EubGVuZ3RoIC0gMV0gPz8gMCB9O1xuICAgIGlmICh0aGlzLmZwc0h1ZCAmJiB0aGlzLnNob3dGcHMpIHRoaXMuZnBzSHVkLnRleHRDb250ZW50ID0gYCR7dGhpcy5wZXJmTm93LmZwcy50b0ZpeGVkKDApfSBmcHMgICR7dGhpcy5wZXJmTm93LmF2Zy50b0ZpeGVkKDEpfW1zICBzbG93NSUgJHt0aGlzLnBlcmZOb3cucDk1LnRvRml4ZWQoMCl9bXNgO1xuICAgIHRoaXMudWkucmVuZGVyRGVidWdMaXZlKCk7XG4gIH1cbiAgcHJpdmF0ZSBiZWdpbkJhdHRsZVBlcmYoKSB7IHRoaXMuY3VyQmF0dGxlID0geyBmcmFtZXM6IDAsIHN1bTogMCwgd29yc3Q6IDAsIHNsb3c6IDAsIHNjYWxlOiB0aGlzLnRpbWVTY2FsZSB9OyB9XG4gIHByaXZhdGUgZW5kQmF0dGxlUGVyZigpIHtcbiAgICBjb25zdCBjID0gdGhpcy5jdXJCYXR0bGU7IHRoaXMuY3VyQmF0dGxlID0gbnVsbDsgaWYgKCFjIHx8ICFjLmZyYW1lcykgcmV0dXJuO1xuICAgIHRoaXMucGVyZkxvZy5wdXNoKHsgd2F2ZTogdGhpcy5zLndhdmUsIGF0dGVtcHQ6IHRoaXMuYXR0ZW1wdCwgc3BlZWQ6IGMuc2NhbGUsIGZpZ2h0ZXJzOiB0aGlzLmJhdHRsZSA/IHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmxlbmd0aCA6IDAsIGZwczogKygxMDAwIC8gKGMuc3VtIC8gYy5mcmFtZXMpKS50b0ZpeGVkKDApLCB3b3JzdE1zOiArYy53b3JzdC50b0ZpeGVkKDApLCBzbG93UGN0OiArKCgxMDAgKiBjLnNsb3cpIC8gYy5mcmFtZXMpLnRvRml4ZWQoMSkgfSk7XG4gICAgaWYgKHRoaXMucGVyZkxvZy5sZW5ndGggPiAxMikgdGhpcy5wZXJmTG9nLnNoaWZ0KCk7XG4gIH1cbiAgcGVyZkluZm8oKSB7XG4gICAgY29uc3Qgc2MgPSB0aGlzLnNjZW5lOyBpZiAoIXRoaXMuaW5zdHIgJiYgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbikgdGhpcy5pbnN0ciA9IG5ldyBCQUJZTE9OLlNjZW5lSW5zdHJ1bWVudGF0aW9uKHNjKTtcbiAgICByZXR1cm4geyAuLi50aGlzLnBlcmZOb3csIG1lc2hlczogc2MuZ2V0QWN0aXZlTWVzaGVzKCkubGVuZ3RoLCBwYXJ0aWNsZXM6IHNjLnBhcnRpY2xlU3lzdGVtcy5sZW5ndGgsIGRyYXdzOiB0aGlzLmluc3RyID8gdGhpcy5pbnN0ci5kcmF3Q2FsbHNDb3VudGVyLmN1cnJlbnQgOiAtMSB9O1xuICB9XG4gIHBlcmZSZXBvcnQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBwID0gdGhpcy5wZXJmSW5mbygpLCBnbDogYW55ID0gdGhpcy5lbmdpbmUuZ2V0R2xJbmZvID8gdGhpcy5lbmdpbmUuZ2V0R2xJbmZvKCkgOiB7fTtcbiAgICBjb25zdCByb3dzID0gdGhpcy5wZXJmTG9nLm1hcCgocikgPT4gYCAgd2F2ZSAke3Iud2F2ZX0gdHJ5ICR7ci5hdHRlbXB0fSBhdCAke3Iuc3BlZWR9eDogJHtyLmZwc30gZnBzIGF2ZXJhZ2UsIHdvcnN0IGZyYW1lICR7ci53b3JzdE1zfW1zLCAke3Iuc2xvd1BjdH0lIHNsb3cgZnJhbWVzLCAke3IuZmlnaHRlcnN9IGZpZ2h0ZXJzYCk7XG4gICAgcmV0dXJuIFtgUEVSRiAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1gLCBgZGV2aWNlOiAke25hdmlnYXRvci51c2VyQWdlbnR9YCwgYGdwdTogJHtnbC5yZW5kZXJlciB8fCAnPyd9ICgke2dsLnZlbmRvciB8fCAnPyd9KWAsXG4gICAgICBgc2NyZWVuICR7c2NyZWVuLndpZHRofXgke3NjcmVlbi5oZWlnaHR9ICB2aWV3cG9ydCAke2lubmVyV2lkdGh9eCR7aW5uZXJIZWlnaHR9ICBkcHIgJHtkZXZpY2VQaXhlbFJhdGlvfSAgcmVuZGVyICR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVyV2lkdGgoKX14JHt0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKX0gIHNjYWxpbmcgbGV2ZWwgJHt0aGlzLmVuZ2luZS5nZXRIYXJkd2FyZVNjYWxpbmdMZXZlbCgpLnRvRml4ZWQoMil9YCxcbiAgICAgIGBub3c6ICR7cC5mcHMudG9GaXhlZCgwKX0gZnBzLCBhdmVyYWdlICR7cC5hdmcudG9GaXhlZCgxKX1tcywgc2xvd2VzdCA1JSAke3AucDk1LnRvRml4ZWQoMCl9bXMsIHdvcnN0ICR7cC53b3JzdC50b0ZpeGVkKDApfW1zIHwgYWN0aXZlIG1lc2hlcyAke3AubWVzaGVzfSwgcGFydGljbGUgc3lzdGVtcyAke3AucGFydGljbGVzfSwgZHJhdyBjYWxscyAke3AuZHJhd3N9YCxcbiAgICAgIGBzdGF0ZTogcGhhc2UgJHt0aGlzLnBoYXNlfSwgc3BlZWQgJHt0aGlzLnRpbWVTY2FsZX14LCBjYW1lcmEgJHt0aGlzLmNhbU1vZGV9LCBkaWZmaWN1bHR5ICR7ZGlmZmljdWx0eU5hbWV9LCB3YXZlICR7dGhpcy5zLndhdmV9LCB1bml0cyAke3RoaXMucy51bml0cy5sZW5ndGh9YCxcbiAgICAgIGBiYXR0bGVzIChuZXdlc3QgbGFzdCk6YCwgLi4uKHJvd3MubGVuZ3RoID8gcm93cyA6IFsnICAobm9uZSB5ZXQ6IHBsYXkgYSBiYXR0bGUsIHRoZW4gY29weSB0aGlzIGFnYWluKSddKV0uam9pbignXFxuJyk7XG4gIH1cblxuICAvKiogQSBydW4gdGhlIHBsYXllciBoYXMgcmVhbGx5IHN0YXJ0ZWQgKHNvIEhvbWUgY2FuIG9mZmVyIENvbnRpbnVlKS4gTnVsbCBhZnRlciBhIHN0YWdlIHdhcyB3b24gb3IgbG9zdCwgb3IgYmVmb3JlIGFueXRoaW5nIHdhcyBkb25lLiAqL1xuICBydW5JbmZvKCkgeyBjb25zdCBzID0gdGhpcy5zOyBpZiAoIXMgfHwgcy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybiBudWxsOyByZXR1cm4gKHMud2F2ZSA+IDEgfHwgcy51bml0cy5sZW5ndGggPiAwIHx8IHRoaXMuYXR0ZW1wdCA+IDAgfHwgcy5zdGF0cy5mYWlsdXJlcyA+IDApID8geyB3YXZlOiBzLndhdmUsIHRvdGFsOiBzdGFnZVdhdmVzKHMpLCBoZWFydHM6IHMuaGVhcnRzLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5TmFtZSwgc3RhZ2U6IGN1cnJlbnRTdGFnZUlkIH0gOiBudWxsOyB9XG4gIC8qKiBGcmVzaCBydW4gd2l0aCB0aGUgY3VycmVudGx5IGVxdWlwcGVkIFNvdWwgRGVjayAoSG9tZSA+IFN0YXJ0IEJhdHRsZSBjYWxscyB0aGlzKS4gKi9cbiAgLyoqIEdpdmUgdXAgdGhlIHJ1biBpbiBwcm9ncmVzcyAoSG9tZSA+IE5ldyBiYXR0bGUsIGFmdGVyIHRoZSBwbGF5ZXIgY29uZmlybXMpOiB0aGUgc2F2ZWQgcnVuIGlzIGRyb3BwZWQgYW5kIEhvbWUgbGV0cyB0aGVtIHBpY2sgYW55IHN0YWdlIG9yIG1vZGUuIEdvbGQgYW5kIHBhY2tzIGFscmVhZHkgZWFybmVkIHN0YXkuICovXG4gIGFiYW5kb25SdW4oKSB7IHRoaXMuc3RhcnRTdGFnZShNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IGNsZWFyUnVuKCk7IH1cbiAgbmV3UnVuKCkgeyB0aGlzLnN0YXJ0U3RhZ2UobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnc2VlZCcpID8gdGhpcy5zZWVkIDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMWU2KSArIDEpOyB9XG4gIHN0YXJ0U3RhZ2Uoc2VlZDogbnVtYmVyKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucmV3YXJkID0gbnVsbDsgdGhpcy5mbHVzaFR3ZWVucygpOyBpZiAodGhpcy5uZWNybykgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICB0aGlzLnJ1bkdvbGQgPSAwOyB0aGlzLmxhc3RHb2xkID0gMDsgdGhpcy5kYWlseSA9IG51bGw7IHRoaXMuZGFpbHlSZXdhcmQgPSBudWxsOyB0aGlzLnNlZWQgPSBzZWVkOyB0aGlzLmF0dGVtcHQgPSAwOyB0aGlzLmVuZGxlc3MgPSBudWxsOyBjb25zdCBzdiA9IGxvYWRTYXZlKCksIHBsID0gcGxheWFibGUoc3YpOyBzZXRTdGFnZURpZmZpY3VsdHkocGwuc3RhZ2UsIHBsLmRpZmZpY3VsdHkpOyB0aGlzLmFyZW5hLnNldFRoZW1lKGN1cnJlbnRTdGFnZUlkKTsgdGhpcy5zID0gbmV3U3RhZ2UoeyAuLi5QUk9UT1RZUEVfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpOyAgIC8vIChhIGJhdHRsZSBsZWZ0IGhhbGYtd2F5IGhhZCBoaWRkZW4gdGhlIGdyaWQpXG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KCdTdGFnZSBzdGFydDogNCBjYXJkcywgJyArIHRoaXMucy5jYXAgKyAnIERvbWluaW9uLiBTdW1tb24sIG1lcmdlLCB0aGVuIHByZXNzIEJBVFRMRS4nKTtcbiAgfVxuICAvKiogVG9kYXkncyBEYWlseSBDaGFsbGVuZ2UgKEhvbWUgPiBEYWlseSBDaGFsbGVuZ2UpOiB0aGUgc2FtZSBzZWVkIGFuZCB0d2lzdCBmb3IgZXZlcnlvbmUgb24gdGhlIHNhbWUgZGF5LiBSZXRyeSBhcyBvZnRlbiBhcyB5b3UgbGlrZTsgdGhlIHJld2FyZCBpcyBwYWlkIG9uY2UuICovXG4gIG5ld0RhaWx5KCkgeyB0aGlzLnN0YXJ0RGFpbHkoZGF5TnVtYmVyKCkpOyB9XG4gIHN0YXJ0RGFpbHkoZGF5OiBudW1iZXIpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5yZXdhcmQgPSBudWxsOyB0aGlzLmZsdXNoVHdlZW5zKCk7IGlmICh0aGlzLm5lY3JvKSB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIGNvbnN0IG1vZCA9IG1vZGlmaWVyRm9yKGRheSksIHN2ID0gbG9hZFNhdmUoKTsgc2V0RGFpbHkobW9kLCBkYXkpOyB0aGlzLmFyZW5hLnNldFRoZW1lKCdjcnlwdCcpO1xuICAgIHRoaXMucnVuR29sZCA9IDA7IHRoaXMubGFzdEdvbGQgPSAwOyB0aGlzLmRhaWx5UmV3YXJkID0gbnVsbDsgdGhpcy5lbmRsZXNzID0gbnVsbDsgdGhpcy5kYWlseSA9IHsgZGF5LCBtb2QgfTsgdGhpcy5zZWVkID0gZGF5OyB0aGlzLmF0dGVtcHQgPSAwO1xuICAgIHRoaXMucyA9IG5ld1N0YWdlKGRhaWx5UnVsZXMobW9kLCBzdi5kZWNrKSwgdGhpcy5zZWVkKTsgdGhpcy5zZWVuTWVyZ2VzID0gMDtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KGBEYWlseSBDaGFsbGVuZ2U6ICR7bW9kLm5hbWV9LiAke21vZC50ZXh0fWApO1xuICB9XG4gIC8qKiBGcmVzaCBFbmRsZXNzIERlcHRocyBydW4gKEhvbWUgPiBFbmRsZXNzIERlcHRocyBjYWxscyB0aGlzKTogc2FtZSBydWxlcyBhcyBhIHN0YWdlLCBidXQgdGhlIHdhdmVzIG5ldmVyIHN0b3AgYW5kIHRoZSBlbmVteSBrZWVwcyBncm93aW5nLiAqL1xuICBuZXdFbmRsZXNzKCkgeyB0aGlzLnN0YXJ0RW5kbGVzcyhuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdzZWVkJykgPyB0aGlzLnNlZWQgOiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxZTYpICsgMSk7IH1cbiAgc3RhcnRFbmRsZXNzKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5ydW5Hb2xkID0gMDsgdGhpcy5sYXN0R29sZCA9IDA7IHRoaXMuZGFpbHkgPSBudWxsOyB0aGlzLmRhaWx5UmV3YXJkID0gbnVsbDsgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpOyBzZXRFbmRsZXNzKCk7IHRoaXMuYXJlbmEuc2V0VGhlbWUoRU5ETEVTU19JRCk7XG4gICAgdGhpcy5lbmRsZXNzID0geyBzdGFydEJlc3Q6IHN2LmVuZGxlc3MuYmVzdCwgY2xlYXJlZDogMCwgcGFja3M6IDAgfTtcbiAgICB0aGlzLnMgPSBuZXdTdGFnZSh7IC4uLkVORExFU1NfUlVMRVMsIHBvb2w6IHN2LmRlY2sgfSwgc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpOyAgIC8vIChhIGJhdHRsZSBsZWZ0IGhhbGYtd2F5IGhhZCBoaWRkZW4gdGhlIGdyaWQpXG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBudWxsOyB0aGlzLnBoYXNlID0gJ2J1aWxkJztcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnNldENhbSh0aGlzLnBvc2VzKCkuYnVpbGQpOyB0aGlzLnRvYXN0KCdFbmRsZXNzIERlcHRoczogaG93IGRlZXAgY2FuIHlvdSBnbz8gQSBTb3VsIFBhY2sgZXZlcnkgMTAgd2F2ZXMuJyk7XG4gIH1cbiAgcHJpdmF0ZSBjbGVhckJhdHRsZSgpIHtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYuZGlzcG9zZSgpOyB9KTsgdGhpcy5mdmlzLmNsZWFyKCk7IHRoaXMuZlVuaXQuY2xlYXIoKTsgdGhpcy5sYXN0U3RhdGUuY2xlYXIoKTsgdGhpcy5iYXR0bGUgPSBudWxsO1xuICAgIHRoaXMuYXJyb3dzLmZvckVhY2goKGEpID0+IGEubWVzaC5kaXNwb3NlKCkpOyB0aGlzLmFycm93cyA9IFtdO1xuICB9XG4gIHByaXZhdGUgcG9zKGNlbGw6IG51bWJlcikgeyByZXR1cm4gY2VsbFBvcygwLCBjZWxsKTsgfVxuICAvKiogRm9yIHRoZSB0dXRvcmlhbCBzcG90bGlnaHQ6IHdoZXJlIGFuIGVtcHR5IHRpbGUgKHRoZSBvbmUgbmVhcmVzdCB0aGUgbWlkZGxlIG9mIHRoZSBncmlkKSBpcyBvbiB0aGUgc2NyZWVuLCBpbiBDU1MgcGl4ZWxzLCBvciBudWxsLiAqL1xuICBlbXB0eVRpbGVSZWN0KCk6IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHc6IG51bWJlcjsgaDogbnVtYmVyIH0gfCBudWxsIHtcbiAgICBpZiAoIXRoaXMucyB8fCAhdGhpcy5jYW52YXMgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgdXNlZCA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodTogYW55KSA9PiB1LmNlbGwpKTsgbGV0IG14ID0gMCwgbXogPSAwOyBjb25zdCBhbGwgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBHUklEX0NFTExTIH0sIChfLCBjKSA9PiB0aGlzLnBvcyhjKSk7IGFsbC5mb3JFYWNoKChwKSA9PiB7IG14ICs9IHAueCAvIEdSSURfQ0VMTFM7IG16ICs9IHAueiAvIEdSSURfQ0VMTFM7IH0pO1xuICAgIGxldCBiZXN0ID0gLTEsIGJkID0gMWU5OyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgeyBpZiAodXNlZC5oYXMoYykpIGNvbnRpbnVlOyBjb25zdCBkID0gTWF0aC5oeXBvdChhbGxbY10ueCAtIG14LCBhbGxbY10ueiAtIG16KTsgaWYgKGQgPCBiZCkgeyBiZCA9IGQ7IGJlc3QgPSBjOyB9IH1cbiAgICBpZiAoYmVzdCA8IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHAgPSBhbGxbYmVzdF0sIGggPSBHUklEX1NQICogMC40NiwgVyA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCksIEggPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdnAgPSB0aGlzLmNhbWVyYS52aWV3cG9ydC50b0dsb2JhbChXLCBIKSwgbSA9IHRoaXMuc2NlbmUuZ2V0VHJhbnNmb3JtTWF0cml4KCk7XG4gICAgY29uc3QgcHRzID0gW1staCwgLWhdLCBbaCwgLWhdLCBbaCwgaF0sIFstaCwgaF1dLm1hcCgoW2R4LCBkel0pID0+IEJBQllMT04uVmVjdG9yMy5Qcm9qZWN0KG5ldyBCQUJZTE9OLlZlY3RvcjMocC54ICsgZHgsIDAuMDIsIHAueiArIGR6KSwgQkFCWUxPTi5NYXRyaXguSWRlbnRpdHkoKSwgbSwgdnApKTtcbiAgICBjb25zdCByID0gdGhpcy5jYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCksIGt4ID0gci53aWR0aCAvIFcsIGt5ID0gci5oZWlnaHQgLyBILCB4cyA9IHB0cy5tYXAoKHE6IGFueSkgPT4gcS54KSwgeXMgPSBwdHMubWFwKChxOiBhbnkpID0+IHEueSk7XG4gICAgY29uc3QgeDAgPSBNYXRoLm1pbiguLi54cyksIHgxID0gTWF0aC5tYXgoLi4ueHMpLCB5MCA9IE1hdGgubWluKC4uLnlzKSwgeTEgPSBNYXRoLm1heCguLi55cyk7XG4gICAgaWYgKCFpc0Zpbml0ZSh4MCArIHgxICsgeTAgKyB5MSkpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IHg6IHIubGVmdCArIHgwICoga3gsIHk6IHIudG9wICsgeTAgKiBreSwgdzogKHgxIC0geDApICoga3gsIGg6ICh5MSAtIHkwKSAqIGt5IH07XG4gIH1cbiAgc3luY0J1aWxkKCkge1xuICAgIHRoaXMucGVyc2lzdFJ1bigpO1xuICAgIGNvbnN0IG1lcmdlZCA9IHRoaXMucy5zdGF0cy5tZXJnZXMgPiB0aGlzLnNlZW5NZXJnZXM7IHRoaXMuc2Vlbk1lcmdlcyA9IHRoaXMucy5zdGF0cy5tZXJnZXM7XG4gICAgY29uc3QgZ3Jvd24gPSBtZXJnZWQgPyB0aGlzLnMudW5pdHMuZmluZCgodSkgPT4geyBjb25zdCBndiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IHJldHVybiAhIWd2ICYmIGd2LnN0YXIgIT09IHUuc3RhcjsgfSkgOiB1bmRlZmluZWQ7ICAgLy8gdGhlIHVuaXQgdGhhdCBqdXN0IGdhaW5lZCBhIHN0YXJcbiAgICBjb25zdCBhbGl2ZSA9IG5ldyBTZXQodGhpcy5zLnVuaXRzLm1hcCgodSkgPT4gdS5pZCkpO1xuICAgIGZvciAoY29uc3QgW2lkLCB2XSBvZiB0aGlzLnVuaXRWaXMpIGlmICghYWxpdmUuaGFzKGlkKSkge1xuICAgICAgdGhpcy52aXNUb1VuaXQuZGVsZXRlKHYpOyB0aGlzLnVuaXRWaXMuZGVsZXRlKGlkKTsgY29uc3QgcCA9IHYuaG9sZGVyLnBvc2l0aW9uO1xuICAgICAgaWYgKGdyb3duKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbWVyZ2U6IHRoZSBjb25zdW1lZCB1bml0IGlzIGRyYXduIGludG8gdGhlIHN1cnZpdm9yIGFuZCB2YW5pc2hlcyBpbiBhIGZsYXNoXG4gICAgICAgIGNvbnN0IHRvID0gdGhpcy5wb3MoZ3Jvd24uY2VsbCksIHgwID0gcC54LCB6MCA9IHAueiwgc2MgPSB2LmhvbGRlci5zY2FsaW5nLng7IHYucGxheSgnaWRsZScpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuMzMsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC40LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHNjICogKDEgLSAwLjc1ICogdCkpOyB9LFxuICAgICAgICAgICgpID0+IHsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDE0KTsgdi5kaXNwb3NlKCk7IH0pO1xuICAgICAgfSBlbHNlIHsgdGhpcy5idXJzdChwLngsIHAueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxNik7IHYuZGlzcG9zZSgpOyB9XG4gICAgfVxuICAgIGNvbnN0IGx2bHMgPSBsb2FkU2F2ZSgpLnNvdWxzO1xuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHtcbiAgICAgIGxldCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7XG4gICAgICBpZiAoIXYpIHsgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIHUuc291bCwgMCwgdS5zdGFyKTsgdGhpcy51bml0VmlzLnNldCh1LmlkLCB2KTsgdGhpcy52aXNUb1VuaXQuc2V0KHYsIHUuaWQpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyB2LmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7IGF1ZGlvLnBsYXkoJ3N1bW1vbicpOyBjb25zdCB2diA9IHY7IHRoaXMubGF0ZXIoMS4xLCAoKSA9PiB7IGlmICh0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB2di5wbGF5KCdpZGxlJyk7IH0pOyB9XG4gICAgICBlbHNlIHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyBpZiAodi5zdGFyICE9PSB1LnN0YXIpIHsgY29uc3QgZnYgPSB2OyB2LnNldFN0YXIodS5zdGFyKTsgdGhpcy5sYXRlcihncm93biAmJiBncm93bi5pZCA9PT0gdS5pZCA/IDAuMzMgOiAwLCAoKSA9PiB0aGlzLm1lcmdlRngoZnYsIHAueCwgcC56KSk7IH0gfVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7IGNvbnN0IHZ2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKTsgaWYgKHZ2ICYmIHZ2LnNldExldmVsKSB2di5zZXRMZXZlbCgobHZscyBhcyBhbnkpW3Uuc291bF0/LmxldmVsID8/IDEpOyB9XG4gICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHRoaXMudGludChjLCAnbm9ybWFsJyk7XG4gICAgY29uc3Qgc2VsID0gdGhpcy5zZWw7XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnICYmIHRoaXMucGhhc2UgPT09ICdidWlsZCcpIHtcbiAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoY2VsbEZyZWUodGhpcy5zLCBjKSkgdGhpcy50aW50KGMsIGNhblN1bW1vbih0aGlzLnMsIHNlbC5pZHgpID8gJ2ZyZWUnIDogJ25vcm1hbCcpO1xuICAgICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgaWYgKGNhbk1lcmdlRnJvbUhhbmQodGhpcy5zLCBzZWwuaWR4LCB1LmlkKSkgdGhpcy50aW50KHUuY2VsbCwgJ3BhcnRuZXInKTsgICAgIC8vIHRoZSBjYXJkIGNhbiBtZXJnZSBpbnRvIHRoaXMgdW5pdFxuICAgIH1cbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAndW5pdCcpIHtcbiAgICAgIGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gc2VsLmlkKTtcbiAgICAgIGlmICh1KSB7IHRoaXMudGludCh1LmNlbGwsICdzZWwnKTsgZm9yIChjb25zdCBvIG9mIHRoaXMucy51bml0cykgaWYgKGNhbk1lcmdlRGVwbG95ZWQodSwgbykpIHRoaXMudGludChvLmNlbGwsICdwYXJ0bmVyJyk7IGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoY2VsbEZyZWUodGhpcy5zLCBjKSkgdGhpcy50aW50KGMsICdmcmVlJyk7IH1cbiAgICB9XG4gIH1cbiAgLyoqIFRoZSBtZXJnZSBtb21lbnQ6IGEgZmxhc2ggb2YgcmluZ3MgYW5kIHNwYXJrcywgYSBwdW5jaCBpbiBzaXplLCBhIHJpc2luZyBjaGltZS4gKi9cbiAgcHJpdmF0ZSBtZXJnZUZ4KHY6IFVuaXRWaXN1YWwsIHg6IG51bWJlciwgejogbnVtYmVyKSB7XG4gICAgYXVkaW8ucGxheSgnbWVyZ2UnKTsgdi5wdWxzZSgpOyBjb25zdCB0YXJnZXQgPSB2LmhvbGRlci5zY2FsaW5nLng7XG4gICAgdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuODUsIDAuNCksIDAuMiwgMi4wLCAwLjY1KTsgdGhpcy5sYXRlcigwLjEyLCAoKSA9PiB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMSwgMSksIDAuMiwgMy4wLCAwLjgpKTtcbiAgICB0aGlzLmJ1cnN0KHgsIHosIFsxLCAwLjg1LCAwLjQsIDAuOV0sIFswLjgsIDAuNCwgMSwgMC44XSwgNDYpOyB0aGlzLmJ1cnN0KHgsIHosIFswLjg1LCAwLjYsIDEsIDAuOV0sIFswLjUsIDAuMywgMSwgMC43XSwgMjQpO1xuICAgIHRoaXMudHdlZW4oMC41NSwgKHQpID0+IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRhcmdldCAqICgxICsgMC40NSAqIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqICgxIC0gdCAqIDAuNCkpKSwgKCkgPT4gdi5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGFyZ2V0KSk7XG4gIH1cbiAgcHJpdmF0ZSBzdW1tb25GeCh4OiBudW1iZXIsIHo6IG51bWJlcikgeyB0aGlzLmJ1cnN0KHgsIHosIFswLjcsIDAuMywgMSwgMC45XSwgWzAuMzUsIDAuMSwgMC43LCAwLjhdLCAzMCk7IHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygwLjcsIDAuMywgMSksIDAuMiwgMS4yLCAwLjcpOyB9XG5cbiAgLy8gLS0tLSBwbGF5ZXIgYWN0aW9ucyAoYnVpbGQgcGhhc2UpXG4gIHRvYXN0KG1zZzogc3RyaW5nKSB7IHRoaXMudWkudG9hc3QobXNnKTsgfVxuICBvbkNhcmQoaWR4OiBudW1iZXIpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGlmICh0aGlzLnN3YXBNb2RlKSB7IGlmIChkaXNjYXJkUmVkcmF3KHRoaXMucywgaWR4KSkgeyB0aGlzLnRvYXN0KCdTd2FwcGVkOiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuJyk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIHRoaXMuc2VsID0gdGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ2NhcmQnICYmIHRoaXMuc2VsLmlkeCA9PT0gaWR4ID8gbnVsbCA6IHsgdHlwZTogJ2NhcmQnLCBpZHggfTtcbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBvblRpbGUoY2VsbDogbnVtYmVyKSB7XG4gICAgY29uc3QgcyA9IHRoaXMucywgc2VsID0gdGhpcy5zZWw7IGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgY29uc3QgaGVyZSA9IHMudW5pdHMuZmluZCgodSkgPT4gdS5jZWxsID09PSBjZWxsKTsgaWYgKGhlcmUpIHsgdGhpcy5vblVuaXRWaXN1YWwodGhpcy51bml0VmlzLmdldChoZXJlLmlkKSEpOyByZXR1cm47IH1cbiAgICBpZiAoc2VsICYmIHNlbC50eXBlID09PSAnY2FyZCcpIHtcbiAgICAgIGlmIChjYW5TdW1tb24ocywgc2VsLmlkeCkpIHsgc3VtbW9uKHMsIHNlbC5pZHgsIGNlbGwpOyB0aGlzLnNlbCA9IG51bGw7IH1cbiAgICAgIGVsc2UgeyBjb25zdCBzb3VsID0gcy5oYW5kW3NlbC5pZHhdOyB0aGlzLnRvYXN0KGBOb3QgZW5vdWdoIERvbWluaW9uOiAke1NPVUxfTkFNRVtzb3VsXX0gY29zdHMgJHtjb3N0KHNvdWwsIDEpfSwgeW91IGhhdmUgJHtkb21pbmlvbkZyZWUocyl9IGZyZWUuYCk7IH1cbiAgICB9IGVsc2UgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7IGlmIChtb3ZlVW5pdChzLCBzZWwuaWQsIGNlbGwpKSB0aGlzLnNlbCA9IG51bGw7IH1cbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBvblVuaXRWaXN1YWwodjogVW5pdFZpc3VhbCkge1xuICAgIGNvbnN0IGlkID0gdGhpcy52aXNUb1VuaXQuZ2V0KHYpOyBpZiAoaWQgPT09IHVuZGVmaW5lZCB8fCB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47XG4gICAgY29uc3QgcyA9IHRoaXMucywgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpITtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoc3dhcFNlbGwocywgaWQpKSB7IHRoaXMudG9hc3QoYFNvbGQgJHtTT1VMX05BTUVbdS5zb3VsXX06IGRyZXcgYSBkaWZmZXJlbnQgU291bC5gKTsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB9IGVsc2UgdGhpcy50b2FzdCh1LmZyZXNoID8gXCJZb3UgY2FuJ3Qgc2VsbCBhIHVuaXQgeW91IHN1bW1vbmVkIHRoaXMgcm91bmQuXCIgOiAnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiBzLmhhbmRbdGhpcy5zZWwuaWR4XSA9PT0gdS5zb3VsICYmIHUuc3RhciA9PT0gMSAmJiBzLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJykge1xuICAgICAgaWYgKG1lcmdlRnJvbUhhbmQocywgdGhpcy5zZWwuaWR4LCBpZCkpIHsgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQgfTsgdGhpcy50b2FzdChgTWVyZ2VkIHRoZSBjYXJkIGludG8gYSAyLXN0YXIgJHtTT1VMX05BTUVbdS5zb3VsXX0hYCk7IH1cbiAgICAgIGVsc2UgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbiB0byBtZXJnZTogaXQgbmVlZHMgJHtjb3N0KHUuc291bCwgMikgLSBjb3N0KHUuc291bCwgMSl9IG1vcmUsIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApO1xuICAgIH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAndW5pdCcgJiYgdGhpcy5zZWwuaWQgIT09IGlkKSB7XG4gICAgICBjb25zdCBhID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSAodGhpcy5zZWwgYXMgYW55KS5pZCkhO1xuICAgICAgaWYgKGNhbk1lcmdlRGVwbG95ZWQoYSwgdSkpIHsgbWVyZ2VEZXBsb3llZChzLCBhLmlkLCB1LmlkKTsgdGhpcy5zZWwgPSB7IHR5cGU6ICd1bml0JywgaWQ6IGEuaWQgfTsgdGhpcy50b2FzdChgTWVyZ2VkIGludG8gYSAke2Euc3Rhcn0tc3RhciAke1NPVUxfTkFNRVthLnNvdWxdfSFgKTsgfSBlbHNlIHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgfSBlbHNlIHRoaXMuc2VsID0gdGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkID09PSBpZCA/IG51bGwgOiB7IHR5cGU6ICd1bml0JywgaWQgfTtcbiAgICB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBtZXJnZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gc2VsLmlkKTsgY29uc3QgYiA9IGEgJiYgcy51bml0cy5maW5kKChvKSA9PiBjYW5NZXJnZURlcGxveWVkKGEsIG8pKTtcbiAgICBpZiAoYSAmJiBiKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgYi5pZCk7IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnRvYXN0KCdObyBtYXRjaGluZyB1bml0IChzYW1lIFNvdWwgYW5kIHN0YXJzKSB0byBtZXJnZSB3aXRoLicpO1xuICAgIHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgcmVtb3ZlU2VsZWN0ZWQoKSB7XG4gICAgY29uc3Qgc2VsID0gdGhpcy5zZWw7IGlmICghc2VsIHx8IHNlbC50eXBlICE9PSAndW5pdCcpIHJldHVybjtcbiAgICBpZiAoIXRoaXMuY29uZmlybVJlbW92ZSkgeyB0aGlzLmNvbmZpcm1SZW1vdmUgPSB0cnVlOyB0aGlzLnRvYXN0KCdUYXAgUmVtb3ZlIGFnYWluIHRvIGNvbmZpcm0uIFRoZSBjYXJkIGlzIGdvbmUgZm9yIHRoaXMgc3RhZ2UuJyk7IHRoaXMudWkucmVuZGVyKCk7IHJldHVybjsgfVxuICAgIGRpc21pc3ModGhpcy5zLCBzZWwuaWQpOyB0aGlzLnNlbCA9IG51bGw7IHRoaXMuY29uZmlybVJlbW92ZSA9IGZhbHNlOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHRvZ2dsZVN3YXAoKSB7IGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSByZXR1cm47IGlmICh0aGlzLnMuZGlzY2FyZFVzZWQpIHsgdGhpcy50b2FzdCgnU3dhcCBhbHJlYWR5IHVzZWQgdGhpcyByb3VuZC4nKTsgcmV0dXJuOyB9IHRoaXMuc3dhcE1vZGUgPSAhdGhpcy5zd2FwTW9kZTsgdGhpcy5zZWwgPSBudWxsOyBpZiAodGhpcy5zd2FwTW9kZSkgdGhpcy50b2FzdCgnU3dhcDogdGFwIGEgaGFuZCBjYXJkIHRvIGRpc2NhcmQsIG9yIGEgdW5pdCAobm90IHN1bW1vbmVkIHRoaXMgcm91bmQpIHRvIHNlbGwuJyk7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBiYXR0bGVcbiAgc3RhcnRCYXR0bGUoKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcgfHwgIXRoaXMucy51bml0cy5sZW5ndGgpIHsgaWYgKCF0aGlzLnMudW5pdHMubGVuZ3RoKSB0aGlzLnRvYXN0KCdTdW1tb24gYXQgbGVhc3Qgb25lIHVuaXQgZmlyc3QuJyk7IHJldHVybjsgfVxuICAgIHRoaXMuZmx1c2hUd2VlbnMoKTsgYXVkaW8ucGxheSgnc3RhcnQnKTsgdGhpcy5iZWdpbkJhdHRsZVBlcmYoKTsgdGhpcy5zaG93R3JpZChmYWxzZSk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuYXR0ZW1wdCsrOyB0aGlzLmhhbmRsZWQgPSBmYWxzZTsgdGhpcy5yZXN1bHRBdCA9IC0xO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHVuaXRzID0gcy51bml0cy5zbGljZSgpO1xuICAgIGNvbnN0IHNhdmVkID0gbG9hZFNhdmUoKS5zb3VscywgbGV2ZWxzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307IGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhzYXZlZCkpIGxldmVsc1trXSA9IChzYXZlZCBhcyBhbnkpW2tdLmxldmVsOyAgIC8vIHBlcm1hbmVudCBTb3VsIGxldmVsc1xuICAgIHRoaXMuYmF0dGxlID0gbmV3IEJhdHRsZSh1bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVteVdhdmUocy53YXZlLCB0aGlzLnNlZWQpLCB0aGlzLnNlZWQgKiAxMzEgKyBzLndhdmUgKiAxNyArIHRoaXMuYXR0ZW1wdCwgbGV2ZWxzLCBlbmVteVBvd2VyKHMud2F2ZSkpO1xuICAgIHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7XG4gICAgdGhpcy5iYXR0bGUuZmlnaHRlcnMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgaWYgKGYudGVhbSA9PT0gMCkgeyBjb25zdCB1ID0gdW5pdHNbZi5pZCAtIDFdOyBjb25zdCB2ID0gdGhpcy51bml0VmlzLmdldCh1LmlkKSE7IHRoaXMuZnZpcy5zZXQoZi5pZCwgdik7IHRoaXMuZlVuaXQuc2V0KGYuaWQsIHUuaWQpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB9XG4gICAgICBlbHNlIHsgY29uc3QgdiA9IGNyZWF0ZVZpc3VhbCh0aGlzLkEsIGYuc291bCwgMSwgZi5zdGFyKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KGYueCwgMCwgZi56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IC1NYXRoLlBJIC8gMjsgdi5wbGF5KCdzcGF3bicpOyB2LnNldEhwKDEpOyB2LnNldE1hbmEoZi5tYXhNYW5hID8gMCA6IG51bGwpOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmxhdGVyKDEuMSwgKCkgPT4geyBpZiAodi5zdGF0ZSA9PT0gJ3NwYXduJykgdi5wbGF5KCdpZGxlJyk7IH0pOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC43LCAwLjYsIDAuNSwgMC43XSwgWzAuNCwgMC4zNSwgMC4zLCAwLjZdLCAxNCk7IH1cbiAgICB9KTtcbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgdGhpcy50aW50KGMsICdub3JtYWwnKTtcbiAgICB0aGlzLnBoYXNlID0gJ3RyYW5zaXRpb24nOyB0aGlzLnN0YXJ0U3RlcEF0ID0gMS4wOyB0aGlzLmFjYyA9IDA7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJhdHRsZSwgMi4yKTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5iYXR0bGVSb2FyKCk7XG4gIH1cbiAgcHJpdmF0ZSBhcHBseUV2ZW50cyhldnM6IEJFdmVudFtdKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlITtcbiAgICBmb3IgKGNvbnN0IGUgb2YgZXZzKSB7XG4gICAgICBpZiAoZS50ID09PSAnc3dpbmcnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUuaWQpOyBpZiAodikgdi5wbGF5KCdhdHRhY2snLCBlLnNwZWVkKTsgaWYgKE1hdGgucmFuZG9tKCkgPCAwLjA4KSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCk7IGlmIChmKSBhdWRpby5iYXJrKGYuc291bCwgMCwgZi50ZWFtID09PSAwID8gMSA6IDAuODUpOyB9IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2hpdCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS50byk7IGlmICh2KSB2LnB1bHNlKCk7IGlmIChlLmtpbmQgPT09ICdhcnJvdycpIGF1ZGlvLnBsYXkoJ2hpdEFycm93Jyk7IGVsc2UgaWYgKGUua2luZCA9PT0gJ21lbGVlJykgYXVkaW8ucGxheSgnaGl0Jyk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Fycm93JykgeyBjb25zdCBmID0gYi5ieUlkKGUuZnJvbSkhLCB0byA9IGIuYnlJZChlLnRvKSE7IHRoaXMuc3Bhd25BcnJvdyhmLnRlYW0sIGYueCwgZi56LCB0by54LCB0by56LCBlLmR1cik7IGF1ZGlvLnBsYXkoJ2Fycm93Jyk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2RlYXRoJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHsgdi5wbGF5KCdkZWF0aCcpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCdkZWF0aCcpOyB0aGlzLmJ1cnN0KGYueCwgZi56LCBbMC42LCAwLjUsIDAuNywgMC44XSwgWzAuMywgMC4yLCAwLjUsIDAuNl0sIDEyKTsgaWYgKGYudGVhbSA9PT0gMSkgdGhpcy5sYXRlcig1LCAoKSA9PiB7IGlmICh0aGlzLmZ2aXMuZ2V0KGUuaWQpID09PSB2ICYmIHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHsgdi5ob2xkZXIuc2V0RW5hYmxlZChmYWxzZSk7IH0gfSk7IH0gfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnY2FzdCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ2Nhc3QnKTsgdGhpcy5meFJpbmcoZi54LCBmLnosIG5ldyBCQUJZTE9OLkNvbG9yMygwLjUsIDAuOCwgMSksIDAuMTUsIDEuMSwgMC4zNSk7IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ3RhdW50JykgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgndGF1bnQnKTsgdGhpcy5meFJpbmcoZi54LCBmLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjMpLCAwLjMsIEJBTEFOQ0UudGF1bnQucmFkaXVzLCAwLjYpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdzbWFzaCcpIHsgYXVkaW8ucGxheSgnc21hc2gnKTsgdGhpcy5meFJpbmcoZS54LCBlLnosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjUsIDAuMiksIDAuMiwgZS5yICogMS42LCAwLjQ1KTsgfVxuICAgIH1cbiAgfVxuICBwcml2YXRlIGFycm93QmFzZTogYW55W10gPSBbXTtcbiAgLyoqIFRoZSBhcnJvdydzIG93biBtYXRlcmlhbCB3aXRoIGEgZmFpbnQgZ2xvdyBpbiB0aGUgdGVhbSBjb2xvdXIgKHB1cnBsZSBmb3IgeW91cnMsIGFtYmVyIGZvciB0aGUgZW5lbXkncyksIHNvIHlvdSBjYW4gc3RpbGwgdGVsbCB3aG9zZSBpdCBpcy4gKi9cbiAgcHJpdmF0ZSBhcnJvd1RlYW1NYXQodGVhbTogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMuYXJyb3dCYXNlW3RlYW1dKSByZXR1cm4gdGhpcy5hcnJvd0Jhc2VbdGVhbV07XG4gICAgY29uc3Qgc3JjID0gdGhpcy5BLmFycm93Lm1hdGVyaWFscyAmJiB0aGlzLkEuYXJyb3cubWF0ZXJpYWxzWzBdOyBpZiAoIXNyYykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgbSA9IHNyYy5jbG9uZSgnYXJyb3dUJyArIHRlYW0pOyBjb25zdCBjID0gdGVhbSA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjU1LCAwLjIsIDAuODUpIDogbmV3IEJBQllMT04uQ29sb3IzKDAuOSwgMC41NSwgMC4xNSk7XG4gICAgaWYgKCdlbWlzc2l2ZUNvbG9yJyBpbiBtKSBtLmVtaXNzaXZlQ29sb3IgPSBjLnNjYWxlKDAuMDM1KTsgdGhpcy5hcnJvd0Jhc2VbdGVhbV0gPSBtOyByZXR1cm4gbTtcbiAgfVxuICBwcml2YXRlIHNwYXduQXJyb3codGVhbTogbnVtYmVyLCB4MDogbnVtYmVyLCB6MDogbnVtYmVyLCB4MTogbnVtYmVyLCB6MTogbnVtYmVyLCBkdXI6IG51bWJlcikge1xuICAgIGxldCBtZXNoID0gdGhpcy5hcnJvd01lc2gucG9wKCk7XG4gICAgaWYgKCFtZXNoKSB7XG4gICAgICBjb25zdCBob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCdhcicsIHRoaXMuc2NlbmUpOyBob2xkZXIuc2NhbGluZy5zZXRBbGwoMC42NSk7ICAgLy8gNTUgY20gd2FzIGxvbmcgbmV4dCB0byBhIGNoaWJpIEdvYmxpblxuICAgICAgaWYgKHRoaXMuQS5hcnJvdykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSByZWFsIGFycm93IG1vZGVsIChtZXRhbCBoZWFkLCBmbGV0Y2hpbmcpOiBvbmUgaW5zdGFuY2UgcGVyIGZseWluZyBhcnJvd1xuICAgICAgICBjb25zdCBlbnQgPSB0aGlzLkEuYXJyb3cuaW5zdGFudGlhdGVNb2RlbHNUb1NjZW5lKChuOiBzdHJpbmcpID0+IG4gKyAnXycgKyBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA2KSwgZmFsc2UpO1xuICAgICAgICBlbnQucm9vdE5vZGVzWzBdLnBhcmVudCA9IGhvbGRlcjsgZW50LnJvb3ROb2Rlc1swXS5nZXRDaGlsZE1lc2hlcygpLmZvckVhY2goKG06IGFueSkgPT4geyBtLmlzUGlja2FibGUgPSBmYWxzZTsgbS5hbHdheXNTZWxlY3RBc0FjdGl2ZU1lc2ggPSB0cnVlOyB9KTtcbiAgICAgIH0gZWxzZSB7IGNvbnN0IGN5bCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2Fycm93JywgeyBoZWlnaHQ6IDAuNTUsIGRpYW1ldGVyOiAwLjAzNSB9LCB0aGlzLnNjZW5lKTsgY3lsLnJvdGF0aW9uLnggPSBNYXRoLlBJIC8gMjsgY3lsLmlzUGlja2FibGUgPSBmYWxzZTsgY3lsLnBhcmVudCA9IGhvbGRlcjsgY3lsLm1hdGVyaWFsID0gdGhpcy5hcnJvd01hdHNbdGVhbV07IH1cbiAgICAgIG1lc2ggPSBob2xkZXI7XG4gICAgfVxuICAgIG1lc2guc2V0RW5hYmxlZCh0cnVlKTtcbiAgICBpZiAodGhpcy5BLmFycm93KSB7IGNvbnN0IHRtID0gdGhpcy5hcnJvd1RlYW1NYXQodGVhbSk7IG1lc2guZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgaWYgKHRtKSBtLm1hdGVyaWFsID0gdG07IH0pOyB9XG4gICAgdGhpcy5hcnJvd3MucHVzaCh7IG1lc2gsIHgwLCB6MCwgeDEsIHoxLCB0OiAwLCBkdXIgfSk7XG4gIH1cblxuICAvKiogQmF0dGxlIGNyeTogdXAgdG8gdGhyZWUgZGlmZmVyZW50IFNvdWxzIGZyb20geW91ciBhcm15IGJlbGxvdyBpbiB0dXJuLCBhbmQgb25lIGZyb20gdGhlIGVuZW15IGFuc3dlcnMsIGEgbGl0dGxlIGxvd2VyLiAqL1xuICBwcml2YXRlIGJhdHRsZVJvYXIoKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlOyBpZiAoIWIpIHJldHVybjsgY29uc3QgbWluZSA9IG5ldyBTZXQ8c3RyaW5nPigpLCB0aGVpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykgKGYudGVhbSA9PT0gMCA/IG1pbmUgOiB0aGVpcnMpLmFkZChmLnNvdWwpO1xuICAgIFsuLi5taW5lXS5zbGljZSgwLCAzKS5mb3JFYWNoKChzb3VsLCBpKSA9PiBhdWRpby5iYXJrKHNvdWwsIDAuMTUgKyAwLjE2ICogaSwgMSkpOyBjb25zdCBlID0gWy4uLnRoZWlyc11bMF07IGlmIChlKSBhdWRpby5iYXJrKGUsIDAuNTUsIDAuODIpO1xuICB9XG5cbiAgcHJpdmF0ZSBmcmFtZShkdDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMuY2FudmFzLmNsaWVudFdpZHRoICE9PSB0aGlzLmxhc3RXIHx8IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCAhPT0gdGhpcy5sYXN0SCkgdGhpcy5oYW5kbGVSZXNpemUoKTsgICAvLyBlLmcuIHRoZSBob21lLXNjcmVlbiBhcHAgcmVzaXppbmcgYWZ0ZXIgbGF1bmNoXG4gICAgZm9yIChsZXQgaSA9IHRoaXMudGltZXJzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IHRoaXMudGltZXJzW2ldLnQgLT0gZHQ7IGlmICh0aGlzLnRpbWVyc1tpXS50IDw9IDApIHsgY29uc3QgZiA9IHRoaXMudGltZXJzW2ldLmZuOyB0aGlzLnRpbWVycy5zcGxpY2UoaSwgMSk7IGYoKTsgfSB9XG4gICAgZm9yIChsZXQgaSA9IHRoaXMucmluZ0Z4Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHIgPSB0aGlzLnJpbmdGeFtpXTsgci50ICs9IGR0OyBjb25zdCB1ID0gci50IC8gci5kdXIsIHMgPSByLnIwICsgKHIucjEgLSByLnIwKSAqIHU7IHIubS5zY2FsaW5nLnNldChzLCBzLCBzKTsgci5tbS5hbHBoYSA9IDAuOSAqICgxIC0gdSk7IGlmICh1ID49IDEpIHsgci5tLmRpc3Bvc2UoKTsgci5tbS5kaXNwb3NlKCk7IHRoaXMucmluZ0Z4LnNwbGljZShpLCAxKTsgfSB9XG4gICAgaWYgKHRoaXMuY2FtVCA8IDEpIHsgdGhpcy5jYW1UID0gTWF0aC5taW4oMSwgdGhpcy5jYW1UICsgZHQgLyB0aGlzLmNhbUR1cik7IGNvbnN0IGUgPSB0aGlzLmNhbVQgKiB0aGlzLmNhbVQgKiAoMyAtIDIgKiB0aGlzLmNhbVQpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbiA9IEJBQllMT04uVmVjdG9yMy5MZXJwKHRoaXMuY2FtRnJvbS5wb3MsIHRoaXMuY2FtVG8ucG9zLCBlKTsgdGhpcy5jYW1UZ3QgPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20udGd0LCB0aGlzLmNhbVRvLnRndCwgZSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnICYmIHRoaXMuY2FtTW9kZSA9PT0gJ2Nsb3NlJyAmJiAhdGhpcy5jaW5lKSB0aGlzLmZyYW1lQmF0dGxlKGR0KTtcbiAgICB0aGlzLm5lY3JvLnVwZGF0ZShkdCk7XG4gICAgZm9yIChsZXQgaSA9IHRoaXMudHdlZW5zLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7IGNvbnN0IHcgPSB0aGlzLnR3ZWVuc1tpXTsgdy50ICs9IGR0OyBjb25zdCB1ID0gTWF0aC5taW4oMSwgdy50IC8gdy5kdXIpOyB3LmZuKHUpOyBpZiAodSA+PSAxKSB7IHRoaXMudHdlZW5zLnNwbGljZShpLCAxKTsgaWYgKHcuZG9uZSkgdy5kb25lKCk7IH0gfVxuICAgIGZvciAoY29uc3QgdiBvZiB0aGlzLnVuaXRWaXMudmFsdWVzKCkpIHYudXBkYXRlKGR0KTtcbiAgICB0aGlzLmZ2aXMuZm9yRWFjaCgodiwgaWQpID0+IHsgaWYgKCF0aGlzLmZVbml0LmhhcyhpZCkpIHYudXBkYXRlKGR0KTsgfSk7XG5cbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7XG4gICAgaWYgKCh0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicgfHwgdGhpcy5waGFzZSA9PT0gJ2JhdHRsZScpICYmIGIpIHtcbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpIHsgdGhpcy5zdGFydFN0ZXBBdCAtPSBkdDsgaWYgKHRoaXMuc3RhcnRTdGVwQXQgPD0gMCkgeyB0aGlzLnBoYXNlID0gJ2JhdHRsZSc7IHRoaXMudWkucmVuZGVyKCk7IH0gfVxuICAgICAgaWYgKHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSB7XG4gICAgICAgIHRoaXMuYWNjICs9IGR0ICogdGhpcy50aW1lU2NhbGU7XG4gICAgICAgIHdoaWxlICh0aGlzLmFjYyA+PSAxIC8gMzAgJiYgYi53aW5uZXIgPCAwKSB7IGIuc3RlcCgxIC8gMzApOyB0aGlzLmFjYyAtPSAxIC8gMzA7IHRoaXMuYXBwbHlFdmVudHMoYi5kcmFpbigpKTsgfVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdikgY29udGludWU7XG4gICAgICAgIGlmICghdGhpcy5jaW5lICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCBmLnRlYW0gPT09IDEpKSB7IHYuaG9sZGVyLnBvc2l0aW9uLnggPSBmLng7IHYuaG9sZGVyLnBvc2l0aW9uLnogPSBmLno7IGlmIChmLmFsaXZlIHx8IHRydWUpIHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBmLnlhdzsgfVxuICAgICAgICBpZiAoZi5hbGl2ZSkgeyB2LnNldEhwKGYuaHAgLyBmLm1heEhwKTsgaWYgKGYubWF4TWFuYSkgdi5zZXRNYW5hKGYubWFuYSAvIGYubWF4TWFuYSk7IH1cbiAgICAgICAgZWxzZSB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmIChmLnN0YXRlICE9PSAnYXR0YWNrJyAmJiBmLmFsaXZlICYmIHYuc3RhdGUgIT09ICdjaGVlcicpIHsgY29uc3Qgd2FudCA9IGYuc3RhdGUgPT09ICdydW4nID8gJ3J1bicgOiAnaWRsZSc7IGlmICh0aGlzLmxhc3RTdGF0ZS5nZXQoZi5pZCkgIT09IHdhbnQgfHwgKHYuc3RhdGUgIT09IHdhbnQgJiYgdi5zdGF0ZSAhPT0gJ3NwYXduJykpIHsgaWYgKHYuc3RhdGUgIT09ICdzcGF3bicpIHsgdi5wbGF5KHdhbnQgYXMgYW55KTsgdGhpcy5sYXN0U3RhdGUuc2V0KGYuaWQsIHdhbnQpOyB9IH0gfVxuICAgICAgICBpZiAoZi5zdGF0ZSA9PT0gJ2F0dGFjaycpIHRoaXMubGFzdFN0YXRlLnNldChmLmlkLCAnYXR0YWNrJyk7XG4gICAgICB9XG4gICAgICBpZiAoYi53aW5uZXIgPj0gMCAmJiAhdGhpcy5oYW5kbGVkKSB7IHRoaXMuaGFuZGxlZCA9IHRydWU7IHRoaXMucmVzdWx0QXQgPSAxLjQ7IH1cbiAgICAgIGlmICh0aGlzLnJlc3VsdEF0ID4gMCkgeyB0aGlzLnJlc3VsdEF0IC09IGR0OyBpZiAodGhpcy5yZXN1bHRBdCA8PSAwKSB0aGlzLmhhbmRsZVJlc3VsdCgpOyB9XG4gICAgfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLmFycm93cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgYSA9IHRoaXMuYXJyb3dzW2ldOyBhLnQgKz0gZHQgKiB0aGlzLnRpbWVTY2FsZTsgY29uc3QgdSA9IE1hdGgubWluKDEsIGEudCAvIGEuZHVyKTtcbiAgICAgIGNvbnN0IHB4ID0gYS54MCArIChhLngxIC0gYS54MCkgKiB1LCBweiA9IGEuejAgKyAoYS56MSAtIGEuejApICogdSwgcHkgPSAwLjc1ICsgTWF0aC5zaW4odSAqIE1hdGguUEkpICogMC45IC0gdSAqIDAuMjU7XG4gICAgICBjb25zdCB1MiA9IE1hdGgubWluKDEsIHUgKyAwLjAzKSwgcXggPSBhLngwICsgKGEueDEgLSBhLngwKSAqIHUyLCBxeiA9IGEuejAgKyAoYS56MSAtIGEuejApICogdTIsIHF5ID0gMC43NSArIE1hdGguc2luKHUyICogTWF0aC5QSSkgKiAwLjkgLSB1MiAqIDAuMjU7XG4gICAgICBhLm1lc2gucG9zaXRpb24uc2V0KHB4LCBweSwgcHopOyBhLm1lc2gubG9va0F0KG5ldyBCQUJZTE9OLlZlY3RvcjMocXgsIHF5LCBxeikpO1xuICAgICAgaWYgKHUgPj0gMSkgeyBhLm1lc2guc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMuYXJyb3dNZXNoLnB1c2goYS5tZXNoKTsgdGhpcy5hcnJvd3Muc3BsaWNlKGksIDEpOyB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVSZXN1bHQoKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlISwgcyA9IHRoaXMucztcbiAgICB0aGlzLmVuZEJhdHRsZVBlcmYoKTtcbiAgICB0aGlzLmxhc3RCYXR0bGUgPSBgd2F2ZSAke3Mud2F2ZX0gYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH06ICR7Yi53aW5uZXIgPT09IDAgPyAnV09OJyA6ICdMT1NUJ30gaW4gJHtiLnRpbWUudG9GaXhlZCgxKX1zLCAke2IuY291bnQoMCl9IG9mIHlvdXJzIGFuZCAke2IuY291bnQoMSl9IGVuZW1pZXMgbGVmdGA7XG4gICAgaWYgKGIud2lubmVyID09PSAwKSB7XG4gICAgICB0aGlzLnBsYXlSZXN1bHQoJ3dpbicsICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgYXJteSBpcyByYWlzZWQgYWdhaW4sIHRoZW4gdGhlIG5leHQgd2F2ZSAvIHRoZSBkcmFmdFxuICAgICAgICB0aGlzLmNpbmUgPSBmYWxzZTtcbiAgICAgICAgdHJ5IHsgdGhpcy5sYXN0R29sZCA9IHRoaXMuZGFpbHkgPyAwIDogYWRkR29sZEFuZFNhdmUoaXNFbmRsZXNzKCkgPyBlbmRsZXNzV2F2ZUdvbGQocy53YXZlKSA6IHdhdmVHb2xkKGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5TmFtZSBhcyBhbnkpKTsgdGhpcy5ydW5Hb2xkICs9IHRoaXMubGFzdEdvbGQ7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tc2F2ZS1jaGFuZ2VkJykpOyB9IGNhdGNoIHsgdGhpcy5sYXN0R29sZCA9IDA7IH1cbiAgICAgICAgaWYgKGlzRW5kbGVzcygpICYmIHRoaXMuZW5kbGVzcykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByID0gcmVjb3JkRW5kbGVzc1dhdmVBbmRTYXZlKHMud2F2ZSk7IHRoaXMuZW5kbGVzcy5jbGVhcmVkID0gcy53YXZlOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNhdmUtY2hhbmdlZCcpKTtcbiAgICAgICAgICAgIGlmIChyLnBhY2spIHsgdGhpcy5lbmRsZXNzLnBhY2tzKys7IHRoaXMudG9hc3QoJ1dhdmUgJyArIHMud2F2ZSArICcgY2xlYXJlZCEgWW91IGVhcm5lZCBhIFNvdWwgUGFjayAoc2VlIHRoZSBTaG9wKS4nKTsgfVxuICAgICAgICAgIH0gY2F0Y2ggeyAvKiBzYXZpbmcgbXVzdCBuZXZlciBicmVhayBhIHJ1biAqLyB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGFkdmFuY2VXYXZlKHMpKSB7XG4gICAgICAgICAgdGhpcy5waGFzZSA9ICd3b24nOyBjbGVhclJ1bigpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAodGhpcy5kYWlseSkgeyB0aGlzLmRhaWx5UmV3YXJkID0gcmVjb3JkRGFpbHlXaW5BbmRTYXZlKHRoaXMuZGFpbHkuZGF5KTsgdGhpcy5yZXdhcmQgPSBudWxsOyB9IGVsc2UgdGhpcy5yZXdhcmQgPSByZWNvcmRDbGVhckFuZFNhdmUoY3VycmVudFN0YWdlSWQsIGRpZmZpY3VsdHlOYW1lIGFzIGFueSk7XG4gICAgICAgICAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNhdmUtY2hhbmdlZCcpKTtcbiAgICAgICAgICB9IGNhdGNoIHsgdGhpcy5yZXdhcmQgPSBudWxsOyB9XG4gICAgICAgICAgdGhpcy51aS5yZW5kZXIoKTsgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZHJhZnQgPSBkcmFmdE9wdGlvbnMocyk7IHRoaXMucGhhc2UgPSAnZHJhZnQnOyB0aGlzLnBlcnNpc3RSdW4oKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmYWlsV2F2ZShzKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy51aS5wdWxzZUhlYXJ0cygpOyAgICAgICAgICAgICAgICAgICAvLyB0aGUgaGVhcnQgaXMgbG9zdCB0aGUgbW9tZW50IGhlIGlzIGhpdFxuICAgICAgaWYgKHMuc3RhdHVzID09PSAnbG9zdCcpIHRoaXMucGxheVJlc3VsdCgnZmluYWwnLCAoKSA9PiB7IHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnBoYXNlID0gJ2xvc3QnOyBjbGVhclJ1bigpOyB0aGlzLnVpLnJlbmRlcigpOyB9KTtcbiAgICAgIGVsc2UgdGhpcy5wbGF5UmVzdWx0KCdsb3NzJywgKCkgPT4geyB0aGlzLnRvYXN0KCdZb3VyIGFybXkgZmVsbC4gLTEgaGVhcnQsICsxIGNhcmQsIHNhbWUgd2F2ZS4gUmVidWlsZCBhIGRpZmZlcmVudCBzdHJhdGVneS4nKTsgdGhpcy50b0J1aWxkKCk7IH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gcmVzdWx0IGN1dHNjZW5lcyAocGxhbiBzZWN0aW9ucyAxOS0yMik6IHRoZSBOZWNyb21hbmNlciB0YWtlcyB0aGUgaGl0LCB1bmxlYXNoZXMgdGhlIHJlcHVsc2lvbiBzaG9ja3dhdmUsIHJhaXNlcyB0aGUgZmFsbGVuXG4gIHByaXZhdGUgcGxheVJlc3VsdChraW5kOiAnd2luJyB8ICdsb3NzJyB8ICdmaW5hbCcsIGRvbmU6ICgpID0+IHZvaWQpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGUhLCBuID0gdGhpcy5uZWNybzsgdGhpcy5jaW5lID0gdHJ1ZTsgaWYgKGtpbmQgIT09ICd3aW4nKSB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5uZWNybywgMS4xKTtcbiAgICBjb25zdCBob21lID0gKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGV2ZXJ5IGZhbGxlbiBhbGx5IGlzIHB1bGxlZCBiYWNrIHRvIGl0cyBncmlkIHRpbGUgYW5kIHN0YW5kcyB1cFxuICAgICAgbi5jYXN0KCk7IGF1ZGlvLnBsYXkoJ3Jlc3VycmVjdCcpOyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFswLjg1LCAwLjUsIDEsIDAuOV0sIFswLjUsIDAuMiwgMSwgMC43XSwgMzApO1xuICAgICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIHtcbiAgICAgICAgaWYgKGYudGVhbSAhPT0gMCkgY29udGludWU7IGNvbnN0IHVpZCA9IHRoaXMuZlVuaXQuZ2V0KGYuaWQpLCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVpZCksIHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXUgfHwgIXYpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0byA9IHRoaXMucG9zKHUuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7XG4gICAgICAgIGlmICghZi5hbGl2ZSkgeyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuYnVyc3QoeDAsIHowLCBbMC43NSwgMC40LCAxLCAwLjldLCBbMC40LCAwLjE1LCAwLjksIDAuN10sIDE4KTsgdGhpcy5meFJpbmcoeDAsIHowLCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjM1LCAxKSwgMC4zLCAxLjYsIDAuNyk7IH1cbiAgICAgICAgdGhpcy50d2VlbigxLjAsICh0KSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCh4MCArICh0by54IC0geDApICogdCwgTWF0aC5zaW4odCAqIE1hdGguUEkpICogMC41LCB6MCArICh0by56IC0gejApICogdCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgKz0gKE1hdGguUEkgLyAyIC0gdi5ob2xkZXIucm90YXRpb24ueSkgKiBNYXRoLm1pbigxLCB0ICogMC41ICsgMC4xKTsgfSxcbiAgICAgICAgICAoKSA9PiB7IHYuaG9sZGVyLnBvc2l0aW9uLnkgPSAwOyB0aGlzLmJ1cnN0KHRvLngsIHRvLnosIFswLjc1LCAwLjQsIDEsIDAuOV0sIFswLjQsIDAuMTUsIDAuOSwgMC43XSwgMTApOyB9KTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGlmIChraW5kID09PSAnd2luJykge1xuICAgICAgLy8gdGhlIHN1cnZpdm9ycyBjZWxlYnJhdGUgcmlnaHQgd2hlcmUgdGhleSBzdGFuZCAocHVyZWx5IHZpc3VhbCksIFRIRU4gdGhlIGNhbWVyYSBzd2luZ3MgdG8gdGhlIE5lY3JvbWFuY2VyIGFuZCB0aGUgYXJteSBpcyByYWlzZWRcbiAgICAgIGF1ZGlvLnBsYXkoJ3ZpY3RvcnknKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSBpZiAoZi50ZWFtID09PSAwICYmIGYuYWxpdmUpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICh2KSB0aGlzLmxhdGVyKE1hdGgucmFuZG9tKCkgKiAwLjM1LCAoKSA9PiB7IHYucGxheSgnY2hlZXInKTsgYXVkaW8uYmFyayhmLnNvdWwpOyB9KTsgfVxuICAgICAgdGhpcy5sYXRlcigxLjYsICgpID0+IHsgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7IG4uY2FzdCgpOyB9KTtcbiAgICAgIHRoaXMubGF0ZXIoMS44NSwgaG9tZSk7IHRoaXMubGF0ZXIoMy42LCBkb25lKTsgcmV0dXJuO1xuICAgIH1cbiAgICBuLmh1cnQoKTsgYXVkaW8ucGxheSgnaGVhcnRMb3N0Jyk7IHRoaXMubGF0ZXIoMC4xNSwgKCkgPT4geyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7IHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjMsIDAuMywgMC45XSwgWzAuOCwgMC4xLCAwLjIsIDAuNl0sIDE2KTsgfSk7XG4gICAgaWYgKGtpbmQgPT09ICdmaW5hbCcpIHsgdGhpcy5sYXRlcigwLjYsICgpID0+IHsgbi5kZWZlYXQoKTsgYXVkaW8ucGxheSgnZGVmZWF0Jyk7IH0pOyB0aGlzLmxhdGVyKDIuNiwgZG9uZSk7IHJldHVybjsgfVxuICAgIHRoaXMubGF0ZXIoMS4wLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVwdWxzaW9uIHNob2Nrd2F2ZTogc3Vydml2b3JzIGFyZSBmbHVuZyBiYWNrIHRvIHdoZXJlIHRoZXkgc3RhcnRlZCBhbmQgaGVhbCB0byBmdWxsXG4gICAgICBuLmNhc3QoKTsgYXVkaW8ucGxheSgnc2hvY2t3YXZlJyk7IGNvbnN0IGMgPSBuLmNyeXN0YWxQb3MoKTtcbiAgICAgIHRoaXMuZnhSaW5nKGMueCwgMCwgbmV3IEJBQllMT04uQ29sb3IzKDAuODUsIDAuNTUsIDEpLCAwLjYsIDMwLCAxLjEpOyB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAxLCAxKSwgMC40LCAyMiwgMC44KTtcbiAgICAgIHRoaXMuYnVyc3QoYy54LCBjLnosIFsxLCAwLjg1LCAxLCAwLjldLCBbMC43LCAwLjQsIDEsIDAuN10sIDQwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDEgfHwgIWYuYWxpdmUpIGNvbnRpbnVlOyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSBjZWxsUG9zKDEsIGYuY2VsbCksIHgwID0gdi5ob2xkZXIucG9zaXRpb24ueCwgejAgPSB2LmhvbGRlci5wb3NpdGlvbi56OyB2LnB1bHNlKCk7XG4gICAgICAgIHRoaXMudHdlZW4oMC45LCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuOSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LnNldEhwKGYuaHAgLyBmLm1heEhwICsgKDEgLSBmLmhwIC8gZi5tYXhIcCkgKiB0KTsgfSwgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdi5zZXRIcCgxKTsgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGhpcy5sYXRlcigyLjMsIGhvbWUpOyB0aGlzLmxhdGVyKDMuNywgZG9uZSk7XG4gIH1cbiAgcGlja0RyYWZ0KGlkeDogbnVtYmVyKSB7IGlmICghdGhpcy5kcmFmdCkgcmV0dXJuOyB0YWtlRHJhZnQodGhpcy5zLCB0aGlzLmRyYWZ0LCBpZHgpOyB0aGlzLmRyYWZ0ID0gbnVsbDsgbm9ybWFsRHJhdyh0aGlzLnMpOyB0aGlzLnRvQnVpbGQoKTsgfVxuICBwcml2YXRlIHRvQnVpbGQoKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMubmVjcm8ucmV2aXZlKCk7IHRoaXMuZmx1c2hUd2VlbnMoKTtcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IHRoaXMuc2hvd0dyaWQodHJ1ZSk7XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgeyAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVzdXJyZWN0aW9uOiBldmVyeW9uZSByaXNlcyBhZ2FpbiBhdCBmdWxsIGhlYWx0aFxuICAgICAgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyBjb25zdCBwID0gdGhpcy5wb3ModS5jZWxsKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LmhvbGRlci5zZXRFbmFibGVkKHRydWUpOyB2LnNldEhwKG51bGwpOyB2LnNldE1hbmEobnVsbCk7IHYucGxheSgnc3Bhd24nKTsgdGhpcy5zdW1tb25GeChwLngsIHAueik7XG4gICAgICB0aGlzLmxhdGVyKDEuMSwgKCkgPT4gdi5wbGF5KCdpZGxlJykpO1xuICAgIH1cbiAgICB0aGlzLnBoYXNlID0gJ2J1aWxkJzsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyAgICAgICAgICAvLyBVSSBmaXJzdDogdGhlIGNhbWVyYSBtdXN0IG1lYXN1cmUgdGhlIGhhbmQgYW5kIGJ1dHRvbnMgd2hpbGUgdGhleSBhcmUgdmlzaWJsZVxuICAgIHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLmJ1aWxkLCAxLjgpO1xuICB9XG4gIC8qKiAyeCBhbmQgNHggYmF0dGxlIHNwZWVkIG9wZW4gb25jZSB0aGUgY2FtcGFpZ24gaXMgZmluaXNoZWQgKHRoZSBsYXN0IHN0YWdlIGNsZWFyZWQgb24gTm9ybWFsKS4gP2RlYnVnIG9yID9zcGVlZD0xIG9wZW5zIHRoZW0gZm9yIHRlc3RpbmcuICovXG4gIHNwZWVkVW5sb2NrZWQoKTogYm9vbGVhbiB7IGNvbnN0IHEgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCk7IHJldHVybiAhIShxLmdldCgnZGVidWcnKSB8fCBxLmdldCgnc3BlZWQnKSkgfHwgZW5kbGVzc1VubG9ja2VkKGxvYWRTYXZlKCkpOyB9XG4gIHNldFNwZWVkKGs6IG51bWJlcikge1xuICAgIGlmIChrID4gMSAmJiAhdGhpcy5zcGVlZFVubG9ja2VkKCkpIHJldHVybjtcbiAgICB0aGlzLnRpbWVTY2FsZSA9IGs7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBoZWxwZXJzXG4gIGFwcGx5QmFsYW5jZUNoYW5nZSgpIHsgdGhpcy51bml0VmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGNvbnN0IHUgPSB0aGlzLnMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOyBpZiAodSkgdi5zZXRTdGFyKHUuc3Rhcik7IH0pOyB9XG4gIHRlc3RPZGRzKG4gPSAyMDApIHtcbiAgICBjb25zdCBzbG90cyA9IHRoaXMucy51bml0cy5tYXAoKHUpID0+ICh7IHNvdWw6IHUuc291bCwgc3RhcjogdS5zdGFyLCBjZWxsOiB1LmNlbGwgfSkpLCBlbmVtaWVzID0gZW5lbXlXYXZlKHRoaXMucy53YXZlLCB0aGlzLnNlZWQpOyBsZXQgd2luID0gMCwgdCA9IDA7XG4gICAgY29uc3QgbHY6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fSwgc3YgPSBsb2FkU2F2ZSgpLnNvdWxzOyBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoc3YpKSBsdltrXSA9IChzdiBhcyBhbnkpW2tdLmxldmVsO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7IGNvbnN0IHIgPSBzaW11bGF0ZShzbG90cywgZW5lbWllcywgNTAwMCArIGksIDEzMCwgbHYsIGVuZW15UG93ZXIoKSk7IGlmIChyLndpbm5lciA9PT0gMCkgd2luKys7IHQgKz0gci50aW1lOyB9XG4gICAgcmV0dXJuIHsgd2luOiBNYXRoLnJvdW5kKCh3aW4gLyBuKSAqIDEwMCksIGF2Z1RpbWU6ICsodCAvIG4pLnRvRml4ZWQoMSksIG4gfTtcbiAgfVxuICBhZGRDYXJkKHNvdWw6IFNvdWxJZCkgeyB0aGlzLnMuaGFuZC5wdXNoKHNvdWwpOyB0aGlzLnMuc3RhdHMuZHJhd24rKzsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICBhZGREb21pbmlvbihuOiBudW1iZXIpIHsgdGhpcy5zLmNhcCArPSBuOyB0aGlzLnVpLnJlbmRlcigpOyB9XG4gIHJlcG9ydCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIGVuID0gZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKTtcbiAgICByZXR1cm4gW2BzdGFnZSAke2N1cnJlbnRTdGFnZUlkfS8ke2RpZmZpY3VsdHlOYW1lfSAgc2VlZCAke3RoaXMuc2VlZH0gIHdhdmUgJHtzLndhdmV9LyR7c3RhZ2VXYXZlcyhzKX0gIGhlYXJ0cyAke3MuaGVhcnRzfSAgZG9taW5pb24gJHtkb21pbmlvblVzZWQocyl9LyR7cy5jYXB9ICBwaGFzZSAke3RoaXMucGhhc2V9ICBhdHRlbXB0ICR7dGhpcy5hdHRlbXB0fWAsXG4gICAgICBgaGFuZDogJHtzLmhhbmQuam9pbignLCAnKSB8fCAnKGVtcHR5KSd9YCwgYGFybXk6ICR7cy51bml0cy5tYXAoKHUpID0+IGAke3Uuc291bH0ke3Uuc3Rhcn1AJHt1LmNlbGx9YCkuam9pbignICcpIHx8ICcobm9uZSknfWAsIGBlbmVteTogJHtlbi5tYXAoKGUpID0+IGUuc291bCArIGUuc3Rhcikuam9pbignICcpfWAsXG4gICAgICBgZGlmZmljdWx0eTogJHtkaWZmaWN1bHR5TmFtZX0gIG1lcmdlLWZyb20taGFuZDogJHtzLnJ1bGVzLm1lcmdlID09PSAnaGFuZEludG9PbmVTdGFyJ30gIHN3YXAgdXNlZDogJHtzLmRpc2NhcmRVc2VkfWAsIGBsYXN0IHRhcDogJHt0aGlzLmxhc3RUYXBJbmZvfWAsIGBzY3JlZW46ICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSBkcHIgJHt3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpb31gLCBgbGFzdCBiYXR0bGU6ICR7dGhpcy5sYXN0QmF0dGxlIHx8ICctJ31gLCBgbG9nIHRhaWw6YCwgLi4ucy5sb2cuc2xpY2UoLTgpLCBgYmFsYW5jZTogJHtKU09OLnN0cmluZ2lmeSh7IHN0YXI6IEJBTEFOQ0Uuc3Rhciwgc3RhdHM6IEJBTEFOQ0Uuc3RhdHMgfSl9YF0uam9pbignXFxuJyk7XG4gIH1cbiAgcmVzZXRCYWxhbmNlQWxsKCkgeyByZXNldEJhbGFuY2UoKTsgdGhpcy5hcHBseUJhbGFuY2VDaGFuZ2UoKTsgfVxuICBnZXQgZGlmZmljdWx0eSgpIHsgcmV0dXJuIGRpZmZpY3VsdHlOYW1lOyB9XG4gIGNoYW5nZURpZmZpY3VsdHkobmFtZTogc3RyaW5nKSB7IHNldERpZmZpY3VsdHkobmFtZSk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudG9hc3QoYERpZmZpY3VsdHk6ICR7bmFtZX0uIEFwcGxpZXMgdG8gdGhlIG5leHQgYmF0dGxlLmApOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZ2FsbGVyeSAoc3RhciBsb29rcylcbiAgZ2FsbGVyeSgpIHtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5hZGQoJ2dhbGxlcnknKTsgdGhpcy5uZWNyby5zZXRFbmFibGVkKGZhbHNlKTsgY29uc3QgdmlzOiBVbml0VmlzdWFsW10gPSBbXTsgbGV0IHRlYW06IDAgfCAxID0gMDtcbiAgICBjb25zdCByZWJ1aWxkID0gKCkgPT4geyB2aXMuZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB2aXMubGVuZ3RoID0gMDsgU09VTFMuZm9yRWFjaCgoc291bCwgaSkgPT4gWzEsIDIsIDNdLmZvckVhY2goKHN0LCBqKSA9PiB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBzb3VsLCB0ZWFtLCBzdCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldCgoaSAtIDIuNSkgKiAyLjUsIDAsIChqIC0gMSkgKiAtMi40KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgKiAwLjg1OyB2LnBsYXkoJ2lkbGUnKTsgdmlzLnB1c2godik7IH0pKTsgfTtcbiAgICByZWJ1aWxkKCk7IHRoaXMuY2FtZXJhLnBvc2l0aW9uLnNldCgwLCA1LjYsIC0xNC41KTsgdGhpcy5jYW1lcmEuc2V0VGFyZ2V0KG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAtMC40KSk7IHRoaXMuY2FtZXJhLmZvdiA9IDAuODU7XG4gICAgKHdpbmRvdyBhcyBhbnkpLl9fZ2FsbGVyeSA9IHsgc2V0VGVhbTogKHQ6IDAgfCAxKSA9PiB7IHRlYW0gPSB0OyByZWJ1aWxkKCk7IH0sIHZpcyB9O1xuICAgIGxldCBsYXN0ID0gcGVyZm9ybWFuY2Uubm93KCk7IHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBuID0gcGVyZm9ybWFuY2Uubm93KCksIGR0ID0gTWF0aC5taW4oMC4wNSwgKG4gLSBsYXN0KSAvIDEwMDApOyBsYXN0ID0gbjsgdmlzLmZvckVhY2goKHYpID0+IHYudXBkYXRlKGR0KSk7IHRoaXMuc2NlbmUucmVuZGVyKCk7IH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgR2FtZSB9IGZyb20gJy4vZ2FtZS50cyc7XG5cbmNvbnN0IGcgPSBuZXcgR2FtZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fZ2FtZSA9IGc7ICAgICAgICAgICAgICAgICAgICAgICAvLyBoYW5keSBmb3IgZGVidWdnaW5nIGZyb20gdGhlIGJyb3dzZXIgY29uc29sZVxuZy5pbml0KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjJykgYXMgSFRNTENhbnZhc0VsZW1lbnQpXG4gIC50aGVuKCgpID0+IHsgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSBsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7ICh3aW5kb3cgYXMgYW55KS5fX2dhbWVSZWFkeSA9IHRydWU7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ2FtZS1yZWFkeScpKTsgfSlcbiAgLmNhdGNoKChlKSA9PiB7XG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nJyk7IGlmIChsKSB7IGwuc3R5bGUuZGlzcGxheSA9ICdmbGV4JzsgbC50ZXh0Q29udGVudCA9ICdFcnJvcjogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IGUpOyB9XG4gICAgY29uc29sZS5lcnJvcihlKTtcbiAgfSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFvQ08sTUFBTSxXQUFvQjtBQUFBLElBQy9CLE9BQU87QUFBQSxNQUNMLFNBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sR0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxRQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLE1BQzlHLFFBQVcsRUFBRSxJQUFJLEtBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEtBQU0sT0FBTyxHQUFLLE1BQU0sTUFBTSxTQUFTLEdBQUssU0FBUyxJQUFJO0FBQUEsTUFDOUcsTUFBVyxFQUFFLElBQUksS0FBSyxLQUFLLElBQUksVUFBVSxLQUFLLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFBQSxNQUMvRyxXQUFXLEVBQUUsSUFBSSxLQUFLLEtBQUssSUFBSSxVQUFVLEtBQUssT0FBTyxLQUFLLE9BQU8sS0FBSyxNQUFNLEtBQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLElBQy9HO0FBQUE7QUFBQSxJQUVBLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRyxHQUFLLEdBQUcsR0FBRyxLQUFLLENBQUMsR0FBRyxLQUFLLENBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksRUFBRTtBQUFBLElBQ3RFLFNBQVMsRUFBRSxRQUFRLEdBQUssU0FBUyxNQUFNLFdBQVcsRUFBRTtBQUFBO0FBQUEsSUFFcEQsTUFBTTtBQUFBLE1BQ0osUUFBUSxFQUFFLEtBQUssS0FBSyxXQUFXLElBQUksUUFBUSxFQUFFO0FBQUE7QUFBQSxNQUM3QyxNQUFRLEVBQUUsS0FBSyxLQUFLLFdBQVcsSUFBSSxRQUFRLEVBQUU7QUFBQTtBQUFBLE1BQzdDLFFBQVEsRUFBRSxLQUFLLEtBQUssV0FBVyxJQUFJLFFBQVEsR0FBRztBQUFBO0FBQUEsSUFDaEQ7QUFB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RyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDM0csRUFBRSxNQUFNLFVBQVUsR0FBRyxPQUFPLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssRUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUN6TCxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE9BQU8sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFDckosRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsR0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEdBQUssS0FBSyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNwTCxFQUFFLE1BQU0sU0FBUyxHQUFHLElBQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEdBQUssR0FBRyxLQUFLO0FBQUEsSUFDL0ksRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsRUFDeE47QUFDQSxNQUFNLG1CQUFnQztBQUFBO0FBQUEsSUFDcEMsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQ2xFLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUN4TSxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLEdBQUssS0FBSyxJQUFJO0FBQUEsSUFDck0sRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUNuSCxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDdEksRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNySCxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUNuTixFQUFFLE1BQU0sU0FBUyxHQUFHLEdBQUcsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxFQUN2TjtBQUNBLE1BQU0saUJBQThCO0FBQUE7QUFBQSxJQUNsQyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxHQUFHLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDMUgsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsR0FBSyxHQUFHLElBQUk7QUFBQSxJQUN2SyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxLQUFLLEtBQUssTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLO0FBQUEsSUFDek0sRUFBRSxNQUFNLFVBQVUsR0FBRyxPQUFPLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUM1RyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE9BQU8sR0FBRyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxFQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUNsUCxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUM5TyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsSUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsRUFDbEs7QUFLQSxNQUFNLFNBQWdDO0FBQUEsSUFDcEMsT0FBTyxFQUFFLFFBQVEsY0FBYyxPQUFPLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxLQUFLLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLENBQUMsTUFBTSxNQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxNQUFN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SUFBSSxNQUFNLEdBQUc7QUFBRyxZQUFFLEtBQUssS0FBSyxZQUFZLE1BQU0sTUFBTSxJQUFJLE1BQU0sR0FBRztBQUFHLFlBQUUsS0FBSyxNQUFNLFdBQVcsS0FBSyxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQzFKLEtBQUs7QUFBYSxZQUFFLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxLQUFLLE1BQU0sSUFBSTtBQUFHLFlBQUUsS0FBSyxNQUFNLFlBQVksTUFBTSxLQUFLLEtBQUssTUFBTSxJQUFJO0FBQUcsWUFBRSxNQUFNLEtBQUssWUFBWSxLQUFLLEdBQUcsR0FBRztBQUFHO0FBQUEsTUFDcEs7QUFBQSxJQUNGO0FBQUEsSUFDQSxLQUFLLE1BQVc7QUFDZCxVQUFJLENBQUMsS0FBSyxPQUFPLENBQUMsS0FBSyxPQUFPLEtBQUssSUFBSSxVQUFVLFVBQVc7QUFDNUQsY0FBUSxNQUFNO0FBQUEsUUFDWixLQUFLO0FBQU8sY0FBSSxDQUFDLEtBQUssU0FBUyxPQUFPLEVBQUUsRUFBRztBQUFRLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDaEcsS0FBSztBQUFVLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxLQUFLLEdBQUcsSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxLQUFLLEdBQUcsS0FBSyxNQUFNLElBQUk7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsS0FBSyxJQUFJO0FBQUc7QUFBQSxRQUNsSyxLQUFLO0FBQVMsV0FBQyxLQUFLLEtBQUssS0FBSyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxNQUFNLFlBQVksS0FBSyxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxLQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsTUFBTSxHQUFHLEVBQUU7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUN0TyxLQUFLO0FBQU8sY0FBSSxDQUFDLEtBQUssU0FBUyxPQUFPLEVBQUUsRUFBRztBQUFRLGVBQUssS0FBSyxNQUFNLE1BQU0sV0FBVyxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUc7QUFBQSxRQUN0SSxLQUFLO0FBQVksY0FBSSxDQUFDLEtBQUssU0FBUyxRQUFRLEVBQUUsRUFBRztBQUFRLGVBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxHQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxZQUFZLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUNsSixLQUFLO0FBQVMsZUFBSyxLQUFLLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLE1BQU0sTUFBTSxXQUFXLEtBQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUN2RyxLQUFLO0FBQVMsY0FBSSxDQUFDLEtBQUssU0FBUyxTQUFTLEVBQUUsRUFBRztBQUFRLGVBQUssS0FBSyxNQUFNLEtBQUssWUFBWSxNQUFNLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDeEcsS0FBSztBQUFTLGNBQUksQ0FBQyxLQUFLLFNBQVMsU0FBUyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUNoSCxLQUFLO0FBQVEsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxLQUFLLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsS0FBSyxNQUFNLE1BQU0sSUFBSTtBQUFHLGVBQUssS0FBSyxNQUFNLE1BQU0sUUFBUSxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQzlKLEtBQUs7QUFBUyxlQUFLLEtBQUssS0FBSyxLQUFLLFVBQVUsTUFBTSxHQUFHLEtBQUssTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sTUFBTSxLQUFLLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDbkksS0FBSztBQUFhLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxLQUFLLEdBQUcsSUFBSSxJQUFJO0FBQUcsZUFBSyxLQUFLLEdBQUssTUFBTSxXQUFXLEtBQU0sR0FBRyxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUMzSixLQUFLO0FBQWEsV0FBQyxLQUFLLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLElBQUksTUFBTSxJQUFJLE1BQU0sR0FBRyxDQUFDO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxZQUFZLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDekssS0FBSztBQUFhLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLEdBQUcsSUFBSSxNQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFdBQVcsR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssVUFBVSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQzVLLEtBQUs7QUFBVyxXQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLEdBQUc7QUFBRztBQUFBLFFBQ3pJLEtBQUs7QUFBVSxXQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxJQUFJLEtBQUssUUFBUSxLQUFLLEdBQUc7QUFBRztBQUFBLFFBQ3RKLEtBQUs7QUFBVSxXQUFDLE1BQU0sTUFBTSxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNO0FBQUUsaUJBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxNQUFNLElBQUksS0FBSyxDQUFDO0FBQUcsaUJBQUssS0FBSyxNQUFNLElBQUksSUFBSSxNQUFNLFVBQVUsTUFBTSxHQUFHLFFBQVcsTUFBTyxHQUFHO0FBQUEsVUFBRyxDQUFDO0FBQUcsV0FBQyxLQUFLLE1BQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxLQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsTUFBTSxNQUFNLEVBQUU7QUFBRztBQUFBLFFBQ25YLEtBQUs7QUFBYyxlQUFLLEtBQUssSUFBSSxNQUFNLFFBQVEsTUFBTSxHQUFHLEtBQUssR0FBRztBQUFHLGVBQUssS0FBSyxNQUFNLE1BQU0sV0FBVyxLQUFLLEdBQUcsSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLEdBQUssWUFBWSxNQUFNLEtBQUssS0FBSyxHQUFHO0FBQUc7QUFBQSxRQUN6SyxLQUFLO0FBQWMsV0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksS0FBSyxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxNQUFNLEtBQUssUUFBUSxNQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksS0FBTSxHQUFHO0FBQUc7QUFBQSxRQUM5TCxLQUFLO0FBQVksZUFBSyxLQUFLLE1BQU0sS0FBSyxZQUFZLE1BQU0sR0FBRyxHQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLEtBQUssTUFBTSxFQUFFO0FBQUcsV0FBQyxNQUFNLE1BQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLEtBQUssT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDMU0sS0FBSztBQUFXLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxHQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLEtBQUssR0FBRyxJQUFJO0FBQUc7QUFBQSxRQUNuRyxLQUFLO0FBQVksZUFBSyxLQUFLLE1BQU0sTUFBTSxZQUFZLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsTUFBTSxHQUFHLEdBQUc7QUFBRztBQUFBLFFBQ3RHLEtBQUs7QUFBWSxlQUFLLEtBQUssVUFBVTtBQUFHLFdBQUMsS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxNQUFNLFlBQVksTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDO0FBQUc7QUFBQSxRQUM3SCxLQUFLO0FBQVksZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssS0FBSyxLQUFLLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLEtBQUssR0FBRyxFQUFFO0FBQUc7QUFBQSxRQUN6SyxLQUFLO0FBQWMsZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssS0FBSyxLQUFLLE1BQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssSUFBSSxLQUFLLFFBQVEsTUFBTSxHQUFHLEVBQUU7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDdFEsS0FBSztBQUFlLFdBQUMsS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxNQUFNLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDbEcsS0FBSztBQUFTLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLEdBQUcsS0FBSyxNQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxNQUFNLEtBQUssTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxXQUFXLEdBQUc7QUFBRztBQUFBLE1BQzdLO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFTyxNQUFNLFFBQVEsSUFBSSxZQUFZO0FBQ3JDLEVBQUMsT0FBZSxVQUFVO0FBSTFCLE1BQU0sYUFBYSxNQUFNLE1BQU0sT0FBTztBQUN0QyxhQUFXLE1BQU0sQ0FBQyxlQUFlLGFBQWEsWUFBWSxTQUFTLFNBQVMsRUFBRyxVQUFTLGlCQUFpQixJQUFJLFlBQVksRUFBRSxTQUFTLEtBQUssQ0FBQztBQUMxSSxXQUFTLGlCQUFpQixTQUFTLENBQUMsTUFBTTtBQUFFLFVBQU0sS0FBSyxFQUFFO0FBQThCLFFBQUksTUFBTSxHQUFHLFdBQVcsR0FBRyxRQUFRLHdCQUF3QixFQUFHLE9BQU0sS0FBSyxLQUFLO0FBQUEsRUFBRyxHQUFHLElBQUk7QUFDL0ssV0FBUyxpQkFBaUIsb0JBQW9CLE1BQU07QUFBRSxVQUFNLElBQUssTUFBYztBQUE0QixRQUFJLENBQUMsRUFBRztBQUFRLFFBQUksU0FBUyxPQUFRLEdBQUUsUUFBUTtBQUFBLGFBQVksTUFBTSxTQUFTLE1BQU0sSUFBSyxHQUFFLE9BQU87QUFBQSxFQUFHLENBQUM7QUFDN00sU0FBTyxpQkFBaUIsMEJBQTBCLE1BQU0sTUFBTSxPQUFPLENBQUM7OztBQ3RLdEUsTUFBTUMsT0FBTTtBQUNaLE1BQU1DLFdBQVU7QUFTVCxXQUFTLGVBQWUsR0FBMkI7QUFDeEQsV0FBTztBQUFBLE1BQ0wsT0FBTyxLQUFLLE1BQU0sS0FBSyxVQUFVLEVBQUUsS0FBSyxDQUFDO0FBQUEsTUFBRyxLQUFLLEVBQUUsTUFBTSxFQUFFLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxNQUFNLEVBQUU7QUFBQSxNQUN4RixNQUFNLEVBQUU7QUFBQSxNQUFNLFFBQVEsRUFBRTtBQUFBLE1BQVEsS0FBSyxFQUFFO0FBQUEsTUFBSyxNQUFNLEVBQUUsS0FBSyxNQUFNO0FBQUEsTUFBRyxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLEdBQUcsRUFBRSxFQUFFO0FBQUEsTUFBRyxRQUFRLEVBQUU7QUFBQSxNQUFRLGFBQWEsRUFBRTtBQUFBLE1BQzFJLFFBQVE7QUFBQSxNQUFZLEtBQUssRUFBRSxJQUFJLE1BQU0sR0FBRztBQUFBLE1BQUcsT0FBTyxFQUFFLEdBQUcsRUFBRSxNQUFNO0FBQUEsSUFDakU7QUFBQSxFQUNGO0FBRUEsTUFBTSxTQUFTLENBQUMsTUFBd0IsTUFBTSxTQUFTLENBQUM7QUFDeEQsTUFBTSxNQUFNLENBQUMsR0FBUSxJQUFZLE9BQWUsT0FBTyxVQUFVLENBQUMsS0FBSyxLQUFLLE1BQU0sS0FBSztBQUdoRixXQUFTLGlCQUFpQixHQUFzQjtBQWpDdkQ7QUFrQ0UsUUFBSTtBQUNGLFVBQUksQ0FBQyxLQUFLLE9BQU8sTUFBTSxTQUFVLFFBQU87QUFDeEMsWUFBTSxJQUFJLEVBQUU7QUFDWixVQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sUUFBUSxFQUFFLEtBQUssS0FBSyxDQUFDLEVBQUUsTUFBTSxVQUFVLENBQUMsRUFBRSxNQUFNLE1BQU0sQ0FBQyxNQUFXLE9BQU8sU0FBUyxDQUFDLEtBQUssSUFBSSxDQUFDLEVBQUcsUUFBTztBQUN4SCxVQUFJLEVBQUUsVUFBVSxrQkFBa0IsRUFBRSxVQUFVLGtCQUFtQixRQUFPO0FBQ3hFLFVBQUksRUFBRSxTQUFTLFVBQWEsRUFBRSxNQUFNLFFBQVEsRUFBRSxJQUFJLEtBQUssRUFBRSxLQUFLLFVBQVUsRUFBRSxLQUFLLE1BQU0sTUFBTSxHQUFJLFFBQU87QUFDdEcsWUFBTUMsZUFBYSxPQUFFLGVBQUYsWUFBZ0IsRUFBRSxNQUFNO0FBQzNDLFVBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxHQUFHLEtBQUssSUFBSUEsYUFBWSxFQUFFLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsUUFBUSxHQUFHLE1BQU0sS0FBSyxDQUFDLE9BQU8sU0FBUyxFQUFFLEdBQUcsS0FBSyxFQUFFLE9BQU8sRUFBRyxRQUFPO0FBQ3hJLFVBQUksQ0FBQyxNQUFNLFFBQVEsRUFBRSxJQUFJLEtBQUssRUFBRSxLQUFLLFNBQVMsTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLE1BQU0sRUFBRyxRQUFPO0FBQ2xGLFVBQUksQ0FBQyxNQUFNLFFBQVEsRUFBRSxLQUFLLEtBQUssRUFBRSxNQUFNLFNBQVMsV0FBWSxRQUFPO0FBQ25FLFVBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxHQUFHLEdBQUcsS0FBSyxPQUFPLEVBQUUsZ0JBQWdCLFVBQVcsUUFBTztBQUN6RSxZQUFNLFFBQVEsb0JBQUksSUFBWSxHQUFHLE1BQU0sb0JBQUksSUFBWSxHQUFHLFFBQWdCLENBQUM7QUFDM0UsaUJBQVcsS0FBSyxFQUFFLE9BQU87QUFDdkIsWUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLE1BQU0sR0FBRyxRQUFRLEtBQUssQ0FBQyxJQUFJLEVBQUUsTUFBTSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksR0FBRyxFQUFFLE1BQU0sS0FBSyxNQUFNLElBQUksRUFBRSxJQUFJLEtBQUssSUFBSSxJQUFJLEVBQUUsRUFBRSxFQUFHLFFBQU87QUFDbkssY0FBTSxJQUFJLEVBQUUsSUFBSTtBQUFHLFlBQUksSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFNLEtBQUssRUFBRSxJQUFJLEVBQUUsSUFBSSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsTUFBTSxPQUFPLENBQUMsQ0FBQyxFQUFFLE1BQU0sQ0FBQztBQUFBLE1BQ3ZIO0FBQ0EsWUFBTSxLQUFLLEVBQUU7QUFDYixVQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUyxhQUFhLGFBQWEsVUFBVSxVQUFVLEVBQUUsTUFBTSxDQUFDLE1BQU0sT0FBTyxTQUFTLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRyxRQUFPO0FBQ25ILFVBQUksQ0FBQyxFQUFFLE9BQU8sQ0FBQyxPQUFPLFNBQVMsRUFBRSxJQUFJLElBQUksS0FBSyxDQUFDLE9BQU8sU0FBUyxFQUFFLElBQUksR0FBRyxFQUFHLFFBQU87QUFDbEYsYUFBTztBQUFBLFFBQ0wsT0FBTztBQUFBLFFBQVksS0FBSyxRQUFRLEVBQUUsSUFBSSxNQUFNLEVBQUUsSUFBSSxHQUFHO0FBQUEsUUFBRyxNQUFNLEVBQUU7QUFBQSxRQUFNLFFBQVEsRUFBRTtBQUFBLFFBQVEsS0FBSyxFQUFFO0FBQUEsUUFBSyxNQUFNLEVBQUUsS0FBSyxNQUFNO0FBQUEsUUFBRztBQUFBLFFBQU8sUUFBUSxFQUFFO0FBQUEsUUFDM0ksYUFBYSxFQUFFO0FBQUEsUUFBYSxRQUFRO0FBQUEsUUFBWSxLQUFLLE1BQU0sUUFBUSxFQUFFLEdBQUcsSUFBSSxFQUFFLElBQUksT0FBTyxDQUFDLE1BQVcsT0FBTyxNQUFNLFFBQVEsRUFBRSxNQUFNLEdBQUcsSUFBSSxDQUFDO0FBQUEsUUFDMUksT0FBTyxFQUFFLE9BQU8sR0FBRyxPQUFPLFdBQVcsR0FBRyxXQUFXLFdBQVcsR0FBRyxXQUFXLFFBQVEsR0FBRyxRQUFRLFVBQVUsR0FBRyxTQUFTO0FBQUEsTUFDdkg7QUFBQSxJQUNGLFFBQVE7QUFBRSxhQUFPO0FBQUEsSUFBTTtBQUFBLEVBQ3pCO0FBRU8sV0FBUyxRQUFRLE1BQW1CLFFBQXNCLGFBQWEsR0FBUztBQUNyRixRQUFJO0FBQUUsVUFBSSxNQUFPLE9BQU0sUUFBUUYsTUFBSyxLQUFLLFVBQVUsSUFBSSxDQUFDO0FBQUEsSUFBRyxRQUFRO0FBQUEsSUFBd0U7QUFBQSxFQUM3STtBQUNPLFdBQVMsU0FBUyxRQUFzQixhQUFhLEdBQVM7QUFDbkUsUUFBSTtBQUFFLFVBQUksU0FBVSxNQUFjLFdBQVksQ0FBQyxNQUFjLFdBQVdBLElBQUc7QUFBQSxlQUFZLE1BQU8sT0FBTSxRQUFRQSxNQUFLLEVBQUU7QUFBQSxJQUFHLFFBQVE7QUFBQSxJQUFlO0FBQUEsRUFDL0k7QUFDTyxXQUFTLFFBQVEsUUFBc0IsYUFBYSxHQUErQztBQUN4RyxRQUFJO0FBQ0YsWUFBTSxJQUFJLFNBQVMsTUFBTSxRQUFRQSxJQUFHO0FBQUcsVUFBSSxDQUFDLEVBQUcsUUFBTztBQUN0RCxZQUFNLElBQUksS0FBSyxNQUFNLENBQUM7QUFDdEIsVUFBSSxDQUFDLEtBQUssRUFBRSxNQUFNQyxZQUFZLEVBQUUsVUFBVSxXQUFXLEVBQUUsVUFBVSxXQUFZLENBQUMsT0FBTyxTQUFTLEVBQUUsSUFBSSxLQUFLLENBQUMsT0FBTyxTQUFTLEVBQUUsT0FBTyxLQUFLLE9BQU8sRUFBRSxlQUFlLFNBQVUsUUFBTztBQUNqTCxZQUFNLFFBQVEsaUJBQWlCLEVBQUUsS0FBSztBQUFHLFVBQUksQ0FBQyxNQUFPLFFBQU87QUFDNUQsWUFBTSxRQUFRLEVBQUUsVUFBVSxXQUFXLE1BQU0sUUFBUSxFQUFFLEtBQUssS0FBSyxFQUFFLE1BQU0sV0FBVyxLQUFLLEVBQUUsTUFBTSxNQUFNLE1BQU0sSUFBSSxFQUFFLFFBQVE7QUFDekgsYUFBTyxFQUFFLE1BQU0sRUFBRSxHQUFHQSxVQUFTLE1BQU0sRUFBRSxNQUFNLFNBQVMsRUFBRSxTQUFTLE9BQU8sT0FBTyxFQUFFLFVBQVUsV0FBVyxFQUFFLFFBQVEsU0FBUyxZQUFZLEVBQUUsWUFBWSxPQUFPLFFBQVEsVUFBVSxTQUFTLE9BQU8sT0FBTyxFQUFFLE9BQU8sV0FBVyxPQUFPLFVBQVUsRUFBRSxTQUFTLEtBQUssRUFBRSxhQUFhLEtBQUssRUFBRSxhQUFhLE9BQU8sRUFBRSxZQUFZLE9BQVUsR0FBRyxNQUFNO0FBQUEsSUFDblUsUUFBUTtBQUFFLGFBQU87QUFBQSxJQUFNO0FBQUEsRUFDekI7OztBQ2xEQSxNQUFNLE9BQW1CLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxHQUFHLENBQUM7QUFDekUsTUFBTSxPQUFPO0FBQUEsSUFDWCxFQUFFLE1BQU0sSUFBSSxLQUFLLE1BQU0sS0FBSyxNQUFNLElBQUksQ0FBQyxNQUFNLE1BQU0sR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLE1BQU0sTUFBTSxLQUFLLEdBQUcsRUFBRTtBQUFBLElBQ3ZGLEVBQUUsTUFBTSxJQUFJLEtBQUssTUFBTSxLQUFLLEtBQU0sSUFBSSxDQUFDLE1BQU0sTUFBTSxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFDcEYsRUFBRSxNQUFNLElBQUksS0FBSyxLQUFNLEtBQUssTUFBTSxJQUFJLENBQUMsR0FBRyxNQUFNLEtBQUssSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxFQUNyRjtBQVFBLE1BQU0sUUFBUSxvQkFBSSxJQUFJLENBQUMsUUFBUSxTQUFTLFNBQVMsV0FBVyxVQUFVLFNBQVMsUUFBUSxnQkFBZ0IsVUFBVSxjQUFjLE1BQU0sQ0FBQztBQUt0SSxXQUFTLElBQUksT0FBWSxHQUFXLEdBQVdFLE9BQTZDLFFBQVEsTUFBTTtBQUN4RyxVQUFNLElBQUksSUFBSSxRQUFRLGVBQWUsTUFBTSxFQUFFLE9BQU8sR0FBRyxRQUFRLEVBQUUsR0FBRyxPQUFPLElBQUk7QUFBRyxJQUFBQSxNQUFLLEVBQUUsV0FBVyxDQUFDO0FBQUcsTUFBRSxPQUFPO0FBQUcsTUFBRSxXQUFXO0FBQU8sV0FBTztBQUFBLEVBQ2pKO0FBRUEsaUJBQXNCLFdBQVcsT0FBNkI7QUFDNUQsVUFBTSxPQUFPLElBQUksT0FBTyxJQUFJLElBQUksQ0FBQyxNQUFNO0FBQUUsWUFBTUMsS0FBSSxFQUFFLHFCQUFxQixJQUFJLElBQUksR0FBRyxJQUFJLElBQUksRUFBRTtBQUFHLE1BQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUFHLE1BQUFBLEdBQUUsYUFBYSxLQUFLLHVCQUF1QjtBQUFHLE1BQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUFHLFFBQUUsWUFBWUE7QUFBRyxRQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksRUFBRTtBQUFBLElBQUcsQ0FBQztBQUNoUixVQUFNLFVBQVUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNLElBQUksT0FBTyxLQUFLLElBQUksQ0FBQyxNQUFNO0FBQUUsUUFBRSxPQUFPO0FBQXdCLFFBQUUsWUFBWTtBQUFVLFFBQUUsWUFBWTtBQUFHLFFBQUUsY0FBYztBQUFXLFFBQUUsWUFBWSxNQUFNLElBQUksWUFBWSxNQUFNLElBQUksWUFBWTtBQUFXLFlBQU0sSUFBSSxTQUFJLE9BQU8sQ0FBQztBQUFHLFFBQUUsV0FBVyxHQUFHLElBQUksRUFBRTtBQUFHLFFBQUUsU0FBUyxHQUFHLElBQUksRUFBRTtBQUFBLElBQUcsQ0FBQyxDQUFDO0FBQ3ZULFVBQU0sV0FBVyxDQUFDLEdBQVdBLElBQVcsR0FBVyxJQUFJLE1BQU07QUFBRSxZQUFNLElBQUksSUFBSSxRQUFRLGlCQUFpQixNQUFNLEtBQUs7QUFBRyxRQUFFLGVBQWUsUUFBUSxPQUFPLE1BQU07QUFBRyxRQUFFLGdCQUFnQixJQUFJLFFBQVEsT0FBTyxHQUFHQSxJQUFHLENBQUM7QUFBRyxRQUFFLGtCQUFrQjtBQUFNLFFBQUUsUUFBUTtBQUFHLGFBQU87QUFBQSxJQUFHO0FBQzdQLFVBQU0sSUFBWTtBQUFBLE1BQ2hCO0FBQUEsTUFBTztBQUFBLE1BQU0sT0FBTyxDQUFDO0FBQUEsTUFBRztBQUFBLE1BQVMsT0FBTyxDQUFDO0FBQUEsTUFBRyxPQUFPLENBQUM7QUFBQSxNQUFHLFNBQVMsQ0FBQyxTQUFTLE1BQU0sS0FBSyxNQUFNLEdBQUcsR0FBRyxTQUFTLE1BQU0sTUFBTSxLQUFLLEdBQUcsQ0FBQztBQUFBLE1BQUcsU0FBUyxTQUFTLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxNQUN0SyxPQUFPLFNBQVMsTUFBTSxNQUFNLE1BQU0sR0FBRztBQUFBLE1BQUcsU0FBUyxDQUFDLFNBQVMsTUFBTSxNQUFNLENBQUMsR0FBRyxTQUFTLEdBQUcsS0FBSyxHQUFHLENBQUM7QUFBQSxNQUFHLFVBQVUsU0FBUyxNQUFNLE1BQU0sQ0FBQztBQUFBLElBQ3JJO0FBRUEsVUFBTSxNQUFNLElBQUksT0FBTyxLQUFLLEtBQUssQ0FBQyxNQUFNO0FBQUUsUUFBRSxZQUFZO0FBQVUsUUFBRSxZQUFZO0FBQUcsUUFBRSxjQUFjO0FBQVcsUUFBRSxZQUFZO0FBQVcsUUFBRSxXQUFXO0FBQ2xKLGlCQUFXLENBQUMsSUFBSSxNQUFNLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLElBQUksSUFBSSxHQUFHLEdBQUcsQ0FBQyxLQUFLLElBQUksSUFBSSxFQUFFLEdBQUcsQ0FBQyxLQUFLLElBQUksS0FBSyxFQUFFLENBQUMsR0FBeUM7QUFBRSxVQUFFLE9BQU8sZ0JBQWdCLE9BQU87QUFBaUIsVUFBRSxXQUFXLElBQUksR0FBRyxDQUFDO0FBQUcsVUFBRSxTQUFTLElBQUksR0FBRyxDQUFDO0FBQUEsTUFBRztBQUFBLElBQUUsQ0FBQztBQUN4TyxVQUFNLEtBQUssSUFBSSxRQUFRLGlCQUFpQixPQUFPLEtBQUs7QUFBRyxPQUFHLGlCQUFpQjtBQUFLLE9BQUcsNkJBQTZCO0FBQU0sT0FBRyxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxPQUFHLGtCQUFrQjtBQUFNLE9BQUcsa0JBQWtCO0FBQU8sTUFBRSxNQUFNLEtBQUssSUFBSTtBQUN6TyxVQUFNLE9BQU8sQ0FBQyxNQUFjRCxVQUFnRDtBQUFFLFlBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sS0FBSztBQUFHLFFBQUUsaUJBQWlCLElBQUksT0FBTyxLQUFLLEtBQUtBLEtBQUk7QUFBRyxRQUFFLDZCQUE2QjtBQUFNLFFBQUUsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQUcsUUFBRSxrQkFBa0I7QUFBTSxRQUFFLGtCQUFrQjtBQUFPLFFBQUUsTUFBTSxJQUFJLElBQUk7QUFBQSxJQUFHO0FBQ3pVLFVBQU0sUUFBUSxDQUFDLElBQVksU0FBaUIsQ0FBQyxNQUFnQztBQUFFLFFBQUUsWUFBWTtBQUFVLFFBQUUsWUFBWTtBQUFJLFFBQUUsY0FBYztBQUFXLFFBQUUsV0FBVztBQUFTLFFBQUUsWUFBWTtBQUFNLFFBQUUsT0FBTztBQUF3QixRQUFFLFdBQVcsSUFBSSxJQUFJLEdBQUc7QUFBRyxRQUFFLFNBQVMsSUFBSSxJQUFJLEdBQUc7QUFBQSxJQUFHO0FBQ25SLFNBQUssS0FBSyxNQUFNLEtBQUssU0FBUyxDQUFDO0FBQUcsU0FBSyxLQUFLLE1BQU0sS0FBSyxTQUFTLENBQUM7QUFDakUsU0FBSyxTQUFTLENBQUMsTUFBTTtBQUFFLFFBQUUsWUFBWTtBQUFHLFFBQUUsY0FBYztBQUFXLFFBQUUsWUFBWTtBQUFXLFFBQUUsVUFBVTtBQUFHLFFBQUUsT0FBTyxJQUFJLEVBQUU7QUFBRyxRQUFFLGNBQWMsS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLEdBQUc7QUFBRyxRQUFFLGNBQWMsSUFBSSxLQUFLLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBRyxRQUFFLFVBQVU7QUFBRyxRQUFFLE9BQU87QUFBRyxRQUFFLEtBQUs7QUFBQSxJQUFHLENBQUM7QUFDMVAsU0FBSyxXQUFXLENBQUMsTUFBTTtBQUFFLFFBQUUsWUFBWTtBQUFHLFFBQUUsY0FBYztBQUFXLFFBQUUsWUFBWTtBQUFXLFlBQU0sT0FBTyxDQUFDLEdBQVcsR0FBVyxNQUFjO0FBQUUsVUFBRSxVQUFVO0FBQUcsaUJBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQUUsZ0JBQU0sSUFBSSxJQUFJLEtBQUssS0FBSyxHQUFHLEtBQUssSUFBSSxJQUFJLElBQUksT0FBTztBQUFHLFlBQUUsT0FBTyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksSUFBSSxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksRUFBRTtBQUFBLFFBQUc7QUFBRSxVQUFFLFVBQVU7QUFBRyxVQUFFLE9BQU87QUFBRyxVQUFFLEtBQUs7QUFBQSxNQUFHO0FBQUcsV0FBSyxJQUFJLElBQUksRUFBRTtBQUFHLFdBQUssS0FBSyxJQUFJLEVBQUU7QUFBRyxXQUFLLElBQUksSUFBSSxFQUFFO0FBQUEsSUFBRyxDQUFDO0FBQzdZLFVBQU0sT0FBaUY7QUFBQSxNQUNyRixDQUFDLFdBQVcsdUJBQXVCLDZCQUE2QixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsTUFBTSxHQUFLLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sVUFBVSxPQUFPLFFBQVEsR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sVUFBVSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sY0FBYyxPQUFPLElBQUksQ0FBQyxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsR0FBRyxRQUFRLENBQUMsRUFBRSxNQUFNLFNBQVMsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFFBQVEsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFFBQVEsT0FBTyxJQUFJLENBQUMsR0FBRyxNQUFNLDJCQUEyQixDQUFDO0FBQUEsTUFDOWlCLENBQUMsVUFBVSxzQkFBc0IsNEJBQTRCLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFNBQVMsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLE9BQU8sR0FBRyxNQUFNLEdBQUssRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFlBQVksR0FBRyxFQUFFLE1BQU0sWUFBWSxPQUFPLFVBQVUsQ0FBQyxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsR0FBRyxRQUFRLENBQUMsRUFBRSxNQUFNLFFBQVEsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLGdCQUFnQixPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sWUFBWSxPQUFPLFVBQVUsQ0FBQyxHQUFHLE1BQU0sMEJBQTBCLENBQUM7QUFBQSxNQUNoZ0IsQ0FBQyxVQUFVLGNBQWMsb0JBQW9CLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFVBQVUsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLFFBQVEsR0FBRyxHQUFLLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxVQUFVLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxXQUFXLE9BQU8sVUFBVSxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxHQUFHLFFBQVEsQ0FBQyxFQUFFLE1BQU0sU0FBUyxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sV0FBVyxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsQ0FBQyxHQUFHLE1BQU0sa0JBQWtCLENBQUM7QUFBQSxNQUM1ZCxDQUFDLFVBQVUsY0FBYyxvQkFBb0IsRUFBRSxNQUFNLFFBQVEsS0FBSyxPQUFPLFFBQVEsVUFBVSxPQUFPLFNBQVMsT0FBTyxTQUFTLE9BQU8sT0FBTyxHQUFHLEdBQUssTUFBTSxFQUFFLFFBQVEsRUFBRSxPQUFPLENBQUMsRUFBRSxNQUFNLFVBQVUsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFNBQVMsT0FBTyxJQUFJLEdBQUcsRUFBRSxNQUFNLFVBQVUsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFFBQVEsT0FBTyxVQUFVLENBQUMsR0FBRyxLQUFLLEdBQUcsS0FBSyxHQUFHLEdBQUcsUUFBUSxDQUFDLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxVQUFVLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxTQUFTLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxDQUFDLEdBQUcsTUFBTSxrQkFBa0IsQ0FBQztBQUFBLE1BQzlmLENBQUMsYUFBYSxpQkFBaUIsdUJBQXVCLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFVBQVUsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLFFBQVEsR0FBRyxHQUFLLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxRQUFRLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxZQUFZLEdBQUcsRUFBRSxNQUFNLFNBQVMsT0FBTyxJQUFJLENBQUMsR0FBRyxLQUFLLEdBQUcsS0FBSyxHQUFHLEdBQUcsUUFBUSxDQUFDLEVBQUUsTUFBTSxTQUFTLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxZQUFZLENBQUMsR0FBRyxNQUFNLHFCQUFxQixDQUFDO0FBQUEsTUFDN1osQ0FBQyxRQUFRLFlBQVksa0JBQWtCLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFVBQVUsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLFFBQVEsR0FBRyxNQUFNLE1BQU0sRUFBRSxXQUFXLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRyxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxRQUFRLE9BQU8sTUFBTSxHQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsRUFBRSxNQUFNLFNBQVMsT0FBTyxJQUFJLEdBQUcsRUFBRSxNQUFNLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsR0FBRyxRQUFRLENBQUMsRUFBRSxNQUFNLFFBQVEsR0FBRyxFQUFFLE1BQU0sU0FBUyxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sU0FBUyxPQUFPLElBQUksQ0FBQyxHQUFHLFlBQVksT0FBTyxNQUFNLGdCQUFnQixDQUFDO0FBQUEsSUFDcGM7QUFDQSxVQUFNLFNBQVMsUUFBUSxZQUFZLHdCQUF3QixXQUFXLG1CQUFtQixLQUFLLEVBQUUsS0FBSyxDQUFDLE1BQVc7QUFBRSxRQUFFLFFBQVE7QUFBQSxJQUFHLENBQUMsRUFBRSxNQUFNLE1BQU07QUFBQSxJQUFpQyxDQUFDO0FBQ2pMLFVBQU0sU0FBUyxRQUFRLFlBQVksd0JBQXdCLFdBQVcsYUFBYSxLQUFLLEVBQUUsS0FBSyxDQUFDLE1BQVc7QUFBRSxRQUFFLFFBQVE7QUFBQSxJQUFHLENBQUMsRUFBRSxNQUFNLE1BQU07QUFBQSxJQUFxQyxDQUFDO0FBQy9LLFVBQU0sUUFBUSxJQUFJLENBQUMsUUFBUSxRQUFRLEdBQUcsS0FBSyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssT0FBTyxPQUFPLEtBQUssT0FBTyxLQUFLLE1BQU07QUFDckcsWUFBTSxZQUFZLE1BQU0sUUFBUSxZQUFZLHdCQUF3QixXQUFXLEtBQUssS0FBSztBQUN6RixRQUFFLE1BQU0sSUFBSSxJQUFJLEVBQUUsV0FBVyxVQUFVLElBQUksUUFBUSxRQUFRLFlBQVksT0FBTyxPQUFPLE9BQU8sS0FBSyxHQUFHLE9BQU8sVUFBVSxDQUFDLEdBQUcsS0FBSyxPQUFPLEdBQUksU0FBUyxDQUFDLEdBQUksUUFBUSxTQUFTLE1BQU0sT0FBTyxJQUFJLFFBQVEsUUFBUSxZQUFZLE1BQU0sTUFBTSxPQUFPLE9BQU8sS0FBSyxJQUFJLE9BQVU7QUFBQSxJQUNwUSxDQUFDLENBQUMsQ0FBQztBQUNILFdBQU87QUFBQSxFQUNUO0FBR0EsTUFBTSxPQUFOLE1BQVc7QUFBQSxJQUVULFlBQW9CLEdBQW1CLFFBQXFCLEtBQXFCLFFBQWdCO0FBQTdFO0FBQW1CO0FBQXFCO0FBQXFCO0FBRGpGLDBCQUFRLE1BQVU7QUFBTSwwQkFBUSxRQUFZO0FBQU0sMEJBQVE7QUFBWSwwQkFBUTtBQUFZLDBCQUFRO0FBQVcsMEJBQVE7QUFBVSwwQkFBUTtBQUFVLDBCQUFRO0FBQVksMEJBQVE7QUFlN0ssMEJBQVE7QUFBUywwQkFBUSxPQUFNO0FBQUcsMEJBQVEsU0FBUTtBQWJoRCxZQUFNLElBQUksRUFBRTtBQUNaLFdBQUssT0FBTyxRQUFRLFlBQVksV0FBVyxRQUFRLEVBQUUsUUFBUSxLQUFLLElBQUksS0FBSyxTQUFTLElBQUksR0FBRyxjQUFjLEdBQUcsR0FBRyxDQUFDO0FBQUcsV0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxXQUFLLEtBQUssU0FBUyxJQUFJO0FBQU0sV0FBSyxLQUFLLFNBQVM7QUFBUSxXQUFLLEtBQUssYUFBYTtBQUN0TyxXQUFLLFFBQVEsSUFBSSxRQUFRLGNBQWMsU0FBUyxDQUFDO0FBQUcsV0FBSyxNQUFNLFNBQVM7QUFBUSxXQUFLLE1BQU0sU0FBUyxJQUFJLE1BQU07QUFBTSxXQUFLLE1BQU0sZ0JBQWdCLFFBQVEsS0FBSztBQUM1SixXQUFLLFFBQVEsUUFBUSxZQUFZLFlBQVksU0FBUyxFQUFFLE9BQU8sS0FBSyxRQUFRLEtBQUssR0FBRyxDQUFDO0FBQUcsV0FBSyxNQUFNLFNBQVMsS0FBSztBQUFPLFdBQUssTUFBTSxTQUFTLElBQUk7QUFBTSxXQUFLLE1BQU0sYUFBYTtBQUM5SyxZQUFNLEtBQUssSUFBSSxRQUFRLGlCQUFpQixNQUFNLENBQUM7QUFBRyxTQUFHLGdCQUFnQixRQUFRLE9BQU8sTUFBTTtBQUFHLFNBQUcsa0JBQWtCO0FBQU0sU0FBRyw2QkFBNkI7QUFBTSxXQUFLLE1BQU0sV0FBVztBQUFJLE1BQUMsS0FBSyxNQUFjLE1BQU07QUFDbE4sWUFBTSxLQUFLLFFBQVEsWUFBWSxZQUFZLE1BQU0sRUFBRSxPQUFPLEtBQUssUUFBUSxNQUFNLEdBQUcsQ0FBQztBQUFHLFNBQUcsU0FBUyxLQUFLO0FBQU8sU0FBRyxXQUFXLEVBQUU7QUFBTyxTQUFHLGFBQWE7QUFBTyxXQUFLLE1BQU07QUFDckssV0FBSyxPQUFPLFFBQVEsWUFBWSxZQUFZLFFBQVEsRUFBRSxPQUFPLE1BQU0sUUFBUSxLQUFLLEdBQUcsQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLEtBQUs7QUFBTyxXQUFLLEtBQUssU0FBUyxJQUFJO0FBQVEsV0FBSyxLQUFLLGFBQWE7QUFDNUssV0FBSyxNQUFNLFFBQVEsWUFBWSxZQUFZLE9BQU8sRUFBRSxPQUFPLEtBQUssUUFBUSxLQUFLLEdBQUcsQ0FBQztBQUFHLFdBQUssSUFBSSxTQUFTLEtBQUs7QUFBTyxXQUFLLElBQUksU0FBUyxJQUFJO0FBQU8sV0FBSyxJQUFJLFdBQVcsRUFBRTtBQUFPLFdBQUssSUFBSSxhQUFhO0FBQ2xNLFdBQUssUUFBUSxRQUFRLFlBQVksWUFBWSxTQUFTLEVBQUUsT0FBTyxNQUFNLFFBQVEsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFLLE1BQU0sU0FBUyxLQUFLO0FBQU8sV0FBSyxNQUFNLFNBQVMsSUFBSSxHQUFHLE9BQU8sS0FBTTtBQUFHLFdBQUssTUFBTSxXQUFXLEVBQUU7QUFBVSxXQUFLLE1BQU0sYUFBYTtBQUM5TixXQUFLLEtBQUssUUFBUSxZQUFZLFlBQVksTUFBTSxFQUFFLE9BQU8sTUFBTSxRQUFRLE1BQU0sR0FBRyxDQUFDO0FBQUcsV0FBSyxHQUFHLFNBQVMsS0FBSztBQUFPLFdBQUssR0FBRyxTQUFTLElBQUksT0FBTyxHQUFLLENBQUM7QUFBRyxXQUFLLEdBQUcsYUFBYTtBQUFPLFdBQUssR0FBRyxXQUFXLEtBQUs7QUFDMU0sWUFBTSxLQUFLLElBQUksUUFBUSxpQkFBaUIsT0FBTyxDQUFDO0FBQUcsU0FBRyxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxTQUFHLGtCQUFrQjtBQUFNLFNBQUcsNkJBQTZCO0FBQU0sV0FBSyxHQUFHLFdBQVc7QUFDbEwsV0FBSyxJQUFJLFdBQVcsS0FBSztBQUFHLFdBQUssS0FBSyxXQUFXLEtBQUs7QUFBRyxXQUFLLElBQUksV0FBVyxLQUFLO0FBQUcsV0FBSyxNQUFNLFdBQVcsS0FBSztBQUFBLElBQ2xIO0FBQUE7QUFBQSxJQUdBLFNBQVMsR0FBVztBQUNsQixXQUFLLE1BQU07QUFBRyxVQUFJLENBQUMsS0FBSyxHQUFJO0FBQVEsVUFBSSxLQUFLLEtBQUssQ0FBQyxLQUFLLE9BQU87QUFBRSxhQUFLLEdBQUcsV0FBVyxLQUFLO0FBQUcsWUFBSSxJQUFJLEVBQUcsTUFBSyxTQUFTLENBQUM7QUFBRztBQUFBLE1BQVE7QUFDakksV0FBSyxTQUFTLENBQUM7QUFBRyxXQUFLLEdBQUcsV0FBVyxJQUFJO0FBQUEsSUFDM0M7QUFBQSxJQUNRLFNBQVMsR0FBVztBQUMxQixZQUFNLElBQUksS0FBSztBQUFHLFVBQUksQ0FBQyxFQUFFLE1BQU0sQ0FBQyxFQUFHLEdBQUUsTUFBTSxDQUFDLElBQUksSUFBSSxFQUFFLE9BQU8sS0FBSyxJQUFJLENBQUMsTUFBTTtBQUFFLFVBQUUsT0FBTztBQUF3QixVQUFFLFlBQVk7QUFBVSxVQUFFLFlBQVk7QUFBRyxVQUFFLGNBQWM7QUFBVyxVQUFFLFlBQVk7QUFBVyxVQUFFLFdBQVc7QUFBUyxVQUFFLFdBQVcsUUFBUSxHQUFHLElBQUksRUFBRTtBQUFHLFVBQUUsU0FBUyxRQUFRLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFBRyxDQUFDO0FBQ3BTLE1BQUMsS0FBSyxHQUFHLFNBQWlCLGlCQUFpQixFQUFFLE1BQU0sQ0FBQztBQUFBLElBQ3REO0FBQUE7QUFBQSxJQUVBLElBQUksR0FBVztBQUFFLFdBQUssTUFBTSxRQUFRLE9BQU8sSUFBSSxDQUFDO0FBQUcsV0FBSyxNQUFNLFNBQVMsSUFBSSxLQUFLLE1BQU0sTUFBTTtBQUFHLFVBQUksS0FBSyxLQUFNLE1BQUssS0FBSyxTQUFTLElBQUksS0FBSyxNQUFNO0FBQUEsSUFBTTtBQUFBLElBQ3RKLElBQUksTUFBYSxNQUFjO0FBQzdCLFlBQU0sSUFBSSxLQUFLLEVBQUUsT0FBTyxNQUFNLEtBQUssT0FBTyxDQUFDO0FBQzNDLE1BQUMsS0FBSyxNQUFjLElBQUksaUJBQWlCLEtBQUssRUFBRSxRQUFRLE9BQU8sQ0FBQztBQUNoRSxXQUFLLEtBQUssV0FBVyxLQUFLLEVBQUUsUUFBUSxJQUFJO0FBQUcsV0FBSyxLQUFLLFdBQVcsS0FBSyxFQUFFLFFBQVEsSUFBSTtBQUNuRixVQUFJLFNBQVMsR0FBRztBQUNkLFlBQUksQ0FBQyxLQUFLLElBQUk7QUFDWixnQkFBTSxLQUFLLElBQUksUUFBUSxlQUFlLFFBQVEsSUFBSSxDQUFDO0FBQUcsYUFBRyxrQkFBa0IsS0FBSyxFQUFFO0FBQU0sYUFBRyxVQUFVLEtBQUs7QUFBUSxhQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBRyxhQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsS0FBSyxLQUFLLE1BQU0sS0FBSyxHQUFHO0FBQ2xPLGFBQUcsY0FBYztBQUFLLGFBQUcsY0FBYztBQUFLLGFBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxPQUFPLEtBQUssS0FBSztBQUFHLGFBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxNQUFNLEtBQUssSUFBSTtBQUN2SixhQUFHLGVBQWU7QUFBTSxhQUFHLGVBQWU7QUFBSyxhQUFHLFVBQVUsSUFBSSxRQUFRLFFBQVEsR0FBRyxLQUFLLENBQUM7QUFBRyxhQUFHLFlBQVksUUFBUSxlQUFlO0FBQWUsZUFBSyxLQUFLO0FBQUEsUUFDN0o7QUFDQSxjQUFNLElBQUksS0FBSztBQUFJLFVBQUUsV0FBVyxJQUFJO0FBQU0sVUFBRSxVQUFVLElBQUk7QUFBSyxVQUFFLFVBQVUsSUFBSTtBQUFLLFVBQUUsU0FBUyxJQUFJLFFBQVEsT0FBTyxHQUFHLElBQUksRUFBRTtBQUFHLFVBQUUsU0FBUyxJQUFJLFFBQVEsT0FBTyxHQUFHLElBQUksRUFBRTtBQUFHLFVBQUUsWUFBWSxJQUFJLFFBQVEsT0FBTyxLQUFLLEdBQUcsS0FBSyxDQUFDO0FBQ3ZOLFlBQUksQ0FBQyxFQUFFLFVBQVUsRUFBRyxHQUFFLE1BQU07QUFBQSxNQUM5QixXQUFXLEtBQUssTUFBTSxLQUFLLEdBQUcsVUFBVSxFQUFHLE1BQUssR0FBRyxLQUFLO0FBQ3hELFVBQUksUUFBUSxHQUFHO0FBQ2IsWUFBSSxDQUFDLEtBQUssTUFBTTtBQUFFLGVBQUssT0FBTyxRQUFRLFlBQVksWUFBWSxRQUFRLEVBQUUsVUFBVSxNQUFNLFdBQVcsTUFBTSxjQUFjLEdBQUcsR0FBRyxDQUFDO0FBQUcsZUFBSyxLQUFLLFNBQVMsS0FBSztBQUFRLGVBQUssS0FBSyxTQUFTLElBQUksS0FBSyxNQUFNO0FBQU0sZUFBSyxLQUFLLFdBQVcsS0FBSyxFQUFFO0FBQVMsZUFBSyxLQUFLLGFBQWE7QUFBQSxRQUFPO0FBQzVRLGFBQUssS0FBSyxXQUFXLElBQUk7QUFBQSxNQUMzQixXQUFXLEtBQUssS0FBTSxNQUFLLEtBQUssV0FBVyxLQUFLO0FBQUEsSUFDbEQ7QUFBQSxJQUNBLE1BQU0sR0FBa0I7QUFDdEIsWUFBTSxLQUFLLE1BQU07QUFBTSxXQUFLLElBQUksV0FBVyxFQUFFO0FBQUcsV0FBSyxLQUFLLFdBQVcsRUFBRTtBQUFHLFdBQUssUUFBUTtBQUFJLFVBQUksS0FBSyxHQUFJLE1BQUssR0FBRyxXQUFXLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFDN0ksVUFBSSxJQUFJO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSSxNQUFPLENBQVc7QUFBRyxhQUFLLEtBQUssUUFBUSxJQUFJO0FBQUcsYUFBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLFFBQVEsSUFBSSxNQUFNO0FBQUEsTUFBRztBQUFBLElBQzNIO0FBQUEsSUFDQSxRQUFRLEdBQWtCO0FBQ3hCLFlBQU0sS0FBSyxNQUFNO0FBQU0sV0FBSyxJQUFJLFdBQVcsRUFBRTtBQUFHLFdBQUssTUFBTSxXQUFXLEVBQUU7QUFDeEUsVUFBSSxJQUFJO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSSxNQUFPLENBQVc7QUFBRyxhQUFLLE1BQU0sUUFBUSxJQUFJO0FBQUcsYUFBSyxNQUFNLFNBQVMsSUFBSSxFQUFFLFFBQVEsSUFBSSxNQUFNO0FBQUEsTUFBRztBQUFBLElBQzdIO0FBQUEsSUFDQSxRQUFRLElBQWE7QUFBRSxVQUFJLEtBQUssSUFBSTtBQUFFLFlBQUksTUFBTSxDQUFDLEtBQUssR0FBRyxVQUFVLEVBQUcsTUFBSyxHQUFHLE1BQU07QUFBRyxZQUFJLENBQUMsTUFBTSxLQUFLLEdBQUcsVUFBVSxFQUFHLE1BQUssR0FBRyxLQUFLO0FBQUEsTUFBRztBQUFBLElBQUU7QUFBQSxJQUN6SSxPQUFPLElBQVk7QUFBRSxVQUFJLEtBQUssUUFBUSxLQUFLLEtBQUssVUFBVSxFQUFHLE1BQUssS0FBSyxTQUFTLEtBQUssS0FBSztBQUFBLElBQUs7QUFBQSxJQUMvRixVQUFVO0FBQUUsVUFBSSxLQUFLLElBQUk7QUFBRSxhQUFLLEdBQUcsS0FBSztBQUFHLGFBQUssR0FBRyxRQUFRO0FBQUEsTUFBRztBQUFFLE9BQUMsS0FBSyxNQUFNLEtBQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLEtBQUssS0FBSyxLQUFLLEVBQUUsUUFBUSxDQUFDLE1BQU0sS0FBSyxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssTUFBTSxRQUFRO0FBQUEsSUFBRztBQUFBLEVBQ3hNO0FBR0EsTUFBTSxjQUFOLE1BQXdDO0FBQUEsSUFLdEMsWUFBb0IsR0FBbUIsS0FBZSxNQUFjLE1BQWEsTUFBYztBQUEzRTtBQUFtQjtBQUp2QztBQUFhO0FBQWEsa0NBQU87QUFBRyxtQ0FBZ0I7QUFBUTtBQUM1RCwwQkFBUTtBQUFVLDBCQUFRO0FBQVcsMEJBQVEsU0FBNkIsQ0FBQztBQUFHLDBCQUFRLE9BQVc7QUFBTSwwQkFBUTtBQUFZLDBCQUFRO0FBQVcsMEJBQVEsVUFBUztBQUFHLDBCQUFRO0FBQzFLLDBCQUFRLGNBQWE7QUFBSSwwQkFBUSxPQUFNO0FBQUksMEJBQVEsT0FBVztBQUFNLDBCQUFRLFNBQVE7QUFBRywwQkFBUSxjQUFhO0FBQUssMEJBQVEsWUFBVztBQUFPLDBCQUFRLFVBQVM7QUFBTywwQkFBUSxVQUFTO0FBQUcsMEJBQVEsUUFBTztBQUFNLDBCQUFRLFVBQThDLENBQUM7QUFDblEsMEJBQVE7QUFFTixXQUFLLFNBQVM7QUFDZCxZQUFNLElBQUksRUFBRSxPQUFPLE1BQU0sS0FBSyxPQUFPLEVBQUUsU0FBUyxFQUFFLEVBQUUsTUFBTSxHQUFHLENBQUM7QUFBRyxXQUFLLE1BQU07QUFDNUUsV0FBSyxNQUFNLElBQUksVUFBVSx5QkFBeUIsQ0FBQyxNQUFjLElBQUksTUFBTSxLQUFLLE9BQU8sRUFBRSxrQkFBa0IsS0FBSyxDQUFDO0FBQ2pILFdBQUssU0FBUyxJQUFJLFFBQVEsY0FBYyxVQUFVLEtBQUssQ0FBQztBQUFHLFdBQUssSUFBSSxVQUFVLENBQUMsRUFBRSxTQUFTLEtBQUs7QUFDL0YsV0FBSyxPQUFPLEtBQUssSUFBSSxVQUFVLENBQUMsRUFBRSxlQUFlLEVBQUUsS0FBSyxDQUFDLE1BQVcsRUFBRSxLQUFLLFNBQVMsT0FBTyxDQUFDO0FBQzVGLFVBQUksQ0FBQyxJQUFJLFFBQVMsS0FBSSxVQUFVLEtBQUssS0FBSztBQUMxQyxXQUFLLElBQUksZ0JBQWdCLFFBQVEsQ0FBQ0MsT0FBVztBQUFFLFFBQUFBLEdBQUUsS0FBSztBQUFHLFFBQUFBLEdBQUUsaUJBQWlCO0FBQU0sUUFBQUEsR0FBRSxnQkFBZ0I7QUFBTSxhQUFLLE1BQU1BLEdBQUUsS0FBSyxNQUFNLEdBQUcsRUFBRSxDQUFDLENBQUMsSUFBSUE7QUFBQSxNQUFHLENBQUM7QUFDakosV0FBSyxJQUFJLFVBQVUsQ0FBQyxFQUFFLGVBQWUsRUFBRSxRQUFRLENBQUMsTUFBVztBQUFFLFVBQUUsMkJBQTJCO0FBQU0sVUFBRSxhQUFhO0FBQUEsTUFBTyxDQUFDO0FBQ3ZILFdBQUssTUFBTSxJQUFJO0FBQUssV0FBSyxPQUFPLElBQUk7QUFBTyxXQUFLLE9BQU87QUFDdkQsVUFBSSxJQUFJLE9BQVEsTUFBSyxhQUFhLElBQUksT0FBTyxNQUFNLEtBQUssT0FBTyxLQUFLLElBQUksT0FBTyxNQUFNLElBQUksT0FBTztBQUNoRyxXQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUcsS0FBSyxRQUFRLEtBQUssS0FBSyxHQUFHO0FBQ2xELFdBQUssT0FBTyxRQUFRLFlBQVksZUFBZSxRQUFRLEVBQUUsUUFBUSxLQUFLLFVBQVUsSUFBSSxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxLQUFLO0FBQVEsV0FBSyxLQUFLLFNBQVMsSUFBSTtBQUFLLFdBQUssS0FBSyxhQUFhO0FBQU8sV0FBSyxLQUFLLGFBQWE7QUFDNU0sV0FBSyxRQUFRLElBQUk7QUFBRyxXQUFLLFFBQVEsSUFBSTtBQUFHLFdBQUssS0FBSyxXQUFXLEVBQUUsTUFBTSxRQUFRLFFBQVEsS0FBSztBQUFBLElBQzVGO0FBQUEsSUFDUSxXQUFXO0FBQ2pCLFlBQU0sTUFBTSxLQUFLLE9BQU8sTUFBTSxLQUFLLE1BQU0sSUFBSSxLQUFLO0FBQ2xELFVBQUksRUFBRSxRQUFRO0FBQ1osWUFBSSxDQUFDLEtBQUssS0FBSztBQUFFLGVBQUssTUFBTSxFQUFFLFFBQVEsTUFBTSxTQUFTLEtBQUssR0FBRztBQUFHLGVBQUssSUFBSSxrQkFBa0IsRUFBRTtBQUFRLGVBQUssSUFBSSxvQkFBb0IsS0FBSztBQUFBLFFBQU07QUFDN0ksYUFBSyxJQUFJLGdCQUFnQixLQUFLLFNBQVMsSUFBSSxFQUFFLFdBQVcsRUFBRSxRQUFRO0FBQWUsY0FBTSxJQUFJLEtBQUssS0FBSyxPQUFPLENBQUM7QUFBRyxhQUFLLElBQUksY0FBYyxJQUFJLFFBQVEsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztBQUMxSyxhQUFLLElBQUksZ0JBQWdCLEtBQUssU0FBUyxJQUFJLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxHQUFHLElBQUksSUFBSSxRQUFRLE9BQU8sTUFBTSxLQUFLLENBQUM7QUFDN0csYUFBSyxLQUFLLFdBQVcsS0FBSztBQUFLO0FBQUEsTUFDakM7QUFDQSxVQUFJLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFFLGNBQU0sSUFBSSxFQUFFLFFBQVEsTUFBTSxPQUFPLEdBQUc7QUFBRyxZQUFJLEtBQUssU0FBUyxFQUFHLEdBQUUsZ0JBQWdCLEVBQUU7QUFBVSxjQUFNLElBQUksS0FBSyxLQUFLLE9BQU8sQ0FBQztBQUFHLFVBQUUsY0FBYyxJQUFJLFFBQVEsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztBQUFHLFVBQUUsU0FBUyxHQUFHLElBQUk7QUFBQSxNQUFHO0FBQzVOLFdBQUssS0FBSyxXQUFXLEVBQUUsU0FBUyxHQUFHO0FBQUEsSUFDckM7QUFBQSxJQUNBLFFBQVEsR0FBVTtBQUFFLFdBQUssT0FBTztBQUFHLFdBQUssU0FBUztBQUFHLFdBQUssS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJO0FBQUEsSUFBRztBQUFBLElBQ2pGLFFBQVEsSUFBWTtBQUFFLFdBQUssT0FBTztBQUFJLFdBQUssU0FBUztBQUFHLFdBQUssT0FBTyxRQUFRLE9BQU8sS0FBSyxHQUFHLEVBQUUsSUFBSSxLQUFLLElBQUk7QUFBRyxXQUFLLEtBQUssSUFBSSxLQUFLLE1BQU0sRUFBRTtBQUFHLFdBQUssS0FBSyxJQUFJLEtBQUssR0FBRyxFQUFFLElBQUksS0FBSyxJQUFJO0FBQUEsSUFBRztBQUFBLElBQzFLLEdBQUcsSUFBWTtBQUFFLGNBQVEsS0FBSyxJQUFJLGFBQWEsUUFBUSxLQUFLLE9BQU8sS0FBSyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQ3BGLE1BQU0sR0FBa0I7QUFBRSxXQUFLLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQzlDLFNBQVMsR0FBVztBQUFFLFdBQUssS0FBSyxTQUFTLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDN0MsUUFBUSxHQUFrQjtBQUFFLFdBQUssS0FBSyxRQUFRLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDbEQsUUFBUTtBQUFFLFdBQUssU0FBUztBQUFBLElBQU07QUFBQSxJQUM5QixLQUFLLE9BQWUsUUFBUSxHQUFHO0FBQzdCLFVBQUksT0FBTyxLQUFLLElBQUksTUFBTSxLQUFLLEdBQUc7QUFDbEMsVUFBSSxVQUFVLFdBQVcsS0FBSyxJQUFJLFFBQVE7QUFBRSxlQUFPLEtBQUssSUFBSSxPQUFPLEtBQUssTUFBTSxLQUFLLE9BQU8sSUFBSSxLQUFLLElBQUksT0FBTyxNQUFNLENBQUM7QUFBRyxlQUFPLEtBQUs7QUFBQSxNQUFNO0FBQzFJLFlBQU1BLEtBQUksS0FBSyxNQUFNLElBQUk7QUFBRyxVQUFJLENBQUNBLEdBQUc7QUFBUSxZQUFNLE9BQU8sVUFBVSxVQUFVLFVBQVU7QUFDdkYsVUFBSSxVQUFVLFVBQVUsS0FBSyxVQUFVLFdBQVcsS0FBSyxPQUFPLEtBQUssSUFBSSxhQUFhLEtBQUssSUFBSSxRQUFRO0FBQUUsYUFBSyxTQUFTO0FBQU07QUFBQSxNQUFRO0FBQ25JLFVBQUksUUFBUSxLQUFLLFVBQVUsU0FBUyxLQUFLLFFBQVFBLEdBQUc7QUFDcEQsV0FBSyxTQUFTO0FBQU8sV0FBSyxXQUFXO0FBQU8sV0FBSyxRQUFRO0FBQ3pELFVBQUksS0FBSyxJQUFLLE1BQUssSUFBSSxLQUFLO0FBQUcsTUFBQUEsR0FBRSxLQUFLO0FBQUcsTUFBQUEsR0FBRSxNQUFNLE1BQU0sT0FBT0EsR0FBRSxNQUFNQSxHQUFFLEVBQUU7QUFDMUUsVUFBSSxLQUFNLENBQUFBLEdBQUUsVUFBVUEsR0FBRSxPQUFPLEtBQUssT0FBTyxLQUFLQSxHQUFFLEtBQUtBLEdBQUUsS0FBSztBQUM5RCxXQUFLLE1BQU1BO0FBQUcsV0FBSyxRQUFRO0FBQU8sV0FBSyxLQUFLLFFBQVEsVUFBVSxPQUFPO0FBQ3JFLFVBQUksUUFBUSxLQUFLLE1BQU8sTUFBSyxNQUFNLEtBQUssT0FBTyxJQUFJO0FBQ25ELFVBQUksVUFBVSxTQUFTO0FBQUUsYUFBSyxTQUFTO0FBQUcsWUFBSSxLQUFLLElBQUksWUFBWTtBQUFFLGVBQUssTUFBTSxLQUFLLElBQUksWUFBWSxHQUFHO0FBQUcsZUFBSyxNQUFNLEtBQUssSUFBSSxZQUFZLEdBQUc7QUFBQSxRQUFHO0FBQUEsTUFBRTtBQUFBLElBQ3JKO0FBQUE7QUFBQSxJQUVRLE1BQU0sTUFBYyxRQUFRLEdBQUc7QUFDckMsWUFBTSxNQUFNLEtBQUssRUFBRSxNQUFNLElBQUk7QUFBRyxVQUFJLENBQUMsSUFBSztBQUMxQyxZQUFNLEtBQUssUUFBUSxZQUFZLFlBQVksT0FBTyxFQUFFLE1BQU0sS0FBSyxHQUFHLEtBQUssRUFBRSxLQUFLO0FBQUcsU0FBRyxTQUFTLEtBQUs7QUFBUSxTQUFHLGdCQUFnQixRQUFRLEtBQUs7QUFBbUIsU0FBRyxXQUFXO0FBQUssU0FBRyxhQUFhO0FBQU8sU0FBRyxhQUFhO0FBQ3ZOLFlBQU0sS0FBSyxLQUFLLE1BQU07QUFBTSxTQUFHLFNBQVMsSUFBSSxNQUFNLElBQUksQ0FBQztBQUFHLFdBQUssT0FBTyxLQUFLLEVBQUUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLEdBQUcsQ0FBQztBQUFBLElBQ3JHO0FBQUE7QUFBQSxJQUVRLGNBQWM7QUFDcEIsWUFBTSxJQUFJLEtBQUssSUFBSTtBQUFTLFdBQUssUUFBUTtBQUN6QyxVQUFJLE9BQU8sRUFBRSxNQUFNLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxLQUFLLGNBQWMsS0FBSyxNQUFNLEVBQUUsSUFBSSxDQUFDO0FBQUcsVUFBSSxDQUFDLEtBQUssT0FBUSxRQUFPLEVBQUUsTUFBTSxPQUFPLENBQUMsTUFBTSxLQUFLLE1BQU0sRUFBRSxJQUFJLENBQUM7QUFBRyxVQUFJLENBQUMsS0FBSyxPQUFRO0FBQzFLLFlBQU0sT0FBTyxLQUFLLEtBQUssTUFBTSxLQUFLLE9BQU8sSUFBSSxLQUFLLE1BQU0sQ0FBQyxHQUFHQSxLQUFJLEtBQUssTUFBTSxLQUFLLElBQUk7QUFBRyxXQUFLLGFBQWEsS0FBSztBQUM5RyxVQUFJLEtBQUssSUFBSyxNQUFLLElBQUksS0FBSztBQUFHLE1BQUFBLEdBQUUsS0FBSztBQUFHLE1BQUFBLEdBQUUsTUFBTSxPQUFPLEdBQUdBLEdBQUUsTUFBTUEsR0FBRSxFQUFFO0FBQUcsV0FBSyxNQUFNQTtBQUFHLFdBQUssV0FBVztBQUFNLFdBQUssYUFBYSxFQUFFLE1BQU0sS0FBSyxPQUFPLEtBQUssRUFBRSxNQUFNLEVBQUU7QUFDbkssVUFBSSxNQUFNLElBQUksS0FBSyxJQUFJLEVBQUcsT0FBTSxLQUFLLEtBQUssUUFBUSxJQUFJO0FBQ3RELFVBQUksS0FBSyxPQUFPO0FBQUUsYUFBSyxNQUFNLEtBQUssT0FBTyxHQUFHO0FBQUcsWUFBSSxLQUFLLFVBQVUsTUFBTyxNQUFLLE1BQU0sS0FBSyxPQUFPLEdBQUc7QUFBQSxNQUFHO0FBQUEsSUFDeEc7QUFBQSxJQUNBLE9BQU8sSUFBWTtBQUNqQixXQUFLLEtBQUssT0FBTyxFQUFFO0FBQ25CLFVBQUksS0FBSyxPQUFPLENBQUMsS0FBSyxJQUFJLFdBQVc7QUFDbkMsWUFBSSxLQUFLLFFBQVE7QUFBRSxlQUFLLFNBQVM7QUFBTyxlQUFLLEtBQUssTUFBTTtBQUFBLFFBQUcsV0FBVyxLQUFLLFVBQVU7QUFBRSxlQUFLLFdBQVc7QUFBTyxlQUFLLEtBQUssTUFBTTtBQUFBLFFBQUcsV0FBVyxLQUFLLFVBQVUsUUFBUyxNQUFLLEtBQUssTUFBTTtBQUFBLE1BQ3RMO0FBQ0EsVUFBSSxLQUFLLElBQUksVUFBVSxLQUFLLFVBQVUsVUFBVSxDQUFDLEtBQUssWUFBWSxLQUFLLE9BQU8sVUFBVSxHQUFHO0FBQUUsYUFBSyxTQUFTO0FBQUksWUFBSSxLQUFLLFNBQVMsS0FBSyxXQUFZLE1BQUssWUFBWTtBQUFBLE1BQUc7QUFDdEssVUFBSSxLQUFLLFVBQVUsUUFBUyxNQUFLLFVBQVU7QUFDM0MsZUFBUyxJQUFJLEtBQUssT0FBTyxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFDaEQsY0FBTSxJQUFJLEtBQUssT0FBTyxDQUFDO0FBQUcsVUFBRSxLQUFLO0FBQUksWUFBSSxFQUFFLElBQUksRUFBRztBQUFVLGNBQU0sSUFBSSxFQUFFLElBQUk7QUFDNUUsWUFBSSxLQUFLLEdBQUc7QUFBRSxZQUFFLEVBQUUsUUFBUTtBQUFHLGVBQUssT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFHO0FBQUEsUUFBVTtBQUNqRSxVQUFFLEVBQUUsYUFBYSxLQUFLLElBQUksR0FBRyxFQUFFLElBQUksR0FBRyxLQUFLLElBQUksSUFBSTtBQUFJLFVBQUUsRUFBRSxTQUFTLElBQUksT0FBTyxPQUFPLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLElBQUksS0FBSyxDQUFDO0FBQUcsVUFBRSxFQUFFLFFBQVEsT0FBTyxNQUFNLE1BQU0sQ0FBQztBQUFBLE1BQ2pLO0FBQ0EsVUFBSSxLQUFLLEtBQUs7QUFDWixZQUFJLFNBQVM7QUFDYixZQUFJLEtBQUssVUFBVSxRQUFTLFVBQVMsT0FBTyxPQUFPLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxJQUFJLEtBQUssU0FBUyxPQUFPLFFBQVEsR0FBRyxDQUFDO0FBQUEsaUJBQ3BHLEtBQUssVUFBVSxPQUFRLFVBQVMsS0FBSyxXQUFXLE9BQU87QUFBQSxpQkFDdkQsS0FBSyxVQUFVLE1BQU8sVUFBUztBQUFBLGlCQUFjLEtBQUssVUFBVSxTQUFVLFVBQVM7QUFBQSxpQkFBYyxLQUFLLFVBQVUsUUFBUyxVQUFTO0FBQUEsaUJBQWMsS0FBSyxVQUFVLFFBQVMsVUFBUztBQUN0TCxhQUFLLFNBQVMsU0FBUyxLQUFLLFFBQVEsS0FBSyxJQUFJLEdBQUcsS0FBSyxDQUFDO0FBQUcsYUFBSyxJQUFJLG9CQUFvQixLQUFLO0FBQUEsTUFDN0Y7QUFDQSxVQUFJLEtBQUssU0FBUyxHQUFHO0FBQUUsYUFBSyxVQUFVO0FBQUksY0FBTSxJQUFJLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLElBQUksT0FBTyxLQUFLLEVBQUU7QUFBRyxhQUFLLE9BQU8sUUFBUSxPQUFPLEtBQUssR0FBRyxLQUFLLElBQUksSUFBSSxLQUFLLE9BQU8sQ0FBQztBQUFBLE1BQUc7QUFBQSxJQUN0TDtBQUFBLElBQ0EsVUFBVTtBQUFFLFdBQUssT0FBTyxRQUFRLENBQUMsTUFBTSxFQUFFLEVBQUUsUUFBUSxDQUFDO0FBQUcsVUFBSSxLQUFLLElBQUssTUFBSyxJQUFJLFFBQVE7QUFBRyxXQUFLLEtBQUssUUFBUTtBQUFHLFdBQUssSUFBSSxnQkFBZ0IsUUFBUSxDQUFDQSxPQUFXQSxHQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssSUFBSSxVQUFVLFFBQVEsQ0FBQyxNQUFXLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxLQUFLLFFBQVE7QUFBRyxXQUFLLElBQUksVUFBVSxDQUFDLEVBQUUsUUFBUSxPQUFPLEtBQUs7QUFBRyxXQUFLLE9BQU8sUUFBUTtBQUFBLElBQUc7QUFBQSxFQUN6VDtBQUdBLE1BQU0sS0FBeUc7QUFBQSxJQUM3RyxRQUFRLEVBQUUsS0FBSyxXQUFXLEdBQUcsTUFBTSxHQUFHLE1BQU0sTUFBTSxNQUFNLFFBQVEsVUFBVSxPQUFPLFNBQVM7QUFBQSxJQUMxRixRQUFRLEVBQUUsS0FBSyxXQUFXLEdBQUcsS0FBSyxHQUFHLEtBQUssTUFBTSxNQUFNLFFBQVEsVUFBVSxPQUFPLFNBQVM7QUFBQSxJQUN4RixNQUFNLEVBQUUsS0FBSyxXQUFXLEdBQUcsTUFBTSxHQUFHLE1BQU0sTUFBTSxNQUFNLFFBQVEsUUFBUSxPQUFPLE9BQU87QUFBQSxJQUNwRixXQUFXLEVBQUUsS0FBSyxXQUFXLEdBQUcsTUFBTSxHQUFHLE1BQU0sTUFBTSxNQUFNLFFBQVEsT0FBTyxPQUFPLFlBQVk7QUFBQSxFQUMvRjtBQUNBLE1BQU0sb0JBQU4sTUFBOEM7QUFBQSxJQUc1QyxZQUFvQixHQUFtQixNQUFjLE1BQWEsTUFBYztBQUE1RDtBQUFtQjtBQUZ2QztBQUFhO0FBQWEsa0NBQU87QUFBRyxtQ0FBZ0I7QUFBUTtBQUM1RCwwQkFBUTtBQUFVLDBCQUFRLFFBQWMsQ0FBQztBQUFHLDBCQUFRO0FBQVMsMEJBQVE7QUFBWSwwQkFBUTtBQUFXLDBCQUFRLEtBQUksS0FBSyxPQUFPLElBQUk7QUFBRywwQkFBUSxPQUFNO0FBQUcsMEJBQVEsT0FBTTtBQUFHLDBCQUFRLFFBQU87QUFBRywwQkFBUSxVQUFTO0FBQUcsMEJBQVEsUUFBYyxDQUFDO0FBQUcsMEJBQVE7QUFFM08sWUFBTSxJQUFJLEVBQUUsT0FBTyxJQUFJLEdBQUcsSUFBSTtBQUFHLFdBQUssT0FBTztBQUM3QyxXQUFLLFNBQVMsSUFBSSxRQUFRLGNBQWMsUUFBUSxNQUFNLENBQUM7QUFBRyxXQUFLLE1BQU0sSUFBSSxRQUFRLGNBQWMsT0FBTyxDQUFDO0FBQUcsV0FBSyxJQUFJLFNBQVMsS0FBSztBQUNqSSxZQUFNLE1BQU0sQ0FBQyxLQUFhLEtBQUssTUFBTTtBQUFFLGNBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sQ0FBQztBQUFHLFVBQUUsZUFBZSxRQUFRLE9BQU8sY0FBYyxHQUFHLEVBQUUsTUFBTSxJQUFJO0FBQUcsVUFBRSxnQkFBZ0IsSUFBSSxRQUFRLE9BQU8sS0FBSyxLQUFLLEdBQUc7QUFBRyxZQUFJLEdBQUksR0FBRSxnQkFBZ0IsRUFBRSxhQUFhLE1BQU0sRUFBRTtBQUFHLGVBQU87QUFBQSxNQUFHO0FBQzNRLFlBQU0sT0FBTyxNQUFNLFFBQVEsT0FBTyxFQUFFLElBQUk7QUFDeEMsaUJBQVcsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHO0FBQUUsY0FBTSxLQUFLLElBQUksUUFBUSxjQUFjLE9BQU8sQ0FBQztBQUFHLFdBQUcsU0FBUyxLQUFLO0FBQUssV0FBRyxTQUFTLElBQUksS0FBSyxFQUFFLElBQUksTUFBTSxNQUFNLENBQUM7QUFBRyxjQUFNLElBQUksUUFBUSxZQUFZLGVBQWUsS0FBSyxFQUFFLFFBQVEsTUFBTSxVQUFVLEVBQUUsSUFBSSxLQUFLLEdBQUcsQ0FBQztBQUFHLFVBQUUsU0FBUztBQUFJLFVBQUUsU0FBUyxJQUFJLENBQUMsT0FBTztBQUFHLFVBQUUsV0FBVyxJQUFJLFNBQVM7QUFBRyxVQUFFLGFBQWE7QUFBTyxhQUFLLEtBQUssS0FBSyxFQUFFO0FBQUEsTUFBRztBQUMzVixXQUFLLE9BQU8sUUFBUSxZQUFZLGNBQWMsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEdBQUcsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLElBQUksR0FBRyxDQUFDO0FBQUcsV0FBSyxLQUFLLFNBQVMsS0FBSztBQUFLLFdBQUssS0FBSyxTQUFTLElBQUk7QUFBTyxXQUFLLEtBQUssV0FBVyxJQUFJLEVBQUUsR0FBRztBQUFHLFdBQUssS0FBSyxhQUFhO0FBQzNOLFlBQU0sT0FBTyxRQUFRLFlBQVksYUFBYSxRQUFRLEVBQUUsVUFBVSxFQUFFLE9BQU8sS0FBSyxVQUFVLEdBQUcsR0FBRyxDQUFDO0FBQUcsV0FBSyxTQUFTLEtBQUs7QUFBSyxXQUFLLFNBQVMsSUFBSSxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU87QUFBTSxXQUFLLFdBQVcsSUFBSSxFQUFFLEdBQUc7QUFBRyxXQUFLLGFBQWE7QUFDeE4sWUFBTSxPQUFPLElBQUksUUFBUSxpQkFBaUIsT0FBTyxDQUFDO0FBQUcsV0FBSyxlQUFlLFFBQVEsT0FBTyxNQUFNO0FBQUcsV0FBSyxnQkFBZ0IsU0FBUyxJQUFJLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxDQUFDLElBQUksSUFBSSxRQUFRLE9BQU8sR0FBRyxNQUFNLElBQUk7QUFBRyxNQUFDLEtBQWEsT0FBTztBQUMvTixpQkFBVyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUc7QUFBRSxjQUFNLElBQUksUUFBUSxZQUFZLGFBQWEsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLElBQUksR0FBRyxDQUFDO0FBQUcsVUFBRSxTQUFTLEtBQUs7QUFBSyxVQUFFLFNBQVMsSUFBSSxLQUFLLEVBQUUsT0FBTyxLQUFLLEtBQUssU0FBUyxJQUFJLE1BQU0sRUFBRSxPQUFPLElBQUk7QUFBRyxVQUFFLFdBQVc7QUFBTSxVQUFFLGFBQWE7QUFBQSxNQUFPO0FBRXBQLFdBQUssS0FBSyxJQUFJLFFBQVEsY0FBYyxNQUFNLENBQUM7QUFBRyxXQUFLLEdBQUcsU0FBUyxLQUFLO0FBQUssV0FBSyxHQUFHLFNBQVMsSUFBSSxFQUFFLElBQUksS0FBSyxPQUFPLEVBQUUsSUFBSSxNQUFNLElBQUk7QUFDaEksWUFBTSxLQUFLLElBQUksU0FBUyxHQUFHLE9BQU8sSUFBSSxTQUFTO0FBQy9DLFlBQU0sS0FBSyxDQUFDLEdBQVEsTUFBYyxNQUFXLEtBQWUsT0FBWTtBQUFFLGNBQU0sSUFBSSxTQUFTLFFBQVEsUUFBUSxZQUFZLFVBQVUsS0FBSyxNQUFNLENBQUMsSUFBSSxTQUFTLFFBQVEsUUFBUSxZQUFZLGVBQWUsS0FBSyxNQUFNLENBQUMsSUFBSSxRQUFRLFlBQVksYUFBYSxLQUFLLE1BQU0sQ0FBQztBQUFHLFVBQUUsU0FBUyxLQUFLO0FBQUksVUFBRSxTQUFTLElBQUksSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7QUFBRyxVQUFFLFdBQVc7QUFBSSxVQUFFLGFBQWE7QUFBTyxlQUFPO0FBQUEsTUFBRztBQUNwWCxVQUFJLEVBQUUsV0FBVyxTQUFVLElBQUcsR0FBRyxPQUFPLEVBQUUsT0FBTyxNQUFNLFFBQVEsS0FBSyxPQUFPLEtBQUssR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsSUFBSTtBQUN4RyxVQUFJLEVBQUUsV0FBVyxVQUFVO0FBQUUsV0FBRyxHQUFHLE9BQU8sRUFBRSxPQUFPLE1BQU0sUUFBUSxLQUFLLE9BQU8sS0FBSyxHQUFHLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxJQUFJO0FBQUcsY0FBTSxLQUFLLFFBQVEsWUFBWSxlQUFlLE1BQU0sRUFBRSxRQUFRLE1BQU0sVUFBVSxLQUFLLEdBQUcsQ0FBQztBQUFHLFdBQUcsU0FBUyxLQUFLO0FBQUssV0FBRyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQUcsV0FBRyxTQUFTLElBQUksQ0FBQyxFQUFFLElBQUksS0FBSyxPQUFPLEVBQUUsSUFBSSxLQUFLLElBQUk7QUFBRyxXQUFHLFdBQVcsSUFBSSxTQUFTO0FBQUcsV0FBRyxhQUFhO0FBQUEsTUFBTztBQUNwVyxVQUFJLEVBQUUsV0FBVyxRQUFRO0FBQUUsV0FBRyxHQUFHLE9BQU8sRUFBRSxRQUFRLEtBQUssVUFBVSxLQUFLLEdBQUcsQ0FBQyxHQUFHLE9BQU8sR0FBRyxHQUFHLEVBQUU7QUFBRyxXQUFHLEdBQUcsT0FBTyxFQUFFLFVBQVUsSUFBSSxHQUFHLENBQUMsR0FBRyxPQUFPLEdBQUcsR0FBRyxJQUFJO0FBQUEsTUFBRztBQUN2SixVQUFJLEVBQUUsV0FBVyxPQUFPO0FBQUUsV0FBRyxHQUFHLE9BQU8sRUFBRSxRQUFRLEtBQUssVUFBVSxLQUFLLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLEVBQUU7QUFBRyxXQUFHLEdBQUcsT0FBTyxFQUFFLE9BQU8sTUFBTSxRQUFRLE1BQU0sT0FBTyxLQUFLLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLElBQUk7QUFBRyxjQUFNLE9BQU8sUUFBUSxZQUFZLGVBQWUsUUFBUSxFQUFFLFFBQVEsS0FBSyxhQUFhLEdBQUcsZ0JBQWdCLEVBQUUsT0FBTyxJQUFJLEdBQUcsQ0FBQztBQUFHLGFBQUssU0FBUyxLQUFLO0FBQUssYUFBSyxTQUFTLElBQUksS0FBSyxTQUFTLElBQUksRUFBRSxPQUFPO0FBQU0sYUFBSyxXQUFXLElBQUksU0FBUztBQUFHLGFBQUssYUFBYTtBQUFBLE1BQU87QUFDOWEsV0FBSyxNQUFNLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTztBQUFNLFdBQUssT0FBTyxJQUFJLEtBQUssR0FBRyxLQUFLLFFBQVEsS0FBSyxLQUFLLEVBQUUsSUFBSSxHQUFHO0FBQy9GLFlBQU0sTUFBTSxJQUFJLEdBQUcsS0FBSyxJQUFJLENBQUMsTUFBTTtBQUFFLFVBQUUsT0FBTztBQUF3QixVQUFFLFlBQVk7QUFBVSxVQUFFLFlBQVk7QUFBVyxVQUFFLGNBQWM7QUFBUSxVQUFFLFlBQVk7QUFBRyxVQUFFLFdBQVcsRUFBRSxRQUFRLGVBQWUsS0FBSyxFQUFFO0FBQUcsVUFBRSxTQUFTLEVBQUUsUUFBUSxlQUFlLEtBQUssRUFBRTtBQUFBLE1BQUcsQ0FBQztBQUMvUCxZQUFNLEtBQUssUUFBUSxZQUFZLFlBQVksT0FBTyxFQUFFLE9BQU8sS0FBSyxRQUFRLElBQUksR0FBRyxDQUFDO0FBQUcsU0FBRyxTQUFTLEtBQUs7QUFBUSxTQUFHLFNBQVMsSUFBSTtBQUFNLFNBQUcsU0FBUyxJQUFJLEtBQUssS0FBSyxJQUFJO0FBQUssU0FBRyxnQkFBZ0IsUUFBUSxLQUFLO0FBQW1CLFlBQU0sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sQ0FBQztBQUFHLFNBQUcsaUJBQWlCO0FBQUssU0FBRyxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxTQUFHLGtCQUFrQjtBQUFNLFNBQUcsNkJBQTZCO0FBQU0sU0FBRyxXQUFXO0FBQUksU0FBRyxhQUFhO0FBQU8sU0FBRyxTQUFTLElBQUksS0FBSyxNQUFNO0FBQ25kLFdBQUssT0FBTyxRQUFRLFlBQVksZUFBZSxRQUFRLEVBQUUsUUFBUSxLQUFLLEtBQUssVUFBVSxLQUFLLElBQUksS0FBSyxFQUFFLElBQUksR0FBRyxFQUFFLEdBQUcsQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLEtBQUs7QUFBUSxXQUFLLEtBQUssU0FBUyxJQUFJLEtBQUssTUFBTTtBQUFHLFdBQUssS0FBSyxhQUFhO0FBQU8sV0FBSyxLQUFLLFdBQVcsRUFBRSxNQUFNLFFBQVEsUUFBUSxLQUFLO0FBQzFRLE1BQUMsS0FBYSxRQUFRLENBQUMsRUFBRTtBQUFHLFdBQUssUUFBUSxJQUFJO0FBQUcsV0FBSyxRQUFRLElBQUk7QUFBRyxXQUFLLEtBQUssTUFBTTtBQUFBLElBQ3RGO0FBQUEsSUFDQSxRQUFRLEdBQVU7QUFBRSxXQUFLLE9BQU87QUFBRyxNQUFDLEtBQWEsS0FBSyxnQkFBZ0IsTUFBTSxJQUFJLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxDQUFDLElBQUksSUFBSSxRQUFRLE9BQU8sR0FBRyxNQUFNLElBQUk7QUFBRyxXQUFLLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSTtBQUFBLElBQUc7QUFBQSxJQUNwTCxRQUFRLElBQVk7QUFBRSxXQUFLLE9BQU87QUFBSSxXQUFLLE9BQU8sUUFBUSxLQUFLLE1BQU0sS0FBSyxDQUFDO0FBQUcsWUFBTSxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUcsV0FBSyxLQUFLLFNBQVMsZUFBZSxRQUFRLE9BQU8sY0FBYyxHQUFHLEtBQUssSUFBSSxFQUFFLEdBQUcsRUFBRSxNQUFNLElBQUksRUFBRSxTQUFTLElBQUksUUFBUSxPQUFPLEtBQUssSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFBRyxXQUFLLE9BQU8sUUFBUSxPQUFPLEtBQUssSUFBSTtBQUFHLFdBQUssS0FBSyxJQUFJLEtBQUssTUFBTSxFQUFFO0FBQUcsV0FBSyxLQUFLLElBQUksS0FBSyxJQUFJO0FBQUEsSUFBRztBQUFBLElBQzFYLE1BQU0sR0FBa0I7QUFBRSxXQUFLLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQzlDLFNBQVMsR0FBVztBQUFFLFdBQUssS0FBSyxTQUFTLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDN0MsUUFBUSxHQUFrQjtBQUFFLFdBQUssS0FBSyxRQUFRLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDbEQsUUFBUTtBQUFFLFdBQUssU0FBUztBQUFBLElBQU07QUFBQSxJQUM5QixLQUFLLE9BQWUsUUFBUSxHQUFHO0FBQUUsVUFBSSxVQUFVLEtBQUssVUFBVSxVQUFVLFVBQVUsVUFBVSxPQUFRO0FBQVEsV0FBSyxRQUFRO0FBQU8sV0FBSyxNQUFNLEtBQUs7QUFBRyxXQUFLLE1BQU0sVUFBVSxXQUFZLFFBQVEsTUFBTSxLQUFLLElBQWMsRUFBRSxVQUFVLFFBQVMsVUFBVSxVQUFVLE1BQU0sVUFBVSxVQUFVLE1BQU07QUFBSyxXQUFLLEtBQUssUUFBUSxVQUFVLE9BQU87QUFBQSxJQUFHO0FBQUEsSUFDelUsT0FBTyxJQUFZO0FBQ2pCLFdBQUssS0FBSztBQUFJLFdBQUssS0FBSyxPQUFPLEVBQUU7QUFBRyxZQUFNLElBQUksS0FBSyxJQUFJLElBQUksS0FBSyxJQUFJLEtBQUssT0FBTyxLQUFLLEdBQUcsR0FBRyxJQUFJLEtBQUssS0FBSyxJQUFJLEtBQUs7QUFDbEgsUUFBRSxTQUFTLElBQUksR0FBRyxHQUFHLENBQUM7QUFBRyxRQUFFLFNBQVMsSUFBSSxHQUFHLEdBQUcsQ0FBQztBQUFHLFFBQUUsUUFBUSxPQUFPLENBQUM7QUFBRyxRQUFFLFNBQVMsSUFBSTtBQUFNLFdBQUssS0FBSyxRQUFRLENBQUMsTUFBTyxFQUFFLFNBQVMsSUFBSSxDQUFFO0FBQ3ZJLFVBQUksS0FBSyxVQUFVLE9BQVEsR0FBRSxTQUFTLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxHQUFHLElBQUk7QUFBQSxlQUMxRCxLQUFLLFVBQVUsT0FBTztBQUFFLGNBQU0sSUFBSSxLQUFLLElBQUk7QUFBSSxVQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLENBQUMsQ0FBQyxJQUFJO0FBQU0sVUFBRSxTQUFTLElBQUk7QUFBSyxhQUFLLEtBQUssQ0FBQyxFQUFFLFNBQVMsSUFBSSxLQUFLLElBQUksQ0FBQyxJQUFJO0FBQUssYUFBSyxLQUFLLENBQUMsRUFBRSxTQUFTLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJO0FBQUssVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksQ0FBQyxJQUFJO0FBQUEsTUFBSyxXQUNwUCxLQUFLLFVBQVUsVUFBVTtBQUFFLGNBQU0sSUFBSSxJQUFJLE1BQU0sUUFBUSxJQUFJLE9BQU8sT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksT0FBTyxJQUFJO0FBQUcsVUFBRSxTQUFTLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLEtBQUssQ0FBQztBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUEsTUFBRyxXQUMxTixLQUFLLFVBQVUsU0FBUztBQUFFLGNBQU0sSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJO0FBQUksVUFBRSxRQUFRLE9BQU8sT0FBTyxPQUFPLENBQUM7QUFBRyxVQUFFLFNBQVMsS0FBSyxJQUFJLEtBQUs7QUFBQSxNQUFLLFdBQzFILEtBQUssVUFBVSxTQUFTO0FBQUUsY0FBTSxJQUFJLElBQUk7QUFBRyxVQUFFLFNBQVMsSUFBSSxDQUFDLEtBQUssS0FBSyxJQUFJO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTztBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU87QUFBQSxNQUFHLFdBQzlILEtBQUssVUFBVSxTQUFTO0FBQUUsVUFBRSxTQUFTLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDLElBQUk7QUFBTSxVQUFFLFNBQVMsSUFBSTtBQUFBLE1BQU07QUFDOUcsVUFBSSxLQUFLLFNBQVMsR0FBRztBQUFFLGFBQUssVUFBVTtBQUFJLGNBQU0sSUFBSSxJQUFJLE9BQU8sS0FBSyxJ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O0FBQUksY0FBTSxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTTtBQUFHLFVBQUUsRUFBRSxRQUFRLElBQUksR0FBRyxHQUFHLENBQUM7QUFBRyxVQUFFLEdBQUcsUUFBUSxPQUFPLElBQUk7QUFBSSxZQUFJLEtBQUssR0FBRztBQUFFLFlBQUUsRUFBRSxRQUFRO0FBQUcsWUFBRSxHQUFHLFFBQVE7QUFBRyxlQUFLLE9BQU8sT0FBTyxHQUFHLENBQUM7QUFBQSxRQUFHO0FBQUEsTUFBRTtBQUM3USxVQUFJLEtBQUssT0FBTyxHQUFHO0FBQUUsYUFBSyxPQUFPLEtBQUssSUFBSSxHQUFHLEtBQUssT0FBTyxLQUFLLEtBQUssTUFBTTtBQUFHLGNBQU0sSUFBSSxLQUFLLE9BQU8sS0FBSyxRQUFRLElBQUksSUFBSSxLQUFLO0FBQU8sYUFBSyxPQUFPLFdBQVcsUUFBUSxRQUFRLEtBQUssS0FBSyxRQUFRLEtBQUssS0FBSyxNQUFNLEtBQUssQ0FBQztBQUFHLGFBQUssU0FBUyxRQUFRLFFBQVEsS0FBSyxLQUFLLFFBQVEsS0FBSyxLQUFLLE1BQU0sS0FBSyxDQUFDO0FBQUcsYUFBSyxPQUFPLFVBQVUsS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUFBLE1BQUcsV0FDalUsS0FBSyxVQUFVLFlBQVksS0FBSyxZQUFZLFdBQVcsQ0FBQyxLQUFLLEtBQU0sTUFBSyxZQUFZLEVBQUU7QUFDL0YsV0FBSyxNQUFNLE9BQU8sRUFBRTtBQUNwQixlQUFTLElBQUksS0FBSyxPQUFPLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFFLGNBQU0sSUFBSSxLQUFLLE9BQU8sQ0FBQztBQUFHLFVBQUUsS0FBSztBQUFJLGNBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxFQUFFLElBQUksRUFBRSxHQUFHO0FBQUcsVUFBRSxHQUFHLENBQUM7QUFBRyxZQUFJLEtBQUssR0FBRztBQUFFLGVBQUssT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFHLGNBQUksRUFBRSxLQUFNLEdBQUUs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WUFBRSxPQUFPLFNBQVMsS0FBSyxJQUFJLE9BQU8sS0FBSyxJQUFJLElBQUksS0FBSyxJQUFJO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBTSxZQUFFLEtBQUssTUFBTTtBQUFHLGNBQUksS0FBSyxDQUFDO0FBQUEsUUFBRyxDQUFDLENBQUM7QUFBQSxNQUFHO0FBQ3RULGNBQVE7QUFBRyxXQUFLLE9BQU8sU0FBUyxJQUFJLEdBQUcsS0FBSyxLQUFLO0FBQUcsV0FBSyxPQUFPLFVBQVUsSUFBSSxRQUFRLFFBQVEsR0FBRyxLQUFLLElBQUksQ0FBQztBQUFHLFdBQUssT0FBTyxNQUFNO0FBQ2hJLE1BQUMsT0FBZSxZQUFZLEVBQUUsU0FBUyxDQUFDLE1BQWE7QUFBRSxlQUFPO0FBQUcsZ0JBQVE7QUFBQSxNQUFHLEdBQUcsSUFBSTtBQUNuRixVQUFJLE9BQU8sWUFBWSxJQUFJO0FBQUcsV0FBSyxPQUFPLGNBQWMsTUFBTTtBQUFFLGNBQU0sSUFBSSxZQUFZLElBQUksR0FBRyxLQUFLLEtBQUssSUFBSSxPQUFPLElBQUksUUFBUSxHQUFJO0FBQUcsZUFBTztBQUFHLFlBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUFHLGFBQUssTUFBTSxPQUFPO0FBQUEsTUFBRyxDQUFDO0FBQUEsSUFDek07QUFBQSxFQUNGOzs7QUN2bEJBLE1BQU0sSUFBSSxJQUFJLEtBQUs7QUFDbkIsRUFBQyxPQUFlLFNBQVM7QUFDekIsSUFBRSxLQUFLLFNBQVMsZUFBZSxHQUFHLENBQXNCLEVBQ3JELEtBQUssTUFBTTtBQUFFLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksRUFBRyxHQUFFLE1BQU0sVUFBVTtBQUFRLElBQUMsT0FBZSxjQUFjO0FBQU0sV0FBTyxjQUFjLElBQUksTUFBTSxrQkFBa0IsQ0FBQztBQUFBLEVBQUcsQ0FBQyxFQUN0TCxNQUFNLENBQUMsTUFBTTtBQUNaLFVBQU0sSUFBSSxTQUFTLGVBQWUsU0FBUztBQUFHLFFBQUksR0FBRztBQUFFLFFBQUUsTUFBTSxVQUFVO0FBQVEsUUFBRSxjQUFjLGFBQWEsS0FBSyxFQUFFLFVBQVUsRUFBRSxVQUFVO0FBQUEsSUFBSTtBQUMvSSxZQUFRLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLENBQUM7IiwKICAibmFtZXMiOiBbImciLCAiZW5lbXlQb3dlciIsICJ0ZyIsICJNQVhfVU5JVFMiLCAiZyIsICJnIiwgImciLCAiS0VZIiwgIlZFUlNJT04iLCAic3RhZ2VXYXZlcyIsICJkcmF3IiwgImciLCAiZyIsICJwIl0KfQo=
