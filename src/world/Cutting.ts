import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Texture, Material, Vector3, VertexData, ParticleSystem } from '@babylonjs/core';
import type { IndicesArray } from '@babylonjs/core';
import { Materials } from './Materials';
import { ThinBatch } from './ThinBatch';
import { mulberry32 } from '../core/rng';
import { CUTTING, GROUND_Y, cuttingAt } from './layout';
import { EnvAssets } from './EnvAssets';

const WATER_FLOW = 0.035;      // texture units per second along the stream
const FALL_FLOW = 0.42;        // the waterfall runs much faster than the stream
const MAX_RIPPLES = 6;
const RIPPLE_LIFE = 3.5;       // seconds a ring takes to spread out and fade

/**
 * The cutting west of the line: the shelf under the cliff, the fallen trunk over the
 * cleft, the stream and the waterfall that feeds it, the culvert that takes it under
 * the line, and a length of track that runs into the rock. Terrain and the walk grid
 * carry the shape (layout CUTTING); this module adds what stands on it.
 */
export class Cutting {
  public meshes: Mesh[] = [];
  public shadowCasters: Mesh[] = [];
  private waterTex!: Texture;
  private fallTex!: Texture;
  private water!: Mesh;
  private waterBase!: Float32Array;
  private waterPos: Float32Array | null = null;
  private waterNrm: Float32Array | null = null;
  private waterIdx!: IndicesArray;
  private waterTime = 0;
  private ripples: { x: number; z: number; t: number; a: number }[] = [];
  private mist: ParticleSystem | null = null;
  private rnd = mulberry32(9001);
  /** World position of the stream's voice (the waterfall's foot). */
  public readonly waterVoice = new Vector3(CUTTING.waterfall.x + 1, CUTTING.stream.y, CUTTING.waterfall.z);

  constructor(private scene: Scene, private mats: Materials) {}

  public build(): void {
    this.buildRocks();
    this.buildTrunk();
    this.buildWater();
    this.buildRails();
    this.buildCulvert();
  }

  /** Rocks: irregular polyhedra, not boxes; heavier at the cliff foot and in the cleft. */
  private buildRocks(): void {
    // Authored rocks (Blender: displaced, cut by fracture planes); polyhedra if missing
    const authored = ['rockA', 'rockB', 'rockC'].map(n => EnvAssets.get(n)?.[0] ?? null);
    const shapes = [2, 3, 6].map((type, i) => {
      const src = authored[i];
      const m = src ? src.clone('cutRock' + i, null)! : MeshBuilder.CreatePolyhedron('cutRock' + i, { type, size: 0.5 }, this.scene);
      m.setEnabled(true);
      m.material = this.mats.stone;
      return new ThinBatch(m);
    });
    const b = CUTTING.bounds, cl = CUTTING.cleft, r = this.rnd;
    const put = (x: number, y: number, z: number, s: number) => {
      const t = 0.42 + r() * 0.16;   // weathered, dark: rock should not outshine the flame
      shapes[Math.floor(r() * shapes.length)].add(x, y, z, r() * 6.3, r() * 0.8, r() * 0.8,
        s * (0.9 + r() * 0.8), s * (0.5 + r() * 0.5), s * (0.8 + r() * 0.7), t, t * 0.97, t * 0.95);
    };
    // Along the cliff foot, beside (never on) the path
    for (let z = b.z0 + 1; z < b.z1 - 1; z += 0.9) {
      if (z > cl.z0 - 0.4 && z < cl.z1 + 0.4) continue;
      const x = CUTTING.cliff.x + 0.3 + r() * 1.4;
      if (cuttingAt(x, z).d < CUTTING.radius + 0.3) continue;
      put(x, cuttingAt(x, z).h - 0.15, z, 0.7 + r() * 1.4);
    }
    // In the cleft: boulders the stream runs between
    for (let i = 0; i < 26; i++) {
      const x = cl.x0 + 4 + r() * (cl.x1 - cl.x0 - 4.5), z = cl.z0 + 0.3 + r() * (cl.z1 - cl.z0 - 0.6);
      put(x, CUTTING.stream.y + 0.05, z, 0.4 + r() * 0.9);
    }
    // Scree on the embankment between the shelf and the line
    for (let i = 0; i < 40; i++) {
      const x = -10.5 + r() * 5.5, z = b.z0 + 4 + r() * (b.z1 - b.z0 - 8);
      if ((z > cl.z0 - 0.5 && z < cl.z1 + 0.5) || cuttingAt(x, z).d < CUTTING.radius + 0.4) continue;
      put(x, GROUND_Y + 0.3 + r() * 0.6, z, 0.25 + r() * 0.5);
    }
    for (const s of shapes) { const m = s.commit(); this.meshes.push(m); this.shadowCasters.push(m); }
  }

  /** The fallen trunk: tapered, its root plate torn up at the far end, branch stubs. */
  private buildTrunk(): void {
    const br = CUTTING.bridge;
    const len = br.z1 - br.z0 + 1.6;
    const topH = cuttingAt(br.x, (br.z0 + br.z1) / 2).h + 0.15;
    const trunk = MeshBuilder.CreateCylinder('trunkBridge', { height: len, diameterTop: 0.5, diameterBottom: 0.72, tessellation: 12 }, this.scene);
    trunk.material = this.mats.bark;
    trunk.rotation.x = Math.PI / 2;
    trunk.position.set(br.x, topH - 0.27, (br.z0 + br.z1) / 2);
    this.meshes.push(trunk); this.shadowCasters.push(trunk);
    // Root plate: a disc of soil with roots radiating out of it
    const plate = MeshBuilder.CreateCylinder('rootPlate', { height: 0.35, diameter: 2.4, tessellation: 10 }, this.scene);
    plate.material = this.mats.bark;
    plate.rotation.x = Math.PI / 2;
    plate.position.set(br.x, topH - 0.3, br.z1 + 0.95);
    this.meshes.push(plate); this.shadowCasters.push(plate);
    const roots = new ThinBatch(MeshBuilder.CreateCylinder('root', { height: 1, diameterTop: 0.02, diameterBottom: 0.12, tessellation: 5 }, this.scene));
    roots.mesh.material = this.mats.bark;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + this.rnd() * 0.3, l = 0.7 + this.rnd() * 0.9;
      roots.add(br.x + Math.cos(a) * (0.9 + l * 0.4), topH - 0.3 + Math.sin(a) * (0.9 + l * 0.4), br.z1 + 1.05 + this.rnd() * 0.2,
        0, 0, a - Math.PI / 2, 1, l, 1, 0.8, 0.8, 0.8);
    }
    // Branch stubs along the near end
    for (let i = 0; i < 4; i++) {
      const z = br.z0 + 0.6 + i * 0.9, side = i % 2 === 0 ? -1 : 1;
      roots.add(br.x + side * 0.4, topH - 0.2, z, 0, 0, side * (1.1 + this.rnd() * 0.3), 1.4, 0.6 + this.rnd() * 0.4, 1.4, 0.75, 0.75, 0.75);
    }
    const m = roots.commit(); this.meshes.push(m);
  }

  /**
   * Stream: a subdivided surface displaced every frame by three overlapping wave
   * trains running with the flow (toward the culvert), plus rings where something
   * lands in it. Normals are recomputed so the specular highlight rolls with the
   * swell. Fed by a fall in three curved layers, mist at its foot.
   */
  private buildWater(): void {
    const cl = CUTTING.cleft, wf = CUTTING.waterfall;
    const mat = new StandardMaterial('streamWater', this.scene);
    mat.diffuseColor = new Color3(0.02, 0.035, 0.04);
    mat.specularColor = new Color3(0.42, 0.46, 0.5);
    mat.specularPower = 70;
    mat.alpha = 0.93;
    const bump = this.mats.puddle.bumpTexture ?? this.mats.ground.bumpTexture;
    if (bump) {
      this.waterTex = (bump as Texture).clone();
      this.waterTex.uScale = 3; this.waterTex.vScale = 0.6;
      mat.bumpTexture = this.waterTex;
      mat.bumpTexture.level = 0.25;
    }
    const w = cl.x1 - cl.x0, d = cl.z1 - cl.z0 - 0.3;
    this.water = MeshBuilder.CreateGround('stream', { width: w, height: d, subdivisionsX: Math.round(w * 2.2), subdivisionsY: 8, updatable: true }, this.scene);
    this.water.material = mat;
    this.water.position.set((cl.x0 + cl.x1) / 2, CUTTING.stream.y, (cl.z0 + cl.z1) / 2);
    this.water.isPickable = false;
    this.waterBase = Float32Array.from(this.water.getVerticesData('position')!);
    this.waterIdx = this.water.getIndices()!;
    this.meshes.push(this.water);

    // The fall: three sheets that leave the crack, bow outward and drop
    const fallMat = new StandardMaterial('waterfall', this.scene);
    fallMat.disableLighting = true;
    fallMat.emissiveColor = new Color3(0.36, 0.4, 0.43);
    const streaks = this.mats.concrete.diffuseTexture as Texture | null;
    if (streaks) {
      this.fallTex = streaks.clone();
      this.fallTex.uScale = 0.4; this.fallTex.vScale = 3;
      fallMat.opacityTexture = this.fallTex;
    }
    fallMat.alpha = 0.4;
    fallMat.backFaceCulling = false;
    fallMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    const h = wf.top - CUTTING.stream.y;
    for (let layer = 0; layer < 3; layer++) {
      const width = 0.55 + layer * 0.2, out = 0.2 + layer * 0.18;
      const left: Vector3[] = [], right: Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        // Leaves the lip moving outward, then gravity takes it: a parabola
        const x = wf.x + out * Math.sqrt(t) + layer * 0.05;
        const y = wf.top - h * t * t * 0.35 - h * t * 0.65;
        left.push(new Vector3(x, y, wf.z - width / 2 * (1 + t * 0.4)));
        right.push(new Vector3(x, y, wf.z + width / 2 * (1 + t * 0.4)));
      }
      const sheet = MeshBuilder.CreateRibbon('waterfallSheet', { pathArray: [left, right], sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      sheet.material = fallMat;
      sheet.isPickable = false;
      sheet.visibility = 1 - layer * 0.25;
      this.meshes.push(sheet);
    }
    // Mist where it meets the stream
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(180, 190, 200, 0.5)'); grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    this.mist = new ParticleSystem('fallMist', 40, this.scene);
    this.mist.particleTexture = new Texture(canvas.toDataURL('image/png'), this.scene);
    this.mist.emitter = new Vector3(wf.x + 0.5, CUTTING.stream.y + 0.1, wf.z);
    this.mist.minEmitBox = new Vector3(-0.4, 0, -0.5); this.mist.maxEmitBox = new Vector3(0.4, 0.1, 0.5);
    this.mist.color1 = new Color4(0.5, 0.55, 0.6, 0.25); this.mist.color2 = new Color4(0.4, 0.45, 0.5, 0.18);
    this.mist.colorDead = new Color4(0.2, 0.22, 0.25, 0);
    this.mist.minSize = 0.5; this.mist.maxSize = 1.3;
    this.mist.minLifeTime = 1.2; this.mist.maxLifeTime = 2.4;
    this.mist.emitRate = 14;
    this.mist.direction1 = new Vector3(0.2, 0.4, -0.3); this.mist.direction2 = new Vector3(0.6, 0.8, 0.3);
    this.mist.minEmitPower = 0.2; this.mist.maxEmitPower = 0.5;
    this.mist.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.mist.start();
  }

  /** Something landed in the stream at (x, z): rings spread from it and fade. */
  public disturb(x: number, z: number, strength: number): void {
    this.ripples.push({ x, z, t: 0, a: 0.05 + strength * 0.08 });
    if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
  }

  /** Height of the water surface above its rest level at a world point (waves + rings). */
  public static waveHeight(x: number, z: number, t: number): number {
    // Three trains with the flow (+X): long swell, a crossing chop, a fine shiver
    return 0.045 * Math.sin(x * 0.55 - t * 0.9)
      + 0.025 * Math.sin(x * 1.3 + z * 0.9 - t * 1.7)
      + 0.012 * Math.sin(x * 3.1 - z * 2.3 - t * 3.1);
  }

  private updateWater(dt: number, voidAmt: number): void {
    // In Void it all but stops
    this.waterTime += dt * (1 - voidAmt * 0.92);
    const t = this.waterTime;
    const base = this.waterBase, pos = this.waterPos ?? (this.waterPos = new Float32Array(base.length));
    const ox = this.water.position.x, oz = this.water.position.z;
    for (const r of this.ripples) r.t += dt * (1 - voidAmt * 0.9);
    this.ripples = this.ripples.filter(r => r.t < RIPPLE_LIFE);
    for (let i = 0; i < base.length; i += 3) {
      const wx = base[i] + ox, wz = base[i + 2] + oz;
      // Waves calm toward the banks so the surface meets them without a seam of motion
      const edge = Math.min(1, (CUTTING.cleft.z1 - 0.15 - Math.abs(wz - (CUTTING.cleft.z0 + CUTTING.cleft.z1) / 2) * 2) / 1.2);
      let y = Cutting.waveHeight(wx, wz, t) * Math.max(0.2, edge);
      for (const r of this.ripples) {
        const dd = Math.hypot(wx - r.x, wz - r.z);
        const front = r.t * 1.6;
        y += r.a * Math.exp(-r.t * 1.4) * Math.exp(-Math.abs(dd - front) * 2.5) * Math.sin((dd - front) * 7);
      }
      pos[i] = base[i]; pos[i + 1] = base[i + 1] + y; pos[i + 2] = base[i + 2];
    }
    this.water.updateVerticesData('position', pos);
    const nrm = this.waterNrm ?? (this.waterNrm = new Float32Array(base.length));
    VertexData.ComputeNormals(pos, this.waterIdx, nrm);
    this.water.updateVerticesData('normal', nrm);
  }

  /** A length of track on the shelf, running straight into the cliff. */
  private buildRails(): void {
    const rl = CUTTING.rails;
    const y = cuttingAt(-13, (rl.z0 + rl.z1) / 2).h;
    const zc = (rl.z0 + rl.z1) / 2;
    const sleepers = new ThinBatch(MeshBuilder.CreateBox('cutSleeper', { width: 0.25, height: 0.12, depth: 2.3 }, this.scene));
    sleepers.mesh.material = this.mats.timber;
    for (let x = -13.0; x > CUTTING.cliff.x - 1.2; x -= 0.65) {
      const t = 0.7 + this.rnd() * 0.25;
      sleepers.add(x, y + 0.04, zc, this.rnd() * 0.08 - 0.04, 0, 0, 1, 1, 1, t, t, t);
    }
    const rails = new ThinBatch(MeshBuilder.CreateBox('cutRail', { width: 1, height: 0.12, depth: 0.07 }, this.scene));
    rails.mesh.material = this.mats.rust;
    const len = -13.0 - (CUTTING.cliff.x - 1.4);
    for (const dz of [-0.72, 0.72]) rails.add(-13.0 - len / 2, y + 0.16, zc + dz, 0, 0, 0, len, 1, 1);
    for (const b of [sleepers, rails]) { const m = b.commit(); this.meshes.push(m); this.shadowCasters.push(m); }
  }

  /** Where the stream goes: a concrete culvert under the embankment toward the line. */
  private buildCulvert(): void {
    const c = CUTTING.culvert;
    const pipe = MeshBuilder.CreateTube('culvert', {
      path: [new Vector3(c.x - 0.8, CUTTING.stream.y + 0.5, c.z), new Vector3(c.x + 1.6, CUTTING.stream.y + 0.5, c.z)],
      radius: 0.62, tessellation: 14, sideOrientation: Mesh.DOUBLESIDE
    }, this.scene);
    pipe.material = this.mats.concrete;
    this.meshes.push(pipe);
    const mouth = MeshBuilder.CreateDisc('culvertDark', { radius: 0.58, tessellation: 14 }, this.scene);
    mouth.material = this.mats.hoodInner;
    mouth.position.set(c.x + 0.4, CUTTING.stream.y + 0.5, c.z);
    mouth.rotation.y = -Math.PI / 2;
    this.meshes.push(mouth);
  }

  /** Water flows: the stream slowly toward the culvert, the fall quickly down. */
  public update(dt: number, voidAmt: number): void {
    this.updateWater(dt, voidAmt);
    if (this.mist) this.mist.emitRate = 14 * (1 - voidAmt * 0.85);
    if (this.waterTex) this.waterTex.uOffset -= dt * WATER_FLOW * (1 - voidAmt * 0.9);
    if (this.fallTex) this.fallTex.vOffset += dt * FALL_FLOW * (1 - voidAmt * 0.9);
  }
}
