// Authored layout of Chapter One. All hand-placed positions live here so level
// design can be tuned without touching system code. Units are metres; the railway
// runs along +Z at X = 0. Ground surface is at GROUND_Y.

import { R_NORMAL, R_VOID, R_DERANGED } from '../core/Reality';
import type { RealityId } from '../core/Reality';

export const GROUND_Y = 0.5;
export const BED_Y = 0.6;           // raised ballast bed under the track
export const BRIDGE_Y = 0.62;       // phase bridge walking surface

// --- Walkable shapes -------------------------------------------------------

export interface Pt { x: number; z: number; }

export const START: Pt = { x: -25.5, z: -5.5 };
export const START_YAW = Math.PI * 0.32; // facing roughly along the path

export const PATH: Pt[] = [
  { x: -25.5, z: -5.5 }, { x: -20, z: -2.5 }, { x: -14.5, z: 2.5 },
  { x: -9.5, z: 7.5 }, { x: -5.5, z: 11.5 }, { x: -2, z: 15 }, { x: 0, z: 17 }
];
export const PATH_RADIUS = 1.3;
export const START_CLEARING_RADIUS = 3.2;

export const TRACK_HALF_WIDTH = 3.5;   // walkable shoulders
export const BED_HALF_WIDTH = 1.5;     // ballast bed
export const TRACK_START_Z = 14;       // rails are buried under an earth heap before this
export const GAP_NEAR_Z = 181.5;       // the railway ends here
export const GAP_FAR_Z = 205.5;        // the far side of the impossible gap
export const TRACK_END_Z = 303.5;      // buffer stop
export const WORLD_END_Z = 308.5;      // the ground ends; rails continue into fog
export const BURIED_MOUND = { z0: 8.5, z1: 13.5 };

// Phase crossing segments over the gap. 'phased' segments only exist while phased,
// 'normal' segments only while not. Overlaps are walkable in both states.
// Which realities each crossing segment exists in (bitmask of R_NORMAL | R_VOID | R_DERANGED)
export interface CrossingSegment {
  id: number; realities: number; z0: number; z1: number; halfWidth: number;
  recovery: Pt;  // where the protagonist reappears if the segment is lost underfoot
}
export const CROSSING: CrossingSegment[] = [
  // Void-only spans: matter that is only there where nothing else is
  { id: 1, realities: R_VOID, z0: 181.0, z1: 192.0, halfWidth: 1.3, recovery: { x: 0, z: 180.6 } },
  // The suspended fragment of the real railway: absent in Void
  { id: 2, realities: R_NORMAL | R_DERANGED, z0: 191.0, z1: 198.0, halfWidth: 1.25, recovery: { x: 0, z: 191.5 } },
  { id: 3, realities: R_VOID, z0: 197.0, z1: 206.5, halfWidth: 1.3, recovery: { x: 0, z: 197.5 } }
];

// The first phase: a fallen tree and twisted fence that block the track in normal
// reality only.
// The fallen tree is matter: it exists in Normal and Deranged, not in Void
export const BARRIER = { z0: 149.0, z1: 151.6, recovery: { x: 0, z: 147.6 }, realities: R_NORMAL | R_DERANGED };
export const BARRIER_GHOST_TREE = { x: 6.2, z: 150.5 }; // in Deranged the same tree also stands, upright

// Which reality a held phase leads to, by region. The near side fractures toward
// Void; past the gap the world fractures toward Deranged.
export function phaseTargetAt(z: number): RealityId {
  return z < GAP_FAR_Z + 2 ? 'void' : 'deranged';
}

// Vantage points: stretches where the camera lowers, stands back and turns down the
// line so the horizon enters the frame. The moving light is placed along these sightlines.
export interface Vantage { z0: number; z1: number; pitch: number; distance: number; yaw: number; }
export const VANTAGES: Vantage[] = [
  // The railway: the view found on reaching the rails holds all the way to the edge
  { z0: 19, z1: 167, pitch: 0.3, distance: 19, yaw: -0.68 },
  { z0: 171, z1: 182, pitch: 0.33, distance: 24, yaw: -0.68 },  // the edge: across the gap
  { z0: 245, z1: 300, pitch: 0.32, distance: 20, yaw: -0.68 }   // past the wall: the same view to the end
];
const blendVantage: Vantage = { z0: 0, z1: 0, pitch: 0, distance: 0, yaw: 0 };
/** Weight of the vantage framing at z; neighbouring vantages blend into each other without a dip. */
export function vantageAt(z: number): { w: number; v: Vantage | null } {
  let a: Vantage | null = null, wa = 0, b: Vantage | null = null, wb = 0;
  for (const v of VANTAGES) {
    if (z > v.z0 - 4 && z < v.z1 + 4) {
      const w = Math.min(1, Math.max(0, Math.min(z - (v.z0 - 4), v.z1 + 4 - z) / 4));
      if (!a) { a = v; wa = w; } else { b = v; wb = w; }
    }
  }
  if (!a) return { w: 0, v: null };
  if (!b || wa + wb <= 0) return { w: wa, v: a };
  const k = wb / (wa + wb);
  blendVantage.pitch = a.pitch + (b.pitch - a.pitch) * k;
  blendVantage.distance = a.distance + (b.distance - a.distance) * k;
  blendVantage.yaw = a.yaw + (b.yaw - a.yaw) * k;
  return { w: Math.min(1, wa + wb), v: blendVantage };
}

// Low obstacles that span the track and must be vaulted (Space). height = top above ground.
export const VAULTS = [
  { id: 'fallen-pole', x0: -4.0, x1: 4.0, z0: 85.8, z1: 86.3, height: 0.5 },
  { id: 'sleeper-pile', x0: -4.0, x1: 4.0, z0: 121.2, z1: 122.0, height: 0.55 }
];

// --- The Deranged wall ------------------------------------------------------
// A sinkhole swallows the track; beside it stands a vast white wall. In Deranged,
// gravity near the wall turns toward it and its face can be walked.
export const SINKHOLE = { z0: 222, z1: 238, x0: -4.6, x1: 14 };
export const WALL = {
  x: -5.0,                 // face plane; the wall's face looks toward +X (the camera)
  z0: 216.5, z1: 243.5,    // extent along the track
  height: 14,
  walk: { u0: 217.5, u1: 242.5, v1: 9.5 },          // walkable face (u = z, v = height above ground)
  hole: { u0: 225.5, u1: 234.5, v1: 4.6 },          // the broken section: no face below v1
  baseZ: [[216, 222], [238, 244]] as [number, number][]  // ground at the wall's foot either side of the sinkhole
};

// --- Narrative zones (atmosphere + ambience blend along Z) ------------------

export interface Zone {
  name: string; z: number; fog: [number, number, number]; density: number;
  ambient: number; wind: number; space: number;
}
// Blended by player Z between consecutive entries
export const ZONES: Zone[] = [
  { name: 'approach', z: -10, fog: [0.109, 0.123, 0.145], density: 0.040, ambient: 0.30, wind: 1.0, space: 0.10 },
  { name: 'railway', z: 30, fog: [0.094, 0.109, 0.131], density: 0.034, ambient: 0.26, wind: 0.85, space: 0.15 },
  { name: 'trees', z: 52, fog: [0.065, 0.072, 0.090], density: 0.046, ambient: 0.18, wind: 0.55, space: 0.12 },
  { name: 'railway2', z: 80, fog: [0.094, 0.109, 0.131], density: 0.034, ambient: 0.25, wind: 0.8, space: 0.15 },
  { name: 'barrier', z: 150, fog: [0.087, 0.099, 0.119], density: 0.036, ambient: 0.22, wind: 0.5, space: 0.2 },
  { name: 'gap', z: 185, fog: [0.102, 0.116, 0.138], density: 0.026, ambient: 0.24, wind: 0.25, space: 0.65 },
  { name: 'alternate', z: 225, fog: [0.160, 0.171, 0.189], density: 0.038, ambient: 0.3, wind: 0.15, space: 0.35 },
  { name: 'ending', z: 298, fog: [0.131, 0.136, 0.145], density: 0.05, ambient: 0.24, wind: 0.05, space: 0.5 }
];

// --- Props -----------------------------------------------------------------

// Telegraph poles: their spacing compresses as the railway approaches the gap,
// then on the far side they stand on the opposite side of the track.
export function polePositions(): { x: number; z: number; lean: number }[] {
  const out: { x: number; z: number; lean: number }[] = [];
  let z = -26;
  let i = 0;
  while (z < GAP_NEAR_Z - 1) {
    out.push({ x: -3.0, z, lean: ((i * 37) % 7 - 3) * 0.012 });
    const t = Math.min(1, Math.max(0, (z - 100) / 80));
    z += 14 * (1 - 0.62 * t * t);
    i++;
  }
  z = GAP_FAR_Z + 3;
  // The far row stops short of the end so nothing stands between the camera and the lamp
  while (z < TRACK_END_Z - 18) {
    out.push({ x: 3.0, z, lean: ((i * 53) % 7 - 3) * 0.015 });
    z += 13;
    i++;
  }
  return out;
}
// Index into polePositions() of the pole whose cable dives into the ground
export const GROUNDED_CABLE_POLE_Z = 128;

export interface SignDef { x: number; z: number; yaw: number; }
export const SIGNS: SignDef[] = [
  { x: 2.6, z: 36, yaw: Math.PI },          // ordinary, faces oncoming walker
  { x: 2.6, z: 95, yaw: Math.PI * 0.5 },    // faces the field
  { x: -2.6, z: 176, yaw: Math.PI },        // last sign before the edge
  { x: 2.6, z: 232, yaw: 0 }                // far side: faces back toward the gap
];

export interface HutDef { x: number; z: number; yaw: number; windowBroken: boolean; }
export const HUTS: HutDef[] = [
  { x: -8.2, z: 72, yaw: Math.PI * 0.5, windowBroken: true },
  { x: 8.2, z: 116, yaw: -Math.PI * 0.5, windowBroken: true },   // same hut, other side
  { x: -8.2, z: 240, yaw: Math.PI * 0.5, windowBroken: false }   // again, window whole
];

// Hand-placed dead trees (more are scattered procedurally around these)
export const TREES: { x: number; z: number; scale: number; variant: number }[] = [
  { x: -30, z: -10, scale: 1.1, variant: 0 }, { x: -21, z: 6, scale: 1.25, variant: 1 },
  { x: -11, z: 0, scale: 0.9, variant: 2 }, { x: -7, z: 16, scale: 1.0, variant: 0 },
  { x: 6.5, z: 44, scale: 1.3, variant: 1 }, { x: -6.8, z: 48, scale: 1.4, variant: 2 },
  { x: 7, z: 54, scale: 1.2, variant: 0 }, { x: -7.5, z: 58, scale: 1.1, variant: 1 },
  { x: 6.8, z: 62, scale: 1.35, variant: 2 }, { x: -6.5, z: 140, scale: 1.1, variant: 0 },
  { x: 7.2, z: 160, scale: 1.0, variant: 2 }
];

export const FENCE_RUNS: { from: Pt; to: Pt; broken: number[] }[] = [
  { from: { x: -28, z: -9 }, to: { x: -16, z: -1.5 }, broken: [3, 4] },
  { from: { x: -12, z: 0 }, to: { x: -4.5, z: 6.5 }, broken: [2] },
  { from: { x: 5, z: 20 }, to: { x: 5, z: 40 }, broken: [5, 6, 11] }
];

// Footprints that walk to the gap's edge and stop; and those at the end that come back
// On the soil shoulder beside the ballast, where the ground is open enough to hold them
export const FOOTPRINTS_TO_EDGE = { z0: 163, z1: GAP_NEAR_Z - 0.3, x: 2.0 };
export const FOOTPRINTS_RETURNING = { z0: WORLD_END_Z - 0.4, z1: TRACK_END_Z - 9, x: -2.0 };

export const BOOT = { x: -12.6, z: 0.9 };    // a boot on a fence post
export const LAMP = { x: 2.0, z: 299.5 };      // the signal lamp at the end
export const FIGURE = { x: 1.6, z: GAP_FAR_Z + 4 };  // figure seen across the gap
export const RISING_RAIL = { z0: 250, z1: 262 }; // right rail leaves the ground here
export const PUDDLES: Pt[] = [
  { x: 5.6, z: 30 }, { x: -5.4, z: 66 }, { x: 5.8, z: 101 }, { x: -5.6, z: 124 },
  { x: 5.5, z: 170 }, { x: -5.2, z: 220 }, { x: 5.5, z: 268 }
];

// --- Points of interest (E to examine) -------------------------------------

export interface PoiDef {
  id: string; x: number; z: number; radius: number; lines: string[];
}
export const POIS: PoiDef[] = [
  { id: 'boot', x: BOOT.x + 0.9, z: BOOT.z + 0.6, radius: 2.4, lines: [
    'Set down carefully. No mud on it.',
    'No mud anywhere near it.'] },
  { id: 'sign-field', x: 2.0, z: 95, radius: 2.4, lines: [
    'It faces the field.',
    'Whoever it was meant for was not on the train.'] },
  { id: 'cable', x: -2.2, z: GROUNDED_CABLE_POLE_Z + 4.5, radius: 2.6, lines: [
    'The cable goes into the ground.',
    'It is still taut. Something down there is holding it.'] },
  { id: 'footprints', x: 1.8, z: 178.5, radius: 2.6, lines: [
    'Someone walked to the edge.',
    'None of the steps come back.'] },
  { id: 'sign-back', x: 2.0, z: 232, radius: 2.4, lines: [
    'It faces away from me.',
    'Meant for someone walking the other way. Toward the gap.'] },
  { id: 'lamp', x: LAMP.x - 0.8, z: LAMP.z, radius: 2.8, lines: [
    'The lamp is the same colour as my hand.'] }
];

// Distance from (x, z) to the nearest walkable ground (negative = inside).
// Used to flatten terrain under walkable areas and keep scatter off the route.
export function walkDistance(x: number, z: number): number {
  let d = Infinity;
  // Track (both sides of the gap)
  const dx = Math.abs(x) - TRACK_HALF_WIDTH;
  const inTrackZ = (z >= TRACK_START_Z && z <= GAP_NEAR_Z) || (z >= GAP_FAR_Z && z <= TRACK_END_Z);
  if (inTrackZ) d = Math.min(d, dx);
  else {
    const zEdge = Math.min(
      Math.abs(z - TRACK_START_Z), Math.abs(z - GAP_NEAR_Z),
      Math.abs(z - GAP_FAR_Z), Math.abs(z - TRACK_END_Z));
    d = Math.min(d, Math.hypot(Math.max(dx, 0), zEdge));
  }
  // Path capsules
  for (let i = 0; i < PATH.length - 1; i++) {
    d = Math.min(d, segDist(x, z, PATH[i], PATH[i + 1]) - PATH_RADIUS);
  }
  d = Math.min(d, Math.hypot(x - START.x, z - START.z) - START_CLEARING_RADIUS);
  return d;
}

export function segDist(x: number, z: number, a: Pt, b: Pt): number {
  const abx = b.x - a.x, abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
}

export const inGap = (z: number) => z > GAP_NEAR_Z && z < GAP_FAR_Z;
export const isTrackZ = (z: number) => (z >= TRACK_START_Z - 30 && z <= GAP_NEAR_Z) || (z >= GAP_FAR_Z && z <= TRACK_END_Z);
