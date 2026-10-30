import { Scene, Mesh, MeshBuilder, LinesMesh, Color3, Vector3 } from '@babylonjs/core';
import { Materials } from './Materials';
import { ThinBatch } from './ThinBatch';
import { EnvAssets } from './EnvAssets';
import { WalkGrid } from './WalkGrid';
import { Terrain } from './Terrain';
import { FOREST, forestAt, GROUND_Y } from './layout';
import { mulberry32 } from '../core/rng';
import { R_ALL } from '../core/Reality';

type Family = 'tall' | 'twisted' | 'dead';
const FAMILY_MESHES: Record<Family, string[]> = {
  tall: ['treeTall0', 'treeTall1'], twisted: ['treeTwisted0', 'treeTwisted1'], dead: ['treeDead0', 'treeDead1']
};
const TRUNK_R: Record<Family, number> = { tall: 0.3, twisted: 0.5, dead: 0.32 };

/**
 * The forest and the cliff: authored tree families (tools/asset_pipeline/build_forest.py)
 * placed along the walkways by section (transition → corridor → cliff), never on the
 * camera's side of the path where they would stand in front of the protagonist; roots,
 * stumps, fallen trunks; the root lattice that bars the path in Normal and leaves only
 * a trace in Void; a coat in the side clearing; the overlook and a footbridge that ends
 * in the fog. Trunks near walkways get circle colliders so what is seen is what blocks.
 */
export class Forest {
  public meshes: Mesh[] = [];
  public shadowCasters: Mesh[] = [];
  private lattice: Mesh[] = [];
  private trace!: LinesMesh;
  private rnd = mulberry32(5150);

  constructor(private scene: Scene, private mats: Materials, private grid: WalkGrid, private terrain: Terrain) {}

  private ground(x: number, z: number): number {
    const h = this.terrain.heightAt(x, z);
    return h > -100 ? h : GROUND_Y;
  }

  private batch(name: string, fallback: () => Mesh): ThinBatch {
    const src = EnvAssets.get(name)?.[0];
    const m = src ? src.clone('forest_' + name, null)! : fallback();
    m.setEnabled(true);
    m.material = name.startsWith('treeDead') || name === 'stump0' ? this.mats.signPlate : this.mats.bark;
    return new ThinBatch(m);
  }

  public build(): void {
    const batches = new Map<string, ThinBatch>();
    const get = (n: string) => {
      if (!batches.has(n)) batches.set(n, this.batch(n, () => MeshBuilder.CreateCylinder(n, { height: 6, diameterTop: 0.1, diameterBottom: 0.4, tessellation: 7 }, this.scene)));
      return batches.get(n)!;
    };
    // Camera stands toward +X/−Z of the protagonist: keep tall things to the other side
    const cameraSide = (x: number, z: number, px: number, pz: number) => (x - px) * 0.707 - (z - pz) * 0.707 > 0.6;
    const place = (family: Family, x: number, z: number, scale: number) => {
      const name = FAMILY_MESHES[family][Math.floor(this.rnd() * 2)];
      const t = 0.72 + this.rnd() * 0.25;
      get(name).add(x, this.ground(x, z) - 0.1, z, this.rnd() * Math.PI * 2, (this.rnd() - 0.5) * 0.06, (this.rnd() - 0.5) * 0.06,
        scale, scale * (0.9 + this.rnd() * 0.2), scale, t, t * 0.98, t * 0.96);
      if (forestAt(x, z).d < 3) {
        this.grid.obstacles.push({ kind: 'circle', x, z, r: TRUNK_R[family] * scale, x0: 0, z0: 0, x1: 0, z1: 0, realities: R_ALL });
      }
    };
    const familyAt = (z: number): Family => {
      const r = this.rnd();
      if (z < 76) return r < 0.5 ? 'twisted' : 'tall';           // the transition: old trees first
      if (z < 95) return r < 0.75 ? 'tall' : 'twisted';           // the corridor: tall, close, dark
      return r < 0.6 ? 'dead' : 'twisted';                         // toward the cliff: broken things
    };
    // Along the walkways
    for (const route of [FOREST.route, FOREST.exit]) {
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i], b = route[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
        for (let s = 0; s < len; s += 2.6 + this.rnd() * 1.8) {
          const px = a.x + (b.x - a.x) * (s / len), pz = a.z + (b.z - a.z) * (s / len);
          for (const side of [-1, 1]) {
            const off = 2.4 + this.rnd() * 3.6;
            const x = px + nx * off * side, z = pz + nz * off * side;
            if (forestAt(x, z).d < 0.9 || x < FOREST.edgeX + 1.2 || x > -4.8) continue;
            // The overlook stays open: nothing between it and the view, or in front of the camera
            if (Math.hypot(x - FOREST.overlook.x, z - FOREST.overlook.z) < 8) continue;
            if (cameraSide(x, z, px, pz)) {
              // Only low things on the camera's side: a stump or a knot of roots
              if (this.rnd() < 0.35) get(this.rnd() < 0.5 ? 'stump0' : 'roots0').add(x, this.ground(x, z), z, this.rnd() * 6.3, 0, 0, 0.5 + this.rnd() * 0.3, 0.5, 0.5 + this.rnd() * 0.3, 0.8, 0.8, 0.8);
              continue;
            }
            const fam = familyAt(z);
            // Twisted trees spread wide: only well back from the path
            if (fam === 'twisted' && off < 4) continue;
            place(fam, x, z, 0.85 + this.rnd() * 0.5);
          }
        }
      }
    }
    // Depth behind the corridor: a stand of tall trunks fading into fog
    for (let i = 0; i < 36; i++) {
      const x = -22 - this.rnd() * 9, z = 64 + this.rnd() * 32;
      if (forestAt(x, z).d < 2.5 || x < FOREST.edgeX + 0.5 && z > 96) continue;
      place('tall', x, z, 1.0 + this.rnd() * 0.45);
    }
    // Fallen trunks and rocks on the forest floor, away from the path
    const rockB = this.batch('rockA', () => MeshBuilder.CreatePolyhedron('fRock', { type: 2, size: 0.5 }, this.scene));
    rockB.mesh.material = this.mats.stone;
    for (let i = 0; i < 26; i++) {
      const x = -30 + this.rnd() * 24, z = 62 + this.rnd() * 50;
      if (forestAt(x, z).d < 1.2 || (x < FOREST.edgeX && z > 96)) continue;
      if (Math.hypot(x - FOREST.overlook.x, z - FOREST.overlook.z) < 8) continue;
      const sc = 0.6 + this.rnd() * 1.6, t = 0.45 + this.rnd() * 0.15;
      rockB.add(x, this.ground(x, z) - 0.1, z, this.rnd() * 6.3, 0, 0, sc * 1.3, sc * 0.8, sc, t, t, t * 1.02);
    }
    for (const [x, z, yaw] of [[-23.5, 74.5, 0.6], [-13.2, 96.5, -0.9], [-27.0, 90.0, 1.4]] as [number, number, number][]) {
      get('fallen1').add(x, this.ground(x, z) - 0.15, z, yaw, 0, 0.03, 1, 1, 1, 0.8, 0.8, 0.8);
    }
    for (const b of batches.values()) { const m = b.commit(); this.meshes.push(m); this.shadowCasters.push(m); }
    const rm = rockB.commit(); this.meshes.push(rm); this.shadowCasters.push(rm);

    this.buildLattice();
    this.buildClearing();
    this.buildOverlook();
  }

  /** Roots arched out of the ground and a fallen trunk across them: matter, gone in Void. */
  private buildLattice(): void {
    const l = FOREST.lattice, cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2, g = this.ground(cx, cz);
    const add = (name: string, x: number, y: number, z: number, ry: number, s: number) => {
      const src = EnvAssets.get(name)?.[0];
      const m = src ? src.clone('lattice_' + name, null)! : MeshBuilder.CreateBox(name, { width: 5, height: 1.2, depth: 1.5 }, this.scene);
      m.setEnabled(true); m.material = this.mats.bark;
      m.position.set(x, y, z); m.rotation.y = ry; m.scaling.setAll(s);
      this.lattice.push(m); this.meshes.push(m); this.shadowCasters.push(m);
    };
    add('roots0', cx, g, cz, 0.08, 1.0);
    add('roots0', cx + 0.4, g, cz + 0.7, Math.PI + 0.3, 0.8);
    add('fallen0', cx - 0.6, g + 0.25, cz - 0.1, -0.12, 1.05);
    // The trace that stays when the matter goes
    const lines: Vector3[][] = [];
    for (let k = 0; k < 6; k++) {
      const x0 = l.x0 + k * 0.85, pts: Vector3[] = [];
      for (let j = 0; j <= 8; j++) pts.push(new Vector3(x0 + j * 0.12, g + Math.sin(j / 8 * Math.PI) * (0.9 + (k % 3) * 0.35), cz + Math.sin(j + k) * 0.3));
      lines.push(pts);
    }
    lines.push([new Vector3(l.x0 - 2.6, g + 0.6, cz - 0.4), new Vector3(l.x1 + 1.8, g + 0.5, cz + 0.2)]);
    this.trace = MeshBuilder.CreateLineSystem('latticeTrace', { lines }, this.scene);
    this.trace.color = new Color3(0.72, 0.78, 0.84);
    this.trace.alpha = 0.04;
    this.trace.isPickable = false;
  }

  /** The side clearing: a ring of stones round a stump, a coat buttoned on a branch. */
  private buildClearing(): void {
    const c = FOREST.clearing, g = this.ground(c.x, c.z);
    const parts: Mesh[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = MeshBuilder.CreatePolyhedron('ringStone', { type: 2, size: 0.18 + this.rnd() * 0.06 }, this.scene);
      s.position.set(c.x + Math.cos(a) * 1.3, g + 0.08, c.z + Math.sin(a) * 1.3);
      s.material = this.mats.stone; parts.push(s);
    }
    const coat = MeshBuilder.CreateCylinder('hungCoat', { height: 1.15, diameterTop: 0.3, diameterBottom: 0.52, tessellation: 9 }, this.scene);
    coat.position.set(c.x - 1.9, g + 1.35, c.z + 1.4); coat.scaling.z = 0.5; coat.rotation.y = 0.4; coat.material = this.mats.coat;
    const peg = MeshBuilder.CreateCylinder('coatBranch', { height: 1.4, diameter: 0.07, tessellation: 5 }, this.scene);
    peg.position.set(c.x - 1.9, g + 1.95, c.z + 1.4); peg.rotation.z = Math.PI / 2 - 0.2; peg.material = this.mats.bark;
    parts.push(coat, peg);
    const m = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    m.name = 'clearing'; m.isPickable = false;
    this.meshes.push(m); this.shadowCasters.push(m);
    // The stump at the centre and a twisted tree over it
    const st = EnvAssets.get('stump0')?.[0];
    if (st) { const s = st.clone('clearingStump', null)!; s.setEnabled(true); s.material = this.mats.signPlate; s.position.set(c.x, g, c.z); this.meshes.push(s); }
  }

  /** The overlook: a broken railing, and planks of a footbridge that run out into nothing. */
  private buildOverlook(): void {
    const o = FOREST.overlook, b = FOREST.bridge, g = this.ground(o.x, o.z);
    const parts: Mesh[] = [];
    const post = (x: number, z: number, h: number, lean: number) => {
      const p = MeshBuilder.CreateBox('railPost', { width: 0.09, height: h, depth: 0.09 }, this.scene);
      p.position.set(x, g + h / 2, z); p.rotation.z = lean; p.material = this.mats.timber; parts.push(p);
    };
    // The railing, open where the footbridge leaves it
    for (let i = 0; i < 4; i++) {
      const z = o.z - 2 + i * 1.3;
      if (Math.abs(z - b.z) < 0.9) continue;
      post(FOREST.edgeX + 0.9, z, 1.0 - (i === 2 ? 0.45 : 0), (this.rnd() - 0.5) * 0.25);
    }
    const rail = MeshBuilder.CreateBox('rail', { width: 0.06, height: 0.07, depth: 2.6 }, this.scene);
    rail.position.set(FOREST.edgeX + 0.9, g + 0.85, o.z - 2.4); rail.material = this.mats.timber; parts.push(rail);
    const m = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    m.name = 'overlook'; m.isPickable = false;
    this.meshes.push(m); this.shadowCasters.push(m);
  }

  /** The lattice goes with the rest of the matter in Void; its trace stays. */
  public update(voidAmt: number): void {
    for (const m of this.lattice) { m.visibility = 1 - voidAmt * 0.95; m.isVisible = voidAmt < 0.98; }
    this.trace.alpha = 0.04 + voidAmt * 0.5;
  }
}
