import { Scene, Mesh, VertexData, StandardMaterial } from '@babylonjs/core';
import { fbm2, hash2, smoothstep } from '../core/rng';
import {
  walkDistance, inGap, GROUND_Y, BED_Y, BED_HALF_WIDTH, TRACK_HALF_WIDTH, TRACK_START_Z,
  GAP_NEAR_Z, GAP_FAR_Z, TRACK_END_Z, WORLD_END_Z, BURIED_MOUND, PATH, SINKHOLE, segDist
} from './layout';

const NONE = -999;
const ABYSS_FLOOR = -16;

/**
 * Stepped voxel heightfield. Cells are 1 m, centred on integer coordinates, and
 * heights are quantised to 0.25 m so the land reads as authored blocks rather
 * than a smooth mesh. Walkable ground is flat; everything else rises into
 * embankments that frame the route. The gap and the world's end are holes whose
 * cliff walls fall into fog.
 */
export class Terrain {
  public readonly minX = -48;
  public readonly maxX = 30;
  public readonly minZ = -24;
  public readonly maxZ = 316;
  private heights: Float32Array;
  private w: number;
  private h: number;
  public meshes: Mesh[] = [];

  constructor(private scene: Scene, private material: StandardMaterial) {
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

  public heightAt(x: number, z: number): number {
    const i = Math.round(x) - this.minX, j = Math.round(z) - this.minZ;
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return NONE;
    return this.heights[j * this.w + i];
  }

  private topColor(x: number, z: number, hgt: number): [number, number, number] {
    const n = fbm2(x * 0.21, z * 0.21, 13);
    const fine = hash2(x, z, 17);
    const d = walkDistance(x, z);
    let r = 0.19, g = 0.155, b = 0.115;              // dark soil
    const moss = smoothstep(0.58, 0.75, fbm2(x * 0.07, z * 0.07, 19)) * 0.7;
    r += (0.11 - r) * moss; g += (0.135 - g) * moss; b += (0.09 - b) * moss;
    const dry = smoothstep(1.5, 4, d) * smoothstep(0.35, 0.6, n);
    r += (0.21 - r) * dry; g += (0.19 - g) * dry; b += (0.13 - b) * dry;   // dead grass
    let onPath = false;
    for (let i = 0; i < PATH.length - 1; i++) if (segDist(x, z, PATH[i], PATH[i + 1]) < 1.0) onPath = true;
    if (onPath) { r = 0.2; g = 0.165; b = 0.12; }           // trodden dirt
    if (Math.abs(x) <= BED_HALF_WIDTH && hgt >= BED_Y - 0.01 && hgt < 1) { r = 0.15; g = 0.148; b = 0.15; } // ballast
    if (hgt < GROUND_Y - 0.2) { r *= 0.55; g *= 0.6; b *= 0.7; }  // wet ditch
    const k = 0.9 + n * 0.14 + (fine - 0.5) * 0.03;
    r *= k; g *= k; b *= k;
    // The far side of the gap: the same land, drained of warmth
    const cold = smoothstep(GAP_FAR_Z - 1, GAP_FAR_Z + 30, z);
    const lum = (r + g + b) / 3;
    r += (lum * 0.95 - r) * cold * 0.7; g += (lum * 1.0 - g) * cold * 0.7; b += (lum * 1.12 - b) * cold * 0.7;
    return [r, g, b];
  }

  /** Builds chunked meshes, one chunk per 40 m along Z for culling. */
  public build(): void {
    const chunk = 40;
    for (let z0 = this.minZ; z0 <= this.maxZ; z0 += chunk) {
      const m = this.buildChunk(z0, Math.min(this.maxZ, z0 + chunk - 1));
      if (m) this.meshes.push(m);
    }
  }

  private buildChunk(zA: number, zB: number): Mesh | null {
    const pos: number[] = [], nrm: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    let vc = 0;
    const quad = (p: number[][], n: number[], c: [number, number, number], uvs: number[][]) => {
      for (let k = 0; k < 4; k++) {
        pos.push(p[k][0], p[k][1], p[k][2]);
        nrm.push(n[0], n[1], n[2]);
        col.push(c[0], c[1], c[2], 1);
        uv.push(uvs[k][0], uvs[k][1]);
      }
      idx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    };
    const S = 0.3; // texture tiling per metre

    for (let z = zA; z <= zB; z++) {
      for (let x = this.minX; x <= this.maxX; x++) {
        const hgt = this.heightAt(x, z);
        if (hgt === NONE) continue;
        const c = this.topColor(x, z, hgt);
        const x0 = x - 0.5, x1 = x + 0.5, z0 = z - 0.5, z1 = z + 0.5;
        quad([[x0, hgt, z0], [x1, hgt, z0], [x1, hgt, z1], [x0, hgt, z1]], [0, 1, 0], c,
          [[x0 * S, z0 * S], [x1 * S, z0 * S], [x1 * S, z1 * S], [x0 * S, z1 * S]]);

        // Side walls down to each lower neighbour (or to the abyss floor)
        const sides: [number, number, number[][], number[]][] = [
          [x + 1, z, [[x1, 0, z1], [x1, 0, z0]], [1, 0, 0]],
          [x - 1, z, [[x0, 0, z0], [x0, 0, z1]], [-1, 0, 0]],
          [x, z + 1, [[x0, 0, z1], [x1, 0, z1]], [0, 0, 1]],
          [x, z - 1, [[x1, 0, z0], [x0, 0, z0]], [0, 0, -1]]
        ];
        for (const [nx, nz, e, n] of sides) {
          let nh = this.heightAt(nx, nz);
          const outside = nx < this.minX || nx > this.maxX || nz < this.minZ || nz > this.maxZ;
          if (outside) continue;
          if (nh === NONE) nh = ABYSS_FLOOR;
          if (nh >= hgt) continue;
          const depthDark = nh <= ABYSS_FLOOR ? 0.4 : 0.8;
          const sc: [number, number, number] = [c[0] * depthDark, c[1] * depthDark, c[2] * depthDark];
          const u0 = (e[0][0] + e[0][2]) * S, u1 = (e[1][0] + e[1][2]) * S;
          quad([[e[0][0], hgt, e[0][2]], [e[1][0], hgt, e[1][2]], [e[1][0], nh, e[1][2]], [e[0][0], nh, e[0][2]]],
            n, sc, [[u0, hgt * S], [u1, hgt * S], [u1, nh * S], [u0, nh * S]]);
        }
      }
    }
    if (vc === 0) return null;
    const mesh = new Mesh(`terrain_${zA}`, this.scene);
    const vd = new VertexData();
    vd.positions = pos; vd.normals = nrm; vd.colors = col; vd.uvs = uv; vd.indices = idx;
    vd.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = true;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    return mesh;
  }
}
