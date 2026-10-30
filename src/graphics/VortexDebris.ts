import { Scene, ParticleSystem, Texture, Vector3, Color4 } from '@babylonjs/core';
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
  private mist: ParticleSystem;
  private readonly mistAt = new Vector3();

  constructor(scene: Scene, private vortex: Vortex) {
    this.field = new ParticleField(scene, {
      name: 'vortexDebris', capacity: 160, blend: 'alpha', shape: 'flake', life: [2.2, 4.2], size: [0.05, 0.12],
      colorA: [0.46, 0.42, 0.34, 0.95], colorB: [0.3, 0.28, 0.24, 0.0], fadeIn: 0.1, fadeOut: 0.35,
      drag: 0.6, gravity: -0.4, spin: 6, seed: 31, floorY: GROUND_Y - 0.1,
      behavior: (f, i, c) => this.swirl(f, i, c)
    });
    // Mist drawn up with it: soft puffs that leave the ground circling the centre
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(160, 175, 190, 0.42)');
    grad.addColorStop(0.6, 'rgba(110, 125, 140, 0.15)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    this.mist = new ParticleSystem('vortexMist', 70, scene);
    this.mist.particleTexture = new Texture(canvas.toDataURL('image/png'), scene);
    this.mist.emitter = this.mistAt;
    this.mist.color1 = new Color4(0.2, 0.23, 0.27, 0.28);
    this.mist.color2 = new Color4(0.15, 0.17, 0.2, 0.2);
    this.mist.colorDead = new Color4(0.05, 0.06, 0.07, 0);
    this.mist.minSize = 1.2; this.mist.maxSize = 2.8;
    this.mist.minLifeTime = 1.8; this.mist.maxLifeTime = 3.2;
    this.mist.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.mist.minEmitPower = 1; this.mist.maxEmitPower = 1;
    this.mist.emitRate = 0;
    // Start on a ring around the centre, moving round it and a little up
    this.mist.startPositionFunction = (_m, pos) => {
      const a = Math.random() * Math.PI * 2, r = this.vortex.radius * (0.6 + Math.random() * 1.2);
      pos.set(this.vortex.x + Math.cos(a) * r, GROUND_Y + 0.2 + Math.random() * 0.6, this.vortex.z + Math.sin(a) * r);
    };
    this.mist.startDirectionFunction = (_m, dir, p) => {
      const dx = p ? p.position.x - this.vortex.x : 1, dz = p ? p.position.z - this.vortex.z : 0;
      const d = Math.hypot(dx, dz) || 1;
      dir.set(-dz / d * 1.6, 0.35, dx / d * 1.6);
    };
    this.mist.start();
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
    this.mistAt.set(v.x, GROUND_Y, v.z);
    this.mist.emitRate = v.strength > 0.05 ? 16 * v.strength * this.quality : 0;
  }

  public clear(): void { this.field.clear(); }
}
