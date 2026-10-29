# Fractured World — the opening

A third-person, isometric horror-adventure for desktop browsers and landscape phones
(WebGL2, Babylon.js 7, TypeScript, Vite). A hooded teenager follows a moving light down an
abandoned railway through a world that has three configurations — Normal, Void and
Deranged — and must phase between them, carry a small flame that burns down in the dark,
walk a wall when gravity turns, and get past what lives on the line.

Everything is generated in code: no image, model or audio files are loaded and nothing
is fetched at runtime.

## Run

Requires Node.js 18+ (tested with Node 24.19).

```bash
npm install
```

```bash
npm run dev
```

Open the URL Vite prints (http://localhost:3000 by default). Production build and
preview:

```bash
npm run build
```

```bash
npm run preview
```

Automated tests (Vitest):

```bash
npm test
```

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | walk (camera-relative) |
| Shift / C | run / walk slowly |
| Space | hop, or climb over a low obstacle ahead |
| F | open or close your hand (the flame) |
| R or right mouse (hold, release) | gather the flame, then let it go as a pulse |
| Q (hold) | phase into the local reality (Void or Deranged) |
| E | examine |
| Left click | send an ember |
| Esc / P | pause: volume, quality, restart |

Bindings: [src/core/controls.ts](src/core/controls.ts).

### Touch (landscape phones)
Left thumb: drag anywhere on the left to walk (push further to run). Right thumb: hold
**phase**; tap **flame** to open the hand and tap again to gather (the ring fills), long
press to let it go; **climb** to hop; **look** appears near things to examine; tap the
scene to send an ember; **II** pauses. Portrait shows a rotate prompt and pauses. Details:
[docs/MOBILE_AND_DEPLOYMENT.md](docs/MOBILE_AND_DEPLOYMENT.md).

## Deploy (Vercel)
Static build, no environment variables. Import the repository in Vercel; `vercel.json`
sets `npm ci`, `npm run build` and `dist`. Step-by-step instructions are in
[docs/MOBILE_AND_DEPLOYMENT.md](docs/MOBILE_AND_DEPLOYMENT.md). Not deployed yet.

## Layout

```
index.html            page shell and UI overlays
src/core/             Game (state machine, fixed-step loop), input, camera, phase,
                      realities, wind, audio, settings, rng
src/entities/         Player (model + animation), PlayerController (ground/air/vault/wall),
                      Creatures (Watcher, Drifters, Hound), FracturedHumanoid
src/world/            layout data, walk grid, terrain, railway, props, structures,
                      vista, moving light, phase geometry, anomalies, chapter director
src/graphics/         palm fire, particles, reality/wind material plugin, atmosphere,
                      post-processing, abyss fog
src/ui/               HUD, touch controls
src/dev/harness.ts    dev-only play-testing harness (window.H)
tests/                Vitest: phase state machine, walk grid, route connectivity, input/touch,
                      village/Void path, gravity surfaces, wind vortex
docs/                 audit, architecture, art direction, world bible, walkthrough,
                      asset manifest, performance, test plan
```

## Documentation
- [docs/PROJECT_AUDIT.md](docs/PROJECT_AUDIT.md) — baseline, changes, skills used, known limitations
- [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md)
- [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md)
- [docs/WORLD_BIBLE.md](docs/WORLD_BIBLE.md)
- [docs/OPENING_WALKTHROUGH.md](docs/OPENING_WALKTHROUGH.md)
- [docs/ASSET_MANIFEST.md](docs/ASSET_MANIFEST.md)
- [docs/PERFORMANCE_PLAN.md](docs/PERFORMANCE_PLAN.md)
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md) — includes manual test steps
- [docs/MOBILE_AND_DEPLOYMENT.md](docs/MOBILE_AND_DEPLOYMENT.md) — touch controls, phone profile, regression checklist, Vercel steps
