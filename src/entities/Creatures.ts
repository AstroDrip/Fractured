import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, Camera, Frustum } from '@babylonjs/core';
import { ParticleField, FieldContext } from '../graphics/ParticleField';
import { WalkGrid } from '../world/WalkGrid';
import { mulberry32, damp, smoothstep } from '../core/rng';
import type { RealityId } from '../core/Reality';
import { CROSSING, BRIDGE_Y, GAP_NEAR_Z } from '../world/layout';

export interface BeingContext {
  dt: number;
  time: number;
  player: Vector3;
  playerSpeed: number;
  fireOn: boolean;
  firePos: Vector3;
  reality: RealityId;
  voidAmt: number;
  derangedAmt: number;
  transitioning: boolean;    // a phase transition is under way
  /** Height above the ground while on a gravity surface (0 on the ground): out of reach above ~1.2 m. */
  playerHeight: number;
  camera: Camera;
}

/** One finite-state step: returns the next state, or null to stay. */
type Step<S> = (dt: number, c: BeingContext) => S | null;

const darkMat = (scene: Scene, name: string, c: number) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(c, c * 1.02, c * 1.06);
  m.specularColor = new Color3(0.08, 0.08, 0.09);
  m.specularPower = 40;
  return m;
};

// --- Avoidant: the Watcher -------------------------------------------------

type WatcherState = 'watch' | 'retreat' | 'hidden' | 'vanish';

/**
 * Watches from the tree line. Retreats when approached or when the flame comes
 * near; relocates ahead only while not being looked at; vanishes during a phase
 * transition. Never attacks.
 */
export class Watcher {
  public root: TransformNode;
  public state: WatcherState = 'watch';
  private meshes: Mesh[] = [];
  private alpha = 0;
  private timer = 0;
  private spot = 0;
  private static readonly SPOTS: [number, number][] = [[-9.5, 31], [-11, 63], [-12.5, 104], [-10, 141], [-8.5, 176]];

  constructor(scene: Scene) {
    this.root = new TransformNode('watcher', scene);
    const m = darkMat(scene, 'watcherMat', 0.035);
    m.alpha = 0.999;
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0) => {
      const b = MeshBuilder.CreateBox('watcherPart', { width: w, height: h, depth: d }, scene);
      b.parent = this.root; b.position.set(x, y, z); b.rotation.z = rz; b.material = m; b.isPickable = false;
      this.meshes.push(b);
    };
    part(0.07, 1.25, 0.08, -0.08, 0.62, 0);  // legs too long for its body
    part(0.07, 1.25, 0.08, 0.08, 0.62, 0);
    part(0.24, 0.95, 0.16, 0, 1.7, 0);
    part(0.05, 1.3, 0.05, -0.17, 1.55, 0, 0.05);  // arms to the knee
    part(0.05, 1.3, 0.05, 0.17, 1.55, 0, -0.05);
    part(0.15, 0.24, 0.15, 0, 2.32, 0.02);
    this.place(0);
  }

  private place(i: number): void {
    this.spot = i;
    const [x, z] = Watcher.SPOTS[i];
    this.root.position.set(x, 0.5, z);
  }

  // Called at most once a second while hidden, so the allocation is acceptable
  private inView(c: BeingContext): boolean {
    const planes = Frustum.GetPlanes(c.camera.getTransformationMatrix());
    const p = this.root.position;
    for (const pl of planes) if (pl.dotCoordinate(p) < -1.5) return false;
    return true;
  }

  private readonly steps: Record<WatcherState, Step<WatcherState>> = {
    watch: (dt, c) => {
      this.alpha = Math.min(1, this.alpha + dt * 0.6);
      const d = Vector3.Distance(c.player, this.root.position);
      if (c.transitioning) return 'vanish';
      if (d < 14 || (c.fireOn && Vector3.Distance(c.firePos, this.root.position) < 10)) return 'retreat';
      if (c.player.z > this.root.position.z + 6) return 'retreat'; // left behind
      return null;
    },
    retreat: (dt, c) => {
      const away = this.root.position.subtract(c.player); away.y = 0; away.normalize();
      this.root.position.addInPlace(away.scaleInPlace(2.4 * dt));
      this.alpha = Math.max(0, this.alpha - dt * 0.7);
      return this.alpha <= 0 ? 'hidden' : null;
    },
    vanish: (dt) => {
      this.alpha = Math.max(0, this.alpha - dt * 4);
      return this.alpha <= 0 ? 'hidden' : null;
    },
    hidden: (dt, c) => {
      this.timer += dt;
      // Choose the next place ahead of the protagonist and go there only while unobserved
      let next = this.spot;
      for (let i = 0; i < Watcher.SPOTS.length; i++) if (Watcher.SPOTS[i][1] > c.player.z + 14) { next = i; break; }
      if (this.timer > 4 && next !== this.spot) {
        const was = this.root.position.clone();
        const prevSpot = this.spot;
        this.place(next);
        this.spot = prevSpot;
        if (this.inView(c)) { this.place(this.spot); this.root.position.copyFrom(was); this.timer = 3; return null; }
        this.spot = next;
        this.timer = 0;
        return 'watch';
      }
      return null;
    }
  };

  public update(c: BeingContext): void {
    const next = this.steps[this.state](c.dt, c);
    if (next) { this.state = next; this.timer = 0; }
    // Face the protagonist; in the Void only a trace of it remains
    const dir = c.player.subtract(this.root.position);
    this.root.rotation.y = Math.atan2(dir.x, dir.z);
    const v = this.alpha * (1 - c.voidAmt * 0.75);
    for (const m of this.meshes) { m.visibility = v; m.isVisible = v > 0.01; }
  }

  public reset(): void { this.state = 'watch'; this.alpha = 0; this.timer = 0; this.place(0); }
}

// --- Flame-sensitive: the Drifters ----------------------------------------

interface Drifter { home: Vector3; centre: Vector3; scattered: number; }

/**
 * Small beings of a few dark cubes each, at the edge of the gap. They are drawn
 * toward the flame and, in the Void, settle along the hidden bridge like moths —
 * legible only near the flame. A pulse or ember scatters them; they gather again.
 */
export class Drifters {
  public field: ParticleField;
  private beings: Drifter[] = [];
  private readonly perBeing = 5;
  private bridgePoints: Vector3[] = [];
  public onScattered?: (at: Vector3) => void;

  constructor(scene: Scene) {
    const rnd = mulberry32(8080);
    for (let i = 0; i < 7; i++) {
      const home = new Vector3((rnd() - 0.5) * 6, 1.2 + rnd() * 1.4, GAP_NEAR_Z - 6 + rnd() * 5.5);
      this.beings.push({ home, centre: home.clone(), scattered: 0 });
    }
    for (const seg of CROSSING) {
      if (seg.realities !== 2) continue;
      for (let z = seg.z0 + 1; z < seg.z1 - 0.5; z += 2.2) this.bridgePoints.push(new Vector3((this.bridgePoints.length % 2 ? 1 : -1) * 0.9, BRIDGE_Y + 0.6, z));
    }
    this.field = new ParticleField(scene, {
      name: 'drifters', capacity: 7 * this.perBeing, blend: 'alpha', life: [0, 0], size: [0.05, 0.11],
      colorA: [0.03, 0.03, 0.035, 0.9], colorB: [0.03, 0.03, 0.035, 0.9], spin: 3, seed: 81,
      behavior: (f, i, c) => this.step(f, i, c)
    });
    for (let i = 0; i < 7 * this.perBeing; i++) this.field.spawn(0, -40, 0);
  }

  private ctx!: BeingContext;

  private step(f: ParticleField, i: number, c: FieldContext): void {
    const b = this.beings[Math.floor(i / this.perBeing)];
    const k = i % this.perBeing;
    const s = f.seed[i];
    const spread = 0.22 + b.scattered * 3;
    const a = c.time * (2.2 + s * 2) + k * 1.3;
    f.px[i] = b.centre.x + Math.cos(a) * spread;
    f.py[i] = b.centre.y + Math.sin(a * 1.4) * spread * 0.6;
    f.pz[i] = b.centre.z + Math.sin(a) * spread;
    f.vx[i] = f.vy[i] = f.vz[i] = 0;
    const cx = this.ctx;
    // Normal: dark and readable. Void: only where the flame reaches.
    const near = cx ? 1 - smoothstep(3, 8, Vector3.Distance(b.centre, cx.firePos)) : 0;
    const vis = cx ? (cx.voidAmt > 0.5 ? (cx.fireOn ? near : 0) : 1) : 1;
    f.alphaMul[i] = vis * (1 - b.scattered);
  }

  public update(c: BeingContext, fieldCtx: FieldContext): void {
    this.ctx = c;
    for (let i = 0; i < this.beings.length; i++) {
      const b = this.beings[i];
      if (b.scattered > 0) { b.scattered = Math.min(1, b.scattered + c.dt * 0.25); if (b.scattered >= 1) { b.scattered = 0; b.centre.copyFrom(b.home); } continue; }
      let target = b.home;
      if (c.voidAmt > 0.5 && this.bridgePoints.length) target = this.bridgePoints[i % this.bridgePoints.length];
      else if (c.fireOn && Vector3.Distance(c.firePos, b.centre) < 8) {
        // Drawn toward the flame, stopping just short of it
        const to = c.firePos.subtract(b.centre); const d = to.length();
        target = d > 1.6 ? b.centre.add(to.scale((d - 1.6) / d)) : b.centre;
      }
      Vector3.LerpToRef(b.centre, target, damp(0.8, c.dt), b.centre);
      // Deranged: their positions skip
      if (c.derangedAmt > 0.5 && Math.random() < c.dt * 0.8) b.centre.x += (Math.random() - 0.5) * 1.2;
    }
    this.field.update(fieldCtx);
  }

  /** A pulse or ember within reach scatters them. Returns how many scattered. */
  public hit(at: Vector3, radius: number): number {
    let n = 0;
    for (const b of this.beings) {
      if (b.scattered === 0 && Vector3.Distance(at, b.centre) < radius) {
        b.scattered = 0.001; n++;
        if (this.onScattered) this.onScattered(b.centre.clone());
      }
    }
    return n;
  }

  public reset(): void { for (const b of this.beings) { b.scattered = 0; b.centre.copyFrom(b.home); } }
}

// --- Pursuer: the Hound -----------------------------------------------------

type HoundState = 'rest' | 'alert' | 'stalk' | 'pursue' | 'search' | 'repelled' | 'return';
const HOUND_REACH_HEIGHT = 1.2;   // the protagonist is out of reach above this on a face

export const HOUND = { den: new Vector3(-2.4, 0.5, 274), zMin: 247, zMax: 292, checkpoint: { x: 0, z: 245.5 } };

/**
 * A low shape that rests in a stretch of the far railway. Running, the open flame
 * or a phase transition nearby wake it; it stalks, then pursues briefly. An ember
 * or pulse drives it back to its den. Walking slowly with the hand closed passes
 * it. If it reaches the protagonist they are knocked back to the checkpoint; it
 * does not kill. In Deranged its position updates in skips.
 */
export class Hound {
  public root: TransformNode;
  public state: HoundState = 'rest';
  private readonly searchAt = new Vector3();
  public readonly pos = HOUND.den.clone();
  private body: TransformNode;
  private head: Mesh;
  private legs: Mesh[] = [];
  private timer = 0;
  private gait = 0;
  private stuck = 0;
  private lastPos = new Vector3();
  private shownPos = HOUND.den.clone();
  private skipTimer = 0;
  public onCatch?: () => void;
  public onWake?: () => void;

  constructor(scene: Scene, private grid: WalkGrid) {
    this.root = new TransformNode('hound', scene);
    this.body = new TransformNode('houndBody', scene);
    this.body.parent = this.root;
    const m = darkMat(scene, 'houndMat', 0.03);
    const part = (parent: TransformNode, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const b = MeshBuilder.CreateBox('houndPart', { width: w, height: h, depth: d }, scene);
      b.parent = parent; b.position.set(x, y, z); b.material = m; b.isPickable = false;
      return b;
    };
    part(this.body, 0.42, 0.36, 1.35, 0, 0.62, 0);
    for (let i = 0; i < 5; i++) part(this.body, 0.05, 0.16 + (i % 2) * 0.08, 0.06, 0, 0.86, -0.5 + i * 0.25); // spines
    this.head = part(this.body, 0.26, 0.24, 0.5, 0, 0.55, 0.85);
    for (const [x, z] of [[-0.16, 0.45], [0.16, 0.45], [-0.16, -0.5], [0.16, -0.5]]) {
      this.legs.push(part(this.body, 0.07, 0.6, 0.07, x, 0.3, z));
    }
    this.root.position.copyFrom(this.pos);
  }

  private stimulus(c: BeingContext): boolean {
    const d = Vector3.Distance(c.player, this.pos);
    const inTerritory = c.player.z > HOUND.zMin && c.player.z < HOUND.zMax;
    if (!inTerritory || c.playerHeight > HOUND_REACH_HEIGHT) return false;
    const reach = this.state === 'rest' ? 11 : 17;
    return d < reach && (c.playerSpeed > 3.3 || (c.fireOn && d < 13) || (c.transitioning && d < 20));
  }

  private moveToward(target: Vector3, speed: number, dt: number): void {
    const to = target.subtract(this.pos); to.y = 0;
    const d = to.length();
    if (d < 0.05) return;
    // Arrive: brake inside the slow radius
    const s = speed * Math.min(1, d / 1.5);
    const step = to.scaleInPlace(Math.min(d, s * dt) / d);
    const nx = this.pos.x + step.x, nz = this.pos.z + step.z;
    if (this.grid.isWalkable(nx, this.pos.z, 'normal')) this.pos.x = nx;
    if (this.grid.isWalkable(this.pos.x, nz, 'normal') && nz > HOUND.zMin - 1 && nz < HOUND.zMax + 1) this.pos.z = nz;
    this.root.rotation.y = Math.atan2(to.x, to.z);
    this.gait += Math.hypot(step.x, step.z) * 5;
  }

  private readonly steps: Record<HoundState, Step<HoundState>> = {
    rest: (_dt, c) => (this.stimulus(c) ? 'alert' : null),
    alert: (dt, c) => {
      this.timer += dt;
      const to = c.player.subtract(this.pos);
      this.root.rotation.y = Math.atan2(to.x, to.z);
      if (this.timer > 1.1) return this.stimulus(c) ? 'stalk' : 'rest';
      return null;
    },
    stalk: (dt, c) => {
      this.timer += dt;
      this.moveToward(c.player, 1.2, dt);
      if (c.playerHeight > HOUND_REACH_HEIGHT) { this.timer = 0; return 'search'; }
      if (this.stimulus(c) && this.timer > 2.5) return 'pursue';
      if (this.timer > 5) return 'return';
      return null;
    },
    pursue: (dt, c) => {
      this.timer += dt;
      if (c.playerHeight > HOUND_REACH_HEIGHT) { this.timer = 0; return 'search'; }
      this.moveToward(c.player, 4.1, dt);
      if (Vector3.Distance(c.player, this.pos) < 0.95) { if (this.onCatch) this.onCatch(); return 'return'; }
      const left = c.player.z < HOUND.zMin || c.player.z > HOUND.zMax;
      if (this.timer > 6.5 || left) return 'return';
      return null;
    },
    // Lost its quarry overhead: pace beneath where it was, then give up
    search: (dt, c) => {
      this.timer += dt;
      this.searchAt.set(Math.max(-3.2, Math.min(3.2, c.player.x)), this.pos.y, c.player.z);
      this.moveToward(this.searchAt, 1.4, dt);
      if (c.playerHeight <= HOUND_REACH_HEIGHT && this.stimulus(c)) { this.timer = 0; return 'pursue'; }
      return this.timer > 4.5 ? 'return' : null;
    },
    repelled: (dt) => {
      this.timer += dt;
      this.moveToward(HOUND.den, 4.6, dt);
      return this.timer > 5.5 ? 'return' : null;
    },
    return: (dt, c) => {
      this.moveToward(HOUND.den, 1.6, dt);
      if (this.stimulus(c) && Vector3.Distance(c.player, this.pos) < 7) return 'stalk';
      return Vector3.Distance(this.pos, HOUND.den) < 0.4 ? 'rest' : null;
    }
  };

  public update(c: BeingContext): void {
    const was = this.state;
    const next = this.steps[this.state](c.dt, c);
    if (next) {
      if (was === 'rest' && next === 'alert' && this.onWake) this.onWake();
      this.state = next; this.timer = 0;
    }
    // Stuck check: if pursuing without progress, give up rather than grind into an edge
    if (this.state === 'pursue' || this.state === 'stalk') {
      this.stuck = Vector3.DistanceSquared(this.pos, this.lastPos) < 1e-5 ? this.stuck + c.dt : 0;
      if (this.stuck > 1.5) { this.state = 'return'; this.stuck = 0; }
    }
    this.lastPos.copyFrom(this.pos);

    // Presentation: lying low at rest, legs on a gait, head low when stalking
    const resting = this.state === 'rest' ? 1 : 0;
    this.body.position.y += ((resting ? -0.32 : 0) - this.body.position.y) * damp(3, c.dt);
    this.head.position.y = 0.55 - (this.state === 'stalk' ? 0.12 : 0) + (this.state === 'alert' ? 0.15 : 0);
    for (let i = 0; i < 4; i++) this.legs[i].rotation.x = Math.sin(this.gait + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.5 * (1 - resting);
    // Deranged: it is seen in skips, not in motion
    this.skipTimer -= c.dt;
    if (c.derangedAmt < 0.5 || this.skipTimer <= 0) { this.shownPos.copyFrom(this.pos); this.skipTimer = 0.28; }
    this.root.position.copyFrom(this.shownPos);
  }

  /** Ember or pulse impact. Returns true if it was driven off. */
  public hit(at: Vector3, radius: number): boolean {
    if (Vector3.Distance(at, this.pos) > radius) return false;
    this.state = 'repelled'; this.timer = 0;
    return true;
  }

  public reset(): void {
    this.state = 'rest'; this.pos.copyFrom(HOUND.den); this.shownPos.copyFrom(HOUND.den); this.root.position.copyFrom(HOUND.den); this.timer = 0;
  }
}
