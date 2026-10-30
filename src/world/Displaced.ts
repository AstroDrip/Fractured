import {
  Scene, Mesh, MeshBuilder, TransformNode, StandardMaterial, Color3, LinesMesh, Vector3, Material, DynamicTexture
} from '@babylonjs/core';
import { Materials } from './Materials';
import { ThinBatch } from './ThinBatch';
import { mulberry32 } from '../core/rng';
import {
  GROUND_Y, BRIDGE_Y, VILLAGE, VILLAGE_ROUTE, FACADE, GRAVITY_SURFACES
} from './layout';
import { R_VOID } from '../core/Reality';

/** Materials a house is built from; any of them can be swapped (e.g. for a fogged silhouette). */
interface HouseMats { wall: StandardMaterial; roof: StandardMaterial; trim: StandardMaterial; dark: StandardMaterial; base: StandardMaterial; lit?: StandardMaterial; }

/**
 * Displaced architecture: the village loop east of the line and the house front in
 * the Hound's stretch.
 *  - A single authored house template is built several times. The repetitions do not
 *    agree: one door faces a wall, one house is only there outside the Void (its
 *    shadow stays when it goes), one hangs upside down over the square, one stands
 *    out in the fog where nothing can be reached.
 *  - The Void-only path across the ravine: a faint filament outline in Normal, a pale
 *    deck that resolves as the Void does.
 *  - The facade: a gravity surface (layout GRAVITY_SURFACES[1]) with a broken window
 *    band, an exposed cross-section of floors behind the break, and footprints on its
 *    face that only Deranged shows.
 * Collision and walkability live in WalkGrid; this module is presentation only.
 */
export class Displaced {
  public meshes: Mesh[] = [];
  public shadowCasters: Mesh[] = [];
  public occluders: Mesh[] = [];
  private rnd = mulberry32(4242);
  private absentHouse!: Mesh;
  private absentShadow!: Mesh;
  private inverted!: TransformNode;
  private voidDecks: Mesh[] = [];
  private voidEdges: LinesMesh[] = [];
  private deckMat!: StandardMaterial;
  public facadePrints!: Mesh;
  private time = 0;

  constructor(private scene: Scene, private mats: Materials) {}

  public build(): void {
    const m = this.mats;
    const plaster = new StandardMaterial('plaster', this.scene);
    plaster.diffuseTexture = m.concrete.diffuseTexture;
    plaster.bumpTexture = m.concrete.bumpTexture;
    plaster.diffuseColor = new Color3(0.74, 0.76, 0.78);
    plaster.specularColor = new Color3(0.03, 0.03, 0.03);
    this.plaster = plaster;
    const lit = new StandardMaterial('villageWindowLit', this.scene);
    lit.disableLighting = true;
    lit.emissiveColor = new Color3(0.85, 0.55, 0.26);
    const hm: HouseMats = { wall: plaster, roof: m.timber, trim: m.timber, dark: m.hoodInner, base: m.stone };

    VILLAGE.houses.forEach((h, i) => {
      const mesh = this.house(`villageHouse${i}`, h.w, h.d, h.h, i === 2 ? { ...hm, lit } : hm, i);
      mesh.position.set(h.x, GROUND_Y - 0.05, h.z);
      mesh.rotation.y = h.yaw;
      this.shadowCasters.push(mesh);
      this.occluders.push(mesh);
      this.addTally(mesh, h.w, h.d, 7 + i);
      if (h.realities !== (h.realities | R_VOID)) {
        this.absentHouse = mesh;
        // Its shadow: stays on the ground when the house has gone
        const sh = MeshBuilder.CreateGround('absentShadow', { width: h.w + 1.4, height: h.d + 1.8 }, this.scene);
        sh.material = m.blob;
        sh.position.set(h.x + 0.5, GROUND_Y + 0.015, h.z - 0.6);
        sh.rotation.y = h.yaw;
        sh.isPickable = false;
        this.absentShadow = sh;
        this.meshes.push(sh);
      }
    });

    // The same house, upside down over the square, turning very slowly
    this.inverted = new TransformNode('invertedHouse', this.scene);
    const inv = this.house('invertedHouseM', 4.6, 5.2, 3.0, hm, 7);
    inv.parent = this.inverted;
    inv.position.y = -1.6;
    this.inverted.position.set(VILLAGE.inverted.x, VILLAGE.inverted.y, VILLAGE.inverted.z);
    this.inverted.rotation.set(0.08, 0.6, Math.PI);
    // Torn earth hanging from its foundations
    const clod = MeshBuilder.CreateCylinder('invertedClod', { height: 2.2, diameterTop: 0.2, diameterBottom: 6.2, tessellation: 9 }, this.scene);
    clod.material = m.ground;
    clod.parent = this.inverted;
    clod.position.y = -2.4;     // above the house once inverted
    clod.rotation.x = Math.PI;
    this.meshes.push(clod);

    // Once more, far out in the fog, as a silhouette
    const sil = m.silhouette;
    const far = this.house('farHouse', 4.6, 5.2, 3.0, { wall: sil, roof: sil, trim: sil, dark: sil, base: sil }, 9);
    far.position.set(VILLAGE.far.x, GROUND_Y + 2.5, VILLAGE.far.z);
    far.rotation.y = -0.4;
    far.scaling.setAll(1.3);

    this.buildVoidRoute();
    this.buildRavineEdges();
    this.buildFacade();
  }

  public plaster!: StandardMaterial;

  /**
   * The house template: plinth, walls, a 45° gabled roof with overhang, door, windows,
   * chimney, gutter. `seed` adds small, deliberate differences (lean, chimney side,
   * which window is boarded). Merged into one mesh per house (one draw per material).
   */
  private house(name: string, w: number, d: number, h: number, hm: HouseMats, seed: number): Mesh {
    const parts: Mesh[] = [];
    const box = (wx: number, hy: number, dz: number, mat: StandardMaterial, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const b = MeshBuilder.CreateBox(name + 'p', { width: wx, height: hy, depth: dz }, this.scene);
      b.material = mat;
      b.position.set(x, y, z);
      b.rotation.set(rx, ry, rz);
      parts.push(b);
      return b;
    };
    const r = mulberry32(seed * 97 + 13);
    box(w + 0.25, 0.35, d + 0.25, hm.base, 0, 0.12, 0);                       // plinth
    box(w, h, d, hm.wall, 0, 0.3 + h / 2, 0);                                  // walls
    const top = 0.3 + h;
    const s = d / Math.SQRT2;
    box(w - 0.02, s, s, hm.wall, 0, top, 0, Math.PI / 4);                      // gable fill
    const panel = s + 0.45;
    for (const side of [-1, 1]) {
      box(w + 0.5, 0.1, panel, hm.roof, 0, top + d / 4 + 0.08, side * d / 4, -side * Math.PI / 4);
    }
    box(w + 0.55, 0.12, 0.16, hm.trim, 0, top + d / 2 + 0.05, 0);              // ridge
    // Door on +Z with frame and step
    box(0.95, 2.0, 0.08, hm.dark, w * 0.18, 0.3 + 1.0, d / 2 + 0.02);
    box(1.15, 0.1, 0.12, hm.trim, w * 0.18, 0.3 + 2.05, d / 2 + 0.04);
    box(1.3, 0.16, 0.5, hm.base, w * 0.18, 0.2, d / 2 + 0.3);
    // Windows: dark recesses with sills; one boarded per house, one lit if asked
    const windows: [number, number, number, number][] = [
      [-w * 0.26, 1.75, d / 2 + 0.02, 0], [w / 2 + 0.02, 1.75, -d * 0.18, Math.PI / 2],
      [-w / 2 - 0.02, 1.75, d * 0.15, Math.PI / 2], [w * 0.1, 1.75, -d / 2 - 0.02, 0]
    ];
    const boarded = Math.floor(r() * windows.length);
    windows.forEach(([x, y, z, ry], i) => {
      const mat = hm.lit && i === 0 ? hm.lit : hm.dark;
      box(0.85, 0.95, 0.06, mat, x, 0.3 + y, z, 0, ry);
      const sx = ry === 0 ? 0 : (x > 0 ? 0.06 : -0.06), sz = ry === 0 ? (z > 0 ? 0.06 : -0.06) : 0;
      box(1.0, 0.07, 0.14, hm.trim, x + sx, 0.3 + y - 0.52, z + sz, 0, ry);
      if (i === boarded) box(1.0, 0.16, 0.05, hm.trim, x + sx * 1.3, 0.3 + y + 0.1, z + sz * 1.3, 0, ry, 0.5);
    });
    // Chimney on one side of the ridge
    const cs = r() < 0.5 ? -1 : 1;
    box(0.55, 1.6, 0.55, hm.wall, cs * w * 0.3, top + d / 4 + 0.6, -d * 0.12);
    // Gutter along the eaves
    box(w + 0.5, 0.08, 0.1, hm.trim, 0, top - 0.02, d / 2 + 0.25);
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    merged.name = name;
    // A slight lean: none of them were built straight, or they have settled
    merged.rotation.z = (r() - 0.5) * 0.035;
    merged.isPickable = false;
    this.meshes.push(merged);
    return merged;
  }

  private buildVoidRoute(): void {
    const mat = new StandardMaterial('voidDeck', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(0.62, 0.66, 0.7);
    mat.alpha = 0;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.deckMat = mat;
    for (const p of VILLAGE_ROUTE) {
      if (p.realities !== R_VOID) continue;
      const dx = p.b.x - p.a.x, dz = p.b.z - p.a.z, len = Math.hypot(dx, dz);
      const deck = MeshBuilder.CreateBox('voidDeck', { width: p.r * 1.8, height: 0.06, depth: len + 0.4 }, this.scene);
      deck.material = mat;
      deck.position.set((p.a.x + p.b.x) / 2, BRIDGE_Y - 0.04, (p.a.z + p.b.z) / 2);
      deck.rotation.y = Math.atan2(dx, dz);
      deck.isPickable = false;
      this.voidDecks.push(deck);
      this.meshes.push(deck);
      // Filament edges: seen faintly from the real side, a route that is not there
      const nx = -dz / len * p.r * 0.9, nz = dx / len * p.r * 0.9;
      const lines: Vector3[][] = [];
      for (const s of [-1, 1]) {
        const pts: Vector3[] = [];
        for (let t = 0; t <= 1.0001; t += 0.125) {
          const sag = Math.sin(t * Math.PI) * 0.05;
          pts.push(new Vector3(p.a.x + dx * t + nx * s, BRIDGE_Y - sag, p.a.z + dz * t + nz * s));
        }
        lines.push(pts);
      }
      const edge = MeshBuilder.CreateLineSystem('voidEdge', { lines }, this.scene);
      edge.color = new Color3(0.72, 0.78, 0.84);
      edge.alpha = 0.12;
      edge.isPickable = false;
      this.voidEdges.push(edge);
    }
  }

  /** Broken rock along the ravine's lips, so the drop reads as ground giving way. */
  private buildRavineEdges(): void {
    const rock = new ThinBatch(MeshBuilder.CreateBox('ravineRock', { size: 1 }, this.scene));
    rock.mesh.material = this.mats.stone;
    const rv = VILLAGE.ravine;
    const dx = rv.b.x - rv.a.x, dz = rv.b.z - rv.a.z, len = Math.hypot(dx, dz);
    for (let t = 0.1; t < 0.95; t += 0.06) {
      for (const s of [-1, 1]) {
        const off = rv.r + 0.2 + this.rnd() * 0.4;
        const x = rv.a.x + dx * t - dz / len * off * s, z = rv.a.z + dz * t + dx / len * off * s;
        if (Math.abs(x) < 4.4) continue;
        const sc = 0.35 + this.rnd() * 0.5;
        rock.add(x, GROUND_Y - 0.2 - this.rnd() * 0.5, z, this.rnd() * 6, this.rnd() * 0.6, this.rnd() * 0.6, sc * 1.4, sc, sc, 0.8, 0.8, 0.82);
      }
    }
    const m = rock.commit();
    this.meshes.push(m);
  }

  private buildFacade(): void {
    const f = FACADE, sf = GRAVITY_SURFACES[1];
    const parts: Mesh[] = [];
    const box = (w: number, h: number, d: number, mat: StandardMaterial, x: number, y: number, z: number) => {
      const b = MeshBuilder.CreateBox('facadeP', { width: w, height: h, depth: d }, this.scene);
      b.material = mat; b.position.set(x, y, z); parts.push(b); return b;
    };
    const T = 0.5, back = f.x - T / 2;
    const hole = sf.holes[0];
    const wall = this.plaster;
    // The front, minus the broken window band
    box(T, f.height, hole.u0 - f.z0, wall, back, GROUND_Y + f.height / 2, (f.z0 + hole.u0) / 2);
    box(T, f.height, f.z1 - hole.u1, wall, back, GROUND_Y + f.height / 2, (hole.u1 + f.z1) / 2);
    box(T, hole.v0, hole.u1 - hole.u0, wall, back, GROUND_Y + hole.v0 / 2, (hole.u0 + hole.u1) / 2);
    box(T, f.height - hole.v1, hole.u1 - hole.u0, wall, back, GROUND_Y + (hole.v1 + f.height) / 2, (hole.u0 + hole.u1) / 2);
    // Cornice and string courses
    box(0.8, 0.35, f.z1 - f.z0 + 0.6, this.mats.stone, back + 0.15, GROUND_Y + f.height, (f.z0 + f.z1) / 2);
    for (const v of [3.0, 6.0]) box(0.62, 0.14, f.z1 - f.z0, this.mats.stone, back + 0.06, GROUND_Y + v, (f.z0 + f.z1) / 2);
    // Windows: dark recesses in rows, skipping the broken band
    for (const v of [1.4, 4.3, 7.3]) {
      for (let u = f.z0 + 1.6; u < f.z1 - 1; u += 2.6) {
        if (u > hole.u0 - 0.7 && u < hole.u1 + 0.7 && v > hole.v0 - 0.6) continue;
        box(0.06, 1.4, 0.9, this.mats.hoodInner, f.x + 0.01, GROUND_Y + v, u);
        box(0.16, 0.08, 1.05, this.mats.timber, f.x + 0.06, GROUND_Y + v - 0.74, u);
      }
    }
    box(0.06, 2.3, 1.3, this.mats.hoodInner, f.x + 0.01, GROUND_Y + 1.15, f.z0 + 4.2);   // door
    // Behind the break: the floors of a building that is not there, cut clean
    for (const v of [hole.v0, (hole.v0 + hole.v1) / 2 + 0.3]) {
      box(3.2, 0.22, hole.u1 - hole.u0 + 0.5, this.mats.concrete, back - 1.8, GROUND_Y + v, (hole.u0 + hole.u1) / 2);
    }
    box(0.12, 1.9, 0.12, this.mats.timber, back - 2.6, GROUND_Y + hole.v0 + 1.05, hole.u0 + 0.9);   // a door frame on a floor
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    merged.name = 'facade';
    merged.isPickable = false;
    this.meshes.push(merged);
    this.shadowCasters.push(merged);

    // Footprints on the face, below the broken band: someone walked it before
    const plane = MeshBuilder.CreatePlane('facadePrint', { width: 0.13, height: 0.28 }, this.scene);
    plane.material = this.mats.footprint;
    const prints = new ThinBatch(plane);
    const route: [number, number][] = [[257, 0.3], [259.6, 2.0], [266.4, 1.75], [271.8, 1.75], [279.4, 2.0], [281.2, 0.3]];
    for (let s = 0; s < route.length - 1; s++) {
      const [u0, v0] = route[s], [u1, v1] = route[s + 1];
      const len = Math.hypot(u1 - u0, v1 - v0), ang = Math.atan2(v1 - v0, u1 - u0);
      for (let d = 0, i = 0; d < len; d += 0.68, i++) {
        const t = d / len, side = i % 2 === 0 ? -0.11 : 0.11;
        const u = u0 + (u1 - u0) * t - Math.sin(ang) * side, v = v0 + (v1 - v0) * t + Math.cos(ang) * side;
        prints.add(f.x + 0.012, GROUND_Y + v, u, -Math.PI / 2, 0, ang - Math.PI / 2, 1, 1, 1, 1, 1, 1, 0.9);
      }
    }
    this.facadePrints = prints.commit();
    this.facadePrints.visibility = 0;
    this.meshes.push(this.facadePrints);
  }

  /** voidAmt / derangedAmt: 0..1 how far the world has resolved into each reality. */
  /**
   * Notches cut into a door, legible only in Deranged (the recurring mark of the fallen
   * post, one more on each door). Pale scratches, fading in with the contradiction.
   */
  private addTally(house: Mesh, w: number, d: number, count: number): void {
    const tex = new DynamicTexture('tallyTex' + count, { width: 128, height: 96 }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 128, 96);
    ctx.strokeStyle = 'rgba(225,220,205,0.95)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    const r = mulberry32(count * 31);
    for (let k = 0; k < count; k++) {
      const x = 14 + k * 12 + (r() - 0.5) * 3;
      ctx.beginPath(); ctx.moveTo(x, 18 + r() * 6); ctx.lineTo(x + (r() - 0.5) * 4, 72 + r() * 8); ctx.stroke();
    }
    tex.update(); tex.hasAlpha = true;
    if (!this.tallyMat) {
      this.tallyMat = new StandardMaterial('tallyMat', this.scene);
      this.tallyMat.disableLighting = true;
      this.tallyMat.emissiveColor = new Color3(0.75, 0.72, 0.66);
      this.tallyMat.useAlphaFromDiffuseTexture = true;
    }
    const m = this.tallyMat.clone('tallyMat' + count)!;
    m.diffuseTexture = tex; m.opacityTexture = tex;
    const p = MeshBuilder.CreatePlane('doorTally', { width: 0.6, height: 0.45, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    p.material = m; p.isPickable = false;
    p.parent = house; p.position.set(w * 0.18, 0.3 + 1.35, d / 2 + 0.075);
    p.isVisible = false;
    this.tallies.push(p);
    this.meshes.push(p);
  }
  private tallies: Mesh[] = [];
  private tallyMat: StandardMaterial | null = null;

  public update(dt: number, voidAmt: number, derangedAmt: number): void {
    this.time += dt;
    const tk = Math.min(1, Math.max(0, (derangedAmt - 0.3) / 0.6));
    for (const t of this.tallies) { t.visibility = tk; t.isVisible = tk > 0.01; }
    // The absent house leaves; its shadow does not
    this.absentHouse.visibility = 1 - voidAmt;
    this.absentHouse.isVisible = voidAmt < 0.99;
    this.absentShadow.visibility = 0.55 + voidAmt * 0.45;
    // Void deck resolves with the Void; its outline is always faintly there
    this.deckMat.alpha = voidAmt * 0.85;
    for (const d of this.voidDecks) d.isVisible = voidAmt > 0.01;
    for (const e of this.voidEdges) e.alpha = 0.1 + voidAmt * 0.55 + Math.sin(this.time * 1.3) * 0.03;
    // The hanging house turns a little; in Deranged it does not stay where it was
    this.inverted.rotation.y = 0.6 + Math.sin(this.time * 0.05) * 0.12;
    this.inverted.position.x = VILLAGE.inverted.x + derangedAmt * 3.5;
    this.facadePrints.visibility = derangedAmt * 0.95;
    this.facadePrints.isVisible = derangedAmt > 0.02;
  }
}
