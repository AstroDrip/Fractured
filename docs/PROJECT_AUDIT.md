# Project Audit

## Pass 13 (2026-10-30): art direction redesign — first pass (foundation)

The brief asks for a redesign of every visible category. This pass did the visual audit, wrote the visual bible ([VISUAL_BIBLE.md](VISUAL_BIBLE.md)) and rebuilt the foundation that everything else sits on. **Most asset categories are not yet redesigned**; they are listed below with what remains. The fence wall at the opening is untouched (awaiting a decision).

### Found during the audit (and fixed)
- **The ground of every older region was not being drawn.** The block terrain's faces were wound back-facing, so they were culled; what the player saw was the abyss fog plane 5.5 m below, lit by nothing. That is why the world read flat, dark and blue, and why the flame never lit the ground. The rift's continuous terrain had the same winding (it was only ever lit from behind by the sky's ground colour — the "rift is too dark" note from pass 11). Both now wound front-facing, normals up; a test guards it.
- **The flame's fragments and embers were invisible in Normal.** Unlit particle materials had a black emissive term, so their per-instance colour never showed (in additive blending, black adds nothing). Fixed in `ParticleField.makeMaterial` for every particle family.
- **A checkerboard in the flame's fog-thinning edge** (a per-1.1 m hash in `RealityPlugin`), hidden until the ground was visible. Now smooth.

### Category status

| Category | Source | Status this pass | Remaining |
| --- | --- | --- | --- |
| Terrain (railway, cutting, yard, forest, cliff) | `Terrain.ts` | **Redesigned**: one continuous sculpted surface on a 0.5 m lattice from the authored cells; paths held flat to their edge, slopes beside them; broad irregularity away from paths; steep faces take pale strata; colour continuous; hole walls to the abyss. `heightAt` returns the drawn surface (flame contact, props). | Two spots sit ~1 m below walk height at structure edges (cutting cleft lip, yard ramp); terrain material/texture itself not redone |
| Rift terrain | `Rift.ts` | Winding fixed (now lit) | Darkness tuning re-check |
| Grass | `Grass.ts`, `Props.ts` | **Redesigned**: four-kind family (tuft, tall, dead, sedge) × 2 variants, tapered bent blades, patch placement, restrained colours, sedge in wet ground, straw near the line; 3.7k clumps, cheaper per clump than before | Flame-proximity response unchanged; no fallen leaves or weeds family |
| Lighting | `Atmosphere.ts`, `PalmFire.ts` | **Rebalanced**: cold fill and moon lowered (`LIGHT`), flame key raised with the same short range; warm pool now visible on the ground | Shadow strategy unchanged; per-region review incomplete |
| Fog | `Atmosphere.ts`, `RealityPlugin.ts` | Flame fog-thinning smoothed and eased | No height fog, no new layering |
| Flame | `PalmFire.ts` | Fragments now visible as `shard`s, embers as `chip`s, ash as `flake`s; amber restrained | Core silhouette, filaments, tier-specific projectile looks, trails, impact rings not redesigned |
| Other particles | `ParticleField.ts` users | Colour fix applies to all; impact ash, vortex leaves, motes → `flake`, suspended matter → `chip` | Mist, waterfall mist, steam, dust not redesigned |
| Debris | `Debris.ts` | Ash flakes | Stones / splinters / leaves meshes unchanged |
| Void | `RealityPlugin.ts` | Re-checked after the terrain fix (forest lattice: white ground, dark trunks, new grass reads) | — |
| Deranged | `Anchor.ts`, `Displaced.ts` | Unchanged | No new authored contradictions |
| Protagonist + rig | `protagonist.glb`, `Player.ts`, `SkinnedBody.ts` | **Not redesigned** | Whole remodel (hood, coat folds, hands, boots), deformation review |
| Creatures (Hound, Drifters, Watcher) | `Creatures.ts` | **Not redesigned** | All |
| Railway (rails, sleepers, ballast, cables, poles) | `Railway.ts`, `Props.ts`, `fallen_pole.glb` | Ballast colour blended | Rail/sleeper massing, carriage (none exists yet), cables |
| Industrial (signal box, platform, gantry, wall) | `Yard.ts`, `Structures.ts` | **Not redesigned** | Massing, bevels, materials |
| Trees, roots, fallen trunks, stumps | `forest.glb`, `build_forest.py` | **Not redesigned** | Per-family review in Blender |
| Rocks, cliffs, suspended land | `rocks.glb`, `rift.glb`, `Cutting.ts` | **Not redesigned** | Rock family, cliff walls |
| Water, waterfall | `Cutting.ts` | **Not redesigned** | Surface, sheet, mist, contact |
| Props | `Props.ts`, `Displaced.ts` | **Not redesigned** | — |
| Post-processing | `PostFX.ts` | Unchanged (Void handling from pass 12) | Grade per region, vignette review |
| Camera / composition / aspect ratios | `CameraController.ts` | **Not reviewed** | 16:9, 4:3, phone landscape checks |
| UI | `index.html`, `InteractionHUD.ts` | **Not redesigned** | — |
| Asset pipeline | `tools/asset_pipeline` | Unchanged | — |

**Checks:** 109 tests (3 new: terrain faces up, walkable soil/gravel within 0.15 m of the walk grid for > 98 % of cells, no 0.25 m terraces); build passes; full real-movement route reaches the end card (one resume after the hidden pane auto-paused the game). Screenshots reviewed: opening railway/hollow, forest lattice (Normal and Void), rift upper shelf, flame close-up while gathering.

**Measured (hidden pane, not a performance figure):** 327 meshes, 295 draw calls, 64 active meshes at the forest lattice; terrain 188k triangles across 9 chunks (the old block terrain's count was not recorded). No frame-time measurement.

## Pass 12, acceptance check against the reality spec (2026-10-30)

Fixed in this check: **no unlock without an anchor** (the automatic unlock past the gap is gone; the wall's footprints are a second anchor for anyone who passed the post: "Footprints. They go up the wall, and keep going." `[E]` hold); **timings** per reality (Void ≈ 0.63 s in / 0.53 s out, Deranged ≈ 0.45 s / 0.38 s); **a shift mid-transition is rejected** ('busy': refusal sound), not reversed; **Deranged sound**: each footstep is answered a beat later from the other side, and the stream is heard from the side it is not on; **gamepad**: standard-mapping buttons → the same actions (`PAD_BUTTONS`, remappable), stick walking with a light-push slow tier.

| Spec acceptance item | Status |
| --- | --- |
| Normal always reachable; returns from both | Yes (route, tests) |
| Void on the existing hold; release returns under the existing safety rules | Yes |
| Void outside absolute black; white region follows the flame; shrinks with fuel; existing drain | Yes (screenshots, test) |
| Existing Void bridges and obstacles | Yes (fence, lattice, rift bridge, village path, gap in the route) |
| Deranged not before discovery; needs an authored anchor | Yes (post or wall footprints) |
| First encounter: one contradiction | Yes (the fallen post and its standing shadow) |
| Early access restricted by geography | Yes (the post's shelf; walking out ends it) |
| Expanded access only where regions allow | Yes (village from stage 1; yard / line after the lever; never forest / rift) |
| Toggle Normal ↔ Deranged; not from Void; refused where unsupported | Yes (tests, route) |
| Collision reliable; always a way back to Normal | Yes (ledge and faces hold until safe; no teleport) |
| No overlapping transitions / conflicting inputs | Yes (one phase machine; mid-transition shift rejected) |
| No permanent HUD clutter | Yes (shift button only when usable) |
| Controller support | Added; **checked only with a stubbed gamepad in the browser**, not a real pad. Hints still show keyboard keys for a pad |
| Mobile shift control | Emulation only, no real phone |
| Transition visuals (Void black / white; Deranged's existing band offsets) | Void reviewed by screenshot; transitions not reviewed frame by frame |
| 15–20 min first play | **Not met**: route ≈ 5 min simulated straight through; no human playtest |

Route after these changes: full real-movement route (post, ledge, village shift, Void path, lever, gap, wall, facade, Hound) → end card, **311 s simulated**, no console errors. 106 tests; build passes.

## Pass 12, stage D (2026-10-30): wider access

| Area | Change | Status |
| --- | --- | --- |
| Regions | `village` (Normal / Void / Deranged, from stage 1): the first place where all three meet, so Deranged → Void through Normal happens in play. `yardLine` (all three, from stage 3): the yard and the line to the gap's edge. The gap stays Void only; the forest, the rift and the line between them stay Normal / Void at every stage. | Implemented; 4 tests |
| Controlled access (design stage 2) | In the village, Deranged shows **notches on every door** (Deranged-only decals, one more on each door: 7, 8, 9), echoing the post's notches; the thought differs depending on whether those were examined. Optional. | Implemented; screenshot |
| Attunement (design stage 3) | The lever frame's one forward lever is now its own mesh. Once the ash is cleared and the levers examined: `[E]` hold 0.6 s pulls it back (animated), with a shake and the phase sound; stage 3; Deranged once; "Back, like the others. Down the whole line, something answered." / "It does not need something wrong to stand on, now. Only somewhere that allows it." Held touches (post, lever) share one code path; the touch look button appears at both. | Implemented; verified |
| Progression | Stages used: 0 none, 1 found (post, or past the gap as before), 3 attuned (lever). Stage 2 is the set of further stage-1 places (village), not a separate unlock. | By design |

**Route:** full real-movement route with the post, the village shift, the lever and every earlier step → end card: **310 s simulated**, no console errors. 103 tests; build passes.

**Known / not done:** the lever's pull is checked by state, not by screenshot (the box interior is dark). The yard is optional (the ash puzzle), so attunement can be missed, leaving Deranged at the post, the village and past the gap. Few places use stage 3 because little of the chapter lies after the yard. Thought text runs on real-time timers and was checked through the said/hinted record, not on screen, in fixed-step runs. No real phone, no frame time, no human playtest; the 15–20 min target is not met (route ≈ 5 min simulated, straight through).

## Pass 12, stage C (2026-10-30): the first contradiction

| Area | Change | Status |
| --- | --- | --- |
| Anchor | `ANCHOR` (layout.ts), `Anchor.ts`: at the cutting's end shelf a pale signal post lies across the mouth of a short ledge. Neither position casts a real shadow; a false one does. Normal: the long shadow of a post standing at the ledge's far end, laid in pieces over the ground, across the path. Deranged: the post stands there, the lying one is gone, and the shadow is of a post lying across the mouth. The two cross-fade with Deranged. One contradiction only. | Implemented; screenshots |
| Encounter | Thought on approach; `[E]` **hold 0.5 s** at the post (a tap does nothing) finds Deranged (stage 1) and enters it once; thoughts, then `[T] shift back`. The camera is drawn gently toward the post until it is understood. Needs the flame, like every shift (else the cold-hand line). | Implemented; verified |
| Why it matters | The ledge exists **only in Deranged** (its walk cells). On it: notches to examine ("…at the height of my hand." / "I know how many there are before I count them."). Shifting back on the ledge is held (strain) until the feet are off it; never a teleport. | Implemented; 4 tests |
| Restriction | Region `anchor1` (Normal / Deranged, no Void) covers only the post and the shelf around it; walking out ends Deranged ("It will not hold, out here."). The trunk bridge and the forest are outside it. | Implemented; tested |
| Fallback | The post is off the main line (the cutting is optional). Someone who never touches it finds Deranged past the gap as before. The old Deranged first thought ("Down is not where it was.") now plays only past the gap. | By design |
| Touch | Look is a hold; shown at the post before discovery; shift shown only in allowed areas once found. | Emulation only |

**Route:** full real-movement route including the post, ledge, notches and shift back → end card: **302 s simulated**, no console errors. 99 tests; build passes.

**Known / not done:** the lying post's north tip overlaps the edge of the forest path (walkable there in Normal; the tip is visual only). The scene is dark; the false shadow reads at the gameplay camera but is not strong. Shift touch target ≈ 37 px. No real phone, no frame time, no human playtest. Stage D (expanded access) not started.

## Pass 12, stage B (2026-10-30): the black and white Void

| Area | Change | Status |
| --- | --- | --- |
| Shader | `VOID_TONE_GLSL` (RealityPlugin.ts), one function shared by the world material plugin and the phase-geometry shader, applied after fog: absolute black beyond the flame's white fragment; inside it ground (tone 1) is white and objects (tone 0) are dark silhouettes keeping a little of their own surface detail; ragged, crawling edge. Every other Standard/PBR material in the scene (the figure, creatures, water, lamps, vista) gets the same plugin without dissolution, including materials added later. No new post-process (the HDR-chain pitfall is avoided); no per-frame allocation. | Implemented; screenshots |
| Fuel | `voidWhite(fuel, strength)`: radius 6.4 m full → 1.8 m empty, edge instability rises below 45 % fuel, detail thins below 50 %. Uses the existing fuel and drain only. | Implemented; 1 test |
| Matter | Ground and grass stay whole in Void (dissolving them read as noise on the white); objects still dissolve. Solid Void footing (phase geometry, the rift's Void deck) is white over the black; faint traces of absent matter are dark. | Implemented |
| Non-shader parts | Clear colour and fog → black; mist/fog particle systems not drawn in Void (layerMask); the abyss fog plane hidden; wires, ropes, drifter threads hidden; fracture / edge / lattice traces turn dark residue; bloom −90 %, grading and saturation off. | Implemented |
| Flame | Stays amber: no chalk-white phase tint in Void; core and glow deep amber; glow and fragments blended (not added) over the white; fragments carry amber emissive in Void because their per-instance colours never reached the shader (they drew black on white — an existing quirk, invisible on the old dark Void). | Implemented; screenshots |
| HUD | Thoughts and hints gain a soft dark ground in Void so they read over the white. | Implemented |

**Checked by screenshot (hidden pane, fixed fuel, `H.live()` then capture):** fallen tree at the fence (full fuel), forest root lattice (full fuel and 12 % fuel), rift footbridge Void deck, village Void path, gap crossing. **Route:** full real-movement route to the end card, 290 s simulated, no console errors. 95 tests, build passes.

**Known / not done:** the fence's authored camera focus puts the flame low-right, so most of that frame is black. Drifters show as small pale points in the black (kept: they are creatures, not scenery). Trace lines stay faintly visible beyond the white. The white fragment's edge follows voxel ground and can look stepped. Transitions mid-way (Normal ↔ Void) are not reviewed frame by frame. Not checked on a phone, nor measured for frame time. Void audio unchanged.

## Pass 12, stage A (2026-10-30): reality controls and state

Design: the reality-switching spec (Normal / Void / Deranged), stage A only — controls and state, no new content.

| Area | Change | Status |
| --- | --- | --- |
| Controls | **Q** (hold) is Phase → Void only. **T** (tap) is the new Deranged shift (Q, E, R, F were taken), remappable in `BINDINGS.shift`. Listed in the controls list as "shift, once you have found how". | Implemented |
| State | `RealityController` (src/core/RealityController.ts) is the one place both inputs become the phase target and held state. `PhaseSystem` still owns the single transition (progress, commit safety, holding), so transitions cannot overlap. Shift refused while Void is active/forming; Phase from Deranged leaves through Normal first; Deranged ends if the flame fails or the region forbids it; a face still holds the phase. | Implemented; 11 tests |
| Regions | `REALITY_REGIONS` + `realityRegionAt()` in layout.ts: rift, forest, near side → Normal / Void; past the gap → Normal / Deranged from stage 1, no Void. First match wins, so later unlocks never reach the forest or rift. `phaseTargetAt` now derives from it. | Implemented |
| Progression | `DerangedStage` 0–3 on the controller (only rises; reset on restart). **Stand-in:** stage 1 unlocks on entering the region past the gap, until the authored first anchor (stage C) replaces it. | Stand-in, by design |
| Feedback | Refusals: refusal sound + a small strain, no message (except the existing cold-hand line when there is no flame). Wall hint now `[T] shift`. | Implemented |
| Touch | **shift** button, shown only when Deranged is found and allowed here; active state while shifted. | Implemented; **not checked on a phone or in emulation** |
| Route | Full real-movement route start → forest → rift → village → yard → gap (Void) → wall (T) → facade (T; toggling off on the face is held until the feet are down) → Hound → end card: **292 s simulated, end reached, no console errors.** T before discovery: refused, stays Normal. Q past the gap: refused, stays Normal. | Verified (fixed-step harness) |

Not in stage A: the black/white Void render (stage B), the first anchor in the cutting and its encounter (stage C), expanded attunement (stage D), controller (gamepad) bindings, transition audio identities. Normal → Void and Normal → Deranged use the existing rates (≈0.45 s in, ≈0.38 s out). No region yet allows both Void and Deranged, so "phase from Deranged passes through Normal" is covered by unit test only.

## Pass 11 (2026-10-30): the rift (vertical / fractured landscape)

Baseline: passes 9–10 uncommitted and intact, 78 tests, build OK. (The opening-path width change was rejected by the user and is **not** in this pass.)

**Plan and joins:** the overlook's footbridge (x -28.4 → -36, z 109.4, 4.6 m) now crosses the gap; its middle (x -33.4…-30.8) exists only in Void (recovery: the overlook). Upper shelf x -46…-36 (4.7 m) → a cut down the ravine's east wall → lower shelf x -54.6…-50 (-1.6 m) → fallen trunk across the chasm (x -60…-54.6, floor -16 m) → west shelf x -73…-60 (-0.6 m) → ridge out of the ravine's north end, east, joining the forest's exit path at (-18.5, 106.5) and so back to the line. Optional: a promontory north of the upper shelf with sleepers set upright in the rock (examine). Landmark: a slab of land hanging almost upright over the chasm, roots off its edge, with two held masses. Walk grid widened to x -80.

| Area | Change | Status |
| --- | --- | --- |
| Terrain pipeline | The rift is **one continuous mesh** (0.75 m grid, 4,550 verts) sampled from `riftHeight()`; vertex colours lay pale strata in steep faces, earth on flats, darkness in the depths. The **same function** gives the walk grid's heights and the thrown flame's contact. The voxel terrain yields the rift's area. Existing regions keep the voxel heightfield (not retrofitted). | Implemented; tests: heights match, descent has no steps |
| Assets | `tools/asset_pipeline/build_rift.py` → `assets/game/environment/rift.glb` (source `assets/source/environment/rift.blend`): **riftSlab** (16 × 9 m slab, earth top, fractured underside, hanging roots; 848 tris, 2 materials), **riftMass** (held rock, flat fractured top, tapering underside; 314). Reuses forest roots/fallen trunk and rocks. | Implemented |
| Region | `world/Rift.ts`: terrain mesh, footbridge (planks, ropes, Void deck), trunk, landmark, hanging roots, rocks, promontory sleepers; `layout.ts` `RIFT`, `riftHeight`, `riftWalk`; `WalkGrid.paintRift`. | Implemented |
| Realities | Normal: the bridge stops at its missing middle (the long way round via the ridge still works). Void: the middle is a pale deck; Void drains the flame. Deranged is not reachable here (phase leads to Void before the gap), so none authored. | Tested |
| Flame | Thrown flame moves in substeps no longer than its radius (no tunnelling through thin rock); its ground contact in the rift uses `riftHeight`. | Implemented |
| Perf | `?perf` in the URL shows frame time, FPS, draw calls, active meshes, triangles, resolution, quality, twice a second, in any build. | Implemented, **no measurements taken** (hidden pane) |
| Tests | +5 (`world2.test.ts`): bridge middle Void-only with recovery to the overlook; Void crossing, descent, trunk, west shelf, ridge and promontory connected; chasm and gap never walkable; walkable heights equal terrain heights; continuous descent. **83 passing.** | |
| Route | Full real-movement autopilot: hollow → cutting → forest (clearing, lattice) → overlook → bridge (Void) → promontory → descent → trunk → west shelf → ridge → line → pile → village → Void path → yard → gap → wall → facade → Hound → end: **290 s simulated**, end screen reached. Rift alone ≈ 70 s straight through. | |

Bugs found in testing and fixed: slab and masses rendered near-white (terrain material without vertex colours) → own dark rock material; 1.1 m bridge was too tight for the body footprint (a step off the centre line blocked the Void span) → widened to 1.56 m.

Not done: the rift reads very dark from the gameplay camera (depth mostly fog; not yet tuned); no screenshots of the bridge entrance, trunk, west shelf or exit; no phone-ratio views; no frame-time measurement; human playtime not measured; voxel terrain elsewhere not retrofitted; the opening-path invisible wall (awaiting the user's choice).

---

## Pass 10 (2026-10-30): the forest and the cliff

Baseline: pass 9 uncommitted and intact (19 files), 73 tests, build OK.

**Where it joins:** it leaves the north end of the cutting's shelf (x -12.8, z 61, 1.85 m up) and runs north-west under the trees (x -15…-19, z 66–92), is barred by a root lattice at z 86.6–89, climbs to an overlook on the cliff edge (x -26.4, z 109, 4.7 m), and comes down east to the line at z 114.6, before the sleeper pile. West of x -28.4 (z > 96) the land ends. A side path leads to a clearing (x -25.2, z 83.2).

| Area | Change | Status |
| --- | --- | --- |
| Assets | `tools/asset_pipeline/build_forest.py` (Blender 5.2 headless, seeded) → `assets/game/environment/forest.glb`, source `assets/source/environment/forest.blend`: **treeTall0/1** (tall, narrow, curved, sparse high limbs; 645 / 456 tris), **treeTwisted0/1** (uneven, leaning, heavy asymmetric limbs, root flare; 1,368 / 2,133), **treeDead0/1** (broken, splintered, pale; 155 / 180), **roots0** (lattice of arching roots; 1,122), **fallen0/1** (torn root plate / snapped in two; 451 / 224), **stump0** (45). Tubes along bent paths with tapering, irregular 5–9-sided rings; breaks hard-edged. GLB validates. | Implemented |
| Layout | `FOREST` + `forestAt()` (layout): route, exit, spur, clearing, overlook with authored heights; walk grid paints them (`paintForest`), never closer than 0.4 m to the edge; terrain follows walkways and rolls and rises between them, stays below the overlook within 9 m of it, and ends west of the edge. | Implemented, tested |
| Composition | `world/Forest.ts`: trees placed along the walkways by section (transition: old twisted + tall; corridor: tall and close; cliff: dead + twisted), only stumps/roots on the camera's side of the path, twisted trees ≥ 4 m back, nothing within 8 m of the overlook; a stand of tall trunks behind the corridor for depth; rocks and fallen trunks off the path. One thin-instance batch per mesh (10 draws for the trees). Trunk circle colliders within 3 m of walkways. Generic tree scatter is kept out of the region. | Implemented; screenshots of corridor and overlook reviewed |
| Obstruction | Root lattice + fallen trunk across the path: matter (Normal/Deranged obstacle), fades in Void (collision gone, a pale trace stays). Phase holds inside it (existing safety). | Implemented, tested in game (blocked → Void crossing → release held inside → released outside) |
| Optional | The clearing: a ring of stones round a stump, a coat buttoned on a branch (examine). | Implemented |
| Overlook | Broken railing, a footbridge whose planks thin out over the drop and ropes sagging into the fog; its own camera (low, turned west over the edge). The island reveal now fires only on the line, and its hand-back point moves with it when it starts late (back from the forest). | Implemented, screenshot reviewed |
| Reality | Normal: lattice solid. Void: lattice gone, trace stays, flame needed (Void drains it). **Deranged is not reachable here** (phase leads to Void before the gap, by design), so no Deranged behaviour was authored for this region. | |
| Fire | Existing thrown flame works here: debris off the walkways now spills leaves/soil (forest floor). | |
| Tests | +5 (`world2.test.ts`): lattice bars the overlook in Normal; Void opens overlook and exit; clearing reachable; nothing past the edge is walkable and the overlook is raised; lattice solid in Normal, absent in Void. **78 passing.** | |
| Route | Full autopilot taking the forest (hollow → cutting → forest → clearing → lattice (Void) → overlook → exit → pile → village → Void path → yard → gap → wall → facade → Hound → end): **222 s simulated**, real movement only, end screen reached. This route skips the fallen pole (the forest rejoins after it); the previous route still covers it. Forest stretch alone ≈ 43 s straight through. | |

Not done: mobile-ratio captures of the forest and overlook; frame-time measurement (hidden pane); human first-play time (estimated for the forest, not measured: 3–5 min with the clearing, lattice and overlook); the terrain is still a voxel heightfield, so slopes show steps; Deranged forest behaviour.

---

## Pass 9 (2026-10-30): environment assets, water, debris, the signal yard

Baseline: clean tree at `6c44baf`, 66 tests, build OK.

| Area | Change | Status |
| --- | --- | --- |
| Asset pipeline | `tools/asset_pipeline/build_environment.py` (Blender 5.2 headless, seeded): **fallen telegraph pole** (tapered, bowed, faceted 9.6 m shaft with a splintered snapped base, bevelled crossarm, two lathed insulators; 672 tris) and **three rocks** (noise-displaced masses cut by fracture planes, hard edges split; 100–116 tris each). Source `assets/source/environment/environment.blend`; runtime `assets/game/environment/*.glb`; both pass `validate_glb.py`. | Implemented |
| Loading | `world/EnvAssets.ts` loads them as a build step, bakes the glTF reflection into vertices, swaps in the game's materials; every builder keeps its procedural fallback. The pole replaces the old cylinder (now lying on the ballast instead of floating 0.36 m above it); the cutting's 73 rocks are thin instances of the authored rocks. | Implemented, in game |
| Water | The stream is a subdivided surface (378 verts) displaced each frame by three wave trains with the flow plus rings where a flame lands; normals recomputed so the highlight rolls; waves calm toward the banks; nearly still in Void. The fall is three curved sheets (parabolic) with mist at its foot. | Implemented; motion verified numerically, **appearance not reviewed** (cleft is dark from the gameplay camera) |
| Debris | `world/Debris.ts`: pooled loose bodies (stones, leaves, splinters; ≤ 72, thin instances, one draw per kind) with gravity, drag, bounce, friction, sleep and a life; an ash/dust plume. What spills comes from the ground at the impact (`DEBRIS_BY_SURFACE`), how hard from the throw tier and distance, divided by mass. Void spills little; in Deranged leaves fall upward briefly. Water still only hisses. | Implemented; in game: a fireball on gravel scattered 10 stones that settled above ground and expired |
| Industrial | **Signal yard** (`world/Yard.ts`, layout `YARD`, z 157–177 east of the line): raised platform with ramps and lifted coping stones, a signal box with a broken corner, a lever frame inside (examinable: all pulled back but one), a steel gantry whose beam runs through the roof at a wrong angle, and an ash heap choking the doorway: a fireball or mass clears it (its obstacle leaves the walk grid), a flick does not. | Implemented; in game: blocked → flick fails → fireball clears → enter → examine |
| Tests | `tests/world2.test.ts` (+7): debris flight/landing/sleep, drag vs mass, surface table, stream smoothness and motion, yard platform ramps, ash blocks then frees the doorway. **73 passing.** | |
| Route | Full autopilot incl. hollow, cutting, village, Void path, **yard**, gap, wall, facade, Hound, ending: **200 s simulated**, end screen reached. | |

Not done: a new forest/cliff region beyond the existing cutting, the vertical/fractured region, tree families in Blender, LOD and profiling (hidden browser pane), mobile-ratio captures of the reveal, Deranged fire visual review, human first-play time; the chapter is still far below 15–20 minutes.

---

## Pass 8 (world/fire part; 2026-10-30): thrown flame, fire in the world, the fracture

Baseline: passes 6 and 7 uncommitted and intact; `tsc` clean, 61 tests, build OK.

| Area | Change | Status |
| --- | --- | --- |
| Thrown flame | Releasing the gathered flame (R / right mouse, touch long-press) now **throws** it along the facing direction instead of a radial pulse at the palm. One source of truth (`core/FlameTiers.ts`): flick (< 0.4), fireball (< 0.85), mass; radius = visual core, speed, arc, gravity, life, reach and cost all scale with charge. Lifecycle held → release → travel (trail sparks on the real path, its own light, wobble for a mass) → contact → impact → dissipation, one in the air at a time. Cost = 0.08 + 0.18 × charge (the established pulse rule). | Implemented and tested (unit + in game) |
| Contact | Visible terrain, the stream (water), solid obstacles in the current reality (houses, the fallen tree, fence posts; low ones below their top), both wall faces, the Hound, Drifters. Water: hiss and vapour, reduced reach, no burst. | Implemented, in-game checked (contacts, Hound repelled by a fireball hit) |
| Reality response | Void: core and reach × 0.7 (drained). Deranged: the path bends sideways and trail sparks sink instead of rise. | Implemented, not visually reviewed in Deranged |
| Fire in the world | Shared reality shader (`RealityPlugin`): fog thins (never vanishes) around the held flame and around the thrown flame and its impact, with a ragged edge and a 2.6 s recovery; grass is pushed away from both. One shared field (`RealityFX.hold/infl`), no per-object scripts. | Implemented (visual effect subtle; not tuned frame by frame) |
| Fallen tree | Rebuilt as a fracture: rails lift out of the ballast, run into the trunk and leave it at another angle; sleepers on end; roots growing out of the track bed into the fallen trunk. Fades in Void with the rest of the matter (shadow stays); a pale trace of rails and trunk remains, strongest in Void. Collision and phase safety unchanged. | Implemented, screenshots Normal + Void |
| Tests | `tests/flame.test.ts` (+5): thresholds, tier order, size/reach/cost monotonic, visual = collision radius, mass vs flick physics, cost rule. **66 passing.** | |

Not done in this part: new forest/industrial/vertical regions, sculpted rebuild of the weakest props (fallen pole, cliffs), displaced water surface, debris reacting to impacts, LOD/profiling, 15–20 min chapter (autopilot over every route: **186 s simulated**).

## Pass 7 (2026-10-30): asset pipeline, skinned protagonist, reveal framing

- Preflight: Windows 11, Intel Iris Xe, 7.7 GB RAM, no CUDA, **Blender 5.2 LTS installed** (not on PATH). TRELLIS.2 / TripoSR need NVIDIA; Hunyuan3D-2 and MeshAnything V2 have licence restrictions; Mixamo needs an Adobe sign-in. Chosen: headless Blender scripting (original work).
- `tools/asset_pipeline/build_protagonist.py` builds the hero (skin-modifier body + subdivision, thick hood with a dark face disc, open coat, belt/strap/satchel), a 19-bone armature with joints at the pose rig's pivots, automatic body weights + explicit hood/coat weights, GLB export. `validate_glb.py` checks skin, weights, joints, triangle budget. `render_pose_check.py` renders stress poses.
- Asset: `assets/game/character/protagonist.glb` (8,026 triangles, 5 materials, 19 joints, 240 KB, no animation clips); source `assets/source/character/protagonist.blend`.
- Runtime: `entities/SkinnedBody.ts` loads it (`@babylonjs/loaders`) and retargets the procedural pose rig onto the skeleton every frame (frame-change matrix for the glTF reflection); the flame sits in the real `hand.R`. Falls back to the procedural figure if loading fails.
- Reveal: framing found by projecting the island's real silhouette and the protagonist; shot FOV 0.75 (vertical, so wider screens only gain margin); at 4:3 the island fits (top 0.11, left 0.05) except the thin tower tip; protagonist at (0.75, 0.73).
- Not done: authored animation clips, root motion, hand IK, climbing; foot-IK sole height not re-measured on the skinned mesh.

---

## Pass 6 (2026-10-30): opening defects, leg IK

### Baseline before this pass (measured)
`main` = `origin/main` (`f1cd7ed`), clean tree. `tsc` clean, 50 tests passing, build succeeds.
No Blender in this environment (`which blender` → none), so the Blender skill workflows
in the brief could not be run; no 3D or animation assets were generated.

### Defects found, cause, fix
| Defect | Verified cause | Fix | Evidence |
| --- | --- | --- | --- |
| Invisible wall at the broken fence (start) | Fences had **no collision**; the walk grid's path edge (radius 1.3) stopped ~0.16 m short of the fence line, so the broken bays met an invisible wall, while near the start the clearing extended *through* the fence | `WalkGrid.paintFences`: posts and intact rails are solid (circle colliders along the rail line); broken bays are carved open onto a real hollow behind (`FENCE_POCKET`) with something to examine (an open suitcase packed with earth) | `tests/defects.test.ts` (path walkable from start, gap reaches the hollow, intact bays block); in game: walked in, examined, walked out; walking at an intact bay stops at the rail |
| Forward teleport at the fallen tree | Releasing phase inside the tree let Normal commit; `updateRecovery` then `teleport`ed to the nearer side | Phase **holds** (refuses to leave, with strain + thought) while Normal matter would close around the protagonist, then releases on its own once clear. If the phase is forced to end there (flame out), a 0.4 s visible slide to the nearest free point (`nearestFree`), never a jump | tests: held inside / releases outside / rapid taps never commit inside / forced exit goes to the near side < 1.5 m. In game: release inside → `held`, 0.24 m drift (walking momentum only); forced exit → 0.75 m slide to the near side |
| Reveal shot cut by walking | `releaseOnMove` ended it after 2.5 m; also jumped the timeline to hold-end mid-blend (a framing snap) | `releaseBeyondZ` (authored boundary, z 117 before the sleeper pile); release from mid-blend continues at the same weight (no jump). Framing retuned so the protagonist stays in frame | tests: walking keeps the shot; crossing mid-blend changes weight < 0.03/frame; full timeline when still. In game: weight 1.0 at z 110 while walking, max change 0.01/frame |

Other teleport paths audited: fall recovery (fade → recovery point, unchanged, intended), Hound catch (fade → checkpoint, unchanged), chapter restart. No other silent repositioning found.

### Leg IK (implemented, analytic, on the existing hierarchy)
Per foot: ground probe at the animated foot position (walk-grid height), smoothed offset,
analytic two-bone solve (`solveLeg`, inverse of `legFK`) for hip and knee, pelvis drop for
the lower foot, sole pitched to the ground slope (toe/heel probes). Off in the air, while
vaulting and on faces. Measured: on the ballast edge (one foot 0.1 m higher) both soles sit
within 1 cm of their flat-ground height. Not a skinned rig: joints are still separate meshes.

### Requirements checklist (honest status)
| Requirement | Status |
| --- | --- |
| Fence invisible wall | Implemented and tested |
| Phase-obstacle teleport | Implemented and tested |
| Reveal camera hand-back and framing | Implemented and tested (desktop aspect only; mobile aspect not checked) |
| Ground-aware feet (IK, pelvis, slope) | Implemented and tested (walk-grid ground, not terrain mesh) |
| Skinned skeletal protagonist, animation clips, root motion | **Not implemented** (no authoring tool available; procedural hierarchy remains) |
| Hand IK on climbable faces, climbing/ledge system | Not implemented |
| Skinned creatures, creature navigation beyond the grid | Not implemented |
| Redesigned phase-blocking tree as a fracture | Not implemented (tree kept; now collision-safe) |
| Displaced water surface, flame fog parting, flame/grass push | Not implemented |
| LOD / animation LOD / relevance system | Not implemented (not profiled: hidden pane) |
| 15–20 min chapter | **Not met**: autopilot over every route 185 s simulated; first play not measured |
| Audio listened to / phones / real-time FPS | Not verified |

---

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
