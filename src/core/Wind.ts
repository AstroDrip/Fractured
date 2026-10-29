import { Vector3 } from '@babylonjs/core';
import { valueNoise2, smoothstep } from './rng';
import { GAP_NEAR_Z, GAP_FAR_Z, VORTEX_ROUTES } from '../world/layout';
import type { VortexRoute } from '../world/layout';

/** A travelling eddy: position, how strong it is now (0 when none), and its size. */
export interface Vortex { x: number; z: number; strength: number; radius: number; }

const VORTEX_COOLDOWN = 45;   // seconds before the same route can carry another

/**
 * One wind field for the whole world. Grass, trees, wires, motes and the flame all
 * read it, so a region moves together. Anomalies are authored and bounded:
 *  - inside the gap the wind stops abruptly at the fracture boundary
 *  - near the moving light the wind bends toward it
 *  - in Deranged regions dust flows against the grass (`dustSign`)
 *  - occasionally the field holds still for a moment, as if a moment were skipped
 *  - a travelling vortex (VORTEX_ROUTES) bends the field around itself as it passes
 */
export class Wind {
  public dirX = 1;
  public dirZ = 0.3;
  public strength = 0.35;
  public gust = 0;
  public time = 0;
  public dustSign = 1;
  public paused = 0;           // seconds remaining of a skipped moment
  private pauseTimer = 40;
  private readonly tmp = new Vector3();
  public readonly vortex: Vortex = { x: 0, z: 0, strength: 0, radius: 2 };
  /** 0..1 how strongly the vortex is felt where the protagonist stands. */
  public vortexFelt = 0;
  private route: VortexRoute | null = null;
  private routeT = 0;          // metres travelled along the route
  private cooldown = VORTEX_ROUTES.map(() => 8);

  /** Advances the vortex: starts one when the protagonist is near an idle route. */
  private updateVortex(dt: number, player: Vector3): void {
    for (let i = 0; i < VORTEX_ROUTES.length; i++) this.cooldown[i] = Math.max(0, this.cooldown[i] - dt);
    if (!this.route) {
      VORTEX_ROUTES.forEach((r, i) => {
        if (this.route || this.cooldown[i] > 0) return;
        const near = r.points.some(p => Math.hypot(p.x - player.x, p.z - player.z) < r.trigger);
        if (near) { this.route = r; this.routeT = 0; this.cooldown[i] = VORTEX_COOLDOWN; }
      });
    }
    const r = this.route;
    if (!r) { this.vortex.strength = 0; return; }
    this.routeT += r.speed * dt;
    // Walk the polyline to the current distance
    let left = this.routeT, k = 0;
    for (; k < r.points.length - 1; k++) {
      const a = r.points[k], b = r.points[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (left <= len) {
        const t = left / len;
        this.vortex.x = a.x + (b.x - a.x) * t; this.vortex.z = a.z + (b.z - a.z) * t;
        break;
      }
      left -= len;
    }
    if (k >= r.points.length - 1) { this.route = null; this.vortex.strength = 0; return; }
    // Rises and dies away at the ends of its route
    const total = r.points.reduce((acc, p, i) => i === 0 ? 0 : acc + Math.hypot(p.x - r.points[i - 1].x, p.z - r.points[i - 1].z), 0);
    const life = Math.min(1, this.routeT / 4, (total - this.routeT) / 4);
    this.vortex.strength = r.strength * Math.max(0, life);
    this.vortex.radius = r.radius;
  }

  /** Wind added by the vortex at a point (circulating, slightly drawn in). */
  public vortexAt(x: number, z: number, out: { x: number; z: number; k: number }): void {
    const v = this.vortex;
    const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz);
    out.x = 0; out.z = 0; out.k = 0;
    if (v.strength <= 0 || d < 1e-3) return;
    const k = smoothstep(v.radius * 3.2, v.radius * 0.4, d) * v.strength;
    out.x = (-dz / d - dx / d * 0.35) * k;
    out.z = (dx / d - dz / d * 0.35) * k;
    out.k = k;
  }
  private readonly vtmp = { x: 0, z: 0, k: 0 };

  public update(dt: number, player: Vector3, light: Vector3 | null, deranged: number, zoneWind: number): void {
    // A skipped moment: the field stops, then resumes as if nothing happened
    this.pauseTimer -= dt;
    if (this.pauseTimer <= 0) { this.paused = 0.7; this.pauseTimer = 35 + Math.random() * 40; }
    if (this.paused > 0) { this.paused -= dt; return; }
    this.time += dt;
    this.updateVortex(dt, player);

    const t = this.time;
    // Slowly turning prevailing wind with gusts
    const a = 0.35 + (valueNoise2(t * 0.02, 3.1) - 0.5) * 1.2;
    let dx = Math.cos(a), dz = Math.sin(a);
    this.gust = Math.max(0, valueNoise2(t * 0.35, 7.7) - 0.55) * 2.2;
    let s = (0.25 + 0.3 * valueNoise2(t * 0.08, 1.3)) * zoneWind;

    // Near the light, the wind leans toward it
    if (light) {
      this.tmp.copyFrom(light).subtractInPlace(player);
      const d = Math.hypot(this.tmp.x, this.tmp.z);
      const k = smoothstep(60, 15, d) * 0.85;
      if (d > 0.1 && k > 0) {
        dx += (this.tmp.x / d - dx) * k; dz += (this.tmp.z / d - dz) * k;
      }
    }
    // The vortex: the field turns around it where it passes
    this.vortexAt(player.x, player.z, this.vtmp);
    this.vortexFelt = Math.min(1, this.vtmp.k);
    if (this.vtmp.k > 0) {
      dx = dx * s + this.vtmp.x; dz = dz * s + this.vtmp.z;
      s = Math.hypot(dx, dz);
      this.gust += this.vtmp.k * 1.4;
    }
    // The gap is still: the wind stops at its edge
    if (player.z > GAP_NEAR_Z - 1 && player.z < GAP_FAR_Z + 1) s *= 0.08;
    const l = Math.hypot(dx, dz) || 1;
    this.dirX = dx / l; this.dirZ = dz / l;
    this.strength = s;
    this.dustSign = deranged > 0.5 ? -1 : 1;
  }
}
