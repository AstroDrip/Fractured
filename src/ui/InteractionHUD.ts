import { CONTROL_LABELS } from '../core/controls';
import type { Quality } from '../graphics/PostFX';

const $ = (id: string) => document.getElementById(id);

/**
 * All DOM UI: loading progress, title, pause menu, thoughts, contextual hints,
 * fades, the chapter end card and error recovery. Gameplay never touches the DOM
 * directly.
 */
export class InteractionHUD {
  private thoughtBox = $('thought-box');
  private hint = $('hint');
  private fade = $('fade');
  private thoughtTimeout: ReturnType<typeof setTimeout> | null = null;
  private hintTimeout: ReturnType<typeof setTimeout> | null = null;
  private thoughtQueue: string[] = [];
  private thoughtBusyUntil = 0;

  public onStart?: () => void;
  public onResume?: () => void;
  public onRestart?: () => void;
  public onVolume?: (v: number) => void;
  public onQuality?: (q: Quality) => void;

  constructor() {
    $('start-btn')?.addEventListener('click', () => this.onStart?.());
    $('resume-btn')?.addEventListener('click', () => this.onResume?.());
    $('restart-btn')?.addEventListener('click', () => this.onRestart?.());
    $('end-restart-btn')?.addEventListener('click', () => this.onRestart?.());
    $('error-reload-btn')?.addEventListener('click', () => location.reload());
    const vol = $('volume') as HTMLInputElement | null;
    vol?.addEventListener('input', () => this.onVolume?.(Number(vol.value) / 100));
    const q = $('quality') as HTMLSelectElement | null;
    q?.addEventListener('change', () => this.onQuality?.(q.value as Quality));

    const list = $('controls-list');
    if (list) {
      list.innerHTML = CONTROL_LABELS.map(([k, v]) => `<li><kbd>${k}</kbd><span>${v}</span></li>`).join('');
      const pauseList = $('pause-controls');
      if (pauseList) pauseList.innerHTML = list.innerHTML;
    }
  }

  public setLoading(progress: number, label: string): void {
    const bar = $('loading-bar');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    const l = $('loading-label');
    if (l) l.textContent = label;
  }

  public showTitle(): void {
    $('loading')?.classList.add('hidden');
    $('start-screen')?.classList.remove('hidden');
  }

  public hideTitle(): void { $('start-screen')?.classList.add('hidden'); }

  public showError(message: string): void {
    $('loading')?.classList.add('hidden');
    $('start-screen')?.classList.add('hidden');
    const e = $('error-screen');
    const m = $('error-message');
    if (m) m.textContent = message;
    e?.classList.remove('hidden');
  }

  public setPaused(paused: boolean): void {
    $('pause-menu')?.classList.toggle('hidden', !paused);
  }

  public setSettings(volume: number, quality: Quality): void {
    const vol = $('volume') as HTMLInputElement | null;
    if (vol) vol.value = String(Math.round(volume * 100));
    const q = $('quality') as HTMLSelectElement | null;
    if (q) q.value = quality;
  }

  /** Thoughts queue so two triggered close together are both read. */
  public showThought(text: string, durationMs = 4800): void {
    const now = performance.now();
    if (now < this.thoughtBusyUntil) {
      if (!this.thoughtQueue.includes(text)) this.thoughtQueue.push(text);
      return;
    }
    this.displayThought(text, durationMs);
  }

  private displayThought(text: string, durationMs: number): void {
    if (!this.thoughtBox) return;
    if (this.thoughtTimeout) clearTimeout(this.thoughtTimeout);
    this.thoughtBox.textContent = text;
    this.thoughtBox.classList.add('visible');
    this.thoughtBusyUntil = performance.now() + durationMs * 0.75;
    this.thoughtTimeout = setTimeout(() => {
      this.thoughtBox?.classList.remove('visible');
      const next = this.thoughtQueue.shift();
      if (next) setTimeout(() => this.displayThought(next, durationMs), 700);
    }, durationMs);
  }

  public clearThoughts(): void {
    this.thoughtQueue = [];
    this.thoughtBusyUntil = 0;
    if (this.thoughtTimeout) clearTimeout(this.thoughtTimeout);
    this.thoughtBox?.classList.remove('visible');
  }

  // Touch wording for the same hints: label shown on the control, and the instruction
  private static readonly TOUCH_HINTS: Record<string, [string, string?]> = {
    'W A S D': ['stick', 'drag on the left to walk'],
    'Shift': ['stick', 'push the stick to its edge to run'],
    'C': ['stick', 'push the stick lightly to walk slowly — and close your hand'],
    'Space': ['climb'],
    'F': ['flame', 'tap to open your hand'],
    'R': ['flame', 'tap to gather the fire, hold to let it go'],
    'Q': ['phase', 'hold to phase'],
    'T': ['shift', 'tap shift'],
    'E': ['look'],
    'A': ['stick', 'walk into the wall']
  };
  private touchMode = false;

  private inVoid = false;
  /** Void: the HUD text gains a dark ground (it may sit over the white). */
  public setVoid(on: boolean): void {
    if (on === this.inVoid) return;
    this.inVoid = on;
    document.body.classList.toggle('in-void', on);
  }

  public setTouchMode(on: boolean): void {
    if (on === this.touchMode) return;
    this.touchMode = on;
    document.body.classList.toggle('touch-mode', on);
  }

  public setRotatePrompt(show: boolean): void { $('rotate-prompt')?.classList.toggle('hidden', !show); }

  public showNotice(text: string): void {
    const n = $('notice');
    if (n) { n.textContent = text; n.classList.add('visible'); }
  }
  public hideNotice(): void { $('notice')?.classList.remove('visible'); }

  /** A quiet contextual control hint, e.g. "[F] open your hand". */
  public showHint(key: string, text: string, durationMs = 5000): void {
    if (!this.hint) return;
    const t = this.touchMode ? InteractionHUD.TOUCH_HINTS[key] : undefined;
    if (t) { key = t[0]; text = t[1] ?? text; }
    if (this.hintTimeout) clearTimeout(this.hintTimeout);
    this.hint.innerHTML = `<kbd>${key}</kbd> ${text}`;
    this.hint.classList.add('visible');
    this.hintTimeout = setTimeout(() => this.hint?.classList.remove('visible'), durationMs);
  }

  public hideHint(): void {
    if (this.hintTimeout) clearTimeout(this.hintTimeout);
    this.hint?.classList.remove('visible');
  }

  /** 0 = clear, 1 = black. */
  public setFade(v: number, seconds = 0.6): void {
    if (!this.fade) return;
    this.fade.style.transitionDuration = `${seconds}s`;
    this.fade.style.opacity = String(v);
  }

  public showEnd(): void { $('end-screen')?.classList.add('visible'); }
  public hideEnd(): void { $('end-screen')?.classList.remove('visible'); }
}
