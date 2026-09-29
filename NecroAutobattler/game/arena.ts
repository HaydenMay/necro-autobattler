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
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR; scene.fogColor = new BABYLON.Color3(0.02, 0.05, 0.06); scene.fogStart = 16; scene.fogEnd = 34;

  return { update: (t: number) => { rm.alpha = 0.45 + 0.15 * Math.sin(t * 1.4); } };
}
