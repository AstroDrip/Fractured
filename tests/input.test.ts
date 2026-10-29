import { describe, it, expect, beforeAll } from 'vitest';
import { FlameTapCharger } from '../src/core/FlameTapCharger';
import { TOUCH } from '../src/core/controls';
import type { InputManager as IM } from '../src/core/InputManager';

// Minimal event targets so InputManager can be built outside a browser
class Target {
  private l = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(t: string, f: (e: unknown) => void) { (this.l.get(t) ?? this.l.set(t, []).get(t)!).push(f); }
  fire(t: string, e: object = {}) { for (const f of this.l.get(t) ?? []) f({ preventDefault() {}, ...e }); }
}
const win = new Target();
const doc = Object.assign(new Target(), { hidden: false });
let InputManager: typeof IM;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  // First import pulls in the Babylon core bundle, which can take several seconds
  ({ InputManager } = await import('../src/core/InputManager'));
}, 60000);

const make = () => {
  const canvas = new Target();
  const input = new InputManager(canvas as unknown as HTMLCanvasElement, {} as never, () => null);
  return { input, canvas };
};
const frame = (i: IM) => { i.poll(); };

describe('FlameTapCharger', () => {
  it('counts taps spaced beyond the minimum interval', () => {
    const c = new FlameTapCharger();
    expect(c.accept(1000)).toBe(true);
    expect(c.accept(1000 + TOUCH.flameTapMinInterval + 1)).toBe(true);
  });

  it('merges duplicate events from one physical tap', () => {
    const c = new FlameTapCharger();
    expect(c.accept(1000)).toBe(true);
    expect(c.accept(1010)).toBe(false);
    expect(c.accept(1000 + TOUCH.flameTapMinInterval - 1)).toBe(false);
  });

  it('starts fading only after the hold time and only for tap charge', () => {
    const c = new FlameTapCharger();
    expect(c.shouldFade(99999)).toBe(false);
    c.accept(1000);
    expect(c.shouldFade(1000 + TOUCH.flameChargeHoldMs - 1)).toBe(false);
    expect(c.shouldFade(1000 + TOUCH.flameChargeHoldMs + 1)).toBe(true);
    c.reset();
    expect(c.shouldFade(1e9)).toBe(false);
  });

  it('uses a supplied configuration', () => {
    const c = new FlameTapCharger({ flameTapMinInterval: 500, flameChargeHoldMs: 100 });
    c.accept(0);
    expect(c.accept(300)).toBe(false);
    expect(c.shouldFade(150)).toBe(true);
  });
});

describe('InputManager virtual (touch) intents', () => {
  it('normalises stick direction and keeps magnitude separately', () => {
    const { input } = make();
    input.setVirtualMove(0.3, 0.4, true);
    frame(input);
    expect(input.moveMagnitude).toBeCloseTo(0.5);
    expect(input.moveVector.length()).toBeCloseTo(1);
    expect(input.lastDevice).toBe('touch');
    input.setVirtualMove(0, 0, false);
    frame(input);
    expect(input.moveMagnitude).toBe(0);
    expect(input.moveVector.length()).toBe(0);
  });

  it('hold-to-phase from touch produces press, hold and release', () => {
    const { input } = make();
    input.setVirtualHeld('phase', true);
    expect(input.wasPressed('phase')).toBe(true);
    expect(input.isHeld('phase')).toBe(true);
    input.endFrame();
    input.setVirtualHeld('phase', false);
    expect(input.isHeld('phase')).toBe(false);
    expect(input.wasReleased('phase')).toBe(true);
  });

  it('keyboard and touch phase together: releasing one keeps it held', () => {
    const { input } = make();
    win.fire('keydown', { code: 'KeyQ', repeat: false });
    input.setVirtualHeld('phase', true);
    input.endFrame();
    input.setVirtualHeld('phase', false);
    expect(input.isHeld('phase')).toBe(true);
    expect(input.wasReleased('phase')).toBe(false);
    win.fire('keyup', { code: 'KeyQ' });
  });

  it('one-shot presses last a single frame', () => {
    const { input } = make();
    input.pressVirtual('flameTap');
    expect(input.wasPressed('flameTap')).toBe(true);
    input.endFrame();
    expect(input.wasPressed('flameTap')).toBe(false);
  });

  it('focus loss releases every touch source', () => {
    const { input } = make();
    input.setVirtualMove(1, 0, true);
    input.setVirtualHeld('phase', true);
    input.endFrame();
    win.fire('blur');
    frame(input);
    expect(input.isHeld('phase')).toBe(false);
    expect(input.wasReleased('phase')).toBe(true);
    expect(input.moveMagnitude).toBe(0);
  });

  it('releases never switch a keyboard player into touch mode', () => {
    const { input } = make();
    win.fire('keydown', { code: 'KeyW', repeat: false });
    expect(input.lastDevice).toBe('keyboard');
    input.setVirtualMove(0, 0, false);
    input.setVirtualHeld('phase', false);
    input.releaseAll();
    expect(input.lastDevice).toBe('keyboard');
    win.fire('keyup', { code: 'KeyW' });
  });

  it('a key press after touch switches back to keyboard', () => {
    const { input } = make();
    input.noteTouch();
    expect(input.lastDevice).toBe('touch');
    win.fire('keydown', { code: 'KeyD', repeat: false });
    expect(input.lastDevice).toBe('keyboard');
    win.fire('keyup', { code: 'KeyD' });
  });
});
