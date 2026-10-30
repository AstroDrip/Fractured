# Asset Manifest

Every asset is generated in code at load. No image, model, audio or font files are
shipped or fetched. All are original to this repository.

| Asset | Purpose | Location | Format | Scale | Material | LOD / collision | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Terrain | ground, embankments, cliffs | `world/Terrain.ts` | voxel heightfield, 1 m cells, 0.25 m steps, 9 chunks | 76 × 340 m | `ground` (procedural detail + normal) | chunk frustum culling; collision = `WalkGrid` | final for blockout |
| Railway | sleepers, rails, fasteners, plates, ballast, broken ends, rising rail, buffer stop | `world/Railway.ts` | thin instances + tubes | 1:1 | timber, rust, metalDark, stone | thin-instance batches; no render-mesh collision | final for blockout |
| Props | poles, wires, signs, trees (3 variants), grass, stones, fences, boot, huts, puddles, footprints, silhouettes, lamp, barrier | `world/Props.ts` | merged meshes, thin instances, line system | 1:1 | shared library | circles for poles/signs/lamp; box for barrier | final for blockout |
| White wall | Deranged traversal surface | `world/Structures.ts` | merged boxes, 27 × 38 m | 1:1 | `whiteStone` | face grid in `WalkGrid` | final for blockout |
| Vault obstacles | fallen pole, sleeper pile | `world/Structures.ts` | cylinder/boxes | 1:1 | timber | low boxes | final |
| Settlement | 4 houses, water tower, one lit window | `world/Structures.ts` | merged boxes | 1:1 | concrete, rust, `windowGlow` | occlusion fade; no collision (off route) | blockout |
| Floating landmass | monumental vista | `world/Vista.ts` | merged boxes, ~74 × 96 m | far | fog-free unlit haze tones | none (unreachable) | blockout |
| Moving light | long-range motivation | `world/MovingLight.ts` | billboard + core | 4.5 m glow | additive, fog-free | none | final |
| Phase geometry | Void spans, real fragment, Deranged tree | `world/PhaseGeometry.ts` | merged boxes | 1:1 | `phaseSurface` shader + fallback | `WalkGrid` segments | final |
| Protagonist (skinned, in use) | hooded teenager | `assets/game/character/protagonist.glb` (source `assets/source/character/protagonist.blend`, built by `tools/asset_pipeline/build_protagonist.py`) | GLB, one skinned mesh, 19 joints, no clips | ≈1.66 m | coat, trousers, skin, shoes, hoodInner (replaced at runtime by the game's materials) | 8,026 triangles; no LOD | authored (scripted Blender), original; driven by the procedural pose rig |
| Protagonist (fallback / pose rig) | hooded teenager | `entities/Player.ts` | procedural: tapered limb cylinders + joint caps, lathed torso, hood sphere shell + tube edge, 3 ribbon coat panels, satchel/strap/belt | ≈1.66 m | coat, trousers, shoes, skin, hood interior | no LOD | **procedural articulated figure** (transform hierarchy, no skinned rig or IK) |
| Village houses | the repeated house | `world/Displaced.ts` | one template (plinth, walls, 45° gable roof, door, windows, chimney, gutter) merged per house | 4.6 × 5.2 m | plaster, timber, stone, dark recess, one lit window | occlusion fade | procedural, authored template |
| Facade | walkable house front | `world/Displaced.ts` | boxes merged: front with broken band, cornice, courses, windows, floor cross-section | 27 × 9 m | plaster, stone, timber | gravity surface 1 | procedural |
| Void deck / outline | path that exists only in Void | `world/Displaced.ts` | box decks + line system | 2 spans | emissive pale, alpha by Void amount | walk grid R_VOID | procedural |
| Vortex debris | leaves and grit | `graphics/VortexDebris.ts` | pooled ParticleField (160) | — | alpha cubes | quality-scaled | procedural |
| Creatures | Watcher, Drifters, Hound | `entities/Creatures.ts` | boxes / particle cubes | 2.5 m / small / 1.4 m | dark sheen | grid-constrained (Hound) | blockout |
| Textures (10) | ground, timber, rust, bark, stone, concrete, fabric, sign, footprint, blob, glows | `world/Materials.ts`, `graphics/*` | canvas DynamicTexture 64–256 px | tiled | — | — | final |
| Shaders | `phaseSurface`, `RealityPlugin` | `world/PhaseGeometry.ts`, `graphics/RealityPlugin.ts` | GLSL via Babylon | — | — | — | final |
| Sound | wind, footsteps, fire, phase, creaks, thumps, light voice, Hound, Drifters, ending | `core/AudioSystem.ts` | WebAudio synthesis | — | — | — | final |
| Fonts | UI | system Georgia / system-ui | — | — | — | — | — |

## Licences
| Component | Licence |
| --- | --- |
| Babylon.js 7.54.3 (`@babylonjs/core`) | Apache-2.0 |
| Vite 6, TypeScript 5, Vitest 3 (dev) | MIT / Apache-2.0 / MIT |
| All generated assets | this project |

`@babylonjs/gui` and `@babylonjs/loaders` are listed in `package.json` from the original
repository but not imported. No external assets, AI-generated files or asset services
(e.g. game-asset-mcp, which needs a Hugging Face token) were used.
