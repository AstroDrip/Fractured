// Authored layout of Chapter One. All hand-placed positions live here so level
// design can be tuned without touching system code. Units are metres; the railway
// runs along +Z at X = 0. Ground surface is at GROUND_Y.

import { R_NORMAL, R_VOID, R_DERANGED } from '../core/Reality';
const R_ALL_LAYOUT = R_NORMAL | R_VOID | R_DERANGED;
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

// --- Gravity surfaces ---------------------------------------------------------
// Faces whose gravity turns toward them in Deranged. Each has its own frame: origin
// is the point at u = 0, v = 0; `normal` becomes the protagonist's up; u and v are
// the face's own axes. The controller, the walk grid, the camera and the animation
// all read the same surface, so no face needs code of its own.
export type Vec3 = [number, number, number];
export interface FaceRect { u0: number; u1: number; v0: number; v1: number; }
export interface GravitySurface {
  id: number;
  name: string;
  origin: Vec3; normal: Vec3; uAxis: Vec3; vAxis: Vec3;
  u0: number; u1: number; height: number;          // extent of the face grid
  walk: { u0: number; u1: number; v1: number };    // walkable part of the face
  holes: FaceRect[];                               // missing face
  feet: [number, number][];                        // u ranges with ground at the foot
  entry: { x0: number; x1: number; z0: number; z1: number };  // where walking into it starts the turn
  realities: number;
}
// A displaced house front standing beside the line in the Hound's stretch: walkable
// above the den in Deranged, with a broken window band to work around
export const FACADE = { x: -5.6, z0: 255.5, z1: 282.5, height: 9, ground: { x0: -5.4, x1: -3.5 } };
export const GRAVITY_SURFACES: GravitySurface[] = [
  {
    id: 0, name: 'white wall',
    origin: [WALL.x, GROUND_Y, 0], normal: [1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0],
    u0: WALL.z0, u1: WALL.z1, height: WALL.height, walk: WALL.walk,
    holes: [{ u0: WALL.hole.u0, u1: WALL.hole.u1, v0: 0, v1: WALL.hole.v1 }],
    feet: WALL.baseZ,
    entry: { x0: WALL.x, x1: WALL.x + 0.8, z0: WALL.z0, z1: WALL.z1 },
    realities: R_DERANGED
  },
  {
    id: 1, name: 'facade',
    origin: [FACADE.x, GROUND_Y, 0], normal: [1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0],
    u0: FACADE.z0, u1: FACADE.z1, height: FACADE.height, walk: { u0: 256.3, u1: 281.7, v1: 6.6 },
    holes: [{ u0: 267.6, u1: 270.6, v0: 3.0, v1: 6.6 }],
    feet: [[FACADE.z0, FACADE.z1]],
    entry: { x0: FACADE.x, x1: FACADE.x + 0.9, z0: FACADE.z0 + 0.5, z1: FACADE.z1 - 0.5 },
    realities: R_DERANGED
  }
];

// --- The displaced village ------------------------------------------------------
// A loop east of the track between the second vault and the fallen tree: a square
// of houses that do not agree with each other. From its far corner a path that
// exists only in Void crosses a ravine and rejoins the line beyond the fallen tree.
export interface RoutePiece { a: Pt; b: Pt; r: number; realities: number; id: number; recovery: Pt; }
export const VILLAGE = {
  square: { x: 16, z: 136, r: 6.5 },
  // The square is framed from the south-west, so the houses stand beyond the protagonist
  vantage: { pitch: 0.62, distance: 18, yaw: -Math.PI / 2 },
  houses: [
    { x: 21.5, z: 133, yaw: -Math.PI / 2, w: 4.6, d: 5.2, h: 3.0, realities: R_NORMAL | R_VOID | R_DERANGED },  // door to the square
    { x: 20.5, z: 141.5, yaw: Math.PI, w: 4.6, d: 5.2, h: 3.0, realities: R_NORMAL | R_DERANGED },          // the same house; gone in Void, its shadow stays
    { x: 22.8, z: 128.8, yaw: Math.PI / 2, w: 4.6, d: 5.2, h: 3.0, realities: R_NORMAL | R_VOID | R_DERANGED }       // the same house again, its door turned away from everything
  ],
  inverted: { x: 15, z: 136, y: 13.5 },           // the same house, hanging upside down over the square
  far: { x: 44, z: 168 },                          // and once more, out in the fog where nothing can be reached
  ravine: { a: { x: 13.5, z: 143 }, b: { x: 4.6, z: 156.5 }, r: 2.4 }
};
export const VILLAGE_ROUTE: RoutePiece[] = [
  { a: { x: 3.2, z: 126.5 }, b: { x: 11.5, z: 131.5 }, r: 1.4, realities: R_ALL_LAYOUT, id: 0, recovery: { x: 0, z: 126 } },
  { a: { x: 12, z: 141.5 }, b: { x: 3.2, z: 146.2 }, r: 1.4, realities: R_ALL_LAYOUT, id: 0, recovery: { x: 0, z: 146 } },
  // Only in Void: two spans over the ravine to the line past the fallen tree
  { a: { x: 13.6, z: 142.6 }, b: { x: 9.2, z: 149.5 }, r: 0.95, realities: R_VOID, id: 11, recovery: { x: 14.2, z: 141.4 } },
  { a: { x: 9.2, z: 149.5 }, b: { x: 3.4, z: 157.2 }, r: 0.95, realities: R_VOID, id: 12, recovery: { x: 0, z: 157.5 } }
];

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
  { x: 6.5, z: 44, scale: 1.3, variant: 1 }, { x: -15.4, z: 49, scale: 1.4, variant: 2 },
  { x: 7, z: 54, scale: 1.2, variant: 0 }, { x: -15.8, z: 61.5, scale: 1.1, variant: 1 },
  // The shelf under the cliff: a dense stand the path threads through
  { x: -14.9, z: 44.5, scale: 1.2, variant: 0 }, { x: -17.4, z: 52.4, scale: 1.0, variant: 1 },
  { x: -15.2, z: 64.5, scale: 1.3, variant: 2 }, { x: -18.0, z: 59.6, scale: 0.9, variant: 0 },
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
  // The cutting
  const cb = CUTTING.bounds;
  if (x > cb.x0 && x < cb.x1 && z > cb.z0 && z < cb.z1) d = Math.min(d, cuttingAt(x, z).d - CUTTING.radius);
  // The village: square and its paths (the Void spans too, so nothing grows on them)
  const sq = VILLAGE.square;
  d = Math.min(d, Math.hypot(x - sq.x, z - sq.z) - sq.r);
  for (const p of VILLAGE_ROUTE) d = Math.min(d, segDist(x, z, p.a, p.b) - p.r);
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

/** 0..1 depth of the ravine the Void spans cross (0 outside it, and never under real ground). */
export function ravineDepth(x: number, z: number): number {
  const rv = VILLAGE.ravine;
  const d = segDist(x, z, rv.a, rv.b);
  if (d >= rv.r || Math.abs(x) < TRACK_HALF_WIDTH + 0.6) return 0;
  const sq = VILLAGE.square;
  if (Math.hypot(x - sq.x, z - sq.z) < sq.r + 0.8) return 0;
  for (const p of VILLAGE_ROUTE) if (p.realities === R_ALL_LAYOUT && segDist(x, z, p.a, p.b) < p.r + 0.8) return 0;
  return 1 - d / rv.r;
}

// --- Wind vortices ---------------------------------------------------------------
// An anomalous eddy crosses these routes now and then while the protagonist is near.
// It is one coherent event: the shared wind field bends around it, so grass gusts,
// the coat, the flame and loose debris all answer the same passing thing.
export interface VortexRoute { points: Pt[]; speed: number; radius: number; strength: number; trigger: number; }
export const VORTEX_ROUTES: VortexRoute[] = [
  { points: [{ x: -16, z: 38 }, { x: -4, z: 50 }, { x: 3, z: 55 }, { x: 14, z: 66 }], speed: 2.6, radius: 2.2, strength: 1.4, trigger: 30 },
  { points: [{ x: 29, z: 137 }, { x: 20, z: 135.5 }, { x: 14, z: 139.5 }, { x: 5, z: 151 }], speed: 2.2, radius: 2.0, strength: 1.2, trigger: 26 }
];

// --- The cutting: forest and cliff west of the line ---------------------------------
// A ramp climbs off the line at z 40 onto a rock shelf under a cliff, crosses a cleft
// on a fallen trunk (a narrow walk: slow, arms out), and comes down to the line at z 67.
// Heights are authored per point; the walk grid and the terrain both read them.
export interface HPt { x: number; z: number; h: number; }
export const CUTTING = {
  route: [
    { x: -3.0, z: 40.5, h: GROUND_Y }, { x: -8.5, z: 43.2, h: GROUND_Y + 0.75 },
    { x: -12.2, z: 46.5, h: GROUND_Y + 1.75 }, { x: -12.6, z: 53.4, h: GROUND_Y + 2.0 },
    { x: -12.6, z: 58.6, h: GROUND_Y + 2.0 }, { x: -12.2, z: 62.0, h: GROUND_Y + 1.75 },
    { x: -8.5, z: 65.4, h: GROUND_Y + 0.75 }, { x: -3.0, z: 67.6, h: GROUND_Y }
  ] as HPt[],
  radius: 1.35,
  bridge: { z0: 53.4, z1: 58.6, x: -12.6, halfWidth: 0.45 },   // the trunk over the cleft
  cleft: { z0: 53.9, z1: 58.1, x0: -24, x1: -5.2, depth: 2.6 },  // stream bed below the shelf
  cliff: { x: -16.5, top: 11 },                                   // the face rises west of here
  bounds: { x0: -26, x1: -4.2, z0: 37.5, z1: 70.5 },
  stream: { y: GROUND_Y - 2.15 },
  waterfall: { x: -21.5, z: 56, top: GROUND_Y + 8.5 },            // a crack in the cliff feeds the stream
  culvert: { x: -5.6, z: 56 },                                     // the stream goes under the line
  rails: { x: -14.4, z0: 47.5, z1: 52.6 }                          // a length of track running into the rock
};

/** The cutting route as segments, for distance and height queries. */
export function cuttingAt(x: number, z: number): { d: number; h: number } {
  const r = CUTTING.route;
  let best = Infinity, bh = GROUND_Y;
  for (let i = 0; i < r.length - 1; i++) {
    const a = r[i], b = r[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) { best = d; bh = a.h + (b.h - a.h) * t; }
  }
  return { d: best, h: bh };
}

/** True on the trunk bridge (narrow walking). */
export const onCuttingBridge = (x: number, z: number) =>
  z > CUTTING.bridge.z0 && z < CUTTING.bridge.z1 && Math.abs(x - CUTTING.bridge.x) <= CUTTING.bridge.halfWidth;
