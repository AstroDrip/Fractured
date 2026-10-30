/**
 * The thrown flame's charge tiers. One source of truth: the projectile's look, its
 * collision radius, travel, impact reach and resource cost all read these numbers, so
 * a large-looking flame never has a tiny effect or the other way round.
 *
 * Charge is how much was gathered (0..1). It is not the resource: the cost below is
 * what releasing spends from the flame's fuel.
 */
export type FlameTier = 'flick' | 'fireball' | 'mass';

export interface ThrowSpec {
  tier: FlameTier;
  charge: number;        // 0..1 effective charge (a quick press counts as the minimum)
  radius: number;        // collision radius of the travelling flame (m)
  core: number;          // visual core scale (matches radius)
  speed: number;         // launch speed (m/s)
  lift: number;          // upward launch speed (m/s): the arc
  gravity: number;       // downward acceleration while travelling (m/s²)
  life: number;          // seconds before it gutters out in the air
  reach: number;         // impact influence radius (m): reveal, creatures, fog, grass
  cost: number;          // fuel spent on release
  wobble: number;        // instability of its path (full charge is barely held together)
  sparks: number;        // trail sparks per second
}

export const MIN_THROW_CHARGE = 0.01;   // any real press throws at least a flick
const MIN_EFFECTIVE = 0.2;              // a quick press still throws a small flick
export const PULSE_COST = 0.08;         // fuel: base + per unit of charge
export const PULSE_COST_PER_CHARGE = 0.18;

export function throwSpec(rawCharge: number): ThrowSpec | null {
  if (rawCharge < MIN_THROW_CHARGE) return null;
  const c = Math.min(1, Math.max(MIN_EFFECTIVE, rawCharge));
  const tier: FlameTier = c < 0.4 ? 'flick' : c < 0.85 ? 'fireball' : 'mass';
  const radius = 0.08 + c * 0.34;
  return {
    tier, charge: c, radius, core: radius,
    // Small flames fly fast and flat; a full mass is heavy and lobbed
    speed: 13 - c * 6,
    lift: 1.2 + c * 2.0,
    gravity: 4 + c * 5,
    life: 0.9 + c * 0.9,
    reach: 2.2 + c * 6.8,
    cost: PULSE_COST + PULSE_COST_PER_CHARGE * c,
    wobble: tier === 'mass' ? 0.9 : tier === 'fireball' ? 0.25 : 0.05,
    sparks: 40 + c * 140
  };
}

/** What a travelling flame touched. */
export type FlameContact = 'none' | 'ground' | 'solid' | 'water' | 'creature';
