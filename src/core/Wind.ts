import { Vector3 } from '@babylonjs/core';
import { valueNoise2, smoothstep } from './rng';
import { GAP_NEAR_Z, GAP_FAR_Z } from '../world/layout';

/**
 * One wind field for the whole world. Grass, trees, wires, motes and the flame all
 * read it, so a region moves together. Anomalies are authored and bounded:
 *  - inside the gap the wind stops abruptly at the fracture boundary
 *  - near the moving light the wind bends toward it
 *  - in Deranged regions dust flows against the grass (`dustSign`)
 *  - occasionally the field holds still for a moment, as if a moment were skipped
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

  public update(dt: number, player: Vector3, light: Vector3 | null, deranged: number, zoneWind: number): void {
    // A skipped moment: the field stops, then resumes as if nothing happened
    this.pauseTimer -= dt;
    if (this.pauseTimer <= 0) { this.paused = 0.7; this.pauseTimer = 35 + Math.random() * 40; }
    if (this.paused > 0) { this.paused -= dt; return; }
    this.time += dt;

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
    // The gap is still: the wind stops at its edge
    if (player.z > GAP_NEAR_Z - 1 && player.z < GAP_FAR_Z + 1) s *= 0.08;
    const l = Math.hypot(dx, dz) || 1;
    this.dirX = dx / l; this.dirZ = dz / l;
    this.strength = s;
    this.dustSign = deranged > 0.5 ? -1 : 1;
  }
}
