import { Vector3 } from '@babylonjs/core';
import { InteractionHUD } from '../ui/InteractionHUD';
import { AudioSystem } from '../core/AudioSystem';
import { R_VOID } from '../core/Reality';
import type { RealityId } from '../core/Reality';
import {
  POIS, PoiDef, HUTS, BARRIER, BARRIER_GHOST_TREE, GAP_NEAR_Z, GAP_FAR_Z, CROSSING, LAMP,
  RISING_RAIL, START, BED_Y, WALL
} from './layout';

export interface ChapterInput {
  dt: number;
  player: Vector3;
  moving: boolean;
  firePresent: boolean;
  fireStrength: number;
  reality: RealityId;
  voidAmt: number;
  derangedAmt: number;
  onWall: boolean;
  fuel: number;
  lightVisible: number;
  watcherVisible: boolean;
  houndState: string;
  nearDrifters: boolean;
  figureSeen: boolean;
  figureGone: boolean;
  resonance: number;
  anomalyFocus: Vector3 | null;
}

export interface ChapterOutput {
  focus: Vector3 | null;
  focusWeight: number;
  lookAt: Vector3 | null;
  inspecting: boolean;
  reachedEnd: boolean;
  revealShot: boolean;
}

/**
 * Chapter One's director: when the protagonist thinks, what the camera and the
 * protagonist's attention lean toward, which quiet control hints appear, what can
 * be examined, and when the chapter ends. Every beat fires once and has a single
 * trigger defined here.
 */
export class ChapterOne {
  private said = new Set<string>();
  private examined = new Set<string>();
  private hinted = new Set<string>();
  private time = 0;
  private stillTime = 0;
  private edgeTime = 0;
  private barrierApproachedFromNear = false;
  private inspectTimer = 0;
  private currentPoi: PoiDef | null = null;
  private fallCount = 0;
  private revealed = false;
  private phasedOnce = false;
  public firePresentSince = -1;
  private ended = false;
  private readonly out: ChapterOutput = { focus: null, focusWeight: 0, lookAt: null, inspecting: false, reachedEnd: false, revealShot: false };
  private readonly gapFocus = new Vector3(0, 0.5, (GAP_NEAR_Z + GAP_FAR_Z) / 2);
  private readonly ghostTreeFocus = new Vector3(BARRIER_GHOST_TREE.x, 2, BARRIER_GHOST_TREE.z);
  private readonly poiPos = new Vector3();
  private readonly wallFocus = new Vector3(WALL.x, 4.5, (WALL.z0 + WALL.z1) / 2);
  private revealed2 = false;
  private readonly lampFocus = new Vector3(LAMP.x + 0.5, 2.2, LAMP.z + 3);
  private delayed: { at: number; fn: () => void }[] = [];

  constructor(private hud: InteractionHUD, private audio: AudioSystem) {}

  private say(id: string, text: string, delay = 0): void {
    if (this.said.has(id)) return;
    this.said.add(id);
    if (delay > 0) this.later(delay, () => this.hud.showThought(text));
    else this.hud.showThought(text);
  }

  /** A control hint, shown once. Delayed hints re-check `stillRelevant` when they fire. */
  private hint(id: string, key: string, text: string, delay = 0, stillRelevant?: () => boolean): void {
    if (this.hinted.has(id)) return;
    this.hinted.add(id);
    const show = () => { if (!stillRelevant || stillRelevant()) this.hud.showHint(key, text); };
    if (delay > 0) this.later(delay, show);
    else show();
  }

  private firePresent = false;

  private later(seconds: number, fn: () => void): void {
    this.delayed.push({ at: this.time + seconds, fn });
  }

  // --- Events from systems --------------------------------------------------

  public onFireSummoned(): void {
    this.say('fire-first', 'It does not burn me.', 0.4);
    this.hint('gather', 'R', 'hold to gather the fire, then let go', 7, () => this.firePresent);
  }

  public onRefused(firePresent: boolean): void {
    if (!firePresent) this.say('refused', 'Nothing answers. My hand is cold.');
  }

  public onPhaseSolid(player: Vector3, reality: RealityId): void {
    const nearBarrier = Math.abs(player.z - (BARRIER.z0 + BARRIER.z1) / 2) < 12;
    if (!this.phasedOnce) this.phasedOnce = true;
    if (reality === 'void') {
      this.say('void-first', 'Never let the flame go out in the dark.', 0.2);
      if (nearBarrier) this.say('void-tree', 'The tree is gone. Its shadow stayed.', 3.2);
      else this.say('void-thin', 'Everything is thin here. Only what the flame touches stays.', 3.2);
    } else if (reality === 'deranged') {
      this.say('deranged-first', 'Down is not where it was.', 0.3);
      if (nearBarrier) this.say('ghost-tree', 'The tree is standing. Over there.', 2.5);
      if (player.z > GAP_FAR_Z + 4) this.say('roots', 'The roots are growing up. Toward something.', 4.0);
    }
  }

  public onGuttered(): void { this.say('guttered', 'It went out. In the dark.'); }
  public onDriftersScattered(): void { this.say('drifters-scatter', 'They come apart, and gather again further on.', 0.6); }
  public onHoundWake(): void {
    this.say('hound-wake', 'It heard me.', 0.3);
    this.hint('sneak', 'C', 'walk slowly, with your hand closed', 1.5);
  }
  public onHoundRepelled(): void { this.say('hound-flame', 'It does not like the flame.', 0.4); }
  public onCaught(): void { this.say('caught', 'It threw me back.', 0.8); }
  public onWallEnter(): void { this.say('on-wall', 'Which way is down now?', 0.5); }
  public onWallLeave(): void { this.say('off-wall', 'Down is down again. For now.', 0.4); }
  public onRejected(enter: boolean, onWall: boolean, insideMatter = false): void {
    if (onWall) this.say('wall-hold', 'Not here. I would fall the wrong way.');
    else if (insideMatter) this.say('matter-hold', 'Not inside it. It would close around me.');
    else if (enter) this.say('reject-enter', 'It will not let me. Something is in the way there.');
  }

  public onReveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.say('reveal', 'There. The rails are there. Just not here.', 0.6);
    this.hint('phase-gap', 'Q', 'hold to phase', 4.5, () => !this.phasedOnce || this.fallCount > 0);
  }

  public onFall(segmentId: number): void {
    this.fallCount++;
    const seg = CROSSING.find(s => s.id === segmentId);
    if (seg && seg.realities !== R_VOID) this.say('fall-normal', 'That piece only holds when I see it plainly.', 0.9);
    else this.say('fall-phased', 'I let go too soon.', 0.9);
    if (this.fallCount === 3) this.say('fall-third', 'One holds when I look. One holds when I do not.', 2.5);
  }

  public onBarrierShove(): void {
    this.say('barrier-shove', 'It came back while I was inside it.', 0.6);
  }

  /** E pressed. */
  public inspect(): boolean {
    const poi = this.currentPoi;
    if (!poi || poi.id === 'lamp') return false;
    this.audio.inspect();
    this.inspectTimer = 1.8;
    if (!this.examined.has(poi.id)) {
      this.examined.add(poi.id);
      poi.lines.forEach((l, i) => this.later(i * 1.6, () => this.hud.showThought(l)));
    } else {
      this.hud.showThought(poi.lines[poi.lines.length - 1]);
    }
    this.hud.hideHint();
    return true;
  }

  // --- Per-frame ------------------------------------------------------------

  /** Something in reach can be examined right now (drives the touch examine control). */
  public get examinable(): boolean { return !!this.currentPoi && this.currentPoi.id !== 'lamp'; }

  public update(s: ChapterInput): ChapterOutput {
    this.time += s.dt;
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      if (this.time >= this.delayed[i].at) { const d = this.delayed[i]; this.delayed.splice(i, 1); d.fn(); }
    }
    const p = s.player;
    const z = p.z;
    this.stillTime = s.moving ? 0 : this.stillTime + s.dt;
    this.firePresent = s.firePresent;
    if (s.firePresent && this.firePresentSince < 0) this.firePresentSince = this.time;
    if (!s.firePresent) this.firePresentSince = -1;
    this.inspectTimer = Math.max(0, this.inspectTimer - s.dt);

    // Opening
    if (this.time > 2.5) this.say('open', 'I remember language and basic actions... but not my name.');
    if (this.time > 9 && Math.hypot(p.x - START.x, p.z - START.z) < 1.5) this.hint('walk', 'W A S D', 'walk');

    // Railway
    if (z > 16 && Math.abs(p.x) < 4) this.say('rails', 'Rails. They have to go somewhere.');
    if (z > 44) {
      this.say('dark', 'It is darker under the trees.');
      this.say('warm', 'My palm is warm. Warmer than it should be.', 2.2);
      if (!s.firePresent) this.hint('fire', 'F', 'open your hand', 3.4, () => !this.firePresent);
    }
    if (z > 76 && !s.firePresent && this.hinted.has('fire')) {
      this.hinted.delete('fire'); this.hinted.add('fire2');
      this.hud.showHint('F', 'open your hand');
    }
    const nearHut = (i: number) => Math.hypot(p.x - HUTS[i].x, p.z - HUTS[i].z) < 10;
    if (nearHut(0)) this.say('hut1', 'A maintenance hut. The window was broken from the inside.');
    if (nearHut(1)) this.say('hut2', 'The same hut. The same window. I did not turn around.');
    if (z > 118) this.say('poles', 'The poles are closer together than they were.');

    // The first phase
    const bz = (BARRIER.z0 + BARRIER.z1) / 2;
    if (z > BARRIER.z0 - 9 && z < BARRIER.z0) {
      this.barrierApproachedFromNear = true;
      this.say('barrier', 'Something fell across the line. Recently. And a long time ago.');
      if (s.firePresent) this.hint('phase', 'Q', 'hold to phase', 2.5, () => this.firePresent);
      else this.hint('fire-barrier', 'F', 'open your hand', 2.5, () => !this.firePresent);
    }
    if (this.barrierApproachedFromNear && z > BARRIER.z1 + 1.5) this.say('barrier-passed', 'Behind me it has fallen again.', 0.5);

    // The gap
    if (z > 167 && z < GAP_FAR_Z) this.say('edge-approach', 'The rails keep going. The ground does not.');
    if (s.figureSeen) this.say('figure', 'Someone is standing on the other side.', 0.5);
    if (z > GAP_NEAR_Z - 3 && z < GAP_NEAR_Z + 0.2) {
      this.edgeTime += s.dt;
      if (this.edgeTime > 3 && !this.revealed) {
        if (s.firePresent) this.hint('gather-edge', 'R', 'hold to gather the fire, then let go');
        else this.hint('fire-edge', 'F', 'open your hand');
      }
      if (this.edgeTime > 11 && !this.phasedOnce) this.hint('phase-edge', 'Q', 'hold to phase');
    }
    const frag = CROSSING[1];
    if (z > frag.z0 + 1 && z < frag.z1 - 1 && s.reality !== 'void') this.say('fragment', 'This part is real. Old wood, and the earth still hanging under it.', 0.3);
    if (z > GAP_FAR_Z + 1) this.say('crossed', 'Solid. It was always solid. I think.', 0.4);
    if (s.figureGone && z > GAP_NEAR_Z) this.say('figure-gone', 'Gone. Or I was never close enough to see it.', 2.5);

    // The alternate railway
    if (nearHut(2)) this.say('hut3', 'Again. The window is whole this time.');
    if (z > GAP_FAR_Z + 9) this.say('poles-side', 'The poles are on the other side now.', 1.5);
    if (z > 236) this.say('sleepers', 'Laid by something that knew what a railway looks like. Not why.');
    if (z > RISING_RAIL.z0 - 5) this.say('rising', 'One rail leaves. The other does not seem to notice.');
    if (z > 272) this.say('flow', 'Everything here drifts back the way I came.');
    if (z > LAMP.z - 15) this.say('lamp-seen', 'A lamp. Someone keeps it lit.');

    // The light
    if (s.lightVisible > 0.6 && z > 20) this.say('light1', 'A light. Moving, out there.');
    if (s.lightVisible > 0.6 && z > 75 && this.said.has('light1')) this.say('light2', 'It was lower before.');
    if (s.lightVisible > 0.6 && z > 160) this.say('light3', 'It is above the far side now. Too high for anything to hold it.');
    if (s.lightVisible > 0.6 && z > 216) this.say('light4', 'It went where the rail went.');
    if (s.lightVisible > 0.6 && z > 268) this.say('light5', 'It is coming down.');
    // Movement, the first obstacle and the reveal
    if (z > 18) this.hint('run', 'Shift', 'run', 2);
    if (z > 79 && z < 86) {
      this.say('pole', 'A pole came down across the line.');
      this.hint('vault', 'Space', 'climb over');
    }
    if (z > 97 && !this.revealed2) {
      this.revealed2 = true;
      this.out.revealShot = true;
      this.say('landmass', 'That cannot be held up by anything.', 3.0);
      this.say('underside', 'There are houses on its underside. Upside down.', 8.0);
    }
    // Watcher
    if (s.watcherVisible && z > 24) this.say('watcher1', 'Someone at the trees.');
    if (s.watcherVisible && z > 100 && this.said.has('watcher1')) this.say('watcher2', 'It keeps ahead of me.');
    // Drifters and the Void
    if (s.nearDrifters) this.say('drifters', 'Small things. They come to the flame.');
    if (s.reality === 'void' && s.fuel < 0.35) this.say('fuel-low', 'It is getting smaller here.');
    // The wall
    if (z > 210 && z < 222) {
      this.say('wall', 'That wall is too clean to have been left standing.');
      if (p.x < WALL.x + 1.6) {
        if (s.reality !== 'deranged') this.hint('phase-wall', 'Q', 'hold to phase', 2.5, () => !this.said.has('deranged-first'));
        else this.hint('wall-walk', 'A', 'walk into the wall', 0.8);
      }
    }
    // The cutting
    if (p.x < -5 && z > 39 && z < 69) {
      this.say('cutting', 'A path up. Someone wanted to see the line from above.', 0.6);
      if (p.x < -11 && z > 47 && z < 53) this.say('cut-rails', 'Rails. Up here. Running into the rock.', 0.4);
      if (z > 53 && z < 59 && p.x < -11) this.say('cut-trunk', 'It will hold. It held before.', 0.2);
      if (z > 59 && p.x < -11) this.say('cut-water', 'Water. Running the right way, for once.', 0.8);
    }
    // The village: the same house, more than once
    if (p.x > 9 && z > 127 && z < 146) {
      this.say('village', 'The same house. Again. And again.');
      if (p.x > 12) this.say('village-up', 'Do not look up for too long.', 4.0);
      if (s.reality === 'void' && p.x > 11) this.say('village-shadow', 'It left. Its shadow did not.', 0.6);
      if (s.reality !== 'void' && p.x > 11 && z > 139) this.hint('village-void', 'Q', 'hold to phase', 3.0, () => !this.said.has('village-path'));
    }
    if (s.reality === 'void' && p.x > 5 && z > 143 && z < 157) this.say('village-path', 'There was a way across. There was always a way across.');
    // The hound
    if (z > 252 && s.houndState === 'rest') this.say('hound-seen', 'Something is lying on the line.');
    // The house front beside the den
    if (z > 256 && z < 282 && p.x < -3.6) {
      this.say('facade', 'Only the front of a house. Nothing behind it.', 0.4);
      if (s.reality === 'deranged') this.hint('facade-walk', 'A', 'walk into the wall', 0.8);
    }
    if (s.onWall && z > 256 && z < 282) this.say('facade-above', 'It cannot reach me up here. It is waiting.', 1.2);

    // Points of interest
    this.currentPoi = null;
    let bestD = Infinity;
    for (const poi of POIS) {
      const d = Math.hypot(p.x - poi.x, p.z - poi.z);
      if (d < poi.radius && d < bestD) { bestD = d; this.currentPoi = poi; }
    }
    if (this.currentPoi && this.currentPoi.id !== 'lamp' && !this.examined.has(this.currentPoi.id)) {
      this.hint('examine', 'E', 'examine');
    }

    // Ending: reaching the lamp
    const dLamp = Math.hypot(p.x - LAMP.x, p.z - LAMP.z);
    if (!this.ended && dLamp < 2.6 && z > GAP_FAR_Z) {
      this.ended = true;
      this.out.reachedEnd = true;
    }

    // Attention: points of interest, anomalies the fire resonates with, the gap
    let focus: Vector3 | null = null, weight = 0;
    if (this.currentPoi) {
      this.poiPos.set(this.currentPoi.x, BED_Y + 0.3, this.currentPoi.z);
      focus = this.poiPos; weight = 0.5;
    }
    if (z > 168 && z < GAP_NEAR_Z + 1) { focus = this.gapFocus; weight = 0.75; }
    // The last stretch is composed around the lamp and the line continuing past it
    if (z > LAMP.z - 18) { focus = this.lampFocus; weight = 0.9; }
    if (this.said.has('ghost-tree') && s.reality === 'deranged' && Math.abs(z - bz) < 10) { focus = this.ghostTreeFocus; weight = 0.4; }
    if (s.reality === 'deranged' && z > WALL.z0 && z < WALL.z1) { focus = this.wallFocus; weight = 0.45; }
    if (!focus && s.anomalyFocus && s.resonance > 0.25) { focus = s.anomalyFocus; weight = 0.35 * s.resonance; }
    this.out.focus = focus;
    this.out.focusWeight = weight;
    this.out.lookAt = focus;
    this.out.inspecting = this.inspectTimer > 0;
    return this.out;
  }

  public consumeRevealShot(): boolean {
    const r = this.out.revealShot;
    this.out.revealShot = false;
    return r;
  }

  public consumeReachedEnd(): boolean {
    const r = this.out.reachedEnd;
    this.out.reachedEnd = false;
    return r;
  }

  public reset(): void {
    this.said.clear(); this.examined.clear(); this.hinted.clear(); this.delayed = [];
    this.time = 0; this.stillTime = 0; this.edgeTime = 0; this.inspectTimer = 0;
    this.barrierApproachedFromNear = false; this.currentPoi = null; this.fallCount = 0;
    this.revealed = false; this.phasedOnce = false; this.firePresentSince = -1; this.ended = false;
    this.out.reachedEnd = false;
    this.out.revealShot = false;
    this.revealed2 = false;
  }
}
