import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, Vector3, Vector2 } from '@babylonjs/core';
import { WalkGrid } from '../src/world/WalkGrid';
import { START, PATH, FENCE_RUNS, FENCE_POCKET, BARRIER } from '../src/world/layout';
import { PhaseSystem } from '../src/core/PhaseSystem';
import { CameraController } from '../src/core/CameraController';
import { legFK, solveLeg } from '../src/entities/Player';
import { nearestFree } from '../src/core/Game';
import type { RealityId } from '../src/core/Reality';

const grid = new WalkGrid();
const res = 0.5;

/** Cells reachable in Normal, honouring obstacles (posts, rails), from a start point. */
function reach(x: number, z: number, r: RealityId, box: [number, number, number, number]): Set<string> {
  const key = (a: number, b: number) => `${Math.round(a / res)},${Math.round(b / res)}`;
  const [x0, z0, x1, z1] = box;
  const free = (a: number, b: number) => a > x0 && a < x1 && b > z0 && b < z1 && grid.canStand(new Vector3(a, 0, b), r)
    && grid.resolve(new Vector3(a, 0, b), new Vector3(a, 0, b), r).blockedX === false;
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

describe('Opening fence (invisible wall)', () => {
  const run = FENCE_RUNS[0];
  const n = Math.floor(Math.hypot(run.to.x - run.from.x, run.to.z - run.from.z) / 2);
  const at = (t: number) => ({ x: run.from.x + (run.to.x - run.from.x) * t, z: run.from.z + (run.to.z - run.from.z) * t });

  it('the whole opening path is walkable from the start (with a full body footprint)', () => {
    const seen = reach(START.x, START.z, 'normal', [-32, -14, 4, 20]);
    for (let i = 0; i < PATH.length - 1; i++) {
      for (let t = 0; t <= 1; t += 0.1) {
        const x = PATH[i].x + (PATH[i + 1].x - PATH[i].x) * t, z = PATH[i].z + (PATH[i + 1].z - PATH[i].z) * t;
        expect(has(seen, x, z)).toBe(true);
      }
    }
  });

  it('the broken bays are a real way through to the hollow behind', () => {
    const seen = reach(START.x, START.z, 'normal', [-32, -14, 4, 20]);
    expect(has(seen, FENCE_POCKET.x, FENCE_POCKET.z)).toBe(true);
    for (const i of run.broken) {
      const mid = at((i + 0.5) / n);
      expect(grid.canStand(new Vector3(mid.x, 0, mid.z), 'normal')).toBe(true);
    }
  });

  it('intact bays are solid: the fence cannot be walked through where it stands', () => {
    for (let i = 0; i < n; i++) {
      if (run.broken.includes(i)) continue;
      const mid = at((i + 0.5) / n);
      const p = new Vector3(mid.x, 0, mid.z);
      // Footprint test (the controller's own collision) refuses the rail line
      const next = p.clone();
      const r = grid.resolve(new Vector3(mid.x + 0.6, 0, mid.z + 0.6), next, 'normal');
      expect(r.blockedX || r.blockedZ).toBe(true);
    }
  });
});

describe('Phase near the fallen tree (no teleport)', () => {
  it('leaving the Void inside the tree is held, not resolved by moving the protagonist', () => {
    const p = new PhaseSystem();
    p.target = 'void';
    const inside = new Vector3(0, 0.5, (BARRIER.z0 + BARRIER.z1) / 2);
    p.canStandIn = (r) => grid.canStand(inside, r);
    p.mustHold = () => grid.insideActiveObstacle(inside, 'normal') !== null;
    for (let t = 0; t < 1; t += 1 / 60) p.update(1 / 60, true, true, true);
    expect(p.isSolid).toBe(true);
    for (let t = 0; t < 1; t += 1 / 60) p.update(1 / 60, false, true, true);
    expect(p.state).toBe('held');
    expect(p.isSolid).toBe(true);
    // Once clear of it, the release completes on its own
    const outside = new Vector3(0, 0.5, BARRIER.z0 - 1);
    p.canStandIn = (r) => grid.canStand(outside, r);
    p.mustHold = () => grid.insideActiveObstacle(outside, 'normal') !== null;
    for (let t = 0; t < 2; t += 1 / 60) p.update(1 / 60, false, true, true);
    expect(p.state).toBe('normal');
  });

  it('rapid repeated taps beside the tree never commit inside it', () => {
    const p = new PhaseSystem();
    p.target = 'void';
    const beside = new Vector3(0, 0.5, BARRIER.z0 - 0.6);
    p.canStandIn = (r) => grid.canStand(beside, r);
    p.mustHold = () => grid.insideActiveObstacle(beside, 'normal') !== null;
    for (let i = 0; i < 40; i++) p.update(1 / 60, i % 6 < 3, true, true);
    expect(grid.canStand(beside, p.reality)).toBe(true);
  });

  it('a forced exit inside the tree resolves to the nearest free side, close by', () => {
    const inside = new Vector3(1.0, 0.5, BARRIER.z0 + 0.5);    // nearer the near side
    const out = nearestFree(grid, inside, 'normal')!;
    expect(out).not.toBeNull();
    expect(grid.canStand(out, 'normal')).toBe(true);
    expect(Vector3.Distance(out, inside)).toBeLessThan(1.5);
    expect(out.z).toBeLessThan(BARRIER.z0 + 0.3);               // the near side, not beyond
  });
});

describe('Reveal shot hand-back', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shot = (cam: CameraController) => cam.playShot({
    focus: new Vector3(-60, 30, 140), focusWeight: 0.17, distance: 12, pitch: 0.08, yawOffset: 0.3,
    inTime: 4.5, hold: 4.5, outTime: 3.5, releaseOnMove: false, releaseBeyondZ: 117
  });
  const step = (cam: CameraController, sec: number, speed: number) => {
    const ws: number[] = [];
    for (let t = 0; t < sec; t += 1 / 60) {
      cam.targetPosition.z += speed / 60;
      cam.update(1 / 60, new Vector3(0, 0, speed), null, 0, 0);
      ws.push(cam.shotWeight);
    }
    return ws;
  };

  it('walking does not end the shot before its boundary', () => {
    const cam = new CameraController(scene);
    cam.snapTo(new Vector3(0, 0.6, 98));
    shot(cam);
    const ws = step(cam, 6.5, 2.8);             // z 98 → ~116
    expect(cam.inShot).toBe(true);
    expect(ws[ws.length - 1]).toBeGreaterThan(0.95);
  });

  it('crossing the boundary releases smoothly, even mid-blend (no jump in weight)', () => {
    const cam = new CameraController(scene);
    cam.snapTo(new Vector3(0, 0.6, 115));
    shot(cam);
    const ws = step(cam, 8, 4.4);                // crosses z 117 while still blending in
    for (let i = 1; i < ws.length; i++) expect(Math.abs(ws[i] - ws[i - 1])).toBeLessThan(0.03);
    expect(cam.inShot).toBe(false);
  });

  it('standing still plays the full in, hold and out', () => {
    const cam = new CameraController(scene);
    cam.snapTo(new Vector3(0, 0.6, 98));
    shot(cam);
    step(cam, 12, 0);
    expect(cam.inShot).toBe(true);
    step(cam, 1, 0);
    expect(cam.inShot).toBe(false);
  });
  void Vector2;
});

describe('Leg IK', () => {
  it('solves back to the animated pose (forward and inverse agree)', () => {
    for (const [h, k] of [[-0.4, 0.3], [0.2, 0.9], [0, 0.05], [-0.6, 1.4]]) {
      const p = legFK(h, k), s = solveLeg(p.y, p.z);
      const q = legFK(s.hip, s.knee);
      expect(q.y).toBeCloseTo(p.y, 4); expect(q.z).toBeCloseTo(p.z, 4);
      expect(s.knee).toBeGreaterThanOrEqual(0);
    }
  });

  it('a foot on a raised step bends the knee more; it never bends backwards', () => {
    const flat = legFK(-0.1, 0.1);
    const up = solveLeg(flat.y + 0.2, flat.z);
    expect(up.knee).toBeGreaterThan(0.1);
    const q = legFK(up.hip, up.knee);
    expect(q.y).toBeCloseTo(flat.y + 0.2, 4);
    // Unreachable (below full extension) straightens without flipping
    const far = solveLeg(-2, 0);
    expect(far.knee).toBeGreaterThanOrEqual(0);
    expect(far.knee).toBeLessThan(0.05);
  });
});
