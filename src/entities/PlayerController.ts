import { Vector3 } from '@babylonjs/core';
import { WalkGrid } from '../world/WalkGrid';
import { Player } from './Player';
import { damp } from '../core/rng';
import { WALL, GROUND_Y } from '../world/layout';
import type { RealityId } from '../core/Reality';

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
const WALL_UP = new Vector3(1, 0, 0);   // the wall's face looks toward +X
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * The protagonist's movement. One controller owns position, velocity and the
 * local up for every mode, so movement, collision, animation and camera share a
 * single gravity frame:
 *  - ground: camera-relative walking/running with axis-separated sliding
 *  - air: a small hop relative to local up; lands with an impulse scaled by speed
 *  - vault: a scripted arc over a designated low obstacle, validated on both sides
 *  - toWall / wall / fromWall: in Deranged, gravity at the white wall turns toward
 *    its face; the protagonist walks the face in its own (u along, v up) coordinates
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
          else if (allowed && reality === 'deranged' && this.wantsWall(wx)) this.startToWall();
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
          else { this.mode = 'ground'; if (this.onLeaveWall) this.onLeaveWall(); }
        }
        break;
      }
      case 'wall': {
        // On the face: screen up climbs, screen right moves along +Z
        const du = mx * speed, dv = -my * speed;
        const k = damp(du * du + dv * dv > 0.01 ? 7 : 10, dt);
        this.vel.z += (du - this.vel.z) * k;
        this.vel.y += (dv - this.vel.y) * k;
        this.vel.x = 0;
        const pu = this.wallU, pv = this.wallV;
        const n = { u: this.wallU + this.vel.z * dt, v: Math.max(0, this.wallV + this.vel.y * dt) };
        this.grid.resolveWall(pu, pv, n);
        if (n.u === pu) this.vel.z = 0;
        if (n.v === pv) this.vel.y = 0;
        walked = Math.hypot(n.u - pu, n.v - pv);
        this.wallU = n.u; this.wallV = n.v;
        this.pos.set(WALL.x + 0.02, GROUND_Y + this.wallV, this.wallU);
        // Stepping back down onto ground at the foot of the wall
        if (allowed && this.wallV < 0.25 && my > 0.3 && this.grid.wallFootHasGround(this.wallU)) this.startFromWall();
        break;
      }
    }
    this.player.velocity.copyFrom(this.vel);
    this.player.setUp(this.up);
    this.player.place(this.pos, walked);
  }

  private wantsWall(wx: number): boolean {
    // Anywhere along the foot of the wall; the entry point is clamped onto the face
    return wx < -0.35 && this.pos.x < WALL.x + 0.8 && this.pos.z > WALL.z0 && this.pos.z < WALL.z1;
  }

  private startToWall(): void {
    this.mode = 'toWall';
    this.transT = 0;
    this.transFrom.copyFrom(this.pos);
    this.wallU = Math.min(WALL.walk.u1 - 0.5, Math.max(WALL.walk.u0 + 0.5, this.pos.z));
    this.wallV = 0.35;
    this.transTo.set(WALL.x + 0.02, GROUND_Y + this.wallV, this.wallU);
    this.upFrom.copyFrom(WORLD_UP);
    this.upTo.copyFrom(WALL_UP);
  }

  private startFromWall(): void {
    this.mode = 'fromWall';
    this.transT = 0;
    this.transFrom.copyFrom(this.pos);
    this.transTo.set(WALL.x + 0.7, GROUND_Y, this.wallU);
    this.upFrom.copyFrom(WALL_UP);
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
