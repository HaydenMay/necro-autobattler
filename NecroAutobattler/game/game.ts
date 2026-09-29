// The playable prototype: build screen -> battle -> draft -> next wave, built on the tested rules + battle engine.
declare const BABYLON: any;
import { BALANCE, resetBalance, SOUL_NAME } from '../core/balance.ts';
import { GRID_CELLS, GRID_COLS, GRID_ROWS, SOULS } from '../core/data.ts';
import type { SoulId } from '../core/data.ts';
import {
  advanceWave, canMergeDeployed, canMergeFromHand, canSummon, cellFree, cost, discardRedraw, dismiss, dominionFree, dominionUsed, draftOptions, failWave,
  mergeDeployed, mergeFromHand, moveUnit, newStage, normalDraw, stageWaves, summon, swapSell, takeDraft,
} from '../core/rules.ts';
import type { State } from '../core/rules.ts';
import { buildArena } from './arena.ts';
import { Battle, cellPos, FRONT_X, GRID_SP, simulate } from '../core/battle.ts';
import type { BEvent } from '../core/battle.ts';
import { currentStageId, difficultyName, enemyPower, enemyWave, setDifficulty, setStageDifficulty } from '../core/waves.ts';
import { PROTOTYPE_RULES } from '../core/prototype.ts';
import { loadSave } from '../core/save.ts';
import { Necromancer } from './necromancer.ts';
import { audio } from './audio.ts';
import { clearRun, loadRun, saveRun, serializeState } from '../core/runsave.ts';
import { playable, recordClearAndSave } from '../core/progress.ts';
import type { ClearReward } from '../core/progress.ts';
import type { RunSnapshot } from '../core/runsave.ts';
import type { State } from '../core/rules.ts';
import { createVisual, isTripo, loadAssets } from './visuals.ts';
import type { Assets, UnitVisual } from './visuals.ts';
import { Ui } from './ui.ts';

export type Phase = 'build' | 'transition' | 'battle' | 'draft' | 'won' | 'lost';
type Sel = { type: 'card'; idx: number } | { type: 'unit'; id: number } | null;

export class Game {
  engine: any; scene: any; camera: any; A!: Assets; ui!: Ui;
  s!: State; seed = 1; attempt = 0; phase: Phase = 'build'; battle: Battle | null = null; timeScale = 1;
  sel: Sel = null; swapMode = false; confirmRemove = false; draft: SoulId[] | null = null; lastBattle = '';
  private unitVis = new Map<number, UnitVisual>();        // unit id -> visual (your army, persists between waves)
  private visToUnit = new Map<UnitVisual, number>();
  private fvis = new Map<number, UnitVisual>();           // fighter id -> visual during a battle
  private fUnit = new Map<number, number>();              // fighter id -> unit id (player side)
  private lastState = new Map<number, string>();
  private arena!: { update(t: number): void; setTheme(stage: string): void };
  private tiles: any[] = []; private tileMats: any[] = []; private ringFx: any[] = []; private arrows: any[] = []; private timers: { t: number; fn: () => void }[] = [];
  private acc = 0; private camFrom: any = null; private camTo: any = null; private camT = 1; private camDur = 2.0; private resultAt = -1; private handled = false; private startStepAt = 0;
  private arrowMats: any[] = []; private arrowMesh: any[] = [];
  necro!: Necromancer;
  /** What the last stage clear earned (shown on the stage-cleared screen). */
  reward: ClearReward | null = null;
  private cine = false;                                   // a result cutscene is playing: the battle camera and fighter sync stand down
  private tweens: { t: number; dur: number; fn: (u: number) => void; done?: () => void }[] = [];
  private tween(dur: number, fn: (u: number) => void, done?: () => void) { this.tweens.push({ t: 0, dur, fn, done }); }
  /** Finish every running animation at once (so nothing is left half-way or undisposed when the phase changes). */
  private flushTweens() { for (const w of this.tweens.splice(0)) { w.fn(1); if (w.done) w.done(); } }
  private seenMerges = 0;

  async init(canvas: HTMLCanvasElement) {
    const qs = new URLSearchParams(location.search);
    this.engine = new BABYLON.Engine(canvas, true, { antialias: true, powerPreference: 'high-performance' });
    const dpr = window.devicePixelRatio || 1; this.engine.setHardwareScalingLevel(1 / Math.min(dpr, 1.5));
    const scene = this.scene = new BABYLON.Scene(this.engine); scene.clearColor = new BABYLON.Color4(0.09, 0.07, 0.13, 1);
    const hemi = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0.2, 1, 0.3), scene); hemi.intensity = 1.05; hemi.groundColor = new BABYLON.Color3(0.32, 0.26, 0.42);
    const sun = new BABYLON.DirectionalLight('s', new BABYLON.Vector3(-0.4, -1, 0.55), scene); sun.intensity = 0.85;
    this.camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 8, -9), scene); this.camera.minZ = 0.1; this.camera.maxZ = 200; this.camera.fov = 0.8; this.camera.inputs.clear();

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 60, height: 40 }, scene);
    ground.isPickable = false; const arena = this.arena = buildArena(scene, ground); scene.onBeforeRenderObservable.add(() => arena.update(performance.now() / 1000));
    for (const team of [0, 1] as const) for (let c = 0; c < GRID_CELLS; c++) { const t = this.makeTile(team, c); if (team === 0) this.tiles.push(t); else t.setEnabled(false); }

    this.A = await loadAssets(scene);
    this.necro = new Necromancer(scene, this.A.soft);       // stands just behind his army's back column, facing the battlefield
    this.necro.holder.position.set(-(FRONT_X + (GRID_COLS - 1) * GRID_SP) - 1.05, 0, 0); this.necro.holder.rotation.y = Math.PI / 2;
    this.arrowMats = [0, 1].map((t) => { const m = new BABYLON.StandardMaterial('am' + t, scene); m.diffuseColor = BABYLON.Color3.Black(); m.emissiveColor = t === 0 ? new BABYLON.Color3(0.75, 0.3, 1) : new BABYLON.Color3(1, 0.7, 0.25); m.disableLighting = true; return m; });
    this.ui = new Ui(this); this.seed = +(qs.get('seed') || 1); if (qs.get('fps')) this.setShowFps(true);

    // Taps are detected here (not through Babylon) so they behave the same in Safari, the home-screen app and on desktop.
    let down: { x: number; y: number; t: number } | null = null;
    const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => { down = { ...local(e), t: performance.now() }; });
    canvas.addEventListener('pointerup', (e) => { if (!down) return; const p = local(e); const moved = Math.hypot(p.x - down.x, p.y - down.y), dt = performance.now() - down.t; down = null; if (moved < 16 && dt < 900) this.tap(p.x, p.y); });
    canvas.addEventListener('pointercancel', () => { down = null; });
    this.canvas = canvas; const onResize = () => this.handleResize();
    window.addEventListener('resize', onResize); window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    if ((window as any).visualViewport) (window as any).visualViewport.addEventListener('resize', onResize);
    if ((window as any).ResizeObserver) new (window as any).ResizeObserver(onResize).observe(canvas);
    if (qs.get('gallery')) { this.gallery(); return; }
    const saved = qs.get('seed') ? null : loadRun();                // ?seed=N always starts fresh (debugging); otherwise pick up where the last visit left off
    if (saved) this.restore(saved); else this.startStage(this.seed);
    let last = performance.now();
    this.engine.runRenderLoop(() => { const now = performance.now(), raw = now - last; const dt = Math.min(0.05, raw / 1000); last = now; if (!this.active) return; if (!this.frozen) this.frame(dt); scene.render(); this.perfTick(raw); });
  }
  /** The navigation shell hides the battle screen while another tab is open: pause the game so it costs nothing. */
  private active = true;
  /** Debug: keep drawing but stop advancing time, so a moment can be stepped through with frame(dt) and screenshotted. */
  frozen = false;
  step(dt: number) { this.frame(dt); }
  setActive(on: boolean) { this.active = on; }

  // -------------------------------------------------------------------------------------------- scene helpers
  /** The placement grid is a build-screen tool: hide it during the fight so the battle looks like a scene, not a board. */
  private showGrid(on: boolean) { for (const t of this.tiles) t.setEnabled(on); }
  private makeTile(team: 0 | 1, cell: number) {
    const p = cellPos(team, cell), t = BABYLON.MeshBuilder.CreatePlane('tile' + cell, { size: GRID_SP * 0.92 }, this.scene);
    t.rotation.x = Math.PI / 2; t.position.set(p.x, 0.015, p.z);
    const m = new BABYLON.StandardMaterial('tm', this.scene); m.diffuseColor = BABYLON.Color3.Black(); m.emissiveColor = team === 0 ? new BABYLON.Color3(0.18, 0.12, 0.42) : new BABYLON.Color3(0.42, 0.12, 0.12); m.alpha = 0.5; m.disableLighting = true; t.material = m;
    if (team === 0) { t.metadata = { kind: 'tile', cell }; this.tileMats[cell] = m; } else t.isPickable = false;
    return t;
  }
  private tint(cell: number, mode: 'normal' | 'free' | 'sel' | 'partner') {
    const m = this.tileMats[cell]; const c = { normal: [0.18, 0.12, 0.42, 0.5], free: [0.2, 0.75, 0.55, 0.7], sel: [1, 0.82, 0.3, 0.85], partner: [0.85, 0.35, 1, 0.85] }[mode];
    m.emissiveColor = new BABYLON.Color3(c[0], c[1], c[2]); m.alpha = c[3];
  }
  later(sec: number, fn: () => void) { this.timers.push({ t: sec, fn }); }
  private fxRing(x: number, z: number, color: any, r0: number, r1: number, dur: number) {
    const m = BABYLON.MeshBuilder.CreateTorus('fx', { diameter: 1, thickness: 0.035, tessellation: 28 }, this.scene); m.position.set(x, 0.05, z); m.isPickable = false;
    const mm = new BABYLON.StandardMaterial('fxm', this.scene); mm.emissiveColor = color; mm.disableLighting = true; mm.alpha = 0.9; m.material = mm; this.ringFx.push({ m, mm, t: 0, r0, r1, dur });
  }
  private burst(x: number, z: number, c1: number[], c2: number[], count: number) {
    const ps = new BABYLON.ParticleSystem('b', 60, this.scene); ps.particleTexture = this.A.soft; ps.emitter = new BABYLON.Vector3(x, 0.05, z); ps.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.2); ps.maxEmitBox = new BABYLON.Vector3(0.2, 0.05, 0.2);
    ps.color1 = new BABYLON.Color4(...(c1 as [number, number, number, number])); ps.color2 = new BABYLON.Color4(...(c2 as [number, number, number, number])); ps.colorDead = new BABYLON.Color4(0.1, 0, 0.2, 0);
    ps.minSize = 0.12; ps.maxSize = 0.34; ps.minLifeTime = 0.4; ps.maxLifeTime = 0.9; ps.emitRate = 0; ps.manualEmitCount = count; ps.direction1 = new BABYLON.Vector3(-1, 1.3, -1); ps.direction2 = new BABYLON.Vector3(1, 2.4, 1);
    ps.minEmitPower = 0.8; ps.maxEmitPower = 2; ps.gravity = new BABYLON.Vector3(0, -2, 0); ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD; ps.targetStopDuration = 1.2; ps.disposeOnStop = true; ps.start();
  }

  // -------------------------------------------------------------------------------------------- camera
  private poses() {
    const asp = this.engine.getRenderWidth() / this.engine.getRenderHeight(), tanV = Math.tan(this.camera.fov / 2);
    const half = FRONT_X + (GRID_COLS - 1) * GRID_SP + 1.4;
    const d = Math.max(half / (tanV * asp), ((GRID_ROWS * GRID_SP) / 2 + 2) / (tanV * 0.55), 8);
    const battle = { pos: new BABYLON.Vector3(-0.1 * d, 0.42 * d + 0.5, -0.86 * d), tgt: new BABYLON.Vector3(0, 0.35, 0) };
    // Build view: (almost) straight down, with the whole grid inside the band between the top bar and the hand of cards.
    const cx = -(FRONT_X + ((GRID_COLS - 1) * GRID_SP) / 2), H = Math.max(1, this.canvas.clientHeight);
    const box = (id: string) => { const el = document.getElementById(id); return el && el.offsetParent !== null ? el.getBoundingClientRect() : null; };
    const topBar = box('top'), hand = box('hand'), info = box('info');
    const TOP = Math.min(0.32, topBar ? (topBar.bottom + 6) / H : 0.1);
    const BOTTOM = Math.min(0.5, (H - Math.min(hand ? hand.top : H, info ? info.top : H) + 6) / H);
    const band = Math.max(0.3, 1 - TOP - BOTTOM), centerFrac = TOP + band / 2;          // the grid's centre appears at this fraction from the top
    const gw = GRID_COLS * GRID_SP + 3.2, gh = GRID_ROWS * GRID_SP + 0.5;                // the width also leaves room for the Necromancer beside the grid
    const d2 = Math.max(gh / (2 * tanV * band), gw / (2 * tanV * asp * 0.88), 4.5);
    const shift = (0.5 - centerFrac) * 2 * d2 * tanV, bx = cx - 0.6;
    const build = { pos: new BABYLON.Vector3(bx, d2, -shift - 0.1 * d2), tgt: new BABYLON.Vector3(bx, 0, -shift) };
    const necro = { pos: new BABYLON.Vector3(battle.pos.x - 1.4, battle.pos.y * 1.12, battle.pos.z * 1.12), tgt: new BABYLON.Vector3(-1.4, 0.35, 0) };   // result cutscenes: him and the field
    return { battle, build, necro };
  }
  /** The hand / info bar can change size in the build phase (long ability text, more cards): re-frame so the grid never hides behind it. */
  reframeBuild() {
    if (this.phase !== 'build' || this.camT < 1 || this.cine || !this.canvas) return;
    const p = this.poses().build, c = this.camera.position;
    if (!isFinite(p.pos.x) || BABYLON.Vector3.Distance(c, p.pos) < 0.06) return;
    this.tweenCam(p, 0.35);
  }
  private canvas!: HTMLCanvasElement; private lastW = 0; private lastH = 0; lastTapInfo = '(no taps yet)';
  private handleResize() {
    if (!this.canvas.clientWidth || !this.canvas.clientHeight) return;   // hidden behind another tab
    this.engine.resize(); this.lastW = this.canvas.clientWidth; this.lastH = this.canvas.clientHeight;
    if (this.phase === 'build' && this.camT >= 1) this.setCam(this.poses().build);
  }
  /** A tap on the 3D view: pick a tile or a unit. */
  private tap(x: number, y: number) {
    const p = this.scene.pick(x, y, (m: any) => !!(m.metadata && m.metadata.kind));
    const md = p && p.hit ? p.pickedMesh.metadata : null;
    this.lastTapInfo = `tap ${Math.round(x)},${Math.round(y)} of ${this.canvas.clientWidth}x${this.canvas.clientHeight} -> ${md ? (md.kind === 'tile' ? 'tile ' + md.cell : 'unit') : 'nothing'} (phase ${this.phase})`;
    if (this.phase !== 'build' || !md) return;
    if (md.kind === 'tile') this.onTile(md.cell); else if (md.kind === 'unit') this.onUnitVisual(md.visual);
  }
  private setCam(p: any) { this.camera.position.copyFrom(p.pos); this.camera.setTarget(p.tgt.clone()); }
  private tweenCam(to: any, dur: number) { this.camFrom = { pos: this.camera.position.clone(), tgt: this.camera.getTarget().clone() }; this.camTo = to; this.camT = 0; this.camDur = dur; }

  // ---- battle camera: follows the fighters that are still alive, so the action (and the purple eyes) stays large on screen
  camMode: 'close' | 'wide' = 'close'; private camTgt: any = new BABYLON.Vector3(0, 0.5, 0);
  setCamMode(m: 'close' | 'wide') {
    this.camMode = m;
    if (m === 'wide' && this.battle) this.tweenCam(this.poses().battle, 0.9);
    this.ui.render();
  }
  private frameBattle(dt: number) {
    const b = this.battle; if (!b) return; const alive = b.fighters.filter((f) => f.alive); if (!alive.length) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const f of alive) { x0 = Math.min(x0, f.x); x1 = Math.max(x1, f.x); z0 = Math.min(z0, f.z); z1 = Math.max(z1, f.z); }
    const asp = this.engine.getRenderWidth() / this.engine.getRenderHeight(), tanV = Math.tan(this.camera.fov / 2);
    const wide = this.poses().battle, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const d = Math.min(Math.max((x1 - x0 + 3.4) / (2 * tanV * asp * 0.9), (z1 - z0 + 3.2) / (2 * tanV * 0.62), 5.4), Math.hypot(wide.pos.y, wide.pos.z));
    const tgt = new BABYLON.Vector3(cx, 0.55, cz), pos = new BABYLON.Vector3(cx - 0.06 * d, 0.32 * d + 0.5, cz - 0.9 * d);
    const k = 1 - Math.exp(-dt * 2.0);
    this.camera.position = BABYLON.Vector3.Lerp(this.camera.position, pos, k); this.camTgt = BABYLON.Vector3.Lerp(this.camTgt, tgt, k); this.camera.setTarget(this.camTgt.clone());
  }

  // -------------------------------------------------------------------------------------------- stage flow
  /** Write the run to disk (calm moments only: build phase and the victory draft). */
  private persistRun() {
    try {
      const s = this.s; if (!s) return;
      if (s.status !== 'building') { clearRun(); return; }
      if (this.phase !== 'build' && this.phase !== 'draft') return;
      const snap: RunSnapshot = { v: 1, seed: this.seed, attempt: this.attempt, stage: currentStageId, difficulty: difficultyName, phase: this.phase, draft: this.phase === 'draft' ? this.draft : null, state: serializeState(s) };
      saveRun(snap);
    } catch { /* never let saving break the game */ }
  }
  /** Rebuild the screen from a saved run (a reload, or Safari discarding the page). */
  private restore(r: { snap: RunSnapshot; state: State }) {
    const { snap, state } = r;
    this.cine = false; this.flushTweens(); this.necro.revive(); setStageDifficulty(snap.stage, snap.difficulty); this.arena.setTheme(currentStageId);
    this.seed = snap.seed; this.attempt = snap.attempt; this.s = state; this.seenMerges = state.stats.merges;
    this.clearBattle(); [...this.unitVis.values()].forEach((v) => v.dispose()); this.unitVis.clear(); this.visToUnit.clear();
    this.sel = null; this.swapMode = false; this.draft = snap.phase === 'draft' ? snap.draft : null; this.phase = this.draft ? 'draft' : 'build';
    this.syncBuild(); this.ui.render(); this.setCam(this.poses().build); this.toast(`Run restored: wave ${state.wave}/${stageWaves(state)}, ${state.hearts} heart${state.hearts === 1 ? '' : 's'}.`);
  }

  // ---- performance readout: rolling frame stats, per-battle summaries, optional on-screen FPS, and a paste-friendly report
  showFps = false; perfNow = { fps: 0, avg: 0, p95: 0, worst: 0 }; perfLog: any[] = [];
  private perfBuf = new Float32Array(240); private perfN = 0; private perfI = 0; private perfShownAt = 0; private instr: any = null; private fpsHud: HTMLElement | null = null;
  private curBattle: { frames: number; sum: number; worst: number; slow: number; scale: number } | null = null;
  setShowFps(on: boolean) {
    this.showFps = on;
    if (on && !this.fpsHud) { const h = document.createElement('div'); h.id = 'fpsHud'; (document.getElementById('battleHost') || document.body).appendChild(h); this.fpsHud = h; }
    if (this.fpsHud) this.fpsHud.style.display = on ? 'block' : 'none';
  }
  private perfTick(ms: number) {
    if (ms > 500) return;                                  // the tab was hidden or the phone paused us: not a real frame
    this.perfBuf[this.perfI] = ms; this.perfI = (this.perfI + 1) % this.perfBuf.length; this.perfN = Math.min(this.perfBuf.length, this.perfN + 1);
    const c = this.curBattle;
    if (c && (this.phase === 'battle' || this.phase === 'transition')) { c.frames++; c.sum += ms; if (ms > c.worst) c.worst = ms; if (ms > 33.4) c.slow++; c.scale = Math.max(c.scale, this.timeScale); }
    const now = performance.now(); if (now - this.perfShownAt < 500) return; this.perfShownAt = now;
    const a = Array.from(this.perfBuf.subarray(0, this.perfN)).sort((x, y) => x - y), avg = a.reduce((n, x) => n + x, 0) / a.length;
    this.perfNow = { fps: 1000 / avg, avg, p95: a[Math.floor(a.length * 0.95)] ?? 0, worst: a[a.length - 1] ?? 0 };
    if (this.fpsHud && this.showFps) this.fpsHud.textContent = `${this.perfNow.fps.toFixed(0)} fps  ${this.perfNow.avg.toFixed(1)}ms  slow5% ${this.perfNow.p95.toFixed(0)}ms`;
    this.ui.renderDebugLive();
  }
  private beginBattlePerf() { this.curBattle = { frames: 0, sum: 0, worst: 0, slow: 0, scale: this.timeScale }; }
  private endBattlePerf() {
    const c = this.curBattle; this.curBattle = null; if (!c || !c.frames) return;
    this.perfLog.push({ wave: this.s.wave, attempt: this.attempt, speed: c.scale, fighters: this.battle ? this.battle.fighters.length : 0, fps: +(1000 / (c.sum / c.frames)).toFixed(0), worstMs: +c.worst.toFixed(0), slowPct: +((100 * c.slow) / c.frames).toFixed(1) });
    if (this.perfLog.length > 12) this.perfLog.shift();
  }
  perfInfo() {
    const sc = this.scene; if (!this.instr && BABYLON.SceneInstrumentation) this.instr = new BABYLON.SceneInstrumentation(sc);
    return { ...this.perfNow, meshes: sc.getActiveMeshes().length, particles: sc.particleSystems.length, draws: this.instr ? this.instr.drawCallsCounter.current : -1 };
  }
  perfReport(): string {
    const p = this.perfInfo(), gl: any = this.engine.getGlInfo ? this.engine.getGlInfo() : {};
    const rows = this.perfLog.map((r) => `  wave ${r.wave} try ${r.attempt} at ${r.speed}x: ${r.fps} fps average, worst frame ${r.worstMs}ms, ${r.slowPct}% slow frames, ${r.fighters} fighters`);
    return [`PERF ${new Date().toISOString()}`, `device: ${navigator.userAgent}`, `gpu: ${gl.renderer || '?'} (${gl.vendor || '?'})`,
      `screen ${screen.width}x${screen.height}  viewport ${innerWidth}x${innerHeight}  dpr ${devicePixelRatio}  render ${this.engine.getRenderWidth()}x${this.engine.getRenderHeight()}  scaling level ${this.engine.getHardwareScalingLevel().toFixed(2)}`,
      `now: ${p.fps.toFixed(0)} fps, average ${p.avg.toFixed(1)}ms, slowest 5% ${p.p95.toFixed(0)}ms, worst ${p.worst.toFixed(0)}ms | active meshes ${p.meshes}, particle systems ${p.particles}, draw calls ${p.draws}`,
      `state: phase ${this.phase}, speed ${this.timeScale}x, camera ${this.camMode}, difficulty ${difficultyName}, wave ${this.s.wave}, units ${this.s.units.length}`,
      `battles (newest last):`, ...(rows.length ? rows : ['  (none yet: play a battle, then copy this again)'])].join('\n');
  }

  /** A run the player has really started (so Home can offer Continue). Null after a stage was won or lost, or before anything was done. */
  runInfo() { const s = this.s; if (!s || s.status !== 'building') return null; return (s.wave > 1 || s.units.length > 0 || this.attempt > 0 || s.stats.failures > 0) ? { wave: s.wave, total: stageWaves(s), hearts: s.hearts, difficulty: difficultyName, stage: currentStageId } : null; }
  /** Fresh run with the currently equipped Soul Deck (Home > Start Battle calls this). */
  newRun() { this.startStage(new URLSearchParams(location.search).get('seed') ? this.seed : Math.floor(Math.random() * 1e6) + 1); }
  startStage(seed: number) {
    this.cine = false; this.reward = null; this.flushTweens(); if (this.necro) this.necro.revive();
    this.seed = seed; this.attempt = 0; const sv = loadSave(), pl = playable(sv); setStageDifficulty(pl.stage, pl.difficulty); this.arena.setTheme(currentStageId); this.s = newStage({ ...PROTOTYPE_RULES, pool: sv.deck }, seed); this.seenMerges = 0;
    this.clearBattle(); [...this.unitVis.values()].forEach((v) => v.dispose()); this.unitVis.clear(); this.visToUnit.clear();
    this.sel = null; this.swapMode = false; this.draft = null; this.phase = 'build';
    this.syncBuild(); this.ui.render(); this.setCam(this.poses().build); this.toast('Stage start: 4 cards, ' + this.s.cap + ' Dominion. Summon, merge, then press BATTLE.');
  }
  private clearBattle() {
    this.fvis.forEach((v, id) => { if (!this.fUnit.has(id)) v.dispose(); }); this.fvis.clear(); this.fUnit.clear(); this.lastState.clear(); this.battle = null;
    this.arrows.forEach((a) => a.mesh.dispose()); this.arrows = [];
  }
  private pos(cell: number) { return cellPos(0, cell); }
  syncBuild() {
    this.persistRun();
    const merged = this.s.stats.merges > this.seenMerges; this.seenMerges = this.s.stats.merges;
    const grown = merged ? this.s.units.find((u) => { const gv = this.unitVis.get(u.id); return !!gv && gv.star !== u.star; }) : undefined;   // the unit that just gained a star
    const alive = new Set(this.s.units.map((u) => u.id));
    for (const [id, v] of this.unitVis) if (!alive.has(id)) {
      this.visToUnit.delete(v); this.unitVis.delete(id); const p = v.holder.position;
      if (grown) {                                          // merge: the consumed unit is drawn into the survivor and vanishes in a flash
        const to = this.pos(grown.cell), x0 = p.x, z0 = p.z, sc = v.holder.scaling.x; v.play('idle');
        this.tween(0.33, (t) => { v.holder.position.set(x0 + (to.x - x0) * t, Math.sin(t * Math.PI) * 0.4, z0 + (to.z - z0) * t); v.holder.scaling.setAll(sc * (1 - 0.75 * t)); },
          () => { this.burst(to.x, to.z, [0.85, 0.6, 1, 0.9], [0.5, 0.3, 1, 0.7], 14); v.dispose(); });
      } else { this.burst(p.x, p.z, [0.6, 0.5, 0.7, 0.8], [0.3, 0.2, 0.5, 0.6], 16); v.dispose(); }
    }
    for (const u of this.s.units) {
      let v = this.unitVis.get(u.id); const p = this.pos(u.cell);
      if (!v) { v = createVisual(this.A, u.soul, 0, u.star); this.unitVis.set(u.id, v); this.visToUnit.set(v, u.id); v.holder.position.set(p.x, 0, p.z); v.holder.rotation.y = Math.PI / 2; v.play('spawn'); this.summonFx(p.x, p.z); audio.play('summon'); const vv = v; this.later(1.1, () => { if (this.phase === 'build') vv.play('idle'); }); }
      else { v.holder.position.set(p.x, 0, p.z); v.holder.rotation.y = Math.PI / 2; if (v.star !== u.star) { const fv = v; v.setStar(u.star); this.later(grown && grown.id === u.id ? 0.33 : 0, () => this.mergeFx(fv, p.x, p.z)); } }
    }
    for (let c = 0; c < GRID_CELLS; c++) this.tint(c, 'normal');
    const sel = this.sel;
    if (sel && sel.type === 'card' && this.phase === 'build') {
      for (let c = 0; c < GRID_CELLS; c++) if (cellFree(this.s, c)) this.tint(c, canSummon(this.s, sel.idx) ? 'free' : 'normal');
      for (const u of this.s.units) if (canMergeFromHand(this.s, sel.idx, u.id)) this.tint(u.cell, 'partner');     // the card can merge into this unit
    }
    if (sel && sel.type === 'unit') {
      const u = this.s.units.find((x) => x.id === sel.id);
      if (u) { this.tint(u.cell, 'sel'); for (const o of this.s.units) if (canMergeDeployed(u, o)) this.tint(o.cell, 'partner'); for (let c = 0; c < GRID_CELLS; c++) if (cellFree(this.s, c)) this.tint(c, 'free'); }
    }
  }
  /** The merge moment: a flash of rings and sparks, a punch in size, a rising chime. */
  private mergeFx(v: UnitVisual, x: number, z: number) {
    audio.play('merge'); v.pulse(); const target = v.holder.scaling.x;
    this.fxRing(x, z, new BABYLON.Color3(1, 0.85, 0.4), 0.2, 2.0, 0.65); this.later(0.12, () => this.fxRing(x, z, new BABYLON.Color3(1, 1, 1), 0.2, 3.0, 0.8));
    this.burst(x, z, [1, 0.85, 0.4, 0.9], [0.8, 0.4, 1, 0.8], 46); this.burst(x, z, [0.85, 0.6, 1, 0.9], [0.5, 0.3, 1, 0.7], 24);
    this.tween(0.55, (t) => v.holder.scaling.setAll(target * (1 + 0.45 * Math.sin(t * Math.PI) * (1 - t * 0.4))), () => v.holder.scaling.setAll(target));
  }
  private summonFx(x: number, z: number) { this.burst(x, z, [0.7, 0.3, 1, 0.9], [0.35, 0.1, 0.7, 0.8], 30); this.fxRing(x, z, new BABYLON.Color3(0.7, 0.3, 1), 0.2, 1.2, 0.7); }

  // ---- player actions (build phase)
  toast(msg: string) { this.ui.toast(msg); }
  onCard(idx: number) {
    if (this.phase !== 'build') return;
    if (this.swapMode) { if (discardRedraw(this.s, idx)) { this.toast('Swapped: drew a different Soul.'); this.swapMode = false; } else this.toast('Swap already used this round.'); }
    else this.sel = this.sel && this.sel.type === 'card' && this.sel.idx === idx ? null : { type: 'card', idx };
    this.confirmRemove = false; this.syncBuild(); this.ui.render();
  }
  onTile(cell: number) {
    const s = this.s, sel = this.sel; if (this.phase !== 'build') return;
    const here = s.units.find((u) => u.cell === cell); if (here) { this.onUnitVisual(this.unitVis.get(here.id)!); return; }
    if (sel && sel.type === 'card') {
      if (canSummon(s, sel.idx)) { summon(s, sel.idx, cell); this.sel = null; }
      else { const soul = s.hand[sel.idx]; this.toast(`Not enough Dominion: ${SOUL_NAME[soul]} costs ${cost(soul, 1)}, you have ${dominionFree(s)} free.`); }
    } else if (sel && sel.type === 'unit') { if (moveUnit(s, sel.id, cell)) this.sel = null; }
    this.confirmRemove = false; this.syncBuild(); this.ui.render();
  }
  onUnitVisual(v: UnitVisual) {
    const id = this.visToUnit.get(v); if (id === undefined || this.phase !== 'build') return;
    const s = this.s, u = s.units.find((x) => x.id === id)!;
    if (this.swapMode) { if (swapSell(s, id)) { this.toast(`Sold ${SOUL_NAME[u.soul]}: drew a different Soul.`); this.swapMode = false; } else this.toast(u.fresh ? "You can't sell a unit you summoned this round." : 'Swap already used this round.'); }
    else if (this.sel && this.sel.type === 'card' && s.hand[this.sel.idx] === u.soul && u.star === 1 && s.rules.merge === 'handIntoOneStar') {
      if (mergeFromHand(s, this.sel.idx, id)) { this.sel = { type: 'unit', id }; this.toast(`Merged the card into a 2-star ${SOUL_NAME[u.soul]}!`); }
      else this.toast(`Not enough Dominion to merge: it needs ${cost(u.soul, 2) - cost(u.soul, 1)} more, you have ${dominionFree(s)} free.`);
    }
    else if (this.sel && this.sel.type === 'unit' && this.sel.id !== id) {
      const a = s.units.find((x) => x.id === (this.sel as any).id)!;
      if (canMergeDeployed(a, u)) { mergeDeployed(s, a.id, u.id); this.sel = { type: 'unit', id: a.id }; this.toast(`Merged into a ${a.star}-star ${SOUL_NAME[a.soul]}!`); } else this.sel = { type: 'unit', id };
    } else this.sel = this.sel && this.sel.type === 'unit' && this.sel.id === id ? null : { type: 'unit', id };
    this.confirmRemove = false; this.syncBuild(); this.ui.render();
  }
  mergeSelected() {
    const s = this.s, sel = this.sel; if (!sel || sel.type !== 'unit') return;
    const a = s.units.find((x) => x.id === sel.id); const b = a && s.units.find((o) => canMergeDeployed(a, o));
    if (a && b) { mergeDeployed(s, a.id, b.id); this.toast(`Merged into a ${a.star}-star ${SOUL_NAME[a.soul]}!`); } else this.toast('No matching unit (same Soul and stars) to merge with.');
    this.syncBuild(); this.ui.render();
  }
  removeSelected() {
    const sel = this.sel; if (!sel || sel.type !== 'unit') return;
    if (!this.confirmRemove) { this.confirmRemove = true; this.toast('Tap Remove again to confirm. The card is gone for this stage.'); this.ui.render(); return; }
    dismiss(this.s, sel.id); this.sel = null; this.confirmRemove = false; this.syncBuild(); this.ui.render();
  }
  toggleSwap() { if (this.phase !== 'build') return; if (this.s.discardUsed) { this.toast('Swap already used this round.'); return; } this.swapMode = !this.swapMode; this.sel = null; if (this.swapMode) this.toast('Swap: tap a hand card to discard, or a unit (not summoned this round) to sell.'); this.syncBuild(); this.ui.render(); }

  // -------------------------------------------------------------------------------------------- battle
  startBattle() {
    if (this.phase !== 'build' || !this.s.units.length) { if (!this.s.units.length) this.toast('Summon at least one unit first.'); return; }
    this.flushTweens(); audio.play('start'); this.beginBattlePerf(); this.showGrid(false);
    this.sel = null; this.swapMode = false; this.attempt++; this.handled = false; this.resultAt = -1;
    const s = this.s, units = s.units.slice();
    const saved = loadSave().souls, levels: Record<string, number> = {}; for (const k of Object.keys(saved)) levels[k] = (saved as any)[k].level;   // permanent Soul levels
    this.battle = new Battle(units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell })), enemyWave(s.wave, this.seed), this.seed * 131 + s.wave * 17 + this.attempt, levels, enemyPower());
    this.fvis.clear(); this.fUnit.clear(); this.lastState.clear();
    this.battle.fighters.forEach((f) => {
      if (f.team === 0) { const u = units[f.id - 1]; const v = this.unitVis.get(u.id)!; this.fvis.set(f.id, v); this.fUnit.set(f.id, u.id); v.setHp(1); v.setMana(f.maxMana ? 0 : null); }
      else { const v = createVisual(this.A, f.soul, 1, f.star); v.holder.position.set(f.x, 0, f.z); v.holder.rotation.y = -Math.PI / 2; v.play('spawn'); v.setHp(1); v.setMana(f.maxMana ? 0 : null); this.fvis.set(f.id, v); this.later(1.1, () => { if (v.state === 'spawn') v.play('idle'); }); this.burst(f.x, f.z, [0.7, 0.6, 0.5, 0.7], [0.4, 0.35, 0.3, 0.6], 14); }
    });
    for (let c = 0; c < GRID_CELLS; c++) this.tint(c, 'normal');
    this.phase = 'transition'; this.startStepAt = 1.0; this.acc = 0; this.tweenCam(this.poses().battle, 2.2); this.syncBuild(); this.ui.render();
  }
  private applyEvents(evs: BEvent[]) {
    const b = this.battle!;
    for (const e of evs) {
      if (e.t === 'swing') { const v = this.fvis.get(e.id); if (v) v.play('attack', e.speed); }
      else if (e.t === 'hit') { const v = this.fvis.get(e.to); if (v) v.pulse(); if (e.kind === 'arrow') audio.play('hitArrow'); else if (e.kind === 'melee') audio.play('hit'); }
      else if (e.t === 'arrow') { const f = b.byId(e.from)!, to = b.byId(e.to)!; this.spawnArrow(f.team, f.x, f.z, to.x, to.z, e.dur); audio.play('arrow'); }
      else if (e.t === 'death') { const v = this.fvis.get(e.id); if (v) { v.play('death'); v.setHp(null); v.setMana(null); const f = b.byId(e.id)!; audio.play('death'); this.burst(f.x, f.z, [0.6, 0.5, 0.7, 0.8], [0.3, 0.2, 0.5, 0.6], 12); if (f.team === 1) this.later(5, () => { if (this.fvis.get(e.id) === v && this.phase !== 'build') { v.holder.setEnabled(false); } }); } }
      else if (e.t === 'cast') { const f = b.byId(e.id)!; audio.play('cast'); this.fxRing(f.x, f.z, new BABYLON.Color3(0.5, 0.8, 1), 0.15, 1.1, 0.35); }
      else if (e.t === 'taunt') { const f = b.byId(e.id)!; audio.play('taunt'); this.fxRing(f.x, f.z, new BABYLON.Color3(1, 0.85, 0.3), 0.3, BALANCE.taunt.radius, 0.6); }
      else if (e.t === 'smash') { audio.play('smash'); this.fxRing(e.x, e.z, new BABYLON.Color3(1, 0.5, 0.2), 0.2, e.r * 1.6, 0.45); }
    }
  }
  private spawnArrow(team: number, x0: number, z0: number, x1: number, z1: number, dur: number) {
    let mesh = this.arrowMesh.pop();
    if (!mesh) { mesh = BABYLON.MeshBuilder.CreateCylinder('arrow', { height: 0.55, diameter: 0.035 }, this.scene); mesh.rotation.x = Math.PI / 2; mesh.isPickable = false; const holder = new BABYLON.TransformNode('ar', this.scene); mesh.parent = holder; mesh = holder; }
    mesh.setEnabled(true); mesh.getChildMeshes()[0].material = this.arrowMats[team];
    this.arrows.push({ mesh, x0, z0, x1, z1, t: 0, dur });
  }

  private frame(dt: number) {
    if (this.canvas.clientWidth !== this.lastW || this.canvas.clientHeight !== this.lastH) this.handleResize();   // e.g. the home-screen app resizing after launch
    for (let i = this.timers.length - 1; i >= 0; i--) { this.timers[i].t -= dt; if (this.timers[i].t <= 0) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); } }
    for (let i = this.ringFx.length - 1; i >= 0; i--) { const r = this.ringFx[i]; r.t += dt; const u = r.t / r.dur, s = r.r0 + (r.r1 - r.r0) * u; r.m.scaling.set(s, s, s); r.mm.alpha = 0.9 * (1 - u); if (u >= 1) { r.m.dispose(); r.mm.dispose(); this.ringFx.splice(i, 1); } }
    if (this.camT < 1) { this.camT = Math.min(1, this.camT + dt / this.camDur); const e = this.camT * this.camT * (3 - 2 * this.camT); this.camera.position = BABYLON.Vector3.Lerp(this.camFrom.pos, this.camTo.pos, e); this.camTgt = BABYLON.Vector3.Lerp(this.camFrom.tgt, this.camTo.tgt, e); this.camera.setTarget(this.camTgt.clone()); }
    else if (this.phase === 'battle' && this.camMode === 'close' && !this.cine) this.frameBattle(dt);
    this.necro.update(dt);
    for (let i = this.tweens.length - 1; i >= 0; i--) { const w = this.tweens[i]; w.t += dt; const u = Math.min(1, w.t / w.dur); w.fn(u); if (u >= 1) { this.tweens.splice(i, 1); if (w.done) w.done(); } }
    for (const v of this.unitVis.values()) v.update(dt);
    this.fvis.forEach((v, id) => { if (!this.fUnit.has(id)) v.update(dt); });

    const b = this.battle;
    if ((this.phase === 'transition' || this.phase === 'battle') && b) {
      if (this.phase === 'transition') { this.startStepAt -= dt; if (this.startStepAt <= 0) { this.phase = 'battle'; this.ui.render(); } }
      if (this.phase === 'battle') {
        this.acc += dt * this.timeScale;
        while (this.acc >= 1 / 30 && b.winner < 0) { b.step(1 / 30); this.acc -= 1 / 30; this.applyEvents(b.drain()); }
      }
      for (const f of b.fighters) {
        const v = this.fvis.get(f.id); if (!v) continue;
        if (!this.cine && (this.phase === 'battle' || f.team === 1)) { v.holder.position.x = f.x; v.holder.position.z = f.z; if (f.alive || true) v.holder.rotation.y = f.yaw; }
        if (f.alive) { v.setHp(f.hp / f.maxHp); if (f.maxMana) v.setMana(f.mana / f.maxMana); }
        else v.setMana(null);
        if (f.state !== 'attack' && f.alive) { const want = f.state === 'run' ? 'run' : 'idle'; if (this.lastState.get(f.id) !== want || (v.state !== want && v.state !== 'spawn')) { if (v.state !== 'spawn') { v.play(want as any); this.lastState.set(f.id, want); } } }
        if (f.state === 'attack') this.lastState.set(f.id, 'attack');
      }
      if (b.winner >= 0 && !this.handled) { this.handled = true; this.resultAt = 1.4; }
      if (this.resultAt > 0) { this.resultAt -= dt; if (this.resultAt <= 0) this.handleResult(); }
    }
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i]; a.t += dt * this.timeScale; const u = Math.min(1, a.t / a.dur);
      const px = a.x0 + (a.x1 - a.x0) * u, pz = a.z0 + (a.z1 - a.z0) * u, py = 0.75 + Math.sin(u * Math.PI) * 0.9 - u * 0.25;
      const u2 = Math.min(1, u + 0.03), qx = a.x0 + (a.x1 - a.x0) * u2, qz = a.z0 + (a.z1 - a.z0) * u2, qy = 0.75 + Math.sin(u2 * Math.PI) * 0.9 - u2 * 0.25;
      a.mesh.position.set(px, py, pz); a.mesh.lookAt(new BABYLON.Vector3(qx, qy, qz));
      if (u >= 1) { a.mesh.setEnabled(false); this.arrowMesh.push(a.mesh); this.arrows.splice(i, 1); }
    }
  }

  private handleResult() {
    const b = this.battle!, s = this.s;
    this.endBattlePerf();
    this.lastBattle = `wave ${s.wave} attempt ${this.attempt}: ${b.winner === 0 ? 'WON' : 'LOST'} in ${b.time.toFixed(1)}s, ${b.count(0)} of yours and ${b.count(1)} enemies left`;
    if (b.winner === 0) {
      this.playResult('win', () => {                        // the army is raised again, then the next wave / the draft
        this.cine = false;
        if (advanceWave(s)) {
          this.phase = 'won'; clearRun();
          try { this.reward = recordClearAndSave(currentStageId, difficultyName as any); window.dispatchEvent(new Event('necro-save-changed')); } catch { this.reward = null; }
          this.ui.render(); return;
        }
        this.draft = draftOptions(s); this.phase = 'draft'; this.persistRun(); this.ui.render();
      });
    } else {
      failWave(s); this.ui.render(); this.ui.pulseHearts();                   // the heart is lost the moment he is hit
      if (s.status === 'lost') this.playResult('final', () => { this.cine = false; this.phase = 'lost'; clearRun(); this.ui.render(); });
      else this.playResult('loss', () => { this.toast('Your army fell. -1 heart, +1 card, same wave. Rebuild a different strategy.'); this.toBuild(); });
    }
  }

  // ---- result cutscenes (plan sections 19-22): the Necromancer takes the hit, unleashes the repulsion shockwave, raises the fallen
  private playResult(kind: 'win' | 'loss' | 'final', done: () => void) {
    const b = this.battle!, n = this.necro; this.cine = true; this.tweenCam(this.poses().necro, 1.1);
    const home = () => {                                    // every fallen ally is pulled back to its grid tile and stands up
      n.cast(); audio.play('resurrect'); const c = n.crystalPos(); this.burst(c.x, c.z, [0.85, 0.5, 1, 0.9], [0.5, 0.2, 1, 0.7], 30);
      for (const f of b.fighters) {
        if (f.team !== 0) continue; const uid = this.fUnit.get(f.id), u = this.s.units.find((x) => x.id === uid), v = this.fvis.get(f.id); if (!u || !v) continue;
        const to = this.pos(u.cell), x0 = v.holder.position.x, z0 = v.holder.position.z; v.setHp(null); v.setMana(null);
        if (!f.alive) { v.play('spawn'); this.burst(x0, z0, [0.75, 0.4, 1, 0.9], [0.4, 0.15, 0.9, 0.7], 18); this.fxRing(x0, z0, new BABYLON.Color3(0.7, 0.35, 1), 0.3, 1.6, 0.7); }
        this.tween(1.0, (t) => { v.holder.position.set(x0 + (to.x - x0) * t, Math.sin(t * Math.PI) * 0.5, z0 + (to.z - z0) * t); v.holder.rotation.y += (Math.PI / 2 - v.holder.rotation.y) * Math.min(1, t * 0.5 + 0.1); },
          () => { v.holder.position.y = 0; this.burst(to.x, to.z, [0.75, 0.4, 1, 0.9], [0.4, 0.15, 0.9, 0.7], 10); });
      }
    };
    if (kind === 'win') { n.cast(); audio.play('victory'); this.later(0.25, home); this.later(2.0, done); return; }
    n.hurt(); audio.play('heartLost'); this.later(0.15, () => { const c = n.crystalPos(); this.burst(c.x, c.z, [1, 0.3, 0.3, 0.9], [0.8, 0.1, 0.2, 0.6], 16); });
    if (kind === 'final') { this.later(0.6, () => { n.defeat(); audio.play('defeat'); }); this.later(2.6, done); return; }
    this.later(1.0, () => {                                 // repulsion shockwave: survivors are flung back to where they started and heal to full
      n.cast(); audio.play('shockwave'); const c = n.crystalPos();
      this.fxRing(c.x, 0, new BABYLON.Color3(0.85, 0.55, 1), 0.6, 30, 1.1); this.fxRing(c.x, 0, new BABYLON.Color3(1, 1, 1), 0.4, 22, 0.8);
      this.burst(c.x, c.z, [1, 0.85, 1, 0.9], [0.7, 0.4, 1, 0.7], 40);
      for (const f of b.fighters) {
        if (f.team !== 1 || !f.alive) continue; const v = this.fvis.get(f.id); if (!v) continue;
        const to = cellPos(1, f.cell), x0 = v.holder.position.x, z0 = v.holder.position.z; v.pulse();
        this.tween(0.9, (t) => { v.holder.position.set(x0 + (to.x - x0) * t, Math.sin(t * Math.PI) * 0.9, z0 + (to.z - z0) * t); v.setHp(f.hp / f.maxHp + (1 - f.hp / f.maxHp) * t); }, () => { v.holder.position.y = 0; v.setHp(1); });
      }
    });
    this.later(2.3, home); this.later(3.7, done);
  }
  pickDraft(idx: number) { if (!this.draft) return; takeDraft(this.s, this.draft, idx); this.draft = null; normalDraw(this.s); this.toBuild(); }
  private toBuild() {
    this.cine = false; this.necro.revive(); this.flushTweens();
    this.clearBattle(); this.showGrid(true);
    for (const u of this.s.units) {                       // resurrection: everyone rises again at full health
      const v = this.unitVis.get(u.id)!; const p = this.pos(u.cell); v.holder.position.set(p.x, 0, p.z); v.holder.rotation.y = Math.PI / 2; v.holder.setEnabled(true); v.setHp(null); v.setMana(null); v.play('spawn'); this.summonFx(p.x, p.z);
      this.later(1.1, () => v.play('idle'));
    }
    this.phase = 'build'; this.sel = null; this.syncBuild(); this.ui.render();          // UI first: the camera must measure the hand and buttons while they are visible
    this.tweenCam(this.poses().build, 1.8);
  }
  setSpeed(k: number) { this.timeScale = k; this.ui.render(); }

  // -------------------------------------------------------------------------------------------- debug helpers
  applyBalanceChange() { this.unitVis.forEach((v, id) => { const u = this.s.units.find((x) => x.id === id); if (u) v.setStar(u.star); }); }
  testOdds(n = 200) {
    const slots = this.s.units.map((u) => ({ soul: u.soul, star: u.star, cell: u.cell })), enemies = enemyWave(this.s.wave, this.seed); let win = 0, t = 0;
    const lv: Record<string, number> = {}, sv = loadSave().souls; for (const k of Object.keys(sv)) lv[k] = (sv as any)[k].level;
    for (let i = 0; i < n; i++) { const r = simulate(slots, enemies, 5000 + i, 130, lv, enemyPower()); if (r.winner === 0) win++; t += r.time; }
    return { win: Math.round((win / n) * 100), avgTime: +(t / n).toFixed(1), n };
  }
  addCard(soul: SoulId) { this.s.hand.push(soul); this.s.stats.drawn++; this.ui.render(); }
  addDominion(n: number) { this.s.cap += n; this.ui.render(); }
  report(): string {
    const s = this.s, en = enemyWave(s.wave, this.seed);
    return [`stage ${currentStageId}/${difficultyName}  seed ${this.seed}  wave ${s.wave}/${stageWaves(s)}  hearts ${s.hearts}  dominion ${dominionUsed(s)}/${s.cap}  phase ${this.phase}  attempt ${this.attempt}`,
      `hand: ${s.hand.join(', ') || '(empty)'}`, `army: ${s.units.map((u) => `${u.soul}${u.star}@${u.cell}`).join(' ') || '(none)'}`, `enemy: ${en.map((e) => e.soul + e.star).join(' ')}`,
      `difficulty: ${difficultyName}  merge-from-hand: ${s.rules.merge === 'handIntoOneStar'}  swap used: ${s.discardUsed}`, `last tap: ${this.lastTapInfo}`, `screen: ${this.canvas.clientWidth}x${this.canvas.clientHeight} dpr ${window.devicePixelRatio}`, `last battle: ${this.lastBattle || '-'}`, `log tail:`, ...s.log.slice(-8), `balance: ${JSON.stringify({ star: BALANCE.star, stats: BALANCE.stats })}`].join('\n');
  }
  resetBalanceAll() { resetBalance(); this.applyBalanceChange(); }
  get difficulty() { return difficultyName; }
  changeDifficulty(name: string) { setDifficulty(name); this.ui.render(); this.toast(`Difficulty: ${name}. Applies to the next battle.`); }

  // -------------------------------------------------------------------------------------------- gallery (star looks)
  gallery() {
    document.body.classList.add('gallery'); this.necro.setEnabled(false); const vis: UnitVisual[] = []; let team: 0 | 1 = 0;
    const rebuild = () => { vis.forEach((v) => v.dispose()); vis.length = 0; SOULS.forEach((soul, i) => [1, 2, 3].forEach((st, j) => { const v = createVisual(this.A, soul, team, st); v.holder.position.set((i - 2.5) * 2.5, 0, (j - 1) * -2.4); v.holder.rotation.y = Math.PI * 0.85; v.play('idle'); vis.push(v); })); };
    rebuild(); this.camera.position.set(0, 5.6, -14.5); this.camera.setTarget(new BABYLON.Vector3(0, 0.5, -0.4)); this.camera.fov = 0.85;
    (window as any).__gallery = { setTeam: (t: 0 | 1) => { team = t; rebuild(); }, vis };
    let last = performance.now(); this.engine.runRenderLoop(() => { const n = performance.now(), dt = Math.min(0.05, (n - last) / 1000); last = n; vis.forEach((v) => v.update(dt)); this.scene.render(); });
  }
}
