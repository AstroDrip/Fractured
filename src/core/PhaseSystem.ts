import type { RealityId } from './Reality';

export type PhaseState = 'normal' | 'entering' | 'phased' | 'leaving' | 'held' | 'locked';

// Above this progress the target reality's collision is committed
export const PHASE_SOLID_THRESHOLD = 0.5;

/** Four readable stages of a transition, derived from progress. */
export type PhaseStage = 'none' | 'resistance' | 'disagreement' | 'overlap' | 'resolution';

/**
 * Hold-to-phase between Normal and the local fracture's target reality (Void or
 * Deranged, defined per region by the layout).
 *
 *  normal --hold Q with flame--> entering --(1)--> phased
 *  entering/phased --release--> leaving --(0)--> normal
 *  leaving --world unsafe to leave--> held (stays phased; strains) --safe--> leaving
 *  any --ground lost / flame out--> locked (0) --Q released--> normal
 *
 * Collision commits at PHASE_SOLID_THRESHOLD in both directions, and only after the
 * caller's safety check accepts the incoming reality at the protagonist's position.
 */
export class PhaseSystem {
  public state: PhaseState = 'normal';
  public progress = 0;
  public target: RealityId = 'void';
  public enterRate = 2.2;
  public leaveRate = 2.6;
  private refusedCooldown = 0;
  private strainCooldown = 0;
  public strain = 0;               // 0..1 visible resistance while a commit is refused

  public onEnterStart?: () => void;
  public onFullyPhased?: () => void;
  public onLeaveStart?: () => void;
  public onRefused?: () => void;
  /** The world refused the commit; enter = true when entering was refused. */
  public onRejected?: (enter: boolean) => void;
  /** Safety check: can the protagonist stand here in this reality? */
  public canStandIn: (r: RealityId) => boolean = () => true;

  public get isSolid(): boolean { return this.progress >= PHASE_SOLID_THRESHOLD; }
  /** The reality whose collision currently applies. */
  public get reality(): RealityId { return this.isSolid ? this.target : 'normal'; }

  public get stage(): PhaseStage {
    const p = this.progress;
    if (p <= 0) return 'none';
    if (p < 0.2) return 'resistance';
    if (p < 0.5) return 'disagreement';
    if (p < 0.85) return 'overlap';
    return 'resolution';
  }

  /** Sets the local fracture's target. Ignored mid-transition so states never mix. */
  public setTarget(t: RealityId): void {
    if (this.state === 'normal' || this.state === 'locked') this.target = t;
  }

  public update(dt: number, held: boolean, fireReady: boolean, allowed = true): void {
    this.refusedCooldown = Math.max(0, this.refusedCooldown - dt);
    this.strainCooldown = Math.max(0, this.strainCooldown - dt);
    this.strain = Math.max(0, this.strain - dt * 2);
    if (this.state === 'locked') {
      this.progress = Math.max(0, this.progress - this.leaveRate * dt);
      if (!held && this.progress === 0) this.state = 'normal';
      return;
    }
    const wantPhase = held && fireReady && allowed;
    if (held && allowed && !fireReady && this.state === 'normal' && this.refusedCooldown === 0) {
      this.refusedCooldown = 2.5;
      if (this.onRefused) this.onRefused();
    }

    if (wantPhase) {
      if (this.state === 'normal' || this.state === 'leaving' || this.state === 'held') {
        if (this.state === 'normal' && this.onEnterStart) this.onEnterStart();
        this.state = 'entering';
      }
      let next = Math.min(1, this.progress + this.enterRate * dt);
      // Commit point: the incoming reality must be able to hold the protagonist
      if (this.progress < PHASE_SOLID_THRESHOLD && next >= PHASE_SOLID_THRESHOLD && !this.canStandIn(this.target)) {
        next = PHASE_SOLID_THRESHOLD - 0.06;
        this.reject(true);
      }
      this.progress = next;
      if (this.state === 'entering' && this.progress >= 1) {
        this.state = 'phased';
        if (this.onFullyPhased) this.onFullyPhased();
      }
      return;
    }

    if (this.state === 'normal') return;
    if (this.state === 'entering' || this.state === 'phased') {
      this.state = 'leaving';
      if (this.onLeaveStart) this.onLeaveStart();
    }
    let next = Math.max(0, this.progress - this.leaveRate * dt);
    if (this.progress >= PHASE_SOLID_THRESHOLD && next < PHASE_SOLID_THRESHOLD && !this.canStandIn('normal') && this.mustHold()) {
      // Leaving here would drop the protagonist out of the world: the phase holds
      next = PHASE_SOLID_THRESHOLD;
      this.state = 'held';
      this.reject(false);
    } else if (this.state === 'held') {
      this.state = 'leaving';
    }
    this.progress = next;
    if (this.progress === 0) this.state = 'normal';
  }

  /**
   * Whether an unsafe exit is refused (held) rather than allowed to drop the
   * protagonist to a recovery point. Set per location by the game.
   */
  public mustHold: () => boolean = () => false;

  private reject(enter: boolean): void {
    this.strain = 1;
    if (this.strainCooldown === 0) {
      this.strainCooldown = 1.5;
      if (this.onRejected) this.onRejected(enter);
    }
  }

  /** Drops out of phase immediately and ignores input until the key is released. */
  public lock(): void {
    this.state = 'locked';
    this.progress = 0;
  }

  public reset(): void {
    this.state = 'normal';
    this.progress = 0;
    this.strain = 0;
  }
}
