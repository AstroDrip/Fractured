import { Scene, Mesh, VertexData } from '@babylonjs/core';
import { mulberry32 } from '../core/rng';

/**
 * The grass family. Each clump is a handful of broad, tapering blades bent along a
 * curve (three segments, width falling to a point), not upright needles. Four kinds:
 *  - tuft:   low, wide, drooping; the common damp ground cover
 *  - tall:   few long blades, heavily bent; stands out of the tufts in places
 *  - dead:   blades lying almost flat, splayed; straw-coloured patches
 *  - sedge:  dense and more upright, broad leaves; wet hollows, ditches
 * Clumps are single meshes drawn as thin instances; the world material's sway reads
 * height in mesh space, so bent tips move most and roots not at all.
 */
export type GrassKind = 'tuft' | 'tall' | 'dead' | 'sedge';

interface KindSpec { blades: number; len: [number, number]; width: [number, number]; bend: [number, number]; lean: [number, number]; spread: number; }
const KINDS: Record<GrassKind, KindSpec> = {
  tuft: { blades: 9, len: [0.16, 0.3], width: [0.035, 0.05], bend: [0.5, 1.0], lean: [0.35, 0.8], spread: 0.08 },
  tall: { blades: 5, len: [0.4, 0.62], width: [0.03, 0.042], bend: [0.8, 1.5], lean: [0.2, 0.55], spread: 0.06 },
  dead: { blades: 8, len: [0.2, 0.36], width: [0.03, 0.045], bend: [0.3, 0.6], lean: [1.0, 1.35], spread: 0.1 },
  sedge: { blades: 12, len: [0.26, 0.42], width: [0.045, 0.065], bend: [0.25, 0.6], lean: [0.1, 0.4], spread: 0.05 }
};

export function grassClump(scene: Scene, kind: GrassKind, seed: number): Mesh {
  const k = KINDS[kind], r = mulberry32(seed);
  const pos: number[] = [], idx: number[] = [], nrm: number[] = [];
  const lerp = (a: [number, number]) => a[0] + (a[1] - a[0]) * r();
  const SEG = 3;
  for (let b = 0; b < k.blades; b++) {
    const yaw = (b / k.blades) * Math.PI * 2 + (r() - 0.5) * 0.9;
    const off = r() * k.spread;
    const ox = Math.cos(yaw) * off, oz = Math.sin(yaw) * off;
    const len = lerp(k.len), w = lerp(k.width), bend = lerp(k.bend), lean = lerp(k.lean);
    // Blade frame: out along yaw, the face turned slightly so clumps never read as flat cards
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const twist = (r() - 0.5) * 0.8;
    const sx = -dz * Math.cos(twist), sz = dx * Math.cos(twist), sy = Math.sin(twist) * 0.3;
    const v0 = pos.length / 3;
    let px = ox, py = 0, pz = oz;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      // The angle from vertical grows along the blade: it leans, then droops
      const ang = lean + bend * t * t;
      const half = w * (1 - t * 0.92) * 0.5;
      pos.push(px - sx * half, py - sy * half, pz - sz * half, px + sx * half, py + sy * half, pz + sz * half);
      if (i < SEG) {
        const step = len / SEG;
        px += dx * Math.sin(ang) * step; pz += dz * Math.sin(ang) * step; py += Math.cos(ang) * step;
        py = Math.max(py, 0.004 * (i + 1));
      }
    }
    for (let i = 0; i < SEG; i++) {
      const a = v0 + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  VertexData.ComputeNormals(pos, idx, nrm);
  // Grass is lit mostly from above whatever its blades' faces do: bias normals upward
  for (let i = 0; i < nrm.length; i += 3) {
    const nx = nrm[i] * 0.4, ny = Math.abs(nrm[i + 1]) * 0.4 + 0.6, nz = nrm[i + 2] * 0.4, l = Math.hypot(nx, ny, nz);
    nrm[i] = nx / l; nrm[i + 1] = ny / l; nrm[i + 2] = nz / l;
  }
  const vd = new VertexData();
  vd.positions = pos; vd.indices = idx; vd.normals = nrm;
  const m = new Mesh('grass_' + kind, scene);
  vd.applyToMesh(m);
  m.isPickable = false;
  return m;
}

/** Restrained colours per kind: damp olive-brown living grass, straw, dark wet sedge. */
export function grassColor(kind: GrassKind, v: number, cold: number): [number, number, number] {
  let c: [number, number, number];
  if (kind === 'dead') c = [0.26 + v * 0.05, 0.22 + v * 0.04, 0.15 + v * 0.03];
  else if (kind === 'sedge') c = [0.13 + v * 0.03, 0.15 + v * 0.04, 0.1 + v * 0.02];
  else if (kind === 'tall') c = [0.2 + v * 0.05, 0.19 + v * 0.05, 0.12 + v * 0.02];
  else c = [0.17 + v * 0.05, 0.17 + v * 0.05, 0.11 + v * 0.03];
  // Past the gap: the same grass, drained of warmth
  const l = (c[0] + c[1] + c[2]) / 3;
  return [c[0] + (l - c[0]) * cold, c[1] + (l - c[1]) * cold, c[2] + (l * 1.08 - c[2]) * cold];
}
