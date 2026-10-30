import { InputManager } from '../core/InputManager';
import { TOUCH } from '../core/controls';

type Owner = 'stick' | 'phase' | 'shift' | 'flame' | 'jump' | 'examine' | 'world';

export interface TouchViewState {
  fireState: 'dismissed' | 'summoning' | 'active' | 'dismissing';
  charge: number;        // 0..1
  fuel: number;          // 0..1
  canSummon: boolean;
  phasing: boolean;      // phase input is having effect
  phaseRefused: boolean; // no flame: phase cannot start
  canExamine: boolean;
  shiftAvailable: boolean;  // Deranged found and allowed here: only then is the shift shown
  shifted: boolean;
}

/**
 * Touch controls for landscape phones. Owns touch pointers only and turns them into
 * the same intents the keyboard produces (via InputManager's virtual API):
 *  - left: a floating joystick (direction + how far it is pushed)
 *  - right: hold to phase; tap shift (only once found, only where it works); tap the flame to summon / gather, long-press to let it go
 *    (or close the hand when nothing is gathered); hop / climb over; examine (only
 *    when something can be examined); pause
 *  - a short tap on open world sends an ember there
 * Each pointer belongs to the control it started on until it ends or is cancelled.
 */
export class TouchControls {
  public readonly root: HTMLDivElement;
  public enabled = false;
  private visible = false;
  private owners = new Map<number, Owner>();
  private stickZone: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private stickOrigin = { x: 0, y: 0 };
  private btn: Record<'phase' | 'shift' | 'flame' | 'jump' | 'examine' | 'pause', HTMLDivElement>;
  private flameRing: HTMLDivElement;
  private flameTimer: ReturnType<typeof setTimeout> | null = null;
  private flameHoldFired = false;
  private worldStart = new Map<number, { x: number; y: number; t: number }>();
  public onPause?: () => void;

  constructor(private input: InputManager, private canvas: HTMLCanvasElement) {
    this.root = document.createElement('div');
    this.root.id = 'touch-ui';
    this.root.className = 'hidden';
    this.stickZone = this.el('div', 'touch-stick-zone');
    this.stickBase = this.el('div', 'touch-stick-base', this.stickZone);
    this.stickKnob = this.el('div', 'touch-stick-knob', this.stickBase);
    const cluster = this.el('div', 'touch-cluster');
    this.btn = {
      phase: this.button(cluster, 'touch-phase', 'phase'),
      shift: this.button(cluster, 'touch-shift hidden', 'shift'),
      flame: this.button(cluster, 'touch-flame', 'flame'),
      jump: this.button(cluster, 'touch-jump', 'climb'),
      examine: this.button(cluster, 'touch-examine', 'look'),
      pause: this.button(this.root, 'touch-pause', 'II')
    };
    this.flameRing = this.el('div', 'touch-flame-ring', this.btn.flame);
    this.root.appendChild(this.stickZone);
    this.root.appendChild(cluster);
    document.body.appendChild(this.root);
    this.wire();
  }

  private el(tag: string, cls: string, parent?: HTMLElement): HTMLDivElement {
    const e = document.createElement(tag) as HTMLDivElement;
    e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  private button(parent: HTMLElement, cls: string, label: string): HTMLDivElement {
    const b = this.el('div', 'touch-btn ' + cls, parent);
    const l = this.el('span', 'touch-label', b);
    l.textContent = label;
    return b;
  }

  /** Touch is possible on this device (capability, not user agent). */
  public static capable(): boolean {
    return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  }

  public setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) this.releaseAll();
  }

  private capture(e: PointerEvent, el: HTMLElement, owner: Owner): void {
    e.preventDefault();
    this.owners.set(e.pointerId, owner);
    try { el.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
  }

  private wire(): void {
    // Joystick: floating within the left zone
    const z = this.stickZone;
    z.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || [...this.owners.values()].includes('stick')) return;
      this.capture(e, z, 'stick');
      const r = z.getBoundingClientRect();
      const R = this.stickRadius();
      this.stickOrigin.x = Math.min(r.right - R, Math.max(r.left + R, e.clientX));
      this.stickOrigin.y = Math.min(r.bottom - R, Math.max(r.top + R, e.clientY));
      this.stickBase.style.left = `${this.stickOrigin.x - r.left}px`;
      this.stickBase.style.top = `${this.stickOrigin.y - r.top}px`;
      this.stickBase.classList.add('active');
      this.moveStick(e.clientX, e.clientY);
    });
    z.addEventListener('pointermove', (e) => { if (this.owners.get(e.pointerId) === 'stick') this.moveStick(e.clientX, e.clientY); });
    const endStick = (e: PointerEvent) => {
      if (this.owners.get(e.pointerId) !== 'stick') return;
      this.owners.delete(e.pointerId);
      this.stopStick();
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) z.addEventListener(ev, endStick);

    // Phase: hold
    const ph = this.btn.phase;
    ph.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.capture(e, ph, 'phase');
      ph.classList.add('pressed');
      this.input.setVirtualHeld('phase', true);
    });
    const endPhase = (e: PointerEvent) => {
      if (this.owners.get(e.pointerId) !== 'phase') return;
      this.owners.delete(e.pointerId);
      ph.classList.remove('pressed');
      this.input.setVirtualHeld('phase', false);
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) ph.addEventListener(ev, endPhase);

    // Flame: tap = summon / add charge; long press = release (or close the hand)
    const fl = this.btn.flame;
    fl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || [...this.owners.values()].includes('flame')) return;
      this.capture(e, fl, 'flame');
      fl.classList.add('pressed');
      this.flameHoldFired = false;
      this.flameTimer = setTimeout(() => {
        this.flameHoldFired = true;
        fl.classList.add('held');
        this.input.pressVirtual('flameHold');
      }, TOUCH.flameHoldMs);
    });
    const endFlame = (e: PointerEvent, cancelled: boolean) => {
      if (this.owners.get(e.pointerId) !== 'flame') return;
      this.owners.delete(e.pointerId);
      if (this.flameTimer) { clearTimeout(this.flameTimer); this.flameTimer = null; }
      fl.classList.remove('pressed', 'held');
      if (!this.flameHoldFired && !cancelled) this.input.pressVirtual('flameTap');
    };
    fl.addEventListener('pointerup', (e) => endFlame(e, false));
    fl.addEventListener('pointercancel', (e) => endFlame(e, true));
    fl.addEventListener('lostpointercapture', (e) => endFlame(e, true));

    // Jump / climb over, examine, shift: one-shot presses
    // (examine is held while the finger stays down: some things want a deliberate touch)
    for (const [key, action] of [['jump', 'jump'], ['examine', 'inspect'], ['shift', 'shift']] as const) {
      const b = this.btn[key];
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        this.capture(e, b, key);
        b.classList.add('pressed');
        if (action === 'inspect') this.input.setVirtualHeld(action, true);
        else this.input.pressVirtual(action);
      });
      const end = (e: PointerEvent) => {
        if (this.owners.get(e.pointerId) !== key) return;
        this.owners.delete(e.pointerId);
        b.classList.remove('pressed');
        if (action === 'inspect') this.input.setVirtualHeld(action, false);
      };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(ev, end);
    }
    this.btn.pause.addEventListener('pointerdown', (e) => { e.preventDefault(); if (this.onPause) this.onPause(); });

    // Open world: a short, still tap sends an ember
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.visible) return;
      this.owners.set(e.pointerId, 'world');
      this.worldStart.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    });
    const endWorld = (e: PointerEvent, cancelled: boolean) => {
      const s = this.worldStart.get(e.pointerId);
      if (!s) return;
      this.worldStart.delete(e.pointerId);
      this.owners.delete(e.pointerId);
      const still = Math.hypot(e.clientX - s.x, e.clientY - s.y) < TOUCH.worldTapMaxMove;
      if (!cancelled && still && performance.now() - s.t < TOUCH.worldTapMaxMs) this.input.tapWorld(e.clientX, e.clientY);
    };
    this.canvas.addEventListener('pointerup', (e) => endWorld(e, false));
    this.canvas.addEventListener('pointercancel', (e) => endWorld(e, true));

    // A touch anywhere makes touch the active device (so hidden controls can appear)
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.input.noteTouch(); }, { capture: true });

    // Any interruption releases everything this layer holds
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    window.addEventListener('orientationchange', () => this.releaseAll());
  }

  private stickRadius(): number {
    const s = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(40, Math.min(76, s * TOUCH.stickRadius * 2));
  }

  private moveStick(cx: number, cy: number): void {
    const R = this.stickRadius();
    let dx = cx - this.stickOrigin.x, dy = cy - this.stickOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    let m = Math.min(1, d / R);
    if (m < TOUCH.stickDeadZone) m = 0;
    const nx = d > 0 ? (dx / Math.hypot(dx, dy)) * m : 0, ny = d > 0 ? (dy / Math.hypot(dx, dy)) * m : 0;
    this.input.setVirtualMove(nx, ny, true);
  }

  private stopStick(): void {
    this.stickKnob.style.transform = 'translate(0px, 0px)';
    this.stickBase.classList.remove('active');
    this.stickBase.style.left = '';
    this.stickBase.style.top = '';
    this.input.setVirtualMove(0, 0, false);
  }

  /** Releases every held control (focus loss, orientation change, pause, hide). */
  public releaseAll(): void {
    if (this.flameTimer) { clearTimeout(this.flameTimer); this.flameTimer = null; }
    this.owners.clear();
    this.worldStart.clear();
    this.stopStick();
    this.input.setVirtualHeld('phase', false);
    this.input.setVirtualHeld('inspect', false);
    for (const b of Object.values(this.btn)) b.classList.remove('pressed', 'held');
  }

  /** Reflects game state: charge ring, unavailable states, contextual examine. */
  public update(s: TouchViewState): void {
    if (!this.visible) return;
    const fl = this.btn.flame;
    const present = s.fireState === 'active' || s.fireState === 'summoning';
    fl.classList.toggle('lit', present);
    fl.classList.toggle('unavailable', !present && !s.canSummon);
    fl.classList.toggle('low', present && s.fuel < 0.25);
    this.flameRing.style.setProperty('--charge', String(Math.round(s.charge * 100)));
    this.btn.phase.classList.toggle('active', s.phasing);
    this.btn.phase.classList.toggle('unavailable', s.phaseRefused);
    this.btn.examine.classList.toggle('hidden', !s.canExamine);
    this.btn.shift.classList.toggle('hidden', !s.shiftAvailable && !s.shifted);
    this.btn.shift.classList.toggle('active', s.shifted);
  }
}
