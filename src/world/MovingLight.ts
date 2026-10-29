import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, DynamicTexture, Engine, Material } from '@babylonjs/core';
import { mulberry32 } from '../core/rng';
import type { RealityId } from '../core/Reality';

/**
 * Where the light is drawn to while the protagonist is past each point of the
 * route. It never moves as a marker would: it wanders around an anchor, goes out,
 * and returns somewhere else. Stage changes only happen while it is out of sight.
 */
export interface LightStage { fromZ: number; anchor: [number, number, number]; wander: [number, number, number]; }
export const LIGHT_STAGES: LightStage[] = [
  // Anchors sit low and far along the vantage sightlines, like a lantern down the line
  { fromZ: -999, anchor: [5, 3.2, 94], wander: [5, 1.2, 8] },     // among the trees ahead, right of the line
  { fromZ: 70, anchor: [-16, 4.5, 172], wander: [8, 1.5, 8] },    // crossed over the line, nearer the gap
  { fromZ: 140, anchor: [2, 6.5, 233], wander: [3, 1.2, 3] },     // above the far side: nothing there to hold it
  { fromZ: 206, anchor: [6, 14, 266], wander: [3, 2, 4] },        // up where the rising rail went
  { fromZ: 240, anchor: [2.5, 3.6, 297], wander: [2, 0.8, 2] },   // down at the end of the line
  { fromZ: 9999, anchor: [2, 3.1, 299.5], wander: [0, 0, 0] }    // the finale sets it here
];

export class MovingLight {
  public position = new Vector3();
  public visible = 0;                 // 0..1
  private glow: Mesh;
  private echo: Mesh;
  private core: Mesh;
  private glowMat: StandardMaterial;
  private stage = 0;
  private targetStage = 0;
  private t = 0;
  private outTimer = 0;               // seconds remaining while gone
  private nextOut = 22;
  private phaseOffset = 0;
  private rnd = mulberry32(31337);
  private forcedAnchor: Vector3 | null = null;
  private readonly anchor = new Vector3();

  constructor(scene: Scene) {
    const tex = new DynamicTexture('lightGlowTex', { width: 128, height: 128 }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,240,210,1)');
    g.addColorStop(0.12, 'rgba(255,215,160,0.75)');
    g.addColorStop(0.4, 'rgba(255,170,100,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    tex.update(); tex.hasAlpha = true;
    this.glowMat = new StandardMaterial('movingLightMat', scene);
    this.glowMat.disableLighting = true;
    this.glowMat.diffuseTexture = tex;
    this.glowMat.opacityTexture = tex;
    this.glowMat.emissiveColor = new Color3(1, 0.86, 0.62);
    this.glowMat.alphaMode = Engine.ALPHA_ADD;
    this.glowMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.glowMat.disableDepthWrite = true;
    this.glowMat.fogEnabled = false;   // a point of light reads through fog
    this.glow = MeshBuilder.CreatePlane('movingLight', { size: 4.5 }, scene);
    this.glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.glow.material = this.glowMat;
    this.glow.isPickable = false;
    this.echo = this.glow.clone('movingLightEcho');
    const coreMat = new StandardMaterial('movingLightCore', scene);
    coreMat.disableLighting = true;
    coreMat.emissiveColor = new Color3(1, 0.95, 0.85);
    coreMat.fogEnabled = false;
    this.core = MeshBuilder.CreateBox('movingLightCore', { size: 0.35 }, scene);
    this.core.material = coreMat;
    this.core.isPickable = false;
    this.core.parent = this.glow;
    this.setAnchor(0);
  }

  private setAnchor(i: number): void {
    const s = LIGHT_STAGES[i];
    this.anchor.set(s.anchor[0], s.anchor[1], s.anchor[2]);
  }

  /** The finale pins the light to a point (the lamp); null releases it. */
  public pin(p: Vector3 | null): void { this.forcedAnchor = p ? p.clone() : null; }

  public update(dt: number, playerZ: number, reality: RealityId, deranged: number): void {
    // Which stage the protagonist has reached
    for (let i = LIGHT_STAGES.length - 1; i >= 0; i--) {
      if (playerZ >= LIGHT_STAGES[i].fromZ) { this.targetStage = i; break; }
    }
    // Time runs backward for it in Deranged
    this.t += dt * (deranged > 0.5 ? -0.8 : 1);

    // Going out: periodically, and whenever its stage must change
    this.nextOut -= dt;
    const mustMove = this.targetStage !== this.stage;
    if (this.outTimer <= 0 && (this.nextOut <= 0 || mustMove)) {
      this.outTimer = 1.6 + this.rnd() * 2.2;
      this.nextOut = 18 + this.rnd() * 22;
    }
    let fade = 1;
    if (this.outTimer > 0) {
      this.outTimer -= dt;
      fade = 0;
      if (this.outTimer <= 0.4) {
        // Return somewhere else
        this.stage = this.targetStage;
        this.setAnchor(this.stage);
        this.phaseOffset = this.rnd() * 100;
      }
    }

    if (this.forcedAnchor) {
      Vector3.LerpToRef(this.position, this.forcedAnchor, 1 - Math.exp(-1.8 * dt), this.position);
      fade = 1;
    } else {
      const w = LIGHT_STAGES[this.stage].wander;
      const t = this.t * 0.11 + this.phaseOffset;
      // Irregular, slow, never quite repeating
      this.position.set(
        this.anchor.x + w[0] * (Math.sin(t * 1.0) * 0.7 + Math.sin(t * 2.31 + 1.3) * 0.3),
        this.anchor.y + w[1] * Math.sin(t * 1.7 + 0.4),
        this.anchor.z + w[2] * (Math.cos(t * 0.83) * 0.6 + Math.sin(t * 1.97 + 2.1) * 0.4));
    }
    this.visible += (fade - this.visible) * (1 - Math.exp(-(fade > this.visible ? 1.2 : 3.5) * dt));

    this.glow.position.copyFrom(this.position);
    const pulse = 0.85 + 0.15 * Math.sin(this.t * 2.1);
    // In the Void it is the brightest thing left; in Deranged, a second one moves the other way
    const k = reality === 'void' ? 1.35 : 1;
    this.glow.visibility = this.visible * pulse * k;
    this.glow.scaling.setAll(k);
    this.glow.isVisible = this.visible > 0.01;
    this.echo.isVisible = this.visible > 0.01 && deranged > 0.05;
    this.echo.visibility = this.visible * deranged * 0.6;
    this.echo.position.set(-this.position.x * 0.6 + 8, this.position.y * 0.7 + 6, this.position.z + Math.sin(-this.t * 0.4) * 14);
    this.glowMat.emissiveColor.set(1, 0.86 - (reality === 'void' ? 0.06 : 0), 0.62 + (reality === 'void' ? 0.1 : 0));
  }

  public reset(): void {
    this.stage = 0; this.targetStage = 0; this.t = 0; this.outTimer = 0; this.nextOut = 22;
    this.forcedAnchor = null; this.setAnchor(0); this.visible = 0;
  }
}
