import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, Vector3, TargetCamera } from '@babylonjs/core';
import { Hound, HOUND, Watcher } from '../src/entities/Creatures';
import type { BeingContext } from '../src/entities/Creatures';
import { WalkGrid } from '../src/world/WalkGrid';

const engine = new NullEngine();
const scene = new Scene(engine);
const camera = new TargetCamera('c', new Vector3(0, 10, 0), scene);
const grid = new WalkGrid();

const ctx = (player: Vector3, over: Partial<BeingContext> = {}): BeingContext => ({
  dt: 1 / 60, time: 0, player, playerSpeed: 0, fireOn: false, firePos: new Vector3(0, -50, 0),
  reality: 'normal', voidAmt: 0, derangedAmt: 0, transitioning: false, camera, playerHeight: 0, ...over
});
const run = (h: Hound, sec: number, c: BeingContext) => { for (let t = 0; t < sec; t += 1 / 60) { c.time += 1 / 60; h.update(c); } };

describe('The Hound', () => {
  it('wakes when the protagonist runs near, and stalks', () => {
    const h = new Hound(scene, grid);
    const c = ctx(new Vector3(0, 0.5, HOUND.den.z - 7), { playerSpeed: 4.2 });
    run(h, 0.2, c);
    expect(h.state).toBe('alert');
    run(h, 1.3, c);
    expect(h.state).toBe('stalk');
  });

  it('a walker with the hand closed passes without waking it', () => {
    const h = new Hound(scene, grid);
    const c = ctx(new Vector3(0, 0.5, HOUND.den.z - 7), { playerSpeed: 2.6 });
    run(h, 3, c);
    expect(h.state).toBe('rest');
  });

  it('loses a protagonist who is out of reach on a face, searches beneath, then returns', () => {
    const h = new Hound(scene, grid);
    const c = ctx(new Vector3(-1, 0.5, HOUND.den.z - 6), { playerSpeed: 4.2 });
    run(h, 1.6, c);
    expect(h.state).toBe('stalk');
    c.playerHeight = 2.0; c.playerSpeed = 0;
    run(h, 0.1, c);
    expect(h.state).toBe('search');
    run(h, 5, c);
    expect(['return', 'rest']).toContain(h.state);
  });

  it('a pulse drives it off', () => {
    const h = new Hound(scene, grid);
    expect(h.hit(HOUND.den.clone(), 4)).toBe(true);
    expect(h.state).toBe('repelled');
    expect(h.hit(new Vector3(0, 0, 0), 4)).toBe(false);
  });
});

describe('The Watcher', () => {
  it('retreats when approached and never comes toward the protagonist', () => {
    const w = new Watcher(scene);
    const start = w.root.position.clone();
    const player = start.add(new Vector3(6, 0, -6));
    const c = ctx(player);
    for (let t = 0; t < 2; t += 1 / 60) w.update(c);
    expect(w.state === 'retreat' || w.state === 'hidden').toBe(true);
    const before = Vector3.Distance(start, player), after = Vector3.Distance(w.root.position, player);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('vanishes during a phase transition', () => {
    const w = new Watcher(scene);
    const c = ctx(new Vector3(0, 0.5, 0), { transitioning: true });
    for (let t = 0; t < 1; t += 1 / 60) w.update(c);
    expect(w.state).toBe('hidden');
  });
});
