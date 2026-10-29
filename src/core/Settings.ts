import type { Quality } from '../graphics/PostFX';

export interface SettingsData { volume: number; quality: Quality; }

const KEY = 'fractured-world.settings';
const DEFAULTS: SettingsData = { volume: 0.8, quality: 'medium' };

/** Per-browser preferences. Storage may be unavailable; defaults always work. */
export class Settings {
  public data: SettingsData = { ...DEFAULTS };
  /** True when the player has saved preferences on this device (otherwise defaults apply). */
  public saved = false;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        this.saved = true;
        const parsed = JSON.parse(raw) as Partial<SettingsData>;
        if (typeof parsed.volume === 'number') this.data.volume = Math.min(1, Math.max(0, parsed.volume));
        if (parsed.quality === 'low' || parsed.quality === 'medium' || parsed.quality === 'high') this.data.quality = parsed.quality;
      }
    } catch { /* private mode or blocked storage: keep defaults */ }
  }

  public save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
}
