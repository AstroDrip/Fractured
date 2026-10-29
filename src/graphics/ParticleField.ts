import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Engine, Material, Vector3 } from '@babylonjs/core';
import { mulberry32 } from '../core/rng';

export interface FieldContext {
  time: number;
  dt: number;
  fire: Vector3;          // palm fire position
  fireStrength: number;   // 0..~1.5
  phase: number;          // 0..1 phase progress
  player: Vector3;
  /** World wind at the protagonist (direction × strength, vortex included); families with windResponse drift with it. */
  wind?: Vector3;
}

export interface FamilySpec {
  name: string;
  capacity: number;
  blend: 'add' | 'alpha';
  life: [number, number];         // seconds; [0, 0] = persistent
  size: [number, number];
  colorA: [number, number, number, number];
  colorB: [number, number, number, number];
  fadeIn?: number;                // fraction of life
  fadeOut?: number;
  drag?: number;
  gravity?: number;               // +up
  noise?: { amp: number; freq: number; speed: number };
  fire?: { radius: number; strength: number };     // +attract / -repel
  contradict?: { rate: number; duration: number };  // bounded trajectory rewinds
  spin?: number;
  homeSpring?: number;            // pull toward each particle's home position
  floorY?: number;                // die before reaching this height
  windResponse?: number;          // how much the shared wind carries this family
  behavior?: (f: ParticleField, i: number, ctx: FieldContext) => void;
  seed?: number;
}

/**
 * A pooled particle family rendered as thin instances of one cube mesh.
 * Simulation is structure-of-arrays with swap-remove, so a family costs one draw
 * call and no per-frame allocation. All families in the game are configurations
 * of this one class.
 */
export class ParticleField {
  public readonly spec: FamilySpec;
  public count = 0;
  public px: Float32Array; public py: Float32Array; public pz: Float32Array;
  public vx: Float32Array; public vy: Float32Array; public vz: Float32Array;
  public hx: Float32Array; public hy: Float32Array; public hz: Float32Array;   // home
  public age: Float32Array; public life: Float32Array; public size: Float32Array;
  public seed: Float32Array; public alphaMul: Float32Array;
  private ax: Float32Array; private ay: Float32Array; private az: Float32Array; private ang: Float32Array; private angV: Float32Array;
  private histX: Float32Array; private histY: Float32Array; private histZ: Float32Array; private histT: Float32Array;
  private rewind: Float32Array;
  private matrices: Float32Array;
  private colors: Float32Array;
  public mesh: Mesh;
  private rnd: () => number;
  private limit: number;
  private channels: Float32Array[];

  constructor(scene: Scene, spec: FamilySpec, material?: StandardMaterial) {
    this.spec = spec;
    const n = spec.capacity;
    const f = () => new Float32Array(n);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.hx = f(); this.hy = f(); this.hz = f();
    this.age = f(); this.life = f(); this.size = f(); this.seed = f(); this.alphaMul = f();
    this.ax = f(); this.ay = f(); this.az = f(); this.ang = f(); this.angV = f();
    this.histX = f(); this.histY = f(); this.histZ = f(); this.histT = f(); this.rewind = f();
    this.matrices = new Float32Array(n * 16);
    this.colors = new Float32Array(n * 4);
    this.rnd = mulberry32(spec.seed ?? 99);
    this.limit = n;
    this.channels = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.hx, this.hy, this.hz,
      this.age, this.life, this.size, this.seed, this.alphaMul, this.ax, this.ay, this.az, this.ang, this.angV,
      this.histX, this.histY, this.histZ, this.histT, this.rewind];

    this.mesh = MeshBuilder.CreateBox(spec.name, { size: 1 }, scene);
    this.mesh.material = material ?? ParticleField.makeMaterial(scene, spec.name + 'Mat', spec.blend);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.hasVertexAlpha = true;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    this.mesh.thinInstanceCount = 0;
  }

  public static makeMaterial(scene: Scene, name: string, blend: 'add' | 'alpha'): StandardMaterial {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true;
    m.diffuseColor = new Color3(1, 1, 1);
    m.emissiveColor = new Color3(0, 0, 0);
    m.specularColor = new Color3(0, 0, 0);
    m.transparencyMode = Material.MATERIAL_ALPHABLEND;
    m.alphaMode = blend === 'add' ? Engine.ALPHA_ADD : Engine.ALPHA_COMBINE;
    m.disableDepthWrite = true;
    return m;
  }

  /** Quality scale 0..1 limits how many particles may be alive. */
  public setQuality(q: number): void {
    this.limit = Math.max(1, Math.floor(this.spec.capacity * q));
  }

  public get capacityLimit(): number { return this.limit; }

  public spawn(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0,
               opts?: { life?: number; size?: number; home?: boolean; alpha?: number }): number {
    if (this.count >= this.limit) return -1;
    const i = this.count++;
    const s = this.spec;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.hx[i] = x; this.hy[i] = y; this.hz[i] = z;
    this.age[i] = 0;
    this.life[i] = opts?.life ?? (s.life[1] > 0 ? s.life[0] + this.rnd() * (s.life[1] - s.life[0]) : 0);
    this.size[i] = opts?.size ?? s.size[0] + this.rnd() * (s.size[1] - s.size[0]);
    this.seed[i] = this.rnd();
    this.alphaMul[i] = opts?.alpha ?? 1;
    // Random spin axis
    let ax = this.rnd() - 0.5, ay = this.rnd() - 0.5, az = this.rnd() - 0.5;
    const l = Math.hypot(ax, ay, az) || 1;
    this.ax[i] = ax / l; this.ay[i] = ay / l; this.az[i] = az / l;
    this.ang[i] = this.rnd() * 6.28;
    this.angV[i] = (this.rnd() - 0.5) * 2 * (s.spin ?? 2);
    this.histX[i] = x; this.histY[i] = y; this.histZ[i] = z; this.histT[i] = 0;
    this.rewind[i] = 0;
    return i;
  }

  public kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const a of this.channels) a[i] = a[last];
  }

  public clear(): void { this.count = 0; this.mesh.thinInstanceCount = 0; }

  public update(ctx: FieldContext): void {
    const s = this.spec;
    const dt = ctx.dt;
    const drag = s.drag ?? 0;
    const dragK = Math.exp(-drag * dt);
    const grav = (s.gravity ?? 0) * dt;
    const nz = s.noise;
    const fire = s.fire;
    const con = s.contradict;
    const spring = s.homeSpring ?? 0;
    const t = ctx.time;

    const windK = (s.windResponse ?? 0) * dt, wx = ctx.wind ? ctx.wind.x : 0, wz = ctx.wind ? ctx.wind.z : 0;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      const life = this.life[i];
      if (life > 0 && this.age[i] >= life) { this.kill(i); i--; continue; }

      if (s.behavior) s.behavior(this, i, ctx);

      let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
      const x = this.px[i], y = this.py[i], z = this.pz[i];
      const sd = this.seed[i] * 31.7;

      if (nz) {
        const f = nz.freq, sp = nz.speed * t;
        vx += nz.amp * dt * (Math.sin(y * f + sp + sd) + Math.sin(z * f * 0.71 - sp * 0.6));
        vy += nz.amp * dt * 0.6 * Math.sin(x * f * 0.83 + sp * 0.8 + sd * 0.5);
        vz += nz.amp * dt * (Math.sin(x * f * 1.13 - sp * 0.7) + Math.sin(y * f * 0.6 + sp + sd));
      }
      if (fire && ctx.fireStrength > 0.01) {
        const dx = ctx.fire.x - x, dy = ctx.fire.y - y, dz = ctx.fire.z - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const r = fire.radius;
        if (d2 < r * r && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const k = fire.strength * ctx.fireStrength * (1 - d / r) * dt / d;
          vx += dx * k; vy += dy * k; vz += dz * k;
        }
      }
      if (spring > 0) {
        vx += (this.hx[i] - x) * spring * dt;
        vy += (this.hy[i] - y) * spring * dt;
        vz += (this.hz[i] - z) * spring * dt;
      }
      vy += grav;
      if (windK > 0) { vx += wx * windK; vz += wz * windK; }
      vx *= dragK; vy *= dragK; vz *= dragK;

      // Contradictory trajectories: briefly retrace toward where the particle was
      if (con) {
        this.histT[i] += dt;
        if (this.rewind[i] > 0) {
          this.rewind[i] -= dt;
          const k = 1 - Math.exp(-7 * dt);
          this.px[i] += (this.histX[i] - x) * k;
          this.py[i] += (this.histY[i] - y) * k;
          this.pz[i] += (this.histZ[i] - z) * k;
          if (this.rewind[i] <= 0) { vx = -vx * 0.6; vy = -vy * 0.3; vz = -vz * 0.6; this.histT[i] = 0; }
          this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
          this.angV[i] = -Math.abs(this.angV[i]);
        } else {
          if (this.histT[i] > 0.35) {
            this.histX[i] = x; this.histY[i] = y; this.histZ[i] = z; this.histT[i] = 0;
          }
          if (this.rnd() < con.rate * dt) this.rewind[i] = con.duration;
        }
      }
      if (this.rewind[i] <= 0) {
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
        this.px[i] = x + vx * dt; this.py[i] = y + vy * dt; this.pz[i] = z + vz * dt;
      }
      this.ang[i] += this.angV[i] * dt;

      if (s.floorY !== undefined && this.py[i] < s.floorY) { this.kill(i); i--; continue; }
    }
    this.writeBuffers();
  }

  private writeBuffers(): void {
    const s = this.spec;
    const m = this.matrices, c = this.colors;
    const A = s.colorA, B = s.colorB;
    const fi = s.fadeIn ?? 0.1, fo = s.fadeOut ?? 0.3;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i];
      const t = life > 0 ? this.age[i] / life : 0.5;
      let a = 1;
      if (life > 0) {
        if (t < fi) a = t / fi;
        else if (t > 1 - fo) a = (1 - t) / fo;
      } else {
        a = Math.min(1, this.age[i] / 0.6);
      }
      a *= this.alphaMul[i];
      const sc = this.size[i] * (life > 0 ? (1 - t * 0.5) : 1);
      const ang = this.ang[i], cs = Math.cos(ang), sn = Math.sin(ang), oc = 1 - cs;
      const kx = this.ax[i], ky = this.ay[i], kz = this.az[i];
      const o = i * 16;
      m[o] = (cs + kx * kx * oc) * sc; m[o + 1] = (kx * ky * oc + kz * sn) * sc; m[o + 2] = (kx * kz * oc - ky * sn) * sc; m[o + 3] = 0;
      m[o + 4] = (ky * kx * oc - kz * sn) * sc; m[o + 5] = (cs + ky * ky * oc) * sc; m[o + 6] = (ky * kz * oc + kx * sn) * sc; m[o + 7] = 0;
      m[o + 8] = (kz * kx * oc + ky * sn) * sc; m[o + 9] = (kz * ky * oc - kx * sn) * sc; m[o + 10] = (cs + kz * kz * oc) * sc; m[o + 11] = 0;
      m[o + 12] = this.px[i]; m[o + 13] = this.py[i]; m[o + 14] = this.pz[i]; m[o + 15] = 1;
      const q = i * 4;
      c[q] = A[0] + (B[0] - A[0]) * t;
      c[q + 1] = A[1] + (B[1] - A[1]) * t;
      c[q + 2] = A[2] + (B[2] - A[2]) * t;
      c[q + 3] = (A[3] + (B[3] - A[3]) * t) * a;
    }
    this.mesh.thinInstanceCount = this.count;
    if (this.count > 0) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      this.mesh.thinInstanceBufferUpdated('color');
    }
  }

  public dispose(): void { this.mesh.dispose(false, true); }
}
