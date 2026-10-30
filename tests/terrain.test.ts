import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, StandardMaterial, VertexBuffer } from '@babylonjs/core';
import { Terrain } from '../src/world/Terrain';
import { WalkGrid, Surface } from '../src/world/WalkGrid';
import { RIFT } from '../src/world/layout';

const engine = new NullEngine();
const scene = new Scene(engine);
const grid = new WalkGrid();
const terrain = new Terrain(scene, new StandardMaterial('g', scene), grid);
terrain.build();

describe('Sculpted terrain', () => {
  it('faces up (front faces and normals): the ground is drawn and lit from above', () => {
    let up = 0, n = 0;
    for (const m of terrain.meshes) {
      const nr = m.getVerticesData(VertexBuffer.NormalKind)!;
      for (let i = 1; i < nr.length; i += 3) { n++; if (nr[i] > 0.2) up++; }
    }
    expect(up / n).toBeGreaterThan(0.85);   // the rest are cliff walls into the abyss
  });
  it('is not stepped: walkable soil and gravel match the walk grid within 0.15 m', () => {
    let n = 0, bad = 0;
    for (let z = -20; z < 300; z += 0.5) for (let x = -28; x < 28; x += 0.5) {
      const cx = x + 0.25, cz = z + 0.25;
      if (!grid.isWalkable(cx, cz, 'normal')) continue;
      if (cx < RIFT.bounds.x1 && cz > RIFT.bounds.z0 && cz < RIFT.bounds.z1) continue;
      const s = grid.surfaceAt(cx, cz);
      if (s !== Surface.SOIL && s !== Surface.GRAVEL) continue;   // stone and wood stand on structures
      const th = terrain.heightAt(cx, cz);
      if (th < -100) continue;
      n++;
      if (Math.abs(th - grid.heightAt(cx, cz)) > 0.15) bad++;
    }
    expect(n).toBeGreaterThan(3000);
    expect(bad / n).toBeLessThan(0.02);
  });
  it('has no 0.25 m terraces between neighbouring lattice points away from cliffs', () => {
    // Sample a plain stretch beside the line: slopes vary smoothly, never in quantised steps
    const hs: number[] = [];
    for (let x = 6; x < 16; x += 0.5) hs.push(terrain.heightAt(x, 60));
    const steps = hs.slice(1).map((h, i) => Math.abs(h - hs[i]));
    const quantised = steps.filter(s => s > 0.2 && Math.abs((s / 0.25) - Math.round(s / 0.25)) < 0.02).length;
    expect(quantised).toBe(0);
  });
});
