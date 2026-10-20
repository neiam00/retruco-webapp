<script lang="ts">
  import { onMount } from 'svelte';
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
  } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import Card from '#lib/components/Card.svelte';
  import ChatPanel from '#lib/components/ChatPanel.svelte';
  import FeltTable from '#lib/components/FeltTable.svelte';
  import { signals } from '#lib/signal-options.js';
  import Hierarchy from '#lib/components/Hierarchy.svelte';
  import { api, ApiError, socketURL } from '#lib/api.js';
  import { cardName } from '#lib/cards.js';
  import { declarations, commandLabel } from '#lib/command-labels.js';
  import type { User, Snapshot, Command } from '#lib/protocol.js';

  let { code }: { code: string } = $props();
  let snapshot = $state.raw<Snapshot | null>(null);
  let user = $state<User | null>(null);
  let name = $state('');
  let connected = $state(false);
  let error = $state('');
  let busy = $state(false);
  let ready = $state(false);
  let copied = $state(false);
  let hierarchyOpen = $state(false);
  let chatOpen = $state(false);
  let signalsOpen = $state(false);
  let declarationOpen = $state(false);
  let leaveOpen = $state(false);
  let leaving = $state(false);
  let declaration = $state('');
  let bottom = $state<number | null>(null);
  let top = $state<number | null>(null);
  let stackMode = $state(false);
  let cutPoint = $state(20);
  let raise = $state(2);
  let now = $state(Date.now());
  let offset = $state(0);
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
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
  let stacking = $derived(stackMode || game?.mandatoryStack === true);
  let canStack = $derived(game?.legal.some((command) => command.type === 'stack') ?? false);
  let callActions = $derived(
    game?.legal.filter(
      (command) => command.type === 'call' && (command.declaration ?? '') === declaration,
    ) ?? [],
  );
  let responseActions = $derived(
    game?.legal.filter(
      (command) =>
        command.type === 'respond' &&
        (command.declaration ?? '') === declaration &&
        (command.kind !== 'raise' || command.amount === raise || game?.pending?.kind === 'truco'),
    ) ?? [],
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
      } else if (!(cause instanceof ApiError && cause.status === 404)) {
        retry = setTimeout(() => void connect(), 2000);
      }
      return;
    }
    if (disposed) return;
    socket = new WebSocket(socketURL(code));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'snapshot') {
          const incoming = payload.data as Snapshot;
          if (incoming.state && incoming.state.version !== '1') {
            error = 'Actualiza la página para usar la nueva versión del juego.';
            socket?.close();
            return;
          }
          if (incoming.state?.revision !== snapshot?.state?.revision) {
            bottom = null;
            top = null;
            stackMode = false;
          }
          snapshot = incoming;
          if (declaration === 'a_ley' && incoming.state?.round !== 0) {
            declaration = '';
          }
          const receivedAt = Date.now();
          now = receivedAt;
          offset = Date.parse(incoming.serverTime) - receivedAt;
          connected = true;
          busy = false;
          if (leaving && (incoming.seat < 0 || incoming.state?.phase === 'match_over')) {
            void goto(resolve('/'));
          }
        } else if (payload.type === 'error') {
          error = payload.error;
          busy = false;
        }
      } catch {
        error = 'No pudimos leer el estado de la mesa.';
      }
    };
    socket.onclose = () => {
      connected = false;
      busy = false;
      if (!disposed) retry = setTimeout(connect, 2000);
    };
    socket.onerror = () => {
      connected = false;
    };
  }
  onMount(() => {
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
      clearInterval(timer);
      clearTimeout(retry);
      socket?.close();
    };
  });
  async function enter(sit: boolean) {
    busy = true;
    error = '';
    try {
      if (!user) user = await api<User>('/guest', { name });
      if (sit) await api(`/matches/${code}/join`, {});
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ perspective: 0 }));
      } else connect();
    } catch (e) {
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
    if (stacking) {
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
  function seatName(seat: number) {
    return snapshot?.seats[seat]?.name ?? 'Esperando…';
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

<svelte:head>
  <title>Mesa {code} — Retruco</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>
<div class="match-page">
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
    <div class="error match-error" role="alert">{error}</div>
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
        onsubmit={(e) => {
          e.preventDefault();
          void enter(true);
        }}
      >
        <div>
          <Label for="table-name">Tu nombre</Label><Input
            id="table-name"
            bind:value={name}
            minlength={2}
            maxlength={24}
            required
          />
        </div>
        <Button type="submit" disabled={busy}>Sentarme a jugar</Button><Button
          variant="outline"
          disabled={busy}
          onclick={() => enter(false)}
        >
          <Eye />Entrar a mirar
        </Button>
      </form>
    </section>
  {:else if !snapshot}
    <section class="entry-panel">
      <h1>Conectando con {code}…</h1>
      <p class="muted">Si la mesa no existe, revisa el código de la invitación.</p>
      <Button href="/" variant="outline">Volver al inicio</Button>
    </section>
  {:else}
    <div class="match-grid">
      <main class="game-surface">
        <div class="table-meta row spread">
          <span class="row status">
            {#if connected}
              <Wifi size={14} />
            {:else}
              <WifiOff size={14} />
            {/if}
            {connected ? 'En línea' : 'Reconectando…'}
          </span>
          <span>
            {snapshot.config.target} piedras · {snapshot.config.florRequired
              ? 'Flor por derecho'
              : 'Flor libre'}
          </span>
          {#if game}
            <span>Mano {game.handNumber}</span>
          {/if}
        </div>
        {#if spectator}
          <div class="spectator-bar">
            <span class="row"><Eye size={16} />Estás mirando</span>
            {#each snapshot.seats as seat, i (seat.id)}
              <Button
                variant={snapshot.perspective === i ? 'secondary' : 'ghost'}
                onclick={() => perspective(i)}
              >
                {seat.name}
              </Button>
            {/each}

            {#if !game && snapshot.seats.length < snapshot.config.players}
              <Button disabled={busy} onclick={() => enter(true)}>Sentarme</Button>
            {/if}
          </div>
        {/if}

        <div class="table-area" class:four-player={snapshot.config.players === 4}>
          <FeltTable {snapshot} {seconds} {myTurn} oninvite={copy} />
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
              </div>
              {#if game.preview}
                <div class="preview">
                  <span>Viste para tu compañero: {cardName(game.preview)}</span>
                </div>
              {/if}
            </div>
            <div class="hand-cards">
              {#each game.hand as held (held.index)}
                <Button
                  class={`hand-card ${held.used ? 'used' : ''} ${bottom === held.index ? 'selected-bottom' : ''} ${top === held.index ? 'selected-top' : ''}`}
                  variant="ghost"
                  disabled={held.used || !myTurn || busy}
                  aria-label={`${cardName(held.card)}${bottom === held.index ? ', abajo' : top === held.index ? ', arriba' : ''}`}
                  onclick={() => play(held.index)}
                >
                  <Card card={held.card} width={126} />
                  {#if bottom === held.index}
                    <span>Abajo · 2.ª</span>
                  {:else if top === held.index}
                    <span>Arriba · 3.ª</span>
                  {/if}
                </Button>
              {/each}
            </div>
            {#if !spectator && game.phase === 'playing'}
              <div class="declaration-control">
                <Button variant="outline" onclick={() => (declarationOpen = true)}>
                  <Speech size={16} />{declaration
                    ? declarations.find((option) => option.value === declaration)?.label
                    : 'Decir…'}
                </Button>
              </div>
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
                          disabled={option.value === 'a_ley' && game.round !== 0}
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
              {#if canStack}
                <div class="row stack-controls">
                  <Button
                    variant="outline"
                    disabled={game.mandatoryStack}
                    onclick={() => {
                      stackMode = !stackMode;
                      bottom = null;
                      top = null;
                    }}
                  >
                    {stacking ? 'Jugando pegado' : 'Jugar pegado'}
                  </Button>
                  {#if stacking}
                    <span>Primero elige abajo; después, arriba.</span>
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

                {#each game.pending ? [...responseActions, ...callActions] : callActions as command (actionKey(command))}
                  <Button
                    variant={command.kind === 'decline' ? 'outline' : 'default'}
                    disabled={!connected || busy}
                    onclick={() => send(command)}
                  >
                    {commandLabel(command, game.pending?.kind)}
                  </Button>
                {/each}
              </div>
            {/if}
          </section>
        {/if}
      </main>

      <div class="social-controls">
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
          aria-label={chatOpen ? 'Cerrar chat' : 'Abrir chat'}
          aria-expanded={chatOpen}
          onclick={() => (chatOpen = !chatOpen)}
        >
          {#if chatOpen}<X size={16} />{:else}<MessageCircle size={16} />{/if}
          Chat
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
  }
  .table-area {
    position: relative;
    display: grid;
    flex: 1;
    min-height: 520px;
  }
  .table-meta {
    position: absolute;
    top: 30px;
    right: 28px;
    z-index: 5;
    flex-direction: column;
    align-items: flex-end;
    gap: 7px;
    color: #94b09e;
    font-size: 9px;
  }
  .status {
    gap: 5px;
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
    transform-origin: 50% 100%;
    transition:
      transform 0.18s ease,
      opacity 0.18s ease;
    box-shadow: 0 8px 14px #061a1550;
  }
  .hand-cards :global(.hand-card + .hand-card) {
    margin-left: -27px;
  }
  .hand-cards :global(.hand-card:nth-child(1)) {
    transform: translateY(8px) rotate(-10deg);
  }
  .hand-cards :global(.hand-card:nth-child(2)) {
    transform: translateY(-5px);
    z-index: 1;
  }
  .hand-cards :global(.hand-card:nth-child(3)) {
    transform: translateY(8px) rotate(10deg);
    z-index: 2;
  }
  .hand-cards :global(.hand-card:not(:disabled):hover) {
    transform: translateY(-22px);
    z-index: 4;
  }
  .hand-cards :global(.hand-card:disabled) {
    opacity: 1;
  }
  .hand-cards :global(.hand-card.used) {
    opacity: 0.14;
    box-shadow: none;
  }
  .hand-cards :global(.hand-card.selected-bottom),
  .hand-cards :global(.hand-card.selected-top) {
    outline: 3px solid #e0cb81;
    transform: translateY(-18px);
    z-index: 3;
  }
  .hand-cards :global(.hand-card > span) {
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
    .table-meta > span:not(.status) {
      display: none;
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
    .stack-controls > span {
      font-size: 8px;
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
</style>
