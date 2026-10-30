# Fractured World — Visual Bible

The mandatory standard for every visible thing in the game. New assets are compared against it (and against the approved examples listed at the end) before they are integrated.

**One sentence:** a small, vulnerable figure carrying a small warm flame through an enormous, abandoned, damp, physically damaged world.

## 1. Silhouette and geometry
- **Silhouette first.** Every major asset must be recognisable as a flat dark shape at gameplay-camera distance, against fog, and beside the protagonist. Never rely on texture to tell two assets apart.
- **Man-made:** heavy proportions, broad surfaces, chunky massing, softened or bevelled edges, slight irregularity (lean, sag, settle). Nothing CAD-thin. Sleepers, posts, beams and panels have visible mass.
- **Natural:** asymmetry, gradual taper, uneven contours, broad readable shapes; occasional sharp breaks where something has fractured.
- **Not voxels.** Chunky does not mean cubes. No grid language, no quantised steps in ground or rock. Use sculpted surfaces, irregular bevels, controlled faceting.

## 2. Scale
- The world dwarfs the protagonist: carriages, structures, poles, trees, cliffs and suspended land are monumental by comparison.
- The protagonist keeps the approved slender, hooded teenage proportions. No chibi, no oversized head. The contrast comes from the world's size and the framing, not from shrinking the figure.

## 3. Palette

| Role | Value (linear-ish, before grading) | Use |
| --- | --- | --- |
| Cold fill | slate/teal, sky light ≈ ambient × 1.35, moon 0.5 | the world's only light away from the flame |
| Earth | 0.19 / 0.155 / 0.115 | soil, trodden dirt 0.20 / 0.165 / 0.12 |
| Damp moss | 0.11 / 0.135 / 0.09 | low ground, patches |
| Straw / dead grass | 0.26 / 0.22 / 0.15 | dry rises, near the line |
| Wet sedge | 0.13 / 0.15 / 0.10 | ditches, hollows |
| Ballast | 0.15 / 0.148 / 0.15 | track bed, blended over a metre |
| Steep rock strata | 0.27–0.37 grey bands | every face steeper than ≈ 1 : 1 |
| Flame | core 1 / 0.86 / 0.6, glow 1 / 0.72 / 0.48, light 1 / 0.6 / 0.27 | the only warm thing |
| Void | 0 black; white 0.95; silhouettes 0.045 | see §8 |

No saturated greens, no blue water, no purple, no neon. Past the gap the same palette loses its warmth.

## 4. Materials
- **Macro detail, not noise.** Large patches of damp soil, broad rust regions, faded paint, mud collecting at bases. No fields of tiny scratches.
- **Vertex colour carries large-scale variation** (terrain, grass, instanced props); textures are small and tileable.
- **Roughness:** broadly matte. Damp areas slightly less rough in places, never plastic. Metal: restrained highlights. Cloth: never glossy. Skin: matte.
- **Shared library:** `src/world/Materials.ts`. New assets reuse its families (earth, grass, bark, dead wood, stone, concrete, plaster, rust, dark metal, cloth, skin, fire); a new material needs a reason.
- **Colour must be continuous.** No hard per-cell or per-triangle switches in vertex colour or shader noise (they read as checkerboards on lit ground).

## 5. Light
- **The flame is the key light.** Warm, strong within 2–3 m, gone by ≈ 7.5 m (`PalmFire` light range). It is the brightest thing near the figure.
- **Cold fill is low** (`Atmosphere.LIGHT`): structure and silhouettes stay readable, but nothing far from the flame is as visible as what is near it.
- **Darkness has structure:** fog-lighter backgrounds behind dark silhouettes; the pool of warm ground around the flame.
- Shadows: one moon shadow map; contact and silhouette shadows over large ones. No resolution increases without measurement.

## 6. Fog and atmosphere
- Exponential fog per narrative zone (`Atmosphere` zones). Foreground readable, mid-ground softens, background becomes silhouette then disappears.
- Near the flame the fog thins (`RealityPlugin` hold radius), smoothly and with a soft ragged edge — never a hard circle, never a per-cell pattern.
- Fog is not a substitute for geometry. Paths, ledges and landmarks must remain legible.

## 7. Vegetation
- **Grass is a family** (`src/world/Grass.ts`): tuft (common, low, drooping), tall (sparse, bent), dead (flattened straw), sedge (wet, dense, broad). Two shape variants each; blades taper and bend along a curve. Placed in patches with bare ground between; never a lawn.
- Grass must not hide the protagonist; the walking line stays clear.
- Trees (`forest.glb`, `build_forest.py`): distinct trunk silhouettes, irregular taper, hand-shaped branches, large readable roots; dead trees brittle, twisted trees grown wrong.

## 8. Realities
- **Normal:** physical continuity, the palette above.
- **Void:** absolute black beyond the flame's white fragment; ground white, objects dark silhouettes, flame amber; fragment shrinks and frays with fuel (`VOID_TONE_GLSL`, `voidWhite`). No fog colour, sky, vista, mist or wires survive.
- **Deranged:** the world contradicts itself (authored anomalies: the fallen post's shadow, door notches); the palette is unchanged; no filters, no permanent aberration.

## 9. Flame and particles
- The flame is a small unstable presence: a clear warm core, irregular fragments (`shard`), embers (`chip`), dark ash (`flake`), fine filaments. Restrained amber, not white, not red.
- Particle families declare a `shape` (`cube`, `chip`, `shard`, `flake`); nothing new defaults to cubes without reason. Unlit particles show their per-instance colour through a white emissive term.
- Impacts are material-specific (`Debris.ts`): stones, earth, splinters, leaves, steam. No generic explosion.

## 10. Post-processing
- Standard tone mapping, exposure 1.45, cool-shadow / warm-highlight curves, restrained vignette, barely visible grain, bloom only for the flame.
- Void drops bloom and grading so its white stays white.
- Never toggle pipeline features at runtime (it rebuilds the pipeline and can blank the frame); change values only.

## 11. Camera
- Fixed isometric follow; authored vantages and shots stay. The figure is small in frame; foreground clutter stays out of the space around it.

## 12. Asset review checklist (every new model or effect)
1. Recognisable silhouette at gameplay distance, against fog, beside the protagonist?
2. Mass and edge language match §1 (no thin CAD beams, no cubes-for-everything)?
3. Scale relative to the protagonist matches §2?
4. Uses `Materials.ts` families and the palette; colour variation continuous?
5. Reads under the flame's warm light and in the cold fill alone?
6. Correct in Void (participates in `RealityPlugin`) and in Deranged?
7. Blender source + GLB in the pipeline, sensible pivot and scale, triangle count recorded in `ASSET_MANIFEST.md`?
8. Collision / walk grid / flame contact match what is drawn?
9. Thin-instanced or merged; no per-frame allocation; bounded particles?
10. Reviewed in the real game camera (not only a Blender render)?

## Approved reference examples
- Ground: the sculpted terrain (`Terrain.ts`) and the rift (`Rift.ts`).
- Grass: `Grass.ts` family.
- Flame: `PalmFire.ts` core, glow, `shard` fragments, `chip` embers.
- Void: the forest lattice in Void at full and at 12 % fuel.
- Deranged: the fallen post (`Anchor.ts`).
