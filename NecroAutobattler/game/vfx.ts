// Battle VFX: hit sparks, floating damage numbers, death wisps, ground-slam dust, light pillars, rune circles, the Necromancer's shockwave,
// camera shake and screen flash. Purely visual (nothing here touches the battle), and cheap: particle systems are pooled and reused, numbers are a few DOM nodes.
declare const BABYLON: any;

type Col = [number, number, number];
const dyn = (scene: any, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
  const t = new BABYLON.DynamicTexture('vfx', { width: w, height: h }, scene, true); draw(t.getContext()); t.update(); t.hasAlpha = true; return t;
};
interface Pooled { ps: any; at: any }
interface Timed { t: number; dur: number; fn: (u: number) => void; done?: () => void }

export class Vfx {
  private pools: Record<string, Pooled[]> = {}; private next: Record<string, number> = {};
  private timed: Timed[] = []; private layer: HTMLElement; private pending = new Map<number, { dmg: number; t: number; x: number; y: number; z: number; mine: boolean; big: boolean }>();
  private shakeMag = 0; private shakeT = 0; private shakeDur = 0; off: any = new BABYLON.Vector3(0, 0, 0);
  private numbersOn = true; private spark: any; private runeTex: any; private beamTex: any; private flashEl: HTMLElement;

  constructor(private scene: any, private engine: any, private camera: any, host: HTMLElement, private soft: any) {
    this.spark = dyn(scene, 64, 64, (c) => {                                   // a four-point glint
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64); c.fillStyle = 'rgba(255,255,255,.95)'; c.fillRect(30, 2, 4, 60); c.fillRect(2, 30, 60, 4);
    });
    this.beamTex = dyn(scene, 8, 256, (c) => { const g = c.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,1)'); c.fillStyle = g; c.fillRect(0, 0, 8, 256); });
    this.runeTex = dyn(scene, 512, 512, (c) => {                               // a ring of marks around a star: the Necromancer's circle
      c.translate(256, 256); c.strokeStyle = '#fff'; c.lineCap = 'round';
      for (const [r, w] of [[236, 6], [214, 3], [150, 3]] as number[][]) { c.lineWidth = w; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke(); }
      c.lineWidth = 5; for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; c.save(); c.rotate(a); c.beginPath(); c.moveTo(0, -172); c.lineTo(0, -i % 3 === 0 ? 208 : 190); c.stroke(); c.restore(); }
      c.lineWidth = 4; c.beginPath(); for (let i = 0; i <= 10; i++) { const a = (i * 2 / 5) * Math.PI + 0; const x = Math.sin(a) * 146, y = -Math.cos(a) * 146; if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke();
      c.lineWidth = 3; for (let i = 0; i < 8; i++) { c.save(); c.rotate((i / 8) * Math.PI * 2); c.beginPath(); c.moveTo(-10, -100); c.lineTo(0, -116); c.lineTo(10, -100); c.moveTo(0, -116); c.lineTo(0, -84); c.stroke(); c.restore(); }
    });
    this.makePool('spark', 12, 24, this.spark, true); this.makePool('trail', 10, 10, this.soft, true); this.makePool('wisp', 6, 30, this.soft, true);
    this.makePool('bone', 6, 24, this.soft, false); this.makePool('dust', 4, 40, this.soft, false); this.makePool('wave', 2, 260, this.soft, true);
    if (!document.getElementById('vfx-css')) {
      const s = document.createElement('style'); s.id = 'vfx-css';
      s.textContent = `#fxlayer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6}
.dmgn{position:absolute;font:900 clamp(12px,2.7vmin,20px) system-ui,sans-serif;color:#ffe27a;text-shadow:0 2px 0 #150d26,0 0 6px #150d26,0 0 2px #150d26;transform:translate(-50%,-50%);animation:dmgup .8s ease-out forwards;will-change:transform,opacity;white-space:nowrap}
.dmgn.theirs{color:#ff7a7a}.dmgn.big{font-size:clamp(17px,3.8vmin,28px);color:#fff3b0}.dmgn.theirs.big{color:#ffb0b0}
@keyframes dmgup{0%{opacity:0;transform:translate(-50%,-10%) scale(.5)}14%{opacity:1;transform:translate(-50%,-60%) scale(1.2)}100%{opacity:0;transform:translate(-50%,-230%) scale(.9)}}
#fxflash{position:absolute;inset:0;pointer-events:none;z-index:7;opacity:0}
@keyframes fxflash{0%{opacity:var(--fa)}100%{opacity:0}}`;
      document.head.appendChild(s);
    }
    this.layer = document.getElementById('fxlayer') || Object.assign(document.createElement('div'), { id: 'fxlayer' }); if (!this.layer.parentElement) host.appendChild(this.layer);
    this.flashEl = document.getElementById('fxflash') || Object.assign(document.createElement('div'), { id: 'fxflash' }); if (!this.flashEl.parentElement) host.appendChild(this.flashEl);
  }

  // ---------------------------------------------------------------- pools
  private makePool(kind: string, n: number, cap: number, tex: any, add: boolean) {
    const list: Pooled[] = [];
    for (let i = 0; i < n; i++) {
      const at = new BABYLON.Vector3(0, -50, 0), ps = new BABYLON.ParticleSystem(kind + i, cap, this.scene);
      ps.particleTexture = tex; ps.emitter = at; ps.emitRate = 0; ps.manualEmitCount = 0; ps.minEmitBox = ps.maxEmitBox = new BABYLON.Vector3(0, 0, 0);
      ps.blendMode = add ? BABYLON.ParticleSystem.BLENDMODE_ONEONE : BABYLON.ParticleSystem.BLENDMODE_STANDARD; ps.isLocal = false; ps.updateSpeed = 0.02;
      this.config(kind, ps); ps.start(); list.push({ ps, at });
    }
    this.pools[kind] = list; this.next[kind] = 0;
  }
  private config(kind: string, ps: any) {
    const C4 = (r: number, g: number, b: number, a: number) => new BABYLON.Color4(r, g, b, a), V = (x: number, y: number, z: number) => new BABYLON.Vector3(x, y, z);
    if (kind === 'spark') { ps.minSize = 0.07; ps.maxSize = 0.17; ps.minLifeTime = 0.14; ps.maxLifeTime = 0.34; ps.direction1 = V(-1, 0.2, -1); ps.direction2 = V(1, 1.3, 1); ps.minEmitPower = 1.2; ps.maxEmitPower = 3.2; ps.gravity = V(0, -7, 0); ps.color1 = C4(1, 0.95, 0.7, 1); ps.color2 = C4(1, 0.7, 0.35, 1); ps.colorDead = C4(0.4, 0.1, 0.1, 0); }
    else if (kind === 'trail') { ps.minSize = 0.05; ps.maxSize = 0.11; ps.minLifeTime = 0.18; ps.maxLifeTime = 0.3; ps.direction1 = V(-0.1, -0.05, -0.1); ps.direction2 = V(0.1, 0.1, 0.1); ps.minEmitPower = 0.1; ps.maxEmitPower = 0.3; ps.color1 = C4(1, 0.9, 0.6, 0.8); ps.color2 = C4(0.8, 0.6, 1, 0.6); ps.colorDead = C4(0.2, 0.1, 0.3, 0); }
    else if (kind === 'wisp') { ps.minSize = 0.14; ps.maxSize = 0.3; ps.minLifeTime = 0.9; ps.maxLifeTime = 1.5; ps.direction1 = V(-0.25, 1, -0.25); ps.direction2 = V(0.25, 2, 0.25); ps.minEmitPower = 0.5; ps.maxEmitPower = 1.1; ps.gravity = V(0, 0.4, 0); ps.color1 = C4(0.35, 1, 0.9, 0.9); ps.color2 = C4(0.2, 0.65, 1, 0.7); ps.colorDead = C4(0.05, 0.25, 0.4, 0); ps.minAngularSpeed = -2; ps.maxAngularSpeed = 2; }
    else if (kind === 'bone') { ps.minSize = 0.12; ps.maxSize = 0.26; ps.minLifeTime = 0.5; ps.maxLifeTime = 0.9; ps.direction1 = V(-1, 0.4, -1); ps.direction2 = V(1, 1.4, 1); ps.minEmitPower = 0.5; ps.maxEmitPower = 1.4; ps.gravity = V(0, -3, 0); ps.color1 = C4(0.92, 0.86, 0.74, 0.85); ps.color2 = C4(0.6, 0.5, 0.45, 0.7); ps.colorDead = C4(0.4, 0.35, 0.3, 0); }
    else if (kind === 'dust') { ps.minSize = 0.32; ps.maxSize = 0.7; ps.minLifeTime = 0.5; ps.maxLifeTime = 0.95; ps.minEmitPower = 2.2; ps.maxEmitPower = 3.6; ps.gravity = V(0, -0.4, 0); ps.color1 = C4(0.62, 0.55, 0.5, 0.55); ps.color2 = C4(0.45, 0.4, 0.4, 0.45); ps.colorDead = C4(0.3, 0.27, 0.27, 0);
      ps.startDirectionFunction = (_m: any, d: any) => { const a = Math.random() * Math.PI * 2; d.set(Math.cos(a), 0.06 + Math.random() * 0.2, Math.sin(a)); }; }
    else if (kind === 'wave') { ps.minSize = 0.35; ps.maxSize = 0.8; ps.minLifeTime = 0.9; ps.maxLifeTime = 1.3; ps.minEmitPower = 16; ps.maxEmitPower = 24; ps.color1 = C4(0.95, 0.6, 1, 0.9); ps.color2 = C4(0.5, 0.25, 1, 0.8); ps.colorDead = C4(0.15, 0.05, 0.3, 0);
      ps.startDirectionFunction = (_m: any, d: any) => { const a = Math.random() * Math.PI * 2; d.set(Math.cos(a), 0.05 + Math.random() * 0.12, Math.sin(a)); }; }
  }
  private emit(kind: string, x: number, y: number, z: number, n: number, tweak?: (ps: any) => void) {
    const list = this.pools[kind], i = this.next[kind]; this.next[kind] = (i + 1) % list.length; const p = list[i]; p.at.set(x, y, z);
    if (tweak) tweak(p.ps); p.ps.manualEmitCount = n;
  }
  private add(dur: number, fn: (u: number) => void, done?: () => void) { this.timed.push({ t: 0, dur, fn, done }); }

  // ---------------------------------------------------------------- combat feedback
  /** A blow landed. `mine`: dealt by your army. `big`: a heavy hit (smash, boss, big share of health). */
  hit(id: number, x: number, z: number, top: number, dmg: number, mine: boolean, big: boolean, kind: string) {
    this.emit('spark', x, top * 0.55, z, big ? 10 : 5, (ps: any) => { if (mine) { ps.color1 = new BABYLON.Color4(0.85, 0.7, 1, 1); ps.color2 = new BABYLON.Color4(1, 0.9, 0.7, 1); } else { ps.color1 = new BABYLON.Color4(1, 0.55, 0.4, 1); ps.color2 = new BABYLON.Color4(1, 0.85, 0.5, 1); } });
    let p = this.pending.get(id); if (!p) { p = { dmg: 0, t: 0, x, y: top, z, mine, big: false }; this.pending.set(id, p); }
    p.dmg += dmg; p.big = p.big || big; p.x = x; p.z = z; p.y = top;
  }
  private flushNumbers(dt: number) {
    if (this.pending.size === 0) return;
    const e = this.engine, canvas = e.getRenderingCanvas(), k = canvas.clientWidth / Math.max(1, e.getRenderWidth()); let shown = 0;
    for (const [id, p] of this.pending) {
      p.t += dt; if (p.t < 0.28) continue; this.pending.delete(id); if (!this.numbersOn || shown >= 6 || this.layer.childElementCount > 26) continue;
      const v = BABYLON.Vector3.Project(new BABYLON.Vector3(p.x, p.y + 0.35, p.z), BABYLON.Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(e.getRenderWidth(), e.getRenderHeight()));
      if (v.z < 0 || v.z > 1) continue; shown++;
      const d = document.createElement('div'); d.className = 'dmgn' + (p.mine ? '' : ' theirs') + (p.big ? ' big' : ''); d.textContent = String(Math.max(1, Math.round(p.dmg)));
      d.style.left = v.x * k + (Math.random() * 14 - 7) + 'px'; d.style.top = v.y * k + 'px'; this.layer.appendChild(d); setTimeout(() => d.remove(), 850);
    }
  }
  /** A fighter fell: your own units crumble into bone dust, enemy souls rise as teal wisps toward the Necromancer. */
  death(x: number, z: number, enemy: boolean, top: number) {
    if (enemy) { this.emit('wisp', x, top * 0.5, z, 12); this.emit('spark', x, top * 0.4, z, 6, (ps: any) => { ps.color1 = new BABYLON.Color4(0.4, 1, 0.9, 1); ps.color2 = new BABYLON.Color4(0.6, 0.8, 1, 1); }); }
    else { this.emit('bone', x, top * 0.45, z, 12); this.emit('dust', x, 0.08, z, 6, (ps: any) => { ps.minEmitPower = 0.8; ps.maxEmitPower = 1.6; }); }
  }
  /** A heavy blow hits the ground: a ring of dust, a few stones and a small shake. */
  slam(x: number, z: number, r: number) { this.emit('dust', x, 0.1, z, 16, (ps: any) => { ps.minEmitPower = 2.2 * Math.min(1.6, r / 1.5 + 0.4); ps.maxEmitPower = 3.6 * Math.min(1.6, r / 1.5 + 0.4); }); this.emit('spark', x, 0.15, z, 8, (ps: any) => { ps.color1 = new BABYLON.Color4(0.9, 0.7, 0.45, 1); ps.color2 = new BABYLON.Color4(0.7, 0.55, 0.4, 1); }); this.shake(0.05, 0.22); }
  /** An arrow in flight leaves a short glint. */
  trail(x: number, y: number, z: number, mine: boolean) { this.emit('trail', x, y, z, 2, (ps: any) => { if (mine) { ps.color1 = new BABYLON.Color4(0.85, 0.65, 1, 0.8); ps.color2 = new BABYLON.Color4(0.6, 0.4, 1, 0.6); } else { ps.color1 = new BABYLON.Color4(1, 0.75, 0.4, 0.8); ps.color2 = new BABYLON.Color4(1, 0.5, 0.25, 0.6); } }); }

  // ---------------------------------------------------------------- big moments
  /** A column of light: the moment something powerful arrives. */
  pillar(x: number, z: number, col: Col, height = 7, width = 0.9, dur = 0.9) {
    const s = this.scene, m = BABYLON.MeshBuilder.CreateCylinder('pillar', { height, diameterTop: width * 0.45, diameterBottom: width, tessellation: 22, cap: 0 }, s);
    m.position.set(x, height / 2, z); m.isPickable = false; const mat = new BABYLON.StandardMaterial('pillarm', s); mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(col[0] * 0.7, col[1] * 0.7, col[2] * 0.7); mat.diffuseTexture = this.beamTex; mat.useAlphaFromDiffuseTexture = true; mat.backFaceCulling = false; mat.alphaMode = BABYLON.Engine.ALPHA_ADD; m.material = mat;
    this.add(dur, (u) => { const grow = Math.min(1, u * 6), fade = 1 - u; m.scaling.set(grow * (1.1 - 0.7 * u), 1, grow * (1.1 - 0.7 * u)); mat.alpha = fade; }, () => { m.dispose(); mat.dispose(); });
  }
  /** A glowing rune circle on the floor that spins and fades. */
  rune(x: number, z: number, radius: number, col: Col, dur = 1.6, spin = 1.2) {
    const s = this.scene, m = BABYLON.MeshBuilder.CreateDisc('rune', { radius: 1, tessellation: 48 }, s); m.rotation.x = Math.PI / 2; m.position.set(x, 0.045, z); m.isPickable = false;
    const mat = new BABYLON.StandardMaterial('runem', s); mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(...col); mat.diffuseTexture = this.runeTex; mat.useAlphaFromDiffuseTexture = true; mat.backFaceCulling = false; mat.alphaMode = BABYLON.Engine.ALPHA_ADD; m.material = mat;
    this.add(dur, (u) => { const inn = Math.min(1, u * 5), out = 1 - Math.max(0, (u - 0.6) / 0.4); m.scaling.setAll(radius * (0.4 + 0.6 * inn)); mat.alpha = inn * out; m.rotation.y = u * spin * 3; }, () => { m.dispose(); mat.dispose(); });
  }
  /** The Necromancer's repulsion shockwave: a dark dome, a wall of rolling energy along the ground, a flash and a heavy shake. */
  shock(x: number, z: number, maxR: number) {
    const s = this.scene, dome = BABYLON.MeshBuilder.CreateSphere('dome', { diameter: 2, segments: 20 }, s); dome.position.set(x, 0, z); dome.isPickable = false;
    const mat = new BABYLON.StandardMaterial('domem', s); mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(0.55, 0.2, 0.95); mat.backFaceCulling = false; mat.alpha = 0.3; mat.alphaMode = BABYLON.Engine.ALPHA_ADD; dome.material = mat;
    this.add(1.0, (u) => { const r = 0.6 + (maxR - 0.6) * (1 - Math.pow(1 - u, 2.2)); dome.scaling.set(r, r * 0.22, r); mat.alpha = 0.34 * Math.pow(1 - u, 1.5); }, () => { dome.dispose(); mat.dispose(); });
    this.emit('wave', x, 0.25, z, 240, (ps: any) => { ps.minEmitPower = 16; ps.maxEmitPower = 24; }); this.emit('dust', x, 0.1, z, 22, (ps: any) => { ps.minEmitPower = 7; ps.maxEmitPower = 12; ps.color1 = new BABYLON.Color4(0.45, 0.35, 0.6, 0.55); ps.color2 = new BABYLON.Color4(0.3, 0.2, 0.45, 0.45); });
    this.rune(x, z, 3.2, [0.7, 0.35, 1], 1.3, 2.2); this.pillar(x, z, [0.75, 0.4, 1], 9, 1.3, 0.8); this.flash([0.75, 0.45, 1], 0.55, 0.45); this.shake(0.28, 0.6);
  }
  /** A fresh Soul or merged Soul lands: a pillar of light and a rune circle (bigger for higher stars). */
  arrive(x: number, z: number, star: number) {
    const col: Col = star >= 3 ? [0.8, 0.4, 1] : star === 2 ? [0.6, 0.75, 1] : [0.65, 0.4, 1];
    this.pillar(x, z, col, star >= 3 ? 8 : star === 2 ? 4.4 : 3, 0.5 + star * 0.3, 0.5 + star * 0.25);
    if (star >= 2) this.rune(x, z, 1.2 + star * 0.35, col, 1.0 + star * 0.3, 2);
    if (star >= 3) { this.flash([0.75, 0.45, 1], 0.4, 0.4); this.shake(0.12, 0.35); this.emit('wave', x, 0.2, z, 90, (ps: any) => { ps.minEmitPower = 5; ps.maxEmitPower = 9; }); }
  }
  /** The enemy boss steps out: dark pulse, slam, shake. */
  bossIntro(x: number, z: number) { this.pillar(x, z, [1, 0.3, 0.25], 8, 1.4, 1.1); this.rune(x, z, 2.6, [1, 0.35, 0.3], 1.6, -1.4); this.flash([1, 0.25, 0.2], 0.35, 0.5); this.shake(0.22, 0.6); this.slam(x, z, 3); }

  // ---------------------------------------------------------------- screen
  shake(mag: number, dur: number) { if (mag >= this.shakeMag * (this.shakeT / Math.max(0.001, this.shakeDur))) { this.shakeMag = mag; this.shakeDur = dur; this.shakeT = dur; } }
  flash(col: Col, alpha: number, dur: number) {
    const e = this.flashEl; e.style.background = `radial-gradient(ellipse at center, rgba(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)},.0) 35%, rgba(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)},1) 120%)`;
    e.style.setProperty('--fa', String(alpha)); e.style.animation = 'none'; void e.offsetWidth; e.style.animation = `fxflash ${dur}s ease-out forwards`;
  }
  setNumbers(on: boolean) { this.numbersOn = on; if (!on) this.layer.textContent = ''; }

  update(dt: number) {
    for (let i = this.timed.length - 1; i >= 0; i--) { const w = this.timed[i]; w.t += dt; const u = Math.min(1, w.t / w.dur); w.fn(u); if (u >= 1) { this.timed.splice(i, 1); if (w.done) w.done(); } }
    this.flushNumbers(dt);
    if (this.shakeT > 0) { this.shakeT = Math.max(0, this.shakeT - dt); const k = (this.shakeT / this.shakeDur) ** 1.5 * this.shakeMag; this.off.set((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k * 0.7, (Math.random() - 0.5) * 2 * k); } else this.off.set(0, 0, 0);
  }
  clear() { this.pending.clear(); this.layer.textContent = ''; }
}
