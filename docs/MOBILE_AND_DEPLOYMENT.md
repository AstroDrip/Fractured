# Mobile Play and Deployment

The game now runs on landscape phones as well as desktop. Desktop behaviour is unchanged:
the touch layer only adds intents and shows itself only while touch is the device in use.

## Touch controls (landscape)

| Control | Where | Gesture | Same as |
| --- | --- | --- | --- |
| Joystick | left ~40% of the screen, floating (appears where the thumb lands) | drag; light push = slow, mid = walk, edge (≥ 92%) = run | W A S D + C / Shift |
| phase | right cluster, large | hold; release to leave | Q (hold) |
| flame | right cluster | tap = open the hand; each further tap adds charge (ring shows it); long press (420 ms) = let the charge go as a pulse, or close the hand if nothing is gathered | F, R |
| climb | right cluster, upper | tap | Space |
| look | right cluster, only near something to examine | tap | E |
| open world | anywhere on the scene | short, still tap (< 260 ms, < 14 px) | left click (ember) |
| II | top right | tap | Esc |

All tuning values live in `TOUCH` in [src/core/controls.ts](../src/core/controls.ts):
stick radius, dead zone, run/slow thresholds, charge per tap (0.25), minimum interval
between counted taps (70 ms), how long tap charge holds before fading (2.6 s), long-press
time and the world-tap limits. The charge never exceeds the flame's own maximum (1).

Hints change wording in touch mode ("[phase] hold to phase" instead of "[Q] …").

## Architecture

- [src/core/InputManager.ts](../src/core/InputManager.ts) is the single intent layer:
  move vector + magnitude, held actions, pressed/released edges, world target. Gameplay
  reads only these. Touch feeds it through a virtual API (`setVirtualMove`,
  `setVirtualHeld`, `pressVirtual`, `tapWorld`); keyboard and touch can be held at
  the same time and releasing one does not release the other.
- [src/ui/TouchControls.ts](../src/ui/TouchControls.ts) owns touch pointers only
  (`pointerType === 'touch'`). Each pointer belongs to the control it started on until
  `pointerup`, `pointercancel` or `lostpointercapture`, so the stick and phase can be held
  together while the other thumb taps. Blur, page hide, orientation change, pause and
  hiding the controls release everything.
- [src/core/FlameTapCharger.ts](../src/core/FlameTapCharger.ts): pure logic for tap
  dedupe and charge fade (unit tested).
- The active device is whatever produced input last: a touch shows the controls, a key
  press or mouse click hides them. Releases never switch the device.
- Phone profile (`Game.mobile`): touch capable (`pointer: coarse` or `maxTouchPoints`)
  **and** a small screen (shorter side ≤ 900 CSS px). No user-agent sniffing. A touch
  laptop counts as desktop for rendering but still gets the touch controls when touched.

### Viewport
- `100dvh`, `viewport-fit=cover`, safe-area insets on every control.
- Resize, `orientationchange` and `visualViewport` resize are coalesced to one
  `engine.resize()` per animation frame.
- Portrait on a phone: a "turn your phone sideways" overlay; play pauses and resumes by
  itself on return to landscape (a manual pause stays paused).
- Begin requests fullscreen and a landscape lock where the browser allows (best effort;
  iOS Safari ignores both).
- WebGL context lost: the game pauses with a notice; the notice clears on restore.

### Phone quality profile
| | Low | Medium | High |
| --- | --- | --- | --- |
| Device pixel ratio cap | 1.0 (then ×1/1.15) | 1.3 | 1.75 |
| Shadows | off | off | 1024 |
| Particles | ×0.75 of desktop values | ×0.75 | ×0.75 |

Default on a phone with no saved settings: Low if `deviceMemory ≤ 4` or ≤ 4 cores,
otherwise Medium. Desktop keeps CSS-pixel rendering (Low = 1/1.4), 1024/2048 shadows.

## Desktop regression checklist

Run before and after any mobile change.

| Check | Result this pass (dev harness, Chromium, desktop viewport) |
| --- | --- |
| Full route by keyboard autopilot: path, flame, vaults, reveal, void barrier, gap phasing, wall walk, Hound, finale end card | passed, no errors |
| Touch UI hidden with keyboard/mouse; body has no `touch-mode` | passed |
| Blur / pause / resume keeps the keyboard device | passed (bug found and fixed: releases used to flip the device to touch) |
| Hardware scaling at Medium = 1 (unchanged) | passed |
| Desktop shadows/particles unchanged | by code: phone factors apply only when `mobile` |
| Production build loads, JS served as `text/javascript`, harness absent, no console errors | passed (`vite preview`) |
| `npm test` | 29 passing |

## Mobile test results (Chromium device emulation, 740×360, DPR 2)

Emulation, not a phone: it covers layout, pointer handling and logic, not real touch
hardware, GPU or thermal behaviour.

| Check | Result |
| --- | --- |
| Controls appear after the first touch | passed |
| Stick walk, run at rim (4.17 m/s), stop on release | passed |
| Flame tap summons; taps charge 0.25 → 1, capped; quick duplicate taps count once | passed |
| Long press releases the pulse; long press with no charge closes the hand | passed |
| Move + phase at once; `pointercancel` on phase releases only phase | passed |
| Blur stops movement | passed |
| Climb button hops | passed |
| World tap sends an ember; a drag does not | passed |
| Look button only near something examinable | passed |
| Wall walk by stick while holding phase; releasing phase on the wall holds | passed |
| Portrait → overlay + pause; landscape → resume | passed |
| Render size 962×468 at Medium (DPR capped 1.3) | passed |
| Frame time (emulation on a desktop GPU, hidden pane): median 18.3 ms, p95 34.8 ms | indicative only |

**Not done:** testing on physical Android or iOS devices; real-device frame rate,
thermal throttling, Safari-specific behaviour, audio on mobile.

## Manual test matrix for real phones

Devices: one mid-range Android (Chrome), one iPhone (Safari), ideally one older/low-end
Android. For each:

1. Open the URL in portrait: the title screen is usable; Begin → the rotate prompt shows.
2. Rotate to landscape: the game starts, no browser scroll or zoom on drag/double tap.
3. Drag the stick in all 8 directions; light, mid and full push change speed.
4. Hold phase with the right thumb while walking with the left.
5. Tap flame: hand opens. Tap 4 times: the ring fills and stops at full. Long press:
   pulse. Long press again with an empty ring: hand closes.
6. Tap the ground: an ember flies there.
7. Get a notification / swipe to the home screen mid-drag, return: nothing stays held.
8. Rotate to portrait mid-play: paused with the prompt; back: resumes.
9. Notch/home indicator never covers a control (both landscape orientations).
10. Play the whole chapter; note the frame rate (Low and Medium), heat and any stutter.
11. Pause → change Quality → resume.

## Deploying to Vercel

The project is a static Vite build; nothing runs on a server and there are **no
environment variables or secrets**. [vercel.json](../vercel.json) sets the framework,
`npm ci`, `npm run build`, output `dist`, and long-lived caching for hashed `/assets/*`.
There is deliberately no catch-all rewrite (a single page with no client routes doesn't
need one, and a blanket rewrite would serve `index.html` for missing JS files).

1. Put the project in a Git repository and push it to GitHub/GitLab/Bitbucket
   (`node_modules/`, `dist/`, `.vercel/` are ignored by `.gitignore`).
2. In Vercel: **Add New → Project**, import the repository.
3. Framework preset: Vite (read from `vercel.json`). Root directory: the repository root.
4. Leave Build/Output settings as detected (`npm run build`, `dist`). Node 18.18+ (see
   `engines` in package.json).
5. No environment variables are needed. Deploy.
6. Open the deployment URL on desktop: title screen → Begin → play.
7. Open it on a phone and run the manual matrix above.
8. Optional CLI route instead of the dashboard: `npm i -g vercel`, then `vercel` (preview)
   and `vercel --prod` from the project folder.

HTTPS (which Vercel provides) is required for fullscreen and orientation lock on most
phones.

**Status:** not deployed. The Vercel configuration was checked by a clean `npm ci && npm
run build` and by serving `dist/` with `vite preview`; no Vercel deployment was made and
no live URL exists yet.
