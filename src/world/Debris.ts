import { Scene, Mesh, MeshBuilder, Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { Materials } from './Materials';
import { EnvAssets } from './EnvAssets';
import { ParticleField, FieldContext } from '../graphics/ParticleField';
import { Surface, WalkGrid } from './WalkGrid';
import type { ThrowSpec } from '../core/FlameTiers';
import type { RealityId } from '../core/Reality';

export type DebrisKind = 'stone' | 'leaf' | 'splinter';

/** How each kind moves: heavier things take less of the push and settle sooner. */
export const DEBRIS_PHYSICS: Record<DebrisKind, { mass: number; drag: number; gravity: number; bounce: number; friction: number; life: number }> = {
  stone:    { mass: 1.0,  drag: 0.3, gravity: 9.8, bounce: 0.28, friction: 0.55, life: 18 },
  leaf:     { mass: 0.08, drag: 2.6, gravity: 2.2, bounce: 0.05, friction: 0.2,  life: 7 },
  splinter: { mass: 0.35, drag: 0.9, gravity: 9.8, bounce: 0.2,  friction: 0.45, life: 12 }
};

/** What lies loose on each kind of ground (counts at full charge; a flick moves a few). */
export const DEBRIS_BY_SURFACE: Partial<Record<Surface, Partial<Record<DebrisKind, number>>>> = {
  [Surface.GRAVEL]: { stone: 14 },
  [Surface.SOIL]: { leaf: 22, stone: 4 },
  [Surface.STONE]: { stone: 9 },
  [Surface.WOOD]: { splinter: 10 },
  [Surface.PHASE]: { leaf: 4 }
};

export interface Body {
  kind: DebrisKind; pos: Vector3; vel: Vector3; rot: Quaternion; spin: Vector3; size: number; age: number; asleep: boolean;
}

/**
 * One physics step for a loose body: gravity, air drag, a ground contact that bounces
 * and rubs off horizontal speed, sleep when it has nearly stopped. Pure, so it is
 * testable without a scene. `ground` is the height under the body.
 */
export function stepBody(b: Body, dt: number, ground: number): void {
  if (b.asleep) { b.age += dt; return; }
  const ph = DEBRIS_PHYSICS[b.kind];
  b.age += dt;
  b.vel.y -= ph.gravity * dt;
  const k = Math.exp(-ph.drag * dt);
  b.vel.x *= k; b.vel.z *= k; if (b.kind === 'leaf') b.vel.y *= k;
  b.pos.addInPlace(b.vel.scale(dt));
  const floor = ground + b.size * 0.4;
  if (b.pos.y < floor) {
    b.pos.y = floor;
    if (b.vel.y < 0) b.vel.y = -b.vel.y * ph.bounce;
    b.vel.x *= ph.friction; b.vel.z *= ph.friction;
    b.spin.scaleInPlace(ph.friction);
    if (b.vel.lengthSquared() < 0.02) { b.vel.setAll(0); b.asleep = true; }
  }
  // Tumble while moving
  const sq = Quaternion.RotationYawPitchRoll(b.spin.y * dt, b.spin.x * dt, b.spin.z * dt);
  b.rot.multiplyInPlace(sq);
}

const MAX_BODIES = 72;
const tmpM = new Matrix(), tmpS = new Vector3();

/**
 * Loose material answering a thrown flame's impact: a pool of bodies drawn with thin
 * instances (one draw call per kind) plus an ash/dust plume. Which bodies spill, and
 * how many, comes from the ground at the impact (DEBRIS_BY_SURFACE); how hard they are
 * pushed from the tier's reach and charge, shared by every kind and scaled by mass.
 * Void has little loose matter left; in Deranged light things fall upward for a moment.
 */
export class Debris {
  private bodies: Body[] = [];
  private meshes: Record<DebrisKind, Mesh>;
  private ash: ParticleField;
  private derangedLift = 0;

  constructor(scene: Scene, mats: Materials, private grid: WalkGrid) {
    const rock = EnvAssets.get('rockB')?.[0];
    const stone = rock ? rock.clone('debrisStone', null)! : MeshBuilder.CreatePolyhedron('debrisStone', { type: 2, size: 0.5 }, scene);
    stone.setEnabled(true); stone.material = mats.stone;
    const leaf = MeshBuilder.CreateDisc('debrisLeaf', { radius: 0.5, tessellation: 5, sideOrientation: Mesh.DOUBLESIDE }, scene);
    leaf.material = mats.bark;
    const splinter = MeshBuilder.CreateBox('debrisSplinter', { width: 0.12, height: 0.12, depth: 1 }, scene);
    splinter.material = mats.timber;
    this.meshes = { stone, leaf, splinter };
    for (const m of Object.values(this.meshes)) { m.isPickable = false; m.thinInstanceCount = 0; m.alwaysSelectAsActiveMesh = true; }
    this.ash = new ParticleField(scene, {
      name: 'impactAsh', capacity: 120, blend: 'alpha', shape: 'flake', life: [1.2, 2.6], size: [0.03, 0.08],
      colorA: [0.16, 0.15, 0.15, 0.85], colorB: [0.1, 0.1, 0.1, 0], fadeIn: 0.05, fadeOut: 0.5,
      drag: 1.4, gravity: 0.25, noise: { amp: 0.6, freq: 1.8, speed: 0.8 }, windResponse: 1.2, spin: 3, seed: 51
    });
  }

  public get count(): number { return this.bodies.length; }

  /** Spill loose material from an impact at `at`. */
  public burst(at: Vector3, spec: ThrowSpec, reality: RealityId): void {
    const surf = this.grid.surfaceAt(at.x, at.z);
    // Off the walkways (forest floor, open ground) the loose matter is leaves and soil
    const table = DEBRIS_BY_SURFACE[surf] ?? DEBRIS_BY_SURFACE[Surface.SOIL]!;
    const amount = (0.25 + spec.charge * 0.75) * (reality === 'void' ? 0.35 : 1);
    if (reality === 'deranged') this.derangedLift = 1.5;
    const ground = this.grid.heightAt(at.x, at.z);
    for (const [kind, n] of Object.entries(table) as [DebrisKind, number][]) {
      const count = Math.round(n * amount);
      for (let i = 0; i < count; i++) {
        if (this.bodies.length >= MAX_BODIES) this.bodies.shift();   // oldest go first
        const a = Math.random() * Math.PI * 2, r = Math.random() * spec.reach * 0.35;
        const pos = new Vector3(at.x + Math.cos(a) * r, ground + 0.05, at.z + Math.sin(a) * r);
        // Push: outward and up, falling off with distance, divided by mass
        const fall = 1 - r / (spec.reach * 0.35 + 0.01);
        const push = (1.5 + spec.charge * 4.5) * (0.4 + 0.6 * fall) / Math.sqrt(DEBRIS_PHYSICS[kind].mass);
        const vel = new Vector3(Math.cos(a) * push * 0.7, push * (0.5 + Math.random() * 0.5), Math.sin(a) * push * 0.7);
        const size = kind === 'stone' ? 0.05 + Math.random() * 0.09 : kind === 'leaf' ? 0.06 + Math.random() * 0.05 : 0.3 + Math.random() * 0.35;
        const spin = new Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
        this.bodies.push({ kind, pos, vel, rot: Quaternion.Identity(), spin, size, age: 0, asleep: false });
      }
    }
    // A plume of ash and dust, leaning away from the hit
    const plume = Math.round((8 + spec.charge * 26) * (reality === 'void' ? 0.4 : 1));
    for (let i = 0; i < plume; i++) {
      this.ash.spawn(at.x + (Math.random() - 0.5) * 0.4, ground + 0.1, at.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * (0.8 + spec.charge * 1.4), (Math.random() - 0.5) * 1.2);
    }
  }

  public update(dt: number, ctx: FieldContext): void {
    this.derangedLift = Math.max(0, this.derangedLift - dt);
    for (const b of this.bodies) {
      if (this.derangedLift > 0 && b.kind === 'leaf' && !b.asleep) b.vel.y += 4.4 * dt;   // falling the wrong way
      stepBody(b, dt, this.grid.heightAt(b.pos.x, b.pos.z));
    }
    this.bodies = this.bodies.filter(b => b.age < DEBRIS_PHYSICS[b.kind].life);
    for (const kind of ['stone', 'leaf', 'splinter'] as DebrisKind[]) {
      const list = this.bodies.filter(b => b.kind === kind);
      const m = this.meshes[kind];
      const buf = new Float32Array(Math.max(1, list.length) * 16);
      list.forEach((b, i) => {
        const life = DEBRIS_PHYSICS[b.kind].life;
        const fade = Math.min(1, (life - b.age) / 1.5);            // shrink away at the end
        tmpS.setAll(b.size * fade);
        Matrix.ComposeToRef(tmpS, b.rot, b.pos, tmpM);
        tmpM.copyToArray(buf, i * 16);
      });
      m.thinInstanceSetBuffer('matrix', buf, 16, false);
      m.thinInstanceCount = list.length;
    }
    if (this.ash.count > 0) this.ash.update(ctx);
  }

  public clear(): void { this.bodies = []; this.ash.clear(); for (const m of Object.values(this.meshes)) m.thinInstanceCount = 0; }
}
