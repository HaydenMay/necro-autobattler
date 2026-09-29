// Everything you SEE for a unit: real Tripo models (Skeleton Warrior, Skeleton Archer), simple stand-ins for the four
// characters that are not generated yet, and the "star look" layered on top of both (size, tint, aura, halo, badge).
declare const BABYLON: any;
import { BALANCE } from '../core/balance.ts';
import type { SoulId } from '../core/data.ts';

export type VState = 'idle' | 'run' | 'attack' | 'death' | 'spawn' | 'cheer';

export interface UnitVisual {
  holder: any;                       // TransformNode: the game sets position + yaw here
  team: 0 | 1; star: number; state: VState; top: number;
  play(state: VState, speed?: number): void;
  setStar(star: number): void;
  setTeam(team: 0 | 1): void;
  setHp(frac: number | null): void;  // null hides the health bar
  pulse(): void;                     // brief hit reaction
  update(dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------------- star looks
// 1 star = the plain model. 2 stars = a little bigger, cool silver-blue tint, brighter aura. 3 stars = biggest, warm gold tint,
// strong gold-violet aura and a floating gold halo. Everything here is free: no extra Tripo generations.
const TINT: number[][] = [[1, 1, 1], [0.86, 0.95, 1.18], [1.25, 1.1, 0.7]];
const AURA = [
  { rate: 14, min: 0.06, max: 0.16, c1: [0.78, 0.35, 1, 0.7], c2: [0.45, 0.15, 0.9, 0.5] },
  { rate: 26, min: 0.08, max: 0.20, c1: [0.85, 0.65, 1, 0.8], c2: [0.55, 0.4, 1, 0.6] },
  { rate: 44, min: 0.10, max: 0.26, c1: [1, 0.85, 0.4, 0.85], c2: [0.8, 0.3, 1, 0.7] },
];

export interface Assets {
  scene: any; soft: any; starTex: any[]; tripo: Partial<Record<SoulId, TripoCfg>>;
  ringMat: any[]; haloMat: any; barBg: any; barFill: any[];
}
interface TripoCfg { container: any; enemyTex: any; clips: Record<VState, string>; matCache: Record<string, any>; baseMat?: any; top: number; scale: number }

function dyn(scene: any, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, alpha = true) {
  const t = new BABYLON.DynamicTexture('dt', { width: w, height: h }, scene, true); draw(t.getContext()); t.update(); t.hasAlpha = alpha; return t;
}

export async function loadAssets(scene: any): Promise<Assets> {
  const soft = dyn(scene, 64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
  const starTex = [1, 2, 3].map((n) => dyn(scene, 192, 48, (c) => { c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = '#1a1020'; c.fillStyle = n === 3 ? '#ffd24a' : n === 2 ? '#d7e6ff' : '#f0d9a0'; const s = '★'.repeat(n); c.strokeText(s, 96, 38); c.fillText(s, 96, 38); }));
  const emissive = (r: number, g: number, b: number, a = 1) => { const m = new BABYLON.StandardMaterial('em', scene); m.diffuseColor = BABYLON.Color3.Black(); m.emissiveColor = new BABYLON.Color3(r, g, b); m.disableLighting = true; m.alpha = a; return m; };
  const A: Assets = {
    scene, soft, starTex, tripo: {}, ringMat: [emissive(0.55, 0.2, 0.95, 0.9), emissive(0.95, 0.25, 0.2, 0.9)], haloMat: emissive(1, 0.82, 0.3, 0.95),
    barBg: emissive(0.05, 0.05, 0.08, 0.7), barFill: [emissive(0.55, 0.35, 1), emissive(1, 0.4, 0.3)],
  };
  const defs: [SoulId, string, string, Record<VState, string>, number, number][] = [
    ['warrior', 'skeleton_warrior.glb', 'skeleton_warrior_enemy.jpg', { idle: 'Idle', run: 'Run', attack: 'Attack', death: 'Death', spawn: 'Spawn', cheer: 'Block' }, 1.05, 1.0],
    ['archer', 'SkeletonArcher.glb', 'SkeletonArcher_enemy.jpg', { idle: 'Idle', run: 'Run', attack: 'Shoot', death: 'Death', spawn: 'Spawn', cheer: 'Flex' }, 1.05, 1.0],
  ];
  await Promise.all(defs.map(async ([soul, glb, enemy, clips, top, scale]) => {
    const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('assets/', glb, scene);
    A.tripo[soul] = { container, enemyTex: new BABYLON.Texture('assets/' + enemy, scene, false, false), clips, matCache: {}, top, scale };
  }));
  return A;
}

// ---------------------------------------------------------------------------------------------------- shared decoration
class Deco {
  private ps: any = null; private halo: any = null; private badge: any; private stars: any; private fill: any; private bar: any; private ring: any;
  constructor(private A: Assets, private parent: any, private top: number, private radius: number) {
    const s = A.scene;
    this.ring = BABYLON.MeshBuilder.CreateDisc('ring', { radius: Math.max(0.3, radius * 1.15), tessellation: 26 }, s); this.ring.rotation.x = Math.PI / 2; this.ring.position.y = 0.02; this.ring.parent = parent; this.ring.isPickable = false;
    this.badge = new BABYLON.TransformNode('badge', s); this.badge.parent = parent; this.badge.position.y = top + 0.32; this.badge.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.stars = BABYLON.MeshBuilder.CreatePlane('stars', { width: 0.6, height: 0.15 }, s); this.stars.parent = this.badge; this.stars.position.y = 0.11; this.stars.isPickable = false;
    const sm = new BABYLON.StandardMaterial('sm', s); sm.emissiveColor = BABYLON.Color3.White(); sm.disableLighting = true; sm.useAlphaFromDiffuseTexture = true; this.stars.material = sm; (this.stars as any)._sm = sm;
    const bg = BABYLON.MeshBuilder.CreatePlane('bg', { width: 0.6, height: 0.085 }, s); bg.parent = this.badge; bg.material = A.barBg; bg.isPickable = false; this.bar = bg;
    this.fill = BABYLON.MeshBuilder.CreatePlane('fill', { width: 0.56, height: 0.05 }, s); this.fill.parent = this.badge; this.fill.position.z = -0.002; this.fill.isPickable = false;
    this.bar.setEnabled(false); this.fill.setEnabled(false);
  }
  set(team: 0 | 1, star: number) {
    const s = this.A.scene, cfg = AURA[star - 1];
    (this.stars as any)._sm.diffuseTexture = this.A.starTex[star - 1];
    this.ring.material = this.A.ringMat[team]; this.fill.material = this.A.barFill[team];
    if (team === 0) {                                   // raised by the Necromancer: purple aura that grows with stars
      if (!this.ps) {
        const ps = new BABYLON.ParticleSystem('aura', 70, s); ps.particleTexture = this.A.soft; ps.emitter = this.parent; ps.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.2); ps.maxEmitBox = new BABYLON.Vector3(0.2, this.top * 0.5, 0.2);
        ps.minLifeTime = 0.5; ps.maxLifeTime = 1.1; ps.direction1 = new BABYLON.Vector3(-0.15, 0.8, -0.15); ps.direction2 = new BABYLON.Vector3(0.15, 1.5, 0.15);
        ps.minEmitPower = 0.35; ps.maxEmitPower = 0.8; ps.gravity = new BABYLON.Vector3(0, 0.4, 0); ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD; this.ps = ps;
      }
      const p = this.ps; p.emitRate = cfg.rate; p.minSize = cfg.min; p.maxSize = cfg.max; p.color1 = new BABYLON.Color4(...cfg.c1); p.color2 = new BABYLON.Color4(...cfg.c2); p.colorDead = new BABYLON.Color4(0.2, 0, 0.4, 0);
      if (!p.isStarted()) p.start();
    } else if (this.ps && this.ps.isStarted()) this.ps.stop();
    if (star >= 3) {                                    // gold halo above the head
      if (!this.halo) { this.halo = BABYLON.MeshBuilder.CreateTorus('halo', { diameter: 0.55, thickness: 0.04, tessellation: 24 }, s); this.halo.parent = this.parent; this.halo.position.y = this.top + 0.08; this.halo.material = this.A.haloMat; this.halo.isPickable = false; }
      this.halo.setEnabled(true);
    } else if (this.halo) this.halo.setEnabled(false);
  }
  setHp(f: number | null) {
    const on = f !== null; this.bar.setEnabled(on); this.fill.setEnabled(on);
    if (on) { const k = Math.max(0.001, f as number); this.fill.scaling.x = k; this.fill.position.x = -(0.56 * (1 - k)) / 2; }
  }
  setAura(on: boolean) { if (this.ps) { if (on && !this.ps.isStarted()) this.ps.start(); if (!on && this.ps.isStarted()) this.ps.stop(); } }
  update(dt: number) { if (this.halo && this.halo.isEnabled()) this.halo.rotation.y += dt * 1.6; }
  dispose() { if (this.ps) { this.ps.stop(); this.ps.dispose(); } [this.halo, this.ring, this.stars, this.bar, this.fill].forEach((m) => m && m.dispose()); this.badge.dispose(); }
}

// ---------------------------------------------------------------------------------------------------- real models
class TripoVisual implements UnitVisual {
  holder: any; team: 0 | 1; star = 1; state: VState = 'idle'; top: number;
  private ent: any; private body: any; private anims: Record<string, any> = {}; private cur: any = null; private deco: Deco; private pick: any; private pulseT = 0; private base: number;
  constructor(private A: Assets, private cfg: TripoCfg, soul: SoulId, team: 0 | 1, star: number) {
    const s = A.scene, uid = Math.random().toString(36).slice(2, 7);
    this.ent = cfg.container.instantiateModelsToScene((n: string) => n + '_' + uid, false, { doNotInstantiate: true });
    this.holder = new BABYLON.TransformNode('unit_' + uid, s); this.ent.rootNodes[0].parent = this.holder;
    this.body = this.ent.rootNodes[0].getChildMeshes().find((m: any) => m.name.includes('_Body'));
    if (!cfg.baseMat) cfg.baseMat = this.body.material;
    this.ent.animationGroups.forEach((g: any) => { g.stop(); g.enableBlending = true; g.blendingSpeed = 0.12; this.anims[g.name.split('_')[0]] = g; });
    this.ent.rootNodes[0].getChildMeshes().forEach((m: any) => { m.alwaysSelectAsActiveMesh = true; m.isPickable = false; });
    this.top = cfg.top; this.base = cfg.scale; this.team = team;
    this.deco = new Deco(A, this.holder, this.top, 0.3);
    this.pick = BABYLON.MeshBuilder.CreateCylinder('pick', { height: 1.3, diameter: 0.8 }, s); this.pick.parent = this.holder; this.pick.position.y = 0.6; this.pick.visibility = 0.001; this.pick.isPickable = true;
    this.setTeam(team); this.setStar(star); this.pick.metadata = { kind: 'unit', visual: this };
  }
  private applyMat() {
    const key = this.team + '_' + this.star, c = this.cfg;
    if (!c.matCache[key]) { const m = c.baseMat.clone('m_' + key); if (this.team === 1) m.albedoTexture = c.enemyTex; const t = TINT[this.star - 1]; m.albedoColor = new BABYLON.Color3(t[0], t[1], t[2]); c.matCache[key] = m; }
    this.body.material = c.matCache[key];
  }
  setTeam(t: 0 | 1) { this.team = t; this.applyMat(); this.deco.set(t, this.star); }
  setStar(st: number) { this.star = st; this.applyMat(); this.holder.scaling.setAll(BALANCE.star.scale[st - 1] * this.base); this.deco.set(this.team, st); }
  setHp(f: number | null) { this.deco.setHp(f); }
  pulse() { this.pulseT = 0.16; }
  play(state: VState, speed = 1) {
    const g = this.anims[this.cfg.clips[state]]; if (!g) return; const loop = state === 'idle' || state === 'run';
    if (loop && this.state === state && this.cur === g) return;
    if (this.cur) this.cur.stop(); g.stop(); g.start(loop, speed, g.from, g.to);
    if (loop) g.goToFrame(g.from + Math.random() * (g.to - g.from));
    this.cur = g; this.state = state; this.deco.setAura(state !== 'death');
  }
  update(dt: number) {
    this.deco.update(dt);
    if (this.pulseT > 0) { this.pulseT -= dt; const k = 1 + 0.09 * Math.sin(Math.max(0, this.pulseT) / 0.16 * Math.PI); this.holder.scaling.setAll(BALANCE.star.scale[this.star - 1] * this.base * k); }
  }
  dispose() { this.deco.dispose(); this.ent.animationGroups.forEach((g: any) => g.dispose()); this.ent.skeletons.forEach((s: any) => s.dispose()); this.pick.dispose(); this.ent.rootNodes[0].dispose(false, false); this.holder.dispose(); }
}

// ---------------------------------------------------------------------------------------------------- stand-ins
const PH: Record<string, { col: string; w: number; h: number; head: number; weapon: string; label: string }> = {
  goblin: { col: '#63b13f', w: 0.36, h: 0.42, head: 0.36, weapon: 'dagger', label: 'GOBLIN' },
  knight: { col: '#8ea9dc', w: 0.5, h: 0.6, head: 0.36, weapon: 'shield', label: 'KNIGHT' },
  ogre: { col: '#a8a64a', w: 0.85, h: 0.85, head: 0.42, weapon: 'mace', label: 'OGRE' },
  barbarian: { col: '#d68a55', w: 0.52, h: 0.62, head: 0.38, weapon: 'axe', label: 'BARBARIAN' },
};
class PlaceholderVisual implements UnitVisual {
  holder: any; team: 0 | 1; star = 1; state: VState = 'idle'; top: number;
  private rig: any; private legs: any[] = []; private wp: any; private deco: Deco; private pick: any; private t = Math.random() * 6; private st0 = 0; private dur = 1; private base = 1; private pulseT = 0; private mats: any[] = []; private body: any;
  constructor(private A: Assets, private soul: string, team: 0 | 1, star: number) {
    const s = A.scene, d = PH[soul]; this.team = team;
    this.holder = new BABYLON.TransformNode('ph_' + soul, s); this.rig = new BABYLON.TransformNode('rig', s); this.rig.parent = this.holder;
    const mat = (hex: string, em = 0) => { const m = new BABYLON.StandardMaterial('pm', s); m.diffuseColor = BABYLON.Color3.FromHexString(hex).scale(0.72); m.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); if (em) m.emissiveColor = m.diffuseColor.scale(em); return m; };
    const legH = 0.22, bodyY = legH + d.h / 2;
    for (const sx of [-1, 1]) { const lg = new BABYLON.TransformNode('leg', s); lg.parent = this.rig; lg.position.set(sx * d.w * 0.22, legH, 0); const m = BABYLON.MeshBuilder.CreateCylinder('l', { height: legH, diameter: d.w * 0.28 }, s); m.parent = lg; m.position.y = -legH / 2; m.material = mat('#4a3826'); m.isPickable = false; this.legs.push(lg); }
    this.body = BABYLON.MeshBuilder.CreateCapsule('body', { radius: d.w / 2, height: d.h + d.w * 0.4 }, s); this.body.parent = this.rig; this.body.position.y = bodyY; this.body.material = mat(d.col); this.body.isPickable = false;
    const head = BABYLON.MeshBuilder.CreateSphere('head', { diameter: d.head * 1.5, segments: 12 }, s); head.parent = this.rig; head.position.y = legH + d.h + d.head * 0.55; head.material = mat(d.col); head.isPickable = false;
    const eyeM = new BABYLON.StandardMaterial('eye', s); eyeM.diffuseColor = BABYLON.Color3.Black(); eyeM.emissiveColor = team === 0 ? new BABYLON.Color3(0.75, 0.25, 1) : new BABYLON.Color3(1, 0.66, 0.19); (this as any).eyeM = eyeM;
    for (const sx of [-1, 1]) { const e = BABYLON.MeshBuilder.CreateSphere('e', { diameter: d.head * 0.3 }, s); e.parent = this.rig; e.position.set(sx * d.head * 0.3, head.position.y + 0.02, d.head * 0.66); e.material = eyeM; e.isPickable = false; }
    // weapon pivot at the shoulder, on the character's right (-x is fine for a stand-in)
    this.wp = new BABYLON.TransformNode('wp', s); this.wp.parent = this.rig; this.wp.position.set(d.w * 0.6, legH + d.h * 0.85, 0.05);
    const wm = mat('#7a5a30'), iron = mat('#9aa1ad');
    const mk = (m: any, kind: string, dims: any, pos: number[], mt: any) => { const x = kind === 'box' ? BABYLON.MeshBuilder.CreateBox('w', dims, s) : kind === 'cyl' ? BABYLON.MeshBuilder.CreateCylinder('w', dims, s) : BABYLON.MeshBuilder.CreateSphere('w', dims, s); x.parent = this.wp; x.position.set(pos[0], pos[1], pos[2]); x.material = mt; x.isPickable = false; return x; };
    if (d.weapon === 'dagger') mk(0, 'box', { width: 0.05, height: 0.3, depth: 0.03 }, [0, -0.2, 0.12], iron);
    if (d.weapon === 'shield') { mk(0, 'box', { width: 0.06, height: 0.5, depth: 0.04 }, [0, -0.3, 0.14], iron); const sh = BABYLON.MeshBuilder.CreateCylinder('sh', { height: 0.05, diameter: 0.55 }, s); sh.parent = this.rig; sh.rotation.z = Math.PI / 2; sh.position.set(-d.w * 0.7, legH + d.h * 0.6, 0.05); sh.material = mat('#d8b64a'); sh.isPickable = false; }
    if (d.weapon === 'mace') { mk(0, 'cyl', { height: 0.9, diameter: 0.08 }, [0, -0.35, 0.3], wm); mk(0, 'sph', { diameter: 0.4 }, [0, -0.85, 0.4], iron); }
    if (d.weapon === 'axe') { mk(0, 'cyl', { height: 0.6, diameter: 0.05 }, [0, -0.2, 0.15], wm); mk(0, 'box', { width: 0.32, height: 0.22, depth: 0.05 }, [0, -0.5, 0.15], iron); const hair = BABYLON.MeshBuilder.CreateCylinder('hair', { height: 0.3, diameterTop: 0, diameterBottom: d.head * 1.2 }, s); hair.parent = this.rig; hair.position.y = head.position.y + d.head * 0.75; hair.material = mat('#c22a1c'); hair.isPickable = false; }
    this.top = legH + d.h + d.head * 1.35; this.deco = new Deco(A, this.holder, this.top, d.w * 0.7);
    const lbl = dyn(s, 256, 48, (c) => { c.font = 'bold 26px sans-serif'; c.textAlign = 'center'; c.fillStyle = '#ffffff'; c.strokeStyle = '#111'; c.lineWidth = 5; c.strokeText(d.label + ' (stand-in)', 128, 34); c.fillText(d.label + ' (stand-in)', 128, 34); });
    const lp = BABYLON.MeshBuilder.CreatePlane('lbl', { width: 1.1, height: 0.2 }, s); lp.parent = this.holder; lp.position.y = -0.1; lp.rotation.x = Math.PI / 2 * 0.0; lp.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; const lm = new BABYLON.StandardMaterial('lm', s); lm.diffuseTexture = lbl; lm.emissiveColor = BABYLON.Color3.White(); lm.disableLighting = true; lm.useAlphaFromDiffuseTexture = true; lp.material = lm; lp.isPickable = false; lp.position.y = this.top + 0.62;
    this.pick = BABYLON.MeshBuilder.CreateCylinder('pick', { height: this.top, diameter: Math.max(0.7, d.w * 1.3) }, s); this.pick.parent = this.holder; this.pick.position.y = this.top / 2; this.pick.visibility = 0.001; this.pick.metadata = { kind: 'unit', visual: this };
    (this as any).parts = [lp]; this.setTeam(team); this.setStar(star); this.play('idle');
  }
  setTeam(t: 0 | 1) { this.team = t; (this as any).eyeM.emissiveColor = t === 0 ? new BABYLON.Color3(0.75, 0.25, 1) : new BABYLON.Color3(1, 0.66, 0.19); this.deco.set(t, this.star); }
  setStar(st: number) { this.star = st; this.base = BALANCE.star.scale[st - 1]; const t = TINT[st - 1]; this.body.material.diffuseColor = BABYLON.Color3.FromHexString(PH[this.soul].col).scale(0.72).multiply(new BABYLON.Color3(Math.min(1, t[0]), Math.min(1, t[1]), Math.min(1, t[2]))); this.holder.scaling.setAll(this.base); this.deco.set(this.team, st); }
  setHp(f: number | null) { this.deco.setHp(f); }
  pulse() { this.pulseT = 0.16; }
  play(state: VState, speed = 1) { if (state === this.state && (state === 'idle' || state === 'run')) return; this.state = state; this.st0 = this.t; this.dur = state === 'attack' ? (BALANCE.stats[this.soul as SoulId].animLen / speed) : state === 'death' ? 0.6 : state === 'spawn' ? 0.9 : 1.0; this.deco.setAura(state !== 'death'); }
  update(dt: number) {
    this.t += dt; this.deco.update(dt); const p = Math.min(1, (this.t - this.st0) / this.dur), R = this.rig, W = this.wp;
    R.position.set(0, 0, 0); R.rotation.set(0, 0, 0); R.scaling.setAll(1); W.rotation.x = -0.4; this.legs.forEach((l) => (l.rotation.x = 0));
    if (this.state === 'idle') R.position.y = Math.sin(this.t * 2.2) * 0.012;
    else if (this.state === 'run') { const w = this.t * 10; R.position.y = Math.abs(Math.sin(w)) * 0.07; R.rotation.x = 0.2; this.legs[0].rotation.x = Math.sin(w) * 0.9; this.legs[1].rotation.x = -Math.sin(w) * 0.9; W.rotation.x = -0.4 + Math.sin(w) * 0.4; }
    else if (this.state === 'attack') { const k = p < 0.4 ? -2.4 * (p / 0.4) : -2.4 + 3.4 * Math.min(1, (p - 0.4) / 0.25); W.rotation.x = k; R.position.z = 0.14 * Math.sin(Math.PI * p); R.rotation.x = 0.15 * Math.sin(Math.PI * p); }
    else if (this.state === 'spawn') { const e = p * p * (3 - 2 * p); R.scaling.setAll(0.01 + 0.99 * e); R.position.y = (e - 1) * 0.4; }
    else if (this.state === 'death') { const e = p * p; R.rotation.x = -Math.PI / 2 * e; R.position.y = 0.25 * e; R.position.z = -0.2 * e; }
    else if (this.state === 'cheer') { R.position.y = Math.abs(Math.sin(this.t * 7)) * 0.15; W.rotation.x = -2.6; }
    if (this.pulseT > 0) { this.pulseT -= dt; const k = 1 + 0.09 * Math.sin(Math.max(0, this.pulseT) / 0.16 * Math.PI); this.holder.scaling.setAll(this.base * k); }
  }
  dispose() { this.deco.dispose(); this.holder.getChildMeshes().forEach((m: any) => m.dispose()); this.holder.dispose(); }
}

export function createVisual(A: Assets, soul: SoulId, team: 0 | 1, star: number): UnitVisual {
  const cfg = A.tripo[soul];
  return cfg ? new TripoVisual(A, cfg, soul, team, star) : new PlaceholderVisual(A, soul, team, star);
}
export const isTripo = (A: Assets, soul: SoulId) => !!A.tripo[soul];
