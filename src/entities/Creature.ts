import {
  Scene,
  Mesh,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial,
  Quaternion
} from '@babylonjs/core';

export class Creature {
  private scene: Scene;
  public mesh: Mesh;
  public position: Vector3;
  private targetPos: Vector3;
  private moveSpeed: number = 1.8;
  private animTime: number = 0;
  private isAlerted: boolean = false;
  private alertTimer: number = 0;

  constructor(scene: Scene, startPos: Vector3) {
    this.scene = scene;
    this.position = startPos.clone();
    this.targetPos = startPos.clone();

    // Create unfamiliar non-earth creature geometry (floating geometric spine structure)
    this.mesh = MeshBuilder.CreateBox('creatureRoot', { width: 0.5, height: 1.2, depth: 0.5 }, this.scene);
    this.mesh.position.copyFrom(startPos);

    const mat = new StandardMaterial('creatureMat', this.scene);
    mat.diffuseColor = new Color3(0.2, 0.25, 0.3);
    mat.emissiveColor = new Color3(0.05, 0.1, 0.15);
    this.mesh.material = mat;

    // Add extra strange floating geometric ribs around it
    const rib1 = MeshBuilder.CreateBox('rib1', { width: 0.9, height: 0.1, depth: 0.6 }, this.scene);
    rib1.position.y = 0.3;
    rib1.parent = this.mesh;
    rib1.material = mat;

    const rib2 = MeshBuilder.CreateBox('rib2', { width: 0.7, height: 0.1, depth: 0.8 }, this.scene);
    rib2.position.y = -0.2;
    rib2.parent = this.mesh;
    rib2.material = mat;
  }

  public update(deltaTime: number, playerPos: Vector3, playerSpeed: number): void {
    this.animTime += deltaTime * 2.0;

    // 1. Motion & Sound Sensing (triggers when player moves fast within 8m range)
    const distToPlayer = Vector3.Distance(this.position, playerPos);
    if (distToPlayer < 7.5 && playerSpeed > 2.0) {
      this.isAlerted = true;
      this.alertTimer = 3.0; // Stay alerted for 3 seconds
    }

    if (this.alertTimer > 0) {
      this.alertTimer -= deltaTime;
      if (this.alertTimer <= 0) this.isAlerted = false;
    }

    // 2. Unsettled Twitching AI behavior
    if (this.isAlerted) {
      // Skittish move away or turn toward sound source
      const awayDir = this.position.subtract(playerPos).normalize();
      awayDir.y = 0;
      this.targetPos = this.position.add(awayDir.scale(0.8));
    } else if (Math.random() < 0.01) {
      // Random subtle shift
      this.targetPos = this.position.add(new Vector3(
        (Math.random() - 0.5) * 2.5,
        0,
        (Math.random() - 0.5) * 2.5
      ));
    }

    // Move toward target pos
    const dir = this.targetPos.subtract(this.position);
    dir.y = 0;
    if (dir.length() > 0.1) {
      dir.normalize();
      this.position.addInPlace(dir.scale(this.moveSpeed * deltaTime));
      this.mesh.position.copyFrom(this.position);
      this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    }

    // Floating jerk animation
    this.mesh.position.y = this.position.y + Math.sin(this.animTime * 4.0) * 0.15 + (this.isAlerted ? Math.sin(this.animTime * 20.0) * 0.05 : 0);
  }
}
