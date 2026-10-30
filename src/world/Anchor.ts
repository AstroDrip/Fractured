import { Scene, Mesh, MeshBuilder, StandardMaterial, DynamicTexture, Color3, Material } from '@babylonjs/core';
import { Materials } from './Materials';
import { ANCHOR } from './layout';

/**
 * The first contradiction: one signal post, two positions. In Normal it lies across the
 * ledge's mouth and casts no shadow of its own; on the ledge floor lies the shadow of a
 * post standing upright at the far end. In Deranged the post stands there, and the shadow
 * on the ground is the shadow of a post lying across the mouth. Neither post casts a real
 * shadow (they are kept out of the shadow casters), so only the false ones are seen.
 * The two positions cross-fade with Deranged; collision is the walk grid's (the ledge
 * exists only in Deranged), never the meshes.
 */
export class Anchor {
  public meshes: Mesh[] = [];
  private lying!: Mesh;
  private standing!: Mesh;
  private shadowUp!: Mesh;       // Normal: the shadow of the post standing
  private shadowDown!: Mesh;     // Deranged: the shadow of the post lying
  private shadowMat!: StandardMaterial;

  constructor(private scene: Scene, private mats: Materials, private ground: (x: number, z: number) => number) {}

  public build(): void {
    const A = ANCHOR, h = A.spur.h;
    const post = (name: string) => {
      const shaft = MeshBuilder.CreateBox(name + 'Shaft', { width: 0.2, height: 2.6, depth: 0.2 }, this.scene);
      shaft.position.y = 1.3;
      const arm = MeshBuilder.CreateBox(name + 'Arm', { width: 0.9, height: 0.12, depth: 0.08 }, this.scene);
      arm.position.set(0.35, 2.35, 0); arm.rotation.z = -0.35;
      const plate = MeshBuilder.CreateBox(name + 'Plate', { width: 0.34, height: 0.34, depth: 0.04 }, this.scene);
      plate.position.set(0.72, 2.2, 0.05);
      // Painted pale, as signal posts were: it has to be seen lying in the dark
      shaft.material = this.mats.signPlate; arm.material = this.mats.timber; plate.material = this.mats.signPlate;
      const m = Mesh.MergeMeshes([shaft, arm, plate], true, true, undefined, false, true)!;
      m.name = name; m.isPickable = false;
      this.meshes.push(m);
      return m;
    };
    // Lying across the mouth, along z, its arm toward the line
    this.lying = post('anchorLying');
    this.lying.position.set(A.lying.x, h + 0.12, A.lying.z0);
    this.lying.rotation.set(Math.PI / 2, 0, 0.12);
    // Standing at the far end of the ledge
    this.standing = post('anchorStanding');
    this.standing.position.set(A.standing.x, h, A.standing.z);
    this.standing.rotation.y = Math.PI * 0.08;

    // False shadows: soft dark strips on the ground
    const tex = new DynamicTexture('anchorShadowTex', { width: 16, height: 128 }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.75, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 128);
    tex.update(); tex.hasAlpha = true;
    this.shadowMat = new StandardMaterial('anchorShadowMat', this.scene);
    this.shadowMat.diffuseColor = new Color3(0, 0, 0);
    this.shadowMat.specularColor = new Color3(0, 0, 0);
    this.shadowMat.opacityTexture = tex;
    this.shadowMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.shadowMat.disableDepthWrite = true;
    const strip = (name: string, len: number) => {
      const m = MeshBuilder.CreateGround(name, { width: 0.3, height: len }, this.scene);
      m.material = this.shadowMat; m.isPickable = false;
      this.meshes.push(m);
      return m;
    };
    // The standing post's shadow: long, as under the low moon, from its foot along the
    // ledge floor and out across the path, ending in the square of its sign plate
    // Laid in short pieces at the ground's own height, so the steps of the shelf never hide it
    const dx = A.shadowTip.x - A.standing.x, dz = A.shadowTip.z - A.standing.z, len = Math.hypot(dx, dz);
    const n = Math.ceil(len / 0.4), parts: Mesh[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
      const seg = MeshBuilder.CreateGround('anchorShadowSeg', { width: 0.34, height: len / n + 0.02 }, this.scene);
      const x = A.standing.x + dx * tm, z = A.standing.z + dz * tm;
      seg.position.set(x, this.ground(x, z) + 0.03, z);
      seg.rotation.y = Math.atan2(dx, dz);
      // Soft toward the tip, as a long shadow is
      seg.scaling.x = 1 - tm * 0.25;
      parts.push(seg);
    }
    const tip = MeshBuilder.CreateGround('anchorShadowPlate', { width: 0.6, height: 0.55 }, this.scene);
    const tx = A.shadowTip.x - dx / len * 0.5, tz = A.shadowTip.z - dz / len * 0.5;
    tip.position.set(tx + 0.2, this.ground(tx, tz) + 0.035, tz); tip.rotation.y = Math.atan2(dx, dz);
    parts.push(tip);
    this.shadowUp = Mesh.MergeMeshes(parts, true)!;
    this.shadowUp.name = 'anchorShadowUp'; this.shadowUp.material = this.solidShadow(); this.shadowUp.isPickable = false;
    this.meshes.push(this.shadowUp);
    // The lying post's shadow: along the mouth, where the post was
    this.shadowDown = strip('anchorShadowDown', A.lying.z1 - A.lying.z0);
    this.shadowDown.position.set(A.lying.x + 0.15, h + 0.03, (A.lying.z0 + A.lying.z1) / 2);
    this.update(0);
  }

  /** The long shadow is uniform (its pieces would each repeat the gradient). */
  private solidShadow(): StandardMaterial {
    const m = new StandardMaterial('anchorShadowLongMat', this.scene);
    m.diffuseColor = new Color3(0, 0, 0); m.specularColor = new Color3(0, 0, 0);
    m.alpha = 0.72; m.disableDepthWrite = true;
    return m;
  }

  /** d: 0..1, how far the world has resolved into Deranged. */
  public update(d: number): void {
    const k = Math.min(1, Math.max(0, (d - 0.15) / 0.7));
    this.lying.visibility = 1 - k; this.lying.isVisible = k < 0.99;
    this.standing.visibility = k; this.standing.isVisible = k > 0.01;
    this.shadowUp.visibility = 1 - k; this.shadowUp.isVisible = k < 0.99;
    this.shadowDown.visibility = k; this.shadowDown.isVisible = k > 0.01;
  }
}
