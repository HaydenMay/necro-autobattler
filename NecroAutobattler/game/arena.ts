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
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR; scene.fogColor = new BABYLON.Color3(0.02, 0.05, 0.06); scene.fogStart = 20; scene.fogEnd = 44;

  placeProps(scene).catch((e) => console.warn('arena props failed', e));

  return { update: (t: number) => { rm.alpha = 0.45 + 0.15 * Math.sin(t * 1.4); } };
}
