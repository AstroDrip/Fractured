# Performance Plan and Measurements

## Test conditions
Windows 11, Node 24.19, Chromium-based in-app browser, **Intel Iris Xe (ANGLE /
D3D11)**, canvas **1024 × 768**, Medium quality unless stated. The browser pane was
hidden (rAF throttled to ~1 Hz), so frames were stepped manually: one fixed simulation
step + `scene.render()` + `gl.finish()`, 60–90 samples per point. Real-time frame rate
in a visible window was **not** measured, and no frame-rate target is claimed.

## Phone profile
Phones (touch capable and shorter screen side ≤ 900 CSS px) render at device pixels capped per quality (Low 1.0 then ×1/1.15, Medium 1.3, High 1.75), have shadows only on High (1024) and 0.75× particles; low-memory/≤ 4-core phones default to Low. Desktop values are unchanged. Emulated 740×360 at DPR 2, Medium, on the desktop GPU above with a hidden pane: render 962×468, frame median 18.3 ms / p95 34.8 ms — emulation only, **not** a phone measurement. See [MOBILE_AND_DEPLOYMENT.md](MOBILE_AND_DEPLOYMENT.md).

## Measurements (this pass)
| Location | Frame p50 / p95 (ms) | Simulation p50 / p95 (ms) |
| --- | --- | --- |
| Start clearing | 13.4 / 27.7 | 2.2 / 4.9 |
| Railway vantage, flame on | 13.2 / 24.4 | 1.4 / 2.7 |
| Void at the barrier | 12.3 / 18.7 | 2.5 / 5.2 |
| Void at the gap | 10.4 / 15.0 | 1.8 / 4.1 |
| On the wall (Deranged) | 11.4 / 16.8 | 2.0 / 3.5 |
| Railway vantage, **Low** | 6.2 / 7.8 | 1.1 / 1.9 |
| Railway vantage, **High** | 13.0 / 18.3 | 1.9 / 3.6 |
(The High run kept the 1024 shadow map: the generator is created once; 2048 needs a reload.)

Per-system simulation cost (0.1 ms timer resolution): anomalies ≈ 0.2, wires ≈ 0.2,
vista ≈ 0.2, everything else below resolution. Live particle count across the custom
fields: 630–900.

## Budgets
| Item | Budget | Current |
| --- | --- | --- |
| Dynamic lights | 4 always-on | 4 |
| Shadow maps | 1 | 1 (moon) |
| Custom particle fields | pooled, one draw each | 12 families, capacities 22–700 |
| Simulation step | < 4 ms p95 on iGPU laptop | 1.9–5.9 ms p95 (measured above) |
| Bundle | — | 5.2 MB (1.17 MB gzip) |

## Applied optimizations
Thin instances for every repeated prop; merged static meshes with frozen world matrices;
shared materials; one draw call per particle family; no per-frame mesh, material or
texture creation; lights never toggled; shadow depth shaders precompiled; distant
effects (wires, vista river) at half rate; Low renders at 1/1.4 resolution without
bloom, grain or shadows.

## Next steps, in order
1. Measure real-time frame pacing in a visible window and on a discrete GPU.
2. Deep `@babylonjs/core` imports to cut the bundle.
3. Shadow caster culling by distance (≈ 600 thin-instanced trees are casters).
4. Profile transparent overdraw at the gap (mist, residue, glows).
