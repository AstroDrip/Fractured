import {
  Scene, Mesh, MeshBuilder, Vector3, Quaternion, Color3, PointLight, LinesMesh
} from '@babylonjs/core';
import { mulberry32, smoothstep } from '../core/rng';
import { ThinBatch } from './ThinBatch';
import { Materials } from './Materials';
import { Terrain } from './Terrain';
import { WalkGrid } from './WalkGrid';
import {
  polePositions, GROUNDED_CABLE_POLE_Z, SIGNS, HUTS, TREES, FENCE_RUNS, BOOT, LAMP, PUDDLES,
  FOOTPRINTS_TO_EDGE, FOOTPRINTS_RETURNING, BARRIER, GAP_NEAR_Z, GAP_FAR_Z,
  WORLD_END_Z, GROUND_Y, BED_Y, walkDistance, inGap
} from './layout';

const UP = new Vector3(0, 1, 0);

// The isometric camera looks from +X/-Z. Tall props within ~13 m on that side of the
// route would stand between the camera and the protagonist, so they are kept back.
function cameraSide(x: number, z: number): boolean {
  const d = walkDistance(x, z);
  if (d > 13) return false;
  // Offset from the route toward the camera: probe a step back along the camera direction
  return walkDistance(x - 3, z + 3) < d - 1.5;
}
const POLE_HEIGHT = 6.4;

/** Telegraph wires: one updatable line system, swaying and bending toward the fire. */
export class CableSystem {
  private lines: Vector3[][] = [];
  private spans: { a: Vector3; b: Vector3; sag: number; phase: number; grounded: boolean }[] = [];
  private mesh: LinesMesh | null = null;
  private static readonly SEG = 14;

  constructor(private scene: Scene) {}

  public addSpan(a: Vector3, b: Vector3, sag: number, grounded = false): void {
    this.spans.push({ a: a.clone(), b: b.clone(), sag, phase: this.spans.length * 1.7, grounded });
    const pts: Vector3[] = [];
    for (let i = 0; i <= CableSystem.SEG; i++) pts.push(Vector3.Zero());
    this.lines.push(pts);
  }

  public build(): void {
    this.evaluate(0, null, 0);
    this.mesh = MeshBuilder.CreateLineSystem('cables', { lines: this.lines, updatable: true }, this.scene);
    this.mesh.color = new Color3(0.07, 0.07, 0.08);
    this.mesh.isPickable = false;
  }

  private evaluate(time: number, fire: Vector3 | null, fireStrength: number): void {
    const n = CableSystem.SEG;
    for (let s = 0; s < this.spans.length; s++) {
      const sp = this.spans[s];
      const pts = this.lines[s];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = pts[i];
        p.set(sp.a.x + (sp.b.x - sp.a.x) * t, sp.a.y + (sp.b.y - sp.a.y) * t, sp.a.z + (sp.b.z - sp.a.z) * t);
        const bow = 4 * t * (1 - t);
        p.y -= sp.sag * (sp.grounded ? bow * 0.4 : bow);
        if (i === 0 || i === n) continue;
        // Slow sway, strongest mid-span
        p.x += Math.sin(time * 0.9 + sp.phase + t * 2) * 0.05 * bow;
        p.y += Math.sin(time * 0.7 + sp.phase * 1.3) * 0.03 * bow;
        // The wires lean toward the fire as if it had weight
        if (fire && fireStrength > 0.01) {
          const dx = fire.x - p.x, dy = fire.y - p.y, dz = fire.z - p.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 5.5 && d > 0.01) {
            const k = (1 - d / 5.5) ** 2 * 0.55 * fireStrength * bow;
            p.x += dx / d * k; p.y += dy / d * k; p.z += dz / d * k;
          }
        }
      }
    }
  }

  public update(time: number, fire: Vector3, fireStrength: number): void {
    if (!this.mesh) return;
    this.evaluate(time, fire, fireStrength);
    MeshBuilder.CreateLineSystem('cables', { lines: this.lines, instance: this.mesh });
  }
}

/** Builds every static prop of the chapter from the shared material library. */
export class Props {
  public meshes: Mesh[] = [];
  public shadowCasters: Mesh[] = [];
  public cables: CableSystem;
  public lampLight!: PointLight;
  public barrierMeshes: Mesh[] = [];
  public treeVariants: Mesh[] = [];
  public huts: Mesh[] = [];
  private rnd = mulberry32(4242);

  constructor(private scene: Scene, private mats: Materials, private terrain: Terrain, private grid: WalkGrid) {
    this.cables = new CableSystem(scene);
  }

  private groundAt(x: number, z: number): number {
    const h = this.terrain.heightAt(x, z);
    return h < -100 ? GROUND_Y : h;
  }

  public build(): void {
    this.buildTreeVariants();
    this.buildPolesAndCables();
    this.buildSigns();
    this.buildTrees();
    this.buildGrassAndStones();
    this.buildFences();
    this.buildBoot();
    this.buildHuts();
    this.buildPuddles();
    this.buildFootprints();
    this.buildSilhouettes();
    this.buildLamp();
    this.buildBarrier();
  }

  // --- Poles & cables ------------------------------------------------------

  private buildPolesAndCables(): void {
    const poles = new ThinBatch(MeshBuilder.CreateCylinder('poleBase', { height: 1, diameter: 1, tessellation: 7 }, this.scene));
    poles.mesh.material = this.mats.timber;
    const arms = new ThinBatch(MeshBuilder.CreateBox('armBase', { size: 1 }, this.scene));
    arms.mesh.material = this.mats.timber;
    const insul = new ThinBatch(MeshBuilder.CreateBox('insulatorBase', { size: 1 }, this.scene), false);
    insul.mesh.material = this.mats.metalDark;

    const list = polePositions();
    const tops: { l: Vector3; r: Vector3; z: number; x: number }[] = [];
    for (const p of list) {
      const tone = 0.55 + this.rnd() * 0.25;
      const ground = this.groundAt(p.x, p.z);
      poles.add(p.x, ground + POLE_HEIGHT / 2 - 0.3, p.z, this.rnd() * 6.28, 0, p.lean, 0.2, POLE_HEIGHT, 0.2, tone, tone * 0.97, tone * 0.95);
      const topY = ground + POLE_HEIGHT - 0.6;
      const topX = p.x + Math.sin(-p.lean) * (POLE_HEIGHT - 0.6);
      arms.add(topX, topY, p.z, 0, 0, p.lean * 0.5, 1.5, 0.09, 0.1, tone, tone, tone);
      const l = new Vector3(topX - 0.62, topY + 0.1, p.z), r = new Vector3(topX + 0.62, topY + 0.1, p.z);
      insul.add(l.x, l.y - 0.04, l.z, 0, 0, 0, 0.05, 0.1, 0.05);
      insul.add(r.x, r.y - 0.04, r.z, 0, 0, 0, 0.05, 0.1, 0.05);
      tops.push({ l, r, z: p.z, x: p.x });
      if (Math.abs(p.x) < 3.6) this.grid.addCircle(p.x, p.z, 0.2);
    }
    for (const b of [poles, arms, insul]) {
      const m = b.commit();
      this.meshes.push(m);
    }
    this.shadowCasters.push(poles.mesh, arms.mesh);

    let groundedIdx = 0;
    tops.forEach((t, i) => {
      if (Math.abs(t.z - GROUNDED_CABLE_POLE_Z) < Math.abs(tops[groundedIdx].z - GROUNDED_CABLE_POLE_Z)) groundedIdx = i;
    });
    for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i], b = tops[i + 1];
      const crossesGap = a.z < GAP_NEAR_Z && b.z > GAP_FAR_Z;
      if (crossesGap) {
        // The near side's last wires keep going over the gap and end in the air
        this.cables.addSpan(a.l, new Vector3(-1.4, a.l.y + 1.2, GAP_NEAR_Z + 12.5), 0.9);
        this.cables.addSpan(a.r, new Vector3(-0.6, a.r.y + 2.0, GAP_NEAR_Z + 10.5), 0.7);
        continue;
      }
      const sag = 0.45 + this.rnd() * 0.35;
      if (i === groundedIdx) {
        // This pole's wire does not reach the next pole. It goes into the earth.
        this.cables.addSpan(a.r, new Vector3(a.x + 1.0, GROUND_Y - 0.4, a.z + 4.6), 0.25, true);
        this.cables.addSpan(a.l, b.l, sag);
        continue;
      }
      this.cables.addSpan(a.l, b.l, sag);
      this.cables.addSpan(a.r, b.r, sag + 0.08);
    }
    this.cables.build();
  }

  // --- Signs ---------------------------------------------------------------

  private buildSigns(): void {
    for (const s of SIGNS) {
      const g = this.groundAt(s.x, s.z);
      const post = MeshBuilder.CreateBox('signPost', { width: 0.08, height: 2.1, depth: 0.08 }, this.scene);
      post.position.set(s.x, g + 1.0, s.z);
      post.rotation.z = (this.rnd() - 0.5) * 0.06;
      post.material = this.mats.metalDark;
      const back = MeshBuilder.CreateBox('signBack', { width: 0.82, height: 0.6, depth: 0.03 }, this.scene);
      back.material = this.mats.metalDark;
      const face = MeshBuilder.CreatePlane('signFace', { width: 0.8, height: 0.58 }, this.scene);
      face.material = this.mats.signPlate;
      // Face normal points along (sin yaw, cos yaw); a plane's front faces -Z
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      back.position.set(s.x, g + 1.85, s.z);
      back.rotation.y = s.yaw;
      face.position.set(s.x + fx * 0.02, g + 1.85, s.z + fz * 0.02);
      face.rotation.y = s.yaw + Math.PI;
      this.meshes.push(post, back, face);
      this.shadowCasters.push(post, back);
      this.grid.addCircle(s.x, s.z, 0.12);
    }
  }

  // --- Trees ---------------------------------------------------------------

  private buildTreeVariants(): void {
    for (let v = 0; v < 3; v++) {
      const rnd = mulberry32(900 + v * 77);
      const boxes: Mesh[] = [];
      const branch = (base: Vector3, dir: Vector3, len: number, thick: number, depth: number) => {
        const end = base.add(dir.scale(len));
        const b = MeshBuilder.CreateBox('br', { width: thick, depth: thick * 0.85, height: len }, this.scene);
        b.position = base.add(end).scale(0.5);
        const axis = Vector3.Cross(UP, dir);
        const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(UP, dir))));
        b.rotationQuaternion = axis.lengthSquared() > 1e-6 ? Quaternion.RotationAxis(axis.normalize(), angle) : Quaternion.Identity();
        boxes.push(b);
        if (depth >= 3 || len < 0.35) return;
        const count = depth === 0 ? 3 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2.4);
        for (let i = 0; i < count; i++) {
          const t = 0.4 + rnd() * 0.55;
          const start = base.add(dir.scale(len * t));
          const yaw = rnd() * Math.PI * 2;
          const spread = 0.45 + rnd() * 0.55;
          const nd = new Vector3(
            dir.x + Math.cos(yaw) * spread, dir.y * (0.55 + rnd() * 0.3), dir.z + Math.sin(yaw) * spread
          ).normalize();
          branch(start, nd, len * (0.42 + rnd() * 0.25), Math.max(0.025, thick * 0.55), depth + 1);
        }
      };
      const lean = new Vector3((rnd() - 0.5) * 0.18, 1, (rnd() - 0.5) * 0.18).normalize();
      branch(Vector3.Zero(), lean, 3.6 + rnd() * 1.6, 0.26, 0);
      const merged = Mesh.MergeMeshes(boxes, true, true);
      if (merged) {
        merged.material = this.mats.bark;
        merged.setEnabled(false);
        this.treeVariants.push(merged);
      }
    }
  }

  private buildTrees(): void {
    const batches = this.treeVariants.map((v, i) => {
      const m = v.clone('trees' + i, null)!;
      m.setEnabled(true);
      return new ThinBatch(m);
    });
    const place = (x: number, z: number, scale: number, variant: number, ground?: number) => {
      const g = ground ?? this.groundAt(x, z);
      const tone = 0.7 + this.rnd() * 0.35;
      batches[variant % batches.length].add(x, g - 0.1, z, this.rnd() * 6.28, 0, 0, scale, scale * (0.9 + this.rnd() * 0.3), scale, tone, tone, tone);
    };
    for (const t of TREES) if (!cameraSide(t.x, t.z)) place(t.x, t.z, t.scale, t.variant);

    // Scattered woodland, thickest along the early railway, sparse beyond the gap
    for (let i = 0; i < 420; i++) {
      const x = -46 + this.rnd() * 75, z = -22 + this.rnd() * 330;
      if (inGap(z) || z > WORLD_END_Z) continue;
      const d = walkDistance(x, z);
      if (d < 3.2) continue;
      if (cameraSide(x, z)) continue;
      const density = z < 70 ? 0.55 : z < GAP_NEAR_Z ? 0.3 : 0.12;
      if (this.rnd() > density) continue;
      if (HUTS.some(h => Math.hypot(h.x - x, h.z - z) < 4)) continue;
      place(x, z, 0.8 + this.rnd() * 0.7, Math.floor(this.rnd() * 3));
    }
    // Distant tree lines rising out of the fog beyond the playable land
    for (let i = 0; i < 160; i++) {
      const side = this.rnd() < 0.5 ? -1 : 1;
      const x = side < 0 ? -(52 + this.rnd() * 22) : 34 + this.rnd() * 22, z = -30 + this.rnd() * 360;
      place(x, z, 2.0 + this.rnd() * 1.6, Math.floor(this.rnd() * 3), -6);
    }
    for (const b of batches) {
      const m = b.commit();
      m.receiveShadows = true;
      this.meshes.push(m);
      this.shadowCasters.push(m);
    }
  }

  // --- Ground detail -------------------------------------------------------

  private buildGrassAndStones(): void {
    const blades: Mesh[] = [];
    const br = mulberry32(55);
    for (let i = 0; i < 11; i++) {
      const h = 0.22 + br() * 0.34;
      const b = MeshBuilder.CreateBox('blade', { width: 0.028, height: h, depth: 0.008 }, this.scene);
      const a = br() * Math.PI * 2, r = br() * 0.09;
      const tilt = 0.15 + br() * 0.45;
      b.position.set(Math.cos(a) * r + Math.cos(a) * Math.sin(tilt) * h * 0.5, Math.cos(tilt) * h * 0.5, Math.sin(a) * r + Math.sin(a) * Math.sin(tilt) * h * 0.5);
      b.rotation.set(Math.sin(a) * tilt, a, -Math.cos(a) * tilt);
      blades.push(b);
    }
    const clump = Mesh.MergeMeshes(blades, true, true)!;
    clump.material = this.mats.grass;
    const grass = new ThinBatch(clump);
    const stones = new ThinBatch(MeshBuilder.CreateBox('stoneBase', { size: 1 }, this.scene));
    stones.mesh.material = this.mats.stone;

    for (let i = 0; i < 16000; i++) {
      const x = -46 + this.rnd() * 74, z = -22 + this.rnd() * 330;
      const h = this.terrain.heightAt(x, z);
      if (h < -100) continue;
      const d = walkDistance(x, z);
      if (d < -0.4) continue;                         // keep the walking line clear
      if (d < 0.2 && this.rnd() < 0.7) continue;
      if (this.rnd() > Math.exp(-Math.max(0, d) / 7)) continue;   // densest where the camera looks
      const far = z > GAP_FAR_Z;
      if (far && this.rnd() < 0.55) continue;         // the far side is barer
      const s = 0.6 + this.rnd() * 0.8;
      const straw = this.rnd();
      const r = far ? 0.3 : 0.22 + straw * 0.1, g = far ? 0.31 : 0.2 + straw * 0.07, b = far ? 0.33 : 0.13 + straw * 0.03;
      grass.add(x, h, z, this.rnd() * 6.28, (this.rnd() - 0.5) * 0.25, (this.rnd() - 0.5) * 0.25, s, s * (0.7 + this.rnd() * 0.6), s, r, g, b);
    }
    for (let i = 0; i < 520; i++) {
      const x = -46 + this.rnd() * 74, z = -22 + this.rnd() * 330;
      const h = this.terrain.heightAt(x, z);
      if (h < -100 || walkDistance(x, z) < 0.3) continue;
      const s = 0.12 + this.rnd() ** 2 * 0.55;
      const t = 0.75 + this.rnd() * 0.3;
      stones.add(x, h + s * 0.2, z, this.rnd() * 6.28, (this.rnd() - 0.5) * 0.5, (this.rnd() - 0.5) * 0.5,
        s * (1 + this.rnd()), s * 0.6, s * (0.8 + this.rnd() * 0.6), t, t, t);
    }
    this.meshes.push(grass.commit(), stones.commit());
  }

  private buildFences(): void {
    const posts = new ThinBatch(MeshBuilder.CreateBox('fencePost', { size: 1 }, this.scene));
    posts.mesh.material = this.mats.timber;
    for (const run of FENCE_RUNS) {
      const len = Math.hypot(run.to.x - run.from.x, run.to.z - run.from.z);
      const n = Math.floor(len / 2);
      const yaw = Math.atan2(run.to.x - run.from.x, run.to.z - run.from.z);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = run.from.x + (run.to.x - run.from.x) * t, z = run.from.z + (run.to.z - run.from.z) * t;
        const g = this.groundAt(x, z);
        const lean = (this.rnd() - 0.5) * 0.16;
        const tone = 0.62 + this.rnd() * 0.2;
        posts.add(x, g + 0.55, z, yaw, lean, (this.rnd() - 0.5) * 0.1, 0.1, 1.1, 0.1, tone, tone, tone * 1.02);
        if (i < n && !run.broken.includes(i)) {
          const mx = x + (run.to.x - run.from.x) / n * 0.5, mz = z + (run.to.z - run.from.z) / n * 0.5;
          for (const hy of [0.45, 0.85]) {
            posts.add(mx, g + hy, mz, yaw, 0, (this.rnd() - 0.5) * 0.05, 0.05, 0.09, len / n, tone, tone, tone);
          }
        } else if (i < n) {
          // One rail of the broken bay has dropped to the ground
          const mx = x + (run.to.x - run.from.x) / n * 0.5, mz = z + (run.to.z - run.from.z) / n * 0.5;
          posts.add(mx, g + 0.08, mz, yaw + 0.3, 0, 0.2, 0.05, 0.09, len / n * 0.9, tone * 0.8, tone * 0.8, tone * 0.8);
        }
      }
    }
    this.meshes.push(posts.commit());
    this.shadowCasters.push(posts.mesh);
  }

  private buildBoot(): void {
    const g = this.groundAt(BOOT.x, BOOT.z);
    const post = MeshBuilder.CreateBox('bootPost', { width: 0.12, height: 1.15, depth: 0.12 }, this.scene);
    post.position.set(BOOT.x, g + 0.575, BOOT.z);
    post.material = this.mats.timber;
    const parts = [
      MeshBuilder.CreateBox('sole', { width: 0.11, height: 0.035, depth: 0.27 }, this.scene),
      MeshBuilder.CreateBox('upper', { width: 0.1, height: 0.08, depth: 0.2 }, this.scene),
      MeshBuilder.CreateBox('shaft', { width: 0.1, height: 0.16, depth: 0.1 }, this.scene)
    ];
    parts[0].position.set(0, 0.018, 0.02);
    parts[1].position.set(0, 0.07, 0.04);
    parts[2].position.set(0, 0.15, -0.05);
    const boot = Mesh.MergeMeshes(parts, true, true)!;
    boot.material = this.mats.shoes;
    boot.position.set(BOOT.x, g + 1.15, BOOT.z);
    boot.rotation.y = 0.6;
    this.meshes.push(post, boot);
    this.shadowCasters.push(post, boot);
  }

  // --- Huts ----------------------------------------------------------------

  private buildHuts(): void {
    for (const def of HUTS) {
      const W = 3.2, D = 2.6, H = 2.5, T = 0.15;
      const parts: Mesh[] = [];
      const wall = (x: number, y: number, z: number, w: number, h: number, d: number) => {
        const b = MeshBuilder.CreateBox('hutWall', { width: w, height: h, depth: d }, this.scene);
        b.position.set(x, y, z);
        parts.push(b);
      };
      wall(0, H / 2, -D / 2, W, H, T);                       // back
      wall(-W / 2, H / 2, 0, T, H, D);                        // sides
      wall(W / 2, H / 2, 0, T, H, D);
      const fz = D / 2;                                       // front, door and window openings
      wall(-1.45, H / 2, fz, 0.3, H, T);
      wall(-0.85, 2.25, fz, 0.9, 0.5, T);
      wall(-0.02, H / 2, fz, 0.76, H, T);
      wall(0.75, 0.55, fz, 0.8, 1.1, T);
      wall(0.75, 2.1, fz, 0.8, 0.8, T);
      wall(1.38, H / 2, fz, 0.45, H, T);
      const roof = MeshBuilder.CreateBox('hutRoof', { width: W + 0.5, height: 0.12, depth: D + 0.5 }, this.scene);
      roof.position.set(0, H + 0.05, 0.05);
      roof.rotation.x = 0.07;
      parts.push(roof);
      const hut = Mesh.MergeMeshes(parts, true, true)!;
      hut.material = this.mats.concrete;
      const g = this.groundAt(def.x, def.z);
      hut.position.set(def.x, g - 0.02, def.z);
      hut.rotation.y = def.yaw;
      hut.receiveShadows = true;
      this.huts.push(hut);
      this.meshes.push(hut);
      this.shadowCasters.push(hut);

      // Window: broken from the inside (shards on the outer sill) or, on the far side, whole
      const glass: Mesh[] = [];
      if (def.windowBroken) {
        for (let i = 0; i < 4; i++) {
          const s = MeshBuilder.CreateBox('shard', { width: 0.12 + i * 0.03, height: 0.01, depth: 0.08 }, this.scene);
          s.position.set(0.55 + i * 0.14, 1.12, fz + 0.12 + (i % 2) * 0.05);
          s.rotation.y = i * 0.9;
          glass.push(s);
        }
      } else {
        const pane = MeshBuilder.CreateBox('pane', { width: 0.8, height: 0.6, depth: 0.02 }, this.scene);
        pane.position.set(0.75, 1.4, fz);
        glass.push(pane);
      }
      const gm = Mesh.MergeMeshes(glass, true, true)!;
      gm.material = this.mats.puddle;
      gm.parent = hut;
      this.meshes.push(gm);
    }
  }

  private buildPuddles(): void {
    for (const p of PUDDLES) {
      const g = this.groundAt(p.x, p.z);
      const d = MeshBuilder.CreateDisc('puddle', { radius: 0.9, tessellation: 18 }, this.scene);
      d.rotation.x = Math.PI / 2;
      d.position.set(p.x, g + 0.012, p.z);
      d.scaling.set(1 + this.rnd() * 0.6, 0.6 + this.rnd() * 0.5, 1);
      d.rotation.y = this.rnd() * 3;
      d.material = this.mats.puddle;
      d.isPickable = false;
      this.meshes.push(d);
    }
  }

  private buildFootprints(): void {
    const plane = MeshBuilder.CreatePlane('footprintBase', { width: 0.13, height: 0.28 }, this.scene);
    plane.material = this.mats.footprint;
    const prints = new ThinBatch(plane);
    const trail = (z0: number, z1: number, x: number, towardPlusZ: boolean) => {
      const dir = towardPlusZ ? 1 : -1;
      let i = 0;
      for (let z = z0; dir > 0 ? z < z1 : z > z1; z += 0.68 * dir, i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const fade = towardPlusZ ? 0.55 + 0.45 * smoothstep(z0, z1, z) : 1;
        prints.add(x + side * 0.11, this.groundAt(x, z) + 0.004, z, towardPlusZ ? 0 : Math.PI, Math.PI / 2, 0,
          1, 1, 1, 1, 1, 1, fade);
      }
    };
    trail(FOOTPRINTS_TO_EDGE.z0, FOOTPRINTS_TO_EDGE.z1, FOOTPRINTS_TO_EDGE.x, true);
    trail(FOOTPRINTS_RETURNING.z0, FOOTPRINTS_RETURNING.z1, FOOTPRINTS_RETURNING.x, false);
    this.meshes.push(prints.commit());
  }

  // --- Distant world -------------------------------------------------------

  private buildSilhouettes(): void {
    const parts: Mesh[] = [];
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, ry = 0) => {
      const b = MeshBuilder.CreateBox('sil', { width: w, height: h, depth: d }, this.scene);
      b.position.set(x, y, z); b.rotation.y = ry;
      parts.push(b);
    };
    const cyl = (x: number, y: number, z: number, h: number, dia: number) => {
      const c = MeshBuilder.CreateCylinder('silC', { height: h, diameter: dia, tessellation: 10 }, this.scene);
      c.position.set(x, y, z);
      parts.push(c);
    };
    // Water tower on legs, left of the railway
    for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) box(-46 + lx, 2, 142 + lz, 0.4, 16, 0.4);
    cyl(-46, 12, 142, 4.5, 6);
    // Two chimneys and a long shed to the right
    cyl(54, 6, 88, 30, 2.2);
    cyl(60, 4, 103, 26, 1.8);
    box(64, -1, 96, 10, 10, 28, 0.2);
    // A signal gantry over the line far beyond its end
    box(-3.2, 2, WORLD_END_Z + 40, 0.4, 16, 0.4);
    box(3.2, 2, WORLD_END_Z + 40, 0.4, 16, 0.4);
    box(0, 9.6, WORLD_END_Z + 40, 7.2, 0.5, 0.5);
    // The station: something larger than the line could ever have needed
    box(-14, 4, WORLD_END_Z + 78, 22, 26, 14);
    box(12, 1, WORLD_END_Z + 70, 16, 18, 10, 0.15);
    box(0, 16, WORLD_END_Z + 92, 10, 22, 8);
    const merged = Mesh.MergeMeshes(parts, true, true)!;
    merged.material = this.mats.silhouette;
    merged.isPickable = false;
    this.meshes.push(merged);

    // Poles that continue past the end of the world, standing on nothing
    const poles = new ThinBatch(MeshBuilder.CreateCylinder('farPole', { height: 1, diameter: 1, tessellation: 6 }, this.scene));
    poles.mesh.material = this.mats.timber;
    for (let z = WORLD_END_Z + 6; z < WORLD_END_Z + 60; z += 12) poles.add(3, -2 + POLE_HEIGHT / 2, z, 0, 0, 0, 0.2, POLE_HEIGHT + 5, 0.2, 0.5, 0.5, 0.5);
    this.meshes.push(poles.commit());
  }

  private buildLamp(): void {
    const g = this.groundAt(LAMP.x, LAMP.z);
    const post = MeshBuilder.CreateBox('lampPost', { width: 0.12, height: 3.0, depth: 0.12 }, this.scene);
    post.position.set(LAMP.x, g + 1.5, LAMP.z);
    post.material = this.mats.metalDark;
    const head = MeshBuilder.CreateBox('lampHead', { width: 0.34, height: 0.42, depth: 0.34 }, this.scene);
    head.position.set(LAMP.x, g + 3.1, LAMP.z);
    head.material = this.mats.metalDark;
    const glass = MeshBuilder.CreateBox('lampGlass', { width: 0.36, height: 0.24, depth: 0.36 }, this.scene);
    glass.position.set(LAMP.x, g + 3.05, LAMP.z);
    glass.material = this.mats.lampGlass;
    this.lampLight = new PointLight('lampLight', new Vector3(LAMP.x, g + 3.0, LAMP.z), this.scene);
    this.lampLight.diffuse = new Color3(1.0, 0.62, 0.25);
    this.lampLight.specular = new Color3(0.4, 0.25, 0.1);
    this.lampLight.range = 13;
    this.lampLight.intensity = 0;       // brightened by the chapter as the protagonist nears the end
    this.meshes.push(post, head, glass);
    this.shadowCasters.push(post, head);
    this.grid.addCircle(LAMP.x, LAMP.z, 0.18);
  }

  // The first phase obstacle: a fallen tree and a twisted section of fence
  private buildBarrier(): void {
    const zc = (BARRIER.z0 + BARRIER.z1) / 2;
    const tree = this.treeVariants[1].clone('barrierTree', null)!;
    tree.setEnabled(true);
    tree.position.set(-5.5, BED_Y + 0.25, zc);
    tree.rotation.set(0.15, 0.25, -Math.PI / 2 + 0.08);
    tree.scaling.setAll(1.35);
    const fence: Mesh[] = [];
    for (let i = 0; i < 7; i++) {
      const b = MeshBuilder.CreateBox('twisted', { width: 0.06, height: 0.09, depth: 2.2 }, this.scene);
      b.position.set(-3 + i, 0.55 + (i % 3) * 0.32, zc + (this.rnd() - 0.5) * 0.8);
      b.rotation.set((this.rnd() - 0.5) * 0.8, Math.PI / 2 + (this.rnd() - 0.5) * 0.9, (this.rnd() - 0.5) * 0.9);
      fence.push(b);
    }
    const fm = Mesh.MergeMeshes(fence, true, true)!;
    fm.material = this.mats.timber;
    this.barrierMeshes.push(tree, fm);
    this.meshes.push(tree, fm);
    this.shadowCasters.push(tree, fm);
  }
}
