import { Scene, Mesh, AbstractMesh, StandardMaterial, Color3 } from '@babylonjs/core';
import { Materials } from './Materials';
import { Terrain } from './Terrain';
import { WalkGrid } from './WalkGrid';
import { Railway } from './Railway';
import { Props } from './Props';
import { PhaseGeometry } from './PhaseGeometry';
import { Anomalies } from './Anomalies';
import { Structures } from './Structures';
import { Displaced } from './Displaced';
import { Vista } from './Vista';
import { MovingLight } from './MovingLight';
import { FogLayer } from '../graphics/FogLayer';
import { RealityPlugin } from '../graphics/RealityPlugin';
import { Watcher, Drifters, Hound } from '../entities/Creatures';

/**
 * Owns every piece of the opening's world and builds it in discrete steps so the
 * loading screen can report real progress.
 */
export class World {
  public mats: Materials;
  public grid!: WalkGrid;
  public terrain!: Terrain;
  public railway!: Railway;
  public props!: Props;
  public structures!: Structures;
  public displaced!: Displaced;
  public vista!: Vista;
  public light!: MovingLight;
  public phaseGeom!: PhaseGeometry;
  public anomalies!: Anomalies;
  public fog!: FogLayer;
  public watcher!: Watcher;
  public drifters!: Drifters;
  public hound!: Hound;

  constructor(private scene: Scene) {
    this.mats = new Materials(scene);
  }

  public buildSteps(): { label: string; run: () => void }[] {
    const matSteps = this.mats.buildSteps().map(run => ({ label: 'painting materials', run }));
    return [
      ...matSteps,
      { label: 'laying out the route', run: () => { this.grid = new WalkGrid(); } },
      { label: 'raising the ground', run: () => { this.terrain = new Terrain(this.scene, this.mats.ground); this.terrain.build(); } },
      { label: 'laying the railway', run: () => { this.railway = new Railway(this.scene, this.mats); this.railway.build(); } },
      { label: 'placing what was left behind', run: () => { this.props = new Props(this.scene, this.mats, this.terrain, this.grid); this.props.build(); } },
      { label: 'raising the wall', run: () => { this.structures = new Structures(this.scene, this.mats); this.structures.build(); } },
      { label: 'the houses that moved', run: () => { this.displaced = new Displaced(this.scene, this.mats); this.displaced.build(); } },
      { label: 'the distance', run: () => { this.vista = new Vista(this.scene); this.light = new MovingLight(this.scene); } },
      { label: 'the other configurations', run: () => {
        this.phaseGeom = new PhaseGeometry(this.scene, this.props.treeVariants[2]);
        this.anomalies = new Anomalies(this.scene, this.phaseGeom, this.props.barrierMeshes);
        this.fog = new FogLayer(this.scene);
      } },
      { label: 'what lives here', run: () => {
        this.watcher = new Watcher(this.scene);
        this.drifters = new Drifters(this.scene);
        this.hound = new Hound(this.scene, this.grid);
        this.attachRealityFX();
      } }
    ];
  }

  // Every world surface takes part in Void dissolution, Deranged disagreement and wind.
  // Excluded on purpose: the protagonist, the flame, the lamp glass, the lit window and
  // the distant vista, which remain when matter leaves.
  private attachRealityFX(): void {
    const m = this.mats;
    const world: [StandardMaterial, number][] = [
      [m.ground, 0], [m.timber, 0], [m.rust, 0], [m.metalDark, 0], [m.bark, 0.025], [m.stone, 0],
      [m.concrete, 0], [m.grass, 0.9], [m.signPlate, 0], [m.puddle, 0], [this.structures.whiteStone, 0],
      [this.displaced.plaster, 0]
    ];
    for (const [mat, sway] of world) new RealityPlugin(mat, sway);
    // The far silhouettes keep their own aerial perspective so the end of the line reads
    m.silhouette.fogEnabled = false;
    m.silhouette.emissiveColor = new Color3(0.072, 0.082, 0.096);  // just under the sky: haze, not cut-outs
  }

  public shadowCasters(): AbstractMesh[] {
    return [...this.railway.shadowCasters, ...this.props.shadowCasters, ...this.structures.shadowCasters, ...this.displaced.shadowCasters];
  }

  public shadowReceivers(): Mesh[] {
    return [...this.terrain.meshes, ...this.railway.meshes];
  }

  public occluders(): Mesh[] {
    return [...this.structures.occluders, ...this.props.huts, ...this.displaced.occluders];
  }
}
