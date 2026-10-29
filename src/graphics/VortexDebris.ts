import { Scene } from '@babylonjs/core';
import { ParticleField, FieldContext } from './ParticleField';
import type { Vortex } from '../core/Wind';
import { GROUND_Y } from '../world/layout';

const SPAWN_RATE = 26;     // per second at full strength

/**
 * What a passing vortex picks up: dead leaves and grit, drawn into a slow rising
 * spiral around the eddy's centre, dropped again as it weakens. Pooled; costs
 * nothing when no vortex is active.
 */
export class VortexDebris {
  private field: ParticleField;
  private acc = 0;
  private quality = 1;

  constructor(scene: Scene, private vortex: Vortex) {
    this.field = new ParticleField(scene, {
      name: 'vortexDebris', capacity: 160, blend: 'alpha', life: [2.2, 4.2], size: [0.05, 0.12],
      colorA: [0.46, 0.42, 0.34, 0.95], colorB: [0.3, 0.28, 0.24, 0.0], fadeIn: 0.1, fadeOut: 0.35,
      drag: 0.6, gravity: -0.4, spin: 6, seed: 31, floorY: GROUND_Y - 0.1,
      behavior: (f, i, c) => this.swirl(f, i, c)
    });
  }

  public setQuality(q: number): void { this.quality = q; this.field.setQuality(0.4 + q * 0.6); }

  private swirl(f: ParticleField, i: number, c: FieldContext): void {
    const v = this.vortex;
    const dx = f.px[i] - v.x, dz = f.pz[i] - v.z, d = Math.hypot(dx, dz) || 1;
    const k = v.strength;
    // Circulate and pull in toward the eddy's radius; lift while held, fall when released
    const pull = (d - v.radius * 0.8) * 0.9;
    f.vx[i] += (-dz / d * 3.2 * k - dx / d * pull * k) * c.dt;
    f.vz[i] += (dx / d * 3.2 * k - dz / d * pull * k) * c.dt;
    f.vy[i] += (k > 0.2 ? 1.1 * k : 0) * c.dt;
  }

  public update(ctx: FieldContext): void {
    const v = this.vortex;
    if (v.strength > 0.05) {
      this.acc += SPAWN_RATE * v.strength * this.quality * ctx.dt;
      while (this.acc >= 1) {
        this.acc -= 1;
        const a = Math.random() * Math.PI * 2, r = v.radius * (0.4 + Math.random() * 1.4);
        this.field.spawn(v.x + Math.cos(a) * r, GROUND_Y + 0.05, v.z + Math.sin(a) * r,
          -Math.sin(a) * 1.5, 0.6 + Math.random() * 0.8, Math.cos(a) * 1.5);
      }
    }
    if (this.field.count > 0 || v.strength > 0) this.field.update(ctx);
  }

  public clear(): void { this.field.clear(); }
}
