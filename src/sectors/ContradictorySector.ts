import {
  Scene,
  Mesh,
  MeshBuilder,
  Vector3,
  Color3
} from '@babylonjs/core';
import { VoxelRenderer, Voxel } from '../graphics/VoxelRenderer';
import { Creature } from '../entities/Creature';

export class ContradictorySector {
  private scene: Scene;
  private renderer: VoxelRenderer;
  public meshes: Mesh[] = [];
  public creatures: Creature[] = [];

  public spawnPoint: Vector3 = new Vector3(0, 0.5, 70);
  public experimentArea: Vector3 = new Vector3(0, 0.5, 95);
  public exitPoint: Vector3 = new Vector3(0, 0.5, 125);

  constructor(scene: Scene) {
    this.scene = scene;
    this.renderer = new VoxelRenderer(this.scene);
    this.buildSector();
  }

  private buildSector(): void {
    const voxels: Voxel[] = [];

    const concreteColor = new Color3(0.25, 0.28, 0.32);
    const brickColor = new Color3(0.35, 0.22, 0.18);
    const accentColor = new Color3(0.4, 0.35, 0.5);

    // 1. Overlapping Station Plaza (Z = 70 to 125)
    for (let z = 70; z <= 125; z++) {
      for (let x = -6; x <= 6; x++) {
        // Checkerboard conflicting floor tiles
        const color = ((x + z) % 2 === 0) ? concreteColor : brickColor;
        voxels.push({ x, y: 0, z, color });
      }

      // Conflicting Walls with Window Outlines (X = -6, X = 6)
      if (z % 4 === 0) {
        for (let y = 1; y <= 5; y++) {
          voxels.push({ x: -6, y, z, color: accentColor });
          voxels.push({ x: 6, y, z, color: accentColor });
        }
      }

      // Impossible Stairs at Z = 90
      if (z >= 88 && z <= 94) {
        const stepY = (z - 88);
        voxels.push({ x: -3, y: stepY, z, color: concreteColor });
        voxels.push({ x: 3, y: stepY, z, color: concreteColor });
      }
    }

    const mesh = this.renderer.createVoxelMesh('contradictoryBase', voxels);
    this.meshes.push(mesh);

    // Spawn unfamiliar life form in experiment area
    const c1 = new Creature(this.scene, new Vector3(2.5, 1.35, 98)) // hovers just above the ground;
    this.creatures.push(c1);
  }

  public update(deltaTime: number, playerPos: Vector3, playerSpeed: number): void {
    this.creatures.forEach(c => c.update(deltaTime, playerPos, playerSpeed));
  }
}
