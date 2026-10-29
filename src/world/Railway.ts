import { Scene, Mesh, MeshBuilder, Vector3 } from '@babylonjs/core';
import { mulberry32, smoothstep } from '../core/rng';
import { ThinBatch } from './ThinBatch';
import { Materials } from './Materials';
import {
  BED_Y, TRACK_START_Z, GAP_NEAR_Z, GAP_FAR_Z, TRACK_END_Z, WORLD_END_Z, RISING_RAIL, SINKHOLE
} from './layout';

export const RAIL_X = 0.72;
export const SLEEPER_TOP = BED_Y + 0.07;
export const RAIL_TOP = SLEEPER_TOP + 0.13;

/**
 * Builds the railway: individually varied sleepers, corroded rails with joints,
 * fasteners and ballast. The far side of the gap uses the same parts with spacing
 * that grows steadily less consistent.
 */
export class Railway {
  public meshes: Mesh[] = [];
  public shadowCasters: Mesh[] = [];

  constructor(private scene: Scene, private mats: Materials) {}

  public build(): void {
    const rnd = mulberry32(1337);
    const sleepers = new ThinBatch(this.box('sleeperBase', this.mats.timber));
    const fasteners = new ThinBatch(this.box('fastenerBase', this.mats.metalDark), false);
    const rails = new ThinBatch(this.box('railBase', this.mats.rust));
    const plates = new ThinBatch(this.box('plateBase', this.mats.metalDark), false);
    const ballast = new ThinBatch(this.box('ballastBase', this.mats.stone));

    const addSleeper = (z: number, alternate: boolean) => {
      const wet = 0.78 + rnd() * 0.32;
      const green = rnd() < 0.15 ? 0.08 : 0;
      const broken = rnd() < (alternate ? 0.04 : 0.08);
      const width = broken ? 1.2 + rnd() * 0.6 : 2.4 + rnd() * 0.2;
      const xOff = broken ? (rnd() - 0.5) * 0.9 : (rnd() - 0.5) * 0.06;
      const yaw = (rnd() - 0.5) * (alternate ? 0.12 : 0.07);
      const sink = rnd() * 0.035;
      sleepers.add(xOff, BED_Y + 0.005 - sink, z, yaw, (rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.04,
        width, 0.13, 0.26 + rnd() * 0.05, wet, wet + green, wet * 0.95);
      if (!broken) {
        for (const side of [-1, 1]) {
          if (rnd() < 0.1) continue; // missing fastener
          fasteners.add(side * RAIL_X - 0.09, SLEEPER_TOP + 0.015, z, yaw, 0, 0, 0.06, 0.035, 0.16);
          fasteners.add(side * RAIL_X + 0.09, SLEEPER_TOP + 0.015, z, yaw, 0, 0, 0.06, 0.035, 0.16);
        }
      }
    };

    // Near side: steady rhythm that loosens toward the edge; starts inside the earth heap
    for (let z = TRACK_START_Z - 34; z < GAP_NEAR_Z - 0.3;) {
      if (rnd() > 0.05) addSleeper(z, false);
      const loosen = smoothstep(160, GAP_NEAR_Z, z);
      z += 0.72 + (rnd() - 0.5) * (0.08 + loosen * 0.5);
    }

    // Far side: the same railway, but its spacing is no longer one rule
    for (let z = GAP_FAR_Z + 0.4; z < WORLD_END_Z + 30;) {
      if (z < SINKHOLE.z0 - 0.3 || z > SINKHOLE.z1 + 0.3) addSleeper(z, true);
      const t = smoothstep(GAP_FAR_Z, TRACK_END_Z, z);
      if (rnd() < 0.05 * t) {
        // A sleeper lying along the track, as if placed by something that knew the shape but not the rule
        sleepers.add((rnd() - 0.5) * 0.8, SLEEPER_TOP + 0.07, z + 0.4, Math.PI / 2 + (rnd() - 0.5) * 0.2, 0, 0,
          2.4, 0.13, 0.28, 0.8, 0.82, 0.86);
      }
      z += 0.72 * (1 + 0.55 * t * Math.sin(z * 0.37)) + (rnd() - 0.5) * 0.12;
    }

    // Rails: 12 m lengths with joint gaps and fish plates
    const railRun = (side: number, z0: number, z1: number) => {
      for (let z = z0; z < z1; z += 12) {
        const len = Math.min(12, z1 - z) - 0.012;
        if (len <= 0.1) continue;
        const mid = z + len / 2;
        const tone = 0.85 + rnd() * 0.25;
        rails.add(side * RAIL_X, SLEEPER_TOP + 0.065, mid, 0, 0, (rnd() - 0.5) * 0.004, 0.07, 0.13, len, tone, tone, tone);
        plates.add(side * (RAIL_X + 0.05), SLEEPER_TOP + 0.06, z + len + 0.006, 0, 0, 0, 0.02, 0.08, 0.5);
      }
    };
    for (const side of [-1, 1]) railRun(side, TRACK_START_Z - 34, GAP_NEAR_Z - 0.6);
    railRun(-1, GAP_FAR_Z + 0.2, SINKHOLE.z0 - 0.4);
    railRun(-1, SINKHOLE.z1 + 0.4, WORLD_END_Z + 34);
    // The right rail leaves at RISING_RAIL.z0 and resumes at z1, as if it never left
    railRun(1, GAP_FAR_Z + 0.2, SINKHOLE.z0 - 0.4);
    railRun(1, SINKHOLE.z1 + 0.4, RISING_RAIL.z0);
    railRun(1, RISING_RAIL.z1, WORLD_END_Z + 34);

    // Ballast: dense on the bed, scattered at the shoulders
    const ballastRange = (z0: number, z1: number) => {
      const n = Math.floor((z1 - z0) * 4.2);
      for (let i = 0; i < n; i++) {
        const z = z0 + rnd() * (z1 - z0);
        const shoulder = rnd() < 0.3;
        const x = shoulder ? (rnd() < 0.5 ? -1 : 1) * (1.4 + rnd() * 0.9) : (rnd() - 0.5) * 2.9;
        const s = 0.07 + rnd() * 0.12;
        const g = 0.32 + rnd() * 0.3;
        ballast.add(x, (shoulder ? 0.5 : BED_Y) + s * 0.25, z, rnd() * 6.28, rnd() * 0.8, rnd() * 0.8,
          s * (0.8 + rnd() * 0.6), s * 0.7, s * (0.8 + rnd() * 0.6), g, g, g * 1.02);
      }
    };
    ballastRange(TRACK_START_Z - 1, GAP_NEAR_Z - 0.2);
    ballastRange(GAP_FAR_Z + 0.2, SINKHOLE.z0 - 0.3);
    ballastRange(SINKHOLE.z1 + 0.3, TRACK_END_Z + 4);

    for (const b of [sleepers, fasteners, rails, plates, ballast]) {
      const m = b.commit();
      m.receiveShadows = true;
      this.meshes.push(m);
    }
    this.shadowCasters.push(sleepers.mesh, rails.mesh);

    this.buildBrokenEnds();
    this.buildRisingRail();
    this.buildBufferStop();
  }

  private box(name: string, mat: import('@babylonjs/core').Material): Mesh {
    const m = MeshBuilder.CreateBox(name, { size: 1 }, this.scene);
    m.material = mat;
    return m;
  }

  // The rails at the edge do not stop; they bend down into the gap and keep going
  private buildBrokenEnds(): void {
    for (const side of [-1, 1]) {
      const path: Vector3[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const z = GAP_NEAR_Z - 0.6 + t * 3.4;
        const drop = t * t * (2.4 + side * 0.4);
        const twist = side * t * t * 0.5;
        path.push(new Vector3(side * RAIL_X + twist, SLEEPER_TOP + 0.065 - drop, z));
      }
      const tube = MeshBuilder.CreateTube('brokenRail', { path, radius: 0.045, tessellation: 5, cap: 2 }, this.scene);
      tube.material = this.mats.rust;
      this.meshes.push(tube);
      this.shadowCasters.push(tube);
    }
    // Last sleepers hang off the edge by their fasteners
    const hang = new ThinBatch(this.box('hangingSleeper', this.mats.timber));
    hang.add(0.15, SLEEPER_TOP - 0.45, GAP_NEAR_Z + 1.1, 0.2, 0.9, 0.1, 2.3, 0.13, 0.27, 0.8, 0.8, 0.78);
    hang.add(-0.3, SLEEPER_TOP - 1.4, GAP_NEAR_Z + 1.9, -0.3, 1.25, -0.2, 2.1, 0.13, 0.27, 0.7, 0.72, 0.7);
    this.meshes.push(hang.commit());
  }

  // One rail leaves the ground and climbs into the fog; the track does not notice
  private buildRisingRail(): void {
    const path: Vector3[] = [];
    const { z0, z1 } = RISING_RAIL;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      path.push(new Vector3(
        RAIL_X + t * t * 3,
        SLEEPER_TOP + 0.065 + Math.pow(t, 2.2) * 30,
        z0 + (z1 - z0) * t + t * t * 14));
    }
    const tube = MeshBuilder.CreateTube('risingRail', { path, radius: 0.045, tessellation: 5 }, this.scene);
    tube.material = this.mats.rust;
    this.meshes.push(tube);
  }

  private buildBufferStop(): void {
    const parts: Mesh[] = [];
    const beam = MeshBuilder.CreateBox('bufferBeam', { width: 2.6, height: 0.35, depth: 0.3 }, this.scene);
    beam.position.set(0, SLEEPER_TOP + 0.55, TRACK_END_Z + 0.9);
    parts.push(beam);
    for (const side of [-1, 1]) {
      const strut = MeshBuilder.CreateBox('bufferStrut', { width: 0.16, height: 0.16, depth: 1.6 }, this.scene);
      strut.position.set(side * RAIL_X, SLEEPER_TOP + 0.35, TRACK_END_Z + 1.5);
      strut.rotation.x = -0.45;
      parts.push(strut);
    }
    const merged = Mesh.MergeMeshes(parts, true, true);
    if (merged) {
      merged.material = this.mats.rust;
      this.meshes.push(merged);
      this.shadowCasters.push(merged);
    }
  }
}
