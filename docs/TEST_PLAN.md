# Test Plan and Results

## Automated (`npm test`, Vitest) — 40 tests, all passing
- `tests/regions.test.ts`: village loop connectivity in Normal; the Void path reaches past the fallen tree only in Void (Normal cannot); Void-span recovery points are solid; the ravine lies under the Void path and never under real ground; only the absent house gives way in Void; per-surface face grids (facade band blocked, passage beneath open, white wall unchanged); end-to-end facade traversal below the break; surface entry regions; screen-to-face input for walls and ceilings (direction and speed); the vortex starts near its route, circulates tangentially and is not felt far away.
- `tests/input.test.ts`: flame tap dedupe, configurable interval, fade timing; stick direction normalised with separate magnitude; touch hold-to-phase edges; keyboard + touch phase held together; one-shot presses; blur releases touch; releases never switch a keyboard player to touch; a key press returns to keyboard.
- `tests/phase.test.ts`: enter/leave; refused without flame; commit rejected when the incoming reality cannot hold the protagonist; held when leaving is unsafe and required; lock until key release; target fixed mid-transition.
- `tests/world.test.ts`: Void-only spans; fragment absent in Void; crossing overlaps solid either side; recovery points solid; barrier per reality; sinkhole empty in all realities; vault landings valid; phase targets by region; **route connectivity BFS start → wall foot → far foot → lamp across realities**; gap not crossable in Normal alone; wall face connects both feet around the broken section and blocks the low route.

## In-game (dev harness autopilot, real key events, fixed 1/60 s steps) — verified this pass
| # | Acceptance item | Result |
| --- | --- | --- |
| 1 | Move, turn, stop, run, hop, land | walk 2.8, run ≈ 4.3 m/s, hop apex 0.51 m, landing returns to ground |
| 2 | Vault intended geometry | both vaults: blocked at the face, land 0.5 m beyond |
| 3 | Camera around obstacles | houses/huts fade when between camera and protagonist (occlusion ray); not exhaustively tested |
| 5 | Gravity aligns player, camera, movement | on the wall: up = +X, movement in face coordinates, step-off restores up |
| 6–8 | Phase never traps; support not removed silently; collision consistent | commit refused when unsupported; wall exit held; Void falls recover visibly |
| 9 | Flame resource in/out of Void | drains 0.085/s in Void, recovers outside; gutters at 0 → recovery |
| 10–11 | Flame interactions; ember/pulse | reveal spans, scatter drifters, repel Hound |
| 12 | Creature classes | Watcher retreats/relocates; Drifters drawn/scattered; Hound rest → wake → catch, sneak passes, repel |
| 15 | Light visible at vantages | verified in screenshots at the railway vantage |
| 16, 18 | Route completable; finale reliable | clean run start → end card, 130 s, no errors |
| 17 | Cinematics blend, do not snap | reveal blends in/out and releases on movement; finale is scripted ~10 s |
| — | Production build | builds; harness absent from bundle |

## Mobile and desktop regression
See [MOBILE_AND_DEPLOYMENT.md](MOBILE_AND_DEPLOYMENT.md): desktop regression checklist (full keyboard route re-run after the mobile work), emulated touch results, and the manual matrix for real phones.

## Not verified
- Real-time feel at 60 fps in a visible window; long sessions (> a few minutes simulated); repeated restarts beyond a few; Firefox/Safari; physical phones (touch was tested only in Chromium device emulation); audio by ear.
- Returning to earlier areas after changing realities many times (item 19) beyond spot checks.
- Camera collision in every tight space (item 3).

## Manual test steps
1. `npm run dev`, open http://localhost:3000 (or the port Vite prints), Begin.
2. Walk the path; at the rails let the camera settle — the light should be far ahead.
3. At z ≈ 44 press F; at the fallen pole press Space; at z ≈ 98 watch the reveal.
4. At the fallen tree hold Q; walk through; release beyond it.
5. At the edge hold R and release; cross holding Q, release on the real fragment, hold again.
6. Past the gap, at the white wall hold Q, walk into it (A), climb above the broken section (W), go along (D), come down (S) at the far end; release Q on the wall to confirm it holds.
7. Past the wall, close the hand (F) and walk past the Hound; then try running.
8. Walk to the lamp; the ending should cut to black and show the end card.
