/// <reference types="vite/client" />
import { Game } from './core/Game';

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game('renderCanvas');
  // Dev builds expose a play-testing harness; it is not part of production bundles
  if (import.meta.env.DEV) void import('./dev/harness').then(m => m.installHarness(game));
});
