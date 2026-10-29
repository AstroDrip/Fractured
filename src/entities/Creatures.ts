import { Scene, LinesMesh, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, Camera, Frustum } from '@babylonjs/core';
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
  // Spots it is seen from: the tree line, the cliff top above the cutting, beyond the huts
  private static readonly SPOTS: [number, number][] = [[-9.5, 31], [-19.5, 63], [-12.5, 104], [-10, 141], [-8.5, 176]];
  private body!: TransformNode;
  private neck!: TransformNode;
  private sway = 0;

  constructor(scene: Scene) {
    this.root = new TransformNode('watcher', scene);
    const m = darkMat(scene, 'watcherMat', 0.035);
    m.alpha = 0.999;
    // Too tall and too thin: limbs as long tapered cylinders, a narrow head tilted to
    // one side, arms that hang past the knees. Read as a silhouette, never in detail.
    const seg = (len: number, r0: number, r1: number, parent: TransformNode, x: number, y: number, z: number, rz = 0, rx = 0) => {
      const n = new TransformNode('watcherJoint', scene);
      n.parent = parent; n.position.set(x, y, z); n.rotation.z = rz; n.rotation.x = rx;
      const b = MeshBuilder.CreateCylinder('watcherPart', { height: len, diameterTop: r0 * 2, diameterBottom: r1 * 2, tessellation: 7 }, scene);
      b.parent = n; b.position.y = -len / 2; b.material = m; b.isPickable = false;
      this.meshes.push(b);
      return n;
    };
    this.body = new TransformNode('watcherBody', scene);
    this.body.parent = this.root;
    for (const side of [-1, 1]) {
      const hip = seg(0.78, 0.045, 0.035, this.body, side * 0.07, 1.42, 0, side * 0.02);
      seg(0.72, 0.035, 0.022, hip, 0, -0.78, 0, 0, 0.04);
    }
    const torso = MeshBuilder.CreateCylinder('watcherPart', { height: 0.95, diameterTop: 0.2, diameterBottom: 0.13, tessellation: 8 }, scene);
    torso.parent = this.body; torso.position.y = 1.9; torso.scaling.z = 0.6; torso.material = m; torso.isPickable = false;
    this.meshes.push(torso);
    for (const side of [-1, 1]) {
      const sh = seg(0.72, 0.03, 0.024, this.body, side * 0.12, 2.33, 0, side * 0.06);
      seg(0.72, 0.024, 0.014, sh, 0, -0.72, 0, -side * 0.03, -0.05);
    }
    this.neck = new TransformNode('watcherNeck', scene);
    this.neck.parent = this.body; this.neck.position.set(0, 2.38, 0.02);
    const head = MeshBuilder.CreateSphere('watcherPart', { diameter: 0.15, segments: 6 }, scene);
    head.parent = this.neck; head.position.y = 0.16; head.scaling.set(0.75, 1.6, 0.85); head.material = m; head.isPickable = false;
    this.meshes.push(head);
    this.place(0);
  }

  /** Ground height under a spot (the cliff top stands well above the line). */
  public groundAt: (x: number, z: number) => number = () => 0.5;

  private place(i: number): void {
    this.spot = i;
    const [x, z] = Watcher.SPOTS[i];
    this.root.position.set(x, this.groundAt(x, z), z);
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
    // A slow sway, and the head tilts further the closer it lets you come
    this.sway += c.dt;
    this.body.rotation.z = Math.sin(this.sway * 0.4) * 0.03;
    const d = Math.hypot(dir.x, dir.z);
    this.neck.rotation.z = 0.32 + smoothstep(40, 14, d) * 0.35;
    this.neck.rotation.x = 0.12;
    const v = this.alpha * (1 - c.voidAmt * 0.75);
    for (const m of this.meshes) { m.visibility = v; m.isVisible = v > 0.01; }
  }

  public reset(): void { this.state = 'watch'; this.alpha = 0; this.timer = 0; this.place(0); }
}

// --- Flame-sensitive: the Drifters ----------------------------------------

interface Drifter { home: Vector3; centre: Vector3; scattered: number; core: Mesh; threads: LinesMesh; }
const DRIFT_BEAT = 1.15;     // seconds per move-and-hold cycle: they go in beats, not glides

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
    const coreMat = darkMat(scene, 'drifterMat', 0.022);
    coreMat.alpha = 0.999;
    for (let i = 0; i < 7; i++) {
      const home = new Vector3((rnd() - 0.5) * 6, 1.2 + rnd() * 1.4, GAP_NEAR_Z - 6 + rnd() * 5.5);
      // A long dark shard, point down, with threads trailing below it
      const core = MeshBuilder.CreatePolyhedron('drifterCore', { type: 0, size: 0.13 }, scene);
      core.scaling.set(0.55, 2.2, 0.55);
      core.material = coreMat;
      core.isPickable = false;
      const lines: Vector3[][] = [];
      for (let k = 0; k < 3; k++) lines.push([Vector3.Zero(), Vector3.Zero(), Vector3.Zero()]);
      const threads = MeshBuilder.CreateLineSystem('drifterThreads', { lines, updatable: true }, scene);
      threads.color = new Color3(0.05, 0.05, 0.06);
      threads.isPickable = false;
      this.beings.push({ home, centre: home.clone(), scattered: 0, core, threads });
    }
    for (const seg of CROSSING) {
      if (seg.realities !== 2) continue;
      for (let z = seg.z0 + 1; z < seg.z1 - 0.5; z += 2.2) this.bridgePoints.push(new Vector3((this.bridgePoints.length % 2 ? 1 : -1) * 0.9, BRIDGE_Y + 0.6, z));
    }
    this.field = new ParticleField(scene, {
      name: 'drifters', capacity: 7 * this.perBeing, blend: 'alpha', life: [0, 0], size: [0.025, 0.05],
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
      // Move on the first part of each beat, hold still for the rest
      const beat = ((c.time + i * 0.37) % DRIFT_BEAT) / DRIFT_BEAT;
      if (beat < 0.4) Vector3.LerpToRef(b.centre, target, damp(2.2, c.dt), b.centre);
      // Deranged: their positions skip
      if (c.derangedAmt > 0.5 && Math.random() < c.dt * 0.8) b.centre.x += (Math.random() - 0.5) * 1.2;
    }
    this.field.update(fieldCtx);
    this.present(c);
  }

  // Cores and threads follow the same visibility rule as the motes around them
  private present(c: BeingContext): void {
    for (let i = 0; i < this.beings.length; i++) {
      const b = this.beings[i];
      const near = 1 - smoothstep(3, 8, Vector3.Distance(b.centre, c.firePos));
      const vis = (c.voidAmt > 0.5 ? (c.fireOn ? near : 0) : 1) * (1 - b.scattered);
      b.core.isVisible = vis > 0.02;
      b.threads.isVisible = vis > 0.02;
      if (!b.core.isVisible) continue;
      b.core.visibility = vis;
      b.core.position.copyFrom(b.centre);
      b.core.rotation.y = c.time * 0.4 + i;
      b.core.rotation.z = Math.sin(c.time * 0.9 + i) * 0.15;
      const lines: Vector3[][] = [];
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + i, sway = Math.sin(c.time * 1.7 + k + i) * 0.06;
        const top = b.centre.add(new Vector3(Math.cos(a) * 0.03, -0.22, Math.sin(a) * 0.03));
        lines.push([top, top.add(new Vector3(sway, -0.22, -sway * 0.5)), top.add(new Vector3(sway * 2.2, -0.5, -sway))]);
      }
      MeshBuilder.CreateLineSystem('drifterThreads', { lines, instance: b.threads });
      b.threads.alpha = vis * 0.8;
    }
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
  private head!: Mesh;
  private neck!: TransformNode;
  private headNode!: TransformNode;
  private limbs: { hip: TransformNode; knee: TransformNode; hind: boolean }[] = [];
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
    const add = <T extends Mesh>(mesh: T, parent: TransformNode, x: number, y: number, z: number): T => {
      mesh.parent = parent; mesh.position.set(x, y, z); mesh.material = m; mesh.isPickable = false; return mesh;
    };
    // Torso: long, low, hunched at the shoulders; ribs show along the flank
    const torso = add(MeshBuilder.CreateCapsule('houndTorso', { height: 1.3, radius: 0.19, tessellation: 10 }, scene), this.body, 0, 0.66, -0.05);
    torso.rotation.x = Math.PI / 2 - 0.12;
    torso.scaling.set(1.0, 1.0, 0.85);
    add(MeshBuilder.CreateSphere('houndHump', { diameter: 0.44, segments: 8 }, scene), this.body, 0, 0.8, 0.38).scaling.set(1, 0.8, 1.2);
    for (let i = 0; i < 5; i++) {
      for (const side of [-1, 1]) {
        const rib = add(MeshBuilder.CreateTorus('houndRib', { diameter: 0.36, thickness: 0.018, tessellation: 10 }, scene), this.body, side * 0.02, 0.66, -0.2 + i * 0.13);
        rib.rotation.y = Math.PI / 2; rib.scaling.set(1, 1.1, 1);
      }
    }
    // Spines: thin points along the back, tallest over the shoulders
    for (let i = 0; i < 7; i++) {
      const h = 0.12 + Math.sin((i / 6) * Math.PI) * 0.14;
      add(MeshBuilder.CreateCylinder('houndSpine', { height: h, diameterTop: 0, diameterBottom: 0.035, tessellation: 5 }, scene),
        this.body, 0, 0.88 + h / 2 - 0.04 * Math.abs(i - 4), -0.55 + i * 0.18).rotation.x = -0.35;
    }
    // Neck and head: carried low; a long eyeless snout
    this.neck = new TransformNode('houndNeck', scene);
    this.neck.parent = this.body; this.neck.position.set(0, 0.72, 0.58);
    add(MeshBuilder.CreateCapsule('houndNeckM', { height: 0.42, radius: 0.09, tessellation: 8 }, scene), this.neck, 0, -0.04, 0.16).rotation.x = Math.PI / 2 + 0.5;
    this.headNode = new TransformNode('houndHead', scene);
    this.headNode.parent = this.neck; this.headNode.position.set(0, -0.16, 0.38);
    this.head = add(MeshBuilder.CreateCylinder('houndSnout', { height: 0.5, diameterTop: 0.05, diameterBottom: 0.2, tessellation: 8 }, scene), this.headNode, 0, 0, 0.18);
    this.head.rotation.x = Math.PI / 2 + 0.12;
    this.head.scaling.set(0.85, 1, 1.25);
    // Tail: thin, hanging
    const tail = add(MeshBuilder.CreateCylinder('houndTail', { height: 0.6, diameterTop: 0.01, diameterBottom: 0.05, tessellation: 5 }, scene), this.body, 0, 0.42, -0.98);
    tail.rotation.x = -2.45;   // hangs down and back
    // Legs: two segments each; the hind knees bend the other way
    for (const [x, z, hind] of [[-0.14, 0.42, 0], [0.14, 0.42, 0], [-0.14, -0.52, 1], [0.14, -0.52, 1]] as [number, number, number][]) {
      const hip = new TransformNode('houndHip', scene);
      hip.parent = this.body; hip.position.set(x, 0.64, z);
      add(MeshBuilder.CreateCylinder('houndThigh', { height: 0.34, diameterTop: hind ? 0.17 : 0.12, diameterBottom: 0.07, tessellation: 7 }, scene), hip, 0, -0.17, 0);
      const knee = new TransformNode('houndKnee', scene);
      knee.parent = hip; knee.position.y = -0.34;
      add(MeshBuilder.CreateCylinder('houndShin', { height: 0.34, diameterTop: 0.065, diameterBottom: 0.04, tessellation: 6 }, scene), knee, 0, -0.17, 0);
      this.limbs.push({ hip, knee, hind: hind === 1 });
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
    // Head: low and forward when stalking, raised and still when alert, a searching sweep
    const headTarget = this.state === 'stalk' ? 0.35 : this.state === 'alert' ? -0.25 : this.state === 'search' ? 0.15 : 0.1;
    this.neck.rotation.x += (headTarget - this.neck.rotation.x) * damp(4, c.dt);
    this.neck.rotation.y = this.state === 'search' ? Math.sin(this.gait * 0.3 + c.time) * 0.5 : this.neck.rotation.y * 0.95;
    this.headNode.rotation.x = Math.sin(this.gait * 2) * 0.05 * (1 - resting);
    // Legs: diagonal pairs; at rest folded under the body
    for (let i = 0; i < 4; i++) {
      const l = this.limbs[i];
      const ph = this.gait + (i === 0 || i === 3 ? 0 : Math.PI);
      const swing = Math.sin(ph) * 0.42 * (1 - resting);
      const lift = Math.max(0, Math.cos(ph)) * 0.6 * (1 - resting);
      const bend = l.hind ? -1 : 1;
      l.hip.rotation.x = swing - resting * (l.hind ? -1.2 : 1.3);
      l.knee.rotation.x = bend * (lift + 0.15) + resting * bend * 2.2;
    }
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
