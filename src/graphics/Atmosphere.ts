import {
  Scene, HemisphericLight, DirectionalLight, ShadowGenerator, Vector3, Color3, Color4, Mesh, AbstractMesh
} from '@babylonjs/core';
import { ZONES } from '../world/layout';
import { smoothstep } from '../core/rng';

const MOON_DIR = new Vector3(-0.45, -1, 0.55).normalize();
const VOID_FOG = new Color3(0.024, 0.028, 0.036);       // near-black: the flame matters
const DERANGED_FOG = new Color3(0.085, 0.102, 0.094);  // a greenish grey no weather makes
const DERANGED_MOON = new Vector3(0.6, -0.9, -0.4).normalize();  // shadows that disagree

/**
 * Light and air. One cold sky light, one low moon, fog blended along the route
 * by narrative zone, and a phase response that clears and cools the air rather
 * than tinting the screen. The palm fire provides the only warm light.
 */
export class Atmosphere {
  public hemi: HemisphericLight;
  public moon: DirectionalLight;
  public shadows: ShadowGenerator | null = null;
  public fogColor = new Color3();
  public fogDensity = 0.03;
  public ambient = 0.25;
  public wind = 1;
  public space = 0.1;
  private readonly baseFog = new Color3();
  private readonly clear = new Color4(0, 0, 0, 1);
  private casters: AbstractMesh[] = [];

  constructor(private scene: Scene) {
    scene.fogMode = Scene.FOGMODE_EXP2;
    this.hemi = new HemisphericLight('sky', new Vector3(0.2, 1, -0.3), scene);
    this.hemi.diffuse = new Color3(0.42, 0.48, 0.58);
    this.hemi.groundColor = new Color3(0.07, 0.065, 0.06);
    this.hemi.specular = new Color3(0.05, 0.06, 0.07);
    this.moon = new DirectionalLight('moon', MOON_DIR.clone(), scene);
    this.moon.diffuse = new Color3(0.5, 0.57, 0.7);
    this.moon.specular = new Color3(0.18, 0.2, 0.25);
    this.moon.intensity = 0.85;
    this.moon.renderPriority = 5;
  }

  /** Adds casters later (e.g. the skinned protagonist, which loads asynchronously). */
  public addShadowCasters(casters: AbstractMesh[]): void {
    this.casters = [...this.casters, ...casters];
    if (this.shadows) for (const c of casters) this.shadows.addShadowCaster(c, false);
  }

  public setShadowCasters(casters: AbstractMesh[]): void {
    this.casters = casters;
    if (this.shadows) for (const c of casters) this.shadows.addShadowCaster(c, false);
  }

  /**
   * Shadows only at medium/high quality; the blob shadow carries the character otherwise.
   * The generator is created once: disposing and recreating it at runtime crashed
   * Babylon's material readiness checks, so later changes only toggle it (a new
   * resolution applies on the next load). Resolves once every caster's depth shader
   * is compiled: until then the receivers (all terrain and track) are not drawn.
   */
  public setShadowQuality(size: 0 | 1024 | 2048): Promise<void> {
    if (this.shadows) {
      this.moon.shadowEnabled = size > 0;
      return Promise.resolve();
    }
    if (size === 0) {
      this.moon.shadowEnabled = false;
      return Promise.resolve();
    }
    this.moon.shadowFrustumSize = 40;
    this.moon.shadowMinZ = 1;
    this.moon.shadowMaxZ = 90;
    this.moon.autoUpdateExtends = false;
    this.shadows = new ShadowGenerator(size, this.moon);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.darkness = 0.4;
    this.shadows.bias = 0.0015;
    this.shadows.normalBias = 0.02;
    for (const c of this.casters) this.shadows.addShadowCaster(c, false);
    this.moon.shadowEnabled = true;
    return this.shadows.forceCompilationAsync().catch(() => undefined);
  }

  private readonly moonDir = MOON_DIR.clone();
  private readonly hemiUp = new Vector3(0.2, 1, -0.3);
  private readonly hemiDown = new Vector3(0.2, -1, 0.3);

  /** voidAmt / derangedAmt: 0..1, how far the world has resolved into each reality. */
  public update(playerPos: Vector3, voidAmt: number, derangedAmt: number): void {
    const phase = Math.max(voidAmt, derangedAmt);
    // Blend zone parameters along Z
    const z = playerPos.z;
    let a = ZONES[0], b = ZONES[0], t = 0;
    if (z <= ZONES[0].z) { a = b = ZONES[0]; }
    else if (z >= ZONES[ZONES.length - 1].z) { a = b = ZONES[ZONES.length - 1]; }
    else {
      for (let i = 0; i < ZONES.length - 1; i++) {
        if (z >= ZONES[i].z && z < ZONES[i + 1].z) {
          a = ZONES[i]; b = ZONES[i + 1];
          t = smoothstep(0, 1, (z - a.z) / (b.z - a.z));
          break;
        }
      }
    }
    const mix = (u: number, v: number) => u + (v - u) * t;
    this.baseFog.set(mix(a.fog[0], b.fog[0]), mix(a.fog[1], b.fog[1]), mix(a.fog[2], b.fog[2]));
    const density = mix(a.density, b.density);
    this.ambient = mix(a.ambient, b.ambient);
    this.wind = mix(a.wind, b.wind);
    this.space = mix(a.space, b.space);

    // Phasing: the air thins and cools; what is hidden becomes legible
    Color3.LerpToRef(this.baseFog, VOID_FOG, voidAmt * 0.85, this.fogColor);
    Color3.LerpToRef(this.fogColor, DERANGED_FOG, derangedAmt * 0.7, this.fogColor);
    this.fogDensity = density * (1 - voidAmt * 0.3) * (1 + derangedAmt * 0.1);
    this.scene.fogColor = this.fogColor;
    this.scene.fogDensity = this.fogDensity;
    this.clear.set(this.fogColor.r, this.fogColor.g, this.fogColor.b, 1);
    this.scene.clearColor = this.clear;

    // Void: the sky light nearly leaves. Deranged: light comes from below; the moon moves.
    this.hemi.intensity = this.ambient * 2.2 * (1 - voidAmt * 0.65) * (1 + derangedAmt * 0.15);
    this.hemi.diffuse.set(0.42 - phase * 0.06, 0.48 + derangedAmt * 0.06, 0.58 + voidAmt * 0.05);
    Vector3.LerpToRef(this.hemiUp, this.hemiDown, smoothstep(0.4, 0.9, derangedAmt), this.hemi.direction);
    this.moon.intensity = 0.85 * (1 - voidAmt * 0.6) + derangedAmt * 0.1;
    Vector3.LerpToRef(MOON_DIR, DERANGED_MOON, derangedAmt, this.moonDir);
    this.moonDir.normalize();
    this.moon.direction.copyFrom(this.moonDir);

    if (this.shadows) {
      // Follow the protagonist, snapped to shadow texels so edges do not crawl
      const size = this.shadows.getShadowMap()!.getSize().width;
      const texel = this.moon.shadowFrustumSize / size;
      const sx = Math.round(playerPos.x / texel) * texel, sz = Math.round(playerPos.z / texel) * texel;
      this.moon.position.set(sx - this.moonDir.x * 45, playerPos.y - this.moonDir.y * 45, sz - this.moonDir.z * 45);
    }
  }

  public static markReceivers(meshes: Mesh[]): void {
    for (const m of meshes) m.receiveShadows = true;
  }
}
