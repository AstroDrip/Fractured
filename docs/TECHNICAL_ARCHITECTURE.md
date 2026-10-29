# Technical Architecture

## Systems and ownership
| System | Module | Owns |
| --- | --- | --- |
| Bootstrap, state machine, frame loop | `core/Game.ts` | `loading → title → playing ⇄ paused → ending → ended` (+ `error`); fixed 60 Hz simulation, ≤ 4 catch-up steps |
| Input | `core/InputManager.ts`, `core/controls.ts` | the single intent layer: bindings, edges, held state, move vector + magnitude, right-mouse gather, blur release, virtual (touch) API, active device |
| Touch | `ui/TouchControls.ts`, `core/FlameTapCharger.ts` | touch pointers only (ownership per pointer id): floating stick, hold-to-phase, flame tap/long-press, climb, look, world tap, pause; tap dedupe/fade — see [MOBILE_AND_DEPLOYMENT.md](MOBILE_AND_DEPLOYMENT.md) |
| Viewport | `core/Game.ts` (`setupViewport`, `applyResolution`) | coalesced resize, portrait pause, context loss, phone DPR caps |
| Realities | `core/Reality.ts`, `core/PhaseSystem.ts` | bitmasks (`R_NORMAL`, `R_VOID`, `R_DERANGED`); transition state machine |
| Movement + gravity | `entities/PlayerController.ts` | position, velocity, local up; modes `ground / air / vault / toWall / wall / fromWall`; the active `GravitySurface` frame; `faceInput` maps screen input onto any face orientation |
| Gravity surfaces | `world/layout.ts` (`GRAVITY_SURFACES`), `world/WalkGrid.ts` (one face grid each) | data per face: frame (origin, normal, u, v), walkable rect, holes, feet, entry region, realities |
| The cutting | `world/Cutting.ts`, layout `CUTTING` / `cuttingAt`, `WalkGrid.paintCutting`, `Terrain` | shelf, cliff, cleft, trunk bridge (Surface.WOOD → narrow footing in the controller), stream + waterfall, culvert, rails into rock; water voice position |
| Displaced architecture | `world/Displaced.ts` | house template (merged per house), village, inverted/far repetitions, Void deck + filament outline, ravine rocks, facade with cross-section and Deranged footprints |
| Wind vortex | `core/Wind.ts` (field), `graphics/VortexDebris.ts` (debris), layout `VORTEX_ROUTES` | travelling eddy on authored routes; bends the shared field; particles with `windResponse` drift with it |
| Collision data | `world/WalkGrid.ts` | 0.5 m ground grid (reality mask, surface, height, recovery segment), obstacles (circle/box, reality mask, `low` for vaults), wall face grid |
| Character | `entities/Player.ts` | articulated procedural model (shaped limbs, lathed torso, hood shell, coat panels), procedural animation in any surface frame, coat/hood springs |
| Camera | `core/CameraController.ts` | follow, vantages, scripted shots, occlusion fade, control axes |
| Flame | `graphics/PalmFire.ts` | presence, gather/release, ember, fuel, light, particles |
| Creatures | `entities/Creatures.ts` | Watcher (avoidant), Drifters (flame-sensitive), Hound (pursuer) |
| World build | `world/World.ts` and builders | terrain, railway, props, structures, vista, light, phase geometry, anomalies, creatures |
| Reality visuals + wind | `graphics/RealityPlugin.ts`, `core/Wind.ts` | one material plugin on every world material reading `RealityFX` |
| Atmosphere, post | `graphics/Atmosphere.ts`, `graphics/PostFX.ts` | fog/lights per zone and reality; tone mapping, grading, bloom, grain, vignette, radial split |
| Story | `world/ChapterOne.ts` | beats, hints, attention, examine, ending trigger |
| Audio | `core/AudioSystem.ts` | procedural WebAudio buses and cues |
| UI | `ui/InteractionHUD.ts`, `index.html` | loading, title, pause, thoughts, hints (touch wording in touch mode), fade, end, error, rotate prompt, notices |
| Data | `world/layout.ts` | every authored position, zone, vantage, segment, wall, vault, phase target |

## Fixed step (`Game.simulate`, 1/60 s)
1. Intent on the first step of a display frame (fire toggle, release, ember click, examine); gather while held.
2. `phase.setTarget(phaseTargetAt(z))` — Void before the far side of the gap, Deranged after.
3. Fuel: drains in Void (0.085/s), recovers elsewhere.
4. `PhaseSystem.update`: commit at progress 0.5 only if `canStandIn(target)`; leaving refused (`held`) when `mustHold()` (on the wall). Void without the flame locks.
5. `PlayerController.update` with the committed reality.
6. Recovery: ground lost in this reality → designed fall to the segment's recovery point (fade, stumble); inside the barrier as it returns → placed on the nearer side; Hound catch → checkpoint.
7. Story, animation, palm position, flame, anomalies, phase geometry, creatures, wall footprints.
8. Light, wind, wires/vista (half rate), lamp; ending timeline.
9. `RealityFX` shared state; camera (vantage blend, shots, occlusion); atmosphere; post; audio + light voice.
Render once per display frame.

## Reality transition state machine
| Stage (progress) | What happens |
| --- | --- |
| Resistance (0–0.2) | flame tint shifts; audio muffling begins; radial split starts from the flame |
| Disagreement (0.2–0.5) | phase geometry blocks shift; Deranged vertex bands slide; Void matter starts to leave |
| **Commit at 0.5** | collision switches to the target reality — only if the incoming reality can hold the protagonist; otherwise progress is held below 0.5 with a strain cue |
| Overlap (0.5–0.85) | both realities visibly coexist; residue particles mark changes |
| Resolution (0.85–1) | fog, light, wind, creature perception settle |
Leaving runs the same stages in reverse with the same commit check. On the wall, an
unsafe exit is refused (`held`). On Void bridges an exit or a guttered flame drops the
protagonist to the segment's recovery point, always with fade and stumble.

## Gravity
Only one anomaly zone: the white wall (`layout.WALL`). In Deranged, walking into its
foot starts a 0.45 s transition that interpolates position and local up (+Y → +X). On the
face, movement runs in face coordinates (u along Z, v up the face) against the wall
grid; collision, footsteps, animation (`Player.up`/`forward`), blob shadow and camera all
use the same frame. Stepping down at a foot with ground reverses the transition.

## Collision categories
Ground cells (per reality), obstacle circles (poles, signs, lamp), obstacle boxes with a
reality mask (barrier), low boxes (vaults; passable when airborne above `low`), wall face
cells, recovery points. No render mesh is used as collision.

## Debug tools (dev only)
`window.H` in `npm run dev`: `start`, `tp`, `step`/`stepNR` (fixed-step without render),
`walk` (WASD autopilot), `tap`, `P()` (state incl. reality, mode, fuel), `lum()` (frame
luminance), `counts()`. Not bundled in production (verified by searching `dist/`).

## Rendering
- **Lights (4, always enabled):** sky (hemi; direction flips under the ground in Deranged), moon (only shadow light; direction swings in Deranged), palm fire (`renderPriority` 10), lamp (intensity only). Toggling lights recompiles materials, so it is avoided.
- **Shadows:** one moon map (Medium 1024 / High 2048) following the protagonist, texel-snapped, precompiled at load; created once (recreating it at runtime crashed Babylon).
- **Fog:** EXP2, blended between eight zones; Void darkens and thins it; Deranged tints it.
- **Shaders:** `phaseSurface` (configuration-specific geometry; flame-reveal for Void spans; fallback material on error); `RealityPlugin` (Void discard with flame-kept radius and faint edge, Deranged vertex bands, wind sway).
- **Post:** standard tone mapping (ACES/Neutral measured too crushing), grading, vignette, FXAA; bloom + grain Medium/High; radial chromatic split from the flame on phase start/end only.
- **Distance:** the vista and far silhouettes use fog-free, unlit materials with tones just under the sky (their own aerial perspective).

## Commands
`npm run dev` · `npm run build` · `npm run preview` · `npm test`
