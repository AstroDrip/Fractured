import { Vector2, Vector3 } from '@babylonjs/core';
import { WalkGrid } from '../world/WalkGrid';
import { Player } from './Player';
import { damp } from '../core/rng';
import { GRAVITY_SURFACES } from '../world/layout';
import type { GravitySurface, Vec3 } from '../world/layout';
import type { RealityId } from '../core/Reality';
import { realityBit } from '../core/Reality';

export type MoveMode = 'ground' | 'air' | 'vault' | 'toWall' | 'wall' | 'fromWall';

export interface MoveInput {
  x: number;          // screen right
  y: number;          // screen down
  run: boolean;
  slow: boolean;
  jump: boolean;      // edge
}

const GRAVITY = 12;
const JUMP_SPEED = 3.6;     // ~0.54 m hop
const VAULT_TIME = 0.55;
const WALL_TRANSITION = 0.45;
const WORLD_UP = new Vector3(0, 1, 0);
const v3 = (a: Vec3) => new Vector3(a[0], a[1], a[2]);

/** A gravity surface's frame as vectors (built once per surface). */
export interface SurfaceFrame { s: GravitySurface; origin: Vector3; normal: Vector3; u: Vector3; v: Vector3; }
export const SURFACE_FRAMES: SurfaceFrame[] = GRAVITY_SURFACES.map(s => ({
  s, origin: v3(s.origin), normal: v3(s.normal).normalize(), u: v3(s.uAxis).normalize(), v: v3(s.vAxis).normalize()
}));

/**
 * Screen input (mx right, my down) to face coordinates (du, dv) for any face
 * orientation: screen right is the camera's right, screen up is world up when the
 * face is upright (walls) or the camera's forward when it is not (ceilings, floors).
 * Both are projected onto the face; the result keeps the input's magnitude.
 */
export function faceInput(f: SurfaceFrame, mx: number, my: number, right: { x: number; y: number }, forward: { x: number; y: number }): { du: number; dv: number } {
  const upright = Math.abs(f.v.y) > 0.5;
  const sx = right.x, sz = right.y;                 // camera right, world XZ
  const ux = upright ? 0 : forward.x, uy = upright ? 1 : 0, uz = upright ? 0 : forward.y;
  const dx = sx * mx - ux * my, dy = -uy * my, dz = sz * mx - uz * my;
  let du = dx * f.u.x + dy * f.u.y + dz * f.u.z;
  let dv = dx * f.v.x + dy * f.v.y + dz * f.v.z;
  const want = Math.hypot(mx, my), got = Math.hypot(du, dv);
  if (got > 1e-4) { du *= want / got; dv *= want / got; }
  return { du, dv };
}

/**
 * The protagonist's movement. One controller owns position, velocity and the
 * local up for every mode, so movement, collision, animation and camera share a
 * single gravity frame:
 *  - ground: camera-relative walking/running with axis-separated sliding
 *  - air: a small hop relative to local up; lands with an impulse scaled by speed
 *  - vault: a scripted arc over a designated low obstacle, validated on both sides
 *  - toWall / wall / fromWall: in Deranged, gravity at a gravity surface turns toward
 *    its face; the protagonist walks the face in its own (u, v) coordinates. Every
 *    surface is data (layout GRAVITY_SURFACES); none has code of its own
 */
export class PlayerController {
  public mode: MoveMode = 'ground';
  public readonly pos = new Vector3();
  public readonly vel = new Vector3();
  public readonly up = new Vector3(0, 1, 0);
  public airHeight = 0;
  public landing = 0;
  public vaultT = 0;
  public wallU = 0;
  public wallV = 0;
  /** The gravity surface in use (null on the ground). */
  public surface: SurfaceFrame | null = null;
  private vy = 0;
  private transT = 0;
  private readonly transFrom = new Vector3();
  private readonly transTo = new Vector3();
  private readonly upFrom = new Vector3();
  private readonly upTo = new Vector3();
  private readonly vaultFrom = new Vector3();
  private readonly vaultTo = new Vector3();
  private readonly prev = new Vector3();
  private readonly next = new Vector3();
  private readonly tmpW = new Vector3();
  private readonly faceVel = new Vector2();

  public onLand?: (impact: number) => void;
  public onJump?: () => void;
  public onVault?: () => void;
  public onEnterWall?: () => void;
  public onLeaveWall?: () => void;

  constructor(private grid: WalkGrid, private player: Player, private axes: { forward: { x: number; y: number }; right: { x: number; y: number } }) {}

  public get onWall(): boolean { return this.mode === 'wall' || this.mode === 'toWall' || this.mode === 'fromWall'; }
  public get airborne(): number { return this.mode === 'air' ? Math.min(1, this.airHeight / 0.3) : 0; }

  public teleport(p: Vector3): void {
    this.mode = 'ground';
    this.pos.copyFrom(p);
    this.vel.setAll(0);
    this.up.copyFrom(WORLD_UP);
    this.surface = null;
    this.airHeight = 0; this.vy = 0; this.landing = 0;
    this.player.setUp(this.up);
    this.player.velocity.setAll(0);
    this.player.place(this.pos, 0);
  }

  public update(dt: number, input: MoveInput, reality: RealityId, allowed: boolean): void {
    this.landing = Math.max(0, this.landing - dt * 3);
    const mx = allowed ? input.x : 0, my = allowed ? input.y : 0;
    const speed = !allowed ? 0 : input.run ? this.player.runSpeed : input.slow ? this.player.slowSpeed : this.player.walkSpeed;
    const f = this.axes.forward, r = this.axes.right;
    const wx = r.x * mx - f.x * my, wz = r.y * mx - f.y * my;
    let walked = 0;

    switch (this.mode) {
      case 'ground':
      case 'air': {
        const k = damp(this.mode === 'air' ? 2.5 : (wx * wx + wz * wz > 0.01 ? 7 : 10), dt);
        this.vel.x += (wx * speed - this.vel.x) * k;
        this.vel.z += (wz * speed - this.vel.z) * k;
        this.prev.copyFrom(this.pos);
        this.next.set(this.pos.x + this.vel.x * dt, this.pos.y, this.pos.z + this.vel.z * dt);
        const res = this.grid.resolve(this.prev, this.next, reality, this.airHeight);
        if (res.blockedX) this.vel.x = 0;
        if (res.blockedZ) this.vel.z = 0;
        walked = Math.hypot(this.next.x - this.pos.x, this.next.z - this.pos.z);
        const ground = this.grid.heightAt(this.next.x, this.next.z);
        this.pos.x = this.next.x; this.pos.z = this.next.z;

        if (this.mode === 'ground') {
          this.pos.y += (ground - this.pos.y) * damp(18, dt);
          if (input.jump && allowed) this.startJumpOrVault(reality);
          else if (allowed) { const sf = this.wantsSurface(wx, wz, reality); if (sf) this.startToWall(sf); }
        } else {
          this.vy -= GRAVITY * dt;
          this.airHeight = Math.max(0, this.airHeight + this.vy * dt);
          this.pos.y = ground + this.airHeight;
          if (this.airHeight <= 0 && this.vy < 0) {
            const impact = Math.min(1, -this.vy / 6);
            this.mode = 'ground'; this.vy = 0;
            this.landing = 0.4 + impact * 0.6;
            if (this.onLand) this.onLand(impact);
          }
          walked *= 0.15; // feet do not plant in the air
        }
        this.vel.y = this.mode === 'air' ? this.vy : 0;
        break;
      }
      case 'vault': {
        this.vaultT = Math.min(1, this.vaultT + dt / VAULT_TIME);
        const t = this.vaultT;
        const before = this.pos.clone();
        Vector3.LerpToRef(this.vaultFrom, this.vaultTo, t, this.pos);
        this.pos.y = this.grid.heightAt(this.pos.x, this.pos.z) + Math.sin(t * Math.PI) * 0.62;
        this.vel.copyFrom(this.pos).subtractInPlace(before).scaleInPlace(1 / Math.max(dt, 1e-4));
        walked = 0;
        if (t >= 1) {
          this.mode = 'ground'; this.vaultT = 0;
          this.landing = 0.45;
          if (this.onLand) this.onLand(0.35);
        }
        break;
      }
      case 'toWall':
      case 'fromWall': {
        this.transT = Math.min(1, this.transT + dt / WALL_TRANSITION);
        const t = this.transT * this.transT * (3 - 2 * this.transT);
        Vector3.LerpToRef(this.transFrom, this.transTo, t, this.pos);
        Vector3.LerpToRef(this.upFrom, this.upTo, t, this.up);
        this.up.normalize();
        this.vel.setAll(0);
        if (this.transT >= 1) {
          if (this.mode === 'toWall') { this.mode = 'wall'; if (this.onEnterWall) this.onEnterWall(); }
          else { this.mode = 'ground'; this.surface = null; if (this.onLeaveWall) this.onLeaveWall(); }
        }
        break;
      }
      case 'wall': {
        const sf = this.surface!;
        const sid = sf.s.id;
        const fi = faceInput(sf, mx, my, r, f);
        const du = fi.du * speed, dv = fi.dv * speed;
        const k = damp(du * du + dv * dv > 0.01 ? 7 : 10, dt);
        this.faceVel.x += (du - this.faceVel.x) * k;
        this.faceVel.y += (dv - this.faceVel.y) * k;
        const pu = this.wallU, pv = this.wallV;
        const n = { u: this.wallU + this.faceVel.x * dt, v: Math.max(0, this.wallV + this.faceVel.y * dt) };
        this.grid.resolveWall(pu, pv, n, sid);
        if (n.u === pu) this.faceVel.x = 0;
        if (n.v === pv) this.faceVel.y = 0;
        walked = Math.hypot(n.u - pu, n.v - pv);
        this.wallU = n.u; this.wallV = n.v;
        this.facePoint(sf, this.wallU, this.wallV, 0.02, this.pos);
        // World velocity on the face (animation and camera read it)
        this.vel.copyFrom(sf.u).scaleInPlace(this.faceVel.x).addInPlace(this.tmpW.copyFrom(sf.v).scaleInPlace(this.faceVel.y));
        // Stepping back down onto ground at the foot of the face: input pointing down the face
        if (allowed && this.wallV < 0.25 && fi.dv < -0.3 && this.grid.wallFootHasGround(this.wallU, sid)) this.startFromWall();
        break;
      }
    }
    this.player.velocity.copyFrom(this.vel);
    this.player.setUp(this.up);
    this.player.place(this.pos, walked);
  }

  /** A surface wants the protagonist when they walk into its face inside its entry region, in its reality. */
  private wantsSurface(wx: number, wz: number, reality: RealityId): SurfaceFrame | null {
    const s = this.grid.surfaceEntryAt(this.pos.x, this.pos.z);
    if (!s || (s.realities & realityBit(reality)) === 0) return null;
    const f = SURFACE_FRAMES[s.id];
    // Pushing into the face: against its normal
    return -(wx * f.normal.x + wz * f.normal.z) > 0.35 ? f : null;
  }

  /** World point on a face at (u, v), lifted `lift` metres off it. */
  private facePoint(f: SurfaceFrame, u: number, v: number, lift: number, out: Vector3): Vector3 {
    return out.copyFrom(f.origin)
      .addInPlace(this.tmpW.copyFrom(f.u).scaleInPlace(u))
      .addInPlace(this.tmpW.copyFrom(f.v).scaleInPlace(v))
      .addInPlace(this.tmpW.copyFrom(f.normal).scaleInPlace(lift));
  }

  private startToWall(f: SurfaceFrame): void {
    this.mode = 'toWall';
    this.surface = f;
    this.transT = 0;
    this.faceVel.set(0, 0);
    this.transFrom.copyFrom(this.pos);
    // The entry point is clamped onto the walkable face
    const along = Vector3.Dot(this.tmpW.copyFrom(this.pos).subtractInPlace(f.origin), f.u);
    this.wallU = Math.min(f.s.walk.u1 - 0.5, Math.max(f.s.walk.u0 + 0.5, along));
    this.wallV = 0.35;
    this.facePoint(f, this.wallU, this.wallV, 0.02, this.transTo);
    this.upFrom.copyFrom(WORLD_UP);
    this.upTo.copyFrom(f.normal);
  }

  private startFromWall(): void {
    const f = this.surface!;
    this.mode = 'fromWall';
    this.transT = 0;
    this.transFrom.copyFrom(this.pos);
    this.facePoint(f, this.wallU, 0, 0.7, this.transTo);
    this.upFrom.copyFrom(f.normal);
    this.upTo.copyFrom(WORLD_UP);
  }

  /** Called if the wall's gravity must end while the protagonist is on it (never in normal play). */
  public forceOffWall(): void {
    if (this.onWall) this.startFromWall();
  }

  private startJumpOrVault(reality: RealityId): void {
    // Vault if a designated low obstacle is just ahead in the direction of travel
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const dx = sp > 0.3 ? this.vel.x / sp : this.player.forward.x;
    const dz = sp > 0.3 ? this.vel.z / sp : this.player.forward.z;
    const target = this.grid.vaultTarget(this.pos, dx, dz, reality);
    if (target) {
      this.mode = 'vault';
      this.vaultT = 0;
      this.vaultFrom.copyFrom(this.pos);
      this.vaultTo.copyFrom(target);
      if (this.onVault) this.onVault();
      return;
    }
    this.mode = 'air';
    this.vy = JUMP_SPEED;
    this.airHeight = 0.001;
    if (this.onJump) this.onJump();
  }
}
