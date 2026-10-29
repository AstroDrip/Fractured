import { describe, it, expect } from 'vitest';
import { PhaseSystem, PHASE_SOLID_THRESHOLD } from '../src/core/PhaseSystem';

const run = (p: PhaseSystem, sec: number, held: boolean, fire = true, allowed = true) => {
  for (let t = 0; t < sec; t += 1 / 60) p.update(1 / 60, held, fire, allowed);
};

describe('PhaseSystem', () => {
  it('enters the target reality while held and leaves when released', () => {
    const p = new PhaseSystem();
    p.target = 'void';
    run(p, 0.6, true);
    expect(p.state).toBe('phased');
    expect(p.reality).toBe('void');
    run(p, 0.6, false);
    expect(p.state).toBe('normal');
    expect(p.reality).toBe('normal');
  });

  it('refuses without the flame and does not enter', () => {
    const p = new PhaseSystem();
    let refused = 0;
    p.onRefused = () => refused++;
    run(p, 1, true, false);
    expect(p.progress).toBe(0);
    expect(refused).toBe(1);
  });

  it('rejects a commit when the incoming reality cannot hold the protagonist', () => {
    const p = new PhaseSystem();
    p.target = 'void';
    p.canStandIn = (r) => r !== 'void';
    let rejected = 0;
    p.onRejected = () => rejected++;
    run(p, 1, true);
    expect(p.isSolid).toBe(false);
    expect(p.progress).toBeLessThan(PHASE_SOLID_THRESHOLD);
    expect(rejected).toBeGreaterThan(0);
  });

  it('holds the phase when leaving would be unsafe and the location requires it', () => {
    const p = new PhaseSystem();
    p.target = 'deranged';
    run(p, 0.6, true);
    p.canStandIn = (r) => r === 'deranged';
    p.mustHold = () => true;
    run(p, 1, false);
    expect(p.state).toBe('held');
    expect(p.reality).toBe('deranged');
    p.canStandIn = () => true;     // back on solid ground
    run(p, 1, false);
    expect(p.state).toBe('normal');
  });

  it('stays locked after a fall until the key is released', () => {
    const p = new PhaseSystem();
    run(p, 0.6, true);
    p.lock();
    run(p, 1, true);
    expect(p.state).toBe('locked');
    run(p, 0.1, false);
    expect(p.state).toBe('normal');
  });

  it('does not change target mid-transition', () => {
    const p = new PhaseSystem();
    p.target = 'void';
    run(p, 0.2, true);
    p.setTarget('deranged');
    expect(p.target).toBe('void');
  });
});
