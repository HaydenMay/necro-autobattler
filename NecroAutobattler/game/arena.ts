// The battlefield's look: a tiled crypt floor, a glowing rune circle in the middle, and a dark misty surround. Pure decoration (no game rules).
declare const BABYLON: any;

const TILE_METRES = 5;    // one repeat of the floor picture covers this many metres, so slabs come out about a metre wide

/** Draw the rune circle once onto a canvas; it becomes a see-through decal on the floor. */
function runeTexture(scene: any): any {
  const S = 512, tex = new BABYLON.DynamicTexture('runes', { width: S, height: S }, scene, true), c = tex.getContext();
  c.clearRect(0, 0, S, S); c.translate(S / 2, S / 2); c.lineCap = 'round'; c.lineJoin = 'round';
  const ring = (r: number, w: number, a: number) => { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.lineWidth = w; c.strokeStyle = `rgba(47,217,166,${a})`; c.stroke(); };
  c.shadowColor = 'rgba(47,217,166,0.9)'; c.shadowBlur = 10;
  ring(236, 4, 0.75); ring(214, 2, 0.5); ring(120, 3, 0.7);
  c.strokeStyle = 'rgba(47,217,166,0.7)'; c.lineWidth = 3;
  for (let i = 0; i < 4; i++) {                                   // four long spikes, like a compass
    c.save(); c.rotate((i * Math.PI) / 2 + Math.PI / 4); c.beginPath(); c.moveTo(0, -30); c.lineTo(0, -230); c.stroke();
    c.beginPath(); c.moveTo(-14, -120); c.lineTo(0, -160); c.lineTo(14, -120); c.stroke(); c.restore();
  }
  c.lineWidth = 2; c.strokeStyle = 'rgba(47,217,166,0.55)';
  for (let i = 0; i < 12; i++) {                                  // small tick marks between the two outer rings
    c.save(); c.rotate((i * Math.PI) / 6); c.beginPath(); c.moveTo(0, -214); c.lineTo(0, -236); c.stroke(); c.restore();
  }
  tex.update(); tex.hasAlpha = true; return tex;
}

interface Placement { prop: string; x: number; z: number; yaw?: number; s?: number }
/** Where the props stand. Tall things go behind and beside the field; only low things (fence, bones, wall) stand between the camera and the units. */
const LAYOUT: Placement[] = [
  { prop: 'arch', x: -6.5, z: 6.4 }, { prop: 'arch', x: 0, z: 6.9, s: 1.15 }, { prop: 'arch', x: 6.5, z: 6.4 },
  { prop: 'pillar', x: -10.2, z: 5.6, yaw: 0.4 }, { prop: 'pillar', x: -3.2, z: 5.9, yaw: 2.1 }, { prop: 'pillar', x: 3.3, z: 5.8, yaw: 4.0 }, { prop: 'pillar', x: 10.2, z: 5.6, yaw: 1.2 },
  { prop: 'brazier', x: -4.6, z: 5.2 }, { prop: 'brazier', x: 4.6, z: 5.2 }, { prop: 'brazier', x: -10.5, z: 0.8 }, { prop: 'brazier', x: 10.5, z: 0.8 },
  { prop: 'wall', x: -8.6, z: 6.0, yaw: 0.1 }, { prop: 'wall', x: 8.6, z: 6.0, yaw: -0.1 }, { prop: 'wall', x: -11.4, z: -2.6, yaw: 1.4 }, { prop: 'wall', x: 11.4, z: -2.6, yaw: 1.7 },
  { prop: 'fence', x: -8.0, z: -4.6 }, { prop: 'fence', x: -6.7, z: -4.7 }, { prop: 'fence', x: 6.7, z: -4.7 }, { prop: 'fence', x: 8.0, z: -4.6 },
  { prop: 'bones', x: -3.5, z: -4.4, yaw: 0.7, s: 0.5 }, { prop: 'bones', x: 4.2, z: -4.6, yaw: 2.5, s: 0.5 }, { prop: 'bones', x: 9.4, z: 3.2, yaw: 1.0, s: 0.6 }, { prop: 'bones', x: -9.6, z: -3.4, yaw: 3.6, s: 0.6 },
];

/** Build the teal soulfire over a brazier: a small soft flame that flickers. */
function flame(scene: any, tex: any, x: number, y: number, z: number, k: number): void {
  const ps = new BABYLON.ParticleSystem('fire', 18, scene); ps.particleTexture = tex; ps.emitter = new BABYLON.Vector3(x, y, z);
  ps.minEmitBox = new BABYLON.Vector3(-0.22 * k, 0, -0.22 * k); ps.maxEmitBox = new BABYLON.Vector3(0.22 * k, 0, 0.22 * k);
  ps.direction1 = new BABYLON.Vector3(-0.1, 1, -0.1); ps.direction2 = new BABYLON.Vector3(0.1, 1.4, 0.1);
  ps.minLifeTime = 0.5; ps.maxLifeTime = 1.0; ps.emitRate = 20; ps.minSize = 0.35 * k; ps.maxSize = 0.7 * k; ps.minEmitPower = 0.5 * k; ps.maxEmitPower = 1.0 * k;
  ps.color1 = new BABYLON.Color4(0.35, 1, 0.8, 0.9); ps.color2 = new BABYLON.Color4(0.1, 0.8, 0.6, 0.8); ps.colorDead = new BABYLON.Color4(0, 0.25, 0.25, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD; ps.gravity = new BABYLON.Vector3(0, 0.4, 0); ps.start();
}

/** Soft round blob used for the flames. */
function glowTexture(scene: any): any {
  const t = new BABYLON.DynamicTexture('glow', { width: 64, height: 64 }, scene, true), c = t.getContext(), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64); t.update(); t.hasAlpha = true; return t;
}

/** Load the prop kit once and stand copies of each piece around the field (they share one mesh and one texture, so they cost almost nothing). */
async function placeProps(scene: any): Promise<void> {
  const box = await BABYLON.SceneLoader.LoadAssetContainerAsync('assets/arena/', 'props.glb', scene);
  box.addAllToScene();
  const root = box.meshes.find((m: any) => m.name === '__root__'), src: Record<string, any> = {};
  for (const m of box.meshes) if (m.name !== '__root__' && m.getTotalVertices() > 0) { src[m.name] = m; m.setEnabled(false); m.isPickable = false; }
  const glow = glowTexture(scene);
  let n = 0;
  for (const p of LAYOUT) {
    const base = src[p.prop]; if (!base) continue;
    const inst = base.createInstance(p.prop + n++); inst.isPickable = false;
    inst.rotationQuaternion = root.rotationQuaternion?.clone() ?? null; if (!inst.rotationQuaternion) inst.rotation = root.rotation.clone(); inst.scaling = root.scaling.clone();
    const holder = new BABYLON.TransformNode('holder' + n, scene); holder.position.set(p.x, 0, p.z); holder.rotation.y = p.yaw ?? 0; holder.scaling.setAll(p.s ?? 1);
    inst.parent = holder;
    if (p.prop === 'brazier') flame(scene, glow, p.x, 1.25 * (p.s ?? 1), p.z, p.s ?? 1);
  }
}

export function buildArena(scene: any, ground: any): { update(t: number): void } {
  // ---- floor
  const tex = new BABYLON.Texture('assets/arena/floor.webp', scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  tex.uScale = 60 / TILE_METRES; tex.vScale = 40 / TILE_METRES; tex.anisotropicFilteringLevel = 4;
  const gm = new BABYLON.StandardMaterial('gm', scene); gm.diffuseTexture = tex; gm.specularColor = BABYLON.Color3.Black();
  gm.diffuseColor = new BABYLON.Color3(0.62, 0.7, 0.7); ground.material = gm;

  // ---- rune circle in the middle of the field
  const decal = BABYLON.MeshBuilder.CreateGround('runes', { width: 5.2, height: 5.2 }, scene);
  decal.position.y = 0.012; decal.isPickable = false;
  const rm = new BABYLON.StandardMaterial('rm', scene); rm.diffuseTexture = runeTexture(scene); rm.diffuseTexture.hasAlpha = true; rm.useAlphaFromDiffuseTexture = true;
  rm.emissiveColor = new BABYLON.Color3(0.18, 0.85, 0.65); rm.disableLighting = true; rm.alpha = 0.55; rm.backFaceCulling = false; decal.material = rm;

  // ---- dark teal surround that swallows the far edge of the floor
  scene.clearColor = new BABYLON.Color4(0.02, 0.05, 0.06, 1);
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR; scene.fogColor = new BABYLON.Color3(0.02, 0.05, 0.06); scene.fogStart = 24; scene.fogEnd = 56;

  placeProps(scene).catch((e) => console.warn('arena props failed', e));
  const cave = buildCave(scene, tex);

  return { update: (t: number) => { rm.alpha = 0.45 + 0.15 * Math.sin(t * 1.4); cave.update(t); } };
}

// ---- the cave: a rough stone wall all the way round, rock spires along its foot, drifting mist, and a dark vignette on the floor
const RX = 20, RZ = 15, CZ = -4, WALL_H = 16;   // oval ring centred a little behind the field: the far wall stands about 11 m past the centre
const wobble = (a: number, y: number): number => Math.sin(3 * a + 1.3) * 0.5 + Math.sin(7 * a + y * 0.5) * 0.3 + Math.sin(13 * a - y * 0.35) * 0.2 + Math.sin(23 * a + y) * 0.08;

function mistTexture(scene: any, seed: number): any {
  const S = 256, t = new BABYLON.DynamicTexture('mist' + seed, { width: S, height: S }, scene, true), c = t.getContext();
  c.clearRect(0, 0, S, S);
  let r = seed * 9301 + 49297; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 46; i++) {
    const x = rnd() * S, y = rnd() * S, rad = 26 + rnd() * 46;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {          // draw wrapped copies so the picture tiles with no seam
      const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, S, S);
    }
  }
  t.update(); t.hasAlpha = true; t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; return t;
}

function buildCave(scene: any, floorTex: any): { update(t: number): void } {
  // rough wall: an oval ring whose radius wobbles with angle and height, darker the higher it goes
  const N = 120, M = 12, pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (let j = 0; j <= M; j++) for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, h = (j / M) * WALL_H, k = 1 + 0.06 * wobble(a, h) + (j === 0 ? 0 : 0.05 * Math.sin(a * 5 + j));
    const overhang = 1 - 0.1 * Math.sin((j / M) * Math.PI);                        // leans in a little so it feels like a cavern
    pos.push(Math.cos(a) * RX * k * overhang, h, CZ + Math.sin(a) * RZ * k * overhang); uv.push((i / N) * 14, (j / M) * 3.2);
    const b = Math.max(0.06, 1.0 - (j / M) * 0.9); col.push(b * 0.8, b, b, 1);
  }
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const wall = new BABYLON.Mesh('cave', scene), vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = idx; vd.uvs = uv; vd.colors = col;
  const nrm: number[] = []; BABYLON.VertexData.ComputeNormals(pos, idx, nrm); vd.normals = nrm; vd.applyToMesh(wall);
  const wm = new BABYLON.StandardMaterial('cavem', scene); wm.diffuseTexture = floorTex.clone(); wm.diffuseTexture.uScale = 1; wm.diffuseTexture.vScale = 1;
  wm.specularColor = BABYLON.Color3.Black(); wm.backFaceCulling = false; wm.diffuseColor = new BABYLON.Color3(0.75, 0.85, 0.9); wall.material = wm; wall.isPickable = false; wall.useVertexColors = true; wm.useVertexColor = true;
  // rock spires standing along the foot of the wall (one shared mesh, many copies)
  const spire = BABYLON.MeshBuilder.CreateCylinder('spire', { diameterTop: 0, diameterBottom: 1.6, height: 1, tessellation: 5 }, scene);
  const sm = new BABYLON.StandardMaterial('spirem', scene); sm.diffuseColor = new BABYLON.Color3(0.03, 0.045, 0.055); sm.specularColor = BABYLON.Color3.Black(); sm.emissiveColor = new BABYLON.Color3(0.004, 0.012, 0.014); spire.material = sm;
  spire.convertToFlatShadedMesh(); spire.setEnabled(false); spire.isPickable = false;
  let r = 12345; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + (rnd() - 0.5) * 0.12, d = 0.86 + rnd() * 0.1, hgt = 1.4 + rnd() * 3.2, w = 0.7 + rnd() * 1.0;
    const s = spire.createInstance('sp' + i); s.isPickable = false; s.position.set(Math.cos(a) * RX * d, hgt / 2 - 0.2, CZ + Math.sin(a) * RZ * d);
    s.scaling.set(w, hgt, w); s.rotation.y = rnd() * 6; s.rotation.z = (rnd() - 0.5) * 0.18;
  }
  // mist: two slow layers just above the floor
  const layers = [0.28, 0.75].map((y, n) => {
    const p = BABYLON.MeshBuilder.CreateGround('mist' + n, { width: 60, height: 44 }, scene); p.position.y = y; p.isPickable = false;
    const m = new BABYLON.StandardMaterial('mistm' + n, scene), t = mistTexture(scene, n + 3); t.uScale = 5 - n; t.vScale = 3.4 - n * 0.6;
    m.diffuseTexture = t; m.useAlphaFromDiffuseTexture = true; m.emissiveColor = new BABYLON.Color3(0.2, 0.6, 0.55); m.disableLighting = true; m.alpha = 0.15 - n * 0.06; m.backFaceCulling = false;
    m.disableDepthWrite = true; p.material = m; p.alphaIndex = 5 + n; return { t, n };
  });
  // vignette: darkens the floor toward the edges so the field looks like a lit pool inside the cave
  const vt = new BABYLON.DynamicTexture('vig', { width: 256, height: 256 }, scene, true), vc = vt.getContext(), g = vc.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.42, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,4,6,0.7)'); g.addColorStop(1, 'rgba(0,4,6,0.95)');
  vc.fillStyle = g; vc.fillRect(0, 0, 256, 256); vt.update(); vt.hasAlpha = true;
  const vig = BABYLON.MeshBuilder.CreateGround('vig', { width: 46, height: 30 }, scene); vig.position.y = 0.03; vig.isPickable = false;
  const vm = new BABYLON.StandardMaterial('vigm', scene); vm.diffuseTexture = vt; vm.useAlphaFromDiffuseTexture = true; vm.disableLighting = true; vm.emissiveColor = new BABYLON.Color3(0, 0.01, 0.015); vm.disableDepthWrite = true; vig.material = vm; vig.alphaIndex = 1;
  return { update: (t: number) => { for (const l of layers) { l.t.uOffset = t * (0.006 + l.n * 0.004); l.t.vOffset = t * 0.003 * (l.n ? -1 : 1); } } };
}
