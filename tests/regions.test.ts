import { describe, it, expect } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import { WalkGrid, Surface } from '../src/world/WalkGrid';
import { VILLAGE, VILLAGE_ROUTE, GRAVITY_SURFACES, FACADE, BARRIER, VORTEX_ROUTES, CUTTING, ravineDepth } from '../src/world/layout';
import { SURFACE_FRAMES, faceInput } from '../src/entities/PlayerController';
import { Wind } from '../src/core/Wind';
import type { RealityId } from '../src/core/Reality';

const grid = new WalkGrid();
const res = 0.5;

/** Cells reachable from (x, z) staying in one reality, within a Z window. */
function reach(x: number, z: number, r: RealityId, z0: number, z1: number): Set<string> {
  const key = (a: number, b: number) => `${Math.round(a / res)},${Math.round(b / res)}`;
  const free = (a: number, b: number) => b > z0 && b < z1 && grid.isWalkable(a, b, r) && grid.insideActiveObstacle(new Vector3(a, 0, b), r) === null;
  const sx = Math.round(x / res) * res, sz = Math.round(z / res) * res;
  const seen = new Set<string>([key(sx, sz)]);
  const q: [number, number][] = [[sx, sz]];
  while (q.length) {
    const [a, b] = q.shift()!;
    for (const [na, nb] of [[a + res, b], [a - res, b], [a, b + res], [a, b - res]]) {
      const k = key(na, nb);
      if (seen.has(k) || !free(na, nb)) continue;
      seen.add(k); q.push([na, nb]);
    }
  }
  return seen;
}
const has = (s: Set<string>, x: number, z: number) => s.has(`${Math.round(x / res)},${Math.round(z / res)}`);

describe('The displaced village', () => {
  const sq = VILLAGE.square;

  it('is a loop off the line in Normal: in at one path, out at the other', () => {
    const fromLine = reach(0, 124, 'normal', 118, 148.9);
    expect(has(fromLine, sq.x, sq.z)).toBe(true);
    // Both paths join the square: block the first and the square is still reached from the second
    const viaSecond = reach(3.2, 146.2, 'normal', 138, 148.9);
    expect(has(viaSecond, sq.x, 139.5)).toBe(true);
  });

  it('the Void path is a second way past the fallen tree, and only in the Void', () => {
    const inVoid = reach(sq.x, sq.z, 'void', 118, 160);
    expect(has(inVoid, 0, 157.5)).toBe(true);
    // In Normal the far side of the tree cannot be reached from the village
    const inNormal = reach(sq.x, sq.z, 'normal', 118, 160);
    let beyond = false;
    for (let x = -3; x <= 3; x += 0.5) if (has(inNormal, x, BARRIER.z1 + 2)) beyond = true;
    expect(beyond).toBe(false);
  });

  it('every Void span has a solid recovery point in Normal', () => {
    for (const p of VILLAGE_ROUTE) {
      expect(grid.isWalkable(p.recovery.x, p.recovery.z, 'normal')).toBe(true);
      expect(grid.recoveryFor(p.id)).toBeDefined();
    }
  });

  it('the ravine lies under the Void path and never under real ground', () => {
    const span = VILLAGE_ROUTE.find(p => p.id === 11)!;
    const mx = (span.a.x + span.b.x) / 2, mz = (span.a.z + span.b.z) / 2;
    expect(ravineDepth(mx, mz)).toBeGreaterThan(0.5);
    expect(ravineDepth(sq.x, sq.z)).toBe(0);
    expect(ravineDepth(0, 150)).toBe(0);
  });

  it('only the absent house gives way in the Void', () => {
    const absent = VILLAGE.houses[1];
    expect(grid.insideActiveObstacle(new Vector3(absent.x, 0, absent.z), 'normal')).not.toBeNull();
    expect(grid.insideActiveObstacle(new Vector3(absent.x, 0, absent.z), 'void')).toBeNull();
    const stays = VILLAGE.houses[0];
    expect(grid.insideActiveObstacle(new Vector3(stays.x, 0, stays.z), 'void')).not.toBeNull();
  });
});

describe('Gravity surfaces', () => {
  it('each surface has its own face grid', () => {
    const facade = GRAVITY_SURFACES[1];
    expect(grid.wallWalkable(260, 1.5, facade.id)).toBe(true);
    expect(grid.wallWalkable(269, 4.5, facade.id)).toBe(false);   // the broken band
    expect(grid.wallWalkable(269, 2.0, facade.id)).toBe(true);    // passable beneath it
    // The white wall's own hole is unchanged
    expect(grid.wallWalkable(230, 2, 0)).toBe(false);
    expect(grid.wallWalkable(219, 2, 0)).toBe(true);
  });

  it('the facade can be walked end to end below the break, but not through it', () => {
    const low = { u: 0, v: 0 };
    let u = 258, v = 2.0;
    for (let i = 0; i < 400; i++) { low.u = u + 0.06; low.v = v; grid.resolveWall(u, v, low, 1); u = low.u; }
    expect(u).toBeGreaterThan(280);
    u = 262; v = 4.5;
    for (let i = 0; i < 400; i++) { low.u = u + 0.06; low.v = v; grid.resolveWall(u, v, low, 1); u = low.u; }
    expect(u).toBeLessThan(267.6);
  });

  it('entry regions pick the right surface', () => {
    expect(grid.surfaceEntryAt(FACADE.x + 0.5, 265)!.id).toBe(1);
    expect(grid.surfaceEntryAt(-4.6, 220)!.id).toBe(0);
    expect(grid.surfaceEntryAt(0, 265)).toBeNull();
  });

  it('screen input maps onto an upright face: up climbs, right moves along it, speed kept', () => {
    const f = SURFACE_FRAMES[0];
    const iso = { right: { x: Math.SQRT1_2, y: Math.SQRT1_2 }, forward: { x: -Math.SQRT1_2, y: Math.SQRT1_2 } };
    const up = faceInput(f, 0, -1, iso.right, iso.forward);
    expect(up.dv).toBeCloseTo(1); expect(up.du).toBeCloseTo(0);
    const right = faceInput(f, 1, 0, iso.right, iso.forward);
    expect(right.du).toBeCloseTo(1); expect(right.dv).toBeCloseTo(0);
    const diag = faceInput(f, Math.SQRT1_2, -Math.SQRT1_2, iso.right, iso.forward);
    expect(Math.hypot(diag.du, diag.dv)).toBeCloseTo(1);
  });

  it('screen input maps onto a ceiling too (forward becomes the face direction)', () => {
    const ceiling = {
      s: GRAVITY_SURFACES[0], origin: new Vector3(0, 6, 0), normal: new Vector3(0, -1, 0),
      u: new Vector3(1, 0, 0), v: new Vector3(0, 0, 1)
    };
    const fwd = { x: 0, y: 1 }, right = { x: 1, y: 0 };
    const up = faceInput(ceiling, 0, -1, right, fwd);
    expect(up.dv).toBeCloseTo(1);
    const r = faceInput(ceiling, 1, 0, right, fwd);
    expect(r.du).toBeCloseTo(1);
  });
});

describe('Wind vortex', () => {
  it('starts near its route, travels it and circulates the field around itself', () => {
    const w = new Wind();
    const route = VORTEX_ROUTES[1];
    const player = new Vector3(route.points[1].x, 0.5, route.points[1].z);
    let strongest = 0;
    const out = { x: 0, z: 0, k: 0 };
    for (let i = 0; i < 60 * 12; i++) {
      w.update(1 / 60, player, null, 0, 1);
      strongest = Math.max(strongest, w.vortex.strength);
      if (w.vortex.strength > 0.5) {
        // Tangential: the added wind is mostly perpendicular to the line to the centre
        const px = w.vortex.x + 2, pz = w.vortex.z;
        w.vortexAt(px, pz, out);
        expect(Math.abs(out.z)).toBeGreaterThan(Math.abs(out.x));
        // Far away nothing is felt
        w.vortexAt(w.vortex.x + 40, w.vortex.z, out);
        expect(out.k).toBe(0);
      }
    }
    expect(strongest).toBeGreaterThan(1);
  });
});

describe('The cutting', () => {
  it('climbs from the line to the shelf and comes down again, in Normal', () => {
    const r = CUTTING.route;
    const seen = reach(r[0].x, r[0].z, 'normal', 37, 72);
    for (const p of r) expect(has(seen, p.x, p.z)).toBe(true);
  });

  it('the shelf is raised and the path height changes smoothly (no step over 0.4 m per cell)', () => {
    expect(grid.heightAt(-12.6, 50)).toBeGreaterThan(2);
    let prev = grid.heightAt(CUTTING.route[0].x, CUTTING.route[0].z);
    for (let i = 0; i < CUTTING.route.length - 1; i++) {
      const a = CUTTING.route[i], b = CUTTING.route[i + 1];
      for (let t = 0; t <= 1; t += 0.05) {
        const h = grid.heightAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        expect(Math.abs(h - prev)).toBeLessThan(0.4);
        prev = h;
      }
    }
  });

  it('the trunk is the only way over the cleft, and it is narrow wood', () => {
    const br = CUTTING.bridge, mid = (br.z0 + br.z1) / 2;
    expect(grid.surfaceAt(br.x, mid)).toBe(Surface.WOOD);
    expect(grid.isWalkable(br.x + 0.9, mid, 'normal')).toBe(false);
    expect(grid.isWalkable(br.x - 0.9, mid, 'normal')).toBe(false);
    // In no reality is the stream bed walkable
    for (const r of ['normal', 'void', 'deranged'] as RealityId[]) expect(grid.isWalkable(-18, mid, r)).toBe(false);
  });

  it('the shelf edge cannot be walked off into the cleft', () => {
    const seen = reach(-12.6, 50, 'normal', 37, 72);
    expect(has(seen, -16, 56)).toBe(false);
    expect(has(seen, -9, 56)).toBe(false);
  });
});
