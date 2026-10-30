import { Scene, Mesh, MeshBuilder, TransformNode, Vector3, StandardMaterial, Quaternion } from '@babylonjs/core';
import { damp, clamp01 } from '../core/rng';
import { Materials } from '../world/Materials';
import type { SkinnedBody } from './SkinnedBody';

export interface PlayerPoseInput {
  fire: number;        // 0..1 how present the palm fire is
  charge: number;      // 0..1 charging the fire
  phase: number;       // 0..1 phase progress
  inspecting: boolean;
  lookAt: Vector3 | null;    // anomaly or point of interest to glance toward
  recovering: number;  // 0..1 stumble after losing the phase underfoot
  airborne: number;    // 0..1 in a jump
  landing: number;     // 0..1 landing impulse, scaled by fall
  vault: number;       // 0..1 progress through a vault, 0 when not vaulting
  balance?: number;    // 0..1 narrow footing: arms out, body low and still
  /** World-space wind acting on loose cloth (direction × strength, gusts included). */
  wind?: Vector3;
}

// A loose piece of cloth: a pivot at its top edge and a damped spring on two axes
interface ClothPanel {
  pivot: TransformNode;
  ax: number; vx: number;     // swing forward/back (about local X)
  az: number; vz: number;     // swing sideways (about local Z)
  side: number;               // -1 left, 0 back, 1 right
  stiffness: number;
}

// Body proportions (metres). Slender, slightly underweight, about 1.66 m tall.
const HIP_Y = 0.93;
const THIGH = 0.44;
const SHIN = 0.42;
const UPPER_ARM = 0.29;
const FORE_ARM = 0.27;
const COAT_DROP = 0.6;       // waist to hem: the coat ends just below the knee
const IK_MAX_REACH = 0.35;   // feet adapt to ground up to this far above/below the body's ground

/**
 * Leg forward kinematics in the hip's sagittal plane (y up, z forward), using the
 * rig's convention: a rotation.x of -a swings the limb forward by a.
 */
export function legFK(hip: number, knee: number): { y: number; z: number } {
  return {
    y: -THIGH * Math.cos(hip) - SHIN * Math.cos(hip + knee),
    z: -THIGH * Math.sin(hip) - SHIN * Math.sin(hip + knee)
  };
}

/**
 * Analytic two-bone IK: hip and knee angles that put the ankle at (y, z) relative to
 * the hip. The knee only bends one way; unreachable targets straighten the leg toward them.
 */
export function solveLeg(y: number, z: number): { hip: number; knee: number } {
  const d = Math.min(THIGH + SHIN - 1e-4, Math.max(Math.abs(THIGH - SHIN) + 1e-4, Math.hypot(y, z)));
  const c = (d * d - THIGH * THIGH - SHIN * SHIN) / (2 * THIGH * SHIN);
  const knee = Math.acos(Math.max(-1, Math.min(1, c)));
  const phi = Math.atan2(-z, -y);
  const gamma = Math.atan2(SHIN * Math.sin(knee), THIGH + SHIN * Math.cos(knee));
  return { hip: phi - gamma, knee };
}

/**
 * The hooded teenager: an articulated procedural figure (shaped limbs, a lathed
 * torso, a hood shell whose dark opening hides the face, and a long coat in three
 * loose panels) with fully procedural animation. The gait phase advances with
 * distance travelled, so feet never slide and the walk cycle stops the moment the
 * body stops. Coat panels and hood are springs driven by stride, acceleration,
 * jumps, wind and phasing.
 */
export class Player {
  public root: TransformNode;
  public position = new Vector3();
  public velocity = new Vector3();
  public yaw = 0;
  // Local frame: `up` is the active gravity's up; `forward` the facing direction in that surface
  public up = new Vector3(0, 1, 0);
  public forward = new Vector3(0, 0, 1);
  private targetForward = new Vector3(0, 0, 1);
  private readonly rot = new Quaternion();
  private readonly tmpV = new Vector3();
  private readonly tmpR = new Vector3();
  private readonly before = new Vector3();
  public walkSpeed = 2.8;
  public runSpeed = 4.4;
  public static readonly STEP_LENGTH = 0.8;
  public slowSpeed = 1.35;
  public palm: TransformNode;
  public blobShadow: Mesh;
  public meshes: Mesh[] = [];
  public onFootstep?: (foot: number, intensity: number) => void;

  private hips: TransformNode;
  private chest: TransformNode;
  private neck: TransformNode;
  private hoodBack: TransformNode;
  private legs: { thigh: TransformNode; shin: TransformNode; ankle: TransformNode }[] = [];
  private arms: { upper: TransformNode; fore: TransformNode }[] = [];
  private cloth: ClothPanel[] = [];
  private hoodSwing = 0;
  private hoodSwingVel = 0;

  private gait = 0;
  private walkWeight = 0;
  private time = 0;
  private idleTime = 0;
  private yawVel = 0;
  private accel = 0;
  private tmpLook = new Vector3();
  /** Ground height at a world point (gameplay ground). Set by the game; IK is off without it. */
  public groundAt?: (x: number, z: number) => number;
  private ikWeight = 0;
  /** The authored skinned body, once loaded; the procedural meshes are hidden then. */
  public skinned: SkinnedBody | null = null;
  private footOffset = [0, 0];
  private pelvisDrop = 0;
  private headYaw = 0;
  private headPitch = 0;
  private lastFootIndex = 0;
  private prevSpeed = 0;

  constructor(private scene: Scene, mats: Materials) {
    this.root = new TransformNode('player', scene);
    const add = <T extends Mesh>(m: T, mat: StandardMaterial, parent: TransformNode, x = 0, y = 0, z = 0): T => {
      m.material = mat;
      m.parent = parent;
      m.position.set(x, y, z);
      this.meshes.push(m);
      return m;
    };
    const node = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const n = new TransformNode(name, scene);
      n.parent = parent;
      n.position.set(x, y, z);
      return n;
    };
    // A limb segment hanging down from its joint
    const limb = (name: string, len: number, r: number, mat: StandardMaterial, parent: TransformNode, taper = 0.85) => {
      const m = MeshBuilder.CreateCylinder(name, {
        height: len, diameterTop: r * 2, diameterBottom: r * 2 * taper, tessellation: 9
      }, scene);
      add(m, mat, parent, 0, -len / 2, 0);
      const cap = MeshBuilder.CreateSphere(name + 'Joint', { diameter: r * 2, segments: 6 }, scene);
      add(cap, mat, parent, 0, 0, 0);
      return m;
    };

    this.hips = node('hips', this.root, 0, HIP_Y, 0);
    const pelvis = MeshBuilder.CreateCylinder('pelvis', { height: 0.17, diameterTop: 0.25, diameterBottom: 0.27, tessellation: 10 }, scene);
    add(pelvis, mats.trousers, this.hips, 0, -0.02, 0).scaling.z = 0.62;

    // Torso: a lathed profile, narrow waist to narrow shoulders, flattened front to back
    this.chest = node('chest', this.hips, 0, 0.06, 0);
    const torsoProfile = [
      new Vector3(0.118, 0, 0), new Vector3(0.122, 0.12, 0), new Vector3(0.138, 0.28, 0),
      new Vector3(0.158, 0.40, 0), new Vector3(0.15, 0.47, 0), new Vector3(0.07, 0.53, 0), new Vector3(0.05, 0.55, 0)
    ];
    const torso = MeshBuilder.CreateLathe('torso', { shape: torsoProfile, tessellation: 14, cap: Mesh.CAP_ALL }, scene);
    add(torso, mats.coat, this.chest).scaling.z = 0.6;
    // Turned-up collar, a little higher on one side
    const collar = MeshBuilder.CreateCylinder('collar', { height: 0.09, diameterTop: 0.17, diameterBottom: 0.2, tessellation: 12, arc: 0.78, sideOrientation: Mesh.DOUBLESIDE }, scene);
    add(collar, mats.coat, this.chest, 0, 0.53, -0.005);
    collar.rotation.y = Math.PI * 0.72;
    collar.rotation.z = 0.06;
    collar.scaling.z = 0.75;
    // Asymmetry: a strap over the right shoulder to a small bag at the left hip
    const strap = MeshBuilder.CreateBox('strap', { width: 0.03, height: 0.62, depth: 0.012 }, scene);
    add(strap, mats.shoes, this.chest, 0.01, 0.24, 0.088).rotation.z = -0.62;
    const strapBack = MeshBuilder.CreateBox('strapBack', { width: 0.03, height: 0.6, depth: 0.012 }, scene);
    add(strapBack, mats.shoes, this.chest, 0.01, 0.24, -0.088).rotation.z = -0.62;
    // Belt: breaks the long line between coat body and skirt
    const belt = MeshBuilder.CreateCylinder('belt', { height: 0.045, diameter: 0.27, tessellation: 12 }, scene);
    add(belt, mats.shoes, this.chest, 0, 0.045, 0).scaling.z = 0.64;
    const bag = MeshBuilder.CreateBox('satchel', { width: 0.17, height: 0.14, depth: 0.06 }, scene);
    add(bag, mats.shoes, this.hips, -0.17, -0.04, 0.02).rotation.y = -0.35;

    // Long coat: three loose panels from the waist, open at the front
    const panel = (name: string, a0: number, a1: number, side: number, stiffness: number) => {
      const pivot = node(name + 'Pivot', this.chest, 0, 0.04, 0);
      const top: Vector3[] = [], bottom: Vector3[] = [];
      const seg = 7;
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (a1 - a0) * (i / seg);
        top.push(new Vector3(Math.sin(a) * 0.132, 0, Math.cos(a) * 0.132 * 0.66));
        // The hem flares and hangs a little lower at the back
        const drop = COAT_DROP + (Math.cos(a) < 0 ? 0.03 : 0);
        bottom.push(new Vector3(Math.sin(a) * 0.2, -drop, Math.cos(a) * 0.2 * 0.78));
      }
      const m = MeshBuilder.CreateRibbon(name, { pathArray: [top, bottom], sideOrientation: Mesh.DOUBLESIDE }, scene);
      add(m, mats.coat, pivot);
      this.cloth.push({ pivot, ax: 0, vx: 0, az: 0, vz: 0, side, stiffness });
    };
    panel('coatBack', Math.PI * 0.55, Math.PI * 1.45, 0, 70);
    panel('coatFrontR', Math.PI * 0.1, Math.PI * 0.58, 1, 55);
    panel('coatFrontL', -Math.PI * 0.58, -Math.PI * 0.1, -1, 55);

    // Head and hood: the hood shell is a deep cowl, its opening a dark void with the
    // face set back inside it
    this.neck = node('neck', this.chest, 0, 0.55, 0.005);
    const neckM = MeshBuilder.CreateCylinder('neckM', { height: 0.09, diameter: 0.075, tessellation: 8 }, scene);
    add(neckM, mats.skin, this.neck, 0, 0.03, 0);
    const head = MeshBuilder.CreateSphere('head', { diameter: 0.165, segments: 10 }, scene);
    add(head, mats.skin, this.neck, 0, 0.13, -0.005).scaling.set(0.88, 1.05, 0.95);
    this.hoodBack = node('hoodBack', this.neck, 0, 0.14, -0.01);
    const shell = MeshBuilder.CreateSphere('hoodShell', { diameter: 0.25, segments: 12 }, scene);
    add(shell, mats.coat, this.hoodBack, 0, -0.005, -0.02).scaling.set(1.0, 1.0, 1.1);
    // The hood falls in a soft point behind the head
    const peak = MeshBuilder.CreateCylinder('hoodPeak', { height: 0.12, diameterTop: 0, diameterBottom: 0.12, tessellation: 8 }, scene);
    add(peak, mats.coat, this.hoodBack, 0, 0.02, -0.14).rotation.x = -2.3;
    // The opening: a dark oval on the front of the hood; the face is never seen
    const opening = MeshBuilder.CreateDisc('hoodInner', { radius: 0.075, tessellation: 18 }, scene);
    add(opening, mats.hoodInner, this.neck, 0, 0.125, 0.122);
    opening.rotation.y = Math.PI;      // the disc faces -Z; turn it to face out of the hood
    opening.scaling.set(0.92, 1.2, 1);
    // A soft rolled edge around the opening
    const edge: Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI * 0.62 + (Math.PI * 1.24) * (i / 12);
      edge.push(new Vector3(Math.sin(a) * 0.075, 0.125 + Math.cos(a) * 0.095, 0.118 - Math.abs(Math.sin(a)) * 0.012));
    }
    const brim = MeshBuilder.CreateTube('hoodBrim', { path: edge, radius: 0.016, tessellation: 6, cap: Mesh.CAP_ALL }, scene);
    add(brim, mats.coat, this.neck);

    for (const side of [-1, 1]) {
      const thigh = node('thigh', this.hips, side * 0.078, -0.05, 0);
      limb('thighM', THIGH, 0.064, mats.trousers, thigh);
      const shin = node('shin', thigh, 0, -THIGH, 0);
      limb('shinM', SHIN, 0.054, mats.trousers, shin, 0.82);
      const ankle = node('ankle', shin, 0, -SHIN, 0);
      const shoe = MeshBuilder.CreateCapsule('shoe', { height: 0.27, radius: 0.052, tessellation: 8 }, scene);
      add(shoe, mats.shoes, ankle, 0, -0.035, 0.055);
      shoe.rotation.x = Math.PI / 2;
      shoe.scaling.set(1.05, 1, 0.75);
      this.legs.push({ thigh, shin, ankle });

      const upper = node('upperArm', this.chest, side * 0.172, 0.45, -0.005);
      limb('upperArmM', UPPER_ARM, 0.05, mats.coat, upper);
      const fore = node('foreArm', upper, 0, -UPPER_ARM, 0);
      limb('foreArmM', FORE_ARM, 0.043, mats.coat, fore, 1.1);   // sleeve widens to the cuff
      const hand = MeshBuilder.CreateCapsule('hand', { height: 0.1, radius: 0.026, tessellation: 6 }, scene);
      add(hand, mats.skin, fore, 0, -FORE_ARM - 0.045, 0.005).scaling.set(0.9, 1, 0.62);
      this.arms.push({ upper, fore });
    }
    // Fire attaches just above the right palm
    this.palm = node('palm', this.arms[1].fore, 0, -FORE_ARM - 0.06, 0.05);

    this.blobShadow = MeshBuilder.CreateGround('playerBlob', { width: 0.9, height: 0.9 }, scene);
    this.blobShadow.material = mats.blob;
    this.blobShadow.isPickable = false;
    for (const m of this.meshes) m.isPickable = false;
  }

  /**
   * Switches presentation to the authored skinned body. The procedural joints stay as
   * the pose rig (animation, IK, cloth springs); their meshes are hidden. Binds at rest.
   */
  public attachSkinned(body: SkinnedBody, mats: Materials): void {
    const map: [string, TransformNode][] = [
      ['hips', this.hips], ['spine', this.chest],
      ['coat.B', this.cloth[0].pivot], ['coat.L', this.cloth[2].pivot], ['coat.R', this.cloth[1].pivot],
      ['neck', this.neck], ['head', this.neck],
      ['upperarm.L', this.arms[0].upper], ['forearm.L', this.arms[0].fore], ['hand.L', this.arms[0].fore],
      ['upperarm.R', this.arms[1].upper], ['forearm.R', this.arms[1].fore], ['hand.R', this.arms[1].fore],
      ['thigh.L', this.legs[0].thigh], ['shin.L', this.legs[0].shin], ['foot.L', this.legs[0].ankle],
      ['thigh.R', this.legs[1].thigh], ['shin.R', this.legs[1].shin], ['foot.R', this.legs[1].ankle]
    ];
    // Rest pose for binding: every mapped joint at zero, hips at their rest height
    const saved = map.map(([, n]) => n.rotation.clone());
    const hipsPos = this.hips.position.clone();
    for (const [, n] of map) n.rotation.setAll(0);
    this.hips.position.set(0, HIP_Y, 0);
    body.bind(map, this.root);
    map.forEach(([, n], i) => n.rotation.copyFrom(saved[i]));
    this.hips.position.copyFrom(hipsPos);
    body.useMaterials({ coat: mats.coat, trousers: mats.trousers, skin: mats.skin, shoes: mats.shoes, hoodInner: mats.hoodInner });
    for (const m of this.meshes) m.setEnabled(false);
    // The flame sits in the real hand from now on
    const hand = (body.root.getDescendants(false) as TransformNode[]).find(n => n.name === 'hand.R');
    if (hand) this.palm.setParent(hand);
    this.skinned = body;
  }

  public setPosition(p: Vector3): void {
    this.position.copyFrom(p);
    this.root.position.copyFrom(p);
    this.velocity.setAll(0);
  }

  public setYaw(y: number): void {
    this.yaw = y;
    this.forward.set(Math.sin(y), 0, Math.cos(y));
    this.targetForward.copyFrom(this.forward);
    this.up.set(0, 1, 0);
    this.applyRotation();
  }

  private applyRotation(): void {
    // FromLookDirectionLH aims local -Z along the given direction; the model faces +Z
    this.tmpLook.copyFrom(this.forward).scaleInPlace(-1);
    Quaternion.FromLookDirectionLHToRef(this.tmpLook, this.up, this.rot);
    if (!this.root.rotationQuaternion) this.root.rotationQuaternion = new Quaternion();
    this.root.rotationQuaternion.copyFrom(this.rot);
  }

  /** Called by the controller: feet position and distance walked this frame. */
  public place(p: Vector3, walked: number): void {
    this.position.copyFrom(p);
    this.root.position.copyFrom(p);
    this.gait += walked / Player.STEP_LENGTH * Math.PI; // one foot plant per step length
  }

  /** Called by the controller when the active gravity changes the local up. */
  public setUp(up: Vector3): void {
    this.up.copyFrom(up);
  }

  public animate(dt: number, pose: PlayerPoseInput): void {
    this.time += dt;
    // Tangential speed in the current surface
    const vUp = Vector3.Dot(this.velocity, this.up);
    this.tmpV.copyFrom(this.velocity).subtractInPlace(this.tmpR.copyFrom(this.up).scaleInPlace(vUp));
    const speed = this.tmpV.length();
    const moving = speed > 0.12;
    this.idleTime = moving ? 0 : this.idleTime + dt;

    // Turning: ease the facing toward the direction of travel within the surface plane,
    // and lean into the turn
    if (moving) this.targetForward.copyFrom(this.tmpV).scaleInPlace(1 / speed);
    const fUp = Vector3.Dot(this.targetForward, this.up);
    this.targetForward.subtractInPlace(this.tmpR.copyFrom(this.up).scaleInPlace(fUp));
    if (this.targetForward.lengthSquared() < 1e-4) Vector3.CrossToRef(this.up, Vector3.RightReadOnly, this.targetForward);
    this.targetForward.normalize();
    Vector3.CrossToRef(this.up, this.forward, this.tmpR);
    const turnSign = Math.sign(Vector3.Dot(this.tmpR, this.targetForward));
    this.before.copyFrom(this.forward);
    Vector3.LerpToRef(this.forward, this.targetForward, damp(9, dt), this.forward);
    const fu = Vector3.Dot(this.forward, this.up);
    this.forward.subtractInPlace(this.tmpR.copyFrom(this.up).scaleInPlace(fu));
    if (this.forward.lengthSquared() < 1e-4) this.forward.copyFrom(this.targetForward);
    this.forward.normalize();
    const turned = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(this.before, this.forward))));
    this.yawVel = turnSign * turned / Math.max(dt, 1e-4);
    if (this.up.y > 0.99) this.yaw = Math.atan2(this.forward.x, this.forward.z);
    this.applyRotation();

    const targetWeight = Math.min(1.5, speed / this.walkSpeed * 1.25);
    this.walkWeight += (targetWeight - this.walkWeight) * damp(10, dt);
    const w = this.walkWeight;
    const run = clamp01((w - 1.05) / 0.4);    // 0 walking .. 1 running
    const g = this.gait;
    // Smoothed acceleration: drives start/stop lean and cloth lag
    const rawAccel = (speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.accel += (rawAccel - this.accel) * damp(8, dt);
    this.prevSpeed = speed;

    // Footsteps: each half cycle plants a foot
    const footIndex = Math.floor(g / Math.PI);
    if (footIndex !== this.lastFootIndex) {
      this.lastFootIndex = footIndex;
      if (w > 0.15 && this.onFootstep) this.onFootstep(footIndex & 1, Math.min(1, speed / this.walkSpeed));
    }

    const breath = Math.sin(this.time * 1.7);
    const crouch = pose.charge * 0.06 + pose.recovering * 0.14 + pose.phase * 0.02 + pose.landing * 0.22 + (pose.balance ?? 0) * 0.07
      + Math.sin(pose.vault * Math.PI) * 0.18;

    // Hips: bob on each step (deeper when running), sway, idle weight shift
    const idleShift = Math.sin(this.time * 0.35) * 0.018 * (1 - Math.min(1, w));
    this.hips.position.y = HIP_Y - crouch + Math.abs(Math.cos(g)) * (0.026 + run * 0.03) * w - (0.016 + run * 0.02) * w;
    this.hips.position.x = idleShift;
    this.hips.rotation.y = Math.sin(g) * (0.09 - run * 0.03) * w;
    this.hips.rotation.z = Math.sin(g) * 0.035 * w - idleShift * 0.8 - this.yawVel * 0.012 * w;

    // Chest: forward lean with speed and acceleration, counter-rotation, breathing
    const lean = 0.06 * w + run * 0.12 + pose.charge * 0.1 + pose.recovering * 0.35
      + Math.max(-0.12, Math.min(0.16, this.accel * 0.035)) - pose.airborne * 0.05;
    this.chest.rotation.x = lean;
    this.chest.rotation.y = -Math.sin(g) * (0.12 + run * 0.05) * w;
    this.chest.scaling.y = 1 + breath * 0.012 * (1 - Math.min(1, w) * 0.6);

    // IK only on ordinary ground (not in the air, vaulting or on a face)
    const ikOn = this.groundAt && this.up.y > 0.99 && pose.airborne < 0.01 && pose.vault === 0 ? 1 : 0;
    this.ikWeight += (ikOn - this.ikWeight) * damp(8, dt);
    Vector3.CrossToRef(this.up, this.forward, this.tmpR);
    // Pelvis: drops to let the lower foot reach its ground; never rises above the animation
    const lowest = Math.min(this.footOffset[0], this.footOffset[1], 0);
    this.pelvisDrop += (-lowest * 0.85 - this.pelvisDrop) * damp(10, dt);
    this.hips.position.y -= this.pelvisDrop * this.ikWeight;
    // Legs: thigh swing, knee bends on the passing phase (higher knee lift when running);
    // the ankle keeps the sole roughly level so the foot plants rather than stabs
    for (let i = 0; i < 2; i++) {
      const ph = g + i * Math.PI;
      const ww = Math.min(w, 1.25);
      const swing = Math.sin(ph) * (0.46 + run * 0.16) * ww * (1 - pose.airborne * 0.6);
      // In the air the legs tuck; a vault lifts the leading leg over the obstacle
      const tuck = pose.airborne * 0.5 + Math.sin(pose.vault * Math.PI) * (i === 0 ? 0.9 : 0.4);
      let thighX = -swing - crouch * 1.4 - tuck;
      let kneeX = Math.max(0, Math.cos(ph)) * (0.7 + run * 0.55) * ww + crouch * 2.2 + tuck * 1.3;
      // Foot: level in stance, toe dropping as the foot lifts off
      const lift = Math.max(0, Math.cos(ph)) * ww;
      let slope = 0;
      if (this.ikWeight > 0.001) {
        // Ground-aware legs: move the animated ankle by the ground's height under it
        // (relative to the ground under the body) and re-solve hip and knee for it
        const side = i === 0 ? -1 : 1;
        const fk = legFK(thighX, kneeX);
        const fx = this.position.x + this.tmpR.x * side * 0.078 + this.forward.x * fk.z;
        const fz = this.position.z + this.tmpR.z * side * 0.078 + this.forward.z * fk.z;
        const raw = Math.max(-IK_MAX_REACH, Math.min(IK_MAX_REACH, this.groundAt!(fx, fz) - this.position.y));
        this.footOffset[i] += (raw - this.footOffset[i]) * damp(14, dt);
        const sol = solveLeg(fk.y + (this.footOffset[i] + this.pelvisDrop) * this.ikWeight, fk.z);
        thighX = sol.hip; kneeX = sol.knee;
        // Sole follows the slope along the facing direction
        const toe = this.groundAt!(fx + this.forward.x * 0.13, fz + this.forward.z * 0.13);
        const heel = this.groundAt!(fx - this.forward.x * 0.13, fz - this.forward.z * 0.13);
        slope = Math.atan2(toe - heel, 0.26) * this.ikWeight;
      }
      this.legs[i].thigh.rotation.x = thighX;
      this.legs[i].shin.rotation.x = kneeX;
      this.legs[i].ankle.rotation.x = -(thighX + kneeX) * 0.85 + lift * 0.35 + pose.airborne * 0.25 - slope;
    }

    // Arms: counter-swing, elbows bending more at speed; the right arm lifts to hold the fire
    const fireLift = Math.max(pose.fire, pose.charge);
    for (let i = 0; i < 2; i++) {
      const ph = g + i * Math.PI;
      const swing = Math.sin(ph) * (0.36 + run * 0.22) * w;
      const arm = this.arms[i];
      if (i === 1) {
        const hold = fireLift;
        arm.upper.rotation.x = swing * (1 - hold) - hold * (0.95 + pose.charge * 0.35) + breath * 0.01;
        arm.upper.rotation.z = -0.07 - pose.phase * 0.25 - (pose.balance ?? 0) * (1 - hold) * (0.95 - Math.sin(this.time * 2.3) * 0.12);
        arm.fore.rotation.x = -hold * (0.75 - pose.charge * 0.35) - (0.12 + run * 0.5) * (1 - hold) * Math.min(1, w);
      } else {
        // The free hand reaches down to the obstacle during a vault, out for balance in the air
        // and on narrow footing
        const bal = pose.balance ?? 0;
        arm.upper.rotation.x = swing * (1 - bal * 0.7) + pose.recovering * -0.6 - pose.charge * 0.25 - Math.sin(pose.vault * Math.PI) * 0.9;
        arm.upper.rotation.z = 0.07 + pose.phase * 0.3 + pose.recovering * 0.4 + pose.airborne * 0.35
          + bal * (0.95 + Math.sin(this.time * 2.3) * 0.12);
        arm.fore.rotation.x = -0.15 - (0.18 + run * 0.5) * Math.min(1, w) - pose.charge * 0.3;
      }
    }

    // Wind in the body's own frame: x = to its right, z = ahead of it
    Vector3.CrossToRef(this.up, this.forward, this.tmpR);
    let windSide = 0, windFwd = 0, windAmt = 0;
    if (pose.wind) {
      windSide = Vector3.Dot(pose.wind, this.tmpR);
      windFwd = Vector3.Dot(pose.wind, this.forward);
      windAmt = pose.wind.length();
    }
    const vertical = vUp;
    const airLift = pose.airborne * (vertical < 0 ? 0.6 : 0.25);
    this.updateCloth(dt, g, w, speed, windSide, windFwd, windAmt, airLift, pose.phase);

    // Head: looks toward a nearby anomaly or point of interest, down while inspecting,
    // and slowly around when idle for a while
    let tYaw = 0, tPitch = 0;
    if (pose.lookAt) {
      // Angle to the point in the protagonist's own surface frame
      this.tmpV.copyFrom(pose.lookAt).subtractInPlace(this.position);
      Vector3.CrossToRef(this.up, this.forward, this.tmpR);
      const lx = Vector3.Dot(this.tmpV, this.tmpR), lz = Vector3.Dot(this.tmpV, this.forward), ly = Vector3.Dot(this.tmpV, this.up);
      tYaw = Math.max(-1.0, Math.min(1.0, Math.atan2(lx, lz)));
      tPitch = Math.atan2(1.5 - ly, Math.max(Math.hypot(lx, lz), 0.5)) * 0.6;
    } else if (this.idleTime > 3) {
      tYaw = Math.sin(this.time * 0.23) * 0.45;
    }
    if (pose.inspecting) tPitch += 0.35;
    if (pose.fire > 0.5 && !pose.lookAt) { tYaw = 0.25; tPitch = 0.3; } // glance at the palm
    tPitch += pose.charge * 0.2 + pose.phase * 0.15 - run * 0.08;
    this.headYaw += (tYaw - this.headYaw) * damp(4, dt);
    this.headPitch += (tPitch - this.headPitch) * damp(4, dt);
    this.neck.rotation.y = this.headYaw;
    this.neck.rotation.x = this.headPitch + Math.sin(g * 2) * 0.02 * w;

    // Hood: a heavy spring that lags behind head motion and lifts in wind and phase
    const hoodTarget = -speed * 0.03 - airLift * 0.3 + pose.phase * 0.1 - windFwd * 0.05;
    this.hoodSwingVel += ((hoodTarget - this.hoodSwing) * 40 - this.hoodSwingVel * 8) * dt;
    this.hoodSwing += this.hoodSwingVel * dt;
    this.hoodBack.rotation.x = this.hoodSwing;
    this.hoodBack.rotation.z = -windSide * 0.03;

    if (this.skinned) this.skinned.apply(this.root);

    // Blob shadow lies on the current surface
    this.blobShadow.position.copyFrom(this.position).addInPlace(this.tmpR.copyFrom(this.up).scaleInPlace(0.012));
    if (!this.blobShadow.rotationQuaternion) this.blobShadow.rotationQuaternion = new Quaternion();
    this.blobShadow.rotationQuaternion.copyFrom(this.rot);
    this.blobShadow.scaling.setAll(1 - pose.airborne * 0.4);
  }

  /**
   * Coat panels: each swings on a damped spring toward a target set by the legs under
   * it, the body's acceleration (cloth lags behind), falling (the hem lifts), wind
   * and phasing; flutter grows with wind strength.
   */
  private updateCloth(dt: number, g: number, w: number, speed: number, windSide: number, windFwd: number,
                      windAmt: number, airLift: number, phase: number): void {
    const lag = Math.max(-0.5, Math.min(0.5, this.accel * 0.06));
    for (const c of this.cloth) {
      let tx: number, tz: number;
      if (c.side === 0) {
        // Back panel: trails with speed, kicks up when falling or accelerating
        tx = -(speed * 0.07 + lag + airLift + phase * 0.12) - windFwd * 0.25;
        tz = Math.sin(g) * 0.05 * w + windSide * 0.12;
      } else {
        // Front panels: pushed forward by the thigh beneath, pulled back by speed
        const legPh = g + (c.side > 0 ? Math.PI : 0);
        tx = Math.max(0, Math.sin(legPh)) * 0.32 * Math.min(1, w) - speed * 0.04 - lag * 0.6 - airLift * 0.6 - windFwd * 0.15;
        tz = c.side * (0.05 + phase * 0.12 + airLift * 0.25) + windSide * 0.1;
      }
      // Flutter: higher frequency than the stride, grows with the wind
      const fl = windAmt * (0.03 + 0.03 * Math.sin(this.time * 7.3 + c.side * 2.1));
      tx += Math.sin(this.time * 5.1 + c.side) * fl;
      tz += Math.sin(this.time * 6.7 + c.side * 3) * fl;
      c.vx += ((tx - c.ax) * c.stiffness - c.vx * 9) * dt;
      c.ax += c.vx * dt;
      c.vz += ((tz - c.az) * c.stiffness - c.vz * 9) * dt;
      c.az += c.vz * dt;
      // Never through the legs: front panels cannot swing behind the thighs far
      c.ax = Math.max(-1.1, Math.min(0.8, c.ax));
      c.pivot.rotation.x = -c.ax;
      c.pivot.rotation.z = c.az;
    }
  }
}
