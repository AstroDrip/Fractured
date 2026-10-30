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
import { Cutting } from './Cutting';
import { EnvAssets } from './EnvAssets';
import { Debris } from './Debris';
import { Yard } from './Yard';
import { Forest } from './Forest';
import { Rift } from './Rift';
import { Anchor } from './Anchor';
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
  public cutting!: Cutting;
  public anchor!: Anchor;   // the first contradiction; kept out of the shadow casters on purpose
  public debris!: Debris;
  public yard!: Yard;
  public forest!: Forest;
  public rift!: Rift;
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

  public buildSteps(): { label: string; run: () => void | Promise<void> }[] {
    const matSteps = this.mats.buildSteps().map(run => ({ label: 'painting materials', run }));
    return [
      ...matSteps,
      { label: 'shaping what was carved', run: () => EnvAssets.load(this.scene, {
        timber: this.mats.timber, insulator: this.mats.metalDark, stone: this.mats.stone, bark: this.mats.bark, deadwood: this.mats.signPlate, earth: this.mats.ground
      }) },
      { label: 'laying out the route', run: () => { this.grid = new WalkGrid(); } },
      { label: 'raising the ground', run: () => { this.terrain = new Terrain(this.scene, this.mats.ground, this.grid); this.terrain.build(); } },
      { label: 'laying the railway', run: () => { this.railway = new Railway(this.scene, this.mats); this.railway.build(); } },
      { label: 'placing what was left behind', run: () => { this.props = new Props(this.scene, this.mats, this.terrain, this.grid); this.props.build(); } },
      { label: 'raising the wall', run: () => { this.structures = new Structures(this.scene, this.mats); this.structures.build(); } },
      { label: 'the houses that moved', run: () => { this.displaced = new Displaced(this.scene, this.mats); this.displaced.build(); } },
      { label: 'the cutting', run: () => { this.cutting = new Cutting(this.scene, this.mats); this.cutting.build();
        this.anchor = new Anchor(this.scene, this.mats, (x, z) => this.terrain.heightAt(x, z)); this.anchor.build(); this.debris = new Debris(this.scene, this.mats, this.grid);
        this.yard = new Yard(this.scene, this.mats, this.grid); this.yard.build();
        this.forest = new Forest(this.scene, this.mats, this.grid, this.terrain); this.forest.build();
        this.rift = new Rift(this.scene, this.mats); this.rift.build(); } },
      { label: 'the distance', run: () => { this.vista = new Vista(this.scene); this.light = new MovingLight(this.scene); } },
      { label: 'the other configurations', run: () => {
        this.phaseGeom = new PhaseGeometry(this.scene, this.props.treeVariants[2]);
        this.anomalies = new Anomalies(this.scene, this.phaseGeom, this.props.barrierMeshes);
        this.fog = new FogLayer(this.scene);
      } },
      { label: 'what lives here', run: () => {
        this.watcher = new Watcher(this.scene);
        this.watcher.groundAt = (x, z) => { const h = this.terrain.heightAt(x, z); return h > -100 ? h : 0.5; };
        this.watcher.reset();
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
    // [material, sway, Void tone]: tone 1 is ground that turns white around the flame in
    // Void, 0 an object that stands dark against it; grass sits between, so it still reads.
    // Ground and grass stay whole in Void: what you stand on must stay readable (dissolving
    // grass reads as noise on the white); matter dissolves
    const world: [StandardMaterial, number, number][] = [
      [m.ground, 0, 1], [m.timber, 0, 0], [m.rust, 0, 0], [m.metalDark, 0, 0], [m.bark, 0.025, 0], [m.stone, 0, 0],
      [m.concrete, 0, 1], [m.grass, 0.9, 0.55], [m.signPlate, 0, 0], [m.puddle, 0, 1], [this.structures.whiteStone, 0, 0],
      [this.displaced.plaster, 0, 0], [this.rift.rock, 0, 1], [this.rift.heldRock, 0, 0]
    ];
    for (const [mat, sway, tone] of world) new RealityPlugin(mat, sway, tone, tone < 0.5);
    // The far silhouettes keep their own aerial perspective so the end of the line reads
    m.silhouette.fogEnabled = false;
    m.silhouette.emissiveColor = new Color3(0.072, 0.082, 0.096);  // just under the sky: haze, not cut-outs
  }

  public shadowCasters(): AbstractMesh[] {
    return [...this.railway.shadowCasters, ...this.props.shadowCasters, ...this.structures.shadowCasters, ...this.displaced.shadowCasters, ...this.cutting.shadowCasters, ...this.yard.shadowCasters, ...this.forest.shadowCasters, ...this.rift.shadowCasters];
  }

  public shadowReceivers(): Mesh[] {
    return [...this.terrain.meshes, ...this.railway.meshes];
  }

  public occluders(): Mesh[] {
    return [...this.structures.occluders, ...this.props.huts, ...this.displaced.occluders];
  }
}
