export type FootSurface = 'soil' | 'gravel' | 'phase';

export interface AudioFrame {
  wind: number;      // 0..1 zone wind amount
  space: number;     // 0..1 how large the space sounds
  phase: number;     // 0..1 phase progress
  fire: number;      // 0..1 fire presence
  charge: number;    // 0..1
  voidAmt: number;   // 0..1 the world resolved into Void
  deranged: number;  // 0..1 the world resolved into Deranged
}

/**
 * Procedural WebAudio soundscape. Nothing is sampled: wind, footsteps, rail
 * resonance, fire and phase tones are synthesised from oscillators and one
 * shared noise buffer. Everything routes through a master gain so volume and
 * pause are global. If WebAudio is unavailable the game runs silently.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambBus!: GainNode;
  private ambFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private spaceIn!: GainNode;
  private spaceWet!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private whistleGain!: GainNode;
  private fireGain!: GainNode;
  private volume = 0.8;
  private creakTimer = 9;
  private crackleTimer = 0;
  private thumpTimer = 20;
  private lastFrame: AudioFrame = { wind: 1, space: 0.1, phase: 0, fire: 0, charge: 0, voidAmt: 0, deranged: 0 };

  public get available(): boolean { return this.ctx !== null; }

  public init(volume: number): void {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.volume = volume;
      this.master = ctx.createGain();
      this.master.gain.value = volume;
      this.master.connect(ctx.destination);
      this.ambFilter = ctx.createBiquadFilter();
      this.ambFilter.type = 'lowpass';
      this.ambFilter.frequency.value = 16000;
      this.ambBus = ctx.createGain();
      this.ambBus.connect(this.ambFilter).connect(this.master);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);

      // A feedback delay stands in for the size of the space
      this.spaceIn = ctx.createGain();
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.23;
      const fb = ctx.createGain();
      fb.gain.value = 0.42;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2000;
      this.spaceWet = ctx.createGain();
      this.spaceWet.gain.value = 0.15;
      this.spaceIn.connect(delay);
      delay.connect(damp).connect(fb).connect(delay);
      damp.connect(this.spaceWet).connect(this.master);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.startWind();
      this.startFireLoop();
      this.startLightVoice();
    } catch (e) {
      console.warn('Audio unavailable; continuing without sound', e);
      this.ctx = null;
    }
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    if (!loop) src.loopStart = 0;
    return src;
  }

  private startWind(): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(true);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.ambBus);
    // Slow gusts
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 180;
    lfo.connect(lfoAmt).connect(this.windFilter.frequency);
    lfo.start();
    // A thin whistle that comes and goes
    const src2 = this.noiseSource(true);
    const whistle = ctx.createBiquadFilter();
    whistle.type = 'bandpass';
    whistle.frequency.value = 1750;
    whistle.Q.value = 9;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    src2.connect(whistle).connect(this.whistleGain).connect(this.ambBus);
    src.start();
    src2.start(0, 0.7);
  }

  // The moving light's voice: two faint tones with a slow tremolo, placed by direction
  private lightGain!: GainNode;
  private lightPan!: StereoPannerNode;
  private startLightVoice(): void {
    const ctx = this.ctx!;
    this.lightGain = ctx.createGain();
    this.lightGain.gain.value = 0;
    this.lightPan = ctx.createStereoPanner();
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.37;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.4;
    lfo.connect(lfoAmt).connect(trem.gain);
    for (const [f, a] of [[830.6, 1], [1244.5, 0.45]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(trem);
      o.start();
    }
    trem.connect(this.lightGain).connect(this.lightPan).connect(this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = 0.9;
    this.lightPan.connect(send).connect(this.spaceIn);
    lfo.start();
  }

  /** gain 0..1 (by distance and visibility), pan -1..1 (direction relative to the camera). */
  public setLightVoice(gain: number, pan: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.lightGain.gain.setTargetAtTime(0.006 * gain, now, 0.4);
    this.lightPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.3);
  }

  private startFireLoop(): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.9;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    src.connect(bp).connect(this.fireGain).connect(this.sfxBus);
    src.start(0, 1.1);
  }

  public setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  public suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); }
  public resume(): void { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); }

  public update(dt: number, f: AudioFrame): void {
    this.lastFrame = f;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // The Void is nearly silent; that silence is the event
    this.windGain.gain.setTargetAtTime(0.11 * f.wind * (1 - f.phase * 0.6) * (1 - f.voidAmt * 0.9), now, 0.6);
    this.whistleGain.gain.setTargetAtTime(0.012 * f.wind * (0.5 + 0.5 * Math.sin(now * 0.13)), now, 1.2);
    this.spaceWet.gain.setTargetAtTime(0.1 + f.space * 0.55 + f.deranged * 0.25, now, 0.8);
    // Phasing muffles the world, as if heard through a wall
    this.ambFilter.frequency.setTargetAtTime(16000 - f.phase * 15100, now, 0.12);
    this.fireGain.gain.setTargetAtTime(f.fire * (0.022 + f.charge * 0.03), now, 0.08);

    if (f.fire > 0.1) {
      this.crackleTimer -= dt;
      if (this.crackleTimer <= 0) {
        this.crackleTimer = 0.05 + Math.random() * 0.22 * (1 - f.charge * 0.6);
        this.crackle(f.fire * (0.6 + f.charge));
      }
    }
    this.creakTimer -= dt;
    if (this.creakTimer <= 0) {
      this.creakTimer = 14 + Math.random() * 22;
      this.railCreak(Math.random() * 2 - 1);
    }
    if (f.space > 0.4) {
      this.thumpTimer -= dt;
      if (this.thumpTimer <= 0) {
        this.thumpTimer = 18 + Math.random() * 20;
        this.distantThump();
      }
    }
  }

  private env(g: GainNode, t0: number, attack: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private burst(filterType: BiquadFilterType, freq: number, q: number, peak: number, dur: number,
                pan = 0, send = 0, at = 0): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + at;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.sfxBus);
    if (send > 0) { const s = ctx.createGain(); s.gain.value = send; p.connect(s).connect(this.spaceIn); }
    this.env(g, t0, 0.004, peak, dur);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, peak: number, attack: number, dur: number,
               pan = 0, send = 0, bus: GainNode | null = null, at = 0): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + attack + dur);
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(bus ?? this.sfxBus);
    if (send > 0) { const s = ctx.createGain(); s.gain.value = send; p.connect(s).connect(this.spaceIn); }
    this.env(g, t0, attack, peak, dur);
    o.start(t0);
    o.stop(t0 + attack + dur + 0.05);
  }

  public footstep(surface: FootSurface, intensity: number): void {
    if (!this.ctx) return;
    const v = 0.4 + intensity * 0.6;
    const send = 0.25 + this.lastFrame.space * 0.6;
    const pan = (Math.random() - 0.5) * 0.15;
    if (surface === 'gravel') {
      this.burst('bandpass', 2300 + Math.random() * 900, 0.8, 0.12 * v, 0.09, pan, send);
      this.burst('bandpass', 3800, 1.2, 0.05 * v, 0.05, pan, 0, 0.025);
    } else if (surface === 'soil') {
      this.burst('lowpass', 650 + Math.random() * 200, 0.7, 0.16 * v, 0.12, pan, send * 0.6);
    } else {
      // On phase ground the step is a soft, slightly wrong tone
      this.tone('sine', 640 + Math.random() * 40, 600, 0.035 * v, 0.005, 0.25, pan, send);
      this.burst('highpass', 5000, 0.7, 0.02 * v, 0.04, pan, 0);
    }
  }

  private crackle(amount: number): void {
    this.burst('highpass', 2800 + Math.random() * 3000, 0.9, 0.025 * amount, 0.018 + Math.random() * 0.02, (Math.random() - 0.5) * 0.2);
  }

  // Metal under strain, with inharmonic partials; its apparent side is not always its source
  private railCreak(pan: number): void {
    if (!this.ctx) return;
    const base = 170 + Math.random() * 90;
    for (const [mul, amp] of [[1, 0.03], [2.76, 0.016], [5.4, 0.008]]) {
      this.tone('sine', base * mul, base * mul * 0.94, amp, 0.25, 2.6, pan, 0.8);
    }
  }

  private distantThump(): void {
    this.tone('sine', 58, 42, 0.07, 0.01, 1.4, (Math.random() - 0.5) * 1.6, 0.9);
  }

  public summon(): void {
    if (!this.ctx) return;
    this.burst('bandpass', 900, 1.5, 0.05, 0.4);
    this.tone('sine', 330, 440, 0.03, 0.15, 0.5, 0.1, 0.3);
  }

  public dismiss(): void {
    if (!this.ctx) return;
    this.burst('lowpass', 500, 0.7, 0.05, 0.35);
    this.tone('sine', 440, 280, 0.02, 0.02, 0.45);
  }

  public pulse(strength: number): void {
    if (!this.ctx) return;
    this.tone('sine', 72, 40, 0.14 * (0.5 + strength), 0.01, 0.8, 0, 0.6);
    this.burst('highpass', 4200, 0.6, 0.05 * (0.5 + strength), 0.7, 0, 0.5);
  }

  public phaseEnter(): void {
    if (!this.ctx) return;
    // An inharmonic chord with a slow attack, routed dry so it is not muffled
    for (const [f, a] of [[523, 0.03], [741, 0.022], [1109, 0.014], [1567, 0.008]]) {
      this.tone('sine', f, f * 1.01, a, 0.2, 1.4, (Math.random() - 0.5) * 0.4, 0.7);
    }
  }

  public phaseExit(): void {
    if (!this.ctx) return;
    for (const [f, a] of [[1109, 0.02], [741, 0.018], [494, 0.02]]) {
      this.tone('sine', f, f * 0.97, a, 0.03, 0.8, 0, 0.5);
    }
  }

  public refused(): void {
    if (!this.ctx) return;
    this.tone('sine', 220, 200, 0.03, 0.02, 0.5);
  }

  public fall(): void {
    if (!this.ctx) return;
    this.burst('lowpass', 1400, 0.7, 0.1, 0.9, 0, 0.8);
    this.tone('sine', 300, 70, 0.05, 0.05, 0.9, 0, 0.6);
  }

  public inspect(): void {
    if (!this.ctx) return;
    this.tone('triangle', 196, 196, 0.02, 0.05, 0.9, 0, 0.4);
  }

  /** One accepted flame tap; pitch rises with the gathered charge. */
  public chargeTick(level: number): void {
    if (!this.ctx) return;
    this.tone('sine', 420 + level * 360, 440 + level * 380, 0.03, 0.005, 0.12);
    this.crackle(0.8 + level);
  }

  public hop(): void {
    if (!this.ctx) return;
    this.burst('lowpass', 900, 0.7, 0.05, 0.1);
  }

  public land(impact: number): void {
    if (!this.ctx) return;
    this.burst('lowpass', 500 + impact * 300, 0.7, 0.08 + impact * 0.12, 0.16, 0, 0.3);
  }

  /** Gravity turning toward a new surface: a low pressure change. */
  public gravityShift(): void {
    if (!this.ctx) return;
    this.tone('sine', 55, 82, 0.06, 0.15, 0.6, 0, 0.5);
    this.burst('bandpass', 300, 1.2, 0.04, 0.5, 0, 0.4);
  }

  /** The world refused a phase commit. */
  public strain(): void {
    if (!this.ctx) return;
    this.tone('sawtooth', 110, 104, 0.012, 0.05, 0.45, 0, 0.3);
    this.burst('bandpass', 2400, 6, 0.02, 0.3);
  }

  public houndWake(pan: number): void {
    if (!this.ctx) return;
    this.tone('sawtooth', 62, 48, 0.035, 0.2, 1.1, pan, 0.6);
    this.burst('lowpass', 260, 0.8, 0.06, 0.8, pan, 0.5);
  }

  public houndRun(pan: number): void {
    if (!this.ctx) return;
    this.burst('lowpass', 420, 0.9, 0.06, 0.07, pan, 0.2);
  }

  public drifterScatter(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 5; i++) this.burst('bandpass', 1800 + i * 500, 2, 0.02, 0.05, (Math.random() - 0.5), 0.3, i * 0.04);
  }

  public ending(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0, now, 2.5);
    this.whistleGain.gain.setTargetAtTime(0, now, 2.5);
    for (const [f, a] of [[220, 0.03], [329.6, 0.022], [415.3, 0.016], [554, 0.01]]) {
      this.tone('sine', f, f, a, 2.5, 6, 0, 0.8);
    }
  }
}
