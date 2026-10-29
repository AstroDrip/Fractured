import { Scene, Mesh, MeshBuilder, TransformNode, Vector3, StandardMaterial, Quaternion } from '@babylonjs/core';
import { damp, clamp01 } from '../core/rng';
import { Materials } from '../world/Materials';

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
}

/**
 * The hooded teenager: a hierarchical voxel figure with a deep hood that hides
 * the face, and fully procedural animation. The gait phase advances with
 * distance travelled, so feet never slide and the walk cycle stops the moment the
 * body stops.
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
  private coatTail: TransformNode;
  private hoodBack: TransformNode;
  private legs: { thigh: TransformNode; shin: TransformNode }[] = [];
  private arms: { upper: TransformNode; fore: TransformNode }[] = [];

  private gait = 0;
  private walkWeight = 0;
  private time = 0;
  private idleTime = 0;
  private yawVel = 0;
  private coatSwing = 0;
  private coatSwingVel = 0;
  private tmpLook = new Vector3();
  private headYaw = 0;
  private headPitch = 0;
  private lastFootIndex = 0;
  private prevSpeed = 0;

  constructor(private scene: Scene, mats: Materials) {
    this.root = new TransformNode('player', scene);
    const box = (name: string, w: number, h: number, d: number, mat: StandardMaterial, parent: TransformNode,
                 x = 0, y = 0, z = 0): Mesh => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
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

    this.hips = node('hips', this.root, 0, 0.9, 0);
    box('pelvis', 0.3, 0.16, 0.18, mats.trousers, this.hips, 0, 0, 0);
    this.chest = node('chest', this.hips, 0, 0.06, 0);
    box('torso', 0.32, 0.5, 0.19, mats.coat, this.chest, 0, 0.26, 0);
    box('collar', 0.3, 0.08, 0.21, mats.coat, this.chest, 0, 0.5, -0.01);
    this.coatTail = node('coatTail', this.chest, 0, 0.02, 0);
    box('coatLower', 0.36, 0.36, 0.22, mats.coat, this.coatTail, 0, -0.16, -0.005);

    // Head and the deep hood: a dark inner opening, sides and a brim that overhangs the face
    this.neck = node('neck', this.chest, 0, 0.56, 0.01);
    box('head', 0.18, 0.2, 0.18, mats.skin, this.neck, 0, 0.12, 0);
    box('hoodInner', 0.2, 0.22, 0.02, mats.hoodInner, this.neck, 0, 0.12, 0.1);
    this.hoodBack = node('hoodBack', this.neck, 0, 0.13, -0.02);
    box('hoodShell', 0.27, 0.3, 0.27, mats.coat, this.hoodBack, 0, 0.0, -0.025);
    box('hoodPeak', 0.16, 0.1, 0.12, mats.coat, this.hoodBack, 0, 0.13, -0.15);
    box('hoodBrim', 0.27, 0.07, 0.1, mats.coat, this.neck, 0, 0.27, 0.12);
    box('hoodSideL', 0.035, 0.27, 0.12, mats.coat, this.neck, -0.12, 0.12, 0.11);
    box('hoodSideR', 0.035, 0.27, 0.12, mats.coat, this.neck, 0.12, 0.12, 0.11);

    for (const side of [-1, 1]) {
      const thigh = node('thigh', this.hips, side * 0.085, -0.04, 0);
      box('thighM', 0.11, 0.42, 0.12, mats.trousers, thigh, 0, -0.21, 0);
      const shin = node('shin', thigh, 0, -0.42, 0);
      box('shinM', 0.095, 0.4, 0.1, mats.trousers, shin, 0, -0.2, 0);
      box('shoe', 0.11, 0.075, 0.24, mats.shoes, shin, 0, -0.42, 0.05);
      this.legs.push({ thigh, shin });

      const upper = node('upperArm', this.chest, side * 0.2, 0.46, 0);
      box('upperArmM', 0.085, 0.3, 0.09, mats.coat, upper, 0, -0.15, 0);
      const fore = node('foreArm', upper, 0, -0.3, 0);
      box('sleeve', 0.08, 0.26, 0.085, mats.coat, fore, 0, -0.13, 0);
      box('hand', 0.065, 0.09, 0.05, mats.skin, fore, 0, -0.3, 0.01);
      this.arms.push({ upper, fore });
    }
    // Fire attaches just above the right palm
    this.palm = node('palm', this.arms[1].fore, 0, -0.36, 0.04);

    this.blobShadow = MeshBuilder.CreateGround('playerBlob', { width: 0.9, height: 0.9 }, scene);
    this.blobShadow.material = mats.blob;
    this.blobShadow.isPickable = false;
    for (const m of this.meshes) m.isPickable = false;
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
    const g = this.gait;

    // Footsteps: each half cycle plants a foot
    const footIndex = Math.floor(g / Math.PI);
    if (footIndex !== this.lastFootIndex) {
      this.lastFootIndex = footIndex;
      if (w > 0.15 && this.onFootstep) this.onFootstep(footIndex & 1, Math.min(1, speed / this.walkSpeed));
    }

    const breath = Math.sin(this.time * 1.7);
    const crouch = pose.charge * 0.06 + pose.recovering * 0.14 + pose.phase * 0.02 + pose.landing * 0.22
      + Math.sin(pose.vault * Math.PI) * 0.18;

    // Hips: bob on each step, sway side to side, idle weight shift
    const idleShift = Math.sin(this.time * 0.35) * 0.018 * (1 - w);
    this.hips.position.y = 0.9 - crouch + Math.abs(Math.cos(g)) * 0.028 * w - 0.018 * w;
    this.hips.position.x = idleShift;
    this.hips.rotation.y = Math.sin(g) * 0.09 * w;
    this.hips.rotation.z = Math.sin(g) * 0.035 * w - idleShift * 0.8 - this.yawVel * 0.012 * w;

    // Chest: forward lean with speed, counter-rotation, breathing
    const lean = 0.07 * w + pose.charge * 0.1 + pose.recovering * 0.35 + (speed - this.prevSpeed) * 0.02;
    this.chest.rotation.x = lean;
    this.chest.rotation.y = -Math.sin(g) * 0.12 * w;
    this.chest.scaling.y = 1 + breath * 0.012 * (1 - w * 0.6);
    this.prevSpeed = speed;

    // Legs: thigh swing, knee bends on the passing phase
    for (let i = 0; i < 2; i++) {
      const ph = g + i * Math.PI;
      const ww = Math.min(w, 1.25);
      const swing = Math.sin(ph) * 0.48 * ww * (1 - pose.airborne * 0.6);
      // In the air the legs tuck; a vault lifts the leading leg over the obstacle
      const tuck = pose.airborne * 0.5 + Math.sin(pose.vault * Math.PI) * (i === 0 ? 0.9 : 0.4);
      this.legs[i].thigh.rotation.x = -swing - crouch * 1.4 - tuck;
      this.legs[i].shin.rotation.x = Math.max(0, Math.cos(ph)) * 0.75 * ww + crouch * 2.2 + tuck * 1.3;
    }

    // Arms: counter-swing; the right arm lifts to hold the fire
    const fireLift = Math.max(pose.fire, pose.charge);
    for (let i = 0; i < 2; i++) {
      const ph = g + i * Math.PI;
      const swing = Math.sin(ph) * 0.38 * w;
      const arm = this.arms[i];
      if (i === 1) {
        const hold = fireLift;
        arm.upper.rotation.x = swing * (1 - hold) - hold * (0.95 + pose.charge * 0.35) + breath * 0.01;
        arm.upper.rotation.z = -0.06 - pose.phase * 0.25;
        arm.fore.rotation.x = -hold * (0.75 - pose.charge * 0.35);
      } else {
        // The free hand reaches down to the obstacle during a vault
        arm.upper.rotation.x = swing + pose.recovering * -0.6 - pose.charge * 0.25 - Math.sin(pose.vault * Math.PI) * 0.9;
        arm.upper.rotation.z = 0.06 + pose.phase * 0.3 + pose.recovering * 0.4;
        arm.fore.rotation.x = -0.15 - 0.2 * w - pose.charge * 0.3;
      }
    }

    // Coat tail: damped spring that lags behind acceleration; lifts while phased
    const accel = (speed - this.coatSwing * 4);
    this.coatSwingVel += (-(this.coatSwing - accel * 0.06) * 60 - this.coatSwingVel * 9) * dt;
    this.coatSwing += this.coatSwingVel * dt;
    this.coatTail.rotation.x = -this.coatSwing * 0.6 - pose.phase * 0.18 - 0.03 * w;
    this.coatTail.rotation.z = Math.sin(g) * 0.04 * w;

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
    tPitch += pose.charge * 0.2 + pose.phase * 0.15;
    this.headYaw += (tYaw - this.headYaw) * damp(4, dt);
    this.headPitch += (tPitch - this.headPitch) * damp(4, dt);
    this.neck.rotation.y = this.headYaw;
    this.neck.rotation.x = this.headPitch + Math.sin(g * 2) * 0.02 * w;
    this.hoodBack.rotation.x = -this.coatSwing * 0.3 + pose.phase * 0.08;

    // Blob shadow lies on the current surface
    this.blobShadow.position.copyFrom(this.position).addInPlace(this.tmpR.copyFrom(this.up).scaleInPlace(0.012));
    if (!this.blobShadow.rotationQuaternion) this.blobShadow.rotationQuaternion = new Quaternion();
    this.blobShadow.rotationQuaternion.copyFrom(this.rot);
    this.blobShadow.scaling.setAll(1 - pose.airborne * 0.4);
  }
}
