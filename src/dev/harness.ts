// Dev-only play-testing harness, loaded by main.ts in `vite dev` only. Exposes
// `window.H` for driving the game from the console or browser automation:
// teleporting, stepping fixed frames, holding keys and measuring the image.
import type { Game } from '../core/Game';

export function installHarness(game: Game): void {
  const g = game as unknown as Record<string, any>;
  const H = {
    game,
    sleep: (ms: number) => new Promise(r => setTimeout(r, ms)),
    key: (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })),
    hold: (codes: string[], down: boolean) => codes.forEach(c => H.key(c, down)),
    ready: async () => { for (let i = 0; i < 300 && g.state === 'loading'; i++) await H.sleep(100); return g.state; },
    start: () => {
      (document.getElementById('start-btn') as HTMLButtonElement).click();
      const f = document.getElementById('fade')!;
      f.style.transition = 'none'; f.style.opacity = '0';
      g.cam.intro = 1; g.cam.introActive = false;
    },
    tp: (x: number, z: number, yaw?: number) => {
      const v = g.player.position.clone();
      v.set(x, g.world.grid.heightAt(x, z), z);
      g.ctrl.teleport(v);
      if (yaw !== undefined) g.player.setYaw(yaw);
      g.cam.snapTo(v);
    },
    /** Advances the game by fixed 1/60 s frames without real time passing. */
    step: (sec: number) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) g.frame(1 / 60); },
    live: () => {
      let last = performance.now();
      g.engine.runRenderLoop(() => { const n = performance.now(); g.frame(Math.min(0.05, (n - last) / 1000)); last = n; });
    },
    still: () => g.engine.stopRenderLoop(),
    P: () => ({
      x: +g.player.position.x.toFixed(2), y: +g.player.position.y.toFixed(2), z: +g.player.position.z.toFixed(2),
      phase: g.phase.state, progress: +g.phase.progress.toFixed(2), fire: g.fire.state,
      reality: g.phase.reality, mode: g.ctrl.mode, fuel: +g.fire.fuel.toFixed(2)
    }),
    /** Mean / max luminance of the current frame (0..255). */
    lum: () => {
      g.frame(1 / 60);
      const gl = g.engine._gl as WebGL2RenderingContext;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0, mx = 0;
      for (let i = 0; i < px.length; i += 4) { const l = (px[i] + px[i + 1] + px[i + 2]) / 3; s += l; if (l > mx) mx = l; }
      return { mean: +(s / (w * h)).toFixed(1), max: Math.round(mx) };
    },
    /** Simulates one frame without rendering (fast logic tests). */
    sim: (dt: number) => { g.input.poll(); g.simulate(dt, g.state === 'playing'); g.input.endFrame(); },
    stepNR: (sec: number) => { for (let i = 0; i < Math.round(sec * 60); i++) H.sim(1 / 60); },
    tap: (code: string) => { H.key(code, true); H.sim(1 / 60); H.key(code, false); H.sim(1 / 60); },
    /**
     * Autopilot: steers with real WASD key events toward each waypoint. onFrame may
     * hold or release other keys. Stops when stuck for 3 s or the state changes.
     */
    walk: (pts: [number, number][], maxSec = 120, onFrame?: (t: number) => void) => {
      const cam = g.cam;
      const keys: Record<string, boolean> = { W: false, A: false, S: false, D: false };
      const setKeys = (want: Record<string, boolean>) => {
        for (const k of ['W', 'A', 'S', 'D']) if (!!want[k] !== keys[k]) { H.key('Key' + k, !!want[k]); keys[k] = !!want[k]; }
      };
      let i = 0, t = 0, frames = 0, stuck = 0;
      const last = g.player.position.clone();
      while (i < pts.length && t < maxSec) {
        const p = g.player.position;
        const dx = pts[i][0] - p.x, dz = pts[i][1] - p.z, d = Math.hypot(dx, dz);
        if (d < 0.35) { i++; continue; }
        const wx = dx / d, wz = dz / d;
        const xs = wx * cam.right.x + wz * cam.right.y, ys = -(wx * cam.forward.x + wz * cam.forward.y);
        setKeys({ D: xs > 0.38, A: xs < -0.38, S: ys > 0.38, W: ys < -0.38 });
        if (onFrame) onFrame(t);
        H.sim(1 / 60); t += 1 / 60; frames++;
        if (frames % 60 === 0) {
          stuck = g.player.position.subtract(last).length() < 0.2 ? stuck + 1 : 0;
          last.copyFrom(g.player.position);
          if (stuck > 3 && !g.recover.active && g.recover.stumble <= 0) break;
        }
        if (g.state !== 'playing') break;
      }
      setKeys({});
      return { reached: i, of: pts.length, secs: +t.toFixed(1), pos: H.P(), state: g.state };
    },
    counts: () => ({
      meshes: g.scene.meshes.length, materials: g.scene.materials.length, textures: g.scene.textures.length,
      particleSystems: g.scene.particleSystems.length, lights: g.scene.lights.length,
      activeMeshes: g.scene.getActiveMeshes().length, drawCalls: g.engine._drawCalls?.current
    })
  };
  (window as unknown as { H: typeof H }).H = H;
}
