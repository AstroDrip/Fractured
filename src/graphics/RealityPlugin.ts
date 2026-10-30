import { MaterialPluginBase, Material, UniformBuffer, Vector3, MaterialDefines } from '@babylonjs/core';

/**
 * World-wide state read by every world material each draw. Written once per frame
 * by the game, so all surfaces agree about the reality and the wind.
 */
export const RealityFX = {
  voidAmount: 0,          // 0..1 how much matter has left (Void)
  deranged: 0,            // 0..1 how far geometry disagrees with itself (Deranged)
  time: 0,
  fire: new Vector3(),
  fireRadius: 0,          // matter within this distance of the flame stays (Void)
  windX: 1, windZ: 0,     // shared wind direction (unit)
  windStrength: 0.3,      // 0..1
  gust: 0,
  // The travelling vortex: vegetation near it bends around it, nothing far away does
  vortexX: 0, vortexZ: 0, vortexRadius: 2, vortexStrength: 0,
  // The flame's pocket in the dark: fog thinned and grass pushed around the held flame,
  // and around the thrown flame and its impact (radius already scaled by strength)
  hold: new Vector3(0, -100, 0), holdRadius: 0,
  infl: new Vector3(0, -100, 0), inflRadius: 0,
  // Void: the world is black except a white fragment around the flame. Its radius,
  // how unstable its edge is (rises as fuel falls) and how much surface detail survives
  white: new Vector3(0, -100, 0), whiteRadius: 0, whiteUnstable: 0, whiteDetail: 1
};

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/**
 * The flame's white fragment in Void, from the existing fuel (no second resource):
 * radius in metres (shrinks with fuel), edge instability 0..1 (rises as fuel falls),
 * surviving detail 0..1 (thins as fuel falls). Nothing without the flame.
 */
export function voidWhite(fuel: number, strength: number, present: boolean): { radius: number; unstable: number; detail: number } {
  if (!present) return { radius: 0, unstable: 1, detail: 0 };
  const f = Math.min(1, Math.max(0, fuel));
  return {
    radius: (1.8 + 4.6 * Math.sqrt(f)) * (0.75 + 0.25 * Math.min(1, Math.max(0, strength))),
    unstable: 1 - ss(0.05, 0.45, f),
    detail: 0.35 + 0.65 * ss(0.08, 0.5, f)
  };
}

/**
 * The Void image, shared by every shader that draws the world (this plugin and the phase
 * geometry): absolute black beyond the flame's white fragment; inside it ground (tone 1)
 * is stark white and objects (tone 0) dark silhouettes keeping a little surface detail.
 * white = flame position + radius; k = (edge instability 0..1, detail 0..1).
 */
export const VOID_TONE_GLSL = `
vec3 rfVoidTone(vec3 col, vec3 pos, vec4 white, float time, vec2 k, float tone) {
  vec3 wd = pos - white.xyz;
  float wr = length(vec2(length(wd.xz), wd.y * 0.6));
  float wa = atan(wd.z, wd.x);
  // A ragged, slowly crawling edge; it shakes more as the fuel runs out
  float rag = sin(wa * 3.0 + time * 0.6) * 0.5 + sin(wa * 7.0 - time * 1.4) * 0.3 + sin(wa * 13.0 + time * 3.1 * (1.0 + k.x * 2.0)) * 0.2;
  float wR = white.w * (1.0 + rag * (0.07 + 0.2 * k.x));
  float inside = 1.0 - smoothstep(wR * 0.9, wR, wr);
  float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)) * 2.6, 0.0, 1.0);
  float det = k.y * (1.0 - smoothstep(wR * 0.45, wR * 0.95, wr) * 0.6);
  vec3 pale = vec3(0.95, 0.948, 0.94) - (1.0 - lum) * 0.22 * det;
  vec3 dark = vec3(0.045, 0.044, 0.046) + lum * 0.16 * det;
  return mix(dark, pale, tone) * inside;
}`;

/**
 * Material plugin injected into every world StandardMaterial:
 *  - Void: discards matter in irregular world-space sections, except near the flame;
 *    fresh edges carry a faint cold filament. Shadow passes do not run plugins, so
 *    removed matter still casts its shadow — an intended clue. Then the image itself:
 *    everything beyond the flame's white fragment is absolute black; inside it, ground
 *    (tone 1) is stark white and objects (tone 0) are dark silhouettes, keeping a little
 *    of their own surface detail. The fragment's edge is ragged and grows unstable,
 *    and the detail thins, as the flame's fuel falls. Applied after fog, so no fog colour
 *    or sky light survives in Void.
 *  - Deranged: bands of geometry slide out of agreement with their neighbours.
 *  - Wind: vertex sway proportional to height in the mesh's own space (grass, trees),
 *    all driven by the same direction and gusts, plus a local swirl around the
 *    travelling vortex (falls off with distance from its centre).
 * Each branch costs one uniform test when inactive.
 */
export class RealityPlugin extends MaterialPluginBase {
  private sway: number;
  private tone: number;
  private dissolve: number;
  private out: string;          // the fragment's colour variable: Standard 'color', PBR 'finalColor'

  /** tone: 1 for ground that turns white in Void, 0 for objects that turn dark. dissolve: false to keep matter whole. */
  constructor(material: Material, sway = 0, tone = 0, dissolve = true) {
    super(material, 'RealityFX', 210, { REALITY_FX: false });
    this.sway = sway;
    this.tone = tone;
    this.dissolve = dissolve ? 1 : 0;
    this.out = material.getClassName() === 'PBRMaterial' ? 'finalColor' : 'color';
    this._enable(true);
  }

  public prepareDefines(defines: MaterialDefines): void {
    defines['REALITY_FX'] = true;
  }

  public getClassName(): string { return 'RealityPlugin'; }

  public getUniforms() {
    const decl = 'uniform float rfVoid; uniform float rfDer; uniform float rfTime; uniform vec4 rfFire; uniform vec4 rfWind; uniform float rfSway; uniform vec4 rfVortex; uniform vec4 rfHold; uniform vec4 rfInfl; uniform vec4 rfWhite; uniform vec4 rfTone;';
    return {
      ubo: [
        { name: 'rfVoid', size: 1, type: 'float' },
        { name: 'rfDer', size: 1, type: 'float' },
        { name: 'rfTime', size: 1, type: 'float' },
        { name: 'rfFire', size: 4, type: 'vec4' },
        { name: 'rfWind', size: 4, type: 'vec4' },
        { name: 'rfSway', size: 1, type: 'float' },
        { name: 'rfVortex', size: 4, type: 'vec4' },
        { name: 'rfHold', size: 4, type: 'vec4' },
        { name: 'rfInfl', size: 4, type: 'vec4' },
        { name: 'rfWhite', size: 4, type: 'vec4' },
        { name: 'rfTone', size: 4, type: 'vec4' }
      ],
      vertex: decl,
      fragment: decl
    };
  }

  public bindForSubMesh(ubo: UniformBuffer): void {
    const s = RealityFX;
    ubo.updateFloat('rfVoid', s.voidAmount);
    ubo.updateFloat('rfDer', s.deranged);
    ubo.updateFloat('rfTime', s.time);
    ubo.updateFloat4('rfFire', s.fire.x, s.fire.y, s.fire.z, s.fireRadius);
    ubo.updateFloat4('rfWind', s.windX, s.windZ, s.windStrength, s.gust);
    ubo.updateFloat('rfSway', this.sway);
    ubo.updateFloat4('rfVortex', s.vortexX, s.vortexZ, s.vortexRadius, s.vortexStrength);
    ubo.updateFloat4('rfHold', s.hold.x, s.hold.y, s.hold.z, s.holdRadius);
    ubo.updateFloat4('rfInfl', s.infl.x, s.infl.y, s.infl.z, s.inflRadius);
    ubo.updateFloat4('rfWhite', s.white.x, s.white.y, s.white.z, s.whiteRadius);
    ubo.updateFloat4('rfTone', this.tone, s.whiteUnstable, s.whiteDetail, this.dissolve);
  }

  public getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: 'varying vec3 vRfPos;',
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
          if (rfSway > 0.0) {
            float hh = max(positionUpdated.y, 0.0);
            float ph = worldPos.x * 0.35 + worldPos.z * 0.27;
            float sway = (0.6 + 0.4 * sin(rfTime * 1.7 + ph)) * rfWind.z + rfWind.w * 0.6;
            worldPos.xz += rfWind.xy * sway * hh * hh * rfSway;
            if (rfVortex.w > 0.001) {
              vec2 dv = worldPos.xz - rfVortex.xy;
              float dd = max(length(dv), 0.05);
              float vk = rfVortex.w * (1.0 - smoothstep(rfVortex.z * 0.4, rfVortex.z * 3.2, dd));
              vec2 tang = vec2(-dv.y, dv.x) / dd;
              worldPos.xz += (tang * 0.8 - dv / dd * 0.35) * vk * (0.75 + 0.25 * sin(rfTime * 6.0 + ph)) * hh * hh * rfSway;
            }
            // The flame pushes grass away from itself: a little around the hand, hard at an impact
            if (rfHold.w > 0.01) {
              vec2 dh = worldPos.xz - rfHold.xz; float lh = max(length(dh), 0.05);
              worldPos.xz += dh / lh * (1.0 - smoothstep(0.0, rfHold.w * 0.45, lh)) * 0.25 * hh * hh * rfSway;
            }
            if (rfInfl.w > 0.01) {
              vec2 di = worldPos.xz - rfInfl.xz; float li = max(length(di), 0.05);
              worldPos.xz += di / li * (1.0 - smoothstep(0.0, rfInfl.w * 0.7, li)) * (0.9 + 0.1 * sin(rfTime * 9.0 + ph)) * hh * hh * rfSway;
            }
          }
          if (rfDer > 0.001) {
            float band = step(0.5, fract(worldPos.y * 0.31 + floor(worldPos.z * 0.11) * 0.37));
            worldPos.x += sin(worldPos.z * 0.9 + rfTime * 0.7) * 0.09 * rfDer * band;
            worldPos.z += sin(worldPos.y * 1.3 - rfTime * 0.5) * 0.07 * rfDer * (1.0 - band);
          }
          vRfPos = worldPos.xyz;`
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `varying vec3 vRfPos;
          float rfHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          ${VOID_TONE_GLSL}`,
        CUSTOM_FRAGMENT_MAIN_BEGIN: `
          float rfEdge = 0.0;
          if (rfVoid > 0.001 && rfTone.w > 0.5) {
            float n = rfHash(floor(vRfPos * 1.4)) * 0.55 + 0.45 * (0.5 + 0.5 * sin(vRfPos.x * 0.19 + vRfPos.z * 0.13 + sin(vRfPos.z * 0.07) * 2.0));
            float fd = length(vRfPos - rfFire.xyz);
            float keep = 1.0 - smoothstep(rfFire.w * 0.65, rfFire.w, fd);
            float thr = rfVoid * 0.7 * (1.0 - keep);   // partial shells remain, not nothing
            if (n < thr) discard;
            rfEdge = (1.0 - smoothstep(0.0, 0.02, n - thr)) * step(0.02, thr);
          }`,
        CUSTOM_FRAGMENT_BEFORE_FOG: `
          vec3 rfPreFog = ${this.out}.rgb;`,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
          ${this.out}.rgb += vec3(0.06, 0.1, 0.12) * rfEdge;
          #ifdef FOG
          // Fog thins (never vanishes) near the flame; a ragged edge, not a clean circle
          // (smooth: a per-cell hash here drew a checkerboard of fog across lit ground)
          float rfRag = 0.75 + 0.25 * (0.5 + 0.5 * sin(vRfPos.x * 1.7 + sin(vRfPos.z * 1.3) * 2.0 + vRfPos.z * 0.6));
          float rfC = 0.0;
          if (rfHold.w > 0.01) rfC = max(rfC, (1.0 - smoothstep(rfHold.w * 0.25 * rfRag, rfHold.w * rfRag, length(vRfPos - rfHold.xyz))) * 0.4);
          if (rfInfl.w > 0.01) rfC = max(rfC, (1.0 - smoothstep(rfInfl.w * 0.2 * rfRag, rfInfl.w * rfRag, length(vRfPos - rfInfl.xyz))) * 0.75);
          ${this.out}.rgb = mix(${this.out}.rgb, rfPreFog, rfC);
          #endif
          if (rfVoid > 0.001) ${this.out}.rgb = mix(${this.out}.rgb, rfVoidTone(rfPreFog, vRfPos, rfWhite, rfTime, rfTone.yz, rfTone.x), rfVoid);`
      };
    }
    return null;
  }
}
