// Keyboard bindings. Each action lists the KeyboardEvent.code values that trigger it;
// remap here. The title screen and pause menu show CONTROL_LABELS.
export const BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  slow: ['KeyC', 'ControlLeft'],
  jump: ['Space'],         // hop, or vault a low obstacle ahead
  fire: ['KeyF'],          // open / close the hand
  gather: ['KeyR'],        // hold to gather the fire, release to let it go (also right mouse)
  phase: ['KeyQ'],         // hold to phase
  inspect: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  // Virtual actions raised only by the touch layer (no keys)
  flameTap: [],            // a tap on the flame control: summon, or add charge
  flameHold: []            // a long press on the flame control: release charge, or close the hand
} as const;

export type Action = keyof typeof BINDINGS;

export const CONTROL_LABELS: [string, string][] = [
  ['W A S D', 'walk'],
  ['Shift / C', 'run / walk slowly'],
  ['Space', 'hop, or climb over'],
  ['F', 'open or close your hand'],
  ['R / right mouse', 'hold to gather the fire, release'],
  ['Q', 'hold to phase'],
  ['E', 'examine'],
  ['Left click', 'send an ember'],
  ['Esc', 'pause']
];

/**
 * Touch tuning in one place. The touch layer only produces intents; the game decides
 * what they mean, using the same flame, phase and movement systems as the keyboard.
 */
export const TOUCH = {
  stickRadius: 0.085,        // joystick travel, fraction of the screen's short side × 2
  stickDeadZone: 0.12,       // normalised magnitude below which there is no movement
  stickRun: 0.92,            // pushed to the rim: run
  stickSlow: 0.45,           // a light push: walk slowly
  flameTapCharge: 0.25,      // charge added per accepted tap (four taps = full)
  flameTapMinInterval: 70,   // ms: taps closer than this are one physical tap
  flameChargeHoldMs: 2600,   // ms after the last tap before gathered charge starts to fade
  flameHoldMs: 420,          // ms press that counts as the release / close gesture
  worldTapMaxMs: 260,        // a short tap on open world sends an ember
  worldTapMaxMove: 14        // px a world tap may drift
} as const;
