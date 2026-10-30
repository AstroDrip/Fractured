import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, VertexData, Vector3, Material } from '@babylonjs/core';
import { Materials } from './Materials';
import { ThinBatch } from './ThinBatch';
import { EnvAssets } from './EnvAssets';
import { RIFT, riftHeight } from './layout';
import { mulberry32 } from '../core/rng';

const STEP = 0.75;            // terrain mesh resolution (m): smooth slopes, cliffs stay steep

/**
 * The rift's look. Terrain is one continuous mesh sampled from riftHeight (the same
 * function the walk grid and the flame use): shelves roll gently, the east wall and the
 * chasm edges are steep, and vertex colours lay pale strata into every steep face while
 * flat ground stays earth-dark. Standing on it: the footbridge (planks, its middle only a
 * pale deck in Void), the fallen trunk over the chasm, the slab of earth hanging over
 * it, two held masses, roots hanging off the shelf edges, sleepers set into the rock.
 */
export class Rift {
  public meshes: Mesh[] = [];
  public shadowCasters: Mesh[] = [];
  public rock!: StandardMaterial;
  public heldRock!: StandardMaterial;
  private voidDeck!: Mesh;
  private deckMat!: StandardMaterial;
  private rnd = mulberry32(2626);

  constructor(private scene: Scene, private mats: Materials) {}

  public build(): void {
    this.buildTerrain();
    this.buildBridge();
    this.buildTrunk();
    this.buildLandmark();
    this.buildDetail();
  }

  private buildTerrain(): void {
    const b = RIFT.bounds;
    const nx = Math.round((b.x1 - b.x0) / STEP), nz = Math.round((b.z1 - b.z0) / STEP);
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const H = (x: number, z: number) => riftHeight(x, z) ?? RIFT.chasm.floor;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = b.x0 + i * STEP, z = b.z0 + j * STEP, y = H(x, z);
        pos.push(x, y, z);
        // Strata: pale bands in steep faces, dark earth on top, near-black in the depths
        const slope = Math.abs(H(x + STEP, z) - H(x - STEP, z)) + Math.abs(H(x, z + STEP) - H(x, z - STEP));
        const steep = Math.min(1, slope / 2.5);
        const band = 0.5 + 0.5 * Math.sin(y * 2.6 + Math.sin(x * 0.3) * 0.6);
        const deep = Math.max(0, Math.min(1, (y + 4) / 6));
        const earth = [0.19, 0.165, 0.13], stone = [0.36 + band * 0.18, 0.36 + band * 0.17, 0.35 + band * 0.15];
        for (let c = 0; c < 3; c++) col.push((earth[c] + (stone[c] - earth[c]) * steep) * (0.35 + 0.65 * deep));
        col.push(1);
      }
    }
    const row = nx + 1;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);   // clockwise from above: Babylon's front face
    }
    const vd = new VertexData();
    vd.positions = pos; vd.indices = idx; vd.colors = col;
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, idx, normals);
    vd.normals = normals;
    const mesh = new Mesh('riftTerrain', this.scene);
    vd.applyToMesh(mesh);
    this.rock = new StandardMaterial('riftRock', this.scene);
    this.rock.diffuseTexture = this.mats.ground.diffuseTexture;
    this.rock.bumpTexture = this.mats.ground.bumpTexture;
    this.rock.specularColor = new Color3(0.03, 0.03, 0.03);
    mesh.material = this.rock;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    this.meshes.push(mesh);
  }

  /** The footbridge: planks across the gap with ropes; its middle is missing, a pale deck in Void. */
  private buildBridge(): void {
    const br = RIFT.bridge;
    const planks = new ThinBatch(MeshBuilder.CreateBox('riftPlank', { width: 0.22, height: 0.05, depth: br.halfWidth * 2 + 0.1 }, this.scene));
    planks.mesh.material = this.mats.timber;
    for (let x = br.x1 + 0.4; x > br.x0 - 0.3; x -= 0.3) {
      if (x > br.void0 && x < br.void1) continue;                 // gone
      const sag = Math.sin((br.x1 - x) / (br.x1 - br.x0) * Math.PI) * 0.12;
      const t = 0.7 + this.rnd() * 0.25;
      planks.add(x, br.h - 0.03 - sag, br.z + (this.rnd() - 0.5) * 0.05, (this.rnd() - 0.5) * 0.06, 0, (this.rnd() - 0.5) * 0.05, 1, 1, 1, t, t, t);
    }
    const pm = planks.commit(); this.meshes.push(pm); this.shadowCasters.push(pm);
    // Ropes either side, slack where the planks are missing
    const ropes: Vector3[][] = [];
    for (const dz of [-br.halfWidth - 0.05, br.halfWidth + 0.05]) {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const x = br.x1 + 0.4 - i * (br.x1 - br.x0 + 0.7) / 16;
        const mid = x > br.void0 - 0.5 && x < br.void1 + 0.5 ? 0.35 : 0;
        pts.push(new Vector3(x, br.h + 0.85 - Math.sin(i / 16 * Math.PI) * 0.3 - mid, br.z + dz));
      }
      ropes.push(pts);
    }
    const r = MeshBuilder.CreateLineSystem('riftRopes', { lines: ropes }, this.scene);
    r.color = new Color3(0.2, 0.19, 0.17); r.isPickable = false;
    // The missing middle: a pale deck that is there only in Void
    this.deckMat = new StandardMaterial('riftVoidDeck', this.scene);
    this.deckMat.disableLighting = true;
    this.deckMat.emissiveColor = new Color3(0.62, 0.66, 0.7);
    this.deckMat.alpha = 0;
    this.deckMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.voidDeck = MeshBuilder.CreateBox('riftDeck', { width: br.void1 - br.void0 + 0.3, height: 0.05, depth: br.halfWidth * 2 }, this.scene);
    this.voidDeck.position.set((br.void0 + br.void1) / 2, br.h - 0.12, br.z);
    this.voidDeck.material = this.deckMat; this.voidDeck.isPickable = false;
    this.meshes.push(this.voidDeck);
  }

  /** The fallen trunk across the chasm (forest asset), its crown on the west shelf. */
  private buildTrunk(): void {
    const t = RIFT.trunk;
    const src = EnvAssets.get('fallen0')?.[0];
    const m = src ? src.clone('riftTrunk', null)! : MeshBuilder.CreateCylinder('riftTrunk', { height: 7, diameter: 0.7, tessellation: 9 }, this.scene);
    m.setEnabled(true); m.material = this.mats.bark;
    m.position.set((t.x0 + t.x1) / 2, (t.h0 + t.h1) / 2 - 0.2, t.z);
    m.rotation.z = Math.atan2(t.h1 - t.h0, t.x1 - t.x0) * -1;
    if (!src) m.rotation.z = Math.PI / 2;
    m.scaling.set(0.85, 1, 1);
    this.meshes.push(m); this.shadowCasters.push(m);
  }

  /** The slab of earth hanging nearly upright over the chasm, roots off its side; two held masses. */
  private buildLandmark(): void {
    const s = RIFT.slab;
    // Its own dark rock (the terrain material relies on vertex colours these meshes lack)
    this.heldRock = new StandardMaterial('riftHeldRock', this.scene);
    this.heldRock.diffuseTexture = this.mats.ground.diffuseTexture;
    this.heldRock.bumpTexture = this.mats.ground.bumpTexture;
    this.heldRock.diffuseColor = new Color3(0.42, 0.4, 0.38);
    this.heldRock.specularColor = new Color3(0.03, 0.03, 0.03);
    const slab = EnvAssets.get('riftSlab');
    if (slab) {
      for (const src of slab) {
        const m = src.clone('riftSlab', null)!; m.setEnabled(true);
        m.material = src.material?.name === 'bark' ? this.mats.bark : this.heldRock;
        m.position.set(s.x, s.y, s.z); m.rotation.set(0.12, 0.35, 1.25);
        this.meshes.push(m);
      }
    } else {
      const m = MeshBuilder.CreateBox('riftSlab', { width: 16, height: 2.4, depth: 9 }, this.scene);
      m.material = this.heldRock; m.position.set(s.x, s.y, s.z); m.rotation.set(0.12, 0.35, 1.25);
      this.meshes.push(m);
    }
    const mass = EnvAssets.get('riftMass')?.[0];
    for (const ms of RIFT.masses) {
      const m = mass ? mass.clone('riftMass', null)! : MeshBuilder.CreatePolyhedron('riftMass', { type: 2, size: 2 }, this.scene);
      m.setEnabled(true); m.material = this.heldRock;
      m.position.set(ms.x, ms.y, ms.z); m.scaling.setAll(ms.s); m.rotation.y = ms.x;
      this.meshes.push(m);
    }
  }

  /** Roots off the shelf edges, rocks on the shelves, sleepers set upright in the promontory. */
  private buildDetail(): void {
    const roots = EnvAssets.get('roots0')?.[0];
    if (roots) {
      const rb = new ThinBatch(roots.clone('riftRoots', null)!);
      rb.mesh.setEnabled(true); rb.mesh.material = this.mats.bark;
      // Hanging over the east wall and the chasm's lips, upside down
      for (const [x, z, y] of [[-46.2, 106, 3.6], [-46.4, 118, 3.4], [-54.8, 104.5, -2.6], [-54.9, 112, -2.8], [-60.2, 116, -1.8]] as [number, number, number][]) {
        rb.add(x, y, z, Math.PI / 2 + this.rnd() * 0.4, Math.PI, 0, 0.8, 0.9, 0.8, 0.8, 0.8, 0.8);
      }
      const m = rb.commit(); this.meshes.push(m);
    }
    const rock = EnvAssets.get('rockC')?.[0];
    if (rock) {
      const rk = new ThinBatch(rock.clone('riftRocks', null)!);
      rk.mesh.setEnabled(true); rk.mesh.material = this.mats.stone;
      const spots: [number, number][] = [[-37.5, 103], [-44, 119.5], [-38, 120], [-51, 101.5], [-53.5, 116], [-62, 98.5], [-71, 110], [-66, 121], [-72, 100]];
      for (const [x, z] of spots) {
        const h = riftHeight(x, z) ?? 0;
        const sc = 0.8 + this.rnd() * 1.8, t = 0.5 + this.rnd() * 0.2;
        rk.add(x, h - 0.15, z, this.rnd() * 6.3, 0, 0, sc * 1.3, sc * 0.8, sc, t, t, t);
      }
      const m = rk.commit(); this.meshes.push(m); this.shadowCasters.push(m);
    }
    const sl = new ThinBatch(MeshBuilder.CreateBox('riftSleeper', { width: 0.25, height: 2.2, depth: 0.14 }, this.scene));
    sl.mesh.material = this.mats.timber;
    const p = RIFT.promontory;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = p.x + Math.cos(a) * (p.r + 0.6), z = p.z + Math.sin(a) * (p.r + 0.6);
      sl.add(x, RIFT.upper.h + 0.6, z, a, (this.rnd() - 0.5) * 0.25, (this.rnd() - 0.5) * 0.2, 1, 0.7 + this.rnd() * 0.5, 1, 0.75, 0.73, 0.7);
    }
    const sm = sl.commit(); this.meshes.push(sm); this.shadowCasters.push(sm);
    void Color4;
  }

  public update(voidAmt: number): void {
    this.deckMat.alpha = voidAmt * 0.85;
    this.voidDeck.isVisible = voidAmt > 0.01;
  }
}
