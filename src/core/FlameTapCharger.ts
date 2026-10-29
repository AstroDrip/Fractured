import { TOUCH } from './controls';

export interface TapChargeConfig {
  flameTapMinInterval: number;
  flameChargeHoldMs: number;
}

/**
 * Decides which flame taps count. One physical tap can arrive as more than one
 * event on some hardware; taps closer than `flameTapMinInterval` are merged. After
 * `flameChargeHoldMs` without a tap, gathered charge begins to fade. Pure logic so it
 * can be tested without a browser; the charge itself lives in PalmFire.
 */
export class FlameTapCharger {
  private lastAccepted = -Infinity;
  public tapping = false;     // charge came from taps (not from a held gather key)

  constructor(private cfg: TapChargeConfig = TOUCH) {}

  /** Returns true if this tap should add charge. `now` in ms. */
  public accept(now: number): boolean {
    if (now - this.lastAccepted < this.cfg.flameTapMinInterval) return false;
    this.lastAccepted = now;
    this.tapping = true;
    return true;
  }

  /** True once tap-gathered charge has been left alone long enough to fade. */
  public shouldFade(now: number): boolean {
    return this.tapping && now - this.lastAccepted > this.cfg.flameChargeHoldMs;
  }

  public reset(): void {
    this.lastAccepted = -Infinity;
    this.tapping = false;
  }
}
