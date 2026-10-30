import { TargetCamera, Vector3, Scene, Vector2, Ray, Mesh } from '@babylonjs/core';
import { damp, smoothstep } from './rng';

const BASE_FOV = 0.55;

/** An authored camera move: real translation away from the protagonist, not a zoom. */
export interface CameraShot {
  focus: Vector3;          // what the shot leans toward
  focusWeight: number;     // 0..1 how far the framing centre moves toward focus
  distance: number;        // dolly distance
  pitch: number;
  yawOffset: number;       // radians added to the follow yaw
  inTime: number;
  hold: number;
  outTime: number;
  releaseOnMove: boolean;  // hand back control early if the player walks away
  /**
   * Authored hand-back boundary: the shot holds while the protagonist walks (it orbits
   * them) and starts its release once they pass this Z. Takes precedence over
   * releaseOnMove. The full in/hold/out timeline still applies if they never cross it.
   */
  releaseBeyondZ?: number;
  /** Vertical field of view for the shot (blended by its weight). Vertical, so wider screens only gain margin. */
  fov?: number;
}

/**
 * Soft-follow isometric camera with scripted shots and occlusion handling.
 * Follow uses frame-rate independent damping after the protagonist has moved;
 * look-ahead eases in and out; shake is additive and reserved for events; teleports
 * hard-reset smoothing. Control axes never change during shots, so input keeps its
 * meaning while the camera moves.
 */
export class CameraController {
  public camera: TargetCamera;
  public targetPosition = new Vector3();
  public baseDistance = 17;
  private distance = 17;
  private distanceTarget = 17;
  private readonly basePitch = 0.72;
  private readonly baseYaw = Math.PI / 4;
  private center = new Vector3();
  private lookAhead = new Vector3();
  private focusOffset = new Vector3();
  private shake = 0;
  private shakeOffset = new Vector3();
  private time = 0;
  private intro = 1;
  private introActive = false;
  private shot: CameraShot | null = null;
  private shotT = 0;
  private shotStart = new Vector3();
  public readonly forward = new Vector2(0, 1);
  public readonly right = new Vector2(1, 0);
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private occluders: Mesh[] = [];
  private occluderFade = new Map<Mesh, number>();
  private occlusionTimer = 0;
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);

  constructor(private scene: Scene) {
    this.camera = new TargetCamera('isoCamera', new Vector3(0, 15, -15), scene);
    this.camera.fov = 0.55;
    this.camera.minZ = 0.3;
    this.camera.maxZ = 420;
    scene.activeCamera = this.camera;
    this.forward.set(-Math.sin(this.baseYaw), Math.cos(this.baseYaw));
    this.right.set(this.forward.y, -this.forward.x);
  }

  public setOccluders(meshes: Mesh[]): void { this.occluders = meshes; }

  /** Hard cut: reset all smoothing (teleports, respawns). */
  public snapTo(p: Vector3): void {
    this.targetPosition.copyFrom(p);
    this.center.copyFrom(p);
    this.lookAhead.setAll(0);
    this.focusOffset.setAll(0);
    this.distance = this.distanceTarget;
    this.apply(0, 0, 0);
  }

  public beginIntro(): void { this.intro = 0; this.introActive = true; }

  public advanceIntro(dt: number, moving: boolean): void {
    if (!this.introActive) return;
    this.intro = Math.min(1, this.intro + dt * (moving ? 0.22 : 0.05));
    if (this.intro >= 1) this.introActive = false;
  }

  public setDistance(d: number): void { this.distanceTarget = d; }

  // Authored vantage framing, blended in by the caller (0 = ordinary follow)
  private vW = 0; private vPitch = 0.72; private vDist = 17; private vYaw = 0;
  public setVantage(w: number, pitch: number, distance: number, yaw: number, dt: number): void {
    const k = damp(1.1, dt);
    this.vW += (w - this.vW) * k;
    if (w > 0) { this.vPitch = pitch; this.vDist = distance; this.vYaw = yaw; }
  }
  /** On the wall the camera stands back a little so the face and the drop both read. */
  public onWallDistance(onWall: boolean, base: number): number { return onWall ? base + 4 : base; }
  public addShake(a: number): void { this.shake = Math.min(0.5, this.shake + a); }

  public playShot(s: CameraShot): void {
    this.shot = s;
    this.shotT = 0;
    this.shotStart.copyFrom(this.targetPosition);
  }
  public get inShot(): boolean { return this.shot !== null; }

  /**
   * Jump the timeline to its release without a jump in framing: if the shot is still
   * blending in, continue from the same weight on the way out (smoothstep is
   * symmetric, so in-progress v maps to out-progress 1 - v).
   */
  private beginRelease(s: CameraShot): void {
    const hold = s.inTime + s.hold;
    if (this.shotT < s.inTime) this.shotT = hold + s.outTime * (1 - this.shotT / s.inTime);
    else this.shotT = hold;
  }
  /** 0..1 how much the current shot owns the framing. */
  public get shotWeight(): number {
    const s = this.shot;
    if (!s) return 0;
    const t = this.shotT;
    if (t < s.inTime) return smoothstep(0, 1, t / s.inTime);
    if (t < s.inTime + s.hold) return 1;
    return 1 - smoothstep(0, 1, (t - s.inTime - s.hold) / s.outTime);
  }

  public update(dt: number, velocity: Vector3, focus: Vector3 | null, focusWeight: number, phase: number): void {
    this.time += dt;
    this.tmp.copyFrom(velocity).scaleInPlace(0.35);
    this.tmp.y = 0;
    Vector3.LerpToRef(this.lookAhead, this.tmp, damp(2.5, dt), this.lookAhead);
    if (focus && focusWeight > 0) {
      this.tmp.set((focus.x - this.targetPosition.x) * 0.3 * focusWeight, 0, (focus.z - this.targetPosition.z) * 0.3 * focusWeight);
    } else {
      this.tmp.setAll(0);
    }
    Vector3.LerpToRef(this.focusOffset, this.tmp, damp(1.2, dt), this.focusOffset);
    this.tmp.copyFrom(this.targetPosition).addInPlace(this.lookAhead).addInPlace(this.focusOffset);
    Vector3.LerpToRef(this.center, this.tmp, damp(4.5, dt), this.center);
    this.distance += (this.distanceTarget - this.distance) * damp(0.8, dt);

    // Scripted shot timeline
    let w = 0, dist = 0, pitch = 0, yaw = 0;
    if (this.shot) {
      const s = this.shot;
      this.shotT += dt;
      const total = s.inTime + s.hold + s.outTime;
      const crossed = s.releaseBeyondZ !== undefined && this.targetPosition.z > s.releaseBeyondZ;
      const walkedAway = s.releaseBeyondZ === undefined && s.releaseOnMove && this.shotT > s.inTime * 0.5 &&
        Vector3.Distance(this.shotStart, this.targetPosition) > 2.5;
      if ((crossed || walkedAway) && this.shotT < s.inTime + s.hold) this.beginRelease(s);
      w = this.shotWeight;
      dist = s.distance; pitch = s.pitch; yaw = s.yawOffset;
      if (this.shotT >= total) this.shot = null;
    }

    if (this.shake > 0.002) {
      const s = this.shake;
      this.shakeOffset.set(Math.sin(this.time * 37) * s, Math.sin(this.time * 41 + 1) * s * 0.6, Math.cos(this.time * 33) * s);
      this.shake *= Math.exp(-dt * 6);
    } else {
      this.shakeOffset.setAll(0);
      this.shake = 0;
    }
    const shotFov = this.shot?.fov ?? BASE_FOV;
    this.camera.fov = BASE_FOV + (shotFov - BASE_FOV) * w - phase * 0.018;
    this.apply(w, dist, pitch, yaw);
    this.updateOcclusion(dt);
  }

  private apply(w: number, shotDist: number, shotPitch: number, shotYaw = 0): void {
    const ease = smoothstep(0, 1, this.intro);
    let dist = 6.5 + (this.distance - 6.5) * ease;
    let pitch = 0.3 + (this.basePitch - 0.3) * ease;
    let yaw = this.baseYaw;
    if (this.vW > 0.001) {
      const vw = smoothstep(0, 1, this.vW) * ease;
      dist += (this.vDist - dist) * vw;
      pitch += (this.vPitch - pitch) * vw;
      yaw += this.vYaw * vw;
    }
    // Controls are relative to the follow view (vantages included, scripted shots not),
    // so W always moves up the screen during ordinary play
    this.forward.set(-Math.sin(yaw), Math.cos(yaw));
    this.right.set(this.forward.y, -this.forward.x);
    // The camera always orbits the protagonist; a shot changes where it stands and
    // where it looks, so the protagonist stays in frame and gives the reveal its scale
    this.tmp2.copyFrom(this.center);
    let lx = 0, ly = 0, lz = 0;
    if (w > 0 && this.shot) {
      dist += (shotDist - dist) * w;
      pitch += (shotPitch - pitch) * w;
      yaw += shotYaw * w;
      const f = this.shot.focus, k = this.shot.focusWeight * w;
      lx = (f.x - this.tmp2.x) * k; ly = (f.y - this.tmp2.y) * k; lz = (f.z - this.tmp2.z) * k;
    }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x = this.tmp2.x + dist * cp * Math.sin(yaw);
    const y = this.tmp2.y + dist * sp;
    const z = this.tmp2.z - dist * cp * Math.cos(yaw);
    this.camera.position.set(x + this.shakeOffset.x, y + this.shakeOffset.y, z + this.shakeOffset.z);
    const lookY = 1.0 + (1 - ease) * 0.2;
    this.tmp.set(this.tmp2.x + lx + this.shakeOffset.x, this.tmp2.y + lookY + ly, this.tmp2.z + lz + this.shakeOffset.z);
    this.camera.setTarget(this.tmp);
  }

  // Fade structures that stand between the camera and the protagonist
  private updateOcclusion(dt: number): void {
    this.occlusionTimer -= dt;
    if (this.occlusionTimer <= 0 && this.occluders.length) {
      this.occlusionTimer = 0.1;
      const from = this.camera.position;
      this.tmp.copyFrom(this.targetPosition); this.tmp.y += 1.1;
      this.tmp.subtractInPlace(from);
      const len = this.tmp.length();
      this.ray.origin.copyFrom(from);
      this.ray.direction.copyFrom(this.tmp).scaleInPlace(1 / len);
      this.ray.length = len - 0.8;
      for (const m of this.occluders) {
        const hit = this.ray.intersectsMesh(m, false).hit;
        this.occluderFade.set(m, hit ? 0.25 : 1);
      }
    }
    for (const m of this.occluders) {
      const target = this.occluderFade.get(m) ?? 1;
      m.visibility += (target - m.visibility) * damp(5, dt);
    }
  }
}
