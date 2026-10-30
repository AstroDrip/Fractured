import { describe, it, expect } from 'vitest';
import { throwSpec, MIN_THROW_CHARGE } from '../src/core/FlameTiers';

describe('Thrown flame tiers', () => {
  it('nothing is thrown without a real press; a quick press throws a flick', () => {
    expect(throwSpec(0)).toBeNull();
    expect(throwSpec(MIN_THROW_CHARGE / 2)).toBeNull();
    expect(throwSpec(0.03)!.tier).toBe('flick');
  });

  it('tiers rise with charge: flick, fireball, mass', () => {
    expect(throwSpec(0.3)!.tier).toBe('flick');
    expect(throwSpec(0.6)!.tier).toBe('fireball');
    expect(throwSpec(1)!.tier).toBe('mass');
  });

  it('size, reach and cost grow together; a bigger flame never reaches less or costs less', () => {
    let prev = throwSpec(0.2)!;
    for (let c = 0.25; c <= 1.0001; c += 0.05) {
      const s = throwSpec(c)!;
      expect(s.radius).toBeGreaterThanOrEqual(prev.radius);
      expect(s.reach).toBeGreaterThanOrEqual(prev.reach);
      expect(s.cost).toBeGreaterThanOrEqual(prev.cost);
      expect(s.core).toBe(s.radius);            // what is seen is what collides
      prev = s;
    }
  });

  it('a full mass is heavier and slower than a flick, and less stable', () => {
    const f = throwSpec(0.2)!, m = throwSpec(1)!;
    expect(m.speed).toBeLessThan(f.speed);
    expect(m.gravity).toBeGreaterThan(f.gravity);
    expect(m.wobble).toBeGreaterThan(f.wobble);
    expect(m.reach).toBeGreaterThan(f.reach * 2);
  });

  it('costs match the established pulse rule (base + per charge)', () => {
    expect(throwSpec(1)!.cost).toBeCloseTo(0.26, 5);
    expect(throwSpec(0.2)!.cost).toBeCloseTo(0.116, 5);
  });
});
