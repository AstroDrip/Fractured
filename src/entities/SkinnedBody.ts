import { Scene, TransformNode, Quaternion, Vector3, Matrix, AbstractMesh, StandardMaterial, SceneLoader } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

/** One skeleton bone driven by one node of the procedural pose rig. */
interface Binding {
  bone: TransformNode;
  source: TransformNode;
  /** K in  bone(root frame) = K · D·source(player frame)·D  (rest-pose correction). */
  k: Matrix;
}

const tq = new Quaternion(), tm1 = new Matrix(), tm2 = new Matrix(), tm3 = new Matrix(), tv = new Vector3();

/** Rotation-only part of a matrix (scale and translation removed), into `out`. */
function rotOnly(m: Matrix, out: Matrix): Matrix {
  m.decompose(undefined, tq);
  return Matrix.FromQuaternionToRef(tq, out);
}

/**
 * The authored, skinned protagonist (assets/game/character/protagonist.glb, built by
 * tools/asset_pipeline/build_protagonist.py). The game's procedural pose rig (Player)
 * keeps computing the pose, leg IK and cloth springs; this class retargets that pose
 * onto the real skeleton every frame.
 *
 * Frames: the pose rig is measured relative to the Player root; bones relative to the
 * loader's __root__, which converts glTF's right-handed space with a reflection. The
 * two frames differ by a fixed diagonal ±1 matrix D (found at load), so a rotation R in
 * the player frame is D·R·D in the bone frame. At rest each bone gets
 * K = B_rest · (D·S_rest·D)⁻¹; afterwards B = K · D·S·D and the bone's local rotation
 * is B · P⁻¹ (P = its parent in the bone frame), solved parents-first. Only the hips
 * bone also takes its source's position (bob, crouch, pelvis drop).
 */
export class SkinnedBody {
  public readonly root: TransformNode;
  public readonly meshes: AbstractMesh[];
  private bindings: Binding[] = [];
  private hipsBone: TransformNode | null = null;
  private hipsSource: TransformNode | null = null;
  private readonly d = Matrix.Identity();
  private readonly playerInv = new Matrix();
  private readonly rootInv = new Matrix();

  private constructor(root: TransformNode, meshes: AbstractMesh[]) {
    this.root = root;
    this.meshes = meshes;
  }

  /** Loads the GLB and parents it under `parent` (the Player root). Throws on failure. */
  public static async load(scene: Scene, url: string, parent: TransformNode): Promise<SkinnedBody> {
    const res = await SceneLoader.ImportMeshAsync('', '', url, scene, undefined, '.glb');
    const root = res.meshes[0] as unknown as TransformNode;   // the loader's __root__
    root.parent = parent;
    root.position.setAll(0);
    const meshes = res.meshes.filter(m => m.getTotalVertices() > 0);
    for (const m of meshes) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    for (const g of res.animationGroups) g.stop();
    return new SkinnedBody(root, meshes);
  }

  /** Swaps the exported materials for the game's own, matched by name. */
  public useMaterials(byName: Record<string, StandardMaterial>): void {
    for (const m of this.meshes) {
      const mat = m.material as unknown as { name: string; subMaterials?: (StandardMaterial | null)[] } | null;
      if (mat?.subMaterials) {
        mat.subMaterials.forEach((sm, i) => { if (sm && byName[sm.name]) mat.subMaterials![i] = byName[sm.name]; });
      } else if (mat && byName[mat.name]) {
        m.material = byName[mat.name];
      }
    }
  }

  private node(name: string): TransformNode | null {
    return (this.root.getDescendants(false) as TransformNode[]).find(n => n.name === name) ?? null;
  }

  /** Rotation of n relative to a frame whose world matrix inverse is `inv`. */
  private relRot(n: TransformNode, inv: Matrix, out: Matrix): Matrix {
    n.computeWorldMatrix(true);
    n.getWorldMatrix().multiplyToRef(inv, tm3);
    return rotOnly(tm3, out);
  }

  private frames(parent: TransformNode): void {
    parent.computeWorldMatrix(true);
    parent.getWorldMatrix().invertToRef(this.playerInv);
    this.root.computeWorldMatrix(true);
    this.root.getWorldMatrix().invertToRef(this.rootInv);
  }

  /** D·R·D for the frame change (D diagonal ±1). */
  private conj(r: Matrix, out: Matrix): Matrix {
    return this.d.multiplyToRef(r, tm2).multiplyToRef(this.d, out);
  }

  /**
   * Binds bones to pose-rig nodes, parent-first. Call with the pose rig at rest (all
   * joint rotations zero) so the corrections are rest-to-rest.
   */
  public bind(map: [string, TransformNode][], parent: TransformNode): void {
    this.frames(parent);
    // The frame change: __root__ relative to the player root, which must be diagonal ±1
    this.root.getWorldMatrix().multiplyToRef(this.playerInv, tm1);
    const m = tm1.m;
    const off = [m[1], m[2], m[4], m[6], m[8], m[9]].some(v => Math.abs(v) > 1e-3);
    const diag = [m[0], m[5], m[10]];
    if (off || diag.some(v => Math.abs(Math.abs(v) - 1) > 1e-3)) throw new Error('protagonist.glb: unexpected root frame');
    Matrix.FromValuesToRef(Math.sign(diag[0]), 0, 0, 0, 0, Math.sign(diag[1]), 0, 0, 0, 0, Math.sign(diag[2]), 0, 0, 0, 0, 1, this.d);
    for (const [name, source] of map) {
      const bone = this.node(name);
      if (!bone) throw new Error(`protagonist.glb: missing bone ${name}`);
      if (!bone.rotationQuaternion) bone.rotationQuaternion = Quaternion.FromEulerVector(bone.rotation);
      const s = this.conj(this.relRot(source, this.playerInv, new Matrix()), new Matrix());
      const b = this.relRot(bone, this.rootInv, new Matrix());
      const k = b.multiply(Matrix.Invert(s));
      this.bindings.push({ bone, source, k });
      if (name === 'hips') { this.hipsBone = bone; this.hipsSource = source; }
    }
  }

  /** Copies the pose rig's current pose onto the skeleton. */
  public apply(parent: TransformNode): void {
    this.frames(parent);
    const want = new Matrix(), pr = new Matrix(), local = new Matrix(), s = new Matrix();
    for (const b of this.bindings) {
      this.conj(this.relRot(b.source, this.playerInv, s), s);
      b.k.multiplyToRef(s, want);
      const p = b.bone.parent as TransformNode | null;
      if (p && p !== this.root) this.relRot(p, this.rootInv, pr); else pr.copyFrom(Matrix.IdentityReadOnly);
      want.multiplyToRef(Matrix.Invert(pr), local);
      local.decompose(undefined, b.bone.rotationQuaternion!);
      if (b.bone === this.hipsBone && this.hipsSource && p) {
        // Hips translation: put the bone where the pose rig's hips are
        this.hipsSource.computeWorldMatrix(true);
        tv.copyFrom(this.hipsSource.getAbsolutePosition());
        p.computeWorldMatrix(true);
        p.getWorldMatrix().invertToRef(tm1);
        Vector3.TransformCoordinatesToRef(tv, tm1, b.bone.position);
      }
      b.bone.computeWorldMatrix(true);
    }
  }
}
