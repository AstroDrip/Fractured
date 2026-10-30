import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  ParticleSystem,
  Texture,
  Mesh
} from '@babylonjs/core';
import { GAP_NEAR_Z, GAP_FAR_Z } from '../world/layout';

/**
 * The fog floor far below the land: a dark plane that the cliffs and distant
 * structures sink into, and slow mist rising out of the gap.
 */
export class FogLayer {
  private scene: Scene;
  private fogPlane: Mesh;
  private fogParticles: ParticleSystem;

  constructor(scene: Scene) {
    this.scene = scene;

    this.fogPlane = MeshBuilder.CreateGround('abyssalFogPlane', { width: 420, height: 520 }, this.scene);
    this.fogPlane.position.set(0, -5.5, 150);
    this.fogPlane.isPickable = false;

    const mat = new StandardMaterial('fogPlaneMat', this.scene);
    mat.emissiveColor = new Color3(0.035, 0.042, 0.05);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    this.fogPlane.material = mat;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(170, 190, 210, 0.5)');
    grad.addColorStop(0.5, 'rgba(100, 120, 145, 0.22)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    this.fogParticles = new ParticleSystem('abyssalMistPS', 120, this.scene);
    this.fogParticles.particleTexture = new Texture(canvas.toDataURL('image/png'), this.scene);
    this.fogParticles.emitter = new Vector3(0, -4.5, (GAP_NEAR_Z + GAP_FAR_Z) / 2);
    this.fogParticles.minEmitBox = new Vector3(-22, -0.5, -(GAP_FAR_Z - GAP_NEAR_Z) / 2);
    this.fogParticles.maxEmitBox = new Vector3(22, 0.5, (GAP_FAR_Z - GAP_NEAR_Z) / 2);
    this.fogParticles.color1 = new Color4(0.16, 0.19, 0.24, 0.32);
    this.fogParticles.color2 = new Color4(0.1, 0.13, 0.17, 0.24);
    this.fogParticles.colorDead = new Color4(0.02, 0.03, 0.05, 0.0);
    this.fogParticles.minSize = 4.0;
    this.fogParticles.maxSize = 10.0;
    this.fogParticles.minLifeTime = 6.0;
    this.fogParticles.maxLifeTime = 11.0;
    this.fogParticles.emitRate = 9;
    this.fogParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.fogParticles.gravity = new Vector3(0, 0.12, 0);
    this.fogParticles.direction1 = new Vector3(-0.3, 0.2, -0.3);
    this.fogParticles.direction2 = new Vector3(0.3, 0.5, 0.3);
    this.fogParticles.minEmitPower = 0.1;
    this.fogParticles.maxEmitPower = 0.35;
    this.fogParticles.preWarmCycles = 120;
    this.fogParticles.start();
  }

  /** Void: the abyss's fog plane is not there (it would hang pale in the black). */
  public setVoid(v: number): void { this.fogPlane.isVisible = v < 0.5; }

  public setQuality(q: number): void {
    this.fogParticles.emitRate = 4 + q * 6;
  }
}
