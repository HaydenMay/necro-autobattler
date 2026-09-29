// The player's character: the Necromancer. A procedural placeholder (no Tripo model yet): hooded robe, glowing purple eyes, crystal staff.
// He stands beside the grid, takes the hit when an army is wiped (hearts are HIS health), unleashes the repulsion shockwave and raises
// the fallen. Everything here is animation only; the rules live in core/rules.ts.
declare const BABYLON: any;

export class Necromancer {
  holder: any;                       // TransformNode: the game sets position; local +Z is his facing (the game rotates him to face the battlefield)
  private rig: any; private staffPivot: any; private crystal: any; private crystalMat: any; private robeMat: any; private eyeMat: any; private ps: any; private glow: any;
  private t = 0; private hurtT = 0; private castT = 0; private down = 0; private downTarget = 0;

  constructor(private scene: any, private soft: any) {
    const s = scene, mat = (r: number, g: number, b: number, er = 0, eg = 0, eb = 0) => {
      const m = new BABYLON.StandardMaterial('nm', s); m.diffuseColor = new BABYLON.Color3(r, g, b); m.emissiveColor = new BABYLON.Color3(er, eg, eb); m.specularColor = BABYLON.Color3.Black(); return m;
    };
    const glowMat = (r: number, g: number, b: number, a = 1) => { const m = new BABYLON.StandardMaterial('ng', s); m.diffuseColor = BABYLON.Color3.Black(); m.emissiveColor = new BABYLON.Color3(r, g, b); m.disableLighting = true; m.alpha = a; return m; };
    this.holder = new BABYLON.TransformNode('necro', s); this.rig = new BABYLON.TransformNode('necroRig', s); this.rig.parent = this.holder;
    const add = (mesh: any, parent = this.rig) => { mesh.parent = parent; mesh.isPickable = false; return mesh; };
    this.robeMat = mat(0.09, 0.03, 0.16, 0.05, 0.02, 0.1);
    const robe = add(BABYLON.MeshBuilder.CreateCylinder('robe', { height: 0.82, diameterTop: 0.3, diameterBottom: 0.8, tessellation: 20 }, s)); robe.position.y = 0.41; robe.material = this.robeMat;
    const hem = add(BABYLON.MeshBuilder.CreateTorus('hem', { diameter: 0.78, thickness: 0.035, tessellation: 28 }, s)); hem.position.y = 0.03; hem.material = glowMat(0.9, 0.7, 0.25);
    const mantle = add(BABYLON.MeshBuilder.CreateSphere('mantle', { diameter: 0.6, segments: 12 }, s)); mantle.scaling.set(1, 0.5, 0.8); mantle.position.y = 0.8; mantle.material = this.robeMat;
    const hood = add(BABYLON.MeshBuilder.CreateSphere('hood', { diameter: 0.56, segments: 14 }, s)); hood.position.y = 1.0; hood.material = this.robeMat;
    const tip = add(BABYLON.MeshBuilder.CreateCylinder('tip', { height: 0.4, diameterTop: 0, diameterBottom: 0.34, tessellation: 14 }, s)); tip.position.set(0, 1.28, -0.06); tip.rotation.x = -0.35; tip.material = this.robeMat;
    const face = add(BABYLON.MeshBuilder.CreateSphere('face', { diameter: 0.38, segments: 12 }, s)); face.position.set(0, 0.99, 0.12); face.material = mat(0.02, 0, 0.05);
    this.eyeMat = glowMat(0.9, 0.4, 1);
    for (const x of [-0.075, 0.075]) { const e = add(BABYLON.MeshBuilder.CreateSphere('eye', { diameter: 0.075, segments: 8 }, s)); e.position.set(x, 1.0, 0.285); e.scaling.z = 0.6; e.material = this.eyeMat; }
    this.glow = add(BABYLON.MeshBuilder.CreatePlane('eyeGlow', { size: 0.5 }, s)); this.glow.position.set(0, 1.0, 0.33); this.glow.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const gm = glowMat(0.7, 0.25, 1, 0.55); gm.emissiveTexture = soft; gm.opacityTexture = soft; this.glow.material = gm;
    const hand = add(BABYLON.MeshBuilder.CreateSphere('hand', { diameter: 0.12, segments: 8 }, s)); hand.position.set(-0.32, 0.62, 0.12); hand.material = mat(0.8, 0.75, 0.65);
    // staff: pivot at the right hand so raising it is one rotation
    this.staffPivot = add(new BABYLON.TransformNode('staffPivot', s)); this.staffPivot.position.set(0.34, 0.6, 0.14);
    const rod = add(BABYLON.MeshBuilder.CreateCylinder('rod', { height: 1.5, diameter: 0.045, tessellation: 8 }, s), this.staffPivot); rod.position.y = 0.45; rod.material = mat(0.28, 0.17, 0.1);
    this.crystalMat = glowMat(0.75, 0.35, 1);
    this.crystal = add(BABYLON.MeshBuilder.CreatePolyhedron('crystal', { type: 1, size: 0.12 }, s), this.staffPivot); this.crystal.position.y = 1.28; this.crystal.scaling.y = 1.5; this.crystal.rotation.x = 0.4; this.crystal.material = this.crystalMat;
    const ring = add(BABYLON.MeshBuilder.CreateDisc('base', { radius: 0.62, tessellation: 30 }, s), this.holder); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; ring.material = glowMat(0.4, 0.15, 0.75, 0.55);
    // aura
    const ps = this.ps = new BABYLON.ParticleSystem('necroAura', 80, s); ps.particleTexture = soft; ps.emitter = this.holder;
    ps.minEmitBox = new BABYLON.Vector3(-0.3, 0, -0.3); ps.maxEmitBox = new BABYLON.Vector3(0.3, 0.9, 0.3); ps.minLifeTime = 0.6; ps.maxLifeTime = 1.3;
    ps.direction1 = new BABYLON.Vector3(-0.15, 0.9, -0.15); ps.direction2 = new BABYLON.Vector3(0.15, 1.6, 0.15); ps.minEmitPower = 0.3; ps.maxEmitPower = 0.8; ps.gravity = new BABYLON.Vector3(0, 0.4, 0);
    ps.minSize = 0.07; ps.maxSize = 0.2; ps.emitRate = 30; ps.color1 = new BABYLON.Color4(0.8, 0.35, 1, 0.7); ps.color2 = new BABYLON.Color4(0.45, 0.15, 0.9, 0.5); ps.colorDead = new BABYLON.Color4(0.2, 0, 0.4, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD; ps.start();
  }

  setEnabled(on: boolean) { this.holder.setEnabled(on); if (on) this.ps.start(); else this.ps.stop(); }
  /** World position of the staff crystal (for spell effects). */
  crystalPos(): any { this.holder.computeWorldMatrix(true); this.rig.computeWorldMatrix(true); this.staffPivot.computeWorldMatrix(true); this.crystal.computeWorldMatrix(true); return this.crystal.getAbsolutePosition().clone(); }

  hurt() { this.hurtT = 0.8; }
  cast() { this.castT = 1.1; }
  /** The last heart is gone: he sinks to his knees, the eyes dim. */
  defeat() { this.downTarget = 1; }
  revive() { this.downTarget = 0; this.hurtT = 0; this.castT = 0; }

  update(dt: number) {
    this.t += dt;
    this.down += (this.downTarget - this.down) * Math.min(1, dt * 3);
    const bob = Math.sin(this.t * 2) * 0.035 * (1 - this.down);
    let recoil = 0, flash = 0;
    if (this.hurtT > 0) { this.hurtT = Math.max(0, this.hurtT - dt); const u = this.hurtT / 0.8; recoil = Math.sin(u * Math.PI) * 0.42; flash = u; }
    let raise = 0;
    if (this.castT > 0) { this.castT = Math.max(0, this.castT - dt); const u = this.castT / 1.1; raise = Math.sin(Math.min(1, (1 - u) * 1.6) * Math.PI * 0.5) * (u > 0.25 ? 1 : u / 0.25); }
    this.rig.position.y = bob - 0.28 * this.down; this.rig.rotation.x = -recoil + 0.9 * this.down; this.rig.rotation.z = Math.sin(this.t * 1.3) * 0.03 + Math.sin(this.hurtT * 60) * 0.03 * (this.hurtT > 0 ? 1 : 0);
    this.staffPivot.rotation.z = -0.15 * raise - 0.05; this.staffPivot.rotation.x = -0.45 * raise; this.staffPivot.position.y = 0.6 + 0.35 * raise;
    this.crystal.rotation.y += dt * (2 + 6 * raise); const pulse = 1 + 0.12 * Math.sin(this.t * 4) + 1.1 * raise; this.crystal.scaling.set(pulse, 1.5 * pulse, pulse);
    const dim = 1 - 0.85 * this.down;
    this.crystalMat.emissiveColor.set((0.75 + 0.25 * raise) * dim, (0.35 + 0.4 * raise) * dim, 1 * dim);
    this.eyeMat.emissiveColor.set(0.9 * dim + flash * 0.1, (0.4 + 0.25 * raise) * dim * (1 - flash * 0.6), 1 * dim * (1 - flash * 0.7));
    this.robeMat.emissiveColor.set(0.05 + flash * 0.6, 0.02, 0.1 * (1 - flash));
    this.glow.scaling.setAll(0.6 + 0.9 * dim + raise * 0.8);
    this.ps.emitRate = (30 + 90 * raise) * dim;
  }

  dispose() { this.ps.stop(); this.ps.dispose(); this.holder.getChildMeshes().forEach((m: any) => m.dispose()); this.holder.dispose(); }
}
