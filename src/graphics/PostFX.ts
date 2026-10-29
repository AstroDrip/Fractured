import {
  Scene, Camera, DefaultRenderingPipeline, ImageProcessingConfiguration,
  ColorCurves, Color4, Vector2
} from '@babylonjs/core';

export type Quality = 'low' | 'medium' | 'high';

/**
 * Post-processing chosen for the art direction: tone mapping, cool-shadow /
 * warm-highlight grading, restrained bloom for the fire, vignette, light grain,
 * and a radial chromatic split from the flame on phase entry and exit only.
 * Chromatic split only ever appears inside that ring.
 */
export class PostFX {
  public pipeline: DefaultRenderingPipeline;
  private time = 0;
  private ringT = 1;
  private ringStrength = 0;
  private readonly ringCenter = new Vector2(0.5, 0.5);
  private readonly fireUV = new Vector2(0.5, 0.5);
  private heat = 0;

  constructor(private scene: Scene, private camera: Camera) {
    this.pipeline = new DefaultRenderingPipeline('main', true, scene, [camera]);
    const ip = this.pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    // Standard tone mapping: ACES and PBR Neutral crushed this low-key image to black (measured)
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_STANDARD;
    ip.exposure = 1.45;
    ip.contrast = 1.08;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.4;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    const curves = new ColorCurves();
    curves.globalSaturation = -8;
    curves.shadowsHue = 215; curves.shadowsDensity = 10; curves.shadowsSaturation = 15;
    curves.highlightsHue = 35; curves.highlightsDensity = 14; curves.highlightsSaturation = 10;
    ip.colorCurves = curves;
    ip.colorCurvesEnabled = true;
    this.pipeline.fxaaEnabled = true;
    this.pipeline.bloomThreshold = 0.62;
    this.pipeline.bloomWeight = 0.32;
    this.pipeline.bloomKernel = 48;
    this.pipeline.grain.intensity = 5;
    this.pipeline.grain.animated = true;

    // Phase interference: the pipeline's own radial chromatic aberration, centred on the
    // flame. Enabled once at zero so changing its strength never recompiles anything.
    // (A custom distortion pass placed in this HDR chain intermittently received a flat
    // input when the pipeline rebuilt; it was removed in favour of this.)
    this.pipeline.chromaticAberrationEnabled = true;
    this.pipeline.chromaticAberration.aberrationAmount = 0;
    this.pipeline.chromaticAberration.radialIntensity = 1.2;
  }

  public setQuality(q: Quality): void {
    this.pipeline.bloomEnabled = q !== 'low';
    this.pipeline.bloomScale = q === 'high' ? 0.75 : 0.5;
    this.pipeline.grainEnabled = q !== 'low';
  }

  /** Starts a phase interference ring from a screen-space point (0..1 UV). */
  public triggerRing(uv: Vector2, strength = 1): void {
    // A NaN centre makes the split sample nothing for red and blue: the whole frame turns green
    const ok = Number.isFinite(uv.x) && Number.isFinite(uv.y);
    this.ringCenter.set(ok ? Math.min(1, Math.max(0, uv.x)) : 0.5, ok ? Math.min(1, Math.max(0, uv.y)) : 0.5);
    this.ringT = 0;
    this.ringStrength = strength;
  }

  public update(dt: number, fireUV: Vector2, heat: number): void {
    this.time += dt;
    this.fireUV.copyFrom(fireUV);
    this.heat = heat;
    if (this.ringT < 1) {
      this.ringT = Math.min(1, this.ringT + dt / 0.9);
      this.ringStrength *= Math.exp(-dt * 2.2);
      if (this.ringT >= 1) this.ringStrength = 0;
    }
    // Radial split from the flame: rises fast, decays with the ring
    const ca = this.pipeline.chromaticAberration;
    ca.aberrationAmount = this.ringStrength * 28 * Math.sin(Math.min(1, this.ringT * 3) * Math.PI * 0.5);
    ca.centerPosition.set(this.ringCenter.x, this.ringCenter.y);
  }
}
