import {
  Scene, Mesh, MeshBuilder, PointLight, Vector3, Color3, StandardMaterial, DynamicTexture,
  LinesMesh, Engine, Material
} from '@babylonjs/core';
import { ParticleField, FieldContext } from './ParticleField';
import { damp, clamp01 } from '../core/rng';

export type FireState = 'dismissed' | 'summoning' | 'active' | 'dismissing';

export interface FirePulse { pos: Vector3; radius: number; strength: number; }

/**
 * The palm fire. Not a weapon: a small, impossible flame made of cubic fragments
 * that orbit, separate and reassemble, shedding embers that sometimes retrace
 * their own path, and dark ash that swallows light. It lights the protagonist's
 * hand and nearby ground, can be gathered (charge) and released as a pulse that
 * reveals what the world is hiding, and is the cue for phasing.
 */
export class PalmFire {
  public state: FireState = 'dismissed';
  public strength = 0;           // 0..1 presence
  public charge = 0;             // 0..1 gathered
  // Fuel: drains in the Void, recovers elsewhere. Shown only through the flame itself.
  public fuel = 1;
  public static readonly VOID_DRAIN = 0.085;   // per second (≈ 12 s of Void from full)
  public static readonly REGEN = 0.12;
  public static readonly PULSE_COST = 0.08;    // + 0.18 × gathered charge
  public static readonly EMBER_COST = 0.12;
  public onGuttered?: () => void;               // went out for lack of fuel
  public onRefusedSummon?: () => void;
  public resonance = 0;          // 0..1 set by the world when an anomaly is near
  public phaseTint = 0;          // 0..1 shifts toward chalk-white while phasing
  public position = new Vector3();
  public light: PointLight;
  public onPulse?: (p: FirePulse) => void;
  /** Where the protagonist stands and which way is up there: pulses spread along that surface. */
  public readonly feet = new Vector3();
  public readonly surfaceUp = new Vector3(0, 1, 0);
  /** A landed ember keeps burning here for a while, lighting the ground (null when out). */
  public flare: { pos: Vector3; t: number } | null = null;
  public static readonly FLARE_TIME = 8;
  public onSummon?: () => void;
  public onDismiss?: () => void;

  private fragments: ParticleField;
  private embers: ParticleField;
  private ash: ParticleField;
  private core: Mesh;
  private glow: Mesh;
  private coreMat: StandardMaterial;
  private glowMat: StandardMaterial;
  private filaments: LinesMesh | null = null;
  private filamentLines: Vector3[][] = [];
  private filamentPairs: number[] = [];
  private filamentTimer = 0;
  private anchors: Vector3[] = [];
  private emitAccum = 0;
  private ashAccum = 0;
  private flash = 0;
  private time = 0;
  private summonT = 0;
  private seeker: { from: Vector3; to: Vector3; t: number } | null = null;
  private quality = 1;
  private readonly prevPos = new Vector3();
  private readonly vel = new Vector3();

  // Shockwaves and the thrown ember: one extra light, created once and never disabled
  private emberLight: PointLight;
  private emberCore: Mesh;
  private flareGlow: Mesh;
  private rings: { mesh: Mesh; t: number; radius: number }[] = [];
  private nextRing = 0;
  private emberFlash = 0;
  private readonly emberFlashPos = new Vector3();
  private readonly tmpUp = new Vector3();

  private static readonly FRAGMENTS = 22;
  private static readonly RING_TIME = 0.7;
  private static readonly FILAMENTS = 12;

  constructor(private scene: Scene) {
    this.light = new PointLight('palmFireLight', Vector3.Zero(), scene);
    this.light.diffuse = new Color3(1.0, 0.6, 0.27);
    this.light.specular = new Color3(0.5, 0.3, 0.12);
    this.light.range = 8;
    this.light.intensity = 0;
    this.light.renderPriority = 10;

    this.coreMat = new StandardMaterial('fireCoreMat', scene);
    this.coreMat.disableLighting = true;
    this.coreMat.emissiveColor = new Color3(1, 0.86, 0.6);
    this.core = MeshBuilder.CreateBox('fireCore', { size: 0.075 }, scene);
    this.core.material = this.coreMat;
    this.core.isPickable = false;

    // Soft restrained glow card
    const tex = new DynamicTexture('fireGlowTex', { width: 64, height: 64 }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,200,130,0.85)');
    grad.addColorStop(0.35, 'rgba(255,140,60,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    tex.hasAlpha = true;
    this.glowMat = new StandardMaterial('fireGlowMat', scene);
    this.glowMat.disableLighting = true;
    this.glowMat.diffuseTexture = tex;
    this.glowMat.opacityTexture = tex;
    this.glowMat.emissiveColor = new Color3(1, 0.75, 0.5);
    this.glowMat.alphaMode = Engine.ALPHA_ADD;
    this.glowMat.disableDepthWrite = true;
    this.glowMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.glow = MeshBuilder.CreatePlane('fireGlow', { size: 1.3 }, scene);
    this.glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.glow.material = this.glowMat;
    this.glow.isPickable = false;

    // Fragments: persistent cubes on breathing orbits around the palm
    this.fragments = new ParticleField(scene, {
      name: 'fireFragments', capacity: PalmFire.FRAGMENTS, blend: 'add', life: [0, 0],
      size: [0.035, 0.075], colorA: [1.0, 0.66, 0.28, 0.95], colorB: [1.0, 0.66, 0.28, 0.95],
      spin: 4, seed: 7,
      behavior: (f, i, c) => this.orbit(f, i, c)
    });
    for (let i = 0; i < PalmFire.FRAGMENTS; i++) this.fragments.spawn(0, -50, 0, 0, 0, 0, { alpha: 0 });

    // Cubic embers: rise, drift, and sometimes retrace part of their own path
    this.embers = new ParticleField(scene, {
      name: 'fireEmbers', capacity: 180, blend: 'add', life: [0.55, 1.4], size: [0.02, 0.05],
      colorA: [1.0, 0.74, 0.32, 1], colorB: [0.95, 0.3, 0.08, 0.6], fadeIn: 0.08, fadeOut: 0.45,
      drag: 1.6, gravity: 0.55, noise: { amp: 0.9, freq: 3.2, speed: 1.4 },
      contradict: { rate: 0.5, duration: 0.22 }, spin: 7, seed: 8, windResponse: 2.2
    });

    // Negative particles: dark fragments that obscure rather than emit
    this.ash = new ParticleField(scene, {
      name: 'fireAsh', capacity: 70, blend: 'alpha', life: [1.4, 3.0], size: [0.014, 0.04],
      colorA: [0.015, 0.014, 0.016, 0.0], colorB: [0.01, 0.01, 0.012, 0.75], fadeIn: 0.3, fadeOut: 0.3,
      drag: 1.2, gravity: 0.18, noise: { amp: 0.5, freq: 1.6, speed: 0.6 },
      fire: { radius: 1.2, strength: -0.6 }, spin: 1.5, seed: 9, windResponse: 1.4
    });

    for (let i = 0; i < PalmFire.FILAMENTS; i++) {
      this.filamentLines.push([Vector3.Zero(), Vector3.Zero()]);
      this.filamentPairs.push(-1, -1);
    }
    this.filaments = MeshBuilder.CreateLineSystem('fireFilaments', { lines: this.filamentLines, updatable: true }, scene);
    this.filaments.color = new Color3(1.0, 0.7, 0.4);
    this.filaments.alpha = 0.6;
    this.filaments.isPickable = false;

    this.emberLight = new PointLight('emberLight', new Vector3(0, -50, 0), scene);
    this.emberLight.diffuse = new Color3(1.0, 0.55, 0.22);
    this.emberLight.specular = new Color3(0.4, 0.22, 0.08);
    this.emberLight.range = 9;
    this.emberLight.intensity = 0;
    this.emberLight.renderPriority = 9;
    this.emberCore = MeshBuilder.CreateBox('emberCore', { size: 0.09 }, scene);
    this.emberCore.material = this.coreMat;
    this.emberCore.isPickable = false;
    this.emberCore.isVisible = false;
    this.flareGlow = this.glow.clone('flareGlow');
    this.flareGlow.isVisible = false;

    // Shockwave rings: a bright band at the edge of a disc, spread along the ground
    const rt = new DynamicTexture('fireRingTex', { width: 128, height: 128 }, scene, true);
    const rc = rt.getContext() as unknown as CanvasRenderingContext2D;
    const rg = rc.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,150,60,0)');
    rg.addColorStop(0.62, 'rgba(255,150,60,0.06)');
    rg.addColorStop(0.86, 'rgba(255,205,140,0.9)');
    rg.addColorStop(0.95, 'rgba(255,140,60,0.35)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    rc.fillStyle = rg;
    rc.fillRect(0, 0, 128, 128);
    rt.update();
    rt.hasAlpha = true;
    for (let i = 0; i < 3; i++) {
      const mat = new StandardMaterial('fireRingMat' + i, scene);
      mat.disableLighting = true;
      mat.diffuseTexture = rt;
      mat.opacityTexture = rt;
      mat.emissiveColor = new Color3(1, 0.7, 0.42);
      mat.alphaMode = Engine.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = false;
      const mesh = MeshBuilder.CreateDisc('fireRing' + i, { radius: 1, tessellation: 48 }, scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.isVisible = false;
      this.rings.push({ mesh, t: 1, radius: 1 });
    }
  }

  /** An expanding ring of fire along the surface at `at`, out to `radius`. */
  private shockwave(at: Vector3, up: Vector3, radius: number): void {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.t = 0;
    r.radius = radius;
    r.mesh.position.copyFrom(at).addInPlace(this.tmpUp.copyFrom(up).scaleInPlace(0.06));
    // The disc lies in its local XY plane; turn its normal to the surface up
    r.mesh.lookAt(r.mesh.position.add(up));
    r.mesh.isVisible = true;
  }

  private updateRings(dt: number): void {
    for (const r of this.rings) {
      if (r.t >= 1) { r.mesh.isVisible = false; continue; }
      r.t = Math.min(1, r.t + dt / PalmFire.RING_TIME);
      const e = 1 - Math.pow(1 - r.t, 3);
      r.mesh.scaling.setAll(Math.max(0.05, r.radius * e));
      r.mesh.visibility = (1 - r.t) * (1 - r.t) * 1.4;
    }
  }

  public setQuality(q: number): void {
    this.quality = q;
    this.embers.setQuality(0.4 + q * 0.6);
    this.ash.setQuality(0.4 + q * 0.6);
  }

  public get isPresent(): boolean { return this.state === 'active' || this.state === 'summoning'; }

  public summon(): void {
    if (this.isPresent) return;
    if (this.fuel < 0.15) { if (this.onRefusedSummon) this.onRefusedSummon(); return; }
    this.state = 'summoning';
    this.summonT = 0;
    if (this.onSummon) this.onSummon();
  }

  public dismiss(): void {
    if (!this.isPresent) return;
    this.state = 'dismissing';
    this.charge = 0;
    // Final exhale of ash
    for (let i = 0; i < 14; i++) {
      this.ash.spawn(this.position.x, this.position.y, this.position.z,
        (Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6);
    }
    if (this.onDismiss) this.onDismiss();
  }

  public toggle(): void { if (this.isPresent) this.dismiss(); else this.summon(); }

  /** Called while the gather input is held. */
  public gather(dt: number): void {
    if (this.state !== 'active') return;
    this.charge = Math.min(1, this.charge + dt / 1.1);
  }

  /**
   * Adds gathered charge in one step (touch taps). Same charge the held gather builds,
   * same maximum, same release. Returns the new charge.
   */
  public addCharge(amount: number): number {
    if (this.state !== 'active') return this.charge;
    this.charge = Math.min(1, this.charge + amount);
    this.flash = Math.max(this.flash, 0.35);   // each accepted tap is seen
    return this.charge;
  }

  /** Called when the gather input is released; releases a pulse if enough was gathered. */
  public release(): void {
    if (this.state !== 'active' || this.charge < 0.05) { this.charge = 0; return; }
    // A quick press still lets out a small pulse; holding longer makes it larger
    const c = Math.max(0.2, this.charge);
    this.fuel = Math.max(0, this.fuel - (PalmFire.PULSE_COST + 0.18 * c));
    this.charge = 0;
    this.flash = 1;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      const sp = 2.6 + c * 2.6;
      this.embers.spawn(this.position.x, this.position.y, this.position.z,
        Math.cos(a) * sp, 0.4 + Math.random() * 0.5, Math.sin(a) * sp, { life: 0.7 + c * 0.6 });
    }
    const radius = 4 + c * 5;
    this.shockwave(this.feet, this.surfaceUp, radius);
    this.emberFlash = 1;
    this.emberFlashPos.copyFrom(this.position);
    if (this.onPulse) this.onPulse({ pos: this.position.clone(), radius, strength: c });
  }

  /** Sends a single ember to a point on the ground, where it opens into a small pulse. */
  public sendTo(target: Vector3): void {
    if (this.state !== 'active' || this.seeker || this.fuel < PalmFire.EMBER_COST) return;
    this.fuel -= PalmFire.EMBER_COST;
    this.seeker = { from: this.position.clone(), to: target.clone(), t: 0 };
    // Only one ember burns at a time: throwing another puts out the last
    this.flare = null;
    this.flareGlow.isVisible = false;
    this.emberCore.scaling.setAll(1);
  }

  /** World points the filaments may reach toward when an anomaly resonates. */
  public setAnchors(points: Vector3[]): void { this.anchors = points; }

  private orbit(f: ParticleField, i: number, ctx: FieldContext): void {
    const s = f.seed[i];
    const t = this.time;
    const gather = 1 - this.charge * 0.45;
    const summonSpread = this.state === 'summoning' ? 1 + (1 - this.summonT) * 2.5 : 1;
    const dismissSpread = this.state === 'dismissing' ? 0.3 + this.strength * 0.7 : 1;
    // Occasional separation: a fragment drifts out and is drawn back
    const burst = Math.pow(Math.max(0, Math.sin(t * (0.6 + s * 0.5) + s * 40)), 8) * 0.12;
    const r = (0.07 + s * 0.1 + burst) * gather * summonSpread * dismissSpread * (1 + this.phaseTint * 0.6);
    const speed = (1.6 + s * 2.2) * (1 + this.resonance * 1.4 + this.charge * 1.5);
    const a = t * speed + s * 50;
    const tilt = s * 3.1;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const oy = Math.sin(a * 0.7 + tilt) * r * 0.6 + 0.04 + (s - 0.5) * 0.06;
    // The flame leans with the wind: outer fragments are carried further than inner ones
    const lean = ctx.wind ? r * 0.55 : 0;
    const lx = ctx.wind ? ctx.wind.x * lean : 0, lz = ctx.wind ? ctx.wind.z * lean : 0;
    f.px[i] = ctx.fire.x + ox * Math.cos(tilt) - oy * Math.sin(tilt) * 0.3 + lx;
    f.py[i] = ctx.fire.y + oy;
    f.pz[i] = ctx.fire.z + oz + lz;
    f.vx[i] = f.vy[i] = f.vz[i] = 0;
    f.alphaMul[i] = this.strength;
  }

  /** Advances fuel. In the Void the flame burns down; elsewhere it slowly recovers. */
  public updateFuel(dt: number, inVoid: boolean): void {
    if (this.isPresent && inVoid) this.fuel = Math.max(0, this.fuel - PalmFire.VOID_DRAIN * dt);
    else this.fuel = Math.min(1, this.fuel + PalmFire.REGEN * dt * (this.isPresent ? 0.6 : 1));
    if (this.fuel <= 0 && this.isPresent) {
      this.dismiss();
      if (this.onGuttered) this.onGuttered();
    }
  }

  public update(dt: number, palm: Vector3, ctx: FieldContext): void {
    this.time += dt;
    // Strength follows state
    if (this.state === 'summoning') {
      this.summonT = Math.min(1, this.summonT + dt / 0.6);
      this.strength = this.summonT;
      if (this.summonT >= 1) this.state = 'active';
    } else if (this.state === 'active') {
      this.strength += (1 - this.strength) * damp(6, dt);
    } else if (this.state === 'dismissing') {
      this.strength = Math.max(0, this.strength - dt / 0.45);
      if (this.strength <= 0) this.state = 'dismissed';
    } else {
      this.strength = 0;
    }
    if (this.state !== 'active') this.charge = Math.max(0, this.charge - dt * 2);

    this.prevPos.copyFrom(this.position);
    this.position.copyFrom(palm);
    this.vel.copyFrom(this.position).subtractInPlace(this.prevPos).scaleInPlace(1 / Math.max(dt, 1e-4));

    const f = this.strength;
    const c = this.charge;
    ctx.fire.copyFrom(this.position);
    ctx.fireStrength = f * (1 + c * 0.5);

    // Core + glow
    const flick = 0.92 + 0.05 * Math.sin(this.time * 13.1) + 0.03 * Math.sin(this.time * 29.3 + 1.7);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    // Low fuel: the flame shrinks and gutters
    const fuelK = 0.35 + 0.65 * Math.sqrt(this.fuel);
    const gutter = this.fuel < 0.25 ? 0.55 + 0.45 * Math.abs(Math.sin(this.time * 17.3) * Math.sin(this.time * 5.1)) : 1;
    const coreScale = f * fuelK * gutter * (0.85 + c * 0.9 + this.flash * 1.5) * flick;
    this.core.position.copyFrom(this.position);
    this.core.scaling.setAll(Math.max(0.0001, coreScale));
    this.core.rotation.y += dt * (1.5 + c * 5);
    this.core.rotation.x += dt * 0.9;
    this.core.isVisible = f > 0.01;
    const pale = this.phaseTint * 0.6 + this.resonance * 0.15;
    this.coreMat.emissiveColor.set(1, 0.86 + pale * 0.14, 0.6 + pale * 0.4);
    this.glow.position.copyFrom(this.position);
    this.glow.scaling.setAll(Math.max(0.0001, f * (0.75 + c * 0.6 + this.flash) * flick));
    this.glow.visibility = f * (0.55 + c * 0.25);
    this.glow.isVisible = f > 0.01;
    this.glowMat.emissiveColor.set(1, 0.72 + pale * 0.25, 0.48 + pale * 0.5);

    // Light: warm, gently breathing, brighter when gathered or just released
    this.light.position.set(this.position.x, this.position.y + 0.12, this.position.z);
    this.light.intensity = f * fuelK * gutter * (1.7 + c * 1.0 + this.flash * 2.0) * flick;
    this.light.range = 7.5 + c * 3 + this.flash * 4;
    this.light.diffuse.set(1.0, 0.6 + pale * 0.25, 0.27 + pale * 0.45);
    // Never disabled: toggling a light changes every material's defines and recompiles them

    // Emission: embers trail behind movement, ash drifts up
    const rate = (22 + c * 90 + this.resonance * 18) * f * (0.5 + this.quality * 0.5);
    this.emitAccum += rate * dt;
    while (this.emitAccum >= 1) {
      this.emitAccum -= 1;
      const ox = (Math.random() - 0.5) * 0.1, oz = (Math.random() - 0.5) * 0.1;
      this.embers.spawn(this.position.x + ox, this.position.y + 0.02, this.position.z + oz,
        (Math.random() - 0.5) * 0.5 - this.vel.x * 0.25, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5 - this.vel.z * 0.25);
    }
    this.ashAccum += (4 + c * 6) * f * dt;
    while (this.ashAccum >= 1) {
      this.ashAccum -= 1;
      this.ash.spawn(this.position.x + (Math.random() - 0.5) * 0.25, this.position.y + 0.05, this.position.z + (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.15, 0.15, (Math.random() - 0.5) * 0.15);
    }

    // Seeker ember toward a clicked point
    if (this.seeker) {
      const sk = this.seeker;
      sk.t = Math.min(1, sk.t + dt / 0.55);
      const t = sk.t;
      const x = sk.from.x + (sk.to.x - sk.from.x) * t;
      const z = sk.from.z + (sk.to.z - sk.from.z) * t;
      const y = sk.from.y + (sk.to.y - sk.from.y) * t + Math.sin(t * Math.PI) * 1.2;
      for (let k = 0; k < 5; k++) this.embers.spawn(x, y, z, (Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4, { life: 0.6 });
      // The thrown ember is a small, bright piece of the flame and lights what it passes
      this.emberCore.isVisible = true;
      this.emberCore.position.set(x, y, z);
      this.emberCore.rotation.y += dt * 9; this.emberCore.rotation.x += dt * 6;
      this.emberLight.position.set(x, y + 0.2, z);
      if (t >= 1) {
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * Math.PI * 2;
          this.embers.spawn(sk.to.x, sk.to.y + 0.1, sk.to.z, Math.cos(a) * 2.6, 0.6, Math.sin(a) * 2.6, { life: 0.7 });
        }
        this.shockwave(sk.to, Vector3.UpReadOnly, 3);
        this.flare = { pos: sk.to.clone(), t: PalmFire.FLARE_TIME };
        this.emberCore.isVisible = false;
        if (this.onPulse) this.onPulse({ pos: sk.to.clone(), radius: 3, strength: 0.6 });
        this.seeker = null;
      }
    }

    // A landed ember burns on the ground for a while and lights it
    if (this.flare) {
      const fl = this.flare;
      fl.t -= dt;
      const life = fl.t / PalmFire.FLARE_TIME;
      const k = Math.min(1, fl.t / 1.5);   // gutters out over the last 1.5 s
      const flick = 0.85 + 0.1 * Math.sin(this.time * 11.3) + 0.05 * Math.sin(this.time * 23.7);
      if (Math.random() < (6 + 10 * k) * dt * 2) {
        this.embers.spawn(fl.pos.x + (Math.random() - 0.5) * 0.3, fl.pos.y + 0.05, fl.pos.z + (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3, { life: 0.9 });
      }
      this.emberLight.position.set(fl.pos.x, fl.pos.y + 0.6, fl.pos.z);
      this.emberLight.intensity = 3.2 * k * flick * (0.7 + 0.3 * life);
      this.emberLight.range = 8 + 2 * k;
      // The burning piece itself: a tumbling bright cube in a soft glow
      this.emberCore.isVisible = true;
      this.emberCore.position.set(fl.pos.x, fl.pos.y + 0.12 + Math.sin(this.time * 3.1) * 0.03, fl.pos.z);
      this.emberCore.rotation.y += dt * 2.5; this.emberCore.rotation.x += dt * 1.3;
      this.emberCore.scaling.setAll(Math.max(0.0001, (1.2 + 0.4 * flick) * k));
      this.flareGlow.isVisible = true;
      this.flareGlow.position.copyFrom(this.emberCore.position);
      this.flareGlow.scaling.setAll(Math.max(0.0001, 1.3 * k * flick));
      this.flareGlow.visibility = 0.8 * k;
      if (fl.t <= 0) { this.flare = null; this.emberCore.isVisible = false; this.flareGlow.isVisible = false; this.emberCore.scaling.setAll(1); }
    } else if (this.seeker) {
      this.emberLight.intensity = 1.4;
      this.emberLight.range = 6;
    } else if (this.emberFlash > 0) {
      // A released pulse lights everything around for a moment
      this.emberLight.position.set(this.emberFlashPos.x, this.emberFlashPos.y + 0.4, this.emberFlashPos.z);
      this.emberLight.intensity = 4 * this.emberFlash;
      this.emberLight.range = 10 + 4 * (1 - this.emberFlash);
    } else {
      this.emberLight.intensity = 0;
    }
    this.emberFlash = Math.max(0, this.emberFlash - dt * 2.2);
    this.updateRings(dt);

    this.fragments.update(ctx);
    this.embers.update(ctx);
    this.ash.update(ctx);
    this.updateFilaments(dt);
  }

  private updateFilaments(dt: number): void {
    if (!this.filaments) return;
    const f = this.strength;
    this.filamentTimer -= dt;
    const fr = this.fragments;
    if (this.filamentTimer <= 0) {
      this.filamentTimer = 0.09 + Math.random() * 0.1;
      // Reselect which fragments are joined; some lines reach out to the world
      for (let k = 0; k < PalmFire.FILAMENTS; k++) {
        const active = Math.random() < 0.25 + this.charge * 0.5 + this.resonance * 0.3;
        if (!active || f < 0.2) { this.filamentPairs[k * 2] = -1; continue; }
        this.filamentPairs[k * 2] = Math.floor(Math.random() * fr.count);
        const reach = this.anchors.length > 0 && (this.resonance > 0.2 || this.phaseTint > 0.3) && k < 3;
        this.filamentPairs[k * 2 + 1] = reach ? -2 - Math.floor(Math.random() * this.anchors.length) : Math.floor(Math.random() * fr.count);
      }
    }
    for (let k = 0; k < PalmFire.FILAMENTS; k++) {
      const a = this.filamentPairs[k * 2], b = this.filamentPairs[k * 2 + 1];
      const line = this.filamentLines[k];
      if (a < 0 || a >= fr.count) { line[0].copyFrom(this.position); line[1].copyFrom(this.position); continue; }
      line[0].set(fr.px[a], fr.py[a], fr.pz[a]);
      if (b <= -2 && this.anchors.length === 0) {
        // Its anchor went out of range since the pair was chosen
        line[1].copyFrom(line[0]);
      } else if (b <= -2) {
        const anchor = this.anchors[(-b - 2) % this.anchors.length];
        // A short thread leaning toward the anomaly, never a beam: at most ~1.6 m
        const dx = anchor.x - line[0].x, dy = anchor.y - line[0].y, dz = anchor.z - line[0].z;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const reach = Math.min(dist, (0.5 + 1.1 * clamp01(this.resonance + this.phaseTint * 0.5)) * (0.6 + Math.random() * 0.4));
        line[1].set(line[0].x + dx / dist * reach, line[0].y + dy / dist * reach, line[0].z + dz / dist * reach);
      } else if (b >= 0 && b < fr.count) {
        line[1].set(fr.px[b], fr.py[b], fr.pz[b]);
      } else {
        line[1].copyFrom(line[0]);
      }
    }
    MeshBuilder.CreateLineSystem('fireFilaments', { lines: this.filamentLines, instance: this.filaments });
    this.filaments.alpha = (0.15 + 0.35 * (this.charge + this.resonance * 0.5)) * f;
    this.filaments.color.set(1, 0.7 + this.phaseTint * 0.25, 0.4 + this.phaseTint * 0.5);
    this.filaments.isVisible = f > 0.05;
  }

  public reset(): void {
    this.fuel = 1;
    this.state = 'dismissed';
    this.strength = 0; this.charge = 0; this.flash = 0; this.seeker = null;
    this.flare = null; this.emberFlash = 0; this.emberLight.intensity = 0; this.emberCore.isVisible = false; this.flareGlow.isVisible = false;
    for (const r of this.rings) { r.t = 1; r.mesh.isVisible = false; }
    this.embers.clear(); this.ash.clear();
  }
}
