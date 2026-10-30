import { describe, it, expect } from 'vitest';
import { Vector3, Quaternion } from '@babylonjs/core';
import { stepBody, DEBRIS_PHYSICS, DEBRIS_BY_SURFACE } from '../src/world/Debris';
import type { Body } from '../src/world/Debris';
import { Cutting } from '../src/world/Cutting';
import { WalkGrid, Surface } from '../src/world/WalkGrid';
import { YARD, FOREST, RIFT, riftHeight } from '../src/world/layout';

const body = (kind: Body['kind'], vel: Vector3): Body => ({
  kind, pos: new Vector3(0, 0.6, 0), vel, rot: Quaternion.Identity(), spin: new Vector3(1, 1, 1), size: 0.1, age: 0, asleep: false
});

describe('Debris physics', () => {
  it('a pushed stone flies, lands, slides to a stop and sleeps above the ground', () => {
    const b = body('stone', new Vector3(3, 3, 0));
    let maxY = 0;
    for (let t = 0; t < 6; t += 1 / 60) { stepBody(b, 1 / 60, 0.5); maxY = Math.max(maxY, b.pos.y); }
    expect(maxY).toBeGreaterThan(0.8);
    expect(b.asleep).toBe(true);
    expect(b.pos.y).toBeGreaterThanOrEqual(0.5);
    expect(b.pos.x).toBeGreaterThan(0.5);
  });

  it('the same push carries a leaf less far than its speed suggests (drag), and a stone is heavier', () => {
    expect(DEBRIS_PHYSICS.leaf.drag).toBeGreaterThan(DEBRIS_PHYSICS.stone.drag);
    expect(DEBRIS_PHYSICS.stone.mass).toBeGreaterThan(DEBRIS_PHYSICS.leaf.mass);
    const s = body('stone', new Vector3(4, 0.5, 0)), l = body('leaf', new Vector3(4, 0.5, 0));
    // In the air (ground far below): drag takes the leaf's speed, the stone keeps its own
    for (let t = 0; t < 0.5; t += 1 / 60) { stepBody(s, 1 / 60, -100); stepBody(l, 1 / 60, -100); }
    expect(Math.abs(l.vel.x)).toBeLessThan(Math.abs(s.vel.x) * 0.5);
  });

  it('every walkable surface has a defined loose-material response', () => {
    for (const surf of [Surface.GRAVEL, Surface.SOIL, Surface.STONE, Surface.WOOD]) expect(DEBRIS_BY_SURFACE[surf]).toBeDefined();
  });
});

describe('Stream surface', () => {
  it('rolls smoothly (no steps) and stays small', () => {
    let prev = Cutting.waveHeight(-24, 56, 1);
    for (let x = -24; x < -5; x += 0.1) {
      const h = Cutting.waveHeight(x, 56, 1);
      expect(Math.abs(h)).toBeLessThan(0.1);
      expect(Math.abs(h - prev)).toBeLessThan(0.02);
      prev = h;
    }
  });
  it('moves with the flow over time', () => {
    expect(Cutting.waveHeight(-15, 56, 0)).not.toBeCloseTo(Cutting.waveHeight(-15, 56, 0.7), 3);
  });
});

describe('Signal yard', () => {
  const grid = new WalkGrid();
  it('the platform is raised, with ramps at its ends', () => {
    const p = YARD.platform;
    expect(grid.heightAt(5, (p.z0 + p.z1) / 2)).toBeCloseTo(0.5 + p.h, 3);
    expect(grid.heightAt(5, p.z0 + 0.3)).toBeLessThan(0.5 + p.h);
  });
  it('the ash blocks the doorway until removed; then the box can be entered', () => {
    const door = new Vector3((YARD.ash.x0 + YARD.ash.x1) / 2, 0, (YARD.door.z0 + YARD.door.z1) / 2);
    expect(grid.insideActiveObstacle(door, 'normal')).not.toBeNull();
    grid.removeObstacle(grid.ashHeap!);
    expect(grid.insideActiveObstacle(door, 'normal')).toBeNull();
    expect(grid.canStand(new Vector3(YARD.levers.x - 0.8, 0, YARD.levers.z), 'normal')).toBe(true);
  });
});

describe('Forest and cliff', () => {
  const g2 = new WalkGrid();
  const res = 0.5;
  const reach = (x: number, z: number, r: 'normal' | 'void') => {
    const key = (a: number, b: number) => `${Math.round(a / res)},${Math.round(b / res)}`;
    const free = (a: number, b: number) => a > -32 && a < 2 && b > 55 && b < 120 && g2.canStand(new Vector3(a, 0, b), r);
    const sx = Math.round(x / res) * res, sz = Math.round(z / res) * res;
    const seen = new Set<string>([key(sx, sz)]); const q: [number, number][] = [[sx, sz]];
    while (q.length) {
      const [a, b] = q.shift()!;
      for (const [na, nb] of [[a + res, b], [a - res, b], [a, b + res], [a, b - res]]) {
        const k = key(na, nb); if (seen.has(k) || !free(na, nb)) continue; seen.add(k); q.push([na, nb]);
      }
    }
    return (px: number, pz: number) => seen.has(key(px, pz));
  };

  it('in Normal the lattice bars the path: the overlook cannot be reached from the cutting', () => {
    const has = reach(-12.8, 61, 'normal');
    expect(has(-17.6, 82)).toBe(true);
    expect(has(FOREST.overlook.x, FOREST.overlook.z)).toBe(false);
  });

  it('in Void the path is open to the overlook and the exit to the line', () => {
    const has = reach(-12.8, 61, 'void');
    expect(has(FOREST.overlook.x, FOREST.overlook.z)).toBe(true);
    expect(has(-3, 114.5)).toBe(true);
  });

  it('the clearing is reachable off the corridor', () => {
    expect(reach(-18, 80, 'normal')(FOREST.clearing.x, FOREST.clearing.z)).toBe(true);
  });

  it('nothing beyond the cliff edge is walkable, and the overlook is raised', () => {
    // Past the edge only the footbridge leaves it
    for (let z = 100; z < 116; z += 1) if (Math.abs(z - RIFT.bridge.z) > 1) expect(g2.isWalkable(FOREST.edgeX - 0.5, z, 'normal')).toBe(false);
    expect(g2.heightAt(FOREST.overlook.x, FOREST.overlook.z)).toBeGreaterThan(4);
  });

  it('the lattice is matter: solid in Normal, absent in Void', () => {
    const l = FOREST.lattice, c = new Vector3((l.x0 + l.x1) / 2, 0, (l.z0 + l.z1) / 2);
    expect(g2.insideActiveObstacle(c, 'normal')).not.toBeNull();
    expect(g2.insideActiveObstacle(c, 'void')).toBeNull();
  });
});

describe('The rift', () => {
  const g3 = new WalkGrid();
  const res = 0.5;
  const reach = (x: number, z: number, r: 'normal' | 'void') => {
    const key = (a: number, b: number) => `${Math.round(a / res)},${Math.round(b / res)}`;
    const free = (a: number, b: number) => a > -79 && a < 2 && b > 90 && b < 140 && g3.canStand(new Vector3(a, 0, b), r);
    const sx = Math.round(x / res) * res, sz = Math.round(z / res) * res;
    const seen = new Set<string>([key(sx, sz)]); const q: [number, number][] = [[sx, sz]];
    while (q.length) {
      const [a, b] = q.shift()!;
      for (const [na, nb] of [[a + res, b], [a - res, b], [a, b + res], [a, b - res]]) {
        const k = key(na, nb); if (seen.has(k) || !free(na, nb)) continue; seen.add(k); q.push([na, nb]);
      }
    }
    return (px: number, pz: number) => seen.has(key(px, pz));
  };

  it('the footbridge middle exists only in Void; its ends in every reality', () => {
    const b = RIFT.bridge, mid = (b.void0 + b.void1) / 2;
    expect(g3.isWalkable(mid, b.z, 'normal')).toBe(false);
    expect(g3.isWalkable(mid, b.z, 'void')).toBe(true);
    expect(g3.isWalkable(-29.6, b.z, 'normal')).toBe(true);
    expect(g3.isWalkable(-35, b.z, 'normal')).toBe(true);
    // Losing the Void on the span returns you to the overlook
    expect(g3.recoveryFor(g3.segmentAt(mid, b.z)).x).toBeGreaterThan(FOREST.edgeX);
  });

  it('in Void the bridge crosses; the descent, trunk, west shelf and ridge connect back to the forest', () => {
    const v = reach(FOREST.overlook.x, FOREST.overlook.z, 'void');
    expect(v(-40, 110)).toBe(true);
    const n = reach(-40, 110, 'normal');
    expect(n(RIFT.lower.x0 + 1, 108)).toBe(true);      // lower shelf by the descent
    expect(n(-66, 110)).toBe(true);                    // over the trunk to the west shelf
    expect(n(-18.5, 106.5)).toBe(true);                // up the ridge to the forest's exit path
    expect(n(RIFT.promontory.x, RIFT.promontory.z)).toBe(true);
  });

  it('the chasm and the gap under the bridge have no ground and are never walkable', () => {
    for (let z = RIFT.chasm.z0 + 1; z < RIFT.chasm.z1; z += 1) {
      if (Math.abs(z - RIFT.trunk.z) < 1) continue;
      expect(riftHeight(-57.5, z)).toBeNull();
      expect(g3.isWalkable(-57.5, z, 'normal')).toBe(false);
    }
    expect(riftHeight(-32, 105)).toBeNull();
  });

  it('walkable rift ground stands exactly where its terrain is (collision matches what is seen)', () => {
    for (const [x, z] of [[-39.75, 110.25], [-51.75, 108.25], [-65.75, 110.25], [-44.75, 134.25]] as [number, number][]) {
      expect(g3.heightAt(x, z)).toBeCloseTo(riftHeight(x, z)!, 5);
    }
  });

  it('the terrain has no steps along the descent (continuous)', () => {
    const d = RIFT.descent;
    let prev = riftHeight(d[0].x, d[0].z)!;
    for (let i = 0; i < d.length - 1; i++) for (let t = 0; t <= 1; t += 0.05) {
      const h = riftHeight(d[i].x + (d[i + 1].x - d[i].x) * t, d[i].z + (d[i + 1].z - d[i].z) * t)!;
      expect(Math.abs(h - prev)).toBeLessThan(0.5); prev = h;
    }
  });
});
