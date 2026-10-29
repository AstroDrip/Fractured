import {
  Scene,
  Mesh,
  MeshBuilder,
  Vector3,
  Color3
} from '@babylonjs/core';
import { VoxelRenderer, Voxel } from '../graphics/VoxelRenderer';
import { FracturedHumanoid } from '../entities/FracturedHumanoid';

export class ForgeSector {
  private scene: Scene;
  private renderer: VoxelRenderer;
  public meshes: Mesh[] = [];
  public humanoid: FracturedHumanoid;

  public spawnPoint: Vector3 = new Vector3(0, 0.5, 125);
  public humanoidPoint: Vector3 = new Vector3(0, 1.4, 148); // 1.8-tall figure standing on the ground
  public exitPoint: Vector3 = new Vector3(0, 0.5, 170);

  constructor(scene: Scene) {
    this.scene = scene;
    this.renderer = new VoxelRenderer(this.scene);

    this.humanoid = new FracturedHumanoid(this.scene, this.humanoidPoint);
    this.buildSector();
  }

  private buildSector(): void {
    const voxels: Voxel[] = [];

    // Pale grey graphite sketch colors for Forge of Creation
    const paperColor = new Color3(0.88, 0.9, 0.92);
    const graphiteColor = new Color3(0.3, 0.32, 0.35);

    // 1. Sketchbook ground walkway (Z = 125 to 170)
    for (let z = 125; z <= 170; z++) {
      for (let x = -5; x <= 5; x++) {
        // Outline borders
        const isBorder = (x === -5 || x === 5 || z % 5 === 0);
        voxels.push({
          x,
          y: 0,
          z,
          color: isBorder ? graphiteColor : paperColor
        });
      }

      // Unfinished perspective scaffolding at Z = 145 to 155
      if (z % 3 === 0) {
        voxels.push({ x: -4, y: 1, z, color: graphiteColor });
        voxels.push({ x: 4, y: 1, z, color: graphiteColor });
        voxels.push({ x: -4, y: 2, z, color: graphiteColor });
        voxels.push({ x: 4, y: 2, z, color: graphiteColor });
      }
    }

    const mesh = this.renderer.createVoxelMesh('forgeBase', voxels);
    this.meshes.push(mesh);
  }

  public update(deltaTime: number, playerPos: Vector3): void {
    this.humanoid.update(deltaTime, playerPos);
  }
}
