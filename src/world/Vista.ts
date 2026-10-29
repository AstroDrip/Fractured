import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3 } from '@babylonjs/core';
import { mulberry32 } from '../core/rng';
import { ParticleField, FieldContext } from '../graphics/ParticleField';

export const LANDMASS = { x: -150, y: 62, z: 176 };   // centre of the floating fragment

/**
 * The unreachable distance. A town-sized landmass hangs west of the railway, still
 * as architecture: a forest and village on top, an inverted village and garden on
 * its underside, a white tower rising into haze, and a river that runs sideways off
 * its edge. Too far for scene fog to treat honestly, so its materials carry their
 * own aerial perspective (unlit, fog-free, tones just apart from the sky).
 * In Deranged a second, fainter copy appears where no perspective could put it.
 */
export class Vista {
  public root: Mesh;
  public echo: Mesh;
  public falls: ParticleField;
  private movers: Mesh[] = [];
  private moverT: number[] = [];
  private time = 0;

  constructor(private scene: Scene) {
    const mat = (name: string, c: [number, number, number]) => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveColor = new Color3(c[0], c[1], c[2]);
      m.diffuseColor = new Color3(0, 0, 0);
      m.specularColor = new Color3(0, 0, 0);
      m.fogEnabled = false;
      return m;
    };
    // Tones sit just under the sky so the mass reads as haze-softened distance, not a cut-out
    const rock = mat('vistaRock', [0.062, 0.07, 0.082]);
    const crown = mat('vistaCrown', [0.074, 0.086, 0.088]);
    const houseM = mat('vistaHouse', [0.098, 0.106, 0.116]);
    const towerM = mat('vistaTower', [0.17, 0.178, 0.19]);
    const rnd = mulberry32(4040);

    const rockParts: Mesh[] = [], crownParts: Mesh[] = [], houseParts: Mesh[] = [];
    const box = (arr: Mesh[], x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, rz = 0) => {
      const b = MeshBuilder.CreateBox('v', { width: w, height: h, depth: d }, scene);
      b.position.set(x, y, z); b.rotation.y = ry; b.rotation.z = rz;
      arr.push(b);
    };
    // Rock mass: stepped layers narrowing downward, broken at the edges
    for (let i = 0; i < 11; i++) {
      const k = 1 - i / 13;
      const w = 74 * k * (0.9 + rnd() * 0.15), d = 96 * k * (0.9 + rnd() * 0.15);
      box(rockParts, (rnd() - 0.5) * 6, -i * 3.2, (rnd() - 0.5) * 8, w, 3.4, d, (rnd() - 0.5) * 0.08);
    }
    // Forest on top
    for (let i = 0; i < 140; i++) {
      const x = (rnd() - 0.5) * 64, z = (rnd() - 0.5) * 84;
      const h = 5 + rnd() * 9;
      box(crownParts, x, 1.7 + h / 2, z, 0.5 + rnd() * 0.8, h, 0.5 + rnd() * 0.8);
      box(crownParts, x, 1.7 + h * 0.8, z, 2 + rnd() * 2.5, h * 0.35, 2 + rnd() * 2.5);
    }
    // A village on top near the edge, and the same village inverted on the underside
    for (let i = 0; i < 18; i++) {
      const x = 14 + rnd() * 18, z = -30 + rnd() * 55, w = 3 + rnd() * 3, h = 3 + rnd() * 4;
      box(houseParts, x, 1.7 + h / 2, z, w, h, w * 1.3, rnd() * 3);
      // Underside: hanging from the lowest layer, roofs pointing down
      box(houseParts, x * 0.4, -36 - h / 2, z * 0.4, w, h, w * 1.3, rnd() * 3);
    }
    // A garden growing downward from the underside
    for (let i = 0; i < 50; i++) {
      const x = (rnd() - 0.5) * 22, z = (rnd() - 0.5) * 30, h = 3 + rnd() * 6;
      box(crownParts, x, -34 - h / 2, z, 0.4, h, 0.4);
      box(crownParts, x, -34 - h * 0.85, z, 1.6 + rnd() * 2, h * 0.3, 1.6 + rnd() * 2);
    }
    const merge = (arr: Mesh[], m: StandardMaterial, name: string) => {
      const out = Mesh.MergeMeshes(arr, true, true)!;
      out.name = name; out.material = m; out.isPickable = false;
      return out;
    };
    this.root = merge(rockParts, rock, 'landmass');
    const crowns = merge(crownParts, crown, 'landmassForest');
    const housesM = merge(houseParts, houseM, 'landmassVillage');
    crowns.parent = this.root; housesM.parent = this.root;
    // The white tower rises out of the forest into the haze
    const tower = MeshBuilder.CreateBox('landmassTower', { width: 5, height: 90, depth: 5 }, scene);
    tower.position.set(-8, 46, 12);
    tower.material = towerM;
    tower.parent = this.root;
    this.root.position.set(LANDMASS.x, LANDMASS.y, LANDMASS.z);
    this.root.rotation.z = 0.04;

    // Deranged echo: the same mass, somewhere it cannot also be
    this.echo = this.root.clone('landmassEcho', null)!;
    this.echo.position.set(LANDMASS.x + 34, LANDMASS.y - 30, LANDMASS.z + 70);
    this.echo.rotation.set(0, 0.5, Math.PI - 0.05);
    this.setVisibility(this.echo, 0);

    // Tiny lights crossing the top, too small to be anything but travellers
    const lightMat = mat('vistaMover', [0.75, 0.6, 0.4]);
    for (let i = 0; i < 4; i++) {
      const m = MeshBuilder.CreateBox('mover', { size: 0.6 }, scene);
      m.material = lightMat;
      m.parent = this.root;
      this.movers.push(m);
      this.moverT.push(rnd());
    }

    // The river that runs sideways off the eastern edge
    const fallsMat = ParticleField.makeMaterial(scene, 'fallsMat', 'add');
    fallsMat.fogEnabled = false;
    this.falls = new ParticleField(scene, {
      name: 'sidewaysFalls', capacity: 700, blend: 'add', life: [5, 8], size: [0.18, 0.5],
      colorA: [0.2, 0.24, 0.28, 0.55], colorB: [0.12, 0.15, 0.18, 0], fadeIn: 0.05, fadeOut: 0.5,
      drag: 0.05, noise: { amp: 0.25, freq: 0.08, speed: 0.2 }, spin: 0.3, seed: 77
    }, fallsMat);
  }

  private setVisibility(m: Mesh, v: number): void {
    m.visibility = v;
    for (const c of m.getChildMeshes()) c.visibility = v;
    m.setEnabled(v > 0.01);
  }

  public update(dt: number, deranged: number, ctx: FieldContext): void {
    this.time += dt;
    // Travellers move along fixed lanes across the top, slowly
    for (let i = 0; i < this.movers.length; i++) {
      this.moverT[i] = (this.moverT[i] + dt * 0.012 * (1 + i * 0.3)) % 1;
      const t = this.moverT[i];
      this.movers[i].position.set(-20 + i * 9, 2.4, -40 + t * 80);
    }
    // Water leaves the edge sideways and keeps going sideways
    const ex = LANDMASS.x + 36, ey = LANDMASS.y - 2, ez = LANDMASS.z - 10;
    for (let k = 0; k < 5; k++) {
      this.falls.spawn(ex, ey + Math.random() * 3, ez + (Math.random() - 0.5) * 10,
        5 + Math.random() * 2, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6);
    }
    this.falls.update(ctx);
    this.setVisibility(this.echo, deranged * 0.4);
  }

  /** A point to frame the reveal on. */
  public focusPoint(out: Vector3): Vector3 {
    return out.set(LANDMASS.x + 10, LANDMASS.y - 8, LANDMASS.z);
  }
}
