import { Vector3 } from '@babylonjs/core';
import {
  PATH, PATH_RADIUS, START, START_CLEARING_RADIUS, TRACK_HALF_WIDTH, BED_HALF_WIDTH,
  TRACK_START_Z, GAP_NEAR_Z, GAP_FAR_Z, TRACK_END_Z, CROSSING, BARRIER, SINKHOLE, WALL, VAULTS,
  GROUND_Y, BED_Y, BRIDGE_Y, segDist, GRAVITY_SURFACES, FACADE, VILLAGE, VILLAGE_ROUTE
} from './layout';
import type { Pt, GravitySurface } from './layout';
import { R_ALL, realityBit } from '../core/Reality';
import type { RealityId } from '../core/Reality';

export enum Surface { NONE = 0, SOIL = 1, GRAVEL = 2, PHASE = 3, STONE = 4 }

export interface Obstacle {
  kind: 'circle' | 'box';
  x: number; z: number; r: number;                 // circle
  x0: number; z0: number; x1: number; z1: number;  // box
  realities: number;                               // which realities it blocks in
  low?: number;                                    // top height: can be cleared from above / vaulted
}

export interface MoveResult { blockedX: boolean; blockedZ: boolean; }

/**
 * Walkability, surface and height for the ground at 0.5 m resolution, plus a
 * second small grid for the face of the Deranged wall. Each cell stores the set of
 * realities it exists in, so "can I stand here?" is one lookup for any reality.
 * Configuration-specific routes are data here, not per-mesh behaviour.
 */
export class WalkGrid {
  public readonly res = 0.5;
  public readonly minX = -32;
  public readonly minZ = -24;
  public readonly w: number;
  public readonly h: number;
  private flags: Uint8Array;
  private surface: Uint8Array;
  private height: Float32Array;
  private segment: Uint8Array;
  public obstacles: Obstacle[] = [];
  public readonly radius = 0.22;

  // One face grid per gravity surface: u along the face, v up it from its foot
  private faces: { s: GravitySurface; w: number; h: number; mask: Uint8Array }[] = [];

  constructor() {
    this.w = Math.ceil(64 / this.res);
    this.h = Math.ceil(340 / this.res);
    const n = this.w * this.h;
    this.flags = new Uint8Array(n);
    this.surface = new Uint8Array(n);
    this.height = new Float32Array(n).fill(GROUND_Y);
    this.segment = new Uint8Array(n);
    this.paintChapter();
    this.paintVillage();
    for (const sf of GRAVITY_SURFACES) this.paintFace(sf);
  }

  private idx(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / this.res);
    const j = Math.floor((z - this.minZ) / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  private forCells(x0: number, z0: number, x1: number, z1: number, fn: (k: number, cx: number, cz: number) => void): void {
    for (let cz = z0 + this.res * 0.5; cz < z1; cz += this.res) {
      for (let cx = x0 + this.res * 0.5; cx < x1; cx += this.res) {
        const k = this.idx(cx, cz);
        if (k >= 0) fn(k, cx, cz);
      }
    }
  }

  private paintChapter(): void {
    const inPath = (x: number, z: number) => {
      if (Math.hypot(x - START.x, z - START.z) <= START_CLEARING_RADIUS) return true;
      for (let i = 0; i < PATH.length - 1; i++) {
        if (segDist(x, z, PATH[i], PATH[i + 1]) <= PATH_RADIUS) return true;
      }
      return false;
    };
    this.forCells(-32, -24, 4, 20, (k, x, z) => {
      if (inPath(x, z)) { this.flags[k] = R_ALL; this.surface[k] = Surface.SOIL; }
    });

    const paintTrack = (z0: number, z1: number) => {
      this.forCells(-TRACK_HALF_WIDTH, z0, TRACK_HALF_WIDTH, z1, (k, x, z) => {
        if (z > SINKHOLE.z0 && z < SINKHOLE.z1) return;
        this.flags[k] = R_ALL;
        const onBed = Math.abs(x) < BED_HALF_WIDTH;
        this.surface[k] = onBed ? Surface.GRAVEL : Surface.SOIL;
        this.height[k] = onBed ? BED_Y : GROUND_Y;
      });
    };
    paintTrack(TRACK_START_Z, GAP_NEAR_Z);
    paintTrack(GAP_FAR_Z, TRACK_END_Z);
    // Ground at the wall's foot, either side of the sinkhole
    for (const [z0, z1] of WALL.baseZ) {
      this.forCells(WALL.x + 0.2, z0, -TRACK_HALF_WIDTH, z1, (k) => {
        this.flags[k] = R_ALL; this.surface[k] = Surface.STONE; this.height[k] = GROUND_Y;
      });
    }

    // Ground at the facade's foot (the shoulder widened up to the house front)
    this.forCells(FACADE.ground.x0, FACADE.z0, FACADE.ground.x1, FACADE.z1, (k) => {
      this.flags[k] = R_ALL; this.surface[k] = Surface.STONE; this.height[k] = GROUND_Y;
    });

    // Crossing segments are OR-ed in, so their overlaps exist in every reality either side allows
    for (const seg of CROSSING) {
      this.forCells(-seg.halfWidth, seg.z0, seg.halfWidth, seg.z1, (k) => {
        const wasEmpty = this.flags[k] === 0;
        this.flags[k] |= seg.realities;
        if (wasEmpty) {
          this.surface[k] = Surface.PHASE;
          this.height[k] = BRIDGE_Y;
          this.segment[k] = seg.id;
        }
      });
    }

    this.obstacles.push({
      kind: 'box', x: 0, z: 0, r: 0,
      x0: -TRACK_HALF_WIDTH - 1, z0: BARRIER.z0, x1: TRACK_HALF_WIDTH + 1, z1: BARRIER.z1,
      realities: BARRIER.realities
    });
    for (const v of VAULTS) {
      this.obstacles.push({ kind: 'box', x: 0, z: 0, r: 0, x0: v.x0, z0: v.z0, x1: v.x1, z1: v.z1, realities: R_ALL, low: v.height });
    }
  }

  /** The village square, its paths and the Void-only spans across the ravine. */
  private paintVillage(): void {
    const sq = VILLAGE.square;
    this.forCells(sq.x - sq.r, sq.z - sq.r, sq.x + sq.r, sq.z + sq.r, (k, x, z) => {
      if (Math.hypot(x - sq.x, z - sq.z) <= sq.r) { this.flags[k] |= R_ALL; this.surface[k] = Surface.SOIL; }
    });
    for (const p of VILLAGE_ROUTE) {
      const x0 = Math.min(p.a.x, p.b.x) - p.r, x1 = Math.max(p.a.x, p.b.x) + p.r;
      const z0 = Math.min(p.a.z, p.b.z) - p.r, z1 = Math.max(p.a.z, p.b.z) + p.r;
      this.forCells(x0, z0, x1, z1, (k, x, z) => {
        if (segDist(x, z, p.a, p.b) > p.r) return;
        const wasEmpty = this.flags[k] === 0;
        this.flags[k] |= p.realities;
        if (wasEmpty) {
          this.surface[k] = p.realities === R_ALL ? Surface.SOIL : Surface.PHASE;
          if (p.realities !== R_ALL) { this.height[k] = BRIDGE_Y; this.segment[k] = p.id; }
        }
      });
    }
    // The houses are solid wherever they exist
    for (const h of VILLAGE.houses) {
      const turned = Math.abs(Math.sin(h.yaw)) > 0.5;
      const hw = (turned ? h.d : h.w) / 2, hd = (turned ? h.w : h.d) / 2;
      this.obstacles.push({ kind: 'box', x: 0, z: 0, r: 0, x0: h.x - hw, z0: h.z - hd, x1: h.x + hw, z1: h.z + hd, realities: h.realities });
    }
  }

  private paintFace(sf: GravitySurface): void {
    const w = Math.ceil((sf.u1 - sf.u0) / this.res), h = Math.ceil(sf.height / this.res);
    const mask = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const u = sf.u0 + (i + 0.5) * this.res, v = (j + 0.5) * this.res;
        const onFace = u > sf.walk.u0 && u < sf.walk.u1 && v < sf.walk.v1;
        const inHole = sf.holes.some(o => u > o.u0 && u < o.u1 && v > o.v0 && v < o.v1);
        mask[j * w + i] = onFace && !inHole ? 1 : 0;
      }
    }
    this.faces[sf.id] = { s: sf, w, h, mask };
  }

  public addCircle(x: number, z: number, r: number): void {
    this.obstacles.push({ kind: 'circle', x, z, r, x0: 0, z0: 0, x1: 0, z1: 0, realities: R_ALL });
  }

  public isWalkable(x: number, z: number, reality: RealityId): boolean {
    const k = this.idx(x, z);
    if (k < 0) return false;
    return (this.flags[k] & realityBit(reality)) !== 0;
  }

  public realitiesAt(x: number, z: number): number {
    const k = this.idx(x, z);
    return k < 0 ? 0 : this.flags[k];
  }

  public surfaceAt(x: number, z: number): Surface {
    const k = this.idx(x, z);
    return k < 0 ? Surface.NONE : this.surface[k];
  }

  public heightAt(x: number, z: number): number {
    const k = this.idx(x, z);
    return k < 0 ? GROUND_Y : this.height[k];
  }

  public segmentAt(x: number, z: number): number {
    const k = this.idx(x, z);
    return k < 0 ? 0 : this.segment[k];
  }

  public recoveryFor(segmentId: number): Pt {
    const seg = CROSSING.find(s => s.id === segmentId) ?? VILLAGE_ROUTE.find(s => s.id === segmentId);
    return seg ? seg.recovery : BARRIER.recovery;
  }

  private footprintFree(x: number, z: number, reality: RealityId, airHeight = 0, ignore: Obstacle | null = null): boolean {
    const r = this.radius;
    if (!this.isWalkable(x - r, z - r, reality) || !this.isWalkable(x + r, z - r, reality) ||
        !this.isWalkable(x - r, z + r, reality) || !this.isWalkable(x + r, z + r, reality)) {
      return false;
    }
    const bit = realityBit(reality);
    for (const o of this.obstacles) {
      if ((o.realities & bit) === 0 || o === ignore) continue;
      if (o.low !== undefined && airHeight > o.low - 0.05) continue;
      if (o.kind === 'circle') {
        const dx = x - o.x, dz = z - o.z, rr = o.r + r;
        if (dx * dx + dz * dz < rr * rr) return false;
      } else if (x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r) {
        return false;
      }
    }
    return true;
  }

  /** Axis-separated move with sliding on the ground. Mutates next. */
  public resolve(prev: Vector3, next: Vector3, reality: RealityId, airHeight = 0): MoveResult {
    const res: MoveResult = { blockedX: false, blockedZ: false };
    if (!this.footprintFree(next.x, prev.z, reality, airHeight)) { next.x = prev.x; res.blockedX = true; }
    if (!this.footprintFree(next.x, next.z, reality, airHeight)) { next.z = prev.z; res.blockedZ = true; }
    return res;
  }

  /**
   * If a low obstacle lies within reach ahead (direction dx, dz), returns the
   * landing point beyond it, provided the protagonist can stand there; else null.
   */
  public vaultTarget(pos: Vector3, dx: number, dz: number, reality: RealityId): Vector3 | null {
    for (const o of this.obstacles) {
      if (o.low === undefined || o.kind !== 'box') continue;
      if (!(pos.x > o.x0 && pos.x < o.x1)) continue;
      // Only along the obstacle's thin axis (Z), approaching it
      const toNear = dz > 0 ? o.z0 - pos.z : pos.z - o.z1;
      if (Math.abs(dz) < 0.5 || toNear < -0.05 || toNear > 1.1) continue;
      const land = new Vector3(pos.x, pos.y, dz > 0 ? o.z1 + 0.5 : o.z0 - 0.5);
      if (this.footprintFree(land.x, land.z, reality, 0, o)) return land;
    }
    return null;
  }

  /** True if the protagonist could stand at pos in that reality (centre + obstacles). */
  public canStand(pos: Vector3, reality: RealityId): boolean {
    return this.isWalkable(pos.x, pos.z, reality) && this.insideActiveObstacle(pos, reality) === null;
  }

  public lostGround(pos: Vector3, reality: RealityId): boolean {
    return !this.isWalkable(pos.x, pos.z, reality);
  }

  public insideActiveObstacle(pos: Vector3, reality: RealityId): Obstacle | null {
    const bit = realityBit(reality);
    for (const o of this.obstacles) {
      if ((o.realities & bit) === 0) continue;
      if (o.kind === 'box' && pos.x > o.x0 && pos.x < o.x1 && pos.z > o.z0 - this.radius && pos.z < o.z1 + this.radius) return o;
    }
    return null;
  }

  // --- Gravity surfaces --------------------------------------------------------

  /** The surface whose entry region contains this ground point, if any. */
  public surfaceEntryAt(x: number, z: number): GravitySurface | null {
    for (const f of this.faces) {
      const e = f.s.entry;
      if (x >= e.x0 && x <= e.x1 && z >= e.z0 && z <= e.z1) return f.s;
    }
    return null;
  }

  public wallWalkable(u: number, v: number, surface = 0): boolean {
    const f = this.faces[surface];
    if (!f) return false;
    const i = Math.floor((u - f.s.u0) / this.res), j = Math.floor(v / this.res);
    if (v < 0) return true; // stepping off the bottom edge is handled by the controller
    if (i < 0 || j < 0 || i >= f.w || j >= f.h) return false;
    return f.mask[j * f.w + i] === 1;
  }

  /** Axis-separated move on a face. Mutates next. */
  public resolveWall(prevU: number, prevV: number, next: { u: number; v: number }, surface = 0): void {
    const r = this.radius;
    const free = (u: number, v: number) =>
      this.wallWalkable(u - r, v + r, surface) && this.wallWalkable(u + r, v + r, surface) &&
      this.wallWalkable(u - r, Math.max(0, v - r) + 0.01, surface) && this.wallWalkable(u + r, Math.max(0, v - r) + 0.01, surface);
    if (!free(next.u, prevV)) next.u = prevU;
    if (!free(next.u, next.v)) next.v = prevV;
  }

  /** Ground exists at the face's foot at this point along it. */
  public wallFootHasGround(u: number, surface = 0): boolean {
    const f = this.faces[surface];
    return !!f && f.s.feet.some(([z0, z1]) => u > z0 + 0.3 && u < z1 - 0.3);
  }
}
