// The player's character: the Necromancer (a rigged Tripo model, Pipeline/units/necromancer.json).
// He stands beside the grid, takes the hit when an army is wiped (hearts are HIS health), unleashes the repulsion shockwave and raises
// the fallen. Everything here is animation only; the rules live in core/rules.ts.
declare const BABYLON: any;

export class Necromancer {
  holder: any;                       // TransformNode: the game sets position; local +Z is his facing (the game rotates him to face the battlefield)
  private ent: any; private anims: Record<string, any> = {}; private cur: any = null; private hand: any = null; private ring: any; private ps: any;
  private t = 0; private idleT = 0; private nextTap = 8; private busy = false; private downed = false; private readonly S = 1.35;

  constructor(private scene: any, private soft: any, container: any) {
    const s = scene;
    this.holder = new BABYLON.TransformNode('necro', s);
    this.ent = container.instantiateModelsToScene((n: string) => n + '_necro', false, { doNotInstantiate: true });
    const root = this.ent.rootNodes[0]; root.parent = this.holder; this.holder.scaling.setAll(this.S);
    root.getChildMeshes().forEach((m: any) => { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; });
    this.ent.animationGroups.forEach((g: any) => { g.stop(); g.enableBlending = true; g.blendingSpeed = 0.12; this.anims[g.name.split('_')[0]] = g; });
    this.hand = root.getChildTransformNodes(false).find((n: any) => n.name.includes('Socket_Weapon')) || null;
    this.play('Idle', true);
    const ring = this.ring = BABYLON.MeshBuilder.CreateDisc('base', { radius: 0.5, tessellation: 30 }, s); ring.parent = this.holder; ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; ring.isPickable = false;
    const rm = new BABYLON.StandardMaterial('nr', s); rm.diffuseColor = BABYLON.Color3.Black(); rm.emissiveColor = new BABYLON.Color3(0.4, 0.15, 0.75); rm.disableLighting = true; rm.alpha = 0.55; ring.material = rm;
    const ps = this.ps = new BABYLON.ParticleSystem('necroAura', 80, s); ps.particleTexture = soft; ps.emitter = this.holder;
    ps.minEmitBox = new BABYLON.Vector3(-0.25, 0, -0.25); ps.maxEmitBox = new BABYLON.Vector3(0.25, 0.8, 0.25); ps.minLifeTime = 0.6; ps.maxLifeTime = 1.3;
    ps.direction1 = new BABYLON.Vector3(-0.15, 0.9, -0.15); ps.direction2 = new BABYLON.Vector3(0.15, 1.6, 0.15); ps.minEmitPower = 0.3; ps.maxEmitPower = 0.8; ps.gravity = new BABYLON.Vector3(0, 0.4, 0);
    ps.minSize = 0.07; ps.maxSize = 0.2; ps.emitRate = 30; ps.color1 = new BABYLON.Color4(0.8, 0.35, 1, 0.7); ps.color2 = new BABYLON.Color4(0.45, 0.15, 0.9, 0.5); ps.colorDead = new BABYLON.Color4(0.2, 0, 0.4, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD; ps.start();
  }

  private play(name: string, loop = false, hold = false) {
    const g = this.anims[name]; if (!g) return;
    if (this.cur && this.cur !== g) this.cur.stop();
    g.stop(); g.start(loop, 1, g.from, g.to); this.cur = g; this.busy = !loop; this.holdEnd = hold;
  }
  private holdEnd = false;
  setEnabled(on: boolean) { this.holder.setEnabled(on); if (on) this.ps.start(); else this.ps.stop(); }
  /** World position of the staff crystal (for spell effects): above the hand that holds the staff. */
  crystalPos(): any {
    this.holder.computeWorldMatrix(true);
    const base = this.hand ? (this.hand.computeWorldMatrix(true), this.hand.getAbsolutePosition().clone()) : this.holder.getAbsolutePosition().add(new BABYLON.Vector3(0, 0.6 * this.S, 0));
    return base.add(new BABYLON.Vector3(0, 0.62 * this.S, 0));
  }

  hurt() { if (!this.downed) this.play('Hurt'); }
  cast() { if (!this.downed) this.play('Cast'); }
  /** The last heart is gone: he sinks to his knees. */
  defeat() { this.downed = true; this.play('Down', false, true); }
  revive() { if (this.downed) { this.downed = false; this.play('Revive'); } else if (this.busy && this.cur !== this.anims['Idle']) this.play('Idle', true); }

  update(dt: number) {
    this.t += dt;
    if (this.cur && !this.cur.isStarted && !this.downed) this.play('Idle', true);              // a one-shot finished
    else if (this.cur && !this.cur.isStarted && this.downed && !this.holdEnd) this.play('Idle', true);
    if (!this.busy && !this.downed) { this.idleT += dt; if (this.idleT > this.nextTap) { this.idleT = 0; this.nextTap = 9 + Math.random() * 8; this.play('Tap'); } }
    this.ps.emitRate = this.downed ? 6 : (this.busy && this.cur === this.anims['Cast'] ? 110 : 30);
  }

  dispose() { this.ps.stop(); this.ps.dispose(); this.ent.animationGroups.forEach((g: any) => g.dispose()); this.ent.skeletons.forEach((s: any) => s.dispose()); this.holder.getChildMeshes().forEach((m: any) => m.dispose()); this.holder.dispose(); }
}
