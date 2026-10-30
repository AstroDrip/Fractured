import { Scene, Mesh, SceneLoader, StandardMaterial } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import poleUrl from '../../assets/game/environment/fallen_pole.glb?url';
import rocksUrl from '../../assets/game/environment/rocks.glb?url';
import forestUrl from '../../assets/game/environment/forest.glb?url';
import riftUrl from '../../assets/game/environment/rift.glb?url';

/**
 * Authored environment meshes (assets/game/environment, built by
 * tools/asset_pipeline/build_environment.py). Loaded once before the world is built;
 * each becomes a disabled template with its transform baked in (the glTF Y-up
 * conversion and reflection included), so builders can clone it or use it as a
 * thin-instance source like any procedural mesh. Missing assets are simply absent:
 * every builder keeps its procedural fallback.
 */
export class EnvAssets {
  private static meshes = new Map<string, Mesh[]>();

  /** All primitives of an asset (one per material), or null if it did not load. */
  public static get(name: string): Mesh[] | null { return EnvAssets.meshes.get(name) ?? null; }

  public static async load(scene: Scene, mats: Record<string, StandardMaterial>): Promise<void> {
    for (const url of [poleUrl, rocksUrl, forestUrl, riftUrl]) {
      try {
        const res = await SceneLoader.ImportMeshAsync('', '', url, scene, undefined, '.glb');
        for (const m of res.meshes) {
          if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
          m.setParent(null);
          m.bakeCurrentTransformIntoVertices();
          m.isPickable = false;
          const mat = m.material ? mats[m.material.name] : undefined;
          if (mat) m.material = mat;
          m.setEnabled(false);
          // glTF primitives are named "<mesh>_primitiveN"; keep the mesh name
          const key = m.name.replace(/_primitive\d+$/, '');
          EnvAssets.meshes.set(key, [...(EnvAssets.meshes.get(key) ?? []), m]);
        }
        res.meshes[0].dispose(false, false);   // the empty __root__
      } catch (e) {
        console.warn('Environment asset unavailable; using the procedural fallback.', url, e);
      }
    }
  }
}
