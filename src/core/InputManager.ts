import { Vector2, Vector3, Scene, Camera } from '@babylonjs/core';
import { BINDINGS, Action, PAD_BUTTONS, PAD } from './controls';
import { GROUND_Y } from '../world/layout';

export type InputDevice = 'keyboard' | 'touch';

/**
 * The shared input layer. Keyboard, mouse and touch all produce the same intents:
 * a move vector, held actions, edge-triggered presses/releases and a world target.
 * Gameplay reads only these intents, never raw events.
 *
 * Touch does not live here: `ui/TouchControls` owns touch pointers and feeds this
 * class through the virtual-input API (`setVirtualMove`, `setVirtualHeld`,
 * `pressVirtual`, `tapWorld`). Key repeat is ignored and every source is released
 * when the window loses focus or the page is hidden.
 */
export class InputManager {
  public moveVector = new Vector2(0, 0);
  /** 0..1 analogue magnitude of the current move vector (keyboard: 1 when moving). */
  public moveMagnitude = 0;
  public lastDevice: InputDevice = 'keyboard';
  public onDeviceChange?: (d: InputDevice) => void;
  private held = new Set<string>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private codeToAction = new Map<string, Action>();
  private clickTarget: Vector3 | null = null;
  private rightMouse = false;
  // Gamepad state, read in poll()
  private padHeld = new Set<Action>();
  private padMove = new Vector2();
  public padSlow = false;

  // Virtual (touch) state
  private vMove = new Vector2();
  private vMoveActive = false;
  private vHeld = new Set<Action>();

  constructor(private canvas: HTMLCanvasElement, private scene: Scene, private camera: () => Camera | null) {
    for (const [action, codes] of Object.entries(BINDINGS)) {
      for (const c of codes) this.codeToAction.set(c, action as Action);
    }
    window.addEventListener('keydown', (e) => {
      const action = this.codeToAction.get(e.code);
      if (!action) return;
      if (action === 'jump' || action === 'phase') e.preventDefault();
      if (e.repeat) return;
      this.setDevice('keyboard');
      this.held.add(e.code);
      this.pressed.add(action);
    });
    window.addEventListener('keyup', (e) => {
      const action = this.codeToAction.get(e.code);
      this.held.delete(e.code);
      if (action && !this.isHeld(action)) this.released.add(action);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;   // touch is handled by TouchControls
      this.setDevice('keyboard');
      if (e.button === 0) this.clickTarget = this.groundPoint(e.offsetX, e.offsetY);
      if (e.button === 2 && !this.rightMouse) { this.rightMouse = true; this.pressed.add('gather'); }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 2 && this.rightMouse) {
        this.rightMouse = false;
        if (!this.isHeld('gather')) this.released.add('gather');
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** A touch landed somewhere on the page: touch becomes the active device. */
  public noteTouch(): void { this.setDevice('touch'); }

  private setDevice(d: InputDevice): void {
    if (this.lastDevice === d) return;
    this.lastDevice = d;
    if (this.onDeviceChange) this.onDeviceChange(d);
  }

  /** Releases every held source (keys, right mouse, virtual controls). */
  public releaseAll(): void {
    for (const code of this.held) {
      const a = this.codeToAction.get(code);
      if (a) this.released.add(a);
    }
    this.held.clear();
    if (this.rightMouse) { this.rightMouse = false; this.released.add('gather'); }
    for (const a of this.vHeld) this.released.add(a);
    this.vHeld.clear();
    this.vMoveActive = false;
    this.vMove.set(0, 0);
  }

  // --- Virtual input (touch) ------------------------------------------------

  /** Analogue movement in screen space (x right, y down), magnitude 0..1. */
  public setVirtualMove(x: number, y: number, active: boolean): void {
    // Only real touch input switches the device; releases (blur, pause) must not
    if (active) this.setDevice('touch');
    this.vMove.set(x, y);
    this.vMoveActive = active;
  }

  public setVirtualHeld(action: Action, down: boolean): void {
    if (down) this.setDevice('touch');
    if (down && !this.vHeld.has(action)) { this.vHeld.add(action); this.pressed.add(action); }
    else if (!down && this.vHeld.has(action)) { this.vHeld.delete(action); if (!this.isHeld(action)) this.released.add(action); }
  }

  /** A one-shot press (and release) of an action. */
  public pressVirtual(action: Action): void {
    this.setDevice('touch');
    this.pressed.add(action);
    this.released.add(action);
  }

  /** A short tap on open world: the same target as a left click. */
  public tapWorld(clientX: number, clientY: number): void {
    this.setDevice('touch');
    const r = this.canvas.getBoundingClientRect();
    this.clickTarget = this.groundPoint(clientX - r.left, clientY - r.top);
  }

  // --- Reading intents --------------------------------------------------------

  public isHeld(action: Action): boolean {
    if (this.vHeld.has(action) || this.padHeld.has(action)) return true;
    if (action === 'gather' && this.rightMouse) return true;
    for (const code of BINDINGS[action]) if (this.held.has(code)) return true;
    return false;
  }

  public wasPressed(action: Action): boolean { return this.pressed.has(action); }
  public wasReleased(action: Action): boolean { return this.released.has(action); }

  public consumeClick(): Vector3 | null {
    const t = this.clickTarget;
    this.clickTarget = null;
    return t;
  }

  /** Gamepad buttons and stick, with the same press / release edges as keys. */
  private pollPad(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    const now = new Set<Action>();
    this.padMove.set(0, 0);
    if (pad) {
      pad.buttons.forEach((b, i) => { const a = PAD_BUTTONS[i]; if (a && (b.pressed || b.value > 0.5)) now.add(a); });
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > PAD.deadzone) this.padMove.set(ax, ay);
    }
    for (const a of now) if (!this.padHeld.has(a)) { this.pressed.add(a); this.setDevice('keyboard'); }
    const before = [...this.padHeld];
    this.padHeld = now;
    for (const a of before) if (!now.has(a) && !this.isHeld(a)) this.released.add(a);
  }

  /** Call once per frame before reading input. */
  public poll(): void {
    this.pollPad();
    let x = 0, y = 0;
    if (this.isHeld('left')) x -= 1;
    if (this.isHeld('right')) x += 1;
    if (this.isHeld('up')) y -= 1;
    if (this.isHeld('down')) y += 1;
    if (x !== 0 && y !== 0) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    this.moveMagnitude = x !== 0 || y !== 0 ? 1 : 0;
    if (this.vMoveActive) {
      // Touch: direction is normalised; how far the stick is pushed picks the speed tier
      const m = Math.min(1, Math.hypot(this.vMove.x, this.vMove.y));
      this.moveMagnitude = m;
      x = m > 0 ? this.vMove.x / m : 0; y = m > 0 ? this.vMove.y / m : 0;
    }
    this.padSlow = false;
    if (this.padMove.x !== 0 || this.padMove.y !== 0) {
      const m = Math.min(1, Math.hypot(this.padMove.x, this.padMove.y));
      x = this.padMove.x / m; y = this.padMove.y / m;
      this.moveMagnitude = m;
      this.padSlow = m < PAD.slowBelow;
      this.setDevice('keyboard');
    }
    this.moveVector.set(x, y);
  }

  /** Call at the end of each frame. */
  public endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }

  private groundPoint(x: number, y: number): Vector3 | null {
    const cam = this.camera();
    if (!cam) return null;
    const ray = this.scene.createPickingRay(x, y, null, cam);
    const hit = this.scene.pickWithRay(ray, (m) => m.isPickable && m.name.startsWith('terrain'));
    if (hit && hit.hit && hit.pickedPoint) return hit.pickedPoint.clone();
    if (Math.abs(ray.direction.y) > 1e-3) {
      const d = (GROUND_Y - ray.origin.y) / ray.direction.y;
      if (d > 0) return ray.origin.add(ray.direction.scale(d));
    }
    return null;
  }
}
