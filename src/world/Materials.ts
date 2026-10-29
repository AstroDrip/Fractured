import { Scene, StandardMaterial, DynamicTexture, Texture, Color3 } from '@babylonjs/core';
import { hash2 } from '../core/rng';

type Painter = (u: number, v: number) => [number, number, number, number, number]; // r g b a height

// Lattice noise that wraps with the given period so textures tile seamlessly
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const w = (n: number) => ((n % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function tileFbm(u: number, v: number, base: number, seed: number, oct = 4): number {
  let s = 0, amp = 0.5, n = 0, p = base;
  for (let i = 0; i < oct; i++) {
    s += tileNoise(u * p, v * p, p, seed + i * 31) * amp;
    n += amp; amp *= 0.5; p *= 2;
  }
  return s / n;
}

/**
 * Shared, procedurally painted materials. Every surface in the chapter draws from
 * this library so unrelated props never get one-off materials.
 */
export class Materials {
  public ground!: StandardMaterial;
  public timber!: StandardMaterial;
  public rust!: StandardMaterial;
  public metalDark!: StandardMaterial;
  public bark!: StandardMaterial;
  public stone!: StandardMaterial;
  public concrete!: StandardMaterial;
  public coat!: StandardMaterial;
  public trousers!: StandardMaterial;
  public shoes!: StandardMaterial;
  public hoodInner!: StandardMaterial;
  public skin!: StandardMaterial;
  public puddle!: StandardMaterial;
  public footprint!: StandardMaterial;
  public blob!: StandardMaterial;
  public silhouette!: StandardMaterial;
  public signPlate!: StandardMaterial;
  public lampGlass!: StandardMaterial;
  public grass!: StandardMaterial;

  constructor(private scene: Scene) {}

  private paint(name: string, w: number, h: number, painter: Painter, normalStrength: number, alpha = false):
      { diffuse: DynamicTexture; normal: DynamicTexture | null } {
    const diffuse = new DynamicTexture(name + '_d', { width: w, height: h }, this.scene, true);
    const ctx = diffuse.getContext() as unknown as CanvasRenderingContext2D;
    const img = ctx.createImageData(w, h);
    const heights = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a, ht] = painter(x / w, y / h);
        const o = (y * w + x) * 4;
        img.data[o] = r * 255; img.data[o + 1] = g * 255; img.data[o + 2] = b * 255; img.data[o + 3] = a * 255;
        heights[y * w + x] = ht;
      }
    }
    ctx.putImageData(img, 0, 0);
    diffuse.update(false);
    diffuse.wrapU = diffuse.wrapV = Texture.WRAP_ADDRESSMODE;
    diffuse.hasAlpha = alpha;

    let normal: DynamicTexture | null = null;
    if (normalStrength > 0) {
      normal = new DynamicTexture(name + '_n', { width: w, height: h }, this.scene, true);
      const nctx = normal.getContext() as unknown as CanvasRenderingContext2D;
      const nimg = nctx.createImageData(w, h);
      const at = (x: number, y: number) => heights[((y + h) % h) * w + ((x + w) % w)];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
          const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
          const len = Math.hypot(dx, dy, 1);
          const o = (y * w + x) * 4;
          nimg.data[o] = (-dx / len * 0.5 + 0.5) * 255;
          nimg.data[o + 1] = (-dy / len * 0.5 + 0.5) * 255;
          nimg.data[o + 2] = (1 / len * 0.5 + 0.5) * 255;
          nimg.data[o + 3] = 255;
        }
      }
      nctx.putImageData(nimg, 0, 0);
      normal.update(false);
      normal.wrapU = normal.wrapV = Texture.WRAP_ADDRESSMODE;
    }
    return { diffuse, normal };
  }

  private mat(name: string, color: Color3, spec: number, power = 16): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = power;
    return m;
  }

  private withTex(m: StandardMaterial, t: { diffuse: DynamicTexture; normal: DynamicTexture | null }, bumpLevel: number): StandardMaterial {
    m.diffuseTexture = t.diffuse;
    if (t.normal) {
      m.bumpTexture = t.normal;
      m.bumpTexture.level = bumpLevel;
    }
    return m;
  }

  /** Builds all textures. Split in steps so the loader can report progress. */
  public buildSteps(): (() => void)[] {
    return [
      () => {
        // Ground detail: greyscale so terrain vertex colour carries the hue
        const t = this.paint('groundDetail', 256, 256, (u, v) => {
          const n = tileFbm(u, v, 8, 11, 5);
          const pebble = tileNoise(u * 64, v * 64, 64, 5);
          const k = 0.84 + n * 0.16 - (pebble > 0.84 ? 0.07 : 0);
          return [k, k, k, 1, n + (pebble > 0.82 ? 0.15 : 0)];
        }, 1.2);
        this.ground = this.withTex(this.mat('ground', new Color3(1, 1, 1), 0.02), t, 0.3);
      },
      () => {
        // Damp timber: grain runs along U, darker soaked ends, cracks
        const t = this.paint('timber', 256, 128, (u, v) => {
          const grain = tileFbm(u * 0.5, v * 6, 4, 21, 4);
          const streak = tileNoise(u * 2, v * 48, 48, 22);
          const crack = Math.abs(tileNoise(u * 6, v * 3, 3, 23) - 0.5) < 0.025 ? 0.45 : 1;
          const k = (0.55 + grain * 0.45) * (0.85 + streak * 0.15) * crack;
          return [0.27 * k, 0.2 * k, 0.14 * k, 1, grain * 0.6 + streak * 0.4 - (crack < 1 ? 0.6 : 0)];
        }, 4);
        this.timber = this.withTex(this.mat('timber', new Color3(1, 1, 1), 0.07, 22), t, 0.7);
      },
      () => {
        // Corroded rail steel: grey with rust blooms, pitting
        const t = this.paint('rust', 256, 256, (u, v) => {
          const bloom = tileFbm(u, v, 6, 31, 5);
          const pit = tileNoise(u * 96, v * 96, 96, 32);
          const r = bloom > 0.52 ? Math.min(1, (bloom - 0.52) * 5) : 0;
          const steel = [0.3, 0.3, 0.31], rust = [0.33, 0.17, 0.08];
          const k = pit > 0.86 ? 0.7 : 1;
          return [
            (steel[0] + (rust[0] - steel[0]) * r) * k,
            (steel[1] + (rust[1] - steel[1]) * r) * k,
            (steel[2] + (rust[2] - steel[2]) * r) * k, 1, bloom + (pit > 0.86 ? -0.3 : 0)];
        }, 3);
        this.rust = this.withTex(this.mat('rust', new Color3(1, 1, 1), 0.2, 36), t, 0.5);
        this.metalDark = this.mat('metalDark', new Color3(0.12, 0.11, 0.1), 0.15, 30);
        this.metalDark.diffuseTexture = t.diffuse;
      },
      () => {
        const t = this.paint('bark', 128, 256, (u, v) => {
          const fissure = Math.abs(tileNoise(u * 8, v * 1.5, 8, 41) - 0.5) * 2;
          const n = tileFbm(u, v, 4, 42, 3);
          const k = 0.35 + fissure * 0.4 + n * 0.25;
          return [0.16 * k, 0.15 * k, 0.14 * k, 1, fissure];
        }, 5);
        this.bark = this.withTex(this.mat('bark', new Color3(1, 1, 1), 0.02), t, 0.8);
      },
      () => {
        const t = this.paint('stone', 128, 128, (u, v) => {
          const n = tileFbm(u, v, 4, 51, 5);
          const k = 0.55 + n * 0.45;
          return [0.34 * k, 0.34 * k, 0.35 * k, 1, n];
        }, 3);
        this.stone = this.withTex(this.mat('stone', new Color3(1, 1, 1), 0.05, 12), t, 0.6);
      },
      () => {
        // Concrete with rain streaks running down (V) and grime at the base
        const t = this.paint('concrete', 256, 256, (u, v) => {
          const n = tileFbm(u, v, 6, 61, 4);
          const streak = tileNoise(u * 40, v * 2, 40, 62);
          const k = 0.62 + n * 0.3 - streak * 0.18 * v;
          return [0.3 * k, 0.29 * k, 0.27 * k, 1, n];
        }, 2.5);
        this.concrete = this.withTex(this.mat('concrete', new Color3(1, 1, 1), 0.03), t, 0.5);
      },
      () => {
        // Worn fabric weave for the protagonist's coat and hood
        const t = this.paint('fabric', 128, 128, (u, v) => {
          const weave = (Math.sin(u * Math.PI * 128) * Math.sin(v * Math.PI * 128)) * 0.5 + 0.5;
          const wear = tileFbm(u, v, 4, 71, 3);
          const k = 0.82 + weave * 0.08 + wear * 0.12;
          return [k, k, k, 1, weave * 0.4 + wear * 0.6];
        }, 1.5);
        this.coat = this.withTex(this.mat('coat', new Color3(0.13, 0.15, 0.18), 0.03), t, 0.4);
        this.trousers = this.withTex(this.mat('trousers', new Color3(0.075, 0.08, 0.095), 0.02), t, 0.4);
        this.shoes = this.mat('shoes', new Color3(0.06, 0.055, 0.05), 0.12, 24);
        this.hoodInner = this.mat('hoodInner', new Color3(0.012, 0.012, 0.016), 0);
        this.skin = this.mat('skin', new Color3(0.5, 0.45, 0.42), 0.04);
      },
      () => {
        this.puddle = this.mat('puddle', new Color3(0.012, 0.013, 0.015), 0.32, 180);
        this.puddle.alpha = 0.9;

        const fp = this.paint('footprint', 64, 128, (u, v) => {
          // Shoe sole: heel + forefoot ellipses with tread breakup
          const heel = ((u - 0.5) / 0.32) ** 2 + ((v - 0.78) / 0.17) ** 2;
          const fore = ((u - 0.5) / 0.38) ** 2 + ((v - 0.33) / 0.27) ** 2;
          const tread = tileNoise(u * 16, v * 32, 16, 81) > 0.35 ? 1 : 0.55;
          const a = (heel < 1 || fore < 1 ? 0.92 : 0) * tread;
          return [0, 0, 0, a, 0];
        }, 0, true);
        this.footprint = this.mat('footprint', new Color3(0.02, 0.018, 0.016), 0.35, 60);
        this.footprint.diffuseTexture = fp.diffuse;
        this.footprint.useAlphaFromDiffuseTexture = true;
        this.footprint.zOffset = -2;

        const blob = this.paint('blob', 64, 64, (u, v) => {
          const d = Math.hypot(u - 0.5, v - 0.5) * 2;
          const a = Math.max(0, 1 - d) ** 1.6 * 0.7;
          return [0, 0, 0, a, 0];
        }, 0, true);
        this.blob = this.mat('blob', new Color3(0, 0, 0), 0);
        this.blob.diffuseTexture = blob.diffuse;
        this.blob.useAlphaFromDiffuseTexture = true;
        this.blob.disableLighting = true;
        this.blob.zOffset = -3;

        this.silhouette = this.mat('silhouette', new Color3(0, 0, 0), 0);
        this.silhouette.disableLighting = true;
        this.silhouette.emissiveColor = new Color3(0.03, 0.034, 0.04);

        const sign = this.paint('sign', 128, 128, (u, v) => {
          const wear = tileFbm(u, v, 4, 91, 4);
          const band = Math.abs((u - v)) < 0.16;
          const edge = u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95;
          let k = band || edge ? 0.06 : 0.78;
          if (wear > 0.62) k = k * 0.55 + 0.12; // flaking paint
          return [k, k * 0.98, k * 0.94, 1, wear];
        }, 2);
        this.signPlate = this.withTex(this.mat('signPlate', new Color3(1, 1, 1), 0.08), sign, 0.4);

        this.lampGlass = this.mat('lampGlass', new Color3(0.2, 0.12, 0.04), 0);
        this.lampGlass.emissiveColor = new Color3(1.0, 0.62, 0.22);
        this.lampGlass.disableLighting = true;

        this.grass = this.mat('grass', new Color3(1, 1, 1), 0.02);
        this.grass.backFaceCulling = false;
      }
    ];
  }
}
