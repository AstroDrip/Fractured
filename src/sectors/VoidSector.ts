import {
  Scene,
  Mesh,
  MeshBuilder,
  PointLight,
  Vector3,
  Color3,
  StandardMaterial
} from '@babylonjs/core';
import { VoxelRenderer, Voxel } from '../graphics/VoxelRenderer';

export class VoidSector {
  private scene: Scene;
  private renderer: VoxelRenderer;
  public meshes: Mesh[] = [];

  public spawnPoint: Vector3 = new Vector3(0, 0.5, 170);
  public beaconPoint: Vector3 = new Vector3(0, 1.6, 210); // 2.2-tall lamp standing on the ground

  // Distant recurring signal lamp
  public signalLampMesh: Mesh;
  public signalLight: PointLight;

  public isFlameExtinguished: boolean = false;
  public onExtinctionTriggered?: () => void;

  constructor(scene: Scene) {
    this.scene = scene;
    this.renderer = new VoxelRenderer(this.scene);

    // Create recurring signal beacon lamp at end of Void path
    this.signalLampMesh = MeshBuilder.CreateCylinder('signalLamp', { height: 2.2, diameter: 0.4 }, this.scene);
    this.signalLampMesh.position.copyFrom(this.beaconPoint);

    const lampMat = new StandardMaterial('lampMat', this.scene);
    lampMat.emissiveColor = new Color3(0.9, 0.7, 0.2);
    this.signalLampMesh.material = lampMat;

    this.signalLight = new PointLight('signalLight', this.beaconPoint.add(new Vector3(0, 1.2, 0)), this.scene);
    this.signalLight.diffuse = new Color3(0.9, 0.7, 0.2);
    this.signalLight.intensity = 2.5;

    this.buildSector();
  }

  private buildSector(): void {
    const voxels: Voxel[] = [];

    const voidGroundColor = new Color3(0.04, 0.04, 0.06);
    const borderColor = new Color3(0.12, 0.12, 0.16);

    // Narrow readable path through Void (Z = 170 to 215)
    for (let z = 170; z <= 215; z++) {
      for (let x = -3; x <= 3; x++) {
        const isEdge = (x === -3 || x === 3);
        voxels.push({
          x,
          y: 0,
          z,
          color: isEdge ? borderColor : voidGroundColor
        });
      }
    }

    const mesh = this.renderer.createVoxelMesh('voidBase', voxels);
    this.meshes.push(mesh);
  }

  public update(deltaTime: number, playerPos: Vector3): number {
    // Pulse signal lamp
    const pulse = 2.0 + 0.8 * Math.sin(performance.now() * 0.003);
    this.signalLight.intensity = pulse;

    // Calculate distance toward beacon (Z = 170 -> 205)
    const progress = Math.max(0, Math.min(1.0, (playerPos.z - 170) / 35.0));

    // Flame drains as player advances into Void
    const flameEnergy = Math.max(0, 1.0 - progress * 1.05);

    if (flameEnergy <= 0.001 && !this.isFlameExtinguished) {
      this.isFlameExtinguished = true;
      if (this.onExtinctionTriggered) {
        this.onExtinctionTriggered();
      }
    }

    return flameEnergy;
  }
}
