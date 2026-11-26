<script lang="ts">
  import { Focus, Layers } from '@lucide/svelte';
  import { on } from 'svelte/events';
  import { cardName, cardURL } from '#lib/cards.js';
  import type { Snapshot } from '#lib/protocol.js';
  import { subscribeMouthLevels } from '#lib/voice-levels.js';
  import type { HeadPose } from '#lib/table3d/camera.js';
  import {
    autoFocusCantosEvent,
    autoFocusCantosKey,
    readAutoFocusCantos,
    tableQuality,
    type QualitySetting,
  } from '#lib/table3d/preferences.js';
  import { sceneIdentity, viewSeat } from '#lib/table3d/presentation.js';
  import type { PointerLabel, TableCue, TableScene } from '#lib/table3d/scene.js';

  const touchHoldMs = 260;
  const tapSlop = 8;
  const dragSlop = 6;
  const dragSensitivity = -0.0055;

  interface TouchPress {
    startedAt: number;
    selectionContext: string;
    cardTarget?: number;
    timer?: ReturnType<typeof setTimeout>;
  }

  interface Gesture {
    canvas: HTMLCanvasElement;
    scene: TableScene;
    id: number;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    dragging: boolean;
    touch?: TouchPress;
  }

  let {
    snapshot,
    resetKey = 0,
    visible = false,
    quality,
    canSelectCard = false,
    selectedBottom = null,
    selectedTop = null,
    cardLabels = true,
    poses = new Map(),
    onready,
    onfailure,
    ondealing = () => {},
    onlanded = () => {},
    onpose = () => {},
    onselect,
  }: {
    snapshot: Snapshot;
    resetKey?: number;
    visible?: boolean;
    quality: QualitySetting;
    canSelectCard?: boolean;
    selectedBottom?: number | null;
    selectedTop?: number | null;
    cardLabels?: boolean;
    poses?: ReadonlyMap<number, HeadPose>;
    onready: () => void;
    onfailure: () => void;
    ondealing?: (value: boolean) => void;
    onlanded?: (kind: 'deal' | 'play') => void;
    onpose?: (value: HeadPose | null) => void;
    onselect?: (index: number) => void;
  } = $props();

  let scene = $state.raw<TableScene>();
  let reducedMotion = $state(false);
  let autoFocusCantos = $state(true);
  let hovered = $state.raw<PointerLabel | null>(null);
  let speaking = $state.raw<TableCue | null>(null);
  let perspective = $derived(viewSeat(snapshot));
  let vira = $derived(snapshot.state?.vira);
  let playedCards = $derived(
    (snapshot.state?.seats[perspective]?.plays ?? []).flatMap((play, index) => {
      if (!play.present) return [];
      const face = play.burned || play.concealed ? undefined : play.card;
      const label = play.burned ? 'Quemada' : face ? cardName(face) : 'Tapada';
      return [{ round: index + 1, face, label }];
    }),
  );
  let playedBy = $derived(snapshot.seat < 0 ? snapshot.seats[perspective]?.name : undefined);
  let playedLabel = $derived(playedBy ? `Cartas jugadas de ${playedBy}` : 'Tus cartas jugadas');
  const cardDetailsId = $props.id();
  const touchControlsId = `${cardDetailsId}-touch-controls`;
  let cardsKey = $derived(`${sceneIdentity(snapshot)}:${snapshot.state?.handNumber ?? 0}`);
  let cardsExpanded = $derived.by((): boolean => {
    // Opening is local to the current hand and seat.
    void cardsKey;
    return false;
  });
  let voiceRoom = $derived(snapshot.code);
  let gestureView = $derived(`${cardsKey}:${resetKey}`);
  let selectionContext = $derived(
    `${gestureView}:${snapshot.state?.revision}:${canSelectCard}:${selectedBottom}:${selectedTop}`,
  );
  let gesture: Gesture | undefined;
  let labelTimer: ReturnType<typeof setTimeout>;

  function mountScene(canvas: HTMLCanvasElement) {
    const profile = tableQuality(quality);
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = preference.matches;
    autoFocusCantos = readAutoFocusCantos();
    const releaseAutoFocus = on(window, autoFocusCantosEvent, (event) => {
      autoFocusCantos = (event as CustomEvent<boolean>).detail;
    });
    const releaseAutoFocusStorage = on(window, 'storage', ({ key }) => {
      if (key === null || key === autoFocusCantosKey) autoFocusCantos = readAutoFocusCantos();
    });
    let disposed = false;
    let instance: TableScene | undefined;
    const updatePreference = () => (reducedMotion = preference.matches);
    const visibility = () => {
      if (document.hidden) cancelGesture();
      instance?.visibility(document.hidden);
      if (document.hidden) onpose(null);
    };
    preference.addEventListener('change', updatePreference);
    document.addEventListener('visibilitychange', visibility);
    void import('#lib/table3d/scene.js')
      .then(({ TableScene }) => {
        if (disposed) return;
        instance = new TableScene(canvas, profile, {
          ready: () => onready(),
          failure: () => {
            cancelGesture();
            onfailure();
          },
          dealing: (value) => ondealing(value),
          landed: (kind) => onlanded(kind),
          pose: (value) => onpose(value),
          hover: (value) => (hovered = value),
          cue: (value) => (speaking = value),
        });
        scene = instance;
      })
      .catch(() => {
        if (!disposed) onfailure();
      });
    return () => {
      disposed = true;
      releaseAutoFocus();
      releaseAutoFocusStorage();
      preference.removeEventListener('change', updatePreference);
      document.removeEventListener('visibilitychange', visibility);
      cancelGesture();
      instance?.dispose();
      onpose(null);
      if (scene === instance) scene = undefined;
      clearTimeout(labelTimer);
      hovered = null;
      speaking = null;
    };
  }

  $effect(() => {
    scene?.updateOptions({
      canSelectCard,
      selectedBottom,
      selectedTop,
      cardLabels,
      reducedMotion,
      autoFocusCantos,
      poses,
    });
  });

  function seatLabel(seat: number) {
    return (element: HTMLElement) => scene?.attachLabel(seat, element);
  }
  $effect(() => {
    scene?.receive(snapshot, resetKey);
  });
  $effect(() => {
    const current = scene;
    if (!current) return;
    return subscribeMouthLevels(voiceRoom, (levels) => current.setMouthLevels(levels));
  });
  $effect(() => {
    if (visible) {
      void gestureView;
      return cancelGesture;
    }
  });

  function cancelGesture() {
    const active = gesture;
    if (!active) return;
    gesture = undefined;
    clearTimeout(active.touch?.timer);
    if (active.dragging) active.scene.setDragging(false);
    if (active.canvas.hasPointerCapture(active.id)) active.canvas.releasePointerCapture(active.id);
  }

  function cancelPointer(event: PointerEvent) {
    if (gesture?.id === event.pointerId) cancelGesture();
  }

  function cancelCompetingTouch(event: PointerEvent) {
    if (gesture?.touch && event.pointerType === 'touch' && gesture.id !== event.pointerId)
      cancelGesture();
  }

  function beginDrag(active: Gesture) {
    if (gesture !== active || active.dragging) return;
    clearTimeout(active.touch?.timer);
    active.dragging = true;
    active.scene.setDragging(true);
  }

  function pointerTravel(active: Gesture, event: PointerEvent) {
    return Math.hypot(event.clientX - active.x, event.clientY - active.y);
  }

  function start(event: PointerEvent) {
    const current = scene;
    const touch = event.pointerType === 'touch';
    if (!current || !visible || gesture || event.button !== 0 || (touch && !event.isPrimary))
      return;
    const canvas = event.currentTarget as HTMLCanvasElement;
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === 'mouse') canvas.parentElement?.focus({ preventScroll: true });
    const active: Gesture = {
      canvas,
      scene: current,
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragging: false,
    };
    gesture = active;
    clearTimeout(labelTimer);
    if (touch) {
      current.endHover();
      active.touch = {
        startedAt: event.timeStamp,
        selectionContext,
        cardTarget: canSelectCard
          ? current.selectableCardAt(event.clientX, event.clientY)
          : undefined,
        timer: setTimeout(() => beginDrag(active), touchHoldMs),
      };
    }
  }

  function move(event: PointerEvent) {
    const active = gesture;
    if (!active) {
      if (event.pointerType === 'mouse') scene?.hover(event.clientX, event.clientY);
      return;
    }
    if (active.id !== event.pointerId) return;
    const dx = event.clientX - active.lastX;
    const dy = event.clientY - active.lastY;
    active.lastX = event.clientX;
    active.lastY = event.clientY;
    if (active.touch && event.timeStamp - active.touch.startedAt < touchHoldMs) {
      if (pointerTravel(active, event) > tapSlop) cancelGesture();
      return;
    }
    if (!active.dragging && (active.touch || pointerTravel(active, event) > dragSlop))
      beginDrag(active);
    if (active.dragging && (dx || dy))
      active.scene.lookBy(dx * dragSensitivity, dy * dragSensitivity);
  }

  function finish(event: PointerEvent) {
    const active = gesture;
    if (active?.id !== event.pointerId) return;
    const { clientX, clientY } = event;
    const touch = active.touch;
    const held = touch && event.timeStamp - touch.startedAt >= touchHoldMs;
    const moved = touch && pointerTravel(active, event) > tapSlop;
    // A late timer must still treat a stationary hold as manual camera input.
    if (held && !moved) beginDrag(active);
    cancelGesture();
    if (!visible || active.dragging || held || moved) return;
    if (
      touch &&
      (touch.selectionContext !== selectionContext ||
        active.canvas.ownerDocument.elementFromPoint(clientX, clientY) !== active.canvas)
    )
      return;

    const target = touch?.cardTarget;
    const card =
      !touch || target !== undefined ? active.scene.select(clientX, clientY, target) : undefined;
    if (card !== undefined) onselect?.(card);
    else if (event.pointerType !== 'mouse') {
      active.scene.hover(clientX, clientY);
      labelTimer = setTimeout(() => active.scene.endHover(), 1100);
    }
  }

  function suppressTouchMenu(event: MouseEvent) {
    if (gesture?.touch || ('pointerType' in event && event.pointerType === 'touch'))
      event.preventDefault();
  }

  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape' && cardsExpanded) {
      cardsExpanded = false;
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [0.11, 0],
      ArrowRight: [-0.11, 0],
      ArrowUp: [0, 0.1],
      ArrowDown: [0, -0.1],
    };
    const offset = offsets[event.key];
    if (offset) {
      event.preventDefault();
      scene?.lookBy(...offset);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      scene?.lookTo(event.key === 'End');
    }
  }
</script>

{#snippet playedList(compact: boolean)}
  <ol aria-label={playedLabel}>
    {#each playedCards as play (play.round)}
      <li>
        {#if compact}<img src={cardURL(play.face)} width="19" height="29" alt="" />{/if}
        <span class="play-round">{play.round}.ª</span>
        <span>{play.label}</span>
      </li>
    {/each}
  </ol>
{/snippet}

<svelte:window
  onblur={cancelGesture}
  onpagehide={cancelGesture}
  onpointerdowncapture={cancelCompetingTouch}
/>

<div
  class={['first-person-table', { visible }]}
  aria-hidden={!visible}
  aria-label="Vista desde tu asiento. Arrastra o usa las flechas para mirar."
  aria-describedby={touchControlsId}
  role="application"
  tabindex="-1"
  onkeydown={keys}
>
  <span id={touchControlsId} hidden>
    En pantallas táctiles, mantén presionada la mesa y arrastra para mirar. Toca una carta una vez
    para seleccionarla.
  </span>
  <canvas
    {@attach mountScene}
    aria-hidden="true"
    onpointerdown={start}
    onpointermove={move}
    onpointerup={finish}
    onpointercancel={cancelPointer}
    onlostpointercapture={cancelPointer}
    onpointerleave={() => scene?.endHover()}
    oncontextmenu={suppressTouchMenu}
  ></canvas>
  {#if visible}
    {#each snapshot.seats as seat, index (seat.id || index)}
      {#if seat.id && index !== perspective}
        <span
          class={[
            'avatar-name',
            {
              'active-speaker': speaking?.seat === index,
              'current-turn': snapshot.state?.turn === index && !snapshot.state.pending,
            },
          ]}
          hidden
          {@attach seatLabel(index)}
        >
          {seat.name}
          {#if speaking?.seat === index}<span>{speaking.label}</span>{/if}
        </span>
      {/if}
    {/each}
    <div class="camera-controls" aria-label="Controles de la vista" role="group">
      <button
        type="button"
        title="Centrar vista"
        aria-label="Centrar vista"
        onclick={() => scene?.lookTo()}
      >
        <Focus size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Mirar las cartas"
        aria-label="Mirar las cartas"
        onclick={() => scene?.lookTo(true)}
      >
        <Layers size={17} aria-hidden="true" />
      </button>
    </div>
    {#if vira}
      <div class="table-cards">
        <button
          type="button"
          class="vira-button"
          aria-expanded={cardsExpanded}
          aria-controls={cardDetailsId}
          aria-label={`La vira · ${cardName(vira)}`}
          onclick={() => (cardsExpanded = !cardsExpanded)}
        >
          <img src={cardURL(vira)} width="23" height="35" alt="" />
          <span>
            Vira <strong>{cardName(vira)}</strong>
          </span>
        </button>
        <div id={cardDetailsId} class="card-details" hidden={!cardsExpanded}>
          {#if cardsExpanded}
            <img src={cardURL(vira)} width="92" height="142" alt={`La vira: ${cardName(vira)}`} />
            {#if playedCards.length}
              <div>
                <p class="plays-label">{playedBy ? `Jugadas · ${playedBy}` : 'Tus jugadas'}</p>
                {@render playedList(false)}
              </div>
            {/if}
          {/if}
        </div>
        {#if !cardsExpanded && playedCards.length}
          <div class="played-preview">
            <p class="plays-label">{playedBy ? `Jugadas · ${playedBy}` : 'Tus jugadas'}</p>
            {@render playedList(true)}
          </div>
        {/if}
      </div>
    {/if}
    {#if speaking}<p class="canto-caption" role="status">
        <strong>{speaking.name}</strong>
        {speaking.label}
      </p>{/if}
    {#if hovered}
      <div
        class="held-card-label"
        style:left={Math.max(74, Math.min(window.innerWidth - 74, hovered.x)) + 'px'}
        style:top={Math.max(30, hovered.y) + 'px'}
      >
        {hovered.text}
      </div>
    {/if}
  {/if}
</div>

<style>
  .first-person-table {
    position: fixed;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
    overflow: clip;
    background: #15201a;
  }

  .first-person-table.visible {
    visibility: visible;
    pointer-events: auto;
  }

  .first-person-table:focus-visible {
    outline-offset: -3px;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    -webkit-touch-callout: none;
    cursor: grab;
  }

  canvas:active {
    cursor: grabbing;
  }

  .camera-controls {
    position: absolute;
    left: max(8px, env(safe-area-inset-left));
    bottom: max(8px, env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .avatar-name {
    position: absolute;
    max-width: min(156px, 45%);
    transform: translate(-50%, -100%);
    padding: 3px 7px;
    overflow-wrap: anywhere;
    text-align: center;
    color: #faf4e0;
    background: #17251ce8;
    border: 1px solid #8a9a7d70;
    border-radius: 7px;
    font-size: clamp(0.68rem, 2.9vw, 0.87rem);
    line-height: 1.18;
    pointer-events: none;
  }

  .avatar-name span {
    display: block;
    color: #f5d785;
    padding: 2px 0 1px;
    font-size: 0.92em;
  }

  .avatar-name.current-turn,
  .avatar-name.active-speaker {
    border-color: #e3c080;
  }

  .camera-controls button {
    display: grid;
    place-items: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    color: #fbf2d9;
    background: #14231bec;
    border: 1px solid #c5d5bc60;
    border-radius: 9px;
  }

  .camera-controls button:hover {
    background: #244030;
  }

  .table-cards {
    --cards-top: var(--table-vira-top, calc(58px + env(safe-area-inset-top)));
    --cards-right: max(8px, env(safe-area-inset-right));
    --cards-half-width: calc(50dvw - 4px - var(--cards-right));
    position: absolute;
    top: var(--cards-top);
    right: var(--cards-right);
    display: grid;
    justify-items: end;
    gap: 4px;
  }

  .vira-button {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 3px 7px;
    color: #fbf2d9;
    background: #14231bec;
    border: 1px solid #c5d5bc60;
    border-radius: 9px;
    text-align: left;
    line-height: 1.1;
    font-size: 0.75rem;
  }

  .vira-button strong {
    display: block;
    margin-top: 2px;
  }

  .vira-button img,
  .played-preview img,
  .card-details > img {
    flex: none;
    border-radius: 3px;
  }

  .played-preview,
  .card-details {
    padding: 5px 6px;
    color: #fff2ca;
    background: #14231bec;
    border: 1px solid #c5d5bc60;
    border-radius: 9px;
    font-size: 0.7rem;
    line-height: 1.15;
  }

  .played-preview {
    max-width: min(188px, var(--cards-half-width));
    text-align: center;
    pointer-events: none;
  }

  .plays-label {
    margin: 0 0 4px;
    color: #d1d9b9;
    font-weight: 750;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .played-preview ol {
    display: flex;
    justify-content: center;
    gap: 4px;
    font-size: 10px;
  }

  .played-preview li {
    display: grid;
    justify-items: center;
    align-content: start;
    min-width: 0;
    gap: 2px;
    overflow-wrap: anywhere;
  }

  .play-round {
    color: #d1d9b9;
  }

  .card-details:not([hidden]) {
    --details-height: max(
      48px,
      calc(100dvh - var(--cards-top) - var(--table-caption-bottom, 8px) - 56px)
    );
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: min(240px, calc(100dvw - 24px));
    max-height: var(--details-height);
    overflow: auto;
  }

  .card-details > img {
    width: auto;
    height: min(142px, calc(var(--details-height) - 12px));
  }

  .card-details > div {
    min-width: 0;
  }

  .card-details li {
    display: flex;
    gap: 4px;
    margin-block: 4px;
  }

  @media (max-width: 520px) {
    .card-details:not([hidden]) {
      flex-direction: column;
      max-width: var(--cards-half-width);
    }
  }

  .canto-caption {
    position: absolute;
    bottom: var(--table-caption-bottom, calc(158px + env(safe-area-inset-bottom)));
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    width: max-content;
    max-width: calc(100% - 116px);
    padding: 5px 8px;
    color: #fff2ca;
    background: #17241ef2;
    border-radius: 7px;
    font-size: 0.8rem;
    pointer-events: none;
  }

  .canto-caption strong {
    color: #d5d1b9;
    margin-right: 0.4em;
  }

  .held-card-label {
    position: fixed;
    z-index: 3;
    transform: translate(-50%, calc(-100% - 9px));
    border: 1px solid #748174;
    border-radius: 5px;
    padding: 4px 8px;
    background: #16261e;
    color: #fff6dd;
    white-space: nowrap;
    font-size: 0.8rem;
    pointer-events: none;
  }
</style>
