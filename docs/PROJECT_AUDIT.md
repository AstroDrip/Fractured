# Project Audit

## Pass 5 (2026-10-30): the cutting, creature bodies, vortex in grass and fog

### Baseline before this pass (measured)
- Local `main` equal to `origin/main` (`0a553da`). `tsc` clean, `npm test` 40 passing,
  `npm run build` succeeds; autopilot full route completes (179 s simulated with detours).

### What changed
| Area | Change | Status |
| --- | --- | --- |
| World | **The cutting** (z 38–70, west of the line): ramp up off the line, rock shelf under a cliff, a length of track running into the rock, a fallen trunk over a stream cleft (narrow footing: speed capped at 1.5 m/s, arms out), ramp back down. `world/Cutting.ts`, layout `CUTTING`, grid heights per route point, terrain cliff/cleft/embankment. | Implemented |
| Water | Stream in the cleft (dark, specular, scrolling normal map), waterfall sheet from a crack in the cliff, culvert under the line; flow slows almost to stillness in Void. | Implemented (stylised; no reflections) |
| Audio | Water voice: own panner + distance low-pass (duller further away), all but silent in Void. New footstep sounds for stone and wood (trunk). | Implemented; **not listened to** |
| Creatures | Hound, Watcher, Drifters rebuilt from shaped parts (see ART_DIRECTION). Drifters move in beats, not glides. Watcher has a cliff-top spot above the cutting and stands on real terrain height. Behaviour logic unchanged except the pass-4 `search` state. | Implemented (visual) |
| Wind | The vortex now bends grass locally (shader term around its centre, falls off with distance), lifts swirling mist (ParticleSystem with tangential start directions) and thins scene fog where it is felt. | Implemented |
| Tests | +4 cutting (connectivity with heights, smooth height, trunk-only crossing, edge safety), +6 creature state tests on NullEngine (Hound wake/sneak/search/repel, Watcher retreat/vanish). **50 passing.** | Implemented |

### Still not done (honest)
- Industrial region, stronger vertical/fractured sequence, ceiling traversal (no authored ceiling; not claimed).
- Skinned/rigged protagonist or creatures; IK; production textures.
- Creature navigation is still the walk grid around the line (no general pathfinding).
- Audio has not been evaluated by ear; real-time frame rate and physical phones untested (hidden browser pane).
- Duration: autopilot over every detour **186 s simulated**. First-play duration not measured; far below 15–20 min.

---

## Pass 4 (2026-10-30): protagonist, gravity surfaces, the village, the vortex

### Baseline before this pass (measured)
- `npx tsc --noEmit`: clean. `npm test`: 29 passing. `npm run build`: succeeds.
- Dev harness autopilot: full route start → end card completes (≈ 130 s simulated).
- Unused code found: `src/sectors/*` (Contradictory/Forge/Void sectors), `graphics/VoxelRenderer.ts`,
  `entities/Creature.ts` form a chain no game module imports. `@babylonjs/gui` and
  `@babylonjs/loaders` are dependencies but nothing imports them. Left in place (removal not needed for
  this work); listed here so they are not mistaken for live systems.
- No 3D model, texture or audio generation tool was available in this environment, so every
  new asset is procedural geometry built in code.

### Prioritised remediation checklist (status after this pass)
| # | Gap (from the brief and the source) | Status |
| --- | --- | --- |
| 1 | Protagonist is a box figure | **Implemented (procedural).** Shaped limbs (tapered cylinders with joint caps), lathed torso, belt, satchel and strap (asymmetry), hood shell with a dark opening (face never shown), rolled hood edge, long coat in three open panels. Not a rigged/skinned model: no IK. |
| 2 | Animation: one gait for all speeds, no secondary motion | **Implemented.** Run differs from walk (knee lift, elbow bend, lean, bob); acceleration lean for starts/stops; ankles keep soles level; coat panels and hood are damped springs driven by stride, acceleration, jumps/falls, wind (incl. the vortex) and phasing. |
| 3 | Gravity is one authored wall | **Implemented for upright faces; ceilings partial.** `GravitySurface` data (layout `GRAVITY_SURFACES`), one face grid per surface, controller/camera/flame/animation all read the active surface. Two surfaces in play: the white wall and the new facade. Face input mapping supports ceilings/floors (unit tested) but no ceiling surface is authored in the level. |
| 4 | World is one corridor | **Partially implemented.** New connected region: the displaced village loop (z 126–147) and a Void-only path over a ravine that is a second way past the fallen tree. New facade route over the Hound's den. The forest/cliff, industrial and vertical regions of the brief are **not built**. |
| 5 | Realities change little physically | **Partially implemented.** In the village: one house is absent in Void (no collision; its shadow stays), a path exists only in Void (outline visible in Normal, real drop beneath), the inverted house shifts in Deranged, facade footprints appear only in Deranged. Phase staging (resistance → overlap → commit) is unchanged from before. |
| 6 | Wind not coherent | **Implemented (one event type).** Travelling vortices on authored routes bend the shared wind field: grass gust (global, not local), coat, flame embers/ash/fragments, debris spiral, wind audio. Fog does not respond. |
| 7 | Creatures limited | **Partially.** Hound has a new `search` state: it loses a protagonist who is out of reach on a face and paces beneath. Creature models unchanged (still primitive). Navigation still grid-constrained. |
| 8 | Duration | Autopilot (shortest scripted route incl. both detours): **179 s simulated**. First-play duration not measured. Still well below 15–20 min. |
| 9 | Water, post-processing, audio by ear, physical phones | **Not addressed** in this pass. |

### Bugs found and fixed in this pass
- Village house placed on its own path (loop unreachable) → moved; covered by a connectivity test.
- Low railway camera looked through village houses (foreground ghosts); then the iso camera sat over a roof → the square has its own vantage from the side with no house.
- Facade window band left too little room to pass → band raised; covered by a face-grid test.
- The vortex's village route ran through a house → rerouted.

---

## Earlier passes

Audit of the repository at the start of the redesign pass (previous state: Chapter One
"The Crossing"), what was kept, and what that pass changed. Earlier history (inline game
in `index.html`, the TS build that never ran, its gap/teleport/leak bugs) is summarised
at the end.

## Stack and entry point
- Babylon.js 7.54 (`@babylonjs/core`), TypeScript 5 strict, Vite 6, WebGL2. No physics
  engine. Kept: the directive allows migration only with cause, and none was found.
- Entry: `index.html` → `src/main.ts` → `Game`. Dev-only harness `src/dev/harness.ts`.
- Not a git repository. A baseline snapshot was written to the session scratchpad
  (`baseline-20261029-2152.tar.gz`, excludes `node_modules`/`dist`) before changes.

## Baseline (before this pass)
| Area | State |
| --- | --- |
| Build | `tsc` clean, `vite build` 9 s, 5.1 MB bundle (barrel imports) |
| Runtime | Loads to title ~2.5 s in dev, no console errors |
| Realities | Two (Normal / "Contradictory"), one boolean phase state |
| Movement | Ground only; walk / slow walk; no jump, vault, climb or gravity |
| Camera | Fixed iso follow; no scripted shots; no occlusion handling |
| Flame | Summon, gather/release pulse, ember; no resource |
| Creatures | None in the chapter (figure across the gap only) |
| World | Single railway route, gap crossing, alternate railway, lamp ending |
| Tests | None automated; dev-harness autopilot only |
| Composition gap | The iso camera (pitch ≈ 41°) cannot see past ~20 m, so nothing distant or high could ever be framed |

## What this pass changed
| Kept | Refactored | Added |
| --- | --- | --- |
| Stack, layout data file, walk grid concept, procedural materials, terrain, railway, props, palm fire, particle framework, anomalies, phase geometry shader, HUD, settings, audio graph, dev harness | `PhaseSystem` (target reality, commit safety, hold, lock), `WalkGrid` (reality bitmasks, wall face grid, low obstacles, vault targets), `Player` (surface frames, air/landing/vault poses), `CameraController` (shots, vantages, occlusion, camera-relative axes), `Atmosphere` (per-reality response), `PostFX` (custom pass removed), `Game` (fixed 60 Hz step), `ChapterOne` (new beats), `AudioSystem` (light voice, new cues) | `Reality` masks; `PlayerController` (ground/air/vault/wall); `RealityPlugin` (Void dissolve, Deranged disagreement, shared wind sway on all world materials); `Wind`; `Structures` (white wall, vaults, settlement); `Vista` (floating landmass); `MovingLight`; `Creatures` (Watcher, Drifters, Hound); Vitest suite |

## Risks found and handled during this pass
- **Custom post-process in the HDR chain intermittently produced flat frames** (input
  binding as the pipeline rebuilt; also undefined GLSL earlier). Removed; the phase ring
  now uses the pipeline's radial chromatic aberration (enabled once at 0 → no recompiles).
- **Wall entry missed** because diagonal input slid the player out of the entry window → entry along the whole foot, clamped onto the face.
- **Void fuel oscillation** at the threshold → hysteresis (enter ≥ 0.15, stay until 0).
- **Reveal shot lost the protagonist** (orbit centre moved to the focus) → shots move the camera and its look target, never the orbit centre.
- **Long-range light invisible** in normal framing → authored vantages lower and turn the camera down the line.

## Earlier history (before this pass)
The original `index.html` ran an inline game; the TS tree was dead code. It was wired up,
then the gap crossing (reality flip-flop), side-edge teleport, per-frame material/mesh
leaks and shared particle-texture disposal were fixed; then Chapter One was built.

## Skills actually used
Inspected (README / SKILL.md via web fetch; nothing installed, no scripts run):
| Source | Used how |
| --- | --- |
| awesome-gamedev-agent-skills — `game-ai` | FSM per being with states that return their next state; stuck check; arrive steering; no per-frame pathfinding (`entities/Creatures.ts`) |
| awesome-gamedev-agent-skills — `camera-systems` | exponential damping; follow after movement; hard reset on teleport; occlusion handled separately from look; additive shake only for events (`core/CameraController.ts`) |
| awesome-gamedev-agent-skills — `physics-tuning` | fixed 60 Hz step with clamped catch-up (`core/Game.ts`) |
| claude-code-game-studios, gstack-game, story-skills, taste-skill | inspected earlier; not installed (Godot/Unity/Unreal workflows with shell hooks; design-review scoring; fiction tooling applied manually as the continuity ledger; web-UI art direction) |
| game-asset-mcp | not used: requires a Hugging Face token; all assets are procedural |
| img2threejs, hairline | not inspected: three.js / decorative tooling, not applicable to Babylon |
No subagents were used.

## Known limitations
- **Length:** 130 s straight-line; estimated 8–12 min first play (unmeasured) vs the 15–20 min target.
- **Character:** box figure with procedural animation; no rig, no IK, no ladders, ledges or climbing beyond the wall walk; no cloth beyond spring-driven coat and hood.
- **Gravity:** one authored anomaly (the wall); no general surface-aligned controller.
- **Physics:** grid collision, no physics engine; grass and debris do not react to the protagonist.
- **Camera:** occlusion fading covers houses and huts only (not trees or poles).
- **Rendering:** no SSAO/DoF/reflections; shadow resolution changes need reload; the custom distortion pass was removed (instability), heat shimmer dropped.
- **Creatures:** one of each class; no navigation mesh (Hound is grid-constrained on the track).
- **Water:** only the distant sideways river (particles); no near water.
- **Audio:** stereo panning only; synthesised; not listened to in testing.
- **Out of scope (by directive):** priest arc, pond, full Void mythology, death-reconstruction, endings, manifestation stages, inventory, quests, HUD.
- **Unused deps:** `@babylonjs/gui`, `@babylonjs/loaders`.
