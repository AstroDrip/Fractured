import {
  Scene,
  Mesh,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial
} from '@babylonjs/core';

export class FracturedHumanoid {
  private scene: Scene;
  public mesh: Mesh;
  public position: Vector3;
  private mat: StandardMaterial;

  public isSynchronized: boolean = false;
  public hasTriggeredRecognition: boolean = false;
  private animTime: number = 0;

  // Multiplies the figure's opacity; used to make it fade as it is approached
  public fade: number = 1;

  public onRecognitionTriggered?: () => void;

  constructor(scene: Scene, startPos: Vector3) {
    this.scene = scene;
    this.position = startPos.clone();

    // Create tall, slender displaced figure mesh
    this.mesh = MeshBuilder.CreateBox('humanoidRoot', { width: 0.35, height: 1.8, depth: 0.25 }, this.scene);
    this.mesh.position.copyFrom(startPos);
    this.mesh.isPickable = false;

    this.mat = new StandardMaterial('humanoidMat', this.scene);
    this.mat.diffuseColor = new Color3(0.3, 0.32, 0.36);
    this.mat.emissiveColor = new Color3(0.04, 0.05, 0.065);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.alpha = 0.65; // Phasing translucency
    this.mesh.material = this.mat;
  }

  public update(deltaTime: number, playerPos: Vector3): void {
    this.animTime += deltaTime;

    const distToPlayer = Vector3.Distance(this.position, playerPos);

    // Unstable phasing opacity flicker
    const flicker = 0.62 + 0.2 * Math.sin(this.animTime * 6.0) + (Math.random() - 0.5) * 0.06;
    this.mat.alpha = Math.max(0.0, Math.min(0.9, flicker)) * this.fade;
    this.mesh.isVisible = this.mat.alpha > 0.01;

    // Recognition sequence trigger when player comes close (~4 meters)
    if (distToPlayer < 4.5 && !this.hasTriggeredRecognition && this.fade > 0.5) {
      this.hasTriggeredRecognition = true;
      this.isSynchronized = true;
      this.mat.emissiveColor = new Color3(0.4, 0.6, 0.9); // Synchronized blue glow

      if (this.onRecognitionTriggered) {
        this.onRecognitionTriggered();
      }
    }

    // Always turned toward the teenager
    const dir = playerPos.subtract(this.position);
    dir.y = 0;
    if (dir.length() > 0.01) {
      dir.normalize();
      this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    }
  }
}
