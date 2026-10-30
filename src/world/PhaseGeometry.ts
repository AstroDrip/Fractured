import { RealityFX, VOID_TONE_GLSL } from '../graphics/RealityPlugin';
import {
  Scene, Mesh, MeshBuilder, ShaderMaterial, Effect, Vector2, Vector3, Vector4, Color3, StandardMaterial, Material
} from '@babylonjs/core';
import { mulberry32, smoothstep } from '../core/rng';
import { CROSSING, BRIDGE_Y, BARRIER_GHOST_TREE, GROUND_Y } from './layout';
import { ParticleField } from '../graphics/ParticleField';
import { R_NORMAL, R_VOID, R_DERANGED, existsIn } from '../core/Reality';
import type { RealityId } from '../core/Reality';

Effect.ShadersStore['phaseSurfaceVertexShader'] = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float solidity;
uniform float time;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vCell;
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main(void) {
  vec4 wp = world * vec4(position, 1.0);
  vCell = floor(wp.xyz * 2.5);
  // Unsolid geometry: its corners drift apart along a slow field
  float loose = 1.0 - solidity;
  vec3 j = vec3(h3(floor(wp.xyz * 2.0)), h3(floor(wp.xyz * 2.0) + 7.1), h3(floor(wp.xyz * 2.0) + 3.3)) - 0.5;
  wp.xyz += j * loose * 0.22 + vec3(0.0, sin(time * 0.8 + wp.z * 0.7) * 0.06 * loose, 0.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(world) * normal);
  gl_Position = viewProjection * wp;
}`;

Effect.ShadersStore['phaseSurfaceFragmentShader'] = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vCell;
uniform float solidity;
uniform float flameReveal;
uniform float reveal;
uniform float time;
uniform vec3 baseColor;
uniform vec3 accentColor;
uniform vec3 firePos;
uniform float fireIntensity;
uniform vec3 moonDir;
uniform vec3 moonColor;
uniform float ambient;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 cameraPos;
uniform float voidAmt;
uniform vec4 white;
uniform vec2 whiteK;
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
${VOID_TONE_GLSL}
void main(void) {
  float h = h3(vCell);
  float ghost = 0.07 + reveal * 0.5;
  // Void matter is only legible near the flame: far from it, it thins to traces
  float fr = mix(1.0, clamp(1.5 - length(vWorld - firePos) / 6.0, 0.22, 1.0), flameReveal);
  bool solid = h < solidity * fr * 1.02;
  bool faint = !solid && h < ghost;
  if (!solid && !faint) discard;

  vec3 n = normalize(vNormal);
  float sky = n.y * 0.5 + 0.5;
  vec3 lit = baseColor * (ambient * (0.55 + 0.45 * sky) + moonColor * max(dot(n, -moonDir), 0.0));
  vec3 L = firePos - vWorld;
  float d = length(L);
  float att = clamp(1.0 - d / 8.0, 0.0, 1.0);
  lit += vec3(1.0, 0.62, 0.3) * baseColor * fireIntensity * att * att * max(dot(n, L / max(d, 1e-3)), 0.0) * 1.6;

  vec3 col;
  if (solid) {
    // Blocks that have only just become solid carry a cold edge
    float edge = smoothstep(solidity * 1.02 - 0.12, solidity * 1.02, h) * (1.0 - step(0.999, solidity));
    col = lit + accentColor * edge * 0.6;
  } else {
    float shimmer = 0.6 + 0.4 * sin(time * 2.7 + h * 40.0);
    col = accentColor * (0.1 + reveal * 0.26) * shimmer + lit * 0.15;
  }
  float fd = length(cameraPos - vWorld) * fogDensity;
  float fog = clamp(exp(-fd * fd), 0.0, 1.0);
  vec3 outc = mix(fogColor, col, fog);
  // Void: solid footing the flame holds is white against the black; the faint traces of
  // what is not there stay dark (residue on the white, nothing on the black)
  if (voidAmt > 0.001) outc = mix(outc, rfVoidTone(col, vWorld, white, time, whiteK, solid ? 1.0 : 0.0), voidAmt);
  gl_FragColor = vec4(outc, 1.0);
}`;

export interface PhaseUniforms {
  time: number;
  firePos: Vector3;
  fireIntensity: number;
  fogColor: Color3;
  fogDensity: number;
  ambient: number;
  cameraPos: Vector3;
}

interface Group {
  name: string;
  realities: number;            // bitmask of realities this geometry exists in
  flameReveal: boolean;
  material: ShaderMaterial;
  fallback: StandardMaterial;
  meshes: Mesh[];
  samples: Vector3[];
  solidity: number;
  reveal: number;
  failed: boolean;
}

const MOON_DIR = new Vector3(-0.45, -1, 0.55).normalize();

/**
 * Geometry that belongs to one configuration of the world: the phase bridges
 * over the gap (only there while phased), the impossible fragment of the old
 * railway (only there while not), and the alternate version of the fallen tree.
 * PhaseGeometry is the one place that turns phase progress into visible state;
 * the walk grid owns what is walkable.
 */
export class PhaseGeometry {
  private groups: Group[] = [];
  private white = new Vector4();
  private whiteK = new Vector2();
  public residue: ParticleField;
  private residueBudget = 0;
  private prevSolid = new Map<Group, number>();

  constructor(private scene: Scene, ghostTree: Mesh) {
    const voidGroup = this.makeGroup('voidOnly', R_VOID, true, new Color3(0.2, 0.225, 0.25), new Color3(0.55, 0.78, 0.88));
    const matterGroup = this.makeGroup('matter', R_NORMAL | R_DERANGED, false, new Color3(0.17, 0.14, 0.11), new Color3(0.8, 0.68, 0.5));
    const derangedGroup = this.makeGroup('derangedOnly', R_DERANGED, false, new Color3(0.22, 0.24, 0.23), new Color3(0.7, 0.85, 0.75));

    for (const seg of CROSSING) {
      const voidOnly = seg.realities === R_VOID;
      const g = voidOnly ? voidGroup : matterGroup;
      const meshes = voidOnly ? this.buildBridge(seg.z0, seg.z1, seg.id) : this.buildFragment(seg.z0, seg.z1);
      for (const m of meshes) { m.material = g.material; g.meshes.push(m); }
      for (let z = seg.z0 + 0.5; z < seg.z1; z += 1.2) {
        g.samples.push(new Vector3(-1.2, BRIDGE_Y + 0.1, z), new Vector3(1.2, BRIDGE_Y + 0.1, z));
      }
    }
    // The fallen tree stands upright in the other configuration, a few metres away
    const tree = ghostTree.clone('ghostTree', null)!;
    tree.setEnabled(true);
    tree.position.set(BARRIER_GHOST_TREE.x, GROUND_Y - 0.1, BARRIER_GHOST_TREE.z);
    tree.scaling.setAll(1.35);
    tree.rotation.y = 1.1;
    tree.material = derangedGroup.material;
    derangedGroup.meshes.push(tree);
    for (let y = 1; y < 6; y += 1.5) derangedGroup.samples.push(new Vector3(tree.position.x, y, tree.position.z));

    this.residue = new ParticleField(scene, {
      name: 'phaseResidue', capacity: 260, blend: 'add', life: [0.6, 1.5], size: [0.02, 0.06],
      colorA: [0.62, 0.86, 0.96, 0.85], colorB: [0.25, 0.42, 0.52, 0.0], fadeIn: 0.05, fadeOut: 0.6,
      drag: 1.4, gravity: 0.2, noise: { amp: 0.4, freq: 1.4, speed: 0.6 },
      contradict: { rate: 0.8, duration: 0.25 }, spin: 4, seed: 31
    });
  }

  private makeGroup(name: string, realities: number, flameReveal: boolean, base: Color3, accent: Color3): Group {
    const material = new ShaderMaterial(name + 'Mat', this.scene, { vertex: 'phaseSurface', fragment: 'phaseSurface' }, {
      attributes: ['position', 'normal'],
      uniforms: ['world', 'viewProjection', 'solidity', 'flameReveal', 'reveal', 'time', 'baseColor', 'accentColor', 'firePos',
        'fireIntensity', 'moonDir', 'moonColor', 'ambient', 'fogColor', 'fogDensity', 'cameraPos', 'voidAmt', 'white', 'whiteK']
    });
    material.setColor3('baseColor', base);
    material.setColor3('accentColor', accent);
    material.setVector3('moonDir', MOON_DIR);
    material.setColor3('moonColor', new Color3(0.32, 0.36, 0.44));
    material.backFaceCulling = true;
    material.setFloat('flameReveal', flameReveal ? 1 : 0);

    const fallback = new StandardMaterial(name + 'Fallback', this.scene);
    fallback.diffuseColor = base;
    fallback.emissiveColor = accent.scale(0.15);
    fallback.transparencyMode = Material.MATERIAL_ALPHABLEND;

    const group: Group = { name, realities, flameReveal, material, fallback, meshes: [], samples: [], solidity: existsIn(realities, 'normal') ? 1 : 0, reveal: 0, failed: false };
    // If the shader cannot compile, fall back to plain translucency so the route stays readable
    material.onError = () => {
      group.failed = true;
      for (const m of group.meshes) m.material = fallback;
      console.warn(`Phase shader failed for ${name}; using fallback material`);
    };
    this.groups.push(group);
    return group;
  }

  private buildBridge(z0: number, z1: number, seed: number): Mesh[] {
    const rnd = mulberry32(500 + seed);
    const parts: Mesh[] = [];
    for (let z = z0 + 0.3; z < z1 - 0.1; z += 0.72 + (rnd() - 0.5) * 0.1) {
      const s = MeshBuilder.CreateBox('pSleeper', { width: 2.5, height: 0.13, depth: 0.27 }, this.scene);
      s.position.set((rnd() - 0.5) * 0.06, BRIDGE_Y - 0.065, z);
      s.rotation.y = (rnd() - 0.5) * 0.06;
      parts.push(s);
    }
    for (const side of [-1, 1]) {
      const r = MeshBuilder.CreateBox('pRail', { width: 0.07, height: 0.13, depth: z1 - z0 }, this.scene);
      r.position.set(side * 0.72, BRIDGE_Y + 0.065, (z0 + z1) / 2);
      parts.push(r);
    }
    const m = Mesh.MergeMeshes(parts, true, true)!;
    m.name = 'phaseBridge' + seed;
    m.isPickable = false;
    return [m];
  }

  // A piece of the real railway suspended in the gap, still carrying its own earth
  private buildFragment(z0: number, z1: number): Mesh[] {
    const rnd = mulberry32(777);
    const parts: Mesh[] = [];
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const slab = MeshBuilder.CreateBox('fragSlab', { width: 3.2, height: 0.5, depth: len }, this.scene);
    slab.position.set(0, BRIDGE_Y - 0.33, zc);
    parts.push(slab);
    // Earth hanging beneath it in shrinking layers
    for (let i = 0; i < 9; i++) {
      const w = 3.0 * (1 - i / 10) * (0.8 + rnd() * 0.3);
      const d = len * (1 - i / 11) * (0.8 + rnd() * 0.25);
      const b = MeshBuilder.CreateBox('fragEarth', { width: w, height: 0.5, depth: d }, this.scene);
      b.position.set((rnd() - 0.5) * 0.6, BRIDGE_Y - 0.8 - i * 0.45, zc + (rnd() - 0.5) * 0.8);
      b.rotation.y = (rnd() - 0.5) * 0.3;
      parts.push(b);
    }
    for (let z = z0 + 0.4; z < z1 - 0.2; z += 0.72) {
      const s = MeshBuilder.CreateBox('fSleeper', { width: 2.5, height: 0.13, depth: 0.27 }, this.scene);
      s.position.set((rnd() - 0.5) * 0.08, BRIDGE_Y - 0.03, z);
      s.rotation.y = (rnd() - 0.5) * 0.08;
      parts.push(s);
    }
    for (const side of [-1, 1]) {
      const r = MeshBuilder.CreateBox('fRail', { width: 0.07, height: 0.13, depth: len - 0.4 }, this.scene);
      r.position.set(side * 0.72, BRIDGE_Y + 0.1, zc);
      parts.push(r);
    }
    const m = Mesh.MergeMeshes(parts, true, true)!;
    m.name = 'gapFragment';
    m.isPickable = false;
    return [m];
  }

  /** Sample points of geometry the fire's filaments and pulses can find. */
  public anchorsNear(p: Vector3, radius: number, out: Vector3[]): Vector3[] {
    out.length = 0;
    for (const g of this.groups) {
      for (const s of g.samples) {
        if (Vector3.DistanceSquared(s, p) < radius * radius) out.push(s);
        if (out.length >= 6) return out;
      }
    }
    return out;
  }

  /** A pulse briefly shows hidden geometry within its radius, without making it walkable. */
  public reveal(pos: Vector3, radius: number): boolean {
    let any = false;
    for (const g of this.groups) {
      if (g.samples.some(s => Vector3.DistanceSquared(s, pos) < radius * radius)) {
        g.reveal = 1;
        any = true;
        this.emitFrom(g, 30);
      }
    }
    return any;
  }

  private emitFrom(g: Group, n: number): void {
    for (let k = 0; k < n && g.samples.length > 0; k++) {
      const s = g.samples[Math.floor(Math.random() * g.samples.length)];
      this.residue.spawn(s.x + (Math.random() - 0.5) * 0.8, s.y + Math.random() * 0.3, s.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
    }
  }

  /**
   * phase: transition progress from Normal toward target. A group's solidity blends
   * from "exists in Normal" to "exists in target" across the disagreement/overlap stages.
   */
  public update(dt: number, phase: number, target: RealityId, u: PhaseUniforms, fieldCtx: import('../graphics/ParticleField').FieldContext): void {
    const t = smoothstep(0.3, 0.7, phase);
    for (const g of this.groups) {
      const a = existsIn(g.realities, 'normal') ? 1 : 0, b = existsIn(g.realities, target) ? 1 : 0;
      g.solidity = a + (b - a) * t;
      g.reveal = Math.max(0, g.reveal - dt * 0.55);
      // Residue marks where reality changed, only while it is changing
      const prev = this.prevSolid.get(g) ?? g.solidity;
      const change = Math.abs(g.solidity - prev);
      this.prevSolid.set(g, g.solidity);
      this.residueBudget += change * 90;
      if (change > 0.001 && this.residueBudget >= 1) {
        const n = Math.floor(this.residueBudget);
        this.residueBudget -= n;
        this.emitFrom(g, n);
      }
      if (g.failed) {
        for (const m of g.meshes) m.visibility = Math.max(0.12 + g.reveal * 0.4, g.solidity);
        continue;
      }
      const m = g.material;
      m.setFloat('solidity', g.solidity);
      m.setFloat('reveal', g.reveal);
      m.setFloat('time', u.time);
      m.setVector3('firePos', u.firePos);
      m.setFloat('fireIntensity', u.fireIntensity);
      m.setColor3('fogColor', u.fogColor);
      m.setFloat('fogDensity', u.fogDensity);
      m.setFloat('ambient', u.ambient);
      m.setVector3('cameraPos', u.cameraPos);
      m.setFloat('voidAmt', RealityFX.voidAmount);
      this.white.set(RealityFX.white.x, RealityFX.white.y, RealityFX.white.z, RealityFX.whiteRadius);
      m.setVector4('white', this.white);
      this.whiteK.set(RealityFX.whiteUnstable, RealityFX.whiteDetail);
      m.setVector2('whiteK', this.whiteK);
    }
    this.residue.update(fieldCtx);
  }

  public reset(): void {
    for (const g of this.groups) g.reveal = 0;
    this.residue.clear();
  }
}
