<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { CardMotion } from '#lib/card-motion.js';
  import { preloadDeck } from '#lib/card-preload.js';
  import { CardSounds } from '#lib/card-sounds.js';
  import {
    CARD_SOUND_STORAGE_KEY,
    loadCardSoundsMuted,
    saveCardSoundsMuted,
  } from '#lib/sound-settings.js';
  import VoiceControls from '#lib/components/VoiceControls.svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    BookOpen,
    Copy,
    LogOut,
    Eye,
    Wifi,
    WifiOff,
    MessageCircle,
    Smile,
    Speech,
    X,
    Volume2,
    VolumeX,
    MoreHorizontal,
    List,
  } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import Card from '#lib/components/Card.svelte';
  import ChatPanel from '#lib/components/ChatPanel.svelte';
  import CantoHistory from '#lib/components/CantoHistory.svelte';
  import FeltTable from '#lib/components/FeltTable.svelte';
  import TableViewport from '#lib/components/TableViewport.svelte';
  import SeatSelector from '#lib/components/SeatSelector.svelte';
  import PrivoSummary from '#lib/components/PrivoSummary.svelte';
  import { signals } from '#lib/signal-options.js';
  import Hierarchy from '#lib/components/Hierarchy.svelte';
  import { api, ApiError, socketURL } from '#lib/api.js';
  import { displayNameError, focusField, focusAlert } from '#lib/form-validation.js';
  import { cardName } from '#lib/cards.js';
  import { declarations, commandLabel } from '#lib/command-labels.js';
  import { CPUController, type CPUStatus } from '#lib/cpu/controller.js';
  import type { User, Snapshot, Command, CPUWork } from '#lib/protocol.js';

  let { code }: { code: string } = $props();
  let snapshot = $state.raw<Snapshot | null>(null);
  let user = $state<User | null>(null);
  let name = $state('');
  let nameError = $state('');
  let nameRevision = 0;
  let connected = $state(false);
  let error = $state('');
  let cpuStatus = $state<CPUStatus>('idle');
  let cpuError = $state('');
  let busy = $state(false);
  let ready = $state(false);
  let copied = $state(false);
  let hierarchyOpen = $state(false);
  let chatOpen = $state(false);
  let signalsOpen = $state(false);
  let declarationOpen = $state(false);
  let moreActionsOpen = $state(false);
  let detailsOpen = $state(false);
  let leaveOpen = $state(false);
  let leaving = $state(false);
  let roomClosed = false;
  let roomUnavailable = $state(false);
  let declaration = $state('');
  let bottom = $state<number | null>(null);
  let top = $state<number | null>(null);
  let stackMode = $state(false);
  let burnMode = $state(false);
  let cutPoint = $state(20);
  let raise = $state(2);
  let now = $state(Date.now());
  let offset = $state(0);
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let stopPreloading: (() => void) | undefined;
  let gameSurface = $state<HTMLElement>();
  let cardsMoving = $state(false);
  const cardMotion = new CardMotion((moving) => {
    cardsMoving = moving;
  });
  const cardSounds = new CardSounds();
  let cardsMuted = $state(false);

  function toggleCardSounds() {
    cardsMuted = !cardsMuted;
    cardSounds.setMuted(cardsMuted);
    saveCardSoundsMuted(cardsMuted);
    if (!cardsMuted) cardSounds.unlock();
  }

  function syncCardSounds(event: StorageEvent) {
    if (event.key !== CARD_SOUND_STORAGE_KEY && event.key !== null) return;
    cardsMuted = loadCardSoundsMuted();
    cardSounds.setMuted(cardsMuted);
  }
  const cpu = new CPUController(
    (seat, revision, command) => {
      if (!disposed && socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            input: { id: crypto.randomUUID(), cpuSeat: seat, revision, command },
          }),
        );
      }
    },
    (status, message) => {
      cpuStatus = status;
      cpuError = message ?? '';
    },
    () => cardMotion.moving,
  );
  let game = $derived(snapshot?.state);
  let spectator = $derived((snapshot?.seat ?? -1) < 0);
  let myTurn = $derived(
    connected &&
      !spectator &&
      game?.turn === snapshot?.seat &&
      game?.phase === 'playing' &&
      !game?.pending,
  );
  let seconds = $derived(
    snapshot?.deadline && !snapshot.deadline.startsWith('0001')
      ? Math.max(0, Math.ceil((Date.parse(snapshot.deadline) - now - offset) / 1000))
      : 0,
  );
  let stacking = $derived(!burnMode && (stackMode || game?.mandatoryStack === true));
  let canStack = $derived(game?.legal.some((command) => command.type === 'stack') ?? false);
  let canBurn = $derived(game?.legal.some((command) => command.type === 'burn') ?? false);
  let callActions = $derived(
    game?.legal.filter(
      (command) => command.type === 'call' && (command.declaration ?? '') === declaration,
    ) ?? [],
  );
  let responseActions = $derived(
    game?.legal.filter(
      (command) =>
        command.type === 'respond' &&
        (game.pending?.kind === 'privo' || (command.declaration ?? '') === declaration) &&
        (command.kind !== 'raise' || command.amount === raise || game?.pending?.kind === 'truco'),
    ) ?? [],
  );
  let availableActions = $derived(
    game?.pending ? [...responseActions, ...callActions] : callActions,
  );
  let primaryActions = $derived.by(() => {
    if (game?.pending) {
      return availableActions.filter((command) =>
        ['accept', 'decline', 'present_flor', 'flowers_no'].includes(command.kind ?? ''),
      );
    }
    const truco = callActions.find((command) => command.kind === 'truco');
    const envido = callActions.find((command) => command.kind === 'envido');
    const commonCalls = [truco, envido].filter((command) => command !== undefined);
    return commonCalls.length ? commonCalls : callActions.slice(0, 2);
  });
  let moreActions = $derived(
    availableActions.filter((command) => !primaryActions.includes(command)),
  );

  async function connect() {
    if (disposed || !user) return;

    // Check HTTP status before opening the socket so missing tables and expired
    // sessions are actionable errors rather than an endless reconnect screen.
    try {
      await api<Snapshot>(`/matches/${code}`);
    } catch (cause) {
      if (disposed) return;
      error = cause instanceof Error ? cause.message : 'No pudimos conectar con la mesa.';
      if (cause instanceof ApiError && cause.status === 401) {
        user = null;
      } else if (cause instanceof ApiError && cause.status === 404) {
        roomUnavailable = true;
        snapshot = null;
      } else {
        retry = setTimeout(() => void connect(), 2000);
      }
      return;
    }
    if (disposed) return;
    socket = new WebSocket(socketURL(code));
    socket.onmessage = (event) => {
      if (disposed) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'snapshot') {
          const incoming = payload.data as Snapshot;
          if (incoming.state && !['1', '2'].includes(incoming.state.version)) {
            error = 'Actualiza la página para usar la nueva versión del juego.';
            socket?.close();
            return;
          }
          if (incoming.state?.phase !== 'match_over') stopPreloading ??= preloadDeck();
          if (incoming.state?.revision !== snapshot?.state?.revision) {
            bottom = null;
            top = null;
            stackMode = false;
            burnMode = false;
          }
          if (incoming.state?.pending?.kind === 'privo') {
            declaration = '';
            declarationOpen = false;
          }
          const animateCards = gameSurface
            ? cardMotion.prepare(gameSurface, connected ? snapshot : null, incoming)
            : undefined;
          cardSounds.update(connected ? snapshot : null, incoming);
          snapshot = incoming;
          void tick().then(() => {
            if (
              !disposed &&
              snapshot?.state?.revision === incoming.state?.revision &&
              snapshot?.seat === incoming.seat &&
              snapshot?.perspective === incoming.perspective
            )
              animateCards?.();
          });
          if (declaration === 'a_ley' && incoming.state?.round !== 0) {
            declaration = '';
          }
          const receivedAt = Date.now();
          now = receivedAt;
          offset = Date.parse(incoming.serverTime) - receivedAt;
          connected = true;
          busy = false;
          cpu.update(payload.cpu as CPUWork | undefined);
          if (leaving && (incoming.seat < 0 || incoming.state?.phase === 'match_over')) {
            void goto(resolve('/'));
          }
        } else if (payload.type === 'room_closed') {
          roomClosed = true;
          void goto(resolve('/'));
        } else if (payload.type === 'error') {
          error = payload.error;
          busy = false;
          leaving = false;
        }
      } catch {
        error = 'No pudimos leer el estado de la mesa.';
      }
    };
    socket.onclose = () => {
      cardMotion.cancel();
      cardSounds.stop();
      cpu.stop();
      connected = false;
      busy = false;
      if (!disposed && !roomClosed) retry = setTimeout(connect, 2000);
    };
    socket.onerror = () => {
      connected = false;
    };
  }
  onMount(() => {
    cardsMuted = loadCardSoundsMuted();
    cardSounds.setMuted(cardsMuted);
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    const stopMotion = () => cardMotion.cancel();
    motionPreference.addEventListener('change', stopMotion);
    void api<User | null>('/session')
      .then((value) => {
        user = value;
        ready = true;
        if (user) connect();
      })
      .catch((e) => {
        error = e.message;
        ready = true;
      });
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => {
      disposed = true;
      stopPreloading?.();
      cardMotion.cancel();
      cardSounds.close();
      motionPreference.removeEventListener('change', stopMotion);
      cpu.stop();
      clearInterval(timer);
      clearTimeout(retry);
      socket?.close();
    };
  });
  async function enter(seat?: number) {
    nameError = user ? '' : displayNameError(name);
    if (nameError) {
      await focusField('table-name');
      return;
    }
    busy = true;
    error = '';
    const revision = nameRevision;
    try {
      if (!user) {
        try {
          user = await api<User>('/guest', { name });
        } catch (cause) {
          if (revision !== nameRevision) return;
          if (cause instanceof ApiError && cause.status === 400) {
            nameError = cause.message;
            await focusField('table-name');
            return;
          }
          throw cause;
        }
      }
      if (seat !== undefined) await api(`/matches/${code}/join`, { seat });
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ perspective: 0 }));
      } else connect();
    } catch (e) {
      if (revision === nameRevision)
        error = e instanceof Error ? e.message : 'No pudimos entrar a la mesa.';
    } finally {
      busy = false;
    }
  }
  function send(command: Command) {
    if (!connected || busy || !socket) return;
    error = '';
    busy = true;
    socket.send(
      JSON.stringify({
        input: { id: crypto.randomUUID(), revision: game?.revision ?? 0, command },
      }),
    );
    declaration = '';
  }
  function play(index: number) {
    if (burnMode) {
      send({ type: 'burn', card: index, declaration });
    } else if (stacking) {
      if (bottom === index) {
        bottom = null;
      } else if (bottom === null) {
        bottom = index;
      } else if (top === index) {
        top = null;
      } else {
        top = index;
      }
    } else send({ type: 'play', card: index, declaration });
  }
  function sendChat(message: string) {
    if (!message.trim() || !connected || !socket) return;
    socket.send(
      JSON.stringify({
        input: { id: crypto.randomUUID(), chat: message, command: { type: '' } },
      }),
    );
  }
  function signal(kind: string) {
    if (connected && socket)
      socket.send(
        JSON.stringify({ input: { id: crypto.randomUUID(), signal: kind, command: { type: '' } } }),
      );
  }
  function perspective(seat: number) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ perspective: seat }));
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/mesa/${code}`);
      copied = true;
      setTimeout(() => (copied = false), 2500);
    } catch {
      error = `Comparte este código: ${code}`;
    }
  }
  function actionKey(command: Command) {
    return [command.type, command.kind, command.amount, command.mode].join(':');
  }
  function cantoDisabled(command: Command) {
    return !connected || busy || (declaration === 'con_mi_flor' && command.kind === 'ley_envido');
  }
  function seatName(seat: number) {
    return snapshot?.seats[seat]?.name || 'Esperando…';
  }
  async function leave() {
    if (spectator || game?.phase === 'match_over') {
      await goto(resolve('/'));
      return;
    }
    leaving = true;
    send({ type: 'leave' });
    leaveOpen = false;
  }
</script>

<svelte:window
  onresize={() => cardMotion.cancel()}
  onpointerup={() => cardSounds.unlock()}
  onkeydown={(event) => {
    cardSounds.unlock();
    if (event.key === 'Escape') detailsOpen = false;
  }}
  onstorage={syncCardSounds}
/>
<svelte:document
  onvisibilitychange={() => {
    cardMotion.cancel();
    if (document.hidden) cardSounds.stop();
  }}
/>

<svelte:head>
  <title>Mesa {code} — Retruco</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>
<div class={['match-page', { 'active-match': !!game, 'details-open': detailsOpen }]}>
  <header class="match-header">
    <a href={resolve('/')} class="brand">
      <span class="brand-mark">r.</span>
      retruco
    </a>
    <div class="row">
      <span class="room-code">{code}</span>
      <Button variant="ghost" size="icon" aria-label="Copiar invitación" onclick={copy}>
        <Copy />
      </Button><Button
        variant="ghost"
        size="icon"
        aria-label="Ver jerarquía de las cartas"
        onclick={() => (hierarchyOpen = true)}
      >
        <BookOpen />
      </Button><Button
        variant="ghost"
        size="icon"
        aria-label="Salir de la mesa"
        onclick={() => (leaveOpen = true)}
      >
        <LogOut />
      </Button>
    </div>
  </header>
  {#if copied}
    <p class="toast" role="status">Invitación copiada.</p>
  {/if}

  {#if error}
    {#key error}
      <div class="error match-error" role="alert" tabindex="-1" {@attach focusAlert}>
        {error}
      </div>
    {/key}
  {/if}

  {#if !ready}
    <div class="entry-panel"><h1>Preparando la mesa…</h1></div>
  {:else if !user}
    <section class="entry-panel">
      <span class="eyebrow">Te guardaron un puesto</span>
      <h1>Bienvenido a {code}</h1>
      <p>Entra con tu nombre para jugar o mirar la partida.</p>
      <form
        class="fields"
        novalidate
        onsubmit={(e) => {
          e.preventDefault();
          void enter();
        }}
      >
        <div>
          <Label for="table-name">Tu nombre</Label><Input
            id="table-name"
            bind:value={name}
            oninput={() => {
              nameError = '';
              error = '';
              nameRevision++;
            }}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'table-name-error' : undefined}
            minlength={2}
            maxlength={24}
            required
          />
          {#if nameError}
            <p id="table-name-error" class="field-error" role="alert">
              {nameError}
            </p>
          {/if}
        </div>
        <Button type="submit" disabled={busy}>Elegir mi puesto</Button><Button
          variant="outline"
          disabled={busy}
          onclick={() => enter()}
        >
          <Eye />Entrar a mirar
        </Button>
      </form>
    </section>
  {:else if !snapshot}
    <section class="entry-panel">
      <h1>{roomUnavailable ? 'Esta mesa ya no está disponible.' : `Conectando con ${code}…`}</h1>
      <p class="muted">
        {roomUnavailable
          ? 'Vuelve al inicio para buscar otra mesa.'
          : 'Si la mesa no existe, revisa el código de la invitación.'}
      </p>
      <Button href="/" variant="outline">Volver al inicio</Button>
    </section>
  {:else}
    <div class="match-grid">
      <main class="game-surface" bind:this={gameSurface}>
        {#if spectator}
          <div class={['spectator-bar', { 'waiting-spectator': !game }]}>
            <span class="row"><Eye size={16} />Estás mirando</span>
            {#each snapshot.seats as seat, i (seat.id || `empty-${i}`)}
              {#if seat.id}
                <Button
                  variant={snapshot.perspective === i ? 'secondary' : 'ghost'}
                  onclick={() => perspective(i)}
                >
                  {seat.name}
                </Button>
              {/if}
            {/each}
          </div>
        {/if}

        {#if spectator && !game}
          <SeatSelector
            {snapshot}
            disabled={busy || !connected}
            onselect={(seat) => void enter(seat)}
          />
        {/if}

        <div class="table-area" class:four-player={snapshot.config.players === 4}>
          {#if game}
            <TableViewport>
              <FeltTable {snapshot} {seconds} {myTurn} {cardsMoving} oninvite={copy} />
            </TableViewport>
          {:else}
            <FeltTable {snapshot} {seconds} {myTurn} {cardsMoving} oninvite={copy} />
          {/if}
          {#if game?.phase === 'cutting' && game.turn === snapshot.seat}
            <div class="cut-controls">
              <Label for="cut-point">Punto de corte (1–39)</Label><Input
                id="cut-point"
                type="number"
                min={1}
                max={39}
                bind:value={cutPoint}
              /><Button
                disabled={!connected || busy || cutPoint < 1 || cutPoint > 39}
                onclick={() => send({ type: 'cut', cut: cutPoint })}
              >
                Partir el mazo
              </Button>
            </div>
          {/if}
        </div>

        {#if game && game.phase !== 'cutting'}
          <section class="hand-area" aria-label="Tu mano">
            <PrivoSummary {game} viewerSeat={snapshot.seat} />
            <div class="row spread hand-label">
              <div>
                <span class="eyebrow">
                  {spectator ? `Mano de ${seatName(snapshot.perspective)}` : 'Tus cartas'}
                </span>
                {#if game.holding}
                  <p>
                    {game.holding.envido} de envido{game.holding.receta
                      ? ' · Receta'
                      : game.holding.flor
                        ? ` · Flor ${game.florValid ? 'válida' : 'quemada'}`
                        : ''}
                  </p>
                {/if}
                {#if burnMode}
                  <p role="status">Elige una carta para quemarla y pasar el turno.</p>
                {:else if stacking && canStack}
                  <p role="status">Primero elige abajo; después, arriba.</p>
                {/if}
              </div>
              {#if game.preview}
                <div class="preview">
                  <span>Viste para tu compañero: {cardName(game.preview)}</span>
                </div>
              {/if}
            </div>
            <div class="hand-cards">
              {#each game.hand as held (`${game.handNumber}:${held.index}`)}
                <Button
                  class={`hand-card ${held.used ? 'used' : ''} ${bottom === held.index ? 'selected-bottom' : ''} ${top === held.index ? 'selected-top' : ''}`}
                  data-hand-card={held.index}
                  variant="ghost"
                  disabled={held.used || !myTurn || busy}
                  aria-label={`${cardName(held.card)}${bottom === held.index ? ', abajo' : top === held.index ? ', arriba' : ''}`}
                  onclick={() => play(held.index)}
                >
                  <span class="card-face">
                    <Card card={held.card} width={126} intro={false} />
                    {#if bottom === held.index}
                      <span class="card-selection">Abajo · 2.ª</span>
                    {:else if top === held.index}
                      <span class="card-selection">Arriba · 3.ª</span>
                    {/if}
                  </span>
                </Button>
              {/each}
            </div>
            {#if !spectator && game.phase === 'playing'}
              {#if game.pending?.kind !== 'privo'}
                <div class="declaration-control">
                  <Button variant="outline" onclick={() => (declarationOpen = true)}>
                    <Speech size={16} />{declaration
                      ? declarations.find((option) => option.value === declaration)?.label
                      : 'Decir…'}
                  </Button>
                </div>
              {/if}
              <Dialog.Root bind:open={declarationOpen}>
                <Dialog.Content>
                  <Dialog.Header>
                    <Dialog.Title>¿Qué vas a decir?</Dialog.Title>
                    <Dialog.Description>
                      La declaración acompaña tu próxima jugada o respuesta.
                    </Dialog.Description>
                  </Dialog.Header>
                  <div class="declarations">
                    <span class="setting-label">Antes de jugar o responder, elige qué decir:</span>
                    <div class="row">
                      {#each declarations as option (option.value)}
                        <Button
                          variant={declaration === option.value ? 'secondary' : 'ghost'}
                          aria-pressed={declaration === option.value}
                          disabled={option.value === 'a_ley' &&
                            (game.round !== 0 || declaration === 'con_mi_flor')}
                          onclick={() => {
                            declaration = option.value;
                            declarationOpen = false;
                          }}
                        >
                          {option.label}
                        </Button>
                      {/each}
                    </div>
                  </div>
                </Dialog.Content>
              </Dialog.Root>
              <div class="play-controls">
                {#if canStack || canBurn}
                  <div class="row stack-controls">
                    {#if canStack}
                      <Button
                        variant="outline"
                        disabled={game.mandatoryStack}
                        onclick={() => {
                          stackMode = !stackMode;
                          burnMode = false;
                          bottom = null;
                          top = null;
                        }}
                      >
                        {stacking ? 'Jugando pegado' : 'Jugar pegado'}
                      </Button>
                    {/if}
                    {#if canBurn}
                      <Button
                        variant="outline"
                        disabled={busy || !connected}
                        aria-pressed={burnMode}
                        onclick={() => {
                          if (game.mandatoryStack) {
                            send({ type: 'burn', declaration });
                          } else {
                            burnMode = !burnMode;
                            stackMode = false;
                            bottom = null;
                            top = null;
                          }
                        }}
                      >
                        {game.mandatoryStack
                          ? 'Quemar las dos'
                          : burnMode
                            ? 'Cancelar quemado'
                            : 'Quemar carta'}
                      </Button>
                    {/if}
                    {#if stacking}
                      <Button
                        disabled={bottom === null ||
                          top === null ||
                          bottom === top ||
                          busy ||
                          !connected}
                        onclick={() =>
                          send({ type: 'stack', card: bottom ?? 0, top: top ?? 0, declaration })}
                      >
                        Jugar las dos
                      </Button>
                    {/if}
                  </div>
                {/if}

                <div class="canto-actions">
                  {#each primaryActions as command (actionKey(command))}
                    <Button
                      variant={command.kind === 'decline' ? 'outline' : 'default'}
                      disabled={cantoDisabled(command)}
                      onclick={() => send(command)}
                    >
                      {commandLabel(command, game.pending?.kind)}
                    </Button>
                  {/each}
                  {#if moreActions.length}
                    <Button variant="outline" onclick={() => (moreActionsOpen = true)}>
                      <MoreHorizontal size={16} />{game.pending ? 'Subir / otros' : 'Más cantos'}
                    </Button>
                  {/if}
                </div>
              </div>
              <Dialog.Root bind:open={moreActionsOpen}>
                <Dialog.Content>
                  <Dialog.Header>
                    <Dialog.Title>{game.pending ? 'Subir o responder' : 'Cantar'}</Dialog.Title>
                    <Dialog.Description>
                      Elige otro canto o una subida disponible.
                    </Dialog.Description>
                  </Dialog.Header>
                  <div class="more-cantos">
                    {#if game.pending && game.pending.caller !== snapshot.seat % 2 && game.pending.kind !== 'truco' && !game.pending.terminal}
                      <div class="raise-field">
                        <Label for="raise">Piedras para subir</Label><Input
                          id="raise"
                          type="number"
                          min={1}
                          max={snapshot.config.target}
                          bind:value={raise}
                        />
                      </div>
                    {/if}

                    {#each moreActions as command (actionKey(command))}
                      <Button
                        variant={command.kind === 'decline' ? 'outline' : 'default'}
                        disabled={cantoDisabled(command)}
                        onclick={() => {
                          moreActionsOpen = false;
                          send(command);
                        }}
                      >
                        {commandLabel(command, game.pending?.kind)}
                      </Button>
                    {/each}
                  </div>
                </Dialog.Content>
              </Dialog.Root>
            {/if}
          </section>
        {/if}
        <span class="connection-status">
          {#if connected}<Wifi size={12} />{:else}<WifiOff size={12} />{/if}
          {connected ? 'En línea' : 'Reconectando…'}
        </span>
        <div class="social-controls" role="group" aria-label="Herramientas de la partida">
          <Button
            class="details-toggle"
            variant="outline"
            aria-label={detailsOpen ? 'Cerrar detalles' : 'Detalles de la partida'}
            aria-expanded={detailsOpen}
            aria-controls="match-details"
            onclick={() => (detailsOpen = !detailsOpen)}
          >
            <List size={18} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={cardsMuted ? 'Activar sonidos de cartas' : 'Silenciar cartas'}
            title={cardsMuted ? 'Activar sonidos de cartas' : 'Silenciar cartas'}
            aria-pressed={cardsMuted}
            onclick={toggleCardSounds}
          >
            {#if cardsMuted}<VolumeX size={18} />{:else}<Volume2 size={18} />{/if}
          </Button>
          {#if game?.phase === 'playing' && !spectator}
            <Button
              variant="outline"
              size="icon"
              aria-label="Hacer una seña"
              onclick={() => (signalsOpen = true)}
            >
              <Smile />
            </Button>
          {/if}
          <Button
            variant="outline"
            size="icon"
            aria-label={chatOpen ? 'Cerrar chat' : 'Abrir chat'}
            title={chatOpen ? 'Cerrar chat' : 'Abrir chat'}
            aria-expanded={chatOpen}
            onclick={() => (chatOpen = !chatOpen)}
          >
            {#if chatOpen}<X size={16} />{:else}<MessageCircle size={16} />{/if}
            {#if snapshot.chat.length}<span class="chat-count">{snapshot.chat.length}</span>{/if}
          </Button>
        </div>
        {#if chatOpen}
          <div class="chat-popover"><ChatPanel {snapshot} {connected} onmessage={sendChat} /></div>
        {/if}
        {#if snapshot.signals.length}
          <div class="visible-signals" aria-live="polite">
            {#each snapshot.signals.slice(-2) as item (item.id)}
              <span>
                {signals.find((option) => option.kind === item.kind)?.emoji}
                {seatName(item.seat)}: {signals.find((option) => option.kind === item.kind)?.label}
              </span>
            {/each}
          </div>
        {/if}
      </main>
      <aside id="match-details" class="match-details" aria-label="Detalles de la partida">
        <Button class="details-close" variant="outline" onclick={() => (detailsOpen = false)}>
          <X size={16} />Cerrar detalles
        </Button>
        <div class="table-meta row spread">
          <span>
            {snapshot.config.target} piedras · {snapshot.config.florRequired
              ? 'Flor por derecho'
              : 'Flor libre'}
          </span>
          {#if game}
            <span>Mano {game.handNumber}</span>
          {/if}
        </div>
        <VoiceControls {code} />
        {#if cpuStatus !== 'idle'}
          <section class="cpu-status" aria-label="Estado de la CPU">
            <span role="status">
              {cpuStatus === 'loading'
                ? 'Preparando CPU…'
                : cpuStatus === 'thinking'
                  ? 'La CPU está pensando…'
                  : cpuStatus === 'error'
                    ? 'La CPU necesita ayuda'
                    : 'CPU lista'}
            </span>
            {#if cpuError}
              <p class="error" role="alert">{cpuError}</p>
              <Button variant="outline" onclick={() => cpu.retry()}>Reintentar CPU</Button>
            {/if}
          </section>
        {/if}
        <CantoHistory
          events={snapshot.cantoHistory ?? snapshot.events ?? []}
          viewerSeat={snapshot.seat}
        />
      </aside>
      <Dialog.Root bind:open={signalsOpen}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Hazle una seña</Dialog.Title>
            <Dialog.Description>
              Tu compañero puede verla. Un rival también podría pillarte.
            </Dialog.Description>
          </Dialog.Header>
          <div class="signal-options">
            {#each signals as item (item.kind)}
              <Button
                variant="outline"
                disabled={!connected}
                onclick={() => {
                  signal(item.kind);
                  signalsOpen = false;
                }}
              >
                <span aria-hidden="true">{item.emoji}</span>
                {item.label}
              </Button>
            {/each}
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  {/if}
</div>
<Dialog.Root bind:open={hierarchyOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>¿Cuál le gana a cuál?</Dialog.Title><Dialog.Description>
        La jerarquía del truco venezolano.
      </Dialog.Description>
    </Dialog.Header><Hierarchy />
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={leaveOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>¿Te vas de la mesa?</Dialog.Title><Dialog.Description>
        {game && game.phase !== 'match_over' && !spectator
          ? 'Salir hace que todo tu equipo pierda la partida. Una desconexión, en cambio, mantiene los tiempos de juego.'
          : 'Puedes volver al inicio cuando quieras.'}
      </Dialog.Description>
    </Dialog.Header>
    <div class="row">
      <Button variant="outline" onclick={() => (leaveOpen = false)}>Me quedo</Button><Button
        variant="destructive"
        onclick={leave}
      >
        Salir de la mesa
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  .match-page {
    position: relative;
    min-height: 100dvh;
    overflow: hidden;
    color: #f1f2e8;
    background:
      radial-gradient(ellipse at 50% 40%, #315c465c, transparent 65%),
      repeating-linear-gradient(0deg, #ffffff02 0 1px, transparent 1px 3px),
      radial-gradient(ellipse at center, #194637, #0b211b);
    --border: #a9c1ac30;
    --field-error: #ffc2ad;
    --input: #a9c1ac30;
    --background: #162e26;
    --foreground: #f1f2e8;
    --primary: #dace9e;
    --primary-foreground: #1c3328;
    --secondary: #294a3b;
    --secondary-foreground: #f1f2e8;
    --muted-foreground: #a1b7a8;
    --accent: #315240;
    --accent-foreground: #f1f2e8;
  }
  .more-cantos {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .more-cantos :global(button) {
    max-width: 100%;
    white-space: normal;
  }
  :global(.details-close),
  :global(.details-toggle) {
    display: none;
  }
  .match-header {
    height: 64px;
    padding: 0 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    z-index: 10;
    background: #091b1833;
    border-bottom: 1px solid #a9c1ac0d;
  }
  .match-header .brand {
    color: #eff0df;
    font-size: 20px;
    gap: 10px;
  }
  .match-header .brand-mark {
    background: #dace9e;
    color: #18372b;
    width: 29px;
    height: 29px;
    font-size: 23px;
  }
  .match-header .row {
    gap: 5px;
  }
  .match-header :global(button) {
    color: #aec2b3;
    width: 34px;
    height: 44px;
    min-height: 44px;
  }
  .match-header :global(svg) {
    width: 15px;
  }
  .room-code {
    font: 10px monospace;
    letter-spacing: 0.12em;
    color: #a2b5a6;
    margin-right: 10px;
  }
  .match-grid {
    position: relative;
  }
  .game-surface {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: calc(100dvh - 64px);
    padding-bottom: 22px;
    margin-right: 280px;
  }
  .table-area {
    position: relative;
    display: grid;
    flex: 1;
    min-height: 520px;
  }
  .match-details {
    position: absolute;
    top: 30px;
    right: 28px;
    z-index: 5;
    width: 224px;
  }
  .cpu-status {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    margin-bottom: 12px;
    border: 1px solid #e8e4ce24;
    border-radius: 14px;
    background: #152d26;
    font-size: 0.85rem;
  }
  .table-meta {
    margin-bottom: 20px;
    flex-direction: column;
    align-items: flex-end;
    gap: 7px;
    color: #94b09e;
    font-size: 9px;
  }
  .connection-status {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #94b09e;
    font-size: 9px;
    margin-right: auto;
  }
  .hand-area {
    position: relative;
    flex-shrink: 0;
    margin: 0 auto;
    z-index: 6;
    width: min(740px, 65%);
    text-align: center;
  }
  .hand-label {
    justify-content: center;
    color: #b7c7af;
    font-size: 10px;
    margin-bottom: 18px;
  }
  .hand-label .eyebrow {
    color: #d2d5b9;
    font-size: 8px;
    letter-spacing: 0.16em;
  }
  .hand-label p {
    margin-top: 5px;
  }
  .preview {
    position: absolute;
    right: 0;
    max-width: 140px;
    font-size: 9px;
  }
  .hand-cards {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    min-height: 174px;
    padding-bottom: 12px;
  }
  .hand-cards :global(.hand-card) {
    padding: 0;
    height: auto;
    min-width: 0;
    border-radius: 8px;
    position: relative;
    background: transparent;
    box-shadow: none;
    transition: none;
  }
  .card-face {
    display: block;
    position: relative;
    pointer-events: none;
    transform-origin: 50% 100%;
    transition: transform 80ms ease-out;
    box-shadow: 0 8px 14px #061a1550;
  }
  .hand-cards :global(.hand-card + .hand-card) {
    margin-left: -27px;
  }
  .hand-cards :global(.hand-card:nth-child(1) .card-face) {
    transform: translateY(8px) rotate(-10deg);
  }
  .hand-cards :global(.hand-card:nth-child(2) .card-face) {
    transform: translateY(-5px);
    z-index: 1;
  }
  .hand-cards :global(.hand-card:nth-child(3) .card-face) {
    transform: translateY(8px) rotate(10deg);
    z-index: 2;
  }
  .hand-cards :global(.hand-card:not(:disabled):hover),
  .hand-cards :global(.hand-card:focus-visible) {
    z-index: 4;
  }
  @media (hover: hover) and (pointer: fine) {
    .hand-cards :global(.hand-card:not(:disabled):hover .card-face) {
      transform: translateY(-12px);
    }
  }
  .hand-cards :global(.hand-card:focus-visible .card-face) {
    transform: translateY(-12px);
  }
  .hand-cards :global(.hand-card:disabled) {
    opacity: 1;
  }
  .hand-cards :global(.hand-card.used) {
    opacity: 0.14;
    box-shadow: none;
  }
  .hand-cards :global(.hand-card.selected-bottom .card-face),
  .hand-cards :global(.hand-card.selected-top .card-face) {
    outline: 3px solid #e0cb81;
    transform: translateY(-18px);
    z-index: 3;
  }
  .card-selection {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 5px;
    background: #e0cb81;
    color: #213b2b;
    font-size: 9px;
  }
  .declaration-control {
    position: absolute;
    top: 40%;
    left: 20px;
  }
  .declaration-control :global(button) {
    font-size: 10px;
    padding: 8px 12px;
    background: #162e27b3;
  }
  .declarations .row,
  .signal-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }
  .setting-label {
    font-size: 12px;
  }
  .stack-controls {
    justify-content: center;
    font-size: 10px;
    margin-top: 8px;
    gap: 8px;
  }
  .stack-controls :global(button) {
    min-height: 44px;
    height: 44px;
    font-size: 10px;
  }
  .canto-actions {
    display: flex;
    justify-content: center;
    gap: 7px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .canto-actions :global(button) {
    min-height: 44px;
    height: 44px;
    font-size: 11px;
    padding: 8px 16px;
    box-shadow: 0 4px 10px #071c1426;
  }
  .raise-field {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .raise-field :global(label) {
    font-size: 9px;
    max-width: 65px;
    text-align: right;
  }
  .raise-field :global(input) {
    width: 55px;
    min-height: 44px;
    height: 44px;
  }
  .social-controls {
    position: absolute;
    bottom: 28px;
    right: 28px;
    display: flex;
    gap: 8px;
    z-index: 12;
  }
  .social-controls :global(button) {
    background: #172b25;
    color: #c3d0b9;
    border-color: #a0b7a333;
    min-height: 40px;
    height: 40px;
    font-size: 11px;
  }
  .chat-count {
    padding: 2px 5px;
    border-radius: 4px;
    background: #42604a;
    font-size: 9px;
  }
  .chat-popover {
    position: absolute;
    bottom: 80px;
    right: 28px;
    width: 300px;
    z-index: 15;
    filter: drop-shadow(0 15px 30px #06160d60);
  }
  .visible-signals {
    position: absolute;
    bottom: 90px;
    left: 28px;
    display: grid;
    gap: 5px;
    max-width: 210px;
    z-index: 7;
  }
  .visible-signals span {
    padding: 7px 10px;
    border: 1px solid #a7baa92b;
    border-radius: 8px;
    background: #182d26e6;
    font-size: 10px;
  }
  .spectator-bar {
    position: absolute;
    top: 90px;
    left: 28px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    z-index: 10;
    font-size: 10px;
  }
  .spectator-bar :global(button) {
    min-height: 44px;
    height: 44px;
    padding: 5px 9px;
    font-size: 10px;
  }
  .spectator-bar.waiting-spectator {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    margin: 20px 20px 0;
    max-width: none;
    font-size: 12px;
  }
  .cut-controls {
    position: absolute;
    top: 65%;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 6;
  }
  .cut-controls :global(label) {
    font-size: 11px;
  }
  .cut-controls :global(input) {
    width: 80px;
  }
  .cut-controls :global(button) {
    white-space: nowrap;
  }
  .entry-panel {
    position: relative;
    max-width: 430px;
    margin: 12vh auto;
    display: grid;
    gap: 22px;
    padding: 30px;
  }
  .entry-panel h1 {
    font-size: 32px;
  }
  .entry-panel p {
    font-size: 13px;
    line-height: 1.7;
  }
  .toast,
  .match-error {
    position: fixed;
    top: 70px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    padding: 12px 20px;
    border-radius: 10px;
    font-size: 12px;
  }
  .toast {
    background: #e4d6a6;
    color: #213b2b;
  }
  @media (max-height: 800px) and (min-width: 651px) {
    .table-area {
      min-height: 450px;
    }
    .hand-cards :global(img) {
      width: 100px;
      height: auto;
    }
    .hand-cards {
      min-height: 145px;
    }
    .hand-label {
      margin-bottom: 10px;
    }
  }
  @media (max-width: 950px) {
    .declaration-control {
      left: -10px;
    }
    .hand-area {
      width: 70%;
    }
  }
  @media (max-width: 1150px) {
    .game-surface {
      margin-right: 0;
    }
    .match-details {
      position: static;
      width: auto;
      margin: 0 24px 24px;
    }
    .table-meta {
      position: absolute;
      top: 30px;
      right: 28px;
      z-index: 5;
    }
  }
  @media (max-width: 650px) {
    .match-header {
      height: 54px;
      padding: 0 14px;
    }
    .match-header .brand {
      font-size: 16px;
    }
    .match-header .brand-mark {
      width: 24px;
      height: 24px;
      font-size: 19px;
    }
    .room-code {
      font-size: 8px;
      margin-right: 2px;
    }
    .match-header :global(button) {
      width: 30px;
      height: 44px;
      min-height: 44px;
    }
    .game-surface {
      min-height: calc(100dvh - 54px);
      padding-bottom: 74px;
    }
    .table-area {
      min-height: 460px;
    }
    .table-area.four-player {
      min-height: 540px;
    }
    .table-meta {
      top: 12px;
      right: 12px;
      font-size: 8px;
    }
    .match-details {
      margin: 0 12px 24px;
    }
    .hand-area {
      width: calc(100% - 24px);
    }
    .hand-label {
      margin-bottom: 12px;
      font-size: 9px;
    }
    .hand-label .eyebrow {
      font-size: 7px;
    }
    .hand-cards {
      min-height: 128px;
      padding-bottom: 6px;
    }
    .hand-cards :global(img) {
      width: 90px;
      height: auto;
    }
    .hand-cards :global(.hand-card + .hand-card) {
      margin-left: -20px;
    }
    .declaration-control {
      left: 0;
      top: 52px;
    }
    .declaration-control :global(button) {
      width: 58px;
      padding: 5px;
      flex-direction: column;
      gap: 3px;
      height: auto;
      font-size: 8px;
    }
    .canto-actions {
      margin-top: 9px;
      gap: 5px;
    }
    .canto-actions :global(button) {
      font-size: 9px;
      height: 44px;
      min-height: 44px;
      padding: 5px 9px;
    }
    .stack-controls {
      gap: 5px;
      flex-wrap: wrap;
    }
    .preview {
      right: 0;
      top: 48px;
      width: 55px;
      font-size: 8px;
    }
    .social-controls {
      right: 12px;
      bottom: 12px;
    }
    .social-controls :global(button) {
      height: 44px;
      min-height: 44px;
    }
    .chat-popover {
      right: 12px;
      bottom: 57px;
      width: min(320px, calc(100vw - 24px));
    }
    .visible-signals {
      left: 12px;
      bottom: 12px;
      max-width: 185px;
    }
    .visible-signals span {
      font-size: 8px;
      padding: 5px 7px;
    }
    .spectator-bar {
      top: 55px;
      left: 12px;
      font-size: 8px;
      max-width: 100px;
    }
    .cut-controls {
      top: 65%;
      width: 280px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .cut-controls :global(button) {
      width: 100%;
    }
  }

  /* The table uses the space left by the hand and controls, rather than
     pushing those controls below a fixed minimum table height. */
  .active-match {
    height: 100dvh;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding-bottom: env(safe-area-inset-bottom);
    padding-top: env(safe-area-inset-top);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
  .active-match .match-header {
    flex: 0 0 48px;
    height: 48px;
  }
  .active-match .match-grid {
    flex: 1;
    min-height: 0;
  }
  .active-match .game-surface {
    height: 100%;
    min-height: 0;
    padding: 0 8px 24px;
  }
  .active-match .table-area {
    display: block;
    flex: 1;
    min-height: 0;
  }
  .active-match .hand-area {
    width: calc(100% - 52px);
    max-width: 880px;
    margin-left: auto;
    margin-right: 52px;
  }
  .active-match .hand-label {
    margin-bottom: 2px;
  }
  .active-match .hand-label p {
    margin-top: 0;
  }
  .active-match .hand-cards {
    height: clamp(76px, 17dvh, 150px);
    min-height: 0;
    padding: 12px 0 6px;
  }
  .active-match .hand-cards :global(.hand-card) {
    height: 100%;
    min-height: 0;
  }
  .active-match .card-face {
    height: 100%;
  }
  .active-match .hand-cards :global(img) {
    height: 100%;
    width: auto;
  }
  .active-match .canto-actions {
    grid-row: 2;
    margin-top: 0;
    gap: 4px;
    flex-wrap: nowrap;
  }
  .active-match .canto-actions :global(button) {
    white-space: normal;
    line-height: 1.15;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    padding: 4px 8px;
    font-size: 11px;
  }
  .active-match .stack-controls {
    grid-row: 1;
    margin-top: 0;
    flex-wrap: nowrap;
  }
  .active-match .stack-controls :global(button) {
    flex: 0 1 auto;
    min-width: 0;
    padding: 4px 8px;
    white-space: normal;
    line-height: 1.15;
  }
  .active-match .social-controls {
    position: absolute;
    right: 8px;
    bottom: 24px;
    flex-direction: column;
    gap: 4px;
    margin: 0;
  }
  .active-match .social-controls :global(button) {
    min-height: 44px;
    height: 44px;
    width: 44px;
    padding: 0;
    position: relative;
  }
  .active-match .connection-status {
    position: absolute;
    left: 8px;
    bottom: 4px;
  }
  .active-match .chat-count {
    position: absolute;
    top: 0;
    right: 0;
  }
  .active-match .chat-popover {
    right: 60px;
    bottom: 24px;
    width: min(300px, calc(100% - 68px));
    --chat-max-height: calc(100dvh - 80px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  }
  .play-controls {
    /* Keep the tabletop at the same scale as calls become replies and card
       controls disappear. Each row retains a full touch target's height. */
    display: grid;
    grid-template-rows: 44px 44px;
    gap: 4px;
    margin-top: 4px;
    min-width: 0;
  }
  .active-match .match-details {
    top: 8px;
    bottom: 8px;
    overflow: auto;
  }
  .active-match .spectator-bar:not(.waiting-spectator) {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    flex-shrink: 0;
    max-width: none;
    gap: 4px;
  }
  @media (max-width: 1150px), (max-height: 500px) {
    .active-match .game-surface {
      margin-right: 0;
    }
    .active-match :global(.details-toggle),
    .active-match :global(.details-close) {
      display: inline-flex;
    }
    .active-match .match-details {
      display: none;
      position: absolute;
      top: 4px;
      right: 4px;
      bottom: 4px;
      width: min(320px, calc(100% - 8px));
      margin: 0;
      padding: 12px;
      border: 1px solid #a9c1ac30;
      border-radius: 12px;
      background: #102c23;
      z-index: 20;
    }
    .active-match.details-open .match-details {
      display: block;
    }
    .active-match .table-meta {
      position: static;
      margin-top: 8px;
    }
  }
  @media (max-height: 500px) and (min-width: 520px) {
    .active-match .game-surface {
      margin-right: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(230px, 44%);
      grid-template-rows: minmax(0, 1fr);
      column-gap: 4px;
    }
    .active-match .table-area {
      grid-column: 1;
      grid-row: 1;
    }
    .active-match .hand-area {
      grid-column: 2;
      grid-row: 1;
      align-self: end;
    }
    .active-match .hand-cards {
      height: 90px;
    }
  }
  @media (max-height: 650px) {
    .active-match .hand-cards {
      height: 80px;
    }
  }
</style>
