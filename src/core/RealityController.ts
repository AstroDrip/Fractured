import type { RealityId } from './Reality';
import type { PhaseSystem } from './PhaseSystem';
import type { DerangedStage, RealityRegion } from '../world/layout';

export type RealityRefusal = 'unavailable' | 'from-void' | 'no-flame' | 'busy';

// Transition rates (progress per second): Void ≈ 0.63 s in / 0.53 s out, Deranged ≈ 0.45 s / 0.38 s
export const RATES = { void: { enter: 1.6, leave: 1.9 }, deranged: { enter: 2.2, leave: 2.6 } };

export interface RealityIntent {
  phaseHeld: boolean;      // the phase input (hold: Void)
  phasePressed: boolean;   // ...pressed this step
  shiftPressed: boolean;   // the Deranged shift input (tap: toggle)
  ready: boolean;          // the flame can carry a transition (or the protagonist is on a face)
}

/**
 * The one place that turns the two reality inputs into what the phase state machine
 * does. PhaseSystem still owns the single transition (progress, safety, holding), so two
 * transitions can never overlap; this decides its target and whether it is held.
 *
 *  - Phase (hold) leads to Void where the region allows Void. Release: back to Normal.
 *  - Shift (tap) toggles Normal / Deranged where the region allows it and progression
 *    has reached the region's stage. It is refused while Void is active or forming.
 *  - Phase pressed while in Deranged leaves Deranged first; Void begins only once the
 *    world is back in Normal (so it passes through Normal, and a face can still hold).
 */
export class RealityController {
  public stage: DerangedStage = 0;
  public derangedOn = false;
  public onRefused?: (why: RealityRefusal) => void;
  public onUnlocked?: (stage: DerangedStage) => void;
  /** Deranged ended because the protagonist walked out of where it is allowed. */
  public onRegionEnded?: () => void;

  /** Raises progression (never lowers it). */
  public unlock(stage: DerangedStage): void {
    if (stage <= this.stage) return;
    this.stage = stage;
    if (this.onUnlocked) this.onUnlocked(stage);
  }

  /** Whether Deranged can be entered in this region at the current progression. */
  public derangedAllowed(region: RealityRegion): boolean {
    return region.deranged !== false && this.stage >= region.deranged;
  }

  /** Decides the phase target and held state for this step, then advances the phase. */
  public step(dt: number, phase: PhaseSystem, region: RealityRegion, intent: RealityIntent, live: boolean): void {
    const voidActive = phase.target === 'void' && phase.state !== 'normal';
    if (phase.state === 'locked') this.derangedOn = false;
    // A Deranged transition under way finishes before another request is taken
    const derangedMoving = phase.target === 'deranged' && (phase.state === 'entering' || phase.state === 'leaving');
    if (live && intent.shiftPressed) {
      if (voidActive) this.refuse('from-void');
      else if (derangedMoving) this.refuse('busy');
      else if (this.derangedOn) this.derangedOn = false;
      else if (!this.derangedAllowed(region)) this.refuse('unavailable');
      else if (!intent.ready) this.refuse('no-flame');
      else this.derangedOn = true;
    }
    if (live && intent.phasePressed && !region.void && !this.derangedOn) this.refuse('unavailable');
    // Leaving the region, or the flame failing, ends Deranged (the phase may still hold it)
    if (this.derangedOn && !this.derangedAllowed(region)) {
      this.derangedOn = false;
      if (this.onRegionEnded) this.onRegionEnded();
    }
    if (this.derangedOn && !intent.ready) this.derangedOn = false;
    if (live && intent.phasePressed && region.void && this.derangedOn) this.derangedOn = false;

    // A Void already under way lasts until released, even across a region's edge
    const wantVoid = intent.phaseHeld && (region.void || voidActive);
    let target: RealityId = this.derangedOn ? 'deranged' : wantVoid ? 'void' : region.void ? 'void' : 'deranged';
    phase.setTarget(target);                 // ignored mid-transition
    target = phase.target;
    const rate = target === 'void' ? RATES.void : RATES.deranged;
    phase.enterRate = rate.enter; phase.leaveRate = rate.leave;
    const held = target === 'deranged' ? this.derangedOn : wantVoid;
    phase.update(dt, held, intent.ready, live);
  }

  public reset(): void {
    this.stage = 0;
    this.derangedOn = false;
  }

  private refuse(why: RealityRefusal): void {
    if (this.onRefused) this.onRefused(why);
  }
}
