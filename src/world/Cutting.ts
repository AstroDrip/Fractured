import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Texture, Material, Vector3 } from '@babylonjs/core';
import { Materials } from './Materials';
import { ThinBatch } from './ThinBatch';
import { mulberry32 } from '../core/rng';
import { CUTTING, GROUND_Y, cuttingAt } from './layout';

const WATER_FLOW = 0.035;      // texture units per second along the stream
const FALL_FLOW = 0.42;        // the waterfall runs much faster than the stream

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
    const shapes = [2, 3, 6].map((type, i) => {
      const m = MeshBuilder.CreatePolyhedron('cutRock' + i, { type, size: 0.5 }, this.scene);
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

  /** Stream: dark, slow, a little reflective; fed by a thin fall from a crack in the cliff. */
  private buildWater(): void {
    const cl = CUTTING.cleft, wf = CUTTING.waterfall;
    const mat = new StandardMaterial('streamWater', this.scene);
    mat.diffuseColor = new Color3(0.02, 0.035, 0.04);
    mat.specularColor = new Color3(0.38, 0.42, 0.45);
    mat.specularPower = 90;
    mat.alpha = 0.92;
    const bump = this.mats.puddle.bumpTexture ?? this.mats.ground.bumpTexture;
    if (bump) {
      this.waterTex = (bump as Texture).clone();
      this.waterTex.uScale = 3; this.waterTex.vScale = 0.6;
      mat.bumpTexture = this.waterTex;
      mat.bumpTexture.level = 0.45;
    }
    const water = MeshBuilder.CreateGround('stream', { width: cl.x1 - cl.x0, height: cl.z1 - cl.z0 - 0.3 }, this.scene);
    water.material = mat;
    water.position.set((cl.x0 + cl.x1) / 2, CUTTING.stream.y, (cl.z0 + cl.z1) / 2);
    water.isPickable = false;
    this.meshes.push(water);

    const fallMat = new StandardMaterial('waterfall', this.scene);
    fallMat.disableLighting = true;
    fallMat.emissiveColor = new Color3(0.36, 0.4, 0.43);
    const streaks = this.mats.concrete.diffuseTexture as Texture | null;
    if (streaks) {
      this.fallTex = streaks.clone();
      this.fallTex.uScale = 0.4; this.fallTex.vScale = 3;
      fallMat.opacityTexture = this.fallTex;
    }
    fallMat.alpha = 0.42;
    fallMat.backFaceCulling = false;
    fallMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    const h = wf.top - CUTTING.stream.y;
    const fall = MeshBuilder.CreatePlane('waterfallSheet', { width: 0.7, height: h }, this.scene);
    fall.material = fallMat;
    fall.position.set(wf.x, CUTTING.stream.y + h / 2, wf.z);
    fall.rotation.y = Math.PI / 2;
    fall.isPickable = false;
    this.meshes.push(fall);
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
    if (this.waterTex) this.waterTex.uOffset -= dt * WATER_FLOW * (1 - voidAmt * 0.9);
    if (this.fallTex) this.fallTex.vOffset += dt * FALL_FLOW * (1 - voidAmt * 0.9);
  }
}
