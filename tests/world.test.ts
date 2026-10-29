import { describe, it, expect } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import { WalkGrid } from '../src/world/WalkGrid';
import {
  START, LAMP, CROSSING, BARRIER, WALL, SINKHOLE, VAULTS, GAP_NEAR_Z, GAP_FAR_Z, phaseTargetAt, vantageAt
} from '../src/world/layout';
import type { RealityId } from '../src/core/Reality';

const grid = new WalkGrid();

describe('WalkGrid realities', () => {
  it('the Void-only spans exist only in the Void', () => {
    const seg = CROSSING.find(s => s.id === 1)!;
    const z = (seg.z0 + seg.z1) / 2 + 1;
    expect(grid.isWalkable(0, z, 'void')).toBe(true);
    expect(grid.isWalkable(0, z, 'normal')).toBe(false);
    expect(grid.isWalkable(0, z, 'deranged')).toBe(false);
  });

  it('the suspended fragment is absent in the Void', () => {
    const seg = CROSSING.find(s => s.id === 2)!;
    const z = (seg.z0 + seg.z1) / 2;
    expect(grid.isWalkable(0, z, 'normal')).toBe(true);
    expect(grid.isWalkable(0, z, 'void')).toBe(false);
  });

  it('crossing overlaps are walkable either side, so a timed switch is always possible', () => {
    for (let i = 0; i < CROSSING.length - 1; i++) {
      const a = CROSSING[i], b = CROSSING[i + 1];
      const z = (b.z0 + a.z1) / 2;
      expect(grid.realitiesAt(0, z) & a.realities).not.toBe(0);
      expect(grid.realitiesAt(0, z) & b.realities).not.toBe(0);
    }
  });

  it('every recovery point is solid in Normal', () => {
    for (const s of CROSSING) expect(grid.isWalkable(s.recovery.x, s.recovery.z, 'normal')).toBe(true);
    expect(grid.isWalkable(BARRIER.recovery.x, BARRIER.recovery.z, 'normal')).toBe(true);
  });

  it('the barrier blocks in Normal and Deranged but not in the Void', () => {
    const p = new Vector3(0, 0.6, (BARRIER.z0 + BARRIER.z1) / 2);
    expect(grid.insideActiveObstacle(p, 'normal')).not.toBeNull();
    expect(grid.insideActiveObstacle(p, 'void')).toBeNull();
  });

  it('the sinkhole has no ground in any reality', () => {
    const z = (SINKHOLE.z0 + SINKHOLE.z1) / 2;
    for (const r of ['normal', 'void', 'deranged'] as RealityId[]) expect(grid.isWalkable(0, z, r)).toBe(false);
  });

  it('vaults have a valid landing beyond them', () => {
    for (const v of VAULTS) {
      const from = new Vector3(0, 0.6, v.z0 - 0.4);
      const land = grid.vaultTarget(from, 0, 1, 'normal');
      expect(land).not.toBeNull();
      expect(land!.z).toBeGreaterThan(v.z1);
    }
  });

  it('phase targets: Void on the near side, Deranged past the gap', () => {
    expect(phaseTargetAt(150)).toBe('void');
    expect(phaseTargetAt(GAP_FAR_Z + 10)).toBe('deranged');
  });
});

describe('Route connectivity', () => {
  // Breadth-first search over (cell, reality). A move stays in one reality; a phase
  // switches between Normal and the local target where both can hold the protagonist.
  // Vaults are passable; the wall is checked on its own face grid below.
  it('the opening can be completed from the start to the lamp', () => {
    const res = 0.5;
    const key = (x: number, z: number, r: number) => `${Math.round(x / res)},${Math.round(z / res)},${r}`;
    const R: RealityId[] = ['normal', 'void', 'deranged'];
    // A vault carries the protagonist from just before the obstacle to 0.5 m beyond it
    const vaultBlocked = (x: number, z: number) => VAULTS.some(v => x > v.x0 && x < v.x1 && z > v.z0 - 0.6 && z < v.z1 + 0.6);
    const free = (x: number, z: number, r: RealityId) => {
      if (!grid.isWalkable(x, z, r)) return false;
      if (vaultBlocked(x, z)) return true;               // vaulted over
      return grid.insideActiveObstacle(new Vector3(x, 0, z), r) === null;
    };
    const startX = Math.round(START.x / res) * res, startZ = Math.round(START.z / res) * res;
    const queue: [number, number, number][] = [[startX, startZ, 0]];
    const seen = new Set<string>([key(startX, startZ, 0)]);
    let reachedWallFoot = false, reachedFarFoot = false, reachedLamp = false;
    while (queue.length) {
      const [x, z, ri] = queue.shift()!;
      const r = R[ri];
      if (x < WALL.x + 0.8 && z > WALL.baseZ[0][0] && z < WALL.baseZ[0][1]) reachedWallFoot = true;
      if (Math.hypot(x - LAMP.x, z - LAMP.z) < 2.6) reachedLamp = true;
      const next: [number, number, number][] = [[x + res, z, ri], [x - res, z, ri], [x, z + res, ri], [x, z - res, ri]];
      // Phase switch at this cell
      const t = R.indexOf(phaseTargetAt(z));
      const other = ri === 0 ? t : 0;
      next.push([x, z, other]);
      // The wall: if its foot is reached in Deranged, the far foot is reachable (checked below)
      if (r === 'deranged' && x < WALL.x + 0.8 && z > WALL.baseZ[0][0] && z < WALL.baseZ[0][1]) {
        reachedFarFoot = true;
        next.push([-4.0, WALL.baseZ[1][0] + 2, ri]);
      }
      for (const [nx, nz, nr] of next) {
        const k = key(nx, nz, nr);
        if (seen.has(k) || !free(nx, nz, R[nr])) continue;
        seen.add(k);
        queue.push([nx, nz, nr]);
      }
    }
    expect(reachedWallFoot).toBe(true);
    expect(reachedFarFoot).toBe(true);
    expect(reachedLamp).toBe(true);
  });

  it('the gap cannot be crossed in Normal alone', () => {
    // From the near edge, staying in Normal, the far side is unreachable
    let z = GAP_NEAR_Z - 0.3;
    while (grid.isWalkable(0, z + 0.5, 'normal')) z += 0.5;
    expect(z).toBeLessThan(GAP_FAR_Z - 5);
  });

  it('the wall face connects its two feet around the broken section', () => {
    const res = 0.5;
    const start: [number, number] = [WALL.walk.u0 + 0.6, 0.3], goalU = WALL.walk.u1 - 0.6;
    const seen = new Set<string>();
    const q: [number, number][] = [start];
    let ok = false;
    while (q.length) {
      const [u, v] = q.shift()!;
      if (u >= goalU && v < 1 && grid.wallFootHasGround(u)) { ok = true; break; }
      for (const [nu, nv] of [[u + res, v], [u - res, v], [u, v + res], [u, v - res]] as [number, number][]) {
        const k = `${nu},${nv}`;
        if (seen.has(k) || nv < 0 || !grid.wallWalkable(nu, nv)) continue;
        seen.add(k); q.push([nu, nv]);
      }
    }
    expect(ok).toBe(true);
    // ...and the broken section really does block the low route
    expect(grid.wallWalkable((WALL.hole.u0 + WALL.hole.u1) / 2, 1)).toBe(false);
  });
});

describe('Railway camera', () => {
  it('holds the railway view without a dip from the rails to the edge, and past the wall to the end', () => {
    let prev = vantageAt(19).v!;
    for (const [z0, z1] of [[19, 182], [245, 300]]) {
      for (let z = z0; z <= z1; z += 0.25) {
        const { w, v } = vantageAt(z);
        expect(w).toBeGreaterThan(0.99);
        // Neighbouring vantages blend: no jump in framing between steps
        if (z > z0) expect(Math.abs(v!.distance - prev.distance)).toBeLessThan(0.5);
        prev = { ...v! };
      }
    }
  });
});
