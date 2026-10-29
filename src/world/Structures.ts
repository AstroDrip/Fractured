import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Materials } from './Materials';
import { ThinBatch } from './ThinBatch';
import { mulberry32 } from '../core/rng';
import { WALL, SINKHOLE, VAULTS, GROUND_Y, BED_Y } from './layout';

/**
 * Built structures that carry gameplay: the white wall walked in Deranged (with the
 * route shown by footprints that only exist there), the two vaults, and the small
 * railway-edge settlement at the start of the line.
 */
export class Structures {
  public meshes: Mesh[] = [];
  public shadowCasters: Mesh[] = [];
  public occluders: Mesh[] = [];
  public whiteStone: StandardMaterial;
  public windowGlow: StandardMaterial;
  public wallFootprints!: Mesh;
  private rnd = mulberry32(777);

  constructor(private scene: Scene, private mats: Materials) {
    this.whiteStone = new StandardMaterial('whiteStone', scene);
    this.whiteStone.diffuseTexture = mats.concrete.diffuseTexture;
    this.whiteStone.bumpTexture = mats.concrete.bumpTexture;
    this.whiteStone.diffuseColor = new Color3(2.35, 2.36, 2.4);
    this.whiteStone.specularColor = new Color3(0.04, 0.04, 0.04);
    this.windowGlow = new StandardMaterial('windowGlow', scene);
    this.windowGlow.disableLighting = true;
    this.windowGlow.emissiveColor = new Color3(0.95, 0.62, 0.3);
  }

  public build(): void {
    this.buildWall();
    this.buildVaults();
    this.buildSettlement();
  }

  // --- The white wall -------------------------------------------------------

  private buildWall(): void {
    const parts: Mesh[] = [];
    const T = 1.2, H = 38;              // far taller than the camera ever shows
    const backX = WALL.x - T / 2;
    const box = (z0: number, z1: number, y0: number, y1: number, x = backX, t = T) => {
      const b = MeshBuilder.CreateBox('wallPart', { width: t, height: y1 - y0, depth: z1 - z0 }, this.scene);
      b.position.set(x, GROUND_Y + (y0 + y1) / 2, (z0 + z1) / 2);
      parts.push(b);
    };
    const { hole } = WALL;
    box(WALL.z0, hole.u0, -6, H);
    box(hole.u1, WALL.z1, -6, H);
    box(hole.u0, hole.u1, hole.v1, H);
    // The broken section: an exposed cross-section, deeper inside than the wall is thick
    box(hole.u0, hole.u1, -6, hole.v1, backX - 2.2, 0.6);
    for (let i = 0; i < 6; i++) {
      // Floor plates of an interior that should not fit inside a wall
      box(hole.u0 + 0.1, hole.u1 - 0.1, i * 1.6 - 4.6, i * 1.6 - 4.45, backX - 1.0, 2.0);
    }
    const wall = Mesh.MergeMeshes(parts, true, true)!;
    wall.name = 'whiteWall';
    wall.material = this.whiteStone;
    wall.receiveShadows = true;
    this.meshes.push(wall);
    this.shadowCasters.push(wall);

    // Window rows: dark recesses far above
    const win = new ThinBatch(MeshBuilder.CreateBox('wallWindow', { size: 1 }, this.scene), false);
    win.mesh.material = this.mats.hoodInner;
    for (let row = 0; row < 7; row++) {
      for (let z = WALL.z0 + 1.6; z < WALL.z1 - 1; z += 2.4) {
        const y = GROUND_Y + 11 + row * 3.6;
        win.add(WALL.x + 0.01, y, z, 0, 0, 0, 0.06, 1.6, 0.9);
      }
    }
    this.meshes.push(win.commit());

    // Rubble fallen into the sinkhole from the broken section
    const rubble = new ThinBatch(MeshBuilder.CreateBox('rubble', { size: 1 }, this.scene));
    rubble.mesh.material = this.whiteStone;
    for (let i = 0; i < 26; i++) {
      const s = 0.3 + this.rnd() * 1.1;
      rubble.add(WALL.x + 0.5 + this.rnd() * 5, GROUND_Y - 1 - this.rnd() * 8, hole.u0 + this.rnd() * (hole.u1 - hole.u0),
        this.rnd() * 6, this.rnd() * 6, this.rnd() * 6, s, s * 0.7, s * 1.2, 0.8, 0.8, 0.82);
    }
    this.meshes.push(rubble.commit());

    // The route across the face, walked before anyone walked it: footprints on the wall
    const plane = MeshBuilder.CreatePlane('wallPrint', { width: 0.13, height: 0.28 }, this.scene);
    plane.material = this.mats.footprint;
    const prints = new ThinBatch(plane);
    const route: [number, number][] = [[218.6, 0.3], [222.5, 2.8], [225.2, 5.4], [230, 5.6], [234.8, 5.4], [238, 2.9], [241.6, 0.3]];
    for (let s = 0; s < route.length - 1; s++) {
      const [u0, v0] = route[s], [u1, v1] = route[s + 1];
      const len = Math.hypot(u1 - u0, v1 - v0);
      const ang = Math.atan2(v1 - v0, u1 - u0);
      for (let d = 0, i = 0; d < len; d += 0.68, i++) {
        const t = d / len;
        const side = i % 2 === 0 ? -0.11 : 0.11;
        const u = u0 + (u1 - u0) * t - Math.sin(ang) * side, v = v0 + (v1 - v0) * t + Math.cos(ang) * side;
        // The print lies on the face (normal +X), toe pointing along the route
        prints.add(WALL.x + 0.012, GROUND_Y + v, u, -Math.PI / 2, 0, ang - Math.PI / 2, 1, 1, 1, 1, 1, 1, 0.9);
      }
    }
    this.wallFootprints = prints.commit();
    this.wallFootprints.visibility = 0;
    this.meshes.push(this.wallFootprints);

    // The sinkhole's lip: the track ends in broken sleepers on both sides
    const lip = new ThinBatch(MeshBuilder.CreateBox('lipSleeper', { size: 1 }, this.scene));
    lip.mesh.material = this.mats.timber;
    lip.add(0.2, BED_Y - 0.3, SINKHOLE.z0 + 0.4, 0.3, 0.8, 0.2, 2.2, 0.13, 0.27, 0.8, 0.8, 0.8);
    lip.add(-0.3, BED_Y - 0.5, SINKHOLE.z1 - 0.5, -0.2, -0.9, 0.1, 2.0, 0.13, 0.27, 0.75, 0.75, 0.75);
    this.meshes.push(lip.commit());
  }

  // --- Vaults ---------------------------------------------------------------

  private buildVaults(): void {
    for (const v of VAULTS) {
      const zc = (v.z0 + v.z1) / 2;
      if (v.id === 'fallen-pole') {
        const pole = MeshBuilder.CreateCylinder('fallenPole', { height: v.x1 - v.x0 + 1.6, diameter: 0.24, tessellation: 7 }, this.scene);
        pole.rotation.z = Math.PI / 2;
        pole.rotation.y = 0.06;
        pole.position.set(0.3, BED_Y + v.height - 0.14, zc);
        pole.material = this.mats.timber;
        // Its crossarm still attached, digging into the ballast
        const arm = MeshBuilder.CreateBox('fallenArm', { width: 0.1, height: 1.5, depth: 0.1 }, this.scene);
        arm.position.set(v.x1 + 0.4, BED_Y + 0.5, zc);
        arm.rotation.x = 0.4;
        arm.material = this.mats.timber;
        this.meshes.push(pole, arm);
        this.shadowCasters.push(pole);
      } else {
        const pile = new ThinBatch(MeshBuilder.CreateBox('pileSleeper', { size: 1 }, this.scene));
        pile.mesh.material = this.mats.timber;
        for (let i = 0; i < 4; i++) {
          pile.add((this.rnd() - 0.5) * 0.6, BED_Y + 0.07 + i * 0.13, zc + (this.rnd() - 0.5) * 0.25,
            (this.rnd() - 0.5) * 0.25, 0, (this.rnd() - 0.5) * 0.05, v.x1 - v.x0 + 0.6, 0.13, 0.3, 0.8, 0.78, 0.76);
        }
        this.meshes.push(pile.commit());
        this.shadowCasters.push(pile.mesh);
      }
    }
  }

  // --- The settlement -------------------------------------------------------

  private buildSettlement(): void {
    // On the far side of the line from the camera, so roofs never cover the protagonist
    const houses = [
      { x: -12, z: 22, w: 4.2, d: 5.5, h: 2.9, yaw: 0.08, lit: false },
      { x: -18.5, z: 27, w: 5, d: 4.5, h: 3.2, yaw: -0.15, lit: true },
      { x: -11.5, z: 33.5, w: 3.6, d: 4.4, h: 2.6, yaw: 0.2, lit: false },
      { x: -17, z: 39, w: 4.6, d: 6, h: 3.4, yaw: 0.05, lit: false }
    ];
    for (const hs of houses) {
      const parts: Mesh[] = [];
      const body = MeshBuilder.CreateBox('houseBody', { width: hs.w, height: hs.h, depth: hs.d }, this.scene);
      body.position.y = hs.h / 2;
      parts.push(body);
      for (const side of [-1, 1]) {
        const roof = MeshBuilder.CreateBox('roof', { width: hs.w * 0.62, height: 0.14, depth: hs.d + 0.5 }, this.scene);
        roof.position.set(side * hs.w * 0.25, hs.h + hs.w * 0.2, 0);
        roof.rotation.z = -side * 0.62;
        parts.push(roof);
      }
      const gable = MeshBuilder.CreateBox('gable', { width: hs.w * 0.6, height: hs.w * 0.36, depth: hs.d - 0.1 }, this.scene);
      gable.position.y = hs.h + hs.w * 0.16;
      parts.push(gable);
      const house = Mesh.MergeMeshes(parts, true, true)!;
      house.material = this.mats.concrete;
      house.position.set(hs.x, GROUND_Y - 0.05, hs.z);
      house.rotation.y = hs.yaw;
      house.receiveShadows = true;
      this.meshes.push(house);
      this.shadowCasters.push(house);
      this.occluders.push(house);

      // Door and windows on the side facing the line
      const door = MeshBuilder.CreateBox('door', { width: 0.04, height: 1.9, depth: 0.9 }, this.scene);
      door.parent = house;
      door.position.set(hs.w / 2 + 0.01, 0.95, -hs.d * 0.2);
      door.material = this.mats.hoodInner;
      const win = MeshBuilder.CreateBox('window', { width: 0.04, height: 0.7, depth: 0.8 }, this.scene);
      win.parent = house;
      win.position.set(hs.w / 2 + 0.01, 1.6, hs.d * 0.22);
      // One window is lit. Someone, or something, keeps it so.
      win.material = hs.lit ? this.windowGlow : this.mats.hoodInner;
      this.meshes.push(door, win);
    }
    // Water tower beside the settlement
    const tparts: Mesh[] = [];
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = MeshBuilder.CreateBox('towerLeg', { width: 0.18, height: 7, depth: 0.18 }, this.scene);
      leg.position.set(lx, 3.5, lz);
      tparts.push(leg);
    }
    const tank = MeshBuilder.CreateCylinder('tank', { height: 2.6, diameter: 3.2, tessellation: 12 }, this.scene);
    tank.position.y = 8.3;
    tparts.push(tank);
    const tower = Mesh.MergeMeshes(tparts, true, true)!;
    tower.material = this.mats.rust;
    tower.position.set(-23, GROUND_Y, 31);
    this.meshes.push(tower);
    this.shadowCasters.push(tower);
  }
}
