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
    if (best >= 0) w[best] = { ...w[best], boss: true };
    return w;
  }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vY29yZS9iYWxhbmNlLnRzIiwgIi4uL2NvcmUvZGF0YS50cyIsICIuLi9jb3JlL3JuZy50cyIsICIuLi9jb3JlL3J1bGVzLnRzIiwgIi4uL2dhbWUvYXJlbmEudHMiLCAiLi4vY29yZS9lbmRsZXNzLnRzIiwgIi4uL2NvcmUvd2F2ZXMudHMiLCAiLi4vY29yZS9iYXR0bGUudHMiLCAiLi4vY29yZS9wcm90b3R5cGUudHMiLCAiLi4vY29yZS9kYWlseS50cyIsICIuLi9jb3JlL3BhY2tzLnRzIiwgIi4uL2NvcmUvc2F2ZS50cyIsICIuLi9jb3JlL3Byb2dyZXNzLnRzIiwgIi4uL2dhbWUvbmVjcm9tYW5jZXIudHMiLCAiLi4vZ2FtZS9hdWRpby50cyIsICIuLi9jb3JlL3J1bnNhdmUudHMiLCAiLi4vZ2FtZS92aXN1YWxzLnRzIiwgIi4uL3VpL2ljb25zLnRzIiwgIi4uL3VpL3BvcnRyYWl0cy50cyIsICIuLi9nYW1lL3VpLnRzIiwgIi4uL2dhbWUvZ2FtZS50cyIsICIuLi9nYW1lL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIGV2ZXJ5IG51bWJlciB0aGF0IGFmZmVjdHMgY29tYmF0LlxuLy8gVGhlIGRlYnVnIHBhbmVsIGVkaXRzIEJBTEFOQ0UgbGl2ZTsgYHJlc2V0QmFsYW5jZSgpYCByZXN0b3JlcyB0aGVzZSBkZWZhdWx0cy5cbi8vIEFsbCB2YWx1ZXMgYXJlIGZpcnN0LXBhc3MgZ3Vlc3NlcyBtZWFudCB0byBiZSB0dW5lZCBieSBwbGF5aW5nIGFuZCBieSBgbm9kZSBzaW0vY2FtcGFpZ24udHNgLlxuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFN0YXRzIHtcbiAgaHA6IG51bWJlcjsgICAgICAgICAvLyAxLXN0YXIgaGl0IHBvaW50c1xuICBkbWc6IG51bWJlcjsgICAgICAgIC8vIDEtc3RhciBkYW1hZ2UgcGVyIGhpdCAocGVyIGFycm93IGZvciB0aGUgQXJjaGVyKVxuICBpbnRlcnZhbDogbnVtYmVyOyAgIC8vIHNlY29uZHMgYmV0d2VlbiBhdHRhY2tzXG4gIHJhbmdlOiBudW1iZXI7ICAgICAgLy8gbWV0cmVzIChjZW50cmUgdG8gY2VudHJlKVxuICBzcGVlZDogbnVtYmVyOyAgICAgIC8vIG1ldHJlcyBwZXIgc2Vjb25kXG4gIHNpemU6IG51bWJlcjsgICAgICAgLy8gYm9keSByYWRpdXMsIHVzZWQgZm9yIHNwYWNpbmcgYW5kIHZpc3VhbHNcbiAgYW5pbUxlbjogbnVtYmVyOyAgICAvLyBzZWNvbmRzOiBsZW5ndGggb2YgdGhpcyB1bml0J3MgYXR0YWNrIGNsaXAgYXQgbm9ybWFsIHNwZWVkXG4gIGhpdEZyYWM6IG51bWJlcjsgICAgLy8gMC0xOiBob3cgZmFyIGludG8gdGhlIGNsaXAgdGhlIGJsb3cgbGFuZHMgLyB0aGUgYXJyb3cgaXMgcmVsZWFzZWRcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCYWxhbmNlIHtcbiAgc3RhdHM6IFJlY29yZDxTb3VsSWQsIFVuaXRTdGF0cz47XG4gIHN0YXI6IHtcbiAgICBocDogbnVtYmVyW107ICAgICAvLyBtdWx0aXBsaWVyIGF0IDEsIDIsIDMgc3RhcnNcbiAgICBkbWc6IG51bWJlcltdO1xuICAgIHNjYWxlOiBudW1iZXJbXTsgIC8vIHZpc3VhbCBzaXplXG4gIH07XG4gIHBoYWxhbng6IHsgcmFkaXVzOiBudW1iZXI7IHBlckFsbHk6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXIgfTsgICAgICAgICAgLy8gU2tlbGV0b24gV2FycmlvclxuICBtYW5hOiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIHsgbWF4OiBudW1iZXI7IHBlckF0dGFjazogbnVtYmVyOyBwZXJIaXQ6IG51bWJlciB9Pj47IC8vIHVuaXRzIFdJVEggYSBza2lsbDsgdGhlIHJlc3QgYXJlIHBhc3NpdmUtb25seVxuICB2b2xsZXk6IHsgdGFyZ2V0czogbnVtYmVyOyBwcm9qZWN0aWxlU3BlZWQ6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgIC8vIFNrZWxldG9uIEFyY2hlciBza2lsbDogU3BsaXQgQXJyb3dcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IG51bWJlcjsgc2Vla1JhZGl1czogbnVtYmVyOyB3b3VuZGVkV2VpZ2h0OiBudW1iZXIgfTsgLy8gR29ibGluXG4gIHRhdW50OiB7IGR1cmF0aW9uOiBudW1iZXI7IHJhZGl1czogbnVtYmVyIH07ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gS25pZ2h0IHNraWxsXG4gIHNtYXNoOiB7IG11bHQ6IG51bWJlcjsgcmFkaXVzOiBudW1iZXIgfTsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2dyZSBza2lsbFxuICBmcmVuenk6IHsgcGVyU3dpbmc6IG51bWJlcjsgbWF4U3RhY2tzOiBudW1iZXI7IHJlc2V0QWZ0ZXI6IG51bWJlciB9OyAgICAgIC8vIEJhcmJhcmlhblxuICAvKiogUExBQ0VIT0xERVIgcGVybWFuZW50LWxldmVsIGdyb3d0aCAocGVyIGxldmVsIGFib3ZlIDEpLiBTaG93biBvbiB0aGUgU291bHMgcGFnZTsgTk9UIGFwcGxpZWQgaW4gYmF0dGxlcyB5ZXQuICovXG4gIGxldmVsOiB7IGhwOiBudW1iZXI7IGRtZzogbnVtYmVyOyBjb3BpZXNUb0xldmVsOiBudW1iZXJbXTsgZ29sZFRvTGV2ZWw6IG51bWJlcltdIH07XG4gIHNpbTogeyBzZXBhcmF0aW9uOiBudW1iZXI7IGhpdEZyYWN0aW9uOiBudW1iZXI7IHRpbWVMaW1pdDogbnVtYmVyOyByZXRhcmdldEV2ZXJ5OiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRTOiBCYWxhbmNlID0ge1xuICBzdGF0czoge1xuICAgIHdhcnJpb3I6ICAgeyBocDogNjAsICBkbWc6IDgsICBpbnRlcnZhbDogMC45LCByYW5nZTogMC44NSwgc3BlZWQ6IDEuNCwgc2l6ZTogMC4yOCwgYW5pbUxlbjogMS4wLCBoaXRGcmFjOiAwLjQ3IH0sXG4gICAgYXJjaGVyOiAgICB7IGhwOiA0MCwgIGRtZzogNywgIGludGVydmFsOiAxLjcsIHJhbmdlOiA1LjAsICBzcGVlZDogMS4xLCBzaXplOiAwLjI2LCBhbmltTGVuOiAxLjUsIGhpdEZyYWM6IDAuNzggfSxcbiAgICBnb2JsaW46ICAgIHsgaHA6IDQ1LCAgZG1nOiA5LCAgaW50ZXJ2YWw6IDAuOCwgcmFuZ2U6IDAuOCwgIHNwZWVkOiAxLjcsIHNpemU6IDAuMjQsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gICAga25pZ2h0OiAgICB7IGhwOiAxMzAsIGRtZzogOSwgIGludGVydmFsOiAxLjEsIHJhbmdlOiAwLjksICBzcGVlZDogMS4wLCBzaXplOiAwLjMyLCBhbmltTGVuOiAxLjAsIGhpdEZyYWM6IDAuNSB9LFxuICAgIG9ncmU6ICAgICAgeyBocDogMTcwLCBkbWc6IDE2LCBpbnRlcnZhbDogMS45LCByYW5nZTogMS4wNSwgc3BlZWQ6IDAuOCwgc2l6ZTogMC40MiwgYW5pbUxlbjogMS4yLCBoaXRGcmFjOiAwLjU1IH0sXG4gICAgYmFyYmFyaWFuOiB7IGhwOiAxMTAsIGRtZzogMTIsIGludGVydmFsOiAwLjksIHJhbmdlOiAwLjksIHNwZWVkOiAxLjUsIHNpemU6IDAuMzAsIGFuaW1MZW46IDEuMCwgaGl0RnJhYzogMC41IH0sXG4gIH0sXG4gIC8vIFwiYm9kaWVzID0gZGFtYWdlLCBzdGFycyA9IGR1cmFiaWxpdHlcIjogSFAgZ3Jvd3MgZmFzdGVyIHRoYW4gZGFtYWdlIHBlciBzdGFyXG4gIHN0YXI6IHsgaHA6IFsxLCAyLjAsIDMuMl0sIGRtZzogWzEsIDEuNSwgMi4wXSwgc2NhbGU6IFsxLCAxLjEyLCAxLjI1XSB9LFxuICBwaGFsYW54OiB7IHJhZGl1czogMi4wLCBwZXJBbGx5OiAwLjA4LCBtYXhTdGFja3M6IDMgfSxcbiAgLy8gbWFuYSBmaWxscyBmYXN0OiBhIGJhc2ljIGF0dGFjayBnaXZlcyBwZXJBdHRhY2ssIHRha2luZyBhIGhpdCBnaXZlcyBwZXJIaXQ7IGEgZnVsbCBiYXIgZmlyZXMgdGhlIHNraWxsIG9uIHRoZSBuZXh0IGF0dGFjaywgdGhlbiByZXNldHNcbiAgbWFuYToge1xuICAgIGFyY2hlcjogeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTcGxpdCBBcnJvdyBhYm91dCBldmVyeSAzcmQgc2hvdFxuICAgIG9ncmU6ICAgeyBtYXg6IDEwMCwgcGVyQXR0YWNrOiAzNCwgcGVySGl0OiA2IH0sICAgICAvLyBTbWFzaCBhYm91dCBldmVyeSAzcmQgc3dpbmdcbiAgICBrbmlnaHQ6IHsgbWF4OiAxMDAsIHBlckF0dGFjazogMjUsIHBlckhpdDogMTIgfSwgICAgLy8gVGF1bnQgZXZlcnkgfjQgc3dpbmdzLCBzb29uZXIgd2hlbiBoZSBpcyBiZWluZyBoaXRcbiAgfSxcbiAgdm9sbGV5OiB7IHRhcmdldHM6IDMsIHByb2plY3RpbGVTcGVlZDogMTQgfSxcbiAgb3Bwb3J0dW5pc3Q6IHsgYm9udXM6IDAuNSwgc2Vla1JhZGl1czogNC4wLCB3b3VuZGVkV2VpZ2h0OiAxLjUgfSxcbiAgdGF1bnQ6IHsgZHVyYXRpb246IDMsIHJhZGl1czogNC41IH0sXG4gIHNtYXNoOiB7IG11bHQ6IDIuMCwgcmFkaXVzOiAxLjYgfSxcbiAgZnJlbnp5OiB7IHBlclN3aW5nOiAwLjE0LCBtYXhTdGFja3M6IDgsIHJlc2V0QWZ0ZXI6IDAuNiB9LFxuICBsZXZlbDogeyBocDogMC4wOCwgZG1nOiAwLjA4LCBjb3BpZXNUb0xldmVsOiBbNSwgMTAsIDIwLCA0MCwgODAsIDEyMCwgMjAwLCAzMDAsIDUwMF0sIGdvbGRUb0xldmVsOiBbNjAwMCwgMTIwMDAsIDI0MDAwLCA0ODAwMCwgOTYwMDAsIDE2ODAwMCwgMjcwMDAwLCA0MjAwMDAsIDY2MDAwMF0gfSxcbiAgc2ltOiB7IHNlcGFyYXRpb246IDAuNiwgaGl0RnJhY3Rpb246IDAuNDcsIHRpbWVMaW1pdDogMTIwLCByZXRhcmdldEV2ZXJ5OiAwLjUgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBCQUxBTkNFOiBCYWxhbmNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShERUZBVUxUUykpO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRCYWxhbmNlKCk6IHZvaWQge1xuICBjb25zdCBmcmVzaDogQmFsYW5jZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoREVGQVVMVFMpKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGZyZXNoKSBhcyAoa2V5b2YgQmFsYW5jZSlbXSkgKEJBTEFOQ0UgYXMgYW55KVtrXSA9IChmcmVzaCBhcyBhbnkpW2tdO1xufVxuXG5leHBvcnQgY29uc3QgUk9MRV9URVhUOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnQ2hlYXAgYW5kIGZhc3QuIFRvdWdoZXIgbmVhciBvdGhlciBXYXJyaW9ycy4nLFxuICBhcmNoZXI6ICdGcmFnaWxlLiBTa2lsbDogU3BsaXQgQXJyb3cgaGl0cyAzIGRpZmZlcmVudCBlbmVtaWVzLicsXG4gIGdvYmxpbjogJ0Zhc3QuIEhpdHMgaGFyZGVyIG9uIGVuZW1pZXMgZmlnaHRpbmcgc29tZW9uZSBlbHNlLicsXG4gIGtuaWdodDogJ1RhbmsuIFNraWxsOiBUYXVudCBwdWxscyBlbmVtaWVzIG9udG8gaGltLicsXG4gIG9ncmU6ICdTbG93LCBodWdlIGRhbWFnZS4gU2tpbGw6IFNtYXNoLCBhIGJpZyBhcmVhIHNsYW0uJyxcbiAgYmFyYmFyaWFuOiAnU3dpbmdzIGZhc3RlciB3aXRoIGV2ZXJ5IHVuaW50ZXJydXB0ZWQgaGl0LicsXG59O1xuXG5leHBvcnQgY29uc3QgU09VTF9OQU1FOiBSZWNvcmQ8U291bElkLCBzdHJpbmc+ID0ge1xuICB3YXJyaW9yOiAnU2tlbGV0b24gV2FycmlvcicsIGFyY2hlcjogJ1NrZWxldG9uIEFyY2hlcicsIGdvYmxpbjogJ0dvYmxpbicsXG4gIGtuaWdodDogJ0tuaWdodCcsIG9ncmU6ICdPZ3JlJywgYmFyYmFyaWFuOiAnQmFyYmFyaWFuJyxcbn07XG5cbi8qKiBBYmlsaXR5IGJsdXJicyBmb3IgdGhlIFNvdWxzIHBhZ2UsIHdpdGggdGhlIGxpdmUgbnVtYmVycyBmaWxsZWQgaW4uICovXG5leHBvcnQgZnVuY3Rpb24gYWJpbGl0eUluZm8oc291bDogU291bElkKTogeyBraW5kOiAnc2tpbGwnIHwgJ3Bhc3NpdmUnOyBuYW1lOiBzdHJpbmc7IHRleHQ6IHN0cmluZyB9IHtcbiAgY29uc3QgQiA9IEJBTEFOQ0UsIHBjdCA9ICh4OiBudW1iZXIpID0+IE1hdGgucm91bmQoeCAqIDEwMCkgKyAnJSc7XG4gIHN3aXRjaCAoc291bCkge1xuICAgIGNhc2UgJ3dhcnJpb3InOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdQaGFsYW54JywgdGV4dDogYFRha2VzICR7cGN0KEIucGhhbGFueC5wZXJBbGx5KX0gbGVzcyBkYW1hZ2UgZm9yIGVhY2ggb3RoZXIgU2tlbGV0b24gV2FycmlvciB3aXRoaW4gJHtCLnBoYWxhbngucmFkaXVzfW0gKHVwIHRvICR7Qi5waGFsYW54Lm1heFN0YWNrc30pLmAgfTtcbiAgICBjYXNlICdnb2JsaW4nOiByZXR1cm4geyBraW5kOiAncGFzc2l2ZScsIG5hbWU6ICdPcHBvcnR1bmlzdCcsIHRleHQ6IGBEZWFscyAke3BjdChCLm9wcG9ydHVuaXN0LmJvbnVzKX0gbW9yZSBkYW1hZ2UgdG8gYW4gZW5lbXkgdGhhdCBpcyBmaWdodGluZyBzb21lb25lIGVsc2UsIGFuZCBwcmVmZXJzIHN1Y2ggdGFyZ2V0cy5gIH07XG4gICAgY2FzZSAnYmFyYmFyaWFuJzogcmV0dXJuIHsga2luZDogJ3Bhc3NpdmUnLCBuYW1lOiAnRnJlbnp5JywgdGV4dDogYEF0dGFja3MgJHtwY3QoQi5mcmVuenkucGVyU3dpbmcpfSBmYXN0ZXIgd2l0aCBldmVyeSB1bmludGVycnVwdGVkIHN3aW5nICh1cCB0byAke0IuZnJlbnp5Lm1heFN0YWNrc30gdGltZXMpLmAgfTtcbiAgICBjYXNlICdhcmNoZXInOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU3BsaXQgQXJyb3cnLCB0ZXh0OiBgQmFzaWMgc2hvdHMgZmlyZSBvbmUgYXJyb3cuIFdoZW4gbWFuYSBpcyBmdWxsLCB0aGUgbmV4dCBzaG90IGZpcmVzIGF0IHVwIHRvICR7Qi52b2xsZXkudGFyZ2V0c30gZGlmZmVyZW50IGVuZW1pZXMuYCB9O1xuICAgIGNhc2UgJ2tuaWdodCc6IHJldHVybiB7IGtpbmQ6ICdza2lsbCcsIG5hbWU6ICdUYXVudCcsIHRleHQ6IGBXaGVuIG1hbmEgaXMgZnVsbCwgZW5lbWllcyB3aXRoaW4gJHtCLnRhdW50LnJhZGl1c31tIG11c3QgYXR0YWNrIGhpbSBmb3IgJHtCLnRhdW50LmR1cmF0aW9ufXMuYCB9O1xuICAgIGNhc2UgJ29ncmUnOiByZXR1cm4geyBraW5kOiAnc2tpbGwnLCBuYW1lOiAnU21hc2gnLCB0ZXh0OiBgV2hlbiBtYW5hIGlzIGZ1bGwsIHRoZSBuZXh0IHN3aW5nIGRlYWxzICR7Qi5zbWFzaC5tdWx0fXggZGFtYWdlIGFuZCBoaXRzIGVuZW1pZXMgbmVhciB0aGUgdGFyZ2V0IGZvciA2MCUgYXMgbXVjaC5gIH07XG4gIH1cbn1cbiIsICIvLyBEZXNpZ24gZGF0YSBzdHJhaWdodCBmcm9tIHRoZSBwbGFuIGRvYy4gQW55dGhpbmcgbWFya2VkIFBMQUNFSE9MREVSIGlzIG5vdCBpbiB0aGUgZG9jIHlldC5cblxuZXhwb3J0IHR5cGUgU291bElkID0gJ3dhcnJpb3InIHwgJ2FyY2hlcicgfCAnZ29ibGluJyB8ICdrbmlnaHQnIHwgJ29ncmUnIHwgJ2JhcmJhcmlhbic7XG5cbmV4cG9ydCBjb25zdCBTT1VMUzogU291bElkW10gPSBbJ3dhcnJpb3InLCAnYXJjaGVyJywgJ2dvYmxpbicsICdrbmlnaHQnLCAnb2dyZScsICdiYXJiYXJpYW4nXTtcblxuLyoqIERvbWluaW9uIGNvc3QgcGVyIHN0YXIgbGV2ZWw6IGluZGV4IDAgPSAxIHN0YXIsIDEgPSAyIHN0YXJzLCAyID0gMyBzdGFycyAoMyBzdGFycyBpcyB0aGUgbWF4KS4gKi9cbmV4cG9ydCBjb25zdCBDT1NUOiBSZWNvcmQ8U291bElkLCBudW1iZXJbXT4gPSB7XG4gIHdhcnJpb3I6IFsyLCAzLCA0XSxcbiAgYXJjaGVyOiBbNCwgNiwgOV0sXG4gIGdvYmxpbjogWzMsIDQsIDZdLFxuICBrbmlnaHQ6IFs1LCA3LCAxMF0sXG4gIG9ncmU6IFs3LCAxMCwgMTVdLFxuICBiYXJiYXJpYW46IFs1LCA3LCAxMF0sIC8vIFBMQUNFSE9MREVSOiB0aGUgZG9jIGhhcyBubyBjb3N0IGZvciB0aGUgc2l4dGggU291bCB5ZXRcbn07XG5cbmV4cG9ydCBjb25zdCBNQVhfU1RBUiA9IDM7XG5leHBvcnQgY29uc3QgR1JJRF9DRUxMUyA9IDEyOyAvLyA0IHggM1xuXG4vKiogRG9taW5pb24gY2FwIHBlciB3YXZlIChpbmRleCAwID0gd2F2ZSAxKS4gKi9cbmV4cG9ydCBjb25zdCBDVVJWRVM6IFJlY29yZDxzdHJpbmcsIG51bWJlcltdPiA9IHtcbiAgLy8gTE9DS0VEIChjb25maXJtZWQpOiArNCBmb3Igd2F2ZXMgMi01LCB0aGVuICszIGZvciB3YXZlcyA2LTEwIC0+IDQwXG4gIGRvYzogWzksIDEzLCAxNywgMjEsIDI1LCAyOCwgMzEsIDM0LCAzNywgNDBdLFxuICAvLyBOT1QgVVNFRDogbWlzcmVtZW1iZXJlZCB2YXJpYW50ICgrMyB0aHJvdWdoIHdhdmUgNiwgdGhlbiArMikgdGhhdCBvbmx5IHJlYWNoZXMgMzIuIEtlcHQgZm9yIGNvbXBhcmlzb24gb25seS5cbiAgcmVjYWxsZWQ6IFs5LCAxMiwgMTUsIDE4LCAyMSwgMjQsIDI2LCAyOCwgMzAsIDMyXSxcbn07XG5cbmV4cG9ydCBjb25zdCBIRUFSVFMgPSAzO1xuZXhwb3J0IGNvbnN0IFNUQVJUX0hBTkQgPSA0O1xuZXhwb3J0IGNvbnN0IFdBVkVTID0gMTA7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnVsZXMge1xuICAvKiogRG9taW5pb24gY2FwIHBlciB3YXZlLiAqL1xuICBjdXJ2ZTogbnVtYmVyW107XG4gIC8qKlxuICAgKiAnZGVwbG95ZWRPbmx5Jzogb25seSB0d28gZGVwbG95ZWQgdW5pdHMgb2YgdGhlIHNhbWUgc3RhciBjYW4gbWVyZ2UgKGRvYyBhcyB3cml0dGVuKS5cbiAgICogJ2hhbmRJbnRvT25lU3Rhcic6IGFkZGl0aW9uYWxseSBhIDEtc3RhciBjYXJkIGluIGhhbmQgY2FuIGJlIHBsYXllZCBvbnRvIGEgZGVwbG95ZWRcbiAgICogMS1zdGFyIHVuaXQgb2YgdGhlIHNhbWUgU291bCB0byBtZXJnZSBpbW1lZGlhdGVseSAocGF5cyBvbmx5IHRoZSBjb3N0IGRpZmZlcmVuY2UpLlxuICAgKi9cbiAgbWVyZ2U6ICdkZXBsb3llZE9ubHknIHwgJ2hhbmRJbnRvT25lU3Rhcic7XG4gIC8qKiBDYXJkLWluZmxvdyBrbm9icyAoYWxsIG9wdGlvbmFsOyBkZWZhdWx0cyByZXByb2R1Y2UgdGhlIGRvYykuICovXG4gIHN0YXJ0SGFuZD86IG51bWJlcjsgICAgICAgICAgICAvLyBkZWZhdWx0IDRcbiAgZHJhZnRQaWNrcz86IG51bWJlcjsgICAgICAgICAgIC8vIGNhcmRzIGtlcHQgZnJvbSB0aGUgMy1jYXJkIFZpY3RvcnkgRHJhZnQsIGRlZmF1bHQgMVxuICBub3JtYWxEcmF3V2F2ZXM/OiBudW1iZXJbXTsgICAgLy8gd2F2ZXMgKGJlaW5nIGVudGVyZWQpIHRoYXQgYWxzbyBnaXZlIHRoZSBub3JtYWwgcmFuZG9tIGRyYXc7IGRlZmF1bHQgPSBhbGxcbiAgLyoqIFNvdWxzIHRoaXMgcnVuIG1heSBkcmF3IGZyb20gKHRoZSBlcXVpcHBlZCBTb3VsIERlY2ssIG1heCA2KS4gRGVmYXVsdDogZXZlcnkgU291bC4gKi9cbiAgcG9vbD86IFNvdWxJZFtdO1xuICBzdGFnZVdhdmVzPzogbnVtYmVyOyAgICAgICAgICAgLy8gd2F2ZXMgaW4gdGhpcyBzdGFnZTsgZGVmYXVsdCAxMCAodGhlIHBsYXlhYmxlIHByb3RvdHlwZSB1c2VzIDMpXG59XG5cbmV4cG9ydCBjb25zdCBHUklEX0NPTFMgPSA0LCBHUklEX1JPV1MgPSAzOyAgIC8vIDQgeCAzID0gR1JJRF9DRUxMUzsgY29sdW1uIEdSSURfQ09MUy0xIGlzIHRoZSBmcm9udCBsaW5lXG4iLCAiLy8gU21hbGwgc2VlZGVkIFJORyAobXVsYmVycnkzMikuIFNhbWUgc2VlZCAtPiBzYW1lIHJ1biwgc28gYW55IGJ1ZyByZXBvcnQgaXMgcmVwcm9kdWNpYmxlLlxuLy8gYHN0YXRlKClgIC8gdGhlIGByZXN1bWVgIGFyZ3VtZW50IGxldCBhIHNhdmVkIHJ1biBjb250aW51ZSBkcmF3aW5nIGV4YWN0bHkgdGhlIGNhcmRzIGl0IHdvdWxkIGhhdmUgZHJhd24uXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgbmV4dCgpOiBudW1iZXI7ICAgICAgICAgICAgICAvLyBbMCwgMSlcbiAgaW50KG46IG51bWJlcik6IG51bWJlcjsgICAgICAvLyBbMCwgbilcbiAgcGljazxUPihpdGVtczogcmVhZG9ubHkgVFtdKTogVDtcbiAgc2VlZDogbnVtYmVyO1xuICBzdGF0ZSgpOiBudW1iZXI7ICAgICAgICAgICAgIC8vIHRoZSBnZW5lcmF0b3IncyBjdXJyZW50IHBvc2l0aW9uLCBmb3Igc2F2aW5nIGEgcnVuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYWtlUm5nKHNlZWQ6IG51bWJlciwgcmVzdW1lPzogbnVtYmVyKTogUm5nIHtcbiAgbGV0IGEgPSAocmVzdW1lID8/IHNlZWQpID4+PiAwO1xuICBjb25zdCBuZXh0ID0gKCkgPT4ge1xuICAgIGEgPSAoYSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gYTtcbiAgICB0ID0gTWF0aC5pbXVsKHQgXiAodCA+Pj4gMTUpLCB0IHwgMSk7XG4gICAgdCBePSB0ICsgTWF0aC5pbXVsKHQgXiAodCA+Pj4gNyksIHQgfCA2MSk7XG4gICAgcmV0dXJuICgodCBeICh0ID4+PiAxNCkpID4+PiAwKSAvIDQyOTQ5NjcyOTY7XG4gIH07XG4gIHJldHVybiB7XG4gICAgc2VlZCxcbiAgICBuZXh0LFxuICAgIGludDogKG4pID0+IE1hdGguZmxvb3IobmV4dCgpICogbiksXG4gICAgcGljazogKGl0ZW1zKSA9PiBpdGVtc1tNYXRoLmZsb29yKG5leHQoKSAqIGl0ZW1zLmxlbmd0aCldLFxuICAgIHN0YXRlOiAoKSA9PiBhLFxuICB9O1xufVxuIiwgIi8vIFB1cmUgZ2FtZSBydWxlcyBmb3Igb25lIHN0YWdlLiBObyBncmFwaGljcywgbm8gY29tYmF0OiBqdXN0IGNhcmRzLCBEb21pbmlvbiwgZ3JpZCwgbWVyZ2UsIHdhdmVzLCBoZWFydHMuXG4vLyBFdmVyeSBtdXRhdGlvbiBnb2VzIHRocm91Z2ggYSBmdW5jdGlvbiBoZXJlIGFuZCBhcHBlbmRzIHRvIHN0YXRlLmxvZywgc28gcnVucyBjYW4gYmUgcmVwbGF5ZWQgYW5kIGluc3BlY3RlZC5cblxuaW1wb3J0IHsgQ09TVCwgR1JJRF9DRUxMUywgSEVBUlRTLCBNQVhfU1RBUiwgU09VTFMsIFNUQVJUX0hBTkQsIFdBVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMsIFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tICcuL3JuZy50cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdCB7IGlkOiBudW1iZXI7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7IGZyZXNoPzogYm9vbGVhbiB9ICAgLy8gZnJlc2ggPSBzdW1tb25lZCB0aGlzIGJ1aWxkIHBoYXNlXG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdGUge1xuICBydWxlczogUnVsZXM7XG4gIHJuZzogUm5nO1xuICB3YXZlOiBudW1iZXI7ICAgICAgICAgICAgICAgICAvLyAxLWJhc2VkXG4gIGhlYXJ0czogbnVtYmVyO1xuICBjYXA6IG51bWJlcjtcbiAgaGFuZDogU291bElkW107XG4gIHVuaXRzOiBVbml0W107XG4gIG5leHRJZDogbnVtYmVyO1xuICBkaXNjYXJkVXNlZDogYm9vbGVhbjsgICAgICAgICAvLyBvbmNlLXBlci1idWlsZC1waGFzZSByZWRyYXdcbiAgc3RhdHVzOiAnYnVpbGRpbmcnIHwgJ3dvbicgfCAnbG9zdCc7XG4gIGxvZzogc3RyaW5nW107XG4gIHN0YXRzOiB7IGRyYXduOiBudW1iZXI7IGRpc2NhcmRlZDogbnVtYmVyOyBkaXNtaXNzZWQ6IG51bWJlcjsgbWVyZ2VzOiBudW1iZXI7IGZhaWx1cmVzOiBudW1iZXIgfTtcbn1cblxuZXhwb3J0IGNvbnN0IGNvc3QgPSAoc291bDogU291bElkLCBzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG5leHBvcnQgY29uc3QgY2FyZHNJbiA9IChzdGFyOiBudW1iZXIpOiBudW1iZXIgPT4gMiAqKiAoc3RhciAtIDEpOyAgICAgLy8gY2FyZHMgYSB1bml0IGlzIFwid29ydGhcIlxuZXhwb3J0IGNvbnN0IGRvbWluaW9uVXNlZCA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnVuaXRzLnJlZHVjZSgobiwgdSkgPT4gbiArIGNvc3QodS5zb3VsLCB1LnN0YXIpLCAwKTtcbmV4cG9ydCBjb25zdCBkb21pbmlvbkZyZWUgPSAoczogU3RhdGUpOiBudW1iZXIgPT4gcy5jYXAgLSBkb21pbmlvblVzZWQocyk7XG5cbmZ1bmN0aW9uIGxvZyhzOiBTdGF0ZSwgbXNnOiBzdHJpbmcpIHsgcy5sb2cucHVzaChgW3cke3Mud2F2ZX1dICR7bXNnfWApOyB9XG4vKiogVGhlIFNvdWxzIHRoaXMgcnVuIGRyYXdzIGZyb206IHRoZSBlcXVpcHBlZCBkZWNrLCBvciBldmVyeXRoaW5nIGlmIG5vIGRlY2sgd2FzIGdpdmVuLiAqL1xuZXhwb3J0IGNvbnN0IHBvb2xPZiA9IChzOiBTdGF0ZSk6IFNvdWxJZFtdID0+IChzLnJ1bGVzLnBvb2wgJiYgcy5ydWxlcy5wb29sLmxlbmd0aCA/IHMucnVsZXMucG9vbCA6IFNPVUxTKTtcbmZ1bmN0aW9uIGRyYXcoczogU3RhdGUsIHdoeTogc3RyaW5nLCBub3Q/OiBTb3VsSWQpOiBTb3VsSWQge1xuICBjb25zdCBhbGwgPSBwb29sT2YocyksIG90aGVycyA9IG5vdCA/IGFsbC5maWx0ZXIoKHgpID0+IHggIT09IG5vdCkgOiBhbGw7XG4gIGNvbnN0IHBvb2wgPSBvdGhlcnMubGVuZ3RoID8gb3RoZXJzIDogYWxsOyAgICAgICAgICAgICAgICAgICAgICAgLy8gYSBzd2FwIG5ldmVyIGhhbmRzIHlvdSBiYWNrIHRoZSBTb3VsIHlvdSBnYXZlIHVwICh1bmxlc3MgaXQgaXMgdGhlIG9ubHkgb25lIGVxdWlwcGVkKVxuICBjb25zdCBjID0gcy5ybmcucGljayhwb29sKTtcbiAgcy5oYW5kLnB1c2goYyk7IHMuc3RhdHMuZHJhd24rKztcbiAgbG9nKHMsIGBkcmF3ICR7Y30gKCR7d2h5fSlgKTtcbiAgcmV0dXJuIGM7XG59XG5cbi8qKiBBIG5ldyBidWlsZCBwaGFzZSBiZWdpbnM6IHRoZSBvbmNlLXBlci1waGFzZSBzd2FwIGNvbWVzIGJhY2sgYW5kIG5vdGhpbmcgY291bnRzIGFzIFwic3VtbW9uZWQgdGhpcyByb3VuZFwiLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5ld1BoYXNlKHM6IFN0YXRlKTogdm9pZCB7XG4gIHMuZGlzY2FyZFVzZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCB1IG9mIHMudW5pdHMpIHUuZnJlc2ggPSBmYWxzZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld1N0YWdlKHJ1bGVzOiBSdWxlcywgc2VlZDogbnVtYmVyKTogU3RhdGUge1xuICBjb25zdCBzOiBTdGF0ZSA9IHtcbiAgICBydWxlcywgcm5nOiBtYWtlUm5nKHNlZWQpLCB3YXZlOiAxLCBoZWFydHM6IEhFQVJUUywgY2FwOiBydWxlcy5jdXJ2ZVswXSwgaGFuZDogW10sIHVuaXRzOiBbXSwgbmV4dElkOiAxLFxuICAgIGRpc2NhcmRVc2VkOiBmYWxzZSwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IFtdLFxuICAgIHN0YXRzOiB7IGRyYXduOiAwLCBkaXNjYXJkZWQ6IDAsIGRpc21pc3NlZDogMCwgbWVyZ2VzOiAwLCBmYWlsdXJlczogMCB9LFxuICB9O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IChydWxlcy5zdGFydEhhbmQgPz8gU1RBUlRfSEFORCk7IGkrKykgZHJhdyhzLCAnc3RhcnRpbmcgaGFuZCcpO1xuICAvLyBPcGVuaW5nLWhhbmQgc2FmZWd1YXJkOiBtZXJnaW5nIGlzIHRoZSBoZWFydCBvZiB0aGUgZ2FtZSwgc28gdGhlIGZpcnN0IGhhbmQgYWx3YXlzIGhvbGRzIGF0IGxlYXN0IG9uZSBtYXRjaGluZyBwYWlyICh3aXRoIHNpeCBTb3VscywgYWJvdXQgMjglIG9mIHJhbmRvbSBoYW5kcyB3b3VsZCBub3QpLlxuICBpZiAocy5oYW5kLmxlbmd0aCA+PSAyICYmIG5ldyBTZXQocy5oYW5kKS5zaXplID09PSBzLmhhbmQubGVuZ3RoKSB7IGNvbnN0IGsgPSBNYXRoLmZsb29yKHMucm5nLm5leHQoKSAqIChzLmhhbmQubGVuZ3RoIC0gMSkpOyBzLmhhbmRbcy5oYW5kLmxlbmd0aCAtIDFdID0gcy5oYW5kW2tdOyBsb2cocywgYHN0YXJ0aW5nIGhhbmQ6IGxhc3QgY2FyZCBiZWNhbWUgYSBjb3B5IG9mICR7cy5oYW5kW2tdfSBzbyBhIG1lcmdlIGlzIHBvc3NpYmxlYCk7IH1cbiAgcmV0dXJuIHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmcmVlQ2VsbChzOiBTdGF0ZSk6IG51bWJlciB7XG4gIGNvbnN0IHRha2VuID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSBpZiAoIXRha2VuLmhhcyhjKSkgcmV0dXJuIGM7XG4gIHJldHVybiAtMTtcbn1cblxuLy8gLS0tLSBidWlsZC1waGFzZSBhY3Rpb25zIChlYWNoIHJldHVybnMgdHJ1ZSB3aGVuIGl0IGhhcHBlbmVkKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhblN1bW1vbihzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF07XG4gIHJldHVybiBzb3VsICE9PSB1bmRlZmluZWQgJiYgZnJlZUNlbGwocykgPj0gMCAmJiBjb3N0KHNvdWwsIDEpIDw9IGRvbWluaW9uRnJlZShzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNlbGxGcmVlKHM6IFN0YXRlLCBjZWxsOiBudW1iZXIpOiBib29sZWFuIHtcbiAgcmV0dXJuIGNlbGwgPj0gMCAmJiBjZWxsIDwgR1JJRF9DRUxMUyAmJiAhcy51bml0cy5zb21lKCh1KSA9PiB1LmNlbGwgPT09IGNlbGwpO1xufVxuXG4vKiogU3VtbW9uIGEgaGFuZCBjYXJkIG9udG8gYSBzcGVjaWZpYyBmcmVlIGNlbGwgKGRlZmF1bHQ6IHRoZSBmaXJzdCBmcmVlIG9uZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc3VtbW9uKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIGNlbGw/OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5TdW1tb24ocywgaGFuZElkeCkpIHJldHVybiBmYWxzZTtcbiAgaWYgKGNlbGwgIT09IHVuZGVmaW5lZCAmJiAhY2VsbEZyZWUocywgY2VsbCkpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc291bCA9IHMuaGFuZC5zcGxpY2UoaGFuZElkeCwgMSlbMF07XG4gIGNvbnN0IHU6IFVuaXQgPSB7IGlkOiBzLm5leHRJZCsrLCBzb3VsLCBzdGFyOiAxLCBjZWxsOiBjZWxsID8/IGZyZWVDZWxsKHMpLCBmcmVzaDogdHJ1ZSB9O1xuICBzLnVuaXRzLnB1c2godSk7XG4gIGxvZyhzLCBgc3VtbW9uICR7c291bH0gMSogLT4gY2VsbCAke3UuY2VsbH0gIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuTWVyZ2VEZXBsb3llZChhOiBVbml0LCBiOiBVbml0KTogYm9vbGVhbiB7XG4gIHJldHVybiBhLmlkICE9PSBiLmlkICYmIGEuc291bCA9PT0gYi5zb3VsICYmIGEuc3RhciA9PT0gYi5zdGFyICYmIGEuc3RhciA8IE1BWF9TVEFSO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VEZXBsb3llZChzOiBTdGF0ZSwgYUlkOiBudW1iZXIsIGJJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGFJZCksIGIgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuaWQgPT09IGJJZCk7XG4gIGlmICghYSB8fCAhYiB8fCAhY2FuTWVyZ2VEZXBsb3llZChhLCBiKSkgcmV0dXJuIGZhbHNlO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHUpID0+IHUuaWQgIT09IGIuaWQpO1xuICBhLmZyZXNoID0gISEoYS5mcmVzaCB8fCBiLmZyZXNoKTtcbiAgYS5zdGFyKys7XG4gIHMuc3RhdHMubWVyZ2VzKys7XG4gIGxvZyhzLCBgbWVyZ2UgJHthLnNvdWx9ICR7YS5zdGFyIC0gMX0qKyR7YS5zdGFyIC0gMX0qIC0+ICR7YS5zdGFyfSogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0sIGNlbGxzICR7cy51bml0cy5sZW5ndGh9LyR7R1JJRF9DRUxMU30pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogJ2hhbmRJbnRvT25lU3RhcicgcnVsZTogcGxheSBhIDEtc3RhciBjYXJkIG9udG8gYSBkZXBsb3llZCAxLXN0YXIgdW5pdCBvZiB0aGUgc2FtZSBTb3VsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhbk1lcmdlRnJvbUhhbmQoczogU3RhdGUsIGhhbmRJZHg6IG51bWJlciwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHMucnVsZXMubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmRbaGFuZElkeF0sIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIGlmICghc291bCB8fCAhdSB8fCB1LnNvdWwgIT09IHNvdWwgfHwgdS5zdGFyICE9PSAxKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBjb3N0KHNvdWwsIDIpIC0gY29zdChzb3VsLCAxKSA8PSBkb21pbmlvbkZyZWUocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZyb21IYW5kKHM6IFN0YXRlLCBoYW5kSWR4OiBudW1iZXIsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghY2FuTWVyZ2VGcm9tSGFuZChzLCBoYW5kSWR4LCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNvdWwgPSBzLmhhbmQuc3BsaWNlKGhhbmRJZHgsIDEpWzBdO1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpITtcbiAgdS5zdGFyID0gMjtcbiAgcy5zdGF0cy5tZXJnZXMrKztcbiAgbG9nKHMsIGBtZXJnZS1mcm9tLWhhbmQgJHtzb3VsfSAtPiAke3Uuc291bH0gMiogIChkb21pbmlvbiAke2RvbWluaW9uVXNlZChzKX0vJHtzLmNhcH0pYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGlzbWlzcyhzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gdW5pdElkKTtcbiAgaWYgKCF1KSByZXR1cm4gZmFsc2U7XG4gIHMudW5pdHMgPSBzLnVuaXRzLmZpbHRlcigoeCkgPT4geC5pZCAhPT0gdW5pdElkKTtcbiAgcy5zdGF0cy5kaXNtaXNzZWQgKz0gY2FyZHNJbih1LnN0YXIpO1xuICBsb2cocywgYGRpc21pc3MgJHt1LnNvdWx9ICR7dS5zdGFyfSogKHBlcm1hbmVudGx5IHJlbW92ZWQpYCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogU3dhcCAob25jZSBwZXIgYnVpbGQgcGhhc2UpLCBvcHRpb24gMTogZGlzY2FyZCBhIGhhbmQgY2FyZCBhbmQgZHJhdyBhIHJhbmRvbSBjYXJkIG9mIGEgRElGRkVSRU5UIFNvdWwuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzY2FyZFJlZHJhdyhzOiBTdGF0ZSwgaGFuZElkeDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmIChzLmRpc2NhcmRVc2VkIHx8IGhhbmRJZHggPCAwIHx8IGhhbmRJZHggPj0gcy5oYW5kLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjID0gcy5oYW5kLnNwbGljZShoYW5kSWR4LCAxKVswXTtcbiAgcy5kaXNjYXJkVXNlZCA9IHRydWU7IHMuc3RhdHMuZGlzY2FyZGVkKys7XG4gIGxvZyhzLCBgc3dhcDogZGlzY2FyZCAke2N9YCk7XG4gIGRyYXcocywgJ3N3YXAnLCBjKTtcbiAgcmV0dXJuIHRydWU7XG59XG5leHBvcnQgY29uc3Qgc3dhcERpc2NhcmQgPSBkaXNjYXJkUmVkcmF3O1xuXG5leHBvcnQgZnVuY3Rpb24gY2FuU3dhcFNlbGwoczogU3RhdGUsIHVuaXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCk7XG4gIHJldHVybiAhcy5kaXNjYXJkVXNlZCAmJiAhIXUgJiYgIXUuZnJlc2g7ICAgICAgICAgIC8vIGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kXG59XG5cbi8qKiBTd2FwIChvbmNlIHBlciBidWlsZCBwaGFzZSksIG9wdGlvbiAyOiBzZWxsIGEgZGVwbG95ZWQgdW5pdCAobm90IG9uZSBzdW1tb25lZCB0aGlzIHJvdW5kKSBhbmQgZHJhdyBhIGNhcmQgb2YgYSBESUZGRVJFTlQgU291bC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzd2FwU2VsbChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFjYW5Td2FwU2VsbChzLCB1bml0SWQpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHVuaXRJZCkhO1xuICBzLnVuaXRzID0gcy51bml0cy5maWx0ZXIoKHgpID0+IHguaWQgIT09IHVuaXRJZCk7XG4gIHMuZGlzY2FyZFVzZWQgPSB0cnVlOyBzLnN0YXRzLmRpc21pc3NlZCArPSBjYXJkc0luKHUuc3Rhcik7XG4gIGxvZyhzLCBgc3dhcDogc2VsbCAke3Uuc291bH0gJHt1LnN0YXJ9KmApO1xuICBkcmF3KHMsICdzd2FwJywgdS5zb3VsKTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtb3ZlVW5pdChzOiBTdGF0ZSwgdW5pdElkOiBudW1iZXIsIGNlbGw6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB1ID0gcy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1bml0SWQpO1xuICBpZiAoIXUgfHwgIWNlbGxGcmVlKHMsIGNlbGwpKSByZXR1cm4gZmFsc2U7XG4gIGxvZyhzLCBgbW92ZSAke3Uuc291bH0gY2VsbCAke3UuY2VsbH0gLT4gJHtjZWxsfWApOyB1LmNlbGwgPSBjZWxsOyByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gLS0tLSB3YXZlIHJlc3VsdHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRHJhZnQgY2hvaWNlcyBmb3IgYWZ0ZXIgYSBjbGVhcmVkIHdhdmU6IDMgcmFuZG9tIGNhcmRzLCBkdXBsaWNhdGVzIGFsbG93ZWQuICovXG5leHBvcnQgZnVuY3Rpb24gZHJhZnRPcHRpb25zKHM6IFN0YXRlKTogU291bElkW10ge1xuICBjb25zdCBwID0gcG9vbE9mKHMpO1xuICByZXR1cm4gW3Mucm5nLnBpY2socCksIHMucm5nLnBpY2socCksIHMucm5nLnBpY2socCldO1xufVxuXG4vKiogV2F2ZSBjbGVhcmVkOiByYWlzZSB0aGUgY2FwLCByZXNvbHZlIHRoZSBWaWN0b3J5IERyYWZ0LCBkcmF3IDEgbm9ybWFsIGNhcmQuICovXG5leHBvcnQgY29uc3Qgc3RhZ2VXYXZlcyA9IChzOiBTdGF0ZSk6IG51bWJlciA9PiBzLnJ1bGVzLnN0YWdlV2F2ZXMgPz8gV0FWRVM7XG5cbi8qKiBTdGVwIDEgb2YgYSBjbGVhcmVkIHdhdmU6IGlzIHRoZSBzdGFnZSBvdmVyPyBJZiBub3QsIHJhaXNlIHRoZSBjYXAgYW5kIHN0YXJ0IHRoZSBuZXh0IGJ1aWxkIHBoYXNlLiBSZXR1cm5zIHRydWUgd2hlbiB0aGUgc3RhZ2UgaXMgd29uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmFuY2VXYXZlKHM6IFN0YXRlKTogYm9vbGVhbiB7XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuIHMuc3RhdHVzID09PSAnd29uJztcbiAgaWYgKHMud2F2ZSA+PSBzdGFnZVdhdmVzKHMpKSB7IHMuc3RhdHVzID0gJ3dvbic7IGxvZyhzLCAnc3RhZ2UgY2xlYXJlZCcpOyByZXR1cm4gdHJ1ZTsgfVxuICBzLndhdmUrKztcbiAgcy5jYXAgPSBzLnJ1bGVzLmN1cnZlW3Mud2F2ZSAtIDFdO1xuICBuZXdQaGFzZShzKTtcbiAgbG9nKHMsIGB3YXZlIGNsZWFyZWQgLT4gY2FwICR7cy5jYXB9YCk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFN0ZXAgMjogdGhlIHBsYXllciBrZXB0IGBpZHhgIGZyb20gdGhlIG9mZmVyZWQgZHJhZnQgY2FyZHMuICovXG5leHBvcnQgZnVuY3Rpb24gdGFrZURyYWZ0KHM6IFN0YXRlLCBvcHRzOiBTb3VsSWRbXSwgaWR4OiBudW1iZXIpOiB2b2lkIHtcbiAgY29uc3QgcGljayA9IG9wdHNbTWF0aC5tYXgoMCwgTWF0aC5taW4ob3B0cy5sZW5ndGggLSAxLCBpZHgpKV07XG4gIHMuaGFuZC5wdXNoKHBpY2spOyBzLnN0YXRzLmRyYXduKys7XG4gIGxvZyhzLCBgZHJhZnQgWyR7b3B0cy5qb2luKCcsICcpfV0gLT4gdG9vayAke3BpY2t9YCk7XG59XG5cbi8qKiBTdGVwIDM6IHRoZSBib251cyBub3JtYWwgZHJhdyAob25seSBvbiB0aGUgd2F2ZXMgdGhlIHJ1bGVzIGFsbG93KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxEcmF3KHM6IFN0YXRlKTogdm9pZCB7XG4gIGlmIChzLnJ1bGVzLm5vcm1hbERyYXdXYXZlcyA/IHMucnVsZXMubm9ybWFsRHJhd1dhdmVzLmluY2x1ZGVzKHMud2F2ZSkgOiB0cnVlKSBkcmF3KHMsICd3YXZlIGNsZWFyJyk7XG59XG5cbi8qKiBXYXZlIGNsZWFyZWQgKGFsbCB0aHJlZSBzdGVwcyBpbiBvbmUgY2FsbCwgZm9yIHNpbXVsYXRpb25zKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhcldhdmUoczogU3RhdGUsIGNob29zZTogKG9wdHM6IFNvdWxJZFtdKSA9PiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKGFkdmFuY2VXYXZlKHMpKSByZXR1cm47XG4gIGlmIChzLnN0YXR1cyAhPT0gJ2J1aWxkaW5nJykgcmV0dXJuO1xuICBsZXQgb3B0cyA9IGRyYWZ0T3B0aW9ucyhzKTtcbiAgY29uc3Qgb2ZmZXJlZCA9IG9wdHMuam9pbignLCAnKTtcbiAgY29uc3QgdG9vazogU291bElkW10gPSBbXTtcbiAgZm9yIChsZXQgcCA9IDA7IHAgPCAocy5ydWxlcy5kcmFmdFBpY2tzID8/IDEpOyBwKyspIHtcbiAgICBjb25zdCBpZHggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihvcHRzLmxlbmd0aCAtIDEsIGNob29zZShvcHRzKSkpO1xuICAgIHRvb2sucHVzaChvcHRzW2lkeF0pOyBzLmhhbmQucHVzaChvcHRzW2lkeF0pOyBzLnN0YXRzLmRyYXduKys7XG4gICAgb3B0cyA9IG9wdHMuZmlsdGVyKChfLCBpKSA9PiBpICE9PSBpZHgpO1xuICB9XG4gIGxvZyhzLCBgZHJhZnQgWyR7b2ZmZXJlZH1dIC0+IHRvb2sgJHt0b29rLmpvaW4oJywgJyl9YCk7XG4gIG5vcm1hbERyYXcocyk7XG59XG5cbi8qKiBBcm15IHdpcGVkOiBsb3NlIGEgaGVhcnQsIGNhcCBkb2VzIE5PVCByaXNlLCBlbmVtaWVzIHJlc2V0LCArMSBjYXJkLCByZWRyYXcgYWxsb3dlZCBhZ2Fpbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmYWlsV2F2ZShzOiBTdGF0ZSk6IHZvaWQge1xuICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHJldHVybjtcbiAgcy5oZWFydHMtLTsgcy5zdGF0cy5mYWlsdXJlcysrO1xuICBpZiAocy5oZWFydHMgPD0gMCkgeyBzLnN0YXR1cyA9ICdsb3N0JzsgbG9nKHMsICdubyBoZWFydHMgbGVmdDogc3RhZ2UgbG9zdCcpOyByZXR1cm47IH1cbiAgbmV3UGhhc2Uocyk7XG4gIGxvZyhzLCBgYXJteSB3aXBlZDogaGVhcnRzICR7cy5oZWFydHN9LCBjYXAgc3RheXMgJHtzLmNhcH1gKTtcbiAgZHJhdyhzLCAnZmFpbGVkIGF0dGVtcHQnKTtcbn1cblxuLy8gLS0tLSBpbnZhcmlhbnRzIChjYWxsZWQgYnkgdGhlIHNpbXVsYXRvciBhZnRlciBldmVyeSB3YXZlOyB0aHJvdyB3aXRoIGEgcmVhZGFibGUgbWVzc2FnZSkgLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gY2hlY2tJbnZhcmlhbnRzKHM6IFN0YXRlKTogdm9pZCB7XG4gIGNvbnN0IGZhaWwgPSAobTogc3RyaW5nKSA9PiB7IHRocm93IG5ldyBFcnJvcihgSU5WQVJJQU5UICR7bX1cXG5gICsgcy5sb2cuc2xpY2UoLTEyKS5qb2luKCdcXG4nKSk7IH07XG4gIGlmIChzLnVuaXRzLmxlbmd0aCA+IEdSSURfQ0VMTFMpIGZhaWwoYG1vcmUgdW5pdHMgKCR7cy51bml0cy5sZW5ndGh9KSB0aGFuIGNlbGxzYCk7XG4gIGNvbnN0IGNlbGxzID0gbmV3IFNldChzLnVuaXRzLm1hcCgodSkgPT4gdS5jZWxsKSk7XG4gIGlmIChjZWxscy5zaXplICE9PSBzLnVuaXRzLmxlbmd0aCkgZmFpbCgndHdvIHVuaXRzIHNoYXJlIGEgY2VsbCcpO1xuICBpZiAoZG9taW5pb25Vc2VkKHMpID4gcy5jYXApIGZhaWwoYGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfSBleGNlZWRzIGNhcCAke3MuY2FwfWApO1xuICBmb3IgKGNvbnN0IHUgb2Ygcy51bml0cykgaWYgKHUuc3RhciA8IDEgfHwgdS5zdGFyID4gTUFYX1NUQVIpIGZhaWwoYHVuaXQgc3RhciAke3Uuc3Rhcn0gb3V0IG9mIHJhbmdlYCk7XG4gIC8vIGV2ZXJ5IGRyYXduIGNhcmQgaXMgZWl0aGVyIGluIGhhbmQsIHdvcnRoIGNhcmRzIG9uIHRoZSBmaWVsZCwgZGlzY2FyZGVkLCBvciBkaXNtaXNzZWRcbiAgY29uc3Qgb25GaWVsZCA9IHMudW5pdHMucmVkdWNlKChuLCB1KSA9PiBuICsgY2FyZHNJbih1LnN0YXIpLCAwKTtcbiAgY29uc3QgYWNjb3VudGVkID0gcy5oYW5kLmxlbmd0aCArIG9uRmllbGQgKyBzLnN0YXRzLmRpc2NhcmRlZCArIHMuc3RhdHMuZGlzbWlzc2VkO1xuICBpZiAoYWNjb3VudGVkICE9PSBzLnN0YXRzLmRyYXduKSBmYWlsKGBjYXJkIGNvbnNlcnZhdGlvbjogZHJhd24gJHtzLnN0YXRzLmRyYXdufSAhPSBhY2NvdW50ZWQgJHthY2NvdW50ZWR9YCk7XG59XG4iLCAiLy8gVGhlIGJhdHRsZWZpZWxkJ3MgbG9vazogYSB0aWxlZCBjcnlwdCBmbG9vciwgYSBnbG93aW5nIHJ1bmUgY2lyY2xlIGluIHRoZSBtaWRkbGUsIGFuZCBhIGRhcmsgbWlzdHkgc3Vycm91bmQuIFB1cmUgZGVjb3JhdGlvbiAobm8gZ2FtZSBydWxlcykuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuY29uc3QgVElMRV9NRVRSRVMgPSA1OyAgICAvLyBvbmUgcmVwZWF0IG9mIHRoZSBmbG9vciBwaWN0dXJlIGNvdmVycyB0aGlzIG1hbnkgbWV0cmVzLCBzbyBzbGFicyBjb21lIG91dCBhYm91dCBhIG1ldHJlIHdpZGVcblxuLyoqIERyYXcgdGhlIHJ1bmUgY2lyY2xlIG9uY2Ugb250byBhIGNhbnZhczsgaXQgYmVjb21lcyBhIHNlZS10aHJvdWdoIGRlY2FsIG9uIHRoZSBmbG9vci4gKi9cbmZ1bmN0aW9uIHJ1bmVUZXh0dXJlKHNjZW5lOiBhbnkpOiBhbnkge1xuICBjb25zdCBTID0gNTEyLCB0ZXggPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgncnVuZXMnLCB7IHdpZHRoOiBTLCBoZWlnaHQ6IFMgfSwgc2NlbmUsIHRydWUpLCBjID0gdGV4LmdldENvbnRleHQoKTtcbiAgYy5jbGVhclJlY3QoMCwgMCwgUywgUyk7IGMudHJhbnNsYXRlKFMgLyAyLCBTIC8gMik7IGMubGluZUNhcCA9ICdyb3VuZCc7IGMubGluZUpvaW4gPSAncm91bmQnO1xuICBjb25zdCByaW5nID0gKHI6IG51bWJlciwgdzogbnVtYmVyLCBhOiBudW1iZXIpID0+IHsgYy5iZWdpblBhdGgoKTsgYy5hcmMoMCwgMCwgciwgMCwgTWF0aC5QSSAqIDIpOyBjLmxpbmVXaWR0aCA9IHc7IGMuc3Ryb2tlU3R5bGUgPSBgcmdiYSg0NywyMTcsMTY2LCR7YX0pYDsgYy5zdHJva2UoKTsgfTtcbiAgYy5zaGFkb3dDb2xvciA9ICdyZ2JhKDQ3LDIxNywxNjYsMC45KSc7IGMuc2hhZG93Qmx1ciA9IDEwO1xuICByaW5nKDIzNiwgNCwgMC43NSk7IHJpbmcoMjE0LCAyLCAwLjUpOyByaW5nKDEyMCwgMywgMC43KTtcbiAgYy5zdHJva2VTdHlsZSA9ICdyZ2JhKDQ3LDIxNywxNjYsMC43KSc7IGMubGluZVdpZHRoID0gMztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0OyBpKyspIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGZvdXIgbG9uZyBzcGlrZXMsIGxpa2UgYSBjb21wYXNzXG4gICAgYy5zYXZlKCk7IGMucm90YXRlKChpICogTWF0aC5QSSkgLyAyICsgTWF0aC5QSSAvIDQpOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygwLCAtMzApOyBjLmxpbmVUbygwLCAtMjMwKTsgYy5zdHJva2UoKTtcbiAgICBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbygtMTQsIC0xMjApOyBjLmxpbmVUbygwLCAtMTYwKTsgYy5saW5lVG8oMTQsIC0xMjApOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTtcbiAgfVxuICBjLmxpbmVXaWR0aCA9IDI7IGMuc3Ryb2tlU3R5bGUgPSAncmdiYSg0NywyMTcsMTY2LDAuNTUpJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMjsgaSsrKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNtYWxsIHRpY2sgbWFya3MgYmV0d2VlbiB0aGUgdHdvIG91dGVyIHJpbmdzXG4gICAgYy5zYXZlKCk7IGMucm90YXRlKChpICogTWF0aC5QSSkgLyA2KTsgYy5iZWdpblBhdGgoKTsgYy5tb3ZlVG8oMCwgLTIxNCk7IGMubGluZVRvKDAsIC0yMzYpOyBjLnN0cm9rZSgpOyBjLnJlc3RvcmUoKTtcbiAgfVxuICB0ZXgudXBkYXRlKCk7IHRleC5oYXNBbHBoYSA9IHRydWU7IHJldHVybiB0ZXg7XG59XG5cbmludGVyZmFjZSBQbGFjZW1lbnQgeyBwcm9wOiBzdHJpbmc7IHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc/OiBudW1iZXI7IHM/OiBudW1iZXIgfVxuLyoqIFdoZXJlIHRoZSBwcm9wcyBzdGFuZC4gVGFsbCB0aGluZ3MgZ28gYmVoaW5kIGFuZCBiZXNpZGUgdGhlIGZpZWxkOyBvbmx5IGxvdyB0aGluZ3MgKGZlbmNlLCBib25lcywgd2FsbCkgc3RhbmQgYmV0d2VlbiB0aGUgY2FtZXJhIGFuZCB0aGUgdW5pdHMuICovXG5jb25zdCBDUllQVF9MQVlPVVQ6IFBsYWNlbWVudFtdID0gW1xuICB7IHByb3A6ICdhcmNoJywgeDogLTYuNSwgejogNi40IH0sIHsgcHJvcDogJ2FyY2gnLCB4OiAwLCB6OiA2LjksIHM6IDEuMTUgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDYuNSwgejogNi40IH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0xMC4yLCB6OiA1LjYsIHlhdzogMC40IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC0zLjIsIHo6IDUuOSwgeWF3OiAyLjEgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMy4zLCB6OiA1LjgsIHlhdzogNC4wIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDEwLjIsIHo6IDUuNiwgeWF3OiAxLjIgfSxcbiAgeyBwcm9wOiAnYnJhemllcicsIHg6IC00LjYsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogNC42LCB6OiA1LjIgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IC0xMC41LCB6OiAwLjggfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDEwLjUsIHo6IDAuOCB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTguNiwgejogNi4wLCB5YXc6IDAuMSB9LCB7IHByb3A6ICd3YWxsJywgeDogOC42LCB6OiA2LjAsIHlhdzogLTAuMSB9LCB7IHByb3A6ICd3YWxsJywgeDogLTExLjQsIHo6IC0yLjYsIHlhdzogMS40IH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAxMS40LCB6OiAtMi42LCB5YXc6IDEuNyB9LFxuICB7IHByb3A6ICdmZW5jZScsIHg6IC04LjAsIHo6IC00LjYgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNi43LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogNi43LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogOC4wLCB6OiAtNC42IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogLTMuNSwgejogLTQuNCwgeWF3OiAwLjcsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDQuMiwgejogLTQuNiwgeWF3OiAyLjUsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IDkuNCwgejogMy4yLCB5YXc6IDEuMCwgczogMC42IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuNiwgejogLTMuNCwgeWF3OiAzLjYsIHM6IDAuNiB9LFxuXTtcbmNvbnN0IEdSQVZFWUFSRF9MQVlPVVQ6IFBsYWNlbWVudFtdID0gWyAgICAgIC8vIGZld2VyIGFyY2hlcywgYSBicm9rZW4gcm93IG9mIGdyYXZlc3RvbmUgcGlsbGFycywgYm9uZXMgZXZlcnl3aGVyZVxuICB7IHByb3A6ICdhcmNoJywgeDogLTkuNSwgejogNi40IH0sIHsgcHJvcDogJ2FyY2gnLCB4OiA5LjUsIHo6IDYuNCB9LFxuICB7IHByb3A6ICdwaWxsYXInLCB4OiAtMTEsIHo6IDUuMiwgeWF3OiAwLjQsIHM6IDAuOSB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAtNy42LCB6OiA2LjMsIHlhdzogMi4xIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IC00LjQsIHo6IDUuNiwgeWF3OiA0LjAsIHM6IDAuOCB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiAtMS4yLCB6OiA2LjUsIHlhdzogMS4yIH0sXG4gIHsgcHJvcDogJ3BpbGxhcicsIHg6IDIuMiwgejogNS43LCB5YXc6IDMuMSwgczogMC45IH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDUuNSwgejogNi40LCB5YXc6IDUuMCB9LCB7IHByb3A6ICdwaWxsYXInLCB4OiA4LjIsIHo6IDUuNSwgeWF3OiAwLjksIHM6IDAuODUgfSwgeyBwcm9wOiAncGlsbGFyJywgeDogMTEsIHo6IDUuMCwgeWF3OiAyLjYgfSxcbiAgeyBwcm9wOiAnYnJhemllcicsIHg6IC0xMSwgejogMC44IH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAxMSwgejogMC44IH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAwLjYsIHo6IDUuMCwgczogMC45IH0sXG4gIHsgcHJvcDogJ3dhbGwnLCB4OiAtNS42LCB6OiA2LjYsIHlhdzogMC4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAzLjgsIHo6IDYuNywgeWF3OiAtMC4yIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMTEuNiwgejogLTIuNCwgeWF3OiAxLjUgfSxcbiAgeyBwcm9wOiAnZmVuY2UnLCB4OiAtNC4yLCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogNC40LCB6OiAtNC43IH0sIHsgcHJvcDogJ2ZlbmNlJywgeDogMTEuMiwgejogLTIuMiwgeWF3OiAxLjYgfSxcbiAgeyBwcm9wOiAnYm9uZXMnLCB4OiAtNS41LCB6OiA0LjYsIHlhdzogMC43LCBzOiAwLjYgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAzLjIsIHo6IDQuNCwgeWF3OiAyLjUsIHM6IDAuNyB9LCB7IHByb3A6ICdib25lcycsIHg6IDguMiwgejogMy4yLCB5YXc6IDEuMCwgczogMC42IH0sIHsgcHJvcDogJ2JvbmVzJywgeDogLTkuMiwgejogMy40LCB5YXc6IDMuNiwgczogMC42IH0sXG4gIHsgcHJvcDogJ2JvbmVzJywgeDogNywgejogLTQuNSwgeWF3OiAwLjMsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IC03LjQsIHo6IC00LjMsIHlhdzogNC4xLCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAwLjIsIHo6IC00LjgsIHlhdzogNS4yLCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiAxMC4yLCB6OiAtMC42LCB5YXc6IDIuMCwgczogMC42IH0sXG5dO1xuY29uc3QgQkFTVElPTl9MQVlPVVQ6IFBsYWNlbWVudFtdID0gWyAgICAgICAgLy8gYSBmb3J0cmVzczogZ2F0ZXMgYmV0d2VlbiBsb25nIHdhbGxzLCBicmF6aWVycyBhbG9uZyB0aGUgYmF0dGxlbWVudHMsIGZlbmNlcyBvbiB0aGUgZmxhbmtzXG4gIHsgcHJvcDogJ2FyY2gnLCB4OiAtNS44LCB6OiA2LjUsIHM6IDEuMSB9LCB7IHByb3A6ICdhcmNoJywgeDogMCwgejogNy4wLCBzOiAxLjMgfSwgeyBwcm9wOiAnYXJjaCcsIHg6IDUuOCwgejogNi41LCBzOiAxLjEgfSxcbiAgeyBwcm9wOiAnd2FsbCcsIHg6IC05LjQsIHo6IDYuMCwgczogMS4zIH0sIHsgcHJvcDogJ3dhbGwnLCB4OiAtMi45LCB6OiA2LjQsIHM6IDEuMiB9LCB7IHByb3A6ICd3YWxsJywgeDogMi45LCB6OiA2LjQsIHM6IDEuMiB9LCB7IHByb3A6ICd3YWxsJywgeDogOS40LCB6OiA2LjAsIHM6IDEuMyB9LFxuICB7IHByb3A6ICd3YWxsJywgeDogLTEyLjIsIHo6IDIuNiwgeWF3OiAxLjU3LCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDEyLjIsIHo6IDIuNiwgeWF3OiAxLjU3LCBzOiAxLjMgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IC0xMi4yLCB6OiAtMS42LCB5YXc6IDEuNTcgfSwgeyBwcm9wOiAnd2FsbCcsIHg6IDEyLjIsIHo6IC0xLjYsIHlhdzogMS41NyB9LFxuICB7IHByb3A6ICdwaWxsYXInLCB4OiAtMTEuMiwgejogNS42LCB5YXc6IDAuNCwgczogMS4xIH0sIHsgcHJvcDogJ3BpbGxhcicsIHg6IDExLjIsIHo6IDUuNiwgeWF3OiAxLjIsIHM6IDEuMSB9LFxuICB7IHByb3A6ICdicmF6aWVyJywgeDogLTMuMiwgejogNS4yIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAzLjIsIHo6IDUuMiB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogLTEwLjYsIHo6IDEuMCB9LCB7IHByb3A6ICdicmF6aWVyJywgeDogMTAuNiwgejogMS4wIH0sIHsgcHJvcDogJ2JyYXppZXInLCB4OiAtNy4yLCB6OiAtNC42LCBzOiAwLjkgfSwgeyBwcm9wOiAnYnJhemllcicsIHg6IDcuMiwgejogLTQuNiwgczogMC45IH0sXG4gIHsgcHJvcDogJ2ZlbmNlJywgeDogLTQuNiwgejogLTQuOCB9LCB7IHByb3A6ICdmZW5jZScsIHg6IC0zLjMsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAzLjMsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiA0LjYsIHo6IC00LjggfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAtMTEuNiwgejogLTMuNCwgeWF3OiAxLjUgfSwgeyBwcm9wOiAnZmVuY2UnLCB4OiAxMS42LCB6OiAtMy40LCB5YXc6IDEuNSB9LFxuICB7IHByb3A6ICdib25lcycsIHg6IC0xLjUsIHo6IC00LjUsIHlhdzogMC43LCBzOiAwLjUgfSwgeyBwcm9wOiAnYm9uZXMnLCB4OiA5LjQsIHo6IDMuMiwgeWF3OiAxLjAsIHM6IDAuNSB9LCB7IHByb3A6ICdib25lcycsIHg6IC05LjYsIHo6IC0zLjAsIHlhdzogMy42LCBzOiAwLjUgfSxcbl07XG5cbnR5cGUgQzMgPSBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5pbnRlcmZhY2UgVGhlbWUgeyBsYXlvdXQ6IFBsYWNlbWVudFtdOyBmbG9vcjogQzM7IGZvZzogQzM7IG1pc3Q6IEMzOyB3YWxsOiBDMzsgZmxhbWVBOiBDMzsgZmxhbWVCOiBDMzsgcnVuZTogQzMgfVxuLyoqIE9uZSBsb29rIHBlciBjYW1wYWlnbiBzdGFnZSAoaWRzIG1hdGNoIFNUQUdFUyBpbiBjb3JlL3dhdmVzLnRzKS4gVW5rbm93biBpZHMgdXNlIHRoZSBjcnlwdCBsb29rLiAqL1xuY29uc3QgVEhFTUVTOiBSZWNvcmQ8c3RyaW5nLCBUaGVtZT4gPSB7XG4gIGNyeXB0OiB7IGxheW91dDogQ1JZUFRfTEFZT1VULCBmbG9vcjogWzAuNjIsIDAuNywgMC43XSwgZm9nOiBbMC4wMiwgMC4wNSwgMC4wNl0sIG1pc3Q6IFswLjIsIDAuNiwgMC41NV0sIHdhbGw6IFswLjc1LCAwLjg1LCAwLjldLCBmbGFtZUE6IFswLjM1LCAxLCAwLjhdLCBmbGFtZUI6IFswLjEsIDAuOCwgMC42XSwgcnVuZTogWzAuMTgsIDAuODUsIDAuNjVdIH0sXG4gIGdyYXZleWFyZDogeyBsYXlvdXQ6IEdSQVZFWUFSRF9MQVlPVVQsIGZsb29yOiBbMC42MiwgMC43NCwgMC41Ml0sIGZvZzogWzAuMDMsIDAuMDUsIDAuMDI1XSwgbWlzdDogWzAuNDIsIDAuNiwgMC4yMl0sIHdhbGw6IFswLjcsIDAuODUsIDAuNjJdLCBmbGFtZUE6IFswLjc1LCAxLCAwLjRdLCBmbGFtZUI6IFswLjQsIDAuOCwgMC4yXSwgcnVuZTogWzAuNSwgMC44LCAwLjI1XSB9LFxuICBlbmRsZXNzOiB7IGxheW91dDogQ1JZUFRfTEFZT1VULCBmbG9vcjogWzAuNzgsIDAuNjIsIDAuNjhdLCBmb2c6IFswLjA2LCAwLjAyLCAwLjAzNV0sIG1pc3Q6IFswLjc1LCAwLjMsIDAuNF0sIHdhbGw6IFswLjkyLCAwLjY4LCAwLjc4XSwgZmxhbWVBOiBbMSwgMC42MiwgMC4zXSwgZmxhbWVCOiBbMC45LCAwLjI1LCAwLjE1XSwgcnVuZTogWzAuOSwgMC4zNSwgMC4zXSB9LFxuICBiYXN0aW9uOiB7IGxheW91dDogQkFTVElPTl9MQVlPVVQsIGZsb29yOiBbMC42LCAwLjYyLCAwLjldLCBmb2c6IFswLjAzLCAwLjAzLCAwLjA4XSwgbWlzdDogWzAuNCwgMC40LCAwLjg1XSwgd2FsbDogWzAuNzIsIDAuNzIsIDFdLCBmbGFtZUE6IFswLjYsIDAuNjUsIDFdLCBmbGFtZUI6IFswLjQsIDAuMywgMC45NV0sIHJ1bmU6IFswLjQ1LCAwLjQsIDAuOTVdIH0sXG59O1xuXG5cbi8qKiBCdWlsZCB0aGUgdGVhbCBzb3VsZmlyZSBvdmVyIGEgYnJhemllcjogYSBzbWFsbCBzb2Z0IGZsYW1lIHRoYXQgZmxpY2tlcnMuICovXG5mdW5jdGlvbiBmbGFtZShzY2VuZTogYW55LCB0ZXg6IGFueSwgeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlciwgazogbnVtYmVyLCBhOiBDMywgYjogQzMpOiBhbnkge1xuICBjb25zdCBwcyA9IG5ldyBCQUJZTE9OLlBhcnRpY2xlU3lzdGVtKCdmaXJlJywgMTgsIHNjZW5lKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGV4OyBwcy5lbWl0dGVyID0gbmV3IEJBQllMT04uVmVjdG9yMyh4LCB5LCB6KTtcbiAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMjIgKiBrLCAwLCAtMC4yMiAqIGspOyBwcy5tYXhFbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjIyICogaywgMCwgMC4yMiAqIGspO1xuICBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4xLCAxLCAtMC4xKTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xLCAxLjQsIDAuMSk7XG4gIHBzLm1pbkxpZmVUaW1lID0gMC41OyBwcy5tYXhMaWZlVGltZSA9IDEuMDsgcHMuZW1pdFJhdGUgPSAyMDsgcHMubWluU2l6ZSA9IDAuMzUgKiBrOyBwcy5tYXhTaXplID0gMC43ICogazsgcHMubWluRW1pdFBvd2VyID0gMC41ICogazsgcHMubWF4RW1pdFBvd2VyID0gMS4wICogaztcbiAgcHMuY29sb3IxID0gbmV3IEJBQllMT04uQ29sb3I0KGFbMF0sIGFbMV0sIGFbMl0sIDAuOSk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNChiWzBdLCBiWzFdLCBiWzJdLCAwLjgpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoYlswXSAqIDAuMSwgYlsxXSAqIDAuMywgYlsyXSAqIDAuMywgMCk7XG4gIHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMuZ3Jhdml0eSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC40LCAwKTsgcHMuc3RhcnQoKTsgcmV0dXJuIHBzO1xufVxuXG4vKiogU29mdCByb3VuZCBibG9iIHVzZWQgZm9yIHRoZSBmbGFtZXMuICovXG5mdW5jdGlvbiBnbG93VGV4dHVyZShzY2VuZTogYW55KTogYW55IHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdnbG93JywgeyB3aWR0aDogNjQsIGhlaWdodDogNjQgfSwgc2NlbmUsIHRydWUpLCBjID0gdC5nZXRDb250ZXh0KCksIGcgPSBjLmNyZWF0ZVJhZGlhbEdyYWRpZW50KDMyLCAzMiwgMCwgMzIsIDMyLCAzMik7XG4gIGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDEpJyk7IGcuYWRkQ29sb3JTdG9wKDAuNCwgJ3JnYmEoMjU1LDI1NSwyNTUsMC40NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcbiAgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IHQudXBkYXRlKCk7IHQuaGFzQWxwaGEgPSB0cnVlOyByZXR1cm4gdDtcbn1cblxuLyoqIExvYWQgdGhlIHByb3Aga2l0IG9uY2U7IGFwcGx5KHRoZW1lKSB0aGVuIHN0YW5kcyBjb3BpZXMgb2YgZWFjaCBwaWVjZSBhcm91bmQgdGhlIGZpZWxkICh0aGV5IHNoYXJlIG9uZSBtZXNoIGFuZCBvbmUgdGV4dHVyZSwgc28gdGhleSBjb3N0IGFsbW9zdCBub3RoaW5nKS4gKi9cbmFzeW5jIGZ1bmN0aW9uIGxvYWRLaXQoc2NlbmU6IGFueSk6IFByb21pc2U8eyBhcHBseSh0OiBUaGVtZSk6IHZvaWQgfT4ge1xuICBjb25zdCBib3ggPSBhd2FpdCBCQUJZTE9OLlNjZW5lTG9hZGVyLkxvYWRBc3NldENvbnRhaW5lckFzeW5jKCdhc3NldHMvYXJlbmEvJywgJ3Byb3BzLmdsYicsIHNjZW5lKTtcbiAgYm94LmFkZEFsbFRvU2NlbmUoKTtcbiAgY29uc3Qgcm9vdCA9IGJveC5tZXNoZXMuZmluZCgobTogYW55KSA9PiBtLm5hbWUgPT09ICdfX3Jvb3RfXycpLCBzcmM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgZm9yIChjb25zdCBtIG9mIGJveC5tZXNoZXMpIGlmIChtLm5hbWUgIT09ICdfX3Jvb3RfXycgJiYgbS5nZXRUb3RhbFZlcnRpY2VzKCkgPiAwKSB7IHNyY1ttLm5hbWVdID0gbTsgbS5zZXRFbmFibGVkKGZhbHNlKTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH1cbiAgY29uc3QgZ2xvdyA9IGdsb3dUZXh0dXJlKHNjZW5lKTsgbGV0IG1hZGU6IHsgaG9sZGVyczogYW55W107IGZpcmVzOiBhbnlbXSB9ID0geyBob2xkZXJzOiBbXSwgZmlyZXM6IFtdIH0sIG4gPSAwO1xuICByZXR1cm4ge1xuICAgIGFwcGx5KHQ6IFRoZW1lKSB7XG4gICAgICBmb3IgKGNvbnN0IGggb2YgbWFkZS5ob2xkZXJzKSBoLmRpc3Bvc2UoKTsgZm9yIChjb25zdCBmIG9mIG1hZGUuZmlyZXMpIGYuZGlzcG9zZShmYWxzZSk7ICAgLy8gZmFsc2U6IGtlZXAgdGhlIHNoYXJlZCBnbG93IHRleHR1cmUgbWFkZSA9IHsgaG9sZGVyczogW10sIGZpcmVzOiBbXSB9O1xuICAgICAgZm9yIChjb25zdCBwIG9mIHQubGF5b3V0KSB7XG4gICAgICAgIGNvbnN0IGJhc2UgPSBzcmNbcC5wcm9wXTsgaWYgKCFiYXNlKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgaW5zdCA9IGJhc2UuY3JlYXRlSW5zdGFuY2UocC5wcm9wICsgbisrKTsgaW5zdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgICAgIGluc3Qucm90YXRpb25RdWF0ZXJuaW9uID0gcm9vdC5yb3RhdGlvblF1YXRlcm5pb24/LmNsb25lKCkgPz8gbnVsbDsgaWYgKCFpbnN0LnJvdGF0aW9uUXVhdGVybmlvbikgaW5zdC5yb3RhdGlvbiA9IHJvb3Qucm90YXRpb24uY2xvbmUoKTsgaW5zdC5zY2FsaW5nID0gcm9vdC5zY2FsaW5nLmNsb25lKCk7XG4gICAgICAgIGNvbnN0IGhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2hvbGRlcicgKyBuLCBzY2VuZSk7IGhvbGRlci5wb3NpdGlvbi5zZXQocC54LCAwLCBwLnopOyBob2xkZXIucm90YXRpb24ueSA9IHAueWF3ID8/IDA7IGhvbGRlci5zY2FsaW5nLnNldEFsbChwLnMgPz8gMSk7XG4gICAgICAgIGluc3QucGFyZW50ID0gaG9sZGVyOyBtYWRlLmhvbGRlcnMucHVzaChob2xkZXIpO1xuICAgICAgICBpZiAocC5wcm9wID09PSAnYnJhemllcicpIG1hZGUuZmlyZXMucHVzaChmbGFtZShzY2VuZSwgZ2xvdywgcC54LCAxLjI1ICogKHAucyA/PyAxKSwgcC56LCBwLnMgPz8gMSwgdC5mbGFtZUEsIHQuZmxhbWVCKSk7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQXJlbmEoc2NlbmU6IGFueSwgZ3JvdW5kOiBhbnkpOiB7IHVwZGF0ZSh0OiBudW1iZXIpOiB2b2lkOyBzZXRUaGVtZShzdGFnZTogc3RyaW5nKTogdm9pZCB9IHtcbiAgLy8gLS0tLSBmbG9vclxuICBjb25zdCB0ZXggPSBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvYXJlbmEvZmxvb3Iud2VicCcsIHNjZW5lLCBmYWxzZSwgdHJ1ZSwgQkFCWUxPTi5UZXh0dXJlLlRSSUxJTkVBUl9TQU1QTElOR01PREUpO1xuICB0ZXgudVNjYWxlID0gNjAgLyBUSUxFX01FVFJFUzsgdGV4LnZTY2FsZSA9IDQwIC8gVElMRV9NRVRSRVM7IHRleC5hbmlzb3Ryb3BpY0ZpbHRlcmluZ0xldmVsID0gNDtcbiAgY29uc3QgZ20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdnbScsIHNjZW5lKTsgZ20uZGlmZnVzZVRleHR1cmUgPSB0ZXg7IGdtLnNwZWN1bGFyQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpO1xuICBnbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC42MiwgMC43LCAwLjcpOyBncm91bmQubWF0ZXJpYWwgPSBnbTtcblxuICAvLyAtLS0tIHJ1bmUgY2lyY2xlIGluIHRoZSBtaWRkbGUgb2YgdGhlIGZpZWxkXG4gIGNvbnN0IGRlY2FsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVHcm91bmQoJ3J1bmVzJywgeyB3aWR0aDogNS4yLCBoZWlnaHQ6IDUuMiB9LCBzY2VuZSk7XG4gIGRlY2FsLnBvc2l0aW9uLnkgPSAwLjAxMjsgZGVjYWwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICBjb25zdCBybSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ3JtJywgc2NlbmUpOyBybS5kaWZmdXNlVGV4dHVyZSA9IHJ1bmVUZXh0dXJlKHNjZW5lKTsgcm0uZGlmZnVzZVRleHR1cmUuaGFzQWxwaGEgPSB0cnVlOyBybS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7XG4gIHJtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xOCwgMC44NSwgMC42NSk7IHJtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IHJtLmFscGhhID0gMC41NTsgcm0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IGRlY2FsLm1hdGVyaWFsID0gcm07XG5cbiAgLy8gLS0tLSBkYXJrIHRlYWwgc3Vycm91bmQgdGhhdCBzd2FsbG93cyB0aGUgZmFyIGVkZ2Ugb2YgdGhlIGZsb29yXG4gIHNjZW5lLmNsZWFyQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4wMiwgMC4wNSwgMC4wNiwgMSk7XG4gIHNjZW5lLmZvZ01vZGUgPSBCQUJZTE9OLlNjZW5lLkZPR01PREVfTElORUFSOyBzY2VuZS5mb2dDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjAyLCAwLjA1LCAwLjA2KTsgc2NlbmUuZm9nU3RhcnQgPSAyNDsgc2NlbmUuZm9nRW5kID0gNTY7XG5cbiAgY29uc3QgY2F2ZSA9IGJ1aWxkQ2F2ZShzY2VuZSwgdGV4KTtcbiAgbGV0IGtpdDogeyBhcHBseSh0OiBUaGVtZSk6IHZvaWQgfSB8IG51bGwgPSBudWxsLCB3YW50ID0gJ2NyeXB0Jywgc2hvd24gPSAnJztcbiAgY29uc3Qgc2hvdyA9ICgpID0+IHtcbiAgICBjb25zdCB0ID0gVEhFTUVTW3dhbnRdID8/IFRIRU1FUy5jcnlwdDsgaWYgKHdhbnQgPT09IHNob3duICYmIGtpdCkgcmV0dXJuO1xuICAgIGNvbnN0IGNvbCA9IChjOiBDMykgPT4gbmV3IEJBQllMT04uQ29sb3IzKGNbMF0sIGNbMV0sIGNbMl0pO1xuICAgIGdtLmRpZmZ1c2VDb2xvciA9IGNvbCh0LmZsb29yKTsgY2F2ZS53YWxsTWF0LmRpZmZ1c2VDb2xvciA9IGNvbCh0LndhbGwpOyBybS5lbWlzc2l2ZUNvbG9yID0gY29sKHQucnVuZSk7XG4gICAgZm9yIChjb25zdCBtIG9mIGNhdmUubWlzdE1hdHMpIG0uZW1pc3NpdmVDb2xvciA9IGNvbCh0Lm1pc3QpO1xuICAgIHNjZW5lLmZvZ0NvbG9yID0gY29sKHQuZm9nKTsgc2NlbmUuY2xlYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yNCh0LmZvZ1swXSwgdC5mb2dbMV0sIHQuZm9nWzJdLCAxKTtcbiAgICBpZiAoa2l0KSB7IGtpdC5hcHBseSh0KTsgc2hvd24gPSB3YW50OyB9XG4gIH07XG4gIGxvYWRLaXQoc2NlbmUpLnRoZW4oKGspID0+IHsga2l0ID0gazsgc2hvd24gPSAnJzsgc2hvdygpOyB9KS5jYXRjaCgoZSkgPT4gY29uc29sZS53YXJuKCdhcmVuYSBwcm9wcyBmYWlsZWQnLCBlKSk7XG5cbiAgcmV0dXJuIHsgdXBkYXRlOiAodDogbnVtYmVyKSA9PiB7IHJtLmFscGhhID0gMC40NSArIDAuMTUgKiBNYXRoLnNpbih0ICogMS40KTsgY2F2ZS51cGRhdGUodCk7IH0sIHNldFRoZW1lOiAoc3RhZ2U6IHN0cmluZykgPT4geyB3YW50ID0gc3RhZ2U7IHNob3coKTsgfSB9O1xufVxuXG4vLyAtLS0tIHRoZSBjYXZlOiBhIHJvdWdoIHN0b25lIHdhbGwgYWxsIHRoZSB3YXkgcm91bmQsIHJvY2sgc3BpcmVzIGFsb25nIGl0cyBmb290LCBkcmlmdGluZyBtaXN0LCBhbmQgYSBkYXJrIHZpZ25ldHRlIG9uIHRoZSBmbG9vclxuY29uc3QgUlggPSAyMCwgUlogPSAxNSwgQ1ogPSAtNCwgV0FMTF9IID0gMTY7ICAgLy8gb3ZhbCByaW5nIGNlbnRyZWQgYSBsaXR0bGUgYmVoaW5kIHRoZSBmaWVsZDogdGhlIGZhciB3YWxsIHN0YW5kcyBhYm91dCAxMSBtIHBhc3QgdGhlIGNlbnRyZVxuY29uc3Qgd29iYmxlID0gKGE6IG51bWJlciwgeTogbnVtYmVyKTogbnVtYmVyID0+IE1hdGguc2luKDMgKiBhICsgMS4zKSAqIDAuNSArIE1hdGguc2luKDcgKiBhICsgeSAqIDAuNSkgKiAwLjMgKyBNYXRoLnNpbigxMyAqIGEgLSB5ICogMC4zNSkgKiAwLjIgKyBNYXRoLnNpbigyMyAqIGEgKyB5KSAqIDAuMDg7XG5cbmZ1bmN0aW9uIG1pc3RUZXh0dXJlKHNjZW5lOiBhbnksIHNlZWQ6IG51bWJlcik6IGFueSB7XG4gIGNvbnN0IFMgPSAyNTYsIHQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgnbWlzdCcgKyBzZWVkLCB7IHdpZHRoOiBTLCBoZWlnaHQ6IFMgfSwgc2NlbmUsIHRydWUpLCBjID0gdC5nZXRDb250ZXh0KCk7XG4gIGMuY2xlYXJSZWN0KDAsIDAsIFMsIFMpO1xuICBsZXQgciA9IHNlZWQgKiA5MzAxICsgNDkyOTc7IGNvbnN0IHJuZCA9ICgpID0+IChyID0gKHIgKiA5MzAxICsgNDkyOTcpICUgMjMzMjgwKSAvIDIzMzI4MDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0NjsgaSsrKSB7XG4gICAgY29uc3QgeCA9IHJuZCgpICogUywgeSA9IHJuZCgpICogUywgcmFkID0gMjYgKyBybmQoKSAqIDQ2O1xuICAgIGZvciAoY29uc3QgZHggb2YgWy1TLCAwLCBTXSkgZm9yIChjb25zdCBkeSBvZiBbLVMsIDAsIFNdKSB7ICAgICAgICAgIC8vIGRyYXcgd3JhcHBlZCBjb3BpZXMgc28gdGhlIHBpY3R1cmUgdGlsZXMgd2l0aCBubyBzZWFtXG4gICAgICBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCh4ICsgZHgsIHkgKyBkeSwgMCwgeCArIGR4LCB5ICsgZHksIHJhZCk7IGcuYWRkQ29sb3JTdG9wKDAsICdyZ2JhKDI1NSwyNTUsMjU1LDAuNSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcbiAgICAgIGMuZmlsbFN0eWxlID0gZzsgYy5maWxsUmVjdCgwLCAwLCBTLCBTKTtcbiAgICB9XG4gIH1cbiAgdC51cGRhdGUoKTsgdC5oYXNBbHBoYSA9IHRydWU7IHQud3JhcFUgPSB0LndyYXBWID0gQkFCWUxPTi5UZXh0dXJlLldSQVBfQUREUkVTU01PREU7IHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBidWlsZENhdmUoc2NlbmU6IGFueSwgZmxvb3JUZXg6IGFueSk6IHsgdXBkYXRlKHQ6IG51bWJlcik6IHZvaWQ7IHdhbGxNYXQ6IGFueTsgbWlzdE1hdHM6IGFueVtdIH0ge1xuICAvLyByb3VnaCB3YWxsOiBhbiBvdmFsIHJpbmcgd2hvc2UgcmFkaXVzIHdvYmJsZXMgd2l0aCBhbmdsZSBhbmQgaGVpZ2h0LCBkYXJrZXIgdGhlIGhpZ2hlciBpdCBnb2VzXG4gIGNvbnN0IE4gPSAxMjAsIE0gPSAxMiwgcG9zOiBudW1iZXJbXSA9IFtdLCB1djogbnVtYmVyW10gPSBbXSwgY29sOiBudW1iZXJbXSA9IFtdLCBpZHg6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGogPSAwOyBqIDw9IE07IGorKykgZm9yIChsZXQgaSA9IDA7IGkgPD0gTjsgaSsrKSB7XG4gICAgY29uc3QgYSA9IChpIC8gTikgKiBNYXRoLlBJICogMiwgaCA9IChqIC8gTSkgKiBXQUxMX0gsIGsgPSAxICsgMC4wNiAqIHdvYmJsZShhLCBoKSArIChqID09PSAwID8gMCA6IDAuMDUgKiBNYXRoLnNpbihhICogNSArIGopKTtcbiAgICBjb25zdCBvdmVyaGFuZyA9IDEgLSAwLjEgKiBNYXRoLnNpbigoaiAvIE0pICogTWF0aC5QSSk7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gbGVhbnMgaW4gYSBsaXR0bGUgc28gaXQgZmVlbHMgbGlrZSBhIGNhdmVyblxuICAgIHBvcy5wdXNoKE1hdGguY29zKGEpICogUlggKiBrICogb3ZlcmhhbmcsIGgsIENaICsgTWF0aC5zaW4oYSkgKiBSWiAqIGsgKiBvdmVyaGFuZyk7IHV2LnB1c2goKGkgLyBOKSAqIDE0LCAoaiAvIE0pICogMy4yKTtcbiAgICBjb25zdCBiID0gTWF0aC5tYXgoMC4wNiwgMS4wIC0gKGogLyBNKSAqIDAuOSk7IGNvbC5wdXNoKGIgKiAwLjgsIGIsIGIsIDEpO1xuICB9XG4gIGZvciAobGV0IGogPSAwOyBqIDwgTTsgaisrKSBmb3IgKGxldCBpID0gMDsgaSA8IE47IGkrKykgeyBjb25zdCBhID0gaiAqIChOICsgMSkgKyBpLCBiID0gYSArIDEsIGMgPSBhICsgTiArIDEsIGQgPSBjICsgMTsgaWR4LnB1c2goYSwgYywgYiwgYiwgYywgZCk7IH1cbiAgY29uc3Qgd2FsbCA9IG5ldyBCQUJZTE9OLk1lc2goJ2NhdmUnLCBzY2VuZSksIHZkID0gbmV3IEJBQllMT04uVmVydGV4RGF0YSgpOyB2ZC5wb3NpdGlvbnMgPSBwb3M7IHZkLmluZGljZXMgPSBpZHg7IHZkLnV2cyA9IHV2OyB2ZC5jb2xvcnMgPSBjb2w7XG4gIGNvbnN0IG5ybTogbnVtYmVyW10gPSBbXTsgQkFCWUxPTi5WZXJ0ZXhEYXRhLkNvbXB1dGVOb3JtYWxzKHBvcywgaWR4LCBucm0pOyB2ZC5ub3JtYWxzID0gbnJtOyB2ZC5hcHBseVRvTWVzaCh3YWxsKTtcbiAgY29uc3Qgd20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdjYXZlbScsIHNjZW5lKTsgd20uZGlmZnVzZVRleHR1cmUgPSBmbG9vclRleC5jbG9uZSgpOyB3bS5kaWZmdXNlVGV4dHVyZS51U2NhbGUgPSAxOyB3bS5kaWZmdXNlVGV4dHVyZS52U2NhbGUgPSAxO1xuICB3bS5zcGVjdWxhckNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgd20uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IHdtLmRpZmZ1c2VDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjg1LCAwLjkpOyB3YWxsLm1hdGVyaWFsID0gd207IHdhbGwuaXNQaWNrYWJsZSA9IGZhbHNlOyB3YWxsLnVzZVZlcnRleENvbG9ycyA9IHRydWU7IHdtLnVzZVZlcnRleENvbG9yID0gdHJ1ZTtcbiAgLy8gcm9jayBzcGlyZXMgc3RhbmRpbmcgYWxvbmcgdGhlIGZvb3Qgb2YgdGhlIHdhbGwgKG9uZSBzaGFyZWQgbWVzaCwgbWFueSBjb3BpZXMpXG4gIGNvbnN0IHNwaXJlID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignc3BpcmUnLCB7IGRpYW1ldGVyVG9wOiAwLCBkaWFtZXRlckJvdHRvbTogMS42LCBoZWlnaHQ6IDEsIHRlc3NlbGxhdGlvbjogNSB9LCBzY2VuZSk7XG4gIGNvbnN0IHNtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnc3BpcmVtJywgc2NlbmUpOyBzbS5kaWZmdXNlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4wMywgMC4wNDUsIDAuMDU1KTsgc20uc3BlY3VsYXJDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IHNtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4wMDQsIDAuMDEyLCAwLjAxNCk7IHNwaXJlLm1hdGVyaWFsID0gc207XG4gIHNwaXJlLmNvbnZlcnRUb0ZsYXRTaGFkZWRNZXNoKCk7IHNwaXJlLnNldEVuYWJsZWQoZmFsc2UpOyBzcGlyZS5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGxldCByID0gMTIzNDU7IGNvbnN0IHJuZCA9ICgpID0+IChyID0gKHIgKiA5MzAxICsgNDkyOTcpICUgMjMzMjgwKSAvIDIzMzI4MDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0NjsgaSsrKSB7XG4gICAgY29uc3QgYSA9IChpIC8gNDYpICogTWF0aC5QSSAqIDIgKyAocm5kKCkgLSAwLjUpICogMC4xMiwgZCA9IDAuODYgKyBybmQoKSAqIDAuMSwgaGd0ID0gMS40ICsgcm5kKCkgKiAzLjIsIHcgPSAwLjcgKyBybmQoKSAqIDEuMDtcbiAgICBjb25zdCBzID0gc3BpcmUuY3JlYXRlSW5zdGFuY2UoJ3NwJyArIGkpOyBzLmlzUGlja2FibGUgPSBmYWxzZTsgcy5wb3NpdGlvbi5zZXQoTWF0aC5jb3MoYSkgKiBSWCAqIGQsIGhndCAvIDIgLSAwLjIsIENaICsgTWF0aC5zaW4oYSkgKiBSWiAqIGQpO1xuICAgIHMuc2NhbGluZy5zZXQodywgaGd0LCB3KTsgcy5yb3RhdGlvbi55ID0gcm5kKCkgKiA2OyBzLnJvdGF0aW9uLnogPSAocm5kKCkgLSAwLjUpICogMC4xODtcbiAgfVxuICAvLyBtaXN0OiB0d28gc2xvdyBsYXllcnMganVzdCBhYm92ZSB0aGUgZmxvb3JcbiAgY29uc3QgbGF5ZXJzID0gWzAuMjgsIDAuNzVdLm1hcCgoeSwgbikgPT4ge1xuICAgIGNvbnN0IHAgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgnbWlzdCcgKyBuLCB7IHdpZHRoOiA2MCwgaGVpZ2h0OiA0NCB9LCBzY2VuZSk7IHAucG9zaXRpb24ueSA9IHk7IHAuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdtaXN0bScgKyBuLCBzY2VuZSksIHQgPSBtaXN0VGV4dHVyZShzY2VuZSwgbiArIDMpOyB0LnVTY2FsZSA9IDUgLSBuOyB0LnZTY2FsZSA9IDMuNCAtIG4gKiAwLjY7XG4gICAgbS5kaWZmdXNlVGV4dHVyZSA9IHQ7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoMC4yLCAwLjYsIDAuNTUpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYWxwaGEgPSAwLjE1IC0gbiAqIDAuMDY7IG0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7XG4gICAgbS5kaXNhYmxlRGVwdGhXcml0ZSA9IHRydWU7IHAubWF0ZXJpYWwgPSBtOyBwLmFscGhhSW5kZXggPSA1ICsgbjsgcmV0dXJuIHsgdCwgbiwgbSB9O1xuICB9KTtcbiAgLy8gdmlnbmV0dGU6IGRhcmtlbnMgdGhlIGZsb29yIHRvd2FyZCB0aGUgZWRnZXMgc28gdGhlIGZpZWxkIGxvb2tzIGxpa2UgYSBsaXQgcG9vbCBpbnNpZGUgdGhlIGNhdmVcbiAgY29uc3QgdnQgPSBuZXcgQkFCWUxPTi5EeW5hbWljVGV4dHVyZSgndmlnJywgeyB3aWR0aDogMjU2LCBoZWlnaHQ6IDI1NiB9LCBzY2VuZSwgdHJ1ZSksIHZjID0gdnQuZ2V0Q29udGV4dCgpLCBnID0gdmMuY3JlYXRlUmFkaWFsR3JhZGllbnQoMTI4LCAxMjgsIDAsIDEyOCwgMTI4LCAxMjgpO1xuICBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgwLDAsMCwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjQyLCAncmdiYSgwLDAsMCwwKScpOyBnLmFkZENvbG9yU3RvcCgwLjgsICdyZ2JhKDAsNCw2LDAuNyknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMCw0LDYsMC45NSknKTtcbiAgdmMuZmlsbFN0eWxlID0gZzsgdmMuZmlsbFJlY3QoMCwgMCwgMjU2LCAyNTYpOyB2dC51cGRhdGUoKTsgdnQuaGFzQWxwaGEgPSB0cnVlO1xuICBjb25zdCB2aWcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgndmlnJywgeyB3aWR0aDogNDYsIGhlaWdodDogMzAgfSwgc2NlbmUpOyB2aWcucG9zaXRpb24ueSA9IDAuMDM7IHZpZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gIGNvbnN0IHZtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgndmlnbScsIHNjZW5lKTsgdm0uZGlmZnVzZVRleHR1cmUgPSB2dDsgdm0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB2bS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB2bS5lbWlzc2l2ZUNvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAsIDAuMDEsIDAuMDE1KTsgdm0uZGlzYWJsZURlcHRoV3JpdGUgPSB0cnVlOyB2aWcubWF0ZXJpYWwgPSB2bTsgdmlnLmFscGhhSW5kZXggPSAxO1xuICByZXR1cm4geyB3YWxsTWF0OiB3bSwgbWlzdE1hdHM6IGxheWVycy5tYXAoKGwpID0+IGwubSksIHVwZGF0ZTogKHQ6IG51bWJlcikgPT4geyBmb3IgKGNvbnN0IGwgb2YgbGF5ZXJzKSB7IGwudC51T2Zmc2V0ID0gdCAqICgwLjAwNiArIGwubiAqIDAuMDA0KTsgbC50LnZPZmZzZXQgPSB0ICogMC4wMDMgKiAobC5uID8gLTEgOiAxKTsgfSB9IH07XG59XG4iLCAiLy8gRW5kbGVzcyBEZXB0aHM6IGVuZW15IHdhdmVzIGJ1aWx0IGZyb20gYSBCVURHRVQgaW5zdGVhZCBvZiBhIGhhbmQtd3JpdHRlbiBsaXN0LCBzbyB0aGUgbW9kZSBuZXZlciBydW5zIG91dCBvZiB3YXZlcy5cbi8vIFRoZSBidWRnZXQgaXMgdGhlIGVuZW15IHRlYW0ncyB0b3RhbCBEb21pbmlvbiBjb3N0ICh0aGUgc2FtZSBDT1NUIHRhYmxlIHRoZSBwbGF5ZXIgcGF5cyBmcm9tKS4gV2F2ZXMgYXJlIGJ1aWx0IGZyb20gcm9sZSBURU1QTEFURVMgc28gdGhleVxuLy8gbG9vayBkZXNpZ25lZCAoYSBmcm9udCBsaW5lIHdpdGggYXJjaGVycyBiZWhpbmQsIGEgc3dhcm0sIGEgYnJ1dGUgc3F1YWQpIGluc3RlYWQgb2YgYSByYW5kb20gcGlsZS4gRXZlcnl0aGluZyBpcyBzZWVkZWQ6IHRoZSBzYW1lIHNlZWQgZ2l2ZXNcbi8vIHRoZSBzYW1lIHdhdmVzLCBzbyBhIHJldHJ5IChvciBhIGRhaWx5IHNlZWQpIGZhY2VzIGV4YWN0bHkgdGhlIHNhbWUgYXJteS5cbi8vXG4vLyBUaGUgcGxheWVyJ3MgYXJteSBpcyBjYXBwZWQgb24gcHVycG9zZSAoRG9taW5pb24gc3RvcHMgYXQgNDAsIHRoZSBncmlkIGhvbGRzIDEyKSwgc28gYXQgc29tZSBwb2ludCB0aGUgZW5lbXkgc2ltcGx5IG91dC1zY2FsZXMgaXQ6IHRoYXQgaXMgdGhlXG4vLyBcImhhcmQgd2FsbFwiLiBPbmNlIHRoZSBidWRnZXQgZmlsbHMgdGhlIDEyIHNsb3RzIHdpdGggdXBncmFkZWQgdW5pdHMsIGBlbmRsZXNzUG93ZXJgICh0aGUgaGlkZGVuIGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllcikga2VlcHMgY2xpbWJpbmcuXG4vLyBOdW1iZXJzIGhlcmUgYXJlIHR1bmVkIHdpdGggc2ltL2VuZGxlc3NfY3VydmUudHMuXG5cbmltcG9ydCB7IENPU1QgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgRW5lbXlTcGVjIH0gZnJvbSAnLi93YXZlcy50cyc7XG5cbmV4cG9ydCBjb25zdCBFTkRMRVNTX0lEID0gJ2VuZGxlc3MnO1xuLyoqIEEgcGFjayBpcyBncmFudGVkIGV2ZXJ5IHRoaXMtbWFueSB3YXZlcyBjbGVhcmVkIGluIGFuIGVuZGxlc3MgcnVuLiAqL1xuZXhwb3J0IGNvbnN0IEVORExFU1NfUEFDS19FVkVSWSA9IDEwO1xuY29uc3QgTUFYX1VOSVRTID0gMTI7XG5cbi8qKiBUaGUgdHVuaW5nIGtub2JzIChzaW0vZW5kbGVzc19jdXJ2ZS50cyBzd2VlcHMgdGhlbSkuICovXG5leHBvcnQgY29uc3QgVFVORSA9IHsgc3RhcnQ6IDUsIHNsb3BlOiAzLjAsIGxhdGVTbG9wZTogMC44LCBtYXhCdWRnZXQ6IDE1MCwgcG93ZXJTbG9wZTogMC4wMTIsIGNoYW1waW9uOiAxLjAgfTtcbi8qKiBUb3RhbCBEb21pbmlvbiBjb3N0IG9mIHRoZSBlbmVteSB0ZWFtIGF0IHdhdmUgYG5gICgxLWJhc2VkKTogYSBnZW50bGUgc3RhcnQgKGFib3V0IHRoZSBOb3JtYWwgY2FtcGFpZ24gYnkgd2F2ZSAxMCksIHRoZW4gaXQga2VlcHMgcmlzaW5nLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NCdWRnZXQobjogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDEsIG4pLCBlYXJseSA9IFRVTkUuc3RhcnQgKyBUVU5FLnNsb3BlICogKE1hdGgubWluKHcsIDEwKSAtIDEpO1xuICByZXR1cm4gTWF0aC5yb3VuZChNYXRoLm1pbihUVU5FLm1heEJ1ZGdldCwgZWFybHkgKyAodyA+IDEwID8gVFVORS5sYXRlU2xvcGUgKiAodyAtIDEwKSA6IDApKSk7XG59XG4vKiogSGlkZGVuIGVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllcjogMS4wIHRocm91Z2ggd2F2ZSAxMCwgdGhlbiByaXNpbmc7IGV2ZXJ5IDEwdGggKGNoYW1waW9uKSB3YXZlIGdldHMgYSBsaXR0bGUgZXh0cmEuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kbGVzc1Bvd2VyKG46IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHcgPSBNYXRoLm1heCgxLCBuKSwgYmFzZSA9IHcgPD0gMTAgPyAxIDogMSArIFRVTkUucG93ZXJTbG9wZSAqICh3IC0gMTApO1xuICByZXR1cm4gKyh3ICUgMTAgPT09IDAgPyBiYXNlICogVFVORS5jaGFtcGlvbiA6IGJhc2UpLnRvRml4ZWQoMyk7XG59XG4vKiogUGFjayB0aWVyIGZvciBjbGVhcmluZyB3YXZlIGBuYCAob25seSBtZWFuaW5nZnVsIHdoZW4gbiBpcyBhIG11bHRpcGxlIG9mIEVORExFU1NfUEFDS19FVkVSWSkuICovXG5leHBvcnQgY29uc3QgZW5kbGVzc1BhY2tUaWVyID0gKG46IG51bWJlcik6IG51bWJlciA9PiAobiA+PSAzMCA/IDMgOiBuID49IDIwID8gMiA6IDEpO1xuXG50eXBlIFJvbGUgPSAndGFuaycgfCAnYnJ1dGUnIHwgJ3JhbmdlZCcgfCAnZm9kZGVyJztcbmNvbnN0IFJPTEU6IFJlY29yZDxSb2xlLCBTb3VsSWRbXT4gPSB7IHRhbms6IFsna25pZ2h0JywgJ29ncmUnXSwgYnJ1dGU6IFsnYmFyYmFyaWFuJywgJ29ncmUnXSwgcmFuZ2VkOiBbJ2FyY2hlciddLCBmb2RkZXI6IFsnd2FycmlvcicsICdnb2JsaW4nXSB9O1xuZXhwb3J0IGludGVyZmFjZSBUZW1wbGF0ZSB7IGlkOiBzdHJpbmc7IG1peDogW1JvbGUsIG51bWJlcl1bXSB9XG5leHBvcnQgY29uc3QgVEVNUExBVEVTOiBUZW1wbGF0ZVtdID0gW1xuICB7IGlkOiAnd2FsbCcsIG1peDogW1sndGFuaycsIDNdLCBbJ3JhbmdlZCcsIDJdLCBbJ2ZvZGRlcicsIDFdXSB9LFxuICB7IGlkOiAnc3dhcm0nLCBtaXg6IFtbJ2ZvZGRlcicsIDVdLCBbJ3JhbmdlZCcsIDFdLCBbJ3RhbmsnLCAxXV0gfSxcbiAgeyBpZDogJ2JydXRlcycsIG1peDogW1snYnJ1dGUnLCA0XSwgWydmb2RkZXInLCAxXSwgWydyYW5nZWQnLCAxXV0gfSxcbiAgeyBpZDogJ21peGVkJywgbWl4OiBbWyd0YW5rJywgMV0sIFsnYnJ1dGUnLCAxXSwgWydyYW5nZWQnLCAxXSwgWydmb2RkZXInLCAyXV0gfSxcbl07XG5cbi8qKiBXYXZlcyAxLTIgYXJlIGEgZ2VudGxlIHdhcm0tdXA6IGNoZWFwIGZvZGRlciAoYW5kIGFuIGFyY2hlciksIG5vIHRhbmtzIG9yIGJydXRlcywgc28gbm9ib2R5IGxvc2VzIGEgaGVhcnQgdG8gdGhlIGZpcnN0IGZpZ2h0LiAqL1xuY29uc3QgV0FSTVVQOiBUZW1wbGF0ZSA9IHsgaWQ6ICd3YXJtdXAnLCBtaXg6IFtbJ2ZvZGRlcicsIDNdLCBbJ3JhbmdlZCcsIDFdXSB9O1xuLyoqIFdoaWNoIHRlbXBsYXRlIGEgd2F2ZSB1c2VzIChzZWVkZWQgcGVyIHdhdmUsIHNvIGl0IGRvZXMgbm90IGRlcGVuZCBvbiB3aGF0IGNhbWUgYmVmb3JlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRsZXNzVGVtcGxhdGUobjogbnVtYmVyLCBzZWVkOiBudW1iZXIpOiBUZW1wbGF0ZSB7XG4gIGlmIChuIDw9IDIpIHJldHVybiBXQVJNVVA7XG4gIHJldHVybiBURU1QTEFURVNbTWF0aC5mbG9vcihtYWtlUm5nKHNlZWQgKiA0MDk5ICsgbiAqIDMxICsgNSkubmV4dCgpICogVEVNUExBVEVTLmxlbmd0aCldO1xufVxuXG4vKiogVGhlIGVuZW15IGFybXkgZm9yIGVuZGxlc3Mgd2F2ZSBgbmAgKDEtYmFzZWQpLiBBdCBtb3N0IDEyIHVuaXRzOyB0aGUgd2hvbGUgYnVkZ2V0IGlzIHNwZW50IHVubGVzcyBubyB1bml0IGZpdHMgd2hhdCBpcyBsZWZ0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZGxlc3NXYXZlKG46IG51bWJlciwgc2VlZCA9IDApOiBFbmVteVNwZWNbXSB7XG4gIGNvbnN0IHdhdmUgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKG4pKSwgcm5nID0gbWFrZVJuZyhzZWVkICogMTAwOSArIHdhdmUgKiA3OTE5ICsgMTcpLCB0cGwgPSBlbmRsZXNzVGVtcGxhdGUod2F2ZSwgc2VlZCk7XG4gIGxldCBsZWZ0ID0gZW5kbGVzc0J1ZGdldCh3YXZlKTsgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgaWYgKHdhdmUgJSAxMCA9PT0gMCAmJiBsZWZ0ID49IDIwKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjaGFtcGlvbiB3YXZlOiBvbmUgc3RhcnJlZCBicnV0ZSB1cCBmcm9udCAoMiBzdGFycywgMyBmcm9tIHdhdmUgNDApLCB0aGVuIHRoZSB1c3VhbCBlc2NvcnRcbiAgICBjb25zdCBzb3VsOiBTb3VsSWQgPSBybmcubmV4dCgpIDwgMC41ID8gJ29ncmUnIDogJ2tuaWdodCcsIHN0YXIgPSB3YXZlID49IDQwID8gMyA6IDI7IGFybXkucHVzaCh7IHNvdWwsIHN0YXIsIGJvc3M6IHRydWUgfSk7IGxlZnQgLT0gQ09TVFtzb3VsXVtzdGFyIC0gMV07XG4gIH1cbiAgY29uc3QgdG90YWwgPSB0cGwubWl4LnJlZHVjZSgoYSwgWywgd10pID0+IGEgKyB3LCAwKTtcbiAgZm9yIChsZXQgZ3VhcmQgPSAwOyBndWFyZCA8IDgwICYmIGFybXkubGVuZ3RoIDwgTUFYX1VOSVRTICYmIGxlZnQgPj0gMjsgZ3VhcmQrKykge1xuICAgIGxldCByID0gcm5nLm5leHQoKSAqIHRvdGFsLCByb2xlOiBSb2xlID0gdHBsLm1peFswXVswXTtcbiAgICBmb3IgKGNvbnN0IFtybywgd10gb2YgdHBsLm1peCkgeyByIC09IHc7IGlmIChyIDw9IDApIHsgcm9sZSA9IHJvOyBicmVhazsgfSB9XG4gICAgbGV0IG9wdGlvbnMgPSBST0xFW3JvbGVdLmZpbHRlcigocykgPT4gQ09TVFtzXVswXSA8PSBsZWZ0KTtcbiAgICBpZiAoIW9wdGlvbnMubGVuZ3RoKSBvcHRpb25zID0gUk9MRS5mb2RkZXIuZmlsdGVyKChzKSA9PiBDT1NUW3NdWzBdIDw9IGxlZnQpO1xuICAgIGlmICghb3B0aW9ucy5sZW5ndGgpIGJyZWFrO1xuICAgIGNvbnN0IHNvdWwgPSBybmcucGljayhvcHRpb25zKSwgcGVyID0gbGVmdCAvIE1hdGgubWF4KDEsIE1BWF9VTklUUyAtIGFybXkubGVuZ3RoKTtcbiAgICBsZXQgc3RhciA9IDE7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNwYXJlIGJ1ZGdldCBwZXIgZnJlZSBzbG90IGJ1eXMgc3RhcnNcbiAgICBmb3IgKGxldCBzID0gMzsgcyA+PSAyOyBzLS0pIGlmIChDT1NUW3NvdWxdW3MgLSAxXSA8PSBsZWZ0ICYmIENPU1Rbc291bF1bcyAtIDFdIDw9IE1hdGgubWF4KENPU1Rbc291bF1bMF0sIHBlciAqIDEuMikpIHsgc3RhciA9IHM7IGJyZWFrOyB9XG4gICAgYXJteS5wdXNoKHsgc291bCwgc3RhciB9KTsgbGVmdCAtPSBDT1NUW3NvdWxdW3N0YXIgLSAxXTtcbiAgfVxuICByZXR1cm4gYXJteTtcbn1cbiIsICIvLyBFbmVteSB3YXZlcyBhbmQgdGhlIGNhbXBhaWduJ3Mgc3RhZ2VzLiBTYW1lIHVuaXQgcG9vbCBhcyB0aGUgcGxheWVyLiBUaGUgYnVpbGQgc2NyZWVuIHByZXZpZXdzIHRoZSBDT01QT1NJVElPTiBvbmx5LCBuZXZlciBwb3NpdGlvbnMuXG4vL1xuLy8gRWFjaCBTVEFHRSBoYXMgZm91ciBkaWZmaWN1bHR5IHRpZXJzIChlYXN5IC8gbm9ybWFsIC8gaGFyZCAvIG5pZ2h0bWFyZSkuIExhdGVyIHN0YWdlcyBhcmUgaGFyZGVyOiB0aGV5IHJldXNlIHRvdWdoZXIgd2F2ZSBsaXN0cyBhbmQgYSBoaWRkZW5cbi8vIEVORU1ZIFBPV0VSIG11bHRpcGxpZXIgKGhlYWx0aCBhbmQgZGFtYWdlIG9mIGVuZW15IHVuaXRzKSB0dW5lZCBwZXIgc3RhZ2UgYW5kIHRpZXIgd2l0aCBzaW0vY2FsaWJyYXRlX3Bvd2VyLnRzLCBzbyB0aGF0IHRoZSBjb21wZXRlbnRcbi8vIHN0YW5kLWluIHBsYXllciBjbGVhcnMgZWFjaCB0aWVyIGFib3V0IDYwJSBvZiB0aGUgdGltZSBhdCB0aGF0IHRpZXIncyBSRUNPTU1FTkRFRCBTT1VMIExFVkVMIChldmVyeSBTb3VsIGF0IHRoYXQgbGV2ZWwpLlxuLy8gVW5sb2NrIHJ1bGVzIGxpdmUgaW4gcHJvZ3Jlc3MudHM6IEVhc3kgYW5kIE5vcm1hbCBhcmUgYWx3YXlzIG9wZW47IGNsZWFyaW5nIE5vcm1hbCBvcGVucyBIYXJkIGFuZCB0aGUgbmV4dCBzdGFnZTsgY2xlYXJpbmcgSGFyZCBvcGVucyBOaWdodG1hcmUuXG5cbmltcG9ydCB7IENPU1QsIENVUlZFUywgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19JRCwgZW5kbGVzc1Bvd2VyLCBlbmRsZXNzV2F2ZSB9IGZyb20gJy4vZW5kbGVzcy50cyc7XG5pbXBvcnQgeyBtYWtlUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVuZW15U3BlYyB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBib3NzPzogYm9vbGVhbiB9XG5leHBvcnQgdHlwZSBEaWZmID0gJ2Vhc3knIHwgJ25vcm1hbCcgfCAnaGFyZCcgfCAnbmlnaHRtYXJlJztcbmV4cG9ydCBjb25zdCBESUZGUzogRGlmZltdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuXG5jb25zdCBMRVRURVI6IFJlY29yZDxzdHJpbmcsIFNvdWxJZD4gPSB7IFc6ICd3YXJyaW9yJywgQTogJ2FyY2hlcicsIEc6ICdnb2JsaW4nLCBLOiAna25pZ2h0JywgTzogJ29ncmUnLCBCOiAnYmFyYmFyaWFuJyB9O1xuY29uc3QgcGFyc2VXYXZlID0gKHM6IHN0cmluZyk6IEVuZW15U3BlY1tdID0+IHMuc3BsaXQoJyAnKS5tYXAoKHQpID0+ICh7IHNvdWw6IExFVFRFUlt0WzBdXSwgc3RhcjogK3RbMV0gfSkpO1xuXG4vKipcbiAqIFdhdmUgbGlzdHMgKFcgd2FycmlvciwgQSBhcmNoZXIsIEcgZ29ibGluLCBLIGtuaWdodCwgTyBvZ3JlLCBCIGJhcmJhcmlhbjsgZGlnaXQgPSBzdGFycykuIFRoZXNlIGZvdXIgd2VyZSB0dW5lZCBmb3IgU3RhZ2UgMTsgbGF0ZXIgc3RhZ2VzXG4gKiByZXVzZSB0aGVtIG9uZSB0aWVyIHVwIGFuZCBhZGQgZW5lbXkgcG93ZXIuIEhhcmQgYW5kIE5pZ2h0bWFyZSBhcmUgdm9sdW1lLWRyaXZlbiAodXAgdG8gMTIgZW5lbWllcykuXG4gKiBDb21wZXRlbnQgc3RhbmQtaW4gY2xlYXIgcmF0ZSB3aXRoIEVWRVJZIFNvdWwgYXQgbGV2ZWwgMSAvIDQgLyA2OiBlYXN5IDk4LzEwMC8xMDAsIG5vcm1hbCA4Mi85OC8xMDAsIGhhcmQgNy82MC84NywgbmlnaHRtYXJlIDAvMzMvNzQuXG4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEnLCAnSzEgVzEnLCAnTzEgVzEgRzEnLCAnSzEgQTEgVzEnLCAnTzEgQTEgRzEnLCAnSzEgTzEgQTEnLCAnSzEgTzEgQTEgRzEnLCAnTzEgSzEgQTEgRzEnLCAnTzEgSzEgQTEgQjEnLCAnTzIgSzEgQTEgRzEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExJywgJ0sxIEcxIFcxJywgJ08xIEExIEcxIFcxJywgJ0sxIE8xIEExIFcxJywgJ08xIEsxIEExIEcxIFcxJywgJ0EyIEsxIE8xIEcxIFcxJywgJ0sxIE8xIEExIEcxIFcxJywgJ08xIEsxIEExIEIxIEcxJywgJ08xIEsxIEEyIEIxIEcxJywgJ08yIEsxIEExIEIxIEcxIFcxJ10sXG4gIGhhcmQ6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgQTEgRzEgVzEgVzEnLCAnSzEgTzEgQTEgVzEgRzEgVzEnLCAnTzEgSzEgQTIgRzEgVzEgVzEgVzEnLCAnQTIgSzEgTzEgRzEgVzEgQjEgVzEgVzEnLCAnSzEgTzEgQTEgRzEgVzIgVzEgVzEnLCAnTzEgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzEgQTIgQjEgRzEgVzEgVzEgRzEnLCAnTzIgSzIgQTEgQjEgRzEgVzEgVzEgVzEgRzEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ08xIEExIEcxIFcxIEIxIFcxJywgJ0sxIE8xIEExIFcxIEcxIFcxIFcxJywgJ08xIEsxIEEyIEcxIFcxIEIxIFcxIFcxIEcxJywgJ0EyIEsxIE8xIEcxIFcxIEIxIFcxIFcxIEcxIEcxJywgJ0sxIE8xIEEyIEcxIFcxIEIxIFcxIFcxIEcxIEcxIEIxJywgJ08xIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxJywgJ08yIEsxIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJywgJ08yIEsyIEEyIEIxIEcxIFcxIFcxIFcxIEcxIEcxIEIxIEsxJ10sXG59O1xuXG4vKiogU3RhZ2UgMiwgdGhlIFN1bmtlbiBHcmF2ZXlhcmQ6IGNyb3dkcy4gU2FtZSBEb21pbmlvbiBjb3N0IHBlciB3YXZlIGFzIHRoZSBsaXN0cyBvbmUgdGllciB1cCwgYnV0IGJ1aWx0IGZyb20gbWFueSBXYXJyaW9ycywgR29ibGlucyBhbmQgQXJjaGVycyB3aXRoIGEgS25pZ2h0IG9yIE9ncmUgaG9sZGluZyB0aGUgZnJvbnQgKHNpbS9hdXRob3Jfc3RhZ2VzLnRzKS4gKi9cbmNvbnN0IEdSQVZFWUFSRDogUmVjb3JkPERpZmYsIHN0cmluZ1tdPiA9IHtcbiAgZWFzeTogWydXMSBBMScsICdLMSBHMSBXMScsICdPMSBXMSBXMSBXMSBHMScsICdPMSBHMiBHMSBBMScsICdPMSBXMSBXMSBXMSBBMSBBMScsICdLMSBXMSBXMSBXMSBBMSBBMSBBMScsICdPMSBXMSBXMSBXMSBXMSBXMSBBMScsICdPMSBXMSBXMSBXMSBXMSBHMSBHMSBHMScsICdLMSBXMSBXMSBXMSBXMSBXMSBHMiBHMSBBMScsICdLMSBXMSBXMSBXMSBXMSBHMSBHMSBHMSBHMSBBMSddLFxuICBub3JtYWw6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgVzEgVzEgVzEgRzEgQTEnLCAnTzEgVzEgVzEgRzEgRzEgRzEgRzEnLCAnTzEgVzIgVzEgVzEgVzEgVzEgVzEgRzEgQTEnLCAnSzEgVzEgVzEgVzEgVzEgVzEgRzEgRzEgRzEgQTEgQTEnLCAnSzEgVzEgVzEgVzEgRzEgQTEgQTEgQTEnLCAnTzEgVzEgVzEgRzEgRzEgQTEgQTEgQTEgQTEnLCAnSzIgVzEgVzEgVzEgVzEgVzEgVzEgRzEgRzEgRzEgQTEgQTEnLCAnTzEgVzIgVzEgVzEgVzEgVzEgVzEgRzEgRzEgQTEgQTEgQTEnXSxcbiAgaGFyZDogWydXMSBBMSBHMScsICdLMSBHMSBXMSBBMSBXMScsICdPMSBXMSBXMSBXMSBXMSBHMiBBMScsICdPMSBXMSBXMSBHMSBHMSBBMSBBMScsICdPMSBXMSBXMSBXMSBXMSBXMSBHMSBHMSBBMSBBMSBBMScsICdLMSBXMyBXMiBXMiBXMiBXMSBXMSBXMSBXMSBBMSBBMSBBMScsICdPMSBXMyBXMiBXMiBXMiBXMiBXMSBXMSBXMSBHMyBHMiBBMScsICdPMiBXMiBXMiBXMSBXMSBXMSBHMiBHMSBHMSBHMSBBMiBBMScsICdLMyBXMyBXMyBXMyBXMiBXMiBXMSBXMSBHMiBHMSBHMSBBMycsICdLMyBXMyBXMyBXMiBXMiBXMSBHMyBHMiBHMiBHMSBBMiBBMSddLFxuICBuaWdodG1hcmU6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnTzEgVzEgVzEgVzEgRzEgRzEgQTEnLCAnTzEgVzEgVzEgVzEgVzEgRzEgRzEgQTEnLCAnSzEgVzEgVzEgVzEgVzEgVzEgVzEgVzEgVzEgQTIgQTEgQTEnLCAnTzEgVzMgVzIgVzEgVzEgVzEgVzEgVzEgRzIgRzEgRzEgQTEnLCAnTzEgVzIgVzEgVzEgVzEgRzIgRzEgRzEgRzEgQTIgQTEgQTEnLCAnTzIgVzIgVzEgVzEgVzEgVzEgRzIgRzEgRzEgQTIgQTEgQTEnLCAnSzIgVzMgVzEgVzEgVzEgRzIgRzIgRzEgQTMgQTIgQTEgQTEnLCAnTzIgVzEgVzEgVzEgRzIgRzIgRzIgRzEgRzEgQTMgQTIgQTEnXSxcbn07XG4vKiogU3RhZ2UgMywgdGhlIEJvbmUgQmFzdGlvbjogZmV3ZXIsIGhlYXZpZXIgYXJtaWVzIG9mIEtuaWdodHMsIE9ncmVzIGFuZCBCYXJiYXJpYW5zIHdpdGggQXJjaGVycyBiZWhpbmQgKHNpbS9hdXRob3Jfc3RhZ2VzLnRzKS4gKi9cbmNvbnN0IEJBU1RJT046IFJlY29yZDxEaWZmLCBzdHJpbmdbXT4gPSB7XG4gIGVhc3k6IFsnVzEgQTEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgQTEgQTEnLCAnSzEgSzEgSzEgQTEgQTEnLCAnSzEgTzEgQjEgQjEgQTEnLCAnSzEgSzEgTzEgTzEgQTEgQTEnLCAnSzEgSzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgTzEgQjEgQjEnLCAnSzIgSzEgTzEgTzEgQjEgQjEnLCAnSzEgSzEgTzEgTzEgQjEgQjEgQTEnXSxcbiAgbm9ybWFsOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ0sxIEsxIEsxIEExIEExJywgJ08xIE8xIEIxIEIxJywgJ0syIEsxIEsxIE8xIEIxIEIxJywgJ0sxIE8xIE8xIEIxIEIxIEExIEExJywgJ0syIEsxIEsxIEsxIEIyIEIxIEIxIEExJywgJ0syIEsxIEsxIE8xIEIxIEIxIEEyIEExJywgJ0syIEsyIE8yIEIxIEIxIEEyIEEyIEExJywgJ0syIEsyIEsyIEsxIEIyIEIyIEEzIEExJ10sXG4gIGhhcmQ6IFsnVzEgQTEgRzEnLCAnSzEgRzEgVzEgQTEgVzEnLCAnSzEgSzEgQjEgQTEgQTEnLCAnSzEgSzEgTzEgQTEgQTEnLCAnSzEgTzEgQjEgQjEgQjEgQTEgQTEnLCAnSzEgSzEgSzEgTzEgTzEgQjEgQTEnLCAnSzEgSzEgSzEgSzEgTzEgQjEgQjEgQjEnLCAnSzIgSzEgSzEgTzEgTzEgQjEgQjEgQTEnLCAnSzIgSzEgTzEgTzEgQjEgQjEgQjEgQTMnLCAnSzIgSzIgSzEgSzEgTzEgTzEgQjMgQjEnXSxcbiAgbmlnaHRtYXJlOiBbJ1cxIEExIEcxJywgJ0sxIEcxIFcxIEExIFcxJywgJ0sxIEsxIE8xIEIxJywgJ0syIEsxIEsxIE8xJywgJ0syIEsxIEsxIEsxIEsxIE8xJywgJ0sxIEsxIEsxIE8xIE8xIEIxIEExJywgJ0sxIEsxIEsxIEIyIEIxIEIxIEEyIEExJywgJ0sxIE8xIE8xIE8xIEIyIEExIEExIEExJywgJ0sxIE8yIE8xIE8xIE8xIEIxIEIxIEExJywgJ0szIEsyIEsxIEsxIEsxIE8yIEIxIEIxJ10sXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFN0YWdlRGVmIHtcbiAgaWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBibHVyYjogc3RyaW5nO1xuICBsaXN0czogUmVjb3JkPERpZmYsIHN0cmluZ1tdPjsgICAgICAgICAgLy8gdGhlIDEwIGVuZW15IHdhdmVzIGZvciBlYWNoIHRpZXJcbiAgcG93ZXI6IFJlY29yZDxEaWZmLCBudW1iZXI+OyAgICAgICAgICAgIC8vIGhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIGVhY2ggdGllciAoMSA9IGFzIHdyaXR0ZW4pXG4gIHJlYzogUmVjb3JkPERpZmYsIG51bWJlcj47ICAgICAgICAgICAgICAvLyByZWNvbW1lbmRlZCBTb3VsIGxldmVsIGZvciBlYWNoIHRpZXIgKGEgaGludCBvbiBIb21lLCBuZXZlciBhIGxvY2spXG59XG5cbi8qKiBUaGUgY2FtcGFpZ24uIE5hbWVzIGFyZSBwbGFjZWhvbGRlcnMuIFBvd2VyIG51bWJlcnMgY29tZSBmcm9tIHNpbS9jYWxpYnJhdGVfcG93ZXIudHMuICovXG5leHBvcnQgY29uc3QgU1RBR0VTOiBTdGFnZURlZltdID0gW1xuICB7IGlkOiAnY3J5cHQnLCBuYW1lOiAnVGhlIFJlc3RsZXNzIENyeXB0JywgYmx1cmI6ICdSYWlzZSB5b3VyIGFybXkuIFRoZSBkZWFkIGhlcmUgYXJlIG9ubHkganVzdCBzdGlycmluZy4nLFxuICAgIGxpc3RzOiB7IGVhc3k6IERJRkZJQ1VMVFkuZWFzeSwgbm9ybWFsOiBESUZGSUNVTFRZLm5vcm1hbCwgaGFyZDogRElGRklDVUxUWS5oYXJkLCBuaWdodG1hcmU6IERJRkZJQ1VMVFkubmlnaHRtYXJlIH0sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLCBoYXJkOiAxLCBuaWdodG1hcmU6IDEgfSwgcmVjOiB7IGVhc3k6IDEsIG5vcm1hbDogMSwgaGFyZDogNCwgbmlnaHRtYXJlOiA2IH0gfSxcbiAgeyBpZDogJ2dyYXZleWFyZCcsIG5hbWU6ICdUaGUgU3Vua2VuIEdyYXZleWFyZCcsIGJsdXJiOiAnQmlnZ2VyIGNyb3dkcyBjcmF3bCBvdXQgb2YgdGhlIG11ZC4gTGV2ZWwgeW91ciBTb3VscyBiZWZvcmUgeW91IGNvbWUuJyxcbiAgICBsaXN0czogR1JBVkVZQVJELFxuICAgIHBvd2VyOiB7IGVhc3k6IDEsIG5vcm1hbDogMS4xNSwgaGFyZDogMC45NSwgbmlnaHRtYXJlOiAxLjE1IH0sIHJlYzogeyBlYXN5OiAyLCBub3JtYWw6IDQsIGhhcmQ6IDYsIG5pZ2h0bWFyZTogOCB9IH0sXG4gIHsgaWQ6ICdiYXN0aW9uJywgbmFtZTogJ1RoZSBCb25lIEJhc3Rpb24nLCBibHVyYjogJ0EgZm9ydHJlc3Mgb2YgdGhlIGZhbGxlbi4gT25seSB3ZWxsLWxldmVsbGVkIGFybWllcyBob2xkIHRoZSBnYXRlLicsXG4gICAgbGlzdHM6IEJBU1RJT04sXG4gICAgcG93ZXI6IHsgZWFzeTogMSwgbm9ybWFsOiAxLjAsIGhhcmQ6IDEuMjUsIG5pZ2h0bWFyZTogMS40IH0sIHJlYzogeyBlYXN5OiA0LCBub3JtYWw6IDYsIGhhcmQ6IDgsIG5pZ2h0bWFyZTogMTAgfSB9LFxuXTtcbmV4cG9ydCBjb25zdCBzdGFnZUluZGV4ID0gKGlkOiBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMCwgU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gaWQpKTtcbmV4cG9ydCBjb25zdCBzdGFnZUJ5SWQgPSAoaWQ6IHN0cmluZyk6IFN0YWdlRGVmID0+IFNUQUdFU1tzdGFnZUluZGV4KGlkKV07XG5cbi8qKiBOYW1lcyBhbmQgb25lLWxpbmUgcHJvbWlzZXMgZm9yIHRoZSBkaWZmaWN1bHR5IHBpY2tlci4gKi9cbmV4cG9ydCBjb25zdCBESUZGSUNVTFRZX0lORk8gPSBbXG4gIHsgaWQ6ICdlYXN5JywgbGFiZWw6ICdFYXN5JywgYmx1cmI6ICdTbWFsbGVyIGVuZW15IGFybWllcy4gUmVsYXggYW5kIGxlYXJuIGhvdyBtZXJnaW5nIHdvcmtzLicgfSxcbiAgeyBpZDogJ25vcm1hbCcsIGxhYmVsOiAnTm9ybWFsJywgYmx1cmI6ICdUaGUgc3RhbmRhcmQgZmlnaHQuIENsZWFyaW5nIGl0IHVubG9ja3MgSGFyZCBhbmQgdGhlIG5leHQgc3RhZ2UuJyB9LFxuICB7IGlkOiAnaGFyZCcsIGxhYmVsOiAnSGFyZCcsIGJsdXJiOiAnQmlnZ2VyIGFybWllcyB3aXRoIG1vcmUgZm9kZGVyLiBCZXR0ZXIgZmlyc3QtY2xlYXIgcmV3YXJkcy4gQ2xlYXJpbmcgaXQgdW5sb2NrcyBOaWdodG1hcmUuJyB9LFxuICB7IGlkOiAnbmlnaHRtYXJlJywgbGFiZWw6ICdOaWdodG1hcmUnLCBibHVyYjogJ0EgcGFja2VkIGJhdHRsZWZpZWxkIG9mIHN0YXJzIGFuZCBza2lsbHMuIEJ1aWx0IGZvciB3ZWxsLWxldmVsbGVkIFNvdWxzLicgfSxcbl07XG5cbi8vIC0tLS0gd2hhdCB0aGUgbmV4dCBiYXR0bGUgdXNlcyAoc2V0IHdoZW4gYSBydW4gc3RhcnRzKVxuZXhwb3J0IGxldCBkaWZmaWN1bHR5TmFtZTogc3RyaW5nID0gJ25vcm1hbCc7XG5leHBvcnQgbGV0IGN1cnJlbnRTdGFnZUlkOiBzdHJpbmcgPSAnY3J5cHQnO1xubGV0IHBvd2VyID0gMSwgZW5kbGVzc01vZGUgPSBmYWxzZSwgYm9zc1N0ciA9IDE7XG4vKiogSG93IGhhcmQgdGhlIGJvc3MgaGl0cyBmb3IgdGhlIGN1cnJlbnQgbW9kZSAoMCA9IGFuIG9yZGluYXJ5IHVuaXQsIDEgPSB0aGUgZnVsbCBib3NzKTogZ2VudGxlIG9uIEVhc3ksIGZ1bGwgb24gTmlnaHRtYXJlIGFuZCBpbiBFbmRsZXNzLiAqL1xuZXhwb3J0IGNvbnN0IGJvc3NTdHJlbmd0aCA9ICgpOiBudW1iZXIgPT4gYm9zc1N0cjtcbmNvbnN0IEJPU1NfQllfVElFUjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHsgZWFzeTogMC4yLCBub3JtYWw6IDAuNSwgaGFyZDogMC44LCBuaWdodG1hcmU6IDEgfTtcbmxldCBkYWlseVJld3JpdGU6ICgodzogRW5lbXlTcGVjW10sIHdhdmU6IG51bWJlcikgPT4gRW5lbXlTcGVjW10pIHwgbnVsbCA9IG51bGw7ICAgLy8gc2V0IG9ubHkgZHVyaW5nIGEgRGFpbHkgQ2hhbGxlbmdlIHJ1blxuLyoqIEVuZW15IGhlYWx0aC9kYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGN1cnJlbnQgc3RhZ2UgYW5kIHRpZXIgKGluIGVuZGxlc3MgbW9kZSBpdCBkZXBlbmRzIG9uIHRoZSB3YXZlKS4gKi9cbmV4cG9ydCBjb25zdCBlbmVteVBvd2VyID0gKHdhdmUgPSAxKTogbnVtYmVyID0+IChlbmRsZXNzTW9kZSA/IGVuZGxlc3NQb3dlcih3YXZlKSA6IHBvd2VyKTtcbmV4cG9ydCBjb25zdCBpc0VuZGxlc3MgPSAoKTogYm9vbGVhbiA9PiBlbmRsZXNzTW9kZTtcblxuLyoqIEhhbmQtYXV0aG9yZWQgd2F2ZXMgZm9yIHRoZSBjdXJyZW50IHN0YWdlIGFuZCB0aWVyICgxMCB3YXZlcykuIEVkaXRlZCBpbiBwbGFjZSBieSBzZXRTdGFnZURpZmZpY3VsdHkuICovXG5leHBvcnQgY29uc3QgQVVUSE9SRUQ6IEVuZW15U3BlY1tdW10gPSBESUZGSUNVTFRZLm5vcm1hbC5tYXAocGFyc2VXYXZlKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFN0YWdlRGlmZmljdWx0eShzdGFnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBzdGFnZUJ5SWQoc3RhZ2UpOyBpZiAoIURJRkZTLmluY2x1ZGVzKG5hbWUgYXMgRGlmZikpIHJldHVybjtcbiAgZW5kbGVzc01vZGUgPSBmYWxzZTsgZGFpbHlSZXdyaXRlID0gbnVsbDsgYm9zc1N0ciA9IEJPU1NfQllfVElFUltuYW1lXSA/PyAwLjU7IGN1cnJlbnRTdGFnZUlkID0gc3QuaWQ7IGRpZmZpY3VsdHlOYW1lID0gbmFtZTsgcG93ZXIgPSBzdC5wb3dlcltuYW1lIGFzIERpZmZdO1xuICBBVVRIT1JFRC5sZW5ndGggPSAwOyBzdC5saXN0c1tuYW1lIGFzIERpZmZdLmZvckVhY2goKHcpID0+IEFVVEhPUkVELnB1c2gocGFyc2VXYXZlKHcpKSk7XG59XG4vKiogU3dpdGNoIHRvIHRoZSBEYWlseSBDaGFsbGVuZ2U6IFN0YWdlIDEgTm9ybWFsIHdpdGggdGhlIGRheSdzIHR3aXN0IChzZWUgY29yZS9kYWlseS50cykuIGBkYXlgIGlzIGtlcHQgYXMgdGhlICdkaWZmaWN1bHR5JyBzbyBhIHNhdmVkIHJ1biBjYW4gcmVidWlsZCB0aGUgc2FtZSBkYXkuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0RGFpbHkobW9kOiB7IHBvd2VyOiBudW1iZXI7IGVuZW15PzogKHc6IEVuZW15U3BlY1tdLCB3YXZlOiBudW1iZXIpID0+IEVuZW15U3BlY1tdIH0sIGRheTogbnVtYmVyKTogdm9pZCB7XG4gIHNldFN0YWdlRGlmZmljdWx0eSgnY3J5cHQnLCAnbm9ybWFsJyk7IGRhaWx5UmV3cml0ZSA9IG1vZC5lbmVteSA/PyBudWxsOyBjdXJyZW50U3RhZ2VJZCA9ICdkYWlseSc7IGRpZmZpY3VsdHlOYW1lID0gU3RyaW5nKGRheSk7IHBvd2VyID0gbW9kLnBvd2VyO1xufVxuLyoqIFN3aXRjaCB0byBFbmRsZXNzIERlcHRoczogd2F2ZXMgY29tZSBmcm9tIGNvcmUvZW5kbGVzcy50cyBpbnN0ZWFkIG9mIGEgc3RhZ2UgbGlzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRFbmRsZXNzKCk6IHZvaWQgeyBlbmRsZXNzTW9kZSA9IHRydWU7IGRhaWx5UmV3cml0ZSA9IG51bGw7IGJvc3NTdHIgPSAxOyBjdXJyZW50U3RhZ2VJZCA9IEVORExFU1NfSUQ7IGRpZmZpY3VsdHlOYW1lID0gJ2VuZGxlc3MnOyBwb3dlciA9IDE7IEFVVEhPUkVELmxlbmd0aCA9IDA7IH1cbi8qKiBDaGFuZ2UgdGhlIHRpZXIgd2l0aGluIHRoZSBjdXJyZW50IHN0YWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldERpZmZpY3VsdHkobmFtZTogc3RyaW5nKTogdm9pZCB7IHNldFN0YWdlRGlmZmljdWx0eShjdXJyZW50U3RhZ2VJZCwgbmFtZSk7IH1cblxuZXhwb3J0IGNvbnN0IHdhdmVDb3N0ID0gKHc6IEVuZW15U3BlY1tdKTogbnVtYmVyID0+IHcucmVkdWNlKChuLCBlKSA9PiBuICsgQ09TVFtlLnNvdWxdW2Uuc3RhciAtIDFdLCAwKTtcblxuLyoqIFRoZSBsYXN0IHdhdmUgb2YgYSBzdGFnZSBoYXMgYSBCT1NTOiBpdHMgYmlnZ2VzdCB1bml0IChhIGJydXRlIGlmIHRoZXJlIGlzIG9uZSkgZ2V0cyBleHRyYSBoZWFsdGgsIGRhbWFnZSBhbmQgc2l6ZSAoc2VlIEJPU1MgaW4gYmF0dGxlLnRzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXJrQm9zcyh3OiBFbmVteVNwZWNbXSk6IEVuZW15U3BlY1tdIHtcbiAgbGV0IGJlc3QgPSAtMSwgYnMgPSAtMTtcbiAgdy5mb3JFYWNoKChlLCBpKSA9PiB7IGNvbnN0IGJydXRlID0gZS5zb3VsID09PSAnb2dyZScgfHwgZS5zb3VsID09PSAna25pZ2h0JyB8fCBlLnNvdWwgPT09ICdiYXJiYXJpYW4nID8gMTAwIDogMCwgc2MgPSBicnV0ZSArIENPU1RbZS5zb3VsXVtlLnN0YXIgLSAxXTsgaWYgKHNjID4gYnMpIHsgYnMgPSBzYzsgYmVzdCA9IGk7IH0gfSk7XG4gIGlmIChiZXN0ID49IDApIHdbYmVzdF0gPSB7IC4uLndbYmVzdF0sIGJvc3M6IHRydWUgfTtcbiAgcmV0dXJuIHc7XG59XG4vKiogRW5lbXkgYXJteSBmb3IgYSB3YXZlICgxLWJhc2VkKS4gV2F2ZXMgcGFzdCB0aGUgYXV0aG9yZWQgb25lcyBhcmUgZ2VuZXJhdGVkIGZyb20gYSBmaXhlZCBzZWVkIHNvIHJldHJpZXMgZmFjZSB0aGUgc2FtZSBhcm15LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZW15V2F2ZSh3YXZlOiBudW1iZXIsIHN0YWdlU2VlZCA9IDApOiBFbmVteVNwZWNbXSB7XG4gIGlmIChlbmRsZXNzTW9kZSkgcmV0dXJuIGVuZGxlc3NXYXZlKHdhdmUsIHN0YWdlU2VlZCk7XG4gIGlmICh3YXZlIDw9IEFVVEhPUkVELmxlbmd0aCkgeyBsZXQgdyA9IEFVVEhPUkVEW3dhdmUgLSAxXS5tYXAoKGUpID0+ICh7IC4uLmUgfSkpOyBpZiAoZGFpbHlSZXdyaXRlKSB3ID0gZGFpbHlSZXdyaXRlKHcsIHdhdmUpOyByZXR1cm4gd2F2ZSA9PT0gQVVUSE9SRUQubGVuZ3RoID8gbWFya0Jvc3ModykgOiB3OyB9XG4gIGNvbnN0IGNhcCA9IENVUlZFUy5kb2NbTWF0aC5taW4od2F2ZSwgQ1VSVkVTLmRvYy5sZW5ndGgpIC0gMV07XG4gIGNvbnN0IGJ1ZGdldCA9IE1hdGgucm91bmQoY2FwICogMC45Mik7XG4gIGNvbnN0IHJuZyA9IG1ha2VSbmcoc3RhZ2VTZWVkICogMTAwOSArIHdhdmUgKiA3OTE5KTtcbiAgY29uc3QgYXJteTogRW5lbXlTcGVjW10gPSBbXTtcbiAgbGV0IGxlZnQgPSBidWRnZXQ7XG4gIGZvciAobGV0IGd1YXJkID0gMDsgZ3VhcmQgPCA0MCAmJiBsZWZ0ID49IDI7IGd1YXJkKyspIHtcbiAgICBjb25zdCBzb3VsID0gcm5nLnBpY2soU09VTFMpO1xuICAgIGxldCBzdGFyID0gMTtcbiAgICBpZiAocm5nLm5leHQoKSA8IDAuMzUgJiYgQ09TVFtzb3VsXVsxXSA8PSBsZWZ0KSBzdGFyID0gMjtcbiAgICBpZiAod2F2ZSA+PSA2ICYmIHJuZy5uZXh0KCkgPCAwLjI1ICYmIENPU1Rbc291bF1bMl0gPD0gbGVmdCkgc3RhciA9IDM7XG4gICAgY29uc3QgYyA9IENPU1Rbc291bF1bc3RhciAtIDFdO1xuICAgIGlmIChjIDw9IGxlZnQgJiYgYXJteS5sZW5ndGggPCAxMikgeyBhcm15LnB1c2goeyBzb3VsLCBzdGFyIH0pOyBsZWZ0IC09IGM7IH1cbiAgfVxuICByZXR1cm4gYXJteTtcbn1cblxuLyoqIFdoYXQgdGhlIGJ1aWxkIHNjcmVlbiBzaG93czogY291bnRzIHBlciBTb3VsIGFuZCBzdGFyLCBubyBwb3NpdGlvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcHJldmlld1RleHQodzogRW5lbXlTcGVjW10pOiB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjb3VudDogbnVtYmVyOyBib3NzPzogYm9vbGVhbiB9W10ge1xuICBjb25zdCBtYXAgPSBuZXcgTWFwPHN0cmluZywgeyBzb3VsOiBTb3VsSWQ7IHN0YXI6IG51bWJlcjsgY291bnQ6IG51bWJlcjsgYm9zcz86IGJvb2xlYW4gfT4oKTtcbiAgZm9yIChjb25zdCBlIG9mIHcpIHtcbiAgICBjb25zdCBrID0gZS5zb3VsICsgZS5zdGFyICsgKGUuYm9zcyA/ICdCJyA6ICcnKTtcbiAgICBjb25zdCBjdXIgPSBtYXAuZ2V0KGspO1xuICAgIGlmIChjdXIpIGN1ci5jb3VudCsrOyBlbHNlIG1hcC5zZXQoaywgeyBzb3VsOiBlLnNvdWwsIHN0YXI6IGUuc3RhciwgY291bnQ6IDEsIGJvc3M6IGUuYm9zcyB9KTtcbiAgfVxuICByZXR1cm4gWy4uLm1hcC52YWx1ZXMoKV07XG59XG4iLCAiLy8gQXV0by1iYXR0bGUgc2ltdWxhdGlvbjogcHVyZSBsb2dpYywgbm8gZ3JhcGhpY3MuIERldGVybWluaXN0aWMgZm9yIGEgZ2l2ZW4gc2VlZC5cbi8vIFRoZSByZW5kZXJlciBvbmx5IHJlYWRzIGZpZ2h0ZXJzICsgZXZlbnRzOyBpdCBuZXZlciBkZWNpZGVzIGFueXRoaW5nLlxuLy9cbi8vIEFiaWxpdGllcyAobnVtYmVycyBsaXZlIGluIGJhbGFuY2UudHMpOlxuLy8gICBTa2VsZXRvbiBXYXJyaW9yICBQaGFsYW54ICAgICB0YWtlcyBsZXNzIGRhbWFnZSBmb3IgZWFjaCBuZWFyYnkgYWxsaWVkIFdhcnJpb3IgKGNhcHBlZClcbi8vICAgU2tlbGV0b24gQXJjaGVyICAgU3BsaXQgQXJyb3cgKHNraWxsKSBvbmUgYXJyb3cgYXQgZWFjaCBvZiB1cCB0byAzIGRpZmZlcmVudCBlbmVtaWVzOyBiYXNpYyBzaG90cyBhcmUgYSBzaW5nbGUgYXJyb3dcbi8vICAgR29ibGluICAgICAgICAgICAgT3Bwb3J0dW5pc3QgK2RhbWFnZSBvbiBhbiBlbmVteSB0aGF0IGlzIGZpZ2h0aW5nIHNvbWVvbmUgZWxzZTsgcHJlZmVycyBzdWNoIHRhcmdldHNcbi8vICAgS25pZ2h0ICAgICAgICAgICAgVGF1bnQgKHNraWxsKSAgZm9yY2VzIG5lYXJieSBlbmVtaWVzIHRvIGF0dGFjayBoaW1cbi8vICAgT2dyZSAgICAgICAgICAgICAgU21hc2ggKHNraWxsKSAgaGVhdnkgc2xhbSB0aGF0IGFsc28gaGl0cyBlbmVtaWVzIG5lYXIgdGhlIGltcGFjdFxuLy8gU2tpbGxzIHJ1biBvbiBtYW5hOiBiYXNpYyBhdHRhY2tzIGFuZCBkYW1hZ2UgdGFrZW4gZmlsbCBhIGJhcjsgd2hlbiBmdWxsLCB0aGUgbmV4dCBhdHRhY2sgaXMgdGhlIHNraWxsIGFuZCB0aGUgYmFyIHJlc2V0cy5cbi8vIFdhcnJpb3IsIEdvYmxpbiBhbmQgQmFyYmFyaWFuIGhhdmUgcGFzc2l2ZXMgb25seSAobm8gbWFuYSkuXG4vLyAgIEJhcmJhcmlhbiAgICAgICAgIEZyZW56eSAgICAgIGF0dGFja3MgZmFzdGVyIHdpdGggZXZlcnkgdW5pbnRlcnJ1cHRlZCBzd2luZ1xuXG5pbXBvcnQgeyBHUklEX0NPTFMsIEdSSURfUk9XUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi9iYWxhbmNlLnRzJztcbmltcG9ydCB7IGJvc3NTdHJlbmd0aCB9IGZyb20gJy4vd2F2ZXMudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgY29uc3QgR1JJRF9TUCA9IDEuMzsgICAgIC8vIG1ldHJlcyBiZXR3ZWVuIGdyaWQgY2VsbHNcbmV4cG9ydCBjb25zdCBGUk9OVF9YID0gMS43OyAgICAgLy8gZnJvbnQgbGluZSdzIGRpc3RhbmNlIGZyb20gdGhlIGNlbnRyZSBsaW5lXG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xvdCB7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBTcGVjIHsgc291bDogU291bElkOyBzdGFyOiBudW1iZXIgfVxuXG4vKiogV29ybGQgcG9zaXRpb24gb2YgYSBncmlkIGNlbGwgZm9yIGEgdGVhbSAodGVhbSAwID0gbGVmdCwgZmFjZXMgK1g7IHRlYW0gMSA9IHJpZ2h0LCBmYWNlcyAtWCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2VsbFBvcyh0ZWFtOiAwIHwgMSwgY2VsbDogbnVtYmVyKTogeyB4OiBudW1iZXI7IHo6IG51bWJlciB9IHtcbiAgY29uc3Qgcm93ID0gTWF0aC5mbG9vcihjZWxsIC8gR1JJRF9DT0xTKSwgY29sID0gY2VsbCAlIEdSSURfQ09MUztcbiAgY29uc3QgZGVwdGggPSBHUklEX0NPTFMgLSAxIC0gY29sOyAgICAgICAgICAgICAgICAgICAgICAgLy8gMCA9IGZyb250IGxpbmVcbiAgcmV0dXJuIHsgeDogKEZST05UX1ggKyBkZXB0aCAqIEdSSURfU1ApICogKHRlYW0gPT09IDAgPyAtMSA6IDEpLCB6OiAocm93IC0gKEdSSURfUk9XUyAtIDEpIC8gMikgKiBHUklEX1NQIH07XG59XG5cbmNvbnN0IEZST05UTkVTUzogUmVjb3JkPFNvdWxJZCwgbnVtYmVyPiA9IHsga25pZ2h0OiA1LCBvZ3JlOiA0LCB3YXJyaW9yOiAzLCBiYXJiYXJpYW46IDMsIGdvYmxpbjogMiwgYXJjaGVyOiAwIH07XG4vKiogVGhlIGVuZW15IGFybXkgaXMgcGxhY2VkIGF1dG9tYXRpY2FsbHkgKHRhbmtzIHVwIGZyb250LCBhcmNoZXJzIGJlaGluZCk7IHRoZSBwbGF5ZXIgb25seSBldmVyIHNlZXMgaXRzIGNvbXBvc2l0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZW15Q2VsbHMoc3BlY3M6IFNwZWNbXSk6IG51bWJlcltdIHtcbiAgY29uc3QgY2VsbHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DT0xTICogR1JJRF9ST1dTOyBjKyspIGNlbGxzLnB1c2goYyk7XG4gIGNlbGxzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBkYSA9IEdSSURfQ09MUyAtIDEgLSAoYSAlIEdSSURfQ09MUyksIGRiID0gR1JJRF9DT0xTIC0gMSAtIChiICUgR1JJRF9DT0xTKTtcbiAgICBpZiAoZGEgIT09IGRiKSByZXR1cm4gZGEgLSBkYjtcbiAgICByZXR1cm4gTWF0aC5hYnMoTWF0aC5mbG9vcihhIC8gR1JJRF9DT0xTKSAtIDEpIC0gTWF0aC5hYnMoTWF0aC5mbG9vcihiIC8gR1JJRF9DT0xTKSAtIDEpO1xuICB9KTtcbiAgY29uc3Qgb3JkZXIgPSBzcGVjcy5tYXAoKHMsIGkpID0+IGkpLnNvcnQoKGksIGopID0+IEZST05UTkVTU1tzcGVjc1tqXS5zb3VsXSAtIEZST05UTkVTU1tzcGVjc1tpXS5zb3VsXSk7XG4gIGNvbnN0IG91dCA9IG5ldyBBcnJheTxudW1iZXI+KHNwZWNzLmxlbmd0aCk7XG4gIG9yZGVyLmZvckVhY2goKGlkeCwgaykgPT4geyBvdXRbaWR4XSA9IGNlbGxzW2tdOyB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IHR5cGUgRlN0YXRlID0gJ2lkbGUnIHwgJ3J1bicgfCAnYXR0YWNrJyB8ICdkZWFkJztcbi8qKiBBIGJvc3MgaXMgb25lIGVuZW15IHdpdGggZXh0cmEgaGVhbHRoIGFuZCBkYW1hZ2UsIGFuZCBtb3JlIHNpemUuICovXG5leHBvcnQgY29uc3QgQk9TUyA9IHsgaHA6IDAuNiwgZG1nOiAwLjIsIHNpemU6IDEuMyB9OyAgIC8vIHNpemUgaXMgdGhlIGxvb2sgb25seSAoZ2FtZS92aXN1YWxzLnRzKSAgICAgLy8gZXh0cmFzIGF0IGZ1bGwgc3RyZW5ndGggKHNlZSBib3NzU3RyZW5ndGggaW4gd2F2ZXMudHMpXG5leHBvcnQgaW50ZXJmYWNlIEZpZ2h0ZXIge1xuICBib3NzPzogYm9vbGVhbjtcbiAgaWQ6IG51bWJlcjsgdGVhbTogMCB8IDE7IHNvdWw6IFNvdWxJZDsgc3RhcjogbnVtYmVyOyBjZWxsOiBudW1iZXI7XG4gIHg6IG51bWJlcjsgejogbnVtYmVyOyB5YXc6IG51bWJlcjtcbiAgaHA6IG51bWJlcjsgbWF4SHA6IG51bWJlcjsgZG1nOiBudW1iZXI7IGludGVydmFsOiBudW1iZXI7IHJhbmdlOiBudW1iZXI7IHNwZWVkOiBudW1iZXI7IHJhZGl1czogbnVtYmVyO1xuICBhbGl2ZTogYm9vbGVhbjsgc3RhdGU6IEZTdGF0ZTtcbiAgdGFyZ2V0OiBudW1iZXI7IHJldGFyZ2V0QXQ6IG51bWJlcjsgZm9yY2VkVGFyZ2V0OiBudW1iZXI7IGZvcmNlZFVudGlsOiBudW1iZXI7XG4gIG5leHRBdHRhY2s6IG51bWJlcjsgYXR0YWNrU3RhcnQ6IG51bWJlcjsgYXR0YWNrRHVyOiBudW1iZXI7IGFuaW1TcGVlZDogbnVtYmVyOyBoaXREb25lOiBib29sZWFuO1xuICBtYW5hOiBudW1iZXI7IG1heE1hbmE6IG51bWJlcjsgY2FzdGluZzogYm9vbGVhbjsgZnJlbnp5OiBudW1iZXI7IGRlYWRBdDogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBCRXZlbnQgPVxuICB8IHsgdDogJ3N3aW5nJzsgaWQ6IG51bWJlcjsgc3BlZWQ6IG51bWJlcjsgZHVyOiBudW1iZXIgfVxuICB8IHsgdDogJ2hpdCc7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZG1nOiBudW1iZXI7IGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyB9XG4gIHwgeyB0OiAnYXJyb3cnOyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGR1cjogbnVtYmVyIH1cbiAgfCB7IHQ6ICdkZWF0aCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ2Nhc3QnOyBpZDogbnVtYmVyOyBza2lsbDogJ3NwbGl0JyB8ICd0YXVudCcgfCAnc21hc2gnIH1cbiAgfCB7IHQ6ICd0YXVudCc7IGlkOiBudW1iZXIgfVxuICB8IHsgdDogJ3NtYXNoJzsgaWQ6IG51bWJlcjsgeDogbnVtYmVyOyB6OiBudW1iZXI7IHI6IG51bWJlciB9XG4gIHwgeyB0OiAnZnJlbnp5JzsgaWQ6IG51bWJlcjsgc3RhY2tzOiBudW1iZXIgfTtcblxuZXhwb3J0IGNsYXNzIEJhdHRsZSB7XG4gIHRpbWUgPSAwO1xuICBmaWdodGVyczogRmlnaHRlcltdID0gW107XG4gIGV2ZW50czogQkV2ZW50W10gPSBbXTtcbiAgd2lubmVyOiAtMSB8IDAgfCAxID0gLTE7XG4gIHJuZzogUm5nO1xuICBwcml2YXRlIHBlbmRpbmc6IHsgYXQ6IG51bWJlcjsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyOyBkbWc6IG51bWJlciB9W10gPSBbXTtcbiAgcHJpdmF0ZSBuZXh0SWQgPSAxO1xuICBwcml2YXRlIGVuZW15UG93ZXIgPSAxO1xuICBwcml2YXRlIGZsaXAgPSBmYWxzZTtcblxuICAvKiogYGxldmVsc2A6IHRoZSBwbGF5ZXIncyBwZXJtYW5lbnQgU291bCBsZXZlbHMgKGhlYWx0aCBhbmQgZGFtYWdlIGdyb3cgYSBsaXR0bGUgcGVyIGxldmVsKS4gRW5lbWllcyBuZXZlciB1c2UgdGhlbS4gKi9cbiAgLyoqIGBlbmVteVBvd2VyYDogaGVhbHRoIGFuZCBkYW1hZ2UgbXVsdGlwbGllciBmb3IgdGhlIGVuZW15IHRlYW0gb25seSAoc3RhZ2Ugc3RyZW5ndGg7IDEgPSBhcyB3cml0dGVuKS4gKi9cbiAgY29uc3RydWN0b3IocGxheWVyczogU2xvdFtdLCBlbmVtaWVzOiBTcGVjW10sIHNlZWQgPSAxLCBsZXZlbHM/OiBQYXJ0aWFsPFJlY29yZDxTb3VsSWQsIG51bWJlcj4+LCBlbmVteVBvd2VyID0gMSkge1xuICAgIHRoaXMucm5nID0gbWFrZVJuZyhzZWVkKTsgdGhpcy5lbmVteVBvd2VyID0gZW5lbXlQb3dlcjtcbiAgICBmb3IgKGNvbnN0IHAgb2YgcGxheWVycykgdGhpcy5hZGQoMCwgcC5zb3VsLCBwLnN0YXIsIHAuY2VsbCwgbGV2ZWxzPy5bcC5zb3VsXSA/PyAxKTtcbiAgICBjb25zdCBjZWxscyA9IGVuZW15Q2VsbHMoZW5lbWllcyk7XG4gICAgZW5lbWllcy5mb3JFYWNoKChlLCBpKSA9PiB0aGlzLmFkZCgxLCBlLnNvdWwsIGUuc3RhciwgY2VsbHNbaV0sIDEsICEhZS5ib3NzKSk7XG4gIH1cblxuICBwcml2YXRlIGFkZCh0ZWFtOiAwIHwgMSwgc291bDogU291bElkLCBzdGFyOiBudW1iZXIsIGNlbGw6IG51bWJlciwgbGV2ZWwgPSAxLCBib3NzID0gZmFsc2UpOiBGaWdodGVyIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRSwgc3QgPSBCLnN0YXRzW3NvdWxdLCBwID0gY2VsbFBvcyh0ZWFtLCBjZWxsKTtcbiAgICBjb25zdCBsdkhwID0gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEIubGV2ZWwuaHAsIGx2RG1nID0gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEIubGV2ZWwuZG1nO1xuICAgIGNvbnN0IHB3ID0gdGVhbSA9PT0gMSA/IHRoaXMuZW5lbXlQb3dlciA6IDE7XG4gICAgY29uc3QgaHAgPSBzdC5ocCAqIEIuc3Rhci5ocFtzdGFyIC0gMV0gKiBsdkhwICogcHcgKiAoYm9zcyA/IDEgKyBCT1NTLmhwICogYm9zc1N0cmVuZ3RoKCkgOiAxKTtcbiAgICBjb25zdCBmOiBGaWdodGVyID0ge1xuICAgICAgaWQ6IHRoaXMubmV4dElkKyssIHRlYW0sIHNvdWwsIHN0YXIsIGNlbGwsIHg6IHAueCwgejogcC56LCB5YXc6IHRlYW0gPT09IDAgPyAwIDogTWF0aC5QSSxcbiAgICAgIGhwLCBtYXhIcDogaHAsIGRtZzogc3QuZG1nICogQi5zdGFyLmRtZ1tzdGFyIC0gMV0gKiBsdkRtZyAqIHB3ICogKGJvc3MgPyAxICsgQk9TUy5kbWcgKiBib3NzU3RyZW5ndGgoKSA6IDEpLCBpbnRlcnZhbDogc3QuaW50ZXJ2YWwsIHJhbmdlOiBzdC5yYW5nZSwgc3BlZWQ6IHN0LnNwZWVkLCByYWRpdXM6IHN0LnNpemUgKiBCLnN0YXIuc2NhbGVbc3RhciAtIDFdLCAgIC8vIChhIGJvc3Mgb25seSBMT09LUyBiaWdnZXI6IGEgbGFyZ2VyIGNvbGxpc2lvbiByYWRpdXMgd291bGQga2VlcCBtZWxlZSB1bml0cyBvdXQgb2YgcmVhY2gpXG4gICAgICBhbGl2ZTogdHJ1ZSwgc3RhdGU6ICdpZGxlJywgdGFyZ2V0OiAtMSwgcmV0YXJnZXRBdDogMCwgZm9yY2VkVGFyZ2V0OiAtMSwgZm9yY2VkVW50aWw6IDAsXG4gICAgICBuZXh0QXR0YWNrOiB0aGlzLnJuZy5uZXh0KCkgKiAwLjMsIGF0dGFja1N0YXJ0OiAtOSwgYXR0YWNrRHVyOiAxLCBhbmltU3BlZWQ6IDEsIGhpdEZyYWM6IDAsIGhpdERvbmU6IHRydWUsXG4gICAgICBtYW5hOiAwLCBtYXhNYW5hOiBCLm1hbmFbc291bF0/Lm1heCA/PyAwLCBjYXN0aW5nOiBmYWxzZSwgZnJlbnp5OiAwLCBkZWFkQXQ6IDAsIGJvc3MsXG4gICAgfSBhcyBGaWdodGVyO1xuICAgIHRoaXMuZmlnaHRlcnMucHVzaChmKTsgcmV0dXJuIGY7XG4gIH1cblxuICBieUlkKGlkOiBudW1iZXIpOiBGaWdodGVyIHwgdW5kZWZpbmVkIHsgcmV0dXJuIGlkIDwgMCA/IHVuZGVmaW5lZCA6IHRoaXMuZmlnaHRlcnNbaWQgLSAxXTsgfVxuICBmb2VzKGY6IEZpZ2h0ZXIpOiBGaWdodGVyW10geyByZXR1cm4gdGhpcy5maWdodGVycy5maWx0ZXIoKG8pID0+IG8uYWxpdmUgJiYgby50ZWFtICE9PSBmLnRlYW0pOyB9XG4gIGNvdW50KHRlYW06IDAgfCAxKTogbnVtYmVyIHsgcmV0dXJuIHRoaXMuZmlnaHRlcnMucmVkdWNlKChuLCBmKSA9PiBuICsgKGYuYWxpdmUgJiYgZi50ZWFtID09PSB0ZWFtID8gMSA6IDApLCAwKTsgfVxuICBkcmFpbigpOiBCRXZlbnRbXSB7IGNvbnN0IGUgPSB0aGlzLmV2ZW50czsgdGhpcy5ldmVudHMgPSBbXTsgcmV0dXJuIGU7IH1cblxuICBzdGVwKGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy53aW5uZXIgPj0gMCkgcmV0dXJuO1xuICAgIHRoaXMudGltZSArPSBkdDsgdGhpcy5mbGlwID0gIXRoaXMuZmxpcDtcbiAgICAvLyBhcnJvd3MgdGhhdCBoYXZlIGZpbmlzaGVkIGZseWluZ1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnBlbmRpbmcubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHAgPSB0aGlzLnBlbmRpbmdbaV07XG4gICAgICBpZiAodGhpcy50aW1lID49IHAuYXQpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nLnNwbGljZShpLCAxKTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLmJ5SWQocC50byksIGZyb20gPSB0aGlzLmJ5SWQocC5mcm9tKTtcbiAgICAgICAgaWYgKHRvICYmIHRvLmFsaXZlICYmIGZyb20pIHRoaXMuZGFtYWdlKHRvLCBwLmRtZywgZnJvbSwgJ2Fycm93Jyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG9yZGVyID0gdGhpcy5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUpOyBpZiAodGhpcy5mbGlwKSBvcmRlci5yZXZlcnNlKCk7XG4gICAgZm9yIChjb25zdCBmIG9mIG9yZGVyKSBpZiAoZi5hbGl2ZSkgdGhpcy51cGRhdGUoZiwgZHQpO1xuICAgIGNvbnN0IGEgPSB0aGlzLmNvdW50KDApLCBiID0gdGhpcy5jb3VudCgxKTtcbiAgICBpZiAoIWEgfHwgIWIpIHRoaXMud2lubmVyID0gYSA/IDAgOiAxO1xuICAgIGVsc2UgaWYgKHRoaXMudGltZSA+PSBCQUxBTkNFLnNpbS50aW1lTGltaXQpIHtcbiAgICAgIGNvbnN0IGhwID0gKHQ6IDAgfCAxKSA9PiB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigoZikgPT4gZi5hbGl2ZSAmJiBmLnRlYW0gPT09IHQpLnJlZHVjZSgobiwgZikgPT4gbiArIGYuaHAgLyBmLm1heEhwLCAwKTtcbiAgICAgIHRoaXMud2lubmVyID0gaHAoMCkgPiBocCgxKSA/IDAgOiAxO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwZXItZmlnaHRlciB1cGRhdGVcbiAgcHJpdmF0ZSB1cGRhdGUoZjogRmlnaHRlciwgZHQ6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFLCBzdCA9IEIuc3RhdHNbZi5zb3VsXTtcbiAgICB0aGlzLnNlcGFyYXRlKGYsIGR0KTtcblxuICAgIGlmIChmLnN0YXRlID09PSAnYXR0YWNrJykge1xuICAgICAgY29uc3QgdCA9IHRoaXMudGltZSAtIGYuYXR0YWNrU3RhcnQ7XG4gICAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7IGlmICh0ZyAmJiB0Zy5hbGl2ZSkgdGhpcy5mYWNlKGYsIHRnLnggLSBmLngsIHRnLnogLSBmLnosIGR0KTtcbiAgICAgIGlmICghZi5oaXREb25lICYmIHQgPj0gZi5hdHRhY2tEdXIgKiBzdC5oaXRGcmFjKSB7IGYuaGl0RG9uZSA9IHRydWU7IHRoaXMucmVzb2x2ZUhpdChmKTsgfVxuICAgICAgaWYgKHQgPj0gZi5hdHRhY2tEdXIpIGYuc3RhdGUgPSAnaWRsZSc7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYWNxdWlyZShmKTtcbiAgICBjb25zdCB0ZyA9IHRoaXMuYnlJZChmLnRhcmdldCk7XG4gICAgaWYgKCF0ZyB8fCAhdGcuYWxpdmUpIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgcmV0dXJuOyB9XG4gICAgY29uc3QgZHggPSB0Zy54IC0gZi54LCBkeiA9IHRnLnogLSBmLnosIGRpc3QgPSBNYXRoLmh5cG90KGR4LCBkeik7XG4gICAgdGhpcy5mYWNlKGYsIGR4LCBkeiwgZHQpO1xuICAgIGlmIChkaXN0IDw9IGYucmFuZ2UpIHtcbiAgICAgIGlmICh0aGlzLnRpbWUgPj0gZi5uZXh0QXR0YWNrKSB0aGlzLnN0YXJ0QXR0YWNrKGYpOyBlbHNlIHsgZi5zdGF0ZSA9ICdpZGxlJzsgdGhpcy5mcmVuenlEZWNheShmKTsgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmLnN0YXRlID0gJ3J1bic7IGxldCBteCA9IGR4IC8gTWF0aC5tYXgoZGlzdCwgMWUtNCksIG16ID0gZHogLyBNYXRoLm1heChkaXN0LCAxZS00KTtcbiAgICAgIC8vIHdhbGsgQVJPVU5EIGFueW9uZSBzdGFuZGluZyBpbiB0aGUgd2F5IChhbGxpZXMgYW5kIGVuZW1pZXMgYWxpa2UsIGV4Y2VwdCB0aGUgdGFyZ2V0KTogZWFjaCBibG9ja2VyIGFoZWFkIGJlbmRzIHRoZSBoZWFkaW5nIGF3YXkgZnJvbSBpdFxuICAgICAgbGV0IHN4ID0gMCwgc3ogPSAwO1xuICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZmlnaHRlcnMpIHtcbiAgICAgICAgaWYgKG8gPT09IGYgfHwgIW8uYWxpdmUgfHwgby5pZCA9PT0gdGcuaWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBveCA9IG8ueCAtIGYueCwgb3ogPSBvLnogLSBmLnosIGFsb25nID0gb3ggKiBteCArIG96ICogbXosIHJlYWNoID0gZi5yYWRpdXMgKyBvLnJhZGl1cyArIDAuMzU7XG4gICAgICAgIGlmIChhbG9uZyA8PSAwIHx8IGFsb25nID4gcmVhY2ggKyAwLjkpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBsYXQgPSBveCAqIC1teiArIG96ICogbXgsIG5lZWQgPSBmLnJhZGl1cyArIG8ucmFkaXVzICsgMC4xMjsgaWYgKE1hdGguYWJzKGxhdCkgPj0gbmVlZCkgY29udGludWU7XG4gICAgICAgIGNvbnN0IHNpZGUgPSBsYXQgPT09IDAgPyAoZi5pZCAlIDIgPyAxIDogLTEpIDogKGxhdCA+IDAgPyAtMSA6IDEpLCB3ID0gKDEgLSBNYXRoLmFicyhsYXQpIC8gbmVlZCkgKiAoMSAtIE1hdGgubWF4KDAsIGFsb25nIC0gcmVhY2gpIC8gMC45KTtcbiAgICAgICAgc3ggKz0gLW16ICogc2lkZSAqIHcgKiAxLjY7IHN6ICs9IG14ICogc2lkZSAqIHcgKiAxLjY7XG4gICAgICB9XG4gICAgICBpZiAoc3ggfHwgc3opIHsgbXggKz0gc3g7IG16ICs9IHN6OyBjb25zdCBsID0gTWF0aC5oeXBvdChteCwgbXopIHx8IDE7IG14IC89IGw7IG16IC89IGw7IH1cbiAgICAgIGYueCArPSBteCAqIGYuc3BlZWQgKiBkdDsgZi56ICs9IG16ICogZi5zcGVlZCAqIGR0OyB0aGlzLmZyZW56eURlY2F5KGYpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZnJlbnp5RGVjYXkoZjogRmlnaHRlcik6IHZvaWQge1xuICAgIGlmIChmLnNvdWwgPT09ICdiYXJiYXJpYW4nICYmIGYuZnJlbnp5ID4gMCAmJiB0aGlzLnRpbWUgLSAoZi5hdHRhY2tTdGFydCArIGYuYXR0YWNrRHVyKSA+IEJBTEFOQ0UuZnJlbnp5LnJlc2V0QWZ0ZXIpIGYuZnJlbnp5ID0gMDtcbiAgfVxuXG4gIHByaXZhdGUgZmFjZShmOiBGaWdodGVyLCBkeDogbnVtYmVyLCBkejogbnVtYmVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKGR4ICogZHggKyBkeiAqIGR6IDwgMWUtNikgcmV0dXJuO1xuICAgIGNvbnN0IHdhbnQgPSBNYXRoLmF0YW4yKGR4LCBkeik7IGxldCBkID0gKCh3YW50IC0gZi55YXcgKyBNYXRoLlBJKSAlICgyICogTWF0aC5QSSkgKyAyICogTWF0aC5QSSkgJSAoMiAqIE1hdGguUEkpIC0gTWF0aC5QSTtcbiAgICBmLnlhdyArPSBNYXRoLm1heCgtOSAqIGR0LCBNYXRoLm1pbig5ICogZHQsIGQpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBLZWVwIGZpZ2h0ZXJzIGZyb20gc3RhY2tpbmcgd2l0aG91dCBzaG92aW5nIGFueW9uZSBhY3Jvc3MgdGhlIG1hcC5cbiAgICogLSBBIGZpZ2h0ZXIgdGhhdCBpcyBzdGFuZGluZyBhbmQgZmlnaHRpbmcgaXMgXCJwbGFudGVkXCI6IGl0IGJhcmVseSBtb3ZlczsgdGhlIG9uZXMgc3RpbGwgV0FMS0lORyB5aWVsZCB0byBpdC5cbiAgICogLSBIZWF2aWVyIHVuaXRzIChPZ3JlLCBLbmlnaHQpIHB1c2ggbGlnaHRlciBvbmVzIG1vcmUgdGhhbiB0aGUgb3RoZXIgd2F5IHJvdW5kLlxuICAgKiAtIFRoZSB0b3RhbCBwdXNoIG9uIG9uZSBmaWdodGVyIGlzIGNhcHBlZCBwZXIgc2Vjb25kLCBzbyBhIGNyb3dkIGNhbiBuZXZlciBzbGlkZSBhIHVuaXQgZmFyLlxuICAgKi9cbiAgcHJpdmF0ZSBzZXBhcmF0ZShmOiBGaWdodGVyLCBkdDogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgcGxhbnRlZCA9ICh1OiBGaWdodGVyKSA9PiB1LnN0YXRlID09PSAnYXR0YWNrJyB8fCB1LnN0YXRlID09PSAnaWRsZScsIG1hc3MgPSAodTogRmlnaHRlcikgPT4gdS5yYWRpdXMgKiB1LnJhZGl1cztcbiAgICBsZXQgcHggPSAwLCBweiA9IDA7XG4gICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZmlnaHRlcnMpIHtcbiAgICAgIGlmIChvID09PSBmIHx8ICFvLmFsaXZlKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGR4ID0gZi54IC0gby54LCBkeiA9IGYueiAtIG8ueiwgbSA9IE1hdGguaHlwb3QoZHgsIGR6KSwgd2FudCA9IChmLnJhZGl1cyArIG8ucmFkaXVzKSAqIDEuMDUgKyAwLjA4O1xuICAgICAgaWYgKG0gPj0gd2FudCkgY29udGludWU7XG4gICAgICBsZXQgc2hhcmUgPSBtYXNzKG8pIC8gKG1hc3MoZikgKyBtYXNzKG8pKTsgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBsaWdodGVyIG9uZSBvZiB0aGUgcGFpciBtb3ZlcyBtb3JlXG4gICAgICBjb25zdCBwZiA9IHBsYW50ZWQoZiksIHBvID0gcGxhbnRlZChvKTtcbiAgICAgIGlmIChwZiAmJiAhcG8pIHNoYXJlICo9IDAuMTI7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBmIGlzIHN0YW5kaW5nIGl0cyBncm91bmQ6IHRoZSB3YWxrZXIgbyBnb2VzIGFyb3VuZFxuICAgICAgZWxzZSBpZiAoIXBmICYmIHBvKSBzaGFyZSA9IE1hdGgubWluKDEsIHNoYXJlICogMS41ICsgMC4zNSk7ICAgIC8vIGYgaXMgd2Fsa2luZyBpbnRvIGEgcGxhbnRlZCB1bml0OiBmIHlpZWxkc1xuICAgICAgZWxzZSBpZiAocGYgJiYgcG8pIHNoYXJlICo9IDAuMzU7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHR3byBzdGFuZGluZyB1bml0cyBvdmVybGFwIGEgbGl0dGxlOiBlYXNlIGFwYXJ0IHZlcnkgc2xvd2x5XG4gICAgICBjb25zdCBrID0gKCh3YW50IC0gbSkgLyBNYXRoLm1heChtLCAxZS0zKSkgKiBzaGFyZSAqIDI7XG4gICAgICBweCArPSAobSA8IDFlLTMgPyAodGhpcy5ybmcubmV4dCgpIC0gMC41KSA6IGR4KSAqIGs7IHB6ICs9IChtIDwgMWUtMyA/ICh0aGlzLnJuZy5uZXh0KCkgLSAwLjUpIDogZHopICogaztcbiAgICB9XG4gICAgY29uc3QgcyA9IE1hdGgubWluKDEsIGR0ICogNik7IGxldCBteCA9IHB4ICogcywgbXogPSBweiAqIHM7XG4gICAgY29uc3QgY2FwID0gKHBsYW50ZWQoZikgPyAwLjUgOiAxLjYpICogZHQsIGxlbiA9IE1hdGguaHlwb3QobXgsIG16KTsgICAvLyBtZXRyZXMgcGVyIHNlY29uZCwgc3RhbmRpbmcgdnMgd2Fsa2luZ1xuICAgIGlmIChsZW4gPiBjYXApIHsgbXggKj0gY2FwIC8gbGVuOyBteiAqPSBjYXAgLyBsZW47IH1cbiAgICBmLnggKz0gbXg7IGYueiArPSBtejtcbiAgfVxuXG4gIHByaXZhdGUgYWNxdWlyZShmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgaWYgKGYuZm9yY2VkVGFyZ2V0ID49IDApIHtcbiAgICAgIGNvbnN0IGZ0ID0gdGhpcy5ieUlkKGYuZm9yY2VkVGFyZ2V0KTtcbiAgICAgIGlmIChmdCAmJiBmdC5hbGl2ZSAmJiB0aGlzLnRpbWUgPCBmLmZvcmNlZFVudGlsKSB7IGYudGFyZ2V0ID0gZnQuaWQ7IHJldHVybjsgfVxuICAgICAgZi5mb3JjZWRUYXJnZXQgPSAtMTtcbiAgICB9XG4gICAgY29uc3QgY3VyID0gdGhpcy5ieUlkKGYudGFyZ2V0KTtcbiAgICBpZiAoY3VyICYmIGN1ci5hbGl2ZSAmJiB0aGlzLnRpbWUgPCBmLnJldGFyZ2V0QXQpIHJldHVybjtcbiAgICBpZiAoZi5zb3VsID09PSAnZ29ibGluJyAmJiBjdXIgJiYgY3VyLmFsaXZlICYmIE1hdGguaHlwb3QoY3VyLnggLSBmLngsIGN1ci56IC0gZi56KSA8PSBmLnJhbmdlICogMS4zKSByZXR1cm47ICAgLy8gYWxyZWFkeSBpbiByZWFjaCBvZiBzb21lb25lOiBoaXQgdGhlbSwgZG9uJ3Qgd2FuZGVyIG9mZiBhZnRlciBhIGp1aWNpZXIgdGFyZ2V0XG4gICAgZi5yZXRhcmdldEF0ID0gdGhpcy50aW1lICsgQkFMQU5DRS5zaW0ucmV0YXJnZXRFdmVyeSAqICgwLjggKyAwLjQgKiB0aGlzLnJuZy5uZXh0KCkpO1xuICAgIGNvbnN0IGZvZXMgPSB0aGlzLmZvZXMoZik7IGlmICghZm9lcy5sZW5ndGgpIHsgZi50YXJnZXQgPSAtMTsgcmV0dXJuOyB9XG4gICAgbGV0IGJlc3QgPSBmb2VzWzBdLCBicyA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgbyBvZiBmb2VzKSB7XG4gICAgICBsZXQgc2NvcmUgPSBNYXRoLmh5cG90KG8ueCAtIGYueCwgby56IC0gZi56KTtcbiAgICAgIGlmIChmLnNvdWwgPT09ICdnb2JsaW4nKSB7XG4gICAgICAgIC8vIGtpbGwtc3RlYWw6IHByZWZlciBuZWFyYnkgZW5lbWllcyBhbHJlYWR5IGZpZ2h0aW5nIG9uZSBvZiBvdXIgYWxsaWVzLCBhbmQgd291bmRlZCBvbmVzXG4gICAgICAgIGNvbnN0IGVuZ2FnZWQgPSB0aGlzLmJ5SWQoby50YXJnZXQpOyBjb25zdCBidXN5ID0gISFlbmdhZ2VkICYmIGVuZ2FnZWQuYWxpdmUgJiYgZW5nYWdlZC50ZWFtID09PSBmLnRlYW0gJiYgZW5nYWdlZC5pZCAhPT0gZi5pZDtcbiAgICAgICAgaWYgKGJ1c3kgJiYgc2NvcmUgPCBCQUxBTkNFLm9wcG9ydHVuaXN0LnNlZWtSYWRpdXMgKyAyKSBzY29yZSAtPSAzO1xuICAgICAgICBzY29yZSAtPSBCQUxBTkNFLm9wcG9ydHVuaXN0LndvdW5kZWRXZWlnaHQgKiAoMSAtIG8uaHAgLyBvLm1heEhwKTtcbiAgICAgIH1cbiAgICAgIGlmIChmLnNvdWwgPT09ICdnb2JsaW4nICYmIG8uaWQgPT09IGYudGFyZ2V0KSBzY29yZSAtPSAxLjU7ICAgLy8gc3RpY2sgd2l0aCBhIHRhcmdldCB1bmxlc3MgYW5vdGhlciBpcyBjbGVhcmx5IGJldHRlclxuICAgICAgaWYgKHNjb3JlIDwgYnMpIHsgYnMgPSBzY29yZTsgYmVzdCA9IG87IH1cbiAgICB9XG4gICAgZi50YXJnZXQgPSBiZXN0LmlkO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGFydEF0dGFjayhmOiBGaWdodGVyKTogdm9pZCB7XG4gICAgY29uc3QgQiA9IEJBTEFOQ0UsIHN0ID0gQi5zdGF0c1tmLnNvdWxdOyBsZXQgZWZmID0gZi5pbnRlcnZhbDtcbiAgICBpZiAoZi5zb3VsID09PSAnYmFyYmFyaWFuJykgeyBmLmZyZW56eSA9IE1hdGgubWluKEIuZnJlbnp5Lm1heFN0YWNrcywgZi5mcmVuenkgKyAxKTsgZWZmID0gZi5pbnRlcnZhbCAvICgxICsgZi5mcmVuenkgKiBCLmZyZW56eS5wZXJTd2luZyk7IHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnZnJlbnp5JywgaWQ6IGYuaWQsIHN0YWNrczogZi5mcmVuenkgfSk7IH1cbiAgICBmLmF0dGFja0R1ciA9IE1hdGgubWluKHN0LmFuaW1MZW4sIGVmZiAqIDAuOTUpOyBmLmFuaW1TcGVlZCA9IHN0LmFuaW1MZW4gLyBmLmF0dGFja0R1cjtcbiAgICBmLmF0dGFja1N0YXJ0ID0gdGhpcy50aW1lOyBmLm5leHRBdHRhY2sgPSB0aGlzLnRpbWUgKyBNYXRoLm1heChlZmYsIGYuYXR0YWNrRHVyKTsgZi5oaXREb25lID0gZmFsc2U7IGYuc3RhdGUgPSAnYXR0YWNrJztcbiAgICBmLmNhc3RpbmcgPSBmLm1heE1hbmEgPiAwICYmIGYubWFuYSA+PSBmLm1heE1hbmE7IGlmIChmLmNhc3RpbmcpIHsgZi5tYW5hID0gMDsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdjYXN0JywgaWQ6IGYuaWQsIHNraWxsOiBmLnNvdWwgPT09ICdhcmNoZXInID8gJ3NwbGl0JyA6IGYuc291bCA9PT0gJ2tuaWdodCcgPyAndGF1bnQnIDogJ3NtYXNoJyB9KTsgfVxuICAgIHRoaXMuZXZlbnRzLnB1c2goeyB0OiAnc3dpbmcnLCBpZDogZi5pZCwgc3BlZWQ6IGYuYW5pbVNwZWVkLCBkdXI6IGYuYXR0YWNrRHVyIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlSGl0KGY6IEZpZ2h0ZXIpOiB2b2lkIHtcbiAgICBjb25zdCBCID0gQkFMQU5DRTsgY29uc3QgdGcgPSB0aGlzLmJ5SWQoZi50YXJnZXQpOyBpZiAoIXRnIHx8ICF0Zy5hbGl2ZSkgcmV0dXJuO1xuICAgIGNvbnN0IE0gPSBCLm1hbmFbZi5zb3VsXTsgaWYgKE0gJiYgIWYuY2FzdGluZykgZi5tYW5hID0gTWF0aC5taW4oTS5tYXgsIGYubWFuYSArIE0ucGVyQXR0YWNrKTtcbiAgICBpZiAoZi5zb3VsID09PSAnYXJjaGVyJykgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBiYXNpYzogb25lIGFycm93LiBTa2lsbCAoU3BsaXQgQXJyb3cpOiBvbmUgYXJyb3cgYXQgZWFjaCBvZiB1cCB0byAzIGRpZmZlcmVudCBlbmVtaWVzXG4gICAgICBjb25zdCByZWFjaCA9IGYucmFuZ2UgKiAxLjI1O1xuICAgICAgY29uc3QgZm9lcyA9IHRoaXMuZm9lcyhmKS5tYXAoKG8pID0+ICh7IG8sIGQ6IE1hdGguaHlwb3Qoby54IC0gZi54LCBvLnogLSBmLnopIH0pKS5maWx0ZXIoKGUpID0+IGUuZCA8PSByZWFjaCkuc29ydCgoYSwgYikgPT4gYS5kIC0gYi5kKTtcbiAgICAgIGNvbnN0IHBpY2tlZCA9IGYuY2FzdGluZyA/IFt0ZywgLi4uZm9lcy5tYXAoKGUpID0+IGUubykuZmlsdGVyKChvKSA9PiBvLmlkICE9PSB0Zy5pZCldLnNsaWNlKDAsIEIudm9sbGV5LnRhcmdldHMpIDogW3RnXTtcbiAgICAgIGZvciAoY29uc3QgbyBvZiBwaWNrZWQpIHtcbiAgICAgICAgY29uc3QgZHVyID0gTWF0aC5tYXgoMC4xNSwgTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgLyBCLnZvbGxleS5wcm9qZWN0aWxlU3BlZWQpO1xuICAgICAgICB0aGlzLnBlbmRpbmcucHVzaCh7IGF0OiB0aGlzLnRpbWUgKyBkdXIsIGZyb206IGYuaWQsIHRvOiBvLmlkLCBkbWc6IGYuZG1nIH0pO1xuICAgICAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2Fycm93JywgZnJvbTogZi5pZCwgdG86IG8uaWQsIGR1ciB9KTtcbiAgICAgIH1cbiAgICAgIGYuY2FzdGluZyA9IGZhbHNlOyByZXR1cm47XG4gICAgfVxuICAgIGlmIChNYXRoLmh5cG90KHRnLnggLSBmLngsIHRnLnogLSBmLnopID4gZi5yYW5nZSAqIDEuNSkgeyBmLmNhc3RpbmcgPSBmYWxzZTsgcmV0dXJuOyB9ICAgLy8gdGFyZ2V0IHNsaXBwZWQgYXdheTogdGhlIGJsb3cgbWlzc2VzXG4gICAgbGV0IGRtZyA9IGYuZG1nO1xuICAgIGlmIChmLnNvdWwgPT09ICdnb2JsaW4nKSB7IGNvbnN0IGVuZyA9IHRoaXMuYnlJZCh0Zy50YXJnZXQpOyBpZiAoZW5nICYmIGVuZy5hbGl2ZSAmJiBlbmcudGVhbSA9PT0gZi50ZWFtICYmIGVuZy5pZCAhPT0gZi5pZCkgZG1nICo9IDEgKyBCLm9wcG9ydHVuaXN0LmJvbnVzOyB9XG4gICAgaWYgKGYuY2FzdGluZykge1xuICAgICAgZi5jYXN0aW5nID0gZmFsc2U7XG4gICAgICBpZiAoZi5zb3VsID09PSAnb2dyZScpIHtcbiAgICAgICAgZG1nICo9IEIuc21hc2gubXVsdDsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdzbWFzaCcsIGlkOiBmLmlkLCB4OiB0Zy54LCB6OiB0Zy56LCByOiBCLnNtYXNoLnJhZGl1cyB9KTtcbiAgICAgICAgZm9yIChjb25zdCBvIG9mIHRoaXMuZm9lcyhmKSkgaWYgKG8uaWQgIT09IHRnLmlkICYmIE1hdGguaHlwb3Qoby54IC0gdGcueCwgby56IC0gdGcueikgPD0gQi5zbWFzaC5yYWRpdXMpIHRoaXMuZGFtYWdlKG8sIGRtZyAqIDAuNiwgZiwgJ3NtYXNoJyk7XG4gICAgICAgIHRoaXMuZGFtYWdlKHRnLCBkbWcsIGYsICdzbWFzaCcpOyByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAoZi5zb3VsID09PSAna25pZ2h0Jykge1xuICAgICAgICBmb3IgKGNvbnN0IG8gb2YgdGhpcy5mb2VzKGYpKSBpZiAoTWF0aC5oeXBvdChvLnggLSBmLngsIG8ueiAtIGYueikgPD0gQi50YXVudC5yYWRpdXMpIHsgby5mb3JjZWRUYXJnZXQgPSBmLmlkOyBvLmZvcmNlZFVudGlsID0gdGhpcy50aW1lICsgQi50YXVudC5kdXJhdGlvbjsgby5yZXRhcmdldEF0ID0gMDsgfVxuICAgICAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ3RhdW50JywgaWQ6IGYuaWQgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuZGFtYWdlKHRnLCBkbWcsIGYsICdtZWxlZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBkYW1hZ2UodDogRmlnaHRlciwgYW1vdW50OiBudW1iZXIsIGZyb206IEZpZ2h0ZXIsIGtpbmQ6ICdtZWxlZScgfCAnYXJyb3cnIHwgJ3NtYXNoJyk6IHZvaWQge1xuICAgIGlmICghdC5hbGl2ZSkgcmV0dXJuO1xuICAgIGNvbnN0IEIgPSBCQUxBTkNFOyBsZXQgcmVkID0gMDtcbiAgICBpZiAodC5zb3VsID09PSAnd2FycmlvcicpIHtcbiAgICAgIGNvbnN0IG4gPSB0aGlzLmZpZ2h0ZXJzLmZpbHRlcigobykgPT4gby5hbGl2ZSAmJiBvICE9PSB0ICYmIG8udGVhbSA9PT0gdC50ZWFtICYmIG8uc291bCA9PT0gJ3dhcnJpb3InICYmIE1hdGguaHlwb3Qoby54IC0gdC54LCBvLnogLSB0LnopIDw9IEIucGhhbGFueC5yYWRpdXMpLmxlbmd0aDtcbiAgICAgIHJlZCA9IE1hdGgubWluKEIucGhhbGFueC5tYXhTdGFja3MsIG4pICogQi5waGFsYW54LnBlckFsbHk7XG4gICAgfVxuICAgIGNvbnN0IGRtZyA9IGFtb3VudCAqICgxIC0gcmVkKTsgdC5ocCAtPSBkbWc7XG4gICAgY29uc3QgTSA9IEIubWFuYVt0LnNvdWxdOyBpZiAoTSAmJiB0LmhwID4gMCkgdC5tYW5hID0gTWF0aC5taW4oTS5tYXgsIHQubWFuYSArIE0ucGVySGl0KTtcbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgdDogJ2hpdCcsIGZyb206IGZyb20uaWQsIHRvOiB0LmlkLCBkbWcsIGtpbmQgfSk7XG4gICAgaWYgKHQuaHAgPD0gMCkgeyB0LmhwID0gMDsgdC5hbGl2ZSA9IGZhbHNlOyB0LnN0YXRlID0gJ2RlYWQnOyB0LmRlYWRBdCA9IHRoaXMudGltZTsgdGhpcy5ldmVudHMucHVzaCh7IHQ6ICdkZWF0aCcsIGlkOiB0LmlkIH0pOyB9XG4gIH1cbn1cblxuLyoqIFJ1biBhIHdob2xlIGZpZ2h0IHdpdGhvdXQgYW55IGdyYXBoaWNzLiBSZXR1cm5zIHdobyB3b24gYW5kIGhvdyBpdCB3ZW50LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpbXVsYXRlKHBsYXllcnM6IFNsb3RbXSwgZW5lbWllczogU3BlY1tdLCBzZWVkID0gMSwgbWF4U2Vjb25kcyA9IDEzMCwgbGV2ZWxzPzogUGFydGlhbDxSZWNvcmQ8U291bElkLCBudW1iZXI+PiwgZW5lbXlQb3dlciA9IDEpOiB7IHdpbm5lcjogMCB8IDE7IHRpbWU6IG51bWJlcjsgbGVmdDogbnVtYmVyOyBocExlZnQ6IG51bWJlciB9IHtcbiAgY29uc3QgYiA9IG5ldyBCYXR0bGUocGxheWVycywgZW5lbWllcywgc2VlZCwgbGV2ZWxzLCBlbmVteVBvd2VyKTtcbiAgd2hpbGUgKGIud2lubmVyIDwgMCAmJiBiLnRpbWUgPCBtYXhTZWNvbmRzKSBiLnN0ZXAoMSAvIDMwKTtcbiAgY29uc3QgdyA9IChiLndpbm5lciA8IDAgPyAxIDogYi53aW5uZXIpIGFzIDAgfCAxO1xuICBjb25zdCBtaW5lID0gYi5maWdodGVycy5maWx0ZXIoKGYpID0+IGYuYWxpdmUgJiYgZi50ZWFtID09PSB3KTtcbiAgcmV0dXJuIHsgd2lubmVyOiB3LCB0aW1lOiBiLnRpbWUsIGxlZnQ6IG1pbmUubGVuZ3RoLCBocExlZnQ6IG1pbmUucmVkdWNlKChuLCBmKSA9PiBuICsgZi5ocCAvIGYubWF4SHAsIDApIH07XG59XG4iLCAiaW1wb3J0IHsgQ1VSVkVTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUnVsZXMgfSBmcm9tICcuL2RhdGEudHMnO1xuXG4vKipcbiAqIFJ1bGVzIGZvciB0aGUgcGxheWFibGUgU3RhZ2UgMSAoMTAgd2F2ZXMpOiBkb2MgRG9taW5pb24gY3VydmUsIGJvbnVzIGRyYXcgb25seSBvbiB0aGUgZWFybHkgd2F2ZXMuXG4gKiBtZXJnZSAnaGFuZEludG9PbmVTdGFyJzogYSAxLXN0YXIgY2FyZCBpbiBoYW5kIGNhbiBtZXJnZSBzdHJhaWdodCBpbnRvIGEgbWF0Y2hpbmcgZGVwbG95ZWQgMS1zdGFyIHVuaXQgKHBheWluZyBvbmx5IHRoZSBjb3N0XG4gKiBkaWZmZXJlbmNlKS4gV2l0aG91dCBpdCB0aGUgY2FwIGNhbiBibG9jayBhIG1lcmdlIHlvdSBjb3VsZCBhZmZvcmQgKHlvdSB3b3VsZCBuZWVkIHJvb20gdG8gc3VtbW9uIEJPVEggY29waWVzIGZpcnN0KS5cbiAqIFRoZSBkZWJ1ZyBwYW5lbCBjYW4gc3dpdGNoIHRoaXMgYmFjayB0byB0aGUgZG9jJ3MgZGVwbG95ZWQtb25seSBydWxlLlxuICovXG5leHBvcnQgY29uc3QgUFJPVE9UWVBFX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IENVUlZFUy5kb2MsIG1lcmdlOiAnaGFuZEludG9PbmVTdGFyJywgc3RhZ2VXYXZlczogMTAsIG5vcm1hbERyYXdXYXZlczogWzIsIDMsIDQsIDVdIH07XG5cbi8qKlxuICogRW5kbGVzcyBEZXB0aHM6IHRoZSBjYW1wYWlnbidzIERvbWluaW9uIGN1cnZlIGZvciB3YXZlcyAxLTEwLCB0aGVuIGhlbGQgYXQgNDAgKHRoZSBwbGF5ZXIncyBhcm15IGlzIGNhcHBlZCBvbiBwdXJwb3NlOyB0aGUgZW5lbXkga2VlcHMgZ3Jvd2luZywgc2VlIGVuZGxlc3MudHMpLlxuICogVGhlIGN1cnZlIGlzIGxvbmcgZW5vdWdoIHRoYXQgYSBydW4gZW5kcyBieSBsb3NpbmcgaGVhcnRzLCBuZXZlciBieSBcImNsZWFyaW5nXCIgdGhlIHN0YWdlIChjb3JlL3J1bGVzLnRzIHJlYWRzIGN1cnZlW3dhdmUtMV0pLlxuICovXG5jb25zdCBFTkRMRVNTX0xFTiA9IDMwMDtcbmV4cG9ydCBjb25zdCBFTkRMRVNTX1JVTEVTOiBSdWxlcyA9IHsgY3VydmU6IEFycmF5LmZyb20oeyBsZW5ndGg6IEVORExFU1NfTEVOIH0sIChfLCBpKSA9PiBDVVJWRVMuZG9jW01hdGgubWluKGksIENVUlZFUy5kb2MubGVuZ3RoIC0gMSldKSwgbWVyZ2U6ICdoYW5kSW50b09uZVN0YXInLCBzdGFnZVdhdmVzOiBFTkRMRVNTX0xFTiwgbm9ybWFsRHJhd1dhdmVzOiBbMiwgMywgNCwgNV0gfTtcbiIsICIvLyBUaGUgRGFpbHkgQ2hhbGxlbmdlOiBTdGFnZSAxIChOb3JtYWwpIHdpdGggT05FIHR3aXN0IHRoYXQgY2hhbmdlcyBldmVyeSBkYXkuIEV2ZXJ5b25lIGdldHMgdGhlIHNhbWUgdHdpc3QgYW5kIHRoZSBzYW1lIHNlZWQgb24gdGhlIHNhbWUgZGF5XG4vLyAoYm90aCBjb21lIGZyb20gdGhlIGNhbGVuZGFyIGRhdGUsIHNvIG5vIHNlcnZlciBpcyBuZWVkZWQpLiBSZXRyeSBhcyBvZnRlbiBhcyB5b3UgbGlrZTsgdGhlIHJld2FyZCAoYSBwYWNrIGFuZCBzb21lIGdvbGQpIGlzIHBhaWQgb25jZSBwZXIgZGF5LlxuXG5pbXBvcnQgeyBDT1NULCBDVVJWRVMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBSdWxlcyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBQUk9UT1RZUEVfUlVMRVMgfSBmcm9tICcuL3Byb3RvdHlwZS50cyc7XG5pbXBvcnQgdHlwZSB7IEVuZW15U3BlYyB9IGZyb20gJy4vd2F2ZXMudHMnO1xuaW1wb3J0IHsgd2F2ZUNvc3QgfSBmcm9tICcuL3dhdmVzLnRzJztcblxuZXhwb3J0IGNvbnN0IERBSUxZX0lEID0gJ2RhaWx5JztcblxuZXhwb3J0IGludGVyZmFjZSBEYWlseU1vZCB7XG4gIGlkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgdGV4dDogc3RyaW5nO1xuICBwb3dlcjogbnVtYmVyOyAgICAgICAgICAgICAgICAgICAgICAgIC8vIGhpZGRlbiBlbmVteSBoZWFsdGgvZGFtYWdlIG11bHRpcGxpZXIgZm9yIHRoZSBkYXlcbiAgY2FwRGVsdGE6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAvLyBjaGFuZ2UgdG8gdGhlIHBsYXllcidzIERvbWluaW9uIGV2ZXJ5IHdhdmUgKG5ldmVyIGJlbG93IERBSUxZX01JTl9DQVApXG4gIGVuZW15PzogKHc6IEVuZW15U3BlY1tdLCB3YXZlOiBudW1iZXIpID0+IEVuZW15U3BlY1tdOyAgIC8vIHJld3JpdGVzIGVhY2ggZW5lbXkgd2F2ZVxufVxuZXhwb3J0IGNvbnN0IERBSUxZX01JTl9DQVAgPSA0O1xuY29uc3QgTUFYX1VOSVRTID0gMTI7XG5cbi8qKiBBIGNyb3dkIG9mIFdhcnJpb3JzIGFuZCBHb2JsaW5zIHRoYXQgY29zdHMgYWJvdXQgYGJ1ZGdldGAgRG9taW5pb24uICovXG5mdW5jdGlvbiBjcm93ZChidWRnZXQ6IG51bWJlcik6IEVuZW15U3BlY1tdIHtcbiAgY29uc3Qgb3V0OiBFbmVteVNwZWNbXSA9IFtdOyBsZXQgbGVmdCA9IGJ1ZGdldDtcbiAgZm9yIChsZXQgaSA9IDA7IG91dC5sZW5ndGggPCBNQVhfVU5JVFM7IGkrKykge1xuICAgIGNvbnN0IHNvdWwgPSBpICUgMyA9PT0gMiA/ICdnb2JsaW4nIDogJ3dhcnJpb3InOyBpZiAoQ09TVFtzb3VsXVswXSA+IGxlZnQpIGJyZWFrO1xuICAgIG91dC5wdXNoKHsgc291bCwgc3RhcjogMSB9KTsgbGVmdCAtPSBDT1NUW3NvdWxdWzBdO1xuICB9XG4gIHJldHVybiBvdXQubGVuZ3RoID8gb3V0IDogW3sgc291bDogJ3dhcnJpb3InLCBzdGFyOiAxIH1dO1xufVxuXG5leHBvcnQgY29uc3QgTU9ESUZJRVJTOiBEYWlseU1vZFtdID0gW1xuICB7IGlkOiAnZW1wb3dlcmVkJywgbmFtZTogJ0VtcG93ZXJlZCcsIHRleHQ6ICdFbmVtaWVzIGFyZSAyNSUgc3Ryb25nZXIuJywgcG93ZXI6IDEuMjUsIGNhcERlbHRhOiAwIH0sXG4gIHsgaWQ6ICdtZWxlZScsIG5hbWU6ICdObyBBcmNoZXJzJywgdGV4dDogJ0VuZW15IEFyY2hlcnMgYXJlIHJlcGxhY2VkIGJ5IFdhcnJpb3JzLCBidXQgZXZlcnlvbmUgaGl0cyBoYXJkZXIuJywgcG93ZXI6IDEuMTUsIGNhcERlbHRhOiAwLFxuICAgIGVuZW15OiAodykgPT4gdy5tYXAoKGUpID0+IChlLnNvdWwgPT09ICdhcmNoZXInID8geyBzb3VsOiAnd2FycmlvcicgYXMgY29uc3QsIHN0YXI6IGUuc3RhciB9IDogZSkpIH0sXG4gIHsgaWQ6ICdzd2FybScsIG5hbWU6ICdTd2FybScsIHRleHQ6ICdXYXZlcyBhcmUgY3Jvd2RzIG9mIFdhcnJpb3JzIGFuZCBHb2JsaW5zLicsIHBvd2VyOiAwLjg1LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IGNyb3dkKE1hdGgucm91bmQod2F2ZUNvc3QodykgKiAxLjE1KSkgfSxcbiAgeyBpZDogJ2NyYW1wZWQnLCBuYW1lOiAnQ3JhbXBlZCcsIHRleHQ6ICdZb3VyIERvbWluaW9uIGlzIDQgbG93ZXIgZXZlcnkgd2F2ZS4nLCBwb3dlcjogMSwgY2FwRGVsdGE6IC00IH0sXG4gIHsgaWQ6ICd2ZXRlcmFucycsIG5hbWU6ICdWZXRlcmFucycsIHRleHQ6ICdFbmVteSBPZ3JlcyBhbmQgS25pZ2h0cyBhcmUgYSBzdGFyIGhpZ2hlci4nLCBwb3dlcjogMC45LCBjYXBEZWx0YTogMCxcbiAgICBlbmVteTogKHcpID0+IHcubWFwKChlKSA9PiAoZS5zb3VsID09PSAnb2dyZScgfHwgZS5zb3VsID09PSAna25pZ2h0JyA/IHsgc291bDogZS5zb3VsLCBzdGFyOiBNYXRoLm1pbigzLCBlLnN0YXIgKyAxKSB9IDogZSkpIH0sXG5dO1xuXG4vKiogV2hvbGUgZGF5cyBzaW5jZSAxIEphbnVhcnkgMTk3MCBpbiB0aGUgcGxheWVyJ3Mgb3duIGNhbGVuZGFyICh0aGUgZGF5IGNoYW5nZXMgYXQgdGhlaXIgbWlkbmlnaHQpLiAqL1xuZXhwb3J0IGNvbnN0IGRheU51bWJlciA9IChkOiBEYXRlID0gbmV3IERhdGUoKSk6IG51bWJlciA9PiBNYXRoLmZsb29yKERhdGUuVVRDKGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSkgLyA4NjQwMDAwMCk7XG5leHBvcnQgY29uc3QgaXNWYWxpZERheSA9IChuOiBudW1iZXIpOiBib29sZWFuID0+IE51bWJlci5pc0ludGVnZXIobikgJiYgbiA+IDAgJiYgbiA8IDFlNjtcbmV4cG9ydCBjb25zdCBtb2RpZmllckZvciA9IChkYXk6IG51bWJlcik6IERhaWx5TW9kID0+IE1PRElGSUVSU1soKGRheSAlIE1PRElGSUVSUy5sZW5ndGgpICsgTU9ESUZJRVJTLmxlbmd0aCkgJSBNT0RJRklFUlMubGVuZ3RoXTtcbi8qKiBUaGUgcGxheWVyJ3MgcnVsZXMgZm9yIHRoZSBkYXk6IHRoZSBjYW1wYWlnbidzIERvbWluaW9uIGN1cnZlLCBzaGlmdGVkIGJ5IHRoZSBtb2RpZmllci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkYWlseVJ1bGVzKG1vZDogRGFpbHlNb2QsIHBvb2w6IFJ1bGVzWydwb29sJ10pOiBSdWxlcyB7XG4gIHJldHVybiB7IC4uLlBST1RPVFlQRV9SVUxFUywgY3VydmU6IENVUlZFUy5kb2MubWFwKChjKSA9PiBNYXRoLm1heChEQUlMWV9NSU5fQ0FQLCBjICsgbW9kLmNhcERlbHRhKSksIHBvb2wgfTtcbn1cbiIsICIvLyBTb3VsIFBhY2tzIChwbGFuIGRvYyBzZWN0aW9uIDE3KS4gUHVyZSBydWxlcywgbm8gZ3JhcGhpY3MuIEFMTCBOVU1CRVJTIEFSRSBQTEFDRUhPTERFUiBMRVZFUlM6IHdlIHNldHRsZWQgdGhlIHN0cnVjdHVyZSBmaXJzdCBhbmQgd2lsbCB0dW5lXG4vLyBxdWFudGl0aWVzIHdpdGggdGhlIHByb2dyZXNzaW9uIHNpbXVsYXRpb24gKHNpbS9wcm9ncmVzc2lvbi50cykgb25jZSB0aGUgbG9vcCBjYW4gYmUgcGxheWVkLlxuLy9cbi8vICAgU291bCByYXJpdHkgIC0+IGhvdyBvZnRlbiBhIFNvdWwgc2hvd3MgdXAgYW5kIGhvdyBiaWcgaXRzIHN0YWNrIG9mIGNvcGllcyB0ZW5kcyB0byBiZS5cbi8vICAgUGFjayB0aWVyICAgIC0+IHRoZSBwYWNrJ3Mgb3ZlcmFsbCB2YWx1ZSAoc2t1bGxzLCAxLTMgZm9yIG5vdyk6IG51bWJlciBvZiByZXZlYWxzICsgaG93IGdvb2QgdGhlIHJhcml0eSBvZGRzIGFyZS5cbi8vICAgQSBwYWNrIGhhcyBhIFNUQVJUSU5HIHRpZXIgYW5kIG1heSB1cGdyYWRlIHdoaWxlIGl0IGlzIGJlaW5nIG9wZW5lZDsgdGhlIHJlc3VsdCBpcyBkZWNpZGVkIHVwIGZyb250LCB0aGUgYW5pbWF0aW9uIG9ubHkgc2hvd3MgaXQuXG5cbmltcG9ydCB7IFNPVUxTIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi9kYXRhLnRzJztcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSAnLi9ybmcudHMnO1xuXG5leHBvcnQgdHlwZSBSYXJpdHkgPSAnY29tbW9uJyB8ICdyYXJlJyB8ICdlcGljJyB8ICdsZWdlbmRhcnknO1xuZXhwb3J0IGNvbnN0IFJBUklUSUVTOiBSYXJpdHlbXSA9IFsnY29tbW9uJywgJ3JhcmUnLCAnZXBpYycsICdsZWdlbmRhcnknXTtcbmV4cG9ydCBjb25zdCBSQVJJVFlfTkFNRTogUmVjb3JkPFJhcml0eSwgc3RyaW5nPiA9IHsgY29tbW9uOiAnQ29tbW9uJywgcmFyZTogJ1JhcmUnLCBlcGljOiAnRXBpYycsIGxlZ2VuZGFyeTogJ0xlZ2VuZGFyeScgfTtcblxuLyoqIFJhcml0eSBwZXIgU291bC4gUExBQ0VIT0xERVIgYXNzaWdubWVudCAobm8gTGVnZW5kYXJ5IFNvdWwgZXhpc3RzIHlldCkuICovXG5leHBvcnQgY29uc3QgUkFSSVRZX09GOiBSZWNvcmQ8U291bElkLCBSYXJpdHk+ID0geyB3YXJyaW9yOiAnY29tbW9uJywgZ29ibGluOiAnY29tbW9uJywgYXJjaGVyOiAncmFyZScsIGtuaWdodDogJ3JhcmUnLCBvZ3JlOiAnZXBpYycsIGJhcmJhcmlhbjogJ2VwaWMnIH07XG5cbi8qKiBSYXJlciBTb3VscyB0dXJuIHVwIGluIHNtYWxsZXIgc3RhY2tzLCBzbyB0aGV5IG5lZWQgZmV3ZXIgY29waWVzIHBlciBsZXZlbCAobXVsdGlwbGllciBvbiB0aGUgbGV2ZWwgY29zdHMpLiBQTEFDRUhPTERFUi4gKi9cbmV4cG9ydCBjb25zdCBMRVZFTF9DT1NUX01VTFQ6IFJlY29yZDxSYXJpdHksIG51bWJlcj4gPSB7IGNvbW1vbjogMSwgcmFyZTogMC42LCBlcGljOiAwLjM1LCBsZWdlbmRhcnk6IDAuMiB9O1xuXG5leHBvcnQgY29uc3QgUEFDS19USUVSUyA9IDM7XG5leHBvcnQgY29uc3QgUEFDSyA9IHtcbiAgcmV2ZWFsczogWzMsIDQsIDVdLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2VwYXJhdGUgcmV2ZWFscyBwZXIgdGllciAoaW5kZXggMCA9IHRpZXIgMSlcbiAgc3RhY2tNdWx0OiBbMSwgMS41LCAyXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29weSBzdGFja3MgYXJlIGJpZ2dlciBpbiBiZXR0ZXIgcGFja3NcbiAgLyoqIFJhcml0eSBvZGRzIHBlciB0aWVyLCBpbiBwZXJjZW50LiAqL1xuICBvZGRzOiBbXG4gICAgeyBjb21tb246IDcwLCByYXJlOiAyNSwgZXBpYzogNSwgbGVnZW5kYXJ5OiAwIH0sXG4gICAgeyBjb21tb246IDU1LCByYXJlOiAzMywgZXBpYzogMTEsIGxlZ2VuZGFyeTogMSB9LFxuICAgIHsgY29tbW9uOiA0MCwgcmFyZTogMzgsIGVwaWM6IDE5LCBsZWdlbmRhcnk6IDMgfSxcbiAgXSBhcyBSZWNvcmQ8UmFyaXR5LCBudW1iZXI+W10sXG4gIC8qKiBDb3BpZXMgaW4gb25lIHJldmVhbCBiZWZvcmUgdGhlIHRpZXIgbXVsdGlwbGllcjogW21pbiwgbWF4XS4gKi9cbiAgc3RhY2s6IHsgY29tbW9uOiBbNiwgMTBdLCByYXJlOiBbMywgNV0sIGVwaWM6IFsxLCAzXSwgbGVnZW5kYXJ5OiBbMSwgMV0gfSBhcyBSZWNvcmQ8UmFyaXR5LCBbbnVtYmVyLCBudW1iZXJdPixcbiAgLyoqIENoYW5jZSB0byBqdW1wIHVwIG9uZSB0aWVyIGR1cmluZyB0aGUgb3BlbmluZywgZnJvbSB0aWVyIDEgYW5kIGZyb20gdGllciAyIChhIGx1Y2t5IHBhY2sgY2FuIGp1bXAgdHdpY2UpLiAqL1xuICB1cGdyYWRlQ2hhbmNlOiBbMC4yLCAwLjEyXSxcbn07XG5cbi8qKiBBbiB1bm9wZW5lZCBwYWNrIHRoZSBwbGF5ZXIgb3ducy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFja0l0ZW0geyBpZDogbnVtYmVyOyB0aWVyOiBudW1iZXI7IHNvdXJjZTogc3RyaW5nIH1cbmV4cG9ydCBpbnRlcmZhY2UgUmV2ZWFsIHsgc291bDogU291bElkOyByYXJpdHk6IFJhcml0eTsgY29waWVzOiBudW1iZXIgfVxuZXhwb3J0IGludGVyZmFjZSBQYWNrUmVzdWx0IHsgc3RhcnRUaWVyOiBudW1iZXI7IGZpbmFsVGllcjogbnVtYmVyOyB1cGdyYWRlczogbnVtYmVyW107IHJldmVhbHM6IFJldmVhbFtdIH1cblxuY29uc3QgcmFyaXR5UmFuayA9IChyOiBSYXJpdHkpID0+IFJBUklUSUVTLmluZGV4T2Yocik7XG5cbmZ1bmN0aW9uIHJvbGxSYXJpdHkodGllcjogbnVtYmVyLCBybmc6IFJuZyk6IFJhcml0eSB7XG4gIGNvbnN0IG9kZHMgPSBQQUNLLm9kZHNbdGllciAtIDFdOyBsZXQgcm9sbCA9IHJuZy5uZXh0KCkgKiBSQVJJVElFUy5yZWR1Y2UoKG4sIHIpID0+IG4gKyBvZGRzW3JdLCAwKTtcbiAgZm9yIChjb25zdCByIG9mIFJBUklUSUVTKSB7IGlmIChyb2xsIDwgb2Rkc1tyXSkgcmV0dXJuIHI7IHJvbGwgLT0gb2Rkc1tyXTsgfVxuICByZXR1cm4gJ2NvbW1vbic7XG59XG5cbi8qKiBBIHJhbmRvbSBTb3VsIG9mIHRoaXMgcmFyaXR5OyBpZiB0aGUgcm9zdGVyIGhhcyBub25lIG9mIHRoYXQgcmFyaXR5IHlldCwgdGhlIG5leHQgbG93ZXIgb25lIGlzIHVzZWQuICovXG5mdW5jdGlvbiBzb3VsT2ZSYXJpdHkocmFyaXR5OiBSYXJpdHksIHJuZzogUm5nKTogU291bElkIHtcbiAgZm9yIChsZXQgaSA9IHJhcml0eVJhbmsocmFyaXR5KTsgaSA+PSAwOyBpLS0pIHsgY29uc3QgcG9vbCA9IFNPVUxTLmZpbHRlcigocykgPT4gUkFSSVRZX09GW3NdID09PSBSQVJJVElFU1tpXSk7IGlmIChwb29sLmxlbmd0aCkgcmV0dXJuIHJuZy5waWNrKHBvb2wpOyB9XG4gIHJldHVybiBybmcucGljayhTT1VMUyk7XG59XG5cbi8qKiBPcGVuIGEgcGFjazogcm9sbCB1cGdyYWRlcyBmaXJzdCAoc28gdGhlIGFuaW1hdGlvbiBjYW4gcGxheSB0aGVtIGJlZm9yZSB0aGUgcGFjayB0ZWFycyBvcGVuKSwgdGhlbiB0aGUgcmV2ZWFscy4gQmVzdCByZXZlYWwgY29tZXMgbGFzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuUGFjayhzdGFydFRpZXI6IG51bWJlciwgcm5nOiBSbmcpOiBQYWNrUmVzdWx0IHtcbiAgY29uc3QgdDAgPSBNYXRoLm1heCgxLCBNYXRoLm1pbihQQUNLX1RJRVJTLCBNYXRoLmZsb29yKHN0YXJ0VGllcikpKSwgdXBncmFkZXM6IG51bWJlcltdID0gW107XG4gIGxldCB0aWVyID0gdDA7XG4gIHdoaWxlICh0aWVyIDwgUEFDS19USUVSUyAmJiBybmcubmV4dCgpIDwgUEFDSy51cGdyYWRlQ2hhbmNlW3RpZXIgLSAxXSkgeyB0aWVyKys7IHVwZ3JhZGVzLnB1c2godGllcik7IH1cbiAgY29uc3QgcmV2ZWFsczogUmV2ZWFsW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBQQUNLLnJldmVhbHNbdGllciAtIDFdOyBpKyspIHtcbiAgICBjb25zdCByYXJpdHkgPSByb2xsUmFyaXR5KHRpZXIsIHJuZyksIHNvdWwgPSBzb3VsT2ZSYXJpdHkocmFyaXR5LCBybmcpLCBbbG8sIGhpXSA9IFBBQ0suc3RhY2tbUkFSSVRZX09GW3NvdWxdXTtcbiAgICByZXZlYWxzLnB1c2goeyBzb3VsLCByYXJpdHk6IFJBUklUWV9PRltzb3VsXSwgY29waWVzOiBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKChsbyArIHJuZy5pbnQoaGkgLSBsbyArIDEpKSAqIFBBQ0suc3RhY2tNdWx0W3RpZXIgLSAxXSkpIH0pO1xuICB9XG4gIHJldmVhbHMuc29ydCgoYSwgYikgPT4gcmFyaXR5UmFuayhhLnJhcml0eSkgLSByYXJpdHlSYW5rKGIucmFyaXR5KSB8fCBhLmNvcGllcyAtIGIuY29waWVzKTtcbiAgcmV0dXJuIHsgc3RhcnRUaWVyOiB0MCwgZmluYWxUaWVyOiB0aWVyLCB1cGdyYWRlcywgcmV2ZWFscyB9O1xufVxuXG4vKiogVG90YWwgY29waWVzIHBlciBTb3VsIGluIGEgcmVzdWx0ICh0aGUgc2FtZSBTb3VsIGNhbiBiZSByZXZlYWxlZCBtb3JlIHRoYW4gb25jZSkuICovXG5leHBvcnQgZnVuY3Rpb24gY29waWVzQnlTb3VsKHJlc3VsdDogUGFja1Jlc3VsdCk6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4ge1xuICBjb25zdCBvdXQ6IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgbnVtYmVyPj4gPSB7fTtcbiAgZm9yIChjb25zdCByIG9mIHJlc3VsdC5yZXZlYWxzKSBvdXRbci5zb3VsXSA9IChvdXRbci5zb3VsXSA/PyAwKSArIHIuY29waWVzO1xuICByZXR1cm4gb3V0O1xufVxuIiwgIi8vIFRoZSBwbGF5ZXIncyBzYXZlZCBwcm9ncmVzcy4gRnJhbWV3b3JrLWZyZWUgc28gdGhlIGdhbWUgYnVuZGxlIGFuZCB0aGUgbmF2aWdhdGlvbiBzaGVsbCBib3RoIHVzZSBpdC5cbi8vIFN0b3JlZCBpbiBsb2NhbFN0b3JhZ2UgYXMgSlNPTi4gRXZlcnkgcmVhZC93cml0ZSBpcyBndWFyZGVkOiBwcml2YXRlIHdpbmRvd3MgYW5kIGJsb2NrZWQgc3RvcmFnZSBtdXN0IG5ldmVyIGJyZWFrIHRoZSBnYW1lLlxuXG5pbXBvcnQgeyBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgeyBQQUNLX1RJRVJTIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5cbmV4cG9ydCBjb25zdCBERUNLX1NJWkUgPSA2OyAgICAgICAgICAgICAgICAgICAgIC8vIGRvYzogc2l4IGVxdWlwcGVkIFNvdWxzIHBlciBzdGFnZVxuY29uc3QgS0VZID0gJ25lY3JvLXNhdmUnO1xuY29uc3QgVkVSU0lPTiA9IDE7XG5cbmV4cG9ydCB0eXBlIERpZmZpY3VsdHkgPSAnZWFzeScgfCAnbm9ybWFsJyB8ICdoYXJkJyB8ICduaWdodG1hcmUnO1xuZXhwb3J0IGNvbnN0IERJRkZJQ1VMVElFUzogRGlmZmljdWx0eVtdID0gWydlYXN5JywgJ25vcm1hbCcsICdoYXJkJywgJ25pZ2h0bWFyZSddO1xuZXhwb3J0IGludGVyZmFjZSBTZXR0aW5ncyB7IG11c2ljOiBib29sZWFuOyBzZng6IGJvb2xlYW4gfVxuZXhwb3J0IGludGVyZmFjZSBTb3VsUHJvZ3Jlc3MgeyBsZXZlbDogbnVtYmVyOyBjb3BpZXM6IG51bWJlciB9XG5leHBvcnQgaW50ZXJmYWNlIFNhdmUge1xuICB2OiBudW1iZXI7XG4gIGRlY2s6IFNvdWxJZFtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBlcXVpcHBlZCBTb3VscywgYXQgbW9zdCBERUNLX1NJWkUsIGF0IGxlYXN0IDFcbiAgc291bHM6IFJlY29yZDxTb3VsSWQsIFNvdWxQcm9ncmVzcz47ICAgICAgICAgIC8vIFBMQUNFSE9MREVSIHByb2dyZXNzaW9uIHVudGlsIHBhY2tzIGV4aXN0XG4gIHNldHRpbmdzOiBTZXR0aW5nczsgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzb3VuZCBzd2l0Y2hlczsgYm90aCBvbiBieSBkZWZhdWx0XG4gIGRpZmZpY3VsdHk6IERpZmZpY3VsdHk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBjaG9zZW4gb24gSG9tZTsgYXBwbGllcyB0byB0aGUgbmV4dCBydW5cbiAgc3RhZ2U6IHN0cmluZzsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZSBzdGFnZSBwaWNrZWQgb24gSG9tZSAoaWQgZnJvbSB3YXZlcy50cyBTVEFHRVMpXG4gIHNlZW46IHN0cmluZ1tdIHwgbnVsbDsgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bmxvY2sga2V5cyB3aG9zZSBjZWxlYnJhdGlvbiB3YXMgYWxyZWFkeSBzaG93biAobnVsbDogb2xkZXIgc2F2ZSwgc2VlZGVkIG9uIGZpcnN0IGxvb2spXG4gIHBhY2tzOiBQYWNrSXRlbVtdOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bm9wZW5lZCBTb3VsIFBhY2tzXG4gIG5leHRQYWNrSWQ6IG51bWJlcjtcbiAgY2xlYXJzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+OyAgICAgICAgICAgICAgIC8vIHN0YWdlIGNsZWFycywga2V5ZWQgJ3N0YWdlOmRpZmZpY3VsdHknXG4gIHJlcGxheU1ldGVyOiBudW1iZXI7ICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXBsYXkgY2xlYXJzIHRvd2FyZCB0aGUgbmV4dCByZXBsYXkgcGFja1xuICBlbmRsZXNzOiB7IGJlc3Q6IG51bWJlciB9OyAgICAgICAgICAgICAgICAgICAgLy8gRW5kbGVzcyBEZXB0aHM6IHRoZSBkZWVwZXN0IHdhdmUgY2xlYXJlZFxuICBnb2xkU2NhbGU6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gMiA9IGdvbGQgaW4gdGhlIGN1cnJlbnQgKHgxMDApIHVuaXRzOyBhIHNhdmUgd2l0aG91dCBpdCBob2xkcyBnb2xkIGluIHRoZSBvbGQgc21hbGwgdW5pdHMgYW5kIGlzIGNvbnZlcnRlZCBvbiBsb2FkXG4gIGdvbGQ6IG51bWJlcjsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzcGVudCBvbiBTb3VsIGxldmVsLXVwcyAoYWxvbmdzaWRlIGNvcGllcyk7IGVhcm5lZCBwZXIgd2F2ZSBjbGVhcmVkIGFuZCBmcm9tIG9wZW5pbmcgcGFja3NcbiAgZGFpbHk6IHsgZGF5OiBudW1iZXI7IHdvbjogYm9vbGVhbiB9IHwgbnVsbDsgIC8vIHRoZSBsYXN0IERhaWx5IENoYWxsZW5nZSBkYXkgcGxheWVkIGFuZCB3aGV0aGVyIGl0cyBvbmUtdGltZSByZXdhcmQgd2FzIHRha2VuXG59XG4vKiogR29sZCBnaXZlbiBvbmNlIHRvIGEgc2F2ZSB0aGF0IHByZWRhdGVzIGdvbGQgYW5kIGhhcyBwcm9ncmVzcy4gKi9cbmV4cG9ydCBjb25zdCBDQVRDSF9VUF9HT0xEID0gNDAwMDA7XG5leHBvcnQgaW50ZXJmYWNlIFN0b3JlIHsgZ2V0SXRlbShrOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsOyBzZXRJdGVtKGs6IHN0cmluZywgdjogc3RyaW5nKTogdm9pZCB9XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0U2F2ZSgpOiBTYXZlIHtcbiAgY29uc3Qgc291bHMgPSB7fSBhcyBSZWNvcmQ8U291bElkLCBTb3VsUHJvZ3Jlc3M+O1xuICBmb3IgKGNvbnN0IGlkIG9mIFNPVUxTKSBzb3Vsc1tpZF0gPSB7IGxldmVsOiAxLCBjb3BpZXM6IDAgfTtcbiAgcmV0dXJuIHsgdjogVkVSU0lPTiwgZGVjazogU09VTFMuc2xpY2UoMCwgREVDS19TSVpFKSwgc291bHMsIHNldHRpbmdzOiB7IG11c2ljOiB0cnVlLCBzZng6IHRydWUgfSwgZGlmZmljdWx0eTogJ25vcm1hbCcsIHN0YWdlOiAnY3J5cHQnLCBzZWVuOiBbXSwgcGFja3M6IFtdLCBuZXh0UGFja0lkOiAxLCBjbGVhcnM6IHt9LCByZXBsYXlNZXRlcjogMCwgZW5kbGVzczogeyBiZXN0OiAwIH0sIGdvbGRTY2FsZTogMiwgZ29sZDogMCwgZGFpbHk6IG51bGwgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJyb3dzZXJTdG9yZSgpOiBTdG9yZSB8IG51bGwgeyB0cnkgeyByZXR1cm4gdHlwZW9mIGxvY2FsU3RvcmFnZSA9PT0gJ3VuZGVmaW5lZCcgPyBudWxsIDogbG9jYWxTdG9yYWdlOyB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH0gfVxuXG4vKiogUmVwYWlyIHdoYXRldmVyIHdhcyBzdG9yZWQ6IHVua25vd24gU291bHMgZHJvcHBlZCwgZHVwbGljYXRlcyByZW1vdmVkLCBkZWNrIGNhcHBlZCwgbm90aGluZyBlbXB0eS4gT2xkIHZlcnNpb25zIGtlZXAgdGhlaXIgcHJvZ3Jlc3MuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemUocmF3OiBhbnkpOiBTYXZlIHtcbiAgY29uc3QgYmFzZSA9IGRlZmF1bHRTYXZlKCk7XG4gIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09ICdvYmplY3QnKSByZXR1cm4gYmFzZTtcbiAgY29uc3QgZGVjazogU291bElkW10gPSBbXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LmRlY2spKSBmb3IgKGNvbnN0IGQgb2YgcmF3LmRlY2spIGlmIChTT1VMUy5pbmNsdWRlcyhkKSAmJiAhZGVjay5pbmNsdWRlcyhkKSAmJiBkZWNrLmxlbmd0aCA8IERFQ0tfU0laRSkgZGVjay5wdXNoKGQpO1xuICBpZiAoZGVjay5sZW5ndGgpIGJhc2UuZGVjayA9IGRlY2s7XG4gIGlmIChyYXcuc291bHMgJiYgdHlwZW9mIHJhdy5zb3VscyA9PT0gJ29iamVjdCcpIHtcbiAgICBmb3IgKGNvbnN0IGlkIG9mIFNPVUxTKSB7XG4gICAgICBjb25zdCBwID0gcmF3LnNvdWxzW2lkXTtcbiAgICAgIGlmIChwICYmIE51bWJlci5pc0Zpbml0ZShwLmxldmVsKSAmJiBOdW1iZXIuaXNGaW5pdGUocC5jb3BpZXMpKSBiYXNlLnNvdWxzW2lkXSA9IHsgbGV2ZWw6IE1hdGgubWF4KDEsIE1hdGguZmxvb3IocC5sZXZlbCkpLCBjb3BpZXM6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IocC5jb3BpZXMpKSB9O1xuICAgIH1cbiAgfVxuICBpZiAocmF3LnNldHRpbmdzICYmIHR5cGVvZiByYXcuc2V0dGluZ3MgPT09ICdvYmplY3QnKSB7XG4gICAgaWYgKHR5cGVvZiByYXcuc2V0dGluZ3MubXVzaWMgPT09ICdib29sZWFuJykgYmFzZS5zZXR0aW5ncy5tdXNpYyA9IHJhdy5zZXR0aW5ncy5tdXNpYztcbiAgICBpZiAodHlwZW9mIHJhdy5zZXR0aW5ncy5zZnggPT09ICdib29sZWFuJykgYmFzZS5zZXR0aW5ncy5zZnggPSByYXcuc2V0dGluZ3Muc2Z4O1xuICB9XG4gIGlmIChESUZGSUNVTFRJRVMuaW5jbHVkZXMocmF3LmRpZmZpY3VsdHkpKSBiYXNlLmRpZmZpY3VsdHkgPSByYXcuZGlmZmljdWx0eTtcbiAgaWYgKHR5cGVvZiByYXcuc3RhZ2UgPT09ICdzdHJpbmcnICYmIC9eW2EtejAtOV8tXXsxLDI0fSQvLnRlc3QocmF3LnN0YWdlKSkgYmFzZS5zdGFnZSA9IHJhdy5zdGFnZTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3LnNlZW4pKSBiYXNlLnNlZW4gPSByYXcuc2Vlbi5maWx0ZXIoKGs6IGFueSkgPT4gdHlwZW9mIGsgPT09ICdzdHJpbmcnICYmIGsubGVuZ3RoIDwgNDApLnNsaWNlKC04MCk7XG4gIGVsc2UgaWYgKHJhdy5jbGVhcnMgJiYgdHlwZW9mIHJhdy5jbGVhcnMgPT09ICdvYmplY3QnICYmIE9iamVjdC5rZXlzKHJhdy5jbGVhcnMpLmxlbmd0aCkgYmFzZS5zZWVuID0gbnVsbDsgICAgLy8gYW4gZXhpc3RpbmcgcGxheWVyOiBkbyBub3QgcmVwbGF5IG9sZCB1bmxvY2tzXG4gIGlmIChBcnJheS5pc0FycmF5KHJhdy5wYWNrcykpIHtcbiAgICBjb25zdCBpZHMgPSBuZXcgU2V0PG51bWJlcj4oKTtcbiAgICBmb3IgKGNvbnN0IHAgb2YgcmF3LnBhY2tzKSB7XG4gICAgICBpZiAoYmFzZS5wYWNrcy5sZW5ndGggPj0gOTkgfHwgIXAgfHwgIU51bWJlci5pc0ludGVnZXIocC5pZCkgfHwgcC5pZCA8IDEgfHwgaWRzLmhhcyhwLmlkKSB8fCAhTnVtYmVyLmlzSW50ZWdlcihwLnRpZXIpIHx8IHAudGllciA8IDEgfHwgcC50aWVyID4gUEFDS19USUVSUykgY29udGludWU7XG4gICAgICBpZHMuYWRkKHAuaWQpOyBiYXNlLnBhY2tzLnB1c2goeyBpZDogcC5pZCwgdGllcjogcC50aWVyLCBzb3VyY2U6IHR5cGVvZiBwLnNvdXJjZSA9PT0gJ3N0cmluZycgPyBwLnNvdXJjZS5zbGljZSgwLCA0MCkgOiAnJyB9KTtcbiAgICB9XG4gIH1cbiAgY29uc3QgbWF4SWQgPSBiYXNlLnBhY2tzLnJlZHVjZSgobiwgcCkgPT4gTWF0aC5tYXgobiwgcC5pZCksIDApO1xuICBiYXNlLm5leHRQYWNrSWQgPSBNYXRoLm1heChtYXhJZCArIDEsIE51bWJlci5pc0ludGVnZXIocmF3Lm5leHRQYWNrSWQpICYmIHJhdy5uZXh0UGFja0lkID4gMCA/IHJhdy5uZXh0UGFja0lkIDogMSk7XG4gIGlmIChyYXcuY2xlYXJzICYmIHR5cGVvZiByYXcuY2xlYXJzID09PSAnb2JqZWN0JykgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMocmF3LmNsZWFycykpIGlmICh0eXBlb2YgayA9PT0gJ3N0cmluZycgJiYgay5sZW5ndGggPCA0MCAmJiBOdW1iZXIuaXNJbnRlZ2VyKHYpICYmICh2IGFzIG51bWJlcikgPiAwKSBiYXNlLmNsZWFyc1trXSA9IHYgYXMgbnVtYmVyO1xuICBpZiAoTnVtYmVyLmlzSW50ZWdlcihyYXcucmVwbGF5TWV0ZXIpICYmIHJhdy5yZXBsYXlNZXRlciA+PSAwICYmIHJhdy5yZXBsYXlNZXRlciA8IDUwKSBiYXNlLnJlcGxheU1ldGVyID0gcmF3LnJlcGxheU1ldGVyO1xuICBpZiAocmF3LmVuZGxlc3MgJiYgTnVtYmVyLmlzSW50ZWdlcihyYXcuZW5kbGVzcy5iZXN0KSAmJiByYXcuZW5kbGVzcy5iZXN0ID49IDAgJiYgcmF3LmVuZGxlc3MuYmVzdCA8PSA5OTk5KSBiYXNlLmVuZGxlc3MuYmVzdCA9IHJhdy5lbmRsZXNzLmJlc3Q7XG4gIGlmIChOdW1iZXIuaXNJbnRlZ2VyKHJhdy5nb2xkKSAmJiByYXcuZ29sZCA+PSAwICYmIHJhdy5nb2xkIDw9IDFlOSkgYmFzZS5nb2xkID0gcmF3LmdvbGRTY2FsZSA9PT0gMiA/IHJhdy5nb2xkIDogTWF0aC5taW4oMWU5LCByYXcuZ29sZCAqIDEwMCk7ICAgLy8gZWFybHkgc2F2ZXMgY291bnRlZCBnb2xkIGluIHVuaXRzIDEwMCB0aW1lcyBzbWFsbGVyXG4gIGVsc2UgaWYgKHJhdy5nb2xkID09PSB1bmRlZmluZWQgJiYgT2JqZWN0LmtleXMoYmFzZS5jbGVhcnMpLmxlbmd0aCkgYmFzZS5nb2xkID0gQ0FUQ0hfVVBfR09MRDsgICAgICAgIC8vIGEgcGxheWVyIGZyb20gYmVmb3JlIGdvbGQgZXhpc3RlZDogb25lLXRpbWUgZ3JhbnQgc28gdGhlIG5ldyBjb3N0IGRvZXMgbm90IGxvY2sgdGhlaXIgc3RvY2twaWxlZCBjb3BpZXNcbiAgaWYgKHJhdy5kYWlseSAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdy5kYWlseS5kYXkpICYmIHJhdy5kYWlseS5kYXkgPiAwICYmIHJhdy5kYWlseS5kYXkgPCAxZTYpIGJhc2UuZGFpbHkgPSB7IGRheTogcmF3LmRhaWx5LmRheSwgd29uOiAhIXJhdy5kYWlseS53b24gfTtcbiAgcmV0dXJuIGJhc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkU2F2ZShzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiBTYXZlIHtcbiAgdHJ5IHsgY29uc3QgdCA9IHN0b3JlICYmIHN0b3JlLmdldEl0ZW0oS0VZKTsgcmV0dXJuIHNhbml0aXplKHQgPyBKU09OLnBhcnNlKHQpIDogbnVsbCk7IH0gY2F0Y2ggeyByZXR1cm4gZGVmYXVsdFNhdmUoKTsgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVTYXZlKHNhdmU6IFNhdmUsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzYXZlKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDoga2VlcCBwbGF5aW5nICovIH1cbn1cblxuLyoqIENoYW5nZSBzb3VuZCBzZXR0aW5ncyB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZVNldHRpbmdzKHBhdGNoOiBQYXJ0aWFsPFNldHRpbmdzPiwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogU2V0dGluZ3Mge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBzLnNldHRpbmdzID0geyAuLi5zLnNldHRpbmdzLCAuLi5wYXRjaCB9OyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcy5zZXR0aW5ncztcbn1cblxuLyoqIFJlbWVtYmVyIHRoZSBjaG9zZW4gZGlmZmljdWx0eSB3aXRob3V0IHRvdWNoaW5nIHRoZSByZXN0IG9mIHRoZSBzYXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVwZGF0ZURpZmZpY3VsdHkoZDogRGlmZmljdWx0eSwgc3RvcmU6IFN0b3JlIHwgbnVsbCA9IGJyb3dzZXJTdG9yZSgpKTogRGlmZmljdWx0eSB7XG4gIGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IHMuZGlmZmljdWx0eSA9IERJRkZJQ1VMVElFUy5pbmNsdWRlcyhkKSA/IGQgOiBzLmRpZmZpY3VsdHk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiBzLmRpZmZpY3VsdHk7XG59XG4iLCAiLy8gUGVybWFuZW50IHByb2dyZXNzaW9uOiBzdGFnZSBjbGVhcnMgLT4gU291bCBQYWNrcyAtPiBjb3BpZXMgLT4gU291bCBsZXZlbHMuIFB1cmUgZnVuY3Rpb25zIHRoYXQgY2hhbmdlIGEgU2F2ZSAodGhlIGNhbGxlciBwZXJzaXN0cyBpdCkuXG4vLyBQbGFjZWhvbGRlciBudW1iZXJzLCBsaWtlIHBhY2tzLnRzLiBJbi1ydW4gc3RhciBtZXJnaW5nIGlzIGEgc2VwYXJhdGUsIHRlbXBvcmFyeSBzeXN0ZW0gYW5kIG5ldmVyIHRvdWNoZXMgYW55IG9mIHRoaXMuXG5cbmltcG9ydCB7IEJBTEFOQ0UgfSBmcm9tICcuL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgRU5ETEVTU19QQUNLX0VWRVJZLCBlbmRsZXNzUGFja1RpZXIgfSBmcm9tICcuL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgTEVWRUxfQ09TVF9NVUxULCBQQUNLX1RJRVJTLCBSQVJJVFlfT0YsIG9wZW5QYWNrIH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFBhY2tJdGVtLCBQYWNrUmVzdWx0IH0gZnJvbSAnLi9wYWNrcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlLCB3cml0ZVNhdmUgfSBmcm9tICcuL3NhdmUudHMnO1xuaW1wb3J0IHsgU1RBR0VTLCBzdGFnZUJ5SWQsIHN0YWdlSW5kZXggfSBmcm9tICcuL3dhdmVzLnRzJztcbmltcG9ydCB0eXBlIHsgRGlmZmljdWx0eSwgU2F2ZSwgU3RvcmUgfSBmcm9tICcuL3NhdmUudHMnO1xuXG5leHBvcnQgY29uc3QgTUFYX1BBQ0tTID0gOTk7XG5cbi8qKiBXaGVyZSBwYWNrcyBjb21lIGZyb20uIFBMQUNFSE9MREVSLiBGaXJzdCBjbGVhciBvZiBhIHN0YWdlIG9uIGVhY2ggZGlmZmljdWx0eSBnaXZlcyBvbmUgaW1wcm92ZWQgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgYSBtZXRlci4gKi9cbmV4cG9ydCBjb25zdCBSRVdBUkRTID0ge1xuICBmaXJzdENsZWFyVGllcjogeyBlYXN5OiAxLCBub3JtYWw6IDIsIGhhcmQ6IDIsIG5pZ2h0bWFyZTogMyB9IGFzIFJlY29yZDxEaWZmaWN1bHR5LCBudW1iZXI+LFxuICByZXBsYXlUaWVyOiAxLFxuICByZXBsYXlDbGVhcnNQZXJQYWNrOiAyLFxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGxldmVsc1xuZXhwb3J0IGNvbnN0IG1heExldmVsID0gKCk6IG51bWJlciA9PiBCQUxBTkNFLmxldmVsLmNvcGllc1RvTGV2ZWwubGVuZ3RoICsgMTtcbmV4cG9ydCBjb25zdCBpc01heExldmVsID0gKGxldmVsOiBudW1iZXIpOiBib29sZWFuID0+IGxldmVsID49IG1heExldmVsKCk7XG4vKiogQ29waWVzIG5lZWRlZCB0byB0YWtlIGBzb3VsYCBmcm9tIGBsZXZlbGAgdG8gdGhlIG5leHQgb25lICgwIHdoZW4gYWxyZWFkeSBtYXgpLiBSYXJlciBTb3VscyBuZWVkIGZld2VyLiAqL1xuZXhwb3J0IGNvbnN0IGNvcGllc05lZWRlZCA9IChsZXZlbDogbnVtYmVyLCBzb3VsOiBTb3VsSWQpOiBudW1iZXIgPT4gKGlzTWF4TGV2ZWwobGV2ZWwpID8gMCA6IE1hdGgubWF4KDEsIE1hdGgucm91bmQoQkFMQU5DRS5sZXZlbC5jb3BpZXNUb0xldmVsW2xldmVsIC0gMV0gKiBMRVZFTF9DT1NUX01VTFRbUkFSSVRZX09GW3NvdWxdXSkpKTtcbi8qKlxuICogT25lIHJlcXVpcmVtZW50IG9mIGFuIHVwZ3JhZGUuIFRvZGF5IG9ubHkgY29waWVzOyB0aGUgY29uZmlybSBwb3B1cCBsaXN0cyBldmVyeSBlbnRyeSB3aXRoIGhhdmUgLyBuZWVkLCBhbmQgQ29uZmlybSBpcyBhbGxvd2VkIG9ubHkgd2hlbiBhbGwgYXJlIG1ldC5cbiAqIEdvbGQgd2lsbCBzaW1wbHkgYmVjb21lIGEgc2Vjb25kIGVudHJ5IGhlcmUgKHsgaWQ6ICdnb2xkJywgLi4uIH0pIGFuZCBiZSBzcGVudCBpbiBsZXZlbFVwKCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBncmFkZUNvc3QgeyBpZDogJ2NvcGllcycgfCAnZ29sZCc7IGxhYmVsOiBzdHJpbmc7IGhhdmU6IG51bWJlcjsgbmVlZDogbnVtYmVyOyBvazogYm9vbGVhbiB9XG4vKiogR29sZCB0byB0YWtlIGEgU291bCBmcm9tIGBsZXZlbGAgdG8gdGhlIG5leHQgb25lICgwIGF0IG1heCkuICovXG5leHBvcnQgY29uc3QgZ29sZE5lZWRlZCA9IChsZXZlbDogbnVtYmVyKTogbnVtYmVyID0+IChpc01heExldmVsKGxldmVsKSA/IDAgOiBCQUxBTkNFLmxldmVsLmdvbGRUb0xldmVsW2xldmVsIC0gMV0pO1xuZXhwb3J0IGZ1bmN0aW9uIHVwZ3JhZGVDb3N0cyhzYXZlOiBTYXZlLCBzb3VsOiBTb3VsSWQpOiBVcGdyYWRlQ29zdFtdIHtcbiAgY29uc3QgcCA9IHNhdmUuc291bHNbc291bF07IGlmIChpc01heExldmVsKHAubGV2ZWwpKSByZXR1cm4gW107XG4gIGNvbnN0IG5lZWQgPSBjb3BpZXNOZWVkZWQocC5sZXZlbCwgc291bCk7XG4gIGNvbnN0IGdvbGQgPSBnb2xkTmVlZGVkKHAubGV2ZWwpO1xuICByZXR1cm4gW3sgaWQ6ICdjb3BpZXMnLCBsYWJlbDogJ0NvcGllcycsIGhhdmU6IHAuY29waWVzLCBuZWVkLCBvazogcC5jb3BpZXMgPj0gbmVlZCB9LCB7IGlkOiAnZ29sZCcsIGxhYmVsOiAnR29sZCcsIGhhdmU6IHNhdmUuZ29sZCwgbmVlZDogZ29sZCwgb2s6IHNhdmUuZ29sZCA+PSBnb2xkIH1dO1xufVxuZXhwb3J0IGNvbnN0IGNhbkFmZm9yZCA9IChjb3N0czogVXBncmFkZUNvc3RbXSk6IGJvb2xlYW4gPT4gY29zdHMubGVuZ3RoID4gMCAmJiBjb3N0cy5ldmVyeSgoYykgPT4gYy5vayk7XG5leHBvcnQgY29uc3QgY2FuTGV2ZWxVcCA9IChzYXZlOiBTYXZlLCBzb3VsOiBTb3VsSWQpOiBib29sZWFuID0+IGNhbkFmZm9yZCh1cGdyYWRlQ29zdHMoc2F2ZSwgc291bCkpO1xuLyoqIFBheSBldmVyeSBjb3N0IGFuZCBnYWluIGEgbGV2ZWwuIFJldHVybnMgZmFsc2UgKGFuZCBjaGFuZ2VzIG5vdGhpbmcpIGlmIHRoZSBTb3VsIGlzIG5vdCByZWFkeS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsZXZlbFVwKHNhdmU6IFNhdmUsIHNvdWw6IFNvdWxJZCk6IGJvb2xlYW4ge1xuICBjb25zdCBjb3N0cyA9IHVwZ3JhZGVDb3N0cyhzYXZlLCBzb3VsKTsgaWYgKCFjYW5BZmZvcmQoY29zdHMpKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHAgPSBzYXZlLnNvdWxzW3NvdWxdOyBmb3IgKGNvbnN0IGMgb2YgY29zdHMpIHsgaWYgKGMuaWQgPT09ICdjb3BpZXMnKSBwLmNvcGllcyAtPSBjLm5lZWQ7IGVsc2Ugc2F2ZS5nb2xkIC09IGMubmVlZDsgfVxuICBwLmxldmVsKys7IHJldHVybiB0cnVlO1xufVxuLyoqIERlYnVnZ2luZzogcHV0IGV2ZXJ5IFNvdWwgYmFjayB0byBsZXZlbCAxIChjb3BpZXMgYXJlIGtlcHQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0TGV2ZWxzKHNhdmU6IFNhdmUpOiB2b2lkIHsgZm9yIChjb25zdCBrIG9mIFNPVUxTKSBzYXZlLnNvdWxzW2tdLmxldmVsID0gMTsgfVxuLyoqIERlYnVnZ2luZzogZm9yZ2V0IGFsbCBjb2xsZWN0ZWQgY29waWVzIChsZXZlbHMgYXJlIGtlcHQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyQ29waWVzKHNhdmU6IFNhdmUpOiB2b2lkIHsgZm9yIChjb25zdCBrIG9mIFNPVUxTKSBzYXZlLnNvdWxzW2tdLmNvcGllcyA9IDA7IH1cbi8qKiBNdWx0aXBsaWVyIGFwcGxpZWQgdG8gYSBTb3VsJ3MgaGVhbHRoL2RhbWFnZSBmcm9tIGl0cyBwZXJtYW5lbnQgbGV2ZWwgKGxldmVsIDEgPSAxLjApLiAqL1xuZXhwb3J0IGNvbnN0IGxldmVsTXVsdCA9IChsZXZlbDogbnVtYmVyLCBzdGF0OiAnaHAnIHwgJ2RtZycpOiBudW1iZXIgPT4gMSArIChNYXRoLm1heCgxLCBsZXZlbCkgLSAxKSAqIEJBTEFOQ0UubGV2ZWxbc3RhdF07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBnb2xkXG5leHBvcnQgY29uc3QgR09MRCA9IHsgdGllck11bHQ6IHsgZWFzeTogMC42LCBub3JtYWw6IDEsIGhhcmQ6IDEuNCwgbmlnaHRtYXJlOiAyIH0gYXMgUmVjb3JkPERpZmZpY3VsdHksIG51bWJlcj4sIHBhY2tQZXJUaWVyOiAxNTAwLCBkYWlseVdpbjogNTAwMCB9O1xuLyoqIEdvbGQgZm9yIGNsZWFyaW5nIG9uZSBjYW1wYWlnbiB3YXZlOiBtb3JlIGluIGxhdGVyIHN0YWdlcyBhbmQgb24gaGFyZGVyIHRpZXJzLiAqL1xuZXhwb3J0IGNvbnN0IHdhdmVHb2xkID0gKHN0YWdlOiBzdHJpbmcsIHRpZXI6IERpZmZpY3VsdHkgfCBzdHJpbmcpOiBudW1iZXIgPT4gTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgxMDAgKiAoNiArIDIgKiBzdGFnZUluZGV4KHN0YWdlKSkgKiAoR09MRC50aWVyTXVsdFt0aWVyIGFzIERpZmZpY3VsdHldID8/IDEpKSk7XG4vKiogR29sZCBmb3IgY2xlYXJpbmcgb25lIEVuZGxlc3Mgd2F2ZS4gKi9cbmV4cG9ydCBjb25zdCBlbmRsZXNzV2F2ZUdvbGQgPSAod2F2ZTogbnVtYmVyKTogbnVtYmVyID0+IDEwMCAqICg4ICsgTWF0aC5mbG9vcigwLjYgKiBNYXRoLm1heCgxLCB3YXZlKSkpO1xuLyoqIEdvbGQgZm9yIG9wZW5pbmcgYSBwYWNrIHRoYXQgZmluaXNoZWQgYXQgYHRpZXJgLiAqL1xuZXhwb3J0IGNvbnN0IHBhY2tHb2xkID0gKHRpZXI6IG51bWJlcik6IG51bWJlciA9PiBHT0xELnBhY2tQZXJUaWVyICogTWF0aC5tYXgoMSwgdGllcik7XG5leHBvcnQgZnVuY3Rpb24gYWRkR29sZChzYXZlOiBTYXZlLCBuOiBudW1iZXIpOiBudW1iZXIgeyBjb25zdCBnID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihuKSk7IHNhdmUuZ29sZCA9IE1hdGgubWluKDFlOSwgc2F2ZS5nb2xkICsgZyk7IHJldHVybiBnOyB9XG5leHBvcnQgZnVuY3Rpb24gYWRkR29sZEFuZFNhdmUobjogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IG51bWJlciB7IGNvbnN0IHMgPSBsb2FkU2F2ZShzdG9yZSk7IGNvbnN0IGcgPSBhZGRHb2xkKHMsIG4pOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gZzsgfVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGFja3NcbmV4cG9ydCBmdW5jdGlvbiBncmFudFBhY2soc2F2ZTogU2F2ZSwgdGllcjogbnVtYmVyLCBzb3VyY2U6IHN0cmluZyk6IFBhY2tJdGVtIHwgbnVsbCB7XG4gIGlmIChzYXZlLnBhY2tzLmxlbmd0aCA+PSBNQVhfUEFDS1MpIHJldHVybiBudWxsO1xuICBjb25zdCBwYWNrOiBQYWNrSXRlbSA9IHsgaWQ6IHNhdmUubmV4dFBhY2tJZCsrLCB0aWVyOiBNYXRoLm1heCgxLCBNYXRoLm1pbihQQUNLX1RJRVJTLCBNYXRoLmZsb29yKHRpZXIpKSksIHNvdXJjZSB9O1xuICBzYXZlLnBhY2tzLnB1c2gocGFjayk7IHJldHVybiBwYWNrO1xufVxuXG4vKiogT3BlbiBhbiBvd25lZCBwYWNrOiBpdCBpcyByZW1vdmVkIGFuZCBpdHMgY29waWVzIGFyZSBhZGRlZCB0byB0aGUgU291bHMgaW1tZWRpYXRlbHkgKHNvIG5vdGhpbmcgaXMgbG9zdCBpZiB0aGUgcGFnZSBjbG9zZXMgbWlkLWFuaW1hdGlvbikuICovXG5leHBvcnQgZnVuY3Rpb24gb3Blbk93bmVkUGFjayhzYXZlOiBTYXZlLCBwYWNrSWQ6IG51bWJlciwgcm5nOiBSbmcpOiBQYWNrUmVzdWx0IHwgbnVsbCB7XG4gIGNvbnN0IGkgPSBzYXZlLnBhY2tzLmZpbmRJbmRleCgocCkgPT4gcC5pZCA9PT0gcGFja0lkKTsgaWYgKGkgPCAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGFjayA9IHNhdmUucGFja3NbaV07IHNhdmUucGFja3Muc3BsaWNlKGksIDEpO1xuICBjb25zdCByZXN1bHQgPSBvcGVuUGFjayhwYWNrLnRpZXIsIHJuZyk7XG4gIGZvciAoY29uc3QgciBvZiByZXN1bHQucmV2ZWFscykgc2F2ZS5zb3Vsc1tyLnNvdWxdLmNvcGllcyArPSByLmNvcGllcztcbiAgYWRkR29sZChzYXZlLCBwYWNrR29sZChyZXN1bHQuZmluYWxUaWVyKSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xlYXJSZXdhcmQgeyBmaXJzdDogYm9vbGVhbjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyByZXBsYXlNZXRlcjogbnVtYmVyOyByZXBsYXlOZWVkZWQ6IG51bWJlcjsgdW5sb2NrZWQ6IHN0cmluZ1tdIH1cbi8qKiBBIHN0YWdlIHdhcyBjbGVhcmVkIG9uIGBkaWZmaWN1bHR5YC4gVGhlIGZpcnN0IGNsZWFyIG9uIHRoYXQgZGlmZmljdWx0eSBncmFudHMgYSBiZXR0ZXIgcGFjazsgbGF0ZXIgY2xlYXJzIGZpbGwgdGhlIHJlcGxheSBtZXRlci4gKi9cbmZ1bmN0aW9uIHJlY29yZENsZWFyQmFzZShzYXZlOiBTYXZlLCBzdGFnZUlkOiBzdHJpbmcsIGRpZmZpY3VsdHk6IERpZmZpY3VsdHkpOiBPbWl0PENsZWFyUmV3YXJkLCAndW5sb2NrZWQnPiB7XG4gIGNvbnN0IGtleSA9IHN0YWdlSWQgKyAnOicgKyBkaWZmaWN1bHR5LCBiZWZvcmUgPSBzYXZlLmNsZWFyc1trZXldID8/IDA7XG4gIHNhdmUuY2xlYXJzW2tleV0gPSBiZWZvcmUgKyAxO1xuICBpZiAoYmVmb3JlID09PSAwKSByZXR1cm4geyBmaXJzdDogdHJ1ZSwgcGFjazogZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMuZmlyc3RDbGVhclRpZXJbZGlmZmljdWx0eV0gKyAoc3RhZ2VJbmRleChzdGFnZUlkKSA9PT0gU1RBR0VTLmxlbmd0aCAtIDEgPyAxIDogMCksICdGaXJzdCBjbGVhciBcdTAwQjcgJyArIGRpZmZpY3VsdHkpLCByZXBsYXlNZXRlcjogc2F2ZS5yZXBsYXlNZXRlciwgcmVwbGF5TmVlZGVkOiBSRVdBUkRTLnJlcGxheUNsZWFyc1BlclBhY2sgfTtcbiAgc2F2ZS5yZXBsYXlNZXRlcisrO1xuICBsZXQgcGFjazogUGFja0l0ZW0gfCBudWxsID0gbnVsbDtcbiAgaWYgKHNhdmUucmVwbGF5TWV0ZXIgPj0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrKSB7IHNhdmUucmVwbGF5TWV0ZXIgLT0gUkVXQVJEUy5yZXBsYXlDbGVhcnNQZXJQYWNrOyBwYWNrID0gZ3JhbnRQYWNrKHNhdmUsIFJFV0FSRFMucmVwbGF5VGllciwgJ1JlcGxheSByZXdhcmQnKTsgfVxuICByZXR1cm4geyBmaXJzdDogZmFsc2UsIHBhY2ssIHJlcGxheU1ldGVyOiBzYXZlLnJlcGxheU1ldGVyLCByZXBsYXlOZWVkZWQ6IFJFV0FSRFMucmVwbGF5Q2xlYXJzUGVyUGFjayB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcGVyc2lzdGVkIHdyYXBwZXJzICh1c2VkIGJ5IHRoZSBnYW1lIGJ1bmRsZSlcbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRDbGVhckFuZFNhdmUoc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5LCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IENsZWFyUmV3YXJkIHtcbiAgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZENsZWFyKHMsIHN0YWdlSWQsIGRpZmZpY3VsdHkpOyB3cml0ZVNhdmUocywgc3RvcmUpOyByZXR1cm4gcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIERhaWx5IENoYWxsZW5nZVxuZXhwb3J0IGludGVyZmFjZSBEYWlseVJld2FyZCB7IGZpcnN0OiBib29sZWFuOyBwYWNrOiBQYWNrSXRlbSB8IG51bGw7IGdvbGQ6IG51bWJlciB9XG4vKiogVGhlIGRheSdzIGNoYWxsZW5nZSB3YXMgd29uLiBPbmx5IHRoZSBmaXJzdCB3aW4gb2YgYSBnaXZlbiBkYXkgcGF5cyAoYSBUaWVyIDEgcGFjayBhbmQgc29tZSBnb2xkKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmREYWlseVdpbihzYXZlOiBTYXZlLCBkYXk6IG51bWJlcik6IERhaWx5UmV3YXJkIHtcbiAgaWYgKHNhdmUuZGFpbHkgJiYgc2F2ZS5kYWlseS5kYXkgPT09IGRheSAmJiBzYXZlLmRhaWx5LndvbikgcmV0dXJuIHsgZmlyc3Q6IGZhbHNlLCBwYWNrOiBudWxsLCBnb2xkOiAwIH07XG4gIHNhdmUuZGFpbHkgPSB7IGRheSwgd29uOiB0cnVlIH07XG4gIHJldHVybiB7IGZpcnN0OiB0cnVlLCBwYWNrOiBncmFudFBhY2soc2F2ZSwgMSwgJ0RhaWx5IGNoYWxsZW5nZScpLCBnb2xkOiBhZGRHb2xkKHNhdmUsIEdPTEQuZGFpbHlXaW4pIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRGFpbHlXaW5BbmRTYXZlKGRheTogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IERhaWx5UmV3YXJkIHsgY29uc3QgcyA9IGxvYWRTYXZlKHN0b3JlKTsgY29uc3QgciA9IHJlY29yZERhaWx5V2luKHMsIGRheSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByOyB9XG4vKiogSGFzIHRvZGF5J3MgcmV3YXJkIGFscmVhZHkgYmVlbiB0YWtlbj8gKi9cbmV4cG9ydCBjb25zdCBkYWlseURvbmUgPSAoc2F2ZTogU2F2ZSwgZGF5OiBudW1iZXIpOiBib29sZWFuID0+ICEhc2F2ZS5kYWlseSAmJiBzYXZlLmRhaWx5LmRheSA9PT0gZGF5ICYmIHNhdmUuZGFpbHkud29uO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gRW5kbGVzcyBEZXB0aHNcbmV4cG9ydCBpbnRlcmZhY2UgRW5kbGVzc1Jld2FyZCB7IHdhdmU6IG51bWJlcjsgcGFjazogUGFja0l0ZW0gfCBudWxsOyBuZXdCZXN0OiBib29sZWFuIH1cbi8qKiBXYXZlIGB3YXZlYCBvZiBhbiBlbmRsZXNzIHJ1biB3YXMgY2xlYXJlZDogYSBwYWNrIG9uIGV2ZXJ5IDEwdGggd2F2ZSAoYmV0dGVyIHRpZXJzIGRlZXBlciksIGFuZCB0aGUgYmVzdCBkZXB0aCBpcyByZW1lbWJlcmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZEVuZGxlc3NXYXZlKHNhdmU6IFNhdmUsIHdhdmU6IG51bWJlcik6IEVuZGxlc3NSZXdhcmQge1xuICBjb25zdCBuZXdCZXN0ID0gd2F2ZSA+IHNhdmUuZW5kbGVzcy5iZXN0OyBpZiAobmV3QmVzdCkgc2F2ZS5lbmRsZXNzLmJlc3QgPSB3YXZlO1xuICBjb25zdCBwYWNrID0gd2F2ZSA+IDAgJiYgd2F2ZSAlIEVORExFU1NfUEFDS19FVkVSWSA9PT0gMCA/IGdyYW50UGFjayhzYXZlLCBlbmRsZXNzUGFja1RpZXIod2F2ZSksICdFbmRsZXNzIFx1MDBCNyB3YXZlICcgKyB3YXZlKSA6IG51bGw7XG4gIHJldHVybiB7IHdhdmUsIHBhY2ssIG5ld0Jlc3QgfTtcbn1cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFbmRsZXNzV2F2ZUFuZFNhdmUod2F2ZTogbnVtYmVyLCBzdG9yZT86IFN0b3JlIHwgbnVsbCk6IEVuZGxlc3NSZXdhcmQge1xuICBjb25zdCBzID0gbG9hZFNhdmUoc3RvcmUpOyBjb25zdCByID0gcmVjb3JkRW5kbGVzc1dhdmUocywgd2F2ZSk7IHdyaXRlU2F2ZShzLCBzdG9yZSk7IHJldHVybiByO1xufVxuLyoqIEVuZGxlc3MgRGVwdGhzIG9wZW5zIG9uY2UgdGhlIGxhc3QgY2FtcGFpZ24gc3RhZ2UgaGFzIGJlZW4gY2xlYXJlZCBvbiBOb3JtYWwuICovXG5leHBvcnQgY29uc3QgZW5kbGVzc1VubG9ja2VkID0gKHNhdmU6IFNhdmUpOiBib29sZWFuID0+IGNsZWFyQ291bnQoc2F2ZSwgU1RBR0VTW1NUQUdFUy5sZW5ndGggLSAxXS5pZCwgJ25vcm1hbCcpID4gMDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHVubG9jayBydWxlc1xuLy8gRWFzeSBhbmQgTm9ybWFsIGFyZSBvcGVuIG9uIGV2ZXJ5IHVubG9ja2VkIHN0YWdlLiBDbGVhcmluZyBOb3JtYWwgb3BlbnMgSGFyZCBvbiB0aGF0IHN0YWdlIEFORCB1bmxvY2tzIHRoZSBuZXh0IHN0YWdlLiBDbGVhcmluZyBIYXJkIG9wZW5zIE5pZ2h0bWFyZS5cbmV4cG9ydCBjb25zdCBjbGVhckNvdW50ID0gKHNhdmU6IFNhdmUsIHN0YWdlOiBzdHJpbmcsIGQ6IERpZmZpY3VsdHkpOiBudW1iZXIgPT4gc2F2ZS5jbGVhcnNbc3RhZ2UgKyAnOicgKyBkXSA/PyAwO1xuZXhwb3J0IGZ1bmN0aW9uIHN0YWdlVW5sb2NrZWQoc2F2ZTogU2F2ZSwgaW5kZXg6IG51bWJlcik6IGJvb2xlYW4geyByZXR1cm4gaW5kZXggPD0gMCB8fCAoaW5kZXggPCBTVEFHRVMubGVuZ3RoICYmIGNsZWFyQ291bnQoc2F2ZSwgU1RBR0VTW2luZGV4IC0gMV0uaWQsICdub3JtYWwnKSA+IDApOyB9XG5leHBvcnQgZnVuY3Rpb24gZGlmZmljdWx0eVVubG9ja2VkKHNhdmU6IFNhdmUsIHN0YWdlOiBzdHJpbmcsIGQ6IERpZmZpY3VsdHkpOiBib29sZWFuIHtcbiAgY29uc3QgaWR4ID0gU1RBR0VTLmZpbmRJbmRleCgocykgPT4gcy5pZCA9PT0gc3RhZ2UpOyBpZiAoaWR4IDwgMCB8fCAhc3RhZ2VVbmxvY2tlZChzYXZlLCBpZHgpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChkID09PSAnZWFzeScgfHwgZCA9PT0gJ25vcm1hbCcpIHJldHVybiB0cnVlO1xuICByZXR1cm4gZCA9PT0gJ2hhcmQnID8gY2xlYXJDb3VudChzYXZlLCBzdGFnZSwgJ25vcm1hbCcpID4gMCA6IGNsZWFyQ291bnQoc2F2ZSwgc3RhZ2UsICdoYXJkJykgPiAwO1xufVxuLyoqIFdoeSBhIHN0YWdlIGlzIGxvY2tlZCAoZW1wdHkgd2hlbiBpdCBpcyBvcGVuKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFnZUxvY2tSZWFzb24oc2F2ZTogU2F2ZSwgaW5kZXg6IG51bWJlcik6IHN0cmluZyB7IHJldHVybiBzdGFnZVVubG9ja2VkKHNhdmUsIGluZGV4KSA/ICcnIDogJ0NsZWFyICcgKyBTVEFHRVNbaW5kZXggLSAxXS5uYW1lICsgJyBvbiBOb3JtYWwgdG8gdW5sb2NrLic7IH1cbi8qKiBXaHkgYSB0aWVyIGlzIGxvY2tlZCAoZW1wdHkgd2hlbiBpdCBpcyBvcGVuKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaWZmaWN1bHR5TG9ja1JlYXNvbihzYXZlOiBTYXZlLCBzdGFnZTogc3RyaW5nLCBkOiBEaWZmaWN1bHR5KTogc3RyaW5nIHtcbiAgaWYgKGRpZmZpY3VsdHlVbmxvY2tlZChzYXZlLCBzdGFnZSwgZCkpIHJldHVybiAnJztcbiAgY29uc3QgaWR4ID0gc3RhZ2VJbmRleChzdGFnZSk7IGlmICghc3RhZ2VVbmxvY2tlZChzYXZlLCBpZHgpKSByZXR1cm4gc3RhZ2VMb2NrUmVhc29uKHNhdmUsIGlkeCk7XG4gIHJldHVybiBkID09PSAnaGFyZCcgPyAnQ2xlYXIgJyArIHN0YWdlQnlJZChzdGFnZSkubmFtZSArICcgb24gTm9ybWFsIHRvIHVubG9jayBIYXJkLicgOiAnQ2xlYXIgJyArIHN0YWdlQnlJZChzdGFnZSkubmFtZSArICcgb24gSGFyZCB0byB1bmxvY2sgTmlnaHRtYXJlLic7XG59XG4vKiogV2hhdGV2ZXIgd2FzIHNhdmVkLCBtYWtlIGl0IGEgc3RhZ2UgYW5kIHRpZXIgdGhlIHBsYXllciBtYXkgYWN0dWFsbHkgcGxheS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwbGF5YWJsZShzYXZlOiBTYXZlKTogeyBzdGFnZTogc3RyaW5nOyBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5IH0ge1xuICBsZXQgaWR4ID0gc3RhZ2VJbmRleChzYXZlLnN0YWdlKTsgd2hpbGUgKGlkeCA+IDAgJiYgIXN0YWdlVW5sb2NrZWQoc2F2ZSwgaWR4KSkgaWR4LS07XG4gIGNvbnN0IHN0YWdlID0gU1RBR0VTW2lkeF0uaWQ7XG4gIHJldHVybiB7IHN0YWdlLCBkaWZmaWN1bHR5OiBkaWZmaWN1bHR5VW5sb2NrZWQoc2F2ZSwgc3RhZ2UsIHNhdmUuZGlmZmljdWx0eSkgPyBzYXZlLmRpZmZpY3VsdHkgOiAnbm9ybWFsJyB9O1xufVxuXG4vKiogRXZlcnkgdW5sb2NrIHRoZSBwbGF5ZXIgbWF5IGJlIGNlbGVicmF0ZWQgZm9yOiBsYXRlciBzdGFnZXMgYW5kIHRoZSBIYXJkIC8gTmlnaHRtYXJlIHRpZXJzIChFYXN5LCBOb3JtYWwgYW5kIFN0YWdlIDEgYXJlIG9wZW4gZnJvbSB0aGUgc3RhcnQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVubG9ja2VkS2V5cyhzYXZlOiBTYXZlKTogc3RyaW5nW10ge1xuICBjb25zdCBrZXlzOiBzdHJpbmdbXSA9IFtdO1xuICBTVEFHRVMuZm9yRWFjaCgoc3QsIGkpID0+IHtcbiAgICBpZiAoaSA+IDAgJiYgc3RhZ2VVbmxvY2tlZChzYXZlLCBpKSkga2V5cy5wdXNoKCdzdGFnZTonICsgc3QuaWQpO1xuICAgIGZvciAoY29uc3QgZCBvZiBbJ2hhcmQnLCAnbmlnaHRtYXJlJ10gYXMgRGlmZmljdWx0eVtdKSBpZiAoZGlmZmljdWx0eVVubG9ja2VkKHNhdmUsIHN0LmlkLCBkKSkga2V5cy5wdXNoKCd0aWVyOicgKyBzdC5pZCArICc6JyArIGQpO1xuICB9KTtcbiAgaWYgKGVuZGxlc3NVbmxvY2tlZChzYXZlKSkga2V5cy5wdXNoKCdlbmRsZXNzJyk7XG4gIHJldHVybiBrZXlzO1xufVxuLyoqIFVubG9ja3Mgbm90IHlldCBjZWxlYnJhdGVkLiAqL1xuZXhwb3J0IGNvbnN0IG5ld1VubG9ja3MgPSAoc2F2ZTogU2F2ZSk6IHN0cmluZ1tdID0+IHVubG9ja2VkS2V5cyhzYXZlKS5maWx0ZXIoKGspID0+ICEoc2F2ZS5zZWVuID8/IFtdKS5pbmNsdWRlcyhrKSk7XG5jb25zdCBUSUVSX05BTUU6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IGhhcmQ6ICdIYXJkIG1vZGUnLCBuaWdodG1hcmU6ICdOaWdodG1hcmUgbW9kZScgfTtcbi8qKiBXb3JkcyBmb3IgYW4gdW5sb2NrIGtleSwgZm9yIGJhbm5lcnMuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVVbmxvY2soa2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoa2V5ID09PSAnZW5kbGVzcycpIHJldHVybiAnRW5kbGVzcyBEZXB0aHMgKG5ldyBtb2RlKSc7XG4gIGNvbnN0IFtraW5kLCBzdGFnZSwgdGllcl0gPSBrZXkuc3BsaXQoJzonKTtcbiAgaWYgKGtpbmQgPT09ICdzdGFnZScpIHJldHVybiBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWUgKyAnIChuZXcgc3RhZ2UpJztcbiAgcmV0dXJuIChUSUVSX05BTUVbdGllcl0gPz8gdGllcikgKyAnIG9uICcgKyBzdGFnZUJ5SWQoc3RhZ2UpLm5hbWU7XG59XG4vKiogQ2xlYXJpbmcgYSBzdGFnZTogcmV3YXJkcywgYW5kIHdoaWNoIHVubG9ja3MgdGhpcyBjbGVhciBvcGVuZWQuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkQ2xlYXIoc2F2ZTogU2F2ZSwgc3RhZ2VJZDogc3RyaW5nLCBkaWZmaWN1bHR5OiBEaWZmaWN1bHR5KTogQ2xlYXJSZXdhcmQge1xuICBjb25zdCBiZWZvcmUgPSB1bmxvY2tlZEtleXMoc2F2ZSksIHIgPSByZWNvcmRDbGVhckJhc2Uoc2F2ZSwgc3RhZ2VJZCwgZGlmZmljdWx0eSk7XG4gIHJldHVybiB7IC4uLnIsIHVubG9ja2VkOiB1bmxvY2tlZEtleXMoc2F2ZSkuZmlsdGVyKChrKSA9PiAhYmVmb3JlLmluY2x1ZGVzKGspKSB9O1xufVxuIiwgIi8vIFRoZSBwbGF5ZXIncyBjaGFyYWN0ZXI6IHRoZSBOZWNyb21hbmNlciAoYSByaWdnZWQgVHJpcG8gbW9kZWwsIFBpcGVsaW5lL3VuaXRzL25lY3JvbWFuY2VyLmpzb24pLlxuLy8gSGUgc3RhbmRzIGJlc2lkZSB0aGUgZ3JpZCwgdGFrZXMgdGhlIGhpdCB3aGVuIGFuIGFybXkgaXMgd2lwZWQgKGhlYXJ0cyBhcmUgSElTIGhlYWx0aCksIHVubGVhc2hlcyB0aGUgcmVwdWxzaW9uIHNob2Nrd2F2ZSBhbmQgcmFpc2VzXG4vLyB0aGUgZmFsbGVuLiBFdmVyeXRoaW5nIGhlcmUgaXMgYW5pbWF0aW9uIG9ubHk7IHRoZSBydWxlcyBsaXZlIGluIGNvcmUvcnVsZXMudHMuXG5kZWNsYXJlIGNvbnN0IEJBQllMT046IGFueTtcblxuZXhwb3J0IGNsYXNzIE5lY3JvbWFuY2VyIHtcbiAgaG9sZGVyOiBhbnk7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm1Ob2RlOiB0aGUgZ2FtZSBzZXRzIHBvc2l0aW9uOyBsb2NhbCArWiBpcyBoaXMgZmFjaW5nICh0aGUgZ2FtZSByb3RhdGVzIGhpbSB0byBmYWNlIHRoZSBiYXR0bGVmaWVsZClcbiAgcHJpdmF0ZSBlbnQ6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBoYW5kOiBhbnkgPSBudWxsOyBwcml2YXRlIHJpbmc6IGFueTsgcHJpdmF0ZSBwczogYW55O1xuICBwcml2YXRlIHQgPSAwOyBwcml2YXRlIGlkbGVUID0gMDsgcHJpdmF0ZSBuZXh0VGFwID0gODsgcHJpdmF0ZSBidXN5ID0gZmFsc2U7IHByaXZhdGUgZG93bmVkID0gZmFsc2U7IHByaXZhdGUgcmVhZG9ubHkgUyA9IDEuMzU7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSBzY2VuZTogYW55LCBwcml2YXRlIHNvZnQ6IGFueSwgY29udGFpbmVyOiBhbnkpIHtcbiAgICBjb25zdCBzID0gc2NlbmU7XG4gICAgdGhpcy5ob2xkZXIgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCduZWNybycsIHMpO1xuICAgIHRoaXMuZW50ID0gY29udGFpbmVyLmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ19uZWNybycsIGZhbHNlLCB7IGRvTm90SW5zdGFudGlhdGU6IHRydWUgfSk7XG4gICAgY29uc3Qgcm9vdCA9IHRoaXMuZW50LnJvb3ROb2Rlc1swXTsgcm9vdC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5TKTtcbiAgICByb290LmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uaXNQaWNrYWJsZSA9IGZhbHNlOyBtLmFsd2F5c1NlbGVjdEFzQWN0aXZlTWVzaCA9IHRydWU7IH0pO1xuICAgIHRoaXMuZW50LmFuaW1hdGlvbkdyb3Vwcy5mb3JFYWNoKChnOiBhbnkpID0+IHsgZy5zdG9wKCk7IGcuZW5hYmxlQmxlbmRpbmcgPSB0cnVlOyBnLmJsZW5kaW5nU3BlZWQgPSAwLjEyOyB0aGlzLmFuaW1zW2cubmFtZS5zcGxpdCgnXycpWzBdXSA9IGc7IH0pO1xuICAgIHRoaXMuaGFuZCA9IHJvb3QuZ2V0Q2hpbGRUcmFuc2Zvcm1Ob2RlcyhmYWxzZSkuZmluZCgobjogYW55KSA9PiBuLm5hbWUuaW5jbHVkZXMoJ1NvY2tldF9XZWFwb24nKSkgfHwgbnVsbDtcbiAgICB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTtcbiAgICBjb25zdCByaW5nID0gdGhpcy5yaW5nID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVEaXNjKCdiYXNlJywgeyByYWRpdXM6IDAuNSwgdGVzc2VsbGF0aW9uOiAzMCB9LCBzKTsgcmluZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgcmluZy5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IHJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHJpbmcuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IHJtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbnInLCBzKTsgcm0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgcm0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjQsIDAuMTUsIDAuNzUpOyBybS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBybS5hbHBoYSA9IDAuNTU7IHJpbmcubWF0ZXJpYWwgPSBybTtcbiAgICBjb25zdCBwcyA9IHRoaXMucHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnbmVjcm9BdXJhJywgODAsIHMpOyBwcy5wYXJ0aWNsZVRleHR1cmUgPSBzb2Z0OyBwcy5lbWl0dGVyID0gdGhpcy5ob2xkZXI7XG4gICAgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMjUsIDAsIC0wLjI1KTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yNSwgMC44LCAwLjI1KTsgcHMubWluTGlmZVRpbWUgPSAwLjY7IHBzLm1heExpZmVUaW1lID0gMS4zO1xuICAgIHBzLmRpcmVjdGlvbjEgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjE1LCAwLjksIC0wLjE1KTsgcHMuZGlyZWN0aW9uMiA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4xNSwgMS42LCAwLjE1KTsgcHMubWluRW1pdFBvd2VyID0gMC4zOyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7XG4gICAgcHMubWluU2l6ZSA9IDAuMDc7IHBzLm1heFNpemUgPSAwLjI7IHBzLmVtaXRSYXRlID0gMzA7IHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjgsIDAuMzUsIDEsIDAuNyk7IHBzLmNvbG9yMiA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjQ1LCAwLjE1LCAwLjksIDAuNSk7IHBzLmNvbG9yRGVhZCA9IG5ldyBCQUJZTE9OLkNvbG9yNCgwLjIsIDAsIDAuNCwgMCk7XG4gICAgcHMuYmxlbmRNb2RlID0gQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbS5CTEVORE1PREVfQUREOyBwcy5zdGFydCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBwbGF5KG5hbWU6IHN0cmluZywgbG9vcCA9IGZhbHNlLCBob2xkID0gZmFsc2UpIHtcbiAgICBjb25zdCBnID0gdGhpcy5hbmltc1tuYW1lXTsgaWYgKCFnKSByZXR1cm47XG4gICAgaWYgKHRoaXMuY3VyICYmIHRoaXMuY3VyICE9PSBnKSB0aGlzLmN1ci5zdG9wKCk7XG4gICAgZy5zdG9wKCk7IGcuc3RhcnQobG9vcCwgMSwgZy5mcm9tLCBnLnRvKTsgdGhpcy5jdXIgPSBnOyB0aGlzLmJ1c3kgPSAhbG9vcDsgdGhpcy5ob2xkRW5kID0gaG9sZDtcbiAgfVxuICBwcml2YXRlIGhvbGRFbmQgPSBmYWxzZTtcbiAgc2V0RW5hYmxlZChvbjogYm9vbGVhbikgeyB0aGlzLmhvbGRlci5zZXRFbmFibGVkKG9uKTsgaWYgKG9uKSB0aGlzLnBzLnN0YXJ0KCk7IGVsc2UgdGhpcy5wcy5zdG9wKCk7IH1cbiAgLyoqIFdvcmxkIHBvc2l0aW9uIG9mIHRoZSBzdGFmZiBjcnlzdGFsIChmb3Igc3BlbGwgZWZmZWN0cyk6IGFib3ZlIHRoZSBoYW5kIHRoYXQgaG9sZHMgdGhlIHN0YWZmLiAqL1xuICBjcnlzdGFsUG9zKCk6IGFueSB7XG4gICAgdGhpcy5ob2xkZXIuY29tcHV0ZVdvcmxkTWF0cml4KHRydWUpO1xuICAgIGNvbnN0IGJhc2UgPSB0aGlzLmhhbmQgPyAodGhpcy5oYW5kLmNvbXB1dGVXb3JsZE1hdHJpeCh0cnVlKSwgdGhpcy5oYW5kLmdldEFic29sdXRlUG9zaXRpb24oKS5jbG9uZSgpKSA6IHRoaXMuaG9sZGVyLmdldEFic29sdXRlUG9zaXRpb24oKS5hZGQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjYgKiB0aGlzLlMsIDApKTtcbiAgICByZXR1cm4gYmFzZS5hZGQobmV3IEJBQllMT04uVmVjdG9yMygwLCAwLjYyICogdGhpcy5TLCAwKSk7XG4gIH1cblxuICBodXJ0KCkgeyBpZiAoIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0h1cnQnKTsgfVxuICBjYXN0KCkgeyBpZiAoIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0Nhc3QnKTsgfVxuICAvKiogVGhlIGxhc3QgaGVhcnQgaXMgZ29uZTogaGUgc2lua3MgdG8gaGlzIGtuZWVzLiAqL1xuICBkZWZlYXQoKSB7IHRoaXMuZG93bmVkID0gdHJ1ZTsgdGhpcy5wbGF5KCdEb3duJywgZmFsc2UsIHRydWUpOyB9XG4gIHJldml2ZSgpIHsgaWYgKHRoaXMuZG93bmVkKSB7IHRoaXMuZG93bmVkID0gZmFsc2U7IHRoaXMucGxheSgnUmV2aXZlJyk7IH0gZWxzZSBpZiAodGhpcy5idXN5ICYmIHRoaXMuY3VyICE9PSB0aGlzLmFuaW1zWydJZGxlJ10pIHRoaXMucGxheSgnSWRsZScsIHRydWUpOyB9XG5cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLnQgKz0gZHQ7XG4gICAgaWYgKHRoaXMuY3VyICYmICF0aGlzLmN1ci5pc1N0YXJ0ZWQgJiYgIXRoaXMuZG93bmVkKSB0aGlzLnBsYXkoJ0lkbGUnLCB0cnVlKTsgICAgICAgICAgICAgIC8vIGEgb25lLXNob3QgZmluaXNoZWRcbiAgICBlbHNlIGlmICh0aGlzLmN1ciAmJiAhdGhpcy5jdXIuaXNTdGFydGVkICYmIHRoaXMuZG93bmVkICYmICF0aGlzLmhvbGRFbmQpIHRoaXMucGxheSgnSWRsZScsIHRydWUpO1xuICAgIGlmICghdGhpcy5idXN5ICYmICF0aGlzLmRvd25lZCkgeyB0aGlzLmlkbGVUICs9IGR0OyBpZiAodGhpcy5pZGxlVCA+IHRoaXMubmV4dFRhcCkgeyB0aGlzLmlkbGVUID0gMDsgdGhpcy5uZXh0VGFwID0gOSArIE1hdGgucmFuZG9tKCkgKiA4OyB0aGlzLnBsYXkoJ1RhcCcpOyB9IH1cbiAgICB0aGlzLnBzLmVtaXRSYXRlID0gdGhpcy5kb3duZWQgPyA2IDogKHRoaXMuYnVzeSAmJiB0aGlzLmN1ciA9PT0gdGhpcy5hbmltc1snQ2FzdCddID8gMTEwIDogMzApO1xuICB9XG5cbiAgZGlzcG9zZSgpIHsgdGhpcy5wcy5zdG9wKCk7IHRoaXMucHMuZGlzcG9zZSgpOyB0aGlzLmVudC5hbmltYXRpb25Hcm91cHMuZm9yRWFjaCgoZzogYW55KSA9PiBnLmRpc3Bvc2UoKSk7IHRoaXMuZW50LnNrZWxldG9ucy5mb3JFYWNoKChzOiBhbnkpID0+IHMuZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG4iLCAiLy8gQWxsIHNvdW5kIGlzIHN5bnRoZXNpemVkIGluIHRoZSBicm93c2VyIHdpdGggdGhlIFdlYiBBdWRpbyBBUEk6IG5vIGF1ZGlvIGZpbGVzIHRvIGRvd25sb2FkLCBsaWNlbnNlIG9yIHNoaXAuXG4vLyBUd28gaW5kZXBlbmRlbnQgc3dpdGNoZXMgKG11c2ljLCBzb3VuZCBlZmZlY3RzKSwgc2F2ZWQgaW4gdGhlIHBsYXllcidzIHNhdmUuIFBob25lcyBvbmx5IGFsbG93IHNvdW5kIGFmdGVyIGEgdGFwLCBzbyBub3RoaW5nIHN0YXJ0c1xuLy8gdW50aWwgdGhlIGZpcnN0IHRvdWNoL2NsaWNrIChgdW5sb2NrYCkuXG5pbXBvcnQgeyBsb2FkU2F2ZSwgdXBkYXRlU2V0dGluZ3MgfSBmcm9tICcuLi9jb3JlL3NhdmUudHMnO1xuXG5leHBvcnQgdHlwZSBTZnggPSAndGFwJyB8ICdzdW1tb24nIHwgJ21lcmdlJyB8ICdoaXQnIHwgJ2hpdEFycm93JyB8ICdzbWFzaCcgfCAnYXJyb3cnIHwgJ2RlYXRoJyB8ICdjYXN0JyB8ICd0YXVudCcgfCAnc2hvY2t3YXZlJyB8ICdyZXN1cnJlY3QnIHwgJ2hlYXJ0TG9zdCcgfCAndmljdG9yeScgfCAnZGVmZWF0JyB8ICdzdGFydCdcbiAgfCAndW5sb2NrJyB8ICdwYWNrQ2hhcmdlJyB8ICdwYWNrVGllclVwJyB8ICdwYWNrVGVhcicgfCAncGFja0ZhbicgfCAncGFja0ZsaXAnIHwgJ3BhY2tSYXJlJyB8ICdwYWNrRXBpYycgfCAncGFja0xlZ2VuZCcgfCAncGFja0NvbGxlY3QnO1xuZXhwb3J0IHR5cGUgTW9kZSA9ICdidWlsZCcgfCAnYmF0dGxlJztcblxuLy8gTXVzaWM6IEEgbWlub3IsIDgwIGJwbSwgZm91ciBiYXJzIGxvb3BpbmcgKEFtLCBGLCBDLCBFKS4gUm9vdCBub3RlIGZpcnN0LCB0aGVuIGNob3JkIHRvbmVzIChIeikuXG5jb25zdCBDSE9SRFM6IG51bWJlcltdW10gPSBbXG4gIFsxMTAsIDE2NC44MSwgMjIwLCAyNjEuNjMsIDMyOS42M10sXG4gIFs4Ny4zMSwgMTMwLjgxLCAxNzQuNjEsIDIyMCwgMjYxLjYzXSxcbiAgWzEzMC44MSwgMTk2LCAyNjEuNjMsIDMyOS42MywgMzkyXSxcbiAgWzgyLjQxLCAxMjMuNDcsIDE2NC44MSwgMjA3LjY1LCAyNDYuOTRdLFxuXTtcbmNvbnN0IEJFQVQgPSA2MCAvIDgwO1xuXG5jbGFzcyBBdWRpb0VuZ2luZSB7XG4gIHByaXZhdGUgY3R4OiBBdWRpb0NvbnRleHQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBtYXN0ZXIhOiBHYWluTm9kZTsgcHJpdmF0ZSBtdXNpY0J1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIHNmeEJ1cyE6IEdhaW5Ob2RlOyBwcml2YXRlIG5vaXNlQnVmITogQXVkaW9CdWZmZXI7XG4gIG11c2ljID0gdHJ1ZTsgc2Z4ID0gdHJ1ZTsgbW9kZTogTW9kZSA9ICdidWlsZCc7XG4gIHByaXZhdGUgdGltZXIgPSAwOyBwcml2YXRlIG5leHRUID0gMDsgcHJpdmF0ZSBiZWF0ID0gMDsgcHJpdmF0ZSBzdGFtcHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcigpIHsgY29uc3QgcyA9IGxvYWRTYXZlKCkuc2V0dGluZ3M7IHRoaXMubXVzaWMgPSBzLm11c2ljOyB0aGlzLnNmeCA9IHMuc2Z4OyB9XG5cbiAgcHJpdmF0ZSBzaWxlbnQ6IEhUTUxBdWRpb0VsZW1lbnQgfCBudWxsID0gbnVsbDsgcHJpdmF0ZSBwcmltZWQgPSBmYWxzZTtcbiAgLyoqIGlQaG9uZXMgbXV0ZSBXZWIgQXVkaW8gd2hlbiB0aGUgcmluZ2VyIHN3aXRjaCBpcyBvbiwgdW5sZXNzIHRoZSBwYWdlIGlzIHBsYXlpbmcgXCJyZWFsXCIgbWVkaWEuIEEgc2lsZW50IGxvb3BpbmcgPGF1ZGlvPiBlbGVtZW50IChwbHVzIHRoZVxuICAgKiAgYXVkaW9TZXNzaW9uIGhpbnQgb24gbmV3ZXIgaU9TKSBtb3ZlcyB0aGUgcGFnZSB0byB0aGUgcGxheWJhY2sgY2hhbm5lbCwgc28gdGhlIGdhbWUgaXMgaGVhcmQgZXZlbiB3aXRoIHRoZSBzd2l0Y2ggb24gc2lsZW50LiAqL1xuICBwcml2YXRlIHBsYXliYWNrQ2hhbm5lbCgpIHtcbiAgICB0cnkgeyBjb25zdCBhID0gKG5hdmlnYXRvciBhcyBhbnkpLmF1ZGlvU2Vzc2lvbjsgaWYgKGEpIGEudHlwZSA9ICdwbGF5YmFjayc7IH0gY2F0Y2ggeyAvKiBub3Qgc3VwcG9ydGVkICovIH1cbiAgICBpZiAodGhpcy5zaWxlbnQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbiA9IDQ0MSwgYnVmID0gbmV3IEFycmF5QnVmZmVyKDQ0ICsgbiAqIDIpLCB2ID0gbmV3IERhdGFWaWV3KGJ1ZiksIHN0ciA9IChvOiBudW1iZXIsIHQ6IHN0cmluZykgPT4geyBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspIHYuc2V0VWludDgobyArIGksIHQuY2hhckNvZGVBdChpKSk7IH07XG4gICAgICBzdHIoMCwgJ1JJRkYnKTsgdi5zZXRVaW50MzIoNCwgMzYgKyBuICogMiwgdHJ1ZSk7IHN0cig4LCAnV0FWRScpOyBzdHIoMTIsICdmbXQgJyk7IHYuc2V0VWludDMyKDE2LCAxNiwgdHJ1ZSk7IHYuc2V0VWludDE2KDIwLCAxLCB0cnVlKTsgdi5zZXRVaW50MTYoMjIsIDEsIHRydWUpO1xuICAgICAgdi5zZXRVaW50MzIoMjQsIDQ0MTAwLCB0cnVlKTsgdi5zZXRVaW50MzIoMjgsIDg4MjAwLCB0cnVlKTsgdi5zZXRVaW50MTYoMzIsIDIsIHRydWUpOyB2LnNldFVpbnQxNigzNCwgMTYsIHRydWUpOyBzdHIoMzYsICdkYXRhJyk7IHYuc2V0VWludDMyKDQwLCBuICogMiwgdHJ1ZSk7XG4gICAgICBjb25zdCBlbCA9IG5ldyBBdWRpbyhVUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtidWZdLCB7IHR5cGU6ICdhdWRpby93YXYnIH0pKSk7IGVsLmxvb3AgPSB0cnVlOyBlbC52b2x1bWUgPSAwLjAxOyBlbC5zZXRBdHRyaWJ1dGUoJ3BsYXlzaW5saW5lJywgJycpOyB0aGlzLnNpbGVudCA9IGVsO1xuICAgICAgZWwucGxheSgpLmNhdGNoKCgpID0+IHsgdGhpcy5zaWxlbnQgPSBudWxsOyB9KTtcbiAgICB9IGNhdGNoIHsgLyogZmluZTogc291bmQgc3RpbGwgd29ya3MsIGp1c3QgZm9sbG93cyB0aGUgc2lsZW50IHN3aXRjaCAqLyB9XG4gIH1cbiAgLyoqIFdoYXQgdGhlIFNldHRpbmdzIHBhZ2Ugc2hvd3Mgc28gYSBzaWxlbnQgcGhvbmUgY2FuIGJlIGRpYWdub3NlZC4gKi9cbiAgc3RhdHVzKCk6IHsgc3RhdGU6IHN0cmluZzsgdW5sb2NrZWQ6IGJvb2xlYW4gfSB7IHJldHVybiB7IHN0YXRlOiB0aGlzLmN0eCA/IHRoaXMuY3R4LnN0YXRlIDogJ25vdCBzdGFydGVkJywgdW5sb2NrZWQ6ICEhdGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgPT09ICdydW5uaW5nJyB9OyB9XG4gIC8qKiBUaGUgU2V0dGluZ3MgcGFnZSdzIFRlc3Qgc291bmQgYnV0dG9uOiB1bmxvY2sgYW5kIG1ha2UgYSBjbGVhcmx5IGF1ZGlibGUgc291bmQuICovXG4gIHRlc3QoKSB7IHRoaXMudW5sb2NrKCk7IGNvbnN0IHQgPSAoKSA9PiB7IHRoaXMucGxheSgndmljdG9yeScpOyB9OyBpZiAodGhpcy5jdHggJiYgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkudGhlbih0KS5jYXRjaCgoKSA9PiB7fSk7IGVsc2UgdCgpOyB9XG5cbiAgLyoqIENhbGwgZnJvbSBhIHVzZXIgZ2VzdHVyZSAodGFwL2NsaWNrKS4gU2FmZSB0byBjYWxsIHJlcGVhdGVkbHkuICovXG4gIHVubG9jaygpIHtcbiAgICB0aGlzLnBsYXliYWNrQ2hhbm5lbCgpO1xuICAgIGlmICghdGhpcy5jdHgpIHtcbiAgICAgIGNvbnN0IEMgPSAod2luZG93IGFzIGFueSkuQXVkaW9Db250ZXh0IHx8ICh3aW5kb3cgYXMgYW55KS53ZWJraXRBdWRpb0NvbnRleHQ7IGlmICghQykgcmV0dXJuO1xuICAgICAgY29uc3QgY3R4OiBBdWRpb0NvbnRleHQgPSB0aGlzLmN0eCA9IG5ldyBDKCk7XG4gICAgICBjb25zdCBjb21wID0gY3R4LmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvcigpOyBjb21wLmNvbm5lY3QoY3R4LmRlc3RpbmF0aW9uKTtcbiAgICAgIHRoaXMubWFzdGVyID0gY3R4LmNyZWF0ZUdhaW4oKTsgdGhpcy5tYXN0ZXIuZ2Fpbi52YWx1ZSA9IDAuOTsgdGhpcy5tYXN0ZXIuY29ubmVjdChjb21wKTtcbiAgICAgIHRoaXMubXVzaWNCdXMgPSBjdHguY3JlYXRlR2FpbigpOyB0aGlzLm11c2ljQnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpOyB0aGlzLnNmeEJ1cyA9IGN0eC5jcmVhdGVHYWluKCk7IHRoaXMuc2Z4QnVzLmNvbm5lY3QodGhpcy5tYXN0ZXIpO1xuICAgICAgY3R4Lm9uc3RhdGVjaGFuZ2UgPSAoKSA9PiB7IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tYXVkaW8tc3RhdGUnKSk7IH07XG4gICAgICBjb25zdCBsZW4gPSBjdHguc2FtcGxlUmF0ZTsgdGhpcy5ub2lzZUJ1ZiA9IGN0eC5jcmVhdGVCdWZmZXIoMSwgbGVuLCBjdHguc2FtcGxlUmF0ZSk7IGNvbnN0IGQgPSB0aGlzLm5vaXNlQnVmLmdldENoYW5uZWxEYXRhKDApOyBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKSBkW2ldID0gTWF0aC5yYW5kb20oKSAqIDIgLSAxO1xuICAgIH1cbiAgICBpZiAodGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgdGhpcy5jdHgucmVzdW1lKCkuY2F0Y2goKCkgPT4ge30pOyAgICAgICAgICAgICAvLyAnc3VzcGVuZGVkJyBvciAoaU9TKSAnaW50ZXJydXB0ZWQnXG4gICAgaWYgKCF0aGlzLnByaW1lZCkgeyB0aGlzLnByaW1lZCA9IHRydWU7IHRyeSB7IGNvbnN0IGIgPSB0aGlzLmN0eC5jcmVhdGVCdWZmZXIoMSwgMSwgMjIwNTApLCBzID0gdGhpcy5jdHguY3JlYXRlQnVmZmVyU291cmNlKCk7IHMuYnVmZmVyID0gYjsgcy5jb25uZWN0KHRoaXMuY3R4LmRlc3RpbmF0aW9uKTsgcy5zdGFydCgwKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9IH1cbiAgICB0aGlzLmFwcGx5R2FpbnMoKTsgdGhpcy5zeW5jTXVzaWMoKTtcbiAgfVxuXG4gIHNldE11c2ljKG9uOiBib29sZWFuKSB7IHRoaXMubXVzaWMgPSBvbjsgdXBkYXRlU2V0dGluZ3MoeyBtdXNpYzogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB0aGlzLnN5bmNNdXNpYygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyB9XG4gIHNldFNmeChvbjogYm9vbGVhbikgeyB0aGlzLnNmeCA9IG9uOyB1cGRhdGVTZXR0aW5ncyh7IHNmeDogb24gfSk7IHRoaXMuYXBwbHlHYWlucygpOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNldHRpbmdzJykpOyBpZiAob24pIHRoaXMucGxheSgndGFwJyk7IH1cbiAgLyoqIFJlLXJlYWQgdGhlIHNhdmVkIHN3aXRjaGVzICh0aGUgc2hlbGwncyBTZXR0aW5ncyBwYWdlIGNoYW5nZXMgdGhlbSB0b28pLiAqL1xuICByZWxvYWQoKSB7IGNvbnN0IHMgPSBsb2FkU2F2ZSgpLnNldHRpbmdzOyB0aGlzLm11c2ljID0gcy5tdXNpYzsgdGhpcy5zZnggPSBzLnNmeDsgdGhpcy5hcHBseUdhaW5zKCk7IHRoaXMuc3luY011c2ljKCk7IH1cbiAgc2V0TW9kZShtOiBNb2RlKSB7IHRoaXMubW9kZSA9IG07IH1cblxuICBwcml2YXRlIGFwcGx5R2FpbnMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuOyBjb25zdCB0ID0gdGhpcy5jdHguY3VycmVudFRpbWU7XG4gICAgdGhpcy5tdXNpY0J1cy5nYWluLnNldFRhcmdldEF0VGltZSh0aGlzLm11c2ljID8gMC41IDogMCwgdCwgMC4xNSk7IHRoaXMuc2Z4QnVzLmdhaW4uc2V0VGFyZ2V0QXRUaW1lKHRoaXMuc2Z4ID8gMC44IDogMCwgdCwgMC4wNSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gbXVzaWNcbiAgcHJpdmF0ZSBzeW5jTXVzaWMoKSB7XG4gICAgaWYgKCF0aGlzLmN0eCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLm11c2ljICYmICF0aGlzLnRpbWVyKSB7IHRoaXMubmV4dFQgPSB0aGlzLmN0eC5jdXJyZW50VGltZSArIDAuMTU7IHRoaXMudGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy50aWNrKCksIDIwMCk7IH1cbiAgICBpZiAoIXRoaXMubXVzaWMgJiYgdGhpcy50aW1lcikgeyBjbGVhckludGVydmFsKHRoaXMudGltZXIpOyB0aGlzLnRpbWVyID0gMDsgfVxuICB9XG4gIHByaXZhdGUgdGljaygpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7IGlmIChjdHguc3RhdGUgIT09ICdydW5uaW5nJykgeyB0aGlzLm5leHRUID0gY3R4LmN1cnJlbnRUaW1lICsgMC4xNTsgcmV0dXJuOyB9XG4gICAgd2hpbGUgKHRoaXMubmV4dFQgPCBjdHguY3VycmVudFRpbWUgKyAwLjYpIHsgdGhpcy5wbGF5QmVhdCh0aGlzLmJlYXQsIHRoaXMubmV4dFQpOyB0aGlzLm5leHRUICs9IEJFQVQ7IHRoaXMuYmVhdCA9ICh0aGlzLmJlYXQgKyAxKSAlIDE2OyB9XG4gIH1cbiAgcHJpdmF0ZSBwbGF5QmVhdChiZWF0OiBudW1iZXIsIHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGNob3JkID0gQ0hPUkRTW01hdGguZmxvb3IoYmVhdCAvIDQpXSwgaW5CYXIgPSBiZWF0ICUgNCwgYmF0dGxlID0gdGhpcy5tb2RlID09PSAnYmF0dGxlJztcbiAgICBpZiAoaW5CYXIgPT09IDApIGZvciAoY29uc3QgZiBvZiBjaG9yZCkgdGhpcy52b2ljZShmLCAndHJpYW5nbGUnLCB0LCBCRUFUICogNCArIDAuOCwgMC4wNDUsIDAuOSwgOTAwKTsgICAvLyBzbG93IHBhZFxuICAgIGlmIChpbkJhciA9PT0gMCB8fCBpbkJhciA9PT0gMikgdGhpcy52b2ljZShjaG9yZFswXSwgJ3NpbmUnLCB0LCBCRUFUICogMS42LCAwLjE2LCAwLjAyLCA0MDApOyAgICAgICAgICAvLyBiYXNzXG4gICAgaWYgKGJhdHRsZSkge1xuICAgICAgdGhpcy5raWNrKHQsIDAuMzIpOyBpZiAoaW5CYXIgPT09IDIpIHRoaXMua2ljayh0ICsgQkVBVCAqIDAuNSwgMC4xOCk7XG4gICAgICB0aGlzLm5vaXNlKHQgKyBCRUFUICogMC41LCAwLjA1LCAwLjA1LCAnaGlnaHBhc3MnLCA3MDAwKTsgdGhpcy5ub2lzZSh0ICsgQkVBVCAqIDEuNSAlIEJFQVQsIDAuMDUsIDAuMDMsICdoaWdocGFzcycsIDcwMDApO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAyOyBpKyspIHRoaXMudm9pY2UoY2hvcmRbMSArICgoYmVhdCAqIDIgKyBpKSAlIDQpXSAqIDIsICd0cmlhbmdsZScsIHQgKyBpICogQkVBVCAvIDIsIDAuMjIsIDAuMDUsIDAuMDA1LCAyNTAwKTsgICAvLyBwbHVjayBhcnBlZ2dpb1xuICAgIH1cbiAgfVxuICBwcml2YXRlIHZvaWNlKGZyZXE6IG51bWJlciwgdHlwZTogT3NjaWxsYXRvclR5cGUsIHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgYXR0YWNrOiBudW1iZXIsIGxwOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICBvLnR5cGUgPSB0eXBlOyBvLmZyZXF1ZW5jeS52YWx1ZSA9IGZyZXE7IGYudHlwZSA9ICdsb3dwYXNzJzsgZi5mcmVxdWVuY3kudmFsdWUgPSBscDtcbiAgICBnLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCB0KTsgZy5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKGdhaW4sIHQgKyBNYXRoLm1heCgwLjAwNSwgYXR0YWNrKSk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyBkdXIgKyAwLjA1KTtcbiAgfVxuICBwcml2YXRlIGtpY2sodDogbnVtYmVyLCBnYWluOiBudW1iZXIpIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIG8gPSBjdHguY3JlYXRlT3NjaWxsYXRvcigpLCBnID0gY3R4LmNyZWF0ZUdhaW4oKTtcbiAgICBvLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZSgxMzAsIHQpOyBvLmZyZXF1ZW5jeS5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDQyLCB0ICsgMC4xNCk7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZShnYWluLCB0KTsgZy5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoMC4wMDAxLCB0ICsgMC4yKTtcbiAgICBvLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLm11c2ljQnVzKTsgby5zdGFydCh0KTsgby5zdG9wKHQgKyAwLjI1KTtcbiAgfVxuICBwcml2YXRlIG5vaXNlKHQ6IG51bWJlciwgZHVyOiBudW1iZXIsIGdhaW46IG51bWJlciwgdHlwZTogQmlxdWFkRmlsdGVyVHlwZSwgZnJlcTogbnVtYmVyLCBidXM6IEdhaW5Ob2RlID0gdGhpcy5tdXNpY0J1cywgc3dlZXBUbz86IG51bWJlcikge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ISwgbiA9IGN0eC5jcmVhdGVCdWZmZXJTb3VyY2UoKSwgZiA9IGN0eC5jcmVhdGVCaXF1YWRGaWx0ZXIoKSwgZyA9IGN0eC5jcmVhdGVHYWluKCk7XG4gICAgbi5idWZmZXIgPSB0aGlzLm5vaXNlQnVmOyBmLnR5cGUgPSB0eXBlOyBmLmZyZXF1ZW5jeS5zZXRWYWx1ZUF0VGltZShmcmVxLCB0KTsgaWYgKHN3ZWVwVG8pIGYuZnJlcXVlbmN5LmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoc3dlZXBUbywgdCArIGR1cik7XG4gICAgZy5nYWluLnNldFZhbHVlQXRUaW1lKGdhaW4sIHQpOyBnLmdhaW4uZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZSgwLjAwMDEsIHQgKyBkdXIpO1xuICAgIG4uY29ubmVjdChmKTsgZi5jb25uZWN0KGcpOyBnLmNvbm5lY3QoYnVzKTsgbi5zdGFydCh0LCBNYXRoLnJhbmRvbSgpICogMC41KTsgbi5zdG9wKHQgKyBkdXIgKyAwLjAyKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzb3VuZCBlZmZlY3RzXG4gIHByaXZhdGUgdG9uZShmcmVxOiBudW1iZXIsIGR1cjogbnVtYmVyLCB0eXBlOiBPc2NpbGxhdG9yVHlwZSwgZ2FpbjogbnVtYmVyLCBkZWxheSA9IDAsIHNsaWRlVG8/OiBudW1iZXIsIGF0dGFjayA9IDAuMDA1LCBscCA9IDgwMDApIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCEsIHQgPSBjdHguY3VycmVudFRpbWUgKyBkZWxheSwgbyA9IGN0eC5jcmVhdGVPc2NpbGxhdG9yKCksIGcgPSBjdHguY3JlYXRlR2FpbigpLCBmID0gY3R4LmNyZWF0ZUJpcXVhZEZpbHRlcigpO1xuICAgIG8udHlwZSA9IHR5cGU7IG8uZnJlcXVlbmN5LnNldFZhbHVlQXRUaW1lKGZyZXEsIHQpOyBpZiAoc2xpZGVUbykgby5mcmVxdWVuY3kuZXhwb25lbnRpYWxSYW1wVG9WYWx1ZUF0VGltZShzbGlkZVRvLCB0ICsgZHVyKTtcbiAgICBmLnR5cGUgPSAnbG93cGFzcyc7IGYuZnJlcXVlbmN5LnZhbHVlID0gbHA7IGcuZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLjAwMDEsIHQpOyBnLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoZ2FpbiwgdCArIGF0dGFjayk7IGcuZ2Fpbi5leHBvbmVudGlhbFJhbXBUb1ZhbHVlQXRUaW1lKDAuMDAwMSwgdCArIGR1cik7XG4gICAgby5jb25uZWN0KGYpOyBmLmNvbm5lY3QoZyk7IGcuY29ubmVjdCh0aGlzLnNmeEJ1cyk7IG8uc3RhcnQodCk7IG8uc3RvcCh0ICsgZHVyICsgMC4wNSk7XG4gIH1cbiAgcHJpdmF0ZSBoaXNzKGR1cjogbnVtYmVyLCBnYWluOiBudW1iZXIsIHR5cGU6IEJpcXVhZEZpbHRlclR5cGUsIGZyZXE6IG51bWJlciwgZGVsYXkgPSAwLCBzd2VlcFRvPzogbnVtYmVyKSB7IHRoaXMubm9pc2UodGhpcy5jdHghLmN1cnJlbnRUaW1lICsgZGVsYXksIGR1ciwgZ2FpbiwgdHlwZSwgZnJlcSwgdGhpcy5zZnhCdXMsIHN3ZWVwVG8pOyB9XG4gIHByaXZhdGUgdGhyb3R0bGUoa2V5OiBzdHJpbmcsIG1zOiBudW1iZXIpIHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpOyBpZiAobiAtICh0aGlzLnN0YW1wc1trZXldIHx8IDApIDwgbXMpIHJldHVybiBmYWxzZTsgdGhpcy5zdGFtcHNba2V5XSA9IG47IHJldHVybiB0cnVlOyB9XG5cbiAgLyoqIEEgU291bCdzIHZvaWNlLCBzeW50aGVzaXplZDogc2tlbGV0b24gcmF0dGxlLCBhcmNoZXIgd2hpc3RsZSwgZ29ibGluIGNhY2tsZSwga25pZ2h0IGdydW50LCBvZ3JlIGdyb3dsLCBiYXJiYXJpYW4gcm9hci4gYGtgIHNoaWZ0cyB0aGUgcGl0Y2ggKGVuZW1pZXMgYSBsaXR0bGUgbG93ZXIpLCBgZGVsYXlgIHN0YWdnZXJzIGEgY2hvcnVzLiAqL1xuICBiYXJrKHNvdWw6IHN0cmluZywgZGVsYXkgPSAwLCBrID0gMSkge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuc2Z4IHx8IHRoaXMuY3R4LnN0YXRlICE9PSAncnVubmluZycgfHwgIXRoaXMudGhyb3R0bGUoJ2JhcmsnICsgc291bCwgMzUwKSkgcmV0dXJuO1xuICAgIGNvbnN0IFQgPSAoZjogbnVtYmVyLCBkOiBudW1iZXIsIHR5cGU6IE9zY2lsbGF0b3JUeXBlLCBnOiBudW1iZXIsIGRsOiBudW1iZXIsIHNsaWRlPzogbnVtYmVyLCBhdHQ/OiBudW1iZXIsIGxwPzogbnVtYmVyKSA9PiB0aGlzLnRvbmUoZiAqIGssIGQsIHR5cGUsIGcsIGRlbGF5ICsgZGwsIHNsaWRlID8gc2xpZGUgKiBrIDogdW5kZWZpbmVkLCBhdHQsIGxwKTtcbiAgICBjb25zdCBIID0gKGQ6IG51bWJlciwgZzogbnVtYmVyLCB0eXBlOiBCaXF1YWRGaWx0ZXJUeXBlLCBmOiBudW1iZXIsIGRsOiBudW1iZXIsIHN3PzogbnVtYmVyKSA9PiB0aGlzLmhpc3MoZCwgZywgdHlwZSwgZiwgZGVsYXkgKyBkbCwgc3cpO1xuICAgIHN3aXRjaCAoc291bCkge1xuICAgICAgY2FzZSAnd2Fycmlvcic6IFswLCAwLjA2LCAwLjEyLCAwLjE5XS5mb3JFYWNoKChkbCkgPT4gSCgwLjAzLCAwLjE2LCAnaGlnaHBhc3MnLCAzNTAwLCBkbCkpOyBUKDUyMCwgMC4yMiwgJ3NxdWFyZScsIDAuMDcsIDAsIDI4MCwgMC4wMDUsIDE4MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2FyY2hlcic6IFQoOTAwLCAwLjE2LCAnc2luZScsIDAuMTMsIDAsIDEzNTAsIDAuMDEpOyBUKDEzNTAsIDAuMjIsICdzaW5lJywgMC4xMSwgMC4xNiwgNzYwLCAwLjAxKTsgYnJlYWs7XG4gICAgICBjYXNlICdnb2JsaW4nOiBbMCwgMC4xMSwgMC4yMl0uZm9yRWFjaCgoZGwsIGkpID0+IFQoNTAwICsgaSAqIDcwLCAwLjEsICdzYXd0b290aCcsIDAuMDksIGRsLCA2MjAgKyBpICogNzAsIDAuMDA1LCAyNjAwKSk7IEgoMC4zLCAwLjA1LCAnYmFuZHBhc3MnLCAyMjAwLCAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdrbmlnaHQnOiBUKDE1MCwgMC4zMiwgJ3Nhd3Rvb3RoJywgMC4xMiwgMCwgMTA1LCAwLjAyLCA5MDApOyBUKDIyNSwgMC4zLCAnc3F1YXJlJywgMC4wNSwgMC4wMiwgMTYwLCAwLjAyLCA5MDApOyBIKDAuMDgsIDAuMTIsICdoaWdocGFzcycsIDQ1MDAsIDAuMSk7IGJyZWFrO1xuICAgICAgY2FzZSAnb2dyZSc6IFQoNzUsIDAuNzUsICdzYXd0b290aCcsIDAuMiwgMCwgNTIsIDAuMDUsIDMyMCk7IFQoMTEyLCAwLjcsICdzYXd0b290aCcsIDAuMDgsIDAuMDMsIDgwLCAwLjA1LCA0MjApOyBIKDAuNiwgMC4xMiwgJ2xvd3Bhc3MnLCA0MjAsIDAuMDIsIDE0MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnYmFyYmFyaWFuJzogVCgxNzAsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4xNCwgMCwgMzQwLCAwLjAzLCAxNDAwKTsgVCgzNDAsIDAuNDUsICdzYXd0b290aCcsIDAuMDgsIDAuMSwgMjEwLCAwLjAzLCAxNjAwKTsgSCgwLjQ1LCAwLjEsICdiYW5kcGFzcycsIDkwMCwgMCwgNTAwKTsgYnJlYWs7XG4gICAgfVxuICB9XG4gIHBsYXkobmFtZTogU2Z4KSB7XG4gICAgaWYgKCF0aGlzLmN0eCB8fCAhdGhpcy5zZnggfHwgdGhpcy5jdHguc3RhdGUgIT09ICdydW5uaW5nJykgcmV0dXJuO1xuICAgIHN3aXRjaCAobmFtZSkge1xuICAgICAgY2FzZSAndGFwJzogaWYgKCF0aGlzLnRocm90dGxlKCd0YXAnLCA0MCkpIHJldHVybjsgdGhpcy50b25lKDc2MCwgMC4wNiwgJ3NpbmUnLCAwLjIyLCAwLCAxMTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdzdW1tb24nOiB0aGlzLmhpc3MoMC40LCAwLjE0LCAnYmFuZHBhc3MnLCA1MDAsIDAsIDI1MDApOyB0aGlzLnRvbmUoMjIwLCAwLjQsICdzYXd0b290aCcsIDAuMSwgMCwgNjYwLCAwLjA1LCAxODAwKTsgdGhpcy50b25lKDEzMjAsIDAuMiwgJ3NpbmUnLCAwLjEsIDAuMTgpOyBicmVhaztcbiAgICAgIGNhc2UgJ21lcmdlJzogWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjM1LCAndHJpYW5nbGUnLCAwLjIsIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDgsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjM1LCAwLCA1MCk7IHRoaXMudG9uZSgxNTY4LCAwLjUsICdzaW5lJywgMC4wOCwgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICdoaXQnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdCcsIDQ1KSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4wNywgMC4yNCwgJ2xvd3Bhc3MnLCAxODAwKTsgdGhpcy50b25lKDE3MCwgMC4wOSwgJ3NpbmUnLCAwLjIyLCAwLCA4MCk7IGJyZWFrO1xuICAgICAgY2FzZSAnaGl0QXJyb3cnOiBpZiAoIXRoaXMudGhyb3R0bGUoJ2hpdEEnLCA0NSkpIHJldHVybjsgdGhpcy5oaXNzKDAuMDUsIDAuMTQsICdiYW5kcGFzcycsIDMwMDApOyB0aGlzLnRvbmUoNzAwLCAwLjA2LCAndHJpYW5nbGUnLCAwLjA2LCAwLCA0MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3NtYXNoJzogdGhpcy50b25lKDk1LCAwLjM4LCAnc2luZScsIDAuNSwgMCwgMzQpOyB0aGlzLmhpc3MoMC4zMiwgMC4zNSwgJ2xvd3Bhc3MnLCAxMDAwLCAwLCAyMDApOyBicmVhaztcbiAgICAgIGNhc2UgJ2Fycm93JzogaWYgKCF0aGlzLnRocm90dGxlKCdhcnJvdycsIDYwKSkgcmV0dXJuOyB0aGlzLmhpc3MoMC4xNCwgMC4xLCAnYmFuZHBhc3MnLCAxODAwLCAwLCA0MjAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdkZWF0aCc6IGlmICghdGhpcy50aHJvdHRsZSgnZGVhdGgnLCA3MCkpIHJldHVybjsgdGhpcy50b25lKDMwMCwgMC40LCAnc2F3dG9vdGgnLCAwLjE0LCAwLCA3MCwgMC4wMSwgOTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICdjYXN0JzogdGhpcy50b25lKDMwMCwgMC40NSwgJ3NpbmUnLCAwLjE4LCAwLCA5MDAsIDAuMDUpOyB0aGlzLnRvbmUoNDUwLCAwLjQ1LCAnc2luZScsIDAuMSwgMC4wNSwgMTM1MCwgMC4wNSk7IHRoaXMudG9uZSgxODAwLCAwLjI1LCAnc2luZScsIDAuMDUsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAndGF1bnQnOiB0aGlzLnRvbmUoMTk2LCAwLjUsICdzcXVhcmUnLCAwLjA4LCAwLCAxODAsIDAuMDMsIDcwMCk7IHRoaXMudG9uZSgxNDcsIDAuNSwgJ3Nhd3Rvb3RoJywgMC4wOCwgMC4wMiwgMTQwLCAwLjAzLCA2MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3Nob2Nrd2F2ZSc6IHRoaXMudG9uZSgyMjAsIDEuMSwgJ3NpbmUnLCAwLjUsIDAsIDI4LCAwLjAyKTsgdGhpcy5oaXNzKDEuMCwgMC4zNSwgJ2xvd3Bhc3MnLCAzMDAwLCAwLCAxNTApOyB0aGlzLnRvbmUoODgwLCAwLjgsICdzaW5lJywgMC4wOCwgMCwgMjIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdyZXN1cnJlY3QnOiBbMjIwLCAyNzcsIDMzMCwgNDQwLCA1NTRdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAxLjEsICd0cmlhbmdsZScsIDAuMSwgaSAqIDAuMTIsIGYgKiAxLjEyLCAwLjMpKTsgdGhpcy5oaXNzKDAuOSwgMC4wNiwgJ2hpZ2hwYXNzJywgNDUwMCwgMC4yKTsgYnJlYWs7XG4gICAgICBjYXNlICdoZWFydExvc3QnOiB0aGlzLnRvbmUoMTEwLCAwLjcsICdzYXd0b290aCcsIDAuMjgsIDAsIDUwLCAwLjAxLCA0NTApOyB0aGlzLmhpc3MoMC4xOCwgMC4yLCAnbG93cGFzcycsIDkwMCk7IHRoaXMudG9uZSgyMzMsIDAuNSwgJ3NxdWFyZScsIDAuMDUsIDAuMDIsIDIyMCwgMC4wMSwgNTAwKTsgYnJlYWs7XG4gICAgICBjYXNlICd2aWN0b3J5JzogWzM5MiwgNDk0LCA1ODcsIDc4NF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMTEpKTsgdGhpcy50b25lKDE5NiwgMC45LCAnc2luZScsIDAuMik7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVmZWF0JzogWzMzMCwgMjk0LCAyNDcsIDE5Nl0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNywgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMjgsIGYgKiAwLjk3KSk7IHRoaXMudG9uZSg4MiwgMS42LCAnc2luZScsIDAuMywgMC4zKTsgYnJlYWs7XG4gICAgICBjYXNlICd1bmxvY2snOiBbMC4zNSwgMC40NywgMC41OSwgMC43MV0uZm9yRWFjaCgoZCwgaSkgPT4geyB0aGlzLmhpc3MoMC4wNSwgMC4yMiwgJ2JhbmRwYXNzJywgOTAwICsgaSAqIDEyMCwgZCk7IHRoaXMudG9uZSgxNzAgKyBpICogMTIsIDAuMDcsICdzcXVhcmUnLCAwLjA2LCBkLCB1bmRlZmluZWQsIDAuMDAyLCA2MDApOyB9KTsgWzc4NCwgMTA0NiwgMTMxOF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuNiwgJ3RyaWFuZ2xlJywgMC4xNiwgMS4xNSArIGkgKiAwLjA3KSk7IHRoaXMuaGlzcygwLjUsIDAuMDksICdoaWdocGFzcycsIDUwMDAsIDEuMik7IHRoaXMudG9uZSgxMTAsIDAuMywgJ3NpbmUnLCAwLjI1LCAxLjE1LCA2MCk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0NoYXJnZSc6IHRoaXMudG9uZSg5MCwgMS4wNSwgJ3NpbmUnLCAwLjI1LCAwLCAyNjAsIDAuMik7IHRoaXMuaGlzcygwLjk1LCAwLjEyLCAnbG93cGFzcycsIDMwMCwgMCwgMjIwMCk7IHRoaXMudG9uZSgxODAsIDEuMCwgJ3RyaWFuZ2xlJywgMC4wNiwgMC4xLCA1MjAsIDAuMyk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1RpZXJVcCc6IFs0NDAsIDU1NCwgNjU5LCA4ODBdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjQsICd0cmlhbmdsZScsIDAuMiwgaSAqIDAuMDYpKTsgdGhpcy50b25lKDE3NjAsIDAuNiwgJ3NpbmUnLCAwLjA5LCAwLjIpOyB0aGlzLmhpc3MoMC40LCAwLjEsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja1RlYXInOiB0aGlzLmhpc3MoMC4zNSwgMC4zLCAnYmFuZHBhc3MnLCAxNTAwLCAwLCA2MDAwKTsgdGhpcy50b25lKDEyMCwgMC40NSwgJ3NpbmUnLCAwLjQsIDAuMDUsIDQwKTsgWzEwNDYsIDEzMTgsIDE1NjhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjYsICd0cmlhbmdsZScsIDAuMSwgMC4xMiArIGkgKiAwLjA1KSk7IGJyZWFrO1xuICAgICAgY2FzZSAncGFja0Zhbic6IHRoaXMuaGlzcygwLjUsIDAuMSwgJ2hpZ2hwYXNzJywgMzAwMCk7IHRoaXMudG9uZSg2NjAsIDAuNDUsICdzaW5lJywgMC4xLCAwLCAxMzIwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRmxpcCc6IHRoaXMuaGlzcygwLjA4LCAwLjE1LCAnYmFuZHBhc3MnLCAyNTAwKTsgdGhpcy50b25lKDUwMCwgMC4xMiwgJ3NpbmUnLCAwLjE0LCAwLCA4MDApOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhY2tSYXJlJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNzg0LCA5ODhdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjQ1LCAndHJpYW5nbGUnLCAwLjE0LCAwLjA1ICsgaSAqIDAuMDkpKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrRXBpYyc6IHRoaXMucGxheSgncGFja0ZsaXAnKTsgWzUyMywgNjU5LCA3ODQsIDEwNDZdLmZvckVhY2goKGYsIGkpID0+IHRoaXMudG9uZShmLCAwLjcsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA3KSk7IHRoaXMudG9uZSgxMTAsIDAuNSwgJ3NpbmUnLCAwLjMsIDAsIDYwKTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrTGVnZW5kJzogdGhpcy5wbGF5KCdwYWNrRmxpcCcpOyBbNTIzLCA2NTksIDc4NCwgMTA0NiwgMTMxOF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDEuMSwgJ3RyaWFuZ2xlJywgMC4xNiwgaSAqIDAuMDgpKTsgdGhpcy50b25lKDgyLCAwLjksICdzaW5lJywgMC4zNSwgMCwgNTApOyB0aGlzLmhpc3MoMC44LCAwLjEsICdoaWdocGFzcycsIDUwMDAsIDAuMSk7IHRoaXMudG9uZSgyMDkzLCAwLjcsICdzaW5lJywgMC4wNywgMC40KTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWNrQ29sbGVjdCc6IFs2NTksIDk4OF0uZm9yRWFjaCgoZiwgaSkgPT4gdGhpcy50b25lKGYsIDAuMzUsICd0cmlhbmdsZScsIDAuMTYsIGkgKiAwLjA5KSk7IGJyZWFrO1xuICAgICAgY2FzZSAnc3RhcnQnOiB0aGlzLnRvbmUoMTQ3LCAwLjksICdzYXd0b290aCcsIDAuMTMsIDAsIDE1MCwgMC4xNSwgNjUwKTsgdGhpcy50b25lKDIyMCwgMC45LCAnc2F3dG9vdGgnLCAwLjA5LCAwLjA1LCAyMjQsIDAuMTUsIDY1MCk7IHRoaXMuaGlzcygwLjYsIDAuMDYsICdsb3dwYXNzJywgNjAwKTsgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBhdWRpbyA9IG5ldyBBdWRpb0VuZ2luZSgpO1xuKHdpbmRvdyBhcyBhbnkpLl9fYXVkaW8gPSBhdWRpbztcblxuLy8gUGhvbmVzIG9ubHkgYWxsb3cgc291bmQgYWZ0ZXIgYSB0b3VjaDogdGhlIGZpcnN0IHRhcCBhbnl3aGVyZSB1bmxvY2tzIGl0LiBFdmVyeSBidXR0b24gYWxzbyBnZXRzIGEgc21hbGwgY2xpY2suXG4vLyBpT1Mgb25seSBhY2NlcHRzIGFuIHVubG9jayBmcm9tIGEgRklOSVNIRUQgdGFwICh0b3VjaGVuZCAvIGNsaWNrKSwgbm90IGZyb20gdGhlIHN0YXJ0IG9mIG9uZSwgc28gbGlzdGVuIHRvIGFsbCBvZiB0aGVtLlxuY29uc3QgdW5sb2NrT25jZSA9ICgpID0+IGF1ZGlvLnVubG9jaygpO1xuZm9yIChjb25zdCBldiBvZiBbJ3BvaW50ZXJkb3duJywgJ3BvaW50ZXJ1cCcsICd0b3VjaGVuZCcsICdjbGljaycsICdrZXlkb3duJ10pIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXYsIHVubG9ja09uY2UsIHsgY2FwdHVyZTogdHJ1ZSB9KTtcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgY29uc3QgZWwgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7IGlmIChlbCAmJiBlbC5jbG9zZXN0ICYmIGVsLmNsb3Nlc3QoJ2J1dHRvbiwgYS5idG4sIC5yYWlsIGEnKSkgYXVkaW8ucGxheSgndGFwJyk7IH0sIHRydWUpO1xuZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigndmlzaWJpbGl0eWNoYW5nZScsICgpID0+IHsgY29uc3QgYyA9IChhdWRpbyBhcyBhbnkpLmN0eCBhcyBBdWRpb0NvbnRleHQgfCBudWxsOyBpZiAoIWMpIHJldHVybjsgaWYgKGRvY3VtZW50LmhpZGRlbikgYy5zdXNwZW5kKCk7IGVsc2UgaWYgKGF1ZGlvLm11c2ljIHx8IGF1ZGlvLnNmeCkgYy5yZXN1bWUoKTsgfSk7XG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MtY2hhbmdlZCcsICgpID0+IGF1ZGlvLnJlbG9hZCgpKTtcbiIsICIvLyBTYXZpbmcgYSBydW4gaW4gcHJvZ3Jlc3Mgc28gaXQgc3Vydml2ZXMgYSBwYWdlIHJlbG9hZCAoU2FmYXJpIG9uIGEgcGhvbmUgY2FuIGRyb3AgdGhlIHBhZ2UgYXQgYW55IHRpbWUpLlxuLy8gT25seSBjYWxtIG1vbWVudHMgYXJlIHNhdmVkOiB0aGUgYnVpbGQgcGhhc2UgYW5kIHRoZSB2aWN0b3J5IGRyYWZ0LiBBIGJhdHRsZSBpbiBwcm9ncmVzcyBpcyBub3Qgc2F2ZWQ7IHJlbG9hZGluZyBkdXJpbmcgb25lIHB1dHMgeW91IGJhY2tcbi8vIGF0IHRoZSBidWlsZCBzY3JlZW4geW91IHByZXNzZWQgQmF0dGxlIGZyb20gKG5vdGhpbmcgbG9zdCwgbm90aGluZyBnYWluZWQpLiBFdmVyeXRoaW5nIHJlYWQgYmFjayBpcyB2YWxpZGF0ZWQ7IGFueXRoaW5nIG9kZCBpcyBpZ25vcmVkLlxuXG5pbXBvcnQgeyBHUklEX0NFTExTLCBIRUFSVFMsIE1BWF9TVEFSLCBTT1VMUyB9IGZyb20gJy4vZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1bGVzLCBTb3VsSWQgfSBmcm9tICcuL2RhdGEudHMnO1xuaW1wb3J0IHsgbWFrZVJuZyB9IGZyb20gJy4vcm5nLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUsIFVuaXQgfSBmcm9tICcuL3J1bGVzLnRzJztcbmltcG9ydCB7IGJyb3dzZXJTdG9yZSB9IGZyb20gJy4vc2F2ZS50cyc7XG5pbXBvcnQgdHlwZSB7IFN0b3JlIH0gZnJvbSAnLi9zYXZlLnRzJztcblxuY29uc3QgS0VZID0gJ25lY3JvLXJ1bic7XG5jb25zdCBWRVJTSU9OID0gMTtcblxuZXhwb3J0IGludGVyZmFjZSBTZXJpYWxpemVkU3RhdGUge1xuICBydWxlczogUnVsZXM7IHJuZzogeyBzZWVkOiBudW1iZXI7IHBvczogbnVtYmVyIH07XG4gIHdhdmU6IG51bWJlcjsgaGVhcnRzOiBudW1iZXI7IGNhcDogbnVtYmVyOyBoYW5kOiBTb3VsSWRbXTsgdW5pdHM6IFVuaXRbXTsgbmV4dElkOiBudW1iZXI7IGRpc2NhcmRVc2VkOiBib29sZWFuO1xuICBzdGF0dXM6ICdidWlsZGluZyc7IGxvZzogc3RyaW5nW107IHN0YXRzOiBTdGF0ZVsnc3RhdHMnXTtcbn1cbmV4cG9ydCBpbnRlcmZhY2UgUnVuU25hcHNob3QgeyB2OiBudW1iZXI7IHNlZWQ6IG51bWJlcjsgYXR0ZW1wdDogbnVtYmVyOyBzdGFnZTogc3RyaW5nOyBkaWZmaWN1bHR5OiBzdHJpbmc7IHBoYXNlOiAnYnVpbGQnIHwgJ2RyYWZ0JzsgZHJhZnQ6IFNvdWxJZFtdIHwgbnVsbDsgc3RhdGU6IFNlcmlhbGl6ZWRTdGF0ZTsgc3RhcnRCZXN0PzogbnVtYmVyIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZVN0YXRlKHM6IFN0YXRlKTogU2VyaWFsaXplZFN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBydWxlczogSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzLnJ1bGVzKSksIHJuZzogeyBzZWVkOiBzLnJuZy5zZWVkLCBwb3M6IHMucm5nLnN0YXRlKCkgfSxcbiAgICB3YXZlOiBzLndhdmUsIGhlYXJ0czogcy5oZWFydHMsIGNhcDogcy5jYXAsIGhhbmQ6IHMuaGFuZC5zbGljZSgpLCB1bml0czogcy51bml0cy5tYXAoKHUpID0+ICh7IC4uLnUgfSkpLCBuZXh0SWQ6IHMubmV4dElkLCBkaXNjYXJkVXNlZDogcy5kaXNjYXJkVXNlZCxcbiAgICBzdGF0dXM6ICdidWlsZGluZycsIGxvZzogcy5sb2cuc2xpY2UoLTQwKSwgc3RhdHM6IHsgLi4ucy5zdGF0cyB9LFxuICB9O1xufVxuXG5jb25zdCBpc1NvdWwgPSAoeDogYW55KTogeCBpcyBTb3VsSWQgPT4gU09VTFMuaW5jbHVkZXMoeCk7XG5jb25zdCBpbnQgPSAoeDogYW55LCBsbzogbnVtYmVyLCBoaTogbnVtYmVyKSA9PiBOdW1iZXIuaXNJbnRlZ2VyKHgpICYmIHggPj0gbG8gJiYgeCA8PSBoaTtcblxuLyoqIFJlYnVpbGQgYSBTdGF0ZSBmcm9tIHNhdmVkIGRhdGEsIG9yIG51bGwgaWYgYW55dGhpbmcgYWJvdXQgaXQgaXMgbm90IGJlbGlldmFibGUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVTdGF0ZSh4OiBhbnkpOiBTdGF0ZSB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICgheCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHIgPSB4LnJ1bGVzO1xuICAgIGlmICghciB8fCAhQXJyYXkuaXNBcnJheShyLmN1cnZlKSB8fCAhci5jdXJ2ZS5sZW5ndGggfHwgIXIuY3VydmUuZXZlcnkoKG46IGFueSkgPT4gTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHIubWVyZ2UgIT09ICdkZXBsb3llZE9ubHknICYmIHIubWVyZ2UgIT09ICdoYW5kSW50b09uZVN0YXInKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoci5wb29sICE9PSB1bmRlZmluZWQgJiYgIShBcnJheS5pc0FycmF5KHIucG9vbCkgJiYgci5wb29sLmxlbmd0aCAmJiByLnBvb2wuZXZlcnkoaXNTb3VsKSkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHN0YWdlV2F2ZXMgPSByLnN0YWdlV2F2ZXMgPz8gci5jdXJ2ZS5sZW5ndGg7XG4gICAgaWYgKCFpbnQoeC53YXZlLCAxLCBNYXRoLm1pbihzdGFnZVdhdmVzLCByLmN1cnZlLmxlbmd0aCkpIHx8ICFpbnQoeC5oZWFydHMsIDEsIEhFQVJUUykgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmNhcCkgfHwgeC5jYXAgPD0gMCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHguaGFuZCkgfHwgeC5oYW5kLmxlbmd0aCA+IDQwIHx8ICF4LmhhbmQuZXZlcnkoaXNTb3VsKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHgudW5pdHMpIHx8IHgudW5pdHMubGVuZ3RoID4gR1JJRF9DRUxMUykgcmV0dXJuIG51bGw7XG4gICAgaWYgKCFpbnQoeC5uZXh0SWQsIDEsIDFlNikgfHwgdHlwZW9mIHguZGlzY2FyZFVzZWQgIT09ICdib29sZWFuJykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY2VsbHMgPSBuZXcgU2V0PG51bWJlcj4oKSwgaWRzID0gbmV3IFNldDxudW1iZXI+KCksIHVuaXRzOiBVbml0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHUgb2YgeC51bml0cykge1xuICAgICAgaWYgKCF1IHx8ICFpc1NvdWwodS5zb3VsKSB8fCAhaW50KHUuc3RhciwgMSwgTUFYX1NUQVIpIHx8ICFpbnQodS5jZWxsLCAwLCBHUklEX0NFTExTIC0gMSkgfHwgIWludCh1LmlkLCAxLCB4Lm5leHRJZCkgfHwgY2VsbHMuaGFzKHUuY2VsbCkgfHwgaWRzLmhhcyh1LmlkKSkgcmV0dXJuIG51bGw7XG4gICAgICBjZWxscy5hZGQodS5jZWxsKTsgaWRzLmFkZCh1LmlkKTsgdW5pdHMucHVzaCh7IGlkOiB1LmlkLCBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsLCBmcmVzaDogISF1LmZyZXNoIH0pO1xuICAgIH1cbiAgICBjb25zdCBzdCA9IHguc3RhdHM7XG4gICAgaWYgKCFzdCB8fCAhWydkcmF3bicsICdkaXNjYXJkZWQnLCAnZGlzbWlzc2VkJywgJ21lcmdlcycsICdmYWlsdXJlcyddLmV2ZXJ5KChrKSA9PiBOdW1iZXIuaXNGaW5pdGUoc3Rba10pKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF4LnJuZyB8fCAhTnVtYmVyLmlzRmluaXRlKHgucm5nLnNlZWQpIHx8ICFOdW1iZXIuaXNGaW5pdGUoeC5ybmcucG9zKSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bGVzOiByIGFzIFJ1bGVzLCBybmc6IG1ha2VSbmcoeC5ybmcuc2VlZCwgeC5ybmcucG9zKSwgd2F2ZTogeC53YXZlLCBoZWFydHM6IHguaGVhcnRzLCBjYXA6IHguY2FwLCBoYW5kOiB4LmhhbmQuc2xpY2UoKSwgdW5pdHMsIG5leHRJZDogeC5uZXh0SWQsXG4gICAgICBkaXNjYXJkVXNlZDogeC5kaXNjYXJkVXNlZCwgc3RhdHVzOiAnYnVpbGRpbmcnLCBsb2c6IEFycmF5LmlzQXJyYXkoeC5sb2cpID8geC5sb2cuZmlsdGVyKChsOiBhbnkpID0+IHR5cGVvZiBsID09PSAnc3RyaW5nJykuc2xpY2UoLTQwKSA6IFtdLFxuICAgICAgc3RhdHM6IHsgZHJhd246IHN0LmRyYXduLCBkaXNjYXJkZWQ6IHN0LmRpc2NhcmRlZCwgZGlzbWlzc2VkOiBzdC5kaXNtaXNzZWQsIG1lcmdlczogc3QubWVyZ2VzLCBmYWlsdXJlczogc3QuZmFpbHVyZXMgfSxcbiAgICB9O1xuICB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhdmVSdW4oc25hcDogUnVuU25hcHNob3QsIHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUpIHN0b3JlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShzbmFwKSk7IH0gY2F0Y2ggeyAvKiBzdG9yYWdlIGZ1bGwgb3IgYmxvY2tlZDogdGhlIHJ1biBqdXN0IHdpbGwgbm90IHN1cnZpdmUgYSByZWxvYWQgKi8gfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyUnVuKHN0b3JlOiBTdG9yZSB8IG51bGwgPSBicm93c2VyU3RvcmUoKSk6IHZvaWQge1xuICB0cnkgeyBpZiAoc3RvcmUgJiYgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbSkgKHN0b3JlIGFzIGFueSkucmVtb3ZlSXRlbShLRVkpOyBlbHNlIGlmIChzdG9yZSkgc3RvcmUuc2V0SXRlbShLRVksICcnKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG59XG5leHBvcnQgZnVuY3Rpb24gbG9hZFJ1bihzdG9yZTogU3RvcmUgfCBudWxsID0gYnJvd3NlclN0b3JlKCkpOiB7IHNuYXA6IFJ1blNuYXBzaG90OyBzdGF0ZTogU3RhdGUgfSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IHQgPSBzdG9yZSAmJiBzdG9yZS5nZXRJdGVtKEtFWSk7IGlmICghdCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgeCA9IEpTT04ucGFyc2UodCk7XG4gICAgaWYgKCF4IHx8IHgudiAhPT0gVkVSU0lPTiB8fCAoeC5waGFzZSAhPT0gJ2J1aWxkJyAmJiB4LnBoYXNlICE9PSAnZHJhZnQnKSB8fCAhTnVtYmVyLmlzRmluaXRlKHguc2VlZCkgfHwgIU51bWJlci5pc0Zpbml0ZSh4LmF0dGVtcHQpIHx8IHR5cGVvZiB4LmRpZmZpY3VsdHkgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzdGF0ZSA9IGRlc2VyaWFsaXplU3RhdGUoeC5zdGF0ZSk7IGlmICghc3RhdGUpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGRyYWZ0ID0geC5waGFzZSA9PT0gJ2RyYWZ0JyAmJiBBcnJheS5pc0FycmF5KHguZHJhZnQpICYmIHguZHJhZnQubGVuZ3RoID09PSAzICYmIHguZHJhZnQuZXZlcnkoaXNTb3VsKSA/IHguZHJhZnQgOiBudWxsO1xuICAgIHJldHVybiB7IHNuYXA6IHsgdjogVkVSU0lPTiwgc2VlZDogeC5zZWVkLCBhdHRlbXB0OiB4LmF0dGVtcHQsIHN0YWdlOiB0eXBlb2YgeC5zdGFnZSA9PT0gJ3N0cmluZycgPyB4LnN0YWdlIDogJ2NyeXB0JywgZGlmZmljdWx0eTogeC5kaWZmaWN1bHR5LCBwaGFzZTogZHJhZnQgPyAnZHJhZnQnIDogJ2J1aWxkJywgZHJhZnQsIHN0YXRlOiB4LnN0YXRlLCBzdGFydEJlc3Q6IE51bWJlci5pc0ludGVnZXIoeC5zdGFydEJlc3QpICYmIHguc3RhcnRCZXN0ID49IDAgJiYgeC5zdGFydEJlc3QgPD0gOTk5OSA/IHguc3RhcnRCZXN0IDogdW5kZWZpbmVkIH0sIHN0YXRlIH07XG4gIH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxufVxuZXhwb3J0IGNvbnN0IFJVTl9WRVJTSU9OID0gVkVSU0lPTjtcbiIsICIvLyBFdmVyeXRoaW5nIHlvdSBTRUUgZm9yIGEgdW5pdDogcmVhbCBUcmlwbyBtb2RlbHMgKFNrZWxldG9uIFdhcnJpb3IsIFNrZWxldG9uIEFyY2hlciksIHNpbXBsZSBzdGFuZC1pbnMgZm9yIHRoZSBmb3VyXG4vLyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBnZW5lcmF0ZWQgeWV0LCBhbmQgdGhlIFwic3RhciBsb29rXCIgbGF5ZXJlZCBvbiB0b3Agb2YgYm90aCAoc2l6ZSwgdGludCwgYXVyYSwgaGFsbywgYmFkZ2UpLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFIH0gZnJvbSAnLi4vY29yZS9iYWxhbmNlLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5cbmV4cG9ydCB0eXBlIFZTdGF0ZSA9ICdpZGxlJyB8ICdydW4nIHwgJ2F0dGFjaycgfCAnZGVhdGgnIHwgJ3NwYXduJyB8ICdjaGVlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNmb3JtTm9kZTogdGhlIGdhbWUgc2V0cyBwb3NpdGlvbiArIHlhdyBoZXJlXG4gIHRlYW06IDAgfCAxOyBzdGFyOiBudW1iZXI7IHN0YXRlOiBWU3RhdGU7IHRvcDogbnVtYmVyO1xuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkPzogbnVtYmVyKTogdm9pZDtcbiAgc2V0U3RhcihzdGFyOiBudW1iZXIpOiB2b2lkO1xuICBjbGlwTmFtZXM/KCk6IHN0cmluZ1tdOyAgICAgICAgICAgIC8vIHRoZSBhbmltYXRpb25zIHRoaXMgdW5pdCBoYXMgKGZvciB0aGUgaW5zcGVjdCB2aWV3KVxuICBwcmV2aWV3Q2xpcD8obmFtZTogc3RyaW5nKTogdm9pZDsgIC8vIHBsYXkgb25lIG9mIHRoZW0gb25jZSwgdGhlbiBnbyBiYWNrIHRvIGlkbGVcbiAgc2V0Qm9zcz8ob246IGJvb2xlYW4pOiB2b2lkOyAgICAgICAvLyBhbiBlbmVteSBib3NzOiBiaWdnZXIsIHdpdGggYSBCT1NTIHRhZ1xuICBzZXRMZXZlbD8obGV2ZWw6IG51bWJlcik6IHZvaWQ7ICAgIC8vIHRoZSBwZXJtYW5lbnQgU291bCBsZXZlbCBzaG93biBiZXNpZGUgdGhlIGhlYWx0aCBiYXIgKHBsYXllciB1bml0cyBvbmx5KVxuICBzZXRUZWFtKHRlYW06IDAgfCAxKTogdm9pZDtcbiAgc2V0SHAoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7ICAvLyBudWxsIGhpZGVzIHRoZSBoZWFsdGggYmFyXG4gIHNldE1hbmEoZnJhYzogbnVtYmVyIHwgbnVsbCk6IHZvaWQ7IC8vIG51bGwgaGlkZXMgdGhlIG1hbmEgYmFyICh1bml0cyB3aXRob3V0IGEgc2tpbGwpXG4gIHB1bHNlKCk6IHZvaWQ7ICAgICAgICAgICAgICAgICAgICAgLy8gYnJpZWYgaGl0IHJlYWN0aW9uXG4gIHVwZGF0ZShkdDogbnVtYmVyKTogdm9pZDtcbiAgZGlzcG9zZSgpOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YXIgbG9va3Ncbi8vIDEgc3RhciA9IHRoZSBwbGFpbiBtb2RlbC4gMiBzdGFycyA9IGEgbGl0dGxlIGJpZ2dlciwgY29vbCBzaWx2ZXItYmx1ZSB0aW50LCBicmlnaHRlciBhdXJhLiAzIHN0YXJzID0gYmlnZ2VzdCwgd2FybSBnb2xkIHRpbnQsXG4vLyBzdHJvbmcgZ29sZC12aW9sZXQgYXVyYSBhbmQgYSBmbG9hdGluZyBnb2xkIGhhbG8uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBmcmVlOiBubyBleHRyYSBUcmlwbyBnZW5lcmF0aW9ucy5cbmNvbnN0IFRJTlQ6IG51bWJlcltdW10gPSBbWzEsIDEsIDFdLCBbMC44NiwgMC45NSwgMS4xOF0sIFsxLjI1LCAxLjEsIDAuN11dO1xuY29uc3QgQVVSQSA9IFtcbiAgeyByYXRlOiAxNCwgbWluOiAwLjA2LCBtYXg6IDAuMTYsIGMxOiBbMC43OCwgMC4zNSwgMSwgMC43XSwgYzI6IFswLjQ1LCAwLjE1LCAwLjksIDAuNV0gfSxcbiAgeyByYXRlOiAyNiwgbWluOiAwLjA4LCBtYXg6IDAuMjAsIGMxOiBbMC44NSwgMC42NSwgMSwgMC44XSwgYzI6IFswLjU1LCAwLjQsIDEsIDAuNl0gfSxcbiAgeyByYXRlOiA0NCwgbWluOiAwLjEwLCBtYXg6IDAuMjYsIGMxOiBbMSwgMC44NSwgMC40LCAwLjg1XSwgYzI6IFswLjgsIDAuMywgMSwgMC43XSB9LFxuXTtcblxuZXhwb3J0IGludGVyZmFjZSBBc3NldHMge1xuICBzY2VuZTogYW55OyBzb2Z0OiBhbnk7IGx2VGV4OiBSZWNvcmQ8bnVtYmVyLCBhbnk+OyBzdGFyVGV4OiBhbnlbXTsgdHJpcG86IFBhcnRpYWw8UmVjb3JkPFNvdWxJZCwgVHJpcG9DZmc+PjsgZW1vdGU6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gIHJpbmdNYXQ6IGFueVtdOyBoYWxvTWF0OiBhbnk7IGJhckJnOiBhbnk7IGJhckZpbGw6IGFueVtdOyBtYW5hRmlsbDogYW55OyBhcnJvdz86IGFueTsgbmVjcm8/OiBhbnk7XG59XG4vKiogRmxhdm91ciBhIHVuaXQgY2FuIGhhdmU6IGEgY2xpcCBpdCBwbGF5cyBub3cgYW5kIHRoZW4gd2hlbiBpdCBoYXMgc3Rvb2QgaWRsZSBmb3IgYSB3aGlsZSwgYSBzbWFsbCBlbW90ZSwgYW5kIGFuIGV5ZS1nbG93IG1hc2sgKGV5ZXMgZGltIHdoZW4gc2xlZXB5LCBmbGFyZSB3aGVuIGl0IGZpZ2h0cykuICovXG4vKiogSWRsZSBjbGlwcyB3aGVyZSB0aGUgdW5pdCBtYWtlcyBhIG5vaXNlLiAqL1xuY29uc3QgVk9DQUwgPSBuZXcgU2V0KFsnUm9hcicsICdUaHVtcCcsICdTdG9tcCcsICdTbmlja2VyJywgJ1NjaGVtZScsICdCb2FzdCcsICdGbGV4JywgJ0RvdWJsZUJpY2VwcycsICdGdW1ibGUnLCAnU2hpZWxkQm9uaycsICdCb25rJ10pO1xuaW50ZXJmYWNlIFBvc2UgeyBjbGlwOiBzdHJpbmc7IGVtb3RlPzogc3RyaW5nIH1cbmludGVyZmFjZSBGbGF2b3IgeyBjbGlwczogUG9zZVtdOyBtaW46IG51bWJlcjsgbWF4OiBudW1iZXIgfVxuaW50ZXJmYWNlIFRyaXBvQ2ZnIHsgY29udGFpbmVyOiBhbnk7IGVuZW15VGV4OiBhbnk7IGNsaXBzOiBSZWNvcmQ8VlN0YXRlLCBzdHJpbmc+OyBtYXRDYWNoZTogUmVjb3JkPHN0cmluZywgYW55PjsgYmFzZU1hdD86IGFueTsgdG9wOiBudW1iZXI7IHNjYWxlOiBudW1iZXI7IGZsYXZvcj86IEZsYXZvcjsgY2hlZXJzPzogUG9zZVtdOyBzcGF3bkVtb3RlPzogc3RyaW5nOyBleWVzPzogc3RyaW5nOyBleWVUZXg/OiBhbnk7IHN0YXJTY2FsZT86IG51bWJlcltdIH1cblxuZnVuY3Rpb24gZHluKHNjZW5lOiBhbnksIHc6IG51bWJlciwgaDogbnVtYmVyLCBkcmF3OiAoYzogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEKSA9PiB2b2lkLCBhbHBoYSA9IHRydWUpIHtcbiAgY29uc3QgdCA9IG5ldyBCQUJZTE9OLkR5bmFtaWNUZXh0dXJlKCdkdCcsIHsgd2lkdGg6IHcsIGhlaWdodDogaCB9LCBzY2VuZSwgdHJ1ZSk7IGRyYXcodC5nZXRDb250ZXh0KCkpOyB0LnVwZGF0ZSgpOyB0Lmhhc0FscGhhID0gYWxwaGE7IHJldHVybiB0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZEFzc2V0cyhzY2VuZTogYW55KTogUHJvbWlzZTxBc3NldHM+IHtcbiAgY29uc3Qgc29mdCA9IGR5bihzY2VuZSwgNjQsIDY0LCAoYykgPT4geyBjb25zdCBnID0gYy5jcmVhdGVSYWRpYWxHcmFkaWVudCgzMiwgMzIsIDAsIDMyLCAzMiwgMzIpOyBnLmFkZENvbG9yU3RvcCgwLCAncmdiYSgyNTUsMjU1LDI1NSwxKScpOyBnLmFkZENvbG9yU3RvcCgwLjQsICdyZ2JhKDI1NSwyNTUsMjU1LC41NSknKTsgZy5hZGRDb2xvclN0b3AoMSwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTsgYy5maWxsU3R5bGUgPSBnOyBjLmZpbGxSZWN0KDAsIDAsIDY0LCA2NCk7IH0pO1xuICBjb25zdCBzdGFyVGV4ID0gWzEsIDIsIDNdLm1hcCgobikgPT4gZHluKHNjZW5lLCAxOTIsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCA0MHB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDU7IGMuc3Ryb2tlU3R5bGUgPSAnIzFhMTAyMCc7IGMuZmlsbFN0eWxlID0gbiA9PT0gMyA/ICcjZmZkMjRhJyA6IG4gPT09IDIgPyAnI2Q3ZTZmZicgOiAnI2YwZDlhMCc7IGNvbnN0IHMgPSAnXHUyNjA1Jy5yZXBlYXQobik7IGMuc3Ryb2tlVGV4dChzLCA5NiwgMzgpOyBjLmZpbGxUZXh0KHMsIDk2LCAzOCk7IH0pKTtcbiAgY29uc3QgZW1pc3NpdmUgPSAocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYSA9IDEpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwoJ2VtJywgc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyhyLCBnLCBiKTsgbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtLmFscGhhID0gYTsgcmV0dXJuIG07IH07XG4gIGNvbnN0IEE6IEFzc2V0cyA9IHtcbiAgICBzY2VuZSwgc29mdCwgbHZUZXg6IHt9LCBzdGFyVGV4LCB0cmlwbzoge30sIGVtb3RlOiB7fSwgcmluZ01hdDogW2VtaXNzaXZlKDAuNTUsIDAuMiwgMC45NSwgMC45KSwgZW1pc3NpdmUoMC45NSwgMC4yNSwgMC4yLCAwLjkpXSwgaGFsb01hdDogZW1pc3NpdmUoMSwgMC44MiwgMC4zLCAwLjk1KSxcbiAgICBiYXJCZzogZW1pc3NpdmUoMC4wNSwgMC4wNSwgMC4wOCwgMC43KSwgYmFyRmlsbDogW2VtaXNzaXZlKDAuNTUsIDAuMzUsIDEpLCBlbWlzc2l2ZSgxLCAwLjQsIDAuMyldLCBtYW5hRmlsbDogZW1pc3NpdmUoMC4yNSwgMC43NSwgMSksXG4gIH07XG4gIC8vIFwiWnp6XCIgdGhhdCBmbG9hdHMgdXAgb3ZlciBhIHNsZWVweSB1bml0XG4gIGNvbnN0IHp6eiA9IGR5bihzY2VuZSwgMTI4LCAxMjgsIChjKSA9PiB7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gOTsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5maWxsU3R5bGUgPSAnI2U4ZDhmZic7IGMubGluZUpvaW4gPSAncm91bmQnO1xuICAgIGZvciAoY29uc3QgW2NoLCBzaXplLCB4LCB5XSBvZiBbWydaJywgNjQsIDM0LCAxMDBdLCBbJ3onLCA0OCwgNzQsIDY2XSwgWyd6JywgMzQsIDEwNCwgMzhdXSBhcyBbc3RyaW5nLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXVtdKSB7IGMuZm9udCA9ICdpdGFsaWMgOTAwICcgKyBzaXplICsgJ3B4IHNhbnMtc2VyaWYnOyBjLnN0cm9rZVRleHQoY2gsIHgsIHkpOyBjLmZpbGxUZXh0KGNoLCB4LCB5KTsgfSB9KTtcbiAgY29uc3Qgem0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd6enonLCBzY2VuZSk7IHptLmRpZmZ1c2VUZXh0dXJlID0genp6OyB6bS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IHptLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyB6bS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyB6bS5iYWNrRmFjZUN1bGxpbmcgPSBmYWxzZTsgQS5lbW90ZVsnenp6J10gPSB6bTtcbiAgY29uc3QgaWNvbiA9IChuYW1lOiBzdHJpbmcsIGRyYXc6IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHZvaWQpID0+IHsgY29uc3QgbSA9IG5ldyBCQUJZTE9OLlN0YW5kYXJkTWF0ZXJpYWwobmFtZSwgc2NlbmUpOyBtLmRpZmZ1c2VUZXh0dXJlID0gZHluKHNjZW5lLCAxMjgsIDEyOCwgZHJhdyk7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyBtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0uYmFja0ZhY2VDdWxsaW5nID0gZmFsc2U7IEEuZW1vdGVbbmFtZV0gPSBtOyB9O1xuICBjb25zdCBnbHlwaCA9IChjaDogc3RyaW5nLCBmaWxsOiBzdHJpbmcpID0+IChjOiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQpID0+IHsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5saW5lV2lkdGggPSAxMjsgYy5zdHJva2VTdHlsZSA9ICcjMTUwZDI2JzsgYy5saW5lSm9pbiA9ICdyb3VuZCc7IGMuZmlsbFN0eWxlID0gZmlsbDsgYy5mb250ID0gJzkwMCAxMDRweCBzYW5zLXNlcmlmJzsgYy5zdHJva2VUZXh0KGNoLCA2NCwgMTAwKTsgYy5maWxsVGV4dChjaCwgNjQsIDEwMCk7IH07XG4gIGljb24oJz8nLCBnbHlwaCgnPycsICcjZmZlMjdhJykpOyBpY29uKCchJywgZ2x5cGgoJyEnLCAnI2ZmOWE3YScpKTtcbiAgaWNvbignc3dlYXQnLCAoYykgPT4geyBjLmxpbmVXaWR0aCA9IDg7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MzA0YSc7IGMuZmlsbFN0eWxlID0gJyM5ZmU0ZmYnOyBjLmJlZ2luUGF0aCgpOyBjLm1vdmVUbyg2NCwgMTQpOyBjLmJlemllckN1cnZlVG8oMTA0LCA2MiwgMTA0LCAxMDgsIDY0LCAxMTIpOyBjLmJlemllckN1cnZlVG8oMjQsIDEwOCwgMjQsIDYyLCA2NCwgMTQpOyBjLmNsb3NlUGF0aCgpOyBjLnN0cm9rZSgpOyBjLmZpbGwoKTsgfSk7XG4gIGljb24oJ3NwYXJrbGUnLCAoYykgPT4geyBjLmxpbmVXaWR0aCA9IDc7IGMuc3Ryb2tlU3R5bGUgPSAnIzNhMmEwNSc7IGMuZmlsbFN0eWxlID0gJyNmZmYyYTgnOyBjb25zdCBzdGFyID0gKHg6IG51bWJlciwgeTogbnVtYmVyLCByOiBudW1iZXIpID0+IHsgYy5iZWdpblBhdGgoKTsgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspIHsgY29uc3QgYSA9IGkgKiBNYXRoLlBJIC8gNCwgcnIgPSBpICUgMiA/IHIgKiAwLjI4IDogcjsgYy5saW5lVG8oeCArIE1hdGguc2luKGEpICogcnIsIHkgLSBNYXRoLmNvcyhhKSAqIHJyKTsgfSBjLmNsb3NlUGF0aCgpOyBjLnN0cm9rZSgpOyBjLmZpbGwoKTsgfTsgc3Rhcig1NiwgNzAsIDUwKTsgc3RhcigxMDIsIDI4LCAyMCk7IHN0YXIoMjYsIDI0LCAxNCk7IH0pO1xuICBjb25zdCBkZWZzOiBbU291bElkLCBzdHJpbmcsIHN0cmluZywgUmVjb3JkPFZTdGF0ZSwgc3RyaW5nPiwgbnVtYmVyLCBudW1iZXIsIGFueT9dW10gPSBbXG4gICAgWyd3YXJyaW9yJywgJ1NrZWxldG9uV2Fycmlvci5nbGInLCAnU2tlbGV0b25XYXJyaW9yX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdUcmlwJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdCb25rJywgZW1vdGU6ICc/JyB9LCB7IGNsaXA6ICdXb2JibGUnLCBlbW90ZTogJ3N3ZWF0JyB9LCB7IGNsaXA6ICdXYXZlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdGdW1ibGUnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ1NoaWVsZEJvbmsnLCBlbW90ZTogJz8nIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1dhdmUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1RyaXAnLCBlbW90ZTogJyEnIH1dLCBleWVzOiAnU2tlbGV0b25XYXJyaW9yX2V5ZXMucG5nJyB9XSxcbiAgICBbJ2FyY2hlcicsICdTa2VsZXRvbkFyY2hlci5nbGInLCAnU2tlbGV0b25BcmNoZXJfZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ1Nob290JywgZGVhdGg6ICdEZWF0aCcsIHNwYXduOiAnU3Bhd24nLCBjaGVlcjogJ0ZsZXgnIH0sIDEuMDUsIDEuMCwgeyBmbGF2b3I6IHsgY2xpcHM6IFt7IGNsaXA6ICdGbGV4JywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdEb3VibGVCaWNlcHMnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvbmVDcmFjaycgfSwgeyBjbGlwOiAnQm93VHdpcmwnLCBlbW90ZTogJ3NwYXJrbGUnIH1dLCBtaW46IDgsIG1heDogMTUgfSwgY2hlZXJzOiBbeyBjbGlwOiAnRmxleCcsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnRG91YmxlQmljZXBzJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdCb3dUd2lybCcsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdTa2VsZXRvbkFyY2hlcl9leWVzLnBuZycgfV0sXG4gICAgWydnb2JsaW4nLCAnR29ibGluLmdsYicsICdHb2JsaW5fZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wLCAwLjg1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1NjaGVtZScsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnUGVlaycsIGVtb3RlOiAnPycgfSwgeyBjbGlwOiAnU3BpbicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU25pY2tlcicsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogNiwgbWF4OiAxMiB9LCBjaGVlcnM6IFt7IGNsaXA6ICdDaGVlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU25pY2tlcicsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnU3BpbicsIGVtb3RlOiAnc3BhcmtsZScgfV0sIGV5ZXM6ICdHb2JsaW5fZXllcy5wbmcnIH1dLFxuICAgIFsna25pZ2h0JywgJ0tuaWdodC5nbGInLCAnS25pZ2h0X2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnUG9zZScgfSwgMS4wLCAxLjA1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1NhbHV0ZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnQm9hc3QnLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0FkbWlyZScsIGVtb3RlOiAnc3BhcmtsZScgfSwgeyBjbGlwOiAnUHJheScsIGVtb3RlOiAnc3BhcmtsZScgfV0sIG1pbjogOCwgbWF4OiAxNSB9LCBjaGVlcnM6IFt7IGNsaXA6ICdQb3NlJywgZW1vdGU6ICdzcGFya2xlJyB9LCB7IGNsaXA6ICdTYWx1dGUnLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ0JvYXN0JywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdQcmF5JywgZW1vdGU6ICdzcGFya2xlJyB9XSwgZXllczogJ0tuaWdodF9leWVzLnBuZycgfV0sXG4gICAgWydiYXJiYXJpYW4nLCAnQmFyYmFyaWFuLmdsYicsICdCYXJiYXJpYW5fZW5lbXkuanBnJywgeyBpZGxlOiAnSWRsZScsIHJ1bjogJ1J1bicsIGF0dGFjazogJ0F0dGFjaycsIGRlYXRoOiAnRGVhdGgnLCBzcGF3bjogJ1NwYXduJywgY2hlZXI6ICdDaGVlcicgfSwgMS4wLCAxLjA1LCB7IGZsYXZvcjogeyBjbGlwczogW3sgY2xpcDogJ1JvYXInLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0NoZXN0QmVhdCcgfSwgeyBjbGlwOiAnU3RvbXAnLCBlbW90ZTogJyEnIH1dLCBtaW46IDcsIG1heDogMTMgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInLCBlbW90ZTogJ3NwYXJrbGUnIH0sIHsgY2xpcDogJ1JvYXInLCBlbW90ZTogJyEnIH0sIHsgY2xpcDogJ0NoZXN0QmVhdCcgfV0sIGV5ZXM6ICdCYXJiYXJpYW5fZXllcy5wbmcnIH1dLFxuICAgIFsnb2dyZScsICdPZ3JlLmdsYicsICdPZ3JlX2VuZW15LmpwZycsIHsgaWRsZTogJ0lkbGUnLCBydW46ICdSdW4nLCBhdHRhY2s6ICdBdHRhY2snLCBkZWF0aDogJ0RlYXRoJywgc3Bhd246ICdTcGF3bicsIGNoZWVyOiAnQ2hlZXInIH0sIDEuMDIsIDEuMTIsIHsgc3RhclNjYWxlOiBbMSwgMS4zLCAxLjY1XSwgZmxhdm9yOiB7IGNsaXBzOiBbeyBjbGlwOiAnWWF3bicsIGVtb3RlOiAnenp6JyB9LCB7IGNsaXA6ICdTY3JhdGNoJyB9LCB7IGNsaXA6ICdTdG9tcCcsIGVtb3RlOiAnIScgfSwgeyBjbGlwOiAnVGh1bXAnIH1dLCBtaW46IDksIG1heDogMTYgfSwgY2hlZXJzOiBbeyBjbGlwOiAnQ2hlZXInIH0sIHsgY2xpcDogJ1RodW1wJywgZW1vdGU6ICchJyB9LCB7IGNsaXA6ICdTdG9tcCcsIGVtb3RlOiAnIScgfV0sIHNwYXduRW1vdGU6ICd6enonLCBleWVzOiAnT2dyZV9leWVzLnBuZycgfV0sXG4gIF07XG4gIGNvbnN0IG5lY3JvUCA9IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCAnTmVjcm9tYW5jZXIuZ2xiJywgc2NlbmUpLnRoZW4oKGM6IGFueSkgPT4geyBBLm5lY3JvID0gYzsgfSkuY2F0Y2goKCkgPT4geyAvKiB0aGUgZ2FtZSBjYW5ub3Qgc2hvdyBoaW0gKi8gfSk7XG4gIGNvbnN0IGFycm93UCA9IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCAnQXJyb3cuZ2xiJywgc2NlbmUpLnRoZW4oKGM6IGFueSkgPT4geyBBLmFycm93ID0gYzsgfSkuY2F0Y2goKCkgPT4geyAvKiBmYWxscyBiYWNrIHRvIHRoZSBwbGFpbiBsaW5lICovIH0pO1xuICBhd2FpdCBQcm9taXNlLmFsbChbYXJyb3dQLCBuZWNyb1AsIC4uLmRlZnMubWFwKGFzeW5jIChbc291bCwgZ2xiLCBlbmVteSwgY2xpcHMsIHRvcCwgc2NhbGUsIGV4dHJhXSkgPT4ge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGF3YWl0IEJBQllMT04uU2NlbmVMb2FkZXIuTG9hZEFzc2V0Q29udGFpbmVyQXN5bmMoJ2Fzc2V0cy8nLCBnbGIsIHNjZW5lKTtcbiAgICBBLnRyaXBvW3NvdWxdID0geyBjb250YWluZXIsIGVuZW15VGV4OiBuZXcgQkFCWUxPTi5UZXh0dXJlKCdhc3NldHMvJyArIGVuZW15LCBzY2VuZSwgZmFsc2UsIGZhbHNlKSwgY2xpcHMsIG1hdENhY2hlOiB7fSwgdG9wLCBzY2FsZSwgLi4uKGV4dHJhIHx8IHt9KSwgZXllVGV4OiBleHRyYSAmJiBleHRyYS5leWVzID8gbmV3IEJBQllMT04uVGV4dHVyZSgnYXNzZXRzLycgKyBleHRyYS5leWVzLCBzY2VuZSwgZmFsc2UsIGZhbHNlKSA6IHVuZGVmaW5lZCB9O1xuICB9KV0pO1xuICByZXR1cm4gQTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzaGFyZWQgZGVjb3JhdGlvblxuY2xhc3MgRGVjbyB7XG4gIHByaXZhdGUgcHM6IGFueSA9IG51bGw7IHByaXZhdGUgaGFsbzogYW55ID0gbnVsbDsgcHJpdmF0ZSBiYWRnZTogYW55OyBwcml2YXRlIHN0YXJzOiBhbnk7IHByaXZhdGUgZmlsbDogYW55OyBwcml2YXRlIGJhcjogYW55OyBwcml2YXRlIG1iZzogYW55OyBwcml2YXRlIG1maWxsOiBhbnk7IHByaXZhdGUgcmluZzogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBwYXJlbnQ6IGFueSwgcHJpdmF0ZSB0b3A6IG51bWJlciwgcHJpdmF0ZSByYWRpdXM6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSBBLnNjZW5lO1xuICAgIHRoaXMucmluZyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlRGlzYygncmluZycsIHsgcmFkaXVzOiBNYXRoLm1heCgwLjMsIHJhZGl1cyAqIDEuMTUpLCB0ZXNzZWxsYXRpb246IDI2IH0sIHMpOyB0aGlzLnJpbmcucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0aGlzLnJpbmcucG9zaXRpb24ueSA9IDAuMDI7IHRoaXMucmluZy5wYXJlbnQgPSBwYXJlbnQ7IHRoaXMucmluZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5iYWRnZSA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2JhZGdlJywgcyk7IHRoaXMuYmFkZ2UucGFyZW50ID0gcGFyZW50OyB0aGlzLmJhZGdlLnBvc2l0aW9uLnkgPSB0b3AgKyAwLjMyOyB0aGlzLmJhZGdlLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7XG4gICAgdGhpcy5zdGFycyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ3N0YXJzJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMTUgfSwgcyk7IHRoaXMuc3RhcnMucGFyZW50ID0gdGhpcy5iYWRnZTsgdGhpcy5zdGFycy5wb3NpdGlvbi55ID0gMC4xMTsgdGhpcy5zdGFycy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3Qgc20gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdzbScsIHMpOyBzbS5lbWlzc2l2ZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuV2hpdGUoKTsgc20uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgc20udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlOyB0aGlzLnN0YXJzLm1hdGVyaWFsID0gc207ICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtID0gc207XG4gICAgY29uc3QgYmcgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVBsYW5lKCdiZycsIHsgd2lkdGg6IDAuNiwgaGVpZ2h0OiAwLjA4NSB9LCBzKTsgYmcucGFyZW50ID0gdGhpcy5iYWRnZTsgYmcubWF0ZXJpYWwgPSBBLmJhckJnOyBiZy5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMuYmFyID0gYmc7XG4gICAgdGhpcy5maWxsID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnZmlsbCcsIHsgd2lkdGg6IDAuNTYsIGhlaWdodDogMC4wNSB9LCBzKTsgdGhpcy5maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMuZmlsbC5wb3NpdGlvbi56ID0gLTAuMDAyOyB0aGlzLmZpbGwuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMubWJnID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbWJnJywgeyB3aWR0aDogMC42LCBoZWlnaHQ6IDAuMDUgfSwgcyk7IHRoaXMubWJnLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWJnLnBvc2l0aW9uLnkgPSAtMC4wNzsgdGhpcy5tYmcubWF0ZXJpYWwgPSBBLmJhckJnOyB0aGlzLm1iZy5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5tZmlsbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ21maWxsJywgeyB3aWR0aDogMC41NiwgaGVpZ2h0OiAwLjAzIH0sIHMpOyB0aGlzLm1maWxsLnBhcmVudCA9IHRoaXMuYmFkZ2U7IHRoaXMubWZpbGwucG9zaXRpb24uc2V0KDAsIC0wLjA3LCAtMC4wMDIpOyB0aGlzLm1maWxsLm1hdGVyaWFsID0gQS5tYW5hRmlsbDsgdGhpcy5tZmlsbC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgdGhpcy5sdiA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2x2JywgeyB3aWR0aDogMC4zNiwgaGVpZ2h0OiAwLjEzNSB9LCBzKTsgdGhpcy5sdi5wYXJlbnQgPSB0aGlzLmJhZGdlOyB0aGlzLmx2LnBvc2l0aW9uLnNldCgtMC41MiwgMC4wLCAwKTsgdGhpcy5sdi5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMubHYuc2V0RW5hYmxlZChmYWxzZSk7XG4gICAgY29uc3QgbG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdsdm0nLCBzKTsgbG0uZW1pc3NpdmVDb2xvciA9IEJBQllMT04uQ29sb3IzLldoaXRlKCk7IGxtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IGxtLnVzZUFscGhhRnJvbURpZmZ1c2VUZXh0dXJlID0gdHJ1ZTsgdGhpcy5sdi5tYXRlcmlhbCA9IGxtO1xuICAgIHRoaXMuYmFyLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLmZpbGwuc2V0RW5hYmxlZChmYWxzZSk7IHRoaXMubWJnLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLm1maWxsLnNldEVuYWJsZWQoZmFsc2UpO1xuICB9XG4gIHByaXZhdGUgbHY6IGFueTsgcHJpdmF0ZSBsdk4gPSAwOyBwcml2YXRlIGJhck9uID0gZmFsc2U7IHByaXZhdGUgdGFnOiBhbnkgPSBudWxsO1xuICAvKiogQSByZWQgQk9TUyB0YWcgYWJvdmUgdGhlIHN0YXJzLiAqL1xuICBzZXRCb3NzKG9uOiBib29sZWFuKSB7XG4gICAgaWYgKCFvbikgeyBpZiAodGhpcy50YWcpIHRoaXMudGFnLnNldEVuYWJsZWQoZmFsc2UpOyByZXR1cm47IH1cbiAgICBpZiAoIXRoaXMudGFnKSB7XG4gICAgICBjb25zdCBBID0gdGhpcy5BLCB0ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnYm9zc3RhZycsIHsgd2lkdGg6IDAuNSwgaGVpZ2h0OiAwLjE3IH0sIEEuc2NlbmUpOyB0LnBhcmVudCA9IHRoaXMuYmFkZ2U7IHQucG9zaXRpb24uc2V0KDAsIDAuMjksIDApOyB0LmlzUGlja2FibGUgPSBmYWxzZTtcbiAgICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdib3NzdGFnbScsIEEuc2NlbmUpOyBtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBtLmRpc2FibGVMaWdodGluZyA9IHRydWU7IG0udXNlQWxwaGFGcm9tRGlmZnVzZVRleHR1cmUgPSB0cnVlO1xuICAgICAgbS5kaWZmdXNlVGV4dHVyZSA9IGR5bihBLnNjZW5lLCAxOTIsIDY0LCAoYykgPT4geyBjLmZvbnQgPSAnOTAwIDQ2cHggc2Fucy1zZXJpZic7IGMudGV4dEFsaWduID0gJ2NlbnRlcic7IGMubGluZVdpZHRoID0gODsgYy5zdHJva2VTdHlsZSA9ICcjMmEwNTA4JzsgYy5maWxsU3R5bGUgPSAnI2ZmNWI0YSc7IGMubGluZUpvaW4gPSAncm91bmQnOyBjLnN0cm9rZVRleHQoJ0JPU1MnLCA5NiwgNDgpOyBjLmZpbGxUZXh0KCdCT1NTJywgOTYsIDQ4KTsgfSk7XG4gICAgICB0Lm1hdGVyaWFsID0gbTsgdGhpcy50YWcgPSB0O1xuICAgIH1cbiAgICB0aGlzLnRhZy5zZXRFbmFibGVkKHRydWUpO1xuICB9XG4gIC8qKiBcIkxWIG5cIiBiZXNpZGUgdGhlIGhlYWx0aCBiYXIgKHBlcm1hbmVudCBTb3VsIGxldmVsKTsgMCBoaWRlcyBpdC4gKi9cbiAgc2V0TGV2ZWwobjogbnVtYmVyKSB7XG4gICAgdGhpcy5sdk4gPSBuOyBpZiAoIXRoaXMubHYpIHJldHVybjsgaWYgKG4gPD0gMCB8fCAhdGhpcy5iYXJPbikgeyB0aGlzLmx2LnNldEVuYWJsZWQoZmFsc2UpOyBpZiAobiA+IDApIHRoaXMuZW5zdXJlTHYobik7IHJldHVybjsgfVxuICAgIHRoaXMuZW5zdXJlTHYobik7IHRoaXMubHYuc2V0RW5hYmxlZCh0cnVlKTtcbiAgfVxuICBwcml2YXRlIGVuc3VyZUx2KG46IG51bWJlcikge1xuICAgIGNvbnN0IEEgPSB0aGlzLkE7IGlmICghQS5sdlRleFtuXSkgQS5sdlRleFtuXSA9IGR5bihBLnNjZW5lLCAxMjgsIDQ4LCAoYykgPT4geyBjLmZvbnQgPSAnYm9sZCAzNHB4IHNhbnMtc2VyaWYnOyBjLnRleHRBbGlnbiA9ICdjZW50ZXInOyBjLmxpbmVXaWR0aCA9IDY7IGMuc3Ryb2tlU3R5bGUgPSAnIzE1MGQyNic7IGMuZmlsbFN0eWxlID0gJyNlOGQ4ZmYnOyBjLmxpbmVKb2luID0gJ3JvdW5kJzsgYy5zdHJva2VUZXh0KCdMViAnICsgbiwgNjQsIDM2KTsgYy5maWxsVGV4dCgnTFYgJyArIG4sIDY0LCAzNik7IH0pO1xuICAgICh0aGlzLmx2Lm1hdGVyaWFsIGFzIGFueSkuZGlmZnVzZVRleHR1cmUgPSBBLmx2VGV4W25dO1xuICB9XG4gIC8qKiBUaGUgYmFycyBrZWVwIHRoZSBzYW1lIHNpemUgYW5kIHRoZSBzYW1lIHNtYWxsIGdhcCBhYm92ZSB0aGUgaGVhZCBob3dldmVyIGJpZyB0aGUgdW5pdCBncm93cy4gKi9cbiAgZml0KGs6IG51bWJlcikgeyB0aGlzLmJhZGdlLnNjYWxpbmcuc2V0QWxsKDEgLyBrKTsgdGhpcy5iYWRnZS5wb3NpdGlvbi55ID0gdGhpcy50b3AgKyAwLjMgLyBrOyBpZiAodGhpcy5oYWxvKSB0aGlzLmhhbG8ucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC4wODsgfVxuICBzZXQodGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLkEuc2NlbmUsIGNmZyA9IEFVUkFbc3RhciAtIDFdO1xuICAgICh0aGlzLnN0YXJzIGFzIGFueSkuX3NtLmRpZmZ1c2VUZXh0dXJlID0gdGhpcy5BLnN0YXJUZXhbc3RhciAtIDFdO1xuICAgIHRoaXMucmluZy5tYXRlcmlhbCA9IHRoaXMuQS5yaW5nTWF0W3RlYW1dOyB0aGlzLmZpbGwubWF0ZXJpYWwgPSB0aGlzLkEuYmFyRmlsbFt0ZWFtXTtcbiAgICBpZiAodGVhbSA9PT0gMCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmFpc2VkIGJ5IHRoZSBOZWNyb21hbmNlcjogcHVycGxlIGF1cmEgdGhhdCBncm93cyB3aXRoIHN0YXJzXG4gICAgICBpZiAoIXRoaXMucHMpIHtcbiAgICAgICAgY29uc3QgcHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnYXVyYScsIDcwLCBzKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGhpcy5BLnNvZnQ7IHBzLmVtaXR0ZXIgPSB0aGlzLnBhcmVudDsgcHMubWluRW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMiwgMCwgLTAuMik7IHBzLm1heEVtaXRCb3ggPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAuMiwgdGhpcy50b3AgKiAwLjUsIDAuMik7XG4gICAgICAgIHBzLm1pbkxpZmVUaW1lID0gMC41OyBwcy5tYXhMaWZlVGltZSA9IDEuMTsgcHMuZGlyZWN0aW9uMSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTAuMTUsIDAuOCwgLTAuMTUpOyBwcy5kaXJlY3Rpb24yID0gbmV3IEJBQllMT04uVmVjdG9yMygwLjE1LCAxLjUsIDAuMTUpO1xuICAgICAgICBwcy5taW5FbWl0UG93ZXIgPSAwLjM1OyBwcy5tYXhFbWl0UG93ZXIgPSAwLjg7IHBzLmdyYXZpdHkgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNCwgMCk7IHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgdGhpcy5wcyA9IHBzO1xuICAgICAgfVxuICAgICAgY29uc3QgcCA9IHRoaXMucHM7IHAuZW1pdFJhdGUgPSBjZmcucmF0ZTsgcC5taW5TaXplID0gY2ZnLm1pbjsgcC5tYXhTaXplID0gY2ZnLm1heDsgcC5jb2xvcjEgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uY2ZnLmMxKTsgcC5jb2xvcjIgPSBuZXcgQkFCWUxPTi5Db2xvcjQoLi4uY2ZnLmMyKTsgcC5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4yLCAwLCAwLjQsIDApO1xuICAgICAgaWYgKCFwLmlzU3RhcnRlZCgpKSBwLnN0YXJ0KCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLnBzICYmIHRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RvcCgpO1xuICAgIGlmIChzdGFyID49IDMpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBnb2xkIGhhbG8gYWJvdmUgdGhlIGhlYWRcbiAgICAgIGlmICghdGhpcy5oYWxvKSB7IHRoaXMuaGFsbyA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlVG9ydXMoJ2hhbG8nLCB7IGRpYW1ldGVyOiAwLjU1LCB0aGlja25lc3M6IDAuMDQsIHRlc3NlbGxhdGlvbjogMjQgfSwgcyk7IHRoaXMuaGFsby5wYXJlbnQgPSB0aGlzLnBhcmVudDsgdGhpcy5oYWxvLnBvc2l0aW9uLnkgPSB0aGlzLnRvcCArIDAuMDg7IHRoaXMuaGFsby5tYXRlcmlhbCA9IHRoaXMuQS5oYWxvTWF0OyB0aGlzLmhhbG8uaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgICB0aGlzLmhhbG8uc2V0RW5hYmxlZCh0cnVlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuaGFsbykgdGhpcy5oYWxvLnNldEVuYWJsZWQoZmFsc2UpO1xuICB9XG4gIHNldEhwKGY6IG51bWJlciB8IG51bGwpIHtcbiAgICBjb25zdCBvbiA9IGYgIT09IG51bGw7IHRoaXMuYmFyLnNldEVuYWJsZWQob24pOyB0aGlzLmZpbGwuc2V0RW5hYmxlZChvbik7IHRoaXMuYmFyT24gPSBvbjsgaWYgKHRoaXMubHYpIHRoaXMubHYuc2V0RW5hYmxlZChvbiAmJiB0aGlzLmx2TiA+IDApO1xuICAgIGlmIChvbikgeyBjb25zdCBrID0gTWF0aC5tYXgoMC4wMDEsIGYgYXMgbnVtYmVyKTsgdGhpcy5maWxsLnNjYWxpbmcueCA9IGs7IHRoaXMuZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0TWFuYShmOiBudW1iZXIgfCBudWxsKSB7XG4gICAgY29uc3Qgb24gPSBmICE9PSBudWxsOyB0aGlzLm1iZy5zZXRFbmFibGVkKG9uKTsgdGhpcy5tZmlsbC5zZXRFbmFibGVkKG9uKTtcbiAgICBpZiAob24pIHsgY29uc3QgayA9IE1hdGgubWF4KDAuMDAxLCBmIGFzIG51bWJlcik7IHRoaXMubWZpbGwuc2NhbGluZy54ID0gazsgdGhpcy5tZmlsbC5wb3NpdGlvbi54ID0gLSgwLjU2ICogKDEgLSBrKSkgLyAyOyB9XG4gIH1cbiAgc2V0QXVyYShvbjogYm9vbGVhbikgeyBpZiAodGhpcy5wcykgeyBpZiAob24gJiYgIXRoaXMucHMuaXNTdGFydGVkKCkpIHRoaXMucHMuc3RhcnQoKTsgaWYgKCFvbiAmJiB0aGlzLnBzLmlzU3RhcnRlZCgpKSB0aGlzLnBzLnN0b3AoKTsgfSB9XG4gIHVwZGF0ZShkdDogbnVtYmVyKSB7IGlmICh0aGlzLmhhbG8gJiYgdGhpcy5oYWxvLmlzRW5hYmxlZCgpKSB0aGlzLmhhbG8ucm90YXRpb24ueSArPSBkdCAqIDEuNjsgfVxuICBkaXNwb3NlKCkgeyBpZiAodGhpcy5wcykgeyB0aGlzLnBzLnN0b3AoKTsgdGhpcy5wcy5kaXNwb3NlKCk7IH0gW3RoaXMuaGFsbywgdGhpcy5yaW5nLCB0aGlzLnN0YXJzLCB0aGlzLmJhciwgdGhpcy5maWxsLCB0aGlzLm1iZywgdGhpcy5tZmlsbF0uZm9yRWFjaCgobSkgPT4gbSAmJiBtLmRpc3Bvc2UoKSk7IHRoaXMuYmFkZ2UuZGlzcG9zZSgpOyB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gcmVhbCBtb2RlbHNcbmNsYXNzIFRyaXBvVmlzdWFsIGltcGxlbWVudHMgVW5pdFZpc3VhbCB7XG4gIGhvbGRlcjogYW55OyB0ZWFtOiAwIHwgMTsgc3RhciA9IDE7IHN0YXRlOiBWU3RhdGUgPSAnaWRsZSc7IHRvcDogbnVtYmVyO1xuICBwcml2YXRlIGVudDogYW55OyBwcml2YXRlIGJvZHk6IGFueTsgcHJpdmF0ZSBhbmltczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9OyBwcml2YXRlIGN1cjogYW55ID0gbnVsbDsgcHJpdmF0ZSBkZWNvOiBEZWNvOyBwcml2YXRlIHBpY2s6IGFueTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIGJhc2U6IG51bWJlcjtcbiAgcHJpdmF0ZSBsYXN0Rmxhdm9yID0gJyc7IHByaXZhdGUgdWlkID0gJyc7IHByaXZhdGUgb3duOiBhbnkgPSBudWxsOyBwcml2YXRlIGlkbGVUID0gMDsgcHJpdmF0ZSBuZXh0Rmxhdm9yID0gMWU5OyBwcml2YXRlIGZsYXZvck9uID0gZmFsc2U7IHByaXZhdGUgcXVldWVkID0gZmFsc2U7IHByaXZhdGUgc3Bhd25UID0gMDsgcHJpdmF0ZSBleWVLID0gMC42NTsgcHJpdmF0ZSBlbW90ZXM6IHsgbTogYW55OyB0OiBudW1iZXI7IHkwOiBudW1iZXIgfVtdID0gW107XG4gIHByaXZhdGUgc291bElkOiBTb3VsSWQ7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgQTogQXNzZXRzLCBwcml2YXRlIGNmZzogVHJpcG9DZmcsIHNvdWw6IFNvdWxJZCwgdGVhbTogMCB8IDEsIHN0YXI6IG51bWJlcikge1xuICAgIHRoaXMuc291bElkID0gc291bDtcbiAgICBjb25zdCBzID0gQS5zY2VuZSwgdWlkID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNyk7IHRoaXMudWlkID0gdWlkO1xuICAgIHRoaXMuZW50ID0gY2ZnLmNvbnRhaW5lci5pbnN0YW50aWF0ZU1vZGVsc1RvU2NlbmUoKG46IHN0cmluZykgPT4gbiArICdfJyArIHVpZCwgZmFsc2UsIHsgZG9Ob3RJbnN0YW50aWF0ZTogdHJ1ZSB9KTtcbiAgICB0aGlzLmhvbGRlciA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3VuaXRfJyArIHVpZCwgcyk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICB0aGlzLmJvZHkgPSB0aGlzLmVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5maW5kKChtOiBhbnkpID0+IG0ubmFtZS5pbmNsdWRlcygnX0JvZHknKSk7XG4gICAgaWYgKCFjZmcuYmFzZU1hdCkgY2ZnLmJhc2VNYXQgPSB0aGlzLmJvZHkubWF0ZXJpYWw7XG4gICAgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4geyBnLnN0b3AoKTsgZy5lbmFibGVCbGVuZGluZyA9IHRydWU7IGcuYmxlbmRpbmdTcGVlZCA9IDAuMTI7IHRoaXMuYW5pbXNbZy5uYW1lLnNwbGl0KCdfJylbMF1dID0gZzsgfSk7XG4gICAgdGhpcy5lbnQucm9vdE5vZGVzWzBdLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IG0uYWx3YXlzU2VsZWN0QXNBY3RpdmVNZXNoID0gdHJ1ZTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IH0pO1xuICAgIHRoaXMudG9wID0gY2ZnLnRvcDsgdGhpcy5iYXNlID0gY2ZnLnNjYWxlOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIGlmIChjZmcuZmxhdm9yKSB0aGlzLm5leHRGbGF2b3IgPSBjZmcuZmxhdm9yLm1pbiArIE1hdGgucmFuZG9tKCkgKiAoY2ZnLmZsYXZvci5tYXggLSBjZmcuZmxhdm9yLm1pbik7XG4gICAgdGhpcy5kZWNvID0gbmV3IERlY28oQSwgdGhpcy5ob2xkZXIsIHRoaXMudG9wLCAwLjMpO1xuICAgIHRoaXMucGljayA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ3BpY2snLCB7IGhlaWdodDogMS4zLCBkaWFtZXRlcjogMC44IH0sIHMpOyB0aGlzLnBpY2sucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMucGljay5wb3NpdGlvbi55ID0gMC42OyB0aGlzLnBpY2sudmlzaWJpbGl0eSA9IDAuMDAxOyB0aGlzLnBpY2suaXNQaWNrYWJsZSA9IHRydWU7XG4gICAgdGhpcy5zZXRUZWFtKHRlYW0pOyB0aGlzLnNldFN0YXIoc3Rhcik7IHRoaXMucGljay5tZXRhZGF0YSA9IHsga2luZDogJ3VuaXQnLCB2aXN1YWw6IHRoaXMgfTtcbiAgfVxuICBwcml2YXRlIGFwcGx5TWF0KCkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMudGVhbSArICdfJyArIHRoaXMuc3RhciwgYyA9IHRoaXMuY2ZnO1xuICAgIGlmIChjLmV5ZVRleCkgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhpcyB1bml0IGhhcyBnbG93aW5nIGV5ZXM6IGl0IGdldHMgaXRzIG93biBtYXRlcmlhbCBzbyBpdHMgZ2xvdyBjYW4gY2hhbmdlIG9uIGl0cyBvd25cbiAgICAgIGlmICghdGhpcy5vd24pIHsgdGhpcy5vd24gPSBjLmJhc2VNYXQuY2xvbmUoJ293bl8nICsgdGhpcy51aWQpOyB0aGlzLm93bi5lbWlzc2l2ZVRleHR1cmUgPSBjLmV5ZVRleDsgdGhpcy5vd24uZW1pc3NpdmVJbnRlbnNpdHkgPSB0aGlzLmV5ZUs7IH1cbiAgICAgIHRoaXMub3duLmFsYmVkb1RleHR1cmUgPSB0aGlzLnRlYW0gPT09IDEgPyBjLmVuZW15VGV4IDogYy5iYXNlTWF0LmFsYmVkb1RleHR1cmU7IGNvbnN0IHQgPSBUSU5UW3RoaXMuc3RhciAtIDFdOyB0aGlzLm93bi5hbGJlZG9Db2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMyh0WzBdLCB0WzFdLCB0WzJdKTtcbiAgICAgIHRoaXMub3duLmVtaXNzaXZlQ29sb3IgPSB0aGlzLnRlYW0gPT09IDEgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC43MiwgMC4yKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc4LCAwLjMsIDEpO1xuICAgICAgdGhpcy5ib2R5Lm1hdGVyaWFsID0gdGhpcy5vd247IHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFjLm1hdENhY2hlW2tleV0pIHsgY29uc3QgbSA9IGMuYmFzZU1hdC5jbG9uZSgnbV8nICsga2V5KTsgaWYgKHRoaXMudGVhbSA9PT0gMSkgbS5hbGJlZG9UZXh0dXJlID0gYy5lbmVteVRleDsgY29uc3QgdCA9IFRJTlRbdGhpcy5zdGFyIC0gMV07IG0uYWxiZWRvQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjModFswXSwgdFsxXSwgdFsyXSk7IGMubWF0Q2FjaGVba2V5XSA9IG07IH1cbiAgICB0aGlzLmJvZHkubWF0ZXJpYWwgPSBjLm1hdENhY2hlW2tleV07XG4gIH1cbiAgc2V0VGVhbSh0OiAwIHwgMSkgeyB0aGlzLnRlYW0gPSB0OyB0aGlzLmFwcGx5TWF0KCk7IHRoaXMuZGVjby5zZXQodCwgdGhpcy5zdGFyKTsgfVxuICBzZXRTdGFyKHN0OiBudW1iZXIpIHsgdGhpcy5zdGFyID0gc3Q7IHRoaXMuYXBwbHlNYXQoKTsgdGhpcy5ob2xkZXIuc2NhbGluZy5zZXRBbGwodGhpcy5zYyhzdCkgKiB0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0KHRoaXMudGVhbSwgc3QpOyB0aGlzLmRlY28uZml0KHRoaXMuc2Moc3QpICogdGhpcy5iYXNlKTsgfVxuICBwcml2YXRlIGJvc3NLID0gMTtcbiAgLyoqIFRoZSBpbnNwZWN0IHZpZXc6IHdoaWNoIGFuaW1hdGlvbnMgdGhpcyB1bml0IGhhcywgYW5kIGEgd2F5IHRvIHBsYXkgYW55IG9uZSBvZiB0aGVtLiAqL1xuICBjbGlwTmFtZXMoKTogc3RyaW5nW10geyByZXR1cm4gT2JqZWN0LmtleXModGhpcy5hbmltcykuZmlsdGVyKChuKSA9PiBuICE9PSAnV2FsaycgJiYgbiAhPT0gJ0hpdCcpOyB9XG4gIHByZXZpZXdDbGlwKG5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IGcgPSB0aGlzLmFuaW1zW25hbWVdOyBpZiAoIWcpIHJldHVybjtcbiAgICBpZiAobmFtZSA9PT0gJ0lkbGUnKSB7IHRoaXMucGxheSgnaWRsZScpOyByZXR1cm47IH1cbiAgICB0aGlzLnF1ZXVlZCA9IGZhbHNlOyBpZiAodGhpcy5jdXIpIHRoaXMuY3VyLnN0b3AoKTsgZy5zdG9wKCk7IGcuc3RhcnQoZmFsc2UsIDEsIGcuZnJvbSwgZy50byk7IHRoaXMuY3VyID0gZzsgdGhpcy5mbGF2b3JPbiA9IHRydWU7IHRoaXMuc3RhdGUgPSAnaWRsZSc7IHRoaXMuaWRsZVQgPSAwO1xuICAgIGNvbnN0IHBvc2UgPSBbLi4uKHRoaXMuY2ZnLmZsYXZvcj8uY2xpcHMgfHwgW10pLCAuLi4odGhpcy5jZmcuY2hlZXJzIHx8IFtdKV0uZmluZCgocCkgPT4gcC5jbGlwID09PSBuYW1lKTtcbiAgICBpZiAocG9zZSAmJiBwb3NlLmVtb3RlKSB7IHRoaXMuZW1vdGUocG9zZS5lbW90ZSwgMC40KTsgaWYgKHBvc2UuZW1vdGUgPT09ICd6enonKSB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDEuMik7IH1cbiAgICBpZiAoVk9DQUwuaGFzKG5hbWUpIHx8IG5hbWUgPT09ICdDaGVlcicgfHwgbmFtZSA9PT0gJ0F0dGFjaycpIGF1ZGlvLmJhcmsodGhpcy5zb3VsSWQsIDAuMik7XG4gIH1cbiAgcHJpdmF0ZSBzYyhzdDogbnVtYmVyKSB7IHJldHVybiAodGhpcy5jZmcuc3RhclNjYWxlIHx8IEJBTEFOQ0Uuc3Rhci5zY2FsZSlbc3QgLSAxXSAqIHRoaXMuYm9zc0s7IH1cbiAgc2V0Qm9zcyhvbjogYm9vbGVhbikgeyB0aGlzLmJvc3NLID0gb24gPyAxLjMgOiAxOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLnNjKHRoaXMuc3RhcikgKiB0aGlzLmJhc2UpOyB0aGlzLmRlY28uZml0KHRoaXMuc2ModGhpcy5zdGFyKSAqIHRoaXMuYmFzZSk7IHRoaXMuZGVjby5zZXRCb3NzKG9uKTsgfVxuICBzZXRIcChmOiBudW1iZXIgfCBudWxsKSB7IHRoaXMuZGVjby5zZXRIcChmKTsgfVxuICBzZXRMZXZlbChuOiBudW1iZXIpIHsgdGhpcy5kZWNvLnNldExldmVsKG4pOyB9XG4gIHNldE1hbmEoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0TWFuYShmKTsgfVxuICBwdWxzZSgpIHsgdGhpcy5wdWxzZVQgPSAwLjE2OyB9XG4gIHBsYXkoc3RhdGU6IFZTdGF0ZSwgc3BlZWQgPSAxKSB7XG4gICAgbGV0IGNsaXAgPSB0aGlzLmNmZy5jbGlwc1tzdGF0ZV0sIHBvc2U6IFBvc2UgfCB1bmRlZmluZWQ7XG4gICAgaWYgKHN0YXRlID09PSAnY2hlZXInICYmIHRoaXMuY2ZnLmNoZWVycykgeyBwb3NlID0gdGhpcy5jZmcuY2hlZXJzW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIHRoaXMuY2ZnLmNoZWVycy5sZW5ndGgpXTsgY2xpcCA9IHBvc2UuY2xpcDsgfVxuICAgIGNvbnN0IGcgPSB0aGlzLmFuaW1zW2NsaXBdOyBpZiAoIWcpIHJldHVybjsgY29uc3QgbG9vcCA9IHN0YXRlID09PSAnaWRsZScgfHwgc3RhdGUgPT09ICdydW4nO1xuICAgIGlmIChzdGF0ZSA9PT0gJ2lkbGUnICYmIHRoaXMuc3RhdGUgPT09ICdzcGF3bicgJiYgdGhpcy5jdXIgJiYgdGhpcy5jdXIuaXNTdGFydGVkICYmIHRoaXMuY2ZnLmZsYXZvcikgeyB0aGlzLnF1ZXVlZCA9IHRydWU7IHJldHVybjsgfSAgIC8vIGxldCB0aGUgd2FrZS11cCBwbGF5IHRvIHRoZSBlbmRcbiAgICBpZiAobG9vcCAmJiB0aGlzLnN0YXRlID09PSBzdGF0ZSAmJiB0aGlzLmN1ciA9PT0gZykgcmV0dXJuO1xuICAgIHRoaXMucXVldWVkID0gZmFsc2U7IHRoaXMuZmxhdm9yT24gPSBmYWxzZTsgdGhpcy5pZGxlVCA9IDA7XG4gICAgaWYgKHRoaXMuY3VyKSB0aGlzLmN1ci5zdG9wKCk7IGcuc3RvcCgpOyBnLnN0YXJ0KGxvb3AsIHNwZWVkLCBnLmZyb20sIGcudG8pO1xuICAgIGlmIChsb29wKSBnLmdvVG9GcmFtZShnLmZyb20gKyBNYXRoLnJhbmRvbSgpICogKGcudG8gLSBnLmZyb20pKTtcbiAgICB0aGlzLmN1ciA9IGc7IHRoaXMuc3RhdGUgPSBzdGF0ZTsgdGhpcy5kZWNvLnNldEF1cmEoc3RhdGUgIT09ICdkZWF0aCcpO1xuICAgIGlmIChwb3NlICYmIHBvc2UuZW1vdGUpIHRoaXMuZW1vdGUocG9zZS5lbW90ZSwgMC4zNSk7XG4gICAgaWYgKHN0YXRlID09PSAnc3Bhd24nKSB7IHRoaXMuc3Bhd25UID0gMDsgaWYgKHRoaXMuY2ZnLnNwYXduRW1vdGUpIHsgdGhpcy5lbW90ZSh0aGlzLmNmZy5zcGF3bkVtb3RlLCAwLjEpOyB0aGlzLmVtb3RlKHRoaXMuY2ZnLnNwYXduRW1vdGUsIDAuNyk7IH0gfVxuICB9XG4gIC8qKiBBIGxpdHRsZSBwaWN0dXJlIHRoYXQgZmxvYXRzIHVwIG92ZXIgdGhlIGhlYWQgYW5kIGZhZGVzIChhIHNsZWVweSBcIlp6elwiKS4gKi9cbiAgcHJpdmF0ZSBlbW90ZShraW5kOiBzdHJpbmcsIGRlbGF5ID0gMCkge1xuICAgIGNvbnN0IG1hdCA9IHRoaXMuQS5lbW90ZVtraW5kXTsgaWYgKCFtYXQpIHJldHVybjtcbiAgICBjb25zdCBwbCA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlUGxhbmUoJ2VtbycsIHsgc2l6ZTogMC40MiB9LCB0aGlzLkEuc2NlbmUpOyBwbC5wYXJlbnQgPSB0aGlzLmhvbGRlcjsgcGwuYmlsbGJvYXJkTW9kZSA9IEJBQllMT04uTWVzaC5CSUxMQk9BUkRNT0RFX0FMTDsgcGwubWF0ZXJpYWwgPSBtYXQ7IHBsLmlzUGlja2FibGUgPSBmYWxzZTsgcGwudmlzaWJpbGl0eSA9IDA7XG4gICAgY29uc3QgeTAgPSB0aGlzLnRvcCArIDAuMDI7IHBsLnBvc2l0aW9uLnNldCgwLjE2LCB5MCwgMCk7IHRoaXMuZW1vdGVzLnB1c2goeyBtOiBwbCwgdDogLWRlbGF5LCB5MCB9KTtcbiAgfVxuICAvKiogQWZ0ZXIgc3RhbmRpbmcgaWRsZSBmb3IgYSB3aGlsZTogcGxheSB0aGUgdW5pdCdzIGZsYXZvdXIgY2xpcCBvbmNlICh0aGUgT2dyZSB5YXducyksIHRoZW4gZ28gYmFjayB0byBpZGxpbmcuICovXG4gIHByaXZhdGUgc3RhcnRGbGF2b3IoKSB7XG4gICAgY29uc3QgZiA9IHRoaXMuY2ZnLmZsYXZvciE7IHRoaXMuaWRsZVQgPSAwO1xuICAgIGxldCBwb29sID0gZi5jbGlwcy5maWx0ZXIoKGMpID0+IGMuY2xpcCAhPT0gdGhpcy5sYXN0Rmxhdm9yICYmIHRoaXMuYW5pbXNbYy5jbGlwXSk7IGlmICghcG9vbC5sZW5ndGgpIHBvb2wgPSBmLmNsaXBzLmZpbHRlcigoYykgPT4gdGhpcy5hbmltc1tjLmNsaXBdKTsgaWYgKCFwb29sLmxlbmd0aCkgcmV0dXJuO1xuICAgIGNvbnN0IHBvc2UgPSBwb29sW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIHBvb2wubGVuZ3RoKV0sIGcgPSB0aGlzLmFuaW1zW3Bvc2UuY2xpcF07IHRoaXMubGFzdEZsYXZvciA9IHBvc2UuY2xpcDtcbiAgICBpZiAodGhpcy5jdXIpIHRoaXMuY3VyLnN0b3AoKTsgZy5zdG9wKCk7IGcuc3RhcnQoZmFsc2UsIDEsIGcuZnJvbSwgZy50byk7IHRoaXMuY3VyID0gZzsgdGhpcy5mbGF2b3JPbiA9IHRydWU7IHRoaXMubmV4dEZsYXZvciA9IGYubWluICsgTWF0aC5yYW5kb20oKSAqIChmLm1heCAtIGYubWluKTtcbiAgICBpZiAoVk9DQUwuaGFzKHBvc2UuY2xpcCkpIGF1ZGlvLmJhcmsodGhpcy5zb3VsSWQsIDAuMjUpO1xuICAgIGlmIChwb3NlLmVtb3RlKSB7IHRoaXMuZW1vdGUocG9zZS5lbW90ZSwgMC40KTsgaWYgKHBvc2UuZW1vdGUgPT09ICd6enonKSB0aGlzLmVtb3RlKHBvc2UuZW1vdGUsIDEuMik7IH1cbiAgfVxuICB1cGRhdGUoZHQ6IG51bWJlcikge1xuICAgIHRoaXMuZGVjby51cGRhdGUoZHQpO1xuICAgIGlmICh0aGlzLmN1ciAmJiAhdGhpcy5jdXIuaXNTdGFydGVkKSB7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgb25lLXNob3QgY2xpcCBmaW5pc2hlZFxuICAgICAgaWYgKHRoaXMucXVldWVkKSB7IHRoaXMucXVldWVkID0gZmFsc2U7IHRoaXMucGxheSgnaWRsZScpOyB9IGVsc2UgaWYgKHRoaXMuZmxhdm9yT24pIHsgdGhpcy5mbGF2b3JPbiA9IGZhbHNlOyB0aGlzLnBsYXkoJ2lkbGUnKTsgfSBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnY2hlZXInKSB0aGlzLnBsYXkoJ2lkbGUnKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuY2ZnLmZsYXZvciAmJiB0aGlzLnN0YXRlID09PSAnaWRsZScgJiYgIXRoaXMuZmxhdm9yT24gJiYgdGhpcy5ob2xkZXIuaXNFbmFibGVkKCkpIHsgdGhpcy5pZGxlVCArPSBkdDsgaWYgKHRoaXMuaWRsZVQgPj0gdGhpcy5uZXh0Rmxhdm9yKSB0aGlzLnN0YXJ0Rmxhdm9yKCk7IH1cbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gJ3NwYXduJykgdGhpcy5zcGF3blQgKz0gZHQ7XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuZW1vdGVzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBlID0gdGhpcy5lbW90ZXNbaV07IGUudCArPSBkdDsgaWYgKGUudCA8IDApIGNvbnRpbnVlOyBjb25zdCBrID0gZS50IC8gMS45O1xuICAgICAgaWYgKGsgPj0gMSkgeyBlLm0uZGlzcG9zZSgpOyB0aGlzLmVtb3Rlcy5zcGxpY2UoaSwgMSk7IGNvbnRpbnVlOyB9XG4gICAgICBlLm0udmlzaWJpbGl0eSA9IE1hdGgubWluKDEsIGUudCAvIDAuMikgKiAoMSAtIGsgKiBrKTsgZS5tLnBvc2l0aW9uLnNldCgwLjE2ICsgMC4wNSAqIE1hdGguc2luKGUudCAqIDMpLCBlLnkwICsgZS50ICogMC4yLCAwKTsgZS5tLnNjYWxpbmcuc2V0QWxsKDAuNyArIDAuNSAqIGspO1xuICAgIH1cbiAgICBpZiAodGhpcy5vd24pIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXllIGdsb3cgZm9sbG93cyB0aGUgbW9vZDogZGltIHdoZW4gc2xlZXB5LCBicmlnaHQgd2hlbiBhd2FrZSwgZmxhcmluZyBpbiBhIGZpZ2h0XG4gICAgICBsZXQgdGFyZ2V0ID0gMC42NTtcbiAgICAgIGlmICh0aGlzLnN0YXRlID09PSAnc3Bhd24nKSB0YXJnZXQgPSAwLjA4ICsgMC45MiAqIE1hdGgubWF4KDAsIE1hdGgubWluKDEsICh0aGlzLnNwYXduVCAvIDEuNjcgLSAwLjQ1KSAvIDAuMykpO1xuICAgICAgZWxzZSBpZiAodGhpcy5zdGF0ZSA9PT0gJ2lkbGUnKSB0YXJnZXQgPSB0aGlzLmZsYXZvck9uID8gMC4yNSA6IDAuNjU7XG4gICAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAncnVuJykgdGFyZ2V0ID0gMS4wOyBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnYXR0YWNrJykgdGFyZ2V0ID0gMS43OyBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnY2hlZXInKSB0YXJnZXQgPSAxLjQ7IGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdkZWF0aCcpIHRhcmdldCA9IDAuMDU7XG4gICAgICB0aGlzLmV5ZUsgKz0gKHRhcmdldCAtIHRoaXMuZXllSykgKiBNYXRoLm1pbigxLCBkdCAqIDcpOyB0aGlzLm93bi5lbWlzc2l2ZUludGVuc2l0eSA9IHRoaXMuZXllSztcbiAgICB9XG4gICAgaWYgKHRoaXMucHVsc2VUID4gMCkgeyB0aGlzLnB1bHNlVCAtPSBkdDsgY29uc3QgayA9IDEgKyAwLjA5ICogTWF0aC5zaW4oTWF0aC5tYXgoMCwgdGhpcy5wdWxzZVQpIC8gMC4xNiAqIE1hdGguUEkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLnNjKHRoaXMuc3RhcikgKiB0aGlzLmJhc2UgKiBrKTsgfVxuICB9XG4gIGRpc3Bvc2UoKSB7IHRoaXMuZW1vdGVzLmZvckVhY2goKGUpID0+IGUubS5kaXNwb3NlKCkpOyBpZiAodGhpcy5vd24pIHRoaXMub3duLmRpc3Bvc2UoKTsgdGhpcy5kZWNvLmRpc3Bvc2UoKTsgdGhpcy5lbnQuYW5pbWF0aW9uR3JvdXBzLmZvckVhY2goKGc6IGFueSkgPT4gZy5kaXNwb3NlKCkpOyB0aGlzLmVudC5za2VsZXRvbnMuZm9yRWFjaCgoczogYW55KSA9PiBzLmRpc3Bvc2UoKSk7IHRoaXMucGljay5kaXNwb3NlKCk7IHRoaXMuZW50LnJvb3ROb2Rlc1swXS5kaXNwb3NlKGZhbHNlLCBmYWxzZSk7IHRoaXMuaG9sZGVyLmRpc3Bvc2UoKTsgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YW5kLWluc1xuY29uc3QgUEg6IFJlY29yZDxzdHJpbmcsIHsgY29sOiBzdHJpbmc7IHc6IG51bWJlcjsgaDogbnVtYmVyOyBoZWFkOiBudW1iZXI7IHdlYXBvbjogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0+ID0ge1xuICBnb2JsaW46IHsgY29sOiAnIzYzYjEzZicsIHc6IDAuMzYsIGg6IDAuNDIsIGhlYWQ6IDAuMzYsIHdlYXBvbjogJ2RhZ2dlcicsIGxhYmVsOiAnR09CTElOJyB9LFxuICBrbmlnaHQ6IHsgY29sOiAnIzhlYTlkYycsIHc6IDAuNSwgaDogMC42LCBoZWFkOiAwLjM2LCB3ZWFwb246ICdzaGllbGQnLCBsYWJlbDogJ0tOSUdIVCcgfSxcbiAgb2dyZTogeyBjb2w6ICcjYThhNjRhJywgdzogMC44NSwgaDogMC44NSwgaGVhZDogMC40Miwgd2VhcG9uOiAnbWFjZScsIGxhYmVsOiAnT0dSRScgfSxcbiAgYmFyYmFyaWFuOiB7IGNvbDogJyNkNjhhNTUnLCB3OiAwLjUyLCBoOiAwLjYyLCBoZWFkOiAwLjM4LCB3ZWFwb246ICdheGUnLCBsYWJlbDogJ0JBUkJBUklBTicgfSxcbn07XG5jbGFzcyBQbGFjZWhvbGRlclZpc3VhbCBpbXBsZW1lbnRzIFVuaXRWaXN1YWwge1xuICBob2xkZXI6IGFueTsgdGVhbTogMCB8IDE7IHN0YXIgPSAxOyBzdGF0ZTogVlN0YXRlID0gJ2lkbGUnOyB0b3A6IG51bWJlcjtcbiAgcHJpdmF0ZSByaWc6IGFueTsgcHJpdmF0ZSBsZWdzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHdwOiBhbnk7IHByaXZhdGUgZGVjbzogRGVjbzsgcHJpdmF0ZSBwaWNrOiBhbnk7IHByaXZhdGUgdCA9IE1hdGgucmFuZG9tKCkgKiA2OyBwcml2YXRlIHN0MCA9IDA7IHByaXZhdGUgZHVyID0gMTsgcHJpdmF0ZSBiYXNlID0gMTsgcHJpdmF0ZSBwdWxzZVQgPSAwOyBwcml2YXRlIG1hdHM6IGFueVtdID0gW107IHByaXZhdGUgYm9keTogYW55O1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIEE6IEFzc2V0cywgcHJpdmF0ZSBzb3VsOiBzdHJpbmcsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpIHtcbiAgICBjb25zdCBzID0gQS5zY2VuZSwgZCA9IFBIW3NvdWxdOyB0aGlzLnRlYW0gPSB0ZWFtO1xuICAgIHRoaXMuaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgncGhfJyArIHNvdWwsIHMpOyB0aGlzLnJpZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ3JpZycsIHMpOyB0aGlzLnJpZy5wYXJlbnQgPSB0aGlzLmhvbGRlcjtcbiAgICBjb25zdCBtYXQgPSAoaGV4OiBzdHJpbmcsIGVtID0gMCkgPT4geyBjb25zdCBtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgncG0nLCBzKTsgbS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5Gcm9tSGV4U3RyaW5nKGhleCkuc2NhbGUoMC43Mik7IG0uc3BlY3VsYXJDb2xvciA9IG5ldyBCQUJZTE9OLkNvbG9yMygwLjEsIDAuMSwgMC4xKTsgaWYgKGVtKSBtLmVtaXNzaXZlQ29sb3IgPSBtLmRpZmZ1c2VDb2xvci5zY2FsZShlbSk7IHJldHVybiBtOyB9O1xuICAgIGNvbnN0IGxlZ0ggPSAwLjIyLCBib2R5WSA9IGxlZ0ggKyBkLmggLyAyO1xuICAgIGZvciAoY29uc3Qgc3ggb2YgWy0xLCAxXSkgeyBjb25zdCBsZyA9IG5ldyBCQUJZTE9OLlRyYW5zZm9ybU5vZGUoJ2xlZycsIHMpOyBsZy5wYXJlbnQgPSB0aGlzLnJpZzsgbGcucG9zaXRpb24uc2V0KHN4ICogZC53ICogMC4yMiwgbGVnSCwgMCk7IGNvbnN0IG0gPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdsJywgeyBoZWlnaHQ6IGxlZ0gsIGRpYW1ldGVyOiBkLncgKiAwLjI4IH0sIHMpOyBtLnBhcmVudCA9IGxnOyBtLnBvc2l0aW9uLnkgPSAtbGVnSCAvIDI7IG0ubWF0ZXJpYWwgPSBtYXQoJyM0YTM4MjYnKTsgbS5pc1BpY2thYmxlID0gZmFsc2U7IHRoaXMubGVncy5wdXNoKGxnKTsgfVxuICAgIHRoaXMuYm9keSA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ2Fwc3VsZSgnYm9keScsIHsgcmFkaXVzOiBkLncgLyAyLCBoZWlnaHQ6IGQuaCArIGQudyAqIDAuNCB9LCBzKTsgdGhpcy5ib2R5LnBhcmVudCA9IHRoaXMucmlnOyB0aGlzLmJvZHkucG9zaXRpb24ueSA9IGJvZHlZOyB0aGlzLmJvZHkubWF0ZXJpYWwgPSBtYXQoZC5jb2wpOyB0aGlzLmJvZHkuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IGhlYWQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgnaGVhZCcsIHsgZGlhbWV0ZXI6IGQuaGVhZCAqIDEuNSwgc2VnbWVudHM6IDEyIH0sIHMpOyBoZWFkLnBhcmVudCA9IHRoaXMucmlnOyBoZWFkLnBvc2l0aW9uLnkgPSBsZWdIICsgZC5oICsgZC5oZWFkICogMC41NTsgaGVhZC5tYXRlcmlhbCA9IG1hdChkLmNvbCk7IGhlYWQuaXNQaWNrYWJsZSA9IGZhbHNlO1xuICAgIGNvbnN0IGV5ZU0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdleWUnLCBzKTsgZXllTS5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5CbGFjaygpOyBleWVNLmVtaXNzaXZlQ29sb3IgPSB0ZWFtID09PSAwID8gbmV3IEJBQllMT04uQ29sb3IzKDAuNzUsIDAuMjUsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNjYsIDAuMTkpOyAodGhpcyBhcyBhbnkpLmV5ZU0gPSBleWVNO1xuICAgIGZvciAoY29uc3Qgc3ggb2YgWy0xLCAxXSkgeyBjb25zdCBlID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVTcGhlcmUoJ2UnLCB7IGRpYW1ldGVyOiBkLmhlYWQgKiAwLjMgfSwgcyk7IGUucGFyZW50ID0gdGhpcy5yaWc7IGUucG9zaXRpb24uc2V0KHN4ICogZC5oZWFkICogMC4zLCBoZWFkLnBvc2l0aW9uLnkgKyAwLjAyLCBkLmhlYWQgKiAwLjY2KTsgZS5tYXRlcmlhbCA9IGV5ZU07IGUuaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgLy8gd2VhcG9uIHBpdm90IGF0IHRoZSBzaG91bGRlciwgb24gdGhlIGNoYXJhY3RlcidzIHJpZ2h0ICgteCBpcyBmaW5lIGZvciBhIHN0YW5kLWluKVxuICAgIHRoaXMud3AgPSBuZXcgQkFCWUxPTi5UcmFuc2Zvcm1Ob2RlKCd3cCcsIHMpOyB0aGlzLndwLnBhcmVudCA9IHRoaXMucmlnOyB0aGlzLndwLnBvc2l0aW9uLnNldChkLncgKiAwLjYsIGxlZ0ggKyBkLmggKiAwLjg1LCAwLjA1KTtcbiAgICBjb25zdCB3bSA9IG1hdCgnIzdhNWEzMCcpLCBpcm9uID0gbWF0KCcjOWFhMWFkJyk7XG4gICAgY29uc3QgbWsgPSAobTogYW55LCBraW5kOiBzdHJpbmcsIGRpbXM6IGFueSwgcG9zOiBudW1iZXJbXSwgbXQ6IGFueSkgPT4geyBjb25zdCB4ID0ga2luZCA9PT0gJ2JveCcgPyBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUJveCgndycsIGRpbXMsIHMpIDoga2luZCA9PT0gJ2N5bCcgPyBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCd3JywgZGltcywgcykgOiBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZVNwaGVyZSgndycsIGRpbXMsIHMpOyB4LnBhcmVudCA9IHRoaXMud3A7IHgucG9zaXRpb24uc2V0KHBvc1swXSwgcG9zWzFdLCBwb3NbMl0pOyB4Lm1hdGVyaWFsID0gbXQ7IHguaXNQaWNrYWJsZSA9IGZhbHNlOyByZXR1cm4geDsgfTtcbiAgICBpZiAoZC53ZWFwb24gPT09ICdkYWdnZXInKSBtaygwLCAnYm94JywgeyB3aWR0aDogMC4wNSwgaGVpZ2h0OiAwLjMsIGRlcHRoOiAwLjAzIH0sIFswLCAtMC4yLCAwLjEyXSwgaXJvbik7XG4gICAgaWYgKGQud2VhcG9uID09PSAnc2hpZWxkJykgeyBtaygwLCAnYm94JywgeyB3aWR0aDogMC4wNiwgaGVpZ2h0OiAwLjUsIGRlcHRoOiAwLjA0IH0sIFswLCAtMC4zLCAwLjE0XSwgaXJvbik7IGNvbnN0IHNoID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVDeWxpbmRlcignc2gnLCB7IGhlaWdodDogMC4wNSwgZGlhbWV0ZXI6IDAuNTUgfSwgcyk7IHNoLnBhcmVudCA9IHRoaXMucmlnOyBzaC5yb3RhdGlvbi56ID0gTWF0aC5QSSAvIDI7IHNoLnBvc2l0aW9uLnNldCgtZC53ICogMC43LCBsZWdIICsgZC5oICogMC42LCAwLjA1KTsgc2gubWF0ZXJpYWwgPSBtYXQoJyNkOGI2NGEnKTsgc2guaXNQaWNrYWJsZSA9IGZhbHNlOyB9XG4gICAgaWYgKGQud2VhcG9uID09PSAnbWFjZScpIHsgbWsoMCwgJ2N5bCcsIHsgaGVpZ2h0OiAwLjksIGRpYW1ldGVyOiAwLjA4IH0sIFswLCAtMC4zNSwgMC4zXSwgd20pOyBtaygwLCAnc3BoJywgeyBkaWFtZXRlcjogMC40IH0sIFswLCAtMC44NSwgMC40XSwgaXJvbik7IH1cbiAgICBpZiAoZC53ZWFwb24gPT09ICdheGUnKSB7IG1rKDAsICdjeWwnLCB7IGhlaWdodDogMC42LCBkaWFtZXRlcjogMC4wNSB9LCBbMCwgLTAuMiwgMC4xNV0sIHdtKTsgbWsoMCwgJ2JveCcsIHsgd2lkdGg6IDAuMzIsIGhlaWdodDogMC4yMiwgZGVwdGg6IDAuMDUgfSwgWzAsIC0wLjUsIDAuMTVdLCBpcm9uKTsgY29uc3QgaGFpciA9IEJBQllMT04uTWVzaEJ1aWxkZXIuQ3JlYXRlQ3lsaW5kZXIoJ2hhaXInLCB7IGhlaWdodDogMC4zLCBkaWFtZXRlclRvcDogMCwgZGlhbWV0ZXJCb3R0b206IGQuaGVhZCAqIDEuMiB9LCBzKTsgaGFpci5wYXJlbnQgPSB0aGlzLnJpZzsgaGFpci5wb3NpdGlvbi55ID0gaGVhZC5wb3NpdGlvbi55ICsgZC5oZWFkICogMC43NTsgaGFpci5tYXRlcmlhbCA9IG1hdCgnI2MyMmExYycpOyBoYWlyLmlzUGlja2FibGUgPSBmYWxzZTsgfVxuICAgIHRoaXMudG9wID0gbGVnSCArIGQuaCArIGQuaGVhZCAqIDEuMzU7IHRoaXMuZGVjbyA9IG5ldyBEZWNvKEEsIHRoaXMuaG9sZGVyLCB0aGlzLnRvcCwgZC53ICogMC43KTtcbiAgICBjb25zdCBsYmwgPSBkeW4ocywgMjU2LCA0OCwgKGMpID0+IHsgYy5mb250ID0gJ2JvbGQgMjZweCBzYW5zLXNlcmlmJzsgYy50ZXh0QWxpZ24gPSAnY2VudGVyJzsgYy5maWxsU3R5bGUgPSAnI2ZmZmZmZic7IGMuc3Ryb2tlU3R5bGUgPSAnIzExMSc7IGMubGluZVdpZHRoID0gNTsgYy5zdHJva2VUZXh0KGQubGFiZWwgKyAnIChzdGFuZC1pbiknLCAxMjgsIDM0KTsgYy5maWxsVGV4dChkLmxhYmVsICsgJyAoc3RhbmQtaW4pJywgMTI4LCAzNCk7IH0pO1xuICAgIGNvbnN0IGxwID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgnbGJsJywgeyB3aWR0aDogMS4xLCBoZWlnaHQ6IDAuMiB9LCBzKTsgbHAucGFyZW50ID0gdGhpcy5ob2xkZXI7IGxwLnBvc2l0aW9uLnkgPSAtMC4xOyBscC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDIgKiAwLjA7IGxwLmJpbGxib2FyZE1vZGUgPSBCQUJZTE9OLk1lc2guQklMTEJPQVJETU9ERV9BTEw7IGNvbnN0IGxtID0gbmV3IEJBQllMT04uU3RhbmRhcmRNYXRlcmlhbCgnbG0nLCBzKTsgbG0uZGlmZnVzZVRleHR1cmUgPSBsYmw7IGxtLmVtaXNzaXZlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5XaGl0ZSgpOyBsbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBsbS51c2VBbHBoYUZyb21EaWZmdXNlVGV4dHVyZSA9IHRydWU7IGxwLm1hdGVyaWFsID0gbG07IGxwLmlzUGlja2FibGUgPSBmYWxzZTsgbHAucG9zaXRpb24ueSA9IHRoaXMudG9wICsgMC42MjtcbiAgICB0aGlzLnBpY2sgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdwaWNrJywgeyBoZWlnaHQ6IHRoaXMudG9wLCBkaWFtZXRlcjogTWF0aC5tYXgoMC43LCBkLncgKiAxLjMpIH0sIHMpOyB0aGlzLnBpY2sucGFyZW50ID0gdGhpcy5ob2xkZXI7IHRoaXMucGljay5wb3NpdGlvbi55ID0gdGhpcy50b3AgLyAyOyB0aGlzLnBpY2sudmlzaWJpbGl0eSA9IDAuMDAxOyB0aGlzLnBpY2subWV0YWRhdGEgPSB7IGtpbmQ6ICd1bml0JywgdmlzdWFsOiB0aGlzIH07XG4gICAgKHRoaXMgYXMgYW55KS5wYXJ0cyA9IFtscF07IHRoaXMuc2V0VGVhbSh0ZWFtKTsgdGhpcy5zZXRTdGFyKHN0YXIpOyB0aGlzLnBsYXkoJ2lkbGUnKTtcbiAgfVxuICBzZXRUZWFtKHQ6IDAgfCAxKSB7IHRoaXMudGVhbSA9IHQ7ICh0aGlzIGFzIGFueSkuZXllTS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjI1LCAxKSA6IG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjY2LCAwLjE5KTsgdGhpcy5kZWNvLnNldCh0LCB0aGlzLnN0YXIpOyB9XG4gIHNldFN0YXIoc3Q6IG51bWJlcikgeyB0aGlzLnN0YXIgPSBzdDsgdGhpcy5iYXNlID0gQkFMQU5DRS5zdGFyLnNjYWxlW3N0IC0gMV07IGNvbnN0IHQgPSBUSU5UW3N0IC0gMV07IHRoaXMuYm9keS5tYXRlcmlhbC5kaWZmdXNlQ29sb3IgPSBCQUJZTE9OLkNvbG9yMy5Gcm9tSGV4U3RyaW5nKFBIW3RoaXMuc291bF0uY29sKS5zY2FsZSgwLjcyKS5tdWx0aXBseShuZXcgQkFCWUxPTi5Db2xvcjMoTWF0aC5taW4oMSwgdFswXSksIE1hdGgubWluKDEsIHRbMV0pLCBNYXRoLm1pbigxLCB0WzJdKSkpOyB0aGlzLmhvbGRlci5zY2FsaW5nLnNldEFsbCh0aGlzLmJhc2UpOyB0aGlzLmRlY28uc2V0KHRoaXMudGVhbSwgc3QpOyB0aGlzLmRlY28uZml0KHRoaXMuYmFzZSk7IH1cbiAgc2V0SHAoZjogbnVtYmVyIHwgbnVsbCkgeyB0aGlzLmRlY28uc2V0SHAoZik7IH1cbiAgc2V0TGV2ZWwobjogbnVtYmVyKSB7IHRoaXMuZGVjby5zZXRMZXZlbChuKTsgfVxuICBzZXRNYW5hKGY6IG51bWJlciB8IG51bGwpIHsgdGhpcy5kZWNvLnNldE1hbmEoZik7IH1cbiAgcHVsc2UoKSB7IHRoaXMucHVsc2VUID0gMC4xNjsgfVxuICBwbGF5KHN0YXRlOiBWU3RhdGUsIHNwZWVkID0gMSkgeyBpZiAoc3RhdGUgPT09IHRoaXMuc3RhdGUgJiYgKHN0YXRlID09PSAnaWRsZScgfHwgc3RhdGUgPT09ICdydW4nKSkgcmV0dXJuOyB0aGlzLnN0YXRlID0gc3RhdGU7IHRoaXMuc3QwID0gdGhpcy50OyB0aGlzLmR1ciA9IHN0YXRlID09PSAnYXR0YWNrJyA/IChCQUxBTkNFLnN0YXRzW3RoaXMuc291bCBhcyBTb3VsSWRdLmFuaW1MZW4gLyBzcGVlZCkgOiBzdGF0ZSA9PT0gJ2RlYXRoJyA/IDAuNiA6IHN0YXRlID09PSAnc3Bhd24nID8gMC45IDogMS4wOyB0aGlzLmRlY28uc2V0QXVyYShzdGF0ZSAhPT0gJ2RlYXRoJyk7IH1cbiAgdXBkYXRlKGR0OiBudW1iZXIpIHtcbiAgICB0aGlzLnQgKz0gZHQ7IHRoaXMuZGVjby51cGRhdGUoZHQpOyBjb25zdCBwID0gTWF0aC5taW4oMSwgKHRoaXMudCAtIHRoaXMuc3QwKSAvIHRoaXMuZHVyKSwgUiA9IHRoaXMucmlnLCBXID0gdGhpcy53cDtcbiAgICBSLnBvc2l0aW9uLnNldCgwLCAwLCAwKTsgUi5yb3RhdGlvbi5zZXQoMCwgMCwgMCk7IFIuc2NhbGluZy5zZXRBbGwoMSk7IFcucm90YXRpb24ueCA9IC0wLjQ7IHRoaXMubGVncy5mb3JFYWNoKChsKSA9PiAobC5yb3RhdGlvbi54ID0gMCkpO1xuICAgIGlmICh0aGlzLnN0YXRlID09PSAnaWRsZScpIFIucG9zaXRpb24ueSA9IE1hdGguc2luKHRoaXMudCAqIDIuMikgKiAwLjAxMjtcbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAncnVuJykgeyBjb25zdCB3ID0gdGhpcy50ICogMTA7IFIucG9zaXRpb24ueSA9IE1hdGguYWJzKE1hdGguc2luKHcpKSAqIDAuMDc7IFIucm90YXRpb24ueCA9IDAuMjsgdGhpcy5sZWdzWzBdLnJvdGF0aW9uLnggPSBNYXRoLnNpbih3KSAqIDAuOTsgdGhpcy5sZWdzWzFdLnJvdGF0aW9uLnggPSAtTWF0aC5zaW4odykgKiAwLjk7IFcucm90YXRpb24ueCA9IC0wLjQgKyBNYXRoLnNpbih3KSAqIDAuNDsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdhdHRhY2snKSB7IGNvbnN0IGsgPSBwIDwgMC40ID8gLTIuNCAqIChwIC8gMC40KSA6IC0yLjQgKyAzLjQgKiBNYXRoLm1pbigxLCAocCAtIDAuNCkgLyAwLjI1KTsgVy5yb3RhdGlvbi54ID0gazsgUi5wb3NpdGlvbi56ID0gMC4xNCAqIE1hdGguc2luKE1hdGguUEkgKiBwKTsgUi5yb3RhdGlvbi54ID0gMC4xNSAqIE1hdGguc2luKE1hdGguUEkgKiBwKTsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdzcGF3bicpIHsgY29uc3QgZSA9IHAgKiBwICogKDMgLSAyICogcCk7IFIuc2NhbGluZy5zZXRBbGwoMC4wMSArIDAuOTkgKiBlKTsgUi5wb3NpdGlvbi55ID0gKGUgLSAxKSAqIDAuNDsgfVxuICAgIGVsc2UgaWYgKHRoaXMuc3RhdGUgPT09ICdkZWF0aCcpIHsgY29uc3QgZSA9IHAgKiBwOyBSLnJvdGF0aW9uLnggPSAtTWF0aC5QSSAvIDIgKiBlOyBSLnBvc2l0aW9uLnkgPSAwLjI1ICogZTsgUi5wb3NpdGlvbi56ID0gLTAuMiAqIGU7IH1cbiAgICBlbHNlIGlmICh0aGlzLnN0YXRlID09PSAnY2hlZXInKSB7IFIucG9zaXRpb24ueSA9IE1hdGguYWJzKE1hdGguc2luKHRoaXMudCAqIDcpKSAqIDAuMTU7IFcucm90YXRpb24ueCA9IC0yLjY7IH1cbiAgICBpZiAodGhpcy5wdWxzZVQgPiAwKSB7IHRoaXMucHVsc2VUIC09IGR0OyBjb25zdCBrID0gMSArIDAuMDkgKiBNYXRoLnNpbihNYXRoLm1heCgwLCB0aGlzLnB1bHNlVCkgLyAwLjE2ICogTWF0aC5QSSk7IHRoaXMuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRoaXMuYmFzZSAqIGspOyB9XG4gIH1cbiAgZGlzcG9zZSgpIHsgdGhpcy5kZWNvLmRpc3Bvc2UoKTsgdGhpcy5ob2xkZXIuZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IG0uZGlzcG9zZSgpKTsgdGhpcy5ob2xkZXIuZGlzcG9zZSgpOyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVWaXN1YWwoQTogQXNzZXRzLCBzb3VsOiBTb3VsSWQsIHRlYW06IDAgfCAxLCBzdGFyOiBudW1iZXIpOiBVbml0VmlzdWFsIHtcbiAgY29uc3QgY2ZnID0gQS50cmlwb1tzb3VsXTtcbiAgcmV0dXJuIGNmZyA/IG5ldyBUcmlwb1Zpc3VhbChBLCBjZmcsIHNvdWwsIHRlYW0sIHN0YXIpIDogbmV3IFBsYWNlaG9sZGVyVmlzdWFsKEEsIHNvdWwsIHRlYW0sIHN0YXIpO1xufVxuZXhwb3J0IGNvbnN0IGlzVHJpcG8gPSAoQTogQXNzZXRzLCBzb3VsOiBTb3VsSWQpID0+ICEhQS50cmlwb1tzb3VsXTtcbiIsICIvLyBUaGUgZ2FtZSdzIGljb24gc2V0IChjdXN0b20gYXJ0LCBzbGljZWQgZnJvbSBQaXBlbGluZS9pY29ucy9zaGVldF8qLnBuZyBieSBQaXBlbGluZS9ibGVuZGVyL3NsaWNlX2ljb25zLnB5IC0+IGRvY3MvYXNzZXRzL2ljb25zLyoucG5nKS5cbi8vIFNoYXJlZCBieSB0aGUgM0QgZ2FtZSdzIERPTSAodmFuaWxsYSkgYW5kIHRoZSBBbmd1bGFyIHNoZWxsLiBObyBlbW9qaSBhbnl3aGVyZTogZXZlcnkgZ2x5cGggaW4gdGhlIFVJIGlzIG9uZSBvZiB0aGVzZSBpbWFnZXMuXG5pbXBvcnQgdHlwZSB7IFNvdWxJZCB9IGZyb20gJy4uL2NvcmUvZGF0YS50cyc7XG5pbXBvcnQgdHlwZSB7IFJhcml0eSB9IGZyb20gJy4uL2NvcmUvcGFja3MudHMnO1xuXG5leHBvcnQgdHlwZSBJY29uTmFtZSA9XG4gIHwgJ2hvbWUnIHwgJ3NvdWxzJyB8ICdzaG9wJyB8ICdzZXR0aW5ncycgfCAnY2xvc2UnXG4gIHwgJ2hlYXJ0JyB8ICdoZWFydF9lbXB0eScgfCAnZG9taW5pb24nIHwgJ3N0YXInIHwgJ2xvY2snXG4gIHwgJ3dhcnJpb3InIHwgJ2FyY2hlcicgfCAnZ29ibGluJyB8ICdrbmlnaHQnIHwgJ29ncmUnIHwgJ2JhcmJhcmlhbidcbiAgfCAnZ2VtX2NvbW1vbicgfCAnZ2VtX3JhcmUnIHwgJ2dlbV9lcGljJyB8ICdnZW1fbGVnZW5kYXJ5J1xuICB8ICdtdXNpYycgfCAnc291bmRfb24nIHwgJ3NvdW5kX29mZicgfCAndXBncmFkZScgfCAnc3dhcCdcbiAgfCAnbWVyZ2UnIHwgJ3JlbW92ZScgfCAnY2hlY2snIHwgJ2JhY2snIHwgJ2luZm8nIHwgJ2dvbGQnO1xuXG4vKiogUmVsYXRpdmUgdG8gdGhlIHBhZ2UsIHNvIGl0IHdvcmtzIG9uIEdpdEh1YiBQYWdlcyB1bmRlciAvcmVwby1uYW1lLy4gKi9cbmV4cG9ydCBjb25zdCBpY29uVXJsID0gKG46IEljb25OYW1lKTogc3RyaW5nID0+ICdhc3NldHMvaWNvbnMvJyArIG4gKyAnLnBuZyc7XG4vKiogQW4gPGltZz4gYXMgYW4gSFRNTCBzdHJpbmcsIGZvciB0aGUgZ2FtZSdzIGhhbmQtYnVpbHQgRE9NLiAqL1xuZXhwb3J0IGNvbnN0IGljb25JbWcgPSAobjogSWNvbk5hbWUsIGNscyA9ICdpYycpOiBzdHJpbmcgPT4gYDxpbWcgY2xhc3M9XCIke2Nsc31cIiBzcmM9XCIke2ljb25Vcmwobil9XCIgYWx0PVwiXCIgZHJhZ2dhYmxlPVwiZmFsc2VcIj5gO1xuXG4vKiogRWFjaCBTb3VsIGlzIHNob3duIGJ5IGl0cyB3ZWFwb24vcm9sZSBpY29uIHVudGlsIHJlYWwgcG9ydHJhaXRzIGV4aXN0LiAqL1xuZXhwb3J0IGNvbnN0IFNPVUxfSUNPTjogUmVjb3JkPFNvdWxJZCwgSWNvbk5hbWU+ID0geyB3YXJyaW9yOiAnd2FycmlvcicsIGFyY2hlcjogJ2FyY2hlcicsIGdvYmxpbjogJ2dvYmxpbicsIGtuaWdodDogJ2tuaWdodCcsIG9ncmU6ICdvZ3JlJywgYmFyYmFyaWFuOiAnYmFyYmFyaWFuJyB9O1xuZXhwb3J0IGNvbnN0IFJBUklUWV9HRU06IFJlY29yZDxSYXJpdHksIEljb25OYW1lPiA9IHsgY29tbW9uOiAnZ2VtX2NvbW1vbicsIHJhcmU6ICdnZW1fcmFyZScsIGVwaWM6ICdnZW1fZXBpYycsIGxlZ2VuZGFyeTogJ2dlbV9sZWdlbmRhcnknIH07XG5cbi8qKiBQYWNrIHRpZXJzIGFyZSBzaG93biBhcyBza3VsbHMgKG5ldmVyIHN0YXJzOiBzdGFycyBtZWFuIGFuIGluLXJ1biBtZXJnZSBsZXZlbCkuICovXG5leHBvcnQgY29uc3Qgc2t1bGxJbWdzID0gKG46IG51bWJlciwgY2xzID0gJ3NrJyk6IHN0cmluZyA9PiBpY29uSW1nKCdzb3VscycsIGNscykucmVwZWF0KE1hdGgubWF4KDEsIG4pKTtcbmV4cG9ydCBjb25zdCBoZWFydHNIdG1sID0gKGhlYXJ0czogbnVtYmVyLCBtYXggPSAzKTogc3RyaW5nID0+IGljb25JbWcoJ2hlYXJ0JywgJ2ljIGhlYXJ0JykucmVwZWF0KE1hdGgubWF4KDAsIGhlYXJ0cykpICsgaWNvbkltZygnaGVhcnRfZW1wdHknLCAnaWMgaGVhcnQnKS5yZXBlYXQoTWF0aC5tYXgoMCwgbWF4IC0gaGVhcnRzKSk7XG4vKiogQSBudW1iZXIgd2l0aCB0aG91c2FuZHMgc2VwYXJhdG9ycyAoZ29sZCBnZXRzIGJpZyk6IDEyNTAwIC0+IFwiMTIsNTAwXCIuICovXG5leHBvcnQgY29uc3QgZm10ID0gKG46IG51bWJlcik6IHN0cmluZyA9PiBNYXRoLnJvdW5kKG4pLnRvTG9jYWxlU3RyaW5nKCdlbi1VUycpO1xuIiwgIi8vIFJlbmRlcmVkIFNvdWwgcG9ydHJhaXRzIChQaXBlbGluZS9ibGVuZGVyL3JlbmRlcl9wb3J0cmFpdC5weSwgaGVhZC1hbmQtc2hvdWxkZXJzIG1vZGUpLCBzaGFyZWQgYnkgdGhlIEFuZ3VsYXIgcGFnZXMgYW5kIHRoZSBiYXR0bGUgc2NyZWVuLlxuLy8gU291bHMgd2l0aG91dCBhIHBvcnRyYWl0IHlldCBmYWxsIGJhY2sgdG8gdGhlaXIgcm9sZSBpY29uIG9uIGEgY29sb3VyZWQgY2FyZC5cbmltcG9ydCB0eXBlIHsgU291bElkIH0gZnJvbSAnLi4vY29yZS9kYXRhLnRzJztcbmltcG9ydCB7IFJBUklUWV9PRiB9IGZyb20gJy4uL2NvcmUvcGFja3MudHMnO1xuaW1wb3J0IHR5cGUgeyBSYXJpdHkgfSBmcm9tICcuLi9jb3JlL3BhY2tzLnRzJztcbmltcG9ydCB7IFNPVUxfSUNPTiwgaWNvblVybCB9IGZyb20gJy4vaWNvbnMudHMnO1xuXG5jb25zdCBQT1JUUkFJVDogUGFydGlhbDxSZWNvcmQ8U291bElkLCBzdHJpbmc+PiA9IHsgd2FycmlvcjogJ2Fzc2V0cy9wb3J0cmFpdHMvd2Fycmlvcl9oZWFkLnBuZycsIGFyY2hlcjogJ2Fzc2V0cy9wb3J0cmFpdHMvYXJjaGVyX2hlYWQucG5nJywgb2dyZTogJ2Fzc2V0cy9wb3J0cmFpdHMvb2dyZV9oZWFkLnBuZycsIGdvYmxpbjogJ2Fzc2V0cy9wb3J0cmFpdHMvZ29ibGluX2hlYWQucG5nJywga25pZ2h0OiAnYXNzZXRzL3BvcnRyYWl0cy9rbmlnaHRfaGVhZC5wbmcnLCBiYXJiYXJpYW46ICdhc3NldHMvcG9ydHJhaXRzL2JhcmJhcmlhbl9oZWFkLnBuZycgfTtcbmNvbnN0IFJBUklUWV9IRVg6IFJlY29yZDxSYXJpdHksIHN0cmluZz4gPSB7IGNvbW1vbjogJyNiOGMwY2MnLCByYXJlOiAnIzRhYTNmZicsIGVwaWM6ICcjYjI2YmZmJywgbGVnZW5kYXJ5OiAnI2ZmY2MzMycgfTtcbmV4cG9ydCBjb25zdCBoYXNBcnQgPSAoczogU291bElkKTogYm9vbGVhbiA9PiAhIVBPUlRSQUlUW3NdO1xuZXhwb3J0IGNvbnN0IHNvdWxBcnQgPSAoczogU291bElkKTogc3RyaW5nID0+IFBPUlRSQUlUW3NdID8/IGljb25VcmwoU09VTF9JQ09OW3NdKTtcbmV4cG9ydCBjb25zdCByYXJpdHlDb2xvciA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4gUkFSSVRZX0hFWFtSQVJJVFlfT0Zbc11dO1xuLyoqIENhcmQgYmFja2Ryb3AgZm9yIGEgcG9ydHJhaXQ6IGEgZ2xvdyBpbiB0aGUgcmFyaXR5IGNvbG91ciBiZWhpbmQgdGhlIGZpZ3VyZSwgb24gYSBkYXJrIGNyeXB0IGdyYWRpZW50LiAqL1xuZXhwb3J0IGNvbnN0IGFydEJnID0gKHM6IFNvdWxJZCk6IHN0cmluZyA9PiB7IGNvbnN0IGMgPSByYXJpdHlDb2xvcihzKTsgcmV0dXJuIGByYWRpYWwtZ3JhZGllbnQoZWxsaXBzZSBhdCA1MCUgODAlLCAke2N9NzcgMCUsICR7Y30yNiA0NiUsIHRyYW5zcGFyZW50IDc0JSksIGxpbmVhci1ncmFkaWVudCgjMmIyNDQ0LCMwZDA5MTkpYDsgfTtcbiIsICIvLyBET00gdXNlciBpbnRlcmZhY2U6IHRvcCBiYXIsIGVuZW15IHByZXZpZXcsIGhhbmQgb2YgY2FyZHMsIGJ1dHRvbnMsIGRyYWZ0IG92ZXJsYXksIHRvYXN0cyBhbmQgdGhlIGRlYnVnIHBhbmVsLlxuaW1wb3J0IHsgQkFMQU5DRSwgUk9MRV9URVhULCBTT1VMX05BTUUgfSBmcm9tICcuLi9jb3JlL2JhbGFuY2UudHMnO1xuaW1wb3J0IHsgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHsgaXNFbmRsZXNzIH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBjYW5NZXJnZURlcGxveWVkLCBjYW5NZXJnZUZyb21IYW5kLCBjYW5TdW1tb24sIGNvc3QsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBzdGFnZVdhdmVzIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBlbmVteVdhdmUsIHByZXZpZXdUZXh0IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBhdWRpbyB9IGZyb20gJy4vYXVkaW8udHMnO1xuaW1wb3J0IHsgYXJ0QmcsIGhhc0FydCwgcmFyaXR5Q29sb3IsIHNvdWxBcnQgfSBmcm9tICcuLi91aS9wb3J0cmFpdHMudHMnO1xuaW1wb3J0IHsgU09VTF9JQ09OLCBoZWFydHNIdG1sLCBmbXQsIGljb25JbWcsIGljb25VcmwsIHNrdWxsSW1ncyB9IGZyb20gJy4uL3VpL2ljb25zLnRzJztcbmltcG9ydCB7IGRlc2NyaWJlVW5sb2NrIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5cbmNvbnN0IHBvcnRyYWl0SHRtbCA9IChzOiBTb3VsSWQpOiBzdHJpbmcgPT4gYDxkaXYgY2xhc3M9XCJwdFwiIHN0eWxlPVwiYmFja2dyb3VuZDoke2FydEJnKHMpfVwiPjxpbWcgc3JjPVwiJHtzb3VsQXJ0KHMpfVwiIGFsdD1cIlwiIGRyYWdnYWJsZT1cImZhbHNlXCI+PC9kaXY+YDtcbmNvbnN0IElDT04gPSBPYmplY3QuZnJvbUVudHJpZXMoU09VTFMubWFwKChzKSA9PiBbcywgaWNvbkltZyhTT1VMX0lDT05bc10sICdpYycpXSkpIGFzIFJlY29yZDxTb3VsSWQsIHN0cmluZz47XG5jb25zdCAkID0gKGlkOiBzdHJpbmcpID0+IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKSE7XG5jb25zdCBzdGFycyA9IChuOiBudW1iZXIpID0+ICdcdTI2MDUnLnJlcGVhdChuKTtcblxuZXhwb3J0IGNsYXNzIFVpIHtcbiAgcHJpdmF0ZSB0b2FzdFQgPSAwOyBwcml2YXRlIGRiZzogSFRNTEVsZW1lbnQ7IHByaXZhdGUgb2RkcyA9ICcnO1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIGc6IGFueSkge1xuICAgICQoJ2J0bkhvbWUnKS5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1ob21lJykpO1xuICAgICQoJ2J0bkJhdHRsZScpLm9uY2xpY2sgPSAoKSA9PiBnLnN0YXJ0QmF0dGxlKCk7ICQoJ2J0blN3YXAnKS5vbmNsaWNrID0gKCkgPT4gZy50b2dnbGVTd2FwKCk7XG4gICAgJCgnYnRuUmVtb3ZlJykub25jbGljayA9ICgpID0+IGcucmVtb3ZlU2VsZWN0ZWQoKTtcbiAgICAkKCdidG5TcGVlZCcpLm9uY2xpY2sgPSAoKSA9PiBnLnNldFNwZWVkKGcudGltZVNjYWxlID4gMSA/IDEgOiAyKTtcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtY2FtXScpLmZvckVhY2goKGIpID0+IChiLm9uY2xpY2sgPSAoKSA9PiBnLnNldENhbU1vZGUoYi5kYXRhc2V0LmNhbSEpKSk7XG4gICAgJCgnZ2VhcicpLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuZGJnLmNsYXNzTGlzdC50b2dnbGUoJ29wZW4nKTsgdGhpcy5yZW5kZXJEZWJ1ZygpOyB9O1xuICAgIGNvbnN0IHNuZCA9ICgpID0+IHsgJCgnYnRuTXVzaWMnKS5jbGFzc0xpc3QudG9nZ2xlKCdvZmYnLCAhYXVkaW8ubXVzaWMpOyAkKCdidG5TZngnKS5jbGFzc0xpc3QudG9nZ2xlKCdvZmYnLCAhYXVkaW8uc2Z4KTsgY29uc3Qgc2kgPSAkKCdidG5TZngnKS5xdWVyeVNlbGVjdG9yKCdpbWcnKTsgaWYgKHNpKSBzaS5zcmMgPSBpY29uVXJsKGF1ZGlvLnNmeCA/ICdzb3VuZF9vbicgOiAnc291bmRfb2ZmJyk7IH07XG4gICAgJCgnYnRuTXVzaWMnKS5vbmNsaWNrID0gKCkgPT4geyBhdWRpby5zZXRNdXNpYyghYXVkaW8ubXVzaWMpOyBzbmQoKTsgfTsgJCgnYnRuU2Z4Jykub25jbGljayA9ICgpID0+IHsgYXVkaW8uc2V0U2Z4KCFhdWRpby5zZngpOyBzbmQoKTsgfTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbmVjcm8tc2V0dGluZ3MnLCBzbmQpOyBzbmQoKTtcbiAgICB0aGlzLmRiZyA9ICQoJ2RlYnVnJyk7IGlmIChuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCkuZ2V0KCdkZWJ1ZycpKSB0aGlzLmRiZy5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gICAgdGhpcy5yZW5kZXJEZWJ1ZygpO1xuICB9XG5cbiAgLyoqIFRoZSBOZWNyb21hbmNlciBqdXN0IGxvc3QgYSBoZWFydDogbWFrZSB0aGUgaGVhcnRzIGJ1bXAuICovXG4gIHB1bHNlSGVhcnRzKCkgeyBjb25zdCBoID0gJCgnaGVhcnRzJyk7IGguY2xhc3NMaXN0LnJlbW92ZSgnaHVydCcpOyB2b2lkIGgub2Zmc2V0V2lkdGg7IGguY2xhc3NMaXN0LmFkZCgnaHVydCcpOyB9XG4gIHRvYXN0KG1zZzogc3RyaW5nKSB7IGNvbnN0IHQgPSAkKCd0b2FzdCcpOyB0LnRleHRDb250ZW50ID0gbXNnOyB0LmNsYXNzTGlzdC5hZGQoJ3Nob3cnKTsgY2xlYXJUaW1lb3V0KHRoaXMudG9hc3RUKTsgdGhpcy50b2FzdFQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0LmNsYXNzTGlzdC5yZW1vdmUoJ3Nob3cnKSwgMzYwMCk7IH1cblxuICByZW5kZXIoKSB7XG4gICAgY29uc3QgZyA9IHRoaXMuZywgcyA9IGcucywgcGggPSBnLnBoYXNlLCBidWlsZCA9IHBoID09PSAnYnVpbGQnO1xuICAgICQoJ2hlYXJ0cycpLmlubmVySFRNTCA9IGhlYXJ0c0h0bWwocy5oZWFydHMpO1xuICAgICQoJ3dhdmUnKS50ZXh0Q29udGVudCA9IGlzRW5kbGVzcygpID8gYFdhdmUgJHtzLndhdmV9YCA6IGBXYXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9YDtcbiAgICBjb25zdCB1c2VkID0gZG9taW5pb25Vc2VkKHMpOyAkKCdkb20nKS50ZXh0Q29udGVudCA9IGAke3VzZWR9LyR7cy5jYXB9YDsgKCQoJ2RvbWZpbGwnKSBhcyBIVE1MRWxlbWVudCkuc3R5bGUud2lkdGggPSBNYXRoLm1pbigxMDAsICh1c2VkIC8gcy5jYXApICogMTAwKSArICclJztcbiAgICAvLyBlbmVteSBwcmV2aWV3OiB3aGF0IGlzIGNvbWluZywgbmV2ZXIgd2hlcmVcbiAgICBjb25zdCBwdiA9IHByZXZpZXdUZXh0KGVuZW15V2F2ZShzLndhdmUsIGcuc2VlZCkpO1xuICAgICQoJ2VuZW15JykuaW5uZXJIVE1MID0gYDxiPk5leHQgZW5lbWllczwvYj5gICsgcHYubWFwKChwKSA9PiBgPGRpdiBjbGFzcz1cImVyb3dcIj48c3Bhbj4ke0lDT05bcC5zb3VsIGFzIFNvdWxJZF19PC9zcGFuPjxzcGFuPiR7U09VTF9OQU1FW3Auc291bCBhcyBTb3VsSWRdfSR7KHAgYXMgYW55KS5ib3NzID8gJyA8YiBzdHlsZT1cImNvbG9yOiNmZjdiNmFcIj5CT1NTPC9iPicgOiAnJ308L3NwYW4+PHNwYW4gY2xhc3M9XCJ4XCI+XHUwMEQ3JHtwLmNvdW50fTwvc3Bhbj48c3BhbiBjbGFzcz1cInN0XCI+JHtzdGFycyhwLnN0YXIpfTwvc3Bhbj48L2Rpdj5gKS5qb2luKCcnKSArIGA8ZGl2IGNsYXNzPVwiaGludFwiPlBvc2l0aW9ucyBzdGF5IGhpZGRlbiB1bnRpbCB0aGUgYmF0dGxlLjwvZGl2PmA7XG4gICAgLy8gaGFuZFxuICAgIGNvbnN0IGhhbmQgPSAkKCdoYW5kJyk7IGhhbmQuaW5uZXJIVE1MID0gJyc7XG4gICAgcy5oYW5kLmZvckVhY2goKHNvdWw6IFNvdWxJZCwgaTogbnVtYmVyKSA9PiB7XG4gICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpOyBjb25zdCBzZWwgPSBnLnNlbCAmJiBnLnNlbC50eXBlID09PSAnY2FyZCcgJiYgZy5zZWwuaWR4ID09PSBpOyBjb25zdCBhZmZvcmQgPSBjYW5TdW1tb24ocywgaSksIGNhbk1lcmdlID0gcy51bml0cy5zb21lKCh1OiBhbnkpID0+IGNhbk1lcmdlRnJvbUhhbmQocywgaSwgdS5pZCkpLCB1c2FibGUgPSBhZmZvcmQgfHwgY2FuTWVyZ2U7XG4gICAgICBjb25zdCBhcnQgPSBoYXNBcnQoc291bCk7IGVsLmNsYXNzTmFtZSA9ICdjYXJkJyArIChhcnQgPyAnIGFydCcgOiAnJykgKyAoc2VsID8gJyBzZWwnIDogJycpICsgKCF1c2FibGUgJiYgIWcuc3dhcE1vZGUgPyAnIGRpcycgOiAnJykgKyAoZy5zd2FwTW9kZSA/ICcgc3dhcCcgOiAnJyk7XG4gICAgICBjb25zdCB0YWcgPSBhZmZvcmQgPyBgPHNwYW4gY2xhc3M9XCJva1wiPlN1bW1vbjwvc3Bhbj5gIDogY2FuTWVyZ2UgPyAnPHNwYW4gY2xhc3M9XCJvayBtZ1wiPk1lcmdlIG9ubHk8L3NwYW4+JyA6ICc8c3BhbiBjbGFzcz1cIm5vXCI+Tm8gcm9vbTwvc3Bhbj4nO1xuICAgICAgaWYgKGFydCkgZWwuc3R5bGUuYm9yZGVyQ29sb3IgPSByYXJpdHlDb2xvcihzb3VsKTtcbiAgICAgIGVsLmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiY29zdFwiPiR7Y29zdChzb3VsLCAxKX08L2Rpdj4ke2FydCA/IHBvcnRyYWl0SHRtbChzb3VsKSA6IElDT05bc291bF0gKyBgPGRpdiBjbGFzcz1cIm5tXCI+JHtTT1VMX05BTUVbc291bF19PC9kaXY+YH08ZGl2IGNsYXNzPVwiY3NcIj4ke3RhZ308L2Rpdj5gOyBlbC50aXRsZSA9IFJPTEVfVEVYVFtzb3VsXSArIChhZmZvcmQgPyAnJyA6IGNhbk1lcmdlID8gJyAtIERvbWluaW9uIGlzIGZ1bGwsIGJ1dCB5b3UgY2FuIG1lcmdlIGl0IGludG8geW91ciBtYXRjaGluZyAxLXN0YXIgdW5pdC4nIDogJyAtIE5vdCBlbm91Z2ggZnJlZSBEb21pbmlvbiB0byBzdW1tb24gdGhpcy4nKTtcbiAgICAgIGVsLm9uY2xpY2sgPSAoKSA9PiBnLm9uQ2FyZChpKTsgaGFuZC5hcHBlbmRDaGlsZChlbCk7XG4gICAgfSk7XG4gICAgaWYgKCFzLmhhbmQubGVuZ3RoKSBoYW5kLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPVwiZW1wdHlcIj5ObyBjYXJkcyBpbiBoYW5kPC9kaXY+JztcbiAgICAvLyBidXR0b25zXG4gICAgKCQoJ2J0bkJhdHRsZScpIGFzIEhUTUxCdXR0b25FbGVtZW50KS5kaXNhYmxlZCA9ICFidWlsZCB8fCAhcy51bml0cy5sZW5ndGg7XG4gICAgY29uc3Qgc3cgPSAkKCdidG5Td2FwJykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQ7IHN3LmRpc2FibGVkID0gIWJ1aWxkIHx8IHMuZGlzY2FyZFVzZWQ7IHN3LmNsYXNzTGlzdC50b2dnbGUoJ29uJywgZy5zd2FwTW9kZSk7IHN3LnRleHRDb250ZW50ID0gcy5kaXNjYXJkVXNlZCA/ICdTd2FwIHVzZWQnIDogZy5zd2FwTW9kZSA/ICdTd2FwOiBwaWNrIGEgY2FyZCBvciB1bml0JyA6ICdTd2FwICgxL3JvdW5kKSc7XG4gICAgY29uc3Qgc2VsVSA9IGcuc2VsICYmIGcuc2VsLnR5cGUgPT09ICd1bml0JyA/IHMudW5pdHMuZmluZCgodTogYW55KSA9PiB1LmlkID09PSBnLnNlbC5pZCkgOiBudWxsO1xuICAgIGNvbnN0IHBhcnRuZXIgPSBzZWxVICYmIHMudW5pdHMuc29tZSgobzogYW55KSA9PiBjYW5NZXJnZURlcGxveWVkKHNlbFUsIG8pKTtcbiAgICAkKCd1bml0cGFuZWwnKS5zdHlsZS5kaXNwbGF5ID0gYnVpbGQgJiYgc2VsVSA/ICdmbGV4JyA6ICdub25lJztcbiAgICAkKCdidG5SZW1vdmUnKS50ZXh0Q29udGVudCA9IGcuY29uZmlybVJlbW92ZSA/ICdDb25maXJtIHJlbW92ZScgOiAnUmVtb3ZlJztcbiAgICAkKCdpbmZvJykudGV4dENvbnRlbnQgPSBidWlsZCA/IChnLnN3YXBNb2RlID8gJ1NXQVA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkIGl0LCBvciB0YXAgYSB1bml0IHlvdSBkaWQgbm90IHN1bW1vbiB0aGlzIHJvdW5kIHRvIHNlbGwgaXQuIFlvdSBkcmF3IGEgZGlmZmVyZW50IFNvdWwuJ1xuICAgICAgOiBzZWxVID8gYCR7U09VTF9OQU1FW3NlbFUuc291bCBhcyBTb3VsSWRdfSAke3N0YXJzKHNlbFUuc3Rhcil9ICBcdTIwMjIgICR7Uk9MRV9URVhUW3NlbFUuc291bCBhcyBTb3VsSWRdfSAgJHtwYXJ0bmVyID8gJ1x1MjAyMiBUYXAgdGhlIG1hdGNoaW5nIHVuaXQgdG8gbWVyZ2UgaW50byBhIHN0cm9uZ2VyIHN0YXIuJyA6ICcnfWBcbiAgICAgIDogZy5zZWwgJiYgZy5zZWwudHlwZSA9PT0gJ2NhcmQnID8gYCR7U09VTF9OQU1FW3MuaGFuZFtnLnNlbC5pZHhdIGFzIFNvdWxJZF19OiAke1JPTEVfVEVYVFtzLmhhbmRbZy5zZWwuaWR4XSBhcyBTb3VsSWRdfSAgXHUyMDIyICBgICsgKCgpID0+IHsgY29uc3QgaSA9IGcuc2VsLmlkeCwgc20gPSBjYW5TdW1tb24ocywgaSksIG1nID0gcy51bml0cy5zb21lKCh1OiBhbnkpID0+IGNhbk1lcmdlRnJvbUhhbmQocywgaSwgdS5pZCkpOyByZXR1cm4gc20gJiYgbWcgPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24sIG9yIGEgZ2xvd2luZyBwdXJwbGUgdW5pdCB0byBtZXJnZSBpdCBpbi4nIDogc20gPyAnVGFwIGEgZ3JlZW4gdGlsZSB0byBzdW1tb24uJyA6IG1nID8gJ0RvbWluaW9uIGlzIGZ1bGw6IHRhcCBhIGdsb3dpbmcgcHVycGxlIHVuaXQgdG8gbWVyZ2UgaXQgaW4uJyA6ICdOb3QgZW5vdWdoIGZyZWUgRG9taW5pb24gdG8gc3VtbW9uIHRoaXMuJzsgfSkoKSA6ICdUYXAgYSBjYXJkLCB0aGVuIGEgdGlsZS4gVGFwIGEgdW5pdCB0byBtZXJnZSwgbW92ZSBvciByZW1vdmUgaXQuJylcbiAgICAgIDogcGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnQmF0dGxlISBVbml0cyBmaWdodCBvbiB0aGVpciBvd24uJyA6ICcnO1xuICAgICQoJ3NwZWVkJykuc3R5bGUuZGlzcGxheSA9IHBoID09PSAnYmF0dGxlJyB8fCBwaCA9PT0gJ3RyYW5zaXRpb24nID8gJ2ZsZXgnIDogJ25vbmUnO1xuICAgIGNvbnN0IGZhc3QgPSBnLnNwZWVkVW5sb2NrZWQoKTsgaWYgKCFmYXN0ICYmIGcudGltZVNjYWxlID4gMSkgZy50aW1lU2NhbGUgPSAxO1xuICAgIGNvbnN0IHNiID0gJCgnYnRuU3BlZWQnKTsgc2Iuc3R5bGUuZGlzcGxheSA9IGZhc3QgPyAnJyA6ICdub25lJzsgc2IudGV4dENvbnRlbnQgPSBnLnRpbWVTY2FsZSArICd4Jzsgc2IuY2xhc3NMaXN0LnRvZ2dsZSgnb24nLCBnLnRpbWVTY2FsZSA+IDEpO1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCdbZGF0YS1jYW1dJykuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsIGIuZGF0YXNldC5jYW0gPT09IGcuY2FtTW9kZSkpO1xuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnRvZ2dsZSgnaW5iYXR0bGUnLCBwaCA9PT0gJ2JhdHRsZScgfHwgcGggPT09ICd0cmFuc2l0aW9uJyk7IGF1ZGlvLnNldE1vZGUocGggPT09ICdiYXR0bGUnIHx8IHBoID09PSAndHJhbnNpdGlvbicgPyAnYmF0dGxlJyA6ICdidWlsZCcpO1xuICAgIC8vIG92ZXJsYXlcbiAgICBjb25zdCBvdiA9ICQoJ292ZXJsYXknKTsgb3YuY2xhc3NOYW1lID0gJyc7IG92LmlubmVySFRNTCA9ICcnO1xuICAgIGlmIChwaCA9PT0gJ2RyYWZ0JyAmJiBnLmRyYWZ0KSB7XG4gICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPlZpY3RvcnkgRHJhZnQ8L2gyPjxkaXYgY2xhc3M9XCJzdWJcIj5XYXZlIGNsZWFyZWQuIERvbWluaW9uIGlzIG5vdyAke3MuY2FwfS4ke2cubGFzdEdvbGQgPyBgIDxiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YVwiPiske2ZtdChnLmxhc3RHb2xkKX08L2I+ICR7aWNvbkltZygnZ29sZCcpfWAgOiAnJ30gS2VlcCBvbmU6PC9kaXY+PGRpdiBjbGFzcz1cInJvd1wiPiR7Zy5kcmFmdC5tYXAoKHNvdWw6IFNvdWxJZCwgaTogbnVtYmVyKSA9PiBgPGRpdiBjbGFzcz1cImNhcmQgYmlnJHtoYXNBcnQoc291bCkgPyAnIGFydCcgOiAnJ31cIiBkYXRhLWk9XCIke2l9XCIke2hhc0FydChzb3VsKSA/IGAgc3R5bGU9XCJib3JkZXItY29sb3I6JHtyYXJpdHlDb2xvcihzb3VsKX1cImAgOiAnJ30+PGRpdiBjbGFzcz1cImNvc3RcIj4ke2Nvc3Qoc291bCwgMSl9PC9kaXY+JHtoYXNBcnQoc291bCkgPyBwb3J0cmFpdEh0bWwoc291bCkgOiBJQ09OW3NvdWxdfTxkaXYgY2xhc3M9XCJubVwiPiR7U09VTF9OQU1FW3NvdWxdfTwvZGl2PjxkaXYgY2xhc3M9XCJyb2xlXCI+JHtST0xFX1RFWFRbc291bF19PC9kaXY+PC9kaXY+YCkuam9pbignJyl9PC9kaXY+PC9kaXY+YDtcbiAgICAgIG92LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCcuY2FyZCcpLmZvckVhY2goKGMpID0+IChjLm9uY2xpY2sgPSAoKSA9PiBnLnBpY2tEcmFmdCgrYy5kYXRhc2V0LmkhKSkpO1xuICAgIH0gZWxzZSBpZiAocGggPT09ICd3b24nIHx8IHBoID09PSAnbG9zdCcpIHtcbiAgICAgIGNvbnN0IHJ3ID0gcGggPT09ICd3b24nID8gZy5yZXdhcmQgOiBudWxsLCBzayA9IChuOiBudW1iZXIpID0+IHNrdWxsSW1ncyhuKTtcbiAgICAgIGNvbnN0IHVubG9ja0h0bWwgPSBydyAmJiBydy51bmxvY2tlZCAmJiBydy51bmxvY2tlZC5sZW5ndGggPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6IzdlZjJjODtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ2NoZWNrJyl9IFVubG9ja2VkOiAke3J3LnVubG9ja2VkLm1hcCgoazogc3RyaW5nKSA9PiBkZXNjcmliZVVubG9jayhrKSkuam9pbignIFxcdTAwYjcgJyl9PC9kaXY+YCA6ICcnO1xuICAgICAgY29uc3QgZ29sZEh0bWwgPSBnLnJ1bkdvbGQgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ2dvbGQnKX0gR29sZCBlYXJuZWQgdGhpcyBydW46ICR7Zm10KGcucnVuR29sZCl9PC9kaXY+YCA6ICcnO1xuICAgICAgY29uc3QgZHIgPSBwaCA9PT0gJ3dvbicgJiYgZy5kYWlseSA/IGcuZGFpbHlSZXdhcmQgOiBudWxsO1xuICAgICAgY29uc3QgZGFpbHlIdG1sID0gZy5kYWlseSA/IChkciA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7ZHIucGFjayA/IGAke2ljb25JbWcoJ3Nob3AnKX0gRGFpbHkgY29tcGxldGUhIFlvdSBlYXJuZWQgYSAke3NrKDEpfSBTb3VsIFBhY2sgYW5kICR7Zm10KGRyLmdvbGQpfSAke2ljb25JbWcoJ2dvbGQnKX0uYCA6ICdEYWlseSBjb21wbGV0ZSBhZ2Fpbi4gVGhlIHJld2FyZCBjb21lcyBvbmNlIHBlciBkYXk6IHNlZSB5b3UgdG9tb3Jyb3chJ308L2Rpdj5gIDogJycpIDogJyc7XG4gICAgICBjb25zdCByZXdhcmRIdG1sID0gZ29sZEh0bWwgKyBkYWlseUh0bWwgKyB1bmxvY2tIdG1sICsgKHJ3ID8gYDxkaXYgY2xhc3M9XCJzdWJcIiBzdHlsZT1cImNvbG9yOiNmZmQyNGE7Zm9udC13ZWlnaHQ6NzAwXCI+JHtydy5wYWNrID8gKHJ3LmZpcnN0ID8gYCR7aWNvbkltZygnc2hvcCcpfSBGaXJzdCBjbGVhciEgWW91IGVhcm5lZCBhICR7c2socncucGFjay50aWVyKX0gU291bCBQYWNrLmAgOiBgJHtpY29uSW1nKCdzaG9wJyl9IFJlcGxheSByZXdhcmQ6IGEgJHtzayhydy5wYWNrLnRpZXIpfSBTb3VsIFBhY2suYCkgOiBgUmVwbGF5IHByb2dyZXNzICR7cncucmVwbGF5TWV0ZXJ9LyR7cncucmVwbGF5TmVlZGVkfSB0b3dhcmQgYSBTb3VsIFBhY2suYH08L2Rpdj5gIDogJycpO1xuICAgICAgaWYgKHBoID09PSAnbG9zdCcgJiYgaXNFbmRsZXNzKCkgJiYgZy5lbmRsZXNzKSB7ICAgICAgICAgICAgICAgICAgICAvLyB0aGUgZW5kIG9mIGFuIGVuZGxlc3MgcnVuOiBob3cgZGVlcCwgYW55IHJlY29yZCwgcGFja3MgZWFybmVkXG4gICAgICAgIGNvbnN0IGUgPSBnLmVuZGxlc3MsIHJlYyA9IGUuY2xlYXJlZCA+IGUuc3RhcnRCZXN0O1xuICAgICAgICBvdi5jbGFzc05hbWUgPSAnc2hvdyc7IG92LmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiYm94XCI+PGgyPlJ1biBvdmVyPC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+WW91IGNsZWFyZWQgJHtlLmNsZWFyZWR9IHdhdmUke2UuY2xlYXJlZCA9PT0gMSA/ICcnIDogJ3MnfS4gJHtyZWMgPyAnPGIgc3R5bGU9XCJjb2xvcjojZmZkMjRhXCI+TmV3IGJlc3QgZGVwdGghPC9iPicgOiAnQmVzdDogd2F2ZSAnICsgTWF0aC5tYXgoZS5zdGFydEJlc3QsIGUuY2xlYXJlZCkgKyAnLid9PC9kaXY+JHtnLnJ1bkdvbGQgPyBgPGRpdiBjbGFzcz1cInN1YlwiIHN0eWxlPVwiY29sb3I6I2ZmZDI0YTtmb250LXdlaWdodDo3MDBcIj4ke2ljb25JbWcoJ2dvbGQnKX0gR29sZCBlYXJuZWQgdGhpcyBydW46ICR7Zm10KGcucnVuR29sZCl9PC9kaXY+YCA6ICcnfSR7ZS5wYWNrcyA/IGA8ZGl2IGNsYXNzPVwic3ViXCIgc3R5bGU9XCJjb2xvcjojZmZkMjRhO2ZvbnQtd2VpZ2h0OjcwMFwiPiR7aWNvbkltZygnc2hvcCcpfSAke2UucGFja3N9IFNvdWwgUGFjayR7ZS5wYWNrcyA9PT0gMSA/ICcnIDogJ3MnfSBlYXJuZWQgdGhpcyBydW4uPC9kaXY+YCA6ICc8ZGl2IGNsYXNzPVwic3ViXCI+Q2xlYXIgd2F2ZSAxMCB0byBlYXJuIGEgU291bCBQYWNrLjwvZGl2Pid9PGRpdiBjbGFzcz1cInJvd1wiPiR7ZS5wYWNrcyA/ICc8YnV0dG9uIGlkPVwidG9TaG9wXCIgY2xhc3M9XCJnb1wiPk9wZW4gcGFjazwvYnV0dG9uPicgOiAnJ308YnV0dG9uIGlkPVwiYWdhaW5cIiBjbGFzcz1cIiR7ZS5wYWNrcyA/ICdibHVlJyA6ICdnbyd9XCI+R28gYWdhaW48L2J1dHRvbj48YnV0dG9uIGlkPVwidG9Ib21lXCIgY2xhc3M9XCJibHVlXCI+SG9tZTwvYnV0dG9uPjwvZGl2PjwvZGl2PmA7XG4gICAgICAgICQoJ2FnYWluJykub25jbGljayA9ICgpID0+IGcubmV3RW5kbGVzcygpOyAkKCd0b0hvbWUnKS5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1ob21lJykpO1xuICAgICAgICBjb25zdCB0czIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG9TaG9wJyk7IGlmICh0czIpIHRzMi5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zaG9wJykpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgIG92LmNsYXNzTmFtZSA9ICdzaG93Jzsgb3YuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJib3hcIj48aDI+JHtnLmRhaWx5ID8gKHBoID09PSAnd29uJyA/ICdEYWlseSBjb21wbGV0ZSEnIDogJ0NoYWxsZW5nZSBmYWlsZWQnKSA6IHBoID09PSAnd29uJyA/ICdTdGFnZSBjbGVhcmVkIScgOiAnU3RhZ2UgbG9zdCd9PC9oMj48ZGl2IGNsYXNzPVwic3ViXCI+JHtnLmxhc3RCYXR0bGV9PC9kaXY+JHtyZXdhcmRIdG1sfTxkaXYgY2xhc3M9XCJyb3dcIj4keyhydyAmJiBydy5wYWNrKSB8fCAoZHIgJiYgZHIucGFjaykgPyAnPGJ1dHRvbiBpZD1cInRvU2hvcFwiIGNsYXNzPVwiZ29cIj5PcGVuIHBhY2s8L2J1dHRvbj4nIDogJyd9PGJ1dHRvbiBpZD1cImFnYWluXCIgY2xhc3M9XCIkeyhydyAmJiBydy5wYWNrKSB8fCAoZHIgJiYgZHIucGFjaykgPyAnYmx1ZScgOiAnZ28nfVwiPiR7cGggPT09ICd3b24nID8gJ1BsYXkgYWdhaW4nIDogJ1RyeSBhZ2Fpbid9PC9idXR0b24+PGJ1dHRvbiBpZD1cInRvSG9tZVwiIGNsYXNzPVwiYmx1ZVwiPkhvbWU8L2J1dHRvbj48L2Rpdj48L2Rpdj5gO1xuICAgICAgJCgnYWdhaW4nKS5vbmNsaWNrID0gKCkgPT4gKGcuZGFpbHkgPyBnLm5ld0RhaWx5KCkgOiBnLm5ld1J1bigpKTsgJCgndG9Ib21lJykub25jbGljayA9ICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVjcm8tZ28taG9tZScpKTtcbiAgICAgIGNvbnN0IHRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvU2hvcCcpOyBpZiAodHMpIHRzLm9uY2xpY2sgPSAoKSA9PiB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdvLXNob3AnKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMucmVuZGVyRGVidWdMaXZlKCk7XG4gICAgaWYgKHBoID09PSAnYnVpbGQnKSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4gZy5yZWZyYW1lQnVpbGQoKSk7ICAgICAvLyBhZnRlciBsYXlvdXQ6IGtlZXAgdGhlIGdyaWQgY2xlYXIgb2YgdGhlIGhhbmQgYW5kIGJ1dHRvbnNcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBkZWJ1ZyBwYW5lbFxuICBwcml2YXRlIHJlbmRlckRlYnVnKCkge1xuICAgIGNvbnN0IGcgPSB0aGlzLmcsIGQgPSB0aGlzLmRiZzsgaWYgKCFkLmNsYXNzTGlzdC5jb250YWlucygnb3BlbicpKSB7IGQuaW5uZXJIVE1MID0gJyc7IHJldHVybjsgfVxuICAgIGNvbnN0IHJvdyA9IChsYWJlbDogc3RyaW5nLCBvYmo6IGFueSwga2V5OiBzdHJpbmcgfCBudW1iZXIsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlciwgc3RlcDogbnVtYmVyKSA9PiBgPGxhYmVsPiR7bGFiZWx9IDxpbnB1dCB0eXBlPVwicmFuZ2VcIiBtaW49XCIke21pbn1cIiBtYXg9XCIke21heH1cIiBzdGVwPVwiJHtzdGVwfVwiIHZhbHVlPVwiJHtvYmpba2V5XX1cIiBkYXRhLW89XCIke2xhYmVsfVwiPjxzcGFuPiR7b2JqW2tleV19PC9zcGFuPjwvbGFiZWw+YDtcbiAgICBkLmlubmVySFRNTCA9IGA8Yj5EZWJ1ZyAobGl2ZSk8L2I+IDxzcGFuIGlkPVwiZGJnZnBzXCI+PC9zcGFuPlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj5TdGFyIG11bHRpcGxpZXJzIChib2RpZXMgPSBkYW1hZ2UsIHN0YXJzID0gZHVyYWJpbGl0eSlcbiAgICAgICAgJHtyb3coJ0hQIHggMlx1MjYwNScsIEJBTEFOQ0Uuc3Rhci5ocCwgMSwgMSwgNCwgMC4wNSl9JHtyb3coJ0hQIHggM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5ocCwgMiwgMSwgNiwgMC4wNSl9JHtyb3coJ0RhbWFnZSB4IDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuZG1nLCAxLCAxLCA0LCAwLjA1KX0ke3JvdygnRGFtYWdlIHggM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5kbWcsIDIsIDEsIDYsIDAuMDUpfSR7cm93KCdTaXplIDJcdTI2MDUnLCBCQUxBTkNFLnN0YXIuc2NhbGUsIDEsIDEsIDEuNiwgMC4wMil9JHtyb3coJ1NpemUgM1x1MjYwNScsIEJBTEFOQ0Uuc3Rhci5zY2FsZSwgMiwgMSwgMiwgMC4wMil9PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjx0YWJsZT48dHI+PHRoPjwvdGg+PHRoPmhwPC90aD48dGg+ZG1nPC90aD48dGg+cmF0ZTwvdGg+PHRoPnJhbmdlPC90aD48dGg+c3BkPC90aD48L3RyPiR7U09VTFMubWFwKChrKSA9PiBgPHRyPjx0ZD4ke0lDT05ba119PC90ZD4ke1snaHAnLCAnZG1nJywgJ2ludGVydmFsJywgJ3JhbmdlJywgJ3NwZWVkJ10ubWFwKChmKSA9PiBgPHRkPjxpbnB1dCBjbGFzcz1cIm51bVwiIGRhdGEtc291bD1cIiR7a31cIiBkYXRhLWY9XCIke2Z9XCIgdmFsdWU9XCIkeyhCQUxBTkNFLnN0YXRzIGFzIGFueSlba11bZl19XCI+PC90ZD5gKS5qb2luKCcnKX08L3RyPmApLmpvaW4oJycpfTwvdGFibGU+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPkRpZmZpY3VsdHkgPHNlbGVjdCBpZD1cImREaWZmXCI+JHtbJ2Vhc3knLCAnbm9ybWFsJywgJ2hhcmQnLCAnbmlnaHRtYXJlJ10ubWFwKChrKSA9PiBgPG9wdGlvbiB2YWx1ZT1cIiR7a31cIiAke2cuZGlmZmljdWx0eSA9PT0gayA/ICdzZWxlY3RlZCcgOiAnJ30+JHtrfTwvb3B0aW9uPmApLmpvaW4oJycpfTwvc2VsZWN0PiA8c21hbGw+KGFwcGxpZXMgdG8gdGhlIG5leHQgYmF0dGxlKTwvc21hbGw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPjxsYWJlbD48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgaWQ9XCJkTWVyZ2VIYW5kXCIgJHtnLnMucnVsZXMubWVyZ2UgPT09ICdoYW5kSW50b09uZVN0YXInID8gJ2NoZWNrZWQnIDogJyd9PiBNZXJnZSBhIGhhbmQgY2FyZCBzdHJhaWdodCBpbnRvIGEgZGVwbG95ZWQgdW5pdCAob2ZmID0gZG9jIHJ1bGU6IGJvdGggY29waWVzIG11c3QgYmUgb24gdGhlIGJvYXJkKTwvbGFiZWw+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPlBlcmZvcm1hbmNlPGJyPjxzbWFsbCBpZD1cImRiZ1BlcmZcIj5tZWFzdXJpbmdcdTIwMjY8L3NtYWxsPjxicj48bGFiZWw+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwiZEZwc1wiICR7Zy5zaG93RnBzID8gJ2NoZWNrZWQnIDogJyd9PiBTaG93IEZQUyBvbiB0aGUgYmF0dGxlIHNjcmVlbjwvbGFiZWw+IDxidXR0b24gaWQ9XCJkUGVyZlwiPkNvcHkgcGVyZiByZXBvcnQ8L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PGJ1dHRvbiBpZD1cImRPZGRzXCI+VGVzdCBvZGRzICgyMDAgZmlnaHRzKTwvYnV0dG9uPiA8c3BhbiBpZD1cImRPZGRzT3V0XCI+JHt0aGlzLm9kZHN9PC9zcGFuPjwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRzZWNcIj48YnV0dG9uIGlkPVwiZENvcHlcIj5Db3B5IHJlcG9ydDwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZFJlc2V0XCI+UmVzZXQgYmFsYW5jZTwvYnV0dG9uPiA8YnV0dG9uIGlkPVwiZFJlc3RhcnRcIj5SZXN0YXJ0IHN0YWdlPC9idXR0b24+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZHNlY1wiPkFkZCBjYXJkIDxzZWxlY3QgaWQ9XCJkQ2FyZFwiPiR7U09VTFMubWFwKChrKSA9PiBgPG9wdGlvbiB2YWx1ZT1cIiR7a31cIj4ke1NPVUxfTkFNRVtrXX08L29wdGlvbj5gKS5qb2luKCcnKX08L3NlbGVjdD4gPGJ1dHRvbiBpZD1cImRBZGRcIj4rPC9idXR0b24+IDxidXR0b24gaWQ9XCJkRG9tXCI+KzIgRG9taW5pb248L2J1dHRvbj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHNtYWxsPkxhc3QgdGFwOiA8c3BhbiBpZD1cImRiZ3RhcFwiPiR7Zy5sYXN0VGFwSW5mb308L3NwYW4+PC9zbWFsbD48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkc2VjXCI+PHNtYWxsPlNlZWQgJHtnLnNlZWR9LiBBZGQgPGNvZGU+P3NlZWQ9NzwvY29kZT4gdG8gdGhlIGxpbmsgdG8gcmVwbGF5IHRoZSBzYW1lIGRyYXdzLjwvc21hbGw+PC9kaXY+YDtcbiAgICBkLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oJ2lucHV0W3R5cGU9cmFuZ2VdJykuZm9yRWFjaCgoaW5wKSA9PiAoaW5wLm9uaW5wdXQgPSAoKSA9PiB7XG4gICAgICBjb25zdCBsYWIgPSBpbnAuZGF0YXNldC5vITsgY29uc3QgdiA9ICtpbnAudmFsdWU7IChpbnAubmV4dEVsZW1lbnRTaWJsaW5nIGFzIEhUTUxFbGVtZW50KS50ZXh0Q29udGVudCA9IFN0cmluZyh2KTtcbiAgICAgIGNvbnN0IHNldDogUmVjb3JkPHN0cmluZywgKCkgPT4gdm9pZD4gPSB7ICdIUCB4IDJcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmhwWzFdID0gdiksICdIUCB4IDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmhwWzJdID0gdiksICdEYW1hZ2UgeCAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5kbWdbMV0gPSB2KSwgJ0RhbWFnZSB4IDNcdTI2MDUnOiAoKSA9PiAoQkFMQU5DRS5zdGFyLmRtZ1syXSA9IHYpLCAnU2l6ZSAyXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5zY2FsZVsxXSA9IHYpLCAnU2l6ZSAzXHUyNjA1JzogKCkgPT4gKEJBTEFOQ0Uuc3Rhci5zY2FsZVsyXSA9IHYpIH07XG4gICAgICBzZXRbbGFiXSgpOyBnLmFwcGx5QmFsYW5jZUNoYW5nZSgpO1xuICAgIH0pKTtcbiAgICBkLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudD4oJ2lucHV0Lm51bScpLmZvckVhY2goKGlucCkgPT4gKGlucC5vbmNoYW5nZSA9ICgpID0+IHsgKEJBTEFOQ0Uuc3RhdHMgYXMgYW55KVtpbnAuZGF0YXNldC5zb3VsIV1baW5wLmRhdGFzZXQuZiFdID0gK2lucC52YWx1ZTsgfSkpO1xuICAgICQoJ2REaWZmJykub25jaGFuZ2UgPSAoZSkgPT4gZy5jaGFuZ2VEaWZmaWN1bHR5KChlLnRhcmdldCBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWUpO1xuICAgICQoJ2RNZXJnZUhhbmQnKS5vbmNoYW5nZSA9IChlKSA9PiB7IGcucy5ydWxlcy5tZXJnZSA9IChlLnRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS5jaGVja2VkID8gJ2hhbmRJbnRvT25lU3RhcicgOiAnZGVwbG95ZWRPbmx5JzsgZy5zeW5jQnVpbGQoKTsgdGhpcy5yZW5kZXIoKTsgfTtcbiAgICAkKCdkT2RkcycpLm9uY2xpY2sgPSAoKSA9PiB7IGNvbnN0IHIgPSBnLnRlc3RPZGRzKDIwMCk7IHRoaXMub2RkcyA9IGAke3Iud2lufSUgd2luICgke3Iubn0gZmlnaHRzLCBhdmcgJHtyLmF2Z1RpbWV9cykgdnMgd2F2ZSAke2cucy53YXZlfWA7ICQoJ2RPZGRzT3V0JykudGV4dENvbnRlbnQgPSB0aGlzLm9kZHM7IH07XG4gICAgJCgnZENvcHknKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCB0ID0gZy5yZXBvcnQoKTsgKG5hdmlnYXRvci5jbGlwYm9hcmQgPyBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KSA6IFByb21pc2UucmVqZWN0KCkpLnRoZW4oKCkgPT4gdGhpcy50b2FzdCgnUmVwb3J0IGNvcGllZC4gUGFzdGUgaXQgaW50byBjaGF0LicpKS5jYXRjaCgoKSA9PiB7IHByb21wdCgnQ29weSB0aGlzIHJlcG9ydDonLCB0KTsgfSk7IH07XG4gICAgJCgnZEZwcycpLm9uY2hhbmdlID0gKGUpID0+IGcuc2V0U2hvd0ZwcygoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZCk7XG4gICAgJCgnZFBlcmYnKS5vbmNsaWNrID0gKCkgPT4geyBjb25zdCB0ID0gZy5wZXJmUmVwb3J0KCk7IChuYXZpZ2F0b3IuY2xpcGJvYXJkID8gbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCkgOiBQcm9taXNlLnJlamVjdCgpKS50aGVuKCgpID0+IHRoaXMudG9hc3QoJ1BlcmYgcmVwb3J0IGNvcGllZC4gUGFzdGUgaXQgaW50byBjaGF0LicpKS5jYXRjaCgoKSA9PiB7IHByb21wdCgnQ29weSB0aGlzIHJlcG9ydDonLCB0KTsgfSk7IH07XG4gICAgJCgnZFJlc2V0Jykub25jbGljayA9ICgpID0+IHsgZy5yZXNldEJhbGFuY2VBbGwoKTsgdGhpcy5yZW5kZXJEZWJ1ZygpOyB9O1xuICAgICQoJ2RSZXN0YXJ0Jykub25jbGljayA9ICgpID0+IGcuc3RhcnRTdGFnZShnLnNlZWQpO1xuICAgICQoJ2RBZGQnKS5vbmNsaWNrID0gKCkgPT4gZy5hZGRDYXJkKCgkKCdkQ2FyZCcpIGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZSBhcyBTb3VsSWQpOyAkKCdkRG9tJykub25jbGljayA9ICgpID0+IGcuYWRkRG9taW5pb24oMik7XG4gIH1cbiAgcmVuZGVyRGVidWdMaXZlKCkge1xuICAgIGNvbnN0IGYgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJnZnBzJyk7IGlmIChmKSBmLnRleHRDb250ZW50ID0gYCR7dGhpcy5nLnBoYXNlfWA7XG4gICAgY29uc3QgcGYgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJnUGVyZicpOyBpZiAocGYpIHsgY29uc3QgcCA9IHRoaXMuZy5wZXJmSW5mbygpOyBwZi50ZXh0Q29udGVudCA9IGAke3AuZnBzLnRvRml4ZWQoMCl9IGZwcyBcdTAwQjcgYXZnICR7cC5hdmcudG9GaXhlZCgxKX1tcyBcdTAwQjcgc2xvdzUlICR7cC5wOTUudG9GaXhlZCgwKX1tcyBcdTAwQjcgd29yc3QgJHtwLndvcnN0LnRvRml4ZWQoMCl9bXMgXHUwMEI3ICR7cC5tZXNoZXN9IG1lc2hlcyBcdTAwQjcgJHtwLnBhcnRpY2xlc30gcGFydGljbGUgc3lzdGVtcyBcdTAwQjcgJHtwLmRyYXdzfSBkcmF3IGNhbGxzYDsgfVxuICAgIGNvbnN0IHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGJndGFwJyk7IGlmICh0KSB0LnRleHRDb250ZW50ID0gdGhpcy5nLmxhc3RUYXBJbmZvO1xuICB9XG59XG4iLCAiLy8gVGhlIHBsYXlhYmxlIHByb3RvdHlwZTogYnVpbGQgc2NyZWVuIC0+IGJhdHRsZSAtPiBkcmFmdCAtPiBuZXh0IHdhdmUsIGJ1aWx0IG9uIHRoZSB0ZXN0ZWQgcnVsZXMgKyBiYXR0bGUgZW5naW5lLlxuZGVjbGFyZSBjb25zdCBCQUJZTE9OOiBhbnk7XG5pbXBvcnQgeyBCQUxBTkNFLCByZXNldEJhbGFuY2UsIFNPVUxfTkFNRSB9IGZyb20gJy4uL2NvcmUvYmFsYW5jZS50cyc7XG5pbXBvcnQgeyBHUklEX0NFTExTLCBHUklEX0NPTFMsIEdSSURfUk9XUywgU09VTFMgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHR5cGUgeyBTb3VsSWQgfSBmcm9tICcuLi9jb3JlL2RhdGEudHMnO1xuaW1wb3J0IHtcbiAgYWR2YW5jZVdhdmUsIGNhbk1lcmdlRGVwbG95ZWQsIGNhbk1lcmdlRnJvbUhhbmQsIGNhblN1bW1vbiwgY2VsbEZyZWUsIGNvc3QsIGRpc2NhcmRSZWRyYXcsIGRpc21pc3MsIGRvbWluaW9uRnJlZSwgZG9taW5pb25Vc2VkLCBkcmFmdE9wdGlvbnMsIGZhaWxXYXZlLFxuICBtZXJnZURlcGxveWVkLCBtZXJnZUZyb21IYW5kLCBtb3ZlVW5pdCwgbmV3U3RhZ2UsIG5vcm1hbERyYXcsIHN0YWdlV2F2ZXMsIHN1bW1vbiwgc3dhcFNlbGwsIHRha2VEcmFmdCxcbn0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0YXRlIH0gZnJvbSAnLi4vY29yZS9ydWxlcy50cyc7XG5pbXBvcnQgeyBidWlsZEFyZW5hIH0gZnJvbSAnLi9hcmVuYS50cyc7XG5pbXBvcnQgeyBCYXR0bGUsIGNlbGxQb3MsIEZST05UX1gsIEdSSURfU1AsIHNpbXVsYXRlIH0gZnJvbSAnLi4vY29yZS9iYXR0bGUudHMnO1xuaW1wb3J0IHR5cGUgeyBCRXZlbnQgfSBmcm9tICcuLi9jb3JlL2JhdHRsZS50cyc7XG5pbXBvcnQgeyBjdXJyZW50U3RhZ2VJZCwgZGlmZmljdWx0eU5hbWUsIGVuZW15UG93ZXIsIGVuZW15V2F2ZSwgaXNFbmRsZXNzLCBzZXREaWZmaWN1bHR5LCBzZXRFbmRsZXNzLCBzZXRTdGFnZURpZmZpY3VsdHksIHNldERhaWx5IH0gZnJvbSAnLi4vY29yZS93YXZlcy50cyc7XG5pbXBvcnQgeyBFTkRMRVNTX0lELCBFTkRMRVNTX1BBQ0tfRVZFUlkgfSBmcm9tICcuLi9jb3JlL2VuZGxlc3MudHMnO1xuaW1wb3J0IHsgREFJTFlfSUQsIGRhaWx5UnVsZXMsIGRheU51bWJlciwgaXNWYWxpZERheSwgbW9kaWZpZXJGb3IgfSBmcm9tICcuLi9jb3JlL2RhaWx5LnRzJztcbmltcG9ydCB0eXBlIHsgRGFpbHlNb2QgfSBmcm9tICcuLi9jb3JlL2RhaWx5LnRzJztcbmltcG9ydCB7IEVORExFU1NfUlVMRVMsIFBST1RPVFlQRV9SVUxFUyB9IGZyb20gJy4uL2NvcmUvcHJvdG90eXBlLnRzJztcbmltcG9ydCB7IGxvYWRTYXZlIH0gZnJvbSAnLi4vY29yZS9zYXZlLnRzJztcbmltcG9ydCB7IGVuZGxlc3NVbmxvY2tlZCB9IGZyb20gJy4uL2NvcmUvcHJvZ3Jlc3MudHMnO1xuaW1wb3J0IHsgTmVjcm9tYW5jZXIgfSBmcm9tICcuL25lY3JvbWFuY2VyLnRzJztcbmltcG9ydCB7IGF1ZGlvIH0gZnJvbSAnLi9hdWRpby50cyc7XG5pbXBvcnQgeyBjbGVhclJ1biwgbG9hZFJ1biwgc2F2ZVJ1biwgc2VyaWFsaXplU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bnNhdmUudHMnO1xuaW1wb3J0IHsgYWRkR29sZEFuZFNhdmUsIGVuZGxlc3NXYXZlR29sZCwgcGxheWFibGUsIHJlY29yZENsZWFyQW5kU2F2ZSwgcmVjb3JkRGFpbHlXaW5BbmRTYXZlLCByZWNvcmRFbmRsZXNzV2F2ZUFuZFNhdmUsIHdhdmVHb2xkIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5pbXBvcnQgdHlwZSB7IERhaWx5UmV3YXJkIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5pbXBvcnQgdHlwZSB7IENsZWFyUmV3YXJkIH0gZnJvbSAnLi4vY29yZS9wcm9ncmVzcy50cyc7XG5pbXBvcnQgdHlwZSB7IFJ1blNuYXBzaG90IH0gZnJvbSAnLi4vY29yZS9ydW5zYXZlLnRzJztcbmltcG9ydCB0eXBlIHsgU3RhdGUgfSBmcm9tICcuLi9jb3JlL3J1bGVzLnRzJztcbmltcG9ydCB7IGNyZWF0ZVZpc3VhbCwgaXNUcmlwbywgbG9hZEFzc2V0cyB9IGZyb20gJy4vdmlzdWFscy50cyc7XG5pbXBvcnQgdHlwZSB7IEFzc2V0cywgVW5pdFZpc3VhbCB9IGZyb20gJy4vdmlzdWFscy50cyc7XG5pbXBvcnQgeyBVaSB9IGZyb20gJy4vdWkudHMnO1xuXG5leHBvcnQgdHlwZSBQaGFzZSA9ICdidWlsZCcgfCAndHJhbnNpdGlvbicgfCAnYmF0dGxlJyB8ICdkcmFmdCcgfCAnd29uJyB8ICdsb3N0JztcbnR5cGUgU2VsID0geyB0eXBlOiAnY2FyZCc7IGlkeDogbnVtYmVyIH0gfCB7IHR5cGU6ICd1bml0JzsgaWQ6IG51bWJlciB9IHwgbnVsbDtcblxuZXhwb3J0IGNsYXNzIEdhbWUge1xuICBlbmdpbmU6IGFueTsgc2NlbmU6IGFueTsgY2FtZXJhOiBhbnk7IEEhOiBBc3NldHM7IHVpITogVWk7XG4gIGRhaWx5OiB7IGRheTogbnVtYmVyOyBtb2Q6IERhaWx5TW9kIH0gfCBudWxsID0gbnVsbDsgZGFpbHlSZXdhcmQ6IERhaWx5UmV3YXJkIHwgbnVsbCA9IG51bGw7ICAgLy8gdGhlIERhaWx5IENoYWxsZW5nZSBydW4gaW4gcHJvZ3Jlc3MsIGFuZCB3aGF0IGl0cyB3aW4gcGFpZFxuICBsYXN0R29sZCA9IDA7IHJ1bkdvbGQgPSAwOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBnb2xkIGZyb20gdGhlIHdhdmUganVzdCBjbGVhcmVkLCBhbmQgZnJvbSB0aGlzIHdob2xlIHJ1blxuICBzITogU3RhdGU7IHNlZWQgPSAxOyBhdHRlbXB0ID0gMDsgcGhhc2U6IFBoYXNlID0gJ2J1aWxkJzsgYmF0dGxlOiBCYXR0bGUgfCBudWxsID0gbnVsbDsgdGltZVNjYWxlID0gMTtcbiAgc2VsOiBTZWwgPSBudWxsOyBzd2FwTW9kZSA9IGZhbHNlOyBjb25maXJtUmVtb3ZlID0gZmFsc2U7IGRyYWZ0OiBTb3VsSWRbXSB8IG51bGwgPSBudWxsOyBsYXN0QmF0dGxlID0gJyc7XG4gIHByaXZhdGUgdW5pdFZpcyA9IG5ldyBNYXA8bnVtYmVyLCBVbml0VmlzdWFsPigpOyAgICAgICAgLy8gdW5pdCBpZCAtPiB2aXN1YWwgKHlvdXIgYXJteSwgcGVyc2lzdHMgYmV0d2VlbiB3YXZlcylcbiAgcHJpdmF0ZSB2aXNUb1VuaXQgPSBuZXcgTWFwPFVuaXRWaXN1YWwsIG51bWJlcj4oKTtcbiAgcHJpdmF0ZSBmdmlzID0gbmV3IE1hcDxudW1iZXIsIFVuaXRWaXN1YWw+KCk7ICAgICAgICAgICAvLyBmaWdodGVyIGlkIC0+IHZpc3VhbCBkdXJpbmcgYSBiYXR0bGVcbiAgcHJpdmF0ZSBmVW5pdCA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCk7ICAgICAgICAgICAgICAvLyBmaWdodGVyIGlkIC0+IHVuaXQgaWQgKHBsYXllciBzaWRlKVxuICBwcml2YXRlIGxhc3RTdGF0ZSA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmc+KCk7XG4gIHByaXZhdGUgYXJlbmEhOiB7IHVwZGF0ZSh0OiBudW1iZXIpOiB2b2lkOyBzZXRUaGVtZShzdGFnZTogc3RyaW5nKTogdm9pZCB9O1xuICBwcml2YXRlIHRpbGVzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHRpbGVNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIHJpbmdGeDogYW55W10gPSBbXTsgcHJpdmF0ZSBhcnJvd3M6IGFueVtdID0gW107IHByaXZhdGUgdGltZXJzOiB7IHQ6IG51bWJlcjsgZm46ICgpID0+IHZvaWQgfVtdID0gW107XG4gIHByaXZhdGUgYWNjID0gMDsgcHJpdmF0ZSBjYW1Gcm9tOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVRvOiBhbnkgPSBudWxsOyBwcml2YXRlIGNhbVQgPSAxOyBwcml2YXRlIGNhbUR1ciA9IDIuMDsgcHJpdmF0ZSByZXN1bHRBdCA9IC0xOyBwcml2YXRlIGhhbmRsZWQgPSBmYWxzZTsgcHJpdmF0ZSBzdGFydFN0ZXBBdCA9IDA7XG4gIHByaXZhdGUgYXJyb3dNYXRzOiBhbnlbXSA9IFtdOyBwcml2YXRlIGFycm93TWVzaDogYW55W10gPSBbXTtcbiAgbmVjcm8hOiBOZWNyb21hbmNlcjtcbiAgLyoqIFdoYXQgdGhlIGxhc3Qgc3RhZ2UgY2xlYXIgZWFybmVkIChzaG93biBvbiB0aGUgc3RhZ2UtY2xlYXJlZCBzY3JlZW4pLiAqL1xuICByZXdhcmQ6IENsZWFyUmV3YXJkIHwgbnVsbCA9IG51bGw7XG4gIC8qKiBUaGUgZW5kbGVzcyBydW4gaW4gcHJvZ3Jlc3M6IHRoZSBiZXN0IGRlcHRoIHdoZW4gaXQgYmVnYW4gKHRvIHNwb3QgYSBuZXcgcmVjb3JkKSwgdGhlIHdhdmVzIGNsZWFyZWQgc28gZmFyLCBhbmQgdGhlIHBhY2tzIGVhcm5lZC4gKi9cbiAgZW5kbGVzczogeyBzdGFydEJlc3Q6IG51bWJlcjsgY2xlYXJlZDogbnVtYmVyOyBwYWNrczogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjaW5lID0gZmFsc2U7ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhIHJlc3VsdCBjdXRzY2VuZSBpcyBwbGF5aW5nOiB0aGUgYmF0dGxlIGNhbWVyYSBhbmQgZmlnaHRlciBzeW5jIHN0YW5kIGRvd25cbiAgcHJpdmF0ZSB0d2VlbnM6IHsgdDogbnVtYmVyOyBkdXI6IG51bWJlcjsgZm46ICh1OiBudW1iZXIpID0+IHZvaWQ7IGRvbmU/OiAoKSA9PiB2b2lkIH1bXSA9IFtdO1xuICBwcml2YXRlIHR3ZWVuKGR1cjogbnVtYmVyLCBmbjogKHU6IG51bWJlcikgPT4gdm9pZCwgZG9uZT86ICgpID0+IHZvaWQpIHsgdGhpcy50d2VlbnMucHVzaCh7IHQ6IDAsIGR1ciwgZm4sIGRvbmUgfSk7IH1cbiAgLyoqIEZpbmlzaCBldmVyeSBydW5uaW5nIGFuaW1hdGlvbiBhdCBvbmNlIChzbyBub3RoaW5nIGlzIGxlZnQgaGFsZi13YXkgb3IgdW5kaXNwb3NlZCB3aGVuIHRoZSBwaGFzZSBjaGFuZ2VzKS4gKi9cbiAgcHJpdmF0ZSBmbHVzaFR3ZWVucygpIHsgZm9yIChjb25zdCB3IG9mIHRoaXMudHdlZW5zLnNwbGljZSgwKSkgeyB3LmZuKDEpOyBpZiAody5kb25lKSB3LmRvbmUoKTsgfSB9XG4gIHByaXZhdGUgc2Vlbk1lcmdlcyA9IDA7XG5cbiAgYXN5bmMgaW5pdChjYW52YXM6IEhUTUxDYW52YXNFbGVtZW50KSB7XG4gICAgY29uc3QgcXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLnNlYXJjaCk7XG4gICAgdGhpcy5lbmdpbmUgPSBuZXcgQkFCWUxPTi5FbmdpbmUoY2FudmFzLCB0cnVlLCB7IGFudGlhbGlhczogdHJ1ZSwgcG93ZXJQcmVmZXJlbmNlOiAnaGlnaC1wZXJmb3JtYW5jZScgfSk7XG4gICAgY29uc3QgZHByID0gd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTsgdGhpcy5lbmdpbmUuc2V0SGFyZHdhcmVTY2FsaW5nTGV2ZWwoMSAvIE1hdGgubWluKGRwciwgMS41KSk7XG4gICAgY29uc3Qgc2NlbmUgPSB0aGlzLnNjZW5lID0gbmV3IEJBQllMT04uU2NlbmUodGhpcy5lbmdpbmUpOyBzY2VuZS5jbGVhckNvbG9yID0gbmV3IEJBQllMT04uQ29sb3I0KDAuMDksIDAuMDcsIDAuMTMsIDEpO1xuICAgIGNvbnN0IGhlbWkgPSBuZXcgQkFCWUxPTi5IZW1pc3BoZXJpY0xpZ2h0KCdoJywgbmV3IEJBQllMT04uVmVjdG9yMygwLjIsIDEsIDAuMyksIHNjZW5lKTsgaGVtaS5pbnRlbnNpdHkgPSAxLjA1OyBoZW1pLmdyb3VuZENvbG9yID0gbmV3IEJBQllMT04uQ29sb3IzKDAuMzIsIDAuMjYsIDAuNDIpO1xuICAgIGNvbnN0IHN1biA9IG5ldyBCQUJZTE9OLkRpcmVjdGlvbmFsTGlnaHQoJ3MnLCBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjQsIC0xLCAwLjU1KSwgc2NlbmUpOyBzdW4uaW50ZW5zaXR5ID0gMC44NTtcbiAgICB0aGlzLmNhbWVyYSA9IG5ldyBCQUJZTE9OLkZyZWVDYW1lcmEoJ2NhbScsIG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgOCwgLTkpLCBzY2VuZSk7IHRoaXMuY2FtZXJhLm1pblogPSAwLjE7IHRoaXMuY2FtZXJhLm1heFogPSAyMDA7IHRoaXMuY2FtZXJhLmZvdiA9IDAuODsgdGhpcy5jYW1lcmEuaW5wdXRzLmNsZWFyKCk7XG5cbiAgICBjb25zdCBncm91bmQgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUdyb3VuZCgnZ3JvdW5kJywgeyB3aWR0aDogNjAsIGhlaWdodDogNDAgfSwgc2NlbmUpO1xuICAgIGdyb3VuZC5pc1BpY2thYmxlID0gZmFsc2U7IGNvbnN0IGFyZW5hID0gdGhpcy5hcmVuYSA9IGJ1aWxkQXJlbmEoc2NlbmUsIGdyb3VuZCk7IHNjZW5lLm9uQmVmb3JlUmVuZGVyT2JzZXJ2YWJsZS5hZGQoKCkgPT4gYXJlbmEudXBkYXRlKHBlcmZvcm1hbmNlLm5vdygpIC8gMTAwMCkpO1xuICAgIGZvciAoY29uc3QgdGVhbSBvZiBbMCwgMV0gYXMgY29uc3QpIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB7IGNvbnN0IHQgPSB0aGlzLm1ha2VUaWxlKHRlYW0sIGMpOyBpZiAodGVhbSA9PT0gMCkgdGhpcy50aWxlcy5wdXNoKHQpOyBlbHNlIHQuc2V0RW5hYmxlZChmYWxzZSk7IH1cblxuICAgIHRoaXMuQSA9IGF3YWl0IGxvYWRBc3NldHMoc2NlbmUpO1xuICAgIHRoaXMubmVjcm8gPSBuZXcgTmVjcm9tYW5jZXIoc2NlbmUsIHRoaXMuQS5zb2Z0LCB0aGlzLkEubmVjcm8pOyAgICAgICAvLyBzdGFuZHMganVzdCBiZWhpbmQgaGlzIGFybXkncyBiYWNrIGNvbHVtbiwgZmFjaW5nIHRoZSBiYXR0bGVmaWVsZFxuICAgIHRoaXMubmVjcm8uaG9sZGVyLnBvc2l0aW9uLnNldCgtKEZST05UX1ggKyAoR1JJRF9DT0xTIC0gMSkgKiBHUklEX1NQKSAtIDEuMDUsIDAsIDApOyB0aGlzLm5lY3JvLmhvbGRlci5yb3RhdGlvbi55ID0gTWF0aC5QSSAvIDI7XG4gICAgdGhpcy5hcnJvd01hdHMgPSBbMCwgMV0ubWFwKCh0KSA9PiB7IGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdhbScgKyB0LCBzY2VuZSk7IG0uZGlmZnVzZUNvbG9yID0gQkFCWUxPTi5Db2xvcjMuQmxhY2soKTsgbS5lbWlzc2l2ZUNvbG9yID0gdCA9PT0gMCA/IG5ldyBCQUJZTE9OLkNvbG9yMygwLjc1LCAwLjMsIDEpIDogbmV3IEJBQllMT04uQ29sb3IzKDEsIDAuNywgMC4yNSk7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgcmV0dXJuIG07IH0pO1xuICAgIHRoaXMudWkgPSBuZXcgVWkodGhpcyk7IHRoaXMuc2VlZCA9ICsocXMuZ2V0KCdzZWVkJykgfHwgMSk7IGlmIChxcy5nZXQoJ2ZwcycpKSB0aGlzLnNldFNob3dGcHModHJ1ZSk7XG5cbiAgICAvLyBUYXBzIGFyZSBkZXRlY3RlZCBoZXJlIChub3QgdGhyb3VnaCBCYWJ5bG9uKSBzbyB0aGV5IGJlaGF2ZSB0aGUgc2FtZSBpbiBTYWZhcmksIHRoZSBob21lLXNjcmVlbiBhcHAgYW5kIG9uIGRlc2t0b3AuXG4gICAgbGV0IGRvd246IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbG9jYWwgPSAoZTogUG9pbnRlckV2ZW50KSA9PiB7IGNvbnN0IHIgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7IHJldHVybiB7IHg6IGUuY2xpZW50WCAtIHIubGVmdCwgeTogZS5jbGllbnRZIC0gci50b3AgfTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmRvd24nLCAoZSkgPT4geyBkb3duID0geyAuLi5sb2NhbChlKSwgdDogcGVyZm9ybWFuY2Uubm93KCkgfTsgfSk7XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3BvaW50ZXJ1cCcsIChlKSA9PiB7IGlmICghZG93bikgcmV0dXJuOyBjb25zdCBwID0gbG9jYWwoZSk7IGNvbnN0IG1vdmVkID0gTWF0aC5oeXBvdChwLnggLSBkb3duLngsIHAueSAtIGRvd24ueSksIGR0ID0gcGVyZm9ybWFuY2Uubm93KCkgLSBkb3duLnQ7IGRvd24gPSBudWxsOyBpZiAobW92ZWQgPCAxNiAmJiBkdCA8IDkwMCkgdGhpcy50YXAocC54LCBwLnkpOyB9KTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcigncG9pbnRlcmNhbmNlbCcsICgpID0+IHsgZG93biA9IG51bGw7IH0pO1xuICAgIHRoaXMuY2FudmFzID0gY2FudmFzOyBjb25zdCBvblJlc2l6ZSA9ICgpID0+IHRoaXMuaGFuZGxlUmVzaXplKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTsgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ29yaWVudGF0aW9uY2hhbmdlJywgKCkgPT4gc2V0VGltZW91dChvblJlc2l6ZSwgMjUwKSk7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS52aXN1YWxWaWV3cG9ydCkgKHdpbmRvdyBhcyBhbnkpLnZpc3VhbFZpZXdwb3J0LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplKTtcbiAgICBpZiAoKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKSBuZXcgKHdpbmRvdyBhcyBhbnkpLlJlc2l6ZU9ic2VydmVyKG9uUmVzaXplKS5vYnNlcnZlKGNhbnZhcyk7XG4gICAgaWYgKHFzLmdldCgnZ2FsbGVyeScpKSB7IHRoaXMuZ2FsbGVyeSgpOyByZXR1cm47IH1cbiAgICBjb25zdCBzYXZlZCA9IHFzLmdldCgnc2VlZCcpID8gbnVsbCA6IGxvYWRSdW4oKTsgICAgICAgICAgICAgICAgLy8gP3NlZWQ9TiBhbHdheXMgc3RhcnRzIGZyZXNoIChkZWJ1Z2dpbmcpOyBvdGhlcndpc2UgcGljayB1cCB3aGVyZSB0aGUgbGFzdCB2aXNpdCBsZWZ0IG9mZlxuICAgIGlmIChzYXZlZCkgdGhpcy5yZXN0b3JlKHNhdmVkKTsgZWxzZSB0aGlzLnN0YXJ0U3RhZ2UodGhpcy5zZWVkKTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuZW5naW5lLnJ1blJlbmRlckxvb3AoKCkgPT4geyBjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKSwgcmF3ID0gbm93IC0gbGFzdDsgY29uc3QgZHQgPSBNYXRoLm1pbigwLjA1LCByYXcgLyAxMDAwKTsgbGFzdCA9IG5vdzsgaWYgKCF0aGlzLmFjdGl2ZSkgcmV0dXJuOyBpZiAodGhpcy5pbnNwZWN0aW5nKSB0aGlzLmZyYW1lSW5zcGVjdChkdCk7IGVsc2UgaWYgKCF0aGlzLmZyb3plbikgdGhpcy5mcmFtZShkdCk7IHNjZW5lLnJlbmRlcigpOyB0aGlzLnBlcmZUaWNrKHJhdyk7IH0pO1xuICB9XG4gIC8qKiBUaGUgbmF2aWdhdGlvbiBzaGVsbCBoaWRlcyB0aGUgYmF0dGxlIHNjcmVlbiB3aGlsZSBhbm90aGVyIHRhYiBpcyBvcGVuOiBwYXVzZSB0aGUgZ2FtZSBzbyBpdCBjb3N0cyBub3RoaW5nLiAqL1xuICBwcml2YXRlIGFjdGl2ZSA9IHRydWU7XG4gIC8qKiBEZWJ1Zzoga2VlcCBkcmF3aW5nIGJ1dCBzdG9wIGFkdmFuY2luZyB0aW1lLCBzbyBhIG1vbWVudCBjYW4gYmUgc3RlcHBlZCB0aHJvdWdoIHdpdGggZnJhbWUoZHQpIGFuZCBzY3JlZW5zaG90dGVkLiAqL1xuICBmcm96ZW4gPSBmYWxzZTtcbiAgc3RlcChkdDogbnVtYmVyKSB7IHRoaXMuZnJhbWUoZHQpOyB9XG4gIHNldEFjdGl2ZShvbjogYm9vbGVhbikgeyB0aGlzLmFjdGl2ZSA9IG9uOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gaW5zcGVjdCAodGhlIFNvdWxzIHBhZ2UncyAzRCBsb29rIGF0IG9uZSBTb3VsKVxuICBwcml2YXRlIGluc3BlY3Rpbmc6IHsgc291bDogU291bElkOyB2OiBVbml0VmlzdWFsOyBzdGFyOiBudW1iZXI7IHRlYW06IDAgfCAxOyBzcGluOiBib29sZWFuOyBoaWRkZW46IGFueVtdOyBncmlkOiBib29sZWFuIH0gfCBudWxsID0gbnVsbDtcbiAgLyoqIFNob3cgb25lIFNvdWwgb24gaXRzIG93biBvbiB0aGUgYXJlbmEgZmxvb3I6IHNsb3cgdHVybnRhYmxlLCBidXR0b25zIGZvciBldmVyeSBhbmltYXRpb24gaXQgaGFzLCBzdGFyIHNpemVzIGFuZCB0aGUgZW5lbXkgY29sb3Vycy4gKi9cbiAgaW5zcGVjdChzb3VsOiBTb3VsSWQpIHtcbiAgICBpZiAoIXRoaXMuQSB8fCB0aGlzLmluc3BlY3RpbmcpIHJldHVybjtcbiAgICBjb25zdCBoaWRkZW46IGFueVtdID0gW107IGNvbnN0IGhpZGUgPSAobjogYW55KSA9PiB7IGlmIChuICYmIG4uaXNFbmFibGVkICYmIG4uaXNFbmFibGVkKCkpIHsgbi5zZXRFbmFibGVkKGZhbHNlKTsgaGlkZGVuLnB1c2gobik7IH0gfTtcbiAgICBmb3IgKGNvbnN0IHYgb2YgdGhpcy51bml0VmlzLnZhbHVlcygpKSBoaWRlKHYuaG9sZGVyKTsgdGhpcy5mdmlzLmZvckVhY2goKHYpID0+IGhpZGUodi5ob2xkZXIpKTsgaWYgKHRoaXMubmVjcm8uaG9sZGVyLmlzRW5hYmxlZCgpKSB7IHRoaXMubmVjcm8uc2V0RW5hYmxlZChmYWxzZSk7IGhpZGRlbi5wdXNoKHsgc2V0RW5hYmxlZDogKG9uOiBib29sZWFuKSA9PiB0aGlzLm5lY3JvLnNldEVuYWJsZWQob24pIH0pOyB9IHRoaXMucmluZ0Z4LmZvckVhY2goKHIpID0+IGhpZGUoci5tKSk7IHRoaXMuYXJyb3dzLmZvckVhY2goKGEpID0+IGhpZGUoYS5tZXNoKSk7XG4gICAgY29uc3QgZ3JpZCA9IHRoaXMudGlsZXMubGVuZ3RoID4gMCAmJiB0aGlzLnRpbGVzWzBdLmlzRW5hYmxlZCgpOyB0aGlzLnNob3dHcmlkKGZhbHNlKTtcbiAgICBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgc291bCwgMCwgMSk7IGNvbnN0IFAgPSB7IHg6IC02LCB6OiAwIH07IHYuaG9sZGVyLnBvc2l0aW9uLnNldChQLngsIDAsIFAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJICogMC44NTsgdi5wbGF5KCdpZGxlJyk7XG4gICAgdGhpcy5pbnNwZWN0aW5nID0geyBzb3VsLCB2LCBzdGFyOiAxLCB0ZWFtOiAwLCBzcGluOiB0cnVlLCBoaWRkZW4sIGdyaWQgfTtcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5hZGQoJ2luc3BlY3QnKTtcbiAgICB0aGlzLmNhbWVyYS5mb3YgPSAwLjYyOyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5zZXQoUC54LCAxLjE1LCBQLnogLSAzLjUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQobmV3IEJBQllMT04uVmVjdG9yMyhQLngsIDAuNTYsIFAueikpO1xuICAgIHRoaXMucmVuZGVySW5zcGVjdEJhcigpO1xuICB9XG4gIGVuZEluc3BlY3QoKSB7XG4gICAgY29uc3QgaSA9IHRoaXMuaW5zcGVjdGluZzsgaWYgKCFpKSByZXR1cm47XG4gICAgaS52LmRpc3Bvc2UoKTsgaS5oaWRkZW4uZm9yRWFjaCgobikgPT4gbi5zZXRFbmFibGVkKHRydWUpKTsgdGhpcy5zaG93R3JpZChpLmdyaWQgJiYgdGhpcy5waGFzZSA9PT0gJ2J1aWxkJyk7XG4gICAgdGhpcy5pbnNwZWN0aW5nID0gbnVsbDsgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QucmVtb3ZlKCdpbnNwZWN0Jyk7IGNvbnN0IGJhciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbnNwZWN0YmFyJyk7IGlmIChiYXIpIGJhci5pbm5lckhUTUwgPSAnJztcbiAgICB0aGlzLmNhbWVyYS5mb3YgPSAwLjg7IHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7XG4gIH1cbiAgcHJpdmF0ZSBmcmFtZUluc3BlY3QoZHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGkgPSB0aGlzLmluc3BlY3RpbmchOyBpLnYudXBkYXRlKGR0KTsgaWYgKGkuc3BpbikgaS52LmhvbGRlci5yb3RhdGlvbi55ICs9IGR0ICogMC40NTtcbiAgICB0aGlzLmFyZW5hLnVwZGF0ZShwZXJmb3JtYW5jZS5ub3coKSAvIDEwMDApO1xuICB9XG4gIHByaXZhdGUgcmVuZGVySW5zcGVjdEJhcigpIHtcbiAgICBjb25zdCBpID0gdGhpcy5pbnNwZWN0aW5nOyBjb25zdCBiYXIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaW5zcGVjdGJhcicpOyBpZiAoIWkgfHwgIWJhcikgcmV0dXJuO1xuICAgIGNvbnN0IG5pY2UgPSAobjogc3RyaW5nKSA9PiAoeyBTcGF3bjogJ0Fycml2YWwnLCBBdHRhY2s6ICdBdHRhY2snLCBDaGVlcjogJ0NoZWVyJywgRGVhdGg6ICdGYWxsJyB9IGFzIGFueSlbbl0gPz8gbi5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCAnJDEgJDInKTtcbiAgICBjb25zdCBjbGlwcyA9IChpLnYuY2xpcE5hbWVzID8gaS52LmNsaXBOYW1lcygpIDogW10pLm1hcCgobikgPT4gYDxidXR0b24gZGF0YS1jbGlwPVwiJHtufVwiPiR7bmljZShuKX08L2J1dHRvbj5gKS5qb2luKCcnKTtcbiAgICBiYXIuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCJpYlwiPjxidXR0b24gaWQ9XCJpYkJhY2tcIiBjbGFzcz1cImdvXCI+QmFjazwvYnV0dG9uPjxiIGNsYXNzPVwiaWJ0XCI+JHtTT1VMX05BTUVbaS5zb3VsXX08L2I+JHtbMSwgMiwgM10ubWFwKChuKSA9PiBgPGJ1dHRvbiBkYXRhLXN0YXI9XCIke259XCIgY2xhc3M9XCIke2kuc3RhciA9PT0gbiA/ICdvbicgOiAnJ31cIj4ke259XFx1MjYwNTwvYnV0dG9uPmApLmpvaW4oJycpfTxidXR0b24gaWQ9XCJpYlRlYW1cIiBjbGFzcz1cIiR7aS50ZWFtID8gJ29uJyA6ICcnfVwiPkVuZW15IGNvbG91cnM8L2J1dHRvbj48YnV0dG9uIGlkPVwiaWJTcGluXCIgY2xhc3M9XCIke2kuc3BpbiA/ICdvbicgOiAnJ31cIj5UdXJuPC9idXR0b24+PC9kaXY+PGRpdiBjbGFzcz1cImliIGliY1wiPiR7Y2xpcHN9PC9kaXY+YDtcbiAgICBiYXIucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ1tkYXRhLWNsaXBdJykuZm9yRWFjaCgoYikgPT4gKGIub25jbGljayA9ICgpID0+IHsgYXVkaW8ucGxheSgndGFwJyk7IGkudi5wcmV2aWV3Q2xpcCAmJiBpLnYucHJldmlld0NsaXAoYi5kYXRhc2V0LmNsaXAhKTsgfSkpO1xuICAgIGJhci5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignW2RhdGEtc3Rhcl0nKS5mb3JFYWNoKChiKSA9PiAoYi5vbmNsaWNrID0gKCkgPT4geyBpLnN0YXIgPSArYi5kYXRhc2V0LnN0YXIhOyBpLnYuc2V0U3RhcihpLnN0YXIpOyB0aGlzLnJlbmRlckluc3BlY3RCYXIoKTsgfSkpO1xuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaWJUZWFtJykgYXMgSFRNTEVsZW1lbnQpLm9uY2xpY2sgPSAoKSA9PiB7IGkudGVhbSA9IGkudGVhbSA/IDAgOiAxOyBpLnYuc2V0VGVhbShpLnRlYW0pOyB0aGlzLnJlbmRlckluc3BlY3RCYXIoKTsgfTtcbiAgICAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2liU3BpbicpIGFzIEhUTUxFbGVtZW50KS5vbmNsaWNrID0gKCkgPT4geyBpLnNwaW4gPSAhaS5zcGluOyB0aGlzLnJlbmRlckluc3BlY3RCYXIoKTsgfTtcbiAgICAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2liQmFjaycpIGFzIEhUTUxFbGVtZW50KS5vbmNsaWNrID0gKCkgPT4gd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1nby1zb3VscycpKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNjZW5lIGhlbHBlcnNcbiAgLyoqIFRoZSBwbGFjZW1lbnQgZ3JpZCBpcyBhIGJ1aWxkLXNjcmVlbiB0b29sOiBoaWRlIGl0IGR1cmluZyB0aGUgZmlnaHQgc28gdGhlIGJhdHRsZSBsb29rcyBsaWtlIGEgc2NlbmUsIG5vdCBhIGJvYXJkLiAqL1xuICBwcml2YXRlIHNob3dHcmlkKG9uOiBib29sZWFuKSB7IGZvciAoY29uc3QgdCBvZiB0aGlzLnRpbGVzKSB0LnNldEVuYWJsZWQob24pOyB9XG4gIHByaXZhdGUgbWFrZVRpbGUodGVhbTogMCB8IDEsIGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHAgPSBjZWxsUG9zKHRlYW0sIGNlbGwpLCB0ID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVQbGFuZSgndGlsZScgKyBjZWxsLCB7IHNpemU6IEdSSURfU1AgKiAwLjkyIH0sIHRoaXMuc2NlbmUpO1xuICAgIHQucm90YXRpb24ueCA9IE1hdGguUEkgLyAyOyB0LnBvc2l0aW9uLnNldChwLngsIDAuMDE1LCBwLnopO1xuICAgIGNvbnN0IG0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCd0bScsIHRoaXMuc2NlbmUpOyBtLmRpZmZ1c2VDb2xvciA9IEJBQllMT04uQ29sb3IzLkJsYWNrKCk7IG0uZW1pc3NpdmVDb2xvciA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC4xOCwgMC4xMiwgMC40MikgOiBuZXcgQkFCWUxPTi5Db2xvcjMoMC40MiwgMC4xMiwgMC4xMik7IG0uYWxwaGEgPSAwLjU7IG0uZGlzYWJsZUxpZ2h0aW5nID0gdHJ1ZTsgdC5tYXRlcmlhbCA9IG07XG4gICAgaWYgKHRlYW0gPT09IDApIHsgdC5tZXRhZGF0YSA9IHsga2luZDogJ3RpbGUnLCBjZWxsIH07IHRoaXMudGlsZU1hdHNbY2VsbF0gPSBtOyB9IGVsc2UgdC5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgcmV0dXJuIHQ7XG4gIH1cbiAgcHJpdmF0ZSB0aW50KGNlbGw6IG51bWJlciwgbW9kZTogJ25vcm1hbCcgfCAnZnJlZScgfCAnc2VsJyB8ICdwYXJ0bmVyJykge1xuICAgIGNvbnN0IG0gPSB0aGlzLnRpbGVNYXRzW2NlbGxdOyBjb25zdCBjID0geyBub3JtYWw6IFswLjE4LCAwLjEyLCAwLjQyLCAwLjVdLCBmcmVlOiBbMC4yLCAwLjc1LCAwLjU1LCAwLjddLCBzZWw6IFsxLCAwLjgyLCAwLjMsIDAuODVdLCBwYXJ0bmVyOiBbMC44NSwgMC4zNSwgMSwgMC44NV0gfVttb2RlXTtcbiAgICBtLmVtaXNzaXZlQ29sb3IgPSBuZXcgQkFCWUxPTi5Db2xvcjMoY1swXSwgY1sxXSwgY1syXSk7IG0uYWxwaGEgPSBjWzNdO1xuICB9XG4gIGxhdGVyKHNlYzogbnVtYmVyLCBmbjogKCkgPT4gdm9pZCkgeyB0aGlzLnRpbWVycy5wdXNoKHsgdDogc2VjLCBmbiB9KTsgfVxuICBwcml2YXRlIGZ4UmluZyh4OiBudW1iZXIsIHo6IG51bWJlciwgY29sb3I6IGFueSwgcjA6IG51bWJlciwgcjE6IG51bWJlciwgZHVyOiBudW1iZXIpIHtcbiAgICBjb25zdCBtID0gQkFCWUxPTi5NZXNoQnVpbGRlci5DcmVhdGVUb3J1cygnZngnLCB7IGRpYW1ldGVyOiAxLCB0aGlja25lc3M6IDAuMDM1LCB0ZXNzZWxsYXRpb246IDI4IH0sIHRoaXMuc2NlbmUpOyBtLnBvc2l0aW9uLnNldCh4LCAwLjA1LCB6KTsgbS5pc1BpY2thYmxlID0gZmFsc2U7XG4gICAgY29uc3QgbW0gPSBuZXcgQkFCWUxPTi5TdGFuZGFyZE1hdGVyaWFsKCdmeG0nLCB0aGlzLnNjZW5lKTsgbW0uZW1pc3NpdmVDb2xvciA9IGNvbG9yOyBtbS5kaXNhYmxlTGlnaHRpbmcgPSB0cnVlOyBtbS5hbHBoYSA9IDAuOTsgbS5tYXRlcmlhbCA9IG1tOyB0aGlzLnJpbmdGeC5wdXNoKHsgbSwgbW0sIHQ6IDAsIHIwLCByMSwgZHVyIH0pO1xuICB9XG4gIHByaXZhdGUgYnVyc3QoeDogbnVtYmVyLCB6OiBudW1iZXIsIGMxOiBudW1iZXJbXSwgYzI6IG51bWJlcltdLCBjb3VudDogbnVtYmVyKSB7XG4gICAgY29uc3QgcHMgPSBuZXcgQkFCWUxPTi5QYXJ0aWNsZVN5c3RlbSgnYicsIDYwLCB0aGlzLnNjZW5lKTsgcHMucGFydGljbGVUZXh0dXJlID0gdGhpcy5BLnNvZnQ7IHBzLmVtaXR0ZXIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKHgsIDAuMDUsIHopOyBwcy5taW5FbWl0Qm94ID0gbmV3IEJBQllMT04uVmVjdG9yMygtMC4yLCAwLCAtMC4yKTsgcHMubWF4RW1pdEJveCA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMC4yLCAwLjA1LCAwLjIpO1xuICAgIHBzLmNvbG9yMSA9IG5ldyBCQUJZTE9OLkNvbG9yNCguLi4oYzEgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pKTsgcHMuY29sb3IyID0gbmV3IEJBQllMT04uQ29sb3I0KC4uLihjMiBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSkpOyBwcy5jb2xvckRlYWQgPSBuZXcgQkFCWUxPTi5Db2xvcjQoMC4xLCAwLCAwLjIsIDApO1xuICAgIHBzLm1pblNpemUgPSAwLjEyOyBwcy5tYXhTaXplID0gMC4zNDsgcHMubWluTGlmZVRpbWUgPSAwLjQ7IHBzLm1heExpZmVUaW1lID0gMC45OyBwcy5lbWl0UmF0ZSA9IDA7IHBzLm1hbnVhbEVtaXRDb3VudCA9IGNvdW50OyBwcy5kaXJlY3Rpb24xID0gbmV3IEJBQllMT04uVmVjdG9yMygtMSwgMS4zLCAtMSk7IHBzLmRpcmVjdGlvbjIgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKDEsIDIuNCwgMSk7XG4gICAgcHMubWluRW1pdFBvd2VyID0gMC44OyBwcy5tYXhFbWl0UG93ZXIgPSAyOyBwcy5ncmF2aXR5ID0gbmV3IEJBQllMT04uVmVjdG9yMygwLCAtMiwgMCk7IHBzLmJsZW5kTW9kZSA9IEJBQllMT04uUGFydGljbGVTeXN0ZW0uQkxFTkRNT0RFX0FERDsgcHMudGFyZ2V0U3RvcER1cmF0aW9uID0gMS4yOyBwcy5kaXNwb3NlT25TdG9wID0gdHJ1ZTsgcHMuc3RhcnQoKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGNhbWVyYVxuICBwcml2YXRlIHBvc2VzKCkge1xuICAgIGNvbnN0IGFzcCA9IHRoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCkgLyB0aGlzLmVuZ2luZS5nZXRSZW5kZXJIZWlnaHQoKSwgdGFuViA9IE1hdGgudGFuKHRoaXMuY2FtZXJhLmZvdiAvIDIpO1xuICAgIGNvbnN0IGhhbGYgPSBGUk9OVF9YICsgKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCArIDEuNDtcbiAgICBjb25zdCBkID0gTWF0aC5tYXgoaGFsZiAvICh0YW5WICogYXNwKSwgKChHUklEX1JPV1MgKiBHUklEX1NQKSAvIDIgKyAyKSAvICh0YW5WICogMC41NSksIDgpO1xuICAgIGNvbnN0IGJhdHRsZSA9IHsgcG9zOiBuZXcgQkFCWUxPTi5WZWN0b3IzKC0wLjEgKiBkLCAwLjQyICogZCArIDAuNSwgLTAuODYgKiBkKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuMzUsIDApIH07XG4gICAgLy8gQnVpbGQgdmlldzogKGFsbW9zdCkgc3RyYWlnaHQgZG93biwgd2l0aCB0aGUgd2hvbGUgZ3JpZCBpbnNpZGUgdGhlIGJhbmQgYmV0d2VlbiB0aGUgdG9wIGJhciBhbmQgdGhlIGhhbmQgb2YgY2FyZHMuXG4gICAgY29uc3QgY3ggPSAtKEZST05UX1ggKyAoKEdSSURfQ09MUyAtIDEpICogR1JJRF9TUCkgLyAyKSwgSCA9IE1hdGgubWF4KDEsIHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCk7XG4gICAgY29uc3QgYm94ID0gKGlkOiBzdHJpbmcpID0+IHsgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7IHJldHVybiBlbCAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGwgPyBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKSA6IG51bGw7IH07XG4gICAgY29uc3QgdG9wQmFyID0gYm94KCd0b3AnKSwgaGFuZCA9IGJveCgnaGFuZCcpLCBpbmZvID0gYm94KCdpbmZvJyk7XG4gICAgY29uc3QgVE9QID0gTWF0aC5taW4oMC4zMiwgdG9wQmFyID8gKHRvcEJhci5ib3R0b20gKyA2KSAvIEggOiAwLjEpO1xuICAgIGNvbnN0IEJPVFRPTSA9IE1hdGgubWluKDAuNSwgKEggLSBNYXRoLm1pbihoYW5kID8gaGFuZC50b3AgOiBILCBpbmZvID8gaW5mby50b3AgOiBIKSArIDYpIC8gSCk7XG4gICAgY29uc3QgYmFuZCA9IE1hdGgubWF4KDAuMywgMSAtIFRPUCAtIEJPVFRPTSksIGNlbnRlckZyYWMgPSBUT1AgKyBiYW5kIC8gMjsgICAgICAgICAgLy8gdGhlIGdyaWQncyBjZW50cmUgYXBwZWFycyBhdCB0aGlzIGZyYWN0aW9uIGZyb20gdGhlIHRvcFxuICAgIGNvbnN0IGd3ID0gR1JJRF9DT0xTICogR1JJRF9TUCArIDMuMiwgZ2ggPSBHUklEX1JPV1MgKiBHUklEX1NQICsgMC41OyAgICAgICAgICAgICAgICAvLyB0aGUgd2lkdGggYWxzbyBsZWF2ZXMgcm9vbSBmb3IgdGhlIE5lY3JvbWFuY2VyIGJlc2lkZSB0aGUgZ3JpZFxuICAgIGNvbnN0IGQyID0gTWF0aC5tYXgoZ2ggLyAoMiAqIHRhblYgKiBiYW5kKSwgZ3cgLyAoMiAqIHRhblYgKiBhc3AgKiAwLjg4KSwgNC41KTtcbiAgICBjb25zdCBzaGlmdCA9ICgwLjUgLSBjZW50ZXJGcmFjKSAqIDIgKiBkMiAqIHRhblYsIGJ4ID0gY3ggLSAwLjY7XG4gICAgY29uc3QgYnVpbGQgPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMyhieCwgZDIsIC1zaGlmdCAtIDAuMSAqIGQyKSwgdGd0OiBuZXcgQkFCWUxPTi5WZWN0b3IzKGJ4LCAwLCAtc2hpZnQpIH07XG4gICAgY29uc3QgbmVjcm8gPSB7IHBvczogbmV3IEJBQllMT04uVmVjdG9yMyhiYXR0bGUucG9zLnggLSAxLjQsIGJhdHRsZS5wb3MueSAqIDEuMTIsIGJhdHRsZS5wb3MueiAqIDEuMTIpLCB0Z3Q6IG5ldyBCQUJZTE9OLlZlY3RvcjMoLTEuNCwgMC4zNSwgMCkgfTsgICAvLyByZXN1bHQgY3V0c2NlbmVzOiBoaW0gYW5kIHRoZSBmaWVsZFxuICAgIHJldHVybiB7IGJhdHRsZSwgYnVpbGQsIG5lY3JvIH07XG4gIH1cbiAgLyoqIFRoZSBoYW5kIC8gaW5mbyBiYXIgY2FuIGNoYW5nZSBzaXplIGluIHRoZSBidWlsZCBwaGFzZSAobG9uZyBhYmlsaXR5IHRleHQsIG1vcmUgY2FyZHMpOiByZS1mcmFtZSBzbyB0aGUgZ3JpZCBuZXZlciBoaWRlcyBiZWhpbmQgaXQuICovXG4gIHJlZnJhbWVCdWlsZCgpIHtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCB0aGlzLmNhbVQgPCAxIHx8IHRoaXMuY2luZSB8fCAhdGhpcy5jYW52YXMpIHJldHVybjtcbiAgICBjb25zdCBwID0gdGhpcy5wb3NlcygpLmJ1aWxkLCBjID0gdGhpcy5jYW1lcmEucG9zaXRpb247XG4gICAgaWYgKCFpc0Zpbml0ZShwLnBvcy54KSB8fCBCQUJZTE9OLlZlY3RvcjMuRGlzdGFuY2UoYywgcC5wb3MpIDwgMC4wNikgcmV0dXJuO1xuICAgIHRoaXMudHdlZW5DYW0ocCwgMC4zNSk7XG4gIH1cbiAgcHJpdmF0ZSBjYW52YXMhOiBIVE1MQ2FudmFzRWxlbWVudDsgcHJpdmF0ZSBsYXN0VyA9IDA7IHByaXZhdGUgbGFzdEggPSAwOyBsYXN0VGFwSW5mbyA9ICcobm8gdGFwcyB5ZXQpJztcbiAgcHJpdmF0ZSBoYW5kbGVSZXNpemUoKSB7XG4gICAgaWYgKCF0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCB8fCAhdGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0KSByZXR1cm47ICAgLy8gaGlkZGVuIGJlaGluZCBhbm90aGVyIHRhYlxuICAgIHRoaXMuZW5naW5lLnJlc2l6ZSgpOyB0aGlzLmxhc3RXID0gdGhpcy5jYW52YXMuY2xpZW50V2lkdGg7IHRoaXMubGFzdEggPSB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgaWYgKHRoaXMucGhhc2UgPT09ICdidWlsZCcgJiYgdGhpcy5jYW1UID49IDEpIHRoaXMuc2V0Q2FtKHRoaXMucG9zZXMoKS5idWlsZCk7XG4gIH1cbiAgLyoqIEEgdGFwIG9uIHRoZSAzRCB2aWV3OiBwaWNrIGEgdGlsZSBvciBhIHVuaXQuICovXG4gIHByaXZhdGUgdGFwKHg6IG51bWJlciwgeTogbnVtYmVyKSB7XG4gICAgY29uc3QgcCA9IHRoaXMuc2NlbmUucGljayh4LCB5LCAobTogYW55KSA9PiAhIShtLm1ldGFkYXRhICYmIG0ubWV0YWRhdGEua2luZCkpO1xuICAgIGNvbnN0IG1kID0gcCAmJiBwLmhpdCA/IHAucGlja2VkTWVzaC5tZXRhZGF0YSA6IG51bGw7XG4gICAgdGhpcy5sYXN0VGFwSW5mbyA9IGB0YXAgJHtNYXRoLnJvdW5kKHgpfSwke01hdGgucm91bmQoeSl9IG9mICR7dGhpcy5jYW52YXMuY2xpZW50V2lkdGh9eCR7dGhpcy5jYW52YXMuY2xpZW50SGVpZ2h0fSAtPiAke21kID8gKG1kLmtpbmQgPT09ICd0aWxlJyA/ICd0aWxlICcgKyBtZC5jZWxsIDogJ3VuaXQnKSA6ICdub3RoaW5nJ30gKHBoYXNlICR7dGhpcy5waGFzZX0pYDtcbiAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyB8fCAhbWQpIHJldHVybjtcbiAgICBpZiAobWQua2luZCA9PT0gJ3RpbGUnKSB0aGlzLm9uVGlsZShtZC5jZWxsKTsgZWxzZSBpZiAobWQua2luZCA9PT0gJ3VuaXQnKSB0aGlzLm9uVW5pdFZpc3VhbChtZC52aXN1YWwpO1xuICB9XG4gIHByaXZhdGUgc2V0Q2FtKHA6IGFueSkgeyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5jb3B5RnJvbShwLnBvcyk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChwLnRndC5jbG9uZSgpKTsgfVxuICBwcml2YXRlIHR3ZWVuQ2FtKHRvOiBhbnksIGR1cjogbnVtYmVyKSB7IHRoaXMuY2FtRnJvbSA9IHsgcG9zOiB0aGlzLmNhbWVyYS5wb3NpdGlvbi5jbG9uZSgpLCB0Z3Q6IHRoaXMuY2FtZXJhLmdldFRhcmdldCgpLmNsb25lKCkgfTsgdGhpcy5jYW1UbyA9IHRvOyB0aGlzLmNhbVQgPSAwOyB0aGlzLmNhbUR1ciA9IGR1cjsgfVxuXG4gIC8vIC0tLS0gYmF0dGxlIGNhbWVyYTogZm9sbG93cyB0aGUgZmlnaHRlcnMgdGhhdCBhcmUgc3RpbGwgYWxpdmUsIHNvIHRoZSBhY3Rpb24gKGFuZCB0aGUgcHVycGxlIGV5ZXMpIHN0YXlzIGxhcmdlIG9uIHNjcmVlblxuICBjYW1Nb2RlOiAnY2xvc2UnIHwgJ3dpZGUnID0gJ2Nsb3NlJzsgcHJpdmF0ZSBjYW1UZ3Q6IGFueSA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoMCwgMC41LCAwKTtcbiAgc2V0Q2FtTW9kZShtOiAnY2xvc2UnIHwgJ3dpZGUnKSB7XG4gICAgdGhpcy5jYW1Nb2RlID0gbTtcbiAgICBpZiAobSA9PT0gJ3dpZGUnICYmIHRoaXMuYmF0dGxlKSB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDAuOSk7XG4gICAgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICBwcml2YXRlIGZyYW1lQmF0dGxlKGR0OiBudW1iZXIpIHtcbiAgICBjb25zdCBiID0gdGhpcy5iYXR0bGU7IGlmICghYikgcmV0dXJuOyBjb25zdCBhbGl2ZSA9IGIuZmlnaHRlcnMuZmlsdGVyKChmKSA9PiBmLmFsaXZlKTsgaWYgKCFhbGl2ZS5sZW5ndGgpIHJldHVybjtcbiAgICBsZXQgeDAgPSAxZTksIHgxID0gLTFlOSwgejAgPSAxZTksIHoxID0gLTFlOTsgZm9yIChjb25zdCBmIG9mIGFsaXZlKSB7IHgwID0gTWF0aC5taW4oeDAsIGYueCk7IHgxID0gTWF0aC5tYXgoeDEsIGYueCk7IHowID0gTWF0aC5taW4oejAsIGYueik7IHoxID0gTWF0aC5tYXgoejEsIGYueik7IH1cbiAgICBjb25zdCBhc3AgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpIC8gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHRhblYgPSBNYXRoLnRhbih0aGlzLmNhbWVyYS5mb3YgLyAyKTtcbiAgICBjb25zdCB3aWRlID0gdGhpcy5wb3NlcygpLmJhdHRsZSwgY3ggPSAoeDAgKyB4MSkgLyAyLCBjeiA9ICh6MCArIHoxKSAvIDI7XG4gICAgY29uc3QgZCA9IE1hdGgubWluKE1hdGgubWF4KCh4MSAtIHgwICsgMy40KSAvICgyICogdGFuViAqIGFzcCAqIDAuOSksICh6MSAtIHowICsgMy4yKSAvICgyICogdGFuViAqIDAuNjIpLCA1LjQpLCBNYXRoLmh5cG90KHdpZGUucG9zLnksIHdpZGUucG9zLnopKTtcbiAgICBjb25zdCB0Z3QgPSBuZXcgQkFCWUxPTi5WZWN0b3IzKGN4LCAwLjU1LCBjeiksIHBvcyA9IG5ldyBCQUJZTE9OLlZlY3RvcjMoY3ggLSAwLjA2ICogZCwgMC4zMiAqIGQgKyAwLjUsIGN6IC0gMC45ICogZCk7XG4gICAgY29uc3QgayA9IDEgLSBNYXRoLmV4cCgtZHQgKiAyLjApO1xuICAgIHRoaXMuY2FtZXJhLnBvc2l0aW9uID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1lcmEucG9zaXRpb24sIHBvcywgayk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1UZ3QsIHRndCwgayk7IHRoaXMuY2FtZXJhLnNldFRhcmdldCh0aGlzLmNhbVRndC5jbG9uZSgpKTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHN0YWdlIGZsb3dcbiAgLyoqIFdyaXRlIHRoZSBydW4gdG8gZGlzayAoY2FsbSBtb21lbnRzIG9ubHk6IGJ1aWxkIHBoYXNlIGFuZCB0aGUgdmljdG9yeSBkcmFmdCkuICovXG4gIHByaXZhdGUgcGVyc2lzdFJ1bigpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzKSByZXR1cm47XG4gICAgICBpZiAocy5zdGF0dXMgIT09ICdidWlsZGluZycpIHsgY2xlYXJSdW4oKTsgcmV0dXJuOyB9XG4gICAgICBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJyAmJiB0aGlzLnBoYXNlICE9PSAnZHJhZnQnKSByZXR1cm47XG4gICAgICBjb25zdCBzbmFwOiBSdW5TbmFwc2hvdCA9IHsgdjogMSwgc2VlZDogdGhpcy5zZWVkLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIHN0YWdlOiBjdXJyZW50U3RhZ2VJZCwgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUsIHBoYXNlOiB0aGlzLnBoYXNlLCBkcmFmdDogdGhpcy5waGFzZSA9PT0gJ2RyYWZ0JyA/IHRoaXMuZHJhZnQgOiBudWxsLCBzdGF0ZTogc2VyaWFsaXplU3RhdGUocyksIHN0YXJ0QmVzdDogdGhpcy5lbmRsZXNzPy5zdGFydEJlc3QgfTtcbiAgICAgIHNhdmVSdW4oc25hcCk7XG4gICAgfSBjYXRjaCB7IC8qIG5ldmVyIGxldCBzYXZpbmcgYnJlYWsgdGhlIGdhbWUgKi8gfVxuICB9XG4gIC8qKiBSZWJ1aWxkIHRoZSBzY3JlZW4gZnJvbSBhIHNhdmVkIHJ1biAoYSByZWxvYWQsIG9yIFNhZmFyaSBkaXNjYXJkaW5nIHRoZSBwYWdlKS4gKi9cbiAgcHJpdmF0ZSByZXN0b3JlKHI6IHsgc25hcDogUnVuU25hcHNob3Q7IHN0YXRlOiBTdGF0ZSB9KSB7XG4gICAgY29uc3QgeyBzbmFwLCBzdGF0ZSB9ID0gcjtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5mbHVzaFR3ZWVucygpOyB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIHRoaXMuZGFpbHkgPSBudWxsO1xuICAgIGlmIChzbmFwLnN0YWdlID09PSBEQUlMWV9JRCAmJiBpc1ZhbGlkRGF5KCtzbmFwLmRpZmZpY3VsdHkpKSB7IGNvbnN0IGRheSA9ICtzbmFwLmRpZmZpY3VsdHksIG1vZCA9IG1vZGlmaWVyRm9yKGRheSk7IHNldERhaWx5KG1vZCwgZGF5KTsgdGhpcy5kYWlseSA9IHsgZGF5LCBtb2QgfTsgdGhpcy5lbmRsZXNzID0gbnVsbDsgdGhpcy5hcmVuYS5zZXRUaGVtZSgnY3J5cHQnKTsgfVxuICAgIGVsc2UgaWYgKHNuYXAuc3RhZ2UgPT09IEVORExFU1NfSUQpIHsgc2V0RW5kbGVzcygpOyBjb25zdCBkb25lID0gTWF0aC5tYXgoMCwgc3RhdGUud2F2ZSAtIDEpOyB0aGlzLmVuZGxlc3MgPSB7IHN0YXJ0QmVzdDogc25hcC5zdGFydEJlc3QgPz8gbG9hZFNhdmUoKS5lbmRsZXNzLmJlc3QsIGNsZWFyZWQ6IGRvbmUsIHBhY2tzOiBNYXRoLmZsb29yKGRvbmUgLyBFTkRMRVNTX1BBQ0tfRVZFUlkpIH07IH0gZWxzZSB7IHNldFN0YWdlRGlmZmljdWx0eShzbmFwLnN0YWdlLCBzbmFwLmRpZmZpY3VsdHkpOyB0aGlzLmVuZGxlc3MgPSBudWxsOyB9XG4gICAgaWYgKCF0aGlzLmRhaWx5KSB0aGlzLmFyZW5hLnNldFRoZW1lKGN1cnJlbnRTdGFnZUlkKTtcbiAgICB0aGlzLnNlZWQgPSBzbmFwLnNlZWQ7IHRoaXMuYXR0ZW1wdCA9IHNuYXAuYXR0ZW1wdDsgdGhpcy5zID0gc3RhdGU7IHRoaXMuc2Vlbk1lcmdlcyA9IHN0YXRlLnN0YXRzLm1lcmdlcztcbiAgICB0aGlzLmNsZWFyQmF0dGxlKCk7IFsuLi50aGlzLnVuaXRWaXMudmFsdWVzKCldLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdGhpcy51bml0VmlzLmNsZWFyKCk7IHRoaXMudmlzVG9Vbml0LmNsZWFyKCk7XG4gICAgdGhpcy5zZWwgPSBudWxsOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IHRoaXMuZHJhZnQgPSBzbmFwLnBoYXNlID09PSAnZHJhZnQnID8gc25hcC5kcmFmdCA6IG51bGw7IHRoaXMucGhhc2UgPSB0aGlzLmRyYWZ0ID8gJ2RyYWZ0JyA6ICdidWlsZCc7IHRoaXMuc2hvd0dyaWQodGhpcy5waGFzZSA9PT0gJ2J1aWxkJyk7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdChgUnVuIHJlc3RvcmVkOiB3YXZlICR7aXNFbmRsZXNzKCkgPyBzdGF0ZS53YXZlIDogc3RhdGUud2F2ZSArICcvJyArIHN0YWdlV2F2ZXMoc3RhdGUpfSwgJHtzdGF0ZS5oZWFydHN9IGhlYXJ0JHtzdGF0ZS5oZWFydHMgPT09IDEgPyAnJyA6ICdzJ30uYCk7XG4gIH1cblxuICAvLyAtLS0tIHBlcmZvcm1hbmNlIHJlYWRvdXQ6IHJvbGxpbmcgZnJhbWUgc3RhdHMsIHBlci1iYXR0bGUgc3VtbWFyaWVzLCBvcHRpb25hbCBvbi1zY3JlZW4gRlBTLCBhbmQgYSBwYXN0ZS1mcmllbmRseSByZXBvcnRcbiAgc2hvd0ZwcyA9IGZhbHNlOyBwZXJmTm93ID0geyBmcHM6IDAsIGF2ZzogMCwgcDk1OiAwLCB3b3JzdDogMCB9OyBwZXJmTG9nOiBhbnlbXSA9IFtdO1xuICBwcml2YXRlIHBlcmZCdWYgPSBuZXcgRmxvYXQzMkFycmF5KDI0MCk7IHByaXZhdGUgcGVyZk4gPSAwOyBwcml2YXRlIHBlcmZJID0gMDsgcHJpdmF0ZSBwZXJmU2hvd25BdCA9IDA7IHByaXZhdGUgaW5zdHI6IGFueSA9IG51bGw7IHByaXZhdGUgZnBzSHVkOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGN1ckJhdHRsZTogeyBmcmFtZXM6IG51bWJlcjsgc3VtOiBudW1iZXI7IHdvcnN0OiBudW1iZXI7IHNsb3c6IG51bWJlcjsgc2NhbGU6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIHNldFNob3dGcHMob246IGJvb2xlYW4pIHtcbiAgICB0aGlzLnNob3dGcHMgPSBvbjtcbiAgICBpZiAob24gJiYgIXRoaXMuZnBzSHVkKSB7IGNvbnN0IGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgaC5pZCA9ICdmcHNIdWQnOyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JhdHRsZUhvc3QnKSB8fCBkb2N1bWVudC5ib2R5KS5hcHBlbmRDaGlsZChoKTsgdGhpcy5mcHNIdWQgPSBoOyB9XG4gICAgaWYgKHRoaXMuZnBzSHVkKSB0aGlzLmZwc0h1ZC5zdHlsZS5kaXNwbGF5ID0gb24gPyAnYmxvY2snIDogJ25vbmUnO1xuICB9XG4gIHByaXZhdGUgcGVyZlRpY2sobXM6IG51bWJlcikge1xuICAgIGlmIChtcyA+IDUwMCkgcmV0dXJuOyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgdGFiIHdhcyBoaWRkZW4gb3IgdGhlIHBob25lIHBhdXNlZCB1czogbm90IGEgcmVhbCBmcmFtZVxuICAgIHRoaXMucGVyZkJ1Zlt0aGlzLnBlcmZJXSA9IG1zOyB0aGlzLnBlcmZJID0gKHRoaXMucGVyZkkgKyAxKSAlIHRoaXMucGVyZkJ1Zi5sZW5ndGg7IHRoaXMucGVyZk4gPSBNYXRoLm1pbih0aGlzLnBlcmZCdWYubGVuZ3RoLCB0aGlzLnBlcmZOICsgMSk7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlO1xuICAgIGlmIChjICYmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyB8fCB0aGlzLnBoYXNlID09PSAndHJhbnNpdGlvbicpKSB7IGMuZnJhbWVzKys7IGMuc3VtICs9IG1zOyBpZiAobXMgPiBjLndvcnN0KSBjLndvcnN0ID0gbXM7IGlmIChtcyA+IDMzLjQpIGMuc2xvdysrOyBjLnNjYWxlID0gTWF0aC5tYXgoYy5zY2FsZSwgdGhpcy50aW1lU2NhbGUpOyB9XG4gICAgY29uc3Qgbm93ID0gcGVyZm9ybWFuY2Uubm93KCk7IGlmIChub3cgLSB0aGlzLnBlcmZTaG93bkF0IDwgNTAwKSByZXR1cm47IHRoaXMucGVyZlNob3duQXQgPSBub3c7XG4gICAgY29uc3QgYSA9IEFycmF5LmZyb20odGhpcy5wZXJmQnVmLnN1YmFycmF5KDAsIHRoaXMucGVyZk4pKS5zb3J0KCh4LCB5KSA9PiB4IC0geSksIGF2ZyA9IGEucmVkdWNlKChuLCB4KSA9PiBuICsgeCwgMCkgLyBhLmxlbmd0aDtcbiAgICB0aGlzLnBlcmZOb3cgPSB7IGZwczogMTAwMCAvIGF2ZywgYXZnLCBwOTU6IGFbTWF0aC5mbG9vcihhLmxlbmd0aCAqIDAuOTUpXSA/PyAwLCB3b3JzdDogYVthLmxlbmd0aCAtIDFdID8/IDAgfTtcbiAgICBpZiAodGhpcy5mcHNIdWQgJiYgdGhpcy5zaG93RnBzKSB0aGlzLmZwc0h1ZC50ZXh0Q29udGVudCA9IGAke3RoaXMucGVyZk5vdy5mcHMudG9GaXhlZCgwKX0gZnBzICAke3RoaXMucGVyZk5vdy5hdmcudG9GaXhlZCgxKX1tcyAgc2xvdzUlICR7dGhpcy5wZXJmTm93LnA5NS50b0ZpeGVkKDApfW1zYDtcbiAgICB0aGlzLnVpLnJlbmRlckRlYnVnTGl2ZSgpO1xuICB9XG4gIHByaXZhdGUgYmVnaW5CYXR0bGVQZXJmKCkgeyB0aGlzLmN1ckJhdHRsZSA9IHsgZnJhbWVzOiAwLCBzdW06IDAsIHdvcnN0OiAwLCBzbG93OiAwLCBzY2FsZTogdGhpcy50aW1lU2NhbGUgfTsgfVxuICBwcml2YXRlIGVuZEJhdHRsZVBlcmYoKSB7XG4gICAgY29uc3QgYyA9IHRoaXMuY3VyQmF0dGxlOyB0aGlzLmN1ckJhdHRsZSA9IG51bGw7IGlmICghYyB8fCAhYy5mcmFtZXMpIHJldHVybjtcbiAgICB0aGlzLnBlcmZMb2cucHVzaCh7IHdhdmU6IHRoaXMucy53YXZlLCBhdHRlbXB0OiB0aGlzLmF0dGVtcHQsIHNwZWVkOiBjLnNjYWxlLCBmaWdodGVyczogdGhpcy5iYXR0bGUgPyB0aGlzLmJhdHRsZS5maWdodGVycy5sZW5ndGggOiAwLCBmcHM6ICsoMTAwMCAvIChjLnN1bSAvIGMuZnJhbWVzKSkudG9GaXhlZCgwKSwgd29yc3RNczogK2Mud29yc3QudG9GaXhlZCgwKSwgc2xvd1BjdDogKygoMTAwICogYy5zbG93KSAvIGMuZnJhbWVzKS50b0ZpeGVkKDEpIH0pO1xuICAgIGlmICh0aGlzLnBlcmZMb2cubGVuZ3RoID4gMTIpIHRoaXMucGVyZkxvZy5zaGlmdCgpO1xuICB9XG4gIHBlcmZJbmZvKCkge1xuICAgIGNvbnN0IHNjID0gdGhpcy5zY2VuZTsgaWYgKCF0aGlzLmluc3RyICYmIEJBQllMT04uU2NlbmVJbnN0cnVtZW50YXRpb24pIHRoaXMuaW5zdHIgPSBuZXcgQkFCWUxPTi5TY2VuZUluc3RydW1lbnRhdGlvbihzYyk7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5wZXJmTm93LCBtZXNoZXM6IHNjLmdldEFjdGl2ZU1lc2hlcygpLmxlbmd0aCwgcGFydGljbGVzOiBzYy5wYXJ0aWNsZVN5c3RlbXMubGVuZ3RoLCBkcmF3czogdGhpcy5pbnN0ciA/IHRoaXMuaW5zdHIuZHJhd0NhbGxzQ291bnRlci5jdXJyZW50IDogLTEgfTtcbiAgfVxuICBwZXJmUmVwb3J0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgcCA9IHRoaXMucGVyZkluZm8oKSwgZ2w6IGFueSA9IHRoaXMuZW5naW5lLmdldEdsSW5mbyA/IHRoaXMuZW5naW5lLmdldEdsSW5mbygpIDoge307XG4gICAgY29uc3Qgcm93cyA9IHRoaXMucGVyZkxvZy5tYXAoKHIpID0+IGAgIHdhdmUgJHtyLndhdmV9IHRyeSAke3IuYXR0ZW1wdH0gYXQgJHtyLnNwZWVkfXg6ICR7ci5mcHN9IGZwcyBhdmVyYWdlLCB3b3JzdCBmcmFtZSAke3Iud29yc3RNc31tcywgJHtyLnNsb3dQY3R9JSBzbG93IGZyYW1lcywgJHtyLmZpZ2h0ZXJzfSBmaWdodGVyc2ApO1xuICAgIHJldHVybiBbYFBFUkYgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9YCwgYGRldmljZTogJHtuYXZpZ2F0b3IudXNlckFnZW50fWAsIGBncHU6ICR7Z2wucmVuZGVyZXIgfHwgJz8nfSAoJHtnbC52ZW5kb3IgfHwgJz8nfSlgLFxuICAgICAgYHNjcmVlbiAke3NjcmVlbi53aWR0aH14JHtzY3JlZW4uaGVpZ2h0fSAgdmlld3BvcnQgJHtpbm5lcldpZHRofXgke2lubmVySGVpZ2h0fSAgZHByICR7ZGV2aWNlUGl4ZWxSYXRpb30gIHJlbmRlciAke3RoaXMuZW5naW5lLmdldFJlbmRlcldpZHRoKCl9eCR7dGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCl9ICBzY2FsaW5nIGxldmVsICR7dGhpcy5lbmdpbmUuZ2V0SGFyZHdhcmVTY2FsaW5nTGV2ZWwoKS50b0ZpeGVkKDIpfWAsXG4gICAgICBgbm93OiAke3AuZnBzLnRvRml4ZWQoMCl9IGZwcywgYXZlcmFnZSAke3AuYXZnLnRvRml4ZWQoMSl9bXMsIHNsb3dlc3QgNSUgJHtwLnA5NS50b0ZpeGVkKDApfW1zLCB3b3JzdCAke3Aud29yc3QudG9GaXhlZCgwKX1tcyB8IGFjdGl2ZSBtZXNoZXMgJHtwLm1lc2hlc30sIHBhcnRpY2xlIHN5c3RlbXMgJHtwLnBhcnRpY2xlc30sIGRyYXcgY2FsbHMgJHtwLmRyYXdzfWAsXG4gICAgICBgc3RhdGU6IHBoYXNlICR7dGhpcy5waGFzZX0sIHNwZWVkICR7dGhpcy50aW1lU2NhbGV9eCwgY2FtZXJhICR7dGhpcy5jYW1Nb2RlfSwgZGlmZmljdWx0eSAke2RpZmZpY3VsdHlOYW1lfSwgd2F2ZSAke3RoaXMucy53YXZlfSwgdW5pdHMgJHt0aGlzLnMudW5pdHMubGVuZ3RofWAsXG4gICAgICBgYmF0dGxlcyAobmV3ZXN0IGxhc3QpOmAsIC4uLihyb3dzLmxlbmd0aCA/IHJvd3MgOiBbJyAgKG5vbmUgeWV0OiBwbGF5IGEgYmF0dGxlLCB0aGVuIGNvcHkgdGhpcyBhZ2FpbiknXSldLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgLyoqIEEgcnVuIHRoZSBwbGF5ZXIgaGFzIHJlYWxseSBzdGFydGVkIChzbyBIb21lIGNhbiBvZmZlciBDb250aW51ZSkuIE51bGwgYWZ0ZXIgYSBzdGFnZSB3YXMgd29uIG9yIGxvc3QsIG9yIGJlZm9yZSBhbnl0aGluZyB3YXMgZG9uZS4gKi9cbiAgcnVuSW5mbygpIHsgY29uc3QgcyA9IHRoaXMuczsgaWYgKCFzIHx8IHMuc3RhdHVzICE9PSAnYnVpbGRpbmcnKSByZXR1cm4gbnVsbDsgcmV0dXJuIChzLndhdmUgPiAxIHx8IHMudW5pdHMubGVuZ3RoID4gMCB8fCB0aGlzLmF0dGVtcHQgPiAwIHx8IHMuc3RhdHMuZmFpbHVyZXMgPiAwKSA/IHsgd2F2ZTogcy53YXZlLCB0b3RhbDogc3RhZ2VXYXZlcyhzKSwgaGVhcnRzOiBzLmhlYXJ0cywgZGlmZmljdWx0eTogZGlmZmljdWx0eU5hbWUsIHN0YWdlOiBjdXJyZW50U3RhZ2VJZCB9IDogbnVsbDsgfVxuICAvKiogRnJlc2ggcnVuIHdpdGggdGhlIGN1cnJlbnRseSBlcXVpcHBlZCBTb3VsIERlY2sgKEhvbWUgPiBTdGFydCBCYXR0bGUgY2FsbHMgdGhpcykuICovXG4gIC8qKiBHaXZlIHVwIHRoZSBydW4gaW4gcHJvZ3Jlc3MgKEhvbWUgPiBOZXcgYmF0dGxlLCBhZnRlciB0aGUgcGxheWVyIGNvbmZpcm1zKTogdGhlIHNhdmVkIHJ1biBpcyBkcm9wcGVkIGFuZCBIb21lIGxldHMgdGhlbSBwaWNrIGFueSBzdGFnZSBvciBtb2RlLiBHb2xkIGFuZCBwYWNrcyBhbHJlYWR5IGVhcm5lZCBzdGF5LiAqL1xuICBhYmFuZG9uUnVuKCkgeyB0aGlzLnN0YXJ0U3RhZ2UoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMWU2KSArIDEpOyBjbGVhclJ1bigpOyB9XG4gIG5ld1J1bigpIHsgdGhpcy5zdGFydFN0YWdlKG5ldyBVUkxTZWFyY2hQYXJhbXMobG9jYXRpb24uc2VhcmNoKS5nZXQoJ3NlZWQnKSA/IHRoaXMuc2VlZCA6IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDFlNikgKyAxKTsgfVxuICBzdGFydFN0YWdlKHNlZWQ6IG51bWJlcikge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLnJld2FyZCA9IG51bGw7IHRoaXMuZmx1c2hUd2VlbnMoKTsgaWYgKHRoaXMubmVjcm8pIHRoaXMubmVjcm8ucmV2aXZlKCk7XG4gICAgdGhpcy5ydW5Hb2xkID0gMDsgdGhpcy5sYXN0R29sZCA9IDA7IHRoaXMuZGFpbHkgPSBudWxsOyB0aGlzLmRhaWx5UmV3YXJkID0gbnVsbDsgdGhpcy5zZWVkID0gc2VlZDsgdGhpcy5hdHRlbXB0ID0gMDsgdGhpcy5lbmRsZXNzID0gbnVsbDsgY29uc3Qgc3YgPSBsb2FkU2F2ZSgpLCBwbCA9IHBsYXlhYmxlKHN2KTsgc2V0U3RhZ2VEaWZmaWN1bHR5KHBsLnN0YWdlLCBwbC5kaWZmaWN1bHR5KTsgdGhpcy5hcmVuYS5zZXRUaGVtZShjdXJyZW50U3RhZ2VJZCk7IHRoaXMucyA9IG5ld1N0YWdlKHsgLi4uUFJPVE9UWVBFX1JVTEVTLCBwb29sOiBzdi5kZWNrIH0sIHNlZWQpOyB0aGlzLnNlZW5NZXJnZXMgPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgdGhpcy5zaG93R3JpZCh0cnVlKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTsgICAvLyAoYSBiYXR0bGUgbGVmdCBoYWxmLXdheSBoYWQgaGlkZGVuIHRoZSBncmlkKVxuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdCgnU3RhZ2Ugc3RhcnQ6IDQgY2FyZHMsICcgKyB0aGlzLnMuY2FwICsgJyBEb21pbmlvbi4gU3VtbW9uLCBtZXJnZSwgdGhlbiBwcmVzcyBCQVRUTEUuJyk7XG4gIH1cbiAgLyoqIFRvZGF5J3MgRGFpbHkgQ2hhbGxlbmdlIChIb21lID4gRGFpbHkgQ2hhbGxlbmdlKTogdGhlIHNhbWUgc2VlZCBhbmQgdHdpc3QgZm9yIGV2ZXJ5b25lIG9uIHRoZSBzYW1lIGRheS4gUmV0cnkgYXMgb2Z0ZW4gYXMgeW91IGxpa2U7IHRoZSByZXdhcmQgaXMgcGFpZCBvbmNlLiAqL1xuICBuZXdEYWlseSgpIHsgdGhpcy5zdGFydERhaWx5KGRheU51bWJlcigpKTsgfVxuICBzdGFydERhaWx5KGRheTogbnVtYmVyKSB7XG4gICAgdGhpcy5jaW5lID0gZmFsc2U7IHRoaXMucmV3YXJkID0gbnVsbDsgdGhpcy5mbHVzaFR3ZWVucygpOyBpZiAodGhpcy5uZWNybykgdGhpcy5uZWNyby5yZXZpdmUoKTtcbiAgICBjb25zdCBtb2QgPSBtb2RpZmllckZvcihkYXkpLCBzdiA9IGxvYWRTYXZlKCk7IHNldERhaWx5KG1vZCwgZGF5KTsgdGhpcy5hcmVuYS5zZXRUaGVtZSgnY3J5cHQnKTtcbiAgICB0aGlzLnJ1bkdvbGQgPSAwOyB0aGlzLmxhc3RHb2xkID0gMDsgdGhpcy5kYWlseVJld2FyZCA9IG51bGw7IHRoaXMuZW5kbGVzcyA9IG51bGw7IHRoaXMuZGFpbHkgPSB7IGRheSwgbW9kIH07IHRoaXMuc2VlZCA9IGRheTsgdGhpcy5hdHRlbXB0ID0gMDtcbiAgICB0aGlzLnMgPSBuZXdTdGFnZShkYWlseVJ1bGVzKG1vZCwgc3YuZGVjayksIHRoaXMuc2VlZCk7IHRoaXMuc2Vlbk1lcmdlcyA9IDA7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpOyBbLi4udGhpcy51bml0VmlzLnZhbHVlcygpXS5mb3JFYWNoKCh2KSA9PiB2LmRpc3Bvc2UoKSk7IHRoaXMudW5pdFZpcy5jbGVhcigpOyB0aGlzLnZpc1RvVW5pdC5jbGVhcigpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdChgRGFpbHkgQ2hhbGxlbmdlOiAke21vZC5uYW1lfS4gJHttb2QudGV4dH1gKTtcbiAgfVxuICAvKiogRnJlc2ggRW5kbGVzcyBEZXB0aHMgcnVuIChIb21lID4gRW5kbGVzcyBEZXB0aHMgY2FsbHMgdGhpcyk6IHNhbWUgcnVsZXMgYXMgYSBzdGFnZSwgYnV0IHRoZSB3YXZlcyBuZXZlciBzdG9wIGFuZCB0aGUgZW5lbXkga2VlcHMgZ3Jvd2luZy4gKi9cbiAgbmV3RW5kbGVzcygpIHsgdGhpcy5zdGFydEVuZGxlc3MobmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpLmdldCgnc2VlZCcpID8gdGhpcy5zZWVkIDogTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMWU2KSArIDEpOyB9XG4gIHN0YXJ0RW5kbGVzcyhzZWVkOiBudW1iZXIpIHtcbiAgICB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5yZXdhcmQgPSBudWxsOyB0aGlzLmZsdXNoVHdlZW5zKCk7IGlmICh0aGlzLm5lY3JvKSB0aGlzLm5lY3JvLnJldml2ZSgpO1xuICAgIHRoaXMucnVuR29sZCA9IDA7IHRoaXMubGFzdEdvbGQgPSAwOyB0aGlzLmRhaWx5ID0gbnVsbDsgdGhpcy5kYWlseVJld2FyZCA9IG51bGw7IHRoaXMuc2VlZCA9IHNlZWQ7IHRoaXMuYXR0ZW1wdCA9IDA7IGNvbnN0IHN2ID0gbG9hZFNhdmUoKTsgc2V0RW5kbGVzcygpOyB0aGlzLmFyZW5hLnNldFRoZW1lKEVORExFU1NfSUQpO1xuICAgIHRoaXMuZW5kbGVzcyA9IHsgc3RhcnRCZXN0OiBzdi5lbmRsZXNzLmJlc3QsIGNsZWFyZWQ6IDAsIHBhY2tzOiAwIH07XG4gICAgdGhpcy5zID0gbmV3U3RhZ2UoeyAuLi5FTkRMRVNTX1JVTEVTLCBwb29sOiBzdi5kZWNrIH0sIHNlZWQpOyB0aGlzLnNlZW5NZXJnZXMgPSAwO1xuICAgIHRoaXMuY2xlYXJCYXR0bGUoKTsgdGhpcy5zaG93R3JpZCh0cnVlKTsgWy4uLnRoaXMudW5pdFZpcy52YWx1ZXMoKV0uZm9yRWFjaCgodikgPT4gdi5kaXNwb3NlKCkpOyB0aGlzLnVuaXRWaXMuY2xlYXIoKTsgdGhpcy52aXNUb1VuaXQuY2xlYXIoKTsgICAvLyAoYSBiYXR0bGUgbGVmdCBoYWxmLXdheSBoYWQgaGlkZGVuIHRoZSBncmlkKVxuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmRyYWZ0ID0gbnVsbDsgdGhpcy5waGFzZSA9ICdidWlsZCc7XG4gICAgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgdGhpcy5zZXRDYW0odGhpcy5wb3NlcygpLmJ1aWxkKTsgdGhpcy50b2FzdCgnRW5kbGVzcyBEZXB0aHM6IGhvdyBkZWVwIGNhbiB5b3UgZ28/IEEgU291bCBQYWNrIGV2ZXJ5IDEwIHdhdmVzLicpO1xuICB9XG4gIHByaXZhdGUgY2xlYXJCYXR0bGUoKSB7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LmRpc3Bvc2UoKTsgfSk7IHRoaXMuZnZpcy5jbGVhcigpOyB0aGlzLmZVbml0LmNsZWFyKCk7IHRoaXMubGFzdFN0YXRlLmNsZWFyKCk7IHRoaXMuYmF0dGxlID0gbnVsbDtcbiAgICB0aGlzLmFycm93cy5mb3JFYWNoKChhKSA9PiBhLm1lc2guZGlzcG9zZSgpKTsgdGhpcy5hcnJvd3MgPSBbXTtcbiAgfVxuICBwcml2YXRlIHBvcyhjZWxsOiBudW1iZXIpIHsgcmV0dXJuIGNlbGxQb3MoMCwgY2VsbCk7IH1cbiAgLyoqIEZvciB0aGUgdHV0b3JpYWwgc3BvdGxpZ2h0OiB3aGVyZSBhbiBlbXB0eSB0aWxlICh0aGUgb25lIG5lYXJlc3QgdGhlIG1pZGRsZSBvZiB0aGUgZ3JpZCkgaXMgb24gdGhlIHNjcmVlbiwgaW4gQ1NTIHBpeGVscywgb3IgbnVsbC4gKi9cbiAgZW1wdHlUaWxlUmVjdCgpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB3OiBudW1iZXI7IGg6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgaWYgKCF0aGlzLnMgfHwgIXRoaXMuY2FudmFzIHx8IHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHVzZWQgPSBuZXcgU2V0KHRoaXMucy51bml0cy5tYXAoKHU6IGFueSkgPT4gdS5jZWxsKSk7IGxldCBteCA9IDAsIG16ID0gMDsgY29uc3QgYWxsID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogR1JJRF9DRUxMUyB9LCAoXywgYykgPT4gdGhpcy5wb3MoYykpOyBhbGwuZm9yRWFjaCgocCkgPT4geyBteCArPSBwLnggLyBHUklEX0NFTExTOyBteiArPSBwLnogLyBHUklEX0NFTExTOyB9KTtcbiAgICBsZXQgYmVzdCA9IC0xLCBiZCA9IDFlOTsgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHsgaWYgKHVzZWQuaGFzKGMpKSBjb250aW51ZTsgY29uc3QgZCA9IE1hdGguaHlwb3QoYWxsW2NdLnggLSBteCwgYWxsW2NdLnogLSBteik7IGlmIChkIDwgYmQpIHsgYmQgPSBkOyBiZXN0ID0gYzsgfSB9XG4gICAgaWYgKGJlc3QgPCAwKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwID0gYWxsW2Jlc3RdLCBoID0gR1JJRF9TUCAqIDAuNDYsIFcgPSB0aGlzLmVuZ2luZS5nZXRSZW5kZXJXaWR0aCgpLCBIID0gdGhpcy5lbmdpbmUuZ2V0UmVuZGVySGVpZ2h0KCksIHZwID0gdGhpcy5jYW1lcmEudmlld3BvcnQudG9HbG9iYWwoVywgSCksIG0gPSB0aGlzLnNjZW5lLmdldFRyYW5zZm9ybU1hdHJpeCgpO1xuICAgIGNvbnN0IHB0cyA9IFtbLWgsIC1oXSwgW2gsIC1oXSwgW2gsIGhdLCBbLWgsIGhdXS5tYXAoKFtkeCwgZHpdKSA9PiBCQUJZTE9OLlZlY3RvcjMuUHJvamVjdChuZXcgQkFCWUxPTi5WZWN0b3IzKHAueCArIGR4LCAwLjAyLCBwLnogKyBkeiksIEJBQllMT04uTWF0cml4LklkZW50aXR5KCksIG0sIHZwKSk7XG4gICAgY29uc3QgciA9IHRoaXMuY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLCBreCA9IHIud2lkdGggLyBXLCBreSA9IHIuaGVpZ2h0IC8gSCwgeHMgPSBwdHMubWFwKChxOiBhbnkpID0+IHEueCksIHlzID0gcHRzLm1hcCgocTogYW55KSA9PiBxLnkpO1xuICAgIGNvbnN0IHgwID0gTWF0aC5taW4oLi4ueHMpLCB4MSA9IE1hdGgubWF4KC4uLnhzKSwgeTAgPSBNYXRoLm1pbiguLi55cyksIHkxID0gTWF0aC5tYXgoLi4ueXMpO1xuICAgIGlmICghaXNGaW5pdGUoeDAgKyB4MSArIHkwICsgeTEpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyB4OiByLmxlZnQgKyB4MCAqIGt4LCB5OiByLnRvcCArIHkwICoga3ksIHc6ICh4MSAtIHgwKSAqIGt4LCBoOiAoeTEgLSB5MCkgKiBreSB9O1xuICB9XG4gIHN5bmNCdWlsZCgpIHtcbiAgICB0aGlzLnBlcnNpc3RSdW4oKTtcbiAgICBjb25zdCBtZXJnZWQgPSB0aGlzLnMuc3RhdHMubWVyZ2VzID4gdGhpcy5zZWVuTWVyZ2VzOyB0aGlzLnNlZW5NZXJnZXMgPSB0aGlzLnMuc3RhdHMubWVyZ2VzO1xuICAgIGNvbnN0IGdyb3duID0gbWVyZ2VkID8gdGhpcy5zLnVuaXRzLmZpbmQoKHUpID0+IHsgY29uc3QgZ3YgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpOyByZXR1cm4gISFndiAmJiBndi5zdGFyICE9PSB1LnN0YXI7IH0pIDogdW5kZWZpbmVkOyAgIC8vIHRoZSB1bml0IHRoYXQganVzdCBnYWluZWQgYSBzdGFyXG4gICAgY29uc3QgYWxpdmUgPSBuZXcgU2V0KHRoaXMucy51bml0cy5tYXAoKHUpID0+IHUuaWQpKTtcbiAgICBmb3IgKGNvbnN0IFtpZCwgdl0gb2YgdGhpcy51bml0VmlzKSBpZiAoIWFsaXZlLmhhcyhpZCkpIHtcbiAgICAgIHRoaXMudmlzVG9Vbml0LmRlbGV0ZSh2KTsgdGhpcy51bml0VmlzLmRlbGV0ZShpZCk7IGNvbnN0IHAgPSB2LmhvbGRlci5wb3NpdGlvbjtcbiAgICAgIGlmIChncm93bikgeyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG1lcmdlOiB0aGUgY29uc3VtZWQgdW5pdCBpcyBkcmF3biBpbnRvIHRoZSBzdXJ2aXZvciBhbmQgdmFuaXNoZXMgaW4gYSBmbGFzaFxuICAgICAgICBjb25zdCB0byA9IHRoaXMucG9zKGdyb3duLmNlbGwpLCB4MCA9IHAueCwgejAgPSBwLnosIHNjID0gdi5ob2xkZXIuc2NhbGluZy54OyB2LnBsYXkoJ2lkbGUnKTtcbiAgICAgICAgdGhpcy50d2VlbigwLjMzLCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuNCwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LmhvbGRlci5zY2FsaW5nLnNldEFsbChzYyAqICgxIC0gMC43NSAqIHQpKTsgfSxcbiAgICAgICAgICAoKSA9PiB7IHRoaXMuYnVyc3QodG8ueCwgdG8ueiwgWzAuODUsIDAuNiwgMSwgMC45XSwgWzAuNSwgMC4zLCAxLCAwLjddLCAxNCk7IHYuZGlzcG9zZSgpOyB9KTtcbiAgICAgIH0gZWxzZSB7IHRoaXMuYnVyc3QocC54LCBwLnosIFswLjYsIDAuNSwgMC43LCAwLjhdLCBbMC4zLCAwLjIsIDAuNSwgMC42XSwgMTYpOyB2LmRpc3Bvc2UoKTsgfVxuICAgIH1cbiAgICBjb25zdCBsdmxzID0gbG9hZFNhdmUoKS5zb3VscztcbiAgICBmb3IgKGNvbnN0IHUgb2YgdGhpcy5zLnVuaXRzKSB7XG4gICAgICBsZXQgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IGNvbnN0IHAgPSB0aGlzLnBvcyh1LmNlbGwpO1xuICAgICAgaWYgKCF2KSB7IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCB1LnNvdWwsIDAsIHUuc3Rhcik7IHRoaXMudW5pdFZpcy5zZXQodS5pZCwgdik7IHRoaXMudmlzVG9Vbml0LnNldCh2LCB1LmlkKTsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHAueCwgMCwgcC56KTsgdi5ob2xkZXIucm90YXRpb24ueSA9IE1hdGguUEkgLyAyOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopOyBhdWRpby5wbGF5KCdzdW1tb24nKTsgY29uc3QgdnYgPSB2OyB0aGlzLmxhdGVyKDEuMSwgKCkgPT4geyBpZiAodGhpcy5waGFzZSA9PT0gJ2J1aWxkJykgdnYucGxheSgnaWRsZScpOyB9KTsgfVxuICAgICAgZWxzZSB7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgaWYgKHYuc3RhciAhPT0gdS5zdGFyKSB7IGNvbnN0IGZ2ID0gdjsgdi5zZXRTdGFyKHUuc3Rhcik7IHRoaXMubGF0ZXIoZ3Jvd24gJiYgZ3Jvd24uaWQgPT09IHUuaWQgPyAwLjMzIDogMCwgKCkgPT4gdGhpcy5tZXJnZUZ4KGZ2LCBwLngsIHAueikpOyB9IH1cbiAgICB9XG4gICAgZm9yIChjb25zdCB1IG9mIHRoaXMucy51bml0cykgeyBjb25zdCB2diA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCk7IGlmICh2diAmJiB2di5zZXRMZXZlbCkgdnYuc2V0TGV2ZWwoKGx2bHMgYXMgYW55KVt1LnNvdWxdPy5sZXZlbCA/PyAxKTsgfVxuICAgIGZvciAobGV0IGMgPSAwOyBjIDwgR1JJRF9DRUxMUzsgYysrKSB0aGlzLnRpbnQoYywgJ25vcm1hbCcpO1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsO1xuICAgIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnBoYXNlID09PSAnYnVpbGQnKSB7XG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCBjYW5TdW1tb24odGhpcy5zLCBzZWwuaWR4KSA/ICdmcmVlJyA6ICdub3JtYWwnKTtcbiAgICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZUZyb21IYW5kKHRoaXMucywgc2VsLmlkeCwgdS5pZCkpIHRoaXMudGludCh1LmNlbGwsICdwYXJ0bmVyJyk7ICAgICAvLyB0aGUgY2FyZCBjYW4gbWVyZ2UgaW50byB0aGlzIHVuaXRcbiAgICB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ3VuaXQnKSB7XG4gICAgICBjb25zdCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7XG4gICAgICBpZiAodSkgeyB0aGlzLnRpbnQodS5jZWxsLCAnc2VsJyk7IGZvciAoY29uc3QgbyBvZiB0aGlzLnMudW5pdHMpIGlmIChjYW5NZXJnZURlcGxveWVkKHUsIG8pKSB0aGlzLnRpbnQoby5jZWxsLCAncGFydG5lcicpOyBmb3IgKGxldCBjID0gMDsgYyA8IEdSSURfQ0VMTFM7IGMrKykgaWYgKGNlbGxGcmVlKHRoaXMucywgYykpIHRoaXMudGludChjLCAnZnJlZScpOyB9XG4gICAgfVxuICB9XG4gIC8qKiBUaGUgbWVyZ2UgbW9tZW50OiBhIGZsYXNoIG9mIHJpbmdzIGFuZCBzcGFya3MsIGEgcHVuY2ggaW4gc2l6ZSwgYSByaXNpbmcgY2hpbWUuICovXG4gIHByaXZhdGUgbWVyZ2VGeCh2OiBVbml0VmlzdWFsLCB4OiBudW1iZXIsIHo6IG51bWJlcikge1xuICAgIGF1ZGlvLnBsYXkoJ21lcmdlJyk7IHYucHVsc2UoKTsgY29uc3QgdGFyZ2V0ID0gdi5ob2xkZXIuc2NhbGluZy54O1xuICAgIHRoaXMuZnhSaW5nKHgsIHosIG5ldyBCQUJZTE9OLkNvbG9yMygxLCAwLjg1LCAwLjQpLCAwLjIsIDIuMCwgMC42NSk7IHRoaXMubGF0ZXIoMC4xMiwgKCkgPT4gdGhpcy5meFJpbmcoeCwgeiwgbmV3IEJBQllMT04uQ29sb3IzKDEsIDEsIDEpLCAwLjIsIDMuMCwgMC44KSk7XG4gICAgdGhpcy5idXJzdCh4LCB6LCBbMSwgMC44NSwgMC40LCAwLjldLCBbMC44LCAwLjQsIDEsIDAuOF0sIDQ2KTsgdGhpcy5idXJzdCh4LCB6LCBbMC44NSwgMC42LCAxLCAwLjldLCBbMC41LCAwLjMsIDEsIDAuN10sIDI0KTtcbiAgICB0aGlzLnR3ZWVuKDAuNTUsICh0KSA9PiB2LmhvbGRlci5zY2FsaW5nLnNldEFsbCh0YXJnZXQgKiAoMSArIDAuNDUgKiBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAoMSAtIHQgKiAwLjQpKSksICgpID0+IHYuaG9sZGVyLnNjYWxpbmcuc2V0QWxsKHRhcmdldCkpO1xuICB9XG4gIHByaXZhdGUgc3VtbW9uRngoeDogbnVtYmVyLCB6OiBudW1iZXIpIHsgdGhpcy5idXJzdCh4LCB6LCBbMC43LCAwLjMsIDEsIDAuOV0sIFswLjM1LCAwLjEsIDAuNywgMC44XSwgMzApOyB0aGlzLmZ4UmluZyh4LCB6LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC43LCAwLjMsIDEpLCAwLjIsIDEuMiwgMC43KTsgfVxuXG4gIC8vIC0tLS0gcGxheWVyIGFjdGlvbnMgKGJ1aWxkIHBoYXNlKVxuICB0b2FzdChtc2c6IHN0cmluZykgeyB0aGlzLnVpLnRvYXN0KG1zZyk7IH1cbiAgb25DYXJkKGlkeDogbnVtYmVyKSB7XG4gICAgaWYgKHRoaXMucGhhc2UgIT09ICdidWlsZCcpIHJldHVybjtcbiAgICBpZiAodGhpcy5zd2FwTW9kZSkgeyBpZiAoZGlzY2FyZFJlZHJhdyh0aGlzLnMsIGlkeCkpIHsgdGhpcy50b2FzdCgnU3dhcHBlZDogZHJldyBhIGRpZmZlcmVudCBTb3VsLicpOyB0aGlzLnN3YXBNb2RlID0gZmFsc2U7IH0gZWxzZSB0aGlzLnRvYXN0KCdTd2FwIGFscmVhZHkgdXNlZCB0aGlzIHJvdW5kLicpOyB9XG4gICAgZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICdjYXJkJyAmJiB0aGlzLnNlbC5pZHggPT09IGlkeCA/IG51bGwgOiB7IHR5cGU6ICdjYXJkJywgaWR4IH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25UaWxlKGNlbGw6IG51bWJlcikge1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHNlbCA9IHRoaXMuc2VsOyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IGhlcmUgPSBzLnVuaXRzLmZpbmQoKHUpID0+IHUuY2VsbCA9PT0gY2VsbCk7IGlmIChoZXJlKSB7IHRoaXMub25Vbml0VmlzdWFsKHRoaXMudW5pdFZpcy5nZXQoaGVyZS5pZCkhKTsgcmV0dXJuOyB9XG4gICAgaWYgKHNlbCAmJiBzZWwudHlwZSA9PT0gJ2NhcmQnKSB7XG4gICAgICBpZiAoY2FuU3VtbW9uKHMsIHNlbC5pZHgpKSB7IHN1bW1vbihzLCBzZWwuaWR4LCBjZWxsKTsgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgICBlbHNlIHsgY29uc3Qgc291bCA9IHMuaGFuZFtzZWwuaWR4XTsgdGhpcy50b2FzdChgTm90IGVub3VnaCBEb21pbmlvbjogJHtTT1VMX05BTUVbc291bF19IGNvc3RzICR7Y29zdChzb3VsLCAxKX0sIHlvdSBoYXZlICR7ZG9taW5pb25GcmVlKHMpfSBmcmVlLmApOyB9XG4gICAgfSBlbHNlIGlmIChzZWwgJiYgc2VsLnR5cGUgPT09ICd1bml0JykgeyBpZiAobW92ZVVuaXQocywgc2VsLmlkLCBjZWxsKSkgdGhpcy5zZWwgPSBudWxsOyB9XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgb25Vbml0VmlzdWFsKHY6IFVuaXRWaXN1YWwpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMudmlzVG9Vbml0LmdldCh2KTsgaWYgKGlkID09PSB1bmRlZmluZWQgfHwgdGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuO1xuICAgIGNvbnN0IHMgPSB0aGlzLnMsIHUgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKSE7XG4gICAgaWYgKHRoaXMuc3dhcE1vZGUpIHsgaWYgKHN3YXBTZWxsKHMsIGlkKSkgeyB0aGlzLnRvYXN0KGBTb2xkICR7U09VTF9OQU1FW3Uuc291bF19OiBkcmV3IGEgZGlmZmVyZW50IFNvdWwuYCk7IHRoaXMuc3dhcE1vZGUgPSBmYWxzZTsgfSBlbHNlIHRoaXMudG9hc3QodS5mcmVzaCA/IFwiWW91IGNhbid0IHNlbGwgYSB1bml0IHlvdSBzdW1tb25lZCB0aGlzIHJvdW5kLlwiIDogJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnNlbCAmJiB0aGlzLnNlbC50eXBlID09PSAnY2FyZCcgJiYgcy5oYW5kW3RoaXMuc2VsLmlkeF0gPT09IHUuc291bCAmJiB1LnN0YXIgPT09IDEgJiYgcy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3RhcicpIHtcbiAgICAgIGlmIChtZXJnZUZyb21IYW5kKHMsIHRoaXMuc2VsLmlkeCwgaWQpKSB7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCB0aGUgY2FyZCBpbnRvIGEgMi1zdGFyICR7U09VTF9OQU1FW3Uuc291bF19IWApOyB9XG4gICAgICBlbHNlIHRoaXMudG9hc3QoYE5vdCBlbm91Z2ggRG9taW5pb24gdG8gbWVyZ2U6IGl0IG5lZWRzICR7Y29zdCh1LnNvdWwsIDIpIC0gY29zdCh1LnNvdWwsIDEpfSBtb3JlLCB5b3UgaGF2ZSAke2RvbWluaW9uRnJlZShzKX0gZnJlZS5gKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodGhpcy5zZWwgJiYgdGhpcy5zZWwudHlwZSA9PT0gJ3VuaXQnICYmIHRoaXMuc2VsLmlkICE9PSBpZCkge1xuICAgICAgY29uc3QgYSA9IHMudW5pdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gKHRoaXMuc2VsIGFzIGFueSkuaWQpITtcbiAgICAgIGlmIChjYW5NZXJnZURlcGxveWVkKGEsIHUpKSB7IG1lcmdlRGVwbG95ZWQocywgYS5pZCwgdS5pZCk7IHRoaXMuc2VsID0geyB0eXBlOiAndW5pdCcsIGlkOiBhLmlkIH07IHRoaXMudG9hc3QoYE1lcmdlZCBpbnRvIGEgJHthLnN0YXJ9LXN0YXIgJHtTT1VMX05BTUVbYS5zb3VsXX0hYCk7IH0gZWxzZSB0aGlzLnNlbCA9IHsgdHlwZTogJ3VuaXQnLCBpZCB9O1xuICAgIH0gZWxzZSB0aGlzLnNlbCA9IHRoaXMuc2VsICYmIHRoaXMuc2VsLnR5cGUgPT09ICd1bml0JyAmJiB0aGlzLnNlbC5pZCA9PT0gaWQgPyBudWxsIDogeyB0eXBlOiAndW5pdCcsIGlkIH07XG4gICAgdGhpcy5jb25maXJtUmVtb3ZlID0gZmFsc2U7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gIH1cbiAgbWVyZ2VTZWxlY3RlZCgpIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBzZWwgPSB0aGlzLnNlbDsgaWYgKCFzZWwgfHwgc2VsLnR5cGUgIT09ICd1bml0JykgcmV0dXJuO1xuICAgIGNvbnN0IGEgPSBzLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IHNlbC5pZCk7IGNvbnN0IGIgPSBhICYmIHMudW5pdHMuZmluZCgobykgPT4gY2FuTWVyZ2VEZXBsb3llZChhLCBvKSk7XG4gICAgaWYgKGEgJiYgYikgeyBtZXJnZURlcGxveWVkKHMsIGEuaWQsIGIuaWQpOyB0aGlzLnRvYXN0KGBNZXJnZWQgaW50byBhICR7YS5zdGFyfS1zdGFyICR7U09VTF9OQU1FW2Euc291bF19IWApOyB9IGVsc2UgdGhpcy50b2FzdCgnTm8gbWF0Y2hpbmcgdW5pdCAoc2FtZSBTb3VsIGFuZCBzdGFycykgdG8gbWVyZ2Ugd2l0aC4nKTtcbiAgICB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG4gIHJlbW92ZVNlbGVjdGVkKCkge1xuICAgIGNvbnN0IHNlbCA9IHRoaXMuc2VsOyBpZiAoIXNlbCB8fCBzZWwudHlwZSAhPT0gJ3VuaXQnKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmNvbmZpcm1SZW1vdmUpIHsgdGhpcy5jb25maXJtUmVtb3ZlID0gdHJ1ZTsgdGhpcy50b2FzdCgnVGFwIFJlbW92ZSBhZ2FpbiB0byBjb25maXJtLiBUaGUgY2FyZCBpcyBnb25lIGZvciB0aGlzIHN0YWdlLicpOyB0aGlzLnVpLnJlbmRlcigpOyByZXR1cm47IH1cbiAgICBkaXNtaXNzKHRoaXMucywgc2VsLmlkKTsgdGhpcy5zZWwgPSBudWxsOyB0aGlzLmNvbmZpcm1SZW1vdmUgPSBmYWxzZTsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTtcbiAgfVxuICB0b2dnbGVTd2FwKCkgeyBpZiAodGhpcy5waGFzZSAhPT0gJ2J1aWxkJykgcmV0dXJuOyBpZiAodGhpcy5zLmRpc2NhcmRVc2VkKSB7IHRoaXMudG9hc3QoJ1N3YXAgYWxyZWFkeSB1c2VkIHRoaXMgcm91bmQuJyk7IHJldHVybjsgfSB0aGlzLnN3YXBNb2RlID0gIXRoaXMuc3dhcE1vZGU7IHRoaXMuc2VsID0gbnVsbDsgaWYgKHRoaXMuc3dhcE1vZGUpIHRoaXMudG9hc3QoJ1N3YXA6IHRhcCBhIGhhbmQgY2FyZCB0byBkaXNjYXJkLCBvciBhIHVuaXQgKG5vdCBzdW1tb25lZCB0aGlzIHJvdW5kKSB0byBzZWxsLicpOyB0aGlzLnN5bmNCdWlsZCgpOyB0aGlzLnVpLnJlbmRlcigpOyB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gYmF0dGxlXG4gIHN0YXJ0QmF0dGxlKCkge1xuICAgIGlmICh0aGlzLnBoYXNlICE9PSAnYnVpbGQnIHx8ICF0aGlzLnMudW5pdHMubGVuZ3RoKSB7IGlmICghdGhpcy5zLnVuaXRzLmxlbmd0aCkgdGhpcy50b2FzdCgnU3VtbW9uIGF0IGxlYXN0IG9uZSB1bml0IGZpcnN0LicpOyByZXR1cm47IH1cbiAgICB0aGlzLmZsdXNoVHdlZW5zKCk7IGF1ZGlvLnBsYXkoJ3N0YXJ0Jyk7IHRoaXMuYmVnaW5CYXR0bGVQZXJmKCk7IHRoaXMuc2hvd0dyaWQoZmFsc2UpO1xuICAgIHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zd2FwTW9kZSA9IGZhbHNlOyB0aGlzLmF0dGVtcHQrKzsgdGhpcy5oYW5kbGVkID0gZmFsc2U7IHRoaXMucmVzdWx0QXQgPSAtMTtcbiAgICBjb25zdCBzID0gdGhpcy5zLCB1bml0cyA9IHMudW5pdHMuc2xpY2UoKTtcbiAgICBjb25zdCBzYXZlZCA9IGxvYWRTYXZlKCkuc291bHMsIGxldmVsczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9OyBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoc2F2ZWQpKSBsZXZlbHNba10gPSAoc2F2ZWQgYXMgYW55KVtrXS5sZXZlbDsgICAvLyBwZXJtYW5lbnQgU291bCBsZXZlbHNcbiAgICB0aGlzLmJhdHRsZSA9IG5ldyBCYXR0bGUodW5pdHMubWFwKCh1KSA9PiAoeyBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsIH0pKSwgZW5lbXlXYXZlKHMud2F2ZSwgdGhpcy5zZWVkKSwgdGhpcy5zZWVkICogMTMxICsgcy53YXZlICogMTcgKyB0aGlzLmF0dGVtcHQsIGxldmVscywgZW5lbXlQb3dlcihzLndhdmUpKTtcbiAgICB0aGlzLmZ2aXMuY2xlYXIoKTsgdGhpcy5mVW5pdC5jbGVhcigpOyB0aGlzLmxhc3RTdGF0ZS5jbGVhcigpO1xuICAgIHRoaXMuYmF0dGxlLmZpZ2h0ZXJzLmZvckVhY2goKGYpID0+IHtcbiAgICAgIGlmIChmLnRlYW0gPT09IDApIHsgY29uc3QgdSA9IHVuaXRzW2YuaWQgLSAxXTsgY29uc3QgdiA9IHRoaXMudW5pdFZpcy5nZXQodS5pZCkhOyB0aGlzLmZ2aXMuc2V0KGYuaWQsIHYpOyB0aGlzLmZVbml0LnNldChmLmlkLCB1LmlkKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgfVxuICAgICAgZWxzZSB7IGNvbnN0IHYgPSBjcmVhdGVWaXN1YWwodGhpcy5BLCBmLnNvdWwsIDEsIGYuc3Rhcik7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChmLngsIDAsIGYueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSAtTWF0aC5QSSAvIDI7IGlmIChmLmJvc3MgJiYgdi5zZXRCb3NzKSB2LnNldEJvc3ModHJ1ZSk7IHYucGxheSgnc3Bhd24nKTsgdi5zZXRIcCgxKTsgdi5zZXRNYW5hKGYubWF4TWFuYSA/IDAgOiBudWxsKTsgdGhpcy5mdmlzLnNldChmLmlkLCB2KTsgdGhpcy5sYXRlcigxLjEsICgpID0+IHsgaWYgKHYuc3RhdGUgPT09ICdzcGF3bicpIHYucGxheSgnaWRsZScpOyB9KTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNywgMC42LCAwLjUsIDAuN10sIFswLjQsIDAuMzUsIDAuMywgMC42XSwgMTQpOyB9XG4gICAgfSk7XG4gICAgZm9yIChsZXQgYyA9IDA7IGMgPCBHUklEX0NFTExTOyBjKyspIHRoaXMudGludChjLCAnbm9ybWFsJyk7XG4gICAgdGhpcy5waGFzZSA9ICd0cmFuc2l0aW9uJzsgdGhpcy5zdGFydFN0ZXBBdCA9IDEuMDsgdGhpcy5hY2MgPSAwOyB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5iYXR0bGUsIDIuMik7IHRoaXMuc3luY0J1aWxkKCk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMuYmF0dGxlUm9hcigpO1xuICB9XG4gIHByaXZhdGUgYXBwbHlFdmVudHMoZXZzOiBCRXZlbnRbXSkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSE7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2cykge1xuICAgICAgaWYgKGUudCA9PT0gJ3N3aW5nJykgeyBjb25zdCB2ID0gdGhpcy5mdmlzLmdldChlLmlkKTsgaWYgKHYpIHYucGxheSgnYXR0YWNrJywgZS5zcGVlZCk7IGlmIChNYXRoLnJhbmRvbSgpIDwgMC4wOCkgeyBjb25zdCBmID0gYi5ieUlkKGUuaWQpOyBpZiAoZikgYXVkaW8uYmFyayhmLnNvdWwsIDAsIGYudGVhbSA9PT0gMCA/IDEgOiAwLjg1KTsgfSB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdoaXQnKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGUudG8pOyBpZiAodikgdi5wdWxzZSgpOyBpZiAoZS5raW5kID09PSAnYXJyb3cnKSBhdWRpby5wbGF5KCdoaXRBcnJvdycpOyBlbHNlIGlmIChlLmtpbmQgPT09ICdtZWxlZScpIGF1ZGlvLnBsYXkoJ2hpdCcpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdhcnJvdycpIHsgY29uc3QgZiA9IGIuYnlJZChlLmZyb20pISwgdG8gPSBiLmJ5SWQoZS50bykhOyB0aGlzLnNwYXduQXJyb3coZi50ZWFtLCBmLngsIGYueiwgdG8ueCwgdG8ueiwgZS5kdXIpOyBhdWRpby5wbGF5KCdhcnJvdycpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICdkZWF0aCcpIHsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZS5pZCk7IGlmICh2KSB7IHYucGxheSgnZGVhdGgnKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyBjb25zdCBmID0gYi5ieUlkKGUuaWQpITsgYXVkaW8ucGxheSgnZGVhdGgnKTsgdGhpcy5idXJzdChmLngsIGYueiwgWzAuNiwgMC41LCAwLjcsIDAuOF0sIFswLjMsIDAuMiwgMC41LCAwLjZdLCAxMik7IGlmIChmLnRlYW0gPT09IDEpIHRoaXMubGF0ZXIoNSwgKCkgPT4geyBpZiAodGhpcy5mdmlzLmdldChlLmlkKSA9PT0gdiAmJiB0aGlzLnBoYXNlICE9PSAnYnVpbGQnKSB7IHYuaG9sZGVyLnNldEVuYWJsZWQoZmFsc2UpOyB9IH0pOyB9IH1cbiAgICAgIGVsc2UgaWYgKGUudCA9PT0gJ2Nhc3QnKSB7IGNvbnN0IGYgPSBiLmJ5SWQoZS5pZCkhOyBhdWRpby5wbGF5KCdjYXN0Jyk7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMC41LCAwLjgsIDEpLCAwLjE1LCAxLjEsIDAuMzUpOyB9XG4gICAgICBlbHNlIGlmIChlLnQgPT09ICd0YXVudCcpIHsgY29uc3QgZiA9IGIuYnlJZChlLmlkKSE7IGF1ZGlvLnBsYXkoJ3RhdW50Jyk7IHRoaXMuZnhSaW5nKGYueCwgZi56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC44NSwgMC4zKSwgMC4zLCBCQUxBTkNFLnRhdW50LnJhZGl1cywgMC42KTsgfVxuICAgICAgZWxzZSBpZiAoZS50ID09PSAnc21hc2gnKSB7IGF1ZGlvLnBsYXkoJ3NtYXNoJyk7IHRoaXMuZnhSaW5nKGUueCwgZS56LCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMC41LCAwLjIpLCAwLjIsIGUuciAqIDEuNiwgMC40NSk7IH1cbiAgICB9XG4gIH1cbiAgcHJpdmF0ZSBhcnJvd0Jhc2U6IGFueVtdID0gW107XG4gIC8qKiBUaGUgYXJyb3cncyBvd24gbWF0ZXJpYWwgd2l0aCBhIGZhaW50IGdsb3cgaW4gdGhlIHRlYW0gY29sb3VyIChwdXJwbGUgZm9yIHlvdXJzLCBhbWJlciBmb3IgdGhlIGVuZW15J3MpLCBzbyB5b3UgY2FuIHN0aWxsIHRlbGwgd2hvc2UgaXQgaXMuICovXG4gIHByaXZhdGUgYXJyb3dUZWFtTWF0KHRlYW06IG51bWJlcikge1xuICAgIGlmICh0aGlzLmFycm93QmFzZVt0ZWFtXSkgcmV0dXJuIHRoaXMuYXJyb3dCYXNlW3RlYW1dO1xuICAgIGNvbnN0IHNyYyA9IHRoaXMuQS5hcnJvdy5tYXRlcmlhbHMgJiYgdGhpcy5BLmFycm93Lm1hdGVyaWFsc1swXTsgaWYgKCFzcmMpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG0gPSBzcmMuY2xvbmUoJ2Fycm93VCcgKyB0ZWFtKTsgY29uc3QgYyA9IHRlYW0gPT09IDAgPyBuZXcgQkFCWUxPTi5Db2xvcjMoMC41NSwgMC4yLCAwLjg1KSA6IG5ldyBCQUJZTE9OLkNvbG9yMygwLjksIDAuNTUsIDAuMTUpO1xuICAgIGlmICgnZW1pc3NpdmVDb2xvcicgaW4gbSkgbS5lbWlzc2l2ZUNvbG9yID0gYy5zY2FsZSgwLjAzNSk7IHRoaXMuYXJyb3dCYXNlW3RlYW1dID0gbTsgcmV0dXJuIG07XG4gIH1cbiAgcHJpdmF0ZSBzcGF3bkFycm93KHRlYW06IG51bWJlciwgeDA6IG51bWJlciwgejA6IG51bWJlciwgeDE6IG51bWJlciwgejE6IG51bWJlciwgZHVyOiBudW1iZXIpIHtcbiAgICBsZXQgbWVzaCA9IHRoaXMuYXJyb3dNZXNoLnBvcCgpO1xuICAgIGlmICghbWVzaCkge1xuICAgICAgY29uc3QgaG9sZGVyID0gbmV3IEJBQllMT04uVHJhbnNmb3JtTm9kZSgnYXInLCB0aGlzLnNjZW5lKTsgaG9sZGVyLnNjYWxpbmcuc2V0QWxsKDAuNjUpOyAgIC8vIDU1IGNtIHdhcyBsb25nIG5leHQgdG8gYSBjaGliaSBHb2JsaW5cbiAgICAgIGlmICh0aGlzLkEuYXJyb3cpIHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgcmVhbCBhcnJvdyBtb2RlbCAobWV0YWwgaGVhZCwgZmxldGNoaW5nKTogb25lIGluc3RhbmNlIHBlciBmbHlpbmcgYXJyb3dcbiAgICAgICAgY29uc3QgZW50ID0gdGhpcy5BLmFycm93Lmluc3RhbnRpYXRlTW9kZWxzVG9TY2VuZSgobjogc3RyaW5nKSA9PiBuICsgJ18nICsgTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgNiksIGZhbHNlKTtcbiAgICAgICAgZW50LnJvb3ROb2Rlc1swXS5wYXJlbnQgPSBob2xkZXI7IGVudC5yb290Tm9kZXNbMF0uZ2V0Q2hpbGRNZXNoZXMoKS5mb3JFYWNoKChtOiBhbnkpID0+IHsgbS5pc1BpY2thYmxlID0gZmFsc2U7IG0uYWx3YXlzU2VsZWN0QXNBY3RpdmVNZXNoID0gdHJ1ZTsgfSk7XG4gICAgICB9IGVsc2UgeyBjb25zdCBjeWwgPSBCQUJZTE9OLk1lc2hCdWlsZGVyLkNyZWF0ZUN5bGluZGVyKCdhcnJvdycsIHsgaGVpZ2h0OiAwLjU1LCBkaWFtZXRlcjogMC4wMzUgfSwgdGhpcy5zY2VuZSk7IGN5bC5yb3RhdGlvbi54ID0gTWF0aC5QSSAvIDI7IGN5bC5pc1BpY2thYmxlID0gZmFsc2U7IGN5bC5wYXJlbnQgPSBob2xkZXI7IGN5bC5tYXRlcmlhbCA9IHRoaXMuYXJyb3dNYXRzW3RlYW1dOyB9XG4gICAgICBtZXNoID0gaG9sZGVyO1xuICAgIH1cbiAgICBtZXNoLnNldEVuYWJsZWQodHJ1ZSk7XG4gICAgaWYgKHRoaXMuQS5hcnJvdykgeyBjb25zdCB0bSA9IHRoaXMuYXJyb3dUZWFtTWF0KHRlYW0pOyBtZXNoLmdldENoaWxkTWVzaGVzKCkuZm9yRWFjaCgobTogYW55KSA9PiB7IGlmICh0bSkgbS5tYXRlcmlhbCA9IHRtOyB9KTsgfVxuICAgIHRoaXMuYXJyb3dzLnB1c2goeyBtZXNoLCB4MCwgejAsIHgxLCB6MSwgdDogMCwgZHVyIH0pO1xuICB9XG5cbiAgLyoqIEJhdHRsZSBjcnk6IHVwIHRvIHRocmVlIGRpZmZlcmVudCBTb3VscyBmcm9tIHlvdXIgYXJteSBiZWxsb3cgaW4gdHVybiwgYW5kIG9uZSBmcm9tIHRoZSBlbmVteSBhbnN3ZXJzLCBhIGxpdHRsZSBsb3dlci4gKi9cbiAgcHJpdmF0ZSBiYXR0bGVSb2FyKCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZTsgaWYgKCFiKSByZXR1cm47IGNvbnN0IG1pbmUgPSBuZXcgU2V0PHN0cmluZz4oKSwgdGhlaXJzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBmIG9mIGIuZmlnaHRlcnMpIChmLnRlYW0gPT09IDAgPyBtaW5lIDogdGhlaXJzKS5hZGQoZi5zb3VsKTtcbiAgICBbLi4ubWluZV0uc2xpY2UoMCwgMykuZm9yRWFjaCgoc291bCwgaSkgPT4gYXVkaW8uYmFyayhzb3VsLCAwLjE1ICsgMC4xNiAqIGksIDEpKTsgY29uc3QgZSA9IFsuLi50aGVpcnNdWzBdOyBpZiAoZSkgYXVkaW8uYmFyayhlLCAwLjU1LCAwLjgyKTtcbiAgfVxuXG4gIHByaXZhdGUgZnJhbWUoZHQ6IG51bWJlcikge1xuICAgIGlmICh0aGlzLmNhbnZhcy5jbGllbnRXaWR0aCAhPT0gdGhpcy5sYXN0VyB8fCB0aGlzLmNhbnZhcy5jbGllbnRIZWlnaHQgIT09IHRoaXMubGFzdEgpIHRoaXMuaGFuZGxlUmVzaXplKCk7ICAgLy8gZS5nLiB0aGUgaG9tZS1zY3JlZW4gYXBwIHJlc2l6aW5nIGFmdGVyIGxhdW5jaFxuICAgIGZvciAobGV0IGkgPSB0aGlzLnRpbWVycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyB0aGlzLnRpbWVyc1tpXS50IC09IGR0OyBpZiAodGhpcy50aW1lcnNbaV0udCA8PSAwKSB7IGNvbnN0IGYgPSB0aGlzLnRpbWVyc1tpXS5mbjsgdGhpcy50aW1lcnMuc3BsaWNlKGksIDEpOyBmKCk7IH0gfVxuICAgIGZvciAobGV0IGkgPSB0aGlzLnJpbmdGeC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCByID0gdGhpcy5yaW5nRnhbaV07IHIudCArPSBkdDsgY29uc3QgdSA9IHIudCAvIHIuZHVyLCBzID0gci5yMCArIChyLnIxIC0gci5yMCkgKiB1OyByLm0uc2NhbGluZy5zZXQocywgcywgcyk7IHIubW0uYWxwaGEgPSAwLjkgKiAoMSAtIHUpOyBpZiAodSA+PSAxKSB7IHIubS5kaXNwb3NlKCk7IHIubW0uZGlzcG9zZSgpOyB0aGlzLnJpbmdGeC5zcGxpY2UoaSwgMSk7IH0gfVxuICAgIGlmICh0aGlzLmNhbVQgPCAxKSB7IHRoaXMuY2FtVCA9IE1hdGgubWluKDEsIHRoaXMuY2FtVCArIGR0IC8gdGhpcy5jYW1EdXIpOyBjb25zdCBlID0gdGhpcy5jYW1UICogdGhpcy5jYW1UICogKDMgLSAyICogdGhpcy5jYW1UKTsgdGhpcy5jYW1lcmEucG9zaXRpb24gPSBCQUJZTE9OLlZlY3RvcjMuTGVycCh0aGlzLmNhbUZyb20ucG9zLCB0aGlzLmNhbVRvLnBvcywgZSk7IHRoaXMuY2FtVGd0ID0gQkFCWUxPTi5WZWN0b3IzLkxlcnAodGhpcy5jYW1Gcm9tLnRndCwgdGhpcy5jYW1Uby50Z3QsIGUpOyB0aGlzLmNhbWVyYS5zZXRUYXJnZXQodGhpcy5jYW1UZ3QuY2xvbmUoKSk7IH1cbiAgICBlbHNlIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJyAmJiB0aGlzLmNhbU1vZGUgPT09ICdjbG9zZScgJiYgIXRoaXMuY2luZSkgdGhpcy5mcmFtZUJhdHRsZShkdCk7XG4gICAgdGhpcy5uZWNyby51cGRhdGUoZHQpO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLnR3ZWVucy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgeyBjb25zdCB3ID0gdGhpcy50d2VlbnNbaV07IHcudCArPSBkdDsgY29uc3QgdSA9IE1hdGgubWluKDEsIHcudCAvIHcuZHVyKTsgdy5mbih1KTsgaWYgKHUgPj0gMSkgeyB0aGlzLnR3ZWVucy5zcGxpY2UoaSwgMSk7IGlmICh3LmRvbmUpIHcuZG9uZSgpOyB9IH1cbiAgICBmb3IgKGNvbnN0IHYgb2YgdGhpcy51bml0VmlzLnZhbHVlcygpKSB2LnVwZGF0ZShkdCk7XG4gICAgdGhpcy5mdmlzLmZvckVhY2goKHYsIGlkKSA9PiB7IGlmICghdGhpcy5mVW5pdC5oYXMoaWQpKSB2LnVwZGF0ZShkdCk7IH0pO1xuXG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlO1xuICAgIGlmICgodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nIHx8IHRoaXMucGhhc2UgPT09ICdiYXR0bGUnKSAmJiBiKSB7XG4gICAgICBpZiAodGhpcy5waGFzZSA9PT0gJ3RyYW5zaXRpb24nKSB7IHRoaXMuc3RhcnRTdGVwQXQgLT0gZHQ7IGlmICh0aGlzLnN0YXJ0U3RlcEF0IDw9IDApIHsgdGhpcy5waGFzZSA9ICdiYXR0bGUnOyB0aGlzLnVpLnJlbmRlcigpOyB9IH1cbiAgICAgIGlmICh0aGlzLnBoYXNlID09PSAnYmF0dGxlJykge1xuICAgICAgICB0aGlzLmFjYyArPSBkdCAqIHRoaXMudGltZVNjYWxlO1xuICAgICAgICB3aGlsZSAodGhpcy5hY2MgPj0gMSAvIDMwICYmIGIud2lubmVyIDwgMCkgeyBiLnN0ZXAoMSAvIDMwKTsgdGhpcy5hY2MgLT0gMSAvIDMwOyB0aGlzLmFwcGx5RXZlbnRzKGIuZHJhaW4oKSk7IH1cbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAoIXYpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoIXRoaXMuY2luZSAmJiAodGhpcy5waGFzZSA9PT0gJ2JhdHRsZScgfHwgZi50ZWFtID09PSAxKSkgeyB2LmhvbGRlci5wb3NpdGlvbi54ID0gZi54OyB2LmhvbGRlci5wb3NpdGlvbi56ID0gZi56OyBpZiAoZi5hbGl2ZSB8fCB0cnVlKSB2LmhvbGRlci5yb3RhdGlvbi55ID0gZi55YXc7IH1cbiAgICAgICAgaWYgKGYuYWxpdmUpIHsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCk7IGlmIChmLm1heE1hbmEpIHYuc2V0TWFuYShmLm1hbmEgLyBmLm1heE1hbmEpOyB9XG4gICAgICAgIGVsc2Ugdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoZi5zdGF0ZSAhPT0gJ2F0dGFjaycgJiYgZi5hbGl2ZSAmJiB2LnN0YXRlICE9PSAnY2hlZXInKSB7IGNvbnN0IHdhbnQgPSBmLnN0YXRlID09PSAncnVuJyA/ICdydW4nIDogJ2lkbGUnOyBpZiAodGhpcy5sYXN0U3RhdGUuZ2V0KGYuaWQpICE9PSB3YW50IHx8ICh2LnN0YXRlICE9PSB3YW50ICYmIHYuc3RhdGUgIT09ICdzcGF3bicpKSB7IGlmICh2LnN0YXRlICE9PSAnc3Bhd24nKSB7IHYucGxheSh3YW50IGFzIGFueSk7IHRoaXMubGFzdFN0YXRlLnNldChmLmlkLCB3YW50KTsgfSB9IH1cbiAgICAgICAgaWYgKGYuc3RhdGUgPT09ICdhdHRhY2snKSB0aGlzLmxhc3RTdGF0ZS5zZXQoZi5pZCwgJ2F0dGFjaycpO1xuICAgICAgfVxuICAgICAgaWYgKGIud2lubmVyID49IDAgJiYgIXRoaXMuaGFuZGxlZCkgeyB0aGlzLmhhbmRsZWQgPSB0cnVlOyB0aGlzLnJlc3VsdEF0ID0gMS40OyB9XG4gICAgICBpZiAodGhpcy5yZXN1bHRBdCA+IDApIHsgdGhpcy5yZXN1bHRBdCAtPSBkdDsgaWYgKHRoaXMucmVzdWx0QXQgPD0gMCkgdGhpcy5oYW5kbGVSZXN1bHQoKTsgfVxuICAgIH1cbiAgICBmb3IgKGxldCBpID0gdGhpcy5hcnJvd3MubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGEgPSB0aGlzLmFycm93c1tpXTsgYS50ICs9IGR0ICogdGhpcy50aW1lU2NhbGU7IGNvbnN0IHUgPSBNYXRoLm1pbigxLCBhLnQgLyBhLmR1cik7XG4gICAgICBjb25zdCBweCA9IGEueDAgKyAoYS54MSAtIGEueDApICogdSwgcHogPSBhLnowICsgKGEuejEgLSBhLnowKSAqIHUsIHB5ID0gMC43NSArIE1hdGguc2luKHUgKiBNYXRoLlBJKSAqIDAuOSAtIHUgKiAwLjI1O1xuICAgICAgY29uc3QgdTIgPSBNYXRoLm1pbigxLCB1ICsgMC4wMyksIHF4ID0gYS54MCArIChhLngxIC0gYS54MCkgKiB1MiwgcXogPSBhLnowICsgKGEuejEgLSBhLnowKSAqIHUyLCBxeSA9IDAuNzUgKyBNYXRoLnNpbih1MiAqIE1hdGguUEkpICogMC45IC0gdTIgKiAwLjI1O1xuICAgICAgYS5tZXNoLnBvc2l0aW9uLnNldChweCwgcHksIHB6KTsgYS5tZXNoLmxvb2tBdChuZXcgQkFCWUxPTi5WZWN0b3IzKHF4LCBxeSwgcXopKTtcbiAgICAgIGlmICh1ID49IDEpIHsgYS5tZXNoLnNldEVuYWJsZWQoZmFsc2UpOyB0aGlzLmFycm93TWVzaC5wdXNoKGEubWVzaCk7IHRoaXMuYXJyb3dzLnNwbGljZShpLCAxKTsgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlUmVzdWx0KCkge1xuICAgIGNvbnN0IGIgPSB0aGlzLmJhdHRsZSEsIHMgPSB0aGlzLnM7XG4gICAgdGhpcy5lbmRCYXR0bGVQZXJmKCk7XG4gICAgdGhpcy5sYXN0QmF0dGxlID0gYHdhdmUgJHtzLndhdmV9IGF0dGVtcHQgJHt0aGlzLmF0dGVtcHR9OiAke2Iud2lubmVyID09PSAwID8gJ1dPTicgOiAnTE9TVCd9IGluICR7Yi50aW1lLnRvRml4ZWQoMSl9cywgJHtiLmNvdW50KDApfSBvZiB5b3VycyBhbmQgJHtiLmNvdW50KDEpfSBlbmVtaWVzIGxlZnRgO1xuICAgIGlmIChiLndpbm5lciA9PT0gMCkge1xuICAgICAgdGhpcy5wbGF5UmVzdWx0KCd3aW4nLCAoKSA9PiB7ICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGFybXkgaXMgcmFpc2VkIGFnYWluLCB0aGVuIHRoZSBuZXh0IHdhdmUgLyB0aGUgZHJhZnRcbiAgICAgICAgdGhpcy5jaW5lID0gZmFsc2U7XG4gICAgICAgIHRyeSB7IHRoaXMubGFzdEdvbGQgPSB0aGlzLmRhaWx5ID8gMCA6IGFkZEdvbGRBbmRTYXZlKGlzRW5kbGVzcygpID8gZW5kbGVzc1dhdmVHb2xkKHMud2F2ZSkgOiB3YXZlR29sZChjdXJyZW50U3RhZ2VJZCwgZGlmZmljdWx0eU5hbWUgYXMgYW55KSk7IHRoaXMucnVuR29sZCArPSB0aGlzLmxhc3RHb2xkOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLXNhdmUtY2hhbmdlZCcpKTsgfSBjYXRjaCB7IHRoaXMubGFzdEdvbGQgPSAwOyB9XG4gICAgICAgIGlmIChpc0VuZGxlc3MoKSAmJiB0aGlzLmVuZGxlc3MpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgciA9IHJlY29yZEVuZGxlc3NXYXZlQW5kU2F2ZShzLndhdmUpOyB0aGlzLmVuZGxlc3MuY2xlYXJlZCA9IHMud2F2ZTsgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7XG4gICAgICAgICAgICBpZiAoci5wYWNrKSB7IHRoaXMuZW5kbGVzcy5wYWNrcysrOyB0aGlzLnRvYXN0KCdXYXZlICcgKyBzLndhdmUgKyAnIGNsZWFyZWQhIFlvdSBlYXJuZWQgYSBTb3VsIFBhY2sgKHNlZSB0aGUgU2hvcCkuJyk7IH1cbiAgICAgICAgICB9IGNhdGNoIHsgLyogc2F2aW5nIG11c3QgbmV2ZXIgYnJlYWsgYSBydW4gKi8gfVxuICAgICAgICB9XG4gICAgICAgIGlmIChhZHZhbmNlV2F2ZShzKSkge1xuICAgICAgICAgIHRoaXMucGhhc2UgPSAnd29uJzsgY2xlYXJSdW4oKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHRoaXMuZGFpbHkpIHsgdGhpcy5kYWlseVJld2FyZCA9IHJlY29yZERhaWx5V2luQW5kU2F2ZSh0aGlzLmRhaWx5LmRheSk7IHRoaXMucmV3YXJkID0gbnVsbDsgfSBlbHNlIHRoaXMucmV3YXJkID0gcmVjb3JkQ2xlYXJBbmRTYXZlKGN1cnJlbnRTdGFnZUlkLCBkaWZmaWN1bHR5TmFtZSBhcyBhbnkpO1xuICAgICAgICAgICAgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWNyby1zYXZlLWNoYW5nZWQnKSk7XG4gICAgICAgICAgfSBjYXRjaCB7IHRoaXMucmV3YXJkID0gbnVsbDsgfVxuICAgICAgICAgIHRoaXMudWkucmVuZGVyKCk7IHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmRyYWZ0ID0gZHJhZnRPcHRpb25zKHMpOyB0aGlzLnBoYXNlID0gJ2RyYWZ0JzsgdGhpcy5wZXJzaXN0UnVuKCk7IHRoaXMudWkucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmFpbFdhdmUocyk7IHRoaXMudWkucmVuZGVyKCk7IHRoaXMudWkucHVsc2VIZWFydHMoKTsgICAgICAgICAgICAgICAgICAgLy8gdGhlIGhlYXJ0IGlzIGxvc3QgdGhlIG1vbWVudCBoZSBpcyBoaXRcbiAgICAgIGlmIChzLnN0YXR1cyA9PT0gJ2xvc3QnKSB0aGlzLnBsYXlSZXN1bHQoJ2ZpbmFsJywgKCkgPT4geyB0aGlzLmNpbmUgPSBmYWxzZTsgdGhpcy5waGFzZSA9ICdsb3N0JzsgY2xlYXJSdW4oKTsgdGhpcy51aS5yZW5kZXIoKTsgfSk7XG4gICAgICBlbHNlIHRoaXMucGxheVJlc3VsdCgnbG9zcycsICgpID0+IHsgdGhpcy50b2FzdCgnWW91ciBhcm15IGZlbGwuIC0xIGhlYXJ0LCArMSBjYXJkLCBzYW1lIHdhdmUuIFJlYnVpbGQgYSBkaWZmZXJlbnQgc3RyYXRlZ3kuJyk7IHRoaXMudG9CdWlsZCgpOyB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIHJlc3VsdCBjdXRzY2VuZXMgKHBsYW4gc2VjdGlvbnMgMTktMjIpOiB0aGUgTmVjcm9tYW5jZXIgdGFrZXMgdGhlIGhpdCwgdW5sZWFzaGVzIHRoZSByZXB1bHNpb24gc2hvY2t3YXZlLCByYWlzZXMgdGhlIGZhbGxlblxuICBwcml2YXRlIHBsYXlSZXN1bHQoa2luZDogJ3dpbicgfCAnbG9zcycgfCAnZmluYWwnLCBkb25lOiAoKSA9PiB2b2lkKSB7XG4gICAgY29uc3QgYiA9IHRoaXMuYmF0dGxlISwgbiA9IHRoaXMubmVjcm87IHRoaXMuY2luZSA9IHRydWU7IGlmIChraW5kICE9PSAnd2luJykgdGhpcy50d2VlbkNhbSh0aGlzLnBvc2VzKCkubmVjcm8sIDEuMSk7XG4gICAgY29uc3QgaG9tZSA9ICgpID0+IHsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBldmVyeSBmYWxsZW4gYWxseSBpcyBwdWxsZWQgYmFjayB0byBpdHMgZ3JpZCB0aWxlIGFuZCBzdGFuZHMgdXBcbiAgICAgIG4uY2FzdCgpOyBhdWRpby5wbGF5KCdyZXN1cnJlY3QnKTsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpOyB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMC44NSwgMC41LCAxLCAwLjldLCBbMC41LCAwLjIsIDEsIDAuN10sIDMwKTtcbiAgICAgIGZvciAoY29uc3QgZiBvZiBiLmZpZ2h0ZXJzKSB7XG4gICAgICAgIGlmIChmLnRlYW0gIT09IDApIGNvbnRpbnVlOyBjb25zdCB1aWQgPSB0aGlzLmZVbml0LmdldChmLmlkKSwgdSA9IHRoaXMucy51bml0cy5maW5kKCh4KSA9PiB4LmlkID09PSB1aWQpLCB2ID0gdGhpcy5mdmlzLmdldChmLmlkKTsgaWYgKCF1IHx8ICF2KSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdG8gPSB0aGlzLnBvcyh1LmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpO1xuICAgICAgICBpZiAoIWYuYWxpdmUpIHsgdi5wbGF5KCdzcGF3bicpOyB0aGlzLmJ1cnN0KHgwLCB6MCwgWzAuNzUsIDAuNCwgMSwgMC45XSwgWzAuNCwgMC4xNSwgMC45LCAwLjddLCAxOCk7IHRoaXMuZnhSaW5nKHgwLCB6MCwgbmV3IEJBQllMT04uQ29sb3IzKDAuNywgMC4zNSwgMSksIDAuMywgMS42LCAwLjcpOyB9XG4gICAgICAgIHRoaXMudHdlZW4oMS4wLCAodCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoeDAgKyAodG8ueCAtIHgwKSAqIHQsIE1hdGguc2luKHQgKiBNYXRoLlBJKSAqIDAuNSwgejAgKyAodG8ueiAtIHowKSAqIHQpOyB2LmhvbGRlci5yb3RhdGlvbi55ICs9IChNYXRoLlBJIC8gMiAtIHYuaG9sZGVyLnJvdGF0aW9uLnkpICogTWF0aC5taW4oMSwgdCAqIDAuNSArIDAuMSk7IH0sXG4gICAgICAgICAgKCkgPT4geyB2LmhvbGRlci5wb3NpdGlvbi55ID0gMDsgdGhpcy5idXJzdCh0by54LCB0by56LCBbMC43NSwgMC40LCAxLCAwLjldLCBbMC40LCAwLjE1LCAwLjksIDAuN10sIDEwKTsgfSk7XG4gICAgICB9XG4gICAgfTtcbiAgICBpZiAoa2luZCA9PT0gJ3dpbicpIHtcbiAgICAgIC8vIHRoZSBzdXJ2aXZvcnMgY2VsZWJyYXRlIHJpZ2h0IHdoZXJlIHRoZXkgc3RhbmQgKHB1cmVseSB2aXN1YWwpLCBUSEVOIHRoZSBjYW1lcmEgc3dpbmdzIHRvIHRoZSBOZWNyb21hbmNlciBhbmQgdGhlIGFybXkgaXMgcmFpc2VkXG4gICAgICBhdWRpby5wbGF5KCd2aWN0b3J5Jyk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykgaWYgKGYudGVhbSA9PT0gMCAmJiBmLmFsaXZlKSB7IGNvbnN0IHYgPSB0aGlzLmZ2aXMuZ2V0KGYuaWQpOyBpZiAodikgdGhpcy5sYXRlcihNYXRoLnJhbmRvbSgpICogMC4zNSwgKCkgPT4geyB2LnBsYXkoJ2NoZWVyJyk7IGF1ZGlvLmJhcmsoZi5zb3VsKTsgfSk7IH1cbiAgICAgIHRoaXMubGF0ZXIoMS42LCAoKSA9PiB7IHRoaXMudHdlZW5DYW0odGhpcy5wb3NlcygpLm5lY3JvLCAxLjEpOyBuLmNhc3QoKTsgfSk7XG4gICAgICB0aGlzLmxhdGVyKDEuODUsIGhvbWUpOyB0aGlzLmxhdGVyKDMuNiwgZG9uZSk7IHJldHVybjtcbiAgICB9XG4gICAgbi5odXJ0KCk7IGF1ZGlvLnBsYXkoJ2hlYXJ0TG9zdCcpOyB0aGlzLmxhdGVyKDAuMTUsICgpID0+IHsgY29uc3QgYyA9IG4uY3J5c3RhbFBvcygpOyB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMSwgMC4zLCAwLjMsIDAuOV0sIFswLjgsIDAuMSwgMC4yLCAwLjZdLCAxNik7IH0pO1xuICAgIGlmIChraW5kID09PSAnZmluYWwnKSB7IHRoaXMubGF0ZXIoMC42LCAoKSA9PiB7IG4uZGVmZWF0KCk7IGF1ZGlvLnBsYXkoJ2RlZmVhdCcpOyB9KTsgdGhpcy5sYXRlcigyLjYsIGRvbmUpOyByZXR1cm47IH1cbiAgICB0aGlzLmxhdGVyKDEuMCwgKCkgPT4geyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlcHVsc2lvbiBzaG9ja3dhdmU6IHN1cnZpdm9ycyBhcmUgZmx1bmcgYmFjayB0byB3aGVyZSB0aGV5IHN0YXJ0ZWQgYW5kIGhlYWwgdG8gZnVsbFxuICAgICAgbi5jYXN0KCk7IGF1ZGlvLnBsYXkoJ3Nob2Nrd2F2ZScpOyBjb25zdCBjID0gbi5jcnlzdGFsUG9zKCk7XG4gICAgICB0aGlzLmZ4UmluZyhjLngsIDAsIG5ldyBCQUJZTE9OLkNvbG9yMygwLjg1LCAwLjU1LCAxKSwgMC42LCAzMCwgMS4xKTsgdGhpcy5meFJpbmcoYy54LCAwLCBuZXcgQkFCWUxPTi5Db2xvcjMoMSwgMSwgMSksIDAuNCwgMjIsIDAuOCk7XG4gICAgICB0aGlzLmJ1cnN0KGMueCwgYy56LCBbMSwgMC44NSwgMSwgMC45XSwgWzAuNywgMC40LCAxLCAwLjddLCA0MCk7XG4gICAgICBmb3IgKGNvbnN0IGYgb2YgYi5maWdodGVycykge1xuICAgICAgICBpZiAoZi50ZWFtICE9PSAxIHx8ICFmLmFsaXZlKSBjb250aW51ZTsgY29uc3QgdiA9IHRoaXMuZnZpcy5nZXQoZi5pZCk7IGlmICghdikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRvID0gY2VsbFBvcygxLCBmLmNlbGwpLCB4MCA9IHYuaG9sZGVyLnBvc2l0aW9uLngsIHowID0gdi5ob2xkZXIucG9zaXRpb24uejsgdi5wdWxzZSgpO1xuICAgICAgICB0aGlzLnR3ZWVuKDAuOSwgKHQpID0+IHsgdi5ob2xkZXIucG9zaXRpb24uc2V0KHgwICsgKHRvLnggLSB4MCkgKiB0LCBNYXRoLnNpbih0ICogTWF0aC5QSSkgKiAwLjksIHowICsgKHRvLnogLSB6MCkgKiB0KTsgdi5zZXRIcChmLmhwIC8gZi5tYXhIcCArICgxIC0gZi5ocCAvIGYubWF4SHApICogdCk7IH0sICgpID0+IHsgdi5ob2xkZXIucG9zaXRpb24ueSA9IDA7IHYuc2V0SHAoMSk7IH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHRoaXMubGF0ZXIoMi4zLCBob21lKTsgdGhpcy5sYXRlcigzLjcsIGRvbmUpO1xuICB9XG4gIHBpY2tEcmFmdChpZHg6IG51bWJlcikgeyBpZiAoIXRoaXMuZHJhZnQpIHJldHVybjsgdGFrZURyYWZ0KHRoaXMucywgdGhpcy5kcmFmdCwgaWR4KTsgdGhpcy5kcmFmdCA9IG51bGw7IG5vcm1hbERyYXcodGhpcy5zKTsgdGhpcy50b0J1aWxkKCk7IH1cbiAgcHJpdmF0ZSB0b0J1aWxkKCkge1xuICAgIHRoaXMuY2luZSA9IGZhbHNlOyB0aGlzLm5lY3JvLnJldml2ZSgpOyB0aGlzLmZsdXNoVHdlZW5zKCk7XG4gICAgdGhpcy5jbGVhckJhdHRsZSgpOyB0aGlzLnNob3dHcmlkKHRydWUpO1xuICAgIGZvciAoY29uc3QgdSBvZiB0aGlzLnMudW5pdHMpIHsgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlc3VycmVjdGlvbjogZXZlcnlvbmUgcmlzZXMgYWdhaW4gYXQgZnVsbCBoZWFsdGhcbiAgICAgIGNvbnN0IHYgPSB0aGlzLnVuaXRWaXMuZ2V0KHUuaWQpITsgY29uc3QgcCA9IHRoaXMucG9zKHUuY2VsbCk7IHYuaG9sZGVyLnBvc2l0aW9uLnNldChwLngsIDAsIHAueik7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJIC8gMjsgdi5ob2xkZXIuc2V0RW5hYmxlZCh0cnVlKTsgdi5zZXRIcChudWxsKTsgdi5zZXRNYW5hKG51bGwpOyB2LnBsYXkoJ3NwYXduJyk7IHRoaXMuc3VtbW9uRngocC54LCBwLnopO1xuICAgICAgdGhpcy5sYXRlcigxLjEsICgpID0+IHYucGxheSgnaWRsZScpKTtcbiAgICB9XG4gICAgdGhpcy5waGFzZSA9ICdidWlsZCc7IHRoaXMuc2VsID0gbnVsbDsgdGhpcy5zeW5jQnVpbGQoKTsgdGhpcy51aS5yZW5kZXIoKTsgICAgICAgICAgLy8gVUkgZmlyc3Q6IHRoZSBjYW1lcmEgbXVzdCBtZWFzdXJlIHRoZSBoYW5kIGFuZCBidXR0b25zIHdoaWxlIHRoZXkgYXJlIHZpc2libGVcbiAgICB0aGlzLnR3ZWVuQ2FtKHRoaXMucG9zZXMoKS5idWlsZCwgMS44KTtcbiAgfVxuICAvKiogMnggYW5kIDR4IGJhdHRsZSBzcGVlZCBvcGVuIG9uY2UgdGhlIGNhbXBhaWduIGlzIGZpbmlzaGVkICh0aGUgbGFzdCBzdGFnZSBjbGVhcmVkIG9uIE5vcm1hbCkuID9kZWJ1ZyBvciA/c3BlZWQ9MSBvcGVucyB0aGVtIGZvciB0ZXN0aW5nLiAqL1xuICBzcGVlZFVubG9ja2VkKCk6IGJvb2xlYW4geyBjb25zdCBxID0gbmV3IFVSTFNlYXJjaFBhcmFtcyhsb2NhdGlvbi5zZWFyY2gpOyByZXR1cm4gISEocS5nZXQoJ2RlYnVnJykgfHwgcS5nZXQoJ3NwZWVkJykpIHx8IGVuZGxlc3NVbmxvY2tlZChsb2FkU2F2ZSgpKTsgfVxuICBzZXRTcGVlZChrOiBudW1iZXIpIHtcbiAgICBpZiAoayA+IDEgJiYgIXRoaXMuc3BlZWRVbmxvY2tlZCgpKSByZXR1cm47XG4gICAgdGhpcy50aW1lU2NhbGUgPSBrOyB0aGlzLnVpLnJlbmRlcigpO1xuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZGVidWcgaGVscGVyc1xuICBhcHBseUJhbGFuY2VDaGFuZ2UoKSB7IHRoaXMudW5pdFZpcy5mb3JFYWNoKCh2LCBpZCkgPT4geyBjb25zdCB1ID0gdGhpcy5zLnVuaXRzLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKTsgaWYgKHUpIHYuc2V0U3Rhcih1LnN0YXIpOyB9KTsgfVxuICB0ZXN0T2RkcyhuID0gMjAwKSB7XG4gICAgY29uc3Qgc2xvdHMgPSB0aGlzLnMudW5pdHMubWFwKCh1KSA9PiAoeyBzb3VsOiB1LnNvdWwsIHN0YXI6IHUuc3RhciwgY2VsbDogdS5jZWxsIH0pKSwgZW5lbWllcyA9IGVuZW15V2F2ZSh0aGlzLnMud2F2ZSwgdGhpcy5zZWVkKTsgbGV0IHdpbiA9IDAsIHQgPSAwO1xuICAgIGNvbnN0IGx2OiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge30sIHN2ID0gbG9hZFNhdmUoKS5zb3VsczsgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHN2KSkgbHZba10gPSAoc3YgYXMgYW55KVtrXS5sZXZlbDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykgeyBjb25zdCByID0gc2ltdWxhdGUoc2xvdHMsIGVuZW1pZXMsIDUwMDAgKyBpLCAxMzAsIGx2LCBlbmVteVBvd2VyKCkpOyBpZiAoci53aW5uZXIgPT09IDApIHdpbisrOyB0ICs9IHIudGltZTsgfVxuICAgIHJldHVybiB7IHdpbjogTWF0aC5yb3VuZCgod2luIC8gbikgKiAxMDApLCBhdmdUaW1lOiArKHQgLyBuKS50b0ZpeGVkKDEpLCBuIH07XG4gIH1cbiAgYWRkQ2FyZChzb3VsOiBTb3VsSWQpIHsgdGhpcy5zLmhhbmQucHVzaChzb3VsKTsgdGhpcy5zLnN0YXRzLmRyYXduKys7IHRoaXMudWkucmVuZGVyKCk7IH1cbiAgYWRkRG9taW5pb24objogbnVtYmVyKSB7IHRoaXMucy5jYXAgKz0gbjsgdGhpcy51aS5yZW5kZXIoKTsgfVxuICByZXBvcnQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBzID0gdGhpcy5zLCBlbiA9IGVuZW15V2F2ZShzLndhdmUsIHRoaXMuc2VlZCk7XG4gICAgcmV0dXJuIFtgc3RhZ2UgJHtjdXJyZW50U3RhZ2VJZH0vJHtkaWZmaWN1bHR5TmFtZX0gIHNlZWQgJHt0aGlzLnNlZWR9ICB3YXZlICR7cy53YXZlfS8ke3N0YWdlV2F2ZXMocyl9ICBoZWFydHMgJHtzLmhlYXJ0c30gIGRvbWluaW9uICR7ZG9taW5pb25Vc2VkKHMpfS8ke3MuY2FwfSAgcGhhc2UgJHt0aGlzLnBoYXNlfSAgYXR0ZW1wdCAke3RoaXMuYXR0ZW1wdH1gLFxuICAgICAgYGhhbmQ6ICR7cy5oYW5kLmpvaW4oJywgJykgfHwgJyhlbXB0eSknfWAsIGBhcm15OiAke3MudW5pdHMubWFwKCh1KSA9PiBgJHt1LnNvdWx9JHt1LnN0YXJ9QCR7dS5jZWxsfWApLmpvaW4oJyAnKSB8fCAnKG5vbmUpJ31gLCBgZW5lbXk6ICR7ZW4ubWFwKChlKSA9PiBlLnNvdWwgKyBlLnN0YXIpLmpvaW4oJyAnKX1gLFxuICAgICAgYGRpZmZpY3VsdHk6ICR7ZGlmZmljdWx0eU5hbWV9ICBtZXJnZS1mcm9tLWhhbmQ6ICR7cy5ydWxlcy5tZXJnZSA9PT0gJ2hhbmRJbnRvT25lU3Rhcid9ICBzd2FwIHVzZWQ6ICR7cy5kaXNjYXJkVXNlZH1gLCBgbGFzdCB0YXA6ICR7dGhpcy5sYXN0VGFwSW5mb31gLCBgc2NyZWVuOiAke3RoaXMuY2FudmFzLmNsaWVudFdpZHRofXgke3RoaXMuY2FudmFzLmNsaWVudEhlaWdodH0gZHByICR7d2luZG93LmRldmljZVBpeGVsUmF0aW99YCwgYGxhc3QgYmF0dGxlOiAke3RoaXMubGFzdEJhdHRsZSB8fCAnLSd9YCwgYGxvZyB0YWlsOmAsIC4uLnMubG9nLnNsaWNlKC04KSwgYGJhbGFuY2U6ICR7SlNPTi5zdHJpbmdpZnkoeyBzdGFyOiBCQUxBTkNFLnN0YXIsIHN0YXRzOiBCQUxBTkNFLnN0YXRzIH0pfWBdLmpvaW4oJ1xcbicpO1xuICB9XG4gIHJlc2V0QmFsYW5jZUFsbCgpIHsgcmVzZXRCYWxhbmNlKCk7IHRoaXMuYXBwbHlCYWxhbmNlQ2hhbmdlKCk7IH1cbiAgZ2V0IGRpZmZpY3VsdHkoKSB7IHJldHVybiBkaWZmaWN1bHR5TmFtZTsgfVxuICBjaGFuZ2VEaWZmaWN1bHR5KG5hbWU6IHN0cmluZykgeyBzZXREaWZmaWN1bHR5KG5hbWUpOyB0aGlzLnVpLnJlbmRlcigpOyB0aGlzLnRvYXN0KGBEaWZmaWN1bHR5OiAke25hbWV9LiBBcHBsaWVzIHRvIHRoZSBuZXh0IGJhdHRsZS5gKTsgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGdhbGxlcnkgKHN0YXIgbG9va3MpXG4gIGdhbGxlcnkoKSB7XG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QuYWRkKCdnYWxsZXJ5Jyk7IHRoaXMubmVjcm8uc2V0RW5hYmxlZChmYWxzZSk7IGNvbnN0IHZpczogVW5pdFZpc3VhbFtdID0gW107IGxldCB0ZWFtOiAwIHwgMSA9IDA7XG4gICAgY29uc3QgcmVidWlsZCA9ICgpID0+IHsgdmlzLmZvckVhY2goKHYpID0+IHYuZGlzcG9zZSgpKTsgdmlzLmxlbmd0aCA9IDA7IFNPVUxTLmZvckVhY2goKHNvdWwsIGkpID0+IFsxLCAyLCAzXS5mb3JFYWNoKChzdCwgaikgPT4geyBjb25zdCB2ID0gY3JlYXRlVmlzdWFsKHRoaXMuQSwgc291bCwgdGVhbSwgc3QpOyB2LmhvbGRlci5wb3NpdGlvbi5zZXQoKGkgLSAyLjUpICogMi41LCAwLCAoaiAtIDEpICogLTIuNCk7IHYuaG9sZGVyLnJvdGF0aW9uLnkgPSBNYXRoLlBJICogMC44NTsgdi5wbGF5KCdpZGxlJyk7IHZpcy5wdXNoKHYpOyB9KSk7IH07XG4gICAgcmVidWlsZCgpOyB0aGlzLmNhbWVyYS5wb3NpdGlvbi5zZXQoMCwgNS42LCAtMTQuNSk7IHRoaXMuY2FtZXJhLnNldFRhcmdldChuZXcgQkFCWUxPTi5WZWN0b3IzKDAsIDAuNSwgLTAuNCkpOyB0aGlzLmNhbWVyYS5mb3YgPSAwLjg1O1xuICAgICh3aW5kb3cgYXMgYW55KS5fX2dhbGxlcnkgPSB7IHNldFRlYW06ICh0OiAwIHwgMSkgPT4geyB0ZWFtID0gdDsgcmVidWlsZCgpOyB9LCB2aXMgfTtcbiAgICBsZXQgbGFzdCA9IHBlcmZvcm1hbmNlLm5vdygpOyB0aGlzLmVuZ2luZS5ydW5SZW5kZXJMb29wKCgpID0+IHsgY29uc3QgbiA9IHBlcmZvcm1hbmNlLm5vdygpLCBkdCA9IE1hdGgubWluKDAuMDUsIChuIC0gbGFzdCkgLyAxMDAwKTsgbGFzdCA9IG47IHZpcy5mb3JFYWNoKCh2KSA9PiB2LnVwZGF0ZShkdCkpOyB0aGlzLnNjZW5lLnJlbmRlcigpOyB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEdhbWUgfSBmcm9tICcuL2dhbWUudHMnO1xuXG5jb25zdCBnID0gbmV3IEdhbWUoKTtcbih3aW5kb3cgYXMgYW55KS5fX2dhbWUgPSBnOyAgICAgICAgICAgICAgICAgICAgICAgLy8gaGFuZHkgZm9yIGRlYnVnZ2luZyBmcm9tIHRoZSBicm93c2VyIGNvbnNvbGVcbmcuaW5pdChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYycpIGFzIEhUTUxDYW52YXNFbGVtZW50KVxuICAudGhlbigoKSA9PiB7IGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnOyAod2luZG93IGFzIGFueSkuX19nYW1lUmVhZHkgPSB0cnVlOyB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lY3JvLWdhbWUtcmVhZHknKSk7IH0pXG4gIC5jYXRjaCgoZSkgPT4ge1xuICAgIGNvbnN0IGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9hZGluZycpOyBpZiAobCkgeyBsLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7IGwudGV4dENvbnRlbnQgPSAnRXJyb3I6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBlKTsgfVxuICAgIGNvbnNvbGUuZXJyb3IoZSk7XG4gIH0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBb0NPLE1BQU0sV0FBb0I7QUFBQSxJQUMvQixPQUFPO0FBQUEsTUFDTCxTQUFXLEVBQUUsSUFBSSxJQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxNQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsS0FBSztBQUFBLE1BQy9HLFFBQVcsRUFBRSxJQUFJLElBQUssS0FBSyxHQUFJLFVBQVUsS0FBSyxPQUFPLEdBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEtBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csUUFBVyxFQUFFLElBQUksSUFBSyxLQUFLLEdBQUksVUFBVSxLQUFLLE9BQU8sS0FBTSxPQUFPLEtBQUssTUFBTSxNQUFNLFNBQVMsR0FBSyxTQUFTLElBQUk7QUFBQSxNQUM5RyxRQUFXLEVBQUUsSUFBSSxLQUFLLEtBQUssR0FBSSxVQUFVLEtBQUssT0FBTyxLQUFNLE9BQU8sR0FBSyxNQUFNLE1BQU0sU0FBUyxHQUFLLFNBQVMsSUFBSTtBQUFBLE1BQzlHLE1BQVcsRUFBRSxJQUFJLEtBQUssS0FBSyxJQUFJLFVBQVUsS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxTQUFTLEtBQUssU0FBUyxLQUFLO0FBQUEsTUFDL0csV0FBVyxFQUFFLElBQUksS0FBSyxLQUFLLElBQUksVUFB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LEdBQUcsTUFBTSxHQUFHLEdBQUssS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxHQUFLLEtBQUssS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDcEwsRUFBRSxNQUFNLFNBQVMsR0FBRyxJQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxHQUFLLEdBQUcsS0FBSztBQUFBLElBQy9JLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLEVBQ3hOO0FBQ0EsTUFBTSxtQkFBZ0M7QUFBQTtBQUFBLElBQ3BDLEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUNsRSxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsTUFBTSxHQUFHLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFDeE0sRUFBRSxNQUFNLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssRUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sVUFBVSxHQUFHLElBQUksR0FBRyxHQUFLLEtBQUssSUFBSTtBQUFBLElBQ3JNLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFDbkgsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQ3RJLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDckgsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDbk4sRUFBRSxNQUFNLFNBQVMsR0FBRyxHQUFHLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEdBQUssR0FBRyxJQUFJO0FBQUEsRUFDdk47QUFDQSxNQUFNLGlCQUE4QjtBQUFBO0FBQUEsSUFDbEMsRUFBRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsR0FBRyxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQzFILEVBQUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFFBQVEsR0FBRyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsS0FBSyxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQUEsSUFDdkssRUFBRSxNQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsS0FBSyxLQUFLLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxLQUFLLEtBQUssTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLE1BQU0sS0FBSyxLQUFLO0FBQUEsSUFBRyxFQUFFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxNQUFNLEtBQUssS0FBSztBQUFBLElBQ3pNLEVBQUUsTUFBTSxVQUFVLEdBQUcsT0FBTyxHQUFHLEtBQUssS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFVBQVUsR0FBRyxNQUFNLEdBQUcsS0FBSyxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFDNUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxLQUFLLEdBQUcsSUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxPQUFPLEdBQUcsRUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxNQUFNLEdBQUcsRUFBSTtBQUFBLElBQUcsRUFBRSxNQUFNLFdBQVcsR0FBRyxNQUFNLEdBQUcsTUFBTSxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxXQUFXLEdBQUcsS0FBSyxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQUEsSUFDbFAsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFBLElBQUcsRUFBRSxNQUFNLFNBQVMsR0FBRyxPQUFPLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDOU8sRUFBRSxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxJQUFJO0FBQUEsSUFBRyxFQUFFLE1BQU0sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssR0FBSyxHQUFHLElBQUk7QUFBQSxJQUFHLEVBQUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLElBQU0sS0FBSyxLQUFLLEdBQUcsSUFBSTtBQUFBLEVBQ2xLO0FBS0EsTUFBTSxTQUFnQztBQUFBLElBQ3BDLE9BQU8sRUFBRSxRQUFRLGNBQWMsT0FBTyxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsS0FBSyxDQUFDLE1BQU0sTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLEtBQUssS0FBSyxJQUFJLEdBQUcsTUFBTSxDQUFDLE1BQU0sTUFBTSxHQUFHLEdBQUcsUUFBUSxDQUFDLE1BQU0sR0FBRyxHQUFHLEdBQUcsUUFBUSxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsTUFBTSxDQUFDLE1BQU0sTUFBTSxJQUFJLEVBQUU7QUFBQSxJQUM1TSxXQUFXLEVBQUUsUUFBUSxrQkFBa0IsT0FBTyxDQUFDLE1BQU0sTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLE1BQU0sTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLE1BQU0sS0FBSyxJQUFJLEdBQUcsTUFBTSxDQUFDLEtBQUssTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLE1BQU0sR0FBRyxHQUFHLEdBQUcsUUFBUSxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsTUFBTSxDQUFDLEtBQUssS0FBSyxJQUFJLEVBQUU7QUFBQSxJQUN0TixTQUFTLEVBQUUsUUFBUSxjQUFjLE9BQU8sQ0FBQyxNQUFNLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxNQUFNLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxNQUFNLEtBQUssR0FBRyxHQUFHLE1BQU0sQ0FBQyxNQUFNLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxHQUFHLE1BQU0sR0FBRyxHQUFHLFFBQVEsQ0FBQyxLQUFLLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxLQUFLLE1BQU0sR0FBRyxFQUFFO0FBQUEsSUFDbE4sU0FBUyxFQUFFLFFBQVEsZ0JBQWdCLE9BQU8sQ0FBQyxLQUFLLE1BQU0sR0FBRyxHQUFHLEtBQUssQ0FBQyxNQUFNLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxLQUFLLEtBQUssSUFBSSxHQUFHLE1BQU0sQ0FBQyxNQUFNLE1BQU0sQ0FBQyxHQUFHLFFBQVEsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxHQUFHLFFBQVEsQ0FBQyxLQUFLLEtBQUssSUFBSSxHQUFHLE1BQU0sQ0FBQyxNQUFNLEtBQUssSUFBSSxFQUFFO0FBQUEsRUFDaE47QUFJQSxXQUFTLE1BQU0sT0FBWSxLQUFVLEdBQVcsR0FBVyxHQUFXLEdBQVcsR0FBTyxHQUFZO0FBQ2xHLFVBQU0sS0FBSyxJQUFJLFFBQVEsZUFBZSxRQUFRLElBQUksS0FBSztBQUFHLE9BQUcsa0JBQWtCO0FBQUssT0FBRyxVQUFVLElBQUksUUFBUSxRQUFRLEdBQUcsR0FBRyxDQUFDO0FBQzVILE9BQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxRQUFRLEdBQUcsR0FBRyxRQUFRLENBQUM7QUFBRyxPQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsT0FBTyxHQUFHLEdBQUcsT0FBTyxDQUFDO0FBQ3ZILE9BQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxNQUFNLEdBQUcsSUFBSTtBQUFHLE9BQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxLQUFLLEtBQUssR0FBRztBQUNyRyxPQUFHLGNBQWM7QUFBSyxPQUFHLGNBQWM7QUFBSyxPQUFHLFdBQVc7QUFBSSxPQUFHLFVBQVUsT0FBTztBQUFHLE9BQUcsVUFBVSxNQUFNO0FBQUcsT0FBRyxlQUFlLE1BQU07QUFBRyxPQUFHLGVBQWUsSUFBTTtBQUM5SixPQUFHLFNBQVMsSUFBSSxRQUFRLE9BQU8sRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRztBQUFHLE9BQUcsU0FBUyxJQUFJLFFBQVEsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHO0FBQUcsT0FBRyxZQUFZLElBQUksUUFBUSxPQUFPLEVBQUUsQ0FBQyxJQUFJLEtBQUssRUFBRSxDQUFDLElBQUksS0FBSyxFQUFFLENBQUMsSUFBSSxLQUFLLENBQUM7QUFDckwsT0FBRyxZQUFZLFFBQVEsZUFBZTtBQUFlLE9BQUcsVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssQ0FBQztBQUFHLE9BQUcsTUFBTTtBQUFHLFdBQU87QUFBQSxFQUN2SDtBQUdBLFdBQVMsWUFBWSxPQUFpQjtBQUNwQyxVQUFNLElBQUksSUFBSSxRQUFRLGVBQWUsUUFBUSxFQUFFLE9BQU8sSUFBSSxRQUFRLEdBQUcsR0FBRyxPQUFPLElBQUksR0FBRyxJQUFJLEVBQUUsV0FBVyxHQUFHQSxLQUFJLEVBQUUscUJBQXFCLElBQUksSUFBSSxHQUFHLElBQUksSUFBSSxFQUFFO0FBQzFKLElBQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUFHLElBQUFBLEdBQUUsYUFBYSxLQUFLLHdCQUF3QjtBQUFHLElBQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUNoSSxNQUFFLFlBQVlBO0FBQUcsTUFBRSxTQUFTLEdBQUcsR0FBRyxJQUFJLEVBQUU7QUFBRyxNQUFFLE9BQU87QUFBRyxNQUFFLFdBQVc7QUFBTSxXQUFPO0FBQUEsRUFDbkY7QUFHQSxpQkFBZSxRQUFRLE9BQWdEO0FBQ3JFLFVBQU0sTUFBTSxNQUFNLFFBQVEsWUFBWSx3QkFBd0IsaUJBQWlCLGFBQWEsS0FBSztBQUNqRyxRQUFJLGNBQWM7QUFDbEIsVUFBTSxPQUFPLElBQUksT0FBTyxLQUFLLENBQUMsTUFBVyxFQUFFLFNBQVMsVUFBVSxHQUFHLE1BQTJCLENBQUM7QUFDN0YsZUFBVyxLQUFLLElBQUksT0FBUSxLQUFJLEVBQUUsU0FBUyxjQUFjLEVBQUUsaUJBQWlCLElBQUksR0FBRztBQUFFLFVBQUksRUFBRSxJQUFJLElBQUk7QUFBRyxRQUFFLFdBQVcsS0FBSztBQUFHLFFBQUUsYUFBYTtBQUFBLElBQU87QUFDakosVUFBTSxPQUFPLFlBQVksS0FBSztBQUFHLFFBQUksT0FBeUMsRUFBRSxTQUFTLENBQUMsR0FBRyxPQUFPLENBQUMsRUFBRSxHQUFHLElBQUk7QUFDOUcsV0FBTztBQUFBLE1BQ0wsTUFBTSxHQUFVO0FBMUZwQjtBQTJGTSxtQkFBVyxLQUFLLEtBQUssUUFBUyxHQUFFLFFBQVE7QUFBRyxtQkFBVyxLQUFLLEtBQUssTUFBTyxHQUFFLFFBQVEsS0FBSztBQUN0RixtQkFBVyxLQUFLLEVBQUUsUUFBUTtBQUN4QixnQkFBTSxPQUFPLElBQUksRUFBRSxJQUFJO0FBQUcsY0FBSSxDQUFDLEtBQU07QUFDckMsZ0JBQU0sT0FBTyxLQUFLLGVBQWUsRUFBRSxPQUFPLEdBQUc7QUFBRyxlQUFLLGFBQWE7QUFDbEUsZUFBSyxzQkFBcUIsZ0JBQUssdUJBQUwsbUJBQXlCLFlBQXpCLFlBQW9DO0FBQU0sY0FBSSxDQUFDLEtBQUssbUJBQW9CLE1BQUssV0FBVyxLQUFLLFNBQVMsTUFBTTtBQUFHLGVBQUssVUFBVSxLQUFLLFFBQVEsTUFBTTtBQUMzSyxnQkFBTSxTQUFTLElBQUksUUFBUSxjQUFjLFdBQVcsR0FBRyxLQUFLO0FBQUcsaUJBQU8sU0FBUyxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUFHLGlCQUFPLFNBQVMsS0FBSSxPQUFFLFFBQUYsWUFBUztBQUFHLGlCQUFPLFFBQVEsUUFBTyxPQUFFLE1BQUYsWUFBTyxDQUFDO0FBQy9KLGVBQUssU0FBUztBQUFRLGVBQUssUUFBUSxLQUFLLE1BQU07QUFDOUMsY0FBSSxFQUFFLFNBQVMsVUFBVyxNQUFLLE1BQU0sS0FBSyxNQUFNLE9BQU8sTUFBTSxFQUFFLEdBQUcsU0FBUSxPQUFFLE1BQUYsWUFBTyxJQUFJLEVBQUUsSUFBRyxPQUFFLE1BQUYsWUFBTyxHQUFHLEVBQUUsUUFBUSxFQUFFLE1BQU0sQ0FBQztBQUFBLFFBQ3pIO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRU8sV0FBUyxXQUFXLE9BQVksUUFBeUU7QUFFOUcsVUFBTSxNQUFNLElBQUksUUFBUSxRQUFRLDJCQUEyQixPQUFPLE9BQU8sTUFBTSxRQUFRLFFBQVEsc0JBQXNCO0FBQ3JILFFBQUksU0FBUyxLQUFLO0FBQWEsUUFBSSxTQUFTLEtBQUs7QUFBYSxRQUFJLDRCQUE0QjtBQUM5RixVQUFNLEtBQUssSUFBSSxRQUFRLGlCQUFpQixNQUFNLEtBQUs7QUFBRyxPQUFHLGlCQUFpQjtBQUFLLE9BQUcsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQ3ZILE9BQUcsZUFBZSxJQUFJLFFBQVEsT0FBTyxNQUFNLEtBQUssR0FBRztBQUFHLFdBQU8sV0FBVztBQUd4RSxVQUFNLFFBQVEsUUFBUSxZQUFZLGFBQWEsU0FBUyxFQUFFLE9BQU8sS0FBSyxRQUFRLElBQUksR0FBRyxLQUFLO0FBQzFGLFVBQU0sU0FBUyxJQUFJO0FBQU8sVUFBTSxhQUFhO0FBQzdDLFVBQU0sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sS0FBSztBQUFHLE9BQUcsaUJBQWlCLFlBQVksS0FBSztBQUFHLE9BQUcsZUFBZSxXQUFXO0FBQU0sT0FBRyw2QkFBNkI7QUFDakssT0FBRyxnQkFBZ0IsSUFBSSxRQUFRLE9BQU8sTUFBTSxNQUFNLElBQUk7QUFBRyxPQUFHLGtCQUFrQjtBQUFNLE9BQUcsUUFBUTtBQUFNLE9BQUcsa0JBQWtCO0FBQU8sVUFBTSxXQUFXO0FBR2xKLFVBQU0sYUFBYSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sTUFBTSxDQUFDO0FBQ3pELFVBQU0sVUFBVSxRQUFRLE1BQU07QUFBZ0IsVUFBTSxXQUFXLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxJQUFJO0FBQUcsVUFBTSxXQUFXO0FBQUksVUFBTSxTQUFTO0FBRXpJLFVBQU0sT0FBTyxVQUFVLE9BQU8sR0FBRztBQUNqQyxRQUFJLE1BQXdDLE1BQU0sT0FBTyxTQUFTLFFBQVE7QUFDMUUsVUFBTSxPQUFPLE1BQU07QUEzSHJCO0FBNEhJLFlBQU0sS0FBSSxZQUFPLElBQUksTUFBWCxZQUFnQixPQUFPO0FBQU8sVUFBSSxTQUFTLFNBQVMsSUFBSztBQUNuRSxZQUFNLE1BQU0sQ0FBQyxNQUFVLElBQUksUUFBUSxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQzFELFNBQUcsZUFBZSxJQUFJLEVBQUUsS0FBSztBQUFHLFdBQUssUUFBUSxlQUFlLElBQUksRUFBRSxJQUFJO0FBQUcsU0FBRyxnQkFBZ0IsSUFBSSxFQUFFLElBQUk7QUFDdEcsaUJBQVcsS0FBSyxLQUFLLFNBQVUsR0FBRSxnQkFBZ0IsSUFBSSxFQUFFLElBQUk7QUFDM0QsWUFBTSxXQUFXLElBQUksRUFBRSxHQUFHO0FBQUcsWUFBTSxhQUFhLElBQUksUUFBUSxPQUFPLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUM7QUFDbEcsVUFBSSxLQUFLO0FBQUUsWUFBSSxNQUFNLENBQUM7QUFBRyxnQkFBUTtBQUFBLE1BQU07QUFBQSxJQUN6QztBQUNBLFlBQVEsS0FBSyxFQUFFLEtBQUssQ0FBQyxNQUFNO0FBQUUsWUFBTTtBQUFHLGNBQVE7QUFBSSxXQUFLO0FBQUEsSUFBRyxDQUFDLEVBQUUsTUFBTSxDQUFDLE1BQU0sUUFBUSxLQUFLLHNCQUFzQixDQUFDLENBQUM7QUFFL0csV0FBTyxFQUFFLFFBQVEsQ0FBQyxNQUFjO0FBQUUsU0FBRyxRQUFRLE9BQU8sT0FBTyxLQUFLLElBQUksSUFBSSxHQUFHO0FBQUcsV0FBSyxPQUFPLENBQUM7QUFBQSxJQUFHLEdBQUcsVUFBVSxDQUFDLFVBQWtCO0FBQUUsYUFBTztBQUFPLFdBQUs7QUFBQSxJQUFHLEVBQUU7QUFBQSxFQUMxSjtBQUdBLE1BQU0sS0FBSztBQUFYLE1BQWUsS0FBSztBQUFwQixNQUF3QixLQUFLO0FBQTdCLE1BQWlDLFNBQVM7QUFDMUMsTUFBTSxTQUFTLENBQUMsR0FBVyxNQUFzQixLQUFLLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksTUFBTSxLQUFLLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxJQUFJLE1BQU0sS0FBSyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUk7QUFFNUssV0FBUyxZQUFZLE9BQVksTUFBbUI7QUFDbEQsVUFBTSxJQUFJLEtBQUssSUFBSSxJQUFJLFFBQVEsZUFBZSxTQUFTLE1BQU0sRUFBRSxPQUFPLEdBQUcsUUFBUSxFQUFFLEdBQUcsT0FBTyxJQUFJLEdBQUcsSUFBSSxFQUFFLFdBQVc7QUFDckgsTUFBRSxVQUFVLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFDdEIsUUFBSSxJQUFJLE9BQU8sT0FBTztBQUFPLFVBQU0sTUFBTSxPQUFPLEtBQUssSUFBSSxPQUFPLFNBQVMsVUFBVTtBQUNuRixhQUFTLElBQUksR0FBRyxJQUFJLElBQUksS0FBSztBQUMzQixZQUFNLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxJQUFJLElBQUksR0FBRyxNQUFNLEtBQUssSUFBSSxJQUFJO0FBQ3ZELGlCQUFXLE1BQU0sQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUcsWUFBVyxNQUFNLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHO0FBQ3hELGNBQU1BLEtBQUksRUFBRSxxQkFBcUIsSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksR0FBRztBQUFHLFFBQUFBLEdBQUUsYUFBYSxHQUFHLHVCQUF1QjtBQUFHLFFBQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUM3SixVQUFFLFlBQVlBO0FBQUcsVUFBRSxTQUFTLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFBQSxNQUN4QztBQUFBLElBQ0Y7QUFDQSxNQUFFLE9BQU87QUFBRyxNQUFFLFdBQVc7QUFBTSxNQUFFLFFBQVEsRUFBRSxRQUFRLFFBQVEsUUFBUTtBQUFrQixXQUFPO0FBQUEsRUFDOUY7QUFFQSxXQUFTLFVBQVUsT0FBWSxVQUEyRTtBQUV4RyxVQUFNLElBQUksS0FBSyxJQUFJLElBQUksTUFBZ0IsQ0FBQyxHQUFHLEtBQWUsQ0FBQyxHQUFHLE1BQWdCLENBQUMsR0FBRyxNQUFnQixDQUFDO0FBQ25HLGFBQVMsSUFBSSxHQUFHLEtBQUssR0FBRyxJQUFLLFVBQVMsSUFBSSxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQ3hELFlBQU0sSUFBSyxJQUFJLElBQUssS0FBSyxLQUFLLEdBQUcsSUFBSyxJQUFJLElBQUssUUFBUSxJQUFJLElBQUksT0FBTyxPQUFPLEdBQUcsQ0FBQyxLQUFLLE1BQU0sSUFBSSxJQUFJLE9BQU8sS0FBSyxJQUFJLElBQUksSUFBSSxDQUFDO0FBQzdILFlBQU0sV0FBVyxJQUFJLE1BQU0sS0FBSyxJQUFLLElBQUksSUFBSyxLQUFLLEVBQUU7QUFDckQsVUFBSSxLQUFLLEtBQUssSUFBSSxDQUFDLElBQUksS0FBSyxJQUFJLFVBQVUsR0FBRyxLQUFLLEtBQUssSUFBSSxDQUFDLElBQUksS0FBSyxJQUFJLFFBQVE7QUFBRyxTQUFHLEtBQU0sSUFBSSxJQUFLLElBQUssSUFBSSxJQUFLLEdBQUc7QUFDdkgsWUFBTSxJQUFJLEtBQUssSUFBSSxNQUFNLElBQU8sSUFBSSxJQUFLLEdBQUc7QUFBRyxVQUFJLEtBQUssSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFDMUU7QUFDQSxhQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsSUFBSyxVQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsS0FBSztBQUFFLFlBQU0sSUFBSSxLQUFLLElBQUksS0FBSyxHQUFHLElBQUksSUFBSSxHQUFHLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxJQUFJO0FBQUcsVUFBSSxLQUFLLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFBRztBQUN0SixVQUFNLE9BQU8sSUFBSSxRQUFRLEtBQUssUUFBUSxLQUFLLEdBQUcsS0FBSyxJQUFJLFFBQVEsV0FBVztBQUFHLE9BQUcsWUFBWTtBQUFLLE9BQUcsVUFBVTtBQUFLLE9BQUcsTUFBTTtBQUFJLE9BQUcsU0FBUztBQUM1SSxVQUFNLE1BQWdCLENBQUM7QUFBRyxZQUFRLFdBQVcsZUFBZSxLQUFLLEtBQUssR0FBRztBQUFHLE9BQUcsVUFBVTtBQUFLLE9BQUcsWUFBWSxJQUFJO0FBQ2pILFVBQU0sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLFNBQVMsS0FBSztBQUFHLE9BQUcsaUJBQWlCLFNBQVMsTUFBTTtBQUFHLE9BQUcsZUFBZSxTQUFTO0FBQUcsT0FBRyxlQUFlLFNBQVM7QUFDeEosT0FBRyxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxPQUFHLGtCQUFrQjtBQUFPLE9BQUcsZUFBZSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sR0FBRztBQUFHLFNBQUssV0FBVztBQUFJLFNBQUssYUFBYTtBQUFPLFNBQUssa0JBQWtCO0FBQU0sT0FBRyxpQkFBaUI7QUFFNU4sVUFBTSxRQUFRLFFBQVEsWUFBWSxlQUFlLFNBQVMsRUFBRSxhQUFhLEdBQUcsZ0JBQWdCLEtBQUssUUFBUSxHQUFHLGNBQWMsRUFBRSxHQUFHLEtBQUs7QUFDcEksVUFBTSxLQUFLLElBQUksUUFBUSxpQkFBaUIsVUFBVSxLQUFLO0FBQUcsT0FBRyxlQUFlLElBQUksUUFBUSxPQUFPLE1BQU0sT0FBTyxLQUFLO0FBQUcsT0FBRyxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxPQUFHLGdCQUFnQixJQUFJLFFBQVEsT0FBTyxNQUFPLE9BQU8sS0FBSztBQUFHLFVBQU0sV0FBVztBQUM1TyxVQUFNLHdCQUF3QjtBQUFHLFVBQU0sV0FBVyxLQUFLO0FBQUcsVUFBTSxhQUFhO0FBQzdFLFFBQUksSUFBSTtBQUFPLFVBQU0sTUFBTSxPQUFPLEtBQUssSUFBSSxPQUFPLFNBQVMsVUFBVTtBQUNyRSxhQUFTLElBQUksR0FBRyxJQUFJLElBQUksS0FBSztBQUMzQixZQUFNLElBQUssSUFBSSxLQUFNLEtBQUssS0FBSyxLQUFLLElBQUksSUFBSSxPQUFPLE1BQU0sSUFBSSxPQUFPLElBQUksSUFBSSxLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksS0FBSyxJQUFJLE1BQU0sSUFBSSxJQUFJO0FBQzVILFlBQU0sSUFBSSxNQUFNLGVBQWUsT0FBTyxDQUFDO0FBQUcsUUFBRSxhQUFhO0FBQU8sUUFBRSxTQUFTLElBQUksS0FBSyxJQUFJLENBQUMsSUFBSSxLQUFLLEdBQUcsTUFBTSxJQUFJLEtBQUssS0FBSyxLQUFLLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQztBQUM3SSxRQUFFLFFBQVEsSUFBSSxHQUFHLEtBQUssQ0FBQztBQUFHLFFBQUUsU0FBUyxJQUFJLElBQUksSUFBSTtBQUFHLFFBQUUsU0FBUyxLQUFLLElBQUksSUFBSSxPQUFPO0FBQUEsSUFDckY7QUFFQSxVQUFNLFNBQVMsQ0FBQyxNQUFNLElBQUksRUFBRSxJQUFJLENBQUMsR0FBRyxNQUFNO0FBQ3hDLFlBQU0sSUFBSSxRQUFRLFlBQVksYUFBYSxTQUFTLEdBQUcsRUFBRSxPQUFPLElBQUksUUFBUSxHQUFHLEdBQUcsS0FBSztBQUFHLFFBQUUsU0FBUyxJQUFJO0FBQUcsUUFBRSxhQUFhO0FBQzNILFlBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLFVBQVUsR0FBRyxLQUFLLEdBQUcsSUFBSSxZQUFZLE9BQU8sSUFBSSxDQUFDO0FBQUcsUUFBRSxTQUFTLElBQUk7QUFBRyxRQUFFLFNBQVMsTUFBTSxJQUFJO0FBQ2xJLFFBQUUsaUJBQWlCO0FBQUcsUUFBRSw2QkFBNkI7QUFBTSxRQUFFLGdCQUFnQixJQUFJLFFBQVEsT0FBTyxLQUFLLEtBQUssSUFBSTtBQUFHLFFBQUUsa0JBQWtCO0FBQU0sUUFBRSxRQUFRLE9BQU8sSUFBSTtBQUFNLFFBQUUsa0JBQWtCO0FBQzFMLFFBQUUsb0JBQW9CO0FBQU0sUUFBRSxXQUFXO0FBQUcsUUFBRSxhQUFhLElBQUk7QUFBRyxhQUFPLEVBQUUsR0FBRyxHQUFHLEVBQUU7QUFBQSxJQUNyRixDQUFDO0FBRUQsVUFBTSxLQUFLLElBQUksUUFBUSxlQUFlLE9BQU8sRUFBRSxPQUFPLEtBQUssUUFBUSxJQUFJLEdBQUcsT0FBTyxJQUFJLEdBQUcsS0FBSyxHQUFHLFdBQVcsR0FBR0EsS0FBSSxHQUFHLHFCQUFxQixLQUFLLEtBQUssR0FBRyxLQUFLLEtBQUssR0FBRztBQUNwSyxJQUFBQSxHQUFFLGFBQWEsR0FBRyxlQUFlO0FBQUcsSUFBQUEsR0FBRSxhQUFhLE1BQU0sZUFBZTtBQUFHLElBQUFBLEdBQUUsYUFBYSxLQUFLLGlCQUFpQjtBQUFHLElBQUFBLEdBQUUsYUFBYSxHQUFHLGtCQUFrQjtBQUN2SixPQUFHLFlBQVlBO0FBQUcsT0FBRyxTQUFTLEdBQUcsR0FBRyxLQUFLLEdBQUc7QUFBRyxPQUFHLE9BQU87QUFBRyxPQUFHLFdBQVc7QUFDMUUsVUFBTSxNQUFNLFFBQVEsWUFBWSxhQUFhLE9BQU8sRUFBRSxPQUFPLElBQUksUUFBUSxHQUFHLEdBQUcsS0FBSztBQUFHLFFBQUksU0FBUyxJQUFJO0FBQU0sUUFBSSxhQUFhO0FBQy9ILFVBQU0sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLFFBQVEsS0FBSztBQUFHLE9BQUcsaUJBQWlCO0FBQUksT0FBRyw2QkFBNkI7QUFBTSxPQUFHLGtCQUFrQjtBQUFNLE9BQUcsZ0JBQWdCLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxLQUFLO0FBQUcsT0FBRyxvQkFBb0I7QUFBTSxRQUFJLFdBQVc7QUFBSSxRQUFJLGFBQWE7QUFDelEsV0FBTyxFQUFFLFNBQVMsSUFBSSxVQUFVLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsUUFBUSxDQUFDLE1BQWM7QUFBRSxpQkFBVyxLQUFLLFFBQVE7QUFBRSxVQUFFLEVBQUUsVUFBVSxLQUFLLE9BQVEsRUFBRSxJQUFJO0FBQVEsVUFBRSxFQUFFLFVBQVUsSUFBSSxRQUFTLEVBQUUsSUFBSSxLQUFLO0FBQUEsTUFBSTtBQUFBLElBQUUsRUFBRTtBQUFBLEVBQ3BNOzs7QUNsTE8sTUFBTSxhQUFhO0FBRW5CLE1BQU0scUJBQXFCO0FBQ2xDLE1BQU0sWUFBWTtBQUdYLE1BQU0sT0FBTyxFQUFFLE9BQU8sR0FBRyxPQUFPLEdBQUssV0FBVyxLQUFLLFdBQVcsS0FBSyxZQUFZLE9BQU8sVUFBVSxFQUFJO0FBRXRHLFdBQVMsY0FBYyxHQUFtQjtBQUMvQyxVQUFNLElBQUksS0FBSyxJQUFJLEdBQUcsQ0FBQyxHQUFHLFFBQVEsS0FBSyxRQUFRLEtBQUssU0FBUyxLQUFLLElBQUksR0FBRyxFQUFFLElBQUk7QUFDL0UsV0FBTyxLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssV0FBVyxTQUFTLElBQUksS0FBSyxLQUFLLGFBQWEsSUFBSSxNQUFNLEVBQUUsQ0FBQztBQUFBLEVBQzlGO0FBRU8sV0FBUyxhQUFhLEdBQW1CO0FBQzlDLFVBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxDQUFDLEdBQUcsT0FBTyxLQUFLLEtBQUssSUFBSSxJQUFJLEtBQUssY0FBYyxJQUFJO0FBQzFFLFdBQU8sRUFBRSxJQUFJLE9BQU8sSUFBSSxPQUFPLEtBQUssV0FBVyxNQUFNLFFBQVEsQ0FBQztBQUFBLEVBQ2hFO0FBRU8sTUFBTSxrQkFBa0IsQ0FBQyxNQUF1QixLQUFLLEtBQUssSUFBSSxLQUFLLEtBQUssSUFBSTtBQUduRixNQUFNLE9BQStCLEVBQUUsTUFBTSxDQUFDLFVBQVUsTUFBTSxHQUFHLE9BQU8sQ0FBQyxhQUFhLE1BQU0sR0FBRyxRQUFRLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxXQUFXLFFBQVEsRUFBRTtBQUUxSSxNQUFNLFlBQXdCO0FBQUEsSUFDbkMsRUFBRSxJQUFJLFFBQVEsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQUU7QUFBQSxJQUMvRCxFQUFFLElBQUksU0FBUyxLQUFLLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRTtBQUFBLElBQ2hFLEVBQUUsSUFBSSxVQUFVLEtBQUssQ0FBQyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxFQUFFO0FBQUEsSUFDbEUsRUFBRSxJQUFJLFNBQVMsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsRUFBRTtBQUFBLEVBQ2hGO0FBR0EsTUFBTSxTQUFtQixFQUFFLElBQUksVUFBVSxLQUFLLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQUU7QUFFdEUsV0FBUyxnQkFBZ0IsR0FBVyxNQUF3QjtBQUNqRSxRQUFJLEtBQUssRUFBRyxRQUFPO0FBQ25CLFdBQU8sVUFBVSxLQUFLLE1BQU0sUUFBUSxPQUFPLE9BQU8sSUFBSSxLQUFLLENBQUMsRUFBRSxLQUFLLElBQUksVUFBVSxNQUFNLENBQUM7QUFBQSxFQUMxRjtBQUdPLFdBQVMsWUFBWSxHQUFXLE9BQU8sR0FBZ0I7QUFDNUQsVUFBTSxPQUFPLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxDQUFDLENBQUMsR0FBRyxNQUFNLFFBQVEsT0FBTyxPQUFPLE9BQU8sT0FBTyxFQUFFLEdBQUcsTUFBTSxnQkFBZ0IsTUFBTSxJQUFJO0FBQ3hILFFBQUksT0FBTyxjQUFjLElBQUk7QUFBRyxVQUFNLE9BQW9CLENBQUM7QUFDM0QsUUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUk7QUFDakMsWUFBTSxPQUFlLElBQUksS0FBSyxJQUFJLE1BQU0sU0FBUyxVQUFVLE9BQU8sUUFBUSxLQUFLLElBQUk7QUFBRyxXQUFLLEtBQUssRUFBRSxNQUFNLE1BQU0sTUFBTSxLQUFLLENBQUM7QUFBRyxjQUFRLEtBQUssSUFBSSxFQUFFLE9BQU8sQ0FBQztBQUFBLElBQzFKO0FBQ0EsVUFBTSxRQUFRLElBQUksSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLElBQUksR0FBRyxDQUFDO0FBQ25ELGFBQVMsUUFBUSxHQUFHLFFBQVEsTUFBTSxLQUFLLFNBQVMsYUFBYSxRQUFRLEdBQUcsU0FBUztBQUMvRSxVQUFJLElBQUksSUFBSSxLQUFLLElBQUksT0FBTyxPQUFhLElBQUksSUFBSSxDQUFDLEVBQUUsQ0FBQztBQUNyRCxpQkFBVyxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksS0FBSztBQUFFLGFBQUs7QUFBRyxZQUFJLEtBQUssR0FBRztBQUFFLGlCQUFPO0FBQUk7QUFBQSxRQUFPO0FBQUEsTUFBRTtBQUMzRSxVQUFJLFVBQVUsS0FBSyxJQUFJLEVBQUUsT0FBTyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLElBQUk7QUFDekQsVUFBSSxDQUFDLFFBQVEsT0FBUSxXQUFVLEtBQUssT0FBTyxPQUFPLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDLEtBQUssSUFBSTtBQUMzRSxVQUFJLENBQUMsUUFBUSxPQUFRO0FBQ3JCLFlBQU0sT0FBTyxJQUFJLEtBQUssT0FBTyxHQUFHLE1BQU0sT0FBTyxLQUFLLElBQUksR0FBRyxZQUFZLEtBQUssTUFBTTtBQUNoRixVQUFJLE9BQU87QUFDWCxlQUFTLElBQUksR0FBRyxLQUFLLEdBQUcsSUFBSyxLQUFJLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQyxLQUFLLFFBQVEsS0FBSyxJQUFJLEVBQUUsSUFBSSxDQUFDLEtBQUssS0FBSyxJQUFJLEtBQUssSUFBSSxFQUFFLENBQUMsR0FBRyxNQUFNLEdBQUcsR0FBRztBQUFFLGVBQU87QUFBRztBQUFBLE1BQU87QUFDMUksV0FBSyxLQUFLLEVBQUUsTUFBTSxLQUFLLENBQUM7QUFBRyxjQUFRLEtBQUssSUFBSSxFQUFFLE9BQU8sQ0FBQztBQUFBLElBQ3hEO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7OztBQzFETyxNQUFNLFFBQWdCLENBQUMsUUFBUSxVQUFVLFFBQVEsV0FBVztBQUVuRSxNQUFNLFNBQWlDLEVBQUUsR0FBRyxXQUFXLEdBQUcsVUFBVSxHQUFHLFVBQVUsR0FBRyxVQUFVLEdBQUcsUUFBUSxHQUFHLFlBQVk7QUFDeEgsTUFBTSxZQUFZLENBQUMsTUFBMkIsRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sT0FBTyxFQUFFLENBQUMsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO0FBT3BHLE1BQU0sYUFBdUM7QUFBQSxJQUNsRCxNQUFNLENBQUMsTUFBTSxTQUFTLFlBQVksWUFBWSxZQUFZLFlBQVksZUFBZSxlQUFlLGVBQWUsYUFBYTtBQUFBLElBQ2hJLFFBQVEsQ0FBQyxTQUFTLFlBQVksZUFBZSxlQUFlLGtCQUFrQixrQkFBa0Isa0JBQWtCLGtCQUFrQixrQkFBa0IsbUJBQW1CO0FBQUEsSUFDekssTUFBTSxDQUFDLFNBQVMsa0JBQWtCLGtCQUFrQixxQkFBcUIsd0JBQXdCLDJCQUEyQix3QkFBd0IsMkJBQTJCLDJCQUEyQiw0QkFBNEI7QUFBQSxJQUN0TyxXQUFXLENBQUMsWUFBWSxrQkFBa0IscUJBQXFCLHdCQUF3Qiw4QkFBOEIsaUNBQWlDLG9DQUFvQyxvQ0FBb0MsdUNBQXVDLHFDQUFxQztBQUFBLEVBQzVTO0FBR0EsTUFBTSxZQUFvQztBQUFBLElBQ3hDLE1BQU0sQ0FBQyxTQUFTLFlBQVksa0JBQWtCLGVBQWUscUJBQXFCLHdCQUF3Qix3QkFBd0IsMkJBQTJCLDhCQUE4QiwrQkFBK0I7QUFBQSxJQUMxTixRQUFRLENBQUMsU0FBUyxrQkFBa0IscUJBQXFCLHdCQUF3Qiw4QkFBOEIsb0NBQW9DLDJCQUEyQiw4QkFBOEIsdUNBQXVDLHFDQUFxQztBQUFBLElBQ3hSLE1BQU0sQ0FBQyxZQUFZLGtCQUFrQix3QkFBd0Isd0JBQXdCLG9DQUFvQyx1Q0FBdUMsdUNBQXVDLHVDQUF1Qyx1Q0FBdUMscUNBQXFDO0FBQUEsSUFDMVQsV0FBVyxDQUFDLFlBQVksa0JBQWtCLHdCQUF3QiwyQkFBMkIsdUNBQXVDLHVDQUF1Qyx1Q0FBdUMsdUNBQXVDLHVDQUF1QyxxQ0FBcUM7QUFBQSxFQUN2VTtBQUVBLE1BQU0sVUFBa0M7QUFBQSxJQUN0QyxNQUFNLENBQUMsU0FBUyxrQkFBa0IsZUFBZSxrQkFBa0Isa0JBQWtCLHFCQUFxQixrQkFBa0IscUJBQXFCLHFCQUFxQixzQkFBc0I7QUFBQSxJQUM1TCxRQUFRLENBQUMsWUFBWSxrQkFBa0Isa0JBQWtCLGVBQWUscUJBQXFCLHdCQUF3QiwyQkFBMkIsMkJBQTJCLDJCQUEyQix5QkFBeUI7QUFBQSxJQUMvTixNQUFNLENBQUMsWUFBWSxrQkFBa0Isa0JBQWtCLGtCQUFrQix3QkFBd0Isd0JBQXdCLDJCQUEyQiwyQkFBMkIsMkJBQTJCLHlCQUF5QjtBQUFBLElBQ25PLFdBQVcsQ0FBQyxZQUFZLGtCQUFrQixlQUFlLGVBQWUscUJBQXFCLHdCQUF3QiwyQkFBMkIsMkJBQTJCLDJCQUEyQix5QkFBeUI7QUFBQSxFQUNqTztBQVVPLE1BQU0sU0FBcUI7QUFBQSxJQUNoQztBQUFBLE1BQUUsSUFBSTtBQUFBLE1BQVMsTUFBTTtBQUFBLE1BQXNCLE9BQU87QUFBQSxNQUNoRCxPQUFPLEVBQUUsTUFBTSxXQUFXLE1BQU0sUUFBUSxXQUFXLFFBQVEsTUFBTSxXQUFXLE1BQU0sV0FBVyxXQUFXLFVBQVU7QUFBQSxNQUNsSCxPQUFPLEVBQUUsTUFBTSxHQUFHLFFBQVEsR0FBRyxNQUFNLEdBQUcsV0FBVyxFQUFFO0FBQUEsTUFBRyxLQUFLLEVBQUUsTUFBTSxHQUFHLFFBQVEsR0FBRyxNQUFNLEdBQUcsV0FBVyxFQUFFO0FBQUEsSUFBRTtBQUFBLElBQzNHO0FBQUEsTUFBRSxJQUFJO0FBQUEsTUFBYSxNQUFNO0FBQUEsTUFBd0IsT0FBTztBQUFBLE1BQ3RELE9BQU87QUFBQSxNQUNQLE9BQU8sRUFBRSxNQUFNLEdBQUcsUUFBUSxNQUFNLE1BQU0sTUFBTSxXQUFXLEtBQUs7QUFBQSxNQUFHLEtBQUssRUFBRSxNQUFNLEdBQUcsUUFBUSxHQUFHLE1BQU0sR0FBRyxXQUFXLEVBQUU7QUFBQSxJQUFFO0FBQUEsSUFDcEg7QUFBQSxNQUFFLElBQUk7QUFBQSxNQUFXLE1BQU07QUFBQSxNQUFvQixPQUFPO0FBQUEsTUFDaEQsT0FBTztBQUFBLE1BQ1AsT0FBTyxFQUFFLE1BQU0sR0FBRyxRQUFRLEdBQUssTUFBTSxNQUFNLFdBQVcsSUFBSTtBQUFBLE1BQUcsS0FBSyxFQUFFLE1BQU0sR0FBRyxRQUFRLEdBQUcsTUFBTSxHQUFHLFdBQVcsR0FBRztBQUFBLElBQUU7QUFBQSxFQUNySDtBQUNPLE1BQU0sYUFBYSxDQUFDLE9BQXVCLEtBQUssSUFBSSxHQUFHLE9BQU8sVUFBVSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUMzRixNQUFNLFlBQVksQ0FBQyxPQUF5QixPQUFPLFdBQVcsRUFBRSxDQUFDO0FBV2pFLE1BQUksaUJBQXlCO0FBQzdCLE1BQUksaUJBQXlCO0FBQ3BDLE1BQUksUUFBUTtBQUFaLE1BQWUsY0FBYztBQUE3QixNQUFvQyxVQUFVO0FBRXZDLE1BQU0sZUFBZSxNQUFjO0FBQzFDLE1BQU0sZUFBdUMsRUFBRSxNQUFNLEtBQUssUUFBUSxLQUFLLE1BQU0sS0FBSyxXQUFXLEVBQUU7QUFDL0YsTUFBSSxlQUF1RTtBQUVwRSxNQUFNLGFBQWEsQ0FBQyxPQUFPLE1BQWUsY0FBYyxhQUFhLElBQUksSUFBSTtBQUM3RSxNQUFNLFlBQVksTUFBZTtBQUdqQyxNQUFNLFdBQTBCLFdBQVcsT0FBTyxJQUFJLFNBQVM7QUFFL0QsV0FBUyxtQkFBbUIsT0FBZSxNQUFvQjtBQTNGdEU7QUE0RkUsVUFBTSxLQUFLLFVBQVUsS0FBSztBQUFHLFFBQUksQ0FBQyxNQUFNLFNBQVMsSUFBWSxFQUFHO0FBQ2hFLGtCQUFjO0FBQU8sbUJBQWU7QUFBTSxlQUFVLGtCQUFhLElBQUksTUFBakIsWUFBc0I7QUFBSyxxQkFBaUIsR0FBRztBQUFJLHFCQUFpQjtBQUFNLFlBQVEsR0FBRyxNQUFNLElBQVk7QUFDM0osYUFBUyxTQUFTO0FBQUcsT0FBRyxNQUFNLElBQVksRUFBRSxRQUFRLENBQUMsTUFBTSxTQUFTLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQztBQUFBLEVBQ3hGO0FBRU8sV0FBUyxTQUFTLEtBQStFLEtBQW1CO0FBakczSDtBQWtHRSx1QkFBbUIsU0FBUyxRQUFRO0FBQUcsb0JBQWUsU0FBSSxVQUFKLFlBQWE7QUFBTSxxQkFBaUI7QUFBUyxxQkFBaUIsT0FBTyxHQUFHO0FBQUcsWUFBUSxJQUFJO0FBQUEsRUFDL0k7QUFFTyxXQUFTLGFBQW1CO0FBQUUsa0JBQWM7QUFBTSxtQkFBZTtBQUFNLGNBQVU7QUFBRyxxQkFBaUI7QUFBWSxxQkFBaUI7QUFBVyxZQUFRO0FBQUcsYUFBUyxTQUFTO0FBQUEsRUFBRztBQUU3SyxXQUFTLGNBQWMsTUFBb0I7QUFBRSx1QkFBbUIsZ0JBQWdCLElBQUk7QUFBQSxFQUFHO0FBRXZGLE1BQU0sV0FBVyxDQUFDLE1BQTJCLEVBQUUsT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDO0FBRy9GLFdBQVMsU0FBUyxHQUE2QjtBQUNwRCxRQUFJLE9BQU8sSUFBSSxLQUFLO0FBQ3BCLE1BQUUsUUFBUSxDQUFDLEdBQUcsTUFBTTtBQUFFLFlBQU0sUUFBUSxFQUFFLFNBQVMsVUFBVSxFQUFFLFNBQVMsWUFBWSxFQUFFLFNBQVMsY0FBYyxNQUFNLEdBQUcsS0FBSyxRQUFRLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUM7QUFBRyxVQUFJLEtBQUssSUFBSTtBQUFFLGFBQUs7QUFBSSxlQUFPO0FBQUEsTUFBRztBQUFBLElBQUUsQ0FBQztBQUM5TCxRQUFJLFFBQVEsRUFBRyxHQUFFLElBQUksSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLEdBQUcsTUFBTSxLQUFLO0FBQ2xELFdBQU87QUFBQSxFQUNUO0FBRU8sV0FBUyxVQUFVLE1BQWMsWUFBWSxHQUFnQjtBQUNsRSxRQUFJLFlBQWEsUUFBTyxZQUFZLE1BQU0sU0FBUztBQUNuRCxRQUFJLFFBQVEsU0FBUyxRQUFRO0FBQUUsVUFBSSxJQUFJLFNBQVMsT0FBTyxDQUFDLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUUsRUFBRTtBQUFHLFVBQUksYUFBYyxLQUFJLGFBQWEsR0FBRyxJQUFJO0FBQUcsYUFBTyxTQUFTLFNBQVMsU0FBUyxTQUFTLENBQUMsSUFBSTtBQUFBLElBQUc7QUFDbEwsVUFBTSxNQUFNLE9BQU8sSUFBSSxLQUFLLElBQUksTUFBTSxPQUFPLElBQUksTUFBTSxJQUFJLENBQUM7QUFDNUQsVUFBTSxTQUFTLEtBQUssTUFBTSxNQUFNLElBQUk7QUFDcEMsVUFBTSxNQUFNLFFBQVEsWUFBWSxPQUFPLE9BQU8sSUFBSTtBQUNsRCxVQUFNLE9BQW9CLENBQUM7QUFDM0IsUUFBSSxPQUFPO0FBQ1gsYUFBUyxRQUFRLEdBQUcsUUFBUSxNQUFNLFFBQVEsR0FBRyxTQUFTO0FBQ3BELFlBQU0sT0FBTyxJQUFJLEtBQUssS0FBSztBQUMzQixVQUFJLE9BQU87QUFDWCxVQUFJLElBQUksS0FBSyxJQUFJLFFBQVEsS0FBSyxJQUFJLEVBQUUsQ0FBQyxLQUFLLEtBQU0sUUFBTztBQUN2RCxVQUFJLFFBQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxRQUFRLEtBQUssSUFBSSxFQUFFLENBQUMsS0FBSyxLQUFNLFFBQU87QUFDcEUsWUFBTSxJQUFJLEtBQUssSUFBSSxFQUFFLE9BQU8sQ0FBQztBQUM3QixVQUFJLEtBQUssUUFBUSxLQUFLLFNBQVMsSUFBSTtBQUFFLGFBQUssS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDO0FBQUcsZ0JBQVE7QUFBQSxNQUFHO0FBQUEsSUFDN0U7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUdPLFdBQVMsWUFBWSxHQUFpRjtBQUMzRyxVQUFNLE1BQU0sb0JBQUksSUFBMkU7QUFDM0YsZUFBVyxLQUFLLEdBQUc7QUFDakIsWUFBTSxJQUFJLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxPQUFPLE1BQU07QUFDNUMsWUFBTSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQ3JCLFVBQUksSUFBSyxLQUFJO0FBQUEsVUFBYyxLQUFJLElBQUksR0FBRyxFQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNLE9BQU8sR0FBRyxNQUFNLEVBQUUsS0FBSyxDQUFDO0FBQUEsSUFDOUY7QUFDQSxXQUFPLENBQUMsR0FBRyxJQUFJLE9BQU8sQ0FBQztBQUFBLEVBQ3pCOzs7QUMzSE8sTUFBTSxVQUFVO0FBQ2hCLE1BQU0sVUFBVTtBQU1oQixXQUFTLFFBQVEsTUFBYSxNQUF3QztBQUMzRSxVQUFNLE1BQU0sS0FBSyxNQUFNLE9BQU8sU0FBUyxHQUFHLE1BQU0sT0FBTztBQUN2RCxVQUFNLFFBQVEsWUFBWSxJQUFJO0FBQzlCLFdBQU8sRUFBRSxJQUFJLFVBQVUsUUFBUSxZQUFZLFNBQVMsSUFBSSxLQUFLLElBQUksSUFBSSxPQUFPLFlBQVksS0FBSyxLQUFLLFFBQVE7QUFBQSxFQUM1RztBQUVBLE1BQU0sWUFBb0MsRUFBRSxRQUFRLEdBQUcsTUFBTSxHQUFHLFNBQVMsR0FBRyxXQUFXLEdBQUcsUUFBUSxHQUFHLFFBQVEsRUFBRTtBQUV4RyxXQUFTLFdBQVcsT0FBeUI7QUFDbEQsVUFBTSxRQUFrQixDQUFDO0FBQ3pCLGFBQVMsSUFBSSxHQUFHLElBQUksWUFBWSxXQUFXLElBQUssT0FBTSxLQUFLLENBQUM7QUFDNUQsVUFBTSxLQUFLLENBQUMsR0FBRyxNQUFNO0FBQ25CLFlBQU0sS0FBSyxZQUFZLElBQUssSUFBSSxXQUFZLEtBQUssWUFBWSxJQUFLLElBQUk7QUFDdEUsVUFBSSxPQUFPLEdBQUksUUFBTyxLQUFLO0FBQzNCLGFBQU8sS0FBSyxJQUFJLEtBQUssTUFBTSxJQUFJLFNBQVMsSUFBSSxDQUFDLElBQUksS0FBSyxJQUFJLEtBQUssTUFBTSxJQUFJLFNBQVMsSUFBSSxDQUFDO0FBQUEsSUFDekYsQ0FBQztBQUNELFVBQU0sUUFBUSxNQUFNLElBQUksQ0FBQyxHQUFHLE1BQU0sQ0FBQyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sVUFBVSxNQUFNLENBQUMsRUFBRSxJQUFJLElBQUksVUFBVSxNQUFNLENBQUMsRUFBRSxJQUFJLENBQUM7QUFDdkcsVUFBTSxNQUFNLElBQUksTUFBYyxNQUFNLE1BQU07QUFDMUMsVUFBTSxRQUFRLENBQUMsS0FBSyxNQUFNO0FBQUUsVUFBSSxHQUFHLElBQUksTUFBTSxDQUFDO0FBQUEsSUFBRyxDQUFDO0FBQ2xELFdBQU87QUFBQSxFQUNUO0FBSU8sTUFBTSxPQUFPLEVBQUUsSUFBSSxLQUFLLEtBQUssS0FBSyxNQUFNLElBQUk7QUFzQjVDLE1BQU0sU0FBTixNQUFhO0FBQUE7QUFBQTtBQUFBLElBYWxCLFlBQVksU0FBaUIsU0FBaUIsT0FBTyxHQUFHLFFBQTBDQyxjQUFhLEdBQUc7QUFabEgsa0NBQU87QUFDUCxzQ0FBc0IsQ0FBQztBQUN2QixvQ0FBbUIsQ0FBQztBQUNwQixvQ0FBcUI7QUFDckI7QUFDQSwwQkFBUSxXQUFtRSxDQUFDO0FBQzVFLDBCQUFRLFVBQVM7QUFDakIsMEJBQVEsY0FBYTtBQUNyQiwwQkFBUSxRQUFPO0FBbEZqQjtBQXVGSSxXQUFLLE1BQU0sUUFBUSxJQUFJO0FBQUcsV0FBSyxhQUFhQTtBQUM1QyxpQkFBVyxLQUFLLFFBQVMsTUFBSyxJQUFJLEdBQUcsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE9BQU0sc0NBQVMsRUFBRSxVQUFYLFlBQW9CLENBQUM7QUFDbEYsWUFBTSxRQUFRLFdBQVcsT0FBTztBQUNoQyxjQUFRLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxJQUFJLEdBQUcsRUFBRSxNQUFNLEVBQUUsTUFBTSxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQztBQUFBLElBQzlFO0FBQUEsSUFFUSxJQUFJLE1BQWEsTUFBYyxNQUFjLE1BQWMsUUFBUSxHQUFHLE9BQU8sT0FBZ0I7QUE3RnZHO0FBOEZJLFlBQU0sSUFBSSxTQUFTLEtBQUssRUFBRSxNQUFNLElBQUksR0FBRyxJQUFJLFFBQVEsTUFBTSxJQUFJO0FBQzdELFlBQU0sT0FBTyxLQUFLLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxLQUFLLEVBQUUsTUFBTSxJQUFJLFFBQVEsS0FBSyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksS0FBSyxFQUFFLE1BQU07QUFDdkcsWUFBTSxLQUFLLFNBQVMsSUFBSSxLQUFLLGFBQWE7QUFDMUMsWUFBTSxLQUFLLEdBQUcsS0FBSyxFQUFFLEtBQUssR0FBRyxPQUFPLENBQUMsSUFBSSxPQUFPLE1BQU0sT0FBTyxJQUFJLEtBQUssS0FBSyxhQUFhLElBQUk7QUFDNUYsWUFBTSxJQUFhO0FBQUEsUUFDakIsSUFBSSxLQUFLO0FBQUEsUUFBVTtBQUFBLFFBQU07QUFBQSxRQUFNO0FBQUEsUUFBTTtBQUFBLFFBQU0sR0FBRyxFQUFFO0FBQUEsUUFBRyxHQUFHLEVBQUU7QUFBQSxRQUFHLEtBQUssU0FBUyxJQUFJLElBQUksS0FBSztBQUFBLFFBQ3RGO0FBQUEsUUFBSSxPQUFPO0FBQUEsUUFBSSxLQUFLLEdBQUcsTUFBTSxFQUFFLEtBQUssSUFBSSxPQUFPLENBQUMsSUFBSSxRQUFRLE1BQU0sT0FBTyxJQUFJLEtBQUssTUFBTSxhQUFhLElBQUk7QUFBQSxRQUFJLFVBQVUsR0FBRztBQUFBLFFBQVUsT0FBTyxHQUFHO0FBQUEsUUFBTyxPQUFPLEdBQUc7QUFBQSxRQUFPLFFBQVEsR0FBRyxPQUFPLEVBQUUsS0FBSyxNQUFNLE9BQU8sQ0FBQztBQUFBO0FBQUEsUUFDN00sT0FBTztBQUFBLFFBQU0sT0FBTztBQUFBLFFBQVEsUUFBUTtBQUFBLFFBQUksWUFBWTtBQUFBLFFBQUcsY0FBYztBQUFBLFFBQUksYUFBYTtBQUFBLFFBQ3RGLFlBQVksS0FBSyxJQUFJLEtBQUssSUFBSTtBQUFBLFFBQUssYUFBYTtBQUFBLFFBQUksV0FBVztBQUFBLFFBQUcsV0FBVztBQUFBLFFBQUcsU0FBUztBQUFBLFFBQUcsU0FBUztBQUFBLFFBQ3JHLE1BQU07QUFBQSxRQUFHLFVBQVMsYUFBRSxLQUFLLElBQUksTUFBWCxtQkFBYyxRQUFkLFlBQXFCO0FBQUEsUUFBRyxTQUFTO0FBQUEsUUFBTyxRQUFRO0FBQUEsUUFBRyxRQUFRO0FBQUEsUUFBRztBQUFBLE1BQ2xGO0FBQ0EsV0FBSyxTQUFTLEtBQUssQ0FBQztBQUFHLGFBQU87QUFBQSxJQUNoQztBQUFBLElBRUEsS0FBSyxJQUFpQztBQUFFLGFBQU8sS0FBSyxJQUFJLFNBQVksS0FBSyxTQUFTLEtBQUssQ0FBQztBQUFBLElBQUc7QUFBQSxJQUMzRixLQUFLLEdBQXVCO0FBQUUsYUFBTyxLQUFLLFNBQVMsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFDaEcsTUFBTSxNQUFxQjtBQUFFLGFBQU8sS0FBSyxTQUFTLE9BQU8sQ0FBQyxHQUFHLE1BQU0sS0FBSyxFQUFFLFNBQVMsRUFBRSxTQUFTLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDakgsUUFBa0I7QUFBRSxZQUFNLElBQUksS0FBSztBQUFRLFdBQUssU0FBUyxDQUFDO0FBQUcsYUFBTztBQUFBLElBQUc7QUFBQSxJQUV2RSxLQUFLLElBQWtCO0FBQ3JCLFVBQUksS0FBSyxVQUFVLEVBQUc7QUFDdEIsV0FBSyxRQUFRO0FBQUksV0FBSyxPQUFPLENBQUMsS0FBSztBQUVuQyxlQUFTLElBQUksS0FBSyxRQUFRLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUNqRCxjQUFNLElBQUksS0FBSyxRQUFRLENBQUM7QUFDeEIsWUFBSSxLQUFLLFFBQVEsRUFBRSxJQUFJO0FBQ3JCLGVBQUssUUFBUSxPQUFPLEdBQUcsQ0FBQztBQUN4QixnQkFBTSxLQUFLLEtBQUssS0FBSyxFQUFFLEVBQUUsR0FBRyxPQUFPLEtBQUssS0FBSyxFQUFFLElBQUk7QUFDbkQsY0FBSSxNQUFNLEdBQUcsU0FBUyxLQUFNLE1BQUssT0FBTyxJQUFJLEVBQUUsS0FBSyxNQUFNLE9BQU87QUFBQSxRQUNsRTtBQUFBLE1BQ0Y7QUFDQSxZQUFNLFFBQVEsS0FBSyxTQUFTLE9BQU8sQ0FBQyxNQUFNLEVBQUUsS0FBSztBQUFHLFVBQUksS0FBSyxLQUFNLE9BQU0sUUFBUTtBQUNqRixpQkFBVyxLQUFLLE1BQU8sS0FBSSxFQUFFLE1BQU8sTUFBSyxPQUFPLEdBQUcsRUFBRTtBQUNyRCxZQUFNLElBQUksS0FBSyxNQUFNLENBQUMsR0FBRyxJQUFJLEtBQUssTUFBTSxDQUFDO0FBQ3pDLFVBQUksQ0FBQyxLQUFLLENBQUMsRUFBRyxNQUFLLFNBQVMsSUFBSSxJQUFJO0FBQUEsZUFDM0IsS0FBSyxRQUFRLFFBQVEsSUFBSSxXQUFXO0FBQzNDLGNBQU0sS0FBSyxDQUFDLE1BQWEsS0FBSyxTQUFTLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUM7QUFDcEgsYUFBSyxTQUFTLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLElBQUk7QUFBQSxNQUNwQztBQUFBLElBQ0Y7QUFBQTtBQUFBLElBR1EsT0FBTyxHQUFZLElBQWtCO0FBQzNDLFlBQU0sSUFBSSxTQUFTLEtBQUssRUFBRSxNQUFNLEVBQUUsSUFBSTtBQUN0QyxXQUFLLFNBQVMsR0FBRyxFQUFFO0FBRW5CLFVBQUksRUFBRSxVQUFVLFVBQVU7QUFDeEIsY0FBTSxJQUFJLEtBQUssT0FBTyxFQUFFO0FBQ3hCLGNBQU1DLE1BQUssS0FBSyxLQUFLLEVBQUUsTUFBTTtBQUFHLFlBQUlBLE9BQU1BLElBQUcsTUFBTyxNQUFLLEtBQUssR0FBR0EsSUFBRyxJQUFJLEVBQUUsR0FBR0EsSUFBRyxJQUFJLEVBQUUsR0FBRyxFQUFFO0FBQzNGLFlBQUksQ0FBQyxFQUFFLFdBQVcsS0FBSyxFQUFFLFlBQVksR0FBRyxTQUFTO0FBQUUsWUFBRSxVQUFVO0FBQU0sZUFBSyxXQUFXLENBQUM7QUFBQSxRQUFHO0FBQ3pGLFlBQUksS0FBSyxFQUFFLFVBQVcsR0FBRSxRQUFRO0FBQ2hDO0FBQUEsTUFDRjtBQUNBLFdBQUssUUFBUSxDQUFDO0FBQ2QsWUFBTSxLQUFLLEtBQUssS0FBSyxFQUFFLE1BQU07QUFDN0IsVUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLE9BQU87QUFBRSxVQUFFLFFBQVE7QUFBUSxhQUFLLFlBQVksQ0FBQztBQUFHO0FBQUEsTUFBUTtBQUN2RSxZQUFNLEtBQUssR0FBRyxJQUFJLEVBQUUsR0FBRyxLQUFLLEdBQUcsSUFBSSxFQUFFLEdBQUcsT0FBTyxLQUFLLE1BQU0sSUFBSSxFQUFFO0FBQ2hFLFdBQUssS0FBSyxHQUFHLElBQUksSUFBSSxFQUFFO0FBQ3ZCLFVBQUksUUFBUSxFQUFFLE9BQU87QUFDbkIsWUFBSSxLQUFLLFFBQVEsRUFBRSxXQUFZLE1BQUssWUFBWSxDQUFDO0FBQUEsYUFBUTtBQUFFLFlBQUUsUUFBUTtBQUFRLGVBQUssWUFBWSxDQUFDO0FBQUEsUUFBRztBQUFBLE1BQ3BHLE9BQU87QUFDTCxVQUFFLFFBQVE7QUFBTyxZQUFJLEtBQUssS0FBSyxLQUFLLElBQUksTUFBTSxJQUFJLEdBQUcsS0FBSyxLQUFLLEtBQUssSUFBSSxNQUFNLElBQUk7QUFFbEYsWUFBSSxLQUFLLEdBQUcsS0FBSztBQUNqQixtQkFBVyxLQUFLLEtBQUssVUFBVTtBQUM3QixjQUFJLE1BQU0sS0FBSyxDQUFDLEVBQUUsU0FBUyxFQUFFLE9BQU8sR0FBRyxHQUFJO0FBQzNDLGdCQUFNLEtBQUssRUFBRSxJQUFJLEVBQUUsR0FBRyxLQUFLLEVBQUUsSUFBSSxFQUFFLEdBQUcsUUFBUSxLQUFLLEtBQUssS0FBSyxJQUFJLFFBQVEsRUFBRSxTQUFTLEVBQUUsU0FBUztBQUMvRixjQUFJLFNBQVMsS0FBSyxRQUFRLFFBQVEsSUFBSztBQUN2QyxnQkFBTSxNQUFNLEtBQUssQ0FBQyxLQUFLLEtBQUssSUFBSSxPQUFPLEVBQUUsU0FBUyxFQUFFLFNBQVM7QUFBTSxjQUFJLEtBQUssSUFBSSxHQUFHLEtBQUssS0FBTTtBQUM5RixnQkFBTSxPQUFPLFFBQVEsSUFBSyxFQUFFLEtBQUssSUFBSSxJQUFJLEtBQU8sTUFBTSxJQUFJLEtBQUssR0FBSSxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsSUFBSSxTQUFTLElBQUksS0FBSyxJQUFJLEdBQUcsUUFBUSxLQUFLLElBQUk7QUFDdEksZ0JBQU0sQ0FBQyxLQUFLLE9BQU8sSUFBSTtBQUFLLGdCQUFNLEtBQUssT0FBTyxJQUFJO0FBQUEsUUFDcEQ7QUFDQSxZQUFJLE1BQU0sSUFBSTtBQUFFLGdCQUFNO0FBQUksZ0JBQU07QUFBSSxnQkFBTSxJQUFJLEtBQUssTUFBTSxJQUFJLEVBQUUsS0FBSztBQUFHLGdCQUFNO0FBQUcsZ0JBQU07QUFBQSxRQUFHO0FBQ3pGLFVBQUUsS0FBSyxLQUFLLEVBQUUsUUFBUTtBQUFJLFVBQUUsS0FBSyxLQUFLLEVBQUUsUUFBUTtBQUFJLGFBQUssWUFBWSxDQUFDO0FBQUEsTUFDeEU7QUFBQSxJQUNGO0FBQUEsSUFFUSxZQUFZLEdBQWtCO0FBQ3BDLFVBQUksRUFBRSxTQUFTLGVBQWUsRUFBRSxTQUFTLEtBQUssS0FBSyxRQUFRLEVBQUUsY0FBYyxFQUFFLGFBQWEsUUFBUSxPQUFPLFdBQVksR0FBRSxTQUFTO0FBQUEsSUFDbEk7QUFBQSxJQUVRLEtBQUssR0FBWSxJQUFZLElBQVksSUFBa0I7QUFDakUsVUFBSSxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQU07QUFDOUIsWUFBTSxPQUFPLEtBQUssTUFBTSxJQUFJLEVBQUU7QUFBRyxVQUFJLE1BQU0sT0FBTyxFQUFFLE1BQU0sS0FBSyxPQUFPLElBQUksS0FBSyxNQUFNLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxNQUFNLEtBQUs7QUFDekgsUUFBRSxPQUFPLEtBQUssSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxDQUFDLENBQUM7QUFBQSxJQUNoRDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBUVEsU0FBUyxHQUFZLElBQWtCO0FBQzdDLFlBQU0sVUFBVSxDQUFDLE1BQWUsRUFBRSxVQUFVLFlBQVksRUFBRSxVQUFVLFFBQVEsT0FBTyxDQUFDLE1BQWUsRUFBRSxTQUFTLEVBQUU7QUFDaEgsVUFBSSxLQUFLLEdBQUcsS0FBSztBQUNqQixpQkFBVyxLQUFLLEtBQUssVUFBVTtBQUM3QixZQUFJLE1BQU0sS0FBSyxDQUFDLEVBQUUsTUFBTztBQUN6QixjQUFNLEtBQUssRUFBRSxJQUFJLEVBQUUsR0FBRyxLQUFLLEVBQUUsSUFBSSxFQUFFLEdBQUcsSUFBSSxLQUFLLE1BQU0sSUFBSSxFQUFFLEdBQUcsUUFBUSxFQUFFLFNBQVMsRUFBRSxVQUFVLE9BQU87QUFDcEcsWUFBSSxLQUFLLEtBQU07QUFDZixZQUFJLFFBQVEsS0FBSyxDQUFDLEtBQUssS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDO0FBQ3ZDLGNBQU0sS0FBSyxRQUFRLENBQUMsR0FBRyxLQUFLLFFBQVEsQ0FBQztBQUNyQyxZQUFJLE1BQU0sQ0FBQyxHQUFJLFVBQVM7QUFBQSxpQkFDZixDQUFDLE1BQU0sR0FBSSxTQUFRLEtBQUssSUFBSSxHQUFHLFFBQVEsTUFBTSxJQUFJO0FBQUEsaUJBQ2pELE1BQU0sR0FBSSxVQUFTO0FBQzVCLGNBQU0sS0FBTSxPQUFPLEtBQUssS0FBSyxJQUFJLEdBQUcsSUFBSSxJQUFLLFFBQVE7QUFDckQsZUFBTyxJQUFJLE9BQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxNQUFPLE1BQU07QUFBRyxlQUFPLElBQUksT0FBUSxLQUFLLElBQUksS0FBSyxJQUFJLE1BQU8sTUFBTTtBQUFBLE1BQ3pHO0FBQ0EsWUFBTSxJQUFJLEtBQUssSUFBSSxHQUFHLEtBQUssQ0FBQztBQUFHLFVBQUksS0FBSyxLQUFLLEdBQUcsS0FBSyxLQUFLO0FBQzFELFlBQU0sT0FBTyxRQUFRLENBQUMsSUFBSSxNQUFNLE9BQU8sSUFBSSxNQUFNLEtBQUssTUFBTSxJQUFJLEVBQUU7QUFDbEUsVUFBSSxNQUFNLEtBQUs7QUFBRSxjQUFNLE1BQU07QUFBSyxjQUFNLE1BQU07QUFBQSxNQUFLO0FBQ25ELFFBQUUsS0FBSztBQUFJLFFBQUUsS0FBSztBQUFBLElBQ3BCO0FBQUEsSUFFUSxRQUFRLEdBQWtCO0FBQ2hDLFVBQUksRUFBRSxnQkFBZ0IsR0FBRztBQUN2QixjQUFNLEtBQUssS0FBSyxLQUFLLEVBQUUsWUFBWTtBQUNuQyxZQUFJLE1BQU0sR0FBRyxTQUFTLEtBQUssT0FBTyxFQUFFLGFBQWE7QUFBRSxZQUFFLFNBQVMsR0FBRztBQUFJO0FBQUEsUUFBUTtBQUM3RSxVQUFFLGVBQWU7QUFBQSxNQUNuQjtBQUNBLFlBQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxNQUFNO0FBQzlCLFVBQUksT0FBTyxJQUFJLFNBQVMsS0FBSyxPQUFPLEVBQUUsV0FBWTtBQUNsRCxVQUFJLEVBQUUsU0FBUyxZQUFZLE9BQU8sSUFBSSxTQUFTLEtBQUssTUFBTSxJQUFJLElBQUksRUFBRSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUMsS0FBSyxFQUFFLFFBQVEsSUFBSztBQUN0RyxRQUFFLGFBQWEsS0FBSyxPQUFPLFFBQVEsSUFBSSxpQkFBaUIsTUFBTSxNQUFNLEtBQUssSUFBSSxLQUFLO0FBQ2xGLFlBQU0sT0FBTyxLQUFLLEtBQUssQ0FBQztBQUFHLFVBQUksQ0FBQyxLQUFLLFFBQVE7QUFBRSxVQUFFLFNBQVM7QUFBSTtBQUFBLE1BQVE7QUFDdEUsVUFBSSxPQUFPLEtBQUssQ0FBQyxHQUFHLEtBQUs7QUFDekIsaUJBQVcsS0FBSyxNQUFNO0FBQ3BCLFlBQUksUUFBUSxLQUFLLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxDQUFDO0FBQzNDLFlBQUksRUFBRSxTQUFTLFVBQVU7QUFFdkIsZ0JBQU0sVUFBVSxLQUFLLEtBQUssRUFBRSxNQUFNO0FBQUcsZ0JBQU0sT0FBTyxDQUFDLENBQUMsV0FBVyxRQUFRLFNBQVMsUUFBUSxTQUFTLEVBQUUsUUFBUSxRQUFRLE9BQU8sRUFBRTtBQUM1SCxjQUFJLFFBQVEsUUFBUSxRQUFRLFlBQVksYUFBYSxFQUFHLFVBQVM7QUFDakUsbUJBQVMsUUFBUSxZQUFZLGlCQUFpQixJQUFJLEVBQUUsS0FBSyxFQUFFO0FBQUEsUUFDN0Q7QUFDQSxZQUFJLEVBQUUsU0FBUyxZQUFZLEVBQUUsT0FBTyxFQUFFLE9BQVEsVUFBUztBQUN2RCxZQUFJLFFBQVEsSUFBSTtBQUFFLGVBQUs7QUFBTyxpQkFBTztBQUFBLFFBQUc7QUFBQSxNQUMxQztBQUNBLFFBQUUsU0FBUyxLQUFLO0FBQUEsSUFDbEI7QUFBQSxJQUVRLFlBQVksR0FBa0I7QUFDcEMsWUFBTSxJQUFJLFNBQVMsS0FBSyxFQUFFLE1BQU0sRUFBRSxJQUFJO0FBQUcsVUFBSSxNQUFNLEVBQUU7QUFDckQsVUFBSSxFQUFFLFNBQVMsYUFBYTtBQUFFLFVBQUUsU0FBUyxLQUFLLElBQUksRUFBRSxPQUFPLFdBQVcsRUFBRSxTQUFTLENBQUM7QUFBRyxjQUFNLEVBQUUsWUFBWSxJQUFJLEVBQUUsU0FBUyxFQUFFLE9BQU87QUFBVyxhQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsVUFBVSxJQUFJLEVBQUUsSUFBSSxRQUFRLEVBQUUsT0FBTyxDQUFDO0FBQUEsTUFBRztBQUMzTSxRQUFFLFlBQVksS0FBSyxJQUFJLEdBQUcsU0FBUyxNQUFNLElBQUk7QUFBRyxRQUFFLFlBQVksR0FBRyxVQUFVLEVBQUU7QUFDN0UsUUFBRSxjQUFjLEtBQUs7QUFBTSxRQUFFLGFBQWEsS0FBSyxPQUFPLEtBQUssSUFBSSxLQUFLLEVBQUUsU0FBUztBQUFHLFFBQUUsVUFBVTtBQUFPLFFBQUUsUUFBUTtBQUMvRyxRQUFFLFVBQVUsRUFBRSxVQUFVLEtBQUssRUFBRSxRQUFRLEVBQUU7QUFBUyxVQUFJLEVBQUUsU0FBUztBQUFFLFVBQUUsT0FBTztBQUFHLGFBQUssT0FBTyxLQUFLLEVBQUUsR0FBRyxRQUFRLElBQUksRUFBRSxJQUFJLE9BQU8sRUFBRSxTQUFTLFdBQVcsVUFBVSxFQUFFLFNBQVMsV0FBVyxVQUFVLFFBQVEsQ0FBQztBQUFBLE1BQUc7QUFDMU0sV0FBSyxPQUFPLEtBQUssRUFBRSxHQUFHLFNBQVMsSUFBSSxFQUFFLElBQUksT0FBTyxFQUFFLFdBQVcsS0FBSyxFQUFFLFVBQVUsQ0FBQztBQUFBLElBQ2pGO0FBQUEsSUFFUSxXQUFXLEdBQWtCO0FBQ25DLFlBQU0sSUFBSTtBQUFTLFlBQU0sS0FBSyxLQUFLLEtBQUssRUFBRSxNQUFNO0FBQUcsVUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLE1BQU87QUFDekUsWUFBTSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUk7QUFBRyxVQUFJLEtBQUssQ0FBQyxFQUFFLFFBQVMsR0FBRSxPQUFPLEtBQUssSUFBSSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsU0FBUztBQUM1RixVQUFJLEVBQUUsU0FBUyxVQUFVO0FBQ3ZCLGNBQU0sUUFBUSxFQUFFLFFBQVE7QUFDeEIsY0FBTSxPQUFPLEtBQUssS0FBSyxDQUFDLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxHQUFHLEdBQUcsS0FBSyxNQUFNLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFFLEtBQUssS0FBSyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUN2SSxjQUFNLFNBQVMsRUFBRSxVQUFVLENBQUMsSUFBSSxHQUFHLEtBQUssSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBRSxPQUFPLEdBQUcsRUFBRSxDQUFDLEVBQUUsTUFBTSxHQUFHLEVBQUUsT0FBTyxPQUFPLElBQUksQ0FBQyxFQUFFO0FBQ3ZILG1CQUFXLEtBQUssUUFBUTtBQUN0QixnQkFBTSxNQUFNLEtBQUssSUFBSSxNQUFNLEtBQUssTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLE9BQU8sZUFBZTtBQUN0RixlQUFLLFFBQVEsS0FBSyxFQUFFLElBQUksS0FBSyxPQUFPLEtBQUssTUFBTSxFQUFFLElBQUksSUFBSSxFQUFFLElBQUksS0FBSyxFQUFFLElBQUksQ0FBQztBQUMzRSxlQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsU0FBUyxNQUFNLEVBQUUsSUFBSSxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUM7QUFBQSxRQUM1RDtBQUNBLFVBQUUsVUFBVTtBQUFPO0FBQUEsTUFDckI7QUFDQSxVQUFJLEtBQUssTUFBTSxHQUFHLElBQUksRUFBRSxHQUFHLEdBQUcsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLFFBQVEsS0FBSztBQUFFLFVBQUUsVUFBVTtBQUFPO0FBQUEsTUFBUTtBQUNyRixVQUFJLE1BQU0sRUFBRTtBQUNaLFVBQUksRUFBRSxTQUFTLFVBQVU7QUFBRSxjQUFNLE1BQU0sS0FBSyxLQUFLLEdBQUcsTUFBTTtBQUFHLFlBQUksT0FBTyxJQUFJLFNBQVMsSUFBSSxTQUFTLEVBQUUsUUFBUSxJQUFJLE9BQU8sRUFBRSxHQUFJLFFBQU8sSUFBSSxFQUFFLFlBQVk7QUFBQSxNQUFPO0FBQzdKLFVBQUksRUFBRSxTQUFTO0FBQ2IsVUFBRSxVQUFVO0FBQ1osWUFBSSxFQUFFLFNBQVMsUUFBUTtBQUNyQixpQkFBTyxFQUFFLE1BQU07QUFBTSxlQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsU0FBUyxJQUFJLEVBQUUsSUFBSSxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEVBQUUsTUFBTSxPQUFPLENBQUM7QUFDbkcscUJBQVcsS0FBSyxLQUFLLEtBQUssQ0FBQyxFQUFHLEtBQUksRUFBRSxPQUFPLEdBQUcsTUFBTSxLQUFLLE1BQU0sRUFBRSxJQUFJLEdBQUcsR0FBRyxFQUFFLElBQUksR0FBRyxDQUFDLEtBQUssRUFBRSxNQUFNLE9BQVEsTUFBSyxPQUFPLEdBQUcsTUFBTSxLQUFLLEdBQUcsT0FBTztBQUM5SSxlQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUcsT0FBTztBQUFHO0FBQUEsUUFDcEM7QUFDQSxZQUFJLEVBQUUsU0FBUyxVQUFVO0FBQ3ZCLHFCQUFXLEtBQUssS0FBSyxLQUFLLENBQUMsRUFBRyxLQUFJLEtBQUssTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLENBQUMsS0FBSyxFQUFFLE1BQU0sUUFBUTtBQUFFLGNBQUUsZUFBZSxFQUFFO0FBQUksY0FBRSxjQUFjLEtBQUssT0FBTyxFQUFFLE1BQU07QUFBVSxjQUFFLGFBQWE7QUFBQSxVQUFHO0FBQy9LLGVBQUssT0FBTyxLQUFLLEVBQUUsR0FBRyxTQUFTLElBQUksRUFBRSxHQUFHLENBQUM7QUFBQSxRQUMzQztBQUFBLE1BQ0Y7QUFDQSxXQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUcsT0FBTztBQUFBLElBQ2pDO0FBQUEsSUFFUSxPQUFPLEdBQVksUUFBZ0IsTUFBZSxNQUF5QztBQUNqRyxVQUFJLENBQUMsRUFBRSxNQUFPO0FBQ2QsWUFBTSxJQUFJO0FBQVMsVUFBSSxNQUFNO0FBQzdCLFVBQUksRUFBRSxTQUFTLFdBQVc7QUFDeEIsY0FBTSxJQUFJLEtBQUssU0FBUyxPQUFPLENBQUMsTUFBTSxFQUFFLFNBQVMsTUFBTSxLQUFLLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxTQUFTLGFBQWEsS0FBSyxNQUFNLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxLQUFLLEVBQUUsUUFBUSxNQUFNLEVBQUU7QUFDL0osY0FBTSxLQUFLLElBQUksRUFBRSxRQUFRLFdBQVcsQ0FBQyxJQUFJLEVBQUUsUUFBUTtBQUFBLE1BQ3JEO0FBQ0EsWUFBTSxNQUFNLFVBQVUsSUFBSTtBQUFNLFFBQUUsTUFBTTtBQUN4QyxZQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSTtBQUFHLFVBQUksS0FBSyxFQUFFLEtBQUssRUFBRyxHQUFFLE9BQU8sS0FBSyxJQUFJLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxNQUFNO0FBQ3ZGLFdBQUssT0FBTyxLQUFLLEVBQUUsR0FBRyxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksRUFBRSxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQ2pFLFVBQUksRUFBRSxNQUFNLEdBQUc7QUFBRSxVQUFFLEtBQUs7QUFBRyxVQUFFLFFBQVE7QUFBTyxVQUFFLFFBQVE7QUFBUSxVQUFFLFNBQVMsS0FBSztBQUFNLGFBQUssT0FBTyxLQUFLLEVBQUUsR0FBRyxTQUFTLElBQUksRUFBRSxHQUFHLENBQUM7QUFBQSxNQUFHO0FBQUEsSUFDbEk7QUFBQSxFQUNGO0FBR08sV0FBUyxTQUFTLFNBQWlCLFNBQWlCLE9BQU8sR0FBRyxhQUFhLEtBQUssUUFBMENELGNBQWEsR0FBa0U7QUFDOU0sVUFBTSxJQUFJLElBQUksT0FBTyxTQUFTLFNBQVMsTUFBTSxRQUFRQSxXQUFVO0FBQy9ELFdBQU8sRUFBRSxTQUFTLEtBQUssRUFBRSxPQUFPLFdBQVksR0FBRSxLQUFLLElBQUksRUFBRTtBQUN6RCxVQUFNLElBQUssRUFBRSxTQUFTLElBQUksSUFBSSxFQUFFO0FBQ2hDLFVBQU0sT0FBTyxFQUFFLFNBQVMsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDO0FBQzdELFdBQU8sRUFBRSxRQUFRLEdBQUcsTUFBTSxFQUFFLE1BQU0sTUFBTSxLQUFLLFFBQVEsUUFBUSxLQUFLLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsRUFBRTtBQUFBLEVBQzVHOzs7QUMvUk8sTUFBTSxrQkFBeUIsRUFBRSxPQUFPLE9BQU8sS0FBSyxPQUFPLG1CQUFtQixZQUFZLElBQUksaUJBQWlCLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxFQUFFO0FBTW5JLE1BQU0sY0FBYztBQUNiLE1BQU0sZ0JBQXVCLEVBQUUsT0FBTyxNQUFNLEtBQUssRUFBRSxRQUFRLFlBQVksR0FBRyxDQUFDLEdBQUcsTUFBTSxPQUFPLElBQUksS0FBSyxJQUFJLEdBQUcsT0FBTyxJQUFJLFNBQVMsQ0FBQyxDQUFDLENBQUMsR0FBRyxPQUFPLG1CQUFtQixZQUFZLGFBQWEsaUJBQWlCLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxFQUFFOzs7QUNQdE4sTUFBTSxXQUFXO0FBUWpCLE1BQU0sZ0JBQWdCO0FBQzdCLE1BQU1FLGFBQVk7QUFHbEIsV0FBUyxNQUFNLFFBQTZCO0FBQzFDLFVBQU0sTUFBbUIsQ0FBQztBQUFHLFFBQUksT0FBTztBQUN4QyxhQUFTLElBQUksR0FBRyxJQUFJLFNBQVNBLFlBQVcsS0FBSztBQUMzQyxZQUFNLE9BQU8sSUFBSSxNQUFNLElBQUksV0FBVztBQUFXLFVBQUksS0FBSyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEtBQU07QUFDM0UsVUFBSSxLQUFLLEVBQUUsTUFBTSxNQUFNLEVBQUUsQ0FBQztBQUFHLGNBQVEsS0FBSyxJQUFJLEVBQUUsQ0FBQztBQUFBLElBQ25EO0FBQ0EsV0FBTyxJQUFJLFNBQVMsTUFBTSxDQUFDLEVBQUUsTUFBTSxXQUFXLE1BQU0sRUFBRSxDQUFDO0FBQUEsRUFDekQ7QUFFTyxNQUFNLFlBQXdCO0FBQUEsSUFDbkMsRUFBRSxJQUFJLGFBQWEsTUFBTSxhQUFhLE1BQU0sNkJBQTZCLE9BQU8sTUFBTSxVQUFVLEVBQUU7QUFBQSxJQUNsRztBQUFBLE1BQUUsSUFBSTtBQUFBLE1BQVMsTUFBTTtBQUFBLE1BQWMsTUFBTTtBQUFBLE1BQXFFLE9BQU87QUFBQSxNQUFNLFVBQVU7QUFBQSxNQUNuSSxPQUFPLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFPLEVBQUUsU0FBUyxXQUFXLEVBQUUsTUFBTSxXQUFvQixNQUFNLEVBQUUsS0FBSyxJQUFJLENBQUU7QUFBQSxJQUFFO0FBQUEsSUFDckc7QUFBQSxNQUFFLElBQUk7QUFBQSxNQUFTLE1BQU07QUFBQSxNQUFTLE1BQU07QUFBQSxNQUE2QyxPQUFPO0FBQUEsTUFBTSxVQUFVO0FBQUEsTUFDdEcsT0FBTyxDQUFDLE1BQU0sTUFBTSxLQUFLLE1BQU0sU0FBUyxDQUFDLElBQUksSUFBSSxDQUFDO0FBQUEsSUFBRTtBQUFBLElBQ3RELEVBQUUsSUFBSSxXQUFXLE1BQU0sV0FBVyxNQUFNLHdDQUF3QyxPQUFPLEdBQUcsVUFBVSxHQUFHO0FBQUEsSUFDdkc7QUFBQSxNQUFFLElBQUk7QUFBQSxNQUFZLE1BQU07QUFBQSxNQUFZLE1BQU07QUFBQSxNQUE4QyxPQUFPO0FBQUEsTUFBSyxVQUFVO0FBQUEsTUFDNUcsT0FBTyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTyxFQUFFLFNBQVMsVUFBVSxFQUFFLFNBQVMsV0FBVyxFQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sS0FBSyxJQUFJLEdBQUcsRUFBRSxPQUFPLENBQUMsRUFBRSxJQUFJLENBQUU7QUFBQSxJQUFFO0FBQUEsRUFDakk7QUFHTyxNQUFNLFlBQVksQ0FBQyxJQUFVLG9CQUFJLEtBQUssTUFBYyxLQUFLLE1BQU0sS0FBSyxJQUFJLEVBQUUsWUFBWSxHQUFHLEVBQUUsU0FBUyxHQUFHLEVBQUUsUUFBUSxDQUFDLElBQUksS0FBUTtBQUM5SCxNQUFNLGFBQWEsQ0FBQyxNQUF1QixPQUFPLFVBQVUsQ0FBQyxLQUFLLElBQUksS0FBSyxJQUFJO0FBQy9FLE1BQU0sY0FBYyxDQUFDLFFBQTBCLFdBQVksTUFBTSxVQUFVLFNBQVUsVUFBVSxVQUFVLFVBQVUsTUFBTTtBQUV6SCxXQUFTLFdBQVcsS0FBZSxNQUE0QjtBQUNwRSxXQUFPLEVBQUUsR0FBRyxpQkFBaUIsT0FBTyxPQUFPLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxJQUFJLGVBQWUsSUFBSSxJQUFJLFFBQVEsQ0FBQyxHQUFHLEtBQUs7QUFBQSxFQUM3Rzs7O0FDaENPLE1BQU0sWUFBb0MsRUFBRSxTQUFTLFVBQVUsUUFBUSxVQUFVLFFBQVEsUUFBUSxRQUFRLFFBQVEsTUFBTSxRQUFRLFdBQVcsT0FBTztBQUtqSixNQUFNLGFBQWE7OztBQ2JuQixNQUFNLFlBQVk7QUFDekIsTUFBTSxNQUFNO0FBQ1osTUFBTSxVQUFVO0FBR1QsTUFBTSxlQUE2QixDQUFDLFFBQVEsVUFBVSxRQUFRLFdBQVc7QUFxQnpFLE1BQU0sZ0JBQWdCO0FBR3RCLFdBQVMsY0FBb0I7QUFDbEMsVUFBTSxRQUFRLENBQUM7QUFDZixlQUFXLE1BQU0sTUFBTyxPQUFNLEVBQUUsSUFBSSxFQUFFLE9BQU8sR0FBRyxRQUFRLEVBQUU7QUFDMUQsV0FBTyxFQUFFLEdBQUcsU0FBUyxNQUFNLE1BQU0sTUFBTSxHQUFHLFNBQVMsR0FBRyxPQUFPLFVBQVUsRUFBRSxPQUFPLE1BQU0sS0FBSyxLQUFLLEdBQUcsWUFBWSxVQUFVLE9BQU8sU0FBUyxNQUFNLENBQUMsR0FBRyxPQUFPLENBQUMsR0FBRyxZQUFZLEdBQUcsUUFBUSxDQUFDLEdBQUcsYUFBYSxHQUFHLFNBQVMsRUFBRSxNQUFNLEVBQUUsR0FBRyxXQUFXLEdBQUcsTUFBTSxHQUFHLE9BQU8sS0FBSztBQUFBLEVBQ3BRO0FBRU8sV0FBUyxlQUE2QjtBQUFFLFFBQUk7QUFBRSxhQUFPLE9BQU8saUJBQWlCLGNBQWMsT0FBTztBQUFBLElBQWMsUUFBUTtBQUFFLGFBQU87QUFBQSxJQUFNO0FBQUEsRUFBRTtBQUd6SSxXQUFTLFNBQVMsS0FBZ0I7QUFDdkMsVUFBTSxPQUFPLFlBQVk7QUFDekIsUUFBSSxDQUFDLE9BQU8sT0FBTyxRQUFRLFNBQVUsUUFBTztBQUM1QyxVQUFNLE9BQWlCLENBQUM7QUFDeEIsUUFBSSxNQUFNLFFBQVEsSUFBSSxJQUFJO0FBQUcsaUJBQVcsS0FBSyxJQUFJLEtBQU0sS0FBSSxNQUFNLFNBQVMsQ0FBQyxLQUFLLENBQUMsS0FBSyxTQUFTLENBQUMsS0FBSyxLQUFLLFNBQVMsVUFBVyxNQUFLLEtBQUssQ0FBQztBQUFBO0FBQ3pJLFFBQUksS0FBSyxPQUFRLE1BQUssT0FBTztBQUM3QixRQUFJLElBQUksU0FBUyxPQUFPLElBQUksVUFBVSxVQUFVO0FBQzlDLGlCQUFXLE1BQU0sT0FBTztBQUN0QixjQUFNLElBQUksSUFBSSxNQUFNLEVBQUU7QUFDdEIsWUFBSSxLQUFLLE9BQU8sU0FBUyxFQUFFLEtBQUssS0FBSyxPQUFPLFNBQVMsRUFBRSxNQUFNLEVBQUcsTUFBSyxNQUFNLEVBQUUsSUFBSSxFQUFFLE9BQU8sS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLEVBQUUsS0FBSyxDQUFDLEdBQUcsUUFBUSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sRUFBRSxNQUFNLENBQUMsRUFBRTtBQUFBLE1BQ3hLO0FBQUEsSUFDRjtBQUNBLFFBQUksSUFBSSxZQUFZLE9BQU8sSUFBSSxhQUFhLFVBQVU7QUFDcEQsVUFBSSxPQUFPLElBQUksU0FBUyxVQUFVLFVBQVcsTUFBSyxTQUFTLFFBQVEsSUFBSSxTQUFTO0FBQ2hGLFVBQUksT0FBTyxJQUFJLFNBQVMsUUFBUSxVQUFXLE1BQUssU0FBUyxNQUFNLElBQUksU0FBUztBQUFBLElBQzlFO0FBQ0EsUUFBSSxhQUFhLFNBQVMsSUFBSSxVQUFVLEVBQUcsTUFBSyxhQUFhLElBQUk7QUFDakUsUUFBSSxPQUFPLElBQUksVUFBVSxZQUFZLHFCQUFxQixLQUFLLElBQUksS0FBSyxFQUFHLE1BQUssUUFBUSxJQUFJO0FBQzVGLFFBQUksTUFBTSxRQUFRLElBQUksSUFBSSxFQUFHLE1BQUssT0FBTyxJQUFJLEtBQUssT0FBTyxDQUFDLE1BQVcsT0FBTyxNQUFNLFlBQVksRUFBRSxTQUFTLEVBQUUsRUFBRSxNQUFNLEdBQUc7QUFBQSxhQUM3RyxJQUFJLFVBQVUsT0FBTyxJQUFJLFdBQVcsWUFBWSxPQUFPLEtBQUssSUFBSSxNQUFNLEVBQUUsT0FBUSxNQUFLLE9BQU87QUFDckcsUUFBSSxNQUFNLFFBQVEsSUFBSSxLQUFLLEdBQUc7QUFDNUIsWUFBTSxNQUFNLG9CQUFJLElBQVk7QUFDNUIsaUJBQVcsS0FBSyxJQUFJLE9BQU87QUFDekIsWUFBSSxLQUFLLE1BQU0sVUFBVSxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sVUFBVSxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssS0FBSyxJQUFJLElBQUksRUFBRSxFQUFFLEtBQUssQ0FBQyxPQUFPLFVBQVUsRUFBRSxJQUFJLEtBQUssRUFBRSxPQUFPLEtBQUssRUFBRSxPQUFPLFdBQVk7QUFDN0osWUFBSSxJQUFJLEVBQUUsRUFBRTtBQUFHLGFBQUssTUFBTSxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksTUFBTSxFQUFFLE1BQU0sUUFBUSxPQUFPLEVBQUUsV0FBVyxXQUFXLEVBQUUsT0FBTyxNQUFNLEdBQUcsRUFBRSxJQUFJLEdBQUcsQ0FBQztBQUFBLE1BQzlIO0FBQUEsSUFDRjtBQUNBLFVBQU0sUUFBUSxLQUFLLE1BQU0sT0FBTyxDQUFDLEdBQUcsTUFBTSxLQUFLLElBQUksR0FBRyxFQUFFLEVBQUUsR0FBRyxDQUFDO0FBQzlELFNBQUssYUFBYSxLQUFLLElBQUksUUFBUSxHQUFHLE9BQU8sVUFBVSxJQUFJLFVBQVUsS0FBSyxJQUFJLGFBQWEsSUFBSSxJQUFJLGFBQWEsQ0FBQztBQUNqSCxRQUFJLElBQUksVUFBVSxPQUFPLElBQUksV0FBVztBQUFVLGlCQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTyxRQUFRLElBQUksTUFBTSxFQUFHLEtBQUksT0FBTyxNQUFNLFlBQVksRUFBRSxTQUFTLE1BQU0sT0FBTyxVQUFVLENBQUMsS0FBTSxJQUFlLEVBQUcsTUFBSyxPQUFPLENBQUMsSUFBSTtBQUFBO0FBQzVNLFFBQUksT0FBTyxVQUFVLElBQUksV0FBVyxLQUFLLElBQUksZUFBZSxLQUFLLElBQUksY0FBYyxHQUFJLE1BQUssY0FBYyxJQUFJO0FBQzlHLFFBQUksSUFBSSxXQUFXLE9BQU8sVUFBVSxJQUFJLFFBQVEsSUFBSSxLQUFLLElBQUksUUFBUSxRQUFRLEtBQUssSUFBSSxRQUFRLFFBQVEsS0FBTSxNQUFLLFFBQVEsT0FBTyxJQUFJLFFBQVE7QUFDNUksUUFBSSxPQUFPLFVBQVUsSUFBSSxJQUFJLEtBQUssSUFBSSxRQUFRLEtBQUssSUFBSSxRQUFRLElBQUssTUFBSyxPQUFPLElBQUksY0FBYyxJQUFJLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxJQUFJLE9BQU8sR0FBRztBQUFBLGFBQ3BJLElBQUksU0FBUyxVQUFhLE9BQU8sS0FBSyxLQUFLLE1BQU0sRUFBRSxPQUFRLE1BQUssT0FBTztBQUNoRixRQUFJLElBQUksU0FBUyxPQUFPLFVBQVUsSUFBSSxNQUFNLEdBQUcsS0FBSyxJQUFJLE1BQU0sTUFBTSxLQUFLLElBQUksTUFBTSxNQUFNLElBQUssTUFBSyxRQUFRLEVBQUUsS0FBSyxJQUFJLE1BQU0sS0FBSyxLQUFLLENBQUMsQ0FBQyxJQUFJLE1BQU0sSUFBSTtBQUN0SixXQUFPO0FBQUEsRUFDVDtBQUVPLFdBQVMsU0FBUyxRQUFzQixhQUFhLEdBQVM7QUFDbkUsUUFBSTtBQUFFLFlBQU0sSUFBSSxTQUFTLE1BQU0sUUFBUSxHQUFHO0FBQUcsYUFBTyxTQUFTLElBQUksS0FBSyxNQUFNLENBQUMsSUFBSSxJQUFJO0FBQUEsSUFBRyxRQUFRO0FBQUUsYUFBTyxZQUFZO0FBQUEsSUFBRztBQUFBLEVBQzFIO0FBRU8sV0FBUyxVQUFVLE1BQVksUUFBc0IsYUFBYSxHQUFTO0FBQ2hGLFFBQUk7QUFBRSxVQUFJLE1BQU8sT0FBTSxRQUFRLEtBQUssS0FBSyxVQUFVLElBQUksQ0FBQztBQUFBLElBQUcsUUFBUTtBQUFBLElBQThDO0FBQUEsRUFDbkg7QUFHTyxXQUFTLGVBQWUsT0FBMEIsUUFBc0IsYUFBYSxHQUFhO0FBQ3ZHLFVBQU0sSUFBSSxTQUFTLEtBQUs7QUFBRyxNQUFFLFdBQVcsRUFBRSxHQUFHLEVBQUUsVUFBVSxHQUFHLE1BQU07QUFBRyxjQUFVLEdBQUcsS0FBSztBQUFHLFdBQU8sRUFBRTtBQUFBLEVBQ3JHOzs7QUNqRk8sTUFBTSxZQUFZO0FBR2xCLE1BQU0sVUFBVTtBQUFBLElBQ3JCLGdCQUFnQixFQUFFLE1BQU0sR0FBRyxRQUFRLEdBQUcsTUFBTSxHQUFHLFdBQVcsRUFBRTtBQUFBLElBQzVELFlBQVk7QUFBQSxJQUNaLHFCQUFxQjtBQUFBLEVBQ3ZCO0FBb0NPLE1BQU0sT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLEtBQUssUUFBUSxHQUFHLE1BQU0sS0FBSyxXQUFXLEVBQUUsR0FBaUMsYUFBYSxNQUFNLFVBQVUsSUFBSztBQUU1SSxNQUFNLFdBQVcsQ0FBQyxPQUFlLFNBQW1DO0FBM0QzRTtBQTJEOEUsZ0JBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxPQUFPLElBQUksSUFBSSxXQUFXLEtBQUssT0FBTSxVQUFLLFNBQVMsSUFBa0IsTUFBaEMsWUFBcUMsRUFBRSxDQUFDO0FBQUE7QUFFM0ssTUFBTSxrQkFBa0IsQ0FBQyxTQUF5QixPQUFPLElBQUksS0FBSyxNQUFNLE1BQU0sS0FBSyxJQUFJLEdBQUcsSUFBSSxDQUFDO0FBRy9GLFdBQVMsUUFBUSxNQUFZLEdBQW1CO0FBQUUsVUFBTUMsS0FBSSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sQ0FBQyxDQUFDO0FBQUcsU0FBSyxPQUFPLEtBQUssSUFBSSxLQUFLLEtBQUssT0FBT0EsRUFBQztBQUFHLFdBQU9BO0FBQUEsRUFBRztBQUM1SSxXQUFTLGVBQWUsR0FBVyxPQUE4QjtBQUFFLFVBQU0sSUFBSSxTQUFTLEtBQUs7QUFBRyxVQUFNQSxLQUFJLFFBQVEsR0FBRyxDQUFDO0FBQUcsY0FBVSxHQUFHLEtBQUs7QUFBRyxXQUFPQTtBQUFBLEVBQUc7QUFHdEosV0FBUyxVQUFVLE1BQVksTUFBYyxRQUFpQztBQUNuRixRQUFJLEtBQUssTUFBTSxVQUFVLFVBQVcsUUFBTztBQUMzQyxVQUFNLE9BQWlCLEVBQUUsSUFBSSxLQUFLLGNBQWMsTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksWUFBWSxLQUFLLE1BQU0sSUFBSSxDQUFDLENBQUMsR0FBRyxPQUFPO0FBQ2xILFNBQUssTUFBTSxLQUFLLElBQUk7QUFBRyxXQUFPO0FBQUEsRUFDaEM7QUFjQSxXQUFTLGdCQUFnQixNQUFZLFNBQWlCLFlBQXVEO0FBdEY3RztBQXVGRSxVQUFNLE1BQU0sVUFBVSxNQUFNLFlBQVksVUFBUyxVQUFLLE9BQU8sR0FBRyxNQUFmLFlBQW9CO0FBQ3JFLFNBQUssT0FBTyxHQUFHLElBQUksU0FBUztBQUM1QixRQUFJLFdBQVcsRUFBRyxRQUFPLEVBQUUsT0FBTyxNQUFNLE1BQU0sVUFBVSxNQUFNLFFBQVEsZUFBZSxVQUFVLEtBQUssV0FBVyxPQUFPLE1BQU0sT0FBTyxTQUFTLElBQUksSUFBSSxJQUFJLHNCQUFtQixVQUFVLEdBQUcsYUFBYSxLQUFLLGFBQWEsY0FBYyxRQUFRLG9CQUFvQjtBQUNqUSxTQUFLO0FBQ0wsUUFBSSxPQUF3QjtBQUM1QixRQUFJLEtBQUssZUFBZSxRQUFRLHFCQUFxQjtBQUFFLFdBQUssZUFBZSxRQUFRO0FBQXFCLGFBQU8sVUFBVSxNQUFNLFFBQVEsWUFBWSxlQUFlO0FBQUEsSUFBRztBQUNySyxXQUFPLEVBQUUsT0FBTyxPQUFPLE1BQU0sYUFBYSxLQUFLLGFBQWEsY0FBYyxRQUFRLG9CQUFvQjtBQUFBLEVBQ3hHO0FBR08sV0FBUyxtQkFBbUIsU0FBaUIsWUFBd0IsT0FBbUM7QUFDN0csVUFBTSxJQUFJLFNBQVMsS0FBSztBQUFHLFVBQU0sSUFBSSxZQUFZLEdBQUcsU0FBUyxVQUFVO0FBQUcsY0FBVSxHQUFHLEtBQUs7QUFBRyxXQUFPO0FBQUEsRUFDeEc7QUFLTyxXQUFTLGVBQWUsTUFBWSxLQUEwQjtBQUNuRSxRQUFJLEtBQUssU0FBUyxLQUFLLE1BQU0sUUFBUSxPQUFPLEtBQUssTUFBTSxJQUFLLFFBQU8sRUFBRSxPQUFPLE9BQU8sTUFBTSxNQUFNLE1BQU0sRUFBRTtBQUN2RyxTQUFLLFFBQVEsRUFBRSxLQUFLLEtBQUssS0FBSztBQUM5QixXQUFPLEVBQUUsT0FBTyxNQUFNLE1BQU0sVUFBVSxNQUFNLEdBQUcsaUJBQWlCLEdBQUcsTUFBTSxRQUFRLE1BQU0sS0FBSyxRQUFRLEVBQUU7QUFBQSxFQUN4RztBQUNPLFdBQVMsc0JBQXNCLEtBQWEsT0FBbUM7QUFBRSxVQUFNLElBQUksU0FBUyxLQUFLO0FBQUcsVUFBTSxJQUFJLGVBQWUsR0FBRyxHQUFHO0FBQUcsY0FBVSxHQUFHLEtBQUs7QUFBRyxXQUFPO0FBQUEsRUFBRztBQU83SyxXQUFTLGtCQUFrQixNQUFZLE1BQTZCO0FBQ3pFLFVBQU0sVUFBVSxPQUFPLEtBQUssUUFBUTtBQUFNLFFBQUksUUFBUyxNQUFLLFFBQVEsT0FBTztBQUMzRSxVQUFNLE9BQU8sT0FBTyxLQUFLLE9BQU8sdUJBQXVCLElBQUksVUFBVSxNQUFNLGdCQUFnQixJQUFJLEdBQUcsdUJBQW9CLElBQUksSUFBSTtBQUM5SCxXQUFPLEVBQUUsTUFBTSxNQUFNLFFBQVE7QUFBQSxFQUMvQjtBQUNPLFdBQVMseUJBQXlCLE1BQWMsT0FBcUM7QUFDMUYsVUFBTSxJQUFJLFNBQVMsS0FBSztBQUFHLFVBQU0sSUFBSSxrQkFBa0IsR0FBRyxJQUFJO0FBQUcsY0FBVSxHQUFHLEtBQUs7QUFBRyxXQUFPO0FBQUEsRUFDL0Y7QUFFTyxNQUFNLGtCQUFrQixDQUFDLFNBQXdCLFdBQVcsTUFBTSxPQUFPLE9BQU8sU0FBUyxDQUFDLEVBQUUsSUFBSSxRQUFRLElBQUk7QUFJNUcsTUFBTSxhQUFhLENBQUMsTUFBWSxPQUFlLE1BQXVCO0FBakk3RTtBQWlJZ0Ysc0JBQUssT0FBTyxRQUFRLE1BQU0sQ0FBQyxNQUEzQixZQUFnQztBQUFBO0FBQ3pHLFdBQVMsY0FBYyxNQUFZLE9BQXdCO0FBQUUsV0FBTyxTQUFTLEtBQU0sUUFBUSxPQUFPLFVBQVUsV0FBVyxNQUFNLE9BQU8sUUFBUSxDQUFDLEVBQUUsSUFBSSxRQUFRLElBQUk7QUFBQSxFQUFJO0FBQ25LLFdBQVMsbUJBQW1CLE1BQVksT0FBZSxHQUF3QjtBQUNwRixVQUFNLE1BQU0sT0FBTyxVQUFVLENBQUMsTUFBTSxFQUFFLE9BQU8sS0FBSztBQUFHLFFBQUksTUFBTSxLQUFLLENBQUMsY0FBYyxNQUFNLEdBQUcsRUFBRyxRQUFPO0FBQ3RHLFFBQUksTUFBTSxVQUFVLE1BQU0sU0FBVSxRQUFPO0FBQzNDLFdBQU8sTUFBTSxTQUFTLFdBQVcsTUFBTSxPQUFPLFFBQVEsSUFBSSxJQUFJLFdBQVcsTUFBTSxPQUFPLE1BQU0sSUFBSTtBQUFBLEVBQ2xHO0FBVU8sV0FBUyxTQUFTLE1BQXVEO0FBQzlFLFFBQUksTUFBTSxXQUFXLEtBQUssS0FBSztBQUFHLFdBQU8sTUFBTSxLQUFLLENBQUMsY0FBYyxNQUFNLEdBQUcsRUFBRztBQUMvRSxVQUFNLFFBQVEsT0FBTyxHQUFHLEVBQUU7QUFDMUIsV0FBTyxFQUFFLE9BQU8sWUFBWSxtQkFBbUIsTUFBTSxPQUFPLEtBQUssVUFBVSxJQUFJLEtBQUssYUFBYSxTQUFTO0FBQUEsRUFDNUc7QUFHTyxXQUFTLGFBQWEsTUFBc0I7QUFDakQsVUFBTSxPQUFpQixDQUFDO0FBQ3hCLFdBQU8sUUFBUSxDQUFDLElBQUksTUFBTTtBQUN4QixVQUFJLElBQUksS0FBSyxjQUFjLE1BQU0sQ0FBQyxFQUFHLE1BQUssS0FBSyxXQUFXLEdBQUcsRUFBRTtBQUMvRCxpQkFBVyxLQUFLLENBQUMsUUFBUSxXQUFXLEVBQW1CLEtBQUksbUJBQW1CLE1BQU0sR0FBRyxJQUFJLENBQUMsRUFBRyxNQUFLLEtBQUssVUFBVSxHQUFHLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFDcEksQ0FBQztBQUNELFFBQUksZ0JBQWdCLElBQUksRUFBRyxNQUFLLEtBQUssU0FBUztBQUM5QyxXQUFPO0FBQUEsRUFDVDtBQUdBLE1BQU0sWUFBb0MsRUFBRSxNQUFNLGFBQWEsV0FBVyxpQkFBaUI7QUFFcEYsV0FBUyxlQUFlLEtBQXFCO0FBcktwRDtBQXNLRSxRQUFJLFFBQVEsVUFBVyxRQUFPO0FBQzlCLFVBQU0sQ0FBQyxNQUFNLE9BQU8sSUFBSSxJQUFJLElBQUksTUFBTSxHQUFHO0FBQ3pDLFFBQUksU0FBUyxRQUFTLFFBQU8sVUFBVSxLQUFLLEVBQUUsT0FBTztBQUNyRCxhQUFRLGVBQVUsSUFBSSxNQUFkLFlBQW1CLFFBQVEsU0FBUyxVQUFVLEtBQUssRUFBRTtBQUFBLEVBQy9EO0FBRU8sV0FBUyxZQUFZLE1BQVksU0FBaUIsWUFBcUM7QUFDNUYsVUFBTSxTQUFTLGFBQWEsSUFBSSxHQUFHLElBQUksZ0JBQWdCLE1BQU0sU0FBUyxVQUFVO0FBQ2hGLFdBQU8sRUFBRSxHQUFHLEdBQUcsVUFBVSxhQUFhLElBQUksRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLE9BQU8sU0FBUyxDQUFDLENBQUMsRUFBRTtBQUFBLEVBQ2pGOzs7QUMxS08sTUFBTSxjQUFOLE1BQWtCO0FBQUEsSUFLdkIsWUFBb0IsT0FBb0IsTUFBVyxXQUFnQjtBQUEvQztBQUFvQjtBQUp4QztBQUNBO0FBQUEsMEJBQVE7QUFBVSwwQkFBUSxTQUE2QixDQUFDO0FBQUcsMEJBQVEsT0FBVztBQUFNLDBCQUFRLFFBQVk7QUFBTSwwQkFBUTtBQUFXLDBCQUFRO0FBQ3pJLDBCQUFRLEtBQUk7QUFBRywwQkFBUSxTQUFRO0FBQUcsMEJBQVEsV0FBVTtBQUFHLDBCQUFRLFFBQU87QUFBTywwQkFBUSxVQUFTO0FBQU8sMEJBQWlCLEtBQUk7QUF5QjFILDBCQUFRLFdBQVU7QUF0QmhCLFlBQU0sSUFBSTtBQUNWLFdBQUssU0FBUyxJQUFJLFFBQVEsY0FBYyxTQUFTLENBQUM7QUFDbEQsV0FBSyxNQUFNLFVBQVUseUJBQXlCLENBQUMsTUFBYyxJQUFJLFVBQVUsT0FBTyxFQUFFLGtCQUFrQixLQUFLLENBQUM7QUFDNUcsWUFBTSxPQUFPLEtBQUssSUFBSSxVQUFVLENBQUM7QUFBRyxXQUFLLFNBQVMsS0FBSztBQUFRLFdBQUssT0FBTyxRQUFRLE9BQU8sS0FBSyxDQUFDO0FBQ2hHLFdBQUssZUFBZSxFQUFFLFFBQVEsQ0FBQyxNQUFXO0FBQUUsVUFBRSxhQUFhO0FBQU8sVUFBRSwyQkFBMkI7QUFBQSxNQUFNLENBQUM7QUFDdEcsV0FBSyxJQUFJLGdCQUFnQixRQUFRLENBQUNDLE9BQVc7QUFBRSxRQUFBQSxHQUFFLEtBQUs7QUFBRyxRQUFBQSxHQUFFLGlCQUFpQjtBQUFNLFFBQUFBLEdBQUUsZ0JBQWdCO0FBQU0sYUFBSyxNQUFNQSxHQUFFLEtBQUssTUFBTSxHQUFHLEVBQUUsQ0FBQyxDQUFDLElBQUlBO0FBQUEsTUFBRyxDQUFDO0FBQ2pKLFdBQUssT0FBTyxLQUFLLHVCQUF1QixLQUFLLEVBQUUsS0FBSyxDQUFDLE1BQVcsRUFBRSxLQUFLLFNBQVMsZUFBZSxDQUFDLEtBQUs7QUFDckcsV0FBSyxLQUFLLFFBQVEsSUFBSTtBQUN0QixZQUFNLE9BQU8sS0FBSyxPQUFPLFFBQVEsWUFBWSxXQUFXLFFBQVEsRUFBRSxRQUFRLEtBQUssY0FBYyxHQUFHLEdBQUcsQ0FBQztBQUFHLFdBQUssU0FBUyxLQUFLO0FBQVEsV0FBSyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQUcsV0FBSyxTQUFTLElBQUk7QUFBTSxXQUFLLGFBQWE7QUFDM00sWUFBTSxLQUFLLElBQUksUUFBUSxpQkFBaUIsTUFBTSxDQUFDO0FBQUcsU0FBRyxlQUFlLFFBQVEsT0FBTyxNQUFNO0FBQUcsU0FBRyxnQkFBZ0IsSUFBSSxRQUFRLE9BQU8sS0FBSyxNQUFNLElBQUk7QUFBRyxTQUFHLGtCQUFrQjtBQUFNLFNBQUcsUUFBUTtBQUFNLFdBQUssV0FBVztBQUNoTixZQUFNLEtBQUssS0FBSyxLQUFLLElBQUksUUFBUSxlQUFlLGFBQWEsSUFBSSxDQUFDO0FBQUcsU0FBRyxrQkFBa0I7QUFBTSxTQUFHLFVBQVUsS0FBSztBQUNsSCxTQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsT0FBTyxHQUFHLEtBQUs7QUFBRyxTQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsTUFBTSxLQUFLLElBQUk7QUFBRyxTQUFHLGNBQWM7QUFBSyxTQUFHLGNBQWM7QUFDbkosU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLE9BQU8sS0FBSyxLQUFLO0FBQUcsU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLE1BQU0sS0FBSyxJQUFJO0FBQUcsU0FBRyxlQUFlO0FBQUssU0FBRyxlQUFlO0FBQUssU0FBRyxVQUFVLElBQUksUUFBUSxRQUFRLEdBQUcsS0FBSyxDQUFDO0FBQ3RNLFNBQUcsVUFBVTtBQUFNLFNBQUcsVUFBVTtBQUFLLFNBQUcsV0FBVztBQUFJLFNBQUcsU0FBUyxJQUFJLFFBQVEsT0FBTyxLQUFLLE1BQU0sR0FBRyxHQUFHO0FBQUcsU0FBRyxTQUFTLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxLQUFLLEdBQUc7QUFBRyxTQUFHLFlBQVksSUFBSSxRQUFRLE9BQU8sS0FBSyxHQUFHLEtBQUssQ0FBQztBQUNoTixTQUFHLFlBQVksUUFBUSxlQUFlO0FBQWUsU0FBRyxNQUFNO0FBQUEsSUFDaEU7QUFBQSxJQUVRLEtBQUssTUFBYyxPQUFPLE9BQU8sT0FBTyxPQUFPO0FBQ3JELFlBQU1BLEtBQUksS0FBSyxNQUFNLElBQUk7QUFBRyxVQUFJLENBQUNBLEdBQUc7QUFDcEMsVUFBSSxLQUFLLE9BQU8sS0FBSyxRQUFRQSxHQUFHLE1BQUssSUFBSSxLQUFLO0FBQzlDLE1BQUFBLEdBQUUsS0FBSztBQUFHLE1BQUFBLEdBQUUsTUFBTSxNQUFNLEdBQUdBLEdBQUUsTUFBTUEsR0FBRSxFQUFFO0FBQUcsV0FBSyxNQUFNQTtBQUFHLFdBQUssT0FBTyxDQUFDO0FBQU0sV0FBSyxVQUFVO0FBQUEsSUFDNUY7QUFBQSxJQUVBLFdBQVcsSUFBYTtBQUFFLFdBQUssT0FBTyxXQUFXLEVBQUU7QUFBRyxVQUFJLEdBQUksTUFBSyxHQUFHLE1BQU07QUFBQSxVQUFRLE1BQUssR0FBRyxLQUFLO0FBQUEsSUFBRztBQUFBO0FBQUEsSUFFcEcsYUFBa0I7QUFDaEIsV0FBSyxPQUFPLG1CQUFtQixJQUFJO0FBQ25DLFlBQU0sT0FBTyxLQUFLLFFBQVEsS0FBSyxLQUFLLG1CQUFtQixJQUFJLEdBQUcsS0FBSyxLQUFLLG9CQUFvQixFQUFFLE1BQU0sS0FBSyxLQUFLLE9BQU8sb0JBQW9CLEVBQUUsSUFBSSxJQUFJLFFBQVEsUUFBUSxHQUFHLE1BQU0sS0FBSyxHQUFHLENBQUMsQ0FBQztBQUN0TCxhQUFPLEtBQUssSUFBSSxJQUFJLFFBQVEsUUFBUSxHQUFHLE9BQU8sS0FBSyxHQUFHLENBQUMsQ0FBQztBQUFBLElBQzFEO0FBQUEsSUFFQSxPQUFPO0FBQUUsVUFBSSxDQUFDLEtBQUssT0FBUSxNQUFLLEtBQUssTUFBTTtBQUFBLElBQUc7QUFBQSxJQUM5QyxPQUFPO0FBQUUsVUFBSSxDQUFDLEtBQUssT0FBUSxNQUFLLEtBQUssTUFBTTtBQUFBLElBQUc7QUFBQTtBQUFBLElBRTlDLFNBQVM7QUFBRSxXQUFLLFNBQVM7QUFBTSxXQUFLLEtBQUssUUFBUSxPQUFPLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFDL0QsU0FBUztBQUFFLFVBQUksS0FBSyxRQUFRO0FBQUUsYUFBSyxTQUFTO0FBQU8sYUFBSyxLQUFLLFFBQVE7QUFBQSxNQUFHLFdBQVcsS0FBSyxRQUFRLEtBQUssUUFBUSxLQUFLLE1BQU0sTUFBTSxFQUFHLE1BQUssS0FBSyxRQUFRLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFFMUosT0FBTyxJQUFZO0FBQ2pCLFdBQUssS0FBSztBQUNWLFVBQUksS0FBSyxPQUFPLENBQUMsS0FBSyxJQUFJLGFBQWEsQ0FBQyxLQUFLLE9BQVEsTUFBSyxLQUFLLFFBQVEsSUFBSTtBQUFBLGVBQ2xFLEtBQUssT0FBTyxDQUFDLEtBQUssSUFBSSxhQUFhLEtBQUssVUFBVSxDQUFDLEtBQUssUUFBUyxNQUFLLEtBQUssUUFBUSxJQUFJO0FBQ2hHLFVBQUksQ0FBQyxLQUFLLFFBQVEsQ0FBQyxLQUFLLFFBQVE7QUFBRSxhQUFLLFNBQVM7QUFBSSxZQUFJLEtBQUssUUFBUSxLQUFLLFNBQVM7QUFBRSxlQUFLLFFBQVE7QUFBRyxlQUFLLFVBQVUsSUFBSSxLQUFLLE9BQU8sSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDL0osV0FBSyxHQUFHLFdBQVcsS0FBSyxTQUFTLElBQUssS0FBSyxRQUFRLEtBQUssUUFBUSxLQUFLLE1BQU0sTUFBTSxJQUFJLE1BQU07QUFBQSxJQUM3RjtBQUFBLElBRUEsVUFBVTtBQUFFLFdBQUssR0FBRyxLQUFLO0FBQUcsV0FBSyxHQUFHLFFBQVE7QUFBRyxXQUFLLElBQUksZ0JBQWdCLFFBQVEsQ0FBQ0EsT0FBV0EsR0FBRSxRQUFRLENBQUM7QUFBRyxXQUFLLElBQUksVUFBVSxRQUFRLENBQUMsTUFBVyxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssT0FBTyxlQUFlLEVBQUUsUUFBUSxDQUFDLE1BQVcsRUFBRSxRQUFRLENBQUM7QUFBRyxXQUFLLE9BQU8sUUFBUTtBQUFBLElBQUc7QUFBQSxFQUN2UDs7O0FDL0NBLE1BQU0sU0FBcUI7QUFBQSxJQUN6QixDQUFDLEtBQUssUUFBUSxLQUFLLFFBQVEsTUFBTTtBQUFBLElBQ2pDLENBQUMsT0FBTyxRQUFRLFFBQVEsS0FBSyxNQUFNO0FBQUEsSUFDbkMsQ0FBQyxRQUFRLEtBQUssUUFBUSxRQUFRLEdBQUc7QUFBQSxJQUNqQyxDQUFDLE9BQU8sUUFBUSxRQUFRLFFBQVEsTUFBTTtBQUFBLEVBQ3hDO0FBQ0EsTUFBTSxPQUFPLEtBQUs7QUFFbEIsTUFBTSxjQUFOLE1BQWtCO0FBQUEsSUFNaEIsY0FBYztBQUxkLDBCQUFRLE9BQTJCO0FBQ25DLDBCQUFRO0FBQW1CLDBCQUFRO0FBQXFCLDBCQUFRO0FBQW1CLDBCQUFRO0FBQzNGLG1DQUFRO0FBQU0saUNBQU07QUFBTSxrQ0FBYTtBQUN2QywwQkFBUSxTQUFRO0FBQUcsMEJBQVEsU0FBUTtBQUFHLDBCQUFRLFFBQU87QUFBRywwQkFBUSxVQUFpQyxDQUFDO0FBSWxHLDBCQUFRLFVBQWtDO0FBQU0sMEJBQVEsVUFBUztBQUZqRCxZQUFNLElBQUksU0FBUyxFQUFFO0FBQVUsV0FBSyxRQUFRLEVBQUU7QUFBTyxXQUFLLE1BQU0sRUFBRTtBQUFBLElBQUs7QUFBQTtBQUFBO0FBQUEsSUFLL0Usa0JBQWtCO0FBQ3hCLFVBQUk7QUFBRSxjQUFNLElBQUssVUFBa0I7QUFBYyxZQUFJLEVBQUcsR0FBRSxPQUFPO0FBQUEsTUFBWSxRQUFRO0FBQUEsTUFBc0I7QUFDM0csVUFBSSxLQUFLLE9BQVE7QUFDakIsVUFBSTtBQUNGLGNBQU0sSUFBSSxLQUFLLE1BQU0sSUFBSSxZQUFZLEtBQUssSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLFNBQVMsR0FBRyxHQUFHLE1BQU0sQ0FBQyxHQUFXLE1BQWM7QUFBRSxtQkFBUyxJQUFJLEdBQUcsSUFBSSxFQUFFLFFBQVEsSUFBSyxHQUFFLFNBQVMsSUFBSSxHQUFHLEVBQUUsV0FBVyxDQUFDLENBQUM7QUFBQSxRQUFHO0FBQ2xMLFlBQUksR0FBRyxNQUFNO0FBQUcsVUFBRSxVQUFVLEdBQUcsS0FBSyxJQUFJLEdBQUcsSUFBSTtBQUFHLFlBQUksR0FBRyxNQUFNO0FBQUcsWUFBSSxJQUFJLE1BQU07QUFBRyxVQUFFLFVBQVUsSUFBSSxJQUFJLElBQUk7QUFBRyxVQUFFLFVBQVUsSUFBSSxHQUFHLElBQUk7QUFBRyxVQUFFLFVBQVUsSUFBSSxHQUFHLElBQUk7QUFDL0osVUFBRSxVQUFVLElBQUksT0FBTyxJQUFJO0FBQUcsVUFBRSxVQUFVLElBQUksT0FBTyxJQUFJO0FBQUcsVUFBRSxVQUFVLElBQUksR0FBRyxJQUFJO0FBQUcsVUFBRSxVQUFVLElBQUksSUFBSSxJQUFJO0FBQUcsWUFBSSxJQUFJLE1BQU07QUFBRyxVQUFFLFVBQVUsSUFBSSxJQUFJLEdBQUcsSUFBSTtBQUM3SixjQUFNLEtBQUssSUFBSSxNQUFNLElBQUksZ0JBQWdCLElBQUksS0FBSyxDQUFDLEdBQUcsR0FBRyxFQUFFLE1BQU0sWUFBWSxDQUFDLENBQUMsQ0FBQztBQUFHLFdBQUcsT0FBTztBQUFNLFdBQUcsU0FBUztBQUFNLFdBQUcsYUFBYSxlQUFlLEVBQUU7QUFBRyxhQUFLLFNBQVM7QUFDdkssV0FBRyxLQUFLLEVBQUUsTUFBTSxNQUFNO0FBQUUsZUFBSyxTQUFTO0FBQUEsUUFBTSxDQUFDO0FBQUEsTUFDL0MsUUFBUTtBQUFBLE1BQWdFO0FBQUEsSUFDMUU7QUFBQTtBQUFBLElBRUEsU0FBK0M7QUFBRSxhQUFPLEVBQUUsT0FBTyxLQUFLLE1BQU0sS0FBSyxJQUFJLFFBQVEsZUFBZSxVQUFVLENBQUMsQ0FBQyxLQUFLLE9BQU8sS0FBSyxJQUFJLFVBQVUsVUFBVTtBQUFBLElBQUc7QUFBQTtBQUFBLElBRXBLLE9BQU87QUFBRSxXQUFLLE9BQU87QUFBRyxZQUFNLElBQUksTUFBTTtBQUFFLGFBQUssS0FBSyxTQUFTO0FBQUEsTUFBRztBQUFHLFVBQUksS0FBSyxPQUFPLEtBQUssSUFBSSxVQUFVLFVBQVcsTUFBSyxJQUFJLE9BQU8sRUFBRSxLQUFLLENBQUMsRUFBRSxNQUFNLE1BQU07QUFBQSxNQUFDLENBQUM7QUFBQSxVQUFRLEdBQUU7QUFBQSxJQUFHO0FBQUE7QUFBQSxJQUd0SyxTQUFTO0FBQ1AsV0FBSyxnQkFBZ0I7QUFDckIsVUFBSSxDQUFDLEtBQUssS0FBSztBQUNiLGNBQU0sSUFBSyxPQUFlLGdCQUFpQixPQUFlO0FBQW9CLFlBQUksQ0FBQyxFQUFHO0FBQ3RGLGNBQU0sTUFBb0IsS0FBSyxNQUFNLElBQUksRUFBRTtBQUMzQyxjQUFNLE9BQU8sSUFBSSx5QkFBeUI7QUFBRyxhQUFLLFFBQVEsSUFBSSxXQUFXO0FBQ3pFLGFBQUssU0FBUyxJQUFJLFdBQVc7QUFBRyxhQUFLLE9BQU8sS0FBSyxRQUFRO0FBQUssYUFBSyxPQUFPLFFBQVEsSUFBSTtBQUN0RixhQUFLLFdBQVcsSUFBSSxXQUFXO0FBQUcsYUFBSyxTQUFTLFFBQVEsS0FBSyxNQUFNO0FBQUcsYUFBSyxTQUFTLElBQUksV0FBVztBQUFHLGFBQUssT0FBTyxRQUFRLEtBQUssTUFBTTtBQUNySSxZQUFJLGdCQUFnQixNQUFNO0FBQUUsaUJBQU8sY0FBYyxJQUFJLE1BQU0sbUJBQW1CLENBQUM7QUFBQSxRQUFHO0FBQ2xGLGNBQU0sTUFBTSxJQUFJO0FBQVksYUFBSyxXQUFXLElBQUksYUFBYSxHQUFHLEtBQUssSUFBSSxVQUFVO0FBQUcsY0FBTSxJQUFJLEtBQUssU0FBUyxlQUFlLENBQUM7QUFBRyxpQkFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLElBQUssR0FBRSxDQUFDLElBQUksS0FBSyxPQUFPLElBQUksSUFBSTtBQUFBLE1BQzVMO0FBQ0EsVUFBSSxLQUFLLElBQUksVUFBVSxVQUFXLE1BQUssSUFBSSxPQUFPLEVBQUUsTUFBTSxNQUFNO0FBQUEsTUFBQyxDQUFDO0FBQ2xFLFVBQUksQ0FBQyxLQUFLLFFBQVE7QUFBRSxhQUFLLFNBQVM7QUFBTSxZQUFJO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLElBQUksYUFBYSxHQUFHLEdBQUcsS0FBSyxHQUFHLElBQUksS0FBSyxJQUFJLG1CQUFtQjtBQUFHLFlBQUUsU0FBUztBQUFHLFlBQUUsUUFBUSxLQUFLLElBQUksV0FBVztBQUFHLFlBQUUsTUFBTSxDQUFDO0FBQUEsUUFBRyxRQUFRO0FBQUEsUUFBZTtBQUFBLE1BQUU7QUFDbk4sV0FBSyxXQUFXO0FBQUcsV0FBSyxVQUFVO0FBQUEsSUFDcEM7QUFBQSxJQUVBLFNBQVMsSUFBYTtBQUFFLFdBQUssUUFBUTtBQUFJLHFCQUFlLEVBQUUsT0FBTyxHQUFHLENBQUM7QUFBRyxXQUFLLFdBQVc7QUFBRyxXQUFLLFVBQVU7QUFBRyxhQUFPLGNBQWMsSUFBSSxNQUFNLGdCQUFnQixDQUFDO0FBQUEsSUFBRztBQUFBLElBQ2hLLE9BQU8sSUFBYTtBQUFFLFdBQUssTUFBTTtBQUFJLHFCQUFlLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFLLFdBQVc7QUFBRyxhQUFPLGNBQWMsSUFBSSxNQUFNLGdCQUFnQixDQUFDO0FBQUcsVUFBSSxHQUFJLE1BQUssS0FBSyxLQUFLO0FBQUEsSUFBRztBQUFBO0FBQUEsSUFFbEssU0FBUztBQUFFLFlBQU0sSUFBSSxTQUFTLEVBQUU7QUFBVSxXQUFLLFFBQVEsRUFBRTtBQUFPLFdBQUssTUFBTSxFQUFFO0FBQUssV0FBSyxXQUFXO0FBQUcsV0FBSyxVQUFVO0FBQUEsSUFBRztBQUFBLElBQ3ZILFFBQVEsR0FBUztBQUFFLFdBQUssT0FBTztBQUFBLElBQUc7QUFBQSxJQUUxQixhQUFhO0FBQ25CLFVBQUksQ0FBQyxLQUFLLElBQUs7QUFBUSxZQUFNLElBQUksS0FBSyxJQUFJO0FBQzFDLFdBQUssU0FBUyxLQUFLLGdCQUFnQixLQUFLLFFBQVEsTUFBTSxHQUFHLEdBQUcsSUFBSTtBQUFHLFdBQUssT0FBTyxLQUFLLGdCQUFnQixLQUFLLE1BQU0sTUFBTSxHQUFHLEdBQUcsSUFBSTtBQUFBLElBQ2pJO0FBQUE7QUFBQSxJQUdRLFlBQVk7QUFDbEIsVUFBSSxDQUFDLEtBQUssSUFBSztBQUNmLFVBQUksS0FBSyxTQUFTLENBQUMsS0FBSyxPQUFPO0FBQUUsYUFBSyxRQUFRLEtBQUssSUFBSSxjQUFjO0FBQU0sYUFBSyxRQUFRLE9BQU8sWUFBWSxNQUFNLEtBQUssS0FBSyxHQUFHLEdBQUc7QUFBQSxNQUFHO0FBQ3BJLFVBQUksQ0FBQyxLQUFLLFNBQVMsS0FBSyxPQUFPO0FBQUUsc0JBQWMsS0FBSyxLQUFLO0FBQUcsYUFBSyxRQUFRO0FBQUEsTUFBRztBQUFBLElBQzlFO0FBQUEsSUFDUSxPQUFPO0FBQ2IsWUFBTSxNQUFNLEtBQUs7QUFBTSxVQUFJLElBQUksVUFBVSxXQUFXO0FBQUUsYUFBSyxRQUFRLElBQUksY0FBYztBQUFNO0FBQUEsTUFBUTtBQUNuRyxhQUFPLEtBQUssUUFBUSxJQUFJLGNBQWMsS0FBSztBQUFFLGFBQUssU0FBUyxLQUFLLE1BQU0sS0FBSyxLQUFLO0FBQUcsYUFBSyxTQUFTO0FBQU0sYUFBSyxRQUFRLEtBQUssT0FBTyxLQUFLO0FBQUEsTUFBSTtBQUFBLElBQzNJO0FBQUEsSUFDUSxTQUFTLE1BQWMsR0FBVztBQUN4QyxZQUFNLFFBQVEsT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFDLENBQUMsR0FBRyxRQUFRLE9BQU8sR0FBRyxTQUFTLEtBQUssU0FBUztBQUNyRixVQUFJLFVBQVUsRUFBRyxZQUFXLEtBQUssTUFBTyxNQUFLLE1BQU0sR0FBRyxZQUFZLEdBQUcsT0FBTyxJQUFJLEtBQUssT0FBTyxLQUFLLEdBQUc7QUFDcEcsVUFBSSxVQUFVLEtBQUssVUFBVSxFQUFHLE1BQUssTUFBTSxNQUFNLENBQUMsR0FBRyxRQUFRLEdBQUcsT0FBTyxLQUFLLE1BQU0sTUFBTSxHQUFHO0FBQzNGLFVBQUksUUFBUTtBQUNWLGFBQUssS0FBSyxHQUFHLElBQUk7QUFBRyxZQUFJLFVBQVUsRUFBRyxNQUFLLEtBQUssSUFBSSxPQUFPLEtBQUssSUFBSTtBQUNuRSxhQUFLLE1BQU0sSUFBSSxPQUFPLEtBQUssTUFBTSxNQUFNLFlBQVksR0FBSTtBQUFHLGFBQUssTUFBTSxJQUFJLE9BQU8sTUFBTSxNQUFNLE1BQU0sTUFBTSxZQUFZLEdBQUk7QUFDeEgsaUJBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxJQUFLLE1BQUssTUFBTSxNQUFNLEtBQU0sT0FBTyxJQUFJLEtBQUssQ0FBRSxJQUFJLEdBQUcsWUFBWSxJQUFJLElBQUksT0FBTyxHQUFHLE1BQU0sTUFBTSxNQUFPLElBQUk7QUFBQSxNQUNuSTtBQUFBLElBQ0Y7QUFBQSxJQUNRLE1BQU0sTUFBYyxNQUFzQixHQUFXLEtBQWEsTUFBYyxRQUFnQixJQUFZO0FBQ2xILFlBQU0sTUFBTSxLQUFLLEtBQU0sSUFBSSxJQUFJLGlCQUFpQixHQUFHQyxLQUFJLElBQUksV0FBVyxHQUFHLElBQUksSUFBSSxtQkFBbUI7QUFDcEcsUUFBRSxPQUFPO0FBQU0sUUFBRSxVQUFVLFFBQVE7QUFBTSxRQUFFLE9BQU87QUFBVyxRQUFFLFVBQVUsUUFBUTtBQUNqRixNQUFBQSxHQUFFLEtBQUssZUFBZSxNQUFRLENBQUM7QUFBRyxNQUFBQSxHQUFFLEtBQUssd0JBQXdCLE1BQU0sSUFBSSxLQUFLLElBQUksTUFBTyxNQUFNLENBQUM7QUFBRyxNQUFBQSxHQUFFLEtBQUssNkJBQTZCLE1BQVEsSUFBSSxHQUFHO0FBQ3hKLFFBQUUsUUFBUSxDQUFDO0FBQUcsUUFBRSxRQUFRQSxFQUFDO0FBQUcsTUFBQUEsR0FBRSxRQUFRLEtBQUssUUFBUTtBQUFHLFFBQUUsTUFBTSxDQUFDO0FBQUcsUUFBRSxLQUFLLElBQUksTUFBTSxJQUFJO0FBQUEsSUFDekY7QUFBQSxJQUNRLEtBQUssR0FBVyxNQUFjO0FBQ3BDLFlBQU0sTUFBTSxLQUFLLEtBQU0sSUFBSSxJQUFJLGlCQUFpQixHQUFHQSxLQUFJLElBQUksV0FBVztBQUN0RSxRQUFFLFVBQVUsZUFBZSxLQUFLLENBQUM7QUFBRyxRQUFFLFVBQVUsNkJBQTZCLElBQUksSUFBSSxJQUFJO0FBQUcsTUFBQUEsR0FBRSxLQUFLLGVBQWUsTUFBTSxDQUFDO0FBQUcsTUFBQUEsR0FBRSxLQUFLLDZCQUE2QixNQUFRLElBQUksR0FBRztBQUMvSyxRQUFFLFFBQVFBLEVBQUM7QUFBRyxNQUFBQSxHQUFFLFFBQVEsS0FBSyxRQUFRO0FBQUcsUUFBRSxNQUFNLENBQUM7QUFBRyxRQUFFLEtBQUssSUFBSSxJQUFJO0FBQUEsSUFDckU7QUFBQSxJQUNRLE1BQU0sR0FBVyxLQUFhLE1BQWMsTUFBd0IsTUFBYyxNQUFnQixLQUFLLFVBQVUsU0FBa0I7QUFDekksWUFBTSxNQUFNLEtBQUssS0FBTSxJQUFJLElBQUksbUJBQW1CLEdBQUcsSUFBSSxJQUFJLG1CQUFtQixHQUFHQSxLQUFJLElBQUksV0FBVztBQUN0RyxRQUFFLFNBQVMsS0FBSztBQUFVLFFBQUUsT0FBTztBQUFNLFFBQUUsVUFBVSxlQUFlLE1BQU0sQ0FBQztBQUFHLFVBQUksUUFBUyxHQUFFLFVBQVUsNkJBQTZCLFNBQVMsSUFBSSxHQUFHO0FBQ3BKLE1BQUFBLEdBQUUsS0FBSyxlQUFlLE1BQU0sQ0FBQztBQUFHLE1BQUFBLEdBQUUsS0FBSyw2QkFBNkIsTUFBUSxJQUFJLEdBQUc7QUFDbkYsUUFBRSxRQUFRLENBQUM7QUFBRyxRQUFFLFFBQVFBLEVBQUM7QUFBRyxNQUFBQSxHQUFFLFFBQVEsR0FBRztBQUFHLFFBQUUsTUFBTSxHQUFHLEtBQUssT0FBTyxJQUFJLEdBQUc7QUFBRyxRQUFFLEtBQUssSUFBSSxNQUFNLElBQUk7QUFBQSxJQUNwRztBQUFBO0FBQUEsSUFHUSxLQUFLLE1BQWMsS0FBYSxNQUFzQixNQUFjLFFBQVEsR0FBRyxTQUFrQixTQUFTLE1BQU8sS0FBSyxLQUFNO0FBQ2xJLFlBQU0sTUFBTSxLQUFLLEtBQU0sSUFBSSxJQUFJLGNBQWMsT0FBTyxJQUFJLElBQUksaUJBQWlCLEdBQUdBLEtBQUksSUFBSSxXQUFXLEdBQUcsSUFBSSxJQUFJLG1CQUFtQjtBQUNqSSxRQUFFLE9BQU87QUFBTSxRQUFFLFVBQVUsZUFBZSxNQUFNLENBQUM7QUFBRyxVQUFJLFFBQVMsR0FBRSxVQUFVLDZCQUE2QixTQUFTLElBQUksR0FBRztBQUMxSCxRQUFFLE9BQU87QUFBVyxRQUFFLFVBQVUsUUFBUTtBQUFJLE1BQUFBLEdBQUUsS0FBSyxlQUFlLE1BQVEsQ0FBQztBQUFHLE1BQUFBLEdBQUUsS0FBSyx3QkFBd0IsTUFBTSxJQUFJLE1BQU07QUFBRyxNQUFBQSxHQUFFLEtBQUssNkJBQTZCLE1BQVEsSUFBSSxHQUFHO0FBQ25MLFFBQUUsUUFBUSxDQUFDO0FBQUcsUUFBRSxRQUFRQSxFQUFDO0FBQUcsTUFBQUEsR0FBRSxRQUFRLEtBQUssTUFBTTtBQUFHLFFBQUUsTUFBTSxDQUFDO0FBQUcsUUFBRSxLQUFLLElBQUksTUFBTSxJQUFJO0FBQUEsSUFDdkY7QUFBQSxJQUNRLEtBQUssS0FBYSxNQUFjLE1BQXdCLE1BQWMsUUFBUSxHQUFHLFNBQWtCO0FBQUUsV0FBSyxNQUFNLEtBQUssSUFBSyxjQUFjLE9BQU8sS0FBSyxNQUFNLE1BQU0sTUFBTSxLQUFLLFFBQVEsT0FBTztBQUFBLElBQUc7QUFBQSxJQUM3TCxTQUFTLEtBQWEsSUFBWTtBQUFFLFlBQU0sSUFBSSxZQUFZLElBQUk7QUFBRyxVQUFJLEtBQUssS0FBSyxPQUFPLEdBQUcsS0FBSyxLQUFLLEdBQUksUUFBTztBQUFPLFdBQUssT0FBTyxHQUFHLElBQUk7QUFBRyxhQUFPO0FBQUEsSUFBTTtBQUFBO0FBQUEsSUFHaEssS0FBSyxNQUFjLFFBQVEsR0FBRyxJQUFJLEdBQUc7QUFDbkMsVUFBSSxDQUFDLEtBQUssT0FBTyxDQUFDLEtBQUssT0FBTyxLQUFLLElBQUksVUFBVSxhQUFhLENBQUMsS0FBSyxTQUFTLFNBQVMsTUFBTSxHQUFHLEVBQUc7QUFDbEcsWUFBTSxJQUFJLENBQUMsR0FBVyxHQUFXLE1BQXNCQSxJQUFXLElBQVksT0FBZ0IsS0FBYyxPQUFnQixLQUFLLEtBQUssSUFBSSxHQUFHLEdBQUcsTUFBTUEsSUFBRyxRQUFRLElBQUksUUFBUSxRQUFRLElBQUksUUFBVyxLQUFLLEVBQUU7QUFDM00sWUFBTSxJQUFJLENBQUMsR0FBV0EsSUFBVyxNQUF3QixHQUFXLElBQVksT0FBZ0IsS0FBSyxLQUFLLEdBQUdBLElBQUcsTUFBTSxHQUFHLFFBQVEsSUFBSSxFQUFFO0FBQ3ZJLGNBQVEsTUFBTTtBQUFBLFFBQ1osS0FBSztBQUFXLFdBQUMsR0FBRyxNQUFNLE1BQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxPQUFPLEVBQUUsTUFBTSxNQUFNLFlBQVksTUFBTSxFQUFFLENBQUM7QUFBRyxZQUFFLEtBQUssTUFBTSxVQUFVLE1BQU0sR0FBRyxLQUFLLE1BQU8sSUFBSTtBQUFHO0FBQUEsUUFDL0ksS0FBSztBQUFVLFlBQUUsS0FBSyxNQUFNLFFBQVEsTUFBTSxHQUFHLE1BQU0sSUFBSTtBQUFHLFlBQUUsTUFBTSxNQUFNLFFBQVEsTUFBTSxNQUFNLEtBQUssSUFBSTtBQUFHO0FBQUEsUUFDeEcsS0FBSztBQUFVLFdBQUMsR0FBRyxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsSUFBSSxNQUFNLEVBQUUsTUFBTSxJQUFJLElBQUksS0FBSyxZQUFZLE1BQU0sSUFBSSxNQUFNLElBQUksSUFBSSxNQUFPLElBQUksQ0FBQztBQUFHLFlBQUUsS0FBSyxNQUFNLFlBQVksTUFBTSxDQUFDO0FBQUc7QUFBQSxRQUM3SixLQUFLO0FBQVUsWUFBRSxLQUFLLE1BQU0sWUFBWSxNQUFNLEdBQUcsS0FBSyxNQUFNLEdBQUc7QUFBRyxZQUFFLEtBQUssS0FBSyxVQUFVLE1BQU0sTUFBTSxLQUFLLE1BQU0sR0FBRztBQUFHLFlBQUUsTUFBTSxNQUFNLFlBQVksTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUMzSixLQUFLO0FBQVEsWUFBRSxJQUFJLE1BQU0sWUFBWSxLQUFLLEdBQUcsSUFBSSxNQUFNLEdBQUc7QUFBRyxZQUFFLEtBQUssS0FBSyxZQUFZLE1BQU0sTUFBTSxJQUFJLE1BQU0sR0FBRztBQUFHLFlBQUUsS0FBSyxNQUFNLFdBQVcsS0FBSyxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQzFKLEtBQUs7QUFBYSxZQUFFLEtBQUssS0FBSyxZQUFZLE1BQU0sR0FBRyxLQUFLLE1BQU0sSUFBSTtBQUFHLFlBQUUsS0FBSyxNQUFNLFlBQVksTUFBTSxLQUFLLEtBQUssTUFBTSxJQUFJO0FBQUcsWUFBRSxNQUFNLEtBQUssWUFBWSxLQUFLLEdBQUcsR0FBRztBQUFHO0FBQUEsTUFDcEs7QUFBQSxJQUNGO0FBQUEsSUFDQSxLQUFLLE1BQVc7QUFDZCxVQUFJLENBQUMsS0FBSyxPQUFPLENBQUMsS0FBSyxPQUFPLEtBQUssSUFBSSxVQUFVLFVBQVc7QUFDNUQsY0FBUSxNQUFNO0FBQUEsUUFDWixLQUFLO0FBQU8sY0FBSSxDQUFDLEtBQUssU0FBUyxPQUFPLEVBQUUsRUFBRztBQUFRLGVBQUssS0FBSyxLQUFLLE1BQU0sUUFBUSxNQUFNLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDaEcsS0FBSztBQUFVLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxLQUFLLEdBQUcsSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxLQUFLLEdBQUcsS0FBSyxNQUFNLElBQUk7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsS0FBSyxJQUFJO0FBQUc7QUFBQSxRQUNsSyxLQUFLO0FBQVMsV0FBQyxLQUFLLEtBQUssS0FBSyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxNQUFNLFlBQVksS0FBSyxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxLQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsTUFBTSxHQUFHLEVBQUU7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFFBQVEsTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUN0TyxLQUFLO0FBQU8sY0FBSSxDQUFDLEtBQUssU0FBUyxPQUFPLEVBQUUsRUFBRztBQUFRLGVBQUssS0FBSyxNQUFNLE1BQU0sV0FBVyxJQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUc7QUFBQSxRQUN0SSxLQUFLO0FBQVksY0FBSSxDQUFDLEtBQUssU0FBUyxRQUFRLEVBQUUsRUFBRztBQUFRLGVBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxHQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxZQUFZLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUNsSixLQUFLO0FBQVMsZUFBSyxLQUFLLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRyxFQUFFO0FBQUcsZUFBSyxLQUFLLE1BQU0sTUFBTSxXQUFXLEtBQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUN2RyxLQUFLO0FBQVMsY0FBSSxDQUFDLEtBQUssU0FBUyxTQUFTLEVBQUUsRUFBRztBQUFRLGVBQUssS0FBSyxNQUFNLEtBQUssWUFBWSxNQUFNLEdBQUcsSUFBSTtBQUFHO0FBQUEsUUFDeEcsS0FBSztBQUFTLGNBQUksQ0FBQyxLQUFLLFNBQVMsU0FBUyxFQUFFLEVBQUc7QUFBUSxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHO0FBQUc7QUFBQSxRQUNoSCxLQUFLO0FBQVEsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLE1BQU0sR0FBRyxLQUFLLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsS0FBSyxNQUFNLE1BQU0sSUFBSTtBQUFHLGVBQUssS0FBSyxNQUFNLE1BQU0sUUFBUSxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQzlKLEtBQUs7QUFBUyxlQUFLLEtBQUssS0FBSyxLQUFLLFVBQVUsTUFBTSxHQUFHLEtBQUssTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxZQUFZLE1BQU0sTUFBTSxLQUFLLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDbkksS0FBSztBQUFhLGVBQUssS0FBSyxLQUFLLEtBQUssUUFBUSxLQUFLLEdBQUcsSUFBSSxJQUFJO0FBQUcsZUFBSyxLQUFLLEdBQUssTUFBTSxXQUFXLEtBQU0sR0FBRyxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLE1BQU0sR0FBRyxHQUFHO0FBQUc7QUFBQSxRQUMzSixLQUFLO0FBQWEsV0FBQyxLQUFLLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxLQUFLLElBQUksTUFBTSxJQUFJLE1BQU0sR0FBRyxDQUFDO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxZQUFZLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDekssS0FBSztBQUFhLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLEdBQUcsSUFBSSxNQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssTUFBTSxLQUFLLFdBQVcsR0FBRztBQUFHLGVBQUssS0FBSyxLQUFLLEtBQUssVUFBVSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFBRztBQUFBLFFBQzVLLEtBQUs7QUFBVyxXQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLEdBQUc7QUFBRztBQUFBLFFBQ3pJLEtBQUs7QUFBVSxXQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxJQUFJLEtBQUssUUFBUSxLQUFLLEdBQUc7QUFBRztBQUFBLFFBQ3RKLEtBQUs7QUFBVSxXQUFDLE1BQU0sTUFBTSxNQUFNLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNO0FBQUUsaUJBQUssS0FBSyxNQUFNLE1BQU0sWUFBWSxNQUFNLElBQUksS0FBSyxDQUFDO0FBQUcsaUJBQUssS0FBSyxNQUFNLElBQUksSUFBSSxNQUFNLFVBQVUsTUFBTSxHQUFHLFFBQVcsTUFBTyxHQUFHO0FBQUEsVUFBRyxDQUFDO0FBQUcsV0FBQyxLQUFLLE1BQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxLQUFLLE1BQU0sWUFBWSxLQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFFBQVEsTUFBTSxNQUFNLEVBQUU7QUFBRztBQUFBLFFBQ25YLEtBQUs7QUFBYyxlQUFLLEtBQUssSUFBSSxNQUFNLFFBQVEsTUFBTSxHQUFHLEtBQUssR0FBRztBQUFHLGVBQUssS0FBSyxNQUFNLE1BQU0sV0FBVyxLQUFLLEdBQUcsSUFBSTtBQUFHLGVBQUssS0FBSyxLQUFLLEdBQUssWUFBWSxNQUFNLEtBQUssS0FBSyxHQUFHO0FBQUc7QUFBQSxRQUN6SyxLQUFLO0FBQWMsV0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxLQUFLLFlBQVksS0FBSyxJQUFJLElBQUksQ0FBQztBQUFHLGVBQUssS0FBSyxNQUFNLEtBQUssUUFBUSxNQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksS0FBTSxHQUFHO0FBQUc7QUFBQSxRQUM5TCxLQUFLO0FBQVksZUFBSyxLQUFLLE1BQU0sS0FBSyxZQUFZLE1BQU0sR0FBRyxHQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLEtBQUssTUFBTSxFQUFFO0FBQUcsV0FBQyxNQUFNLE1BQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLEtBQUssT0FBTyxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDMU0sS0FBSztBQUFXLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxHQUFJO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxRQUFRLEtBQUssR0FBRyxJQUFJO0FBQUc7QUFBQSxRQUNuRyxLQUFLO0FBQVksZUFBSyxLQUFLLE1BQU0sTUFBTSxZQUFZLElBQUk7QUFBRyxlQUFLLEtBQUssS0FBSyxNQUFNLFFBQVEsTUFBTSxHQUFHLEdBQUc7QUFBRztBQUFBLFFBQ3RHLEtBQUs7QUFBWSxlQUFLLEtBQUssVUFBVTtBQUFHLFdBQUMsS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxNQUFNLFlBQVksTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDO0FBQUc7QUFBQSxRQUM3SCxLQUFLO0FBQVksZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssS0FBSyxLQUFLLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNLEtBQUssS0FBSyxHQUFHLEtBQUssWUFBWSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUcsZUFBSyxLQUFLLEtBQUssS0FBSyxRQUFRLEtBQUssR0FBRyxFQUFFO0FBQUc7QUFBQSxRQUN6SyxLQUFLO0FBQWMsZUFBSyxLQUFLLFVBQVU7QUFBRyxXQUFDLEtBQUssS0FBSyxLQUFLLE1BQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxHQUFHLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxZQUFZLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFBRyxlQUFLLEtBQUssSUFBSSxLQUFLLFFBQVEsTUFBTSxHQUFHLEVBQUU7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksS0FBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRztBQUFHO0FBQUEsUUFDdFEsS0FBSztBQUFlLFdBQUMsS0FBSyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssR0FBRyxNQUFNLFlBQVksTUFBTSxJQUFJLElBQUksQ0FBQztBQUFHO0FBQUEsUUFDbEcsS0FBSztBQUFTLGVBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxNQUFNLEdBQUcsS0FBSyxNQUFNLEdBQUc7QUFBRyxlQUFLLEtBQUssS0FBSyxLQUFLLFlBQVksTUFBTSxNQUFNLEtBQUssTUFBTSxHQUFHO0FBQUcsZUFBSyxLQUFLLEtBQUssTUFBTSxXQUFXLEdBQUc7QUFBRztBQUFBLE1BQzdLO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFTyxNQUFNLFFBQVEsSUFBSSxZQUFZO0FBQ3JDLEVBQUMsT0FBZSxVQUFVO0FBSTFCLE1BQU0sYUFBYSxNQUFNLE1BQU0sT0FBTztBQUN0QyxhQUFXLE1BQU0sQ0FBQyxlQUFlLGFBQWEsWUFBWSxTQUFTLFNBQVMsRUFBRyxVQUFTLGlCQUFpQixJQUFJLFlBQVksRUFBRSxTQUFTLEtBQUssQ0FBQztBQUMxSSxXQUFTLGlCQUFpQixTQUFTLENBQUMsTUFBTTtBQUFFLFVBQU0sS0FBSyxFQUFFO0FBQThCLFFBQUksTUFBTSxHQUFHLFdBQVcsR0FBRyxRQUFRLHdCQUF3QixFQUFHLE9BQU0sS0FBSyxLQUFLO0FBQUEsRUFBRyxHQUFHLElBQUk7QUFDL0ssV0FBUyxpQkFBaUIsb0JBQW9CLE1BQU07QUFBRSxVQUFNLElBQUssTUFBYztBQUE0QixRQUFJLENBQUMsRUFBRztBQUFRLFFBQUksU0FBUyxPQUFRLEdBQUUsUUFBUTtBQUFBLGFBQVksTUFBTSxTQUFTLE1BQU0sSUFBSyxHQUFFLE9BQU87QUFBQSxFQUFHLENBQUM7QUFDN00sU0FBTyxpQkFBaUIsMEJBQTBCLE1BQU0sTUFBTSxPQUFPLENBQUM7OztBQ3RLdEUsTUFBTUMsT0FBTTtBQUNaLE1BQU1DLFdBQVU7QUFTVCxXQUFTLGVBQWUsR0FBMkI7QUFDeEQsV0FBTztBQUFBLE1BQ0wsT0FBTyxLQUFLLE1BQU0sS0FBSyxVQUFVLEVBQUUsS0FBSyxDQUFDO0FBQUEsTUFBRyxLQUFLLEVBQUUsTUFBTSxFQUFFLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxNQUFNLEVBQUU7QUFBQSxNQUN4RixNQUFNLEVBQUU7QUFBQSxNQUFNLFFBQVEsRUFBRTtBQUFBLE1BQVEsS0FBSyxFQUFFO0FBQUEsTUFBSyxNQUFNLEVBQUUsS0FBSyxNQUFNO0FBQUEsTUFBRyxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLEdBQUcsRUFBRSxFQUFFO0FBQUEsTUFBRyxRQUFRLEVBQUU7QUFBQSxNQUFRLGFBQWEsRUFBRTtBQUFBLE1BQzFJLFFBQVE7QUFBQSxNQUFZLEtBQUssRUFBRSxJQUFJLE1BQU0sR0FBRztBQUFBLE1BQUcsT0FBTyxFQUFFLEdBQUcsRUFBRSxNQUFNO0FBQUEsSUFDakU7QUFBQSxFQUNGO0FBRUEsTUFBTSxTQUFTLENBQUMsTUFBd0IsTUFBTSxTQUFTLENBQUM7QUFDeEQsTUFBTSxNQUFNLENBQUMsR0FBUSxJQUFZLE9BQWUsT0FBTyxVQUFVLENBQUMsS0FBSyxLQUFLLE1BQU0sS0FBSztBQUdoRixXQUFTLGlCQUFpQixHQUFzQjtBQWpDdkQ7QUFrQ0UsUUFBSTtBQUNGLFVBQUksQ0FBQyxLQUFLLE9BQU8sTUFBTSxTQUFVLFFBQU87QUFDeEMsWUFBTSxJQUFJLEVBQUU7QUFDWixVQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sUUFBUSxFQUFFLEtBQUssS0FBSyxDQUFDLEVBQUUsTUFBTSxVQUFVLENBQUMsRUFBRSxNQUFNLE1BQU0sQ0FBQyxNQUFXLE9BQU8sU0FBUyxDQUFDLEtBQUssSUFBSSxDQUFDLEVBQUcsUUFBTztBQUN4SCxVQUFJLEVBQUUsVUFBVSxrQkFBa0IsRUFBRSxVQUFVLGtCQUFtQixRQUFPO0FBQ3hFLFVBQUksRUFBRSxTQUFTLFVBQWEsRUFBRSxNQUFNLFFBQVEsRUFBRSxJQUFJLEtBQUssRUFBRSxLQUFLLFVBQVUsRUFBRSxLQUFLLE1BQU0sTUFBTSxHQUFJLFFBQU87QUFDdEcsWUFBTUMsZUFBYSxPQUFFLGVBQUYsWUFBZ0IsRUFBRSxNQUFNO0FBQzNDLFVBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxHQUFHLEtBQUssSUFBSUEsYUFBWSxFQUFFLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsUUFBUSxHQUFHLE1BQU0sS0FBSyxDQUFDLE9BQU8sU0FBUyxFQUFFLEdBQUcsS0FBSyxFQUFFLE9BQU8sRUFBRyxRQUFPO0FBQ3hJLFVBQUksQ0FBQyxNQUFNLFFBQVEsRUFBRSxJQUFJLEtBQUssRUFBRSxLQUFLLFNBQVMsTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLE1BQU0sRUFBRyxRQUFPO0FBQ2xGLFVBQUksQ0FBQyxNQUFNLFFBQVEsRUFBRSxLQUFLLEtBQUssRUFBRSxNQUFNLFNBQVMsV0FBWSxRQUFPO0FBQ25FLFVBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxHQUFHLEdBQUcsS0FBSyxPQUFPLEVBQUUsZ0JBQWdCLFVBQVcsUUFBTztBQUN6RSxZQUFNLFFBQVEsb0JBQUksSUFBWSxHQUFHLE1BQU0sb0JBQUksSUFBWSxHQUFHLFFBQWdCLENBQUM7QUFDM0UsaUJBQVcsS0FBSyxFQUFFLE9BQU87QUFDdkIsWUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLE1BQU0sR0FBRyxRQUFRLEtBQUssQ0FBQyxJQUFJLEVBQUUsTUFBTSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksR0FBRyxFQUFFLE1BQU0sS0FBSyxNQUFNLElBQUksRUFBRSxJQUFJLEtBQUssSUFBSSxJQUFJLEVBQUUsRUFBRSxFQUFHLFFBQU87QUFDbkssY0FBTSxJQUFJLEVBQUUsSUFBSTtBQUFHLFlBQUksSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFNLEtBQUssRUFBRSxJQUFJLEVBQUUsSUFBSSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsTUFBTSxPQUFPLENBQUMsQ0FBQyxFQUFFLE1BQU0sQ0FBQztBQUFBLE1BQ3ZIO0FBQ0EsWUFBTSxLQUFLLEVBQUU7QUFDYixVQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUyxhQUFhLGFBQWEsVUFBVSxVQUFVLEVBQUUsTUFBTSxDQUFDLE1BQU0sT0FBTyxTQUFTLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRyxRQUFPO0FBQ25ILFVBQUksQ0FBQyxFQUFFLE9BQU8sQ0FBQyxPQUFPLFNBQVMsRUFBRSxJQUFJLElBQUksS0FBSyxDQUFDLE9BQU8sU0FBUyxFQUFFLElBQUksR0FBRyxFQUFHLFFBQU87QUFDbEYsYUFBTztBQUFBLFFBQ0wsT0FBTztBQUFBLFFBQVksS0FBSyxRQUFRLEVBQUUsSUFBSSxNQUFNLEVBQUUsSUFBSSxHQUFHO0FBQUEsUUFBRyxNQUFNLEVBQUU7QUFBQSxRQUFNLFFBQVEsRUFBRTtBQUFBLFFBQVEsS0FBSyxFQUFFO0FBQUEsUUFBSyxNQUFNLEVBQUUsS0FBSyxNQUFNO0FBQUEsUUFBRztBQUFBLFFBQU8sUUFBUSxFQUFFO0FBQUEsUUFDM0ksYUFBYSxFQUFFO0FBQUEsUUFBYSxRQUFRO0FBQUEsUUFBWSxLQUFLLE1BQU0sUUFBUSxFQUFFLEdBQUcsSUFBSSxFQUFFLElBQUksT0FBTyxDQUFDLE1BQVcsT0FBTyxNQUFNLFFBQVEsRUFBRSxNQUFNLEdBQUcsSUFBSSxDQUFDO0FBQUEsUUFDMUksT0FBTyxFQUFFLE9BQU8sR0FBRyxPQUFPLFdBQVcsR0FBRyxXQUFXLFdBQVcsR0FBRyxXQUFXLFFBQVEsR0FBRyxRQUFRLFVBQVUsR0FBRyxTQUFTO0FBQUEsTUFDdkg7QUFBQSxJQUNGLFFBQVE7QUFBRSxhQUFPO0FBQUEsSUFBTTtBQUFBLEVBQ3pCO0FBRU8sV0FBUyxRQUFRLE1BQW1CLFFBQXNCLGFBQWEsR0FBUztBQUNyRixRQUFJO0FBQUUsVUFBSSxNQUFPLE9BQU0sUUFBUUYsTUFBSyxLQUFLLFVBQVUsSUFBSSxDQUFDO0FBQUEsSUFBRyxRQUFRO0FBQUEsSUFBd0U7QUFBQSxFQUM3STtBQUNPLFdBQVMsU0FBUyxRQUFzQixhQUFhLEdBQVM7QUFDbkUsUUFBSTtBQUFFLFVBQUksU0FBVSxNQUFjLFdBQVksQ0FBQyxNQUFjLFdBQVdBLElBQUc7QUFBQSxlQUFZLE1BQU8sT0FBTSxRQUFRQSxNQUFLLEVBQUU7QUFBQSxJQUFHLFFBQVE7QUFBQSxJQUFlO0FBQUEsRUFDL0k7QUFDTyxXQUFTLFFBQVEsUUFBc0IsYUFBYSxHQUErQztBQUN4RyxRQUFJO0FBQ0YsWUFBTSxJQUFJLFNBQVMsTUFBTSxRQUFRQSxJQUFHO0FBQUcsVUFBSSxDQUFDLEVBQUcsUUFBTztBQUN0RCxZQUFNLElBQUksS0FBSyxNQUFNLENBQUM7QUFDdEIsVUFBSSxDQUFDLEtBQUssRUFBRSxNQUFNQyxZQUFZLEVBQUUsVUFBVSxXQUFXLEVBQUUsVUFBVSxXQUFZLENBQUMsT0FBTyxTQUFTLEVBQUUsSUFBSSxLQUFLLENBQUMsT0FBTyxTQUFTLEVBQUUsT0FBTyxLQUFLLE9BQU8sRUFBRSxlQUFlLFNBQVUsUUFBTztBQUNqTCxZQUFNLFFBQVEsaUJBQWlCLEVBQUUsS0FBSztBQUFHLFVBQUksQ0FBQyxNQUFPLFFBQU87QUFDNUQsWUFBTSxRQUFRLEVBQUUsVUFBVSxXQUFXLE1BQU0sUUFBUSxFQUFFLEtBQUssS0FBSyxFQUFFLE1BQU0sV0FBVyxLQUFLLEVBQUUsTUFBTSxNQUFNLE1BQU0sSUFBSSxFQUFFLFFBQVE7QUFDekgsYUFBTyxFQUFFLE1BQU0sRUFBRSxHQUFHQSxVQUFTLE1BQU0sRUFBRSxNQUFNLFNBQVMsRUFBRSxTQUFTLE9BQU8sT0FBTyxFQUFFLFVBQVUsV0FBVyxFQUFFLFFBQVEsU0FBUyxZQUFZLEVBQUUsWUFBWSxPQUFPLFFBQVEsVUFBVSxTQUFTLE9BQU8sT0FBTyxFQUFFLE9BQU8sV0FBVyxPQUFPLFVBQVUsRUFBRSxTQUFTLEtBQUssRUFBRSxhQUFhLEtBQUssRUFBRSxhQUFhLE9BQU8sRUFBRSxZQUFZLE9BQVUsR0FBRyxNQUFNO0FBQUEsSUFDblUsUUFBUTtBQUFFLGFBQU87QUFBQSxJQUFNO0FBQUEsRUFDekI7OztBQy9DQSxNQUFNLE9BQW1CLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxNQUFNLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxHQUFHLENBQUM7QUFDekUsTUFBTSxPQUFPO0FBQUEsSUFDWCxFQUFFLE1BQU0sSUFBSSxLQUFLLE1BQU0sS0FBSyxNQUFNLElBQUksQ0FBQyxNQUFNLE1BQU0sR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLE1BQU0sTUFBTSxLQUFLLEdBQUcsRUFBRTtBQUFBLElBQ3ZGLEVBQUUsTUFBTSxJQUFJLEtBQUssTUFBTSxLQUFLLEtBQU0sSUFBSSxDQUFDLE1BQU0sTUFBTSxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFDcEYsRUFBRSxNQUFNLElBQUksS0FBSyxLQUFNLEtBQUssTUFBTSxJQUFJLENBQUMsR0FBRyxNQUFNLEtBQUssSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxFQUNyRjtBQVFBLE1BQU0sUUFBUSxvQkFBSSxJQUFJLENBQUMsUUFBUSxTQUFTLFNBQVMsV0FBVyxVQUFVLFNBQVMsUUFBUSxnQkFBZ0IsVUFBVSxjQUFjLE1BQU0sQ0FBQztBQUt0SSxXQUFTLElBQUksT0FBWSxHQUFXLEdBQVdFLE9BQTZDLFFBQVEsTUFBTTtBQUN4RyxVQUFNLElBQUksSUFBSSxRQUFRLGVBQWUsTUFBTSxFQUFFLE9BQU8sR0FBRyxRQUFRLEVBQUUsR0FBRyxPQUFPLElBQUk7QUFBRyxJQUFBQSxNQUFLLEVBQUUsV0FBVyxDQUFDO0FBQUcsTUFBRSxPQUFPO0FBQUcsTUFBRSxXQUFXO0FBQU8sV0FBTztBQUFBLEVBQ2pKO0FBRUEsaUJBQXNCLFdBQVcsT0FBNkI7QUFDNUQsVUFBTSxPQUFPLElBQUksT0FBTyxJQUFJLElBQUksQ0FBQyxNQUFNO0FBQUUsWUFBTUMsS0FBSSxFQUFFLHFCQUFxQixJQUFJLElBQUksR0FBRyxJQUFJLElBQUksRUFBRTtBQUFHLE1BQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUFHLE1BQUFBLEdBQUUsYUFBYSxLQUFLLHVCQUF1QjtBQUFHLE1BQUFBLEdBQUUsYUFBYSxHQUFHLHFCQUFxQjtBQUFHLFFBQUUsWUFBWUE7QUFBRyxRQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksRUFBRTtBQUFBLElBQUcsQ0FBQztBQUNoUixVQUFNLFVBQVUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNLElBQUksT0FBTyxLQUFLLElBQUksQ0FBQyxNQUFNO0FBQUUsUUFBRSxPQUFPO0FBQXdCLFFBQUUsWUFBWTtBQUFVLFFBQUUsWUFBWTtBQUFHLFFBQUUsY0FBYztBQUFXLFFBQUUsWUFBWSxNQUFNLElBQUksWUFBWSxNQUFNLElBQUksWUFBWTtBQUFXLFlBQU0sSUFBSSxTQUFJLE9BQU8sQ0FBQztBQUFHLFFBQUUsV0FBVyxHQUFHLElBQUksRUFBRTtBQUFHLFFBQUUsU0FBUyxHQUFHLElBQUksRUFBRTtBQUFBLElBQUcsQ0FBQyxDQUFDO0FBQ3ZULFVBQU0sV0FBVyxDQUFDLEdBQVdBLElBQVcsR0FBVyxJQUFJLE1BQU07QUFBRSxZQUFNLElBQUksSUFBSSxRQUFRLGlCQUFpQixNQUFNLEtBQUs7QUFBRyxRQUFFLGVBQWUsUUFBUSxPQUFPLE1BQU07QUFBRyxRQUFFLGdCQUFnQixJQUFJLFFBQVEsT0FBTyxHQUFHQSxJQUFHLENBQUM7QUFBRyxRQUFFLGtCQUFrQjtBQUFNLFFBQUUsUUFBUTtBQUFHLGFBQU87QUFBQSxJQUFHO0FBQzdQLFVBQU0sSUFBWTtBQUFBLE1BQ2hCO0FBQUEsTUFBTztBQUFBLE1BQU0sT0FBTyxDQUFDO0FBQUEsTUFBRztBQUFBLE1BQVMsT0FBTyxDQUFDO0FBQUEsTUFBRyxPQUFPLENBQUM7QUFBQSxNQUFHLFNBQVMsQ0FBQyxTQUFTLE1BQU0sS0FBSyxNQUFNLEdBQUcsR0FBRyxTQUFTLE1BQU0sTUFBTSxLQUFLLEdBQUcsQ0FBQztBQUFBLE1BQUcsU0FBUyxTQUFTLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxNQUN0SyxPQUFPLFNBQVMsTUFBTSxNQUFNLE1BQU0sR0FBRztBQUFBLE1BQUcsU0FBUyxDQUFDLFNBQVMsTUFBTSxNQUFNLENBQUMsR0FBRyxTQUFTLEdBQUcsS0FBSyxHQUFHLENBQUM7QUFBQSxNQUFHLFVBQVUsU0FBUyxNQUFNLE1BQU0sQ0FBQztBQUFBLElBQ3JJO0FBRUEsVUFBTSxNQUFNLElBQUksT0FBTyxLQUFLLEtBQUssQ0FBQyxNQUFNO0FBQUUsUUFBRSxZQUFZO0FBQVUsUUFBRSxZQUFZO0FBQUcsUUFBRSxjQUFjO0FBQVcsUUFBRSxZQUFZO0FBQVcsUUFBRSxXQUFXO0FBQ2xKLGlCQUFXLENBQUMsSUFBSSxNQUFNLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLElBQUksSUFBSSxHQUFHLEdBQUcsQ0FBQyxLQUFLLElBQUksSUFBSSxFQUFFLEdBQUcsQ0FBQyxLQUFLLElBQUksS0FBSyxFQUFFLENBQUMsR0FBeUM7QUFBRSxVQUFFLE9BQU8sZ0JBQWdCLE9BQU87QUFBaUIsVUFBRSxXQUFXLElBQUksR0FBRyxDQUFDO0FBQUcsVUFBRSxTQUFTLElBQUksR0FBRyxDQUFDO0FBQUEsTUFBRztBQUFBLElBQUUsQ0FBQztBQUN4TyxVQUFNLEtBQUssSUFBSSxRQUFRLGlCQUFpQixPQUFPLEtBQUs7QUFBRyxPQUFHLGlCQUFpQjtBQUFLLE9BQUcsNkJBQTZCO0FBQU0sT0FBRyxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxPQUFHLGtCQUFrQjtBQUFNLE9BQUcsa0JBQWtCO0FBQU8sTUFBRSxNQUFNLEtBQUssSUFBSTtBQUN6TyxVQUFNLE9BQU8sQ0FBQyxNQUFjRCxVQUFnRDtBQUFFLFlBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLE1BQU0sS0FBSztBQUFHLFFBQUUsaUJBQWlCLElBQUksT0FBTyxLQUFLLEtBQUtBLEtBQUk7QUFBRyxRQUFFLDZCQUE2QjtBQUFNLFFBQUUsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQUcsUUFBRSxrQkFBa0I7QUFBTSxRQUFFLGtCQUFrQjtBQUFPLFFBQUUsTUFBTSxJQUFJLElBQUk7QUFBQSxJQUFHO0FBQ3pVLFVBQU0sUUFBUSxDQUFDLElBQVksU0FBaUIsQ0FBQyxNQUFnQztBQUFFLFFBQUUsWUFBWTtBQUFVLFFBQUUsWUFBWTtBQUFJLFFBQUUsY0FBYztBQUFXLFFBQUUsV0FBVztBQUFTLFFBQUUsWUFBWTtBQUFNLFFBQUUsT0FBTztBQUF3QixRQUFFLFdBQVcsSUFBSSxJQUFJLEdBQUc7QUFBRyxRQUFFLFNBQVMsSUFBSSxJQUFJLEdBQUc7QUFBQSxJQUFHO0FBQ25SLFNBQUssS0FBSyxNQUFNLEtBQUssU0FBUyxDQUFDO0FBQUcsU0FBSyxLQUFLLE1BQU0sS0FBSyxTQUFTLENBQUM7QUFDakUsU0FBSyxTQUFTLENBQUMsTUFBTTtBQUFFLFFBQUUsWUFBWTtBQUFHLFFBQUUsY0FBYztBQUFXLFFBQUUsWUFBWTtBQUFXLFFBQUUsVUFBVTtBQUFHLFFBQUUsT0FBTyxJQUFJLEVBQUU7QUFBRyxRQUFFLGNBQWMsS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLEdBQUc7QUFBRyxRQUFFLGNBQWMsSUFBSSxLQUFLLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBRyxRQUFFLFVBQVU7QUFBRyxRQUFFLE9BQU87QUFBRyxRQUFFLEtBQUs7QUFBQSxJQUFHLENBQUM7QUFDMVAsU0FBSyxXQUFXLENBQUMsTUFBTTtBQUFFLFFBQUUsWUFBWTtBQUFHLFFBQUUsY0FBYztBQUFXLFFBQUUsWUFBWTtBQUFXLFlBQU0sT0FBTyxDQUFDLEdBQVcsR0FBVyxNQUFjO0FBQUUsVUFBRSxVQUFVO0FBQUcsaUJBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQUUsZ0JBQU0sSUFBSSxJQUFJLEtBQUssS0FBSyxHQUFHLEtBQUssSUFBSSxJQUFJLElBQUksT0FBTztBQUFHLFlBQUUsT0FBTyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksSUFBSSxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksRUFBRTtBQUFBLFFBQUc7QUFBRSxVQUFFLFVBQVU7QUFBRyxVQUFFLE9BQU87QUFBRyxVQUFFLEtBQUs7QUFBQSxNQUFHO0FBQUcsV0FBSyxJQUFJLElBQUksRUFBRTtBQUFHLFdBQUssS0FBSyxJQUFJLEVBQUU7QUFBRyxXQUFLLElBQUksSUFBSSxFQUFFO0FBQUEsSUFBRyxDQUFDO0FBQzdZLFVBQU0sT0FBaUY7QUFBQSxNQUNyRixDQUFDLFdBQVcsdUJBQXVCLDZCQUE2QixFQUFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU8sU0FBUyxPQUFPLFNBQVMsT0FBTyxRQUFRLEdBQUcsTUFBTSxHQUFLLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sVUFBVSxPQUFPLFFBQVEsR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sVUFBVSxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sY0FBYyxPQUFPLElBQUksQ0FBQyxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsR0FBRyxRQUFRLENBQUMsRUFBRSxNQUFNLFNBQVMsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFFBQVEsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFFBQVEsT0FBTyxJQUFJLENBQUMsR0FBRyxNQUFNLDJCQUEyQixDQUFDO0FBQUEsTUFDOWlCLENBQUMsVUFBVSxzQkFBc0IsNEJBQTRCLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFNBQVMsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLE9BQU8sR0FBRyxNQUFNLEdBQUssRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFlBQVksR0FBRyxFQUFFLE1BQU0sWUFBWSxPQUFPLFVBQVUsQ0FBQyxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsR0FBRyxRQUFRLENBQUMsRUFBRSxNQUFNLFFBQVEsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLGdCQUFnQixPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sWUFBWSxPQUFPLFVBQVUsQ0FBQyxHQUFHLE1BQU0sMEJBQTBCLENBQUM7QUFBQSxNQUNoZ0IsQ0FBQyxVQUFVLGNBQWMsb0JBQW9CLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFVBQVUsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLFFBQVEsR0FBRyxHQUFLLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxVQUFVLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxXQUFXLE9BQU8sVUFBVSxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxHQUFHLFFBQVEsQ0FBQyxFQUFFLE1BQU0sU0FBUyxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sV0FBVyxPQUFPLFVBQVUsR0FBRyxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsQ0FBQyxHQUFHLE1BQU0sa0JBQWtCLENBQUM7QUFBQSxNQUM1ZCxDQUFDLFVBQVUsY0FBYyxvQkFBb0IsRUFBRSxNQUFNLFFBQVEsS0FBSyxPQUFPLFFBQVEsVUFBVSxPQUFPLFNBQVMsT0FBTyxTQUFTLE9BQU8sT0FBTyxHQUFHLEdBQUssTUFBTSxFQUFFLFFBQVEsRUFBRSxPQUFPLENBQUMsRUFBRSxNQUFNLFVBQVUsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFNBQVMsT0FBTyxJQUFJLEdBQUcsRUFBRSxNQUFNLFVBQVUsT0FBTyxVQUFVLEdBQUcsRUFBRSxNQUFNLFFBQVEsT0FBTyxVQUFVLENBQUMsR0FBRyxLQUFLLEdBQUcsS0FBSyxHQUFHLEdBQUcsUUFBUSxDQUFDLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxVQUFVLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxTQUFTLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sVUFBVSxDQUFDLEdBQUcsTUFBTSxrQkFBa0IsQ0FBQztBQUFBLE1BQzlmLENBQUMsYUFBYSxpQkFBaUIsdUJBQXVCLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFVBQVUsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLFFBQVEsR0FBRyxHQUFLLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxRQUFRLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxZQUFZLEdBQUcsRUFBRSxNQUFNLFNBQVMsT0FBTyxJQUFJLENBQUMsR0FBRyxLQUFLLEdBQUcsS0FBSyxHQUFHLEdBQUcsUUFBUSxDQUFDLEVBQUUsTUFBTSxTQUFTLE9BQU8sVUFBVSxHQUFHLEVBQUUsTUFBTSxRQUFRLE9BQU8sSUFBSSxHQUFHLEVBQUUsTUFBTSxZQUFZLENBQUMsR0FBRyxNQUFNLHFCQUFxQixDQUFDO0FBQUEsTUFDN1osQ0FBQyxRQUFRLFlBQVksa0JBQWtCLEVBQUUsTUFBTSxRQUFRLEtBQUssT0FBTyxRQUFRLFVBQVUsT0FBTyxTQUFTLE9BQU8sU0FBUyxPQUFPLFFBQVEsR0FBRyxNQUFNLE1BQU0sRUFBRSxXQUFXLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRyxRQUFRLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxRQUFRLE9BQU8sTUFBTSxHQUFHLEVBQUUsTUFBTSxVQUFVLEdBQUcsRUFBRSxNQUFNLFNBQVMsT0FBTyxJQUFJLEdBQUcsRUFBRSxNQUFNLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsR0FBRyxRQUFRLENBQUMsRUFBRSxNQUFNLFFBQVEsR0FBRyxFQUFFLE1BQU0sU0FBUyxPQUFPLElBQUksR0FBRyxFQUFFLE1BQU0sU0FBUyxPQUFPLElBQUksQ0FBQyxHQUFHLFlBQVksT0FBTyxNQUFNLGdCQUFnQixDQUFDO0FBQUEsSUFDcGM7QUFDQSxVQUFNLFNBQVMsUUFBUSxZQUFZLHdCQUF3QixXQUFXLG1CQUFtQixLQUFLLEVBQUUsS0FBSyxDQUFDLE1BQVc7QUFBRSxRQUFFLFFBQVE7QUFBQSxJQUFHLENBQUMsRUFBRSxNQUFNLE1BQU07QUFBQSxJQUFpQyxDQUFDO0FBQ2pMLFVBQU0sU0FBUyxRQUFRLFlBQVksd0JBQXdCLFdBQVcsYUFBYSxLQUFLLEVBQUUsS0FBSyxDQUFDLE1BQVc7QUFBRSxRQUFFLFFBQVE7QUFBQSxJQUFHLENBQUMsRUFBRSxNQUFNLE1BQU07QUFBQSxJQUFxQyxDQUFDO0FBQy9LLFVBQU0sUUFBUSxJQUFJLENBQUMsUUFBUSxRQUFRLEdBQUcsS0FBSyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssT0FBTyxPQUFPLEtBQUssT0FBTyxLQUFLLE1BQU07QUFDckcsWUFBTSxZQUFZLE1BQU0sUUFBUSxZQUFZLHdCQUF3QixXQUFXLEtBQUssS0FBSztBQUN6RixRQUFFLE1BQU0sSUFBSSxJQUFJLEVBQUUsV0FBVyxVQUFVLElBQUksUUFBUSxRQUFRLFlBQVksT0FBTyxPQUFPLE9BQU8sS0FBSyxHQUFHLE9BQU8sVUFBVSxDQUFDLEdBQUcsS0FBSyxPQUFPLEdBQUksU0FBUyxDQUFDLEdBQUksUUFBUSxTQUFTLE1BQU0sT0FBTyxJQUFJLFFBQVEsUUFBUSxZQUFZLE1BQU0sTUFBTSxPQUFPLE9BQU8sS0FBSyxJQUFJLE9BQVU7QUFBQSxJQUNwUSxDQUFDLENBQUMsQ0FBQztBQUNILFdBQU87QUFBQSxFQUNUO0FBR0EsTUFBTSxPQUFOLE1BQVc7QUFBQSxJQUVULFlBQW9CLEdBQW1CLFFBQXFCLEtBQXFCLFFBQWdCO0FBQTdFO0FBQW1CO0FBQXFCO0FBQXFCO0FBRGpGLDBCQUFRLE1BQVU7QUFBTSwwQkFBUSxRQUFZO0FBQU0sMEJBQVE7QUFBWSwwQkFBUTtBQUFZLDBCQUFRO0FBQVcsMEJBQVE7QUFBVSwwQkFBUTtBQUFVLDBCQUFRO0FBQVksMEJBQVE7QUFlN0ssMEJBQVE7QUFBUywwQkFBUSxPQUFNO0FBQUcsMEJBQVEsU0FBUTtBQUFPLDBCQUFRLE9BQVc7QUFiMUUsWUFBTSxJQUFJLEVBQUU7QUFDWixXQUFLLE9BQU8sUUFBUSxZQUFZLFdBQVcsUUFBUSxFQUFFLFFBQVEsS0FBSyxJQUFJLEtBQUssU0FBUyxJQUFJLEdBQUcsY0FBYyxHQUFHLEdBQUcsQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQUcsV0FBSyxLQUFLLFNBQVMsSUFBSTtBQUFNLFdBQUssS0FBSyxTQUFTO0FBQVEsV0FBSyxLQUFLLGFBQWE7QUFDdE8sV0FBSyxRQUFRLElBQUksUUFBUSxjQUFjLFNBQVMsQ0FBQztBQUFHLFdBQUssTUFBTSxTQUFTO0FBQVEsV0FBSyxNQUFNLFNBQVMsSUFBSSxNQUFNO0FBQU0sV0FBSyxNQUFNLGdCQUFnQixRQUFRLEtBQUs7QUFDNUosV0FBSyxRQUFRLFFBQVEsWUFBWSxZQUFZLFNBQVMsRUFBRSxPQUFPLEtBQUssUUFBUSxLQUFLLEdBQUcsQ0FBQztBQUFHLFdBQUssTUFBTSxTQUFTLEtBQUs7QUFBTyxXQUFLLE1BQU0sU0FBUyxJQUFJO0FBQU0sV0FBSyxNQUFNLGFBQWE7QUFDOUssWUFBTSxLQUFLLElBQUksUUFBUSxpQkFBaUIsTUFBTSxDQUFDO0FBQUcsU0FBRyxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxTQUFHLGtCQUFrQjtBQUFNLFNBQUcsNkJBQTZCO0FBQU0sV0FBSyxNQUFNLFdBQVc7QUFBSSxNQUFDLEtBQUssTUFBYyxNQUFNO0FBQ2xOLFlBQU0sS0FBSyxRQUFRLFlBQVksWUFBWSxNQUFNLEVBQUUsT0FBTyxLQUFLLFFBQVEsTUFBTSxHQUFHLENBQUM7QUFBRyxTQUFHLFNBQVMsS0FBSztBQUFPLFNBQUcsV0FBVyxFQUFFO0FBQU8sU0FBRyxhQUFhO0FBQU8sV0FBSyxNQUFNO0FBQ3JLLFdBQUssT0FBTyxRQUFRLFlBQVksWUFBWSxRQUFRLEVBQUUsT0FBTyxNQUFNLFFBQVEsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxLQUFLO0FBQU8sV0FBSyxLQUFLLFNBQVMsSUFBSTtBQUFRLFdBQUssS0FBSyxhQUFhO0FBQzVLLFdBQUssTUFBTSxRQUFRLFlBQVksWUFBWSxPQUFPLEVBQUUsT0FBTyxLQUFLLFFBQVEsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFLLElBQUksU0FBUyxLQUFLO0FBQU8sV0FBSyxJQUFJLFNBQVMsSUFBSTtBQUFPLFdBQUssSUFBSSxXQUFXLEVBQUU7QUFBTyxXQUFLLElBQUksYUFBYTtBQUNsTSxXQUFLLFFBQVEsUUFBUSxZQUFZLFlBQVksU0FBUyxFQUFFLE9BQU8sTUFBTSxRQUFRLEtBQUssR0FBRyxDQUFDO0FBQUcsV0FBSyxNQUFNLFNBQVMsS0FBSztBQUFPLFdBQUssTUFBTSxTQUFTLElBQUksR0FBRyxPQUFPLEtBQU07QUFBRyxXQUFLLE1BQU0sV0FBVyxFQUFFO0FBQVUsV0FBSyxNQUFNLGFBQWE7QUFDOU4sV0FBSyxLQUFLLFFBQVEsWUFBWSxZQUFZLE1BQU0sRUFBRSxPQUFPLE1BQU0sUUFBUSxNQUFNLEdBQUcsQ0FBQztBQUFHLFdBQUssR0FBRyxTQUFTLEtBQUs7QUFBTyxXQUFLLEdBQUcsU0FBUyxJQUFJLE9BQU8sR0FBSyxDQUFDO0FBQUcsV0FBSyxHQUFHLGFBQWE7QUFBTyxXQUFLLEdBQUcsV0FBVyxLQUFLO0FBQzFNLFlBQU0sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLE9BQU8sQ0FBQztBQUFHLFNBQUcsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQUcsU0FBRyxrQkFBa0I7QUFBTSxTQUFHLDZCQUE2QjtBQUFNLFdBQUssR0FBRyxXQUFXO0FBQ2xMLFdBQUssSUFBSSxXQUFXLEtBQUs7QUFBRyxXQUFLLEtBQUssV0FBVyxLQUFLO0FBQUcsV0FBSyxJQUFJLFdBQVcsS0FBSztBQUFHLFdBQUssTUFBTSxXQUFXLEtBQUs7QUFBQSxJQUNsSDtBQUFBO0FBQUEsSUFHQSxRQUFRLElBQWE7QUFDbkIsVUFBSSxDQUFDLElBQUk7QUFBRSxZQUFJLEtBQUssSUFBSyxNQUFLLElBQUksV0FBVyxLQUFLO0FBQUc7QUFBQSxNQUFRO0FBQzdELFVBQUksQ0FBQyxLQUFLLEtBQUs7QUFDYixjQUFNLElBQUksS0FBSyxHQUFHLElBQUksUUFBUSxZQUFZLFlBQVksV0FBVyxFQUFFLE9BQU8sS0FBSyxRQUFRLEtBQUssR0FBRyxFQUFFLEtBQUs7QUFBRyxVQUFFLFNBQVMsS0FBSztBQUFPLFVBQUUsU0FBUyxJQUFJLEdBQUcsTUFBTSxDQUFDO0FBQUcsVUFBRSxhQUFhO0FBQzNLLGNBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLFlBQVksRUFBRSxLQUFLO0FBQUcsVUFBRSxnQkFBZ0IsUUFBUSxPQUFPLE1BQU07QUFBRyxVQUFFLGtCQUFrQjtBQUFNLFVBQUUsNkJBQTZCO0FBQ2hLLFVBQUUsaUJBQWlCLElBQUksRUFBRSxPQUFPLEtBQUssSUFBSSxDQUFDLE1BQU07QUFBRSxZQUFFLE9BQU87QUFBdUIsWUFBRSxZQUFZO0FBQVUsWUFBRSxZQUFZO0FBQUcsWUFBRSxjQUFjO0FBQVcsWUFBRSxZQUFZO0FBQVcsWUFBRSxXQUFXO0FBQVMsWUFBRSxXQUFXLFFBQVEsSUFBSSxFQUFFO0FBQUcsWUFBRSxTQUFTLFFBQVEsSUFBSSxFQUFFO0FBQUEsUUFBRyxDQUFDO0FBQ2hRLFVBQUUsV0FBVztBQUFHLGFBQUssTUFBTTtBQUFBLE1BQzdCO0FBQ0EsV0FBSyxJQUFJLFdBQVcsSUFBSTtBQUFBLElBQzFCO0FBQUE7QUFBQSxJQUVBLFNBQVMsR0FBVztBQUNsQixXQUFLLE1BQU07QUFBRyxVQUFJLENBQUMsS0FBSyxHQUFJO0FBQVEsVUFBSSxLQUFLLEtBQUssQ0FBQyxLQUFLLE9BQU87QUFBRSxhQUFLLEdBQUcsV0FBVyxLQUFLO0FBQUcsWUFBSSxJQUFJLEVBQUcsTUFBSyxTQUFTLENBQUM7QUFBRztBQUFBLE1BQVE7QUFDakksV0FBSyxTQUFTLENBQUM7QUFBRyxXQUFLLEdBQUcsV0FBVyxJQUFJO0FBQUEsSUFDM0M7QUFBQSxJQUNRLFNBQVMsR0FBVztBQUMxQixZQUFNLElBQUksS0FBSztBQUFHLFVBQUksQ0FBQyxFQUFFLE1BQU0sQ0FBQyxFQUFHLEdBQUUsTUFBTSxDQUFDLElBQUksSUFBSSxFQUFFLE9BQU8sS0FBSyxJQUFJLENBQUMsTUFBTTtBQUFFLFVBQUUsT0FBTztBQUF3QixVQUFFLFlBQVk7QUFBVSxVQUFFLFlBQVk7QUFBRyxVQUFFLGNBQWM7QUFBVyxVQUFFLFlBQVk7QUFBVyxVQUFFLFdBQVc7QUFBUyxVQUFFLFdBQVcsUUFBUSxHQUFHLElBQUksRUFBRTtBQUFHLFVBQUUsU0FBUyxRQUFRLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFBRyxDQUFDO0FBQ3BTLE1BQUMsS0FBSyxHQUFHLFNBQWlCLGlCQUFpQixFQUFFLE1BQU0sQ0FBQztBQUFBLElBQ3REO0FBQUE7QUFBQSxJQUVBLElBQUksR0FBVztBQUFFLFdBQUssTUFBTSxRQUFRLE9BQU8sSUFBSSxDQUFDO0FBQUcsV0FBSyxNQUFNLFNBQVMsSUFBSSxLQUFLLE1BQU0sTUFBTTtBQUFHLFVBQUksS0FBSyxLQUFNLE1BQUssS0FBSyxTQUFTLElBQUksS0FBSyxNQUFNO0FBQUEsSUFBTTtBQUFBLElBQ3RKLElBQUksTUFBYSxNQUFjO0FBQzdCLFlBQU0sSUFBSSxLQUFLLEVBQUUsT0FBTyxNQUFNLEtBQUssT0FBTyxDQUFDO0FBQzNDLE1BQUMsS0FBSyxNQUFjLElBQUksaUJBQWlCLEtBQUssRUFBRSxRQUFRLE9BQU8sQ0FBQztBQUNoRSxXQUFLLEtBQUssV0FBVyxLQUFLLEVBQUUsUUFBUSxJQUFJO0FBQUcsV0FBSyxLQUFLLFdBQVcsS0FBSyxFQUFFLFFBQVEsSUFBSTtBQUNuRixVQUFJLFNBQVMsR0FBRztBQUNkLFlBQUksQ0FBQyxLQUFLLElBQUk7QUFDWixnQkFBTSxLQUFLLElBQUksUUFBUSxlQUFlLFFBQVEsSUFBSSxDQUFDO0FBQUcsYUFBRyxrQkFBa0IsS0FBSyxFQUFFO0FBQU0sYUFBRyxVQUFVLEtBQUs7QUFBUSxhQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBRyxhQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsS0FBSyxLQUFLLE1BQU0sS0FBSyxHQUFHO0FBQ2xPLGFBQUcsY0FBYztBQUFLLGFBQUcsY0FBYztBQUFLLGFBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxPQUFPLEtBQUssS0FBSztBQUFHLGFBQUcsYUFBYSxJQUFJLFFBQVEsUUFBUSxNQUFNLEtBQUssSUFBSTtBQUN2SixhQUFHLGVBQWU7QUFBTSxhQUFHLGVBQWU7QUFBSyxhQUFHLFVBQVUsSUFBSSxRQUFRLFFBQVEsR0FBRyxLQUFLLENBQUM7QUFBRyxhQUFHLFlBQVksUUFBUSxlQUFlO0FBQWUsZUFBSyxLQUFLO0FBQUEsUUFDN0o7QUFDQSxjQUFNLElBQUksS0FBSztBQUFJLFVBQUUsV0FBVyxJQUFJO0FBQU0sVUFBRSxVQUFVLElBQUk7QUFBSyxVQUFFLFVBQVUsSUFBSTtBQUFLLFVBQUUsU0FBUyxJQUFJLFFBQVEsT0FBTyxHQUFHLElBQUksRUFBRTtBQUFHLFVBQUUsU0FBUyxJQUFJLFFBQVEsT0FBTyxHQUFHLElBQUksRUFBRTtBQUFHLFVBQUUsWUFBWSxJQUFJLFFBQVEsT0FBTyxLQUFLLEdBQUcsS0FBSyxDQUFDO0FBQ3ZOLFlBQUksQ0FBQyxFQUFFLFVBQVUsRUFBRyxHQUFFLE1BQU07QUFBQSxNQUM5QixXQUFXLEtBQUssTUFBTSxLQUFLLEdBQUcsVUFBVSxFQUFHLE1BQUssR0FBRyxLQUFLO0FBQ3hELFVBQUksUUFBUSxHQUFHO0FBQ2IsWUFBSSxDQUFDLEtBQUssTUFBTTtBQUFFLGVBQUssT0FBTyxRQUFRLFlBQVksWUFBWSxRQUFRLEVBQUUsVUFBVSxNQUFNLFdBQVcsTUFBTSxjQUFjLEdBQUcsR0FBRyxDQUFDO0FBQUcsZUFBSyxLQUFLLFNBQVMsS0FBSztBQUFRLGVBQUssS0FBSyxTQUFTLElBQUksS0FBSyxNQUFNO0FBQU0sZUFBSyxLQUFLLFdBQVcsS0FBSyxFQUFFO0FBQVMsZUFBSyxLQUFLLGFBQWE7QUFBQSxRQUFPO0FBQzVRLGFBQUssS0FBSyxXQUFXLElBQUk7QUFBQSxNQUMzQixXQUFXLEtBQUssS0FBTSxNQUFLLEtBQUssV0FBVyxLQUFLO0FBQUEsSUFDbEQ7QUFBQSxJQUNBLE1BQU0sR0FBa0I7QUFDdEIsWUFBTSxLQUFLLE1BQU07QUFBTSxXQUFLLElBQUksV0FBVyxFQUFFO0FBQUcsV0FBSyxLQUFLLFdBQVcsRUFBRTtBQUFHLFdBQUssUUFBUTtBQUFJLFVBQUksS0FBSyxHQUFJLE1BQUssR0FBRyxXQUFXLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFDN0ksVUFBSSxJQUFJO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSSxNQUFPLENBQVc7QUFBRyxhQUFLLEtBQUssUUFBUSxJQUFJO0FBQUcsYUFBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLFFBQVEsSUFBSSxNQUFNO0FBQUEsTUFBRztBQUFBLElBQzNIO0FBQUEsSUFDQSxRQUFRLEdBQWtCO0FBQ3hCLFlBQU0sS0FBSyxNQUFNO0FBQU0sV0FBSyxJQUFJLFdBQVcsRUFBRTtBQUFHLFdBQUssTUFBTSxXQUFXLEVBQUU7QUFDeEUsVUFBSSxJQUFJO0FBQUUsY0FBTSxJQUFJLEtBQUssSUFBSSxNQUFPLENBQVc7QUFBRyxhQUFLLE1BQU0sUUFBUSxJQUFJO0FBQUcsYUFBSyxNQUFNLFNBQVMsSUFBSSxFQUFFLFFBQVEsSUFBSSxNQUFNO0FBQUEsTUFBRztBQUFBLElBQzdIO0FBQUEsSUFDQSxRQUFRLElBQWE7QUFBRSxVQUFJLEtBQUssSUFBSTtBQUFFLFlBQUksTUFBTSxDQUFDLEtBQUssR0FBRyxVQUFVLEVBQUcsTUFBSyxHQUFHLE1BQU07QUFBRyxZQUFJLENBQUMsTUFBTSxLQUFLLEdBQUcsVUFBVSxFQUFHLE1BQUssR0FBRyxLQUFLO0FBQUEsTUFBRztBQUFBLElBQUU7QUFBQSxJQUN6SSxPQUFPLElBQVk7QUFBRSxVQUFJLEtBQUssUUFBUSxLQUFLLEtBQUssVUFBVSxFQUFHLE1BQUssS0FBSyxTQUFTLEtBQUssS0FBSztBQUFBLElBQUs7QUFBQSxJQUMvRixVQUFVO0FBQUUsVUFBSSxLQUFLLElBQUk7QUFBRSxhQUFLLEdBQUcsS0FBSztBQUFHLGFBQUssR0FBRyxRQUFRO0FBQUEsTUFBRztBQUFFLE9BQUMsS0FBSyxNQUFNLEtBQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLEtBQUssS0FBSyxLQUFLLEVBQUUsUUFBUSxDQUFDLE1BQU0sS0FBSyxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssTUFBTSxRQUFRO0FBQUEsSUFBRztBQUFBLEVBQ3hNO0FBR0EsTUFBTSxjQUFOLE1BQXdDO0FBQUEsSUFLdEMsWUFBb0IsR0FBbUIsS0FBZSxNQUFjLE1BQWEsTUFBYztBQUEzRTtBQUFtQjtBQUp2QztBQUFhO0FBQWEsa0NBQU87QUFBRyxtQ0FBZ0I7QUFBUTtBQUM1RCwwQkFBUTtBQUFVLDBCQUFRO0FBQVcsMEJBQVEsU0FBNkIsQ0FBQztBQUFHLDBCQUFRLE9BQVc7QUFBTSwwQkFBUTtBQUFZLDBCQUFRO0FBQVcsMEJBQVEsVUFBUztBQUFHLDBCQUFRO0FBQzFLLDBCQUFRLGNBQWE7QUFBSSwwQkFBUSxPQUFNO0FBQUksMEJBQVEsT0FBVztBQUFNLDBCQUFRLFNBQVE7QUFBRywwQkFBUSxjQUFhO0FBQUssMEJBQVEsWUFBVztBQUFPLDBCQUFRLFVBQVM7QUFBTywwQkFBUSxVQUFTO0FBQUcsMEJBQVEsUUFBTztBQUFNLDBCQUFRLFVBQThDLENBQUM7QUFDblEsMEJBQVE7QUE2QlIsMEJBQVEsU0FBUTtBQTNCZCxXQUFLLFNBQVM7QUFDZCxZQUFNLElBQUksRUFBRSxPQUFPLE1BQU0sS0FBSyxPQUFPLEVBQUUsU0FBUyxFQUFFLEVBQUUsTUFBTSxHQUFHLENBQUM7QUFBRyxXQUFLLE1BQU07QUFDNUUsV0FBSyxNQUFNLElBQUksVUFBVSx5QkFBeUIsQ0FBQyxNQUFjLElBQUksTUFBTSxLQUFLLE9BQU8sRUFBRSxrQkFBa0IsS0FBSyxDQUFDO0FBQ2pILFdBQUssU0FBUyxJQUFJLFFBQVEsY0FBYyxVQUFVLEtBQUssQ0FBQztBQUFHLFdBQUssSUFBSSxVQUFVLENBQUMsRUFBRSxTQUFTLEtBQUs7QUFDL0YsV0FBSyxPQUFPLEtBQUssSUFBSSxVQUFVLENBQUMsRUFBRSxlQUFlLEVBQUUsS0FBSyxDQUFDLE1BQVcsRUFBRSxLQUFLLFNBQVMsT0FBTyxDQUFDO0FBQzVGLFVBQUksQ0FBQyxJQUFJLFFBQVMsS0FBSSxVQUFVLEtBQUssS0FBSztBQUMxQyxXQUFLLElBQUksZ0JBQWdCLFFBQVEsQ0FBQ0MsT0FBVztBQUFFLFFBQUFBLEdBQUUsS0FBSztBQUFHLFFBQUFBLEdBQUUsaUJBQWlCO0FBQU0sUUFBQUEsR0FBRSxnQkFBZ0I7QUFBTSxhQUFLLE1BQU1BLEdBQUUsS0FBSyxNQUFNLEdBQUcsRUFBRSxDQUFDLENBQUMsSUFBSUE7QUFBQSxNQUFHLENBQUM7QUFDakosV0FBSyxJQUFJLFVBQVUsQ0FBQyxFQUFFLGVBQWUsRUFBRSxRQUFRLENBQUMsTUFBVztBQUFFLFVBQUUsMkJBQTJCO0FBQU0sVUFBRSxhQUFhO0FBQUEsTUFBTyxDQUFDO0FBQ3ZILFdBQUssTUFBTSxJQUFJO0FBQUssV0FBSyxPQUFPLElBQUk7QUFBTyxXQUFLLE9BQU87QUFDdkQsVUFBSSxJQUFJLE9BQVEsTUFBSyxhQUFhLElBQUksT0FBTyxNQUFNLEtBQUssT0FBTyxLQUFLLElBQUksT0FBTyxNQUFNLElBQUksT0FBTztBQUNoRyxXQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUcsS0FBSyxRQUFRLEtBQUssS0FBSyxHQUFHO0FBQ2xELFdBQUssT0FBTyxRQUFRLFlBQVksZUFBZSxRQUFRLEVBQUUsUUFBUSxLQUFLLFVBQVUsSUFBSSxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxLQUFLO0FBQVEsV0FBSyxLQUFLLFNBQVMsSUFBSTtBQUFLLFdBQUssS0FBSyxhQUFhO0FBQU8sV0FBSyxLQUFLLGFBQWE7QUFDNU0sV0FBSyxRQUFRLElBQUk7QUFBRyxXQUFLLFFBQVEsSUFBSTtBQUFHLFdBQUssS0FBSyxXQUFXLEVBQUUsTUFBTSxRQUFRLFFBQVEsS0FBSztBQUFBLElBQzVGO0FBQUEsSUFDUSxXQUFXO0FBQ2pCLFlBQU0sTUFBTSxLQUFLLE9BQU8sTUFBTSxLQUFLLE1BQU0sSUFBSSxLQUFLO0FBQ2xELFVBQUksRUFBRSxRQUFRO0FBQ1osWUFBSSxDQUFDLEtBQUssS0FBSztBQUFFLGVBQUssTUFBTSxFQUFFLFFBQVEsTUFBTSxTQUFTLEtBQUssR0FBRztBQUFHLGVBQUssSUFBSSxrQkFBa0IsRUFBRTtBQUFRLGVBQUssSUFBSSxvQkFBb0IsS0FBSztBQUFBLFFBQU07QUFDN0ksYUFBSyxJQUFJLGdCQUFnQixLQUFLLFNBQVMsSUFBSSxFQUFFLFdBQVcsRUFBRSxRQUFRO0FBQWUsY0FBTSxJQUFJLEtBQUssS0FBSyxPQUFPLENBQUM7QUFBRyxhQUFLLElBQUksY0FBYyxJQUFJLFFBQVEsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztBQUMxSyxhQUFLLElBQUksZ0JBQWdCLEtBQUssU0FBUyxJQUFJLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxHQUFHLElBQUksSUFBSSxRQUFRLE9BQU8sTUFBTSxLQUFLLENBQUM7QUFDN0csYUFBSyxLQUFLLFdBQVcsS0FBSztBQUFLO0FBQUEsTUFDakM7QUFDQSxVQUFJLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFFLGNBQU0sSUFBSSxFQUFFLFFBQVEsTUFBTSxPQUFPLEdBQUc7QUFBRyxZQUFJLEtBQUssU0FBUyxFQUFHLEdBQUUsZ0JBQWdCLEVBQUU7QUFBVSxjQUFNLElBQUksS0FBSyxLQUFLLE9BQU8sQ0FBQztBQUFHLFVBQUUsY0FBYyxJQUFJLFFBQVEsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztBQUFHLFVBQUUsU0FBUyxHQUFHLElBQUk7QUFBQSxNQUFHO0FBQzVOLFdBQUssS0FBSyxXQUFXLEVBQUUsU0FBUyxHQUFHO0FBQUEsSUFDckM7QUFBQSxJQUNBLFFBQVEsR0FBVTtBQUFFLFdBQUssT0FBTztBQUFHLFdBQUssU0FBUztBQUFHLFdBQUssS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJO0FBQUEsSUFBRztBQUFBLElBQ2pGLFFBQVEsSUFBWTtBQUFFLFdBQUssT0FBTztBQUFJLFdBQUssU0FBUztBQUFHLFdBQUssT0FBTyxRQUFRLE9BQU8sS0FBSyxHQUFHLEVBQUUsSUFBSSxLQUFLLElBQUk7QUFBRyxXQUFLLEtBQUssSUFBSSxLQUFLLE1BQU0sRUFBRTtBQUFHLFdBQUssS0FBSyxJQUFJLEtBQUssR0FBRyxFQUFFLElBQUksS0FBSyxJQUFJO0FBQUEsSUFBRztBQUFBO0FBQUEsSUFHbEwsWUFBc0I7QUFBRSxhQUFPLE9BQU8sS0FBSyxLQUFLLEtBQUssRUFBRSxPQUFPLENBQUMsTUFBTSxNQUFNLFVBQVUsTUFBTSxLQUFLO0FBQUEsSUFBRztBQUFBLElBQ25HLFlBQVksTUFBYztBQWpNNUI7QUFrTUksWUFBTUEsS0FBSSxLQUFLLE1BQU0sSUFBSTtBQUFHLFVBQUksQ0FBQ0EsR0FBRztBQUNwQyxVQUFJLFNBQVMsUUFBUTtBQUFFLGFBQUssS0FBSyxNQUFNO0FBQUc7QUFBQSxNQUFRO0FBQ2xELFdBQUssU0FBUztBQUFPLFVBQUksS0FBSyxJQUFLLE1BQUssSUFBSSxLQUFLO0FBQUcsTUFBQUEsR0FBRSxLQUFLO0FBQUcsTUFBQUEsR0FBRSxNQUFNLE9BQU8sR0FBR0EsR0FBRSxNQUFNQSxHQUFFLEVBQUU7QUFBRyxXQUFLLE1BQU1BO0FBQUcsV0FBSyxXQUFXO0FBQU0sV0FBSyxRQUFRO0FBQVEsV0FBSyxRQUFRO0FBQ3JLLFlBQU0sT0FBTyxDQUFDLEtBQUksVUFBSyxJQUFJLFdBQVQsbUJBQWlCLFVBQVMsQ0FBQyxHQUFJLEdBQUksS0FBSyxJQUFJLFVBQVUsQ0FBQyxDQUFFLEVBQUUsS0FBSyxDQUFDLE1BQU0sRUFBRSxTQUFTLElBQUk7QUFDeEcsVUFBSSxRQUFRLEtBQUssT0FBTztBQUFFLGFBQUssTUFBTSxLQUFLLE9BQU8sR0FBRztBQUFHLFlBQUksS0FBSyxVQUFVLE1BQU8sTUFBSyxNQUFNLEtBQUssT0FBTyxHQUFHO0FBQUEsTUFBRztBQUM5RyxVQUFJLE1BQU0sSUFBSSxJQUFJLEtBQUssU0FBUyxXQUFXLFNBQVMsU0FBVSxPQUFNLEtBQUssS0FBSyxRQUFRLEdBQUc7QUFBQSxJQUMzRjtBQUFBLElBQ1EsR0FBRyxJQUFZO0FBQUUsY0FBUSxLQUFLLElBQUksYUFBYSxRQUFRLEtBQUssT0FBTyxLQUFLLENBQUMsSUFBSSxLQUFLO0FBQUEsSUFBTztBQUFBLElBQ2pHLFFBQVEsSUFBYTtBQUFFLFdBQUssUUFBUSxLQUFLLE1BQU07QUFBRyxXQUFLLE9BQU8sUUFBUSxPQUFPLEtBQUssR0FBRyxLQUFLLElBQUksSUFBSSxLQUFLLElBQUk7QUFBRyxXQUFLLEtBQUssSUFBSSxLQUFLLEdBQUcsS0FBSyxJQUFJLElBQUksS0FBSyxJQUFJO0FBQUcsV0FBSyxLQUFLLFFBQVEsRUFBRTtBQUFBLElBQUc7QUFBQSxJQUNwTCxNQUFNLEdBQWtCO0FBQUUsV0FBSyxLQUFLLE1BQU0sQ0FBQztBQUFBLElBQUc7QUFBQSxJQUM5QyxTQUFTLEdBQVc7QUFBRSxXQUFLLEtBQUssU0FBUyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQzdDLFFBQVEsR0FBa0I7QUFBRSxXQUFLLEtBQUssUUFBUSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQ2xELFFBQVE7QUFBRSxXQUFLLFNBQVM7QUFBQSxJQUFNO0FBQUEsSUFDOUIsS0FBSyxPQUFlLFFBQVEsR0FBRztBQUM3QixVQUFJLE9BQU8sS0FBSyxJQUFJLE1BQU0sS0FBSyxHQUFHO0FBQ2xDLFVBQUksVUFBVSxXQUFXLEtBQUssSUFBSSxRQUFRO0FBQUUsZUFBTyxLQUFLLElBQUksT0FBTyxLQUFLLE1BQU0sS0FBSyxPQUFPLElBQUksS0FBSyxJQUFJLE9BQU8sTUFBTSxDQUFDO0FBQUcsZUFBTyxLQUFLO0FBQUEsTUFBTTtBQUMxSSxZQUFNQSxLQUFJLEtBQUssTUFBTSxJQUFJO0FBQUcsVUFBSSxDQUFDQSxHQUFHO0FBQVEsWUFBTSxPQUFPLFVBQVUsVUFBVSxVQUFVO0FBQ3ZGLFVBQUksVUFBVSxVQUFVLEtBQUssVUFBVSxXQUFXLEtBQUssT0FBTyxLQUFLLElBQUksYUFBYSxLQUFLLElBQUksUUFBUTtBQUFFLGFBQUssU0FBUztBQUFNO0FBQUEsTUFBUTtBQUNuSSxVQUFJLFFBQVEsS0FBSyxVQUFVLFNBQVMsS0FBSyxRQUFRQSxHQUFHO0FBQ3BELFdBQUssU0FBUztBQUFPLFdBQUssV0FBVztBQUFPLFdBQUssUUFBUTtBQUN6RCxVQUFJLEtBQUssSUFBSyxNQUFLLElBQUksS0FBSztBQUFHLE1BQUFBLEdBQUUsS0FBSztBQUFHLE1BQUFBLEdBQUUsTUFBTSxNQUFNLE9BQU9BLEdBQUUsTUFBTUEsR0FBRSxFQUFFO0FBQzFFLFVBQUksS0FBTSxDQUFBQSxHQUFFLFVBQVVBLEdBQUUsT0FBTyxLQUFLLE9BQU8sS0FBS0EsR0FBRSxLQUFLQSxHQUFFLEtBQUs7QUFDOUQsV0FBSyxNQUFNQTtBQUFHLFdBQUssUUFBUTtBQUFPLFdBQUssS0FBSyxRQUFRLFVBQVUsT0FBTztBQUNyRSxVQUFJLFFBQVEsS0FBSyxNQUFPLE1BQUssTUFBTSxLQUFLLE9BQU8sSUFBSTtBQUNuRCxVQUFJLFVBQVUsU0FBUztBQUFFLGFBQUssU0FBUztBQUFHLFlBQUksS0FBSyxJQUFJLFlBQVk7QUFBRSxlQUFLLE1BQU0sS0FBSyxJQUFJLFlBQVksR0FBRztBQUFHLGVBQUssTUFBTSxLQUFLLElBQUksWUFBWSxHQUFHO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFBQSxJQUNySjtBQUFBO0FBQUEsSUFFUSxNQUFNLE1BQWMsUUFBUSxHQUFHO0FBQ3JDLFlBQU0sTUFBTSxLQUFLLEVBQUUsTUFBTSxJQUFJO0FBQUcsVUFBSSxDQUFDLElBQUs7QUFDMUMsWUFBTSxLQUFLLFFBQVEsWUFBWSxZQUFZLE9BQU8sRUFBRSxNQUFNLEtBQUssR0FBRyxLQUFLLEVBQUUsS0FBSztBQUFHLFNBQUcsU0FBUyxLQUFLO0FBQVEsU0FBRyxnQkFBZ0IsUUFBUSxLQUFLO0FBQW1CLFNBQUcsV0FBVztBQUFLLFNBQUcsYUFBYTtBQUFPLFNBQUcsYUFBYTtBQUN2TixZQUFNLEtBQUssS0FBSyxNQUFNO0FBQU0sU0FBRyxTQUFTLElBQUksTUFBTSxJQUFJLENBQUM7QUFBRyxXQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsSUFBSSxHQUFHLENBQUMsT0FBTyxHQUFHLENBQUM7QUFBQSxJQUNyRztBQUFBO0FBQUEsSUFFUSxjQUFjO0FBQ3BCLFlBQU0sSUFBSSxLQUFLLElBQUk7QUFBUyxXQUFLLFFBQVE7QUFDekMsVUFBSSxPQUFPLEVBQUUsTUFBTSxPQUFPLENBQUMsTUFBTSxFQUFFLFNBQVMsS0FBSyxjQUFjLEtBQUssTUFBTSxFQUFFLElBQUksQ0FBQztBQUFHLFVBQUksQ0FBQyxLQUFLLE9BQVEsUUFBTyxFQUFFLE1BQU0sT0FBTyxDQUFDLE1BQU0sS0FBSyxNQUFNLEVBQUUsSUFBSSxDQUFDO0FBQUcsVUFBSSxDQUFDLEtBQUssT0FBUTtBQUMxSyxZQUFNLE9BQU8sS0FBSyxLQUFLLE1BQU0sS0FBSyxPQUFPLElBQUksS0FBSyxNQUFNLENBQUMsR0FBR0EsS0FBSSxLQUFLLE1BQU0sS0FBSyxJQUFJO0FBQUcsV0FBSyxhQUFhLEtBQUs7QUFDOUcsVUFBSSxLQUFLLElBQUssTUFBSyxJQUFJLEtBQUs7QUFBRyxNQUFBQSxHQUFFLEtBQUs7QUFBRyxNQUFBQSxHQUFFLE1BQU0sT0FBTyxHQUFHQSxHQUFFLE1BQU1BLEdBQUUsRUFBRTtBQUFHLFdBQUssTUFBTUE7QUFBRyxXQUFLLFdBQVc7QUFBTSxXQUFLLGFBQWEsRUFBRSxNQUFNLEtBQUssT0FBTyxLQUFLLEVBQUUsTUFBTSxFQUFFO0FBQ25LLFVBQUksTUFBTSxJQUFJLEtBQUssSUFBSSxFQUFHLE9BQU0sS0FBSyxLQUFLLFFBQVEsSUFBSTtBQUN0RCxVQUFJLEtBQUssT0FBTztBQUFFLGFBQUssTUFBTSxLQUFLLE9BQU8sR0FBRztBQUFHLFlBQUksS0FBSyxVQUFVLE1BQU8sTUFBSyxNQUFNLEtBQUssT0FBTyxHQUFHO0FBQUEsTUFBRztBQUFBLElBQ3hHO0FBQUEsSUFDQSxPQUFPLElBQVk7QUFDakIsV0FBSyxLQUFLLE9BQU8sRUFBRTtBQUNuQixVQUFJLEtBQUssT0FBTyxDQUFDLEtBQUssSUFBSSxXQUFXO0FBQ25DLFlBQUksS0FBSyxRQUFRO0FBQUUsZUFBSyxTQUFTO0FBQU8sZUFBSyxLQUFLLE1BQU07QUFBQSxRQUFHLFdBQVcsS0FBSyxVQUFVO0FBQUUsZUFBSyxXQUFXO0FBQU8sZUFBSyxLQUFLLE1BQU07QUFBQSxRQUFHLFdBQVcsS0FBSyxVQUFVLFFBQVMsTUFBSyxLQUFLLE1BQU07QUFBQSxNQUN0TDtBQUNBLFVBQUksS0FBSyxJQUFJLFVBQVUsS0FBSyxVQUFVLFVBQVUsQ0FBQyxLQUFLLFlBQVksS0FBSyxPQUFPLFVBQVUsR0FBRztBQUFFLGFBQUssU0FBUztBQUFJLFlBQUksS0FBSyxTQUFTLEtBQUssV0FBWSxNQUFLLFlBQVk7QUFBQSxNQUFHO0FBQ3RLLFVBQUksS0FBSyxVQUFVLFFBQVMsTUFBSyxVQUFVO0FBQzNDLGVBQVMsSUFBSSxLQUFLLE9BQU8sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQ2hELGNBQU0sSUFBSSxLQUFLLE9BQU8sQ0FBQztBQUFHLFVBQUUsS0FBSztBQUFJLFlBQUksRUFBRSxJQUFJLEVBQUc7QUFBVSxjQUFNLElBQUksRUFBRSxJQUFJO0FBQzVFLFlBQUksS0FBSyxHQUFHO0FBQUUsWUFBRSxFQUFFLFFBQVE7QUFBRyxlQUFLLE9BQU8sT0FBTyxHQUFHLENBQUM7QUFBRztBQUFBLFFBQVU7QUFDakUsVUFBRSxFQUFFLGFBQWEsS0FBSyxJQUFJLEdBQUcsRUFBRSxJQUFJLEdBQUcsS0FBSyxJQUFJLElBQUk7QUFBSSxVQUFFLEVBQUUsU0FBUyxJQUFJLE9BQU8sT0FBTyxLQUFLLElBQUksRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEtBQUssRUFBRSxJQUFJLEtBQUssQ0FBQztBQUFHLFVBQUUsRUFBRSxRQUFRLE9BQU8sTUFBTSxNQUFNLENBQUM7QUFBQSxNQUNqSztBQUNBLFVBQUksS0FBSyxLQUFLO0FBQ1osWUFBSSxTQUFTO0FBQ2IsWUFBSSxLQUFLLFVBQVUsUUFBUyxVQUFTLE9BQU8sT0FBTyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksSUFBSSxLQUFLLFNBQVMsT0FBTyxRQUFRLEdBQUcsQ0FBQztBQUFBLGlCQUNwRyxLQUFLLFVBQVUsT0FBUSxVQUFTLEtBQUssV0FBVyxPQUFPO0FBQUEsaUJBQ3ZELEtBQUssVUFBVSxNQUFPLFVBQVM7QUFBQSxpQkFBYyxLQUFLLFVBQVUsU0FBVSxVQUFTO0FBQUEsaUJBQWMsS0FBSyxVQUFVLFFBQVMsVUFBUztBQUFBLGlCQUFjLEtBQUssVUFBVSxRQUFTLFVBQVM7QUFDdEwsYUFBSyxTQUFTLFNBQVMsS0FBSyxRQUFRLEtBQUssSUFBSSxHQUFHLEtBQUssQ0FBQztBQUFHLGFBQUssSUFBSSxvQkFBb0IsS0FBSztBQUFBLE1BQzdGO0FBQ0EsVUFBSSxLQUFLLFNBQVMsR0FBRztBQUFFLGFBQUssVUFBVTtBQUFJLGNBQU0sSUFBSSxJQUFJLE9BQU8sS0FBSyxJQUFJLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxJQUFJLE9BQU8sS0FBSyxFQUFFO0FBQUcsYUFBSyxPQUFPLFFBQVEsT0FBTyxLQUFLLEdBQUcsS0FBSyxJQUFJLElBQUksS0FBSyxPQUFPLENBQUM7QUFBQSxNQUFHO0FBQUEsSUFDdEw7QUFBQSxJQUNBLFVBQVU7QUFBRSxXQUFLLE9BQU8sUUFBUSxDQUFDLE1BQU0sRUFBRSxFQUFFLFFBQVEsQ0FBQztBQUFHLFVBQUksS0FBSyxJQUFLLE1BQUssSUFBSSxRQUFRO0FBQUcsV0FBSyxLQUFLLFFBQVE7QUFBRyxXQUFLLElBQUksZ0JBQWdCLFFBQVEsQ0FBQ0EsT0FBV0EsR0FBRSxRQUFRLENBQUM7QUFBRyxXQUFLLElBQUksVUFBVSxRQUFRLENBQUMsTUFBVyxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssS0FBSyxRQUFRO0FBQUcsV0FBSyxJQUFJLFVBQVUsQ0FBQyxFQUFFLFFBQVEsT0FBTyxLQUFLO0FBQUcsV0FBSyxPQUFPLFFBQVE7QUFBQSxJQUFHO0FBQUEsRUFDelQ7QUFHQSxNQUFNLEtBQXlHO0FBQUEsSUFDN0csUUFBUSxFQUFFLEtBQUssV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLE1BQU0sTUFBTSxRQUFRLFVBQVUsT0FBTyxTQUFTO0FBQUEsSUFDMUYsUUFBUSxFQUFFLEtBQUssV0FBVyxHQUFHLEtBQUssR0FBRyxLQUFLLE1BQU0sTUFBTSxRQUFRLFVBQVUsT0FBTyxTQUFTO0FBQUEsSUFDeEYsTUFBTSxFQUFFLEtBQUssV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLE1BQU0sTUFBTSxRQUFRLFFBQVEsT0FBTyxPQUFPO0FBQUEsSUFDcEYsV0FBVyxFQUFFLEtBQUssV0FBVyxHQUFHLE1BQU0sR0FBRyxNQUFNLE1BQU0sTUFBTSxRQUFRLE9BQU8sT0FBTyxZQUFZO0FBQUEsRUFDL0Y7QUFDQSxNQUFNLG9CQUFOLE1BQThDO0FBQUEsSUFHNUMsWUFBb0IsR0FBbUIsTUFBYyxNQUFhLE1BQWM7QUFBNUQ7QUFBbUI7QUFGdkM7QUFBYTtBQUFhLGtDQUFPO0FBQUcsbUNBQWdCO0FBQVE7QUFDNUQsMEJBQVE7QUFBVSwwQkFBUSxRQUFjLENBQUM7QUFBRywwQkFBUTtBQUFTLDBCQUFRO0FBQVksMEJBQVE7QUFBVywwQkFBUSxLQUFJLEtBQUssT0FBTyxJQUFJO0FBQUcsMEJBQVEsT0FBTTtBQUFHLDBCQUFRLE9BQU07QUFBRywwQkFBUSxRQUFPO0FBQUcsMEJBQVEsVUFBUztBQUFHLDBCQUFRLFFBQWMsQ0FBQztBQUFHLDBCQUFRO0FBRTNPLFlBQU0sSUFBSSxFQUFFLE9BQU8sSUFBSSxHQUFHLElBQUk7QUFBRyxXQUFLLE9BQU87QUFDN0MsV0FBSyxTQUFTLElBQUksUUFBUSxjQUFjLFFBQVEsTUFBTSxDQUFDO0FBQUcsV0FBSyxNQUFNLElBQUksUUFBUSxjQUFjLE9BQU8sQ0FBQztBQUFHLFdBQUssSUFBSSxTQUFTLEtBQUs7QUFDakksWUFBTSxNQUFNLENBQUMsS0FBYSxLQUFLLE1BQU07QUFBRSxjQUFNLElBQUksSUFBSSxRQUFRLGlCQUFpQixNQUFNLENBQUM7QUFBRyxVQUFFLGVBQWUsUUFBUSxPQUFPLGNBQWMsR0FBRyxFQUFFLE1BQU0sSUFBSTtBQUFHLFVBQUUsZ0JBQWdCLElBQUksUUFBUSxPQUFPLEtBQUssS0FBSyxHQUFHO0FBQUcsWUFBSSxHQUFJLEdBQUUsZ0JBQWdCLEVBQUUsYUFBYSxNQUFNLEVBQUU7QUFBRyxlQUFPO0FBQUEsTUFBRztBQUMzUSxZQUFNLE9BQU8sTUFBTSxRQUFRLE9BQU8sRUFBRSxJQUFJO0FBQ3hDLGlCQUFXLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRztBQUFFLGNBQU0sS0FBSyxJQUFJLFFBQVEsY0FBYyxPQUFPLENBQUM7QUFBRyxXQUFHLFNBQVMsS0FBSztBQUFLLFdBQUcsU0FBUyxJQUFJLEtBQUssRUFBRSxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQUcsY0FBTSxJQUFJLFFBQVEsWUFBWSxlQUFlLEtBQUssRUFBRSxRQUFRLE1BQU0sVUFBVSxFQUFFLElBQUksS0FBSyxHQUFHLENBQUM7QUFBRyxVQUFFLFNBQVM7QUFBSSxVQUFFLFNBQVMsSUFBSSxDQUFDLE9BQU87QUFBRyxVQUFFLFdBQVcsSUFBSSxTQUFTO0FBQUcsVUFBRSxhQUFhO0FBQU8sYUFBSyxLQUFLLEtBQUssRUFBRTtBQUFBLE1BQUc7QUFDM1YsV0FBSyxPQUFPLFFBQVEsWUFBWSxjQUFjLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxHQUFHLFFBQVEsRUFBRSxJQUFJLEVBQUUsSUFBSSxJQUFJLEdBQUcsQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLEtBQUs7QUFBSyxXQUFLLEtBQUssU0FBUyxJQUFJO0FBQU8sV0FBSyxLQUFLLFdBQVcsSUFBSSxFQUFFLEdBQUc7QUFBRyxXQUFLLEtBQUssYUFBYTtBQUMzTixZQUFNLE9BQU8sUUFBUSxZQUFZLGFBQWEsUUFBUSxFQUFFLFVBQVUsRUFBRSxPQUFPLEtBQUssVUFBVSxHQUFHLEdBQUcsQ0FBQztBQUFHLFdBQUssU0FBUyxLQUFLO0FBQUssV0FBSyxTQUFTLElBQUksT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPO0FBQU0sV0FBSyxXQUFXLElBQUksRUFBRSxHQUFHO0FBQUcsV0FBSyxhQUFhO0FBQ3hOLFlBQU0sT0FBTyxJQUFJLFFBQVEsaUJBQWlCLE9BQU8sQ0FBQztBQUFHLFdBQUssZUFBZSxRQUFRLE9BQU8sTUFBTTtBQUFHLFdBQUssZ0JBQWdCLFNBQVMsSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sQ0FBQyxJQUFJLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxJQUFJO0FBQUcsTUFBQyxLQUFhLE9BQU87QUFDL04saUJBQVcsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHO0FBQUUsY0FBTSxJQUFJLFFBQVEsWUFBWSxhQUFhLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTyxJQUFJLEdBQUcsQ0FBQztBQUFHLFVBQUUsU0FBUyxLQUFLO0FBQUssVUFBRSxTQUFTLElBQUksS0FBSyxFQUFFLE9BQU8sS0FBSyxLQUFLLFNBQVMsSUFBSSxNQUFNLEVBQUUsT0FBTyxJQUFJO0FBQUcsVUFBRSxXQUFXO0FBQU0sVUFBRSxhQUFhO0FBQUEsTUFBTztBQUVwUCxXQUFLLEtBQUssSUFBSSxRQUFRLGNBQWMsTUFBTSxDQUFDO0FBQUcsV0FBSyxHQUFHLFNBQVMsS0FBSztBQUFLLFdBQUssR0FBRyxTQUFTLElBQUksRUFBRSxJQUFJLEtBQUssT0FBTyxFQUFFLElBQUksTUFBTSxJQUFJO0FBQ2hJLFlBQU0sS0FBSyxJQUFJLFNBQVMsR0FBRyxPQUFPLElBQUksU0FBUztBQUMvQyxZQUFNLEtBQUssQ0FBQyxHQUFRLE1BQWMsTUFBVyxLQUFlLE9BQVk7QUFBRSxjQUFNLElBQUksU0FBUyxRQUFRLFFBQVEsWUFBWSxVQUFVLEtBQUssTUFBTSxDQUFDLElBQUksU0FBUyxRQUFRLFFBQVEsWUFBWSxlQUFlLEtBQUssTUFBTSxDQUFDLElBQUksUUFBUSxZQUFZLGFBQWEsS0FBSyxNQUFNLENBQUM7QUFBRyxVQUFFLFNBQVMsS0FBSztBQUFJLFVBQUUsU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDO0FBQUcsVUFBRSxXQUFXO0FBQUksVUFBRSxhQUFhO0FBQU8sZUFBTztBQUFBLE1BQUc7QUFDcFgsVUFBSSxFQUFFLFdBQVcsU0FBVSxJQUFHLEdBQUcsT0FBTyxFQUFFLE9BQU8sTUFBTSxRQUFRLEtBQUssT0FBTyxLQUFLLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLElBQUk7QUFDeEcsVUFBSSxFQUFFLFdBQVcsVUFBVTtBQUFFLFdBQUcsR0FBRyxPQUFPLEVBQUUsT0FBTyxNQUFNLFFBQVEsS0FBSyxPQUFPLEtBQUssR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsSUFBSTtBQUFHLGNBQU0sS0FBSyxRQUFRLFlBQVksZUFBZSxNQUFNLEVBQUUsUUFBUSxNQUFNLFVBQVUsS0FBSyxHQUFHLENBQUM7QUFBRyxXQUFHLFNBQVMsS0FBSztBQUFLLFdBQUcsU0FBUyxJQUFJLEtBQUssS0FBSztBQUFHLFdBQUcsU0FBUyxJQUFJLENBQUMsRUFBRSxJQUFJLEtBQUssT0FBTyxFQUFFLElBQUksS0FBSyxJQUFJO0FBQUcsV0FBRyxXQUFXLElBQUksU0FBUztBQUFHLFdBQUcsYUFBYTtBQUFBLE1BQU87QUFDcFcsVUFBSSxFQUFFLFdBQVcsUUFBUTtBQUFFLFdBQUcsR0FBRyxPQUFPLEVBQUUsUUFBUSxLQUFLLFVBQVUsS0FBSyxHQUFHLENBQUMsR0FBRyxPQUFPLEdBQUcsR0FBRyxFQUFFO0FBQUcsV0FBRyxHQUFHLE9BQU8sRUFBRSxVQUFVLElBQUksR0FBRyxDQUFDLEdBQUcsT0FBTyxHQUFHLEdBQUcsSUFBSTtBQUFBLE1BQUc7QUFDdkosVUFBSSxFQUFFLFdBQVcsT0FBTztBQUFFLFdBQUcsR0FBRyxPQUFPLEVBQUUsUUFBUSxLQUFLLFVBQVUsS0FBSyxHQUFHLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxFQUFFO0FBQUcsV0FBRyxHQUFHLE9BQU8sRUFBRSxPQUFPLE1BQU0sUUFBUSxNQUFNLE9BQU8sS0FBSyxHQUFHLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxJQUFJO0FBQUcsY0FBTSxPQUFPLFFBQVEsWUFBWSxlQUFlLFFBQVEsRUFBRSxRQUFRLEtBQUssYUFBYSxHQUFHLGdCQUFnQixFQUFFLE9BQU8sSUFBSSxHQUFHLENBQUM7QUFBRyxhQUFLLFNBQVMsS0FBSztBQUFLLGFBQUssU0FBUyxJQUFJLEtBQUssU0FBUyxJQUFJLEVBQUUsT0FBTztBQUFNLGFBQUssV0FBVyxJQUFJLFNBQVM7QUFBRyxhQUFLLGFBQWE7QUFBQSxNQUFPO0FBQzlhLFdBQUssTUFBTSxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU87QUFBTSxXQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUcsS0FBSyxRQUFRLEtBQUssS0FBSyxFQUFFLElBQUksR0FBRztBQUMvRixZQUFNLE1BQU0sSUFBSSxHQUFHLEtBQUssSUFBSSxDQUFDLE1BQU07QUFBRSxVQUFFLE9BQU87QUFBd0IsVUFBRSxZQUFZO0FBQVUsVUFBRSxZQUFZO0FBQVcsVUFBRSxjQUFjO0FBQVEsVUFBRSxZQUFZO0FBQUcsVUFBRSxXQUFXLEVBQUUsUUFBUSxlQUFlLEtBQUssRUFBRTtBQUFHLFVBQUUsU0FBUyxFQUFFLFFBQVEsZUFBZSxLQUFLLEVBQUU7QUFBQSxNQUFHLENBQUM7QUFDL1AsWUFBTSxLQUFLLFFBQVEsWUFBWSxZQUFZLE9BQU8sRUFBRSxPQUFPLEtBQUssUUFBUSxJQUFJLEdBQUcsQ0FBQztBQUFHLFNBQUcsU0FBUyxLQUFLO0FBQVEsU0FBRyxTQUFTLElBQUk7QUFBTSxTQUFHLFNBQVMsSUFBSSxLQUFLLEtBQUssSUFBSTtBQUFLLFNBQUcsZ0JBQWdCLFFBQVEsS0FBSztBQUFtQixZQUFNLEtBQUssSUFBSSxRQUFRLGlCQUFpQixNQUFNLENBQUM7QUFBRyxTQUFHLGlCQUFpQjtBQUFLLFNBQUcsZ0JBQWdCLFFBQVEsT0FBTyxNQUFNO0FBQUcsU0FBRyxrQkFBa0I7QUFBTSxTQUFHLDZCQUE2QjtBQUFNLFNBQUcsV0FBVztBQUFJLFNBQUcsYUFBYTtBQUFPLFNBQUcsU0FBUyxJQUFJLEtBQUssTUFBTTtBQUNuZCxXQUFLLE9BQU8sUUFBUSxZQUFZLGVBQWUsUUFBUSxFQUFFLFFBQVEsS0FBSyxLQUFLLFVBQVUsS0FBSyxJQUFJLEtBQUssRUFBRSxJQUFJLEdBQUcsRUFBRSxHQUFHLENBQUM7QUFBRyxXQUFLLEtBQUssU0FBUyxLQUFLO0FBQVEsV0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLE1BQU07QUFBRyxXQUFLLEtBQUssYUFBYTtBQUFPLFdBQUssS0FBSyxXQUFXLEVBQUUsTUFBTSxRQUFRLFFBQVEsS0FBSztBQUMxUSxNQUFDLEtBQWEsUUFBUSxDQUFDLEVBQUU7QUFBRyxXQUFLLFFBQVEsSUFBSTtBQUFHLFdBQUssUUFBUSxJQUFJO0FBQUcsV0FBSyxLQUFLLE1BQU07QUFBQSxJQUN0RjtBQUFBLElBQ0EsUUFBUSxHQUFVO0FBQUUsV0FBSyxPQUFPO0FBQUcsTUFBQyxLQUFhLEtBQUssZ0JBQWdCLE1BQU0sSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sQ0FBQyxJQUFJLElBQUksUUFBUSxPQUFPLEdBQUcsTUFBTSxJQUFJO0FBQUcsV0FBSyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFDcEwsUUFBUSxJQUFZO0FBQUUsV0FBSyxPQUFPO0FBQUksV0FBSyxPQUFPLFFBQVEsS0FBSyxNQUFNLEtBQUssQ0FBQztBQUFHLFlBQU0sSUFBSSxLQUFLLEtBQUssQ0FBQztBQUFHLFdBQUssS0FBSyxTQUFTLGVBQWUsUUFBUSxPQUFPLGNBQWMsR0FBRyxLQUFLLElBQUksRUFBRSxHQUFHLEVBQUUsTUFBTSxJQUFJLEVBQUUsU0FBUyxJQUFJLFFBQVEsT0FBTyxLQUFLLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQUcsV0FBSyxPQUFPLFFBQVEsT0FBTyxLQUFLLElBQUk7QUFBRyxXQUFLLEtBQUssSUFBSSxLQUFLLE1BQU0sRUFBRTtBQUFHLFdBQUssS0FBSyxJQUFJLEtBQUssSUFBSTtBQUFBLElBQUc7QUFBQSxJQUMxWCxNQUFNLEdBQWtCO0FBQUUsV0FBSyxLQUFLLE1BQU0sQ0FBQztBQUFBLElBQUc7QUFBQSxJQUM5QyxTQUFTLEdBQVc7QUFBRSxXQUFLLEtBQUssU0FBUyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQzdDLFFBQVEsR0FBa0I7QUFBRSxXQUFLLEtBQUssUUFBUSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQ2xELFFBQVE7QUFBRSxXQUFLLFNBQVM7QUFBQSxJQUFNO0FBQUEsSUFDOUIsS0FBSyxPQUFlLFFBQVEsR0FBRztBQUFFLFVBQUksVUFBVSxLQUFLLFVBQVUsVUFBVSxVQUFVLFVBQVUsT0FBUTtBQUFRLFdBQUssUUFBUTtBQUFPLFdBQUssTUFBTSxLQUFLO0FBQUcsV0FBSyxNQUFNLFVBQVUsV0FBWSxRQUFRLE1BQU0sS0FBSyxJQUFjLEVBQUUsVUFBVSxRQUFTLFVBQVUsVUFBVSxNQUFNLFVBQVUsVUFBVSxNQUFNO0FBQUssV0FBSyxLQUFLLFFBQVEsVUFBVSxPQUFPO0FBQUEsSUFBRztBQUFBLElBQ3pVLE9BQU8sSUFBWTtBQUNqQixXQUFLLEtBQUs7QUFBSSxXQUFLLEtBQUssT0FBTyxFQUFFO0FBQUcsWUFBTSxJQUFJLEtBQUssSUFBSSxJQUFJLEtBQUssSUFBSSxLQUFLLE9BQU8sS0FBSyxHQUFHLEdBQUcsSUFBSSxLQUFLLEtBQUssSUFBSSxLQUFLO0FBQ2xILFFBQUUsU0FBUyxJQUFJLEdBQUcsR0FBRyxDQUFDO0FBQUcsUUFBRSxTQUFTLElBQUksR0FBRyxHQUFHLENBQUM7QUFBRyxRQUFFLFFBQVEsT0FBTyxDQUFDO0FBQUcsUUFBRSxTQUFTLElBQUk7QUFBTSxXQUFLLEtBQUssUUFBUSxDQUFDLE1BQU8sRUFBRSxTQUFTLElBQUksQ0FBRTtBQUN2SSxVQUFJLEtBQUssVUFBVSxPQUFRLEdBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksR0FBRyxJQUFJO0FBQUEsZUFDMUQsS0FBSyxVQUFVLE9BQU87QUFBRSxjQUFNLElBQUksS0FBSyxJQUFJO0FBQUksVUFBRSxTQUFTLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxDQUFDLENBQUMsSUFBSTtBQUFNLFVBQUUsU0FBUyxJQUFJO0FBQUssYUFBSyxLQUFLLENBQUMsRUFBRSxTQUFTLElBQUksS0FBSyxJQUFJLENBQUMsSUFBSTtBQUFLLGFBQUssS0FBSyxDQUFDLEVBQUUsU0FBUyxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSTtBQUFLLFVBQUUsU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLENBQUMsSUFBSTtBQUFBLE1BQUssV0FDcFAsS0FBSyxVQUFVLFVBQVU7QUFBRSxjQUFNLElBQUksSUFBSSxNQUFNLFFBQVEsSUFBSSxPQUFPLE9BQU8sTUFBTSxLQUFLLElBQUksSUFBSSxJQUFJLE9BQU8sSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJO0FBQUcsVUFBRSxTQUFTLElBQUksT0FBTyxLQUFLLElBQUksS0FBSyxLQUFLLENBQUM7QUFBRyxVQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLEtBQUssQ0FBQztBQUFBLE1BQUcsV0FDMU4sS0FBSyxVQUFVLFNBQVM7QUFBRSxjQUFNLElBQUksSUFBSSxLQUFLLElBQUksSUFBSTtBQUFJLFVBQUUsUUFBUSxPQUFPLE9BQU8sT0FBTyxDQUFDO0FBQUcsVUFBRSxTQUFTLEtBQUssSUFBSSxLQUFLO0FBQUEsTUFBSyxXQUMxSCxLQUFLLFVBQVUsU0FBUztBQUFFLGNBQU0sSUFBSSxJQUFJO0FBQUcsVUFBRSxTQUFTLElBQUksQ0FBQyxLQUFLLEtBQUssSUFBSTtBQUFHLFVBQUUsU0FBUyxJQUFJLE9BQU87QUFBRyxVQUFFLFNBQVMsSUFBSSxPQUFPO0FBQUEsTUFBRyxXQUM5SCxLQUFLLFVBQVUsU0FBUztBQUFFLFVBQUUsU0FBUyxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksS0FBSyxJQUFJLENBQUMsQ0FBQyxJQUFJO0FBQU0sVUFBRSxTQUFTLElBQUk7QUFBQSxNQUFNO0FBQzlHLFVBQUksS0FBSyxTQUFTLEdBQUc7QUFBRSxhQUFLLFVBQVU7QUFBSSxjQUFNLElBQUksSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sSUFBSSxPQUFPLEtBQUssRUFBRTtBQUFHLGFBQUssT0FBTyxRQUFRLE9BQU8sS0FBSyxPQUFPLENBQUM7QUFBQSxNQUFHO0FBQUEsSUFDaks7QUFBQSxJQUNBLFVBQVU7QUFBRSxXQUFLLEtBQUssUUFBUTtBQUFHLFdBQUssT0FBTyxlQUFlLEVBQUUsUUFBUSxDQUFDLE1BQVcsRUFBRSxRQUFRLENBQUM7QUFBRyxXQUFLLE9BQU8sUUFBUTtBQUFBLElBQUc7QUFBQSxFQUN6SDtBQUVPLFdBQVMsYUFBYSxHQUFXLE1BQWMsTUFBYSxNQUEwQjtBQUMzRixVQUFNLE1BQU0sRUFBRSxNQUFNLElBQUk7QUFDeEIsV0FBTyxNQUFNLElBQUksWUFBWSxHQUFHLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxJQUFJLGtCQUFrQixHQUFHLE1BQU0sTUFBTSxJQUFJO0FBQUEsRUFDcEc7OztBQy9TTyxNQUFNLFVBQVUsQ0FBQyxNQUF3QixrQkFBa0IsSUFBSTtBQUUvRCxNQUFNLFVBQVUsQ0FBQyxHQUFhLE1BQU0sU0FBaUIsZUFBZSxHQUFHLFVBQVUsUUFBUSxDQUFDLENBQUM7QUFHM0YsTUFBTSxZQUFzQyxFQUFFLFNBQVMsV0FBVyxRQUFRLFVBQVUsUUFBUSxVQUFVLFFBQVEsVUFBVSxNQUFNLFFBQVEsV0FBVyxZQUFZO0FBSTdKLE1BQU0sWUFBWSxDQUFDLEdBQVcsTUFBTSxTQUFpQixRQUFRLFNBQVMsR0FBRyxFQUFFLE9BQU8sS0FBSyxJQUFJLEdBQUcsQ0FBQyxDQUFDO0FBQ2hHLE1BQU0sYUFBYSxDQUFDLFFBQWdCLE1BQU0sTUFBYyxRQUFRLFNBQVMsVUFBVSxFQUFFLE9BQU8sS0FBSyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksUUFBUSxlQUFlLFVBQVUsRUFBRSxPQUFPLEtBQUssSUFBSSxHQUFHLE1BQU0sTUFBTSxDQUFDO0FBRXRMLE1BQU0sTUFBTSxDQUFDLE1BQXNCLEtBQUssTUFBTSxDQUFDLEVBQUUsZUFBZSxPQUFPOzs7QUNuQjlFLE1BQU0sV0FBNEMsRUFBRSxTQUFTLHFDQUFxQyxRQUFRLG9DQUFvQyxNQUFNLGtDQUFrQyxRQUFRLG9DQUFvQyxRQUFRLG9DQUFvQyxXQUFXLHNDQUFzQztBQUMvVCxNQUFNLGFBQXFDLEVBQUUsUUFBUSxXQUFXLE1BQU0sV0FBVyxNQUFNLFdBQVcsV0FBVyxVQUFVO0FBQ2hILE1BQU0sU0FBUyxDQUFDLE1BQXVCLENBQUMsQ0FBQyxTQUFTLENBQUM7QUFDbkQsTUFBTSxVQUFVLENBQUMsTUFBbUI7QUFWM0M7QUFVOEMsMEJBQVMsQ0FBQyxNQUFWLFlBQWUsUUFBUSxVQUFVLENBQUMsQ0FBQztBQUFBO0FBQzFFLE1BQU0sY0FBYyxDQUFDLE1BQXNCLFdBQVcsVUFBVSxDQUFDLENBQUM7QUFFbEUsTUFBTSxRQUFRLENBQUMsTUFBc0I7QUFBRSxVQUFNLElBQUksWUFBWSxDQUFDO0FBQUcsV0FBTyx1Q0FBdUMsQ0FBQyxVQUFVLENBQUM7QUFBQSxFQUE4RDs7O0FDRGhNLE1BQU0sZUFBZSxDQUFDLE1BQXNCLHFDQUFxQyxNQUFNLENBQUMsQ0FBQyxlQUFlLFFBQVEsQ0FBQyxDQUFDO0FBQ2xILE1BQU0sT0FBTyxPQUFPLFlBQVksTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsUUFBUSxVQUFVLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQ2xGLE1BQU0sSUFBSSxDQUFDLE9BQWUsU0FBUyxlQUFlLEVBQUU7QUFDcEQsTUFBTSxRQUFRLENBQUMsTUFBYyxTQUFJLE9BQU8sQ0FBQztBQUVsQyxNQUFNLEtBQU4sTUFBUztBQUFBLElBRWQsWUFBb0JDLElBQVE7QUFBUiwrQkFBQUE7QUFEcEIsMEJBQVEsVUFBUztBQUFHLDBCQUFRO0FBQWtCLDBCQUFRLFFBQU87QUFFM0QsUUFBRSxTQUFTLEVBQUUsVUFBVSxNQUFNLE9BQU8sY0FBYyxJQUFJLE1BQU0sZUFBZSxDQUFDO0FBQzVFLFFBQUUsV0FBVyxFQUFFLFVBQVUsTUFBTUEsR0FBRSxZQUFZO0FBQUcsUUFBRSxTQUFTLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFdBQVc7QUFDMUYsUUFBRSxXQUFXLEVBQUUsVUFBVSxNQUFNQSxHQUFFLGVBQWU7QUFDaEQsUUFBRSxVQUFVLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFNBQVNBLEdBQUUsWUFBWSxJQUFJLElBQUksQ0FBQztBQUNoRSxlQUFTLGlCQUE4QixZQUFZLEVBQUUsUUFBUSxDQUFDLE1BQU8sRUFBRSxVQUFVLE1BQU1BLEdBQUUsV0FBVyxFQUFFLFFBQVEsR0FBSSxDQUFFO0FBQ3BILFFBQUUsTUFBTSxFQUFFLFVBQVUsTUFBTTtBQUFFLGFBQUssSUFBSSxVQUFVLE9BQU8sTUFBTTtBQUFHLGFBQUssWUFBWTtBQUFBLE1BQUc7QUFDbkYsWUFBTSxNQUFNLE1BQU07QUFBRSxVQUFFLFVBQVUsRUFBRSxVQUFVLE9BQU8sT0FBTyxDQUFDLE1BQU0sS0FBSztBQUFHLFVBQUUsUUFBUSxFQUFFLFVBQVUsT0FBTyxPQUFPLENBQUMsTUFBTSxHQUFHO0FBQUcsY0FBTSxLQUFLLEVBQUUsUUFBUSxFQUFFLGNBQWMsS0FBSztBQUFHLFlBQUksR0FBSSxJQUFHLE1BQU0sUUFBUSxNQUFNLE1BQU0sYUFBYSxXQUFXO0FBQUEsTUFBRztBQUN2TyxRQUFFLFVBQVUsRUFBRSxVQUFVLE1BQU07QUFBRSxjQUFNLFNBQVMsQ0FBQyxNQUFNLEtBQUs7QUFBRyxZQUFJO0FBQUEsTUFBRztBQUFHLFFBQUUsUUFBUSxFQUFFLFVBQVUsTUFBTTtBQUFFLGNBQU0sT0FBTyxDQUFDLE1BQU0sR0FBRztBQUFHLFlBQUk7QUFBQSxNQUFHO0FBQ3ZJLGFBQU8saUJBQWlCLGtCQUFrQixHQUFHO0FBQUcsVUFBSTtBQUNwRCxXQUFLLE1BQU0sRUFBRSxPQUFPO0FBQUcsVUFBSSxJQUFJLGdCQUFnQixTQUFTLE1BQU0sRUFBRSxJQUFJLE9BQU8sRUFBRyxNQUFLLElBQUksVUFBVSxJQUFJLE1BQU07QUFDM0csV0FBSyxZQUFZO0FBQUEsSUFDbkI7QUFBQTtBQUFBLElBR0EsY0FBYztBQUFFLFlBQU0sSUFBSSxFQUFFLFFBQVE7QUFBRyxRQUFFLFVBQVUsT0FBTyxNQUFNO0FBQUcsV0FBSyxFQUFFO0FBQWEsUUFBRSxVQUFVLElBQUksTUFBTTtBQUFBLElBQUc7QUFBQSxJQUNoSCxNQUFNLEtBQWE7QUFBRSxZQUFNLElBQUksRUFBRSxPQUFPO0FBQUcsUUFBRSxjQUFjO0FBQUssUUFBRSxVQUFVLElBQUksTUFBTTtBQUFHLG1CQUFhLEtBQUssTUFBTTtBQUFHLFdBQUssU0FBUyxPQUFPLFdBQVcsTUFBTSxFQUFFLFVBQVUsT0FBTyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQUc7QUFBQSxJQUU3TCxTQUFTO0FBQ1AsWUFBTUEsS0FBSSxLQUFLLEdBQUcsSUFBSUEsR0FBRSxHQUFHLEtBQUtBLEdBQUUsT0FBTyxRQUFRLE9BQU87QUFDeEQsUUFBRSxRQUFRLEVBQUUsWUFBWSxXQUFXLEVBQUUsTUFBTTtBQUMzQyxRQUFFLE1BQU0sRUFBRSxjQUFjLFVBQVUsSUFBSSxRQUFRLEVBQUUsSUFBSSxLQUFLLFFBQVEsRUFBRSxJQUFJLElBQUksV0FBVyxDQUFDLENBQUM7QUFDeEYsWUFBTSxPQUFPLGFBQWEsQ0FBQztBQUFHLFFBQUUsS0FBSyxFQUFFLGNBQWMsR0FBRyxJQUFJLElBQUksRUFBRSxHQUFHO0FBQUksTUFBQyxFQUFFLFNBQVMsRUFBa0IsTUFBTSxRQUFRLEtBQUssSUFBSSxLQUFNLE9BQU8sRUFBRSxNQUFPLEdBQUcsSUFBSTtBQUUzSixZQUFNLEtBQUssWUFBWSxVQUFVLEVBQUUsTUFBTUEsR0FBRSxJQUFJLENBQUM7QUFDaEQsUUFBRSxPQUFPLEVBQUUsWUFBWSx3QkFBd0IsR0FBRyxJQUFJLENBQUMsTUFBTSwyQkFBMkIsS0FBSyxFQUFFLElBQWMsQ0FBQyxnQkFBZ0IsVUFBVSxFQUFFLElBQWMsQ0FBQyxHQUFJLEVBQVUsT0FBTyx1Q0FBdUMsRUFBRSw4QkFBMkIsRUFBRSxLQUFLLDJCQUEyQixNQUFNLEVBQUUsSUFBSSxDQUFDLGVBQWUsRUFBRSxLQUFLLEVBQUUsSUFBSTtBQUU3VCxZQUFNLE9BQU8sRUFBRSxNQUFNO0FBQUcsV0FBSyxZQUFZO0FBQ3pDLFFBQUUsS0FBSyxRQUFRLENBQUMsTUFBYyxNQUFjO0FBQzFDLGNBQU0sS0FBSyxTQUFTLGNBQWMsS0FBSztBQUFHLGNBQU0sTUFBTUEsR0FBRSxPQUFPQSxHQUFFLElBQUksU0FBUyxVQUFVQSxHQUFFLElBQUksUUFBUTtBQUFHLGNBQU0sU0FBUyxVQUFVLEdBQUcsQ0FBQyxHQUFHLFdBQVcsRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFXLGlCQUFpQixHQUFHLEdBQUcsRUFBRSxFQUFFLENBQUMsR0FBRyxTQUFTLFVBQVU7QUFDL04sY0FBTSxNQUFNLE9BQU8sSUFBSTtBQUFHLFdBQUcsWUFBWSxVQUFVLE1BQU0sU0FBUyxPQUFPLE1BQU0sU0FBUyxPQUFPLENBQUMsVUFBVSxDQUFDQSxHQUFFLFdBQVcsU0FBUyxPQUFPQSxHQUFFLFdBQVcsVUFBVTtBQUMvSixjQUFNLE1BQU0sU0FBUyxtQ0FBbUMsV0FBVywwQ0FBMEM7QUFDN0csWUFBSSxJQUFLLElBQUcsTUFBTSxjQUFjLFlBQVksSUFBSTtBQUNoRCxXQUFHLFlBQVkscUJBQXFCLEtBQUssTUFBTSxDQUFDLENBQUMsU0FBUyxNQUFNLGFBQWEsSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJLG1CQUFtQixVQUFVLElBQUksQ0FBQyxRQUFRLG1CQUFtQixHQUFHO0FBQVUsV0FBRyxRQUFRLFVBQVUsSUFBSSxLQUFLLFNBQVMsS0FBSyxXQUFXLDhFQUE4RTtBQUNqVCxXQUFHLFVBQVUsTUFBTUEsR0FBRSxPQUFPLENBQUM7QUFBRyxhQUFLLFlBQVksRUFBRTtBQUFBLE1BQ3JELENBQUM7QUFDRCxVQUFJLENBQUMsRUFBRSxLQUFLLE9BQVEsTUFBSyxZQUFZO0FBRXJDLE1BQUMsRUFBRSxXQUFXLEVBQXdCLFdBQVcsQ0FBQyxTQUFTLENBQUMsRUFBRSxNQUFNO0FBQ3BFLFlBQU0sS0FBSyxFQUFFLFNBQVM7QUFBd0IsU0FBRyxXQUFXLENBQUMsU0FBUyxFQUFFO0FBQWEsU0FBRyxVQUFVLE9BQU8sTUFBTUEsR0FBRSxRQUFRO0FBQUcsU0FBRyxjQUFjLEVBQUUsY0FBYyxjQUFjQSxHQUFFLFdBQVcsOEJBQThCO0FBQ3ROLFlBQU0sT0FBT0EsR0FBRSxPQUFPQSxHQUFFLElBQUksU0FBUyxTQUFTLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBVyxFQUFFLE9BQU9BLEdBQUUsSUFBSSxFQUFFLElBQUk7QUFDNUYsWUFBTSxVQUFVLFFBQVEsRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFXLGlCQUFpQixNQUFNLENBQUMsQ0FBQztBQUMxRSxRQUFFLFdBQVcsRUFBRSxNQUFNLFVBQVUsU0FBUyxPQUFPLFNBQVM7QUFDeEQsUUFBRSxXQUFXLEVBQUUsY0FBY0EsR0FBRSxnQkFBZ0IsbUJBQW1CO0FBQ2xFLFFBQUUsTUFBTSxFQUFFLGNBQWMsUUFBU0EsR0FBRSxXQUFXLDRIQUMxQyxPQUFPLEdBQUcsVUFBVSxLQUFLLElBQWMsQ0FBQyxJQUFJLE1BQU0sS0FBSyxJQUFJLENBQUMsYUFBUSxVQUFVLEtBQUssSUFBYyxDQUFDLEtBQUssVUFBVSxnRUFBMkQsRUFBRSxLQUM5S0EsR0FBRSxPQUFPQSxHQUFFLElBQUksU0FBUyxTQUFTLEdBQUcsVUFBVSxFQUFFLEtBQUtBLEdBQUUsSUFBSSxHQUFHLENBQVcsQ0FBQyxLQUFLLFVBQVUsRUFBRSxLQUFLQSxHQUFFLElBQUksR0FBRyxDQUFXLENBQUMsZ0JBQVcsTUFBTTtBQUFFLGNBQU0sSUFBSUEsR0FBRSxJQUFJLEtBQUssS0FBSyxVQUFVLEdBQUcsQ0FBQyxHQUFHLEtBQUssRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFXLGlCQUFpQixHQUFHLEdBQUcsRUFBRSxFQUFFLENBQUM7QUFBRyxlQUFPLE1BQU0sS0FBSyx5RUFBeUUsS0FBSyxnQ0FBZ0MsS0FBSyxnRUFBZ0U7QUFBQSxNQUE0QyxHQUFHLElBQUkscUVBQ3hlLE9BQU8sWUFBWSxPQUFPLGVBQWUsc0NBQXNDO0FBQ25GLFFBQUUsT0FBTyxFQUFFLE1BQU0sVUFBVSxPQUFPLFlBQVksT0FBTyxlQUFlLFNBQVM7QUFDN0UsWUFBTSxPQUFPQSxHQUFFLGNBQWM7QUFBRyxVQUFJLENBQUMsUUFBUUEsR0FBRSxZQUFZLEVBQUcsQ0FBQUEsR0FBRSxZQUFZO0FBQzVFLFlBQU0sS0FBSyxFQUFFLFVBQVU7QUFBRyxTQUFHLE1BQU0sVUFBVSxPQUFPLEtBQUs7QUFBUSxTQUFHLGNBQWNBLEdBQUUsWUFBWTtBQUFLLFNBQUcsVUFBVSxPQUFPLE1BQU1BLEdBQUUsWUFBWSxDQUFDO0FBQzlJLGVBQVMsaUJBQThCLFlBQVksRUFBRSxRQUFRLENBQUMsTUFBTSxFQUFFLFVBQVUsT0FBTyxNQUFNLEVBQUUsUUFBUSxRQUFRQSxHQUFFLE9BQU8sQ0FBQztBQUN6SCxlQUFTLEtBQUssVUFBVSxPQUFPLFlBQVksT0FBTyxZQUFZLE9BQU8sWUFBWTtBQUFHLFlBQU0sUUFBUSxPQUFPLFlBQVksT0FBTyxlQUFlLFdBQVcsT0FBTztBQUU3SixZQUFNLEtBQUssRUFBRSxTQUFTO0FBQUcsU0FBRyxZQUFZO0FBQUksU0FBRyxZQUFZO0FBQzNELFVBQUksT0FBTyxXQUFXQSxHQUFFLE9BQU87QUFDN0IsV0FBRyxZQUFZO0FBQVEsV0FBRyxZQUFZLHlGQUF5RixFQUFFLEdBQUcsSUFBSUEsR0FBRSxXQUFXLDhCQUE4QixJQUFJQSxHQUFFLFFBQVEsQ0FBQyxRQUFRLFFBQVEsTUFBTSxDQUFDLEtBQUssRUFBRSxvQ0FBb0NBLEdBQUUsTUFBTSxJQUFJLENBQUMsTUFBYyxNQUFjLHVCQUF1QixPQUFPLElBQUksSUFBSSxTQUFTLEVBQUUsYUFBYSxDQUFDLElBQUksT0FBTyxJQUFJLElBQUksd0JBQXdCLFlBQVksSUFBSSxDQUFDLE1BQU0sRUFBRSxzQkFBc0IsS0FBSyxNQUFNLENBQUMsQ0FBQyxTQUFTLE9BQU8sSUFBSSxJQUFJLGFBQWEsSUFBSSxJQUFJLEtBQUssSUFBSSxDQUFDLG1CQUFtQixVQUFVLElBQUksQ0FBQywyQkFBMkIsVUFBVSxJQUFJLENBQUMsY0FBYyxFQUFFLEtBQUssRUFBRSxDQUFDO0FBQzltQixXQUFHLGlCQUE4QixPQUFPLEVBQUUsUUFBUSxDQUFDLE1BQU8sRUFBRSxVQUFVLE1BQU1BLEdBQUUsVUFBVSxDQUFDLEVBQUUsUUFBUSxDQUFFLENBQUU7QUFBQSxNQUN6RyxXQUFXLE9BQU8sU0FBUyxPQUFPLFFBQVE7QUFDeEMsY0FBTSxLQUFLLE9BQU8sUUFBUUEsR0FBRSxTQUFTLE1BQU0sS0FBSyxDQUFDLE1BQWMsVUFBVSxDQUFDO0FBQzFFLGNBQU0sYUFBYSxNQUFNLEdBQUcsWUFBWSxHQUFHLFNBQVMsU0FBUywwREFBMEQsUUFBUSxPQUFPLENBQUMsY0FBYyxHQUFHLFNBQVMsSUFBSSxDQUFDLE1BQWMsZUFBZSxDQUFDLENBQUMsRUFBRSxLQUFLLFFBQVUsQ0FBQyxXQUFXO0FBQ2xPLGNBQU0sV0FBV0EsR0FBRSxVQUFVLDBEQUEwRCxRQUFRLE1BQU0sQ0FBQywwQkFBMEIsSUFBSUEsR0FBRSxPQUFPLENBQUMsV0FBVztBQUN6SixjQUFNLEtBQUssT0FBTyxTQUFTQSxHQUFFLFFBQVFBLEdBQUUsY0FBYztBQUNyRCxjQUFNLFlBQVlBLEdBQUUsUUFBUyxLQUFLLDBEQUEwRCxHQUFHLE9BQU8sR0FBRyxRQUFRLE1BQU0sQ0FBQyxpQ0FBaUMsR0FBRyxDQUFDLENBQUMsa0JBQWtCLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxRQUFRLE1BQU0sQ0FBQyxNQUFNLHdFQUF3RSxXQUFXLEtBQU07QUFDOVMsY0FBTSxhQUFhLFdBQVcsWUFBWSxjQUFjLEtBQUssMERBQTBELEdBQUcsT0FBUSxHQUFHLFFBQVEsR0FBRyxRQUFRLE1BQU0sQ0FBQyw4QkFBOEIsR0FBRyxHQUFHLEtBQUssSUFBSSxDQUFDLGdCQUFnQixHQUFHLFFBQVEsTUFBTSxDQUFDLHFCQUFxQixHQUFHLEdBQUcsS0FBSyxJQUFJLENBQUMsZ0JBQWlCLG1CQUFtQixHQUFHLFdBQVcsSUFBSSxHQUFHLFlBQVksc0JBQXNCLFdBQVc7QUFDMVgsWUFBSSxPQUFPLFVBQVUsVUFBVSxLQUFLQSxHQUFFLFNBQVM7QUFDN0MsZ0JBQU0sSUFBSUEsR0FBRSxTQUFTLE1BQU0sRUFBRSxVQUFVLEVBQUU7QUFDekMsYUFBRyxZQUFZO0FBQVEsYUFBRyxZQUFZLGtFQUFrRSxFQUFFLE9BQU8sUUFBUSxFQUFFLFlBQVksSUFBSSxLQUFLLEdBQUcsS0FBSyxNQUFNLGlEQUFpRCxnQkFBZ0IsS0FBSyxJQUFJLEVBQUUsV0FBVyxFQUFFLE9BQU8sSUFBSSxHQUFHLFNBQVNBLEdBQUUsVUFBVSwwREFBMEQsUUFBUSxNQUFNLENBQUMsMEJBQTBCLElBQUlBLEdBQUUsT0FBTyxDQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUUsUUFBUSwwREFBMEQsUUFBUSxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUssYUFBYSxFQUFFLFVBQVUsSUFBSSxLQUFLLEdBQUcsNEJBQTRCLDJEQUEyRCxvQkFBb0IsRUFBRSxRQUFRLHNEQUFzRCxFQUFFLDZCQUE2QixFQUFFLFFBQVEsU0FBUyxJQUFJO0FBQy92QixZQUFFLE9BQU8sRUFBRSxVQUFVLE1BQU1BLEdBQUUsV0FBVztBQUFHLFlBQUUsUUFBUSxFQUFFLFVBQVUsTUFBTSxPQUFPLGNBQWMsSUFBSSxNQUFNLGVBQWUsQ0FBQztBQUN0SCxnQkFBTSxNQUFNLFNBQVMsZUFBZSxRQUFRO0FBQUcsY0FBSSxJQUFLLEtBQUksVUFBVSxNQUFNLE9BQU8sY0FBYyxJQUFJLE1BQU0sZUFBZSxDQUFDO0FBQUEsUUFDN0gsT0FBTztBQUNQLGFBQUcsWUFBWTtBQUFRLGFBQUcsWUFBWSx3QkFBd0JBLEdBQUUsUUFBUyxPQUFPLFFBQVEsb0JBQW9CLHFCQUFzQixPQUFPLFFBQVEsbUJBQW1CLFlBQVkseUJBQXlCQSxHQUFFLFVBQVUsU0FBUyxVQUFVLG9CQUFxQixNQUFNLEdBQUcsUUFBVSxNQUFNLEdBQUcsT0FBUSxzREFBc0QsRUFBRSw2QkFBOEIsTUFBTSxHQUFHLFFBQVUsTUFBTSxHQUFHLE9BQVEsU0FBUyxJQUFJLEtBQUssT0FBTyxRQUFRLGVBQWUsV0FBVztBQUN0ZCxZQUFFLE9BQU8sRUFBRSxVQUFVLE1BQU9BLEdBQUUsUUFBUUEsR0FBRSxTQUFTLElBQUlBLEdBQUUsT0FBTztBQUFJLFlBQUUsUUFBUSxFQUFFLFVBQVUsTUFBTSxPQUFPLGNBQWMsSUFBSSxNQUFNLGVBQWUsQ0FBQztBQUM3SSxnQkFBTSxLQUFLLFNBQVMsZUFBZSxRQUFRO0FBQUcsY0FBSSxHQUFJLElBQUcsVUFBVSxNQUFNLE9BQU8sY0FBYyxJQUFJLE1BQU0sZUFBZSxDQUFDO0FBQUEsUUFDeEg7QUFBQSxNQUNGO0FBQ0EsV0FBSyxnQkFBZ0I7QUFDckIsVUFBSSxPQUFPLFFBQVMsdUJBQXNCLE1BQU1BLEdBQUUsYUFBYSxDQUFDO0FBQUEsSUFDbEU7QUFBQTtBQUFBLElBR1EsY0FBYztBQUNwQixZQUFNQSxLQUFJLEtBQUssR0FBRyxJQUFJLEtBQUs7QUFBSyxVQUFJLENBQUMsRUFBRSxVQUFVLFNBQVMsTUFBTSxHQUFHO0FBQUUsVUFBRSxZQUFZO0FBQUk7QUFBQSxNQUFRO0FBQy9GLFlBQU0sTUFBTSxDQUFDLE9BQWUsS0FBVSxLQUFzQixLQUFhLEtBQWEsU0FBaUIsVUFBVSxLQUFLLDZCQUE2QixHQUFHLFVBQVUsR0FBRyxXQUFXLElBQUksWUFBWSxJQUFJLEdBQUcsQ0FBQyxhQUFhLEtBQUssV0FBVyxJQUFJLEdBQUcsQ0FBQztBQUMzTyxRQUFFLFlBQVk7QUFBQTtBQUFBLFVBRVIsSUFBSSxnQkFBVyxRQUFRLEtBQUssSUFBSSxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLGdCQUFXLFFBQVEsS0FBSyxJQUFJLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLElBQUksb0JBQWUsUUFBUSxLQUFLLEtBQUssR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxvQkFBZSxRQUFRLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLGdCQUFXLFFBQVEsS0FBSyxPQUFPLEdBQUcsR0FBRyxLQUFLLElBQUksQ0FBQyxHQUFHLElBQUksZ0JBQVcsUUFBUSxLQUFLLE9BQU8sR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDO0FBQUEsaUhBQzlNLE1BQU0sSUFBSSxDQUFDLE1BQU0sV0FBVyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQUMsTUFBTSxPQUFPLFlBQVksU0FBUyxPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0scUNBQXFDLENBQUMsYUFBYSxDQUFDLFlBQWEsUUFBUSxNQUFjLENBQUMsRUFBRSxDQUFDLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQztBQUFBLHdEQUMzUixDQUFDLFFBQVEsVUFBVSxRQUFRLFdBQVcsRUFBRSxJQUFJLENBQUMsTUFBTSxrQkFBa0IsQ0FBQyxLQUFLQSxHQUFFLGVBQWUsSUFBSSxhQUFhLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxLQUFLLEVBQUUsQ0FBQztBQUFBLHdFQUN6SEEsR0FBRSxFQUFFLE1BQU0sVUFBVSxvQkFBb0IsWUFBWSxFQUFFO0FBQUEsZ0lBQ0hBLEdBQUUsVUFBVSxZQUFZLEVBQUU7QUFBQSxpR0FDcEQsS0FBSyxJQUFJO0FBQUE7QUFBQSxzREFFcEQsTUFBTSxJQUFJLENBQUMsTUFBTSxrQkFBa0IsQ0FBQyxLQUFLLFVBQVUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxLQUFLLEVBQUUsQ0FBQztBQUFBLDZEQUNuRUEsR0FBRSxXQUFXO0FBQUEsc0NBQ3BDQSxHQUFFLElBQUk7QUFDeEMsUUFBRSxpQkFBbUMsbUJBQW1CLEVBQUUsUUFBUSxDQUFDLFFBQVMsSUFBSSxVQUFVLE1BQU07QUFDOUYsY0FBTSxNQUFNLElBQUksUUFBUTtBQUFJLGNBQU0sSUFBSSxDQUFDLElBQUk7QUFBTyxRQUFDLElBQUksbUJBQW1DLGNBQWMsT0FBTyxDQUFDO0FBQ2hILGNBQU0sTUFBa0MsRUFBRSxnQkFBVyxNQUFPLFFBQVEsS0FBSyxHQUFHLENBQUMsSUFBSSxHQUFJLGdCQUFXLE1BQU8sUUFBUSxLQUFLLEdBQUcsQ0FBQyxJQUFJLEdBQUksb0JBQWUsTUFBTyxRQUFRLEtBQUssSUFBSSxDQUFDLElBQUksR0FBSSxvQkFBZSxNQUFPLFFBQVEsS0FBSyxJQUFJLENBQUMsSUFBSSxHQUFJLGdCQUFXLE1BQU8sUUFBUSxLQUFLLE1BQU0sQ0FBQyxJQUFJLEdBQUksZ0JBQVcsTUFBTyxRQUFRLEtBQUssTUFBTSxDQUFDLElBQUksRUFBRztBQUMzVCxZQUFJLEdBQUcsRUFBRTtBQUFHLFFBQUFBLEdBQUUsbUJBQW1CO0FBQUEsTUFDbkMsQ0FBRTtBQUNGLFFBQUUsaUJBQW1DLFdBQVcsRUFBRSxRQUFRLENBQUMsUUFBUyxJQUFJLFdBQVcsTUFBTTtBQUFFLFFBQUMsUUFBUSxNQUFjLElBQUksUUFBUSxJQUFLLEVBQUUsSUFBSSxRQUFRLENBQUUsSUFBSSxDQUFDLElBQUk7QUFBQSxNQUFPLENBQUU7QUFDckssUUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLE1BQU1BLEdBQUUsaUJBQWtCLEVBQUUsT0FBNkIsS0FBSztBQUNyRixRQUFFLFlBQVksRUFBRSxXQUFXLENBQUMsTUFBTTtBQUFFLFFBQUFBLEdBQUUsRUFBRSxNQUFNLFFBQVMsRUFBRSxPQUE0QixVQUFVLG9CQUFvQjtBQUFnQixRQUFBQSxHQUFFLFVBQVU7QUFBRyxhQUFLLE9BQU87QUFBQSxNQUFHO0FBQ2pLLFFBQUUsT0FBTyxFQUFFLFVBQVUsTUFBTTtBQUFFLGNBQU0sSUFBSUEsR0FBRSxTQUFTLEdBQUc7QUFBRyxhQUFLLE9BQU8sR0FBRyxFQUFFLEdBQUcsVUFBVSxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsT0FBTyxjQUFjQSxHQUFFLEVBQUUsSUFBSTtBQUFJLFVBQUUsVUFBVSxFQUFFLGNBQWMsS0FBSztBQUFBLE1BQU07QUFDbkwsUUFBRSxPQUFPLEVBQUUsVUFBVSxNQUFNO0FBQUUsY0FBTSxJQUFJQSxHQUFFLE9BQU87QUFBRyxTQUFDLFVBQVUsWUFBWSxVQUFVLFVBQVUsVUFBVSxDQUFDLElBQUksUUFBUSxPQUFPLEdBQUcsS0FBSyxNQUFNLEtBQUssTUFBTSxvQ0FBb0MsQ0FBQyxFQUFFLE1BQU0sTUFBTTtBQUFFLGlCQUFPLHFCQUFxQixDQUFDO0FBQUEsUUFBRyxDQUFDO0FBQUEsTUFBRztBQUM5TyxRQUFFLE1BQU0sRUFBRSxXQUFXLENBQUMsTUFBTUEsR0FBRSxXQUFZLEVBQUUsT0FBNEIsT0FBTztBQUMvRSxRQUFFLE9BQU8sRUFBRSxVQUFVLE1BQU07QUFBRSxjQUFNLElBQUlBLEdBQUUsV0FBVztBQUFHLFNBQUMsVUFBVSxZQUFZLFVBQVUsVUFBVSxVQUFVLENBQUMsSUFBSSxRQUFRLE9BQU8sR0FBRyxLQUFLLE1BQU0sS0FBSyxNQUFNLHlDQUF5QyxDQUFDLEVBQUUsTUFBTSxNQUFNO0FBQUUsaUJBQU8scUJBQXFCLENBQUM7QUFBQSxRQUFHLENBQUM7QUFBQSxNQUFHO0FBQ3ZQLFFBQUUsUUFBUSxFQUFFLFVBQVUsTUFBTTtBQUFFLFFBQUFBLEdBQUUsZ0JBQWdCO0FBQUcsYUFBSyxZQUFZO0FBQUEsTUFBRztBQUN2RSxRQUFFLFVBQVUsRUFBRSxVQUFVLE1BQU1BLEdBQUUsV0FBV0EsR0FBRSxJQUFJO0FBQ2pELFFBQUUsTUFBTSxFQUFFLFVBQVUsTUFBTUEsR0FBRSxRQUFTLEVBQUUsT0FBTyxFQUF3QixLQUFlO0FBQUcsUUFBRSxNQUFNLEVBQUUsVUFBVSxNQUFNQSxHQUFFLFlBQVksQ0FBQztBQUFBLElBQ25JO0FBQUEsSUFDQSxrQkFBa0I7QUFDaEIsWUFBTSxJQUFJLFNBQVMsZUFBZSxRQUFRO0FBQUcsVUFBSSxFQUFHLEdBQUUsY0FBYyxHQUFHLEtBQUssRUFBRSxLQUFLO0FBQ25GLFlBQU0sS0FBSyxTQUFTLGVBQWUsU0FBUztBQUFHLFVBQUksSUFBSTtBQUFFLGNBQU0sSUFBSSxLQUFLLEVBQUUsU0FBUztBQUFHLFdBQUcsY0FBYyxHQUFHLEVBQUUsSUFBSSxRQUFRLENBQUMsQ0FBQyxpQkFBYyxFQUFFLElBQUksUUFBUSxDQUFDLENBQUMsa0JBQWUsRUFBRSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGlCQUFjLEVBQUUsTUFBTSxRQUFRLENBQUMsQ0FBQyxXQUFRLEVBQUUsTUFBTSxnQkFBYSxFQUFFLFNBQVMsMEJBQXVCLEVBQUUsS0FBSztBQUFBLE1BQWU7QUFDNVMsWUFBTSxJQUFJLFNBQVMsZUFBZSxRQUFRO0FBQUcsVUFBSSxFQUFHLEdBQUUsY0FBYyxLQUFLLEVBQUU7QUFBQSxJQUM3RTtBQUFBLEVBQ0Y7OztBQ3JHTyxNQUFNLE9BQU4sTUFBVztBQUFBLElBQVg7QUFDTDtBQUFhO0FBQVk7QUFBYTtBQUFZO0FBQ2xELG1DQUErQztBQUFNLHlDQUFrQztBQUN2RjtBQUFBLHNDQUFXO0FBQUcscUNBQVU7QUFDeEI7QUFBQTtBQUFXLGtDQUFPO0FBQUcscUNBQVU7QUFBRyxtQ0FBZTtBQUFTLG9DQUF3QjtBQUFNLHVDQUFZO0FBQ3BHLGlDQUFXO0FBQU0sc0NBQVc7QUFBTywyQ0FBZ0I7QUFBTyxtQ0FBeUI7QUFBTSx3Q0FBYTtBQUN0RywwQkFBUSxXQUFVLG9CQUFJLElBQXdCO0FBQzlDO0FBQUEsMEJBQVEsYUFBWSxvQkFBSSxJQUF3QjtBQUNoRCwwQkFBUSxRQUFPLG9CQUFJLElBQXdCO0FBQzNDO0FBQUEsMEJBQVEsU0FBUSxvQkFBSSxJQUFvQjtBQUN4QztBQUFBLDBCQUFRLGFBQVksb0JBQUksSUFBb0I7QUFDNUMsMEJBQVE7QUFDUiwwQkFBUSxTQUFlLENBQUM7QUFBRywwQkFBUSxZQUFrQixDQUFDO0FBQUcsMEJBQVEsVUFBZ0IsQ0FBQztBQUFHLDBCQUFRLFVBQWdCLENBQUM7QUFBRywwQkFBUSxVQUEwQyxDQUFDO0FBQ3BLLDBCQUFRLE9BQU07QUFBRywwQkFBUSxXQUFlO0FBQU0sMEJBQVEsU0FBYTtBQUFNLDBCQUFRLFFBQU87QUFBRywwQkFBUSxVQUFTO0FBQUssMEJBQVEsWUFBVztBQUFJLDBCQUFRLFdBQVU7QUFBTywwQkFBUSxlQUFjO0FBQ3ZMLDBCQUFRLGFBQW1CLENBQUM7QUFBRywwQkFBUSxhQUFtQixDQUFDO0FBQzNEO0FBRUE7QUFBQSxvQ0FBNkI7QUFFN0I7QUFBQSxxQ0FBd0U7QUFDeEUsMEJBQVEsUUFBTztBQUNmO0FBQUEsMEJBQVEsVUFBbUYsQ0FBQztBQUk1RiwwQkFBUSxjQUFhO0FBc0NyQjtBQUFBLDBCQUFRLFVBQVM7QUFFakI7QUFBQSxvQ0FBUztBQUtUO0FBQUEsMEJBQVEsY0FBNkg7QUF3RnJJLDBCQUFRO0FBQTRCLDBCQUFRLFNBQVE7QUFBRywwQkFBUSxTQUFRO0FBQUcseUNBQWM7QUFrQnhGO0FBQUEscUNBQTRCO0FBQVMsMEJBQVEsVUFBYyxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssQ0FBQztBQTJDeEY7QUFBQSxxQ0FBVTtBQUFPLHFDQUFVLEVBQUUsS0FBSyxHQUFHLEtBQUssR0FBRyxLQUFLLEdBQUcsT0FBTyxFQUFFO0FBQUcscUNBQWlCLENBQUM7QUFDbkYsMEJBQVEsV0FBVSxJQUFJLGFBQWEsR0FBRztBQUFHLDBCQUFRLFNBQVE7QUFBRywwQkFBUSxTQUFRO0FBQUcsMEJBQVEsZUFBYztBQUFHLDBCQUFRLFNBQWE7QUFBTSwwQkFBUSxVQUE2QjtBQUN4SywwQkFBUSxhQUFnRztBQTBNeEcsMEJBQVEsYUFBbUIsQ0FBQztBQUFBO0FBQUEsSUFqWnBCLE1BQU0sS0FBYSxJQUF5QixNQUFtQjtBQUFFLFdBQUssT0FBTyxLQUFLLEVBQUUsR0FBRyxHQUFHLEtBQUssSUFBSSxLQUFLLENBQUM7QUFBQSxJQUFHO0FBQUE7QUFBQSxJQUU1RyxjQUFjO0FBQUUsaUJBQVcsS0FBSyxLQUFLLE9BQU8sT0FBTyxDQUFDLEdBQUc7QUFBRSxVQUFFLEdBQUcsQ0FBQztBQUFHLFlBQUksRUFBRSxLQUFNLEdBQUUsS0FBSztBQUFBLE1BQUc7QUFBQSxJQUFFO0FBQUEsSUFHbEcsTUFBTSxLQUFLLFFBQTJCO0FBQ3BDLFlBQU0sS0FBSyxJQUFJLGdCQUFnQixTQUFTLE1BQU07QUFDOUMsV0FBSyxTQUFTLElBQUksUUFBUSxPQUFPLFFBQVEsTUFBTSxFQUFFLFdBQVcsTUFBTSxpQkFBaUIsbUJBQW1CLENBQUM7QUFDdkcsWUFBTSxNQUFNLE9BQU8sb0JBQW9CO0FBQUcsV0FBSyxPQUFPLHdCQUF3QixJQUFJLEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQztBQUNwRyxZQUFNLFFBQVEsS0FBSyxRQUFRLElBQUksUUFBUSxNQUFNLEtBQUssTUFBTTtBQUFHLFlBQU0sYUFBYSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sTUFBTSxDQUFDO0FBQ3BILFlBQU0sT0FBTyxJQUFJLFFBQVEsaUJBQWlCLEtBQUssSUFBSSxRQUFRLFFBQVEsS0FBSyxHQUFHLEdBQUcsR0FBRyxLQUFLO0FBQUcsV0FBSyxZQUFZO0FBQU0sV0FBSyxjQUFjLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxJQUFJO0FBQ3RLLFlBQU0sTUFBTSxJQUFJLFFBQVEsaUJBQWlCLEtBQUssSUFBSSxRQUFRLFFBQVEsTUFBTSxJQUFJLElBQUksR0FBRyxLQUFLO0FBQUcsVUFBSSxZQUFZO0FBQzNHLFdBQUssU0FBUyxJQUFJLFFBQVEsV0FBVyxPQUFPLElBQUksUUFBUSxRQUFRLEdBQUcsR0FBRyxFQUFFLEdBQUcsS0FBSztBQUFHLFdBQUssT0FBTyxPQUFPO0FBQUssV0FBSyxPQUFPLE9BQU87QUFBSyxXQUFLLE9BQU8sTUFBTTtBQUFLLFdBQUssT0FBTyxPQUFPLE1BQU07QUFFbkwsWUFBTSxTQUFTLFFBQVEsWUFBWSxhQUFhLFVBQVUsRUFBRSxPQUFPLElBQUksUUFBUSxHQUFHLEdBQUcsS0FBSztBQUMxRixhQUFPLGFBQWE7QUFBTyxZQUFNLFFBQVEsS0FBSyxRQUFRLFdBQVcsT0FBTyxNQUFNO0FBQUcsWUFBTSx5QkFBeUIsSUFBSSxNQUFNLE1BQU0sT0FBTyxZQUFZLElBQUksSUFBSSxHQUFJLENBQUM7QUFDaEssaUJBQVcsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFZLFVBQVMsSUFBSSxHQUFHLElBQUksWUFBWSxLQUFLO0FBQUUsY0FBTSxJQUFJLEtBQUssU0FBUyxNQUFNLENBQUM7QUFBRyxZQUFJLFNBQVMsRUFBRyxNQUFLLE1BQU0sS0FBSyxDQUFDO0FBQUEsWUFBUSxHQUFFLFdBQVcsS0FBSztBQUFBLE1BQUc7QUFFM0ssV0FBSyxJQUFJLE1BQU0sV0FBVyxLQUFLO0FBQy9CLFdBQUssUUFBUSxJQUFJLFlBQVksT0FBTyxLQUFLLEVBQUUsTUFBTSxLQUFLLEVBQUUsS0FBSztBQUM3RCxXQUFLLE1BQU0sT0FBTyxTQUFTLElBQUksRUFBRSxXQUFXLFlBQVksS0FBSyxXQUFXLE1BQU0sR0FBRyxDQUFDO0FBQUcsV0FBSyxNQUFNLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUM5SCxXQUFLLFlBQVksQ0FBQyxHQUFHLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTTtBQUFFLGNBQU0sSUFBSSxJQUFJLFFBQVEsaUJBQWlCLE9BQU8sR0FBRyxLQUFLO0FBQUcsVUFBRSxlQUFlLFFBQVEsT0FBTyxNQUFNO0FBQUcsVUFBRSxnQkFBZ0IsTUFBTSxJQUFJLElBQUksUUFBUSxPQUFPLE1BQU0sS0FBSyxDQUFDLElBQUksSUFBSSxRQUFRLE9BQU8sR0FBRyxLQUFLLElBQUk7QUFBRyxVQUFFLGtCQUFrQjtBQUFNLGVBQU87QUFBQSxNQUFHLENBQUM7QUFDN1EsV0FBSyxLQUFLLElBQUksR0FBRyxJQUFJO0FBQUcsV0FBSyxPQUFPLEVBQUUsR0FBRyxJQUFJLE1BQU0sS0FBSztBQUFJLFVBQUksR0FBRyxJQUFJLEtBQUssRUFBRyxNQUFLLFdBQVcsSUFBSTtBQUduRyxVQUFJLE9BQW1EO0FBQ3ZELFlBQU0sUUFBUSxDQUFDLE1BQW9CO0FBQUUsY0FBTSxJQUFJLE9BQU8sc0JBQXNCO0FBQUcsZUFBTyxFQUFFLEdBQUcsRUFBRSxVQUFVLEVBQUUsTUFBTSxHQUFHLEVBQUUsVUFBVSxFQUFFLElBQUk7QUFBQSxNQUFHO0FBQ3ZJLGFBQU8saUJBQWlCLGVBQWUsQ0FBQyxNQUFNO0FBQUUsZUFBTyxFQUFFLEdBQUcsTUFBTSxDQUFDLEdBQUcsR0FBRyxZQUFZLElBQUksRUFBRTtBQUFBLE1BQUcsQ0FBQztBQUMvRixhQUFPLGlCQUFpQixhQUFhLENBQUMsTUFBTTtBQUFFLFlBQUksQ0FBQyxLQUFNO0FBQVEsY0FBTSxJQUFJLE1BQU0sQ0FBQztBQUFHLGNBQU0sUUFBUSxLQUFLLE1BQU0sRUFBRSxJQUFJLEtBQUssR0FBRyxFQUFFLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxZQUFZLElBQUksSUFBSSxLQUFLO0FBQUcsZUFBTztBQUFNLFlBQUksUUFBUSxNQUFNLEtBQUssSUFBSyxNQUFLLElBQUksRUFBRSxHQUFHLEVBQUUsQ0FBQztBQUFBLE1BQUcsQ0FBQztBQUMxTyxhQUFPLGlCQUFpQixpQkFBaUIsTUFBTTtBQUFFLGVBQU87QUFBQSxNQUFNLENBQUM7QUFDL0QsV0FBSyxTQUFTO0FBQVEsWUFBTSxXQUFXLE1BQU0sS0FBSyxhQUFhO0FBQy9ELGFBQU8saUJBQWlCLFVBQVUsUUFBUTtBQUFHLGFBQU8saUJBQWlCLHFCQUFxQixNQUFNLFdBQVcsVUFBVSxHQUFHLENBQUM7QUFDekgsVUFBSyxPQUFlLGVBQWdCLENBQUMsT0FBZSxlQUFlLGlCQUFpQixVQUFVLFFBQVE7QUFDdEcsVUFBSyxPQUFlLGVBQWdCLEtBQUssT0FBZSxlQUFlLFFBQVEsRUFBRSxRQUFRLE1BQU07QUFDL0YsVUFBSSxHQUFHLElBQUksU0FBUyxHQUFHO0FBQUUsYUFBSyxRQUFRO0FBQUc7QUFBQSxNQUFRO0FBQ2pELFlBQU0sUUFBUSxHQUFHLElBQUksTUFBTSxJQUFJLE9BQU8sUUFBUTtBQUM5QyxVQUFJLE1BQU8sTUFBSyxRQUFRLEtBQUs7QUFBQSxVQUFRLE1BQUssV0FBVyxLQUFLLElBQUk7QUFDOUQsVUFBSSxPQUFPLFlBQVksSUFBSTtBQUMzQixXQUFLLE9BQU8sY0FBYyxNQUFNO0FBQUUsY0FBTSxNQUFNLFlBQVksSUFBSSxHQUFHLE1BQU0sTUFBTTtBQUFNLGNBQU0sS0FBSyxLQUFLLElBQUksTUFBTSxNQUFNLEdBQUk7QUFBRyxlQUFPO0FBQUssWUFBSSxDQUFDLEtBQUssT0FBUTtBQUFRLFlBQUksS0FBSyxXQUFZLE1BQUssYUFBYSxFQUFFO0FBQUEsaUJBQVksQ0FBQyxLQUFLLE9BQVEsTUFBSyxNQUFNLEVBQUU7QUFBRyxjQUFNLE9BQU87QUFBRyxhQUFLLFNBQVMsR0FBRztBQUFBLE1BQUcsQ0FBQztBQUFBLElBQzFSO0FBQUEsSUFLQSxLQUFLLElBQVk7QUFBRSxXQUFLLE1BQU0sRUFBRTtBQUFBLElBQUc7QUFBQSxJQUNuQyxVQUFVLElBQWE7QUFBRSxXQUFLLFNBQVM7QUFBQSxJQUFJO0FBQUE7QUFBQSxJQUszQyxRQUFRLE1BQWM7QUFDcEIsVUFBSSxDQUFDLEtBQUssS0FBSyxLQUFLLFdBQVk7QUFDaEMsWUFBTSxTQUFnQixDQUFDO0FBQUcsWUFBTSxPQUFPLENBQUMsTUFBVztBQUFFLFlBQUksS0FBSyxFQUFFLGFBQWEsRUFBRSxVQUFVLEdBQUc7QUFBRSxZQUFFLFdBQVcsS0FBSztBQUFHLGlCQUFPLEtBQUssQ0FBQztBQUFBLFFBQUc7QUFBQSxNQUFFO0FBQ3JJLGlCQUFXQyxNQUFLLEtBQUssUUFBUSxPQUFPLEVBQUcsTUFBS0EsR0FBRSxNQUFNO0FBQUcsV0FBSyxLQUFLLFFBQVEsQ0FBQ0EsT0FBTSxLQUFLQSxHQUFFLE1BQU0sQ0FBQztBQUFHLFVBQUksS0FBSyxNQUFNLE9BQU8sVUFBVSxHQUFHO0FBQUUsYUFBSyxNQUFNLFdBQVcsS0FBSztBQUFHLGVBQU8sS0FBSyxFQUFFLFlBQVksQ0FBQyxPQUFnQixLQUFLLE1BQU0sV0FBVyxFQUFFLEVBQUUsQ0FBQztBQUFBLE1BQUc7QUFBRSxXQUFLLE9BQU8sUUFBUSxDQUFDLE1BQU0sS0FBSyxFQUFFLENBQUMsQ0FBQztBQUFHLFdBQUssT0FBTyxRQUFRLENBQUMsTUFBTSxLQUFLLEVBQUUsSUFBSSxDQUFDO0FBQzdULFlBQU0sT0FBTyxLQUFLLE1BQU0sU0FBUyxLQUFLLEtBQUssTUFBTSxDQUFDLEVBQUUsVUFBVTtBQUFHLFdBQUssU0FBUyxLQUFLO0FBQ3BGLFlBQU0sSUFBSSxhQUFhLEtBQUssR0FBRyxNQUFNLEdBQUcsQ0FBQztBQUFHLFlBQU0sSUFBSSxFQUFFLEdBQUcsSUFBSSxHQUFHLEVBQUU7QUFBRyxRQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUFHLFFBQUUsT0FBTyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQU0sUUFBRSxLQUFLLE1BQU07QUFDOUosV0FBSyxhQUFhLEVBQUUsTUFBTSxHQUFHLE1BQU0sR0FBRyxNQUFNLEdBQUcsTUFBTSxNQUFNLFFBQVEsS0FBSztBQUN4RSxlQUFTLEtBQUssVUFBVSxJQUFJLFNBQVM7QUFDckMsV0FBSyxPQUFPLE1BQU07QUFBTSxXQUFLLE9BQU8sU0FBUyxJQUFJLEVBQUUsR0FBRyxNQUFNLEVBQUUsSUFBSSxHQUFHO0FBQUcsV0FBSyxPQUFPLFVBQVUsSUFBSSxRQUFRLFFBQVEsRUFBRSxHQUFHLE1BQU0sRUFBRSxDQUFDLENBQUM7QUFDakksV0FBSyxpQkFBaUI7QUFBQSxJQUN4QjtBQUFBLElBQ0EsYUFBYTtBQUNYLFlBQU0sSUFBSSxLQUFLO0FBQVksVUFBSSxDQUFDLEVBQUc7QUFDbkMsUUFBRSxFQUFFLFFBQVE7QUFBRyxRQUFFLE9BQU8sUUFBUSxDQUFDLE1BQU0sRUFBRSxXQUFXLElBQUksQ0FBQztBQUFHLFdBQUssU0FBUyxFQUFFLFFBQVEsS0FBSyxVQUFVLE9BQU87QUFDMUcsV0FBSyxhQUFhO0FBQU0sZUFBUyxLQUFLLFVBQVUsT0FBTyxTQUFTO0FBQUcsWUFBTSxNQUFNLFNBQVMsZUFBZSxZQUFZO0FBQUcsVUFBSSxJQUFLLEtBQUksWUFBWTtBQUMvSSxXQUFLLE9BQU8sTUFBTTtBQUFLLFdBQUssT0FBTyxLQUFLLE1BQU0sRUFBRSxLQUFLO0FBQUEsSUFDdkQ7QUFBQSxJQUNRLGFBQWEsSUFBWTtBQUMvQixZQUFNLElBQUksS0FBSztBQUFhLFFBQUUsRUFBRSxPQUFPLEVBQUU7QUFBRyxVQUFJLEVBQUUsS0FBTSxHQUFFLEVBQUUsT0FBTyxTQUFTLEtBQUssS0FBSztBQUN0RixXQUFLLE1BQU0sT0FBTyxZQUFZLElBQUksSUFBSSxHQUFJO0FBQUEsSUFDNUM7QUFBQSxJQUNRLG1CQUFtQjtBQUN6QixZQUFNLElBQUksS0FBSztBQUFZLFlBQU0sTUFBTSxTQUFTLGVBQWUsWUFBWTtBQUFHLFVBQUksQ0FBQyxLQUFLLENBQUMsSUFBSztBQUM5RixZQUFNLE9BQU8sQ0FBQyxNQUFXO0FBbEk3QjtBQWtJaUMsdUJBQUUsT0FBTyxXQUFXLFFBQVEsVUFBVSxPQUFPLFNBQVMsT0FBTyxPQUFPLEVBQVUsQ0FBQyxNQUEvRSxZQUFvRixFQUFFLFFBQVEsbUJBQW1CLE9BQU87QUFBQTtBQUNySixZQUFNLFNBQVMsRUFBRSxFQUFFLFlBQVksRUFBRSxFQUFFLFVBQVUsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sc0JBQXNCLENBQUMsS0FBSyxLQUFLLENBQUMsQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFO0FBQ3ZILFVBQUksWUFBWSw4RUFBOEUsVUFBVSxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxzQkFBc0IsQ0FBQyxZQUFZLEVBQUUsU0FBUyxJQUFJLE9BQU8sRUFBRSxLQUFLLENBQUMsaUJBQWlCLEVBQUUsS0FBSyxFQUFFLENBQUMsOEJBQThCLEVBQUUsT0FBTyxPQUFPLEVBQUUsc0RBQXNELEVBQUUsT0FBTyxPQUFPLEVBQUUsNENBQTRDLEtBQUs7QUFDaFosVUFBSSxpQkFBOEIsYUFBYSxFQUFFLFFBQVEsQ0FBQyxNQUFPLEVBQUUsVUFBVSxNQUFNO0FBQUUsY0FBTSxLQUFLLEtBQUs7QUFBRyxVQUFFLEVBQUUsZUFBZSxFQUFFLEVBQUUsWUFBWSxFQUFFLFFBQVEsSUFBSztBQUFBLE1BQUcsQ0FBRTtBQUMvSixVQUFJLGlCQUE4QixhQUFhLEVBQUUsUUFBUSxDQUFDLE1BQU8sRUFBRSxVQUFVLE1BQU07QUFBRSxVQUFFLE9BQU8sQ0FBQyxFQUFFLFFBQVE7QUFBTyxVQUFFLEVBQUUsUUFBUSxFQUFFLElBQUk7QUFBRyxhQUFLLGlCQUFpQjtBQUFBLE1BQUcsQ0FBRTtBQUNoSyxNQUFDLFNBQVMsZUFBZSxRQUFRLEVBQWtCLFVBQVUsTUFBTTtBQUFFLFVBQUUsT0FBTyxFQUFFLE9BQU8sSUFBSTtBQUFHLFVBQUUsRUFBRSxRQUFRLEVBQUUsSUFBSTtBQUFHLGFBQUssaUJBQWlCO0FBQUEsTUFBRztBQUM1SSxNQUFDLFNBQVMsZUFBZSxRQUFRLEVBQWtCLFVBQVUsTUFBTTtBQUFFLFVBQUUsT0FBTyxDQUFDLEVBQUU7QUFBTSxhQUFLLGlCQUFpQjtBQUFBLE1BQUc7QUFDaEgsTUFBQyxTQUFTLGVBQWUsUUFBUSxFQUFrQixVQUFVLE1BQU0sT0FBTyxjQUFjLElBQUksTUFBTSxnQkFBZ0IsQ0FBQztBQUFBLElBQ3JIO0FBQUE7QUFBQTtBQUFBLElBSVEsU0FBUyxJQUFhO0FBQUUsaUJBQVcsS0FBSyxLQUFLLE1BQU8sR0FBRSxXQUFXLEVBQUU7QUFBQSxJQUFHO0FBQUEsSUFDdEUsU0FBUyxNQUFhLE1BQWM7QUFDMUMsWUFBTSxJQUFJLFFBQVEsTUFBTSxJQUFJLEdBQUcsSUFBSSxRQUFRLFlBQVksWUFBWSxTQUFTLE1BQU0sRUFBRSxNQUFNLFVBQVUsS0FBSyxHQUFHLEtBQUssS0FBSztBQUN0SCxRQUFFLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxRQUFFLFNBQVMsSUFBSSxFQUFFLEdBQUcsT0FBTyxFQUFFLENBQUM7QUFDMUQsWUFBTSxJQUFJLElBQUksUUFBUSxpQkFBaUIsTUFBTSxLQUFLLEtBQUs7QUFBRyxRQUFFLGVBQWUsUUFBUSxPQUFPLE1BQU07QUFBRyxRQUFFLGdCQUFnQixTQUFTLElBQUksSUFBSSxRQUFRLE9BQU8sTUFBTSxNQUFNLElBQUksSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLE1BQU0sSUFBSTtBQUFHLFFBQUUsUUFBUTtBQUFLLFFBQUUsa0JBQWtCO0FBQU0sUUFBRSxXQUFXO0FBQ3JRLFVBQUksU0FBUyxHQUFHO0FBQUUsVUFBRSxXQUFXLEVBQUUsTUFBTSxRQUFRLEtBQUs7QUFBRyxhQUFLLFNBQVMsSUFBSSxJQUFJO0FBQUEsTUFBRyxNQUFPLEdBQUUsYUFBYTtBQUN0RyxhQUFPO0FBQUEsSUFDVDtBQUFBLElBQ1EsS0FBSyxNQUFjLE1BQTZDO0FBQ3RFLFlBQU0sSUFBSSxLQUFLLFNBQVMsSUFBSTtBQUFHLFlBQU0sSUFBSSxFQUFFLFFBQVEsQ0FBQyxNQUFNLE1BQU0sTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLEtBQUssTUFBTSxNQUFNLEdBQUcsR0FBRyxLQUFLLENBQUMsR0FBRyxNQUFNLEtBQUssSUFBSSxHQUFHLFNBQVMsQ0FBQyxNQUFNLE1BQU0sR0FBRyxJQUFJLEVBQUUsRUFBRSxJQUFJO0FBQzFLLFFBQUUsZ0JBQWdCLElBQUksUUFBUSxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQUcsUUFBRSxRQUFRLEVBQUUsQ0FBQztBQUFBLElBQ3ZFO0FBQUEsSUFDQSxNQUFNLEtBQWEsSUFBZ0I7QUFBRSxXQUFLLE9BQU8sS0FBSyxFQUFFLEdBQUcsS0FBSyxHQUFHLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDL0QsT0FBTyxHQUFXLEdBQVcsT0FBWSxJQUFZLElBQVksS0FBYTtBQUNwRixZQUFNLElBQUksUUFBUSxZQUFZLFlBQVksTUFBTSxFQUFFLFVBQVUsR0FBRyxXQUFXLE9BQU8sY0FBYyxHQUFHLEdBQUcsS0FBSyxLQUFLO0FBQUcsUUFBRSxTQUFTLElBQUksR0FBRyxNQUFNLENBQUM7QUFBRyxRQUFFLGFBQWE7QUFDN0osWUFBTSxLQUFLLElBQUksUUFBUSxpQkFBaUIsT0FBTyxLQUFLLEtBQUs7QUFBRyxTQUFHLGdCQUFnQjtBQUFPLFNBQUcsa0JBQWtCO0FBQU0sU0FBRyxRQUFRO0FBQUssUUFBRSxXQUFXO0FBQUksV0FBSyxPQUFPLEtBQUssRUFBRSxHQUFHLElBQUksR0FBRyxHQUFHLElBQUksSUFBSSxJQUFJLENBQUM7QUFBQSxJQUNqTTtBQUFBLElBQ1EsTUFBTSxHQUFXLEdBQVcsSUFBYyxJQUFjLE9BQWU7QUFDN0UsWUFBTSxLQUFLLElBQUksUUFBUSxlQUFlLEtBQUssSUFBSSxLQUFLLEtBQUs7QUFBRyxTQUFHLGtCQUFrQixLQUFLLEVBQUU7QUFBTSxTQUFHLFVBQVUsSUFBSSxRQUFRLFFBQVEsR0FBRyxNQUFNLENBQUM7QUFBRyxTQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBRyxTQUFHLGFBQWEsSUFBSSxRQUFRLFFBQVEsS0FBSyxNQUFNLEdBQUc7QUFDbFAsU0FBRyxTQUFTLElBQUksUUFBUSxPQUFPLEdBQUksRUFBdUM7QUFBRyxTQUFHLFNBQVMsSUFBSSxRQUFRLE9BQU8sR0FBSSxFQUF1QztBQUFHLFNBQUcsWUFBWSxJQUFJLFFBQVEsT0FBTyxLQUFLLEdBQUcsS0FBSyxDQUFDO0FBQzFNLFNBQUcsVUFBVTtBQUFNLFNBQUcsVUFBVTtBQUFNLFNBQUcsY0FBYztBQUFLLFNBQUcsY0FBYztBQUFLLFNBQUcsV0FBVztBQUFHLFNBQUcsa0JBQWtCO0FBQU8sU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLElBQUksS0FBSyxFQUFFO0FBQUcsU0FBRyxhQUFhLElBQUksUUFBUSxRQUFRLEdBQUcsS0FBSyxDQUFDO0FBQzlOLFNBQUcsZUFBZTtBQUFLLFNBQUcsZUFBZTtBQUFHLFNBQUcsVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLElBQUksQ0FBQztBQUFHLFNBQUcsWUFBWSxRQUFRLGVBQWU7QUFBZSxTQUFHLHFCQUFxQjtBQUFLLFNBQUcsZ0JBQWdCO0FBQU0sU0FBRyxNQUFNO0FBQUEsSUFDOU07QUFBQTtBQUFBLElBR1EsUUFBUTtBQUNkLFlBQU0sTUFBTSxLQUFLLE9BQU8sZUFBZSxJQUFJLEtBQUssT0FBTyxnQkFBZ0IsR0FBRyxPQUFPLEtBQUssSUFBSSxLQUFLLE9BQU8sTUFBTSxDQUFDO0FBQzdHLFlBQU0sT0FBTyxXQUFXLFlBQVksS0FBSyxVQUFVO0FBQ25ELFlBQU0sSUFBSSxLQUFLLElBQUksUUFBUSxPQUFPLE9BQVEsWUFBWSxVQUFXLElBQUksTUFBTSxPQUFPLE9BQU8sQ0FBQztBQUMxRixZQUFNLFNBQVMsRUFBRSxLQUFLLElBQUksUUFBUSxRQUFRLE9BQU8sR0FBRyxPQUFPLElBQUksS0FBSyxRQUFRLENBQUMsR0FBRyxLQUFLLElBQUksUUFBUSxRQUFRLEdBQUcsTUFBTSxDQUFDLEVBQUU7QUFFckgsWUFBTSxLQUFLLEVBQUUsV0FBWSxZQUFZLEtBQUssVUFBVyxJQUFJLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLFlBQVk7QUFDakcsWUFBTSxNQUFNLENBQUMsT0FBZTtBQUFFLGNBQU0sS0FBSyxTQUFTLGVBQWUsRUFBRTtBQUFHLGVBQU8sTUFBTSxHQUFHLGlCQUFpQixPQUFPLEdBQUcsc0JBQXNCLElBQUk7QUFBQSxNQUFNO0FBQ2pKLFlBQU0sU0FBUyxJQUFJLEtBQUssR0FBRyxPQUFPLElBQUksTUFBTSxHQUFHLE9BQU8sSUFBSSxNQUFNO0FBQ2hFLFlBQU0sTUFBTSxLQUFLLElBQUksTUFBTSxVQUFVLE9BQU8sU0FBUyxLQUFLLElBQUksR0FBRztBQUNqRSxZQUFNLFNBQVMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLElBQUksT0FBTyxLQUFLLE1BQU0sR0FBRyxPQUFPLEtBQUssTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDO0FBQzdGLFlBQU0sT0FBTyxLQUFLLElBQUksS0FBSyxJQUFJLE1BQU0sTUFBTSxHQUFHLGFBQWEsTUFBTSxPQUFPO0FBQ3hFLFlBQU0sS0FBSyxZQUFZLFVBQVUsS0FBSyxLQUFLLFlBQVksVUFBVTtBQUNqRSxZQUFNLEtBQUssS0FBSyxJQUFJLE1BQU0sSUFBSSxPQUFPLE9BQU8sTUFBTSxJQUFJLE9BQU8sTUFBTSxPQUFPLEdBQUc7QUFDN0UsWUFBTSxTQUFTLE1BQU0sY0FBYyxJQUFJLEtBQUssTUFBTSxLQUFLLEtBQUs7QUFDNUQsWUFBTSxRQUFRLEVBQUUsS0FBSyxJQUFJLFFBQVEsUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLE1BQU0sRUFBRSxHQUFHLEtBQUssSUFBSSxRQUFRLFFBQVEsSUFBSSxHQUFHLENBQUMsS0FBSyxFQUFFO0FBQzdHLFlBQU0sUUFBUSxFQUFFLEtBQUssSUFBSSxRQUFRLFFBQVEsT0FBTyxJQUFJLElBQUksS0FBSyxPQUFPLElBQUksSUFBSSxNQUFNLE9BQU8sSUFBSSxJQUFJLElBQUksR0FBRyxLQUFLLElBQUksUUFBUSxRQUFRLE1BQU0sTUFBTSxDQUFDLEVBQUU7QUFDaEosYUFBTyxFQUFFLFFBQVEsT0FBTyxNQUFNO0FBQUEsSUFDaEM7QUFBQTtBQUFBLElBRUEsZUFBZTtBQUNiLFVBQUksS0FBSyxVQUFVLFdBQVcsS0FBSyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsS0FBSyxPQUFRO0FBQzFFLFlBQU0sSUFBSSxLQUFLLE1BQU0sRUFBRSxPQUFPLElBQUksS0FBSyxPQUFPO0FBQzlDLFVBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEtBQUssUUFBUSxRQUFRLFNBQVMsR0FBRyxFQUFFLEdBQUcsSUFBSSxLQUFNO0FBQ3JFLFdBQUssU0FBUyxHQUFHLElBQUk7QUFBQSxJQUN2QjtBQUFBLElBRVEsZUFBZTtBQUNyQixVQUFJLENBQUMsS0FBSyxPQUFPLGVBQWUsQ0FBQyxLQUFLLE9BQU8sYUFBYztBQUMzRCxXQUFLLE9BQU8sT0FBTztBQUFHLFdBQUssUUFBUSxLQUFLLE9BQU87QUFBYSxXQUFLLFFBQVEsS0FBSyxPQUFPO0FBQ3JGLFVBQUksS0FBSyxVQUFVLFdBQVcsS0FBSyxRQUFRLEVBQUcsTUFBSyxPQUFPLEtBQUssTUFBTSxFQUFFLEtBQUs7QUFBQSxJQUM5RTtBQUFBO0FBQUEsSUFFUSxJQUFJLEdBQVcsR0FBVztBQUNoQyxZQUFNLElBQUksS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsTUFBVyxDQUFDLEVBQUUsRUFBRSxZQUFZLEVBQUUsU0FBUyxLQUFLO0FBQzdFLFlBQU0sS0FBSyxLQUFLLEVBQUUsTUFBTSxFQUFFLFdBQVcsV0FBVztBQUNoRCxXQUFLLGNBQWMsT0FBTyxLQUFLLE1BQU0sQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLENBQUMsQ0FBQyxPQUFPLEtBQUssT0FBTyxXQUFXLElBQUksS0FBSyxPQUFPLFlBQVksT0FBTyxLQUFNLEdBQUcsU0FBUyxTQUFTLFVBQVUsR0FBRyxPQUFPLFNBQVUsU0FBUyxXQUFXLEtBQUssS0FBSztBQUNoTixVQUFJLEtBQUssVUFBVSxXQUFXLENBQUMsR0FBSTtBQUNuQyxVQUFJLEdBQUcsU0FBUyxPQUFRLE1BQUssT0FBTyxHQUFHLElBQUk7QUFBQSxlQUFZLEdBQUcsU0FBUyxPQUFRLE1BQUssYUFBYSxHQUFHLE1BQU07QUFBQSxJQUN4RztBQUFBLElBQ1EsT0FBTyxHQUFRO0FBQUUsV0FBSyxPQUFPLFNBQVMsU0FBUyxFQUFFLEdBQUc7QUFBRyxXQUFLLE9BQU8sVUFBVSxFQUFFLElBQUksTUFBTSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQzdGLFNBQVMsSUFBUyxLQUFhO0FBQUUsV0FBSyxVQUFVLEVBQUUsS0FBSyxLQUFLLE9BQU8sU0FBUyxNQUFNLEdBQUcsS0FBSyxLQUFLLE9BQU8sVUFBVSxFQUFFLE1BQU0sRUFBRTtBQUFHLFdBQUssUUFBUTtBQUFJLFdBQUssT0FBTztBQUFHLFdBQUssU0FBUztBQUFBLElBQUs7QUFBQSxJQUl4TCxXQUFXLEdBQXFCO0FBQzlCLFdBQUssVUFBVTtBQUNmLFVBQUksTUFBTSxVQUFVLEtBQUssT0FBUSxNQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsUUFBUSxHQUFHO0FBQ3ZFLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDakI7QUFBQSxJQUNRLFlBQVksSUFBWTtBQUM5QixZQUFNLElBQUksS0FBSztBQUFRLFVBQUksQ0FBQyxFQUFHO0FBQVEsWUFBTSxRQUFRLEVBQUUsU0FBUyxPQUFPLENBQUMsTUFBTSxFQUFFLEtBQUs7QUFBRyxVQUFJLENBQUMsTUFBTSxPQUFRO0FBQzNHLFVBQUksS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLEtBQUssS0FBSztBQUFNLGlCQUFXLEtBQUssT0FBTztBQUFFLGFBQUssS0FBSyxJQUFJLElBQUksRUFBRSxDQUFDO0FBQUcsYUFBSyxLQUFLLElBQUksSUFBSSxFQUFFLENBQUM7QUFBRyxhQUFLLEtBQUssSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUFHLGFBQUssS0FBSyxJQUFJLElBQUksRUFBRSxDQUFDO0FBQUEsTUFBRztBQUN2SyxZQUFNLE1BQU0sS0FBSyxPQUFPLGVBQWUsSUFBSSxLQUFLLE9BQU8sZ0JBQWdCLEdBQUcsT0FBTyxLQUFLLElBQUksS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUM3RyxZQUFNLE9BQU8sS0FBSyxNQUFNLEVBQUUsUUFBUSxNQUFNLEtBQUssTUFBTSxHQUFHLE1BQU0sS0FBSyxNQUFNO0FBQ3ZFLFlBQU0sSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxNQUFNLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLE9BQU8sR0FBRyxHQUFHLEtBQUssTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksQ0FBQyxDQUFDO0FBQ25KLFlBQU0sTUFBTSxJQUFJLFFBQVEsUUFBUSxJQUFJLE1BQU0sRUFBRSxHQUFHLE1BQU0sSUFBSSxRQUFRLFFBQVEsS0FBSyxPQUFPLEdBQUcsT0FBTyxJQUFJLEtBQUssS0FBSyxNQUFNLENBQUM7QUFDcEgsWUFBTSxJQUFJLElBQUksS0FBSyxJQUFJLENBQUMsS0FBSyxDQUFHO0FBQ2hDLFdBQUssT0FBTyxXQUFXLFFBQVEsUUFBUSxLQUFLLEtBQUssT0FBTyxVQUFVLEtBQUssQ0FBQztBQUFHLFdBQUssU0FBUyxRQUFRLFFBQVEsS0FBSyxLQUFLLFFBQVEsS0FBSyxDQUFDO0FBQUcsV0FBSyxPQUFPLFVBQVUsS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUFBLElBQy9LO0FBQUE7QUFBQTtBQUFBLElBSVEsYUFBYTtBQXRPdkI7QUF1T0ksVUFBSTtBQUNGLGNBQU0sSUFBSSxLQUFLO0FBQUcsWUFBSSxDQUFDLEVBQUc7QUFDMUIsWUFBSSxFQUFFLFdBQVcsWUFBWTtBQUFFLG1CQUFTO0FBQUc7QUFBQSxRQUFRO0FBQ25ELFlBQUksS0FBSyxVQUFVLFdBQVcsS0FBSyxVQUFVLFFBQVM7QUFDdEQsY0FBTSxPQUFvQixFQUFFLEdBQUcsR0FBRyxNQUFNLEtBQUssTUFBTSxTQUFTLEtBQUssU0FBUyxPQUFPLGdCQUFnQixZQUFZLGdCQUFnQixPQUFPLEtBQUssT0FBTyxPQUFPLEtBQUssVUFBVSxVQUFVLEtBQUssUUFBUSxNQUFNLE9BQU8sZUFBZSxDQUFDLEdBQUcsWUFBVyxVQUFLLFlBQUwsbUJBQWMsVUFBVTtBQUNoUSxnQkFBUSxJQUFJO0FBQUEsTUFDZCxRQUFRO0FBQUEsTUFBd0M7QUFBQSxJQUNsRDtBQUFBO0FBQUEsSUFFUSxRQUFRLEdBQXdDO0FBaFAxRDtBQWlQSSxZQUFNLEVBQUUsTUFBTSxNQUFNLElBQUk7QUFDeEIsV0FBSyxPQUFPO0FBQU8sV0FBSyxZQUFZO0FBQUcsV0FBSyxNQUFNLE9BQU87QUFDekQsV0FBSyxRQUFRO0FBQ2IsVUFBSSxLQUFLLFVBQVUsWUFBWSxXQUFXLENBQUMsS0FBSyxVQUFVLEdBQUc7QUFBRSxjQUFNLE1BQU0sQ0FBQyxLQUFLLFlBQVksTUFBTSxZQUFZLEdBQUc7QUFBRyxpQkFBUyxLQUFLLEdBQUc7QUFBRyxhQUFLLFFBQVEsRUFBRSxLQUFLLElBQUk7QUFBRyxhQUFLLFVBQVU7QUFBTSxhQUFLLE1BQU0sU0FBUyxPQUFPO0FBQUEsTUFBRyxXQUM5TSxLQUFLLFVBQVUsWUFBWTtBQUFFLG1CQUFXO0FBQUcsY0FBTSxPQUFPLEtBQUssSUFBSSxHQUFHLE1BQU0sT0FBTyxDQUFDO0FBQUcsYUFBSyxVQUFVLEVBQUUsWUFBVyxVQUFLLGNBQUwsWUFBa0IsU0FBUyxFQUFFLFFBQVEsTUFBTSxTQUFTLE1BQU0sT0FBTyxLQUFLLE1BQU0sT0FBTyxrQkFBa0IsRUFBRTtBQUFBLE1BQUcsT0FBTztBQUFFLDJCQUFtQixLQUFLLE9BQU8sS0FBSyxVQUFVO0FBQUcsYUFBSyxVQUFVO0FBQUEsTUFBTTtBQUNuVCxVQUFJLENBQUMsS0FBSyxNQUFPLE1BQUssTUFBTSxTQUFTLGNBQWM7QUFDbkQsV0FBSyxPQUFPLEtBQUs7QUFBTSxXQUFLLFVBQVUsS0FBSztBQUFTLFdBQUssSUFBSTtBQUFPLFdBQUssYUFBYSxNQUFNLE1BQU07QUFDbEcsV0FBSyxZQUFZO0FBQUcsT0FBQyxHQUFHLEtBQUssUUFBUSxPQUFPLENBQUMsRUFBRSxRQUFRLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUFHLFdBQUssUUFBUSxNQUFNO0FBQUcsV0FBSyxVQUFVLE1BQU07QUFDdkgsV0FBSyxNQUFNO0FBQU0sV0FBSyxXQUFXO0FBQU8sV0FBSyxRQUFRLEtBQUssVUFBVSxVQUFVLEtBQUssUUFBUTtBQUFNLFdBQUssUUFBUSxLQUFLLFFBQVEsVUFBVTtBQUFTLFdBQUssU0FBUyxLQUFLLFVBQVUsT0FBTztBQUNsTCxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFHLFdBQUssT0FBTyxLQUFLLE1BQU0sRUFBRSxLQUFLO0FBQUcsV0FBSyxNQUFNLHNCQUFzQixVQUFVLElBQUksTUFBTSxPQUFPLE1BQU0sT0FBTyxNQUFNLFdBQVcsS0FBSyxDQUFDLEtBQUssTUFBTSxNQUFNLFNBQVMsTUFBTSxXQUFXLElBQUksS0FBSyxHQUFHLEdBQUc7QUFBQSxJQUNqTztBQUFBLElBTUEsV0FBVyxJQUFhO0FBQ3RCLFdBQUssVUFBVTtBQUNmLFVBQUksTUFBTSxDQUFDLEtBQUssUUFBUTtBQUFFLGNBQU0sSUFBSSxTQUFTLGNBQWMsS0FBSztBQUFHLFVBQUUsS0FBSztBQUFVLFNBQUMsU0FBUyxlQUFlLFlBQVksS0FBSyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBQUcsYUFBSyxTQUFTO0FBQUEsTUFBRztBQUM5SyxVQUFJLEtBQUssT0FBUSxNQUFLLE9BQU8sTUFBTSxVQUFVLEtBQUssVUFBVTtBQUFBLElBQzlEO0FBQUEsSUFDUSxTQUFTLElBQVk7QUF0US9CO0FBdVFJLFVBQUksS0FBSyxJQUFLO0FBQ2QsV0FBSyxRQUFRLEtBQUssS0FBSyxJQUFJO0FBQUksV0FBSyxTQUFTLEtBQUssUUFBUSxLQUFLLEtBQUssUUFBUTtBQUFRLFdBQUssUUFBUSxLQUFLLElBQUksS0FBSyxRQUFRLFFBQVEsS0FBSyxRQUFRLENBQUM7QUFDN0ksWUFBTSxJQUFJLEtBQUs7QUFDZixVQUFJLE1BQU0sS0FBSyxVQUFVLFlBQVksS0FBSyxVQUFVLGVBQWU7QUFBRSxVQUFFO0FBQVUsVUFBRSxPQUFPO0FBQUksWUFBSSxLQUFLLEVBQUUsTUFBTyxHQUFFLFFBQVE7QUFBSSxZQUFJLEtBQUssS0FBTSxHQUFFO0FBQVEsVUFBRSxRQUFRLEtBQUssSUFBSSxFQUFFLE9BQU8sS0FBSyxTQUFTO0FBQUEsTUFBRztBQUNwTSxZQUFNLE1BQU0sWUFBWSxJQUFJO0FBQUcsVUFBSSxNQUFNLEtBQUssY0FBYyxJQUFLO0FBQVEsV0FBSyxjQUFjO0FBQzVGLFlBQU0sSUFBSSxNQUFNLEtBQUssS0FBSyxRQUFRLFNBQVMsR0FBRyxLQUFLLEtBQUssQ0FBQyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLENBQUMsSUFBSSxFQUFFO0FBQ3pILFdBQUssVUFBVSxFQUFFLEtBQUssTUFBTyxLQUFLLEtBQUssTUFBSyxPQUFFLEtBQUssTUFBTSxFQUFFLFNBQVMsSUFBSSxDQUFDLE1BQTdCLFlBQWtDLEdBQUcsUUFBTyxPQUFFLEVBQUUsU0FBUyxDQUFDLE1BQWQsWUFBbUIsRUFBRTtBQUM3RyxVQUFJLEtBQUssVUFBVSxLQUFLLFFBQVMsTUFBSyxPQUFPLGNBQWMsR0FBRyxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsQ0FBQyxTQUFTLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLENBQUM7QUFDdEssV0FBSyxHQUFHLGdCQUFnQjtBQUFBLElBQzFCO0FBQUEsSUFDUSxrQkFBa0I7QUFBRSxXQUFLLFlBQVksRUFBRSxRQUFRLEdBQUcsS0FBSyxHQUFHLE9BQU8sR0FBRyxNQUFNLEdBQUcsT0FBTyxLQUFLLFVBQVU7QUFBQSxJQUFHO0FBQUEsSUFDdEcsZ0JBQWdCO0FBQ3RCLFlBQU0sSUFBSSxLQUFLO0FBQVcsV0FBSyxZQUFZO0FBQU0sVUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLE9BQVE7QUFDdEUsV0FBSyxRQUFRLEtBQUssRUFBRSxNQUFNLEtBQUssRUFBRSxNQUFNLFNBQVMsS0FBSyxTQUFTLE9BQU8sRUFBRSxPQUFPLFVBQVUsS0FBSyxTQUFTLEtBQUssT0FBTyxTQUFTLFNBQVMsR0FBRyxLQUFLLEVBQUUsT0FBUSxFQUFFLE1BQU0sRUFBRSxTQUFTLFFBQVEsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxFQUFFLE1BQU0sUUFBUSxDQUFDLEdBQUcsU0FBUyxFQUFHLE1BQU0sRUFBRSxPQUFRLEVBQUUsUUFBUSxRQUFRLENBQUMsRUFBRSxDQUFDO0FBQ3JRLFVBQUksS0FBSyxRQUFRLFNBQVMsR0FBSSxNQUFLLFFBQVEsTUFBTTtBQUFBLElBQ25EO0FBQUEsSUFDQSxXQUFXO0FBQ1QsWUFBTSxLQUFLLEtBQUs7QUFBTyxVQUFJLENBQUMsS0FBSyxTQUFTLFFBQVEscUJBQXNCLE1BQUssUUFBUSxJQUFJLFFBQVEscUJBQXFCLEVBQUU7QUFDeEgsYUFBTyxFQUFFLEdBQUcsS0FBSyxTQUFTLFFBQVEsR0FBRyxnQkFBZ0IsRUFBRSxRQUFRLFdBQVcsR0FBRyxnQkFBZ0IsUUFBUSxPQUFPLEtBQUssUUFBUSxLQUFLLE1BQU0saUJBQWlCLFVBQVUsR0FBRztBQUFBLElBQ3BLO0FBQUEsSUFDQSxhQUFxQjtBQUNuQixZQUFNLElBQUksS0FBSyxTQUFTLEdBQUcsS0FBVSxLQUFLLE9BQU8sWUFBWSxLQUFLLE9BQU8sVUFBVSxJQUFJLENBQUM7QUFDeEYsWUFBTSxPQUFPLEtBQUssUUFBUSxJQUFJLENBQUMsTUFBTSxVQUFVLEVBQUUsSUFBSSxRQUFRLEVBQUUsT0FBTyxPQUFPLEVBQUUsS0FBSyxNQUFNLEVBQUUsR0FBRyw2QkFBNkIsRUFBRSxPQUFPLE9BQU8sRUFBRSxPQUFPLGtCQUFrQixFQUFFLFFBQVEsV0FBVztBQUM1TCxhQUFPO0FBQUEsUUFBQyxTQUFRLG9CQUFJLEtBQUssR0FBRSxZQUFZLENBQUM7QUFBQSxRQUFJLFdBQVcsVUFBVSxTQUFTO0FBQUEsUUFBSSxRQUFRLEdBQUcsWUFBWSxHQUFHLEtBQUssR0FBRyxVQUFVLEdBQUc7QUFBQSxRQUMzSCxVQUFVLE9BQU8sS0FBSyxJQUFJLE9BQU8sTUFBTSxjQUFjLFVBQVUsSUFBSSxXQUFXLFNBQVMsZ0JBQWdCLFlBQVksS0FBSyxPQUFPLGVBQWUsQ0FBQyxJQUFJLEtBQUssT0FBTyxnQkFBZ0IsQ0FBQyxtQkFBbUIsS0FBSyxPQUFPLHdCQUF3QixFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBQUEsUUFDblAsUUFBUSxFQUFFLElBQUksUUFBUSxDQUFDLENBQUMsaUJBQWlCLEVBQUUsSUFBSSxRQUFRLENBQUMsQ0FBQyxrQkFBa0IsRUFBRSxJQUFJLFFBQVEsQ0FBQyxDQUFDLGFBQWEsRUFBRSxNQUFNLFFBQVEsQ0FBQyxDQUFDLHNCQUFzQixFQUFFLE1BQU0sc0JBQXNCLEVBQUUsU0FBUyxnQkFBZ0IsRUFBRSxLQUFLO0FBQUEsUUFDaE4sZ0JBQWdCLEtBQUssS0FBSyxXQUFXLEtBQUssU0FBUyxhQUFhLEtBQUssT0FBTyxnQkFBZ0IsY0FBYyxVQUFVLEtBQUssRUFBRSxJQUFJLFdBQVcsS0FBSyxFQUFFLE1BQU0sTUFBTTtBQUFBLFFBQzdKO0FBQUEsUUFBMEIsR0FBSSxLQUFLLFNBQVMsT0FBTyxDQUFDLG1EQUFtRDtBQUFBLE1BQUUsRUFBRSxLQUFLLElBQUk7QUFBQSxJQUN4SDtBQUFBO0FBQUEsSUFHQSxVQUFVO0FBQUUsWUFBTSxJQUFJLEtBQUs7QUFBRyxVQUFJLENBQUMsS0FBSyxFQUFFLFdBQVcsV0FBWSxRQUFPO0FBQU0sYUFBUSxFQUFFLE9BQU8sS0FBSyxFQUFFLE1BQU0sU0FBUyxLQUFLLEtBQUssVUFBVSxLQUFLLEVBQUUsTUFBTSxXQUFXLElBQUssRUFBRSxNQUFNLEVBQUUsTUFBTSxPQUFPLFdBQVcsQ0FBQyxHQUFHLFFBQVEsRUFBRSxRQUFRLFlBQVksZ0JBQWdCLE9BQU8sZUFBZSxJQUFJO0FBQUEsSUFBTTtBQUFBO0FBQUE7QUFBQSxJQUcxUixhQUFhO0FBQUUsV0FBSyxXQUFXLEtBQUssTUFBTSxLQUFLLE9BQU8sSUFBSSxHQUFHLElBQUksQ0FBQztBQUFHLGVBQVM7QUFBQSxJQUFHO0FBQUEsSUFDakYsU0FBUztBQUFFLFdBQUssV0FBVyxJQUFJLGdCQUFnQixTQUFTLE1BQU0sRUFBRSxJQUFJLE1BQU0sSUFBSSxLQUFLLE9BQU8sS0FBSyxNQUFNLEtBQUssT0FBTyxJQUFJLEdBQUcsSUFBSSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQ2hJLFdBQVcsTUFBYztBQUN2QixXQUFLLE9BQU87QUFBTyxXQUFLLFNBQVM7QUFBTSxXQUFLLFlBQVk7QUFBRyxVQUFJLEtBQUssTUFBTyxNQUFLLE1BQU0sT0FBTztBQUM3RixXQUFLLFVBQVU7QUFBRyxXQUFLLFdBQVc7QUFBRyxXQUFLLFFBQVE7QUFBTSxXQUFLLGNBQWM7QUFBTSxXQUFLLE9BQU87QUFBTSxXQUFLLFVBQVU7QUFBRyxXQUFLLFVBQVU7QUFBTSxZQUFNLEtBQUssU0FBUyxHQUFHLEtBQUssU0FBUyxFQUFFO0FBQUcseUJBQW1CLEdBQUcsT0FBTyxHQUFHLFVBQVU7QUFBRyxXQUFLLE1BQU0sU0FBUyxjQUFjO0FBQUcsV0FBSyxJQUFJLFNBQVMsRUFBRSxHQUFHLGlCQUFpQixNQUFNLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBRyxXQUFLLGFBQWE7QUFDeFYsV0FBSyxZQUFZO0FBQUcsV0FBSyxTQUFTLElBQUk7QUFBRyxPQUFDLEdBQUcsS0FBSyxRQUFRLE9BQU8sQ0FBQyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxRQUFRLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1SSxXQUFLLE1BQU07QUFBTSxXQUFLLFdBQVc7QUFBTyxXQUFLLFFBQVE7QUFBTSxXQUFLLFFBQVE7QUFDeEUsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBRyxXQUFLLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSztBQUFHLFdBQUssTUFBTSwyQkFBMkIsS0FBSyxFQUFFLE1BQU0sOENBQThDO0FBQUEsSUFDeEs7QUFBQTtBQUFBLElBRUEsV0FBVztBQUFFLFdBQUssV0FBVyxVQUFVLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDM0MsV0FBVyxLQUFhO0FBQ3RCLFdBQUssT0FBTztBQUFPLFdBQUssU0FBUztBQUFNLFdBQUssWUFBWTtBQUFHLFVBQUksS0FBSyxNQUFPLE1BQUssTUFBTSxPQUFPO0FBQzdGLFlBQU0sTUFBTSxZQUFZLEdBQUcsR0FBRyxLQUFLLFNBQVM7QUFBRyxlQUFTLEtBQUssR0FBRztBQUFHLFdBQUssTUFBTSxTQUFTLE9BQU87QUFDOUYsV0FBSyxVQUFVO0FBQUcsV0FBSyxXQUFXO0FBQUcsV0FBSyxjQUFjO0FBQU0sV0FBSyxVQUFVO0FBQU0sV0FBSyxRQUFRLEVBQUUsS0FBSyxJQUFJO0FBQUcsV0FBSyxPQUFPO0FBQUssV0FBSyxVQUFVO0FBQzlJLFdBQUssSUFBSSxTQUFTLFdBQVcsS0FBSyxHQUFHLElBQUksR0FBRyxLQUFLLElBQUk7QUFBRyxXQUFLLGFBQWE7QUFDMUUsV0FBSyxZQUFZO0FBQUcsV0FBSyxTQUFTLElBQUk7QUFBRyxPQUFDLEdBQUcsS0FBSyxRQUFRLE9BQU8sQ0FBQyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxRQUFRLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1SSxXQUFLLE1BQU07QUFBTSxXQUFLLFdBQVc7QUFBTyxXQUFLLFFBQVE7QUFBTSxXQUFLLFFBQVE7QUFDeEUsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBRyxXQUFLLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSztBQUFHLFdBQUssTUFBTSxvQkFBb0IsSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJLEVBQUU7QUFBQSxJQUM3SDtBQUFBO0FBQUEsSUFFQSxhQUFhO0FBQUUsV0FBSyxhQUFhLElBQUksZ0JBQWdCLFNBQVMsTUFBTSxFQUFFLElBQUksTUFBTSxJQUFJLEtBQUssT0FBTyxLQUFLLE1BQU0sS0FBSyxPQUFPLElBQUksR0FBRyxJQUFJLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDdEksYUFBYSxNQUFjO0FBQ3pCLFdBQUssT0FBTztBQUFPLFdBQUssU0FBUztBQUFNLFdBQUssWUFBWTtBQUFHLFVBQUksS0FBSyxNQUFPLE1BQUssTUFBTSxPQUFPO0FBQzdGLFdBQUssVUFBVTtBQUFHLFdBQUssV0FBVztBQUFHLFdBQUssUUFBUTtBQUFNLFdBQUssY0FBYztBQUFNLFdBQUssT0FBTztBQUFNLFdBQUssVUFBVTtBQUFHLFlBQU0sS0FBSyxTQUFTO0FBQUcsaUJBQVc7QUFBRyxXQUFLLE1BQU0sU0FBUyxVQUFVO0FBQ3hMLFdBQUssVUFBVSxFQUFFLFdBQVcsR0FBRyxRQUFRLE1BQU0sU0FBUyxHQUFHLE9BQU8sRUFBRTtBQUNsRSxXQUFLLElBQUksU0FBUyxFQUFFLEdBQUcsZUFBZSxNQUFNLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFBRyxXQUFLLGFBQWE7QUFDaEYsV0FBSyxZQUFZO0FBQUcsV0FBSyxTQUFTLElBQUk7QUFBRyxPQUFDLEdBQUcsS0FBSyxRQUFRLE9BQU8sQ0FBQyxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQUcsV0FBSyxRQUFRLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1SSxXQUFLLE1BQU07QUFBTSxXQUFLLFdBQVc7QUFBTyxXQUFLLFFBQVE7QUFBTSxXQUFLLFFBQVE7QUFDeEUsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBRyxXQUFLLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSztBQUFHLFdBQUssTUFBTSxrRUFBa0U7QUFBQSxJQUNwSjtBQUFBLElBQ1EsY0FBYztBQUNwQixXQUFLLEtBQUssUUFBUSxDQUFDLEdBQUcsT0FBTztBQUFFLFlBQUksQ0FBQyxLQUFLLE1BQU0sSUFBSSxFQUFFLEVBQUcsR0FBRSxRQUFRO0FBQUEsTUFBRyxDQUFDO0FBQUcsV0FBSyxLQUFLLE1BQU07QUFBRyxXQUFLLE1BQU0sTUFBTTtBQUFHLFdBQUssVUFBVSxNQUFNO0FBQUcsV0FBSyxTQUFTO0FBQ3RKLFdBQUssT0FBTyxRQUFRLENBQUMsTUFBTSxFQUFFLEtBQUssUUFBUSxDQUFDO0FBQUcsV0FBSyxTQUFTLENBQUM7QUFBQSxJQUMvRDtBQUFBLElBQ1EsSUFBSSxNQUFjO0FBQUUsYUFBTyxRQUFRLEdBQUcsSUFBSTtBQUFBLElBQUc7QUFBQTtBQUFBLElBRXJELGdCQUF1RTtBQUNyRSxVQUFJLENBQUMsS0FBSyxLQUFLLENBQUMsS0FBSyxVQUFVLEtBQUssVUFBVSxRQUFTLFFBQU87QUFDOUQsWUFBTSxPQUFPLElBQUksSUFBSSxLQUFLLEVBQUUsTUFBTSxJQUFJLENBQUMsTUFBVyxFQUFFLElBQUksQ0FBQztBQUFHLFVBQUksS0FBSyxHQUFHLEtBQUs7QUFBRyxZQUFNLE1BQU0sTUFBTSxLQUFLLEVBQUUsUUFBUSxXQUFXLEdBQUcsQ0FBQyxHQUFHLE1BQU0sS0FBSyxJQUFJLENBQUMsQ0FBQztBQUFHLFVBQUksUUFBUSxDQUFDQyxPQUFNO0FBQUUsY0FBTUEsR0FBRSxJQUFJO0FBQVksY0FBTUEsR0FBRSxJQUFJO0FBQUEsTUFBWSxDQUFDO0FBQzdOLFVBQUksT0FBTyxJQUFJLEtBQUs7QUFBSyxlQUFTLElBQUksR0FBRyxJQUFJLFlBQVksS0FBSztBQUFFLFlBQUksS0FBSyxJQUFJLENBQUMsRUFBRztBQUFVLGNBQU0sSUFBSSxLQUFLLE1BQU0sSUFBSSxDQUFDLEVBQUUsSUFBSSxJQUFJLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRTtBQUFHLFlBQUksSUFBSSxJQUFJO0FBQUUsZUFBSztBQUFHLGlCQUFPO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDakwsVUFBSSxPQUFPLEVBQUcsUUFBTztBQUNyQixZQUFNLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxVQUFVLE1BQU0sSUFBSSxLQUFLLE9BQU8sZUFBZSxHQUFHLElBQUksS0FBSyxPQUFPLGdCQUFnQixHQUFHLEtBQUssS0FBSyxPQUFPLFNBQVMsU0FBUyxHQUFHLENBQUMsR0FBRyxJQUFJLEtBQUssTUFBTSxtQkFBbUI7QUFDMUwsWUFBTSxNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLE1BQU0sUUFBUSxRQUFRLFFBQVEsSUFBSSxRQUFRLFFBQVEsRUFBRSxJQUFJLElBQUksTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLFFBQVEsT0FBTyxTQUFTLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFDM0ssWUFBTSxJQUFJLEtBQUssT0FBTyxzQkFBc0IsR0FBRyxLQUFLLEVBQUUsUUFBUSxHQUFHLEtBQUssRUFBRSxTQUFTLEdBQUcsS0FBSyxJQUFJLElBQUksQ0FBQyxNQUFXLEVBQUUsQ0FBQyxHQUFHLEtBQUssSUFBSSxJQUFJLENBQUMsTUFBVyxFQUFFLENBQUM7QUFDL0ksWUFBTSxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUUsR0FBRyxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUUsR0FBRyxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUUsR0FBRyxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUU7QUFDM0YsVUFBSSxDQUFDLFNBQVMsS0FBSyxLQUFLLEtBQUssRUFBRSxFQUFHLFFBQU87QUFDekMsYUFBTyxFQUFFLEdBQUcsRUFBRSxPQUFPLEtBQUssSUFBSSxHQUFHLEVBQUUsTUFBTSxLQUFLLElBQUksSUFBSSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssTUFBTSxHQUFHO0FBQUEsSUFDekY7QUFBQSxJQUNBLFlBQVk7QUExVmQ7QUEyVkksV0FBSyxXQUFXO0FBQ2hCLFlBQU0sU0FBUyxLQUFLLEVBQUUsTUFBTSxTQUFTLEtBQUs7QUFBWSxXQUFLLGFBQWEsS0FBSyxFQUFFLE1BQU07QUFDckYsWUFBTSxRQUFRLFNBQVMsS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU07QUFBRSxjQUFNLEtBQUssS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUcsZUFBTyxDQUFDLENBQUMsTUFBTSxHQUFHLFNBQVMsRUFBRTtBQUFBLE1BQU0sQ0FBQyxJQUFJO0FBQzdILFlBQU0sUUFBUSxJQUFJLElBQUksS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7QUFDbkQsaUJBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxLQUFLLFFBQVMsS0FBSSxDQUFDLE1BQU0sSUFBSSxFQUFFLEdBQUc7QUFDdEQsYUFBSyxVQUFVLE9BQU8sQ0FBQztBQUFHLGFBQUssUUFBUSxPQUFPLEVBQUU7QUFBRyxjQUFNLElBQUksRUFBRSxPQUFPO0FBQ3RFLFlBQUksT0FBTztBQUNULGdCQUFNLEtBQUssS0FBSyxJQUFJLE1BQU0sSUFBSSxHQUFHLEtBQUssRUFBRSxHQUFHLEtBQUssRUFBRSxHQUFHLEtBQUssRUFBRSxPQUFPLFFBQVE7QUFBRyxZQUFFLEtBQUssTUFBTTtBQUMzRixlQUFLO0FBQUEsWUFBTTtBQUFBLFlBQU0sQ0FBQyxNQUFNO0FBQUUsZ0JBQUUsT0FBTyxTQUFTLElBQUksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDO0FBQUcsZ0JBQUUsT0FBTyxRQUFRLE9BQU8sTUFBTSxJQUFJLE9BQU8sRUFBRTtBQUFBLFlBQUc7QUFBQSxZQUN0SyxNQUFNO0FBQUUsbUJBQUssTUFBTSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLEVBQUU7QUFBRyxnQkFBRSxRQUFRO0FBQUEsWUFBRztBQUFBLFVBQUM7QUFBQSxRQUMvRixPQUFPO0FBQUUsZUFBSyxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFHLFlBQUUsUUFBUTtBQUFBLFFBQUc7QUFBQSxNQUM5RjtBQUNBLFlBQU0sT0FBTyxTQUFTLEVBQUU7QUFDeEIsaUJBQVcsS0FBSyxLQUFLLEVBQUUsT0FBTztBQUM1QixZQUFJLElBQUksS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUcsY0FBTSxJQUFJLEtBQUssSUFBSSxFQUFFLElBQUk7QUFDekQsWUFBSSxDQUFDLEdBQUc7QUFBRSxjQUFJLGFBQWEsS0FBSyxHQUFHLEVBQUUsTUFBTSxHQUFHLEVBQUUsSUFBSTtBQUFHLGVBQUssUUFBUSxJQUFJLEVBQUUsSUFBSSxDQUFDO0FBQUcsZUFBSyxVQUFVLElBQUksR0FBRyxFQUFFLEVBQUU7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUFHLFlBQUUsT0FBTyxTQUFTLElBQUksS0FBSyxLQUFLO0FBQUcsWUFBRSxLQUFLLE9BQU87QUFBRyxlQUFLLFNBQVMsRUFBRSxHQUFHLEVBQUUsQ0FBQztBQUFHLGdCQUFNLEtBQUssUUFBUTtBQUFHLGdCQUFNLEtBQUs7QUFBRyxlQUFLLE1BQU0sS0FBSyxNQUFNO0FBQUUsZ0JBQUksS0FBSyxVQUFVLFFBQVMsSUFBRyxLQUFLLE1BQU07QUFBQSxVQUFHLENBQUM7QUFBQSxRQUFHLE9BQ3hVO0FBQUUsWUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFHLGNBQUksRUFBRSxTQUFTLEVBQUUsTUFBTTtBQUFFLGtCQUFNLEtBQUs7QUFBRyxjQUFFLFFBQVEsRUFBRSxJQUFJO0FBQUcsaUJBQUssTUFBTSxTQUFTLE1BQU0sT0FBTyxFQUFFLEtBQUssT0FBTyxHQUFHLE1BQU0sS0FBSyxRQUFRLElBQUksRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQUEsVUFBRztBQUFBLFFBQUU7QUFBQSxNQUNqTztBQUNBLGlCQUFXLEtBQUssS0FBSyxFQUFFLE9BQU87QUFBRSxjQUFNLEtBQUssS0FBSyxRQUFRLElBQUksRUFBRSxFQUFFO0FBQUcsWUFBSSxNQUFNLEdBQUcsU0FBVSxJQUFHLFVBQVUsZ0JBQWEsRUFBRSxJQUFJLE1BQW5CLG1CQUFzQixVQUF0QixZQUErQixDQUFDO0FBQUEsTUFBRztBQUMxSSxlQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxNQUFLLEtBQUssR0FBRyxRQUFRO0FBQzFELFlBQU0sTUFBTSxLQUFLO0FBQ2pCLFVBQUksT0FBTyxJQUFJLFNBQVMsVUFBVSxLQUFLLFVBQVUsU0FBUztBQUN4RCxpQkFBUyxJQUFJLEdBQUcsSUFBSSxZQUFZLElBQUssS0FBSSxTQUFTLEtBQUssR0FBRyxDQUFDLEVBQUcsTUFBSyxLQUFLLEdBQUcsVUFBVSxLQUFLLEdBQUcsSUFBSSxHQUFHLElBQUksU0FBUyxRQUFRO0FBQ3pILG1CQUFXLEtBQUssS0FBSyxFQUFFLE1BQU8sS0FBSSxpQkFBaUIsS0FBSyxHQUFHLElBQUksS0FBSyxFQUFFLEVBQUUsRUFBRyxNQUFLLEtBQUssRUFBRSxNQUFNLFNBQVM7QUFBQSxNQUN4RztBQUNBLFVBQUksT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUM5QixjQUFNLElBQUksS0FBSyxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLElBQUksRUFBRTtBQUNsRCxZQUFJLEdBQUc7QUFBRSxlQUFLLEtBQUssRUFBRSxNQUFNLEtBQUs7QUFBRyxxQkFBVyxLQUFLLEtBQUssRUFBRSxNQUFPLEtBQUksaUJBQWlCLEdBQUcsQ0FBQyxFQUFHLE1BQUssS0FBSyxFQUFFLE1BQU0sU0FBUztBQUFHLG1CQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxLQUFJLFNBQVMsS0FBSyxHQUFHLENBQUMsRUFBRyxNQUFLLEtBQUssR0FBRyxNQUFNO0FBQUEsUUFBRztBQUFBLE1BQ2pOO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFUSxRQUFRLEdBQWUsR0FBVyxHQUFXO0FBQ25ELFlBQU0sS0FBSyxPQUFPO0FBQUcsUUFBRSxNQUFNO0FBQUcsWUFBTSxTQUFTLEVBQUUsT0FBTyxRQUFRO0FBQ2hFLFdBQUssT0FBTyxHQUFHLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxNQUFNLEdBQUcsR0FBRyxLQUFLLEdBQUssSUFBSTtBQUFHLFdBQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxPQUFPLEdBQUcsR0FBRyxJQUFJLFFBQVEsT0FBTyxHQUFHLEdBQUcsQ0FBQyxHQUFHLEtBQUssR0FBSyxHQUFHLENBQUM7QUFDekosV0FBSyxNQUFNLEdBQUcsR0FBRyxDQUFDLEdBQUcsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQUcsV0FBSyxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQzNILFdBQUssTUFBTSxNQUFNLENBQUMsTUFBTSxFQUFFLE9BQU8sUUFBUSxPQUFPLFVBQVUsSUFBSSxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxLQUFLLElBQUksSUFBSSxLQUFLLEdBQUcsTUFBTSxFQUFFLE9BQU8sUUFBUSxPQUFPLE1BQU0sQ0FBQztBQUFBLElBQ3JKO0FBQUEsSUFDUSxTQUFTLEdBQVcsR0FBVztBQUFFLFdBQUssTUFBTSxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLEdBQUcsQ0FBQyxNQUFNLEtBQUssS0FBSyxHQUFHLEdBQUcsRUFBRTtBQUFHLFdBQUssT0FBTyxHQUFHLEdBQUcsSUFBSSxRQUFRLE9BQU8sS0FBSyxLQUFLLENBQUMsR0FBRyxLQUFLLEtBQUssR0FBRztBQUFBLElBQUc7QUFBQTtBQUFBLElBRzdLLE1BQU0sS0FBYTtBQUFFLFdBQUssR0FBRyxNQUFNLEdBQUc7QUFBQSxJQUFHO0FBQUEsSUFDekMsT0FBTyxLQUFhO0FBQ2xCLFVBQUksS0FBSyxVQUFVLFFBQVM7QUFDNUIsVUFBSSxLQUFLLFVBQVU7QUFBRSxZQUFJLGNBQWMsS0FBSyxHQUFHLEdBQUcsR0FBRztBQUFFLGVBQUssTUFBTSxpQ0FBaUM7QUFBRyxlQUFLLFdBQVc7QUFBQSxRQUFPLE1BQU8sTUFBSyxNQUFNLCtCQUErQjtBQUFBLE1BQUcsTUFDNUssTUFBSyxNQUFNLEtBQUssT0FBTyxLQUFLLElBQUksU0FBUyxVQUFVLEtBQUssSUFBSSxRQUFRLE1BQU0sT0FBTyxFQUFFLE1BQU0sUUFBUSxJQUFJO0FBQzFHLFdBQUssZ0JBQWdCO0FBQU8sV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUMvRDtBQUFBLElBQ0EsT0FBTyxNQUFjO0FBQ25CLFlBQU0sSUFBSSxLQUFLLEdBQUcsTUFBTSxLQUFLO0FBQUssVUFBSSxLQUFLLFVBQVUsUUFBUztBQUM5RCxZQUFNLE9BQU8sRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxJQUFJO0FBQUcsVUFBSSxNQUFNO0FBQUUsYUFBSyxhQUFhLEtBQUssUUFBUSxJQUFJLEtBQUssRUFBRSxDQUFFO0FBQUc7QUFBQSxNQUFRO0FBQ3RILFVBQUksT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUM5QixZQUFJLFVBQVUsR0FBRyxJQUFJLEdBQUcsR0FBRztBQUFFLGlCQUFPLEdBQUcsSUFBSSxLQUFLLElBQUk7QUFBRyxlQUFLLE1BQU07QUFBQSxRQUFNLE9BQ25FO0FBQUUsZ0JBQU0sT0FBTyxFQUFFLEtBQUssSUFBSSxHQUFHO0FBQUcsZUFBSyxNQUFNLHdCQUF3QixVQUFVLElBQUksQ0FBQyxVQUFVLEtBQUssTUFBTSxDQUFDLENBQUMsY0FBYyxhQUFhLENBQUMsQ0FBQyxRQUFRO0FBQUEsUUFBRztBQUFBLE1BQ3hKLFdBQVcsT0FBTyxJQUFJLFNBQVMsUUFBUTtBQUFFLFlBQUksU0FBUyxHQUFHLElBQUksSUFBSSxJQUFJLEVBQUcsTUFBSyxNQUFNO0FBQUEsTUFBTTtBQUN6RixXQUFLLGdCQUFnQjtBQUFPLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDL0Q7QUFBQSxJQUNBLGFBQWEsR0FBZTtBQUMxQixZQUFNLEtBQUssS0FBSyxVQUFVLElBQUksQ0FBQztBQUFHLFVBQUksT0FBTyxVQUFhLEtBQUssVUFBVSxRQUFTO0FBQ2xGLFlBQU0sSUFBSSxLQUFLLEdBQUcsSUFBSSxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUU7QUFDckQsVUFBSSxLQUFLLFVBQVU7QUFBRSxZQUFJLFNBQVMsR0FBRyxFQUFFLEdBQUc7QUFBRSxlQUFLLE1BQU0sUUFBUSxVQUFVLEVBQUUsSUFBSSxDQUFDLDBCQUEwQjtBQUFHLGVBQUssV0FBVztBQUFBLFFBQU8sTUFBTyxNQUFLLE1BQU0sRUFBRSxRQUFRLG1EQUFtRCwrQkFBK0I7QUFBQSxNQUFHLFdBQzVPLEtBQUssT0FBTyxLQUFLLElBQUksU0FBUyxVQUFVLEVBQUUsS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsS0FBSyxFQUFFLE1BQU0sVUFBVSxtQkFBbUI7QUFDdkksWUFBSSxjQUFjLEdBQUcsS0FBSyxJQUFJLEtBQUssRUFBRSxHQUFHO0FBQUUsZUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLEdBQUc7QUFBRyxlQUFLLE1BQU0saUNBQWlDLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRztBQUFBLFFBQUcsTUFDekksTUFBSyxNQUFNLDBDQUEwQyxLQUFLLEVBQUUsTUFBTSxDQUFDLElBQUksS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDLG1CQUFtQixhQUFhLENBQUMsQ0FBQyxRQUFRO0FBQUEsTUFDdkksV0FDUyxLQUFLLE9BQU8sS0FBSyxJQUFJLFNBQVMsVUFBVSxLQUFLLElBQUksT0FBTyxJQUFJO0FBQ25FLGNBQU0sSUFBSSxFQUFFLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFRLEtBQUssSUFBWSxFQUFFO0FBQzNELFlBQUksaUJBQWlCLEdBQUcsQ0FBQyxHQUFHO0FBQUUsd0JBQWMsR0FBRyxFQUFFLElBQUksRUFBRSxFQUFFO0FBQUcsZUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLElBQUksRUFBRSxHQUFHO0FBQUcsZUFBSyxNQUFNLGlCQUFpQixFQUFFLElBQUksU0FBUyxVQUFVLEVBQUUsSUFBSSxDQUFDLEdBQUc7QUFBQSxRQUFHLE1BQU8sTUFBSyxNQUFNLEVBQUUsTUFBTSxRQUFRLEdBQUc7QUFBQSxNQUM1TSxNQUFPLE1BQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxJQUFJLFNBQVMsVUFBVSxLQUFLLElBQUksT0FBTyxLQUFLLE9BQU8sRUFBRSxNQUFNLFFBQVEsR0FBRztBQUN6RyxXQUFLLGdCQUFnQjtBQUFPLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFDL0Q7QUFBQSxJQUNBLGdCQUFnQjtBQUNkLFlBQU0sSUFBSSxLQUFLLEdBQUcsTUFBTSxLQUFLO0FBQUssVUFBSSxDQUFDLE9BQU8sSUFBSSxTQUFTLE9BQVE7QUFDbkUsWUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sSUFBSSxFQUFFO0FBQUcsWUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLEtBQUssQ0FBQyxNQUFNLGlCQUFpQixHQUFHLENBQUMsQ0FBQztBQUN6RyxVQUFJLEtBQUssR0FBRztBQUFFLHNCQUFjLEdBQUcsRUFBRSxJQUFJLEVBQUUsRUFBRTtBQUFHLGFBQUssTUFBTSxpQkFBaUIsRUFBRSxJQUFJLFNBQVMsVUFBVSxFQUFFLElBQUksQ0FBQyxHQUFHO0FBQUEsTUFBRyxNQUFPLE1BQUssTUFBTSx1REFBdUQ7QUFDdkwsV0FBSyxVQUFVO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUNuQztBQUFBLElBQ0EsaUJBQWlCO0FBQ2YsWUFBTSxNQUFNLEtBQUs7QUFBSyxVQUFJLENBQUMsT0FBTyxJQUFJLFNBQVMsT0FBUTtBQUN2RCxVQUFJLENBQUMsS0FBSyxlQUFlO0FBQUUsYUFBSyxnQkFBZ0I7QUFBTSxhQUFLLE1BQU0sK0RBQStEO0FBQUcsYUFBSyxHQUFHLE9BQU87QUFBRztBQUFBLE1BQVE7QUFDN0osY0FBUSxLQUFLLEdBQUcsSUFBSSxFQUFFO0FBQUcsV0FBSyxNQUFNO0FBQU0sV0FBSyxnQkFBZ0I7QUFBTyxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFBLElBQ3pHO0FBQUEsSUFDQSxhQUFhO0FBQUUsVUFBSSxLQUFLLFVBQVUsUUFBUztBQUFRLFVBQUksS0FBSyxFQUFFLGFBQWE7QUFBRSxhQUFLLE1BQU0sK0JBQStCO0FBQUc7QUFBQSxNQUFRO0FBQUUsV0FBSyxXQUFXLENBQUMsS0FBSztBQUFVLFdBQUssTUFBTTtBQUFNLFVBQUksS0FBSyxTQUFVLE1BQUssTUFBTSxnRkFBZ0Y7QUFBRyxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFBLElBQUc7QUFBQTtBQUFBLElBRzFVLGNBQWM7QUFDWixVQUFJLEtBQUssVUFBVSxXQUFXLENBQUMsS0FBSyxFQUFFLE1BQU0sUUFBUTtBQUFFLFlBQUksQ0FBQyxLQUFLLEVBQUUsTUFBTSxPQUFRLE1BQUssTUFBTSxpQ0FBaUM7QUFBRztBQUFBLE1BQVE7QUFDdkksV0FBSyxZQUFZO0FBQUcsWUFBTSxLQUFLLE9BQU87QUFBRyxXQUFLLGdCQUFnQjtBQUFHLFdBQUssU0FBUyxLQUFLO0FBQ3BGLFdBQUssTUFBTTtBQUFNLFdBQUssV0FBVztBQUFPLFdBQUs7QUFBVyxXQUFLLFVBQVU7QUFBTyxXQUFLLFdBQVc7QUFDOUYsWUFBTSxJQUFJLEtBQUssR0FBRyxRQUFRLEVBQUUsTUFBTSxNQUFNO0FBQ3hDLFlBQU0sUUFBUSxTQUFTLEVBQUUsT0FBTyxTQUFpQyxDQUFDO0FBQUcsaUJBQVcsS0FBSyxPQUFPLEtBQUssS0FBSyxFQUFHLFFBQU8sQ0FBQyxJQUFLLE1BQWMsQ0FBQyxFQUFFO0FBQ3ZJLFdBQUssU0FBUyxJQUFJLE9BQU8sTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxVQUFVLEVBQUUsTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLE9BQU8sTUFBTSxFQUFFLE9BQU8sS0FBSyxLQUFLLFNBQVMsUUFBUSxXQUFXLEVBQUUsSUFBSSxDQUFDO0FBQ2pNLFdBQUssS0FBSyxNQUFNO0FBQUcsV0FBSyxNQUFNLE1BQU07QUFBRyxXQUFLLFVBQVUsTUFBTTtBQUM1RCxXQUFLLE9BQU8sU0FBUyxRQUFRLENBQUMsTUFBTTtBQUNsQyxZQUFJLEVBQUUsU0FBUyxHQUFHO0FBQUUsZ0JBQU0sSUFBSSxNQUFNLEVBQUUsS0FBSyxDQUFDO0FBQUcsZ0JBQU0sSUFBSSxLQUFLLFFBQVEsSUFBSSxFQUFFLEVBQUU7QUFBSSxlQUFLLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQztBQUFHLGVBQUssTUFBTSxJQUFJLEVBQUUsSUFBSSxFQUFFLEVBQUU7QUFBRyxZQUFFLE1BQU0sQ0FBQztBQUFHLFlBQUUsUUFBUSxFQUFFLFVBQVUsSUFBSSxJQUFJO0FBQUEsUUFBRyxPQUM5SztBQUFFLGdCQUFNLElBQUksYUFBYSxLQUFLLEdBQUcsRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJO0FBQUcsWUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLENBQUMsS0FBSyxLQUFLO0FBQUcsY0FBSSxFQUFFLFFBQVEsRUFBRSxRQUFTLEdBQUUsUUFBUSxJQUFJO0FBQUcsWUFBRSxLQUFLLE9BQU87QUFBRyxZQUFFLE1BQU0sQ0FBQztBQUFHLFlBQUUsUUFBUSxFQUFFLFVBQVUsSUFBSSxJQUFJO0FBQUcsZUFBSyxLQUFLLElBQUksRUFBRSxJQUFJLENBQUM7QUFBRyxlQUFLLE1BQU0sS0FBSyxNQUFNO0FBQUUsZ0JBQUksRUFBRSxVQUFVLFFBQVMsR0FBRSxLQUFLLE1BQU07QUFBQSxVQUFHLENBQUM7QUFBRyxlQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsUUFBRztBQUFBLE1BQ2haLENBQUM7QUFDRCxlQUFTLElBQUksR0FBRyxJQUFJLFlBQVksSUFBSyxNQUFLLEtBQUssR0FBRyxRQUFRO0FBQzFELFdBQUssUUFBUTtBQUFjLFdBQUssY0FBYztBQUFLLFdBQUssTUFBTTtBQUFHLFdBQUssU0FBUyxLQUFLLE1BQU0sRUFBRSxRQUFRLEdBQUc7QUFBRyxXQUFLLFVBQVU7QUFBRyxXQUFLLEdBQUcsT0FBTztBQUFHLFdBQUssV0FBVztBQUFBLElBQ2hLO0FBQUEsSUFDUSxZQUFZLEtBQWU7QUFDakMsWUFBTSxJQUFJLEtBQUs7QUFDZixpQkFBVyxLQUFLLEtBQUs7QUFDbkIsWUFBSSxFQUFFLE1BQU0sU0FBUztBQUFFLGdCQUFNLElBQUksS0FBSyxLQUFLLElBQUksRUFBRSxFQUFFO0FBQUcsY0FBSSxFQUFHLEdBQUUsS0FBSyxVQUFVLEVBQUUsS0FBSztBQUFHLGNBQUksS0FBSyxPQUFPLElBQUksTUFBTTtBQUFFLGtCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFHLGdCQUFJLEVBQUcsT0FBTSxLQUFLLEVBQUUsTUFBTSxHQUFHLEVBQUUsU0FBUyxJQUFJLElBQUksSUFBSTtBQUFBLFVBQUc7QUFBQSxRQUFFLFdBQzVMLEVBQUUsTUFBTSxPQUFPO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEVBQUcsR0FBRSxNQUFNO0FBQUcsY0FBSSxFQUFFLFNBQVMsUUFBUyxPQUFNLEtBQUssVUFBVTtBQUFBLG1CQUFZLEVBQUUsU0FBUyxRQUFTLE9BQU0sS0FBSyxLQUFLO0FBQUEsUUFBRyxXQUNsSyxFQUFFLE1BQU0sU0FBUztBQUFFLGdCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxHQUFJLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGVBQUssV0FBVyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEVBQUUsR0FBRztBQUFHLGdCQUFNLEtBQUssT0FBTztBQUFBLFFBQUcsV0FDN0ksRUFBRSxNQUFNLFNBQVM7QUFBRSxnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksR0FBRztBQUFFLGNBQUUsS0FBSyxPQUFPO0FBQUcsY0FBRSxNQUFNLElBQUk7QUFBRyxjQUFFLFFBQVEsSUFBSTtBQUFHLGtCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGtCQUFNLEtBQUssT0FBTztBQUFHLGlCQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUcsZ0JBQUksRUFBRSxTQUFTLEVBQUcsTUFBSyxNQUFNLEdBQUcsTUFBTTtBQUFFLGtCQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRSxNQUFNLEtBQUssS0FBSyxVQUFVLFNBQVM7QUFBRSxrQkFBRSxPQUFPLFdBQVcsS0FBSztBQUFBLGNBQUc7QUFBQSxZQUFFLENBQUM7QUFBQSxVQUFHO0FBQUEsUUFBRSxXQUN2VyxFQUFFLE1BQU0sUUFBUTtBQUFFLGdCQUFNLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUFJLGdCQUFNLEtBQUssTUFBTTtBQUFHLGVBQUssT0FBTyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUksUUFBUSxPQUFPLEtBQUssS0FBSyxDQUFDLEdBQUcsTUFBTSxLQUFLLElBQUk7QUFBQSxRQUFHLFdBQ3hJLEVBQUUsTUFBTSxTQUFTO0FBQUUsZ0JBQU0sSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO0FBQUksZ0JBQU0sS0FBSyxPQUFPO0FBQUcsZUFBSyxPQUFPLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxNQUFNLEdBQUcsR0FBRyxLQUFLLFFBQVEsTUFBTSxRQUFRLEdBQUc7QUFBQSxRQUFHLFdBQzFKLEVBQUUsTUFBTSxTQUFTO0FBQUUsZ0JBQU0sS0FBSyxPQUFPO0FBQUcsZUFBSyxPQUFPLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxLQUFLLEdBQUcsR0FBRyxLQUFLLEVBQUUsSUFBSSxLQUFLLElBQUk7QUFBQSxRQUFHO0FBQUEsTUFDakk7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUdRLGFBQWEsTUFBYztBQUNqQyxVQUFJLEtBQUssVUFBVSxJQUFJLEVBQUcsUUFBTyxLQUFLLFVBQVUsSUFBSTtBQUNwRCxZQUFNLE1BQU0sS0FBSyxFQUFFLE1BQU0sYUFBYSxLQUFLLEVBQUUsTUFBTSxVQUFVLENBQUM7QUFBRyxVQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2xGLFlBQU0sSUFBSSxJQUFJLE1BQU0sV0FBVyxJQUFJO0FBQUcsWUFBTSxJQUFJLFNBQVMsSUFBSSxJQUFJLFFBQVEsT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksUUFBUSxPQUFPLEtBQUssTUFBTSxJQUFJO0FBQ3JJLFVBQUksbUJBQW1CLEVBQUcsR0FBRSxnQkFBZ0IsRUFBRSxNQUFNLEtBQUs7QUFBRyxXQUFLLFVBQVUsSUFBSSxJQUFJO0FBQUcsYUFBTztBQUFBLElBQy9GO0FBQUEsSUFDUSxXQUFXLE1BQWMsSUFBWSxJQUFZLElBQVksSUFBWSxLQUFhO0FBQzVGLFVBQUksT0FBTyxLQUFLLFVBQVUsSUFBSTtBQUM5QixVQUFJLENBQUMsTUFBTTtBQUNULGNBQU0sU0FBUyxJQUFJLFFBQVEsY0FBYyxNQUFNLEtBQUssS0FBSztBQUFHLGVBQU8sUUFBUSxPQUFPLElBQUk7QUFDdEYsWUFBSSxLQUFLLEVBQUUsT0FBTztBQUNoQixnQkFBTSxNQUFNLEtBQUssRUFBRSxNQUFNLHlCQUF5QixDQUFDLE1BQWMsSUFBSSxNQUFNLEtBQUssT0FBTyxFQUFFLFNBQVMsRUFBRSxFQUFFLE1BQU0sR0FBRyxDQUFDLEdBQUcsS0FBSztBQUN4SCxjQUFJLFVBQVUsQ0FBQyxFQUFFLFNBQVM7QUFBUSxjQUFJLFVBQVUsQ0FBQyxFQUFFLGVBQWUsRUFBRSxRQUFRLENBQUMsTUFBVztBQUFFLGNBQUUsYUFBYTtBQUFPLGNBQUUsMkJBQTJCO0FBQUEsVUFBTSxDQUFDO0FBQUEsUUFDdEosT0FBTztBQUFFLGdCQUFNLE1BQU0sUUFBUSxZQUFZLGVBQWUsU0FBUyxFQUFFLFFBQVEsTUFBTSxVQUFVLE1BQU0sR0FBRyxLQUFLLEtBQUs7QUFBRyxjQUFJLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBRyxjQUFJLGFBQWE7QUFBTyxjQUFJLFNBQVM7QUFBUSxjQUFJLFdBQVcsS0FBSyxVQUFVLElBQUk7QUFBQSxRQUFHO0FBQ2pPLGVBQU87QUFBQSxNQUNUO0FBQ0EsV0FBSyxXQUFXLElBQUk7QUFDcEIsVUFBSSxLQUFLLEVBQUUsT0FBTztBQUFFLGNBQU0sS0FBSyxLQUFLLGFBQWEsSUFBSTtBQUFHLGFBQUssZUFBZSxFQUFFLFFBQVEsQ0FBQyxNQUFXO0FBQUUsY0FBSSxHQUFJLEdBQUUsV0FBVztBQUFBLFFBQUksQ0FBQztBQUFBLE1BQUc7QUFDakksV0FBSyxPQUFPLEtBQUssRUFBRSxNQUFNLElBQUksSUFBSSxJQUFJLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQztBQUFBLElBQ3REO0FBQUE7QUFBQSxJQUdRLGFBQWE7QUFDbkIsWUFBTSxJQUFJLEtBQUs7QUFBUSxVQUFJLENBQUMsRUFBRztBQUFRLFlBQU0sT0FBTyxvQkFBSSxJQUFZLEdBQUcsU0FBUyxvQkFBSSxJQUFZO0FBQ2hHLGlCQUFXLEtBQUssRUFBRSxTQUFVLEVBQUMsRUFBRSxTQUFTLElBQUksT0FBTyxRQUFRLElBQUksRUFBRSxJQUFJO0FBQ3JFLE9BQUMsR0FBRyxJQUFJLEVBQUUsTUFBTSxHQUFHLENBQUMsRUFBRSxRQUFRLENBQUMsTUFBTSxNQUFNLE1BQU0sS0FBSyxNQUFNLE9BQU8sT0FBTyxHQUFHLENBQUMsQ0FBQztBQUFHLFlBQU0sSUFBSSxDQUFDLEdBQUcsTUFBTSxFQUFFLENBQUM7QUFBRyxVQUFJLEVBQUcsT0FBTSxLQUFLLEdBQUcsTUFBTSxJQUFJO0FBQUEsSUFDN0k7QUFBQSxJQUVRLE1BQU0sSUFBWTtBQUN4QixVQUFJLEtBQUssT0FBTyxnQkFBZ0IsS0FBSyxTQUFTLEtBQUssT0FBTyxpQkFBaUIsS0FBSyxNQUFPLE1BQUssYUFBYTtBQUN6RyxlQUFTLElBQUksS0FBSyxPQUFPLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUFFLGFBQUssT0FBTyxDQUFDLEVBQUUsS0FBSztBQUFJLFlBQUksS0FBSyxPQUFPLENBQUMsRUFBRSxLQUFLLEdBQUc7QUFBRSxnQkFBTSxJQUFJLEtBQUssT0FBTyxDQUFDLEVBQUU7QUFBSSxlQUFLLE9BQU8sT0FBTyxHQUFHLENBQUM7QUFBRyxZQUFFO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDdkssZUFBUyxJQUFJLEtBQUssT0FBTyxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFBRSxjQUFNLElBQUksS0FBSyxPQUFPLENBQUM7QUFBRyxVQUFFLEtBQUs7QUFBSSxjQUFNLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNO0FBQUcsVUFBRSxFQUFFLFFBQVEsSUFBSSxHQUFHLEdBQUcsQ0FBQztBQUFHLFVBQUUsR0FBRyxRQUFRLE9BQU8sSUFBSTtBQUFJLFlBQUksS0FBSyxHQUFHO0FBQUUsWUFBRSxFQUFFLFFBQVE7QUFBRyxZQUFFLEdBQUcsUUFBUTtBQUFHLGVBQUssT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFBLFFBQUc7QUFBQSxNQUFFO0FBQzdRLFVBQUksS0FBSyxPQUFPLEdBQUc7QUFBRSxhQUFLLE9BQU8sS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLEtBQUssS0FBSyxNQUFNO0FBQUcsY0FBTSxJQUFJLEtBQUssT0FBTyxLQUFLLFFBQVEsSUFBSSxJQUFJLEtBQUs7QUFBTyxhQUFLLE9BQU8sV0FBVyxRQUFRLFFBQVEsS0FBSyxLQUFLLFFBQVEsS0FBSyxLQUFLLE1BQU0sS0FBSyxDQUFDO0FBQUcsYUFBSyxTQUFTLFFBQVEsUUFBUSxLQUFLLEtBQUssUUFBUSxLQUFLLEtBQUssTUFBTSxLQUFLLENBQUM7QUFBRyxhQUFLLE9BQU8sVUFBVSxLQUFLLE9BQU8sTUFBTSxDQUFDO0FBQUEsTUFBRyxXQUNqVSxLQUFLLFVBQVUsWUFBWSxLQUFLLFlBQVksV0FBVyxDQUFDLEtBQUssS0FBTSxNQUFLLFlBQVksRUFBRTtBQUMvRixXQUFLLE1BQU0sT0FBTyxFQUFFO0FBQ3BCLGVBQVMsSUFBSSxLQUFLLE9BQU8sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQUUsY0FBTSxJQUFJLEtBQUssT0FBTyxDQUFDO0FBQUcsVUFBRSxLQUFLO0FBQUksY0FBTSxJQUFJLEtBQUssSUFBSSxHQUFHLEVBQUUsSUFBSSxFQUFFLEdBQUc7QUFBRyxVQUFFLEdBQUcsQ0FBQztBQUFHLFlBQUksS0FBSyxHQUFHO0FBQUUsZUFBSyxPQUFPLE9BQU8sR0FBRyxDQUFDO0FBQUcsY0FBSSxFQUFFLEtBQU0sR0FBRSxLQUFLO0FBQUEsUUFBRztBQUFBLE1BQUU7QUFDdE0saUJBQVcsS0FBSyxLQUFLLFFBQVEsT0FBTyxFQUFHLEdBQUUsT0FBTyxFQUFFO0FBQ2xELFdBQUssS0FBSyxRQUFRLENBQUMsR0FBRyxPQUFPO0FBQUUsWUFBSSxDQUFDLEtBQUssTUFBTSxJQUFJLEVBQUUsRUFBRyxHQUFFLE9BQU8sRUFBRTtBQUFBLE1BQUcsQ0FBQztBQUV2RSxZQUFNLElBQUksS0FBSztBQUNmLFdBQUssS0FBSyxVQUFVLGdCQUFnQixLQUFLLFVBQVUsYUFBYSxHQUFHO0FBQ2pFLFlBQUksS0FBSyxVQUFVLGNBQWM7QUFBRSxlQUFLLGVBQWU7QUFBSSxjQUFJLEtBQUssZUFBZSxHQUFHO0FBQUUsaUJBQUssUUFBUTtBQUFVLGlCQUFLLEdBQUcsT0FBTztBQUFBLFVBQUc7QUFBQSxRQUFFO0FBQ25JLFlBQUksS0FBSyxVQUFVLFVBQVU7QUFDM0IsZUFBSyxPQUFPLEtBQUssS0FBSztBQUN0QixpQkFBTyxLQUFLLE9BQU8sSUFBSSxNQUFNLEVBQUUsU0FBUyxHQUFHO0FBQUUsY0FBRSxLQUFLLElBQUksRUFBRTtBQUFHLGlCQUFLLE9BQU8sSUFBSTtBQUFJLGlCQUFLLFlBQVksRUFBRSxNQUFNLENBQUM7QUFBQSxVQUFHO0FBQUEsUUFDaEg7QUFDQSxtQkFBVyxLQUFLLEVBQUUsVUFBVTtBQUMxQixnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksQ0FBQyxFQUFHO0FBQ3ZDLGNBQUksQ0FBQyxLQUFLLFNBQVMsS0FBSyxVQUFVLFlBQVksRUFBRSxTQUFTLElBQUk7QUFBRSxjQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBRyxjQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBRyxnQkFBSSxFQUFFLFNBQVMsS0FBTSxHQUFFLE9BQU8sU0FBUyxJQUFJLEVBQUU7QUFBQSxVQUFLO0FBQ3ZLLGNBQUksRUFBRSxPQUFPO0FBQUUsY0FBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUs7QUFBRyxnQkFBSSxFQUFFLFFBQVMsR0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU87QUFBQSxVQUFHLE1BQ2pGLEdBQUUsUUFBUSxJQUFJO0FBQ25CLGNBQUksRUFBRSxVQUFVLFlBQVksRUFBRSxTQUFTLEVBQUUsVUFBVSxTQUFTO0FBQUUsa0JBQU0sT0FBTyxFQUFFLFVBQVUsUUFBUSxRQUFRO0FBQVEsZ0JBQUksS0FBSyxVQUFVLElBQUksRUFBRSxFQUFFLE1BQU0sUUFBUyxFQUFFLFVBQVUsUUFBUSxFQUFFLFVBQVUsU0FBVTtBQUFFLGtCQUFJLEVBQUUsVUFBVSxTQUFTO0FBQUUsa0JBQUUsS0FBSyxJQUFXO0FBQUcscUJBQUssVUFBVSxJQUFJLEVBQUUsSUFBSSxJQUFJO0FBQUEsY0FBRztBQUFBLFlBQUU7QUFBQSxVQUFFO0FBQ3pSLGNBQUksRUFBRSxVQUFVLFNBQVUsTUFBSyxVQUFVLElBQUksRUFBRSxJQUFJLFFBQVE7QUFBQSxRQUM3RDtBQUNBLFlBQUksRUFBRSxVQUFVLEtBQUssQ0FBQyxLQUFLLFNBQVM7QUFBRSxlQUFLLFVBQVU7QUFBTSxlQUFLLFdBQVc7QUFBQSxRQUFLO0FBQ2hGLFlBQUksS0FBSyxXQUFXLEdBQUc7QUFBRSxlQUFLLFlBQVk7QUFBSSxjQUFJLEtBQUssWUFBWSxFQUFHLE1BQUssYUFBYTtBQUFBLFFBQUc7QUFBQSxNQUM3RjtBQUNBLGVBQVMsSUFBSSxLQUFLLE9BQU8sU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQ2hELGNBQU0sSUFBSSxLQUFLLE9BQU8sQ0FBQztBQUFHLFVBQUUsS0FBSyxLQUFLLEtBQUs7QUFBVyxjQUFNLElBQUksS0FBSyxJQUFJLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRztBQUN2RixjQUFNLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sR0FBRyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEdBQUcsS0FBSyxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLE1BQU0sSUFBSTtBQUNsSCxjQUFNLEtBQUssS0FBSyxJQUFJLEdBQUcsSUFBSSxJQUFJLEdBQUcsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sSUFBSSxLQUFLLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxFQUFFLElBQUksTUFBTSxLQUFLO0FBQ2xKLFVBQUUsS0FBSyxTQUFTLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBRyxVQUFFLEtBQUssT0FBTyxJQUFJLFFBQVEsUUFBUSxJQUFJLElBQUksRUFBRSxDQUFDO0FBQzlFLFlBQUksS0FBSyxHQUFHO0FBQUUsWUFBRSxLQUFLLFdBQVcsS0FBSztBQUFHLGVBQUssVUFBVSxLQUFLLEVBQUUsSUFBSTtBQUFHLGVBQUssT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFBLFFBQUc7QUFBQSxNQUNqRztBQUFBLElBQ0Y7QUFBQSxJQUVRLGVBQWU7QUFDckIsWUFBTSxJQUFJLEtBQUssUUFBUyxJQUFJLEtBQUs7QUFDakMsV0FBSyxjQUFjO0FBQ25CLFdBQUssYUFBYSxRQUFRLEVBQUUsSUFBSSxZQUFZLEtBQUssT0FBTyxLQUFLLEVBQUUsV0FBVyxJQUFJLFFBQVEsTUFBTSxPQUFPLEVBQUUsS0FBSyxRQUFRLENBQUMsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUMsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDL0osVUFBSSxFQUFFLFdBQVcsR0FBRztBQUNsQixhQUFLLFdBQVcsT0FBTyxNQUFNO0FBQzNCLGVBQUssT0FBTztBQUNaLGNBQUk7QUFBRSxpQkFBSyxXQUFXLEtBQUssUUFBUSxJQUFJLGVBQWUsVUFBVSxJQUFJLGdCQUFnQixFQUFFLElBQUksSUFBSSxTQUFTLGdCQUFnQixjQUFxQixDQUFDO0FBQUcsaUJBQUssV0FBVyxLQUFLO0FBQVUsbUJBQU8sY0FBYyxJQUFJLE1BQU0sb0JBQW9CLENBQUM7QUFBQSxVQUFHLFFBQVE7QUFBRSxpQkFBSyxXQUFXO0FBQUEsVUFBRztBQUNuUSxjQUFJLFVBQVUsS0FBSyxLQUFLLFNBQVM7QUFDL0IsZ0JBQUk7QUFDRixvQkFBTSxJQUFJLHlCQUF5QixFQUFFLElBQUk7QUFBRyxtQkFBSyxRQUFRLFVBQVUsRUFBRTtBQUFNLHFCQUFPLGNBQWMsSUFBSSxNQUFNLG9CQUFvQixDQUFDO0FBQy9ILGtCQUFJLEVBQUUsTUFBTTtBQUFFLHFCQUFLLFFBQVE7QUFBUyxxQkFBSyxNQUFNLFVBQVUsRUFBRSxPQUFPLGtEQUFrRDtBQUFBLGNBQUc7QUFBQSxZQUN6SCxRQUFRO0FBQUEsWUFBc0M7QUFBQSxVQUNoRDtBQUNBLGNBQUksWUFBWSxDQUFDLEdBQUc7QUFDbEIsaUJBQUssUUFBUTtBQUFPLHFCQUFTO0FBQzdCLGdCQUFJO0FBQ0Ysa0JBQUksS0FBSyxPQUFPO0FBQUUscUJBQUssY0FBYyxzQkFBc0IsS0FBSyxNQUFNLEdBQUc7QUFBRyxxQkFBSyxTQUFTO0FBQUEsY0FBTSxNQUFPLE1BQUssU0FBUyxtQkFBbUIsZ0JBQWdCLGNBQXFCO0FBQzdLLHFCQUFPLGNBQWMsSUFBSSxNQUFNLG9CQUFvQixDQUFDO0FBQUEsWUFDdEQsUUFBUTtBQUFFLG1CQUFLLFNBQVM7QUFBQSxZQUFNO0FBQzlCLGlCQUFLLEdBQUcsT0FBTztBQUFHO0FBQUEsVUFDcEI7QUFDQSxlQUFLLFFBQVEsYUFBYSxDQUFDO0FBQUcsZUFBSyxRQUFRO0FBQVMsZUFBSyxXQUFXO0FBQUcsZUFBSyxHQUFHLE9BQU87QUFBQSxRQUN4RixDQUFDO0FBQUEsTUFDSCxPQUFPO0FBQ0wsaUJBQVMsQ0FBQztBQUFHLGFBQUssR0FBRyxPQUFPO0FBQUcsYUFBSyxHQUFHLFlBQVk7QUFDbkQsWUFBSSxFQUFFLFdBQVcsT0FBUSxNQUFLLFdBQVcsU0FBUyxNQUFNO0FBQUUsZUFBSyxPQUFPO0FBQU8sZUFBSyxRQUFRO0FBQVEsbUJBQVM7QUFBRyxlQUFLLEdBQUcsT0FBTztBQUFBLFFBQUcsQ0FBQztBQUFBLFlBQzVILE1BQUssV0FBVyxRQUFRLE1BQU07QUFBRSxlQUFLLE1BQU0sNkVBQTZFO0FBQUcsZUFBSyxRQUFRO0FBQUEsUUFBRyxDQUFDO0FBQUEsTUFDbko7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUdRLFdBQVcsTUFBZ0MsTUFBa0I7QUFDbkUsWUFBTSxJQUFJLEtBQUssUUFBUyxJQUFJLEtBQUs7QUFBTyxXQUFLLE9BQU87QUFBTSxVQUFJLFNBQVMsTUFBTyxNQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsT0FBTyxHQUFHO0FBQ25ILFlBQU0sT0FBTyxNQUFNO0FBQ2pCLFVBQUUsS0FBSztBQUFHLGNBQU0sS0FBSyxXQUFXO0FBQUcsY0FBTSxJQUFJLEVBQUUsV0FBVztBQUFHLGFBQUssTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLEVBQUU7QUFDN0gsbUJBQVcsS0FBSyxFQUFFLFVBQVU7QUFDMUIsY0FBSSxFQUFFLFNBQVMsRUFBRztBQUFVLGdCQUFNLE1BQU0sS0FBSyxNQUFNLElBQUksRUFBRSxFQUFFLEdBQUcsSUFBSSxLQUFLLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sR0FBRyxHQUFHLElBQUksS0FBSyxLQUFLLElBQUksRUFBRSxFQUFFO0FBQUcsY0FBSSxDQUFDLEtBQUssQ0FBQyxFQUFHO0FBQ2pKLGdCQUFNLEtBQUssS0FBSyxJQUFJLEVBQUUsSUFBSSxHQUFHLEtBQUssRUFBRSxPQUFPLFNBQVMsR0FBRyxLQUFLLEVBQUUsT0FBTyxTQUFTO0FBQUcsWUFBRSxNQUFNLElBQUk7QUFBRyxZQUFFLFFBQVEsSUFBSTtBQUM5RyxjQUFJLENBQUMsRUFBRSxPQUFPO0FBQUUsY0FBRSxLQUFLLE9BQU87QUFBRyxpQkFBSyxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUcsaUJBQUssT0FBTyxJQUFJLElBQUksSUFBSSxRQUFRLE9BQU8sS0FBSyxNQUFNLENBQUMsR0FBRyxLQUFLLEtBQUssR0FBRztBQUFBLFVBQUc7QUFDM0ssZUFBSztBQUFBLFlBQU07QUFBQSxZQUFLLENBQUMsTUFBTTtBQUFFLGdCQUFFLE9BQU8sU0FBUyxJQUFJLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRyxLQUFLLElBQUksSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQztBQUFHLGdCQUFFLE9BQU8sU0FBUyxNQUFNLEtBQUssS0FBSyxJQUFJLEVBQUUsT0FBTyxTQUFTLEtBQUssS0FBSyxJQUFJLEdBQUcsSUFBSSxNQUFNLEdBQUc7QUFBQSxZQUFHO0FBQUEsWUFDaE4sTUFBTTtBQUFFLGdCQUFFLE9BQU8sU0FBUyxJQUFJO0FBQUcsbUJBQUssTUFBTSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsTUFBTSxLQUFLLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxZQUFHO0FBQUEsVUFBQztBQUFBLFFBQzlHO0FBQUEsTUFDRjtBQUNBLFVBQUksU0FBUyxPQUFPO0FBRWxCLGNBQU0sS0FBSyxTQUFTO0FBQ3BCLG1CQUFXLEtBQUssRUFBRSxTQUFVLEtBQUksRUFBRSxTQUFTLEtBQUssRUFBRSxPQUFPO0FBQUUsZ0JBQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLEVBQUU7QUFBRyxjQUFJLEVBQUcsTUFBSyxNQUFNLEtBQUssT0FBTyxJQUFJLE1BQU0sTUFBTTtBQUFFLGNBQUUsS0FBSyxPQUFPO0FBQUcsa0JBQU0sS0FBSyxFQUFFLElBQUk7QUFBQSxVQUFHLENBQUM7QUFBQSxRQUFHO0FBQ25MLGFBQUssTUFBTSxLQUFLLE1BQU07QUFBRSxlQUFLLFNBQVMsS0FBSyxNQUFNLEVBQUUsT0FBTyxHQUFHO0FBQUcsWUFBRSxLQUFLO0FBQUEsUUFBRyxDQUFDO0FBQzNFLGFBQUssTUFBTSxNQUFNLElBQUk7QUFBRyxhQUFLLE1BQU0sS0FBSyxJQUFJO0FBQUc7QUFBQSxNQUNqRDtBQUNBLFFBQUUsS0FBSztBQUFHLFlBQU0sS0FBSyxXQUFXO0FBQUcsV0FBSyxNQUFNLE1BQU0sTUFBTTtBQUFFLGNBQU0sSUFBSSxFQUFFLFdBQVc7QUFBRyxhQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEdBQUcsS0FBSyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBRyxFQUFFO0FBQUEsTUFBRyxDQUFDO0FBQzNKLFVBQUksU0FBUyxTQUFTO0FBQUUsYUFBSyxNQUFNLEtBQUssTUFBTTtBQUFFLFlBQUUsT0FBTztBQUFHLGdCQUFNLEtBQUssUUFBUTtBQUFBLFFBQUcsQ0FBQztBQUFHLGFBQUssTUFBTSxLQUFLLElBQUk7QUFBRztBQUFBLE1BQVE7QUFDckgsV0FBSyxNQUFNLEdBQUssTUFBTTtBQUNwQixVQUFFLEtBQUs7QUFBRyxjQUFNLEtBQUssV0FBVztBQUFHLGNBQU0sSUFBSSxFQUFFLFdBQVc7QUFDMUQsYUFBSyxPQUFPLEVBQUUsR0FBRyxHQUFHLElBQUksUUFBUSxPQUFPLE1BQU0sTUFBTSxDQUFDLEdBQUcsS0FBSyxJQUFJLEdBQUc7QUFBRyxhQUFLLE9BQU8sRUFBRSxHQUFHLEdBQUcsSUFBSSxRQUFRLE9BQU8sR0FBRyxHQUFHLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRztBQUNuSSxhQUFLLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEdBQUcsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxFQUFFO0FBQzlELG1CQUFXLEtBQUssRUFBRSxVQUFVO0FBQzFCLGNBQUksRUFBRSxTQUFTLEtBQUssQ0FBQyxFQUFFLE1BQU87QUFBVSxnQkFBTSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsRUFBRTtBQUFHLGNBQUksQ0FBQyxFQUFHO0FBQy9FLGdCQUFNLEtBQUssUUFBUSxHQUFHLEVBQUUsSUFBSSxHQUFHLEtBQUssRUFBRSxPQUFPLFNBQVMsR0FBRyxLQUFLLEVBQUUsT0FBTyxTQUFTO0FBQUcsWUFBRSxNQUFNO0FBQzNGLGVBQUssTUFBTSxLQUFLLENBQUMsTUFBTTtBQUFFLGNBQUUsT0FBTyxTQUFTLElBQUksTUFBTSxHQUFHLElBQUksTUFBTSxHQUFHLEtBQUssSUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDO0FBQUcsY0FBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLFNBQVMsSUFBSSxFQUFFLEtBQUssRUFBRSxTQUFTLENBQUM7QUFBQSxVQUFHLEdBQUcsTUFBTTtBQUFFLGNBQUUsT0FBTyxTQUFTLElBQUk7QUFBRyxjQUFFLE1BQU0sQ0FBQztBQUFBLFVBQUcsQ0FBQztBQUFBLFFBQ2hPO0FBQUEsTUFDRixDQUFDO0FBQ0QsV0FBSyxNQUFNLEtBQUssSUFBSTtBQUFHLFdBQUssTUFBTSxLQUFLLElBQUk7QUFBQSxJQUM3QztBQUFBLElBQ0EsVUFBVSxLQUFhO0FBQUUsVUFBSSxDQUFDLEtBQUssTUFBTztBQUFRLGdCQUFVLEtBQUssR0FBRyxLQUFLLE9BQU8sR0FBRztBQUFHLFdBQUssUUFBUTtBQUFNLGlCQUFXLEtBQUssQ0FBQztBQUFHLFdBQUssUUFBUTtBQUFBLElBQUc7QUFBQSxJQUNySSxVQUFVO0FBQ2hCLFdBQUssT0FBTztBQUFPLFdBQUssTUFBTSxPQUFPO0FBQUcsV0FBSyxZQUFZO0FBQ3pELFdBQUssWUFBWTtBQUFHLFdBQUssU0FBUyxJQUFJO0FBQ3RDLGlCQUFXLEtBQUssS0FBSyxFQUFFLE9BQU87QUFDNUIsY0FBTSxJQUFJLEtBQUssUUFBUSxJQUFJLEVBQUUsRUFBRTtBQUFJLGNBQU0sSUFBSSxLQUFLLElBQUksRUFBRSxJQUFJO0FBQUcsVUFBRSxPQUFPLFNBQVMsSUFBSSxFQUFFLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFBRyxVQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFHLFVBQUUsT0FBTyxXQUFXLElBQUk7QUFBRyxVQUFFLE1BQU0sSUFBSTtBQUFHLFVBQUUsUUFBUSxJQUFJO0FBQUcsVUFBRSxLQUFLLE9BQU87QUFBRyxhQUFLLFNBQVMsRUFBRSxHQUFHLEVBQUUsQ0FBQztBQUN4TyxhQUFLLE1BQU0sS0FBSyxNQUFNLEVBQUUsS0FBSyxNQUFNLENBQUM7QUFBQSxNQUN0QztBQUNBLFdBQUssUUFBUTtBQUFTLFdBQUssTUFBTTtBQUFNLFdBQUssVUFBVTtBQUFHLFdBQUssR0FBRyxPQUFPO0FBQ3hFLFdBQUssU0FBUyxLQUFLLE1BQU0sRUFBRSxPQUFPLEdBQUc7QUFBQSxJQUN2QztBQUFBO0FBQUEsSUFFQSxnQkFBeUI7QUFBRSxZQUFNLElBQUksSUFBSSxnQkFBZ0IsU0FBUyxNQUFNO0FBQUcsYUFBTyxDQUFDLEVBQUUsRUFBRSxJQUFJLE9BQU8sS0FBSyxFQUFFLElBQUksT0FBTyxNQUFNLGdCQUFnQixTQUFTLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFDdkosU0FBUyxHQUFXO0FBQ2xCLFVBQUksSUFBSSxLQUFLLENBQUMsS0FBSyxjQUFjLEVBQUc7QUFDcEMsV0FBSyxZQUFZO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUNyQztBQUFBO0FBQUEsSUFHQSxxQkFBcUI7QUFBRSxXQUFLLFFBQVEsUUFBUSxDQUFDLEdBQUcsT0FBTztBQUFFLGNBQU0sSUFBSSxLQUFLLEVBQUUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRTtBQUFHLFlBQUksRUFBRyxHQUFFLFFBQVEsRUFBRSxJQUFJO0FBQUEsTUFBRyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQ3hJLFNBQVMsSUFBSSxLQUFLO0FBQ2hCLFlBQU0sUUFBUSxLQUFLLEVBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxVQUFVLFVBQVUsS0FBSyxFQUFFLE1BQU0sS0FBSyxJQUFJO0FBQUcsVUFBSSxNQUFNLEdBQUcsSUFBSTtBQUNySixZQUFNLEtBQTZCLENBQUMsR0FBRyxLQUFLLFNBQVMsRUFBRTtBQUFPLGlCQUFXLEtBQUssT0FBTyxLQUFLLEVBQUUsRUFBRyxJQUFHLENBQUMsSUFBSyxHQUFXLENBQUMsRUFBRTtBQUN0SCxlQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsS0FBSztBQUFFLGNBQU0sSUFBSSxTQUFTLE9BQU8sU0FBUyxNQUFPLEdBQUcsS0FBSyxJQUFJLFdBQVcsQ0FBQztBQUFHLFlBQUksRUFBRSxXQUFXLEVBQUc7QUFBTyxhQUFLLEVBQUU7QUFBQSxNQUFNO0FBQzNJLGFBQU8sRUFBRSxLQUFLLEtBQUssTUFBTyxNQUFNLElBQUssR0FBRyxHQUFHLFNBQVMsRUFBRSxJQUFJLEdBQUcsUUFBUSxDQUFDLEdBQUcsRUFBRTtBQUFBLElBQzdFO0FBQUEsSUFDQSxRQUFRLE1BQWM7QUFBRSxXQUFLLEVBQUUsS0FBSyxLQUFLLElBQUk7QUFBRyxXQUFLLEVBQUUsTUFBTTtBQUFTLFdBQUssR0FBRyxPQUFPO0FBQUEsSUFBRztBQUFBLElBQ3hGLFlBQVksR0FBVztBQUFFLFdBQUssRUFBRSxPQUFPO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBQSxJQUFHO0FBQUEsSUFDNUQsU0FBaUI7QUFDZixZQUFNLElBQUksS0FBSyxHQUFHLEtBQUssVUFBVSxFQUFFLE1BQU0sS0FBSyxJQUFJO0FBQ2xELGFBQU87QUFBQSxRQUFDLFNBQVMsY0FBYyxJQUFJLGNBQWMsVUFBVSxLQUFLLElBQUksVUFBVSxFQUFFLElBQUksSUFBSSxXQUFXLENBQUMsQ0FBQyxZQUFZLEVBQUUsTUFBTSxjQUFjLGFBQWEsQ0FBQyxDQUFDLElBQUksRUFBRSxHQUFHLFdBQVcsS0FBSyxLQUFLLGFBQWEsS0FBSyxPQUFPO0FBQUEsUUFDM00sU0FBUyxFQUFFLEtBQUssS0FBSyxJQUFJLEtBQUssU0FBUztBQUFBLFFBQUksU0FBUyxFQUFFLE1BQU0sSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLElBQUksR0FBRyxFQUFFLElBQUksSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFLEtBQUssR0FBRyxLQUFLLFFBQVE7QUFBQSxRQUFJLFVBQVUsR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFBQSxRQUNsTCxlQUFlLGNBQWMsc0JBQXNCLEVBQUUsTUFBTSxVQUFVLGlCQUFpQixnQkFBZ0IsRUFBRSxXQUFXO0FBQUEsUUFBSSxhQUFhLEtBQUssV0FBVztBQUFBLFFBQUksV0FBVyxLQUFLLE9BQU8sV0FBVyxJQUFJLEtBQUssT0FBTyxZQUFZLFFBQVEsT0FBTyxnQkFBZ0I7QUFBQSxRQUFJLGdCQUFnQixLQUFLLGNBQWMsR0FBRztBQUFBLFFBQUk7QUFBQSxRQUFhLEdBQUcsRUFBRSxJQUFJLE1BQU0sRUFBRTtBQUFBLFFBQUcsWUFBWSxLQUFLLFVBQVUsRUFBRSxNQUFNLFFBQVEsTUFBTSxPQUFPLFFBQVEsTUFBTSxDQUFDLENBQUM7QUFBQSxNQUFFLEVBQUUsS0FBSyxJQUFJO0FBQUEsSUFDN1o7QUFBQSxJQUNBLGtCQUFrQjtBQUFFLG1CQUFhO0FBQUcsV0FBSyxtQkFBbUI7QUFBQSxJQUFHO0FBQUEsSUFDL0QsSUFBSSxhQUFhO0FBQUUsYUFBTztBQUFBLElBQWdCO0FBQUEsSUFDMUMsaUJBQWlCLE1BQWM7QUFBRSxvQkFBYyxJQUFJO0FBQUcsV0FBSyxHQUFHLE9BQU87QUFBRyxXQUFLLE1BQU0sZUFBZSxJQUFJLCtCQUErQjtBQUFBLElBQUc7QUFBQTtBQUFBLElBR3hJLFVBQVU7QUFDUixlQUFTLEtBQUssVUFBVSxJQUFJLFNBQVM7QUFBRyxXQUFLLE1BQU0sV0FBVyxLQUFLO0FBQUcsWUFBTSxNQUFvQixDQUFDO0FBQUcsVUFBSSxPQUFjO0FBQ3RILFlBQU0sVUFBVSxNQUFNO0FBQUUsWUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUFHLFlBQUksU0FBUztBQUFHLGNBQU0sUUFBUSxDQUFDLE1BQU0sTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLElBQUksTUFBTTtBQUFFLGdCQUFNLElBQUksYUFBYSxLQUFLLEdBQUcsTUFBTSxNQUFNLEVBQUU7QUFBRyxZQUFFLE9BQU8sU0FBUyxLQUFLLElBQUksT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLElBQUk7QUFBRyxZQUFFLE9BQU8sU0FBUyxJQUFJLEtBQUssS0FBSztBQUFNLFlBQUUsS0FBSyxNQUFNO0FBQUcsY0FBSSxLQUFLLENBQUM7QUFBQSxRQUFHLENBQUMsQ0FBQztBQUFBLE1BQUc7QUFDdFQsY0FBUTtBQUFHLFdBQUssT0FBTyxTQUFTLElBQUksR0FBRyxLQUFLLEtBQUs7QUFBRyxXQUFLLE9BQU8sVUFBVSxJQUFJLFFBQVEsUUFBUSxHQUFHLEtBQUssSUFBSSxDQUFDO0FBQUcsV0FBSyxPQUFPLE1BQU07QUFDaEksTUFBQyxPQUFlLFlBQVksRUFBRSxTQUFTLENBQUMsTUFBYTtBQUFFLGVBQU87QUFBRyxnQkFBUTtBQUFBLE1BQUcsR0FBRyxJQUFJO0FBQ25GLFVBQUksT0FBTyxZQUFZLElBQUk7QUFBRyxXQUFLLE9BQU8sY0FBYyxNQUFNO0FBQUUsY0FBTSxJQUFJLFlBQVksSUFBSSxHQUFHLEtBQUssS0FBSyxJQUFJLE9BQU8sSUFBSSxRQUFRLEdBQUk7QUFBRyxlQUFPO0FBQUcsWUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxDQUFDO0FBQUcsYUFBSyxNQUFNLE9BQU87QUFBQSxNQUFHLENBQUM7QUFBQSxJQUN6TTtBQUFBLEVBQ0Y7OztBQzNuQkEsTUFBTSxJQUFJLElBQUksS0FBSztBQUNuQixFQUFDLE9BQWUsU0FBUztBQUN6QixJQUFFLEtBQUssU0FBUyxlQUFlLEdBQUcsQ0FBc0IsRUFDckQsS0FBSyxNQUFNO0FBQUUsVUFBTSxJQUFJLFNBQVMsZUFBZSxTQUFTO0FBQUcsUUFBSSxFQUFHLEdBQUUsTUFBTSxVQUFVO0FBQVEsSUFBQyxPQUFlLGNBQWM7QUFBTSxXQUFPLGNBQWMsSUFBSSxNQUFNLGtCQUFrQixDQUFDO0FBQUEsRUFBRyxDQUFDLEVBQ3RMLE1BQU0sQ0FBQyxNQUFNO0FBQ1osVUFBTSxJQUFJLFNBQVMsZUFBZSxTQUFTO0FBQUcsUUFBSSxHQUFHO0FBQUUsUUFBRSxNQUFNLFVBQVU7QUFBUSxRQUFFLGNBQWMsYUFBYSxLQUFLLEVBQUUsVUFBVSxFQUFFLFVBQVU7QUFBQSxJQUFJO0FBQy9JLFlBQVEsTUFBTSxDQUFDO0FBQUEsRUFDakIsQ0FBQzsiLAogICJuYW1lcyI6IFsiZyIsICJlbmVteVBvd2VyIiwgInRnIiwgIk1BWF9VTklUUyIsICJnIiwgImciLCAiZyIsICJLRVkiLCAiVkVSU0lPTiIsICJzdGFnZVdhdmVzIiwgImRyYXciLCAiZyIsICJnIiwgInYiLCAicCJdCn0K
