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
  gust: 0
};

/**
 * Material plugin injected into every world StandardMaterial:
 *  - Void: discards matter in irregular world-space sections, except near the flame;
 *    fresh edges carry a faint cold filament. Shadow passes do not run plugins, so
 *    removed matter still casts its shadow — an intended clue.
 *  - Deranged: bands of geometry slide out of agreement with their neighbours.
 *  - Wind: vertex sway proportional to height in the mesh's own space (grass, trees),
 *    all driven by the same direction and gusts.
 * Each branch costs one uniform test when inactive.
 */
export class RealityPlugin extends MaterialPluginBase {
  private sway: number;

  constructor(material: Material, sway = 0) {
    super(material, 'RealityFX', 210, { REALITY_FX: false });
    this.sway = sway;
    this._enable(true);
  }

  public prepareDefines(defines: MaterialDefines): void {
    defines['REALITY_FX'] = true;
  }

  public getClassName(): string { return 'RealityPlugin'; }

  public getUniforms() {
    const decl = 'uniform float rfVoid; uniform float rfDer; uniform float rfTime; uniform vec4 rfFire; uniform vec4 rfWind; uniform float rfSway;';
    return {
      ubo: [
        { name: 'rfVoid', size: 1, type: 'float' },
        { name: 'rfDer', size: 1, type: 'float' },
        { name: 'rfTime', size: 1, type: 'float' },
        { name: 'rfFire', size: 4, type: 'vec4' },
        { name: 'rfWind', size: 4, type: 'vec4' },
        { name: 'rfSway', size: 1, type: 'float' }
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
          float rfHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
        CUSTOM_FRAGMENT_MAIN_BEGIN: `
          float rfEdge = 0.0;
          if (rfVoid > 0.001) {
            float n = rfHash(floor(vRfPos * 1.4)) * 0.55 + 0.45 * (0.5 + 0.5 * sin(vRfPos.x * 0.19 + vRfPos.z * 0.13 + sin(vRfPos.z * 0.07) * 2.0));
            float fd = length(vRfPos - rfFire.xyz);
            float keep = 1.0 - smoothstep(rfFire.w * 0.65, rfFire.w, fd);
            float thr = rfVoid * 0.7 * (1.0 - keep);   // partial shells remain, not nothing
            if (n < thr) discard;
            rfEdge = (1.0 - smoothstep(0.0, 0.02, n - thr)) * step(0.02, thr);
          }`,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
          color.rgb += vec3(0.06, 0.1, 0.12) * rfEdge;`
      };
    }
    return null;
  }
}
