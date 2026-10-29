# Project Audit

Audit of the repository at the start of this redesign pass (previous state: Chapter One
"The Crossing"), what was kept, and what this pass changed. Earlier history (inline game
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
