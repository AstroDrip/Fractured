import { Scene, Mesh, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
import { Materials } from './Materials';
import { ThinBatch } from './ThinBatch';
import { WalkGrid } from './WalkGrid';
import { YARD, GROUND_Y } from './layout';
import type { ThrowSpec } from '../core/FlameTiers';
import { mulberry32 } from '../core/rng';

const ASH_CLEAR_TIME = 1.4;   // seconds for the heap to slump away once burned

/**
 * The signal yard: a concrete platform with chamfered edges, a signal box with one
 * wall broken open, a lever frame inside, a steel gantry whose beam passes through the
 * roof at the wrong angle, and an ash heap choking the doorway. A fireball or full
 * mass landing on the ash clears it (the walk grid loses the heap's obstacle); a flick
 * only stirs it. Presentation and the one interaction; collision lives in WalkGrid.
 */
export class Yard {
  public meshes: Mesh[] = [];
  public shadowCasters: Mesh[] = [];
  private ash!: Mesh;
  private clearing = -1;          // seconds into clearing; -1 = not started
  public cleared = false;
  public onCleared?: () => void;
  private lastLever!: Mesh;
  private pullT = -1;             // seconds into the pull; -1 = still forward
  public get pulled(): boolean { return this.pullT >= 0; }
  /** The last lever goes back, like the others. */
  public pull(): void { if (this.pullT < 0) this.pullT = 0; }
  private rnd = mulberry32(1717);

  constructor(private scene: Scene, private mats: Materials, private grid: WalkGrid) {}

  public build(): void {
    const p = YARD.platform, b = YARD.box, top = GROUND_Y + p.h;
    const parts: Mesh[] = [];
    const box = (w: number, h: number, d: number, m: StandardMaterial, x: number, y: number, z: number, ry = 0, rz = 0) => {
      const o = MeshBuilder.CreateBox('yardP', { width: w, height: h, depth: d }, this.scene);
      o.material = m; o.position.set(x, y, z); o.rotation.y = ry; o.rotation.z = rz; parts.push(o); return o;
    };
    // Platform: slab, a coping of edge stones along the line, ramps at both ends
    const len = p.z1 - p.z0 - p.ramp * 2;
    box(p.x1 - p.x0, p.h, len, this.mats.concrete, (p.x0 + p.x1) / 2, GROUND_Y + p.h / 2, (p.z0 + p.z1) / 2);
    for (const [z, s] of [[p.z0 + p.ramp / 2, 1], [p.z1 - p.ramp / 2, -1]] as [number, number][]) {
      const r = box(p.x1 - p.x0, 0.06, p.ramp + 0.1, this.mats.concrete, (p.x0 + p.x1) / 2, GROUND_Y + p.h / 2, z);
      r.rotation.x = s * Math.atan2(p.h, p.ramp);
    }
    const coping = new ThinBatch(MeshBuilder.CreateBox('coping', { width: 0.45, height: 0.12, depth: 0.95 }, this.scene));
    coping.mesh.material = this.mats.stone;
    for (let z = p.z0 + p.ramp + 0.5; z < p.z1 - p.ramp; z += 1.0) {
      const t = 0.75 + this.rnd() * 0.2;
      // A few stones have lifted or slid toward the line
      const lift = this.rnd() < 0.15 ? 0.05 + this.rnd() * 0.06 : 0;
      coping.add(p.x0 + 0.22, top + 0.04 + lift, z, (this.rnd() - 0.5) * 0.05, (this.rnd() - 0.5) * lift * 2, 0, 1, 1, 1, t, t, t);
    }
    this.meshes.push(coping.commit()); this.shadowCasters.push(coping.mesh);

    // The signal box: walls with a broken south-west corner, tall window band, slab roof
    const wall = this.mats.concrete, H = b.h, w = b.wall;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    box(b.x1 - b.x0, H, w, wall, cx, top + H / 2, b.z1 - w / 2);                          // north
    box(w, H, b.z1 - b.z0, wall, b.x1 - w / 2, top + H / 2, cz);                          // east
    box(b.x1 - b.x0 - 1.4, H * 0.55, w, wall, cx + 0.7, top + H * 0.275, b.z0 + w / 2);   // south, broken low
    box(w, H, YARD.door.z0 - b.z0, wall, b.x0 + w / 2, top + H / 2, (b.z0 + YARD.door.z0) / 2);
    box(w, H, b.z1 - YARD.door.z1, wall, b.x0 + w / 2, top + H / 2, (YARD.door.z1 + b.z1) / 2);
    box(w, 0.7, YARD.door.z1 - YARD.door.z0, wall, b.x0 + w / 2, top + H - 0.35, (YARD.door.z0 + YARD.door.z1) / 2); // lintel
    box(b.x1 - b.x0 + 0.5, 0.22, b.z1 - b.z0 + 0.5, this.mats.stone, cx, top + H + 0.11, cz, 0, 0.04);     // roof slab, settled
    // Window band (dark) on the line side, with mullions
    for (let z = b.z0 + 0.8; z < b.z1 - 0.6; z += 0.9) {
      if (z > YARD.door.z0 - 0.3 && z < YARD.door.z1 + 0.3) continue;
      box(0.06, 0.9, 0.7, this.mats.hoodInner, b.x0 - 0.01, top + 2.3, z);
    }
    // Lever frame: a row of levers, all pulled back but one
    for (let i = 0; i < 9; i++) {
      const fwd = i === 6;
      const lv = box(0.05, 1.1, 0.05, this.mats.rust, YARD.levers.x, top + 0.6, YARD.levers.z - 1.4 + i * 0.35, 0, fwd ? -0.45 : 0.35);
      lv.rotation.z = fwd ? -0.45 : 0.35;
      if (fwd) {
        // The last one forward stays its own mesh: it can still be pulled (pivot at its foot)
        parts.pop();
        lv.setPivotPoint(new Vector3(0, -0.55, 0));
        lv.isPickable = false;
        this.lastLever = lv; this.meshes.push(lv);
      }
    }
    box(0.5, 0.35, 3.4, this.mats.metalDark, YARD.levers.x + 0.15, top + 0.18, YARD.levers.z);
    // Rubble from the broken corner
    for (let i = 0; i < 9; i++) {
      box(0.25 + this.rnd() * 0.4, 0.15 + this.rnd() * 0.25, 0.25 + this.rnd() * 0.4, wall,
        b.x0 + 0.6 + this.rnd() * 1.6, top + 0.1, b.z0 - 0.4 - this.rnd() * 0.8, this.rnd() * 3);
    }
    // The gantry: two steel legs, one beam over the line that runs into the box's roof
    const g = YARD.gantry, rust = this.mats.rust;
    box(0.3, g.h, 0.3, rust, g.x0, GROUND_Y + g.h / 2, g.z);
    box(0.3, g.h * 0.75, 0.3, rust, g.x1, GROUND_Y + g.h * 0.375, g.z + 1.2);
    const beam = box(g.x1 - g.x0 + 1, 0.35, 0.3, rust, (g.x0 + g.x1) / 2, GROUND_Y + g.h - 0.6, g.z - 1.4);
    beam.rotation.y = -0.32; beam.rotation.z = -0.09;     // through the roof, at an angle nothing was built at
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    merged.name = 'signalYard'; merged.isPickable = false;
    this.meshes.push(merged); this.shadowCasters.push(merged);

    // The ash heap in the doorway
    const a = YARD.ash;
    this.ash = MeshBuilder.CreateCylinder('ashHeap', { height: a.h, diameterTop: 0.25, diameterBottom: 1.7, tessellation: 9 }, this.scene);
    this.ash.material = this.mats.ground;
    this.ash.position.set((a.x0 + a.x1) / 2, top + a.h / 2 - 0.05, (a.z0 + a.z1) / 2);
    this.ash.scaling.set(0.8, 1, 1.15);
    this.ash.isPickable = false;
    this.meshes.push(this.ash); this.shadowCasters.push(this.ash);
  }

  /** A thrown flame landed at `at`. Clears the ash if it is strong enough and close enough. */
  public onImpact(at: Vector3, spec: ThrowSpec): boolean {
    if (this.cleared || this.clearing >= 0 || spec.tier === 'flick') return false;
    const a = YARD.ash;
    const dx = Math.max(a.x0 - at.x, 0, at.x - a.x1), dz = Math.max(a.z0 - at.z, 0, at.z - a.z1);
    if (Math.hypot(dx, dz) > spec.reach * 0.35) return false;
    this.clearing = 0;
    if (this.grid.ashHeap) { this.grid.removeObstacle(this.grid.ashHeap); this.grid.ashHeap = null; }
    return true;
  }

  public update(dt: number): void {
    if (this.pullT >= 0 && this.pullT < 1) {
      this.pullT = Math.min(1, this.pullT + dt / 0.7);
      const e = this.pullT * this.pullT * (3 - 2 * this.pullT);
      this.lastLever.rotation.z = -0.45 + 0.8 * e;
    }
    if (this.clearing < 0 || this.cleared) return;
    this.clearing += dt;
    const t = Math.min(1, this.clearing / ASH_CLEAR_TIME);
    this.ash.scaling.y = Math.max(0.05, 1 - t * 0.95);
    this.ash.scaling.x = 0.8 + t * 0.9; this.ash.scaling.z = 1.15 + t * 0.6;   // slumps and spreads
    this.ash.position.y = GROUND_Y + YARD.platform.h + (YARD.ash.h / 2) * this.ash.scaling.y - 0.05;
    if (t >= 1) { this.cleared = true; if (this.onCleared) this.onCleared(); }
  }

  public reset(): void {
    // The heap returns for a new run, and the lever goes forward again
    this.clearing = -1; this.cleared = false;
    this.pullT = -1; this.lastLever.rotation.z = -0.45;
    this.ash.scaling.set(0.8, 1, 1.15);
    this.ash.position.y = GROUND_Y + YARD.platform.h + YARD.ash.h / 2 - 0.05;
    if (!this.grid.ashHeap) {
      const a = YARD.ash;
      this.grid.ashHeap = { kind: 'box', x: 0, z: 0, r: 0, x0: a.x0, z0: a.z0, x1: a.x1, z1: a.z1, realities: 7 };
      this.grid.obstacles.push(this.grid.ashHeap);
    }
  }
}
