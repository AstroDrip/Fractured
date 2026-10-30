import { describe, it, expect } from 'vitest';
import { PhaseSystem } from '../src/core/PhaseSystem';
import { RealityController, type RealityIntent, type RealityRefusal } from '../src/core/RealityController';
import { voidWhite } from '../src/graphics/RealityPlugin';
import { realityRegionAt, REALITY_REGIONS, RIFT, FOREST, GAP_FAR_Z, ATTUNE } from '../src/world/layout';

const near = realityRegionAt(0, 30);
const beyond = realityRegionAt(0, GAP_FAR_Z + 20);
const idle: RealityIntent = { phaseHeld: false, phasePressed: false, shiftPressed: false, ready: true };

function rig() {
  const phase = new PhaseSystem();
  const rc = new RealityController();
  const refused: RealityRefusal[] = [];
  rc.onRefused = (w) => refused.push(w);
  const run = (region = near, intent: Partial<RealityIntent> = {}, seconds = 0.02) => {
    const steps = Math.max(1, Math.round(seconds / 0.02));
    for (let i = 0; i < steps; i++) rc.step(0.02, phase, region, { ...idle, ...intent, ...(i > 0 ? { phasePressed: false, shiftPressed: false } : {}) }, true);
  };
  return { phase, rc, refused, run };
}

describe('Reality regions', () => {
  it('Normal / Void only on the near side, in the forest and in the rift', () => {
    expect(near.void).toBe(true);
    expect(near.deranged).toBe(false);
    for (const [x, z] of [[(FOREST.bounds.x0 + FOREST.bounds.x1) / 2, 90], [-50, 110]]) {
      const r = realityRegionAt(x, z);
      expect(r.void).toBe(true);
      expect(r.deranged).toBe(false);
    }
    expect(realityRegionAt(RIFT.bounds.x0 + 1, RIFT.bounds.z0 + 1).id).toBe('rift');
  });
  it('past the gap: Deranged from stage 1, no Void', () => {
    expect(beyond.void).toBe(false);
    expect(beyond.deranged).toBe(1);
    expect(REALITY_REGIONS[REALITY_REGIONS.length - 1].id).toBe('beyond');
  });
});

describe('RealityController', () => {
  it('holding phase enters Void; releasing returns to Normal', () => {
    const { phase, run } = rig();
    run(near, { phaseHeld: true, phasePressed: true }, 1);
    expect(phase.reality).toBe('void');
    run(near, {}, 1);
    expect(phase.reality).toBe('normal');
    expect(phase.state).toBe('normal');
  });
  it('the shift does nothing before discovery, and nowhere Deranged is not allowed', () => {
    const { phase, rc, refused, run } = rig();
    run(beyond, { shiftPressed: true }, 1);
    expect(phase.reality).toBe('normal');
    rc.unlock(3);
    run(near, { shiftPressed: true }, 1);
    expect(phase.reality).toBe('normal');
    expect(refused).toEqual(['unavailable', 'unavailable']);
  });
  it('the shift toggles Normal / Deranged where it is allowed', () => {
    const { phase, rc, run } = rig();
    rc.unlock(1);
    run(beyond, { shiftPressed: true }, 1);
    expect(phase.reality).toBe('deranged');
    run(beyond, {}, 1);                         // stays: a toggle, not a hold
    expect(phase.reality).toBe('deranged');
    run(beyond, { shiftPressed: true }, 1);
    expect(phase.reality).toBe('normal');
  });
  it('the shift is refused while Void is active or forming', () => {
    const { phase, rc, refused, run } = rig();
    rc.unlock(3);
    const both = { ...near, deranged: 1 as const };
    run(both, { phaseHeld: true, phasePressed: true }, 0.1);
    run(both, { phaseHeld: true, shiftPressed: true }, 1);
    expect(refused).toContain('from-void');
    expect(phase.reality).toBe('void');
    expect(rc.derangedOn).toBe(false);
  });
  it('phase from Deranged passes through Normal before Void', () => {
    const { phase, rc, run } = rig();
    rc.unlock(3);
    const both = { ...near, deranged: 1 as const };
    run(both, { shiftPressed: true }, 1);
    expect(phase.reality).toBe('deranged');
    const seen: string[] = [];
    run(both, { phaseHeld: true, phasePressed: true });
    for (let i = 0; i < 80; i++) { run(both, { phaseHeld: true }); seen.push(phase.state === 'normal' ? 'normal' : phase.target); }
    expect(seen).toContain('normal');
    expect(phase.reality).toBe('void');
    expect(seen.indexOf('void')).toBeGreaterThan(seen.indexOf('normal'));
  });
  it('phase is refused quietly where there is no Void', () => {
    const { phase, refused, run } = rig();
    run(beyond, { phaseHeld: true, phasePressed: true }, 1);
    expect(phase.reality).toBe('normal');
    expect(refused).toEqual(['unavailable']);
  });
  it('leaving Deranged where Normal cannot hold keeps the phase held, and lets go once safe', () => {
    const { phase, rc, run } = rig();
    rc.unlock(1);
    let safe = false;
    phase.canStandIn = (r) => r === 'deranged' || safe;
    phase.mustHold = () => !safe;
    run(beyond, { shiftPressed: true }, 1);
    run(beyond, { shiftPressed: true }, 1);
    expect(phase.state).toBe('held');
    expect(phase.reality).toBe('deranged');
    safe = true;
    run(beyond, {}, 1);
    expect(phase.reality).toBe('normal');
  });
  it('the flame failing ends Deranged; a lock clears the toggle', () => {
    const { phase, rc, run } = rig();
    rc.unlock(1);
    run(beyond, { shiftPressed: true }, 1);
    run(beyond, { ready: false }, 1);
    expect(rc.derangedOn).toBe(false);
    expect(phase.reality).toBe('normal');
    run(beyond, { shiftPressed: true }, 1);
    phase.lock();
    run(beyond, {}, 0.02);
    expect(rc.derangedOn).toBe(false);
  });
  it('progression only rises', () => {
    const rc = new RealityController();
    rc.unlock(2); rc.unlock(1);
    expect(rc.stage).toBe(2);
  });
});

describe('The Void white fragment', () => {
  it('shrinks, shakes and loses detail as the fuel falls; nothing without the flame', () => {
    let last = voidWhite(1, 1, true);
    expect(last.radius).toBeGreaterThan(5.5);
    for (let f = 0.9; f >= 0; f -= 0.1) {
      const w = voidWhite(f, 1, true);
      expect(w.radius).toBeLessThan(last.radius);
      expect(w.unstable).toBeGreaterThanOrEqual(last.unstable);
      expect(w.detail).toBeLessThanOrEqual(last.detail);
      last = w;
    }
    expect(last.radius).toBeGreaterThan(1.5);           // never a pinpoint while the flame lives
    expect(last.unstable).toBe(1);
    expect(voidWhite(1, 1, false).radius).toBe(0);
  });
});

describe('Stage D: wider access', () => {
  const village = realityRegionAt(17, 135);
  const yard = realityRegionAt(ATTUNE.touch.x, ATTUNE.touch.z);
  it('the village allows all three once Deranged is found; the yard and the line to the edge only after attunement', () => {
    expect(village.id).toBe('village');
    expect(village.void).toBe(true);
    expect(village.deranged).toBe(1);
    expect(yard.id).toBe('yardLine');
    expect(yard.void).toBe(true);
    expect(yard.deranged).toBe(3);
    expect(realityRegionAt(0, 175).id).toBe('yardLine');
    expect(realityRegionAt(0, 185).id).toBe('near');            // the gap itself stays Void only
  });
  it('the forest and the rift never allow Deranged, at any stage', () => {
    const rc = new RealityController(); rc.unlock(3);
    expect(rc.derangedAllowed(realityRegionAt(-17, 85))).toBe(false);
    expect(rc.derangedAllowed(realityRegionAt(-50, 110))).toBe(false);
    expect(rc.derangedAllowed(realityRegionAt(0, 100))).toBe(false);   // the line between them
  });
  it('found but not attuned: shift works in the village, not in the yard', () => {
    const rc = new RealityController(); rc.unlock(1);
    expect(rc.derangedAllowed(village)).toBe(true);
    expect(rc.derangedAllowed(yard)).toBe(false);
    rc.unlock(3);
    expect(rc.derangedAllowed(yard)).toBe(true);
  });
  it('in the village, phase from Deranged passes through Normal into Void', () => {
    const phase = new PhaseSystem(); const rc = new RealityController(); rc.unlock(1);
    const i = { phaseHeld: false, phasePressed: false, shiftPressed: false, ready: true };
    rc.step(0.02, phase, village, { ...i, shiftPressed: true }, true);
    for (let k = 0; k < 60; k++) rc.step(0.02, phase, village, i, true);
    expect(phase.reality).toBe('deranged');
    rc.step(0.02, phase, village, { ...i, phaseHeld: true, phasePressed: true }, true);
    let sawNormal = false;
    for (let k = 0; k < 100; k++) { rc.step(0.02, phase, village, { ...i, phaseHeld: true }, true); if (phase.state === 'normal') sawNormal = true; }
    expect(sawNormal).toBe(true);
    expect(phase.reality).toBe('void');
  });
});

describe('Spec acceptance gaps', () => {
  it('transition timings sit in the spec ranges (Void 0.5–0.8 s, Deranged 0.35–0.6 s)', async () => {
    const { RATES } = await import('../src/core/RealityController');
    expect(1 / RATES.void.enter).toBeGreaterThanOrEqual(0.5); expect(1 / RATES.void.enter).toBeLessThanOrEqual(0.8);
    expect(1 / RATES.deranged.enter).toBeGreaterThanOrEqual(0.35); expect(1 / RATES.deranged.enter).toBeLessThanOrEqual(0.6);
    expect(1 / RATES.deranged.leave).toBeGreaterThanOrEqual(0.35);
  });
  it('a shift pressed while Deranged is still forming is rejected, not reversed', () => {
    const phase = new PhaseSystem(); const rc = new RealityController(); rc.unlock(1);
    const refused: string[] = []; rc.onRefused = (w) => refused.push(w);
    const i = { phaseHeld: false, phasePressed: false, shiftPressed: false, ready: true };
    rc.step(0.02, phase, beyond, { ...i, shiftPressed: true }, true);
    rc.step(0.02, phase, beyond, i, true);
    rc.step(0.02, phase, beyond, { ...i, shiftPressed: true }, true);
    expect(refused).toEqual(['busy']);
    for (let k = 0; k < 60; k++) rc.step(0.02, phase, beyond, i, true);
    expect(phase.reality).toBe('deranged');
  });
  it('no unlock without an anchor: walking past the gap leaves Deranged unavailable', () => {
    const rc = new RealityController();
    expect(rc.derangedAllowed(beyond)).toBe(false);
  });
});
