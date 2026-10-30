import { Scene, Mesh, MeshBuilder, Vector3, Color3, LinesMesh } from '@babylonjs/core';
import { ParticleField, FieldContext } from '../graphics/ParticleField';
import { FracturedHumanoid } from '../entities/FracturedHumanoid';
import { PhaseGeometry } from './PhaseGeometry';
import { FirePulse } from '../graphics/PalmFire';
import { mulberry32, smoothstep } from '../core/rng';
import { R_VOID } from '../core/Reality';
import {
  CROSSING, BARRIER, BARRIER_GHOST_TREE, GAP_NEAR_Z, GAP_FAR_Z, TRACK_END_Z, FIGURE, BED_Y,
  BRIDGE_Y, RISING_RAIL, LAMP, POIS, GROUND_Y
} from './layout';

export interface AnomalyReport {
  resonance: number;        // 0..1 how strongly the nearest anomaly answers the fire
  focus: Vector3 | null;    // where the protagonist and camera may glance
}

/**
 * The world's small set of recurring impossibilities, each with a bounded area,
 * a trigger and a relationship to the fire or phase:
 *  - suspended matter that hovers in the gap and, while phased, lines the hidden route
 *  - motes that drift in the fog and, past the gap, flow back toward it
 *  - roots that grow upward on the far side, further while phased
 *  - the fallen tree that destabilises near the fire
 *  - a figure across the gap that is not there when approached
 */
export class Anomalies {
  public suspended: ParticleField;
  public motes: ParticleField;
  public figure: FracturedHumanoid;
  private homes: Float32Array;
  private aligns: Float32Array;
  private roots: LinesMesh;
  private rootLines: Vector3[][] = [];
  private rootDefs: { x: number; z: number; y0: number; h: number; lean: number; seed: number }[] = [];
  private rootGrowth = 0.3;
  private points: Vector3[];
  private moteTarget = 90;
  private barrierBase = 1;
  private impulse = 0;
  private time = 0;
  private phaseSolid = 0;
  private pulsePos = new Vector3();
  private pulseRadius = 0;
  public figureSeen = false;
  public figureGone = false;
  private readonly report: AnomalyReport = { resonance: 0, focus: null };

  constructor(scene: Scene, private phaseGeom: PhaseGeometry, private barrier: Mesh[]) {
    const rnd = mulberry32(2024);
    const cap = 70;
    this.homes = new Float32Array(cap * 3);
    this.aligns = new Float32Array(cap * 3);
    this.suspended = new ParticleField(scene, {
      name: 'suspendedMatter', capacity: cap, blend: 'alpha', shape: 'chip', life: [0, 0], size: [0.035, 0.12],
      colorA: [0.1, 0.1, 0.11, 0.85], colorB: [0.1, 0.1, 0.11, 0.85], drag: 2.0, homeSpring: 1.5,
      noise: { amp: 0.12, freq: 0.8, speed: 0.4 }, fire: { radius: 3.2, strength: -3 }, spin: 0.6, seed: 61,
      behavior: (f, i) => this.suspendedStep(f, i)
    });
    const phasedSegs = CROSSING.filter(s => s.realities === R_VOID);
    for (let i = 0; i < cap; i++) {
      let hx: number, hy: number, hz: number, ax: number, ay: number, az: number;
      if (i < 48) {
        // In the gap: scattered in the air; while phased they line the hidden route's edges
        hx = (rnd() - 0.5) * 14; hy = -1 + rnd() * 5; hz = GAP_NEAR_Z + 1 + rnd() * (GAP_FAR_Z - GAP_NEAR_Z - 2);
        const seg = phasedSegs[i % phasedSegs.length];
        ax = (i % 4 < 2 ? -1 : 1) * (1.5 + rnd() * 0.25);
        ay = BRIDGE_Y + 0.1 + rnd() * 0.3;
        az = seg.z0 + 0.5 + rnd() * (seg.z1 - seg.z0 - 1);
      } else {
        // Around the fallen tree; while phased they stretch into the shape of the tree still standing
        const a = rnd() * Math.PI * 2, r = 1.4 + rnd() * 2.2;
        hx = Math.cos(a) * r; hy = 0.8 + rnd() * 2; hz = (BARRIER.z0 + BARRIER.z1) / 2 + Math.sin(a) * r;
        ax = BARRIER_GHOST_TREE.x + (rnd() - 0.5) * 0.5; ay = GROUND_Y + 0.3 + rnd() * 5; az = BARRIER_GHOST_TREE.z + (rnd() - 0.5) * 0.5;
      }
      this.homes.set([hx, hy, hz], i * 3);
      this.aligns.set([ax, ay, az], i * 3);
      this.suspended.spawn(hx, hy, hz);
    }

    this.motes = new ParticleField(scene, {
      name: 'motes', capacity: 140, blend: 'alpha', shape: 'flake', life: [6, 12], size: [0.012, 0.03],
      colorA: [0.6, 0.66, 0.72, 0.3], colorB: [0.6, 0.66, 0.72, 0.3], fadeIn: 0.2, fadeOut: 0.3,
      drag: 0.8, noise: { amp: 0.08, freq: 0.5, speed: 0.25 }, fire: { radius: 3, strength: 0.9 }, spin: 0.5, seed: 62,
      behavior: (f, i, c) => this.moteStep(f, i, c)
    });

    // Roots that grow upward: from the far cliff's lip out of the abyss, and along the far track
    for (let i = 0; i < 18; i++) {
      this.rootDefs.push({ x: (rnd() - 0.5) * 12, z: GAP_FAR_Z + 0.2 + rnd() * 0.4, y0: -4 + rnd() * 2, h: 4.5 + rnd() * 2, lean: (rnd() - 0.5), seed: rnd() * 10 });
    }
    for (let i = 0; i < 34; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      this.rootDefs.push({ x: side * (2.2 + rnd() * 5), z: GAP_FAR_Z + 4 + rnd() * (TRACK_END_Z - GAP_FAR_Z - 6), y0: GROUND_Y, h: 0.8 + rnd() * 1.6, lean: (rnd() - 0.5), seed: rnd() * 10 });
    }
    for (let i = 0; i < this.rootDefs.length; i++) {
      const pts: Vector3[] = [];
      for (let k = 0; k < 7; k++) pts.push(Vector3.Zero());
      this.rootLines.push(pts);
    }
    this.updateRoots();
    this.roots = MeshBuilder.CreateLineSystem('roots', { lines: this.rootLines, updatable: true }, scene);
    this.roots.color = new Color3(0.11, 0.095, 0.08);
    this.roots.isPickable = false;

    this.figure = new FracturedHumanoid(scene, new Vector3(FIGURE.x, BED_Y + 0.9, FIGURE.z));

    const cablePoi = POIS.find(p => p.id === 'cable')!;
    this.points = [
      new Vector3(0, 1.0, (BARRIER.z0 + BARRIER.z1) / 2),
      new Vector3(0, 0.8, GAP_NEAR_Z + 0.5),
      new Vector3(0, 0.8, (CROSSING[1].z0 + CROSSING[1].z1) / 2),
      new Vector3(cablePoi.x + 0.6, GROUND_Y, cablePoi.z),
      new Vector3(0.72, 1.2, RISING_RAIL.z0 + 2),
      new Vector3(LAMP.x, 3, LAMP.z)
    ];
  }

  private suspendedStep(f: ParticleField, i: number): void {
    const solid = this.phaseSolid;
    const o = i * 3;
    const wob = this.time * 0.45 + f.seed[i] * 20;
    f.hx[i] = this.homes[o] + (this.aligns[o] - this.homes[o]) * solid + Math.sin(wob) * 0.2 * (1 - solid * 0.7);
    f.hy[i] = this.homes[o + 1] + (this.aligns[o + 1] - this.homes[o + 1]) * solid + Math.sin(wob * 1.3) * 0.15;
    f.hz[i] = this.homes[o + 2] + (this.aligns[o + 2] - this.homes[o + 2]) * solid + Math.cos(wob) * 0.2 * (1 - solid * 0.7);
    if (this.impulse > 0) {
      const dx = f.px[i] - this.pulsePos.x, dz = f.pz[i] - this.pulsePos.z;
      const d = Math.hypot(dx, dz);
      if (d < this.pulseRadius && d > 0.01) {
        const k = this.impulse * (1 - d / this.pulseRadius) * 3;
        f.vx[i] += dx / d * k; f.vy[i] += k * 0.5; f.vz[i] += dz / d * k;
      }
    }
  }

  private moteStep(f: ParticleField, i: number, c: FieldContext): void {
    const z = f.pz[i];
    const solid = this.phaseSolid;
    // A hidden flow: past the gap the motes drift back toward it; over the gap they rise
    let flowZ = 0.05;
    if (z > GAP_FAR_Z) flowZ = -0.28 * smoothstep(GAP_FAR_Z, GAP_FAR_Z + 20, z);
    const overGap = z > GAP_NEAR_Z && z < GAP_FAR_Z;
    f.vz[i] += (flowZ * (1 - solid * 0.7) - f.vz[i] * 0.2) * c.dt;
    if (overGap) f.vy[i] += 0.05 * c.dt;
    f.alphaMul[i] = 0.7 + solid * 0.6;
    const dx = f.px[i] - c.player.x, dz = f.pz[i] - c.player.z;
    if (dx * dx + dz * dz > 22 * 22) f.age[i] = f.life[i]; // expire when left behind
  }

  private updateRoots(): void {
    const grow = this.rootGrowth;
    for (let r = 0; r < this.rootDefs.length; r++) {
      const d = this.rootDefs[r];
      const pts = this.rootLines[r];
      for (let k = 0; k < pts.length; k++) {
        const t = k / (pts.length - 1);
        const h = d.h * t * grow;
        const sway = Math.sin(this.time * 0.6 + d.seed + t * 3) * 0.05 * t;
        pts[k].set(d.x + d.lean * t * t * 0.9 + sway + Math.sin(t * 5 + d.seed) * 0.08,
          d.y0 + h, d.z + Math.cos(t * 4 + d.seed) * 0.1 * t);
      }
    }
  }

  public setQuality(q: number): void {
    this.moteTarget = Math.floor(50 + q * 60);
    this.motes.setQuality(0.4 + q * 0.6);
  }

  public onPulse(p: FirePulse): boolean {
    this.pulsePos.copyFrom(p.pos);
    this.pulseRadius = p.radius;
    this.impulse = 1;
    return this.phaseGeom.reveal(p.pos, p.radius + 2);
  }

  /** voidAmt / derangedAmt: 0..1, how far the world has resolved into each reality. */
  public update(ctx: FieldContext, voidAmt: number, derangedAmt: number): AnomalyReport {
    const phaseSolid = voidAmt;
    const dt = ctx.dt;
    this.time += dt;
    this.phaseSolid = phaseSolid;
    this.impulse = Math.max(0, this.impulse - dt * 3);

    // Keep a sparse population of motes around the protagonist
    const rnd = Math.random;
    let spawns = 0;
    while (this.motes.count < Math.min(this.moteTarget, this.motes.capacityLimit) && spawns++ < 4) {
      this.motes.spawn(ctx.player.x + (rnd() - 0.5) * 30, 0.7 + rnd() * 5, ctx.player.z + (rnd() - 0.5) * 30,
        (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.1);
    }
    this.suspended.update(ctx);
    this.motes.update(ctx);

    this.rootGrowth += ((ctx.player.z > GAP_FAR_Z - 10 ? 0.35 + derangedAmt * 0.65 : 0.3) - this.rootGrowth) * (1 - Math.exp(-1.5 * dt));
    this.updateRoots();
    MeshBuilder.CreateLineSystem('roots', { lines: this.rootLines, instance: this.roots });

    // The fallen tree is unstable when the fire is near, and absent while phased
    const zc = (BARRIER.z0 + BARRIER.z1) / 2;
    const toBarrier = Math.hypot(ctx.fire.x, ctx.fire.z - zc);
    const near = ctx.fireStrength > 0.05 ? smoothstep(6.5, 2.5, toBarrier) * ctx.fireStrength : 0;
    this.barrierBase = 1 - phaseSolid * 0.9;
    const flick = 1 - near * 0.25 * (0.5 + 0.5 * Math.sin(this.time * 23) * Math.sin(this.time * 7.3));
    for (const m of this.barrier) m.visibility = this.barrierBase * flick;

    // The figure across the gap is only there from far away
    if (this.finale) {
      // The final recognition: it stands on the line beyond the end, close, and does not fade
      this.figure.position.copyFrom(this.finale.pos);
      this.figure.mesh.position.copyFrom(this.finale.pos);
      this.figure.fade = this.finale.fade;
    } else {
      this.figure.position.set(FIGURE.x, BED_Y + 0.9, FIGURE.z);
      this.figure.mesh.position.copyFrom(this.figure.position);
      const dFig = Math.hypot(ctx.player.x - FIGURE.x, ctx.player.z - FIGURE.z);
      this.figure.fade = smoothstep(10, 17, dFig) * smoothstep(60, 40, dFig);
      if (this.figure.fade > 0.7 && ctx.player.z > GAP_NEAR_Z - 12) this.figureSeen = true;
      if (this.figureSeen && this.figure.fade < 0.02) this.figureGone = true;
    }
    this.figure.update(dt, ctx.player);

    // Resonance: how close the fire is to the nearest anomaly
    let best = 0;
    let focus: Vector3 | null = null;
    for (const p of this.points) {
      const d = Math.hypot(ctx.fire.x - p.x, ctx.fire.z - p.z);
      const r = 1 - d / 6.5;
      if (r > best) { best = r; focus = p; }
    }
    this.report.resonance = Math.max(0, best) * Math.min(1, ctx.fireStrength);
    this.report.focus = focus;
    return this.report;
  }

  public anomalyPoints(): Vector3[] { return this.points; }

  /** Finale staging for the figure; null returns it to the far side of the gap. */
  public finale: { pos: Vector3; fade: number } | null = null;

  public reset(): void {
    this.finale = null;
    this.figureSeen = false;
    this.figureGone = false;
    this.figure.hasTriggeredRecognition = false;
    this.motes.clear();
    this.rootGrowth = 0.3;
  }
}
