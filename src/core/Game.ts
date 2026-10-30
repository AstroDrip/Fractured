import { Engine, Scene, Vector3, Vector2, Matrix, StandardMaterial, PBRMaterial, Material, LinesMesh, Color3 } from '@babylonjs/core';
import type { WalkGrid } from '../world/WalkGrid';
import { InputManager } from './InputManager';
import { CameraController } from './CameraController';
import { RealityController } from './RealityController';
import { PhaseSystem } from './PhaseSystem';
import { AudioSystem, FootSurface } from './AudioSystem';
import { Settings } from './Settings';
import { Wind } from './Wind';
import { damp, smoothstep } from './rng';
import type { RealityId } from './Reality';
import { Player } from '../entities/Player';
import { PlayerController } from '../entities/PlayerController';
import { HOUND } from '../entities/Creatures';
import type { BeingContext } from '../entities/Creatures';
import { PalmFire } from '../graphics/PalmFire';
import { FieldContext } from '../graphics/ParticleField';
import { Atmosphere } from '../graphics/Atmosphere';
import { PostFX, Quality } from '../graphics/PostFX';
import { RealityFX, RealityPlugin, voidWhite } from '../graphics/RealityPlugin';
import { World } from '../world/World';
import { ChapterOne } from '../world/ChapterOne';
import { Surface } from '../world/WalkGrid';
import { InteractionHUD } from '../ui/InteractionHUD';
import { TouchControls } from '../ui/TouchControls';
import { VortexDebris } from '../graphics/VortexDebris';
import type { FlameContact } from './FlameTiers';
import { SkinnedBody } from '../entities/SkinnedBody';
import protagonistUrl from '../../assets/game/character/protagonist.glb?url';
import { FlameTapCharger } from './FlameTapCharger';
import { TOUCH } from './controls';
import { START, START_YAW, BARRIER, POIS, GROUND_Y, TRACK_END_Z, BED_Y, LAMP, TRACK_HALF_WIDTH, VILLAGE, CUTTING, FOREST, RIFT, riftHeight, GRAVITY_SURFACES, realityRegionAt, ANCHOR, ATTUNE, WALL_ANCHOR, vantageAt } from '../world/layout';

const REVEAL_RELEASE_Z = 117;  // the reveal hands back here (just before the sleeper pile), or after its hold
const PUSH_TIME = 0.4;        // seconds: returning matter pushes the protagonist out
const MAX_LIGHTS_PER_MATERIAL = 6;   // sky, moon, palm fire, thrown ember, lamp
const STEP = 1 / 60;          // fixed simulation step
const MAX_STEPS = 4;          // clamp catch-up after a stall

export type GameState = 'loading' | 'title' | 'playing' | 'paused' | 'ending' | 'ended' | 'error';

// Yield between loading steps so the progress bar paints. A timer (not rAF) keeps
// loading moving even if the tab is in the background.
const nextFrame = () => new Promise<void>(r => setTimeout(r, 16));

/**
 * Application root: builds the world, owns the state machine and runs a fixed-step
 * simulation. Per step: intent (fire, phase, inspect) -> phase state machine with
 * safety checks -> movement controller (ground / air / vault / wall) -> recovery ->
 * story -> animation -> flame, phase geometry, anomalies, creatures, wind, light ->
 * camera -> atmosphere -> post -> audio. Rendering happens once per display frame.
 */
/**
 * Nearest place within 3 m where the protagonist can stand in `reality`: rings of
 * 0.25 m, 24 directions each. Null if none (the caller then leaves things as they are).
 */
export function nearestFree(grid: WalkGrid, at: Vector3, reality: RealityId): Vector3 | null {
  const p = new Vector3();
  for (let r = 0.25; r <= 3.0001; r += 0.25) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      p.set(at.x + Math.cos(a) * r, at.y, at.z + Math.sin(a) * r);
      if (grid.canStand(p, reality)) return p.clone();
    }
  }
  return null;
}

export class Game {
  public state: GameState = 'loading';
  private canvas: HTMLCanvasElement;
  private engine!: Engine;
  private scene!: Scene;
  private hud = new InteractionHUD();
  private settings = new Settings();
  private audio = new AudioSystem();
  private wind = new Wind();
  private input!: InputManager;
  private cam!: CameraController;
  private phase = new PhaseSystem();
  private realities = new RealityController();
  private linesVoid = 0;
  private anchorHold = 0;
  private lineColors = new Map<LinesMesh, Color3>();
  private static readonly TRACE_DARK = new Color3(0.08, 0.08, 0.085);
  private world!: World;
  private player!: Player;
  private ctrl!: PlayerController;
  private fire!: PalmFire;
  private atmos!: Atmosphere;
  private post!: PostFX;
  private chapter!: ChapterOne;
  private ctx: FieldContext = { time: 0, dt: 0, fire: new Vector3(), fireStrength: 0, phase: 0, player: new Vector3(), wind: new Vector3() };
  private debris!: VortexDebris;
  private beingCtx!: BeingContext;
  private time = 0;
  private acc = 0;
  private recover = { active: false, t: 0, target: new Vector3(), segment: 0, stumble: 0, reason: 'fall' as 'fall' | 'caught' };
  private ending = { t: 0, cut: false };
  private push = { active: false, t: 0, from: new Vector3(), to: new Vector3() };
  private readonly palmPos = new Vector3();
  private readonly clothWind = new Vector3();
  private readonly fireUV = new Vector2(0.5, 0.5);
  private readonly projected = new Vector3();
  private readonly anchorBuf: Vector3[] = [];
  private readonly anchorsAll: Vector3[] = [];
  private readonly tmp = new Vector3();
  private voidAmt = 0;
  private derangedAmt = 0;
  private lastSolid = false;
  private lastAnomalyFocus: Vector3 | null = null;
  private houndStepTimer = 0;
  private stepIndex = 0;
  private touch!: TouchControls;
  private tapCharger = new FlameTapCharger();
  // Phone-class device: touch capable and a small screen. Desktop behaviour is unchanged.
  private readonly mobile = TouchControls.capable() && Math.min(screen.width, screen.height) <= 900;
  private orientationPaused = false;
  private resizePending = false;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.boot().catch((e) => this.fail(e));
  }

  private fail(e: unknown): void {
    console.error(e);
    this.state = 'error';
    const msg = e instanceof Error ? e.message : String(e);
    this.hud.showError(`The world failed to load. ${msg}`);
  }

  private async boot(): Promise<void> {
    try {
      this.engine = new Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, true);
    } catch {
      throw new Error('WebGL is not available in this browser.');
    }
    if (!this.engine.webGLVersion) throw new Error('WebGL is not available in this browser.');
    this.scene = new Scene(this.engine);
    this.scene.onNewMaterialAddedObservable.add((m) => {
      if (m instanceof StandardMaterial) m.maxSimultaneousLights = MAX_LIGHTS_PER_MATERIAL;
    });
    this.scene.skipPointerMovePicking = true;
    this.setupViewport();

    this.atmos = new Atmosphere(this.scene);
    this.cam = new CameraController(this.scene);
    this.input = new InputManager(this.canvas, this.scene, () => this.cam.camera);
    this.touch = new TouchControls(this.input, this.canvas);
    this.touch.onPause = () => this.setPaused(true);
    if (this.mobile && !this.settings.saved) this.settings.data.quality = TouchControls.capable() && Game.lowEndDevice() ? 'low' : 'medium';
    this.world = new World(this.scene);
    const steps = this.world.buildSteps();
    for (let i = 0; i < steps.length; i++) {
      this.hud.setLoading(i / (steps.length + 2), steps[i].label);
      await nextFrame();
      await steps[i].run();
    }
    this.hud.setLoading(steps.length / (steps.length + 2), 'the hooded figure');
    await nextFrame();
    this.player = new Player(this.scene, this.world.mats);
    this.ctrl = new PlayerController(this.world.grid, this.player, this.cam);
    this.fire = new PalmFire(this.scene);
    this.debris = new VortexDebris(this.scene, this.wind.vortex);
    this.chapter = new ChapterOne(this.hud, this.audio);
    this.post = new PostFX(this.scene, this.cam.camera);
    // Everything else that draws the world (the figure, creatures, water, lamps, the vista)
    // also goes black / silhouetted in Void, but keeps its matter
    const voidOnly = (m: Material) => {
      if (!(m instanceof StandardMaterial || m instanceof PBRMaterial) || m.pluginManager?.getPlugin('RealityFX')) return;
      if (/^(fire|ember|palmFire)/i.test(m.name)) return;
      new RealityPlugin(m, 0, /^riftVoidDeck$/.test(m.name) ? 1 : 0, false);
    };
    this.scene.materials.forEach(voidOnly);
    this.scene.onNewMaterialAddedObservable.add(voidOnly);
    this.cam.setOccluders(this.world.occluders());
    this.atmos.setShadowCasters([...this.world.shadowCasters(), ...this.player.meshes]);
    // The authored skinned body; the procedural figure stays if it cannot be loaded
    try {
      const body = await SkinnedBody.load(this.scene, protagonistUrl, this.player.root);
      this.player.attachSkinned(body, this.world.mats);
      this.atmos.addShadowCasters(body.meshes);
    } catch (e) {
      console.warn('Skinned protagonist unavailable; using the procedural figure.', e);
    }
    this.beingCtx = {
      dt: 0, time: 0, player: this.ctrl.pos, playerSpeed: 0, fireOn: false, firePos: this.fire.position,
      reality: 'normal', voidAmt: 0, derangedAmt: 0, transitioning: false, camera: this.cam.camera, playerHeight: 0
    };
    const shadowsReady = this.applyQuality(this.settings.data.quality);
    this.wireEvents();
    this.resetChapter(false);

    this.hud.setLoading((steps.length + 1) / (steps.length + 2), 'compiling shaders');
    await Promise.race([
      Promise.all([this.scene.whenReadyAsync(), shadowsReady]),
      new Promise(r => setTimeout(r, 15000))
    ]);
    this.hud.setLoading(1, 'ready');
    this.checkOrientation();
    this.hud.setSettings(this.settings.data.volume, this.settings.data.quality);
    this.state = 'title';
    this.hud.showTitle();
    this.hud.setFade(0.55, 0.1);

    let last = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try {
        this.frame(dt);
      } catch (e) {
        this.engine.stopRenderLoop();
        this.fail(e);
      }
    });
  }

  private wireEvents(): void {
    this.hud.onStart = () => {
      this.audio.init(this.settings.data.volume);
      if (this.mobile) Game.requestLandscape();
      this.hud.hideTitle();
      this.state = 'playing';
      this.hud.setFade(0, 3.5);
      this.cam.beginIntro();
    };
    this.hud.onResume = () => { this.orientationPaused = false; this.setPaused(false); };
    this.hud.onRestart = () => {
      this.hud.hideEnd();
      this.hud.setPaused(false);
      this.audio.resume();
      this.resetChapter(true);
      this.state = 'playing';
    };
    this.hud.onVolume = (v) => { this.settings.data.volume = v; this.settings.save(); this.audio.setVolume(v); };
    this.hud.onQuality = (q) => { this.settings.data.quality = q; this.settings.save(); void this.applyQuality(q); };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.setPaused(true);
    });

    const w = this.world;
    this.fire.onSummon = () => { this.audio.summon(); this.chapter.onFireSummoned(); };
    this.fire.onDismiss = () => this.audio.dismiss();
    this.fire.onGuttered = () => this.chapter.onGuttered();
    this.fire.onRefusedSummon = () => this.audio.refused();
    this.fire.contact = (p, r) => this.flameContact(p, r);
    this.fire.onImpact = (at, hit, spec) => {
      if (hit === 'water') { this.audio.hiss(spec.charge); this.world.cutting.disturb(at.x, at.z, spec.charge); }
      else {
        this.world.debris.burst(at, spec, this.phase.reality);
        if (this.world.yard.onImpact(at, spec)) this.chapter.onAshCleared();
      }
    };
    this.fire.onPulse = (p) => {
      this.audio.pulse(p.strength);
      this.cam.addShake(0.04 + p.strength * 0.05);
      if (w.anomalies.onPulse(p)) this.chapter.onReveal();
      if (w.drifters.hit(p.pos, p.radius * 0.6 + 1)) { this.audio.drifterScatter(); this.chapter.onDriftersScattered(); }
      if (w.hound.hit(p.pos, Math.max(3.5, p.radius * 0.6))) this.chapter.onHoundRepelled();
    };
    w.drifters.onScattered = (at) => w.phaseGeom.reveal(at, 6);
    w.hound.onWake = () => { this.audio.houndWake(this.panOf(w.hound.pos)); this.chapter.onHoundWake(); };
    w.hound.onCatch = () => this.beginRecovery(new Vector3(HOUND.checkpoint.x, GROUND_Y, HOUND.checkpoint.z), 0, 'caught');

    this.phase.canStandIn = (r: RealityId) => this.ctrl.onWall ? r === 'deranged' : this.world.grid.canStand(this.ctrl.pos, r);
    // Leaving is refused (the phase holds) on a face, and while matter that exists in the
    // reality being returned to would close around the protagonist. Leaving over empty
    // ground (the Void spans) is still allowed: that is a fall with its own recovery.
    this.phase.mustHold = () => this.ctrl.onWall || this.world.grid.insideActiveObstacle(this.ctrl.pos, 'normal') !== null ||
      // Ground that exists only in Deranged (the first anchor's ledge): Normal waits until they step off
      (this.phase.target === 'deranged' && !this.world.grid.canStand(this.ctrl.pos, 'normal'));
    // The world shudders as a phase begins (and a little as it lets go)
    this.phase.onEnterStart = () => { this.audio.phaseEnter(); this.post.triggerRing(this.fireUV, 1); this.cam.addShake(0.22); };
    this.phase.onLeaveStart = () => { this.audio.phaseExit(); this.post.triggerRing(this.fireUV, 0.55); this.cam.addShake(0.1); };
    this.phase.onRefused = () => { this.audio.refused(); this.chapter.onRefused(this.fire.isPresent); };
    // A reality that cannot be entered here answers quietly: a sound and a small strain, no message
    this.realities.onRefused = (why) => {
      this.audio.refused(); this.phase.strain = Math.max(this.phase.strain, 0.5);
      if (why === 'no-flame') this.chapter.onRefused(this.fire.isPresent);
    };
    this.realities.onUnlocked = (stage) => this.chapter.onDerangedUnlocked(stage);
    this.realities.onRegionEnded = () => this.chapter.onDerangedLost();
    this.phase.onRejected = (enter) => {
      this.audio.strain();
      this.chapter.onRejected(enter, this.ctrl.onWall, !enter && !this.ctrl.onWall);
    };

    this.ctrl.onJump = () => this.audio.hop();
    this.ctrl.onVault = () => this.audio.hop();
    this.ctrl.onLand = (impact) => { this.audio.land(impact); if (impact > 0.6) this.cam.addShake(0.05); };
    this.ctrl.onEnterWall = () => { this.audio.gravityShift(); this.chapter.onWallEnter(); };
    this.ctrl.onLeaveWall = () => { this.audio.gravityShift(); this.chapter.onWallLeave(); };
    this.player.groundAt = (x, z) => this.world.grid.heightAt(x, z);
    this.player.onFootstep = (_foot, intensity) => {
      const p = this.ctrl.pos;
      const s = this.ctrl.onWall ? Surface.STONE : this.world.grid.surfaceAt(p.x, p.z);
      const surf: FootSurface = s === Surface.GRAVEL ? 'gravel' : s === Surface.PHASE ? 'phase'
        : s === Surface.STONE ? 'stone' : s === Surface.WOOD ? 'wood' : 'soil';
      this.audio.footstep(surf, intensity);
    };
  }

  private applyQuality(q: Quality): Promise<void> {
    // Phones: fewer particles and shadows only on High; desktop values are unchanged
    const level = (q === 'low' ? 0.35 : q === 'medium' ? 0.7 : 1) * (this.mobile ? 0.75 : 1);
    this.post.setQuality(q);
    this.applyResolution(q);
    const shadowSize = this.mobile ? (q === 'high' ? 1024 : 0) : (q === 'high' ? 2048 : q === 'medium' ? 1024 : 0);
    const shadowsReady = this.atmos.setShadowQuality(shadowSize as 0 | 1024 | 2048);
    this.fire.setQuality(level);
    this.debris.setQuality(level);
    this.world.anomalies.setQuality(level);
    this.world.phaseGeom.residue.setQuality(0.4 + level * 0.6);
    this.world.fog.setQuality(level);
    this.world.vista.falls.setQuality(0.4 + level * 0.6);
    return shadowsReady;
  }

  /**
   * Render resolution. Desktop: CSS pixels (Low renders at 1/1.4), exactly as before.
   * Phones: device pixels capped per quality, so a 3x screen does not render at 3x.
   */
  private applyResolution(q: Quality): void {
    let level: number;
    if (this.mobile) {
      const cap = q === 'low' ? 1.0 : q === 'medium' ? 1.3 : 1.75;
      level = 1 / Math.min(window.devicePixelRatio || 1, cap);
      if (q === 'low') level *= 1.15;
    } else {
      level = q === 'low' ? 1.4 : 1;
    }
    this.engine.setHardwareScalingLevel(level);
  }

  private static lowEndDevice(): boolean {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || (navigator.hardwareConcurrency || 8) <= 4;
  }

  /** Best effort: fullscreen and a landscape lock where the browser allows it. */
  private static requestLandscape(): void {
    const el = document.documentElement as HTMLElement & { requestFullscreen?: (o?: FullscreenOptions) => Promise<void> };
    const lock = () => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (o && o.lock) o.lock('landscape').catch(() => undefined);
    };
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => undefined);
    else lock();
  }

  // Resize, rotation, browser UI changes, portrait fallback, graphics context loss
  private setupViewport(): void {
    const onResize = () => {
      if (this.resizePending) return;
      this.resizePending = true;
      requestAnimationFrame(() => {
        this.resizePending = false;
        this.engine.resize();
        this.checkOrientation();
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    this.engine.onContextLostObservable.add(() => {
      this.setPaused(true);
      this.hud.showNotice('The picture was interrupted. Restoring…');
    });
    this.engine.onContextRestoredObservable.add(() => this.hud.hideNotice());
  }

  /** Phones in portrait: ask for landscape and hold the game until then. */
  private checkOrientation(): void {
    const portrait = this.mobile && window.innerHeight > window.innerWidth * 1.05;
    this.hud.setRotatePrompt(portrait);
    if (portrait && this.state === 'playing') {
      this.orientationPaused = true;
      this.setPaused(true);
    } else if (!portrait && this.orientationPaused) {
      this.orientationPaused = false;
      this.setPaused(false);
    }
  }

  private setPaused(paused: boolean): void {
    if (paused && this.state === 'playing') {
      this.state = 'paused';
      this.audio.suspend();
      this.touch.releaseAll();
      this.input.releaseAll();
      this.hud.setPaused(true);
    } else if (!paused && this.state === 'paused') {
      this.state = 'playing';
      this.audio.resume();
      this.hud.setPaused(false);
    }
  }

  private resetChapter(withFade: boolean): void {
    const start = new Vector3(START.x, GROUND_Y, START.z);
    this.ctrl.teleport(start);
    this.player.setYaw(START_YAW);
    this.phase.reset();
    this.realities.reset();
    this.fire.reset();
    this.chapter.reset();
    const w = this.world;
    w.anomalies.reset(); w.phaseGeom.reset(); w.light.reset();
    w.watcher.reset(); w.drifters.reset(); w.hound.reset();
    this.recover.active = false;
    this.recover.stumble = 0;
    this.ending.t = 0; this.ending.cut = false;
    this.push.active = false;
    this.debris.clear();
    this.world.debris.clear();
    this.world.yard.reset();
    this.tapCharger.reset();
    this.touch.releaseAll();
    this.voidAmt = 0; this.derangedAmt = 0;
    this.hud.clearThoughts();
    this.hud.hideHint();
    this.cam.snapTo(start);
    this.cam.setDistance(this.cam.baseDistance);
    w.props.lampLight.intensity = 0;
    if (withFade) {
      this.hud.setFade(1, 0.01);
      setTimeout(() => this.hud.setFade(0, 3), 60);
      this.cam.beginIntro();
    }
  }

  // --- Frame ----------------------------------------------------------------

  private frame(dt: number): void {
    this.input.poll();
    if (this.input.wasPressed('pause')) {
      if (this.state === 'playing') this.setPaused(true);
      else if (this.state === 'paused') this.setPaused(false);
    }
    if (this.state === 'playing' || this.state === 'ending' || this.state === 'title') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS) {
        this.simulate(STEP, this.state === 'playing', n === 0);
        this.acc -= STEP;
        n++;
      }
      if (n === MAX_STEPS) this.acc = 0;
    }
    this.updatePerf();
    this.updateTouchView();
    this.input.endFrame();
    this.scene.render();
  }

  // ?perf in the URL: frame time, FPS, draw calls, active meshes and triangles, twice a second
  private perfEl: HTMLDivElement | null = typeof location !== 'undefined' && /[?&]perf\b/.test(location.search) ? (() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;font:11px monospace;color:#9ab;background:rgba(0,0,0,.55);padding:4px 6px;pointer-events:none;white-space:pre';
    document.body.appendChild(el); return el;
  })() : null;
  private perfT = 0;
  private updatePerf(): void {
    if (!this.perfEl) return;
    const now = performance.now();
    if (now - this.perfT < 500) return;
    this.perfT = now;
    const e = this.engine as unknown as { _drawCalls?: { current: number } };
    const active = this.scene.getActiveMeshes();
    let tris = 0;
    for (let i = 0; i < active.length; i++) tris += active.data[i].getTotalIndices() / 3 * Math.max(1, (active.data[i] as unknown as { thinInstanceCount?: number }).thinInstanceCount || 1);
    this.perfEl.textContent = `${(1000 / Math.max(1, this.engine.getFps())).toFixed(1)} ms  ${this.engine.getFps().toFixed(0)} fps\n` +
      `draws ${e._drawCalls ? e._drawCalls.current : '?'}  meshes ${active.length}  tris ${(tris / 1000).toFixed(0)}k\n` +
      `${this.engine.getRenderWidth()}x${this.engine.getRenderHeight()}  ${this.settings.data.quality}`;
  }

  /** The held touch available where the protagonist stands, if any (in Normal only). */
  private heldTouchHere(): { stage: 1 | 3; hold: number } | null {
    if (this.phase.state !== 'normal') return null;
    const p = this.ctrl.pos;
    const near = (t: { x: number; z: number; r: number }) => Math.hypot(p.x - t.x, p.z - t.z) < t.r;
    if (this.realities.stage < 1 && (near(ANCHOR.touch) || near(WALL_ANCHOR.touch))) return { stage: 1, hold: 0.5 };
    if (this.realities.stage < 3 && this.world.yard.cleared && !this.world.yard.pulled && near(ATTUNE.touch)) return { stage: 3, hold: 0.6 };
    return null;
  }

  // Touch controls appear only in play, only while touch is the device in use
  private updateTouchView(): void {
    const show = (this.state === 'playing' || this.state === 'paused') && this.input.lastDevice === 'touch';
    this.touch.setVisible(show && this.state === 'playing');
    this.hud.setTouchMode(this.input.lastDevice === 'touch');
    if (!show) return;
    this.touch.update({
      fireState: this.fire.state, charge: this.fire.charge, fuel: this.fire.fuel,
      canSummon: this.fire.fuel >= 0.15, phasing: this.phase.state !== 'normal' && this.phase.state !== 'locked',
      phaseRefused: !this.fire.isPresent && !this.ctrl.onWall,
      canExamine: this.chapter.examinable || this.heldTouchHere() !== null,
      shiftAvailable: this.realities.derangedAllowed(realityRegionAt(this.ctrl.pos.x, this.ctrl.pos.z)),
      shifted: this.realities.derangedOn
    });
  }

  /** One fixed simulation step. `first` is true for the first step of a display frame (edge inputs). */
  public simulate(dt: number, controllable: boolean, first = true): void {
    this.time += dt;
    const w = this.world;
    const c = this.ctrl;
    const inputLive = controllable && !this.recover.active && this.recover.stumble <= 0 && this.state !== 'ending';

    // Intent
    if (inputLive && first) {
      if (this.input.wasPressed('fire')) this.fire.toggle();
      if (this.input.wasReleased('gather')) this.fire.release();
      const click = this.input.consumeClick();
      if (click && this.fire.isPresent) this.fire.sendTo(click);
      if (this.input.wasPressed('inspect')) this.chapter.inspect();
      // Touch flame: a tap summons or adds charge; a long press lets it go, or closes the hand
      if (this.input.wasPressed('flameTap')) {
        if (!this.fire.isPresent) this.fire.summon();
        else if (this.tapCharger.accept(performance.now())) this.audio.chargeTick(this.fire.addCharge(TOUCH.flameTapCharge));
      }
      if (this.input.wasPressed('flameHold')) {
        if (this.fire.isPresent && this.fire.charge >= 0.2) this.fire.release();
        else if (this.fire.isPresent) this.fire.dismiss();
        this.tapCharger.reset();
      }
    } else if (first) {
      this.input.consumeClick();
    }
    if (inputLive && this.input.isHeld('gather')) this.fire.gather(dt);
    // Tap-gathered charge fades if left alone; it never exceeds the flame's own maximum
    if (this.tapCharger.shouldFade(performance.now()) && !this.input.isHeld('gather')) {
      this.fire.charge = Math.max(0, this.fire.charge - dt * 0.5);
      if (this.fire.charge === 0) this.tapCharger.reset();
    }

    // Held touches (a deliberate act, not contact): the fallen post finds Deranged (stage 1),
    // the yard's last lever attunes to it (stage 3). Each enters Deranged once, then the
    // shift works wherever regions allow it at that stage.
    const touch = this.heldTouchHere();
    this.anchorHold = touch && controllable && this.input.isHeld('inspect') ? this.anchorHold + dt : 0;
    if (touch && this.anchorHold >= touch.hold) {
      this.anchorHold = 0;
      if (this.fire.state === 'active' && this.fire.strength > 0.5 && this.fire.fuel > 0.15) {
        if (touch.stage === 3) { w.yard.pull(); this.cam.addShake(0.3); this.audio.phaseEnter(); }
        else this.cam.addShake(0.12);
        this.realities.unlock(touch.stage);
        this.realities.derangedOn = true;
      } else this.chapter.onRefused(this.fire.isPresent);
    }
    // Realities: the region decides what can be entered; progression what has been found.
    // Phase (hold) leads to Void, the shift (tap) toggles Deranged; one transition at a time.
    const region = realityRegionAt(c.pos.x, c.pos.z);
    this.fire.updateFuel(dt, this.phase.reality === 'void');
    // Hysteresis: entering needs a reserve; once there, the phase lasts until the flame goes out
    const fireReady = this.fire.state === 'active' && this.fire.strength > 0.5 &&
      (this.phase.isSolid ? this.fire.fuel > 0 : this.fire.fuel > 0.15);
    this.realities.step(dt, this.phase, region, {
      phaseHeld: controllable && this.input.isHeld('phase'),
      phasePressed: first && controllable && this.input.wasPressed('phase'),
      shiftPressed: first && controllable && this.input.wasPressed('shift'),
      ready: fireReady || c.onWall
    }, inputLive);
    // ...and keeps trembling until the new reality has settled
    if (this.phase.state === 'entering') this.cam.addShake(dt * 0.35);
    // The Void cannot be held without the flame
    if (this.phase.target === 'void' && this.phase.isSolid && !this.fire.isPresent) this.phase.lock();
    const reality = this.phase.reality;
    const solid = this.phase.isSolid;
    if (solid && !this.lastSolid) this.chapter.onPhaseSolid(c.pos, reality);
    this.lastSolid = solid;
    const amt = smoothstep(0.25, 0.85, this.phase.progress);
    const targetVoid = this.phase.target === 'void' ? amt : 0;
    const targetDer = this.phase.target === 'deranged' ? amt : 0;
    if (this.state !== 'ending') {
      this.voidAmt += (targetVoid - this.voidAmt) * damp(14, dt);
      this.derangedAmt += (targetDer - this.derangedAmt) * damp(14, dt);
    }

    // Movement
    c.update(dt, {
      x: this.input.moveVector.x, y: this.input.moveVector.y,
      // Touch: how far the stick is pushed picks the speed tier
      run: this.input.isHeld('run') || (this.input.lastDevice === 'touch' && this.input.moveMagnitude >= TOUCH.stickRun),
      slow: this.input.isHeld('slow') || this.input.padSlow || (this.input.lastDevice === 'touch' && this.input.moveMagnitude > 0 && this.input.moveMagnitude < TOUCH.stickSlow),
      jump: first && this.input.wasPressed('jump')
    }, reality, inputLive);
    this.updateRecovery(dt, reality);

    // Story and attention
    const speed = Math.hypot(c.vel.x, c.vel.z, c.onWall ? c.vel.y : 0);
    const story = this.chapter.update({
      dt, player: c.pos, moving: speed > 0.2, firePresent: this.fire.isPresent, fireStrength: this.fire.strength,
      reality, voidAmt: this.voidAmt, derangedAmt: this.derangedAmt, onWall: c.onWall, yardOpen: w.yard.cleared, fuel: this.fire.fuel,
      lightVisible: w.light.visible, watcherVisible: w.watcher.state === 'watch' && Vector3.Distance(c.pos, w.watcher.root.position) < 32,
      houndState: w.hound.state, nearDrifters: this.fire.isPresent && c.pos.z > 172 && c.pos.z < 182,
      figureSeen: w.anomalies.figureSeen, figureGone: w.anomalies.figureGone, resonance: this.fire.resonance,
      anomalyFocus: this.lastAnomalyFocus
    });
    if (this.chapter.consumeRevealShot()) this.playReveal();

    // Animation, then the palm's world position
    this.player.animate(dt, {
      fire: this.fire.strength, charge: this.fire.charge, phase: this.phase.progress,
      inspecting: story.inspecting, lookAt: story.lookAt,
      recovering: Math.min(1, this.recover.stumble) + (this.recover.active ? 1 : 0),
      airborne: c.airborne, landing: c.landing, vault: c.mode === 'vault' ? c.vaultT : 0, balance: c.balance,
      wind: this.clothWind.set(this.wind.dirX, 0, this.wind.dirZ).scaleInPlace(this.wind.strength * (1 + this.wind.gust))
    });
    this.player.palm.computeWorldMatrix(true);
    this.palmPos.copyFrom(this.player.palm.getAbsolutePosition());

    // Flame, configurations, anomalies, creatures
    this.ctx.time = this.time;
    this.ctx.dt = dt;
    this.ctx.phase = this.phase.progress;
    this.ctx.player.copyFrom(c.pos);
    // The flame pales while phasing, except in Void, where it must stay amber against the white
    this.fire.phaseTint = this.phase.progress * (1 - this.voidAmt);
    this.fire.voidTone = this.voidAmt;
    this.post.setVoid(this.voidAmt);
    this.hud.setVoid(this.voidAmt > 0.3);
    // Lines have no world shader. In Void, wires, ropes and threads leave with the dark;
    // the Void's own traces (fracture, edges, lattice) stay as dark residue, legible on
    // the white and almost nothing against the black
    if (Math.abs(this.voidAmt - this.linesVoid) > 0.002 || (this.voidAmt === 0 && this.linesVoid !== 0)) {
      this.linesVoid = this.voidAmt;
      for (const m of this.scene.meshes) {
        if (!(m instanceof LinesMesh) || m.name === 'fireFilaments') continue;
        const trace = /trace|voidEdge/i.test(m.name);
        let base = this.lineColors.get(m);
        if (!base) { base = m.color.clone(); this.lineColors.set(m, base); }
        if (trace) Color3.LerpToRef(base, Game.TRACE_DARK, this.voidAmt, m.color);
        else m.isVisible = this.voidAmt < 0.5;
      }
      // Mist and fog particles would hang grey in the black: not drawn in Void
      for (const ps of this.scene.particleSystems) ps.layerMask = this.voidAmt < 0.5 ? 0x0fffffff : 0;
      this.world.fog.setVoid(this.voidAmt);
    }
    this.fire.feet.copyFrom(c.pos);
    this.fire.surfaceUp.copyFrom(c.up);
    this.fire.aim.set(this.player.forward.x, 0, this.player.forward.z).normalize();
    this.fire.voidAmt = this.voidAmt; this.fire.derangedAmt = this.derangedAmt;
    this.ctx.wind!.copyFrom(this.clothWind);
    this.fire.update(dt, this.palmPos, this.ctx);
    this.debris.update(this.ctx);
    const report = w.anomalies.update(this.ctx, this.voidAmt, this.derangedAmt);
    this.fire.resonance += (report.resonance - this.fire.resonance) * damp(4, dt);
    this.lastAnomalyFocus = report.focus;
    w.phaseGeom.anchorsNear(this.fire.position, 7, this.anchorBuf);
    this.anchorsAll.length = 0;
    for (const a of this.anchorBuf) this.anchorsAll.push(a);
    if (report.focus && report.resonance > 0.15) this.anchorsAll.push(report.focus);
    this.fire.setAnchors(this.anchorsAll);
    w.phaseGeom.update(dt, this.phase.progress, this.phase.target, {
      time: this.time, firePos: this.fire.position, fireIntensity: this.fire.light.intensity,
      fogColor: this.atmos.fogColor, fogDensity: this.atmos.fogDensity, ambient: this.atmos.ambient * 1.1,
      cameraPos: this.cam.camera.position
    }, this.ctx);
    const bc = this.beingCtx;
    bc.dt = dt; bc.time = this.time; bc.playerSpeed = this.recover.active ? 0 : speed; bc.fireOn = this.fire.isPresent;
    bc.reality = reality; bc.voidAmt = this.voidAmt; bc.derangedAmt = this.derangedAmt;
    bc.transitioning = this.phase.state === 'entering' || this.phase.state === 'leaving';
    bc.playerHeight = c.onWall ? c.wallV : 0;
    w.watcher.update(bc);
    w.drifters.update(bc, this.ctx);
    w.hound.update(bc);
    if (w.hound.state === 'pursue') {
      this.houndStepTimer -= dt;
      if (this.houndStepTimer <= 0) { this.houndStepTimer = 0.18; this.audio.houndRun(this.panOf(w.hound.pos)); }
    }
    w.displaced.update(dt, this.voidAmt, this.derangedAmt);
    w.props.barrierTrace.alpha = 0.05 + this.voidAmt * 0.5;
    w.cutting.update(dt, this.voidAmt);
    w.debris.update(dt, this.ctx);
    w.yard.update(dt);
    w.forest.update(this.voidAmt);
    w.rift.update(this.voidAmt);
    w.anchor.update(this.derangedAmt);
    w.structures.wallFootprints.visibility = this.derangedAmt * 0.95;
    w.structures.wallFootprints.isVisible = this.derangedAmt > 0.02;

    // Wind and the light
    w.light.update(dt, c.pos.z, reality, this.derangedAmt);
    this.wind.update(dt, c.pos, w.light.visible > 0.3 ? w.light.position : null, this.derangedAmt, this.atmos.wind);
    // Distant and slow effects update at half rate (measured ~0.2 ms each)
    this.stepIndex++;
    if (this.stepIndex % 2 === 0) {
      w.props.cables.update(this.wind.time, this.fire.position, this.fire.strength * (1 + this.fire.charge));
      w.vista.update(dt * 2, this.derangedAmt, this.ctx);
    }
    if (this.state !== 'ending') {
      const lampTarget = c.pos.z > TRACK_END_Z - 60 ? 1.3 : 0;
      w.props.lampLight.intensity += (lampTarget - w.props.lampLight.intensity) * damp(1.5, dt);
    }
    if (this.chapter.consumeReachedEnd() && this.state === 'playing') this.beginEnding();
    if (this.state === 'ending') this.updateEnding(dt);

    // Shared world-material state
    RealityFX.voidAmount = this.voidAmt;
    RealityFX.deranged = this.derangedAmt;
    RealityFX.time = this.wind.time;
    RealityFX.fire.copyFrom(this.fire.position);
    RealityFX.fireRadius = this.fire.isPresent ? (3.2 + this.fire.charge * 2.5) * (0.5 + 0.5 * this.fire.fuel) : 0;
    RealityFX.windX = this.wind.dirX; RealityFX.windZ = this.wind.dirZ;
    RealityFX.windStrength = this.wind.strength; RealityFX.gust = this.wind.gust;
    RealityFX.hold.copyFrom(this.fire.position);
    RealityFX.holdRadius = this.fire.isPresent ? (2.6 + 2.4 * this.fire.strength) * (0.45 + 0.55 * this.fire.fuel) * (1 - this.voidAmt * 0.4) : 0;
    // Void: the white fragment around the flame shrinks with fuel, its edge shakes and the
    // detail inside it thins as the fuel runs low (the same fuel the Void already drains)
    RealityFX.white.copyFrom(this.fire.position);
    const wf = voidWhite(this.fire.fuel, this.fire.strength, this.fire.isPresent);
    RealityFX.whiteRadius = wf.radius; RealityFX.whiteUnstable = wf.unstable; RealityFX.whiteDetail = wf.detail;
    RealityFX.infl.copyFrom(this.fire.influence.pos);
    RealityFX.inflRadius = this.fire.influence.radius * this.fire.influence.strength;
    const vx = this.wind.vortex;
    RealityFX.vortexX = vx.x; RealityFX.vortexZ = vx.z; RealityFX.vortexRadius = vx.radius; RealityFX.vortexStrength = vx.strength;

    // Camera, air, post, sound
    this.cam.targetPosition.copyFrom(c.pos);
    this.cam.advanceIntro(dt, speed > 0.3);
    if (this.state !== 'ending') this.cam.setDistance(c.pos.z > 170 && c.pos.z < 212 ? this.cam.baseDistance + 3 : this.cam.onWallDistance(c.onWall, this.cam.baseDistance));
    const vant = vantageAt(c.pos.z);
    // Off the line (the village) the square has its own framing, from the side where no house stands
    // The cutting and the forest: the ordinary view, so cliff and trees stand behind the protagonist
    const inCutting = c.pos.x < -(TRACK_HALF_WIDTH + 1.5) && c.pos.z > 38 && c.pos.z < 140;
    const atOverlook = Math.hypot(c.pos.x - FOREST.overlook.x, c.pos.z - FOREST.overlook.z) < FOREST.overlook.r + 3;
    if (atOverlook && this.state !== 'ending') {
      // The overlook: the camera drops and turns west, over the edge, into the distance
      this.cam.setVantage(1, 0.3, 12, Math.PI / 4, dt);
    } else if (inCutting && this.state !== 'ending') {
      // The cutting: the ordinary view, so the cliff stands behind the protagonist
      this.cam.setVantage(0, 0.72, 17, 0, dt);
    } else if (c.pos.x > TRACK_HALF_WIDTH + 2 && !c.onWall && this.state !== 'ending') {
      const vv = VILLAGE.vantage;
      this.cam.setVantage(1, vv.pitch, vv.distance, vv.yaw, dt);
    } else {
      this.cam.setVantage(c.onWall || this.state === 'ending' ? 0 : vant.w, vant.v?.pitch ?? 0.72, vant.v?.distance ?? 17, vant.v?.yaw ?? 0, dt);
    }
    this.cam.update(dt, c.vel, story.focus, story.focusWeight, this.phase.progress + this.phase.strain * 0.3);
    this.atmos.update(c.pos, this.voidAmt, this.derangedAmt);
    // A passing vortex pulls the fog thin around the protagonist for a moment
    this.scene.fogDensity *= 1 - this.wind.vortexFelt * 0.3;
    this.updateFireScreenPos();
    this.post.update(dt, this.fireUV, this.fire.strength * (0.5 + this.fire.charge));
    this.audio.update(dt, {
      wind: this.atmos.wind + this.wind.vortexFelt * 0.8, space: this.atmos.space, phase: this.phase.progress,
      fire: this.fire.strength, charge: this.fire.charge, voidAmt: this.voidAmt, deranged: this.derangedAmt
    });
    // The stream: placed and muffled by distance; in Void it all but stops
    const wv = w.cutting.waterVoice;
    const dw = Vector3.Distance(wv, c.pos);
    this.audio.setWaterVoice(Math.max(0, 1 - dw / 26) * (1 - this.voidAmt * 0.85), this.panOf(wv), Math.min(1, dw / 20));
    const lp = w.light.position;
    const dl = Vector3.Distance(lp, c.pos);
    this.audio.setLightVoice(w.light.visible * Math.min(1, 40 / Math.max(dl, 1)) * (this.state === 'ending' ? 2 : 1), this.panOf(lp));
  }

  /** Stereo pan for a world position relative to the camera's right axis. */
  private panOf(p: Vector3): number {
    const dx = p.x - this.ctrl.pos.x, dz = p.z - this.ctrl.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * this.cam.right.x + dz * this.cam.right.y) / d;
  }

  // The monumental reveal: a real dolly back and around to the floating landmass
  private playReveal(): void {
    const focus = this.world.vista.focusPoint(new Vector3());
    // Turn to face west, stand back, drop almost level and lift the framing: the camera
    // looks up past the protagonist at the landmass
    // Framed (measured: projected island silhouette and protagonist) so the whole island fits
    // in the upper left at 4:3 and wider, with the protagonist in the lower right third
    this.cam.playShot({ focus, focusWeight: 0.1, distance: 12, pitch: 0.06, yawOffset: 0.55, fov: 0.75,
      // Coming back from the forest it starts later down the line: the boundary moves with it
      inTime: 4.5, hold: 4.5, outTime: 3.5, releaseOnMove: false, releaseBeyondZ: Math.max(REVEAL_RELEASE_Z, this.ctrl.pos.z + 14) });
  }

  /**
   * What a thrown flame at p (radius r) is touching, in the current reality: the
   * stream, the visible ground, solid obstacles (houses, the fallen tree, fence posts;
   * low ones only below their top), the two wall faces, the Hound, a Drifter.
   */
  private flameContact(p: Vector3, r: number): FlameContact {
    const w = this.world, grid = w.grid, cl = CUTTING.cleft;
    if (p.z > cl.z0 && p.z < cl.z1 && p.x > cl.x0 && p.x < cl.x1 && p.y < CUTTING.stream.y + r) return 'water';
    const rb = RIFT.bounds;
    const inRift = p.x > rb.x0 && p.x < rb.x1 && p.z > rb.z0 && p.z < rb.z1;
    const rh = inRift ? riftHeight(p.x, p.z) : null;
    const ground = inRift ? (rh ?? -100) : w.terrain.heightAt(p.x, p.z);
    if (ground > -100 && p.y - r < ground) return 'ground';
    if (p.y < GROUND_Y - 8) return 'ground';                    // gone into the gap or the fog below
    const g = ground > -100 ? ground : GROUND_Y;
    const o = grid.insideActiveObstacle(p, this.phase.reality);
    if (o && (o.low === undefined ? p.y < g + 4 : p.y < g + o.low)) return 'solid';
    for (const sf of GRAVITY_SURFACES) {
      const fx = sf.origin[0];
      if (p.x - r < fx && p.x > fx - 1 && p.z > sf.u0 && p.z < sf.u1 && p.y < GROUND_Y + sf.height) return 'solid';
    }
    const hp = w.hound.pos;
    if (Math.hypot(p.x - hp.x, p.z - hp.z) < r + 0.55 && p.y < hp.y + 1.2) return 'creature';
    if (w.drifters.near(p, r + 0.35)) return 'creature';
    return 'none';
  }

  // Losing the ground underfoot, the fallen tree returning around the protagonist,
  // or being caught: always a visible, designed recovery, never a silent teleport.
  private beginRecovery(target: Vector3, segment: number, reason: 'fall' | 'caught'): void {
    if (this.recover.active) return;
    this.recover.active = true;
    this.recover.t = 0;
    this.recover.segment = segment;
    this.recover.reason = reason;
    this.recover.target.copyFrom(target);
    this.phase.lock();
    this.audio.fall();
    this.cam.addShake(0.12);
    this.hud.setFade(0.9, 0.4);
  }

  private updateRecovery(dt: number, reality: RealityId): void {
    const c = this.ctrl;
    const grid = this.world.grid;
    this.recover.stumble = Math.max(0, this.recover.stumble - dt);
    if (this.recover.active) {
      this.recover.t += dt;
      if (this.recover.reason === 'fall') { c.pos.y -= dt * 2.2 * Math.min(1, this.recover.t * 3); this.player.place(c.pos, 0); }
      if (this.recover.t > 0.55) {
        c.teleport(this.recover.target);
        this.cam.snapTo(this.recover.target);
        this.recover.active = false;
        this.recover.stumble = 1.1;
        this.hud.setFade(0, 0.7);
        if (this.recover.reason === 'fall') this.chapter.onFall(this.recover.segment);
        else this.chapter.onCaught();
      }
      return;
    }
    if (c.mode !== 'ground') return;
    if (grid.lostGround(c.pos, reality)) {
      const seg = grid.segmentAt(c.pos.x, c.pos.z);
      const rp = grid.recoveryFor(seg);
      this.beginRecovery(this.tmp.set(rp.x, grid.heightAt(rp.x, rp.z), rp.z), seg, 'fall');
      return;
    }
    // Only reached when the phase was forced to end (the flame went out) inside matter:
    // the returning matter pushes the protagonist out to the nearest free place, as a
    // short visible slide. Never a jump to the far side.
    if (this.push.active) {
      this.push.t = Math.min(1, this.push.t + dt / PUSH_TIME);
      const e = 1 - (1 - this.push.t) * (1 - this.push.t);
      Vector3.LerpToRef(this.push.from, this.push.to, e, c.pos);
      this.player.place(c.pos, 0);
      if (this.push.t >= 1) { this.push.active = false; this.recover.stumble = 0.6; }
      return;
    }
    if (grid.insideActiveObstacle(c.pos, reality)) {
      const out = nearestFree(grid, c.pos, reality);
      if (out) {
        this.push.active = true; this.push.t = 0;
        this.push.from.copyFrom(c.pos); this.push.to.copyFrom(out);
        this.push.to.y = grid.heightAt(out.x, out.z);
        c.vel.setAll(0);
        this.recover.stumble = PUSH_TIME + 0.2;
        this.cam.addShake(0.1);
        this.audio.fall();
        this.chapter.onBarrierShove();
      }
    }
  }

  // --- The final contradiction ------------------------------------------------

  private beginEnding(): void {
    this.state = 'ending';
    this.ending.t = 0;
    this.ending.cut = false;
    this.phase.lock();
    this.hud.hideHint();
    const lampLines = POIS.find(x => x.id === 'lamp')!.lines;
    this.hud.showThought(lampLines[0]);
    // The light settles just beyond the end of the line, where the figure will stand in front of it
    this.world.light.pin(new Vector3(0.3, 2.3, TRACK_END_Z + 7.5));
    void LAMP;
    this.audio.ending();
    const focus = new Vector3(0.2, 1.5, TRACK_END_Z + 3.2);
    this.cam.playShot({ focus, focusWeight: 0.3, distance: 20, pitch: 0.24, yawOffset: -0.62,
      inTime: 7, hold: 30, outTime: 1, releaseOnMove: false });
  }

  private updateEnding(dt: number): void {
    this.ending.t += dt;
    const t = this.ending.t;
    const w = this.world;
    // The three realities stop agreeing which one this is
    const over = smoothstep(1, 4, t);
    this.voidAmt = over * (0.35 + 0.3 * Math.sin(t * 1.3));
    this.derangedAmt = over * (0.5 + 0.45 * Math.sin(t * 0.9 + 1));
    w.props.lampLight.intensity = 1.3 * (0.65 + 0.35 * Math.sin(t * 2.2));
    if (!this.fire.isPresent && t < 0.1) this.fire.summon();
    this.fire.resonance = 1;
    if (t > 3.6 && t - dt <= 3.6) this.hud.showThought('Footprints. Mine. Coming back.');
    // The recognition: it stands on the line beyond the end, facing them
    if (t > 5.2) {
      const f = smoothstep(5.2, 6.4, t) * (t > 8.2 ? 0.0 : 1);
      w.anomalies.finale = { pos: new Vector3(0.2, BED_Y + 0.9, TRACK_END_Z + 3.2), fade: f };
    }
    // Cut to black
    if (t > 8.2 && !this.ending.cut) {
      this.ending.cut = true;
      this.hud.clearThoughts();
      this.hud.setFade(1, 0.01);
      this.audio.suspend();
    }
    if (t > 10 && this.state === 'ending') {
      this.state = 'ended';
      this.audio.resume();
      this.hud.showEnd();
    }
  }

  private updateFireScreenPos(): void {
    const eng = this.engine;
    const vp = this.cam.camera.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    Vector3.ProjectToRef(this.fire.position, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), vp, this.projected);
    const u = this.projected.x / eng.getRenderWidth(), v = 1 - this.projected.y / eng.getRenderHeight();
    // A degenerate projection (before the first render, or behind the camera) keeps the last good point
    if (Number.isFinite(u) && Number.isFinite(v)) this.fireUV.set(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)));
  }
}
