import * as THREE from 'three';
import { asset } from '$app/paths';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { defaultAppearance } from '#lib/appearance.js';
import { cardName } from '#lib/cards.js';
import type { Card, Snapshot } from '#lib/protocol.js';
import { signals } from '#lib/signal-options.js';
import type { MouthLevel } from '#lib/voice-levels.js';
import {
  createAvatar,
  disposeScene,
  loadAvatar,
  type AvatarAsset,
  type TableAvatar,
} from './avatar.js';
import {
  clampLook,
  cameraFieldOfView,
  centeredTableLook,
  damp,
  eyeDistance,
  eyeHeight,
  handLook,
  headPose,
  liftForPitch,
  lookAtSeat,
  neutralLook,
  seatDistance,
  seatPoint,
  seatYaw,
  type HeadPose,
  type LookAngles,
} from './camera.js';
import { loadCardTexture, TableCards, type TableCard } from './cards.js';
import { FramePacer } from './frame-pacer.js';
import {
  fanGrip,
  fanOffset,
  fanScale,
  fanSlot,
  gripTransferDuration,
  handFan,
  type FanOffset,
  type FanSlot,
  type HandFan,
  type HandGrips,
} from './hand-fan.js';
import {
  dealtFace,
  peekFace,
  sceneIdentity,
  viewSeat,
  visualChanges,
  type DealSlot,
  type Placement,
  type TableAction,
} from './presentation.js';
import type { Quality } from './preferences.js';
import { deckLayerSpacing, deckSlot, playedSlot, viraSlot } from './table-layout.js';

export interface PointerLabel {
  text: string;
  x: number;
  y: number;
}

interface Callbacks {
  ready(): void;
  failure(): void;
  dealing(value: boolean): void;
  pose(value: HeadPose): void;
  hover(value: PointerLabel | null): void;
  cue(value: TableCue | null): void;
  landed(kind: 'deal' | 'play'): void;
}

export interface TableCue {
  seat: number;
  name: string;
  label: string;
}

interface SceneProps {
  canSelectCard: boolean;
  selectedBottom: number | null;
  selectedTop: number | null;
  cardLabels: boolean;
  reducedMotion: boolean;
  autoFocusCantos: boolean;
  poses: ReadonlyMap<number, HeadPose>;
}

interface VisibleCard extends TableCard {
  card?: Card;
  selectable?: number;
}

interface HeldCard extends VisibleCard {
  offset: FanOffset;
  slot: FanSlot;
  leaving: boolean;
}

interface Transform {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale?: number;
}

interface Flight {
  card: VisibleCard;
  from: Transform;
  to: () => Transform;
  started: number;
  duration: number;
  lift: number;
  sound?: 'deal' | 'play';
  landed?: () => void;
}

const profile = {
  desktop: { dpr: 1.75, pixels: 2_650_000, shadows: true },
  mobile: { dpr: 1, pixels: 990_000, shadows: false },
  'mobile-low': { dpr: 1, pixels: 520_000, shadows: false },
};
const tableEuler = new THREE.Euler();
const cantoFocusDuration = 0.74;
const emptyGrip = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, index: -1, amount: 0 };
const noMouth = new Map<number, MouthLevel>();
const initialProps: SceneProps = {
  canSelectCard: false,
  selectedBottom: null,
  selectedTop: null,
  cardLabels: true,
  reducedMotion: false,
  autoFocusCantos: true,
  poses: new Map(),
};

export class TableScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.04, 24);
  private readonly ray = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly avatars: TableAvatar[] = [];
  private readonly remoteLook: LookAngles[] = [];
  private readonly held = new Map<number, Map<number, HeldCard>>();
  private readonly peeking = new Set<VisibleCard>();
  private readonly played = new Map<string, VisibleCard>();
  private readonly deck: VisibleCard[] = [];
  private readonly flights = new Map<VisibleCard, Flight>();
  private readonly contacts = new THREE.Group();
  private readonly labels = new Map<number, HTMLElement>();
  private readonly labelView = new THREE.Matrix4();
  private readonly labelProjection = new THREE.Matrix4();
  private labelsDirty = true;
  private readonly seatFans: (HandFan & { lift: number })[] = [];
  private readonly grips: HandGrips[] = [];
  private readonly targetOffset = { x: 0, rise: 0, layer: 0, roll: 0 };
  private readonly heldTransform: Transform = {
    position: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
  };
  private readonly projection = new THREE.Vector3();
  private readonly observer: ResizeObserver;
  private readonly quality: (typeof profile)[Quality];
  private readonly lowQuality: boolean;
  private cardSet?: TableCards;
  private room?: THREE.Object3D;
  private asset?: AvatarAsset;
  private vira?: VisibleCard;
  private hovered?: VisibleCard;
  private snapshot?: Snapshot;
  private resetKey?: number;
  private props = initialProps;
  private look = { ...neutralLook };
  private focus?: LookAngles;
  private cantoCamera?: { returnTo: LookAngles; returnAt?: number };
  private cameraGeneration = 0;
  private dragging = false;
  private mouthLevels: ReadonlyMap<number, MouthLevel> = noMouth;
  private readonly framePacer = new FramePacer();
  private frame = 0;
  private time = 0;
  private canceled = false;
  private drawing = false;
  private ready = false;
  private schedule: { snapshot: Snapshot; action: TableAction; cameraGeneration: number }[] = [];
  private finishAt = 0;
  private cueUntil = 0;
  private poseTime = 0;
  private poseTimer?: ReturnType<typeof setInterval>;
  private poseSent?: HeadPose;
  private drawEnd = 0;
  private isDealing = false;
  private currentDeckSeat = 0;
  private cardsDirty = false;
  private resizePending = true;
  private ownFanScale = fanScale(1, 720);
  private ownLook = 0;
  private motionUntil = 0;
  private revealTasks: { time: number; callback: () => void }[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    quality: Quality,
    private readonly callbacks: Callbacks,
  ) {
    this.quality = profile[quality];
    this.lowQuality = quality === 'mobile-low';
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: quality === 'desktop',
      powerPreference: quality === 'desktop' ? 'high-performance' : 'low-power',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    const ambient = new THREE.HemisphereLight(0xc6d4dc, 0x4d3926, 1.52);
    const lamp = new THREE.PointLight(0xffe2b9, 3.15, 4);
    lamp.position.set(0, 1.88, 0);
    const key = new THREE.DirectionalLight(0xffead0, 0.78);
    key.position.set(-1.4, 2.2, 1.6);
    if (this.quality.shadows) {
      this.renderer.shadowMap.enabled = true;
      key.castShadow = true;
      key.shadow.mapSize.set(768, 768);
      key.shadow.camera.left = key.shadow.camera.bottom = -2;
      key.shadow.camera.right = key.shadow.camera.top = 2;
      key.shadow.camera.far = 6;
      key.shadow.normalBias = 0.015;
    }
    this.world.add(ambient, lamp, key);
    this.world.background = new THREE.Color(0x232a22);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    this.observer = new ResizeObserver(() => {
      this.resizePending = true;
      this.invalidate();
    });
    this.observer.observe(this.canvas);
    void this.load().catch(() => this.fail());
  }

  private readonly contextLost = (event: Event) => {
    event.preventDefault();
    this.fail();
  };

  private async load() {
    const [room, avatar, texture] = await Promise.allSettled([
      new GLTFLoader().loadAsync(asset('table3d/room.glb')),
      loadAvatar(),
      loadCardTexture(),
    ]);
    if (
      this.canceled ||
      room.status !== 'fulfilled' ||
      avatar.status !== 'fulfilled' ||
      texture.status !== 'fulfilled'
    ) {
      if (room.status === 'fulfilled') disposeScene(room.value.scene);
      if (avatar.status === 'fulfilled') disposeScene(avatar.value.scene);
      if (texture.status === 'fulfilled') texture.value.dispose();
      if (!this.canceled) this.fail();
      return;
    }
    this.room = room.value.scene;
    this.asset = avatar.value;
    this.world.add(this.room, this.contacts);
    this.room.updateWorldMatrix(true, true);
    this.room.traverse((node) => {
      node.matrixAutoUpdate = false;
      node.matrixWorldAutoUpdate = false;
      if (node instanceof THREE.Mesh) {
        node.receiveShadow = true;
        node.castShadow = node.name.includes('Table') || node.name.includes('Rail');
      }
    });
    this.cardSet = new TableCards(texture.value, this.lowQuality);
    this.drawing = true;
    if (this.snapshot) this.baseline(this.snapshot);
    this.visibility(document.hidden);
  }

  private fail() {
    if (!this.canceled) {
      this.dispose();
      this.callbacks.failure();
    }
  }

  updateOptions(props: SceneProps) {
    const changedMotion = this.props.reducedMotion !== props.reducedMotion;
    if (this.props.autoFocusCantos !== props.autoFocusCantos) this.stopCantoCamera();
    const changedPick =
      this.props.selectedBottom !== props.selectedBottom ||
      this.props.selectedTop !== props.selectedTop;
    const changedPose =
      this.props.poses.size !== props.poses.size ||
      [...props.poses].some(([seat, pose]) => {
        const previous = this.props.poses.get(seat);
        return !previous || previous.yaw !== pose.yaw || previous.pitch !== pose.pitch;
      });
    this.props = props;
    if (changedMotion && props.reducedMotion && this.snapshot) this.baseline(this.snapshot);
    if (changedPick || changedPose) this.animateFor(0.38);
    if (!props.cardLabels && this.hovered) this.endHover();
  }

  setMouthLevels(levels: ReadonlyMap<number, MouthLevel>) {
    this.mouthLevels = levels;
    this.animateFor(0.22);
  }

  attachLabel(seat: number, label: HTMLElement) {
    this.labels.set(seat, label);
    this.labelsDirty = true;
    this.invalidate();
    return () => this.labels.delete(seat);
  }

  receive(snapshot: Snapshot, resetKey: number) {
    const before = this.snapshot;
    if (before === snapshot && resetKey === this.resetKey) return;
    const reset =
      !before || this.resetKey !== resetKey || sceneIdentity(before) !== sceneIdentity(snapshot);
    this.snapshot = snapshot;
    this.resetKey = resetKey;
    if (!this.drawing || !snapshot.state) return;
    if (reset || document.hidden) {
      this.baseline(snapshot, reset);
    } else {
      this.updateOccupancy(snapshot);
      const actions = visualChanges(before, snapshot);
      const previous = before.state;
      const current = snapshot.state;
      if (
        previous?.handNumber !== current.handNumber ||
        (previous.pending &&
          (!current.pending || (previous.suspended && !current.suspended)) &&
          !actions.some(({ type }) => type === 'canto'))
      ) {
        this.finishCantoFocus();
      }
      if (this.props.reducedMotion) {
        this.baseline(snapshot);
        for (const action of actions) {
          if (action.type === 'canto' || action.type === 'signal') this.showCue(action, snapshot);
        }
      } else {
        this.schedule.push(
          ...actions.map((action) => ({
            action,
            snapshot,
            cameraGeneration: this.cameraGeneration,
          })),
        );
        this.cardsDirty ||= before.state?.revision !== snapshot.state.revision;
        if (this.schedule.length > 24) this.baseline(snapshot);
        else if (actions.some(({ type }) => type === 'deal')) this.setDealing(true);
      }
    }
    this.invalidate();
  }

  visibility(hidden: boolean) {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.framePacer.reset();
    clearInterval(this.poseTimer);
    if (hidden) {
      if (this.snapshot && this.drawing) this.baseline(this.snapshot);
      this.endHover();
    } else if (this.drawing && !this.canceled) {
      this.poseTimer = setInterval(() => this.publishPose(performance.now(), true), 420);
      this.invalidate();
    }
  }

  private invalidate() {
    if (!this.frame && this.drawing && !this.canceled && !document.hidden) {
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  private animateFor(seconds: number) {
    this.motionUntil = Math.max(this.motionUntil, this.time + seconds);
    this.invalidate();
  }

  setDragging(dragging: boolean) {
    if (this.dragging !== dragging) this.stopCantoCamera();
    this.dragging = dragging;
    if (dragging) this.endHover();
  }

  lookBy(yaw: number, pitch: number) {
    this.endHover();
    this.stopCantoCamera();
    this.look = clampLook(this.look.yaw + yaw, this.look.pitch + pitch);
    this.animateFor(0.35);
  }

  lookTo(hand = false) {
    this.endHover();
    this.stopCantoCamera();
    this.look = hand ? handLook(this.camera.aspect, this.canvas.clientHeight) : { ...neutralLook };
    this.animateFor(0.35);
  }

  private get perspective() {
    return this.snapshot ? viewSeat(this.snapshot) : 0;
  }

  private get players() {
    return this.snapshot?.config.players ?? 2;
  }

  private transform(
    seat: number,
    x: number,
    y: number,
    z: number,
    pitch: number,
    roll = 0,
    output: Transform = { position: new THREE.Vector3(), rotation: new THREE.Quaternion() },
  ): Transform {
    const yaw = seatYaw(seat, this.players);
    const sine = Math.sin(yaw);
    const cosine = Math.cos(yaw);
    output.position.set(x * cosine + z * sine, y, z * cosine - x * sine);
    output.rotation.setFromEuler(tableEuler.set(pitch, yaw, roll, 'YXZ'));
    return output;
  }

  private positionHeld(seat: number, index: number) {
    const fan = this.fan(seat);
    const slot = this.held.get(seat)?.get(index)?.slot;
    // Held placement and flight interpolation copy these values immediately.
    const result = this.transform(
      seat,
      slot?.x ?? 0,
      slot?.y ?? fan.y,
      slot?.z ?? fan.z,
      fan.pitch,
      slot?.roll ?? 0,
      this.heldTransform,
    );
    result.scale = fan.scale;
    return result;
  }

  private fan(seat: number) {
    const own = seat === this.perspective;
    const lift = own
      ? this.ownLook
      : Math.max(0, Math.min(1, ((this.remoteLook[seat]?.pitch ?? 0) - 0.14) / 0.28));
    const scale = own ? this.ownFanScale : 0.86;
    const count = this.held.get(seat)?.size ?? 0;
    const cached = this.seatFans[seat];
    if (cached?.lift === lift && cached.scale === scale && cached.count === count) return cached;
    return (this.seatFans[seat] = { ...handFan(lift, scale, count), lift });
  }

  private positionPlay(seat: number, round: number, stacked: boolean, burned = false) {
    const { x, y, z, roll } = playedSlot(this.players, round, stacked, burned);
    return this.transform(seat, x, y, z, -Math.PI / 2, roll);
  }

  private positionDeck(seat: number, index = 0) {
    const { x, y, z, roll } = deckSlot;
    return this.transform(seat, x, y + index * deckLayerSpacing, z, -Math.PI / 2, roll);
  }

  private positionVira(seat: number, outsideDeck = false) {
    const { x, y, z, roll } = viraSlot;
    // The reveal lands fully beside the pile before sliding beneath its bottom card.
    const slide = outsideDeck ? 1.5 : 0;
    return this.transform(
      seat,
      x + slide * (x - deckSlot.x),
      y,
      z + slide * (z - deckSlot.z),
      -Math.PI / 2,
      roll,
    );
  }

  private make(card?: Card, selectable?: number): VisibleCard {
    const visual: VisibleCard = { ...this.cardSet!.make(card), card, selectable };
    this.world.add(visual.object);
    return visual;
  }

  private setPlace(card: VisibleCard, transform: Transform) {
    card.object.position.copy(transform.position);
    card.object.quaternion.copy(transform.rotation);
    card.object.scale.setScalar(transform.scale ?? 1);
  }

  private syncFace(visual: VisibleCard, card?: Card) {
    visual.card = card;
    visual.face(card);
  }

  private updateOccupancy(snapshot: Snapshot) {
    if (!this.asset) return;
    while (this.avatars.length > snapshot.config.players) this.avatars.pop()?.dispose();
    if (this.contacts.children.length !== snapshot.config.players + 1)
      this.buildGrounding(snapshot.config.players);
    for (const [seat, player] of snapshot.seats.entries()) {
      const appearance = player.appearance ?? defaultAppearance(seat);
      let avatar = this.avatars[seat];
      if (!avatar) {
        avatar = createAvatar(this.asset, appearance);
        this.avatars.push(avatar);
        this.world.add(avatar.object);
        this.remoteLook[seat] = { yaw: 0, pitch: 0 };
        this.grips[seat] = { left: { ...emptyGrip }, right: { ...emptyGrip } };
      } else avatar.setAppearance(appearance);
      const point = seatPoint(seat, this.players, 0, 0, seatDistance);
      avatar.object.position.set(point.x, point.y, point.z);
      avatar.object.rotation.y = seatYaw(seat, this.players) + Math.PI;
      avatar.firstPerson(seat === this.perspective);
      avatar.object.visible = !!player.id;
      this.contacts.children[seat].visible = !!player.id;
    }
  }

  private baseline(snapshot: Snapshot, resetLook = false) {
    this.schedule = [];
    this.finishAt = 0;
    this.drawEnd = 0;
    this.revealTasks = [];
    this.cueUntil = 0;
    this.callbacks.cue(null);
    this.setDealing(false);
    this.stopCantoCamera();
    this.cardsDirty = false;
    this.motionUntil = this.time;
    this.endHover();
    if (resetLook) {
      this.look = { ...neutralLook };
      this.poseSent = undefined;
      for (const pose of this.remoteLook) Object.assign(pose, { yaw: 0, pitch: 0 });
    }
    this.updateOccupancy(snapshot);
    for (const avatar of this.avatars) avatar.resetGrip();
    this.displayCards(snapshot);
    this.invalidate();
  }

  private clearCards() {
    for (const card of this.allCards()) card.object.removeFromParent();
    for (const { card } of this.flights.values()) card.object.removeFromParent();
    this.flights.clear();
    this.held.clear();
    this.peeking.clear();
    this.played.clear();
    this.deck.length = 0;
    this.vira = undefined;
  }

  private allCards() {
    return [
      ...Array.from(this.held.values()).flatMap((cards) => [...cards.values()]),
      ...this.peeking,
      ...this.played.values(),
      ...this.deck,
      ...(this.vira ? [this.vira] : []),
    ];
  }

  private displayCards(snapshot: Snapshot) {
    this.clearCards();
    const game = snapshot.state;
    if (!game || !this.cardSet) return;
    this.makeDeck(game.dealer);
    if (!game.vira) return;
    this.vira = this.make(game.vira);
    this.setPlace(this.vira, this.positionVira(game.dealer));
    for (const player of game.seats) {
      const own = player.seat === this.perspective;
      if (own) {
        for (const card of game.hand) {
          if (!card.used) this.makeHeld(player.seat, card.index, card.card);
        }
      } else {
        for (let i = 3 - player.remaining; i < 3; i++) this.makeHeld(player.seat, i);
      }
      const bottom = player.plays[1];
      const top = player.plays[2];
      const stacked =
        !!top?.present &&
        !!(bottom?.concealed || (game.mandatoryStack && bottom?.burned && top.burned));
      for (const [round, play] of player.plays.entries()) {
        if (!play.present) continue;
        const visual = this.make(play.card);
        this.played.set(`${player.seat}:${round}`, visual);
        this.setPlace(visual, this.positionPlay(player.seat, round, stacked, play.burned));
      }
    }
    for (const seat of this.held.keys()) this.fitHeldCards(seat, 1);
  }

  private makeDeck(seat: number) {
    for (const card of this.deck) card.object.removeFromParent();
    this.deck.length = 0;
    this.currentDeckSeat = seat;
    for (let index = 0; index < 6; index++) {
      const card = this.make();
      this.setPlace(card, this.positionDeck(seat, index));
      this.deck.push(card);
    }
  }

  private makeHeld(seat: number, index: number, face?: Card) {
    this.putInHand(seat, index, this.make(face));
  }

  private putInHand(seat: number, index: number, visual: VisibleCard) {
    visual.selectable = seat === this.perspective ? index : undefined;
    let rack = this.held.get(seat);
    if (!rack) {
      rack = new Map();
      this.held.set(seat, rack);
    }
    const card: HeldCard = Object.assign(visual, {
      offset: { x: 0, rise: 0, layer: 0, roll: 0 },
      slot: { x: 0, y: 0, z: 0, roll: 0 },
      leaving: false,
    });
    rack.set(index, card);
    const fan = this.fan(seat);
    fanOffset(fan, this.handOrdinal(rack, index), this.isSelected(seat, index), card.offset);
    fanSlot(fan, card.offset, card.slot);
  }

  private handOrdinal(rack: ReadonlyMap<number, HeldCard>, index: number) {
    let ordinal = 0;
    for (const other of rack.keys()) if (other < index) ordinal++;
    return ordinal;
  }

  private isSelected(seat: number, index: number) {
    return (
      seat === this.perspective &&
      (index === this.props.selectedTop || index === this.props.selectedBottom)
    );
  }

  private fitHeldCards(seat: number, blend: number) {
    const fan = this.fan(seat);
    const rack = this.held.get(seat);
    const { left, right } = this.grips[seat];
    left.amount = right.amount = 0;
    if (!rack?.size) return;

    let holding = 0;
    let first = Infinity;
    let last = -Infinity;
    let hasSurvivors = false;
    for (const card of rack.values()) hasSurvivors ||= !card.leaving;
    for (const [index, card] of rack) {
      const target = fanOffset(
        fan,
        this.handOrdinal(rack, index),
        this.isSelected(seat, index),
        this.targetOffset,
      );
      card.offset.x = THREE.MathUtils.lerp(card.offset.x, target.x, blend);
      card.offset.rise = THREE.MathUtils.lerp(card.offset.rise, target.rise, blend);
      card.offset.layer = THREE.MathUtils.lerp(card.offset.layer, target.layer, blend);
      card.offset.roll = THREE.MathUtils.lerp(card.offset.roll, target.roll, blend);
      fanSlot(fan, card.offset, card.slot);

      // Slide onto a surviving card while the card being played is still in reach.
      if (card.leaving && hasSurvivors) continue;
      const flight = this.flights.get(card);
      const amount = flight
        ? THREE.MathUtils.clamp(1 - (flight.started + flight.duration - this.time) / 0.06, 0, 1)
        : 1;
      if (!amount) continue;
      holding++;
      if (index < first) {
        first = left.index = index;
        left.amount = amount;
        left.pitch = fan.pitch;
        fanGrip(fan, card.slot, -1, left);
      }
      if (index > last) {
        last = right.index = index;
        right.amount = amount;
        right.pitch = fan.pitch;
        fanGrip(fan, card.slot, 1, right);
      }
    }
    if (holding < 2) right.amount = 0;
  }

  private fly(
    card: VisibleCard,
    to: () => Transform,
    start: number,
    duration: number,
    lift = 0.1,
    sound?: 'deal' | 'play',
    landed?: () => void,
  ) {
    this.flights.set(card, {
      card,
      to,
      duration,
      lift,
      sound,
      landed,
      started: start,
      from: {
        position: card.object.position.clone(),
        rotation: card.object.quaternion.clone(),
        scale: card.object.scale.x,
      },
    });
  }

  private setDealing(value: boolean) {
    if (this.isDealing === value) return;
    this.isDealing = value;
    this.callbacks.dealing(value);
  }

  private showCue(action: Extract<TableAction, { type: 'canto' | 'signal' }>, snapshot: Snapshot) {
    const label =
      action.type === 'canto'
        ? action.label
        : signals.find(({ kind }) => kind === action.kind)?.label;
    if (!label) return;
    const name = snapshot.seats[action.seat]?.name ?? '';
    this.callbacks.cue({ seat: action.seat, name, label });
    this.cueUntil = this.time + 1.6;
  }

  private animatePlayer(seat: number, clip: string, duration: number) {
    this.avatars[seat]?.play(clip, duration);
    this.animateFor(duration + 0.16);
  }

  private dealCard(slot: DealSlot, snapshot: Snapshot) {
    const card = this.make();
    this.setPlace(card, this.positionDeck(snapshot.state!.dealer, this.deck.length - 1));
    const deliver = () => {
      this.peeking.delete(card);
      this.putInHand(slot.seat, slot.index, card);
      this.syncFace(card);
      this.fly(
        card,
        () => this.positionHeld(slot.seat, slot.index),
        this.time,
        0.3,
        0.12,
        'deal',
        () => this.syncFace(card, dealtFace(snapshot, slot)),
      );
      if (slot.index === 2 && slot.seat !== snapshot.state!.dealer)
        this.animatePlayer(slot.seat, 'draw', 0.44);
    };
    const previewer = slot.previewer;
    if (previewer === undefined) {
      deliver();
      return;
    }
    this.peeking.add(card);
    this.animatePlayer(previewer, 'inspect', 0.28);
    this.fly(
      card,
      () => this.transform(previewer, 0, 1.065, 0.55, -0.46),
      this.time,
      0.19,
      0.12,
      undefined,
      () => this.syncFace(card, peekFace(snapshot, slot)),
    );
    this.revealTasks.push({
      time: this.time + 0.31,
      callback: () => {
        this.animatePlayer(previewer, 'deal', 0.3);
        deliver();
      },
    });
  }

  private playAction(action: TableAction, snapshot: Snapshot, cameraGeneration: number) {
    const game = snapshot.state!;
    const at = this.time;
    switch (action.type) {
      case 'shuffle':
        for (const card of [...this.played.values(), ...(this.vira ? [this.vira] : [])]) {
          this.fly(card, () => this.positionDeck(this.currentDeckSeat), at, 0.36, 0.04);
        }
        this.animatePlayer(action.seat, 'shuffle', 0.8);
        this.revealTasks.push({
          time: at + 0.36,
          callback: () => {
            this.displayCards(snapshot);
            for (const [index, card] of this.deck.entries()) {
              card.object.position.x += (index % 2 ? 1 : -1) * 0.035;
              this.fly(card, () => this.positionDeck(game.dealer, index), this.time, 0.37, 0.025);
            }
          },
        });
        return 0.79;
      case 'deal': {
        this.setDealing(true);
        this.animatePlayer(action.cutter, 'cut', 0.38);
        const cutAt = at + 0.38;
        const previews = action.slots.filter((slot) => slot.previewer !== undefined);
        const standard = action.slots.slice(previews.length);
        const dealAt = cutAt + (previews.length ? 0.74 : 0);
        const lastCard = dealAt + 0.075 * (standard.length - 1) + 0.3;
        this.drawEnd = lastCard + 0.46;
        for (const [index, card] of this.deck.entries()) {
          if (index < 3) continue;
          card.object.position.x += 0.06;
          this.fly(card, () => this.positionDeck(action.dealer, index), at, 0.34, 0.035);
        }
        this.revealTasks.push({
          time: dealAt,
          callback: () => this.animatePlayer(action.dealer, 'deal', lastCard - dealAt),
        });
        for (const [index, slot] of previews.entries()) {
          this.revealTasks.push({
            time: cutAt + index * 0.12,
            callback: () => this.dealCard(slot, snapshot),
          });
        }
        for (const [index, slot] of standard.entries()) {
          this.revealTasks.push({
            time: dealAt + index * 0.075,
            callback: () => this.dealCard(slot, snapshot),
          });
        }
        this.revealTasks.push({
          time: lastCard - 0.06,
          callback: () => {
            const vira = this.make(game.vira);
            this.vira = vira;
            this.setPlace(vira, this.positionDeck(action.dealer, this.deck.length));
            vira.object.rotateY(Math.PI);
            this.fly(
              vira,
              () => this.positionVira(action.dealer, true),
              this.time,
              0.28,
              0.09,
              undefined,
              () => this.fly(vira, () => this.positionVira(action.dealer), this.time, 0.16, 0),
            );
          },
        });
        this.revealTasks.push({
          time: lastCard,
          callback: () => this.animatePlayer(this.perspective, 'fan', 0.4),
        });
        return this.drawEnd - at;
      }
      case 'play': {
        this.animatePlayer(
          action.seat,
          action.cards.every((card) => card.burned) ? 'fold' : 'play',
          0.52,
        );
        const paired =
          action.cards.length > 1 &&
          (action.cards.some(({ concealed }) => concealed) ||
            (game.mandatoryStack && action.cards.every(({ burned }) => burned)));
        for (const [index, placement] of action.cards.entries()) {
          this.playCard(placement, paired, index === 0);
        }
        return 0.44 + gripTransferDuration;
      }
      case 'reveal':
        for (const placement of action.cards) {
          this.flipCard(placement, game.seats[placement.seat].plays[2]?.burned);
        }
        return 0.35;
      case 'canto': {
        this.animatePlayer(action.seat, action.clip, 0.68);
        this.showCue(action, snapshot);
        if (cameraGeneration === this.cameraGeneration) this.focusCanto(action.seat, snapshot);
        return 0.42;
      }
      case 'signal':
        this.showCue(action, snapshot);
        this.avatars[action.seat]?.signal(action.kind);
        this.animateFor(0.7);
        return 0.18;
      case 'result':
        if (action.winner >= 0) {
          for (const [seat] of this.avatars.entries())
            this.animatePlayer(seat, seat % 2 === action.winner ? 'win' : 'lose', 1.1);
        }
        return 0;
    }
  }

  private playCard(placement: Placement, stacked: boolean, audible: boolean) {
    const { seat, round, heldIndex, card, burned } = placement;
    const rack = this.held.get(seat);
    let source = heldIndex;
    if (source === undefined && rack) {
      for (const [index, visual] of rack) {
        if (visual.leaving) continue;
        source = index;
        break;
      }
    }
    const held = source === undefined ? undefined : rack?.get(source);
    if (held) {
      held.leaving = true;
      held.selectable = undefined;
    }
    this.revealTasks.push({
      time: this.time + gripTransferDuration,
      callback: () => {
        const visual = held ?? this.make();
        if (!held) this.setPlace(visual, this.positionHeld(seat, round));
        if (source !== undefined) rack?.delete(source);
        if (this.hovered === visual) this.endHover();
        this.syncFace(visual, card);
        this.played.set(`${seat}:${round}`, visual);
        this.fly(
          visual,
          () => this.positionPlay(seat, round, stacked, burned),
          this.time + (stacked && round === 2 ? 0.045 : 0),
          0.39,
          0.115,
          audible ? 'play' : undefined,
        );
      },
    });
  }

  private flipCard({ seat, round, card, burned, concealed }: Placement, topBurned?: boolean) {
    const visual = this.played.get(`${seat}:${round}`);
    if (!visual) return;
    visual.object.rotateY(Math.PI);
    this.syncFace(visual, card);
    this.fly(
      visual,
      () => this.positionPlay(seat, round, concealed, burned),
      this.time,
      0.35,
      0.09,
    );
    if (round === 1 && !concealed) {
      const top = this.played.get(`${seat}:2`);
      if (top)
        this.fly(top, () => this.positionPlay(seat, 2, false, topBurned), this.time, 0.35, 0.055);
    }
  }

  private buildGrounding(players: number) {
    disposeScene(this.contacts);
    this.contacts.clear();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return;
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(29, 22, 14, 0.44)');
    gradient.addColorStop(1, 'rgba(29, 22, 14, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    for (let seat = 0; seat <= players; seat++) {
      const shadow = new THREE.Mesh(geometry, material);
      const point = seatPoint(seat, players, 0, 0.007, seat === players ? 0 : seatDistance);
      shadow.position.set(point.x, point.y, point.z);
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.setScalar(seat === players ? 1.8 : 0.78);
      this.contacts.add(shadow);
    }
  }

  private stopCantoCamera() {
    this.focus = undefined;
    this.cantoCamera = undefined;
    // Keep queued gestures and captions while discarding their automatic turns.
    this.cameraGeneration++;
  }

  private finishCantoFocus() {
    if (!this.cantoCamera || this.cantoCamera.returnAt === undefined) return;
    this.cantoCamera.returnAt = undefined;
    this.focus = this.cantoCamera.returnTo;
    this.endHover();
  }

  private focusCanto(seat: number, snapshot: Snapshot) {
    if (
      !this.props.autoFocusCantos ||
      this.props.reducedMotion ||
      this.dragging ||
      snapshot.state?.handNumber !== this.snapshot?.state?.handNumber
    )
      return;
    if (seat === this.perspective) {
      this.finishCantoFocus();
      return;
    }
    const returnTo = this.cantoCamera?.returnTo ?? {
      ...centeredTableLook,
      pitch:
        Math.abs(this.look.yaw) < 0.04
          ? Math.min(this.look.pitch, centeredTableLook.pitch)
          : centeredTableLook.pitch,
    };
    this.cantoCamera = { returnTo, returnAt: this.time + cantoFocusDuration };
    this.endHover();
    this.focus = lookAtSeat(this.perspective, seat, this.players);
    this.animateFor(cantoFocusDuration);
  }

  private updateLook(dt: number) {
    if (this.cantoCamera?.returnAt !== undefined && this.time >= this.cantoCamera.returnAt)
      this.finishCantoFocus();
    if (this.focus) {
      this.look = {
        yaw: damp(this.look.yaw, this.focus.yaw, dt, 9),
        pitch: damp(this.look.pitch, this.focus.pitch, dt, 9),
      };
      if (
        Math.abs(this.look.yaw - this.focus.yaw) + Math.abs(this.look.pitch - this.focus.pitch) <
        0.004
      ) {
        this.look = this.focus;
        this.focus = undefined;
        if (this.cantoCamera?.returnAt === undefined) this.cantoCamera = undefined;
      }
    }
    const eye = seatPoint(this.perspective, this.players, 0, eyeHeight, eyeDistance);
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(
      this.look.pitch,
      seatYaw(this.perspective, this.players) + this.look.yaw,
      0,
      'YXZ',
    );
    const target = liftForPitch(this.look.pitch);
    this.ownLook = this.props.reducedMotion ? target : damp(this.ownLook, target, dt, 15);
  }

  private publishPose(time: number, keepalive = false) {
    if (
      !this.ready ||
      document.hidden ||
      this.snapshot?.seat === undefined ||
      this.snapshot.seat < 0
    )
      return;
    const pose = headPose(this.look);
    if (
      time - this.poseTime >= 100 &&
      (keepalive || pose.yaw !== this.poseSent?.yaw || pose.pitch !== this.poseSent?.pitch)
    ) {
      this.callbacks.pose(pose);
      this.poseTime = time;
      this.poseSent = pose;
    }
  }

  private updateAvatars(dt: number) {
    const blend = this.props.reducedMotion ? 1 : 1 - Math.exp(-dt * 21);
    for (const [seat, avatar] of this.avatars.entries()) {
      const pose = this.props.poses.get(seat);
      const look = this.remoteLook[seat];
      const own = seat === this.perspective;
      look.yaw = damp(look.yaw, (pose?.yaw ?? 0) * 0.0086, dt, 15);
      look.pitch = damp(look.pitch, -(pose?.pitch ?? 0) * 0.0048, dt, 15);
      this.fitHeldCards(seat, blend);
      if (!avatar.object.visible) continue;
      const reading = this.mouthLevels.get(seat);
      const mouth = reading?.userID === this.snapshot?.seats[seat]?.id ? reading?.level : 0;
      avatar.update(dt, own ? undefined : look, mouth, this.grips[seat], !this.props.reducedMotion);
    }
  }

  private updateLabels() {
    if (!this.labels.size) return;
    // Render has already updated the camera matrices. Labels only depend on
    // that view and the projection, even when the cards or avatars animate.
    if (
      !this.labelsDirty &&
      this.labelView.equals(this.camera.matrixWorld) &&
      this.labelProjection.equals(this.camera.projectionMatrix)
    )
      return;
    this.labelsDirty = false;
    this.labelView.copy(this.camera.matrixWorld);
    this.labelProjection.copy(this.camera.projectionMatrix);
    for (const [seat, label] of this.labels) {
      const point = seatPoint(seat, this.players, 0, 1.52, seatDistance - 0.13);
      this.projection.set(point.x, point.y, point.z).project(this.camera);
      const { x, y, z } = this.projection;
      const visible = z > 0 && z < 1 && x > -1 && x < 1 && y > -1 && y < 1;
      label.hidden = !visible;
      if (visible) {
        label.style.left = `${(x + 1) * 50}%`;
        label.style.top = `${(1 - y) * 50}%`;
      }
    }
  }

  private advanceTimeline() {
    if (this.isDealing && this.drawEnd && this.time >= this.drawEnd) {
      this.drawEnd = 0;
      this.setDealing(this.schedule.some(({ action }) => action.type === 'deal'));
    }
    if (this.cueUntil && this.time >= this.cueUntil) {
      this.cueUntil = 0;
      this.callbacks.cue(null);
    }
    if (this.time >= this.finishAt && this.schedule.length) {
      const next = this.schedule.shift()!;
      this.finishAt =
        this.time + this.playAction(next.action, next.snapshot, next.cameraGeneration);
    }
    if (this.revealTasks.length) {
      const future = [];
      for (const task of this.revealTasks) {
        if (task.time <= this.time) task.callback();
        else future.push(task);
      }
      this.revealTasks = future;
    }
    if (
      this.snapshot &&
      this.cardsDirty &&
      !this.flights.size &&
      !this.schedule.length &&
      !this.revealTasks.length &&
      this.time >= this.finishAt
    ) {
      this.cardsDirty = false;
      this.displayCards(this.snapshot);
    }
  }

  private advanceFlights() {
    for (const [card, flight] of this.flights) {
      if (flight.started > this.time) continue;
      const progress = Math.min(1, (this.time - flight.started) / flight.duration);
      const eased = 1 - (1 - progress) ** 2;
      const to = flight.to();
      card.object.position.lerpVectors(flight.from.position, to.position, eased);
      card.object.position.y += flight.lift * Math.sin(Math.PI * progress);
      card.object.quaternion.slerpQuaternions(flight.from.rotation, to.rotation, eased);
      card.object.scale.setScalar(
        THREE.MathUtils.lerp(flight.from.scale ?? 1, to.scale ?? 1, eased),
      );
      if (progress === 1) {
        this.flights.delete(card);
        flight.landed?.();
        if (flight.sound) this.callbacks.landed(flight.sound);
      }
    }
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!width || !height) return;
    const dpr = Math.min(
      devicePixelRatio || 1,
      this.quality.dpr,
      Math.sqrt(this.quality.pixels / (width * height)),
    );
    this.renderer.setSize(
      Math.max(1, Math.round(width * dpr)),
      Math.max(1, Math.round(height * dpr)),
      false,
    );
    this.camera.aspect = width / height;
    this.ownFanScale = fanScale(this.camera.aspect, height);
    this.camera.fov = cameraFieldOfView(this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.resizePending = false;
  }

  private readonly tick = (ms: number) => {
    this.frame = 0;
    if (this.canceled) return;
    const dt = this.framePacer.drawTime(ms);
    if (dt === undefined) {
      this.invalidate();
      return;
    }
    this.time += dt;
    try {
      if (this.resizePending) this.resize();
      this.updateLook(dt);
      this.advanceTimeline();
      this.updateAvatars(dt);
      this.advanceFlights();
      for (const [seat, cards] of this.held) {
        for (const [index, card] of cards) {
          if (!this.flights.has(card)) this.setPlace(card, this.positionHeld(seat, index));
        }
      }
      this.renderer.render(this.world, this.camera);
      this.updateLabels();
      if (!this.ready && !this.resizePending) {
        this.ready = true;
        this.callbacks.ready();
      }
      this.publishPose(ms);
      if (
        this.focus ||
        this.flights.size ||
        this.schedule.length ||
        this.revealTasks.length ||
        this.cueUntil ||
        this.cardsDirty ||
        this.motionUntil > this.time ||
        this.finishAt > this.time ||
        this.drawEnd
      )
        this.invalidate();
      else this.framePacer.reset();
    } catch {
      this.fail();
    }
  };

  private pick(clientX: number, clientY: number) {
    if (!this.ready) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((clientY - rect.top) / rect.height) * 2,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    const cards = this.allCards().filter((card) => !this.flights.has(card));
    const matches = this.ray.intersectObjects(
      cards.map((card) => card.object),
      true,
    );
    return cards.find((card) => card.object === matches[0]?.object.parent);
  }

  hover(clientX: number, clientY: number) {
    if (!this.props.cardLabels || this.dragging) return;
    const card = this.pick(clientX, clientY);
    if (!card?.card) {
      this.endHover();
      return;
    }
    this.hovered = card;
    this.callbacks.hover({ text: cardName(card.card), x: clientX, y: clientY });
  }

  endHover() {
    if (this.hovered) this.callbacks.hover(null);
    this.hovered = undefined;
  }

  selectableCardAt(clientX: number, clientY: number) {
    if (!this.props.canSelectCard) return;
    const card = this.pick(clientX, clientY);
    return card?.selectable === undefined ? undefined : card.object.id;
  }

  select(clientX: number, clientY: number, expectedTarget?: number) {
    if (!this.props.canSelectCard) return;
    const card = this.pick(clientX, clientY);
    if (
      card?.selectable === undefined ||
      (expectedTarget !== undefined && card.object.id !== expectedTarget)
    )
      return;
    if (!this.props.reducedMotion) {
      this.animatePlayer(this.perspective, 'select', 0.36);
    }
    return card.selectable;
  }

  dispose() {
    if (this.canceled) return;
    this.canceled = true;
    this.drawing = false;
    cancelAnimationFrame(this.frame);
    clearInterval(this.poseTimer);
    this.observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.setDealing(false);
    this.clearCards();
    for (const avatar of this.avatars) avatar.dispose();
    if (this.asset) disposeScene(this.asset.scene);
    if (this.room) disposeScene(this.room);
    this.labels.clear();
    disposeScene(this.contacts);
    this.cardSet?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
