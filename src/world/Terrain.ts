import { Scene, Mesh, VertexData, StandardMaterial } from '@babylonjs/core';
import { fbm2, hash2, smoothstep } from '../core/rng';
import type { WalkGrid } from './WalkGrid';
import {
  walkDistance, inGap, GROUND_Y, BED_Y, BED_HALF_WIDTH, TRACK_HALF_WIDTH, TRACK_START_Z,
  GAP_NEAR_Z, GAP_FAR_Z, TRACK_END_Z, WORLD_END_Z, BURIED_MOUND, PATH, SINKHOLE, segDist, ravineDepth,
  CUTTING, cuttingAt, FOREST, forestAt, ANCHOR, anchorSpurDist
} from './layout';

const NONE = -999;
const LAT = 0.5;   // sculpted surface lattice (m)
const ABYSS_FLOOR = -16;

/**
 * The ground of every region but the rift. Heights are authored per 1 m cell (walkable
 * ground flat at its route height; embankments, plateaus and cliffs around it), then
 * shaped into one continuous sculpted surface (see buildLattice). The gap, the sinkhole
 * and the world's end are holes whose cliff walls fall into fog.
 */
export class Terrain {
  public readonly minX = -48;   // the rift (x < -28.4) is not part of this voxel field
  public readonly maxX = 30;
  public readonly minZ = -24;
  public readonly maxZ = 316;
  private heights: Float32Array;
  private w: number;
  private h: number;
  // The sculpted lattice (0.5 m), one ring wider than the cells
  private lat: Float32Array = new Float32Array(0);
  private lw = 0;
  private lh = 0;
  public meshes: Mesh[] = [];

  constructor(private scene: Scene, private material: StandardMaterial, private grid?: WalkGrid) {
    this.w = this.maxX - this.minX + 1;
    this.h = this.maxZ - this.minZ + 1;
    this.heights = new Float32Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        this.heights[j * this.w + i] = this.computeHeight(this.minX + i, this.minZ + j);
      }
    }
  }

  private computeHeight(x: number, z: number): number {
    if (inGap(z) || z > WORLD_END_Z) return NONE;
    if (z > SINKHOLE.z0 && z < SINKHOLE.z1 && x > SINKHOLE.x0 && x < SINKHOLE.x1) return NONE;
    if (x < FOREST.edgeX && z > 92 && z < 140) return NONE;          // the rift has its own continuous terrain
    // The forest: walkways at their height, rolling ground between, rising toward the
    // cliff; west of the edge the land simply ends
    const fb = FOREST.bounds;
    if (x > fb.x0 - 16 && x < fb.x1 && z > fb.z0 + 4 && z < fb.z1) {
      if (x < FOREST.edgeX && z > 92) return NONE;   // west of the edge: the rift's own terrain
      const f = forestAt(x, z);
      if (f.d <= 0.6) return Math.round(f.h * 4) / 4;
      if (z > fb.z0 + 9 || x < -18) {
        const roll = (Math.sin(x * 0.31 + z * 0.17) + Math.sin(z * 0.43 - x * 0.12)) * 0.35 + hash2(x, z, 61) * 0.2;
        const rise = Math.max(0, (z - 92) * 0.12) + Math.max(0, (-x - 16) * 0.08);
        let hgt = Math.max(GROUND_Y, f.h - 0.2 - Math.min(1.2, f.d * 0.15)) + roll + rise * (f.d > 2 ? 1 : 0.5);
        // Nothing round the overlook stands above it: the view and the protagonist stay clear
        const ov = FOREST.overlook;
        if (Math.hypot(x - ov.x, z - ov.z) < 9) hgt = Math.min(hgt, GROUND_Y + 4.2 - 0.3);
        return Math.round(hgt * 4) / 4;
      }
    }
    // The cutting: route height on the path, a cliff to the west, a cleft for the stream
    const cb = CUTTING.bounds;
    if (x > cb.x0 && x < cb.x1 && z > cb.z0 && z < cb.z1) {
      const cl = CUTTING.cleft;
      if (z > cl.z0 && z < cl.z1 && x < cl.x1) return GROUND_Y - cl.depth;
      const q = cuttingAt(x, z);
      if (q.d <= CUTTING.radius + 0.5) return Math.round(q.h * 4) / 4;
      if (anchorSpurDist(x, z) <= ANCHOR.spur.r + 0.4) return Math.round(ANCHOR.spur.h * 4) / 4;   // the ledge
      if (x < CUTTING.cliff.x) {
        // The face: steps up in broken courses to the top
        const up = Math.min(CUTTING.cliff.top, 2.5 + (CUTTING.cliff.x - x) * 1.6 + hash2(x, z, 41) * 1.2);
        return Math.round((GROUND_Y + up) * 2) / 2;
      }
      // Between the shelf and the line: a rough embankment falling from the shelf
      const fall = Math.max(0, q.h - GROUND_Y) * Math.max(0, 1 - (q.d - CUTTING.radius) / 6);
      return Math.round((GROUND_Y + fall) * 2) / 2;
    }
    // The ravine under the Void-only path: a real drop where no path exists in Normal
    const rav = ravineDepth(x, z);
    if (rav > 0) return Math.round((GROUND_Y - 1.5 - rav * 4) * 4) / 4;
    const d = walkDistance(x, z);
    const onTrackZ = (z >= TRACK_START_Z && z <= GAP_NEAR_Z) || (z >= GAP_FAR_Z && z <= TRACK_END_Z + 4);
    if (d <= 0.75) {
      if (onTrackZ && Math.abs(x) <= 1) return BED_Y;
      return GROUND_Y;
    }
    // Track bed continues (visibly) back into the earth heap and past the buffer stop
    if (Math.abs(x) <= 1 && (z < TRACK_START_Z && z > TRACK_START_Z - 40 || z > TRACK_END_Z)) {
      const heap = z >= BURIED_MOUND.z0 && z <= BURIED_MOUND.z1 ? 1.75 : 0;
      return Math.max(BED_Y, BED_Y + heap);
    }
    // Broad plateaus rather than contour lines: low-frequency noise picks one of a few
    // levels, flat near the route so the camera is never blocked; land rises only far out
    const n = fbm2(x * 0.055, z * 0.055, 7);
    const level = d < 3 ? 0 : n < 0.47 ? 0 : n < 0.6 ? 0.5 : n < 0.7 ? 1.0 : 1.5;
    let hgt = GROUND_Y + level + Math.floor(Math.max(0, d - 14) * 0.25) * 0.5;
    // Drainage ditches along the railway
    const ax = Math.abs(x);
    if (onTrackZ && ax > TRACK_HALF_WIDTH + 1 && ax < TRACK_HALF_WIDTH + 3) hgt = GROUND_Y - 0.35;
    // Earth heap that swallows the rails behind the start of the walkable track
    if (z >= BURIED_MOUND.z0 && z <= BURIED_MOUND.z1 && ax < 5) hgt = Math.max(hgt, 2.0 + hash2(x, z, 3) * 0.5);
    // Cliff lips near the gap fall away slightly
    const toGap = Math.min(Math.abs(z - GAP_NEAR_Z), Math.abs(z - GAP_FAR_Z));
    if (toGap < 3 && d > 0.75) hgt -= (3 - toGap) * 0.35;
    return Math.round(hgt * 4) / 4;
  }

  /** The authored height of the 1 m cell containing (x, z) (what the surface is shaped from). */
  public cellHeight(x: number, z: number): number {
    const i = Math.round(x) - this.minX, j = Math.round(z) - this.minZ;
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return NONE;
    return this.heights[j * this.w + i];
  }

  /**
   * Height of the visible surface at (x, z): the sculpted lattice, interpolated across the
   * same two triangles the mesh draws, so flame contact and placed props sit on what is seen.
   */
  public heightAt(x: number, z: number): number {
    if (this.lat.length === 0) return this.cellHeight(x, z);
    const fx = (x - this.minX) / LAT + 1, fz = (z - this.minZ) / LAT + 1;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.lw - 1 || j >= this.lh - 1) return this.cellHeight(x, z);
    const a = this.lat[j * this.lw + i], b = this.lat[j * this.lw + i + 1];
    const c = this.lat[(j + 1) * this.lw + i], d = this.lat[(j + 1) * this.lw + i + 1];
    if (a === NONE || b === NONE || c === NONE || d === NONE) return this.cellHeight(x, z);
    const u = fx - i, v = fz - j;
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  private topColor(x: number, z: number, hgt: number): [number, number, number] {
    const n = fbm2(x * 0.21, z * 0.21, 13);
    const fine = fbm2(x * 1.1, z * 1.1, 17);         // continuous: no per-cell checker
    const d = walkDistance(x, z);
    let r = 0.19, g = 0.155, b = 0.115;              // dark soil
    const moss = smoothstep(0.58, 0.75, fbm2(x * 0.07, z * 0.07, 19)) * 0.7;
    r += (0.11 - r) * moss; g += (0.135 - g) * moss; b += (0.09 - b) * moss;
    const dry = smoothstep(1.5, 4, d) * smoothstep(0.35, 0.6, n);
    r += (0.21 - r) * dry; g += (0.19 - g) * dry; b += (0.13 - b) * dry;   // dead grass
    // Trodden dirt and ballast blend in over a metre: a hard switch sampled on the lattice
    // drew a staircase of diamonds along every diagonal path
    let pd = Infinity;
    for (let i = 0; i < PATH.length - 1; i++) pd = Math.min(pd, segDist(x, z, PATH[i], PATH[i + 1]));
    const trod = 1 - smoothstep(0.6, 1.5, pd);
    r += (0.2 - r) * trod; g += (0.165 - g) * trod; b += (0.12 - b) * trod;
    if (hgt >= BED_Y - 0.01 && hgt < 1) {
      const bal = 1 - smoothstep(BED_HALF_WIDTH - 0.3, BED_HALF_WIDTH + 0.5, Math.abs(x));
      r += (0.15 - r) * bal; g += (0.148 - g) * bal; b += (0.15 - b) * bal;
    }
    if (hgt < GROUND_Y - 0.2) { r *= 0.55; g *= 0.6; b *= 0.7; }  // wet ditch
    const k = 0.9 + n * 0.14 + (fine - 0.5) * 0.03;
    r *= k; g *= k; b *= k;
    // The far side of the gap: the same land, drained of warmth
    const cold = smoothstep(GAP_FAR_Z - 1, GAP_FAR_Z + 30, z);
    const lum = (r + g + b) / 3;
    r += (lum * 0.95 - r) * cold * 0.7; g += (lum * 1.0 - g) * cold * 0.7; b += (lum * 1.12 - b) * cold * 0.7;
    return [r, g, b];
  }

  /**
   * The sculpted surface. A 0.5 m lattice over the authored cells: a cell's centre keeps
   * its height exactly; points between cells blend their neighbours, except that a point
   * touching walkable ground takes the lowest walkable neighbour, so paths stay flat to
   * their edge and the slope happens beside them, never under the feet. Away from paths
   * the land gains broad, low irregularity. Holes (the gap, the sinkhole, the rift) keep
   * their cliff walls down to the abyss. Chunked every 40 m along Z for culling.
   */
  private buildLattice(): void {
    this.lw = (this.maxX - this.minX) * 2 + 3;
    this.lh = (this.maxZ - this.minZ) * 2 + 3;
    const lat = new Float32Array(this.lw * this.lh);
    for (let j = 0; j < this.lh; j++) {
      for (let i = 0; i < this.lw; i++) {
        lat[j * this.lw + i] = this.latticeHeight(this.minX + (i - 1) * LAT, this.minZ + (j - 1) * LAT);
      }
    }
    this.lat = lat;
  }

  private latticeHeight(x: number, z: number): number {
    // The (up to four) cells this point touches
    const xs = Math.abs(x - Math.round(x)) < 0.01 ? [x] : [x - 0.5, x + 0.5];
    const zs = Math.abs(z - Math.round(z)) < 0.01 ? [z] : [z - 0.5, z + 0.5];
    let sum = 0, n = 0, walkMin = Infinity, hasHole = false;
    for (const cx of xs) for (const cz of zs) {
      const h = this.cellHeight(cx, cz);
      if (h === NONE) { hasHole = true; continue; }
      sum += h; n++;
      // Walked-on ground (not a bridge, platform or trunk standing above it) holds the surface flat
      if (this.walkable(cx, cz) && Math.abs(this.grid!.heightAt(cx, cz) - h) < 0.35) walkMin = Math.min(walkMin, h);
    }
    if (n === 0) return NONE;
    if (walkMin < Infinity) return walkMin;
    let h = sum / n;
    // Broad, low irregularity away from anything walked on and from every edge
    if (!hasHole) {
      const k = this.awayFromWalk(x, z);
      h += ((fbm2(x * 0.16, z * 0.16, 23) - 0.5) * 0.7 + (fbm2(x * 0.6, z * 0.6, 29) - 0.5) * 0.12) * k;
    }
    return h;
  }

  private walkable(x: number, z: number): boolean {
    const g = this.grid;
    if (!g) return false;
    return g.isWalkable(x, z, 'normal') || g.isWalkable(x, z, 'void') || g.isWalkable(x, z, 'deranged');
  }

  /** 0 beside walkable ground, rising to 1 a couple of metres away. */
  private awayFromWalk(x: number, z: number): number {
    let d = 2.6;
    for (const r of [0.5, 1.0, 1.75, 2.5]) {
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]]) {
        if (this.walkable(x + dx, z + dz)) { d = r; break; }
      }
      if (d < 2.6) break;
    }
    return smoothstep(0.5, 2.5, d);
  }

  public build(): void {
    this.buildLattice();
    const chunk = 40;
    for (let z0 = this.minZ; z0 < this.maxZ; z0 += chunk) {
      const m = this.buildChunk(z0, Math.min(this.maxZ, z0 + chunk));
      if (m) this.meshes.push(m);
    }
  }

  private buildChunk(zA: number, zB: number): Mesh | null {
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const S = 0.3; // texture tiling per metre
    const j0 = Math.round((zA - this.minZ) / LAT) + 1, j1 = Math.min(this.lh - 1, Math.round((zB - this.minZ) / LAT) + 1);
    const lw = this.lw, lat = this.lat;
    const vid = new Int32Array((j1 - j0 + 1) * lw).fill(-1);
    const L = (i: number, j: number) => lat[j * lw + i];
    const vert = (i: number, j: number): number => {
      const k = (j - j0) * lw + i;
      if (vid[k] >= 0) return vid[k];
      const x = this.minX + (i - 1) * LAT, z = this.minZ + (j - 1) * LAT, h = L(i, j);
      const c = this.surfaceColor(x, z, h, i, j);
      vid[k] = pos.length / 3;
      pos.push(x, h, z); col.push(c[0], c[1], c[2], 1); uv.push(x * S, z * S);
      return vid[k];
    };
    const rock: [number, number, number] = [0.13, 0.125, 0.12];
    const wall = (ax: number, az: number, ah: number, bx: number, bz: number, bh: number) => {
      const v = pos.length / 3;
      for (const [x, y, z] of [[ax, ah, az], [bx, bh, bz], [bx, ABYSS_FLOOR, bz], [ax, ABYSS_FLOOR, az]]) {
        pos.push(x, y, z); col.push(rock[0], rock[1], rock[2], 1); uv.push((x + z) * S, y * S);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3, v, v + 2, v + 1, v, v + 3, v + 2);   // both faces
    };
    for (let j = j0; j < j1; j++) {
      for (let i = 0; i < lw - 1; i++) {
        const a = L(i, j), b = L(i + 1, j), c = L(i, j + 1), d = L(i + 1, j + 1);
        if (a !== NONE && b !== NONE && c !== NONE && d !== NONE) {
          const va = vert(i, j), vb = vert(i + 1, j), vc = vert(i, j + 1), vd = vert(i + 1, j + 1);
          idx.push(va, vb, vc, vb, vd, vc);   // clockwise from above: Babylon's front face
          continue;
        }
        // A quad at a hole's edge: walls down from each surviving edge
        const x0 = this.minX + (i - 1) * LAT, z0 = this.minZ + (j - 1) * LAT, x1 = x0 + LAT, z1 = z0 + LAT;
        if (a !== NONE && b !== NONE) wall(x0, z0, a, x1, z0, b);
        if (c !== NONE && d !== NONE) wall(x0, z1, c, x1, z1, d);
        if (a !== NONE && c !== NONE) wall(x0, z0, a, x0, z1, c);
        if (b !== NONE && d !== NONE) wall(x1, z0, b, x1, z1, d);
      }
    }
    if (idx.length === 0) return null;
    const mesh = new Mesh(`terrain_${zA}`, this.scene);
    const vd = new VertexData();
    const nrm: number[] = [];
    VertexData.ComputeNormals(pos, idx, nrm);
    vd.positions = pos; vd.normals = nrm; vd.colors = col; vd.uvs = uv; vd.indices = idx;
    vd.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = true;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  /** Ground colour, with slope: steep faces show pale strata, as in the rift. */
  private surfaceColor(x: number, z: number, h: number, i: number, j: number): [number, number, number] {
    const c = this.topColor(x, z, this.cellHeight(x, z));
    const L = (a: number, b: number) => { const v = this.lat[b * this.lw + a]; return v === NONE ? h : v; };
    const il = Math.max(0, i - 1), ir = Math.min(this.lw - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(this.lh - 1, j + 1);
    const slope = Math.abs(L(ir, j) - L(il, j)) + Math.abs(L(i, ju) - L(i, jd));
    const steep = smoothstep(0.6, 2.4, slope);
    const band = 0.5 + 0.5 * Math.sin(h * 2.6 + Math.sin(x * 0.3) * 0.6);
    const stone = [0.27 + band * 0.1, 0.26 + band * 0.095, 0.25 + band * 0.085];
    return [c[0] + (stone[0] - c[0]) * steep, c[1] + (stone[1] - c[1]) * steep, c[2] + (stone[2] - c[2]) * steep];
  }
}
